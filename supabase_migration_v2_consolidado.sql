-- ============================================================
-- MIGRAÇÃO V2 CONSOLIDADA — Verum Wallet Freeport
-- Alinha Supabase com schema Prisma atualizado
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ─── 1. Novas tabelas ──────────────────────────────────────────────────────

-- 1.1 Vesting Contracts (alinha com Prisma model VestingContract)
CREATE TABLE IF NOT EXISTS public.vesting_contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token                 TEXT NOT NULL,                           -- BDC | ESCT | BRT
  investment_amount_brl NUMERIC(19, 2) NOT NULL,
  token_quantity        BIGINT NOT NULL,                         -- Precisão on-chain (lamports/mínima)
  price_at_investment   NUMERIC(19, 8) NOT NULL,
  wallet_address        TEXT NOT NULL,
  contract_type         TEXT DEFAULT 'Vesting',

  -- Período
  start_date            TIMESTAMPTZ NOT NULL,
  duration_months       INTEGER DEFAULT 60,
  end_date              TIMESTAMPTZ NOT NULL,
  unlock_start_date     TIMESTAMPTZ NOT NULL,

  -- Estado
  status                TEXT DEFAULT 'active',                   -- active | completed | cancelled
  total_released        BIGINT DEFAULT 0,
  last_release_at       TIMESTAMPTZ,

  -- On-chain
  on_chain_tx_hash      TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- 1.2 Vesting Releases
CREATE TABLE IF NOT EXISTS public.vesting_releases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      UUID NOT NULL REFERENCES public.vesting_contracts(id) ON DELETE CASCADE,
  release_number   INTEGER NOT NULL,
  amount_released  BIGINT NOT NULL,
  release_date     TIMESTAMPTZ NOT NULL,
  on_chain_tx_hash TEXT,
  status           TEXT DEFAULT 'pending',                       -- pending | confirmed | failed
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_id, release_number)
);

-- 1.3 Swap Orders (auditoria de swaps Jupiter)
CREATE TABLE IF NOT EXISTS public.swap_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id),
  wallet_address   TEXT NOT NULL,
  input_token      TEXT NOT NULL,
  output_token     TEXT NOT NULL,
  input_amount     BIGINT NOT NULL,
  output_amount    BIGINT,
  expected_output  BIGINT NOT NULL,
  slippage_bps     INTEGER DEFAULT 50,
  price_impact_pct NUMERIC(8, 4),
  route_plan       JSONB,
  quote_id         TEXT,
  on_chain_tx_hash TEXT UNIQUE,
  status           TEXT DEFAULT 'pending',                       -- pending | submitted | confirmed | failed
  fee_amount       BIGINT DEFAULT 0,
  fee_token        TEXT DEFAULT 'SOL',
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  confirmed_at     TIMESTAMPTZ
);

-- 1.4 Notifications (persistência in-app)
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                                      -- TRANSACTION | VESTING_RELEASE | KYC_UPDATE | etc
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1.5 KYC Checks (histórico de verificações Sumsub)
CREATE TABLE IF NOT EXISTS public.kyc_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT DEFAULT 'sumsub',
  applicant_id        TEXT NOT NULL,
  review_status       TEXT NOT NULL,                             -- pending | completed | rejected | onHold
  review_result       JSONB,
  moderation_comment  TEXT,
  country             TEXT NOT NULL,
  doc_type            TEXT,
  webhook_payload     JSONB,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. Alterações em tabelas existentes ───────────────────────────────────

-- 2.1 WebhookLog: adicionar idempotency_key para dedup
ALTER TABLE public.webhook_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- 2.2 Balances: adicionar campos de auditoria
ALTER TABLE public.balances
  ADD COLUMN IF NOT EXISTS sync_source TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_system BOOLEAN DEFAULT false;

-- 2.3 Transactions: adicionar description e usd_value_at_time
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS usd_value_at_time NUMERIC(19, 8);

-- 2.4 Transactions: tornar wallet_address opcional
ALTER TABLE public.transactions
  ALTER COLUMN wallet_address DROP NOT NULL;

