-- schema-planos-anuais.sql
-- Adiciona os planos anuais ao catálogo.
-- Rode APENAS em bancos que já têm o schema completo (schema-completo.sql
-- ou todos os schema-*.sql anteriores). Para banco do zero, use
-- schema-completo.sql — que já inclui esses planos.
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_BANCO --remote --file=./schema-planos-anuais.sql

INSERT OR IGNORE INTO planos
  (id, nome, preco_centavos, ciclo, limite_produtos, limite_membros, recursos, ativo)
VALUES
  -- Essencial Anual: mesmos recursos e limites do Essencial mensal.
  -- preco_centavos = 19900 (R$ 199,00 cobrado uma vez por ano).
  ('essencial_anual', 'Essencial Anual', 19900, 'anual', NULL, 2, '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": false,
    "auditoria": false
  }', 1),

  -- Pro Anual: mesmos recursos e limites do Pro mensal.
  -- preco_centavos = 39900 (R$ 399,00 cobrado uma vez por ano).
  ('pro_anual', 'Pro Anual', 39900, 'anual', NULL, 5, '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": true,
    "auditoria": true
  }', 1);
