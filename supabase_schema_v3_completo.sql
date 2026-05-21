-- ============================================================
--  VERUM WALLET — Schema Supabase v3 Completo
--  Cobre TODAS as funções do app: auth, wallet, transações,
--  vesting, KYC, dApp, depósitos, notificações, auditoria.
--
--  Idempotente: seguro para rodar múltiplas vezes.
--  Execute no SQL Editor do painel Supabase.
-- ============================================================


-- ─── TIPOS ENUM ──────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE public.transaction_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE public.transaction_type AS ENUM ('deposit', 'withdraw', 'transfer', 'swap', 'investment');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE public.entry_type AS ENUM ('debit', 'credit');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE public.blockchain_status AS ENUM ('pending', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE public.fee_type AS ENUM ('transaction', 'investment');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE public.kyc_status AS ENUM ('pending', 'approved', 'rejected', 'on_hold');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ─── FUNÇÃO UTILITÁRIA: updated_at automático ────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════
--  BLOCO 1 — USUÁRIOS & CARTEIRAS
-- ════════════════════════════════════════════════════════════

-- ─── 1.1 usuarios ────────────────────────────────────────────────────────────
-- Perfil de usuário vinculado ao auth.users do Supabase.
-- Os campos saldo_* são cache: a fonte de verdade é ledger_entries.
CREATE TABLE IF NOT EXISTS public.usuarios (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   TEXT UNIQUE NOT NULL,
  nome_completo           TEXT NOT NULL,
  chave_pix               TEXT,
  banco                   TEXT,
  wallet_address          TEXT UNIQUE,                    -- endereço Solana principal
  public_key              TEXT,                           -- alias de wallet_address para compatibilidade
  saldo_usdt              NUMERIC(20, 8) DEFAULT 0,
  saldo_usdc              NUMERIC(20, 8) DEFAULT 0,
  saldo_sol               NUMERIC(20, 8) DEFAULT 0,
  saldo_bdc               NUMERIC(20, 8) DEFAULT 0,
  saldo_esct              NUMERIC(20, 8) DEFAULT 0,
  saldo_brt               NUMERIC(20, 8) DEFAULT 0,
  saldo_btc               NUMERIC(20, 8) DEFAULT 0,
  saldo_eth               NUMERIC(20, 8) DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_select_own" ON public.usuarios
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "usuarios_update_own" ON public.usuarios
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "service_role_usuarios" ON public.usuarios
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_wallet ON public.usuarios(wallet_address);

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON public.usuarios;
CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 1.2 wallets ─────────────────────────────────────────────────────────────
-- Suporta múltiplas carteiras por usuário (Solana hoje, EVM amanhã).
CREATE TABLE IF NOT EXISTS public.wallets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blockchain               TEXT NOT NULL DEFAULT 'solana',          -- 'solana' | 'ethereum'
  public_key               TEXT NOT NULL,                           -- endereço público Base58/Hex
  private_key_encrypted    TEXT,                                    -- AES-256 com senha do usuário
  mnemonic_encrypted       TEXT,                                    -- BIP39 criptografado (backup)
  transaction_password_hash TEXT,                                   -- bcrypt da senha de transação
  is_active                BOOLEAN DEFAULT TRUE,
  label                    TEXT,                                    -- apelido da carteira
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, public_key)
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets_select_own" ON public.wallets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "wallets_insert_own" ON public.wallets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallets_update_own" ON public.wallets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_wallets" ON public.wallets
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_wallets_user_id        ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_public_key     ON public.wallets(public_key);
CREATE INDEX IF NOT EXISTS idx_wallets_user_blockchain ON public.wallets(user_id, blockchain);

DROP TRIGGER IF EXISTS trg_wallets_updated_at ON public.wallets;
CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 1.3 token_mints ─────────────────────────────────────────────────────────
-- Registro estático dos tokens suportados pelo app.
CREATE TABLE IF NOT EXISTS public.token_mints (
  symbol          TEXT PRIMARY KEY,                    -- 'SOL', 'USDT', 'BDC', etc.
  mint_address    TEXT UNIQUE NOT NULL,                -- endereço do mint Solana
  decimals        INTEGER NOT NULL DEFAULT 6,
  name            TEXT NOT NULL,
  logo_url        TEXT,
  is_native       BOOLEAN DEFAULT FALSE,               -- TRUE para SOL nativo
  price_source    TEXT DEFAULT 'helius',               -- 'helius' | 'jupiter' | 'binance' | 'dexscreener'
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.token_mints (symbol, mint_address, decimals, name, is_native, price_source) VALUES
  ('SOL',  'So11111111111111111111111111111111111111112',          9, 'Solana',       TRUE,  'binance'),
  ('USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',       6, 'Tether USD',   FALSE, 'helius'),
  ('USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',       6, 'USD Coin',     FALSE, 'helius'),
  ('BDC',  'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9',       9, 'BodeCoin',     FALSE, 'dexscreener'),
  ('ESCT', 'Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt',       9, 'Escoteiros',   FALSE, 'dexscreener'),
  ('BRT',  '3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE',       9, 'Brutos',       FALSE, 'dexscreener')
ON CONFLICT (symbol) DO NOTHING;


-- ─── 1.4 balances ────────────────────────────────────────────────────────────
-- Cache de saldo por token por usuário (atualizado por sync do Helius).
-- A fonte de verdade são ledger_entries; esta tabela serve para leituras rápidas.
CREATE TABLE IF NOT EXISTS public.balances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_symbol        TEXT NOT NULL REFERENCES public.token_mints(symbol),
  amount              NUMERIC(20, 8) NOT NULL DEFAULT 0,
  amount_usd          NUMERIC(20, 8),                              -- valor em USD no último sync
  sync_source         TEXT DEFAULT 'helius',                       -- fonte que sincronizou
  updated_by_system   BOOLEAN DEFAULT TRUE,
  last_synced_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token_symbol)
);

