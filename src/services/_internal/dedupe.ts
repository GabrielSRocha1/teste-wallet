/**
 * dedupe.ts — Request coalescing por chave.
 *
 * Cenário: 5 telas pedem o saldo da mesma address em <100ms.
 * Sem dedupe, cada uma faz uma chamada RPC. Com dedupe, a primeira chamada
 * executa; as outras 4 recebem a MESMA Promise pendente.
 *
 * Não confundir com cache: dedupe só vive enquanto a Promise está pendente.
 * Quando resolve/rejeita, a entrada é removida — próxima chamada faz nova RPC.
 *
 * Uso:
 *   const dedupe = new RequestDeduper<string, number>();
 *   await dedupe.run(`balance:${address}`, () => connection.getBalance(pk));
 */

export class RequestDeduper<K extends string, T> {
  private readonly inFlight = new Map<K, Promise<T>>();

  /**
   * Executa fn() compartilhando a Promise resultante entre chamadas concorrentes
   * com a mesma key. Quando a Promise resolve/rejeita, a entrada é removida.
   */
  run(key: K, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        // Sempre limpa, mesmo em erro (próxima call tenta de novo).
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Quantidade de operações pendentes (para métricas). */
  get pendingCount(): number {
    return this.inFlight.size;
  }

  /** Cancela TODAS as operações pendentes do mapa (não aborta a Promise; só remove o coalescing). */
  clear(): void {
    this.inFlight.clear();
  }
}
