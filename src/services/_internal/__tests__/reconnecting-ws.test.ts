import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogSinks } from '../logger';
import {
  ReconnectingWebSocket,
  type WebSocketFactory,
  type WebSocketLike,
  type WebSocketState,
} from '../reconnecting-ws';

clearLogSinks();

// ──────────────────────────────────────────────────────────────────────────────
// MockWebSocket — implementação determinística de WebSocketLike para testes
// ──────────────────────────────────────────────────────────────────────────────

class MockWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  readonly sent: string[] = [];
  closed = false;
  closeArgs: { code: number; reason: string } | null = null;

  constructor(public readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('MockWebSocket: send antes de open');
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.closed = true;
    this.closeArgs = { code, reason };
    if (this.onclose) this.onclose({ code, reason });
  }

  // Test helpers — disparados pelo teste para simular ações do servidor
  triggerOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  triggerMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
  triggerCloseFromServer(code = 1006, reason = 'connection lost'): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function makeFactory(): { factory: WebSocketFactory; sockets: MockWebSocket[] } {
  const sockets: MockWebSocket[] = [];
  const factory: WebSocketFactory = (url) => {
    const ws = new MockWebSocket(url);
    sockets.push(ws);
    return ws;
  };
  return { factory, sockets };
}

// ──────────────────────────────────────────────────────────────────────────────
// Happy path: connect → state transitions
// ──────────────────────────────────────────────────────────────────────────────

describe('ReconnectingWebSocket — happy path', () => {
  it('connect() abre socket; state IDLE → CONNECTING → CONNECTED no onopen', () => {
    const { factory, sockets } = makeFactory();
    const transitions: WebSocketState[] = [];
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      onStateChange: (next) => transitions.push(next),
    });
    expect(rws.getState()).toBe('IDLE');
    rws.connect();
    expect(rws.getState()).toBe('CONNECTING');
    sockets[0].triggerOpen();
    expect(rws.getState()).toBe('CONNECTED');
    expect(transitions).toEqual(['CONNECTING', 'CONNECTED']);
  });

  it('messages do servidor são entregues via onMessage', () => {
    const { factory, sockets } = makeFactory();
    const received: unknown[] = [];
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      onMessage: (data) => received.push(data),
    });
    rws.connect();
    sockets[0].triggerOpen();
    sockets[0].triggerMessage('{"event":"foo"}');
    sockets[0].triggerMessage('{"event":"bar"}');
    expect(received).toEqual(['{"event":"foo"}', '{"event":"bar"}']);
  });

  it('send() em CONNECTED encaminha direto ao socket', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({ url: 'wss://test', webSocketFactory: factory });
    rws.connect();
    sockets[0].triggerOpen();
    rws.send('hello');
    expect(sockets[0].sent).toEqual(['hello']);
  });

  it('send() antes de CONNECTED enfileira; flush no onopen', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({ url: 'wss://test', webSocketFactory: factory });
    rws.connect();
    rws.send('msg-1');
    rws.send('msg-2');
    expect(sockets[0].sent).toEqual([]);
    sockets[0].triggerOpen();
    expect(sockets[0].sent).toEqual(['msg-1', 'msg-2']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Reconnection com backoff
// ──────────────────────────────────────────────────────────────────────────────

describe('ReconnectingWebSocket — reconexão', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('close do servidor (não-explícito) dispara RECONNECTING e abre novo socket', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 100,
      backoffJitter: 0,
    });
    rws.connect();
    sockets[0].triggerOpen();
    expect(rws.getState()).toBe('CONNECTED');

    sockets[0].triggerCloseFromServer();
    expect(rws.getState()).toBe('RECONNECTING');

    vi.advanceTimersByTime(150);
    expect(sockets).toHaveLength(2); // novo socket criado
    expect(rws.getState()).toBe('CONNECTING');

    sockets[1].triggerOpen();
    expect(rws.getState()).toBe('CONNECTED');
  });

  it('backoff exponencial entre tentativas (100ms → 200ms → 400ms)', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 100,
      backoffJitter: 0,
    });
    rws.connect();
    sockets[0].triggerOpen();

    // 1ª falha
    sockets[0].triggerCloseFromServer();
    expect(rws.currentReconnectAttempt).toBe(1);
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1); // ainda não reconectou
    vi.advanceTimersByTime(2);
    expect(sockets).toHaveLength(2);

    // socket #2 abre, depois fecha — 2ª falha
    sockets[1].triggerOpen();
    sockets[1].triggerCloseFromServer();
    expect(rws.currentReconnectAttempt).toBe(1); // resetou ao conectar com sucesso anterior
    vi.advanceTimersByTime(101);
    expect(sockets).toHaveLength(3);

    // Falha imediata sem nunca abrir (factory retorna socket fechado prematuramente)
    sockets[2].triggerCloseFromServer();
    expect(rws.currentReconnectAttempt).toBe(2);
    // 200ms para a 2ª tentativa
    vi.advanceTimersByTime(201);
    expect(sockets).toHaveLength(4);

    sockets[3].triggerCloseFromServer();
    expect(rws.currentReconnectAttempt).toBe(3);
    // 400ms para a 3ª
    vi.advanceTimersByTime(401);
    expect(sockets).toHaveLength(5);
  });

  it('maxAttempts esgotado → state FAILED', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 50,
      backoffJitter: 0,
      maxAttempts: 2,
    });
    rws.connect();
    sockets[0].triggerCloseFromServer(); // attempt 1
    vi.advanceTimersByTime(100);
    sockets[1].triggerCloseFromServer(); // attempt 2
    vi.advanceTimersByTime(200);
    sockets[2].triggerCloseFromServer(); // attempt 3 — excede max
    expect(rws.getState()).toBe('FAILED');
  });

  it('close() explícito NÃO dispara reconnect', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 100,
    });
    rws.connect();
    sockets[0].triggerOpen();
    rws.close();
    expect(rws.getState()).toBe('CLOSED');
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(1); // nenhum socket novo
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Subscriptions replay
// ──────────────────────────────────────────────────────────────────────────────

