import { Feather, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { V, F } from '@/constants/theme';

interface HeaderProps {
  title?: string;
  onMenuPress?: () => void;
  onBackPress?: () => void;
  showScanner?: boolean;
  onScannerPress?: () => void;
  showNotificationDot?: boolean;
}

export default function Header({
  title = 'Verum',
  onMenuPress,
  onBackPress,
  showScanner = false,
  onScannerPress,
  showNotificationDot = false,
}: HeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconButton} onPress={onBackPress || onMenuPress}>
        <Feather name={onBackPress ? 'chevron-left' : 'menu'} size={onBackPress ? 22 : 18} color={V.gold} />
      </TouchableOpacity>

      {title === 'Verum' ? (
        <Image
          source={require('../public/logo-dourada.png')}
          style={{ width: 130, height: 40 }}
          resizeMode="contain"
        />
      ) : (
        <Text style={styles.headerTitle}>{title}</Text>
      )}

      <View style={styles.rightActions}>
        {showScanner && (
          <TouchableOpacity style={styles.iconButton} onPress={onScannerPress}>
            <Ionicons name="qr-code-outline" size={18} color={V.gold} />
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/notificacoes' as any)}>
          <Feather name="bell" size={18} color={V.gold} />
          {showNotificationDot && <View style={styles.notificationDot} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: V.px,
    paddingVertical: 13,
    backgroundColor: V.surface1,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
    zIndex: 100,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.border,
    backgroundColor: V.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: F.title,
    color: V.gold,
    letterSpacing: 1.5,
  },
  rightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  notificationDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    backgroundColor: V.success,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: V.surface1,
  },
});
