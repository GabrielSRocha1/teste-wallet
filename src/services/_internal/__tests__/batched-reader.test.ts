import { describe, expect, it, vi } from 'vitest';
import { BatchedReader } from '../batched-reader';
import { clearLogSinks } from '../logger';

clearLogSinks();

// ──────────────────────────────────────────────────────────────────────────────
// Basic load + batching
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — basic', () => {
  it('load único → batch com 1 key, resolves com valor', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, k.length);
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    const result = await reader.load('hello');
    expect(result).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(['hello']);
  });

  it('5 loads concorrentes na mesma janela → 1 batch com 5 keys', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, k.length);
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    const results = await Promise.all([
      reader.load('a'),
      reader.load('bb'),
      reader.load('ccc'),
      reader.load('dddd'),
      reader.load('eeeee'),
    ]);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toHaveLength(5);
  });

  it('Dedup: 3 loads da MESMA key → batch com 1 key, 3 resolvers com mesmo valor', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, 42);
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    const results = await Promise.all([
      reader.load('same'),
      reader.load('same'),
      reader.load('same'),
    ]);
    expect(results).toEqual([42, 42, 42]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toEqual(['same']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Window expiry
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — window expiry', () => {
  it('loads em janelas DIFERENTES → batches separados', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, string>();
      for (const k of keys) m.set(k, k.toUpperCase());
      return m;
    });
    const reader = new BatchedReader<string, string>({
      batchFetcher: fetcher,
      windowMs: 5,
    });

    const r1 = await reader.load('a');
    expect(r1).toBe('A');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Janela já expirou — next load começa novo batch
    const r2 = await reader.load('b');
    expect(r2).toBe('B');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// maxBatchSize
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — maxBatchSize', () => {
  it('splita batch grande em chunks paralelos', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, parseInt(k, 10));
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
      maxBatchSize: 2,
    });
    const promises = ['1', '2', '3', '4', '5'].map((k) => reader.load(k));
    const results = await Promise.all(promises);
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(fetcher).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(fetcher.mock.calls[0][0]).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toHaveLength(2);
    expect(fetcher.mock.calls[2][0]).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Missing keys → undefined
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — missing keys', () => {
  it('key ausente no result Map → resolve com undefined', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      // só responde 'a', omite 'b'
      for (const k of keys) {
        if (k === 'a') m.set(k, 1);
      }
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    const [a, b] = await Promise.all([reader.load('a'), reader.load('b')]);
    expect(a).toBe(1);
    expect(b).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — errors', () => {
  it('batchFetcher que lança rejeita TODOS os resolvers do batch', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    const promises = ['a', 'b', 'c'].map((k) => reader.load(k));
    const results = await Promise.allSettled(promises);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('erro em UM chunk não afeta o OUTRO chunk paralelo', async () => {
    let callCount = 0;
    const fetcher = vi.fn(async (keys: string[]) => {
      callCount++;
      if (callCount === 1) throw new Error('1st chunk failed');
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, 99);
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
      maxBatchSize: 1,
    });
    const results = await Promise.allSettled([reader.load('a'), reader.load('b')]);
    // Pelo menos UM falha e UM passa (ordem indefinida sob paralelismo)
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// flush()
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — flush', () => {
  it('flush() dispara imediatamente, sem esperar a janela', async () => {
    const fetcher = vi.fn(async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, 1);
      return m;
    });
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 10_000, // janela muito longa
    });
    const promise = reader.load('a');
    await reader.flush();
    expect(await promise).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('flush sem loads pendentes é no-op (não chama fetcher)', async () => {
    const fetcher = vi.fn();
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
    });
    await reader.flush();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Complex keys com keyFn
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — keys complexas (objects)', () => {
  it('keyFn customizado deduplica objetos por identidade lógica', async () => {
    interface Req {
      addr: string;
      mint: string;
    }
    const fetcher = vi.fn(async (keys: Req[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(`${k.addr}:${k.mint}`, 100);
      return m;
    });
    const reader = new BatchedReader<Req, number>({
      batchFetcher: fetcher,
      windowMs: 5,
      keyFn: (r) => `${r.addr}:${r.mint}`,
    });
    const results = await Promise.all([
      reader.load({ addr: 'A', mint: 'X' }),
      reader.load({ addr: 'A', mint: 'X' }), // mesma identidade lógica
      reader.load({ addr: 'A', mint: 'Y' }),
    ]);
    expect(results).toEqual([100, 100, 100]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toHaveLength(2); // dedup: 2 keys únicas
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — stats', () => {
  it('rastreia loads, batches, maxBatchObserved', async () => {
    const fetcher = async (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, 1);
      return m;
    };
    const reader = new BatchedReader<string, number>({
      batchFetcher: fetcher,
      windowMs: 5,
      maxBatchSize: 2,
    });
    await Promise.all(['a', 'b', 'c'].map((k) => reader.load(k)));
    const s = reader.stats();
    expect(s.loads).toBe(3);
    expect(s.batches).toBe(2); // [a,b] e [c]
    expect(s.maxBatchObserved).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Validação
// ──────────────────────────────────────────────────────────────────────────────

describe('BatchedReader — validação', () => {
  it('construtor rejeita maxBatchSize <= 0', () => {
    expect(
      () =>
        new BatchedReader<string, number>({
          batchFetcher: async () => new Map(),
          maxBatchSize: 0,
        }),
    ).toThrow();
  });

  it('construtor rejeita windowMs < 0', () => {
    expect(
      () =>
        new BatchedReader<string, number>({
          batchFetcher: async () => new Map(),
          windowMs: -1,
        }),
    ).toThrow();
  });
});
