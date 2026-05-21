# Skill: Integração Helius — Verum Wallet

## Configuração Ativa

### API Key
- **MCP Status:** Configurada e ativa
- **Frontend Env:** `EXPO_PUBLIC_HELIUS_RPC_URL`, `EXPO_PUBLIC_SOLANA_RPC_MAINNET/DEVNET`
- **Backend Env:** `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `HELIUS_WEBHOOK_SECRET`

### Webhooks Registrados
1. **Mainnet** (enhanced): `0295b958-65b8-4694-aef3-c2e10199ddd7`
   - URL: `https://verumvesting.mastter.digital/api/webhooks/helius`
   - Monitora: `DE9UHAY6UhxYfMTGBwzCoDRHphV6Xrcee8z1L8xJqydy`

2. **Devnet** (enhancedDevnet): `701ac96c-58c0-4504-a204-c15d23b1dcb5`
   - URL: `https://verumvesting.mastter.digital/api/webhooks/helius`
   - Monitora: `HMqYLNw1ABgVeFcP2PmwDv6bibcm9y318aTo2g25xQMm`

## Uso no Backend

### 1. Preços (PriceService)
- `getAssetBatch` via DAS API para precos de tokens
- Circuit breaker: `helius-das` (4 falhas → 20s reset)
- Polling: cada 4 segundos

### 2. Webhook Processing
- `POST /webhook/solana` → validação `Bearer HELIUS_WEBHOOK_SECRET`
- Enfileira em BullMQ `helius-events`
- `HeliusProcessor` processa: nativeTransfers + tokenTransfers
- Cria transação no DB + atualiza saldo + notificação + WS emit

### 3. Balance Sync
- `BalanceSyncProcessor` conecta via `HELIUS_RPC_URL`
- Busca SOL nativo + SPL tokens (getAccount)
- Upsert atômico no Prisma

### 4. Treasury Fulfillment
- `WebhookService.handleTreasuryDeposit` para swaps on-chain
- Usa `HELIUS_RPC_URL` para enviar tokens da treasury

## Uso no Frontend

### TransactionService
- `rpcForNetwork()` → `EXPO_PUBLIC_SOLANA_RPC_MAINNET` ou `DEVNET`
- Todas as chamadas RPC (getBalance, getTokenAccounts, sendRawTransaction)
- Jupiter swaps via Helius RPC confirmations

## Regras
- **NUNCA** misturar endpoints mainnet/devnet
- Sempre usar circuit breaker para chamadas externas
- Idempotência obrigatória via `webhookLog.idempotencyKey`
- BullMQ retry com backoff exponencial (3 tentativas)