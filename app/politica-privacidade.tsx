import React from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Header from '@/components/Header';
import { V, F } from '@/constants/theme';

export default function PoliticaPrivacidadeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />
      
      <Header 
        title="Privacy Policy" 
        onBackPress={() => router.back()} 
      />

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBox}>
          <Text style={styles.title}>GLOBAL PRIVACY NOTICE</Text>
          <Text style={styles.subtitle}>VERUM CRYPTO FREEPORT</Text>
          <View style={styles.goldLine} />
          <Text style={styles.updateDate}>Last Updated: March 29, 2026</Text>
        </View>

        <View style={styles.contentCard}>
          <Section 
            number="1" 
            title="LEGAL STRUCTURE AND JURISDICTION"
            content="Verum Crypto Freeport, incorporated under the laws of the Republic of Panama, acts as the data controller and provider of technological infrastructure for the Verum Wallet and the Verum Pay gateway. By using our services, you agree that any litigation will be processed under the exclusive jurisdiction of the courts of Panama City, waiving any other forum, however privileged it may be."
          />

          <Section 
            number="2" 
            title="THE SELF-CUSTODY PILLAR (NON-CUSTODIAL SHIELD)"
            content="The Verum Wallet is a self-custody software interface.\n\nVerum Crypto Freeport DOES NOT collect, DOES NOT store, and DOES NOT have access to your Private Keys, Seed Phrases (Mnemonics), or local passwords.\n\nDisclaimer: The security of digital assets is the sole responsibility of the user. The loss of private keys results in the irreversible loss of funds, with no technical or legal possibility of recovery by Verum Crypto Freeport."
          />

          <Section 
            number="3" 
            title="VERUM PAY: IRREVERSIBILITY AND FIAT CONVERSION"
            content="The Verum Pay service operates strictly as a technological conversion gateway between fiat currencies (such as Pix) and digital assets.\n\nTransaction Purpose: Once assets are sent to the Blockchain network, the transaction is considered final and irreversible.\n\nProhibition of Chargebacks: Due to the immutable nature of Blockchain technology, there are no refund or chargeback mechanisms. The user acknowledges that sending values to incorrect addresses or withdrawing after confirmation on the network does not generate a right to a refund."
          />

          <Section 
            number="4" 
            title="AML COMPLIANCE AND DATA COLLECTION (KYC)"
            content="To ensure the company's protection against financial crimes and to comply with GAFI/FATF standards, we collect:\n\n• Identification (KYC): Data provided voluntarily for identity verification.\n• Technical Data: IP address, transaction metadata, and device identifiers for fraud prevention and cybersecurity purposes.\n• Legal Sharing: We reserve the right to share data with competent authorities only upon a valid court order issued by a Panamanian authority or mutual cooperation international treaties recognized by the Republic of Panama."
          />

          <Section 
            number="5" 
            title="DATA PROTECTION (LAW 81/2019 AND GDPR)"
            content="We adopt the highest security standards to protect the integrity of the Verum System:\n\n• User Rights: You have the right to access, rectify, and delete your personal data (KYC), provided such data is not required to be maintained by legal retention obligations (anti-money laundering standards).\n• Security: We use end-to-end encryption and layered security protocols to protect our infrastructure against unauthorized access."
          />

          <Section 
            number="6" 
            title="LIMITATION OF LIABILITY"
            content="Under no circumstances shall Verum Crypto Freeport, its directors, or developers be liable for indirect damages, lost profits, or failures resulting from instabilities inherent to third-party Blockchain networks (such as Bitcoin, Ethereum, Solana, or Verum Chain)."
          />
        </View>

        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>I UNDERSTAND AND ACCEPT</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Section({ number, title, content }: { number: string, title: string, content: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.numberBadge}>
          <Text style={styles.numberText}>{number}</Text>
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Text style={styles.sectionContent}>{content.replace(/\\n/g, '\n')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: V.bg,
  },
  scrollContent: {
    paddingHorizontal: V.px,
    paddingBottom: 40,
  },
  titleBox: {
    marginTop: 24,
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontFamily: F.title,
    color: V.gold,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: F.bold,
    color: V.text,
    marginTop: 4,
    letterSpacing: 2,
    opacity: 0.8,
  },
  goldLine: {
    width: 60,
    height: 3,
    backgroundColor: V.gold,
    marginVertical: 16,
    borderRadius: 2,
  },
  updateDate: {
    fontSize: 12,
    fontFamily: F.body,
    color: V.muted,
  },
  contentCard: {
    backgroundColor: V.surface1,
    borderRadius: V.r12,
    padding: 20,
    borderWidth: 1,
    borderColor: V.border,
    ...V.shadow,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  numberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: V.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: 14,
    fontFamily: F.bold,
    color: V.bg,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: F.bold,
    color: V.gold,
    letterSpacing: 0.5,
  },
  sectionContent: {
    fontSize: 14,
    fontFamily: F.body,
    color: V.text,
    lineHeight: 22,
    textAlign: 'justify',
  },
  backButton: {
    backgroundColor: V.gold,
    paddingVertical: 16,
    borderRadius: V.r12,
    alignItems: 'center',
    marginTop: 32,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: F.bold,
    color: V.bg,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
