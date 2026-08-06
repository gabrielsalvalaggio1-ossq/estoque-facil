/**
 * estoque-inteligencia.js
 * T6 — Inteligência do Estoque
 * Cálculos em memória sobre produtosCache + vendasCache.
 * Não faz nenhuma chamada ao D1 e não altera o schema do banco.
 *
 * Depende de: produtosCache, vendasCache (globais de ui-base.js)
 * Expõe: window.EstoqueInteligencia
 */

const EstoqueInteligencia = (() => {

  // ─── Constantes configuráveis ───────────────────────────────────────────────

  /** Dias sem venda para considerar produto "parado". */
  const DIAS_SEM_VENDA_PARADO = 30;

  /** Janela em dias para calcular média de giro e sugestão de compra. */
  const JANELA_GIRO_DIAS = 30;

  /** Tempo de reposição padrão em dias (pode ser sobrescrito por produto no futuro). */
  const TEMPO_REPOSICAO_DIAS_PADRAO = 7;

  /** Fator de segurança: pedir X% a mais que o consumo do período de reposição. */
  const FATOR_SEGURANCA = 1.2;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function diasAtras(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Agrega itens de vendas válidas (não canceladas) por produtoId.
   * Retorna Map<produtoId, { quantidadeTotal, receitaTotal, ultimaVenda: Date|null }>
   */
  function agregarVendasPorProduto(vendas, desde = null) {
    const mapa = new Map();
    vendas.forEach(v => {
      if (v.status === 'cancelada') return;
      if (desde && new Date(v.data) < desde) return;
      v.itens.forEach(item => {
        const atual = mapa.get(item.produtoId) || {
          quantidadeTotal: 0,
          receitaTotal: 0,
          ultimaVenda: null
        };
        atual.quantidadeTotal += Number(item.quantidade);
        atual.receitaTotal += Number(item.quantidade) * Number(item.precoUnitario);
        const dataItem = new Date(v.data);
        if (!atual.ultimaVenda || dataItem > atual.ultimaVenda) atual.ultimaVenda = dataItem;
        mapa.set(item.produtoId, atual);
      });
    });
    return mapa;
  }

  // ─── 1. Status de estoque (baixo / crítico / ok) ────────────────────────────

  /**
   * Retorna 'critico' | 'baixo' | 'ok'.
   * - 'critico': estoque == 0
   * - 'baixo': estoque > 0 mas ≤ estoqueMinimo
   * - 'ok': acima do mínimo
   */
  function statusEstoque(produto) {
    if (produto.estoque <= 0) return 'critico';
    if (produto.estoqueMinimo > 0 && produto.estoque <= produto.estoqueMinimo) return 'baixo';
    return 'ok';
  }

  // ─── 2. Produto parado ──────────────────────────────────────────────────────

  /**
   * Retorna true se o produto não teve nenhuma venda nos últimos DIAS_SEM_VENDA_PARADO dias.
   * Produtos sem nenhuma venda histórica também são considerados parados.
   */
  function ehProdutoParado(produtoId, mapaVendasGlobal) {
    const dados = mapaVendasGlobal.get(produtoId);
    if (!dados || !dados.ultimaVenda) return true;
    const limite = diasAtras(DIAS_SEM_VENDA_PARADO);
    return dados.ultimaVenda < limite;
  }

  // ─── 3. Giro de estoque (mês) ───────────────────────────────────────────────

  /**
   * Quantidade de unidades vendidas nos últimos JANELA_GIRO_DIAS dias.
   * Usado como proxy de "giro de estoque" para produtos de varejo.
   */
  function giroEstoque(produtoId, mapaVendasMes) {
    return (mapaVendasMes.get(produtoId)?.quantidadeTotal) || 0;
  }

  // ─── 4. Curva ABC ───────────────────────────────────────────────────────────

  /**
   * Classifica produtos em A / B / C pela receita dos últimos 30 dias.
   * A = top 20% da receita acumulada
   * B = próximos 30%
   * C = restante 50%
   *
   * Retorna Map<produtoId, 'A' | 'B' | 'C' | null>
   * null = produto não teve nenhuma venda no período (sem classificação)
   */
  function calcularCurvaABC(produtos, mapaVendasMes) {
    // Só classifica produtos com receita > 0 no período
    const comReceita = produtos
      .map(p => ({ id: p.id, receita: mapaVendasMes.get(p.id)?.receitaTotal || 0 }))
      .filter(x => x.receita > 0)
      .sort((a, b) => b.receita - a.receita);

    const totalReceita = comReceita.reduce((s, x) => s + x.receita, 0);

    const resultado = new Map();

    // Produtos sem receita ficam com null
    produtos.forEach(p => {
      if (!mapaVendasMes.has(p.id) || (mapaVendasMes.get(p.id)?.receitaTotal || 0) === 0) {
        resultado.set(p.id, null);
      }
    });

    if (totalReceita === 0) return resultado;

    let acumulado = 0;
    comReceita.forEach(x => {
      acumulado += x.receita;
      const pct = acumulado / totalReceita;
      if (pct <= 0.50) resultado.set(x.id, 'A');      // primeiros 50% acumulados → A
      else if (pct <= 0.80) resultado.set(x.id, 'B'); // 50–80% acumulados → B
      else resultado.set(x.id, 'C');                  // restante → C
    });

    return resultado;
  }

  // ─── 5. Sugestão de compra ──────────────────────────────────────────────────

  /**
   * Estima quantidade a pedir.
   * Fórmula: máx(0, ceil((mediaDiariaVendas × tempoReposicao × fatorSegurança) - estoqueAtual))
   * Retorna null se não houve vendas no período (sem base para estimar).
   */
  function sugestaoCompra(produto, mapaVendasMes, tempoReposicaoDias = TEMPO_REPOSICAO_DIAS_PADRAO) {
    const dados = mapaVendasMes.get(produto.id);
    if (!dados || dados.quantidadeTotal === 0) return null;

    const mediaDiaria = dados.quantidadeTotal / JANELA_GIRO_DIAS;
    const necessidade = mediaDiaria * tempoReposicaoDias * FATOR_SEGURANCA;
    const sugestao = Math.ceil(Math.max(0, necessidade - produto.estoque));
    return sugestao;
  }

  // ─── 6. Margem e lucro ──────────────────────────────────────────────────────

  /** Lucro unitário (R$). null se sem custo. Reaproveita lógica de produtos.js. */
  function lucroUnitario(produto) {
    if (produto.precoCusto === null || produto.precoCusto === undefined) return null;
    return produto.preco - produto.precoCusto;
  }

  /** Margem em % (ex: 35.5). null se sem custo ou preço zero. */
  function margemLucro(produto) {
    const lucro = lucroUnitario(produto);
    if (lucro === null || !produto.preco) return null;
    return (lucro / produto.preco) * 100;
  }

  // ─── API principal: enriquece lista de produtos com todos os indicadores ─────

  /**
   * Retorna um array de produtos enriquecidos com todos os indicadores T6.
   * Leve o suficiente para rodar a cada renderização.
   *
   * @param {Array} produtos - produtosCache
   * @param {Array} vendas   - vendasCache
   * @param {number} [tempoReposicaoDias]
   * @returns {Array<ProdutoEnriquecido>}
   */
  function enriquecerProdutos(produtos, vendas, tempoReposicaoDias = TEMPO_REPOSICAO_DIAS_PADRAO) {
    const inicioJanela = diasAtras(JANELA_GIRO_DIAS);
    const mapaVendasMes = agregarVendasPorProduto(vendas, inicioJanela);
    const mapaVendasGlobal = agregarVendasPorProduto(vendas); // sem filtro de data
    const curvaABC = calcularCurvaABC(produtos, mapaVendasMes);

    return produtos.map(p => ({
      ...p,
      _intel: {
        statusEstoque: statusEstoque(p),
        parado: ehProdutoParado(p.id, mapaVendasGlobal),
        giro: giroEstoque(p.id, mapaVendasMes),
        curvaABC: curvaABC.get(p.id) ?? null,
        sugestaoCompra: sugestaoCompra(p, mapaVendasMes, tempoReposicaoDias),
        lucroUnitario: lucroUnitario(p),
        margemLucro: margemLucro(p)
      }
    }));
  }

  // ─── Helpers de formatação para UI ─────────────────────────────────────────

  function badgeABC(curva) {
    if (!curva) return '';
    const cores = { A: '#1B3A2F', B: '#D9A441', C: '#9aaa98' };
    const titulos = {
      A: 'Curva A — produto de maior valor (top receita do mês)',
      B: 'Curva B — produto de valor intermediário',
      C: 'Curva C — produto de menor contribuição relativa'
    };
    return `<span class="badge-abc badge-abc-${curva.toLowerCase()}" title="${titulos[curva]}">${curva}</span>`;
  }

  function badgeStatusEstoque(status) {
    if (status === 'ok') return '';
    if (status === 'critico') return `<span class="badge-estoque critico" title="Sem estoque">Esgotado</span>`;
    return `<span class="badge-estoque baixo" title="Abaixo do mínimo">Estoque baixo</span>`;
  }

  function badgeParado(parado, giro) {
    if (!parado || giro > 0) return ''; // teve vendas no período — não está parado
    return `<span class="badge-parado" title="Nenhuma venda nos últimos 30 dias">Parado</span>`;
  }

  function textoGiro(giro) {
    if (giro === 0) return '';
    return `<span class="intel-giro" title="Unidades vendidas nos últimos 30 dias">${giro}× no mês</span>`;
  }

  function textoMargem(margem, lucro) {
    if (margem === null) return '';
    const cor = margem >= 30 ? 'verde' : margem >= 10 ? 'amarelo' : 'vermelho';
    return `<span class="intel-margem margem-${cor}" title="Margem de lucro">
      ${margem.toFixed(1)}% · +${lucro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
    </span>`;
  }

  function textoSugestao(sugestao, status) {
    if (sugestao === null || sugestao === 0) return '';
    const urgente = status === 'critico' || status === 'baixo';
    return `<span class="intel-sugestao ${urgente ? 'urgente' : ''}" title="Sugestão de compra baseada no giro dos últimos 30 dias">
      Pedir ${sugestao} ${urgente ? '⚠' : ''}
    </span>`;
  }

  // ─── Resumo agregado para o header do estoque ───────────────────────────────

  /**
   * Retorna { parados, criticos, curvaA, semMargem } para o painel de alertas.
   */
  function resumoInteligencia(produtosEnriquecidos) {
    let parados = 0, criticos = 0, curvaA = 0;
    produtosEnriquecidos.forEach(p => {
      if (p._intel.statusEstoque === 'critico') criticos++;
      if (p._intel.parado && p._intel.giro === 0) parados++;
      if (p._intel.curvaABC === 'A') curvaA++;
    });
    return { parados, criticos, curvaA };
  }

  return {
    // cálculos brutos
    enriquecerProdutos,
    resumoInteligencia,
    // formatadores de HTML
    badgeABC,
    badgeStatusEstoque,
    badgeParado,
    textoGiro,
    textoMargem,
    textoSugestao,
    // constantes expostas
    DIAS_SEM_VENDA_PARADO,
    JANELA_GIRO_DIAS,
    TEMPO_REPOSICAO_DIAS_PADRAO
  };

})();

window.EstoqueInteligencia = EstoqueInteligencia;
