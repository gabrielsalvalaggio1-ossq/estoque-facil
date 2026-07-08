-- schema-completo.sql — MEV (Meu Estoque e Vendas)
-- Fonte da verdade para criação do banco D1 do zero.
-- Substitui os 9+ arquivos de schema separados que existiam antes.
--
-- ORDEM IMPORTA: as tabelas com FOREIGN KEY devem vir depois das tabelas
-- que elas referenciam. A ordem aqui é a correta.
--
-- Como usar (banco novo):
--   npx wrangler d1 execute NOME_DO_BANCO --remote --file=./schema-completo.sql
--
-- Para banco existente: NÃO rode este arquivo — ele usa CREATE TABLE IF NOT EXISTS
-- e não vai alterar tabelas já existentes. Para migrações incrementais, os
-- arquivos de schema individuais ainda existem como histórico.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. USUÁRIOS — quem faz login. Independente de empresa.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT NOT NULL DEFAULT 'Usuário',
  email               TEXT NOT NULL UNIQUE,
  senha_hash          TEXT NOT NULL,               -- 'pbkdf2:…' | 'google' (OAuth)
  cargo               TEXT NOT NULL DEFAULT 'dono',
  status_assinatura   TEXT,                        -- cache do status da assinatura da empresa
  plano_atual         TEXT,                        -- cache do plano atual
  criado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);


-- ===========================================================================
-- 2. SESSÕES — tokens de autenticação (HttpOnly cookie).
--    token_hash = SHA-256 do token real; o token em si nunca fica no banco.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS sessoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,         -- ISO 8601
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessoes_token_hash ON sessoes (token_hash);
CREATE        INDEX IF NOT EXISTS idx_sessoes_usuario_id ON sessoes (usuario_id);


-- ===========================================================================
-- 3. RATE LIMITING — tentativas de autenticação por chave (IP ou e-mail).
--    Criada dinamicamente pelo worker, mas incluída aqui para banco do zero.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tentativas_auth (
  chave         TEXT PRIMARY KEY,
  tentativas    INTEGER NOT NULL DEFAULT 0,
  janela_inicio INTEGER NOT NULL        -- unix timestamp em ms
);


