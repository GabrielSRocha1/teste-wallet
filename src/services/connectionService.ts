/**
 * ConnectionService — Gerencia sessões de dApps conectados à Verum Wallet.
 *
 * Segurança:
 * - Nunca expõe chave privada ou mnemônico
 * - Callback apenas para HTTPS ou localhost (dev)
 * - Sessions persistidas localmente via AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Permission, ConnectedSession, ConnectionRequest } from '@/src/types/wallet.types';

export type { Permission, ConnectedSession, ConnectionRequest } from '@/src/types/wallet.types';

const SESSIONS_KEY = 'verum_connected_sessions';
const CALLBACK_TIMEOUT_MS = 8000;

export const PERMISSION_META: Record<Permission, { label: string; description: string; icon: string; risk: 'low' | 'medium' | 'high' }> = {
  publicKey: {
    label: 'Endereço da Carteira',
    description: 'Ver seu endereço público Solana',
    icon: 'key',
    risk: 'low',
  },
  balance: {
    label: 'Saldos',
    description: 'Ver saldo dos seus tokens (VRC, BDC, ESCT, SOL)',
    icon: 'bar-chart-2',
    risk: 'low',
  },
  network: {
    label: 'Rede',
    description: 'Identificar se você está em mainnet ou devnet',
    icon: 'globe',
    risk: 'low',
  },
  signMessage: {
    label: 'Assinar Mensagens',
    description: 'Solicitar que você assine mensagens arbitrárias',
    icon: 'edit-3',
    risk: 'medium',
  },
  signTransaction: {
    label: 'Assinar Transações',
    description: 'Solicitar aprovação de transações na blockchain',
    icon: 'send',
    risk: 'high',
  },
  signAllTransactions: {
    label: 'Assinar Lote de Transações',
    description: 'Aprovar várias transações de uma só vez',
    icon: 'layers',
    risk: 'high',
  },
};

class ConnectionService {
  // ── Sessões aprovadas ─────────────────────────────────────────────────────

  async getSessions(): Promise<ConnectedSession[]> {
    try {
      const raw = await AsyncStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async saveSession(session: ConnectedSession): Promise<void> {
    const sessions = await this.getSessions();
    // Substitui se já existe a mesma origin (re-connect)
    const filtered = sessions.filter(s => s.origin !== session.origin);
    filtered.unshift(session);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
  }

  async revokeSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
  }

  async getSessionByOrigin(origin: string): Promise<ConnectedSession | null> {
    const sessions = await this.getSessions();
    return sessions.find(s => s.origin === origin) ?? null;
  }

  // ── Parsing do deep link ──────────────────────────────────────────────────

  /**
   * Parseia deep links de assinatura: verumwallet://sign?...
   * Retorna null se a URL não for um link de sign válido.
   */
  parseSignURL(url: string): {
    action: 'signTransaction' | 'signAllTransactions' | 'signMessage';
    data:   string;
    origin: string;
    session?: string;
    callbackUrl?: string;
  } | null {
    try {
      const parsed  = new URL(url.replace('verumwallet://', 'https://verumwallet/'));
      const isSign  =
        parsed.hostname === 'sign' ||
        parsed.pathname === '/sign' ||
        parsed.pathname.startsWith('/sign');

      if (!isSign) return null;

      const p      = parsed.searchParams;
      const action = p.get('action') as 'signTransaction' | 'signAllTransactions' | 'signMessage' | null;
      const data   = p.get('data');
      const origin = p.get('origin');

      if (!action || !data || !origin) return null;

      const validActions = ['signTransaction', 'signAllTransactions', 'signMessage'];
      if (!validActions.includes(action)) return null;

      if (__DEV__) console.log('[ConnectionService] parseSignURL', { action, origin });

      return {
        action,
        data,
        origin,
        session:     p.get('session')  ?? undefined,
        callbackUrl: p.get('callback') ?? undefined,
      };
    } catch {
      return null;
    }
  }

  parseConnectionURL(url: string): ConnectionRequest | null {
    try {
      // Suporta: verumwallet://connect?... e https://vesting.verumcrypto.com/callback?...
      const parsed = new URL(url.replace('verumwallet://', 'https://verumwallet/'));

      // Verifica se é um deep link de conexão válido
      const isCustomScheme =
        parsed.hostname === 'connect' ||
        parsed.pathname === '/connect' ||
        parsed.pathname.startsWith('/connect');

      const isHttpsCallback =
        parsed.hostname === 'vesting.verumcrypto.com' &&
        parsed.pathname.startsWith('/callback');

      if (!isCustomScheme && !isHttpsCallback) return null;

      const p = parsed.searchParams;
      const redirectLink = p.get('redirect_link') ?? undefined;
      const appUrl = p.get('app_url') ?? undefined;
      let origin = p.get('origin') || appUrl;
      
      // Se não houver origin, tenta extrair do redirect_link
      if (!origin && redirectLink) {
        try { origin = new URL(redirectLink).origin; } catch {}
      }
      
      let name = p.get('name');
      if (!name && origin) {
        try { name = new URL(origin).hostname; } catch { name = 'Unknown dApp'; }
      }
      
      // Fallback final para origin
      if (!origin) origin = 'unknown';

      const session = p.get('session') || `sess_${Date.now()}`;
      const rawPermissions = p.get('permissions') ?? 'publicKey';

      // Guarda defensiva: dApp malicioso pode mandar string enorme. Cap em
      // 256 chars / 10 tokens evita alocação patológica (DoS local na UI).
      if (rawPermissions.length > 256) return null;
      const permTokens = rawPermissions.split(',', 11);
      if (permTokens.length > 10) return null;

      const permissions = permTokens.filter(
        (perm) => perm in PERMISSION_META,
      ) as Permission[];

      // publicKey é sempre incluída
      if (!permissions.includes('publicKey')) permissions.unshift('publicKey');

      return {
        session,
        name: name || 'Unknown dApp',
        origin,
        icon: p.get('icon') ?? undefined,
        callbackUrl: p.get('callback') ?? undefined,
        permissions,
        dappEncryptionPublicKey: p.get('dapp_encryption_public_key') ?? undefined,
        redirectLink: p.get('redirect_link') ?? undefined,
        cluster: p.get('cluster') ?? undefined,
        appUrl,
      };
    } catch {
      return null;
    }
  }

  // ── Callback para o dApp ──────────────────────────────────────────────────

  async notifyApproved(
    callbackUrl: string | undefined,
    payload: { publicKey: string; network: string; session: string; permissions: Permission[] },
    expectedOrigin?: string,
  ): Promise<void> {
    if (!callbackUrl) return;
    this._validateCallbackUrl(callbackUrl, expectedOrigin);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, ...payload }),
        signal: controller.signal,
      });

      clearTimeout(timer);
    } catch (err: any) {
      // Callback falhou — não bloqueia o usuário, apenas loga
      console.warn('[ConnectionService] Callback falhou:', err?.message);
    }
  }

  async notifyRejected(callbackUrl: string | undefined, session: string, expectedOrigin?: string): Promise<void> {
    if (!callbackUrl) return;
    this._validateCallbackUrl(callbackUrl, expectedOrigin);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false, session }),
        signal: controller.signal,
      });

      clearTimeout(timer);
    } catch (err: any) {
      console.warn('[ConnectionService] Callback de rejeição falhou:', err?.message);
    }
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  /**
   * (C3) Valida que o callback é seguro E pertence à origem que o dApp
   * declarou em `ConnectionRequest.origin`/`SignRequest.origin`.
   *
   * Sem o cross-check de origem, um dApp malicioso podia setar
   * `callbackUrl=https://attacker.com/c` e exfiltrar publicKey + session id +
   * permissions de qualquer usuário que aprovasse a conexão.
   *
   * Regra:
   *   1. Protocolo HTTPS (ou HTTP em loopback dev).
   *   2. Hostname com pelo menos um ponto (exclui hosts sem TLD).
   *   3. Se `expectedOrigin` foi informado, o origin do callback DEVE bater
   *      exatamente (protocolo + host + porta). Subdomínios diferentes são
   *      rejeitados — quem confia em "api.example.com" não autoriza
   *      "evil.api.example.com".
   */
  private _validateCallbackUrl(url: string, expectedOrigin?: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('URL de callback inválida: malformada.');
    }

    // HTTP só é tolerado em loopback (dev local). Qualquer outro destino HTTP
    // pode ser MITM: callbacks carregam publicKey + session id em texto.
    if (parsed.protocol === 'http:') {
      const isLoopback =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1';
      if (!isLoopback) {
        throw new Error('Callback HTTP só é permitido em localhost (dev). Use HTTPS.');
      }
    } else if (parsed.protocol !== 'https:') {
      throw new Error(`Protocolo de callback não permitido: ${parsed.protocol}`);
    }

    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && !parsed.hostname.includes('.')) {
      throw new Error('URL de callback inválida: hostname sem TLD.');
    }

    // (C3) Cross-check de origem: callback DEVE pertencer à origin declarada.
    if (expectedOrigin) {
      let expected: URL;
      try {
        expected = new URL(expectedOrigin);
      } catch {
        throw new Error(`Origin declarada pelo dApp é inválida: ${expectedOrigin}`);
      }

      // Comparação por `origin` (proto+host+port). Não permite subdomínios.
      if (parsed.origin !== expected.origin) {
        throw new Error(
          `Callback não autorizado: origem do callback (${parsed.origin}) não bate com a origem do dApp (${expected.origin}).`,
        );
      }
    }
  }

  /** TEST-ONLY: expõe a validação para testes diretos sem mock de fetch. */
  __validateCallbackUrlForTests(url: string, expectedOrigin?: string): void {
    this._validateCallbackUrl(url, expectedOrigin);
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
