import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  ScrollView, Modal, Image, Alert, Pressable, ActivityIndicator, TextInput,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import CurrencyConverter from '@/components/CurrencyConverter';
import { supabase } from '@/src/services/supabase';
import { getApiBaseUrl } from '@/src/services/apiUrl';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import { useSolanaWallet } from '@/src/hooks/useSolanaWallet';
import keyManager from '@/src/services/keyManager';

type CryptoToken = 'SOL' | 'USDT' | 'USDC' | 'BDC' | 'ESCT';

const TOKENS: { symbol: CryptoToken; name: string; color: string }[] = [
  { symbol: 'SOL',  name: 'Solana',        color: '#9945FF' },
  { symbol: 'USDT', name: 'Tether USD',    color: '#26A17B' },
  { symbol: 'USDC', name: 'USD Coin',      color: '#2775CA' },
  { symbol: 'BDC',  name: 'BDC Token',     color: V.gold   },
  { symbol: 'ESCT', name: 'ESCT Token',    color: '#F0D080' },
];

const API_URL = getApiBaseUrl();

export default function DepositarCryptoScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const { t } = useSettings();
  const solWallet = useSolanaWallet();

  // ── Endereço ────────────────────────────────────────────────────────────────
  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const [localCacheAddress, setLocalCacheAddress] = useState<string | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(true);

  // ── Formulário ───────────────────────────────────────────────────────────────
  const [selectedToken, setSelectedToken] = useState<CryptoToken>('USDT');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [isTokenModalVisible, setTokenModalVisible] = useState(false);

  // ── Fluxo ────────────────────────────────────────────────────────────────────
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccessModalVisible, setSuccessModalVisible] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      setLoadingAddress(true);
      const cached = await keyManager.getStoredAddress();
      setLocalCacheAddress(cached);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('usuarios')
          .select('wallet_address')
          .eq('id', user.id)
          .maybeSingle();
        if (data?.wallet_address) {
          setProfileAddress(data.wallet_address);
          if (!cached) await keyManager.setStoredAddress(data.wallet_address);
        }
      }
      setLoadingAddress(false);
    };
    init();
  }, []);

  // Prioridade: hook ativo > cache local > perfil DB
  const address = solWallet.publicKey || localCacheAddress || profileAddress || '';

  const copyToClipboard = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    Alert.alert(t('SUCESSO'), t('Endereço copiado!'));
  };

  const selectedTokenInfo = TOKENS.find(tk => tk.symbol === selectedToken)!;

  // ── Confirmar pagamento ──────────────────────────────────────────────────────
  const handleConfirmPayment = async () => {
    const amount = parseFloat(expectedAmount.replace(',', '.'));
    if (!amount || amount <= 0) {
      Alert.alert(t('ERRO'), t('Informe o valor esperado de recebimento.'));
      return;
    }
    if (!address) {
      Alert.alert(t('ERRO'), t('Wallet não encontrada. Reconecte sua carteira.'));
      return;
    }

    setIsConfirming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(t('Usuário não autenticado.'));

      const response = await fetch(`${API_URL}/api/deposit/crypto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token: selectedToken, expectedAmount: amount }),
      });

      const json = await response.json();

      if (!response.ok) {
        const msg = json?.error?.message || t('Erro ao registrar depósito.');
        throw new Error(msg);
      }

      setOrderId(json.orderId);
      setSuccessModalVisible(true);
    } catch (e: any) {
      Alert.alert(t('ERRO'), e.message || t('Erro ao registrar depósito. Tente novamente.'));
    } finally {
      setIsConfirming(false);
    }
  };

  if (loadingAddress) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: V.bg }}>
        <ActivityIndicator size="large" color={V.gold} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
          <Text style={styles.title}>{t('RECEBER ATIVOS')}</Text>
          <View style={styles.goldLine} />
          <Text style={styles.subtitle}>
            {t('Todo o recebimento na rede Solana (SPL) para qualquer ativo (USDT, USDC, BDC, ESCT, SOL).')}
          </Text>
        </View>

        <CurrencyConverter initialUSD={1} />

        {/* ── Card: QR Code + Endereço ─────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('SUA CHAVE PÚBLICA SOLANA (SPL)')}</Text>

          {address ? (
            <>
              <View style={styles.qrBox}>
                <View style={[styles.qrInner, { backgroundColor: '#fff' }]}>
                  <Image
                    source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${address}&bgcolor=ffffff&color=000000` }}
                    style={styles.qrImage}
                  />
                </View>
              </View>

              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>{t('Aguardando transação...')}</Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>{t('ENDEREÇO PÚBLICO')}</Text>
                <View style={styles.addressBox}>
                  <Text style={styles.addressText} numberOfLines={1} ellipsizeMode="middle">{address}</Text>
                  <TouchableOpacity style={styles.copyBtn} onPress={copyToClipboard}>
                    <Feather name="copy" size={20} color={V.bg} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.warning}>
                <Feather name="alert-triangle" size={16} color={V.danger} />
                <Text style={styles.warningText}>
                  {t('Envie apenas ativos na rede Solana (SPL) para este endereço. Outros ativos serão perdidos permanentemente.')}
                </Text>
              </View>


            </>
          ) : (
            <ActivityIndicator size="small" color={V.gold} style={{ marginVertical: 20 }} />
          )}
        </View>
      </ScrollView>

      <BottomNav activeRoute="none" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />

      {/* ── Modal: seleção de token ──────────────────────────────────────── */}
      <Modal visible={isTokenModalVisible} transparent animationType="fade">
        <Pressable style={styles.mOverlay} onPress={() => setTokenModalVisible(false)}>
          <View style={styles.mContentWrapper}>
            <View style={styles.mContent}>
              <View style={styles.mHandle} />
              <View style={styles.mHeader}>
                <Text style={styles.mTitle}>{t('SELECIONAR TOKEN')}</Text>
                <TouchableOpacity onPress={() => setTokenModalVisible(false)}>
                  <Feather name="x" size={20} color={V.muted} />
                </TouchableOpacity>
              </View>
              <View style={styles.list}>
                {TOKENS.map(tk => (
                  <TouchableOpacity
                    key={tk.symbol}
                    style={[styles.item, selectedToken === tk.symbol && styles.itemActive]}
                    onPress={() => { setSelectedToken(tk.symbol); setTokenModalVisible(false); }}
                  >
                    <View style={styles.itemLeft}>
                      <View style={[styles.badge, { backgroundColor: tk.color }]}>
                        <Text style={styles.badgeText}>{tk.symbol.slice(0, 3)}</Text>
                      </View>
                      <View>
                        <Text style={styles.itemName}>{tk.symbol}</Text>
                        <Text style={[styles.label, { marginBottom: 0, marginLeft: 0 }]}>{tk.name}</Text>
                      </View>
                    </View>
                    {selectedToken === tk.symbol && <Feather name="check" size={18} color={V.gold} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Modal: sucesso ───────────────────────────────────────────────── */}
      <Modal visible={isSuccessModalVisible} transparent animationType="fade">
        <Pressable style={styles.mOverlay} onPress={() => { setSuccessModalVisible(false); router.back(); }}>
          <View style={styles.mContentWrapper}>
            <View style={[styles.mContent, { alignItems: 'center', paddingVertical: 32 }]}>
              <View style={styles.successIcon}>
                <Feather name="check-circle" size={36} color={V.success} />
              </View>
              <Text style={[styles.mTitle, { color: V.success, marginBottom: 8 }]}>
                {t('DEPÓSITO REGISTRADO!')}
              </Text>
              <Text style={[styles.successSub]}>
                {t('Seu pedido foi salvo. Assim que o {token} chegar na sua carteira, ele será creditado automaticamente.', { token: selectedToken })}
              </Text>
              {orderId && (
                <View style={styles.orderIdBox}>
                  <Text style={styles.label}>{t('ID DO PEDIDO')}</Text>
                  <Text style={styles.orderIdText}>{orderId}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.mainBtn, { marginTop: 24, width: '100%', justifyContent: 'center' }]}
                onPress={() => { setSuccessModalVisible(false); router.back(); }}
              >
                <Feather name="arrow-left" size={18} color={V.bg} />
                <Text style={styles.mainBtnText}>{t('VOLTAR AO INÍCIO')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 120 },

  titleBox: { marginTop: 24, marginBottom: 24 },
  title: { fontSize: 26, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 50, height: 2, backgroundColor: V.gold, marginTop: 10, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  card: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 20,
    borderWidth: 1,
    borderColor: V.border,
    ...V.shadow,
  },
  cardTitle: { fontSize: 14, fontFamily: F.title, color: V.gold, marginBottom: 20, letterSpacing: 1 },

  formGroup: { marginBottom: 20 },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },

  selectBtn: {
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
    borderRadius: V.r8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tokenDot: { width: 10, height: 10, borderRadius: 5 },
  selectText: { color: V.text, fontSize: 15, fontFamily: F.bold },
  tokenName: { color: V.muted, fontSize: 12, fontFamily: F.body },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    paddingHorizontal: 16,
  },
  inputSuffix: { fontSize: 13, fontFamily: F.bold, color: V.muted, marginRight: 10 },
  input: { flex: 1, paddingVertical: 14, color: V.gold, fontSize: 18, fontFamily: F.bold },
  inputHint: { fontSize: 10, fontFamily: F.body, color: V.muted, marginTop: 6, marginLeft: 4 },

  qrBox: { alignItems: 'center', marginBottom: 20 },
  qrInner: { padding: 12, borderRadius: 16, borderWidth: 1, borderColor: V.border },
  qrImage: { width: 180, height: 180 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: V.success },
  statusText: { color: V.success, fontSize: 12, fontFamily: F.bold, letterSpacing: 1 },

  addressBox: { flexDirection: 'row', gap: 10 },
  addressText: {
    flex: 1, color: V.text, fontSize: 12, fontFamily: F.body,
    backgroundColor: V.surface2, padding: 14, borderRadius: V.r8,
    borderWidth: 1, borderColor: V.border,
  },
  copyBtn: { width: 48, backgroundColor: V.gold, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center' },

  warning: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: V.r8,
    backgroundColor: 'rgba(231,76,60,0.05)',
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.1)',
    marginBottom: 20,
  },
  warningText: { color: V.danger, fontSize: 12, fontFamily: F.body, flex: 1, lineHeight: 18 },

  mainBtn: {
    backgroundColor: V.gold, height: 56, borderRadius: V.r8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    ...V.shadow,
  },
  mainBtnText: { color: V.bg, fontFamily: F.bold, fontSize: 14, letterSpacing: 1 },

  // Modal
  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end', alignItems: 'center' },
  mContentWrapper: { width: '100%', maxWidth: 650, minWidth: 320, alignSelf: 'center' },
  mContent: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderWidth: 1, borderColor: V.border,
  },
  mHandle: { width: 36, height: 4, backgroundColor: V.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  mTitle: { fontSize: 16, fontFamily: F.title, color: V.gold, letterSpacing: 1.5 },

  list: { gap: 12 },
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderRadius: V.r8, backgroundColor: V.surface2,
    borderWidth: 1, borderColor: V.border,
  },
  itemActive: { borderColor: V.gold, backgroundColor: 'rgba(201,168,76,0.05)' },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 40, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: V.bg, fontSize: 10, fontFamily: F.bold },
  itemName: { color: V.text, fontSize: 15, fontFamily: F.semi },

  // Sucesso
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(46,204,113,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  successSub: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  orderIdBox: { marginTop: 16, backgroundColor: V.surface2, borderRadius: V.r8, padding: 12, width: '100%' },
  orderIdText: { color: V.muted, fontSize: 11, fontFamily: F.body },
});
