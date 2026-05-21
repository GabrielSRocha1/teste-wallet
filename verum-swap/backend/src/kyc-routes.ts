/**
 * kyc-routes.ts — Endpoints de KYC consumidos pelo app Verum Wallet.
 *
 * Endpoints:
 *  - POST /kyc/initiate       → cria sessão na Didit, salva session_id, retorna URL
 *  - POST /kyc/check-status   → lê DB; se pending, consulta Didit; retorna fresh
 *  - POST /kyc/webhook        → recebe notificação assinada da Didit, atualiza DB
 *
 * Auth do app:
 *   Header `Authorization: Bearer <supabase_jwt>` validado contra Supabase Auth.
 *   Acesso ao banco via Supabase REST com o próprio JWT do user (respeita RLS).
 *
 * Auth do webhook:
 *   Sem JWT — Didit não autentica do lado dela. Validamos via HMAC-SHA256 do
 *   body usando DIDIT_WEBHOOK_SECRET. UPDATE no banco usa SERVICE_ROLE pra
 *   bypassar RLS (única rota que precisa disso).
 *
 * Segurança:
 *   - HMAC com timingSafeEqual (evita timing attack).
 *   - Webhook usa raw body bytes — express.raw() registrado especificamente
 *     pra essa rota antes do parser JSON global.
 *   - vendor_data carrega user_id pra mapear sessão Didit ↔ user da wallet.
 */

import crypto from 'node:crypto';
import { type Request, type Response, Router, raw as expressRaw } from 'express';
import type { Env } from './_internal/env';
import { createLogger } from './_internal/logger';

const log = createLogger('KycRoutes');

interface SupabaseUser {
  id: string;
  email?: string;
}

interface KycProfileRow {
  status: string;
  didit_session_id: string | null;
}

type KycStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'not_started';

// ─── Helpers Supabase ─────────────────────────────────────────────────────────

async function fetchSupabaseUser(
  supabaseUrl: string,
  anonKey: string,
  jwt: string,
): Promise<SupabaseUser | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string; email?: string };
  return data?.id ? { id: data.id, email: data.email } : null;
}

