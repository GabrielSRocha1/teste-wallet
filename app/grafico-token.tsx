import React, { useMemo, useState } from 'react';
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
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import { getTokenMeta, SOL_NATIVE_MINT } from '@/src/config/tokens';

const GECKO_BASE = 'https://www.geckoterminal.com';

function truncateMint(mint: string) {
  if (!mint) return '—';
  return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

export default function GraficoTokenScreen() {
  const insets = useSafeAreaInsets();
  const { coin } = useLocalSearchParams<{ coin?: string }>();
  const { t, prices, network } = useSettings();

  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);

  const symbol = (coin?.toUpperCase() || 'SOL');
  // O registry só tem mainnet pros tokens internos — gráfico sempre aponta pra
  // mainnet (GeckoTerminal não tem dados de devnet de qualquer forma).
  const meta = useMemo(() => getTokenMeta(symbol, 'mainnet'), [symbol]);

  const priceUsd = prices[symbol]?.USD ?? 0;
  const iconSource = meta?.iconUrl ? { uri: meta.iconUrl } : null;

  // GeckoTerminal embed: aceita /tokens/{mint} e escolhe o pool de maior
  // volume automaticamente. Parâmetros:
  //   embed=1        → modo widget (esconde header/footer GT)
  //   info=0         → esconde painel de tokenomics
  //   swaps=0        → esconde lista de swaps recentes
  //   grayscale=0    → cores reais
  //   light_chart=0  → força tema escuro (combina com #0A0A0A da Verum)
  //   chart_type=price  → linha de preço (alternativas: candlestick, depth)
  const chartUrl = useMemo(() => {
    if (!meta?.mint) return null;
    const params = new URLSearchParams({
      embed: '1',
      info: '0',
      swaps: '0',
      grayscale: '0',
      light_chart: '0',
      chart_type: 'price',
      resolution: '1h',
    });
    return `${GECKO_BASE}/solana/tokens/${meta.mint}?${params.toString()}`;
  }, [meta?.mint]);

  const handleCopyMint = async () => {
    if (!meta?.mint) return;
    await Clipboard.setStringAsync(meta.mint);
    Alert.alert('', t('Endereço da moeda copiado!'));
  };

  const handleOpenExternal = () => {
    if (!meta?.mint) return;
    // Abre o GeckoTerminal completo numa nova WebView interna não é necessário
    // — basta delegar pro browser do usuário via Linking, mas pra manter
    // simples e contextual, redirecionamos pra mesma URL sem embed.
    const url = `${GECKO_BASE}/solana/tokens/${meta.mint}`;
    Alert.alert(
      t('Abrir no GeckoTerminal'),
      url,
      [
        { text: t('Copiar link'), onPress: () => Clipboard.setStringAsync(url) },
        { text: 'OK' },
      ],
    );
  };

  const priceFormatted = priceUsd > 0
    ? `$${priceUsd.toFixed(priceUsd > 1 ? 2 : 6)}`
    : '—';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header
        onBackPress={() => router.back()}
        onMenuPress={() => setSidebarVisible(true)}
      />

      <View style={styles.body}>
        {/* Header do token */}
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

        {/* ID da moeda */}
        <TouchableOpacity style={styles.mintRow} onPress={handleCopyMint} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.mintLabel}>{t('ID DA MOEDA (MINT)')}</Text>
            <Text style={styles.mintValue} numberOfLines={1}>
              {meta?.mint ? truncateMint(meta.mint) : '—'}
            </Text>
          </View>
          <Feather name="copy" size={16} color={V.gold} />
        </TouchableOpacity>

        {/* Gráfico */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>{t('MOVIMENTAÇÃO DO TOKEN')}</Text>
            <TouchableOpacity onPress={handleOpenExternal}>
              <Feather name="external-link" size={14} color={V.gold} />
            </TouchableOpacity>
          </View>

          {!chartUrl ? (
            <View style={styles.placeholder}>
              <Feather name="bar-chart-2" size={36} color={V.muted} />
              <Text style={styles.placeholderText}>
                {t('Este token ainda não possui dados públicos no GeckoTerminal.')}
              </Text>
              {network === 'devnet' && (
                <Text style={styles.placeholderSub}>
                  {t('Gráficos não estão disponíveis na devnet.')}
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.webviewWrap}>
              <WebView
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
              />
              {isChartLoading && (
                <View style={styles.loader}>
                  <ActivityIndicator size="large" color={V.gold} />
                  <Text style={styles.loaderText}>{t('Carregando gráfico...')}</Text>
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

  // Header do token
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

  // ID da moeda (mint)
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

  // Gráfico
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
  placeholderText: { color: V.muted, fontFamily: F.body, fontSize: 13, textAlign: 'center' },
  placeholderSub: { color: V.muted, fontFamily: F.body, fontSize: 11, textAlign: 'center' },
  poweredBy: {
    fontSize: 9,
    fontFamily: F.body,
    color: V.muted,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.5,
  },
});
