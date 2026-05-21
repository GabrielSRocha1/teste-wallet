import { describe, expect, it } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  assertLegacyTxHasFeePayer,
  signTransaction,
  VerumSignatureError,
} from '../../signatureEngine';

// Helper: serializa uma Transaction sem requerer signatures para virar input
// dos testes (simula a TX que o dApp envia via deep link / window.verum).
function serializeLegacy(tx: Transaction): string {
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString('base64');
}

function serializeVersioned(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

// ─── (C7) Guard: feePayer obrigatório em TX legada ───────────────────────────

describe('signatureEngine — (C7) assertLegacyTxHasFeePayer', () => {
  it('REJEITA TX legada sem feePayer com VerumSignatureError(INVALID_PAYLOAD)', () => {
    // Constrói TX legada SEM feePayer (cenário defensivo — em produção
    // Transaction.from() sempre preenche feePayer pelo formato wire, mas
    // o guard protege contra refactor futuro ou bug no caller).
    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      // feePayer omitido propositalmente
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey('11111111111111111111111111111112'),
        toPubkey: new PublicKey('11111111111111111111111111111113'),
        lamports: 1000,
      }),
    );

    expect(() => assertLegacyTxHasFeePayer(tx)).toThrow(VerumSignatureError);
    try {
      assertLegacyTxHasFeePayer(tx);
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(VerumSignatureError);
      expect((err as VerumSignatureError).code).toBe('INVALID_PAYLOAD');
      expect((err as VerumSignatureError).message).toMatch(/feePayer/);
    }
  });

  it('ACEITA TX legada com feePayer definido', () => {
    const signer = Keypair.generate();
    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: signer.publicKey,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: signer.publicKey,
        lamports: 1,
      }),
    );

    expect(() => assertLegacyTxHasFeePayer(tx)).not.toThrow();
  });
});

// ─── (C7) signTransaction preserva feePayer original ────────────────────────

describe('signTransaction — (C7) feePayer NÃO é sobrescrito', () => {
  it('PRESERVA o feePayer original quando o dApp já o setou (multisig scenario)', () => {
    const signer = Keypair.generate();
    const intendedFeePayer = Keypair.generate(); // outra parte do multisig

    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: intendedFeePayer.publicKey, // dApp setou explicitamente
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey('11111111111111111111111111111112'),
        lamports: 1000,
      }),
    );

    const b64 = serializeLegacy(tx);
    const result = signTransaction(signer, b64);

    // Resserializa o output e checa que feePayer continua sendo o original
    const decoded = Buffer.from(result.signedTransaction, 'base64');
    const reparsed = Transaction.from(decoded);
    expect(reparsed.feePayer?.toBase58()).toBe(intendedFeePayer.publicKey.toBase58());
    // NÃO trocou para o signer
    expect(reparsed.feePayer?.toBase58()).not.toBe(signer.publicKey.toBase58());
  });

  it('assina VersionedTransaction sem mexer no message (não há feePayer field separado)', () => {
    const signer = Keypair.generate();

    // Constrói v0 com message — feePayer == payerKey no v0
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        SystemProgram.transfer({
          fromPubkey: signer.publicKey,
          toPubkey: signer.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message);

    const b64 = serializeVersioned(vtx);
    const result = signTransaction(signer, b64);

    // Deserializa output e confirma que está assinada
    const decoded = Buffer.from(result.signedTransaction, 'base64');
    const reparsed = VersionedTransaction.deserialize(decoded);
    // signature[0] (do payerKey) deve ter sido preenchida
    const allZeros = reparsed.signatures[0].every((b) => b === 0);
    expect(allZeros).toBe(false);
  });
});
