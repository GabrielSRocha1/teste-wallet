import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { V, F } from '@/constants/theme';
import { useEffect, useMemo, useState } from 'react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { connectionService, ConnectedSession } from '@/src/services/connectionService';
import { keyManager } from '@/src/services/keyManager';
import * as Linking from 'expo-linking';
import { encryptionService, decodeBase58, encodeBase58 } from '@/src/services/encryptionService';
import { signTransaction, signAllTransactions, signMessage } from '@/src/services/signatureEngine';
import { Buffer } from 'buffer';
import { useConnection } from '@/src/context/ConnectionContext';
import PasswordModal from '@/components/PasswordModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '@/constants/SettingsContext';
import type {
  SignRequest,
  SignRequestAction,
  TransactionDetail,
} from '@/src/types/wallet.types';

// ─── Transaction detail parser ────────────────────────────────────────────────

function parseTransactionDetail(txBase64: string): TransactionDetail {
  try {
    const bytes = new Uint8Array(Buffer.from(txBase64, 'base64'));
    const isVersioned = bytes.length > 0 && (bytes[0] & 0x80) !== 0;

    if (isVersioned) {
      const tx = VersionedTransaction.deserialize(bytes);
      return {
        numInstructions: tx.message.compiledInstructions.length,
        numAccounts: tx.message.staticAccountKeys.length,
        estimatedFeeSol: (tx.message.header.numRequiredSignatures * 5000) / 1_000_000_000,
        isVersioned: true,
      };
    } else {
      const tx = Transaction.from(bytes);
      const msg = tx.compileMessage();
      return {
        numInstructions: tx.instructions.length,
        numAccounts: msg.accountKeys.length,
        estimatedFeeSol: (Math.max(tx.signatures.length, 1) * 5000) / 1_000_000_000,
        isVersioned: false,
      };
    }
  } catch (e: unknown) {
    return {
      numInstructions: 0,
      numAccounts: 0,
      estimatedFeeSol: 0.000005,
      isVersioned: false,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Transaction detail card ──────────────────────────────────────────────────

function TransactionDetailCard({ detail, index }: { detail: TransactionDetail; index?: number }) {
  const { t } = useSettings();
  if (detail.parseError) return null;

  return (
    <View style={s.detailCard}>
      {index !== undefined && (
        <Text style={s.detailCardTitle}>{t('Transação')} {index + 1}</Text>
      )}
      <View style={s.detailRow}>
        <Text style={s.detailLabel}>{t('Instruções')}</Text>
        <Text style={s.detailValue}>{detail.numInstructions}</Text>
      </View>
      <View style={s.detailRow}>
        <Text style={s.detailLabel}>{t('Contas envolvidas')}</Text>
        <Text style={s.detailValue}>{detail.numAccounts}</Text>
      </View>
      <View style={[s.detailRow, { borderBottomWidth: 0 }]}>
        <Text style={s.detailLabel}>{t('Taxa estimada')}</Text>
        <Text style={[s.detailValue, { color: V.gold }]}>
          {detail.estimatedFeeSol.toFixed(6)} SOL
        </Text>
      </View>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatError(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SignRequestScreen() {
  const { pendingSignRequest, setPendingSignRequest, sessions, reloadSessions } = useConnection();
  const insets = useSafeAreaInsets();
  const { t } = useSettings();

  const [session, setSession] = useState<ConnectedSession | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [decryptedAction, setDecryptedAction] = useState<SignRequestAction | null>(null);
  const [transactions, setTransactions] = useState<string[]>([]);
  const [messageBase64, setMessageBase64] = useState<string | null>(null);
  const [decryptedPayload, setDecryptedPayload] = useState<Record<string, unknown> | null>(null);
  const [txDetails, setTxDetails] = useState<TransactionDetail[]>([]);

  const [hasWallet, setHasWallet] = useState<boolean>(false);
  const [isUnlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [isUnlocking, setUnlocking] = useState<boolean>(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    keyManager.hasAccount().then(setHasWallet);
  }, []);

  useEffect(() => {
    async function processPayload() {
      if (!pendingSignRequest) {
        if (!loading) router.replace('/');
        return;
      }

      await reloadSessions();

      try {
        if (pendingSignRequest.dappEncryptionPublicKey) {
          // ── E2EE Protocol (Phantom-style) ──────────────────────────────────
          const dappPK = pendingSignRequest.dappEncryptionPublicKey;
          const matchedSession = sessions.find(s => s.dappEncryptionPublicKey === dappPK);

          if (!matchedSession?.sharedSecret) {
            throw new Error(t('Sessão não encontrada para a chave do dApp informada.'));
          }

          setSession(matchedSession);

          const sharedSecret = decodeBase58(matchedSession.sharedSecret);
          const decryptedJson = encryptionService.decryptPayload(
            pendingSignRequest.payload as string,
            pendingSignRequest.nonce as string,
            sharedSecret
          ) as Record<string, unknown>;

          setDecryptedPayload(decryptedJson);
          setDecryptedAction(pendingSignRequest.action);

          if (pendingSignRequest.action === 'signTransaction' && decryptedJson.transaction) {
            const txBytes = decodeBase58(decryptedJson.transaction as string);
            const txsArray = [Buffer.from(txBytes).toString('base64')];
            setTransactions(txsArray);
            setTxDetails(txsArray.map(parseTransactionDetail));
          } else if (pendingSignRequest.action === 'signAllTransactions' && decryptedJson.transactions) {
            const txsArray = (decryptedJson.transactions as string[]).map(t =>
              Buffer.from(decodeBase58(t)).toString('base64')
            );
            setTransactions(txsArray);
            setTxDetails(txsArray.map(parseTransactionDetail));
          } else if (pendingSignRequest.action === 'signMessage' && decryptedJson.message) {
            const msgBytes = decodeBase58(decryptedJson.message as string);
            setMessageBase64(Buffer.from(msgBytes).toString('base64'));
          } else {
            throw new Error(t('Payload não contém dados esperados.'));
          }

        } else {
          // ── Legacy Protocol ────────────────────────────────────────────────
          if (pendingSignRequest.session) {
            const matchedSession = sessions.find(s => s.id === pendingSignRequest.session);
            if (matchedSession) setSession(matchedSession);
          }

          setDecryptedAction(pendingSignRequest.action);

          if (pendingSignRequest.action === 'signAllTransactions') {
            const txsArray: string[] = JSON.parse(pendingSignRequest.data as string);
            setTransactions(txsArray);
            setTxDetails(txsArray.map(parseTransactionDetail));
          } else if (pendingSignRequest.action === 'signMessage') {
            setMessageBase64(pendingSignRequest.data as string);
          } else {
            const txsArray = [pendingSignRequest.data as string];
            setTransactions(txsArray);
            setTxDetails(txsArray.map(parseTransactionDetail));
          }
        }
      } catch (e) {
        setError(formatError(e, t('Erro desconhecido.')));
      }
    }

    processPayload();
  }, [pendingSignRequest, sessions]);

  // Decode message text for display
  const messageText = useMemo(() => {
    if (!messageBase64) return null;
    try {
      return Buffer.from(messageBase64, 'base64').toString('utf-8');
    } catch {
      return '[Mensagem binária — não pode ser exibida como texto]';
    }
  }, [messageBase64]);

  const handleApprove = async () => {
    if (!pendingSignRequest) return;
    setLoading(true);
    setError(null);

    try {
      const keypair = keyManager.getSessionKeypair();

      if (!keypair) {
        if (hasWallet) {
          setUnlockVisible(true);
        } else {
          throw new Error(t('Nenhuma carteira encontrada para assinar.'));
        }
        setLoading(false);
        return;
      }

      let responsePayload: Record<string, unknown> = {};

      if (decryptedAction === 'signTransaction') {
        const result = signTransaction(keypair, transactions[0]);
        responsePayload = { transaction: encodeBase58(Buffer.from(result.signedTransaction, 'base64')) };
      } else if (decryptedAction === 'signAllTransactions') {
        const results = signAllTransactions(keypair, transactions);
        responsePayload = {
          transactions: results.map(r => encodeBase58(Buffer.from(r.signedTransaction, 'base64'))),
        };
      } else if (decryptedAction === 'signMessage') {
        const result = signMessage(keypair, messageBase64!);
        responsePayload = { signature: encodeBase58(Buffer.from(result.signature, 'base64')) };
      }

      if (pendingSignRequest.dappEncryptionPublicKey && pendingSignRequest.redirectLink) {
        // ── E2EE return flow ─────────────────────────────────────────────────
        // (SE5) Valida que o redirect_link bate com a origin declarada pelo
        // dApp. Sem isso, dApp malicioso podia setar redirect_link para
        // domínio atacante e exfiltrar o payload E2EE (chave pública wallet +
        // nonce + ciphertext) — mesmo cifrado, isso permitia replay attacks
        // contra a sessão e revelava metadata da assinatura.
        try {
          connectionService.__validateCallbackUrlForTests(
            pendingSignRequest.redirectLink,
            pendingSignRequest.origin,
          );
        } catch (validationErr: any) {
          console.warn('[SignRequest] redirect_link recusado:', validationErr?.message);
          setPendingSignRequest(null);
          setError(`Link de retorno inválido: ${validationErr?.message ?? 'origem não autorizada'}`);
          setLoading(false);
          return;
        }

        responsePayload.session = decryptedPayload?.session;

        const sharedSecretStr = session?.sharedSecret;
        if (!sharedSecretStr) throw new Error(t('Sessão E2EE corrompida.'));

        const sharedSecret = decodeBase58(sharedSecretStr);
        const { nonce, ciphertext } = encryptionService.encryptPayload(responsePayload, sharedSecret);

        const walletPKStr = session?.walletEncryptionPublicKey;
        const walletPK = walletPKStr ? decodeBase58(walletPKStr) : new Uint8Array();

        const returnUrl = encryptionService.buildReturnUrl(
          pendingSignRequest.redirectLink,
          walletPK,
          nonce,
          ciphertext
        );

        setPendingSignRequest(null);
        Linking.openURL(returnUrl).catch(e => {
          console.warn('[SignRequest] Falha ao abrir deep link de retorno:', e);
        });

      } else if (pendingSignRequest.callbackUrl) {
        // ── Legacy callback ──────────────────────────────────────────────────
        // (C3) Passa `origin` declarado pelo dApp como expectedOrigin para
        // validação cross-origin do callback URL.
        await connectionService.notifyApproved(
          pendingSignRequest.callbackUrl,
          responsePayload as any,
          pendingSignRequest.origin,
        );
        setPendingSignRequest(null);
        router.replace('/');
      } else {
        setPendingSignRequest(null);
        router.replace('/');
      }

    } catch (e) {
      setError(formatError(e, t('Erro desconhecido.')));
      setLoading(false);
    }
  };

  const handleUnlock = async (pin: string) => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      // (C2) Single PBKDF2 via unlockVault — antes eram 2 chamadas (~1.4s),
      // agora é 1 (~0.7s). (C1) PinLockedError sobe daqui em lockout ativo.
      const { keypair, mnemonic } = await keyManager.unlockVault(pin);
      keyManager.startSession(mnemonic, keypair, pin);
      setUnlockVisible(false);
      setTimeout(() => handleApprove(), 200);
    } catch (e) {
      setUnlockError(formatError(e, t('Erro desconhecido.')));
    } finally {
      setUnlocking(false);
    }
  };

  const handleReject = () => {
    if (pendingSignRequest?.redirectLink) {
      try {
        const url = new URL(pendingSignRequest.redirectLink);
        url.searchParams.append('errorCode', '4001');
        url.searchParams.append('errorMessage', 'User rejected the request.');
        Linking.openURL(url.toString()).catch(() => {});
      } catch {}
    }

    setPendingSignRequest(null);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (!pendingSignRequest) return null;

  const isSignMessage = decryptedAction === 'signMessage';
  const dAppName = session?.name ?? pendingSignRequest.origin ?? 'dApp Desconhecido';

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ presentation: 'modal', headerShown: false }} />

      <View style={s.card}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.iconContainer}>
            <Ionicons name="create" size={32} color={V.gold} />
          </View>
          <Text style={s.title}>
            {isSignMessage ? 'Assinar Mensagem' : 'Aprovar Transação'}
          </Text>
          <Text style={s.origin}>De: {dAppName}</Text>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Error */}
          {!!error && (
            <View style={s.errorBox}>
              <Ionicons name="warning" size={20} color={V.danger} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          {/* Description */}
          <Text style={s.description}>
            {isSignMessage
              ? t('Este aplicativo está solicitando sua assinatura criptográfica.')
              : (transactions.length > 1
                  ? t('Este aplicativo deseja enviar {count} transações usando sua carteira.', { count: String(transactions.length) })
                  : t('Este aplicativo deseja realizar uma transação usando sua carteira.'))}
          </Text>

          {/* Message text */}
          {isSignMessage && messageText && (
            <View style={s.messageBox}>
              <Text style={s.messageLabel}>{t('CONTEÚDO DA MENSAGEM')}</Text>
              <ScrollView style={s.messageScroll} nestedScrollEnabled>
                <Text style={s.messageText}>{messageText}</Text>
              </ScrollView>
            </View>
          )}

          {/* Transaction details */}
          {!isSignMessage && txDetails.length > 0 && txDetails.map((detail, i) => (
            <TransactionDetailCard
              key={i}
              detail={detail}
              index={txDetails.length > 1 ? i : undefined}
            />
          ))}
        </ScrollView>

        {/* Actions */}
        <View style={s.actions}>
          <Pressable
            style={[s.button, s.rejectButton]}
            onPress={handleReject}
            disabled={loading}
          >
            <Text style={s.rejectButtonText}>{t('Rejeitar')}</Text>
          </Pressable>

          <Pressable
            style={[s.button, s.approveButton, (loading || !!error) && s.buttonDisabled]}
            onPress={handleApprove}
            disabled={loading || !!error}
          >
            {loading ? (
              <ActivityIndicator color={V.bg} />
            ) : (
              <Text style={s.approveButtonText}>{t('Aprovar')}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <PasswordModal
        isVisible={isUnlockVisible}
        onClose={() => { setUnlockVisible(false); setUnlockError(null); }}
        onConfirm={handleUnlock}
        loading={isUnlocking}
        title={t('AUTORIZAR ASSINATURA')}
        description={t('Digite seu PIN/Senha para desbloquear a carteira e assinar.')}
        errorMessage={unlockError ?? undefined}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: V.bg,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: V.border,
    maxHeight: '85%',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  header: {
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: V.px,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: V.gold + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontFamily: F.title,
    fontSize: 22,
    color: V.text,
    marginBottom: 4,
  },
  origin: {
    fontFamily: F.medium ?? F.body,
    fontSize: 14,
    color: V.muted,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: V.px,
    gap: 12,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V.danger + '1A',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  errorText: {
    fontFamily: F.body,
    color: V.danger,
    fontSize: 14,
    flex: 1,
  },
  description: {
    fontFamily: F.body,
    fontSize: 15,
    color: V.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  messageBox: {
    backgroundColor: V.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V.border,
    padding: 14,
  },
  messageLabel: {
    fontFamily: F.bold,
    fontSize: 10,
    color: V.muted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  messageScroll: {
    maxHeight: 120,
  },
  messageText: {
    fontFamily: F.body,
    fontSize: 13,
    color: V.text,
    lineHeight: 20,
  },
  detailCard: {
    backgroundColor: V.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: V.border,
    overflow: 'hidden',
  },
  detailCardTitle: {
    fontFamily: F.bold,
    fontSize: 11,
    color: V.muted,
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  detailLabel: {
    fontFamily: F.body,
    fontSize: 13,
    color: V.muted,
  },
  detailValue: {
    fontFamily: F.semi,
    fontSize: 13,
    color: V.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: V.px,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: V.border,
  },
  button: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  rejectButton: {
    backgroundColor: V.surface2,
    borderWidth: 1,
    borderColor: V.danger + '50',
  },
  rejectButtonText: {
    fontFamily: F.semi ?? F.bold,
    fontSize: 16,
    color: V.danger,
  },
  approveButton: {
    backgroundColor: V.gold,
  },
  approveButtonText: {
    fontFamily: F.semi ?? F.bold,
    fontSize: 16,
    color: V.bg,
  },
});
