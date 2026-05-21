import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker';
import { clearLogSinks } from '../logger';
import {
  executeSwap,
  InMemoryIdempotencyStore,
  makeIdempotencyKey,
} from '../swap-pipeline';
import {
  ConfirmationFailedError,
  type Quote,
  QuoteStaleError,
  SlippageExceededError,
  type SwapAdapters,
  type SwapRequest,
  VerificationFailedError,
} from '../swap-pipeline.types';

clearLogSinks();

const FIXED_NOW = 1_700_000_000_000;

const baseRequest: SwapRequest = {
  userPublicKey: 'OwnerPK11111111111111111111111111111111111',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  inputAmount: '1000000',
  slippageBps: 50,
  network: 'mainnet',
};

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    outAmount: '1000000',
    minOutAmount: '950000',
    priceImpactPct: 0.005,
    fetchedAt: FIXED_NOW,
    ttlMs: 30_000,
    route: { provider: 'jupiter' },
    ...overrides,
  };
}

function makeAdapters(overrides: Partial<SwapAdapters> = {}): SwapAdapters {
  const defaults: SwapAdapters = {
    quote: vi.fn(async () => makeQuote()),
    buildTx: vi.fn(async () => ({ serialized: 'tx', isVersioned: true })),
    simulate: vi.fn(async () => ({ err: null, logs: [], unitsConsumed: 100 })),
    refreshBlockhash: vi.fn(async () => ({ blockhash: 'bh', lastValidBlockHeight: 1 })),
    applyBlockhashTo: vi.fn((tx) => tx),
    sign: vi.fn(async (tx) => ({ ...tx, signature: 'sig' })),
    send: vi.fn(async () => 'sigB58'),
    confirm: vi.fn(async () => ({ state: 'confirmed' as const, slot: 1 })),
    verify: vi.fn(async () => ({ ok: true, observedOutAmount: '1000000', deltaBps: 0 })),
    now: () => FIXED_NOW,
    idempotencyStore: new InMemoryIdempotencyStore(),
    circuitBreaker: new CircuitBreaker({ name: 't', failureThreshold: 3, cooldownMs: 100 }),
  };
  return { ...defaults, ...overrides };
}

beforeEach(() => vi.clearAllMocks());

