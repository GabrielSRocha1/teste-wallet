/**
 * circuit-breaker.ts — Circuit breaker para upstreams (RPC, Jupiter, ...).
 *
 * Estados:
 *   CLOSED      → tudo normal
 *   OPEN        → N falhas consecutivas → fail-fast por `cooldownMs`
 *   HALF_OPEN   → após cooldown, uma sondagem decide volta para CLOSED ou OPEN
 *
 * Por upstream que rotacionamos (helius, ankr, publicnode, mainnet-beta),
 * temos um breaker independente. Quando um abre, os outros continuam servindo.
 */

import { createLogger } from './logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  rollingWindowMs?: number;
  cooldownMs?: number;
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
      /* hook should be safe */
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
    if (this.firstFailureAt && now - this.firstFailureAt > this.rollingWindowMs) {
      this.failureCount = 0;
      this.firstFailureAt = 0;
    }
    if (this.failureCount === 0) this.firstFailureAt = now;
    this.failureCount++;

    if (this._state === 'HALF_OPEN') {
      this.openedAt = now;
      this.transition('OPEN');
      return;
    }
    if (this.failureCount >= this.failureThreshold && this._state !== 'OPEN') {
      this.openedAt = now;
      this.transition('OPEN');
    }
  }

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

  reset(): void {
    this.failureCount = 0;
    this.firstFailureAt = 0;
    this.openedAt = 0;
    this.transition('CLOSED');
  }

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
