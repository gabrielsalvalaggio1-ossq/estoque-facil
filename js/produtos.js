/**
 * produtos.js
 * Regras de negócio relacionadas a produtos/estoque.
 * Não sabe nada sobre HTML — só sobre dados e validações.
 */

async function listarProdutos() {
  const produtos = await DB.listarTodos(DB.STORES.PRODUTOS);
  return produtos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function validarProduto({ nome, preco, estoque }) {
  const erros = [];
  if (!nome || !nome.trim()) erros.push('Digite o nome do produto.');
  if (isNaN(preco) || preco < 0) erros.push('Digite um preço válido.');
  if (isNaN(estoque) || estoque < 0) erros.push('Digite uma quantidade em estoque válida.');
  return erros;
}

async function criarProduto({ nome, preco, estoque, estoqueMinimo }) {
  const erros = validarProduto({ nome, preco, estoque });
  if (erros.length) throw new Error(erros[0]);

  const agora = new Date().toISOString();
  const produto = {
    id: DB.gerarId(),
    nome: nome.trim(),
    preco: Number(preco),
    estoque: Number(estoque),
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    criadoEm: agora,
    atualizadoEm: agora
  };
  return DB.adicionar(DB.STORES.PRODUTOS, produto);
}

async function editarProduto(id, { nome, preco, estoque, estoqueMinimo }) {
  const erros = validarProduto({ nome, preco, estoque });
  if (erros.length) throw new Error(erros[0]);

  const existente = await DB.buscarPorId(DB.STORES.PRODUTOS, id);
  if (!existente) throw new Error('Produto não encontrado.');

  const atualizado = {
    ...existente,
    nome: nome.trim(),
    preco: Number(preco),
    estoque: Number(estoque),
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    atualizadoEm: new Date().toISOString()
  };
  return DB.atualizar(DB.STORES.PRODUTOS, atualizado);
}

async function excluirProduto(id) {
  return DB.remover(DB.STORES.PRODUTOS, id);
}

/**
 * Dá baixa no estoque de uma lista de itens vendidos.
 * Usado após confirmar uma venda.
 */
async function darBaixaEstoque(itens) {
  for (const item of itens) {
    const produto = await DB.buscarPorId(DB.STORES.PRODUTOS, item.produtoId);
    if (!produto) continue;
    produto.estoque = Math.max(0, produto.estoque - item.quantidade);
    produto.atualizadoEm = new Date().toISOString();
    await DB.atualizar(DB.STORES.PRODUTOS, produto);
  }
}

function calcularEstatisticas(produtos) {
  const totalItens = produtos.length;
  const valorEmEstoque = produtos.reduce((soma, p) => soma + p.preco * p.estoque, 0);
  const estoqueBaixo = produtos.filter(p => p.estoque <= (p.estoqueMinimo || 0)).length;
  return { totalItens, valorEmEstoque, estoqueBaixo };
}

window.Produtos = {
  listarProdutos,
  criarProduto,
  editarProduto,
  excluirProduto,
  darBaixaEstoque,
  calcularEstatisticas
};
