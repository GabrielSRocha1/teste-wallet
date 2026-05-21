/**
 * blockchainSyncService.ts — Sincronização blockchain ↔ Supabase
 *
 * Responsabilidades:
 *  1. Salvar referência pública da wallet (apenas public_key + wallet_address) no Supabase
 *  2. Buscar saldo on-chain (SOL + USDC + USDT + BDC + ESCT) e retornar
 *  3. Buscar preços de mercado em tempo real via Jupiter API + fallback CoinGecko
 *  4. Sincronizar saldos on-chain de volta para a tabela `wallets` no Supabase
 *
 * Custódia (NÃO-CUSTODIAL):
 *  - A chave privada e a frase mnemônica VIVEM SOMENTE no vault local do
 *    dispositivo (keyManager + expo-secure-store / localStorage).
 *  - Este service NUNCA envia chave/mnemonic/hash de senha para o Supabase.
 *  - Persistir vault no servidor (mesmo cifrado por PIN curto) é vulnerável a
 *    brute force offline em caso de breach. Não voltar a fazê-lo.
 */

import { supabase } from './supabase';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { ParsedAccountData } from '@solana/web3.js';
import transactionService, { TOKEN_MINTS_MAINNET } from './transactionService';
import { SWAP_API_URL } from './apiUrl';


// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface WalletKeysSaveParams {
  userId: string;
  publicKey: string;
  /** @deprecated Não é mais enviado — vault só vive localmente. Aceito por compatibilidade. */
  privateKeyHex?: string;
  /** @deprecated Não é mais enviado — vault só vive localmente. Aceito por compatibilidade. */
  userPassword?: string;
  /** @deprecated Não é mais enviado — vault só vive localmente. Aceito por compatibilidade. */
  mnemonicPhrase?: string;
  walletAddress: string;      // endereço Base58
  blockchain?: string;
}

export interface OnChainBalances {
  SOL: number;
  USDT: number;
  USDC: number;
  BDC: number;
  ESCT: number;
  BRT: number;
  [key: string]: number;
}

