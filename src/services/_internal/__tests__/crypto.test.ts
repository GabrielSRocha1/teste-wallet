import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  CryptoError,
  decryptSecretBox,
  deriveKeyPbkdf2,
  encryptSecretBox,
  generateBoxNonce,
  generateSalt,
  generateSecureId,
  generateSessionToken,
  MIN_PBKDF2_ITERATIONS,
  secureRandomBytes,
  secureRandomHex,
  secureWipe,
} from '../crypto';
import {
  assertPositiveBigIntString,
  assertSlippageBps,
  assertSolanaPubkey,
  assertSolanaSignature,
  isValidBase58,
  isValidHex,
  isValidPositiveBigIntString,
  isValidSlippageBps,
  isValidSolanaPubkey,
  isValidSolanaSignature,
  redactForLog,
  sanitizeUrl,
  ValidationError,
} from '../input-validation';

// ────────────────────────────────────────────────────────────────────────────────
// secureRandomBytes
// ────────────────────────────────────────────────────────────────────────────────

describe('secureRandomBytes', () => {
  it('retorna Uint8Array do tamanho pedido', () => {
    const a = secureRandomBytes(16);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(16);
  });

  it('rejeita length inválido', () => {
    expect(() => secureRandomBytes(0)).toThrow(CryptoError);
    expect(() => secureRandomBytes(-1)).toThrow(CryptoError);
    expect(() => secureRandomBytes(1.5)).toThrow(CryptoError);
    expect(() => secureRandomBytes(100_000)).toThrow(CryptoError);
  });

  it('produz valores únicos (alta entropia) em 50 chamadas', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) {
      set.add(Buffer.from(secureRandomBytes(16)).toString('hex'));
    }
    expect(set.size).toBe(50);
  });
});

