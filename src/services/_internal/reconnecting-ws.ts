/**
 * reconnecting-ws.ts — WebSocket com reconexão automática, replay de
 * subscriptions e backoff exponencial.
 *
 * Cenário Solana: `useRealtimeBalances` se inscreve em `accountSubscribe`
 * para receber updates em tempo real. Hoje (PROBLEMA #209) se a conexão cai,
 * o subscribe é perdido em silêncio e o saldo congela até o health check
 * notar (até 60s depois).
 *
 * Esta primitiva resolve isso:
 *   - Reconnect automático em close não-explícito (backoff exponencial + jitter).
 *   - Subscriptions são re-enviadas em todo (re)open.
 *   - send() antes de conectar enfileira; flush no onopen.
 *   - Heartbeat opcional detecta socket "vivo mas surdo".
 *   - State machine exposto via `getState()` + `onStateChange` callback.
 *
 * Plug-in opt-in: NÃO toca `useRealtimeBalances`. Wiring é trabalho separado.
 */

import { createLogger } from './logger';

const log = createLogger('ReconnectingWS');

export type WebSocketState =
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'CLOSED'
  | 'FAILED';

const READY_OPEN = 1;
const READY_CLOSED = 3;

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ReconnectingWebSocketOptions {
  url: string;
  webSocketFactory: WebSocketFactory;
  /** Delay inicial entre reconnects. Default 500ms. */
  initialBackoffMs?: number;
  /** Cap superior do backoff. Default 30s. */
  maxBackoffMs?: number;
  /** Jitter relativo aplicado ao backoff (0..1). Default 0.3 = ±30%. */
  backoffJitter?: number;
  /** Máximo de tentativas. 0 = infinito (default). */
  maxAttempts?: number;
  /** Intervalo de heartbeat em ms. 0 = desligado (default). */
  heartbeatIntervalMs?: number;
  /** Payload de heartbeat (string ou função que retorna string). */
  heartbeatMessage?: string | (() => string);
  /** Callback de mensagem recebida. */
  onMessage?: (data: unknown) => void;
  /** Callback quando conecta (após open). */
  onOpen?: () => void;
  /** Callback quando socket fecha (antes de decidir reconnect). */
  onClose?: (code: number, reason: string) => void;
  /** Callback de erro. */
  onError?: (err: unknown) => void;
  /** Callback em qualquer transição de estado. */
  onStateChange?: (next: WebSocketState, prev: WebSocketState) => void;
}

const DEFAULTS = {
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
  backoffJitter: 0.3,
  maxAttempts: 0, // infinito
  heartbeatIntervalMs: 0,
} as const;

export class ReconnectingWebSocket {
  private state: WebSocketState = 'IDLE';
  private ws: WebSocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions: string[] = [];
  private readonly sendQueue: string[] = [];
  private explicitlyClosed = false;

  private readonly url: string;
  private readonly factory: WebSocketFactory;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffJitter: number;
  private readonly maxAttempts: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMessage?: string | (() => string);
  private readonly onMessage?: (data: unknown) => void;
  private readonly onOpenCb?: () => void;
  private readonly onCloseCb?: (code: number, reason: string) => void;
  private readonly onErrorCb?: (err: unknown) => void;
  private readonly onStateChangeCb?: (next: WebSocketState, prev: WebSocketState) => void;

  constructor(opts: ReconnectingWebSocketOptions) {
    if (!opts.url) throw new Error('ReconnectingWebSocket: url obrigatório');
    if (typeof opts.webSocketFactory !== 'function') {
      throw new Error('ReconnectingWebSocket: webSocketFactory obrigatório');
    }
    this.url = opts.url;
    this.factory = opts.webSocketFactory;
    this.initialBackoffMs = opts.initialBackoffMs ?? DEFAULTS.initialBackoffMs;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
    this.backoffJitter = opts.backoffJitter ?? DEFAULTS.backoffJitter;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
    this.heartbeatMessage = opts.heartbeatMessage;
    this.onMessage = opts.onMessage;
    this.onOpenCb = opts.onOpen;
    this.onCloseCb = opts.onClose;
    this.onErrorCb = opts.onError;
    this.onStateChangeCb = opts.onStateChange;

    if (this.initialBackoffMs <= 0) throw new Error('initialBackoffMs deve ser > 0');
    if (this.maxBackoffMs < this.initialBackoffMs) {
      throw new Error('maxBackoffMs deve ser ≥ initialBackoffMs');
    }
    if (this.backoffJitter < 0 || this.backoffJitter > 1) {
      throw new Error('backoffJitter deve estar em [0, 1]');
    }
    if (this.maxAttempts < 0) throw new Error('maxAttempts deve ser ≥ 0');
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  connect(): void {
    if (this.state === 'CONNECTED' || this.state === 'CONNECTING') return;
    this.explicitlyClosed = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  close(code = 1000, reason = 'closed by client'): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws && this.ws.readyState !== READY_CLOSED) {
      try {
        this.ws.close(code, reason);
      } catch {
        /* swallow — socket might already be closing */
      }
    }
    this.ws = null;
    this.transitionTo('CLOSED');
  }

