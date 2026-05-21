---
name: performance-cache-solana
description: Otimiza performance do backend com Redis: cache de saldos, redução de chamadas RPC, resposta <300ms e estratégias de invalidação
---

# Performance e Cache Solana

## Objetivo
Deixar o backend rápido e escalável com cache inteligente.

## Instruções
Quando ativada, implemente:
1. **Redis**: Configuração de conexão e estrutura de dados
2. **Cache Strategy**:
   - Saldo: TTL 60s (blockchain muda rápido)
   - Transações: TTL 300s (histórico é estático)
   - Metadata tokens: TTL 1h (quase imutável)
3. **Invalidação**: Limpar cache em operações de escrita
4. **Circuit Breaker**: Evitar cascade failure em RPC
5. **Compressão**: Gzip/brotli em respostas grandes
6. **Monitoramento**: Track de hit rate do cache

## Exemplos
- "Implemente Redis cache para reduzir chamadas RPC"
- "Otimize tempo de resposta para menos de 300ms"
- "Configure estratégia de cache para saldos e transações"

## Guidelines
- Use ioredis ou node-redis (clientes modernos)
- Sempre trate falha do Redis (graceful degradation)
- Cache aside pattern (verifica cache, se não busca e guarda)
- Evite cache de dados sensíveis
- Monitore memory usage do Redis
