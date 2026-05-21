/**
 * idempotency.ts — Idempotency server-side para operações com side-effect
 * monetário (notavelmente /api/swap/broadcast).
 *
 * Cliente envia header `Idempotency-Key: <opaque-string>` em retentativas.
 *
 * Comportamento:
 *  - Sem header → passa adiante (idempotency é opt-in).
 *  - Header presente + cache HIT → retorna resposta cacheada com
 *    `X-Idempotent-Replay: true` (sem re-executar a rota).
 *  - Header presente + lock adquirido → executa, cacheia se 2xx.
 *  - Header presente + lock já tomado por outra request em andamento → 409.
 *  - 5xx NUNCA é cacheado (deixa retry transitório funcionar).
 *  - 4xx (cliente) é cacheado (resposta é determinística).
 *
 * Stores:
 *  - InMemory: 1 processo (dev/testes).
 *  - Redis: multi-instância (produção); locks via SET ... PX NX (atômico).
 */

import type { NextFunction, Request, Response } from 'express';
import IORedis from 'ioredis';
import type { Env } from './_internal/env';
import { createLogger } from './_internal/logger';

const log = createLogger('Idempotency');

export interface CachedResponse {
  status: number;
  body: unknown;
  cachedAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, response: CachedResponse, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Marca key como em processamento. Retorna `true` se conseguiu o lock,
   * `false` se outra request já tem o lock (key concorrente).
   */
  markInFlight(key: string, ttlMs: number): Promise<boolean>;
  clearInFlight(key: string): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────────
// InMemoryIdempotencyStore
// ────────────────────────────────────────────────────────────────────────────────

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly responses = new Map<string, { response: CachedResponse; expiresAt: number }>();
  private readonly inFlight = new Map<string, number>();

  async get(key: string): Promise<CachedResponse | null> {
    const entry = this.responses.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.responses.delete(key);
      return null;
    }
    return entry.response;
  }

  async set(key: string, response: CachedResponse, ttlMs: number): Promise<void> {
    this.responses.set(key, { response, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.responses.delete(key);
    this.inFlight.delete(key);
  }

  async markInFlight(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.inFlight.get(key);
    if (existing && existing > now) return false;
    this.inFlight.set(key, now + ttlMs);
    return true;
  }

  async clearInFlight(key: string): Promise<void> {
    this.inFlight.delete(key);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// RedisIdempotencyStore
// ────────────────────────────────────────────────────────────────────────────────

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly client: IORedis, private readonly prefix = 'idemp:') {}

  private rKey(key: string): string {
    return `${this.prefix}r:${key}`;
  }
  private fKey(key: string): string {
    return `${this.prefix}f:${key}`;
  }

  async get(key: string): Promise<CachedResponse | null> {
    const raw = await this.client.get(this.rKey(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }

  async set(key: string, response: CachedResponse, ttlMs: number): Promise<void> {
    await this.client.set(this.rKey(key), JSON.stringify(response), 'PX', ttlMs);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.client.del(this.rKey(key)), this.client.del(this.fKey(key))]);
  }

  async markInFlight(key: string, ttlMs: number): Promise<boolean> {
    // SET ... NX PX é atômico: só seta se não existir e expira automaticamente.
    const result = await this.client.set(this.fKey(key), '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async clearInFlight(key: string): Promise<void> {
    await this.client.del(this.fKey(key));
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────────

export interface IdempotencyMiddlewareOptions {
  store: IdempotencyStore;
  /** TTL da resposta cacheada. Default 5min. */
  ttlMs?: number;
  /** TTL do lock in-flight. Default 30s — mais que o tempo máximo de uma rota. */
  inFlightTtlMs?: number;
  /** Nome do header (case-insensitive). Default 'idempotency-key'. */
  headerName?: string;
  maxKeyLength?: number;
}

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{1,256}$/;

export function createIdempotencyMiddleware(opts: IdempotencyMiddlewareOptions) {
  const store = opts.store;
  const ttlMs = opts.ttlMs ?? 5 * 60_000;
  const inFlightTtlMs = opts.inFlightTtlMs ?? 30_000;
  const headerName = (opts.headerName ?? 'idempotency-key').toLowerCase();
  const maxKeyLength = opts.maxKeyLength ?? 256;

  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const rawKey = req.header(headerName);
    if (!rawKey) {
      next();
      return;
    }

    if (rawKey.length > maxKeyLength || !KEY_PATTERN.test(rawKey)) {
      res.status(400).json({
        error: 'InvalidIdempotencyKey',
        message: `Idempotency-Key inválida (max ${maxKeyLength} chars; charset [A-Za-z0-9_\\-:.])`,
      });
      return;
    }

    const key = rawKey;

    // 1. Cache HIT?
    try {
      const cached = await store.get(key);
      if (cached) {
        res.setHeader('X-Idempotent-Replay', 'true');
        res.status(cached.status).json(cached.body);
        return;
      }
    } catch (err) {
      log.warn('idempotency get failed — bypassando cache', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      next();
      return;
    }

    // 2. Tenta lock atômico
    let acquired = false;
    try {
      acquired = await store.markInFlight(key, inFlightTtlMs);
    } catch (err) {
      log.warn('idempotency markInFlight failed — prosseguindo sem lock', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      next();
      return;
    }

    if (!acquired) {
      res.status(409).json({
        error: 'IdempotencyConflict',
        message: `Operação com chave '${key}' já está em andamento`,
      });
      return;
    }

    // 3. Intercepta res.json para cachear sucesso
    const originalJson = res.json.bind(res);
    let willCache = false;
    res.json = function (body: unknown): Response {
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        willCache = true;
        store
          .set(key, { status, body, cachedAt: Date.now() }, ttlMs)
          .catch((err) =>
            log.warn('idempotency cache write failed', {
              key,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      }
      return originalJson(body);
    };

    // 4. Limpa lock no final do ciclo de resposta
    res.on('finish', () => {
      store.clearInFlight(key).catch(() => undefined);
      if (!willCache) {
        log.debug('response não cacheada (status fora de 2xx)', { key, status: res.statusCode });
      }
    });

    next();
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Factory de produção
// ────────────────────────────────────────────────────────────────────────────────

export function createIdempotencyStoreFromEnv(env: Env): IdempotencyStore {
  if (!env.REDIS_URL) {
    log.info('idempotency: usando InMemoryStore (REDIS_URL não configurado)');
    return new InMemoryIdempotencyStore();
  }
  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on('error', (err: Error) => {
    log.warn('redis client error', { error: err.message });
  });
  log.info('idempotency: usando RedisIdempotencyStore');
  return new RedisIdempotencyStore(client);
}
