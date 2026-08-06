-- schema-fiados.sql
-- Tabela para registrar unificações de nomes de clientes no fiado.
-- Quando o usuário confirma que "Demetrio", "demetrio" e "Deemetrio" são
-- a mesma pessoa, o sistema guarda aqui a relação entre os nomes originais
-- e o nome canônico (principal), para evitar re-sugerir a mesma duplicata.
--
-- Como rodar (depois de schema.sql e schema-empresas.sql):
--   npx wrangler d1 execute NOME_DO_BANCO --remote --file=./schema-fiados.sql

CREATE TABLE IF NOT EXISTS fiado_unificacoes (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL,
  nome_canonical TEXT NOT NULL,  -- nome escolhido como principal
  nomes_aliases  TEXT NOT NULL,  -- JSON array com os nomes alternativos unificados
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  criado_por     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fiado_unificacoes_empresa
  ON fiado_unificacoes (empresa_id);

-- Tabela para registrar pares de nomes que o usuário confirmou como
-- pessoas DIFERENTES (evita re-sugerir a mesma combinação).
CREATE TABLE IF NOT EXISTS fiado_nao_unificar (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL,
  nome_a         TEXT NOT NULL,
  nome_b         TEXT NOT NULL,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fiado_nao_unificar_empresa
  ON fiado_nao_unificar (empresa_id);
