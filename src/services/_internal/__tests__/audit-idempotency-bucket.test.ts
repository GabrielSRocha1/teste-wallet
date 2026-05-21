import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backingStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => backingStore[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      backingStore[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete backingStore[key];
    }),
  },
}));

vi.mock('@/src/services/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

vi.mock('../../apiUrl', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

beforeEach(() => {
  for (const k of Object.keys(backingStore)) delete backingStore[k];
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── (SE8) Idempotency em janela de 60s ─────────────────────────────────────

describe('AuditService.logTransactionAttempt — (SE8) idempotencyKey por bucket de 60s', () => {
  function makeAttempt(timestamp: string) {
    return {
      timestamp,
      network: 'solana',
      fromAddress: 'A',
      toAddress: 'B',
      tokenSymbol: 'SOL',
      tokenAmount: 1,
      usdValue: 100,
      platformFee: 2,
      gasFee: 0.005,
    };
  }

  it('dois clicks em <60s com mesmo (from,to,amount) geram MESMA idempotencyKey', async () => {
    const { auditService } = await import('../../auditService');
    await auditService.whenReady();

    const t1 = new Date('2026-05-18T12:00:10Z').toISOString();
    const t2 = new Date('2026-05-18T12:00:50Z').toISOString(); // mesmo minuto

    await auditService.logTransactionAttempt(makeAttempt(t1));
    await auditService.logTransactionAttempt(makeAttempt(t2));

    const history = await auditService.getLocalHistory();
    expect(history.length).toBe(2); // dois logs criados (não fazemos dedup automático ainda)

    // Mas idempotencyKey é a MESMA — caller externo pode usar para dedup.
    expect(history[0].idempotencyKey).toBe(history[1].idempotencyKey);
  });

  it('clicks em janelas DIFERENTES (>60s) geram idempotencyKey distintas', async () => {
    const { auditService } = await import('../../auditService');
    await auditService.whenReady();

    const t1 = new Date('2026-05-18T12:00:10Z').toISOString();
    const t2 = new Date('2026-05-18T12:02:00Z').toISOString(); // 2 min depois

    await auditService.logTransactionAttempt(makeAttempt(t1));
    await auditService.logTransactionAttempt(makeAttempt(t2));

    const history = await auditService.getLocalHistory();
    expect(history.length).toBe(2);
    expect(history[0].idempotencyKey).not.toBe(history[1].idempotencyKey);
  });
});
