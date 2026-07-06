/**
 * functions/api/[[path]].js  (v2 — empresas, papéis e auditoria)
 *
 * Muda em relação à v1:
 *  - Os dados não são mais isolados por e-mail direto — são isolados por
 *    "empresa" (várias pessoas podem compartilhar a mesma empresa).
 *  - Cada e-mail pertence a uma empresa com um papel: dono, vendedor ou
 *    estoquista. O papel decide o que a pessoa pode fazer.
 *  - Toda escrita em vendas/movimentos carimba automaticamente quem fez
 *    (criado_por / registrado_por) — o cliente não escolhe isso, o servidor
 *    decide com base em quem está logado, pra não dar pra falsificar.
 *
 * Rotas:
 *   POST /api/empresas               -> cria uma empresa nova (self-service, vira "dono")
 *   GET  /api/me                     -> { email, empresaId, papel, nomeEmpresa, plano }
 *   GET  /api/membros                -> lista membros da empresa (só dono)
 *   POST /api/membros                -> adiciona um membro à empresa (só dono, respeita limite do plano)
 *   DELETE /api/membros/:email       -> remove um membro da empresa (só dono)
 *   GET  /api/:store                 -> lista registros da empresa nesse store
 *   GET  /api/:store/:id             -> um registro específico
 *   POST /api/:store                 -> cria um registro
 *   PUT  /api/:store/:id             -> atualiza um registro
 *   DELETE /api/:store/:id           -> remove um registro
 *
 * Requer o binding D1 "DB", igual antes.
 */

const STORES_VALIDOS = ['produtos', 'vendas', 'movimentos'];
const PAPEIS_VALIDOS = ['dono', 'vendedor', 'estoquista'];

// Planos disponíveis e quantos membros cada um permite (incluindo o dono).
// Isso é o que decide o que é grátis e o que precisa de upgrade — hoje só
// limita quantidade de gente na equipe; no futuro dá pra pendurar mais
// regras aqui (limite de produtos, exportação, etc).
const PLANOS = {
  gratis: { rotulo: 'Grátis', maxMembros: 1 },
  equipe: { rotulo: 'Equipe', maxMembros: 5 },
};
const PLANO_PADRAO = 'gratis';

function infoPlano(plano) {
  return PLANOS[plano] || PLANOS[PLANO_PADRAO];
}

// O que cada papel pode fazer em cada store.
// 'leitura' = só GET. 'total' = GET/POST/PUT/DELETE. ausente = sem acesso nenhum.
const PERMISSOES = {
  dono:       { produtos: 'total',  vendas: 'total',  movimentos: 'total' },
  vendedor:   { produtos: 'leitura', vendas: 'total',  movimentos: null },
  estoquista: { produtos: 'total',  vendas: null,      movimentos: 'total' },
};

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Descobre a qual empresa e com qual papel esse e-mail pertence. */
async function resolverMembro(db, email) {
  const linha = await db
    .prepare(`
      SELECT m.empresa_id AS empresaId, m.papel AS papel, e.nome AS nomeEmpresa, e.plano AS plano
      FROM membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.usuario_email = ?
      LIMIT 1
    `)
    .bind(email)
    .first();
  return linha || null;
}

/**
 * POST /api/empresas — cadastro self-service. Quem chama ainda não precisa
 * pertencer a nenhuma empresa; é justamente essa a rota que resolve isso.
 * Quem cria vira automaticamente "dono" no plano grátis.
 */
