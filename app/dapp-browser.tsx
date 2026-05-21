/**
 * DApp Browser — Navegador genérico com injeção do Verum Provider.
 *
 * Permite ao usuário navegar em QUALQUER dApp Solana (Jupiter, Raydium, Tensor,
 * Magic Eden, etc.) com a Verum Wallet conectada automaticamente.
 *
 * O fluxo é idêntico ao vesting-browser.tsx, mas aceita URL dinâmica via params.
 *
 * Segurança:
 *  - Apenas HTTPS é permitido (exceto localhost em dev)
 *  - O provider injetado nunca expõe chave privada
 *  - Todas as assinaturas passam pelo modal de permissão nativo
 *  - Sites não-confiáveis NUNCA recebem auto-approve
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import SwipeToConfirm from '@/components/SwipeToConfirm';
import PasswordModal  from '@/components/PasswordModal';
import { useSettings } from '@/constants/SettingsContext';
import { V, F }       from '@/constants/theme';
import { keyManager } from '@/src/services/keyManager';
import { buildVerumInjectionScript, VERUM_MSG } from '@/src/services/verumProvider';
import {
  signTransaction,
  signAllTransactions,
  signMessage,
  VerumSignatureError,
} from '@/src/services/signatureEngine';
import trustedDapps from '@/src/services/trustedDapps';
import { ConnectionRequestView } from '@/components/ConnectionRequestView';
import { ConnectionRequest, Permission } from '@/src/services/connectionService';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type ModalType = 'connect' | 'signTx' | 'signAllTx' | 'signMessage' | null;

interface PendingRequest {
  type:     ModalType;
  id:       string;
  origin:   string;
  payload?: string | string[];
  txCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text.startsWith('http') ? text : `https://${text}`);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeUrl(text: string): string {
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  return `https://${text}`;
}

function getModalMeta(req: PendingRequest): {
  icon: string; title: string; subtitle: string; riskLabel?: string;
} {
  switch (req.type) {
    case 'connect':
      return {
        icon:     'link',
        title:    'Solicitação de Conexão',
        subtitle: 'Compartilhar endereço público da carteira',
      };
    case 'signTx':
      return {
        icon:      'send',
        title:     'Assinar Transação',
        subtitle:  'Autorizar transação na Solana',
        riskLabel: 'ALTO RISCO',
      };
    case 'signAllTx':
      return {
        icon:      'layers',
        title:     'Assinar Transações',
        subtitle:  'Autorizar múltiplas transações',
        riskLabel: 'ALTO RISCO',
      };
    case 'signMessage':
      return {
        icon:      'edit-3',
        title:     'Assinar Mensagem',
        subtitle:  'Autenticar identidade (off-chain)',
        riskLabel: 'MÉDIO RISCO',
      };
    default:
      return { icon: 'help-circle', title: 'Solicitação', subtitle: '' };
  }
}

// ─── Modal de Permissão ──────────────────────────────────────────────────────

interface PermissionModalProps {
  request:   PendingRequest | null;
  publicKey: string;
  network:   string;
  dappName:  string;
  onApprove: () => void;
  onReject:  () => void;
  visible?:  boolean;
}



function PermissionModal({ request, publicKey, network, dappName, onApprove, onReject, visible }: PermissionModalProps) {
  const isVisible = visible !== undefined ? visible : !!request;
  if (!request || !isVisible) return null;

  const isConnect = request.type === 'connect';
  
  // Mapping internal request to ConnectionRequest for the component
  const mappedRequest: ConnectionRequest = {
    session: request.id,
    name: dappName,
    origin: request.origin,
    permissions: ['publicKey'] as Permission[],
    icon: undefined, // Could be improved if we find the icon
  };

  if (isConnect) {
    return (
      <Modal
        visible={isVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={onReject}
      >
        <ConnectionRequestView
          request={mappedRequest}
          walletAddress={publicKey}
          network={network}
          onApprove={onApprove}
          onReject={onReject}
          isApproving={false} // dapp-browser handles loading internally or via Swipe
        />
      </Modal>
    );
  }

  // Fallback for signTx/signMessage (keep existing logic or similar)
  const truncPubKey  = typeof publicKey === 'string' && publicKey.length > 0
    ? `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`
    : '—';
  const isSignAction = request.type !== 'connect';
  const isHighRisk   = isSignAction;
  const { icon, title, subtitle, riskLabel } = getModalMeta(request);

  return (
    <Modal
      visible={!!request}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onReject}
    >
      <Pressable style={modal.overlay} onPress={onReject}>
        <Pressable style={modal.sheet} onPress={() => {}}>
          <View style={modal.handle} />

          {/* Header */}
          <View style={modal.header}>
            <View style={[modal.headerIcon, { backgroundColor: isHighRisk ? V.danger + '20' : V.gold + '20' }]}>
              <Feather name={icon as any} size={18} color={isHighRisk ? V.danger : V.gold} />
            </View>
            <Text style={modal.headerTitle}>{title}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {/* dApp Card */}
            <LinearGradient colors={['#1A1500', '#111100']} style={modal.dappCard}>
              <View style={modal.dappIconWrap}>
                <Feather name="globe" size={26} color={V.gold} />
              </View>
              <Text style={modal.dappName}>{dappName}</Text>
              <Text style={modal.dappOrigin}>{request.origin}</Text>
            </LinearGradient>

            {/* Divisor */}
            <View style={modal.arrowRow}>
              <View style={modal.divider} />
              <View style={modal.arrowCircle}>
                <Feather name="arrow-down" size={13} color={V.gold} />
              </View>
              <View style={modal.divider} />
            </View>

            {/* Carteira */}
            <View style={modal.walletCard}>
              <View style={modal.walletIconWrap}>
                <Feather name="shield" size={16} color={V.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={modal.walletLabel}>Verum Wallet</Text>
                <Text style={modal.walletAddress}>{truncPubKey}</Text>
              </View>
              <View style={modal.networkBadge}>
                <View style={[modal.networkDot, { backgroundColor: V.success }]} />
                <Text style={modal.networkText}>{network}</Text>
              </View>
            </View>

            {/* Detalhe da operação */}
            <View style={modal.operationCard}>
              <View style={[modal.operationIcon, { backgroundColor: (isHighRisk ? V.danger : V.success) + '15' }]}>
                <Feather name={icon as any} size={16} color={isHighRisk ? V.danger : V.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={modal.operationLabel}>{subtitle}</Text>
                {request.txCount && request.txCount > 1 && (
                  <Text style={modal.operationSub}>{request.txCount} transações no total</Text>
                )}
              </View>
              {riskLabel && (
                <View style={[modal.riskBadge, { borderColor: V.danger + '40', backgroundColor: V.danger + '15' }]}>
                  <Text style={[modal.riskBadgeText, { color: V.danger }]}>{riskLabel}</Text>
                </View>
              )}
            </View>

            {/* Aviso de alto risco */}
            {isHighRisk && (
              <View style={modal.riskAlert}>
                <Feather name="alert-triangle" size={14} color={V.danger} />
                <Text style={modal.riskAlertText}>
                  Verifique a origem antes de assinar. Transações assinadas são irreversíveis na blockchain.
                </Text>
              </View>
            )}

            <Text style={modal.legal}>
              Sua chave privada{' '}
              <Text style={{ color: V.danger }}>nunca</Text>{' '}
              é compartilhada com o dApp.
            </Text>
          </ScrollView>

          {/* Ações */}
          <View style={modal.actions}>
            {!publicKey && request.type === 'connect' ? (
              <TouchableOpacity style={s.btnPrimary} onPress={onApprove}>
                <Text style={s.btnPrimaryText}>DESBLOQUEAR E CONECTAR</Text>
              </TouchableOpacity>
            ) : (
              <SwipeToConfirm
                onConfirm={onApprove}
                label={isSignAction ? 'Deslize para assinar' : 'Deslize para conectar'}
                accentColor={isHighRisk ? V.danger : V.gold}
              />
            )}
            <TouchableOpacity style={modal.rejectBtn} onPress={onReject}>
              <Text style={modal.rejectText}>Recusar</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


// ─── WebView Wrapper ─────────────────────────────────────────────────────────

interface BrowserWebViewProps {
  uri:             string;
  webViewRef:      React.MutableRefObject<any>;
  onMessage:       (event: any) => void;
  injectionScript: string;
  onNavigationChange?: (url: string) => void;
}

function BrowserWebView({ uri, webViewRef, onMessage, injectionScript, onNavigationChange }: BrowserWebViewProps) {
  const [loading, setLoading] = useState(true);
  const iframeRef             = useRef<any>(null);
  const isWeb                 = Platform.OS === 'web';

  useEffect(() => {
    if (isWeb) webViewRef.current = { iframe: iframeRef };
  }, [isWeb, webViewRef]);

  // Ponte postMessage para web
  useEffect(() => {
    if (!isWeb) return;
    const handler = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && e.data.type) {
        onMessage({ nativeEvent: { data: JSON.stringify(e.data) } });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isWeb, onMessage]);

  if (isWeb) {
    return (
      <View style={{ flex: 1 }}>
        <iframe
          ref={iframeRef}
          src={uri}
          style={{ flex: 1, width: '100%', height: '100%', border: 'none', display: 'block' }}
          allow="camera; microphone; clipboard-write; encrypted-media"
          title="dApp Browser"
        />
      </View>
    );
  }

  const { WebView } = require('react-native-webview');

  return (
    <View style={{ flex: 1 }}>
      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={V.gold} />
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri }}
        style={{ flex: 1, backgroundColor: V.bg }}
        injectedJavaScriptBeforeContentLoaded={injectionScript}
        onMessage={onMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(navState: any) => {
          if (onNavigationChange && navState.url) {
            onNavigationChange(navState.url);
          }
        }}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
      />
    </View>
  );
}

