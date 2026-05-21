import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform, ScrollView, Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Image } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import Header from '@/components/Header';
import keyManager from '@/src/services/keyManager';
import { V, F, PAD } from '@/constants/theme';
import { getBiometricsEnabled } from '@/constants/biometrics-storage';
import { useSettings } from '@/constants/SettingsContext';
import PasswordModal from '@/components/PasswordModal';

const CAROUSEL_DATA = [
  { 
    id: 'chave', 
    title: 'FRASE MESTRA', 
    description: 'A frase de recuperação (Seed Phrase) é a única forma de restaurar seus fundos em caso de perda do dispositivo.', 
    image: require('../public/Gemini_Generated_Image_5ep0d25ep0d25ep0-removebg-preview (1) 1.png'), 
    color: V.gold 
  },
  { 
    id: 'escudo', 
    title: 'SEGURANÇA TOTAL', 
    description: 'Quem possui estas 12 palavras possui o controle total. NUNCA revele sua frase para ninguém, nem mesmo para o suporte.', 
    image: require('../public/Gemini_Generated_Image_az3r30az3r30az3r-removebg-preview 1.png'), 
    color: V.success 
  },
  { 
    id: 'papel', 
    title: 'BACKUP OFFLINE', 
    description: 'A maneira mais segura é anotar em um papel físico e guardar em local seguro. Evite armazenar digitalmente ou em nuvem.', 
    image: require('../public/Gemini_Generated_Image_uxpbzhuxpbzhuxpb-removebg-preview 1.png'), 
    color: V.muted 
  }
];

