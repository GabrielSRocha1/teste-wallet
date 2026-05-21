/**
 * metrics.ts — Primitivas de telemetria agnósticas de provedor.
 *
 * Conceitos:
 *  - Counter  : valor monotônico (apenas sobe). Ex: swap_total{outcome=success}.
 *  - Gauge    : valor atual (sobe e desce). Ex: active_swaps, open_websockets.
 *  - Histogram: distribuição de valores (rolling window). Ex: swap_latency_ms.
 *
 * Tags (labels): cada combinação de tags é uma "série" separada. Aderem ao
 * modelo do Prometheus (interop fácil futuro).
 *
 * Sinks: cada operação emite um `MetricEvent` para todos os sinks registrados.
 * Permite forward a Sentry/Datadog/Prometheus sem acoplar este módulo a SDKs.
 *
 * `trackedAsync(registry, span, fn)`: wrapper que mede latência + outcome
 *   de uma promise. Base do "transaction lifecycle tracking" da observabilidade.
 */

export type Tags = Record<string, string>;

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface MetricEvent {
  kind: MetricKind;
  /** Tipo de operação: 'inc', 'set', 'observe'. */
  op: 'inc' | 'set' | 'observe';
  name: string;
  value: number;
  tags: Tags;
  timestamp: number;
}

export interface MetricsSink {
  write(event: MetricEvent): void;
}