export interface TokenPrice {
  symbol: string;
  price: number;     // USD
  change24h: number; // % variação 24h
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const JUPITER_PRICE_API = `${SWAP_API_URL}/api/prices`;


// Mints de referência (mainnet)
const MINT_SOL_NATIVE = 'So11111111111111111111111111111111111111112';

// ─── BlockchainSyncService ───────────────────────────────────────────────────

class BlockchainSyncService {
  private get connection(): Connection {
    return transactionService.getConnection();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. SALVAR WALLET NO SUPABASE (após criação ou importação)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Persiste APENAS a referência pública da wallet no Supabase.
   *
   * O que é salvo:
   *  - wallets.public_key      → chave pública (visível)
   *  - usuarios.wallet_address → endereço público
   *
   * O que NUNCA é salvo (custódia local-only):
   *  - chave privada (mesmo cifrada)
   *  - frase mnemônica
   *  - hash da senha de transação
   *
   * Parâmetros legados (privateKeyHex, userPassword, mnemonicPhrase) são
   * aceitos mas IGNORADOS — backward compatibility com callers existentes.
   */
  async saveWalletKeys(params: WalletKeysSaveParams): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const { userId, publicKey, walletAddress, blockchain = 'solana' } = params;

      // Upsert na tabela wallets — somente dados públicos
      const walletPayload: Record<string, any> = {
        user_id: userId,
        blockchain,
        is_active: true,
        public_key: publicKey,
        updated_at: new Date().toISOString(),
      };

      const { error: walletError } = await (supabase
        .from('wallets') as any)
        .upsert(walletPayload, { onConflict: 'public_key' });

      if (walletError) {
        console.warn('[BlockchainSync] wallets upsert error:', walletError.message, walletError.details);
      }

      // Atualiza o perfil do usuário com o endereço público
      const { error: userError } = await supabase
        .from('usuarios')
        .upsert({
          id: userId,
          wallet_address: walletAddress,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (userError) {
        console.warn('[BlockchainSync] usuarios upsert error:', userError.message);
      }

      console.log('[BlockchainSync] ✅ Wallet (pública) salva no Supabase:', walletAddress.substring(0, 8) + '...');
      return { success: true };
    } catch (err: any) {
      console.error('[BlockchainSync] saveWalletKeys error:', err.message);
      return { success: false, error: err.message };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. BUSCAR SALDO ON-CHAIN
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Busca saldo SOL + todos os tokens SPL da carteira em 3 chamadas RPC paralelas.
   * Retorna os saldos para exibição na tela de login (recuperação de carteira).
   */
  async fetchOnChainBalances(walletAddress: string): Promise<OnChainBalances> {
    const balances: OnChainBalances = {
      SOL: 0, USDT: 0, USDC: 0, BDC: 0, ESCT: 0, BRT: 0,
    };

    try {
      const pubkey = new PublicKey(walletAddress);
      const currentNetwork = transactionService.currentNetwork;
      const mints = currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : transactionService.getTokenMints();
      
      console.log(`[BlockchainSync] Iniciando fetch on-chain (${currentNetwork}) para: ${walletAddress.substring(0, 8)}...`);

      // 3 chamadas em paralelo com retry: SOL + SPL + Token-2022
      const [solRes, splRes, spl2022Res] = await Promise.allSettled([
        transactionService.withRetry((c) => c.getBalance(pubkey, 'confirmed')),
        transactionService.withRetry((c) => c.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID })),
        transactionService.withRetry((c) => c.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID })),
      ]);


      // SOL nativo
      if (solRes.status === 'fulfilled') {
        balances.SOL = solRes.value / LAMPORTS_PER_SOL;
      } else {
        console.warn('[BlockchainSync] Falha ao buscar saldo SOL:', solRes.reason);
      }

      // Mapeia mint → símbolo
      const mintToSymbol: Record<string, string> = {};
      for (const [sym, meta] of Object.entries(mints)) {
        mintToSymbol[(meta as any).mint] = sym;
      }

      // Helper para processar contas
      const processAccounts = (accounts: any[]) => {
        for (const acct of accounts) {
          const info = (acct.account.data as ParsedAccountData).parsed?.info;
          const mintAddr: string = info?.mint ?? '';
          const uiAmount: number = info?.tokenAmount?.uiAmount ?? 0;
          const sym = mintToSymbol[mintAddr];
          if (sym) {
            balances[sym] = uiAmount;
          }
        }
      };

      if (splRes.status === 'fulfilled') {
        processAccounts(splRes.value.value);
      } else {
        console.warn('[BlockchainSync] Falha ao buscar tokens (Token Program):', splRes.reason);
      }

      if (spl2022Res.status === 'fulfilled') {
        processAccounts(spl2022Res.value.value);
      } else {
        console.warn('[BlockchainSync] Falha ao buscar tokens (Token-2022 Program):', spl2022Res.reason);
      }

      console.log('[BlockchainSync] ✅ Fetch on-chain concluído:', JSON.stringify(balances));
    } catch (err: any) {
      console.error('[BlockchainSync] Erro crítico em fetchOnChainBalances:', err.message);
    }

    return balances;
  }

