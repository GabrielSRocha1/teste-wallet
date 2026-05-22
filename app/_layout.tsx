import '../polyfills';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { View, StyleSheet, ActivityIndicator, LogBox } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';

// Ignore APENAS warnings ruidosos conhecidos do stack Solana — não toda a UI.
// Antes, LogBox.ignoreAllLogs(true) escondia memory leaks, stale closures,
// react-hooks/exhaustive-deps em runtime e outros warnings reais. Mantemos
// só o whitelist específico para que warnings novos voltem a aparecer em dev.
LogBox.ignoreLogs([
  'Server responded with 429',
  'Retrying after',
  'WebSocket',
  // wallet-standard tenta usar APIs DOM em RN; já trata com try/catch internamente
  'wallet-standard:register-wallet event listener could not be added',
  'wallet-standard:app-ready event could not be dispatched',
]);

import { supabase } from '@/src/services/supabase';
import { walletSetupFlag } from '@/src/services/walletSetupFlag';
import {
  useFonts,
  Cinzel_400Regular,
  Cinzel_700Bold,
} from '@expo-google-fonts/cinzel';
import {
  Rajdhani_400Regular,
  Rajdhani_500Medium,
  Rajdhani_600SemiBold,
  Rajdhani_700Bold,
} from '@expo-google-fonts/rajdhani';
import { V } from '@/constants/theme';
import { SettingsProvider } from '@/constants/SettingsContext';
import { ConnectionProvider, useConnection } from '@/src/context/ConnectionContext';
import { ConnectionProvider as SolanaConnectionProvider } from '@/src/context/SolanaConnection';
import { WalletProvider } from '@/src/context/WalletProvider';
import type { Adapter } from '@solana/wallet-adapter-base';
import { connectionService } from '@/src/services/connectionService';
import { parseSignDeepLink } from '@/src/services/signatureEngine';
import AppLock from '@/components/AppLock';
import { useNotifications } from '@/src/hooks/useNotifications';
import CustomSplashScreen from '@/src/components/CustomSplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';

export const unstable_settings = {
  initialRouteName: 'login',
};

const SOLANA_RPC_ENDPOINT =
  process.env.EXPO_PUBLIC_SOLANA_RPC_MAINNET ?? 'https://api.mainnet-beta.solana.com';

const WALLET_ADAPTERS: Adapter[] = [];

// ─── Componente interno que tem acesso ao ConnectionContext ───────────────────

function DeepLinkHandler({ initialized }: { initialized: boolean }) {
  const { setPendingRequest, setPendingSignRequest } = useConnection();
  const pendingUrlRef = useRef<string | null>(null);

  const handleUrl = (url: string) => {
    // Parse connection request (verumwallet://connect)
    const connectReq = connectionService.parseConnectionURL(url);
    if (connectReq) {
      console.log('[DeepLink] verumwallet://connect recebido', connectReq.name);
      router.push({
        pathname: '/connect-approval',
        params: { request: JSON.stringify(connectReq) },
      } as any);
      return;
    }

    // Parse sign request — formato antigo (verumwallet://sign?action=...)
    const signReq = connectionService.parseSignURL(url);
    if (signReq) {
      console.log('[DeepLink] verumwallet://sign recebido', signReq.action);
      setPendingSignRequest(signReq);
      router.push('/sign-request' as any);
      return;
    }

    // Parse sign request — formato universal (verumwallet://signTransaction, signAllTransactions, signMessage)
    const universalSignReq = parseSignDeepLink(url);
    if (universalSignReq) {
      console.log('[DeepLink] Universal sign recebido', universalSignReq.action);
      setPendingSignRequest(universalSignReq);
      router.push('/sign-request' as any);
      return;
    }

    // Parse browse request (verumwallet://browse?url=...)
    try {
      const parsed = new URL(url.replace('verumwallet://', 'https://verumwallet/'));
      if (parsed.hostname === 'browse' || parsed.pathname === '/browse') {
        const browseUrl = parsed.searchParams.get('url');
        const browseName = parsed.searchParams.get('name');
        if (browseUrl) {
          console.log('[DeepLink] verumwallet://browse recebido', browseUrl);
          router.push({
            pathname: '/dapp-browser',
            params: {
              url: encodeURIComponent(browseUrl),
              name: browseName ? encodeURIComponent(browseName) : undefined,
            },
          } as any);
          return;
        }
      }

      // Parse KYC callback (verumwallet://kyc-callback?status=approved|rejected|...)
      // NUNCA confiar no status do redirect — sempre revalidar via /kyc/check-status.
      if (parsed.hostname === 'kyc-callback' || parsed.pathname === '/kyc-callback') {
        const hintStatus = parsed.searchParams.get('status');
        console.log('[DeepLink] verumwallet://kyc-callback recebido (status hint:', hintStatus, ')');
        router.push({
          pathname: '/kyc',
          params: { from_callback: '1' },
        } as any);
        return;
      }
    } catch {}
  };

  // Processa URL pendente assim que o app estiver pronto
  useEffect(() => {
    if (!initialized) return;
    if (pendingUrlRef.current) {
      handleUrl(pendingUrlRef.current);
      pendingUrlRef.current = null;
    }
  }, [initialized]);

  useEffect(() => {
    // Cold start: app aberto via deep link
    Linking.getInitialURL().then(url => {
      if (!url) return;
      if (initialized) {
        handleUrl(url);
      } else {
        pendingUrlRef.current = url;
      }
    });

    // App já aberto: novo deep link chegou
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (initialized) {
        handleUrl(url);
      } else {
        pendingUrlRef.current = url;
      }
    });

    return () => sub.remove();
  }, [initialized]);

  return null;
}

