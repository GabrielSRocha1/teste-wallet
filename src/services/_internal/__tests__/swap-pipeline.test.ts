import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker';
import { clearLogSinks } from '../logger';
import {
  executeSwap,
  InMemoryIdempotencyStore,
  makeIdempotencyKey,
} from '../swap-pipeline';
import {
  BlockhashExpiredError,
  ConfirmationFailedError,
  DuplicateInFlightError,
  type Quote,
  QuoteStaleError,
  SimulationFailedError,
  SlippageExceededError,
  type SwapAdapters,
  type SwapRequest,
  VerificationFailedError,
} from '../swap-pipeline.types';

// Silencia o logger global durante os testes (re-criado uma vez no module load).
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
    route: { provider: 'jupiter', id: 'test-route' },
    ...overrides,
  };
}

interface MakeAdaptersOpts {
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  nowImpl?: () => number;
  idempotencyStore?: InMemoryIdempotencyStore;
  circuitBreaker?: CircuitBreaker;
}

function makeAdapters(
  overrides: Partial<SwapAdapters> = {},
  opts: MakeAdaptersOpts = {},
): SwapAdapters {
  const defaults: SwapAdapters = {
    quote: vi.fn(async () => makeQuote()),
    buildTx: vi.fn(async () => ({ serialized: 'tx-built-b64', isVersioned: true })),
    simulate: vi.fn(async () => ({ err: null, logs: ['Program ok'], unitsConsumed: 100_000 })),
    refreshBlockhash: vi.fn(async () => ({ blockhash: 'bh-fresh', lastValidBlockHeight: 12_345 })),
    applyBlockhashTo: vi.fn((tx, bh) => ({ ...tx, meta: { blockhash: bh.blockhash } })),
    sign: vi.fn(async (tx) => ({ ...tx, signature: 'sigB58' })),
    send: vi.fn(async () => 'sigB58'),
    confirm: vi.fn(async () => ({ state: 'confirmed' as const, slot: 99_999 })),
    verify: vi.fn(async () => ({ ok: true, observedOutAmount: '1000000', deltaBps: 0 })),
    now: opts.nowImpl ?? (() => FIXED_NOW),
    idempotencyStore: opts.idempotencyStore ?? new InMemoryIdempotencyStore(),
    circuitBreaker:
      opts.circuitBreaker ??
      new CircuitBreaker({
        name: 'test-breaker',
        failureThreshold: opts.breakerThreshold ?? 3,
        cooldownMs: opts.breakerCooldownMs ?? 100,
        rollingWindowMs: 60_000,
      }),
  };
  return { ...defaults, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — happy path', () => {
  it('completa a pipeline na sequência correta e retorna SwapResult', async () => {
    const adapters = makeAdapters();
    const result = await executeSwap(baseRequest, adapters);

    expect(result.signature).toBe('sigB58');
    expect(result.verified.ok).toBe(true);
    expect(result.confirmed.state).toBe('confirmed');
    expect(result.blockhashUsed.blockhash).toBe('bh-fresh');

    expect(adapters.quote).toHaveBeenCalledTimes(1);
    expect(adapters.buildTx).toHaveBeenCalledTimes(1);
    expect(adapters.simulate).toHaveBeenCalledTimes(1);
    expect(adapters.refreshBlockhash).toHaveBeenCalledTimes(1);
    expect(adapters.applyBlockhashTo).toHaveBeenCalledTimes(1);
    expect(adapters.sign).toHaveBeenCalledTimes(1);
    expect(adapters.send).toHaveBeenCalledTimes(1);
    expect(adapters.confirm).toHaveBeenCalledTimes(1);
    expect(adapters.verify).toHaveBeenCalledTimes(1);
  });

  it('refresh de blockhash ocorre IMEDIATAMENTE antes do sign', async () => {
    const events: string[] = [];
    const adapters = makeAdapters({
      refreshBlockhash: vi.fn(async () => {
        events.push('refreshBlockhash');
        return { blockhash: 'bh-fresh', lastValidBlockHeight: 12_345 };
      }),
      applyBlockhashTo: vi.fn((tx, bh) => {
        events.push('applyBlockhashTo');
        return { ...tx, meta: { blockhash: bh.blockhash } };
      }),
      sign: vi.fn(async (tx) => {
        events.push('sign');
        return { ...tx, signature: 'sigB58' };
      }),
    });

    await executeSwap(baseRequest, adapters);
    expect(events).toEqual(['refreshBlockhash', 'applyBlockhashTo', 'sign']);
  });

  it('send é chamado EXATAMENTE 1 vez no caminho feliz', async () => {
    const adapters = makeAdapters();
    await executeSwap(baseRequest, adapters);
    expect(adapters.send).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — validação de quote', () => {
  it('rejeita com QuoteStaleError quando idade > TTL', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ fetchedAt: FIXED_NOW - 60_000, ttlMs: 30_000 })),
    });

    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(QuoteStaleError);
    expect(adapters.buildTx).not.toHaveBeenCalled();
    expect(adapters.send).not.toHaveBeenCalled();
  });

  it('rejeita com SlippageExceededError quando outAmount < minOutAmount', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ outAmount: '900000', minOutAmount: '950000' })),
    });

    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(SlippageExceededError);
    expect(adapters.send).not.toHaveBeenCalled();
  });

  it('re-valida quote DEPOIS de buildTx/simulate/refreshBlockhash (paranoia)', async () => {
    let nowCalls = 0;
    const adapters = makeAdapters({
      quote: vi.fn(async () => makeQuote({ fetchedAt: FIXED_NOW, ttlMs: 1_000 })),
      now: () => {
        nowCalls++;
        // 1ª call (startedAt) e 2ª call (1ª validateQuote) → dentro do TTL.
        // 3ª call em diante (2ª validateQuote pós-refresh) → fora do TTL.
        return nowCalls <= 2 ? FIXED_NOW : FIXED_NOW + 2_000;
      },
    });

    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(QuoteStaleError);
    expect(adapters.buildTx).toHaveBeenCalled();
    expect(adapters.simulate).toHaveBeenCalled();
    expect(adapters.refreshBlockhash).toHaveBeenCalled();
    expect(adapters.sign).not.toHaveBeenCalled();
    expect(adapters.send).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — simulação', () => {
  it('rejeita com SimulationFailedError quando simulate retorna err; send NUNCA é chamado', async () => {
    const adapters = makeAdapters({
      simulate: vi.fn(async () => ({
        err: { InstructionError: [0, 'InsufficientFunds'] },
        logs: ['Program failed: insufficient funds'],
      })),
    });

    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(SimulationFailedError);
    expect(adapters.sign).not.toHaveBeenCalled();
    expect(adapters.send).not.toHaveBeenCalled();
  });

  it('SimulationFailedError NÃO conta no circuit breaker (5 falhas → breaker continua CLOSED)', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 100,
      rollingWindowMs: 60_000,
    });
    for (let i = 0; i < 5; i++) {
      const adapters = makeAdapters(
        {
          simulate: vi.fn(async () => ({
            err: { InstructionError: [0, 'X'] },
            logs: [],
          })),
        },
        { circuitBreaker: breaker },
      );
      await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
        SimulationFailedError,
      );
    }
    expect(breaker.state).toBe('CLOSED');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — confirmação', () => {
  it('lança BlockhashExpiredError quando confirm.state="expired"', async () => {
    const adapters = makeAdapters({
      confirm: vi.fn(async () => ({ state: 'expired' as const, slot: 0 })),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(BlockhashExpiredError);
    expect(adapters.send).toHaveBeenCalledTimes(1); // send aconteceu; confirm é que expirou
  });

  it('lança ConfirmationFailedError quando confirm.state="failed"', async () => {
    const adapters = makeAdapters({
      confirm: vi.fn(async () => ({
        state: 'failed' as const,
        err: { InstructionError: [0, 'Custom(42)'] },
      })),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
      ConfirmationFailedError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — verificação', () => {
  it('lança VerificationFailedError quando verify.ok=false', async () => {
    const adapters = makeAdapters({
      verify: vi.fn(async () => ({
        ok: false,
        observedOutAmount: '500000',
        deltaBps: -5000,
        reason: 'observed-below-min',
      })),
    });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
      VerificationFailedError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — idempotency', () => {
  it('retorna resultado cacheado em chamada repetida com state=completed', async () => {
    const store = new InMemoryIdempotencyStore();
    const adapters1 = makeAdapters({}, { idempotencyStore: store });
    const result1 = await executeSwap(baseRequest, adapters1);

    const adapters2 = makeAdapters({}, { idempotencyStore: store });
    const result2 = await executeSwap(baseRequest, adapters2);

    expect(result2).toEqual(result1);
    expect(adapters2.quote).not.toHaveBeenCalled();
    expect(adapters2.send).not.toHaveBeenCalled();
  });

  it('rejeita com DuplicateInFlightError quando state=in_flight', async () => {
    const store = new InMemoryIdempotencyStore();
    const key = makeIdempotencyKey(baseRequest);
    await store.set(key, { state: 'in_flight', startedAt: FIXED_NOW }, 60_000);

    const adapters = makeAdapters({}, { idempotencyStore: store });
    await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
      DuplicateInFlightError,
    );
    expect(adapters.quote).not.toHaveBeenCalled();
  });

  it('permite re-execução quando state=failed (limpa registro antigo)', async () => {
    const store = new InMemoryIdempotencyStore();
    const key = makeIdempotencyKey(baseRequest);
    await store.set(
      key,
      { state: 'failed', startedAt: FIXED_NOW, error: 'old failure' },
      60_000,
    );

    const adapters = makeAdapters({}, { idempotencyStore: store });
    const result = await executeSwap(baseRequest, adapters);
    expect(result.signature).toBe('sigB58');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('makeIdempotencyKey', () => {
  it('produz a mesma key para o mesmo input', () => {
    expect(makeIdempotencyKey(baseRequest)).toBe(makeIdempotencyKey({ ...baseRequest }));
  });

  it('produz keys diferentes ao variar qualquer campo crítico', () => {
    const base = makeIdempotencyKey(baseRequest);
    expect(makeIdempotencyKey({ ...baseRequest, inputAmount: '999' })).not.toBe(base);
    expect(makeIdempotencyKey({ ...baseRequest, slippageBps: 100 })).not.toBe(base);
    expect(makeIdempotencyKey({ ...baseRequest, network: 'devnet' })).not.toBe(base);
    expect(makeIdempotencyKey({ ...baseRequest, outputMint: 'X'.repeat(43) })).not.toBe(base);
    expect(makeIdempotencyKey({ ...baseRequest, userPublicKey: 'Y'.repeat(43) })).not.toBe(base);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — retries & circuit breaker', () => {
  it('retry em erro 429 transitório no quote — sucesso na 2ª tentativa', async () => {
    let attempts = 0;
    const adapters = makeAdapters({
      quote: vi.fn(async () => {
        attempts++;
        if (attempts === 1) throw new Error('HTTP 429 Too Many Requests');
        return makeQuote();
      }),
    });

    const result = await executeSwap(baseRequest, adapters, { maxRpcAttempts: 3 });
    expect(result.signature).toBe('sigB58');
    expect(attempts).toBe(2);
  });

  it('propaga erro depois de esgotar maxRpcAttempts', async () => {
    const adapters = makeAdapters({
      quote: vi.fn(async () => {
        throw new Error('HTTP 503 Service Unavailable');
      }),
    });
    await expect(executeSwap(baseRequest, adapters, { maxRpcAttempts: 2 })).rejects.toThrow(/503/);
    expect(adapters.quote).toHaveBeenCalledTimes(2);
  });

  it('circuit breaker abre após 3 swaps falhando consecutivos em RPC', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 10_000,
      rollingWindowMs: 60_000,
    });

    for (let i = 0; i < 3; i++) {
      const adapters = makeAdapters(
        {
          quote: vi.fn(async () => {
            throw new Error('HTTP 503');
          }),
        },
        { circuitBreaker: breaker },
      );
      await expect(executeSwap(baseRequest, adapters, { maxRpcAttempts: 1 })).rejects.toThrow();
    }

    expect(breaker.state).toBe('OPEN');

    // 4ª tentativa: breaker rejeita imediatamente sem chamar adapter
    const adapters4 = makeAdapters({}, { circuitBreaker: breaker });
    await expect(executeSwap(baseRequest, adapters4)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(adapters4.quote).not.toHaveBeenCalled();
  });

  it('SlippageExceededError NÃO conta no circuit breaker', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      cooldownMs: 100,
      rollingWindowMs: 60_000,
    });
    for (let i = 0; i < 5; i++) {
      const adapters = makeAdapters(
        {
          quote: vi.fn(async () =>
            makeQuote({ outAmount: '500000', minOutAmount: '950000' }),
          ),
        },
        { circuitBreaker: breaker },
      );
      await expect(executeSwap(baseRequest, adapters)).rejects.toBeInstanceOf(
        SlippageExceededError,
      );
    }
    expect(breaker.state).toBe('CLOSED');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('executeSwap — abort signal', () => {
  it('aborta in-flight quando AbortSignal externo dispara durante retries', async () => {
    const controller = new AbortController();
    const adapters = makeAdapters({
      quote: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error('HTTP 503');
      }),
    });

    const promise = executeSwap(baseRequest, adapters, {
      signal: controller.signal,
      maxRpcAttempts: 5,
    });
    setTimeout(() => controller.abort(new Error('user-cancelled')), 10);
    await expect(promise).rejects.toThrow();
  });
});
