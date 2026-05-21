/**
 * batched-reader.ts — Coalescing de N reads individuais em UM batch RPC.
 *
 * Cenário Solana: tela de wallet exibe 8 tokens. Sem batching, são 8
 * chamadas paralelas a `getTokenAccountBalance`. Com batching, vira UMA
 * chamada `getMultipleAccounts(8 addresses)`.
 *
 * Funcionamento:
 *  1. Primeira `load(k)` agenda dispatch após `windowMs`.
 *  2. Loads subsequentes dentro da janela são acumulados (deduplicados por keyFn).
 *  3. No timeout, todas as keys pendentes vão para `batchFetcher` em batches
 *     de até `maxBatchSize` (batches dispatch em paralelo).
 *  4. `batchFetcher` retorna `Map<string, V>` indexado por `keyFn(K)`.
 *     Keys ausentes resolvem para `undefined`.
 *  5. Erros do batchFetcher rejeitam todos os loads daquele batch.
 *
 * Trade-off: latência mínima de `windowMs` (típico 5-20ms) em troca de
 * redução drástica de calls. Inadequado se você precisa de latência <5ms.
 */

import { createLogger } from './logger';

const log = createLogger('BatchedReader');

export interface BatchedReaderOptions<K, V> {
  /** Função que recebe N keys e retorna Map indexado por `keyFn(K)`. */
  batchFetcher: (keys: K[]) => Promise<Map<string, V>>;
  /** Tempo de espera antes de dispatch (acumula chamadas concorrentes). Default 10ms. */
  windowMs?: number;
  /** Tamanho máximo por batch (splits em paralelo). Default 100. */
  maxBatchSize?: number;
  /** Serializador de key para Map lookups e dedup. Default `JSON.stringify`. */
  keyFn?: (key: K) => string;
}

interface PendingResolver<V> {
  resolve: (value: V | undefined) => void;
  reject: (err: unknown) => void;
}

interface PendingEntry<K, V> {
  key: K;
  resolvers: PendingResolver<V>[];
}

export interface BatchedReaderStats {
  loads: number;
  batches: number;
  /** Maior batch já dispatched. */
  maxBatchObserved: number;
}

export class BatchedReader<K, V> {
  private readonly pending = new Map<string, PendingEntry<K, V>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly maxBatchSize: number;
  private readonly keyFn: (key: K) => string;
  private readonly batchFetcher: (keys: K[]) => Promise<Map<string, V>>;
  private readonly stats_: BatchedReaderStats = { loads: 0, batches: 0, maxBatchObserved: 0 };

  constructor(opts: BatchedReaderOptions<K, V>) {
    if (typeof opts.batchFetcher !== 'function') {
      throw new Error('BatchedReader: batchFetcher obrigatório');
    }
    this.batchFetcher = opts.batchFetcher;
    this.windowMs = opts.windowMs ?? 10;
    this.maxBatchSize = opts.maxBatchSize ?? 100;
    // Default: string passa direto (sem aspas extras); outros tipos via JSON.stringify
    this.keyFn =
      opts.keyFn ??
      ((k: K) => (typeof k === 'string' ? k : JSON.stringify(k)));

    if (this.windowMs < 0) throw new Error('windowMs deve ser ≥ 0');
    if (this.maxBatchSize <= 0) throw new Error('maxBatchSize deve ser > 0');
  }

  /** Agenda load deste `key` para o próximo batch. */
  load(key: K): Promise<V | undefined> {
    return new Promise<V | undefined>((resolve, reject) => {
      this.stats_.loads += 1;
      const keyStr = this.keyFn(key);
      let entry = this.pending.get(keyStr);
      if (!entry) {
        entry = { key, resolvers: [] };
        this.pending.set(keyStr, entry);
      }
      entry.resolvers.push({ resolve, reject });
      this.scheduleDispatch();
    });
  }

  /** Dispara dispatch imediatamente, sem esperar a janela. Retorna quando todos os batches resolvem. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.dispatch();
  }

  stats(): BatchedReaderStats {
    return { ...this.stats_ };
  }

  private scheduleDispatch(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      void this.dispatch();
    }, this.windowMs);
  }

  private async dispatch(): Promise<void> {
    this.timer = null;
    const entries = Array.from(this.pending.values());
    this.pending.clear();
    if (entries.length === 0) return;

    // Splita em chunks paralelos
    const chunks: PendingEntry<K, V>[][] = [];
    for (let i = 0; i < entries.length; i += this.maxBatchSize) {
      chunks.push(entries.slice(i, i + this.maxBatchSize));
    }

    await Promise.all(chunks.map((chunk) => this.dispatchChunk(chunk)));
  }

  private async dispatchChunk(chunk: PendingEntry<K, V>[]): Promise<void> {
    this.stats_.batches += 1;
    this.stats_.maxBatchObserved = Math.max(this.stats_.maxBatchObserved, chunk.length);
    const keys = chunk.map((e) => e.key);

    try {
      const result = await this.batchFetcher(keys);
      for (const entry of chunk) {
        const value = result.get(this.keyFn(entry.key));
        for (const r of entry.resolvers) r.resolve(value);
      }
    } catch (err) {
      log.warn('batchFetcher rejeitou — todas as loads do batch falham', {
        batchSize: chunk.length,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const entry of chunk) {
        for (const r of entry.resolvers) r.reject(err);
      }
    }
  }
}
