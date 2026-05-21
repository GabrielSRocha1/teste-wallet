import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { supabase } from '@/src/services/supabase';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import keyManager from '@/src/services/keyManager';
import { useSolanaWallet } from '@/src/hooks/useSolanaWallet';
import { useRealtimeBalances } from '@/src/hooks/useRealtimeBalances';

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const { t, formatCurrency } = useSettings();
  const [loadingProfile, setLoadingProfile] = useState(true);
  // Hook central de keypair + saldo SOL em tempo real
  const { prices: ctxPrices, network } = useSettings();
  // Hook central de keypair + saldo SOL em tempo real
  const solWallet = useSolanaWallet(network);
  // Extrai USD de cada token do PriceMap do SettingsContext
  const prices: Record<string, number> = React.useMemo(
    () => Object.fromEntries(Object.entries(ctxPrices).map(([k, v]) => [k, (v as any)?.USD ?? 0])),
    [ctxPrices],
  );
  const [priceChanges] = useState<Record<string, number>>({});
  const { coin } = useLocalSearchParams();
  const scrollRef = React.useRef<ScrollView>(null);
  const layouts = React.useRef<Record<string, number>>({});

  // Saldos SPL em tempo real via WebSocket Solana
  const rtBalances = useRealtimeBalances(solWallet.publicKey, network);

  // Mescla saldos: tempo real > fallback DB
  const onChainBalances: Record<string, any> = React.useMemo(() => {
    const merged: Record<string, any> = { ...rtBalances.balances };
    // Tokens dinâmicos (dyn_*) do hook
    Object.entries(rtBalances.balances).forEach(([k, v]) => {
      if (k.startsWith('dyn_')) merged[k] = v;
    });
    return merged;
  }, [rtBalances.balances]);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let { data } = await supabase.from('usuarios').select('*').eq('id', user.id).maybeSingle();

      // Rule #1/#2/#3: NUNCA gerar keypair em mount/effect. Se o perfil ainda
      // não existir no Supabase, tentamos criá-lo a partir da pubkey do vault
      // local (se houver). Se não houver identidade persistida, deixamos o
      // perfil vazio — o usuário deve criar/restaurar explicitamente.
      if (!data) {
        const persisted = await keyManager.getPersistedIdentity();
        if (persisted?.publicKey) {
          const { data: newProfile } = await supabase.from('usuarios').insert({
            id: user.id,
            email: user.email,
            nome_completo: user.user_metadata?.full_name || 'Usuário',
            wallet_address: persisted.publicKey,
            senha_criptografada: 'supabase_managed',
          }).select().single();
          data = newProfile;
        } else {
          console.warn(
            '[Wallet] Sem identidade persistida e sem perfil no DB. ' +
            'Aguardando ação explícita do usuário (criar nova wallet ou restaurar frase).',
          );
        }
      }

      if (data) {
        const { data: dbBalances } = await supabase.rpc('get_all_balances', { p_user_id: user.id });
        const enriched: any = { ...data };
        if (dbBalances && Array.isArray(dbBalances)) {
          dbBalances.forEach((b: any) => {
            if (b.moeda && b.saldo !== undefined) {
              enriched[`saldo_${b.moeda.toLowerCase()}`] = b.saldo;
            }
          });
        }

        setUserProfile(enriched);

        // Endereço ativo: vault local sempre vence (rule #7).
        // Ordem: vault persistido → hook solWallet → sessão em memória → DB.
        const persisted = await keyManager.getPersistedIdentity();
        let activeWalletAddress =
          persisted?.publicKey ?? solWallet.publicKey ?? null;
        if (!activeWalletAddress) {
          try {
            const sessionKeypair = keyManager.getSessionKeypair();
            if (sessionKeypair) {
              activeWalletAddress = sessionKeypair.publicKey.toBase58();
            }
          } catch (e) {}
        }
        if (!activeWalletAddress) {
          activeWalletAddress = data.wallet_address;
        }

      }
    } catch (err) {} finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchProfile();
    }, [])
  );
  
  useEffect(() => {
    if (coin && layouts.current[coin as string] !== undefined) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: layouts.current[coin as string], animated: true });
      }, 300);
    }
  }, [coin, loadingProfile]);

  const openSidebar = () => setSidebarVisible(true);
  const closeSidebar = () => setSidebarVisible(false);

  if (loadingProfile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: V.bg }}>
        <ActivityIndicator size="large" color={V.gold} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      <Header onMenuPress={openSidebar} />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View>
            <Text style={styles.heroTitle}>{t('MEU')}{"\n"}{t('PATRIMÔNIO')}</Text>
            <View style={styles.goldLine} />
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>{t('SALDO ESTIMADO')}</Text>
            <Text style={styles.totalValue}>
              {(() => {
                let totalUsd = 0;
                
                // Se o hook ainda está carregando o PRIMEIRO fetch, usamos os saldos do DB
                const isOnChainReady = Object.keys(onChainBalances).length > 0;

                // 1. SOL — prioriza hook tempo real, fallback on-chain, fallback DB
                const solQty = solWallet.balance > 0
                  ? solWallet.balance
                  : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0));
                totalUsd += solQty * (prices.SOL || 0);

                // 2. Tokens SPL conhecidos
                const knownSymbols = ['USDT', 'USDC', 'BDC', 'ESCT', 'BRT'];
                knownSymbols.forEach(sym => {
                  const qty = (isOnChainReady && sym in onChainBalances) ? onChainBalances[sym] : (userProfile?.[`saldo_${sym.toLowerCase()}`] || 0);
                  totalUsd += qty * (prices[sym] || 0);
                });

                // 3. Tokens dinâmicos (prefixados com dyn_)
                Object.keys(onChainBalances).forEach(key => {
                  if (key.startsWith('dyn_') && !key.endsWith('_meta')) {
                    const symbol = key.replace('dyn_', '').toUpperCase();
                    if (knownSymbols.includes(symbol)) return;
                    totalUsd += (onChainBalances[key] * (prices[symbol] || 0));
                  }
                });

                // 4. BTC e ETH
                if (userProfile?.saldo_btc) totalUsd += userProfile.saldo_btc * (prices.BTC || 0);
                if (userProfile?.saldo_eth) totalUsd += userProfile.saldo_eth * (prices.ETH || 0);

                return formatCurrency(totalUsd);
              })()}
            </Text>
          </View>
        </View>

        {/* Crypto List */}
        <View style={styles.cryptoList}>
          {(() => {
            const isOnChainReady = Object.keys(onChainBalances).length > 0;
            return (
              <>
                <CryptoCard
                  imageUrl="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png"
                  symbol="SOL"
                  balance={Number(solWallet.balance > 0 ? solWallet.balance : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0))).toLocaleString('en-US', { minimumFractionDigits: 4 })}
                  fiat={formatCurrency(Number(solWallet.balance > 0 ? solWallet.balance : (isOnChainReady && 'SOL' in onChainBalances ? onChainBalances['SOL'] : (userProfile?.saldo_sol || 0))) * (prices.SOL || 0))}
                  isPrincipal
                  price={prices.SOL}
                  change={priceChanges.SOL}
                  onLayout={(e: any) => { layouts.current['SOL'] = e.nativeEvent.layout.y; }}
                />
                <CryptoCard
                  imageUrl="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png"
                  symbol="USDT"
                  balance={Number(isOnChainReady && 'USDT' in onChainBalances ? onChainBalances['USDT'] : (userProfile?.saldo_usdt || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  fiat={formatCurrency(Number(isOnChainReady && 'USDT' in onChainBalances ? onChainBalances['USDT'] : (userProfile?.saldo_usdt || 0)) * (prices.USDT || 1))}
                  price={prices.USDT}
                  change={priceChanges.USDT}
                  onLayout={(e: any) => { layouts.current['USDT'] = e.nativeEvent.layout.y; }}
                />
                <CryptoCard
                  imageUrl="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png"
                  symbol="USDC"
                  balance={Number(isOnChainReady && 'USDC' in onChainBalances ? onChainBalances['USDC'] : (userProfile?.saldo_usdc || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  fiat={formatCurrency(Number(isOnChainReady && 'USDC' in onChainBalances ? onChainBalances['USDC'] : (userProfile?.saldo_usdc || 0)) * (prices.USDC || 1))}
                  price={prices.USDC}
                  change={priceChanges.USDC}
                  onLayout={(e: any) => { layouts.current['USDC'] = e.nativeEvent.layout.y; }}
                />
                <CryptoCard
                  imageUrl={require('../../public/BDC.png')}
                  symbol="BDC"
                  balance={Number(isOnChainReady && 'BDC' in onChainBalances ? onChainBalances['BDC'] : (userProfile?.saldo_bdc || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  fiat={formatCurrency(Number(isOnChainReady && 'BDC' in onChainBalances ? onChainBalances['BDC'] : (userProfile?.saldo_bdc || 0)) * (prices.BDC || 0))}
                  price={prices.BDC}
                  change={priceChanges.BDC}
                  onLayout={(e: any) => { layouts.current['BDC'] = e.nativeEvent.layout.y; }}
                />
                <CryptoCard
                  imageUrl="https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q"
                  symbol="ESCT"
                  balance={Number(isOnChainReady && 'ESCT' in onChainBalances ? onChainBalances['ESCT'] : (userProfile?.saldo_esct || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  fiat={formatCurrency(Number(isOnChainReady && 'ESCT' in onChainBalances ? onChainBalances['ESCT'] : (userProfile?.saldo_esct || 0)) * (prices.ESCT || 0))}
                  price={prices.ESCT}
                  change={priceChanges.ESCT}
                  onLayout={(e: any) => { layouts.current['ESCT'] = e.nativeEvent.layout.y; }}
                />
                <CryptoCard
                  imageUrl="https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q"
                  symbol="BRT"
                  balance={Number(isOnChainReady && 'BRT' in onChainBalances ? onChainBalances['BRT'] : (userProfile?.saldo_brt || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  fiat={formatCurrency(Number(isOnChainReady && 'BRT' in onChainBalances ? onChainBalances['BRT'] : (userProfile?.saldo_brt || 0)) * (prices.BRT || 0))}
                  price={prices.BRT}
                  change={priceChanges.BRT}
                  onLayout={(e: any) => { layouts.current['BRT'] = e.nativeEvent.layout.y; }}
                />
              </>
            );
          })()}

          {/* Dinâmicos */}
          {Object.keys(onChainBalances)
            .filter(key => key.startsWith('dyn_') && !key.endsWith('_meta'))
            .map(key => {
              const balance = onChainBalances[key];
              if (!balance || balance <= 0) return null;
              const meta: any = onChainBalances[`${key}_meta`];
              const sym = meta?.symbol || key.replace('dyn_', '').toUpperCase();
              return (
                <CryptoCard
                  key={key}
                  symbol={sym}
                  balance={Number(balance).toLocaleString('en-US', { minimumFractionDigits: 4 })}
                  fiat={prices[sym] ? formatCurrency(Number(balance) * prices[sym]) : (meta?.name || sym)}
                  price={prices[sym]}
                />
              );
            })}
        </View>
      </ScrollView>

      <BottomNav activeRoute="wallet" />
      <Sidebar isVisible={isSidebarVisible} onClose={closeSidebar} activeRoute="wallet" />
    </View>
  );
}

function CryptoCard({ imageUrl, symbol, balance, fiat, isPrincipal, price, change, onLayout }: any) {
  const [isVisible, setIsVisible] = useState(true);
  const { t } = useSettings();

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.coinIconBox}>
            {imageUrl ? (
              <Image source={typeof imageUrl === 'string' ? { uri: imageUrl } : imageUrl} style={styles.coinImage} />
            ) : (
              <View style={styles.coinPlaceholder}>
                <Text style={styles.coinPlaceholderText}>{symbol?.substring(0, 2)}</Text>
              </View>
            )}
          </View>
          <View>
            <Text style={styles.symbolText}>{symbol} {isPrincipal && <Text style={styles.principalLabel}>{t('PRINCIPAL')}</Text>}</Text>
            {price !== undefined && (
              <Text style={styles.priceSmall}>${price > 1 ? price.toFixed(2) : price.toFixed(4)}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity style={styles.eyeBtn} onPress={() => setIsVisible(!isVisible)}>
          <Feather name={isVisible ? "eye" : "eye-off"} size={16} color={V.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.balanceRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardBalanceLabel}>{t('SALDO TOTAL')}</Text>
          <Text style={styles.balanceValueText}>
            {isVisible ? balance : '••••••••'}
          </Text>
          {fiat && (
            <Text style={styles.fiatText}>
              {isVisible ? `≈ ${fiat}` : `≈ ${t('Saldo oculto')}`}
            </Text>
          )}
        </View>
        {change !== undefined && isVisible && (
          <View style={[styles.changeBadge, { backgroundColor: change >= 0 ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)' }]}>
            <Text style={[styles.changeText, { color: change >= 0 ? V.success : V.danger }]}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity 
          style={styles.actionBtn}
          onPress={() => router.push('/depositar-crypto' as any)}
        >
          <Feather name="download" size={14} color={V.gold} />
          <Text style={styles.actionBtnText}>{t('RECEBER')}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.actionBtn}
          onPress={() => router.push({ pathname: '/cambio', params: { from: symbol, to: symbol === 'BDC' ? 'USDT' : 'BDC' } } as any)}
        >
          <MaterialCommunityIcons name="swap-horizontal" size={14} color={V.gold} />
          <Text style={styles.actionBtnText}>{t('SWAP')}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionBtn, styles.actionBtnActive]}
          onPress={() => router.push({ pathname: '/enviar-crypto', params: { crypto: symbol } } as any)}
        >
          <Feather name="upload" size={14} color={V.bg} />
          <Text style={[styles.actionBtnText, { color: V.bg }]}>{t('ENVIAR')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 110 },

  // Lock Screen
  lockIconBox: { width: 120, height: 120, borderRadius: 60, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 1, borderColor: V.border },
  lockMini: { position: 'absolute', bottom: 30, right: 30 },
  lockTitle: { fontSize: 24, fontFamily: F.title, color: V.gold, marginBottom: 16, letterSpacing: 2 },
  lockText: { fontSize: 14, fontFamily: F.body, color: V.muted, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  unlockBtn: { marginTop: 40, backgroundColor: V.gold, paddingVertical: 14, paddingHorizontal: 32, borderRadius: V.r8, ...V.shadow },
  unlockBtnText: { fontFamily: F.bold, fontSize: 14, color: V.bg, letterSpacing: 1 },

  // Hero
  heroSection: { marginTop: 24, marginBottom: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroTitle: { fontSize: 32, fontFamily: F.title, color: V.gold, lineHeight: 34 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 8 },
  totalBox: { alignItems: 'flex-end' },
  totalLabel: { fontSize: 10, fontFamily: F.semi, color: V.muted, letterSpacing: 1 },
  totalValue: { fontSize: 24, fontFamily: F.bold, color: '#FFFFFF', marginTop: 4 },

  // List
  cryptoList: { gap: 16 },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinIconBox: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: V.surface2, borderWidth: 1, borderColor: V.border },
  coinImage: { width: '100%', height: '100%' },
  coinPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coinPlaceholderText: { fontSize: 14, fontFamily: F.bold, color: V.gold },
  symbolText: { fontSize: 16, fontFamily: F.bold, color: V.text },
  principalLabel: { fontSize: 9, fontFamily: F.bold, color: V.success, backgroundColor: 'rgba(46, 204, 113, 0.1)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, marginLeft: 4 },
  priceSmall: { fontSize: 12, fontFamily: F.body, color: V.muted, marginTop: 2 },
  eyeBtn: { padding: 4 },

  balanceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 },
  cardBalanceLabel: { fontSize: 10, fontFamily: F.semi, color: V.muted, letterSpacing: 1, marginBottom: 4 },
  balanceValueText: { fontSize: 22, fontFamily: F.bold, color: '#FFFFFF' },
  fiatText: { fontSize: 12, fontFamily: F.body, color: V.muted, marginTop: 4 },
  changeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: V.r20 },
  changeText: { fontSize: 12, fontFamily: F.bold },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, height: 40, borderRadius: V.r8, backgroundColor: V.surface2, borderWidth: 1, borderColor: V.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionBtnActive: { backgroundColor: V.gold, borderColor: V.gold },
  actionBtnText: { fontSize: 9, fontFamily: F.bold, color: V.gold, letterSpacing: 0.5 },
});
