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

// Exposto globalmente porque o projeto usa scripts simples (sem bundler),
// mantendo a filosofia de "zero dependências, zero build step".
window.DB = {
  STORES,
  gerarId,
  adicionar,
  atualizar,
  remover,
  listarTodos,
  buscarPorId
};
