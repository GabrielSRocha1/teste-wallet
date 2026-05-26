import { F, V } from '@/constants/theme';
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  disabled?: boolean;
  loading?: boolean;
}

export default function PinPad({ value, onChange, maxLength = 6, disabled = false, loading = false }: PinPadProps) {
  const isBlocked = disabled || loading;
  const press = (digit: string) => {
    if (!isBlocked && value.length < maxLength) onChange(value + digit);
  };
  const del = () => {
    if (!isBlocked) onChange(value.slice(0, -1));
  };

  return (
    <View style={styles.container}>
      <View style={styles.dots}>
        {Array.from({ length: maxLength }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={V.gold} />
        </View>
      ) : (
        <View style={styles.grid}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <TouchableOpacity
              key={d}
              style={[styles.key, isBlocked && styles.keyDisabled]}
              onPress={() => press(d)}
              activeOpacity={0.65}
              disabled={isBlocked}
            >
              <Text style={styles.keyText}>{d}</Text>
            </TouchableOpacity>
          ))}

          <View style={styles.keyEmpty} />

          <TouchableOpacity
            style={[styles.key, isBlocked && styles.keyDisabled]}
            onPress={() => press('0')}
            activeOpacity={0.65}
            disabled={isBlocked}
          >
            <Text style={styles.keyText}>0</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.key, styles.keyDel, isBlocked && styles.keyDisabled]}
            onPress={del}
            activeOpacity={0.65}
            disabled={isBlocked}
          >
            <Feather name="delete" size={22} color={V.gold} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 32,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: V.gold,
    opacity: 0.35,
  },
  dotFilled: {
    backgroundColor: V.gold,
    opacity: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 288,
    justifyContent: 'center',
  },
  loadingBox: {
    width: 288,
    height: 304,
    alignItems: 'center',
    justifyContent: 'center',
  },
  key: {
    width: 80,
    height: 80,
    margin: 8,
    borderRadius: 40,
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDel: {
    backgroundColor: 'rgba(201,168,76,0.12)',
    borderColor: 'rgba(201,168,76,0.3)',
  },
  keyEmpty: {
    width: 80,
    height: 80,
    margin: 8,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  keyText: {
    fontSize: 22,
    fontFamily: F.bold,
    color: V.text,
  },
});
