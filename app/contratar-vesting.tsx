import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/src/services/supabase';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import CurrencyConverter from '@/components/CurrencyConverter';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

import * as LocalAuthentication from 'expo-local-authentication';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'qrcode';
import keyManager from '@/src/services/keyManager';
import transactionService, { VERUM_TREASURY_ADDRESS } from '@/src/services/transactionService';
import { getApiBaseUrl } from '@/src/services/apiUrl';
import { Keypair } from '@solana/web3.js';

const DURATION_MONTHS = 60;
const RELEASE_PERCENT = 20;
const RELEASE_INTERVALS = [12, 24, 36, 48, 60];
const ADMIN_FEE = '$0.50 ou 2.0% (Verum)';

// Ícones canônicos dos tokens internos Verum — mesma fonte de verdade
// usada na tela de listagem (app/(tabs)/investir.tsx).
const TOKEN_IMAGES: Record<string, any> = {
  BDC: require('../public/BDC.png'),
  ESCT: { uri: 'https://gateway.lighthouse.storage/ipfs/bafkreig4gwqmpwrvai3boloziuzwxhr4yhadkyxrbofxw4wzmccxtkrw3q' },
  BRT: { uri: 'https://gateway.lighthouse.storage/ipfs/bafybeihjtb3bae57rzlh4hblksaswxwfgjs4jxwsbeoj6yh5sfl7qso65q' },
};

const TOKEN_NAMES: Record<string, string> = {
  BDC: 'BodeCoin',
  ESCT: 'Escoteiros',
  BRT: 'Brutos',
};

function truncateKey(key: string) {
  if (!key) return '—';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.techRow}>
      <Text style={styles.techLabel}>{label}</Text>
      <Text style={styles.techValue}>{value}</Text>
    </View>
  );
}

