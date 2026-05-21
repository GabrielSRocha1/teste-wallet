/**
 * tokens.ts — Fonte ÚNICA de verdade para mints/decimals dos tokens da Verum.
 *
 * Por que existir:
 *   Antes desta refatoração, mints de SOL/USDT/USDC/BDC/ESCT/BRT estavam
 *   duplicados em 6 lugares (transactionService, SettingsContext, cambio.tsx,
 *   api/prices, verum-swap/backend, constants/tokens). Inconsistência foi
 *   inevitável — TOKEN_MINTS_DEVNET tinha mints de mainnet, e ninguém percebia.
 *
 * Como usar:
 *   import { getTokenRegistry } from '@/src/config/tokens';
 *   const registry = getTokenRegistry('mainnet'); // ou 'devnet'
 *   const usdt = registry.USDT;  // { mint, decimals, symbol, name }
 *
 * Adicionar um token novo? Só aqui. Mais nenhum lugar.
 */

export interface TokenMeta {
  /** Símbolo canônico (UPPER CASE) */
  symbol: string;
  /** Nome legível */
  name: string;
  /** Mint address Base58 (Solana) */
  mint: string;
  /** Casas decimais on-chain */
  decimals: number;
  /** Program ID se for Token-2022; omitir para SPL Token clássico */
  programId?: string;
  /** Marcador para tokens "internos" da Verum (priorizar fallback para DexScreener etc.) */
  internal?: boolean;
  /** URL do ícone para uso em UI (resolução 64px+ recomendada). */
  iconUrl?: string;
}

export type TokenRegistry = Record<string, TokenMeta>;
export type SolanaNetwork = 'mainnet' | 'devnet';

/** Mint nativo do wrapped SOL (mesmo em todas redes). */
export const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Factory de tokens internos da Verum (BDC, ESCT, BRT, VRC).
 *
 * Antes desta refatoração, cada token interno era declarado individualmente em
 * MAINNET_REGISTRY repetindo os mesmos campos (decimals: 9, internal: true,
 * etc.). Quando adicionamos VRC (5º token interno), a redundância ficou
 * evidente — e qualquer mudança de padrão exigia editar 4 entradas.
 *
 * Agora cada token interno é declarado com apenas o essencial (name, mint,
 * iconUrl) e a factory aplica os defaults canônicos: 9 decimais, internal=true,
 * sem programId customizado (SPL Token clássico).
 *
 * Para mudar um padrão (ex: migrar todos para Token-2022), basta editar a
 * factory aqui — sem tocar nas declarações dos tokens.
 */
interface InternalTokenSpec {
  symbol: string;
  name: string;
  mint: string;
  iconUrl?: string;
  /** Override do default de 9 decimais (só usar se realmente diferente). */
  decimals?: number;
  /** Override do programId (Token-2022 etc.). */
  programId?: string;
}

function createInternalToken(spec: InternalTokenSpec): TokenMeta {
  return {
    symbol: spec.symbol,
    name: spec.name,
    mint: spec.mint,
    decimals: spec.decimals ?? 9,
    internal: true,
    programId: spec.programId,
    iconUrl: spec.iconUrl,
  };
}

// ─── Mainnet ─────────────────────────────────────────────────────────────────

// Tokens externos canônicos (SOL + estáveis) — não passam pela factory
// porque não compartilham defaults (decimals 6, sem flag interna).
const SOL_TOKEN: TokenMeta = {
  symbol: 'SOL',
  name: 'Solana',
  mint: SOL_NATIVE_MINT,
  decimals: 9,
  iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};

const USDT_TOKEN: TokenMeta = {
  symbol: 'USDT',
  name: 'Tether USD',
  mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  decimals: 6,
  iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
};

const USDC_TOKEN: TokenMeta = {
  symbol: 'USDC',
  name: 'USD Coin',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  iconUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
};

// Tokens INTERNOS da Verum — todos seguem os mesmos defaults via factory.
// Adicionar token novo aqui = só nome, mint, iconUrl. Decimais e flag internal
// vêm da factory.
const INTERNAL_TOKENS_MAINNET: TokenMeta[] = [
  createInternalToken({
    symbol: 'BDC',
    name: 'BodeCoin',
    mint: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
  }),
  createInternalToken({
    symbol: 'ESCT',
    name: 'Escoteiros',
    mint: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
    iconUrl: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q',
  }),
  createInternalToken({
    symbol: 'BRT',
    name: 'Brutos',
    mint: '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',
    iconUrl: 'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q',
  }),
  // VRC: placeholder (UI já referencia em `connectionService` mas mint ainda
  // não foi anunciado on-chain). Quando mintar, basta atualizar `mint` aqui.
  // Mantemos comentado para não quebrar `getTokenMeta('VRC')` retornando algo
  // com mint inválido — descomentar quando o token for emitido.
  // createInternalToken({
  //   symbol: 'VRC',
  //   name: 'Verum Crypto',
  //   mint: '<MINT_PENDENTE>',
  // }),
];

const MAINNET_REGISTRY: TokenRegistry = {
  SOL: SOL_TOKEN,
  USDT: USDT_TOKEN,
  USDC: USDC_TOKEN,
  ...Object.fromEntries(INTERNAL_TOKENS_MAINNET.map((t) => [t.symbol, t])),
};

// ─── Devnet ──────────────────────────────────────────────────────────────────
// CORREÇÃO IMPORTANTE: BDC/ESCT/BRT NÃO existem em devnet — antes a constante
// tinha os mints de mainnet aqui, o que causava saldo 0 silencioso e quotes
// quebradas em devnet. Removidos. Quando esses tokens forem mintados em devnet
// para QA, adicione aqui com os mints reais devnet.

const DEVNET_REGISTRY: TokenRegistry = {
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    mint: SOL_NATIVE_MINT,
    decimals: 9,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD (devnet)',
    mint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    decimals: 6,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin (devnet)',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
  },
};

// ─── API pública ─────────────────────────────────────────────────────────────

/** Retorna o registry imutável para a rede pedida. */
export function getTokenRegistry(network: SolanaNetwork): TokenRegistry {
  return network === 'mainnet' ? MAINNET_REGISTRY : DEVNET_REGISTRY;
}

/** Retorna metadados de um símbolo na rede. `undefined` se não existir. */
export function getTokenMeta(
  symbol: string,
  network: SolanaNetwork,
): TokenMeta | undefined {
  return getTokenRegistry(network)[symbol];
}

/** Mapa { SYMBOL: mintAddress } — compatível com APIs antigas que esperam esse shape. */
export function getTokenMintsBySymbol(network: SolanaNetwork): Record<string, string> {
  const reg = getTokenRegistry(network);
  return Object.fromEntries(Object.entries(reg).map(([sym, m]) => [sym, m.mint]));
}

/** Mapa inverso { mintAddress: symbol } — útil para parsing de TX on-chain. */
export function getSymbolByMint(network: SolanaNetwork): Record<string, string> {
  const reg = getTokenRegistry(network);
  const out: Record<string, string> = {};
  for (const [sym, m] of Object.entries(reg)) out[m.mint] = sym;
  return out;
}

/** Lista de símbolos marcados como "internos" da Verum. */
export function getInternalSymbols(network: SolanaNetwork): string[] {
  return Object.entries(getTokenRegistry(network))
    .filter(([, m]) => m.internal)
    .map(([sym]) => sym);
}
