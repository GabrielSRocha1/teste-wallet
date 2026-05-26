-- ============================================================
-- MIGRAÇÃO: deposit_orders.id UUID → TEXT
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Contexto: o schema v3 original definiu deposit_orders.id como
-- TEXT (formato 'pix-{uuid}-{ts}' ou 'vest-{uuid}-{ts}'). Em algum
-- ponto a tabela foi recriada como UUID — provavelmente pela UI
-- do Supabase, que usa UUID + gen_random_uuid() por padrão.
--
-- Problema: o frontend insere id='vest-{uuid}-{ts}' e o
-- api/picpay.ts faz PATCH ?id=eq.{referenceId} usando essa mesma
-- string como chave de correlação webhook ↔ pedido. Voltar pra
-- TEXT é a forma mais simples de restaurar o fluxo.
--
-- IMPORTANTE: roda em transação. Se algo falhar, nada é commitado.
-- ============================================================

BEGIN;

-- 1. Derruba a FK temporariamente (constraint não permite mudar tipo
--    enquanto referenciada). Recriamos depois.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_deposit_order_id_fkey;

-- 2. Remove o default UUID antes de mudar o tipo — gen_random_uuid()
--    retorna UUID, não TEXT, então causaria erro de cast.
ALTER TABLE public.deposit_orders
  ALTER COLUMN id DROP DEFAULT;

-- 3. Converte deposit_orders.id de UUID pra TEXT.
--    USING id::text faz o cast linha-a-linha sem perder dados
--    (UUIDs viram strings hexa de 36 chars).
ALTER TABLE public.deposit_orders
  ALTER COLUMN id TYPE TEXT USING id::text;

-- 4. Converte transactions.deposit_order_id pra TEXT também, senão
--    a recriação da FK falha por tipo divergente.
ALTER TABLE public.transactions
  ALTER COLUMN deposit_order_id TYPE TEXT USING deposit_order_id::text;

-- 5. Recria a FK.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_deposit_order_id_fkey
    FOREIGN KEY (deposit_order_id)
    REFERENCES public.deposit_orders(id)
    ON DELETE SET NULL;

COMMIT;

-- 6. Reload do PostgREST cache.
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────
-- Verificação: ambos devem retornar 'text'.
-- ────────────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE (table_name = 'deposit_orders' AND column_name = 'id')
   OR (table_name = 'transactions'   AND column_name = 'deposit_order_id');
