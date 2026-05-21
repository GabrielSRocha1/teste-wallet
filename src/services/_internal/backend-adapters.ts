/**
 * backend-adapters.ts — Implementação HTTP dos `SwapAdapters`.
 *
 * Cada adapter chama um endpoint do backend Verum Swap (verum-swap/backend).
 * Os adapters são "thin": não compõem retry/timeout/breaker — isso é feito
 * pelo pipeline (`executeSwap`) via `callRpc`/`callOneShot`.
 *
 * Decisões de design:
 *  - `applyBlockhashTo` é no-op: o blockhash já está embutido na TX retornada
 *    por `/build`. Substituir exigiria desserializar/recompilar a mensagem e
 *    invalidaria o trabalho do build.
 *  - `refreshBlockhash` reusa o `lastValidBlockHeight` retornado pelo `/build`
 *    (cached em closure), garantindo que `confirm` use a janela de expiração
 *    correta da TX em voo.
 *  - `send` deriva `Idempotency-Key` via SHA-256(signedTx) — chave estável,
 *    deterministic, idêntica para retries da MESMA TX assinada.
 *  - `sign` é injetado pelo caller (keypair vive no keyManager, fora deste módulo).
 */

import { CircuitBreaker } from './circuit-breaker';
import { createLogger } from './logger';
import { InMemoryIdempotencyStore } from './swap-pipeline';
import type {
  AdapterContext,
  BlockhashInfo,
  ConfirmResult,
  ConfirmState,
  ExpectedOutcome,
  IdempotencyStore,
  Quote,
  SerializedTx,
  SignedTx,
  SimulateResult,
  SolanaNetwork,
  SwapAdapters,
  SwapRequest,
  TxSignature,
  VerifyResult,
} from './swap-pipeline.types';

const log = createLogger('BackendAdapters');

export interface BackendSwapAdaptersOptions {
  /** Base URL do backend Verum Swap (ex: https://api.verumcrypto.com). */
  apiBaseUrl: string;
  /** Assinatura local — recebe SerializedTx, retorna SignedTx. */
  signTransaction: (tx: SerializedTx, ctx: AdapterContext) => Promise<SignedTx>;
  /** Implementação de fetch (default: globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /** Circuit breaker compartilhado (default: novo). */
  circuitBreaker?: CircuitBreaker;
  /** Store de idempotency cliente (default: InMemory). */
  idempotencyStore?: IdempotencyStore;
  /** Source de tempo (default: Date.now). */
  now?: () => number;
}

interface InternalState {
  /** Cache do lastValidBlockHeight do `/build`, usado por `refreshBlockhash`. */
  builtLvbh: number | null;
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Idempotency key derivada por SHA-256(signed.serialized).
 * Determinística: a MESMA TX assinada → MESMA key (retries seguros).
 * 48 chars hex prefixados com 'verum-swap-' → 59 chars total (cabe no limite 256).
 *
 * Uso de `crypto-js` (já em deps) para portabilidade React Native + Node.
 */
function hashSignedTx(signed: SignedTx): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CryptoJS = require('crypto-js') as typeof import('crypto-js');
  const hash = CryptoJS.SHA256(signed.serialized).toString(CryptoJS.enc.Hex);
  return `verum-swap-${hash.slice(0, 48)}`;
}

