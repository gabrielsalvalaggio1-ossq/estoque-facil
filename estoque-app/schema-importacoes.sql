-- schema-importacoes.sql
-- Módulo de Importação de Produtos.
--
-- Segue exatamente o mesmo padrão multi-tenant do resto do banco (ver
-- schema.sql / schema-empresas.sql): tudo isolado por empresa_id, sem
-- nenhuma tabela nova de "organização" — nesse projeto a organização já
-- é a "empresa" existente.

-- Uma linha por execução de importação (upload processado, com ou sem
-- erros). Não guarda o arquivo em si — só o resumo do resultado, pra
-- exibir o histórico e permitir auditoria de quem importou o quê.
CREATE TABLE IF NOT EXISTS historico_importacoes (
  id TEXT PRIMARY KEY,
  empresa_id TEXT NOT NULL,
  usuario_email TEXT NOT NULL,
  origem TEXT NOT NULL,              -- 'xlsx' | 'csv' | 'xml_nfe'
  nome_arquivo TEXT NOT NULL,
  total_registros INTEGER NOT NULL DEFAULT 0,
  criados INTEGER NOT NULL DEFAULT 0,
  atualizados INTEGER NOT NULL DEFAULT 0,
  ignorados INTEGER NOT NULL DEFAULT 0,
  com_erro INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'concluida', -- 'concluida' | 'concluida_com_erros' | 'cancelada'
  detalhes_erros TEXT,               -- JSON com a lista de erros (linha + motivo), pra exportar depois
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_historico_importacoes_empresa
  ON historico_importacoes (empresa_id, criado_em DESC);

-- Mapeamento de colunas salvo por empresa + origem, pra próxima importação
-- do mesmo tipo de planilha já vir com as colunas certas pré-preenchidas.
-- Uma linha por (empresa_id, origem) — salvar de novo substitui o anterior.
CREATE TABLE IF NOT EXISTS mapeamentos_importacao (
  empresa_id TEXT NOT NULL,
  origem TEXT NOT NULL,               -- 'xlsx' | 'csv'  (XML da NF-e é fixo, não usa mapeamento manual)
  mapeamento TEXT NOT NULL,           -- JSON: { "nome": "Nome do produto", "preco": "Valor unitário", ... }
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (empresa_id, origem),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);
