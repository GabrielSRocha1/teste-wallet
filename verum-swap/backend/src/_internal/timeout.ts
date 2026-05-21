/**
 * timeout.ts — Wrapper de Promise com timeout determinístico.
 *
 * Implementação espelha `src/services/_internal/timeout.ts` (lado cliente)
 * para padrão idêntico em cliente e servidor.
 *
 * Uso:
 *   await withTimeout(rpcCall(), 10_000, 'getBalance');
 *   // → lança TimeoutError('getBalance excedeu 10000ms') se não resolver.
 */

export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`Operação '${label}' excedeu ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export interface TimeoutOptions {
  /** AbortController opcional; .abort() é chamado se o timeout dispara. */
  controller?: AbortController;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  opts: TimeoutOptions = {},
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`withTimeout: ms inválido (${ms}) para '${label}'`);
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        opts.controller?.abort();
      } catch {
        /* abort pode falhar se já abortado */
      }
      reject(new TimeoutError(label, ms));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Helper: cria um AbortSignal que dispara após `ms`. */
export function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => {
    try {
      ctrl.abort(new TimeoutError('signal', ms));
    } catch {
      ctrl.abort();
    }
  }, ms);
  return ctrl.signal;
}
