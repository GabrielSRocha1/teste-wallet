/**
 * crypto.ts — Primitivas criptográficas seguras (camada cliente).
 *
 * Princípios:
 *  - Aleatoriedade SEMPRE via CSPRNG (`globalThis.crypto.getRandomValues`).
 *    `Math.random()` é proibido nesta camada.
 *  - Encryption autenticada via `nacl.secretbox` (XSalsa20-Poly1305) — mesmo
 *    nível de segurança de AES-256-GCM, pure JS, sem deps nativos.
 *  - PBKDF2 com SHA-256, mínimo de 10k iterações (recomendado 600k em prod).
 *  - Comparações sensíveis em tempo constante (resistente a timing attacks).
 *  - Wipe agressivo de buffers sensíveis (mitiga residuo em heap).
 *
 * Portabilidade: React Native (com `react-native-get-random-values` já
 * polyfillado no boot), Node 18+, navegadores modernos.
 */

import bs58 from 'bs58';
import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

// ─── CSPRNG ─────────────────────────────────────────────────────────────────

interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getCSPRNG(): RandomSource {
  const c = (globalThis as { crypto?: RandomSource }).crypto;
  if (c && typeof c.getRandomValues === 'function') return c;
  throw new CryptoError(
    'CSPRNG indisponível — globalThis.crypto.getRandomValues não encontrado. ' +
      'Em React Native, importe "react-native-get-random-values" no entry.',
  );
}

const MAX_RANDOM_BYTES = 65_536;

export function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0 || length > MAX_RANDOM_BYTES) {
    throw new CryptoError(`secureRandomBytes: length inválido (${length})`);
  }
  const buf = new Uint8Array(length);
  getCSPRNG().getRandomValues(buf);
  return buf;
}

const HEX = '0123456789abcdef';

export function secureRandomHex(byteLength: number): string {
  const bytes = secureRandomBytes(byteLength);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[(b >>> 4) & 0x0f] + HEX[b & 0x0f];
  }
  return out;
}

// ─── AEAD: NaCl secretbox (XSalsa20-Poly1305) ───────────────────────────────

const NACL_KEY_LEN = nacl.secretbox.keyLength; // 32
const NACL_NONCE_LEN = nacl.secretbox.nonceLength; // 24

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export function encryptSecretBox(plaintext: Uint8Array, key: Uint8Array): EncryptedPayload {
  if (!(plaintext instanceof Uint8Array)) {
    throw new CryptoError('encryptSecretBox: plaintext deve ser Uint8Array');
  }
  if (key.length !== NACL_KEY_LEN) {
    throw new CryptoError(`encryptSecretBox: key deve ter ${NACL_KEY_LEN} bytes (recebido ${key.length})`);
  }
  const nonce = secureRandomBytes(NACL_NONCE_LEN);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return { ciphertext, nonce };
}

export function decryptSecretBox(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array {
  if (key.length !== NACL_KEY_LEN) {
    throw new CryptoError(`decryptSecretBox: key deve ter ${NACL_KEY_LEN} bytes`);
  }
  if (nonce.length !== NACL_NONCE_LEN) {
    throw new CryptoError(`decryptSecretBox: nonce deve ter ${NACL_NONCE_LEN} bytes`);
  }
  const plain = nacl.secretbox.open(ciphertext, nonce, key);
  if (plain === null) {
    throw new CryptoError(
      'decryptSecretBox: autenticação falhou (chave incorreta ou ciphertext adulterado)',
    );
  }
  return plain;
}

// ─── KDF: PBKDF2-HMAC-SHA256 ────────────────────────────────────────────────

/** Mínimo enforçado. OWASP recomenda 210_000 (SHA-256) em produção. */
export const MIN_PBKDF2_ITERATIONS = 10_000;
const MIN_SALT_BYTES = 16;
const MAX_KEY_BYTES = 64;

export interface Pbkdf2Params {
  password: string;
  salt: Uint8Array;
  iterations: number;
  /** Tamanho da chave em bytes. Default 32. */
  keyLength?: number;
}

function wordArrayToBytes(wa: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function bytesToWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

export function deriveKeyPbkdf2(params: Pbkdf2Params): Uint8Array {
  if (!params || typeof params.password !== 'string' || params.password.length === 0) {
    throw new CryptoError('deriveKeyPbkdf2: password obrigatório');
  }
  if (!(params.salt instanceof Uint8Array) || params.salt.length < MIN_SALT_BYTES) {
    throw new CryptoError(`deriveKeyPbkdf2: salt deve ser Uint8Array com ≥${MIN_SALT_BYTES} bytes`);
  }
  if (!Number.isInteger(params.iterations) || params.iterations < MIN_PBKDF2_ITERATIONS) {
    throw new CryptoError(
      `deriveKeyPbkdf2: iterations < ${MIN_PBKDF2_ITERATIONS} é inseguro (recebido ${params.iterations})`,
    );
  }
  const keyLength = params.keyLength ?? 32;
  if (!Number.isInteger(keyLength) || keyLength <= 0 || keyLength > MAX_KEY_BYTES || keyLength % 4 !== 0) {
    throw new CryptoError(`deriveKeyPbkdf2: keyLength inválido (${keyLength}); múltiplo de 4 entre 4 e ${MAX_KEY_BYTES}`);
  }
  const wa = CryptoJS.PBKDF2(params.password, bytesToWordArray(params.salt), {
    keySize: keyLength / 4,
    iterations: params.iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  return wordArrayToBytes(wa);
}

// ─── Constant-time equality ──────────────────────────────────────────────────

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ─── Secure wipe ─────────────────────────────────────────────────────────────

/**
 * Sobrescreve o buffer com padrões diferentes em múltiplas passadas, depois
 * zera. Mitiga residuo em heap antes do GC reclamar a memória.
 *
 * Não há garantia em JS (motor pode otimizar fills idênticas), mas patterns
 * variados reduzem essa chance. Para máxima segurança use Uint8Array com
 * ownership manual em escopo curto.
 */
export function secureWipe(buffer: Uint8Array): void {
  if (!(buffer instanceof Uint8Array)) return;
  buffer.fill(0xff);
  buffer.fill(0xaa);
  buffer.fill(0x00);
}

// ─── IDs seguros (substituem Math.random nos call-sites) ─────────────────────

/** ID seguro de 16 bytes (~22 chars base58). Use para correlationId, requestId, etc. */
export function generateSecureId(prefix?: string): string {
  const id = bs58.encode(secureRandomBytes(16));
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Session token de 32 bytes — 256 bits de entropia.
 * Use para autenticação de sessão, recovery tokens, etc.
 */
export function generateSessionToken(): string {
  return bs58.encode(secureRandomBytes(32));
}

/** Nonce X25519/secretbox (24 bytes). */
export function generateBoxNonce(): Uint8Array {
  return secureRandomBytes(NACL_NONCE_LEN);
}

/** Salt para KDF (32 bytes — generoso vs OWASP min de 16). */
export function generateSalt(): Uint8Array {
  return secureRandomBytes(32);
}