-- ===========================================================================
-- 4. EMPRESAS — o tenant. Todos os dados são isolados por empresa_id.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS empresas (
  id         TEXT PRIMARY KEY,          -- UUID
  nome       TEXT NOT NULL,
  dono_email TEXT NOT NULL,
  plano      TEXT NOT NULL DEFAULT 'free', -- cache; fonte da verdade: tabela assinaturas
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ===========================================================================
-- 5. MEMBROS — vínculo entre usuário (e-mail) e empresa, com papel.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS membros (
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,
  papel          TEXT NOT NULL,   -- 'dono' | 'vendedor' | 'estoquista'
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (empresa_id, usuario_email),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_membros_usuario ON membros (usuario_email);


-- ===========================================================================
-- 6. REGISTROS — armazena produtos, vendas e movimentos como JSON.
--    Chave composta: (id, empresa_id, store) — sem conflito entre empresas.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS registros (
  id             TEXT NOT NULL,
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,   -- quem criou/editou por último (auditoria)
  store          TEXT NOT NULL,   -- 'produtos' | 'vendas' | 'movimentos'
  dados          TEXT NOT NULL,   -- JSON completo do registro
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, empresa_id, store),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_registros_empresa_store ON registros (empresa_id, store);


-- ===========================================================================
-- 7. PLANOS — catálogo de planos disponíveis. Não é dado de conta.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS planos (
  id               TEXT PRIMARY KEY,    -- 'free' | 'essencial' | 'pro'
  nome             TEXT NOT NULL,
  preco_centavos   INTEGER NOT NULL,    -- 0 = gratuito
  ciclo            TEXT NOT NULL DEFAULT 'mensal',
  limite_produtos  INTEGER,             -- NULL = ilimitado
  limite_membros   INTEGER NOT NULL,
  recursos         TEXT NOT NULL,       -- JSON com flags de funcionalidades
  ativo            INTEGER NOT NULL DEFAULT 1,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dados dos planos (INSERT OR IGNORE para não sobrescrever customizações)
INSERT OR IGNORE INTO planos (id, nome, preco_centavos, ciclo, limite_produtos, limite_membros, recursos) VALUES
  ('free', 'MEV Free', 0, 'mensal', 50, 1, '{
    "produtos_ilimitados": false,
    "vendas_ilimitadas": true,
    "clientes": false,
    "relatorios": false,
    "backup": false,
    "equipe": false,
    "permissoes_papeis": false,
    "auditoria": false
  }'),
  ('essencial', 'Essencial', 1990, 'mensal', NULL, 2, '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": false,
    "auditoria": false
  }'),
  ('pro', 'Pro', 3990, 'mensal', NULL, 5, '{
    "produtos_ilimitados": true,
    "vendas_ilimitadas": true,
    "clientes": true,
    "relatorios": true,
    "backup": true,
    "equipe": true,
    "permissoes_papeis": true,
    "auditoria": true
  }');


-- ===========================================================================
-- 8. ASSINATURAS — ciclo de vida do plano por empresa.
--    Trocar de plano ou reativar cria uma linha nova (histórico preservado).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS assinaturas (
  id                      TEXT PRIMARY KEY,   -- 'sub-<uuid>'
  empresa_id              TEXT NOT NULL,
  usuario_id              INTEGER NOT NULL,   -- responsável financeiro (dono)
  plano_id                TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'ACTIVE',
                          -- 'FREE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  gateway_subscription_id TEXT,              -- id no gateway de pagamento (Stripe/etc.)
  data_inicio             TEXT NOT NULL DEFAULT (datetime('now')),
  data_expiracao          TEXT,              -- NULL = sem vencimento (plano free)
  cancelado_em            TEXT,
  motivo_cancelamento     TEXT,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (plano_id)   REFERENCES planos(id)
);

CREATE INDEX IF NOT EXISTS idx_assinaturas_empresa ON assinaturas (empresa_id, criado_em DESC);


-- ===========================================================================
-- 9. ATIVIDADES — trilha de auditoria de todas as ações relevantes.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS atividades (
  id             TEXT PRIMARY KEY,
  empresa_id     TEXT NOT NULL,
  usuario_email  TEXT NOT NULL,
  papel          TEXT,
  acao           TEXT NOT NULL,
  store          TEXT,
  registro_id    TEXT,
  descricao      TEXT NOT NULL,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_atividades_empresa_data ON atividades (empresa_id, criado_em DESC);


-- ===========================================================================
-- 10. IMPORTAÇÕES — histórico de importações de produtos (CSV/XLSX/XML).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS historico_importacoes (
  id              TEXT PRIMARY KEY,
  empresa_id      TEXT NOT NULL,
  usuario_email   TEXT NOT NULL,
  origem          TEXT NOT NULL,          -- 'xlsx' | 'csv' | 'xml_nfe' | 'pdf_danfe'
  nome_arquivo    TEXT NOT NULL,
  total_registros INTEGER NOT NULL DEFAULT 0,
  criados         INTEGER NOT NULL DEFAULT 0,
  atualizados     INTEGER NOT NULL DEFAULT 0,
  ignorados       INTEGER NOT NULL DEFAULT 0,
  com_erro        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'concluida',
  detalhes_erros  TEXT,                   -- JSON com lista de erros
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_historico_importacoes_empresa
  ON historico_importacoes (empresa_id, criado_em DESC);


-- ===========================================================================
-- 11. MAPEAMENTOS DE IMPORTAÇÃO — salva o mapeamento de colunas por empresa.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS mapeamentos_importacao (
  empresa_id    TEXT NOT NULL,
  origem        TEXT NOT NULL,    -- 'xlsx' | 'csv'
  mapeamento    TEXT NOT NULL,    -- JSON: { "nome": "Coluna X", "preco": "Coluna Y", ... }
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (empresa_id, origem),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);
