-- schema-assinaturas.sql
-- Quarta etapa do banco: planos, assinaturas e billing por conta (empresa).
--
-- Modelo de tenant: a UNIDADE DE COBRANÇA é a empresa, não o usuário.
-- Isso já é o desenho existente (empresas.plano, membros.papel, registros
-- isolados por empresa_id) — este schema só formaliza o ciclo de vida da
-- assinatura em vez de guardar só o nome do plano como texto solto.
--
-- usuarios continua sendo "quem loga"; empresas continua sendo "o que é
-- isolado". Um usuário pode ser dono de uma empresa e o dono é quem aparece
-- como responsável financeiro (gateway_customer_id) daquela assinatura.
--
-- Como rodar (depois de schema.sql, schema-empresas*.sql, schema-planos.sql):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-assinaturas.sql

-- =========================================================================
-- 1. PLANOS — catálogo, não dado de conta. Preço e limites em um só lugar,
--    pra nunca ficar "hardcoded" espalhado pelo código ou pela UI.
-- =========================================================================
CREATE TABLE IF NOT EXISTS planos (
  id               TEXT PRIMARY KEY,       -- 'free' | 'essencial' | 'pro'
  nome             TEXT NOT NULL,          -- rótulo exibido ('Essencial')
  preco_centavos   INTEGER NOT NULL,       -- preço em centavos (evita float); 0 = free
  ciclo            TEXT NOT NULL DEFAULT 'mensal', -- 'mensal' | 'anual'
  limite_membros   INTEGER NOT NULL,       -- quantas pessoas a empresa pode ter nesse plano
  recursos         TEXT NOT NULL,          -- JSON: {"leitor_codigo_barras":true,"auditoria":false,...}
  ativo            INTEGER NOT NULL DEFAULT 1, -- 0 = descontinuado, não oferecer em novas vendas
  criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO planos (id, nome, preco_centavos, ciclo, limite_membros, recursos) VALUES
  ('free',      'Free',      0,    'mensal', 1, '{"relatorios_fiado":false,"leitor_codigo_barras":false,"auditoria":false,"suporte":"email"}'),
  ('essencial', 'Essencial', 1990, 'mensal', 2, '{"relatorios_fiado":true,"leitor_codigo_barras":true,"auditoria":false,"suporte":"whatsapp"}'),
  ('pro',       'Pro',       3990, 'mensal', 5, '{"relatorios_fiado":true,"leitor_codigo_barras":true,"auditoria":true,"suporte":"prioritario"}');

-- =========================================================================
-- 2. ASSINATURAS — o histórico/ciclo de vida. Cada linha é UM período de
--    contrato; trocar de plano ou reativar cria uma linha nova em vez de
--    sobrescrever, então dá pra reconstruir o histórico de billing depois.
-- =========================================================================
CREATE TABLE IF NOT EXISTS assinaturas (
  id                       TEXT PRIMARY KEY,   -- ex: 'sub-<uuid>'
  empresa_id               TEXT NOT NULL,      -- conta cobrada (o tenant)
  usuario_id               TEXT NOT NULL,      -- dono/responsável financeiro no momento da assinatura
  plano_id                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'TRIAL',
                           -- 'FREE' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  gateway_subscription_id  TEXT,               -- id da assinatura no gateway (Stripe/Pagar.me/etc.)
  data_inicio              TEXT NOT NULL DEFAULT (datetime('now')),
  data_expiracao           TEXT,               -- fim do período pago/trial atual; NULL = sem vencimento (ex: free)
  cancelado_em             TEXT,               -- quando o cancelamento foi solicitado (pode ainda estar ACTIVE até expirar)
  motivo_cancelamento      TEXT,
  criado_em                TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (plano_id)   REFERENCES planos(id)
);

-- Toda consulta de billing parte de "qual a assinatura desta empresa" —
-- e o dashboard financeiro global parte de "quem está PAST_DUE hoje".
CREATE INDEX IF NOT EXISTS idx_assinaturas_empresa   ON assinaturas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_status     ON assinaturas (status);
CREATE INDEX IF NOT EXISTS idx_assinaturas_expiracao  ON assinaturas (data_expiracao);

-- Só uma assinatura "corrente" (ACTIVE/TRIAL/PAST_DUE) por empresa ao mesmo
-- tempo — evita duas cobranças correndo em paralelo pro mesmo tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assinaturas_corrente_unica
  ON assinaturas (empresa_id)
  WHERE status IN ('TRIAL','ACTIVE','PAST_DUE');

-- =========================================================================
-- 3. USUÁRIOS — campos de billing denormalizados pra leitura rápida (login,
--    header do app, gate de recursos) sem precisar de JOIN em toda request.
--    A fonte da verdade do histórico continua em `assinaturas`; estes
--    campos são sempre reescritos a partir da assinatura corrente da
--    empresa da qual o usuário é dono.
-- =========================================================================
ALTER TABLE usuarios ADD COLUMN plano_atual            TEXT NOT NULL DEFAULT 'free';
ALTER TABLE usuarios ADD COLUMN status_assinatura      TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE usuarios ADD COLUMN data_inicio_assinatura TEXT;
ALTER TABLE usuarios ADD COLUMN data_expiracao         TEXT;
ALTER TABLE usuarios ADD COLUMN gateway_customer_id    TEXT;      -- id do cliente no gateway de pagamento
ALTER TABLE usuarios ADD COLUMN gateway_subscription_id TEXT;     -- espelha a assinatura corrente (ver assinaturas.gateway_subscription_id)

CREATE INDEX IF NOT EXISTS idx_usuarios_gateway_customer
  ON usuarios (gateway_customer_id);

-- =========================================================================
-- 4. Migra o dado solto que já existia (empresas.plano é texto livre desde
--    schema-planos.sql) pra virar uma assinatura FREE de verdade, e replica
--    pro dono de cada empresa.
-- =========================================================================
INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio)
SELECT
  'sub-' || e.id,
  e.id,
  u.id,
  CASE WHEN e.plano IN ('free','gratis') THEN 'free' ELSE e.plano END,
  'FREE',
  e.criado_em
FROM empresas e
JOIN usuarios u ON u.email = e.dono_email
WHERE NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.empresa_id = e.id);

UPDATE usuarios
SET plano_atual = 'free', status_assinatura = 'FREE'
WHERE email IN (SELECT dono_email FROM empresas);