ALTER TABLE public.balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "balances_select_own" ON public.balances
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_balances" ON public.balances
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_balances_user_token ON public.balances(user_id, token_symbol);


-- ════════════════════════════════════════════════════════════
--  BLOCO 2 — MOTOR FINANCEIRO (LEDGER)
-- ════════════════════════════════════════════════════════════

-- ─── 2.1 transactions ────────────────────────────────────────────────────────
-- Intenção de cada operação financeira. Imutável após criação.
CREATE TABLE IF NOT EXISTS public.transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key      TEXT UNIQUE,                                -- previne double-processing
  user_id              UUID NOT NULL REFERENCES auth.users(id),
  type                 public.transaction_type NOT NULL,
  amount               NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL DEFAULT 'USDT',
  fee_usd              NUMERIC(20, 8) DEFAULT 0,
  fee_sol              NUMERIC(20, 8) DEFAULT 0,
  fee_type             public.fee_type DEFAULT 'transaction',
  treasury_wallet      TEXT DEFAULT 'Da51JLCnUfN3L3RDNeYkn7kxr7C3otnLaLvbsjmTTzE8',
  blockchain_tx_hash   TEXT,
  blockchain_status    public.blockchain_status,
  status               public.transaction_status DEFAULT 'pending',
  description          TEXT,
  usd_value_at_time    NUMERIC(20, 8),                             -- snapshot do preço USD no momento
  wallet_address       TEXT,                                       -- carteira que originou
  reference_id         UUID,                                       -- vincula lados de uma transferência
  metadata             JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tx_select_own" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_transactions" ON public.transactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_tx_user_id      ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_status  ON public.transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tx_user_created ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_idem_key     ON public.transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_tx_chain_hash   ON public.transactions(blockchain_tx_hash);


-- ─── 2.2 ledger_entries ──────────────────────────────────────────────────────
-- Partidas dobradas imutáveis. Nunca apagar ou alterar linhas.
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  transaction_id  UUID NOT NULL REFERENCES public.transactions(id),
  entry_type      public.entry_type NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USDT',
  amount          NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
  balance_after   NUMERIC(20, 8) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_select_own" ON public.ledger_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_ledger" ON public.ledger_entries
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_ledger_user_id      ON public.ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_id        ON public.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON public.ledger_entries(user_id, created_at DESC);


