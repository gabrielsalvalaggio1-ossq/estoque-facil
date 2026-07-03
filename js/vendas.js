/**
 * vendas.js
 * Regras de negócio relacionadas ao registro de vendas.
 */

const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'cartao', 'fiado'];

async function listarVendas() {
  const vendas = await DB.listarTodos(DB.STORES.VENDAS);
  return vendas.sort((a, b) => new Date(b.data) - new Date(a.data));
}

/**
 * Registra uma venda e já dá baixa no estoque dos produtos envolvidos.
 * carrinho: [{ produtoId, nome, quantidade, precoUnitario }]
 * opcoes: { formaPagamento, cliente }
 */
async function registrarVenda(carrinho, opcoes = {}) {
  if (!carrinho || carrinho.length === 0) {
    throw new Error('O carrinho está vazio.');
  }

  const formaPagamento = FORMAS_PAGAMENTO.includes(opcoes.formaPagamento) ? opcoes.formaPagamento : 'dinheiro';
  const cliente = (opcoes.cliente || '').trim();

  const total = carrinho.reduce((soma, item) => soma + item.precoUnitario * item.quantidade, 0);

  const venda = {
    id: DB.gerarId(),
    data: new Date().toISOString(),
    itens: carrinho,
    total,
    formaPagamento,
    cliente,
    status: 'concluida'
  };

  await DB.adicionar(DB.STORES.VENDAS, venda);
  await Produtos.darBaixaEstoque(carrinho);

  return venda;
}

/**
 * Cancela uma venda sem excluí-la: marca status "cancelada" e devolve
 * os itens ao estoque. O histórico da venda continua visível.
 */
async function cancelarVenda(id) {
  const venda = await DB.buscarPorId(DB.STORES.VENDAS, id);
  if (!venda) throw new Error('Venda não encontrada.');
  if (venda.status === 'cancelada') return venda;

  await Produtos.restaurarEstoque(venda.itens);

  const atualizada = {
    ...venda,
    status: 'cancelada',
    canceladaEm: new Date().toISOString()
  };
  await DB.atualizar(DB.STORES.VENDAS, atualizada);
  return atualizada;
}

function inicioDoDia(data = new Date()) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

function inicioDaSemana(data = new Date()) {
  const d = inicioDoDia(data);
  const diaSemana = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - diaSemana);
  return d;
}

function inicioDoMes(data = new Date()) {
  const d = inicioDoDia(data);
  d.setDate(1);
  return d;
}

/** Filtra vendas por período (hoje/semana/mês/todas) e por status. */
function filtrarVendas(vendas, { periodo = 'todas', status = 'todas' } = {}) {
  let limite = null;
  if (periodo === 'hoje') limite = inicioDoDia();
  else if (periodo === 'semana') limite = inicioDaSemana();
  else if (periodo === 'mes') limite = inicioDoMes();

  return vendas.filter(v => {
    if (limite && new Date(v.data) < limite) return false;
    if (status === 'ativas' && v.status === 'cancelada') return false;
    if (status === 'canceladas' && v.status !== 'cancelada') return false;
    return true;
  });
}

function calcularTotalVendido(vendas) {
  return vendas
    .filter(v => v.status !== 'cancelada')
    .reduce((soma, v) => soma + v.total, 0);
}

function calcularVendasDoDia(vendas) {
  return calcularTotalVendido(filtrarVendas(vendas, { periodo: 'hoje' }));
}

function calcularVendasDoMes(vendas) {
  return calcularTotalVendido(filtrarVendas(vendas, { periodo: 'mes' }));
}

/**
 * Resumo financeiro simples: total vendido, total por forma de pagamento
 * e total de fiado em aberto (vendas fiado ainda não canceladas).
 * Vendas canceladas nunca entram nos totais.
 */
function calcularResumoFinanceiro(vendas) {
  const validas = vendas.filter(v => v.status !== 'cancelada');
  const totalVendido = validas.reduce((soma, v) => soma + v.total, 0);

  const porFormaPagamento = {};
  FORMAS_PAGAMENTO.forEach(f => { porFormaPagamento[f] = 0; });
  validas.forEach(v => {
    const forma = FORMAS_PAGAMENTO.includes(v.formaPagamento) ? v.formaPagamento : 'dinheiro';
    porFormaPagamento[forma] += v.total;
  });

  return {
    totalVendido,
    porFormaPagamento,
    totalFiadoEmAberto: porFormaPagamento.fiado
  };
}

/** Agrupa vendas válidas por cliente, para a exportação de clientes. */
function calcularHistoricoClientes(vendas) {
  const porCliente = {};
  vendas.forEach(v => {
    if (v.status === 'cancelada') return;
    const nome = (v.cliente || '').trim();
    if (!nome) return;
    if (!porCliente[nome]) porCliente[nome] = { cliente: nome, totalCompras: 0, totalGasto: 0, ultimaCompra: v.data };
    porCliente[nome].totalCompras += 1;
    porCliente[nome].totalGasto += v.total;
    if (new Date(v.data) > new Date(porCliente[nome].ultimaCompra)) porCliente[nome].ultimaCompra = v.data;
  });
  return Object.values(porCliente).sort((a, b) => b.totalGasto - a.totalGasto);
}

function gerarCsvVendas(vendas) {
  const linhas = [
    ['Data', 'Cliente', 'Itens', 'Forma de pagamento', 'Status', 'Total'].join(';')
  ];
  vendas.forEach(v => {
    const data = new Date(v.data).toLocaleString('pt-BR');
    const cliente = String(v.cliente || '').replace(/;/g, ',');
    const itens = v.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ').replace(/;/g, ',');
    linhas.push([data, cliente, itens, v.formaPagamento, v.status === 'cancelada' ? 'Cancelada' : 'Concluída', v.total.toFixed(2).replace('.', ',')].join(';'));
  });
  return linhas.join('\r\n');
}

function gerarCsvClientes(vendas) {
  const historico = calcularHistoricoClientes(vendas);
  const linhas = [
    ['Cliente', 'Total de compras', 'Total gasto', 'Última compra'].join(';')
  ];
  historico.forEach(c => {
    const nome = String(c.cliente).replace(/;/g, ',');
    linhas.push([nome, c.totalCompras, c.totalGasto.toFixed(2).replace('.', ','), new Date(c.ultimaCompra).toLocaleDateString('pt-BR')].join(';'));
  });
  return linhas.join('\r\n');
}

window.Vendas = {
  FORMAS_PAGAMENTO,
  listarVendas,
  registrarVenda,
  cancelarVenda,
  filtrarVendas,
  calcularTotalVendido,
  calcularVendasDoDia,
  calcularVendasDoMes,
  calcularResumoFinanceiro,
  calcularHistoricoClientes,
  gerarCsvVendas,
  gerarCsvClientes
};
