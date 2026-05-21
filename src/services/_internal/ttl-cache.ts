/**
 * ttl-cache.ts — Cache TTL com dedup e stale-while-revalidate.
 *
 * Combina 3 padrões essenciais para reduzir carga em RPCs/APIs:
 *
 *  1. TTL: cada entrada tem expiração. Após `expiresAt`, leitura faz miss.
 *
 *  2. Request dedup: chamadas concorrentes a `getOrFetch(key, fn)` para a
 *     MESMA key compartilham a MESMA Promise. Sem dedup, 10 hooks
 *     subscribing simultaneously a `getBalance(X)` disparam 10 RPCs.
 *
 *  3. Stale-while-revalidate (SWR): se o valor passou de fresh mas está
 *     dentro de uma janela "stale", retorna o valor stale imediatamente
 *     e dispara refresh assíncrono. Próximas requests durante o refresh
 *     também recebem stale (sem disparar novo refresh).
 *
 * Eviction:
 *  - TTL: na leitura, se vencido, descarta.
 *  - LRU: quando `size > maxSize`, descarta entrada acessada há mais tempo.
 *
 * Casos de uso típicos:
 *   - Quote cache (key: req hash, ttl: 30s)
 *   - Balance cache (key: address, ttl: 4s, SWR: 4s)
 *   - Blockhash cache (key: 'finalized', ttl: 1s — muito curto)
 */

import { createLogger } from './logger';

const log = createLogger('TtlCache');

export type EvictionReason = 'ttl' | 'lru' | 'manual';

export interface TtlCacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  evictions: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

export interface TtlCacheOptions<T> {
  /** TTL padrão em ms. Default 30s. */
  defaultTtlMs?: number;
  /** Tamanho máximo. Default 1000. */
  maxSize?: number;
  /** Janela stale-while-revalidate em ms. 0 = desligado (default). */
  staleWhileRevalidateMs?: number;
  /** Source de tempo injetável. */
  now?: () => number;
  /** Callback ao despejar entrada. */
  onEvict?: (key: string, value: T, reason: EvictionReason) => void;
}

const DEFAULTS = {
  defaultTtlMs: 30_000,
  maxSize: 1_000,
  staleWhileRevalidateMs: 0,
} as const;

export class TtlCache<T> {
  // Map preserva ordem de inserção — usado para LRU.
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly refreshing = new Set<string>();
  private readonly stats_: TtlCacheStats = { hits: 0, misses: 0, staleHits: 0, evictions: 0 };

  private readonly defaultTtlMs: number;
  private readonly maxSize: number;
  private readonly staleWhileRevalidateMs: number;
  private readonly now: () => number;
  private readonly onEvictCb?: TtlCacheOptions<T>['onEvict'];

  constructor(opts: TtlCacheOptions<T> = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? DEFAULTS.defaultTtlMs;
    this.maxSize = opts.maxSize ?? DEFAULTS.maxSize;
    this.staleWhileRevalidateMs = opts.staleWhileRevalidateMs ?? DEFAULTS.staleWhileRevalidateMs;
    this.now = opts.now ?? Date.now;
    this.onEvictCb = opts.onEvict;

    if (this.defaultTtlMs <= 0) throw new Error('defaultTtlMs deve ser > 0');
    if (this.maxSize <= 0) throw new Error('maxSize deve ser > 0');
    if (this.staleWhileRevalidateMs < 0) throw new Error('staleWhileRevalidateMs deve ser ≥ 0');
  }

  private fireEvict(key: string, value: T, reason: EvictionReason): void {
    this.stats_.evictions += 1;
    if (this.onEvictCb) {
      try {
        this.onEvictCb(key, value, reason);
      } catch (err) {
        log.warn('onEvict callback threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private touchLru(key: string): void {
    // Map preserva ordem de inserção — re-inserir move ao final.
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.cache.set(key, entry);
  }

  private evictLruIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      const entry = this.cache.get(firstKey)!;
      this.cache.delete(firstKey);
      this.fireEvict(firstKey, entry.value, 'lru');
    }
  }

  private setEntry(key: string, value: T, ttlMs: number): void {
    const now = this.now();
    this.cache.delete(key); // remove para reinserir no final
    this.cache.set(key, { value, expiresAt: now + ttlMs, storedAt: now });
    this.evictLruIfNeeded();
  }

  /**
   * Busca chave no cache. Se hit fresh → retorna. Se hit stale → retorna stale + kick refresh.
   * Se miss → invoca `fn`, dedupando chamadas concorrentes pela mesma key.
   */
  async getOrFetch(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('TtlCache.getOrFetch: key deve ser string não-vazia');
    }
    const effTtl = ttlMs ?? this.defaultTtlMs;
    const now = this.now();
    const entry = this.cache.get(key);

    if (entry) {
      if (now < entry.expiresAt) {
        this.stats_.hits += 1;
        this.touchLru(key);
        return entry.value;
      }
      if (this.staleWhileRevalidateMs > 0 && now < entry.expiresAt + this.staleWhileRevalidateMs) {
        this.stats_.staleHits += 1;
        this.touchLru(key);
        this.kickBackgroundRefresh(key, fn, effTtl);
        return entry.value;
      }
      // Verdadeiramente expirada
      this.cache.delete(key);
      this.fireEvict(key, entry.value, 'ttl');
    }

    // Miss — verifica in-flight (dedup)
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    this.stats_.misses += 1;
    const promise = fn().then(
      (value) => {
        this.setEntry(key, value, effTtl);
        this.inFlight.delete(key);
        return value;
      },
      (err) => {
        // Falha NÃO é cacheada — próximo call retenta
        this.inFlight.delete(key);
        throw err;
      },
    );
    this.inFlight.set(key, promise);
    return promise;
  }

  private kickBackgroundRefresh(key: string, fn: () => Promise<T>, ttlMs: number): void {
    if (this.refreshing.has(key)) return;
    this.refreshing.add(key);
    fn().then(
      (value) => {
        this.setEntry(key, value, ttlMs);
        this.refreshing.delete(key);
      },
      (err) => {
        // Refresh falhou — mantém stale, próxima chamada (se ainda em janela) tenta de novo
        this.refreshing.delete(key);
        log.debug('background refresh failed', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
  }

  /** Get síncrono — retorna `null` se ausente ou expirado (sem SWR). */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const now = this.now();
    if (now >= entry.expiresAt) {
      this.cache.delete(key);
      this.fireEvict(key, entry.value, 'ttl');
      return null;
    }
    this.touchLru(key);
    this.stats_.hits += 1;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.setEntry(key, value, ttlMs ?? this.defaultTtlMs);
  }

  /** Existe e ainda fresh. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return this.now() < entry.expiresAt;
  }

  invalidate(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    this.cache.delete(key);
    this.fireEvict(key, entry.value, 'manual');
  }

  invalidateAll(): void {
    for (const [key, entry] of this.cache) {
      this.fireEvict(key, entry.value, 'manual');
    }
    this.cache.clear();
    this.inFlight.clear();
    this.refreshing.clear();
  }

  size(): number {
    return this.cache.size;
  }

  stats(): TtlCacheStats {
    return { ...this.stats_ };
  }

  resetStats(): void {
    this.stats_.hits = 0;
    this.stats_.misses = 0;
    this.stats_.staleHits = 0;
    this.stats_.evictions = 0;
  }
}
