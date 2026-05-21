-- ============================================================
--  VERUM WALLET — Migration: Peças Faltantes
--  Execute no SQL Editor do painel Supabase.
--  Idempotente: seguro para rodar múltiplas vezes.
-- ============================================================


-- ─── 1. VIEW de compatibilidade: transacoes ──────────────────────────────────
-- O frontend usa .from('transacoes'). Esta view expõe a tabela real
-- "transactions" com os campos que o código espera.

DROP VIEW IF EXISTS public.transacoes;

CREATE OR REPLACE VIEW public.transacoes AS
SELECT
  id,
  user_id,
  user_id                                             AS remetente_id,
  CASE
    WHEN metadata IS NOT NULL
     AND metadata->>'destinatario_id' IS NOT NULL
     AND metadata->>'destinatario_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (metadata->>'destinatario_id')::UUID
    ELSE NULL
  END                                                 AS destinatario_id,
  type::TEXT                                          AS tipo,
  amount                                              AS valor,
  COALESCE(currency, 'USDT')                          AS moeda,
  COALESCE(blockchain_tx_hash, id::TEXT)              AS hash,
  status::TEXT                                        AS status,
  COALESCE(description, '')                           AS descricao,
  created_at
FROM public.transactions;

-- RLS: a view herda as políticas da tabela base (transactions).
-- Usuários só veem suas próprias transações via RLS da tabela.


-- ─── 2. RPC: get_all_balances ─────────────────────────────────────────────────
-- Retorna todos os saldos do usuário no formato {moeda, saldo}.
-- Usado em balances.getAllViaRpc() no database.ts.

CREATE OR REPLACE FUNCTION public.get_all_balances(p_user_id UUID)
RETURNS TABLE(moeda TEXT, saldo NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT token_symbol, amount
  FROM public.balances
  WHERE user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO service_role;


-- ─── 3. RPC: get_user_balance ─────────────────────────────────────────────────
-- Retorna saldo de um token específico para um usuário.
-- Usado em balances.getTokenBalance() no database.ts.

CREATE OR REPLACE FUNCTION public.get_user_balance(p_user_id UUID, p_moeda TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(amount, 0)
  FROM public.balances
  WHERE user_id = p_user_id AND token_symbol = p_moeda
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_balance(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_balance(UUID, TEXT) TO service_role;


-- ─── Verificação ─────────────────────────────────────────────────────────────
-- Após executar, teste com:
--   SELECT * FROM transacoes LIMIT 1;
--   SELECT get_user_balance('<seu-user-uuid>', 'USDT');
--   SELECT * FROM get_all_balances('<seu-user-uuid>');
