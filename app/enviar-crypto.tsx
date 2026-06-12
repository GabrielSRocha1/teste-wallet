import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import QRScannerModal from '@/components/QRScannerModal';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SwipeToConfirm from '@/components/SwipeToConfirm';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useSendPayment } from '@/src/hooks/useSendPayment';
import keyManager from '@/src/services/keyManager';
import { supabase } from '@/src/services/supabase';
import transactionService, { VERUM_TREASURY_ADDRESS, VERUM_FEE_PERCENT } from '@/src/services/transactionService';
import notificationService from '@/src/services/notificationService';
import { V, F, PAD } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import * as LocalAuthentication from 'expo-local-authentication';
import { getBiometricsEnabled } from '@/constants/biometrics-storage';
import PasswordModal from '@/components/PasswordModal';
import CurrencyConverter from '@/components/CurrencyConverter';
import { Keypair, PublicKey } from '@solana/web3.js';

const VERUM_FEE_PCT = VERUM_FEE_PERCENT;

/** Valida se o input é uma chave pública Solana base58 válida (32 bytes). */
function isValidSolanaAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}
// Token metadata resolving now primarily depends on transactionService.getTokenMints() for network consistency.

// ─── FeeRow: Label + ícone info + tooltip animado ──────────────────────────
function FeeRow({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const show = () => {
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start(() => setVisible(false));
    }, 3000);
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, position: 'relative' }}>
      <Text style={{ fontSize: 12, fontFamily: F.semi, color: V.muted, flex: 1 }}>{label}</Text>
      <TouchableOpacity onPress={show} style={{ padding: 4, marginLeft: 8 }} activeOpacity={0.7}>
        <Feather name="info" size={15} color={V.gold} />
      </TouchableOpacity>
      {visible && (
        <Animated.View style={{ opacity, position: 'absolute', right: 30, top: -4, backgroundColor: V.surface1, borderWidth: 1, borderColor: V.gold, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 160, maxWidth: 240, zIndex: 999, elevation: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: F.semi, color: V.text, lineHeight: 18 }}>{value}</Text>
        </Animated.View>
      )}
    </View>
  );
}