export class InMemoryMetricsSink implements MetricsSink {
  readonly events: MetricEvent[] = [];
  write(event: MetricEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
}

function tagsKey(tags: Tags): string {
  const keys = Object.keys(tags).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${tags[k]}`).join(',');
}

// ────────────────────────────────────────────────────────────────────────────────
// Counter
// ────────────────────────────────────────────────────────────────────────────────

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    public readonly name: string,
    private readonly emit: (op: 'inc', value: number, tags: Tags) => void,
  ) {}

  inc(tags: Tags = {}, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Counter.inc: amount deve ser ≥ 0 e finito (recebido ${amount})`);
    }
    const k = tagsKey(tags);
    this.values.set(k, (this.values.get(k) ?? 0) + amount);
    this.emit('inc', amount, tags);
  }

  get(tags: Tags = {}): number {
    return this.values.get(tagsKey(tags)) ?? 0;
  }

  /** Snapshot de todas as séries deste counter. */
  series(): Array<{ tags: Tags; value: number }> {
    return Array.from(this.values.entries()).map(([k, v]) => ({
      tags: parseTagsKey(k),
      value: v,
    }));
  }

  reset(): void {
    this.values.clear();
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Gauge
// ────────────────────────────────────────────────────────────────────────────────

export class Gauge {
  private readonly values = new Map<string, number>();

  constructor(
    public readonly name: string,
    private readonly emit: (op: 'set' | 'inc', value: number, tags: Tags) => void,
  ) {}

  set(value: number, tags: Tags = {}): void {
    if (!Number.isFinite(value)) {
      throw new Error(`Gauge.set: value deve ser finito (recebido ${value})`);
    }
    this.values.set(tagsKey(tags), value);
    this.emit('set', value, tags);
  }

  inc(tags: Tags = {}, amount = 1): void {
    if (!Number.isFinite(amount)) {
      throw new Error(`Gauge.inc: amount deve ser finito`);
    }
    const k = tagsKey(tags);
    const next = (this.values.get(k) ?? 0) + amount;
    this.values.set(k, next);
    this.emit('inc', amount, tags);
  }

  dec(tags: Tags = {}, amount = 1): void {
    this.inc(tags, -amount);
  }

  get(tags: Tags = {}): number | null {
    const k = tagsKey(tags);
    return this.values.has(k) ? this.values.get(k)! : null;
  }

  series(): Array<{ tags: Tags; value: number }> {
    return Array.from(this.values.entries()).map(([k, v]) => ({
      tags: parseTagsKey(k),
      value: v,
    }));
  }

  reset(): void {
    this.values.clear();
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Histogram
// ────────────────────────────────────────────────────────────────────────────────

export interface HistogramStats {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export class Histogram {
  private readonly samples = new Map<string, number[]>();
  private readonly windowSize: number;

  constructor(
    public readonly name: string,
    private readonly emit: (op: 'observe', value: number, tags: Tags) => void,
    opts: { windowSize?: number } = {},
  ) {
    this.windowSize = opts.windowSize ?? 1_000;
    if (this.windowSize <= 0) throw new Error('Histogram: windowSize deve ser > 0');
  }

  observe(value: number, tags: Tags = {}): void {
    if (!Number.isFinite(value)) {
      throw new Error(`Histogram.observe: value deve ser finito (recebido ${value})`);
    }
    const k = tagsKey(tags);
    let arr = this.samples.get(k);
    if (!arr) {
      arr = [];
      this.samples.set(k, arr);
    }
    arr.push(value);
    while (arr.length > this.windowSize) arr.shift();
    this.emit('observe', value, tags);
  }

  snapshot(tags: Tags = {}): HistogramStats {
    const arr = this.samples.get(tagsKey(tags));
    if (!arr || arr.length === 0) {
      return { count: 0, sum: 0, min: null, max: null, p50: null, p95: null, p99: null };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((acc, x) => acc + x, 0);
    return {
      count: arr.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }

  series(): Array<{ tags: Tags; stats: HistogramStats }> {
    return Array.from(this.samples.keys()).map((k) => ({
      tags: parseTagsKey(k),
      stats: this.snapshot(parseTagsKey(k)),
    }));
  }

  reset(): void {
    this.samples.clear();
  }
}

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
  return sortedAsc[idx];
}

function parseTagsKey(key: string): Tags {
  if (!key) return {};
  const out: Tags = {};
  for (const part of key.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────────
// MetricsRegistry
// ────────────────────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  kind: MetricKind;
  name: string;
  series: Array<{ tags: Tags; value?: number; stats?: HistogramStats }>;
}

export interface MetricsRegistryOptions {
  sinks?: MetricsSink[];
  now?: () => number;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly registeredKinds = new Map<string, MetricKind>();
  private readonly sinks: MetricsSink[];
  private readonly now: () => number;

  constructor(opts: MetricsRegistryOptions = {}) {
    this.sinks = opts.sinks ?? [];
    this.now = opts.now ?? Date.now;
  }

  private assertKind(name: string, kind: MetricKind): void {
    const existing = this.registeredKinds.get(name);
    if (existing && existing !== kind) {
      throw new Error(`Metric '${name}' já registrado como ${existing}, não pode ser ${kind}`);
    }
    this.registeredKinds.set(name, kind);
  }

  private publish(kind: MetricKind, op: MetricEvent['op'], name: string, value: number, tags: Tags): void {
    const event: MetricEvent = { kind, op, name, value, tags, timestamp: this.now() };
    for (const sink of this.sinks) {
      try {
        sink.write(event);
      } catch {
        /* sink failure não pode quebrar a operação */
      }
    }
  }

  counter(name: string): Counter {
    this.assertKind(name, 'counter');
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, (op, value, tags) => this.publish('counter', op, name, value, tags));
      this.counters.set(name, c);
    }
    return c;
  }

  gauge(name: string): Gauge {
    this.assertKind(name, 'gauge');
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, (op, value, tags) => this.publish('gauge', op, name, value, tags));
      this.gauges.set(name, g);
    }
    return g;
  }

  histogram(name: string, opts?: { windowSize?: number }): Histogram {
    this.assertKind(name, 'histogram');
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, (op, value, tags) => this.publish('histogram', op, name, value, tags), opts);
      this.histograms.set(name, h);
    }
    return h;
  }

  /** Snapshot serializável de todas as métricas (pronto para JSON). */
  exportAll(): MetricsSnapshot[] {
    const out: MetricsSnapshot[] = [];
    for (const c of this.counters.values()) {
      out.push({ kind: 'counter', name: c.name, series: c.series() });
    }
    for (const g of this.gauges.values()) {
      out.push({ kind: 'gauge', name: g.name, series: g.series() });
    }
    for (const h of this.histograms.values()) {
      out.push({
        kind: 'histogram',
        name: h.name,
        series: h.series().map((s) => ({ tags: s.tags, stats: s.stats })),
      });
    }
    return out;
  }

  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const h of this.histograms.values()) h.reset();
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// trackedAsync — lifecycle wrapper para operações assíncronas
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Mede latência de uma operação async e incrementa counters de outcome.
 *
 * Cria/usa 2 métricas:
 *   - histogram: `${spanName}.latency_ms`
 *   - counter:   `${spanName}.total` com tags {outcome: success|failure}
 *
 * Re-lança o erro original (não silencia).
 */
export async function trackedAsync<T>(
  registry: MetricsRegistry,
  spanName: string,
  fn: () => Promise<T>,
  extraTags: Tags = {},
): Promise<T> {
  const startedAt = Date.now();
  const histogram = registry.histogram(`${spanName}.latency_ms`);
  const counter = registry.counter(`${spanName}.total`);
  try {
    const result = await fn();
    histogram.observe(Date.now() - startedAt, extraTags);
    counter.inc({ ...extraTags, outcome: 'success' });
    return result;
  } catch (err) {
    histogram.observe(Date.now() - startedAt, extraTags);
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    counter.inc({ ...extraTags, outcome: 'failure', error: errorName });
    throw err;
  }
}
