import { F, V } from '@/constants/theme';
import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

export default function PinPad({ value, onChange, maxLength = 6, disabled = false }: PinPadProps) {
  const press = (digit: string) => {
    if (!disabled && value.length < maxLength) onChange(value + digit);
  };
  const del = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  return (
    <View style={styles.container}>
      <View style={styles.dots}>
        {Array.from({ length: maxLength }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>

      <View style={styles.grid}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <TouchableOpacity
            key={d}
            style={[styles.key, disabled && styles.keyDisabled]}
            onPress={() => press(d)}
            activeOpacity={0.65}
            disabled={disabled}
          >
            <Text style={styles.keyText}>{d}</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.keyEmpty} />

        <TouchableOpacity
          style={[styles.key, disabled && styles.keyDisabled]}
          onPress={() => press('0')}
          activeOpacity={0.65}
          disabled={disabled}
        >
          <Text style={styles.keyText}>0</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.key, styles.keyDel, disabled && styles.keyDisabled]}
          onPress={del}
          activeOpacity={0.65}
          disabled={disabled}
        >
          <Feather name="delete" size={22} color={V.gold} />
        </TouchableOpacity>
      </View>
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
