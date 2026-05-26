/**
 * api/picpay.ts
 * Integração com a API PicPay Gateway (OAuth 2.0) — fluxo Pix dinâmico apenas.
 *
 * Docs: https://developers-business.picpay.com/checkout/docs/api/charge-pix
 *
 * Variáveis de ambiente:
 *   PICPAY_GATEWAY_CLIENT_ID       — Client ID do painel PicPay Empresas
 *   PICPAY_GATEWAY_CLIENT_SECRET   — Client Secret (NUNCA expor)
 *   PICPAY_GATEWAY_WEBHOOK_SECRET  — Secret HMAC pra validar webhooks
 *   PICPAY_GATEWAY_CALLBACK_URL    — URL pública que recebe webhooks (informativa)
 *   SUPABASE_SERVICE_ROLE_KEY      — Pra atualizar status no banco
 *   NEXT_PUBLIC_SUPABASE_URL       — URL do Supabase
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

// IMPORTANTE: AUTH_URL e CHARGE_URL precisam ser do MESMO ambiente
// (ambos sandbox ou ambos produção), senão o token é rejeitado com
// "Token issuer not allowed". Parametrizado via env pra facilitar
// a troca sandbox↔prod sem deploy de código.
const PICPAY_AUTH_URL =
  process.env.PICPAY_AUTH_URL ??
  'https://checkout-api.picpay.com/oauth2/token';
const PICPAY_CHARGE_URL =
  process.env.PICPAY_CHARGE_URL ??
  'https://ecommerce-api.svcp.ppay.me/sandbox/v1/charge/pix';

const CLIENT_ID = process.env.PICPAY_GATEWAY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.PICPAY_GATEWAY_CLIENT_SECRET ?? '';
const WEBHOOK_SECRET = process.env.PICPAY_GATEWAY_WEBHOOK_SECRET ?? '';
// Aceita tanto SUPABASE_URL (convenção do backend) quanto NEXT_PUBLIC_SUPABASE_URL (legado).
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ALLOWED_ORIGINS = [
  'https://verumcrypto.com',
  'https://www.verumcrypto.com',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

// ───────────────────────────────────────────────────────────────────────────
// OAuth: cache em memória (token vive 5 min; renovamos a partir de 4min30s)
// ───────────────────────────────────────────────────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(PICPAY_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PicPay OAuth failed: ${res.status} — ${text}`);
  }

  const data = await res.json();
  const ttlMs = (data.expires_in ?? 300) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs - 30_000 };
  return cachedToken.value;
}

// PicPay aceita merchantChargeId de 6-36 chars (alfanumérico + hífens).
// orderId do app é "pix-{uuid}-{ts}" (~58 chars) → derivamos hash determinístico.
function deriveMerchantChargeId(orderId: string): string {
  const hash = createHash('sha256').update(orderId).digest('hex').slice(0, 32);
  return `vp-${hash}`; // 35 chars
}

function sanitizeOrderId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return clean.length > 0 && clean.length <= 128 ? clean : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action as string;

  try {
    // ─── 1. CRIAR COBRANÇA PIX ───────────────────────────────────────────
    if (action === 'create' && req.method === 'POST') {
      const { amount, referenceId, buyer } = req.body;

      if (!amount || !referenceId || !buyer) {
        return res.status(400).json({ error: 'amount, referenceId e buyer são obrigatórios' });
      }

      const requiredFields: Array<keyof typeof buyer> = [
        'firstName', 'lastName', 'document', 'email', 'phone',
      ];
      for (const field of requiredFields) {
        if (typeof buyer[field] !== 'string' || buyer[field].trim().length === 0) {
          return res.status(400).json({ error: `buyer.${String(field)} deve ser string não-vazia.` });
        }
      }

      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'amount deve ser número positivo.' });
      }

      const cleanReferenceId = sanitizeOrderId(referenceId);
      if (!cleanReferenceId) {
        return res.status(400).json({ error: 'referenceId inválido.' });
      }

      const token = await getAccessToken();

      // Link de Pagamento expira em data (YYYY-MM-DD), não timestamp.
      // Damos 7 dias de janela — depois de pago vira "paid" independente.
      const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const chargeLabel = `${buyer.firstName} ${buyer.lastName}`.trim() || 'Cobrança Verum';

      // Payment Link aceita order_number com até 15 chars. Nosso id interno
      // (vest-{uuid}-{ts}) tem ~60. Hash determinístico SHA256 → 15 hex chars
      // (~60 bits de entropia, colisão desprezível).
      const orderNumber = createHash('sha256')
        .update(cleanReferenceId)
        .digest('hex')
        .slice(0, 15);

      const payload = {
        charge: {
          name: chargeLabel,
          description: 'Vesting Verum',
          order_number: orderNumber,
          redirect_url: 'https://www.verumcrypto.com',
          payment: {
            methods: ['BRCODE'],
            brcode_arrangements: ['PIX'],
          },
          amounts: {
            product: Math.round(parsedAmount * 100), // PicPay em centavos
          },
        },
        options: {
          allow_create_pix_key: true,
          expired_at: expiredAt,
        },
      };

      const picpayRes = await fetch(PICPAY_CHARGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const picpayText = await picpayRes.text();
      if (!picpayRes.ok) {
        console.error('[PicPay] Charge failed:', picpayRes.status, picpayText);
        return res.status(502).json({ error: 'Falha ao criar cobrança PicPay' });
      }
      const picpayData = JSON.parse(picpayText);
      const brcode: string | undefined = picpayData?.brcode;
      if (!brcode) {
        console.error('[PicPay] Response missing brcode:', picpayData);
        return res.status(502).json({ error: 'Resposta PicPay sem brcode' });
      }

      // Linka txid ↔ orderId no Supabase — webhook do Payment Link usa txid
      // pra identificar qual cobrança foi paga.
      if (SUPABASE_URL && SUPABASE_KEY && picpayData.txid) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/deposit_orders?id=eq.${cleanReferenceId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
            body: JSON.stringify({ picpay_reference: picpayData.txid }),
          },
        );
      }

      // Frontend gera o PNG localmente via qrcode.toDataURL(content) — não
      // mandamos base64 porque o Payment Link só devolve a string brcode.
      return res.status(200).json({
        qrcode: { content: brcode },
        referenceId: cleanReferenceId,
        txid: picpayData.txid,
        link: picpayData.link,
        deeplink: picpayData.deeplink,
        expiresInSeconds: 7 * 24 * 60 * 60,
      });
    }

    // ─── 2. WEBHOOK (PicPay → backend) ───────────────────────────────────
    if (action === 'webhook' && req.method === 'POST') {
      // Validação HMAC do payload bruto.
      // Vercel parseia req.body automaticamente — re-serializamos pra hash.
      // Caveat: ordem das chaves pode diferir; se PicPay validar sobre raw bytes,
      // será necessário desabilitar bodyParser (config abaixo). Mantemos validação
      // best-effort + log explícito de divergência.
      const signatureHeader =
        (req.headers['x-picpay-signature'] as string) ||
        (req.headers['x-signature'] as string) ||
        '';

      if (WEBHOOK_SECRET) {
        const rawPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawPayload).digest('hex');
        const provided = signatureHeader.replace(/^sha256=/, '');
        const ok =
          provided.length === expected.length &&
          timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
        if (!ok) {
          console.warn('[PicPay webhook] HMAC mismatch — rejeitando');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const merchantChargeId =
        body.merchantChargeId || body.charge?.merchantChargeId || body.data?.merchantChargeId;
      const chargeStatus =
        body.chargeStatus || body.charge?.chargeStatus || body.data?.chargeStatus || body.status;

      if (!merchantChargeId) {
        return res.status(400).json({ error: 'merchantChargeId ausente no payload' });
      }

      const isPaid =
        chargeStatus === 'PAID' ||
        chargeStatus === 'paid' ||
        chargeStatus === 'COMPLETED' ||
        chargeStatus === 'PRE_AUTHORIZED';

      if (isPaid && SUPABASE_URL && SUPABASE_KEY) {
        // Lookup pelo picpay_reference pra encontrar o deposit_order interno
        await fetch(
          `${SUPABASE_URL}/rest/v1/deposit_orders?picpay_reference=eq.${encodeURIComponent(merchantChargeId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({
              status: 'paid',
              paid_at: new Date().toISOString(),
            }),
          },
        );
      }

      return res.status(200).send('OK');
    }

    // ─── 3. CONSULTAR STATUS (polling pelo frontend) ─────────────────────
    if (action === 'status' && req.method === 'GET') {
      const referenceId = sanitizeOrderId(req.query.referenceId);
      if (!referenceId) return res.status(400).json({ error: 'referenceId é obrigatório' });

      const merchantChargeId = deriveMerchantChargeId(referenceId);
      const token = await getAccessToken();
      const statusRes = await fetch(
        `${PICPAY_CHARGE_URL}/${merchantChargeId}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        },
      );

      if (!statusRes.ok) {
        return res.status(502).json({ error: 'Falha ao consultar status' });
      }
      const data = await statusRes.json();
      return res.status(200).json({
        status: data.chargeStatus,
        merchantChargeId,
        referenceId,
      });
    }

    return res.status(404).json({ error: 'Ação não encontrada' });
  } catch (err: any) {
    console.error('[PicPay API] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
