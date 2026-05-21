import { describe, expect, it } from 'vitest';
import { AmountConversionError, applyFeeBps, toAtomicUnits } from '../amount';

// ─── toAtomicUnits — casos básicos ──────────────────────────────────────────

describe('toAtomicUnits — happy path', () => {
  it('1 SOL → 1_000_000_000 lamports', () => {
    expect(toAtomicUnits(1, 9)).toBe(1_000_000_000n);
  });

  it('0.1 SOL → 100_000_000 lamports (sem perda de precisão IEEE 754)', () => {
    // Antes: 0.1 * 1e9 = 100000000.00000001 → toFixed(0) = "100000000" (OK por sorte)
    // Agora: string parsing — determinístico.
    expect(toAtomicUnits(0.1, 9)).toBe(100_000_000n);
  });

  it('0.000000001 SOL → 1 lamport (limite inferior)', () => {
    expect(toAtomicUnits(0.000000001, 9)).toBe(1n);
  });

  it('aceita string como input — preserva precisão arbitrária', () => {
    expect(toAtomicUnits('12345678.123456789', 9)).toBe(12345678123456789n);
  });

  it('USDT (6 decimais): 100.5 → 100_500_000', () => {
    expect(toAtomicUnits(100.5, 6)).toBe(100_500_000n);
  });

  it('valores grandes além do safe integer de number (via string)', () => {
    // 10_000_000_000 (10B) SOL = 10^19 lamports — fora do safe integer de number
    expect(toAtomicUnits('10000000000', 9)).toBe(10_000_000_000_000_000_000n);
  });
});

// ─── toAtomicUnits — rejeições ──────────────────────────────────────────────

describe('toAtomicUnits — input inválido', () => {
  it('rejeita NaN', () => {
    expect(() => toAtomicUnits(Number.NaN, 9)).toThrow(AmountConversionError);
  });

  it('rejeita Infinity', () => {
    expect(() => toAtomicUnits(Number.POSITIVE_INFINITY, 9)).toThrow(AmountConversionError);
  });

  it('rejeita 0', () => {
    expect(() => toAtomicUnits(0, 9)).toThrow(/deve ser > 0/);
  });

  it('rejeita negativo', () => {
    expect(() => toAtomicUnits(-1, 9)).toThrow(/deve ser > 0/);
  });

  it('rejeita string com sinal negativo', () => {
    expect(() => toAtomicUnits('-1', 9)).toThrow(AmountConversionError);
  });

  it('rejeita notação científica em string', () => {
    expect(() => toAtomicUnits('1e9', 9)).toThrow(AmountConversionError);
  });

  it('rejeita hex em string', () => {
    expect(() => toAtomicUnits('0x10', 9)).toThrow(AmountConversionError);
  });

  it('rejeita vírgula como separador decimal', () => {
    expect(() => toAtomicUnits('1,5', 9)).toThrow(AmountConversionError);
  });

  it('rejeita frações além de `decimals`', () => {
    // SOL tem 9 decimais; 10 casas é overflow
    expect(() => toAtomicUnits('1.1234567890', 9)).toThrow(/casas decimais/);
  });

  it('rejeita decimals fora do range', () => {
    expect(() => toAtomicUnits(1, -1)).toThrow(AmountConversionError);
    expect(() => toAtomicUnits(1, 19)).toThrow(AmountConversionError);
    expect(() => toAtomicUnits(1, 1.5)).toThrow(AmountConversionError);
  });

  it('rejeita amount que resulta em 0 unidades atômicas', () => {
    // 0.0000000001 SOL com 9 decimais arredondaria para 0 lamports
    expect(() => toAtomicUnits(0.0000000001, 9)).toThrow(/resultou em 0/);
  });
});

// ─── applyFeeBps — regra 2% Verum ───────────────────────────────────────────

describe('applyFeeBps — taxa 2% Verum', () => {
  it('200 bps (2%) sobre 1_000_000 = 20_000', () => {
    expect(applyFeeBps(1_000_000n, 200)).toBe(20_000n);
  });

  it('200 bps sobre 1 SOL (1e9 lamports) = 0.02 SOL (2e7 lamports)', () => {
    expect(applyFeeBps(1_000_000_000n, 200)).toBe(20_000_000n);
  });

  it('200 bps sobre 100 USDT (100_000_000 raw) = 2 USDT (2_000_000 raw)', () => {
    expect(applyFeeBps(100_000_000n, 200)).toBe(2_000_000n);
  });

  it('200 bps sobre 1 unidade atômica → 0 (floor, dust fica com remetente)', () => {
    expect(applyFeeBps(1n, 200)).toBe(0n);
  });

  it('rejeita feeBps inválido', () => {
    expect(() => applyFeeBps(1_000_000n, -1)).toThrow(AmountConversionError);
    expect(() => applyFeeBps(1_000_000n, 10_001)).toThrow(AmountConversionError);
    expect(() => applyFeeBps(1_000_000n, 1.5)).toThrow(AmountConversionError);
  });

  it('feeBps=0 retorna 0n (caller pode pular instruction)', () => {
    expect(applyFeeBps(1_000_000n, 0)).toBe(0n);
  });
});
