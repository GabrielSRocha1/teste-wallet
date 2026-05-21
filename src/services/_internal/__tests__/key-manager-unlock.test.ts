import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks de módulos nativos ───────────────────────────────────────────────
// Backing store em memória que substitui SecureStore. Compartilhado entre
// keyManager (vault) e o adapter de PIN attempts.
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

// Limpa o storage e reseta o módulo a cada teste — keyManager é singleton.
beforeEach(() => {
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Helper: cria vault v2 com PIN conhecido ────────────────────────────────

async function createVault(pin: string): Promise<{ publicKey: string; mnemonic: string }> {
  const { default: keyManager } = await import('../../keyManager');
  const wallet = await keyManager.createNewWallet(pin);
  // Limpa sessão imediatamente para forçar unlock no próximo teste
  await keyManager.clearSession();
  return { publicKey: wallet.publicKey, mnemonic: wallet.mnemonic };
}

// ─── (C2) Single-PBKDF2 unlock ──────────────────────────────────────────────

describe('keyManager.unlockVault — (C2) single PBKDF2', () => {
  it('retorna keypair + mnemonic numa única decifragem', async () => {
    const PIN = '123456';
    const { publicKey, mnemonic } = await createVault(PIN);

    const { default: keyManager } = await import('../../keyManager');
    const result = await keyManager.unlockVault(PIN);

    expect(result.keypair.publicKey.toBase58()).toBe(publicKey);
    expect(result.mnemonic).toBe(mnemonic);
  });

  it('loadDecrypted (API legada) continua funcionando — delega a unlockVault', async () => {
    const PIN = '123456';
    const { publicKey } = await createVault(PIN);

    const { default: keyManager } = await import('../../keyManager');
    const keypair = await keyManager.loadDecrypted(PIN);
    expect(keypair.publicKey.toBase58()).toBe(publicKey);
  });

  it('PIN errado lança Error com mensagem clara', async () => {
    await createVault('111111');

    const { default: keyManager } = await import('../../keyManager');
    // Injeta limiter com freeAttempts alto para isolar o teste de PIN errado
    // do teste de lockout (próximo bloco).
    const { InMemoryPinAttemptStorage } = await import('../pin-rate-limiter');
    keyManager.__setPinLimiterForTests(new InMemoryPinAttemptStorage());

    await expect(keyManager.unlockVault('222222')).rejects.toThrow(/PIN/);
  });
});

// ─── (C1) PIN rate-limit integrado ───────────────────────────────────────────

describe('keyManager.unlockVault — (C1) PIN rate-limit', () => {
  it('3ª falha consecutiva dispara lockout (PinLockedError)', async () => {
    await createVault('111111');

    const { default: keyManager } = await import('../../keyManager');
    const { InMemoryPinAttemptStorage, PinLockedError } = await import('../pin-rate-limiter');
    keyManager.__setPinLimiterForTests(new InMemoryPinAttemptStorage(), {
      baseLockoutMs: 5_000,
    });

    // 1ª e 2ª falhas: sem lockout (freeAttempts=2 default)
    await expect(keyManager.unlockVault('wrong1')).rejects.toThrow(/PIN/);
    await expect(keyManager.unlockVault('wrong2')).rejects.toThrow(/PIN/);
    // 3ª falha: ainda lança erro de PIN, mas próxima tentativa cai em lockout
    await expect(keyManager.unlockVault('wrong3')).rejects.toThrow(/PIN/);
    // 4ª: lockout ativo
    await expect(keyManager.unlockVault('111111')).rejects.toBeInstanceOf(PinLockedError);
  });

  it('PIN correto LIMPA o contador (recordSuccess)', async () => {
    const PIN = '111111';
    await createVault(PIN);

    const { default: keyManager } = await import('../../keyManager');
    const { InMemoryPinAttemptStorage } = await import('../pin-rate-limiter');
    keyManager.__setPinLimiterForTests(new InMemoryPinAttemptStorage());

    // 2 falhas + 1 sucesso
    await expect(keyManager.unlockVault('wrong1')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong2')).rejects.toThrow();
    const ok = await keyManager.unlockVault(PIN);
    expect(ok.keypair).toBeTruthy();

    // Após sucesso, posso falhar 2 vezes de novo sem lockout (counter zerou)
    await expect(keyManager.unlockVault('wrong3')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong4')).rejects.toThrow();
    // (3ª falha após reset — equivale à 3ª falha original = ainda PIN error, sem lockout)
    await expect(keyManager.unlockVault('wrong5')).rejects.toThrow();
    // Mas a 4ª agora é lockout (counter = 3 desde o reset)
    const { PinLockedError } = await import('../pin-rate-limiter');
    await expect(keyManager.unlockVault('wrong6')).rejects.toBeInstanceOf(PinLockedError);
  });

  it('rate-limit é checado ANTES de tocar no PBKDF2 (fast fail)', async () => {
    await createVault('111111');

    const { default: keyManager } = await import('../../keyManager');
    const { InMemoryPinAttemptStorage, PinLockedError } = await import('../pin-rate-limiter');
    const storage = new InMemoryPinAttemptStorage();
    keyManager.__setPinLimiterForTests(storage, { baseLockoutMs: 60_000 });

    // Força 3 falhas para abrir lockout (PINs ≥ 4 chars para passar assertValidPin)
    await expect(keyManager.unlockVault('wrong')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong2')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong3')).rejects.toThrow();

    // Mede tempo da 4ª tentativa: se rate-limit funciona, deve ser <100ms
    // (sem PBKDF2 600k que levaria ~500ms+).
    const start = Date.now();
    await expect(keyManager.unlockVault('anyok')).rejects.toBeInstanceOf(PinLockedError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── (C1) Persistência cross-restart simulada ────────────────────────────────

describe('keyManager — (C1) persistência de attempts', () => {
  it('contador de falhas persiste entre instâncias (atacante que fecha o app não burla)', async () => {
    await createVault('111111');

    const { default: keyManager } = await import('../../keyManager');
    const { InMemoryPinAttemptStorage } = await import('../pin-rate-limiter');
    // Storage compartilhado — simula SecureStore persistente real.
    const sharedStorage = new InMemoryPinAttemptStorage();
    keyManager.__setPinLimiterForTests(sharedStorage, { baseLockoutMs: 5_000 });

    await expect(keyManager.unlockVault('wrong')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong2')).rejects.toThrow();
    await expect(keyManager.unlockVault('wrong3')).rejects.toThrow();

    // "Reinicia" o keyManager: troca o limiter mas mantém o MESMO storage.
    // Isso é o que aconteceria na vida real — kill app, restart, limiter
    // reconstruído mas storage SecureStore preserva o estado.
    keyManager.__setPinLimiterForTests(sharedStorage, { baseLockoutMs: 5_000 });

    const { PinLockedError } = await import('../pin-rate-limiter');
    await expect(keyManager.unlockVault('anyok')).rejects.toBeInstanceOf(PinLockedError);
  });
});
