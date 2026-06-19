/**
 * swapAndSendService.ts — Orquestra "swap → SOL → enviar SOL ao destinatário".
 *
 * Usado APENAS pelo fluxo `transferir.tsx` (ENVIAR ATIVOS). Telas de swap
 * (cambio) e envio direto (enviar-crypto) NÃO usam este orquestrador.
 *
 * Contrato:
 *   - Input asset != SOL → faz 2 transações on-chain:
 *       Tx 1: Jupiter swap (input → SOL, destino = sender) com platformFee 2%
 *              indo pra treasury (em SOL). Slippage default 50 bps (0,5%).
 *       Tx 2: SOL transfer (sender → recipient) usando o saldo real recebido
 *              do swap, descontado uma margem mínima de gas.
 *   - Input asset == SOL → caller deve pular este serviço e usar o fluxo
 *     direto de SOL transfer (mais barato, mais atômico).
 *
 * Atomicidade:
 *   Não é atômico entre as 2 txs. Se a Tx 2 falhar APÓS Tx 1 ter confirmado,
 *   o usuário fica com SOL na própria carteira (em vez do ativo original) e
 *   o orquestrador retorna erro identificável (`SOLAlreadyInWallet`) para que
 *   a UI sugira retry manual.
 */

import {
  Keypair,
  VersionedTransaction,
  SystemProgram,
  Transaction,
  PublicKey,
} from '@solana/web3.js';
import transactionService, { VERUM_FEE_BPS } from './transactionService';

/* ─── Tipos ─────────────────────────────────────────────────────────────── */

export interface SwapQuoteForRecipient {
  /** Mint do token de entrada. */
  inputMint: string;
  /** Quantia atômica (em smallest units) do input que vai pro swap. */
  inputAmountAtomic: string;
  /** SOL net que o destinatário receberá (já subtraindo platformFee). */
  outAmountLamports: string;
  /** UI-friendly: SOL em unidade humana. */
  outAmountSol: number;
  /** Impacto de preço (%). */
  priceImpactPct: number;
  /** Resposta crua do Jupiter — usada por `executeSwapAndSend`. */
  jupiterRaw: any;
  /** Slippage tolerado em basis points (50 = 0,5%). */
  slippageBps: number;
  /** Timestamp da quote (ms epoch) — usado pra detectar staleness no executor. */
  fetchedAt: number;
}

export interface SwapAndSendResult {
  swapTxHash: string;
  transferTxHash: string;
  solSentLamports: string;
  /** Saldo de SOL do sender antes do swap (lamports). Útil pra UI/debug. */
  preSwapSolLamports: string;
  /** Saldo de SOL do sender depois do swap (lamports). */
  postSwapSolLamports: string;
}

/** Erro disparado quando swap confirmou mas o transfer pro destinatário falhou.
 *  UI deve oferecer "Reenviar SOL" para evitar perda. */
export class TransferAfterSwapFailedError extends Error {
  constructor(
    public readonly swapTxHash: string,
    public readonly solInWalletLamports: string,
    public readonly recipientAddress: string,
    cause: unknown,
  ) {
    super(
      `Swap concluído (${swapTxHash.slice(0, 8)}…) mas envio do SOL ao destinatário falhou. ` +
        `Saldo de SOL recebido aguarda reenvio: ${solInWalletLamports} lamports.`,
    );
    this.name = 'TransferAfterSwapFailedError';
    // @ts-ignore — preserve cause for debugging
    this.cause = cause;
  }
}

const QUOTE_TTL_MS = 30_000;
/** Reserva mínima de SOL pra cobrir o gas da Tx 2 (signature + base fee + buffer). */
const TRANSFER_GAS_RESERVE_LAMPORTS = 10_000n;

/* ─── Quote ─────────────────────────────────────────────────────────────── */

/**
 * Pede uma quote ao Jupiter (input → SOL) já com platformFee 2% pra treasury.
 *
 * `inputAmountAtomic` é a quantia BRUTA que sai da carteira do remetente — a
 * platform fee do Jupiter é descontada automaticamente do output (SOL).
 */
