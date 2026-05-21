-- ─── MIGRATION: Wallet Keys Storage ──────────────────────────────────────────
-- Adiciona campos para armazenar chave pública/privada criptografada e hash de senha de transação
-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/plesrtbgbvanbydrithz/sql

-- 1. Adiciona campos na tabela wallets
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS public_key TEXT,
  ADD COLUMN IF NOT EXISTS private_key_encrypted TEXT,  -- chave privada criptografada com a senha do usuário
  ADD COLUMN IF NOT EXISTS transaction_password_hash TEXT, -- bcrypt hash da senha usada para transações
  ADD COLUMN IF NOT EXISTS mnemonic_encrypted TEXT,        -- frase semente criptografada (opcional - para backup)
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Adiciona saldo_usdc na tabela usuarios se não existir
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS saldo_usdc NUMERIC(20, 8) DEFAULT 0;

-- 3. Índices para buscas rápidas por chave pública
CREATE INDEX IF NOT EXISTS idx_wallets_public_key ON public.wallets(public_key);
CREATE INDEX IF NOT EXISTS idx_wallets_user_blockchain ON public.wallets(user_id, blockchain);

-- 4. RLS: permite que o usuário leia sua própria wallet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'wallets' 
    AND policyname = 'Users can view own wallets'
  ) THEN
    CREATE POLICY "Users can view own wallets" ON public.wallets
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- 5. RLS: permite que o usuário insira sua própria wallet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'wallets' 
    AND policyname = 'Users can insert own wallets'
  ) THEN
    CREATE POLICY "Users can insert own wallets" ON public.wallets
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 6. RLS: permite que o usuário atualize sua própria wallet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'wallets' 
    AND policyname = 'Users can update own wallets'
  ) THEN
    CREATE POLICY "Users can update own wallets" ON public.wallets
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- 7. RLS na tabela wallets (se não habilitada ainda)
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- 8. Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON public.wallets;
CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Após rodar, verifique:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'wallets';
