-- schema-atividades.sql
-- Histórico de atividades: registra quem fez o quê, quando, dentro da
-- empresa (criar/editar/excluir produtos, vendas e movimentos; adicionar ou
-- remover gente da equipe; mudar ou cancelar o plano). É o que permite o
-- dono auditar exatamente o que cada pessoa da equipe fez.
--
-- Rode depois de todos os schemas anteriores (schema.sql, schema-empresas.sql,
-- schema-empresas-parte2.sql, schema-planos.sql, schema-sessoes.sql):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-atividades.sql

CREATE TABLE IF NOT EXISTS atividades (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,
  papel          TEXT,             -- papel de quem fez a ação, no momento em que fez
  acao           TEXT NOT NULL,    -- 'criou' | 'atualizou' | 'excluiu' | 'adicionou_membro' |
                                    -- 'removeu_membro' | 'mudou_plano' | 'cancelou_assinatura' | 'criou_empresa'
  store          TEXT,             -- 'produtos' | 'vendas' | 'movimentos' | 'membros' | 'assinatura' | 'empresa'
  registro_id    TEXT,             -- id do produto/venda/membro/empresa afetado, quando fizer sentido
  descricao      TEXT NOT NULL,    -- texto pronto em pt-BR pra exibir na tela ("Cadastrou produto \"Coca-Cola\"")
  criado_em      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Acelera a consulta mais comum: "últimas atividades dessa empresa",
-- que é sempre ordenada por data decrescente.
CREATE INDEX IF NOT EXISTS idx_atividades_empresa_data
  ON atividades (empresa_id, criado_em DESC);