export async function quoteSwapToSol(params: {
  inputMint: string;
  inputAmountAtomic: string;
  slippageBps?: number;
}): Promise<SwapQuoteForRecipient> {
  const slippageBps = params.slippageBps ?? 50;

  const quote = await transactionService.jupiterQuote({
    inputMint: params.inputMint,
    outputMint: transactionService.SOL_NATIVE_MINT,
    amount: params.inputAmountAtomic,
    slippageBps,
    platformFeeBps: VERUM_FEE_BPS,
  });

  const outAmount = String(quote?.outAmount ?? '0');
  if (outAmount === '0' || outAmount === '') {
    throw new Error('Jupiter não retornou outAmount válido para swap → SOL.');
  }

  return {
    inputMint: params.inputMint,
    inputAmountAtomic: params.inputAmountAtomic,
    outAmountLamports: outAmount,
    outAmountSol: Number(outAmount) / 1_000_000_000,
    priceImpactPct: parseFloat(quote?.priceImpactPct ?? '0'),
    jupiterRaw: quote,
    slippageBps,
    fetchedAt: Date.now(),
  };
}

/* ─── Executor ──────────────────────────────────────────────────────────── */

/**
 * Executa o fluxo 2-tx: swap (input → SOL) + transfer (SOL → recipient).
 *
 * - Mede saldo SOL antes/depois do swap pra calcular EXATAMENTE quanto enviar
 *   (preserva valor recebido mesmo com slippage real ≠ estimado).
 * - Se Tx 2 falhar, lança `TransferAfterSwapFailedError` com o saldo aguardando
 *   reenvio — UI deve oferecer botão "Reenviar SOL pendente".
 */
export async function executeSwapAndSend(params: {
  quote: SwapQuoteForRecipient;
  keypair: Keypair;
  recipientAddress: string;
}): Promise<SwapAndSendResult> {
  const { quote, keypair, recipientAddress } = params;

  if (Date.now() - quote.fetchedAt > QUOTE_TTL_MS) {
    throw new Error('Cotação expirou. Solicite uma nova cotação antes de confirmar.');
  }

  const senderPubkey = keypair.publicKey;
  const conn = transactionService.getConnection();

  // ─── Saldo SOL pré-swap ───────────────────────────────────────────────
  const preSwapSolLamports = BigInt(await conn.getBalance(senderPubkey));

  // ─── Tx 1: Jupiter swap (input → SOL) ─────────────────────────────────
  // feeAccount opcional — só é incluído se a treasury já tem ATA do wSOL,
  // senão Jupiter rejeita com "feeAccount is required for swap with platformFee".
  // Quando feeAccount é undefined, removemos platformFee da quote antes de
  // chamar buildSwap (mesma defesa que cambio.tsx faz).
  const feeAccount = await transactionService.deriveTreasuryFeeAccount(
    transactionService.SOL_NATIVE_MINT,
  );

  const effectiveQuote =
    feeAccount === undefined && quote.jupiterRaw?.platformFee
      ? { ...quote.jupiterRaw, platformFee: undefined }
      : quote.jupiterRaw;

  const swapData = await transactionService.jupiterBuildSwap({
    quoteResponse: effectiveQuote,
    userPublicKey: senderPubkey.toBase58(),
    wrapAndUnwrapSol: true,
    feeAccount,
  });

  if (!swapData?.swapTransaction) {
    throw new Error('Jupiter não retornou swapTransaction.');
  }

  const swapTx = VersionedTransaction.deserialize(
    Buffer.from(swapData.swapTransaction, 'base64'),
  );

  // Refresh blockhash pra evitar expiração entre build → sign → broadcast
  const { blockhash: swapBlockhash, lastValidBlockHeight: swapLvbh } =
    await conn.getLatestBlockhash('confirmed');
  swapTx.message.recentBlockhash = swapBlockhash;

  swapTx.sign([keypair]);

  const swapResult = await transactionService.broadcastSigned(swapTx, {
    skipPreflight: true,
    isSwap: true,
    lastValidBlockHeight: swapLvbh,
  });

  if (swapResult.status !== 'confirmed') {
    throw new Error(
      `Swap não confirmou on-chain (hash ${swapResult.hash || 'indisponível'}).`,
    );
  }

  const swapTxHash = swapResult.hash;

  // ─── Mede saldo SOL pós-swap ──────────────────────────────────────────
  const postSwapSolLamports = BigInt(await conn.getBalance(senderPubkey));
  const solReceivedLamports = postSwapSolLamports - preSwapSolLamports;

  if (solReceivedLamports <= TRANSFER_GAS_RESERVE_LAMPORTS) {
    throw new TransferAfterSwapFailedError(
      swapTxHash,
      String(postSwapSolLamports),
      recipientAddress,
      new Error(
        `Saldo SOL pós-swap insuficiente para cobrir gas da transferência ao destinatário. ` +
          `Recebido: ${solReceivedLamports} lamports.`,
      ),
    );
  }

  const solToSendLamports = solReceivedLamports - TRANSFER_GAS_RESERVE_LAMPORTS;

  // ─── Tx 2: SOL transfer (sender → recipient) ──────────────────────────
  try {
    const recipientPubkey = new PublicKey(recipientAddress);
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: recipientPubkey,
        lamports: solToSendLamports,
      }),
    );

    const { blockhash: transferBlockhash } =
      await conn.getLatestBlockhash('confirmed');
    transferTx.recentBlockhash = transferBlockhash;
    transferTx.feePayer = senderPubkey;
    transferTx.sign(keypair);

    const transferResult = await transactionService.broadcastSigned(transferTx);

    if (transferResult.status !== 'confirmed') {
      throw new Error(
        `Transferência ao destinatário não confirmou on-chain ` +
          `(hash ${transferResult.hash || 'indisponível'}).`,
      );
    }

    return {
      swapTxHash,
      transferTxHash: transferResult.hash,
      solSentLamports: String(solToSendLamports),
      preSwapSolLamports: String(preSwapSolLamports),
      postSwapSolLamports: String(postSwapSolLamports),
    };
  } catch (transferErr) {
    // Swap já confirmou — usuário tem SOL na carteira. UI precisa oferecer
    // recovery (reenviar SOL).
    throw new TransferAfterSwapFailedError(
      swapTxHash,
      String(postSwapSolLamports),
      recipientAddress,
      transferErr,
    );
  }
}

