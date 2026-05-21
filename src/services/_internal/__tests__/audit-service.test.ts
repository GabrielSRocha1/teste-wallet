import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AsyncStorage com delay programável para reproduzir a race condition.
// Backing store persistente compartilhado entre todos os mocks.
const backingStore: Record<string, string> = {};
let getItemDelayMs = 0;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (getItemDelayMs > 0) {
        await new Promise((r) => setTimeout(r, getItemDelayMs));
      }
      return backingStore[key] ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      backingStore[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete backingStore[key];
    }),
  },
}));

vi.mock('@/src/services/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

vi.mock('../../apiUrl', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

beforeEach(() => {
  // Reset backing store entre testes.
  for (const k of Object.keys(backingStore)) delete backingStore[k];
  getItemDelayMs = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── (C6) Race condition do _loadLocalLogs ──────────────────────────────────

describe('AuditService — (C6) race no constructor', () => {
  it('logTransactionAttempt chamado IMEDIATAMENTE pós-instanciação AGUARDA load inicial', async () => {
    // Popula backing store com um log pré-existente
    backingStore['verum_audit_history'] = JSON.stringify([
      {
        id: 'pre-existing-log',
        timestamp: '2026-01-01T00:00:00Z',
        network: 'solana',
        fromAddress: 'A',
        toAddress: 'B',
        tokenSymbol: 'SOL',
        tokenAmount: 1,
        usdValue: 100,
        platformFee: 0,
        gasFee: 0,
        status: 'confirmed',
        idempotencyKey: 'pre-existing',
      },
    ]);

    // Atrasa o getItem em 50ms — antes da correção C6, `getLocalHistory()`
    // chamado imediatamente retornava [] enquanto o load estava em voo.
    getItemDelayMs = 50;

    // Reimporta para criar instância nova sob os mocks atualizados.
    const { auditService } = await import('../../auditService');

    // Chama getLocalHistory ANTES de o load terminar.
    // Após C6: getLocalHistory é async e aguarda _readyPromise → vê o log.
    const history = await auditService.getLocalHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe('pre-existing-log');
  });

  it('logTransactionAttempt em paralelo com o load não corrompe o estado', async () => {
    backingStore['verum_audit_history'] = JSON.stringify([
      {
        id: 'old-log',
        timestamp: '2026-01-01T00:00:00Z',
        network: 'solana',
        fromAddress: 'A',
        toAddress: 'B',
        tokenSymbol: 'SOL',
        tokenAmount: 1,
        usdValue: 100,
        platformFee: 0,
        gasFee: 0,
        status: 'confirmed',
        idempotencyKey: 'old',
      },
    ]);
    getItemDelayMs = 30;

    const { auditService } = await import('../../auditService');

    // Dispara log + getHistory em paralelo, ambos antes do load terminar.
    const [newId, historyBefore] = await Promise.all([
      auditService.logTransactionAttempt({
        timestamp: '2026-05-18T00:00:00Z',
        network: 'solana',
        fromAddress: 'C',
        toAddress: 'D',
        tokenSymbol: 'USDT',
        tokenAmount: 50,
        usdValue: 50,
        platformFee: 1,
        gasFee: 0.005,
      }),
      auditService.getLocalHistory(),
    ]);

    expect(typeof newId).toBe('string');
    expect(newId.length).toBeGreaterThan(10);

    // historyBefore pode incluir o novo log se o log chegou antes do read
    // — mas em ambos os casos, NÃO deve perder o old-log.
    const finalHistory = await auditService.getLocalHistory();
    expect(finalHistory.some((l) => l.id === 'old-log')).toBe(true);
    expect(finalHistory.some((l) => l.id === newId)).toBe(true);
  });

  it('JSON corrompido no AsyncStorage NÃO crasha o load (parse defensivo)', async () => {
    backingStore['verum_audit_history'] = '{not valid json[[[';
    const { auditService } = await import('../../auditService');
    await auditService.whenReady();
    const history = await auditService.getLocalHistory();
    expect(history).toEqual([]);
  });

  it('JSON com shape errado (não-array) é ignorado silenciosamente', async () => {
    backingStore['verum_audit_history'] = JSON.stringify({ wrong: 'shape' });
    const { auditService } = await import('../../auditService');
    await auditService.whenReady();
    const history = await auditService.getLocalHistory();
    expect(history).toEqual([]);
  });
});
