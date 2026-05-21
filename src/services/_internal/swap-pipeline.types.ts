/**
 * swap-pipeline.types.ts — Tipos do pipeline determinístico de swap.
 *
 * Contrato puro: nenhuma I/O acontece neste módulo. Todas as chamadas de rede
 * são injetadas via `SwapAdapters`, permitindo testar o pipeline integralmente
 * sem RPC real.
 */

import type { CircuitBreaker } from './circuit-breaker';

export type SolanaNetwork = 'mainnet' | 'devnet';

/* ── Entrada do usuário ── */
export interface SwapRequest {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  /** Quantidade em unidades atômicas (string para preservar precisão de BigInt). */
  inputAmount: string;
  /** Tolerância de slippage em basis points (50 = 0,5%). */
  slippageBps: number;
  network: SolanaNetwork;
  routePreference?: 'jupiter' | 'raydium' | 'auto';
}

/* ── Quote do aggregador ── */
export interface Quote {
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  /** Timestamp (ms epoch) em que a quote foi obtida. */
  fetchedAt: number;
  /** TTL em ms; se now - fetchedAt > ttlMs, quote é considerada stale. */
  ttlMs: number;
  /** Metadados opacos da rota (aggregator-specific). */
  route: Record<string, unknown>;
}

/* ── Transações ── */
export interface SerializedTx {
  serialized: string;
  isVersioned: boolean;
  meta?: Record<string, unknown>;
}

export interface SignedTx extends SerializedTx {
  signature: string;
}

export type TxSignature = string;

/* ── Simulação ── */
export interface SimulateResult {
  /** null se simulação ok; objeto/string com erro caso contrário. */
  err: Record<string, unknown> | string | null;
  logs: readonly string[];
  unitsConsumed?: number;
}

/* ── Blockhash ── */
export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
}

/* ── Confirmação ── */
export type ConfirmState = 'processed' | 'confirmed' | 'finalized' | 'expired' | 'failed';

export interface ConfirmResult {
  state: ConfirmState;
  slot?: number;
  err?: Record<string, unknown> | string | null;
}

/* ── Verificação ── */
export interface ExpectedOutcome {
  outputMint: string;
  minOutAmount: string;
}

export interface VerifyResult {
  ok: boolean;
  observedOutAmount: string;
  /** Delta entre observado e esperado, em basis points. */
  deltaBps: number;
  reason?: string;
}

/* ── Resultado final ── */
export interface SwapResult {
  signature: TxSignature;
  quote: Quote;
  simulated: SimulateResult;
  confirmed: ConfirmResult;
  verified: VerifyResult;
  blockhashUsed: BlockhashInfo;
  correlationId: string;
  startedAt: number;
  finishedAt: number;
}

/* ── Idempotency store ── */
export type IdempotencyState = 'in_flight' | 'completed' | 'failed';

