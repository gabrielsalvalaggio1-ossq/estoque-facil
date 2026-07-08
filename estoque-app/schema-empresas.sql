-- schema-empresas.sql
-- Segunda etapa do banco: introduz "empresas" e "membros" para suportar
-- múltiplos usuários compartilhando o mesmo estoque, cada um com um papel
-- (dono, vendedor, estoquista).
--
-- Como rodar (depois do schema.sql original já ter sido aplicado):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-empresas.sql

CREATE TABLE IF NOT EXISTS empresas (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  dono_email TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS membros (
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,
  papel          TEXT NOT NULL, -- 'dono' | 'vendedor' | 'estoquista'
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (empresa_id, usuario_email)
);

-- Acelera "a quais empresas esse e-mail pertence e com qual papel".
CREATE INDEX IF NOT EXISTS idx_membros_usuario ON membros (usuario_email);

-- Adiciona a coluna nova na tabela que já existe. Mantemos usuario_email por
-- enquanto (não apagamos), tanto por segurança da migração quanto porque
-- ainda serve como "quem criou originalmente" em registros antigos.
ALTER TABLE registros ADD COLUMN empresa_id TEXT;

-- Acelera a consulta que passa a ser a mais comum a partir de agora:
-- "todos os registros de uma empresa, de um store".
CREATE INDEX IF NOT EXISTS idx_registros_empresa_store
  ON registros (empresa_id, store);