// ─── Tela Principal ──────────────────────────────────────────────────────────

export default function DAppBrowserScreen() {
  const insets   = useSafeAreaInsets();
  const params   = useLocalSearchParams<{ url?: string; name?: string }>();
  const { network } = useSettings();

  const initialUrl  = params.url ? decodeURIComponent(params.url) : '';
  const dappName    = params.name ? decodeURIComponent(params.name) : extractHostname(initialUrl);

  const [currentUrl, setCurrentUrl]           = useState(initialUrl);
  const [urlInput, setUrlInput]               = useState(initialUrl);
  const [publicKey, setPublicKey]             = useState('');
  const [pendingReq, setPendingReq]           = useState<PendingRequest | null>(null);
  const [hasWallet, setHasWallet]             = useState(false);
  const [isUnlockVisible, setUnlockVisible]   = useState(false);
  const [isUnlocking, setUnlocking]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [canGoBack, setCanGoBack]             = useState(false);
  const [canGoForward, setCanGoForward]       = useState(false);
  const [isUrlFocused, setUrlFocused]         = useState(!initialUrl);

  const webViewRef = useRef<any>(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const keypair = keyManager.getSessionKeypair();
    if (keypair) {
      setPublicKey(keypair.publicKey.toBase58());
    } else {
      // Fallback: usa endereço armazenado para permitir CONNECT sem pedir PIN.
      // Assinatura de transações continua exigindo PIN (loadDecrypted).
      keyManager.getStoredAddress().then(addr => {
        if (addr) setPublicKey(addr);
      });
    }
    keyManager.hasAccount().then(setHasWallet);
  }, []);

  // ── Injection Script ──────────────────────────────────────────────────────

  const injectionScript = useMemo(() => buildVerumInjectionScript({
    network:   (network ?? 'mainnet') as 'mainnet' | 'devnet',
    publicKey: publicKey || null,
    debug:     __DEV__,
  }), [network, publicKey]);

  // ── Sincroniza PK com o WebView quando muda ──────────────────────────────

  useEffect(() => {
    if (publicKey && webViewRef.current) {
      if (Platform.OS === 'web') {
        const iframeEl = webViewRef.current?.iframe?.current as HTMLIFrameElement | null;
        iframeEl?.contentWindow?.postMessage({ type: VERUM_MSG.INIT_RESPONSE, publicKey }, '*');
      } else {
        const js = `window.verum.__setConnected(${JSON.stringify(publicKey)}); true;`;
        webViewRef.current?.injectJavaScript(js);
      }
    }
  }, [publicKey]);

  // ── Envio de resposta ao WebView ──────────────────────────────────────────

  const sendResponse = useCallback((responseMsg: Record<string, any>, targetOrigin?: string) => {
    if (Platform.OS === 'web') {
      const iframeEl = webViewRef.current?.iframe?.current as HTMLIFrameElement | null;
      iframeEl?.contentWindow?.postMessage(responseMsg, targetOrigin || '*');
    } else {
      const resultPart = responseMsg.result !== undefined ? JSON.stringify(responseMsg.result) : 'null';
      const errorPart  = responseMsg.error ? JSON.stringify(responseMsg.error) : 'null';
      const js = `window.verum.__cb(${JSON.stringify(responseMsg.id)}, ${resultPart}, ${errorPart}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, []);

  // ── Handler de mensagens do WebView ───────────────────────────────────────

  const handleMessage = useCallback((event: any) => {
    let data: any;
    try { data = JSON.parse(event.nativeEvent.data); } catch { return; }

    const { type, id, origin } = data;
    if (!type || !id) return;

    console.log('[VERUM][BROWSER] recv', type, id, origin);

    switch (type) {
      case VERUM_MSG.CONNECT_REQUEST: {
        const req: PendingRequest = { type: 'connect', id, origin: origin ?? currentUrl };

        // Se já conectado, auto-approve
        if (publicKey) {
          // Verifica se é um dApp confiável
          trustedDapps.isTrusted(origin || currentUrl, publicKey).then(trusted => {
            if (trusted) {
              console.log('[VERUM][BROWSER] Trusted dApp -> auto-approve');
              _approveConnect(publicKey, id, origin);
            } else {
              setPendingReq(req);
            }
          });
          return;
        }

        // Sem PK -> mostra modal
        setPendingReq(req);
        if (hasWallet) setUnlockVisible(true);
        break;
      }

      case VERUM_MSG.SIGN_TX_REQUEST:
        if (!data.transaction) return;
        setPendingReq({ type: 'signTx', id, origin, payload: data.transaction });
        break;

      case VERUM_MSG.SIGN_ALL_REQUEST:
        if (!Array.isArray(data.transactions) || data.transactions.length === 0) return;
        setPendingReq({
          type: 'signAllTx', id, origin,
          payload: data.transactions,
          txCount: data.transactions.length,
        });
        break;

      case VERUM_MSG.SIGN_MSG_REQUEST:
        if (!data.message) return;
        setPendingReq({ type: 'signMessage', id, origin, payload: data.message });
        break;

      case VERUM_MSG.DISCONNECT:
        console.log('[VERUM][BROWSER] dApp desconectou:', origin);
        break;
    }
  }, [network, publicKey, currentUrl, hasWallet]);

  // ── Approve helper (connect auto) ─────────────────────────────────────────

  const _approveConnect = useCallback((pk: string, reqId: string, reqOrigin: string) => {
    setPublicKey(pk);
    sendResponse({
      type: VERUM_MSG.CONNECT_RESPONSE,
      id: reqId,
      result: { publicKey: pk },
      accounts: [{ address: pk, publicKey: pk }],
    }, reqOrigin);
    trustedDapps.addTrusted(reqOrigin, pk);
  }, [sendResponse]);

  // ── Aprovação genérica ────────────────────────────────────────────────────

  const handleApprove = useCallback(async (forcedPk?: string) => {
    if (!pendingReq) return;

    let keypair = keyManager.getSessionKeypair();

    if (!keypair && !forcedPk) {
      if (hasWallet) {
        sendResponse({
          type: VERUM_MSG.CONNECT_RESPONSE,
          id: pendingReq.id,
          result: { publicKey },
          accounts: [{ address: publicKey, publicKey: publicKey }],
        }, pendingReq.origin);
        setPendingReq(null);
      } else {
        sendResponse({
          type: VERUM_MSG.CONNECT_REJECTED,
          id: pendingReq.id,
          error: 'WALLET_NOT_FOUND',
        });
        setPendingReq(null);
      }
      return;
    }

    const reqCopy = { ...pendingReq };
    setPendingReq(null);

    try {
      switch (reqCopy.type) {
        case 'connect': {
          const pk = forcedPk || keypair!.publicKey.toBase58();
          _approveConnect(pk, reqCopy.id, reqCopy.origin);
          break;
        }
        case 'signTx': {
          const { signedTransaction, publicKey: pk } = signTransaction(keypair!, reqCopy.payload as string);
          sendResponse({ type: VERUM_MSG.SIGN_TX_RESPONSE, id: reqCopy.id, result: signedTransaction }, reqCopy.origin);
          break;
        }
        case 'signAllTx': {
          const results = signAllTransactions(keypair!, reqCopy.payload as string[]);
          const signedTxs = results.map(r => r.signedTransaction);
          sendResponse({ type: VERUM_MSG.SIGN_ALL_RESPONSE, id: reqCopy.id, result: signedTxs }, reqCopy.origin);
          break;
        }
        case 'signMessage': {
          const { signature, publicKey: pk } = signMessage(keypair!, reqCopy.payload as string);
          sendResponse({
            type: VERUM_MSG.SIGN_MSG_RESPONSE,
            id: reqCopy.id,
            result: { signature, publicKey: pk },
          }, reqCopy.origin);
          break;
        }
      }
    } catch (err: any) {
      const errorCode = err instanceof VerumSignatureError ? err.code : 'FAILED';
      const rejectType = {
        connect:     VERUM_MSG.CONNECT_REJECTED,
        signTx:      VERUM_MSG.SIGN_TX_REJECTED,
        signAllTx:   VERUM_MSG.SIGN_ALL_REJECTED,
        signMessage: VERUM_MSG.SIGN_MSG_REJECTED,
      }[reqCopy.type ?? 'connect'] || VERUM_MSG.CONNECT_REJECTED;
      sendResponse({ type: rejectType, id: reqCopy.id, reason: errorCode }, reqCopy.origin);
    }
  }, [pendingReq, sendResponse, _approveConnect, hasWallet]);

  // ── Rejeição ──────────────────────────────────────────────────────────────

  const handleReject = useCallback(() => {
    if (!pendingReq) return;
    const rejectType = {
      connect:     VERUM_MSG.CONNECT_REJECTED,
      signTx:      VERUM_MSG.SIGN_TX_REJECTED,
      signAllTx:   VERUM_MSG.SIGN_ALL_REJECTED,
      signMessage: VERUM_MSG.SIGN_MSG_REJECTED,
    }[pendingReq.type ?? 'connect'] ?? VERUM_MSG.CONNECT_REJECTED;

    if (Platform.OS === 'web') {
      const iframeEl = webViewRef.current?.iframe?.current as HTMLIFrameElement | null;
      iframeEl?.contentWindow?.postMessage(
        { type: rejectType, id: pendingReq.id, reason: 'USER_REJECTED' }, '*',
      );
    } else {
      const js = `window.verum.__cb(${JSON.stringify(pendingReq.id)}, null, 'USER_REJECTED'); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
    setPendingReq(null);
  }, [pendingReq]);

  // ── Unlock Handler ────────────────────────────────────────────────────────

  const handleUnlock = async (pin: string) => {
    setUnlocking(true);
    setError(null);
    try {
      const keypair  = await keyManager.loadDecrypted(pin);
      const mnemonic = await keyManager.getMnemonic(pin);
      keyManager.startSession(mnemonic, keypair, pin);

      const pkStr = keypair.publicKey.toBase58();
      setPublicKey(pkStr);
      setUnlockVisible(false);
      setTimeout(() => handleApprove(pkStr), 100);
    } catch (err: any) {
      setError(err.message || 'PIN incorreto.');
    } finally {
      setUnlocking(false);
    }
  };

  // ── Navegação URL ─────────────────────────────────────────────────────────

  const navigateTo = (url: string) => {
    const normalized = normalizeUrl(url);
    if (!isValidUrl(normalized)) return;
    setCurrentUrl(normalized);
    setUrlInput(normalized);
    setUrlFocused(false);
  };

  const handleNavigationChange = (url: string) => {
    setCurrentUrl(url);
    setUrlInput(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      {/* ── Barra de navegação do browser ─────────────────────────────────── */}
      <View style={s.browserBar}>
        <TouchableOpacity style={s.navBtn} onPress={() => router.back()}>
          <Feather name="x" size={20} color={V.muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.navBtn}
          onPress={() => webViewRef.current?.goBack?.()}
          disabled={!canGoBack}
        >
          <Feather name="chevron-left" size={20} color={canGoBack ? V.text : V.muted + '40'} />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.navBtn}
          onPress={() => webViewRef.current?.goForward?.()}
          disabled={!canGoForward}
        >
          <Feather name="chevron-right" size={20} color={canGoForward ? V.text : V.muted + '40'} />
        </TouchableOpacity>

        {/* URL Bar */}
        <View style={[s.urlBar, isUrlFocused && s.urlBarFocused]}>
          {publicKey ? (
            <View style={s.connectedDot} />
          ) : (
            <Feather name="globe" size={14} color={V.muted} />
          )}
          <TextInput
            style={s.urlInput}
            value={urlInput}
            onChangeText={setUrlInput}
            onFocus={() => setUrlFocused(true)}
            onBlur={() => setUrlFocused(false)}
            onSubmitEditing={() => navigateTo(urlInput)}
            placeholder="Pesquisar ou digitar URL"
            placeholderTextColor={V.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
          />
        </View>

        <TouchableOpacity
          style={s.navBtn}
          onPress={() => webViewRef.current?.reload?.()}
        >
          <Feather name="refresh-cw" size={18} color={V.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Status de conexão ─────────────────────────────────────────────── */}
      {publicKey && currentUrl ? (
        <LinearGradient
          colors={['#051505', '#020A02']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.statusBar}
        >
          <View style={s.statusContent}>
            <View style={s.statusDot} />
            <Feather name="shield" size={11} color={V.success} />
            <Text style={s.statusText}>
              CONECTADA <Text style={s.statusAddr}>({typeof publicKey === 'string' ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : ''})</Text>
            </Text>
          </View>
          <View style={s.statusBadge}>
            <Text style={s.statusBadgeText}>{extractHostname(currentUrl).toUpperCase()}</Text>
          </View>
        </LinearGradient>
      ) : null}

      {/* ── WebView ou tela inicial ───────────────────────────────────────── */}
      {currentUrl ? (
        <View style={{ flex: 1 }}>
          <BrowserWebView
            uri={currentUrl}
            webViewRef={webViewRef}
            onMessage={handleMessage}
            injectionScript={injectionScript}
            onNavigationChange={handleNavigationChange}
          />
        </View>
      ) : (
        <View style={s.emptyState}>
          <Feather name="compass" size={48} color={V.gold + '60'} />
          <Text style={s.emptyTitle}>Explorar dApps</Text>
          <Text style={s.emptyDesc}>
            Digite a URL de qualquer dApp Solana na barra acima.{'\n'}
            A Verum Wallet será injetada automaticamente.
          </Text>
        </View>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <PermissionModal
        request={pendingReq}
        publicKey={publicKey}
        network={network ?? 'mainnet'}
        dappName={dappName || extractHostname(currentUrl)}
        onApprove={handleApprove}
        onReject={handleReject}
        visible={!!pendingReq && !isUnlockVisible}
      />

      <PasswordModal
        isVisible={isUnlockVisible}
        onClose={() => setUnlockVisible(false)}
        onConfirm={handleUnlock}
        loading={isUnlocking}
        title="DESBLOQUEAR CARTEIRA"
        description="Digite seu PIN/Senha para conectar ao dApp."
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: V.bg,
  },

  // Browser bar
  browserBar: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    paddingHorizontal: 10,
    paddingVertical:  8,
    backgroundColor:  V.surface1,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  navBtn: {
    width:          36,
    height:         36,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   18,
  },
  urlBar: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    gap:              8,
    backgroundColor:  V.surface2,
    borderRadius:     V.r20,
    paddingHorizontal: 12,
    paddingVertical:  8,
    borderWidth:      1,
    borderColor:      'transparent',
  },
  urlBarFocused: {
    borderColor: V.gold + '60',
  },
  urlInput: {
    flex:        1,
    height:      '100%',
    backgroundColor: 'transparent',
    color:       V.text,
    fontFamily:  F.body,
    fontSize:    13,
    padding:     0,
    outlineStyle: 'none' as any,
  },
  connectedDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: V.success,
  },

  // Status bar
  statusBar: {
    height:            28,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: V.success + '20',
  },
  statusContent: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  statusDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: V.success,
  },
  statusText: {
    fontFamily:     F.bold,
    fontSize:       9,
    color:          '#e0e0e0',
    letterSpacing:  0.5,
  },
  statusAddr: {
    color:      V.success,
    fontFamily: F.body,
    fontSize:   9,
  },
  statusBadge: {
    backgroundColor:  V.success + '15',
    paddingHorizontal: 6,
    paddingVertical:  2,
    borderRadius:     4,
    borderWidth:      1,
    borderColor:      V.success + '30',
  },
  statusBadgeText: {
    fontFamily:    F.bold,
    fontSize:      8,
    color:         V.success,
    letterSpacing: 0.3,
  },

  // Empty state
  emptyState: {
    flex:             1,
    alignItems:       'center',
    justifyContent:   'center',
    paddingHorizontal: 40,
    gap:              12,
  },
  emptyTitle: {
    fontFamily: F.bold,
    fontSize:   20,
    color:      V.text,
  },
  emptyDesc: {
    fontFamily: F.body,
    fontSize:   14,
    color:      V.muted,
    textAlign:  'center',
    lineHeight: 22,
  },

  // Loading
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: V.bg,
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          10,
  },

  // Button (reused from vesting-browser)
  btnPrimary: {
    backgroundColor: V.gold,
    borderRadius:    V.r8,
    paddingVertical: 14,
    alignItems:      'center',
    marginTop:       8,
  },
  btnPrimaryText: {
    fontFamily:    F.bold,
    fontSize:      15,
    color:         V.bg,
    letterSpacing: 0.5,
  },
});

