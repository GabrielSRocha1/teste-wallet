// (CR2) Polyfill global.Buffer é aplicado em polyfills.js (raiz, entry point
// importado em app/_layout.tsx). Re-aplicar aqui é redundante.
import { Buffer } from 'buffer';

import { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenAccountNotFoundError } from '@solana/spl-token';
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { generateFullWallet } from './keyDerivation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/services/supabase';
import { getApiBaseUrl } from './apiUrl';

// ─── Infra de resiliência (FASE 2.A) ─────────────────────────────────────────
import { createLogger, newCorrelationId } from './_internal/logger';
import { withTimeout, TimeoutError } from './_internal/timeout';
import { withRetry, isRetryableRpcError } from './_internal/retry';
import { CircuitBreaker, CircuitOpenError } from './_internal/circuit-breaker';
import { toAtomicUnits, applyFeeBps } from './_internal/amount';
import { assertSolanaPubkey } from './_internal/input-validation';
import {
  DEVNET_RPC,
  MAINNET_RPC,
  MAINNET_WS,
  PUBLIC_FALLBACK_RPCS,
} from '@/src/config/rpc';

const log = createLogger('TransactionService');

/**
 * Circuit breakers por "tipo" de upstream. Quando um circuito abre, requests
 * para aquele upstream falham fast por `cooldownMs` antes de tentar de novo.
 */
const rpcBreaker = new CircuitBreaker({
  name: 'solana-rpc-primary',
  failureThreshold: 5,
  rollingWindowMs: 60_000,
  cooldownMs: 30_000,
});

/**
 * UUID Validation Helper
 */
export const isValidUUID = (uuid: string): boolean => {
  const str = String(uuid);
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(str);
};

// ─── Tipos internos (schema real — database.types.ts pode estar desatualizado) ─

/** Linha real de `withdraw_orders` conforme supabase_schema_v3_completo.sql */
interface WithdrawOrderRow {
  id: string;
  user_id: string;
  wallet_address: string;
  token_symbol: string;
  amount_token: number;
  amount_brl: number | null;
  amount_pyg: number | null;
  currency_fiat: string;
  pix_key: string | null;
  bank_name: string | null;
  swap_tx_hash: string | null;
  transfer_receipt: string | null;
  status: string;
  fee_amount: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha real de `deposit_orders` conforme supabase_schema_v3_completo.sql */
interface DepositOrderRow {
  id: string;
  user_id: string;
  wallet_address: string | null;
  amount_brl: number;
  amount_sol: number | null;
  amount_usdt: number | null;
  sol_price_brl: number | null;
  payment_method: string;
  status: string;
  tx_signature: string | null;
  provider: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha real de `transactions` conforme database.types.ts (campos usados aqui) */
interface TransactionRow {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  currency: string;
  blockchain_tx_hash: string | null;
  status: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── Tipos exportados ────────────────────────────────────────────────────────

export interface TransactionParams {
  from: string;
  to: string;
  amount: number;
  feeWallet: string;
  feeAmountSOL?: number;
  type?: 'standard' | 'depositPix' | 'invest';
}

export interface SPLTransactionParams {
  from: string;
  to: string;
  mintAddress: string;
  amount: number;
  decimals: number;
  feeWallet: string;
  programId?: string;
  type?: 'standard' | 'depositPix' | 'invest';
}

/**
 * Taxa Corretora Verum: **2% fixos** em CADA transação construída pela wallet
 * (transfer SOL, transfer SPL, swap). Cobrada sobre o token da transação,
 * em UNIDADES ATÔMICAS (lamports para SOL, unidades raw para SPL).
 *
 * `VERUM_FEE_BPS` é a fonte de verdade canônica em basis points (200 = 2%).
 * `VERUM_FEE_PERCENT` é o derivado para callers de UI que ainda esperam decimal.
 *
 * Esta taxa é SEPARADA do gas de rede Solana (~5000 lamports + priority fee),
 * que é pago pelo `feePayer` (sempre o remetente).
 */
export const VERUM_FEE_BPS = 200;
export const VERUM_FEE_PERCENT = VERUM_FEE_BPS / 10_000;

/**
 * Estimativa de taxas de uma TX construída pela wallet.
 *
 * (E9) `platformFee` agora reflete a taxa Verum 2% REAL quando o caller fornece
 * `context` ao chamar estimateFee. Antes, esse campo era sempre 0 e a UI ficava
 * mostrando "taxa zero" enganando o usuário sobre o custo total.
 *
 * Composição:
 *   solFee     — gas de rede em SOL (pago em lamports pelo feePayer)
 *   usdFee     — solFee convertido para USD via preço atual de SOL
 *   platformFee— taxa Verum 2% (em USD), embutida na TX em token nativo
 *   verumFee   — detalhamento da taxa Verum em token e símbolo (para UI)
 *   total      — usdFee + platformFee (custo total observável pelo usuário)
 */
export interface FeeEstimate {
  solFee: number;
  usdFee: number;
  platformFee: number;
  total: number;
  /** Detalhe da taxa Verum em unidades do token transferido. `null` quando não calculável. */
  verumFee: {
    /** Quantidade do token retida pela Verum (ex: 0.02 SOL para um envio de 1 SOL). */
    tokenAmount: number;
    /** Símbolo do token retido (ex: "SOL", "USDT"). */
    tokenSymbol: string;
    /** Valor em USD da taxa (`tokenAmount * tokenPriceUSD`). */
    usdValue: number;
  } | null;
}

/** Contexto opcional para `estimateFee` calcular a taxa Verum em USD. */
export interface EstimateFeeContext {
  /** Quantidade transferida na UI (ex: 1.5 SOL ou 100 USDT). */
  amountInToken: number;
  /** Símbolo do token transferido. Usado para o detalhamento + busca de preço. */
  tokenSymbol: string;
  /**
   * Preço do token em USD. Se omitido, tenta `getSOLPrice` para SOL.
   * Para outros tokens, callers devem fornecer o preço (do realtimePriceService).
   */
  tokenPriceUsd?: number;
}

/**
 * Carteira oficial de taxas da Verum — vem do .env.
 *
 * Exportada como string "soft": fica vazia se a env não estiver configurada,
 * para que o app NÃO morra no boot (top-level throw quebrava qualquer import).
 * A validação real acontece em assertTreasuryAddress(), chamada apenas quando
 * uma TX que cobra fee é de fato construída.
 */
export const VERUM_TREASURY_ADDRESS = process.env.EXPO_PUBLIC_VERUM_TREASURY_ADDRESS ?? '';

function assertTreasuryAddress(): string {
  if (!VERUM_TREASURY_ADDRESS) {
    throw new Error(
      'EXPO_PUBLIC_VERUM_TREASURY_ADDRESS não configurado no .env — configure antes de enviar transações com taxa.',
    );
  }
  return VERUM_TREASURY_ADDRESS;
}

export interface TxResult {
  hash: string;
  status: 'confirmed' | 'failed';
  slot: number;
}

export interface DynamicToken {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  balance: number;
  programId: string;
}

export interface BalanceResult {
  balances: Record<string, number>;
  dynamicTokens: DynamicToken[];
}

// ─── Raydium Swap Types ──────────────────────────────────────────────────────

export interface RaydiumSwapQuote {
  id: string;
  success: boolean;
  data: {
    swapType: 'BaseIn';
    inputMint: string;
    inputAmount: string;       // raw units como string
    outputMint: string;
    outputAmount: string;      // raw units como string
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: number;
    routePlan: Array<{
      poolId: string;
      inputMint: string;
      outputMint: string;
      feeMint: string;
      feeRate: number;
      feeAmount: string;
    }>;
  };
}

export interface RaydiumSwapTxResponse {
  id: string;
  success: boolean;
  data: Array<{ transaction: string }>; // base64 VersionedTransaction
}

export interface RaydiumSwapParams {
  inputMint: string;
  outputMint: string;
  amountRaw: number;
  walletPublicKey: string;
  slippageBps?: number;
}

export interface RaydiumExecuteResult {
  status: 'Success' | 'Failed';
  signature: string;
  slot?: number;
  outputAmountActual?: string;
  error?: string;
}

/**
 * Re-exports para retro-compatibilidade. A fonte de verdade agora é
 * src/config/tokens.ts. Mudanças de mints/decimals devem ser feitas LÁ.
 *
 * Importante: o shape (`Record<string, { mint, decimals }>`) é preservado
 * para não quebrar callers existentes (incl. app/transferir.tsx que faz
 * `require('@/src/services/transactionService').TOKEN_MINTS`).
 */
import {
  getTokenRegistry,
  type TokenMeta as RegistryTokenMeta,
} from '@/src/config/tokens';

export type TokenMeta = Pick<RegistryTokenMeta, 'mint' | 'decimals'>;

function buildLegacyMintsRecord(network: 'mainnet' | 'devnet'): Record<string, TokenMeta> {
  const reg = getTokenRegistry(network);
  const out: Record<string, TokenMeta> = {};
  for (const [sym, meta] of Object.entries(reg)) {
    // SOL fica fora do shape legado pra não quebrar callers que iteram por SPL
    if (sym === 'SOL') continue;
    out[sym] = { mint: meta.mint, decimals: meta.decimals };
  }
  return out;
}

export const TOKEN_MINTS_MAINNET: Record<string, TokenMeta> = buildLegacyMintsRecord('mainnet');
export const TOKEN_MINTS_DEVNET: Record<string, TokenMeta> = buildLegacyMintsRecord('devnet');

// Fallback legacy: { SYMBOL: mintAddress } — mainnet only (mantém comportamento
// histórico do shim TOKEN_MINTS usado em alguns lugares).
export const TOKEN_MINTS: Record<string, string> = Object.fromEntries(
  Object.entries(TOKEN_MINTS_MAINNET).map(([k, v]) => [k, v.mint]),
);

// ─── Constantes ──────────────────────────────────────────────────────────────
// Resolução de endpoints centralizada em src/config/rpc.ts — fonte única
// usada também pelo _layout.tsx (SolanaConnectionProvider). Não duplicar
// a lógica aqui.

let currentPublicIdx = 0;

/** Retorna o RPC correto para a rede. */
function rpcForNetwork(network: 'mainnet' | 'devnet', forcePublic = false): string {
  if (network === 'devnet') return DEVNET_RPC;
  if (forcePublic) return PUBLIC_FALLBACK_RPCS[currentPublicIdx];
  return MAINNET_RPC;
}

function wsEndpointForNetwork(network: 'mainnet' | 'devnet'): string | undefined {
  if (network === 'devnet') return undefined;
  return MAINNET_WS;
}


const MAX_RETRIES = 3;
const BACKOFF_MS = 1_000;

/**
 * (F8) Classifica se um erro de broadcast deve ativar o fallback RPC público.
 *
 * Categorias que DEVEM ativar fallback:
 *   - CircuitOpenError do breaker primário (RPC saturado/derrubado)
 *   - HTTP 429 / Too Many Requests (rate-limit)
 *   - HTTP 403 / Access forbidden (key expirada, tier estourado no Helius)
 *   - HTTP 401 (auth do RPC inválida)
 *
 * Erros como InsufficientFunds, InvalidTransaction, Custom error on-chain
 * NÃO devem cair em fallback — mudar de RPC não muda o erro semântico.
 *
 * Exportado para teste isolado.
 */
export function isRateOrAuthFailure(err: unknown, message?: string): boolean {
  if (err instanceof CircuitOpenError) return true;
  const msg = message ?? (err instanceof Error ? err.message : String(err));
  if (typeof msg !== 'string') return false;
  return (
    msg.includes('429') ||
    msg.includes('Too Many Requests') ||
    msg.includes('403') ||
    msg.includes('Access forbidden') ||
    msg.includes('401')
  );
}

// ─── TransactionService ──────────────────────────────────────────────────────

class TransactionService {
  private connection: Connection;
  private connectionCache = new Map<string, Connection>();
  public currentNetwork: 'mainnet' | 'devnet' = 'mainnet';
  private publicRpcMode = false;
  public readonly SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
  private balanceCache = new Map<string, { data: BalanceResult, timestamp: number }>();

