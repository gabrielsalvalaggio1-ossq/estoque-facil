/**
 * functions/api/checkout-mp-assinar.js
 * POST /api/checkout-mp-assinar
 *
 * Em teste: usa /v1/payments (sandbox suporta bem)
 * Em produção: usa /preapproval (assinatura recorrente real)
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

const PLANO_VALOR = {
  essencial: 19.90,
  essencial_anual: 199.00,
  pro: 39.90,
  pro_anual: 399.00,
};

function calcularExpiracao(planoId) {
  const data = new Date();
  planoId.endsWith('_anual')
    ? data.setFullYear(data.getFullYear() + 1)
    : data.setMonth(data.getMonth() + 1);
  return data.toISOString();
}

async function ativarPlanoNoBanco(db, empresaId, planoId, email, mpId) {
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
  `).bind(`sub-mp-${mpId}`, empresaId, planoId, dataExpiracao, mpId).run();

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

  const accessToken = env.MP_ACCESS_TOKEN || env.MP_ACCESS_TOKEN_TEST;
  if (!accessToken) return json({ error: 'Access Token do MP não configurado.' }, 500);

  // Detecta se é ambiente de teste pelo token
  const ehTeste = accessToken.startsWith('TEST-');

  let mpId, mpStatus;

  if (ehTeste) {
    // SANDBOX: usa pagamento simples pois preapproval não funciona bem no sandbox do MP
    const valor = PLANO_VALOR[planoId];
    if (!valor) return json({ error: 'Valor do plano não encontrado.' }, 400);

    const payload = {
      transaction_amount: valor,
      token,
      description: `MEV ${planoId}`,
      installments: 1,
      payment_method_id: 'master', // o cartão de teste do MP é Mastercard
      payer: {
        email,
        identification: {
          type: 'CPF',
          number: (cpf || '').replace(/\D/g, '') || '12345678909',
        },
      },
      external_reference: `${membro.empresaId}|${planoId}`,
    };

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${membro.empresaId}-${planoId}-${Date.now()}`,
      },
      body: JSON.stringify(payload),
    });

    const mpData = await mpRes.json();
    console.log('MP pagamento teste:', JSON.stringify({ status: mpData.status, status_detail: mpData.status_detail, id: mpData.id }));

    if (!mpRes.ok || (mpData.status !== 'approved' && mpData.status !== 'in_process')) {
      return json({
        error: mpData.status_detail || mpData.message || 'Pagamento não aprovado.',
        mp_status: mpData.status,
        mp_detalhe: mpData.status_detail,
      }, 502);
    }

    mpId = String(mpData.id);
    mpStatus = mpData.status;

  } else {
    // PRODUÇÃO: usa preapproval (assinatura recorrente real)
    const envKey = PLANO_PARA_ENV[planoId];
    const mpPlanId = env[envKey];
    if (!mpPlanId) return json({ error: `Variável "${envKey}" não configurada.` }, 500);

    const primeiroNome = nomeCartao ? nomeCartao.split(' ')[0] : 'Titular';
    const sobrenome = nomeCartao && nomeCartao.includes(' ')
      ? nomeCartao.split(' ').slice(1).join(' ')
      : 'Cartao';

    const payload = {
      preapproval_plan_id: mpPlanId,
      card_token_id: token,
      payer_email: email,
      payer_first_name: primeiroNome,
      payer_last_name: sobrenome,
      external_reference: `${membro.empresaId}|${planoId}`,
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
    console.log('MP preapproval produção:', JSON.stringify({ status: mpData.status, id: mpData.id }));

    if (!mpRes.ok) {
      return json({
        error: mpData.message || mpData.error || 'Erro ao processar pagamento.',
        mp_detalhe: mpData,
      }, 502);
    }

    mpId = mpData.id;
    mpStatus = mpData.status;
  }

  // Ativa o plano no banco
  await ativarPlanoNoBanco(db, membro.empresaId, planoId, email, mpId);

  return json({
    ok: true,
    status: mpStatus,
    planoAtivado: true,
  });
}