const modal = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: V.px, paddingTop: 12, paddingBottom: 32,
    borderTopWidth: 1, borderTopColor: V.border,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: V.muted, alignSelf: 'center', marginBottom: 16, opacity: 0.4,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  headerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: F.bold, fontSize: 16, color: V.text, letterSpacing: 0.5 },

  dappCard: {
    borderRadius: V.r12, padding: 20,
    alignItems: 'center', borderWidth: 1, borderColor: V.border, marginBottom: 8,
  },
  dappIconWrap: {
    width: 52, height: 52, borderRadius: 13,
    backgroundColor: V.surface2, borderWidth: 1, borderColor: V.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  dappName:   { fontFamily: F.bold, fontSize: 17, color: V.text, marginBottom: 4 },
  dappOrigin: { fontFamily: F.body, fontSize: 12, color: V.muted },

  arrowRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  divider:    { flex: 1, height: 1, backgroundColor: V.border },
  arrowCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: V.surface2, borderWidth: 1, borderColor: V.border,
    alignItems: 'center', justifyContent: 'center',
  },

  walletCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: V.surface2, borderRadius: V.r10,
    padding: 12, borderWidth: 1, borderColor: V.border, gap: 10, marginBottom: 8,
  },
  walletIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: V.gold + '15', borderWidth: 1, borderColor: V.gold + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  walletLabel:   { fontFamily: F.bold, fontSize: 12, color: V.text },
  walletAddress: { fontFamily: F.body, fontSize: 11, color: V.muted, marginTop: 1 },
  networkBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: V.r20, borderWidth: 1, borderColor: V.success + '40',
  },
  networkDot:  { width: 6, height: 6, borderRadius: 3 },
  networkText: { fontFamily: F.semi, fontSize: 10, color: V.success, textTransform: 'capitalize' },

  operationCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: V.surface2, borderRadius: V.r10,
    borderWidth: 1, borderColor: V.border, padding: 12, gap: 10, marginBottom: 8,
  },
  operationIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  operationLabel: { fontFamily: F.semi, fontSize: 13, color: V.text },
  operationSub:   { fontFamily: F.body, fontSize: 11, color: V.muted, marginTop: 1 },

  riskBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: V.r20, borderWidth: 1 },
  riskBadgeText: { fontFamily: F.bold, fontSize: 9, letterSpacing: 0.5 },

  riskAlert: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: V.danger + '10', borderRadius: V.r8,
    borderWidth: 1, borderColor: V.danger + '30', padding: 12, marginBottom: 8,
  },
  riskAlertText: { flex: 1, fontFamily: F.body, fontSize: 12, color: V.danger, lineHeight: 17 },
  legal: {
    fontFamily: F.body, fontSize: 11, color: V.muted,
    textAlign: 'center', lineHeight: 16, marginBottom: 8,
  },
  actions:    { marginTop: 8, gap: 4 },
  rejectBtn:  { alignItems: 'center', paddingVertical: 14 },
  rejectText: { fontFamily: F.semi, fontSize: 14, color: V.danger },
});
