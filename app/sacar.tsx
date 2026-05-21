import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import PhoneInput from '@/components/PhoneInput';
import Sidebar from '@/components/Sidebar';
import { countries, Country } from '@/constants/countries';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F, PAD } from '@/constants/theme';

export default function SacarScreen() {
  const insets = useSafeAreaInsets();
  const [isSidebarVisible, setSidebarVisible] = useState(false);
  const [bank, setBank] = useState('Selecione seu banco');
  const [isBankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [pixType, setPixType] = useState('CPF');
  const [isPixTypeDropdownOpen, setPixTypeDropdownOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<Country>(countries[0]);

  const banks = ['Nubank', 'Itaú', 'Bradesco', 'Banco do Brasil', 'Santander', 'Inter', 'C6 Bank'];
  const pixTypes = ['CPF', 'E-mail', 'Telefone', 'Chave Aleatória'];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: V.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={V.bg} />
        <Header onBackPress={() => router.back()} onMenuPress={() => setSidebarVisible(true)} />

        <TouchableWithoutFeedback onPress={() => { setBankDropdownOpen(false); setPixTypeDropdownOpen(false); }}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.titleBox}>
              <Text style={styles.title}>SAQUE PIX</Text>
              <View style={styles.goldLine} />
              <Text style={styles.subtitle}>Converta seus lucros em USDT para BRL diretamente na sua conta bancária.</Text>
            </View>

            <View style={styles.balanceCard}>
               <View style={styles.balIcon}><Text style={styles.balIconT}>$</Text></View>
               <View>
                  <Text style={styles.balL}>SALDO DISPONÍVEL</Text>
                  <Text style={styles.balV}>0.00 USDT</Text>
               </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardHeader}>DADOS DO BENEFICIÁRIO</Text>
              
              <View style={styles.formGroup}>
                <Text style={styles.label}>NOME DO TITULAR</Text>
                <View style={styles.inputBox}>
                  <Feather name="user" size={18} color={V.gold} style={{marginRight: 12}} />
                  <TextInput style={styles.input} placeholder="Nome completo" placeholderTextColor={V.muted} />
                </View>
              </View>

              <View style={[styles.formGroup, { zIndex: 2 }]}>
                <Text style={styles.label}>INSTITUIÇÃO BANCÁRIA</Text>
                <TouchableOpacity style={styles.dropdown} onPress={() => { setPixTypeDropdownOpen(false); setBankDropdownOpen(!isBankDropdownOpen); }}>
                  <Text style={[styles.dropText, bank.includes('Selecione') && { color: V.muted }]}>{bank}</Text>
                  <Feather name="chevron-down" size={20} color={V.gold} />
                </TouchableOpacity>
                {isBankDropdownOpen && (
                  <View style={styles.dropMenu}>
                    {banks.map(b => (
                      <TouchableOpacity key={b} style={styles.dropItem} onPress={() => { setBank(b); setBankDropdownOpen(false); }}>
                        <Text style={styles.dropItemT}>{b}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.formGroup, { zIndex: 1 }]}>
                <Text style={styles.label}>TIPO DE CHAVE PIX</Text>
                <TouchableOpacity style={styles.dropdown} onPress={() => { setBankDropdownOpen(false); setPixTypeDropdownOpen(!isPixTypeDropdownOpen); }}>
                  <Text style={styles.dropText}>{pixType}</Text>
                  <Feather name="chevron-down" size={20} color={V.gold} />
                </TouchableOpacity>
                {isPixTypeDropdownOpen && (
                  <View style={styles.dropMenu}>
                    {pixTypes.map(p => (
                      <TouchableOpacity key={p} style={styles.dropItem} onPress={() => { setPixType(p); setPixTypeDropdownOpen(false); }}>
                        <Text style={styles.dropItemT}>{p}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>CHAVE PIX</Text>
                {pixType === 'Telefone' ? (
                  <PhoneInput value={phone} onChangeText={setPhone} placeholder="00 00000-0000" selectedCountry={phoneCountry} onCountryChange={setPhoneCountry} style={styles.phoneInput} />
                ) : (
                  <View style={styles.inputBox}>
                    <Feather name="key" size={18} color={V.gold} style={{marginRight: 12}} />
                    <TextInput style={styles.input} placeholder={`Sua chave ${pixType}`} placeholderTextColor={V.muted} />
                  </View>
                )}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>VALOR (USDT)</Text>
                <View style={styles.inputBox}>
                  <Feather name="dollar-sign" size={18} color={V.gold} style={{marginRight: 12}} />
                  <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={V.muted} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
                </View>
              </View>

              <View style={styles.alert}>
                 <Feather name="clock" size={18} color={V.gold} />
                 <Text style={styles.alertT}>Processamento em até 24h úteis. Uma taxa administrativa de $0.50 ou 2% será aplicada, além da taxa de conversão conforme cotação do momento.</Text>
              </View>

              <TouchableOpacity style={styles.mainBtn}>
                <MaterialCommunityIcons name="bank-transfer-out" size={22} color={V.bg} />
                <Text style={styles.mainBtnT}>SOLICITAR SAQUE</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>

        <BottomNav activeRoute="none" />
        <Sidebar isVisible={isSidebarVisible} onClose={() => setSidebarVisible(false)} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  scrollContent: { paddingHorizontal: V.px, paddingBottom: 110 },
  titleBox: { marginTop: 24, marginBottom: 24 },
  title: { fontSize: 26, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 4, marginBottom: 12 },
  subtitle: { fontSize: 13, fontFamily: F.body, color: V.muted, lineHeight: 20 },
  balanceCard: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: V.border, ...V.shadow },
  balIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: V.gold, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  balIconT: { color: V.bg, fontSize: 22, fontFamily: F.bold },
  balL: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 2 },
  balV: { fontSize: 20, fontFamily: F.title, color: V.text },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 20, borderWidth: 1, borderColor: V.border, ...V.shadow, marginBottom: 40 },
  cardHeader: { fontSize: 12, fontFamily: F.title, color: V.gold, marginBottom: 24, letterSpacing: 1 },
  formGroup: { marginBottom: 20 },
  label: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  inputBox: { height: 56, backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  input: { flex: 1, color: V.text, fontFamily: F.semi, fontSize: 15, height: '100%', backgroundColor: 'transparent', outlineStyle: 'none' as any },
  dropdown: { height: 56, backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  dropText: { color: V.text, fontFamily: F.semi, fontSize: 15 },
  dropMenu: { position: 'absolute', top: 80, left: 0, right: 0, backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.gold, zIndex: 100, padding: 8, ...V.shadow },
  dropItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: V.border },
  dropItemT: { color: V.text, fontFamily: F.semi },
  phoneInput: { backgroundColor: V.surface2, borderRadius: V.r8, borderWidth: 1, borderColor: V.border },
  alert: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: V.r8, backgroundColor: 'rgba(201,168,76,0.03)', borderWidth: 1, borderColor: V.border, marginBottom: 24 },
  alertT: { flex: 1, fontSize: 12, fontFamily: F.body, color: V.muted, lineHeight: 18 },
  mainBtn: { backgroundColor: V.gold, height: 56, borderRadius: V.r8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...V.shadow },
  mainBtnT: { color: V.bg, fontSize: 14, fontFamily: F.bold, letterSpacing: 1 },
});
