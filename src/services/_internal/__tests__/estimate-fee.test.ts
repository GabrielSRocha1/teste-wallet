import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// ─── (E9) estimateFee retorna platformFee real ──────────────────────────────

describe('transactionService.estimateFee — (E9) platformFee 2% real', () => {
  it('SEM context: platformFee=0 e verumFee=null (compat com callers legados)', async () => {
    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    vi.spyOn(conn, 'getFeeForMessage').mockResolvedValue({
      value: 5000,
      context: { slot: 1 },
    } as any);
    vi.spyOn(transactionService, 'getSOLPrice').mockResolvedValue(150);

    // Mock minimal Transaction com compileMessage que retorna algo válido
    const tx = {
      compileMessage: () => ({}),
    } as any;

    const result = await transactionService.estimateFee(tx);
    expect(result.platformFee).toBe(0);
    expect(result.verumFee).toBeNull();
    expect(result.solFee).toBeCloseTo(5000 / 1e9);
  });

  it('COM context (1 SOL @ $150): platformFee = $3 (2% × $150)', async () => {
    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    vi.spyOn(conn, 'getFeeForMessage').mockResolvedValue({
      value: 5000,
      context: { slot: 1 },
    } as any);
    vi.spyOn(transactionService, 'getSOLPrice').mockResolvedValue(150);

    const tx = { compileMessage: () => ({}) } as any;

    const result = await transactionService.estimateFee(tx, {
      amountInToken: 1,
      tokenSymbol: 'SOL',
    });
    expect(result.verumFee).toEqual({
      tokenAmount: 0.02,
      tokenSymbol: 'SOL',
      usdValue: 3,
    });
    expect(result.platformFee).toBe(3);
    expect(result.total).toBeCloseTo(result.usdFee + 3);
  });

  it('COM context USDT (100 USDT @ $1): platformFee = $2 (2% × $100)', async () => {
    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    vi.spyOn(conn, 'getFeeForMessage').mockResolvedValue({
      value: 5000,
      context: { slot: 1 },
    } as any);
    vi.spyOn(transactionService, 'getSOLPrice').mockResolvedValue(150);

    const tx = { compileMessage: () => ({}) } as any;

    const result = await transactionService.estimateFee(tx, {
      amountInToken: 100,
      tokenSymbol: 'USDT',
      tokenPriceUsd: 1,
    });
    expect(result.verumFee).toEqual({
      tokenAmount: 2,
      tokenSymbol: 'USDT',
      usdValue: 2,
    });
    expect(result.platformFee).toBe(2);
  });

  it('COM context mas SEM tokenPriceUsd (não-SOL): usdValue=0 mas tokenAmount preservado', async () => {
    const { default: transactionService } = await import('../../transactionService');
    const conn = transactionService.getConnection();
    vi.spyOn(conn, 'getFeeForMessage').mockResolvedValue({
      value: 5000,
      context: { slot: 1 },
    } as any);
    vi.spyOn(transactionService, 'getSOLPrice').mockResolvedValue(150);

    const tx = { compileMessage: () => ({}) } as any;

    const result = await transactionService.estimateFee(tx, {
      amountInToken: 50,
      tokenSymbol: 'BDC',
      // tokenPriceUsd ausente — caller esqueceu de fornecer
    });
    expect(result.verumFee?.tokenAmount).toBe(1); // 2% de 50 = 1 BDC
    expect(result.verumFee?.usdValue).toBe(0); // sem preço, USD = 0
    expect(result.verumFee?.tokenSymbol).toBe('BDC');
  });
});
