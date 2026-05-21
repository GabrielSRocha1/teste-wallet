---
name: segurança-backend-solana
description: Implementa segurança enterprise em backend Node.js: stateless, sem armazenamento de chaves, rate limiting, sanitização e proteção contra abuso
---

# Segurança Backend Solana

## Objetivo
Tornar o backend altamente seguro e resistente a ataques.

## Instruções
Quando ativada, garanta:
1. **Stateless**: Nenhum estado de sessão no servidor (use JWT)
2. **Zero Secrets**: NUNCA armazenar private key, seed phrase ou senhas em texto
3. **Rate Limiting**: Proteção contra brute force e spam (express-rate-limit)
4. **Sanitização**: Limpar todos inputs (helmet, express-mongo-sanitize)
5. **Headers Seguros**: CSP, HSTS, X-Frame-Options, etc.
6. **CORS**: Configuração restrita de origens permitidas
7. **Variáveis**: Todas as secrets em .env, nunca no código

## Exemplos
- "Implemente rate limiting e segurança de headers neste backend"
- "Garanta que meu backend seja 100% stateless"
- "Adicione proteção contra injeção e XSS"

## Guidelines
- NUNCA sugere armazenar chaves privadas no banco de dados
- Use bcrypt/Argon2 para hashes (nunca MD5/SHA1)
- Implemente circuit breaker para chamadas externas
- Logs devem mascarar dados sensíveis
- Sempre valide e sanitize inputs antes de processar
