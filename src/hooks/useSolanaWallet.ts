/**
 * useSolanaWallet — Hook central de gestão do keypair Solana.
 *
 * Responsabilidades:
 *  - Gerar nova wallet (mnemonic + keypair via BIP39 + ed25519-hd-key)
 *  - Importar wallet existente via frase mnemônica
 *  - Persistir/recuperar do vault criptografado (AES via keyManager)
 *  - Expor: publicKey, mnemonic (sob demanda), balance SOL, isLoading, status
 *  - Saldo em tempo real via WebSocket (onAccountChange) + polling fallback
 *
 * Segurança:
 *  - Keypair e mnemonic NUNCA saem do dispositivo
 *  - Assinatura é sempre local (via signatureEngine)
 *  - Vault criptografado com PIN do usuário (AES-256)
 *  - Sessão expira conforme keyManager (padrão 72h)
 *
 * Derivação: m/44'/501'/0'/0' (padrão Solana BIP44)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import keyManager, { WalletData } from '../services/keyManager';
import transactionService from '../services/transactionService';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type WalletStatus =
  | 'uninitialized'  // Sem wallet no dispositivo
  | 'locked'         // Wallet existe mas sessão não ativa (precisa PIN)
  | 'unlocking'      // Descriptografando vault
  | 'active'         // Sessão ativa, keypair em memória
  | 'expired'        // (M9) Sessão expirou por idle/timeout — distinto de 'locked' explícito
  | 'error';         // Erro no fluxo

export interface UseSolanaWalletResult {
  /** Status atual da wallet */
  status: WalletStatus;
  /** Endereço público Solana (Base58) — null se não inicializada */
  publicKey: string | null;
  /** Saldo SOL em tempo real */
  balance: number;
  /** Saldo SOL formatado (ex: "1.2345") */
  balanceFormatted: string;
  /** Flag de carregamento geral */
  isLoading: boolean;
  /** Último erro ocorrido */
  error: string | null;

  /**
   * Cria uma identidade COMPLETAMENTE NOVA (wipe + generate + persist).
   * Única forma sancionada de gerar keypair quando já existe identidade
   * persistida (rule #6). Só chame em resposta a ação explícita do usuário.
   */
  createNewWallet: (pin: string) => Promise<WalletData | null>;
  /** @deprecated Use `createNewWallet`. Alias mantido para compat. */
  generateWallet: (pin: string) => Promise<WalletData | null>;
  /** Importa wallet existente via frase mnemônica (recovery explícito). */
  importWallet: (mnemonic: string, pin: string) => Promise<string | null>;
  /** Desbloqueia wallet existente com PIN (inicia sessão) */
  unlock: (pin: string) => Promise<boolean>;
  /** Bloqueia wallet (limpa sessão da memória — NÃO apaga identidade) */
  lock: () => Promise<void>;
  /**
   * Destrói a identidade persistida (wipe total). Use SOMENTE em resposta a
   * ação explícita do usuário ("apagar carteira").
   */
  wipeIdentity: () => Promise<void>;
  /** Verifica se existe wallet salva no dispositivo */
  hasWallet: () => Promise<boolean>;
  /** Retorna o Keypair da sessão ativa (para assinatura local) — NUNCA enviar ao backend */
  getKeypair: () => Keypair | null;
  /** Retorna mnemonic da sessão ativa (para exibição de backup) */
  getMnemonic: () => string | null;
  /** Força atualização do saldo */
  refreshBalance: () => Promise<void>;
}

