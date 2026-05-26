-- ============================================================
-- MIGRAÇÃO: Colunas faltantes em deposit_orders
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Contexto: o código (contratar-vesting.tsx, depositar-pix.tsx,
-- depositar-crypto.tsx) faz INSERT em deposit_orders incluindo
-- exchange_rate, expected_usdt, provider e saga_step — colunas
-- que nunca foram criadas no banco real. PostgREST devolve:
--   "Could not find the 'exchange_rate' column of 'deposit_orders'
--    in the schema cache"
--
-- Esta migração adiciona as colunas com defaults seguros para
-- não quebrar registros já existentes.
-- ============================================================

ALTER TABLE public.deposit_orders
  ADD COLUMN IF NOT EXISTS exchange_rate  NUMERIC(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_usdt  NUMERIC(20, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider       TEXT           NOT NULL DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS saga_step      TEXT           NOT NULL DEFAULT 'PIX_CREATED';

-- Restringe valores de saga_step ao conjunto conhecido pelo backend.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deposit_orders_saga_step_check'
  ) THEN
    ALTER TABLE public.deposit_orders
      ADD CONSTRAINT deposit_orders_saga_step_check
      CHECK (saga_step IN (
        'PIX_CREATED',
        'PIX_PAID',
        'SOL_QUOTED',
        'SOL_SENT',
        'COMPLETED',
        'FAILED',
        'REFUNDED'
      ));
  END IF;
END;
$$;

-- Índice para acelerar reconciliação por provider+status (cron de saga).
CREATE INDEX IF NOT EXISTS idx_deposit_orders_provider_status
  ON public.deposit_orders(provider, status);

-- Força PostgREST a recarregar o schema cache imediatamente —
-- sem isso, o INSERT continua falhando até o próximo restart.
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────
-- Verificação: confirma que as 4 colunas existem após a migração.
-- ────────────────────────────────────────────────────────────
SELECT
  'deposit_orders columns check' AS check_name,
  COUNT(*) FILTER (WHERE column_name = 'exchange_rate')  AS has_exchange_rate,
  COUNT(*) FILTER (WHERE column_name = 'expected_usdt')  AS has_expected_usdt,
  COUNT(*) FILTER (WHERE column_name = 'provider')       AS has_provider,
  COUNT(*) FILTER (WHERE column_name = 'saga_step')      AS has_saga_step
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'deposit_orders';
-- Esperado: cada coluna retornando 1.
