/**
 * functions/api/auth/[[path]].js
 *
 * Login e cadastro, dentro do MESMO projeto Cloudflare Pages que já serve
 * o app e a API de produtos/vendas/estoque. Isso é essencial: um cookie de
 * sessão só é enviado de volta pro mesmo domínio que o criou. O worker
 * separado (mev-api.SEU-USUARIO.workers.dev) nunca conseguiria autenticar
 * chamadas pra estoque-facil.pages.dev, porque são domínios diferentes de
 * verdade — não tem configuração de cookie que resolva isso entre domínios
 * que não compartilham um domínio-pai comum.
 *
 * Rotas:
 *   POST /api/auth/register        -> cria usuário + empresa própria (vira "dono"), já loga
 *   POST /api/auth/login           -> login por e-mail/senha, já loga
 *   GET  /api/auth/google          -> inicia o login com Google (redireciona)
 *   GET  /api/auth/google/callback -> volta do Google, cria sessão, redireciona pro app
 *   POST /api/auth/logout          -> encerra a sessão atual
 *
 * Variáveis de ambiente necessárias (configurar em Settings do projeto Pages,
 * não mais no worker separado):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT
 *   (GOOGLE_REDIRECT agora deve ser algo como
 *    https://estoque-facil.pages.dev/api/auth/google/callback — e esse
 *    mesmo valor precisa estar cadastrado no Google Cloud Console como
 *    redirect URI autorizado, substituindo o antigo do workers.dev)
 *
 * Requer o binding D1 "DB", igual o resto do projeto.
 */

const DURACAO_SESSAO_DIAS = 30;

function json(dados, status = 200, headersExtra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json', ...headersExtra }
  });
}

function cookieDeSessao(token) {
  const maxAge = DURACAO_SESSAO_DIAS * 24 * 60 * 60;
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesParaHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexParaBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// Comparação em tempo constante — evita vazar, por diferença de tempo de
// resposta, em quantos caracteres o hash calculado bate com o salvo.
function iguaisEmTempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

const PBKDF2_ITERACOES = 100000;

async function derivarPbkdf2(senha, saltBytes, iteracoes) {
  const chaveBase = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iteracoes, hash: 'SHA-256' },
    chaveBase,
    256
  );
  return bytesParaHex(new Uint8Array(bits));
}

// Senha: guardamos um hash com salt em senha_hash, pra nunca comparar senha
// em texto puro. Formato novo: "pbkdf2:iteracoes:saltHex:hashHex" — PBKDF2
// é deliberadamente lento (100 mil iterações), o que dificulta muito um
// ataque de força bruta caso o banco vaze algum dia. Contas criadas antes
// dessa mudança ainda têm o formato antigo "salt:hash" (SHA-256 simples);
// continuamos aceitando login nelas e migramos o hash pro formato novo
// automaticamente no primeiro login com sucesso (ver rota de login).
async function gerarHashDeSenha(senha) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await derivarPbkdf2(senha, saltBytes, PBKDF2_ITERACOES);
  return `pbkdf2:${PBKDF2_ITERACOES}:${bytesParaHex(saltBytes)}:${hashHex}`;
}

async function senhaConfere(senha, hashSalvo) {
  const valor = String(hashSalvo || '');

  if (valor.startsWith('pbkdf2:')) {
    const [, iteracoesStr, saltHex, hashHex] = valor.split(':');
    const iteracoes = parseInt(iteracoesStr, 10);
    if (!iteracoes || !saltHex || !hashHex) return false;
    const calculado = await derivarPbkdf2(senha, hexParaBytes(saltHex), iteracoes);
    return iguaisEmTempoConstante(calculado, hashHex);
  }

  // Formato antigo (contas criadas antes da migração pra PBKDF2).
  const [salt, hash] = valor.split(':');
  if (!salt || !hash) return false;
  const calculado = await sha256Hex(`${salt}:${senha}`);
  return iguaisEmTempoConstante(calculado, hash);
}

/** Cria a empresa "solo" pra um e-mail novo, se ele ainda não pertencer a nenhuma (tabela empresas/membros, fonte da verdade pra permissões). */
async function garantirEmpresaEMembro(db, email, nomeSugestao) {
  const existente = await db
    .prepare('SELECT empresa_id FROM membros WHERE usuario_email = ?')
    .bind(email)
    .first();
  if (existente) return existente.empresa_id;

  const empresaId = 'empresa-' + crypto.randomUUID().slice(0, 12);
  await db
    .prepare("INSERT INTO empresas (id, nome, dono_email, plano, criado_em) VALUES (?, ?, ?, 'gratis', datetime('now'))")
    .bind(empresaId, nomeSugestao || `Loja de ${email}`, email)
    .run();
  await db
    .prepare("INSERT INTO membros (empresa_id, usuario_email, papel, criado_em) VALUES (?, ?, 'dono', datetime('now'))")
    .bind(empresaId, email)
    .run();
  return empresaId;
}

/**
 * Cria uma sessão de verdade: gera um token aleatório de alta entropia,
 * guarda só o HASH dele na tabela sessoes (nunca o token em texto puro —
 * se o banco vazar um dia, os tokens salvos não servem pra nada sozinhos),
 * e devolve o token cru pra ir no cookie do navegador.
 */