// ─── Root Layout ──────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [initializing, setInitializing] = useState(true);
  const segments = useSegments();
  const [session, setSession] = useState<any>(null);
  const [splashVisible, setSplashVisible] = useState(true);

  // Ativa a escuta em tempo real para o usuário logado
  useNotifications(session?.user?.id);

  const [fontsLoaded] = useFonts({
    Cinzel_400Regular,
    Cinzel_700Bold,
    Rajdhani_400Regular,
    Rajdhani_500Medium,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitializing(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (initializing) return;

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'recuperar-senha';

    if (!session && !inAuthGroup) {
      router.replace('/login');
    } else if (session && inAuthGroup && segments[0] !== 'recuperar-senha' && !walletSetupFlag.isActive()) {
      router.replace('/(tabs)/' as any);
    }
  }, [session, segments, initializing]);

  if ((initializing || !fontsLoaded) && !splashVisible) {
    // Fallback if splash was somehow dismissed early, though not normally expected.
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={V.gold} />
      </View>
    );
  }

  const isInitialized = !initializing && fontsLoaded;

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <SolanaConnectionProvider endpoint={SOLANA_RPC_ENDPOINT}>
        <WalletProvider wallets={WALLET_ADAPTERS} autoConnect>
        <ConnectionProvider>
          <DeepLinkHandler initialized={isInitialized} />
          <View style={styles.rootWrapper}>
            <View style={styles.contentContainer}>
              {isInitialized ? (
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="login" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
                  <Stack.Screen
                    name="sign-request"
                    options={{
                      presentation: 'modal',
                      headerShown: false,
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen
                    name="connect-approval"
                    options={{
                      presentation: 'modal',
                      headerShown: false,
                      animation: 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen name="dapp-browser" options={{ headerShown: false, animation: 'slide_from_right' }} />
                  <Stack.Screen name="dapp-hub" options={{ headerShown: false }} />
                  <Stack.Screen name="connected-apps" options={{ headerShown: false, animation: 'slide_from_right' }} />
                  <Stack.Screen name="kyc" options={{ headerShown: false, animation: 'slide_from_right' }} />
                </Stack>
              ) : null}
            </View>
            <StatusBar style="light" backgroundColor={V.bg} />
            {isInitialized && <AppLock />}
            {splashVisible && (
              <CustomSplashScreen
                isAppReady={isInitialized}
                onFinish={() => setSplashVisible(false)}
              />
            )}
          </View>
        </ConnectionProvider>
        </WalletProvider>
        </SolanaConnectionProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: V.bg,
  },
  rootWrapper: {
    flex: 1,
    backgroundColor: V.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 690,
    minWidth: 320,
    backgroundColor: V.bg,
    overflow: 'hidden',
  },
});
