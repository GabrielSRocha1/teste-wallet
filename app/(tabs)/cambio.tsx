import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import keyManager from '@/src/services/keyManager';
import { supabase } from '@/src/services/supabase';
import { transactionService, VERUM_TREASURY_ADDRESS, isValidUUID } from '@/src/services/transactionService';
import { Feather } from '@expo/vector-icons';
import { Buffer } from 'buffer';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import type { RaydiumSwapQuote } from '@/src/services/transactionService';

import { useSolanaWallet } from '@/src/hooks/useSolanaWallet';
import { useRealtimeBalances } from '@/src/hooks/useRealtimeBalances';
import { SWAP_API_URL } from '@/src/services/apiUrl';
import { translateError } from '@/src/utils/error-translator';

if (typeof global.Buffer === 'undefined') { global.Buffer = Buffer; }

type Token = { symbol: string; name: string; color: string; imageUrl: any; mint?: string; decimals?: number; };

const TOKENS: Token[] = [
  { symbol: 'USDT', name: 'Tether', color: '#26a17b', imageUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  { symbol: 'USDC', name: 'USD Coin', color: '#2775ca', imageUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { symbol: 'SOL', name: 'Solana', color: '#9945ff', imageUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  { symbol: 'BDC', name: 'BodeCoin', color: '#f43f5e', imageUrl: require('../../public/BDC.png'), mint: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9', decimals: 9 },
  { symbol: 'ESCT', name: 'Escoteiros', color: '#8b5cf6', imageUrl: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q', mint: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt', decimals: 9 },
  { symbol: 'BRT', name: 'Brutos', color: '#f59e0b', imageUrl: 'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q', mint: '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE', decimals: 9 }
];

export default function CambioScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const params = useLocalSearchParams();
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fromToken, setFromToken] = useState<Token>(TOKENS[0]);
  const [toToken, setToToken] = useState<Token>(TOKENS[3]);
  const [isTokenModalVisible, setIsTokenModalVisible] = useState(false);
  const [modalSide, setModalSide] = useState<'from' | 'to'>('from');
  const [tokenSearch, setTokenSearch] = useState('');
  const [customTokens, setCustomTokens] = useState<Token[]>([]);
  const [isSearchingTokens, setIsSearchingTokens] = useState(false);

  // Estados para o novo Modal de Processamento de Swap
  const [isSwapLoadingModalVisible, setIsSwapLoadingModalVisible] = useState(false);
  const [swapModalStatus, setSwapModalStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [swapModalMessage, setSwapModalMessage] = useState('');
  const { prices: ctxPrices, network } = useSettings();
  const prices: Record<string, number> = React.useMemo(
    () => Object.fromEntries(Object.entries(ctxPrices).map(([k, v]) => [k, (v as any)?.USD ?? 0])),
    [ctxPrices],
  );
  const swapRotation = useRef(new Animated.Value(0)).current;

  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string>('');
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Hook central de keypair + saldo SOL em tempo real
  const solWallet = useSolanaWallet();
  // Saldos em tempo real via WebSocket Solana (SOL + SPL)
  const rtBalances = useRealtimeBalances(solWallet.publicKey, network);
  const onChainBalances = rtBalances.balances;

  // ── Estado unificado de cotação ──────────────────────────────────────────────
  // Jupiter direto (sem backend) → Raydium fallback
  type SwapQuote = {
    provider: 'jupiter' | 'raydium';
    priceImpactPct: number;
    slippageBps: number;
    jupiterRaw?: any;               // resposta completa Jupiter para montar a tx
    raydiumRaw?: RaydiumSwapQuote;  // resposta completa Raydium para montar a tx
  };
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteAt, setQuoteAt] = useState<number>(0);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapRoute, setSwapRoute] = useState<string>('');
  const quoteTimer = useRef<any>(null);

  // O backend de swap (verum-swap) agora centraliza as chamadas ao Jupiter
  const JUPITER_API = SWAP_API_URL;

  const loadUserAndBalances = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.id || !isValidUUID(user.id)) {
        console.log('[Swap] loadUserAndBalances: Aguardando autenticação ou UUID inválido...');
        return;
      }

      // Tentamos buscar o perfil
      const { data: profile, error: profileError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.warn('[Supabase] Erro ao buscar perfil:', profileError.message);
      }

      // Usamos o serviço centralizado para buscar saldos (já valida UUID)
      const balances = await transactionService.getDatabaseBalances(user.id);

      const enriched: any = { 
        id: user.id, 
        email: user.email,
        ...(profile || {}) 
      };

      // Mapeia saldos para o estado do perfil
      Object.entries(balances).forEach(([moeda, saldo]) => {
        enriched[`saldo_${moeda.toLowerCase()}`] = saldo;
      });

      setUserProfile(enriched);
    } catch (err) {
      console.error('[Swap] Erro crítico no loadUserAndBalances:', err);
    }
  }, []);

  useEffect(() => { loadUserAndBalances(); }, [loadUserAndBalances]);
  
  // Refresh data when screen focus
  const refreshBalances = rtBalances.refresh;
  useFocusEffect(useCallback(() => {
    loadUserAndBalances();
    refreshBalances();
  }, [loadUserAndBalances, refreshBalances]));
  
  // Handle URL params
  useEffect(() => {
    if (params.from) {
      const found = TOKENS.find(t => t.symbol === params.from);
      if (found) setFromToken(found);
    }
    if (params.to) {
      const found = TOKENS.find(t => t.symbol === params.to);
      if (found) setToToken(found);
    }
  }, [params.from, params.to]);

  useEffect(() => {
    if (tokenSearch.length < 2) {
      setCustomTokens([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setIsSearchingTokens(true);
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${tokenSearch}`);
        const data = await res.json();
        if (data.pairs) {
          const solPairs = data.pairs.filter((p: any) => p.chainId === 'solana');
          const found: Record<string, Token> = {};
          solPairs.forEach((p: any) => {
             const tk = p.baseToken;
             if (!found[tk.address] && !TOKENS.some(t => t.mint === tk.address)) {
               found[tk.address] = {
                 symbol: tk.symbol,
                 name: tk.name,
                 color: '#8b5cf6',
                 imageUrl: p.info?.imageUrl || 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png',
                 mint: tk.address
               };
             }
          });
          setCustomTokens(Object.values(found).slice(0, 5));
        }
      } catch (e) {} finally {
        setIsSearchingTokens(false);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [tokenSearch]);

  // Estimador de preço Verum (para exibição quando não há mint on-chain ou cotação Jupiter/Raydium disponível)
  useEffect(() => {
    // Se já temos uma cotação real ativa, não sobrescrevemos com a estimativa local
    if (quote) {
      console.log('[Cambio] Estimador ignorado: já existe uma cotação real ativa do provedor', quote.provider);
      return;
    }

    const amt = parseFloat(fromAmount);
    if (!amt || !prices[fromToken.symbol]) { 
      console.log('[Cambio] Estimador: Limpando valor de destino (sem entrada ou sem preço base)');
      setToAmount(''); 
      return; 
    }
    
    console.log(`[Cambio] Estimador: Calculando para ${amt} ${fromToken.symbol}...`);
    const valRaw = (amt * prices[fromToken.symbol]) / (prices[toToken.symbol] || 1);
    const usdInput = amt * prices[fromToken.symbol];

    // Cálculo Dinâmico Verum: MAX($0.50, 2%)
    const feeUSD = Math.max(0.50, usdInput * 0.02);
    const feeInDestToken = feeUSD / (prices[toToken.symbol] || 1);
    const val = valRaw - feeInDestToken;
    
    const outDecimals = toToken.decimals ?? (toToken.symbol === 'SOL' ? 9 : 6);
    const estimated = val > 0 ? val.toFixed(outDecimals > 6 ? 6 : 2) : '0.00';
    console.log(`[Cambio] Estimador: Resultado = ${estimated} ${toToken.symbol}`);
    setToAmount(estimated);
  }, [fromAmount, fromToken, toToken, prices, quote]);

  // --- Busca cotação Raydium ---
  // Cotação unificada: Jupiter direto → Raydium fallback
  const fetchQuote = useCallback(async () => {
    const inputMint = fromToken.mint;
    const outputMint = toToken.mint;
    const amt = parseFloat(fromAmount);
    if (!inputMint || !outputMint || !amt || amt <= 0 || !solWallet.publicKey) return;

    const amountRaw = Math.round(amt * Math.pow(10, fromToken.decimals ?? 9));
    const outDecimals = toToken.decimals ?? 9;

    setIsFetchingQuote(true);
    setQuoteError(null);

    let jupiterErr: string | null = null;

    // 1. Jupiter via Backend Verum (Port 3001) — POST /api/swap/quote
    try {
      console.log(`[Cambio] Buscando cotação Jupiter Backend: ${inputMint} -> ${outputMint} (amt: ${amountRaw})`);
      const res = await fetch(`${JUPITER_API}/api/swap/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({
          inputMint,
          outputMint,
          amount: String(amountRaw),
          slippageBps: 50,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const payload = await res.json();
        const jq = payload?.quote;
        if (jq?.outAmount && !payload?.error) {
          const finalToAmount = (Number(BigInt(jq.outAmount)) / Math.pow(10, outDecimals)).toFixed(outDecimals > 6 ? 6 : 2);
          console.log(`[Cambio] Cotação Jupiter SUCESSO: ${finalToAmount} ${toToken.symbol}`);
          setQuote({ provider: 'jupiter', priceImpactPct: parseFloat(jq.priceImpactPct ?? '0'), slippageBps: 50, jupiterRaw: jq });
          setQuoteAt(Date.now());
          setToAmount(finalToAmount);
          setIsFetchingQuote(false);
          return;
        } else {
          console.warn('[Cambio] Resposta Jupiter inválida ou com erro:', payload);
        }
      } else {
        console.warn(`[Cambio] Erro HTTP ${res.status} no Jupiter Backend`);
      }
    } catch (e: any) {
      jupiterErr = e?.message || String(e);
      console.warn('[Swap] Jupiter direto falhou, tentando Raydium...', jupiterErr);
    }

    // 2. Raydium fallback
    try {
      console.log(`[Cambio] Tentando Fallback Raydium: ${inputMint} -> ${outputMint}`);
      const rq = await transactionService.raydiumGetQuote({ inputMint, outputMint, amountRaw, walletPublicKey: solWallet.publicKey, slippageBps: 50 });
      const finalToAmount = (parseFloat(rq.data.outputAmount) / Math.pow(10, outDecimals)).toFixed(outDecimals > 6 ? 6 : 2);
      console.log(`[Cambio] Cotação Raydium SUCESSO: ${finalToAmount} ${toToken.symbol}`);
      setQuote({ provider: 'raydium', priceImpactPct: rq.data.priceImpactPct ?? 0, slippageBps: rq.data.slippageBps ?? 50, raydiumRaw: rq });
      setQuoteAt(Date.now());
      setToAmount(finalToAmount);
    } catch (e: any) {
      const raydiumErr = e?.message || String(e);
      console.warn('[Cambio] Todos os provedores de cotação falharam:', raydiumErr);
      const combined = jupiterErr
        ? `Jupiter: ${jupiterErr} | Raydium: ${raydiumErr}`
        : raydiumErr;
      setQuoteError(combined || 'Sem cotação disponível');
      setQuote(null);
    } finally {
      setIsFetchingQuote(false);
    }
  }, [fromAmount, fromToken, toToken, solWallet.publicKey]);

  // Dispara cotação com debounce de 600ms ao mudar par/valor
  useEffect(() => {
    const hasMints = !!fromToken.mint && !!toToken.mint;
    if (!hasMints || !fromAmount || parseFloat(fromAmount) <= 0) {
      setQuote(null); setQuoteError(null); return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    // Aumentado de 600ms para 1200ms para reduzir RPS e evitar 403/429
    quoteTimer.current = setTimeout(fetchQuote, 1200);
    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [fromAmount, fromToken, toToken, fetchQuote]);

  const handleSwapTokens = () => {
    setFromToken(toToken); setToToken(fromToken); setFromAmount(toAmount);
    setQuote(null); setQuoteError(null);
  };

  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT: operação excedeu ${ms / 1000}s`)), ms)
      ),
    ]);

  const executeSwap = async (keypair: import('@solana/web3.js').Keypair) => {
    setIsSubmitting(true); 
    setTxError(null); 
    setTxHash(''); 
    setLoadingStep(t('Preparando swap...'));
    
    // Ativa o novo Modal de Processamento
    setSwapModalStatus('processing');
    setSwapModalMessage(t('Aguarde enquanto seu swap está sendo processado na rede Solana...'));
    setIsSwapLoadingModalVisible(true);

    try {
      console.log('[Swap] Iniciando executeSwap...');
      
      const user = userProfile;
      console.log('[Swap] Usando perfil de usuário carregado:', user?.id || 'Anônimo');

      const amt = parseFloat(fromAmount);
      const hasBothMints = !!fromToken.mint && !!toToken.mint;
      const QUOTE_TTL = 30_000;

      // ── Validação de saldo SOL — evita falha on-chain por rent insuficiente ──
      // Buffer cobre: criação de ATA (~0.00203) + tx fee (~0.000005) + priority fee (~0.0002) + margem.
      // Necessário porque skipPreflight:true não bloqueia tx que falharia por insufficient SOL.
      if (hasBothMints) {
        const SOL_BUFFER = 0.005;
        const solOnChain = onChainBalances?.SOL ?? 0;
        const isSellingSol = fromToken.symbol === 'SOL';
        const requiredSol = isSellingSol ? amt + SOL_BUFFER : SOL_BUFFER;
        if (solOnChain < requiredSol) {
          Alert.alert(
            t('Saldo SOL insuficiente'),
            t(`Você precisa de pelo menos ${requiredSol.toFixed(4)} SOL para cobrir taxa de rede e possível criação de conta de token. Saldo atual: ${solOnChain.toFixed(4)} SOL.`),
          );
          setIsSubmitting(false);
          setLoadingStep('');
          setIsSwapLoadingModalVisible(false);
          return;
        }
      }

      if (hasBothMints && quote?.provider === 'jupiter' && quote.jupiterRaw) {
        if (Date.now() - quoteAt > QUOTE_TTL) {
          console.log('[Swap] Cotação expirou (Jupiter). Abortando...');
          Alert.alert(t('Cotação Expirada'), t('A cotação expirou. O valor será atualizado, por favor confirme e tente novamente.'));
          setIsSubmitting(false); setLoadingStep(''); fetchQuote(); 
          setIsSwapLoadingModalVisible(false); // Fecha o modal para o usuário ver a nova cotação
          return;
        }

        setLoadingStep(t('Obtendo transação Jupiter...'));
        const { VersionedTransaction } = require('@solana/web3.js');
        
        const swapRes = await withTimeout(fetch(`${SWAP_API_URL}/api/swap/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({
            quoteResponse: quote.jupiterRaw,
            userPublicKey: keypair.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
          }),
          signal: AbortSignal.timeout(20_000),
        }), 20000);

        if (!swapRes.ok) {
          throw new Error(`Jupiter swap falhou: ${swapRes.status}`);
        }

        const swapData = await swapRes.json();
        if (!swapData.serializedTx) {
            throw new Error('Erro ao obter transação de swap do backend.');
        }

        setLoadingStep(t('Assinando transação...'));
        const tx = VersionedTransaction.deserialize(Buffer.from(swapData.serializedTx, 'base64'));

        // Refresh blockhash antes de assinar — previne expiração entre Jupiter build → modal senha → broadcast
        const conn = transactionService.getConnectionForNetwork(network);
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        tx.message.recentBlockhash = blockhash;

        tx.sign([keypair]);

        setLoadingStep(t('Enviando para a rede Solana...'));

        const result = await withTimeout(
          transactionService.broadcastSigned(tx, { skipPreflight: true, isSwap: true, lastValidBlockHeight }),
          120000
        );
        
        setTxHash(result.hash); setSwapRoute('jupiter');
        setLoadingStep(t('Finalizando...'));
        const outRaw = BigInt(quote.jupiterRaw.outAmount ?? '0');
        const outDecimals = toToken.decimals ?? 9;
        const outUi = Number(outRaw) / Math.pow(10, outDecimals);

        if (user?.id) {
          try {
            await withTimeout((supabase as any).rpc('process_ledger_operation', {
              p_user_id: user.id, p_type: 'swap', p_amount: amt,
              p_currency: fromToken.symbol, p_swap_dest_currency: toToken.symbol,
              p_swap_dest_amount: outUi,
              p_metadata: { dest_mint: toToken.mint, input_mint: fromToken.mint, hash: result.hash, via: 'jupiter_direct', fee_pct: 2 },
              p_idempotency_key: `swap-${result.hash}`,
            }), 15_000);
          } catch (ledgerErr) {
            console.warn('[Swap] Erro ao registrar no ledger (não crítico):', ledgerErr);
          }
        }

        // SUCESSO!
        setSwapModalStatus('success');
        setSwapModalMessage(t('Swap concluído com sucesso!'));
        setTimeout(() => {
          setIsSwapLoadingModalVisible(false);
          setFromAmount(''); setQuote(null); setIsResultModalVisible(true);
        }, 2000); // 2 segundos de mensagem de sucesso antes de fechar
        return;
      }

      // ── CAMINHO RAYDIUM ───────────────────────────────────────────────────
      if (hasBothMints && quote?.provider === 'raydium' && quote.raydiumRaw) {
        if (Date.now() - quoteAt > QUOTE_TTL) {
          console.log('[Swap] Cotação expirou (Raydium). Abortando...');
          Alert.alert(t('Cotação Expirada'), t('A cotação expirou. O valor será atualizado, por favor confirme e tente novamente.'));
          setIsSubmitting(false); setLoadingStep(''); fetchQuote(); 
          setIsSwapLoadingModalVisible(false);
          return;
        }

        const outRaw = BigInt(quote.raydiumRaw.data?.outputAmount ?? '0');
        const outDecimals = toToken.decimals ?? 9;

        // Raydium agora embute a taxa Verum 2% na MESMA transação do swap (atomicidade)
        const rayResult = await withTimeout(
          transactionService.raydiumExecuteSwap({
            keypair,
            quote: quote.raydiumRaw,
            onProgress: setLoadingStep,
            fee: {
              outputMint: toToken.mint!,
              outputAmountRaw: outRaw,
              outputDecimals: outDecimals,
            },
          }),
          120000
        );

        if (rayResult.status !== 'Success') throw new Error(rayResult.error ?? t('Swap Raydium falhou'));

        setTxHash(rayResult.signature); setSwapRoute('raydium');

        setLoadingStep(t('Finalizando...'));
        const outUi = Number(outRaw) / Math.pow(10, outDecimals);
        const feeRaw = (outRaw * 2n) / 100n;
        const feeUi = Number(feeRaw) / Math.pow(10, outDecimals);

        await withTimeout((supabase as any).rpc('process_ledger_operation', {
          p_user_id: user!.id, p_type: 'swap', p_amount: amt,
          p_currency: fromToken.symbol, p_swap_dest_currency: toToken.symbol,
          p_swap_dest_amount: Math.max(0, outUi - feeUi),
          p_metadata: { dest_mint: toToken.mint, input_mint: fromToken.mint, hash: rayResult.signature, slot: rayResult.slot, via: 'raydium', fee_pct: 2 },
          p_idempotency_key: `swap-${rayResult.signature}`,
        }), 30_000);

        setSwapModalStatus('success');
        setSwapModalMessage(t('Swap concluído com sucesso!'));
        setTimeout(() => {
          setIsSwapLoadingModalVisible(false);
          setFromAmount(''); setQuote(null); setIsResultModalVisible(true);
        }, 2000);
        return;
      }

      // ── CAMINHO INTERNO ──────────────────────────────────────────────────
      if (!hasBothMints) {
        const treasury = VERUM_TREASURY_ADDRESS;
        let tx;
        if (fromToken.symbol === 'SOL') {
          tx = await transactionService.buildSOLTransfer({ from: keypair.publicKey.toBase58(), to: treasury, amount: amt, feeWallet: treasury, type: 'standard' });
        } else {
          const tokenMeta: any = {
            BDC:  { mint: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9', decimals: 9 },
            ESCT: { mint: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',  decimals: 9 },
            BRT:  { mint: '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',  decimals: 9, programId: 'TokenzQdBNbLqP5VEhdkXEh9nK195u4XpxsLVKz66A' },
            USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  decimals: 6 },
          };
          const meta = tokenMeta[fromToken.symbol];
          tx = await transactionService.buildSPLTransfer({ from: keypair.publicKey.toBase58(), to: treasury, mintAddress: meta.mint, amount: amt, decimals: meta.decimals, programId: meta.programId, feeWallet: treasury, type: 'standard' });
        }
        setLoadingStep(t('Assinando transação...'));
        tx.partialSign(keypair);
        setLoadingStep(t('Enviando para a rede Solana...'));
        const res = await transactionService.broadcastSigned(tx, { isSwap: true });
        if (res.status === 'failed' && !res.hash) throw new Error(t('FALHA'));
        setTxHash(res.hash); setSwapRoute('ledger');

        setLoadingStep(t('Finalizando...'));
        await withTimeout((supabase as any).rpc('process_ledger_operation', {
          p_user_id: user!.id, p_type: 'swap', p_amount: amt,
          p_currency: fromToken.symbol, p_swap_dest_currency: toToken.symbol,
          p_swap_dest_amount: parseFloat(toAmount),
          p_metadata: { dest_mint: toToken.mint, dest_decimals: toToken.decimals },
          p_idempotency_key: `swap-${res.hash}`,
        }), 30_000);

        setSwapModalStatus('success');
        setSwapModalMessage(t('Swap concluído com sucesso!'));
        setTimeout(() => {
          setIsSwapLoadingModalVisible(false);
          setFromAmount(''); setIsResultModalVisible(true);
        }, 2000);
        return;
      }

      throw new Error(t('Sem cotação disponível. Aguarde e tente novamente.'));

    } catch (e: any) {
      console.error('[Swap] Error:', e);
      const friendly = translateError(e) || t('Erro inesperado');
      setSwapModalStatus('error');
      setSwapModalMessage(friendly);

      if (e.message?.includes('TIMEOUT') || e.message?.includes('BLOCKHASH_EXPIRED')) {
        setTxError(friendly);
        setTimeout(() => { rtBalances.refresh(); loadUserAndBalances(); }, 5000);
      } else {
        setTxError(friendly);
      }

      // Fecha o modal após erro para o usuário ver o alerta
      setTimeout(() => setIsSwapLoadingModalVisible(false), 3000);
      setIsResultModalVisible(true);
    } finally {
      setIsSubmitting(false); setLoadingStep('');
    }
  };

  const handleConfirmPress = async () => {
    const typed = passwordInput.trim();
    if (!typed) {
      setPasswordError(t('Digite sua senha.'));
      return;
    }
    setPasswordError(null);

    // 1. Tenta sessão ativa em memória
    let keypair = keyManager.getSessionKeypair();
    if (keypair) {
      setIsPasswordModalVisible(false);
      setShowPassword(false);
      setPasswordInput('');
      await executeSwap(keypair);
      return;
    }

    // 2. Tenta PIN salvo (biometria/sessão anterior)
    try {
      const savedPin = await keyManager.getPinForBiometrics();
      if (savedPin) {
        keypair = await keyManager.loadDecrypted(savedPin);
        setIsPasswordModalVisible(false);
        setShowPassword(false);
        setPasswordInput('');
        await executeSwap(keypair);
        return;
      }
    } catch (_) {}

    // 3. Usa o que o usuário digitou
    try {
      console.log('[Cambio] Descriptografando chave com a senha digitada...');
      keypair = await keyManager.loadDecrypted(typed);
      console.log('[Cambio] Chave descriptografada com sucesso.');

      console.log('[Cambio] Obtendo mnemonic...');
      const mnemonic = await keyManager.getMnemonic(typed);
      
      console.log('[Cambio] Iniciando sessão segura...');
      await keyManager.startSession(mnemonic, keypair, typed);
      
      console.log('[Cambio] Senha correta. Fechando modal e iniciando executeSwap...');
      setIsPasswordModalVisible(false);
      setShowPassword(false);
      setPasswordInput('');
      setPasswordError(null);

      // Pequeno delay para garantir que a UI não trave antes do swap
      setTimeout(() => {
        executeSwap(keypair!);
      }, 500);
      
    } catch (err: any) {
      console.error('[Cambio] handleConfirmPress erro de senha:', err?.message);
      setPasswordError(t('Senha incorreta. Verifique e tente novamente.'));
    }
  };

  const getBal = (s: string) => {
    const isOnChainReady = Object.keys(onChainBalances).length > 0;
    if (s === 'SOL') {
      const solQty = solWallet.balance > 0 
        ? solWallet.balance 
        : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0));
      return Number(solQty).toFixed(4);
    }
    const qty = (isOnChainReady && s in onChainBalances) ? onChainBalances[s] : (userProfile?.[`saldo_${s.toLowerCase()}`] || 0);
    return Number(qty).toFixed(2);
  };

  const getBalNum = (s: string): number => {
    const isOnChainReady = Object.keys(onChainBalances).length > 0;
    if (s === 'SOL') {
      const solQty = solWallet.balance > 0
        ? solWallet.balance
        : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0));
      return Number(solQty);
    }
    const qty = (isOnChainReady && s in onChainBalances) ? onChainBalances[s] : (userProfile?.[`saldo_${s.toLowerCase()}`] || 0);
    return Number(qty);
  };

  // Verifica se o saldo é insuficiente em tempo real
  const insufficientBalance = React.useMemo(() => {
    const amt = parseFloat(fromAmount);
    if (!amt || amt <= 0) return false;
    const hasMints = !!fromToken.mint && !!toToken.mint;
    const verumFee = !hasMints ? amt * 0.02 : 0;
    const totalToken = amt + verumFee;
    const tokenBal = getBalNum(fromToken.symbol);
    if (totalToken > tokenBal) return true;
    // Verificar SOL para gas
    const gasSafetyMargin = 0.005;
    const solBal = getBalNum('SOL');
    const totalSolNeeded = fromToken.symbol === 'SOL' ? (totalToken + gasSafetyMargin) : gasSafetyMargin;
    if (solBal < totalSolNeeded) return true;
    return false;
  }, [fromAmount, fromToken, toToken, onChainBalances, userProfile, solWallet.balance]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
           <Text style={styles.title}>{t('CÂMBIO VERUM')}</Text>
           <View style={styles.goldLine} />
           <Text style={styles.subtitle}>{t('Troque seus ativos com liquidez instantânea e taxas competitivas.')}</Text>
        </View>

        <View style={styles.card}>
           <View style={styles.inputBox}>
              <View style={styles.inputHeader}>
                 <Text style={styles.inputLabel}>{t('VOCÊ ENVIA')}</Text>
                 <Text style={styles.inputBal}>{t('SALDO:')} {getBal(fromToken.symbol)}</Text>
              </View>
              <View style={styles.inputRow}>
                 <TouchableOpacity style={styles.tokenSel} onPress={() => { setModalSide('from'); setIsTokenModalVisible(true); }}>
                    <Image source={typeof fromToken.imageUrl === 'string' ? { uri: fromToken.imageUrl } : fromToken.imageUrl} style={styles.tokenImg} />
                    <Text style={styles.tokenSym}>{fromToken.symbol}</Text>
                    <Feather name="chevron-down" size={14} color={V.gold} />
                 </TouchableOpacity>
                  <View style={styles.amtContainer}>
                    <TextInput style={styles.amountI} placeholder="0.00" keyboardType="numeric" value={fromAmount} onChangeText={setFromAmount} placeholderTextColor={V.muted} underlineColorAndroid="transparent" />
                  </View>
              </View>
               {insufficientBalance && fromAmount ? (
                 <View style={styles.insufficientBanner}>
                   <Feather name="alert-circle" size={12} color={V.danger} />
                   <Text style={styles.insufficientText}>
                     {t('Verifique se o seu saldo cobre a transferência e as taxas da rede e da Verum')}
                   </Text>
                 </View>
               ) : null}
           </View>

           <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <TouchableOpacity style={styles.swapBtn} onPress={handleSwapTokens}>
                 <Animated.View style={{ transform: [{ rotate: swapRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
                    <Feather name="refresh-cw" size={20} color={V.bg} />
                 </Animated.View>
              </TouchableOpacity>
              <View style={styles.dividerLine} />
           </View>

           <View style={styles.inputBox}>
              <View style={styles.inputHeader}>
                 <Text style={styles.inputLabel}>{t('VOCÊ RECEBE')}</Text>
                 <Text style={styles.inputBal}>{t('SALDO:')} {getBal(toToken.symbol)}</Text>
              </View>
              <View style={styles.inputRow}>
                 <TouchableOpacity style={styles.tokenSel} onPress={() => { setModalSide('to'); setIsTokenModalVisible(true); }}>
                    <Image source={typeof toToken.imageUrl === 'string' ? { uri: toToken.imageUrl } : toToken.imageUrl} style={styles.tokenImg} />
                    <Text style={styles.tokenSym}>{toToken.symbol}</Text>
                    <Feather name="chevron-down" size={14} color={V.gold} />
                 </TouchableOpacity>
                 <Text 
                   style={[styles.targetAmt, !toAmount && { color: V.muted }]} 
                   numberOfLines={1} 
                   adjustsFontSizeToFit
                 >
                   {toAmount || '0.00'}
                 </Text>
              </View>
           </View>

           <View style={styles.priceRow}>
              <Text style={styles.priceT}>1 {fromToken.symbol} ≈ {((prices[fromToken.symbol] || 0) / (prices[toToken.symbol] || 1)).toFixed(6)} {toToken.symbol}</Text>
           </View>

           {/* Quote card — Jupiter (direto) ou Raydium (fallback) */}
           {fromToken.mint && toToken.mint && fromAmount ? (
             isFetchingQuote && !quote ? (
               <View style={styles.quotePill}>
                 <ActivityIndicator size="small" color={V.gold} />
                 <Text style={styles.quotePillT}>{t('Buscando melhor cotação...')}</Text>
               </View>
             ) : quote?.provider === 'jupiter' ? (
               <View style={styles.quoteCard}>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Via')}</Text>
                   <View style={[styles.raydiumBadge, {borderColor: 'rgba(20,241,149,0.4)', backgroundColor: 'rgba(20,241,149,0.08)'}]}>
                     <Text style={[styles.raydiumBadgeT, {color: '#14F195'}]}>◆ Jupiter</Text>
                   </View>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Você recebe')}</Text>
                   <Text style={styles.quoteValue}>{toAmount} {toToken.symbol}</Text>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Impacto no preço')}</Text>
                   <Text style={[styles.quoteValue, {color: quote.priceImpactPct > 1 ? V.danger : V.success}]}>
                     {quote.priceImpactPct.toFixed(4)}%
                   </Text>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Slippage')}</Text>
                   <Text style={styles.quoteValue}>{(quote.slippageBps / 100).toFixed(2)}%</Text>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={[styles.quoteLabel, {color: V.gold, fontSize: 10}]}>Taxa Verum: 2% (automática)</Text>
                 </View>
                 {isFetchingQuote && (
                   <View style={styles.quoteRow}>
                     <ActivityIndicator size="small" color={V.gold} style={{marginRight: 6}} />
                     <Text style={[styles.quoteLabel, {color: V.gold}]}>{t('Atualizando...')}</Text>
                   </View>
                 )}
               </View>
             ) : quote?.provider === 'raydium' ? (
               <View style={styles.quoteCard}>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Via')}</Text>
                   <View style={[styles.raydiumBadge, {borderColor: 'rgba(232,65,66,0.4)', backgroundColor: 'rgba(232,65,66,0.1)'}]}>
                     <Text style={[styles.raydiumBadgeT, {color: '#E84142'}]}>◈ Raydium (fallback)</Text>
                   </View>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Você recebe')}</Text>
                   <Text style={styles.quoteValue}>{toAmount} {toToken.symbol}</Text>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Impacto no preço')}</Text>
                   <Text style={[styles.quoteValue, {color: quote.priceImpactPct > 1 ? V.danger : V.success}]}>
                     {quote.priceImpactPct.toFixed(4)}%
                   </Text>
                 </View>
                 <View style={styles.quoteRow}>
                   <Text style={styles.quoteLabel}>{t('Slippage')}</Text>
                   <Text style={styles.quoteValue}>{(quote.slippageBps / 100).toFixed(2)}%</Text>
                 </View>
               </View>
             ) : quoteError ? (
               <View style={[styles.quotePill, {borderColor: V.danger, flexDirection: 'column', alignItems: 'flex-start', gap: 4}]}>
                 <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                   <Feather name="alert-triangle" size={12} color={V.danger} />
                   <Text style={[styles.quotePillT, {color: V.danger}]}>Sem cotação disponível</Text>
                 </View>
                 <Text style={[styles.quotePillT, {color: V.muted, fontSize: 10}]} numberOfLines={3}>
                   {quoteError}
                 </Text>
                 <Text style={[styles.quotePillT, {color: V.muted, fontSize: 9}]} numberOfLines={1}>
                   API: {JUPITER_API}
                 </Text>
               </View>
             ) : null
           ) : fromAmount ? (
             <View style={styles.costs}>
               <View style={styles.costItem}>
                 <Text style={[styles.costL, {color: V.gold}]}>{t('Total estimado a receber:')}</Text>
                 <Text style={[styles.costV, {color: V.gold}]}>{(parseFloat(toAmount)).toFixed(toToken.symbol === 'SOL' ? 6 : 4)} {toToken.symbol}</Text>
               </View>
             </View>
           ) : null}

           <TouchableOpacity
              style={[styles.mainBtn, (!toAmount || isSubmitting) && {opacity: 0.5}]}
              disabled={!toAmount || isSubmitting}
             onPress={() => {
               const amt = parseFloat(fromAmount);
               if (!amt || amt <= 0) return;

               const hasMints = !!fromToken.mint && !!toToken.mint;
               const totalNeeded = !hasMints ? amt * 1.02 : amt;
               const currentBal = getBalNum(fromToken.symbol);

               if (totalNeeded > currentBal) {
                 Alert.alert(t('Saldo Insuficiente'), `${t('Você possui')} ${currentBal.toFixed(6)} ${fromToken.symbol} ${t('e necessita de')} ${totalNeeded.toFixed(6)} (${t('incluindo taxa de 2%')}).`);
                 return;
               }

               const solBal = getBalNum('SOL');
               const gasSafetyMargin = 0.01;
               const totalSolNeeded = fromToken.symbol === 'SOL' ? (totalNeeded + gasSafetyMargin) : gasSafetyMargin;

               if (solBal < totalSolNeeded) {
                 Alert.alert(t('SOL p/ Gas Insuficiente'), t('Você precisa de ao menos 0.01 SOL para cobrir as taxas de rede em transações de câmbio.'));
                 return;
               }

               // Sessão ativa: executa direto sem pedir senha
               const sessionKp = keyManager.getSessionKeypair();
               if (sessionKp) {
                 executeSwap(sessionKp);
                 return;
               }
               setIsPasswordModalVisible(true);
             }}
           >
              {isSubmitting ? (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                  <ActivityIndicator color={V.bg} />
                  <Text style={[styles.mainBtnT, {textTransform: 'none', fontWeight: 'normal'}]}>
                    {loadingStep || t('Processando...')}
                  </Text>
                </View>
              ) : <Text style={styles.mainBtnT}>{t('CONFIRMAR TROCA')}</Text>}
           </TouchableOpacity>
        </View>

        <View style={styles.market}>
           <Text style={styles.marketTitle}>{t('MERCADO EM TEMPO REAL')}</Text>
           {TOKENS.filter(t => t.symbol !== 'USDT').map(tk => (
             <View key={tk.symbol} style={styles.marketItem}>
                <Image source={typeof tk.imageUrl === 'string' ? { uri: tk.imageUrl } : tk.imageUrl} style={styles.marketIcon} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                   <Text style={styles.marketSym}>{tk.symbol}/USDT</Text>
                   <Text style={styles.marketPrice}>${prices[tk.symbol]?.toFixed(prices[tk.symbol] > 1 ? 2 : 6) || '---'}</Text>
                </View>
                <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveT}>LIVE</Text></View>
             </View>
           ))}
        </View>
      </ScrollView>

      <BottomNav activeRoute="cambio" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} activeRoute="cambio" />

      <Modal visible={isTokenModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetT}>{t('SELECIONAR ATIVO')}</Text>
            <TextInput style={styles.search} placeholder={t('Filtrar por nome...')} value={tokenSearch} onChangeText={setTokenSearch} placeholderTextColor={V.muted} />
            <ScrollView style={{maxHeight: 300}}>
               {TOKENS.filter(t => t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) || (t.mint && t.mint.includes(tokenSearch))).map(t => (
                 <TouchableOpacity key={t.symbol} style={styles.sheetItem} onPress={() => { if(modalSide==='from') setFromToken(t); else setToToken(t); setIsTokenModalVisible(false); setQuote(null); setQuoteError(null); }}>
                    <Image source={typeof t.imageUrl === 'string' ? { uri: t.imageUrl } : t.imageUrl} style={styles.sheetIcon} />
                    <View style={{flex:1, marginLeft: 12}}>
                        <Text style={styles.sheetSym}>{t.symbol}</Text>
                        <Text style={styles.sheetName}>{t.name}</Text>
                    </View>
                 </TouchableOpacity>
               ))}
               
               {isSearchingTokens && <ActivityIndicator color={V.gold} style={{marginVertical: 12}} />}
               
               {!isSearchingTokens && customTokens.map(t => (
                 <TouchableOpacity key={t.mint} style={styles.sheetItem} onPress={async () => {
                   let decimals = 6; // default
                   try {
                     const { PublicKey } = require('@solana/web3.js');
                     const conn = transactionService.getConnection();
                     const info = await conn.getParsedAccountInfo(new PublicKey(t.mint));
                     if ((info.value?.data as any)?.parsed?.info?.decimals) {
                       decimals = (info.value?.data as any).parsed.info.decimals;
                     }
                   } catch(e) {}
                   
                   const selectedToken = { ...t, decimals };
                   if (modalSide==='from') setFromToken(selectedToken); else setToToken(selectedToken);
                   
                   try {
                     const AS = require('@react-native-async-storage/async-storage').default;
                     const existingStr = await AS.getItem('@custom_tokens');
                     const existing = existingStr ? JSON.parse(existingStr) : [];
                     if (!existing.some((x: any) => x.mint === t.mint)) {
                       existing.push(selectedToken);
                       await AS.setItem('@custom_tokens', JSON.stringify(existing));
                     }
                   } catch(e) {}
                   
                   // Preço do token customizado vem via SettingsContext (WebSocket)
                   setIsTokenModalVisible(false);
                 }}>
                    <Image source={typeof t.imageUrl === 'string' ? { uri: t.imageUrl } : t.imageUrl} style={styles.sheetIcon} />
                    <View style={{flex:1, marginLeft: 12}}>
                        <Text style={styles.sheetSym}>{t.symbol}</Text>
                        <Text style={styles.sheetName}>{t.name}</Text>
                    </View>
                    <Text style={{fontSize: 10, color: V.gold, fontFamily: F.bold, backgroundColor: 'rgba(201,168,76,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4}}>NEW</Text>
                 </TouchableOpacity>
               ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setIsTokenModalVisible(false)} style={styles.closeSheet}><Text style={styles.closeSheetT}>{t('FECHAR')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isPasswordModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.passBox}>
            <Text style={styles.passT}>{t('SEGURANÇA')}</Text>
            <Text style={styles.passD}>{t('Confirme sua senha para processar o câmbio:')}</Text>
            <View style={styles.passInputContainer}>
              <TextInput
                style={[styles.passI, passwordError ? { borderColor: V.danger } : undefined]}
                secureTextEntry={!showPassword}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                value={passwordInput}
                onChangeText={v => { setPasswordInput(v); setPasswordError(null); }}
                placeholderTextColor={V.muted}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeToggle}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={V.muted} />
              </TouchableOpacity>
            </View>
            {passwordError ? (
              <Text style={{ color: V.danger, fontSize: 12, marginTop: 6, fontFamily: F.body, textAlign: 'center' }}>{passwordError}</Text>
            ) : null}
            <View style={styles.passBtns}>
               <TouchableOpacity onPress={() => { setIsPasswordModalVisible(false); setShowPassword(false); setPasswordError(null); setPasswordInput(''); }} style={styles.pCancel}><Text style={styles.pCancelT}>{t('VOLTAR')}</Text></TouchableOpacity>
               <TouchableOpacity onPress={handleConfirmPress} style={styles.pConfirm}><Text style={styles.pConfirmT}>{t('CONFIRMAR')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isSwapLoadingModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.resBox}>
            {swapModalStatus === 'processing' && (
              <ActivityIndicator size="large" color={V.gold} style={{ marginBottom: 20 }} />
            )}
            {swapModalStatus === 'success' && (
              <View style={[styles.resIcon, { borderColor: V.success, marginBottom: 20 }]}><Feather name="check" size={40} color={V.success} /></View>
            )}
            {swapModalStatus === 'error' && (
              <View style={[styles.resIcon, { borderColor: V.danger, marginBottom: 20 }]}><Feather name="x" size={40} color={V.danger} /></View>
            )}
            
            <Text style={[styles.resT, { color: swapModalStatus === 'error' ? V.danger : V.gold, textAlign: 'center' }]}>
              {swapModalStatus === 'processing' ? t('PROCESSANDO') : swapModalStatus === 'success' ? t('SUCESSO') : t('ERRO')}
            </Text>
            
            <Text style={styles.resD}>
              {swapModalMessage}
            </Text>

            {swapModalStatus === 'processing' && (
              <Text style={{ fontSize: 10, color: V.muted, marginTop: 20, fontFamily: F.body }}>
                {t('Isso pode levar até 90 segundos dependendo da rede.')}
              </Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={isResultModalVisible} transparent animationType="slide">
        <View style={styles.mOverlay}>
          <View style={styles.resBox}>
            <View style={[styles.resIcon, { borderColor: txError ? V.danger : V.success }]}><Feather name={txError ? 'x' : 'check'} size={40} color={txError ? V.danger : V.success} /></View>
            <Text style={[styles.resT, { color: txError ? V.danger : V.success }]}>{txError ? t('ERRO') : t('SUCESSO')}</Text>
            <Text style={[styles.resD, { color: txError ? V.danger : V.success }]}>
              {txError || (swapRoute === 'raydium'
                ? t('A troca foi confirmada on-chain via Raydium.')
                : t('A troca de ativos foi confirmada com sucesso.'))}
            </Text>
            {!txError && txHash ? (
              <Text style={styles.txHashLabel} numberOfLines={1} ellipsizeMode="middle">{txHash}</Text>
            ) : null}
            <TouchableOpacity style={styles.resBtn} onPress={() => { setIsResultModalVisible(false); setTxHash(''); }}><Text style={styles.resBtnT}>{t('CONCLUÍDO')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 110 },
  titleBox: { marginTop: 24, marginBottom: 24 },
  title: { fontSize: 26, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginVertical: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted },
  card: { backgroundColor: V.surface1, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow },
  inputBox: { backgroundColor: V.surface2, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: V.border, overflow: 'hidden' },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  inputLabel: { fontSize: 9, fontFamily: F.bold, color: V.muted, letterSpacing: 1 },
  inputBal: { fontSize: 11, fontFamily: F.bold, color: '#FFFFFF' },
  inputRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  tokenSel: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: V.surface1, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: V.border, marginRight: 10, flexShrink: 0, minWidth: 110 },
  tokenImg: { width: 22, height: 22, borderRadius: 11 },
  tokenSym: { fontSize: 13, fontFamily: F.bold, color: V.text },
  amtContainer: { flex: 1, overflow: 'hidden', justifyContent: 'center', flexBasis: 0, width: 0, flexGrow: 1 },
  amountI: { flex: 1, height: '100%', backgroundColor: 'transparent', textAlign: 'right', fontSize: 24, fontFamily: F.bold, color: '#FFFFFF', padding: 0, outlineStyle: 'none' as any } as any,
  targetAmt: { flex: 1, textAlign: 'right', fontSize: 24, fontFamily: F.bold, color: '#FFFFFF', minHeight: 48, justifyContent: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: V.border },
  swapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: V.gold, alignItems: 'center', justifyContent: 'center', marginHorizontal: 12, ...V.shadow },
  priceRow: { alignItems: 'center', marginTop: 16 },
  priceT: { fontSize: 12, fontFamily: F.body, color: V.muted },
  insufficientBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: V.danger, backgroundColor: 'rgba(231,76,60,0.08)' },
  insufficientText: { flex: 1, fontSize: 11, fontFamily: F.semi, color: V.danger, lineHeight: 16 },
  costs: { marginTop: 16, padding: 16, backgroundColor: 'rgba(201,168,76,0.03)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(201,168,76,0.1)' },
  costItem: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  costL: { fontSize: 11, fontFamily: F.semi, color: V.muted },
  costV: { fontSize: 11, fontFamily: F.bold, color: V.text },
  mainBtn: { height: 56, backgroundColor: V.gold, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 24, ...V.shadow },
  mainBtnT: { fontSize: 14, fontFamily: F.bold, color: V.bg, letterSpacing: 1 },
  // Route selector styles
  routeSelector: { flexDirection: 'row', gap: 8, marginTop: 14 },
  routeBtn: { flex: 1, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: V.border, alignItems: 'center' },
  routeBtnActive: { borderColor: V.gold, backgroundColor: 'rgba(201,168,76,0.1)' },
  routeBtnT: { fontSize: 10, fontFamily: 'Rajdhani_600SemiBold' as any, color: V.muted, letterSpacing: 0.5 },
  routeBtnTActive: { color: V.gold },
  // Quote styles
  quotePill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: V.gold, backgroundColor: 'rgba(201,168,76,0.05)' },
  quotePillT: { fontSize: 11, fontFamily: F.body, color: V.gold },
  quoteCard: { marginTop: 16, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(201,168,76,0.25)', backgroundColor: 'rgba(201,168,76,0.04)' },
  quoteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  quoteLabel: { fontSize: 11, fontFamily: F.semi, color: V.muted },
  quoteValue: { fontSize: 12, fontFamily: F.bold, color: V.text },
  raydiumBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: 'rgba(51,153,255,0.15)', borderWidth: 1, borderColor: 'rgba(51,153,255,0.4)' },
  raydiumBadgeT: { fontSize: 11, fontFamily: F.bold, color: '#3399ff' },
  txHashLabel: { fontSize: 10, fontFamily: F.body, color: V.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
  market: { marginTop: 32 },
  marketTitle: { fontSize: 14, fontFamily: F.title, color: V.gold, marginBottom: 16, letterSpacing: 1.5 },
  marketItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: V.border, marginBottom: 10 },
  marketIcon: { width: 32, height: 32, borderRadius: 16 },
  marketSym: { fontSize: 14, fontFamily: F.bold, color: V.text },
  marketPrice: { fontSize: 11, fontFamily: F.body, color: V.muted },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(46, 204, 113, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: V.success },
  liveT: { fontSize: 10, fontFamily: F.bold, color: V.success },
  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', minWidth: 320, maxWidth: 650, backgroundColor: V.surface1, borderRadius: 12, padding: 24, borderWidth: 1, borderColor: V.border },
  sheetT: { fontSize: 16, fontFamily: F.title, color: V.gold, textAlign: 'center', marginBottom: 20 },
  search: { backgroundColor: 'transparent', height: 48, borderRadius: 8, padding: 12, color: V.text, fontFamily: F.body, marginBottom: 16, borderWidth: 1, borderColor: V.border, outlineStyle: 'none' as any },
  sheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: V.border },
  sheetIcon: { width: 30, height: 30, borderRadius: 15 },
  sheetSym: { fontSize: 14, fontFamily: F.bold, color: V.text },
  sheetName: { fontSize: 11, fontFamily: F.body, color: V.muted },
  closeSheet: { marginTop: 20, alignItems: 'center' },
  closeSheetT: { color: V.muted, fontFamily: F.bold, fontSize: 11 },
  passBox: { width: '100%', minWidth: 320, maxWidth: 650, backgroundColor: V.surface1, padding: 24, borderRadius: 12, borderWidth: 1, borderColor: V.gold },
  passT: { fontSize: 18, fontFamily: F.title, color: V.gold, textAlign: 'center' },
  passD: { fontSize: 12, fontFamily: F.body, color: V.muted, textAlign: 'center', marginVertical: 12 },
  passInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: 8, borderWidth: 1, borderColor: V.border, paddingRight: 12 },
  passI: { flex: 1, height: 50, backgroundColor: 'transparent', textAlign: 'center', fontSize: 20, color: V.text, paddingLeft: 32, outlineStyle: 'none' as any },
  eyeToggle: { padding: 8 },
  passBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  pCancel: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pCancelT: { color: V.muted, fontFamily: F.bold },
  pConfirm: { flex: 1, height: 44, backgroundColor: V.gold, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pConfirmT: { color: V.bg, fontFamily: F.bold },
  resBox: { width: '100%', minWidth: 320, maxWidth: 650, backgroundColor: V.surface1, padding: 32, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: V.border },
  resIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  resT: { fontSize: 20, fontFamily: F.title, color: V.text },
  resD: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', marginTop: 8 },
  resBtn: { marginTop: 32, height: 48, backgroundColor: V.gold, paddingHorizontal: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  resBtnT: { color: V.bg, fontFamily: F.bold },
});

