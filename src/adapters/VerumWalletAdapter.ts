import { Transaction, VersionedTransaction, PublicKey, Connection, TransactionSignature } from '@solana/web3.js';
import type { WalletAdapterNetwork, WalletName, SendTransactionOptions, SupportedTransactionVersions } from '@solana/wallet-adapter-base';
import {
  BaseMessageSignerWalletAdapter,
  WalletConfigError,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletDisconnectionError,
  WalletError,
  WalletLoadError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  isVersionedTransaction,
} from '@solana/wallet-adapter-base';

const isMobileAndRedirectable = () => {
  return typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
};

const scopePollingDetectionStrategy = (detect: () => boolean) => {
  if (typeof window === 'undefined') return;
  const interval = setInterval(() => {
    if (detect()) clearInterval(interval);
  }, 1000);
};

// Define a interface baseada no provider que a Verum injeta no window
interface VerumProvider {
  isVerum?: boolean;
  publicKey?: { toBytes(): Uint8Array };
  connected?: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signAndSendTransaction<T extends Transaction | VersionedTransaction>(transaction: T, options?: SendTransactionOptions): Promise<{ signature: string } | string>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  on(event: string, callback: Function): void;
  off(event: string, callback: Function): void;
}

declare global {
  interface Window {
    verum?: VerumProvider;
    ReactNativeWebView?: unknown;
  }
}

export interface VerumWalletAdapterConfig {
  network?: WalletAdapterNetwork;
}

export const VerumWalletName = 'Verum' as WalletName<'Verum'>;

export class VerumWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = VerumWalletName;
  url = 'https://verumcrypto.com';
  // Ícone da Verum formatado como Base64 (Mantido do anterior)
  icon = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzBBMEEwQSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI0M5QTg0QyI+Vjwvc3RleHQ+PC9zdmc+';
  supportedTransactionVersions: SupportedTransactionVersions = new Set(['legacy', 0]);

  private _connecting: boolean;
  private _wallet: VerumProvider | null;
  private _publicKey: PublicKey | null;
  private _config: VerumWalletAdapterConfig;
  private _readyState: WalletReadyState =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? WalletReadyState.Unsupported
      : WalletReadyState.Loadable;

  constructor(config: VerumWalletAdapterConfig = {}) {
    super();
    this._connecting = false;
    this._publicKey = null;
    this._wallet = null;
    this._config = config;

    if (this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        if (window.verum?.isVerum || window.ReactNativeWebView) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  get connected() {
    return !!this._wallet?.connected;
  }

  get readyState() {
    return this._readyState;
  }

  async autoConnect(): Promise<void> {
    // Skip autoconnect in the Loadable state on iOS
    // We can't redirect to a universal link without user input
    if (!(this.readyState === WalletReadyState.Loadable && isMobileAndRedirectable())) {
      await this.connect();
    }
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (this._readyState !== WalletReadyState.Loadable && this._readyState !== WalletReadyState.Installed)
        throw new WalletNotReadyError();

      // Redireciona para o Deep Link da Verum em navegação normal de mobile
      if (this.readyState === WalletReadyState.Loadable && isMobileAndRedirectable()) {
        const url = encodeURIComponent(window.location.href);
        const ref = encodeURIComponent(window.location.origin);
        // Utilizando a estrutura de Deep Link da VerumCrypto
        window.location.href = `https://verumcrypto.com/ul/v1/browse/${url}?ref=${ref}`;
        return;
      }

      // Garante que a injeção local já aconteceu (evita import dinâmico de SDK externo)
      let wallet: VerumProvider;
      try {
        if (!window.verum) {
          throw new WalletLoadError("Verum Provider não encontrado no ambiente.");
        }
        wallet = window.verum;
      } catch (error: any) {
        throw new WalletConfigError(error?.message, error);
      }

      this._connecting = true;

      if (!wallet.connected) {
        try {
          await wallet.connect();
        } catch (error: any) {
          throw new WalletConnectionError(error?.message, error);
        }
      }

      if (!wallet.publicKey) throw new WalletConnectionError();

      let publicKey: PublicKey;
      try {
        publicKey = new PublicKey(wallet.publicKey.toBytes());
      } catch (error: any) {
        throw new WalletPublicKeyError(error?.message, error);
      }

      // Registra os listeners se o provider suportá-los nativamente
      if (typeof wallet.on === 'function') {
        wallet.on('disconnect', this._disconnected);
        wallet.on('accountChanged', this._accountChanged);
      }

      this._wallet = wallet;
      this._publicKey = publicKey;

      this.emit('connect', publicKey);
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      if (typeof wallet.off === 'function') {
        wallet.off('disconnect', this._disconnected);
        wallet.off('accountChanged', this._accountChanged);
      }

      this._wallet = null;
      this._publicKey = null;

      try {
        await wallet.disconnect();
      } catch (error: any) {
        this.emit('error', new WalletDisconnectionError(error?.message, error));
      }
    }

    this.emit('disconnect');
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options: SendTransactionOptions = {}
  ): Promise<TransactionSignature> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const { signers, ...sendOptions } = options;

        if (isVersionedTransaction(transaction)) {
          signers?.length && transaction.sign(signers);
        } else {
          transaction = (await this.prepareTransaction(transaction, connection, sendOptions));
          signers?.length && transaction.partialSign(...signers);
        }

        sendOptions.preflightCommitment = sendOptions.preflightCommitment || connection.commitment;

        const result = await wallet.signAndSendTransaction(transaction, sendOptions);
        // Conforme a implementação do Provider Injetado, pode retornar a String ou { signature: string }
        return typeof result === 'string' ? result : (result as any).signature;
      } catch (error: any) {
        if (error instanceof WalletError) throw error;
        throw new WalletSendTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return ((await wallet.signTransaction(transaction)) as T) || transaction;
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return ((await wallet.signAllTransactions(transactions)) as T[]) || transactions;
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const result = await wallet.signMessage(message, 'utf8');
        if (result instanceof Uint8Array) return result;
        return (result as { signature: Uint8Array }).signature;
      } catch (error: any) {
        throw new WalletSignMessageError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  private _disconnected = () => {
    const wallet = this._wallet;
    if (wallet) {
      if (typeof wallet.off === 'function') wallet.off('disconnect', this._disconnected);

      this._wallet = null;
      this._publicKey = null;

      this.emit('error', new WalletDisconnectedError());
      this.emit('disconnect');
    }
  };

  private _accountChanged = (newPublicKey?: PublicKey) => {
    if (!newPublicKey) return;

    const publicKey = this._publicKey;
    if (!publicKey) return;

    try {
      newPublicKey = new PublicKey(newPublicKey.toBytes());
    } catch (error: any) {
      this.emit('error', new WalletPublicKeyError(error?.message, error));
      return;
    }

    if (publicKey.equals(newPublicKey)) return;

    this._publicKey = newPublicKey;
    this.emit('connect', newPublicKey);
  };
}
