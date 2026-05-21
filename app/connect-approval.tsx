import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { ConnectionRequestView } from '@/components/ConnectionRequestView';
import PasswordModal from '@/components/PasswordModal';
import { useConnection } from '@/src/context/ConnectionContext';
import { useSettings } from '@/constants/SettingsContext';
import { keyManager } from '@/src/services/keyManager';
import type { ConnectionRequest } from '@/src/types/wallet.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Erro desconhecido. Tente novamente.';
}

const TIMEOUT_SECONDS = 30;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ConnectApprovalScreen() {
  const { request } = useLocalSearchParams<{ request: string }>();
  const { approveSession, rejectSession, sessions } = useConnection();
  const { network } = useSettings();
  const router = useRouter();

  // Parse request param safely
  const connectionRequest = useMemo<ConnectionRequest>(() => {
    try {
      return JSON.parse(request ?? '{}') as ConnectionRequest;
    } catch {
      return { session: '', name: 'Unknown', origin: 'unknown', permissions: ['publicKey'] };
    }
  }, [request]);

  const [publicKey, setPublicKey] = useState<string>('');
  const [isApproving, setApproving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [isUnlocking, setUnlocking] = useState<boolean>(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(TIMEOUT_SECONDS);

  // Load public key from session or stored address
  useEffect(() => {
    const keypair = keyManager.getSessionKeypair();
    if (keypair) {
      setPublicKey(keypair.publicKey.toBase58());
    } else {
      keyManager.getStoredAddress().then(addr => {
        if (addr) setPublicKey(addr);
      });
    }
  }, []);

  // Auto-reject countdown
  useEffect(() => {
    if (timeLeft <= 0) {
      handleReject();
      return;
    }
    const t = setInterval(() => setTimeLeft(n => n - 1), 1000);
    return () => clearInterval(t);
  }, [timeLeft]);

  // Is this dApp reconnecting?
  const isReturningDApp = useMemo(
    () => sessions.some(s => s.origin === connectionRequest.origin),
    [sessions, connectionRequest.origin]
  );

  const handleApprove = async (forcedPk?: string) => {
    const pk = forcedPk || publicKey;
    if (!pk) {
      setUnlockVisible(true);
      return;
    }
    setApproving(true);
    setError(null);
    try {
      await approveSession(connectionRequest, pk);
      if (connectionRequest.redirectLink) {
        const redirectUrl = connectionRequest.redirectLink.replace('{publicKey}', pk);
        Linking.openURL(redirectUrl).catch(() => {});
      }
      router.back();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setApproving(false);
    }
  };

  const handleUnlock = async (pin: string) => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const keypair = await keyManager.loadDecrypted(pin);
      const mnemonic = await keyManager.getMnemonic(pin);
      keyManager.startSession(mnemonic, keypair, pin);
      const pk = keypair.publicKey.toBase58();
      setPublicKey(pk);
      setUnlockVisible(false);
      handleApprove(pk);
    } catch (e) {
      setUnlockError(formatError(e));
    } finally {
      setUnlocking(false);
    }
  };

  const handleReject = async () => {
    await rejectSession(connectionRequest);
    if (connectionRequest.redirectLink) {
      const redirectUrl = connectionRequest.redirectLink
        .replace('{publicKey}', 'rejected')
        .replace('verum_approved=true', 'verum_approved=false&verum_error=rejected');
      Linking.openURL(redirectUrl).catch(() => {});
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={styles.container}>
      <ConnectionRequestView
        request={connectionRequest}
        walletAddress={publicKey}
        network={network ?? 'mainnet'}
        onApprove={() => handleApprove()}
        onReject={handleReject}
        isApproving={isApproving}
        error={error}
        timeLeft={timeLeft}
        isReturning={isReturningDApp}
      />
      <PasswordModal
        isVisible={isUnlockVisible}
        onClose={() => { setUnlockVisible(false); setUnlockError(null); }}
        onConfirm={handleUnlock}
        loading={isUnlocking}
        title="DESBLOQUEAR CARTEIRA"
        description="Digite seu PIN para autorizar a conexão."
        errorMessage={unlockError ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
