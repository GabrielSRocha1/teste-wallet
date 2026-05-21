-- ============================================================
--  VERUM WALLET — Fix: Sincronização e Políticas RLS
--  Execute no SQL Editor do painel Supabase.
-- ============================================================

-- 1. Garante que a tabela usuarios permite INSERT para usuários autenticados
-- (Necessário para o upsert inicial funcionar)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'usuarios' AND policyname = 'usuarios_insert_own'
    ) THEN
        CREATE POLICY "usuarios_insert_own" ON public.usuarios
            FOR INSERT WITH CHECK (auth.uid() = id);
    END IF;
END $$;

-- 2. Trigger para criar o perfil automaticamente no momento do SignUp
-- Isso garante que a linha na tabela public.usuarios exista antes de qualquer tentativa de update
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nome_completo)
  VALUES (
    NEW.id, 
    NEW.email, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Novo Investidor')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove o trigger se já existir para evitar duplicidade
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Cria o trigger vinculado à tabela auth.users do Supabase
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Garante que a tabela wallets tenha as colunas necessárias e restrições
ALTER TABLE public.wallets 
  ADD COLUMN IF NOT EXISTS public_key TEXT,
  ADD COLUMN IF NOT EXISTS private_key_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS transaction_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS mnemonic_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS saldo_sol NUMERIC(20, 8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_usdt NUMERIC(20, 8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_usdc NUMERIC(20, 8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_bdc NUMERIC(20, 8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_esct NUMERIC(20, 8) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_brt NUMERIC(20, 8) DEFAULT 0;

-- Garante que public_key seja único para permitir o upsert por conflito de chave
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallets_public_key_key'
    ) THEN
        ALTER TABLE public.wallets ADD CONSTRAINT wallets_public_key_key UNIQUE (public_key);
    END IF;
END $$;

-- 4. Garante políticas de INSERT/UPDATE na tabela wallets
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'wallets' AND policyname = 'wallets_insert_own'
    ) THEN
        CREATE POLICY "wallets_insert_own" ON public.wallets
            FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'wallets' AND policyname = 'wallets_update_own'
    ) THEN
        CREATE POLICY "wallets_update_own" ON public.wallets
            FOR UPDATE USING (auth.uid() = user_id);
    END IF;
END $$;

-- 5. Habilita RLS em ambas (caso não esteja)
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- ─── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- Rodar este comando para ver se as políticas estão ativas:
-- SELECT * FROM pg_policies WHERE tablename IN ('usuarios', 'wallets');
