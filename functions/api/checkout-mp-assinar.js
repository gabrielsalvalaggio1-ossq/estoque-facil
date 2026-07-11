/**
 * functions/api/checkout-mp-assinar.js
 * POST /api/checkout-mp-assinar
 * Recebe token do cartão + planoId, cria a assinatura no MP e ativa no banco.
 */

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function resolverEmailDaSessao(db, request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const linha = await db
    .prepare(`SELECT u.email, s.expires_at FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`)
    .bind(tokenHash).first();
  if (!linha || new Date(linha.expires_at) < new Date()) return null;
  return linha.email;
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

const PLANO_PARA_ENV = {
  essencial:       'MP_PLAN_ESSENCIAL_MENSAL',
  essencial_anual: 'MP_PLAN_ESSENCIAL_ANUAL',
  pro:             'MP_PLAN_PRO_MENSAL',
  pro_anual:       'MP_PLAN_PRO_ANUAL',
};

function calcularExpiracao(planoId) {
  const data = new Date();
  planoId.endsWith('_anual')
    ? data.setFullYear(data.getFullYear() + 1)
    : data.setMonth(data.getMonth() + 1);
  return data.toISOString();
}

async function ativarPlanoNoBanco(db, empresaId, planoId, email, mpPreapprovalId) {
  const dataExpiracao = calcularExpiracao(planoId);

  await db.prepare(`
    UPDATE assinaturas
    SET status = 'CANCELED', cancelado_em = datetime('now'),
        motivo_cancelamento = 'Substituído por nova assinatura',
        atualizado_em = datetime('now')
    WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
  `).bind(empresaId).run();

  await db.prepare(`
    INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio, data_expiracao, mp_preapproval_id)
    VALUES (?, ?, NULL, ?, 'ACTIVE', datetime('now'), ?, ?)
  `).bind(`sub-mp-${mpPreapprovalId}`, empresaId, planoId, dataExpiracao, mpPreapprovalId).run();

  await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();
  await db.prepare(`
    UPDATE usuarios SET plano_atual = ?, status_assinatura = 'ACTIVE', data_expiracao = ? WHERE email = ?
  `).bind(planoId, dataExpiracao, email).run();
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: 'DB não configurado.' }, 500);

  const email = await resolverEmailDaSessao(db, request);
  if (!email) return json({ error: 'Não autenticado. Faça login antes de assinar.' }, 401);

  let corpo;
  try { corpo = await request.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }

  const { token, planoId, nomeCartao, cpf } = corpo;

  if (!token) return json({ error: 'Token do cartão não recebido.' }, 400);
  if (!PLANO_PARA_ENV[planoId]) return json({ error: `Plano "${planoId}" inválido.` }, 400);

  const membro = await db
    .prepare(`SELECT m.empresa_id AS empresaId, m.papel FROM membros m WHERE m.usuario_email = ? LIMIT 1`)
    .bind(email).first();
  if (!membro) return json({ error: 'Empresa não encontrada.' }, 404);
  if (membro.papel !== 'dono') return json({ error: 'Só o dono pode assinar.' }, 403);

  const envKey = PLANO_PARA_ENV[planoId];
  const mpPlanId = env[envKey];
  if (!mpPlanId) return json({ error: `Variável "${envKey}" não configurada.` }, 500);

  const accessToken = env.MP_ACCESS_TOKEN || env.MP_ACCESS_TOKEN_TEST;
  if (!accessToken) return json({ error: 'Access Token do MP não configurado.' }, 500);

  const payload = {
    preapproval_plan_id: mpPlanId,
    card_token_id: token,
    payer_email: email,
    external_reference: `${membro.empresaId}|${planoId}`,
    ...(nomeCartao && { payer_first_name: nomeCartao.split(' ')[0] || nomeCartao }),
    ...(nomeCartao && nomeCartao.includes(' ') && { payer_last_name: nomeCartao.split(' ').slice(1).join(' ') }),
  };

  const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `${membro.empresaId}-${planoId}-${Date.now()}`,
    },
    body: JSON.stringify(payload),
  });

  const mpData = await mpRes.json();

  if (!mpRes.ok) {
    console.error('Erro MP preapproval:', JSON.stringify(mpData));
    return json({ error: mpData.message || mpData.error || 'Erro ao processar pagamento.' }, 502);
  }

  if (mpData.status === 'authorized') {
    await ativarPlanoNoBanco(db, membro.empresaId, planoId, email, mpData.id);
  }

  return json({
    ok: true,
    status: mpData.status,
    planoAtivado: mpData.status === 'authorized',
  });
}
