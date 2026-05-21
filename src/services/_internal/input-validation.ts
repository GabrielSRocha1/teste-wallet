/**
 * input-validation.ts — Validação estrita de inputs de boundary.
 *
 * Princípio: zero trust em todo input externo (deep links, HTTP, AsyncStorage).
 * Cada validator é:
 *  - Puro (sem side effects).
 *  - Defensivo (typeof checks antes de regex/decode).
 *  - Específico (não "stringish" — bytes-after-decode checados).
 *
 * Variantes `assertX` lançam `ValidationError` tipada; variantes `isValidX`
 * retornam boolean.
 */

import bs58 from 'bs58';

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: string,
    public readonly receivedSample?: string,
  ) {
    super(`Validation failed [${field}]: ${reason}`);
    this.name = 'ValidationError';
  }
}

const BASE58_ALPHABET_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
const HEX_REGEX = /^[0-9a-fA-F]+$/;

// ─── Base58 ──────────────────────────────────────────────────────────────────

export function isValidBase58(s: unknown, minLen = 1, maxLen = 128): s is string {
  if (typeof s !== 'string') return false;
  if (s.length < minLen || s.length > maxLen) return false;
  return BASE58_ALPHABET_REGEX.test(s);
}

// ─── Solana pubkey / signature ───────────────────────────────────────────────

/**
 * Solana pubkey: base58 que decodifica em EXATAMENTE 32 bytes.
 * Apenas regex não basta — strings de 32 chars podem decodificar em qualquer
 * número de bytes.
 */
export function isValidSolanaPubkey(s: unknown): s is string {
  if (!isValidBase58(s, 32, 44)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Solana signature: base58 → 64 bytes. */
export function isValidSolanaSignature(s: unknown): s is string {
  if (!isValidBase58(s, 64, 96)) return false;
  try {
    return bs58.decode(s).length === 64;
  } catch {
    return false;
  }
}

// ─── Hex ─────────────────────────────────────────────────────────────────────

export function isValidHex(s: unknown, expectedByteLength?: number): s is string {
  if (typeof s !== 'string') return false;
  if (s.length === 0 || s.length % 2 !== 0) return false;
  if (!HEX_REGEX.test(s)) return false;
  if (expectedByteLength !== undefined && s.length !== expectedByteLength * 2) return false;
  return true;
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/**
 * String que representa BigInt positivo (sem zeros à esquerda).
 * Usado para `amount` em unidades atômicas Solana (lamports, token units).
 */
export function isValidPositiveBigIntString(s: unknown, maxValue?: bigint): s is string {
  if (typeof s !== 'string' || !/^[1-9]\d*$/.test(s)) return false;
  try {
    const n = BigInt(s);
    if (n <= 0n) return false;
    if (maxValue !== undefined && n > maxValue) return false;
    return true;
  } catch {
    return false;
  }
}

/** Slippage em basis points. Default cap em 1000 (10%). */
export function isValidSlippageBps(n: unknown, max = 1000): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
}

// ─── URLs ────────────────────────────────────────────────────────────────────

/**
 * Aceita apenas protocolos da whitelist. Bloqueia `javascript:`, `data:`,
 * `file:`, etc. Retorna URL canonical (string normalizada) ou null.
 */
export function sanitizeUrl(url: unknown, allowedProtocols: string[] = ['https:']): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!allowedProtocols.includes(parsed.protocol)) return null;
  return parsed.toString();
}

// ─── Logging helpers ─────────────────────────────────────────────────────────

/**
 * Redaciona valor para logs: mostra prefixo + tamanho, mascarando o resto.
 * Strings muito curtas (<= visibleChars) são totalmente mascaradas.
 */
export function redactForLog(value: unknown, visibleChars = 4): string {
  if (typeof value !== 'string') return '<non-string>';
  if (value.length === 0) return '<empty>';
  if (value.length <= visibleChars) return '*'.repeat(value.length);
  return `${value.slice(0, visibleChars)}...${value.length}`;
}

// ─── Assert variants ─────────────────────────────────────────────────────────

export function assertSolanaPubkey(s: unknown, field = 'pubkey'): string {
  if (!isValidSolanaPubkey(s)) {
    throw new ValidationError(
      field,
      'não é Solana pubkey base58 válida (deve decodificar em 32 bytes)',
      typeof s === 'string' ? redactForLog(s) : `<${typeof s}>`,
    );
  }
  return s;
}

export function assertSolanaSignature(s: unknown, field = 'signature'): string {
  if (!isValidSolanaSignature(s)) {
    throw new ValidationError(field, 'não é Solana signature válida (64 bytes)');
  }
  return s;
}

export function assertPositiveBigIntString(s: unknown, field = 'amount', maxValue?: bigint): bigint {
  if (!isValidPositiveBigIntString(s, maxValue)) {
    throw new ValidationError(field, 'não é inteiro positivo válido em string');
  }
  return BigInt(s);
}

export function assertSlippageBps(n: unknown, field = 'slippageBps', max = 1000): number {
  if (!isValidSlippageBps(n, max)) {
    throw new ValidationError(field, `não é slippage bps válido (inteiro entre 0 e ${max})`);
  }
  return n;
}

export function assertHttpsUrl(url: unknown, field = 'url'): string {
  const safe = sanitizeUrl(url, ['https:']);
  if (!safe) {
    throw new ValidationError(field, 'não é URL HTTPS válida');
  }
  return safe;
}