// ──────────────────────────────────────────────────────────────────────────────
// Sign failure path (wallet "desconectada"/locked)
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — sign failure path', () => {
  it('sign throws → pipeline propaga; send NUNCA é chamado', async () => {
    class WalletLocked extends Error {
      constructor() {
        super('wallet locked');
        this.name = 'WalletLockedError';
      }
    }
    const adapters = makeAdapters({
      sign: vi.fn(async () => {
        throw new WalletLocked();
      }),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toThrow(/wallet locked/);
    expect(adapters.send).not.toHaveBeenCalled();
  });

  it('sign que retorna SignedTx sem campo signature ainda assim chega ao send', async () => {
    // O pipeline NÃO valida a signature — confia no adapter. Documenta o contrato.
    const adapters = makeAdapters({
      sign: vi.fn(async (tx) => ({ ...tx, signature: '' })),
    });
    const result = await executeSwap(baseRequest, adapters);
    expect(adapters.send).toHaveBeenCalledTimes(1);
    expect(result.signature).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Confirmation & verification edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — confirmation/verification edge cases', () => {
  it('confirm state=failed propaga err object completo em ConfirmationFailedError', async () => {
    const customErr = { InstructionError: [0, { Custom: 42 }] };
    const adapters = makeAdapters({
      confirm: vi.fn(async () => ({ state: 'failed' as const, err: customErr })),
    });
    try {
      await executeSwap(baseRequest, adapters);
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfirmationFailedError);
      expect((err as ConfirmationFailedError).confirmErr).toEqual(customErr);
    }
  });

  it('verify ok=false propaga reason em VerificationFailedError', async () => {
    const adapters = makeAdapters({
      verify: vi.fn(async () => ({
        ok: false,
        observedOutAmount: '0',
        deltaBps: -10_000,
        reason: 'tx-not-found',
      })),
    });
    try {
      await executeSwap(baseRequest, adapters);
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(VerificationFailedError);
      expect((err as VerificationFailedError).verification.reason).toBe('tx-not-found');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BigInt precision in slippage validation
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — BigInt precision em validateQuote', () => {
  it('out=2^60, min=2^59 → passa (out > min) sem perda de precisão', async () => {
    const out = (BigInt(1) << BigInt(60)).toString();
    const min = (BigInt(1) << BigInt(59)).toString();
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ outAmount: out, minOutAmount: min })),
    });
    const result = await executeSwap(baseRequest, adapters);
    expect(result.signature).toBeTruthy();
  });

  it('out=2^60-1, min=2^60 → falha (out < min) com SlippageExceededError', async () => {
    const out = ((BigInt(1) << BigInt(60)) - 1n).toString();
    const min = (BigInt(1) << BigInt(60)).toString();
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ outAmount: out, minOutAmount: min })),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
      SlippageExceededError,
    );
  });

  it('outAmount não-numérico em quote → SlippageExceededError (não crash)', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ outAmount: 'not-a-number' as never })),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
      SlippageExceededError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Slippage bounds
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — slippage bounds', () => {
  it('slippageBps negativo no request → SlippageExceededError', async () => {
    const adapters = makeAdapters();
    await expect(
      executeSwap({ ...baseRequest, slippageBps: -1 }, adapters),
    ).rejects.toBeInstanceOf(SlippageExceededError);
  });

  it('slippageBps > 1000 (10%) → SlippageExceededError', async () => {
    const adapters = makeAdapters();
    await expect(
      executeSwap({ ...baseRequest, slippageBps: 1001 }, adapters),
    ).rejects.toBeInstanceOf(SlippageExceededError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Quote TTL boundary
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — QuoteStaleError no boundary', () => {
  it('idade = ttl + 1 ms → QuoteStaleError', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () =>
        makeQuote({ fetchedAt: FIXED_NOW - 30_001, ttlMs: 30_000 }),
      ),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(QuoteStaleError);
  });

  it('idade = ttl exato → passa (boundary inclusivo do upper bound do válido)', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ fetchedAt: FIXED_NOW - 30_000, ttlMs: 30_000 })),
    });
    await expect(executeSwap(baseRequest, adapters)).resolves.toMatchObject({
      signature: expect.any(String),
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Retry configuration
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline — maxRpcAttempts=1 desabilita retry interno', () => {
  it('quote falha 1x → erro propaga imediatamente sem retry', async () => {
    let attempts = 0;
    const adapters = makeAdapters({
      quote: vi.fn(async () => {
        attempts++;
        throw new Error('HTTP 503');
      }),
    });
    await expect(executeSwap(baseRequest, adapters, { maxRpcAttempts: 1 })).rejects.toThrow(
      /503/,
    );
    expect(attempts).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Idempotency key inclui routePreference
// ──────────────────────────────────────────────────────────────────────────────

describe('makeIdempotencyKey — routePreference', () => {
  it('mesmo request com routePreference diferente → keys diferentes', () => {
    const k1 = makeIdempotencyKey({ ...baseRequest, routePreference: 'jupiter' });
    const k2 = makeIdempotencyKey({ ...baseRequest, routePreference: 'raydium' });
    const k3 = makeIdempotencyKey({ ...baseRequest, routePreference: 'auto' });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k2).not.toBe(k3);
  });

  it('routePreference ausente trata como "auto" implícito', () => {
    const kImplicit = makeIdempotencyKey({ ...baseRequest });
    const kAuto = makeIdempotencyKey({ ...baseRequest, routePreference: 'auto' });
    expect(kImplicit).toBe(kAuto);
  });
});
