/**
 * routes.ts — Endpoints HTTP do swap pipeline.
 *
 * Cada rota:
 *  - Valida body/query com Zod (400 detalhado em caso de erro).
 *  - Delega para o adapter apropriado (Jupiter ou SolanaRpcClient).
 *  - Não contém lógica de retry/timeout/breaker — tudo isso vive nos adapters.
 *  - Erros propagam para o errorHandler central via `next(err)`.
 */

import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from 'express';
import { z } from 'zod';
import type { JupiterClient } from './adapters/jupiter';
import type { Commitment, SolanaRpcClient } from './adapters/solana-rpc';
import type { Env } from './_internal/env';
import { createLogger } from './_internal/logger';
import { type MetricsRegistry, trackedAsync } from './_internal/metrics';
import {
  createIdempotencyMiddleware,
  createIdempotencyStoreFromEnv,
  type IdempotencyStore,
} from './idempotency';

const log = createLogger('Routes');

export interface RouteDeps {
  jupiter: JupiterClient;
  solana: SolanaRpcClient;
  env: Env;
  metrics: MetricsRegistry;
  /** Idempotency store. Se ausente, é criado via `createIdempotencyStoreFromEnv(env)`. */
  idempotencyStore?: IdempotencyStore;
}

const BASE58_MIN = 32;
const BASE58_MAX = 64;
const SIGNATURE_MIN = 32;
const SIGNATURE_MAX = 96;

const quoteRequestSchema = z.object({
  inputMint: z.string().min(BASE58_MIN).max(BASE58_MAX),
  outputMint: z.string().min(BASE58_MIN).max(BASE58_MAX),
  amount: z.string().regex(/^\d+$/, 'amount deve ser inteiro positivo em unidades atômicas'),
  slippageBps: z.number().int().min(1).max(1000),
  swapMode: z.enum(['ExactIn', 'ExactOut']).optional(),
  onlyDirectRoutes: z.boolean().optional(),
});

const buildRequestSchema = z.object({
  quoteResponse: z.record(z.string(), z.unknown()),
  userPublicKey: z.string().min(BASE58_MIN).max(BASE58_MAX),
  wrapAndUnwrapSol: z.boolean().optional(),
  asLegacyTransaction: z.boolean().optional(),
  computeUnitPriceMicroLamports: z.union([z.number().int().min(0), z.literal('auto')]).optional(),
});

const simulateRequestSchema = z.object({
  signedTxBase64: z.string().min(1),
  sigVerify: z.boolean().optional(),
  replaceRecentBlockhash: z.boolean().optional(),
});

const broadcastRequestSchema = z.object({
  signedTxBase64: z.string().min(1),
  skipPreflight: z.boolean().optional(),
});

