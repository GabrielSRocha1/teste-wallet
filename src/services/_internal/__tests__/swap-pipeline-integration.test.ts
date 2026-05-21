import { createServer, type Server } from 'node:http';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../../../../verum-swap/backend/src/server';
import type { JupiterClient } from '../../../../verum-swap/backend/src/adapters/jupiter';
import type {
  Commitment,
  SolanaRpcClient,
} from '../../../../verum-swap/backend/src/adapters/solana-rpc';
import { setLogLevel as setBackendLogLevel } from '../../../../verum-swap/backend/src/_internal/logger';
import { MetricsRegistry } from '../../../../verum-swap/backend/src/_internal/metrics';
import type { Env } from '../../../../verum-swap/backend/src/_internal/env';
import { createBackendSwapAdapters } from '../backend-adapters';
import { clearLogSinks } from '../logger';
import { executeSwap } from '../swap-pipeline';
import { SimulationFailedError, type SignedTx, type SwapRequest } from '../swap-pipeline.types';

clearLogSinks();
setBackendLogLevel('fatal');

const TEST_ENV: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  SOLANA_RPC_PRIMARY: 'https://test-rpc.example',
  SOLANA_RPC_FALLBACKS: [],
  JUPITER_API_URL: 'https://test.jup.ag',
  JUPITER_API_KEY: undefined,
  VERUM_TREASURY_PUBKEY: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  VERUM_FEE_BPS: 200,
  REDIS_URL: undefined,
  ALLOWED_ORIGINS: ['http://localhost:8081'],
  SUPABASE_URL: undefined,
  SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  DIDIT_API_BASE: 'https://verification.didit.me',
  DIDIT_API_KEY: undefined,
  DIDIT_WORKFLOW_ID: undefined,
  DIDIT_WEBHOOK_SECRET: undefined,
  DIDIT_CALLBACK_URL: 'verumwallet://kyc-callback',
};

