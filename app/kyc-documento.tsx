import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import { useSettings } from '@/constants/SettingsContext';
import { F, V } from '@/constants/theme';
import { supabase } from '@/src/services/supabase';
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
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

export default function KYCDocumentoScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [isSidebarVisible, setSidebarVisible] = useState(false);

  const [documentType, setDocumentType] = useState<'RG' | 'RNM'>('RG');
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const takePicture = async (side: 'front' | 'back') => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão', 'Precisamos da câmera para tirar a foto do documento.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
      base64: true, // We grab the base64 to send it to backend
    });

    if (!result.canceled && result.assets[0].base64) {
      if (side === 'front') setFrontImage(result.assets[0].base64);
      else setBackImage(result.assets[0].base64);
    }
  };

  const submitDocument = async () => {
    if (!frontImage || !backImage) {
      Alert.alert('Incompleto', 'Por favor, tire a foto da frente e do verso do documento.');
      return;
    }

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      // We send both front and back base64 to our Vercel Serverless Function
      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/onfido?action=uploadDocument`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          type: documentType,
          frontBase64: frontImage,
          backBase64: backImage
        })
      });

      const data = await response.json();
      if (!response.ok) {
         if (data.divergence) {
            // Se o backend detectou divergência dos dados de OCR com o que o usuário preencheu no KYCPasso1
            throw new Error(`Dados do documento não conferem com o formulário:\n${data.divergenceDetails}`);
         }
         throw new Error(data.error || 'Erro ao processar documento');
      }

      // Em sucesso, avançar para selfie
      router.push('/kyc-facial' as any);

    } catch (e: any) {
      Alert.alert('Erro na Verificação', e.message);
    } finally {
      setIsUploading(false);
    }
  };

  const renderSideSelector = (side: 'front' | 'back', image: string | null) => {
    const isFront = side === 'front';
    return (
      <TouchableOpacity 
        style={styles.photoBox} 
        onPress={() => takePicture(side)}
        activeOpacity={0.8}
      >
        {image ? (
          <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={styles.photoImage} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Feather name="camera" size={28} color={V.gold} />
            <Text style={styles.photoText}>{isFront ? 'FOTOGRAFAR FRENTE' : 'FOTOGRAFAR VERSO'}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <View style={styles.titleBox}>
          <Text style={styles.title}>FOTO DO{'\n'}DOCUMENTO</Text>
          <View style={styles.goldLine} />
          <Text style={styles.subtitle}>
            Para garantir sua segurança, solicitamos as fotos do seu documento. Certifique-se que o ambiente está iluminado e sem reflexos.
          </Text>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressRow}>
          {['Dados', 'Documento', 'Selfie'].map((step, i) => (
            <View key={i} style={styles.progressItem}>
              <View style={[styles.progressDot, i === 1 && styles.progressDotActive, i < 1 && styles.progressDotDone]}>
                {i < 1 ? (
                  <Feather name="check" size={14} color={V.bg} />
                ) : (
                  <Text style={[styles.progressNum, i === 1 && styles.progressNumActive]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.progressLabel, i === 1 && { color: V.gold }]}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Type Selector */}
        <View style={styles.card}>
          <Text style={styles.label}>TIPO DE DOCUMENTO</Text>
          <View style={styles.row}>
            <TouchableOpacity 
              style={[styles.typeBtn, documentType === 'RG' && styles.typeBtnActive]}
              onPress={() => setDocumentType('RG')}
            >
              <Text style={[styles.typeText, documentType === 'RG' && styles.typeTextActive]}>RG (Identidade)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeBtn, documentType === 'RNM' && styles.typeBtnActive]}
              onPress={() => setDocumentType('RNM')}
            >
              <Text style={[styles.typeText, documentType === 'RNM' && styles.typeTextActive]}>RNM / RNE</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Photos */}
        <View style={styles.card}>
            <Text style={styles.label}>FRENTE E VERSO</Text>
            <View style={{ gap: 16 }}>
              {renderSideSelector('front', frontImage)}
              {renderSideSelector('back', backImage)}
            </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, (!frontImage || !backImage || isUploading) && { opacity: 0.5 }]}
          onPress={submitDocument}
          disabled={!frontImage || !backImage || isUploading}
          activeOpacity={0.85}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color={V.bg} />
          ) : (
            <Feather name="upload-cloud" size={20} color={V.bg} />
          )}
          <Text style={styles.saveBtnText}>
            {isUploading ? 'PROCESSANDO (OCR)...' : 'ENVIAR E CONTINUAR'}
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

  // Progress
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
  },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12 },
  typeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: V.border,
    borderRadius: V.r8,
    alignItems: 'center',
    backgroundColor: V.surface2,
  },
  typeBtnActive: { borderColor: V.gold, backgroundColor: 'rgba(201,168,76,0.1)' },
  typeText: { color: V.muted, fontFamily: F.bold, fontSize: 12, letterSpacing: 1 },
  typeTextActive: { color: V.gold },

  photoBox: {
    width: '100%',
    height: 180,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
    backgroundColor: V.surface2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed'
  },
  photoPlaceholder: { alignItems: 'center', gap: 12 },
  photoText: { color: V.gold, fontFamily: F.bold, fontSize: 12, letterSpacing: 1 },
  photoImage: { width: '100%', height: '100%', resizeMode: 'cover' },

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
