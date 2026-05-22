import { saveUser } from '@/constants/auth-storage';
import { useSettings } from '@/constants/SettingsContext';
import { F, V } from '@/constants/theme';
import PinPad from '@/components/PinPad';
import blockchainSyncService from '@/src/services/blockchainSyncService';
import { mnemonicToSeed, validateMnemonic } from '@/src/services/keyDerivation';
import keyManager from '@/src/services/keyManager';
import { supabase } from '@/src/services/supabase';
import transactionService from '@/src/services/transactionService';
import { walletSetupFlag } from '@/src/services/walletSetupFlag';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView,
  Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';

const showAlert = (title: string, message?: string, buttons?: any[]) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}${message ? '\n\n' + message : ''}`);
    if (buttons && buttons[0]?.onPress) buttons[0].onPress();
  } else {
    Alert.alert(title, message, buttons);
  }
};

// ── Screen ───────────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { t } = useSettings();
  const [loading, setLoading] = useState(false);

  // Create wallet flow
  const [isSetupModalVisible, setSetupModalVisible] = useState(false);
  const [setupStep, setSetupStep] = useState<'pin' | 'reveal'>('pin');
  const [setupPin, setSetupPin] = useState('');
  const [setupPinConfirm, setSetupPinConfirm] = useState('');

  // Shared reveal data
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [generatedPublicKey, setGeneratedPublicKey] = useState('');
  const [mnemonicCopied, setMnemonicCopied] = useState(false);
  const [recoveredBalances, setRecoveredBalances] = useState<any[]>([]);
  const [isFetchingBalances, setIsFetchingBalances] = useState(false);

  // Recovery flow
  const [isRecoveryModalVisible, setRecoveryModalVisible] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<'mnemonic' | 'confirmPin'>('mnemonic');
  const [recoveryMnemonic, setRecoveryMnemonic] = useState('');
  const [recoveryPin, setRecoveryPin] = useState('');
  const [recoveryPinConfirm, setRecoveryPinConfirm] = useState('');

  // ── Helper: salva wallet no Supabase (usuarios + wallets) ──────────────────
  const linkWalletToSupabase = async (params: {
    userId: string;
    email: string;
    walletAddress: string;
    nomCompleto?: string;
  }): Promise<boolean> => {
    const { userId, email, walletAddress, nomCompleto } = params;

    // Persiste na tabela de usuários
    const { error: upsertError } = await supabase.from('usuarios').upsert({
      id: userId,
      email: email.endsWith('.internal') ? null : email,
      wallet_address: walletAddress,
      nome_completo: nomCompleto,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (upsertError) {
      console.error('[Supabase] Erro ao vincular perfil:', upsertError);
      if (upsertError.code === '42501') {
        Alert.alert('Erro de Permissão', 'Não foi possível salvar seu perfil no Supabase.');
      }
      return false;
    }

    console.log('[Supabase] Perfil vinculado com sucesso para:', userId);
    return true;
  };

  // ── Create wallet ──────────────────────────────────────────────────────────
  const handleStartSetup = () => {
    setSetupStep('pin');
    setSetupPin('');
    setSetupPinConfirm('');
    setRecoveredBalances([]);
    setMnemonicCopied(false);
    setSetupModalVisible(true);
  };

  const handleFinishSetupPin = () => {
    if (setupPin.length < 6) {
      showAlert(t('Erro'), t('O PIN deve ter 6 dígitos.'));
      return;
    }
    if (setupPin !== setupPinConfirm) {
      showAlert(t('Erro'), t('Os PINs não coincidem.'));
      return;
    }
    handleCreateWallet();
  };

  const handleCreateWallet = async () => {
    walletSetupFlag.begin();
    setLoading(true);
    try {
      const wallet = keyManager.generateWallet();
      const mnemonic = wallet.mnemonic;
      const publicKey = wallet.publicKey;
      const privateKey = Buffer.from(wallet.keypair.secretKey).toString('hex');
      const userPin = setupPin;

      const authSeed = mnemonicToSeed(mnemonic, 'VERUM_AUTH_SALT');
      const supabaseEmail = `${publicKey.slice(0, 16).toLowerCase()}@verum.internal`;
      const supabasePassword = authSeed.slice(0, 24).toString('hex');

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: supabaseEmail,
        password: supabasePassword,
        options: { data: { full_name: t('Novo Investidor'), wallet_address: publicKey } },
      });

      let userId = authData?.user?.id;
      let sessionOk = !!authData?.session;

      // Se signUp retornou user mas sem sessão (email confirmation ON no Supabase),
      // tenta signin imediato para obter a sessão necessária para as políticas RLS
      if (!sessionOk && userId && !authError) {
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email: supabaseEmail,
          password: supabasePassword,
        });
        if (signInData?.session) {
          sessionOk = true;
          userId = signInData.user?.id ?? userId;
        }
      }

      if (authError && authError.message.includes('already registered')) {
        const { data: signInData } = await supabase.auth.signInWithPassword({
          email: supabaseEmail,
          password: supabasePassword,
        });
        userId = signInData?.user?.id;
        sessionOk = !!signInData?.session;
      }

      if (userId && sessionOk) {
        await linkWalletToSupabase({
          userId,
          email: supabaseEmail,
          walletAddress: publicKey,
          nomCompleto: t('Novo Investidor'),
        });
        const saveResult = await blockchainSyncService.saveWalletKeys({
          userId,
          publicKey,
          privateKeyHex: privateKey,
          userPassword: userPin,
          mnemonicPhrase: mnemonic,
          walletAddress: publicKey,
          blockchain: 'solana',
        });
        if (!saveResult.success) {
          console.error('[CreateWallet] Falha ao salvar chaves no Supabase:', saveResult.error);
        }
      } else if (userId && !sessionOk) {
        console.error('[CreateWallet] signUp sem sessão — desative "Confirm email" no Supabase Dashboard: Authentication → Providers → Email');
      }

      await keyManager.importNewWallet(mnemonic, userPin);
      await keyManager.startSession(mnemonic, wallet.keypair, userPin);
      await saveUser({ email: '', fullName: t('Novo Investidor') });
      // walletSetupFlag.end(); // Removido daqui para evitar redirect precoce


      setGeneratedMnemonic(mnemonic);
      setGeneratedPublicKey(publicKey);
      setSetupStep('reveal');
    } catch (err: any) {
      walletSetupFlag.end();
      showAlert(t('Erro ao criar'), err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Recovery ───────────────────────────────────────────────────────────────
  const openRecoveryModal = () => {
    setRecoveryStep('mnemonic');
    setRecoveryMnemonic('');
    setRecoveryPin('');
    setRecoveryPinConfirm('');
    setRecoveryModalVisible(true);
  };

  const handleRecoverProceed = () => {
    const norm = recoveryMnemonic.trim().toLowerCase();
    if (!norm || norm.split(/\s+/).length < 12) {
      showAlert(t('Erro'), t('Frase de recuperação inválida. Deve conter 12 palavras.'));
      return;
    }
    if (!validateMnemonic(norm)) {
      showAlert(t('Erro'), t('Palavras inválidas. Verifique a frase e tente novamente.'));
      return;
    }
    if (recoveryPin.length < 6) {
      showAlert(t('Erro'), t('O PIN deve ter 6 dígitos.'));
      return;
    }
    setRecoveryStep('confirmPin');
  };

  const handleRecoverWallet = async () => {
    if (recoveryPin !== recoveryPinConfirm) {
      showAlert(t('Erro'), t('Os PINs não coincidem.'));
      return;
    }

    const normalizedMnemonic = recoveryMnemonic.trim().toLowerCase();
    walletSetupFlag.begin();
    setLoading(true);

    let walletAddressLocal = '';
    let userIdLocal = '';

    try {
      const recovered = keyManager.importFromMnemonic(normalizedMnemonic);
      walletAddressLocal = recovered.publicKey;
      const evmAddress = recovered.fullWallet.evm.address;

      const authSeed = mnemonicToSeed(normalizedMnemonic, 'VERUM_AUTH_SALT');
      const supabaseEmail = `${walletAddressLocal.slice(0, 16).toLowerCase()}@verum.internal`;
      const supabasePassword = authSeed.slice(0, 24).toString('hex');

      let userData: any = null;
      let sessionOkRecovery = false;
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: supabaseEmail,
        password: supabasePassword,
      });

      if (!signInError && signInData.user) {
        userData = signInData.user;
        sessionOkRecovery = !!signInData.session;
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: supabaseEmail,
          password: supabasePassword,
          options: { data: { full_name: t('Usuário'), wallet_address: walletAddressLocal } },
        });

        if (signUpError) {
          // Se já registrado, tenta login novamente (pode ter falhado antes por senha ou erro temporário)
          if (signUpError.message.includes('already registered')) {
            const { data: retrySignIn, error: retryError } = await supabase.auth.signInWithPassword({
              email: supabaseEmail,
              password: supabasePassword,
            });
            if (retryError) throw retryError;
            userData = retrySignIn.user;
            sessionOkRecovery = !!retrySignIn.session;
          } else {
            throw signUpError;
          }
        } else {
          userData = signUpData.user;
          sessionOkRecovery = !!signUpData.session;
        }

        // Se signUp não retornou sessão (email confirmation ON), tenta signin para obter uma
        if (!sessionOkRecovery && userData) {
          const { data: reSignIn } = await supabase.auth.signInWithPassword({
            email: supabaseEmail,
            password: supabasePassword,
          });
          if (reSignIn?.session) {
            sessionOkRecovery = true;
            userData = reSignIn.user ?? userData;
          }
        }
      }

      userIdLocal = userData?.id ?? '';

      if (userIdLocal && sessionOkRecovery) {
        console.log('[Recover] Salvando carteira recuperada na tabela usuarios...');

        // Sempre tenta vincular/atualizar o endereço na tabela 'usuarios'
        // Isso garante que o saldo centralizado funcione conforme solicitado.
        await linkWalletToSupabase({
          userId: userIdLocal,
          email: supabaseEmail,
          walletAddress: walletAddressLocal,
          nomCompleto: t('Usuário'),
        });
      }

      // IMPORTANTE: Sempre salvar as chaves na tabela 'wallets' para este dispositivo
      const imported = await keyManager.importNewWallet(normalizedMnemonic, recoveryPin);
      await keyManager.startSession(imported.mnemonic, imported.keypair, recoveryPin);

      void evmAddress;
      await saveUser({ email: '', fullName: t('Usuário') });

      if (userIdLocal && sessionOkRecovery) {
        const privateKeyHex = Buffer.from(imported.keypair.secretKey).toString('hex');
        console.log('[Recover] Sincronizando chaves de segurança na tabela wallets...');
        const saveResult = await blockchainSyncService.saveWalletKeys({
          userId: userIdLocal,
          publicKey: imported.keypair.publicKey.toBase58(),
          privateKeyHex,
          userPassword: recoveryPin,
          mnemonicPhrase: normalizedMnemonic,
          walletAddress: walletAddressLocal,
          blockchain: 'solana',
        });

        if (!saveResult.success) {
          console.error('[RecoverWallet] Falha ao sincronizar com Supabase:', saveResult.error);
        }
      }

      setGeneratedMnemonic(normalizedMnemonic);
      setGeneratedPublicKey(walletAddressLocal);
      setRecoveredBalances([]);
      setMnemonicCopied(false);

      // Close recovery, open reveal
      setRecoveryModalVisible(false);
      setSetupStep('reveal');
      setSetupModalVisible(true);
    } catch (error: any) {
      walletSetupFlag.end();
      showAlert(t('Erro na Recuperação'), error.message);
      setLoading(false);
      return;
    }

    setLoading(false);

    // Fetch on-chain balances in background after modal opens
    setIsFetchingBalances(true);
    try {
      const summary = await blockchainSyncService.getRecoveryBalanceSummary(walletAddressLocal);
      setRecoveredBalances(
        summary.map(item => ({
          symbol: item.symbol,
          balance: item.balance,
          usdValue: item.usdValue,
          icon: item.icon || null,
        }))
      );
      if (userIdLocal) {
        blockchainSyncService.syncBalancesToSupabase(userIdLocal, walletAddressLocal).catch(() => { });
      }
    } catch (e) {
      console.warn('Erro ao buscar saldos iniciais:', e);
      try {
        const mints = transactionService.getTokenMints();
        const result = await transactionService.getBalances(walletAddressLocal, mints);
        const solBalance = result.balances['SOL'] || 0;
        const activeFixed = Object.entries(result.balances)
          .filter(([symbol, bal]) => symbol !== 'SOL' && bal > 0)
          .map(([symbol, bal]) => ({ symbol, balance: bal as number, usdValue: 0, icon: null }));
        setRecoveredBalances([
          { symbol: 'SOL', balance: solBalance, usdValue: 0, icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
          ...activeFixed,
        ]);
      } catch { }
    } finally {
      setIsFetchingBalances(false);
    }
  };

  const handlePasteMnemonic = async () => {
    try {
      let content = '';
      // Em browsers o expo-clipboard depende de navigator.clipboard.readText.
      // Se a permissão foi negada antes, getStringAsync devolve '' silenciosamente —
      // vamos primeiro tentar a API nativa direto pra distinguir vazio vs bloqueado.
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        content = await navigator.clipboard.readText();
      } else {
        content = await Clipboard.getStringAsync();
      }

      const cleaned = (content ?? '').replace(/\s+/g, ' ').trim();
      if (!cleaned) {
        showAlert(
          t('Área de transferência vazia'),
          t('Copie a frase de recuperação antes de tocar em "COLAR FRASE".'),
        );
        return;
      }

      setRecoveryMnemonic(cleaned);
    } catch (err) {
      console.warn('[login] paste mnemonic failed:', err);
      showAlert(
        t('Não foi possível colar'),
        t('Permita o acesso à área de transferência nas configurações do navegador, ou cole manualmente no campo (toque longo no input → Colar).'),
      );
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          <View style={styles.centerSection}>
            <View style={styles.logoBox}>
              <Image
                source={require('../public/logo-verum.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity style={styles.createBtn} onPress={handleStartSetup} disabled={loading}>
                <LinearGradient
                  colors={[V.gold, '#E5B84B']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientBtn}
                >
                  <Text style={styles.createBtnText}>{t('CRIAR CARTEIRA')}</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity style={styles.importBtn} onPress={openRecoveryModal} disabled={loading}>
                <Text style={styles.importBtnText}>{t('RECUPERAR CARTEIRA')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>VERUM WALLET FREEPORT S.A. • Panamá</Text>
            <Text style={styles.footerText}>VERUM © 2026</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ═══ SETUP MODAL: criar PIN → revelar frase ═══ */}
      <Modal visible={isSetupModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { height: '85%', paddingBottom: 32 }]}>

            {/* ETAPA 1: PIN */}
            {setupStep === 'pin' && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>
                      {setupPin.length < 6 ? t('CRIE SEU PIN') : t('CONFIRME SEU PIN')}
                    </Text>
                    <Text style={styles.modalSub}>
                      {setupPin.length < 6
                        ? t('Escolha 6 dígitos para proteger sua carteira')
                        : t('Repita o PIN para confirmar')}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => setSetupModalVisible(false)} style={styles.modalClose}>
                    <Feather name="x" size={24} color={V.gold} />
                  </TouchableOpacity>
                </View>

                <View style={{ flex: 1, justifyContent: 'center' }}>
                  {setupPin.length < 6 ? (
                    <PinPad value={setupPin} onChange={setSetupPin} />
                  ) : (
                    <PinPad value={setupPinConfirm} onChange={setSetupPinConfirm} />
                  )}
                </View>

                {setupPin.length === 6 && setupPinConfirm.length === 6 && (
                  <TouchableOpacity style={styles.modalSubmit} onPress={handleFinishSetupPin} disabled={loading}>
                    {loading ? <ActivityIndicator color={V.bg} /> : (
                      <Text style={styles.modalSubmitText}>{t('CONTINUAR')}</Text>
                    )}
                  </TouchableOpacity>
                )}

                {setupPin.length === 6 && (
                  <TouchableOpacity
                    onPress={() => { setSetupPin(''); setSetupPinConfirm(''); }}
                    style={{ alignSelf: 'center', marginTop: 16 }}
                  >
                    <Text style={{ color: V.muted, fontSize: 12, textDecorationLine: 'underline' }}>
                      {t('Digitar PIN novamente')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ETAPA 2: FRASE SECRETA */}
            {setupStep === 'reveal' && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>{t('SUA FRASE SECRETA')}</Text>
                    <Text style={styles.modalSub}>{t('Guarde em local seguro')}</Text>
                  </View>
                </View>

                <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>

                  <View style={[styles.infoBox, { marginBottom: 20, borderColor: V.danger + '66' }]}>
                    <Feather name="alert-triangle" size={20} color={V.danger} style={{ marginRight: 12 }} />
                    <Text style={[styles.infoText, { color: V.text }]}>
                      {t('Anote as 12 palavras abaixo em papel físico. Sem esta frase você perde acesso à carteira para sempre. A Verum não tem cópia.')}
                    </Text>
                  </View>

                  <View style={styles.mnemonicGrid}>
                    {generatedMnemonic.split(' ').map((word, i) => (
                      <View key={i} style={styles.wordChip}>
                        <Text style={styles.wordIndex}>{i + 1}</Text>
                        <Text style={styles.wordText}>{word}</Text>
                      </View>
                    ))}
                  </View>

                  <TouchableOpacity
                    style={[styles.copyMnemonicBtn, mnemonicCopied && { borderColor: V.success }, { marginVertical: 20, alignSelf: 'center' }]}
                    onPress={async () => {
                      await Clipboard.setStringAsync(generatedMnemonic);
                      setMnemonicCopied(true);
                      setTimeout(() => setMnemonicCopied(false), 2500);
                    }}
                  >
                    <Feather name={mnemonicCopied ? 'check' : 'copy'} size={16} color={mnemonicCopied ? V.success : V.gold} />
                    <Text style={[styles.copyMnemonicText, mnemonicCopied && { color: V.success }]}>
                      {mnemonicCopied ? t('COPIADO!') : t('COPIAR FRASE')}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.inputLabel}>{t('ENDEREÇO DA CARTEIRA')}</Text>
                  <View style={[styles.infoPill, { marginBottom: 20 }]}>
                    <Text style={[styles.infoPillText, { fontSize: 11 }]} numberOfLines={1} ellipsizeMode="middle">
                      {generatedPublicKey}
                    </Text>
                  </View>

                  {(isFetchingBalances || recoveredBalances.length > 0) && (
                    <View style={styles.balancesContainer}>
                      <Text style={styles.inputLabel}>{t('SALDOS ENCONTRADOS')}</Text>
                      {isFetchingBalances ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}>
                          <ActivityIndicator size="small" color={V.gold} style={{ marginRight: 10 }} />
                          <Text style={{ color: V.muted, fontSize: 13 }}>{t('Buscando ativos na rede...')}</Text>
                        </View>
                      ) : (
                        <View style={styles.tokenList}>
                          {recoveredBalances.map((token, idx) => (
                            <View key={idx} style={styles.tokenMiniRow}>
                              {token.icon ? (
                                <Image source={{ uri: token.icon }} style={styles.tokenIconMini} />
                              ) : (
                                <View style={[styles.tokenIconMini, { backgroundColor: V.surface1, justifyContent: 'center', alignItems: 'center' }]}>
                                  <Text style={{ color: V.gold, fontSize: 9, fontWeight: '700' }}>{token.symbol?.slice(0, 3)}</Text>
                                </View>
                              )}
                              <Text style={styles.tokenSymbolMini}>{token.symbol}</Text>
                              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                <Text style={styles.tokenBalanceMini}>{parseFloat(token.balance).toFixed(4)}</Text>
                                {token.usdValue > 0 && (
                                  <Text style={{ color: V.success, fontSize: 10 }}>${token.usdValue.toFixed(2)}</Text>
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.modalSubmit, { marginTop: 'auto' }]}
                  onPress={() => {
                    walletSetupFlag.end(); // Sinaliza que o setup terminou
                    setSetupModalVisible(false);
                    router.replace('/(tabs)/' as any);
                  }}
                >
                  <Text style={styles.modalSubmitText}>{t('JÁ SALVEI MINHA FRASE')}</Text>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </View>
      </Modal>

      {/* ═══ RECOVERY MODAL ═══ */}
      <Modal visible={isRecoveryModalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <View style={[styles.modalContent, { height: '85%', paddingBottom: 32 }]}>

            {/* STEP 1: frase + criar PIN */}
            {recoveryStep === 'mnemonic' && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>{t('RECUPERAR CARTEIRA')}</Text>
                    <Text style={styles.modalSub}>{t('Insira a frase secreta e crie um PIN')}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setRecoveryModalVisible(false)}
                    style={styles.modalClose}
                  >
                    <Feather name="x" size={24} color={V.gold} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 20 }}>
                  <View style={styles.infoBox}>
                    <Feather name="info" size={20} color={V.gold} style={{ marginRight: 12 }} />
                    <Text style={styles.infoText}>
                      {t('Cole sua frase de 12 palavras e crie um PIN de 6 dígitos para proteger sua carteira neste dispositivo.')}
                    </Text>
                  </View>

                  <View style={styles.mnemonicContainer}>
                    <Text style={styles.inputLabel}>{t('FRASE DE RECUPERAÇÃO (12 PALAVRAS)')}</Text>
                    <View style={styles.mnemonicInputBox}>
                      <TextInput
                        style={styles.mnemonicInput}
                        placeholder="word1 word2 word3..."
                        placeholderTextColor={V.muted}
                        multiline
                        numberOfLines={4}
                        value={recoveryMnemonic}
                        onChangeText={setRecoveryMnemonic}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TouchableOpacity style={styles.pasteBtn} onPress={handlePasteMnemonic}>
                        <Feather name="clipboard" size={16} color={V.bg} style={{ marginRight: 4 }} />
                        <Text style={styles.pasteBtnText}>{t('COLAR FRASE')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View>
                    <Text style={[styles.inputLabel, { textAlign: 'center', marginBottom: 16 }]}>
                      {t('CRIAR PIN DE ACESSO')}
                    </Text>
                    <PinPad value={recoveryPin} onChange={setRecoveryPin} />
                  </View>

                  <TouchableOpacity
                    style={[styles.modalSubmit, { marginTop: 8 }]}
                    onPress={handleRecoverProceed}
                    disabled={loading}
                  >
                    <Text style={styles.modalSubmitText}>{t('CONTINUAR')}</Text>
                  </TouchableOpacity>

                  <Text style={styles.recoveryWarning}>
                    {t('Sua frase nunca sai do seu dispositivo. O PIN é usado apenas para criptografar as chaves localmente.')}
                  </Text>
                </ScrollView>
              </View>
            )}

            {/* STEP 2: confirmar PIN */}
            {recoveryStep === 'confirmPin' && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>{t('CONFIRME SEU PIN')}</Text>
                    <Text style={styles.modalSub}>{t('Repita os 6 dígitos para confirmar')}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setRecoveryStep('mnemonic'); setRecoveryPinConfirm(''); }}
                    style={styles.modalClose}
                  >
                    <Feather name="arrow-left" size={24} color={V.gold} />
                  </TouchableOpacity>
                </View>

                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <PinPad value={recoveryPinConfirm} onChange={setRecoveryPinConfirm} />
                </View>

                {recoveryPinConfirm.length === 6 && (
                  <TouchableOpacity style={styles.modalSubmit} onPress={handleRecoverWallet} disabled={loading}>
                    {loading ? <ActivityIndicator color={V.bg} /> : (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Feather name="link" size={18} color={V.bg} style={{ marginRight: 8 }} />
                        <Text style={styles.modalSubmitText}>{t('CONECTAR CARTEIRA')}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: V.bg },
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 50, paddingBottom: 50, alignItems: 'center', flexGrow: 1 },

  centerSection: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  logoBox: { marginBottom: 60 },
  logo: { width: 120, height: 120 },

  footer: { alignItems: 'center', gap: 6, marginTop: 40 },
  footerText: { fontSize: 10, fontFamily: F.semi, color: V.muted, letterSpacing: 1, opacity: 0.8 },

  buttonContainer: { width: '100%', gap: 16 },
  createBtn: { height: 56, borderRadius: V.r8, overflow: 'hidden', ...V.shadow },
  gradientBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  createBtnText: { fontSize: 16, fontFamily: F.bold, color: V.bg, letterSpacing: 1 },
  importBtn: { height: 56, borderRadius: V.r8, borderWidth: 1, borderColor: V.gold, alignItems: 'center', justifyContent: 'center' },
  importBtnText: { fontSize: 16, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end', alignItems: 'center' },
  modalContent: { backgroundColor: V.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%', borderWidth: 1, borderColor: V.border, width: '100%', minWidth: 320, maxWidth: 650 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontFamily: F.title, color: V.gold, letterSpacing: 1 },
  modalSub: { fontSize: 12, fontFamily: F.body, color: V.muted, marginTop: 4 },
  modalClose: { padding: 4 },

  modalSubmit: { height: 54, backgroundColor: V.gold, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  modalSubmitText: { fontFamily: F.bold, color: V.bg, fontSize: 14, letterSpacing: 1 },

  inputLabel: { fontSize: 12, fontFamily: F.bold, color: V.gold, marginBottom: 6, letterSpacing: 0.5, marginLeft: 4 },

  infoPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: V.surface2, borderRadius: V.r8, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: V.border, marginBottom: 4 },
  infoPillText: { flex: 1, color: V.text, fontFamily: F.mono, fontSize: 13, marginRight: 10 },

  infoBox: { flexDirection: 'row', backgroundColor: V.surface2, padding: 16, borderRadius: V.r8, borderWidth: 1, borderColor: V.gold + '33' },
  infoText: { flex: 1, color: V.text, fontSize: 13, fontFamily: F.body, lineHeight: 18 },

  mnemonicContainer: { gap: 8 },
  mnemonicInputBox: { backgroundColor: V.surface2, borderRadius: V.r8, padding: 12, borderWidth: 1, borderColor: V.border, minHeight: 120 },
  mnemonicInput: { color: V.text, fontFamily: F.body, fontSize: 15, textAlignVertical: 'top', flex: 1 },
  pasteBtn: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: V.gold, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 8, alignItems: 'center' },
  pasteBtnText: { color: V.bg, fontSize: 11, fontFamily: F.bold },

  recoveryWarning: { fontSize: 11, fontFamily: F.body, color: V.muted, textAlign: 'center', marginTop: 4, fontStyle: 'italic' },

  mnemonicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16, width: '100%' },
  wordChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, borderRadius: 6, borderWidth: 1, borderColor: V.border, paddingHorizontal: 10, paddingVertical: 6, minWidth: 90 },
  wordIndex: { fontSize: 10, fontFamily: F.bold, color: V.gold, marginRight: 6, opacity: 0.7 },
  wordText: { fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#FFFFFF' },
  copyMnemonicBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: V.gold, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 4 },
  copyMnemonicText: { fontSize: 12, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },

  balancesContainer: { marginTop: 16, padding: 16, backgroundColor: V.bg, borderRadius: V.r12, borderWidth: 1, borderColor: V.gold + '22' },
  tokenList: { marginTop: 12, gap: 10 },
  tokenMiniRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: V.surface2, padding: 12, borderRadius: V.r8, gap: 12 },
  tokenIconMini: { width: 28, height: 28, borderRadius: 14 },
  tokenSymbolMini: { flex: 1, color: V.text, fontFamily: F.bold, fontSize: 13 },
  tokenBalanceMini: { color: V.gold, fontFamily: F.mono, fontSize: 13 },
});
