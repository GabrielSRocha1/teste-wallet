# Migrations Verum

Estas migrations são aplicadas **manualmente** no painel Supabase
(SQL Editor → New query → cole o conteúdo do arquivo → Run).

Ordem cronológica importa. Arquivos numerados (`NNN_descrição.sql`).

## Como aplicar

1. **Backup primeiro:**
   ```bash
   pg_dump -h <db-host> -U postgres -d postgres -t <table> > backup_<table>_<date>.sql
   ```
   Ou via Supabase: Project Settings → Database → Backups → Manual backup.

2. **Auditoria pré-execução:** cada arquivo tem uma seção comentada para
   inspecionar o estado atual (linhas duplicadas, conflitos, etc.). Rode
   essas queries primeiro e revise o resultado.

3. **Aplicação:** rode o `BEGIN ... COMMIT` inteiro. Se algo der errado,
   `ROLLBACK;` antes do commit reverte tudo.

4. **Verificação pós-execução:** cada migration documenta os checks a fazer.

## Lista de migrations

| Arquivo | Resolve | Risco |
|---------|---------|-------|
| `001_transactions_idempotency.sql` | Diagnóstico #9 — dup de TXs no retry | BAIXO (deleta duplicatas existentes; backup antes) |

## Rollback

Cada migration tem seção `ROLLBACK` comentada no final.
