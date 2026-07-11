/**
 * functions/api/checkout-mp.js
 *
 * Checkout Transparente do Mercado Pago — o cartão é digitado no próprio
 * site, sem redirect. O SDK do MP tokeniza o cartão no browser (número
 * nunca chega ao nosso servidor); recebemos só o token + dados do plano
 * e criamos a assinatura (preapproval) diretamente.
 *
 * Variáveis de ambiente (Cloudflare Pages → Settings → Environment Variables):
 *   MP_ACCESS_TOKEN_TEST   — Access Token de TESTE  (começa com TEST-...)
 *   MP_ACCESS_TOKEN        — Access Token de PRODUÇÃO (quando for ao ar)
 *   MP_PLAN_ESSENCIAL_MENSAL
 *   MP_PLAN_ESSENCIAL_ANUAL
 *   MP_PLAN_PRO_MENSAL
 *   MP_PLAN_PRO_ANUAL
 *
 * Rotas expostas:
 *   POST /api/checkout-mp/iniciar   → devolve { publicKey } pro SDK do MP
 *   POST /api/checkout-mp/assinar   → cria a assinatura com o token do cartão
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

const PLANO_NOME = {
  essencial: 'MEV Essencial Mensal', essencial_anual: 'MEV Essencial Anual',
  pro: 'MEV Pro Mensal', pro_anual: 'MEV Pro Anual',
};

// Valor em centavos de cada plano (igual ao que está no banco e na página /planos)
const PLANO_VALOR = {
  essencial: 1990, essencial_anual: 19900,
  pro: 3990,       pro_anual: 39900,
};

function getToken(env) {
  // Usa token de teste se não houver token de produção configurado
  return env.MP_ACCESS_TOKEN || env.MP_ACCESS_TOKEN_TEST;
}

export async function onRequest({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: 'DB não configurado.' }, 500);

  const url = new URL(request.url);
  const acao = url.pathname.split('/').pop(); // 'iniciar' ou 'assinar'

  // ── GET /api/checkout-mp/iniciar ─────────────────────────────────────────
  // Devolve a Public Key pro SDK do MP inicializar o formulário de cartão.
  // Não exige login (o modal pode abrir antes do login em /planos).
  if (request.method === 'GET' && acao === 'iniciar') {
    const publicKey = env.MP_PUBLIC_KEY_TEST || env.MP_PUBLIC_KEY;
    if (!publicKey) return json({ error: 'MP_PUBLIC_KEY não configurada.' }, 500);
    return json({ publicKey });
  }

  // ── POST /api/checkout-mp/assinar ────────────────────────────────────────
  // Recebe token do cartão + planoId, cria a assinatura no MP e ativa no banco.
  if (request.method === 'POST' && acao === 'assinar') {
    const email = await resolverEmailDaSessao(db, request);
    if (!email) return json({ error: 'Não autenticado. Faça login antes de assinar.' }, 401);

    let corpo;
    try { corpo = await request.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }

    const { token, planoId, nomeCartao, cpf, parcelas } = corpo;

    if (!token) return json({ error: 'Token do cartão não recebido.' }, 400);
    if (!PLANO_PARA_ENV[planoId]) return json({ error: `Plano "${planoId}" inválido.` }, 400);

    // Busca empresa do usuário
    const membro = await db
      .prepare(`SELECT m.empresa_id AS empresaId, m.papel FROM membros m WHERE m.usuario_email = ? LIMIT 1`)
      .bind(email).first();
    if (!membro) return json({ error: 'Empresa não encontrada.' }, 404);
    if (membro.papel !== 'dono') return json({ error: 'Só o dono pode assinar.' }, 403);

    const envKey = PLANO_PARA_ENV[planoId];
    const mpPlanId = env[envKey];
    if (!mpPlanId) return json({ error: `Variável "${envKey}" não configurada.` }, 500);

    const accessToken = getToken(env);
    if (!accessToken) return json({ error: 'Access Token do MP não configurado.' }, 500);

    // Cria a assinatura (preapproval) com o token do cartão
    const payload = {
      preapproval_plan_id: mpPlanId,
      card_token_id: token,
      payer_email: email,
      external_reference: `${membro.empresaId}|${planoId}`,
      // Dados do pagador (exigidos pelo MP no checkout transparente)
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
      const mensagem = mpData.message || mpData.error || 'Erro ao processar pagamento.';
      return json({ error: mensagem }, 502);
    }

    // Se MP confirmou (status authorized), ativa o plano imediatamente
    // O webhook também vai chegar e fazer o mesmo — a função é idempotente
    if (mpData.status === 'authorized') {
      await ativarPlanoNoBanco(db, membro.empresaId, planoId, email, mpData.id);
    }

    return json({
      ok: true,
      status: mpData.status,
      // 'authorized' = aprovado | 'pending' = aguardando | outros = erro
      planoAtivado: mpData.status === 'authorized',
    });
  }

  return json({ error: 'Rota não encontrada.' }, 404);
}

async function ativarPlanoNoBanco(db, empresaId, planoId, email, mpPreapprovalId) {
  const dataExpiracao = calcularExpiracao(planoId);

  // Cancela assinaturas anteriores
  await db.prepare(`
    UPDATE assinaturas
    SET status = 'CANCELED', cancelado_em = datetime('now'),
        motivo_cancelamento = 'Substituído por nova assinatura',
        atualizado_em = datetime('now')
    WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
  `).bind(empresaId).run();

  // Cria nova assinatura ativa
  await db.prepare(`
    INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio, data_expiracao, mp_preapproval_id)
    VALUES (?, ?, NULL, ?, 'ACTIVE', datetime('now'), ?, ?)
  `).bind(`sub-mp-${mpPreapprovalId}`, empresaId, planoId, dataExpiracao, mpPreapprovalId).run();

  await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();
  await db.prepare(`
    UPDATE usuarios SET plano_atual = ?, status_assinatura = 'ACTIVE', data_expiracao = ?
    WHERE email = ?
  `).bind(planoId, dataExpiracao, email).run();
}

function calcularExpiracao(planoId) {
  const data = new Date();
  planoId.endsWith('_anual') ? data.setFullYear(data.getFullYear() + 1) : data.setMonth(data.getMonth() + 1);
  return data.toISOString();
}