// Constrói uma VersionedTransaction v0 mínima MAS válida (assinada),
// para que o backend consiga desserializá-la em /simulate e /broadcast.
function buildValidVersionedTxBase64(): string {
  const dummy = Keypair.generate();
  const message = new TransactionMessage({
    payerKey: dummy.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({
        fromPubkey: dummy.publicKey,
        toPubkey: dummy.publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([dummy]);
  return Buffer.from(tx.serialize()).toString('base64');
}

const FAKE_TX_BASE64 = buildValidVersionedTxBase64();

function makeMockJupiter(): JupiterClient {
  return {
    circuitState: 'CLOSED',
    getQuote: vi.fn(async () => ({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: TEST_ENV.VERUM_TREASURY_PUBKEY,
      inAmount: '1000000',
      outAmount: '950000',
      otherAmountThreshold: '900000',
      swapMode: 'ExactIn',
      priceImpactPct: '0.005',
      routePlan: [],
    })),
    getSwapTransaction: vi.fn(async () => ({
      swapTransaction: FAKE_TX_BASE64,
      lastValidBlockHeight: 12_345,
      prioritizationFeeLamports: 1_000,
    })),
  } as unknown as JupiterClient;
}

function makeMockSolana(overrides: Partial<SolanaRpcClient> = {}): SolanaRpcClient {
  return {
    getLatestBlockhash: vi.fn(async (_c?: Commitment) => ({
      blockhash: 'bh-fresh',
      lastValidBlockHeight: 12_345,
    })),
    simulateTransaction: vi.fn(async () => ({
      err: null,
      logs: ['Program ok'],
      unitsConsumed: 100_000,
      slot: 1,
    })),
    sendRawTransaction: vi.fn(async () => '5j7s' + 'A'.repeat(60)),
    getSignatureStatuses: vi.fn(async () => [
      { slot: 1, confirmations: 1, confirmationStatus: 'confirmed' as const, err: null },
    ]),
    getBalance: vi.fn(async () => 1_000_000),
    snapshot: vi.fn(() => []),
    ...overrides,
  } as unknown as SolanaRpcClient;
}

const baseRequest: SwapRequest = {
  userPublicKey: 'OwnerPK11111111111111111111111111111111111',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inputAmount: '1000000',
  slippageBps: 50,
  network: 'mainnet',
};

const mockSign = async (tx: { serialized: string; isVersioned: boolean }): Promise<SignedTx> => ({
  ...tx,
  signature: 'mockClientSig',
});

let httpServer: Server;
let baseUrl: string;
let deps: AppDeps;

beforeAll(async () => {
  deps = {
    jupiter: makeMockJupiter(),
    solana: makeMockSolana(),
    env: TEST_ENV,
    metrics: new MetricsRegistry(),
  };
  const app = createApp(deps);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
describe('SwapPipeline + Backend (end-to-end via HTTP)', () => {
  it('completa o pipeline inteiro com backend real respondendo', async () => {
    const adapters = createBackendSwapAdapters({
      apiBaseUrl: baseUrl,
      signTransaction: mockSign,
    });

    const result = await executeSwap(baseRequest, adapters, {
      correlationId: 'int-test-happy',
      quoteTimeoutMs: 5_000,
      buildTimeoutMs: 5_000,
      simulateTimeoutMs: 5_000,
      blockhashTimeoutMs: 5_000,
      signTimeoutMs: 5_000,
      sendTimeoutMs: 5_000,
      confirmTimeoutMs: 5_000,
      verifyTimeoutMs: 5_000,
    });

    expect(result.signature).toBe('5j7s' + 'A'.repeat(60));
    expect(result.confirmed.state).toBe('confirmed');
    expect(result.verified.ok).toBe(true);

    // Verifica que todos os endpoints foram exercitados
    expect(deps.jupiter.getQuote).toHaveBeenCalledTimes(1);
    expect(deps.jupiter.getSwapTransaction).toHaveBeenCalledTimes(1);
    expect(deps.solana.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(deps.solana.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(deps.solana.getSignatureStatuses).toHaveBeenCalled(); // confirm + verify
  });

  it('SimulationFailedError do backend propaga para o cliente (send NUNCA chamado)', async () => {
    // Reconstruir deps com simulate falhando
    const closedServer = httpServer;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    deps = {
      jupiter: makeMockJupiter(),
      solana: makeMockSolana({
        simulateTransaction: vi.fn(async () => ({
          err: { InstructionError: [0, 'Custom(42)'] },
          logs: ['Program failed'],
          unitsConsumed: 0,
          slot: 1,
        })),
      }),
      env: TEST_ENV,
      metrics: new MetricsRegistry(),
    };
    const app = createApp(deps);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const adapters = createBackendSwapAdapters({
      apiBaseUrl: baseUrl,
      signTransaction: mockSign,
    });

    await expect(
      executeSwap(baseRequest, adapters, {
        correlationId: 'int-test-sim-fail',
        confirmTimeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(SimulationFailedError);

    expect(deps.solana.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('Idempotency-Key faz 2ª chamada com signed.bytes idêntico replay no backend', async () => {
    // Reconstruir deps "limpos"
    const closedServer = httpServer;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    deps = {
      jupiter: makeMockJupiter(),
      solana: makeMockSolana(),
      env: TEST_ENV,
      metrics: new MetricsRegistry(),
    };
    const app = createApp(deps);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    // Idempotency store é injetado e compartilhado entre as 2 chamadas
    // (mas no caso simulamos 2 swaps independentes, idempotency é a nível HTTP)
    const adapters1 = createBackendSwapAdapters({
      apiBaseUrl: baseUrl,
      signTransaction: mockSign,
    });

    const r1 = await executeSwap(baseRequest, adapters1, {
      correlationId: 'int-test-idemp-1',
      confirmTimeoutMs: 5_000,
    });
    expect(r1.signature).toBe('5j7s' + 'A'.repeat(60));
    expect(deps.solana.sendRawTransaction).toHaveBeenCalledTimes(1);

    // 2ª chamada com adapters NOVOS (store cliente limpo) mas mesmo signed.bytes
    // (signTransaction determinístico) → idempotency-key idêntica → backend deduplica
    const adapters2 = createBackendSwapAdapters({
      apiBaseUrl: baseUrl,
      signTransaction: mockSign,
    });
    const r2 = await executeSwap(
      { ...baseRequest },
      adapters2,
      {
        correlationId: 'int-test-idemp-2',
        confirmTimeoutMs: 5_000,
      },
    );
    expect(r2.signature).toBe('5j7s' + 'A'.repeat(60)); // mesma signature retornada

    // ESSENCIAL: Solana.sendRawTransaction foi chamada EXATAMENTE 1 vez,
    // mesmo após 2 swaps end-to-end (idempotency do backend deduplica).
    expect(deps.solana.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
