-- ─────────────────────────────────────────────────────────
--  Migração: criação da tabela kyc_profiles (simplificada)
--  Execute no SQL Editor do painel Supabase
-- ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kyc_profiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Dados pessoais
  nome            TEXT NOT NULL,
  sobrenome       TEXT NOT NULL,
  data_nascimento TEXT NOT NULL,
  nacionalidade   TEXT NOT NULL,
  cpf             TEXT NOT NULL,

  -- Status de verificação
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Auditoria
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice único: cada usuário pode ter apenas um perfil KYC
CREATE UNIQUE INDEX IF NOT EXISTS kyc_profiles_user_id_key
  ON public.kyc_profiles (user_id);

-- ── Row-Level Security ────────────────────────────────────
ALTER TABLE public.kyc_profiles ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler apenas o próprio KYC
CREATE POLICY "kyc_select_own" ON public.kyc_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Usuário pode inserir apenas o próprio KYC
CREATE POLICY "kyc_insert_own" ON public.kyc_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Usuário pode atualizar apenas o próprio KYC
CREATE POLICY "kyc_update_own" ON public.kyc_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- ── Trigger: updated_at automático ───────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_profiles_updated_at ON public.kyc_profiles;
CREATE TRIGGER kyc_profiles_updated_at
  BEFORE UPDATE ON public.kyc_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
