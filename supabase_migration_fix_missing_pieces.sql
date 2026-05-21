-- ============================================================
--  VERUM WALLET — Migration Fix: Missing Schema Pieces
--  Execute este script no Supabase SQL Editor (dashboard)
--  É totalmente IDEMPOTENTE: seguro de re-executar.
-- ============================================================


-- ────────────────────────────────────────────────────────────
--  1. COLUNAS FALTANTES em deposit_orders
-- ────────────────────────────────────────────────────────────
--  O database.types.ts atual foi gerado com a versão Celcoin
--  mas não tem as colunas da integração v3 (amount_sol, etc.)

ALTER TABLE public.deposit_orders
  ADD COLUMN IF NOT EXISTS amount_sol      NUMERIC(20, 9)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amount_usdt     NUMERIC(20, 6)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sol_price_brl   NUMERIC(20, 4)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_method  TEXT            NOT NULL DEFAULT 'PIX',
  ADD COLUMN IF NOT EXISTS tx_signature    TEXT            DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW();

-- Trigger para atualizar updated_at automaticamente
DROP TRIGGER IF EXISTS set_updated_at_deposit_orders ON public.deposit_orders;
CREATE TRIGGER set_updated_at_deposit_orders
  BEFORE UPDATE ON public.deposit_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ────────────────────────────────────────────────────────────
--  2. TABELA withdraw_orders (criação completa se não existir)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.withdraw_orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  wallet_address   TEXT        NOT NULL,
  token_symbol     TEXT        NOT NULL DEFAULT 'USDT',
  amount_token     NUMERIC(20, 6) NOT NULL CHECK (amount_token > 0),
  amount_brl       NUMERIC(20, 2) DEFAULT NULL,
  amount_pyg       NUMERIC(20, 0) DEFAULT NULL,
  currency_fiat    TEXT        NOT NULL DEFAULT 'BRL',
  pix_key          TEXT        DEFAULT NULL,
  bank_name        TEXT        DEFAULT NULL,
  swap_tx_hash     TEXT        DEFAULT NULL,
  transfer_receipt TEXT        DEFAULT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  fee_amount       NUMERIC(20, 6) NOT NULL DEFAULT 0,
  error_message    TEXT        DEFAULT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_withdraw_orders_user_id   ON public.withdraw_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_withdraw_orders_status    ON public.withdraw_orders(status);
CREATE INDEX IF NOT EXISTS idx_withdraw_orders_created   ON public.withdraw_orders(created_at DESC);

-- Trigger updated_at
DROP TRIGGER IF EXISTS set_updated_at_withdraw_orders ON public.withdraw_orders;
CREATE TRIGGER set_updated_at_withdraw_orders
  BEFORE UPDATE ON public.withdraw_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- RLS
ALTER TABLE public.withdraw_orders ENABLE ROW LEVEL SECURITY;

-- Usuário só vê seus próprios saques
DROP POLICY IF EXISTS "Users can view own withdraw_orders" ON public.withdraw_orders;
CREATE POLICY "Users can view own withdraw_orders"
  ON public.withdraw_orders FOR SELECT
  USING (auth.uid() = user_id);

-- Usuário pode criar solicitação de saque
DROP POLICY IF EXISTS "Users can insert own withdraw_orders" ON public.withdraw_orders;
CREATE POLICY "Users can insert own withdraw_orders"
  ON public.withdraw_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Apenas service_role pode atualizar (processamento backend)
DROP POLICY IF EXISTS "Service role can update withdraw_orders" ON public.withdraw_orders;
CREATE POLICY "Service role can update withdraw_orders"
  ON public.withdraw_orders FOR UPDATE
  USING (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
--  3. FUNÇÃO RPC: get_user_balance
--     Retorna saldo de uma moeda específica para o usuário.
--     Lê da tabela `balances` (cache de saldo).
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_balance(
  p_user_id  UUID,
  p_moeda    TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC := 0;
BEGIN
  SELECT
    CASE UPPER(p_moeda)
      WHEN 'USDT'  THEN usdt_balance
      WHEN 'USDC'  THEN usdc_balance
      WHEN 'BDC'   THEN bdc_balance
      WHEN 'ESCT'  THEN esct_balance
      WHEN 'BRT'   THEN brt_balance
      WHEN 'VERUM' THEN verum_balance
      WHEN 'BRL'   THEN brl_offchain
      ELSE 0
    END
  INTO v_balance
  FROM public.balances
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION public.get_user_balance(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_balance(UUID, TEXT) TO service_role;


-- ────────────────────────────────────────────────────────────
--  4. FUNÇÃO RPC: get_all_balances
--     Retorna todos os saldos do usuário como tabela
--     { moeda TEXT, saldo NUMERIC }
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_all_balances(
  p_user_id UUID
)
RETURNS TABLE(moeda TEXT, saldo NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.balances%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.balances WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    -- Retorna zeros se o usuário ainda não tem registro de saldo
    RETURN QUERY VALUES
      ('USDT'::TEXT,  0::NUMERIC),
      ('USDC'::TEXT,  0::NUMERIC),
      ('BDC'::TEXT,   0::NUMERIC),
      ('ESCT'::TEXT,  0::NUMERIC),
      ('BRT'::TEXT,   0::NUMERIC),
      ('VERUM'::TEXT, 0::NUMERIC),
      ('BRL'::TEXT,   0::NUMERIC);
    RETURN;
  END IF;

  RETURN QUERY VALUES
    ('USDT'::TEXT,  COALESCE(v_row.usdt_balance,  0)),
    ('USDC'::TEXT,  COALESCE(v_row.usdc_balance,  0)),
    ('BDC'::TEXT,   COALESCE(v_row.bdc_balance,   0)),
    ('ESCT'::TEXT,  COALESCE(v_row.esct_balance,  0)),
    ('BRT'::TEXT,   COALESCE(v_row.brt_balance,   0)),
    ('VERUM'::TEXT, COALESCE(v_row.verum_balance,  0)),
    ('BRL'::TEXT,   COALESCE(v_row.brl_offchain,  0));
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO service_role;


-- ────────────────────────────────────────────────────────────
--  5. VERIFICAÇÃO FINAL — mostra o que foi criado
-- ────────────────────────────────────────────────────────────

SELECT
  'deposit_orders columns' AS check_name,
  string_agg(column_name, ', ' ORDER BY ordinal_position) AS result
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'deposit_orders'
  AND column_name IN ('amount_sol','amount_usdt','sol_price_brl','payment_method','tx_signature','updated_at')

UNION ALL

SELECT
  'withdraw_orders exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'withdraw_orders'
  ) THEN 'YES ✓' ELSE 'NO ✗' END

UNION ALL

SELECT
  'get_user_balance RPC',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_balance'
  ) THEN 'YES ✓' ELSE 'NO ✗' END

UNION ALL

SELECT
  'get_all_balances RPC',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_all_balances'
  ) THEN 'YES ✓' ELSE 'NO ✗' END;
