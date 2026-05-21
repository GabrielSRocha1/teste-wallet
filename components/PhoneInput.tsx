import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, SafeAreaView, FlatList, TextInputProps, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { countries, Country } from '@/constants/countries';
import { V, F } from '@/constants/theme';

interface PhoneInputProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  selectedCountry?: Country;
  onCountryChange?: (country: Country) => void;
  dark?: boolean;
}

export default function PhoneInput({ 
  value, 
  onChangeText, 
  selectedCountry: propCountry, 
  onCountryChange, 
  dark = true,
  style,
  ...props 
}: PhoneInputProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<Country>(propCountry || countries[0]);

  const handleSelectCountry = (country: Country) => {
    setSelectedCountry(country);
    if (onCountryChange) onCountryChange(country);
    setModalVisible(false);
  };

  const bg = V.surface1; 
  const border = V.border;
  const text = V.text;
  const placeholderText = V.muted;

  const incomingStyle = StyleSheet.flatten(style) || {};
  const { backgroundColor, borderRadius, borderWidth, borderColor, ...restTextStyle } = incomingStyle as any;

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.countryPicker, { backgroundColor: bg, borderColor: border }]} 
        onPress={() => setModalVisible(true)}
      >
        <Text style={styles.flag}>{selectedCountry.flag}</Text>
        <Text style={[styles.dialCode, { color: text }]}>{selectedCountry.dial_code}</Text>
        <Feather name="chevron-down" size={14} color={V.gold} />
      </TouchableOpacity>

      <View style={[styles.inputContainer, { backgroundColor: bg, borderColor: border }]}>
        <TextInput
          style={[styles.input, { color: text }, restTextStyle]}
          placeholderTextColor={placeholderText}
          keyboardType="phone-pad"
          value={value}
          onChangeText={onChangeText}
          {...props}
        />
      </View>

      <Modal visible={modalVisible} animationType="fade" transparent={true}>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECIONE O PAÍS</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Feather name="x" size={24} color={V.gold} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={countries}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.countryItem} 
                  onPress={() => handleSelectCountry(item)}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryDialCode}>{item.dial_code}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={true}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 10,
  },
  countryPicker: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: V.r8,
    borderWidth: 1,
    gap: 8,
  },
  flag: {
    fontSize: 18,
    color: V.text,
    fontFamily: F.bold,
  },
  dialCode: {
    fontSize: 14,
    fontFamily: F.bold,
  },
  inputContainer: {
    flex: 1,
    height: 52,
    borderRadius: V.r8,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: F.body,
    height: '100%',
    backgroundColor: 'transparent',
    outlineStyle: 'none' as any,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    width: '100%',
    minWidth: 320,
    maxWidth: 650,
    maxHeight: '80%',
    padding: 24,
    borderWidth: 1,
    borderColor: V.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: F.title,
    color: V.gold,
    letterSpacing: 1,
  },
  closeBtn: {
    padding: 4,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingRight: 16, // Espaço para não esconder atrás da scrollbar
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  countryName: {
    flex: 1,
    marginLeft: 15,
    fontSize: 15,
    fontFamily: F.semi,
    color: V.text,
  },
  countryDialCode: {
    fontSize: 14,
    color: V.gold,
    fontFamily: F.bold,
  },
});
