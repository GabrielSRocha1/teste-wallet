/**
 * rpc.ts — Resolução centralizada de endpoints RPC Solana.
 *
 * Fonte única de verdade pra todo o app (transactionService, _layout,
 * hooks). Antes, a lógica estava duplicada em 2 lugares com fallbacks
 * inconsistentes — um caía no proxy /api/solana-rpc, o outro no RPC
 * público que sempre 403'a com getTokenAccountsByOwner.
 *
 * Prioridade (mais específica → mais genérica):
 *   1. EXPO_PUBLIC_SOLANA_RPC_MAINNET — override explícito (dev avançado / RPC próprio)
 *   2. EXPO_PUBLIC_HELIUS_RPC_URL    — URL completa do Helius (legado .env.local)
 *   3. EXPO_PUBLIC_HELIUS_API_KEY    — chave Helius pública (tier free)
 *   4. EXPO_PUBLIC_API_URL/api/solana-rpc — proxy no nosso domínio (default seguro)
 *   5. window.location.origin/api/solana-rpc — same-origin no web (default deploy)
 *   6. https://api.mainnet-beta.solana.com — último recurso (sabidamente quebrado pra
 *      getTokenAccountsByOwner; mantemos só pra não crashar em ambiente sem nada)
 *
 * O caminho 4/5 é o esperado em produção: o proxy server-side guarda a
 * chave Helius e libera apenas métodos de leitura listados em api/solana-rpc.ts.
 */

export const DEVNET_RPC =
  process.env.EXPO_PUBLIC_SOLANA_RPC_DEVNET?.trim() || 'https://api.devnet.solana.com';

/** Base URL pra montar o caminho `/api/solana-rpc` (proxy server-side). */
export function resolveProxyBase(): string {
  const envBase = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, '');

  if (typeof window !== 'undefined' && (window as any).location?.origin) {
    return (window as any).location.origin;
  }

  return '';
}

/** Endpoint RPC mainnet — proxy por padrão, override por env. */
export function resolveMainnetRpc(): string {
  const explicit = process.env.EXPO_PUBLIC_SOLANA_RPC_MAINNET?.trim();
  if (explicit) return explicit;

  const heliusUrl = process.env.EXPO_PUBLIC_HELIUS_RPC_URL?.trim();
  if (heliusUrl) return heliusUrl;

  const heliusKey = process.env.EXPO_PUBLIC_HELIUS_API_KEY?.trim();
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

  const base = resolveProxyBase();
  if (base) return `${base}/api/solana-rpc`;

  // Último recurso — sabidamente bloqueia getTokenAccountsByOwner com 403,
  // mas evita crash em ambiente sem env nenhuma.
  return 'https://api.mainnet-beta.solana.com';
}

/**
 * WebSocket endpoint pra mainnet. Vercel functions não suportam WS, então
 * o proxy não serve aqui — usamos Helius direto SE a chave pública estiver
 * disponível no bundle. Sem chave → undefined e web3.js cai pra polling.
 */
export function resolveMainnetWsEndpoint(): string | undefined {
  const explicitWs = process.env.EXPO_PUBLIC_SOLANA_WS_MAINNET?.trim();
  if (explicitWs) return explicitWs;

  const heliusKey = process.env.EXPO_PUBLIC_HELIUS_API_KEY?.trim();
  if (heliusKey) return `wss://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

  return undefined;
}

/**
 * RPCs públicos pra fallback em ÚLTIMO caso (proxy fora do ar, e.g. Vercel
 * outage). Esses RPCs bloqueiam `getTokenAccountsByOwner` e batches grandes,
 * então só servem pra operações simples — `getBalance`, `getLatestBlockhash`,
 * `sendTransaction`.
 *
 * NÃO inclui `api.mainnet-beta.solana.com` — bloqueia 100% das chamadas
 * vindas do browser (CORS + rate-limit anônimo). Mantê-lo na lista só fazia
 * a rotação girar e voltar pro mesmo erro.
 */
export const PUBLIC_FALLBACK_RPCS: readonly string[] = [
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
  'https://solana.public-rpc.com',
];

/** Endpoint resolvido no boot. Importadores devem usar este valor cacheado. */
export const MAINNET_RPC = resolveMainnetRpc();
export const MAINNET_WS = resolveMainnetWsEndpoint();
