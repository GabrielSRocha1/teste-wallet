/**
 * pin-attempt-storage-adapter.ts — Adapta PinAttemptStorage para SecureStore/localStorage.
 *
 * Por que não usar `PinRateLimiter` direto com `InMemoryPinAttemptStorage`?
 * Se o usuário fecha e reabre o app, contadores em memória zeram → atacante
 * reinicia o app a cada falha e burla o rate-limit. Persistência é OBRIGATÓRIA
 * para o lockout ter valor anti-brute-force.
 *
 * Mobile (SecureStore): mesmo nível de proteção que o vault.
 * Web (localStorage): aceitável porque o vault também está em localStorage —
 * mesma janela de exposição.
 *
 * Falhas de I/O retornam null/no-op em vez de lançar — não queremos travar o
 * unlock se o storage estiver indisponível (degradação graciosa). Em troca,
 * uma falha de write significa que aquele ciclo de attempts não é capped por
 * lockout — risco aceitável porque é rato e o usuário ainda precisa do PIN.
 */

import * as SecureStore from 'expo-secure-store';
import type {
  PinAttemptRecord,
  PinAttemptStorage,
} from './pin-rate-limiter';

const isWeb = typeof window !== 'undefined' && 'localStorage' in window;

async function readRaw(key: string): Promise<string | null> {
  try {
    if (isWeb) return localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  try {
    if (isWeb) {
      localStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    /* swallow — degradação graciosa */
  }
}

async function deleteRaw(key: string): Promise<void> {
  try {
    if (isWeb) {
      localStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  } catch {
    /* swallow */
  }
}

function isValidRecord(value: unknown): value is PinAttemptRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.failureCount === 'number' &&
    Number.isFinite(v.failureCount) &&
    typeof v.firstFailureAt === 'number' &&
    typeof v.lastFailureAt === 'number' &&
    typeof v.lockedUntil === 'number'
  );
}

export class PersistentPinAttemptStorage implements PinAttemptStorage {
  async get(key: string): Promise<PinAttemptRecord | null> {
    const raw = await readRaw(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return isValidRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async set(key: string, record: PinAttemptRecord): Promise<void> {
    await writeRaw(key, JSON.stringify(record));
  }

  async clear(key: string): Promise<void> {
    await deleteRaw(key);
  }
}
