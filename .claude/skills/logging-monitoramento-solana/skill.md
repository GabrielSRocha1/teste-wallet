---
name: logging-monitoramento-solana
description: Implementa logging estruturado, rastreamento de erros e observabilidade em backend Node.js com Winston, Sentry e métricas de saúde
---

# Logging e Monitoramento Solana

## Objetivo
Tornar o backend observável e rastreável em produção.

## Instruções
Quando ativada, configure:
1. **Logging Estruturado**: Winston/Pino com formato JSON
2. **Níveis**: error, warn, info, debug, verbose
3. **Contexto**: Request ID, user agent, IP, timestamp
4. **Sentry**: Integração para rastreamento de erros
5. **Métricas**: Tempo de resposta, throughput, error rate
6. **Alertas**: Notificação em erros críticos ou queda
7. **Tracing**: Rastreamento de requisições entre serviços

## Exemplos
- "Configure logging estruturado com Winston"
- "Integre Sentry para rastreamento de erros"
- "Crie dashboard de métricas do backend"

## Guidelines
- Nunca logue dados sensíveis (private keys, seeds, senhas)
- Use correlation IDs para rastrear requisições
- Rotação de logs automática (evite disco cheio)
- Logs assíncronos (não bloqueiem a thread principal)
- Diferencie logs de desenvolvimento e produção
