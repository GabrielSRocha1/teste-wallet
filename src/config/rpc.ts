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

/**
 * RPCs sabidamente quebrados pra uso em browser (CORS, rate-limit anônimo,
 * bloqueio de getTokenAccountsByOwner). Se uma env apontar pra esses, IGNORAMOS
 * — assumimos que foi copiado do .env.example por engano e seguimos pra
 * próxima prioridade. Sem essa proteção, um `EXPO_PUBLIC_SOLANA_RPC_MAINNET=
 * https://api.mainnet-beta.solana.com` setado no painel da Vercel "envenena"
 * o bundle inteiro com a URL ruim.
 */
const KNOWN_BAD_RPCS = ['api.mainnet-beta.solana.com'];

function isBadRpc(url: string | undefined): boolean {
  if (!url) return true;
  return KNOWN_BAD_RPCS.some((bad) => url.includes(bad));
}

/**
 * Em release builds (Play Store / Aptoide), IGNORAMOS qualquer chave Helius
 * exposta no bundle. Mesmo que o `.env` da Vercel tenha sido configurado por
 * engano com `EXPO_PUBLIC_HELIUS_API_KEY` ou `EXPO_PUBLIC_HELIUS_RPC_URL`, em
 * release sempre caímos no proxy server-side (`/api/solana-rpc`), que lê a
 * chave de `HELIUS_API_KEY` (sem prefixo público) no servidor.
 *
 * Isso é defesa em profundidade: o `.env.example` já avisa pra deixar vazio,
 * mas se um dev novo copiar a chave de dev pro painel de prod, o ataque de
 * reverse-engineering ainda assim falha em achar uma string que valha algo.
 *
 * Em dev (`__DEV__ === true`) mantemos o comportamento antigo pra debug local.
 */
const IS_PROD = typeof __DEV__ !== 'undefined' ? !__DEV__ : true;

/** Endpoint RPC mainnet — proxy por padrão, override por env. */
export function resolveMainnetRpc(): string {
  const explicit = process.env.EXPO_PUBLIC_SOLANA_RPC_MAINNET?.trim();
  if (!isBadRpc(explicit)) return explicit!;

  // Em release, pula chaves Helius expostas — força proxy.
  if (!IS_PROD) {
    const heliusUrl = process.env.EXPO_PUBLIC_HELIUS_RPC_URL?.trim();
    if (!isBadRpc(heliusUrl)) return heliusUrl!;

    const heliusKey = process.env.EXPO_PUBLIC_HELIUS_API_KEY?.trim();
    if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

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
 *
 * Em release, pulamos a chave Helius pública (mesma razão de `resolveMainnetRpc`):
 * proteção contra vazamento via reverse-engineering. Resultado: WS retorna
 * undefined e `useRealtimeBalances` cai pra polling a cada 4s (definido em
 * `src/config/polling.ts`). Tradeoff aceito: latência maior > chave exposta.
 */
export function resolveMainnetWsEndpoint(): string | undefined {
  const explicitWs = process.env.EXPO_PUBLIC_SOLANA_WS_MAINNET?.trim();
  if (explicitWs) return explicitWs;

  if (!IS_PROD) {
    const heliusKey = process.env.EXPO_PUBLIC_HELIUS_API_KEY?.trim();
    if (heliusKey) return `wss://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

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

/**
 * Endpoint mainnet resolvido sob demanda (lazy).
 *
 * IMPORTANTE: NÃO transformar em `const X = resolveMainnetRpc()` no top-level
 * do módulo. O Expo Web é exportado como bundle estático (`expo export
 * --platform web`), e top-level code roda em build time no Node — onde
 * `window` não existe e nenhum `EXPO_PUBLIC_*` opcional foi setado. O
 * resultado: o valor errado (api.mainnet-beta.solana.com) fica baked no
 * bundle e o cliente bate direto no RPC público em produção.
 *
 * Resolvendo lazy, o cálculo acontece no primeiro uso DENTRO do browser,
 * onde `window.location.origin` já existe e a fallback chain funciona.
 *
 * Cacheamos a primeira chamada bem-sucedida no browser pra não recomputar.
 */
let _cachedMainnetRpc: string | undefined;
let _cachedMainnetWs: string | undefined | null = null; // null = ainda não computou

export function getMainnetRpc(): string {
  if (_cachedMainnetRpc) return _cachedMainnetRpc;
  const resolved = resolveMainnetRpc();
  // Só cacheia se NÃO caiu no fallback público — assim, se a primeira chamada
  // for em SSR (sem window) e cair em api.mainnet-beta, a próxima chamada
  // no browser tem chance de re-resolver com window.location.origin.
  if (!resolved.includes('api.mainnet-beta.solana.com')) {
    _cachedMainnetRpc = resolved;
  }
  return resolved;
}

export function getMainnetWs(): string | undefined {
  if (_cachedMainnetWs !== null) return _cachedMainnetWs;
  _cachedMainnetWs = resolveMainnetWsEndpoint();
  return _cachedMainnetWs;
}

// Removido: `const MAINNET_RPC = resolveMainnetRpc()` no top-level era a
// causa do bug em produção. Importe `getMainnetRpc()` em vez disso.
