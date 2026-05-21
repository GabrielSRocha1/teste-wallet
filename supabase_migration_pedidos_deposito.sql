-- ============================================================
-- MIGRAÇÃO: Integração Ramp Network / Compra Crypto via PIX
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Adiciona chave pública Solana na tabela de usuários
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS public_key TEXT;

-- 2. Cria tabela de pedidos de depósito
CREATE TABLE IF NOT EXISTS pedidos_deposito (
  id                TEXT PRIMARY KEY,          -- Ex: "pix-{user_id}-{timestamp}"
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key        TEXT,                      -- Endereço Solana destino
  amount_brl        NUMERIC(12,2) NOT NULL,    -- Valor pago em BRL
  amount_sol        NUMERIC(18,6),             -- SOL a enviar (calculado pela Ramp)
  sol_price_brl     NUMERIC(12,2),             -- Cotação SOL/BRL no momento do pedido
  payment_method    TEXT NOT NULL DEFAULT 'pix', -- 'pix' | 'transfer'
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'delivered' | 'cancelled'
  confirmation_level INT NOT NULL DEFAULT 0,   -- 0=pendente, 1=confirmado, 2=finalizado
  pix_code          TEXT,                      -- Código PIX usado
  tx_signature      TEXT,                      -- Assinatura da tx Solana após envio
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_pedidos_deposito_user_id ON pedidos_deposito(user_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_deposito_status  ON pedidos_deposito(status);

-- 4. Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedidos_deposito_updated_at ON pedidos_deposito;
CREATE TRIGGER trg_pedidos_deposito_updated_at
  BEFORE UPDATE ON pedidos_deposito
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. Row Level Security
ALTER TABLE pedidos_deposito ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado só vê/cria seus próprios pedidos
CREATE POLICY "Usuário lê próprios pedidos"
  ON pedidos_deposito FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Usuário cria próprio pedido"
  ON pedidos_deposito FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Somente service_role pode atualizar (para o backend confirmar pagamento)
CREATE POLICY "Service role atualiza pedidos"
  ON pedidos_deposito FOR UPDATE
  USING (auth.role() = 'service_role');
