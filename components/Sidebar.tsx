import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Animated, Dimensions, TouchableWithoutFeedback, Image, Platform
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getUser } from '@/constants/auth-storage';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface SidebarProps {
  isVisible: boolean;
  onClose: () => void;
  activeRoute?: string;
}

export default function Sidebar({ isVisible, onClose, activeRoute }: SidebarProps) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [user, setUser] = useState<{ email: string; fullName?: string; walletName?: string } | null>(null);
  const { t } = useSettings();

  useEffect(() => {
    if (isVisible) {
      const loadUser = async () => {
        const storedUser = await getUser();
        const storedWalletName = await AsyncStorage.getItem('@VerumCrypto:walletName');
        if (storedUser) {
          setUser({ ...storedUser, walletName: storedWalletName || undefined });
        } else if (storedWalletName) {
          setUser({ email: '', walletName: storedWalletName } as any);
        }
      };
      loadUser();

      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 2 }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -SCREEN_WIDTH, duration: 260, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 260, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    }
  }, [isVisible]);



  return (
    <Modal visible={isVisible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.overlayBg, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View style={[styles.panel, { transform: [{ translateX: slideAnim }] }, { paddingTop: insets.top }]}>
          {/* Logo */}
          <View style={styles.panelHeader}>
            <Image source={require('../public/logo-dourada.png')} style={{ width: 140, height: 48, marginLeft: -15 }} resizeMode="contain" />
            <Text style={styles.panelSub}>{t('Wallet de autocustódia')}</Text>
          </View>

          {/* Menu */}
          <ScrollView 
            style={styles.nav} 
            contentContainerStyle={styles.navContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.menuLabel}>{t('Menu Principal')}</Text>
            <View style={styles.menuList}>
              <SidebarItem customIcon={require('../public/icone-receber.png')} label={t('Receber Crypto')} onPress={() => { onClose(); router.push('/depositar-crypto' as any); }} />
              <SidebarItem icon="plus-circle" label={t('Comprar Crypto')} onPress={() => { onClose(); router.push('/depositar-pix' as any); }} />
              <SidebarItem icon="trending-up" label={t('Investir')} active={activeRoute === 'investir'} onPress={() => { onClose(); router.push('/investir' as any); }} />
              <SidebarItem icon="refresh-ccw" label={t('CÂMBIO')} active={activeRoute === 'cambio'} onPress={() => { onClose(); router.push('/cambio' as any); }} />
              <SidebarItem customIcon={require('../public/icone-transferir.png')} label={t('Transferir')} onPress={() => { onClose(); router.push('/transferir' as any); }} />
            </View>

            <Text style={[styles.menuLabel, { marginTop: 28 }]}>{t('Web3')}</Text>
            <View style={styles.menuList}>
              <SidebarItem icon="compass" label={t('Explorar dApps')} active={activeRoute === 'dapp-hub'} onPress={() => { onClose(); router.push('/dapp-hub' as any); }} />
              <SidebarItem icon="link-2" label={t('Apps Conectados')} active={activeRoute === 'connected-apps'} onPress={() => { onClose(); router.push('/connected-apps' as any); }} />
            </View>

            <Text style={[styles.menuLabel, { marginTop: 28 }]}>{t('Sistema')}</Text>
            <View style={styles.menuList}>
              <SidebarItem icon="settings" label={t('Configurações')} active={activeRoute === 'configuracoes'} onPress={() => { onClose(); router.push('/configuracoes' as any); }} />
            </View>
          </ScrollView>

          {/* Rodapé */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Feather name="user" size={18} color={V.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user?.walletName || user?.fullName || user?.email?.split('@')[0] || t('Usuário')}
                </Text>
                <Text style={styles.userEmail} numberOfLines={1}>
                  {user?.email && !user.email.endsWith('.internal') ? user.email : ''}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SidebarItem({ icon, customIcon, label, onPress, active }: any) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <View style={[styles.menuItemIcon, active && styles.menuItemIconActive]}>
        {customIcon ? (
          <Image source={customIcon} style={{ width: 22, height: 22, tintColor: active ? V.bg : V.gold }} resizeMode="contain" />
        ) : (
          <Feather name={icon} size={17} color={active ? V.bg : V.gold} />
        )}
      </View>
      <Text style={[styles.menuItemLabel, active && { color: V.gold, fontFamily: F.semi }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)' },

  panel: {
    width: SCREEN_WIDTH * 0.78,
    maxWidth: 310,
    backgroundColor: V.surface1,
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: V.border,
    flexDirection: 'column',
  },

  panelHeader: {
    paddingTop: 36,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  panelSub: {
    fontSize: 12,
    fontFamily: F.body,
    color: V.muted,
    marginTop: 4,
    letterSpacing: 0.5,
  },

  nav: { flex: 1 },
  navContent: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },
  menuLabel: {
    fontSize: 10,
    fontFamily: F.semi,
    color: V.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  menuList: { marginBottom: 8 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: V.r8,
    marginBottom: 4,
  },
  menuItemIcon: {
    width: 32,
    height: 32,
    borderRadius: V.r8,
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuItemIconActive: {
    backgroundColor: V.gold,
    borderColor: V.gold,
  },
  menuItemLabel: {
    fontSize: 14,
    fontFamily: F.medium,
    color: V.text,
  },

  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: V.border,
    backgroundColor: V.surface1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: V.r20,
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  userName: {
    fontSize: 14,
    fontFamily: F.bold,
    color: V.text,
  },
  userEmail: {
    fontSize: 11,
    fontFamily: F.body,
    color: V.muted,
    marginTop: 2,
  },
});
