/**
 * ConnectionContext — Estado global de conexões de dApps.
 *
 * Guarda a solicitação pendente e as sessões aprovadas.
 * O _layout.tsx injeta a solicitação ao interceptar o deep link.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { connectionService } from '@/src/services/connectionService';
import type { ConnectedSession, ConnectionRequest, SignRequest } from '@/src/types/wallet.types';

interface ConnectionContextType {
  // Solicitação pendente (dApp pedindo conexão)
  pendingRequest: ConnectionRequest | null;
  setPendingRequest: (req: ConnectionRequest | null) => void;

  // Solicitação de assinatura pendente (via deep link)
  pendingSignRequest: SignRequest | null;
  setPendingSignRequest: (req: SignRequest | null) => void;

  // Sessões já aprovadas
  sessions: ConnectedSession[];
  reloadSessions: () => Promise<void>;
  revokeSession: (id: string) => Promise<void>;

  // NOVO: Aprovar conexão vinda do adapter
  approveSession: (request: ConnectionRequest, publicKey: string) => Promise<void>;
  
  // NOVO: Rejeitar conexão
  rejectSession: (request: ConnectionRequest) => Promise<void>;
  
  // NOVO: Verificar se tem sessão ativa para origin
  getSessionForOrigin: (origin: string) => Promise<ConnectedSession | null>;
}

const ConnectionContext = createContext<ConnectionContextType | null>(null);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [pendingRequest, setPendingRequest] = useState<ConnectionRequest | null>(null);
  const [pendingSignRequest, setPendingSignRequest] = useState<SignRequest | null>(null);
  const [sessions, setSessions] = useState<ConnectedSession[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    reloadSessions();
    return () => { mountedRef.current = false; };
  }, []);

  const reloadSessions = useCallback(async () => {
    const data = await connectionService.getSessions();
    if (mountedRef.current) setSessions(data);
  }, []);

  const revokeSession = useCallback(async (id: string) => {
    await connectionService.revokeSession(id);
    await reloadSessions();
  }, [reloadSessions]);

  const approveSession = useCallback(async (request: ConnectionRequest, publicKey: string) => {
    const session: ConnectedSession = {
      id: request.session,
      name: request.name,
      origin: request.origin,
      icon: request.icon,
      permissions: request.permissions,
      connectedAt: Date.now(),
      publicKey,
      network: request.cluster || 'mainnet-beta',
    };
    
    await connectionService.saveSession(session);
    
    // Notifica o dApp via callback se existir.
    // (C3) Passa `request.origin` para validar cross-origin: callback DEVE
    // pertencer ao mesmo origin declarado pelo dApp na conexão. Caso contrário
    // o callback é rejeitado (sem chamada de rede).
    if (request.callbackUrl) {
      await connectionService.notifyApproved(
        request.callbackUrl,
        {
          publicKey,
          network: session.network,
          session: request.session,
          permissions: request.permissions,
        },
        request.origin,
      );
    }

    await reloadSessions();
  }, [reloadSessions]);

  const rejectSession = useCallback(async (request: ConnectionRequest) => {
    if (request.callbackUrl) {
      // (C3) Idem notifyApproved: valida cross-origin antes de notificar.
      await connectionService.notifyRejected(request.callbackUrl, request.session, request.origin);
    }
    setPendingRequest(null);
  }, []);

  const getSessionForOrigin = useCallback(async (origin: string) => {
    return connectionService.getSessionByOrigin(origin);
  }, []);

  return (
    <ConnectionContext.Provider value={{
      pendingRequest, setPendingRequest,
      pendingSignRequest, setPendingSignRequest,
      sessions, reloadSessions, revokeSession,
      approveSession, rejectSession, getSessionForOrigin
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection deve ser usado dentro de ConnectionProvider');
  return ctx;
}
