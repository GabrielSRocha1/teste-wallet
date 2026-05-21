import { createServer, type Server } from 'node:http';
import express, { type Express, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIdempotencyMiddleware,
  InMemoryIdempotencyStore,
} from '../idempotency';
import { setLogLevel } from '../_internal/logger';

setLogLevel('fatal');

// ────────────────────────────────────────────────────────────────────────────────
// InMemoryIdempotencyStore — unit tests
// ────────────────────────────────────────────────────────────────────────────────

describe('InMemoryIdempotencyStore', () => {
  it('retorna null para chave desconhecida', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('armazena e retorna a resposta cacheada', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('k', { status: 200, body: { ok: true }, cachedAt: 1 }, 60_000);
    const got = await store.get('k');
    expect(got).not.toBeNull();
    expect(got!.body).toEqual({ ok: true });
    expect(got!.status).toBe(200);
  });

  it('expira o registro após TTL', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      await store.set('k', { status: 200, body: 'x', cachedAt: 1 }, 1_000);
      expect(await store.get('k')).not.toBeNull();
      vi.advanceTimersByTime(2_000);
      expect(await store.get('k')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('markInFlight é atômico: 2ª chamada concorrente retorna false', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.markInFlight('k', 60_000)).toBe(true);
    expect(await store.markInFlight('k', 60_000)).toBe(false);
    await store.clearInFlight('k');
    expect(await store.markInFlight('k', 60_000)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Middleware HTTP — integration tests
// ────────────────────────────────────────────────────────────────────────────────

describe('createIdempotencyMiddleware (HTTP integration)', () => {
  let store: InMemoryIdempotencyStore;
  let httpServer: Server | undefined;
  let handlerCalls = 0;

  async function startApp(
    handlerImpl?: (req: Request, res: Response) => void,
  ): Promise<string> {
    const app: Express = express();
    app.use(express.json());
    const mw = createIdempotencyMiddleware({ store, ttlMs: 60_000, inFlightTtlMs: 30_000 });
    app.post('/test', mw, (req, res) => {
      handlerCalls++;
      if (handlerImpl) {
        handlerImpl(req, res);
        return;
      }
      res.json({ ok: true, callCount: handlerCalls });
    });
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}`;
  }

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
    handlerCalls = 0;
    httpServer = undefined;
  });

  afterEach(async () => {
    if (httpServer && httpServer.listening) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
  });

  it('passa adiante quando Idempotency-Key não está presente', async () => {
    const baseUrl = await startApp();
    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, callCount: 1 });
    expect(handlerCalls).toBe(1);
  });

  it('cacheia 200 e replays na 2ª chamada com mesma key', async () => {
    const baseUrl = await startApp();

    const res1 = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'abc-123' },
      body: '{}',
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).toEqual({ ok: true, callCount: 1 });

    // Pequeno delay para garantir que cache write microtask completou
    await new Promise((r) => setTimeout(r, 20));

    const res2 = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'abc-123' },
      body: '{}',
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-idempotent-replay')).toBe('true');
    const body2 = await res2.json();
    expect(body2).toEqual({ ok: true, callCount: 1 }); // mesmo body — handler não rodou de novo
    expect(handlerCalls).toBe(1);
  });

  it('rejeita key inválida com 400 sem invocar handler', async () => {
    const baseUrl = await startApp();
    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'invalid key with spaces!',
      },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('InvalidIdempotencyKey');
    expect(handlerCalls).toBe(0);
  });

  it('NÃO cacheia respostas 5xx (retry continua funcionando)', async () => {
    const baseUrl = await startApp((req, res) => {
      res.status(500).json({ error: 'boom' });
    });

    const res1 = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'err-key' },
      body: '{}',
    });
    expect(res1.status).toBe(500);
    expect(res1.headers.get('x-idempotent-replay')).toBeNull();

    await new Promise((r) => setTimeout(r, 20));

    const res2 = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'err-key' },
      body: '{}',
    });
    expect(res2.status).toBe(500);
    expect(res2.headers.get('x-idempotent-replay')).toBeNull();
    expect(handlerCalls).toBe(2); // 5xx NÃO foi cacheado → handler rodou nas 2 chamadas
  });

  it('retorna 409 quando chave já está em-flight (lock concorrente)', async () => {
    // Pré-marca a key como in-flight ANTES de chamar, simulando outra request paralela
    await store.markInFlight('concurrent-key', 30_000);

    const baseUrl = await startApp();
    const res = await fetch(`${baseUrl}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'concurrent-key' },
      body: '{}',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('IdempotencyConflict');
    expect(handlerCalls).toBe(0);
  });
});
