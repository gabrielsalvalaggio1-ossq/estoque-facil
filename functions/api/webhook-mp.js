/**
 * functions/api/webhook-mp.js
 *
 * Recebe notificações do Mercado Pago sobre assinaturas (preapproval).
 * Valida a assinatura do webhook antes de processar qualquer coisa.
 *
 * Variáveis de ambiente:
 *   MP_ACCESS_TOKEN_TEST ou MP_ACCESS_TOKEN
 *   MP_WEBHOOK_SECRET  ← assinatura secreta gerada pelo MP
 */

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

function calcularExpiracao(planoId) {
  const data = new Date();
  planoId.endsWith('_anual')
    ? data.setFullYear(data.getFullYear() + 1)
    : data.setMonth(data.getMonth() + 1);
  return data.toISOString();
}

/**
 * Valida a assinatura HMAC-SHA256 que o MP envia no header
 * x-signature junto com o timestamp (x-request-id).
 * Sem isso, qualquer pessoa poderia POST no endpoint e ativar planos.
 */
async function validarAssinaturaMP(request, secret) {
  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';

  // O MP manda: ts=TIMESTAMP,v1=HASH
  const ts = (xSignature.match(/ts=([^,]+)/) || [])[1] || '';
  const v1 = (xSignature.match(/v1=([^,]+)/) || [])[1] || '';

  if (!ts || !v1) return false;

  // Monta a string que o MP assinou: id;ts;
  const url = new URL(request.url);
  const queryId = url.searchParams.get('data.id') || '';
  const mensagem = `id:${queryId};request-id:${xRequestId};ts:${ts};`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const assinatura = await crypto.subtle.sign('HMAC', key, encoder.encode(mensagem));
  const hash = Array.from(new Uint8Array(assinatura))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return hash === v1;
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return new Response('ok', { status: 200 });

  // Valida assinatura do webhook
  const secret = env.MP_WEBHOOK_SECRET;
  if (secret) {
    const valido = await validarAssinaturaMP(request, secret);
    if (!valido) {
      console.warn('Webhook MP: assinatura inválida — requisição rejeitada');
      return new Response('unauthorized', { status: 401 });
    }
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response('ok', { status: 200 });
  }

  if (body.type !== 'preapproval' && body.type !== 'subscription_preapproval') return new Response('ok', { status: 200 });

  const preapprovalId = body.data && body.data.id;
  if (!preapprovalId) return new Response('ok', { status: 200 });

  const accessToken = env.MP_ACCESS_TOKEN || env.MP_ACCESS_TOKEN_TEST;
  if (!accessToken) return new Response('ok', { status: 200 });

  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!mpRes.ok) return new Response('ok', { status: 200 });

  const assinatura = await mpRes.json();
  const [empresaId, planoId] = (assinatura.external_reference || '').split('|');
  if (!empresaId || !planoId) return new Response('ok', { status: 200 });

  const status = assinatura.status;

  try {
    if (status === 'authorized') {
      const dataExpiracao = calcularExpiracao(planoId);

      const jaExiste = await db
        .prepare('SELECT id FROM assinaturas WHERE mp_preapproval_id = ?')
        .bind(preapprovalId).first();

      if (!jaExiste) {
        await db.prepare(`
          UPDATE assinaturas
          SET status = 'CANCELED', cancelado_em = datetime('now'),
              motivo_cancelamento = 'Substituído por nova assinatura MP',
              atualizado_em = datetime('now')
          WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
        `).bind(empresaId).run();

        const empresaRow = await db.prepare('SELECT dono_email FROM empresas WHERE id = ? LIMIT 1').bind(empresaId).first();
        const donoEmail = empresaRow && empresaRow.dono_email;
        const usuarioRow = donoEmail
          ? await db.prepare('SELECT id FROM usuarios WHERE email = ? LIMIT 1').bind(donoEmail).first()
          : null;
        if (!usuarioRow) throw new Error('Usuário dono não encontrado para empresa: ' + empresaId);

        await db.prepare(`
          INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio, data_expiracao, mp_preapproval_id)
          VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), ?, ?)
        `).bind(`sub-mp-${preapprovalId}`, empresaId, usuarioRow.id, planoId, dataExpiracao, preapprovalId).run();
      }

      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();

      const dono = await db.prepare('SELECT dono_email FROM empresas WHERE id = ?').bind(empresaId).first();
      if (dono && dono.dono_email) {
        await db.prepare(`
          UPDATE usuarios SET plano_atual = ?, status_assinatura = 'ACTIVE', data_expiracao = ? WHERE email = ?
        `).bind(planoId, dataExpiracao, dono.dono_email).run();
      }

    } else if (status === 'cancelled' || status === 'paused') {
      await db.prepare(`
        UPDATE assinaturas
        SET status = 'CANCELED', cancelado_em = datetime('now'),
            motivo_cancelamento = ?, atualizado_em = datetime('now')
        WHERE empresa_id = ? AND mp_preapproval_id = ?
      `).bind(`Cancelado via MP (${status})`, empresaId, preapprovalId).run();

      const donoParaFree = await db.prepare('SELECT dono_email FROM empresas WHERE id = ? LIMIT 1').bind(empresaId).first();
      const usuarioParaFree = donoParaFree
        ? await db.prepare('SELECT id FROM usuarios WHERE email = ? LIMIT 1').bind(donoParaFree.dono_email).first()
        : null;
      if (!usuarioParaFree) throw new Error('Usuário dono não encontrado ao reverter para free: ' + empresaId);

      await db.prepare(`
        INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio)
        VALUES (?, ?, ?, 'free', 'ACTIVE', datetime('now'))
      `).bind(`sub-free-${empresaId}-${Date.now()}`, empresaId, usuarioParaFree.id).run();

      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind('free', empresaId).run();

      const dono = donoParaFree;
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