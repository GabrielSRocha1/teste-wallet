/**
 * DApp Hub — Explorador de dApps Solana com a Verum Wallet.
 *
 * Lista categorizada de dApps populares do ecossistema Solana.
 * Cada item abre o dapp-browser.tsx com injeção do Verum Provider.
 * Inclui barra de URL para navegação manual.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { V, F }  from '@/constants/theme';
import { connectionService, ConnectedSession } from '@/src/services/connectionService';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface DApp {
  name:        string;
  url:         string;
  icon:        string;        // Feather icon name
  description: string;
  category:    DAppCategory;
  tags?:       string[];
}

type DAppCategory = 'defi' | 'nft' | 'tools' | 'social' | 'gaming' | 'bridge' | 'verum';

const CATEGORY_META: Record<DAppCategory, { label: string; icon: string; color: string }> = {
  verum:  { label: 'Verum',       icon: 'star',        color: '#C9A84C' },
  defi:   { label: 'DeFi',        icon: 'dollar-sign', color: '#2ECC71' },
  nft:    { label: 'NFT',         icon: 'image',       color: '#8B5CF6' },
  tools:  { label: 'Ferramentas', icon: 'tool',        color: '#3B82F6' },
  social: { label: 'Social',      icon: 'users',       color: '#EC4899' },
  gaming: { label: 'Games',       icon: 'play',        color: '#F59E0B' },
  bridge: { label: 'Bridge',      icon: 'git-merge',   color: '#06B6D4' },
};

// ─── dApps Populares do ecossistema Solana ───────────────────────────────────

const POPULAR_DAPPS: DApp[] = [
  // Verum Ecosystem
  {
    name: 'BodeCoin Vesting',
    url: 'https://bodecoin.verumcrypto.com',
    icon: 'trending-up',
    description: 'Portal de vesting do BodeCoin (BDC)',
    category: 'verum',
    tags: ['vesting', 'bdc', 'verum'],
  },
  {
    name: 'Escoteiros Vesting',
    url: 'https://escoteiro.verumcrypto.com',
    icon: 'trending-up',
    description: 'Portal de vesting do Escoteiros (ESCT)',
    category: 'verum',
    tags: ['vesting', 'esct', 'verum'],
  },
  {
    name: 'Brutos Vesting',
    url: 'https://brutos.verumcrypto.com',
    icon: 'trending-up',
    description: 'Portal de vesting do Brutos (BRT)',
    category: 'verum',
    tags: ['vesting', 'brt', 'verum'],
  },
  {
    name: 'Verum Crypto',
    url: 'https://vesting.verumcrypto.com',
    icon: 'shield',
    description: 'Ecossistema oficial Verum Crypto',
    category: 'verum',
    tags: ['verum', 'ecosystem'],
  },

  // DeFi
  {
    name: 'Jupiter',
    url: 'https://jup.ag',
    icon: 'zap',
    description: 'Agregador de swap #1 da Solana',
    category: 'defi',
    tags: ['swap', 'dex', 'aggregator'],
  },
  {
    name: 'Raydium',
    url: 'https://raydium.io/swap',
    icon: 'droplet',
    description: 'AMM e plataforma de liquidez',
    category: 'defi',
    tags: ['amm', 'liquidity', 'farming'],
  },
  {
    name: 'Orca',
    url: 'https://www.orca.so',
    icon: 'anchor',
    description: 'DEX com pools concentrados',
    category: 'defi',
    tags: ['swap', 'dex', 'clmm'],
  },
  {
    name: 'Marinade',
    url: 'https://marinade.finance',
    icon: 'sunrise',
    description: 'Staking líquido de SOL',
    category: 'defi',
    tags: ['staking', 'msol'],
  },
  {
    name: 'Drift',
    url: 'https://app.drift.trade',
    icon: 'trending-up',
    description: 'Perps e margem descentralizado',
    category: 'defi',
    tags: ['perpetuals', 'trading'],
  },
  {
    name: 'Kamino',
    url: 'https://app.kamino.finance',
    icon: 'pie-chart',
    description: 'Gestão automatizada de liquidez',
    category: 'defi',
    tags: ['yield', 'lending'],
  },

  // NFT
  {
    name: 'Magic Eden',
    url: 'https://magiceden.io',
    icon: 'hexagon',
    description: 'Marketplace NFT #1 da Solana',
    category: 'nft',
    tags: ['marketplace', 'nft'],
  },
  {
    name: 'Tensor',
    url: 'https://www.tensor.trade',
    icon: 'grid',
    description: 'Trading avançado de NFTs',
    category: 'nft',
    tags: ['nft', 'trading', 'analytics'],
  },

  // Tools
  {
    name: 'Solscan',
    url: 'https://solscan.io',
    icon: 'search',
    description: 'Explorer de transações Solana',
    category: 'tools',
    tags: ['explorer', 'analytics'],
  },
  {
    name: 'Birdeye',
    url: 'https://birdeye.so',
    icon: 'eye',
    description: 'Analytics e charts de tokens',
    category: 'tools',
    tags: ['analytics', 'charts', 'price'],
  },
  {
    name: 'Phantom Swap',
    url: 'https://phantom.app/ul/swap',
    icon: 'repeat',
    description: 'Interface de swap rápido',
    category: 'tools',
    tags: ['swap'],
  },

  // Social
  {
    name: 'Dialect',
    url: 'https://dial.to',
    icon: 'message-circle',
    description: 'Messaging e Blinks on-chain',
    category: 'social',
    tags: ['messaging', 'blinks'],
  },

  // Bridge
  {
    name: 'Wormhole',
    url: 'https://wormhole.com/bridge',
    icon: 'git-merge',
    description: 'Bridge cross-chain',
    category: 'bridge',
    tags: ['bridge', 'crosschain'],
  },
  {
    name: 'Mayan',
    url: 'https://mayan.finance',
    icon: 'link-2',
    description: 'Bridge rápido e barato',
    category: 'bridge',
    tags: ['bridge', 'crosschain'],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeUrl(text: string): string {
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  return `https://${text}`;
}

// ─── Componentes ─────────────────────────────────────────────────────────────

function CategoryPill({ category, active, onPress }: {
  category: DAppCategory | 'all';
  active: boolean;
  onPress: () => void;
}) {
  const meta = category === 'all'
    ? { label: 'Todos', icon: 'compass', color: V.gold }
    : CATEGORY_META[category];

  return (
    <TouchableOpacity
      style={[pill.container, active && pill.active]}
      onPress={onPress}
    >
      <Feather name={meta.icon as any} size={14} color={active ? V.bg : meta.color} />
      <Text style={[pill.text, active && pill.textActive]}>{meta.label}</Text>
    </TouchableOpacity>
  );
}

function DAppCard({ dapp, onPress }: { dapp: DApp; onPress: () => void }) {
  const meta = CATEGORY_META[dapp.category];

  return (
    <TouchableOpacity style={card.container} onPress={onPress} activeOpacity={0.7}>
      <View style={[card.iconWrap, { backgroundColor: meta.color + '15', borderColor: meta.color + '30' }]}>
        <Feather name={dapp.icon as any} size={22} color={meta.color} />
      </View>
      <View style={card.info}>
        <Text style={card.name} numberOfLines={1}>{dapp.name}</Text>
        <Text style={card.desc} numberOfLines={1}>{dapp.description}</Text>
      </View>
      <View style={[card.badge, { borderColor: meta.color + '30' }]}>
        <Text style={[card.badgeText, { color: meta.color }]}>{meta.label}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={V.muted} />
    </TouchableOpacity>
  );
}

function RecentSessionCard({ session, onPress }: { session: ConnectedSession; onPress: () => void }) {
  return (
    <TouchableOpacity style={recent.container} onPress={onPress} activeOpacity={0.7}>
      <View style={recent.iconWrap}>
        {session.icon ? (
          <Image source={{ uri: session.icon }} style={recent.icon} />
        ) : (
          <Feather name="globe" size={18} color={V.gold} />
        )}
      </View>
      <Text style={recent.name} numberOfLines={1}>{session.name}</Text>
    </TouchableOpacity>
  );
}

// ─── Tela Principal ──────────────────────────────────────────────────────────

export default function DAppHubScreen() {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText]           = useState('');
  const [activeCategory, setActiveCategory]   = useState<DAppCategory | 'all'>('all');
  const [recentSessions, setRecentSessions]   = useState<ConnectedSession[]>([]);

  // Carrega sessões recentes
  useEffect(() => {
    connectionService.getSessions().then(sessions => {
      setRecentSessions(sessions.slice(0, 8));
    });
  }, []);

  // Filtro
  const filteredDapps = POPULAR_DAPPS.filter(dapp => {
    const matchesCategory = activeCategory === 'all' || dapp.category === activeCategory;
    const matchesSearch   = !searchText ||
      dapp.name.toLowerCase().includes(searchText.toLowerCase()) ||
      dapp.description.toLowerCase().includes(searchText.toLowerCase()) ||
      dapp.tags?.some(t => t.includes(searchText.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const openDApp = useCallback((url: string, name?: string) => {
    router.push({
      pathname: '/dapp-browser',
      params: {
        url: encodeURIComponent(url),
        name: name ? encodeURIComponent(name) : undefined,
      },
    } as any);
  }, []);

  const handleUrlSubmit = () => {
    const text = searchText.trim();
    if (isValidUrl(text)) {
      openDApp(normalizeUrl(text));
    }
  };

  const categories: (DAppCategory | 'all')[] = ['all', 'verum', 'defi', 'nft', 'tools', 'social', 'bridge'];

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      {/* ── Barra estilo browser ─────────────────────────────────────────── */}
      <View style={s.browserBar}>
        <TouchableOpacity style={s.navBtn} onPress={() => router.back()}>
          <Feather name="x" size={20} color={V.muted} />
        </TouchableOpacity>
        <View style={s.urlBar}>
          <Feather name="compass" size={14} color={V.muted} />
          <Text style={s.urlText}>Explorar dApps</Text>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Barra de pesquisa / URL ──────────────────────────────────────── */}
        <View style={s.searchWrap}>
          <View style={s.searchBar}>
            <Feather name="search" size={18} color={V.muted} />
            <TextInput
              style={s.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={handleUrlSubmit}
              placeholder="Pesquisar dApp ou digitar URL..."
              placeholderTextColor={V.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Feather name="x" size={18} color={V.muted} />
              </TouchableOpacity>
            )}
          </View>
          {isValidUrl(searchText) && (
            <TouchableOpacity style={s.goBtn} onPress={handleUrlSubmit}>
              <Feather name="arrow-right" size={18} color={V.bg} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Sessões recentes ─────────────────────────────────────────────── */}
        {recentSessions.length > 0 && !searchText && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>RECENTES</Text>
              <TouchableOpacity onPress={() => router.push('/connected-apps' as any)}>
                <Text style={s.sectionLink}>Ver todos</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.recentScroll}>
              {recentSessions.map(session => (
                <RecentSessionCard
                  key={session.id}
                  session={session}
                  onPress={() => openDApp(session.origin, session.name)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Categorias ──────────────────────────────────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categoryScroll}>
          {categories.map(cat => (
            <CategoryPill
              key={cat}
              category={cat}
              active={activeCategory === cat}
              onPress={() => setActiveCategory(cat)}
            />
          ))}
        </ScrollView>

        {/* ── Banner ──────────────────────────────────────────────────────── */}
        {!searchText && activeCategory === 'all' && (
          <LinearGradient
            colors={['#1A1500', '#0D0B00']}
            style={s.banner}
          >
            <View style={s.bannerContent}>
              <View style={s.bannerIconWrap}>
                <Feather name="shield" size={24} color={V.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.bannerTitle}>Navegação Segura</Text>
                <Text style={s.bannerDesc}>
                  Todos os dApps abrem com a Verum Wallet injetada automaticamente.
                  Suas chaves nunca saem do dispositivo.
                </Text>
              </View>
            </View>
          </LinearGradient>
        )}

        {/* ── Banner Verum ─────────────────────────────────────────────────── */}
        {!searchText && activeCategory === 'verum' && (
          <LinearGradient
            colors={['#1A1200', '#0D0900']}
            style={[s.banner, { borderColor: V.gold + '40' }]}
          >
            <View style={s.bannerContent}>
              <View style={[s.bannerIconWrap, { backgroundColor: V.gold + '20', borderColor: V.gold + '40' }]}>
                <Feather name="star" size={24} color={V.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.bannerTitle}>Ecossistema Verum</Text>
                <Text style={s.bannerDesc}>
                  Acesse os portais de vesting dos tokens Verum Crypto com sua carteira conectada automaticamente.
                </Text>
              </View>
            </View>
          </LinearGradient>
        )}

        {/* ── Lista de dApps ──────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>
            {activeCategory === 'all' ? 'POPULARES' : CATEGORY_META[activeCategory].label.toUpperCase()}
          </Text>
          {filteredDapps.length === 0 ? (
            <View style={s.emptySearch}>
              <Feather name="search" size={32} color={V.muted + '40'} />
              <Text style={s.emptySearchText}>Nenhum dApp encontrado</Text>
              {isValidUrl(searchText) && (
                <TouchableOpacity style={s.openUrlBtn} onPress={handleUrlSubmit}>
                  <Feather name="external-link" size={14} color={V.gold} />
                  <Text style={s.openUrlText}>Abrir como URL</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filteredDapps.map(dapp => (
              <DAppCard
                key={dapp.url}
                dapp={dapp}
                onPress={() => openDApp(dapp.url, dapp.name)}
              />
            ))
          )}
        </View>
      </ScrollView>

    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scroll:    { flex: 1 },

  // Browser bar
  browserBar: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 10,
    paddingVertical:   8,
    backgroundColor:   V.surface1,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  navBtn: {
    width:          36,
    height:         36,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   18,
  },
  urlBar: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    backgroundColor:   V.surface2,
    borderRadius:      V.r20,
    paddingHorizontal: 12,
    paddingVertical:   8,
    borderWidth:       1,
    borderColor:       V.border,
  },
  urlText: {
    flex:       1,
    color:      V.muted,
    fontFamily: F.body,
    fontSize:   13,
  },

  // Search
  searchWrap: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              8,
    paddingHorizontal: V.px,
    paddingTop:       16,
    paddingBottom:    12,
  },
  searchBar: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    gap:              10,
    backgroundColor:  V.surface2,
    borderRadius:     V.r12,
    paddingHorizontal: 14,
    paddingVertical:  12,
    borderWidth:      1,
    borderColor:      V.border,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    backgroundColor: 'transparent',
    minWidth: 0,
    color: V.text,
    fontSize: 16,
    fontFamily: F.bold,
    textAlign: 'left',
    padding: 0,
    outlineStyle: 'none' as any,
  },
  goBtn: {
    width:           42,
    height:          42,
    borderRadius:    21,
    backgroundColor: V.gold,
    alignItems:      'center',
    justifyContent:  'center',
  },

  // Sections
  section: {
    paddingHorizontal: V.px,
    marginTop:         16,
  },
  sectionHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   12,
  },
  sectionTitle: {
    fontFamily:    F.bold,
    fontSize:      11,
    color:         V.muted,
    letterSpacing: 1,
  },
  sectionLink: {
    fontFamily: F.semi,
    fontSize:   12,
    color:      V.gold,
  },

  // Recent scroll
  recentScroll: {
    marginBottom: 8,
  },

  // Category scroll
  categoryScroll: {
    paddingHorizontal: V.px,
    marginTop:         8,
  },

  // Banner
  banner: {
    marginHorizontal: V.px,
    marginTop:        16,
    borderRadius:     V.r12,
    borderWidth:      1,
    borderColor:      V.border,
    padding:          16,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           14,
  },
  bannerIconWrap: {
    width:           48,
    height:          48,
    borderRadius:    24,
    backgroundColor: V.gold + '15',
    borderWidth:     1,
    borderColor:     V.gold + '30',
    alignItems:      'center',
    justifyContent:  'center',
  },
  bannerTitle: {
    fontFamily:    F.bold,
    fontSize:      14,
    color:         V.text,
    marginBottom:  4,
    letterSpacing: 0.3,
  },
  bannerDesc: {
    fontFamily: F.body,
    fontSize:   12,
    color:      V.muted,
    lineHeight: 18,
  },

  // Empty
  emptySearch: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap:            10,
  },
  emptySearchText: {
    fontFamily: F.body,
    fontSize:   14,
    color:      V.muted,
  },
  openUrlBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    backgroundColor: V.gold + '15',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius:    V.r20,
    borderWidth:     1,
    borderColor:     V.gold + '30',
    marginTop:       4,
  },
  openUrlText: {
    fontFamily: F.semi,
    fontSize:   13,
    color:      V.gold,
  },
});

const pill = StyleSheet.create({
  container: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    paddingHorizontal: 14,
    paddingVertical:  8,
    borderRadius:     V.r20,
    backgroundColor:  V.surface2,
    borderWidth:      1,
    borderColor:      V.border,
    marginRight:      8,
  },
  active: {
    backgroundColor: V.gold,
    borderColor:     V.gold,
  },
  text: {
    fontFamily: F.semi,
    fontSize:   12,
    color:      V.text,
  },
  textActive: {
    color: V.bg,
  },
});

const card = StyleSheet.create({
  container: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              12,
    backgroundColor:  V.surface1,
    borderRadius:     V.r10,
    padding:          14,
    borderWidth:      1,
    borderColor:      V.border,
    marginBottom:     8,
  },
  iconWrap: {
    width:          44,
    height:         44,
    borderRadius:   12,
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    1,
  },
  input: { flex: 1, height: '100%', backgroundColor: 'transparent', color: V.text, fontFamily: F.semi, fontSize: 15, outlineStyle: 'none' as any },
  info: { flex: 1 },
  name: {
    fontFamily: F.bold,
    fontSize:   14,
    color:      V.text,
    marginBottom: 2,
  },
  desc: {
    fontFamily: F.body,
    fontSize:   12,
    color:      V.muted,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      V.r20,
    borderWidth:       1,
  },
  badgeText: {
    fontFamily:    F.bold,
    fontSize:      9,
    letterSpacing: 0.3,
  },
});

const recent = StyleSheet.create({
  container: {
    width:           80,
    alignItems:      'center',
    gap:             6,
    marginRight:     12,
  },
  iconWrap: {
    width:           52,
    height:          52,
    borderRadius:    16,
    backgroundColor: V.surface2,
    borderWidth:     1,
    borderColor:     V.border,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  icon: {
    width:  52,
    height: 52,
  },
  name: {
    fontFamily: F.semi,
    fontSize:   10,
    color:      V.muted,
    textAlign:  'center',
  },
});
