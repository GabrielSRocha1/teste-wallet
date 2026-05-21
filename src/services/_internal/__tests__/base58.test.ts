import { describe, expect, it } from 'vitest';
import {
  base58Decode,
  base58Encode,
  base58DecodePureJs,
  base58EncodePureJs,
} from '../base58';

// ─── (E1 + M5) Base58 helpers consolidados ──────────────────────────────────

describe('base58 helpers — (E1) wrapper sobre bs58', () => {
  it('encode/decode roundtrip preserva os bytes originais', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 0, 0, 250, 255]);
    const encoded = base58Encode(original);
    const decoded = base58Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('decode de pubkey Solana conhecida → 32 bytes', () => {
    const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const decoded = base58Decode(usdc);
    expect(decoded.length).toBe(32);
  });

  it('encode de 32 bytes zerados → "11111111111111111111111111111111" (system program)', () => {
    const zeros = new Uint8Array(32);
    expect(base58Encode(zeros)).toBe('11111111111111111111111111111111');
  });
});

// ─── (M5) Roundtrip da implementação PURE JS ────────────────────────────────

describe('base58DecodePureJs/EncodePureJs — (M5) roundtrip', () => {
  it('encode + decode pure JS retorna ao mesmo Uint8Array', () => {
    const samples: number[][] = [
      [0],
      [255],
      [1, 2, 3],
      [0, 0, 0, 1],
      [255, 255, 255, 255],
      Array.from({ length: 32 }, (_, i) => i),
      Array.from({ length: 64 }, (_, i) => (i * 7 + 13) & 0xff),
    ];
    for (const bytes of samples) {
      const u8 = new Uint8Array(bytes);
      const encoded = base58EncodePureJs(u8);
      const decoded = base58DecodePureJs(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(u8));
    }
  });

  it('pure JS produz o MESMO resultado que bs58 (drift-free)', () => {
    // Pubkeys conhecidas: ambas implementações devem decodar idênticos
    const samples = [
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'So11111111111111111111111111111111111111112',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      '11111111111111111111111111111111',
    ];
    for (const s of samples) {
      const viaBs58 = base58Decode(s);
      const viaPure = base58DecodePureJs(s);
      expect(Array.from(viaPure)).toEqual(Array.from(viaBs58));
    }
  });

  it('encode pure JS bate com encode bs58 para amostras aleatórias', () => {
    for (let i = 0; i < 20; i++) {
      const u8 = new Uint8Array(32);
      for (let j = 0; j < 32; j++) u8[j] = (i * 31 + j * 17 + 5) & 0xff;
      expect(base58EncodePureJs(u8)).toBe(base58Encode(u8));
    }
  });

  it('rejeita caractere fora do alfabeto base58 (0, O, I, l)', () => {
    expect(() => base58DecodePureJs('Invalid0')).toThrow(/Invalid base58/);
    expect(() => base58DecodePureJs('OIl')).toThrow(/Invalid base58/);
  });

  it('leading zeros preservados (pubkey com prefix de 1s)', () => {
    const onlyZeros = new Uint8Array(5);
    const encoded = base58EncodePureJs(onlyZeros);
    expect(encoded).toBe('11111');
    expect(base58DecodePureJs(encoded)).toEqual(onlyZeros);
  });
});
