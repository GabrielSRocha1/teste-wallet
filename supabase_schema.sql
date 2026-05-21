-- SQL Script for Supabase - User Profiles and Vesting Contracts

-- 1. Create User Profiles Table
-- Stores user data as requested: email, hashed password, pix key, full name, bank.
-- Note: If using Supabase Auth (best practice), 'password' is encrypted and stored in auth.users automatically.
-- However, we provide it here as requested.
CREATE TABLE IF NOT EXISTS public.usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  senha_criptografada TEXT NOT NULL,
  nome_completo TEXT NOT NULL,
  chave_pix TEXT,
  banco TEXT,
  wallet_address TEXT UNIQUE, -- Endereço da carteira Solana/EVM vinculada
  saldo_usdt NUMERIC(20, 8) DEFAULT 0, -- Cache do saldo USDT
  saldo_sol NUMERIC(20, 8) DEFAULT 0, -- Cache do saldo Solana
  saldo_bdc NUMERIC(20, 8) DEFAULT 0, -- Cache do saldo BodeCoin
  saldo_esct NUMERIC(20, 8) DEFAULT 0, -- Cache do saldo Escoteiros
  saldo_brt NUMERIC(20, 8) DEFAULT 0, -- Cache do saldo Brutos
  saldo_btc NUMERIC(20, 8) DEFAULT 0,
  saldo_eth NUMERIC(20, 8) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Vesting Contracts Table
-- Stores contract data from 'contratar-vesting.tsx'
CREATE TABLE IF NOT EXISTS public.contratos_vesting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  moeda TEXT NOT NULL, -- BDC, ESCT, BRT
  valor_investimento NUMERIC(20, 2) NOT NULL,
  quantidade_tokens NUMERIC(20, 8) NOT NULL,
  preco_at_investment NUMERIC(20, 8) NOT NULL,
  public_key TEXT NOT NULL, -- Wallet Address (GvT9...xY7z)
  tipo_contrato TEXT DEFAULT 'Vesting',
  data_inicio TIMESTAMPTZ NOT NULL,
  duracao_meses INTEGER DEFAULT 60,
  data_fim TIMESTAMPTZ NOT NULL,
  inicio_desbloqueio DATE NOT NULL,
  status TEXT DEFAULT 'Ativo', -- Ativo, Finalizado, Cancelado
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) for Supabase security
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos_vesting ENABLE ROW LEVEL SECURITY;

-- Basic Policies (assuming Auth integration)
-- Users can view their own profile
CREATE POLICY "Users can view their own profile" ON public.usuarios
  FOR SELECT USING (auth.uid() = id);