export interface IdempotencyRecord {
  state: IdempotencyState;
  startedAt: number;
  result?: SwapResult;
  error?: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/* ── Contexto passado para cada adapter ── */
export interface AdapterContext {
  signal: AbortSignal;
  correlationId: string;
}

/* ── SwapAdapters: TODA chamada de rede é injetada aqui ── */
export interface SwapAdapters {
  quote(req: SwapRequest, ctx: AdapterContext): Promise<Quote>;
  buildTx(quote: Quote, req: SwapRequest, ctx: AdapterContext): Promise<SerializedTx>;
  simulate(tx: SerializedTx, ctx: AdapterContext): Promise<SimulateResult>;
  refreshBlockhash(network: SolanaNetwork, ctx: AdapterContext): Promise<BlockhashInfo>;
  /** Aplica blockhash a uma SerializedTx — síncrono, apenas manipulação de bytes. */
  applyBlockhashTo(tx: SerializedTx, bh: BlockhashInfo): SerializedTx;
  /** Assinatura local — SEM retry, SEM rede. */
  sign(tx: SerializedTx, ctx: AdapterContext): Promise<SignedTx>;
  /** Broadcast — one-shot, NUNCA executado mais de uma vez por idempotencyKey. */
  send(signed: SignedTx, ctx: AdapterContext): Promise<TxSignature>;
  /** Polling de confirmação com lastValidBlockHeight awareness. */
  confirm(signature: TxSignature, bh: BlockhashInfo, ctx: AdapterContext): Promise<ConfirmResult>;
  /** Re-verificação on-chain idempotente. */
  verify(signature: TxSignature, expected: ExpectedOutcome, ctx: AdapterContext): Promise<VerifyResult>;
  /** Fonte de tempo injetável (para testes determinísticos). */
  now(): number;
  idempotencyStore: IdempotencyStore;
  circuitBreaker: CircuitBreaker;
}

/* ── Opções do pipeline ── */
export interface PipelineOptions {
  quoteTtlMs?: number;
  quoteTimeoutMs?: number;
  buildTimeoutMs?: number;
  simulateTimeoutMs?: number;
  blockhashTimeoutMs?: number;
  signTimeoutMs?: number;
  sendTimeoutMs?: number;
  confirmTimeoutMs?: number;
  verifyTimeoutMs?: number;
  signal?: AbortSignal;
  correlationId?: string;
  idempotencyTtlMs?: number;
  /** Máx tentativas para etapas retryable (default 3). */
  maxRpcAttempts?: number;
}

/* ── Erros tipados ── */

export class SwapPipelineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string,
    public readonly stage: string,
  ) {
    super(message);
    this.name = 'SwapPipelineError';
  }
}

export class QuoteStaleError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly fetchedAt: number,
    public readonly ttlMs: number,
    public readonly observedAt: number,
  ) {
    super(
      `Quote stale: idade ${observedAt - fetchedAt}ms excede TTL ${ttlMs}ms`,
      'QUOTE_STALE',
      correlationId,
      'validateQuote',
    );
    this.name = 'QuoteStaleError';
  }
}

export class SlippageExceededError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly observedOut: string,
    public readonly minOut: string,
  ) {
    super(
      `Slippage excedido: out=${observedOut} < min=${minOut}`,
      'SLIPPAGE_EXCEEDED',
      correlationId,
      'validateQuote',
    );
    this.name = 'SlippageExceededError';
  }
}

export class SimulationFailedError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly simErr: SimulateResult['err'],
    public readonly logs: readonly string[],
  ) {
    super(
      `Simulação falhou: ${typeof simErr === 'string' ? simErr : JSON.stringify(simErr)}`,
      'SIMULATION_FAILED',
      correlationId,
      'simulate',
    );
    this.name = 'SimulationFailedError';
  }
}

export class BlockhashExpiredError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly signature: TxSignature,
    public readonly lastValidBlockHeight: number,
  ) {
    super(
      `Blockhash expirou antes da confirmação (sig=${signature}, lvbh=${lastValidBlockHeight})`,
      'BLOCKHASH_EXPIRED',
      correlationId,
      'confirm',
    );
    this.name = 'BlockhashExpiredError';
  }
}

export class ConfirmationFailedError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly signature: TxSignature,
    public readonly confirmErr: ConfirmResult['err'],
  ) {
    super(
      `Confirmação falhou (sig=${signature}): ${typeof confirmErr === 'string' ? confirmErr : JSON.stringify(confirmErr)}`,
      'CONFIRMATION_FAILED',
      correlationId,
      'confirm',
    );
    this.name = 'ConfirmationFailedError';
  }
}

export class VerificationFailedError extends SwapPipelineError {
  constructor(
    correlationId: string,
    public readonly signature: TxSignature,
    public readonly verification: VerifyResult,
  ) {
    super(
      `Verificação on-chain falhou: ${verification.reason ?? 'unknown'} (sig=${signature})`,
      'VERIFICATION_FAILED',
      correlationId,
      'verify',
    );
    this.name = 'VerificationFailedError';
  }
}

export class DuplicateInFlightError extends SwapPipelineError {
  constructor(correlationId: string, public readonly idempotencyKey: string) {
    super(
      `Swap idempotente em andamento (key=${idempotencyKey})`,
      'DUPLICATE_IN_FLIGHT',
      correlationId,
      'idempotency',
    );
    this.name = 'DuplicateInFlightError';
  }
}
