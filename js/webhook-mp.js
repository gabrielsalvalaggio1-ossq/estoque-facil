/**
 * functions/api/webhook-mp.js
 *
 * Recebe notificações do Mercado Pago sobre assinaturas (preapproval).
 * Funciona como segurança extra além do retorno direto do checkout:
 * mesmo se o browser do usuário fechar antes da confirmação, o webhook
 * garante que o plano vai ser ativado/cancelado corretamente.
 *
 * Configure no painel do MP:
 *   URL: https://estoque-facil.pages.dev/api/webhook-mp
 *   Evento: preapproval
 *
 * Variáveis de ambiente:
 *   MP_ACCESS_TOKEN_TEST ou MP_ACCESS_TOKEN
 */

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

function calcularExpiracao(planoId) {
  const data = new Date();
  planoId.endsWith('_anual') ? data.setFullYear(data.getFullYear() + 1) : data.setMonth(data.getMonth() + 1);
  return data.toISOString();
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return new Response('ok', { status: 200 });

  let body;
  try { body = await request.json(); } catch {
    return new Response('ok', { status: 200 });
  }

  if (body.type !== 'preapproval') return new Response('ok', { status: 200 });

  const preapprovalId = body.data && body.data.id;
  if (!preapprovalId) return new Response('ok', { status: 200 });

  const accessToken = env.MP_ACCESS_TOKEN || env.MP_ACCESS_TOKEN_TEST;
  if (!accessToken) return new Response('ok', { status: 200 });

  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!mpRes.ok) return new Response('ok', { status: 200 });

  const assinatura = await mpRes.json();

  // external_reference = "empresaId|planoId"
  const [empresaId, planoId] = (assinatura.external_reference || '').split('|');
  if (!empresaId || !planoId) return new Response('ok', { status: 200 });

  const status = assinatura.status;

  try {
    if (status === 'authorized') {
      const dataExpiracao = calcularExpiracao(planoId);

      // Idempotente: se já existe assinatura com esse mp_preapproval_id, não duplica
      const jaExiste = await db
        .prepare(`SELECT id FROM assinaturas WHERE mp_preapproval_id = ?`)
        .bind(preapprovalId).first();

      if (!jaExiste) {
        await db.prepare(`
          UPDATE assinaturas
          SET status = 'CANCELED', cancelado_em = datetime('now'),
              motivo_cancelamento = 'Substituído por nova assinatura MP',
              atualizado_em = datetime('now')
          WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
        `).bind(empresaId).run();

        await db.prepare(`
          INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio, data_expiracao, mp_preapproval_id)
          VALUES (?, ?, NULL, ?, 'ACTIVE', datetime('now'), ?, ?)
        `).bind(`sub-mp-${preapprovalId}`, empresaId, planoId, dataExpiracao, preapprovalId).run();
      }

      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();

      const dono = await db.prepare('SELECT dono_email FROM empresas WHERE id = ?').bind(empresaId).first();
      if (dono && dono.dono_email) {
        await db.prepare(`
          UPDATE usuarios SET plano_atual = ?, status_assinatura = 'ACTIVE', data_expiracao = ?
          WHERE email = ?
        `).bind(planoId, dataExpiracao, dono.dono_email).run();
      }

    } else if (status === 'cancelled' || status === 'paused') {
      await db.prepare(`
        UPDATE assinaturas
        SET status = 'CANCELED', cancelado_em = datetime('now'),
            motivo_cancelamento = ?, atualizado_em = datetime('now')
        WHERE empresa_id = ? AND mp_preapproval_id = ?
      `).bind(`Cancelado via MP (${status})`, empresaId, preapprovalId).run();

      // Garante que existe uma linha free ativa
      await db.prepare(`
        INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio)
        VALUES (?, ?, NULL, 'free', 'ACTIVE', datetime('now'))
      `).bind(`sub-free-${empresaId}-${Date.now()}`, empresaId).run();

      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind('free', empresaId).run();

      const dono = await db.prepare('SELECT dono_email FROM empresas WHERE id = ?').bind(empresaId).first();
      if (dono && dono.dono_email) {
        await db.prepare(`
          UPDATE usuarios SET plano_atual = 'free', status_assinatura = 'CANCELED' WHERE email = ?
        `).bind(dono.dono_email).run();
      }
    }
  } catch (erro) {
    console.error('Webhook MP erro:', erro.message);
  }

  return new Response('ok', { status: 200 });
}
