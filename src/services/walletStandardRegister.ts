/**
 * WalletStandardRegister — Registra a Verum Wallet no Wallet Standard global.
 *
 * Isso permite que qualquer dApp que use @solana/wallet-adapter-react
 * detecte a Verum Wallet automaticamente na lista de wallets disponíveis,
 * sem que o dApp precise importar nosso adapter manualmente.
 *
 * O registro acontece via window.navigator.wallets (Wallet Standard API).
 *
 * Segurança:
 *  - Nunca expõe chave privada
 *  - Todas as assinaturas são delegadas ao provider nativo (window.verum)
 *  - Funciona APENAS quando window.verum está disponível (WebView / extensão)
 *
 * Referência: https://github.com/wallet-standard/wallet-standard
 */

import type { Wallet, WalletAccount } from '@wallet-standard/base';

// ─── Constantes ──────────────────────────────────────────────────────────────

const VERUM_WALLET_NAME = 'Verum Wallet';

const VERUM_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzBBMEEwQSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI0M5QTg0QyI+VjwvdGV4dD48L3N2Zz4=';

const SOLANA_MAINNET = 'solana:mainnet';
const SOLANA_DEVNET  = 'solana:devnet';

// ─── Features (Wallet Standard spec) ────────────────────────────────────────

const STANDARD_CONNECT    = 'standard:connect';
const STANDARD_DISCONNECT = 'standard:disconnect';
const STANDARD_EVENTS     = 'standard:events';
const SOLANA_SIGN_TX      = 'solana:signTransaction';
const SOLANA_SIGN_MSG     = 'solana:signMessage';
const SOLANA_SIGN_AND_SEND = 'solana:signAndSendTransaction';

// ─── Tipos internos ─────────────────────────────────────────────────────────

type EventType = 'change';
type EventCallback = (properties: { accounts: WalletAccount[] }) => void;

// ─── Wallet Standard Implementation ─────────────────────────────────────────

class VerumWalletStandard implements Wallet {
  readonly version = '1.0.0' as const;
  readonly name    = VERUM_WALLET_NAME;
  readonly icon    = VERUM_ICON as `data:image/svg+xml;base64,${string}`;
  readonly chains  = [SOLANA_MAINNET, SOLANA_DEVNET] as const;

  private _accounts: WalletAccount[] = [];
  private _listeners: Map<EventType, Set<EventCallback>> = new Map();

  get accounts(): readonly WalletAccount[] {
    return this._accounts;
  }

