import { describe, expect, it } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  assertSignerIsRequired,
  VerumSignatureError,
} from '../../signatureEngine';

// ─── (SE1, SE2) Signer obrigatório nos signers requeridos ───────────────────

describe('assertSignerIsRequired — (SE1) legacy Transaction', () => {
  it('ACEITA quando o signer É o feePayer (caso clássico)', () => {
    const signer = Keypair.generate();
    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: signer.publicKey,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey('11111111111111111111111111111112'),
        lamports: 1000,
      }),
    );

    expect(() => assertSignerIsRequired(tx, signer.publicKey)).not.toThrow();
  });

  it('ACEITA em multisig quando signer está entre numRequiredSignatures (mesmo não sendo feePayer)', () => {
    const signer = Keypair.generate();
    const intendedFeePayer = Keypair.generate();

    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: intendedFeePayer.publicKey,
    });
    // Instrução exige signer como source → signer entra na lista de signers requeridos
    tx.add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: intendedFeePayer.publicKey,
        lamports: 100,
      }),
    );

    expect(() => assertSignerIsRequired(tx, signer.publicKey)).not.toThrow();
  });

  it('REJEITA quando o signer NÃO é exigido pela TX (sign no-op seria silent)', () => {
    const realSigner = Keypair.generate();
    const otherUser = Keypair.generate();

    // TX onde o realSigner NÃO aparece como signer requerido
    const tx = new Transaction({
      recentBlockhash: '11111111111111111111111111111111',
      feePayer: otherUser.publicKey,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: otherUser.publicKey,
        toPubkey: new PublicKey('11111111111111111111111111111112'),
        lamports: 100,
      }),
    );

    // realSigner não aparece nem como source nem como feePayer → não é signer required
    expect(() => assertSignerIsRequired(tx, realSigner.publicKey))
      .toThrow(VerumSignatureError);
    try {
      assertSignerIsRequired(tx, realSigner.publicKey);
    } catch (err) {
      expect((err as VerumSignatureError).code).toBe('INVALID_PAYLOAD');
      expect((err as VerumSignatureError).message).toMatch(/não está entre os signers requeridos/);
    }
  });
});

describe('assertSignerIsRequired — (SE2) VersionedTransaction', () => {
  it('ACEITA v0 quando signer é o payerKey (numRequiredSignatures slot 0)', () => {
    const signer = Keypair.generate();
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

    expect(() => assertSignerIsRequired(vtx, signer.publicKey)).not.toThrow();
  });

  it('REJEITA v0 quando signer NÃO está em staticAccountKeys[0..numRequired]', () => {
    const otherUser = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: otherUser.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        SystemProgram.transfer({
          fromPubkey: otherUser.publicKey,
          toPubkey: otherUser.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message);

    const realSigner = Keypair.generate();
    expect(() => assertSignerIsRequired(vtx, realSigner.publicKey))
      .toThrow(VerumSignatureError);
  });
});
