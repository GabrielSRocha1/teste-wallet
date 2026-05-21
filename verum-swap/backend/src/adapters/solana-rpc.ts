/**
 * solana-rpc.ts — Cliente Solana RPC com failover automático.
 *
 * Princípios:
 *  - Lista de endpoints em ordem de prioridade: [primary, ...fallbacks].
 *  - Circuit breaker POR ENDPOINT — se Helius cai, QuickNode segue atendendo.
 *  - `sendRawTransaction` NÃO retenta dentro de um mesmo endpoint
 *    (failover entre endpoints é seguro: bytes idênticos = mesma signature,
 *    Solana deduplica naturalmente por signature na mempool).
 *  - Connections cacheadas por URL (sem reconectar a cada chamada).
 *  - `SolanaConnectionLike` é uma interface mínima — produção usa
 *    `Connection` do @solana/web3.js; testes injetam mocks.
 */

import { Connection, PublicKey, type VersionedTransaction } from '@solana/web3.js';
import { CircuitBreaker } from '../_internal/circuit-breaker';
import type { Env } from '../_internal/env';
import { createLogger } from '../_internal/logger';
import { isRetryableRpcError, withRetry } from '../_internal/retry';
import { withTimeout } from '../_internal/timeout';

const log = createLogger('SolanaRpcClient');

export type Commitment = 'processed' | 'confirmed' | 'finalized';

export interface BlockhashWithExpiry {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SimulateValue {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
}

export interface SignatureStatusValue {
  slot: number;
  confirmations: number | null;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  err: unknown;
}

/** Interface mínima da Connection — facilita mocking em testes. */
export interface SolanaConnectionLike {
  rpcEndpoint: string;
  getLatestBlockhash(commitment?: Commitment): Promise<BlockhashWithExpiry>;
  simulateTransaction(
    tx: VersionedTransaction,
    config?: { sigVerify?: boolean; replaceRecentBlockhash?: boolean; commitment?: Commitment },
  ): Promise<{ context: { slot: number }; value: SimulateValue }>;
  sendRawTransaction(
    raw: Buffer | Uint8Array,
    options?: { skipPreflight?: boolean; preflightCommitment?: Commitment; maxRetries?: number },
  ): Promise<string>;
  getSignatureStatuses(
    signatures: string[],
    config?: { searchTransactionHistory?: boolean },
  ): Promise<{ context: { slot: number }; value: Array<SignatureStatusValue | null> }>;
  getBalance(pubkey: PublicKey, commitment?: Commitment): Promise<number>;
}

export type SolanaConnectionFactory = (endpoint: string) => SolanaConnectionLike;

export const defaultConnectionFactory: SolanaConnectionFactory = (endpoint) =>
  new Connection(endpoint, 'confirmed') as unknown as SolanaConnectionLike;

export interface SolanaRpcClientOptions {
  primary: string;
  fallbacks?: string[];
  connectionFactory?: SolanaConnectionFactory;
  breakerOptions?: {
    failureThreshold?: number;
    cooldownMs?: number;
    rollingWindowMs?: number;
  };
  timeouts?: Partial<{
    blockhash: number;
    simulate: number;
    send: number;
    status: number;
    balance: number;
  }>;
  maxAttempts?: number;
}

interface OpOptions {
  name: string;
  timeoutMs: number;
  retryable: boolean;
  signal?: AbortSignal;
}

export class SolanaRpcClient {
  private readonly endpoints: string[];
  private readonly connections = new Map<string, SolanaConnectionLike>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly factory: SolanaConnectionFactory;
  private readonly timeouts: Required<NonNullable<SolanaRpcClientOptions['timeouts']>>;
  private readonly maxAttempts: number;
  private readonly breakerCfg: Required<NonNullable<SolanaRpcClientOptions['breakerOptions']>>;

  constructor(opts: SolanaRpcClientOptions) {
    if (!opts.primary) throw new Error('SolanaRpcClient: primary endpoint é obrigatório');
    this.endpoints = [opts.primary, ...(opts.fallbacks ?? [])];
    this.factory = opts.connectionFactory ?? defaultConnectionFactory;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.breakerCfg = {
      failureThreshold: opts.breakerOptions?.failureThreshold ?? 5,
      cooldownMs: opts.breakerOptions?.cooldownMs ?? 30_000,
      rollingWindowMs: opts.breakerOptions?.rollingWindowMs ?? 60_000,
    };
    this.timeouts = {
      blockhash: opts.timeouts?.blockhash ?? 8_000,
      simulate: opts.timeouts?.simulate ?? 10_000,
      send: opts.timeouts?.send ?? 20_000,
      status: opts.timeouts?.status ?? 8_000,
      balance: opts.timeouts?.balance ?? 8_000,
    };
  }

  private connectionFor(endpoint: string): SolanaConnectionLike {
    let conn = this.connections.get(endpoint);
    if (!conn) {
      conn = this.factory(endpoint);
      this.connections.set(endpoint, conn);
    }
    return conn;
  }

