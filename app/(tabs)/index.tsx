import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useSettings } from '@/constants/SettingsContext';
import notificationService from '@/src/services/notificationService';
import { supabase } from '@/src/services/supabase';
import { transactionService } from '@/src/services/transactionService';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import QRScannerModal from '@/components/QRScannerModal';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, FlatList, Image, Keyboard, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F, PAD } from '@/constants/theme';
import keyManager from '@/src/services/keyManager';
import { useSolanaWallet } from '@/src/hooks/useSolanaWallet';
import { useRealtimeBalances } from '@/src/hooks/useRealtimeBalances';
import { blockchainSyncService } from '@/src/services/blockchainSyncService';

if (typeof global.Buffer === 'undefined') { global.Buffer = Buffer; }

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t, formatCurrency, prices: ctxPrices, walletName, network } = useSettings();
  // Hook central de keypair + saldo SOL em tempo real
  const solWallet = useSolanaWallet(network);
  // Extrai USD de cada token — atualiza automaticamente via WebSocket do SettingsContext
  const prices = React.useMemo(
    () => Object.fromEntries(Object.entries(ctxPrices).map(([k, v]) => [k, (v as any)?.USD ?? 0])),
    [ctxPrices],
  );
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [isScannerVisible, setIsScannerVisible] = useState(false);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [priceChanges] = useState<Record<string, number>>({});
  const [hasUnread, setHasUnread] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeWallet, setActiveWallet] = useState<any>(null);

  // Saldos em tempo real via WebSocket Solana (SOL + SPL)
  const rtBalances = useRealtimeBalances(solWallet.publicKey, network);
  const onChainBalances = rtBalances.balances;
  const dynamicTokens = rtBalances.dynamicTokens || [];
  const [lastTotalBalance, setLastTotalBalance] = useState<number | null>(null);

  const loadData = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsRefreshing(false);
        return;
      }

      let profile = null;
      try {
        const { data, error: profileError } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        
        if (profileError) {
          console.warn('[Supabase] Erro ao buscar perfil na Home:', profileError.message);
        } else {
          profile = data;
        }
      } catch (e) {
        console.warn('[Supabase] Falha de rede ao buscar perfil na Home:', e);
      }

      // Rule #1/#2/#3: NUNCA gerar keypair em mount/effect/reconnect.
      // Se o perfil não tiver wallet_address mas houver vault local, usamos
      // a pubkey AUTORITATIVA do vault (fonte da verdade — rule #7).
      // Se não houver nem vault local nem endereço no DB, apenas sincroniza
      // o que estiver disponível — a criação de carteira acontece SOMENTE
      // na tela de registro/recuperação via ação explícita do usuário.
      if (!profile || !profile.wallet_address) {
        const persisted = await keyManager.getPersistedIdentity();
        const activeAddr = persisted?.publicKey ?? null;

        if (activeAddr) {
          if (profile) {
            const { data: updated } = await supabase
              .from('usuarios')
              .update({ wallet_address: activeAddr })
              .eq('id', user.id)
              .select()
              .single();
            profile = updated;
          } else {
            const { data: newProfile } = await supabase
              .from('usuarios')
              .insert({
                id: user.id,
                email: user.email?.endsWith('.internal') ? null : user.email,
                nome_completo: user.user_metadata?.full_name || t('Investidor'),
                wallet_address: activeAddr,
                senha_criptografada: 'supabase_managed',
              })
              .select()
              .single();
            profile = newProfile;
          }
        } else {
          // Sem identidade persistida e sem endereço no perfil: o usuário
          // precisa criar ou restaurar explicitamente. Não geramos nada aqui.
          console.warn(
            '[Home] Nenhuma identidade persistida e nenhum wallet_address no perfil. ' +
            'Aguardando ação explícita do usuário (criar nova wallet ou restaurar frase).',
          );
        }
      }

      if (profile) {
        setUserProfile(profile);

        // Busca dados da carteira ATIVA (local) na tabela 'wallets' para cache de saldo
        const activeAddr = (await keyManager.getPersistedIdentity())?.publicKey || solWallet.publicKey;
        if (activeAddr) {
          const { data: walletData } = await supabase
            .from('wallets')
            .select('*')
            .eq('public_key', activeAddr)
            .maybeSingle();
          if (walletData) {
            console.log('[Home] Dados da carteira ativa carregados da tabela wallets:', activeAddr.substring(0, 8));
            setActiveWallet(walletData);
          }
        }

        // Sincroniza cache de endereço local com DB se não houver vault local.
        const persisted = await keyManager.getPersistedIdentity();
        if (!persisted && profile.wallet_address) {
          await keyManager.setStoredAddress(profile.wallet_address);
        }

        // Sincroniza saldos da blockchain para o Supabase (fallback da UI)
        if (profile.wallet_address) {
          blockchainSyncService.syncBalancesToSupabase(user.id, profile.wallet_address).catch(() => {});
        }
      }

      // Força atualização dos saldos em tempo real
      rtBalances.refresh().catch(() => {});

      const activities = await transactionService.getRecentActivities(user.id);

      if (activities) {
        let mergedTxs = [...activities];

        // Tenta buscar transações on-chain se existir o endereço da carteira
        const addr = profile?.wallet_address || userProfile?.wallet_address;
        let finalAddr = solWallet.publicKey || addr;
        if (!finalAddr) {
          try {
            const sessionKey = keyManager.getSessionKeypair();
            if (sessionKey) finalAddr = sessionKey.publicKey.toBase58();
          } catch (e) {}
        }

        if (finalAddr) {
          try {
            const onChainTxs = await transactionService.getRecentOnChainTransactions(finalAddr, 5);
            mergedTxs = [...mergedTxs, ...onChainTxs];
            // Remove duplicatas por hash
            const txMap = new Map();
            mergedTxs.forEach((t: any) => txMap.set(t.hash || t.id, t));
            mergedTxs = Array.from(txMap.values());
            
            const getDate = (t: any) => t.created_at || t.blockTime || 0;
            mergedTxs.sort((a: any, b: any) => {
              const dateA = new Date(getDate(a)).getTime();
              const dateB = new Date(getDate(b)).getTime();
              return (isNaN(dateB) ? 0 : dateB) - (isNaN(dateA) ? 0 : dateA);
            });
          } catch (e) {
            console.warn('[Home] Erro de merge de transações on-chain', e);
          }
        }
        
        setTransactions(mergedTxs);
        
        // --- Sincronizador de Notificações de Recebimento ---
        // Cobre ambos os casos:
        //   1) Transferência interna Verum→Verum: o sender já chamou pushToEmail,
        //      que insere uma notificação com `data->>hash`. Aqui detectamos isso
        //      via hasNotificationForHash e pulamos pra não duplicar.
        //   2) Recebimento externo (Phantom/Solflare → Verum): nunca foi notificado,
        //      então criamos a notificação aqui. Esse caso era o que estava quebrado:
        //      o guard `!tx.onChain` antigo bloqueava tudo que vinha da blockchain.
        const processedKey = `processed_txs_${user.id}`;
        const storedProcessed = await AsyncStorage.getItem(processedKey);
        const isFirstRun = !storedProcessed;
        const processedSet = new Set(storedProcessed ? JSON.parse(storedProcessed) : []);
        let newProcessed = false;

        const incomingTxs = mergedTxs.filter((tx: any) =>
          (tx.isRecebimento || tx.destinatario_id === user.id || tx.destinatario_id === 'me' || tx.tipo === 'Recebimento') &&
          tx.tipo?.toLowerCase() !== 'swap' && tx.tipo?.toLowerCase() !== 'interação'
        );

        for (const tx of incomingTxs) {
          const dedupeKey = tx.hash || tx.id;
          if (processedSet.has(dedupeKey)) continue;
          processedSet.add(dedupeKey);
          newProcessed = true;

          if (isFirstRun) continue; // primeira carga: marca como processado mas não notifica histórico

          // Se já existe notificação com esse hash (ex.: pushToEmail do sender interno), pula
          if (tx.hash) {
            const exists = await notificationService.hasNotificationForHash(tx.hash, user.id);
            if (exists) continue;
          }

          const recvUsdVal = (tx.valor * (prices[tx.moeda] || 0)).toFixed(2);
          const recvUsdStr = prices[tx.moeda] && recvUsdVal !== "0.00" ? ` (~$ ${recvUsdVal})` : '';
          await notificationService.pushNotification({
            type: 'recebimento',
            title: t('Transferência recebida'),
            description: t(`Você recebeu ${tx.valor} ${tx.moeda}.`),
            amount: `+${tx.valor}`,
            currency: `${tx.moeda}${recvUsdStr}`,
            data: tx.hash ? { hash: tx.hash } : undefined,
          });
        }

        if (newProcessed || isFirstRun) {
          await AsyncStorage.setItem(processedKey, JSON.stringify(Array.from(processedSet)));
          if (newProcessed) checkUnread();
        }
      }
    } catch (err) { console.error('[Home] Error loading data:', err); } finally {
      setIsRefreshing(false);
    }
  };

  const checkUnread = async () => {
    const count = await notificationService.getUnreadCount();
    setHasUnread(count > 0);
  };

  useEffect(() => {
    loadData(); checkUnread();

    // Inscrição em tempo real para novas transações (view legada + ledger novo)
    const channelLegacy = supabase
      .channel('public:transacoes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transacoes' }, () => {
        loadData();
      })
      .subscribe();

    const channelLedger = supabase
      .channel('public:transactions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => {
        loadData();
        checkUnread();
      })
      .subscribe();

    // Apenas saldo e notificações em polling — 60s para não saturar o RPC
    // Preços chegam via WebSocket (realtimePriceService + SettingsContext)
    const interval = setInterval(() => { loadData(); checkUnread(); }, 60_000);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channelLegacy);
      supabase.removeChannel(channelLedger);
    };
  }, []);

  // Sincroniza com o Supabase sempre que o saldo on-chain mudar via WebSocket/Polling
  useEffect(() => {
    // REGRA: Usar sempre a chave pública ATIVA (da vault local) para sincronizar
    const activeAddress = solWallet.publicKey;
    if (rtBalances.lastUpdated && userProfile?.id && activeAddress) {
      const timeout = setTimeout(() => {
        console.log('[Home] Sincronizando saldo da carteira ativa:', activeAddress.substring(0, 8));
        blockchainSyncService.syncBalancesToSupabase(userProfile.id, activeAddress).catch(() => {});
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [rtBalances.lastUpdated, solWallet.publicKey, userProfile?.id]);

  useFocusEffect(useCallback(() => { loadData(); checkUnread(); }, []));

  const totalBalanceUsdt = (() => {
    // REGRA DE NEGÓCIO: Mostrar saldo antigo ATÉ que o novo esteja pronto
    // Se estivermos recarregando e o saldo on-chain estiver vazio, tentamos manter o último conhecido
    
    let total = 0;
    
    // Se o hook ainda está carregando o PRIMEIRO fetch, usamos os saldos do DB
    const isOnChainReady = Object.keys(onChainBalances).length > 0;
    
    if (!isOnChainReady) {
      console.log('[Home] On-chain não pronto, usando fallback do DB para:', solWallet.publicKey?.substring(0, 8));
    }

    // 1. SOL — prioriza saldo do hook (tempo real via WebSocket), fallback on-chain, fallback DB (wallets -> usuarios)
    const isProfileMatch = userProfile?.wallet_address === solWallet.publicKey;
    const isWalletMatch = activeWallet?.public_key === solWallet.publicKey;
    
    if (isWalletMatch) {
      console.log('[Home] Usando cache da tabela wallets para:', activeWallet.public_key.substring(0, 8));
    }

    const solQty = solWallet.balance > 0
      ? solWallet.balance
      : (isOnChainReady && 'SOL' in onChainBalances 
          ? onChainBalances['SOL'] 
          : (isWalletMatch ? (activeWallet?.saldo_sol || 0) : (isProfileMatch ? (userProfile?.saldo_sol || 0) : 0)));
    total += solQty * (prices.SOL || 0);

    // 2. Tokens conhecidos
    const currentMints = transactionService.getTokenMints();
    Object.keys(currentMints).forEach(sym => {
       if (sym === 'SOL') return;
       const qty = (isOnChainReady && sym in onChainBalances) 
         ? onChainBalances[sym] 
         : (isWalletMatch 
             ? (activeWallet?.[`saldo_${sym.toLowerCase()}`] || 0) 
             : (isProfileMatch ? (userProfile?.[`saldo_${sym.toLowerCase()}`] || 0) : 0));
       
       if (qty > 0) {
         console.log(`[Home] Token ${sym} encontrado:`, qty);
       }
       total += qty * (prices[sym] || 0);
    });

    // 3. Tokens dinâmicos (customizados via DAS/Helius)
    dynamicTokens.forEach(tk => {
      if (currentMints[tk.symbol]) return;
      total += (tk.balance || 0) * (prices[tk.symbol] || 0);
    });

    // 4. BTC e ETH
    const btcQty = isWalletMatch ? (activeWallet?.saldo_btc || 0) : (userProfile?.saldo_btc || 0);
    if (btcQty) total += btcQty * (prices.BTC || 0);
    if (userProfile?.saldo_eth) total += userProfile.saldo_eth * (prices.ETH || 0);

    // Se o cálculo deu 0 mas tínhamos um saldo anterior e estamos atualizando, mantém o anterior
    if (total === 0 && lastTotalBalance !== null && (isRefreshing || !isOnChainReady)) {
      return lastTotalBalance;
    }

    // Atualiza o cache do último saldo válido se o novo for > 0
    if (total > 0 && total !== lastTotalBalance) {
      setTimeout(() => setLastTotalBalance(total), 0);
    }

    return total;
  })();

  const handleBarCodeScanned = (data: string) => {
    setIsScannerVisible(false);
    router.push({ pathname: '/transferir', params: { scanData: data, crypto: 'SOL' } } as any);
  };

  const startScanner = () => {
    Keyboard.dismiss();
    setTimeout(() => setIsScannerVisible(true), 300);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header 
        onMenuPress={() => setSidebarVisible(true)} 
        showScanner 
        onScannerPress={startScanner} 
        showNotificationDot={hasUnread} 
      />

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={isRefreshing} 
            onRefresh={loadData} 
            tintColor={V.gold} 
            colors={[V.gold]} 
          />
        }
      >
        <View style={styles.topSection}>
            <View style={styles.userBox}>
                <Text style={styles.greeting}>{t('BEM-VINDO AO VERUN CRYPTO')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.userName}>{walletName || userProfile?.nome_completo || t('Investidor')}</Text>
                  {network === 'devnet' && (
                    <View style={styles.devnetBadge}>
                      <Text style={styles.devnetBadgeText}>DEVNET</Text>
                    </View>
                  )}
                </View>
                
                {rtBalances.error && rtBalances.lastUpdated && (
                  <View style={styles.rpcErrorBadge}>
                    <View style={styles.rpcErrorDot} />
                    <Text style={styles.rpcErrorText} numberOfLines={1}>
                      Saldo desatualizado · {rtBalances.error}
                    </Text>
                  </View>
                )}

                <Text style={styles.addressLabel}>{t('ENDEREÇO PÚBLICO')}</Text>
                <TouchableOpacity 
                   style={styles.fullAddressPill} 
                   onPress={() => { 
                     const a = solWallet.publicKey || userProfile?.wallet_address || '';
                     if (a) {
                       Clipboard.setStringAsync(a); 
                       Alert.alert(t('SUCESSO'), t('Endereço copiado!')); 
                     }
                   }}
                >
                    <Text style={styles.addressT} numberOfLines={1} ellipsizeMode="middle">
                        {solWallet.publicKey || userProfile?.wallet_address || t('Carregando...')}
                    </Text>
                    <Feather name="copy" size={12} color={V.gold} />
                </TouchableOpacity>
            </View>
        </View>

        <View style={styles.heroCard}>
            <View style={styles.heroHeader}>
                <Text style={styles.heroLabel}>{t('PATRIMÔNIO TOTAL')}</Text>
                <TouchableOpacity onPress={() => setIsBalanceVisible(!isBalanceVisible)}>
                    <Feather name={isBalanceVisible ? 'eye' : 'eye-off'} size={18} color={V.gold} />
                </TouchableOpacity>
            </View>
            <View style={styles.heroValueRow}>
                <Text style={styles.heroValue}>{isBalanceVisible ? formatCurrency(totalBalanceUsdt) : '••••••'}</Text>
            </View>
            <View style={styles.heroStats}>
                <View style={styles.badge}><Feather name="trending-up" size={10} color={V.success} /><Text style={styles.badgeT}>+2.4%</Text></View>
                <View style={styles.heroActions}>
                  <TouchableOpacity style={styles.hActionBtn} onPress={startScanner}>
                    <View style={styles.hActionIcon}>
                      <Image source={require('../../public/icone pagar-usdt.png')} style={styles.hActionImg} resizeMode="contain" />
                    </View>
                    <Text style={styles.hActionLabel}>{t('PAGAR')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.hActionBtn} onPress={() => router.push('/depositar-crypto?crypto=SOL' as any)}>
                    <View style={styles.hActionIcon}>
                      <Image source={require('../../public/icone receber-usdt.png')} style={styles.hActionImg} resizeMode="contain" />
                    </View>
                    <Text style={styles.hActionLabel}>{t('RECEBER')}</Text>
                  </TouchableOpacity>
                </View>
            </View>
        </View>

        <View style={styles.grid}>
            <ActionBtn customIcon={require('../../public/icone-receber.png')} label={t('Receber Crypto').toUpperCase()} onPress={() => router.push('/depositar-crypto' as any)} />
            <ActionBtn icon="plus-circle" label={t('Comprar Crypto').toUpperCase()} onPress={() => router.push('/depositar-pix' as any)} />
            <ActionBtn icon="trending-up" label={t('Investir').toUpperCase()} onPress={() => router.push('/investir' as any)} />
            <ActionBtn icon="refresh-cw" label={t('CÂMBIO').toUpperCase()} onPress={() => router.push('/cambio' as any)} />
            <ActionBtn customIcon={require('../../public/icone-transferir.png')} label={t('Transferir').toUpperCase()} onPress={() => router.push('/transferir' as any)} />
        </View>

        <HomeCarousel />

        <View style={styles.section}>
            <View style={styles.sectionH}>
                <Text style={styles.sectionT}>{t('Seus Ativos').toUpperCase()}</Text>
                <TouchableOpacity onPress={() => router.push('/wallet' as any)}><Text style={styles.seeAll}>{t('Ver Tudo').toUpperCase()}</Text></TouchableOpacity>
            </View>
            <View style={styles.assetList}>
                {(() => {
                  const isOnChainReady = Object.keys(onChainBalances).length > 0;
                  return (
                    <>
                      <AssetItem img="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png" name="Solana" sym="SOL" bal={Number(solWallet.balance > 0 ? solWallet.balance : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0))).toFixed(4)} price={prices.SOL} change={priceChanges.SOL} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'SOL' } } as any)} />
                      <AssetItem img="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png" name="Tether" sym="USDT" bal={Number(isOnChainReady && 'USDT' in onChainBalances ? onChainBalances['USDT'] : (userProfile?.saldo_usdt || 0)).toFixed(2)} price={prices.USDT} change={priceChanges.USDT} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'USDT' } } as any)} />
                      <AssetItem img="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png" name="USDC" sym="USDC" bal={Number(isOnChainReady && 'USDC' in onChainBalances ? onChainBalances['USDC'] : (userProfile?.saldo_usdc || 0)).toFixed(2)} price={prices.USDC} change={priceChanges.USDC} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'USDC' } } as any)} />
                      <AssetItem img={require('../../public/BDC.png')} name="BodeCoin" sym="BDC" bal={Number(isOnChainReady && 'BDC' in onChainBalances ? onChainBalances['BDC'] : (userProfile?.saldo_bdc || 0)).toFixed(2)} price={prices.BDC} change={priceChanges.BDC} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'BDC' } } as any)} />
                      <AssetItem img="https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q" name="Escoteiros" sym="ESCT" bal={Number(isOnChainReady && 'ESCT' in onChainBalances ? onChainBalances['ESCT'] : (userProfile?.saldo_esct || 0)).toFixed(2)} price={prices.ESCT} change={priceChanges.ESCT} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'ESCT' } } as any)} />
                      <AssetItem img="https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q" name="Brutos" sym="BRT" bal={Number(isOnChainReady && 'BRT' in onChainBalances ? onChainBalances['BRT'] : (userProfile?.saldo_brt || 0)).toFixed(2)} price={prices.BRT} change={priceChanges.BRT} onPress={() => router.push({ pathname: '/grafico-token', params: { coin: 'BRT' } } as any)} />
                    </>
                  );
                })()}
                
                {dynamicTokens.map((tk) => (
                  <AssetItem 
                    key={tk.mint} 
                    name={tk.name} 
                    sym={tk.symbol} 
                    bal={tk.balance.toFixed(tk.decimals > 4 ? 2 : 4)} 
                    price={prices[tk.symbol] || 0} 
                    change={priceChanges[tk.symbol] || 0}
                    onPress={() => router.push({ pathname: '/grafico-token', params: { coin: tk.symbol } } as any)}
                  />
                ))}
            </View>
        </View>

        <View style={styles.section}>
            <View style={styles.sectionH}>
                <Text style={styles.sectionT}>{t('Atividade Recente').toUpperCase()}</Text>
                <TouchableOpacity onPress={() => router.push('/atividade' as any)}><Text style={styles.seeAll}>{t('Histórico').toUpperCase()}</Text></TouchableOpacity>
            </View>
            {transactions.length > 0 ? (
                <View style={styles.txList}>
                    {transactions.slice(0, 3).map(tx => <TxItem key={tx.id} tx={tx} me={userProfile?.id} />)}
                </View>
            ) : (
                <View style={styles.empty}><Text style={styles.emptyT}>{t('Nenhuma transação encontrada')}</Text></View>
            )}
        </View>
      </ScrollView>

      <BottomNav activeRoute="index" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} activeRoute="index" />

      <QRScannerModal
        visible={isScannerVisible}
        onClose={() => setIsScannerVisible(false)}
        onScanned={handleBarCodeScanned}
        label={t('POSICIONE O QR CODE NO CENTRO')}
      />
    </View>
  );
}

