/**
 * vendas.js
 * Regras de negócio relacionadas ao registro de vendas.
 */

async function listarVendas() {
  const vendas = await DB.listarTodos(DB.STORES.VENDAS);
  return vendas.sort((a, b) => new Date(b.data) - new Date(a.data));
}

/**
 * Registra uma venda e já dá baixa no estoque dos produtos envolvidos.
 * carrinho: [{ produtoId, nome, quantidade, precoUnitario }]
 */
async function registrarVenda(carrinho) {
  if (!carrinho || carrinho.length === 0) {
    throw new Error('O carrinho está vazio.');
  }

  const total = carrinho.reduce((soma, item) => soma + item.precoUnitario * item.quantidade, 0);

  const venda = {
    id: DB.gerarId(),
    data: new Date().toISOString(),
    itens: carrinho,
    total
  };

  await DB.adicionar(DB.STORES.VENDAS, venda);
  await Produtos.darBaixaEstoque(carrinho);

  return venda;
}

window.Vendas = {
  listarVendas,
  registrarVenda
};