-- 2.5 DepositOrders: tornar wallet_address opcional
ALTER TABLE public.deposit_orders
  ALTER COLUMN wallet_address DROP NOT NULL;

-- ─── 3. Índices de performance ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vesting_contracts_user_status
  ON public.vesting_contracts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vesting_contracts_token
  ON public.vesting_contracts(token);
CREATE INDEX IF NOT EXISTS idx_vesting_contracts_unlock
  ON public.vesting_contracts(status, unlock_start_date);
CREATE INDEX IF NOT EXISTS idx_vesting_releases_contract
  ON public.vesting_releases(contract_id);
CREATE INDEX IF NOT EXISTS idx_vesting_releases_status_date
  ON public.vesting_releases(status, release_date);

CREATE INDEX IF NOT EXISTS idx_swap_orders_user_status
  ON public.swap_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_swap_orders_tx_hash
  ON public.swap_orders(on_chain_tx_hash);
CREATE INDEX IF NOT EXISTS idx_swap_orders_status_created
  ON public.swap_orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_checks_user
  ON public.kyc_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_applicant
  ON public.kyc_checks(applicant_id);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_status
  ON public.kyc_checks(review_status);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_idempotency
  ON public.webhook_logs(idempotency_key);

-- ─── 4. Row Level Security ─────────────────────────────────────────────────

ALTER TABLE public.vesting_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vesting_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_checks ENABLE ROW LEVEL SECURITY;

-- Vesting: usuário vê seus próprios contratos
CREATE POLICY "Users view own vesting contracts"
  ON public.vesting_contracts FOR SELECT
  USING (user_id = auth.uid());

-- Vesting releases: visível via contrato do usuário
CREATE POLICY "Users view own vesting releases"
  ON public.vesting_releases FOR SELECT
  USING (
    contract_id IN (
      SELECT id FROM public.vesting_contracts WHERE user_id = auth.uid()
    )
  );

-- Swap orders: usuário vê seus próprios swaps
CREATE POLICY "Users view own swap orders"
  ON public.swap_orders FOR SELECT
  USING (user_id = auth.uid());

-- Notifications: usuário vê e atualiza suas notificações
CREATE POLICY "Users view own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());

-- KYC checks: usuário vê seu próprio histórico
CREATE POLICY "Users view own kyc checks"
  ON public.kyc_checks FOR SELECT
  USING (user_id = auth.uid());

-- Service role pode inserir/atualizar tudo (para o backend NestJS)
CREATE POLICY "Service role manages vesting contracts"
  ON public.vesting_contracts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role manages vesting releases"
  ON public.vesting_releases FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role manages swap orders"
  ON public.swap_orders FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role manages notifications"
  ON public.notifications FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role manages kyc checks"
  ON public.kyc_checks FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 5. Trigger updated_at automático para novas tabelas ───────────────────

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vesting_contracts_updated_at ON public.vesting_contracts;
CREATE TRIGGER trg_vesting_contracts_updated_at
  BEFORE UPDATE ON public.vesting_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_kyc_checks_updated_at ON public.kyc_checks;
