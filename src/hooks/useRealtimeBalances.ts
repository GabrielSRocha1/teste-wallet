/**
 * useRealtimeBalances — saldo SOL + SPL em tempo real via Solana WebSocket.
 *
 * Padrão Solflare:
 * - 2 chamadas RPC em paralelo por fetch: getBalance + getParsedTokenAccountsByOwner
 * - Descoberta automática de todos os tokens da carteira (não apenas predefinidos)
 * - WebSocket onAccountChange (conta SOL + ATAs SPL) → dispara fetchAll completo
 * - Polling a cada 8s como fallback (cobre mudanças de SPL que não alteram saldo SOL)
 * - Health check a cada 30s para detectar queda silenciosa do WebSocket e re-subscrever
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Connection, PublicKey } from '@solana/web3.js';
import transactionService, { TOKEN_MINTS_MAINNET, TOKEN_MINTS_DEVNET } from '../services/transactionService';
import keyManager from '../services/keyManager';
import * as SettingsStorage from '@/constants/settings-storage';
// (M4) Constantes de polling centralizadas em src/config/polling.ts.
import { BALANCE_POLL_MS as POLL_MS, WS_HEALTH_CHECK_MS as HEALTH_CHECK_MS } from '@/src/config/polling';

export interface RealtimeBalances {
  SOL: number;
  USDT: number;
  USDC: number;
  BDC: number;
  ESCT: number;
  BRT: number;
  [key: string]: number;
}

export interface UseRealtimeBalancesResult {
  balances: RealtimeBalances;
  dynamicTokens: any[];
  isLoading: boolean;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  error: string | null;
}

export function useRealtimeBalances(walletAddress?: string | null, networkProp?: string): UseRealtimeBalancesResult {
  const [balances, setBalances] = useState<RealtimeBalances>({} as RealtimeBalances);
  const [dynamicTokens, setDynamicTokens] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const wsSubIds = useRef<number[]>([]);
  // Ref para a Connection usada na subscription — evita stale closure em unsubscribe
  const connRef = useRef<Connection | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addrRef = useRef<string | null>(null);

  // ── Obtém o endereço ativo (prop > vault local > keyManager) ──────────────

  const resolveAddress = useCallback(async (): Promise<string | null> => {
    if (walletAddress) return walletAddress;
    try {
      const persisted = await keyManager.getPersistedIdentity();
      if (persisted?.publicKey) return persisted.publicKey;
      const session = keyManager.getSessionKeypair();
      if (session) return session.publicKey.toBase58();
    } catch {}
    return null;
  }, [walletAddress]);

  // ── Fetch completo — padrão Solflare: 2 chamadas RPC ─────────────────────

  const fetchAll = useCallback(async (address: string): Promise<void> => {
    const currentNetwork = networkProp || transactionService.getNetwork();
    const mints = currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET;
    const mintMap = Object.fromEntries(Object.entries(mints).map(([k, v]) => [k, v.mint]));

    try {
      setError(null);
      // 🆕 Usa o TransactionService que agora tem proxy no backend e fallback robusto
      // console.log(`[useRealtimeBalances] Iniciando fetch completo para ${address.substring(0, 8)}...`);
      const { balances: newBalances, dynamicTokens } = await transactionService.getBalances(address, mintMap);
      
      // Se o objeto estiver vazio, ignoramos a atualização para não zerar a UI por erro de rede
      if (!newBalances || Object.keys(newBalances).length === 0) {
        // console.warn('[useRealtimeBalances] Objeto de saldos vazio recebido. Mantendo saldos atuais.');
        return;
      }

      const next: Partial<RealtimeBalances> = {};
      const tokensToTrack = ['SOL', 'USDT', 'USDC', 'BDC', 'ESCT', 'BRT'];
      
      tokensToTrack.forEach(sym => {
        if (newBalances[sym] !== undefined) {
          next[sym] = newBalances[sym];
        }
      });

      // Adiciona tokens dinâmicos (que o backend proxy também retorna)
      for (const dt of dynamicTokens) {
        next[dt.symbol] = dt.balance;
      }

      if (mountedRef.current) {
        setDynamicTokens(dynamicTokens);
        setBalances(prev => {
          const updated = { ...prev, ...next } as RealtimeBalances;
          // Persiste o cache com o estado completo mesclado
          SettingsStorage.setBalancesCache(currentNetwork, address, updated).catch(() => {});
          return updated;
        });
        setLastUpdated(new Date());
        setIsLoading(false);
        // console.log(`[useRealtimeBalances] ✅ Saldos atualizados.`);
      }
    } catch (err: any) {
      // Saldos atuais ficam preservados (state não é tocado) — exibimos só
      // um indicador de erro pra UI mostrar badge "offline" sem zerar valores.
      const raw = String(err?.message ?? err ?? '');
      let friendly: string;
      if (raw.includes('403') || raw.includes('401')) {
        friendly = 'RPC negado (HELIUS_API_KEY no proxy?)';
      } else if (raw.includes('429')) {
        friendly = 'RPC com rate-limit, tentando novamente…';
      } else if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
        friendly = 'Sem conexão com o RPC';
      } else {
        friendly = raw.slice(0, 140) || 'Falha ao atualizar saldo';
      }
      if (mountedRef.current) {
        setError(friendly);
        setIsLoading(false);
      }
    }
  }, [networkProp]);

  const startPolling = useCallback((address: string) => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      fetchAll(address);
    }, POLL_MS);
  }, [fetchAll]);

  const unsubscribe = useCallback(() => {
    const conn = connRef.current;
    if (conn) {
      for (const id of wsSubIds.current) {
        try { conn.removeAccountChangeListener(id); } catch {}
      }
      connRef.current = null;
    }
    wsSubIds.current = [];

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
      healthCheckRef.current = null;
    }
  }, []);

  // ── WebSocket — conta SOL + ATAs SPL conhecidas, tudo dispara fetchAll ───

  const subscribe = useCallback(async (address: string): Promise<void> => {
    const currentNetwork = networkProp || transactionService.getNetwork();
    const conn = transactionService.getConnection(currentNetwork as any);
    const mints = currentNetwork === 'mainnet' ? TOKEN_MINTS_MAINNET : TOKEN_MINTS_DEVNET;
    const ownerPk = new PublicKey(address);
    const ids: number[] = [];

    // Armazena referência da Connection para uso no unsubscribe (evita stale closure)
    connRef.current = conn;

    try {
      // 1. Subscription APENAS na conta SOL principal (Padrão otimizado)
      // Se o saldo SOL mudar, dispararemos o fetch de tudo (incluindo tokens).
      // Isso evita abrir 10+ WebSockets em RPCs públicos que têm limites estritos.
      const solId = conn.onAccountChange(
        ownerPk,
        () => {
          // console.log('[useRealtimeBalances] Mudança detectada na conta SOL, atualizando tudo...');
          if (mountedRef.current) fetchAll(address);
        },
        { commitment: 'confirmed' },
      );
      ids.push(solId);

      // Não subscrevemos mais nas ATAs individualmente para evitar o loop de erro 
      // detectado no call stack (rpc-websockets). O Polling de 30s cuidará dos tokens.

      wsSubIds.current = ids;
    } catch (err: any) {
      // console.warn('[useRealtimeBalances] WebSocket falhou ao iniciar:', err.message);
      wsSubIds.current = [];
      startPolling(address);
    }
  }, [fetchAll, networkProp, startPolling]);

  // ── Health check: detecta queda silenciosa do WebSocket e re-subscribe ────
  const startHealthCheck = useCallback((address: string) => {
    if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    healthCheckRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      // Se as subscriptions foram dropadas silenciosamente, refaz tudo
      if (wsSubIds.current.length === 0) {
        // console.warn('[useRealtimeBalances] Health check: WebSocket sem subscriptions, re-subscribing...');
        await fetchAll(address);
        await subscribe(address);
      }
    }, HEALTH_CHECK_MS);
  }, [fetchAll, subscribe]);

  // ── API pública: forçar refresh ───────────────────────────────────────────

  const refresh = useCallback(async () => {
    const addr = addrRef.current || await resolveAddress();
    if (addr) {
      setIsLoading(true);
      await fetchAll(addr);
    }
  }, [resolveAddress, fetchAll]);

  // ── Inicialização e limpeza ───────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      const address = await resolveAddress();
      if (!address || cancelled) {
        if (mountedRef.current) setIsLoading(false);
        return;
      }
      addrRef.current = address;

      // Tenta carregar do cache para exibir algo imediatamente
      const currentNet = networkProp || transactionService.getNetwork();
      const cached = await SettingsStorage.getBalancesCache(currentNet, address);
      if (cached && mountedRef.current) {
        setBalances(cached);
        setIsLoading(false);
      }

      await fetchAll(address);

      if (!cancelled) {
        await subscribe(address);
        // Polling cobre SPL que não alteram saldo SOL (ex: receber USDT em ATA existente)
        startPolling(address);
        // Health check re-subscribe se o WebSocket cair silenciosamente
        startHealthCheck(address);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [walletAddress, networkProp]);

  // Re-subscribe ao WebSocket quando o app volta ao primeiro plano
  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const addr = addrRef.current || await resolveAddress();
        if (addr && mountedRef.current) {
          unsubscribe();
          await fetchAll(addr);
          await subscribe(addr);
          startPolling(addr);
          startHealthCheck(addr);
        }
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [resolveAddress, fetchAll, subscribe, startPolling, unsubscribe, startHealthCheck]);

  return { balances, dynamicTokens, isLoading, lastUpdated, refresh, error };
}

export default useRealtimeBalances;