export function createBackendSwapAdapters(opts: BackendSwapAdaptersOptions): SwapAdapters {
  const apiBase = opts.apiBaseUrl.replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createBackendSwapAdapters: fetch indisponível — forneça `fetchImpl`');
  }
  const nowFn = opts.now ?? Date.now;
  const state: InternalState = { builtLvbh: null };

  const headers = (ctx: AdapterContext, extra: Record<string, string> = {}): Record<string, string> => ({
    'x-correlation-id': ctx.correlationId,
    ...extra,
  });

  // ─── quote ───────────────────────────────────────────────────────────────────
  const quote = async (req: SwapRequest, ctx: AdapterContext): Promise<Quote> => {
    interface QuoteResponse {
      quote: {
        outAmount: string;
        otherAmountThreshold: string;
        priceImpactPct: string;
        [key: string]: unknown;
      };
      ttlMs: number;
      fetchedAt: number;
      verumFeeBps: number;
      verumTreasury: string;
    }
    const result = await postJson<QuoteResponse>(
      `${apiBase}/api/swap/quote`,
      {
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: req.inputAmount,
        slippageBps: req.slippageBps,
      },
      ctx.signal,
      fetchImpl,
      headers(ctx),
    );
    return {
      outAmount: result.quote.outAmount,
      minOutAmount: result.quote.otherAmountThreshold,
      priceImpactPct: Number.parseFloat(result.quote.priceImpactPct) || 0,
      fetchedAt: result.fetchedAt ?? nowFn(),
      ttlMs: result.ttlMs ?? 30_000,
      route: result.quote,
    };
  };

  // ─── buildTx ─────────────────────────────────────────────────────────────────
  const buildTx = async (
    quoteParam: Quote,
    req: SwapRequest,
    ctx: AdapterContext,
  ): Promise<SerializedTx> => {
    interface BuildResponse {
      serializedTx: string;
      lastValidBlockHeight: number;
      prioritizationFeeLamports?: number;
      feeAccountUsed: string | null;
    }
    const result = await postJson<BuildResponse>(
      `${apiBase}/api/swap/build`,
      {
        quoteResponse: quoteParam.route,
        userPublicKey: req.userPublicKey,
        wrapAndUnwrapSol: true,
        asLegacyTransaction: false,
      },
      ctx.signal,
      fetchImpl,
      headers(ctx),
    );
    state.builtLvbh = result.lastValidBlockHeight;
    return {
      serialized: result.serializedTx,
      isVersioned: true,
      meta: {
        lastValidBlockHeight: result.lastValidBlockHeight,
        feeAccountUsed: result.feeAccountUsed,
        prioritizationFeeLamports: result.prioritizationFeeLamports,
      },
    };
  };

  // ─── simulate ────────────────────────────────────────────────────────────────
  const simulate = async (tx: SerializedTx, ctx: AdapterContext): Promise<SimulateResult> => {
    interface SimulateResponse {
      err: unknown;
      logs: string[];
      unitsConsumed?: number;
      slot: number;
    }
    const result = await postJson<SimulateResponse>(
      `${apiBase}/api/swap/simulate`,
      { signedTxBase64: tx.serialized, sigVerify: false, replaceRecentBlockhash: false },
      ctx.signal,
      fetchImpl,
      headers(ctx),
    );
    return {
      err: result.err as SimulateResult['err'],
      logs: result.logs ?? [],
      unitsConsumed: result.unitsConsumed,
    };
  };

  // ─── refreshBlockhash ────────────────────────────────────────────────────────
  const refreshBlockhash = async (
    _network: SolanaNetwork,
    ctx: AdapterContext,
  ): Promise<BlockhashInfo> => {
    // Prefere reusar o lvbh do `/build` — o blockhash REAL está embutido na TX.
    if (state.builtLvbh !== null) {
      return { blockhash: 'built-in', lastValidBlockHeight: state.builtLvbh };
    }
    // Fallback: chamada explícita ao backend (cobre cenário em que buildTx
    // ainda não rodou — não acontece no pipeline canônico mas é defensivo).
    interface BlockhashResponse {
      blockhash: string;
      lastValidBlockHeight: number;
      commitment: string;
    }
    const result = await getJson<BlockhashResponse>(
      `${apiBase}/api/swap/blockhash?commitment=finalized`,
      ctx.signal,
      fetchImpl,
    );
    return {
      blockhash: result.blockhash,
      lastValidBlockHeight: result.lastValidBlockHeight,
    };
  };

  // ─── applyBlockhashTo ───────────────────────────────────────────────────────
  // No-op: o blockhash já está embutido na TX retornada pelo `/build`.
  // Substituir exigiria recompilar a mensagem (e invalidaria o trabalho do build).
  const applyBlockhashTo = (tx: SerializedTx, _bh: BlockhashInfo): SerializedTx => tx;

  // ─── send (broadcast com Idempotency-Key) ────────────────────────────────────
  const send = async (signed: SignedTx, ctx: AdapterContext): Promise<TxSignature> => {
    const idempotencyKey = hashSignedTx(signed);
    interface BroadcastResponse {
      signature: string;
      broadcastAt: number;
    }
    const result = await postJson<BroadcastResponse>(
      `${apiBase}/api/swap/broadcast`,
      { signedTxBase64: signed.serialized, skipPreflight: false },
      ctx.signal,
      fetchImpl,
      headers(ctx, { 'idempotency-key': idempotencyKey }),
    );
    log.debug('send completed', {
      correlationId: ctx.correlationId,
      signature: result.signature,
      idempotencyKey,
    });
    return result.signature;
  };

  // ─── confirm ─────────────────────────────────────────────────────────────────
  const confirm = async (
    signature: TxSignature,
    bh: BlockhashInfo,
    ctx: AdapterContext,
  ): Promise<ConfirmResult> => {
    interface ConfirmResponse {
      state: ConfirmState;
      slot?: number;
      err?: unknown;
    }
    const result = await postJson<ConfirmResponse>(
      `${apiBase}/api/swap/confirm`,
      {
        signature,
        lastValidBlockHeight: bh.lastValidBlockHeight,
        pollIntervalMs: 2_000,
        timeoutMs: 60_000,
      },
      ctx.signal,
      fetchImpl,
      headers(ctx),
    );
    return {
      state: result.state,
      slot: result.slot,
      err: (result.err ?? null) as ConfirmResult['err'],
    };
  };

  // ─── verify ──────────────────────────────────────────────────────────────────
  const verify = async (
    signature: TxSignature,
    _expected: ExpectedOutcome,
    ctx: AdapterContext,
  ): Promise<VerifyResult> => {
    interface VerifyResponse {
      ok: boolean;
      reason: string | null;
      observedOutAmount: string;
      deltaBps: number;
    }
    const result = await postJson<VerifyResponse>(
      `${apiBase}/api/swap/verify`,
      { signature },
      ctx.signal,
      fetchImpl,
      headers(ctx),
    );
    return {
      ok: result.ok,
      observedOutAmount: result.observedOutAmount,
      deltaBps: result.deltaBps,
      reason: result.reason ?? undefined,
    };
  };

  return {
    quote,
    buildTx,
    simulate,
    refreshBlockhash,
    applyBlockhashTo,
    sign: opts.signTransaction,
    send,
    confirm,
    verify,
    now: nowFn,
    idempotencyStore: opts.idempotencyStore ?? new InMemoryIdempotencyStore(),
    circuitBreaker:
      opts.circuitBreaker ??
      new CircuitBreaker({
        name: 'backend-swap',
        failureThreshold: 5,
        cooldownMs: 30_000,
        rollingWindowMs: 60_000,
      }),
  };
}
