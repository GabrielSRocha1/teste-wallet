/**
 * rpc-health-checker.ts — Health check periódico de RPCs Solana com métricas
 * de latência.
 *
 * Independente do `SolanaRpcClient`: usa suas próprias connections para
 * fazer probes ativos (`getLatestBlockhash` é o canary). Pode rodar paralelo
 * sem interferir nas operações normais do client.
 *
 * Métricas por endpoint:
 *  - Latência da última probe + média móvel (rolling window).
 *  - Contadores de successes/failures consecutivos.
 *  - Timestamps da última success/failure.
 *  - Estado derivado: HEALTHY | DEGRADED | DOWN | UNKNOWN.
 *
 * Use em `/api/healthz` ou em decisões de roteamento RPC.
 */

import { createLogger } from '../_internal/logger';
import { withTimeout } from '../_internal/timeout';
import type { SolanaConnectionFactory, SolanaConnectionLike } from './solana-rpc';

const log = createLogger('RpcHealthChecker');

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface HealthSnapshot {
  endpoint: string;
  state: HealthState;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /** Quantidade de amostras na rolling window. */
  samples: number;
}

export interface RpcHealthCheckerOptions {
  endpoints: string[];
  connectionFactory: SolanaConnectionFactory;
  /** Intervalo entre rodadas. Default 30s. */
  intervalMs?: number;
  /** Timeout por probe individual. Default 5s. */
  timeoutMs?: number;
  /** Tamanho da rolling window de latências. Default 20. */
  windowSize?: number;
  /** Falhas consecutivas que marcam DOWN. Default 3. */
  downThreshold?: number;
  /** Latência média acima da qual marca DEGRADED. Default 2000ms. */
  degradedLatencyMs?: number;
  /** Callback executado após cada rodada de probes. */
  onHealthChange?: (snapshots: HealthSnapshot[]) => void;
  /** Fonte de tempo injetável. */
  now?: () => number;
}

interface InternalMetrics {
  latencies: number[];
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

const DEFAULTS = {
  intervalMs: 30_000,
  timeoutMs: 5_000,
  windowSize: 20,
  downThreshold: 3,
  degradedLatencyMs: 2_000,
} as const;

export class RpcHealthChecker {
  private readonly endpoints: string[];
  private readonly factory: SolanaConnectionFactory;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly windowSize: number;
  private readonly downThreshold: number;
  private readonly degradedLatencyMs: number;
  private readonly onHealthChange?: (snapshots: HealthSnapshot[]) => void;
  private readonly now: () => number;

  private readonly connections = new Map<string, SolanaConnectionLike>();
  private readonly metrics = new Map<string, InternalMetrics>();
  private lastSnapshots: HealthSnapshot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RpcHealthCheckerOptions) {
    if (!opts.endpoints || opts.endpoints.length === 0) {
      throw new Error('RpcHealthChecker: endpoints obrigatório (não pode ser vazio)');
    }
    this.endpoints = [...opts.endpoints];
    this.factory = opts.connectionFactory;
    this.intervalMs = opts.intervalMs ?? DEFAULTS.intervalMs;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.windowSize = opts.windowSize ?? DEFAULTS.windowSize;
    this.downThreshold = opts.downThreshold ?? DEFAULTS.downThreshold;
    this.degradedLatencyMs = opts.degradedLatencyMs ?? DEFAULTS.degradedLatencyMs;
    this.onHealthChange = opts.onHealthChange;
    this.now = opts.now ?? Date.now;

    if (this.intervalMs <= 0) throw new Error('intervalMs deve ser > 0');
    if (this.timeoutMs <= 0) throw new Error('timeoutMs deve ser > 0');
    if (this.windowSize <= 0) throw new Error('windowSize deve ser > 0');
    if (this.downThreshold <= 0) throw new Error('downThreshold deve ser > 0');

    // Inicializa metrics vazias para cada endpoint
    for (const ep of this.endpoints) {
      this.metrics.set(ep, this.emptyMetrics());
    }
  }

  private emptyMetrics(): InternalMetrics {
    return {
      latencies: [],
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
    };
  }

