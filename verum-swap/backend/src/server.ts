/**
 * server.ts — Bootstrap do backend Verum Swap.
 *
 * `createApp(deps)` é puro (sem rede no boot): recebe clients/env injetados
 * e devolve um `Express`. Toda a I/O de produção fica em `startServer()`.
 *
 * Middlewares (na ordem):
 *   helmet → CORS (whitelist estrita) → JSON limit → correlationId →
 *   rotas → errorHandler central.
 */

import cors from 'cors';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import { createJupiterClientFromEnv, type JupiterClient } from './adapters/jupiter';
import { createSolanaRpcClientFromEnv, type SolanaRpcClient } from './adapters/solana-rpc';
import { type Env, loadEnv } from './_internal/env';
import { createLogger, newCorrelationId } from './_internal/logger';
import { CircuitOpenError } from './_internal/circuit-breaker';
import { MetricsRegistry } from './_internal/metrics';
import { TimeoutError } from './_internal/timeout';
import { createHealthRoute, createSwapRoutes } from './routes';
import { createExtraRoutes } from './routes-extras';
import { createKycRoutes } from './kyc-routes';

const log = createLogger('Server');

export interface AppDeps {
  jupiter: JupiterClient;
  solana: SolanaRpcClient;
  env: Env;
  metrics: MetricsRegistry;
}

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && /^[A-Za-z0-9_\-:.]{1,128}$/.test(incoming)
    ? incoming
    : newCorrelationId('req');
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
}

function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // express precisa do 4º arg para reconhecer como error handler — não removível
  _next: NextFunction,
): void {
  if (res.headersSent) {
    // Express já começou a enviar — não há recuperação possível.
    return;
  }

  let status = 502;
  let errorName = 'UpstreamError';
  if (err instanceof CircuitOpenError) {
    status = 503;
    errorName = 'CircuitOpen';
  } else if (err instanceof TimeoutError) {
    status = 504;
    errorName = 'GatewayTimeout';
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    // JSON body parser failure
    status = 400;
    errorName = 'InvalidJsonBody';
  } else if (err instanceof Error && err.name === 'ZodError') {
    status = 400;
    errorName = 'ValidationError';
  }

  const message = err instanceof Error ? err.message : String(err);
  log.error('request failed', err, {
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    status,
  });
  res.status(status).json({
    error: errorName,
    message,
    correlationId: req.correlationId,
  });
}

function buildCorsOptions(env: Env): cors.CorsOptions {
  const allowed = new Set(env.ALLOWED_ORIGINS);
  return {
    origin(origin, callback) {
      // Permite requests sem origin (curl, health checks, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS: origin não autorizado: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'ngrok-skip-browser-warning'],
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(buildCorsOptions(deps.env)));
  // JSON parser global EXCETO /kyc/webhook — webhook precisa do raw body
  // pra validar a assinatura HMAC byte-a-byte.
  const jsonParser = express.json({ limit: '100kb' });
  app.use((req, res, next) => {
    if (req.path === '/kyc/webhook') return next();
    return jsonParser(req, res, next);
  });
  app.use(correlationIdMiddleware);

  app.use('/api', createHealthRoute(deps));
  app.use('/api/swap', createSwapRoutes(deps));
  app.use('/api', createExtraRoutes({ env: deps.env }));
  app.use('/kyc', createKycRoutes({ env: deps.env }));

  // Catch-all 404 — antes do errorHandler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'NotFound',
      message: `Rota ${req.method} ${req.path} não existe`,
      correlationId: req.correlationId,
    });
  });

  app.use(errorHandler);

  return app;
}

/** Wiring de produção: carrega env, instancia clients, sobe HTTP. */
export function startServer(): void {
  const env = loadEnv();
  const jupiter = createJupiterClientFromEnv(env);
  const solana = createSolanaRpcClientFromEnv(env);
  const metrics = new MetricsRegistry();
  const app = createApp({ jupiter, solana, env, metrics });

  const server = app.listen(env.PORT, () => {
    log.info('verum-swap backend listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      rpcPrimary: env.SOLANA_RPC_PRIMARY,
      rpcFallbackCount: env.SOLANA_RPC_FALLBACKS.length,
    });
  });

  const shutdown = (signal: string) => {
    log.info('shutdown signal received', { signal });
    server.close(() => {
      log.info('http server closed — exiting');
      process.exit(0);
    });
    // Cast para NodeJS.Timeout — em projeto compartilhado client+server,
    // `setTimeout` resolve para o tipo do browser (que retorna number, sem .unref).
    // No runtime Node sempre é Timeout com unref().
    const forceTimer = setTimeout(() => {
      log.fatal('shutdown timed out — forcing exit', undefined);
      process.exit(1);
    }, 10_000) as unknown as { unref: () => void };
    forceTimer.unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Quando rodado diretamente (não importado), inicia o servidor.
if (require.main === module) {
  startServer();
}
