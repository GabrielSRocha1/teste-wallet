import { describe, expect, it } from 'vitest';
import { isValidSolanaPubkey } from '../input-validation';

// ─── (F2) Validação de publicKey antes de new PublicKey ────────────────────
//
// Wallet adapters legados foram removidos no pre-deploy audit (EX1). A
// validação `isValidSolanaPubkey` continua sendo o guard padrão para
// callers que recebam pubkey externa (callback URLs, AsyncStorage,
// payloads de dApp).

describe('isValidSolanaPubkey — (F2) guard antes de new PublicKey', () => {
  it('aceita pubkeys válidos (decodificam em 32 bytes base58)', () => {
    expect(isValidSolanaPubkey('11111111111111111111111111111111')).toBe(true);
    expect(isValidSolanaPubkey('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isValidSolanaPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
  });

  it('rejeita string vazia (cenário: AsyncStorage zerado)', () => {
    expect(isValidSolanaPubkey('')).toBe(false);
  });

  it('rejeita undefined/null (cenário: payload de callback sem o campo)', () => {
    expect(isValidSolanaPubkey(undefined)).toBe(false);
    expect(isValidSolanaPubkey(null)).toBe(false);
  });

  it('rejeita string com chars não-base58 (cenário: AsyncStorage corrompido)', () => {
    expect(isValidSolanaPubkey('contains_underscore_invalid_base58')).toBe(false);
    expect(isValidSolanaPubkey('0OIl-invalid-chars')).toBe(false);
  });

  it('rejeita string muito curta (decodificaria em < 32 bytes)', () => {
    expect(isValidSolanaPubkey('abc')).toBe(false);
    expect(isValidSolanaPubkey('1'.repeat(20))).toBe(false);
  });

  it('rejeita string muito longa (decodificaria em > 32 bytes)', () => {
    expect(isValidSolanaPubkey('1'.repeat(60))).toBe(false);
  });

  it('rejeita HTML/JS injection (cenário: dApp malicioso forjou callback)', () => {
    expect(isValidSolanaPubkey('<script>alert(1)</script>')).toBe(false);
    expect(isValidSolanaPubkey('javascript:alert(1)')).toBe(false);
  });

  it('rejeita objeto / array / número', () => {
    expect(isValidSolanaPubkey({} as unknown)).toBe(false);
    expect(isValidSolanaPubkey([] as unknown)).toBe(false);
    expect(isValidSolanaPubkey(42 as unknown)).toBe(false);
  });
});
