/**
 * rate-limit.ts — Rate limiter factory com Redis (preferido) ou in-memory (fallback).
 *
 * PROBLEMA #16: o `express-rate-limit` default usa store in-memory por processo.
 * Em produção com múltiplas instâncias (load balancer, k8s, Vercel serverless),
 * cada instância tem seu próprio contador → limites efetivos são N×max.
 *
 * Solução: Redis store compartilhado. Mas mantemos fallback in-memory para
 * desenvolvimento local sem Redis disponível — log claro indica o estado.
 *
 * Uso:
 *   const limiters = await createRateLimiters(); // chama UMA vez no boot
 *   app.get('/api/quote', limiters.quote, handler);
 */

import rateLimit, { RateLimitRequestHandler, Store } from 'express-rate-limit';
import { createLogger } from './logger';
import { optionalEnv } from './env';

const log = createLogger('RateLimit');

export interface RateLimiters {
  quote: RateLimitRequestHandler;
  balance: RateLimitRequestHandler;
  swap: RateLimitRequestHandler;
  broadcast: RateLimitRequestHandler;
  prices: RateLimitRequestHandler;
  backend: 'redis' | 'memory';
}

/**
 * Cria todos os rate limiters do backend.
 * Tenta conectar ao Redis primeiro; se falhar, usa in-memory com warning.
 */
export async function createRateLimiters(): Promise<RateLimiters> {
  const redisUrl = optionalEnv('REDIS_URL');
  let store: Store | undefined;
  let backend: 'redis' | 'memory' = 'memory';

  if (redisUrl) {
    try {
      store = await buildRedisStore(redisUrl);
      backend = 'redis';
      log.info('rate_limit.backend_ready', { backend: 'redis' });
    } catch (err: any) {
      log.warn('rate_limit.redis_failed_using_memory', {
        error: err?.message ?? String(err),
      });
    }
  } else {
    log.warn('rate_limit.no_redis_url_using_memory', {
      hint: 'Defina REDIS_URL para rate limit distribuído em produção.',
    });
  }

  const factory = (max: number, name: string): RateLimitRequestHandler =>
    rateLimit({
      windowMs: 60_000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      store,
      keyGenerator: defaultKeyGenerator,
      handler: (req, res) => {
        log.warn('rate_limit.exceeded', {
          name,
          ip: getClientKey(req),
          path: req.path,
        });
        res.status(429).json({
          error: 'Limite de requisições excedido. Aguarde alguns segundos.',
        });
      },
    });

  return {
    quote: factory(30, 'quote'),
    balance: factory(30, 'balance'),
    swap: factory(10, 'swap'),
    broadcast: factory(5, 'broadcast'),
    prices: factory(200, 'prices'),
    backend,
  };
}

// ─── Redis store builder ─────────────────────────────────────────────────────

async function buildRedisStore(url: string): Promise<Store> {
  // Lazy import — ioredis só é necessário se REDIS_URL existir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Redis = (await import('ioredis')).default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RedisStore } = await import('rate-limit-redis');

  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

  // Aguarda conexão real antes de retornar store — falha rápido se URL ruim.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Redis connect timeout 5s')), 5000);
    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('error', (e: any) => {
      clearTimeout(timeout);
      reject(e);
    });
  });

  // Reconnect logging em runtime (não bloqueia boot).
  client.on('error', (err: any) => {
    log.warn('rate_limit.redis_runtime_error', { error: err?.message });
  });

  return new RedisStore({
    // ioredis.call() é variadic mas exige (command, ...args). Cast através de
    // any preserva o contrato esperado por rate-limit-redis sem perder safety
    // em runtime — RedisStore só passa strings para o sendCommand.
    sendCommand: ((...args: string[]) =>
      (client as any).call(...args)) as (...args: string[]) => Promise<any>,
    prefix: 'verum-rl:',
  }) as unknown as Store;
}

// ─── Key generator: prefere wallet address > IP ──────────────────────────────

function getClientKey(req: any): string {
  // Se a request inclui um header `x-wallet-address` (frontend opt-in), usa
  // como chave — mais relevante para limitar abuso por usuário, não por IP.
  const wallet = req.headers?.['x-wallet-address'];
  if (typeof wallet === 'string' && wallet.length >= 32 && wallet.length <= 44) {
    return `w:${wallet}`;
  }
  // Fallback: IP. Considera X-Forwarded-For (atrás de proxy/load balancer).
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return `ip:${first}`;
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

function defaultKeyGenerator(req: any): string {
  return getClientKey(req);
}
