-- Tabela criada automaticamente pelo backend na primeira solicitação de
-- recuperação de senha (CREATE TABLE IF NOT EXISTS em [[path]].js).
-- Execute este script manualmente se preferir criar antes da primeira chamada.

CREATE TABLE IF NOT EXISTS tokens_recuperacao (
  token_hash   TEXT PRIMARY KEY,       -- SHA-256 do token (nunca guardamos o token em texto puro)
  usuario_id   INTEGER NOT NULL,       -- FK para usuarios.id
  expira_em    TEXT NOT NULL,          -- ISO 8601 — token válido por 1 hora
  usado        INTEGER NOT NULL DEFAULT 0,  -- 0 = válido, 1 = já utilizado (não reutilizável)
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índice para limpeza periódica de tokens expirados
CREATE INDEX IF NOT EXISTS idx_tokens_recuperacao_usuario
  ON tokens_recuperacao (usuario_id);

CREATE INDEX IF NOT EXISTS idx_tokens_recuperacao_expira
  ON tokens_recuperacao (expira_em);
