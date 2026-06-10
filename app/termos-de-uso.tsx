import React from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Header from '@/components/Header';
import { V, F } from '@/constants/theme';

export default function TermosDeUsoScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      <Header
        title="Terms of Service"
        onBackPress={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleBox}>
          <Text style={styles.title}>TERMS OF SERVICE</Text>
          <Text style={styles.subtitle}>VERUM CRYPTO FREEPORT</Text>
          <View style={styles.goldLine} />
          <Text style={styles.updateDate}>Last Updated: March 29, 2026</Text>
        </View>

        <View style={styles.contentCard}>
          <Section
            number="1"
            title="ACCEPTANCE OF TERMS"
            content="By downloading, installing, accessing or using the Verum Wallet application (the “App”), you (“User”) acknowledge that you have read, understood and agree to be legally bound by these Terms of Service (“Terms”) and by the [[Privacy Policy]] referenced herein.\n\nIf you do not agree with any provision of these Terms, you must not use the App and must immediately uninstall it."
          />

          <Section
            number="2"
            title="NATURE OF SERVICE — SELF-CUSTODY"
            content="Verum Wallet is a non-custodial, self-custody software interface that allows the User to generate, store and operate cryptographic keys on supported blockchain networks (Solana, Verum Chain, EVM-compatible networks).\n\nVerum Crypto Freeport DOES NOT hold, custody, manage or have any access to:\n\n• User private keys, seed phrases (mnemonics) or local PINs;\n• User funds, balances or digital assets;\n• User's recovery information.\n\nThe User is the SOLE responsible party for the secure storage, backup and confidentiality of his or her credentials."
          />

          <Section
            number="3"
            title="ELIGIBILITY"
            content="By using the App, the User declares and warrants that:\n\n• Is at least 18 years old (or the legal age of majority in his/her jurisdiction);\n• Has full legal capacity to enter into binding agreements;\n• Is not a resident of, located in, or a national of any jurisdiction subject to economic sanctions imposed by OFAC, the United Nations, the European Union or the Republic of Panama;\n• Will not use the App for any unlawful purpose, including money laundering, terrorism financing, tax evasion or any activity prohibited by applicable law."
          />

          <Section
            number="4"
            title="USER RESPONSIBILITIES"
            content="The User is solely responsible for:\n\n• Safeguarding the seed phrase, private keys and local PIN. Loss of these credentials results in PERMANENT and IRREVERSIBLE loss of funds;\n• Verifying the correctness of every recipient address, amount and network before confirming any transaction. Blockchain transactions are FINAL and CANNOT be reversed;\n• Keeping the device free from malware, ensuring the App was downloaded from an official source (Google Play, Aptoide, or verumcrypto.com);\n• Complying with all tax obligations arising from the use of the App."
          />

          <Section
            number="5"
            title="VERUM PAY GATEWAY"
            content="Verum Pay is an optional fiat-to-crypto conversion gateway provided by Verum Crypto Freeport in partnership with regulated payment processors.\n\n• Pix orders are processed by licensed PSPs under Brazilian regulation;\n• Once funds are transferred to the blockchain network, the transaction is FINAL. No chargeback, refund or reversal is technically possible;\n• Sending fiat funds to incorrect crypto addresses, wrong networks, or after the order has been confirmed on-chain does NOT generate any right to a refund;\n• KYC (Know Your Customer) is mandatory for all Verum Pay operations to comply with FATF/GAFI anti-money-laundering standards."
          />

          <Section
            number="6"
            title="PROHIBITED USES"
            content="The User agrees NOT to use the App to:\n\n• Conduct money laundering, terrorism financing or fund any illegal activity;\n• Evade sanctions, tax obligations or financial regulations;\n• Conduct fraud, market manipulation, wash trading or pump-and-dump schemes;\n• Interact with smart contracts known to be malicious, scam tokens, or unauthorized copies of legitimate protocols;\n• Reverse-engineer, decompile, modify or distribute derivative versions of the App without prior written authorization;\n• Use automated scripts, bots or any means to abuse rate limits or extract data from the backend."
          />

          <Section
            number="7"
            title="RISK DISCLOSURE"
            content="The User acknowledges that the use of cryptocurrencies and decentralized protocols involves SIGNIFICANT FINANCIAL RISK, including but not limited to:\n\n• Extreme price volatility — digital assets may lose 100% of value in short periods;\n• Smart contract vulnerabilities — bugs may result in loss of funds;\n• Network congestion and failed transactions;\n• Phishing, social engineering and clipboard-hijacking attacks;\n• Regulatory uncertainty — laws affecting cryptocurrencies may change without notice;\n• Permanent loss of funds in case of loss of private keys or seed phrase.\n\nThe User invests at his or her own risk and expressly waives any claim against Verum Crypto Freeport for losses arising from the inherent risks of the technology."
          />

          <Section
            number="8"
            title="INTELLECTUAL PROPERTY"
            content="The App, its source code, logos, designs, trademarks and content are the exclusive property of Verum Crypto Freeport or duly licensed.\n\nThe User receives a limited, non-exclusive, non-transferable and revocable license to use the App for personal, non-commercial purposes. Any other use requires prior written authorization."
          />

          <Section
            number="9"
            title="LIMITATION OF LIABILITY"
            content="To the maximum extent permitted by applicable law, Verum Crypto Freeport, its directors, employees, contractors and developers shall NOT be liable for:\n\n• Loss of funds resulting from loss of seed phrase, private keys or PIN;\n• Loss arising from price volatility of digital assets;\n• Failures, outages or instabilities of third-party blockchain networks;\n• Acts of third parties (hackers, scammers, malicious smart contracts);\n• Indirect, consequential, incidental, special or punitive damages;\n• Lost profits or business interruption.\n\nThe maximum aggregate liability of Verum Crypto Freeport, in any case, shall be limited to USD 100 (one hundred United States dollars)."
          />

          <Section
            number="10"
            title="MODIFICATION AND TERMINATION"
            content="Verum Crypto Freeport reserves the right to modify these Terms at any time. Material changes will be notified through the App or through https://verumcrypto.com.\n\nContinued use of the App after notification constitutes acceptance of the new terms.\n\nThe User may terminate this agreement at any time by uninstalling the App. Termination does NOT generate any obligation to refund or compensate."
          />

          <Section
            number="11"
            title="GOVERNING LAW AND JURISDICTION"
            content="These Terms shall be governed and interpreted in accordance with the laws of the Republic of Panama.\n\nAny dispute arising from these Terms or the use of the App shall be submitted to the EXCLUSIVE JURISDICTION of the courts of Panama City, with the User waiving any other forum, however privileged it may be."
          />

          <Section
            number="12"
            title="CONTACT"
            content="For questions regarding these Terms, contact:\n\nVerum Crypto Freeport\nE-mail: legal@verumcrypto.com\nWebsite: https://verumcrypto.com"
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
