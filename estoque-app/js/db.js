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
    let corpo = null;
    try {
      corpo = await resp.json();
      if (corpo && corpo.error) mensagem = corpo.error;
    } catch (e) {
      // resposta sem corpo JSON — mantém a mensagem genérica
    }
    if (resp.status === 401) {
      mensagem = 'Sessão expirada ou acesso não autorizado. Faça login novamente.';
    }
    const erro = new Error(mensagem);
    // Repassa os metadados de recurso bloqueado por plano (ver INFO_RECURSOS
    // no backend), pra UI poder mostrar "recurso do plano X" com botão de
    // upgrade em vez de só uma mensagem de erro genérica.
    if (corpo && corpo.recurso) erro.recurso = corpo.recurso;
    if (corpo && corpo.planoAtual) erro.planoAtual = corpo.planoAtual;
    if (corpo && corpo.planoNecessario) erro.planoNecessario = corpo.planoNecessario;
    throw erro;
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

async function editarMembro(email, papel) {
  const resp = await fetch(`/api/membros/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ papel })
  });
  return tratarResposta(resp);
}

async function removerMembro(email) {
  const resp = await fetch(`/api/membros/${encodeURIComponent(email)}`, {
    method: 'DELETE'
  });
  await tratarResposta(resp);
}

// --- Assinatura/billing (/api/assinatura) — leitura pra todo mundo,
// escrita (trocar plano/cancelar) só o "dono" consegue de verdade (o
// servidor confere isso de novo, isto aqui só evita a chamada inútil). ---

async function buscarAssinatura() {
  const resp = await fetch('/api/assinatura');
  return tratarResposta(resp);
}

async function mudarPlano(planoId) {
  const resp = await fetch('/api/assinatura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'mudar_plano', planoId })
  });
  return tratarResposta(resp);
}

// --- Histórico de atividades (/api/atividades) — só o dono vê, recurso do plano Pro. ---

async function listarAtividades(filtros = {}) {
  const params = new URLSearchParams();
  if (filtros.store) params.set('store', filtros.store);
  if (filtros.limite) params.set('limite', String(filtros.limite));
  const qs = params.toString();
  const resp = await fetch(`/api/atividades${qs ? '?' + qs : ''}`);
  return tratarResposta(resp);
}

async function cancelarAssinatura(motivo) {
  const resp = await fetch('/api/assinatura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'cancelar', motivo })
  });
  return tratarResposta(resp);
}

// --- Importação de Produtos (/api/importacoes e /api/mapeamentos-importacao) ---
// Só dono/estoquista têm acesso (o servidor confere de novo; ver PERMISSOES
// em functions/api/[[path]].js). O processamento do arquivo acontece todo
// no navegador (js/importacao.js); o servidor só guarda o resumo da execução
// e os mapeamentos de coluna salvos.

async function listarImportacoes(limite) {
  const qs = limite ? `?limite=${encodeURIComponent(limite)}` : '';
  const resp = await fetch(`/api/importacoes${qs}`);
  return tratarResposta(resp);
}

async function registrarImportacao(resumo) {
  const resp = await fetch('/api/importacoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resumo)
  });
  return tratarResposta(resp);
}

async function buscarMapeamentoImportacao(origem) {
  const resp = await fetch(`/api/mapeamentos-importacao?origem=${encodeURIComponent(origem)}`);
  return tratarResposta(resp);
}

async function salvarMapeamentoImportacao(origem, mapeamento) {
  const resp = await fetch('/api/mapeamentos-importacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem, mapeamento })
  });
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
  buscarPorId,
  buscarUsuarioLogado,
  criarEmpresa,
  listarMembros,
  adicionarMembro,
  editarMembro,
  removerMembro,
  buscarAssinatura,
  mudarPlano,
  cancelarAssinatura,
  listarAtividades,
  listarImportacoes,
  registrarImportacao,
  buscarMapeamentoImportacao,
  salvarMapeamentoImportacao
};