/**
 * VerumDeepLinkAdapter — Adapter Solana que funciona via deep links
 * 
 * Este adapter permite que dApps padrão (@solana/wallet-adapter-react)
 * se conectem à Verum Wallet através de deep links, sem necessidade
 * de extensão de navegador injetada.
 */

import { 
  Transaction, 
  VersionedTransaction, 
  PublicKey, 
  Connection,
  TransactionSignature 
} from '@solana/web3.js';
import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  WalletConfigError,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletNotConnectedError,
  WalletSignTransactionError,
  WalletSignMessageError,
  WalletSendTransactionError,
  SendTransactionOptions,
  SupportedTransactionVersions,
  isVersionedTransaction,
} from '@solana/wallet-adapter-base';
import { connectionService, ConnectedSession, Permission } from './connectionService';

export const VerumDeepLinkWalletName = 'Verum Wallet' as WalletName<'Verum Wallet'>;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: any;
}

export class VerumDeepLinkAdapter extends BaseMessageSignerWalletAdapter {
  name = VerumDeepLinkWalletName;
  url = 'https://verumcrypto.com';
  icon = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzBBMEEwQSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI0M5QTg0QyI+VjwvdGV4dD48L3N2Zz4=';
  supportedTransactionVersions: SupportedTransactionVersions = new Set(['legacy', 0]);

  private _connecting: boolean = false;
  private _publicKey: PublicKey | null = null;
  private _session: ConnectedSession | null = null;
  private _readyState: WalletReadyState = WalletReadyState.Loadable;
  
  // Fila de requests pendentes aguardando resposta do app
  private _pendingRequests: Map<string, PendingRequest> = new Map();
  private _requestCounter: number = 0;

  constructor() {
    super();

    // Toda a lógica abaixo depende do DOM real (window.location + addEventListener).
    // No RN, `window` é um stub global sem location nem dispatcher de eventos —
    // o fluxo nativo da Verum acontece via DeepLinkHandler/ConnectionContext.
    const w: any = typeof window !== 'undefined' ? window : undefined;
    const hasBrowserDOM =
      !!w &&
      !!w.location &&
      typeof w.location.origin === 'string' &&
      typeof w.addEventListener === 'function';

    if (!hasBrowserDOM) return;

    this._checkExistingSession();
    w.addEventListener('message', this._handleWindowMessage);
    this._checkUrlForCallback();
  }

  private async _checkExistingSession(): Promise<void> {
    // Verifica todas as sessões salvas
    const sessions = await connectionService.getSessions();
    // Procura sessão ativa para o origin atual
    const currentOrigin = window.location.origin;
    const session = sessions.find(s => s.origin === currentOrigin);
    
    if (session) {
      this._session = session;
      this._publicKey = new PublicKey(session.publicKey);
      this._readyState = WalletReadyState.Installed;
      this.emit('connect', this._publicKey);
    }
  }

  private _checkUrlForCallback(): void {
    const url = new URL(window.location.href);
    
    // Verifica se é callback de conexão aprovada
    const session = url.searchParams.get('verum_session');
    const approved = url.searchParams.get('verum_approved');
    const publicKey = url.searchParams.get('verum_publicKey');
    const error = url.searchParams.get('verum_error');
    
    if (session) {
      if (approved === 'true' && publicKey) {
        this._handleConnectionApproved(session, publicKey);
      } else if (error) {
        this._handleConnectionRejected(session, error);
      }
      
      // Limpa URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    // Verifica callback de assinatura
    const signResult = url.searchParams.get('verum_sign_result');
    const signError = url.searchParams.get('verum_sign_error');
    const requestId = url.searchParams.get('verum_request_id');
    
    if (requestId) {
      if (signResult) {
        this._resolvePendingRequest(requestId, Buffer.from(signResult, 'base64'));
      } else if (signError) {
        this._rejectPendingRequest(requestId, new Error(signError));
      }
      
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  private _handleWindowMessage = (event: MessageEvent): void => {
    // Aceita mensagens do app Verum (via ReactNativeWebView ou postMessage)
    if (event.origin !== 'https://verumcrypto.com' && !event.data?.verum) return;
    
    const { type, payload, requestId } = event.data;
    
    switch (type) {
      case 'VERUM_CONNECTION_APPROVED':
        this._handleConnectionApproved(payload.session, payload.publicKey);
        break;
      case 'VERUM_CONNECTION_REJECTED':
        this._handleConnectionRejected(payload.session, payload.error);
        break;
      case 'VERUM_SIGN_RESPONSE':
        this._resolvePendingRequest(requestId, Buffer.from(payload.signature, 'base64'));
        break;
      case 'VERUM_SIGN_ERROR':
        this._rejectPendingRequest(requestId, new Error(payload.error));
        break;
    }
  };

  private _handleConnectionApproved(sessionId: string, publicKeyStr: string): void {
    const publicKey = new PublicKey(publicKeyStr);
    this._publicKey = publicKey;
    this._readyState = WalletReadyState.Installed;
    
    // Salva sessão
    const newSession: ConnectedSession = {
      id: sessionId,
      name: 'Verum Wallet',
      origin: window.location.origin,
      permissions: ['publicKey', 'signTransaction', 'signMessage'],
      connectedAt: Date.now(),
      publicKey: publicKeyStr,
      network: 'mainnet-beta',
    };
    
    connectionService.saveSession(newSession).then(() => {
      this._session = newSession;
    });
    
    this.emit('connect', publicKey);
  }

  private _handleConnectionRejected(sessionId: string, error: string): void {
    this._connecting = false;
    this.emit('error', new WalletConnectionError(error));
  }

  private _generateRequestId(): string {
    return `req_${++this._requestCounter}_${Date.now()}`;
  }

  private _createPendingRequest<T>(timeoutMs: number = 60000): { requestId: string; promise: Promise<T> } {
    const requestId = this._generateRequestId();
    
    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);
      
      this._pendingRequests.set(requestId, { resolve, reject, timeout });
    });
    
    return { requestId, promise };
  }