async function criarSessao(db, usuarioId, request) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + DURACAO_SESSAO_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';

  await db
    .prepare('INSERT INTO sessoes (usuario_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(usuarioId, tokenHash, expiresAt, ip, userAgent)
    .run();

  return token;
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'Binding D1 "DB" não configurado.' }, 500);

  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\/auth\//, '').split('/').filter(Boolean);
  const rota = partes[0];

  try {
    // ---------- POST /api/auth/register ----------
    if (rota === 'register' && request.method === 'POST') {
      const { nome, email, senha } = await request.json();
      if (!email || !senha) return json({ ok: false, error: 'E-mail e senha são obrigatórios.' }, 400);

      const jaExiste = await db.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first();
      if (jaExiste) return json({ ok: false, error: 'Esse e-mail já tem cadastro.' }, 409);

      const senhaHash = await gerarHashDeSenha(senha);
      const resultado = await db
        .prepare('INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES (?, ?, ?, ?)')
        .bind(nome || 'Usuário', email, senhaHash, 'dono')
        .run();
      const usuarioId = resultado.meta.last_row_id;

      await garantirEmpresaEMembro(db, email, nome ? `Loja de ${nome}` : null);
      const token = await criarSessao(db, usuarioId, request);

      return json({ ok: true }, 200, { 'Set-Cookie': cookieDeSessao(token) });
    }

    // ---------- POST /api/auth/login ----------
    if (rota === 'login' && request.method === 'POST') {
      const { email, senha } = await request.json();
      const usuario = await db.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();

      if (!usuario) return json({ ok: false, error: 'Usuário não encontrado.' }, 401);
      if (usuario.senha_hash === 'google') {
        return json({ ok: false, error: 'Essa conta usa login com Google — use o botão "Entrar com Google".' }, 401);
      }
      if (!(await senhaConfere(senha, usuario.senha_hash))) {
        return json({ ok: false, error: 'Senha inválida.' }, 401);
      }

      // Login certo com um hash do formato antigo (SHA-256 simples): migra
      // silenciosamente pro PBKDF2 agora que temos a senha em mãos — assim
      // as contas mais antigas vão ficando mais seguras sem exigir nenhuma
      // ação da pessoa (ela nem percebe que isso aconteceu).
      if (!String(usuario.senha_hash).startsWith('pbkdf2:')) {
        const novoHash = await gerarHashDeSenha(senha);
        await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').bind(novoHash, usuario.id).run();
      }

      const tokenSessao = await criarSessao(db, usuario.id, request);
      return json({ ok: true, user: { nome: usuario.nome, email: usuario.email } }, 200, {
        'Set-Cookie': cookieDeSessao(tokenSessao)
      });
    }

    // ---------- GET /api/auth/google (inicia o login) ----------
    if (rota === 'google' && !partes[1] && request.method === 'GET') {
      const clientId = env.GOOGLE_CLIENT_ID;
      const redirectUri = env.GOOGLE_REDIRECT;
      if (!clientId || !redirectUri) {
        return json({ error: 'Variáveis GOOGLE_CLIENT_ID/GOOGLE_REDIRECT não configuradas neste projeto.' }, 500);
      }

      const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleUrl.searchParams.set('client_id', clientId);
      googleUrl.searchParams.set('redirect_uri', redirectUri);
      googleUrl.searchParams.set('response_type', 'code');
      googleUrl.searchParams.set('scope', 'email profile');

      return Response.redirect(googleUrl.toString(), 302);
    }

    // ---------- GET /api/auth/google/callback ----------
    if (rota === 'google' && partes[1] === 'callback') {
      const code = url.searchParams.get('code');
      if (!code) return json({ error: 'Google não retornou "code".' }, 400);

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.GOOGLE_REDIRECT,
          grant_type: 'authorization_code'
        })
      });
      const token = await tokenResp.json();
      if (!token.access_token) {
        return json({ error: 'Falha ao trocar code por token.', detalhe: token }, 400);
      }

      const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const googleUser = await userResp.json();
      if (!googleUser.email) {
        return json({ error: 'Google não retornou e-mail do usuário.' }, 400);
      }

      let usuario = await db.prepare('SELECT * FROM usuarios WHERE email = ?').bind(googleUser.email).first();
      if (!usuario) {
        const resultado = await db
          .prepare('INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES (?, ?, ?, ?)')
          .bind(googleUser.name || 'Usuário Google', googleUser.email, 'google', 'dono')
          .run();
        usuario = { id: resultado.meta.last_row_id };
      }

      await garantirEmpresaEMembro(db, googleUser.email, googleUser.name ? `Loja de ${googleUser.name}` : null);
      const tokenSessao = await criarSessao(db, usuario.id, request);

      return new Response(null, {
        status: 302,
        headers: {
          'Set-Cookie': cookieDeSessao(tokenSessao),
          'Location': '/index.html'
        }
      });
    }

    // ---------- POST /api/auth/logout ----------
    if (rota === 'logout' && request.method === 'POST') {
      const cookieHeader = request.headers.get('Cookie') || '';
      const match = cookieHeader.match(/session=([^;]+)/);
      if (match) {
        const tokenHash = await sha256Hex(match[1]);
        await db.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(tokenHash).run();
      }
      return json({ ok: true }, 200, {
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      });
    }

    return json({ error: 'Rota de autenticação não encontrada.' }, 404);
  } catch (erro) {
    return json({ error: 'Erro no servidor: ' + erro.message }, 500);
  }
}