import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogSinks } from '../logger';
import type { LogEntry } from '../logger';
import type { MetricEvent } from '../metrics';
import {
  NoopSentryClient,
  SentryLogSink,
  SentryMetricsSink,
  type SentryLikeClient,
} from '../sentry-adapter';

clearLogSinks();

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────

function makeMockSentry(): SentryLikeClient & {
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
  addBreadcrumb: ReturnType<typeof vi.fn>;
} {
  return {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    addBreadcrumb: vi.fn(),
  };
}

function makeMetricEvent(overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    kind: 'counter',
    op: 'inc',
    name: 'test_metric',
    value: 1,
    tags: {},
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: 'info',
    component: 'TestComponent',
    message: 'test message',
    fields: {},
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// SentryMetricsSink
// ────────────────────────────────────────────────────────────────────────────────

describe('SentryMetricsSink', () => {
  let client: ReturnType<typeof makeMockSentry>;
  let sink: SentryMetricsSink;

  beforeEach(() => {
    client = makeMockSentry();
    sink = new SentryMetricsSink(client);
  });

  it('counter com outcome=failure → captureMessage(error) com tags', () => {
    sink.write(
      makeMetricEvent({
        kind: 'counter',
        name: 'swap.broadcast.total',
        tags: { outcome: 'failure', error: 'TimeoutError' },
      }),
    );
    expect(client.captureMessage).toHaveBeenCalledTimes(1);
    expect(client.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('swap.broadcast.total'),
      'error',
      expect.objectContaining({
        tags: { outcome: 'failure', error: 'TimeoutError' },
      }),
    );
    expect(client.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('counter com outcome=success → breadcrumb (não alerta)', () => {
    sink.write(
      makeMetricEvent({
        kind: 'counter',
        name: 'swap.broadcast.total',
        tags: { outcome: 'success' },
      }),
    );
    expect(client.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(client.captureMessage).not.toHaveBeenCalled();
  });

  it('gauge event → breadcrumb', () => {
    sink.write(makeMetricEvent({ kind: 'gauge', op: 'set', name: 'active', value: 5 }));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'metrics',
        message: expect.stringContaining('active'),
      }),
    );
    expect(client.captureMessage).not.toHaveBeenCalled();
  });

  it('histogram event → breadcrumb', () => {
    sink.write(makeMetricEvent({ kind: 'histogram', op: 'observe', name: 'latency', value: 123 }));
    expect(client.addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('alertOnTag customizado funciona', () => {
    const customSink = new SentryMetricsSink(client, {
      alertOnTag: { name: 'severity', value: 'critical' },
    });
    customSink.write(
      makeMetricEvent({
        kind: 'counter',
        tags: { severity: 'critical' },
      }),
    );
    expect(client.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('client que lança em captureMessage NÃO quebra o sink', () => {
    client.captureMessage.mockImplementation(() => {
      throw new Error('sentry down');
    });
    expect(() =>
      sink.write(makeMetricEvent({ kind: 'counter', tags: { outcome: 'failure' } })),
    ).not.toThrow();
  });

  it('client que lança em addBreadcrumb NÃO quebra o sink', () => {
    client.addBreadcrumb.mockImplementation(() => {
      throw new Error('sentry down');
    });
    expect(() => sink.write(makeMetricEvent({ kind: 'gauge', op: 'set' }))).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// SentryLogSink
// ────────────────────────────────────────────────────────────────────────────────

describe('SentryLogSink', () => {
  let client: ReturnType<typeof makeMockSentry>;
  let sink: SentryLogSink;

  beforeEach(() => {
    client = makeMockSentry();
    sink = new SentryLogSink(client);
  });

  it('error com error obj → captureException com stack, tags, extra', () => {
    sink.write(
      makeLogEntry({
        level: 'error',
        component: 'Pipeline',
        message: 'swap failed',
        fields: { idemKey: 'k-1', userId: 'u-1' },
        error: { name: 'TimeoutError', message: 'op excedeu', stack: 'mock stack' },
      }),
    );
    expect(client.captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = client.captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('TimeoutError');
    expect((err as Error).message).toBe('op excedeu');
    expect(ctx).toEqual(
      expect.objectContaining({
        level: 'error',
        tags: { component: 'Pipeline', level: 'error' },
        extra: expect.objectContaining({ idemKey: 'k-1', userId: 'u-1' }),
      }),
    );
  });

  it('error sem error obj → captureMessage', () => {
    sink.write(makeLogEntry({ level: 'error', message: 'something went wrong', error: undefined }));
    expect(client.captureMessage).toHaveBeenCalledTimes(1);
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('fatal → mapeado para level=fatal', () => {
    sink.write(makeLogEntry({ level: 'fatal', error: { name: 'X', message: 'y' } }));
    const ctx = client.captureException.mock.calls[0][1] as { level: string };
    expect(ctx.level).toBe('fatal');
  });

  it('warn → breadcrumb com level=warning', () => {
    sink.write(makeLogEntry({ level: 'warn', message: 'slow rpc' }));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', message: 'slow rpc' }),
    );
    expect(client.captureMessage).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('info → breadcrumb com level=info', () => {
    sink.write(makeLogEntry({ level: 'info', message: 'op done' }));
    expect(client.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info' }),
    );
  });

  it('client que lança em captureException NÃO quebra o sink', () => {
    client.captureException.mockImplementation(() => {
      throw new Error('sentry down');
    });
    expect(() =>
      sink.write(makeLogEntry({ level: 'error', error: { name: 'E', message: 'm' } })),
    ).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// NoopSentryClient
// ────────────────────────────────────────────────────────────────────────────────

describe('NoopSentryClient', () => {
  it('todos os métodos retornam sem efeitos visíveis', () => {
    const c = new NoopSentryClient();
    expect(() => c.captureException(new Error('x'))).not.toThrow();
    expect(() => c.captureMessage('hi', 'info')).not.toThrow();
    expect(() => c.addBreadcrumb({ category: 'x', message: 'y' })).not.toThrow();
  });
});