export default function ExportarFraseScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isSecretVisible, setIsSecretVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secretPhrase, setSecretPhrase] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSecurityModalVisible, setIsSecurityModalVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(has => {
      if (has) LocalAuthentication.isEnrolledAsync().then(setIsBiometricAvailable);
    });
  }, []);

  const handleToggleVisibility = async () => {
    if (isSecretVisible) { setIsSecretVisible(false); return; }
    
    const isBioActive = await getBiometricsEnabled();
    const sessionMnemonic = keyManager.getSessionMnemonic();

    if (sessionMnemonic) {
      setSecretPhrase(sessionMnemonic);
      setIsSecretVisible(true);
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
    
    setIsSecurityModalVisible(true);
  };



  const authenticateWithBiometrics = async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Autentique-se' });
    if (result.success) {
      const sessionMnemonic = keyManager.getSessionMnemonic();
      if (sessionMnemonic) { 
        require('@/constants/biometrics-storage').updateLastAuthTime();
        setSecretPhrase(sessionMnemonic); 
        setIsSecretVisible(true); 
        setIsSecurityModalVisible(false); 
      } else {
        Alert.alert("Sessão Expirada", "Por favor, digite sua senha.");
      }
    }
  };

  const handleConfirmPassword = async (pin: string) => {
    setIsLoading(true);
    try {
      const mnemonic = await keyManager.getMnemonic(pin);
      if (mnemonic) { 
        setSecretPhrase(mnemonic); 
        setIsSecretVisible(true); 
        setIsSecurityModalVisible(false); 
        setShowPassword(false); 
      }
      else throw new Error();
    } catch { 
      Alert.alert(t('Erro'), t('Senha incorreta.')); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(secretPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderSlide = () => {
    const data = CAROUSEL_DATA[currentSlide];
    return (
      <View style={styles.slide}>
        <View style={styles.iconBox}>
          <Image source={data.image} style={{ width: '80%', height: '80%' }} resizeMode="contain" />
        </View>
        <Text style={[styles.slideTitle, {color: data.color}]}>{data.title}</Text>
        <Text style={styles.slideDesc}>{data.description}</Text>
        <View style={styles.dots}>
            {[0, 1, 2, 3].map(i => <View key={i} style={[styles.dot, currentSlide === i && styles.dotActive]} />)}
        </View>
        <TouchableOpacity style={styles.nextBtn} onPress={() => setCurrentSlide(currentSlide + 1)}>
            <Text style={styles.nextBtnT}>PRÓXIMO</Text>
            <Feather name="arrow-right" size={18} color={V.bg} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <Header onBackPress={() => currentSlide > 0 ? setCurrentSlide(currentSlide-1) : router.back()} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {currentSlide < 3 ? renderSlide() : (
          <View style={styles.finalView}>
             <View style={styles.titleBox}>
                <Text style={styles.title}>FRASE DE RECUPERAÇÃO</Text>
                <View style={styles.goldLine} />
                <Text style={styles.subtitle}>Revele as 12 palavras para realizar o backup manual da sua conta.</Text>
             </View>

             <View style={[styles.phraseBox, !isSecretVisible && {justifyContent: 'center'}]}>
                {isSecretVisible ? (
                  <View style={styles.wordsGrid}>
                    {secretPhrase.split(' ').map((w, i) => (
                      <View key={i} style={styles.wordItem}>
                        <Text style={styles.wordI}>{i + 1}</Text>
                        <Text style={styles.wordT}>{w}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.hiddenT}>Sua frase está oculta para proteção</Text>
                )}
             </View>

             {isSecretVisible && (
               <TouchableOpacity style={styles.copyC} onPress={copyToClipboard}>
                 <Feather name={copied ? "check" : "copy"} size={16} color={copied ? V.success : V.gold} />
                 <Text style={[styles.copyT, copied && {color: V.success}]}>{copied ? 'COPIADO' : 'COPIAR FRASE'}</Text>
               </TouchableOpacity>
             )}

             <View style={styles.alert}>
                <Feather name="alert-triangle" size={18} color={V.danger} />
                <Text style={styles.alertT}>Nunca compartilhe estas palavras. O extravio resultará em perda irreparável dos ativos.</Text>
             </View>

             <TouchableOpacity style={[styles.mainBtn, isSecretVisible && styles.mainBtnOff]} onPress={handleToggleVisibility}>
                <Feather name={isSecretVisible ? "eye-off" : "eye"} size={20} color={isSecretVisible ? V.muted : V.bg} />
                <Text style={[styles.mainBtnT, isSecretVisible && {color: V.muted}]}>{isSecretVisible ? 'OCULTAR FRASE' : 'REVELAR FRASE'}</Text>
             </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <PasswordModal
        isVisible={isSecurityModalVisible}
        onClose={() => setIsSecurityModalVisible(false)}
        loading={isLoading}
        title={t('AUTORIZAÇÃO')}
        description={t('Digite sua senha mestre para revelar a frase:')}
        onConfirm={handleConfirmPassword}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 60 },
  slide: { flex: 1, alignItems: 'center', paddingTop: 40 },
  iconBox: { width: 140, height: 140, borderRadius: 70, backgroundColor: V.surface1, alignItems: 'center', justifyContent: 'center', marginBottom: 32, borderWidth: 1, borderColor: V.border },
  slideTitle: { fontSize: 24, fontFamily: F.title, textAlign: 'center', marginBottom: 16, letterSpacing: 1 },
  slideDesc: { fontSize: 14, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },
  dots: { flexDirection: 'row', gap: 10, marginVertical: 40 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: V.surface2 },
  dotActive: { width: 24, backgroundColor: V.gold },
  nextBtn: { width: '100%', height: 60, backgroundColor: V.gold, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  nextBtnT: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },

  finalView: { paddingTop: 20 },
  titleBox: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 22, fontFamily: F.title, color: V.gold, letterSpacing: 1 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginVertical: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, textAlign: 'center', lineHeight: 20 },
  phraseBox: { width: '100%', padding: 20, backgroundColor: V.surface1, borderRadius: V.r12, borderWidth: 1, borderColor: V.border, minHeight: 180, ...V.shadow },
  hiddenT: { color: V.muted, fontSize: 14, textAlign: 'center', fontFamily: F.semi },
  wordsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  wordItem: { width: '48%', backgroundColor: V.surface2, padding: 12, borderRadius: V.r8, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: V.border },
  wordI: { fontSize: 10, fontFamily: F.bold, color: V.gold, width: 15 },
  wordT: { fontSize: 14, fontFamily: F.semi, color: V.text },
  copyC: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
  copyT: { fontSize: 12, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  alert: { flexDirection: 'row', gap: 12, backgroundColor: 'rgba(231, 76, 60, 0.05)', padding: 16, borderRadius: V.r8, borderWidth: 1, borderColor: 'rgba(231, 76, 60, 0.1)', marginBottom: 32 },
  alertT: { flex: 1, fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 },
  mainBtn: { height: 60, backgroundColor: V.gold, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...V.shadow },
  mainBtnOff: { backgroundColor: V.surface1, borderWidth: 1, borderColor: V.border },
  mainBtnT: { color: V.bg, fontSize: 15, fontFamily: F.bold, letterSpacing: 1 },

  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end', alignItems: 'center' },
  mContent: { backgroundColor: V.surface1, width: '100%', minWidth: 320, maxWidth: 650, borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 32, paddingBottom: 50, borderWidth: 1, borderColor: V.border },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  mTitle: { fontSize: 18, fontFamily: F.title, color: V.gold },
  mDesc: { fontSize: 13, fontFamily: F.body, color: V.muted, marginBottom: 20 },
  mInputBox: { flexDirection: 'row', alignItems: 'center', height: 56, backgroundColor: V.surface2, borderRadius: V.r8, paddingHorizontal: 16, borderWidth: 1, borderColor: V.border, marginBottom: 24 },
  mInput: { flex: 1, height: '100%', backgroundColor: 'transparent', color: V.text, fontFamily: F.semi, outlineStyle: 'none' as any },
  mActions: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  mConfirm: { flex: 1, height: 56, backgroundColor: V.gold, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center' },
  mConfirmT: { color: V.bg, fontSize: 15, fontFamily: F.bold },
});
