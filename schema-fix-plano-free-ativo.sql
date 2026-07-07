-- schema-fix-plano-free-ativo.sql
--
-- Corrige o bug: contas criadas pelo fluxo de cadastro público
-- (/api/auth/register e login com Google) nunca tinham uma linha em
-- `assinaturas` criada — só o fluxo self-service de "criar empresa"
-- (/api/empresas) fazia isso. Sem essa linha, statusAssinatura() caía no
-- valor padrão antigo ('EXPIRED'), e a tela "Minha assinatura" mostrava
-- "Cancelada" para gente que tinha acabado de criar uma conta grátis.
--
-- Este script:
--   1) Cria a assinatura FREE/ACTIVE que está faltando para toda empresa
--      que hoje não tem NENHUMA linha em `assinaturas`.
--   2) Normaliza linhas antigas que ainda usam 'FREE' como status (valor
--      legado — 'FREE' é o plano, o status correto é 'ACTIVE') para 'ACTIVE'.
--   3) Sincroniza usuarios.status_assinatura e usuarios.plano_atual.
--   4) Atualiza o nome do plano free no catálogo para "MEV Free".
--
-- Como rodar:
--   npx wrangler d1 execute NOME_DO_SEU_BANCO --remote --file=./schema-fix-plano-free-ativo.sql

-- 1) Backfill: empresas sem NENHUMA assinatura ganham uma FREE/ACTIVE.
INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio)
SELECT
  'sub-fix-' || e.id,
  e.id,
  (SELECT u.id FROM usuarios u WHERE u.email = e.dono_email),
  'free',
  'ACTIVE',
  datetime('now')
FROM empresas e
WHERE NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.empresa_id = e.id);

-- 2) Normaliza linhas antigas com status legado 'FREE' -> 'ACTIVE'.
UPDATE assinaturas
SET status = 'ACTIVE', atualizado_em = datetime('now')
WHERE status = 'FREE';

-- 3) Sincroniza a tabela usuarios com a assinatura corrente de cada empresa.
UPDATE usuarios
SET status_assinatura = 'ACTIVE', plano_atual = 'free'
WHERE status_assinatura = 'FREE'
   OR (
        status_assinatura IN ('EXPIRED', 'CANCELED')
        AND email IN (
          SELECT m.usuario_email
          FROM membros m
          JOIN assinaturas a ON a.empresa_id = m.empresa_id
          WHERE a.plano_id = 'free' AND a.status = 'ACTIVE'
        )
      );

-- 4) Nome de exibição do plano free.
UPDATE planos SET nome = 'MEV Free' WHERE id = 'free';
