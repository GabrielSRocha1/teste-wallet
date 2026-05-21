/**
 * base58.ts — Helpers Base58 compartilhados.
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 * Antes desta consolidação, decodificação Base58 estava rolada à mão em 3 locais:
 *   - src/services/verumProvider.ts  (`__b58decode` inline no script injetado)
 *   - src/services/walletStandardRegister.ts (`_base58ToBytes` privado)
 *   - verum-vesting-connector.js (parcial)
 *
 * Mesmo algoritmo, três cópias → drift inevitável. Se um bug for descoberto em
 * uma, as outras permanecem vulneráveis. Centralizar evita esse risco.
 *
 * Por que NÃO usar `bs58` aqui? Os locais que duplicavam o decode são scripts
 * que rodam em ambiente JS plain (WebView injection, Wallet Standard register
 * for hybrid pages) — não podem importar módulos npm. Para esses, esta
 * implementação tem que ser inline-paste-friendly. O TypeScript wrapper aqui
 * delega para `bs58` quando disponível (binding nativo otimizado), mas mantém
 * fallback puro JS para portabilidade total.
 *
 * Algoritmo: iteração padrão da Bitcoin BIP58 com alfabeto sem 0/O/I/l.
 */

import bs58 from 'bs58';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Codifica Uint8Array em string Base58.
 * Wrapper sobre `bs58.encode` para uniformidade da API local.
 */
export function base58Encode(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

/**
 * Decodifica string Base58 em Uint8Array.
 * Wrapper sobre `bs58.decode` — lança se a string contém chars inválidos.
 */
export function base58Decode(str: string): Uint8Array {
  return bs58.decode(str);
}

/**
 * Decodificação Base58 PURE JS (sem dependência de bs58).
 *
 * Usada APENAS em contextos onde `bs58` não está disponível:
 *   - Scripts injetados no WebView pela Verum Wallet nativa
 *   - Wallet Standard register em páginas hybrid
 *
 * Para uso normal de TS/React Native, prefira `base58Decode`. Esta implementação
 * existe para que `verumProvider.ts` e similares possam ter um snippet
 * idêntico, testável, e auditável em vez de cópias divergentes.
 *
 * Throws `Error('Invalid base58 character')` em caractere fora do alfabeto.
 */
export function base58DecodePureJs(str: string): Uint8Array {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    lookup[BASE58_ALPHABET[i]] = i;
  }
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    let c = lookup[str[i]];
    if (c === undefined) throw new Error('Invalid base58 character');
    for (let j = 0; j < bytes.length; j++) {
      c += bytes[j] * 58;
      bytes[j] = c & 0xff;
      c >>= 8;
    }
    while (c > 0) {
      bytes.push(c & 0xff);
      c >>= 8;
    }
  }
  // Trata leading zeros (representados como '1' no alfabeto base58)
  for (let i = 0; str[i] === '1' && i < str.length - 1; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/**
 * Codificação Base58 PURE JS (espelho de base58DecodePureJs).
 * Mesmo motivo: contextos onde `bs58` não pode ser importado.
 */
export function base58EncodePureJs(bytes: Uint8Array): string {
  // Conta leading zeros.
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  // Conversão base 256 → base 58 via long division.
  // Início com array VAZIO: para input all-zeros, digits permanece vazio
  // e o output será só os leading '1's (sem '1' extra de digit zero).
  const digits: number[] = [];
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '';
  for (let i = 0; i < leadingZeros; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

/** Constante exposta para callers que queiram colar o algoritmo inline. */
export const BASE58_ALPHABET_CONST = BASE58_ALPHABET;
