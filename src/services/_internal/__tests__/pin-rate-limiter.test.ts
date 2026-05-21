import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryPinAttemptStorage,
  PinLockedError,
  PinRateLimiter,
  type PinRateLimiterOptions,
} from '../pin-rate-limiter';

function makeLimiter(overrides: Partial<PinRateLimiterOptions> = {}): PinRateLimiter {
  return new PinRateLimiter({
    storage: new InMemoryPinAttemptStorage(),
    baseLockoutMs: 1_000,
    maxLockoutMs: 60_000,
    freeAttempts: 2,
    resetAfterMs: 60_000,
    ...overrides,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — happy path', () => {
  it('assertCanAttempt não lança quando não há registro', async () => {
    const limiter = makeLimiter();
    await expect(limiter.assertCanAttempt('user1')).resolves.toBeUndefined();
  });

  it('getStatus retorna zeros para chave inexistente', async () => {
    const limiter = makeLimiter();
    const s = await limiter.getStatus('user1');
    expect(s).toEqual({ failureCount: 0, lockedUntil: 0, remainingLockoutMs: 0 });
  });

  it('recordFailure incrementa failureCount progressivamente', async () => {
    const limiter = makeLimiter();
    expect((await limiter.recordFailure('u')).failureCount).toBe(1);
    expect((await limiter.recordFailure('u')).failureCount).toBe(2);
    expect((await limiter.recordFailure('u')).failureCount).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — exponential backoff', () => {
  it('1ª e 2ª falha NÃO disparam lockout (freeAttempts=2)', async () => {
    const limiter = makeLimiter();
    const r1 = await limiter.recordFailure('u');
    expect(r1.remainingLockoutMs).toBe(0);
    const r2 = await limiter.recordFailure('u');
    expect(r2.remainingLockoutMs).toBe(0);
    await expect(limiter.assertCanAttempt('u')).resolves.toBeUndefined();
  });

  it('3ª falha dispara baseLockoutMs', async () => {
    const limiter = makeLimiter({ baseLockoutMs: 1_000 });
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    const r3 = await limiter.recordFailure('u');
    expect(r3.remainingLockoutMs).toBe(1_000);
  });

  it('cada falha dobra o lockout (1s → 2s → 4s → 8s → 16s → 32s)', async () => {
    const limiter = makeLimiter({ baseLockoutMs: 1_000, maxLockoutMs: 60_000 });
    await limiter.recordFailure('u'); // 1
    await limiter.recordFailure('u'); // 2
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(1_000); // 3
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(2_000); // 4
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(4_000); // 5
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(8_000); // 6
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(16_000); // 7
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(32_000); // 8
  });

  it('lockout é capped em maxLockoutMs', async () => {
    const limiter = makeLimiter({ baseLockoutMs: 1_000, maxLockoutMs: 60_000 });
    for (let i = 0; i < 2; i++) await limiter.recordFailure('u'); // free
    for (let i = 3; i <= 10; i++) await limiter.recordFailure('u');
    const r11 = await limiter.recordFailure('u');
    expect(r11.remainingLockoutMs).toBeLessThanOrEqual(60_000);
    // após várias falhas além do ponto onde 2^N excede o cap
    expect((await limiter.recordFailure('u')).remainingLockoutMs).toBe(60_000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — assertCanAttempt enforcement', () => {
  it('lança PinLockedError durante a janela de lockout', async () => {
    let nowVal = 1_000;
    const limiter = makeLimiter({ baseLockoutMs: 5_000, now: () => nowVal });
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');

    await expect(limiter.assertCanAttempt('u')).rejects.toBeInstanceOf(PinLockedError);
  });

  it('permite tentativa após lockout expirar', async () => {
    let nowVal = 1_000;
    const limiter = makeLimiter({ baseLockoutMs: 5_000, now: () => nowVal });
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    await expect(limiter.assertCanAttempt('u')).rejects.toBeInstanceOf(PinLockedError);

    nowVal += 6_000;
    await expect(limiter.assertCanAttempt('u')).resolves.toBeUndefined();
  });

  it('PinLockedError carrega remainingLockoutMs e failureCount', async () => {
    const limiter = makeLimiter({ baseLockoutMs: 5_000 });
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');

    try {
      await limiter.assertCanAttempt('u');
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(PinLockedError);
      const e = err as PinLockedError;
      expect(e.remainingLockoutMs).toBeGreaterThan(0);
      expect(e.failureCount).toBe(3);
      expect(e.message).toContain('PIN bloqueado');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — success clears state', () => {
  it('recordSuccess zera failureCount e remove o registro', async () => {
    const limiter = makeLimiter();
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    expect((await limiter.getStatus('u')).failureCount).toBe(3);

    await limiter.recordSuccess('u');
    expect(await limiter.getStatus('u')).toEqual({
      failureCount: 0,
      lockedUntil: 0,
      remainingLockoutMs: 0,
    });
    await expect(limiter.assertCanAttempt('u')).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — resetAfterMs (anti-noise)', () => {
  it('counter auto-reseta se sem atividade por > resetAfterMs', async () => {
    let nowVal = 1_000;
    const limiter = makeLimiter({ resetAfterMs: 60_000, now: () => nowVal });
    await limiter.recordFailure('u');
    await limiter.recordFailure('u');
    expect((await limiter.getStatus('u')).failureCount).toBe(2);

    nowVal += 70_000; // > resetAfterMs
    expect((await limiter.getStatus('u')).failureCount).toBe(0);

    // Próxima falha começa do zero
    expect((await limiter.recordFailure('u')).failureCount).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — isolamento entre keys', () => {
  it('falhas em user1 não afetam user2', async () => {
    const limiter = makeLimiter();
    await limiter.recordFailure('user1');
    await limiter.recordFailure('user1');
    await limiter.recordFailure('user1');
    await expect(limiter.assertCanAttempt('user1')).rejects.toBeInstanceOf(PinLockedError);
    await expect(limiter.assertCanAttempt('user2')).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe('PinRateLimiter — input validation', () => {
  it('rejeita key vazia em recordFailure', async () => {
    const limiter = makeLimiter();
    await expect(limiter.recordFailure('')).rejects.toThrow(/key/);
  });

  it('rejeita key vazia em getStatus', async () => {
    const limiter = makeLimiter();
    await expect(limiter.getStatus('')).rejects.toThrow(/key/);
  });

  it('construtor rejeita config inválida', () => {
    expect(
      () =>
        new PinRateLimiter({
          storage: new InMemoryPinAttemptStorage(),
          maxLockoutMs: 100,
          baseLockoutMs: 1_000, // base > max → inválido
        }),
    ).toThrow();
  });
});
