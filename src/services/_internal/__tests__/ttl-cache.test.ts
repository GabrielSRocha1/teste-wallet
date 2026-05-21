import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogSinks } from '../logger';
import { TtlCache } from '../ttl-cache';

clearLogSinks();

// Clock injetável para testes determinísticos
function makeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

// ────────────────────────────────────────────────────────────────────────────────
// getOrFetch — basic
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache.getOrFetch — basic', () => {
  it('miss: invoca fn, retorna valor, cacheia', async () => {
    const cache = new TtlCache<number>({ defaultTtlMs: 30_000 });
    const fn = vi.fn(async () => 42);
    expect(await cache.getOrFetch('k', fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cache.stats().misses).toBe(1);
  });

  it('hit: 2ª chamada usa cache, NÃO invoca fn', async () => {
    const cache = new TtlCache<number>({ defaultTtlMs: 30_000 });
    const fn = vi.fn(async () => 42);
    await cache.getOrFetch('k', fn);
    expect(await cache.getOrFetch('k', fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cache.stats().hits).toBe(1);
  });

  it('TTL expira: refetch após expiresAt', async () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({ defaultTtlMs: 1_000, now: clock.now });
    let counter = 0;
    const fn = vi.fn(async () => ++counter);
    expect(await cache.getOrFetch('k', fn)).toBe(1);
    clock.advance(2_000);
    expect(await cache.getOrFetch('k', fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('ttlMs custom no call override default', async () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({ defaultTtlMs: 30_000, now: clock.now });
    let counter = 0;
    const fn = vi.fn(async () => ++counter);
    await cache.getOrFetch('k', fn, 500); // ttl=500ms override
    clock.advance(600);
    await cache.getOrFetch('k', fn, 500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('key vazia ou não-string lança', async () => {
    const cache = new TtlCache<number>();
    await expect(cache.getOrFetch('', async () => 1)).rejects.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Dedup
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache.getOrFetch — dedup', () => {
  it('5 chamadas concorrentes na MISS invocam fn 1x', async () => {
    const cache = new TtlCache<number>();
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => cache.getOrFetch('k', fn)),
    );
    expect(results).toEqual([42, 42, 42, 42, 42]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(1);
  });

  it('fn que lança rejeita TODAS as promises pendentes e NÃO cacheia', async () => {
    const cache = new TtlCache<number>();
    // Tipo explícito para que mockImplementationOnce abaixo aceite retorno number.
    const fn = vi.fn<() => Promise<number>>(async () => {
      throw new Error('boom');
    });
    const promises = Array.from({ length: 3 }, () => cache.getOrFetch('k', fn));
    const results = await Promise.allSettled(promises);
    for (const r of results) expect(r.status).toBe('rejected');
    // Falha não foi cacheada — próxima chamada tenta novamente
    fn.mockImplementationOnce(async () => 99);
    expect(await cache.getOrFetch('k', fn)).toBe(99);
    expect(fn).toHaveBeenCalledTimes(2); // 1ª (deduped) + 2ª (após falha)
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Stale-while-revalidate
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache — stale-while-revalidate', () => {
  it('durante janela stale retorna valor stale e dispara refresh em background', async () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({
      defaultTtlMs: 1_000,
      staleWhileRevalidateMs: 5_000,
      now: clock.now,
    });
    let counter = 0;
    const fn = vi.fn(async () => ++counter);

    const v1 = await cache.getOrFetch('k', fn);
    expect(v1).toBe(1);

    clock.advance(2_000); // fresh expirou, dentro de SWR
    const v2 = await cache.getOrFetch('k', fn);
    expect(v2).toBe(1); // stale retornado imediatamente
    expect(cache.stats().staleHits).toBe(1);

    // Aguarda o refresh completar
    await new Promise((r) => setTimeout(r, 20));

    // Próxima chamada (ainda em janela SWR) — agora o cache foi atualizado para 2
    const v3 = await cache.getOrFetch('k', fn);
    expect(v3).toBe(2);
  });

  it('múltiplas chamadas durante refresh NÃO disparam refreshes adicionais', async () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({
      defaultTtlMs: 1_000,
      staleWhileRevalidateMs: 5_000,
      now: clock.now,
    });
    let counter = 0;
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ++counter;
    });

    await cache.getOrFetch('k', fn); // count=1, cached
    clock.advance(2_000);

    // 5 chamadas durante stale → 1 refresh, 5 retornos imediatos do stale
    const promises = Array.from({ length: 5 }, () => cache.getOrFetch('k', fn));
    const results = await Promise.all(promises);
    expect(results.every((v) => v === 1)).toBe(true); // todos stale

    await new Promise((r) => setTimeout(r, 50));
    expect(fn).toHaveBeenCalledTimes(2); // 1 fetch inicial + 1 refresh
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// LRU eviction
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache — LRU eviction', () => {
  it('descarta entrada mais antiga quando size > maxSize', () => {
    const cache = new TtlCache<number>({ maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // despeja 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('get renova prioridade (move para fim da LRU)', () => {
    const cache = new TtlCache<number>({ maxSize: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // 'a' vai para o fim
    cache.set('d', 4); // 'b' deve ser despejada (agora a mais antiga)
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('getOrFetch hit também renova LRU', async () => {
    const cache = new TtlCache<number>({ maxSize: 3, defaultTtlMs: 30_000 });
    const fn = vi.fn(async () => 99);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    await cache.getOrFetch('a', fn); // hit — 'a' vai para o fim
    cache.set('d', 4); // 'b' deve ser despejada
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Manual ops
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache — manual ops', () => {
  it('get retorna null para chave inexistente', () => {
    const cache = new TtlCache<string>();
    expect(cache.get('nope')).toBeNull();
  });

  it('get retorna null para chave expirada', () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({ defaultTtlMs: 1_000, now: clock.now });
    cache.set('k', 1);
    expect(cache.get('k')).toBe(1);
    clock.advance(2_000);
    expect(cache.get('k')).toBeNull();
  });

  it('has retorna false para entrada expirada', () => {
    const clock = makeClock();
    const cache = new TtlCache<number>({ defaultTtlMs: 1_000, now: clock.now });
    cache.set('k', 1);
    expect(cache.has('k')).toBe(true);
    clock.advance(2_000);
    expect(cache.has('k')).toBe(false);
  });

  it('invalidate remove entrada específica', () => {
    const cache = new TtlCache<number>();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
  });

  it('invalidateAll limpa tudo, incluindo inFlight', async () => {
    const cache = new TtlCache<number>();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Stats + onEvict
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache — stats & onEvict', () => {
  it('conta hits/misses/evictions', async () => {
    const cache = new TtlCache<number>({ maxSize: 2 });
    const fn = vi.fn(async (key: string) => key.charCodeAt(0));
    await cache.getOrFetch('a', () => fn('a')); // miss
    await cache.getOrFetch('a', () => fn('a')); // hit
    await cache.getOrFetch('b', () => fn('b')); // miss
    await cache.getOrFetch('c', () => fn('c')); // miss + eviction de 'a'
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(3);
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
  });

  it('onEvict chamado com reason=lru', () => {
    const evicted: Array<{ key: string; value: number; reason: string }> = [];
    const cache = new TtlCache<number>({
      maxSize: 2,
      onEvict: (key, value, reason) => evicted.push({ key, value, reason }),
    });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // despeja 'a'
    expect(evicted).toContainEqual({ key: 'a', value: 1, reason: 'lru' });
  });

  it('onEvict chamado com reason=ttl quando get encontra expirada', () => {
    const clock = makeClock();
    const evicted: string[] = [];
    const cache = new TtlCache<number>({
      defaultTtlMs: 1_000,
      now: clock.now,
      onEvict: (k, _v, r) => evicted.push(`${k}:${r}`),
    });
    cache.set('k', 1);
    clock.advance(2_000);
    cache.get('k');
    expect(evicted).toContain('k:ttl');
  });

  it('onEvict chamado com reason=manual em invalidate', () => {
    const evicted: string[] = [];
    const cache = new TtlCache<number>({
      onEvict: (k, _v, r) => evicted.push(`${k}:${r}`),
    });
    cache.set('a', 1);
    cache.invalidate('a');
    expect(evicted).toContain('a:manual');
  });

  it('resetStats zera contadores', async () => {
    const cache = new TtlCache<number>();
    await cache.getOrFetch('k', async () => 1);
    await cache.getOrFetch('k', async () => 1);
    expect(cache.stats().hits).toBe(1);
    cache.resetStats();
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, staleHits: 0, evictions: 0 });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Input validation
// ────────────────────────────────────────────────────────────────────────────────

describe('TtlCache — construtor validation', () => {
  it('rejeita defaultTtlMs <= 0', () => {
    expect(() => new TtlCache<number>({ defaultTtlMs: 0 })).toThrow();
  });
  it('rejeita maxSize <= 0', () => {
    expect(() => new TtlCache<number>({ maxSize: 0 })).toThrow();
  });
  it('rejeita staleWhileRevalidateMs negativo', () => {
    expect(() => new TtlCache<number>({ staleWhileRevalidateMs: -1 })).toThrow();
  });
});