  constructor() {
    // Usa EXCLUSIVAMENTE o RPC da rede declarada — sem variável genérica ambígua
    this.connection = new Connection(rpcForNetwork(this.currentNetwork), {
      commitment: 'confirmed',
      wsEndpoint: wsEndpointForNetwork(this.currentNetwork),
    });
  }

  /**
   * (F1) Fetch de blockhash com retry exponencial + jitter + timeout.
   *
   * Antes desta correção, `buildSOLTransfer`/`buildSPLTransfer` chamavam
   * `this.connection.getLatestBlockhash('finalized')` cru — um único 429 do
   * RPC abortava o fluxo inteiro de envio. Pior: erros de rede transitórios
   * (timeout, ECONNRESET) também rompiam.
   *
   * Agora:
   *   - withRetry (3 tentativas, baseDelay 400ms, maxDelay 1500ms, jitter ±30%)
   *   - withTimeout (8s por tentativa) — `getLatestBlockhash` raramente leva > 2s,
   *     mas RPCs degradados podem pendurar indefinidamente.
   *   - isRetryableRpcError filtra: só re-tenta 429/5xx/timeout/fetch failed.
   *     Erros como "invalid commitment" propagam imediatamente.
   */
  private async _fetchBlockhashWithRetry(
    commitment: 'finalized' | 'confirmed' | 'processed' = 'finalized',
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return withRetry(
      () =>
        withTimeout(
          this.getConnection().getLatestBlockhash(commitment),
          8_000,
          `getLatestBlockhash:${commitment}`,
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        maxDelayMs: 1500,
        isRetryable: isRetryableRpcError,
        onRetry: ({ attempt, error }) =>
          log.warn('blockhash.retry', {
            attempt,
            commitment,
            error: error instanceof Error ? error.message : String(error),
          }),
      },
    );
  }

  public async withRetry<T>(fn: (conn: Connection) => Promise<T>, retries = MAX_RETRIES, delay = BACKOFF_MS): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn(this.getConnection());
      } catch (err: any) {
        if (attempt === retries) throw err;

        // Rotação para RPC público é último recurso — só quando o RPC PRIMÁRIO
        // (proxy /api/solana-rpc) parece indisponível. Erros 401/403/429 NÃO
        // dispara rotação: o proxy respondeu, foi o upstream Helius que negou,
        // e rotacionar pra publicnode/ankr não ajuda (eles bloqueiam métodos
        // como getTokenAccountsByOwner). Backoff e tenta de novo no mesmo RPC.
        //
        // Rotação válida: 5xx (proxy/Vercel down), erros de fetch/timeout.
        const errorMsg = err.message || '';
        const isUpstreamDown = /\b50[0-9]\b/.test(errorMsg) ||
          errorMsg.includes('Failed to fetch') ||
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ENOTFOUND') ||
          errorMsg.includes('timeout');

        if (isUpstreamDown) {
          console.warn(`[TransactionService] Proxy aparentemente indisponível (${errorMsg.slice(0, 80)}). Rotacionando para RPC público...`);
          this.rotatePublicRpc();
        }

        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error('Máximo de tentativas excedido.');
  }


  /**
   * (PF2) Retorna a Connection pública CACHEADA — antes criava nova Connection
   * a cada chamada. Em broadcast fallback (3 retries × 4 RPCs), abria até 12
   * sockets TLS desnecessários. Agora reusa a cache.
   */
  public getPublicConnection(): Connection {
    const cacheKey = `${this.currentNetwork}_publicRotation`;
    const cached = this.connectionCache.get(cacheKey);
    if (cached) return cached;
    const conn = new Connection(rpcForNetwork(this.currentNetwork, true), {
      commitment: 'confirmed',
      wsEndpoint: wsEndpointForNetwork(this.currentNetwork),
    });
    this.connectionCache.set(cacheKey, conn);
    return conn;
  }

  public getConnection(network?: 'mainnet' | 'devnet'): Connection {
    const net = network || this.currentNetwork;
    const cacheKey = `${net}${this.publicRpcMode ? '_public' : ''}`;

    if (this.connectionCache.has(cacheKey)) {
      return this.connectionCache.get(cacheKey)!;
    }

    // (PF8) Cap defensivo no cache: máx 8 conexões (network × mode × rotation).
    // Em uso normal nunca passa de 4. Cap evita leak em loop de rotação.
    if (this.connectionCache.size >= 8) {
      const firstKey = this.connectionCache.keys().next().value;
      if (firstKey) this.connectionCache.delete(firstKey);
    }

    const conn = new Connection(rpcForNetwork(net, this.publicRpcMode), {
      commitment: 'confirmed',
      wsEndpoint: wsEndpointForNetwork(net),
    });
    this.connectionCache.set(cacheKey, conn);
    return conn;
  }

  // (E3) `getHeliusConnection` removido — era apenas um alias morto para
  // `getConnection`, mantido por compat após a migração que tirou o Helius.
  // Nenhum caller externo dependia dele.

  /** Ativa modo de emergência para usar RPC público (útil quando o Helius estoura o limite) */
  public setPublicMode(active: boolean) {
    this.publicRpcMode = active;
    this.connectionCache.clear();
    this.connection = this.getConnection();
    console.log(`[TransactionService] Modo RPC Público: ${active ? 'ATIVADO' : 'DESATIVADO'}`);
  }

  /** Força a rotação para o próximo RPC público se o atual estiver falhando (401/403/429) */
  public rotatePublicRpc(network?: 'mainnet' | 'devnet') {
    const net = network || this.currentNetwork;
    
    if (net === 'mainnet') {
      currentPublicIdx = (currentPublicIdx + 1) % PUBLIC_FALLBACK_RPCS.length;
      const nextRpc = PUBLIC_FALLBACK_RPCS[currentPublicIdx];
      console.log(`[TransactionService] Rotacionando para próximo RPC público: ${nextRpc}`);
    }

    this.connectionCache.delete(`${net}`);
    this.connectionCache.delete(`${net}_public`);
    if (net === this.currentNetwork) {
      this.connection = this.getConnection(net);
    }
    console.log(`[TransactionService] RPC rotacionado para ${net} devido a erro de conexão.`);
  }


  async initNetwork() {
    try {
      const net = await AsyncStorage.getItem('@solana_network');
      if (net === 'mainnet' || net === 'devnet') {
        this.setNetwork(net, false);
      }
    } catch (e) {}
  }

  public setNetwork(network: 'mainnet' | 'devnet', save = true) {
    if (network !== 'mainnet' && network !== 'devnet') {
      throw new Error(
        `[TransactionService] BLOQUEADO: network_env inválido: "${network}". ` +
        "Use 'mainnet' ou 'devnet' de forma explícita.",
      );
    }
    this.currentNetwork = network;
    // rpcForNetwork garante que nunca haverá cruzamento de endpoints entre redes
    this.connection = new Connection(rpcForNetwork(network), {
      commitment: 'confirmed',
      wsEndpoint: wsEndpointForNetwork(network),
    });
    this.connectionCache.clear();
    if (save) {
      AsyncStorage.setItem('@solana_network', network).catch(() => {});
    }
  }

  public getNetwork(): 'mainnet' | 'devnet' {
    return this.currentNetwork;
  }

  public getTokenMints(): Record<string, string> {
    const metas = this.currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET;
    return Object.fromEntries(Object.entries(metas).map(([k, v]) => [k, v.mint]));
  }

  public getTokenMeta(symbol: string): TokenMeta | undefined {
    const metas = this.currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET;
    return metas[symbol];
  }

