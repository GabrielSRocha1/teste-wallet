import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import CurrencyConverter from '@/components/CurrencyConverter';
import SwipeToConfirm from '@/components/SwipeToConfirm';
import { useSendPayment } from '@/src/hooks/useSendPayment';
import { supabase } from '@/src/services/supabase';
import notificationService from '@/src/services/notificationService';
import { transactionService, VERUM_TREASURY_ADDRESS, VERUM_FEE_PERCENT } from '@/src/services/transactionService';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Keypair } from '@solana/web3.js';
import QRScannerModal from '@/components/QRScannerModal';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F, PAD } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import * as LocalAuthentication from 'expo-local-authentication';
import { getBiometricsEnabled } from '@/constants/biometrics-storage';
import keyManager from '@/src/services/keyManager';
import PasswordModal from '@/components/PasswordModal';

// Removido TOKEN_MINTS_BY_SYMBOL em favor da centralização no transactionService
const VERUM_FEE_WALLET = VERUM_TREASURY_ADDRESS;
const VERUM_FEE_PCT = VERUM_FEE_PERCENT;

// Margem de SOL para taxas de rede (gas)
const SOL_GAS_RESERVE = 0.0001; 
// Recomendação maior para criação de novas contas (ATA)
const SOL_ATA_RESERVE = 0.0021; 

// ─── FeeTooltip ─────────────────────────────────────────────────────────────
function FeeRow({ label, value, icon = 'info' }: { label: string; value: string; icon?: string }) {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  const show = () => {
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() =>
        setVisible(false)
      );
    }, 3000);
  };

  return (
    <View style={feeStyles.row}>
      <Text style={feeStyles.label}>{label}</Text>
      <TouchableOpacity onPress={show} style={feeStyles.iconBtn} activeOpacity={0.7}>
        <Feather name={icon as any} size={15} color={V.gold} />
      </TouchableOpacity>
      {visible && (
        <Animated.View style={[feeStyles.tooltip, { opacity }]}>
          <Text style={feeStyles.tooltipText}>{value}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const feeStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, position: 'relative' },
  label: { fontSize: 12, fontFamily: F.semi, color: V.muted, flex: 1 },
  iconBtn: { padding: 4, marginLeft: 8 },
  tooltip: {
    position: 'absolute',
    right: 30,
    top: -4,
    backgroundColor: V.surface1,
    borderWidth: 1,
    borderColor: V.gold,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 160,
    maxWidth: 240,
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 10,
  },
  tooltipText: { fontSize: 12, fontFamily: F.semi, color: V.text, lineHeight: 18 },
});

// ────────────────────────────────────────────────────────────────────────────

