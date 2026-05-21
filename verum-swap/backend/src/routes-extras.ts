/**
 * routes-extras.ts — Rotas auxiliares de preços e saldos consumidas pelo app.
 *
 * Endpoints:
 *  - GET /api/prices                     → mapa { SOL: {USD,BRL,PYG}, ... }
 *  - GET /api/prices/binance?symbol=SOL  → { price: number }
 *  - GET /api/prices/coingecko?id=solana → { price: number }
 *  - GET /api/balances/:addr             → { sol, tokens: [{ mint, amount, decimals }] }
 *
 * Implementação simples (sem retry/breaker dedicados — esses endpoints são
 * read-only e o frontend já tem cascata de fallback própria).
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { type Request, type Response, Router } from 'express';
import type { Env } from './_internal/env';
import { createLogger } from './_internal/logger';

const log = createLogger('RoutesExtras');

const TOKEN_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BDC: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
  ESCT: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
  BRT: '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',
};
const mintToSymbol = Object.fromEntries(
  Object.entries(TOKEN_MINTS).map(([s, m]) => [m, s]),
);

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000), ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchJupiterPrices(): Promise<Record<string, number>> {
  const mints = Object.values(TOKEN_MINTS).join(',');
  const data = await fetchJson(`https://api.jup.ag/price/v2?ids=${mints}`);
  const out: Record<string, number> = { USDT: 1, USDC: 1 };
  for (const [sym, mint] of Object.entries(TOKEN_MINTS)) {
    const p = data?.data?.[mint]?.price;
    if (p != null) out[sym] = parseFloat(p);
  }
  return out;
}

async function fetchBinanceTickers(): Promise<Record<string, number>> {
  const symbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'USDCUSDT'];
  const data = await fetchJson(
    `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
  );
  const out: Record<string, number> = { USDT: 1 };
  for (const item of data as { symbol: string; price: string }[]) {
    out[item.symbol.replace('USDT', '')] = parseFloat(item.price);
  }
  return out;
}

async function fetchDexScreenerPrices(symbols: string[]): Promise<Record<string, number>> {
  const mints = symbols.map((s) => TOKEN_MINTS[s]).filter(Boolean).join(',');
  if (!mints) return {};
  const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mints}`);
  const grouped: Record<string, any[]> = {};
  for (const pair of data?.pairs ?? []) {
    const mint: string = pair.baseToken?.address ?? '';
    if (!mint) continue;
    (grouped[mint] ||= []).push(pair);
  }
  const out: Record<string, number> = {};
  for (const [mint, pairs] of Object.entries(grouped)) {
    const sym = mintToSymbol[mint];
    if (!sym) continue;
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const price = parseFloat(best?.priceUsd ?? '0');
    if (price > 0) out[sym] = price;
  }
  return out;
}

async function fetchForex(): Promise<{ BRL: number; PYG: number }> {
  try {
    const data = await fetchJson('https://economia.awesomeapi.com.br/last/USD-BRL,USD-PYG');
    return {
      BRL: data?.USDBRL?.ask ? parseFloat(data.USDBRL.ask) : 5.5,
      PYG: data?.USDPYG?.ask ? parseFloat(data.USDPYG.ask) : 7500,
    };
  } catch {
    return { BRL: 5.5, PYG: 7500 };
  }
}

export interface ExtrasDeps {
  env: Env;
}

export function createExtraRoutes(deps: ExtrasDeps): Router {
  const router = Router();
  const rpcConn = new Connection(deps.env.SOLANA_RPC_PRIMARY, 'confirmed');

  // ── GET /api/prices — agregador completo (mesmo shape do api/prices.ts Vercel) ──
  router.get('/prices', async (_req: Request, res: Response) => {
    try {
      let usd: Record<string, number> = {};
      try {
        usd = await fetchJupiterPrices();
      } catch {}
      if (Object.keys(usd).length <= 2) {
        try {
          usd = await fetchBinanceTickers();
        } catch {}
      }
      const internalMissing = ['BDC', 'ESCT', 'BRT'].filter((t) => !usd[t] || usd[t] === 0);
      if (internalMissing.length > 0) {
        try {
          const dex = await fetchDexScreenerPrices(internalMissing);
          Object.assign(usd, dex);
        } catch {}
      }
      const forex = await fetchForex();
      const prices: Record<string, { USD: number; BRL: number; PYG: number }> = {};
      for (const [tok, v] of Object.entries(usd)) {
        prices[tok] = {
          USD: v,
          BRL: parseFloat((v * forex.BRL).toFixed(6)),
          PYG: parseFloat((v * forex.PYG).toFixed(2)),
        };
      }
      res.json({ prices, timestamp: new Date().toISOString() });
    } catch (err: any) {
      log.warn('prices failed', { error: err?.message });
      res.status(502).json({ error: 'PricesUpstreamFailure', message: err?.message });
    }
  });

  // ── GET /api/prices/binance?symbol=SOL ──
  router.get('/prices/binance', async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol ?? '').toUpperCase().trim();
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
      res.status(400).json({ error: 'InvalidSymbol' });
      return;
    }
    try {
      const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
      res.json({ price: parseFloat(data?.price ?? '0') });
    } catch (err: any) {
      res.status(502).json({ error: 'BinanceUpstreamFailure', message: err?.message, price: 0 });
    }
  });

  // ── GET /api/prices/coingecko?id=solana ──
  router.get('/prices/coingecko', async (req: Request, res: Response) => {
    const id = String(req.query.id ?? '').toLowerCase().trim();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) {
      res.status(400).json({ error: 'InvalidId' });
      return;
    }
    try {
      const data = await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      );
      res.json({ price: data?.[id]?.usd ?? 0 });
    } catch (err: any) {
      res.status(502).json({ error: 'CoinGeckoUpstreamFailure', message: err?.message, price: 0 });
    }
  });

  // ── GET /api/balances/:addr ──
  router.get('/balances/:addr', async (req: Request, res: Response) => {
    const addr = req.params.addr;
    let owner: PublicKey;
    try {
      owner = new PublicKey(addr);
    } catch {
      res.status(400).json({ error: 'InvalidAddress' });
      return;
    }

    try {
      const [lamports, splResult, spl2022Result] = await Promise.allSettled([
        rpcConn.getBalance(owner),
        rpcConn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
        rpcConn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);

      const sol =
        lamports.status === 'fulfilled' ? lamports.value / LAMPORTS_PER_SOL : 0;

      const tokens: Array<{ mint: string; amount: number; decimals: number }> = [];
      for (const r of [splResult, spl2022Result]) {
        if (r.status !== 'fulfilled') continue;
        for (const acc of r.value.value) {
          const info: any = acc.account.data.parsed?.info;
          const mint: string | undefined = info?.mint;
          const uiAmount: number | undefined = info?.tokenAmount?.uiAmount;
          const decimals: number | undefined = info?.tokenAmount?.decimals;
          if (mint && uiAmount != null && decimals != null && uiAmount > 0) {
            tokens.push({ mint, amount: uiAmount, decimals });
          }
        }
      }

      res.json({ sol, tokens });
    } catch (err: any) {
      log.warn('balances failed', { addr, error: err?.message });
      res.status(502).json({ error: 'BalancesUpstreamFailure', message: err?.message });
    }
  });

  return router;
}
