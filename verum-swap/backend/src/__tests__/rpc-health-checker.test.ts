import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLogLevel } from '../_internal/logger';
import {
  type HealthSnapshot,
  RpcHealthChecker,
} from '../adapters/rpc-health-checker';
import type { SolanaConnectionLike, Commitment } from '../adapters/solana-rpc';

setLogLevel('fatal');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeFakeConnection(
  endpoint: string,
  behavior: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>,
): SolanaConnectionLike {
  return {
    rpcEndpoint: endpoint,
    getLatestBlockhash: vi.fn(behavior),
    simulateTransaction: vi.fn(),
    sendRawTransaction: vi.fn(),
    getSignatureStatuses: vi.fn(),
    getBalance: vi.fn(),
  } as unknown as SolanaConnectionLike;
}

function happyConnection(endpoint: string): SolanaConnectionLike {
  return makeFakeConnection(endpoint, async () => ({
    blockhash: 'bh',
    lastValidBlockHeight: 1,
  }));
}

function failingConnection(endpoint: string, error = 'HTTP 503'): SolanaConnectionLike {
  return makeFakeConnection(endpoint, async () => {
    throw new Error(error);
  });
}

interface InjectableClock {
  now: () => number;
  advance: (ms: number) => void;
}

function makeClock(start = 1_000_000): InjectableClock {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// checkOnce
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker.checkOnce — happy path', () => {
  it('todos endpoints retornam HEALTHY após primeiro probe bem-sucedido', async () => {
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example', 'https://b.example'],
      connectionFactory: (ep) => happyConnection(ep),
    });
    const snapshots = await checker.checkOnce();
    expect(snapshots).toHaveLength(2);
    for (const s of snapshots) {
      expect(s.state).toBe('HEALTHY');
      expect(s.consecutiveSuccesses).toBe(1);
      expect(s.consecutiveFailures).toBe(0);
      expect(s.lastLatencyMs).not.toBeNull();
    }
  });

  it('mede latência via now() injetado (determinístico)', async () => {
    const clock = makeClock(1000);
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: () =>
        makeFakeConnection('https://a.example', async () => {
          clock.advance(150); // simula 150ms de latência durante o probe
          return { blockhash: 'bh', lastValidBlockHeight: 1 };
        }),
      now: clock.now,
    });
    const [snap] = await checker.checkOnce();
    expect(snap.lastLatencyMs).toBe(150);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Failures + state transitions
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — state transitions', () => {
  it('marca DOWN após downThreshold falhas consecutivas', async () => {
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: (ep) => failingConnection(ep),
      downThreshold: 3,
      timeoutMs: 100,
    });
    await checker.checkOnce();
    expect((await checker.checkOnce())[0].state).toBe('DEGRADED');
    await checker.checkOnce();
    const snap3 = await checker.checkOnce();
    expect(snap3[0].state).toBe('DOWN');
    expect(snap3[0].consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  it('marca DEGRADED após 1 falha (consecutiveFailures > 0)', async () => {
    let firstCall = true;
    const conn = makeFakeConnection('https://a.example', async () => {
      if (firstCall) {
        firstCall = false;
        return { blockhash: 'bh', lastValidBlockHeight: 1 };
      }
      throw new Error('HTTP 503');
    });
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: () => conn,
      downThreshold: 5,
      timeoutMs: 100,
    });
    await checker.checkOnce(); // success → HEALTHY
    const snap = await checker.checkOnce(); // failure → DEGRADED
    expect(snap[0].state).toBe('DEGRADED');
  });

  it('marca DEGRADED quando latência média > threshold', async () => {
    const clock = makeClock();
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: () =>
        makeFakeConnection('https://a.example', async () => {
          clock.advance(3_000); // 3s — acima do threshold padrão
          return { blockhash: 'bh', lastValidBlockHeight: 1 };
        }),
      now: clock.now,
      degradedLatencyMs: 2_000,
    });
    const [snap] = await checker.checkOnce();
    expect(snap.state).toBe('DEGRADED');
    expect(snap.avgLatencyMs).toBeGreaterThan(2_000);
  });

  it('volta a HEALTHY após sucessos consecutivos pós-falha', async () => {
    let failNext = true;
    const conn = makeFakeConnection('https://a.example', async () => {
      if (failNext) {
        failNext = false;
        throw new Error('HTTP 503');
      }
      return { blockhash: 'bh', lastValidBlockHeight: 1 };
    });
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: () => conn,
      downThreshold: 5,
      timeoutMs: 100,
    });
    await checker.checkOnce(); // fail → DEGRADED
    expect((await checker.checkOnce())[0].state).toBe('HEALTHY'); // success → HEALTHY
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Rolling window + avg latency
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — rolling window', () => {
  it('descarta amostras mais antigas além de windowSize', async () => {
    const clock = makeClock();
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: () =>
        makeFakeConnection('https://a.example', async () => {
          clock.advance(100);
          return { blockhash: 'bh', lastValidBlockHeight: 1 };
        }),
      now: clock.now,
      windowSize: 3,
    });
    for (let i = 0; i < 5; i++) await checker.checkOnce();
    const snap = checker.getLatestHealth()[0];
    expect(snap.samples).toBe(3); // window cap
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Callbacks
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — onHealthChange callback', () => {
  it('é invocado após cada checkOnce com snapshots', async () => {
    const callback = vi.fn();
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example', 'https://b.example'],
      connectionFactory: (ep) => happyConnection(ep),
      onHealthChange: callback,
    });
    await checker.checkOnce();
    expect(callback).toHaveBeenCalledTimes(1);
    const [snapshots] = callback.mock.calls[0] as [HealthSnapshot[]];
    expect(snapshots).toHaveLength(2);
  });

  it('exceção no callback NÃO quebra checkOnce', async () => {
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: (ep) => happyConnection(ep),
      onHealthChange: () => {
        throw new Error('boom');
      },
    });
    const snapshots = await checker.checkOnce();
    expect(snapshots[0].state).toBe('HEALTHY');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// start / stop
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() inicia polling; stop() para; idempotente', async () => {
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: (ep) => happyConnection(ep),
      intervalMs: 1_000,
    });
    expect(checker.isPolling).toBe(false);

    checker.start();
    expect(checker.isPolling).toBe(true);

    // start() 2ª vez NÃO cria 2 timers
    checker.start();
    expect(checker.isPolling).toBe(true);

    checker.stop();
    expect(checker.isPolling).toBe(false);

    checker.stop(); // idempotente
    expect(checker.isPolling).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getLatestHealth
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — getLatestHealth', () => {
  it('retorna snapshots UNKNOWN antes de qualquer probe', () => {
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example', 'https://b.example'],
      connectionFactory: (ep) => happyConnection(ep),
    });
    const snapshots = checker.getLatestHealth();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((s) => s.state === 'UNKNOWN')).toBe(true);
  });

  it('retorna último snapshot sem disparar novo probe', async () => {
    const factory = vi.fn((ep: string) => happyConnection(ep));
    const checker = new RpcHealthChecker({
      endpoints: ['https://a.example'],
      connectionFactory: factory as (ep: string) => SolanaConnectionLike,
    });
    await checker.checkOnce();
    const callsAfterFirst = factory.mock.calls.length;

    checker.getLatestHealth();
    expect(factory.mock.calls.length).toBe(callsAfterFirst); // nenhum probe novo
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Input validation
// ──────────────────────────────────────────────────────────────────────────────

describe('RpcHealthChecker — input validation', () => {
  it('rejeita endpoints vazio', () => {
    expect(
      () =>
        new RpcHealthChecker({
          endpoints: [],
          connectionFactory: (ep) => happyConnection(ep),
        }),
    ).toThrow(/endpoints/);
  });

  it('rejeita config inválida (intervalMs <= 0)', () => {
    expect(
      () =>
        new RpcHealthChecker({
          endpoints: ['https://a.example'],
          connectionFactory: (ep) => happyConnection(ep),
          intervalMs: 0,
        }),
    ).toThrow();
  });
});
