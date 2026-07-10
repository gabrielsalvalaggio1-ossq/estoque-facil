-- schema-mp-colunas.sql
-- Adiciona as colunas de rastreio do Mercado Pago na tabela assinaturas.
-- Execute APENAS em bancos que NÃO foram criados a partir do schema-completo.sql
-- atualizado (versão que já inclui mp_preapproval_id e mp_plano_solicitado).
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_BANCO --remote --file=./schema-mp-colunas.sql

ALTER TABLE assinaturas ADD COLUMN mp_preapproval_id   TEXT;
ALTER TABLE assinaturas ADD COLUMN mp_plano_solicitado TEXT;
