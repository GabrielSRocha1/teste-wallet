/**
 * polling.ts — Constantes de polling centralizadas.
 *
 * (M4) Antes desta consolidação, intervalos de polling estavam definidos em
 * cada hook/service:
 *   - useRealtimeBalances: `POLL_MS = 4_000`
 *   - useSolanaWallet: `BALANCE_POLL_MS = 4_000`
 *   - realtimePriceService: hardcoded `4000`
 *   - useWalletBalance: `POLL_INTERVAL_MS = 4_000`
 *
 * Quatro lugares, mesmo valor, mas qualquer ajuste exigia tocar nos quatro.
 * Centralizamos aqui. Cada hook importa só a constante semântica que precisa.
 *
 * Filosofia "Cinematic/Executive":
 *  - Balance polling em 4s é suficientemente fluido sem queimar RPC.
 *  - Heartbeat de sessão a cada 30s é invisível ao usuário.
 *  - Health checks de WS a cada 60s só agem se sub estiver mudo.
 *
 * Se precisarmos ajustar para reduzir custo de RPC, basta editar aqui.
 */

/** Frequência de refresh de saldo on-chain (SOL + SPL). */
export const BALANCE_POLL_MS = 4_000;

/** Frequência de refresh de preços de mercado (Jupiter/Helius via backend). */
export const PRICE_POLL_MS = 4_000;

/** Health check do WebSocket Solana — re-subscribe se subscriptions caíram. */
export const WS_HEALTH_CHECK_MS = 60_000;

/** Heartbeat de sessão — força sonda de getSessionKeypair para detectar idle. */
export const SESSION_HEARTBEAT_MS = 30_000;
