/**
 * api/solana-rpc.ts
 *
 * Proxy server-side pra Solana RPC. Mantém a chave do Helius (ou outro RPC
 * privado) fora do bundle do client.
 *
 * O client (transactionService → @solana/web3.js Connection) faz POST aqui
 * com JSON-RPC padrão. Repassamos pro upstream (Helius mainnet) e devolvemos
 * a resposta tal qual.
 *
 * Por que esse proxy existe:
 *   Os RPCs públicos (publicnode, ankr, api.mainnet-beta) bloqueiam
 *   `getTokenAccountsByOwner` com 403, quebrando o fetch de saldos SPL
 *   (USDC/USDT/BDC/ESCT). Helius aceita, mas a chave precisa ficar
 *   server-side pra não vazar pelo bundle.
 *
 * ENVs necessárias no painel Vercel (server-side, SEM EXPO_PUBLIC_):
 *   HELIUS_API_KEY        — chave do Helius
 *   HELIUS_RPC_URL        — opcional, override completo da URL upstream
 *
 * Allowlist de métodos: só endpoints de leitura Solana. POSTs com método
 * fora da lista (ex: tentativa de admin call) são rejeitados com 400.
 *
 * Rate-limit: in-memory per-IP, simples (bom o suficiente pra Vercel functions
 * cold-start frequente; em escala usar Upstash).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Upstream resolution ─────────────────────────────────────────────────────
function resolveUpstream(): string {
  const explicit = process.env.HELIUS_RPC_URL?.trim();
  if (explicit) return explicit;

  const key = process.env.HELIUS_API_KEY?.trim();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;

  // Fallback público — sabidamente quebrado pra alguns métodos, mas evita 500
  return 'https://api.mainnet-beta.solana.com';
}

const UPSTREAM_URL = resolveUpstream();

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://verumcrypto.com',
  'https://www.verumcrypto.com',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// ─── Method allowlist ────────────────────────────────────────────────────────
// Métodos de LEITURA + sendTransaction. No PWA (same-origin), o cliente não
// tem caminho direto pro Helius/RPC público sem CORS — então o broadcast da
// TX assinada também precisa passar pelo proxy. A chave Helius continua
// server-side; o proxy só repassa bytes já assinados pelo usuário.
const ALLOWED_METHODS = new Set<string>([
  'getBalance',
  'getAccountInfo',
  'getMultipleAccounts',
  'getTokenAccountsByOwner',
  'getTokenAccountBalance',
  'getTokenSupply',
  'getProgramAccounts',
  'getSignaturesForAddress',
  'getSignatureStatuses',
  'getTransaction',
  'getTransactions',
  'getParsedTransaction',
  'getParsedTransactions',
  'getLatestBlockhash',
  'getBlockhash',
  'getRecentBlockhash',
  'getBlockHeight',
  'getSlot',
  'getEpochInfo',
  'getMinimumBalanceForRentExemption',
  'getFeeForMessage',
  'getRecentPrioritizationFees',
  'simulateTransaction',
  'sendTransaction',
  'isBlockhashValid',
  'getVersion',
  'getHealth',
  'getInflationReward',
  'getAddressLookupTable',
]);

// ─── Rate limit (per-IP, in-memory) ──────────────────────────────────────────
// Vercel functions são stateless entre invocações — esse mapa zera a cada
// cold-start. É só uma barreira contra abuso óbvio, não uma proteção forte.
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 60; // 60 reqs por 10s por IP
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) return true;
  return false;
}

function getClientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  if (Array.isArray(xff)) return xff[0];
  return (req.socket as any)?.remoteAddress ?? 'unknown';
}

// ─── Body parsing ────────────────────────────────────────────────────────────
async function readRawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = (req.headers.origin as string) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, solana-client');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Method Not Allowed' }, id: null });
    return;
  }

  // Rate limit
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    res.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32005, message: 'Rate limit exceeded' },
      id: null,
    });
    return;
  }

  // Parse body
  let raw: string;
  try {
    raw = await readRawBody(req);
  } catch (e: any) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32700, message: `Parse error: ${e?.message ?? e}` },
      id: null,
    });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Invalid JSON' },
      id: null,
    });
    return;
  }

  // Batch suportado (array de calls) — validamos cada método
  const items = Array.isArray(payload) ? payload : [payload];
  for (const item of items) {
    const method = item?.method;
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method '${method ?? '?'}' not allowed via proxy` },
        id: item?.id ?? null,
      });
      return;
    }
  }

  // Repassa pra upstream
  try {
    const upstreamRes = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: raw,
      signal: AbortSignal.timeout(20_000),
    });

    const upstreamText = await upstreamRes.text();

    // Repassa o status code do upstream (incluindo 429/5xx)
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(upstreamText);
  } catch (err: any) {
    console.error('[api/solana-rpc] upstream error:', err?.message);
    res.status(502).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: `Upstream error: ${err?.message ?? 'unknown'}` },
      id: payload?.id ?? null,
    });
  }
}
