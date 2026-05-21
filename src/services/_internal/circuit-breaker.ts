/**
 * circuit-breaker.ts — Circuit breaker clássico para proteger upstreams.
 *
 * Estados:
 *  - CLOSED  : tudo normal, requests passam.
 *  - OPEN    : N falhas consecutivas dentro da janela → todas requests retornam fast-fail.
 *  - HALF_OPEN : após cooldown, deixa UMA request "tentar de novo" para sondar saúde.
 *
 * Uso:
 *   const cb = new CircuitBreaker({ name: 'helius-rpc', failureThreshold: 5, cooldownMs: 30_000 });
 *   await cb.execute(() => fetch(...));
 *
 *   // Em qualquer ponto:
 *   if (cb.state === 'OPEN') log.warn('helius down — using fallback');
 */

import { createLogger } from './logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Identificador legível (helius-rpc, raydium, jupiter, ...). */
  name: string;
  /** Quantas falhas consecutivas abrem o circuito. */
  failureThreshold?: number;
  /** Janela em ms para contar falhas; reset se passar muito tempo sem falha. */
  rollingWindowMs?: number;
  /** Tempo que o circuito fica OPEN antes de tentar HALF_OPEN. */
  cooldownMs?: number;
  /** Hook para emitir métricas/logs em transição de estado. */
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

export class CircuitOpenError extends Error {
  constructor(public readonly name_: string, public readonly cooldownRemainingMs: number) {
    super(`Circuit '${name_}' está OPEN (cooldown: ${cooldownRemainingMs}ms)`);
    this.name = 'CircuitOpenError';
  }
}

const log = createLogger('CircuitBreaker');

export class CircuitBreaker {
  private failureCount = 0;
  private firstFailureAt = 0;
  private openedAt = 0;
  private _state: CircuitState = 'CLOSED';

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly rollingWindowMs: number;
  private readonly cooldownMs: number;
  private readonly onStateChange?: CircuitBreakerOptions['onStateChange'];

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.rollingWindowMs = opts.rollingWindowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.onStateChange = opts.onStateChange;
  }

  get state(): CircuitState {
    // Auto-transição OPEN → HALF_OPEN após cooldown
    if (this._state === 'OPEN' && Date.now() - this.openedAt >= this.cooldownMs) {
      this.transition('HALF_OPEN');
    }
    return this._state;
  }

  private transition(next: CircuitState): void {
    if (this._state === next) return;
    const prev = this._state;
    this._state = next;
    log.info('circuit transition', { circuit: this.name, from: prev, to: next });
    try {
      this.onStateChange?.(prev, next, this.name);
    } catch {
      /* hook deve ser inofensivo */
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.firstFailureAt = 0;
    if (this._state !== 'CLOSED') {
      this.transition('CLOSED');
    }
  }

  private recordFailure(): void {
    const now = Date.now();

    // Reset contador se a janela expirou
    if (this.firstFailureAt && now - this.firstFailureAt > this.rollingWindowMs) {
      this.failureCount = 0;
      this.firstFailureAt = 0;
    }

    if (this.failureCount === 0) {
      this.firstFailureAt = now;
    }
    this.failureCount++;

    if (this._state === 'HALF_OPEN') {
      // Falhou na sondagem → volta para OPEN com novo cooldown
      this.openedAt = now;
      this.transition('OPEN');
      return;
    }

    if (this.failureCount >= this.failureThreshold && this._state !== 'OPEN') {
      this.openedAt = now;
      this.transition('OPEN');
    }
  }

  /** Executa fn() respeitando o circuito. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.state;
    if (s === 'OPEN') {
      const remaining = Math.max(0, this.cooldownMs - (Date.now() - this.openedAt));
      throw new CircuitOpenError(this.name, remaining);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** Força reset (útil em testes ou após intervenção manual). */
  reset(): void {
    this.failureCount = 0;
    this.firstFailureAt = 0;
    this.openedAt = 0;
    this.transition('CLOSED');
  }

  /** Snapshot para métricas/health checks. */
  snapshot(): { name: string; state: CircuitState; failures: number; cooldownRemainingMs: number } {
    const state = this.state;
    return {
      name: this.name,
      state,
      failures: this.failureCount,
      cooldownRemainingMs:
        state === 'OPEN' ? Math.max(0, this.cooldownMs - (Date.now() - this.openedAt)) : 0,
    };
  }
}
