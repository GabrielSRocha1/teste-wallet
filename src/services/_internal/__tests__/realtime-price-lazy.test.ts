import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apiUrl para não tocar em Platform/Constants nativos.
vi.mock('../../apiUrl', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
  getSwapApiBaseUrl: () => 'http://localhost:3001',
}));

// Mock global fetch — controlamos quando responde para inspecionar polling.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ prices: { SOL: 100 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── (F6) Polling vinculado a subscriptions ─────────────────────────────────

describe('realtimePriceService — (F6) lazy start tied to subscriptions', () => {
  it('NÃO inicia polling contínuo no constructor (apenas 1 kickstart fetch)', async () => {
    const { realtimePriceService } = await import('../../realtimePriceService');

    // 1 fetch inicial do kickstart é OK; mas nenhum polling agendado.
    expect(realtimePriceService.getHealth().isPolling).toBe(false);

    // Avança 10s do timer fake: se houvesse polling de 4s, teríamos ≥2 fetches
    // de polling além do kickstart. Como não há subscribers, polling não roda.
    await vi.advanceTimersByTimeAsync(10_000);

    // Aceita 1 kickstart fetch (não pode ser ≥3)
    expect(fetchMock.mock.calls.length).toBeLessThan(3);
  });

  it('PRIMEIRO subscribe inicia polling; ÚLTIMO unsubscribe para', async () => {
    const { realtimePriceService } = await import('../../realtimePriceService');

    // Antes de subscribe: sem polling
    expect(realtimePriceService.getHealth().isPolling).toBe(false);

    const unsub = realtimePriceService.subscribe(() => undefined);
    expect(realtimePriceService.getHealth().isPolling).toBe(true);

    // Polling roda a cada 4s — após 10s, esperamos ≥2 fetches do polling
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsub();
    expect(realtimePriceService.getHealth().isPolling).toBe(false);

    // Após unsubscribe, polling parou — count não cresce mais.
    const countAfterUnsub = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(countAfterUnsub);
  });

  it('múltiplos subscribers compartilham UM polling', async () => {
    const { realtimePriceService } = await import('../../realtimePriceService');

    const u1 = realtimePriceService.subscribe(() => undefined);
    expect(realtimePriceService.getHealth().isPolling).toBe(true);

    const fetchesAfterFirst = fetchMock.mock.calls.length;

    const u2 = realtimePriceService.subscribe(() => undefined);
    // Segundo subscribe NÃO dispara polling extra
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst);
    expect(realtimePriceService.getHealth().isPolling).toBe(true);

    u1();
    // Ainda há um subscriber → polling continua.
    expect(realtimePriceService.getHealth().isPolling).toBe(true);

    u2();
    // Último foi embora → polling para.
    expect(realtimePriceService.getHealth().isPolling).toBe(false);
  });

  it('subscribeError também conta para keep-alive do polling', async () => {
    const { realtimePriceService } = await import('../../realtimePriceService');

    const ue = realtimePriceService.subscribeError(() => undefined);
    expect(realtimePriceService.getHealth().isPolling).toBe(true);

    ue();
    expect(realtimePriceService.getHealth().isPolling).toBe(false);
  });
});
