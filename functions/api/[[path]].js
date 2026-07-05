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
 *   GET  /api/me                    -> { email, empresaId, papel, nomeEmpresa }
 *   GET  /api/:store                -> lista registros da empresa nesse store
 *   GET  /api/:store/:id            -> um registro específico
 *   POST /api/:store                -> cria um registro
 *   PUT  /api/:store/:id            -> atualiza um registro
 *   DELETE /api/:store/:id          -> remove um registro
 *
 * Requer o binding D1 "DB", igual antes.
 */

const STORES_VALIDOS = ['produtos', 'vendas', 'movimentos'];

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
      SELECT m.empresa_id AS empresaId, m.papel AS papel, e.nome AS nomeEmpresa
      FROM membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.usuario_email = ?
      LIMIT 1
    `)
    .bind(email)
    .first();
  return linha || null;
}

function permissaoPara(papel, store) {
  const regras = PERMISSOES[papel];
  if (!regras) return null;
  return regras[store] || null;
}

export async function onRequest(context) {
  const { request, env } = context;

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) {
    return json({ error: 'Não autenticado. Acesse pelo domínio protegido pelo Cloudflare Access.' }, 401);
  }

  const db = env.DB;
  if (!db) {
    return json({ error: 'Binding D1 "DB" não configurado neste projeto Pages.' }, 500);
  }

  const membro = await resolverMembro(db, email);
  if (!membro) {
    return json({ error: 'Este e-mail ainda não foi associado a nenhuma empresa. Peça para o dono te convidar.' }, 403);
  }

  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const primeiro = partes[0];

  // GET /api/me — a UI usa isso pra saber o que mostrar/esconder pra essa pessoa.
  if (primeiro === 'me' && request.method === 'GET') {
    return json({ email, empresaId: membro.empresaId, papel: membro.papel, nomeEmpresa: membro.nomeEmpresa });
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
