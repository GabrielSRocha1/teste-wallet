/**
 * quorum-reader.ts — Quorum check para leituras críticas em múltiplos RPCs.
 *
 * Cenário: antes de broadcastar uma tx de alto valor, queremos garantir que
 * o saldo do usuário é REAL — não confiamos numa única RPC que pode estar
 * stale, comprometida ou serving cached/wrong data.
 *
 * Estratégia: query simultânea de N endpoints, bucketize por igualdade,
 * exige que o maior bucket tenha ≥ `minQuorum` respostas.
 *
 * Trade-off: latência ~max das N chamadas (paralelas), custo ~N× requests.
 * Use APENAS em leituras críticas; reads normais usam SolanaRpcClient com
 * failover sequencial (mais barato).
 */

import { PublicKey } from '@solana/web3.js';
import { createLogger } from '../_internal/logger';
import { withTimeout } from '../_internal/timeout';
import type { Commitment, SolanaConnectionFactory, SolanaConnectionLike } from './solana-rpc';

const log = createLogger('QuorumReader');

export interface QuorumDissenter<T> {
  endpoint: string;
  value?: T;
  error?: string;
}

export interface QuorumResult<T> {
  value: T;
  agreed: number;
  total: number;
  endpoints: string[];
  dissenters: QuorumDissenter<T>[];
}

export class QuorumFailedError<T> extends Error {
  constructor(
    public readonly responses: number,
    public readonly required: number,
    public readonly dissenters: QuorumDissenter<T>[],
  ) {
    super(
      `Quorum failed: ${responses} response(s), required ${required}. ` +
        `Dissenters: ${dissenters.map((d) => `${d.endpoint}=${d.error ?? JSON.stringify(d.value)}`).join('; ')}`,
    );
    this.name = 'QuorumFailedError';
  }
}

export interface QuorumReaderOptions {
  endpoints: string[];
  connectionFactory: SolanaConnectionFactory;
  /** Quantidade mínima de endpoints que devem concordar. Default 2. */
  minQuorum?: number;
  /** Timeout por endpoint individual. Default 5s. */
  timeoutMs?: number;
}

export interface RunQuorumOptions<T> {
  /** Comparador customizado (default: === ou JSON-equal). */
  isEqual?: (a: T, b: T) => boolean;
  /** AbortSignal externo. */
  signal?: AbortSignal;
}

function defaultIsEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export class QuorumReader {
  private readonly endpoints: string[];
  private readonly factory: SolanaConnectionFactory;
  private readonly minQuorum: number;
  private readonly timeoutMs: number;
  private readonly connections = new Map<string, SolanaConnectionLike>();

  constructor(opts: QuorumReaderOptions) {
    if (!opts.endpoints || opts.endpoints.length === 0) {
      throw new Error('QuorumReader: endpoints obrigatório (≥1)');
    }
    const minQuorum = opts.minQuorum ?? 2;
    if (minQuorum < 1) throw new Error('QuorumReader: minQuorum deve ser ≥1');
    if (minQuorum > opts.endpoints.length) {
      throw new Error(
        `QuorumReader: minQuorum (${minQuorum}) > endpoints (${opts.endpoints.length}) — impossível`,
      );
    }
    const timeoutMs = opts.timeoutMs ?? 5_000;
    if (timeoutMs <= 0) throw new Error('QuorumReader: timeoutMs deve ser > 0');

    this.endpoints = [...opts.endpoints];
    this.factory = opts.connectionFactory;
    this.minQuorum = minQuorum;
    this.timeoutMs = timeoutMs;
  }

  private connectionFor(endpoint: string): SolanaConnectionLike {
    let conn = this.connections.get(endpoint);
    if (!conn) {
      conn = this.factory(endpoint);
      this.connections.set(endpoint, conn);
    }
    return conn;
  }

  /**
   * Executa `op` em paralelo em todos os endpoints e retorna o valor de maioria.
   * Lança `QuorumFailedError` se nenhum valor atingir `minQuorum` respostas idênticas.
   */
  async runQuorum<T>(
    op: (conn: SolanaConnectionLike) => Promise<T>,
    opts: RunQuorumOptions<T> = {},
  ): Promise<QuorumResult<T>> {
    const isEqual = opts.isEqual ?? defaultIsEqual<T>;
    const signal = opts.signal;

    interface Settled {
      endpoint: string;
      success: boolean;
      value?: T;
      error?: string;
    }

    const settled: Settled[] = await Promise.all(
      this.endpoints.map(async (endpoint): Promise<Settled> => {
        const conn = this.connectionFor(endpoint);
        try {
          if (signal?.aborted) throw new Error('aborted');
          const value = await withTimeout(op(conn), this.timeoutMs, `quorum@${endpoint}`);
          return { endpoint, success: true, value };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { endpoint, success: false, error: msg };
        }
      }),
    );

    // Bucketize por igualdade
    const buckets: Array<{ value: T; endpoints: string[] }> = [];
    for (const r of settled) {
      if (!r.success || r.value === undefined) continue;
      let placed = false;
      for (const b of buckets) {
        if (isEqual(b.value, r.value)) {
          b.endpoints.push(r.endpoint);
          placed = true;
          break;
        }
      }
      if (!placed) buckets.push({ value: r.value, endpoints: [r.endpoint] });
    }

    // Maior bucket
    buckets.sort((a, b) => b.endpoints.length - a.endpoints.length);
    const winner = buckets[0];

    // Constrói dissenters (todos endpoints que não estão no winner)
    const winnerSet = new Set(winner?.endpoints ?? []);
    const dissenters: QuorumDissenter<T>[] = settled
      .filter((r) => !winnerSet.has(r.endpoint))
      .map((r) => ({ endpoint: r.endpoint, value: r.value, error: r.error }));

    const successfulResponses = settled.filter((r) => r.success).length;

    if (!winner || winner.endpoints.length < this.minQuorum) {
      log.warn('quorum failed', {
        successful: successfulResponses,
        required: this.minQuorum,
        bucketCount: buckets.length,
      });
      throw new QuorumFailedError(
        winner?.endpoints.length ?? 0,
        this.minQuorum,
        dissenters,
      );
    }

    return {
      value: winner.value,
      agreed: winner.endpoints.length,
      total: successfulResponses,
      endpoints: winner.endpoints,
      dissenters,
    };
  }

  /** Quorum-verificado getBalance em lamports. */
  async getBalance(
    address: string,
    commitment: Commitment = 'confirmed',
  ): Promise<QuorumResult<number>> {
    const pk = new PublicKey(address);
    return this.runQuorum<number>((conn) => conn.getBalance(pk, commitment));
  }
}
