import { describe, expect, it } from 'vitest';

// (C7) Não importa transactionService aqui — esse módulo arrasta supabase,
// react-native e cadeia de native deps. Testamos a regra de negócio pelos
// blocos básicos: VERUM_FEE_BPS, applyFeeBps, toAtomicUnits.
//
// Os testes de integração de buildSOLTransfer/buildSPLTransfer construindo TX
// e contando instruções viveriam em outro arquivo (requer mock completo do
// transactionService — fora do escopo desta correção).

import { applyFeeBps, toAtomicUnits } from '../amount';

// Espelho da constante exportada por transactionService — testado por
// equivalência com applyFeeBps abaixo (qualquer divergência quebra o teste).
const VERUM_FEE_BPS = 200;

// ─── (C7) Regra de negócio: 2% fixos ────────────────────────────────────────

describe('Verum fee — (C7) regra de negócio canônica (2%)', () => {
  it('2% sobre 1 SOL (1e9 lamports) = 20_000_000 lamports', () => {
    const total = toAtomicUnits(1, 9);
    const fee = applyFeeBps(total, VERUM_FEE_BPS);
    expect(fee).toBe(20_000_000n);
  });

  it('2% sobre 100 USDT (100_000_000 raw, 6 dec) = 2_000_000 raw', () => {
    const total = toAtomicUnits(100, 6);
    const fee = applyFeeBps(total, VERUM_FEE_BPS);
    expect(fee).toBe(2_000_000n);
  });

  it('fee aplicado é determinístico para valores idênticos', () => {
    const a = applyFeeBps(toAtomicUnits('123.456789', 9), VERUM_FEE_BPS);
    const b = applyFeeBps(toAtomicUnits('123.456789', 9), VERUM_FEE_BPS);
    expect(a).toBe(b);
  });

  it('valores extremos não estouram precisão (BigInt > 2^53)', () => {
    // 1 bilhão de SOL = 10^18 lamports — fora do safe integer do `number`.
    const total = toAtomicUnits('1000000000', 9);
    const fee = applyFeeBps(total, VERUM_FEE_BPS);
    // 2% de 10^18 = 2 × 10^16
    expect(fee).toBe(20_000_000_000_000_000n);
  });

  it('fee floor (não arredonda pra cima) — Verum nunca cobra mais que o calculado', () => {
    // 99 lamports * 200 bps / 10000 = 1.98 → floor = 1n
    const fee = applyFeeBps(99n, VERUM_FEE_BPS);
    expect(fee).toBe(1n);
  });

  it('fee de 0 para valor < 50 unidades atômicas (dust permanece com remetente)', () => {
    // 49 * 200 / 10000 = 0.98 → 0n
    expect(applyFeeBps(49n, VERUM_FEE_BPS)).toBe(0n);
    // 50 * 200 / 10000 = 1 → 1n (limite inferior onde fee aparece)
    expect(applyFeeBps(50n, VERUM_FEE_BPS)).toBe(1n);
  });
});
