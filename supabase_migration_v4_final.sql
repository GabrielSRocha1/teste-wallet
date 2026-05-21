-- ============================================================
--  VERUM WALLET — Migration v4: Sincronização Final de Schema
--
--  Execute no SQL Editor do Supabase Dashboard.
--  100% IDEMPOTENTE — seguro re-executar quantas vezes quiser.
--
--  O que este script faz:
--    1. Colunas faltantes em deposit_orders
--    2. Tabela withdraw_orders (com RLS)
--    3. View transacoes (compatibilidade com frontend)
--    4. RPC get_user_balance
--    5. RPC get_all_balances
--    6. RPC process_ledger_operation (motor financeiro ACID)
-- ============================================================


-- ─── 0. Trigger helper (updated_at automático) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ─── 1. COLUNAS FALTANTES em deposit_orders ──────────────────────────────────

ALTER TABLE public.deposit_orders
  ADD COLUMN IF NOT EXISTS amount_sol     NUMERIC(20,9)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS amount_usdt    NUMERIC(20,6)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sol_price_brl  NUMERIC(20,4)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tx_signature   TEXT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'deposit_orders'
      AND column_name  = 'payment_method'
  ) THEN
    ALTER TABLE public.deposit_orders
      ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'PIX';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_deposit_orders_updated_at ON public.deposit_orders;
