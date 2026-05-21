import { describe, expect, it, vi } from 'vitest';

// AsyncStorage é nativo; mockamos para evitar quebra no boot do connectionService.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { connectionService } from '../../connectionService';

// ─── (C3) Whitelist por origin no callback URL ──────────────────────────────

describe('connectionService.validateCallbackUrl — (C3) cross-origin', () => {
  it('aceita callback HTTPS sem expectedOrigin (modo legado)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests('https://example.com/cb'),
    ).not.toThrow();
  });

  it('aceita callback quando origin do callback === expectedOrigin', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'https://vesting.verumcrypto.com/callback',
        'https://vesting.verumcrypto.com',
      ),
    ).not.toThrow();
  });

  it('REJEITA callback para domínio diferente do declarado pelo dApp', () => {
    // dApp diz origin=https://vesting.verumcrypto.com mas callback é attacker.com
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'https://attacker.com/exfiltrate',
        'https://vesting.verumcrypto.com',
      ),
    ).toThrow(/não bate com a origem do dApp/);
  });

  it('REJEITA subdomínio diferente (evil.example.com vs example.com)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'https://evil.example.com/cb',
        'https://example.com',
      ),
    ).toThrow(/não bate com a origem/);
  });

  it('REJEITA mudança de porta (example.com:443 vs example.com:8443)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'https://example.com:8443/cb',
        'https://example.com',
      ),
    ).toThrow(/não bate com a origem/);
  });

  it('REJEITA mudança de protocolo (http:// vs https://)', () => {
    // (note: http: já é rejeitado por outra regra — mas vamos verificar a ordem)
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'http://example.com/cb',
        'https://example.com',
      ),
    ).toThrow();
  });

  it('REJEITA protocolo não-HTTP(S)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests('javascript:alert(1)'),
    ).toThrow(/Protocolo de callback não permitido/);
  });

  it('aceita HTTP localhost para dev (sem expectedOrigin)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests('http://localhost:3000/cb'),
    ).not.toThrow();
  });

  it('REJEITA HTTP em domínio não-loopback (MITM risk)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests('http://example.com/cb'),
    ).toThrow(/HTTP só é permitido em localhost/);
  });

  it('REJEITA URL malformada', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests('not-a-url'),
    ).toThrow(/inválida|malformada/);
  });

  it('REJEITA expectedOrigin malformada (origin do dApp corrompida)', () => {
    expect(() =>
      connectionService.__validateCallbackUrlForTests(
        'https://example.com/cb',
        'not-a-valid-origin',
      ),
    ).toThrow(/Origin declarada pelo dApp é inválida/);
  });
});
