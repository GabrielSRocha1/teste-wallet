import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../_internal/circuit-breaker';
import { setLogLevel } from '../_internal/logger';
import { JupiterClient } from '../adapters/jupiter';
import {
  type Commitment,
  SolanaRpcClient,
  type SolanaConnectionLike,
} from '../adapters/solana-rpc';

// Silencia logs do backend durante a suite (só erros fatais aparecem).
setLogLevel('fatal');

// ──────────────────────────────────────────────────────────────────────────────
// JupiterClient
// ──────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const happyQuote = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inAmount: '1000000',
  outAmount: '950000',
  otherAmountThreshold: '900000',
  swapMode: 'ExactIn',
  slippageBps: 50,
  priceImpactPct: '0.005',
  routePlan: [],
};

const happySwap = {
  swapTransaction: 'BASE64_TX_BYTES',
  lastValidBlockHeight: 12_345,
  prioritizationFeeLamports: 1_000,
};

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeJupiterClient(): JupiterClient {
  return new JupiterClient({
    baseUrl: 'https://test.jup.ag',
    breaker: new CircuitBreaker({ name: 'jupiter-test', failureThreshold: 99, cooldownMs: 1_000 }),
    quoteTimeoutMs: 1_000,
    swapTimeoutMs: 1_000,
    maxAttempts: 3,
    fetchImpl: mockFetch as unknown as typeof fetch,
  });
}

describe('JupiterClient.getQuote', () => {
  it('retorna quote parseada quando resposta é válida', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(happyQuote));
    const client = makeJupiterClient();

    const result = await client.getQuote({
      inputMint: happyQuote.inputMint,
      outputMint: happyQuote.outputMint,
      amount: '1000000',
      slippageBps: 50,
    });

    expect(result.outAmount).toBe('950000');
    expect(result.inputMint).toBe(happyQuote.inputMint);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retry em 429 transitório — sucesso na 2ª tentativa', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(happyQuote));
    const client = makeJupiterClient();

    const result = await client.getQuote({
      inputMint: 'a',
      outputMint: 'b',
      amount: '1',
      slippageBps: 50,
    });

    expect(result.outAmount).toBe('950000');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('propaga erro após esgotar maxAttempts em 503 persistente', async () => {
    mockFetch.mockResolvedValue(new Response('down', { status: 503 }));
    const client = makeJupiterClient();

    await expect(
      client.getQuote({ inputMint: 'a', outputMint: 'b', amount: '1', slippageBps: 50 }),
    ).rejects.toThrow(/503/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('inclui platformFeeBps no query string quando fornecido', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(happyQuote));
    const client = makeJupiterClient();

    await client.getQuote({
      inputMint: 'a',
      outputMint: 'b',
      amount: '1',
      slippageBps: 50,
      platformFeeBps: 200,
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('platformFeeBps=200');
    expect(url).toContain('slippageBps=50');
  });

  it('rejeita quando resposta não satisfaz o schema Zod', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));
    const client = makeJupiterClient();

    await expect(
      client.getQuote({ inputMint: 'a', outputMint: 'b', amount: '1', slippageBps: 50 }),
    ).rejects.toThrow();
  });
});

