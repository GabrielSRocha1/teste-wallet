import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppDeps, createApp } from '../server';
import type { Env } from '../_internal/env';
import { setLogLevel } from '../_internal/logger';
import { MetricsRegistry } from '../_internal/metrics';
import type { JupiterClient } from '../adapters/jupiter';
import type {
  Commitment,
  SolanaRpcClient,
} from '../adapters/solana-rpc';

setLogLevel('fatal');

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
  ALLOWED_ORIGINS: ['http://localhost:8081', 'http://localhost:19006'],
  SUPABASE_URL: undefined,
  SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  DIDIT_API_BASE: 'https://verification.didit.me',
  DIDIT_API_KEY: undefined,
  DIDIT_WORKFLOW_ID: undefined,
  DIDIT_WEBHOOK_SECRET: undefined,
  DIDIT_CALLBACK_URL: 'verumwallet://kyc-callback',
};

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
      swapTransaction: 'BASE64_BUILT_TX',
      lastValidBlockHeight: 12_345,
      prioritizationFeeLamports: 1_000,
    })),
  } as unknown as JupiterClient;
}

function makeMockSolana(): SolanaRpcClient {
  return {
    getLatestBlockhash: vi.fn(async (_commitment?: Commitment) => ({
      blockhash: 'bh-fresh',
      lastValidBlockHeight: 12_345,
    })),
    simulateTransaction: vi.fn(async () => ({
      err: null,
      logs: ['Program ok'],
      unitsConsumed: 100_000,
      slot: 1,
    })),
    sendRawTransaction: vi.fn(async () => 'sigB58FromMock'),
    getSignatureStatuses: vi.fn(async () => [
      { slot: 1, confirmations: 1, confirmationStatus: 'confirmed' as const, err: null },
    ]),
    getBalance: vi.fn(async () => 1_000_000),
    snapshot: vi.fn(() => [
      { endpoint: TEST_ENV.SOLANA_RPC_PRIMARY, state: 'CLOSED', failures: 0, cooldownRemainingMs: 0 },
    ]),
  } as unknown as SolanaRpcClient;
}

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

describe('GET /api/healthz', () => {
  it('retorna 200 com snapshot de breakers e env', async () => {
    const res = await fetch(`${baseUrl}/api/healthz`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.env).toBe('test');
    expect(json.jupiter).toEqual({ circuitState: 'CLOSED' });
    expect(Array.isArray(json.solana)).toBe(true);
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });
});

describe('POST /api/swap/quote', () => {
  it('retorna quote do Jupiter no caminho feliz', async () => {
    const res = await fetch(`${baseUrl}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        slippageBps: 50,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.quote as Record<string, unknown>).outAmount).toBe('950000');
    expect(json.verumFeeBps).toBe(200);
    expect(deps.jupiter.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ platformFeeBps: 200, slippageBps: 50 }),
    );
  });

  it('retorna 400 quando o body é inválido', async () => {
    const res = await fetch(`${baseUrl}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: 'tooshort',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 'not-numeric',
        slippageBps: 99999,
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('ValidationError');
    expect(Array.isArray(json.issues)).toBe(true);
    expect((json.issues as unknown[]).length).toBeGreaterThan(0);
    expect(deps.jupiter.getQuote).not.toHaveBeenCalled();
  });
});

describe('GET /api/swap/blockhash', () => {
  it('retorna blockhash e lastValidBlockHeight', async () => {
    const res = await fetch(`${baseUrl}/api/swap/blockhash?commitment=finalized`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.blockhash).toBe('bh-fresh');
    expect(json.lastValidBlockHeight).toBe(12_345);
    expect(json.commitment).toBe('finalized');
    expect(deps.solana.getLatestBlockhash).toHaveBeenCalledWith('finalized');
  });
});

describe('POST /api/swap/broadcast', () => {
  it('invoca solana.sendRawTransaction e retorna signature', async () => {
    // 64-byte minimum signature in payload to pass size check
    const fakeTxBytes = Buffer.alloc(200, 0x01);
    const res = await fetch(`${baseUrl}/api/swap/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTxBase64: fakeTxBytes.toString('base64') }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.signature).toBe('sigB58FromMock');
    expect(deps.solana.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejeita TX fora dos limites Solana (64-1232B)', async () => {
    const tooSmall = Buffer.alloc(10, 0x01);
    const res = await fetch(`${baseUrl}/api/swap/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTxBase64: tooSmall.toString('base64') }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('InvalidTransactionSize');
    expect(deps.solana.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe('errorHandler', () => {
  it('mapeia erro de adapter para 502 com JSON e correlationId', async () => {
    (deps.solana.getLatestBlockhash as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('RPC explodiu'),
    );
    const res = await fetch(`${baseUrl}/api/swap/blockhash`);
    expect(res.status).toBe(502);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('UpstreamError');
    expect(json.message).toContain('RPC explodiu');
    expect(json.correlationId).toBeTruthy();
  });

  it('retorna 404 JSON para rotas desconhecidas', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('NotFound');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Observability — metrics
// ──────────────────────────────────────────────────────────────────────────────

describe('observability — metrics wiring', () => {
  it('GET /api/metrics retorna snapshots após operação', async () => {
    // Dispara um quote para popular as métricas
    await fetch(`${baseUrl}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        slippageBps: 50,
      }),
    });

    const res = await fetch(`${baseUrl}/api/metrics`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { timestamp: string; metrics: unknown[] };
    expect(typeof json.timestamp).toBe('string');
    expect(Array.isArray(json.metrics)).toBe(true);
    expect(json.metrics.length).toBeGreaterThan(0);
  });

  it('quote bem-sucedido incrementa counter swap.quote.total{outcome=success}', async () => {
    const successBefore = deps.metrics.counter('swap.quote.total').get({ outcome: 'success' });
    await fetch(`${baseUrl}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        slippageBps: 50,
      }),
    });
    const successAfter = deps.metrics.counter('swap.quote.total').get({ outcome: 'success' });
    expect(successAfter).toBeGreaterThan(successBefore);
  });

  it('falha upstream em quote incrementa counter outcome=failure com tag error', async () => {
    (deps.jupiter.getQuote as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('jupiter down'));
    const failureBefore = deps.metrics.counter('swap.quote.total').series().filter((s) => s.tags.outcome === 'failure').reduce((sum, s) => sum + s.value, 0);

    await fetch(`${baseUrl}/api/swap/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        slippageBps: 50,
      }),
    });

    const failureAfter = deps.metrics.counter('swap.quote.total').series().filter((s) => s.tags.outcome === 'failure').reduce((sum, s) => sum + s.value, 0);
    expect(failureAfter).toBeGreaterThan(failureBefore);
  });
});
