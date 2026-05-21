/**
 * useSendPayment — hook React para envio de pagamentos Solana.
 *
 * SEGURANÇA:
 * - O Keypair (private key) NUNCA é enviado ao servidor.
 * - A assinatura acontece localmente via `transaction.sign(keypair)`.
 * - Apenas os bytes já assinados são enviados ao RPC via broadcastSigned().
 */

import { Keypair, Transaction } from '@solana/web3.js';
import { useCallback, useState } from 'react';
import transactionService, {
  FeeEstimate,
  SPLTransactionParams,
  TransactionParams,
  TxResult,
} from '../services/transactionService';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | 'idle'
  | 'building'
  | 'simulating'
  | 'signing'
  | 'broadcasting'
  | 'confirmed'
  | 'error';

export type PaymentType = 'SOL' | 'SPL';

export interface BuildPreviewParams {
  type: PaymentType;
  sol?: TransactionParams;
  spl?: SPLTransactionParams;
  operationType?: 'standard' | 'depositPix' | 'invest';
}

export interface PaymentPreview {
  transaction: Transaction;
  fee: FeeEstimate;
  simulated: boolean;
}

export interface UseSendPaymentResult {
  status: PaymentStatus;
  txHash: string | null;
  error: Error | null;
  preview: PaymentPreview | null;
  /**
   * Passo 1: Monta a transação, simula e estima taxas.
   * Retorna um resumo para o usuário revisar antes de confirmar.
   */
  buildAndPreview: (params: BuildPreviewParams) => Promise<PaymentPreview | null>;
  /**
   * Passo 2: Assina LOCALMENTE com o keypair e faz o broadcast.
   * O keypair nunca sai do dispositivo.
   */
  signAndSend: (transaction: Transaction, keypair: Keypair) => Promise<TxResult | null>;
  /** Reseta o estado para 'idle' */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSendPayment(): UseSendPaymentResult {
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);

  // ── Reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
    setPreview(null);
  }, []);

  // ── Passo 1: Construção + Simulação + Estimativa ─────────────────────────

  const buildAndPreview = useCallback(
    async (buildParams: BuildPreviewParams): Promise<PaymentPreview | null> => {
      try {
        setStatus('building');
        setError(null);
        setPreview(null);

        let transaction: Transaction;
        const opType = buildParams.operationType || 'standard';

        if (buildParams.type === 'SOL') {
          if (!buildParams.sol) throw new Error('Parâmetros SOL ausentes.');
          buildParams.sol.type = opType;
          transaction = await transactionService.buildSOLTransfer(buildParams.sol);
        } else {
          if (!buildParams.spl) throw new Error('Parâmetros SPL ausentes.');
          buildParams.spl.type = opType;
          transaction = await transactionService.buildSPLTransfer(buildParams.spl);
        }

        setStatus('simulating');
        await transactionService.simulate(transaction);

        // (E9) Passa contexto para estimateFee detalhar a taxa Verum 2% real.
        // Antes, `fee.platformFee` retornava sempre 0 e a UI mostrava "taxa zero".
        const feeContext = buildParams.type === 'SOL'
          ? { amountInToken: buildParams.sol!.amount, tokenSymbol: 'SOL' as const }
          : {
              amountInToken: buildParams.spl!.amount,
              tokenSymbol: buildParams.spl!.mintAddress.slice(0, 4).toUpperCase() as string,
            };
        const fee = await transactionService.estimateFee(transaction, feeContext);

        const result: PaymentPreview = {
          transaction,
          fee,
          simulated: true,
        };

        setPreview(result);
        setStatus('idle');
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[useSendPayment] buildAndPreview error:', e);
        setError(e);
        setStatus('error');
        return null;
      }
    },
    []
  );

  // ── Passo 2: Assinatura local + Broadcast ────────────────────────────────

  const signAndSend = useCallback(
    async (transaction: Transaction, keypair: Keypair): Promise<TxResult | null> => {
      try {
        setStatus('signing');

        // Refresh recentBlockhash to prevent expiration if user took too long to enter password
        const { blockhash } = await transactionService.getConnection().getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;

        // (SE4) Re-simula com o blockhash atualizado ANTES de assinar. Buil
        // & Preview já simulou, mas se o usuário demorou >60s para confirmar,
        // o estado on-chain pode ter mudado (saldo gasto noutra TX, etc.).
        // Simular agora curto-circuita "Saldo insuficiente" antes de pagar gas.
        try {
          await transactionService.simulate(transaction);
        } catch (simErr) {
          // Erros de simulação já vêm traduzidos por translateError (saldo,
          // accountNotFound, etc) — propagamos direto para o catch outer.
          throw simErr;
        }

        transaction.sign(keypair);
        console.log('[useSendPayment] transação assinada localmente.');

        setStatus('broadcasting');
        const result = await transactionService.broadcastSigned(transaction);

        if (result.status === 'confirmed') {
          setTxHash(result.hash);
          setStatus('confirmed');
          console.log('[useSendPayment] Transação confirmada:', result.hash);
        } else {
          throw new Error(`Transação falhou on-chain. Hash: ${result.hash || 'indisponível'}`);
        }

        return result;
      } catch (err: any) {
        // Se a biblioteca do Solana lançar unknown signer, converte para uma mensagem clara
        if (err.message && err.message.includes('unknown signer')) {
          const expected = transaction.feePayer?.toBase58() || 'desconhecido';
          const errorMsg = `Inconsistência de carteira: A chave local do dispositivo (${keypair.publicKey.toBase58().substring(0,6)}...) não corresponde à carteira da sua conta conectada (${expected.substring(0,6)}...). Por favor, saia e entre novamente na conta correta ou importe a carteira certa.`;
          const e = new Error(errorMsg);
          console.error('[useSendPayment] Inconsistência de signatário:', errorMsg);
          setError(e);
          setStatus('error');
          throw e;
        }

        const e = err instanceof Error ? err : new Error(String(err));
        console.error('[useSendPayment] signAndSend error:', e);
        setError(e);
        setStatus('error');
        throw e;
      }
    },
    []
  );

  return {
    status,
    txHash,
    error,
    preview,
    buildAndPreview,
    signAndSend,
    reset,
  };
}

export default useSendPayment;
