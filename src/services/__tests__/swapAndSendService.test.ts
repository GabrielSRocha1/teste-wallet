/**
 * swapAndSendService.test.ts — testes do orquestrador swap → SOL → transfer.
 *
 * Estratégia:
 *   - `transactionService` é completamente mockado via `vi.hoisted` + `vi.mock`,
 *     porque seu módulo arrasta supabase/react-native (mesmo motivo dos
 *     comentários em verum-fee.test.ts).
 *   - `VersionedTransaction.deserialize` é shimado pra devolver um stub
 *     manipulável — o serviço não inspeciona internals dele.
 *   - Keypair/PublicKey/Transaction/SystemProgram seguem reais (puros JS).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    jupiterQuote: vi.fn(),
    jupiterBuildSwap: vi.fn(),
    deriveTreasuryFeeAccount: vi.fn(),
    broadcastSigned: vi.fn(),
    getBalance: vi.fn(),
    getLatestBlockhash: vi.fn(),
  };
});

vi.mock('../transactionService', () => {
  const fakeConn = {
    getBalance: mocks.getBalance,
    getLatestBlockhash: mocks.getLatestBlockhash,
  };
  const svc = {
    SOL_NATIVE_MINT: 'So11111111111111111111111111111111111111112',
    jupiterQuote: mocks.jupiterQuote,
    jupiterBuildSwap: mocks.jupiterBuildSwap,
    deriveTreasuryFeeAccount: mocks.deriveTreasuryFeeAccount,
    broadcastSigned: mocks.broadcastSigned,
    getConnection: () => fakeConn,
  };
  return {
    default: svc,
    VERUM_FEE_BPS: 200,
  };
});

// VersionedTransaction.deserialize precisa devolver algo signável. Stubamos o
// método estático sem quebrar Keypair/Transaction/SystemProgram.
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual<any>('@solana/web3.js');

  class StubVersionedTx {
    message: { recentBlockhash: string };
    signatures: Uint8Array[];
    sign: ReturnType<typeof vi.fn>;
    constructor() {
      this.message = { recentBlockhash: '' };
      this.signatures = [new Uint8Array(64)];
      this.sign = vi.fn();
    }
    static deserialize(_bytes: Uint8Array) {
      return new StubVersionedTx();
    }
  }

  return {
    ...actual,
    VersionedTransaction: StubVersionedTx,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Pubkeys/blockhashes precisam ser base58 válido — qualquer caractere fora do
// alfabeto base58 (ex.: '-') faz `Message.serialize` quebrar antes do sign.
const FAKE_RECIPIENT = '11111111111111111111111111111111'; // System program (32 zeros)
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const FAKE_BLOCKHASH = 'EETUBaJSCqYBb44Vt2bjf5ggp6c91kHvxJTRsLqV1ZbS';

function makeKeypair(): Keypair {
  return Keypair.generate();
}

function baseQuoteResponse(overrides: Partial<{ outAmount: string; priceImpactPct: string }> = {}) {
  return {
    outAmount: '54000000', // 0.054 SOL em lamports
    priceImpactPct: '0.001',
    inputMint: USDC_MINT,
    outputMint: SOL_NATIVE_MINT,
    platformFee: { amount: '1080000', feeBps: 200 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults razoáveis pra cada call mockado
  mocks.jupiterQuote.mockResolvedValue(baseQuoteResponse());
  mocks.jupiterBuildSwap.mockResolvedValue({
    swapTransaction: Buffer.from('fake-tx-bytes').toString('base64'),
    lastValidBlockHeight: 123_456,
  });
  mocks.deriveTreasuryFeeAccount.mockResolvedValue('TreasuryATA1111111111111111111111111111111');
  mocks.broadcastSigned.mockResolvedValue({ status: 'confirmed', hash: 'swap-tx-hash' });
  mocks.getBalance.mockResolvedValue(0); // override por teste
  mocks.getLatestBlockhash.mockResolvedValue({
    blockhash: FAKE_BLOCKHASH,
    lastValidBlockHeight: 123_456,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// quoteSwapToSol
// ──────────────────────────────────────────────────────────────────────────────

describe('quoteSwapToSol', () => {
  it('chama Jupiter com platformFeeBps=200 e slippage default 50', async () => {
    const { quoteSwapToSol } = await import('../swapAndSendService');
    await quoteSwapToSol({ inputMint: USDC_MINT, inputAmountAtomic: '10000000' });

    expect(mocks.jupiterQuote).toHaveBeenCalledWith({
      inputMint: USDC_MINT,
      outputMint: SOL_NATIVE_MINT,
      amount: '10000000',
      slippageBps: 50,
      platformFeeBps: 200,
    });
  });

  it('respeita slippageBps customizado', async () => {
    const { quoteSwapToSol } = await import('../swapAndSendService');
    await quoteSwapToSol({
      inputMint: USDC_MINT,
      inputAmountAtomic: '10000000',
      slippageBps: 100,
    });
    expect(mocks.jupiterQuote).toHaveBeenCalledWith(
      expect.objectContaining({ slippageBps: 100 }),
    );
  });

  it('retorna shape esperado (lamports, SOL UI, slippage, fetchedAt)', async () => {
    const { quoteSwapToSol } = await import('../swapAndSendService');
    const before = Date.now();
    const q = await quoteSwapToSol({ inputMint: USDC_MINT, inputAmountAtomic: '10000000' });

    expect(q.outAmountLamports).toBe('54000000');
    expect(q.outAmountSol).toBeCloseTo(0.054, 6);
    expect(q.priceImpactPct).toBeCloseTo(0.001, 6);
    expect(q.slippageBps).toBe(50);
    expect(q.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(q.inputMint).toBe(USDC_MINT);
    expect(q.jupiterRaw).toBeDefined();
  });

  it('rejeita quando outAmount é "0"', async () => {
    mocks.jupiterQuote.mockResolvedValueOnce(baseQuoteResponse({ outAmount: '0' }));
    const { quoteSwapToSol } = await import('../swapAndSendService');
    await expect(
      quoteSwapToSol({ inputMint: USDC_MINT, inputAmountAtomic: '10000000' }),
    ).rejects.toThrow(/outAmount/);
  });

  it('propaga erro de rede do Jupiter', async () => {
    mocks.jupiterQuote.mockRejectedValueOnce(new Error('Jupiter quote 502: gateway down'));
    const { quoteSwapToSol } = await import('../swapAndSendService');
    await expect(
      quoteSwapToSol({ inputMint: USDC_MINT, inputAmountAtomic: '10000000' }),
    ).rejects.toThrow(/Jupiter quote 502/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// executeSwapAndSend
// ──────────────────────────────────────────────────────────────────────────────

describe('executeSwapAndSend', () => {
  async function makeQuote(): Promise<any> {
    const { quoteSwapToSol } = await import('../swapAndSendService');
    return quoteSwapToSol({ inputMint: USDC_MINT, inputAmountAtomic: '10000000' });
  }

  it('happy path: swap confirma → mede delta SOL → envia SOL ao destino', async () => {
    const { executeSwapAndSend } = await import('../swapAndSendService');
    const quote = await makeQuote();

    // pre = 1_000_000 lamports; post = 1_000_000 + 54_000_000 = 55_000_000
    mocks.getBalance
      .mockResolvedValueOnce(1_000_000) // pre-swap
      .mockResolvedValueOnce(55_000_000); // post-swap

    mocks.broadcastSigned
      .mockResolvedValueOnce({ status: 'confirmed', hash: 'swap-hash' })
      .mockResolvedValueOnce({ status: 'confirmed', hash: 'transfer-hash' });

    const result = await executeSwapAndSend({
      quote,
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
    });

    expect(result.swapTxHash).toBe('swap-hash');
    expect(result.transferTxHash).toBe('transfer-hash');
    // 54_000_000 recebidos - 10_000 reserva = 53_990_000 enviados
    expect(result.solSentLamports).toBe('53990000');
    expect(result.preSwapSolLamports).toBe('1000000');
    expect(result.postSwapSolLamports).toBe('55000000');

    // 2 broadcasts: swap + transfer
    expect(mocks.broadcastSigned).toHaveBeenCalledTimes(2);
  });

  it('rejeita quote stale (> 30s)', async () => {
    const { executeSwapAndSend } = await import('../swapAndSendService');
    const quote = await makeQuote();
    // Força idade > TTL
    quote.fetchedAt = Date.now() - 31_000;

    await expect(
      executeSwapAndSend({
        quote,
        keypair: makeKeypair(),
        recipientAddress: FAKE_RECIPIENT,
      }),
    ).rejects.toThrow(/Cota[çc][ãa]o expirou/);

    expect(mocks.broadcastSigned).not.toHaveBeenCalled();
  });

  it('remove platformFee da quote se treasury não tem ATA pra wSOL', async () => {
    const { executeSwapAndSend } = await import('../swapAndSendService');
    const quote = await makeQuote();

    mocks.deriveTreasuryFeeAccount.mockResolvedValueOnce(undefined);
    mocks.getBalance.mockResolvedValueOnce(0).mockResolvedValueOnce(54_000_000);

    await executeSwapAndSend({
      quote,
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
    });

    // jupiterBuildSwap deve receber quoteResponse SEM platformFee
    const callArg = mocks.jupiterBuildSwap.mock.calls[0][0];
    expect(callArg.quoteResponse.platformFee).toBeUndefined();
    expect(callArg.feeAccount).toBeUndefined();
  });

  it('swap falha (não confirma) → não tenta transfer, lança erro', async () => {
    const { executeSwapAndSend } = await import('../swapAndSendService');
    const quote = await makeQuote();

    mocks.getBalance.mockResolvedValueOnce(0);
    mocks.broadcastSigned.mockResolvedValueOnce({
      status: 'failed',
      hash: '',
    });

    await expect(
      executeSwapAndSend({
        quote,
        keypair: makeKeypair(),
        recipientAddress: FAKE_RECIPIENT,
      }),
    ).rejects.toThrow(/Swap n[ãa]o confirmou/);

    expect(mocks.broadcastSigned).toHaveBeenCalledTimes(1);
  });

  it('swap confirma mas SOL recebido ≤ gas reserve → TransferAfterSwapFailedError', async () => {
    const { executeSwapAndSend, TransferAfterSwapFailedError } = await import(
      '../swapAndSendService'
    );
    const quote = await makeQuote();

    // delta = 5_000 lamports (menor que reserva de 10_000)
    mocks.getBalance.mockResolvedValueOnce(0).mockResolvedValueOnce(5_000);
    mocks.broadcastSigned.mockResolvedValueOnce({ status: 'confirmed', hash: 'swap-hash' });

    const err = await executeSwapAndSend({
      quote,
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
    }).catch(e => e);

    expect(err).toBeInstanceOf(TransferAfterSwapFailedError);
    expect(err.swapTxHash).toBe('swap-hash');
    expect(err.solInWalletLamports).toBe('5000');
    expect(err.recipientAddress).toBe(FAKE_RECIPIENT);
  });

  it('swap confirma + transfer falha no broadcast → TransferAfterSwapFailedError', async () => {
    const { executeSwapAndSend, TransferAfterSwapFailedError } = await import(
      '../swapAndSendService'
    );
    const quote = await makeQuote();

    mocks.getBalance.mockResolvedValueOnce(0).mockResolvedValueOnce(54_000_000);
    mocks.broadcastSigned
      .mockResolvedValueOnce({ status: 'confirmed', hash: 'swap-hash' })
      .mockResolvedValueOnce({ status: 'failed', hash: '' });

    const err = await executeSwapAndSend({
      quote,
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
    }).catch(e => e);

    expect(err).toBeInstanceOf(TransferAfterSwapFailedError);
    expect(err.swapTxHash).toBe('swap-hash');
    // Saldo inteiro de SOL preservado (não o delta) — é o que está na carteira
    expect(err.solInWalletLamports).toBe('54000000');
  });

  it('lança quando jupiterBuildSwap não devolve swapTransaction', async () => {
    const { executeSwapAndSend } = await import('../swapAndSendService');
    const quote = await makeQuote();

    mocks.jupiterBuildSwap.mockResolvedValueOnce({ lastValidBlockHeight: 0 });
    mocks.getBalance.mockResolvedValueOnce(0);

    await expect(
      executeSwapAndSend({
        quote,
        keypair: makeKeypair(),
        recipientAddress: FAKE_RECIPIENT,
      }),
    ).rejects.toThrow(/swapTransaction/);

    expect(mocks.broadcastSigned).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// retrySolTransfer
// ──────────────────────────────────────────────────────────────────────────────

describe('retrySolTransfer', () => {
  it('happy path: envia lamportsToSend solicitados', async () => {
    const { retrySolTransfer } = await import('../swapAndSendService');

    mocks.getBalance.mockResolvedValueOnce(60_000_000);
    mocks.broadcastSigned.mockResolvedValueOnce({ status: 'confirmed', hash: 'retry-hash' });

    const result = await retrySolTransfer({
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
      lamportsToSend: 50_000_000n,
    });

    expect(result.transferTxHash).toBe('retry-hash');
    expect(result.solSentLamports).toBe('50000000');
  });

  it('omite lamportsToSend → usa saldo - gas reserve', async () => {
    const { retrySolTransfer } = await import('../swapAndSendService');

    mocks.getBalance.mockResolvedValueOnce(50_000_000);
    mocks.broadcastSigned.mockResolvedValueOnce({ status: 'confirmed', hash: 'retry-hash' });

    const result = await retrySolTransfer({
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
    });
    // 50_000_000 - 10_000 = 49_990_000
    expect(result.solSentLamports).toBe('49990000');
  });

  it('lamportsToSend > saldo permitido → clampa pra max (saldo - gas)', async () => {
    const { retrySolTransfer } = await import('../swapAndSendService');

    mocks.getBalance.mockResolvedValueOnce(50_000_000);
    mocks.broadcastSigned.mockResolvedValueOnce({ status: 'confirmed', hash: 'retry-hash' });

    const result = await retrySolTransfer({
      keypair: makeKeypair(),
      recipientAddress: FAKE_RECIPIENT,
      lamportsToSend: 100_000_000n, // > saldo
    });
    expect(result.solSentLamports).toBe('49990000');
  });

  it('saldo ≤ gas reserve → erro claro, sem broadcast', async () => {
    const { retrySolTransfer } = await import('../swapAndSendService');

    mocks.getBalance.mockResolvedValueOnce(5_000); // < 10_000 reserve

    await expect(
      retrySolTransfer({
        keypair: makeKeypair(),
        recipientAddress: FAKE_RECIPIENT,
        lamportsToSend: 4_000n,
      }),
    ).rejects.toThrow(/insuficiente/);

    expect(mocks.broadcastSigned).not.toHaveBeenCalled();
  });

  it('broadcast não confirma → lança com hash', async () => {
    const { retrySolTransfer } = await import('../swapAndSendService');

    mocks.getBalance.mockResolvedValueOnce(50_000_000);
    mocks.broadcastSigned.mockResolvedValueOnce({ status: 'failed', hash: 'partial-hash' });

    await expect(
      retrySolTransfer({
        keypair: makeKeypair(),
        recipientAddress: FAKE_RECIPIENT,
      }),
    ).rejects.toThrow(/n[ãa]o confirmou/);
  });
});
