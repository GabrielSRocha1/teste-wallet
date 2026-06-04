import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import { getTokenMeta } from '@/src/config/tokens';

const GECKO_BASE = 'https://www.geckoterminal.com';
const GECKO_API = 'https://api.geckoterminal.com/api/v2';
// 60s evita estourar o free tier do GeckoTerminal (30 req/min) — o pool não
// muda na prática, então um cache local agressivo é seguro.
const POOL_CACHE_TTL_MS = 60_000;

// ── Polling de preço local (Opção 2) ─────────────────────────────────────
// SettingsContext faz polling global de 15s pra todos os tokens. Aqui, na tela
// do gráfico, focamos em 1 token só e usamos a fonte mais barata por tipo:
//   Majors (Binance):  3s — limite 1200 weight/min, sobra de 25×
//   Internos (DexScr): 5s — limite 300 req/min, sobra de 24×
//   Stables:           sem polling, valor fixo
const MAJORS_POLL_MS = 3_000;
const INTERNAL_POLL_MS = 5_000;

const MAJORS_BINANCE_SYMBOL: Record<string, string> = {
  SOL: 'SOLUSDT',
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
};
const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'DAI']);

async function fetchBinancePrice(binanceSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const p = parseFloat(json?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchDexScreenerPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!res.ok) return null;
    const json = await res.json();
    const pairs: any[] = json?.pairs ?? [];
    if (pairs.length === 0) return null;
    // Pega o pool com maior liquidez (evita preços travados de pares mortos).
    const best = pairs.reduce(
      (acc, p) =>
        (p?.liquidity?.usd ?? 0) > (acc?.liquidity?.usd ?? 0) ? p : acc,
      pairs[0],
    );
    const p = parseFloat(best?.priceUsd ?? '0');
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

// Ícones locais: o tokens.ts não tem iconUrl pro BDC, então fallback puxava
// só a letra "B". Aqui consolidamos os ícones internos/canônicos. Quando o
// registry ganhar iconUrl pra esses tokens, esta tabela vira fallback puro.
const TOKEN_IMAGES: Record<string, any> = {
  SOL: { uri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
  USDT: { uri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png' },
  USDC: { uri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png' },
  BDC: require('../public/BDC.png'),
  ESCT: { uri: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q' },
  BRT: { uri: 'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q' },
};

function truncateMint(mint: string) {
  if (!mint) return '—';
  return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

interface PoolInfo {
  pool: string;
  priceUsd: number;
  fetchedAt: number;
}

async function resolvePool(mint: string): Promise<PoolInfo | null> {
  const cacheKey = `gt:pool:${mint}`;
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached: PoolInfo = JSON.parse(raw);
      if (Date.now() - cached.fetchedAt < POOL_CACHE_TTL_MS) return cached;
    }
  } catch {}

  try {
    const res = await fetch(`${GECKO_API}/networks/solana/tokens/${mint}/pools?page=1`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) {
      // Sem pool fresco mas com cache stale → ainda é melhor que nada
      const stale = await AsyncStorage.getItem(cacheKey);
      return stale ? JSON.parse(stale) : null;
    }
    if (!res.ok) return null;
    const json = await res.json();
    const first = json?.data?.[0]?.attributes;
    if (!first?.address) return null;
    const info: PoolInfo = {
      pool: first.address,
      priceUsd: parseFloat(first.base_token_price_usd ?? first.token_price_usd ?? '0') || 0,
      fetchedAt: Date.now(),
    };
    AsyncStorage.setItem(cacheKey, JSON.stringify(info)).catch(() => {});
    return info;
  } catch {
    return null;
  }
}

export default function GraficoTokenScreen() {
  const insets = useSafeAreaInsets();
  const { coin } = useLocalSearchParams<{ coin?: string }>();
  const { t, prices, network } = useSettings();

  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [isResolvingPool, setIsResolvingPool] = useState(true);
  const [localPrice, setLocalPrice] = useState<number>(0);
  const webviewRef = useRef<WebView>(null);

  const symbol = (coin?.toUpperCase() || 'SOL');
  // Gráfico sempre aponta pra mainnet (GeckoTerminal não cobre devnet).
  const meta = useMemo(() => getTokenMeta(symbol, 'mainnet'), [symbol]);

  // Preço: prioridade pro polling local rápido (Binance 3s ou DexScreener 5s),
  // senão o do SettingsContext (15s), senão o que veio do pool no boot.
  const ctxPrice = prices[symbol]?.USD ?? 0;
  const priceUsd = localPrice > 0
    ? localPrice
    : (ctxPrice > 0 ? ctxPrice : (poolInfo?.priceUsd ?? 0));
  const priceFormatted = priceUsd > 0
    ? `$${priceUsd.toFixed(priceUsd > 1 ? 2 : 6)}`
    : '—';

  // Polling local de preço: pausa quando a tela sai de foco (useFocusEffect)
  // pra não queimar bateria/quota se o usuário navegar pra outra screen e a
  // route-stack mantiver esta montada.
  useFocusEffect(
    useCallback(() => {
      if (!symbol) return;

      // Stables ficam fixas em $1 — não vale gastar request.
      if (STABLES.has(symbol)) {
        setLocalPrice(1);
        return;
      }

      const isMajor = symbol in MAJORS_BINANCE_SYMBOL;
      const intervalMs = isMajor ? MAJORS_POLL_MS : INTERNAL_POLL_MS;

      // Sem mint pra DexScreener? Não consegue puxar preço de token interno.
      if (!isMajor && !meta?.mint) return;

      let cancelled = false;

      const tick = async () => {
        const next = isMajor
          ? await fetchBinancePrice(MAJORS_BINANCE_SYMBOL[symbol])
          : await fetchDexScreenerPrice(meta!.mint);
        if (cancelled) return;
        if (next && next > 0) setLocalPrice(next);
      };

      void tick(); // dispara imediato, sem esperar 1 intervalo
      const id = setInterval(tick, intervalMs);

      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }, [symbol, meta?.mint]),
  );

  const iconSource = TOKEN_IMAGES[symbol] ?? (meta?.iconUrl ? { uri: meta.iconUrl } : null);

  // Resolve pool via API (cacheado em AsyncStorage). Sem o pool, o embed em
  // /tokens/{mint} redireciona via 307 e o WebView às vezes não segue —
  // resultado: tela em branco silenciosa.
  useEffect(() => {
    if (!meta?.mint) {
      setIsResolvingPool(false);
      return;
    }
    let cancelled = false;
    setIsResolvingPool(true);
    setIsChartLoading(true);
    setChartError(null);
    setLocalPrice(0); // evita exibir o preço de um token anterior por 1 frame
    resolvePool(meta.mint).then((info) => {
      if (cancelled) return;
      setPoolInfo(info);
      setIsResolvingPool(false);
      if (!info) setIsChartLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [meta?.mint]);

  // URL direta de pool (não passa pelo 307 redirect). Parâmetros documentados
  // no embed oficial do GeckoTerminal: embed=1, info=0, swaps=0.
  const chartUrl = useMemo(() => {
    if (!poolInfo?.pool) return null;
    const params = new URLSearchParams({
      embed: '1',
      info: '0',
      swaps: '0',
      grayscale: '0',
      light_chart: '0',
      chart_type: 'price',
      resolution: '1h',
    });
    return `${GECKO_BASE}/solana/pools/${poolInfo.pool}?${params.toString()}`;
  }, [poolInfo?.pool]);

  const handleCopyMint = async () => {
    if (!meta?.mint) return;
    await Clipboard.setStringAsync(meta.mint);
    Alert.alert('', t('Endereço da moeda copiado!'));
  };

  const handleOpenExternal = () => {
    if (!meta?.mint) return;
    const url = poolInfo?.pool
      ? `${GECKO_BASE}/solana/pools/${poolInfo.pool}`
      : `${GECKO_BASE}/solana/tokens/${meta.mint}`;
    Alert.alert(
      t('Abrir no GeckoTerminal'),
      url,
      [
        { text: t('Copiar link'), onPress: () => Clipboard.setStringAsync(url) },
        { text: 'OK' },
      ],
    );
  };

  const showPlaceholder = !isResolvingPool && !chartUrl;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header
        onBackPress={() => router.back()}
        onMenuPress={() => setSidebarVisible(true)}
      />

      <View style={styles.body}>
        <View style={styles.tokenHeader}>
          <View style={styles.iconWrap}>
            {iconSource ? (
              <Image source={iconSource} style={styles.icon} />
            ) : (
              <Text style={styles.iconFallback}>{symbol[0]}</Text>
            )}
          </View>
          <View style={styles.tokenMeta}>
            <Text style={styles.tokenName}>{meta?.name ?? symbol}</Text>
            <Text style={styles.tokenSymbol}>{symbol}</Text>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.priceLabel}>{t('PREÇO')}</Text>
            <Text style={styles.priceValue}>{priceFormatted}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.mintRow} onPress={handleCopyMint} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.mintLabel}>{t('ID DA MOEDA (MINT)')}</Text>
            <Text style={styles.mintValue} numberOfLines={1}>
              {meta?.mint ? truncateMint(meta.mint) : '—'}
            </Text>
          </View>
          <Feather name="copy" size={16} color={V.gold} />
        </TouchableOpacity>

        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>{t('MOVIMENTAÇÃO DO TOKEN')}</Text>
            <TouchableOpacity onPress={handleOpenExternal}>
              <Feather name="external-link" size={14} color={V.gold} />
            </TouchableOpacity>
          </View>

          {showPlaceholder ? (
            <View style={styles.placeholder}>
              <Feather
                name={meta?.internal ? 'clock' : 'bar-chart-2'}
                size={36}
                color={V.muted}
              />
              {network === 'devnet' ? (
                <Text style={styles.placeholderText}>
                  {t('Gráficos não estão disponíveis na devnet.')}
                </Text>
              ) : meta?.internal ? (
                <>
                  <Text style={styles.placeholderTitle}>
                    {t('Aguardando liquidez na blockchain')}
                  </Text>
                  <Text style={styles.placeholderText}>
                    {meta?.name || symbol} ({symbol}){' '}
                    {t('é um token interno da Verum e ainda não tem negociação ativa na blockchain. O gráfico e o preço aparecerão automaticamente quando houver pool de liquidez.')}
                  </Text>
                </>
              ) : (
                <Text style={styles.placeholderText}>
                  {t('Este token ainda não tem liquidez disponível na blockchain.')}
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.webviewWrap}>
              {chartUrl && (
                <WebView
                  ref={webviewRef}
                  source={{ uri: chartUrl }}
                  style={styles.webview}
                  onLoadStart={() => setIsChartLoading(true)}
                  onLoadEnd={() => setIsChartLoading(false)}
                  onError={(e) => {
                    setIsChartLoading(false);
                    setChartError(e.nativeEvent?.description || 'erro');
                  }}
                  javaScriptEnabled
                  domStorageEnabled
                  startInLoadingState={false}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction
                  // Alguns servidores recusam UAs móveis padrão de WebView —
                  // este UA é amplamente aceito e evita "browser não suportado".
                  userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                />
              )}
              {(isResolvingPool || isChartLoading) && !chartError && (
                <View style={styles.loader}>
                  <ActivityIndicator size="large" color={V.gold} />
                  <Text style={styles.loaderText}>
                    {isResolvingPool ? t('Buscando par...') : t('Carregando gráfico...')}
                  </Text>
                </View>
              )}
              {chartError && (
                <View style={styles.loader}>
                  <Feather name="wifi-off" size={28} color={V.danger} />
                  <Text style={[styles.loaderText, { color: V.danger }]}>
                    {t('Não foi possível carregar o gráfico.')}
                  </Text>
                </View>
              )}
            </View>
          )}

          <Text style={styles.poweredBy}>
            {t('Dados fornecidos por')} GeckoTerminal
          </Text>
        </View>
      </View>

      <BottomNav activeRoute="index" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 110 },

  tokenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V.border,
    padding: 14,
    marginBottom: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  icon: { width: '100%', height: '100%' },
  iconFallback: { color: V.gold, fontFamily: F.bold, fontSize: 18 },
  tokenMeta: { flex: 1 },
  tokenName: { fontSize: 16, fontFamily: F.bold, color: V.text },
  tokenSymbol: { fontSize: 12, fontFamily: F.body, color: V.gold, marginTop: 2, letterSpacing: 1 },
  priceBox: { alignItems: 'flex-end' },
  priceLabel: { fontSize: 9, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 4 },
  priceValue: { fontSize: 16, fontFamily: F.bold, color: V.gold },

  mintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: V.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  mintLabel: { fontSize: 9, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 4 },
  mintValue: { fontSize: 13, fontFamily: F.body, color: V.text },

  chartCard: {
    flex: 1,
    backgroundColor: V.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V.border,
    padding: 12,
    overflow: 'hidden',
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  chartTitle: { fontSize: 11, fontFamily: F.title, color: V.gold, letterSpacing: 1.5 },
  webviewWrap: { flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#0A0A0A' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.85)',
    gap: 12,
  },
  loaderText: { color: V.gold, fontFamily: F.semi, fontSize: 12, letterSpacing: 1 },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  placeholderTitle: {
    color: V.gold,
    fontFamily: F.title,
    fontSize: 13,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: 4,
  },
  placeholderText: { color: V.muted, fontFamily: F.body, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  poweredBy: {
    fontSize: 9,
    fontFamily: F.body,
    color: V.muted,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.5,
  },
});