describe('secureRandomHex', () => {
  it('retorna string hex do dobro do byteLength', () => {
    expect(secureRandomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(secureRandomHex(32)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// encryptSecretBox + decryptSecretBox
// ────────────────────────────────────────────────────────────────────────────────

describe('encryptSecretBox + decryptSecretBox', () => {
  it('roundtrip: encrypted → decrypted recupera plaintext', () => {
    const key = secureRandomBytes(32);
    const plaintext = new TextEncoder().encode('mensagem secreta');
    const { ciphertext, nonce } = encryptSecretBox(plaintext, key);
    const decrypted = decryptSecretBox(ciphertext, nonce, key);
    expect(new TextDecoder().decode(decrypted)).toBe('mensagem secreta');
  });

  it('decryption com chave errada falha autenticação (CryptoError)', () => {
    const key1 = secureRandomBytes(32);
    const key2 = secureRandomBytes(32);
    const { ciphertext, nonce } = encryptSecretBox(new TextEncoder().encode('x'), key1);
    expect(() => decryptSecretBox(ciphertext, nonce, key2)).toThrow(CryptoError);
  });

  it('decryption de ciphertext adulterado falha autenticação', () => {
    const key = secureRandomBytes(32);
    const { ciphertext, nonce } = encryptSecretBox(new TextEncoder().encode('x'), key);
    ciphertext[Math.floor(ciphertext.length / 2)] ^= 0xff;
    expect(() => decryptSecretBox(ciphertext, nonce, key)).toThrow(CryptoError);
  });

  it('encryptSecretBox rejeita key de tamanho errado', () => {
    expect(() => encryptSecretBox(new Uint8Array(10), new Uint8Array(20))).toThrow(CryptoError);
  });

  it('cada encrypt do mesmo plaintext+key produz nonce/ciphertext diferentes', () => {
    const key = secureRandomBytes(32);
    const plaintext = new TextEncoder().encode('repeat');
    const a = encryptSecretBox(plaintext, key);
    const b = encryptSecretBox(plaintext, key);
    expect(Buffer.from(a.nonce).toString('hex')).not.toBe(Buffer.from(b.nonce).toString('hex'));
    expect(Buffer.from(a.ciphertext).toString('hex')).not.toBe(Buffer.from(b.ciphertext).toString('hex'));
  });

  it('decryptSecretBox rejeita nonce com tamanho errado', () => {
    const key = secureRandomBytes(32);
    expect(() => decryptSecretBox(new Uint8Array(10), new Uint8Array(10), key)).toThrow(CryptoError);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// deriveKeyPbkdf2
// ────────────────────────────────────────────────────────────────────────────────

describe('deriveKeyPbkdf2', () => {
  const salt = new Uint8Array(16).fill(7);

  it('determinístico: mesmos inputs → mesma chave', () => {
    const k1 = deriveKeyPbkdf2({ password: 'verum', salt, iterations: MIN_PBKDF2_ITERATIONS });
    const k2 = deriveKeyPbkdf2({ password: 'verum', salt, iterations: MIN_PBKDF2_ITERATIONS });
    expect(Buffer.from(k1).toString('hex')).toBe(Buffer.from(k2).toString('hex'));
    expect(k1.length).toBe(32);
  });

  it('salt diferente → chave diferente', () => {
    const k1 = deriveKeyPbkdf2({
      password: 'p',
      salt: new Uint8Array(16).fill(1),
      iterations: MIN_PBKDF2_ITERATIONS,
    });
    const k2 = deriveKeyPbkdf2({
      password: 'p',
      salt: new Uint8Array(16).fill(2),
      iterations: MIN_PBKDF2_ITERATIONS,
    });
    expect(Buffer.from(k1).toString('hex')).not.toBe(Buffer.from(k2).toString('hex'));
  });

  it('password diferente → chave diferente', () => {
    const k1 = deriveKeyPbkdf2({ password: 'p1', salt, iterations: MIN_PBKDF2_ITERATIONS });
    const k2 = deriveKeyPbkdf2({ password: 'p2', salt, iterations: MIN_PBKDF2_ITERATIONS });
    expect(Buffer.from(k1).toString('hex')).not.toBe(Buffer.from(k2).toString('hex'));
  });

  it('rejeita iterations abaixo do mínimo seguro', () => {
    expect(() =>
      deriveKeyPbkdf2({ password: 'p', salt, iterations: 1_000 }),
    ).toThrow(CryptoError);
  });

  it('rejeita salt menor que 16 bytes', () => {
    expect(() =>
      deriveKeyPbkdf2({ password: 'p', salt: new Uint8Array(8), iterations: MIN_PBKDF2_ITERATIONS }),
    ).toThrow(CryptoError);
  });

  it('rejeita password vazio', () => {
    expect(() => deriveKeyPbkdf2({ password: '', salt, iterations: MIN_PBKDF2_ITERATIONS })).toThrow(
      CryptoError,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// constantTimeEqual
// ────────────────────────────────────────────────────────────────────────────────

describe('constantTimeEqual', () => {
  it('true para arrays idênticos', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('false para arrays diferentes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('false para tamanhos diferentes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('false para inputs não-Uint8Array', () => {
    // @ts-expect-error testing invalid input
    expect(constantTimeEqual('abc', 'abc')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// secureWipe
// ────────────────────────────────────────────────────────────────────────────────

describe('secureWipe', () => {
  it('zera o buffer no final', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5]);
    secureWipe(buf);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0]);
  });

  it('ignora silenciosamente inputs não-Uint8Array', () => {
    // @ts-expect-error testing invalid input
    expect(() => secureWipe('not a buffer')).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// IDs seguros
// ────────────────────────────────────────────────────────────────────────────────

describe('generateSecureId', () => {
  it('100 IDs únicos (sem colisão)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateSecureId());
    expect(ids.size).toBe(100);
  });

  it('aceita prefixo', () => {
    const id = generateSecureId('sess');
    expect(id).toMatch(/^sess_[1-9A-HJ-NP-Za-km-z]+$/);
  });
});

describe('generateSessionToken', () => {
  it('produz base58 com alta entropia (≥40 chars)', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
});

describe('generateBoxNonce & generateSalt', () => {
  it('generateBoxNonce retorna 24 bytes', () => {
    expect(generateBoxNonce().length).toBe(24);
  });
  it('generateSalt retorna 32 bytes', () => {
    expect(generateSalt().length).toBe(32);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// input-validation
// ════════════════════════════════════════════════════════════════════════════════

describe('isValidBase58', () => {
  it('aceita strings base58 válidas', () => {
    expect(isValidBase58('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
  });
  it('rejeita caracteres ambíguos do base58 (0, O, I, l)', () => {
    expect(isValidBase58('0OIl')).toBe(false);
  });
  it('rejeita string vazia', () => {
    expect(isValidBase58('')).toBe(false);
  });
  it('respeita minLen/maxLen', () => {
    expect(isValidBase58('abc', 5, 10)).toBe(false);
    expect(isValidBase58('abcdef', 5, 10)).toBe(true);
  });
  it('rejeita não-strings', () => {
    expect(isValidBase58(123)).toBe(false);
    expect(isValidBase58(null)).toBe(false);
  });
});

describe('isValidSolanaPubkey', () => {
  it('aceita pubkeys reais (decodificam em 32 bytes)', () => {
    expect(isValidSolanaPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    expect(isValidSolanaPubkey('So11111111111111111111111111111111111111112')).toBe(true);
  });
  it('rejeita strings que não decodificam em 32 bytes', () => {
    expect(isValidSolanaPubkey('1111')).toBe(false);
    expect(isValidSolanaPubkey('A'.repeat(60))).toBe(false);
  });
});

describe('isValidSolanaSignature', () => {
  it('aceita base58 que decodifica em 64 bytes', () => {
    // Constrói uma "signature válida" — 64 bytes de zeros codificados em base58
    const sixtyFourBytes = Buffer.alloc(64, 1);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs58 = require('bs58').default ?? require('bs58');
    const enc = bs58.encode(sixtyFourBytes);
    expect(isValidSolanaSignature(enc)).toBe(true);
  });
  it('rejeita string curta', () => {
    expect(isValidSolanaSignature('abc')).toBe(false);
  });
});

describe('isValidHex', () => {
  it('aceita hex válido', () => {
    expect(isValidHex('deadbeef')).toBe(true);
    expect(isValidHex('DEADBEEF')).toBe(true);
  });
  it('rejeita comprimento ímpar', () => {
    expect(isValidHex('abc')).toBe(false);
  });
  it('respeita expectedByteLength', () => {
    expect(isValidHex('deadbeef', 4)).toBe(true);
    expect(isValidHex('deadbeef', 8)).toBe(false);
  });
  it('rejeita caracteres não-hex', () => {
    expect(isValidHex('deadbxyz')).toBe(false);
  });
});

describe('isValidPositiveBigIntString', () => {
  it('aceita inteiros positivos sem zero à esquerda', () => {
    expect(isValidPositiveBigIntString('1')).toBe(true);
    expect(isValidPositiveBigIntString('1000000')).toBe(true);
  });
  it('rejeita zero, negativos, decimais, hex, vazio', () => {
    expect(isValidPositiveBigIntString('0')).toBe(false);
    expect(isValidPositiveBigIntString('-5')).toBe(false);
    expect(isValidPositiveBigIntString('1.5')).toBe(false);
    expect(isValidPositiveBigIntString('0x1')).toBe(false);
    expect(isValidPositiveBigIntString('')).toBe(false);
    expect(isValidPositiveBigIntString('01')).toBe(false);
  });
  it('respeita maxValue', () => {
    expect(isValidPositiveBigIntString('100', 50n)).toBe(false);
    expect(isValidPositiveBigIntString('100', 200n)).toBe(true);
  });
});

describe('isValidSlippageBps', () => {
  it('aceita 0..max', () => {
    expect(isValidSlippageBps(0)).toBe(true);
    expect(isValidSlippageBps(50)).toBe(true);
    expect(isValidSlippageBps(1000)).toBe(true);
  });
  it('rejeita fora do range ou não-inteiro', () => {
    expect(isValidSlippageBps(1001)).toBe(false);
    expect(isValidSlippageBps(-1)).toBe(false);
    expect(isValidSlippageBps(50.5)).toBe(false);
    expect(isValidSlippageBps('50')).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('aceita https por padrão', () => {
    expect(sanitizeUrl('https://api.example.com/x')).toBe('https://api.example.com/x');
  });
  it('rejeita http por padrão', () => {
    expect(sanitizeUrl('http://example.com')).toBeNull();
  });
  it('aceita http quando explicitamente permitido', () => {
    const r = sanitizeUrl('http://localhost:3000', ['http:', 'https:']);
    expect(r).toBe('http://localhost:3000/');
  });
  it('rejeita protocolos perigosos', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
  });
  it('rejeita strings mal formadas, vazias ou não-string', () => {
    expect(sanitizeUrl('not-a-url')).toBeNull();
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl(123)).toBeNull();
  });
});

describe('redactForLog', () => {
  it('mostra prefixo e tamanho para strings longas', () => {
    expect(redactForLog('abcdefghij', 3)).toBe('abc...10');
  });
  it('mascara totalmente strings curtas', () => {
    expect(redactForLog('abc', 4)).toBe('***');
  });
  it('rotula tipos não-string', () => {
    expect(redactForLog(123)).toBe('<non-string>');
    expect(redactForLog('')).toBe('<empty>');
  });
});

describe('assert helpers', () => {
  it('assertSolanaPubkey retorna o valor ou lança ValidationError', () => {
    expect(assertSolanaPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
    expect(() => assertSolanaPubkey('bad')).toThrow(ValidationError);
  });

  it('assertSolanaSignature lança em entrada inválida', () => {
    expect(() => assertSolanaSignature('short')).toThrow(ValidationError);
  });

  it('assertPositiveBigIntString retorna BigInt parseado', () => {
    expect(assertPositiveBigIntString('1000')).toBe(1000n);
    expect(() => assertPositiveBigIntString('0')).toThrow(ValidationError);
  });

  it('assertSlippageBps retorna número validado', () => {
    expect(assertSlippageBps(50)).toBe(50);
    expect(() => assertSlippageBps(5000)).toThrow(ValidationError);
  });
});
