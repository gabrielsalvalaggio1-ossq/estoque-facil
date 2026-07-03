/**
 * produtos.js
 * Regras de negócio relacionadas a produtos/estoque.
 * Não sabe nada sobre HTML — só sobre dados e validações.
 */

const CATEGORIA_PADRAO = 'Geral';

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

/** Encontra o produto dono de um código de barras, para o fluxo de "escanear e vender". */
function buscarPorCodigoBarras(produtos, codigo) {
  const alvo = String(codigo || '').trim();
  if (!alvo) return null;
  return produtos.find(p => p.codigoBarras && String(p.codigoBarras).trim() === alvo) || null;
}

/**
 * Registra um evento de entrada/saída no histórico de movimentos.
 * Usado para a exportação "Movimentações" — histórico completo, não só o total acumulado.
 */
async function registrarMovimento({ produtoId, nomeProduto, tipo, quantidade, motivo }) {
  if (!quantidade) return;
  await DB.adicionar(DB.STORES.MOVIMENTOS, {
    id: DB.gerarId(),
    produtoId,
    nomeProduto,
    tipo, // 'entrada' | 'saida'
    quantidade,
    motivo, // 'cadastro' | 'reposicao' | 'venda' | 'cancelamento'
    data: new Date().toISOString()
  });
}

async function listarMovimentos() {
  const movimentos = await DB.listarTodos(DB.STORES.MOVIMENTOS);
  return movimentos.sort((a, b) => new Date(b.data) - new Date(a.data));
}

async function criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, imagem, codigoBarras, unidade }) {
  const erros = validarProduto({ nome, preco, estoque });
  if (erros.length) throw new Error(erros[0]);

  const agora = new Date().toISOString();
  const estoqueInicial = Number(estoque);
  const produto = {
    id: DB.gerarId(),
    nome: nome.trim(),
    categoria: (categoria && categoria.trim()) ? categoria.trim() : CATEGORIA_PADRAO,
    unidade: unidade === 'kg' ? 'kg' : 'un',
    preco: Number(preco),
    estoque: estoqueInicial,
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    imagem: imagem || null,
    codigoBarras: codigoBarras ? String(codigoBarras).trim() : '',
    // Totais acumulados, usados no cartão do produto e na exportação de estoque.
    totalEntradas: estoqueInicial,
    totalSaidas: 0,
    criadoEm: agora,
    atualizadoEm: agora
  };
  await DB.adicionar(DB.STORES.PRODUTOS, produto);
  if (estoqueInicial > 0) {
    await registrarMovimento({
      produtoId: produto.id, nomeProduto: produto.nome,
      tipo: 'entrada', quantidade: estoqueInicial, motivo: 'cadastro'
    });
  }
  return produto;
}

async function editarProduto(id, { nome, preco, estoque, estoqueMinimo, categoria, imagem, codigoBarras, unidade }) {
  const erros = validarProduto({ nome, preco, estoque });
  if (erros.length) throw new Error(erros[0]);

  const existente = await DB.buscarPorId(DB.STORES.PRODUTOS, id);
  if (!existente) throw new Error('Produto não encontrado.');

  const novoEstoque = Number(estoque);
  // Se o usuário aumentou a quantidade na mão (reposição), conta como entrada.
  const diferenca = novoEstoque - existente.estoque;
  const entradasExtra = diferenca > 0 ? diferenca : 0;

  const atualizado = {
    ...existente,
    nome: nome.trim(),
    categoria: (categoria && categoria.trim()) ? categoria.trim() : CATEGORIA_PADRAO,
    unidade: unidade === 'kg' ? 'kg' : 'un',
    preco: Number(preco),
    estoque: novoEstoque,
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    imagem: imagem !== undefined ? imagem : (existente.imagem || null),
    codigoBarras: codigoBarras !== undefined ? String(codigoBarras).trim() : (existente.codigoBarras || ''),
    totalEntradas: (existente.totalEntradas || 0) + entradasExtra,
    totalSaidas: existente.totalSaidas || 0,
    atualizadoEm: new Date().toISOString()
  };
  await DB.atualizar(DB.STORES.PRODUTOS, atualizado);
  if (entradasExtra > 0) {
    await registrarMovimento({
      produtoId: id, nomeProduto: atualizado.nome,
      tipo: 'entrada', quantidade: entradasExtra, motivo: 'reposicao'
    });
  }
  return atualizado;
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
    produto.totalSaidas = (produto.totalSaidas || 0) + item.quantidade;
    produto.atualizadoEm = new Date().toISOString();
    await DB.atualizar(DB.STORES.PRODUTOS, produto);
    await registrarMovimento({
      produtoId: produto.id, nomeProduto: produto.nome,
      tipo: 'saida', quantidade: item.quantidade, motivo: 'venda'
    });
  }
}

/**
 * Devolve ao estoque os itens de uma venda cancelada.
 * Usado por Vendas.cancelarVenda — mantém o histórico consistente,
 * desfazendo a saída registrada no momento da venda.
 */
