-- schema-recursos-planos.sql
-- Quinta etapa do banco: formaliza os LIMITES e RECURSOS de cada plano numa
-- coluna estruturada, pra existir UM lugar só de onde toda checagem de
-- permissão lê (nada de limite/feature espalhado em `if` pelo código).
--
-- Como rodar (depois de schema.sql .. schema-assinaturas.sql):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-recursos-planos.sql

ALTER TABLE planos ADD COLUMN limite_produtos INTEGER; -- NULL = ilimitado

-- FREE — 50 produtos, 1 usuário (já garantido por limite_membros=1), só o básico.
UPDATE planos SET
  limite_produtos = 50,
  limite_membros  = 1,
  recursos = '{
    "produtos_ilimitados": false,
    "vendas_ilimitadas": true,
    "clientes": false,
    "relatorios": false,
    "backup": false,
    "importacao": false,
    "equipe": false,
    "permissoes_papeis": false,
    "auditoria": false
  }'
WHERE id = 'free';

-- ESSENCIAL — produtos e vendas ilimitados, histórico de clientes, relatórios
-- e backup/exportação. Já permite uma pequena equipe (até 2 pessoas, igual
-- anunciado na página de planos) — mas todo mundo convidado entra como
-- "dono": diferenciar papéis (vendedor/estoquista com acesso limitado) e
-- auditoria completa continuam exclusivos do Pro.
UPDATE planos SET
  limite_produtos = NULL,
  limite_membros  = 2,
  recursos = '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "importacao": true,
    "equipe": true,
    "permissoes_papeis": false,
    "auditoria": false
  }'
WHERE id = 'essencial';

-- PRO — tudo do Essencial + equipe com papéis (dono/vendedor/estoquista) e
-- auditoria completa de quem fez o quê.
UPDATE planos SET
  limite_produtos = NULL,
  limite_membros  = 5,
  recursos = '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "importacao": true,
    "equipe": true,
    "permissoes_papeis": true,
    "auditoria": true
  }'
WHERE id = 'pro';