async function fetchKycProfile(
  supabaseUrl: string,
  anonKey: string,
  jwt: string,
  userId: string,
): Promise<KycProfileRow | null> {
  const url =
    `${supabaseUrl}/rest/v1/kyc_profiles` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=status,didit_session_id` +
    `&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase REST ${res.status}: ${text.slice(0, 200)}`);
  }
  const rows = (await res.json()) as KycProfileRow[];
  return rows[0] ?? null;
}

async function upsertKycProfile(
  supabaseUrl: string,
  anonKey: string,
  jwt: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // Tenta UPDATE primeiro; se não houver row, INSERT.
  const existing = await fetchKycProfile(supabaseUrl, anonKey, jwt, userId);
  if (existing) {
    const url = `${supabaseUrl}/rest/v1/kyc_profiles?user_id=eq.${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`Supabase PATCH ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } else {
    const res = await fetch(`${supabaseUrl}/rest/v1/kyc_profiles`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_id: userId, status: 'pending', ...patch }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`Supabase INSERT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

async function adminUpdateBySessionId(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<number> {
  // Usado pelo webhook (sem JWT do user). Service role bypassa RLS.
  const url =
    `${supabaseUrl}/rest/v1/kyc_profiles?didit_session_id=eq.${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,count=exact',
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`Supabase admin PATCH ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const rows = (await res.json()) as unknown[];
  return rows.length;
}

// ─── Helpers Didit ────────────────────────────────────────────────────────────

interface DiditSession {
  session_id: string;
  url: string;
}

interface DiditDecision {
  status: string;
  [key: string]: unknown;
}

async function diditCreateSession(
  apiBase: string,
  apiKey: string,
  workflowId: string,
  vendorData: string,
  callbackUrl: string,
): Promise<DiditSession> {
  const res = await fetch(`${apiBase}/v2/session/`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: vendorData,
      callback: callbackUrl,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Didit /v2/session/ ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { session_id?: string; url?: string; verification_url?: string };
  const sessionId = data.session_id;
  const url = data.url ?? data.verification_url;
  if (!sessionId || !url) {
    throw new Error(`Didit /v2/session/ retornou shape inesperado: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { session_id: sessionId, url };
}

async function diditGetDecision(
  apiBase: string,
  apiKey: string,
  sessionId: string,
): Promise<DiditDecision> {
  const res = await fetch(`${apiBase}/v2/session/${encodeURIComponent(sessionId)}/decision/`, {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Didit /decision ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as DiditDecision;
}

function mapDiditStatus(raw: unknown): KycStatus {
  const s = String(raw ?? '').toLowerCase().replace(/\s+/g, '_');
  if (['approved', 'verified', 'accept', 'accepted'].includes(s)) return 'approved';
  if (['declined', 'rejected', 'denied', 'failed'].includes(s)) return 'rejected';
  if (['expired', 'timeout'].includes(s)) return 'expired';
  if (['in_review', 'review', 'manual_review', 'needs_review'].includes(s)) return 'in_review';
  return 'pending';
}

// ─── HMAC ─────────────────────────────────────────────────────────────────────

function timingSafeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function verifyHmac(rawBody: Buffer, secret: string, signature: string): boolean {
  // Aceita formatos: "sha256=<hex>" ou só "<hex>".
  const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeStringEquals(provided, expected);
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

export interface KycDeps {
  env: Env;
}

export function createKycRoutes(deps: KycDeps): Router {
  const router = Router();
  const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    DIDIT_API_BASE,
    DIDIT_API_KEY,
    DIDIT_WORKFLOW_ID,
    DIDIT_WEBHOOK_SECRET,
    DIDIT_CALLBACK_URL,
  } = deps.env;

  function requireSupabase(res: Response): boolean {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      res.status(503).json({
        error: 'KycNotConfigured',
        message: 'SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios para /kyc.',
      });
      return false;
    }
    return true;
  }

  function requireDidit(res: Response): boolean {
    if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
      res.status(503).json({
        error: 'KycNotConfigured',
        message: 'DIDIT_API_KEY e DIDIT_WORKFLOW_ID são obrigatórios para /kyc.',
      });
      return false;
    }
    return true;
  }

  function getBearerToken(req: Request): string | null {
    const auth = req.header('authorization') ?? '';
    if (!/^Bearer\s+\S+/i.test(auth)) return null;
    return auth.replace(/^Bearer\s+/i, '').trim();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // POST /kyc/initiate
  // ───────────────────────────────────────────────────────────────────────────
  router.post('/initiate', async (req: Request, res: Response) => {
    if (!requireSupabase(res) || !requireDidit(res)) return;

    const jwt = getBearerToken(req);
    if (!jwt) {
      res.status(401).json({ error: 'Unauthorized', message: 'Bearer token requerido.' });
      return;
    }

    try {
      const user = await fetchSupabaseUser(SUPABASE_URL!, SUPABASE_ANON_KEY!, jwt);
      if (!user) {
        res.status(401).json({ error: 'InvalidToken', message: 'Token Supabase inválido.' });
        return;
      }

      const session = await diditCreateSession(
        DIDIT_API_BASE,
        DIDIT_API_KEY!,
        DIDIT_WORKFLOW_ID!,
        user.id,
        DIDIT_CALLBACK_URL,
      );

      await upsertKycProfile(SUPABASE_URL!, SUPABASE_ANON_KEY!, jwt, user.id, {
        didit_session_id: session.session_id,
        status: 'pending',
      });

      res.json({ verificationUrl: session.url, sessionId: session.session_id });
    } catch (err: any) {
      log.warn('initiate failed', { correlationId: req.correlationId, error: err?.message });
      res.status(502).json({ error: 'KycUpstreamFailure', message: err?.message });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /kyc/check-status
  // ───────────────────────────────────────────────────────────────────────────
  router.post('/check-status', async (req: Request, res: Response) => {
    if (!requireSupabase(res)) return;

    const jwt = getBearerToken(req);
    if (!jwt) {
      res.status(401).json({ error: 'Unauthorized', message: 'Bearer token requerido.' });
      return;
    }

    try {
      const user = await fetchSupabaseUser(SUPABASE_URL!, SUPABASE_ANON_KEY!, jwt);
      if (!user) {
        res.status(401).json({ error: 'InvalidToken', message: 'Token Supabase inválido.' });
        return;
      }

      const profile = await fetchKycProfile(SUPABASE_URL!, SUPABASE_ANON_KEY!, jwt, user.id);
      let kycStatus: KycStatus = (profile?.status as KycStatus) ?? 'not_started';

      // Se está pending/in_review E temos session_id E Didit configurada,
      // consulta Didit pra status fresco (não confia só no DB que pode estar
      // velho se o webhook ainda não chegou).
      const needsRefresh = profile?.didit_session_id &&
        (kycStatus === 'pending' || kycStatus === 'in_review');

      if (needsRefresh && DIDIT_API_KEY) {
        try {
          const decision = await diditGetDecision(
            DIDIT_API_BASE,
            DIDIT_API_KEY,
            profile!.didit_session_id!,
          );
          const fresh = mapDiditStatus(decision.status);
          if (fresh !== kycStatus) {
            await upsertKycProfile(SUPABASE_URL!, SUPABASE_ANON_KEY!, jwt, user.id, {
              status: fresh,
              didit_decision: decision,
            });
            kycStatus = fresh;
          }
        } catch (refreshErr: any) {
          // Não falha o request — devolve o que o DB tem.
          log.warn('didit refresh failed', {
            correlationId: req.correlationId,
            error: refreshErr?.message,
          });
        }
      }

      res.json({
        kycStatus,
        approved: kycStatus === 'approved',
      });
    } catch (err: any) {
      log.warn('check-status failed', { correlationId: req.correlationId, error: err?.message });
      res.status(502).json({ error: 'KycUpstreamFailure', message: err?.message });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /kyc/webhook
  // ───────────────────────────────────────────────────────────────────────────
  // Usa express.raw() pra preservar bytes do body — necessário pro HMAC.
  // Esta rota DEVE ser montada antes do express.json() global, OU usar raw
  // só pra ela como aqui (raw vence pra essa rota porque chega primeiro
  // no pipeline desse router).
  router.post(
    '/webhook',
    expressRaw({ type: '*/*', limit: '100kb' }),
    async (req: Request, res: Response) => {
      if (!DIDIT_WEBHOOK_SECRET) {
        res.status(503).json({ error: 'WebhookNotConfigured' });
        return;
      }
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.status(503).json({ error: 'WebhookNotConfigured', message: 'SUPABASE_SERVICE_ROLE_KEY ausente.' });
        return;
      }

      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody)) {
        res.status(400).json({ error: 'InvalidBody' });
        return;
      }

      // Header da assinatura — Didit pode usar nomes variados. Tentamos os comuns.
      const signature =
        req.header('x-didit-signature') ??
        req.header('didit-signature') ??
        req.header('x-signature') ??
        req.header('x-hub-signature-256') ??
        '';

      if (!signature) {
        res.status(401).json({ error: 'MissingSignature' });
        return;
      }

      if (!verifyHmac(rawBody, DIDIT_WEBHOOK_SECRET, signature)) {
        log.warn('webhook HMAC inválido', { correlationId: req.correlationId });
        res.status(401).json({ error: 'InvalidSignature' });
        return;
      }

      let payload: any;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.status(400).json({ error: 'InvalidJsonBody' });
        return;
      }

      // Aceita 2 shapes prováveis:
      //  a) { event: "...", data: { session_id, status, ... } }
      //  b) { type: "...", session_id, status, ... }  (flat)
      const event = payload?.event ?? payload?.type ?? payload?.name;
      const sessionId =
        payload?.data?.session_id ?? payload?.session_id ?? payload?.sessionId;
      const rawStatus =
        payload?.data?.status ?? payload?.status ?? payload?.decision?.status;
      const vendorData =
        payload?.data?.vendor_data ?? payload?.vendor_data ?? payload?.vendorData;

      log.info('webhook received', {
        correlationId: req.correlationId,
        event,
        sessionId,
        rawStatus,
      });

      const isStatusEvent =
        typeof event === 'string' &&
        (event === 'status.updated' || event === 'user.status.updated');

      if (!isStatusEvent || !sessionId) {
        // Eventos não-relevantes (user.data.updated, activity.created, etc.)
        // — acknowledged sem fazer nada. Sempre 200 pra Didit não retry.
        res.json({ ok: true, ignored: true, event });
        return;
      }

      const mapped = mapDiditStatus(rawStatus);
      try {
        const updated = await adminUpdateBySessionId(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          String(sessionId),
          {
            status: mapped,
            didit_decision: payload,
          },
        );

        if (updated === 0) {
          // Session_id desconhecido — provavelmente é outro ambiente (dev/prod
          // dividem webhook). Ignoramos silenciosamente.
          log.info('webhook session desconhecida (provavelmente outro ambiente)', {
            sessionId,
            vendorData,
          });
        }
        res.json({ ok: true, updated, status: mapped });
      } catch (err: any) {
        log.warn('webhook DB update failed', {
          correlationId: req.correlationId,
          error: err?.message,
        });
        res.status(502).json({ error: 'DbUpdateFailed', message: err?.message });
      }
    },
  );

  return router;
}
