import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F, PAD } from '@/constants/theme';
import { supabase } from '@/src/services/supabase';
import keyManager from '@/src/services/keyManager';
import * as bip39 from 'bip39';
import * as Clipboard from 'expo-clipboard';
import { saveUser } from '@/constants/auth-storage';

const showAlert = (title: string, message?: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message || ''}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function RecuperarSenhaScreen() {
  const insets = useSafeAreaInsets();
  
  // Fluxo: 1 = Email -> 2 = Validar OTP -> 3 = Nova Senha e Frase Semente
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);

  // Campos
  const [email, setEmail] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryMnemonic, setRecoveryMnemonic] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Passo 1: Solicitar OTP
  const handleRequestCode = async () => {
    if (!email.trim()) {
      showAlert('Erro', 'Por favor, informe seu e-mail.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setStep(2);
    } catch (error: any) {
      showAlert('Erro na solicitação', error.message || 'Verifique o e-mail informado.');
    } finally {
      setLoading(false);
    }
  };

  // Passo 2: Validar OTP
  const handleVerifyOtp = async () => {
    if (otpToken.length < 6) {
      showAlert('Erro', 'Por favor, digite o código de verificação recebido no e-mail.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpToken.trim(),
        type: 'recovery',
      });
      if (error) throw error;
      
      // O Supabase loga o usuário automaticamente se o token de recovery for válido
      setStep(3);
    } catch (error: any) {
      showAlert('Código inválido', 'O código digitado é inválido ou expirou.');
    } finally {
      setLoading(false);
    }
  };

  // Passo 3: Cadastrar Nova Senha e Re-criptografar a carteira local
  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      showAlert('Erro', 'A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Erro', 'As senhas não coincidem.');
      return;
    }

    const mnemonicTrimmed = recoveryMnemonic.trim().toLowerCase();
    if (!mnemonicTrimmed || mnemonicTrimmed.split(/\s+/).length < 12) {
      showAlert('Erro', 'Frase de recuperação inválida. Deve conter 12 palavras separadas por espaço.');
      return;
    }

    setLoading(true);
    try {
      // 1. Valida o mnemonic antes de qualquer efeito colateral (rule #6).
      if (!bip39.validateMnemonic(mnemonicTrimmed, bip39.wordlists.english)) {
        throw new Error('A frase secreta inserida não é um mnemônico válido.');
      }

      // 2. Atualizar Senha no Supabase
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (updateError) throw updateError;

      // 3. Importar identidade explicitamente: wipe → derive → save.
      // Isso garante que a pubkey reaparece idêntica à que foi derivada da
      // seed, independente do que estiver no DB ou em cache antigo.
      const imported = await keyManager.importNewWallet(mnemonicTrimmed, newPassword);
      const walletAddress = imported.publicKey;

      // 4. Atualizar wallet_address no banco (agora consistente com vault local)
      const userId = updateData.user?.id;
      if (userId) {
        await supabase.from('usuarios').update({ wallet_address: walletAddress }).eq('id', userId);

        await saveUser({
          email: updateData.user?.email || '',
          fullName: updateData.user?.user_metadata?.full_name || 'Usuário'
        });
      }

      await keyManager.startSession(imported.mnemonic, imported.keypair, newPassword);

      showAlert('Sucesso', 'Sua senha foi redefinida e sua carteira sincronizada!');
      router.replace('/' as any);
      
    } catch (error: any) {
      showAlert('Erro', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasteMnemonic = async () => {
    const content = await Clipboard.getStringAsync();
    if (content) {
      setRecoveryMnemonic(content);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor={V.bg} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        
        <View style={[styles.header, { marginTop: insets.top + 20 }]}>
          <Text style={styles.title}>RECUPERAR SENHA</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.replace('/login')}>
            <Feather name="x" size={24} color={V.gold} />
          </TouchableOpacity>
        </View>

        <View style={styles.goldLine} />

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {step === 1 && (
            <View style={styles.stepBox}>
              <Text style={styles.subtitle}>
                Informe seu e-mail cadastrado para receber o código de recuperação.
              </Text>
              
              <Text style={styles.label}>E-MAIL</Text>
              <View style={styles.inputBox}>
                <Feather name="mail" size={18} color={V.gold} style={{marginRight: 12}} />
                <TextInput
                  style={styles.input}
                  placeholder="exemplo@email.com"
                  placeholderTextColor={V.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <TouchableOpacity style={[styles.mainBtn, { marginTop: 40 }]} onPress={handleRequestCode} disabled={loading}>
                {loading ? <ActivityIndicator color={V.bg} /> : <Text style={styles.mainBtnText}>SOLICITAR CÓDIGO</Text>}
              </TouchableOpacity>
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepBox}>
              <Text style={styles.subtitle}>
                Foi enviado um código de verificação para {email}. Insira-o abaixo.
              </Text>

              <Text style={styles.label}>CÓDIGO DE RECUPERAÇÃO</Text>
              <View style={[styles.inputBox, { height: 60, borderColor: V.gold }]}>
                <TextInput
                  style={[styles.input, { textAlign: 'center', fontSize: 24, letterSpacing: 8, color: V.gold, fontFamily: F.bold }]}
                  placeholder="00000000"
                  placeholderTextColor={V.surface2}
                  keyboardType="number-pad"
                  maxLength={8}
                  value={otpToken}
                  onChangeText={(val) => setOtpToken(val.replace(/[^0-9]/g, ''))}
                />
              </View>

              <TouchableOpacity style={[styles.mainBtn, { marginTop: 40 }]} onPress={handleVerifyOtp} disabled={loading}>
                {loading ? <ActivityIndicator color={V.bg} /> : <Text style={styles.mainBtnText}>VALIDAR CÓDIGO</Text>}
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setStep(1)} style={{ alignItems: 'center', marginTop: 24 }}>
                <Text style={{ color: V.muted, textDecorationLine: 'underline', fontSize: 12 }}>Voltar para pedir outro código</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 3 && (
            <View style={styles.stepBox}>
              <View style={styles.infoBox}>
                <Feather name="shield" size={16} color={V.gold} style={{ marginRight: 8 }} />
                <Text style={styles.infoText}>
                   Para segurança dos seus ativos, mudar a senha exige reenviar a Frase Secreta (12 palavras) para re-criptografar a carteira local.
                </Text>
              </View>

              <Text style={[styles.label, { marginTop: 24 }]}>NOVA SENHA</Text>
              <View style={styles.inputBox}>
                <Feather name="lock" size={18} color={V.gold} style={{marginRight: 12}} />
                <TextInput
                  style={styles.input}
                  placeholder="Sua nova senha"
                  placeholderTextColor={V.muted}
                  secureTextEntry={!showPassword}
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={V.muted} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { marginTop: 20 }]}>REPETIR NOVA SENHA</Text>
              <View style={styles.inputBox}>
                <Feather name="lock" size={18} color={V.gold} style={{marginRight: 12}} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirme a senha"
                  placeholderTextColor={V.muted}
                  secureTextEntry={!showPassword}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={V.muted} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { marginTop: 32 }]}>FRASE DE RECUPERAÇÃO (12 PALAVRAS)</Text>
              <View style={styles.mnemonicInputBox}>
                <TextInput
                  style={styles.mnemonicInput}
                  placeholder="word1 word2 word3..."
                  placeholderTextColor={V.muted}
                  multiline
                  numberOfLines={3}
                  value={recoveryMnemonic}
                  onChangeText={setRecoveryMnemonic}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.pasteBtn} onPress={handlePasteMnemonic}>
                  <Feather name="clipboard" size={14} color={V.bg} style={{ marginRight: 4 }} />
                  <Text style={styles.pasteBtnText}>COLAR</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.mainBtn, { marginTop: 32, marginBottom: 40 }]} onPress={handleResetPassword} disabled={loading}>
                {loading ? <ActivityIndicator color={V.bg} /> : <Text style={styles.mainBtnText}>REDEFINIR ACESSO E CARTEIRA</Text>}
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: V.bg },
  container: { flex: 1, paddingHorizontal: PAD.modal },
  scrollContent: { paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 22, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginBottom: 20 },
  
  stepBox: { flex: 1 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 22, marginBottom: 40 },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  
  inputBox: { flexDirection: 'row', alignItems: 'center', height: 56, backgroundColor: V.surface1, borderRadius: V.r8, paddingHorizontal: 16, borderWidth: 1, borderColor: V.border },
  input: { flex: 1, color: V.text, fontFamily: F.semi, fontSize: 15, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  
  mnemonicInputBox: { backgroundColor: V.surface1, borderRadius: V.r8, padding: 12, borderWidth: 1, borderColor: V.border, minHeight: 100 },
  mnemonicInput: { color: V.text, fontFamily: F.body, fontSize: 15, textAlignVertical: 'top', flex: 1, backgroundColor: 'transparent', outlineStyle: 'none' as any },
  pasteBtn: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: V.gold, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 8, alignItems: 'center' },
  pasteBtnText: { color: V.bg, fontSize: 10, fontFamily: F.bold },

  infoBox: { flexDirection: 'row', backgroundColor: V.surface2, padding: 16, borderRadius: V.r8, borderWidth: 1, borderColor: V.gold + '33', marginBottom: 12 },
  infoText: { flex: 1, color: V.text, fontSize: 12, fontFamily: F.body, lineHeight: 18 },

  mainBtn: { backgroundColor: V.gold, height: 56, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center', ...V.shadow },
  mainBtnText: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },
});
