---
name: endpoints-api-solana
description: Cria/otimiza endpoints REST para wallet blockchain: balance, transactions, send transaction e health check com validação e tratamento de erros
---

# Endpoints API Solana

## Objetivo
Garantir endpoints funcionais e seguros para operações de wallet.

## Instruções
Quando ativada, implemente/otimize:
1. **GET /wallet/balance/:address**
   - Validar formato do address (base58, 32-44 chars)
   - Retornar saldo em SOL e lamports
   - Cache por 30 segundos

2. **GET /wallet/transactions/:address**
   - Paginação (limit/offset)
   - Filtros opcionais (before, until, type)
   - Retornar parsed transactions

3. **POST /transaction/send**
   - Validar transaction payload
   - Simular antes de enviar (simulateTransaction)
   - Retornar signature e status

4. **GET /health**
   - Status do servidor
   - Status da conexão RPC
   - Uptime e métricas básicas

## Exemplos
- "Crie endpoints REST completos para operação de wallet"
- "Otimize estes endpoints para melhor performance"
- "Adicione validação e tratamento de erros nos endpoints"

## Guidelines
- Use express-validator para validação de inputs
- Retorne códigos HTTP apropriados (200, 400, 404, 429, 500)
- Estrutura de resposta padronizada: `{success, data, error, timestamp}`
- Nunca exponha stack trace em erros de produção
- Documente com JSDoc ou Swagger
