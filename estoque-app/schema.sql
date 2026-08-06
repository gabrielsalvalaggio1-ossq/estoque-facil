-- schema.sql
-- Estrutura do banco D1 para o "Meu Estoque" multi-usuário.
--
-- Guarda cada registro (produto, venda, movimento) como um JSON dentro da
-- coluna `dados`, igual ao objeto que hoje já é salvo no IndexedDB. Isso
-- evita ter que recriar uma tabela SQL por tipo de dado e manter três
-- schemas sincronizados com produtos.js/vendas.js — a mesma ideia de
-- "objectStore genérico" que o db.js original já usava, só que compartilhada
-- na nuvem e isolada por usuário.
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --file=./schema.sql
-- (troque NOME_DO_SEU_BANCO pelo nome que você der ao banco D1 no dashboard)

CREATE TABLE IF NOT EXISTS registros (
  id             TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,
  store          TEXT NOT NULL, -- 'produtos' | 'vendas' | 'movimentos'
  dados          TEXT NOT NULL, -- JSON do registro completo
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, usuario_email, store)
);

-- Acelera a consulta mais comum: "todos os registros de um usuário, de um store".
CREATE INDEX IF NOT EXISTS idx_registros_usuario_store
  ON registros (usuario_email, store);