// ─── Constantes (M4: centralizadas em src/config/polling.ts) ────────────────
// (M9) Heartbeat para detectar sessão expirada por idle. keyManager dispara
// 'expired' automaticamente quando getSessionKeypair detecta idle > 15min, MAS
// só checa quando alguém chama essa função. O heartbeat aqui garante que mesmo
// sem chamadas externas, o hook ativamente sonda o estado e atualiza a UI.
import { BALANCE_POLL_MS, SESSION_HEARTBEAT_MS } from '@/src/config/polling';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSolanaWallet(network?: 'mainnet' | 'devnet'): UseSolanaWalletResult {
  const [status, setStatus] = useState<WalletStatus>('uninitialized');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Refs para cleanup de WebSocket/polling
  const wsSubId = useRef<number | null>(null);
  const connRef = useRef<any>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef<boolean>(true);
  // Guard idempotente para a inicialização — deps do useEffect agora são
  // declaradas corretamente (evita stale closure em refactor futuro), mas
  // este ref garante que o init de restore-de-sessão roda APENAS UMA VEZ
  // mesmo que React Strict Mode ou refactor cause re-execução.
  const initRanRef = useRef<boolean>(false);

  // ── Helpers internos ────────────────────────────────────────────────────

  const safeSetState = useCallback(<T, U extends T>(setter: React.Dispatch<React.SetStateAction<T>>, value: U) => {
    if (mountedRef.current) setter(value);
  }, []);

  const clearError = useCallback(() => safeSetState(setError, null), [safeSetState]);

  // ── Fetch de saldo SOL ──────────────────────────────────────────────────

  const fetchBalance = useCallback(async (address: string) => {
    try {
      // Usa a rede especificada ou a atual do service
      const connection = transactionService.getConnection(network);
      const pk = new PublicKey(address);
      const lamports = await connection.getBalance(pk);
      const sol = lamports / LAMPORTS_PER_SOL;
      safeSetState(setBalance, sol);
    } catch (err) {
      console.warn('[useSolanaWallet] fetchBalance error:', err);
    }
  }, [safeSetState, network]);

  // ── WebSocket subscription para saldo em tempo real ─────────────────────

  const unsubscribeBalance = useCallback(() => {
    if (wsSubId.current !== null && connRef.current) {
      try {
        connRef.current.removeAccountChangeListener(wsSubId.current);
      } catch {}
      wsSubId.current = null;
      connRef.current = null;
    }
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback((address: string) => {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(() => {
      fetchBalance(address);
    }, BALANCE_POLL_MS);
  }, [fetchBalance]);

  const subscribeBalance = useCallback((address: string) => {
    unsubscribeBalance();

    try {
      const connection = transactionService.getConnection(network);
      const pk = new PublicKey(address);

      connRef.current = connection;
      wsSubId.current = connection.onAccountChange(
        pk,
        (accountInfo) => {
          const sol = accountInfo.lamports / LAMPORTS_PER_SOL;
          safeSetState(setBalance, sol);
        },
        'confirmed'
      );
      startPolling(address);
    } catch (err) {
      console.warn('[useSolanaWallet] subscribeBalance error:', err);
      startPolling(address);
    }
  }, [unsubscribeBalance, startPolling, safeSetState, network]);

  // ── Ativar wallet (após gerar/importar/unlock) ─────────────────────────

  const activateWallet = useCallback((address: string) => {
    safeSetState(setPublicKey, address);
    safeSetState(setStatus, 'active');
    safeSetState(setError, null);

    // Busca saldo inicial + subscribe tempo real
    fetchBalance(address);
    subscribeBalance(address);
  }, [safeSetState, fetchBalance, subscribeBalance]);

  // ── API pública: criar nova identidade (ação explícita) ────────────────

  const createNewWallet = useCallback(async (pin: string): Promise<WalletData | null> => {
    try {
      clearError();
      safeSetState(setIsLoading, true);

      // wipe → generate → saveEncrypted(allowOverwrite: true)
      const wallet = await keyManager.createNewWallet(pin);
      await keyManager.startSession(wallet.mnemonic, wallet.keypair, pin);

      activateWallet(wallet.publicKey);
      console.log('[useSolanaWallet] Nova wallet criada:', wallet.publicKey.substring(0, 8) + '...');

      return wallet;
    } catch (err: any) {
      const msg = err.message || 'Falha ao criar wallet.';
      safeSetState(setError, msg);
      safeSetState(setStatus, 'error' as WalletStatus);
      console.error('[useSolanaWallet] createNewWallet error:', msg);
      return null;
    } finally {
      safeSetState(setIsLoading, false as boolean);
    }
  }, [clearError, safeSetState, activateWallet]);

  /** @deprecated Alias para createNewWallet */
  const generateWallet = createNewWallet;

  // ── API pública: importar via mnemonic ──────────────────────────────────

  const importWallet = useCallback(async (mnemonic: string, pin: string): Promise<string | null> => {
    try {
      clearError();
      safeSetState(setIsLoading, true);

      // importNewWallet faz wipe → derive → saveEncrypted(allowOverwrite: true).
      // Necessário porque saveEncrypted SEM allowOverwrite rejeita troca de identidade.
      const wallet = await keyManager.importNewWallet(mnemonic, pin);
      await keyManager.startSession(wallet.mnemonic, wallet.keypair, pin);

      activateWallet(wallet.publicKey);
      console.log('[useSolanaWallet] Wallet importada:', wallet.publicKey.substring(0, 8) + '...');

      return wallet.publicKey;
    } catch (err: any) {
      const msg = err.message || 'Falha ao importar wallet.';
      safeSetState(setError, msg);
      safeSetState(setStatus, 'error' as WalletStatus);
      console.error('[useSolanaWallet] importWallet error:', msg);
      return null;
    } finally {
      safeSetState(setIsLoading, false as boolean);
    }
  }, [clearError, safeSetState, activateWallet]);

  // ── API pública: desbloquear com PIN ────────────────────────────────────

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    try {
      clearError();
      safeSetState(setStatus, 'unlocking');
      safeSetState(setIsLoading, true);

      // (C2) Single PBKDF2: unlockVault retorna keypair + mnemonic em uma decifragem.
      // Antes: loadDecrypted (PBKDF2 600k) + getMnemonic (PBKDF2 600k) = ~1.4s.
      // Agora: ~0.7s. (C1) PinLockedError sobe daqui se o rate-limit estiver ativo.
      const { keypair, mnemonic } = await keyManager.unlockVault(pin);
      await keyManager.startSession(mnemonic, keypair, pin);

      const address = keypair.publicKey.toBase58();
      activateWallet(address);
      console.log('[useSolanaWallet] Wallet desbloqueada:', address.substring(0, 8) + '...');

      return true;
    } catch (err: any) {
      const msg = err.message || 'PIN inválido.';
      safeSetState(setError, msg);
      safeSetState(setStatus, 'locked' as WalletStatus);
      console.error('[useSolanaWallet] unlock error:', msg);
      return false;
    } finally {
      safeSetState(setIsLoading, false as boolean);
    }
  }, [clearError, safeSetState, activateWallet]);

  // ── API pública: bloquear ───────────────────────────────────────────────

  const lock = useCallback(async () => {
    unsubscribeBalance();
    await keyManager.clearSession();
    safeSetState(setPublicKey, null);
    safeSetState(setBalance, 0);
    safeSetState(setStatus, 'locked' as WalletStatus);
    console.log('[useSolanaWallet] Wallet bloqueada.');
  }, [unsubscribeBalance, safeSetState]);

  // ── API pública: destruir identidade (ação explícita do usuário) ───────

  const wipeIdentity = useCallback(async () => {
    try {
      unsubscribeBalance();
      await keyManager.wipeIdentity();
      safeSetState(setPublicKey, null);
      safeSetState(setBalance, 0);
      safeSetState(setStatus, 'uninitialized' as WalletStatus);
      safeSetState(setError, null);
      console.log('[useSolanaWallet] Identidade destruída (wipe total).');
    } catch (err: any) {
      const msg = err.message || 'Falha ao apagar carteira.';
      safeSetState(setError, msg);
      console.error('[useSolanaWallet] wipeIdentity error:', msg);
    }
  }, [unsubscribeBalance, safeSetState]);

  // ── API pública: helpers ────────────────────────────────────────────────

  const hasWallet = useCallback(async (): Promise<boolean> => {
    return keyManager.hasAccount();
  }, []);

  const getKeypair = useCallback((): Keypair | null => {
    return keyManager.getSessionKeypair();
  }, []);

  const getMnemonic = useCallback((): string | null => {
    return keyManager.getSessionMnemonic();
  }, []);

  const refreshBalance = useCallback(async () => {
    if (publicKey) {
      await fetchBalance(publicKey);
    }
  }, [publicKey, fetchBalance]);

  // Re-fetch e re-subscribe quando a rede muda
  useEffect(() => {
    if (publicKey && status === 'active') {
      fetchBalance(publicKey);
      subscribeBalance(publicKey);
    }
  }, [network, publicKey, status, fetchBalance, subscribeBalance]);

  // ── (M9) Listener de eventos de sessão + heartbeat ──────────────────────
  //
  // Antes desta integração, quando o keyManager limpava a sessão internamente
  // por idle/timeout, o hook ficava preso em status='active' até o próximo
  // render — UI mostrava "carteira desbloqueada" mas qualquer assinatura
  // falhava com "session not found".
  //
  // Agora:
  //  1. onSessionChange dispara IMEDIATAMENTE quando o keyManager auto-expira
  //     OU quando wipeIdentity/clearSession é chamado externamente.
  //  2. Um heartbeat de 30s força sonda de getSessionKeypair, que internamente
  //     auto-expira se necessário (e gera o evento que cai em #1).
  //
  // Race-condition resolvida: o estado local de status SEMPRE reflete o estado
  // efetivo do keyManager, sem lag de render.

  useEffect(() => {
    const unsubscribe = keyManager.onSessionChange((event) => {
      if (!mountedRef.current) return;

      if (event === 'expired') {
        // (M9) Sessão expirou (idle / timeout absoluto / timer). Forçar logout
        // de segurança: limpar WS, zerar balance, mudar status para 'expired'.
        // Mantemos publicKey visível (não null) para a UI poder mostrar
        // "Bem-vindo de volta, {addr.slice(0,8)}... — digite PIN" se quiser.
        unsubscribeBalance();
        safeSetState(setBalance, 0);
        safeSetState(setStatus, 'expired' as WalletStatus);
        safeSetState(setError, null);
      } else if (event === 'cleared') {
        // Logout explícito via keyManager.clearSession() externo.
        unsubscribeBalance();
        safeSetState(setBalance, 0);
        safeSetState(setStatus, 'locked' as WalletStatus);
      } else if (event === 'wiped') {
        // Identidade destruída — UI volta ao estado uninitialized.
        unsubscribeBalance();
        safeSetState(setPublicKey, null);
        safeSetState(setBalance, 0);
        safeSetState(setStatus, 'uninitialized' as WalletStatus);
        safeSetState(setError, null);
      }
      // 'started' não dispara nada aqui — quem chama unlock/createNewWallet/
      // importNewWallet já roda activateWallet que define status='active'.
    });
    return () => {
      unsubscribe();
    };
  }, [safeSetState, unsubscribeBalance]);

  // (M9) Heartbeat: força check de expiração mesmo sem outras chamadas.
  // getSessionKeypair() auto-expira se necessário e o evento chega no listener
  // acima. Não precisamos fazer nada com o retorno aqui — só nudge.
  useEffect(() => {
    if (status !== 'active') return;
    const interval = setInterval(() => {
      keyManager.getSessionKeypair();
    }, SESSION_HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [status]);

  // Re-subscribe ao WebSocket quando o app volta ao primeiro plano
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active' && publicKey && status === 'active') {
        fetchBalance(publicKey);
        subscribeBalance(publicKey);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [publicKey, status, fetchBalance, subscribeBalance]);

  // ── Inicialização: tenta restaurar sessão existente ─────────────────────
  //
  // Roda UMA vez por mount real (initRanRef previne re-execução em Strict Mode
  // ou hot-reload). Deps declaradas corretamente para satisfazer
  // react-hooks/exhaustive-deps e prevenir stale closure em refactor futuro.

  useEffect(() => {
    mountedRef.current = true;
    if (initRanRef.current) {
      // Já rodou; cleanup ainda registra mountedRef.current = false na desmontagem.
      return () => {
        mountedRef.current = false;
        unsubscribeBalance();
      };
    }
    initRanRef.current = true;

    (async () => {
      try {
        // 1. Tenta carregar o endereço público do cache (mesmo se bloqueado)
        const storedAddr = await keyManager.getStoredAddress();
        if (storedAddr && mountedRef.current) {
          safeSetState(setPublicKey, storedAddr);
        }

        // 2. Verifica se existe wallet salva
        const exists = await keyManager.findEncryptedData();
        if (!exists) {
          safeSetState(setStatus, 'uninitialized' as WalletStatus);
          safeSetState(setIsLoading, false as boolean);
          return;
        }

        // 3. Tenta restaurar sessão persistente (PIN salvo / biometria)
        const restored = await keyManager.restoreSession();
        if (restored) {
          const keypair = keyManager.getSessionKeypair();
          if (keypair) {
            const address = keypair.publicKey.toBase58();
            activateWallet(address);
            safeSetState(setIsLoading, false as boolean);
            console.log('[useSolanaWallet] Sessão restaurada automaticamente.');
            return;
          }
        }

        // 4. Wallet existe mas sessão não ativa — precisa PIN
        safeSetState(setStatus, 'locked' as WalletStatus);
        safeSetState(setIsLoading, false as boolean);
      } catch (err) {
        console.error('[useSolanaWallet] init error:', err);
        safeSetState(setStatus, 'error' as WalletStatus);
        safeSetState(setIsLoading, false as boolean);
      }
    })();

    return () => {
      mountedRef.current = false;
      unsubscribeBalance();
    };
  }, [activateWallet, safeSetState, unsubscribeBalance]);

  // ── Retorno ─────────────────────────────────────────────────────────────

  return {
    status,
    publicKey,
    balance,
    balanceFormatted: balance.toFixed(4),
    isLoading,
    error,
    createNewWallet,
    generateWallet,
    importWallet,
    unlock,
    lock,
    wipeIdentity,
    hasWallet,
    getKeypair,
    getMnemonic,
    refreshBalance,
  };
}

export default useSolanaWallet;