-- Users can view their own contracts
CREATE POLICY "Users can view their own contracts" ON public.contratos_vesting
  FOR SELECT USING (usuario_id = auth.uid());

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_contratos_usuario ON public.contratos_vesting(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios(email);
-- 3. Financial Ledger System (Professional Backend Architecture)
-- Ensure ACID compliance, auditability and preventing race conditions

-- Types for Ledger Consistency
DO $$ BEGIN
    CREATE TYPE public.transaction_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.transaction_type AS ENUM ('deposit', 'withdraw', 'transfer', 'swap', 'investment');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.entry_type AS ENUM ('debit', 'credit');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.blockchain_status AS ENUM ('pending', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE public.fee_type AS ENUM ('transaction', 'investment');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3.1 Transactions Table: The intent of the operation
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE, -- CRITICAL: Prevents double-processing
  user_id UUID REFERENCES public.usuarios(id) NOT NULL,
  type public.transaction_type NOT NULL,
  amount NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
  fee_usd NUMERIC(20, 8) DEFAULT 0,
  fee_sol NUMERIC(20, 8), -- Prepared for Solana fees
  fee_type public.fee_type DEFAULT 'transaction',
  treasury_wallet TEXT,
  blockchain_tx_hash TEXT, -- Storing Solana/EVM Transaction Signatures
  blockchain_status public.blockchain_status, -- Cross-reference with on-chain state
  status public.transaction_status DEFAULT 'pending',
  currency TEXT NOT NULL DEFAULT 'USDT', -- Base currency of the transaction
  metadata JSONB,
  reference_id UUID, -- For linking related transactions (like both sides of a transfer)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.2 Ledger Entries: The immutable history of all value movements
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.usuarios(id) NOT NULL,
  transaction_id UUID REFERENCES public.transactions(id) NOT NULL,
  entry_type public.entry_type NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT', 
  amount NUMERIC(20, 8) NOT NULL,
  balance_after NUMERIC(20, 8) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3.3 Treasury Account: Fixed platform account for fees/liquidity
CREATE TABLE IF NOT EXISTS public.treasury_account (
  id INT PRIMARY KEY DEFAULT 1,
  balance NUMERIC(20, 8) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Initialize Treasury
INSERT INTO public.treasury_account (id, balance) 
VALUES (1, 0) 
ON CONFLICT (id) DO NOTHING;

-- 4. Compatibility View: Supporting legacy frontend queries to 'transacoes'
CREATE OR REPLACE VIEW public.transacoes AS
SELECT 
    id,
    user_id as remetente_id,
    (metadata->>'destinatario_id')::UUID as destinatario_id,
    type::TEXT as tipo,
    amount as valor,
    'USDT' as moeda, -- Placeholder for currency consistency
    id::TEXT as hash,
    status::TEXT as status,
    '' as descricao,
    created_at
FROM public.transactions;

-- 5. Atomic Financial Engine (MULTI-CURRENCY & SWAPS)
CREATE OR REPLACE FUNCTION public.process_ledger_operation(
    p_user_id UUID,
    p_type public.transaction_type,
    p_amount NUMERIC,
    p_currency TEXT DEFAULT 'USDT', -- Base currency for the operation
    p_idempotency_key TEXT DEFAULT NULL,
    p_destinatario_id UUID DEFAULT NULL, -- For transfers
    p_swap_dest_currency TEXT DEFAULT NULL, -- For swaps
    p_swap_dest_amount NUMERIC DEFAULT NULL, -- For swaps
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

    -- 6. Execute Movements
    IF p_type = 'deposit' THEN
        -- CREDIT
        UPDATE public.usuarios SET 
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt + p_amount ELSE saldo_usdt END,
            saldo_sol = CASE WHEN p_currency = 'SOL' THEN saldo_sol + p_amount ELSE saldo_sol END
            WHERE id = p_user_id;
        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'credit', p_currency, p_amount, v_current_balance + p_amount);
    
    ELSIF p_type = 'swap' AND p_swap_dest_currency IS NOT NULL THEN
        -- DEBIT SOURCE (Amount + Fee)
        UPDATE public.usuarios SET 
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol = CASE WHEN p_currency = 'SOL' THEN saldo_sol - v_total_debit ELSE saldo_sol END,
            saldo_bdc = CASE WHEN p_currency = 'BDC' THEN saldo_bdc - v_total_debit ELSE saldo_bdc END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt = CASE WHEN p_currency = 'BRT' THEN saldo_brt - v_total_debit ELSE saldo_brt END
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
            saldo_sol = CASE WHEN p_swap_dest_currency = 'SOL' THEN saldo_sol + p_swap_dest_amount ELSE saldo_sol END,
            saldo_bdc = CASE WHEN p_swap_dest_currency = 'BDC' THEN saldo_bdc + p_swap_dest_amount ELSE saldo_bdc END,
            saldo_esct = CASE WHEN p_swap_dest_currency = 'ESCT' THEN saldo_esct + p_swap_dest_amount ELSE saldo_esct END,
            saldo_brt = CASE WHEN p_swap_dest_currency = 'BRT' THEN saldo_brt + p_swap_dest_amount ELSE saldo_brt END
            WHERE id = p_user_id;

        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'credit', p_swap_dest_currency, p_swap_dest_amount, v_dest_token_balance + p_swap_dest_amount);

    ELSIF p_type = 'transfer' AND p_destinatario_id IS NOT NULL THEN
        -- Debit Sender (Base currency)
        UPDATE public.usuarios SET 
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol = CASE WHEN p_currency = 'SOL' THEN saldo_sol - v_total_debit ELSE saldo_sol END,
            saldo_bdc = CASE WHEN p_currency = 'BDC' THEN saldo_bdc - v_total_debit ELSE saldo_bdc END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt = CASE WHEN p_currency = 'BRT' THEN saldo_brt - v_total_debit ELSE saldo_brt END,
            saldo_btc = CASE WHEN p_currency = 'BTC' THEN saldo_btc - v_total_debit ELSE saldo_btc END,
            saldo_eth = CASE WHEN p_currency = 'ETH' THEN saldo_eth - v_total_debit ELSE saldo_eth END
            WHERE id = p_user_id;
        INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
        VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);

        -- Credit Receiver
        UPDATE public.usuarios SET 
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt + p_amount ELSE saldo_usdt END,
            saldo_sol = CASE WHEN p_currency = 'SOL' THEN saldo_sol + p_amount ELSE saldo_sol END,
            saldo_bdc = CASE WHEN p_currency = 'BDC' THEN saldo_bdc + p_amount ELSE saldo_bdc END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct + p_amount ELSE saldo_esct END,
            saldo_brt = CASE WHEN p_currency = 'BRT' THEN saldo_brt + p_amount ELSE saldo_brt END,
            saldo_btc = CASE WHEN p_currency = 'BTC' THEN saldo_btc + p_amount ELSE saldo_btc END,
            saldo_eth = CASE WHEN p_currency = 'ETH' THEN saldo_eth + p_amount ELSE saldo_eth END
            WHERE id = p_destinatario_id;

    ELSIF p_type IN ('withdraw', 'investment') THEN
        UPDATE public.usuarios SET 
            saldo_usdt = CASE WHEN p_currency = 'USDT' THEN saldo_usdt - v_total_debit ELSE saldo_usdt END,
            saldo_sol = CASE WHEN p_currency = 'SOL' THEN saldo_sol - v_total_debit ELSE saldo_sol END,
            saldo_bdc = CASE WHEN p_currency = 'BDC' THEN saldo_bdc - v_total_debit ELSE saldo_bdc END,
            saldo_esct = CASE WHEN p_currency = 'ESCT' THEN saldo_esct - v_total_debit ELSE saldo_esct END,
            saldo_brt = CASE WHEN p_currency = 'BRT' THEN saldo_brt - v_total_debit ELSE saldo_brt END,
            saldo_btc = CASE WHEN p_currency = 'BTC' THEN saldo_btc - v_total_debit ELSE saldo_btc END,
            saldo_eth = CASE WHEN p_currency = 'ETH' THEN saldo_eth - v_total_debit ELSE saldo_eth END
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

-- 6. Trigger for Frontend Compatibility (Transparently uses Ledger & Fees)
CREATE OR REPLACE FUNCTION public.handle_legacy_financial_op()
RETURNS TRIGGER AS $$
DECLARE
    v_op_type public.transaction_type;
BEGIN
    -- Map legacy string types to ENUM
    v_op_type := CASE 
        WHEN NEW.tipo = 'TRANSFERENCIA' THEN 'transfer'::public.transaction_type
        WHEN NEW.tipo = 'DEPOSITO' THEN 'deposit'::public.transaction_type
        WHEN NEW.tipo = 'SAQUE' THEN 'withdraw'::public.transaction_type
        WHEN NEW.tipo = 'INVESTIMENTO' THEN 'investment'::public.transaction_type
        ELSE 'transfer'::public.transaction_type 
    END;

    -- Execute with automatic backend fee calculation using NAMED parameters (Bug 15)
    PERFORM public.process_ledger_operation(
        p_user_id := NEW.remetente_id,
        p_type := v_op_type,
        p_amount := NEW.valor,
        p_currency := NEW.moeda,
        p_destinatario_id := (NEW.metadata->>'destinatario_id')::UUID,
        p_metadata := jsonb_build_object('legacy_hash', NEW.hash, 'legacy_desc', NEW.descricao, 'raw_moeda', NEW.moeda)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_legacy_financial_op ON public.transacoes;
CREATE TRIGGER trigger_legacy_financial_op
INSTEAD OF INSERT ON public.transacoes
FOR EACH ROW
EXECUTE FUNCTION public.handle_legacy_financial_op();

-- 7. Audit RLS & Security
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users view own entries" ON public.ledger_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Public read fees" ON public.treasury_account FOR SELECT USING (true);

-- 8. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tx_user ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tx ON public.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON public.ledger_entries(user_id);
