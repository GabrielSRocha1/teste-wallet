import BottomNav from '@/components/BottomNav';
import CurrencyConverter from '@/components/CurrencyConverter';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useSettings } from '@/constants/SettingsContext';
import { F, V } from '@/constants/theme';
import { usePrices } from '@/src/hooks/usePrices';
import { isKycApproved } from '@/src/services/kycService';
import { supabase } from '@/src/services/supabase';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { getApiBaseUrl } from '@/src/services/apiUrl';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { notify } from '@/src/utils/notify';

export default function DepositarPixScreen() {
  const scrollViewRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const { t, currency, setCurrency } = useSettings();
  const params = useLocalSearchParams();
  const rawParam = params.amount ? (params.amount as string).replace(/\./g, '').replace(',', '.') : '135.00';
  const initialAmount = parseFloat(rawParam) || 135;
  const isUSD = !!params.amount;

  const [amount, setAmount] = useState(isUSD ? (initialAmount * 5.2).toString() : initialAmount.toString());
  const [displayValue, setDisplayValue] = useState(initialAmount.toFixed(2));
  const [displaySymbol, setDisplaySymbol] = useState(isUSD ? '$' : 'R$');
  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'BRL' | 'PYG'>(isUSD ? 'USD' : 'BRL');
  const { prices, loading: rampLoading } = usePrices();
  const solPriceBRL = prices.SOL?.BRL || 456.28;

  const [isGenerated, setIsGenerated] = useState(false);
  const [isCurrencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'transfer'>('pix');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuccessModalVisible, setIsSuccessModalVisible] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  // PIX QR (gerado via API PicPay internamente)
  const [pixQrBase64, setPixQrBase64] = useState<string | null>(null);
  const [pixQrContent, setPixQrContent] = useState<string | null>(null);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);

  // KYC gate state
  const [kycChecked, setKycChecked] = useState(false);
  const [kycApproved, setKycApproved] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Verifica KYC no mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const approved = await isKycApproved(user.id);
        setKycApproved(approved);
      }
      setKycChecked(true);
    })();
  }, []);

  // Re-verifica KYC ao retornar do /kyc
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      const returning = appStateRef.current.match(/inactive|background/) && nextState === 'active';
      appStateRef.current = nextState;
      if (returning && kycChecked && !kycApproved) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const approved = await isKycApproved(user.id);
          setKycApproved(approved);
        }
      }
    });
    return () => sub.remove();
  }, [kycChecked, kycApproved]);

  const PAYMENT_METHODS = [
    { id: 'pix' as const, icon: 'zap' as const, label: 'PIX' },
    { id: 'transfer' as const, icon: 'arrow-right-circle' as const, label: t('Transferência') },
  ];

  const CURRENCIES = [
    { code: 'USD' as const, label: t('Dólar Americano'), symbol: '$', flag: 'https://flagcdn.com/w80/us.png', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    { code: 'PYG' as const, label: t('Guarani Paraguaio'), symbol: '₲', flag: 'https://flagcdn.com/w80/py.png', color: V.success, bg: 'rgba(46,204,113,0.08)' },
    { code: 'BRL' as const, label: t('Real Brasileiro'), symbol: 'R$', flag: 'https://flagcdn.com/w80/br.png', color: V.gold, bg: 'rgba(201,168,76,0.08)' },
  ];

  const currentCurrencyInfo = CURRENCIES.find(c => c.code === currency) || CURRENCIES[2];

  const calculateSOL = () => {
    const brlAmount = parseFloat(amount.replace(',', '.')) || 0;
    if (brlAmount <= 0 || solPriceBRL <= 0) return '0.000000';

    const MOONPAY_PIX_FEE = 0.02;
    const MOONPAY_MIN_FEE_BRL = 2.99;
    const NETWORK_FEE_SOL = 0.007;

    const percentageFee = brlAmount * MOONPAY_PIX_FEE;
    const finalBaseFee = Math.max(percentageFee, MOONPAY_MIN_FEE_BRL);
    const amountAfterBaseFee = brlAmount - finalBaseFee;

    if (amountAfterBaseFee <= 0) return '0.000000';

    let solAmount = amountAfterBaseFee / solPriceBRL;
    solAmount -= NETWORK_FEE_SOL;

    return solAmount > 0 ? solAmount.toFixed(6) : '0.000000';
  };

  // Gera QR PIX via API PicPay
  const handleGeneratePixPayment = async () => {
    const brlAmount = parseFloat(amount.replace(',', '.')) || 0;
    if (brlAmount < 35) {
      notify(t('ERRO'), t('Mínimo R$ 35,00'));
      return;
    }

    setIsGeneratingPix(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Usuário não autenticado.'));

      // (CR3) `cpf` vive em `kyc_profiles`, não em `usuarios`. Antes a query
      // pedia `cpf` em `usuarios` → Supabase tipava como SelectQueryError e
      // runtime devolvia null silenciosamente. Agora buscamos as duas tabelas
      // em paralelo e mesclamos os campos para o payload do PicPay.
      const [profileRes, kycRes] = await Promise.all([
        supabase
          .from('usuarios')
          .select('wallet_address, nome_completo, email, telefone')
          .eq('id', user.id)
          .single(),
        supabase
          .from('kyc_profiles')
          .select('cpf')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      const profile = profileRes.data;
      const kyc = kycRes.data;

      const newOrderId = `pix-${user.id}-${Date.now()}`;
      const solAmount = parseFloat(calculateSOL());

      const { error: dbError } = await supabase.from('deposit_orders').insert({
        id: newOrderId,
        user_id: user.id,
        wallet_address: profile?.wallet_address,
        amount_brl: brlAmount,
        amount_sol: solAmount,
        expected_usdt: solAmount,
        exchange_rate: solPriceBRL,
        provider: 'pix',
        status: 'pending',
        saga_step: 'PIX_CREATED',
        expires_at: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      });
      if (dbError) throw dbError;

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/picpay?action=create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: brlAmount,
          referenceId: newOrderId,
          buyer: {
            firstName: profile?.nome_completo?.split(' ')[0] || 'User',
            lastName: profile?.nome_completo?.split(' ').slice(1).join(' ') || 'Verum',
            // (CR3) CPF agora vem de `kyc_profiles`. Sem KYC concluído, o PicPay
            // recusa o pagamento — comportamento esperado/desejado.
            document: kyc?.cpf || '000.000.000-00',
            email: profile?.email || user.email,
            phone: profile?.telefone || '+55 11 99999-9999',
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[PIX] /api/picpay falhou', res.status, errText);
        throw new Error(`PIX ${res.status}: ${errText.slice(0, 200) || 'falha desconhecida'}`);
      }
      const data = await res.json();

      // (C6) Antes dependíamos do PNG base64 que o PicPay devolve no campo
      // `qrcode.base64`. Em alguns cenários (RN Web, base64 mal-formada) o
      // <Image source={{ uri }}> falhava silenciosamente e o usuário via
      // a tela do QR vazia. Agora geramos o QR localmente a partir do
      // `pixContent` (BR Code EMV padrão Pix) — fonte de verdade canônica —
      // e usamos o base64 da PicPay só como fallback se o content faltar.
      const pixContent: string | null = data.qrcode?.content ?? null;
      const remoteBase64: string | null = data.qrcode?.base64 ?? null;

      if (!pixContent && !remoteBase64) {
        console.error('[PIX] resposta sem qrcode', data);
        throw new Error(t('QR Code não retornado'));
      }

      let finalBase64 = remoteBase64;
      if (pixContent) {
        try {
          finalBase64 = await QRCode.toDataURL(pixContent, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (qrErr) {
          console.warn('[PIX] geração local falhou, usando base64 remota', qrErr);
        }
      }

      setPixQrBase64(finalBase64);
      setPixQrContent(pixContent);
      setOrderId(newOrderId);
      setIsGenerated(true);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e: any) {
      console.error('[PIX] handleGeneratePixPayment error', e);
      // Erros do Supabase (PostgrestError) trazem code/details/hint além de
      // message — incluímos para diagnosticar falhas de insert no deposit_orders.
      const detail = [e?.message, e?.details, e?.hint, e?.code && `(${e.code})`]
        .filter(Boolean)
        .join(' — ');
      notify(t('ERRO'), detail || 'Erro ao gerar PIX');
    } finally {
      setIsGeneratingPix(false);
    }
  };

  // Confirma pagamento para transferência bancária
  const handleConfirmPayment = async () => {
    if (paymentMethod === 'pix') {
      setIsSuccessModalVisible(true);
      return;
    }
    const brlAmount = parseFloat(amount.replace(',', '.')) || 0;
    if (brlAmount < 35) {
      notify(t('ERRO'), t('Mínimo R$ 35,00'));
      return;
    }
    setIsConfirming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Usuário não autenticado.'));

      const { data: profile } = await supabase
        .from('usuarios')
        .select('wallet_address')
        .eq('id', user.id)
        .single();

      const newOrderId = `transfer-${user.id}-${Date.now()}`;
      const solAmount = parseFloat(calculateSOL());

      const { error } = await supabase.from('deposit_orders').insert({
        id: newOrderId,
        user_id: user.id,
        wallet_address: profile?.wallet_address || null,
        amount_brl: brlAmount,
        amount_sol: solAmount,
        expected_usdt: solAmount,
        exchange_rate: solPriceBRL,
        provider: 'transfer',
        status: 'pending',
        saga_step: 'PIX_CREATED',
        expires_at: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      });

      if (error) throw new Error(error.message);

      setOrderId(newOrderId);
      setIsSuccessModalVisible(true);
    } catch (e: any) {
      notify(t('ERRO'), e.message || t('Erro ao registrar pedido. Tente novamente.'));
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('COMPRAR CRYPTO')}</Text>
              <View style={styles.goldLine} />
              <Text style={styles.subtitle}>{t('Converta BRL para SOL instantaneamente através do ecossistema Verum Crypto.')}</Text>
            </View>
            <TouchableOpacity
              style={[styles.currencyShortcut, { borderColor: currentCurrencyInfo.color, backgroundColor: currentCurrencyInfo.bg }]}
              onPress={() => setCurrencyModalVisible(true)}
            >
              <Image source={{ uri: currentCurrencyInfo.flag }} style={styles.shortcutFlag} />
              <Text style={[styles.shortcutSymbol, { color: currentCurrencyInfo.color }]}>{currentCurrencyInfo.symbol}</Text>
              <Feather name="chevron-down" size={12} color={currentCurrencyInfo.color} />
            </TouchableOpacity>
          </View>
        </View>

        <CurrencyConverter
          onBRLValueChange={setAmount}
          onCurrencyValueChange={(val, sym, cur) => {
            setDisplayValue(val);
            setDisplaySymbol(sym);
            setDisplayCurrency(cur);
            if (cur === 'BRL') setAmount(val.replace(/\./g, '').replace(',', '.'));
          }}
          initialBRL={isUSD ? undefined : initialAmount}
          initialUSD={isUSD ? initialAmount : undefined}
        />

        {/* KYC Loading */}
        {!kycChecked && (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 40 }]}>
            <ActivityIndicator size="large" color={V.gold} />
            <Text style={[styles.label, { marginTop: 16 }]}>{t('VERIFICANDO CADASTRO...')}</Text>
          </View>
        )}

        {/* KYC Gate — usuário sem verificação */}
        {kycChecked && !kycApproved && (
          <View style={styles.card}>
            <View style={styles.kycBadge}>
              <Feather name="shield" size={13} color={V.gold} />
              <Text style={styles.kycBadgeText}>{t('VERIFICAÇÃO NECESSÁRIA')}</Text>
            </View>

            <View style={styles.kycIconWrap}>
              <Feather name="user-check" size={48} color={V.gold} />
            </View>

            <Text style={styles.kycTitle}>{t('Identidade não verificada')}</Text>
            <Text style={styles.kycSubtitle}>
              {t('Para comprar crypto via PIX ou Transferência Bancária, você precisa verificar sua identidade. O processo leva menos de 3 minutos.')}
            </Text>

            <View style={styles.kycSteps}>
              {[
                { icon: 'file-text',    text: t('Preencha seus dados pessoais') },
                { icon: 'camera',       text: t('Foto do documento de identidade') },
                { icon: 'check-circle', text: t('Verificação aprovada — compre crypto') },
              ].map((step, i) => (
                <View key={i} style={styles.kycStep}>
                  <View style={styles.kycStepIcon}>
                    <Feather name={step.icon as any} size={14} color={V.gold} />
                  </View>
                  <Text style={styles.kycStepText}>{step.text}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.mainBtn} onPress={() => router.push('/kyc' as any)}>
              <Feather name="shield" size={18} color={V.bg} />
              <Text style={styles.mainBtnT}>{t('VERIFICAR IDENTIDADE')}</Text>
            </TouchableOpacity>

            <View style={styles.kycPrivacy}>
              <Feather name="lock" size={12} color={V.muted} />
              <Text style={styles.kycPrivacyText}>
                {t('Seus dados são criptografados e usados exclusivamente para verificação de identidade (KYC).')}
              </Text>
            </View>
          </View>
        )}

        {/* Formulário de pagamento — só aparece com KYC aprovado */}
        {kycChecked && kycApproved && !isGenerated && (
          <View style={styles.card}>
            <Text style={styles.cardHeader}>{t('VALOR DO DEPÓSITO')}</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                {displayCurrency === 'USD' ? t('VALOR EM DÓLAR (USD)') : displayCurrency === 'PYG' ? t('VALOR EM GUARANI (PYG)') : t('VALOR EM REAIS (BRL)')}
              </Text>
              <View style={[
                styles.amountDisplay,
                displayCurrency === 'USD' && styles.amountDisplayUSD,
                displayCurrency === 'BRL' && styles.amountDisplayBRL,
                displayCurrency === 'PYG' && styles.amountDisplayPYG,
              ]}>
                <Text style={[
                  styles.amountSymbol,
                  displayCurrency === 'USD' && { color: '#60a5fa' },
                  displayCurrency === 'PYG' && { color: V.success },
                ]}>{displaySymbol}</Text>
                <Text style={[
                  styles.amountValue,
                  displayCurrency === 'USD' && { color: '#60a5fa' },
                  displayCurrency === 'PYG' && { color: V.success },
                ]}>{displayValue || '0,00'}</Text>
              </View>
              {(parseFloat(amount.replace(',', '.')) || 0) < 35 && (
                <Text style={{ color: '#ef4444', fontSize: 11, fontFamily: F.bold, marginTop: 8, marginLeft: 4 }}>
                  {t('* O valor mínimo do depósito é de R$ 35,00')}
                </Text>
              )}
            </View>

            <View style={styles.convBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.tIcon}><Text style={styles.tIconT}>◎</Text></View>
                <View>
                  <Text style={styles.convT}>{t('Você Receberá (aprox.)')}</Text>
                  {rampLoading && <ActivityIndicator size="small" color={V.gold} style={{ marginTop: 2 }} />}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.resV}>{calculateSOL()}</Text>
                <Text style={styles.resL}>SOL</Text>
                <Text style={[styles.resL, { fontSize: 10, opacity: 0.5 }]}>{t('1 SOL ≈ R$ {price}', { price: solPriceBRL.toFixed(2) })}</Text>
              </View>
            </View>

            <View style={styles.payGroup}>
              <Text style={styles.label}>{t('FORMA DE PAGAMENTO')}</Text>
              <View style={styles.payRow}>
                {PAYMENT_METHODS.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.payOption, paymentMethod === m.id && styles.payOptionActive]}
                    onPress={() => setPaymentMethod(m.id)}
                  >
                    <Feather name={m.icon} size={18} color={paymentMethod === m.id ? V.bg : V.muted} />
                    <Text style={[styles.payOptionLabel, paymentMethod === m.id && styles.payOptionLabelActive]}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.mainBtn, isGeneratingPix && { opacity: 0.7 }]}
              disabled={isGeneratingPix}
              onPress={async () => {
                const brlAmount = parseFloat(amount.replace(',', '.')) || 0;
                if (brlAmount < 35) {
                  notify(t('ERRO'), t('Mínimo R$ 35,00'));
                  return;
                }
                if (paymentMethod === 'pix') {
                  handleGeneratePixPayment();
                } else {
                  setIsGenerated(true);
                  setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
                }
              }}
            >
              {isGeneratingPix ? (
                <ActivityIndicator size="small" color={V.bg} />
              ) : (
                <Feather name={paymentMethod === 'pix' ? 'zap' : 'arrow-right-circle'} size={18} color={V.bg} />
              )}
              <Text style={styles.mainBtnT}>
                {isGeneratingPix
                  ? t('GERANDO...')
                  : paymentMethod === 'pix'
                    ? 'GERAR QR CODE PIX'
                    : t('VER DADOS DE TRANSFERÊNCIA')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pagamento gerado */}
        {kycChecked && kycApproved && isGenerated && (
          <View style={styles.card}>
            <Text style={styles.cardHeader}>{t('PAGAMENTO PENDENTE')}</Text>

            <View style={styles.alert}>
              <Feather name="info" size={18} color={V.gold} />
              <View style={{ flex: 1 }}>
                <Text style={styles.alertT}>{t('Pague R$ {amount} no seu App Bancário', { amount })}</Text>
                <Text style={styles.alertD}>{t('A conversão para SOL será processada automaticamente após a confirmação.')}</Text>
              </View>
            </View>

            {paymentMethod === 'pix' && pixQrBase64 ? (
              <View style={styles.qrBox}>
                <View style={styles.qrInner}>
                  <Image
                    source={{ uri: pixQrBase64 }}
                    style={styles.qrImg}
                    resizeMode="contain"
                    onError={(e) => console.warn('[PIX] Image render failed', e?.nativeEvent)}
                  />
                </View>
                <Text style={styles.qrL}>{t('Abra seu app bancário e escaneie o QR Code')}</Text>

                {pixQrContent && (
                  <TouchableOpacity
                    onPress={async () => {
                      await Clipboard.setStringAsync(pixQrContent);
                      notify('', t('Código PIX copiado!'));
                    }}
                    style={styles.pixCopyBox}
                    activeOpacity={0.75}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.pixCopyLabel}>{t('CÓDIGO COPIA E COLA')}</Text>
                      <Feather name="copy" size={14} color={V.gold} />
                    </View>
                    <Text style={styles.pixCopyContent} numberOfLines={3}>{pixQrContent}</Text>
                  </TouchableOpacity>
                )}

                <Text style={{ color: V.muted, fontSize: 10, marginTop: 8 }}>{t('Referência:')} {orderId}</Text>
              </View>
            ) : (
              <View style={styles.transferBox}>
                <Text style={[styles.label, { marginBottom: 16 }]}>{t('DADOS DA CONTA INTER')}</Text>

                <View style={styles.dataRow}>
                  <Text style={styles.dataLabel}>{t('Banco')}</Text>
                  <Text style={styles.dataValue}>077 - Inter</Text>
                </View>

                <View style={styles.dataRow}>
                  <Text style={styles.dataLabel}>{t('Agência')}</Text>
                  <Text style={styles.dataValue}>0001</Text>
                </View>

                <View style={styles.dataRow}>
                  <Text style={styles.dataLabel}>{t('Número de conta')}</Text>
                  <TouchableOpacity onPress={async () => { await Clipboard.setStringAsync('50980784-4'); notify('', 'Copiado!'); }}>
                    <Text style={[styles.dataValue, { color: V.gold }]}>50980784-4 <Feather name="copy" size={12} /></Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.dataRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.dataLabel}>{t('CNPJ')}</Text>
                  <TouchableOpacity onPress={async () => { await Clipboard.setStringAsync('61074321000125'); notify('', 'Copiado!'); }}>
                    <Text style={[styles.dataValue, { color: V.gold }]}>61.074.321/0001-25 <Feather name="copy" size={12} /></Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.mainBtn, isConfirming && { opacity: 0.7 }]}
              onPress={handleConfirmPayment}
              disabled={isConfirming}
            >
              {isConfirming
                ? <ActivityIndicator size="small" color={V.bg} />
                : <Feather name="check" size={18} color={V.bg} />
              }
              <Text style={styles.mainBtnT}>
                {isConfirming ? t('PROCESSANDO...') : t('CONFIRMAR PAGAMENTO')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backBtn} onPress={() => { setIsGenerated(false); setPixQrBase64(null); setPixQrContent(null); }}>
              <Text style={styles.backBtnT}>{t('VOLTAR / ALTERAR VALOR')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <BottomNav activeRoute="none" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />

      {/* Modal de sucesso */}
      <Modal visible={isSuccessModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => { setIsSuccessModalVisible(false); router.back(); }}>
          <View style={styles.modalSheetWrapper}>
            <View style={[styles.modalSheet, { alignItems: 'center', paddingVertical: 32 }]}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(46,204,113,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Feather name="check-circle" size={36} color={V.success} />
              </View>
              <Text style={[styles.modalTitle, { color: V.success }]}>{t('PEDIDO REGISTRADO!')}</Text>
              <Text style={[styles.modalSub, { textAlign: 'center', marginTop: 8, color: V.success }]}>
                {t('Após a confirmação do seu pagamento, o SOL será enviado para sua carteira.')}
              </Text>
              {orderId && (
                <View style={{ marginTop: 16, backgroundColor: V.surface2, borderRadius: 8, padding: 12, width: '100%' }}>
                  <Text style={[styles.label, { marginBottom: 4 }]}>{t('ID DO PEDIDO')}</Text>
                  <Text style={[styles.codeT, { fontSize: 11 }]}>{orderId}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.mainBtn, { marginTop: 24, width: '100%', justifyContent: 'center' }]}
                onPress={() => { setIsSuccessModalVisible(false); router.back(); }}
              >
                <Feather name="arrow-left" size={18} color={V.bg} />
                <Text style={styles.mainBtnT}>{t('VOLTAR AO INÍCIO')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Currency Quick Switch Modal */}
      <Modal visible={isCurrencyModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setCurrencyModalVisible(false)}>
          <View style={styles.modalSheetWrapper}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>{t('Moeda').toUpperCase()}</Text>
              <Text style={styles.modalSub}>{t('Escolha a moeda de depósito')}</Text>
              <View style={styles.modalOptions}>
                {CURRENCIES.map((cur) => (
                  <TouchableOpacity
                    key={cur.code}
                    style={[
                      styles.modalOption,
                      currency === cur.code && { borderColor: cur.color, backgroundColor: cur.bg },
                    ]}
                    onPress={() => { setCurrency(cur.code); setCurrencyModalVisible(false); }}
                  >
                    <Image source={{ uri: cur.flag }} style={styles.modalFlag} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalOptionLabel, currency === cur.code && { color: cur.color }]}>{cur.label}</Text>
                      <Text style={styles.modalOptionCode}>{cur.code}</Text>
                    </View>
                    <Text style={[styles.modalOptionSymbol, { color: currency === cur.code ? cur.color : V.muted }]}>{cur.symbol}</Text>
                    {currency === cur.code && <Feather name="check" size={16} color={cur.color} />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 110 },
  titleBox: { marginTop: 24, marginBottom: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 26, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 4, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  currencyShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: V.r8,
    borderWidth: 1.5,
    marginTop: 4,
  },
  shortcutFlag: { width: 22, height: 15, borderRadius: 2 },
  shortcutSymbol: { fontSize: 14, fontFamily: F.bold },

  // KYC Gate styles
  kycBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(201,168,76,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.3)',
    marginBottom: 24,
  },
  kycBadgeText: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  kycIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(201,168,76,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  kycTitle: { fontSize: 20, fontFamily: F.title, color: V.gold, letterSpacing: 1, textAlign: 'center', marginBottom: 10 },
  kycSubtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  kycSteps: { gap: 12, marginBottom: 28 },
  kycStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kycStepIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(201,168,76,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycStepText: { fontSize: 13, fontFamily: F.medium, color: V.text, flex: 1 },
  kycPrivacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    padding: 12,
    borderWidth: 1,
    borderColor: V.border,
  },
  kycPrivacyText: { flex: 1, fontSize: 11, fontFamily: F.body, color: V.muted, lineHeight: 17 },

  // Currency modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalSheetWrapper: {
    width: '100%',
    maxWidth: 650,
    minWidth: 320,
    alignSelf: 'center',
  },
  modalSheet: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: V.border,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: V.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 16, fontFamily: F.title, color: V.gold, letterSpacing: 1.5, marginBottom: 4 },
  modalSub: { fontSize: 12, fontFamily: F.body, color: V.muted, marginBottom: 20 },
  modalOptions: { gap: 12 },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: V.surface2, borderRadius: V.r12, padding: 16, borderWidth: 1, borderColor: V.border },
  modalFlag: { width: 32, height: 22, borderRadius: 4 },
  modalOptionLabel: { fontSize: 15, fontFamily: F.semi, color: V.text },
  modalOptionCode: { fontSize: 11, fontFamily: F.body, color: V.muted, marginTop: 2 },
  modalOptionSymbol: { fontSize: 18, fontFamily: F.bold, marginRight: 4 },

  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow, marginBottom: 16 },
  cardHeader: { fontSize: 12, fontFamily: F.title, color: V.gold, marginBottom: 24, letterSpacing: 1 },
  inputGroup: { marginBottom: 24 },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },

  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1.5,
    borderColor: V.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  amountDisplayBRL: { borderColor: V.gold, backgroundColor: 'rgba(201,168,76,0.06)' },
  amountDisplayUSD: { borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.06)' },
  amountDisplayPYG: { borderColor: V.success, backgroundColor: 'rgba(46,204,113,0.06)' },
  amountSymbol: { fontSize: 20, fontFamily: F.bold, color: V.gold },
  amountValue: { fontSize: 24, fontFamily: F.bold, color: V.gold, flex: 1 },

  convBox: { backgroundColor: 'rgba(201,168,76,0.05)', borderRadius: V.r12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(201,168,76,0.1)' },
  tIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: V.gold, alignItems: 'center', justifyContent: 'center' },
  tIconT: { color: V.bg, fontSize: 18, fontFamily: F.bold },
  convT: { fontSize: 13, fontFamily: F.bold, color: V.gold },
  resV: { fontSize: 22, fontFamily: F.title, color: V.text },
  resL: { fontSize: 10, fontFamily: F.bold, color: V.muted, marginTop: -4 },

  mainBtn: { backgroundColor: V.gold, height: 56, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...V.shadow },
  mainBtnT: { color: V.bg, fontSize: 14, fontFamily: F.bold, letterSpacing: 1 },

  payGroup: { marginBottom: 24 },
  payRow: { flexDirection: 'row', gap: 8 },
  payOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    backgroundColor: V.surface2,
  },
  payOptionActive: { backgroundColor: V.gold, borderColor: V.gold },
  payOptionLabel: { fontSize: 11, fontFamily: F.bold, color: V.muted, letterSpacing: 0.5 },
  payOptionLabelActive: { color: V.bg },

  alert: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: V.r8, backgroundColor: 'rgba(201,168,76,0.03)', borderWidth: 1, borderColor: V.border, marginBottom: 24 },
  alertT: { fontSize: 14, fontFamily: F.bold, color: V.gold },
  alertD: { fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 },

  qrBox: { alignItems: 'center', marginBottom: 24 },
  qrInner: { padding: 12, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: V.border },
  qrImg: { width: 220, height: 220 },
  qrL: { marginTop: 16, fontSize: 12, fontFamily: F.bold, color: V.muted, letterSpacing: 1, textAlign: 'center' },
  pixCopyBox: { width: '100%', backgroundColor: V.surface2, padding: 14, borderRadius: V.r8, marginTop: 14, borderWidth: 1, borderColor: V.border },
  pixCopyLabel: { color: V.gold, fontSize: 10, fontFamily: F.bold, letterSpacing: 1 },
  pixCopyContent: { color: V.text, fontSize: 11, fontFamily: F.body },

  codeT: { color: V.muted, fontSize: 11, fontFamily: F.body },
  backBtn: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  backBtnT: { color: V.muted, fontFamily: F.bold, fontSize: 10, letterSpacing: 1 },

  transferBox: { backgroundColor: V.surface2, padding: 20, borderRadius: V.r12, marginBottom: 24, borderWidth: 1, borderColor: V.border },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: V.surface1 },
  dataLabel: { fontSize: 13, fontFamily: F.body, color: V.muted },
  dataValue: { fontSize: 14, fontFamily: F.bold, color: V.text },
});
