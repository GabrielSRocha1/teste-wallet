// ─── Permissions ──────────────────────────────────────────────────────────────

export type Permission =
  | 'publicKey'            // Endereço público (sempre obrigatória)
  | 'balance'              // Ver saldos dos tokens
  | 'network'              // Identificar rede ativa (mainnet/devnet)
  | 'signMessage'          // Solicitar assinatura de mensagens
  | 'signTransaction'      // Solicitar assinatura de transação
  | 'signAllTransactions'; // Solicitar assinatura em lote

// ─── Session ──────────────────────────────────────────────────────────────────

export interface ConnectedSession {
  id: string;
  name: string;
  origin: string;
  icon?: string;
  permissions: Permission[];
  connectedAt: number;
  publicKey: string;
  network: string;
  /** Shared secret X25519 codificado em Base58 (protocolo E2EE) */
  sharedSecret?: string;
  /** Chave pública X25519 do dApp em Base58 */
  dappEncryptionPublicKey?: string;
  /** Chave pública X25519 da wallet em Base58 */
  walletEncryptionPublicKey?: string;
}

// ─── Connection request ───────────────────────────────────────────────────────

export interface ConnectionRequest {
  /** UUID gerado pelo dApp */
  session: string;
  name: string;
  origin: string;
  icon?: string;
  callbackUrl?: string;
  permissions: Permission[];
  /** Protocolo E2EE — chave pública X25519 do dApp em Base58 */
  dappEncryptionPublicKey?: string;
  /** Deep link de retorno ao dApp */
  redirectLink?: string;
  cluster?: string;
  appUrl?: string;
}

// ─── Sign request ─────────────────────────────────────────────────────────────

export type SignRequestAction =
  | 'signTransaction'
  | 'signAllTransactions'
  | 'signMessage';

export interface SignRequest {
  action: SignRequestAction;
  /** base64 tx (signTransaction/signMessage) ou JSON array base64 (signAllTransactions) — fluxo legado */
  data?: string;
  origin?: string;
  session?: string;
  callbackUrl?: string;
  /** Payload criptografado — protocolo E2EE */
  payload?: string;
  nonce?: string;
  dappEncryptionPublicKey?: string;
  redirectLink?: string;
}

// ─── Wallet adapter status ────────────────────────────────────────────────────

export type WalletAdapterStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ─── Transaction detail (parsed for display) ──────────────────────────────────

export interface TransactionDetail {
  numInstructions: number;
  numAccounts: number;
  /** Taxa estimada em SOL (5000 lamports × nº de assinaturas requeridas) */
  estimatedFeeSol: number;
  isVersioned: boolean;
  /** Preenchido se a deserialização falhou — UI deve ocultar os detalhes silenciosamente */
  parseError?: string;
}
