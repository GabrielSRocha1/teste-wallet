/**
 * pin-rate-limiter.ts — Exponential backoff anti-brute-force para PINs.
 *
 * Cenário: atacante com acesso a um dump do vault (AsyncStorage/SecureStore)
 * tenta brute-force offline. PIN de 4 dígitos = 10k combinações. Sem rate-limit,
 * mesmo PBKDF2 600k (≈1.5s/tentativa) leva ~4h. Com este rate-limiter:
 *
 *   Falhas 1-2: sem lockout (UX permite digitação tremida).
 *   Falha 3:    1s lockout.
 *   Falha N≥3:  baseLockoutMs * 2^(N-3), capped em maxLockoutMs (5min default).
 *
 * Após 10 falhas (lockout no cap de 5min cada): 1000 tentativas levam ~84h.
 * Combinado com PBKDF2 → infeasibilidade prática.
 *
 * `resetAfterMs` (24h default): se o usuário esquece e volta dias depois,
 * counter zera — não punir uso esporádico legítimo.
 *
 * Storage é injetado para permitir múltiplos backends (memória / AsyncStorage /
 * SecureStore) e testes determinísticos.
 */

export interface PinAttemptRecord {
  failureCount: number;
  /** Timestamp da primeira falha da sequência atual. */
  firstFailureAt: number;
  /** Timestamp da última falha registrada. */
  lastFailureAt: number;
  /** Timestamp epoch em que o lockout expira. 0 = sem lockout ativo. */
  lockedUntil: number;
}

export interface PinAttemptStorage {
  get(key: string): Promise<PinAttemptRecord | null>;
  set(key: string, record: PinAttemptRecord): Promise<void>;
  clear(key: string): Promise<void>;
}

export class InMemoryPinAttemptStorage implements PinAttemptStorage {
  private readonly map = new Map<string, PinAttemptRecord>();

  async get(key: string): Promise<PinAttemptRecord | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, record: PinAttemptRecord): Promise<void> {
    this.map.set(key, { ...record });
  }

  async clear(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class PinLockedError extends Error {
  constructor(
    public readonly remainingLockoutMs: number,
    public readonly failureCount: number,
  ) {
    super(`PIN bloqueado: aguarde ${Math.ceil(remainingLockoutMs / 1000)}s (${failureCount} falhas)`);
    this.name = 'PinLockedError';
  }
}

export interface PinRateLimiterOptions {
  storage: PinAttemptStorage;
  /** Falhas após as quais o lockout começa. Default 2 (1ª e 2ª falha sem lockout). */
  freeAttempts?: number;
  /** Lockout inicial em ms (aplicado na (freeAttempts+1)-ésima falha). Default 1000ms. */
  baseLockoutMs?: number;
  /** Cap superior do lockout em ms. Default 300_000 (5 min). */
  maxLockoutMs?: number;
  /** Tempo após o qual counters são auto-resetados (sem atividade). Default 24h. */
  resetAfterMs?: number;
  /** Fonte de tempo injetável (para testes determinísticos). */
  now?: () => number;
}

const DEFAULTS = {
  freeAttempts: 2,
  baseLockoutMs: 1_000,
  maxLockoutMs: 300_000,
  resetAfterMs: 24 * 60 * 60 * 1_000,
} as const;

function computeLockoutMs(
  failureCount: number,
  freeAttempts: number,
  baseLockoutMs: number,
  maxLockoutMs: number,
): number {
  if (failureCount <= freeAttempts) return 0;
  const offset = failureCount - freeAttempts - 1;
  // Math.min antes do shift para evitar overflow em counters muito altos
  const exp = baseLockoutMs * 2 ** Math.min(offset, 30);
  return Math.min(exp, maxLockoutMs);
}

function assertNonEmptyKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('PinRateLimiter: key deve ser string não-vazia');
  }
}

export interface PinAttemptStatus {
  failureCount: number;
  lockedUntil: number;
  remainingLockoutMs: number;
}

export class PinRateLimiter {
  private readonly storage: PinAttemptStorage;
  private readonly freeAttempts: number;
  private readonly baseLockoutMs: number;
  private readonly maxLockoutMs: number;
  private readonly resetAfterMs: number;
  private readonly now: () => number;

  constructor(opts: PinRateLimiterOptions) {
    this.storage = opts.storage;
    this.freeAttempts = opts.freeAttempts ?? DEFAULTS.freeAttempts;
    this.baseLockoutMs = opts.baseLockoutMs ?? DEFAULTS.baseLockoutMs;
    this.maxLockoutMs = opts.maxLockoutMs ?? DEFAULTS.maxLockoutMs;
    this.resetAfterMs = opts.resetAfterMs ?? DEFAULTS.resetAfterMs;
    this.now = opts.now ?? Date.now;

    if (this.freeAttempts < 0) throw new Error('freeAttempts deve ser ≥ 0');
    if (this.baseLockoutMs <= 0) throw new Error('baseLockoutMs deve ser > 0');
    if (this.maxLockoutMs < this.baseLockoutMs) {
      throw new Error('maxLockoutMs deve ser ≥ baseLockoutMs');
    }
  }

  /** Snapshot do estado atual. Auto-reseta se stale (sem atividade > resetAfterMs). */
  async getStatus(key: string): Promise<PinAttemptStatus> {
    assertNonEmptyKey(key);
    const record = await this.storage.get(key);
    if (!record) return { failureCount: 0, lockedUntil: 0, remainingLockoutMs: 0 };

    const now = this.now();
    if (record.lastFailureAt && now - record.lastFailureAt > this.resetAfterMs) {
      await this.storage.clear(key);
      return { failureCount: 0, lockedUntil: 0, remainingLockoutMs: 0 };
    }

    return {
      failureCount: record.failureCount,
      lockedUntil: record.lockedUntil,
      remainingLockoutMs: Math.max(0, record.lockedUntil - now),
    };
  }

  /** Lança PinLockedError se houver lockout ativo. */
  async assertCanAttempt(key: string): Promise<void> {
    const status = await this.getStatus(key);
    if (status.remainingLockoutMs > 0) {
      throw new PinLockedError(status.remainingLockoutMs, status.failureCount);
    }
  }

  /** Registra uma falha de PIN. Retorna o novo status. */
  async recordFailure(key: string): Promise<PinAttemptStatus> {
    assertNonEmptyKey(key);
    const now = this.now();
    const existing = await this.storage.get(key);

    const isStale = existing && existing.lastFailureAt && now - existing.lastFailureAt > this.resetAfterMs;
    const failureCount = isStale || !existing ? 1 : existing.failureCount + 1;
    const firstFailureAt = isStale || !existing ? now : existing.firstFailureAt;

    const lockoutMs = computeLockoutMs(
      failureCount,
      this.freeAttempts,
      this.baseLockoutMs,
      this.maxLockoutMs,
    );
    const lockedUntil = lockoutMs > 0 ? now + lockoutMs : 0;

    await this.storage.set(key, {
      failureCount,
      firstFailureAt,
      lastFailureAt: now,
      lockedUntil,
    });

    return { failureCount, lockedUntil, remainingLockoutMs: lockoutMs };
  }

  /** Limpa o registro após PIN correto — counter zera. */
  async recordSuccess(key: string): Promise<void> {
    assertNonEmptyKey(key);
    await this.storage.clear(key);
  }
}
