import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks de módulos nativos — mesmo padrão dos outros testes de keyManager.
const secureStore: Record<string, string> = {};

vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  getItemAsync: vi.fn(async (key: string) => secureStore[key] ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    delete secureStore[key];
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── (M9) Listener de eventos de sessão ─────────────────────────────────────

describe('keyManager.onSessionChange — (M9) eventos de sessão', () => {
  it('emite "started" quando startSession roda com sucesso', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const events: string[] = [];
    const unsub = keyManager.onSessionChange((e) => events.push(e));

    const wallet = await keyManager.createNewWallet('111111');
    // createNewWallet → saveEncrypted → não dispara startSession sozinha;
    // mas o teste usa createNewWallet em sequência com startSession via unlock.
    // Aqui chamamos startSession diretamente.
    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');

    expect(events).toContain('started');
    unsub();
    await keyManager.wipeIdentity();
  });

  it('emite "cleared" quando clearSession é chamado explicitamente', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');
    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');

    const events: string[] = [];
    const unsub = keyManager.onSessionChange((e) => events.push(e));

    await keyManager.clearSession();
    expect(events).toEqual(['cleared']);

    unsub();
    await keyManager.wipeIdentity();
  });

  it('emite "expired" quando getSessionKeypair detecta IDLE > timeout', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');
    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');

    const events: string[] = [];
    const unsub = keyManager.onSessionChange((e) => events.push(e));

    // Força idle: mexer no campo lastActivity da sessão interna.
    // Usamos uma manipulação direta via Date.now mock — mais limpo.
    const realNow = Date.now;
    // IDLE_TIMEOUT_MS é 15min. Avança 16min para ultrapassar.
    Date.now = () => realNow() + 16 * 60 * 1000;

    const kp = keyManager.getSessionKeypair();
    expect(kp).toBeNull();
    expect(events).toContain('expired');

    Date.now = realNow;
    unsub();
    await keyManager.wipeIdentity();
  });

  it('emite "wiped" quando wipeIdentity é chamado', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');
    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');

    const events: string[] = [];
    const unsub = keyManager.onSessionChange((e) => events.push(e));

    await keyManager.wipeIdentity();
    expect(events).toContain('wiped');
    // wipeIdentity NÃO emite 'cleared' antes de 'wiped' (evita ruído duplicado)
    expect(events.filter((e) => e === 'cleared')).toHaveLength(0);

    unsub();
  });

  it('listener com bug NÃO quebra a operação que dispara o evento', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');

    // Listener que lança
    keyManager.onSessionChange(() => {
      throw new Error('listener boom');
    });

    // startSession deve completar mesmo assim
    await expect(
      keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111'),
    ).resolves.toBeUndefined();

    await keyManager.wipeIdentity();
  });

  it('unsubscribe remove o listener — eventos posteriores não chegam mais', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');

    const events: string[] = [];
    const unsub = keyManager.onSessionChange((e) => events.push(e));

    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');
    expect(events).toContain('started');

    unsub();
    events.length = 0;

    await keyManager.clearSession();
    expect(events).toHaveLength(0);

    await keyManager.wipeIdentity();
  });

  it('múltiplos listeners recebem o mesmo evento', async () => {
    const { default: keyManager } = await import('../../keyManager');
    const wallet = await keyManager.createNewWallet('111111');

    const a: string[] = [];
    const b: string[] = [];
    const ua = keyManager.onSessionChange((e) => a.push(e));
    const ub = keyManager.onSessionChange((e) => b.push(e));

    await keyManager.startSession(wallet.mnemonic, wallet.keypair, '111111');

    expect(a).toContain('started');
    expect(b).toContain('started');

    ua();
    ub();
    await keyManager.wipeIdentity();
  });
});
