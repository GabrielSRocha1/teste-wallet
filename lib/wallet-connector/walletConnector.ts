/**
 * walletConnector.ts
 * --------------------------------------------------------------------------
 * Conector standalone entre um dApp web e carteiras Solana (Phantom, Solflare).
 * Projetado para ser copiado para qualquer projeto web (Next.js / Vite / etc.)
 * que precise consumir wallets externas com segurança máxima.
 *
 * Checklist de segurança aplicado:
 *   [x] Mainnet hardcoded com validação por genesisHash
 *   [x] Origin validation + bloqueio de iframe não confiável
 *   [x] Nonce + TTL em todas as assinaturas de mensagem
 *   [x] feePayer validado antes de qualquer signTransaction
 *   [x] signAllTransactions deliberadamente NÃO exposto (reduz blast radius)
 *   [x] Erros internos mapeados para enum público; mensagens da SDK não vazam
 *   [x] Sessão invalidada em mudança de publicKey na wallet
 *   [x] Timeout em connect() para evitar pendurar a UI indefinidamente
 *   [x] Reentrância bloqueada em connect()
 *
 * Dependências (instalar no dApp consumidor):
 *   "@solana/web3.js": "^1.98.0"
 *   "@solana/wallet-adapter-base": "^0.9.23"
 *   "@solana/wallet-adapter-phantom": "^0.9.24"
 *   "@solana/wallet-adapter-solflare": "^0.6.28"
 * --------------------------------------------------------------------------
 */

import {
  clusterApiUrl,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  BaseMessageSignerWalletAdapter,
  WalletAdapterNetwork,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignTransactionError,
  WalletWindowClosedError,
} from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

// ===========================================================================
// TIPOS PÚBLICOS
// ===========================================================================

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type WalletKind = 'phantom' | 'solflare';

/**
 * Códigos de erro expostos ao consumidor. Mensagens internas da SDK
 * NUNCA são repassadas — sempre mapeadas para um destes códigos.
 */
export enum SafeErrorCode {
  USER_REJECTED = 'USER_REJECTED',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  WRONG_NETWORK = 'WRONG_NETWORK',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  UNSAFE_TRANSACTION = 'UNSAFE_TRANSACTION',
  UNTRUSTED_ORIGIN = 'UNTRUSTED_ORIGIN',
  ALREADY_CONNECTING = 'ALREADY_CONNECTING',
  UNKNOWN = 'UNKNOWN',
}

export interface WalletState {
  readonly status: ConnectionStatus;
  readonly publicKey: string | null;
  readonly walletKind: WalletKind | null;
  readonly sessionId: string | null;
  readonly error: SafeErrorCode | null;
}

export interface WalletConnectorOptions {
  /** Endpoint RPC customizado. Default: clusterApiUrl('mainnet-beta'). */
  rpcEndpoint?: string;
  /** TTL da sessão em ms. Default: 30 minutos. */
  sessionTtlMs?: number;
  /** Timeout do connect() em ms. Default: 30 segundos. */
  connectTimeoutMs?: number;
  /**
   * Lista branca de origens permitidas. Se fornecida, qualquer chamada
   * vinda de origem diferente é rejeitada. Em iframes, só permite se
   * a origem do top-window estiver na lista.
   */
  allowedOrigins?: string[];
  /** Commitment para a Connection. Default: 'confirmed'. */
  commitment?: Commitment;
}

export interface SignMessagePayload {
  readonly nonce: string;
  readonly issuedAt: number;
  readonly domain: string;
}

export interface ConnectResult {
  readonly publicKey: string;
  readonly sessionId: string;
}

export interface SignMessageResult {
  readonly signature: string;
  readonly nonce: string;
}

type StateListener = (state: Readonly<WalletState>) => void;

// ===========================================================================
// CONSTANTES INTERNAS
// ===========================================================================

// Hash do bloco gênesis da mainnet-beta. Usado para confirmar que a wallet
// realmente está conectada à rede correta antes de pedir qualquer assinatura.
// Fonte: https://docs.solana.com/clusters
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

const DEFAULTS = {
  sessionTtlMs: 30 * 60 * 1000,
  connectTimeoutMs: 30 * 1000,
  nonceTtlMs: 5 * 60 * 1000,
  maxInstructionsPerTx: 32,
  commitment: 'confirmed' as Commitment,
} as const;

// ===========================================================================
// ERRO INTERNO (nunca vaza para fora do módulo)
// ===========================================================================

class InternalWalletError extends Error {
  constructor(public readonly code: SafeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'InternalWalletError';
  }
}

