import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import { useSettings } from '@/constants/SettingsContext';
import { F, V } from '@/constants/theme';
import { supabase } from '@/src/services/supabase';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { getApiBaseUrl } from '@/src/services/apiUrl';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function KYCFacialScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [isSidebarVisible, setSidebarVisible] = useState(false);

  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const takeSelfie = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão', 'Precisamos da câmera para capturar sua selfie.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.front,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setSelfieImage(result.assets[0].base64);
    }
  };

  const submitSelfie = async () => {
    if (!selfieImage) {
      Alert.alert('Incompleto', 'Por favor, tire sua selfie para a verificação.');
      return;
    }

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      // Calls backend to upload live photo and run check
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/onfido?action=verifyFace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          selfieBase64: selfieImage
        })
      });

      const data = await response.json();
      if (!response.ok) {
         throw new Error(data.error || 'Erro ao processar verificação facial');
      }

      // Se passou
      const { error: updateError } = await (supabase as any)
        .from('kyc_profiles')
        .update({ status: 'approved' })
        .eq('user_id', session.user.id);
        
      if (updateError) throw new Error('Erro ao atualizar status do KYC no banco');

      Alert.alert(
        'KYC Aprovado!',
        'Sua identidade foi confirmada com sucesso! Você já pode realizar depósitos normalmente.',
        [{ text: 'Concluir', onPress: () => router.dismissAll() }] // Or router.push('/') or back to depositar-pix
      );
      // Wait to close
      setTimeout(() => {
         router.push('/depositar-pix' as any);
      }, 1500)

    } catch (e: any) {
      Alert.alert('Erro na Verificação', e.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <View style={styles.titleBox}>
          <Text style={styles.title}>RECONHECIMENTO{'\n'}FACIAL</Text>
          <View style={styles.goldLine} />
          <Text style={styles.subtitle}>
            Para finalizar, precisamos confirmar se você é mesmo o titular do documento recém enviado.
          </Text>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressRow}>
          {['Dados', 'Documento', 'Selfie'].map((step, i) => (
            <View key={i} style={styles.progressItem}>
              <View style={[styles.progressDot, i === 2 && styles.progressDotActive, i < 2 && styles.progressDotDone]}>
                {i < 2 ? (
                  <Feather name="check" size={14} color={V.bg} />
                ) : (
                  <Text style={[styles.progressNum, i === 2 && styles.progressNumActive]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.progressLabel, i === 2 && { color: V.gold }]}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Selfie Box */}
        <View style={styles.card}>
          <Text style={styles.label}>ALINHE SEU ROSTO DENTRO DO OVAL</Text>
          <TouchableOpacity 
            style={styles.photoBox} 
            onPress={takeSelfie}
            activeOpacity={0.9}
          >
            {selfieImage ? (
              <Image source={{ uri: `data:image/jpeg;base64,${selfieImage}` }} style={styles.photoImage} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <View style={styles.ovalMask} />
                <Feather name="camera" size={32} color={V.gold} style={{ position: 'absolute', top: 120 }} />
                <Text style={styles.photoText}>TOCAR PARA CAPTURAR</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>Tire boné, óculos ou acessórios que cubram seu rosto.</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!selfieImage || isUploading) && { opacity: 0.5 }]}
          onPress={submitSelfie}
          disabled={!selfieImage || isUploading}
          activeOpacity={0.85}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color={V.bg} />
          ) : (
            <Feather name="check-circle" size={20} color={V.bg} />
          )}
          <Text style={styles.saveBtnText}>
            {isUploading ? 'COMPARANDO ROSTOS...' : 'CONCLUIR VERIFICAÇÃO'}
          </Text>
        </TouchableOpacity>

      </ScrollView>
      <BottomNav activeRoute="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 120 },
  titleBox: { marginTop: 24, marginBottom: 28 },
  title: { fontSize: 28, fontFamily: F.title, color: V.gold, letterSpacing: 2, lineHeight: 38 },
  goldLine: { width: 48, height: 2, backgroundColor: V.gold, marginTop: 8, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
    paddingVertical: 16,
    paddingHorizontal: 8,
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
  },
  progressItem: { flex: 1, alignItems: 'center', gap: 6 },
  progressDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: V.surface2,
    borderWidth: 1.5,
    borderColor: V.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotDone: { backgroundColor: V.gold, borderColor: V.gold },
  progressDotActive: { backgroundColor: V.surface1, borderColor: V.gold },
  progressNum: { fontSize: 12, fontFamily: F.bold, color: V.muted },
  progressNumActive: { color: V.gold },
  progressLabel: { fontSize: 10, fontFamily: F.semi, color: V.muted, textAlign: 'center' },

  card: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: V.border,
    alignItems: 'center',
  },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 16, width: '100%', textAlign: 'center' },
  
  photoBox: {
    width: 240,
    height: 320,
    borderRadius: 120, // oval shape container
    borderWidth: 2,
    borderColor: V.gold,
    backgroundColor: V.surface2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
  ovalMask: {
    position: 'absolute',
    width: 180,
    height: 240,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: 'rgba(201,168,76, 0.3)',
    borderStyle: 'dashed'
  },
  photoText: { color: V.gold, fontFamily: F.bold, fontSize: 12, letterSpacing: 1, position: 'absolute', bottom: 40 },
  photoImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  hint: { color: V.muted, fontSize: 11, fontFamily: F.body, textAlign: 'center', paddingHorizontal: 20 },

  saveBtn: {
    backgroundColor: V.gold,
    height: 56,
    borderRadius: V.r8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
    shadowColor: V.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  saveBtnText: { color: V.bg, fontSize: 14, fontFamily: F.bold, letterSpacing: 1.5 },
});
