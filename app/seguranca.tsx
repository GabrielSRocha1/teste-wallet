import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Modal, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

import { getUser, clearUser } from '@/constants/auth-storage';
import { supabase } from '@/src/services/supabase';

const NETWORK_OPTIONS: { code: 'mainnet' | 'devnet'; icon: '🌐' | '🧪'; label: string; description: string }[] = [
  { code: 'mainnet', icon: '🌐', label: 'Mainnet', description: 'Principal' },
  { code: 'devnet',  icon: '🧪', label: 'Devnet',  description: 'Teste' },
];

export default function SegurancaScreen() {
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);
  const [isNetworkModalVisible, setIsNetworkModalVisible] = useState(false);
  const { t, network, setNetwork } = useSettings();
  const currentNetwork = NETWORK_OPTIONS.find(n => n.code === network) || NETWORK_OPTIONS[0];

  const handleNetworkChange = (net: 'mainnet' | 'devnet') => {
    setNetwork(net);
    setIsNetworkModalVisible(false);
  };

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch (e) {}
    await clearUser();
    setIsLogoutModalVisible(false);
    router.replace('/login' as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      
      <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleBox}>
          <Text style={styles.title}>{t('SEGURANÇA')}</Text>
          <View style={styles.goldLine} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('Rede Solana').toUpperCase()}</Text>
          <View style={styles.card}>
            <View style={styles.networkItem}>
              <View style={styles.networkHeader}>
                <Feather name="server" size={16} color={V.gold} />
                <Text style={styles.rowText}>{t('Rede Solana')}</Text>
              </View>
              <TouchableOpacity
                style={styles.networkDropdown}
                onPress={() => setIsNetworkModalVisible(true)}
                activeOpacity={0.8}
              >
                <View style={styles.networkDropdownLeft}>
                  <Text style={styles.networkDropdownIcon}>{currentNetwork.icon}</Text>
                  <View>
                    <Text style={styles.networkDropdownText}>{currentNetwork.label}</Text>
                    <Text style={styles.networkDropdownSub}>{t(currentNetwork.description)}</Text>
                  </View>
                </View>
                <Feather name="chevron-down" size={18} color={V.gold} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('BACKUP E CHAVES')}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={() => router.push('/exportar-chave-privada' as any)}>
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Feather name="key" size={18} color={V.gold} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('Exportar Chave Privada')}</Text>
                  <Text style={styles.rowSubtext}>{t('Acesso direto à sua conta')}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.row} onPress={() => router.push('/exportar-frase' as any)}>
              <View style={styles.rowLeft}>
                <View style={styles.iconBox}>
                  <Feather name="file-text" size={18} color={V.gold} />
                </View>
                <View>
                  <Text style={styles.rowText}>{t('Frase de Recuperação')}</Text>
                  <Text style={styles.rowSubtext}>{t('As 12 palavras mestras')}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('SESSÃO')}</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} onPress={() => setIsLogoutModalVisible(true)}>
              <View style={styles.rowLeft}>
                <View style={[styles.iconBox, { borderColor: '#ff444440' }]}>
                  <Feather name="log-out" size={18} color="#ff4444" />
                </View>
                <View>
                  <Text style={[styles.rowText, { color: '#ff4444' }]}>{t('Sair da Conta')}</Text>
                  <Text style={styles.rowSubtext}>{t('Deslogar deste dispositivo')}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={V.muted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.infoBox}>
          <Feather name="lock" size={20} color={V.gold} />
          <Text style={styles.infoText}>
            {t('Sua frase de segurança é o único acesso aos seus fundos. NUNCA a compartilhe.')}
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={isNetworkModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsNetworkModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.networkModalContent}>
            <View style={styles.networkModalHeader}>
              <Text style={styles.modalTitle}>{t('Rede Solana').toUpperCase()}</Text>
              <TouchableOpacity onPress={() => setIsNetworkModalVisible(false)}>
                <Feather name="x" size={22} color={V.gold} />
              </TouchableOpacity>
            </View>
            {NETWORK_OPTIONS.map(opt => {
              const isActive = network === opt.code;
              return (
                <TouchableOpacity
                  key={opt.code}
                  style={[styles.networkOption, isActive && styles.networkOptionActive]}
                  onPress={() => handleNetworkChange(opt.code)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.networkOptionIcon}>{opt.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.networkOptionLabel, isActive && styles.networkOptionLabelActive]}>{opt.label}</Text>
                    <Text style={styles.networkOptionDesc}>{t(opt.description)}</Text>
                  </View>
                  {isActive && <Feather name="check" size={18} color={V.gold} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Logout Confirmation Modal */}
      <Modal
        visible={isLogoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLogoutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.warningIconBox}>
                <Feather name="alert-triangle" size={32} color={V.gold} />
              </View>
              <Text style={styles.modalTitle}>{t('ATENÇÃO!')}</Text>
            </View>

            <Text style={styles.modalDescription}>
              {t('Antes de sair, certifique-se de que salvou sua ')}
              <Text style={{ color: V.gold, fontFamily: F.bold }}>{t('Frase Secreta')}</Text>
              {t('. Sem ela, você perderá permanentemente o acesso aos seus fundos se desinstalar o app ou trocar de dispositivo.')}
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnPrimary]} 
                onPress={() => {
                  setIsLogoutModalVisible(false);
                  router.push('/exportar-frase' as any);
                }}
              >
                <Text style={styles.modalBtnTextPrimary}>{t('Ir pegar minha frase secreta')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnSecondary]} 
                onPress={handleLogout}
              >
                <Text style={styles.modalBtnTextSecondary}>{t('Continuar e Sair')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnOutline]} 
                onPress={() => setIsLogoutModalVisible(false)}
              >
                <Text style={styles.modalBtnTextOutline}>{t('Cancelar')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNav activeRoute="none" />
      <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
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
  sectionLabel: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1.5, marginBottom: 12, marginLeft: 4 },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, borderWidth: 1, borderColor: V.border, ...V.shadow, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: V.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: V.border },
  rowText: { fontSize: 16, fontFamily: F.semi, color: V.text },
  rowSubtext: { fontSize: 13, fontFamily: F.body, color: V.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: V.border, marginLeft: 78 },

  infoBox: { flexDirection: 'row', gap: 16, backgroundColor: 'rgba(201,168,76,0.03)', borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: 'rgba(201,168,76,0.1)', alignItems: 'center' },
  infoText: { flex: 1, fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: V.surface1,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: V.border,
    alignItems: 'center',
    ...V.shadow,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  warningIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(201,168,76,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: F.title,
    color: V.gold,
    letterSpacing: 2,
  },
  modalDescription: {
    fontSize: 15,
    fontFamily: F.body,
    color: V.text,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  modalButtons: {
    width: '100%',
    gap: 12,
  },
  modalBtn: {
    height: 52,
    borderRadius: V.r12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  modalBtnPrimary: {
    backgroundColor: V.gold,
  },
  modalBtnSecondary: {
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
  },
  modalBtnOutline: {
    backgroundColor: 'transparent',
  },
  modalBtnTextPrimary: {
    fontFamily: F.bold,
    fontSize: 14,
    color: V.bg,
  },
  modalBtnTextSecondary: {
    fontFamily: F.semi,
    fontSize: 14,
    color: V.text,
  },
  modalBtnTextOutline: {
    fontFamily: F.semi,
    fontSize: 14,
    color: V.muted,
  },

  networkItem: { padding: 16 },
  networkHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  networkDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: V.surface2,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  networkDropdownLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  networkDropdownIcon: { fontSize: 22 },
  networkDropdownText: { fontSize: 14, fontFamily: F.semi, color: V.text },
  networkDropdownSub: { fontSize: 12, fontFamily: F.body, color: V.muted, marginTop: 2 },

  networkModalContent: {
    backgroundColor: V.surface1,
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: V.border,
    ...V.shadow,
  },
  networkModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  networkOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 6,
  },
  networkOptionActive: {
    backgroundColor: 'rgba(201,168,76,0.1)',
    borderColor: 'rgba(201,168,76,0.5)',
  },
  networkOptionIcon: { fontSize: 26 },
  networkOptionLabel: { fontSize: 15, fontFamily: F.semi, color: V.text },
  networkOptionLabelActive: { color: V.gold },
  networkOptionDesc: { fontSize: 12, fontFamily: F.body, color: V.muted, marginTop: 2 },
});
