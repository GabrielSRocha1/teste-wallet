/**
 * env.ts — Validação estrita de variáveis de ambiente no boot.
 *
 * Princípios:
 *  - Schema declarativo via Zod, fail-fast com mensagem clara.
 *  - NUNCA fallback hardcoded para secrets ou RPC URLs sensíveis.
 *  - Secrets que assinam transações (treasury secret key, etc.) NÃO ficam
 *    em env file — devem ser carregadas de secret manager em runtime.
 *  - `REDIS_URL` é obrigatório em produção (rate-limit multi-instance).
 *  - `ALLOWED_ORIGINS` recusa wildcard `*` em produção.
 *
 * Uso:
 *   import { loadEnv } from './_internal/env';
 *   const env = loadEnv();          // chame no boot — falha rápido
 *   const env2 = loadEnv();          // chamadas subsequentes usam cache
 *
 *   // Em testes:
 *   import { resetEnvCache } from './_internal/env';
 *   resetEnvCache();                 // antes de cada teste se mexer em process.env
 */

import { z } from 'zod';

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const csv = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),

    PORT: z
      .string()
      .regex(/^\d+$/, 'PORT deve ser numérico')
      .default('3000')
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1).max(65535)),

    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),

    // ─── Solana RPC ─────────────────────────────────────────────────────────
    SOLANA_RPC_PRIMARY: z.url('SOLANA_RPC_PRIMARY deve ser URL válida'),
    SOLANA_RPC_FALLBACKS: z
      .string()
      .default('')
      .transform(csv)
      .pipe(z.array(z.url('SOLANA_RPC_FALLBACKS contém URL inválida'))),

    // ─── Jupiter ────────────────────────────────────────────────────────────
    JUPITER_API_URL: z
      .url('JUPITER_API_URL deve ser URL válida')
      .default('https://api.jup.ag'),
    JUPITER_API_KEY: z.string().optional(),

    // ─── Treasury (PUBLIC pubkey apenas — secret key NUNCA aqui) ────────────
    VERUM_TREASURY_PUBKEY: z
      .string()
      .regex(BASE58_PUBKEY, 'VERUM_TREASURY_PUBKEY deve ser pubkey Solana base58'),
    VERUM_FEE_BPS: z
      .string()
      .regex(/^\d+$/, 'VERUM_FEE_BPS deve ser numérico')
      .default('200')
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(0).max(1000)),

    // ─── Rate-limit / cache ─────────────────────────────────────────────────
    REDIS_URL: z.url('REDIS_URL deve ser URL válida').optional(),

    // ─── CORS ──────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:8081,http://localhost:19006')
      .transform(csv)
      .pipe(z.array(z.string().min(1))),

    // ─── Supabase (opcional — necessário só para rotas /kyc) ────────────────
    SUPABASE_URL: z.url('SUPABASE_URL deve ser URL válida').optional(),
    SUPABASE_ANON_KEY: z.string().min(20, 'SUPABASE_ANON_KEY ausente ou muito curta').optional(),
    // Service role bypassa RLS — uso EXCLUSIVO no webhook (Didit não autentica).
    // Trate como secret crítico: nunca commit, nunca expor no frontend.
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(20, 'SUPABASE_SERVICE_ROLE_KEY ausente ou muito curta')
      .optional(),

    // ─── Didit KYC (opcional — necessário só para rotas /kyc) ───────────────
    DIDIT_API_BASE: z
      .url('DIDIT_API_BASE deve ser URL válida')
      .default('https://verification.didit.me'),
    DIDIT_API_KEY: z.string().min(10, 'DIDIT_API_KEY ausente').optional(),
    DIDIT_WORKFLOW_ID: z.string().uuid('DIDIT_WORKFLOW_ID deve ser UUID').optional(),
    DIDIT_WEBHOOK_SECRET: z
      .string()
      .min(10, 'DIDIT_WEBHOOK_SECRET ausente')
      .optional(),
    // URL de callback que a Didit redireciona após verificação.
    // Default mobile-first (deep link). Troque/duplique se precisar suportar web.
    DIDIT_CALLBACK_URL: z
      .string()
      .min(5)
      .default('verumwallet://kyc-callback'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.REDIS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'REDIS_URL é obrigatório em NODE_ENV=production (rate-limit multi-instance).',
        });
      }
      if (env.ALLOWED_ORIGINS.some((o) => o === '*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['ALLOWED_ORIGINS'],
          message: 'ALLOWED_ORIGINS=* não é permitido em produção.',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super(
      `Configuração de ambiente inválida:\n` +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

let cached: Env | undefined;
let dotenvLoaded = false;

function ensureDotenvLoaded(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  // Carregamento lazy: tests podem injetar process.env antes de chamar loadEnv()
  // sem que `.env` no disco sobrescreva (dotenv respeita process.env preexistente).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    // dotenv não instalado em algum contexto — ignora silenciosamente
  }
}

/**
 * Carrega e valida o env. Chame UMA VEZ no boot — falha rápido em config inválida.
 * Chamadas subsequentes retornam o resultado cacheado.
 */
export function loadEnv(): Env {
  if (cached) return cached;
  ensureDotenvLoaded();

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw new EnvValidationError(issues);
  }
  cached = parsed.data;
  return cached;
}

/** Reset do cache — usado apenas em testes. */
export function resetEnvCache(): void {
  cached = undefined;
  dotenvLoaded = false;
}
