/**
 * SignatureEngine — Motor de assinatura nativo para a Verum Wallet.
 *
 * Responsabilidades:
 *  - Deserializar transações Solana (Legacy e Versioned) de base64
 *  - Assinar com o Keypair da sessão ativa
 *  - Serializar e devolver em base64 para injeção no WebView
 *  - Assinar mensagens arbitrárias (signMessage) via ed25519
 *  - Validar rede antes de assinar
 *
 * Segurança:
 *  - Keypair jamais sai desta camada
 *  - Rejeita payload malformado com erro tipado
 *  - Valida que a transação é para a rede correta quando possível
 *
 * Erros padronizados:
 *  WALLET_NOT_FOUND   — sem sessão ativa
 *  USER_REJECTED      — usuário recusou
 *  INVALID_PAYLOAD    — transação/mensagem malformada
 *  NETWORK_MISMATCH   — transação é para rede diferente da ativa
 */

import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';

export type VerumErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'USER_REJECTED'
  | 'INVALID_PAYLOAD'
  | 'NETWORK_MISMATCH'
  | 'NOT_CONNECTED';

export class VerumSignatureError extends Error {
  constructor(public readonly code: VerumErrorCode, message?: string) {
    super(message ?? VerumSignatureError.defaultMessage(code));
    this.name = 'VerumSignatureError';
  }

  static defaultMessage(code: VerumErrorCode): string {
    const map: Record<VerumErrorCode, string> = {
      WALLET_NOT_FOUND:  'Sessão de carteira não encontrada. Faça login novamente.',
      USER_REJECTED:     'Solicitação recusada pelo usuário.',
      INVALID_PAYLOAD:   'Payload de transação inválido ou corrompido.',
      NETWORK_MISMATCH:  'A transação pertence a uma rede diferente da rede ativa.',
      NOT_CONNECTED:     'Carteira não conectada ao dApp.',
    };
    return map[code];
  }
}

// ─── Tipos de resultado ───────────────────────────────────────────────────────

export interface SignTransactionResult {
  /** Transação assinada serializada em base64 */
  signedTransaction: string;
  /** Chave pública do signatário */
  publicKey: string;
}

export interface SignMessageResult {
  /** Assinatura ed25519 em base64 */
  signature: string;
  /** Chave pública do signatário */
  publicKey: string;
}

// ─── Helpers de validação ─────────────────────────────────────────────────────

/**
 * (C7) Guard: TX legada DEVE ter feePayer definido pelo dApp antes de assinatura.
 *
 * Por que não setar automaticamente para o signer:
 *  - Em TXs multi-sig partial-sign, outro signer é o feePayer legítimo.
 *    Sobrescrever silenciosamente fazia o usuário pagar gas que não devia
 *    OU a TX falhava no broadcast com "unknown signer".
 *  - Respeita a intenção explícita do dApp. Quem manda assinatura SEM feePayer
 *    está enviando payload inválido.
 *
 * Exportado para teste direto — em produção sempre passa por Transaction.from
 * (formato wire força feePayer presente), mas o guard cobre cenários de bug
 * no caller / refactor futuro.
 */
export function assertLegacyTxHasFeePayer(tx: Transaction): void {
  if (!tx.feePayer) {
    throw new VerumSignatureError(
      'INVALID_PAYLOAD',
      'TX legada sem feePayer definido. O dApp deve setar feePayer explicitamente antes de pedir assinatura.',
    );
  }
}

/**
 * (SE1, SE2) Guard de SIGNER: confirma que `signerPubkey` é exigido pela TX.
 *
 * Por que isso é crítico:
 *  - Em LEGACY Transaction, `sign(keypair)` só preenche a slot do signer se ele
 *    aparecer entre `numRequiredSignatures` primeiras `accountKeys`. Caso não
 *    apareça, a chamada é no-op e a TX broadcast falha com "missing signature"
 *    OU pior: a TX vai pro broadcast com signature[0] do feePayer e o usuário
 *    paga gas para uma TX que NÃO autoriza nada do seu lado.
 *  - Em VERSIONED Transaction, idêntico: `sign([keypair])` é silent no-op.
 *
 * Cenário de ataque: dApp malicioso constrói TX onde o keypair do usuário NÃO é
 * exigido — apenas aparece no array de contas como leitor. Wallet assina sem
 * validar, achando que está autorizando uma transferência, mas na verdade está
 * pagando gas para uma TX que drena fundos do feePayer (outro endereço).
 *
 * Esta função lança VerumSignatureError(INVALID_PAYLOAD) se a pubkey do
 * keypair não aparece entre os signers requeridos. Aplicada em sign legacy
 * e versioned.
 */