async function criarEmpresa(db, email, request) {
  const jaEhMembro = await db
    .prepare('SELECT empresa_id FROM membros WHERE usuario_email = ?')
    .bind(email)
    .first();
  if (jaEhMembro) {
    return json({ error: 'Esse e-mail já está associado a uma empresa.' }, 409);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const nomeEmpresa = ((corpo && corpo.nomeEmpresa) || '').trim();
  if (!nomeEmpresa) {
    return json({ error: 'Informe o nome da empresa.' }, 400);
  }

  const empresaId = crypto.randomUUID();

  await db
    .prepare(`
      INSERT INTO empresas (id, nome, dono_email, plano, criado_em)
      VALUES (?, ?, ?, ?, datetime('now'))
    `)
    .bind(empresaId, nomeEmpresa, email, PLANO_PADRAO)
    .run();

  await db
    .prepare(`
      INSERT INTO membros (empresa_id, usuario_email, papel, criado_em)
      VALUES (?, ?, 'dono', datetime('now'))
    `)
    .bind(empresaId, email)
    .run();

  return json({ email, empresaId, papel: 'dono', nomeEmpresa, plano: PLANO_PADRAO }, 201);
}

function permissaoPara(papel, store) {
  const regras = PERMISSOES[papel];
  if (!regras) return null;
  return regras[store] || null;
}

/** Quantos "donos" a empresa tem — usado pra nunca deixar zero. */
async function contarDonos(db, empresaId) {
  const linha = await db
    .prepare(`SELECT COUNT(*) AS total FROM membros WHERE empresa_id = ? AND papel = 'dono'`)
    .bind(empresaId)
    .first();
  return linha ? linha.total : 0;
}

/**
 * Trata todas as rotas /api/membros. Só quem é "dono" da própria empresa
 * pode gerenciar a equipe — todo o resto recebe 403.
 */
async function tratarRotaMembros(db, emailLogado, membro, emailAlvo, request) {
  if (membro.papel !== 'dono') {
    return json({ error: 'Só o dono da empresa pode gerenciar a equipe.' }, 403);
  }

  const empresaId = membro.empresaId;

  // GET /api/membros — lista os membros da empresa.
  if (request.method === 'GET' && !emailAlvo) {
    const { results } = await db
      .prepare(`
        SELECT usuario_email AS email, papel, criado_em AS criadoEm
        FROM membros
        WHERE empresa_id = ?
        ORDER BY criado_em ASC
      `)
      .bind(empresaId)
      .all();
    return json(results);
  }

  // POST /api/membros — adiciona um novo membro.
  if (request.method === 'POST' && !emailAlvo) {
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json({ error: 'Corpo da requisição inválido.' }, 400);
    }

    const email = ((corpo && corpo.email) || '').trim().toLowerCase();
    const papel = corpo && corpo.papel;

    if (!email || !email.includes('@')) {
      return json({ error: 'Informe um e-mail válido.' }, 400);
    }
    if (!PAPEIS_VALIDOS.includes(papel)) {
      return json({ error: `Papel inválido. Use um destes: ${PAPEIS_VALIDOS.join(', ')}.` }, 400);
    }

    // Por enquanto, um e-mail só pode pertencer a uma empresa.
    const existente = await db
      .prepare('SELECT empresa_id AS empresaId FROM membros WHERE usuario_email = ?')
      .bind(email)
      .first();

    if (existente) {
      const mensagem = existente.empresaId === empresaId
        ? 'Esse e-mail já faz parte da sua equipe.'
        : 'Esse e-mail já pertence a outra empresa. Por enquanto, cada e-mail só pode estar em uma empresa.';
      return json({ error: mensagem }, 409);
    }

    // Respeita o limite de membros do plano atual da empresa.
    const empresaAtual = await db
      .prepare('SELECT plano FROM empresas WHERE id = ?')
      .bind(empresaId)
      .first();
    const plano = infoPlano(empresaAtual && empresaAtual.plano);
    const totalAtual = await db
      .prepare('SELECT COUNT(*) AS total FROM membros WHERE empresa_id = ?')
      .bind(empresaId)
      .first();

    if ((totalAtual ? totalAtual.total : 0) >= plano.maxMembros) {
      return json({
        error: `Seu plano atual (${plano.rotulo}) permite até ${plano.maxMembros} pessoa(s) na equipe. Faça upgrade pra adicionar mais gente.`
      }, 402);
    }

    await db
      .prepare(`
        INSERT INTO membros (empresa_id, usuario_email, papel, criado_em)
        VALUES (?, ?, ?, datetime('now'))
      `)
      .bind(empresaId, email, papel)
      .run();

    return json({ email, papel }, 201);
  }

  // DELETE /api/membros/:email — remove um membro.
  if (request.method === 'DELETE' && emailAlvo) {
    const emailDecodificado = decodeURIComponent(emailAlvo).trim().toLowerCase();

    if (emailDecodificado === emailLogado.trim().toLowerCase()) {
      return json({ error: 'Você não pode remover a si mesmo da equipe. Peça para outro dono fazer isso.' }, 400);
    }

    const alvo = await db
      .prepare('SELECT papel FROM membros WHERE empresa_id = ? AND usuario_email = ?')
      .bind(empresaId, emailDecodificado)
      .first();

    if (!alvo) {
      return json({ error: 'Esse e-mail não é membro da sua empresa.' }, 404);
    }

    // Nunca deixar a empresa sem nenhum dono.
    if (alvo.papel === 'dono') {
      const totalDonos = await contarDonos(db, empresaId);
      if (totalDonos <= 1) {
        return json({ error: 'Não é possível remover o único dono da empresa.' }, 400);
      }
    }

    await db
      .prepare('DELETE FROM membros WHERE empresa_id = ? AND usuario_email = ?')
      .bind(empresaId, emailDecodificado)
      .run();

    return json({ ok: true });
  }

  return json({ error: 'Rota ou método não suportado para /api/membros.' }, 405);
}

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Lê o cookie "session" (token cru) e descobre o e-mail do usuário, validando o hash contra a tabela sessoes. */
async function resolverEmailDaSessao(db, request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]);
  const linha = await db
    .prepare(`
      SELECT u.email AS email, s.expires_at AS expiresAt
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ?
    `)
    .bind(tokenHash)
    .first();

  if (!linha) return null;
  if (new Date(linha.expiresAt) < new Date()) return null; // sessão expirada

  return linha.email;
}

