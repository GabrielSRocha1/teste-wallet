-- ============================================================================
-- FIX: get_all_balances assumia schema horizontal (usdt_balance, usdc_balance, ...),
-- mas a tabela `balances` no banco usa schema vertical (uma linha por token).
--
-- Sintoma: `record "r" has no field "usdt_balance"` ao chamar a RPC.
--
-- Esta migration reescreve a função para usar o schema vertical real.
-- Aplique no SQL Editor do Supabase dashboard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_all_balances(p_user_id UUID)
RETURNS TABLE(moeda TEXT, saldo NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    UPPER(b.token_symbol)::TEXT AS moeda,
    COALESCE(b.amount, 0)::NUMERIC AS saldo
  FROM public.balances b
  WHERE b.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_balances(UUID) TO authenticated, service_role;