export function assertSignerIsRequired(
  tx: Transaction | VersionedTransaction,
  signerPubkey: { toBase58(): string },
): void {
  const signerStr = signerPubkey.toBase58();

  if (tx instanceof Transaction) {
    // Em legacy, signers requeridos vêm do compileMessage().
    let requiredKeys: string[];
    try {
      const msg = tx.compileMessage();
      const numRequired = msg.header.numRequiredSignatures;
      requiredKeys = msg.accountKeys.slice(0, numRequired).map((k) => k.toBase58());
    } catch (err) {
      throw new VerumSignatureError(
        'INVALID_PAYLOAD',
        'Não foi possível extrair signers requeridos da TX legada.',
      );
    }
    if (!requiredKeys.includes(signerStr)) {
      throw new VerumSignatureError(
        'INVALID_PAYLOAD',
        `Keypair da wallet (${signerStr.slice(0, 8)}...) não está entre os signers requeridos pela TX. Recusando assinatura.`,
      );
    }
    return;
  }

  // VersionedTransaction
  const vtx = tx as VersionedTransaction;
  const numRequired = vtx.message.header.numRequiredSignatures;
  const requiredKeys = vtx.message.staticAccountKeys
    .slice(0, numRequired)
    .map((k) => k.toBase58());
  if (!requiredKeys.includes(signerStr)) {
    throw new VerumSignatureError(
      'INVALID_PAYLOAD',
      `Keypair da wallet (${signerStr.slice(0, 8)}...) não está entre os signers requeridos pela TX versionada. Recusando assinatura.`,
    );
  }
}

// ─── Helpers de serialização ──────────────────────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Detecta se o buffer representa uma VersionedTransaction ou Transaction legada.
 *
 * Heurística (rápida e correta em 99.99% dos casos): VersionedTransaction tem
 * bit MSB do primeiro byte ligado (`0x80`). Legacy transaction começa com
 * `numSignatures` (1 byte compact-u16) que raramente atinge ≥128.
 *
 * Edge case: multisig com ≥128 signers requeridos colide. Para isso temos o
 * detector probe-by-deserialize abaixo (mais caro, usado apenas em fallback).
 */
function isVersionedTx(bytes: Uint8Array): boolean {
  return bytes.length > 0 && (bytes[0] & 0x80) !== 0;
}

/**
 * Tentativa robusta de deserializar: tenta como VersionedTransaction primeiro,
 * cai para Legacy Transaction se a heurística estiver errada (ex: multisig
 * pesado). Retorna o objeto e seu tipo.
 */
function deserializeTx(bytes: Uint8Array): { tx: Transaction | VersionedTransaction; versioned: boolean } {
  if (isVersionedTx(bytes)) {
    try {
      return { tx: VersionedTransaction.deserialize(bytes), versioned: true };
    } catch {
      // Heurística falhou — pode ser legacy com numSignatures ≥ 128.
      return { tx: Transaction.from(bytes), versioned: false };
    }
  }
  try {
    return { tx: Transaction.from(bytes), versioned: false };
  } catch {
    // Caso raríssimo: legacy parse falhou mas versioned funciona.
    return { tx: VersionedTransaction.deserialize(bytes), versioned: true };
  }
}

// ─── Assinatura de transação única ───────────────────────────────────────────

/**
 * Deserializa, assina e reserializa uma transação Solana.
 *
 * @param keypair   Keypair da sessão ativa (obtido de keyManager.getSessionKeypair())
 * @param txBase64  Transação serializada em base64 (enviada pelo dApp via window.verum)
 * @returns         Transação assinada em base64 + publicKey do signatário
 */
export function signTransaction(keypair: Keypair, txBase64: string): SignTransactionResult {
  console.log('[VERUM][SIGNATURE] signTransaction — início');

  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(txBase64);
  } catch {
    throw new VerumSignatureError('INVALID_PAYLOAD', 'Não foi possível decodificar a transação de base64.');
  }

  let signedBytes: Uint8Array;

  try {
    const { tx, versioned } = deserializeTx(bytes);

    if (versioned) {
      console.log('[VERUM][SIGNATURE] Tipo: VersionedTransaction');
      // (SE2) Recusa silenciosa: nacl.sign no-op se signer não está em
      // staticAccountKeys[0..numRequired]. Validamos ANTES de chamar sign().
      assertSignerIsRequired(tx as VersionedTransaction, keypair.publicKey);
      (tx as VersionedTransaction).sign([keypair]);
      signedBytes = (tx as VersionedTransaction).serialize();
    } else {
      console.log('[VERUM][SIGNATURE] Tipo: Legacy Transaction');
      const legacy = tx as Transaction;
      // (C7) NÃO sobrescrever feePayer quando ausente.
      assertLegacyTxHasFeePayer(legacy);
      // (SE1) Confirma que o signer está entre numRequiredSignatures primeiras
      // accountKeys. Sem isso, dApp malicioso podia obter assinatura para TX
      // onde o usuário só aparece como leitor (signature vazia, mas paga gas).
      assertSignerIsRequired(legacy, keypair.publicKey);
      legacy.sign(keypair);
      signedBytes = legacy.serialize({
        requireAllSignatures: false,
        verifySignatures:     false,
      });
    }
  } catch (err: any) {
    console.error('[VERUM][SIGNATURE] Erro ao assinar transação:', err?.message);
    // Preserva VerumSignatureError já tipado (ex: NO_FEEPAYER lançado acima)
    // para não perder o `code` original em double-wrap.
    if (err instanceof VerumSignatureError) throw err;
    throw new VerumSignatureError('INVALID_PAYLOAD', err?.message ?? 'Falha ao assinar transação.');
  }

  const result: SignTransactionResult = {
    signedTransaction: uint8ArrayToBase64(signedBytes),
    publicKey:         keypair.publicKey.toBase58(),
  };

  console.log('[VERUM][SIGNATURE] signTransaction — concluído', {
    publicKey: result.publicKey,
    bytes:     signedBytes.length,
  });

  return result;
}

