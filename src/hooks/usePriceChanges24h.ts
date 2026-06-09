import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

// Cache versão 5: changes vêm direto da fonte primária (Jupiter para tokens
// Solana, GeckoTerminal para SOL), sem recompute via âncora. Garante paridade
// EXATA com Solflare.
const PRICE_CHANGES_CACHE_KEY = 'priceChangesCache.v5';
const LEGACY_CACHE_KEYS = ['priceChangesCache', 'priceChangesCache.v2', 'priceChangesCache.v3', 'priceChangesCache.v4'];
const CACHE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

const SOLANA_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BDC: 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',
  ESCT: 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',
  BRT: '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',
};

const INTERNAL_MINTS: Record<string, string> = {
  BDC: SOLANA_MINTS.BDC,
  ESCT: SOLANA_MINTS.ESCT,
  BRT: SOLANA_MINTS.BRT,
};

const COINGECKO_TO_SYM: Record<string, string> = {
  solana: 'SOL', tether: 'USDT', 'usd-coin': 'USDC',
  bitcoin: 'BTC', ethereum: 'ETH', binancecoin: 'BNB',
};

// AbortSignal.timeout() não existe em Hermes <0.74. Timeout manual via controller
// evita silenciamento eterno do fetcher em runtimes legadas.
const fetchWithTimeout = async (url: string, ms = 6_000) => {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
};

/**
 * Hook compartilhado de variação 24h por símbolo de token.
 *
 * PRIORIDADE DE FONTES (alinhada com o que Solflare mostra):
 *   1. GeckoTerminal (apenas SOL) — pool de maior liquidez onde SOL é base_token.
 *   2. Jupiter v3 — primária para BDC/ESCT/BRT/USDC/USDT e fallback para SOL.
 *   3. Binance — backup para BTC/ETH/BNB.
 *   4. CoinGecko — fallback final para majors.
 *   5. DexScreener — fallback final para internos se Jupiter falhar.
 *
 * Polling de 10s + persistência em AsyncStorage para hidratação instantânea
 * no próximo mount. `refresh()` força fetch imediato (use em useFocusEffect).
 */
