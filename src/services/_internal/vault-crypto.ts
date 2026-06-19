/**
 * vault-crypto.ts — Criptografia autenticada do vault local (formato v2).
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ──────────────────────────────────────────────
 * O formato legado usava `CryptoJS.AES.encrypt(payload, pin)` que internamente
 * deriva a key via OpenSSL EVP_BytesToKey: PBKDF1 com MD5 e UMA iteração. Para
 * PIN de 6 dígitos (10^6 combinações), atacante com vault em mãos faz
 * brute-force offline em SEGUNDOS em GPU. Modo CBC sem MAC = também
 * vulnerável a padding oracle se a chave fosse reusada.
 *
 * ─── FORMATO V2 ──────────────────────────────────────────────────────────────
 * Disco: `vrm-v2:` + base64(JSON({ v, kdf, salt, nonce, ct }))
 *
 *   v       : 2 (versão do esquema — incremental para futura migração)
 *   kdf     : "pbkdf2-sha256-210000" (parser permite tunning de iterações)
 *   salt    : 16 bytes aleatórios (base64) — único por vault
 *   nonce   : 24 bytes aleatórios (base64) — único por encrypt
 *   ct      : ciphertext + auth tag (base64) — nacl.secretbox output
 *
 * ─── PRIMITIVAS ──────────────────────────────────────────────────────────────
 *   KDF    : PBKDF2-SHA256, 210k iterações (OWASP 2023 recomendado para SHA-256)
 *   Cipher : nacl.secretbox (XSalsa20-Poly1305) — autenticada, sem padding
 *   RNG    : nacl.randomBytes (CSPRNG via react-native-get-random-values)
 *
 * ─── CUSTO COMPUTACIONAL ─────────────────────────────────────────────────────
 * 210k iter PBKDF2-SHA256 leva ~170-280ms em dispositivo médio. Vaults v2 antigos
 * (600k) continuam decifrando — iterations vem do envelope, não da constante.
 * Tradeoff: UX (unlock 1× a cada 15min) vs segurança (vault em mãos é fortaleza).
 *
 * ─── MIGRAÇÃO ────────────────────────────────────────────────────────────────
 * Este módulo NÃO faz migração — só encrypt/decrypt v2. A migração legacy→v2
 * é orquestrada em keyManager.loadDecrypted via `isV2Format()` + re-write.
 */

import CryptoJS from 'crypto-js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

const FORMAT_PREFIX = 'vrm-v2:';
// Detecta ambiente vitest pra acelerar suítes que criam vaults reais (~600ms cada
// em 210k vs <50ms em 10k). VITEST é setado automaticamente pelo runner. Em prod
// (sem essa env), continua 210k. O threshold de decrypt acompanha — senão tests
// que decifram vault de 10k seriam rejeitados pela defesa anti-downgrade.
const IS_VITEST =
  typeof process !== 'undefined' && (process.env as { VITEST?: string } | undefined)?.VITEST === 'true';
const PBKDF2_ITERATIONS = IS_VITEST ? 10_000 : 210_000;
/** Iterações mínimas aceitas na descriptografia. Defesa-em-profundidade contra
 *  envelope adulterado com kdf muito baixo. Poly1305 já bloqueia downgrade sem
 *  conhecer a chave, mas o threshold é defesa barata. */
const MIN_DECRYPT_ITERATIONS = IS_VITEST ? 5_000 : 100_000;
const SALT_BYTES = 16;
const NONCE_BYTES = nacl.secretbox.nonceLength; // 24
const KEY_BYTES = nacl.secretbox.keyLength; // 32

interface VaultBlobV2 {
  v: 2;
  kdf: string;
  salt: string;
  nonce: string;
  ct: string;
}

// ─── Helpers WordArray ↔ Uint8Array ──────────────────────────────────────────