async function restaurarEstoque(itens) {
  for (const item of itens) {
    const produto = await DB.buscarPorId(DB.STORES.PRODUTOS, item.produtoId);
    if (!produto) continue;
    produto.estoque = produto.estoque + item.quantidade;
    produto.totalSaidas = Math.max(0, (produto.totalSaidas || 0) - item.quantidade);
    produto.atualizadoEm = new Date().toISOString();
    await DB.atualizar(DB.STORES.PRODUTOS, produto);
    await registrarMovimento({
      produtoId: produto.id, nomeProduto: produto.nome,
      tipo: 'entrada', quantidade: item.quantidade, motivo: 'cancelamento'
    });
  }
}

function calcularEstatisticas(produtos) {
  const totalItens = produtos.length;
  const valorEmEstoque = produtos.reduce((soma, p) => soma + p.preco * p.estoque, 0);
  const estoqueBaixo = produtos.filter(p => p.estoque <= (p.estoqueMinimo || 0)).length;
  return { totalItens, valorEmEstoque, estoqueBaixo };
}

/** Lista de categorias distintas já usadas, para popular o filtro. */
function listarCategorias(produtos) {
  const set = new Set(produtos.map(p => p.categoria || CATEGORIA_PADRAO));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Aplica busca por nome + filtro de categoria + filtro de disponibilidade
 * sobre a lista de produtos. Tudo em memória, pensado para ser instantâneo.
 */
function filtrarProdutos(produtos, { busca = '', categoria = '', situacao = 'todos' } = {}) {
  const termo = busca.trim().toLowerCase();
  return produtos.filter(p => {
    if (termo && !p.nome.toLowerCase().includes(termo)) return false;
    if (categoria && (p.categoria || CATEGORIA_PADRAO) !== categoria) return false;
    const baixo = p.estoque <= (p.estoqueMinimo || 0);
    if (situacao === 'baixo' && !baixo) return false;
    if (situacao === 'disponivel' && (p.estoque <= 0 || baixo)) return false;
    return true;
  });
}

/** Produtos mais vendidos, somando as quantidades das vendas não canceladas. */
function calcularMaisVendidos(vendas, limite = 3) {
  const contagem = {};
  vendas.forEach(v => {
    if (v.status === 'cancelada') return;
    v.itens.forEach(item => {
      contagem[item.nome] = (contagem[item.nome] || 0) + item.quantidade;
    });
  });
  return Object.entries(contagem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([nome, quantidade]) => ({ nome, quantidade }));
}

/**
 * Gera o conteúdo (texto) de um CSV do estoque atual, pronto para
 * abrir no Excel/Google Sheets. Separado por ; para abrir certo em
 * planilhas configuradas para português do Brasil.
 */
function gerarCsvEstoque(produtos) {
  const linhas = [
    ['Produto', 'Categoria', 'Unidade', 'Código de barras', 'Quantidade atual', 'Total de entradas', 'Total de saídas'].join(';')
  ];
  produtos.forEach(p => {
    const nome = String(p.nome || '').replace(/;/g, ',');
    const categoria = String(p.categoria || CATEGORIA_PADRAO).replace(/;/g, ',');
    const codigo = String(p.codigoBarras || '').replace(/;/g, ',');
    const unidade = p.unidade === 'kg' ? 'kg' : 'un';
    linhas.push([nome, categoria, unidade, codigo, p.estoque, p.totalEntradas || 0, p.totalSaidas || 0].join(';'));
  });
  return linhas.join('\r\n');
}

/** CSV com o histórico completo de movimentações (entradas e saídas). */
function gerarCsvMovimentos(movimentos) {
  const linhas = [
    ['Data', 'Produto', 'Tipo', 'Quantidade', 'Motivo'].join(';')
  ];
  const rotulosMotivo = {
    cadastro: 'Cadastro inicial',
    reposicao: 'Reposição manual',
    venda: 'Venda',
    cancelamento: 'Cancelamento de venda'
  };
  movimentos.forEach(m => {
    const data = new Date(m.data).toLocaleString('pt-BR');
    const nome = String(m.nomeProduto || '').replace(/;/g, ',');
    linhas.push([data, nome, m.tipo === 'entrada' ? 'Entrada' : 'Saída', m.quantidade, rotulosMotivo[m.motivo] || m.motivo].join(';'));
  });
  return linhas.join('\r\n');
}

window.Produtos = {
  CATEGORIA_PADRAO,
  listarProdutos,
  criarProduto,
  editarProduto,
  excluirProduto,
  darBaixaEstoque,
  restaurarEstoque,
  calcularEstatisticas,
  listarCategorias,
  filtrarProdutos,
  calcularMaisVendidos,
  buscarPorCodigoBarras,
  listarMovimentos,
  gerarCsvEstoque,
  gerarCsvMovimentos
};