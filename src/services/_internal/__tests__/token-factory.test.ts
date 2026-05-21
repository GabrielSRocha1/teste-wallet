import { describe, expect, it } from 'vitest';
import {
  getInternalSymbols,
  getSymbolByMint,
  getTokenMeta,
  getTokenMintsBySymbol,
  getTokenRegistry,
  SOL_NATIVE_MINT,
} from '@/src/config/tokens';

// ─── Token factory (BDC, ESCT, BRT, VRC) ────────────────────────────────────

describe('Token Factory — mainnet registry', () => {
  it('inclui tokens externos canônicos (SOL, USDT, USDC)', () => {
    const reg = getTokenRegistry('mainnet');
    expect(reg.SOL).toBeDefined();
    expect(reg.SOL.mint).toBe(SOL_NATIVE_MINT);
    expect(reg.USDT.decimals).toBe(6);
    expect(reg.USDC.decimals).toBe(6);
  });

  it('inclui tokens INTERNOS BDC, ESCT, BRT pela factory (defaults: 9 decimais + internal)', () => {
    const reg = getTokenRegistry('mainnet');
    for (const sym of ['BDC', 'ESCT', 'BRT']) {
      const meta = reg[sym];
      expect(meta).toBeDefined();
      expect(meta.decimals).toBe(9);
      expect(meta.internal).toBe(true);
      expect(meta.symbol).toBe(sym);
    }
  });

  it('getInternalSymbols retorna apenas os tokens marcados como internos', () => {
    const internals = getInternalSymbols('mainnet');
    expect(internals).toContain('BDC');
    expect(internals).toContain('ESCT');
    expect(internals).toContain('BRT');
    expect(internals).not.toContain('SOL');
    expect(internals).not.toContain('USDT');
    expect(internals).not.toContain('USDC');
  });

  it('getTokenMeta retorna undefined para símbolo desconhecido', () => {
    expect(getTokenMeta('UNKNOWN_XYZ', 'mainnet')).toBeUndefined();
  });

  it('getTokenMintsBySymbol e getSymbolByMint são inversos', () => {
    const bySymbol = getTokenMintsBySymbol('mainnet');
    const byMint = getSymbolByMint('mainnet');

    for (const [sym, mint] of Object.entries(bySymbol)) {
      expect(byMint[mint]).toBe(sym);
    }
  });

  it('mints de tokens INTERNOS são válidos base58 com 32 bytes (PublicKey decoded)', async () => {
    // Importa bs58 dinâmico para não tocar nas chains de mock de outros testes.
    const bs58Mod = await import('bs58');
    const bs58 = bs58Mod.default ?? bs58Mod;

    for (const sym of ['BDC', 'ESCT', 'BRT']) {
      const meta = getTokenMeta(sym, 'mainnet')!;
      const decoded = bs58.decode(meta.mint);
      expect(decoded.length).toBe(32);
    }
  });
});

describe('Token Factory — devnet registry', () => {
  it('inclui SOL nativo e estáveis devnet', () => {
    const reg = getTokenRegistry('devnet');
    expect(reg.SOL).toBeDefined();
    expect(reg.USDT?.mint).toBe('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
  });

  it('NÃO inclui tokens internos em devnet (BDC/ESCT/BRT não foram mintados)', () => {
    const reg = getTokenRegistry('devnet');
    expect(reg.BDC).toBeUndefined();
    expect(reg.ESCT).toBeUndefined();
    expect(reg.BRT).toBeUndefined();
  });
});