describe('JupiterClient.getSwapTransaction', () => {
  it('retorna swapTransaction válida parseada', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(happySwap));
    const client = makeJupiterClient();

    const result = await client.getSwapTransaction({
      quoteResponse: happyQuote as never,
      userPublicKey: 'OwnerPK111111111111111111111111111',
    });

    expect(result.swapTransaction).toBe('BASE64_TX_BYTES');
    expect(result.lastValidBlockHeight).toBe(12_345);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SolanaRpcClient
// ──────────────────────────────────────────────────────────────────────────────

function makeFakeConnection(
  endpoint: string,
  overrides: Partial<SolanaConnectionLike> = {},
): SolanaConnectionLike {
  return {
    rpcEndpoint: endpoint,
    getLatestBlockhash: vi.fn(async (_commitment?: Commitment) => ({
      blockhash: 'bh-fresh',
      lastValidBlockHeight: 1_000,
    })),
    simulateTransaction: vi.fn(async () => ({
      context: { slot: 1 },
      value: { err: null, logs: ['ok'], unitsConsumed: 100 },
    })),
    sendRawTransaction: vi.fn(async () => 'sigB58'),
    getSignatureStatuses: vi.fn(async () => ({
      context: { slot: 1 },
      value: [{ slot: 1, confirmations: 1, confirmationStatus: 'confirmed' as const, err: null }],
    })),
    getBalance: vi.fn(async () => 1_000_000),
    ...overrides,
  };
}

describe('SolanaRpcClient — failover', () => {
  it('usa primary quando ele está saudável', async () => {
    const primaryConn = makeFakeConnection('https://primary.example');
    const fallbackConn = makeFakeConnection('https://fallback.example');
    const factory = vi.fn((url) => (url === 'https://primary.example' ? primaryConn : fallbackConn));

    const client = new SolanaRpcClient({
      primary: 'https://primary.example',
      fallbacks: ['https://fallback.example'],
      connectionFactory: factory,
    });

    const bh = await client.getLatestBlockhash('finalized');
    expect(bh.blockhash).toBe('bh-fresh');
    expect(primaryConn.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(fallbackConn.getLatestBlockhash).not.toHaveBeenCalled();
  });

  it('falha pro fallback quando primary lança erro persistente', async () => {
    const primaryConn = makeFakeConnection('https://primary.example', {
      getLatestBlockhash: vi.fn(async () => {
        throw new Error('HTTP 503 Service Unavailable');
      }),
    });
    const fallbackConn = makeFakeConnection('https://fallback.example');
    const factory = (url: string) =>
      url === 'https://primary.example' ? primaryConn : fallbackConn;

    const client = new SolanaRpcClient({
      primary: 'https://primary.example',
      fallbacks: ['https://fallback.example'],
      connectionFactory: factory,
      maxAttempts: 1, // sem retry interno para acelerar o teste
    });

    const bh = await client.getLatestBlockhash('finalized');
    expect(bh.blockhash).toBe('bh-fresh');
    expect(primaryConn.getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(fallbackConn.getLatestBlockhash).toHaveBeenCalledTimes(1);
  });

  it('isola breakers por endpoint — primary OPEN não impede fallback', async () => {
    const primaryConn = makeFakeConnection('https://primary.example', {
      getLatestBlockhash: vi.fn(async () => {
        throw new Error('HTTP 503');
      }),
    });
    const fallbackConn = makeFakeConnection('https://fallback.example');
    const factory = (url: string) =>
      url === 'https://primary.example' ? primaryConn : fallbackConn;

    const client = new SolanaRpcClient({
      primary: 'https://primary.example',
      fallbacks: ['https://fallback.example'],
      connectionFactory: factory,
      maxAttempts: 1,
      breakerOptions: { failureThreshold: 2, cooldownMs: 60_000, rollingWindowMs: 60_000 },
    });

    // Dispara 2 falhas no primary para abrir o breaker dele
    await client.getLatestBlockhash('finalized');
    await client.getLatestBlockhash('finalized');

    const snapshotAfter = client.snapshot();
    expect(snapshotAfter.find((s) => s.endpoint.includes('primary'))!.state).toBe('OPEN');
    expect(snapshotAfter.find((s) => s.endpoint.includes('fallback'))!.state).toBe('CLOSED');

    // 3ª chamada — primary já OPEN, vai direto ao fallback sem chamar primary
    const callsPrimaryBefore = (primaryConn.getLatestBlockhash as ReturnType<typeof vi.fn>).mock
      .calls.length;
    const bh = await client.getLatestBlockhash('finalized');
    const callsPrimaryAfter = (primaryConn.getLatestBlockhash as ReturnType<typeof vi.fn>).mock
      .calls.length;

    expect(bh.blockhash).toBe('bh-fresh');
    expect(callsPrimaryAfter).toBe(callsPrimaryBefore); // primary NÃO foi chamado
    expect(fallbackConn.getLatestBlockhash).toHaveBeenCalledTimes(3); // 1ª, 2ª e 3ª todas no fallback
  });

  it('sendRawTransaction NÃO retenta dentro do mesmo endpoint', async () => {
    const primaryConn = makeFakeConnection('https://primary.example', {
      sendRawTransaction: vi.fn(async () => {
        throw new Error('HTTP 503');
      }),
    });
    const fallbackConn = makeFakeConnection('https://fallback.example');
    const factory = (url: string) =>
      url === 'https://primary.example' ? primaryConn : fallbackConn;

    const client = new SolanaRpcClient({
      primary: 'https://primary.example',
      fallbacks: ['https://fallback.example'],
      connectionFactory: factory,
      maxAttempts: 5, // mesmo com 5 attempts configurados, send é retryable:false → 1 attempt
    });

    const sig = await client.sendRawTransaction(Buffer.from([1, 2, 3]));
    expect(sig).toBe('sigB58');
    // Primary deve ter sido chamado EXATAMENTE 1 vez (sem retry interno)
    expect(primaryConn.sendRawTransaction).toHaveBeenCalledTimes(1);
    // Fallback recebeu broadcast com bytes idênticos (failover seguro)
    expect(fallbackConn.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
