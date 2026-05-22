/**
 * api/kyc.ts — Vercel serverless function pra fluxo Didit KYC.
 *
 * Action-based dispatch via ?action= (mesmo padrão de api/picpay.ts):
 *   - action=initiate     (POST) → cria sessão Didit, salva session_id, retorna URL.
 *   - action=check-status (POST) → lê DB; se pending, consulta Didit; retorna fresh.
 *   - action=webhook      (POST) → recebe notificação assinada da Didit, atualiza DB.
 *
 * Auth do app (initiate/check-status):
 *   Header `Authorization: Bearer <supabase_jwt>` validado contra Supabase Auth.
 *   Acesso ao banco via Supabase REST com o JWT do user (respeita RLS).
 *
 * Auth do webhook:
 *   HMAC-SHA256 do body cru usando DIDIT_WEBHOOK_SECRET. UPDATE no banco usa
 *   SERVICE_ROLE pra bypassar RLS (única rota que precisa disso).
 *
 * bodyParser desabilitado pra preservar bytes brutos do webhook (necessário pro
 * HMAC byte-a-byte). initiate/check-status parseiam JSON manualmente.
 *
 * ENVs necessárias no painel Vercel:
 *   SUPABASE_URL                — ex: https://qnqzcqliiaksscueifob.supabase.co
 *   SUPABASE_ANON_KEY           — JWT anon (Supabase Settings → API)
 *   SUPABASE_SERVICE_ROLE_KEY   — JWT service_role (NUNCA expor)
 *   DIDIT_API_KEY               — secret Didit
 *   DIDIT_WORKFLOW_ID           — UUID workflow Didit
 *   DIDIT_WEBHOOK_SECRET        — secret HMAC do webhook Didit
 *   DIDIT_API_BASE              — opcional, default https://verification.didit.me
 *   DIDIT_CALLBACK_URL          — opcional, default verumwallet://kyc-callback
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

export const config = {
  api: { bodyParser: false },
};

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DIDIT_API_KEY = process.env.DIDIT_API_KEY ?? '';
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID ?? '';
const DIDIT_WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET ?? '';
const DIDIT_API_BASE = process.env.DIDIT_API_BASE ?? 'https://verification.didit.me';
const DIDIT_CALLBACK_URL = process.env.DIDIT_CALLBACK_URL ?? 'verumwallet://kyc-callback';

const ALLOWED_ORIGINS = [
  'https://verumcrypto.com',
  'https://www.verumcrypto.com',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface SupabaseUser {
  id: string;
  email?: string;
}

interface KycProfileRow {
  status: string;
  didit_session_id: string | null;
}

type KycStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'not_started';

interface DiditSession {
  session_id: string;
  url: string;
}

interface DiditDecision {
  status: string;
  [key: string]: unknown;
}

// ─── Body helpers ─────────────────────────────────────────────────────────────
async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req: VercelRequest): Promise<unknown> {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return {};
  }
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────
async function fetchSupabaseUser(jwt: string): Promise<SupabaseUser | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string; email?: string };
  return data?.id ? { id: data.id, email: data.email } : null;
}

async function fetchKycProfile(jwt: string, userId: string): Promise<KycProfileRow | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/kyc_profiles` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=status,didit_session_id` +
    `&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
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
  jwt: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // UPDATE first; INSERT if no row exists. Respeita RLS via JWT do user.
  const existing = await fetchKycProfile(jwt, userId);
  if (existing) {
    const url = `${SUPABASE_URL}/rest/v1/kyc_profiles?user_id=eq.${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kyc_profiles`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
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
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<number> {
  // Usado pelo webhook (sem JWT). Service role bypassa RLS.
  const url =
    `${SUPABASE_URL}/rest/v1/kyc_profiles?didit_session_id=eq.${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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

// ─── Didit helpers ────────────────────────────────────────────────────────────
async function diditCreateSession(vendorData: string): Promise<DiditSession> {
  const res = await fetch(`${DIDIT_API_BASE}/v2/session/`, {
    method: 'POST',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: vendorData,
      callback: DIDIT_CALLBACK_URL,
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
    throw new Error(`Didit /v2/session/ shape inesperado: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { session_id: sessionId, url };
}

async function diditGetDecision(sessionId: string): Promise<DiditDecision> {
  const res = await fetch(`${DIDIT_API_BASE}/v2/session/${encodeURIComponent(sessionId)}/decision/`, {
    headers: { 'x-api-key': DIDIT_API_KEY },
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
  const provided = signature.replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeStringEquals(provided, expected);
}

// ─── Validações de config ─────────────────────────────────────────────────────
function requireSupabase(res: VercelResponse): boolean {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(503).json({
      error: 'KycNotConfigured',
      message: 'SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios.',
    });
    return false;
  }
  return true;
}

function requireDidit(res: VercelResponse): boolean {
  if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
    res.status(503).json({
      error: 'KycNotConfigured',
      message: 'DIDIT_API_KEY e DIDIT_WORKFLOW_ID são obrigatórios.',
    });
    return false;
  }
  return true;
}

function getBearerToken(req: VercelRequest): string | null {
  const auth = (req.headers.authorization as string) ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  return auth.replace(/^Bearer\s+/i, '').trim();
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = (req.headers.origin as string) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const action = (req.query.action as string) ?? '';

  try {
    // ─── action=initiate ──────────────────────────────────────────────────────
    if (action === 'initiate' && req.method === 'POST') {
      if (!requireSupabase(res) || !requireDidit(res)) return;

      const jwt = getBearerToken(req);
      if (!jwt) {
        res.status(401).json({ error: 'Unauthorized', message: 'Bearer token requerido.' });
        return;
      }

      const user = await fetchSupabaseUser(jwt);
      if (!user) {
        res.status(401).json({ error: 'InvalidToken', message: 'Token Supabase inválido.' });
        return;
      }

      const session = await diditCreateSession(user.id);

      await upsertKycProfile(jwt, user.id, {
        didit_session_id: session.session_id,
        status: 'pending',
      });

      res.status(200).json({
        verificationUrl: session.url,
        sessionId: session.session_id,
      });
      return;
    }

    // ─── action=check-status ──────────────────────────────────────────────────
    if (action === 'check-status' && req.method === 'POST') {
      if (!requireSupabase(res)) return;

      const jwt = getBearerToken(req);
      if (!jwt) {
        res.status(401).json({ error: 'Unauthorized', message: 'Bearer token requerido.' });
        return;
      }

      const user = await fetchSupabaseUser(jwt);
      if (!user) {
        res.status(401).json({ error: 'InvalidToken', message: 'Token Supabase inválido.' });
        return;
      }

      const profile = await fetchKycProfile(jwt, user.id);
      let kycStatus: KycStatus = (profile?.status as KycStatus) ?? 'not_started';

      // Se pending/in_review E temos session_id E Didit configurada, consulta
      // a Didit pra status fresh (não confia só no DB que pode estar velho).
      const needsRefresh = profile?.didit_session_id &&
        (kycStatus === 'pending' || kycStatus === 'in_review');

      if (needsRefresh && DIDIT_API_KEY) {
        try {
          const decision = await diditGetDecision(profile!.didit_session_id!);
          const fresh = mapDiditStatus(decision.status);
          if (fresh !== kycStatus) {
            await upsertKycProfile(jwt, user.id, {
              status: fresh,
              didit_decision: decision,
            });
            kycStatus = fresh;
          }
        } catch (refreshErr: any) {
          // Não falha o request — devolve o que tem no DB.
          console.warn('[api/kyc] didit refresh failed:', refreshErr?.message);
        }
      }

      res.status(200).json({
        kycStatus,
        approved: kycStatus === 'approved',
      });
      return;
    }

    // ─── action=webhook ───────────────────────────────────────────────────────
    if (action === 'webhook' && req.method === 'POST') {
      if (!DIDIT_WEBHOOK_SECRET) {
        res.status(503).json({ error: 'WebhookNotConfigured' });
        return;
      }
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.status(503).json({ error: 'WebhookNotConfigured', message: 'SUPABASE_SERVICE_ROLE_KEY ausente.' });
        return;
      }

      const rawBody = await readRawBody(req);
      if (rawBody.length === 0) {
        res.status(400).json({ error: 'EmptyBody' });
        return;
      }

      // Header da assinatura — Didit varia o nome.
      const signature =
        (req.headers['x-didit-signature'] as string) ??
        (req.headers['didit-signature'] as string) ??
        (req.headers['x-signature'] as string) ??
        (req.headers['x-hub-signature-256'] as string) ??
        '';

      if (!signature) {
        res.status(401).json({ error: 'MissingSignature' });
        return;
      }

      if (!verifyHmac(rawBody, DIDIT_WEBHOOK_SECRET, signature)) {
        console.warn('[api/kyc] webhook HMAC inválido');
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

      const isStatusEvent =
        typeof event === 'string' &&
        (event === 'status.updated' || event === 'user.status.updated');

      if (!isStatusEvent || !sessionId) {
        // Eventos não-relevantes — acknowledged sem fazer nada. Sempre 200
        // pra Didit não retry.
        res.status(200).json({ ok: true, ignored: true, event });
        return;
      }

      const mapped = mapDiditStatus(rawStatus);
      try {
        const updated = await adminUpdateBySessionId(String(sessionId), {
          status: mapped,
          didit_decision: payload,
        });

        if (updated === 0) {
          console.warn('[api/kyc] webhook session desconhecida:', { sessionId, vendorData });
        }
        res.status(200).json({ ok: true, updated, status: mapped });
      } catch (err: any) {
        console.warn('[api/kyc] webhook DB update failed:', err?.message);
        res.status(502).json({ error: 'DbUpdateFailed', message: err?.message });
      }
      return;
    }

    res.status(404).json({ error: 'NotFound', message: `Ação '${action}' não existe.` });
  } catch (err: any) {
    console.error('[api/kyc] handler error:', err?.message);
    res.status(500).json({ error: 'InternalServerError', message: err?.message });
  }
}

// Permite import em testes sem renderizar o handler.
export { readJsonBody, mapDiditStatus, verifyHmac };
