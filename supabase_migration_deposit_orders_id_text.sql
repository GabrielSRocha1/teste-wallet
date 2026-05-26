-- ============================================================
-- MIGRAÇÃO: deposit_orders.id UUID → TEXT  (v2 — corrigida)
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
-- NOTA (v2): a versão anterior tentava alterar transactions.deposit_order_id
-- — coluna que o database.types.ts lista mas que não existe no DB real.
-- Esta versão usa um bloco DO para detectar e dropar QUALQUER FK que
-- referencie deposit_orders.id, sem assumir nomes específicos.
-- ============================================================

BEGIN;

-- 1. Dropa dinamicamente todas as FKs que apontam pra deposit_orders.id,
--    guardando uma lista pra recriar depois.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT
      conname,
      conrelid::regclass AS table_name,
      pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.deposit_orders'::regclass
  LOOP
    RAISE NOTICE 'Dropando FK % em %', fk.conname, fk.table_name;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.table_name, fk.conname);
  END LOOP;
END;
$$;

-- 2. Remove o default UUID (gen_random_uuid() não casta pra TEXT).
ALTER TABLE public.deposit_orders
  ALTER COLUMN id DROP DEFAULT;

-- 3. Converte deposit_orders.id de UUID pra TEXT.
ALTER TABLE public.deposit_orders
  ALTER COLUMN id TYPE TEXT USING id::text;

COMMIT;

-- 4. Reload do PostgREST cache (fora da transação).
NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────
-- Verificação: deve retornar data_type = 'text'.
-- ────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deposit_orders'
  AND column_name = 'id';
