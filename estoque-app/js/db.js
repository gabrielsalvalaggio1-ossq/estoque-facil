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
  MOVIMENTOS: 'movimentos',
  CLIENTES: 'clientes'
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

/**
 * Atualização atômica de estoque — substitui o padrão read-modify-write
 * que sofria de race condition quando dois vendedores vendiam o mesmo produto
 * simultaneamente. O UPDATE é executado no banco de forma atômica.
 *
 * @param {string} produtoId
 * @param {number} delta       Negativo = saída (venda), positivo = entrada (restauração)
 * @param {number} saidasDelta Variação em totalSaidas (positivo em saída, negativo em restauração)
 */
async function atualizarEstoque(produtoId, delta, saidasDelta) {
  const resp = await fetch(`/api/produtos/${encodeURIComponent(produtoId)}/estoque`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta, saidasDelta }),
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

/** Atualiza somente o nome da empresa do usuário logado (não altera nenhum outro dado). */
async function atualizarNomeEmpresa(nomeEmpresa) {
  const resp = await fetch('/api/empresas', {
    method: 'PUT',
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
  if (filtros.usuario) params.set('usuario', filtros.usuario);
  if (filtros.inicio) params.set('inicio', filtros.inicio);
  if (filtros.fim) params.set('fim', filtros.fim);
  if (filtros.limite) params.set('limite', String(filtros.limite));
  if (filtros.offset) params.set('offset', String(filtros.offset));
  const qs = params.toString();
  const resp = await fetch(`/api/atividades${qs ? '?' + qs : ''}`);
  return tratarResposta(resp);
}

// --- Metas (/api/metas) — Central de Dados > Metas, recurso exclusivo do
// plano Pro (o servidor confere de novo em functions/api/[[path]].js). ---

async function listarMetas() {
  return listarTodos('metas');
}

async function salvarMeta(meta) {
  return adicionar('metas', meta);
}

async function editarMeta(meta) {
  return atualizar('metas', meta);
}

async function excluirMeta(id) {
  return remover('metas', id);
}


// --- Checkout Mercado Pago (Checkout Transparente) ---
async function iniciarCheckout() {
  const resp = await fetch("/api/checkout-mp-iniciar");
  return tratarResposta(resp);
}

async function assinarComCartao({ metodo, token, planoId, nomeCartao, cpf, pagamentoId }) {
  const resp = await fetch("/api/checkout-mp-assinar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metodo: metodo || 'cartao', token, planoId, nomeCartao, cpf, pagamentoId }),
  });
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

// --- Clientes (/api/clientes) ---
// Segue exatamente o mesmo padrão genérico de listarTodos/buscarPorId/
// adicionar/atualizar/remover já usado por produtos e vendas — só com
// nomes de função específicos, como pedido no cadastro de clientes.

async function listarClientes() {
  return listarTodos(STORES.CLIENTES);
}

async function buscarClientePorId(id) {
  return buscarPorId(STORES.CLIENTES, id);
}

/**
 * Busca clientes pelo nome (contém, sem diferenciar maiúsculas/acentos
 * exatamente — comparação simples, suficiente para o autocomplete do
 * cadastro). Filtra no cliente porque a API não tem uma rota de busca
 * dedicada — mesma filosofia usada em Produtos.filtrarProdutos.
 */
async function buscarClientesPorNome(nome) {
  const termo = (nome || '').trim().toLowerCase();
  const todos = await listarClientes();
  if (!termo) return todos;
  return todos.filter(c => (c.nome || '').toLowerCase().includes(termo));
}

async function salvarCliente(cliente) {
  const registro = { ...cliente, id: cliente.id || gerarId() };
  return adicionar(STORES.CLIENTES, registro);
}

async function editarCliente(id, dados) {
  const registro = { ...dados, id };
  return atualizar(STORES.CLIENTES, registro);
}

async function excluirCliente(id) {
  return remover(STORES.CLIENTES, id);
}


// mantendo a filosofia de "zero dependências, zero build step".
window.DB = {
  STORES,
  gerarId,
  adicionar,
  atualizar,
  atualizarEstoque,
  remover,
  listarTodos,
  buscarPorId,
  buscarUsuarioLogado,
  criarEmpresa,
  atualizarNomeEmpresa,
  listarMembros,
  adicionarMembro,
  editarMembro,
  removerMembro,
  buscarAssinatura,
  mudarPlano,
  cancelarAssinatura,
  iniciarCheckout,
  assinarComCartao,
  listarAtividades,
  listarImportacoes,
  registrarImportacao,
  buscarMapeamentoImportacao,
  salvarMapeamentoImportacao,
  listarClientes,
  buscarClientePorId,
  buscarClientesPorNome,
  salvarCliente,
  editarCliente,
  excluirCliente,
  listarMetas,
  salvarMeta,
  editarMeta,
  excluirMeta
};