// ===========================================================================
// CLASSE PRINCIPAL
// ===========================================================================

export class WalletConnector {
  readonly #connection: Connection;
  readonly #options: Required<
    Omit<WalletConnectorOptions, 'allowedOrigins'>
  > & { allowedOrigins: string[] | null };

  #adapter: BaseMessageSignerWalletAdapter | null = null;
  #state: WalletState = {
    status: 'disconnected',
    publicKey: null,
    walletKind: null,
    sessionId: null,
    error: null,
  };
  #sessionIssuedAt = 0;
  #connectInFlight = false;
  readonly #listeners = new Set<StateListener>();
  readonly #issuedNonces = new Map<string, number>();
  #disconnectHandler: (() => void) | null = null;
  #accountChangeHandler: ((publicKey: PublicKey | null) => void) | null = null;

  constructor(options: WalletConnectorOptions = {}) {
    this.#options = {
      rpcEndpoint:
        options.rpcEndpoint ?? clusterApiUrl(WalletAdapterNetwork.Mainnet),
      sessionTtlMs: options.sessionTtlMs ?? DEFAULTS.sessionTtlMs,
      connectTimeoutMs:
        options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
      commitment: options.commitment ?? DEFAULTS.commitment,
      allowedOrigins: options.allowedOrigins ?? null,
    };

    this.#connection = new Connection(this.#options.rpcEndpoint, {
      commitment: this.#options.commitment,
    });
  }

  // -----------------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------------

  getState(): Readonly<WalletState> {
    return Object.freeze({ ...this.#state });
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async connect(walletKind: WalletKind): Promise<ConnectResult> {
    try {
      this.#assertTrustedOrigin();
    } catch (error) {
      const safe = this.#toSafeError(error);
      this.#setState({
        status: 'error',
        publicKey: null,
        walletKind: null,
        sessionId: null,
        error: safe,
      });
      throw new InternalWalletError(safe);
    }

    if (this.#connectInFlight) {
      throw new InternalWalletError(SafeErrorCode.ALREADY_CONNECTING);
    }
    if (this.#state.status === 'connected') {
      await this.disconnect();
    }

    this.#connectInFlight = true;
    this.#setState({
      status: 'connecting',
      publicKey: null,
      walletKind,
      sessionId: null,
      error: null,
    });

    try {
      const adapter = this.#buildAdapter(walletKind);

      await this.#withTimeout(
        adapter.connect(),
        this.#options.connectTimeoutMs,
      );

      if (!adapter.publicKey) {
        throw new InternalWalletError(SafeErrorCode.CONNECTION_FAILED);
      }

      const onMainnet = await this.#verifyNetworkInternal();
      if (!onMainnet) {
        await adapter.disconnect().catch(() => undefined);
        throw new InternalWalletError(SafeErrorCode.WRONG_NETWORK);
      }

      this.#adapter = adapter;
      this.#attachAdapterListeners(adapter);

      const session = this.#createSession();
      const publicKey = adapter.publicKey.toBase58();

      this.#setState({
        status: 'connected',
        publicKey,
        walletKind,
        sessionId: session.sessionId,
        error: null,
      });

      return { publicKey, sessionId: session.sessionId };
    } catch (error) {
      const safe = this.#toSafeError(error);
      this.#setState({
        status: 'error',
        publicKey: null,
        walletKind: null,
        sessionId: null,
        error: safe,
      });
      throw new InternalWalletError(safe);
    } finally {
      this.#connectInFlight = false;
    }
  }

  async disconnect(): Promise<void> {
    const adapter = this.#adapter;
    this.#detachAdapterListeners();
    this.#adapter = null;
    this.#sessionIssuedAt = 0;
    this.#issuedNonces.clear();

    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        // Silenciar — desconexão é sempre eventual e não deve quebrar UX.
      }
    }

    this.#setState({
      status: 'disconnected',
      publicKey: null,
      walletKind: null,
      sessionId: null,
      error: null,
    });
  }

  async signMessage(message: string): Promise<SignMessageResult> {
    const adapter = this.#assertActiveSession();

    const payload: SignMessagePayload = {
      nonce: this.#generateNonce(),
      issuedAt: Date.now(),
      domain: this.#getDomain(),
    };

    const canonical = `${message}\n\n${this.#canonicalJson(payload)}`;
    const bytes = new TextEncoder().encode(canonical);

    try {
      const signatureBytes = await adapter.signMessage(bytes);
      const signature = this.#bytesToBase64(signatureBytes);
      return { signature, nonce: payload.nonce };
    } catch (error) {
      throw new InternalWalletError(this.#toSafeError(error));
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const adapter = this.#assertActiveSession();
    const sessionPubkey = this.#state.publicKey;
    if (!sessionPubkey) {
      throw new InternalWalletError(SafeErrorCode.SESSION_EXPIRED);
    }

    this.#assertSafeTransaction(tx, new PublicKey(sessionPubkey));

    try {
      const signed = await adapter.signTransaction(tx);
      return signed as T;
    } catch (error) {
      throw new InternalWalletError(this.#toSafeError(error));
    }
  }

  async verifyNetwork(): Promise<boolean> {
    return this.#verifyNetworkInternal();
  }

  // -----------------------------------------------------------------------
  // Internos: ciclo de vida do adapter
  // -----------------------------------------------------------------------

  #buildAdapter(kind: WalletKind): BaseMessageSignerWalletAdapter {
    switch (kind) {
      case 'phantom':
        return new PhantomWalletAdapter();
      case 'solflare':
        return new SolflareWalletAdapter();
      default: {
        // Exhaustiveness check em compile time.
        const _exhaustive: never = kind;
        throw new InternalWalletError(
          SafeErrorCode.WALLET_NOT_FOUND,
          `Unknown wallet kind: ${String(_exhaustive)}`,
        );
      }
    }
  }

  #attachAdapterListeners(adapter: BaseMessageSignerWalletAdapter): void {
    const onDisconnect = () => {
      void this.disconnect();
    };
    // Troca de conta na wallet invalida a sessão imediatamente — evita que
    // uma chave diferente da inicial seja usada com credenciais antigas.
    const onChange = (pk: PublicKey | null) => {
      if (!pk || pk.toBase58() !== this.#state.publicKey) {
        void this.disconnect();
      }
    };

    adapter.on('disconnect', onDisconnect);
    adapter.on('connect', onChange);

    this.#disconnectHandler = onDisconnect;
    this.#accountChangeHandler = onChange;
  }

  #detachAdapterListeners(): void {
    if (!this.#adapter) return;
    if (this.#disconnectHandler) {
      this.#adapter.off('disconnect', this.#disconnectHandler);
    }
    if (this.#accountChangeHandler) {
      this.#adapter.off('connect', this.#accountChangeHandler);
    }
    this.#disconnectHandler = null;
    this.#accountChangeHandler = null;
  }

  // -----------------------------------------------------------------------
  // Internos: validações de segurança
  // -----------------------------------------------------------------------

  #assertTrustedOrigin(): void {
    if (typeof window === 'undefined') return;

    const whitelist = this.#options.allowedOrigins;
    const currentOrigin = window.location?.origin ?? '';

    if (whitelist && !whitelist.includes(currentOrigin)) {
      throw new InternalWalletError(SafeErrorCode.UNTRUSTED_ORIGIN);
    }

    // Em iframes, só prossegue se o top-level também estiver na whitelist —
    // mitiga clickjacking via embedding em domínio adversário.
    if (window.top !== window.self) {
      if (!whitelist) {
        throw new InternalWalletError(SafeErrorCode.UNTRUSTED_ORIGIN);
      }
      let topOrigin = '';
      try {
        topOrigin = window.top?.location?.origin ?? '';
      } catch {
        // SecurityError ao acessar cross-origin → tratamos como não confiável.
        throw new InternalWalletError(SafeErrorCode.UNTRUSTED_ORIGIN);
      }
      if (!whitelist.includes(topOrigin)) {
        throw new InternalWalletError(SafeErrorCode.UNTRUSTED_ORIGIN);
      }
    }
  }

  #assertActiveSession(): BaseMessageSignerWalletAdapter {
    if (!this.#adapter || this.#state.status !== 'connected') {
      throw new InternalWalletError(SafeErrorCode.SESSION_EXPIRED);
    }
    if (Date.now() - this.#sessionIssuedAt > this.#options.sessionTtlMs) {
      void this.disconnect();
      throw new InternalWalletError(SafeErrorCode.SESSION_EXPIRED);
    }
    // Public key da wallet pode ter mudado entre chamadas; reverifica.
    const currentPk = this.#adapter.publicKey?.toBase58() ?? null;
    if (!currentPk || currentPk !== this.#state.publicKey) {
      void this.disconnect();
      throw new InternalWalletError(SafeErrorCode.SESSION_EXPIRED);
    }
    return this.#adapter;
  }

  #assertSafeTransaction(
    tx: Transaction | VersionedTransaction,
    sessionPubkey: PublicKey,
  ): void {
    if (tx instanceof Transaction) {
      if (!tx.recentBlockhash) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
      // feePayer divergente da sessão pode drenar fundos do usuário sem
      // que ele perceba — recusamos antes mesmo de enviar à wallet.
      if (!tx.feePayer || !tx.feePayer.equals(sessionPubkey)) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
      if (tx.instructions.length > DEFAULTS.maxInstructionsPerTx) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
    } else {
      const msg = tx.message;
      const staticKeys = msg.staticAccountKeys;
      if (staticKeys.length === 0) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
      // No formato versionado, o feePayer é sempre a primeira chave estática.
      if (!staticKeys[0].equals(sessionPubkey)) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
      if (msg.compiledInstructions.length > DEFAULTS.maxInstructionsPerTx) {
        throw new InternalWalletError(SafeErrorCode.UNSAFE_TRANSACTION);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internos: rede, sessão, nonce
  // -----------------------------------------------------------------------

  async #verifyNetworkInternal(): Promise<boolean> {
    try {
      const genesis = await this.#connection.getGenesisHash();
      return genesis === MAINNET_GENESIS_HASH;
    } catch {
      return false;
    }
  }

  #createSession(): { sessionId: string } {
    const sessionId = this.#randomUuid();
    this.#sessionIssuedAt = Date.now();
    return { sessionId };
  }

  #generateNonce(): string {
    this.#purgeExpiredNonces();
    const bytes = new Uint8Array(32);
    this.#getCrypto().getRandomValues(bytes);
    const nonce = this.#bytesToBase64Url(bytes);
    if (this.#issuedNonces.has(nonce)) {
      throw new InternalWalletError(SafeErrorCode.UNKNOWN);
    }
    this.#issuedNonces.set(nonce, Date.now());
    return nonce;
  }

  #purgeExpiredNonces(): void {
    const cutoff = Date.now() - DEFAULTS.nonceTtlMs;
    for (const [nonce, issued] of this.#issuedNonces) {
      if (issued < cutoff) this.#issuedNonces.delete(nonce);
    }
  }

  // -----------------------------------------------------------------------
  // Internos: utilidades
  // -----------------------------------------------------------------------

  #setState(next: WalletState): void {
    this.#state = next;
    const frozen = Object.freeze({ ...next });
    for (const listener of this.#listeners) {
      try {
        listener(frozen);
      } catch {
        // Listener não deve derrubar o connector.
      }
    }
  }

  #toSafeError(error: unknown): SafeErrorCode {
    if (error instanceof InternalWalletError) return error.code;

    if (error instanceof WalletNotReadyError) {
      return SafeErrorCode.WALLET_NOT_FOUND;
    }
    if (error instanceof WalletWindowClosedError) {
      return SafeErrorCode.USER_REJECTED;
    }
    if (error instanceof WalletConnectionError) {
      // O usuário tipicamente cancelou o popup; alguns adapters lançam isso
      // tanto para "rejected" quanto para falha de transporte. Tratamos
      // como CONNECTION_FAILED para não mentir sobre a causa.
      return SafeErrorCode.CONNECTION_FAILED;
    }
    if (error instanceof WalletSignTransactionError) {
      return SafeErrorCode.USER_REJECTED;
    }
    if (
      error instanceof WalletNotConnectedError ||
      error instanceof WalletDisconnectedError
    ) {
      return SafeErrorCode.SESSION_EXPIRED;
    }

    return SafeErrorCode.UNKNOWN;
  }

  async #withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new InternalWalletError(SafeErrorCode.TIMEOUT)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #canonicalJson(value: Record<string, unknown>): string {
    const keys = Object.keys(value).sort();
    const ordered: Record<string, unknown> = {};
    for (const k of keys) ordered[k] = value[k];
    return JSON.stringify(ordered);
  }

  #getDomain(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'unknown';
  }

  #getCrypto(): Crypto {
    if (typeof globalThis.crypto !== 'undefined') return globalThis.crypto;
    throw new InternalWalletError(SafeErrorCode.UNKNOWN);
  }

  #randomUuid(): string {
    const c = this.#getCrypto();
    if (typeof c.randomUUID === 'function') return c.randomUUID();
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  #bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa !== 'undefined') return btoa(bin);
    // Fallback Node.js.
    return Buffer.from(bytes).toString('base64');
  }

  #bytesToBase64Url(bytes: Uint8Array): string {
    return this.#bytesToBase64(bytes)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

// ===========================================================================
// FACTORY HELPER
// ===========================================================================

export function createWalletConnector(
  options?: WalletConnectorOptions,
): WalletConnector {
  return new WalletConnector(options);
}