-- ─── 2.3 treasury_account ────────────────────────────────────────────────────
-- Singleton. Acumula as taxas da plataforma.
CREATE TABLE IF NOT EXISTS public.treasury_account (
  id          INT PRIMARY KEY DEFAULT 1,
  balance     NUMERIC(20, 8) DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO public.treasury_account (id, balance)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.treasury_account ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treasury_public_read" ON public.treasury_account
  FOR SELECT USING (TRUE);

CREATE POLICY "service_role_treasury" ON public.treasury_account
  FOR ALL USING (auth.role() = 'service_role');


-- ─── 2.4 price_snapshots ─────────────────────────────────────────────────────
-- Histórico de cotações capturadas no momento de cada transação.
CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_symbol  TEXT NOT NULL,
  price_usd     NUMERIC(20, 8) NOT NULL,
  price_brl     NUMERIC(20, 8),
  price_pyg     NUMERIC(20, 8),
  source        TEXT NOT NULL DEFAULT 'helius',
  captured_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_token_time ON public.price_snapshots(token_symbol, captured_at DESC);


-- ════════════════════════════════════════════════════════════
--  BLOCO 3 — DEPÓSITOS & SAQUES
-- ════════════════════════════════════════════════════════════

-- ─── 3.1 deposit_orders ──────────────────────────────────────────────────────
-- Rastreamento de depósitos via PIX / PicPay / Ramp Network.
CREATE TABLE IF NOT EXISTS public.deposit_orders (
  id                 TEXT PRIMARY KEY,                             -- 'pix-{user_id}-{ts}'
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address     TEXT,                                         -- destino Solana
  amount_brl         NUMERIC(12, 2) NOT NULL,
  amount_sol         NUMERIC(18, 6),                              -- calculado após cotação
  amount_usdt        NUMERIC(18, 6),                              -- alternativa em USDT
  sol_price_brl      NUMERIC(12, 2),                             -- snapshot da cotação
  payment_method     TEXT NOT NULL DEFAULT 'pix',                 -- 'pix' | 'picpay' | 'ramp' | 'transfer'
  status             TEXT NOT NULL DEFAULT 'pending',             -- 'pending' | 'paid' | 'delivered' | 'cancelled'
  confirmation_level INT NOT NULL DEFAULT 0,                      -- 0=pendente, 1=confirmado, 2=finalizado
  pix_code           TEXT,
  picpay_reference   TEXT,
  tx_signature       TEXT,                                        -- assinatura Solana após entrega
  expires_at         TIMESTAMPTZ,                                  -- expiração do PIX (30 min)
  paid_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.deposit_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deposits_select_own" ON public.deposit_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "deposits_insert_own" ON public.deposit_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_role_deposits" ON public.deposit_orders
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_deposits_user_id  ON public.deposit_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status   ON public.deposit_orders(status);
CREATE INDEX IF NOT EXISTS idx_deposits_created  ON public.deposit_orders(created_at DESC);

DROP TRIGGER IF EXISTS trg_deposits_updated_at ON public.deposit_orders;
CREATE TRIGGER trg_deposits_updated_at
  BEFORE UPDATE ON public.deposit_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 3.2 withdraw_orders ─────────────────────────────────────────────────────
-- Rastreamento de saques para fiat (BRL / PYG) via PIX ou transferência.
CREATE TABLE IF NOT EXISTS public.withdraw_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address     TEXT NOT NULL,                               -- carteira de origem
  token_symbol       TEXT NOT NULL DEFAULT 'USDT',               -- token que será vendido
  amount_token       NUMERIC(20, 8) NOT NULL,                    -- quantidade de token a sacar
  amount_brl         NUMERIC(12, 2),                             -- valor em BRL a receber
  amount_pyg         NUMERIC(20, 2),                             -- valor em PYG a receber
  currency_fiat      TEXT NOT NULL DEFAULT 'BRL',                -- 'BRL' | 'PYG'
  pix_key            TEXT,                                        -- chave PIX de destino
  bank_name          TEXT,
  swap_tx_hash       TEXT,                                        -- tx do Jupiter para converter
  transfer_receipt   TEXT,                                        -- comprovante da transferência
  status             TEXT NOT NULL DEFAULT 'pending',             -- 'pending' | 'processing' | 'completed' | 'failed'
  fee_amount         NUMERIC(20, 8) DEFAULT 0,
  error_message      TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.withdraw_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "withdraw_select_own" ON public.withdraw_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "withdraw_insert_own" ON public.withdraw_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_role_withdraws" ON public.withdraw_orders
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_withdraw_user_id  ON public.withdraw_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_withdraw_status   ON public.withdraw_orders(status);
CREATE INDEX IF NOT EXISTS idx_withdraw_created  ON public.withdraw_orders(created_at DESC);

DROP TRIGGER IF EXISTS trg_withdraw_updated_at ON public.withdraw_orders;
CREATE TRIGGER trg_withdraw_updated_at
  BEFORE UPDATE ON public.withdraw_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ════════════════════════════════════════════════════════════
--  BLOCO 4 — SWAPS (JUPITER)
-- ════════════════════════════════════════════════════════════

-- ─── 4.1 swap_orders ─────────────────────────────────────────────────────────
-- Auditoria de cada swap executado via Jupiter Ultra.
CREATE TABLE IF NOT EXISTS public.swap_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  wallet_address    TEXT NOT NULL,
  input_token       TEXT NOT NULL,                               -- mint address
  output_token      TEXT NOT NULL,                               -- mint address
  input_amount      BIGINT NOT NULL,                             -- unidades mínimas (lamports)
  output_amount     BIGINT,                                      -- recebido on-chain
  expected_output   BIGINT NOT NULL,                             -- quote do Jupiter
  slippage_bps      INTEGER DEFAULT 50,                          -- 50 = 0.5%
  price_impact_pct  NUMERIC(8, 4),
  route_plan        JSONB,                                       -- plano de rota do Jupiter
  quote_id          TEXT,
  on_chain_tx_hash  TEXT UNIQUE,
  status            TEXT DEFAULT 'pending',                      -- 'pending'|'submitted'|'confirmed'|'failed'
  fee_amount        BIGINT DEFAULT 0,                            -- taxa em lamports SOL
  fee_token         TEXT DEFAULT 'SOL',
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ
);

ALTER TABLE public.swap_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swaps_select_own" ON public.swap_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_swaps" ON public.swap_orders
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_swaps_user_status  ON public.swap_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_swaps_tx_hash      ON public.swap_orders(on_chain_tx_hash);
CREATE INDEX IF NOT EXISTS idx_swaps_status_date  ON public.swap_orders(status, created_at DESC);


-- ════════════════════════════════════════════════════════════
--  BLOCO 5 — VESTING
-- ════════════════════════════════════════════════════════════

-- ─── 5.1 vesting_contracts ───────────────────────────────────────────────────
-- Contrato de investimento com liberação gradual de tokens.
CREATE TABLE IF NOT EXISTS public.vesting_contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token                 TEXT NOT NULL,                           -- 'BDC' | 'ESCT' | 'BRT'
  investment_amount_brl NUMERIC(19, 2) NOT NULL,                 -- valor investido em BRL
  token_quantity        BIGINT NOT NULL,                         -- quantidade em lamports
  price_at_investment   NUMERIC(19, 8) NOT NULL,                 -- cotação no ato do investimento
  wallet_address        TEXT NOT NULL,                           -- carteira do investidor
  contract_type         TEXT DEFAULT 'Vesting',                  -- 'Vesting' | 'Seed' | 'Private'
  start_date            TIMESTAMPTZ NOT NULL,
  duration_months       INTEGER DEFAULT 60,
  end_date              TIMESTAMPTZ NOT NULL,
  unlock_start_date     TIMESTAMPTZ NOT NULL,                    -- quando começa a liberar
  status                TEXT DEFAULT 'active',                   -- 'active' | 'completed' | 'cancelled'
  total_released        BIGINT DEFAULT 0,                        -- total já liberado em lamports
  last_release_at       TIMESTAMPTZ,
  on_chain_tx_hash      TEXT,                                    -- tx de criação do contrato on-chain
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.vesting_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vesting_select_own" ON public.vesting_contracts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "service_role_vesting_contracts" ON public.vesting_contracts
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_vesting_user_status  ON public.vesting_contracts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_vesting_token        ON public.vesting_contracts(token);
CREATE INDEX IF NOT EXISTS idx_vesting_unlock_date  ON public.vesting_contracts(status, unlock_start_date);

DROP TRIGGER IF EXISTS trg_vesting_contracts_updated_at ON public.vesting_contracts;
CREATE TRIGGER trg_vesting_contracts_updated_at
  BEFORE UPDATE ON public.vesting_contracts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 5.2 vesting_releases ────────────────────────────────────────────────────
-- Histórico de cada liberação de tokens de um contrato.
CREATE TABLE IF NOT EXISTS public.vesting_releases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      UUID NOT NULL REFERENCES public.vesting_contracts(id) ON DELETE CASCADE,
  release_number   INTEGER NOT NULL,                             -- 1, 2, 3 ... N
  amount_released  BIGINT NOT NULL,                              -- lamports liberados nesta parcela
  release_date     TIMESTAMPTZ NOT NULL,
  on_chain_tx_hash TEXT,
  status           TEXT DEFAULT 'pending',                       -- 'pending' | 'confirmed' | 'failed'
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contract_id, release_number)
);