export default function TransferirScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const scanData = params.scanData as string;
  const initialCrypto = params.crypto as string;
  const { t, network, prices } = useSettings();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [currency, setCurrency] = useState(initialCrypto || 'SOL');

  useEffect(() => {
    if (initialCrypto) setCurrency(initialCrypto);
  }, [initialCrypto]);
  const [amount, setAmount] = useState('');
  const [isCurrencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [destinatario, setDestinatario] = useState((scanData as string) || '');

  const { buildAndPreview, signAndSend, status, reset, error, txHash, preview } = useSendPayment();
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [isPreviewModalVisible, setIsPreviewModalVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [errors, setErrors] = useState<{ destinatario?: string; amount?: string }>({});
  const [resolvedDestAddr, setResolvedDestAddr] = useState('');
  const [resolvedDestEmail, setResolvedDestEmail] = useState<string | null>(null);
  const [resolvedDestUserId, setResolvedDestUserId] = useState<string | null>(null);
  const [senderWallet, setSenderWallet] = useState('');
  const [previewPayParams, setPreviewPayParams] = useState<any>(null);

  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [allBalances, setAllBalances] = useState<Record<string, number>>({});
  const [solPrice, setSolPrice] = useState<number>(0);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [usdValue, setUsdValue] = useState('0.00');
  const [activeInput, setActiveInput] = useState<'amount' | 'usd'>('amount');

  // Taxa de rede Solana estimada
  // Taxa de rede Solana estimada
  const [networkFeeSol, setNetworkFeeSol] = useState<number>(SOL_GAS_RESERVE);

  // 1. Quando o usuário edita a QUANTIDADE DE TOKEN
  useEffect(() => {
    if (activeInput === 'amount' && amount) {
      const price = prices[currency]?.USD || 0;
      const amtNum = parseFloat(amount.replace(',', '.'));
      if (!isNaN(amtNum) && price > 0) {
        setUsdValue((amtNum * price).toFixed(2));
      } else if (!amount || amount === '0') {
        setUsdValue('0.00');
      }
    }
  }, [amount, currency, prices]);

  // 2. Quando o usuário edita o VALOR EM DÓLAR (via calculadora)
  useEffect(() => {
    if (activeInput === 'usd' && usdValue) {
      const price = prices[currency]?.USD || 0;
      const valNum = parseFloat(usdValue);
      if (!isNaN(valNum) && price > 0) {
        setAmount((valNum / price).toFixed(6).replace(/\.?0+$/, ''));
      } else if (!usdValue || usdValue === '0' || usdValue === '0.00') {
        setAmount('');
      }
    }
  }, [usdValue, currency, prices]);

  useEffect(() => {
    if (scanData) {
      if (scanData.includes(':')) {
        const parts = scanData.split(':');
        const addr = parts[1].split('?')[0];
        setDestinatario(addr);
        if (scanData.includes('amount=')) {
          const amt = scanData.split('amount=')[1].split('&')[0];
          setAmount(amt);
        }
      } else {
        setDestinatario(scanData);
      }
    }
    checkBiometrics();
    loadBalances();
    loadPricesAndFee();
  }, [scanData]);

  const loadPricesAndFee = async () => {
    try {
      const p = prices[currency]?.USD || 0;
      setSolPrice(prices['SOL']?.USD || 0);
      setNetworkFeeSol(SOL_GAS_RESERVE);
    } catch (e) {
      console.error('Error loading prices:', e);
    }
  };

  const loadBalances = async () => {
    try {
      setLoadingBalances(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const wallet = user.user_metadata?.wallet_address ||
        (await supabase.from('usuarios').select('wallet_address').eq('id', user.id).single())?.data?.wallet_address;
      if (!wallet) return;

      const transService = require('@/src/services/transactionService').default;
      const mints = transService.getTokenMints();
      const result = await transService.getBalances(wallet, mints);
      
      // Novo: Busca saldos do Ledger (banco) e mescla com on-chain
      const dbBalances = await transService.getDatabaseBalances(user.id);
      const merged = { ...dbBalances, ...result.balances };
      
      setAllBalances(merged);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBalances(false);
    }
  };

  const checkBiometrics = async () => {
    const { hasHardwareAsync, isEnrolledAsync } = require('expo-local-authentication');
    const hasHardware = await hasHardwareAsync();
    const isEnrolled = await isEnrolledAsync();
    setIsBiometricAvailable(hasHardware && isEnrolled);
  };

  /** Resolve o destinatário: se for email Verum → retorna wallet_address; senão retorna próprio valor */
  const resolveDestination = async (input: string): Promise<{ walletAddress: string; userId: string | null; email: string | null }> => {
    let rawInput = input.trim();

    // Remove prefixo 'solana:' se houver
    if (rawInput.toLowerCase().startsWith('solana:')) {
      rawInput = rawInput.split(':')[1].split('?')[0];
    }

    // Se for email, busca no banco de dados
    if (rawInput.includes('@')) {
      const { data } = await supabase
        .from('usuarios')
        .select('id, wallet_address, email')
        .eq('email', rawInput.toLowerCase())
        .maybeSingle();
      if (data?.wallet_address) {
        return { walletAddress: data.wallet_address, userId: data.id, email: data.email };
      }
      throw new Error(`Usuário com email "${rawInput}" não encontrado na Verum.`);
    }

    // Se for endereço de carteira, verifica se é usuário Verum
    const { data } = await supabase
      .from('usuarios')
      .select('id, email')
      .eq('wallet_address', rawInput)
      .maybeSingle();

    return { walletAddress: rawInput, userId: data?.id || null, email: data?.email || null };
  };

  const handleMaxPress = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const wallet = user.user_metadata?.wallet_address || (await supabase.from('usuarios').select('wallet_address').eq('id', user.id).single())?.data?.wallet_address;
      if (!wallet) return;

      const transService = require('@/src/services/transactionService').default;
      const { TOKEN_MINTS } = require('@/src/services/transactionService');
      const { balances } = await transService.getBalances(wallet, TOKEN_MINTS);
      const bal = balances[currency] || 0;

      const gasEst = currency === 'SOL' ? SOL_GAS_RESERVE : 0;
      // (CR5) Fórmula: amountMáximo = (saldo - gas) / 1.02
      // O "1.02" cobre o saldo do usuário + a taxa Verum 2%. Antes a variável
      // `maxNom` faltava — refactor removeu seu cálculo intermediário e o
      // setAmount nunca recebia o valor real, sempre era NaN.
      const meta = transService.getTokenMeta(currency);
      const decimals = currency === 'SOL' ? 9 : (meta?.decimals || 6);
      const factor = Math.pow(10, decimals);
      const maxNom = Math.max(0, (bal - gasEst) / 1.02);
      const truncated = Math.floor(maxNom * factor) / factor;

      setAmount(truncated.toString().replace(/\.?0+$/, ''));
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  // ── FASE 1: Validar + Simular → mostrar preview modal ──────────────────
  const handleTransferClick = async () => {
    const newErrors: { destinatario?: string; amount?: string } = {};
    if (!destinatario) newErrors.destinatario = t('Preencha o destinatário');
    if (!amount || parseFloat(amount) <= 0) newErrors.amount = t('Valor inválido');
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});

    setIsLoading(true);
    setLoadingStep(t('Simulando transação na rede...'));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Não autenticado.'));

      const wallet =
        user.user_metadata?.wallet_address ||
        (await supabase.from('usuarios').select('wallet_address').eq('id', user.id).single())?.data?.wallet_address;
      if (!wallet) throw new Error(t('Endereço da carteira não encontrado.'));
      setSenderWallet(wallet);

      const resolved = await resolveDestination(destinatario);
      setResolvedDestAddr(resolved.walletAddress);
      setResolvedDestEmail(resolved.email);
      setResolvedDestUserId(resolved.userId);

      const qty = parseFloat(amount);
      const feePct = VERUM_FEE_PCT;
      const totalNeeded = qty * (1 + feePct);
      const currentBalance = allBalances[currency] || 0;

      // 1. Verificação de Saldo do Ativo (Amount + Taxa 2%)
      if (totalNeeded > currentBalance) {
        throw new Error(`${t('Saldo insuficiente de')} ${currency}. ${t('Você possui')} ${currentBalance.toFixed(6)} ${t('e necessita de')} ${totalNeeded.toFixed(6)} (${t('incluindo taxa de 2%')}).`);
      }

      // 2. Verificação de SOL para Taxa de Rede (Gas)
      const solBalance = allBalances['SOL'] || 0;
      // Margem flexível: 0.0001 para transferências comuns, mas informamos sobre 0.002 se puder ser o caso
      const totalSolNeeded = currency === 'SOL' ? (totalNeeded + SOL_GAS_RESERVE) : SOL_GAS_RESERVE;

      if (solBalance < totalSolNeeded) {
        if (currency === 'SOL') {
          const lack = (totalSolNeeded - solBalance).toFixed(6);
          throw new Error(`${t('Saldo insuficiente para enviar')} ${totalNeeded.toFixed(6)} SOL + ${t('gas da rede')}. ${t('Faltam')} ${lack} SOL.`);
        } else {
          throw new Error(`${t('Saldo de SOL insuficiente para o gas da rede')}. ${t('Você possui')} ${solBalance.toFixed(6)} ${t('e necessita de ao menos')} ${SOL_GAS_RESERVE} SOL. ${t('Recomendamos ter 0.005 SOL para garantir a criação de novas contas de token (ATA), caso necessário.')}`);
        }
      }

      const payParams: any = { type: currency === 'SOL' ? 'SOL' : 'SPL' };
      if (currency === 'SOL') {
        payParams.sol = { from: wallet, to: resolved.walletAddress, amount: qty, feeWallet: VERUM_FEE_WALLET };
      } else {
        const transService = require('@/src/services/transactionService').default;
        const meta = transService.getTokenMeta(currency);
        if (!meta) throw new Error(`Token ${currency} não suportado na rede ${network}.`);
        payParams.spl = { from: wallet, to: resolved.walletAddress, mintAddress: meta.mint, amount: qty, decimals: meta.decimals, feeWallet: VERUM_FEE_WALLET };
      }
      setPreviewPayParams(payParams);

      const previewResult = await buildAndPreview(payParams);
      if (!previewResult) throw new Error(t('Falha na simulação. Verifique seu saldo e tente novamente.'));

      setIsPreviewModalVisible(true);
    } catch (err: any) {
      Alert.alert(t('Erro de Simulação'), err.message || t('Ocorreu um erro ao simular a transação.'));
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  // ── FASE 2: Após swipe → autenticar → executar ──────────────────────────
  // Web: sempre abre o campo de senha diretamente.
  // Nativo: tenta biometria primeiro; se cancelar ou falhar, abre senha.
  const handleConfirmPreview = async () => {
    // Web nunca usa biometria — vai direto para a senha
    if (Platform.OS === 'web') {
      setIsPreviewModalVisible(false);
      setTimeout(() => setIsPasswordModalVisible(true), 350);
      return;
    }

    // Nativo: tenta biometria se estiver ativa
    const isBioActive = await getBiometricsEnabled();
    if (isBioActive) {
      const bioResult = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Confirme seu envio'),
        fallbackLabel: t('Usar Senha'),
      });

      if (bioResult.success) {
        const savedPin = await keyManager.getPinForBiometrics();
        if (savedPin) {
          try {
            const kp = await keyManager.loadDecrypted(savedPin);
            setIsPreviewModalVisible(false);
            executeTransfer(kp);
            return;
          } catch (e) {
            console.warn('[transferir] Falha ao usar PIN via biometria, pedindo senha', e);
          }
        }
      }
      // Cancelou, falhou ou PIN inválido → cai para senha
    }

    // Sem biometria ativa ou qualquer falha → fecha preview e abre senha após dismiss
    setIsPreviewModalVisible(false);
    // Aguarda a animação do modal fechar antes de abrir o próximo (necessário no Android/Web)
    setTimeout(() => setIsPasswordModalVisible(true), Platform.OS === 'ios' ? 0 : 350);
  };



  const handleConfirmPassword = async (pin: string) => {
    setIsLoading(true);
    setPasswordError(null);
    try {
      const keypair = await keyManager.loadDecrypted(pin.trim());
      const mnemonic = await keyManager.getMnemonic(pin.trim());
      await keyManager.startSession(mnemonic, keypair, pin.trim());
      setIsPasswordModalVisible(false);
      setPasswordError(null);
      executeTransfer(keypair);
    } catch (err: any) {
      console.error('[handleConfirmPassword] Erro ao decifrar chave:', err?.message);
      // Mantém modal aberto e exibe erro inline
      setPasswordError(t('Senha incorreta. Verifique e tente novamente.'));
      setIsLoading(false);
    }
  };


  const executeTransfer = async (signerKeypair: Keypair) => {
    setIsLoading(true);
    try {
      setLoadingStep(t('Validando destinatário...'));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // Usa os dados já resolvidos na fase de simulação
      const destAddress = resolvedDestAddr;
      const destUserId = resolvedDestUserId;
      const destEmail = resolvedDestEmail;

      if (!senderWallet) throw new Error('Endereço da carteira do remetente não encontrado.');

      const grossAmount = parseFloat(amount);
      const platformFeeAmount = +(grossAmount * VERUM_FEE_PCT).toFixed(9);
      const totalAmountWithFee = +(grossAmount + platformFeeAmount).toFixed(9);
      const netAmount = grossAmount;

      // Sign + Broadcast usando o preview já simulado
      setLoadingStep(t('Assinando e enviando para a rede...'));
      if (!preview) throw new Error('Dados de simulação perdidos. Tente novamente.');
      const result = await signAndSend(preview.transaction, signerKeypair);
      
      // Se não há resultado ou se o status falhou e NÃO temos hash, é erro real
      if (!result || (result.status !== 'confirmed' && !result.hash)) {
        throw new Error(t('Falha ao enviar transação. Verifique sua conexão e saldo.'));
      }

      // Se temos hash mas o status não veio 'confirmed' (raro após o patch do service), 
      // mostramos um aviso de processamento, não um erro fatal.
      if (result.status !== 'confirmed' && result.hash) {
        console.warn('[transferir] Transação enviada, mas status de confirmação não recebido a tempo.');
      }

      setLoadingStep(t('Registrando transação...'));
      // 5. Busca info do remetente para notificações
      const { data: senderData } = await supabase
        .from('usuarios')
        .select('nome_completo, email')
        .eq('id', user.id)
        .single();

      const senderName = senderData?.nome_completo || senderData?.email || 'Usuário Verum';
      const destDisplay = destEmail || destAddress.substring(0, 8) + '...' + destAddress.slice(-4);

      // 6. Salva no histórico de transações via Service
      const saveRes = await transactionService.saveTransaction({
        senderId: user.id,
        senderWallet: signerKeypair.publicKey.toBase58(),
        destUserId: destUserId,
        destAddress: destAddress,
        amount: grossAmount,
        currency: currency,
        description: undefined, // Será ajustado conforme a nova lógica se houver input de memo
        txHash: result.hash,
        senderName: senderName
      });
      
      if (!saveRes.success) {
        console.error('[transferir] Erro no histórico, mas fundos enviados:', saveRes.error);
      }

      // 7. Notificações para o Destinatário
      if (destUserId) {
        const tokenPrice = prices[currency]?.USD || 0;
        const recvUsdVal = (netAmount * tokenPrice).toFixed(2);
        const recvUsdStr = tokenPrice > 0 && recvUsdVal !== "0.00" ? ` (~$ ${recvUsdVal})` : '';
        
        // E-mail (se houver)
        if (destEmail) {
          await notificationService.pushToEmail(destEmail, {
            type: 'recebimento',
            title: 'Transferência recebida',
            description: `Você recebeu ${netAmount} ${currency} de ${senderName}.`,
            amount: `+${netAmount}`,
            currency: `${currency}${recvUsdStr}`,
            data: { hash: result.hash },
          });
        }

        // In-app Notification para o destinatário
        await notificationService.pushNotification({
          userId: destUserId, // Notificar o destinatário
          type: 'recebimento',
          title: 'Transferência recebida',
          description: `Você recebeu ${netAmount} ${currency} de ${senderName}.`,
          amount: `+${netAmount}`,
          currency: `${currency}${recvUsdStr}`,
          data: { hash: result.hash },
        });
      }

      // 8. Notificação de SAÍDA para o remetente
      const tokenPrice = prices[currency]?.USD || 0;
      const sentUsdVal = (totalAmountWithFee * tokenPrice).toFixed(2);
      const sentUsdStr = tokenPrice > 0 && sentUsdVal !== "0.00" ? ` (~$ ${sentUsdVal})` : '';
      await notificationService.pushNotification({
        type: 'pagamento',
        title: 'Transferência enviada',
        description: `Você enviou ${grossAmount} ${currency} para ${destDisplay}.`,
        amount: `-${totalAmountWithFee}`,
        currency: `${currency}${sentUsdStr}`,
        data: { hash: result.hash },
      });

      setIsResultModalVisible(true);
    } catch (err: any) {
      console.error('[executeTransfer] Erro:', err);
      Alert.alert(t('Erro no Envio'), err.message || t('Falha ao processar.'));
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleBarCodeScanned = (data: string) => {
    let address = data;
    if (data.includes(':')) {
      const parts = data.split(':');
      address = parts[1].split('?')[0];
      if (data.includes('amount=')) {
        const amt = data.split('amount=')[1].split('&')[0];
        setAmount(amt);
      }
    }
    setDestinatario(address);
    setIsScannerVisible(false);
  };

  const startScanner = () => {
    Keyboard.dismiss();
    setTimeout(() => setIsScannerVisible(true), 300);
  };

  const renderInsufficientFunds = () => {
    if (amount === '' || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return null;
    const currentBalance = allBalances[currency] || 0;
    const amountVal = parseFloat(amount.replace(',', '.'));
    
    let isShort = false;
    // Consideramos a taxa de 2% (Fee Verum) + Gas (Sincronizado com a reserva do botão Confirmar)
    const totalRequired = (amountVal * (1 + VERUM_FEE_PCT));
    const solBalance = allBalances['SOL'] || 0;

    if (currency === 'SOL') {
      // Para SOL, totalRequired já inclui o envio. Somamos a reserva de gás.
      isShort = (totalRequired + SOL_GAS_RESERVE) > (currentBalance + 0.000000001);
    } else {
      // Para tokens, checamos o saldo do token e a reserva mínima de SOL para gás
      isShort = totalRequired > (currentBalance + 0.000000001) || solBalance < SOL_GAS_RESERVE;
    }
    if (!isShort) return null;
    return (
      <Text style={styles.insufficientText}>
        <Feather name="alert-circle" size={10} /> {t('Saldo insuficiente para envio')}
      </Text>
    );
  };

  const amountNum = parseFloat(amount) || 0;
  const platformFeeValue = amountNum * VERUM_FEE_PCT;
  const networkFeeUsd = networkFeeSol * (prices['SOL']?.USD || 0);

  return (
    <View style={{ flex: 1, backgroundColor: V.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <StatusBar barStyle="light-content" />
          <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

          <TouchableWithoutFeedback onPress={() => setCurrencyDropdownOpen(false)}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.titleBox}>
                <Text style={styles.title}>{t('ENVIAR ATIVOS')}</Text>
                <View style={styles.goldLine} />
                <Text style={styles.subtitle}>{t('Transfira fundos com segurança dentro da rede Solana.')}</Text>
              </View>

              {/* Calculadora de Câmbio vinculada ao input principal */}
              <CurrencyConverter 
                value={usdValue} 
                onUSDValueChange={(v) => {
                  setUsdValue(v);
                  setActiveInput('usd');
                }} 
              />

              <View style={styles.card}>
                {/* Destinatário */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, errors.destinatario && { color: V.danger }]}>DESTINATÁRIO</Text>
                  <View style={[styles.inputWrapper, errors.destinatario && { borderColor: V.danger, borderWidth: 1 }]}>
                    <Feather name="user" size={18} color={errors.destinatario ? V.danger : V.gold} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={t('Endereço de carteira')}
                      placeholderTextColor={V.muted}
                      autoCapitalize="none"
                      value={destinatario}
                      onChangeText={(v) => { setDestinatario(v); if (errors.destinatario) setErrors({...errors, destinatario: undefined}); }}
                    />
                    <TouchableOpacity onPress={startScanner} style={{ paddingRight: 16 }}>
                      <MaterialCommunityIcons name="qrcode-scan" size={20} color={errors.destinatario ? V.danger : V.gold} />
                    </TouchableOpacity>
                  </View>
                  {errors.destinatario && <Text style={styles.errorText}>{errors.destinatario}</Text>}
                </View>

                {/* Moeda + Valor */}
                <View style={[styles.row, isCurrencyDropdownOpen && { zIndex: 1000, elevation: 10 }]}>
                  <View style={[styles.inputGroup, { flex: 3, marginRight: 12 }, isCurrencyDropdownOpen && { zIndex: 1000 }]}>
                    <Text style={styles.label}>MOEDA</Text>
                    <TouchableOpacity style={styles.dropdown} onPress={() => setCurrencyDropdownOpen(!isCurrencyDropdownOpen)}>
                      <Text style={styles.dropdownText}>{currency}</Text>
                      <Feather name="chevron-down" size={18} color={V.gold} />
                    </TouchableOpacity>
                    {isCurrencyDropdownOpen && (
                      <View style={styles.dropdownList}>
                        {['SOL', 'USDT', 'BDC', 'ESCT', 'BRT'].map((item) => (
                          <TouchableOpacity key={item} style={styles.dropdownItem} onPress={() => { setCurrency(item); setCurrencyDropdownOpen(false); }}>
                            <Text style={styles.dropdownItemText}>{item}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={[styles.inputGroup, { flex: 7 }]}>
                    <Text style={[styles.label, errors.amount && { color: V.danger }]}>VALOR</Text>
                    <View style={[styles.inputWrapper, errors.amount && { borderColor: V.danger, borderWidth: 1 }]}>
                      <TextInput
                        style={[styles.input, styles.valueInput]}
                        placeholder="0.00"
                        placeholderTextColor={V.muted}
                        keyboardType="decimal-pad"
                        value={amount}
                        onFocus={() => setActiveInput('amount')}
                        onChangeText={(v) => { 
                          setAmount(v); 
                          setActiveInput('amount');
                          if (errors.amount) setErrors({...errors, amount: undefined}); 
                        }}
                      />
                      <TouchableOpacity onPress={handleMaxPress} style={{ marginRight: 8 }}>
                        <Text style={styles.maxText}>MÁX</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.valueMeta}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.usdEquiv}>
                          ≈ $ {((parseFloat(amount.replace(',', '.')) || 0) * (prices[currency]?.USD || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                        <Text style={styles.balanceInfo}>
                          {t('Saldo')}: {allBalances[currency]?.toFixed(currency === 'SOL' ? 6 : 4) || '0'} {currency}
                        </Text>
                      </View>
                      {errors.amount ? (
                        <Text style={styles.errorTextSmall}>{errors.amount}</Text>
                      ) : (
                        renderInsufficientFunds()
                      )}
                    </View>
                  </View>
                </View>

                {/* ── Seção de Taxas com Tooltip ── */}
                {amountNum > 0 && (
                  <View style={styles.feeSection}>
                    <View style={styles.feeSectionHeader}>
                      <Feather name="layers" size={13} color={V.gold} />
                      <Text style={styles.feeSectionTitle}>TAXAS</Text>
                      <Text style={styles.feeSectionHint}>(toque  ⓘ  para ver o valor)</Text>
                    </View>

                    <FeeRow
                      label="Taxa Fee"
                      value={`${platformFeeValue.toFixed(currency === 'USDT' ? 4 : 6)} ${currency}\n≈ taxa adicional de 2%`}
                    />

                    <FeeRow
                      label="Taxa de Rede Solana"
                      value={`≈ ${networkFeeSol.toFixed(6)} SOL\n≈ $${networkFeeUsd.toFixed(6)}`}
                    />

                    <View style={styles.feeDivider} />
                    <View style={styles.feeNetRow}>
                      <Text style={styles.feeNetLabel}>Destinatário receberá</Text>
                      <Text style={styles.feeNetValue}>
                        {currency === 'SOL'
                          ? `${amountNum.toFixed(6)} SOL`
                          : `${amountNum.toFixed(4)} ${currency}`}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Descrição */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>{t('DESCRIÇÃO (OPCIONAL)')}</Text>
                  <TextInput
                    style={[styles.inputWrapper, styles.textArea, { color: V.text, fontFamily: F.semi, textAlignVertical: 'top', paddingTop: 12, backgroundColor: 'transparent', outlineStyle: 'none' as any }]}
                    placeholder={t('Referência da transação...')}
                    placeholderTextColor={V.muted}
                    multiline
                  />
                </View>

                <TouchableOpacity style={[styles.btn, isLoading && { opacity: 0.7 }]} onPress={handleTransferClick} disabled={isLoading}>
                  {isLoading ? <ActivityIndicator color={V.bg} /> : (
                    <>
                      <Feather name="send" size={18} color={V.bg} style={{ transform: [{ rotate: '45deg' }] }} />
                      <Text style={styles.btnText}>{t('CONFIRMAR ENVIO')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableWithoutFeedback>

          <BottomNav activeRoute="none" />
          <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
        </View>

        {/* ── Simulation Preview Modal ── */}
        <Modal visible={isPreviewModalVisible} transparent animationType="slide">
          <View style={styles.mOverlay}>
            <View style={styles.mContent}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Feather name="globe" size={20} color={V.gold} style={{ marginRight: 8 }} />
                <Text style={styles.mTitle}>{t('SIMULAÇÃO DA REDE')}</Text>
              </View>
              <Text style={styles.mDesc}>{t('Transação simulada com sucesso na Solana. Revise os detalhes:')}</Text>

              <View style={{ backgroundColor: V.surface2, padding: 16, borderRadius: V.r8, marginBottom: 20 }}>
                <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('Destinatário')}</Text>
                <Text style={{ color: V.text, fontFamily: F.bold, marginBottom: 12, fontSize: 13 }} numberOfLines={1} ellipsizeMode="middle">
                  {resolvedDestAddr || destinatario}
                </Text>

                {/* ── O Destinatário Receberá — destaque (1º) ── */}
                <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('O Destinatário Receberá')}</Text>
                 <Text style={{ color: V.text, fontFamily: F.bold, fontSize: 12, marginBottom: 4 }}>
                   {amount} {currency}
                 </Text>
                 <Text style={{ color: V.success, fontFamily: F.title, fontSize: 22, marginBottom: 16 }}>
                   {'≈ $'}{((parseFloat(amount || '0') || 0) * (prices[currency]?.USD || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                 </Text>

                {/* ── Custo Total — secundário (2º) ── */}
                <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('Custo Total (Envio + Taxa 2%)')}</Text>
                <Text style={{ color: V.text, fontFamily: F.semi, fontSize: 14 }}>
                  {(parseFloat(amount || '0') * 1.02).toFixed(6)} {currency}
                </Text>
              </View>

              <View style={styles.mSwipeArea}>
                <TouchableOpacity onPress={() => setIsPreviewModalVisible(false)} style={styles.mCancelLink}>
                  <Text style={[styles.mCancelText, { color: V.danger }]}>{t('CANCELAR')}</Text>
                </TouchableOpacity>
                <SwipeToConfirm
                  onConfirm={handleConfirmPreview}
                  disabled={isLoading}
                  label={t('Deslize para confirmar')}
                />
              </View>
            </View>
          </View>
        </Modal>

        {/* Password Modal */}
        <PasswordModal
          isVisible={isPasswordModalVisible}
          onClose={() => { setIsPasswordModalVisible(false); setPasswordError(null); }}
          loading={isLoading}
          title={t('CONFIRMAR ENVIO')}
          description={t('Digite sua senha mestre para transferir ativos:')}
          onConfirm={handleConfirmPassword}
          errorMessage={passwordError || undefined}
        />

        {/* Loading Overlay — Transformado em View absoluto para evitar crash de múltiplos Modals no React Native */}
        {isLoading && loadingStep !== '' && (
          <View style={[StyleSheet.absoluteFillObject, styles.mOverlay, { zIndex: 9999, elevation: 9999 }]}>
            <View style={[styles.rCard, { paddingVertical: 40 }]}>
              <ActivityIndicator size="large" color={V.gold} style={{ marginBottom: 20 }} />
              <Text style={[styles.rTitle, { fontSize: 15 }]}>{t('Processando...')}</Text>
              <Text style={[styles.rSub, { marginBottom: 0, fontSize: 12 }]}>{t(loadingStep)}</Text>
            </View>
          </View>
        )}

        {/* Result Modal */}
        <Modal visible={isResultModalVisible} transparent animationType="fade">
          <View style={styles.mOverlay}>
            <View style={styles.rCard}>
              <View style={[styles.rIcon, { borderColor: error ? V.danger : V.success }]}>
                <Feather name={error ? 'x' : 'check'} size={40} color={error ? V.danger : V.success} />
              </View>
              <Text style={[styles.rTitle, { color: error ? V.danger : V.success }]}>{error ? t('FALHA') : t('CONCLUÍDO')}</Text>
              <Text style={[styles.rSub, { color: error ? V.danger : V.success }]}>
                {error ? t('Não foi possível processar o envio.') : t('Sua transação foi enviada para a rede Solana.')}
              </Text>
              {txHash && !error && (
                <View style={{ backgroundColor: 'rgba(201,168,76,0.05)', padding: 12, borderRadius: 8, width: '100%', marginBottom: 24 }}>
                  <Text style={{ color: V.muted, fontSize: 10, fontFamily: F.bold, marginBottom: 4, textAlign: 'center' }}>HASH DA TRANSAÇÃO</Text>
                  <Text style={{ fontSize: 10, color: V.gold, textAlign: 'center', fontFamily: F.semi }} numberOfLines={1} ellipsizeMode="middle">
                    {txHash}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.okBtn, { backgroundColor: error ? V.danger : V.gold }]}
                onPress={() => { setIsResultModalVisible(false); if (!error) router.replace('/'); reset(); }}
              >
                <Text style={styles.okBtnText}>{t('FECHAR')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        </>
      </KeyboardAvoidingView>

      {/* QR Scanner — fora do KeyboardAvoidingView pra que re-renders do KAV
          (ao abrir/fechar teclado) não desestabilizem o foco da câmera. */}
      <QRScannerModal
        visible={isScannerVisible}
        onClose={() => setIsScannerVisible(false)}
        onScanned={handleBarCodeScanned}
        label={t('Posicione o QR Code no centro')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 120 },

  titleBox: { marginTop: 24, marginBottom: 32 },
  title: { fontSize: 28, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 50, height: 2, backgroundColor: V.gold, marginVertical: 8 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow },
  inputGroup: { marginBottom: 24 },
  errorText: { color: V.danger, fontSize: 11, fontFamily: F.semi, marginTop: 6, marginLeft: 4 },
  errorTextSmall: { color: V.danger, fontSize: 10, fontFamily: F.bold, marginTop: 4 },
  label: { fontSize: 11, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border },
  inputIcon: { marginLeft: 16 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 16, color: V.text, fontFamily: F.semi, fontSize: 15, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  valueInput: { fontSize: 18, fontFamily: F.bold },
  row: { flexDirection: 'row', gap: 0, alignItems: 'flex-start' },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border, padding: 14 },
  dropdownText: { color: V.text, fontFamily: F.bold, fontSize: 15 },
  dropdownList: { position: 'absolute', top: 76, left: 0, right: 0, backgroundColor: V.surface1, borderRadius: V.r8, borderWidth: 1, borderColor: V.border, zIndex: 100 },
  dropdownItem: { padding: 14, borderBottomWidth: 1, borderBottomColor: V.border },
  dropdownItemText: { color: V.text, fontFamily: F.semi },
  maxText: { fontSize: 10, fontFamily: F.bold, color: V.gold, backgroundColor: 'rgba(201,168,76,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  textArea: { height: 80, paddingHorizontal: 12 },

  // Fee Section
  feeSection: {
    backgroundColor: 'rgba(201,168,76,0.04)',
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.15)',
    padding: 14,
    marginBottom: 24,
  },
  feeSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  feeSectionTitle: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1, flex: 1 },
  feeSectionHint: { fontSize: 9, fontFamily: F.body, color: V.muted, fontStyle: 'italic' },
  feeDivider: { height: 1, backgroundColor: V.border, marginVertical: 8 },
  feeNetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeNetLabel: { fontSize: 12, fontFamily: F.semi, color: V.muted },
  feeNetValue: { fontSize: 13, fontFamily: F.bold, color: V.success },

  btn: { backgroundColor: V.gold, flexDirection: 'row', height: 56, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8 },
  btnText: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },

  scBg: { flex: 1, backgroundColor: '#000' },
  scOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scFrame: { width: 240, height: 240, borderWidth: 2, borderColor: V.gold, borderRadius: 24, marginBottom: 24 },
  scText: { color: '#fff', fontSize: 14, fontFamily: F.semi, backgroundColor: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 12, marginBottom: 32 },
  scClose: { padding: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 40, alignItems: 'center', justifyContent: 'center' },

  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  mContent: { backgroundColor: V.surface1, width: '100%', minWidth: 320, maxWidth: 650, borderRadius: V.r12, padding: 24, borderWidth: 1, borderColor: V.border },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  mTitle: { fontSize: 18, fontFamily: F.title, color: V.gold, marginBottom: 8 },
  mDesc: { fontSize: 13, fontFamily: F.body, color: V.muted, marginBottom: 20, lineHeight: 20 },
  mInputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: V.r8, paddingHorizontal: 16, marginBottom: 24, borderWidth: 1, borderColor: V.border },
  mInput: { flex: 1, color: V.text, paddingVertical: 14, marginLeft: 12, fontFamily: F.semi, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  mActions: { flexDirection: 'row', gap: 12 },
  mSwipeArea: { marginTop: 4 },
  mCancelLink: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
  mCancelText: { color: V.muted, fontFamily: F.bold, fontSize: 12, letterSpacing: 0.5 },
  subBtn: { flex: 1, height: 56, backgroundColor: V.gold, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center' },
  subBtnText: { color: V.bg, fontFamily: F.bold, fontSize: 14 },

  rCard: { backgroundColor: V.surface1, width: '100%', minWidth: 320, maxWidth: 650, borderRadius: V.r12, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: V.border },
  rIcon: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  rTitle: { fontSize: 20, fontFamily: F.title, color: V.text, marginBottom: 8 },
  rSub: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  okBtn: { width: '100%', height: 52, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center' },
  okBtnText: { color: V.bg, fontFamily: F.bold, fontSize: 14 },

  insufficientText: { color: V.danger, fontSize: 10, fontFamily: F.bold, marginTop: 4 },
  valueMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingHorizontal: 4 },
  usdEquiv: { color: V.muted, fontSize: 11, fontFamily: F.semi },
  balanceInfo: { color: V.muted, fontSize: 11, fontFamily: F.bold, marginTop: 4 },
});