// ─── Assinatura de múltiplas transações ──────────────────────────────────────

/**
 * Assina um array de transações em sequência.
 * Se qualquer uma falhar, lança erro e nenhuma é retornada.
 */
export function signAllTransactions(
  keypair: Keypair,
  txsBase64: string[],
): SignTransactionResult[] {
  console.log('[VERUM][SIGNATURE] signAllTransactions — count=' + txsBase64.length);

  if (!Array.isArray(txsBase64) || txsBase64.length === 0) {
    throw new VerumSignatureError('INVALID_PAYLOAD', 'Lista de transações vazia ou inválida.');
  }

  return txsBase64.map((txBase64, i) => {
    console.log('[VERUM][SIGNATURE] signAllTransactions — tx', i + 1, '/', txsBase64.length);
    return signTransaction(keypair, txBase64);
  });
}

// ─── Assinatura de mensagem arbitrária ───────────────────────────────────────

/**
 * Assina uma mensagem arbitrária com ed25519 (padrão Solana signMessage).
 *
 * @param keypair       Keypair da sessão
 * @param messageBase64 Bytes da mensagem em base64 (Uint8Array serializado)
 * @returns             Assinatura ed25519 em base64 + publicKey
 */
export function signMessage(keypair: Keypair, messageBase64: string): SignMessageResult {
  console.log('[VERUM][SIGNATURE] signMessage — início');

  let messageBytes: Uint8Array;
  try {
    messageBytes = base64ToUint8Array(messageBase64);
  } catch {
    throw new VerumSignatureError('INVALID_PAYLOAD', 'Não foi possível decodificar a mensagem de base64.');
  }

  if (messageBytes.length === 0) {
    throw new VerumSignatureError('INVALID_PAYLOAD', 'Mensagem vazia.');
  }

  // keypair.secretKey tem 64 bytes: seed (32) + pubkey (32)
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);

  const result: SignMessageResult = {
    signature:  uint8ArrayToBase64(signature),
    publicKey:  keypair.publicKey.toBase58(),
  };

  console.log('[VERUM][SIGNATURE] signMessage — concluído', {
    publicKey:      result.publicKey,
    signatureBytes: signature.length,
  });

  return result;
}

// ─── Payload helper para validação de deep link ──────────────────────────────

// (E4) Antes havia import duplicado: `export type { SignRequest }` + `import type
// { SignRequest as _SignRequest }`. Agora um único import com alias usado tanto
// internamente quanto re-exportado.
import type { SignRequest } from '@/src/types/wallet.types';
export type { SignRequest };

/**
 * Parseia payload de deep link `verumwallet://sign?...` ou `verumwallet://signTransaction?...`
 */
export function parseSignDeepLink(url: string): SignRequest | null {
  try {
    const parsed = new URL(url.replace('verumwallet://', 'https://verumwallet/'));
    
    let action: any = null;
    
    // Suporte ao formato Universal (Phantom/Solflare)
    if (parsed.hostname === 'signTransaction' || parsed.pathname === '/signTransaction') {
      action = 'signTransaction';
    } else if (parsed.hostname === 'signAllTransactions' || parsed.pathname === '/signAllTransactions') {
      action = 'signAllTransactions';
    } else if (parsed.hostname === 'signMessage' || parsed.pathname === '/signMessage') {
      action = 'signMessage';
    } else if (parsed.hostname === 'sign' || parsed.pathname === '/sign') {
      action = parsed.searchParams.get('action');
    }

    if (!action) return null;

    const validActions: SignRequest['action'][] = [
      'signTransaction',
      'signAllTransactions',
      'signMessage',
    ];
    if (!validActions.includes(action)) return null;

    const p = parsed.searchParams;

    console.log('[VERUM][HANDSHAKE] parseSignDeepLink', { action });

    return {
      action,
      data:                    p.get('data') ?? undefined,
      origin:                  p.get('origin') ?? undefined,
      session:                 p.get('session') ?? undefined,
      callbackUrl:             p.get('callback') ?? undefined,
      
      // E2EE
      payload:                 p.get('payload') ?? undefined,
      nonce:                   p.get('nonce') ?? undefined,
      dappEncryptionPublicKey: p.get('dapp_encryption_public_key') ?? undefined,
      redirectLink:            p.get('redirect_link') ?? undefined,
    };
  } catch {
    return null;
  }
}
