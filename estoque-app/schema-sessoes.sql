-- schema-sessoes.sql (ATUALIZADO — versão anterior estava obsoleta)
--
-- Estrutura real da tabela `sessoes`, compatível com functions/api/auth/[[path]].js.
-- O arquivo original criava colunas (id, email, criado_em, expira_em) que não
-- correspondem ao código. Esta versão corrigida reflete o schema real em produção.
--
-- Como rodar (apenas em banco novo — banco existente já tem a tabela certa):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-sessoes.sql

CREATE TABLE IF NOT EXISTS sessoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,      -- SHA-256 do token real (o token em si nunca fica no banco)
  expires_at  TEXT NOT NULL,             -- ISO 8601, ex: "2026-08-07T14:23:00.000Z"
  ip          TEXT NOT NULL DEFAULT '',  -- IP de quem criou a sessão (auditoria)
  user_agent  TEXT NOT NULL DEFAULT '',  -- User-Agent de quem criou a sessão (auditoria)
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Acelera a consulta mais frequente: buscar sessão pelo hash do token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessoes_token_hash ON sessoes (token_hash);

-- Acelera a busca de "todas as sessões de um usuário" (ex: logout de todos os dispositivos).
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_id ON sessoes (usuario_id);
