import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { buildVerumInjectionScript, VERUM_MSG } from '../../verumProvider';

// Endereço Solana válido (decodifica para exatamente 32 bytes).
const PK = '5L2RTAADrEXkUfA9c9Ghk1zgh5TAyjYyNLBCevc6yMah';

/**
 * Monta um sandbox mínimo de browser (sem jsdom) para avaliar o script de
 * injeção gerado por buildVerumInjectionScript. Simula o ambiente WebView
 * nativo: self === top (não-iframe) e window.ReactNativeWebView presente.
 */
function makeSandbox() {
  const listeners: Record<string, Function[]> = {};
  const sent: any[] = [];

  const win: any = {
    addEventListener: (ev: string, cb: Function) => { (listeners[ev] ||= []).push(cb); },
    removeEventListener: (ev: string, cb: Function) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb);
    },
    dispatchEvent: (e: any) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
    location: { origin: 'https://vesting.verumcrypto.com' },
    ReactNativeWebView: { postMessage: (json: string) => sent.push(JSON.parse(json)) },
  };
  win.self = win;
  win.top = win;

  const ctx: any = {
    window: win,
    document: { addEventListener: () => {}, dispatchEvent: () => true },
    navigator: {},
    console,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array,
    setTimeout,
    clearTimeout,
    Event: class { type: string; constructor(t: string) { this.type = t; } },
    CustomEvent: class { type: string; detail: any; constructor(t: string, o?: any) { this.type = t; this.detail = o?.detail; } },
  };
  ctx.globalThis = ctx;

  return { ctx, win, sent };
}

describe('verumProvider — script de injeção (WebView nativo)', () => {
  it('connect() via __cb não corrompe o publicKey (regressão double-wrap)', async () => {
    const { ctx, win, sent } = makeSandbox();
    const script = buildVerumInjectionScript({ network: 'mainnet', publicKey: null, debug: false });
    vm.runInNewContext(script, ctx);

    // dApp inicia a conexão → provider envia VERUM_CONNECT_REQUEST.
    const promise = win.verum.connect();
    const req = sent.find((m) => m.type === VERUM_MSG.CONNECT_REQUEST);
    expect(req).toBeTruthy();

    // App nativo responde via injectJavaScript → window.verum.__cb(id, {publicKey}, null)
    win.verum.__cb(req.id, { publicKey: PK }, null);
    await promise;

    expect(win.verum.connected).toBe(true);
    expect(win.verum.publicKey.toBase58()).toBe(PK);

    // Antes do fix, toBytes() rodava __b58decode sobre um objeto → 1 byte, e
    // new PublicKey() quebrava no adapter do dApp. Agora deve dar 32 bytes.
    const bytes = win.verum.publicKey.toBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
  });

  it('Wallet Standard: evento register-wallet entrega um callback chamável', () => {
    const { ctx, win } = makeSandbox();

    let registerDetail: any;
    const baseDispatch = win.dispatchEvent;
    win.dispatchEvent = (e: any) => {
      if (e.type === 'wallet-standard:register-wallet') registerDetail = e.detail;
      return baseDispatch(e);
    };

    const script = buildVerumInjectionScript({ network: 'mainnet', publicKey: null });
    vm.runInNewContext(script, ctx);

    // detail PRECISA ser a própria função; o app a chama com { register }.
    expect(typeof registerDetail).toBe('function');

    let registered: any = null;
    registerDetail({ register: (w: any) => { registered = w; } });

    expect(registered).toBeTruthy();
    expect(registered.name).toBe('Verum Wallet');
    expect(registered.features['standard:connect']).toBeTruthy();
    expect(registered.features['solana:signTransaction']).toBeTruthy();
  });
});