CREATE TRIGGER trg_kyc_checks_updated_at
  BEFORE UPDATE ON public.kyc_checks
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- ─── 6. Corrigir process_ledger_operation: suportar deposito de BDC/ESCT/BRT
-- (A função legada só creditava USDT e SOL em deposits)
CREATE OR REPLACE FUNCTION public.process_ledger_operation(
    p_user_id UUID,
    p_type public.transaction_type,
    p_amount NUMERIC,
    p_currency TEXT DEFAULT 'USDT',
    p_idempotency_key TEXT DEFAULT NULL,
    p_destinatario_id UUID DEFAULT NULL,
    p_swap_dest_currency TEXT DEFAULT NULL,
    p_swap_dest_amount NUMERIC DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_tx_id UUID;
    v_current_balance NUMERIC;
    v_dest_token_balance NUMERIC;
    v_calculated_fee NUMERIC := 0;
    v_fee_type public.fee_type := 'transaction';
    v_total_debit NUMERIC;
    v_treasury_wallet CONSTANT TEXT := 'Da51JLCnUfN3L3RDNeYkn7kxr7C3otnLaLvbsjmTTzE8';
BEGIN
    -- 1. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_tx_id FROM public.transactions WHERE idempotency_key = p_idempotency_key;
        IF v_tx_id IS NOT NULL THEN RETURN v_tx_id; END IF;
    END IF;

    -- 2. Internal Fee Calculation
    IF p_type = 'investment' THEN v_calculated_fee := 1.50; v_fee_type := 'investment';
    ELSIF p_type IN ('transfer', 'withdraw', 'swap') THEN v_calculated_fee := 0.20; v_fee_type := 'transaction';
    END IF;

    v_total_debit := p_amount + (CASE WHEN p_currency = 'USDT' THEN v_calculated_fee ELSE 0 END);

    -- 3. Lock & Get Balance based on p_currency
    SELECT
        CASE
            WHEN p_currency = 'USDT' THEN saldo_usdt
            WHEN p_currency = 'SOL' THEN saldo_sol
            WHEN p_currency = 'BDC' THEN saldo_bdc
            WHEN p_currency = 'ESCT' THEN saldo_esct
            WHEN p_currency = 'BRT' THEN saldo_brt
            WHEN p_currency = 'BTC' THEN saldo_btc
            WHEN p_currency = 'ETH' THEN saldo_eth
            ELSE 0
        END INTO v_current_balance
    FROM public.usuarios WHERE id = p_user_id FOR UPDATE;

    -- 4. Validate
    IF p_type IN ('withdraw', 'transfer', 'investment', 'swap') AND v_current_balance < v_total_debit THEN
        RAISE EXCEPTION 'Insufficient % balance: Required %, Available % (Fee: %)', p_currency, v_total_debit, v_current_balance, v_calculated_fee;
    END IF;

    -- 5. Atomic Entry
    INSERT INTO public.transactions (user_id, idempotency_key, type, amount, currency, fee_usd, fee_type, treasury_wallet, status, metadata)
    VALUES (p_user_id, p_idempotency_key, p_type, p_amount, p_currency, v_calculated_fee, v_fee_type, v_treasury_wallet, 'completed', p_metadata || jsonb_build_object('dest_currency', p_swap_dest_currency, 'dest_amount', p_swap_dest_amount))
    RETURNING id INTO v_tx_id;

    -- 6. Execute Movements — CORRIGIDO: deposit agora suporta TODOS os tokens
    IF p_type = 'deposit' THEN
        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt + p_amount ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_currency = 'SOL'  THEN saldo_sol  + p_amount ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_currency = 'BDC'  THEN saldo_bdc  + p_amount ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct + p_amount ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_currency = 'BRT'  THEN saldo_brt  + p_amount ELSE saldo_brt  END,
            saldo_btc  = CASE WHEN p_currency = 'BTC'  THEN saldo_btc  + p_amount ELSE saldo_btc  END,
            saldo_eth  = CASE WHEN p_currency = 'ETH'  THEN saldo_eth  + p_amount ELSE saldo_eth  END
            WHERE id = p_user_id;
        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'credit', p_currency, p_amount, v_current_balance + p_amount);

    ELSIF p_type = 'swap' AND p_swap_dest_currency IS NOT NULL THEN
        -- DEBIT SOURCE (Amount + Fee)
        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_currency = 'SOL'  THEN saldo_sol  - v_total_debit ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_currency = 'BDC'  THEN saldo_bdc  - v_total_debit ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_currency = 'BRT'  THEN saldo_brt  - v_total_debit ELSE saldo_brt  END
            WHERE id = p_user_id;

        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);

        -- CREDIT DESTINATION
        SELECT
            CASE
                WHEN p_swap_dest_currency = 'USDT' THEN saldo_usdt
                WHEN p_swap_dest_currency = 'SOL' THEN saldo_sol
                WHEN p_swap_dest_currency = 'BDC' THEN saldo_bdc
                WHEN p_swap_dest_currency = 'ESCT' THEN saldo_esct
                WHEN p_swap_dest_currency = 'BRT' THEN saldo_brt
            END INTO v_dest_token_balance
        FROM public.usuarios WHERE id = p_user_id FOR UPDATE;

        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_swap_dest_currency = 'USDT' THEN saldo_usdt + p_swap_dest_amount ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_swap_dest_currency = 'SOL'  THEN saldo_sol  + p_swap_dest_amount ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_swap_dest_currency = 'BDC'  THEN saldo_bdc  + p_swap_dest_amount ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_swap_dest_currency = 'ESCT' THEN saldo_esct + p_swap_dest_amount ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_swap_dest_currency = 'BRT'  THEN saldo_brt  + p_swap_dest_amount ELSE saldo_brt  END
            WHERE id = p_user_id;

        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'credit', p_swap_dest_currency, p_swap_dest_amount, v_dest_token_balance + p_swap_dest_amount);

    ELSIF p_type = 'transfer' AND p_destinatario_id IS NOT NULL THEN
        -- Debit Sender
        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_currency = 'SOL'  THEN saldo_sol  - v_total_debit ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_currency = 'BDC'  THEN saldo_bdc  - v_total_debit ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_currency = 'BRT'  THEN saldo_brt  - v_total_debit ELSE saldo_brt  END,
            saldo_btc  = CASE WHEN p_currency = 'BTC'  THEN saldo_btc  - v_total_debit ELSE saldo_btc  END,
            saldo_eth  = CASE WHEN p_currency = 'ETH'  THEN saldo_eth  - v_total_debit ELSE saldo_eth  END
            WHERE id = p_user_id;
        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);

        -- Credit Receiver
        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt + p_amount ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_currency = 'SOL'  THEN saldo_sol  + p_amount ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_currency = 'BDC'  THEN saldo_bdc  + p_amount ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct + p_amount ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_currency = 'BRT'  THEN saldo_brt  + p_amount ELSE saldo_brt  END,
            saldo_btc  = CASE WHEN p_currency = 'BTC'  THEN saldo_btc  + p_amount ELSE saldo_btc  END,
            saldo_eth  = CASE WHEN p_currency = 'ETH'  THEN saldo_eth  + p_amount ELSE saldo_eth  END
            WHERE id = p_destinatario_id;

    ELSIF p_type IN ('withdraw', 'investment') THEN
        UPDATE public.usuarios SET
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol  = CASE WHEN p_currency = 'SOL'  THEN saldo_sol  - v_total_debit ELSE saldo_sol  END,
            saldo_bdc  = CASE WHEN p_currency = 'BDC'  THEN saldo_bdc  - v_total_debit ELSE saldo_bdc  END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt  = CASE WHEN p_currency = 'BRT'  THEN saldo_brt  - v_total_debit ELSE saldo_brt  END,
            saldo_btc  = CASE WHEN p_currency = 'BTC'  THEN saldo_btc  - v_total_debit ELSE saldo_btc  END,
            saldo_eth  = CASE WHEN p_currency = 'ETH'  THEN saldo_eth  - v_total_debit ELSE saldo_eth  END
            WHERE id = p_user_id;
        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);
    END IF;

    -- 7. Treasury Fee Collection
    IF v_calculated_fee > 0 THEN
        UPDATE public.treasury_account SET balance = balance + v_calculated_fee, updated_at = now() WHERE id = 1;
    END IF;

    RETURN v_tx_id;
EXCEPTION WHEN OTHERS THEN RAISE; END;
$$ LANGUAGE plpgsql;

-- ─── 7. Corrigir VIEW transacoes (cast seguro) ────────────────────────────

CREATE OR REPLACE VIEW public.transacoes AS
SELECT
    id,
    user_id as remetente_id,
    CASE
      WHEN metadata IS NOT NULL AND metadata->>'destinatario_id' IS NOT NULL
           AND metadata->>'destinatario_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (metadata->>'destinatario_id')::UUID
      ELSE NULL
    END as destinatario_id,
    type::TEXT as tipo,
    amount as valor,
    COALESCE(currency, 'USDT') as moeda,
    id::TEXT as hash,
    status::TEXT as status,
    COALESCE(description, '') as descricao,
    created_at
FROM public.transactions;