function ActionBtn({ icon, customIcon, label, onPress }: any) {
    return (
        <TouchableOpacity style={styles.actionBtn} onPress={onPress}>
            <View style={styles.actionIcon}>
                {customIcon ? (
                  <Image source={customIcon} style={{ width: 26, height: 26, tintColor: V.gold }} resizeMode="contain" />
                ) : (
                  <Feather name={icon} size={20} color={V.gold} />
                )}
            </View>
            <Text style={styles.actionLabel}>{label}</Text>
        </TouchableOpacity>
    );
}

function AssetItem({ img, name, sym, bal, price, change, onPress }: any) {
    const { formatCurrency } = useSettings();
    const usdValue = (parseFloat(bal) * (price || 0));
    return (
        <TouchableOpacity style={styles.assetItem} onPress={onPress}>
            <View style={styles.assetLeft}>
                <View style={styles.assetImgW}><Image source={typeof img === 'string' ? { uri: img } : img} style={styles.assetImg} /></View>
                <View>
                    <Text style={styles.assetN}>{name}</Text>
                    <Text style={styles.assetS}>{sym} • {price != null && price > 0 ? `$${price.toFixed(price > 1 ? 2 : 6)}` : '---'}</Text>
                </View>
            </View>
            <View style={styles.assetChartBtn}>
                <Feather name="trending-up" size={24} color={V.success} />
            </View>
            <View style={styles.assetRight}>
                <Text style={styles.assetB}>{bal}</Text>
                <Text style={styles.assetFiat}>{formatCurrency(usdValue)}</Text>
            </View>
        </TouchableOpacity>
    );
}

