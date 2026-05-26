import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Token Mints (Solana) ──────────────────────────────────────────────────
const TOKEN_MINTS: Record<string, string> = {
  SOL:  'So11111111111111111111111111111111111111112',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BDC:  'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
  ESCT: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
  BRT:  '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',
};
const INTERNAL_TOKENS = ['BDC', 'ESCT', 'BRT'];
const mintToSymbol = Object.fromEntries(Object.entries(TOKEN_MINTS).map(([s, m]) => [m, s]));

// ─── Helpers ──────────────────────────────────────────────────────────────
async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ─── Jupiter Price API v2 ─────────────────────────────────────────────────
async function fetchJupiter(): Promise<Record<string, number>> {
  const mints = Object.values(TOKEN_MINTS).join(',');
  const data = await fetchJson(`https://api.jup.ag/price/v2?ids=${mints}`);
  if (!data?.data) throw new Error('resposta inválida do Jupiter');

  const prices: Record<string, number> = { USDT: 1.0, USDC: 1.0 };
  for (const [symbol, mint] of Object.entries(TOKEN_MINTS)) {
    const p = data.data[mint]?.price;
    if (p != null) prices[symbol] = parseFloat(p);
  }
  return prices;
}

// ─── Binance (tokens de mercado) ──────────────────────────────────────────
async function fetchBinance(): Promise<Record<string, number>> {
  const symbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'USDCUSDT'];
  const data = await fetchJson(
    `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
  );
  const prices: Record<string, number> = { USDT: 1.0 };
  for (const item of data as { symbol: string; price: string }[]) {
    prices[item.symbol.replace('USDT', '')] = parseFloat(item.price);
  }
  return prices;
}

// ─── Helius DAS (getAssetBatch) ────────────────────────────────────────────
async function fetchHelius(apiKey: string): Promise<Record<string, number>> {
  const data = await fetchJson(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'price-batch',
        method: 'getAssetBatch',
        params: {
          ids: Object.values(TOKEN_MINTS),
          displayOptions: { showFungible: true },
        },
      }),
    },
  );

  if (!Array.isArray(data?.result)) throw new Error('resposta inválida do Helius');

  const prices: Record<string, number> = { USDT: 1.0, USDC: 1.0 };
  for (const [symbol, mint] of Object.entries(TOKEN_MINTS)) {
    const asset = (data.result as any[]).find((a: any) => a?.id === mint);
    const price: number | undefined = asset?.token_info?.price_info?.price_per_token;
    if (price != null && price > 0) prices[symbol] = price;
  }
  return prices;
}

// ─── DexScreener (BDC, ESCT, BRT) ────────────────────────────────────────
async function fetchDexScreener(symbols: string[]): Promise<Record<string, number>> {
  const mints = symbols.map(s => TOKEN_MINTS[s]).filter(Boolean).join(',');
  if (!mints) return {};

  const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mints}`);

  const pairsByMint: Record<string, any[]> = {};
  for (const pair of data?.pairs ?? []) {
    const mint: string = pair.baseToken?.address ?? '';
    if (!mint) continue;
    (pairsByMint[mint] ||= []).push(pair);
  }

  const prices: Record<string, number> = {};
  for (const [mint, pairs] of Object.entries(pairsByMint)) {
    const sym = mintToSymbol[mint];
    if (!sym) continue;
    const best = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const price = parseFloat(best?.priceUsd ?? '0');
    if (price > 0) prices[sym] = price;
  }
  return prices;
}

// ─── Forex (USD → BRL, PYG) ───────────────────────────────────────────────
async function fetchForex(): Promise<{ BRL: number; PYG: number }> {
  try {
    const data = await fetchJson('https://economia.awesomeapi.com.br/last/USD-BRL,USD-PYG');
    return {
      BRL: data.USDBRL?.ask ? parseFloat(data.USDBRL.ask) : 5.5,
      PYG: data.USDPYG?.ask ? parseFloat(data.USDPYG.ask) : 7500,
    };
  } catch {
    return { BRL: 5.5, PYG: 7500 };
  }
}

const ALLOWED_ORIGINS = [
  'https://verumcrypto.com',
  'https://www.verumcrypto.com',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

// ─── Handler principal ─────────────────────────────────────────────────────
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  setCors(_req, res);
  if (_req.method === 'OPTIONS') return res.status(200).end();

  try {
    const heliusKey = process.env.HELIUS_API_KEY ?? '';

    // ── Busca preços em USD com cascata ──────────────────────────────────
    let usdPrices: Record<string, number> = {};

    // 1. Helius DAS (principal — cobre tokens internos via Solana)
    if (heliusKey) {
      try {
        const h = await fetchHelius(heliusKey);
        if (Object.keys(h).length > 2) usdPrices = h;
      } catch { /* fallback */ }
    }

    // 2. Jupiter v2 (fallback geral)
    if (Object.keys(usdPrices).length <= 2) {
      try {
        const j = await fetchJupiter();
        if (Object.keys(j).length > 2) usdPrices = j;
      } catch { /* fallback */ }
    }

    // 3. Binance (último recurso para tokens de mercado)
    if (Object.keys(usdPrices).length <= 2) {
      try { usdPrices = await fetchBinance(); } catch { /* fallback */ }
    }

    // 4. Suplementa BDC, ESCT, BRT via DexScreener se ausentes
    const missing = INTERNAL_TOKENS.filter(t => !usdPrices[t] || usdPrices[t] === 0);
    if (missing.length > 0) {
      try {
        const dex = await fetchDexScreener(missing);
        Object.assign(usdPrices, dex);
      } catch { /* ignora */ }
    }

    // ── Busca forex ──────────────────────────────────────────────────────
    const forex = await fetchForex();

    // ── Monta mapa final ─────────────────────────────────────────────────
    const priceMap: Record<string, { USD: number; BRL: number; PYG: number }> = {};
    for (const [token, usd] of Object.entries(usdPrices)) {
      priceMap[token] = {
        USD: usd,
        BRL: parseFloat((usd * forex.BRL).toFixed(6)),
        PYG: parseFloat((usd * forex.PYG).toFixed(2)),
      };
    }

    return res.status(200).json({
      prices: priceMap,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/prices] Erro:', err?.message);
    return res.status(500).json({ error: 'Falha ao buscar preços' });
  }
}
