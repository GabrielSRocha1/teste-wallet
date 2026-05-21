---
name: websockets-solana
description: Implementa WebSockets para eventos em tempo real da Solana: monitoramento de transações, atualização de saldo e logs de blockchain via Helius Enhanced WebSockets
---

# WebSockets Solana Tempo Real

## Objetivo
Adicionar funcionalidade em tempo real para monitoramento blockchain.

## Instruções
Quando ativada, desenvolva:
1. **Conexão WS**: WebSocket com Helius Enhanced API
2. **Monitoramento**: Escutar transações específicas por address
3. **Saldo Real-time**: Atualizações automáticas de balance changes
4. **Logs**: Subscribe a program logs (anchor logs)
5. **Reconexão**: Auto-reconnect em queda de conexão
6. **Broadcast**: Enviar eventos para clientes via Socket.io/ws

## Exemplos
- "Implemente WebSocket para monitorar transações de um endereço"
- "Crie sistema de notificação em tempo real de saldo"
- "Configure reconexão automática do WebSocket Solana"

## Guidelines
- Use Helius Enhanced WebSockets (mais estável que RPC padrão)
- Implemente heartbeat para manter conexão viva
- Limite número de subscriptions por conexão
- Trate reconexão com exponential backoff
- Use Redis Pub/Sub se precisar escalar horizontalmente
