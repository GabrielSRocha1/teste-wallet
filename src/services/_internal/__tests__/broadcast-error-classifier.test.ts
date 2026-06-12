import { describe, expect, it, vi } from 'vitest';

// transactionService importa supabase + react-native via cadeia; mockamos
// pontos sensíveis para podermos importar apenas o helper exportado.
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

import { CircuitOpenError } from '../circuit-breaker';
import { isRateOrAuthFailure } from '../../transactionService';

// ─── (F8) Classificação de erro do broadcast ────────────────────────────────

describe('isRateOrAuthFailure — (F8) decisão de fallback do broadcast', () => {
  it('CircuitOpenError → true (RPC primário derrubado, vai pro público)', () => {
    const err = new CircuitOpenError('solana-rpc-primary', 30_000);
    expect(isRateOrAuthFailure(err)).toBe(true);
  });

  it('mensagem com "429" → true (rate-limit)', () => {
    expect(isRateOrAuthFailure(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('"Too Many Requests" sem código numérico → true', () => {
    expect(isRateOrAuthFailure(new Error('upstream returned Too Many Requests'))).toBe(true);
  });

  it('"403" → true (key expirada / tier estourado)', () => {
    expect(isRateOrAuthFailure(new Error('HTTP 403 Forbidden'))).toBe(true);
  });

  it('"Access forbidden" textual → true', () => {
    expect(isRateOrAuthFailure(new Error('Access forbidden'))).toBe(true);
  });

  it('"401" → true (auth do RPC inválida)', () => {
    expect(isRateOrAuthFailure(new Error('HTTP 401 Unauthorized'))).toBe(true);
  });

  it('"-32601" do proxy → true (método bloqueado por allowlist, RPC público pode aceitar)', () => {
    expect(isRateOrAuthFailure(new Error('400 : {"jsonrpc":"2.0","error":{"code":-32601,"message":"x"}}'))).toBe(true);
  });

  it('"not allowed via proxy" textual → true (mesmo caso, mensagem humana)', () => {
    expect(isRateOrAuthFailure(new Error("Method 'sendTransaction' not allowed via proxy"))).toBe(true);
  });

  it('"Method not found" JSON-RPC genérico → true', () => {
    expect(isRateOrAuthFailure(new Error('Method not found'))).toBe(true);
  });

  it('InsufficientFunds → FALSE (mudar de RPC não muda o erro semântico)', () => {
    expect(isRateOrAuthFailure(new Error('Custom program error: InsufficientFunds'))).toBe(false);
  });

  it('InvalidTransaction → FALSE', () => {
    expect(isRateOrAuthFailure(new Error('Transaction simulation failed: InvalidTransaction'))).toBe(false);
  });

  it('timeout → FALSE (timeout é tratado por retry, não por fallback)', () => {
    expect(isRateOrAuthFailure(new Error('Operação excedeu 10000ms'))).toBe(false);
  });

  it('input não-Error (string) — pode ainda detectar via mensagem', () => {
    expect(isRateOrAuthFailure('429 from upstream')).toBe(true);
    expect(isRateOrAuthFailure('Saldo insuficiente')).toBe(false);
  });

  it('input null/undefined → FALSE', () => {
    expect(isRateOrAuthFailure(null)).toBe(false);
    expect(isRateOrAuthFailure(undefined)).toBe(false);
  });

  it('mensagem customizada vence a do error.message (segundo arg)', () => {
    const err = new Error('mensagem original sem 429');
    expect(isRateOrAuthFailure(err, 'HTTP 429 detected by wrapper')).toBe(true);
  });
});
