/**
 * dedupe.ts — Request coalescing por chave.
 *
 * Substitui o `rpcLock` global do server.ts (PROBLEMA #8). Antes, todas as
 * chamadas RPC de balance fetch eram serializadas — throughput máximo de
 * 1/avg_latency_ms (≈2-3 req/s). Com dedupe por wallet address:
 *
 *   - 5 usuários pedindo saldo da MESMA address em <100ms: 1 RPC, todos
 *     recebem o mesmo resultado.
 *   - 5 usuários pedindo saldos de addresses DIFERENTES: 5 RPCs em paralelo.
 *
 * A entrada do mapa é removida assim que a Promise resolve/rejeita.
 */

export class RequestDeduper<K extends string, T> {
  private readonly inFlight = new Map<K, Promise<T>>();

  run(key: K, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }
}
