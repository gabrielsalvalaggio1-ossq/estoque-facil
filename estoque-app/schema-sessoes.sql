-- schema-sessoes.sql
-- Sessões de login (email/senha e Google) — antes o cookie era gerado mas
-- nunca salvo em lugar nenhum, então não dava pra saber "de quem" era um
-- cookie de sessão. Isso resolve.
--
-- Como rodar:
--   npx wrangler d1 execute estoque-db --remote --file=./schema-sessoes.sql

CREATE TABLE IF NOT EXISTS sessoes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  expira_em  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessoes_email ON sessoes (email);