describe('ReconnectingWebSocket — subscription replay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('addSubscription armazena e envia em todo (re)open', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 10,
      backoffJitter: 0,
    });
    rws.connect();
    sockets[0].triggerOpen();

    rws.addSubscription('{"method":"subscribe","topic":"balance"}');
    rws.addSubscription('{"method":"subscribe","topic":"tx"}');
    expect(sockets[0].sent).toEqual([
      '{"method":"subscribe","topic":"balance"}',
      '{"method":"subscribe","topic":"tx"}',
    ]);

    // Drop & reconnect
    sockets[0].triggerCloseFromServer();
    vi.advanceTimersByTime(20);
    sockets[1].triggerOpen();
    expect(sockets[1].sent).toEqual([
      '{"method":"subscribe","topic":"balance"}',
      '{"method":"subscribe","topic":"tx"}',
    ]);
  });

  it('addSubscription antes de connect: envia ao abrir', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({ url: 'wss://test', webSocketFactory: factory });
    rws.addSubscription('{"sub":1}');
    rws.connect();
    sockets[0].triggerOpen();
    expect(sockets[0].sent).toContain('{"sub":1}');
  });

  it('removeSubscription cancela replay futuro', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      initialBackoffMs: 10,
      backoffJitter: 0,
    });
    rws.connect();
    sockets[0].triggerOpen();
    rws.addSubscription('{"sub":1}');
    rws.addSubscription('{"sub":2}');
    rws.removeSubscription('{"sub":1}');

    sockets[0].triggerCloseFromServer();
    vi.advanceTimersByTime(20);
    sockets[1].triggerOpen();
    expect(sockets[1].sent).toEqual(['{"sub":2}']);
  });

  it('addSubscription duplicada é deduplicada', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({ url: 'wss://test', webSocketFactory: factory });
    rws.connect();
    sockets[0].triggerOpen();
    rws.addSubscription('{"sub":1}');
    rws.addSubscription('{"sub":1}'); // mesma — não duplica
    expect(sockets[0].sent.filter((m) => m === '{"sub":1}')).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Heartbeat
// ──────────────────────────────────────────────────────────────────────────────

describe('ReconnectingWebSocket — heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envia heartbeatMessage no intervalo configurado quando CONNECTED', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      heartbeatIntervalMs: 500,
      heartbeatMessage: 'ping',
    });
    rws.connect();
    sockets[0].triggerOpen();
    expect(sockets[0].sent.filter((m) => m === 'ping')).toHaveLength(0);
    vi.advanceTimersByTime(1_600);
    expect(sockets[0].sent.filter((m) => m === 'ping').length).toBeGreaterThanOrEqual(3);
  });

  it('para heartbeat após close', () => {
    const { factory, sockets } = makeFactory();
    const rws = new ReconnectingWebSocket({
      url: 'wss://test',
      webSocketFactory: factory,
      heartbeatIntervalMs: 100,
      heartbeatMessage: 'ping',
    });
    rws.connect();
    sockets[0].triggerOpen();
    vi.advanceTimersByTime(250);
    const beforeClose = sockets[0].sent.filter((m) => m === 'ping').length;
    rws.close();
    vi.advanceTimersByTime(500);
    const afterClose = sockets[0].sent.filter((m) => m === 'ping').length;
    expect(afterClose).toBe(beforeClose);
  });
});
