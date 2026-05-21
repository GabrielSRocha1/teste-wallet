/**
 * amount.ts — Conversão segura de `amount: number` (UI) para unidades atômicas BigInt.
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 * O padrão antigo era `BigInt((amount * 10**decimals).toFixed(0))`. Isso usa
 * aritmética IEEE 754 em `number` ANTES de virar BigInt:
 *
 *   amount=1, decimals=9            →  1 * 1e9         = 1_000_000_000   OK
 *   amount=1.000000001, decimals=9  →  1.000000001*1e9 = 1_000_000_001   OK
 *   amount=0.1, decimals=9          →  0.1 * 1e9       = 100_000_000.00000001  ⚠
 *   amount=12345678.9, dec=9        →  12345678.9*1e9  = 1.23456789e16  perde precisão
 *
 * Para tokens com 9 decimais (SOL, BDC, ESCT, BRT), valores acima de ~9_007_199 SOL
 * já entram em território de perda silenciosa de precisão (limite seguro de
 * `number` é 2^53 ≈ 9.007e15, ou seja ~9 milhões SOL em lamports).
 *
 * Para tokens com 6 decimais (USDT, USDC), o limite seguro é ~9 bilhões — confortável,
 * mas a mesma armadilha existe para inputs fracionários:
 *
 *   amount=0.1, decimals=6 → 0.1 * 1e6 = 100000.00000000001
 *   toFixed(0) → "100000"  → OK desta vez, mas frágil
 *
 * ─── COMO FUNCIONA ──────────────────────────────────────────────────────────
 * Parsing em string: separa parte inteira e fracionária, padroniza fracionária
 * para `decimals` casas, concatena e converte para BigInt — sem nunca passar
 * por aritmética flutuante.
 *
 *   amount=0.1, decimals=9 → "0.100000000" → integer="0", frac="100000000"
 *                          → "0100000000" → BigInt("100000000")
 *
 * Aceita também `string` de entrada — útil para callers que vêm de inputs onde
 * o usuário digita o valor e queremos preservar precisão arbitrária.
 */

export class AmountConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountConversionError';
  }
}

const MAX_DECIMALS = 18; // ETH-like ceiling. SPL tokens raramente > 9.

/**
 * Converte um valor (number ou string) para unidades atômicas (BigInt).
 *
 * Regras:
 *  - amount > 0 (rejeita 0, negativo, NaN, Infinity).
 *  - decimals inteiro em [0, 18].
 *  - Frações além de `decimals` são REJEITADAS (não truncamos silenciosamente —
 *    preferimos falhar explicitamente do que perder lamports do usuário).
 *
 * Lança AmountConversionError em qualquer violação.
 */
export function toAtomicUnits(amount: number | string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new AmountConversionError(`decimals inválido: ${decimals} (esperado inteiro 0..${MAX_DECIMALS})`);
  }

  // Normaliza o input para string sem ambiguidade.
  let s: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw new AmountConversionError(`amount inválido: ${amount} (não é número finito)`);
    }
    if (amount <= 0) {
      throw new AmountConversionError(`amount inválido: ${amount} (deve ser > 0)`);
    }
    // Uses toFixed(decimals) para evitar notação científica em valores muito
    // pequenos/grandes. Para amount < 1e-9, toFixed(9) produz "0.000000000"
    // — caso esse cair em zero, lançamos.
    s = amount.toFixed(decimals);
  } else if (typeof amount === 'string') {
    s = amount.trim();
    if (s.length === 0) {
      throw new AmountConversionError('amount inválido: string vazia');
    }
  } else {
    throw new AmountConversionError(`amount inválido: tipo ${typeof amount}`);
  }

  // Aceita: dígitos, no máximo um '.', sem sinal (já validamos > 0).
  // Exemplos válidos: "1", "1.5", "0.001", "12345.678901234"
  // Exemplos INválidos: "-1", "1e9", ".5", "1.", "1,5", "0x10"
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new AmountConversionError(`amount inválido: "${s}" não é decimal positivo`);
  }

  const [intPart, fracPartRaw = ''] = s.split('.');

  if (fracPartRaw.length > decimals) {
    throw new AmountConversionError(
      `amount tem ${fracPartRaw.length} casas decimais, mas o token aceita só ${decimals}.`,
    );
  }

  // Pad fracionária à direita para casar `decimals`.
  const fracPart = fracPartRaw.padEnd(decimals, '0');

  // Remove leading zeros mantendo "0" se for tudo zero.
  const combined = (intPart + fracPart).replace(/^0+/, '') || '0';
  const result = BigInt(combined);

  if (result <= 0n) {
    throw new AmountConversionError(`amount resultou em 0 unidades atômicas (${s} × 10^${decimals})`);
  }

  return result;
}

/**
 * Aplica fee em basis points a um valor em unidades atômicas.
 *
 *   feeBps=200 (= 2%) sobre 1_000_000 → 20_000
 *
 * Faz arredondamento PARA BAIXO (`floor`) na divisão — qualquer dust < 1 unidade
 * atômica fica com o remetente. Importante: a Verum NUNCA cobra menos que o
 * calculado (não somamos 1 para arredondar pra cima), mas também não estourra
 * em 1 lamport por valores muito pequenos.
 */
export function applyFeeBps(amount: bigint, feeBps: number): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new AmountConversionError(`feeBps inválido: ${feeBps} (esperado inteiro 0..10000)`);
  }
  return (amount * BigInt(feeBps)) / 10_000n;
}