function wordArrayToUint8Array(wa: CryptoJS.lib.WordArray): Uint8Array {
  const sigBytes = wa.sigBytes;
  const words = wa.words;
  const u8 = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return u8;
}

function uint8ToWordArray(u8: Uint8Array): CryptoJS.lib.WordArray {
  // CryptoJS aceita Array<number>. Convertemos elemento a elemento.
  return CryptoJS.lib.WordArray.create(Array.from(u8) as any);
}

// ─── KDF ─────────────────────────────────────────────────────────────────────

function deriveKey(pin: string, saltU8: Uint8Array, iterations: number): Uint8Array {
  const saltWa = uint8ToWordArray(saltU8);
  const wa = CryptoJS.PBKDF2(pin, saltWa, {
    // CryptoJS PBKDF2 keySize é em WORDS (4 bytes cada).
    keySize: KEY_BYTES / 4,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  return wordArrayToUint8Array(wa);
}

/** Best-effort: zera bytes da key na memória após uso (JS não garante, mas reduz janela). */
function wipeBuffer(u8: Uint8Array): void {
  try {
    u8.fill(0);
  } catch {
    /* alguns runtimes podem rejeitar fill em buffers congelados */
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/** Detecta o formato v2 antes de tentar decrypt — base para migração. */
export function isV2Format(blob: string): boolean {
  return typeof blob === 'string' && blob.startsWith(FORMAT_PREFIX);
}

/**
 * Lê o número de iterações PBKDF2 gravado no envelope v2 sem decifrar.
 *
 * Usado para detectar vaults com iter count ≠ do alvo atual e disparar
 * re-encriptação transparente no próximo unlock — assim usuários antigos
 * herdam ganhos de performance quando baixamos o custo do KDF, sem precisar
 * trocar PIN. Retorna null se o blob não for v2 ou o envelope estiver
 * corrompido (caller decide se ignora ou propaga).
 */
export function getVaultIterations(blob: string): number | null {
  if (!isV2Format(blob)) return null;
  try {
    const jsonB64 = blob.slice(FORMAT_PREFIX.length);
    const envelope = JSON.parse(Buffer.from(jsonB64, 'base64').toString('utf-8')) as VaultBlobV2;
    const m = typeof envelope.kdf === 'string' ? envelope.kdf.match(/pbkdf2-sha256-(\d+)/) : null;
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Valor atual de iterações usado em encryptions novas. Expor permite ao caller
 *  detectar drift (vault antigo ≠ alvo) sem reimportar a constante. */
export const CURRENT_PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;

/**
 * Criptografa um payload JSON-serializável com PBKDF2 + secretbox.
 * Retorna string pronta para gravar em SecureStore/localStorage.
 *
 * Lança se o PIN for inválido (string vazia).
 */
export function encryptVault(payload: unknown, pin: string): string {
  if (typeof pin !== 'string' || pin.length === 0) {
    throw new Error('encryptVault: PIN inválido.');
  }

  const salt = nacl.randomBytes(SALT_BYTES);
  const nonce = nacl.randomBytes(NONCE_BYTES);
  const key = deriveKey(pin, salt, PBKDF2_ITERATIONS);

  try {
    const plaintext = new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf-8'));
    const ciphertext = nacl.secretbox(plaintext, nonce, key);
    if (!ciphertext) {
      throw new Error('encryptVault: nacl.secretbox falhou ao criptografar.');
    }

    const blob: VaultBlobV2 = {
      v: 2,
      kdf: `pbkdf2-sha256-${PBKDF2_ITERATIONS}`,
      salt: Buffer.from(salt).toString('base64'),
      nonce: Buffer.from(nonce).toString('base64'),
      ct: Buffer.from(ciphertext).toString('base64'),
    };

    return (
      FORMAT_PREFIX + Buffer.from(JSON.stringify(blob), 'utf-8').toString('base64')
    );
  } finally {
    wipeBuffer(key);
  }
}

/**
 * Descriptografa um vault v2. Lança se:
 *   - formato não é v2 (use isV2Format antes para detectar)
 *   - PIN incorreto (nacl.secretbox.open retorna null)
 *   - dados corrompidos
 *
 * Retorna o payload original (mesmo tipo que foi passado para encryptVault).
 */
export function decryptVault(blob: string, pin: string): unknown {
  if (!isV2Format(blob)) {
    throw new Error('decryptVault: formato não é v2.');
  }
  if (typeof pin !== 'string' || pin.length === 0) {
    throw new Error('decryptVault: PIN inválido.');
  }

  // 1. Parse do envelope
  const jsonB64 = blob.slice(FORMAT_PREFIX.length);
  let envelope: VaultBlobV2;
  try {
    envelope = JSON.parse(Buffer.from(jsonB64, 'base64').toString('utf-8'));
  } catch {
    throw new Error('Vault corrompido (envelope JSON inválido).');
  }

  if (envelope.v !== 2) {
    throw new Error(`Versão de vault não suportada: ${String((envelope as any).v)}`);
  }

  // 2. Extrair parâmetros
  let salt: Uint8Array;
  let nonce: Uint8Array;
  let ct: Uint8Array;
  try {
    salt = new Uint8Array(Buffer.from(envelope.salt, 'base64'));
    nonce = new Uint8Array(Buffer.from(envelope.nonce, 'base64'));
    ct = new Uint8Array(Buffer.from(envelope.ct, 'base64'));
  } catch {
    throw new Error('Vault corrompido (campos base64 inválidos).');
  }

  if (salt.length !== SALT_BYTES) {
    throw new Error(`Vault corrompido: salt inesperado (${salt.length} bytes).`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`Vault corrompido: nonce inesperado (${nonce.length} bytes).`);
  }

  // 3. Iterations vêm do envelope (flexível para tunning futuro sem quebrar
  //    vaults antigos do próprio v2).
  //
  // (M7) Threshold elevado para 100_000 — atende OWASP 2023 (mínimo 100k para
  // PBKDF2-SHA256) e remove a janela em que um atacante poderia forjar envelope
  // com 10k iterations + PIN curto para acelerar brute-force. Importante: o
  // ciphertext é autenticado por Poly1305, então adulterar o kdf no envelope
  // sem conhecer a chave já falhava a abertura — mas elevar o threshold é
  // defesa em profundidade barata.
  const iterMatch = envelope.kdf.match(/pbkdf2-sha256-(\d+)/);
  const iterations = iterMatch ? parseInt(iterMatch[1], 10) : PBKDF2_ITERATIONS;
  if (!Number.isFinite(iterations) || iterations < MIN_DECRYPT_ITERATIONS) {
    throw new Error(
      `KDF iterations inválidas no envelope: ${iterations} (mín ${MIN_DECRYPT_ITERATIONS} — OWASP)`,
    );
  }

  // 4. Derivar key e decifrar
  const key = deriveKey(pin, salt, iterations);
  let plaintext: Uint8Array | null;
  try {
    plaintext = nacl.secretbox.open(ct, nonce, key);
  } finally {
    wipeBuffer(key);
  }

  if (!plaintext) {
    // Auth failure: PIN errado OU vault corrompido. Não dá pra distinguir
    // sem oracle — mensagem genérica é correta.
    throw new Error('PIN incorreto ou vault corrompido.');
  }

  // 5. Parse final
  try {
    return JSON.parse(Buffer.from(plaintext).toString('utf-8'));
  } catch {
    throw new Error('Vault descriptografado mas conteúdo não é JSON válido.');
  }
}

/** Exposto para tests/debug; produção usa apenas as funções acima. */
export const __INTERNAL__ = {
  FORMAT_PREFIX,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  NONCE_BYTES,
  KEY_BYTES,
  deriveKey,
  wordArrayToUint8Array,
  uint8ToWordArray,
};