  private breakerFor(endpoint: string): CircuitBreaker {
    let cb = this.breakers.get(endpoint);
    if (!cb) {
      cb = new CircuitBreaker({
        name: `rpc:${endpoint}`,
        failureThreshold: this.breakerCfg.failureThreshold,
        cooldownMs: this.breakerCfg.cooldownMs,
        rollingWindowMs: this.breakerCfg.rollingWindowMs,
      });
      this.breakers.set(endpoint, cb);
    }
    return cb;
  }

  /** Health snapshot de todos os endpoints (para `/healthz`). */
  snapshot(): Array<{ endpoint: string; state: string; failures: number; cooldownRemainingMs: number }> {
    return this.endpoints.map((ep) => {
      const cb = this.breakerFor(ep);
      const s = cb.snapshot();
      return {
        endpoint: ep,
        state: s.state,
        failures: s.failures,
        cooldownRemainingMs: s.cooldownRemainingMs,
      };
    });
  }

  /**
   * Tenta a operação em cada endpoint em ordem.
   * - Dentro de um endpoint: opcionalmente retenta (controlado por `retryable`).
   * - Entre endpoints: se um falha (ou breaker OPEN), pula para o próximo.
   * - Se todos falham, propaga o último erro.
   */
  private async tryWithFailover<T>(
    op: (conn: SolanaConnectionLike) => Promise<T>,
    opts: OpOptions,
  ): Promise<T> {
    let lastError: unknown = new Error(`All RPC endpoints unavailable for ${opts.name}`);
    let attemptedAny = false;

    for (const endpoint of this.endpoints) {
      const breaker = this.breakerFor(endpoint);
      if (breaker.state === 'OPEN') {
        log.debug('skipping endpoint (breaker OPEN)', { op: opts.name, endpoint });
        continue;
      }
      attemptedAny = true;
      const conn = this.connectionFor(endpoint);
      try {
        return await breaker.execute(() =>
          withRetry(() => withTimeout(op(conn), opts.timeoutMs, `${opts.name}@${endpoint}`), {
            maxAttempts: opts.retryable ? this.maxAttempts : 1,
            signal: opts.signal,
            isRetryable: isRetryableRpcError,
            onRetry: ({ attempt, error, delayMs }) =>
              log.warn(`${opts.name} retry`, {
                endpoint,
                attempt,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              }),
          }),
        );
      } catch (err) {
        lastError = err;
        log.warn(`${opts.name} failed on endpoint`, {
          endpoint,
          error: err instanceof Error ? err.message : String(err),
        });
        // continua para o próximo endpoint
      }
    }
    if (!attemptedAny) {
      throw new Error(`All RPC endpoints' breakers are OPEN for ${opts.name}`);
    }
    throw lastError;
  }

  async getLatestBlockhash(commitment: Commitment = 'finalized'): Promise<BlockhashWithExpiry> {
    return this.tryWithFailover((conn) => conn.getLatestBlockhash(commitment), {
      name: 'getLatestBlockhash',
      timeoutMs: this.timeouts.blockhash,
      retryable: true,
    });
  }

  async simulateTransaction(
    tx: VersionedTransaction,
    config?: { sigVerify?: boolean; replaceRecentBlockhash?: boolean; commitment?: Commitment },
  ): Promise<SimulateValue & { slot: number }> {
    const res = await this.tryWithFailover(
      (conn) => conn.simulateTransaction(tx, config),
      { name: 'simulateTransaction', timeoutMs: this.timeouts.simulate, retryable: true },
    );
    return { ...res.value, slot: res.context.slot };
  }

  /**
   * Broadcast — NÃO retenta dentro de um mesmo endpoint.
   * Failover entre endpoints é seguro porque bytes assinados são idênticos:
   * a mesma signature será deduplicada pela mempool Solana.
   */
  async sendRawTransaction(
    raw: Buffer | Uint8Array,
    options?: { skipPreflight?: boolean; preflightCommitment?: Commitment },
  ): Promise<string> {
    return this.tryWithFailover(
      (conn) =>
        conn.sendRawTransaction(raw, {
          skipPreflight: options?.skipPreflight ?? false,
          preflightCommitment: options?.preflightCommitment ?? 'confirmed',
          // No maxRetries no client web3.js — controlamos retry no nosso layer
          maxRetries: 0,
        }),
      { name: 'sendRawTransaction', timeoutMs: this.timeouts.send, retryable: false },
    );
  }

  async getSignatureStatuses(
    signatures: string[],
    config?: { searchTransactionHistory?: boolean },
  ): Promise<Array<SignatureStatusValue | null>> {
    const res = await this.tryWithFailover(
      (conn) => conn.getSignatureStatuses(signatures, config),
      { name: 'getSignatureStatuses', timeoutMs: this.timeouts.status, retryable: true },
    );
    return res.value;
  }

  async getBalance(address: string, commitment: Commitment = 'confirmed'): Promise<number> {
    const pk = new PublicKey(address);
    return this.tryWithFailover((conn) => conn.getBalance(pk, commitment), {
      name: 'getBalance',
      timeoutMs: this.timeouts.balance,
      retryable: true,
    });
  }
}

/** Wiring de produção — usa env validado. */
export function createSolanaRpcClientFromEnv(env: Env): SolanaRpcClient {
  return new SolanaRpcClient({
    primary: env.SOLANA_RPC_PRIMARY,
    fallbacks: env.SOLANA_RPC_FALLBACKS,
  });
}
