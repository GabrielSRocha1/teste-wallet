import { describe, expect, it } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  InMemoryMetricsSink,
  MetricsRegistry,
  trackedAsync,
} from '../metrics';

// ──────────────────────────────────────────────────────────────────────────────
// Counter
// ──────────────────────────────────────────────────────────────────────────────

describe('Counter', () => {
  it('inc soma valores; get retorna acumulado', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('swap_total');
    c.inc();
    c.inc();
    c.inc({}, 5);
    expect(c.get()).toBe(7);
  });

  it('séries por tag são isoladas', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('swap_total');
    c.inc({ outcome: 'success' });
    c.inc({ outcome: 'success' });
    c.inc({ outcome: 'failure' });
    expect(c.get({ outcome: 'success' })).toBe(2);
    expect(c.get({ outcome: 'failure' })).toBe(1);
    expect(c.get({ outcome: 'unknown' })).toBe(0);
  });

  it('rejeita amount negativo (monotônico)', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('x');
    expect(() => c.inc({}, -1)).toThrow();
    expect(() => c.inc({}, Number.NaN)).toThrow();
  });

  it('series() retorna snapshot de todas as séries', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('x');
    c.inc({ a: '1' });
    c.inc({ a: '2' }, 3);
    const series = c.series();
    expect(series).toHaveLength(2);
    expect(series.find((s) => s.tags.a === '2')?.value).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Gauge
// ──────────────────────────────────────────────────────────────────────────────

describe('Gauge', () => {
  it('set/get reflete valor atual', () => {
    const reg = new MetricsRegistry();
    const g = reg.gauge('active');
    expect(g.get()).toBeNull();
    g.set(5);
    expect(g.get()).toBe(5);
    g.set(8);
    expect(g.get()).toBe(8);
  });

  it('inc/dec ajustam valor atual', () => {
    const reg = new MetricsRegistry();
    const g = reg.gauge('active');
    g.set(10);
    g.inc();
    expect(g.get()).toBe(11);
    g.inc({}, 4);
    expect(g.get()).toBe(15);
    g.dec();
    expect(g.get()).toBe(14);
    g.dec({}, 3);
    expect(g.get()).toBe(11);
  });

  it('séries por tag', () => {
    const reg = new MetricsRegistry();
    const g = reg.gauge('queue_size');
    g.set(3, { type: 'broadcast' });
    g.set(7, { type: 'confirm' });
    expect(g.get({ type: 'broadcast' })).toBe(3);
    expect(g.get({ type: 'confirm' })).toBe(7);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Histogram
// ──────────────────────────────────────────────────────────────────────────────

describe('Histogram', () => {
  it('snapshot retorna stats corretos para distribuição conhecida', () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('latency');
    for (const v of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) h.observe(v);
    const s = h.snapshot();
    expect(s.count).toBe(10);
    expect(s.sum).toBe(550);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(60); // index 5 do array ordenado
    expect(s.p95).toBe(100);
    expect(s.p99).toBe(100);
  });

  it('histogram vazio retorna nulls', () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('empty');
    const s = h.snapshot();
    expect(s.count).toBe(0);
    expect(s.sum).toBe(0);
    expect(s.min).toBeNull();
    expect(s.p95).toBeNull();
  });

  it('rolling window descarta amostras antigas além de windowSize', () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('rolling', { windowSize: 3 });
    h.observe(1);
    h.observe(2);
    h.observe(3);
    h.observe(4);
    h.observe(5);
    const s = h.snapshot();
    expect(s.count).toBe(3); // window de 3
    expect(s.min).toBe(3); // antigos 1, 2 foram descartados
    expect(s.max).toBe(5);
  });

  it('rejeita valores não-finitos', () => {
    const reg = new MetricsRegistry();
    const h = reg.histogram('x');
    expect(() => h.observe(Number.NaN)).toThrow();
    expect(() => h.observe(Number.POSITIVE_INFINITY)).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Registry — identity & type conflicts
// ──────────────────────────────────────────────────────────────────────────────

describe('MetricsRegistry — identity & type conflicts', () => {
  it('counter("x") + counter("x") retornam mesma instância', () => {
    const reg = new MetricsRegistry();
    const c1 = reg.counter('x');
    const c2 = reg.counter('x');
    expect(c1).toBe(c2);
  });

  it('registrar mesmo nome com tipo conflitante lança', () => {
    const reg = new MetricsRegistry();
    reg.counter('x');
    expect(() => reg.gauge('x')).toThrow(/já registrado/);
    expect(() => reg.histogram('x')).toThrow(/já registrado/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Sinks
// ──────────────────────────────────────────────────────────────────────────────

describe('MetricsRegistry — sinks', () => {
  it('emite MetricEvent em cada operação para todos os sinks', () => {
    const sink = new InMemoryMetricsSink();
    const reg = new MetricsRegistry({ sinks: [sink] });
    reg.counter('a').inc({}, 2);
    reg.gauge('b').set(5);
    reg.histogram('c').observe(100);
    expect(sink.events).toHaveLength(3);
    expect(sink.events[0]).toMatchObject({ kind: 'counter', op: 'inc', name: 'a', value: 2 });
    expect(sink.events[1]).toMatchObject({ kind: 'gauge', op: 'set', name: 'b', value: 5 });
    expect(sink.events[2]).toMatchObject({ kind: 'histogram', op: 'observe', name: 'c', value: 100 });
  });

  it('exceção em sink NÃO quebra operação nem outros sinks', () => {
    const goodSink = new InMemoryMetricsSink();
    const badSink: { write: () => void } = {
      write() {
        throw new Error('sink falhou');
      },
    };
    const reg = new MetricsRegistry({ sinks: [badSink, goodSink] });
    expect(() => reg.counter('x').inc()).not.toThrow();
    expect(goodSink.events).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// exportAll & reset
// ──────────────────────────────────────────────────────────────────────────────

describe('MetricsRegistry — exportAll & reset', () => {
  it('exportAll retorna snapshots de todas as métricas', () => {
    const reg = new MetricsRegistry();
    reg.counter('a').inc({ tag: 'x' });
    reg.gauge('b').set(5);
    reg.histogram('c').observe(100);
    const snapshots = reg.exportAll();
    expect(snapshots).toHaveLength(3);
    const a = snapshots.find((s) => s.name === 'a')!;
    expect(a.kind).toBe('counter');
    expect(a.series[0].value).toBe(1);
    const c = snapshots.find((s) => s.name === 'c')!;
    expect(c.kind).toBe('histogram');
    expect(c.series[0].stats?.count).toBe(1);
  });

  it('reset limpa estado interno', () => {
    const reg = new MetricsRegistry();
    reg.counter('a').inc();
    reg.gauge('b').set(5);
    reg.histogram('c').observe(100);
    reg.reset();
    expect(reg.counter('a').get()).toBe(0);
    expect(reg.gauge('b').get()).toBeNull();
    expect(reg.histogram('c').snapshot().count).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// trackedAsync
// ──────────────────────────────────────────────────────────────────────────────

describe('trackedAsync', () => {
  it('sucesso: observa latência e incrementa counter com outcome=success', async () => {
    const reg = new MetricsRegistry();
    const result = await trackedAsync(reg, 'swap', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 42;
    });
    expect(result).toBe(42);
    const c = reg.counter('swap.total');
    expect(c.get({ outcome: 'success' })).toBe(1);
    expect(c.get({ outcome: 'failure' })).toBe(0);
    const stats = reg.histogram('swap.latency_ms').snapshot();
    expect(stats.count).toBe(1);
    expect(stats.min).not.toBeNull();
    expect(stats.min!).toBeGreaterThanOrEqual(0);
  });

  it('falha: observa latência, incrementa counter com outcome=failure + nome do erro, re-lança', async () => {
    class CustomError extends Error {
      constructor() {
        super('boom');
        this.name = 'CustomError';
      }
    }
    const reg = new MetricsRegistry();
    await expect(
      trackedAsync(reg, 'swap', async () => {
        throw new CustomError();
      }),
    ).rejects.toBeInstanceOf(CustomError);
    const c = reg.counter('swap.total');
    expect(c.get({ outcome: 'failure', error: 'CustomError' })).toBe(1);
    expect(c.get({ outcome: 'success' })).toBe(0);
    expect(reg.histogram('swap.latency_ms').snapshot().count).toBe(1);
  });

  it('extraTags se propagam para métricas', async () => {
    const reg = new MetricsRegistry();
    await trackedAsync(reg, 'rpc', async () => 1, { endpoint: 'helius' });
    const c = reg.counter('rpc.total');
    expect(c.get({ endpoint: 'helius', outcome: 'success' })).toBe(1);
  });
});
