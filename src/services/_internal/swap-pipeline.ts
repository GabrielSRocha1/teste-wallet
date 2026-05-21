/**
 * swap-pipeline.ts — Pipeline determinístico de swap Solana.
 *
 * Sequência ÚNICA e imutável:
 *   quote → validateQuote → buildTx → simulate → refreshBlockhash →
 *   applyBlockhashTo → validateQuote(re-check) → sign → send → confirm → verify
 *
 * Invariantes:
 *   - `send` é chamado EXATAMENTE uma vez por idempotencyKey resolvida em sucesso.
 *   - `sign` ocorre SEMPRE após blockhash refresh imediato.
 *   - Erros de validação (quote stale, slippage, simulate, verify) NÃO incrementam o breaker.
 *   - Idempotency é gravada antes da primeira RPC e atualizada na resolução.
 *
 * Todo I/O é injetado via SwapAdapters — o pipeline é puro e testável sem rede.
 */

import { CircuitOpenError } from './circuit-breaker';
import { createLogger, newCorrelationId } from './logger';
import { isRetryableRpcError, withRetry } from './retry';
import { withTimeout } from './timeout';
import {
  type AdapterContext,
  BlockhashExpiredError,
  ConfirmationFailedError,
  DuplicateInFlightError,
  type ExpectedOutcome,
  type IdempotencyRecord,
  type IdempotencyStore,
  type PipelineOptions,
  type Quote,
  QuoteStaleError,
  type SerializedTx,
  SimulationFailedError,
  SlippageExceededError,
  type SwapAdapters,
  type SwapRequest,
  type SwapResult,
  VerificationFailedError,
} from './swap-pipeline.types';

const log = createLogger('SwapPipeline');

const DEFAULTS = {
  quoteTtlMs: 30_000,
  quoteTimeoutMs: 10_000,
  buildTimeoutMs: 15_000,
  simulateTimeoutMs: 10_000,
  blockhashTimeoutMs: 8_000,
  signTimeoutMs: 30_000,
  sendTimeoutMs: 20_000,
  confirmTimeoutMs: 90_000,
  verifyTimeoutMs: 15_000,
  idempotencyTtlMs: 5 * 60_000,
  maxRpcAttempts: 3,
} as const;

/**
 * Idempotency key canonical para um SwapRequest.
 *
 * Não é hash criptográfico — é uma chave estável para detectar a mesma
 * intenção de swap e evitar double-spend em retries.
 */
export function makeIdempotencyKey(req: SwapRequest): string {
  return [
    'swap',
    req.network,
    req.userPublicKey,
    `${req.inputMint}->${req.outputMint}`,
    req.inputAmount,
    `slip${req.slippageBps}`,
    req.routePreference ?? 'auto',
  ].join(':');
}

/** Store em memória — usado em testes e como fallback runtime. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.record;
  }

  async set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    this.map.set(key, { record, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Valida frescor + slippage do quote (síncrono, FORA do breaker). */
function validateQuote(
  quote: Quote,
  req: SwapRequest,
  observedAt: number,
  fallbackTtlMs: number,
  correlationId: string,
): void {
  const ttl = Number.isFinite(quote.ttlMs) && quote.ttlMs > 0 ? quote.ttlMs : fallbackTtlMs;
  const age = observedAt - quote.fetchedAt;
  if (age > ttl) {
    throw new QuoteStaleError(correlationId, quote.fetchedAt, ttl, observedAt);
  }
  if (!Number.isFinite(req.slippageBps) || req.slippageBps < 0 || req.slippageBps > 1000) {
    throw new SlippageExceededError(correlationId, quote.outAmount, quote.minOutAmount);
  }
  let outNum: bigint;
  let minNum: bigint;
  try {
    outNum = BigInt(quote.outAmount);
    minNum = BigInt(quote.minOutAmount);
  } catch {
    throw new SlippageExceededError(correlationId, quote.outAmount, quote.minOutAmount);
  }
  if (outNum < minNum) {
    throw new SlippageExceededError(correlationId, quote.outAmount, quote.minOutAmount);
  }
}

interface CallRpcOpts {
  name: string;
  timeoutMs: number;
  signal: AbortSignal;
  maxAttempts: number;
  correlationId: string;
}