  private connectionFor(endpoint: string): SolanaConnectionLike {
    let conn = this.connections.get(endpoint);
    if (!conn) {
      conn = this.factory(endpoint);
      this.connections.set(endpoint, conn);
    }
    return conn;
  }

  private recordSuccess(endpoint: string, latencyMs: number): void {
    const m = this.metrics.get(endpoint) ?? this.emptyMetrics();
    m.latencies.push(latencyMs);
    while (m.latencies.length > this.windowSize) m.latencies.shift();
    m.consecutiveSuccesses += 1;
    m.consecutiveFailures = 0;
    m.lastSuccessAt = this.now();
    this.metrics.set(endpoint, m);
  }

  private recordFailure(endpoint: string): void {
    const m = this.metrics.get(endpoint) ?? this.emptyMetrics();
    m.consecutiveFailures += 1;
    m.consecutiveSuccesses = 0;
    m.lastFailureAt = this.now();
    this.metrics.set(endpoint, m);
  }

  private buildSnapshot(endpoint: string): HealthSnapshot {
    const m = this.metrics.get(endpoint) ?? this.emptyMetrics();
    const lastLatencyMs = m.latencies.length > 0 ? m.latencies[m.latencies.length - 1] : null;
    const avgLatencyMs =
      m.latencies.length > 0
        ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
        : null;

    let state: HealthState;
    if (m.consecutiveFailures >= this.downThreshold) {
      state = 'DOWN';
    } else if (m.latencies.length === 0 && m.consecutiveFailures === 0) {
      state = 'UNKNOWN';
    } else if (m.consecutiveFailures > 0) {
      state = 'DEGRADED';
    } else if (avgLatencyMs !== null && avgLatencyMs > this.degradedLatencyMs) {
      state = 'DEGRADED';
    } else {
      state = 'HEALTHY';
    }

    return {
      endpoint,
      state,
      lastLatencyMs,
      avgLatencyMs,
      consecutiveSuccesses: m.consecutiveSuccesses,
      consecutiveFailures: m.consecutiveFailures,
      lastSuccessAt: m.lastSuccessAt,
      lastFailureAt: m.lastFailureAt,
      samples: m.latencies.length,
    };
  }

  private async probe(endpoint: string): Promise<void> {
    const conn = this.connectionFor(endpoint);
    const start = this.now();
    try {
      await withTimeout(conn.getLatestBlockhash('finalized'), this.timeoutMs, `health@${endpoint}`);
      const latency = Math.max(0, this.now() - start);
      this.recordSuccess(endpoint, latency);
    } catch (err) {
      this.recordFailure(endpoint);
      log.debug('health probe failed', {
        endpoint,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Roda uma rodada de probes em todos os endpoints (em paralelo). */
  async checkOnce(): Promise<HealthSnapshot[]> {
    await Promise.all(this.endpoints.map((ep) => this.probe(ep)));
    const snapshots = this.endpoints.map((ep) => this.buildSnapshot(ep));
    this.lastSnapshots = snapshots;
    if (this.onHealthChange) {
      try {
        this.onHealthChange(snapshots);
      } catch (err) {
        log.warn('onHealthChange callback threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return snapshots;
  }

  /** Inicia o polling periódico (idempotente — safe to call multiple times). */
  start(): void {
    if (this.timer !== null) return;
    // Dispara primeira checagem imediatamente; depois mantém periodicidade
    this.checkOnce().catch(() => undefined);
    this.timer = setInterval(() => {
      this.checkOnce().catch(() => undefined);
    }, this.intervalMs);
  }

  /** Para o polling. Idempotente. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Último snapshot conhecido (sem disparar nova rodada). */
  getLatestHealth(): HealthSnapshot[] {
    return this.lastSnapshots.length > 0
      ? [...this.lastSnapshots]
      : this.endpoints.map((ep) => this.buildSnapshot(ep));
  }

  /** Apenas para testes/diagnostico: indica se o polling está ativo. */
  get isPolling(): boolean {
    return this.timer !== null;
  }
}
