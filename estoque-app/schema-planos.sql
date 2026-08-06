-- schema-planos.sql
-- Terceira etapa do banco: introduz o campo "plano" na empresa, usado pra
-- limitar quantos membros ela pode ter (grátis vs pago).
--
-- Como rodar (depois de schema.sql, schema-empresas.sql e schema-empresas-parte2.sql):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-planos.sql

ALTER TABLE empresas ADD COLUMN plano TEXT NOT NULL DEFAULT 'free';

-- Garante que empresas já existentes (criadas via SQL manual antes dessa
-- feature) fiquem explicitamente no plano free.
UPDATE empresas SET plano = 'free' WHERE plano IS NULL OR plano = '' OR plano = 'gratis';