export default function ContratarVestingScreen() {
  const insets = useSafeAreaInsets();
  const { crypto } = useLocalSearchParams<{ crypto?: string }>();
  const { t, prices } = useSettings();

  const moeda = (crypto?.toUpperCase() || 'BDC');

  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [usdAmount, setUsdAmount] = useState('');
  const [brlAmount, setBrlAmount] = useState('');
  const [isDisclaimerChecked, setIsDisclaimerChecked] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState('');

  // Pix QR (gerado via /api/picpay)
  const [isPixModalVisible, setIsPixModalVisible] = useState(false);
  const [isGeneratingPix, setIsGeneratingPix] = useState(false);
  const [pixQrBase64, setPixQrBase64] = useState<string | null>(null);
  const [pixQrContent, setPixQrContent] = useState<string | null>(null);
  const [pixOrderId, setPixOrderId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');

  const [isSuccessModalVisible, setIsSuccessModalVisible] = useState(false);
  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);

  const [contratoId, setContratoId] = useState<string | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState('USDT');
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [userWallet, setUserWallet] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Preço real do token (mesmo que seja 0 — não usar fallback fixo: usar
  // 0.03 confundia o BRT com o valor histórico da BDC).
  const precoAtual = prices[moeda]?.USD ?? 0;
  const valorInvestimento = parseFloat(usdAmount || '0');
  const quantidadeTokens = valorInvestimento > 0 && precoAtual > 0
    ? (valorInvestimento / precoAtual)
    : 0;

  const releaseSchedule = useMemo(() => {
    return RELEASE_INTERVALS.map((month) => {
      const d = new Date();
      d.setMonth(d.getMonth() + month);
      return {
        month,
        date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      };
    });
  }, []);

  useEffect(() => {
    loadBalances();
  }, []);

  const loadBalances = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('usuarios')
        .select('wallet_address')
        .eq('id', user.id)
        .single();

      const wallet = userData?.wallet_address || user.user_metadata?.wallet_address || '';
      setUserWallet(wallet);
      setBeneficiaryName(
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] ||
        ''
      );

      if (wallet) {
        const mints = transactionService.getTokenMints();
        const result = await transactionService.getBalances(wallet, mints);
        setBalances(result.balances);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getRequiredPaymentAmount = () => {
    if (paymentCurrency === 'SOL') {
      const solPrice = prices['SOL']?.USD || 150;
      return +(valorInvestimento / solPrice).toFixed(6);
    }
    return +valorInvestimento.toFixed(6);
  };


  const handleSalvarContrato = async () => {
    if (valorInvestimento <= 0) {
      Alert.alert(t('Aviso'), t('Por favor, insira um valor de investimento.'));
      return;
    }
    if (!isDisclaimerChecked) {
      Alert.alert(t('Aviso'), t('Você precisa aceitar os termos antes de confirmar.'));
      return;
    }

    setIsPaymentModalVisible(true);
  };

  const parseBrlInput = (raw: string): number => {
    // CurrencyConverter manda US format via .toFixed(2) ("44.00"); o usuário
    // pode editar manualmente em pt-BR ("1.234,56"). Detecta o decimal pelo
    // último separador — antes removia todo '.' como milhar e transformava
    // "44.00" em 4400.
    const cleaned = (raw || '').toString().replace(/\s/g, '');
    if (!cleaned) return 0;
    const decimalPos = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
    if (decimalPos === -1) return parseFloat(cleaned) || 0;
    const intPart = cleaned.slice(0, decimalPos).replace(/[.,]/g, '');
    const decPart = cleaned.slice(decimalPos + 1);
    return parseFloat(`${intPart}.${decPart}`) || 0;
  };

  const handleSelectPix = async () => {
    const brlValue = parseBrlInput(brlAmount);

    if (brlValue < 35) {
      Alert.alert(
        t('Valor mínimo'),
        t('O valor mínimo de pagamento via PIX é R$ 35,00. Ajuste o valor antes de continuar.'),
      );
      return;
    }

    setIsPaymentModalVisible(false);
    setIsGeneratingPix(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Usuário não autenticado.'));

      // PicPay exige CPF/email/telefone — buscamos perfil e KYC em paralelo.
      const [profileRes, kycRes] = await Promise.all([
        supabase
          .from('usuarios')
          .select('wallet_address, nome_completo, email, telefone')
          .eq('id', user.id)
          .single(),
        supabase
          .from('kyc_profiles')
          .select('cpf, nome, sobrenome')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      const profile = profileRes.data as any;
      const kyc = kycRes.data as any;

      if (!kyc?.cpf) {
        throw new Error(t('Conclua a verificação de identidade (KYC) antes de pagar via PIX.'));
      }

      const newOrderId = `vest-${user.id}-${Date.now()}`;

      // O contrato de vesting é gravado direto em contratos_vesting (a tabela
      // que alimenta o app Vesting), como 'Pendente' até o pagamento ser
      // confirmado. As telas de depósito continuam usando deposit_orders.
      const dataInicio = new Date();
      const dataFim = new Date();
      dataFim.setMonth(dataFim.getMonth() + DURATION_MONTHS);

      const { error: dbError } = await supabase.from('contratos_vesting').insert({
        usuario_id: user.id,
        moeda: moeda,
        valor_investimento: valorInvestimento,
        quantidade_tokens: quantidadeTokens,
        preco_investimento: precoAtual,
        public_key: profile?.wallet_address ?? userWallet,
        tipo_contrato: 'Padrão',
        data_inicio: dataInicio.toISOString(),
        duracao_meses: DURATION_MONTHS,
        data_fim: dataFim.toISOString(),
        status: 'Pendente',
        total_liberado: 0,
      });
      if (dbError) throw new Error(dbError.message);

      const fullName = (
        profile?.nome_completo ||
        [kyc?.nome, kyc?.sobrenome].filter(Boolean).join(' ') ||
        beneficiaryName ||
        ''
      ).trim();
      const [firstName, ...rest] = fullName.split(' ');

      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/picpay?action=create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: brlValue,
          referenceId: newOrderId,
          buyer: {
            firstName: firstName || 'Investidor',
            lastName: rest.join(' ') || 'Verum',
            document: kyc.cpf,
            email: profile?.email || user.email,
            phone: profile?.telefone || '+55 11 99999-9999',
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[PIX vesting] /api/picpay falhou', res.status, errText);
        throw new Error(`PicPay ${res.status}: ${errText.slice(0, 200) || t('falha desconhecida')}`);
      }
      const data = await res.json();

      // (C6) Geramos o QR localmente a partir do BR Code (pixContent) para
      // não depender do PNG base64 que o PicPay devolve — antes, com base64
      // mal-formada ou prefixo ausente, o <Image> falhava sem aviso e o
      // usuário via o modal aberto sem QR. pixContent é a fonte canônica.
      const pixContent: string | null = data?.qrcode?.content ?? null;
      const remoteBase64: string | null = data?.qrcode?.base64 ?? null;

      if (!pixContent && !remoteBase64) {
        console.error('[PIX vesting] resposta sem qrcode', data);
        throw new Error(t('QR Code PIX não retornado pelo gateway.'));
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
          console.warn('[PIX vesting] geração local falhou, usando base64 remota', qrErr);
        }
      }

      setPixQrBase64(finalBase64);
      setPixQrContent(pixContent);
      setPixOrderId(newOrderId);
      setIsPixModalVisible(true);
    } catch (e: any) {
      console.error('[PIX vesting] handleSelectPix error', e);
      Alert.alert(
        t('Falha ao gerar PIX'),
        e?.message || t('Erro inesperado ao criar a cobrança PIX. Tente novamente.'),
      );
    } finally {
      setIsGeneratingPix(false);
    }
  };

  const handleCopyPixCode = async () => {
    if (!pixQrContent) return;
    await Clipboard.setStringAsync(pixQrContent);
    Alert.alert('', t('Código PIX copiado!'));
  };

  const handleSelectWallet = async () => {
    const solBal = balances['SOL'] || 0;
    const solPrice = prices['SOL']?.USD || 150;
    const required = +(valorInvestimento / solPrice).toFixed(6);

    if (solBal < required) {
      Alert.alert(
        t('Saldo Insuficiente'),
        `${t('Você precisa de')} ${required.toFixed(6)} SOL ${t('mas possui apenas')} ${solBal.toFixed(6)} SOL.`
      );
      return;
    }

    setPaymentCurrency('SOL');
    setIsPaymentModalVisible(false);

    if (Platform.OS === 'web') {
      setTimeout(() => setIsPasswordModalVisible(true), 350);
      return;
    }

    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const bioResult = await LocalAuthentication.authenticateAsync({
          promptMessage: t('Confirme o pagamento'),
          fallbackLabel: t('Usar Senha'),
        });

        if (bioResult.success) {
          const savedPin = await keyManager.getPinForBiometrics();
          if (savedPin) {
            try {
              const kp = await keyManager.loadDecrypted(savedPin);
              executePayment(kp);
              return;
            } catch (e) {
              console.warn('Bio PIN parse failed', e);
            }
          }
        }
      }
    } catch (err) {
      console.warn('Biometrics disabled or failing', err);
    }

    setTimeout(() => setIsPasswordModalVisible(true), Platform.OS === 'ios' ? 0 : 350);
  };


  const handleConfirmPassword = async (pin: string) => {
    setIsLoading(true);
    setPasswordError(null);
    try {
      const keypair = await keyManager.loadDecrypted(pin.trim());
      await keyManager.getMnemonic(pin.trim());
      setIsPasswordModalVisible(false);
      setPasswordInput('');
      executePayment(keypair);
    } catch {
      setPasswordError(t('Senha incorreta. Verifique e tente novamente.'));
      setIsLoading(false);
    }
  };

  const executePayment = async (signerKeypair: Keypair) => {
    setIsLoading(true);
    setLoadingStep(t('Construindo transação...'));
    try {
      const amount = getRequiredPaymentAmount();
      let tx;

      if (paymentCurrency === 'SOL') {
        tx = await transactionService.buildSOLTransfer({
          from: userWallet,
          to: VERUM_TREASURY_ADDRESS,
          amount,
          feeWallet: VERUM_TREASURY_ADDRESS,
          type: 'invest',
        });
      } else {
        const ms = transactionService.getTokenMints();
        const mint = ms[paymentCurrency];
        const meta = transactionService.getTokenMeta(paymentCurrency);
        if (!mint || !meta) throw new Error('Token data not found');

        tx = await transactionService.buildSPLTransfer({
          from: userWallet,
          to: VERUM_TREASURY_ADDRESS,
          mintAddress: mint,
          amount,
          decimals: meta.decimals,
          feeWallet: VERUM_TREASURY_ADDRESS,
          type: 'invest',
        });
      }

      setLoadingStep(t('Executando na blockchain...'));
      transactionService.getConnection();
      await transactionService.simulate(tx);
      tx.sign(signerKeypair);
      const result = await transactionService.broadcastSigned(tx);

      if (!result || (result.status !== 'confirmed' && !result.hash)) {
        throw new Error(t('Falha ao enviar transação na rede.'));
      }

      setLoadingStep(t('Atualizando banco de dados...'));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Usuário não autenticado.'));

      const dataInicio = new Date();
      const dataFim = new Date();
      dataFim.setMonth(dataFim.getMonth() + DURATION_MONTHS);

      const { data, error } = await supabase.from('contratos_vesting').insert({
        usuario_id: user.id,
        moeda: moeda,
        valor_investimento: valorInvestimento,
        quantidade_tokens: quantidadeTokens,
        preco_investimento: precoAtual,
        public_key: userWallet,
        tipo_contrato: 'Padrão',
        data_inicio: dataInicio.toISOString(),
        duracao_meses: DURATION_MONTHS,
        data_fim: dataFim.toISOString(),
        status: 'Pago',
        total_liberado: 0,
      }).select().single();

      if (error) throw new Error(error.message);

      setContratoId(data.id);

      setIsSuccessModalVisible(true);
    } catch (err: any) {
      let errMsg = err.message || t('Ocorreu um erro no processamento do pagamento.');
      if (errMsg.includes('InsufficientFunds')) errMsg = t('Saldo em SOL insuficiente para pagar as taxas da rede.');
      Alert.alert(t('Falha no Pagamento'), errMsg);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const tokenQtyFormatted = quantidadeTokens > 0
    ? quantidadeTokens.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : '—';

  const canConfirm = isDisclaimerChecked && valorInvestimento > 0 && !isLoading;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: V.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Título */}
          <View style={styles.titleBox}>
            <Text style={styles.title}>{t('CONTRATAR VESTING')}</Text>
            <View style={styles.goldLine} />
            <Text style={styles.subtitle}>
              {t('Garantia de liquidez e valorização através de contratos inteligentes on-chain.')}
            </Text>
          </View>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Feather name="info" size={18} color={V.gold} style={{ marginTop: 2, marginRight: 12, flexShrink: 0 }} />
            <Text style={styles.infoText}>
              {t('Seu investimento no futuro é agora. Suas criptos serão liberadas gradualmente pelo Smart Contract Verum, garantindo segurança e transparência.')}
            </Text>
          </View>

          {/* Calculadora de Câmbio */}
          <CurrencyConverter
            onUSDValueChange={(v) => setUsdAmount(v)}
            onBRLValueChange={(v) => setBrlAmount(v)}
          />

          {/* Configuração do Contrato */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('CONFIGURAÇÃO DO CONTRATO')}</Text>

            <Text style={styles.configLabel}>{t('ATIVO DE DESTINO')}</Text>
            <View style={styles.assetRow}>
              <View style={styles.tokenIconWrap}>
                <Image
                  source={TOKEN_IMAGES[moeda] ?? TOKEN_IMAGES.BDC}
                  style={styles.tokenIcon}
                />
              </View>
              <View style={styles.tokenMeta}>
                <Text style={styles.tokenName}>{TOKEN_NAMES[moeda] ?? moeda}</Text>
                <Text style={styles.tokenPrice}>1 {moeda} = US$ {precoAtual.toFixed(2)}</Text>
              </View>
              <Text style={styles.tokenAmount}>{tokenQtyFormatted}</Text>
            </View>

            <View style={styles.separator} />

            <Text style={styles.configLabel}>{t('NOME DO BENEFICIÁRIO')}</Text>
            <View style={styles.beneficiaryRow}>
              <Feather name="user" size={20} color={V.muted} style={{ marginRight: 12 }} />
              <Text style={styles.beneficiaryName}>{beneficiaryName || t('Novo Investidor')}</Text>
            </View>
          </View>

          {/* Dados Técnicos */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('DADOS TÉCNICOS')}</Text>
            <TechRow label={t('Quantidade de Tokens')} value={quantidadeTokens > 0 ? `${tokenQtyFormatted} ${moeda}` : '—'} />
            <TechRow label={t('Chave Pública')} value={truncateKey(userWallet)} />
            <TechRow label={t('Duração')} value={`${DURATION_MONTHS} ${t('Meses')}`} />
            <TechRow label={t('Preço Atual')} value={`US$ ${precoAtual.toFixed(2)}`} />
            <TechRow label={t('Taxa Administrativa')} value={ADMIN_FEE} />
          </View>

          {/* Cronograma de Liberação */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{t('CRONOGRAMA DE LIBERAÇÃO')}</Text>

            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.tableHeaderText, { flex: 1 }]}>{t('PERÍODO')}</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>{t('PERCENTUAL')}</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>{t('PREVISÃO')}</Text>
            </View>

            {releaseSchedule.map((item, index) => (
              <View
                key={item.month}
                style={[styles.tableRow, index < releaseSchedule.length - 1 && styles.tableRowBorder]}
              >
                <Text style={[styles.tableCell, { flex: 1 }]}>{t('Mês')} {item.month}</Text>
                <Text style={[styles.tableCellPercent, { flex: 1 }]}>{RELEASE_PERCENT}%</Text>
                <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>{item.date}</Text>
              </View>
            ))}
          </View>

          {/* Disclaimer */}
          <TouchableOpacity
            style={styles.disclaimerRow}
            onPress={() => setIsDisclaimerChecked(!isDisclaimerChecked)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, isDisclaimerChecked && styles.checkboxChecked]}>
              {isDisclaimerChecked && <Feather name="check" size={12} color={V.bg} />}
            </View>
            <Text style={styles.disclaimerText}>
              {t('Compreendo que meus ativos ficarão bloqueados por ')}<Text style={{ color: V.gold }}>{DURATION_MONTHS} {t('meses')}</Text>{t(' e que esta transação é irreversível e não passível de estorno.')}
            </Text>
          </TouchableOpacity>

          {/* Botão Confirmar */}
          <TouchableOpacity
            style={[styles.btn, !canConfirm && { opacity: 0.45 }]}
            onPress={handleSalvarContrato}
            disabled={!canConfirm}
          >
            {isLoading && !isPaymentModalVisible && !isPasswordModalVisible ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <ActivityIndicator color={V.bg} />
                <Text style={styles.btnText}>{loadingStep}</Text>
              </View>
            ) : (
              <>
                <Feather name="lock" size={18} color={V.bg} />
                <Text style={styles.btnText}>{t('CONFIRMAR INVESTIMENTO')}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>

        <BottomNav activeRoute="vesting" />
        <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
      </View>

      {/* Modal — Forma de Pagamento */}
      <Modal visible={isPaymentModalVisible} transparent animationType="slide">
        <View style={styles.bottomSheetOverlay}>
          <View style={styles.bottomSheetContent}>
            <View style={styles.dragHandle} />
            <Text style={styles.pTitle}>{t('FORMA DE PAGAMENTO')}</Text>
            <Text style={styles.pSubtitle}>{t('Escolha como deseja ativar seu contrato:')}</Text>

            {/* Opção PIX */}
            <TouchableOpacity
              style={[styles.paymentOption, isGeneratingPix && { opacity: 0.6 }]}
              onPress={handleSelectPix}
              activeOpacity={0.75}
              disabled={isGeneratingPix}
            >
              <View style={[styles.paymentOptionIcon, { backgroundColor: 'rgba(46,204,113,0.12)', borderColor: 'rgba(46,204,113,0.3)' }]}>
                <Feather name="grid" size={22} color={V.success} />
              </View>
              <View style={styles.paymentOptionInfo}>
                <Text style={styles.paymentOptionTitle}>{t('Pagar com PIX')}</Text>
                <Text style={styles.paymentOptionSub}>
                  {brlAmount
                    ? `R$ ${brlAmount} — ${t('Ativação instantânea via QR Code')}`
                    : t('Ativação instantânea via QR Code')}
                </Text>
              </View>
              {isGeneratingPix
                ? <ActivityIndicator size="small" color={V.gold} />
                : <Feather name="chevron-right" size={20} color={V.muted} />
              }
            </TouchableOpacity>

            {/* Opção Saldo da Wallet */}
            <TouchableOpacity style={styles.paymentOption} onPress={handleSelectWallet} activeOpacity={0.75} disabled={isLoading}>
              <View style={[styles.paymentOptionIcon, { backgroundColor: 'rgba(201,168,76,0.12)', borderColor: V.border }]}>
                <Feather name="credit-card" size={22} color={V.gold} />
              </View>
              <View style={styles.paymentOptionInfo}>
                <Text style={styles.paymentOptionTitle}>{t('Saldo da Wallet')}</Text>
                <Text style={styles.paymentOptionSub}>{t('Disponível:')} {(balances['SOL'] || 0).toFixed(4)} SOL</Text>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelTextBtn}
              onPress={() => setIsPaymentModalVisible(false)}
              disabled={isLoading}
            >
              <Text style={styles.cancelTextBtnLabel}>{t('CANCELAR')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal — Senha */}
      <Modal visible={isPasswordModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.mContent}>
            <Text style={styles.mTitle}>{t('Digite sua Senha')}</Text>
            <Text style={styles.mDesc}>
              {t('Confirme a transação para enviar')} {getRequiredPaymentAmount()} {paymentCurrency} {t('para a tesouraria.')}
            </Text>
            <TextInput
              style={styles.inputPass}
              placeholder="••••••••"
              placeholderTextColor={V.muted}
              secureTextEntry
              value={passwordInput}
              onChangeText={setPasswordInput}
            />
            {passwordError && (
              <Text style={{ color: V.danger, fontSize: 13, marginBottom: 16 }}>{passwordError}</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setIsPasswordModalVisible(false); setPasswordError(null); }}
                disabled={isLoading}
              >
                <Text style={styles.cancelBtnText}>{t('CANCELAR')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { flex: 1, marginTop: 0 }]}
                onPress={() => handleConfirmPassword(passwordInput)}
                disabled={isLoading}
              >
                {isLoading ? <ActivityIndicator color={V.bg} /> : <Text style={styles.btnText}>{t('CONFIRMAR')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal — Sucesso */}
      <Modal visible={isSuccessModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.mContent}>
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(46,204,113,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Feather name="check" size={32} color={V.success} />
              </View>
              <Text style={styles.mTitle}>{t('PAGAMENTO RECEBIDO')}</Text>
              <Text style={[styles.mDesc, { textAlign: 'center' }]}>
                {t('Sua compra de ')}
                <Text style={{ color: V.gold }}>{tokenQtyFormatted} {moeda}</Text>
                {t(' foi paga e confirmada na blockchain pelo contrato ID #')}{contratoId}.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.btn, { width: '100%' }]}
              onPress={() => { setIsSuccessModalVisible(false); router.replace('/(tabs)/investir'); }}
            >
              <Text style={styles.btnText}>{t('VOLTAR PARA INÍCIO')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal — PIX QR Code */}
      <Modal visible={isPixModalVisible} transparent animationType="slide">
        <View style={styles.mOverlay}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', width: '100%' }}
            style={{ width: '100%' }}
          >
            <View style={styles.mContent}>
              <Text style={styles.mTitle}>{t('PAGAR VIA PIX')}</Text>
              <Text style={styles.mDesc}>
                {t('Escaneie o QR Code ou copie o código no seu app bancário. Validade: 30 minutos.')}
              </Text>

              {pixQrBase64 && (
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <View style={{ padding: 12, backgroundColor: '#ffffff', borderRadius: V.r12, borderWidth: 1, borderColor: V.border }}>
                    <Image
                      source={{ uri: pixQrBase64 }}
                      style={{ width: 220, height: 220 }}
                      resizeMode="contain"
                      onError={(e) => console.warn('[PIX vesting] Image render failed', e?.nativeEvent)}
                    />
                  </View>
                  <Text style={{ color: V.gold, fontFamily: F.bold, fontSize: 18, marginTop: 16 }}>
                    R$ {brlAmount || parseBrlInput(brlAmount).toFixed(2)}
                  </Text>
                </View>
              )}

              {pixQrContent && (
                <TouchableOpacity
                  onPress={handleCopyPixCode}
                  style={{
                    backgroundColor: V.surface2,
                    padding: 14,
                    borderRadius: V.r8,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: V.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ color: V.gold, fontSize: 10, fontFamily: F.bold, letterSpacing: 1 }}>
                      {t('CÓDIGO COPIA E COLA')}
                    </Text>
                    <Feather name="copy" size={14} color={V.gold} />
                  </View>
                  <Text style={{ color: V.text, fontSize: 11, fontFamily: F.body }} numberOfLines={3}>
                    {pixQrContent}
                  </Text>
                </TouchableOpacity>
              )}

              {pixOrderId && (
                <Text style={{ color: V.muted, fontSize: 10, marginBottom: 16, textAlign: 'center' }}>
                  {t('Referência:')} {pixOrderId}
                </Text>
              )}

              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setIsPixModalVisible(false);
                  setPixQrBase64(null);
                  setPixQrContent(null);
                  setPixOrderId(null);
                }}
              >
                <Text style={styles.btnText}>{t('FECHAR')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Loader Global */}
      {isLoading && !isPaymentModalVisible && !isPasswordModalVisible && loadingStep !== '' && (
        <View style={[styles.mOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.9)' }]}>
          <ActivityIndicator size="large" color={V.gold} />
          <Text style={{ color: V.gold, marginTop: 16, fontFamily: F.semi }}>{loadingStep}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 120, paddingTop: 24 },

  // Título
  titleBox: { marginBottom: 20 },
  title: { fontSize: 22, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 36, height: 2, backgroundColor: V.gold, marginVertical: 10 },
  subtitle: { fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 },

  // Info card
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.gold,
    padding: 16,
    marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: F.body, color: V.text, lineHeight: 20 },

  // Section cards
  sectionCard: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
    padding: 16,
    marginBottom: 16,
    ...V.shadow,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: F.title,
    color: V.gold,
    letterSpacing: 1.5,
    marginBottom: 16,
  },

  // Configuração do contrato
  configLabel: {
    fontSize: 9,
    fontFamily: F.bold,
    color: V.muted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    padding: 12,
    marginBottom: 4,
  },
  tokenIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: V.surface3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 1,
    borderColor: V.border,
  },
  tokenIcon: { width: '100%', height: '100%' },
  tokenMeta: { flex: 1 },
  tokenName: { fontSize: 15, fontFamily: F.bold, color: V.text },
  tokenPrice: { fontSize: 11, fontFamily: F.body, color: V.muted, marginTop: 2 },
  tokenAmount: { fontSize: 15, fontFamily: F.bold, color: V.gold },
  separator: { height: 1, backgroundColor: V.border, marginVertical: 14 },
  beneficiaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    padding: 12,
  },
  beneficiaryName: { fontSize: 15, fontFamily: F.semi, color: V.text },

  // Dados técnicos
  techRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  techLabel: { fontSize: 13, fontFamily: F.body, color: V.muted, flex: 1 },
  techValue: { fontSize: 13, fontFamily: F.bold, color: V.text, textAlign: 'right', flexShrink: 0, marginLeft: 8 },

  // Cronograma
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  tableHeader: {
    borderBottomWidth: 1,
    borderBottomColor: V.border,
    marginBottom: 4,
  },
  tableHeaderText: {
    fontSize: 9,
    fontFamily: F.bold,
    color: V.muted,
    letterSpacing: 1,
  },
  tableCell: { fontSize: 13, fontFamily: F.bold, color: V.text },
  tableCellPercent: { fontSize: 13, fontFamily: F.bold, color: V.gold, textAlign: 'center' },

  // Disclaimer
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: V.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  checkboxChecked: { backgroundColor: V.gold },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 },

  // Botão principal
  btn: {
    height: 52,
    backgroundColor: V.gold,
    borderRadius: V.r8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 8,
    ...V.shadow,
  },
  btnText: { color: V.bg, fontSize: 13, fontFamily: F.bold, letterSpacing: 1.5 },

  cancelBtn: {
    height: 50,
    borderRadius: V.r8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: V.border,
    paddingHorizontal: 24,
  },
  cancelBtnText: { color: V.text, fontSize: 13, fontFamily: F.bold, letterSpacing: 1 },

  // Modais
  mOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  mContent: {
    width: '100%',
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 32,
    borderWidth: 1,
    borderColor: V.border,
  },
  mTitle: { fontSize: 20, fontFamily: F.title, color: V.gold, marginBottom: 12 },
  mDesc: { fontSize: 14, fontFamily: F.body, color: V.muted, lineHeight: 22, marginBottom: 24 },
  inputPass: {
    backgroundColor: V.surface2,
    height: 50,
    borderRadius: V.r8,
    paddingHorizontal: 16,
    color: V.text,
    fontFamily: F.semi,
    borderWidth: 1,
    borderColor: V.border,
    marginBottom: 24,
  },

  // Bottom sheet pagamento
  bottomSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  bottomSheetContent: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: V.border,
  },
  dragHandle: { width: 40, height: 4, backgroundColor: V.border, borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  pTitle: { fontSize: 18, fontFamily: F.title, color: V.gold, marginBottom: 6, textAlign: 'center', letterSpacing: 1.5 },
  pSubtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, marginBottom: 24, lineHeight: 20, textAlign: 'center' },

  // Opções de pagamento
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.surface2,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
    padding: 16,
    marginBottom: 12,
  },
  paymentOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
  paymentOptionInfo: { flex: 1 },
  paymentOptionTitle: { fontSize: 15, fontFamily: F.bold, color: V.text, marginBottom: 3 },
  paymentOptionSub: { fontSize: 12, fontFamily: F.body, color: V.muted },

  cancelTextBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  cancelTextBtnLabel: { fontSize: 13, fontFamily: F.bold, color: V.muted, letterSpacing: 1 },
});
