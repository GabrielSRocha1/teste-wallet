/**
 * jupiter.ts — Cliente HTTP tipado para Jupiter Swap API.
 *
 * Princípios:
 *  - TODA resposta é validada por Zod antes de ser exposta.
 *  - Circuit breaker, retry e timeout aplicados em cada chamada.
 *  - Constructor SEM dependência de env (puro, testável).
 *  - Factory `createJupiterClientFromEnv` para wiring de produção.
 */

import { z } from 'zod';
import { CircuitBreaker } from '../_internal/circuit-breaker';
import type { Env } from '../_internal/env';
import { createLogger } from '../_internal/logger';
import { isRetryableRpcError, withRetry } from '../_internal/retry';
import { withTimeout } from '../_internal/timeout';

const log = createLogger('JupiterAdapter');

const quoteResponseSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    otherAmountThreshold: z.string(),
    swapMode: z.string(),
    slippageBps: z.number(),
    priceImpactPct: z.string(),
    routePlan: z.array(z.unknown()),
    contextSlot: z.number().optional(),
    timeTaken: z.number().optional(),
    platformFee: z
      .object({
        amount: z.string(),
        feeBps: z.number(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export type JupiterQuoteResponse = z.infer<typeof quoteResponseSchema>;

const swapResponseSchema = z.object({
  swapTransaction: z.string(),
  lastValidBlockHeight: z.number(),
  prioritizationFeeLamports: z.number().optional(),
  computeUnitLimit: z.number().optional(),
});

export type JupiterSwapResponse = z.infer<typeof swapResponseSchema>;

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  /** Quantidade em unidades atômicas (string para preservar precisão). */
  amount: string;
  slippageBps: number;
  /** Plataforma fee em basis points (Verum aplica 200 = 2%). */
  platformFeeBps?: number;
  /** ATA da treasury que receberá o fee. */
  feeAccount?: string;
  /** Restringe ao melhor DEX (false = aggregator usa múltiplas rotas). */
  onlyDirectRoutes?: boolean;
  /** `ExactIn` (default) ou `ExactOut`. */
  swapMode?: 'ExactIn' | 'ExactOut';
}

export interface JupiterSwapParams {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  computeUnitPriceMicroLamports?: number | 'auto';
  asLegacyTransaction?: boolean;
  feeAccount?: string;
  prioritizationFeeLamports?: number | { autoMultiplier?: number };
}

export interface JupiterClientOptions {
  baseUrl: string;
  apiKey?: string;
  breaker?: CircuitBreaker;
  quoteTimeoutMs?: number;
  swapTimeoutMs?: number;
  maxAttempts?: number;
  /** Permite injetar fetch alternativo (default: global fetch). */
  fetchImpl?: typeof fetch;
}

export class JupiterClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly breaker: CircuitBreaker;
  private readonly quoteTimeoutMs: number;
  private readonly swapTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: JupiterClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.breaker =
      opts.breaker ??
      new CircuitBreaker({
        name: 'jupiter',
        failureThreshold: 5,
        cooldownMs: 30_000,
        rollingWindowMs: 60_000,
      });
    this.quoteTimeoutMs = opts.quoteTimeoutMs ?? 10_000;
    this.swapTimeoutMs = opts.swapTimeoutMs ?? 15_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get circuitState(): string {
    return this.breaker.state;
  }

  async getQuote(params: JupiterQuoteParams, signal?: AbortSignal): Promise<JupiterQuoteResponse> {
    return this.breaker.execute(() =>
      withRetry(
        () =>
          withTimeout(this._fetchQuote(params, signal), this.quoteTimeoutMs, 'jupiter.getQuote'),
        {
          maxAttempts: this.maxAttempts,
          signal,
          isRetryable: isRetryableRpcError,
          onRetry: ({ attempt, error, delayMs }) =>
            log.warn('getQuote retry', {
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            }),
        },
      ),
    );
  }

  async getSwapTransaction(
    params: JupiterSwapParams,
    signal?: AbortSignal,
  ): Promise<JupiterSwapResponse> {
    return this.breaker.execute(() =>
      withRetry(
        () =>
          withTimeout(this._fetchSwap(params, signal), this.swapTimeoutMs, 'jupiter.getSwap'),
        {
          maxAttempts: this.maxAttempts,
          signal,
          isRetryable: isRetryableRpcError,
          onRetry: ({ attempt, error, delayMs }) =>
            log.warn('getSwapTransaction retry', {
              attempt,
              delayMs,
              error: error instanceof Error ? error.message : String(error),
            }),
        },
      ),
    );
  }

  private async _fetchQuote(
    params: JupiterQuoteParams,
    signal?: AbortSignal,
  ): Promise<JupiterQuoteResponse> {
    const url = new URL(`${this.baseUrl}/swap/v1/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount);
    url.searchParams.set('slippageBps', String(params.slippageBps));
    if (params.platformFeeBps !== undefined) {
      url.searchParams.set('platformFeeBps', String(params.platformFeeBps));
    }
    if (params.onlyDirectRoutes !== undefined) {
      url.searchParams.set('onlyDirectRoutes', String(params.onlyDirectRoutes));
    }
    if (params.swapMode) {
      url.searchParams.set('swapMode', params.swapMode);
    }

    const res = await this.fetchImpl(url.toString(), {
      method: 'GET',
      headers: this._headers(),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Jupiter quote failed: HTTP ${res.status} ${res.statusText} ${body.slice(0, 300)}`,
      );
    }
    const json = await res.json();
    return quoteResponseSchema.parse(json);
  }

  private async _fetchSwap(
    params: JupiterSwapParams,
    signal?: AbortSignal,
  ): Promise<JupiterSwapResponse> {
    const url = `${this.baseUrl}/swap/v1/swap`;
    const body = {
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
      asLegacyTransaction: params.asLegacyTransaction ?? false,
      ...(params.feeAccount ? { feeAccount: params.feeAccount } : {}),
      ...(params.computeUnitPriceMicroLamports !== undefined
        ? { computeUnitPriceMicroLamports: params.computeUnitPriceMicroLamports }
        : {}),
    };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Jupiter swap failed: HTTP ${res.status} ${res.statusText} ${text.slice(0, 300)}`,
      );
    }
    const json = await res.json();
    return swapResponseSchema.parse(json);
  }

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }
}

/** Wiring de produção — usa env validado. */
export function createJupiterClientFromEnv(env: Env): JupiterClient {
  return new JupiterClient({
    baseUrl: env.JUPITER_API_URL,
    apiKey: env.JUPITER_API_KEY,
  });
}