  get features(): Record<string, any> {
    return {
      [STANDARD_CONNECT]: {
        version: '1.0.0',
        connect: this._connect.bind(this),
      },
      [STANDARD_DISCONNECT]: {
        version: '1.0.0',
        disconnect: this._disconnect.bind(this),
      },
      [STANDARD_EVENTS]: {
        version: '1.0.0',
        on: this._on.bind(this),
      },
      [SOLANA_SIGN_TX]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: this._signTransaction.bind(this),
      },
      [SOLANA_SIGN_MSG]: {
        version: '1.0.0',
        signMessage: this._signMessage.bind(this),
      },
      [SOLANA_SIGN_AND_SEND]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: this._signAndSendTransaction.bind(this),
      },
    };
  }

  // ── connect ───────────────────────────────────────────────────────────────

  private async _connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> {
    const provider = this._getProvider();
    if (!provider) throw new Error('Verum Provider não encontrado.');

    if (!provider.connected) {
      await provider.connect(input?.silent ? { onlyIfTrusted: true } : undefined);
    }

    if (provider.publicKey) {
      const pubkeyStr = typeof provider.publicKey === 'string'
        ? provider.publicKey
        : provider.publicKey.toString();

      const account: WalletAccount = {
        address: pubkeyStr,
        publicKey: this._base58ToBytes(pubkeyStr),
        chains: [SOLANA_MAINNET],
        features: [
          STANDARD_CONNECT,
          STANDARD_DISCONNECT,
          SOLANA_SIGN_TX,
          SOLANA_SIGN_MSG,
          SOLANA_SIGN_AND_SEND,
        ],
      };

      this._accounts = [account];
      this._emit('change', { accounts: this._accounts });
    }

    return { accounts: this._accounts };
  }

  // ── disconnect ────────────────────────────────────────────────────────────

  private async _disconnect(): Promise<void> {
    const provider = this._getProvider();
    if (provider) {
      await provider.disconnect();
    }
    this._accounts = [];
    this._emit('change', { accounts: [] });
  }

  // ── signTransaction ───────────────────────────────────────────────────────

  private async _signTransaction(...inputs: any[]): Promise<any[]> {
    const provider = this._getProvider();
    if (!provider) throw new Error('Verum Provider não conectado.');

    const results = [];
    for (const input of inputs) {
      const tx = input.transaction;
      const signed = await provider.signTransaction(tx);
      results.push({ signedTransaction: signed });
    }
    return results;
  }

  // ── signMessage ───────────────────────────────────────────────────────────

  private async _signMessage(...inputs: any[]): Promise<any[]> {
    const provider = this._getProvider();
    if (!provider) throw new Error('Verum Provider não conectado.');

    const results = [];
    for (const input of inputs) {
      const sig = await provider.signMessage(input.message);
      const sigBytes = sig instanceof Uint8Array ? sig : sig.signature;
      results.push({ signedMessage: input.message, signature: sigBytes });
    }
    return results;
  }

  // ── signAndSendTransaction ────────────────────────────────────────────────

  private async _signAndSendTransaction(...inputs: any[]): Promise<any[]> {
    const provider = this._getProvider();
    if (!provider) throw new Error('Verum Provider não conectado.');

    const results = [];
    for (const input of inputs) {
      const result = await provider.signAndSendTransaction(input.transaction, input.options);
      const signature = typeof result === 'string' ? result : result.signature;
      results.push({ signature });
    }
    return results;
  }

  // ── events ────────────────────────────────────────────────────────────────

  private _on(event: EventType, listener: EventCallback): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);

    return () => {
      this._listeners.get(event)?.delete(listener);
    };
  }

  private _emit(event: EventType, data: { accounts: WalletAccount[] }): void {
    this._listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[VerumWalletStandard] Listener error:', e); }
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private _getProvider(): any {
    if (typeof window === 'undefined') return null;
    return (window as any).verum || (window as any).solana;
  }

  private _base58ToBytes(str: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const lookup: Record<string, number> = {};
    for (let i = 0; i < ALPHABET.length; i++) lookup[ALPHABET[i]] = i;
    const bytes: number[] = [0];
    for (let i = 0; i < str.length; i++) {
      let c = lookup[str[i]];
      if (c === undefined) throw new Error('Invalid base58 character');
      for (let j = 0; j < bytes.length; j++) {
        c += bytes[j] * 58;
        bytes[j] = c & 0xff;
        c >>= 8;
      }
      while (c > 0) {
        bytes.push(c & 0xff);
        c >>= 8;
      }
    }
    for (let i = 0; str[i] === '1' && i < str.length - 1; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }
}

// ─── Registro no Wallet Standard ────────────────────────────────────────────

/**
 * Registra a Verum Wallet no padrão navigator.wallets.
 * Deve ser chamado ANTES do carregamento dos dApps.
 *
 * Compatível com:
 *  - @wallet-standard/wallet (API padrão)
 *  - @solana/wallet-adapter-react (detecção automática)
 */
export function registerVerumWalletStandard(): void {
  if (typeof window === 'undefined') return;

  // Só registra se o provider estiver disponível
  const hasProvider = !!(window as any).verum || !!(window as any).ReactNativeWebView;
  if (!hasProvider) return;

  const wallet = new VerumWalletStandard();

  // Wallet Standard API: navigator.wallets.register()
  const nav = window.navigator as any;
  if (nav.wallets) {
    if (typeof nav.wallets.register === 'function') {
      nav.wallets.register(wallet);
      console.log('[VerumWalletStandard] Registrado via navigator.wallets.register()');
      return;
    }
  }

  // Fallback: WindowRegisterWalletEvent (usado pelo @wallet-standard/app)
  try {
    const registerEvent = new CustomEvent('wallet-standard:register-wallet', {
      detail: { register: (cb: (wallet: Wallet) => void) => cb(wallet) },
    });
    window.dispatchEvent(registerEvent);
    console.log('[VerumWalletStandard] Registrado via wallet-standard:register-wallet event');
  } catch (e) {
    console.warn('[VerumWalletStandard] Falha no registro:', e);
  }

  // Fallback 2: WindowAppReadyEvent listener
  window.addEventListener('wallet-standard:app-ready', (event: any) => {
    const register = event?.detail?.register;
    if (typeof register === 'function') {
      register(wallet);
      console.log('[VerumWalletStandard] Registrado via app-ready event');
    }
  });
}
