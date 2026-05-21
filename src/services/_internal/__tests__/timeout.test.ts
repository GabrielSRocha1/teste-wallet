import { describe, it, expect } from 'vitest';
import { withTimeout, TimeoutError, timeoutSignal } from '../timeout';

describe('withTimeout', () => {
  it('resolves with inner value when promise settles before the timeout', async () => {
    const result = await withTimeout(
      new Promise<number>((resolve) => setTimeout(() => resolve(42), 10)),
      200,
      'fastOp',
    );
    expect(result).toBe(42);
  });

  it('rejects with TimeoutError when the inner promise exceeds the deadline', async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 200));
    await expect(withTimeout(slow, 30, 'slowOp')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates inner rejection unchanged when it loses the race', async () => {
    const boom = Promise.reject(new Error('boom'));
    await expect(withTimeout(boom, 200, 'failingOp')).rejects.toThrow('boom');
  });

  it('throws synchronously on invalid ms', async () => {
    await expect(withTimeout(Promise.resolve(0), 0, 'badMs')).rejects.toThrow(/ms inválido/);
    await expect(withTimeout(Promise.resolve(0), -5, 'badMs')).rejects.toThrow(/ms inválido/);
    await expect(withTimeout(Promise.resolve(0), Number.NaN, 'badMs')).rejects.toThrow(/ms inválido/);
  });

  it('aborts the provided AbortController when the timeout fires', async () => {
    const controller = new AbortController();
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 200));
    await expect(
      withTimeout(slow, 20, 'abortable', { controller }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe('timeoutSignal', () => {
  it('returns a signal that aborts after the given delay', async () => {
    const signal = timeoutSignal(15);
    expect(signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 40));
    expect(signal.aborted).toBe(true);
  });
});