function TxItem({ tx, me }: any) {
    const { t } = useSettings();
    const tipoTx = tx.tipo?.toLowerCase();
    const isSwap = tipoTx === 'swap';
    const isDeposit = tipoTx === 'depósito' || tipoTx === 'deposito';
    const isWithdraw = tipoTx === 'saque';
    const isInvestment = tipoTx === 'investimento';
    const isIn = isDeposit || tx.isRecebimento === true || tx.destinatario_id === me || tx.destinatario_id === 'me' || tx.tipo === 'Recebimento';
    const isFailed = ['falha', 'failed', 'FALHA', 'FAILED'].includes(tx.status);
    const isPending = tx.status === 'pending';

    let title: string;
    if (isDeposit) {
      title = t('Depósito');
    } else if (isWithdraw) {
      title = t('Saque');
    } else if (isInvestment) {
      title = t('Investimento');
    } else if (isSwap) {
      title = t('Swap');
    } else if (isIn) {
      title = t('Recebido');
    } else {
      title = t('Enviado');
    }

    let subtitle = '';
    if (isSwap && tx.moeda_destino) {
      subtitle = `${tx.moeda} → ${tx.moeda_destino}`;
    } else if (tx.descricao) {
      subtitle = tx.descricao;
    } else if (isIn && tx.remetente_id && tx.remetente_id !== 'other') {
      subtitle = `De: ${String(tx.remetente_id).substring(0, 8)}...`;
    } else if (!isIn && tx.destinatario_id && tx.destinatario_id !== 'other') {
      subtitle = `Para: ${String(tx.destinatario_id).substring(0, 8)}...`;
    }

    const logoUrls: Record<string, string> = {
      'SOL':  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      'USDC': 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      'USDT': 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
      'BDC':  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9/logo.png',
    };
    const logoUrl = logoUrls[tx.moeda];
    const logoDestUrl = logoUrls[tx.moeda_destino || ''];

    // Ícone para depósito/saque (sem logo de token)
    const showSpecialIcon = isDeposit || isWithdraw || isInvestment;
    const specialIconName = isDeposit ? 'arrow-down-circle' : isWithdraw ? 'arrow-up-circle' : 'trending-up';
    const specialIconColor = isDeposit ? V.success : isWithdraw ? '#E74C3C' : V.gold;

    const dateStr = (() => {
      const d = new Date(tx.created_at || tx.blockTime || 0);
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
    })();

    return (
        <View style={styles.txItem}>
            <View style={styles.itemLeft}>
              {isSwap ? (
                 <View style={styles.swapIconContainer}>
                   {logoUrl
                     ? <Image source={{ uri: logoUrl }} style={styles.swapIconTop} />
                     : <View style={[styles.fallbackIcon, styles.swapIconTop]}><Text style={styles.fallbackT}>{tx.moeda?.[0]}</Text></View>}
                   {logoDestUrl
                     ? <Image source={{ uri: logoDestUrl }} style={styles.swapIconBot} />
                     : <View style={[styles.fallbackIcon, styles.swapIconBot]}><Text style={styles.fallbackT}>{tx.moeda_destino?.[0] || '?'}</Text></View>}
                 </View>
              ) : showSpecialIcon ? (
                 <View style={[styles.iconContainer, { backgroundColor: `${specialIconColor}18` }]}>
                   <Feather name={specialIconName as any} size={20} color={specialIconColor} />
                 </View>
              ) : (
                 <View style={styles.iconContainer}>
                    {logoUrl
                      ? <Image source={{ uri: logoUrl }} style={styles.iconImg} />
                      : <Text style={styles.fallbackT}>{tx.moeda?.[0] || '?'}</Text>}
                 </View>
              )}

              <View style={styles.infoCol}>
                <Text style={styles.ttitle}>{title}</Text>
                {subtitle
                  ? <Text style={styles.tsub}>{subtitle}</Text>
                  : <Text style={styles.tsub}>{dateStr}</Text>}
              </View>
            </View>

            <View style={styles.itemRight}>
              {isSwap ? (
                <>
                  <Text style={styles.valOut}>-{tx.valor} {tx.moeda}</Text>
                  {tx.moeda_destino && <Text style={styles.valIn}>+{tx.valor_destino || '?'} {tx.moeda_destino}</Text>}
                </>
              ) : (
                <Text style={isIn ? styles.valIn : styles.valOut}>
                  {isIn ? '+' : '-'}{tx.valor} {tx.moeda}
                </Text>
              )}
              {isPending && !isFailed && (
                <View style={styles.pendingBadge}><Text style={styles.pendingText}>{t('Pendente')}</Text></View>
              )}
              {isFailed && (
                <View style={styles.failedBadge}><Text style={styles.failedText}>{t('Falhou')}</Text></View>
              )}
            </View>
        </View>
    );
}