const confirmRequestSchema = z.object({
  signature: z.string().min(SIGNATURE_MIN).max(SIGNATURE_MAX),
  lastValidBlockHeight: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().min(500).max(10_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

const verifyRequestSchema = z.object({
  signature: z.string().min(SIGNATURE_MIN).max(SIGNATURE_MAX),
});

const commitmentSchema = z.enum(['processed', 'confirmed', 'finalized']).optional();

const VALIDATION_ERROR_BODY = (
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }>,
): { error: string; issues: unknown[] } => ({
  error: 'ValidationError',
  issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
});

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function deserializeVersionedTx(base64: string): VersionedTransaction {
  const bytes = Buffer.from(base64, 'base64');
  return VersionedTransaction.deserialize(bytes);
}

function pickCommitment(input: unknown, fallback: Commitment): Commitment {
  const parsed = commitmentSchema.safeParse(input);
  return parsed.success && parsed.data ? parsed.data : fallback;
}

export function createSwapRoutes(deps: RouteDeps): Router {
  const router = Router();
  const idempotencyStore = deps.idempotencyStore ?? createIdempotencyStoreFromEnv(deps.env);
  const idempotencyMiddleware = createIdempotencyMiddleware({
    store: idempotencyStore,
    ttlMs: 5 * 60_000,
  });

  router.post(
    '/quote',
    asyncHandler(async (req, res) => {
      await trackedAsync(deps.metrics, 'swap.quote', async () => {
        const parsed = quoteRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
          return;
        }
        const quote = await deps.jupiter.getQuote({
          inputMint: parsed.data.inputMint,
          outputMint: parsed.data.outputMint,
          amount: parsed.data.amount,
          slippageBps: parsed.data.slippageBps,
          platformFeeBps: deps.env.VERUM_FEE_BPS,
          onlyDirectRoutes: parsed.data.onlyDirectRoutes,
          swapMode: parsed.data.swapMode,
        });
        res.json({
          quote,
          ttlMs: 30_000,
          fetchedAt: Date.now(),
          verumFeeBps: deps.env.VERUM_FEE_BPS,
          verumTreasury: deps.env.VERUM_TREASURY_PUBKEY,
        });
      });
    }),
  );

  router.post(
    '/build',
    asyncHandler(async (req, res) => {
      await trackedAsync(deps.metrics, 'swap.build', async () => {
      const parsed = buildRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
        return;
      }
      const quoteResponse = parsed.data.quoteResponse as { outputMint?: unknown };
      const outputMint = typeof quoteResponse.outputMint === 'string' ? quoteResponse.outputMint : undefined;

      let feeAccount: string | undefined;
      if (outputMint && deps.env.VERUM_FEE_BPS > 0) {
        try {
          const derived = getAssociatedTokenAddressSync(
            new PublicKey(outputMint),
            new PublicKey(deps.env.VERUM_TREASURY_PUBKEY),
          );
          // Verifica se a ATA existe on-chain. Jupiter falha com Custom error
          // se feeAccount for endereço inexistente (não tem como ele depositar lá).
          // Em vez de quebrar o swap, omitimos o feeAccount e perdemos a fee
          // até a ATA ser criada manualmente para esse outputMint.
          const conn = new Connection(deps.env.SOLANA_RPC_PRIMARY, 'confirmed');
          const acc = await conn.getAccountInfo(derived, 'confirmed');
          if (acc) {
            feeAccount = derived.toBase58();
          } else {
            log.warn('treasury ATA inexistente para outputMint — swap segue sem fee routing', {
              outputMint,
              derivedAta: derived.toBase58(),
            });
          }
        } catch (err) {
          // ATA derivation pode falhar (Token-2022 com programa diferente etc.);
          // o swap segue sem fee account — preferimos sucesso do usuário a fee perfeito.
          log.warn('failed to derive Verum fee ATA — swap will proceed without fee routing', {
            error: err instanceof Error ? err.message : String(err),
            outputMint,
          });
        }
      }

      // Se a ATA da treasury não existe, removemos o campo `platformFee` do
      // quoteResponse — caso contrário Jupiter rejeita com NOT_SUPPORTED
      // ("feeAccount is required for swap with platformFee").
      const effectiveQuote =
        feeAccount === undefined && parsed.data.quoteResponse?.platformFee
          ? { ...parsed.data.quoteResponse, platformFee: undefined }
          : parsed.data.quoteResponse;

      const swap = await deps.jupiter.getSwapTransaction({
        quoteResponse: effectiveQuote as never,
        userPublicKey: parsed.data.userPublicKey,
        wrapAndUnwrapSol: parsed.data.wrapAndUnwrapSol ?? true,
        asLegacyTransaction: parsed.data.asLegacyTransaction ?? false,
        computeUnitPriceMicroLamports: parsed.data.computeUnitPriceMicroLamports,
        feeAccount,
      });
      res.json({
        serializedTx: swap.swapTransaction,
        lastValidBlockHeight: swap.lastValidBlockHeight,
        prioritizationFeeLamports: swap.prioritizationFeeLamports,
        feeAccountUsed: feeAccount ?? null,
      });
      });
    }),
  );

  router.post(
    '/simulate',
    asyncHandler(async (req, res) => {
      const parsed = simulateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
        return;
      }
      let tx: VersionedTransaction;
      try {
        tx = deserializeVersionedTx(parsed.data.signedTxBase64);
      } catch (err) {
        res.status(400).json({
          error: 'InvalidTransaction',
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const result = await deps.solana.simulateTransaction(tx, {
        sigVerify: parsed.data.sigVerify ?? false,
        replaceRecentBlockhash: parsed.data.replaceRecentBlockhash ?? false,
      });
      res.json({
        err: result.err ?? null,
        logs: result.logs ?? [],
        unitsConsumed: result.unitsConsumed,
        slot: result.slot,
      });
    }),
  );

  router.get(
    '/blockhash',
    asyncHandler(async (req, res) => {
      const commitment = pickCommitment(req.query.commitment, 'finalized');
      const bh = await deps.solana.getLatestBlockhash(commitment);
      res.json({ ...bh, commitment, fetchedAt: Date.now() });
    }),
  );

  router.post(
    '/broadcast',
    idempotencyMiddleware,
    asyncHandler(async (req, res) => {
      await trackedAsync(deps.metrics, 'swap.broadcast', async () => {
        const parsed = broadcastRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
          return;
        }
        const rawBytes = Buffer.from(parsed.data.signedTxBase64, 'base64');
        if (rawBytes.length < 64 || rawBytes.length > 1232) {
          res.status(400).json({
            error: 'InvalidTransactionSize',
            message: `Tamanho de TX (${rawBytes.length}B) fora dos limites Solana (64-1232B)`,
          });
          return;
        }
        const signature = await deps.solana.sendRawTransaction(rawBytes, {
          skipPreflight: parsed.data.skipPreflight ?? false,
        });
        res.json({ signature, broadcastAt: Date.now() });
      });
    }),
  );

  router.post(
    '/confirm',
    asyncHandler(async (req, res) => {
      await trackedAsync(deps.metrics, 'swap.confirm', async () => {
      const parsed = confirmRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
        return;
      }
      const pollIntervalMs = parsed.data.pollIntervalMs ?? 2_000;
      const timeoutMs = parsed.data.timeoutMs ?? 90_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const [status] = await deps.solana.getSignatureStatuses([parsed.data.signature]);
        if (status) {
          if (status.err) {
            res.json({ state: 'failed', err: status.err, slot: status.slot });
            return;
          }
          if (
            status.confirmationStatus === 'confirmed' ||
            status.confirmationStatus === 'finalized'
          ) {
            res.json({ state: status.confirmationStatus, slot: status.slot, err: null });
            return;
          }
        }

        if (parsed.data.lastValidBlockHeight !== undefined) {
          // Não temos acesso direto ao blockHeight atual sem chamada extra.
          // Para simplicidade: confiamos no signature status. Se quiséssemos
          // detectar expiração proativamente, faríamos getBlockHeight aqui.
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      res.json({ state: 'expired', slot: 0, err: 'timeout-or-blockhash-expired' });
      });
    }),
  );

  router.post(
    '/verify',
    asyncHandler(async (req, res) => {
      const parsed = verifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(VALIDATION_ERROR_BODY(parsed.error.issues));
        return;
      }
      const [status] = await deps.solana.getSignatureStatuses([parsed.data.signature], {
        searchTransactionHistory: true,
      });
      if (!status) {
        res.json({ ok: false, reason: 'signature-not-found', observedOutAmount: '0', deltaBps: 0 });
        return;
      }
      if (status.err) {
        res.json({ ok: false, reason: 'on-chain-error', observedOutAmount: '0', deltaBps: 0 });
        return;
      }
      res.json({
        ok: true,
        reason: null,
        confirmationStatus: status.confirmationStatus ?? null,
        slot: status.slot,
        observedOutAmount: '0',
        deltaBps: 0,
      });
    }),
  );

  return router;
}

export function createHealthRoute(deps: RouteDeps): Router {
  const router = Router();
  router.get('/healthz', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      env: deps.env.NODE_ENV,
      jupiter: { circuitState: deps.jupiter.circuitState },
      solana: deps.solana.snapshot(),
    });
  });
  router.get('/metrics', (_req: Request, res: Response) => {
    res.json({
      timestamp: new Date().toISOString(),
      metrics: deps.metrics.exportAll(),
    });
  });
  return router;
}
