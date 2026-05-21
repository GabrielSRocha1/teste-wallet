/**
 * EncryptionService — Criptografia NaCl box para o protocolo de deep link.
 *
 * Implementa o mesmo protocolo que Phantom/Solflare usam:
 *  1. dApp envia sua chave pública de criptografia X25519
 *  2. Wallet gera par de chaves X25519 efêmero
 *  3. Shared secret = nacl.box.before(dappPK, walletSK)
 *  4. Payload criptografado com nacl.box.after(msg, nonce, sharedSecret)
 *  5. Wallet retorna: verum_encryption_public_key, nonce, data (tudo em Base58)
 *
 * Segurança:
 *  - Chaves efêmeras: cada conexão gera novo par
 *  - Nonce aleatório: prevenção de replay
 *  - Shared secret nunca é exposto
 */

import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

// ─── Base58 Encode/Decode ────────────────────────────────────────────────────

export function encodeBase58(data: Uint8Array): string {
  return bs58.encode(data);
}

export function decodeBase58(str: string): Uint8Array {
  return bs58.decode(str);
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface EncryptionKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface EncryptedPayload {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

// ─── Serviço de Criptografia ─────────────────────────────────────────────────

class EncryptionService {
  /**
   * Gera um par de chaves X25519 efêmero para a sessão de criptografia.
   * Usado uma vez por conexão — nunca reutilize.
   */
  generateKeyPair(): EncryptionKeyPair {
    const kp = nacl.box.keyPair();
    console.log('[EncryptionService] Par de chaves X25519 gerado');
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  }

  /**
   * Calcula o shared secret entre a chave privada da wallet e a
   * chave pública do dApp (Diffie-Hellman sobre Curve25519).
   */
  generateSharedSecret(
    walletSecretKey: Uint8Array,
    dappPublicKey: Uint8Array,
  ): Uint8Array {
    const sharedSecret = nacl.box.before(dappPublicKey, walletSecretKey);
    console.log('[EncryptionService] Shared secret calculado');
    return sharedSecret;
  }

  /**
   * Criptografa um payload JSON com nacl.box (usando shared secret + nonce aleatório).
   *
   * @param payload    Objeto a ser criptografado (ex: { public_key, session })
   * @param sharedSecret  Shared secret já calculado
   * @returns  nonce e ciphertext prontos para enviar em Base58
   */
  encryptPayload(
    payload: Record<string, unknown>,
    sharedSecret: Uint8Array,
  ): EncryptedPayload {
    const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
    const message = Buffer.from(JSON.stringify(payload));

    const ciphertext = nacl.box.after(message, nonce, sharedSecret);
    if (!ciphertext) {
      throw new Error('[EncryptionService] Falha ao criptografar payload.');
    }

    console.log('[EncryptionService] Payload criptografado', {
      nonceLen: nonce.length,
      ciphertextLen: ciphertext.length,
    });

    return { nonce, ciphertext };
  }

  /**
   * Descriptografa um payload recebido de um dApp.
   *
   * @param ciphertextB58  Ciphertext em Base58
   * @param nonceB58       Nonce em Base58
   * @param sharedSecret   Shared secret já calculado
   * @returns Payload descriptografado como objeto
   */
  decryptPayload(
    ciphertextB58: string,
    nonceB58: string,
    sharedSecret: Uint8Array,
  ): Record<string, unknown> {
    const ciphertext = decodeBase58(ciphertextB58);
    const nonce = decodeBase58(nonceB58);

    const decrypted = nacl.box.open.after(ciphertext, nonce, sharedSecret);
    if (!decrypted) {
      throw new Error('[EncryptionService] Falha ao descriptografar — dados corrompidos ou chave incorreta.');
    }

    const json = Buffer.from(decrypted).toString('utf-8');
    console.log('[EncryptionService] Payload descriptografado com sucesso');
    try {
      return JSON.parse(json);
    } catch (parseErr) {
      // Bytes descriptografados são válidos mas não JSON — payload corrompido
      // ou tentativa de injeção. Lançamos erro tipado em vez de deixar o
      // SyntaxError nu subir e crashar o app inteiro.
      throw new Error(
        '[EncryptionService] Payload descriptografado não é JSON válido (corrompido ou malformado).',
      );
    }
  }

  // ─── Helpers para deep link ─────────────────────────────────────────────

  /**
   * Monta a URL de retorno para o dApp após aprovação da conexão.
   * Equivale ao buildString { ... } do código Kotlin.
   *
   * @param redirectUrl            URL de callback do dApp (redirect_link)
   * @param walletEncryptionPK     Chave pública X25519 da wallet (efêmera)
   * @param nonce                  Nonce usado na criptografia
   * @param encryptedData          Payload criptografado
   * @returns URL completa pronta para abrir via Linking
   */
  buildReturnUrl(
    redirectUrl: string,
    walletEncryptionPK: Uint8Array,
    nonce: Uint8Array,
    encryptedData: Uint8Array,
  ): string {
    const separator = redirectUrl.includes('?') ? '&' : '?';
    const url = [
      redirectUrl,
      separator,
      'verum_encryption_public_key=', encodeURIComponent(encodeBase58(walletEncryptionPK)),
      '&nonce=', encodeURIComponent(encodeBase58(nonce)),
      '&data=', encodeURIComponent(encodeBase58(encryptedData)),
    ].join('');

    console.log('[EncryptionService] URL de retorno montada:', url.slice(0, 80) + '...');
    return url;
  }

  /**
   * Gera um token de sessão aleatório (32 bytes em Base58).
   */
  generateSessionToken(): string {
    const token = nacl.randomBytes(32);
    return encodeBase58(token);
  }
}

export const encryptionService = new EncryptionService();
export default encryptionService;
