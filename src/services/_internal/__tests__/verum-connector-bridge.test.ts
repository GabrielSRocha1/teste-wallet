import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PK = '5L2RTAADrEXkUfA9c9Ghk1zgh5TAyjYyNLBCevc6yMah';
const CONNECTOR_SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'verum-vesting-connector.js'),
  'utf8',
);

// Simula o portal rodando dentro de um iframe web: self !== top, sem
// ReactNativeWebView e sem window.verum injetado → o connector deve entrar em
// modo ponte e definir window.verum.
function makeIframeSandbox() {
  const listeners: Record<string, Function[]> = {};
  const sentToParent: any[] = [];

  const win: any = {
    addEventListener: (ev: string, cb: Function) => { (listeners[ev] ||= []).push(cb); },
    removeEventListener: () => {},
    dispatchEvent: (e: any) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
    location: { origin: 'https://vesting.verumcrypto.com' },
    parent: { postMessage: (data: any) => sentToParent.push(data) },
    crypto: { getRandomValues: (arr: Uint8Array) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 7 + 1) & 0xff; return arr; } },
  };
  win.self = win;
  win.top = {}; // diferente de self → iframe

  const ctx: any = {
    window: win,
    self: win,
    document: { addEventListener: () => {}, dispatchEvent: () => true },
    console,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array,
    setTimeout,
    clearTimeout,
    CustomEvent: class { type: string; detail: any; constructor(t: string, o?: any) { this.type = t; this.detail = o?.detail; } },
  };
  ctx.globalThis = ctx;

  vm.runInNewContext(CONNECTOR_SRC, ctx);

  return {
    win,
    sentToParent,
    dispatchMessage: (data: any) => win.dispatchEvent({ type: 'message', data }),
  };
}

describe('verum-vesting-connector — modo ponte (iframe web)', () => {
  it('define window.verum como provider-ponte', () => {
    const { win } = makeIframeSandbox();
    expect(win.verum).toBeTruthy();
    expect(win.verum.isVerum).toBe(true);
    expect(typeof win.verum.connect).toBe('function');
    expect(typeof win.verumConnector.on).toBe('function');
  });

  it('fast-connect: INIT_RESPONSE do pai dispara "connected" e popula publicKey', async () => {
    const { win, sentToParent, dispatchMessage } = makeIframeSandbox();

    const connected: string[] = [];
    win.verumConnector.on('connected', (pk: string) => connected.push(pk));
    await win.verumConnector.init();

    // O connector pede o estado ao pai no load.
    expect(sentToParent.some((m) => m.type === 'VERUM_INIT_REQUEST')).toBe(true);

    // Pai responde com sessão ativa.
    dispatchMessage({ type: 'VERUM_INIT_RESPONSE', publicKey: PK });

    expect(connected).toContain(PK);
    expect(win.verum.connected).toBe(true);
    // VerumWalletAdapter faz new PublicKey(wallet.publicKey.toBytes()).
    expect(win.verum.publicKey.toBytes().length).toBe(32);
    expect(win.verum.publicKey.toBase58()).toBe(PK);
  });

  it('connect() faz round-trip postMessage e resolve com o publicKey', async () => {
    const { win, sentToParent, dispatchMessage } = makeIframeSandbox();

    const promise = win.verum.connect();
    const req = sentToParent.find((m) => m.type === 'VERUM_CONNECT_REQUEST');
    expect(req).toBeTruthy();
    expect(req.id).toBeTruthy();

    dispatchMessage({ type: 'VERUM_CONNECT_RESPONSE', id: req.id, publicKey: PK });

    const res = await promise;
    expect(res.publicKey.toBase58()).toBe(PK);
    expect(win.verum.connected).toBe(true);
  });
});
