-- schema-recursos-planos-fix.sql
-- Use este arquivo em vez do schema-recursos-planos.sql quando a coluna
-- `limite_produtos` JÁ existir na tabela `planos` (ou seja: você já rodou
-- o schema-recursos-planos.sql uma vez, com sucesso, antes). Ele só repete
-- os UPDATEs — que são idempotentes, seguro rodar quantas vezes precisar —
-- sem tentar recriar a coluna.
--
-- Como rodar:
--   npx wrangler d1 execute estoque-db --remote --file=./schema-recursos-planos-fix.sql

-- FREE — 50 produtos, 1 usuário, só o básico.
UPDATE planos SET
  limite_produtos = 50,
  limite_membros  = 1,
  recursos = '{
    "produtos_ilimitados": false,
    "vendas_ilimitadas": true,
    "clientes": false,
    "relatorios": false,
    "backup": false,
    "equipe": false,
    "permissoes_papeis": false,
    "auditoria": false
  }'
WHERE id = 'free';

-- ESSENCIAL — produtos e vendas ilimitados, clientes, relatórios, backup, e
-- equipe de até 2 pessoas (todas entram como "dono", sem papel diferenciado).
UPDATE planos SET
  limite_produtos = NULL,
  limite_membros  = 2,
  recursos = '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": false,
    "auditoria": false
  }'
WHERE id = 'essencial';

-- PRO — tudo do Essencial + equipe até 5, papéis diferenciados e auditoria.
UPDATE planos SET
  limite_produtos = NULL,
  limite_membros  = 5,
  recursos = '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": true,
    "auditoria": true
  }'
WHERE id = 'pro';
