import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as LocalAuthentication from 'expo-local-authentication';
import Header from '@/components/Header';
import keyManager from '@/src/services/keyManager';
import bs58 from 'bs58';
import { V, F, PAD } from '@/constants/theme';
import PasswordModal from '@/components/PasswordModal';
import { getBiometricsEnabled } from '@/constants/biometrics-storage';
import { useSettings } from '@/constants/SettingsContext';

export default function ExportarChavePrivadaScreen() {
  const insets = useSafeAreaInsets();
  const [isRevealed, setIsRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);

  const { t } = useSettings();

  React.useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(has => {
      if (has) LocalAuthentication.isEnrolledAsync().then(setIsBiometricAvailable);
    });
  }, []);

  const handleReveal = async () => {
    const isBioActive = await getBiometricsEnabled();
    const sessionKey = keyManager.getSessionKeypair();

    if (sessionKey) {
      const privateKeyBase58 = bs58.encode(sessionKey.secretKey);
      setPrivateKey(privateKeyBase58);
      setIsRevealed(true);
      return;
    }

    if (isBioActive && Platform.OS !== 'web') {
      const bioResult = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Autentique-se para revelar'),
      });
      if (bioResult.success) {
        const savedPin = await keyManager.getPinForBiometrics();
        if (savedPin) {
          await handleConfirmPassword(savedPin);
          return;
        }
      }
    }
    
    setIsPasswordModalVisible(true);
  };

  const handleConfirmPassword = async (pin: string) => {
    setLoading(true);
    try {
      const kp = await keyManager.loadDecrypted(pin);
      if (kp) {
        setPrivateKey(bs58.encode(kp.secretKey));
        setIsRevealed(true);
        setIsPasswordModalVisible(false);
      }
    } catch {
      Alert.alert(t('Erro'), t('Senha incorreta.'));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (privateKey) {
      await Clipboard.setStringAsync(privateKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <Header onBackPress={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.iconCircle}>
          <Feather name="shield" size={40} color={V.gold} />
        </View>

        <View style={styles.titleBox}>
          <Text style={styles.title}>CHAVE PRIVADA SOLANA</Text>
          <View style={styles.goldLine} />
          <Text style={styles.description}>
            Sua chave privada dá acesso total à sua carteira. <Text style={{ fontFamily: F.bold }}>NUNCA</Text> a compartilhe. Quem possuir esta chave terá controle total sobre seus ativos.
          </Text>
        </View>

        {isRevealed ? (
          <View style={styles.keyBox}>
            <Text style={styles.keyText} selectable>{privateKey}</Text>
            <TouchableOpacity style={styles.copyBtn} onPress={copyToClipboard}>
              <Feather name={copied ? "check" : "copy"} size={18} color={copied ? V.success : V.gold} />
              <Text style={[styles.copyBtnText, copied && { color: V.success }]}>
                {copied ? "COPIADO" : "COPIAR CHAVE"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.revealBtn} onPress={handleReveal} disabled={loading}>
            {loading ? <ActivityIndicator color={V.bg} /> : (
              <>
                <Feather name="eye" size={20} color={V.bg} />
                <Text style={styles.revealBtnText}>REVELAR CHAVE PRIVADA</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.warningCard}>
          <Feather name="alert-triangle" size={20} color={V.danger} />
          <View style={{flex: 1}}>
            <Text style={styles.warningT}>SEGURANÇA CRÍTICA</Text>
            <Text style={styles.warningText}>
                Não tire capturas de tela. Prefira anotar em local físico seguro e offline.
            </Text>
          </View>
        </View>
      </ScrollView>

      <PasswordModal 
        isVisible={isPasswordModalVisible}
        onClose={() => setIsPasswordModalVisible(false)}
        loading={loading}
        title={t('AUTORIZAÇÃO')}
        description={t('Digite sua senha mestre para revelar a chave:')}
        onConfirm={handleConfirmPassword}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { padding: 24, alignItems: 'center', paddingBottom: 60 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', marginBottom: 24, borderWidth: 1, borderColor: V.border },
  titleBox: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 22, fontFamily: F.title, color: V.gold, letterSpacing: 1 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginVertical: 12 },
  description: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 22 },
  revealBtn: { width: '100%', height: 60, backgroundColor: V.gold, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, ...V.shadow },
  revealBtnText: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },
  keyBox: { width: '100%', padding: 24, backgroundColor: V.surface1, borderRadius: V.r12, borderWidth: 1, borderColor: V.gold, alignItems: 'center', overflow: 'hidden', ...V.shadow },
  keyText: {
    fontSize: 13,
    color: V.text,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    width: '100%',
    // Em RN Web, Text vira <div> e string base58 sem espaços não quebra sozinha —
    // forçamos quebra por caractere.
    ...(Platform.OS === 'web' ? ({ wordBreak: 'break-all', overflowWrap: 'anywhere' } as any) : null),
  },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: V.surface2, paddingHorizontal: 20, paddingVertical: 10, borderRadius: V.r20, borderWidth: 1, borderColor: V.border },
  copyBtnText: { fontSize: 12, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  warningCard: { width: '100%', marginTop: 40, padding: 20, backgroundColor: 'rgba(231, 76, 60, 0.05)', borderRadius: V.r12, borderLeftWidth: 4, borderLeftColor: V.danger, flexDirection: 'row', gap: 16, borderWidth: 1, borderColor: 'rgba(231, 76, 60, 0.1)' },
  warningT: { fontSize: 12, fontFamily: F.bold, color: V.danger, marginBottom: 4 },
  warningText: { fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 }
});