  async getSOLPrice(): Promise<number> {
    if (this.currentNetwork === 'devnet') return 0;

    // 1. Binance — pair SOLUSDT, atualização sub-segundo
    try {
      const res = await fetch(
        'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
        { signal: AbortSignal.timeout(6_000) },
      );
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data?.price ?? '0');
        if (price > 0) return price;
      }
    } catch {}

    // 2. CoinGecko fallback
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { signal: AbortSignal.timeout(6_000) },
      );
      if (res.ok) {
        const data = await res.json();
        const price = data?.solana?.usd ?? 0;
        if (price > 0) return price;
      }
    } catch {}

    return 0;
  }

  async getSOLBalance(address: string): Promise<number> {
    try {
      const pubkey = new PublicKey(address);
      const lamports = await this.withRetry((c) => c.getBalance(pubkey));
      return lamports / LAMPORTS_PER_SOL;
    } catch (e: any) {
      console.error('[TransactionService] Erro ao buscar saldo SOL on-chain:', e.message);
      if (e?.message?.includes('403') || e?.message?.includes('429')) {
        this.rotatePublicRpc();
      }
      return 0;
    }
  }

  async getTokenPrices(): Promise<{ prices: Record<string, { USD: number }>, changes: Record<string, number> }> {
      const prices: Record<string, { USD: number }> = {};
      const changes: Record<string, number> = {};

      if (this.currentNetwork === 'devnet') {
        return { prices, changes };
      }

      const metas = TOKEN_MINTS_MAINNET;
      const internalMints = Object.values(metas).map(m => m.mint);
      const coingeckoIds = ['solana', 'usd-coin', 'tether', 'bitcoin', 'ethereum', 'binancecoin'];
      const COINGECKO_TO_SYM: Record<string, string> = {
        solana: 'SOL', 'usd-coin': 'USDC', tether: 'USDT',
        bitcoin: 'BTC', ethereum: 'ETH', binancecoin: 'BNB',
      };

      // 3 fontes em paralelo — qualquer falha é absorvida individualmente
      const [binanceRes, coingeckoRes, dexRes] = await Promise.allSettled([
        fetch(
          `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'USDCUSDT']))}`,
          { signal: AbortSignal.timeout(6_000) },
        ).then(r => r.ok ? r.json() : []),
        fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds.join(',')}&vs_currencies=usd`,
          { signal: AbortSignal.timeout(8_000) },
        ).then(r => r.ok ? r.json() : {}),
        fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${internalMints.join(',')}`,
          { signal: AbortSignal.timeout(8_000) },
        ).then(r => r.ok ? r.json() : { pairs: [] }),
      ]);

      // Binance
      if (binanceRes.status === 'fulfilled' && Array.isArray(binanceRes.value)) {
        for (const item of binanceRes.value as { symbol: string; price: string }[]) {
          const sym = item.symbol.replace('USDT', '');
          const p = parseFloat(item.price);
          if (p > 0) prices[sym] = { USD: p };
        }
      }

      // CoinGecko (preenche gaps)
      if (coingeckoRes.status === 'fulfilled') {
        const cg = coingeckoRes.value as Record<string, { usd?: number }>;
        for (const [id, obj] of Object.entries(cg || {})) {
          const sym = COINGECKO_TO_SYM[id];
          if (sym && !prices[sym] && obj?.usd) prices[sym] = { USD: obj.usd };
        }
      }

      // DexScreener (autoritativo para internos)
      if (dexRes.status === 'fulfilled') {
        const dex = dexRes.value as { pairs?: any[] };
        const mintToSym = Object.fromEntries(
          Object.entries(metas).map(([sym, m]) => [m.mint, sym]),
        );
        const bestPerMint: Record<string, { price: number; liq: number }> = {};
        for (const pair of dex.pairs ?? []) {
          const mint = pair?.baseToken?.address;
          const price = parseFloat(pair?.priceUsd ?? '0');
          const liq = pair?.liquidity?.usd ?? 0;
          if (!mint || price <= 0) continue;
          if (!bestPerMint[mint] || liq > bestPerMint[mint].liq) {
            bestPerMint[mint] = { price, liq };
          }
        }
        for (const [mint, { price }] of Object.entries(bestPerMint)) {
          const sym = mintToSym[mint];
          if (!sym) continue;
          // Para tokens internos (BDC/ESCT/BRT) DexScreener é a fonte primária;
          // para majors, só preenche se Binance/CoinGecko não trouxeram.
          if (['BDC', 'ESCT', 'BRT'].includes(sym) || !prices[sym]) {
            prices[sym] = { USD: price };
          }
        }
      }

      // Stablecoins: força $1 se nada respondeu
      if (!prices.USDT) prices.USDT = { USD: 1 };
      if (!prices.USDC) prices.USDC = { USD: 1 };

      return { prices, changes };
  }

  async buildSOLTransfer(params: TransactionParams): Promise<Transaction> {
    try {
      // (SE3) Valida endereços ANTES de qualquer trabalho de build/RPC.
      // assertSolanaPubkey lança ValidationError tipado com sample redacted.
      assertSolanaPubkey(params.from, 'from');
      assertSolanaPubkey(params.to, 'to');

      // (C4) Guard de input + conversão BigInt-safe. toAtomicUnits parseia em
      // string (sem aritmética float) e lança AmountConversionError para
      // NaN/Infinity/<=0/decimais inválidos. SOL tem 9 decimais (lamports).
      const totalLamps = toAtomicUnits(params.amount, 9);
      // (C7) Regra de negócio: 2% FIXOS em cada transação — calculados
      // diretamente sobre o valor em lamports (sem ida e volta por float).
      const feeLamps = applyFeeBps(totalLamps, VERUM_FEE_BPS);

      const from = new PublicKey(params.from);
      const to = new PublicKey(params.to);
      const feeWallet = new PublicKey(assertTreasuryAddress());

      // (F1) 'finalized' dá ~150 blocos de janela de validade (~60s) em vez de ~20s.
      // Envolto em withRetry + withTimeout: 429/timeout/5xx do RPC não derrubam mais
      // o fluxo inteiro de envio. 3 tentativas com backoff exponencial e jitter.
      const { blockhash } = await this._fetchBlockhashWithRetry('finalized');

      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: from });

      // Adiciona taxa de prioridade na Mainnet para garantir confirmação
      if (this.currentNetwork === 'mainnet') {
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
      }

      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: totalLamps }));
      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: feeWallet, lamports: feeLamps }));
      return tx;
    } catch (err) { throw err; }
  }

  async buildSPLTransfer(params: SPLTransactionParams): Promise<Transaction> {
    try {
      // (SE3) Valida endereços antes de qualquer trabalho.
      assertSolanaPubkey(params.from, 'from');
      assertSolanaPubkey(params.to, 'to');
      assertSolanaPubkey(params.mintAddress, 'mintAddress');

      if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 18) {
        throw new Error('Decimais inválidos para o token SPL.');
      }
      // (C4) Conversão BigInt-safe (string parsing, sem aritmética float).
      const totalUnits = toAtomicUnits(params.amount, params.decimals);
      // (C7) Regra de negócio: 2% FIXOS sobre o valor em unidades atômicas.
      const feeUnits = applyFeeBps(totalUnits, VERUM_FEE_BPS);

      const from = new PublicKey(params.from);
      const to = new PublicKey(params.to);
      const mint = new PublicKey(params.mintAddress);
      const programId = params.programId ? new PublicKey(params.programId) : undefined;
      const feeWallet = new PublicKey(assertTreasuryAddress());
      // (F1) Mesmo wrapper de retry+timeout aplicado em buildSOLTransfer.
      const { blockhash } = await this._fetchBlockhashWithRetry('finalized');
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: from });

      // Adiciona taxa de prioridade e limite de CU na Mainnet
      if (this.currentNetwork === 'mainnet') {
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
        tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }));
      }

      const fromATA = await getAssociatedTokenAddress(mint, from, false, programId);
      const toATA = await getAssociatedTokenAddress(mint, to, false, programId);
      const feeWalletATA = await getAssociatedTokenAddress(mint, feeWallet, false, programId);

      // Conta do Destinatário
      try {
        await getAccount(this.connection, toATA, 'confirmed', programId);
      } catch (e) {
        if (e instanceof TokenAccountNotFoundError) {
          tx.add(createAssociatedTokenAccountInstruction(from, toATA, to, mint, programId));
        } else { throw e; }
      }

      // Conta da Tesouraria Verum
      try {
        await getAccount(this.connection, feeWalletATA, 'confirmed', programId);
      } catch (e) {
        if (e instanceof TokenAccountNotFoundError) {
          tx.add(createAssociatedTokenAccountInstruction(from, feeWalletATA, feeWallet, mint, programId));
        } else { throw e; }
      }

      // Transfere o valor líquido para o destinatário
      tx.add(createTransferCheckedInstruction(fromATA, mint, toATA, from, totalUnits, params.decimals, [], programId));
      // (C7) Transfere a taxa de 2% para a Verum — atomicidade garantida (mesma TX)
      tx.add(createTransferCheckedInstruction(fromATA, mint, feeWalletATA, from, feeUnits, params.decimals, [], programId));

      return tx;
    } catch (err) { throw err; }
  }

  /**
   * Estima taxa de rede (gas em SOL+USD) e, se `context` for fornecido, também
   * detalha a taxa Verum 2% real em token + USD.
   *
   * (E9) Antes, `platformFee` era sempre 0 e UI mostrava "taxa zero", ignorando
   * a taxa Verum embutida na TX. Agora, com `context`, retornamos os 2% reais.
   */
  async estimateFee(transaction: Transaction, context?: EstimateFeeContext): Promise<FeeEstimate> {
    try {
      // Usa getConnection() (cacheada) em vez de this.connection (privado)
      // para que testes possam spy via vi.spyOn(transactionService.getConnection(), ...).
      const feeInLamports = await this.getConnection().getFeeForMessage(transaction.compileMessage(), 'confirmed');
      const solPriceUSD = await this.getSOLPrice();
      const solFee = (feeInLamports.value ?? 5000) / LAMPORTS_PER_SOL;
      const usdFee = solFee * solPriceUSD;

      // (E9) Detalhamento da taxa Verum 2% — só calculável com context.
      let verumFee: FeeEstimate['verumFee'] = null;
      let platformFee = 0;
      if (context && Number.isFinite(context.amountInToken) && context.amountInToken > 0) {
        const verumTokenAmount = context.amountInToken * VERUM_FEE_PERCENT;
        const priceUsd =
          context.tokenPriceUsd !== undefined
            ? context.tokenPriceUsd
            : context.tokenSymbol === 'SOL'
              ? solPriceUSD
              : 0;
        const usdValue = verumTokenAmount * priceUsd;
        verumFee = {
          tokenAmount: verumTokenAmount,
          tokenSymbol: context.tokenSymbol,
          usdValue,
        };
        platformFee = usdValue;
      }

      return { solFee, usdFee, platformFee, total: usdFee + platformFee, verumFee };
    } catch (err) { throw err; }
  }

  async simulate(transaction: Transaction): Promise<void> {
    try {
      // Converte para VersionedTransaction para usar SimulateTransactionConfig completo:
      // sigVerify: false — permite simular antes de assinar (sem keypair em memória neste ponto)
      // replaceRecentBlockhash: true — evita expiração de blockhash durante a simulação
      const versionedTx = VersionedTransaction.deserialize(
        transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      );
      const result = await this.connection.simulateTransaction(versionedTx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (result.value.err) {
        const errJson = JSON.stringify(result.value.err);

        // 1. Saldo insuficiente (Moeda da transação ou SOL para gas/aluguel)
        if (
          errJson.includes('InsufficientFunds') ||
          errJson.includes('"Custom":1') ||
          errJson.includes('InsufficientFundsForRent')
        ) {
          throw new Error('Saldo insuficiente. Verifique se você tem SOL para o gas da rede (mínimo ≈0.005 SOL recomendado) e se o valor total (envio + taxa 2%) não excede seu saldo disponível.');
        }

        // 2. AccountNotFound — na mainnet, contas sem histórico ainda não existem no estado
        // on-chain. Para transferências SOL (SystemProgram), isso é normal e o runtime cria
        // a conta destino automaticamente. Ignoramos este erro na simulação; ele seria real
        // apenas se o REMETENTE não existisse (sem saldo), tratado no caso 1 acima.
        if (errJson.includes('AccountNotFound')) {
          console.warn('[TransactionService] simulate: AccountNotFound ignorado (conta destino não inicializada — normal na mainnet para contas novas).');
          return;
        }

        // 3. Erros de instrução específicos
        if (errJson.includes('InstructionError')) {
           throw new Error(`Erro na simulação do contrato. Verifique seu saldo de SOL para pagar o aluguel de novas contas de token (ATA), caso o destinatário não as possua.`);
        }

        throw new Error(`A simulação da rede falhou: ${errJson}`);
      }
    } catch (err) { throw err; }
  }

  /**
   * Força a rotação do RPC para a rede especificada e limpa o cache.
   */
  public rotateConnection(network?: 'mainnet' | 'devnet'): void {
    const net = network || this.getNetwork();
    if (net === 'mainnet') {
      console.log('[TransactionService] Forçando rotação de RPC na Mainnet...');
      this.rotatePublicRpc(net);
      this.connectionCache.delete('mainnet');
    }
  }

  /**
   * Monitora uma assinatura até que ela seja confirmada, declarada falha,
   * ou que o blockhash expire (lastValidBlockHeight ultrapassado).
   */
  /**
   * Confirma uma TX on-chain com estratégia híbrida:
   *
   *   1. WebSocket `onSignature` (primário) — push-based, latência mínima,
   *      uma única RPC para inscrição.
   *   2. Polling `getSignatureStatus` (fallback paralelo) — caso o WS demore
   *      a abrir ou caia silenciosamente, polling cobre. Frequência reduzida
   *      a 3s (vs 2s do legado) porque WS pega antes na maioria dos casos.
   *   3. Vigia `lastValidBlockHeight` em paralelo — early-exit se blockhash
   *      expirou (TX foi descartada pela rede).
   *
   * Timeout total: 120s (vs 90s do legado).
   * Retorna `{ slot }` em sucesso; lança em falha definitiva.
   *
   * Mantém compatibilidade com a assinatura legada — mesmo retorno, mesmas
   * exceções esperadas pelos callers ('BLOCKHASH_EXPIRED', 'falhou on-chain').
   */
  private async confirmTransactionRobust(
    signature: string,
    signedBlockhash?: string,
    specificConnection?: Connection,
    lastValidBlockHeight?: number,
    rawTx?: Uint8Array,
  ): Promise<{ slot: number }> {
    const connection = specificConnection || this.getConnection();
    const opLog = log.child({ correlationId: newCorrelationId('confirm'), signature });
    opLog.info('confirm.start', { lastValidBlockHeight: lastValidBlockHeight ?? null });

    const TOTAL_TIMEOUT_MS = 120_000;
    const POLL_INTERVAL_MS = 3_000;
    const BLOCKHEIGHT_CHECK_EVERY_N_POLLS = 3; // ~9s
    const REBROADCAST_EVERY_N_POLLS = 2;       // ~6s — reenvia a tx pra evitar drops/forks
    const startedAt = Date.now();

    // Promise compartilhada: o primeiro a resolver/rejeitar ganha.
    return new Promise<{ slot: number }>((resolve, reject) => {
      let settled = false;
      let wsSubscriptionId: number | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let pollIteration = 0;

      const cleanup = () => {
        if (wsSubscriptionId !== null) {
          try {
            connection.removeSignatureListener(wsSubscriptionId).catch(() => {});
          } catch {
            /* removeSignatureListener pode lançar se conexão já caiu */
          }
          wsSubscriptionId = null;
        }
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      };

      const finishOk = (slot: number, via: 'ws' | 'poll') => {
        if (settled) return;
        settled = true;
        cleanup();
        opLog.info('confirm.success', { via, elapsedMs: Date.now() - startedAt, slot });
        resolve({ slot });
      };

      const finishErr = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        opLog.warn('confirm.failed', { reason: err.message, elapsedMs: Date.now() - startedAt });
        reject(err);
      };

      // ── 1. WebSocket subscription (primária) ──────────────────────────────
      try {
        wsSubscriptionId = connection.onSignature(
          signature,
          (notification, ctx) => {
            if (notification.err) {
              finishErr(
                new Error(`Transação falhou on-chain: ${JSON.stringify(notification.err)}`),
              );
              return;
            }
            finishOk(ctx.slot ?? 0, 'ws');
          },
          'confirmed',
        );
        opLog.debug('confirm.ws_subscribed', { wsSubscriptionId });
      } catch (wsErr) {
        opLog.warn('confirm.ws_subscription_failed', { error: (wsErr as Error).message });
        // Sem WS: polling assume o trabalho sozinho.
      }

      // ── 2. Polling paralelo + checagem de blockhash expiration ─────────────
      const tick = async () => {
        if (settled) return;
        pollIteration++;

        if (Date.now() - startedAt >= TOTAL_TIMEOUT_MS) {
          finishErr(
            new Error(
              `Transação não confirmada após ${Math.round(TOTAL_TIMEOUT_MS / 1000)}s. ` +
              `Signature: ${signature}. Verifique o explorador em instantes.`,
            ),
          );
          return;
        }

        // (a) Checagem de status
        try {
          const statusRes = await withTimeout(
            connection.getSignatureStatus(signature, { searchTransactionHistory: true }),
            5_000,
            'getSignatureStatus',
          );
          const cs = statusRes.value?.confirmationStatus;

          if (statusRes.value?.err) {
            finishErr(
              new Error(`Transação falhou on-chain: ${JSON.stringify(statusRes.value.err)}`),
            );
            return;
          }

          if (cs === 'confirmed' || cs === 'finalized') {
            finishOk(statusRes.value?.slot ?? 0, 'poll');
            return;
          }
        } catch (statusErr: any) {
          const msg = statusErr?.message || '';
          // Rate limit / timeout — não fatal; segue o tick (WS pode resolver antes).
          if (!isRetryableRpcError(statusErr) && !(statusErr instanceof TimeoutError)) {
            opLog.warn('confirm.poll_unexpected_error', { error: msg });
          }
        }

        // (b) Checagem de blockhash expirado (a cada N polls; economiza RPC)
        if (lastValidBlockHeight && pollIteration % BLOCKHEIGHT_CHECK_EVERY_N_POLLS === 0) {
          try {
            const currentBlockHeight = await withTimeout(
              connection.getBlockHeight('confirmed'),
              4_000,
              'getBlockHeight',
            );
            if (currentBlockHeight > lastValidBlockHeight) {
              finishErr(
                new Error('BLOCKHASH_EXPIRED: a transação não foi incluída antes do blockhash expirar.'),
              );
              return;
            }
          } catch {
            /* rate-limit / timeout: ignora; checa de novo no próximo ciclo */
          }
        }

        // (c) Rebroadcast — reenvia a tx assinada enquanto não confirma.
        // Solana duplica naturalmente por signature (idempotente). Necessário
        // porque RPCs ocasionalmente droppam txs e leaders podem skipá-las;
        // sem rebroadcast a tx fica órfã até o blockhash expirar.
        if (rawTx && pollIteration % REBROADCAST_EVERY_N_POLLS === 0) {
          try {
            await withTimeout(
              connection.sendRawTransaction(rawTx, {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
                maxRetries: 0,
              }),
              5_000,
              'rebroadcast',
            );
            opLog.debug('confirm.rebroadcast', { pollIteration });
          } catch {
            /* Falha de rebroadcast (rate-limit, network) não é fatal — o próximo tick tenta de novo */
          }
        }

        // Agenda próximo tick (com proteção dupla — settled pode mudar enquanto await)
        if (!settled) {
          pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      };

      // Primeiro tick após delay curto (dá chance ao WS responder primeiro em TX rápidas)
      pollTimer = setTimeout(tick, 1_000);
    });
  }

  /**
   * Pipeline de broadcast: extrai sig+blockhash → (simula se swap) → envia
   * com retry+circuit breaker → fallback RPC público → último recurso backend
   * proxy → confirma via WebSocket+polling.
   *
   * Tudo com logging estruturado e correlation ID end-to-end.
   * API pública intocada: mesma assinatura, mesmo retorno, mesmas exceções.
   */
  async broadcastSigned(
    signedTx: Transaction | VersionedTransaction,
    options?: { skipPreflight?: boolean, isSwap?: boolean, lastValidBlockHeight?: number },
  ): Promise<TxResult> {
    const isVersioned = signedTx instanceof VersionedTransaction;
    let currentConnection = this.getConnection();
    const skipPreflight = options?.skipPreflight ?? false;
    const isSwap = options?.isSwap ?? false;
    const lastValidBlockHeight = options?.lastValidBlockHeight;

    const correlationId = newCorrelationId(isSwap ? 'swap' : 'tx');
    const opLog = log.child({ correlationId });

    // ── 1. Extrair assinatura e blockhash ───────────────────────────────────
    let signature: string;
    let signedBlockhash: string;

    if (isVersioned) {
      signature = bs58.encode(signedTx.signatures[0]);
      signedBlockhash = signedTx.message.recentBlockhash ?? '';
    } else {
      signature = bs58.encode(signedTx.signatures[0].signature!);
      signedBlockhash = signedTx.recentBlockhash ?? '';
    }

    if (!signedBlockhash) {
      opLog.error('broadcast.no_blockhash');
      throw new Error('Transação sem blockhash — assine antes de fazer broadcast.');
    }

    opLog.info('broadcast.start', {
      signature,
      versioned: isVersioned,
      skipPreflight,
      isSwap,
      lastValidBlockHeight: lastValidBlockHeight ?? null,
    });

    // ── 2. Simulação local pré-envio (somente swap) ─────────────────────────
    if (isSwap && isVersioned) {
      try {
        const simResult = await withTimeout(
          currentConnection.simulateTransaction(signedTx as VersionedTransaction, {
            sigVerify: true,
            commitment: 'confirmed',
          }),
          8_000,
          'simulateTransaction',
        );
        if (simResult.value.err) {
          const errJson = JSON.stringify(simResult.value.err);
          const programLogs = (simResult.value.logs ?? [])
            .filter((l) => l.includes('Program log:') || l.includes('failed') || l.includes('Error'))
            .slice(-12)
            .join(' | ');
          opLog.warn('broadcast.simulation_rejected', { err: errJson, logs: programLogs });
          console.error('[broadcastSigned] Simulate logs:\n' + (simResult.value.logs ?? []).join('\n'));
          // Propaga o erro cru — translateError no caller normaliza a mensagem
          throw new Error(`Transaction simulation failed: ${errJson} | logs: ${programLogs}`);
        }
        opLog.debug('broadcast.simulation_ok');
      } catch (simErr: any) {
        const msg = simErr?.message || '';
        // Erros "hard" da simulação (saldo, custom error) propagam imediatamente
        if (msg.includes('simulation failed') || msg.includes('Custom') || msg.includes('Insufficient')) {
          throw simErr;
        }
        // Erros "soft" (timeout, rate-limit) não bloqueiam — seguimos para o envio
        opLog.warn('broadcast.simulation_skipped', { reason: msg.substring(0, 120) });
      }
    }

    const rawTx = signedTx.serialize();

    // ── 3. Enviar transação com circuit breaker + retry ─────────────────────
    let sendStrategy: 'primary' | 'public' | 'backend' = 'primary';

    const sendViaConnection = (conn: Connection, sp: boolean) =>
      withTimeout(
        conn.sendRawTransaction(rawTx, {
          skipPreflight: sp,
          preflightCommitment: 'confirmed',
          maxRetries: 2,
        }),
        15_000,
        'sendRawTransaction',
      );

    try {
      // Tentativa primária com circuit breaker + retry curto
      await rpcBreaker.execute(() =>
        withRetry(
          () => sendViaConnection(currentConnection, skipPreflight),
          {
            maxAttempts: 2,
            baseDelayMs: 400,
            maxDelayMs: 1500,
            onRetry: ({ attempt, error }) =>
              opLog.warn('broadcast.primary_retry', {
                attempt,
                error: (error as Error)?.message,
              }),
          },
        ),
      );
      opLog.debug('broadcast.sent_via_primary');
    } catch (primaryErr: any) {
      const primaryMsg = primaryErr?.message ?? String(primaryErr);
      // (F8) Lógica extraída em isRateOrAuthFailure (exportada) para teste
      // isolado da classificação que decide quando ativar o fallback.
      if (!isRateOrAuthFailure(primaryErr, primaryMsg)) {
        opLog.error('broadcast.primary_failed_terminal', primaryErr);
        throw primaryErr;
      }

      // ── Fallback: RPC público ──────────────────────────────────────────────
      opLog.warn('broadcast.fallback_public', { reason: primaryMsg.substring(0, 120) });
      try {
        currentConnection = this.getPublicConnection();
        sendStrategy = 'public';
        await withRetry(
          () => sendViaConnection(currentConnection, true /* força skipPreflight */),
          {
            maxAttempts: 2,
            baseDelayMs: 400,
            onRetry: ({ attempt, error }) =>
              opLog.warn('broadcast.public_retry', {
                attempt,
                error: (error as Error)?.message,
              }),
          },
        );
        opLog.debug('broadcast.sent_via_public');
      } catch (publicErr: any) {
        opLog.error('broadcast.all_strategies_failed', publicErr, {
          primaryError: primaryMsg.substring(0, 120),
          publicError: publicErr?.message?.substring(0, 120),
        });
        throw new Error(`Falha total no envio: ${publicErr.message ?? publicErr}`);
      }
    }

    // ── 4. Aguardar confirmação robusta (WebSocket + polling híbrido) ──────
    const { slot } = await this.confirmTransactionRobust(
      signature,
      signedBlockhash,
      currentConnection,
      lastValidBlockHeight,
      rawTx,
    );
    opLog.info('broadcast.confirmed', { strategy: sendStrategy, slot });
    return { hash: signature, status: 'confirmed', slot };
  }

  /** Alias amigável para obter conexão de uma rede específica */
  public getConnectionForNetwork(network: 'mainnet' | 'devnet'): Connection {
    return this.getConnection(network);
  }

  // ─── Raydium Swap ────────────────────────────────────────────────────

  // Compute e Transaction ambos vivem em transaction-v1.raydium.io.
  // api-v3.raydium.io serve apenas metadados (tokens, pools) e NÃO tem /compute → retorna 404 HTML.
  private readonly RAYDIUM_COMPUTE_HOST = 'https://transaction-v1.raydium.io';
  private readonly RAYDIUM_TX_HOST = 'https://transaction-v1.raydium.io';

  /**
   * Busca cotação de swap via Raydium API (mainnet only).
   */
  async raydiumGetQuote(params: RaydiumSwapParams): Promise<RaydiumSwapQuote> {
    if (this.currentNetwork === 'devnet') {
      throw new Error('Raydium não disponível na devnet');
    }
    const slippage = params.slippageBps ?? 50;
    const url =
      `${this.RAYDIUM_COMPUTE_HOST}/compute/swap-base-in` +
      `?inputMint=${encodeURIComponent(params.inputMint)}` +
      `&outputMint=${encodeURIComponent(params.outputMint)}` +
      `&amount=${params.amountRaw}` +
      `&slippageBps=${slippage}` +
      `&txVersion=V0`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Raydium /compute falhou (${res.status}): ${text}`);
    }
    const data = await res.json() as RaydiumSwapQuote;
    if (!data.success) {
      throw new Error(`Raydium quote sem resultado: ${JSON.stringify(data)}`);
    }
    return data;
  }

  /**
   * Obtém a transação de swap assinável via Raydium API.
   */
  private async raydiumGetSwapTx(params: {
    quote: RaydiumSwapQuote;
    walletPublicKey: string;
    computeUnitPriceMicroLamports?: number;
  }): Promise<RaydiumSwapTxResponse> {
    const body = {
      computeUnitPriceMicroLamports: String(params.computeUnitPriceMicroLamports ?? 100_000), // Aumentado para 100k
      swapResponse: params.quote.data,
      txVersion: 'V0',
      wallet: params.walletPublicKey,
      wrapSol: params.quote.data.inputMint === this.SOL_NATIVE_MINT,
      unwrapSol: params.quote.data.outputMint === this.SOL_NATIVE_MINT,
    };

    const res = await fetch(`${this.RAYDIUM_TX_HOST}/transaction/swap-base-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Raydium /transaction falhou (${res.status}): ${text}`);
    }
    const data = await res.json() as RaydiumSwapTxResponse;
    if (!data.success || !data.data || data.data.length === 0) {
      throw new Error('Raydium não retornou transação — pool sem liquidez para este par');
    }
    return data;
  }

  /**
   * Executa um swap Raydium: obtém tx, embute a taxa Verum 2% como instrução
   * adicional (atomicidade swap+fee), refresca blockhash, assina e submete.
   */
  async raydiumExecuteSwap(params: {
    keypair: Keypair;
    quote: RaydiumSwapQuote;
    onProgress?: (step: string) => void;
    /**
     * (C7) Override do fee. Se NÃO informado, é DERIVADO automaticamente da
     * `quote` (outputMint + outputAmount + decimals via getTokenMeta). Isso
     * garante que **toda swap construída pela wallet cobra 2% Verum** mesmo
     * que o caller esqueça de passar o objeto explicitamente.
     */
    fee?: {
      outputMint: string;
      outputAmountRaw: bigint;
      outputDecimals: number;
    };
  }): Promise<RaydiumExecuteResult> {
    try {
      params.onProgress?.('Buscando transação Raydium...');
      const txRes = await this.raydiumGetSwapTx({
        quote: params.quote,
        walletPublicKey: params.keypair.publicKey.toBase58(),
      });

      const connection = this.getConnection();
      const txBytes = Buffer.from(txRes.data[0].transaction, 'base64');
      let transaction = VersionedTransaction.deserialize(txBytes);

      // 1) Resolver Address Lookup Tables usadas pela TX
      const altAccounts: AddressLookupTableAccount[] = [];
      for (const lookup of transaction.message.addressTableLookups) {
        const r = await connection.getAddressLookupTable(lookup.accountKey);
        if (r.value) altAccounts.push(r.value);
      }

      // 2) Decompilar para poder editar (adicionar fee + refrescar blockhash)
      const decompiled = TransactionMessage.decompile(transaction.message, {
        addressLookupTableAccounts: altAccounts,
      });

      // 3) (C7) Embutir instrução de fee Verum 2% — OBRIGATÓRIO em toda swap.
      // Se o caller não passou `fee`, derivamos da quote: outputMint+outputAmount
      // já estão em `quote.data` e os decimais via getTokenMeta. Garante regra
      // de negócio aplicada SEMPRE, mesmo com caller desatento.
      const feeSpec = params.fee ?? this._deriveFeeFromQuote(params.quote);
      params.onProgress?.('Calculando taxa Verum 2%...');
      const feeIxs = await this.buildVerumFeeInstructions({
        payer: params.keypair.publicKey,
        outputMint: feeSpec.outputMint,
        outputAmountRaw: feeSpec.outputAmountRaw,
        outputDecimals: feeSpec.outputDecimals,
        connection,
      });
      for (const ix of feeIxs) decompiled.instructions.push(ix);

      // 4) Refrescar blockhash (evita expiração entre Raydium build → assinatura → broadcast)
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      decompiled.recentBlockhash = blockhash;

      // 5) Recompilar mensagem v0 com as mesmas ALTs
      const newMessage = decompiled.compileToV0Message(altAccounts);
      transaction = new VersionedTransaction(newMessage);

      params.onProgress?.('Assinando transação...');
      transaction.sign([params.keypair]);

      const signature = bs58.encode(transaction.signatures[0]);
      console.log('[Raydium] Transação assinada (swap+fee atômico). Signature:', signature);

      params.onProgress?.('Enviando para a rede Solana...');
      const broadcastRes = await this.broadcastSigned(transaction, { isSwap: true, lastValidBlockHeight });

      return {
        status: broadcastRes.status === 'confirmed' ? 'Success' : 'Failed',
        signature: broadcastRes.hash,
        slot: broadcastRes.slot,
      };
    } catch (e: any) {
      console.error('[Raydium] Erro fatal no swap:', e.message);
      return { status: 'Failed', signature: '', error: e.message };
    }
  }

  /**
   * (C7) Deriva fee spec automaticamente da Raydium quote.
   *
   * Falha explicitamente se a quote não carrega outputMint ou outputAmount
   * — preferimos quebrar o swap a fazer-lo sem cobrar Verum (perda de receita
   * silenciosa). Decimais via `getTokenMeta` — fallback 6 se desconhecido
   * (caso muito raro, dynamicToken — UI já restringe pares conhecidos).
   */
  private _deriveFeeFromQuote(quote: RaydiumSwapQuote): {
    outputMint: string;
    outputAmountRaw: bigint;
    outputDecimals: number;
  } {
    const outputMint = quote?.data?.outputMint;
    const outAmountStr = quote?.data?.outputAmount;
    if (!outputMint || !outAmountStr) {
      throw new Error('Raydium quote sem outputMint/outputAmount — não foi possível derivar fee Verum.');
    }
    const outputAmountRaw = BigInt(outAmountStr);
    // Busca decimais no registry. Fallback 6 cobre USDT/USDC default.
    const mintToMeta = Object.values(
      this.currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET,
    ).find((m) => m.mint === outputMint);
    const outputDecimals = mintToMeta?.decimals ?? (outputMint === this.SOL_NATIVE_MINT ? 9 : 6);
    return { outputMint, outputAmountRaw, outputDecimals };
  }

  /**
   * Constrói a(s) instrução(ões) que enviam 2% do output do swap para a tesouraria Verum.
   * Para SPL token: pode incluir a criação da ATA da tesouraria se ainda não existir.
   */
  private async buildVerumFeeInstructions(params: {
    payer: PublicKey;
    outputMint: string;
    outputAmountRaw: bigint;
    outputDecimals: number;
    connection: Connection;
  }): Promise<TransactionInstruction[]> {
    // (C7) Centraliza cálculo via applyFeeBps — fonte única de verdade da regra 2%.
    const feeRaw = applyFeeBps(params.outputAmountRaw, VERUM_FEE_BPS);
    if (feeRaw === 0n) return [];

    const treasury = new PublicKey(assertTreasuryAddress());
    const ixs: TransactionInstruction[] = [];

    if (params.outputMint === this.SOL_NATIVE_MINT) {
      ixs.push(SystemProgram.transfer({
        fromPubkey: params.payer,
        toPubkey: treasury,
        lamports: feeRaw,
      }));
      return ixs;
    }

    const mint = new PublicKey(params.outputMint);
    const programId = TOKEN_PROGRAM_ID;
    const fromATA = await getAssociatedTokenAddress(mint, params.payer, false, programId);
    const treasuryATA = await getAssociatedTokenAddress(mint, treasury, false, programId);

    try {
      await getAccount(params.connection, treasuryATA, 'confirmed', programId);
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) {
        ixs.push(createAssociatedTokenAccountInstruction(
          params.payer, treasuryATA, treasury, mint, programId,
        ));
      } else {
        throw e;
      }
    }

    ixs.push(createTransferCheckedInstruction(
      fromATA, mint, treasuryATA, params.payer,
      feeRaw, params.outputDecimals, [], programId,
    ));

    return ixs;
  }

  /** Delega ao módulo keyDerivation (BIP39/SLIP-0010). Fonte única de verdade. */
  generateWallet(): { mnemonic: string; publicKey: string; keypair: Keypair } {
    const wallet = generateFullWallet();
    return {
      mnemonic: wallet.mnemonic,
      keypair: wallet.solana.keypair,
      publicKey: wallet.solana.address,
    };
  }

  // ─── Jupiter Swap v1 (substituiu o v6 legado) ────────────────────────────
  // Free tier:  https://lite-api.jup.ag/swap/v1   (sem chave, rate-limited)
  // Pro tier:   https://api.jup.ag/swap/v1        (header x-api-key)
  // O endpoint quote-api.jup.ag/v6 foi descontinuado (CORS fechado / 410).
  // A fee Verum (2%) é mantida via platformFeeBps + feeAccount da treasury.

  private get JUPITER_BASE(): string {
    const key = process.env.EXPO_PUBLIC_JUPITER_API_KEY;
    return key ? 'https://api.jup.ag/swap/v1' : 'https://lite-api.jup.ag/swap/v1';
  }

  private jupiterHeaders(extra?: Record<string, string>): Record<string, string> {
    const key = process.env.EXPO_PUBLIC_JUPITER_API_KEY;
    return {
      Accept: 'application/json',
      ...(key ? { 'x-api-key': key } : {}),
      ...extra,
    };
  }

  async jupiterQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string | number;
    slippageBps: number;
    platformFeeBps?: number;
    onlyDirectRoutes?: boolean;
  }): Promise<any> {
    const url = new URL(`${this.JUPITER_BASE}/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', String(params.amount));
    url.searchParams.set('slippageBps', String(params.slippageBps));
    if (params.platformFeeBps !== undefined) {
      url.searchParams.set('platformFeeBps', String(params.platformFeeBps));
    }
    if (params.onlyDirectRoutes !== undefined) {
      url.searchParams.set('onlyDirectRoutes', String(params.onlyDirectRoutes));
    }

    const res = await fetch(url.toString(), {
      headers: this.jupiterHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jupiter quote ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async jupiterBuildSwap(params: {
    quoteResponse: any;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    feeAccount?: string;
  }): Promise<{ swapTransaction: string; lastValidBlockHeight: number; prioritizationFeeLamports?: number }> {
    const body: Record<string, unknown> = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
      asLegacyTransaction: false,
      prioritizationFeeLamports: 'auto',
    };
    if (params.feeAccount) {
      body.feeAccount = params.feeAccount;
    }

    const res = await fetch(`${this.JUPITER_BASE}/swap`, {
      method: 'POST',
      headers: this.jupiterHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Jupiter swap ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * Deriva a ATA da Verum treasury para um outputMint e verifica se existe on-chain.
   * Retorna `undefined` se a ATA não existe — Jupiter rejeita com erro
   * "feeAccount is required for swap with platformFee" se passarmos endereço inválido,
   * então melhor omitir e perder a fee até a ATA ser criada manualmente.
   */
  async deriveTreasuryFeeAccount(outputMint: string): Promise<string | undefined> {
    try {
      const treasury = new PublicKey(assertTreasuryAddress());
      const mintPk = new PublicKey(outputMint);

      // Descobre se é Token-2022 olhando o owner do mint account.
      const mintAcc = await this.withRetry((c) => c.getAccountInfo(mintPk, 'confirmed'));
      const programId = mintAcc?.owner?.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;

      const ata = await getAssociatedTokenAddress(mintPk, treasury, false, programId);
      const accInfo = await this.withRetry((c) => c.getAccountInfo(ata, 'confirmed'));
      return accInfo ? ata.toBase58() : undefined;
    } catch (e: any) {
      console.warn('[Jupiter Fee] Falha derivando feeAccount:', e?.message ?? e);
      return undefined;
    }
  }

  // ─── getBalances: 2 chamadas RPC totais (getBalance + getParsedTokenAccountsByOwner batch) ──
  // 100% on-chain — sem dependência do backend Verum Swap. Helius/RPC público lê direto.
  async getBalances(walletAddress: string, tokenMints: Record<string, string>): Promise<BalanceResult> {
    const CACHE_WINDOW = 2000; // 2 segundos de "throttle" no frontend
    const cached = this.balanceCache.get(walletAddress);
    if (cached && Date.now() - cached.timestamp < CACHE_WINDOW) {
      return cached.data;
    }

    const balances: Record<string, number> = {};
    const dynamicTokens: DynamicToken[] = [];

    try {
      const pubkey = new PublicKey(walletAddress);

      // Busca SOL + Token Accounts (Token & Token-2022) em paralelo
      const results = await Promise.allSettled([
        this.withRetry((c) => c.getBalance(pubkey)),
        this.withRetry((c) => c.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID })),
        this.withRetry((c) => c.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID })),
      ]);

      if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        // Narrowing TS — ambos podem ser rejected; pegamos o primeiro disponível.
        const rejected = results[0].status === 'rejected' ? results[0] : (results[1] as PromiseRejectedResult);
        throw new Error(`RPC call failed no fallback on-chain: ${rejected.reason}`);
      }

      const solRes = results[0] as PromiseFulfilledResult<number>;
      const tokenRes = results[1] as PromiseFulfilledResult<any>;
      const token2022Res = results[2]; // Opcional, não vamos falhar se o 2022 falhar

      // Processa SOL
      balances['SOL'] = solRes.value / LAMPORTS_PER_SOL;

      // Inicializa tokens conhecidos com 0
      for (const symbol of Object.keys(tokenMints)) {
        if (!balances[symbol]) balances[symbol] = 0;
      }

      // Helper para processar contas de token
      const processTokenAccounts = (accounts: any[], programId: string) => {
        if (!accounts || !Array.isArray(accounts)) return;
        accounts.forEach((account: any) => {
          if (!account || !account.account) return;
          const parsedData = account.account.data?.parsed;
          if (!parsedData) return;
          
          const info = parsedData.info;
          if (!info) return;

          const mint = info.mint;
          const amount = info.tokenAmount?.uiAmount ?? 0;
          const decimals = info.tokenAmount?.decimals ?? 0;

          const knownSymbol = Object.entries(tokenMints).find(([, m]) => m === mint)?.[0];
          if (knownSymbol) {
            balances[knownSymbol] = amount || 0;
          } else if (amount > 0 && mint) {
            const symbol = String(mint).substring(0, 6).toUpperCase();
            dynamicTokens.push({
              symbol,
              name: `Token ${symbol}`,
              mint,
              decimals,
              balance: amount,
              programId,
            });
          }
        });
      };

      if (tokenRes.status === 'fulfilled' && tokenRes.value?.value) {
        processTokenAccounts(tokenRes.value.value, TOKEN_PROGRAM_ID.toBase58());
      }
      if (token2022Res.status === 'fulfilled' && token2022Res.value?.value) {
        processTokenAccounts(token2022Res.value.value, TOKEN_2022_PROGRAM_ID.toBase58());
      }

      const result = { balances, dynamicTokens };
      this.balanceCache.set(walletAddress, { data: result, timestamp: Date.now() });
      return result;
    } catch (err: any) {
      console.error('[TransactionService] Erro fatal no fallback de saldos:', err.message);
      // 403/429 do proxy NÃO disparam rotação — RPCs públicos também bloqueiam
      // getTokenAccountsByOwner. Só rotacionamos quando o proxy parece down.
      const msg = String(err?.message ?? '');
      const isUpstreamDown = /\b50[0-9]\b/.test(msg) ||
        msg.includes('Failed to fetch') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND');
      if (isUpstreamDown) {
        this.rotatePublicRpc();
      }

      const lastCached = this.balanceCache.get(walletAddress);
      if (lastCached) {
        return lastCached.data;
      }
      throw err;
    }
  }

  async getRecentOnChainTransactions(walletAddress: string, limit = 10): Promise<any[]> {
    try {
      const pubkey = new PublicKey(walletAddress);
      const sigs = await this.getConnection().getSignaturesForAddress(pubkey, { limit });
      if (!sigs || sigs.length === 0) return [];

      // (PF5) Batch via getParsedTransactions — uma única chamada RPC para N sigs
      // em vez de N sequenciais. Em telas de histórico, isso reduz a latência de
      // ~N×400ms para ~400ms (10× mais rápido com limit=10).
      // Fallback: se batch falhar (RPC sem suporte ou plano gratuito), cai para
      // o caminho sequencial original.
      let parsedTxs: (Awaited<ReturnType<Connection['getParsedTransaction']>>)[] = [];
      try {
        parsedTxs = await this.getConnection().getParsedTransactions(
          sigs.map((s) => s.signature),
          { maxSupportedTransactionVersion: 0 },
        );
      } catch (batchErr) {
        // Fallback sequencial — preserva comportamento original em RPCs sem batch.
        console.warn('[TransactionService] getParsedTransactions batch falhou, caindo para sequencial:', batchErr);
        parsedTxs = [];
        for (const sigInfo of sigs) {
          try {
            const tx = await this.getConnection().getParsedTransaction(
              sigInfo.signature,
              { maxSupportedTransactionVersion: 0 },
            );
            parsedTxs.push(tx);
          } catch {
            parsedTxs.push(null);
          }
        }
      }

      const result = [];
      for (let i = 0; i < sigs.length; i++) {
        if (result.length >= limit) break;
        const sigInfo = sigs[i];
        const tx = parsedTxs[i];
        try {
          if (!tx || !tx.meta) continue;

          const signature = tx.transaction.signatures[0];
          const createdAt = tx.blockTime
            ? new Date(tx.blockTime * 1000).toISOString()
            : new Date().toISOString();
          const status = tx.meta.err ? 'falha' : 'concluida';
          let found = false;

          // 1. Native SOL change
          const accountIndex = tx.transaction.message.accountKeys.findIndex(
            (k) => (typeof k === 'string' ? k : k.pubkey.toBase58()) === walletAddress,
          );

          if (accountIndex !== -1) {
            const preBalance = tx.meta.preBalances[accountIndex] || 0;
            const postBalance = tx.meta.postBalances[accountIndex] || 0;
            const changeLamports = postBalance - preBalance;
            const changeSOL = Math.abs(changeLamports) / LAMPORTS_PER_SOL;
            const isIn = changeLamports > 0;

            // Threshold 0.0001 SOL ignora gas (~0.000005) mas captura
            // transferências reais. Recebimentos > 0 sempre passam.
            if (changeSOL > 0.0001 || (isIn && changeSOL > 0)) {
              result.push({
                id: signature,
                hash: signature,
                tipo: isIn ? 'Recebimento' : 'Envio',
                destinatario_id: isIn ? 'me' : 'other',
                remetente_id: isIn ? 'other' : 'me',
                valor: changeSOL.toFixed(4),
                moeda: 'SOL',
                status,
                created_at: createdAt,
                onChain: true,
              });
              found = true;
            }
          }

          // 2. SPL transfers — só processa se não já lançou como SOL
          // (defensive: também checa que o id não está duplicado no result)
          if (!found && tx.meta.postTokenBalances) {
            const myTokenBalance = tx.meta.postTokenBalances.find(
              (b) => b.owner === walletAddress,
            );
            if (myTokenBalance) {
              const preTokenBalance = tx.meta.preTokenBalances?.find(
                (b) => b.owner === walletAddress && b.mint === myTokenBalance.mint,
              );
              const preVal = preTokenBalance?.uiTokenAmount.uiAmount || 0;
              const postVal = myTokenBalance.uiTokenAmount.uiAmount || 0;
              const diff = postVal - preVal;

              if (diff !== 0 && !result.some((r) => r.id === signature)) {
                const sym =
                  Object.keys(TOKEN_MINTS).find(
                    (s) => TOKEN_MINTS[s] === myTokenBalance.mint,
                  ) || 'SPL';
                result.push({
                  id: signature,
                  hash: signature,
                  tipo: diff > 0 ? 'Recebimento' : 'Envio',
                  destinatario_id: diff > 0 ? 'me' : 'other',
                  remetente_id: diff > 0 ? 'other' : 'me',
                  valor: Math.abs(diff).toFixed(2),
                  moeda: sym,
                  status,
                  created_at: createdAt,
                  onChain: true,
                });
              }
            }
          }
        } catch (innerErr) {
          console.warn(`Erro ao processar sig ${sigInfo.signature}`, innerErr);
        }
      }
      return result;
    } catch (e) {
      console.warn('[TransactionService] Erro ao buscar transações on-chain:', e);
      return [];
    }
  }

  /**
   * 🆕 BUSCAR ATIVIDADES RECENTES DO BANCO DE DADOS (Supabase)
   * Inclui transações onde o usuário é remetente OU destinatário
   */
  async getRecentActivities(userId: string, limit = 20): Promise<any[]> {
    try {
      // Consulta paralela em todas as tabelas de transação
      const [
        { data: txRaw },
        { data: swapData },
        { data: depositRaw },
        { data: withdrawRaw },
      ] = await Promise.all([
        supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
        supabase.from('swap_orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
        supabase.from('deposit_orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
        supabase.from('withdraw_orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      ]);

      // Tipar resultados com os tipos gerados pelo Supabase (database.types.ts)
      const txData       = (txRaw      ?? []) as TransactionRow[];
      const depositData  = (depositRaw ?? []) as DepositOrderRow[];
      const withdrawData = (withdrawRaw ?? []) as WithdrawOrderRow[];

      // Reverse lookup: endereço mint → { symbol, decimals }
      const mints = this.currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET;
      const mintToMeta: Record<string, { symbol: string; decimals: number }> = {
        'So11111111111111111111111111111111111111112': { symbol: 'SOL', decimals: 9 },
      };
      Object.entries(mints).forEach(([sym, meta]) => { mintToMeta[meta.mint] = { symbol: sym, decimals: meta.decimals }; });

      // Hashes de swap_orders para evitar duplicatas com transactions
      const swapHashes = new Set((swapData || []).map((s: any) => s.on_chain_tx_hash).filter(Boolean));

      const activities: any[] = [];

      // 1. Tabela transactions — amount é NUMERIC (já decimal, sem dividir por 10^n)
      for (const tx of txData) {
        if (tx.type === 'swap' && tx.blockchain_tx_hash && swapHashes.has(tx.blockchain_tx_hash)) continue;
        // metadata é JSONB — acessa com cast seguro para evitar erro em tipo Json
        const meta = (tx.metadata ?? {}) as Record<string, unknown>;
        const isRecebimento = tx.type === 'deposit' || meta['is_receiver'] === true;
        const moeda = tx.currency || 'SOL';
        const valor = Number(tx.amount) || 0;
        activities.push({
          id: tx.id,
          hash: tx.blockchain_tx_hash || tx.id,
          tipo: this.mapTransactionType(tx.type, isRecebimento),
          valor: valor.toFixed(moeda === 'SOL' ? 6 : 2),
          moeda,
          status: tx.status || 'completed',
          descricao: tx.description || (meta['description'] as string | undefined) || '',
          created_at: tx.created_at,
          isRecebimento,
          source: 'ledger',
        });
      }

      // 2. Swap orders — input/output em BIGINT (lamports), precisa dividir
      for (const swap of (swapData || [])) {
        const inputMeta = mintToMeta[swap.input_token] || { symbol: 'SOL', decimals: 9 };
        const outputMeta = mintToMeta[swap.output_token] || { symbol: '?', decimals: 6 };
        const inputAmt = Number(swap.input_amount) / Math.pow(10, inputMeta.decimals);
        const outputAmt = Number(swap.output_amount || swap.expected_output || 0) / Math.pow(10, outputMeta.decimals);
        activities.push({
          id: swap.id,
          hash: swap.on_chain_tx_hash || swap.id,
          tipo: 'Swap',
          valor: inputAmt.toFixed(inputMeta.decimals === 9 ? 6 : 2),
          moeda: inputMeta.symbol,
          valor_destino: outputAmt.toFixed(outputMeta.decimals === 9 ? 6 : 2),
          moeda_destino: outputMeta.symbol,
          status: swap.status === 'confirmed' ? 'completed' : swap.status,
          created_at: swap.confirmed_at || swap.created_at,
          isRecebimento: false,
          source: 'swap_orders',
        });
      }

      // 3. Deposit orders — campos reais conforme supabase_schema_v3_completo.sql
      for (const dep of depositData) {
        const hasSol  = dep.amount_sol  != null && dep.amount_sol  > 0;
        const hasUsdt = dep.amount_usdt != null && dep.amount_usdt > 0;
        const moeda = hasSol ? 'SOL' : hasUsdt ? 'USDT' : 'BRL';
        const valor = hasSol
          ? Number(dep.amount_sol)
          : hasUsdt
          ? Number(dep.amount_usdt)
          : Number(dep.amount_brl) || 0;
        const method = (dep.provider || dep.payment_method || 'PIX').toUpperCase();
        activities.push({
          id: dep.id,
          hash: dep.tx_signature || dep.id,
          tipo: 'Depósito',
          valor: valor.toFixed(moeda === 'SOL' ? 6 : 2),
          moeda,
          status: dep.status,
          descricao: `Via ${method}`,
          created_at: dep.paid_at || dep.created_at,
          isRecebimento: true,
          source: 'deposit_orders',
        });
      }

      // 4. Withdraw orders — campos conforme supabase_schema_v3_completo.sql
      for (const wd of withdrawData) {
        activities.push({
          id: wd.id,
          hash: wd.swap_tx_hash || wd.id,
          tipo: 'Saque',
          valor: Number(wd.amount_token).toFixed(6),
          moeda: wd.token_symbol || 'USDT',
          status: wd.status,
          descricao: wd.pix_key ? `PIX: ${wd.pix_key}` : '',
          created_at: wd.created_at,
          isRecebimento: false,
          source: 'withdraw_orders',
        });
      }

      // Deduplica por hash — swap_orders tem prioridade sobre ledger para o mesmo hash
      const hashMap = new Map<string, any>();
      for (const a of activities) {
        const key = a.hash || a.id;
        if (!hashMap.has(key) || a.source === 'swap_orders') {
          hashMap.set(key, a);
        }
      }

      return Array.from(hashMap.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);
    } catch (e) {
      console.error('[TransactionService] getRecentActivities error:', e);
      return [];
    }
  }

  private mapTransactionType(type: string, isRecebimento: boolean = false): string {
    const map: Record<string, string> = {
      'deposit': 'Depósito',
      'withdraw': 'Saque',
      'transfer': isRecebimento ? 'Recebimento' : 'Envio',
      'swap': 'Swap',
      'investment': 'Investimento',
    };
    return map[type] || type;
  }

  /**
   * Obtém o saldo de uma moeda no Ledger do banco de dados via RPC (Bug 13)
   */
  async getDatabaseBalance(userId: string, currency: string): Promise<number> {
    const { data, error } = await supabase.rpc('get_user_balance', {
      p_user_id: userId,
      p_moeda: currency,
    });
    if (error) {
      console.error('[TransactionService] getDatabaseBalance error:', error);
      return 0;
    }
    return data ?? 0;
  }

  /**
   * Obtém todos os saldos do usuário no Ledger do banco de dados via RPC (Bug 14)
   */
  async getDatabaseBalances(userId: string): Promise<Record<string, number>> {
    if (!isValidUUID(userId)) {
      console.warn('[TransactionService] getDatabaseBalances: Invalid UUID ignored:', userId);
      return {};
    }

    try {
      const { data, error } = await supabase.rpc('get_all_balances', {
        p_user_id: userId,
      });

      if (error) {
        // Se for erro de auth, não logar como erro crítico para não poluir
        if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
          console.log('[TransactionService] Sessão expirada ou não autorizada para RPC.');
        } else {
          console.error('[TransactionService] getDatabaseBalances error:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            userId
          });
        }
        return {};
      }

      const balances: Record<string, number> = {};

      if (data && Array.isArray(data)) {
        data.forEach((b) => {
          if (b.moeda) balances[b.moeda] = b.saldo || 0;
        });
      }
      return balances;
    } catch (err) {
      console.error('[TransactionService] Erro inesperado no RPC:', err);
      return {};
    }
  }

  async saveTransaction({
    senderId,
    senderWallet,
    destUserId,
    destAddress,
    amount,
    currency,
    description,
    txHash,
    senderName
  }: {
    senderId: string;
    senderWallet: string;
    destUserId?: string | null;
    destAddress: string;
    amount: number;
    currency: string;
    description?: string;
    txHash: string;
    senderName: string;
  }) {
    // 1. Preparar dados para o remetente (saída)
    // Converte para unidades mínimas (lamports ou satoshis-like se for 6 dec)
    const decimals = currency === 'SOL' ? 9 : 6;
    const amountBigInt = Math.floor(amount * Math.pow(10, decimals));

    // Idempotency key correlaciona retries do MESMO evento on-chain mesmo
    // antes do hash ser confirmado. Combinada com a UNIQUE constraint
    // (blockchain_tx_hash, user_id, type) em db/migrations/001_*, garante
    // que nenhum retry de rede instável duplica registros.
    const senderIdempotencyKey = `tx:send:${senderId}:${txHash}`;
    const receiverIdempotencyKey = destUserId
      ? `tx:recv:${destUserId}:${txHash}`
      : undefined;

    const txSenderData = {
      user_id: senderId,
      type: 'transfer',
      currency,
      amount: amountBigInt,
      description: description || `Enviado para ${destAddress.substring(0, 8)}...`,
      blockchain_tx_hash: txHash,
      status: 'completed',
      metadata: {
        destinatario_id: destUserId,
        endereco_destino: destAddress,
        endereco_origem: senderWallet,
        is_receiver: false,
        idempotency_key: senderIdempotencyKey,
      },
    };

    // 2. UPSERT em vez de insert+retry: se a UNIQUE constraint detectar
    // duplicata, atualizamos a linha existente (no-op semântico, mas evita
    // erro). Sem loop de retry — qualquer retry de rede é absorvido pelo
    // ON CONFLICT.
    const { error: sendError } = await (supabase
      .from('transactions') as any)
      .upsert(txSenderData, {
        onConflict: 'blockchain_tx_hash,user_id,type',
        ignoreDuplicates: false,
      });

    if (sendError) {
      console.error('[TransactionService] Erro crítico ao gravar transação no banco:', sendError.message);
      return { success: false, error: sendError.message ?? 'Erro de persistência' };
    }

    // 3. Registrar transação de ENTRADA para o destinatário (se for transferência interna Verum)
    if (destUserId) {
      const txReceiverData = {
        user_id: destUserId,
        type: 'transfer',
        currency,
        amount: amountBigInt,
        description: `Recebido de ${senderName}`,
        blockchain_tx_hash: txHash,
        status: 'completed',
        metadata: {
          remetente_id: senderId,
          endereco_origem: senderWallet,
          endereco_destino: destAddress,
          is_receiver: true,
          idempotency_key: receiverIdempotencyKey,
        },
      };

      const { error: recvError } = await (supabase
        .from('transactions') as any)
        .upsert(txReceiverData, {
          onConflict: 'blockchain_tx_hash,user_id,type',
          ignoreDuplicates: false,
        });
      if (recvError) {
        console.error('[TransactionService] Erro ao registrar entrada para destinatário:', recvError);
      }
    }

    return { success: true };
  }
}

export const transactionService = new TransactionService();
export default transactionService;