ALTER TABLE public.vesting_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vesting_releases_select_own" ON public.vesting_releases
  FOR SELECT USING (
    contract_id IN (
      SELECT id FROM public.vesting_contracts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "service_role_vesting_releases" ON public.vesting_releases
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_vr_contract_id   ON public.vesting_releases(contract_id);
CREATE INDEX IF NOT EXISTS idx_vr_status_date   ON public.vesting_releases(status, release_date);


-- ════════════════════════════════════════════════════════════
--  BLOCO 6 — KYC
-- ════════════════════════════════════════════════════════════

-- ─── 6.1 kyc_profiles ────────────────────────────────────────────────────────
-- Dados pessoais preenchidos pelo usuário no formulário KYC.
CREATE TABLE IF NOT EXISTS public.kyc_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  sobrenome        TEXT NOT NULL,
  data_nascimento  TEXT NOT NULL,
  nacionalidade    TEXT NOT NULL,
  cpf              TEXT NOT NULL,
  telefone         TEXT,
  endereco         JSONB,                                        -- {rua, numero, cidade, estado, cep, pais}
  status           public.kyc_status DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.kyc_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_profiles_select_own" ON public.kyc_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "kyc_profiles_insert_own" ON public.kyc_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "kyc_profiles_update_own" ON public.kyc_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_kyc_profiles" ON public.kyc_profiles
  FOR ALL USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_kyc_profiles_updated_at ON public.kyc_profiles;
CREATE TRIGGER trg_kyc_profiles_updated_at
  BEFORE UPDATE ON public.kyc_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ─── 6.2 kyc_checks ──────────────────────────────────────────────────────────
-- Respostas e webhooks do provedor Sumsub.
CREATE TABLE IF NOT EXISTS public.kyc_checks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT DEFAULT 'sumsub',
  applicant_id        TEXT NOT NULL,
  review_status       TEXT NOT NULL,                             -- 'pending'|'completed'|'rejected'|'onHold'
  review_result       JSONB,
  moderation_comment  TEXT,
  country             TEXT NOT NULL,
  doc_type            TEXT,
  webhook_payload     JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.kyc_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_checks_select_own" ON public.kyc_checks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_kyc_checks" ON public.kyc_checks
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_kyc_checks_user        ON public.kyc_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_applicant   ON public.kyc_checks(applicant_id);
CREATE INDEX IF NOT EXISTS idx_kyc_checks_status      ON public.kyc_checks(review_status);

DROP TRIGGER IF EXISTS trg_kyc_checks_updated_at ON public.kyc_checks;
CREATE TRIGGER trg_kyc_checks_updated_at
  BEFORE UPDATE ON public.kyc_checks
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


-- ════════════════════════════════════════════════════════════
--  BLOCO 7 — DAPP BROWSER & WALLET ADAPTER
-- ════════════════════════════════════════════════════════════

-- ─── 7.1 connected_sessions ──────────────────────────────────────────────────
-- dApps aprovados pelo usuário via wallet adapter.
CREATE TABLE IF NOT EXISTS public.connected_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dapp_id         TEXT NOT NULL,                                 -- UUID fornecido pelo dApp
  dapp_name       TEXT NOT NULL,
  dapp_origin     TEXT NOT NULL,                                 -- URL base do dApp
  dapp_icon       TEXT,
  wallet_address  TEXT NOT NULL,                                 -- endereço conectado
  network         TEXT DEFAULT 'mainnet-beta',                   -- 'mainnet-beta' | 'devnet'
  permissions     TEXT[] DEFAULT ARRAY['publicKey'],             -- 'publicKey'|'balance'|'signMessage'|'signTransaction'
  connected_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ DEFAULT NOW(),
  is_active       BOOLEAN DEFAULT TRUE,
  UNIQUE(user_id, dapp_origin, wallet_address)
);

ALTER TABLE public.connected_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own" ON public.connected_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "sessions_insert_own" ON public.connected_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sessions_update_own" ON public.connected_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "sessions_delete_own" ON public.connected_sessions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.connected_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_origin  ON public.connected_sessions(dapp_origin);


-- ─── 7.2 sign_requests ───────────────────────────────────────────────────────
-- Pedidos de assinatura de mensagem ou transação enviados por dApps.
CREATE TABLE IF NOT EXISTS public.sign_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.connected_sessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  request_type    TEXT NOT NULL,                                 -- 'signMessage' | 'signTransaction' | 'signAllTransactions'
  payload         JSONB NOT NULL,                                -- conteúdo serializado a assinar
  status          TEXT DEFAULT 'pending',                        -- 'pending' | 'approved' | 'rejected'
  signed_data     TEXT,                                          -- assinatura resultante (base58)
  tx_hash         TEXT,                                          -- hash on-chain se foi transação
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.sign_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sign_requests_select_own" ON public.sign_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_sign_requests" ON public.sign_requests
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_sign_requests_user   ON public.sign_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_sign_requests_status ON public.sign_requests(status);


-- ════════════════════════════════════════════════════════════
--  BLOCO 8 — NOTIFICAÇÕES & WEBHOOKS
-- ════════════════════════════════════════════════════════════

-- ─── 8.1 notifications ───────────────────────────────────────────────────────
-- Notificações in-app com persistência no banco.
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                                     -- 'TRANSACTION'|'VESTING_RELEASE'|'KYC_UPDATE'|'DEPOSIT'|'WITHDRAW'
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  read_at     TIMESTAMPTZ,                                       -- NULL = não lida
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "service_role_notifications" ON public.notifications
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_notif_user_read    ON public.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON public.notifications(user_id, created_at DESC);


-- ─── 8.2 webhook_logs ────────────────────────────────────────────────────────
-- Log de todos os webhooks externos recebidos (Sumsub, PicPay, Ramp, Helius).
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT UNIQUE,                                  -- deduplica reentregas
  provider         TEXT NOT NULL,                                -- 'sumsub' | 'picpay' | 'ramp' | 'helius'
  event_type       TEXT NOT NULL,                                -- tipo de evento do provedor
  payload          JSONB NOT NULL,
  headers          JSONB,
  processing_status TEXT DEFAULT 'received',                     -- 'received' | 'processed' | 'failed' | 'ignored'
  error_message    TEXT,
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_webhooks" ON public.webhook_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_webhooks_provider  ON public.webhook_logs(provider);
CREATE INDEX IF NOT EXISTS idx_webhooks_idem_key  ON public.webhook_logs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_webhooks_status    ON public.webhook_logs(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhooks_created   ON public.webhook_logs(created_at DESC);


-- ════════════════════════════════════════════════════════════
--  BLOCO 9 — SEGURANÇA & AUDITORIA
-- ════════════════════════════════════════════════════════════

-- ─── 9.1 security_events ─────────────────────────────────────────────────────
-- Trilha de auditoria: login, biometria, exportação de chaves, bloqueios.
CREATE TABLE IF NOT EXISTS public.security_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,                                 -- 'login'|'logout'|'biometric_auth'|'export_key'|'export_mnemonic'|'wallet_created'|'wallet_recovered'|'lock'|'unlock'|'failed_login'
  success         BOOLEAN DEFAULT TRUE,
  ip_address      TEXT,
  user_agent      TEXT,
  device_id       TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "security_events_select_own" ON public.security_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_security_events" ON public.security_events
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_sec_user_id    ON public.security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_event_type ON public.security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sec_created    ON public.security_events(created_at DESC);


-- ════════════════════════════════════════════════════════════
--  BLOCO 10 — VIEWS DE COMPATIBILIDADE
-- ════════════════════════════════════════════════════════════

-- View legada que o frontend usa como "transacoes"
CREATE OR REPLACE VIEW public.transacoes AS
SELECT
  id,
  user_id AS remetente_id,
  CASE
    WHEN metadata IS NOT NULL
     AND metadata->>'destinatario_id' IS NOT NULL
     AND metadata->>'destinatario_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (metadata->>'destinatario_id')::UUID
    ELSE NULL
  END AS destinatario_id,
  type::TEXT AS tipo,
  amount AS valor,
  COALESCE(currency, 'USDT') AS moeda,
  COALESCE(blockchain_tx_hash, id::TEXT) AS hash,
  status::TEXT AS status,
  COALESCE(description, '') AS descricao,
  created_at
FROM public.transactions;


-- ════════════════════════════════════════════════════════════
--  BLOCO 11 — MOTOR FINANCEIRO ATÔMICO
-- ════════════════════════════════════════════════════════════

-- ─── process_ledger_operation ────────────────────────────────────────────────
-- Função central para TODAS as operações financeiras.
-- Garante ACID, idempotência, taxas e ledger duplo em um único call.
CREATE OR REPLACE FUNCTION public.process_ledger_operation(
  p_user_id           UUID,
  p_type              public.transaction_type,
  p_amount            NUMERIC,
  p_currency          TEXT       DEFAULT 'USDT',
  p_idempotency_key   TEXT       DEFAULT NULL,
  p_destinatario_id   UUID       DEFAULT NULL,
  p_swap_dest_currency TEXT      DEFAULT NULL,
  p_swap_dest_amount  NUMERIC    DEFAULT NULL,
  p_metadata          JSONB      DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_tx_id             UUID;
  v_current_balance   NUMERIC;
  v_dest_balance      NUMERIC;
  v_fee               NUMERIC := 0;
  v_fee_type          public.fee_type := 'transaction';
  v_total_debit       NUMERIC;
  v_treasury CONSTANT TEXT := 'Da51JLCnUfN3L3RDNeYkn7kxr7C3otnLaLvbsjmTTzE8';
BEGIN
  -- Idempotência
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_tx_id FROM public.transactions WHERE idempotency_key = p_idempotency_key;
    IF v_tx_id IS NOT NULL THEN RETURN v_tx_id; END IF;
  END IF;

  -- Taxa: 2% investimento / 0.2% demais operações (cobrada em USDT)
  IF p_type = 'investment' THEN
    v_fee := p_amount * 0.02; v_fee_type := 'investment';
  ELSIF p_type IN ('transfer', 'withdraw', 'swap') THEN
    v_fee := p_amount * 0.002; v_fee_type := 'transaction';
  END IF;

  v_total_debit := p_amount + (CASE WHEN p_currency = 'USDT' THEN v_fee ELSE 0 END);

  -- Lê e trava o saldo (FOR UPDATE = sem condição de corrida)
  SELECT CASE
    WHEN p_currency = 'USDT' THEN saldo_usdt
    WHEN p_currency = 'USDC' THEN saldo_usdc
    WHEN p_currency = 'SOL'  THEN saldo_sol
    WHEN p_currency = 'BDC'  THEN saldo_bdc
    WHEN p_currency = 'ESCT' THEN saldo_esct
    WHEN p_currency = 'BRT'  THEN saldo_brt
    WHEN p_currency = 'BTC'  THEN saldo_btc
    WHEN p_currency = 'ETH'  THEN saldo_eth
    ELSE 0
  END INTO v_current_balance
  FROM public.usuarios WHERE id = p_user_id FOR UPDATE;

  -- Validação de saldo
  IF p_type IN ('withdraw', 'transfer', 'investment', 'swap')
     AND v_current_balance < v_total_debit THEN
    RAISE EXCEPTION 'Saldo insuficiente em %: necessário %, disponível % (taxa: %)',
      p_currency, v_total_debit, v_current_balance, v_fee;
  END IF;

  -- Registro da transação
  INSERT INTO public.transactions
    (user_id, idempotency_key, type, amount, currency, fee_usd, fee_type, treasury_wallet, status, metadata)
  VALUES
    (p_user_id, p_idempotency_key, p_type, p_amount, p_currency, v_fee, v_fee_type,
     v_treasury, 'completed',
     p_metadata || jsonb_build_object('dest_currency', p_swap_dest_currency, 'dest_amount', p_swap_dest_amount))
  RETURNING id INTO v_tx_id;

  -- Movimentações
  IF p_type = 'deposit' THEN
    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt + CASE WHEN p_currency = 'USDT' THEN p_amount ELSE 0 END,
      saldo_usdc = saldo_usdc + CASE WHEN p_currency = 'USDC' THEN p_amount ELSE 0 END,
      saldo_sol  = saldo_sol  + CASE WHEN p_currency = 'SOL'  THEN p_amount ELSE 0 END,
      saldo_bdc  = saldo_bdc  + CASE WHEN p_currency = 'BDC'  THEN p_amount ELSE 0 END,
      saldo_esct = saldo_esct + CASE WHEN p_currency = 'ESCT' THEN p_amount ELSE 0 END,
      saldo_brt  = saldo_brt  + CASE WHEN p_currency = 'BRT'  THEN p_amount ELSE 0 END,
      saldo_btc  = saldo_btc  + CASE WHEN p_currency = 'BTC'  THEN p_amount ELSE 0 END,
      saldo_eth  = saldo_eth  + CASE WHEN p_currency = 'ETH'  THEN p_amount ELSE 0 END
    WHERE id = p_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
    VALUES (p_user_id, v_tx_id, 'credit', p_currency, p_amount, v_current_balance + p_amount);

  ELSIF p_type = 'swap' AND p_swap_dest_currency IS NOT NULL THEN
    -- Débita origem
    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt - CASE WHEN p_currency = 'USDT' THEN v_total_debit ELSE 0 END,
      saldo_usdc = saldo_usdc - CASE WHEN p_currency = 'USDC' THEN v_total_debit ELSE 0 END,
      saldo_sol  = saldo_sol  - CASE WHEN p_currency = 'SOL'  THEN v_total_debit ELSE 0 END,
      saldo_bdc  = saldo_bdc  - CASE WHEN p_currency = 'BDC'  THEN v_total_debit ELSE 0 END,
      saldo_esct = saldo_esct - CASE WHEN p_currency = 'ESCT' THEN v_total_debit ELSE 0 END,
      saldo_brt  = saldo_brt  - CASE WHEN p_currency = 'BRT'  THEN v_total_debit ELSE 0 END
    WHERE id = p_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
    VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);

    -- Credita destino
    SELECT CASE
      WHEN p_swap_dest_currency = 'USDT' THEN saldo_usdt
      WHEN p_swap_dest_currency = 'USDC' THEN saldo_usdc
      WHEN p_swap_dest_currency = 'SOL'  THEN saldo_sol
      WHEN p_swap_dest_currency = 'BDC'  THEN saldo_bdc
      WHEN p_swap_dest_currency = 'ESCT' THEN saldo_esct
      WHEN p_swap_dest_currency = 'BRT'  THEN saldo_brt
    END INTO v_dest_balance
    FROM public.usuarios WHERE id = p_user_id FOR UPDATE;

    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt + CASE WHEN p_swap_dest_currency = 'USDT' THEN p_swap_dest_amount ELSE 0 END,
      saldo_usdc = saldo_usdc + CASE WHEN p_swap_dest_currency = 'USDC' THEN p_swap_dest_amount ELSE 0 END,
      saldo_sol  = saldo_sol  + CASE WHEN p_swap_dest_currency = 'SOL'  THEN p_swap_dest_amount ELSE 0 END,
      saldo_bdc  = saldo_bdc  + CASE WHEN p_swap_dest_currency = 'BDC'  THEN p_swap_dest_amount ELSE 0 END,
      saldo_esct = saldo_esct + CASE WHEN p_swap_dest_currency = 'ESCT' THEN p_swap_dest_amount ELSE 0 END,
      saldo_brt  = saldo_brt  + CASE WHEN p_swap_dest_currency = 'BRT'  THEN p_swap_dest_amount ELSE 0 END
    WHERE id = p_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
    VALUES (p_user_id, v_tx_id, 'credit', p_swap_dest_currency, p_swap_dest_amount, v_dest_balance + p_swap_dest_amount);

  ELSIF p_type = 'transfer' AND p_destinatario_id IS NOT NULL THEN
    -- Débita remetente
    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt - CASE WHEN p_currency = 'USDT' THEN v_total_debit ELSE 0 END,
      saldo_usdc = saldo_usdc - CASE WHEN p_currency = 'USDC' THEN v_total_debit ELSE 0 END,
      saldo_sol  = saldo_sol  - CASE WHEN p_currency = 'SOL'  THEN v_total_debit ELSE 0 END,
      saldo_bdc  = saldo_bdc  - CASE WHEN p_currency = 'BDC'  THEN v_total_debit ELSE 0 END,
      saldo_esct = saldo_esct - CASE WHEN p_currency = 'ESCT' THEN v_total_debit ELSE 0 END,
      saldo_brt  = saldo_brt  - CASE WHEN p_currency = 'BRT'  THEN v_total_debit ELSE 0 END,
      saldo_btc  = saldo_btc  - CASE WHEN p_currency = 'BTC'  THEN v_total_debit ELSE 0 END,
      saldo_eth  = saldo_eth  - CASE WHEN p_currency = 'ETH'  THEN v_total_debit ELSE 0 END
    WHERE id = p_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
    VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);

    -- Credita destinatário
    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt + CASE WHEN p_currency = 'USDT' THEN p_amount ELSE 0 END,
      saldo_usdc = saldo_usdc + CASE WHEN p_currency = 'USDC' THEN p_amount ELSE 0 END,
      saldo_sol  = saldo_sol  + CASE WHEN p_currency = 'SOL'  THEN p_amount ELSE 0 END,
      saldo_bdc  = saldo_bdc  + CASE WHEN p_currency = 'BDC'  THEN p_amount ELSE 0 END,
      saldo_esct = saldo_esct + CASE WHEN p_currency = 'ESCT' THEN p_amount ELSE 0 END,
      saldo_brt  = saldo_brt  + CASE WHEN p_currency = 'BRT'  THEN p_amount ELSE 0 END,
      saldo_btc  = saldo_btc  + CASE WHEN p_currency = 'BTC'  THEN p_amount ELSE 0 END,
      saldo_eth  = saldo_eth  + CASE WHEN p_currency = 'ETH'  THEN p_amount ELSE 0 END
    WHERE id = p_destinatario_id;

  ELSIF p_type IN ('withdraw', 'investment') THEN
    UPDATE public.usuarios SET
      saldo_usdt = saldo_usdt - CASE WHEN p_currency = 'USDT' THEN v_total_debit ELSE 0 END,
      saldo_usdc = saldo_usdc - CASE WHEN p_currency = 'USDC' THEN v_total_debit ELSE 0 END,
      saldo_sol  = saldo_sol  - CASE WHEN p_currency = 'SOL'  THEN v_total_debit ELSE 0 END,
      saldo_bdc  = saldo_bdc  - CASE WHEN p_currency = 'BDC'  THEN v_total_debit ELSE 0 END,
      saldo_esct = saldo_esct - CASE WHEN p_currency = 'ESCT' THEN v_total_debit ELSE 0 END,
      saldo_brt  = saldo_brt  - CASE WHEN p_currency = 'BRT'  THEN v_total_debit ELSE 0 END,
      saldo_btc  = saldo_btc  - CASE WHEN p_currency = 'BTC'  THEN v_total_debit ELSE 0 END,
      saldo_eth  = saldo_eth  - CASE WHEN p_currency = 'ETH'  THEN v_total_debit ELSE 0 END
    WHERE id = p_user_id;
    INSERT INTO public.ledger_entries (user_id, transaction_id, entry_type, currency, amount, balance_after)
    VALUES (p_user_id, v_tx_id, 'debit', p_currency, v_total_debit, v_current_balance - v_total_debit);
  END IF;

  -- Coleta taxa na treasury
  IF v_fee > 0 THEN
    UPDATE public.treasury_account SET balance = balance + v_fee, updated_at = NOW() WHERE id = 1;
  END IF;

  RETURN v_tx_id;
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─── Trigger de compatibilidade para INSERT na view transacoes ────────────────
CREATE OR REPLACE FUNCTION public.handle_legacy_financial_op()
RETURNS TRIGGER AS $$
DECLARE v_op public.transaction_type;
BEGIN
  v_op := CASE
    WHEN NEW.tipo = 'TRANSFERENCIA' THEN 'transfer'::public.transaction_type
    WHEN NEW.tipo = 'DEPOSITO'      THEN 'deposit'::public.transaction_type
    WHEN NEW.tipo = 'SAQUE'         THEN 'withdraw'::public.transaction_type
    WHEN NEW.tipo = 'INVESTIMENTO'  THEN 'investment'::public.transaction_type
    ELSE 'transfer'::public.transaction_type
  END;
  PERFORM public.process_ledger_operation(
    p_user_id          := NEW.remetente_id,
    p_type             := v_op,
    p_amount           := NEW.valor,
    p_currency         := NEW.moeda,
    p_destinatario_id  := (NEW.metadata->>'destinatario_id')::UUID,
    p_metadata         := jsonb_build_object('legacy_hash', NEW.hash, 'descricao', NEW.descricao)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_legacy_financial_op ON public.transacoes;
CREATE TRIGGER trigger_legacy_financial_op
  INSTEAD OF INSERT ON public.transacoes
  FOR EACH ROW EXECUTE FUNCTION public.handle_legacy_financial_op();


-- ════════════════════════════════════════════════════════════
--  REFERÊNCIA RÁPIDA — TABELAS E FUNÇÕES
-- ════════════════════════════════════════════════════════════
--
--  TABELAS (20 no total)
--  ├── Usuários & Carteiras
--  │   ├── public.usuarios           — perfil vinculado ao auth.users
--  │   ├── public.wallets            — múltiplas carteiras por usuário
--  │   ├── public.token_mints        — registro estático de tokens Solana
--  │   └── public.balances           — cache de saldo por token
--  │
--  ├── Motor Financeiro
--  │   ├── public.transactions       — intenção de cada operação
--  │   ├── public.ledger_entries     — partidas dobradas imutáveis
--  │   ├── public.treasury_account   — singleton de taxas da plataforma
--  │   └── public.price_snapshots    — histórico de cotações
--  │
--  ├── Depósitos & Saques
--  │   ├── public.deposit_orders     — PIX / PicPay / Ramp
--  │   └── public.withdraw_orders    — saques para fiat BRL/PYG
--  │
--  ├── Swaps
--  │   └── public.swap_orders        — auditoria Jupiter Ultra
--  │
--  ├── Vesting
--  │   ├── public.vesting_contracts  — contratos BDC/ESCT/BRT
--  │   └── public.vesting_releases   — histórico de liberações
--  │
--  ├── KYC
--  │   ├── public.kyc_profiles       — dados pessoais do formulário
--  │   └── public.kyc_checks         — respostas Sumsub
--  │
--  ├── dApp Browser
--  │   ├── public.connected_sessions — aprovações de dApps
--  │   └── public.sign_requests      — pedidos de assinatura
--  │
--  ├── Notificações & Webhooks
--  │   ├── public.notifications      — notificações in-app
--  │   └── public.webhook_logs       — log de webhooks externos
--  │
--  └── Segurança
--      └── public.security_events    — auditoria de login/export/biometria
--
--  FUNÇÕES
--  ├── public.process_ledger_operation()   — motor ACID multi-moeda
--  ├── public.trigger_set_updated_at()     — trigger updated_at
--  └── public.handle_legacy_financial_op() — compat. view transacoes
--
--  VIEWS
--  └── public.transacoes                   — compatibilidade com frontend legado
-- ============================================================
