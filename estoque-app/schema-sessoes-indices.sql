-- schema-sessoes-indices.sql
-- A tabela `sessoes` já existe no seu banco (criada antes, com um desenho
-- mais seguro do que eu tinha assumido: token com hash, ligado por
-- usuario_id). Isso só adiciona os índices que faltam pras consultas de
-- login ficarem rápidas.
--
-- Como rodar:
--   npx wrangler d1 execute estoque-db --remote --file=./schema-sessoes-indices.sql

CREATE INDEX IF NOT EXISTS idx_sessoes_token_hash ON sessoes (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_id ON sessoes (usuario_id);
