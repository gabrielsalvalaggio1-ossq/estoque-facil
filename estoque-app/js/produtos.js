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

function validarProduto({ nome, preco, estoque, precoCusto }) {
  const erros = [];
  if (!nome || !nome.trim()) erros.push('Digite o nome do produto.');
  if (isNaN(preco) || preco < 0) erros.push('Digite um preço válido.');
  if (isNaN(estoque) || estoque < 0) erros.push('Digite uma quantidade em estoque válida.');
  // Preço de custo é opcional (produtos antigos não têm e continuam válidos)
  // — só validamos quando alguém de fato preencheu um valor.
  if (precoCusto !== null && precoCusto !== undefined && (isNaN(precoCusto) || precoCusto < 0)) {
    erros.push('Digite um preço de custo válido, ou deixe o campo em branco.');
  }
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

/**
 * Normaliza o preço de custo pra sempre guardar `null` (não informado) ou
 * um número válido — nunca NaN, string vazia ou undefined soltos no banco.
 * Produtos cadastrados antes desse campo existir simplesmente não têm essa
 * chave, e todo o resto do código já trata isso como "sem custo" (ver
 * calcularLucroUnitario/calcularMargemLucro abaixo).
 */
function normalizarPrecoCusto(precoCusto) {
  if (precoCusto === null || precoCusto === undefined || precoCusto === '') return null;
  const numero = Number(precoCusto);
  return isNaN(numero) ? null : numero;
}

/**
 * Normaliza as dimensões físicas do produto (peso/altura/largura/comprimento
 * + unidades). Preparação para o futuro cálculo de frete da Loja Virtual —
 * nenhuma tela usa isso ainda pra cálculo, só grava e exibe. Todos os
 * valores numéricos são opcionais; `null` = não informado.
 */
function normalizarDimensoes(dimensoes) {
  if (!dimensoes) return null;
  const numeroOuNull = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const { peso, altura, largura, comprimento, unidadePeso, unidadeMedida } = dimensoes;
  const normalizado = {
    peso: numeroOuNull(peso),
    altura: numeroOuNull(altura),
    largura: numeroOuNull(largura),
    comprimento: numeroOuNull(comprimento),
    unidadePeso: unidadePeso === 'g' ? 'g' : 'kg',
    unidadeMedida: unidadeMedida === 'm' ? 'm' : 'cm'
  };
  // Se nada foi preenchido, não vale a pena guardar um objeto vazio.
  const algumValor = normalizado.peso !== null || normalizado.altura !== null || normalizado.largura !== null || normalizado.comprimento !== null;
  return algumValor ? normalizado : null;
}

async function criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, imagem, codigoBarras, unidade, precoCusto, dimensoes, codigo, fornecedor, marca }) {
  const precoCustoNormalizado = normalizarPrecoCusto(precoCusto);
  const erros = validarProduto({ nome, preco, estoque, precoCusto: precoCustoNormalizado });
  if (erros.length) throw new Error(erros[0]);

  const agora = new Date().toISOString();
  const estoqueInicial = Number(estoque);
  const produto = {
    id: DB.gerarId(),
    nome: nome.trim(),
    categoria: (categoria && categoria.trim()) ? categoria.trim() : CATEGORIA_PADRAO,
    unidade: unidade === 'kg' ? 'kg' : 'un',
    preco: Number(preco),
    precoCusto: precoCustoNormalizado,
    estoque: estoqueInicial,
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    imagem: imagem || null,
    codigoBarras: codigoBarras ? String(codigoBarras).trim() : '',
    // Campos opcionais (usados sobretudo pela Importação de Produtos; telas
    // antigas de cadastro simplesmente não os enviam e continuam OK).
    codigo: codigo ? String(codigo).trim() : '',
    fornecedor: fornecedor ? String(fornecedor).trim() : '',
    marca: marca ? String(marca).trim() : '',
    dimensoes: normalizarDimensoes(dimensoes),
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

async function editarProduto(id, { nome, preco, estoque, estoqueMinimo, categoria, imagem, codigoBarras, unidade, precoCusto, dimensoes, codigo, fornecedor, marca }) {
  const precoCustoNormalizado = precoCusto !== undefined ? normalizarPrecoCusto(precoCusto) : undefined;
  const erros = validarProduto({ nome, preco, estoque, precoCusto: precoCustoNormalizado });
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
    // undefined = campo nem foi enviado (mantém o que já existia, se houver);
    // isso é o que garante compatibilidade com produtos antigos sem custo.
    precoCusto: precoCustoNormalizado !== undefined ? precoCustoNormalizado : (existente.precoCusto ?? null),
    estoque: novoEstoque,
    estoqueMinimo: isNaN(estoqueMinimo) ? 0 : Number(estoqueMinimo),
    imagem: imagem !== undefined ? imagem : (existente.imagem || null),
    codigoBarras: codigoBarras !== undefined ? String(codigoBarras).trim() : (existente.codigoBarras || ''),
    codigo: codigo !== undefined ? String(codigo).trim() : (existente.codigo || ''),
    fornecedor: fornecedor !== undefined ? String(fornecedor).trim() : (existente.fornecedor || ''),
    marca: marca !== undefined ? String(marca).trim() : (existente.marca || ''),
    dimensoes: dimensoes !== undefined ? normalizarDimensoes(dimensoes) : (existente.dimensoes || null),
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
 * Usado após confirmar uma venda. Os itens são sempre produtos diferentes
 * (o carrinho é indexado por produtoId), então processá-los em paralelo é
 * seguro e evita esperar uma cadeia de requisições em série.
 */
async function darBaixaEstoque(itens) {
  await Promise.all(itens.map(async (item) => {
    const produto = await DB.buscarPorId(DB.STORES.PRODUTOS, item.produtoId);
    if (!produto) return;
    produto.estoque = Math.max(0, produto.estoque - item.quantidade);
    produto.totalSaidas = (produto.totalSaidas || 0) + item.quantidade;
    produto.atualizadoEm = new Date().toISOString();
    await DB.atualizar(DB.STORES.PRODUTOS, produto);
    await registrarMovimento({
      produtoId: produto.id, nomeProduto: produto.nome,
      tipo: 'saida', quantidade: item.quantidade, motivo: 'venda'
    });
  }));
}

/**
 * Devolve ao estoque os itens de uma venda cancelada.
 * Usado por Vendas.cancelarVenda — mantém o histórico consistente,
 * desfazendo a saída registrada no momento da venda. Mesma lógica de
 * paralelização de darBaixaEstoque, pelo mesmo motivo.
 */
async function restaurarEstoque(itens) {
  await Promise.all(itens.map(async (item) => {
    const produto = await DB.buscarPorId(DB.STORES.PRODUTOS, item.produtoId);
    if (!produto) return;
    produto.estoque = produto.estoque + item.quantidade;
    produto.totalSaidas = Math.max(0, (produto.totalSaidas || 0) - item.quantidade);
    produto.atualizadoEm = new Date().toISOString();
    await DB.atualizar(DB.STORES.PRODUTOS, produto);
    await registrarMovimento({
      produtoId: produto.id, nomeProduto: produto.nome,
      tipo: 'entrada', quantidade: item.quantidade, motivo: 'cancelamento'
    });
  }));
}

function calcularEstatisticas(produtos) {
  const totalItens = produtos.length;
  const valorEmEstoque = produtos.reduce((soma, p) => soma + p.preco * p.estoque, 0);
  const estoqueBaixo = produtos.filter(p => p.estoque <= (p.estoqueMinimo || 0)).length;
  return { totalItens, valorEmEstoque, estoqueBaixo };
}

/**
 * --- Preparação para Lucro / Relatórios / Dashboard / Painel do Gestor ---
 * Funções puras, isoladas aqui pra existir UM lugar só de onde qualquer
 * tela futura lê "quanto esse produto dá de lucro" — em vez de cada tela
 * reimplementar `preco - precoCusto` com sua própria lógica de "e se não
 * tiver custo cadastrado". Nenhuma tela usa isso ainda; é só a base.
 */

/** Lucro por unidade vendida. `null` quando o produto não tem custo cadastrado. */
function calcularLucroUnitario(produto) {
  if (produto.precoCusto === null || produto.precoCusto === undefined) return null;
  return produto.preco - produto.precoCusto;
}

/** Margem de lucro em %, ex: 35.5. `null` quando falta custo ou o preço é 0. */
function calcularMargemLucro(produto) {
  const lucro = calcularLucroUnitario(produto);
  if (lucro === null || !produto.preco) return null;
  return (lucro / produto.preco) * 100;
}

/**
 * Resumo agregado pra um futuro Dashboard/Painel do Gestor: quantos
 * produtos já têm custo cadastrado (pra saber se vale mostrar o card de
 * lucro, ou se ainda falta a maioria cadastrar) e o lucro potencial se
 * vender tudo que está em estoque hoje.
 */
function calcularResumoLucro(produtos) {
  const comCusto = produtos.filter(p => p.precoCusto !== null && p.precoCusto !== undefined);
  const lucroPotencialEstoque = comCusto.reduce(
    (soma, p) => soma + (p.preco - p.precoCusto) * p.estoque, 0
  );
  return {
    totalProdutos: produtos.length,
    produtosComCusto: comCusto.length,
    lucroPotencialEstoque
  };
}

/** Lista de categorias distintas já usadas, para popular o filtro. */
function listarCategorias(produtos) {
  const set = new Set(produtos.map(p => p.categoria || CATEGORIA_PADRAO));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Rótulo usado para agrupar/exibir produtos sem fornecedor definido. */
const SEM_FORNECEDOR = 'Sem fornecedor';

/** Lista de fornecedores distintos já usados, para popular o filtro/sugestões. */
function listarFornecedores(produtos) {
  const set = new Set(
    produtos
      .map(p => (p.fornecedor && String(p.fornecedor).trim()) || '')
      .filter(f => f !== '')
  );
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/**
 * Aplica busca por nome + filtro de categoria + filtro de fornecedor +
 * filtro de disponibilidade sobre a lista de produtos. Tudo em memória,
 * pensado para ser instantâneo.
 */
function filtrarProdutos(produtos, { busca = '', categoria = '', fornecedor = '', situacao = 'todos' } = {}) {
  const termo = busca.trim().toLowerCase();
  return produtos.filter(p => {
    if (termo && !p.nome.toLowerCase().includes(termo)) return false;
    if (categoria && (p.categoria || CATEGORIA_PADRAO) !== categoria) return false;
    if (fornecedor && ((p.fornecedor && String(p.fornecedor).trim()) || SEM_FORNECEDOR) !== fornecedor) return false;
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
    ['Produto', 'Categoria', 'Fornecedor', 'Unidade', 'Código de barras', 'Quantidade atual', 'Total de entradas', 'Total de saídas', 'Preço de venda', 'Preço de custo', 'Lucro unitário'].join(';')
  ];
  produtos.forEach(p => {
    const nome = String(p.nome || '').replace(/;/g, ',');
    const categoria = String(p.categoria || CATEGORIA_PADRAO).replace(/;/g, ',');
    const fornecedor = String(p.fornecedor || '').replace(/;/g, ',');
    const codigo = String(p.codigoBarras || '').replace(/;/g, ',');
    const unidade = p.unidade === 'kg' ? 'kg' : 'un';
    const precoCusto = p.precoCusto !== null && p.precoCusto !== undefined ? String(p.precoCusto).replace('.', ',') : '';
    const lucro = calcularLucroUnitario(p);
    const lucroTexto = lucro !== null ? String(lucro.toFixed(2)).replace('.', ',') : '';
    linhas.push([
      nome, categoria, fornecedor, unidade, codigo, p.estoque, p.totalEntradas || 0, p.totalSaidas || 0,
      String(p.preco).replace('.', ','), precoCusto, lucroTexto
    ].join(';'));
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
  SEM_FORNECEDOR,
  listarProdutos,
  criarProduto,
  editarProduto,
  excluirProduto,
  darBaixaEstoque,
  restaurarEstoque,
  calcularEstatisticas,
  listarCategorias,
  listarFornecedores,
  filtrarProdutos,
  calcularMaisVendidos,
  buscarPorCodigoBarras,
  listarMovimentos,
  gerarCsvEstoque,
  gerarCsvMovimentos,
  calcularLucroUnitario,
  calcularMargemLucro,
  calcularResumoLucro
};