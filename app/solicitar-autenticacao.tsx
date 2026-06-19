import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Header from '@/components/Header';
import { getAuthFrequency, setAuthFrequency } from '@/constants/biometrics-storage';
import { V, F, PAD } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

export default function SolicitarAutenticacaoScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();

  const options = [
    { id: 'always',   label: t('Cada vez que abrir o app') },
    { id: '1min',     label: t('Após 1 minuto') },
    { id: '5min',     label: t('Após 5 minutos') },
    { id: '10min',    label: t('Após 10 minutos') },
    { id: '15min',    label: t('Após 15 minutos') },
    { id: '30min',    label: t('Após 30 minutos') },
    { id: '1hour',    label: t('Após 1 hora') },
    { id: '4hours',   label: t('Após 4 horas') },
    { id: '8hours',   label: t('Após 8 horas') },
    { id: '24hours',  label: t('Após 24 horas') },
    { id: 'never',    label: t('Nunca') },
  ];

  const [selectedOption, setSelectedOption] = useState('always');

  useEffect(() => {
    const loadSetting = async () => {
      setSelectedOption(await getAuthFrequency());
    };
    loadSetting();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      
      <Header onBackPress={() => router.back()} />

      <View style={styles.titleBox}>
          <Text style={styles.title}>{t('FREQUÊNCIA')}</Text>
          <View style={styles.goldLine} />
          <Text style={styles.subtitle}>{t('Defina quando o app deve solicitar autenticação biométrica.')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {options.map((option, index) => {
            const isSelected = selectedOption === option.id;
            const isLast = index === options.length - 1;
            return (
              <TouchableOpacity 
                key={option.id} 
                style={[styles.optionRow, isLast && { borderBottomWidth: 0 }]} 
                onPress={async () => {
                  setSelectedOption(option.id);
                  await setAuthFrequency(option.id);
                }}
                activeOpacity={0.6}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {option.label}
                </Text>
                
                <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                  {isSelected && <Feather name="check" size={12} color={V.bg} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        
        <View style={styles.infoBox}>
          <Feather name="shield" size={18} color={V.gold} />
          <Text style={styles.infoText}>
            {t('Recomendamos o uso da autenticação sempre que o aplicativo for aberto para garantir a máxima segurança dos seus ativos no ecossistema Verun Crypto.')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  titleBox: { paddingHorizontal: 20, marginTop: 16, marginBottom: 20 },
  title: { fontSize: 24, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 4, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted },

  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { backgroundColor: V.surface1, borderRadius: 12, borderWidth: 1, borderColor: V.border, overflow: 'hidden', ...V.shadow },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: V.border },
  optionText: { fontSize: 14, color: V.text, fontFamily: F.semi },
  optionTextSelected: { color: V.gold, fontFamily: F.bold },
  radioCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: V.border, alignItems: 'center', justifyContent: 'center' },
  radioCircleSelected: { borderColor: V.gold, backgroundColor: V.gold },
  infoBox: { flexDirection: 'row', gap: 12, padding: 20, marginTop: 24, backgroundColor: 'rgba(201,168,76,0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(201,168,76,0.2)', alignItems: 'center' },
  infoText: { flex: 1, fontSize: 12, color: V.muted, lineHeight: 18, fontFamily: F.body },
});