CREATE TRIGGER trg_deposit_orders_updated_at
  BEFORE UPDATE ON public.deposit_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 2. TABELA withdraw_orders ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.withdraw_orders (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  wallet_address   TEXT          NOT NULL,
  token_symbol     TEXT          NOT NULL DEFAULT 'USDT',
  amount_token     NUMERIC(20,6) NOT NULL CHECK (amount_token > 0),
  amount_brl       NUMERIC(20,2) DEFAULT NULL,
  amount_pyg       NUMERIC(20,0) DEFAULT NULL,
  currency_fiat    TEXT          NOT NULL DEFAULT 'BRL',
  pix_key          TEXT          DEFAULT NULL,
  bank_name        TEXT          DEFAULT NULL,
  swap_tx_hash     TEXT          DEFAULT NULL,
  transfer_receipt TEXT          DEFAULT NULL,
  status           TEXT          NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  fee_amount       NUMERIC(20,6) NOT NULL DEFAULT 0,
  error_message    TEXT          DEFAULT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdraw_orders_user_id ON public.withdraw_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_withdraw_orders_status  ON public.withdraw_orders(status);
CREATE INDEX IF NOT EXISTS idx_withdraw_orders_created ON public.withdraw_orders(created_at DESC);

DROP TRIGGER IF EXISTS trg_withdraw_orders_updated_at ON public.withdraw_orders;
CREATE TRIGGER trg_withdraw_orders_updated_at
  BEFORE UPDATE ON public.withdraw_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.withdraw_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdraw_orders_select_own"  ON public.withdraw_orders;
DROP POLICY IF EXISTS "withdraw_orders_insert_own"  ON public.withdraw_orders;
DROP POLICY IF EXISTS "withdraw_orders_update_svc"  ON public.withdraw_orders;

CREATE POLICY "withdraw_orders_select_own"
  ON public.withdraw_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "withdraw_orders_insert_own"
  ON public.withdraw_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "withdraw_orders_update_svc"
  ON public.withdraw_orders FOR UPDATE
  USING (auth.role() = 'service_role');


-- ─── 3. VIEW transacoes (compatibilidade com frontend legado) ─────────────────
-- O frontend usa .from('transacoes'); esta view projeta a tabela transactions
-- com os campos esperados pelo código legado.

CREATE OR REPLACE VIEW public.transacoes AS
SELECT
  t.id,
  t.user_id,
  t.user_id                                              AS remetente_id,
  CASE
    WHEN t.metadata IS NOT NULL
     AND (t.metadata->>'destinatario_id') IS NOT NULL
     AND (t.metadata->>'destinatario_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (t.metadata->>'destinatario_id')::UUID
    ELSE NULL
  END                                                    AS destinatario_id,
  t.type::TEXT                                           AS tipo,
  t.amount                                               AS valor,
  COALESCE(t.currency, 'USDT')                           AS moeda,
  COALESCE(t.blockchain_tx_hash, t.id::TEXT)             AS hash,
  t.status::TEXT                                         AS status,
  COALESCE(t.description, '')                            AS descricao,
  t.created_at
FROM public.transactions t;


-- ─── 4. RPC: get_user_balance ─────────────────────────────────────────────────
-- Retorna saldo de um token específico para o usuário.

CREATE OR REPLACE FUNCTION public.get_user_balance(
  p_user_id UUID,
  p_moeda   TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_balance NUMERIC := 0;
BEGIN
  SELECT CASE UPPER(p_moeda)
    WHEN 'USDT'  THEN usdt_balance
    WHEN 'USDC'  THEN usdc_balance
    WHEN 'BDC'   THEN bdc_balance
    WHEN 'ESCT'  THEN esct_balance
    WHEN 'BRT'   THEN brt_balance
    WHEN 'VERUM' THEN verum_balance
    WHEN 'BRL'   THEN brl_offchain
    ELSE 0
  END INTO v_balance
  FROM public.balances
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_balance(UUID, TEXT) TO authenticated, service_role;


-- ─── 5. RPC: get_all_balances ─────────────────────────────────────────────────
-- Retorna todos os saldos do usuário como tabela { moeda, saldo }.

CREATE OR REPLACE FUNCTION public.get_all_balances(p_user_id UUID)
RETURNS TABLE(moeda TEXT, saldo NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.balances%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.balances WHERE user_id = p_user_id;

  RETURN QUERY VALUES
    ('USDT'::TEXT,  COALESCE(r.usdt_balance,  0)),
    ('USDC'::TEXT,  COALESCE(r.usdc_balance,  0)),
    ('BDC'::TEXT,   COALESCE(r.bdc_balance,   0)),
    ('ESCT'::TEXT,  COALESCE(r.esct_balance,  0)),
    ('BRT'::TEXT,   COALESCE(r.brt_balance,   0)),
    ('VERUM'::TEXT, COALESCE(r.verum_balance,  0)),
    ('BRL'::TEXT,   COALESCE(r.brl_offchain,  0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO authenticated, service_role;


-- ─── 6. RPC: process_ledger_operation ────────────────────────────────────────
-- Motor financeiro ACID central. Garante idempotência, taxas e consistência.
-- Opera sobre a tabela `balances` (wide format por token).
--
-- Tipos suportados: deposit | withdraw | transfer | swap | investment

CREATE OR REPLACE FUNCTION public.process_ledger_operation(
  p_user_id             UUID,
  p_type                TEXT,
  p_amount              NUMERIC,
  p_currency            TEXT     DEFAULT 'USDT',
  p_idempotency_key     TEXT     DEFAULT NULL,
  p_destinatario_id     UUID     DEFAULT NULL,
  p_swap_dest_currency  TEXT     DEFAULT NULL,
  p_swap_dest_amount    NUMERIC  DEFAULT NULL,
  p_metadata            JSONB    DEFAULT '{}',
  p_description         TEXT     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id       UUID;
  v_src_balance NUMERIC;
  v_fee         NUMERIC := 0;
  v_total_debit NUMERIC;
BEGIN
  -- Idempotência: retorna o tx_id existente se a chave já foi processada
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id
    FROM public.transactions
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_tx_id; END IF;
  END IF;

  -- Validações antecipadas (antes de qualquer escrita)
  IF p_type = 'transfer' AND p_destinatario_id IS NULL THEN
    RAISE EXCEPTION 'transfer requer p_destinatario_id';
  END IF;
  IF p_type = 'swap' AND (p_swap_dest_currency IS NULL OR p_swap_dest_amount IS NULL OR p_swap_dest_amount <= 0) THEN
    RAISE EXCEPTION 'swap requer p_swap_dest_currency e p_swap_dest_amount > 0';
  END IF;

  -- Cálculo de taxas
  IF p_type = 'investment' THEN
    v_fee := p_amount * 0.02;
  ELSIF p_type IN ('transfer', 'withdraw', 'swap') THEN
    v_fee := p_amount * 0.002;
  END IF;
  v_total_debit := p_amount + v_fee;

  -- Lê e bloqueia o saldo atual (FOR UPDATE previne condição de corrida)
  SELECT CASE UPPER(p_currency)
    WHEN 'USDT'  THEN usdt_balance
    WHEN 'USDC'  THEN usdc_balance
    WHEN 'BDC'   THEN bdc_balance
    WHEN 'ESCT'  THEN esct_balance
    WHEN 'BRT'   THEN brt_balance
    WHEN 'VERUM' THEN verum_balance
    WHEN 'BRL'   THEN brl_offchain
    ELSE 0
  END INTO v_src_balance
  FROM public.balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Validação de saldo para operações de débito
  IF p_type IN ('withdraw', 'transfer', 'investment', 'swap') THEN
    IF COALESCE(v_src_balance, 0) < v_total_debit THEN
      RAISE EXCEPTION 'Saldo insuficiente em %: necessário %, disponível %',
        p_currency, v_total_debit, COALESCE(v_src_balance, 0);
    END IF;
  END IF;

  -- Registra a transação
  INSERT INTO public.transactions (
    user_id, idempotency_key, type, amount, currency,
    fee, description, status, metadata
  ) VALUES (
    p_user_id,
    p_idempotency_key,
    p_type,
    p_amount,
    UPPER(p_currency),
    v_fee,
    p_description,
    'completed',
    COALESCE(p_metadata, '{}') || jsonb_build_object(
      'dest_currency', p_swap_dest_currency,
      'dest_amount',   p_swap_dest_amount
    )
  )
  RETURNING id INTO v_tx_id;

  -- ── Movimentações de saldo ──────────────────────────────────────────────────

  IF p_type = 'deposit' THEN
    -- Upsert: cria ou soma saldo
    INSERT INTO public.balances (
      user_id, usdt_balance, usdc_balance, bdc_balance,
      esct_balance, brt_balance, verum_balance, brl_offchain
    ) VALUES (
      p_user_id,
      CASE WHEN UPPER(p_currency)='USDT'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='USDC'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BDC'   THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='ESCT'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BRT'   THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='VERUM' THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BRL'   THEN p_amount ELSE 0 END
    )
    ON CONFLICT (user_id) DO UPDATE SET
      usdt_balance  = balances.usdt_balance  + CASE WHEN UPPER(p_currency)='USDT'  THEN p_amount ELSE 0 END,
      usdc_balance  = balances.usdc_balance  + CASE WHEN UPPER(p_currency)='USDC'  THEN p_amount ELSE 0 END,
      bdc_balance   = balances.bdc_balance   + CASE WHEN UPPER(p_currency)='BDC'   THEN p_amount ELSE 0 END,
      esct_balance  = balances.esct_balance  + CASE WHEN UPPER(p_currency)='ESCT'  THEN p_amount ELSE 0 END,
      brt_balance   = balances.brt_balance   + CASE WHEN UPPER(p_currency)='BRT'   THEN p_amount ELSE 0 END,
      verum_balance = balances.verum_balance + CASE WHEN UPPER(p_currency)='VERUM' THEN p_amount ELSE 0 END,
      brl_offchain  = balances.brl_offchain  + CASE WHEN UPPER(p_currency)='BRL'   THEN p_amount ELSE 0 END,
      updated_at    = NOW();

  ELSIF p_type = 'swap' THEN
    -- Débita token origem
    UPDATE public.balances SET
      usdt_balance  = usdt_balance  - CASE WHEN UPPER(p_currency)='USDT'  THEN v_total_debit ELSE 0 END,
      usdc_balance  = usdc_balance  - CASE WHEN UPPER(p_currency)='USDC'  THEN v_total_debit ELSE 0 END,
      bdc_balance   = bdc_balance   - CASE WHEN UPPER(p_currency)='BDC'   THEN v_total_debit ELSE 0 END,
      esct_balance  = esct_balance  - CASE WHEN UPPER(p_currency)='ESCT'  THEN v_total_debit ELSE 0 END,
      brt_balance   = brt_balance   - CASE WHEN UPPER(p_currency)='BRT'   THEN v_total_debit ELSE 0 END,
      verum_balance = verum_balance - CASE WHEN UPPER(p_currency)='VERUM' THEN v_total_debit ELSE 0 END,
      brl_offchain  = brl_offchain  - CASE WHEN UPPER(p_currency)='BRL'   THEN v_total_debit ELSE 0 END,
      updated_at    = NOW()
    WHERE user_id = p_user_id;
    -- Credita token destino
    UPDATE public.balances SET
      usdt_balance  = usdt_balance  + CASE WHEN UPPER(p_swap_dest_currency)='USDT'  THEN p_swap_dest_amount ELSE 0 END,
      usdc_balance  = usdc_balance  + CASE WHEN UPPER(p_swap_dest_currency)='USDC'  THEN p_swap_dest_amount ELSE 0 END,
      bdc_balance   = bdc_balance   + CASE WHEN UPPER(p_swap_dest_currency)='BDC'   THEN p_swap_dest_amount ELSE 0 END,
      esct_balance  = esct_balance  + CASE WHEN UPPER(p_swap_dest_currency)='ESCT'  THEN p_swap_dest_amount ELSE 0 END,
      brt_balance   = brt_balance   + CASE WHEN UPPER(p_swap_dest_currency)='BRT'   THEN p_swap_dest_amount ELSE 0 END,
      verum_balance = verum_balance + CASE WHEN UPPER(p_swap_dest_currency)='VERUM' THEN p_swap_dest_amount ELSE 0 END,
      brl_offchain  = brl_offchain  + CASE WHEN UPPER(p_swap_dest_currency)='BRL'   THEN p_swap_dest_amount ELSE 0 END,
      updated_at    = NOW()
    WHERE user_id = p_user_id;

  ELSIF p_type IN ('withdraw', 'investment') THEN
    UPDATE public.balances SET
      usdt_balance  = usdt_balance  - CASE WHEN UPPER(p_currency)='USDT'  THEN v_total_debit ELSE 0 END,
      usdc_balance  = usdc_balance  - CASE WHEN UPPER(p_currency)='USDC'  THEN v_total_debit ELSE 0 END,
      bdc_balance   = bdc_balance   - CASE WHEN UPPER(p_currency)='BDC'   THEN v_total_debit ELSE 0 END,
      esct_balance  = esct_balance  - CASE WHEN UPPER(p_currency)='ESCT'  THEN v_total_debit ELSE 0 END,
      brt_balance   = brt_balance   - CASE WHEN UPPER(p_currency)='BRT'   THEN v_total_debit ELSE 0 END,
      verum_balance = verum_balance - CASE WHEN UPPER(p_currency)='VERUM' THEN v_total_debit ELSE 0 END,
      brl_offchain  = brl_offchain  - CASE WHEN UPPER(p_currency)='BRL'   THEN v_total_debit ELSE 0 END,
      updated_at    = NOW()
    WHERE user_id = p_user_id;

  ELSIF p_type = 'transfer' THEN
    -- Débita remetente
    UPDATE public.balances SET
      usdt_balance  = usdt_balance  - CASE WHEN UPPER(p_currency)='USDT'  THEN v_total_debit ELSE 0 END,
      usdc_balance  = usdc_balance  - CASE WHEN UPPER(p_currency)='USDC'  THEN v_total_debit ELSE 0 END,
      bdc_balance   = bdc_balance   - CASE WHEN UPPER(p_currency)='BDC'   THEN v_total_debit ELSE 0 END,
      esct_balance  = esct_balance  - CASE WHEN UPPER(p_currency)='ESCT'  THEN v_total_debit ELSE 0 END,
      brt_balance   = brt_balance   - CASE WHEN UPPER(p_currency)='BRT'   THEN v_total_debit ELSE 0 END,
      verum_balance = verum_balance - CASE WHEN UPPER(p_currency)='VERUM' THEN v_total_debit ELSE 0 END,
      brl_offchain  = brl_offchain  - CASE WHEN UPPER(p_currency)='BRL'   THEN v_total_debit ELSE 0 END,
      updated_at    = NOW()
    WHERE user_id = p_user_id;
    -- Credita destinatário (upsert para caso ele ainda não tenha linha em balances)
    INSERT INTO public.balances (
      user_id, usdt_balance, usdc_balance, bdc_balance,
      esct_balance, brt_balance, verum_balance, brl_offchain
    ) VALUES (
      p_destinatario_id,
      CASE WHEN UPPER(p_currency)='USDT'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='USDC'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BDC'   THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='ESCT'  THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BRT'   THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='VERUM' THEN p_amount ELSE 0 END,
      CASE WHEN UPPER(p_currency)='BRL'   THEN p_amount ELSE 0 END
    )
    ON CONFLICT (user_id) DO UPDATE SET
      usdt_balance  = balances.usdt_balance  + CASE WHEN UPPER(p_currency)='USDT'  THEN p_amount ELSE 0 END,
      usdc_balance  = balances.usdc_balance  + CASE WHEN UPPER(p_currency)='USDC'  THEN p_amount ELSE 0 END,
      bdc_balance   = balances.bdc_balance   + CASE WHEN UPPER(p_currency)='BDC'   THEN p_amount ELSE 0 END,
      esct_balance  = balances.esct_balance  + CASE WHEN UPPER(p_currency)='ESCT'  THEN p_amount ELSE 0 END,
      brt_balance   = balances.brt_balance   + CASE WHEN UPPER(p_currency)='BRT'   THEN p_amount ELSE 0 END,
      verum_balance = balances.verum_balance + CASE WHEN UPPER(p_currency)='VERUM' THEN p_amount ELSE 0 END,
      brl_offchain  = balances.brl_offchain  + CASE WHEN UPPER(p_currency)='BRL'   THEN p_amount ELSE 0 END,
      updated_at    = NOW();
  END IF;

  RETURN v_tx_id;
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_ledger_operation(
  UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT
) TO authenticated, service_role;


-- ─── Verificação Final ────────────────────────────────────────────────────────

SELECT
  'deposit_orders.amount_sol'     AS check_item,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='deposit_orders' AND column_name='amount_sol'
  ) THEN 'OK ✓' ELSE 'MISSING ✗' END AS result
UNION ALL SELECT
  'withdraw_orders table',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='withdraw_orders'
  ) THEN 'OK ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT
  'transacoes view',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='transacoes'
  ) THEN 'OK ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT
  'get_user_balance RPC',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_user_balance'
  ) THEN 'OK ✓' ELSE 'MISSING ✗' END
UNION ALL SELECT
  'process_ledger_operation RPC',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='process_ledger_operation'
  ) THEN 'OK ✓' ELSE 'MISSING ✗' END;
