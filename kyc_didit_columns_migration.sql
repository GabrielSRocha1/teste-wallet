-- ─────────────────────────────────────────────────────────────────────────────
--  Migração: adiciona campos Didit ao kyc_profiles
--  Execute no SQL Editor do painel Supabase.
--  Idempotente (IF NOT EXISTS) — seguro rodar múltiplas vezes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.kyc_profiles
  ADD COLUMN IF NOT EXISTS didit_session_id text,
  ADD COLUMN IF NOT EXISTS didit_decision   jsonb,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Tem que poder ser nulo nas novas colunas; só preenchidas depois do initiate.
-- Mantemos NOT NULL apenas nos campos pessoais já existentes.

-- Índice pra lookup rápido a partir do session_id (usado pelo webhook).
CREATE INDEX IF NOT EXISTS kyc_profiles_didit_session_id_idx
  ON public.kyc_profiles (didit_session_id)
  WHERE didit_session_id IS NOT NULL;

-- Permite 'expired' no enum de status além dos já existentes.
ALTER TABLE public.kyc_profiles
  DROP CONSTRAINT IF EXISTS kyc_profiles_status_check;
ALTER TABLE public.kyc_profiles
  ADD CONSTRAINT kyc_profiles_status_check
  CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'expired'));

-- ─── RLS pra webhook (service role bypass automático) ────────────────────────
-- Service role do Supabase já bypassa RLS por padrão. Não precisa policy nova
-- — basta usar SUPABASE_SERVICE_ROLE_KEY no backend só pro endpoint /kyc/webhook.
-- Não exponha essa key no frontend NUNCA.

-- ─── Coluna opcional pra simplificar campos obrigatórios (caso initiate
-- aconteça antes de o user preencher dados pessoais via tela KYC) ────────────
-- Esses campos hoje são NOT NULL — torna opcional pra criar a row no initiate
-- e o user completa os dados depois (Didit faz OCR e podemos popular via webhook).
ALTER TABLE public.kyc_profiles ALTER COLUMN nome             DROP NOT NULL;
ALTER TABLE public.kyc_profiles ALTER COLUMN sobrenome        DROP NOT NULL;
ALTER TABLE public.kyc_profiles ALTER COLUMN data_nascimento  DROP NOT NULL;
ALTER TABLE public.kyc_profiles ALTER COLUMN nacionalidade    DROP NOT NULL;
ALTER TABLE public.kyc_profiles ALTER COLUMN cpf              DROP NOT NULL;