export function usePriceChanges24h() {
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({});
  const fetchRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    LEGACY_CACHE_KEYS.forEach(k => { AsyncStorage.removeItem(k).catch(() => {}); });

    AsyncStorage.getItem(PRICE_CHANGES_CACHE_KEY).then(raw => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { ts: number; data: Record<string, number> };
        if (Date.now() - parsed.ts < CACHE_TTL_MS && parsed.data && typeof parsed.data === 'object') {
          setPriceChanges(parsed.data);
        }
      } catch {}
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchChanges = async () => {
      try {
        const internalMints = Object.values(INTERNAL_MINTS);
        const coingeckoIds = Object.keys(COINGECKO_TO_SYM);
        const solanaMintList = Object.values(SOLANA_MINTS).join(',');
        const solanaMintToSym: Record<string, string> = Object.fromEntries(
          Object.entries(SOLANA_MINTS).map(([sym, mint]) => [mint, sym]),
        );

        const [geckoSolRes, jupiterRes, binanceRes, coingeckoRes, dexRes] = await Promise.allSettled([
          fetchWithTimeout(
            `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${SOLANA_MINTS.SOL}/pools?page=1`,
          ).then(r => r.ok ? r.json() : { data: [] }),
          fetchWithTimeout(
            `https://lite-api.jup.ag/price/v3?ids=${solanaMintList}`,
          ).then(r => r.ok ? r.json() : {}),
          fetchWithTimeout(
            `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'USDCUSDT']))}`,
          ).then(r => r.ok ? r.json() : []),
          fetchWithTimeout(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds.join(',')}&vs_currencies=usd&include_24hr_change=true`,
          ).then(r => r.ok ? r.json() : {}),
          fetchWithTimeout(
            `https://api.dexscreener.com/latest/dex/tokens/${internalMints.join(',')}`,
          ).then(r => r.ok ? r.json() : { pairs: [] }),
        ]);

        if (cancelled) return;
        const changes: Record<string, number> = {};

        // Pools tipo ONDO/SOL têm SOL como quote_token e o
        // price_change_percentage.h24 reflete a variação do BASE, não SOL.
        // Filtra apenas pools onde SOL é base_token.
        if (geckoSolRes.status === 'fulfilled' && geckoSolRes.value && Array.isArray((geckoSolRes.value as any).data)) {
          const pools = (geckoSolRes.value as { data: any[] }).data;
          const SOL_MINT = SOLANA_MINTS.SOL;
          let best: { change: number; liq: number } | null = null;
          for (const pool of pools) {
            const attrs = pool?.attributes;
            const baseId = pool?.relationships?.base_token?.data?.id;
            if (!attrs || typeof baseId !== 'string' || !baseId.endsWith(SOL_MINT)) continue;
            const liq = parseFloat(attrs.reserve_in_usd ?? '0');
            const h24 = attrs.price_change_percentage?.h24;
            if (h24 === undefined || h24 === null) continue;
            const change = typeof h24 === 'number' ? h24 : parseFloat(h24);
            if (isNaN(change)) continue;
            if (!best || liq > best.liq) best = { change, liq };
          }
          if (best) changes.SOL = best.change;
        }

        if (jupiterRes.status === 'fulfilled' && jupiterRes.value && typeof jupiterRes.value === 'object') {
          const jup = jupiterRes.value as Record<string, { priceChange24h?: number }>;
          for (const [mint, obj] of Object.entries(jup)) {
            const sym = solanaMintToSym[mint];
            if (!sym) continue;
            const pct = obj?.priceChange24h;
            if (changes[sym] === undefined && typeof pct === 'number' && !isNaN(pct)) {
              changes[sym] = pct;
            }
          }
        }

        if (binanceRes.status === 'fulfilled' && Array.isArray(binanceRes.value)) {
          for (const item of binanceRes.value as { symbol: string; priceChangePercent: string }[]) {
            const sym = item.symbol.replace('USDT', '');
            const pct = parseFloat(item.priceChangePercent);
            if (changes[sym] === undefined && !isNaN(pct)) changes[sym] = pct;
          }
        }

        if (coingeckoRes.status === 'fulfilled') {
          const cg = coingeckoRes.value as Record<string, { usd_24h_change?: number }>;
          for (const [id, obj] of Object.entries(cg || {})) {
            const sym = COINGECKO_TO_SYM[id];
            if (!sym) continue;
            const pct = obj?.usd_24h_change;
            if (changes[sym] === undefined && typeof pct === 'number') changes[sym] = pct;
          }
        }

        if (dexRes.status === 'fulfilled') {
          const dex = dexRes.value as { pairs?: any[] };
          const mintToSym: Record<string, string> = Object.fromEntries(
            Object.entries(INTERNAL_MINTS).map(([sym, mint]) => [mint, sym]),
          );
          const bestPerMint: Record<string, { change: number; liq: number }> = {};
          for (const pair of dex.pairs ?? []) {
            const mint = pair?.baseToken?.address;
            const raw = pair?.priceChange?.h24;
            if (raw === undefined || raw === null) continue;
            const change = typeof raw === 'number' ? raw : parseFloat(raw);
            const liq = pair?.liquidity?.usd ?? 0;
            if (!mint || isNaN(change)) continue;
            if (!bestPerMint[mint] || liq > bestPerMint[mint].liq) {
              bestPerMint[mint] = { change, liq };
            }
          }
          for (const [mint, { change }] of Object.entries(bestPerMint)) {
            const sym = mintToSym[mint];
            if (!sym) continue;
            if (changes[sym] === undefined) changes[sym] = change;
          }
        }

        if (!cancelled && Object.keys(changes).length > 0) {
          const ts = Date.now();
          setPriceChanges(prev => {
            const merged = { ...prev, ...changes };
            AsyncStorage.setItem(
              PRICE_CHANGES_CACHE_KEY,
              JSON.stringify({ ts, data: merged }),
            ).catch(() => {});
            return merged;
          });
        }
      } catch {
        // Silencioso: variação 24h é informativa, não crítica.
      }
    };

    fetchRef.current = fetchChanges;
    fetchChanges();
    const interval = setInterval(fetchChanges, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); fetchRef.current = null; };
  }, []);

  const refresh = useCallback(() => { fetchRef.current?.(); }, []);

  return { priceChanges, refresh };
}
