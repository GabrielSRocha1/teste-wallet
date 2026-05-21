/**
 * retry.ts — Exponential backoff com jitter.
 *
 * Princípios:
 *  - Re-tenta SOMENTE se o erro for marcado como retryable (default heurística para RPC).
 *  - Jitter para evitar thundering herd.
 *  - Backoff exponencial limitado por `maxDelayMs`.
 *  - Hook `onRetry` para logging/metrics.
 *  - Aborta imediatamente se receber AbortSignal cancelado.
 *
 * Uso:
 *   const result = await withRetry(
 *     () => connection.getBalance(pk),
 *     {
 *       maxAttempts: 3,
 *       baseDelayMs: 500,
 *       maxDelayMs: 4000,
 *       isRetryable: (e) => isRpcThrottleOrTimeout(e),
 *       onRetry: ({ attempt, error }) => log.warn('retry', { attempt, error }),
 *     }
 *   );
 */

import { TimeoutError } from './timeout';

export interface RetryContext {
  attempt: number;
  error: unknown;
  delayMs: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  /** Delay base; cada attempt multiplica por 2^(attempt-1) com jitter. */
  baseDelayMs?: number;
  /** Limite superior do delay (proteção contra backoff exponencial fora de controle). */
  maxDelayMs?: number;
  /** Quanto de jitter aplicar (0..1). Default 0.3 = ±30%. */
  jitter?: number;
  /** Predicate para decidir se um erro é retryable. Default: erros de rede/RPC comuns. */
  isRetryable?: (error: unknown) => boolean;
  /** Hook executado ANTES de cada nova tentativa (não é chamado para o primeiro attempt). */
  onRetry?: (ctx: RetryContext) => void;
  /** Aborto cooperativo. */
  signal?: AbortSignal;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
  jitter: 0.3,
};

/** Heurística padrão: 429, 5xx, timeout, fetch failed, network error. */
export function isRetryableRpcError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('500') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('network request failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up')
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function computeDelay(attempt: number, opts: Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitter'>>): number {
  const exp = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs);
  const jitterAmount = exp * opts.jitter;
  const offset = (Math.random() * 2 - 1) * jitterAmount;
  return Math.max(0, Math.round(exp + offset));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitter = options.jitter ?? DEFAULTS.jitter;
  const isRetryable = options.isRetryable ?? isRetryableRpcError;
  const onRetry = options.onRetry;
  const signal = options.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }

    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxAttempts;
      if (isLast || !isRetryable(err)) {
        throw err;
      }

      const delayMs = computeDelay(attempt, { baseDelayMs, maxDelayMs, jitter });

      try {
        onRetry?.({ attempt, error: err, delayMs });
      } catch {
        /* hook não deve quebrar retry */
      }

      await sleep(delayMs, signal);
    }
  }

  // Inalcançável — defensivo.
  throw lastError;
}
