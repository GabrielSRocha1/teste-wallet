import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { V, F } from '@/constants/theme';
import { supabase } from '@/src/services/supabase';
import transactionService from '@/src/services/transactionService';
import keyManager from '@/src/services/keyManager';
import { useSettings } from '@/constants/SettingsContext';

const MOCK_AVATARS: Record<string, string> = {
  'SOL': 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  'USDC': 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  'USDT': 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
};

function formatGroupDate(dateStr: string, t: any) {
  const date = new Date(dateStr);
  const now = new Date();
  
  // Strip time for comparison
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const diffTime = Math.abs(today.getTime() - d.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  if (diffDays === 0) return t('HOJE');
  if (diffDays === 1) return t('ONTEM');
  
  if (diffDays < 7 && d.getDay() !== today.getDay()) {
    const days = [t('DOMINGO'), t('SEGUNDA-FEIRA'), t('TERÇA-FEIRA'), t('QUARTA-FEIRA'), t('QUINTA-FEIRA'), t('SEXTA-FEIRA'), t('SÁBADO')];
    return days[d.getDay()];
  }
  
  const months = ['JAN.', 'FEV.', 'MAR.', 'ABR.', 'MAI.', 'JUN.', 'JUL.', 'AGO.', 'SET.', 'OUT.', 'NOV.', 'DEZ.'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export default function AtividadeScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [filter, setFilter] = useState<'todas' | 'envio' | 'recebimento' | 'swap'>('todas');
  // (CR4) `me` e `transactions` faltavam — refactor anterior removeu o useState
  // sem propagar para os call-sites. Em runtime crashava ao chamar setMe/setTransactions.
  const [me, setMe] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setMe(user.id);

        const { data: profile } = await supabase.from('usuarios').select('*').eq('id', user.id).maybeSingle();

        // Busca atividades do ledger novo
        let mergedTxs = await transactionService.getRecentActivities(user.id, 50);

        // Fetch On-Chain
        const addr = profile?.wallet_address || user.user_metadata?.wallet_address;
        if (addr) {
          try {
            const onChainTxs = await transactionService.getRecentOnChainTransactions(addr, 15);
            mergedTxs = [...mergedTxs, ...onChainTxs];
            
            // Deduplicate
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
            console.warn('[Atividade] Erro ao buscar on-chain:', e);
          }
        }
        
        setTransactions(mergedTxs);
      };
      load();
    }, [])
  );

  // Filtragem
  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'todas') return true;
    const isSwap = tx.tipo === 'Swap' || tx.tipo === 'swap';
    if (filter === 'swap') return isSwap;
    if (filter === 'recebimento') return tx.isRecebimento === true && !isSwap;
    if (filter === 'envio') return tx.isRecebimento === false && !isSwap;
    return true;
  });

  // Group by Date natively
  const grouped: Record<string, any[]> = {};
  filteredTransactions.forEach(tx => {
    const header = formatGroupDate(tx.created_at || tx.blockTime || 0, t);
    if (!grouped[header]) grouped[header] = [];
    grouped[header].push(tx);
  });

  const FILTERS = [
    { key: 'todas', label: t('TODAS') },
    { key: 'recebimento', label: t('RECEBIDOS') },
    { key: 'envio', label: t('ENVIADOS') },
    { key: 'swap', label: t('SWAPS') },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{t('Atividade')}</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.filtersBox}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key as any)}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {Object.entries(grouped).length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="list" size={48} color={V.surface2} />
            <Text style={styles.emptyText}>{t('Nenhuma atividade encontrada')}</Text>
          </View>
        ) : (
          Object.entries(grouped).map(([dateLabel, txs]) => (
            <View key={dateLabel} style={styles.group}>
              <Text style={styles.dateHeader}>{dateLabel}</Text>
            
              <View style={styles.txList}>
                {txs.map((tx: any, idx: number) => {
                  const isIn = tx.isRecebimento === true;
                  const isOut = tx.isRecebimento === false && (tx.tipo === 'Envio' || tx.tipo === 'transfer' || tx.tipo === 'Saque');
                  const isSwap = tx.tipo === 'Swap' || tx.tipo === 'swap';
                  const isFailed = tx.status === 'FALHA' || tx.status === 'FAILED' || tx.status === 'failed';
                  
                  let title = tx.tipo || 'Unknown';
                  if (isSwap) {
                    title = t('Swap Realizado');
                  } else if (isIn) {
                    title = t('Recebido');
                  } else if (isOut) {
                    title = t('Enviado');
                  }
                  
                  let subtitle = tx.descricao || '';
                  if (isSwap && !subtitle) {
                    subtitle = `${tx.moeda} -> ${tx.moeda_destino || '...'}`;
                  }

                  const logoUrl = MOCK_AVATARS[tx.moeda];

                  return (
                    <View key={tx.id || idx} style={styles.item}>
                      <View style={styles.itemLeft}>
                        {isSwap ? (
                          <View style={styles.swapIconContainer}>
                            {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.swapIconTop} /> : <View style={[styles.fallbackIcon, styles.swapIconTop]}><Text style={styles.fallbackT}>{tx.moeda?.[0]}</Text></View>}
                            <Image source={{ uri: MOCK_AVATARS[tx.moeda_destino || 'USDC'] || MOCK_AVATARS['USDC'] }} style={styles.swapIconBot} />
                          </View>
                        ) : (
                          <View style={styles.iconContainer}>
                            {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.iconImg} /> : (
                              title === 'App interaction' || title === 'Unknown' ? <Feather name="activity" size={18} color="#FFF" /> :
                              title === 'Card payment' ? <Feather name="credit-card" size={18} color="#FFF" /> :
                              <Text style={styles.fallbackT}>{tx.moeda?.[0] || '?'}</Text>
                            )}
                          </View>
                        )}
                        
                        <View style={styles.infoCol}>
                          <Text style={styles.ttitle}>{title}</Text>
                          {!!subtitle && <Text style={styles.tsub}>{subtitle}</Text>}
                        </View>
                      </View>
                      
                      <View style={styles.itemRight}>
                        {isSwap ? (
                          <>
                            <Text style={styles.valOut}>-{tx.valor} {tx.moeda}</Text>
                            <Text style={styles.valIn}>+{tx.valor_destino || tx.valor} {tx.moeda_destino}</Text>
                          </>
                        ) : (
                          title !== 'App interaction' && title !== 'Unknown' && (
                            <Text style={isIn ? styles.valIn : styles.valOut}>
                              {isIn ? '+' : '-'}{tx.valor} {tx.moeda}
                            </Text>
                          )
                        )}
                        {title === 'Unknown' && <Text style={styles.valIn}>+0.00000001 {tx.moeda}</Text>}
                        {isFailed && <View style={styles.failedBadge}><Text style={styles.failedText}>Failed</Text></View>}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D12' }, // Darker background to match screenshot
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 16, fontFamily: F.bold, color: '#FFF' },
  headerRight: { width: 32 }, // balance spacing
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  group: { marginTop: 24 },
  dateHeader: { 
    fontSize: 12, 
    fontFamily: F.bold, 
    color: '#6B7280', 
    letterSpacing: 1, 
    marginBottom: 16,
    textTransform: 'uppercase'
  },
  txList: { gap: 24 },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  
  iconContainer: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1F2937', 
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden'
  },
  iconImg: { width: '100%', height: '100%' },
  fallbackT: { color: '#FFF', fontSize: 14, fontFamily: F.bold },
  
  swapIconContainer: { width: 44, height: 44, position: 'relative' },
  swapIconTop: {
    width: 28, height: 28, borderRadius: 14,
    position: 'absolute', top: 0, left: 0,
    zIndex: 2, borderWidth: 2, borderColor: '#0B0D12',
    backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center'
  },
  swapIconBot: {
    width: 28, height: 28, borderRadius: 14,
    position: 'absolute', bottom: 0, right: 0,
    zIndex: 1, borderWidth: 2, borderColor: '#0B0D12'
  },
  fallbackIcon: { backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  
  infoCol: { flex: 1, justifyContent: 'center' },
  ttitle: { fontSize: 15, fontFamily: F.bold, color: '#F3F4F6' },
  tsub: { fontSize: 13, fontFamily: F.medium, color: '#9CA3AF', marginTop: 3 },
  
  itemRight: { alignItems: 'flex-end', justifyContent: 'center' },
  valIn: { fontSize: 14, fontFamily: F.bold, color: '#00FF9C' },
  valOut: { fontSize: 14, fontFamily: F.bold, color: '#F3F4F6' },
  
  failedBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4,
  },
  failedText: { color: '#EF4444', fontSize: 10, fontFamily: F.bold },

  filtersBox: { height: 44, marginBottom: 12 },
  filtersRow: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#374151' },
  filterChipActive: { backgroundColor: '#C9A84C', borderColor: '#C9A84C' },
  filterText: { fontSize: 10, fontFamily: F.bold, color: '#9CA3AF', letterSpacing: 0.5 },
  filterTextActive: { color: '#0B0D12' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 16 },
  emptyText: { fontSize: 14, fontFamily: F.bold, color: '#6B7280', letterSpacing: 1 },
});
