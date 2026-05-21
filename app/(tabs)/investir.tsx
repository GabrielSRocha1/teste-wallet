import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Image, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { V, F, PAD } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import { transactionService } from '@/src/services/transactionService';

export default function InvestirScreen() {
  const { t, prices: globalPrices } = useSettings();
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);

  // (CR1) Removido fetch direto a Helius DAS — vazava EXPO_PUBLIC_HELIUS_RPC_URL
  // (com API key inline) no bundle do client. Os ícones dos tokens internos
  // Verum (BDC/ESCT/BRT) são canônicos e gerenciados pela equipe, então hard-coded
  // aqui é a fonte de verdade — não precisamos consultar metadata on-chain a
  // cada montagem da tela.
  const [tokensData] = useState({
    BDC: { imageUrl: require('../../public/BDC.png'), symbol: 'BDC', name: 'BodeCoin', website: 'https://bodecoin.verumcrypto.com' },
    ESCT: { imageUrl: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q', symbol: 'ESCT', name: 'Escoteiros', website: 'https://escoteiro.verumcrypto.com' },
    BRT: { imageUrl: 'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q', symbol: 'BRT', name: 'Brutos', website: 'https://brutos.verumcrypto.com' }
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><MaterialCommunityIcons name="trending-up" size={48} color={V.gold} /></View>
          <Text style={styles.heroT}>{t('LIBERDADE FINANCEIRA')}</Text>
          <View style={styles.goldLine} />
          <Text style={styles.heroS}>{t('Invista nos ativos do ecossistema Verun Crypto e acelere seu crescimento patrimonial.')}</Text>
        </View>

        <View style={styles.list}>
          <CryptoCard data={{ ...tokensData.BDC, price: globalPrices.BDC?.USD || 0 }} color={V.gold} />
          <CryptoCard data={{ ...tokensData.ESCT, price: globalPrices.ESCT?.USD || 0 }} color={V.gold} />
          <CryptoCard data={{ ...tokensData.BRT, price: globalPrices.BRT?.USD || 0 }} color={V.gold} />
        </View>
      </ScrollView>

      <BottomNav activeRoute="investir" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} activeRoute="investir" />
    </View>
  );
}

function CryptoCard({ data, color }: any) {
  const { t, formatCurrency } = useSettings();
  
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.coinInfo}>
          <View style={styles.coinIconW}>
             <Image source={typeof data.imageUrl === 'string' ? { uri: data.imageUrl } : data.imageUrl} style={styles.coinImg} />
          </View>
          <View>
            <Text style={styles.coinN}>{data.name}</Text>
            <View style={styles.badge}><Text style={styles.badgeT}>{data.symbol}</Text></View>
          </View>
        </View>
        <View style={styles.priceInfo}>
          <Text style={styles.priceL}>{t('PREÇO ATUAL')}</Text>
          <Text style={styles.priceV}>{formatCurrency(data.price || 0, true)}</Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity 
          style={styles.outlineBtn} 
          onPress={() => data.website && Linking.openURL(data.website)}
        >
          <Feather name="globe" size={16} color={V.gold} />
          <Text style={styles.outlineBtnT}>{t('SITE OFICIAL')}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.investBtn} 
          onPress={() => router.push({ pathname: '/contratar-vesting', params: { crypto: data.symbol } } as any)}
        >
          <Feather name="trending-up" size={16} color={V.bg} />
          <Text style={styles.investBtnT}>{t('INVESTIR')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingBottom: 120 },
  hero: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, paddingBottom: 32 },
  heroIcon: { marginBottom: 16, width: 80, height: 80, borderRadius: 40, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border },
  heroT: { fontSize: 28, fontFamily: F.title, color: V.gold, textAlign: 'center', letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginVertical: 16 },
  heroS: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 22 },
  list: { paddingHorizontal: V.px, gap: 16 },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  coinInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coinIconW: { width: 48, height: 48, borderRadius: 24, backgroundColor: V.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border, overflow: 'hidden' },
  coinImg: { width: '100%', height: '100%' },
  coinN: { color: V.text, fontSize: 16, fontFamily: F.bold, marginBottom: 4 },
  badge: { backgroundColor: 'rgba(201,168,76,0.1)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', borderWidth: 0.5, borderColor: V.gold },
  badgeT: { fontSize: 10, fontFamily: F.bold, color: V.gold },
  priceInfo: { alignItems: 'flex-end' },
  priceL: { color: V.muted, fontSize: 9, fontFamily: F.bold, marginBottom: 4, letterSpacing: 1 },
  priceV: { color: V.success, fontSize: 16, fontFamily: F.title },
  cardActions: { flexDirection: 'row', gap: 10 },
  investBtn: { flex: 1.2, height: 48, backgroundColor: V.gold, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...V.shadow },
  investBtnT: { color: V.bg, fontSize: 12, fontFamily: F.bold, letterSpacing: 0.5 },
  outlineBtn: { flex: 1, height: 48, borderRadius: V.r8, borderWidth: 1, borderColor: V.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  outlineBtnT: { color: V.gold, fontSize: 12, fontFamily: F.bold, letterSpacing: 0.5 },
});