export default function EnviarCryptoScreen() {
  const insets = useSafeAreaInsets();
  const { prices, t, network: currentNetwork } = useSettings();
  const { crypto: cryptoParam } = useLocalSearchParams<{ crypto: string }>();

  interface TokenOption {
    symbol: string;
    name: string;
    label: string;
    balance: number;
    mint?: string;
    decimals?: number;
  }

  const [availableTokens, setAvailableTokens] = useState<TokenOption[]>([]);
  const [crypto, setCrypto] = useState(cryptoParam ? String(cryptoParam) : 'SOL');
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [txResultError, setTxResultError] = useState<string | null>(null);
  const [localTxHash, setLocalTxHash] = useState<string | null>(null);
  const [resolvedDest, setResolvedDest] = useState<{ walletAddress: string; userId: string | null; email: string | null } | null>(null);
  const [senderWallet, setSenderWallet] = useState('');

  useEffect(() => {
    if (cryptoParam) setCrypto(String(cryptoParam).toUpperCase());
  }, [cryptoParam]);
  const [walletAddress, setWalletAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [usdValue, setUsdValue] = useState('');
  const [activeInput, setActiveInput] = useState<'amount' | 'usd' | null>(null);

  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { buildAndPreview, signAndSend, status, error: txError, preview, reset, txHash } = useSendPayment();
  const [isResultModalVisible, setIsResultModalVisible] = useState(false);
  const [isPreviewModalVisible, setIsPreviewModalVisible] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ walletAddress?: string; amount?: string }>({});

  // 1. Quando o usuário edita a QUANTIDADE DE TOKEN
  useEffect(() => {
    if (activeInput === 'amount') {
      if (!amount || amount === '0') {
        setUsdValue('');
        return;
      }
      const price = prices[crypto]?.USD || 0;
      const amtNum = parseFloat(amount.replace(',', '.'));
      if (!isNaN(amtNum) && price > 0) {
        const newVal = (amtNum * price).toFixed(2);
        if (newVal !== usdValue) setUsdValue(newVal);
      }
    }
  }, [amount, crypto, prices]);

  // 2. Quando o usuário edita o VALOR EM DÓLAR (via calculadora)
  useEffect(() => {
    if (activeInput === 'usd') {
      if (!usdValue || usdValue === '0' || usdValue === '0.00') {
        setAmount('');
        return;
      }
      const price = prices[crypto]?.USD || 0;
      const valNum = parseFloat(usdValue);
      if (!isNaN(valNum) && price > 0) {
        const newVal = (valNum / price).toFixed(6).replace(/\.?0+$/, '');
        if (newVal !== amount) setAmount(newVal);
      }
    }
  }, [usdValue, crypto, prices]);

  useEffect(() => {
    checkBiometrics();
    const fetchTokens = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        let wallet = user.user_metadata?.wallet_address;
        if (!wallet) {
          const { data: profile } = await supabase.from('usuarios').select('wallet_address').eq('id', user.id).single();
          wallet = profile?.wallet_address;
        }
        if (!wallet) return;
        setSenderWallet(wallet);

        const activeMints = transactionService.getTokenMints();
        const res = await transactionService.getBalances(wallet, activeMints);
        const mergedBalances = { ...res.balances };
        
        const tokens: TokenOption[] = [];
        const cryptoParamStr = cryptoParam ? String(cryptoParam).toUpperCase() : '';
        
        // 1. SOL
        const solBal = mergedBalances['SOL'] || 0;
        if (solBal > 0 || cryptoParamStr === 'SOL' || !cryptoParam) {
           tokens.push({ symbol: 'SOL', name: 'Solana', label: 'SOL - Solana', balance: solBal });
        }

        // 2. Tokens Conhecidos (Rede Atual)
        const KNOWN_DATA: Record<string, string> = {
          BDC: 'BodeCoin',
          ESCT: 'Escoteiros',
          BRT: 'Brutos',
          USDT: 'Tether',
          USDC: 'USD Coin'
        };

        for (const [sym, balance] of Object.entries(mergedBalances)) {
          if (sym === 'SOL') continue;
          
          const isSelected = sym.toUpperCase() === cryptoParamStr;
          const hasBalance = balance > 0;

          if (hasBalance || isSelected) {
            const name = KNOWN_DATA[sym] || sym;
            const mint = activeMints[sym];
            const decimals = sym === 'USDT' || sym === 'USDC' ? 6 : 9;
            
            if (!tokens.find(t => t.symbol === sym)) {
               tokens.push({ 
                 symbol: sym, 
                 name, 
                 label: `${sym} - ${name}`, 
                 balance, 
                 mint, 
                 decimals
               });
            }
          }
        }

        // 3. Tokens dinâmicos (que o usuário tenha e não foram incluídos)
        res.dynamicTokens.forEach((dt: any) => {
          if (!tokens.find(t => t.symbol === dt.symbol)) {
             if (dt.balance > 0 || dt.symbol.toUpperCase() === cryptoParamStr) {
               tokens.push({ 
                 symbol: dt.symbol, 
                 name: dt.name, 
                 label: `${dt.symbol} - ${dt.name}`, 
                 balance: dt.balance, 
                 mint: dt.mint, 
                 decimals: dt.decimals 
               });
             }
          }
        });

        setAvailableTokens(tokens);
        
        if (cryptoParam) {
          setCrypto(String(cryptoParam).toUpperCase());
        } else if (!tokens.find(t => t.symbol === crypto)) {
          setCrypto(tokens.length > 0 ? tokens[0].symbol : 'SOL');
        }
      } catch (err) {
        console.warn('Erro ao carregar tokens dinâmicos', err);
      }
    };

    fetchTokens();
  }, [cryptoParam]);

  const checkBiometrics = async () => {
    try {
      const { hasHardwareAsync, isEnrolledAsync } = require('expo-local-authentication');
      const hasHardware = await hasHardwareAsync();
      const isEnrolled = await isEnrolledAsync();
      setIsBiometricAvailable(hasHardware && isEnrolled);
    } catch (e) {
      setIsBiometricAvailable(false);
    }
  };

  const handleBarCodeScanned = (data: string) => {
    let address = data;
    if (data.startsWith('solana:')) address = data.replace('solana:', '').split('?')[0];
    setWalletAddress(address);
    setIsScannerVisible(false);
  };

  const startScanner = () => {
    Keyboard.dismiss();
    setTimeout(() => setIsScannerVisible(true), 300);
  };

  // Resolve email → endereço de carteira (se aplicável)
  const resolveDestinationWallet = async (input: string): Promise<{ walletAddress: string; userId: string | null; email: string | null }> => {
    let rawInput = input.trim();
    if (rawInput.toLowerCase().startsWith('solana:')) {
      rawInput = rawInput.split(':')[1].split('?')[0];
    }

    if (rawInput.includes('@')) {
      const { data } = await supabase.from('usuarios').select('id, wallet_address, email').eq('email', rawInput.toLowerCase()).maybeSingle();
      if (data?.wallet_address) return { walletAddress: data.wallet_address, userId: data.id, email: data.email };
      throw new Error(`Usuário "${rawInput}" não encontrado na Verum.`);
    }
    const { data } = await supabase.from('usuarios').select('id, email').eq('wallet_address', rawInput).maybeSingle();
    return { walletAddress: rawInput, userId: data?.id || null, email: data?.email || null };
  };

  const handleSend = async () => {
    const newErrors: { walletAddress?: string; amount?: string } = {};
    const trimmedDest = walletAddress.trim();
    if (!trimmedDest) {
      newErrors.walletAddress = t('Preencha o destinatário');
    } else {
      // Aceita email Verum (contém '@') ou chave Solana base58 válida.
      const looksLikeEmail = trimmedDest.includes('@');
      const looksLikeSolanaUri = trimmedDest.toLowerCase().startsWith('solana:');
      const rawForValidation = looksLikeSolanaUri
        ? trimmedDest.split(':')[1]?.split('?')[0] ?? ''
        : trimmedDest;
      if (!looksLikeEmail && !isValidSolanaAddress(rawForValidation)) {
        newErrors.walletAddress = t('Endereço Solana inválido');
      }
    }
    if (!amount || parseFloat(amount.replace(',', '.')) <= 0) newErrors.amount = t('Valor inválido');

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    
    setIsLoading(true);
    setLoadingStep(t('Simulando transação na rede...'));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Erro de autenticação ao tentar simular.'));

      let fromAddress = senderWallet || user.user_metadata?.wallet_address;
      if (!fromAddress) {
        const { data: profile } = await supabase.from('usuarios').select('wallet_address').eq('id', user.id).single();
        if (profile?.wallet_address) fromAddress = profile.wallet_address;
      }
      if (!fromAddress) throw new Error(t('Endereço da carteira não encontrado.'));
      setSenderWallet(fromAddress);

      // Resolve destino (suporta email Verum)
      const resolved = await resolveDestinationWallet(walletAddress);
      const destAddr = resolved.walletAddress;
      setResolvedDest(resolved);

      if (destAddr === fromAddress) {
         throw new Error(t('Você não pode enviar cripto para o seu próprio endereço.'));
      }

      const amountNum = parseFloat(amount.replace(',', '.'));
      const feeW = VERUM_TREASURY_ADDRESS;

      const selectedToken = availableTokens.find(t => t.symbol === crypto);
      if (!selectedToken) throw new Error(t('Ativo não suportado ou sem contrato definido. Selecione um ativo da sua carteira.'));

      const previewRes = await buildAndPreview({
        type: crypto === 'SOL' ? 'SOL' : 'SPL',
        sol: crypto === 'SOL' ? { from: fromAddress, to: destAddr, amount: amountNum, feeWallet: feeW } : undefined,
        spl: crypto !== 'SOL' ? (() => {
          if (!selectedToken.mint || selectedToken.decimals === undefined) return undefined;
          return { from: fromAddress, to: destAddr, mintAddress: selectedToken.mint, amount: amountNum, decimals: selectedToken.decimals, feeWallet: feeW };
        })() : undefined
      });

      if (previewRes) {
        setIsPreviewModalVisible(true);
      } else {
        Alert.alert(t('Falha na Simulação'), t('Verifique seu saldo, o endereço de destino e os custos de rede.'));
      }
    } catch (err: any) {
      Alert.alert(t('Erro de Simulação'), err.message || t('Ocorreu um erro ao montar a transação.'));
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };
  const handleConfirmPreview = async () => {
    setIsPreviewModalVisible(false);

    // Web nunca usa biometria — vai direto para a senha
    if (Platform.OS === 'web') {
      setIsPasswordModalVisible(true);
      return;
    }

    // Nativo: tenta biometria se estiver ativa e disponível
    const isBioActive = await getBiometricsEnabled();
    if (isBioActive && isBiometricAvailable) {
      const bioResult = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Confirme sua identidade para enviar'),
        fallbackLabel: t('Usar Senha'),
      });

      if (bioResult.success) {
        const savedPin = await keyManager.getPinForBiometrics();
        if (savedPin) {
          try {
            const kp = await keyManager.loadDecrypted(savedPin);
            executeEnvio(kp);
            return;
          } catch (e) {
            console.warn('[enviar] Falha ao usar PIN via biometria, pedindo senha', e);
          }
        }
      }
      // Cancelou, falhou ou PIN inválido → cai para senha
    }

    // Sem biometria ativa ou qualquer falha → abre modal de senha
    setIsPasswordModalVisible(true);
  };

  const onConfirmPassword = async (password: string) => {
    if (!password) return;
    setIsLoading(true);
    setPasswordError(null);
    setLoadingStep(t('Verificando senha...'));
    try {
      const keypair = await keyManager.loadDecrypted(password.trim());
      const mnemonic = await keyManager.getMnemonic(password.trim());
      await keyManager.startSession(mnemonic, keypair, password.trim());
      // Fecha o modal apenas se a senha estiver correta
      setIsPasswordModalVisible(false);
      setPasswordError(null);
      if (!preview) {
        // Preview perdido (ex: app em background) — exibe erro claro
        setIsLoading(false);
        setLoadingStep('');
        Alert.alert(t('Erro'), t('Dados de simulação expirados. Por favor, inicie o envio novamente.'));
        return;
      }
      executeEnvio(keypair);
    } catch (err: any) {
      console.error('[onConfirmPassword] Erro ao decifrar chave:', err?.message);
      // Mantém o modal ABERTO e exibe erro inline
      setPasswordError(t('Senha incorreta. Verifique e tente novamente.'));
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const executeEnvio = async (signerKeypair: Keypair) => {
    setIsLoading(true);
    try {
      if (!preview) throw new Error('Dados de simulação perdidos. Tente novamente.');

      setLoadingStep(t('Assinando transação...'));
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const amountNum = parseFloat(amount.replace(',', '.'));
      
      const usdPrice = prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0;
      const usdAmountVal = amountNum * usdPrice;
      const feeUSD = Math.max(0.50, usdAmountVal * 0.02);
      const platformFee = usdPrice > 0 ? +(feeUSD / usdPrice).toFixed(9) : +(amountNum * 0.02).toFixed(9);
      const totalAmountWithFee = +(amountNum + platformFee).toFixed(9);
      const netAmount = amountNum;

      const destData = resolvedDest || await resolveDestinationWallet(walletAddress);
      const destAddr = destData.walletAddress;

      setLoadingStep(t('Enviando para a blockhain...'));
      const result = await signAndSend(preview.transaction, signerKeypair);

      if (!result || (result.status !== 'confirmed' && !result.hash)) {
        throw new Error(t('Falha ao enviar transação. Verifique sua conexão e saldo.'));
      }

      setLoadingStep(t('Registrando transação...'));
      const { data: senderData } = await supabase.from('usuarios').select('nome_completo, email').eq('id', user.id).single();
      const senderName = senderData?.nome_completo || senderData?.email || 'Usuário Verum';
      const destDisplay = destData.email || destAddr.substring(0, 8) + '...' + destAddr.slice(-4);

      const saveRes = await transactionService.saveTransaction({
        senderId: user.id,
        senderWallet: signerKeypair.publicKey.toBase58(),
        destUserId: destData.userId,
        destAddress: destAddr,
        amount: amountNum,
        currency: crypto,
        description: undefined,
        txHash: result.hash,
        senderName: senderName
      });
      
      if (!saveRes.success) {
        console.error('[enviar] Erro no histórico, mas fundos enviados:', saveRes.error);
      }

      // Notificação p/ Destinatário (se usuário Verum)
      if (destData.userId && destData.email) {
        const price = prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0;
        const recvUsdVal = (netAmount * price).toFixed(2);
        const recvUsdStr = price > 0 && recvUsdVal !== '0.00' ? ` (~$ ${recvUsdVal})` : '';
        await notificationService.pushToEmail(destData.email, {
          type: 'recebimento',
          title: 'Transferência recebida',
          description: `Você recebeu ${netAmount} ${crypto} de ${senderName}.`,
          amount: `+${netAmount}`,
          currency: `${crypto}${recvUsdStr}`,
          data: { hash: result.hash },
        });
      }

      // Notificação de SAÍDA
      const priceSent = prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0;
      const sentUsdVal = (totalAmountWithFee * priceSent).toFixed(2);
      const sentUsdStr = priceSent > 0 && sentUsdVal !== '0.00' ? ` (~$ ${sentUsdVal})` : '';
      await notificationService.pushNotification({
        type: 'pagamento',
        title: 'Transferência enviada',
        description: `Você enviou ${amountNum} ${crypto} para ${destDisplay}.`,
        amount: `-${totalAmountWithFee}`,
        currency: `${crypto}${sentUsdStr}`,
        data: { hash: result.hash },
      });

      setLocalTxHash(result.hash);
      setTxResultError(null);
      setIsResultModalVisible(true);
    } catch (err: any) {
      console.error('[executeEnvio]', err);
      // Alert.alert do React Native não renderiza no PWA/web — feedback de
      // erro precisa ir pelo modal de resultado (que já trata txResultError
      // mostrando ícone vermelho + título "FALHA" + a mensagem).
      setLocalTxHash(null);
      setTxResultError(err.message || t('Falha ao processar a transação.'));
      setIsResultModalVisible(true);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <Header
        onBackPress={() => router.back()}
        onMenuPress={() => setSidebarVisible(true)}
        showScanner
        onScannerPress={startScanner}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.titleBox}>
            <Text style={styles.title}>{t('ENVIAR CRIPTO')}</Text>
            <View style={styles.goldLine} />
            <Text style={styles.subtitle}>{t('Transfira ativos entre carteiras digitais no ecossistema Solana.')}</Text>
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
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('ATIVO')}</Text>
              <View style={styles.pickerBox}>
                <Picker selectedValue={crypto} onValueChange={setCrypto} style={styles.picker} dropdownIconColor={V.gold}>
                  <Picker.Item label={t('Escolha o ativo')} value="Escolha a criptomoeda" color={V.muted} style={{ backgroundColor: V.surface2 }} />
                  {availableTokens.map(tk => (
                    <Picker.Item key={tk.symbol} label={`${tk.label} (${tk.balance.toFixed(tk.decimals ? Math.min(tk.decimals, 4) : 4)})`} value={tk.symbol} color={V.text} style={{ backgroundColor: V.surface2 }} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, errors.amount && { color: V.danger }]}>{t('QUANTIDADE')}</Text>
              <View style={[styles.inputWrapper, errors.amount && { borderColor: V.danger, borderWidth: 1 }]}>
                <TextInput
                  style={[styles.input, { paddingRight: 78 }]}
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
                <TouchableOpacity
                  style={styles.maxBtnInside}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (crypto === 'Escolha a criptomoeda') return;
                    const token = availableTokens.find(t => t.symbol === crypto);
                    if (token) {
                      const bal = token.balance;
                      const gasEst = crypto === 'SOL' ? 0.000005 : 0;

                      // Regra: Amount + Fee = Bal - Gas
                      // Para valores pequenos, Fee = $0.50 / Price.
                      // Para valores maiores, Fee = Amount * 0.02.

                      const priceObj = prices[crypto];
                      const price = priceObj?.USD ?? priceObj?.BRL ?? 0;
                      const balNet = bal - gasEst;

                      if (price > 0) {
                        const feeFloorInToken = 0.50 / price;
                        let maxWithFloor = balNet - feeFloorInToken;

                        if (maxWithFloor * 0.02 * price > 0.50) {
                          maxWithFloor = balNet / 1.02;
                        }

                        setAmount(Math.max(0, maxWithFloor).toFixed(8).replace(/\.?0+$/, ''));
                      } else {
                        setAmount((balNet / 1.02).toFixed(8).replace(/\.?0+$/, ''));
                      }
                    }
                  }}
                >
                  <Text style={styles.maxBtnInsideText}>{t('MÁXIMO')}</Text>
                </TouchableOpacity>
              </View>
              {amount !== '' && parseFloat(amount.replace(',', '.')) > 0 && (prices[crypto]?.USD || prices[crypto]?.BRL) && (
                <Text style={styles.usdEquivalent}>
                  ≈ <Text style={{ color: '#FFFFFF', fontFamily: F.bold }}>$ {(parseFloat(amount.replace(',', '.')) * (prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</Text>
                </Text>
              )}
              {errors.amount && <Text style={{ color: V.danger, fontSize: 11, fontFamily: F.semi, marginTop: 6, marginLeft: 4 }}>{errors.amount}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, errors.walletAddress && { color: V.danger }]}>{t('ENDEREÇO DE DESTINO')}</Text>
              <View style={[styles.inputWrapper, errors.walletAddress && { borderColor: V.danger, borderWidth: 1 }]}>
                <TextInput style={[styles.input, { paddingRight: 50 }]} placeholder={t('Chave pública Solana')} placeholderTextColor={V.muted} autoCapitalize="none" value={walletAddress} onChangeText={(v) => { setWalletAddress(v); if (errors.walletAddress) setErrors({...errors, walletAddress: undefined}); }} />
                <TouchableOpacity style={styles.qrBtn} onPress={startScanner}><Ionicons name="qr-code-outline" size={20} color={errors.walletAddress ? V.danger : V.gold} /></TouchableOpacity>
              </View>
              {errors.walletAddress && <Text style={{ color: V.danger, fontSize: 11, fontFamily: F.semi, marginTop: 6, marginLeft: 4 }}>{errors.walletAddress}</Text>}
            </View>

            {/* Taxas com tooltip */}
            {parseFloat(amount.replace(',', '.')) > 0 && (
              <View style={styles.feeSection}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Feather name="layers" size={13} color={V.gold} />
                  <Text style={{ fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1, flex: 1 }}>TAXAS</Text>
                  <Text style={{ fontSize: 9, fontFamily: F.body, color: V.muted, fontStyle: 'italic' }}>(toque ⓘ para ver o valor)</Text>
                </View>
                <FeeRow
                  label="Taxa Verum"
                  value={`${(() => {
                    const amt = parseFloat(amount.replace(',', '.'));
                    const price = prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0;
                    const usdVal = amt * price;
                    const feeUSD = Math.max(0.50, usdVal * 0.02);
                    return price > 0 ? (feeUSD / price).toFixed(6) : '0';
                  })()} ${crypto}\n≈ regra: MAX($0.50, 2%)`}
                />
                <FeeRow
                  label="Taxa de Rede Solana"
                  value={`≈ 0.000005 SOL\n(pago em gas pela rede)`}
                />
              </View>
            )}
            <View style={styles.warning}>
              <MaterialCommunityIcons name="shield-alert-outline" size={20} color={V.gold} />
              <View style={{ flex: 1 }}>
                <Text style={styles.warningText}>{t('Certifique-se que o destinatário e a rede estão corretos. Uma taxa administrativa de $0.50 (mínimo) ou 2% será cobrada.')}</Text>
                <Text style={styles.warningText}>{t('O destinatário receberá o valor total enviado.')}</Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.mainBtn, isLoading && { opacity: 0.7 }]} onPress={handleSend} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color={V.bg} /> : (
                <>
                  <Text style={styles.mainBtnText}>{t('CONFIRMAR ENVIO')}</Text>
                  <Feather name="arrow-right" size={18} color={V.bg} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={isPreviewModalVisible} transparent animationType="slide">
        <View style={styles.mOverlay}>
          <View style={styles.mCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Feather name="globe" size={20} color={V.gold} style={{ marginRight: 8 }}/>
              <Text style={styles.mTitle}>{t('SIMULAÇÃO DA REDE')}</Text>
            </View>
            <Text style={styles.mDesc}>{t('Transação simulada com sucesso na Solana. Revise os detalhes:')}</Text>
            
            <View style={{ backgroundColor: V.surface2, padding: 16, borderRadius: V.r8, marginBottom: 20 }}>
               <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('Destinatário')}</Text>
               <Text style={{ color: V.text, fontFamily: F.bold, marginBottom: 12, fontSize: 13 }} numberOfLines={1} ellipsizeMode="middle">{walletAddress}</Text>

               {/* ── O Destinatário Receberá — agora em destaque (1º) ── */}
               <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('O Destinatário Receberá')}</Text>
                <Text style={{ color: V.text, fontFamily: F.bold, fontSize: 12, marginBottom: 4 }}>
                  {amount} {crypto}
                </Text>
                <Text style={{ color: V.success, fontFamily: F.title, fontSize: 22, marginBottom: 16 }}>
                  {'≈ $'}{((parseFloat(amount.replace(',', '.')) || 0) * (prices[crypto]?.USD ?? prices[crypto]?.BRL ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </Text>

               {/* ── Custo Total — agora secundário (2º) ── */}
               <Text style={{ color: V.muted, fontSize: 12, marginBottom: 4 }}>{t('Custo Total (Envio + Taxa 2%)')}</Text>
               <Text style={{ color: V.text, fontFamily: F.semi, fontSize: 14 }}>{(parseFloat(amount.replace(',', '.')) * 1.02).toFixed(6)} {crypto}</Text>

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

      <PasswordModal 
        isVisible={isPasswordModalVisible}
        onClose={() => { setIsPasswordModalVisible(false); setPasswordError(null); }}
        loading={isLoading}
        title={t('CONFIRMAR ENVIO')}
        description={t('Digite sua senha mestre para assinar a transação:')}
        onConfirm={(pwd: string) => onConfirmPassword(pwd)}
        errorMessage={passwordError || undefined}
      />

      {/* Loading Overlay */}
      {isLoading && loadingStep !== '' && (
        <View style={[StyleSheet.absoluteFillObject, styles.mOverlay, { zIndex: 9999, elevation: 9999 }]}>
          <View style={[styles.resCard, { paddingVertical: 40 }]}>
            <ActivityIndicator size="large" color={V.gold} style={{ marginBottom: 20 }} />
            <Text style={[styles.resTitle, { fontSize: 15, color: V.text }]}>{t('Processando...')}</Text>
            <Text style={[styles.resDesc, { marginBottom: 0, fontSize: 12 }]}>{loadingStep}</Text>
          </View>
        </View>
      )}

      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
      <BottomNav activeRoute="none" />

      {/* Result Modal */}
      <Modal visible={isResultModalVisible} transparent animationType="fade">
        <View style={styles.mOverlay}>
          <View style={styles.resCard}>
             <View style={[styles.resIcon, { borderColor: txResultError ? V.danger : V.success }]}>
               <Feather name={txResultError ? 'x' : 'check'} size={40} color={txResultError ? V.danger : V.success} />
             </View>
             <Text style={[styles.resTitle, { color: txResultError ? V.danger : V.success }]}>
               {txResultError ? t('FALHA') : t('CONCLUÍDO')}
             </Text>
             <Text style={[styles.resDesc, { color: txResultError ? V.danger : V.muted }]}>
               {txResultError || t('Transferência enviada com sucesso para a rede Solana.')}
             </Text>

             {localTxHash && !txResultError && (
                <View style={{ backgroundColor: 'rgba(201,168,76,0.05)', padding: 12, borderRadius: 8, width: '100%', marginBottom: 24 }}>
                  <Text style={{ color: V.muted, fontSize: 10, fontFamily: F.bold, marginBottom: 4, textAlign: 'center' }}>HASH DA TRANSAÇÃO</Text>
                  <Text style={{ fontSize: 10, color: V.gold, textAlign: 'center', fontFamily: F.semi }} numberOfLines={1} ellipsizeMode="middle">
                    {localTxHash}
                  </Text>
                </View>
              )}

             <TouchableOpacity 
               style={[styles.resBtn, { backgroundColor: txResultError ? V.danger : V.gold }]} 
               onPress={() => { 
                 setIsResultModalVisible(false); 
                 setTxResultError(null);
                 setLocalTxHash(null);
                 if (!txResultError) router.replace('/');
                 reset();
               }}
             >
               <Text style={styles.resBtnText}>{t('CONCLUIR')}</Text>
             </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <QRScannerModal
        visible={isScannerVisible}
        onClose={() => setIsScannerVisible(false)}
        onScanned={handleBarCodeScanned}
        label={t('Aponte para o QR Code')}
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
  label: { fontSize: 11, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 16, color: V.text, fontFamily: F.semi, fontSize: 16, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  pickerBox: { backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border, overflow: 'hidden' },
  picker: { height: 54, color: V.text, backgroundColor: V.surface2 },
  qrBtn: { position: 'absolute', right: 12, width: 36, height: 36, borderRadius: 8, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border },
  maxBtnInside: { position: 'absolute', right: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(201,168,76,0.12)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  maxBtnInsideText: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  usdEquivalent: { fontSize: 13, fontFamily: F.body, color: V.muted, marginTop: 10, marginLeft: 4 },
  feeSection: { backgroundColor: 'rgba(201,168,76,0.04)', borderRadius: V.r8, borderWidth: 1, borderColor: 'rgba(201,168,76,0.15)', padding: 14, marginBottom: 16 },
  warning: { backgroundColor: 'rgba(201,168,76,0.05)', borderRadius: V.r8, padding: 16, flexDirection: 'row', gap: 12, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(201,168,76,0.1)' },
  warningText: { flex: 1, fontSize: 12, color: V.muted, fontFamily: F.body, lineHeight: 18 },
  mainBtn: { backgroundColor: V.gold, borderRadius: V.r8, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  mainBtnText: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },

  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: PAD.modal },
  mCard: { backgroundColor: V.surface1, padding: 24, borderRadius: V.r12, width: '100%', minWidth: 320, maxWidth: 650, borderWidth: 1, borderColor: V.border },
  mTitle: { fontSize: 18, fontFamily: F.title, color: V.gold, marginBottom: 8 },
  mDesc: { fontSize: 13, fontFamily: F.body, color: V.muted, marginBottom: 20 },
  mInputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: V.r8, paddingHorizontal: 16, marginBottom: 24, borderWidth: 1, borderColor: V.border },
  mInput: { flex: 1, color: V.text, paddingVertical: 14, marginLeft: 12, fontFamily: F.semi, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  mSwipeArea: { marginTop: 4 },
  mCancelLink: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
  mCancelText: { color: V.muted, fontFamily: F.bold, fontSize: 12, letterSpacing: 0.5 },

  resCard: { backgroundColor: V.surface1, padding: 32, borderRadius: V.r12, width: '100%', minWidth: 320, maxWidth: 650, alignItems: 'center', borderWidth: 1, borderColor: V.border },
  resIcon: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  resTitle: { fontSize: 20, fontFamily: F.title, color: V.text, marginBottom: 12 },
  resDesc: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  resBtn: { width: '100%', paddingVertical: 16, borderRadius: V.r8, alignItems: 'center' },
  resBtnText: { color: V.bg, fontFamily: F.bold, fontSize: 14 },

  scBg: { flex: 1, backgroundColor: '#000' },
  scOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scFrame: { width: 240, height: 240, borderWidth: 2, borderColor: V.gold, borderRadius: 24, marginBottom: 24 },
  scText: { color: '#fff', fontSize: 14, fontFamily: F.semi, backgroundColor: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 12, marginBottom: 32 },
  scClose: { padding: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
});
