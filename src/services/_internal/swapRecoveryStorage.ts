/**
 * swapRecoveryStorage.ts — Persistência da pendência "swap concluído + transfer
 * falhou" entre reaberturas do app.
 *
 * Por quê:
 *   O fluxo `transferir.tsx` faz 2 transações on-chain (swap → SOL e SOL →
 *   destinatário). Se a 2ª falhar, o SOL fica na carteira do remetente
 *   aguardando reenvio. Sem persistência, fechar o app perde a UI de recovery e
 *   o usuário precisa lembrar do incidente.
 *
 * Escopo:
 *   - Chave de storage prefixada pelo `user.id` (Supabase auth) — assim trocas
 *     de conta não compartilham pendência.
 *   - Apenas uma pendência por conta. Se uma nova falhar antes da anterior ser
 *     resolvida, sobrescreve (caller pode chamar `clearRecovery` antes pra
 *     reter histórico se quiser, mas o uso normal é resolver a atual primeiro).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_PREFIX = 'verum_swap_recovery_v1';

export interface PendingSwapRecovery {
  /** Hash da Tx 1 (swap) — confirmada on-chain. */
  swapTxHash: string;
  /** Saldo SOL aguardando reenvio (lamports, como string pra preservar uint64). */
  solLamports: string;
  /** Endereço Solana do destinatário original. */
  recipientAddress: string;
  /** Timestamp ms da persistência — usado pra TTL/expiração lógica futura. */
  savedAt: number;
  /** Símbolo do ativo original que o usuário escolheu enviar (USDC, BDC, etc).
   *  Usado só pra exibir contexto na UI ("você queria mandar X USDC..."). */
  originalCurrency?: string;
  /** Quantia original em unidade humana — também só pra contexto na UI. */
  originalAmount?: number;
}

function keyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}_${userId}`;
}

export async function saveRecovery(
  userId: string,
  recovery: PendingSwapRecovery,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(recovery));
  } catch (err) {
    // Persistência falhar não é fatal — o state em memória ainda funciona pra
    // sessão atual. Só perdemos o atalho cross-restart.
    console.warn('[swapRecoveryStorage] saveRecovery failed:', err);
  }
}

export async function loadRecovery(
  userId: string,
): Promise<PendingSwapRecovery | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSwapRecovery;
    // Sanity check — campos mínimos.
    if (
      typeof parsed.swapTxHash !== 'string' ||
      typeof parsed.solLamports !== 'string' ||
      typeof parsed.recipientAddress !== 'string'
    ) {
      console.warn('[swapRecoveryStorage] loadRecovery: payload malformado, descartando');
      await clearRecovery(userId);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[swapRecoveryStorage] loadRecovery failed:', err);
    return null;
  }
}

export async function clearRecovery(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch (err) {
    console.warn('[swapRecoveryStorage] clearRecovery failed:', err);
  }
}
