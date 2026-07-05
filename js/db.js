/**
 * db.js (versão multi-usuário / nuvem)
 * Camada única de acesso aos dados.
 *
 * Antes: falava com o IndexedDB do navegador (dados só naquele aparelho).
 * Agora: fala com a API em /api/... (functions/api/[[path]].js), que por sua
 * vez guarda tudo no D1, isolado por usuário logado via Cloudflare Access.
 *
 * IMPORTANTE: a interface pública (window.DB.*) continua EXATAMENTE igual à
 * versão anterior — por isso produtos.js, vendas.js e app.js não precisam
 * de nenhuma alteração. Só esta camada mudou de "onde" guarda os dados.
 */

const STORES = {
  PRODUTOS: 'produtos',
  VENDAS: 'vendas',
  MOVIMENTOS: 'movimentos'
};

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function tratarResposta(resp) {
  if (!resp.ok) {
    let mensagem = 'Erro ao comunicar com o servidor.';
    try {
      const corpo = await resp.json();
      if (corpo && corpo.error) mensagem = corpo.error;
    } catch (e) {
      // resposta sem corpo JSON — mantém a mensagem genérica
    }
    if (resp.status === 401) {
      mensagem = 'Sessão expirada ou acesso não autorizado. Faça login novamente.';
    }
    throw new Error(mensagem);
  }
  return resp.json();
}

async function adicionar(storeName, registro) {
  const resp = await fetch(`/api/${storeName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registro)
  });
  return tratarResposta(resp);
}

async function atualizar(storeName, registro) {
  const resp = await fetch(`/api/${storeName}/${encodeURIComponent(registro.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registro)
  });
  return tratarResposta(resp);
}

async function remover(storeName, id) {
  const resp = await fetch(`/api/${storeName}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  await tratarResposta(resp);
}

async function listarTodos(storeName) {
  const resp = await fetch(`/api/${storeName}`);
  return tratarResposta(resp);
}

async function buscarPorId(storeName, id) {
  const resp = await fetch(`/api/${storeName}/${encodeURIComponent(id)}`);
  return tratarResposta(resp);
}

async function buscarUsuarioLogado() {
  const resp = await fetch('/api/me');
  return tratarResposta(resp);
}

// --- Cadastro self-service (/api/empresas) ---
// Diferente do resto: essa rota é chamada quando a pessoa AINDA não tem
// empresa nenhuma — é ela que cria a empresa e vira "dono" automaticamente.

async function criarEmpresa(nomeEmpresa) {
  const resp = await fetch('/api/empresas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeEmpresa })
  });
  return tratarResposta(resp);
}

// --- Gestão de equipe (/api/membros) — só o "dono" tem acesso a essas rotas. ---

async function listarMembros() {
  const resp = await fetch('/api/membros');
  return tratarResposta(resp);
}

async function adicionarMembro(email, papel) {
  const resp = await fetch('/api/membros', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, papel })
  });
  return tratarResposta(resp);
}

async function removerMembro(email) {
  const resp = await fetch(`/api/membros/${encodeURIComponent(email)}`, {
    method: 'DELETE'
  });
  await tratarResposta(resp);
}

// Exposto globalmente porque o projeto usa scripts simples (sem bundler),
// mantendo a filosofia de "zero dependências, zero build step".
window.DB = {
  STORES,
  gerarId,
  adicionar,
  atualizar,
  remover,
  listarTodos,
  buscarPorId,
  buscarUsuarioLogado,
  criarEmpresa,
  listarMembros,
  adicionarMembro,
  removerMembro
};