  send(data: string): void {
    if (
      this.ws &&
      this.state === 'CONNECTED' &&
      this.ws.readyState === READY_OPEN
    ) {
      this.sendRaw(data);
    } else {
      this.sendQueue.push(data);
    }
  }

  addSubscription(message: string): void {
    if (this.subscriptions.includes(message)) return; // já registrada, não duplica
    this.subscriptions.push(message);
    if (this.state === 'CONNECTED' && this.ws?.readyState === READY_OPEN) {
      this.sendRaw(message);
    }
  }

  removeSubscription(message: string): void {
    const idx = this.subscriptions.indexOf(message);
    if (idx >= 0) this.subscriptions.splice(idx, 1);
  }

  getState(): WebSocketState {
    return this.state;
  }

  get currentReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private openSocket(): void {
    this.transitionTo('CONNECTING');
    let ws: WebSocketLike;
    try {
      ws = this.factory(this.url);
    } catch (err) {
      this.onErrorCb?.(err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.handleOpen();
    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onclose = (event) => this.handleClose(event.code, event.reason);
    ws.onerror = (err) => this.handleError(err);
  }

  private handleOpen(): void {
    this.reconnectAttempt = 0;
    this.transitionTo('CONNECTED');
    // Replay subscriptions PRIMEIRO (servidor precisa saber o que escutar antes de queued messages)
    for (const sub of this.subscriptions) this.sendRaw(sub);
    // Flush send queue
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift();
      if (msg !== undefined) this.sendRaw(msg);
    }
    this.startHeartbeat();
    this.onOpenCb?.();
  }

  private handleMessage(data: unknown): void {
    if (this.onMessage) {
      try {
        this.onMessage(data);
      } catch (err) {
        log.warn('onMessage callback threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private handleClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.onCloseCb?.(code, reason);
    this.ws = null;
    if (this.explicitlyClosed) {
      this.transitionTo('CLOSED');
      return;
    }
    this.scheduleReconnect();
  }

  private handleError(err: unknown): void {
    this.onErrorCb?.(err);
  }

  private scheduleReconnect(): void {
    if (this.maxAttempts > 0 && this.reconnectAttempt >= this.maxAttempts) {
      this.transitionTo('FAILED');
      return;
    }
    this.reconnectAttempt += 1;
    this.transitionTo('RECONNECTING');
    const delay = this.computeBackoff();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private computeBackoff(): number {
    const exp = Math.min(
      this.initialBackoffMs * 2 ** Math.min(this.reconnectAttempt - 1, 30),
      this.maxBackoffMs,
    );
    const jitterAmount = exp * this.backoffJitter;
    const offset = (Math.random() * 2 - 1) * jitterAmount;
    return Math.max(0, Math.round(exp + offset));
  }

  private sendRaw(data: string): void {
    try {
      this.ws?.send(data);
    } catch (err) {
      this.onErrorCb?.(err);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0 || !this.heartbeatMessage) return;
    this.heartbeatTimer = setInterval(() => {
      const msg =
        typeof this.heartbeatMessage === 'function'
          ? this.heartbeatMessage()
          : this.heartbeatMessage;
      if (msg) this.sendRaw(msg);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private transitionTo(next: WebSocketState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (this.onStateChangeCb) {
      try {
        this.onStateChangeCb(next, prev);
      } catch (err) {
        log.warn('onStateChange callback threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
