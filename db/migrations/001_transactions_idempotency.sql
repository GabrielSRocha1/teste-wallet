-- ─────────────────────────────────────────────────────────────────────────────
-- 001_transactions_idempotency.sql
--
-- Adiciona constraint UNIQUE para prevenir duplicação de registros em
-- `public.transactions` quando o cliente faz retry após perda da resposta HTTP
-- (problema #9 do diagnóstico — saveTransaction loop retentava com mesmo hash).
--
-- Estratégia:
--   1. Detectar duplicatas pré-existentes (se houver).
--   2. Manter o registro mais antigo de cada grupo; remover o resto.
--   3. Criar a constraint UNIQUE composta.
--
-- IMPORTANTE: rode em uma janela de baixa atividade. A passo 2 deleta linhas.
-- Faça backup do schema antes:
--
--   pg_dump -h <host> -U postgres -d postgres -t public.transactions > backup_transactions.sql
--
-- Versão: 2026-05-17
-- Autor: Verum Engineering
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Auditoria opcional: quantas duplicatas existem hoje? ─────────────────
-- Descomente para inspecionar antes de aplicar:
--
-- SELECT
--   blockchain_tx_hash,
--   user_id,
--   type,
--   COUNT(*) AS dup_count,
--   array_agg(id ORDER BY created_at) AS row_ids
-- FROM public.transactions
-- WHERE blockchain_tx_hash IS NOT NULL
-- GROUP BY blockchain_tx_hash, user_id, type
-- HAVING COUNT(*) > 1
-- ORDER BY dup_count DESC
-- LIMIT 50;


-- ── 2. Dedupe: manter apenas o registro mais antigo de cada (hash,user,type) ─
-- Cria CTE com IDs a deletar (todos exceto o primeiro de cada grupo).

WITH duplicates_to_remove AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY blockchain_tx_hash, user_id, type
        ORDER BY created_at ASC
      ) AS rn
    FROM public.transactions
    WHERE blockchain_tx_hash IS NOT NULL
  ) AS ranked
  WHERE rn > 1
)
DELETE FROM public.transactions
WHERE id IN (SELECT id FROM duplicates_to_remove);


-- ── 3. Constraint UNIQUE composta ───────────────────────────────────────────
-- Permite múltiplas linhas com blockchain_tx_hash NULL (TXs ainda não
-- confirmadas / records sem hash on-chain) — só restringe quando hash existe.
--
-- Postgres trata NULLs como distintos por default — não precisa de NULLS NOT
-- DISTINCT (que só está em PG 15+ e seria mais restritivo).

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_hash_user_type_uq
    UNIQUE (blockchain_tx_hash, user_id, type);

COMMENT ON CONSTRAINT transactions_hash_user_type_uq ON public.transactions IS
  'Idempotência: previne inserção duplicada do mesmo hash on-chain para o mesmo usuário/tipo. Permite NULL para TXs ainda não confirmadas.';


-- ── 4. Índice de apoio (já vem com o UNIQUE; documentado para clareza) ──────
-- A constraint UNIQUE cria automaticamente um btree index nas colunas listadas.
-- Não é necessário CREATE INDEX adicional.


-- ── 5. Idempotência via metadata.idempotency_key (NOVO) ─────────────────────
-- O service agora vai gravar um idempotency_key em metadata para correlação
-- mesmo quando hash ainda é null. Índice parcial acelera lookup.

CREATE INDEX IF NOT EXISTS transactions_idempotency_key_idx
  ON public.transactions ((metadata->>'idempotency_key'))
  WHERE metadata ? 'idempotency_key';

COMMENT ON INDEX public.transactions_idempotency_key_idx IS
  'Lookup por idempotency key gravado em metadata pelo client antes do hash on-chain.';


COMMIT;

-- ── ROLLBACK (manual, se necessário) ─────────────────────────────────────────
-- BEGIN;
--   ALTER TABLE public.transactions
--     DROP CONSTRAINT IF EXISTS transactions_hash_user_type_uq;
--   DROP INDEX IF EXISTS public.transactions_idempotency_key_idx;
-- COMMIT;