/** Etapa RPC retryable: breaker + withRetry + withTimeout. */
function callRpc<T>(
  adapters: SwapAdapters,
  fn: () => Promise<T>,
  opts: CallRpcOpts,
): Promise<T> {
  return adapters.circuitBreaker.execute(() =>
    withRetry(() => withTimeout(fn(), opts.timeoutMs, opts.name), {
      maxAttempts: opts.maxAttempts,
      signal: opts.signal,
      isRetryable: isRetryableRpcError,
      onRetry: ({ attempt, error, delayMs }) =>
        log.warn(`${opts.name} retry`, {
          correlationId: opts.correlationId,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
    }),
  );
}

interface OneShotOpts {
  name: string;
  timeoutMs: number;
  correlationId: string;
  /** Quando true, envolve em circuit breaker (send/confirm). Default false (sign). */
  wrapInBreaker?: boolean;
}

/** Etapa one-shot (sign / send / confirm): timeout sem retry, breaker opcional. */
function callOneShot<T>(
  adapters: SwapAdapters,
  fn: () => Promise<T>,
  opts: OneShotOpts,
): Promise<T> {
  const inner = () => withTimeout(fn(), opts.timeoutMs, opts.name);
  if (opts.wrapInBreaker) {
    return adapters.circuitBreaker.execute(inner);
  }
  return inner();
}

export async function executeSwap(
  req: SwapRequest,
  adapters: SwapAdapters,
  opts: PipelineOptions = {},
): Promise<SwapResult> {
  const correlationId = opts.correlationId ?? newCorrelationId('swap');
  const config = {
    quoteTtlMs: opts.quoteTtlMs ?? DEFAULTS.quoteTtlMs,
    quoteTimeoutMs: opts.quoteTimeoutMs ?? DEFAULTS.quoteTimeoutMs,
    buildTimeoutMs: opts.buildTimeoutMs ?? DEFAULTS.buildTimeoutMs,
    simulateTimeoutMs: opts.simulateTimeoutMs ?? DEFAULTS.simulateTimeoutMs,
    blockhashTimeoutMs: opts.blockhashTimeoutMs ?? DEFAULTS.blockhashTimeoutMs,
    signTimeoutMs: opts.signTimeoutMs ?? DEFAULTS.signTimeoutMs,
    sendTimeoutMs: opts.sendTimeoutMs ?? DEFAULTS.sendTimeoutMs,
    confirmTimeoutMs: opts.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs,
    verifyTimeoutMs: opts.verifyTimeoutMs ?? DEFAULTS.verifyTimeoutMs,
    idempotencyTtlMs: opts.idempotencyTtlMs ?? DEFAULTS.idempotencyTtlMs,
    maxRpcAttempts: opts.maxRpcAttempts ?? DEFAULTS.maxRpcAttempts,
  };
  const signal = opts.signal ?? new AbortController().signal;
  const ctx: AdapterContext = { signal, correlationId };
  const startedAt = adapters.now();
  const idemKey = makeIdempotencyKey(req);

  // 1. Idempotency precheck (antes de qualquer side-effect)
  const existing = await adapters.idempotencyStore.get(idemKey);
  if (existing) {
    if (existing.state === 'completed' && existing.result) {
      log.info('idempotent hit (completed) — returning cached', { correlationId, idemKey });
      return existing.result;
    }
    if (existing.state === 'in_flight') {
      throw new DuplicateInFlightError(correlationId, idemKey);
    }
    // state === 'failed' → permite re-tentativa, limpa registro antigo
    await adapters.idempotencyStore.delete(idemKey);
  }

  // 2. Marca in_flight (precisa estar antes de qualquer RPC para janela de proteção)
  await adapters.idempotencyStore.set(
    idemKey,
    { state: 'in_flight', startedAt },
    config.idempotencyTtlMs,
  );

  try {
    // 3. Quote (retryable)
    const quote = await callRpc(adapters, () => adapters.quote(req, ctx), {
      name: 'quote',
      timeoutMs: config.quoteTimeoutMs,
      signal,
      maxAttempts: config.maxRpcAttempts,
      correlationId,
    });

    // 4. Validate quote (NÃO conta no breaker)
    validateQuote(quote, req, adapters.now(), config.quoteTtlMs, correlationId);

    // 5. Build TX (retryable)
    const builtTx = await callRpc(adapters, () => adapters.buildTx(quote, req, ctx), {
      name: 'buildTx',
      timeoutMs: config.buildTimeoutMs,
      signal,
      maxAttempts: config.maxRpcAttempts,
      correlationId,
    });

    // 6. Simulate (RPC success ≠ simulation success)
    const simResult = await callRpc(adapters, () => adapters.simulate(builtTx, ctx), {
      name: 'simulate',
      timeoutMs: config.simulateTimeoutMs,
      signal,
      maxAttempts: config.maxRpcAttempts,
      correlationId,
    });
    if (simResult.err !== null && simResult.err !== undefined) {
      // RPC respondeu; falha lógica não envenena o breaker
      throw new SimulationFailedError(correlationId, simResult.err, simResult.logs);
    }

    // 7. Refresh blockhash IMEDIATAMENTE antes do sign
    const bh = await callRpc(adapters, () => adapters.refreshBlockhash(req.network, ctx), {
      name: 'refreshBlockhash',
      timeoutMs: config.blockhashTimeoutMs,
      signal,
      maxAttempts: config.maxRpcAttempts,
      correlationId,
    });

    // 8. Apply blockhash (síncrono, sem rede)
    const txReadyToSign: SerializedTx = adapters.applyBlockhashTo(builtTx, bh);

    // 9. Re-validate quote (paranoia contra TTL vencer durante build/sim/refresh)
    validateQuote(quote, req, adapters.now(), config.quoteTtlMs, correlationId);

    // 10. Sign (local, SEM retry, SEM breaker)
    const signed = await callOneShot(adapters, () => adapters.sign(txReadyToSign, ctx), {
      name: 'sign',
      timeoutMs: config.signTimeoutMs,
      correlationId,
    });

    // 11. Send (one-shot — NUNCA executado mais de uma vez)
    const signature = await callOneShot(adapters, () => adapters.send(signed, ctx), {
      name: 'send',
      timeoutMs: config.sendTimeoutMs,
      correlationId,
      wrapInBreaker: true,
    });

    // 12. Confirm (one-shot mas dentro do breaker — falhas de transporte contam)
    const confirmation = await callOneShot(
      adapters,
      () => adapters.confirm(signature, bh, ctx),
      {
        name: 'confirm',
        timeoutMs: config.confirmTimeoutMs,
        correlationId,
        wrapInBreaker: true,
      },
    );
    if (confirmation.state === 'expired') {
      throw new BlockhashExpiredError(correlationId, signature, bh.lastValidBlockHeight);
    }
    if (confirmation.state === 'failed') {
      throw new ConfirmationFailedError(correlationId, signature, confirmation.err ?? null);
    }

    // 13. Verify (read-only, retryable)
    const expected: ExpectedOutcome = {
      outputMint: req.outputMint,
      minOutAmount: quote.minOutAmount,
    };
    const verification = await callRpc(
      adapters,
      () => adapters.verify(signature, expected, ctx),
      {
        name: 'verify',
        timeoutMs: config.verifyTimeoutMs,
        signal,
        maxAttempts: config.maxRpcAttempts,
        correlationId,
      },
    );
    if (!verification.ok) {
      throw new VerificationFailedError(correlationId, signature, verification);
    }

    // 14. Sucesso
    const finishedAt = adapters.now();
    const result: SwapResult = {
      signature,
      quote,
      simulated: simResult,
      confirmed: confirmation,
      verified: verification,
      blockhashUsed: bh,
      correlationId,
      startedAt,
      finishedAt,
    };
    await adapters.idempotencyStore.set(
      idemKey,
      { state: 'completed', startedAt, result },
      config.idempotencyTtlMs,
    );
    log.info('swap completed', {
      correlationId,
      idemKey,
      signature,
      durationMs: finishedAt - startedAt,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await adapters.idempotencyStore
      .set(idemKey, { state: 'failed', startedAt, error: message }, config.idempotencyTtlMs)
      .catch(() => {
        /* não mascarar erro original */
      });

    if (err instanceof CircuitOpenError) {
      log.warn('swap aborted: circuit open', { correlationId, idemKey, error: message });
    } else {
      log.error('swap failed', err, { correlationId, idemKey });
    }
    throw err;
  }
}
