/**
 * functions/api/[[path]].js
 *
 * Cloudflare Pages Function (catch-all) que atende /api/*.
 * Substitui o IndexedDB local por um banco D1 compartilhado, isolando os
 * dados por usuário através do header que o Cloudflare Access injeta em
 * toda requisição autenticada: Cf-Access-Authenticated-User-Email.
 *
 * Rotas suportadas (todas exigem o Access já estar protegendo o domínio):
 *   GET    /api/:store            -> lista todos os registros do usuário logado nesse store
 *   GET    /api/:store/:id        -> busca um registro específico
 *   POST   /api/:store            -> cria um registro (body = objeto completo, precisa ter "id")
 *   PUT    /api/:store/:id        -> substitui/atualiza um registro
 *   DELETE /api/:store/:id        -> remove um registro
 *
 * :store precisa ser um dos valores em STORES_VALIDOS — os mesmos nomes que
 * já existiam em DB.STORES no db.js original (produtos, vendas, movimentos).
 *
 * Requer, no Pages, um binding de D1 chamado "DB":
 *   Dashboard -> Workers & Pages -> seu projeto -> Settings -> Functions
 *   -> D1 database bindings -> Variable name: DB -> selecione seu banco.
 */

const STORES_VALIDOS = ['produtos', 'vendas', 'movimentos'];

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  // Em produção, com o Access ativado no domínio, este header sempre vem
  // preenchido pelo próprio Cloudflare antes da requisição chegar aqui.
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) {
    return json({ error: 'Não autenticado. Acesse pelo domínio protegido pelo Cloudflare Access.' }, 401);
  }

  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

  // Rota especial: devolve o e-mail autenticado, para a interface mostrar
  // "quem está logado" (ex: aba Conta) sem precisar duplicar essa lógica.
  if (partes[0] === 'me') {
    return json({ email });
  }

  const store = partes[0];
  const id = partes[1];

  if (!STORES_VALIDOS.includes(store)) {
    return json({ error: `Store "${store}" inválido.` }, 404);
  }

  const db = env.DB;
  if (!db) {
    return json({ error: 'Binding D1 "DB" não configurado neste projeto Pages.' }, 500);
  }

  try {
    if (request.method === 'GET' && !id) {
      const { results } = await db
        .prepare('SELECT dados FROM registros WHERE usuario_email = ? AND store = ?')
        .bind(email, store)
        .all();
      return json(results.map(r => JSON.parse(r.dados)));
    }

    if (request.method === 'GET' && id) {
      const row = await db
        .prepare('SELECT dados FROM registros WHERE usuario_email = ? AND store = ? AND id = ?')
        .bind(email, store, id)
        .first();
      return json(row ? JSON.parse(row.dados) : null);
    }

    if (request.method === 'POST' && !id) {
      const registro = await request.json();
      if (!registro || !registro.id) {
        return json({ error: 'Registro precisa ter um campo "id".' }, 400);
      }
      await db
        .prepare('INSERT INTO registros (id, usuario_email, store, dados, atualizado_em) VALUES (?, ?, ?, ?, datetime("now"))')
        .bind(registro.id, email, store, JSON.stringify(registro))
        .run();
      return json(registro, 201);
    }

    if (request.method === 'PUT' && id) {
      const registro = await request.json();
      await db
        .prepare(`
          INSERT INTO registros (id, usuario_email, store, dados, atualizado_em)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id, usuario_email, store)
          DO UPDATE SET dados = excluded.dados, atualizado_em = datetime('now')
        `)
        .bind(id, email, store, JSON.stringify(registro))
        .run();
      return json(registro);
    }

    if (request.method === 'DELETE' && id) {
      await db
        .prepare('DELETE FROM registros WHERE usuario_email = ? AND store = ? AND id = ?')
        .bind(email, store, id)
        .run();
      return json({ ok: true });
    }

    return json({ error: 'Rota ou método não suportado.' }, 405);
  } catch (erro) {
    return json({ error: erro.message || 'Erro interno ao acessar o banco.' }, 500);
  }
}