  /**
   * Sincroniza os saldos on-chain de volta para a tabela `usuarios` no Supabase.
   * Atualiza os campos saldo_sol, saldo_usdt, saldo_usdc, saldo_bdc, saldo_esct, saldo_brt.
   */
  async syncBalancesToSupabase(userId: string, walletAddress: string): Promise<void> {
    try {
      console.log(`[BlockchainSync] Iniciando sincronização para ${walletAddress.substring(0, 8)}...`);
      const balances = await this.fetchOnChainBalances(walletAddress);

      // Defensivo: se fetchOnChainBalances retornou SOL=0, fazemos uma checagem
      // direta. Se o RPC direto também der > 0, CORRIGIMOS o valor antes do
      // upsert (em vez de abortar — abortar deixava a tabela congelada na
      // última leitura boa, podendo ser horas/dias atrás).
      if (balances.SOL === 0) {
        try {
          const lamps = await this.connection.getBalance(new PublicKey(walletAddress));
          const realSol = lamps / LAMPORTS_PER_SOL;
          if (realSol > 0) {
            console.warn(`[BlockchainSync] Corrigindo SOL: fetch retornou 0, RPC direto ${realSol}. Aplicando valor real.`);
            balances.SOL = realSol;
          }
        } catch (rpcErr) {
          console.warn('[BlockchainSync] Falha no double-check de SOL, prosseguindo com valor do fetch:', rpcErr);
        }
      }

      const payload = {
        saldo_sol:  balances.SOL || 0,
        saldo_usdt: balances.USDT || 0,
        saldo_usdc: balances.USDC || 0,
        saldo_bdc:  balances.BDC || 0,
        saldo_esct: balances.ESCT || 0,
        saldo_brt:  balances.BRT || 0,
        updated_at: new Date().toISOString(),
      };

      console.log('[BlockchainSync] Payload de sincronização:', payload);

      const { error } = await (supabase
        .from('wallets') as any)
        .update(payload)
        .eq('public_key', walletAddress);

      if (error) {
        console.warn('[BlockchainSync] syncBalancesToSupabase error:', error.message);
      } else {
        console.log('[BlockchainSync] ✅ Saldos sincronizados na tabela wallets para:', walletAddress.substring(0, 8));
      }
    } catch (err) {
      console.warn('[BlockchainSync] syncBalancesToSupabase catch error:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. BUSCAR PREÇOS DE MERCADO EM TEMPO REAL
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Busca preços de mercado via Jupiter Price API (v6).
   * Retorna preços em USD para: SOL, USDT, USDC, BDC, ESCT, BRT
   *
   * Fallback: CoinGecko para SOL, USDT, USDC (moedas comuns)
   */
  async fetchMarketPrices(): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    try {
      // Monta a lista de IDs para consulta — mint addresses + SOL nativo
      const mints = TOKEN_MINTS_MAINNET;
      const mintList = [
        MINT_SOL_NATIVE,
        mints.USDT.mint,
        mints.USDC.mint,
        mints.BDC.mint,
        mints.ESCT.mint,
        mints.BRT.mint,
      ].join(',');

      const url = `${JUPITER_PRICE_API}?ids=${mintList}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'ngrok-skip-browser-warning': '1' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) throw new Error(`Jupiter API retornou ${res.status}`);

      const data = await res.json();
      const priceData = data?.prices ?? {};

      // Mapeia mint → símbolo e extrai preço
      const mintToSymbol: Record<string, string> = {
        [MINT_SOL_NATIVE]: 'SOL',
        [mints.USDT.mint]: 'USDT',
        [mints.USDC.mint]: 'USDC',
        [mints.BDC.mint]:  'BDC',
        [mints.ESCT.mint]: 'ESCT',
        [mints.BRT.mint]:  'BRT',
      };

      for (const [mint, sym] of Object.entries(mintToSymbol)) {
        const val = priceData[mint];
        if (val !== undefined) {
          // O proxy retorna o número direto, mas suportamos o formato antigo por segurança
          prices[sym] = typeof val === 'number' ? val : parseFloat(val.price || '0');
        }
      }


      // Garantia: USDT e USDC sempre valem ~$1 se Jupiter não retornar
      if (!prices.USDT || prices.USDT < 0.9 || prices.USDT > 1.1) prices.USDT = 1.0;
      if (!prices.USDC || prices.USDC < 0.9 || prices.USDC > 1.1) prices.USDC = 1.0;

      console.log('[BlockchainSync] ✅ Preços carregados via Jupiter:', Object.keys(prices).join(', '));
    } catch (jupiterErr) {
      console.warn('[BlockchainSync] Jupiter API falhou, tentando CoinGecko fallback:', jupiterErr);

      // Fallback CoinGecko para moedas comuns
      try {
        const cgRes = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana,tether,usd-coin&vs_currencies=usd&include_24hr_change=true',
          { signal: AbortSignal.timeout(8_000) }
        );
        if (cgRes.ok) {
          const cgData = await cgRes.json();
          if (cgData.solana?.usd)    prices.SOL  = cgData.solana.usd;
          if (cgData.tether?.usd)    prices.USDT = cgData.tether.usd;
          if (cgData['usd-coin']?.usd) prices.USDC = cgData['usd-coin'].usd;
        }
      } catch (cgErr) {
        console.warn('[BlockchainSync] CoinGecko fallback também falhou:', cgErr);
      }

      // Defaults seguros para stablecoins
      if (!prices.USDT) prices.USDT = 1.0;
      if (!prices.USDC) prices.USDC = 1.0;
    }

    return prices;
  }

  /**
   * Busca carteiras de um usuário do Supabase (usado na tela de login para
   * exibir saldos de carteiras já cadastradas).
   */
  async getUserWallets(userId: string): Promise<Array<{
    address: string;
    blockchain: string;
    publicKey: string | null;
    balances: OnChainBalances;
  }>> {
    try {
      const { data, error } = await (supabase
        .from('wallets') as any)
        .select('address, blockchain, public_key')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error || !data) return [];

      // Busca saldos on-chain em paralelo para todas as wallets
      const results = await Promise.allSettled(
        (data as any[]).map(async (wallet: any) => {
          const balances = await this.fetchOnChainBalances(wallet.address);
          return {
            address: wallet.address,
            blockchain: wallet.blockchain ?? 'solana',
            publicKey: wallet.public_key ?? null,
            balances,
          };
        })
      );

      return results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value);
    } catch (err) {
      console.warn('[BlockchainSync] getUserWallets error:', err);
      return [];
    }
  }

  /**
   * Retorna um resumo de saldo formatado para exibição na tela de login/recuperação.
   * Inclui o valor em USD de cada token.
   */
  async getRecoveryBalanceSummary(
    walletAddress: string
  ): Promise<Array<{ symbol: string; balance: number; usdValue: number; icon: string }>> {
    const [balances, prices] = await Promise.allSettled([
      this.fetchOnChainBalances(walletAddress),
      this.fetchMarketPrices(),
    ]);

    const bal = balances.status === 'fulfilled' ? balances.value : {} as OnChainBalances;
    const prc = prices.status === 'fulfilled' ? prices.value : {} as Record<string, number>;

    const TOKEN_ICONS: Record<string, string> = {
      SOL:  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      USDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
      USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
      BDC:  '',  // sem ícone no token list público
      ESCT: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q',
      BRT:  'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q',
    };

    const summary: Array<{ symbol: string; balance: number; usdValue: number; icon: string }> = [];

    for (const [sym, balance] of Object.entries(bal)) {
      if (typeof balance !== 'number') continue;
      // Inclui sempre SOL; outros só se saldo > 0
      if (sym !== 'SOL' && balance <= 0) continue;

      summary.push({
        symbol: sym,
        balance,
        usdValue: balance * (prc[sym] ?? 0),
        icon: TOKEN_ICONS[sym] ?? '',
      });
    }

    // Ordena: SOL primeiro, depois por valor USD descendente
    summary.sort((a, b) => {
      if (a.symbol === 'SOL') return -1;
      if (b.symbol === 'SOL') return 1;
      return b.usdValue - a.usdValue;
    });

    return summary;
  }
}

// Singleton
export const blockchainSyncService = new BlockchainSyncService();
export default blockchainSyncService;