const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 110 },
  topSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 24 },
  userBox: { flex: 1 },
  greeting: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1.5, marginBottom: 4 },
  userName: { fontSize: 20, fontFamily: F.title, color: V.text, marginBottom: 12 },
  addressLabel: { fontSize: 9, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 6 },
  fullAddressPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    backgroundColor: V.surface2, 
    paddingHorizontal: 12, 
    paddingVertical: 6, 
    borderRadius: 20, 
    borderWidth: 1, 
    borderColor: V.border,
    alignSelf: 'flex-start'
  },
  addressT: { fontSize: 11, color: V.gold, fontFamily: F.medium, maxWidth: 200 },
  heroCard: { backgroundColor: V.surface1, borderRadius: 12, padding: 24, borderWidth: 1, borderColor: 'rgba(201,168,76,0.2)', marginBottom: 24, ...V.shadow },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heroLabel: { fontSize: 11, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  heroValue: { fontSize: 36, fontFamily: F.bold, color: '#FFFFFF' },
  heroUnit: { fontSize: 16, fontFamily: F.title, color: V.gold },
  heroStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(46, 204, 113, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  badgeT: { color: V.success, fontSize: 11, fontFamily: F.bold },
  heroFiat: { fontSize: 14, fontFamily: F.body, color: V.muted },
  grid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  assetChartBtn: {
    flex: 1,
    alignSelf: 'stretch',
    marginHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: { alignItems: 'center', gap: 10, width: '18%' },
  actionIcon: { width: 56, height: 56, backgroundColor: V.surface1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border, ...V.shadow },
  actionLabel: { fontSize: 9, fontFamily: F.bold, color: V.gold, letterSpacing: 0.5, textAlign: 'center' },
  section: { marginBottom: 32 },
  sectionH: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionT: { fontSize: 12, fontFamily: F.title, color: V.gold, letterSpacing: 1 },
  seeAll: { fontSize: 10, fontFamily: F.bold, color: V.muted },
  assetList: { gap: 12 },
  assetItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: V.surface1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: V.border },
  assetLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  assetImgW: { width: 40, height: 40, borderRadius: 20, backgroundColor: V.surface2, overflow: 'hidden', borderWidth: 1, borderColor: V.border },
  assetImg: { width: '100%', height: '100%' },
  assetN: { fontSize: 15, fontFamily: F.bold, color: V.text },
  assetS: { fontSize: 12, fontFamily: F.body, color: V.gold },
  assetRight: { alignItems: 'flex-end' },
  assetB: { fontSize: 16, fontFamily: F.bold, color: V.text },
  assetFiat: { fontSize: 12, fontFamily: F.bold, color: V.gold, marginTop: 2 },
  txList: { gap: 24, paddingTop: 4 },
  txItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  iconContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iconImg: { width: '100%', height: '100%' },
  fallbackT: { color: '#FFF', fontSize: 14, fontFamily: F.bold },
  swapIconContainer: { width: 44, height: 44, position: 'relative' },
  swapIconTop: { width: 28, height: 28, borderRadius: 14, position: 'absolute', top: 0, left: 0, zIndex: 2, borderWidth: 2, borderColor: V.bg, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  swapIconBot: { width: 28, height: 28, borderRadius: 14, position: 'absolute', bottom: 0, right: 0, zIndex: 1, borderWidth: 2, borderColor: V.bg },
  fallbackIcon: { backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  infoCol: { flex: 1, justifyContent: 'center' },
  ttitle: { fontSize: 15, fontFamily: F.bold, color: '#F3F4F6' },
  tsub: { fontSize: 13, fontFamily: F.medium, color: '#9CA3AF', marginTop: 3 },
  itemRight: { alignItems: 'flex-end', justifyContent: 'center' },
  valIn: { fontSize: 14, fontFamily: F.bold, color: '#00FF9C' },
  valOut: { fontSize: 14, fontFamily: F.bold, color: '#F3F4F6' },
  failedBadge: { backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  failedText: { color: '#EF4444', fontSize: 10, fontFamily: F.bold },
  pendingBadge: { backgroundColor: 'rgba(201,168,76,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  pendingText: { color: V.gold, fontSize: 10, fontFamily: F.bold },
  empty: { padding: 40, alignItems: 'center', backgroundColor: V.surface1, borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, borderColor: V.border },
  emptyT: { fontSize: 12, fontFamily: F.body, color: V.muted },
  scanner: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scannerFrame: { width: 260, height: 260, borderWidth: 2, borderColor: V.gold, borderRadius: 20, marginBottom: 24 },
  scannerT: { color: '#fff', fontSize: 12, fontFamily: F.bold, letterSpacing: 1, backgroundColor: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 12, marginBottom: 32 },
  closeScanner: { padding: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 40, alignItems: 'center', justifyContent: 'center' },

  heroActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  hActionBtn: { alignItems: 'center' },
  hActionIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: V.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(46,204,113,0.2)', ...V.shadow },
  hActionImg: { width: 30, height: 30 },
  hActionLabel: { fontSize: 10, fontFamily: F.bold, color: V.success, letterSpacing: 0.5, marginTop: 6 },
  
  // Carousel Styles
  carouselContainer: {
    width: width - 40,
    alignSelf: 'center',
    marginBottom: 32,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: V.surface1,
  },
  carouselItem: {
    width: width - 40,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  carouselImage: {
    width: '100%',
    height: '100%',
  },
  pagination: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: V.gold, width: 22 },
  devnetBadge: {
    backgroundColor: '#FF8C00', // Laranja escuro para contraste
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  devnetBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontFamily: F.bold,
    letterSpacing: 0.5,
  },
  rpcErrorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.5)',
    backgroundColor: 'rgba(231,76,60,0.08)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  rpcErrorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E74C3C',
    marginRight: 6,
  },
  rpcErrorText: {
    color: '#E74C3C',
    fontSize: 11,
    fontFamily: F.body,
    flexShrink: 1,
  },
});

function HomeCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = React.useRef<FlatList>(null);
  const itemWidth = width - 40;
  
  const banners = [
    require('../../public/carrossel-wallet-ESCT copy.png'),
    require('../../public/carrossel-wallet-VENDA (1).png'),
    require('../../public/carrossel-wallet-BDC copy.png'),
    require('../../public/carrossel-wallet-VENDA.png'),
    require('../../public/carrossel-wallet copy.png'),
    require('../../public/carrossel-wallet-VENDA-1.png'),
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      const nextIndex = (activeIndex + 1) % banners.length;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    }, 4000); // 4 segundos como padrão web fluído

    return () => clearInterval(timer);
  }, [activeIndex]);

  const onScroll = (event: any) => {
    const scrollOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollOffset / itemWidth);
    if (index !== activeIndex && index >= 0 && index < banners.length) {
      setActiveIndex(index);
    }
  };

  return (
    <View style={styles.carouselContainer}>
      <FlatList
        ref={flatListRef}
        data={banners}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(_, index) => index.toString()}
        getItemLayout={(_, index) => ({
          length: itemWidth,
          offset: itemWidth * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={styles.carouselItem}>
            <Image 
              source={item} 
              style={styles.carouselImage} 
              resizeMode="contain" 
            />
          </View>
        )}
      />
      <View style={styles.pagination}>
        {banners.map((_, i) => (
          <View key={i} style={[styles.dot, activeIndex === i && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}
