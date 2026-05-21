import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker';
import { clearLogSinks } from '../logger';
import { createBackendSwapAdapters } from '../backend-adapters';
import { InMemoryIdempotencyStore } from '../swap-pipeline';
import type {
  AdapterContext,
  BlockhashInfo,
  Quote,
  SerializedTx,
  SignedTx,
  SwapRequest,
} from '../swap-pipeline.types';

clearLogSinks();

const API_BASE = 'https://backend.test';

const baseRequest: SwapRequest = {
  userPublicKey: 'OwnerPK11111111111111111111111111111111111',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inputAmount: '1000000',
  slippageBps: 50,
  network: 'mainnet',
};

function makeCtx(): AdapterContext {
  return { signal: new AbortController().signal, correlationId: 'corr-test' };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockSign = async (tx: SerializedTx): Promise<SignedTx> => ({
  ...tx,
  signature: 'mockSignature',
});

function makeAdapters() {
  return createBackendSwapAdapters({
    apiBaseUrl: API_BASE,
    signTransaction: mockSign,
    fetchImpl: mockFetch as unknown as typeof fetch,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
describe('createBackendSwapAdapters — defaults', () => {
  it('instancia store e breaker padrão quando não fornecidos', () => {
    const adapters = makeAdapters();
    expect(adapters.idempotencyStore).toBeInstanceOf(InMemoryIdempotencyStore);
    expect(adapters.circuitBreaker).toBeInstanceOf(CircuitBreaker);
    expect(adapters.circuitBreaker.state).toBe('CLOSED');
  });

  it('respeita store e breaker injetados', () => {
    const store = new InMemoryIdempotencyStore();
    const breaker = new CircuitBreaker({ name: 'custom', failureThreshold: 99 });
    const adapters = createBackendSwapAdapters({
      apiBaseUrl: API_BASE,
      signTransaction: mockSign,
      fetchImpl: mockFetch as unknown as typeof fetch,
      idempotencyStore: store,
      circuitBreaker: breaker,
    });
    expect(adapters.idempotencyStore).toBe(store);
    expect(adapters.circuitBreaker).toBe(breaker);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('quote adapter', () => {
  it('faz POST /api/swap/quote com body correto e parseia Quote', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        quote: {
          outAmount: '950000',
          otherAmountThreshold: '900000',
          priceImpactPct: '0.005',
          inputMint: baseRequest.inputMint,
          outputMint: baseRequest.outputMint,
        },
        ttlMs: 30_000,
        fetchedAt: 1_700_000_000_000,
        verumFeeBps: 200,
        verumTreasury: 'TreasuryPub',
      }),
    );
    const adapters = makeAdapters();

    const result: Quote = await adapters.quote(baseRequest, makeCtx());

    expect(result.outAmount).toBe('950000');
    expect(result.minOutAmount).toBe('900000');
    expect(result.priceImpactPct).toBeCloseTo(0.005);
    expect(result.ttlMs).toBe(30_000);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/api/swap/quote`);
    expect((opts as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((opts as RequestInit).body));
    expect(body).toEqual({
      inputMint: baseRequest.inputMint,
      outputMint: baseRequest.outputMint,
      amount: '1000000',
      slippageBps: 50,
    });
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers['x-correlation-id']).toBe('corr-test');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('buildTx adapter', () => {
  it('cacheia lastValidBlockHeight e preserva meta no SerializedTx', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        serializedTx: 'BASE64_BUILT',
        lastValidBlockHeight: 12_345,
        prioritizationFeeLamports: 1_000,
        feeAccountUsed: 'FeeAccountATA',
      }),
    );
    const adapters = makeAdapters();
    const quote: Quote = {
      outAmount: '950000',
      minOutAmount: '900000',
      priceImpactPct: 0.005,
      fetchedAt: 1,
      ttlMs: 30_000,
      route: { provider: 'jupiter' },
    };

    const tx = await adapters.buildTx(quote, baseRequest, makeCtx());

    expect(tx.serialized).toBe('BASE64_BUILT');
    expect(tx.isVersioned).toBe(true);
    expect(tx.meta?.lastValidBlockHeight).toBe(12_345);
    expect(tx.meta?.feeAccountUsed).toBe('FeeAccountATA');

    // refreshBlockhash subsequente deve usar o lvbh cached (sem HTTP)
    mockFetch.mockClear();
    const bh = await adapters.refreshBlockhash('mainnet', makeCtx());
    expect(bh.lastValidBlockHeight).toBe(12_345);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('simulate adapter', () => {
  it('faz POST /api/swap/simulate com signedTxBase64', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        err: null,
        logs: ['Program ok'],
        unitsConsumed: 100_000,
        slot: 1,
      }),
    );
    const adapters = makeAdapters();
    const tx: SerializedTx = { serialized: 'TX_BYTES', isVersioned: true };

    const result = await adapters.simulate(tx, makeCtx());

    expect(result.err).toBeNull();
    expect(result.logs).toEqual(['Program ok']);
    expect(result.unitsConsumed).toBe(100_000);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(String((opts as RequestInit).body));
    expect(body.signedTxBase64).toBe('TX_BYTES');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('refreshBlockhash adapter', () => {
  it('faz fallback HTTP GET quando build ainda não rodou', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        blockhash: 'fresh-bh',
        lastValidBlockHeight: 99_999,
        commitment: 'finalized',
      }),
    );
    const adapters = makeAdapters();

    const bh = await adapters.refreshBlockhash('mainnet', makeCtx());

    expect(bh.blockhash).toBe('fresh-bh');
    expect(bh.lastValidBlockHeight).toBe(99_999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/swap/blockhash');
    expect((opts as RequestInit).method).toBe('GET');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('send adapter (broadcast)', () => {
  it('envia Idempotency-Key derivada do signed.serialized', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ signature: 'sigB58FromBackend', broadcastAt: 1 }),
    );
    const adapters = makeAdapters();
    const signed: SignedTx = {
      serialized: 'SIGNED_TX_BYTES',
      isVersioned: true,
      signature: 'sigB58',
    };

    const sig = await adapters.send(signed, makeCtx());

    expect(sig).toBe('sigB58FromBackend');
    const [, opts] = mockFetch.mock.calls[0];
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers['idempotency-key']).toMatch(/^verum-swap-[a-f0-9]{48}$/);
  });

  it('mesma signedTx → mesma idempotency key (estabilidade)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ signature: 's1', broadcastAt: 1 }))
      .mockResolvedValueOnce(jsonResponse({ signature: 's2', broadcastAt: 2 }));
    const adapters = makeAdapters();
    const signed: SignedTx = {
      serialized: 'IDENTICAL_BYTES',
      isVersioned: true,
      signature: 'sig',
    };

    await adapters.send(signed, makeCtx());
    await adapters.send(signed, makeCtx());

    const h1 = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const h2 = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(h1['idempotency-key']).toBe(h2['idempotency-key']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('confirm adapter', () => {
  it('propaga ConfirmState e slot do backend', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ state: 'confirmed', slot: 12_345, err: null }),
    );
    const adapters = makeAdapters();
    const bh: BlockhashInfo = { blockhash: 'bh', lastValidBlockHeight: 12_345 };

    const result = await adapters.confirm('sigB58', bh, makeCtx());

    expect(result.state).toBe('confirmed');
    expect(result.slot).toBe(12_345);
    expect(result.err).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('errors propagam corretamente', () => {
  it('HTTP 500 vira Error com status e body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('upstream down', { status: 500, statusText: 'Internal Server Error' }),
    );
    const adapters = makeAdapters();

    await expect(adapters.quote(baseRequest, makeCtx())).rejects.toThrow(/HTTP 500/);
  });
});
