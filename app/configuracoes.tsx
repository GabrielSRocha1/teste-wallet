import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar, Switch, Animated, Linking, Platform, Modal, TextInput, ActivityIndicator } from 'react-native';
import { supabase } from '@/src/services/supabase';
import { getBiometricsEnabled, setBiometricsEnabled as saveBiometricsEnabled } from '@/constants/biometrics-storage';
import { getNotificationsEnabled, setNotificationsEnabled as saveNotificationsEnabled } from '@/constants/notifications-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import PasswordModal from '@/components/PasswordModal';
import keyManager from '@/src/services/keyManager';
import transactionService from '@/src/services/transactionService';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ConfiguracoesScreen() {
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [userData, setUserData] = useState({ email: '', telefone: '', id: '' });
  const [isUserModalVisible, setIsUserModalVisible] = useState(false);
  const [editingField, setEditingField] = useState<'email' | 'telefone' | 'walletName' | null>(null);
  const [editValue, setEditValue] = useState('');
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const { language, currency, network, setLanguage, setCurrency, setNetwork, t, walletName, setWalletName } = useSettings();

  useEffect(() => {
    const loadSettings = async () => {
      setBiometricsEnabled(await getBiometricsEnabled());
      setNotificationsEnabled(await getNotificationsEnabled());
      
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Busca dados estendidos na tabela usuarios
        const { data } = await supabase.from('usuarios').select('email, telefone, id').eq('id', user.id).single();
        
        // Sempre garantimos que temos o ID do auth no estado, mesmo que não haja perfil no DB ainda
        setUserData({
          email: data?.email || user.email || '',
          telefone: data?.telefone || '',
          id: user.id // Prioriza o ID do auth para garantir que operações funcionem
        });
      }
    };
    loadSettings();
  }, []);

  const openSidebar = () => setSidebarVisible(true);
  const closeSidebar = () => setSidebarVisible(false);

  const showCustomToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: Platform.OS !== 'web',
    }).start();

    setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => setShowToast(false));
    }, 3000);
  };

  const handleNetworkChange = (newNet: 'mainnet' | 'devnet') => {
    setNetwork(newNet);
    showCustomToast(`Rede alterada para ${newNet === 'mainnet' ? 'Mainnet' : 'Devnet'}`);
  };

  const handleLanguageChange = (lang: any, langName: string) => {
    setLanguage(lang);
    showCustomToast(`Idioma alterado para ${langName}`);
  };

  const handleCurrencyChange = (curr: any, currName: string) => {
    setCurrency(curr);
    showCustomToast(`Moeda alterada para ${currName}`);
  };

  const handleUpdateUser = async () => {
    if (editingField === 'walletName') {
      await setWalletName(editValue);
      showCustomToast(t('Identificação atualizada!'));
      setIsUserModalVisible(false);
      setLoading(false);
      return;
    }

    if (!userData.id) {
      // Tenta recuperar o ID caso tenha falhado no load original
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('Erro'), t('Usuário não autenticado.'));
        return;
      }
      userData.id = user.id;
    }

    setLoading(true);
    
    // Usamos upsert para garantir que funcione mesmo que o perfil (linha no DB) ainda não exista
    // O Supabase irá atualizar os campos fornecidos e manter os outros se a linha já existir.
    const { error } = await supabase
      .from('usuarios')
      .upsert({ 
        id: userData.id,
        [editingField!]: editValue.trim()
      }, { onConflict: 'id' });

    if (error) {
      console.error('[UpdateUser] Erro:', error);
      Alert.alert(t('Erro'), t('Ocorreu um erro ao atualizar seus dados no banco.'));
    } else {
      setUserData({ ...userData, [editingField!]: editValue.trim() });
      showCustomToast(t('Dados atualizados com sucesso!'));
      setIsUserModalVisible(false);
    }
    setLoading(false);
  };

  const openEditModal = (field: 'email' | 'telefone' | 'walletName') => {
    setEditingField(field);
    setEditValue(field === 'walletName' ? (walletName || '') : userData[field]);
    setIsUserModalVisible(true);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      
      <Header onMenuPress={openSidebar} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
          <Text style={styles.title}>{t('Configurações').toUpperCase()}</Text>
          <View style={styles.goldLine} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('Geral').toUpperCase()}</Text>
          <View style={styles.card}>
            <View style={styles.settingItem}>
               <View style={styles.settingHeader}>
                  <Feather name="globe" size={16} color={V.gold} />
                  <Text style={styles.rowText}>{t('Idioma')}</Text>
               </View>
               <View style={styles.optionsRow}>
                  <TouchableOpacity 
                    style={[styles.optBtn, language === 'en' && styles.optBtnActive]} 
                    onPress={() => handleLanguageChange('en', 'Inglês')}
                  >
                    <Text style={[styles.optText, language === 'en' && styles.optTextActive]}>{t('Inglês')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.optBtn, language === 'es' && styles.optBtnActive]} 
                    onPress={() => handleLanguageChange('es', 'Espanhol')}
                  >
                    <Text style={[styles.optText, language === 'es' && styles.optTextActive]}>{t('Espanhol')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.optBtn, language === 'pt' && styles.optBtnActive]} 
                    onPress={() => handleLanguageChange('pt', 'Português')}
                  >
                    <Text style={[styles.optText, language === 'pt' && styles.optTextActive]}>{t('Português')}</Text>
                  </TouchableOpacity>
               </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.settingItem}>
               <View style={styles.settingHeader}>
                  <Feather name="dollar-sign" size={16} color={V.gold} />
                  <Text style={styles.rowText}>{t('Moeda')}</Text>
               </View>
               <View style={styles.optionsRow}>
                  <TouchableOpacity 
                    style={[styles.optBtn, currency === 'USD' && styles.optBtnActive]} 
                    onPress={() => handleCurrencyChange('USD', 'Dólar Americano')}
                  >
                    <Text style={[styles.optText, currency === 'USD' && styles.optTextActive]}>{t('Dólar Americano')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.optBtn, currency === 'PYG' && styles.optBtnActive]} 
                    onPress={() => handleCurrencyChange('PYG', 'Guarani Paraguaio')}
                  >
                    <Text style={[styles.optText, currency === 'PYG' && styles.optTextActive]}>{t('Guarani Paraguaio')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.optBtn, currency === 'BRL' && styles.optBtnActive]} 
                    onPress={() => handleCurrencyChange('BRL', 'Real Brasileiro')}
                  >
                    <Text style={[styles.optText, currency === 'BRL' && styles.optTextActive]}>{t('Real Brasileiro')}</Text>
                   </TouchableOpacity>
                </View>
             </View>

             <View style={styles.divider} />

             <View style={styles.settingItem}>
                <View style={styles.settingHeader}>
                   <Feather name="server" size={16} color={V.gold} />
                   <Text style={styles.rowText}>{t('Rede Solana')}</Text>
                </View>
                <View style={styles.optionsRow}>
                   <TouchableOpacity 
                     style={[styles.optBtn, network === 'mainnet' && styles.optBtnActive]} 
                     onPress={() => handleNetworkChange('mainnet')}
                   >
                     <Text style={[styles.optText, network === 'mainnet' && styles.optTextActive]}>Mainnet ({t('Principal')})</Text>
                   </TouchableOpacity>
                   <TouchableOpacity 
                     style={[styles.optBtn, network === 'devnet' && styles.optBtnActive]} 
                     onPress={() => handleNetworkChange('devnet')}
                   >
                     <Text style={[styles.optText, network === 'devnet' && styles.optTextActive]}>Devnet ({t('Teste')})</Text>
                   </TouchableOpacity>
                </View>
             </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('CONTA & SEGURANÇA')}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={() => openEditModal('walletName')}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="tag" size={18} color={V.gold} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('Identificação da Carteira')}</Text>
                  <Text style={styles.rowSubtext}>{walletName || t('Ex: Carteira Principal')}</Text>
                </View>
              </View>
              <Feather name="edit-2" size={16} color={V.gold} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.row} onPress={() => openEditModal('email')}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="mail" size={18} color={V.gold} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('E-mail')}</Text>
                  <Text style={styles.rowSubtext}>{userData.email || t('Não cadastrado')}</Text>
                </View>
              </View>
              <Feather name="edit-2" size={16} color={V.gold} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.row} onPress={() => openEditModal('telefone')}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="phone" size={18} color={V.gold} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('Telefone')}</Text>
                  <Text style={styles.rowSubtext}>{userData.telefone || t('Não cadastrado')}</Text>
                </View>
              </View>
              <Feather name="edit-2" size={16} color={V.gold} />
            </TouchableOpacity>

            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={() => router.push('/seguranca' as any)}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="shield" size={18} color={V.gold} />
                </View>
                <Text style={styles.rowText}>{t('Segurança e Privacidade')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.row} onPress={() => router.push('/solicitar-autenticacao' as any)}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { borderColor: V.success + '40' }]}>
                  <Feather name="shield" size={18} color={V.success} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('Autenticação Biométrica')}</Text>
                  <Text style={styles.rowSubtext}>{t('Configurar FaceID ou Digital')}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('PREFERÊNCIAS')}</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="bell" size={18} color={V.gold} />
                </View>
                <Text style={styles.rowText}>{t('Notificações Push')}</Text>
              </View>
              <Switch 
                value={notificationsEnabled} 
                onValueChange={async (val) => {
                  setNotificationsEnabled(val);
                  await saveNotificationsEnabled(val);
                }} 
                trackColor={{ false: '#333', true: 'rgba(201,168,76,0.3)' }}
                thumbColor={notificationsEnabled ? '#C9A84C' : '#999'}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(201,168,76,0.1)' }]}>
                  <Feather name="lock" size={18} color={V.gold} />
                </View>
                <Text style={styles.rowText}>{t('Bloqueio Biométrico')}</Text>
              </View>
              <Switch 
                value={biometricsEnabled} 
                onValueChange={async (val) => {
                  if (val) {
                    if (Platform.OS === 'web') {
                      // Na web, vamos permitir o fluxo avançar para fins de simulação/PWA
                      setIsPasswordModalVisible(true);
                      return;
                    }
                    const hasHardware = await LocalAuthentication.hasHardwareAsync();
                    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
                    if (hasHardware && isEnrolled) {
                      const result = await LocalAuthentication.authenticateAsync({
                        promptMessage: t('Autentique-se para habilitar'),
                      });
                      if (result.success) {
                        setIsPasswordModalVisible(true);
                      }
                    } else {
                      Alert.alert(t('Aviso'), t('Biometria não disponível ou não configurada no dispositivo.'));
                    }
                  } else {
                    setBiometricsEnabled(false);
                    await saveBiometricsEnabled(false);
                    await keyManager.removePinForBiometrics();
                  }
                }} 
                trackColor={{ false: '#333', true: 'rgba(201,168,76,0.3)' }}
                thumbColor={biometricsEnabled ? '#C9A84C' : '#999'}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('SUPORTE & INFORMAÇÕES')}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Feather name="help-circle" size={18} color={V.muted} />
                </View>
                <Text style={styles.rowText}>{t('Central de Ajuda')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity 
              style={styles.row}
              onPress={() => router.push('/politica-privacidade' as any)}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { borderColor: V.gold + '40' }]}>
                  <Feather name="file-text" size={18} color={V.gold} />
                </View>
                <Text style={styles.rowText}>{t('Política de Privacidade')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity 
              style={styles.row}
              onPress={() => Linking.openURL('https://lp.verumcrypto.com')}
            >
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Feather name="info" size={18} color={V.muted} />
                </View>
                <Text style={styles.rowText}>{t('Sobre o Verum')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
           <Text style={styles.version}>{t('Versão')} 1.0.4 • Build 2024.1</Text>
           <TouchableOpacity 
             style={{ marginTop: 10 }}
             onPress={() => router.push('/politica-privacidade' as any)}
           >
             <Text style={styles.footerLink}>{t('Termos e Política de Privacidade')}</Text>
           </TouchableOpacity>
        </View>

      </ScrollView>

      <BottomNav activeRoute="none" />
      <Sidebar isVisible={isSidebarVisible} onClose={closeSidebar} activeRoute="configuracoes" />

      <PasswordModal 
        isVisible={isPasswordModalVisible}
        onClose={() => setIsPasswordModalVisible(false)}
        loading={loading}
        title={t('VINCULAR BIOMETRIA')}
        description={t('Confirme sua senha mestre para permitir o uso da biometria em transações:')}
        onConfirm={async (password) => {
          setLoading(true);
          try {
            // Valida se a senha está correta tentando descriptografar
            await keyManager.loadDecrypted(password);
            
            // Sucesso! Salva o PIN para uso futuro com biometria
            await keyManager.savePinForBiometrics(password);
            setBiometricsEnabled(true);
            await saveBiometricsEnabled(true);
            setIsPasswordModalVisible(false);
            Alert.alert(t('Sucesso'), t('Biometria vinculada com sucesso! Agora você poderá efetuar transações e ver chaves apenas com sua digital/rosto.'));
          } catch (err) {
            Alert.alert(t('Erro'), t('Senha incorreta. Tente novamente.'));
          } finally {
            setLoading(false);
          }
        }}
      />

      <Modal
        visible={isUserModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsUserModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingField === 'walletName' ? t('IDENTIFICAÇÃO') : (editingField === 'email' ? t('ALTERAR E-MAIL') : t('ALTERAR TELEFONE'))}
            </Text>
            <Text style={styles.modalSub}>
              {editingField === 'walletName'
                ? t('Dê um nome para sua carteira para facilitar a identificação:')
                : (editingField === 'email' 
                  ? t('Insira seu novo endereço de e-mail para atualizar seu cadastro:') 
                  : t('Insira seu novo número de telefone para contato:'))}
            </Text>

            <TextInput
              style={styles.modalInput}
              value={editValue}
              onChangeText={setEditValue}
              placeholder={editingField === 'walletName' ? t('Ex: Minha Verum') : ''}
              placeholderTextColor={V.muted}
              autoCapitalize={editingField === 'walletName' ? 'sentences' : 'none'}
              keyboardType={editingField === 'email' ? 'email-address' : (editingField === 'telefone' ? 'phone-pad' : 'default')}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.modalBtnCancel} 
                onPress={() => setIsUserModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: V.muted }]}>{t('CANCELAR')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.modalBtnSave} 
                onPress={handleUpdateUser}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color={V.bg} /> : (
                  <Text style={[styles.modalBtnText, { color: V.bg }]}>{t('SALVAR')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {showToast && (
        <Animated.View style={[styles.toastContainer, { opacity: fadeAnim }]}>
          <Feather name="check-circle" size={18} color={V.bg} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 110 },
  
  titleBox: { marginTop: 24, marginBottom: 24 },
  title: { fontSize: 24, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 4 },

  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 10, fontFamily: F.semi, color: V.muted, letterSpacing: 1.5, marginBottom: 16, paddingHorizontal: 4 },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, borderWidth: 1, borderColor: V.border, ...V.shadow },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBox: { width: 38, height: 38, borderRadius: 19, backgroundColor: V.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border },
  rowText: { fontSize: 15, fontFamily: F.semi, color: V.text },
  rowSubtext: { fontSize: 13, fontFamily: F.body, color: V.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: V.border, marginLeft: 68, marginRight: 16 },
  
  footer: { alignItems: 'center', marginTop: 10, marginBottom: 40 },
  version: { fontSize: 10, fontFamily: F.body, color: '#333', letterSpacing: 1 },
  footerLink: {
    fontSize: 11,
    fontFamily: F.bold,
    color: V.gold,
    opacity: 0.8,
    textDecorationLine: 'underline',
  },
  
  settingItem: { padding: 16 },
  settingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  optionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  optBtn: { 
    flex: 1, 
    paddingVertical: 8, 
    borderRadius: V.r8, 
    backgroundColor: V.surface2, 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: V.border
  },
  optBtnActive: {
    backgroundColor: 'rgba(201,168,76,0.15)',
    borderColor: V.gold,
  },
  optText: { fontSize: 11, fontFamily: F.bold, color: V.muted },
  optTextActive: { color: V.gold },

  toastContainer: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: V.success,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...V.shadow,
    elevation: 5,
    zIndex: 9999,
  },
  toastText: {
    color: V.bg,
    fontFamily: F.bold,
    fontSize: 13,
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: V.surface1, width: '100%', maxWidth: 400, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: V.border, ...V.shadow },
  modalTitle: { fontSize: 18, fontFamily: F.title, color: V.gold, marginBottom: 12, textAlign: 'center' },
  modalSub: { fontSize: 14, fontFamily: F.body, color: V.muted, marginBottom: 24, textAlign: 'center' },
  modalInput: { height: 56, backgroundColor: 'transparent', borderRadius: V.r8, borderWidth: 1, borderColor: V.border, color: V.text, paddingHorizontal: 16, fontFamily: F.semi, fontSize: 15, marginBottom: 24, outlineStyle: 'none' as any },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalBtnCancel: { flex: 1, height: 50, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center', backgroundColor: V.surface2, borderWidth: 1, borderColor: V.border },
  modalBtnSave: { flex: 2, height: 50, borderRadius: V.r8, alignItems: 'center', justifyContent: 'center', backgroundColor: V.gold },
  modalBtnText: { fontFamily: F.bold, fontSize: 14 },
});
