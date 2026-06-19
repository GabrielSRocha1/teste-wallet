import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import { useSettings } from '@/constants/SettingsContext';
import { F, V } from '@/constants/theme';
import { saveKYC, initiateKyc, syncKycStatus } from '@/src/services/kycService';
import { supabase } from '@/src/services/supabase';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface FormData {
  nome: string;
  sobrenome: string;
  data_nascimento: string;
  nacionalidade: string;
  cpf: string;
}

const NACIONALIDADES = [
  'Brasileira', 'Americana', 'Argentina', 'Paraguaia', 'Uruguaia',
  'Boliviana', 'Colombiana', 'Venezuelana', 'Peruana', 'Chilena', 'Outra',
];

function formatCPF(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatDate(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})(\d)/, '$1/$2');
}

export default function KYCScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [showNacionalidades, setShowNacionalidades] = useState(false);
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const waitingForVerification = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      const returning = appState.current.match(/inactive|background/) && nextState === 'active';
      appState.current = nextState;

      if (returning && waitingForVerification.current) {
        waitingForVerification.current = false;
        setIsChecking(true);
        try {
          const result = await syncKycStatus();
          if (result.approved) {
            Alert.alert(t('✓ Verificação Aprovada'), t('Seu KYC foi aprovado com sucesso!'), [
              { text: 'OK', onPress: () => router.back() },
            ]);
          } else if (result.kycStatus === 'onHold' || result.kycStatus === 'initiated') {
            Alert.alert(t('Em Análise'), t('Sua verificação está sendo processada. Você será notificado em breve.'));
          } else if (result.kycStatus === 'rejected') {
            Alert.alert(t('Verificação Rejeitada'), t('Sua verificação foi rejeitada. Tente novamente.'));
          } else {
            Alert.alert(t('Status Atualizado'), t('Status atual: {status}', { status: String(result.kycStatus ?? t('processando')) }));
          }
        } catch {
          Alert.alert(t('Aviso'), t('Não foi possível verificar o status. Tente novamente em instantes.'));
        } finally {
          setIsChecking(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const [form, setForm] = useState<FormData>({
    nome: '',
    sobrenome: '',
    data_nascimento: '',
    nacionalidade: 'Brasileira',
    cpf: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const update = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const isValidCPF = (cpf: string) => {
    let strCPF = cpf.replace(/\D/g, '');
    if (strCPF.length !== 11 || /^(\d)\1+$/.test(strCPF)) return false;
    let soma = 0;
    let resto;
    for (let i = 1; i <= 9; i++) soma += parseInt(strCPF.substring(i - 1, i)) * (11 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(strCPF.substring(9, 10))) return false;
    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(strCPF.substring(i - 1, i)) * (12 - i);
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(strCPF.substring(10, 11))) return false;
    return true;
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!form.nome.trim()) newErrors.nome = 'Campo obrigatório';
    if (!form.sobrenome.trim()) newErrors.sobrenome = 'Campo obrigatório';
    if (!form.data_nascimento.trim()) newErrors.data_nascimento = 'Campo obrigatório';
    if (!form.nacionalidade.trim()) newErrors.nacionalidade = 'Campo obrigatório';

    const cpfDigits = form.cpf.replace(/\D/g, '');
    if (!cpfDigits) {
      newErrors.cpf = 'Campo obrigatório';
    } else if (cpfDigits.length !== 11) {
      newErrors.cpf = 'CPF inválido (11 dígitos)';
    } else if (!isValidCPF(cpfDigits)) {
      newErrors.cpf = 'CPF matematicamente inválido';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const [apiError, setApiError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!validate()) return;

    setApiError(null);
    setIsSaving(true);
    
    // Diagnóstico Web
    if (Platform.OS === 'web') {
      const apiBase = require('@/src/services/apiUrl').getApiBaseUrl();
      console.log('[KYC] DEBUG: Iniciando processo no navegador');
      console.log('[KYC] DEBUG: API Base URL:', apiBase);
      console.log('[KYC] DEBUG: Form data:', { ...form, cpf: '***' });
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t('Usuário não autenticado.'));

      // Converter DD/MM/AAAA para AAAA-MM-DD antes de salvar no banco
      const dateParts = form.data_nascimento.split('/');
      const isoDate = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : form.data_nascimento;

      const result = await saveKYC(user.id, {
        nome: form.nome.trim(),
        sobrenome: form.sobrenome.trim(),
        data_nascimento: isoDate,
        nacionalidade: form.nacionalidade.trim(),
        cpf: form.cpf.replace(/\D/g, ''),
      });

      if (!result.success) throw new Error(result.error);

      // Iniciar sessão Didit no Backend
      const initResult = await initiateKyc(user.id);
      
      if (!initResult.success || !initResult.verificationUrl) {
        throw new Error(initResult.error || t('Não foi possível iniciar a verificação biométrica.'));
      }

      const message = t('Agora você será redirecionado para a plataforma Didit para realizar a verificação facial e de documentos.');

      if (Platform.OS === 'web') {
        const proceed = window.confirm(`${t('✓ Dados Salvos')}\n\n${message}\n\n${t('Deseja continuar para a verificação?')}`);
        if (proceed && initResult.verificationUrl) {
          waitingForVerification.current = true;
          window.open(initResult.verificationUrl, '_blank');
        }
      } else {
        Alert.alert(
          t('✓ Dados Salvos'),
          message,
          [
            {
              text: t('Ir para Verificação'),
              onPress: () => {
                if (initResult.verificationUrl) {
                  waitingForVerification.current = true;
                  Linking.openURL(initResult.verificationUrl);
                }
              },
            }
          ]
        );
      }
    } catch (e: any) {
      // Diagnóstico aprofundado do erro
      const apiBase = require('@/src/services/apiUrl').getApiBaseUrl();
      const errMsg = e.message || 'Erro ao salvar. Tente novamente.';
      const detailedError = `${errMsg}\n(Destino: ${apiBase})`;
      
      setApiError(detailedError);
      console.error('[KYC] Erro fatal no fluxo:', e);

      if (Platform.OS === 'web') {
        alert(`${t('Erro')}: ${detailedError}`);
      } else {
        Alert.alert(t('Erro'), detailedError);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: V.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={V.bg} />
        <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ── */}
          <View style={styles.titleBox}>
            <View style={styles.badge}>
              <Feather name="shield" size={13} color={V.gold} />
              <Text style={styles.badgeText}>{t('VERIFICAÇÃO OBRIGATÓRIA')}</Text>
            </View>
            <Text style={styles.title}>{t('VERIFICAÇÃO')}{'\n'}{t('DE IDENTIDADE')}</Text>
            <View style={styles.goldLine} />
            <Text style={styles.subtitle}>
              {t('Para processar seu depósito com segurança, precisamos confirmar sua identidade. Os dados são criptografados e protegidos.')}
            </Text>
          </View>

          {/* ── Formulário ── */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.cardIcon}>
                <Feather name="user" size={16} color={V.gold} />
              </View>
              <Text style={styles.cardTitle}>{t('DADOS PESSOAIS')}</Text>
            </View>

            {/* Nome */}
            <View style={styles.row}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>{t('NOME')}</Text>
                <View style={[styles.inputWrapper, errors.nome && styles.inputError]}>
                  <TextInput
                    style={styles.input}
                    placeholder={t('Seu nome')}
                    placeholderTextColor={V.muted}
                    value={form.nome}
                    autoCapitalize="words"
                    onChangeText={v => update('nome', v)}
                  />
                </View>
                {errors.nome && <Text style={styles.errorText}>{errors.nome}</Text>}
              </View>

              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>{t('SOBRENOME')}</Text>
                <View style={[styles.inputWrapper, errors.sobrenome && styles.inputError]}>
                  <TextInput
                    style={styles.input}
                    placeholder={t('Seu sobrenome')}
                    placeholderTextColor={V.muted}
                    value={form.sobrenome}
                    autoCapitalize="words"
                    onChangeText={v => update('sobrenome', v)}
                  />
                </View>
                {errors.sobrenome && <Text style={styles.errorText}>{errors.sobrenome}</Text>}
              </View>
            </View>

            {/* CPF */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>CPF</Text>
              <View style={[styles.inputWrapper, errors.cpf && styles.inputError]}>
                <TextInput
                  style={styles.input}
                  placeholder="000.000.000-00"
                  placeholderTextColor={V.muted}
                  value={form.cpf}
                  keyboardType="numeric"
                  maxLength={14}
                  onChangeText={v => update('cpf', formatCPF(v))}
                />
              </View>
              {errors.cpf && <Text style={styles.errorText}>{errors.cpf}</Text>}
            </View>

            {/* Data de Nascimento */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('DATA DE NASCIMENTO')}</Text>
              <View style={[styles.inputWrapper, errors.data_nascimento && styles.inputError]}>
                <TextInput
                  style={styles.input}
                  placeholder={t('DD/MM/AAAA')}
                  placeholderTextColor={V.muted}
                  value={form.data_nascimento}
                  keyboardType="numeric"
                  maxLength={10}
                  onChangeText={v => update('data_nascimento', formatDate(v))}
                />
              </View>
              {errors.data_nascimento && <Text style={styles.errorText}>{errors.data_nascimento}</Text>}
            </View>

            {/* Nacionalidade */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('NACIONALIDADE')}</Text>
              <TouchableOpacity
                style={[styles.inputWrapper, styles.selectWrapper, errors.nacionalidade && styles.inputError]}
                onPress={() => setShowNacionalidades(v => !v)}
                activeOpacity={0.8}
              >
                <Text style={[styles.input, { paddingVertical: 13, color: V.text }]}>
                  {form.nacionalidade || t('Selecionar...')}
                </Text>
                <Feather
                  name={showNacionalidades ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={V.muted}
                  style={{ marginRight: 14 }}
                />
              </TouchableOpacity>
              {errors.nacionalidade && <Text style={styles.errorText}>{errors.nacionalidade}</Text>}

              {showNacionalidades && (
                <View style={styles.dropdown}>
                  {NACIONALIDADES.map(nac => (
                    <TouchableOpacity
                      key={nac}
                      style={[
                        styles.dropdownItem,
                        form.nacionalidade === nac && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        update('nacionalidade', nac);
                        setShowNacionalidades(false);
                      }}
                    >
                      <Text style={[
                        styles.dropdownItemText,
                        form.nacionalidade === nac && styles.dropdownItemTextActive,
                      ]}>
                        {nac}
                      </Text>
                      {form.nacionalidade === nac && (
                        <Feather name="check" size={14} color={V.gold} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Privacy notice */}
          <View style={styles.privacyBox}>
            <Feather name="lock" size={13} color={V.muted} />
            <Text style={styles.privacyText}>
              {t('Seus dados são protegidos com criptografia e utilizados exclusivamente para fins de verificação de identidade (KYC), conforme a legislação vigente.')}
            </Text>
          </View>

          {/* Erro da API (Feedback Visual) */}
          {apiError && (
            <View style={styles.errorContainer}>
              <Feather name="alert-circle" size={16} color="#E74C3C" />
              <Text style={styles.apiErrorText}>{apiError}</Text>
            </View>
          )}

          {/* Botão salvar */}
          <TouchableOpacity
            style={[styles.saveBtn, (isSaving || isChecking) && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={isSaving || isChecking}
            activeOpacity={0.85}
          >
            {(isSaving || isChecking)
              ? <ActivityIndicator size="small" color={V.bg} />
              : <Feather name="check-circle" size={20} color={V.bg} />
            }
            <Text style={styles.saveBtnText}>
              {isSaving ? t('SALVANDO...') : isChecking ? t('VERIFICANDO...') : t('SALVAR E CONTINUAR')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>{t('CANCELAR')}</Text>
          </TouchableOpacity>
        </ScrollView>

        <BottomNav activeRoute="none" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 120 },

  titleBox: { marginTop: 24, marginBottom: 28 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(201,168,76,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.3)',
    marginBottom: 14,
  },
  badgeText: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },
  title: { fontSize: 28, fontFamily: F.title, color: V.gold, letterSpacing: 2, lineHeight: 38 },
  goldLine: { width: 48, height: 2, backgroundColor: V.gold, marginTop: 8, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  card: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: V.border,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(201,168,76,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 12, fontFamily: F.title, color: V.gold, letterSpacing: 1.5 },

  row: { flexDirection: 'row', gap: 10 },
  fieldGroup: { marginBottom: 16, minWidth: 0 },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 6, marginLeft: 2 },
  inputWrapper: {
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    minWidth: 0,
  },
  selectWrapper: { justifyContent: 'space-between' },
  inputError: { borderColor: '#E74C3C', backgroundColor: 'rgba(231,76,60,0.05)' },
  input: {
    color: V.text,
    fontFamily: F.medium,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  errorText: { fontSize: 10, fontFamily: F.bold, color: '#E74C3C', marginTop: 4, marginLeft: 2 },

  // Dropdown nacionalidade
  dropdown: {
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(201,168,76,0.08)',
  },
  dropdownItemActive: { backgroundColor: 'rgba(201,168,76,0.08)' },
  dropdownItemText: { fontFamily: F.medium, fontSize: 14, color: V.text },
  dropdownItemTextActive: { color: V.gold },

  privacyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: V.surface1,
    borderRadius: V.r8,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: V.border,
  },
  privacyText: { flex: 1, fontSize: 11, fontFamily: F.body, color: V.muted, lineHeight: 17 },

  saveBtn: {
    backgroundColor: V.gold,
    height: 56,
    borderRadius: V.r8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    shadowColor: V.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  saveBtnText: { color: V.bg, fontSize: 14, fontFamily: F.bold, letterSpacing: 1.5 },
  cancelBtn: { paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { color: V.muted, fontFamily: F.bold, fontSize: 10, letterSpacing: 1 },
  // API Error Feedback
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(231,76,60,0.1)',
    padding: 12,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.3)',
    marginBottom: 16,
  },
  apiErrorText: {
    flex: 1,
    color: '#E74C3C',
    fontSize: 12,
    fontFamily: F.bold,
  },
});
