import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks padrão para importar transactionService sem tocar em nativos reais.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock('@/src/services/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: 0, error: null }),
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: 'localhost' } } }));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── (F1) buildSOLTransfer faz retry em 429/timeout do getLatestBlockhash ──

describe('transactionService — (F1) blockhash retry/timeout wrapper', () => {
  it('retry em erro 429 transitório — sucesso na 2ª tentativa', async () => {
    process.env.EXPO_PUBLIC_VERUM_TREASURY_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const { default: transactionService } = await import('../../transactionService');

    let calls = 0;
    const conn = transactionService.getConnection();
    const spy = vi.spyOn(conn, 'getLatestBlockhash').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('HTTP 429 Too Many Requests');
      return { blockhash: 'BH-OK-2nd-attempt', lastValidBlockHeight: 12345 } as any;
    });

    const tx = await transactionService.buildSOLTransfer({
      from: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      to: 'So11111111111111111111111111111111111111112',
      amount: 0.001,
      feeWallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    });

    expect(tx.recentBlockhash).toBe('BH-OK-2nd-attempt');
    expect(calls).toBe(2);
    spy.mockRestore();
  });

  it('propaga erro DEPOIS de esgotar 3 tentativas (503 persistente)', async () => {
    process.env.EXPO_PUBLIC_VERUM_TREASURY_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    const spy = vi
      .spyOn(conn, 'getLatestBlockhash')
      .mockRejectedValue(new Error('HTTP 503 Service Unavailable'));

    await expect(
      transactionService.buildSOLTransfer({
        from: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        to: 'So11111111111111111111111111111111111111112',
        amount: 0.001,
        feeWallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
    ).rejects.toThrow(/503/);

    // 3 attempts (default maxAttempts)
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('NÃO retenta erro não-retryable (ex: InvalidCommitment)', async () => {
    process.env.EXPO_PUBLIC_VERUM_TREASURY_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    const spy = vi
      .spyOn(conn, 'getLatestBlockhash')
      .mockRejectedValue(new Error('Invalid commitment level: bogus'));

    await expect(
      transactionService.buildSOLTransfer({
        from: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        to: 'So11111111111111111111111111111111111111112',
        amount: 0.001,
        feeWallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      }),
    ).rejects.toThrow(/Invalid commitment/);

    // 1 call apenas — não é erro retryable
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
