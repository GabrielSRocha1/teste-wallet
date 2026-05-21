---
name: auditoria-backend-solana
description: Audita backend Node.js existente identificando falhas de segurança, código mal implementado, problemas de performance e erros silenciosos em sistemas blockchain
---

# Auditoria Backend Solana

## Objetivo
Analisar backend Node.js atual e identificar todos os problemas sem modificar código.

## Instruções
Quando ativada, realize auditoria completa focando em:
1. **Segurança**: Exposição de dados sensíveis, falta de validação, vulnerabilidades
2. **Código**: Funções mal implementadas, código redundante, anti-padrões
3. **Performance**: Gargalos, chamadas desnecessárias, memory leaks
4. **Edge Cases**: Erros silenciosos, falta de tratamento de exceções
5. **Arquitetura**: Violações de SOLID, acoplamento excessivo

## Exemplos
- "Audite este código backend e liste todas as falhas de segurança"
- "Analise essa API Node.js e encontre problemas de performance"
- "Revise este código e identifique edge cases não tratados"

## Guidelines
- NÃO modifique o código - apenas identifique problemas
- Liste problemas por severidade (CRÍTICO, ALTO, MÉDIO, BAIXO)
- Forneça referências de boas práticas para cada problema
- Foque exclusivamente em backend (ignore frontend completamente)
- Priorize segurança de dados blockchain (private keys, seeds)
