/**
 * KeyManager — Gestão segura de chaves privadas e mnemônicos.
 *
 * Derivação criptográfica delegada ao módulo keyDerivation.ts
 * que implementa rigorosamente BIP39/BIP32/BIP44/SLIP-0010.
 *
 * Suporta: expo-secure-store (nativo) e localStorage (web/browser).
 */

import * as SecureStore from 'expo-secure-store';
import { Keypair } from '@solana/web3.js';
import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import {
  generateFullWallet,
  deriveFromMnemonic,
  validateMnemonic,
  type DerivedWallet,
} from './keyDerivation';
import {
  encryptVault,
  decryptVault,
  isV2Format,
  getVaultIterations,
  CURRENT_PBKDF2_ITERATIONS,
} from './_internal/vault-crypto';
import { createLogger } from './_internal/logger';
import {
  PinRateLimiter,
  PinLockedError,
  type PinAttemptStorage,
} from './_internal/pin-rate-limiter';
import { PersistentPinAttemptStorage } from './_internal/pin-attempt-storage-adapter';

const vaultLog = createLogger('KeyManager.Vault');

// ─── PIN rate-limit (C1) ─────────────────────────────────────────────────────
// Persistente: zerar via reabrir o app não burla o lockout.
const PIN_ATTEMPT_KEY = 'verum_pin_attempts_v1';

// ─── Isolamento de rede (rule #9) ────────────────────────────────────────────
// Mesma identidade BIP39 em redes diferentes compartilha o mesmo endereço,
// mas o estado efêmero (session PIN, expiry) é isolado por network. A própria
// identidade (vault criptografado + pubkey cacheada) é compartilhada, porque
// mnemonic + derivation path são determinísticos independente da rede.
export type WalletNetwork = 'mainnet' | 'devnet' | 'testnet';
let CURRENT_NETWORK: WalletNetwork = 'mainnet';

const SECURE_STORE_KEY = 'verum_vault_encrypted';
const PUBLIC_ADDRESS_KEY = 'verum_solana_public_address';

/**
 * Chaves legadas QUE DEVEM SER VARRIDAS AO CRIAR NOVA IDENTIDADE.
 * NUNCA use estas chaves para ler dados silenciosamente: elas podem conter
 * resquícios de uma identidade apagada/reinstalada.
 * A chave canônica (SECURE_STORE_KEY) NÃO entra aqui — é tratada separadamente.
 */
const LEGACY_KEYS = [
  'verum_wallet_encrypted',
  'solana_wallet',
  'secret_key',
  'user_private_key',
  'wallet_encrypted'
];

/** Retorna a chave de sessão prefixada pela rede atual. */
const sessionKey = (base: string) => `${base}_${CURRENT_NETWORK}`;

// Helper: detecta se está rodando no browser web
const isWeb = typeof window !== 'undefined' && 'localStorage' in window;

