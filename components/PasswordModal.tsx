import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { V, F } from '@/constants/theme';
import PinPad from '@/components/PinPad';

interface PasswordModalProps {
  isVisible: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  title?: string;
  description?: string;
  loading?: boolean;
  /** Mensagem de erro exibida inline (ex: "Senha incorreta") */
  errorMessage?: string;
}

const MAX_PIN = 6;

export default function PasswordModal({ isVisible, onClose, onConfirm, title, description, loading, errorMessage }: PasswordModalProps) {
  const [pin, setPin] = useState('');

  // Reseta o PIN toda vez que o modal abre
  useEffect(() => {
    if (isVisible) setPin('');
  }, [isVisible]);

  // Limpa o PIN quando um erro é exibido (para permitir nova tentativa)
  useEffect(() => {
    if (errorMessage) setPin('');
  }, [errorMessage]);

  // Rede de segurança: ao final de qualquer tentativa (loading: true → false),
  // limpa o PIN para garantir que o usuário possa tentar de novo mesmo se o
  // parent reutilizar a mesma errorMessage.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loading) setPin('');
    wasLoading.current = !!loading;
  }, [loading]);

  // Auto-confirma quando o PIN atinge o comprimento máximo
  // Pequeno delay para o último dot ser pintado antes da confirmação,
  // dando feedback visual de que a senha foi digitada por completo.
  useEffect(() => {
    if (pin.length === MAX_PIN && !loading) {
      const timer = setTimeout(() => onConfirm(pin), 180);
      return () => clearTimeout(timer);
    }
  }, [pin]);

  const handleClose = () => {
    if (!loading) {
      setPin('');
      onClose();
    }
  };

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} disabled={loading}>
          <View style={styles.backdrop} />
        </Pressable>

        <View style={styles.container}>
          <View style={styles.content}>
            <View style={styles.headerTitle}>
              <View style={styles.iconCircle}>
                <Feather name="lock" size={20} color={V.gold} />
              </View>
              <Text style={styles.modalTitle}>{title || 'CONFIRMAR SENHA'}</Text>
            </View>

            <Text style={styles.modalDescription}>
              {description || 'Digite seu PIN de 6 dígitos para continuar.'}
            </Text>

            <PinPad value={pin} onChange={setPin} maxLength={MAX_PIN} loading={loading} />


            {!!errorMessage && (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color={V.danger} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.cancelBtn, loading && { opacity: 0.5 }]}
              onPress={handleClose}
              disabled={loading}
            >
              <Text style={styles.cancelText}>CANCELAR</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.88)' },
  container: { width: '100%', maxWidth: 400, zIndex: 1 },
  content: { backgroundColor: V.surface1, borderRadius: 16, paddingVertical: 28, paddingHorizontal: 20, borderWidth: 1, borderColor: V.border, alignItems: 'center' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(201,168,76,0.1)', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 16, fontFamily: F.title, color: V.gold, letterSpacing: 1 },
  modalDescription: { fontSize: 13, fontFamily: F.body, color: V.muted, marginBottom: 24, lineHeight: 20, textAlign: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 4 },
  errorText: { fontSize: 12, fontFamily: F.semi, color: V.danger, flex: 1 },
  cancelBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 32, borderRadius: V.r8, borderWidth: 1, borderColor: V.border },
  cancelText: { color: V.muted, fontSize: 12, fontFamily: F.bold, letterSpacing: 1 },
});
