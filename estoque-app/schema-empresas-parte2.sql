-- schema-empresas-parte2.sql
-- ATENÇÃO: rode isso só depois de:
--   1. schema-empresas.sql
--   2. node migrar-para-empresas.js NOME_DO_SEU_BANCO  (todo registro já tem empresa_id preenchido)
--
-- Por quê: a tabela `registros` original tinha chave primária
-- (id, usuario_email, store) — isso fazia sentido quando cada e-mail era um
-- "cofre" isolado. Agora que várias pessoas (dono/vendedor/estoquista)
-- podem editar o mesmo registro dentro da mesma empresa, isso quebra: uma
-- atualização feita por uma pessoa diferente de quem criou o registro não
-- bateria com a chave antiga e criaria uma linha duplicada em vez de
-- atualizar a existente. A chave certa agora é (id, empresa_id, store).
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-empresas-parte2.sql

CREATE TABLE registros_novo (
  id             TEXT NOT NULL,
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL, -- quem criou/editou por último (auditoria)
  store          TEXT NOT NULL,
  dados          TEXT NOT NULL,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, empresa_id, store)
);

INSERT INTO registros_novo (id, empresa_id, usuario_email, store, dados, criado_em, atualizado_em)
SELECT id, empresa_id, usuario_email, store, dados, criado_em, atualizado_em
FROM registros
WHERE empresa_id IS NOT NULL;

DROP TABLE registros;
ALTER TABLE registros_novo RENAME TO registros;

CREATE INDEX IF NOT EXISTS idx_registros_empresa_store ON registros (empresa_id, store);