export async function onRequest(context) {
  const { request, env } = context;

  const db = env.DB;
  if (!db) {
    return json({ error: 'Binding D1 "DB" não configurado neste projeto Pages.' }, 500);
  }

  const email = await resolverEmailDaSessao(db, request);
  if (!email) {
    return json({ error: 'Não autenticado. Faça login novamente.' }, 401);
  }

  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const primeiro = partes[0];

  // POST /api/empresas — cadastro self-service. Único caso em que a pessoa
  // ainda NÃO precisa pertencer a nenhuma empresa pra poder chamar a rota.
  if (primeiro === 'empresas' && request.method === 'POST') {
    try {
      return await criarEmpresa(db, email, request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao criar a empresa.' }, 500);
    }
  }

  const membro = await resolverMembro(db, email);

  // GET /api/me — a UI usa isso pra saber o que mostrar/esconder pra essa
  // pessoa. Funciona mesmo sem empresa: é assim que o front descobre que
  // precisa mostrar a tela de "criar sua empresa".
  if (primeiro === 'me' && request.method === 'GET') {
    if (!membro) {
      return json({ email, empresaId: null, papel: null, nomeEmpresa: null, plano: null });
    }
    return json({
      email,
      empresaId: membro.empresaId,
      papel: membro.papel,
      nomeEmpresa: membro.nomeEmpresa,
      plano: membro.plano
    });
  }

  if (!membro) {
    return json({ error: 'Este e-mail ainda não foi associado a nenhuma empresa. Peça para o dono te convidar.' }, 403);
  }

  // /api/membros e /api/membros/:email — gestão de equipe (só dono).
  if (primeiro === 'membros') {
    try {
      return await tratarRotaMembros(db, email, membro, partes[1], request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao gerenciar a equipe.' }, 500);
    }
  }

  const store = primeiro;
  const id = partes[1];

  if (!STORES_VALIDOS.includes(store)) {
    return json({ error: `Store "${store}" inválido.` }, 404);
  }

  const permissao = permissaoPara(membro.papel, store);
  if (!permissao) {
    return json({ error: `Seu papel (${membro.papel}) não tem acesso a "${store}".` }, 403);
  }
  const metodoEscrita = ['POST', 'PUT', 'DELETE'].includes(request.method);
  if (metodoEscrita && permissao !== 'total') {
    return json({ error: `Seu papel (${membro.papel}) só tem acesso de leitura a "${store}".` }, 403);
  }

  const empresaId = membro.empresaId;

  try {
    if (request.method === 'GET' && !id) {
      const { results } = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ?')
        .bind(empresaId, store)
        .all();
      return json(results.map(r => JSON.parse(r.dados)));
    }

    if (request.method === 'GET' && id) {
      const row = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
        .bind(empresaId, store, id)
        .first();
      return json(row ? JSON.parse(row.dados) : null);
    }

    if (request.method === 'POST' && !id) {
      const registro = await request.json();
      if (!registro || !registro.id) {
        return json({ error: 'Registro precisa ter um campo "id".' }, 400);
      }
      // Carimba quem criou — vem do servidor (e-mail autenticado), nunca do
      // que o cliente mandar, pra não dar pra forjar quem fez a ação.
      registro.criado_por = email;
      registro.criado_em = new Date().toISOString();

      await db
        .prepare('INSERT INTO registros (id, empresa_id, usuario_email, store, dados, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime("now"))')
        .bind(registro.id, empresaId, email, store, JSON.stringify(registro))
        .run();
      return json(registro, 201);
    }

    if (request.method === 'PUT' && id) {
      const registro = await request.json();
      registro.atualizado_por = email;
      registro.atualizado_em = new Date().toISOString();

      await db
        .prepare(`
          INSERT INTO registros (id, empresa_id, usuario_email, store, dados, atualizado_em)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id, empresa_id, store)
          DO UPDATE SET dados = excluded.dados, atualizado_em = datetime('now'), usuario_email = excluded.usuario_email
        `)
        .bind(id, empresaId, email, store, JSON.stringify(registro))
        .run();
      return json(registro);
    }

    if (request.method === 'DELETE' && id) {
      await db
        .prepare('DELETE FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
        .bind(empresaId, store, id)
        .run();
      return json({ ok: true });
    }

    return json({ error: 'Rota ou método não suportado.' }, 405);
  } catch (erro) {
    return json({ error: erro.message || 'Erro interno ao acessar o banco.' }, 500);
  }
}