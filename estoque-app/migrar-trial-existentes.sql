-- migrar-trial-existentes.sql
-- Migra contas antigas (status ACTIVE, plano free, sem data_expiracao)
-- para o regime de trial de 60 dias a partir da data em que a empresa foi criada.
--
-- Seguro para rodar múltiplas vezes (WHERE evita atualizar quem já foi migrado
-- ou quem já tem um plano pago).
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./migrar-trial-existentes.sql
--
-- Para conferir antes de rodar (dry-run):
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --command \
--     "SELECT empresa_id, status, plano_id, data_inicio, data_expiracao FROM assinaturas WHERE plano_id = 'free' AND status = 'ACTIVE' AND data_expiracao IS NULL;"

-- =========================================================================
-- 1. Tabela assinaturas: ACTIVE + free + sem data_expiracao → TRIAL + 60d
-- =========================================================================
UPDATE assinaturas
SET
  status         = 'TRIAL',
  data_expiracao = datetime(data_inicio, '+60 days'),
  atualizado_em  = datetime('now')
WHERE
  plano_id        = 'free'
  AND status      = 'ACTIVE'
  AND data_expiracao IS NULL;

-- =========================================================================
-- 2. Tabela usuarios: espelha o novo status (campo denormalizado)
--    Só atualiza donos cujas empresas foram migradas na etapa acima.
-- =========================================================================
UPDATE usuarios
SET
  status_assinatura = 'TRIAL',
  data_expiracao    = (
    SELECT datetime(a.data_inicio, '+60 days')
    FROM assinaturas a
    JOIN empresas e ON e.id = a.empresa_id
    WHERE e.dono_email = usuarios.email
      AND a.plano_id   = 'free'
      AND a.status     = 'TRIAL'
    ORDER BY a.criado_em DESC
    LIMIT 1
  )
WHERE
  status_assinatura = 'ACTIVE'
  AND plano_atual   = 'free'
  AND EXISTS (
    SELECT 1
    FROM assinaturas a
    JOIN empresas e ON e.id = a.empresa_id
    WHERE e.dono_email = usuarios.email
      AND a.plano_id   = 'free'
      AND a.status     = 'TRIAL'
  );

-- =========================================================================
-- 3. Conferência: mostra quem ficou com trial já expirado vs. ainda ativo.
--    (Apenas informativo — não altera nada.)
-- =========================================================================
SELECT
  a.empresa_id,
  a.status,
  a.data_inicio,
  a.data_expiracao,
  CASE
    WHEN datetime(a.data_expiracao) < datetime('now') THEN 'EXPIRADO'
    ELSE CAST(
      CAST((julianday(a.data_expiracao) - julianday('now')) AS INTEGER)
      AS TEXT) || ' dias restantes'
  END AS situacao
FROM assinaturas a
WHERE a.plano_id = 'free' AND a.status = 'TRIAL'
ORDER BY a.data_expiracao ASC;
