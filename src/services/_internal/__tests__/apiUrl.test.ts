import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native + expo-constants são bundles nativos; mockamos antes de importar
// o módulo sob teste para que `Platform.OS` e `Constants.expoConfig` retornem
// valores controlados.

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: '192.168.1.100:8081' } },
}));

import { getApiBaseUrl, getSwapApiBaseUrl } from '../../apiUrl';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_VERUM_SWAP_BACKEND;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

// ─── (C5) Precedência env-first ─────────────────────────────────────────────

describe('getApiBaseUrl — (C5) precedência env-first', () => {
  it('respeita EXPO_PUBLIC_API_URL=http://localhost:3000 (NÃO ignora mais localhost)', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000';
    expect(getApiBaseUrl()).toBe('http://localhost:3000');
  });

  it('respeita EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 (idem para loopback IPv4)', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:3000';
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3000');
  });

  it('respeita EXPO_PUBLIC_API_URL=https://api.verum.com em produção', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.verumcrypto.com';
    expect(getApiBaseUrl()).toBe('https://api.verumcrypto.com');
  });

  it('trim whitespace ao redor do env (caso .env tenha espaço acidental)', () => {
    process.env.EXPO_PUBLIC_API_URL = '  https://api.verum.com  ';
    expect(getApiBaseUrl()).toBe('https://api.verum.com');
  });

  it('env vazio cai no fallback Expo manifest', () => {
    process.env.EXPO_PUBLIC_API_URL = '';
    // mock react-native Platform.OS = 'ios' → não cai no branch web → usa hostUri
    expect(getApiBaseUrl()).toBe('http://192.168.1.100:3000');
  });

  it('env só com whitespace cai no fallback (isNonEmpty rejeita)', () => {
    process.env.EXPO_PUBLIC_API_URL = '   ';
    expect(getApiBaseUrl()).toBe('http://192.168.1.100:3000');
  });
});

describe('getSwapApiBaseUrl — (C5) mesma regra env-first', () => {
  it('respeita EXPO_PUBLIC_VERUM_SWAP_BACKEND=http://localhost:3001 em dev', () => {
    process.env.EXPO_PUBLIC_VERUM_SWAP_BACKEND = 'http://localhost:3001';
    expect(getSwapApiBaseUrl()).toBe('http://localhost:3001');
  });

  it('respeita URL de produção', () => {
    process.env.EXPO_PUBLIC_VERUM_SWAP_BACKEND = 'https://swap.verumcrypto.com';
    expect(getSwapApiBaseUrl()).toBe('https://swap.verumcrypto.com');
  });
});