  private _resolvePendingRequest(requestId: string, result: any): void {
    const pending = this._pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(result);
      this._pendingRequests.delete(requestId);
    }
  }

  private _rejectPendingRequest(requestId: string, error: any): void {
    const pending = this._pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this._pendingRequests.delete(requestId);
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return !!this._publicKey && !!this._session;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async autoConnect(): Promise<void> {
    if (this._session) {
      await this.connect();
    }
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      
      this._connecting = true;

      // Se já tem sessão, apenas reconecta
      if (this._session) {
        this._publicKey = new PublicKey(this._session.publicKey);
        this.emit('connect', this._publicKey);
        this._connecting = false;
        return;
      }

      // Gera session ID
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Constrói deep link para o app Verum
      const params = new URLSearchParams({
        session: sessionId,
        name: document.title || 'dApp',
        origin: window.location.origin,
        icon: `${window.location.origin}/favicon.ico`,
        permissions: 'publicKey,signTransaction,signMessage',
        redirect_link: `${window.location.origin}?verum_session=${sessionId}&verum_approved=true&verum_publicKey={publicKey}`,
        cluster: 'mainnet-beta',
      });

      const deepLink = `verumwallet://connect?${params.toString()}`;
      
      // Detecta mobile
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobile) {
        // Redireciona para o app
        window.location.href = deepLink;
        
        // Fallback: se não tiver o app, abre loja após delay
        setTimeout(() => {
          if (document.hidden) return; // App abriu
          window.location.href = 'https://verumcrypto.com/download';
        }, 2000);
      } else {
        // Desktop: abre modal QR code ou redireciona para web app
        const webAppUrl = `https://app.verumcrypto.com/connect?${params.toString()}`;
        window.open(webAppUrl, 'verum-connect', 'width=400,height=600');
      }

      // Aguarda resposta via postMessage ou URL callback
      // O resto é tratado pelos handlers de evento
      
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this._session) {
      await connectionService.revokeSession(this._session.id);
      this._session = null;
    }
    this._publicKey = null;
    this._readyState = WalletReadyState.Loadable;
    this.emit('disconnect');
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (!this.connected) throw new WalletNotConnectedError();
    
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    const { requestId, promise } = this._createPendingRequest<Buffer>();
    
    const params = new URLSearchParams({
      action: 'signTransaction',
      data: Buffer.from(serialized).toString('base64'),
      origin: window.location.origin,
      session: this._session!.id,
      request_id: requestId,
      redirect_link: `${window.location.origin}?verum_request_id=${requestId}&verum_sign_result={result}`,
    });

    // Abre app para assinar
    window.location.href = `verumwallet://sign?${params.toString()}`;
    
    const signature = await promise;
    
    // Reconstrói transação assinada
    // Nota: Implementação simplificada - na prática precisa reconstruir a transação
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    return Promise.all(transactions.map(tx => this.signTransaction(tx)));
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.connected) throw new WalletNotConnectedError();
    
    const { requestId, promise } = this._createPendingRequest<Buffer>();
    
    const params = new URLSearchParams({
      action: 'signMessage',
      data: Buffer.from(message).toString('base64'),
      origin: window.location.origin,
      session: this._session!.id,
      request_id: requestId,
      redirect_link: `${window.location.origin}?verum_request_id=${requestId}&verum_sign_result={result}`,
    });

    window.location.href = `verumwallet://sign?${params.toString()}`;
    
    return await promise;
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options: SendTransactionOptions = {}
  ): Promise<TransactionSignature> {
    // Assina a transação
    const signed = await this.signTransaction(transaction);
    
    // Envia para a rede
    const rawTransaction = signed.serialize();
    const signature = await connection.sendRawTransaction(rawTransaction, {
      preflightCommitment: options.preflightCommitment,
      maxRetries: options.maxRetries,
      skipPreflight: options.skipPreflight,
    });
    
    return signature;
  }
}