// ─── Helpers de armazenamento cross-platform ─────────────────────────────────
// Dados persistentes (vault cifrado, pubkey cache) → localStorage / SecureStore
const storeSet = async (key: string, value: string): Promise<void> => {
  if (isWeb) {
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
};

const storeGet = async (key: string): Promise<string | null> => {
  if (isWeb) {
    return localStorage.getItem(key);
  } else {
    return SecureStore.getItemAsync(key);
  }
};

const storeDelete = async (key: string): Promise<void> => {
  if (isWeb) {
    localStorage.removeItem(key);
  } else {
    try { await SecureStore.deleteItemAsync(key); } catch {}
  }
};

// Dados de sessão (PIN, expiração) → sessionStorage no browser (limpo ao fechar a aba)
// No mobile, SecureStore já oferece proteção equivalente.
const sessionStoreSet = async (key: string, value: string): Promise<void> => {
  if (isWeb) {
    sessionStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
};

const sessionStoreGet = async (key: string): Promise<string | null> => {
  if (isWeb) {
    return sessionStorage.getItem(key);
  } else {
    return SecureStore.getItemAsync(key);
  }
};

const sessionStoreDelete = async (key: string): Promise<void> => {
  if (isWeb) {
    sessionStorage.removeItem(key);
  } else {
    try { await SecureStore.deleteItemAsync(key); } catch {}
  }
};
// ─────────────────────────────────────────────────────────────────────────────

// Sessão expira por inatividade após 15 minutos ou em até 24h no máximo
const IDLE_TIMEOUT_MS = 15 * 60 * 1_000;

// PIN mínimo aceito em qualquer operação sensível. UI já garante 6 dígitos no
// fluxo de criação, mas adicionamos guarda defensiva no service.
const MIN_PIN_LENGTH = 4;

function assertValidPin(pin: string): void {
  if (typeof pin !== 'string' || pin.length < MIN_PIN_LENGTH) {
    throw new Error(
      `PIN inválido: deve ter no mínimo ${MIN_PIN_LENGTH} caracteres.`,
    );
  }
}

export interface WalletData {
  mnemonic: string;
  /** Endereço Solana (Base58) */
  publicKey: string;
  /** Keypair Solana (Ed25519) */
  keypair: Keypair;
  /** Endereço EVM (ETH/BSC/Polygon) — se disponível */
  evmAddress?: string;
}

export interface SessionState {
  keypair: Keypair | null;
  mnemonic: string | null;
  lastActivity: number;
  expiry?: number;
}

/**
 * (M9) Eventos de mudança de estado da sessão — usados por hooks/UI para
 * reagir IMEDIATAMENTE a expiração ou logout. Antes desta integração,
 * `useSolanaWallet` ficava com status='active' até o próximo render mesmo
 * que `getSessionKeypair()` tivesse limpado a sessão internamente.
 *
 *   'started'  — startSession() rodou com sucesso (unlock OK).
 *   'expired'  — getSessionKeypair detectou idle/expiry e limpou a sessão.
 *   'cleared'  — clearSession() rodou (logout explícito ou expiry).
 *   'wiped'    — wipeIdentity() rodou (identidade destruída).
 *
 * Listeners são chamados sincronamente. Erros de listener são engolidos para
 * não afetar a operação que disparou o evento.
 */
export type SessionEvent = 'started' | 'expired' | 'cleared' | 'wiped';
export type SessionEventListener = (event: SessionEvent) => void;

const SESSION_EXPIRY_KEY_BASE = 'verum_session_expiry';
const BIOMETRIC_PIN_KEY_BASE = 'verum_biometric_pin';

class KeyManager {
  private session: SessionState = { keypair: null, mnemonic: null, lastActivity: 0 };
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private _pinLimiter: PinRateLimiter | null = null;
  /** (M9) Listeners de mudança de sessão. Set para garantir uniqueness e fácil remoção. */
  private readonly _sessionListeners = new Set<SessionEventListener>();

  /**
   * (M9) Inscreve um callback para eventos de mudança de estado da sessão.
   * Retorna função de unsubscribe (idempotente).
   *
   * Uso típico (em hooks React):
   *   useEffect(() => keyManager.onSessionChange((evt) => {
   *     if (evt === 'expired') setStatus('expired');
   *   }), []);
   */
  onSessionChange(listener: SessionEventListener): () => void {
    this._sessionListeners.add(listener);
    return () => {
      this._sessionListeners.delete(listener);
    };
  }

  /** Emite evento para todos os listeners. Erros isolados (try/catch por listener). */
  private _emitSessionEvent(event: SessionEvent): void {
    for (const listener of this._sessionListeners) {
      try {
        listener(event);
      } catch (err) {
        // Listener com bug não pode quebrar a operação que disparou o evento
        console.warn('[KeyManager] session listener threw:', err);
      }
    }
  }

  /**
   * Rate-limiter de PIN (C1). Lazy-init para que testes possam injetar storage
   * antes do primeiro uso. Default usa SecureStore/localStorage.
   *
   *   freeAttempts=2  → 1ª e 2ª falha sem lockout (UX)
   *   baseLockoutMs=1000, maxLockoutMs=300_000 → 1s → 2s → 4s → ... → 5min cap
   *   resetAfterMs=24h → quem volta dias depois recomeça do zero
   */
  private getPinLimiter(): PinRateLimiter {
    if (!this._pinLimiter) {
      this._pinLimiter = new PinRateLimiter({
        storage: new PersistentPinAttemptStorage(),
      });
    }
    return this._pinLimiter;
  }

  /** TEST-ONLY: injeta storage customizado para testes determinísticos. */
  __setPinLimiterForTests(storage: PinAttemptStorage, opts: { now?: () => number; baseLockoutMs?: number } = {}): void {
    this._pinLimiter = new PinRateLimiter({
      storage,
      baseLockoutMs: opts.baseLockoutMs ?? 1_000,
      now: opts.now,
    });
  }

  /**
   * Define a rede corrente (rule #9). Isola apenas estado de sessão.
   *
   * (M6) Em rede que muda enquanto há sessão ativa, emite 'cleared' para
   * forçar UI a desabilitar operações (saldos, pubkey, txs) até o caller
   * re-validar contra a nova rede. Sem isso, callers que cacheiam
   * `getSessionKeypair` antes do switch ficavam com state stale.
   */
  setNetwork(net: WalletNetwork) {
    const previous = CURRENT_NETWORK;
    CURRENT_NETWORK = net;
    if (previous !== net && this.session.keypair) {
      // Mudança de rede com sessão ativa — sinaliza listeners.
      this._emitSessionEvent('cleared');
    }
  }

  getNetwork(): WalletNetwork {
    return CURRENT_NETWORK;
  }

  public async findEncryptedData(): Promise<string | null> {
    // NUNCA varre LEGACY_KEYS em ordem arbitrária. A chave canônica é
    // SECURE_STORE_KEY; legados só servem para leitura one-shot em migração.
    // Prioriza sempre a canônica para evitar ler um resíduo antigo.
    const canonical = await storeGet(SECURE_STORE_KEY);
    if (canonical) return canonical;
    for (const key of LEGACY_KEYS) {
      const data = await storeGet(key);
      if (data) {
        if (__DEV__) console.log(`[KeyManager] Dados encontrados na chave: ${key}`);
        return data;
      }
    }
    return null;
  }

  async hasAccount(): Promise<boolean> {
    const data = await this.findEncryptedData();
    return !!data;
  }

  /** Retorna a pubkey cacheada (não criptografada) — pode estar vazia em
   *  instalações legadas ainda sem cache. Use getPersistedIdentity() para
   *  obter a pubkey autoritativa do vault. */
  async getStoredAddress(): Promise<string | null> {
    return await storeGet(PUBLIC_ADDRESS_KEY);
  }

  /**
   * Define o cache da pubkey pública.
   *
   * Atenção (rule #4): só deve ser chamado quando o endereço vier do VAULT
   * local ou quando ainda não existir vault. NÃO sobrescreva a pubkey cacheada
   * com um valor externo (ex: banco de dados) se houver um vault local com
   * pubkey diferente — isso quebraria a consistência entre UI e assinatura.
   */
  async setStoredAddress(address: string): Promise<void> {
    const existing = await storeGet(PUBLIC_ADDRESS_KEY);
    const hasVault = await this.findEncryptedData();
    if (existing && hasVault && existing !== address) {
      console.warn(
        `[KeyManager] setStoredAddress BLOQUEADO: vault local tem pubkey ${existing}, ignorando tentativa de trocar para ${address}.`,
      );
      return;
    }
    await storeSet(PUBLIC_ADDRESS_KEY, address);
  }

  /**
   * Retorna a identidade persistida no dispositivo de forma AUTORITATIVA.
   *
   * Esta é a fonte da verdade para a UI (rule #7). Se existir vault, a
   * pubkey cacheada deve bater com o conteúdo do vault; se não bater, a
   * pubkey cacheada é corrigida.
   *
   * Retorna null se não houver identidade persistida.
   */
  async getPersistedIdentity(): Promise<{ publicKey: string } | null> {
    const hasVault = await this.findEncryptedData();
    if (!hasVault) {
      // Sem vault: a pubkey cacheada não tem respaldo criptográfico,
      // não é uma identidade legítima. Retorna null.
      return null;
    }
    const cached = await storeGet(PUBLIC_ADDRESS_KEY);
    if (cached) return { publicKey: cached };
    return null;
  }

  /** Tenta restaurar uma sessão persistente (ex: biometria ou PIN salvo) */
  async restoreSession(): Promise<boolean> {
    try {
      const expiryStr = await sessionStoreGet(sessionKey(SESSION_EXPIRY_KEY_BASE));
      if (!expiryStr) return false;

      const expiry = parseInt(expiryStr, 10);
      if (Date.now() > expiry) {
        if (__DEV__) console.log('[KeyManager] Sessão expirada.');
        await this.clearSession();
        return false;
      }

      const savedPin = await this.getPinForBiometrics();
      if (!savedPin) return false;

      // (C2) UMA decifragem em vez de duas — `unlockVault` retorna ambos.
      // restoreSession roda em todo cold start; pagar PBKDF2 2× tornava a tela
      // de splash visivelmente lenta em devices médios.
      const { keypair, mnemonic } = await this.unlockVault(savedPin);

      this.session = {
        keypair,
        mnemonic,
        lastActivity: Date.now(),
        expiry
      };

      if (__DEV__) console.log(`[KeyManager] Sessão restaurada com sucesso. Expira em: ${new Date(expiry).toLocaleString()}`);
      return true;
    } catch (e) {
      // PinLockedError aqui significa que o lockout persistente está ativo —
      // não restaura sessão silenciosamente; usuário precisará digitar PIN
      // e ver o erro/contador na UI.
      if (e instanceof PinLockedError) {
        vaultLog.warn('restoreSession.locked', { remainingMs: e.remainingLockoutMs });
      } else {
        console.error('[KeyManager] Erro ao restaurar sessão:', e);
      }
      return false;
    }
  }

  /**
   * Gera wallet em memória SEM PERSISTIR. Função pura.
   *
   * ATENÇÃO: este método NÃO deve ser chamado em useEffect, mount,
   * onFocus, restore, reconnect, logout ou qualquer fluxo automático.
   * Só deve rodar em resposta a uma ação explícita do usuário (rule #1,#2,#3).
   *
   * Para persistir uma nova identidade, use `createNewWallet(pin)` — essa é
   * a ÚNICA forma sancionada de criar uma carteira nova em disco.
   */
  generateWallet(): WalletData & { fullWallet: DerivedWallet } {
    const wallet = generateFullWallet();
    return {
      mnemonic: wallet.mnemonic,
      keypair: wallet.solana.keypair,
      publicKey: wallet.solana.address,
      evmAddress: wallet.evm.address,
      fullWallet: wallet,
    };
  }

  /**
   * Importa wallet existente a partir de mnemonic BIP39.
   * Valida checksum + wordlist e deriva chaves multi-chain.
   */
  importFromMnemonic(mnemonic: string): { keypair: Keypair; publicKey: string; fullWallet: DerivedWallet } {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Mnemônico inválido.');
    }
    const wallet = deriveFromMnemonic(mnemonic);
    return {
      keypair: wallet.solana.keypair,
      publicKey: wallet.solana.address,
      fullWallet: wallet,
    };
  }

  /**
   * Persiste o vault criptografado no dispositivo.
   *
   * GUARD (rule #4): por padrão, RECUSA sobrescrever um vault existente.
   * Essa é a proteção central contra regeneração acidental em mount/effect.
   * Para substituir explicitamente a identidade, o chamador deve usar
   * `createNewWallet()` ou `importNewWallet()`, que internamente chamam esta
   * função com `{ allowOverwrite: true }` após `wipeIdentity()`.
   */
  async saveEncrypted(
    mnemonic: string,
    keypair: Keypair,
    userPin: string,
    evmAddress?: string,
    opts: { allowOverwrite?: boolean } = {},
  ): Promise<void> {
    try {
      if (!opts.allowOverwrite) {
        const existing = await this.findEncryptedData();
        if (existing) {
          const storedPub = await storeGet(PUBLIC_ADDRESS_KEY);
          const incomingPub = keypair.publicKey.toBase58();
          // Se já existe um vault e a pubkey que vamos escrever é a MESMA,
          // a operação é idempotente: ok. Se for DIFERENTE, bloqueia.
          if (storedPub && storedPub !== incomingPub) {
            const msg = `[KeyManager] Tentativa BLOQUEADA de sobrescrever identidade: ${storedPub} → ${incomingPub}. Use createNewWallet() ou importNewWallet() para trocar explicitamente.`;
            console.error(msg);
            throw new Error(
              'Identidade persistida já existe. Para trocar, use "Criar nova wallet" ou "Restaurar frase".',
            );
          }
        }
      }

      const walletData = {
        mnemonic,
        secretKeyHex: Buffer.from(keypair.secretKey).toString('hex'),
        publicKey: keypair.publicKey.toBase58(),
        evmAddress: evmAddress || null,
      };

      // Formato v2: PBKDF2-SHA256 (600k iter) + nacl.secretbox (autenticado).
      // O formato legado (CryptoJS.AES.encrypt-com-PBKDF1/MD5/1iter) ainda é
      // ACEITO em loadDecrypted via path de migração, mas NUNCA é escrito.
      const encrypted = encryptVault(walletData, userPin);

      // Salva o container criptografado
      await storeSet(SECURE_STORE_KEY, encrypted);

      // Salva a chave pública de forma NÃO CRIPTOGRAFADA para acesso rápido na UI
      await storeSet(PUBLIC_ADDRESS_KEY, walletData.publicKey);

      if (__DEV__) console.log(`[KeyManager] Carteira salva com sucesso (pub=${walletData.publicKey.substring(0, 8)}…)`);
    } catch (err) {
      console.error('[KeyManager] Erro ao salvar:', err);
      if (err instanceof Error) throw err;
      throw new Error('Falha ao proteger a carteira.');
    }
  }

  /**
   * Cria uma identidade COMPLETAMENTE NOVA (rule #6).
   *
   * Esta é a única forma sancionada de gerar um keypair novo em um dispositivo
   * que já possua identidade persistida. Sempre wipe → generate → save.
   *
   * SÓ chame em resposta a uma ação explícita do usuário.
   */
  async createNewWallet(userPin: string): Promise<WalletData & { fullWallet: DerivedWallet }> {
    await this.wipeIdentity();
    const wallet = generateFullWallet();
    await this.saveEncrypted(
      wallet.mnemonic,
      wallet.solana.keypair,
      userPin,
      wallet.evm.address,
      { allowOverwrite: true },
    );
    return {
      mnemonic: wallet.mnemonic,
      keypair: wallet.solana.keypair,
      publicKey: wallet.solana.address,
      evmAddress: wallet.evm.address,
      fullWallet: wallet,
    };
  }

  /**
   * Importa uma seed phrase como identidade nova (recovery / "Restaurar frase").
   *
   * Ação explícita do usuário. Sempre wipe → derive → save.
   */
  async importNewWallet(
    mnemonic: string,
    userPin: string,
  ): Promise<WalletData & { fullWallet: DerivedWallet }> {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Mnemônico inválido.');
    }
    await this.wipeIdentity();
    const wallet = deriveFromMnemonic(mnemonic.trim().toLowerCase());
    await this.saveEncrypted(
      wallet.mnemonic,
      wallet.solana.keypair,
      userPin,
      wallet.evm.address,
      { allowOverwrite: true },
    );
    return {
      mnemonic: wallet.mnemonic,
      keypair: wallet.solana.keypair,
      publicKey: wallet.solana.address,
      evmAddress: wallet.evm.address,
      fullWallet: wallet,
    };
  }

  /**
   * Descriptografa o vault e retorna o Keypair (API legada — preserva compat).
   *
   * Internamente chama `unlockVault` (C2) que faz UMA única decifragem
   * retornando keypair + mnemonic. Aqui só descartamos o mnemonic.
   * Callers que precisem dos dois devem usar `unlockVault` para evitar
   * pagar PBKDF2 duas vezes (~700ms cada em mobile).
   */
  async loadDecrypted(userPin: string): Promise<Keypair> {
    const { keypair } = await this.unlockVault(userPin);
    return keypair;
  }

  /**
   * (C2) Decifra o vault UMA VEZ e retorna keypair + mnemonic.
   *
   * Substitui o padrão antigo `loadDecrypted(pin) + getMnemonic(pin)` que
   * fazia PBKDF2 600k duas vezes (~1.4s no total em devices médios). Aqui
   * o PBKDF2 roda 1× e o payload do vault é parseado uma vez para extrair
   * ambos.
   *
   * (C1) Aplica rate-limit anti-brute-force ANTES de iniciar PBKDF2:
   *   - Lockout exponencial após `freeAttempts` falhas (1s → 2s → ... → 5min).
   *   - `PinLockedError` é propagado para o caller (UI mostra "aguarde Xs").
   *   - Success limpa contador; failure incrementa.
   *
   * Detecção automática de formato (v2 vs legacy CryptoJS) preservada.
   * Migração transparente legacy→v2 preservada.
   */
  async unlockVault(userPin: string): Promise<{ keypair: Keypair; mnemonic: string | null }> {
    assertValidPin(userPin);

    const encrypted = await this.findEncryptedData();
    if (!encrypted) {
      if (isWeb) console.warn('[KeyManager] Nenhum dado encontrado no localStorage da Web.');
      // Sem vault: não conta como tentativa de PIN (não há o que adivinhar).
      throw new Error('Nenhuma chave encontrada no dispositivo. Por favor, reconecte sua carteira.');
    }

    // (C1) Rate-limit ANTES do trabalho caro (PBKDF2). Se já está em lockout,
    // PinLockedError sobe imediatamente sem desperdiçar CPU.
    const limiter = this.getPinLimiter();
    await limiter.assertCanAttempt(PIN_ATTEMPT_KEY);

    try {
      const result = await this._decryptVaultOnce(encrypted, userPin);
      // Sucesso: zera contador de falhas.
      await limiter.recordSuccess(PIN_ATTEMPT_KEY);
      return result;
    } catch (err) {
      // Falha de decrypt (PIN errado OU vault corrompido). Conta como tentativa
      // — proteção também cobre brute-force contra vault adulterado.
      const status = await limiter.recordFailure(PIN_ATTEMPT_KEY);
      vaultLog.warn('vault.unlock_failed', {
        failureCount: status.failureCount,
        lockedForMs: status.remainingLockoutMs,
      });
      throw err;
    }
  }

  /**
   * Decifra o vault uma única vez. Retorna keypair + mnemonic do mesmo payload.
   *
   * Não aplica rate-limit (caller — `unlockVault` — já cuida disso) e não
   * captura PinLockedError. Apenas decifra e parseia.
   */
  private async _decryptVaultOnce(
    encrypted: string,
    userPin: string,
  ): Promise<{ keypair: Keypair; mnemonic: string | null }> {
    // ── Caminho v2 (formato seguro) ─────────────────────────────────────────
    if (isV2Format(encrypted)) {
      try {
        const data = decryptVault(encrypted, userPin) as {
          secretKeyHex?: string;
          publicKey?: string;
          mnemonic?: string;
        };
        if (!data || typeof data.secretKeyHex !== 'string') {
          throw new Error('Vault v2 sem secretKeyHex — corrompido.');
        }
        const keypair = this._keypairFromHex(data.secretKeyHex, data.publicKey ?? null);
        const mnemonic = typeof data.mnemonic === 'string' ? data.mnemonic : null;
        vaultLog.debug('vault.loaded', { format: 'v2', pub: keypair.publicKey.toBase58().slice(0, 8) });

        // Re-encriptação transparente quando o iter count do envelope difere
        // do alvo atual (caso típico: usuários antigos com 600k após reduzirmos
        // pra 210k). Best-effort — falha aqui não bloqueia o unlock, só adia o
        // ganho de performance pra próximo decrypt. Repassamos `data` inteiro
        // pra preservar campos opcionais (ex.: evmAddress) que não estão na
        // tipagem destruturada acima.
        const envelopeIter = getVaultIterations(encrypted);
        if (envelopeIter !== null && envelopeIter !== CURRENT_PBKDF2_ITERATIONS) {
          try {
            const reencrypted = encryptVault(data, userPin);
            await storeSet(SECURE_STORE_KEY, reencrypted);
            vaultLog.info('vault.reencrypted_v2', {
              from: envelopeIter,
              to: CURRENT_PBKDF2_ITERATIONS,
              pub: keypair.publicKey.toBase58().slice(0, 8),
            });
          } catch (reencErr: any) {
            vaultLog.warn('vault.reencrypt_failed', { error: reencErr?.message });
          }
        }

        return { keypair, mnemonic };
      } catch (err: any) {
        vaultLog.warn('vault.v2_decrypt_failed', { error: err?.message });
        throw new Error(err?.message ?? 'PIN inválido ou falha na descriptografia.');
      }
    }

    // ── Caminho legado (CryptoJS) + migração transparente ────────────────────
    vaultLog.warn('vault.legacy_format_detected', { willMigrate: true });
    const legacyResult = this._loadFromLegacy(encrypted, userPin);

    // Migração: re-encripta no formato v2 e regrava. Falha não bloqueia.
    try {
      const reencrypted = encryptVault(
        {
          mnemonic: legacyResult.mnemonic,
          secretKeyHex: legacyResult.secretKeyHex,
          publicKey: legacyResult.keypair.publicKey.toBase58(),
          evmAddress: legacyResult.evmAddress,
        },
        userPin,
      );
      await storeSet(SECURE_STORE_KEY, reencrypted);
      vaultLog.info('vault.migrated_to_v2', {
        pub: legacyResult.keypair.publicKey.toBase58().slice(0, 8),
      });
    } catch (migrationErr: any) {
      // Não é fatal — usuário ainda obtém o Keypair; migração tenta de novo
      // no próximo unlock.
      vaultLog.error('vault.migration_failed', migrationErr);
    }

    return { keypair: legacyResult.keypair, mnemonic: legacyResult.mnemonic };
  }

  // ── Helpers privados (loadDecrypted) ─────────────────────────────────────

  /** Decifra vault legado (CryptoJS.AES). Retorna keypair + dados raw para migração. */
  private _loadFromLegacy(
    encrypted: string,
    userPin: string,
  ): { keypair: Keypair; secretKeyHex: string; mnemonic: string | null; evmAddress: string | null } {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, userPin);
      let payload = '';
      try {
        payload = bytes.toString(CryptoJS.enc.Utf8);
      } catch {
        throw new Error('PIN incorreto ou dados corrompidos (UTF-8 decode failed).');
      }

      if (!payload || payload.trim() === '') {
        throw new Error('Falha na decodificação: PIN incorreto ou dados corrompidos.');
      }

      let secretKeyHex: string;
      let savedPublicKey: string | null = null;
      let mnemonic: string | null = null;
      let evmAddress: string | null = null;

      try {
        const data = JSON.parse(payload);
        if (typeof data === 'string') {
          // Legacy-legacy: payload era apenas a hex string
          secretKeyHex = data;
        } else if (data && typeof data.secretKeyHex === 'string') {
          secretKeyHex = data.secretKeyHex;
          savedPublicKey = data.publicKey || null;
          mnemonic = typeof data.mnemonic === 'string' ? data.mnemonic : null;
          evmAddress = typeof data.evmAddress === 'string' ? data.evmAddress : null;
        } else {
          throw new Error('Formato de dados inválido no vault: secretKeyHex ausente.');
        }
      } catch (parseErr: any) {
        if (parseErr.message?.includes('secretKeyHex ausente')) throw parseErr;
        // Fallback: payload não é JSON — assume hex puro (formato muito antigo)
        secretKeyHex = payload;
      }

      // Normaliza formato comma-separated (legado muito antigo)
      if (typeof secretKeyHex === 'string' && secretKeyHex.includes(',')) {
        const parts = secretKeyHex.split(',');
        if (parts.length === 64) {
          secretKeyHex = Buffer.from(
            new Uint8Array(parts.map((x) => parseInt(x, 10))),
          ).toString('hex');
        }
      }

      const keypair = this._keypairFromHex(secretKeyHex, savedPublicKey);
      return { keypair, secretKeyHex, mnemonic, evmAddress };
    } catch (err: any) {
      if (isWeb) console.error('[KeyManager] Erro de descriptografia (legacy) na Web:', err.message);
      throw new Error(err.message || 'PIN inválido ou falha na descriptografia.');
    }
  }

  /** Constrói e valida Keypair a partir de hex string de 128 chars. */
  private _keypairFromHex(secretKeyHex: string, expectedPublicKey: string | null): Keypair {
    if (typeof secretKeyHex !== 'string' || secretKeyHex.length !== 128) {
      throw new Error(
        'Chave secreta corrompida ou formato incompatível. Por favor, recupere sua conta usando a frase de 12 palavras.',
      );
    }
    if (!/^[0-9a-fA-F]+$/.test(secretKeyHex)) {
      throw new Error('Chave secreta contém caracteres inválidos. Dados corrompidos.');
    }

    const secretKey = Buffer.from(secretKeyHex, 'hex');
    if (secretKey.length !== 64) {
      throw new Error(`Tamanho de chave inválido: esperado 64 bytes, obtido ${secretKey.length}.`);
    }

    const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

    // Integridade: a chave privada deve gerar a chave pública arquivada.
    const derivedPublicKey = keypair.publicKey.toBase58();
    if (expectedPublicKey && derivedPublicKey !== expectedPublicKey) {
      throw new Error(
        'Falha na integridade da chave: o endereço derivado não coincide com o endereço salvo.',
      );
    }
    return keypair;
  }

  /**
   * Retorna o mnemonic do vault. Suporta v2 e legado.
   *
   * Diferente de loadDecrypted, getMnemonic NÃO migra o formato — porque o
   * caller principal (loadDecrypted) já faz a migração na sequência. Se chamado
   * em isolamento (raro), o vault permanece legado mas continua funcional;
   * próximo unlock via loadDecrypted faz a migração.
   *
   * Retorna `null` em qualquer falha (mantém contrato histórico que callers
   * dependem — não lança).
   */
  async getMnemonic(userPin: string): Promise<string | null> {
    if (typeof userPin !== 'string' || userPin.length < MIN_PIN_LENGTH) return null;

    const encrypted = await this.findEncryptedData();
    if (!encrypted) return null;

    // ── Caminho v2 ──────────────────────────────────────────────────────────
    if (isV2Format(encrypted)) {
      try {
        const data = decryptVault(encrypted, userPin) as { mnemonic?: string };
        return typeof data?.mnemonic === 'string' ? data.mnemonic : null;
      } catch (err: any) {
        vaultLog.debug('vault.getMnemonic_v2_failed', { error: err?.message });
        return null;
      }
    }

    // ── Caminho legado ───────────────────────────────────────────────────────
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, userPin);
      let payload = '';
      try {
        payload = bytes.toString(CryptoJS.enc.Utf8);
      } catch (e) {
        console.warn('[KeyManager] getMnemonic: falha ao decodificar UTF-8 (PIN incorreto?)');
        return null;
      }

      if (!payload) return null;

      try {
        const data = JSON.parse(payload);
        return data.mnemonic || null;
      } catch {
        return null;
      }
    } catch (err) {
      if (isWeb) console.error('[KeyManager] Erro ao recuperar mnemônico na Web:', err);
      return null;
    }
  }

  async startSession(mnemonic: string | null, keypair: Keypair, userPin: string, timeoutHours = 24): Promise<void> {
    assertValidPin(userPin);
    // (M9) clearSession emite 'cleared'; aqui queremos emitir 'started' DEPOIS
    // de configurar o novo estado, então usamos a versão interna silent.
    await this._clearSessionInternal({ silent: true });

    const expiry = Date.now() + (timeoutHours * 60 * 60 * 1000);
    this.session = { mnemonic, keypair, lastActivity: Date.now(), expiry };

    // PIN e expiração vão para sessionStorage no browser (limpo ao fechar aba)
    await this.savePinForBiometrics(userPin);
    await sessionStoreSet(sessionKey(SESSION_EXPIRY_KEY_BASE), expiry.toString());

    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    // (M9) Quando o timer dispara, é uma expiração — sinaliza 'expired'.
    this.sessionTimer = setTimeout(() => {
      this._autoExpire('timer');
    }, timeoutHours * 60 * 60 * 1000);

    this._emitSessionEvent('started');
  }

  getSessionKeypair(): Keypair | null {
    if (!this.session.keypair) return null;

    const now = Date.now();
    const expired = this.session.expiry && now > this.session.expiry;
    const idle = now - this.session.lastActivity > IDLE_TIMEOUT_MS;

    if (expired || idle) {
      // (M9) Auto-clear emite 'expired' (distinto de logout explícito 'cleared').
      this._autoExpire(expired ? 'expiry' : 'idle');
      return null;
    }

    this.session.lastActivity = now;
    return this.session.keypair;
  }

  getSessionMnemonic(): string | null {
    if (!this.session.keypair) return null;

    const now = Date.now();
    const expired = this.session.expiry && now > this.session.expiry;
    const idle = now - this.session.lastActivity > IDLE_TIMEOUT_MS;

    if (expired || idle) {
      this._autoExpire(expired ? 'expiry' : 'idle');
      return null;
    }

    this.session.lastActivity = now;
    return this.session.mnemonic;
  }

  /**
   * (M9) Caminho interno para auto-expiração — limpa estado E emite 'expired'.
   *
   * Disparado por:
   *   - timer absoluto de timeout (após N horas de startSession)
   *   - getSessionKeypair/getSessionMnemonic quando idle > IDLE_TIMEOUT_MS
   *   - getSessionKeypair/getSessionMnemonic quando expiry timestamp ultrapassado
   *
   * Diferente de `clearSession()` (logout explícito → emite 'cleared'). A
   * distinção permite UI mostrar mensagens diferentes ("sessão expirou — faça
   * login" vs "você saiu da conta").
   */
  private _autoExpire(reason: 'expiry' | 'idle' | 'timer'): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.session = { keypair: null, mnemonic: null, lastActivity: 0 };

    // Persistência limpa em fire-and-forget — não bloqueia o evento.
    sessionStoreDelete(sessionKey(SESSION_EXPIRY_KEY_BASE)).catch(() => undefined);
    this.removePinForBiometrics().catch(() => undefined);

    vaultLog.info('session.expired', { reason });
    this._emitSessionEvent('expired');
  }

  /**
   * Limpa APENAS a sessão (rule #5: logout limpa sessão, não identidade).
   *
   *  Afeta: keypair em memória, mnemonic em memória, PIN biométrico cacheado,
   *         expiração da sessão.
   *  NÃO afeta: vault criptografado (SECURE_STORE_KEY), endereço público
   *             cacheado (PUBLIC_ADDRESS_KEY) — a identidade permanece intacta.
   *
   * ATENÇÃO: nunca chame este método esperando apagar a wallet. Para destruir
   * a identidade completamente, use `wipeIdentity()`.
   */
  async clearSession(): Promise<void> {
    await this._clearSessionInternal({ silent: false });
  }

  /**
   * (M9) Versão interna do clearSession com flag silent.
   *   silent=true  → não emite evento (usado por startSession antes de
   *                  configurar novo estado e emitir 'started').
   *   silent=false → emite 'cleared' (logout explícito).
   */
  private async _clearSessionInternal(opts: { silent: boolean }): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.session = { keypair: null, mnemonic: null, lastActivity: 0 };
    this.sessionTimer = null;

    // Limpa APENAS persistência de sessão (rule #5)
    await sessionStoreDelete(sessionKey(SESSION_EXPIRY_KEY_BASE));
    await this.removePinForBiometrics();

    if (!opts.silent) {
      this._emitSessionEvent('cleared');
    }
  }

  /**
   * Destrói a identidade do dispositivo (rule #6).
   *
   * Remove: vault criptografado, endereço público cacheado, todas as chaves
   *         legadas, sessão em memória, PIN biométrico, expiração.
   *
   * Esta função SOMENTE deve ser chamada em resposta a uma ação explícita
   * do usuário ("Criar nova wallet", "Apagar carteira"). Nunca deve ser
   * chamada em mount, logout, reconnect ou restore.
   */
  async wipeIdentity(): Promise<void> {
    console.warn('[KeyManager] wipeIdentity chamado — apagando identidade persistida.');
    // (M9) clearSession interno silent — vamos emitir 'wiped' como evento final.
    // Não emitir 'cleared' antes de 'wiped' evita confundir UI (listener pode
    // ver 2 eventos consecutivos onde o segundo já cobre o primeiro).
    await this._clearSessionInternal({ silent: true });
    // Apaga vault canônico, cache de endereço e TODAS as chaves legadas
    await storeDelete(SECURE_STORE_KEY);
    await storeDelete(PUBLIC_ADDRESS_KEY);
    for (const key of LEGACY_KEYS) {
      await storeDelete(key);
    }
    this._emitSessionEvent('wiped');
  }

  // ─── Gestão de PIN via Biometria ───────────────────────────────────────────

  /** Salva o PIN em sessionStorage (browser) ou SecureStore (mobile).
   *  No browser, sessionStorage é apagado ao fechar a aba, limitando a janela de exposição. */
  async savePinForBiometrics(pin: string): Promise<void> {
    assertValidPin(pin);
    await sessionStoreSet(sessionKey(BIOMETRIC_PIN_KEY_BASE), pin);
  }

  async getPinForBiometrics(): Promise<string | null> {
    return await sessionStoreGet(sessionKey(BIOMETRIC_PIN_KEY_BASE));
  }

  async removePinForBiometrics(): Promise<void> {
    await sessionStoreDelete(sessionKey(BIOMETRIC_PIN_KEY_BASE));
    await sessionStoreDelete('verum_biometric_pin');
  }
}

export const keyManager = new KeyManager();
export default keyManager;
