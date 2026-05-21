import { describe, expect, it, vi } from 'vitest';
import { setLogLevel } from '../_internal/logger';
import { QuorumFailedError, QuorumReader } from '../adapters/quorum-reader';
import type { Commitment, SolanaConnectionLike } from '../adapters/solana-rpc';

setLogLevel('fatal');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fakeConn(
  endpoint: string,
  overrides: Partial<SolanaConnectionLike> = {},
): SolanaConnectionLike {
  return {
    rpcEndpoint: endpoint,
    getLatestBlockhash: vi.fn(async () => ({ blockhash: 'bh', lastValidBlockHeight: 1 })),
    simulateTransaction: vi.fn(),
    sendRawTransaction: vi.fn(),
    getSignatureStatuses: vi.fn(),
    getBalance: vi.fn(async () => 1_000_000),
    ...overrides,
  } as unknown as SolanaConnectionLike;
}

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

// ──────────────────────────────────────────────────────────────────────────────
// runQuorum — happy path & disagreements
// ──────────────────────────────────────────────────────────────────────────────

describe('runQuorum — concordância', () => {
  it('3/3 endpoints retornam mesmo valor → quorum atingido', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) => fakeConn(ep, { getBalance: vi.fn(async () => 5_000) }),
    });
    const result = await reader.runQuorum((conn) => conn.getBalance({} as never));
    expect(result.value).toBe(5_000);
    expect(result.agreed).toBe(3);
    expect(result.total).toBe(3);
    expect(result.dissenters).toEqual([]);
  });

  it('2/3 concordam (1 retorna valor diferente) → quorum atingido', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => (ep === C ? 9_999 : 5_000)),
        }),
    });
    const result = await reader.runQuorum((conn) => conn.getBalance({} as never));
    expect(result.value).toBe(5_000);
    expect(result.agreed).toBe(2);
    expect(result.dissenters).toHaveLength(1);
    expect(result.dissenters[0].endpoint).toBe(C);
    expect(result.dissenters[0].value).toBe(9_999);
  });

  it('todos discordam (3 valores distintos) → QuorumFailedError', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => (ep === A ? 1 : ep === B ? 2 : 3)),
        }),
    });
    await expect(reader.runQuorum((conn) => conn.getBalance({} as never))).rejects.toBeInstanceOf(
      QuorumFailedError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runQuorum — failures (network/timeout)
// ──────────────────────────────────────────────────────────────────────────────

describe('runQuorum — falhas de endpoint', () => {
  it('1 endpoint erra + 2 concordam → quorum atingido', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => {
            if (ep === C) throw new Error('HTTP 503');
            return 7_000;
          }),
        }),
    });
    const result = await reader.runQuorum((conn) => conn.getBalance({} as never));
    expect(result.value).toBe(7_000);
    expect(result.agreed).toBe(2);
    expect(result.total).toBe(2); // só 2 responderam com sucesso
    expect(result.dissenters[0].endpoint).toBe(C);
    expect(result.dissenters[0].error).toContain('503');
  });

  it('2 endpoints erram + 1 sucesso → QuorumFailedError (< minQuorum)', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => {
            if (ep !== A) throw new Error('HTTP 503');
            return 7_000;
          }),
        }),
    });
    await expect(reader.runQuorum((conn) => conn.getBalance({} as never))).rejects.toBeInstanceOf(
      QuorumFailedError,
    );
  });

  it('todos erram → QuorumFailedError com dissenters carregando os erros', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => {
            throw new Error(`fail-${ep}`);
          }),
        }),
    });
    try {
      await reader.runQuorum((conn) => conn.getBalance({} as never));
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(QuorumFailedError);
      const e = err as QuorumFailedError<number>;
      expect(e.dissenters).toHaveLength(3);
      expect(e.dissenters.every((d) => d.error?.includes('fail-'))).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// minQuorum customizado
// ──────────────────────────────────────────────────────────────────────────────

describe('runQuorum — minQuorum customizado', () => {
  it('minQuorum=1: qualquer sucesso vence', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => {
            if (ep !== A) throw new Error('down');
            return 42;
          }),
        }),
      minQuorum: 1,
    });
    const result = await reader.runQuorum((conn) => conn.getBalance({} as never));
    expect(result.value).toBe(42);
    expect(result.agreed).toBe(1);
  });

  it('minQuorum=3 exige unanimidade: 2/3 concordam → falha', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => (ep === C ? 999 : 5_000)),
        }),
      minQuorum: 3,
    });
    await expect(reader.runQuorum((conn) => conn.getBalance({} as never))).rejects.toBeInstanceOf(
      QuorumFailedError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Custom isEqual
// ──────────────────────────────────────────────────────────────────────────────

describe('runQuorum — isEqual customizado', () => {
  it('comparador com tolerância agrupa valores próximos', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getBalance: vi.fn(async () => (ep === A ? 1_000_000 : ep === B ? 1_000_001 : 5_000_000)),
        }),
    });
    // Tolerância de ±10 lamports → A e B caem no mesmo bucket
    const result = await reader.runQuorum<number>(
      (conn) => conn.getBalance({} as never),
      { isEqual: (a, b) => Math.abs(a - b) <= 10 },
    );
    expect(result.agreed).toBe(2);
    expect(result.dissenters[0].value).toBe(5_000_000);
  });

  it('JSON-equal default funciona para objetos', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) =>
        fakeConn(ep, {
          getLatestBlockhash: vi.fn(async () => ({
            blockhash: ep === C ? 'different' : 'same',
            lastValidBlockHeight: 100,
          })),
        }),
    });
    const result = await reader.runQuorum((conn) => conn.getLatestBlockhash());
    expect(result.agreed).toBe(2);
    expect((result.value as { blockhash: string }).blockhash).toBe('same');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getBalance (integração com PublicKey)
// ──────────────────────────────────────────────────────────────────────────────

describe('QuorumReader.getBalance', () => {
  it('chama conn.getBalance com PublicKey e commitment, retorna quorum', async () => {
    const reader = new QuorumReader({
      endpoints: [A, B, C],
      connectionFactory: (ep) => fakeConn(ep, { getBalance: vi.fn(async () => 12_345) }),
    });
    const result = await reader.getBalance(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'confirmed' as Commitment,
    );
    expect(result.value).toBe(12_345);
    expect(result.agreed).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Input validation
// ──────────────────────────────────────────────────────────────────────────────

describe('QuorumReader — validação de construção', () => {
  it('rejeita endpoints vazio', () => {
    expect(
      () =>
        new QuorumReader({
          endpoints: [],
          connectionFactory: (ep) => fakeConn(ep),
        }),
    ).toThrow(/endpoints/);
  });

  it('rejeita minQuorum > quantidade de endpoints', () => {
    expect(
      () =>
        new QuorumReader({
          endpoints: [A, B],
          connectionFactory: (ep) => fakeConn(ep),
          minQuorum: 5,
        }),
    ).toThrow(/minQuorum/);
  });

  it('rejeita minQuorum < 1', () => {
    expect(
      () =>
        new QuorumReader({
          endpoints: [A],
          connectionFactory: (ep) => fakeConn(ep),
          minQuorum: 0,
        }),
    ).toThrow(/minQuorum/);
  });
});
