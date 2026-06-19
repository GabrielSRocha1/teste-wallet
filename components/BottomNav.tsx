import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';

interface BottomNavProps {
  activeRoute: 'index' | 'wallet' | 'cambio' | 'investir' | 'vesting' | 'explore' | 'none';
}

export default function BottomNav({ activeRoute }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();

  const getColor = (route: string) => activeRoute === route ? V.gold : V.muted;

  return (
    <View style={[styles.bottomNav, { paddingBottom: insets.bottom > 0 ? insets.bottom : 14 }]}>
      {/* Home */}
      <TouchableOpacity style={styles.navItem} onPress={() => router.push('/' as any)}>
        <Feather name="home" size={22} color={getColor('index')} />
        <Text style={[styles.navText, { color: getColor('index') }]}>{t('Home')}</Text>
        {activeRoute === 'index' && <View style={styles.activeDot} />}
      </TouchableOpacity>

      {/* Carteira */}
      <TouchableOpacity style={styles.navItem} onPress={() => router.push('/wallet' as any)}>
        <Feather name="briefcase" size={22} color={getColor('wallet')} />
        <Text style={[styles.navText, { color: getColor('wallet') }]}>{t('Carteira')}</Text>
        {activeRoute === 'wallet' && <View style={styles.activeDot} />}
      </TouchableOpacity>

      {/* FAB central - Vesting Portal */}
      <View style={styles.navCenterItem}>
        <Pressable
          style={({ pressed }) => [
            styles.centerFab, 
            { 
              opacity: pressed ? 0.85 : 1,
              borderColor: activeRoute === 'vesting' ? V.gold : V.border,
              borderWidth: activeRoute === 'vesting' ? 2 : 1
            }
          ]}
          onPress={() => router.push({ pathname: '/dapp-browser', params: { url: encodeURIComponent('https://vesting.verumcrypto.com'), name: 'Vesting Verum' } } as any)}
        >
          <Image
            source={require('../public/icon.png.png')}
            style={{ width: '80%', height: '80%', borderRadius: 10 }}
            resizeMode="contain"
          />
        </Pressable>
        {/* Label opcional para o FAB central */}
        <Text style={[styles.navText, {
          color: getColor('vesting'),
          marginTop: 4,
          position: 'absolute',
          bottom: -20,
          fontFamily: F.bold
        }]}>
          VESTING
        </Text>
      </View>

      {/* Câmbio */}
      <TouchableOpacity style={styles.navItem} onPress={() => router.push('/cambio' as any)}>
        <Feather name="refresh-ccw" size={22} color={getColor('cambio')} />
        <Text style={[styles.navText, { color: getColor('cambio') }]}>{t('Câmbio')}</Text>
        {activeRoute === 'cambio' && <View style={styles.activeDot} />}
      </TouchableOpacity>

      {/* Investir */}
      <TouchableOpacity style={styles.navItem} onPress={() => router.push('/investir' as any)}>
        <Feather name="trending-up" size={22} color={getColor('investir')} />
        <Text style={[styles.navText, { color: getColor('investir') }]}>{t('Investir')}</Text>
        {activeRoute === 'investir' && <View style={styles.activeDot} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: V.surface1,
    borderTopWidth: 1,
    borderTopColor: V.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: V.px,
    paddingTop: 10,
    zIndex: 100,
  },
  navItem: {
    alignItems: 'center',
    gap: 3,
    position: 'relative',
  },
  navText: {
    fontSize: 10,
    fontFamily: F.medium,
    letterSpacing: 0.5,
  },
  activeDot: {
    position: 'absolute',
    bottom: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: V.gold,
  },
  navCenterItem: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -24 }],
  },
  centerFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
  },
});
