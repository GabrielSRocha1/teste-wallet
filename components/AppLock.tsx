import React, { useEffect, useState, useRef } from 'react';
import { AppState, Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { requiresAuthentication, updateLastAuthTime } from '@/constants/biometrics-storage';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  getStoredCredentialId,
  registerWebAuthnCredential,
  authenticateWithWebAuthn,
} from '@/constants/webauthn-storage';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import PasswordModal from '@/components/PasswordModal';
import keyManager from '@/src/services/keyManager';

export default function AppLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [webBiometricAvailable, setWebBiometricAvailable] = useState(false);
  const [webHasCredential, setWebHasCredential] = useState(false);
  const appState = useRef(AppState.currentState);
  const { t } = useSettings();

  useEffect(() => {
    const handleLockCheck = async () => {
      const needsAuth = await requiresAuthentication();
      if (needsAuth) {
        setIsLocked(true);
        triggerBiometrics();
      } else {
        setIsLocked(false);
      }
    };

    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        handleLockCheck();
      }
      appState.current = nextAppState;
    });

    handleLockCheck();

    if (Platform.OS === 'web') {
      (async () => {
        const supported = isWebAuthnSupported() && await isPlatformAuthenticatorAvailable();
        setWebBiometricAvailable(supported);
        setWebHasCredential(!!getStoredCredentialId());
      })();
    }

    return () => {
      subscription.remove();
    };
  }, []);

  const triggerBiometrics = async () => {
    if (Platform.OS === 'web') {
      const supported = isWebAuthnSupported() && await isPlatformAuthenticatorAvailable();
      setWebBiometricAvailable(supported);

      if (supported && getStoredCredentialId()) {
        try {
          const ok = await authenticateWithWebAuthn();
          if (ok) {
            setIsLocked(false);
            await updateLastAuthTime();
            return;
          }
        } catch {
          // usuário cancelou ou falhou — cai pro PIN
        }
      }
      setIsPasswordModalVisible(true);
      return;
    }

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (hasHardware && isEnrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('Desbloquear Carteira Verum'),
      });

      if (result.success) {
        setIsLocked(false);
        await updateLastAuthTime();
      } else {
        setIsPasswordModalVisible(true);
      }
    } else {
      setIsPasswordModalVisible(true);
    }
  };

  const tryRegisterWebAuthn = async () => {
    if (Platform.OS !== 'web') return;
    if (!isWebAuthnSupported() || !(await isPlatformAuthenticatorAvailable())) return;
    if (getStoredCredentialId()) return;
    try {
      const ok = await registerWebAuthnCredential('verum-wallet-user');
      if (ok) setWebHasCredential(true);
    } catch {
      // ignorar — usuário pode cadastrar depois nas configurações
    }
  };

  const handleConfirmPassword = async (pin: string) => {
    setPasswordLoading(true);
    try {
      await keyManager.loadDecrypted(pin);
      setIsLocked(false);
      setIsPasswordModalVisible(false);
      await updateLastAuthTime();
      await tryRegisterWebAuthn();
    } catch (e) {
      Alert.alert(t('Erro'), t('Senha incorreta.'));
    } finally {
      setPasswordLoading(false);
    }
  };

  if (!isLocked) return null;

  const showBiometricButton = Platform.OS !== 'web' || (webBiometricAvailable && webHasCredential);

  return (
    <Modal visible={true} animationType="fade" transparent={false}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="face-recognition" size={80} color={V.gold} />
        </View>
        <Text style={styles.title}>{t('CARTEIRA BLOQUEADA')}</Text>
        <Text style={styles.subtitle}>{t('Autentique-se para continuar acessando seus ativos.')}</Text>

        {showBiometricButton && (
          <TouchableOpacity style={styles.button} onPress={triggerBiometrics}>
            <Text style={styles.buttonText}>{t('USAR BIOMETRIA')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.pinButton, !showBiometricButton && styles.pinButtonPrimary]}
          onPress={() => setIsPasswordModalVisible(true)}
        >
          <Text style={[styles.pinButtonText, !showBiometricButton && styles.pinButtonTextPrimary]}>
            {t('USAR PIN')}
          </Text>
        </TouchableOpacity>
      </View>

      <PasswordModal
        isVisible={isPasswordModalVisible}
        onClose={() => setIsPasswordModalVisible(false)}
        loading={passwordLoading}
        title={t('DESBLOQUEAR')}
        description={t('Digite sua senha mestre para visualizar sua carteira:')}
        onConfirm={handleConfirmPassword}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: V.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: V.surface1,
    borderWidth: 1,
    borderColor: V.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    shadowColor: V.gold,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  title: {
    color: V.gold,
    fontSize: 24,
    fontFamily: F.title,
    marginBottom: 16,
    letterSpacing: 2,
  },
  subtitle: {
    color: V.muted,
    fontSize: 14,
    fontFamily: F.body,
    marginBottom: 50,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    backgroundColor: V.gold,
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: V.bg,
    fontSize: 16,
    fontFamily: F.bold,
    letterSpacing: 1,
  },
  pinButton: {
    marginTop: 16,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.5)',
    backgroundColor: 'transparent',
  },
  pinButtonPrimary: {
    backgroundColor: V.gold,
    borderColor: V.gold,
  },
  pinButtonText: {
    color: V.gold,
    fontSize: 15,
    fontFamily: F.bold,
    letterSpacing: 1,
  },
  pinButtonTextPrimary: {
    color: V.bg,
  },
});