/* ─── Recovery ──────────────────────────────────────────────────────────── */

export interface RetryTransferParams {
  keypair: Keypair;
  recipientAddress: string;
  /** Lamports a enviar. Se omitido, calcula `saldoSolAtual - gasReserve`. */
  lamportsToSend?: bigint;
}

export interface RetryTransferResult {
  transferTxHash: string;
  solSentLamports: string;
}

/**
 * Reexecuta APENAS a etapa de transfer (sender → recipient) que falhou após
 * o swap. Chamado pela UI de recovery quando o usuário aperta "Reenviar SOL".
 *
 * Lê o saldo SOL atual da carteira pra decidir o valor — defendendo contra
 * casos em que o usuário já gastou parte do SOL recebido (ex.: outra tx
 * paralela). Se `lamportsToSend` é passado explicitamente, valida que não
 * excede saldo - gas.
 */
export async function retrySolTransfer(
  params: RetryTransferParams,
): Promise<RetryTransferResult> {
  const { keypair, recipientAddress, lamportsToSend } = params;
  const conn = transactionService.getConnection();
  const senderPubkey = keypair.publicKey;

  const currentBalance = BigInt(await conn.getBalance(senderPubkey));
  if (currentBalance <= TRANSFER_GAS_RESERVE_LAMPORTS) {
    throw new Error(
      `Saldo SOL atual (${currentBalance}) insuficiente pra cobrir gas + transfer. ` +
        `Não há nada pra reenviar.`,
    );
  }

  const maxSendable = currentBalance - TRANSFER_GAS_RESERVE_LAMPORTS;
  const amountToSend =
    lamportsToSend !== undefined && lamportsToSend <= maxSendable
      ? lamportsToSend
      : maxSendable;

  if (amountToSend <= 0n) {
    throw new Error('Quantia a enviar resultou em zero ou negativo.');
  }

  const recipientPubkey = new PublicKey(recipientAddress);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderPubkey,
      toPubkey: recipientPubkey,
      lamports: amountToSend,
    }),
  );

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = senderPubkey;
  tx.sign(keypair);

  const result = await transactionService.broadcastSigned(tx);
  if (result.status !== 'confirmed') {
    throw new Error(
      `Reenvio não confirmou on-chain (hash ${result.hash || 'indisponível'}).`,
    );
  }

  return {
    transferTxHash: result.hash,
    solSentLamports: String(amountToSend),
  };
}
