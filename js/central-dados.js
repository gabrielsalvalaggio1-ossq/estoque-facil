/**
 * js/central-dados.js — Central de Dados (MEV)
 *
 * Área de análises do sistema. Todo o cálculo é feito no navegador, em
 * memória, a partir dos mesmos dados já carregados em produtosCache/
 * vendasCache (js/app.js) — nenhuma rota nova de agregação no servidor,
 * seguindo a mesma filosofia do resto do projeto (zero build step).
 *
 * Dois níveis, de acordo com o plano da empresa (assinaturaCache.planoId):
 *   - Free:                não tem acesso (mostra tela de upgrade).
 *   - Essencial/Essencial Anual: indicadores + gráficos + listagens básicas.
 *   - Pro/Pro Anual:       tudo do Essencial + comparativos, inteligência de
 *                          vendas/estoque/clientes, financeiro, metas e
 *                          alertas automáticos.
 *
 * Depende de: Vendas.*, Produtos.*, formatarMoeda, escaparHtml (js/app.js),
 * DB.* (js/db.js). Não redefine nada que já exista — só combina.
 */

const CentralDados = (() => {

  // ── Constantes locais ────────────────────────────────────────────────────
  // Duplicado de app.js para que este módulo seja autocontido e não dependa
  // da ordem de carregamento de scripts externos (tarefa SEC-FUNC-09).
  const ROTULOS_PAGAMENTO = {
    dinheiro: '💵 Dinheiro',
    pix:      '🔑 Pix',
    cartao:   '💳 Cartão',
    fiado:    '📝 Fiado',
  };

  // ── Personalização de widgets (T11 — Dashboard Personalizável) ──────────
  // Camada de apresentação apenas: não altera nenhum cálculo de dados.
  // Cada card/seção do dashboard vira um "widget" com id fixo. Preferências
  // (widgets ocultos e ordem) ficam salvas em localStorage, por usuário.

  // Rótulos amigáveis usados na barra de "widgets ocultos" (chips de restaurar).
  const ROTULOS_WIDGET = {
    'indicadores':                    'Indicadores gerais',
    'grafico-vendas':                 'Evolução das vendas',
    'grafico-faturamento':            'Evolução do faturamento',
    'grafico-mais-vendidos':          'Produtos mais vendidos (gráfico)',
    'grafico-formas-pagamento':       'Formas de pagamento',
    'lista-ultimas-vendas':           'Últimas vendas',
    'lista-mais-vendidos':            'Produtos mais vendidos',
    'lista-estoque-baixo':            'Estoque baixo',
    'comparativos':                   'Comparativos',
    'alertas':                        'Alertas inteligentes',
    'lista-mais-lucrativos':          'Produtos mais lucrativos',
    'lista-giro':                     'Maior giro de estoque',
    'lista-parados':                  'Parados há mais de 30 dias',
    'padroes-venda':                  'Padrões de venda',
    'lista-estoque-categoria':        'Estoque por categoria',
    'lista-proximo-minimo':           'Próximos do estoque mínimo',
    'lista-melhores-clientes':        'Melhores clientes',
    'indicadores-estoque-financeiro': 'Indicadores de estoque e clientes',
    'metas':                          'Metas',
  };

  // Identifica o usuário dono das preferências. Se o app hospedeiro não
  // chamar CentralDados.definirUsuario(id), cai num id compartilhado —
  // funciona, só deixa de isolar por usuário no mesmo navegador.
  let usuarioIdAtual = 'default';
  function definirUsuario(id) {
    usuarioIdAtual = id ? String(id) : 'default';
  }

  function chavePrefsWidgets() {
    return `mev_cd_widgets::${usuarioIdAtual}`;
  }

  function carregarPrefsWidgets() {
    try {
      const bruto = localStorage.getItem(chavePrefsWidgets());
      if (!bruto) return { ocultos: [], ordem: [] };
      const dados = JSON.parse(bruto);
      return {
        ocultos: Array.isArray(dados.ocultos) ? dados.ocultos : [],
        ordem: Array.isArray(dados.ordem) ? dados.ordem : [],
      };
    } catch (e) {
      return { ocultos: [], ordem: [] };
    }
  }

  function salvarPrefsWidgets(prefs) {
    try { localStorage.setItem(chavePrefsWidgets(), JSON.stringify(prefs)); }
    catch (e) { /* localStorage indisponível (modo privado, quota etc.) — segue sem persistir */ }
  }

  function ocultarWidget(id) {
    const prefs = carregarPrefsWidgets();
    if (!prefs.ocultos.includes(id)) prefs.ocultos.push(id);
    salvarPrefsWidgets(prefs);
  }

  function mostrarWidget(id) {
    const prefs = carregarPrefsWidgets();
    prefs.ocultos = prefs.ocultos.filter(x => x !== id);
    salvarPrefsWidgets(prefs);
  }

  function salvarNovaOrdemWidgets(idsNaOrdem) {
    const prefs = carregarPrefsWidgets();
    prefs.ordem = idsNaOrdem;
    salvarPrefsWidgets(prefs);
  }

  function restaurarPadraoWidgets() {
    salvarPrefsWidgets({ ocultos: [], ordem: [] });
  }

  /** Aplica a ordem salva; widgets novos (sem ordem salva) vão ao final, na ordem natural. */
  function ordenarWidgets(widgets, ordemSalva) {
    if (!ordemSalva.length) return widgets;
    const porId = new Map(widgets.map(w => [w.id, w]));
    const ordenados = [];
    ordemSalva.forEach(id => {
      if (porId.has(id)) { ordenados.push(porId.get(id)); porId.delete(id); }
    });
    porId.forEach(w => ordenados.push(w));
    return ordenados;
  }

  /** Monta um widget: id estável + HTML do conteúdo (que já tem seu próprio card/h3). */
  function widget(id, html, opcoes = {}) {
    return { id, html, largo: !!opcoes.largo };
  }

  function renderWidget(w) {
    return `
      <div class="cd-widget${w.largo ? ' cd-widget-largo' : ''}" draggable="true" data-widget-id="${escaparHtml(w.id)}">
        <div class="cd-widget-controles">
          <span class="cd-widget-alca" title="Arrastar para reordenar" aria-hidden="true">⠿</span>
          <button type="button" class="cd-widget-fechar" data-acao="ocultar-widget" data-widget-id="${escaparHtml(w.id)}" title="Ocultar este widget">✕</button>
        </div>
        <div class="cd-widget-corpo">${w.html}</div>
      </div>`;
  }

  /** Aplica preferências (ordem + ocultos) e monta o grid arrastável + a barra de "ocultos". */
  function renderPainelWidgets(todosWidgets) {
    const prefs = carregarPrefsWidgets();
    const ordenados = ordenarWidgets(todosWidgets, prefs.ordem);
    const visiveis = ordenados.filter(w => !prefs.ocultos.includes(w.id));
    const ocultos = ordenados.filter(w => prefs.ocultos.includes(w.id));

    const barraOcultos = ocultos.length ? `
      <div class="cd-widgets-ocultos">
        <span class="cd-widgets-ocultos-rotulo">Ocultos:</span>
        ${ocultos.map(w => `
          <button type="button" class="cd-chip-oculto" data-acao="mostrar-widget" data-widget-id="${escaparHtml(w.id)}">
            + ${escaparHtml(ROTULOS_WIDGET[w.id] || w.id)}
          </button>`).join('')}
      </div>` : '';

    return `
      ${barraOcultos}
      <div class="cd-widgets" id="cdWidgets">
        ${visiveis.map(renderWidget).join('')}
      </div>`;
  }

  // ── Períodos ────────────────────────────────────────────────────────────

  function inicioDia(d = new Date()) {
    const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
  }
  function fimDia(d = new Date()) {
    const x = new Date(d); x.setHours(23, 59, 59, 999); return x;
  }
  function inicioMes(d = new Date()) {
    const x = inicioDia(d); x.setDate(1); return x;
  }
  function inicioAno(d = new Date()) {
    const x = inicioDia(d); x.setMonth(0, 1); return x;
  }

  const ROTULO_PERIODO = {
    hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias',
    '30dias': 'Últimos 30 dias', mes: 'Este mês', ano: 'Este ano',
    personalizado: 'Período personalizado',
  };

  /**
   * Calcula { inicio, fim } para um período nomeado. `personalizado` usa
   * as datas passadas em `extra`.
   */
  function limitesPeriodo(periodo, extra = {}) {
    const agora = new Date();
    switch (periodo) {
      case 'hoje':   return { inicio: inicioDia(agora), fim: fimDia(agora) };
      case 'ontem': {
        const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1);
        return { inicio: inicioDia(ontem), fim: fimDia(ontem) };
      }
      case '7dias': {
        const ini = new Date(agora); ini.setDate(ini.getDate() - 6);
        return { inicio: inicioDia(ini), fim: fimDia(agora) };
      }
      case '30dias': {
        const ini = new Date(agora); ini.setDate(ini.getDate() - 29);
        return { inicio: inicioDia(ini), fim: fimDia(agora) };
      }
      case 'ano':    return { inicio: inicioAno(agora), fim: fimDia(agora) };
      case 'personalizado':
        return {
          inicio: extra.inicio ? inicioDia(new Date(extra.inicio)) : inicioMes(agora),
          fim: extra.fim ? fimDia(new Date(extra.fim)) : fimDia(agora),
        };
      case 'mes':
      default:       return { inicio: inicioMes(agora), fim: fimDia(agora) };
    }
  }

  /** Período imediatamente anterior de mesma duração — para comparativos Pro. */
  function periodoAnterior({ inicio, fim }) {
    const duracaoMs = fim.getTime() - inicio.getTime();
    const novoFim = new Date(inicio.getTime() - 1);
    const novoInicio = new Date(novoFim.getTime() - duracaoMs);
    return { inicio: novoInicio, fim: novoFim };
  }

  function vendasNoPeriodo(vendas, { inicio, fim }) {
    return vendas.filter(v => {
      if (v.status === 'cancelada') return false;
      const d = new Date(v.data);
      return d >= inicio && d <= fim;
    });
  }

  // ── Indicadores básicos (Essencial + Pro) ─────────────────────────────────

  function calcularIndicadoresBasicos(vendas, produtos, periodo) {
    const vendasPeriodo = vendasNoPeriodo(vendas, periodo);
    const faturamento = vendasPeriodo.reduce((s, v) => s + v.total, 0);
    const qtdVendas = vendasPeriodo.length;
    const ticketMedio = qtdVendas ? faturamento / qtdVendas : 0;

    let lucro = 0, temCusto = false;
    vendasPeriodo.forEach(v => {
      v.itens.forEach(item => {
        const produto = produtos.find(p => p.nome === item.nome);
        if (produto && produto.precoCusto !== null && produto.precoCusto !== undefined) {
          temCusto = true;
          lucro += (item.preco - produto.precoCusto) * item.quantidade;
        }
      });
    });

    return {
      faturamento, qtdVendas, ticketMedio,
      lucro, temCusto,
      totalProdutos: produtos.length,
      totalClientes: new Set(vendas.filter(v => v.cliente).map(v => v.cliente)).size,
      vendasPeriodo,
    };
  }

  function faturamentoDoDia(todasVendas) {
    return vendasNoPeriodo(todasVendas, limitesPeriodo('hoje')).reduce((s, v) => s + v.total, 0);
  }

  // ── Comparativos (Pro) ────────────────────────────────────────────────────

  function variacaoPercentual(atual, anterior) {
    if (!anterior) return atual > 0 ? 100 : 0;
    return ((atual - anterior) / anterior) * 100;
  }

  function calcularComparativo(vendas, periodo) {
    const anterior = periodoAnterior(periodo);
    const atualFat = vendasNoPeriodo(vendas, periodo).reduce((s, v) => s + v.total, 0);
    const anteriorFat = vendasNoPeriodo(vendas, anterior).reduce((s, v) => s + v.total, 0);
    const atualQtd = vendasNoPeriodo(vendas, periodo).length;
    const anteriorQtd = vendasNoPeriodo(vendas, anterior).length;
    return {
      faturamento: { atual: atualFat, anterior: anteriorFat, variacao: variacaoPercentual(atualFat, anteriorFat) },
      vendas: { atual: atualQtd, anterior: anteriorQtd, variacao: variacaoPercentual(atualQtd, anteriorQtd) },
    };
  }

  // ── Inteligência de vendas (Pro) ───────────────────────────────────────

  function produtosMaisLucrativos(vendas, produtos, limite = 5) {
    const porProduto = {};
    vendas.filter(v => v.status !== 'cancelada').forEach(v => {
      v.itens.forEach(item => {
        const produto = produtos.find(p => p.nome === item.nome);
        if (!produto || produto.precoCusto === null || produto.precoCusto === undefined) return;
        const lucro = (item.preco - produto.precoCusto) * item.quantidade;
        porProduto[item.nome] = (porProduto[item.nome] || 0) + lucro;
      });
    });
    return Object.entries(porProduto).sort((a, b) => b[1] - a[1]).slice(0, limite)
      .map(([nome, lucro]) => ({ nome, lucro }));
  }

  function produtosSemVendaHaDias(vendas, produtos, diasMin = 30) {
    const ultimaVenda = {};
    vendas.filter(v => v.status !== 'cancelada').forEach(v => {
      v.itens.forEach(item => {
        const d = new Date(v.data);
        if (!ultimaVenda[item.nome] || d > ultimaVenda[item.nome]) ultimaVenda[item.nome] = d;
      });
    });
    const agora = new Date();
    return produtos
      .map(p => {
        const ultima = ultimaVenda[p.nome];
        const dias = ultima ? Math.floor((agora - ultima) / 86400000) : Infinity;
        return { nome: p.nome, dias: dias === Infinity ? null : dias, nuncaVendido: !ultima };
      })
      .filter(p => p.nuncaVendido || p.dias >= diasMin)
      .sort((a, b) => (b.dias ?? 99999) - (a.dias ?? 99999));
  }

  function giroPorProduto(vendas, produtos) {
    const qtdVendida = {};
    vendas.filter(v => v.status !== 'cancelada').forEach(v => {
      v.itens.forEach(item => { qtdVendida[item.nome] = (qtdVendida[item.nome] || 0) + item.quantidade; });
    });
    return produtos.map(p => ({
      nome: p.nome,
      giro: p.estoque > 0 ? (qtdVendida[p.nome] || 0) / p.estoque : (qtdVendida[p.nome] || 0),
    })).sort((a, b) => b.giro - a.giro);
  }

  function horariosComMaisVendas(vendas) {
    const porHora = new Array(24).fill(0);
    vendas.filter(v => v.status !== 'cancelada').forEach(v => {
      porHora[new Date(v.data).getHours()] += 1;
    });
    return porHora;
  }

  const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  function diasSemanaComMaisVendas(vendas) {
    const porDia = new Array(7).fill(0);
    vendas.filter(v => v.status !== 'cancelada').forEach(v => {
      porDia[new Date(v.data).getDay()] += 1;
    });
    return DIAS_SEMANA.map((nome, i) => ({ nome, total: porDia[i] }));
  }

  // ── Inteligência de estoque (Pro) ─────────────────────────────────────

  function inteligenciaEstoque(produtos, vendas) {
    const critico = produtos.filter(p => p.estoque <= (p.estoqueMinimo || 0));
    const semVenda = produtosSemVendaHaDias(vendas, produtos, 30);
    const valorEstoque = produtos.reduce((s, p) => s + p.preco * p.estoque, 0);

    const porCategoria = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Sem categoria';
      if (!porCategoria[cat]) porCategoria[cat] = { categoria: cat, itens: 0, valor: 0 };
      porCategoria[cat].itens += 1;
      porCategoria[cat].valor += p.preco * p.estoque;
    });

    return {
      critico,
      semVenda,
      valorEstoque,
      porCategoria: Object.values(porCategoria).sort((a, b) => b.valor - a.valor),
      proximosDoMinimo: produtos.filter(p => {
        const min = p.estoqueMinimo || 0;
        return p.estoque > min && p.estoque <= min * 1.5 + 2;
      }),
    };
  }

  // ── Inteligência de clientes (Pro) ────────────────────────────────────

  function inteligenciaClientes(vendas) {
    const historico = Vendas.calcularHistoricoClientes(vendas);
    const agora = new Date();
    const trintaDiasAtras = new Date(agora); trintaDiasAtras.setDate(agora.getDate() - 30);

    const inativos = historico.filter(c => new Date(c.ultimaCompra) < trintaDiasAtras);
    const recorrentes = historico.filter(c => c.totalCompras > 1);
    const ticketMedioPorCliente = historico.map(c => ({
      cliente: c.cliente, ticketMedio: c.totalGasto / c.totalCompras,
    })).sort((a, b) => b.ticketMedio - a.ticketMedio);

    const totalCompras = historico.reduce((s, c) => s + c.totalCompras, 0);
    const frequenciaMedia = historico.length ? totalCompras / historico.length : 0;

    return {
      ranking: historico.slice(0, 10),
      inativos,
      recorrentes,
      ticketMedioPorCliente: ticketMedioPorCliente.slice(0, 5),
      frequenciaMedia,
      totalClientes: historico.length,
    };
  }

  // ── Alertas inteligentes (Pro) ──────────────────────────────────────────

  function gerarAlertas(vendas, produtos, comparativo, inteligenciaEst, maisVendidos) {
    const alertas = [];
    if (inteligenciaEst.critico.length > 0) {
      alertas.push({ tipo: 'atencao', icone: '📦', texto: `${inteligenciaEst.critico.length} produto(s) com estoque baixo.` });
    }
    inteligenciaEst.semVenda.slice(0, 3).forEach(p => {
      alertas.push({ tipo: 'atencao', icone: '🐌', texto: p.nuncaVendido ? `"${p.nome}" ainda não teve nenhuma venda.` : `"${p.nome}" está há ${p.dias} dias sem venda.` });
    });
    if (comparativo.faturamento.variacao <= -15) {
      alertas.push({ tipo: 'alerta', icone: '📉', texto: `Queda de ${Math.abs(comparativo.faturamento.variacao).toFixed(0)}% no faturamento em relação ao período anterior.` });
    } else if (comparativo.faturamento.variacao >= 15) {
      alertas.push({ tipo: 'positivo', icone: '📈', texto: `Crescimento de ${comparativo.faturamento.variacao.toFixed(0)}% no faturamento em relação ao período anterior.` });
    }
    if (maisVendidos[0]) {
      alertas.push({ tipo: 'positivo', icone: '🏆', texto: `"${maisVendidos[0].nome}" é o produto campeão de vendas no período.` });
    }
    return alertas;
  }

  // ── Metas (Pro) ────────────────────────────────────────────────────────

  const NOME_TIPO_META = { faturamento: 'Faturamento', lucro: 'Lucro', vendas: 'Vendas' };

  /**
   * Progresso de uma meta SEMPRE em relação ao seu próprio período (mês/ano
   * corrente), nunca em relação ao filtro de período que a pessoa escolheu
   * pra olhar o resto do painel — senão uma meta anual apareceria "zerada"
   * ao filtrar por "Hoje", por exemplo.
   */
  function calcularProgressoMeta(meta, vendas, produtos) {
    const agora = new Date();
    const inicioPeriodo = meta.periodo === 'ano' ? inicioAno(agora) : inicioMes(agora);
    const fimPeriodo = meta.periodo === 'ano'
      ? new Date(agora.getFullYear(), 11, 31, 23, 59, 59)
      : new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59);

    const indicadoresDoPeriodoDaMeta = calcularIndicadoresBasicos(vendas, produtos, { inicio: inicioPeriodo, fim: fimPeriodo });

    let atual = 0;
    if (meta.tipo === 'faturamento') atual = indicadoresDoPeriodoDaMeta.faturamento;
    else if (meta.tipo === 'lucro') atual = indicadoresDoPeriodoDaMeta.lucro;
    else if (meta.tipo === 'vendas') atual = indicadoresDoPeriodoDaMeta.qtdVendas;

    const percentual = meta.valor ? Math.min((atual / meta.valor) * 100, 999) : 0;
    const faltam = Math.max(meta.valor - atual, 0);

    // Previsão simples: projeta o ritmo atual até o fim do período da meta.
    const diasTotais = Math.max(1, Math.round((fimPeriodo - inicioPeriodo) / 86400000));
    const diasPassados = Math.max(1, Math.round((agora - inicioPeriodo) / 86400000));
    const ritmoDiario = atual / diasPassados;
    const previsao = ritmoDiario * diasTotais;

    return { atual, percentual, faltam, previsao };
  }

  // ── Gráficos (canvas nativo, sem dependências) ────────────────────────

  function canvasComDpr(largura, altura) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = largura * dpr;
    canvas.height = altura * dpr;
    canvas.style.width = largura + 'px';
    canvas.style.height = altura + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx };
  }

  const COR_GRAFICO = ['#1B3A2F', '#D9A441', '#E2572B', '#5B6259', '#8A6A22'];

  /** Gráfico de linha simples (evolução no tempo). */
  function desenharLinha(container, pontos, { largura = 300, altura = 140, cor = '#1B3A2F' } = {}) {
    const { canvas, ctx } = canvasComDpr(largura, altura);
    container.appendChild(canvas);
    if (!pontos.length) { return; }
    const margem = 24;
    const maxVal = Math.max(...pontos.map(p => p.valor), 1);
    const passoX = (largura - margem * 2) / Math.max(pontos.length - 1, 1);

    ctx.strokeStyle = '#D9D4C2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margem, altura - margem);
    ctx.lineTo(largura - margem, altura - margem);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2.5;
    pontos.forEach((p, i) => {
      const x = margem + i * passoX;
      const y = altura - margem - (p.valor / maxVal) * (altura - margem * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = cor;
    pontos.forEach((p, i) => {
      const x = margem + i * passoX;
      const y = altura - margem - (p.valor / maxVal) * (altura - margem * 2);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** Gráfico de barras verticais. */
  function desenharBarras(container, itens, { largura = 300, altura = 160, cor = '#1B3A2F' } = {}) {
    const { canvas, ctx } = canvasComDpr(largura, altura);
    container.appendChild(canvas);
    if (!itens.length) return;
    const margem = 24;
    const maxVal = Math.max(...itens.map(i => i.valor), 1);
    const larguraBarra = (largura - margem * 2) / itens.length;

    itens.forEach((item, i) => {
      const alturaBarra = (item.valor / maxVal) * (altura - margem * 2);
      const x = margem + i * larguraBarra + larguraBarra * 0.15;
      const y = altura - margem - alturaBarra;
      const w = larguraBarra * 0.7;
      ctx.fillStyle = cor;
      ctx.beginPath();
      const r = Math.min(4, w / 2);
      ctx.moveTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, altura - margem);
      ctx.lineTo(x, altura - margem);
      ctx.closePath();
      ctx.fill();
    });

    ctx.strokeStyle = '#D9D4C2';
    ctx.beginPath();
    ctx.moveTo(margem, altura - margem);
    ctx.lineTo(largura - margem, altura - margem);
    ctx.stroke();
  }

  /** Gráfico de pizza/donut — usado para formas de pagamento. */
  function desenharPizza(container, itens, { largura = 160, altura = 160 } = {}) {
    const { canvas, ctx } = canvasComDpr(largura, altura);
    container.appendChild(canvas);
    const total = itens.reduce((s, i) => s + i.valor, 0);
    if (!total) return;
    const cx = largura / 2, cy = altura / 2, raio = Math.min(cx, cy) - 6;
    let anguloInicial = -Math.PI / 2;
    itens.forEach((item, i) => {
      const fracao = item.valor / total;
      const anguloFinal = anguloInicial + fracao * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, raio, anguloInicial, anguloFinal);
      ctx.closePath();
      ctx.fillStyle = COR_GRAFICO[i % COR_GRAFICO.length];
      ctx.fill();
      anguloInicial = anguloFinal;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, raio * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = 'var(--paper)'.includes('var') ? '#FBFAF3' : '#FBFAF3';
    ctx.fill();
  }

  // ── Séries auxiliares para os gráficos ────────────────────────────────

  /** Agrupa vendas por dia dentro do período, para os gráficos de evolução. */
  function serieDiaria(vendas, { inicio, fim }) {
    const dias = [];
    const cursor = inicioDia(inicio);
    while (cursor <= fim) {
      dias.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    // Limita a 30 pontos pra não poluir o gráfico em períodos longos (ex: ano).
    const passo = Math.max(1, Math.ceil(dias.length / 30));
    const diasAmostrados = dias.filter((_, i) => i % passo === 0);

    return diasAmostrados.map(dia => {
      const proximoCorte = new Date(dia); proximoCorte.setDate(proximoCorte.getDate() + passo);
      const doDia = vendas.filter(v => {
        if (v.status === 'cancelada') return false;
        const d = new Date(v.data);
        return d >= dia && d < proximoCorte;
      });
      return {
        rotulo: dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        vendas: doDia.length,
        faturamento: doDia.reduce((s, v) => s + v.total, 0),
      };
    });
  }

  function serieFormasPagamento(vendas) {
    const resumo = Vendas.calcularResumoFinanceiro(vendas.filter(v => v.status !== 'cancelada'));
    return Object.entries(resumo.porFormaPagamento)
      .filter(([, valor]) => valor > 0)
      .map(([forma, valor]) => ({ nome: ROTULOS_PAGAMENTO[forma] || forma, valor }));
  }

  // ── Render: HTML ────────────────────────────────────────────────────────

  function cartaoIndicador(rotulo, valor, sub = '') {
    return `
      <div class="cd-cartao">
        <p class="cd-cartao-rotulo">${escaparHtml(rotulo)}</p>
        <p class="cd-cartao-valor">${valor}</p>
        ${sub ? `<p class="cd-cartao-sub">${sub}</p>` : ''}
      </div>`;
  }

  function barraFiltros(periodoAtual, ehPro) {
    const periodos = ehPro
      ? ['hoje', 'ontem', '7dias', '30dias', 'mes', 'ano']
      : ['hoje', '7dias', '30dias', 'mes', 'ano'];
    return `
      <div class="cd-filtros">
        ${periodos.map(p => `
          <button type="button" class="cd-filtro-btn${p === periodoAtual ? ' ativo' : ''}" data-periodo="${p}">
            ${ROTULO_PERIODO[p]}
          </button>`).join('')}
      </div>`;
  }

  function telaUpgrade(planoNecessario) {
    return `
      <div class="page">
        <div class="cd-upgrade">
          <p class="cd-upgrade-emoji">📊</p>
          <h2>Central de Dados</h2>
          <p>Acompanhe faturamento, vendas e estoque em um painel completo. Este recurso está disponível a partir do plano ${planoNecessario === 'pro' ? 'Pro' : 'Essencial'}.</p>
          <button type="button" class="btn primary" data-acao="ir-para-assinatura">Ver planos</button>
        </div>
      </div>`;
  }

  function listaSimples(titulo, linhas) {
    if (!linhas.length) return `<div class="cd-bloco"><h3>${escaparHtml(titulo)}</h3><p class="cd-vazio">Sem dados suficientes ainda.</p></div>`;
    return `
      <div class="cd-bloco">
        <h3>${escaparHtml(titulo)}</h3>
        <ul class="cd-lista">
          ${linhas.join('')}
        </ul>
      </div>`;
  }

  /** Retorna a lista de widgets do plano Essencial (ordem natural/padrão). */
  function renderEssencial(dados, periodo, produtos, todasVendas) {
    const { faturamento, qtdVendas, ticketMedio, lucro, temCusto, totalProdutos, totalClientes, vendasPeriodo } = dados;
    const maisVendidos = Produtos.calcularMaisVendidos(vendasPeriodo, 5);
    const estoqueBaixo = produtos.filter(p => p.estoque <= (p.estoqueMinimo || 0)).slice(0, 6);
    const ultimasVendas = [...vendasPeriodo].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 6);

    return [
      widget('indicadores', `
        <div class="cd-grid-cartoes">
          ${cartaoIndicador('Faturamento do dia', formatarMoeda(faturamentoDoDia(todasVendas)))}
          ${cartaoIndicador('Faturamento no período', formatarMoeda(faturamento))}
          ${cartaoIndicador('Vendas', qtdVendas)}
          ${cartaoIndicador('Ticket médio', formatarMoeda(ticketMedio))}
          ${cartaoIndicador('Lucro no período', temCusto ? formatarMoeda(lucro) : '—', temCusto ? '' : 'Cadastre o preço de custo dos produtos para ver o lucro.')}
          ${cartaoIndicador('Produtos cadastrados', totalProdutos)}
          ${cartaoIndicador('Clientes cadastrados', totalClientes)}
        </div>`, { largo: true }),

      widget('grafico-vendas', `
        <div class="cd-bloco">
          <h3>Evolução das vendas</h3>
          <div class="cd-grafico-linha" data-grafico="vendas"></div>
        </div>`),

      widget('grafico-faturamento', `
        <div class="cd-bloco">
          <h3>Evolução do faturamento</h3>
          <div class="cd-grafico-linha" data-grafico="faturamento"></div>
        </div>`),

      widget('grafico-mais-vendidos', `
        <div class="cd-bloco">
          <h3>Produtos mais vendidos</h3>
          <div class="cd-grafico-barras" data-grafico="mais-vendidos"></div>
        </div>`),

      widget('grafico-formas-pagamento', `
        <div class="cd-bloco cd-bloco-pizza">
          <h3>Formas de pagamento</h3>
          <div class="cd-grafico-pizza" data-grafico="formas-pagamento"></div>
          <div class="cd-legenda" data-legenda="formas-pagamento"></div>
        </div>`),

      widget('lista-ultimas-vendas', listaSimples('Últimas vendas', ultimasVendas.map(v => `
        <li><span>${escaparHtml(v.cliente || 'Cliente não informado')}</span><span>${formatarMoeda(v.total)}</span></li>`))),

      widget('lista-mais-vendidos', listaSimples('Produtos mais vendidos', maisVendidos.map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span>${p.quantidade} un.</span></li>`))),

      widget('lista-estoque-baixo', listaSimples('Estoque baixo', estoqueBaixo.map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span class="cd-tag-alerta">${p.estoque} un.</span></li>`))),
    ];
  }

  function barraComparativo(rotulo, comp) {
    const positivo = comp.variacao >= 0;
    return `
      <div class="cd-comparativo">
        <span class="cd-comparativo-rotulo">${escaparHtml(rotulo)}</span>
        <span class="cd-comparativo-tag ${positivo ? 'cd-up' : 'cd-down'}">${positivo ? '▲' : '▼'} ${Math.abs(comp.variacao).toFixed(1)}%</span>
      </div>`;
  }

  function renderMetas(metas, vendas, produtos) {
    const cards = metas.map(m => {
      const p = calcularProgressoMeta(m, vendas, produtos);
      return `
        <div class="cd-meta">
          <div class="cd-meta-topo">
            <span>${NOME_TIPO_META[m.tipo]} · ${m.periodo === 'ano' ? 'Anual' : 'Mensal'}</span>
            <button type="button" class="cd-meta-excluir" data-acao="excluir-meta" data-id="${escaparHtml(m.id)}" title="Excluir meta">✕</button>
          </div>
          <div class="cd-meta-barra"><div class="cd-meta-progresso" style="width:${Math.min(p.percentual, 100)}%"></div></div>
          <div class="cd-meta-info">
            <span>${p.percentual.toFixed(0)}% atingido</span>
            <span>Faltam ${m.tipo === 'vendas' ? Math.ceil(p.faltam) : formatarMoeda(p.faltam)}</span>
          </div>
          <p class="cd-meta-previsao">Previsão para o fim do período: ${m.tipo === 'vendas' ? Math.round(p.previsao) : formatarMoeda(p.previsao)}</p>
        </div>`;
    }).join('');

    return `
      <div class="cd-bloco">
        <div class="cd-bloco-topo">
          <h3>Metas</h3>
          <button type="button" class="btn primary" data-acao="nova-meta" style="width:auto;padding:7px 14px;font-size:13px;">+ Nova meta</button>
        </div>
        ${metas.length ? `<div class="cd-metas-grid">${cards}</div>` : '<p class="cd-vazio">Nenhuma meta cadastrada ainda.</p>'}
      </div>`;
  }

  function renderAlertas(alertas) {
    if (!alertas.length) return '';
    return `
      <div class="cd-bloco">
        <h3>Alertas inteligentes</h3>
        <div class="cd-alertas">
          ${alertas.map(a => `<div class="cd-alerta cd-alerta-${a.tipo}"><span>${a.icone}</span><p>${escaparHtml(a.texto)}</p></div>`).join('')}
        </div>
      </div>`;
  }

  function renderPro(dados, periodo, produtos, vendas, metas) {
    const comparativo = calcularComparativo(vendas, periodo);
    const maisLucrativos = produtosMaisLucrativos(dados.vendasPeriodo, produtos, 5);
    const semVenda = produtosSemVendaHaDias(vendas, produtos, 30).slice(0, 6);
    const giro = giroPorProduto(dados.vendasPeriodo, produtos);
    const horarios = horariosComMaisVendas(dados.vendasPeriodo);
    const horaTopo = horarios.indexOf(Math.max(...horarios));
    const diasSemana = diasSemanaComMaisVendas(dados.vendasPeriodo).sort((a, b) => b.total - a.total);
    const estoqueInt = inteligenciaEstoque(produtos, vendas);
    const clientesInt = inteligenciaClientes(dados.vendasPeriodo);
    const alertas = gerarAlertas(vendas, produtos, comparativo, estoqueInt, Produtos.calcularMaisVendidos(dados.vendasPeriodo, 5));

    const widgets = [
      widget('comparativos', `
        <div class="cd-bloco">
          <h3>Comparativos</h3>
          <div class="cd-comparativos">
            ${barraComparativo('Faturamento vs. período anterior', comparativo.faturamento)}
            ${barraComparativo('Vendas vs. período anterior', comparativo.vendas)}
          </div>
        </div>`, { largo: true }),
    ];

    if (alertas.length) {
      widgets.push(widget('alertas', renderAlertas(alertas), { largo: true }));
    }

    widgets.push(
      widget('lista-mais-lucrativos', listaSimples('Produtos mais lucrativos', maisLucrativos.map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span>${formatarMoeda(p.lucro)}</span></li>`))),

      widget('lista-giro', listaSimples('Maior giro de estoque', giro.slice(0, 6).map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span>${p.giro.toFixed(2)}x</span></li>`))),

      widget('lista-parados', listaSimples('Parados há mais de 30 dias', semVenda.map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span class="cd-tag-alerta">${p.nuncaVendido ? 'Nunca vendido' : p.dias + ' dias'}</span></li>`))),

      widget('padroes-venda', `
        <div class="cd-bloco">
          <h3>Padrões de venda</h3>
          <p class="cd-destaque">Horário com mais vendas: <strong>${horarios.some(h=>h>0) ? horaTopo + 'h' : '—'}</strong> · Dia da semana mais forte: <strong>${diasSemana[0] && diasSemana[0].total > 0 ? diasSemana[0].nome : '—'}</strong></p>
          <div class="cd-grafico-barras" data-grafico="horarios"></div>
        </div>`, { largo: true }),

      widget('lista-estoque-categoria', listaSimples('Estoque por categoria', estoqueInt.porCategoria.slice(0, 6).map(c => `
        <li><span>${escaparHtml(c.categoria)}</span><span>${formatarMoeda(c.valor)}</span></li>`))),

      widget('lista-proximo-minimo', listaSimples('Próximos do estoque mínimo', estoqueInt.proximosDoMinimo.slice(0, 6).map(p => `
        <li><span>${escaparHtml(p.nome)}</span><span>${p.estoque} un.</span></li>`))),

      widget('lista-melhores-clientes', listaSimples('Melhores clientes', clientesInt.ranking.slice(0, 6).map(c => `
        <li><span>${escaparHtml(c.cliente)}</span><span>${formatarMoeda(c.totalGasto)}</span></li>`))),

      widget('indicadores-estoque-financeiro', `
        <div class="cd-grid-cartoes">
          ${cartaoIndicador('Valor financeiro em estoque', formatarMoeda(estoqueInt.valorEstoque))}
          ${cartaoIndicador('Clientes inativos (30+ dias)', clientesInt.inativos.length)}
          ${cartaoIndicador('Clientes recorrentes', clientesInt.recorrentes.length)}
          ${cartaoIndicador('Frequência média de compra', clientesInt.frequenciaMedia.toFixed(1) + 'x')}
        </div>`, { largo: true }),

      widget('metas', renderMetas(metas, vendas, produtos), { largo: true }),
    );

    return widgets;
  }

  // ── Estado do módulo ────────────────────────────────────────────────────

  let periodoAtual = 'mes';
  let metasCache = [];

  async function renderizar(produtos, vendas, assinatura) {
    const planoId = assinatura ? assinatura.planoId : 'free';
    const ehPago = planoId && planoId !== 'free';
    if (!ehPago) return telaUpgrade('essencial');

    const ehPro = planoId === 'pro' || planoId === 'pro_anual';
    const periodo = limitesPeriodo(periodoAtual);
    const dados = calcularIndicadoresBasicos(vendas, produtos, periodo);

    if (ehPro) {
      try { metasCache = await DB.listarMetas(); } catch (e) { metasCache = []; }
    }

    const todosWidgets = [
      ...renderEssencial(dados, periodo, produtos, vendas),
      ...(ehPro ? renderPro(dados, periodo, produtos, vendas, metasCache) : []),
    ];

    return `
      <div class="page cd-central">
        <div class="cd-topo">
          <h2>📊 Central de Dados</h2>
          <div class="cd-topo-acoes">
            <span class="cd-plano-tag">${ehPro ? 'Plano Pro' : 'Plano Essencial'}</span>
            <button type="button" class="cd-btn-restaurar" data-acao="restaurar-widgets" title="Restaurar layout padrão">↺ Restaurar padrão</button>
          </div>
        </div>
        ${barraFiltros(periodoAtual, ehPro)}
        <div id="cdConteudo">
          ${renderPainelWidgets(todosWidgets)}
        </div>
      </div>
    `;
  }

  function desenharGraficosNaTela(produtos, vendas) {
    const periodo = limitesPeriodo(periodoAtual);
    const serie = serieDiaria(vendasNoPeriodo(vendas, periodo), periodo);

    const elVendas = document.querySelector('[data-grafico="vendas"]');
    if (elVendas) desenharLinha(elVendas, serie.map(s => ({ valor: s.vendas })), { cor: '#1B3A2F' });

    const elFat = document.querySelector('[data-grafico="faturamento"]');
    if (elFat) desenharLinha(elFat, serie.map(s => ({ valor: s.faturamento })), { cor: '#D9A441' });

    const maisVendidos = Produtos.calcularMaisVendidos(vendasNoPeriodo(vendas, periodo), 5);
    const elBarras = document.querySelector('[data-grafico="mais-vendidos"]');
    if (elBarras) desenharBarras(elBarras, maisVendidos.map(p => ({ valor: p.quantidade })), { cor: '#E2572B' });

    const formas = serieFormasPagamento(vendasNoPeriodo(vendas, periodo));
    const elPizza = document.querySelector('[data-grafico="formas-pagamento"]');
    if (elPizza) desenharPizza(elPizza, formas);
    const elLegenda = document.querySelector('[data-legenda="formas-pagamento"]');
    if (elLegenda) {
      elLegenda.innerHTML = formas.map((f, i) => `
        <span class="cd-legenda-item"><i style="background:${COR_GRAFICO[i % COR_GRAFICO.length]}"></i>${escaparHtml(f.nome)}</span>`).join('');
    }

    const elHorarios = document.querySelector('[data-grafico="horarios"]');
    if (elHorarios) {
      const horarios = horariosComMaisVendas(vendasNoPeriodo(vendas, periodo));
      desenharBarras(elHorarios, horarios.map((v, h) => ({ valor: v })), { largura: 320, altura: 100, cor: '#5B6259' });
    }
  }

  /**
   * Arrastar e soltar nativo (HTML5 Drag and Drop API) para reordenar os
   * widgets. Enquanto arrasta, reordena o DOM em tempo real (comparando a
   * posição do cursor); a nova ordem é persistida em localStorage ao soltar.
   */
  function configurarArrastarWidgets() {
    const container = document.getElementById('cdWidgets');
    if (!container) return;
    let arrastando = null;

    function persistirOrdemAtual() {
      const ordem = Array.from(container.querySelectorAll('.cd-widget')).map(el => el.dataset.widgetId);
      salvarNovaOrdemWidgets(ordem);
    }

    container.querySelectorAll('.cd-widget').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        arrastando = el;
        el.classList.add('cd-widget-arrastando');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', el.dataset.widgetId); } catch (err) { /* ignora navegadores restritos */ }
        }
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('cd-widget-arrastando');
        arrastando = null;
        persistirOrdemAtual();
      });

      el.addEventListener('dragover', (e) => {
        if (!arrastando || arrastando === el) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const antes = (e.clientY - rect.top) < rect.height / 2;
        if (antes) container.insertBefore(arrastando, el);
        else container.insertBefore(arrastando, el.nextSibling);
      });
    });

    // Permite soltar depois do último widget (espaço vazio no fim do grid).
    container.addEventListener('dragover', (e) => { if (arrastando) e.preventDefault(); });
    container.addEventListener('drop', (e) => { e.preventDefault(); persistirOrdemAtual(); });
  }

  function inicializar(produtos, vendas, aoTrocarPeriodo) {
    desenharGraficosNaTela(produtos, vendas);
    configurarArrastarWidgets();

    document.querySelectorAll('[data-acao="ocultar-widget"]').forEach(botao => {
      botao.addEventListener('click', () => {
        ocultarWidget(botao.dataset.widgetId);
        aoTrocarPeriodo();
      });
    });

    document.querySelectorAll('[data-acao="mostrar-widget"]').forEach(botao => {
      botao.addEventListener('click', () => {
        mostrarWidget(botao.dataset.widgetId);
        aoTrocarPeriodo();
      });
    });

    const btnRestaurarWidgets = document.querySelector('[data-acao="restaurar-widgets"]');
    if (btnRestaurarWidgets) {
      btnRestaurarWidgets.addEventListener('click', async () => {
        const confirmou = typeof mostrarConfirm === 'function'
          ? await mostrarConfirm('Restaurar o layout padrão da Central de Dados? Todos os widgets ocultos voltam a aparecer e a ordem original é restaurada.', { confirmText: 'Restaurar', tipo: 'perigo' })
          : confirm('Restaurar o layout padrão da Central de Dados?');
        if (!confirmou) return;
        restaurarPadraoWidgets();
        aoTrocarPeriodo();
      });
    }

    document.querySelectorAll('.cd-filtro-btn').forEach(botao => {
      botao.addEventListener('click', () => {
        periodoAtual = botao.dataset.periodo;
        aoTrocarPeriodo();
      });
    });

    document.querySelectorAll('[data-acao="ir-para-assinatura"]').forEach(botao => {
      botao.addEventListener('click', () => {
        document.querySelector('[data-tab="assinatura"]')?.click();
      });
    });

    document.querySelectorAll('[data-acao="excluir-meta"]').forEach(botao => {
      botao.addEventListener('click', async () => {
        // Usa mostrarConfirm() do app.js (disponível em runtime); fallback para
        // confirm() nativo caso o módulo seja carregado isoladamente em testes.
        const confirmou = typeof mostrarConfirm === 'function'
          ? await mostrarConfirm('Excluir esta meta?', { confirmText: 'Excluir', tipo: 'perigo' })
          : confirm('Excluir esta meta?');
        if (!confirmou) return;
        try {
          await DB.excluirMeta(botao.dataset.id);
          aoTrocarPeriodo();
        } catch (erro) {
          const msg = erro.message || 'Não foi possível excluir a meta.';
          if (typeof mostrarToast === 'function') mostrarToast(msg, 'erro');
          else alert(msg);
        }
      });
    });

    const btnNovaMeta = document.querySelector('[data-acao="nova-meta"]');
    if (btnNovaMeta) btnNovaMeta.addEventListener('click', () => abrirFormularioMeta(aoTrocarPeriodo));
  }

  /**
   * Abre um modal próprio para criação de meta — substitui os três prompt()
   * nativos que existiam antes (UX-01). Usa as classes .confirm-dialog /
   * .confirm-actions / .modal-wrap já definidas em css/style.css.
   */
  function abrirFormularioMeta(aoSalvar) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap modal-wrap-centro';
    wrap.innerHTML = `
      <div class="confirm-dialog" style="gap:14px;min-width:280px;max-width:340px;">
        <p class="confirm-msg" style="font-weight:600;font-size:15px;margin:0;">Nova meta</p>

        <div class="field" style="display:flex;flex-direction:column;gap:4px;">
          <label for="metaTipo" style="font-size:13px;font-weight:500;color:#3d4b44;">Tipo</label>
          <select id="metaTipo" class="filtro-select" style="width:100%;">
            <option value="faturamento">Faturamento</option>
            <option value="lucro">Lucro</option>
            <option value="vendas">Número de vendas</option>
          </select>
        </div>

        <div class="field" style="display:flex;flex-direction:column;gap:4px;">
          <label for="metaPeriodo" style="font-size:13px;font-weight:500;color:#3d4b44;">Período</label>
          <select id="metaPeriodo" class="filtro-select" style="width:100%;">
            <option value="mes">Mês atual</option>
            <option value="ano">Ano atual</option>
          </select>
        </div>

        <div class="field" style="display:flex;flex-direction:column;gap:4px;">
          <label for="metaValor" style="font-size:13px;font-weight:500;color:#3d4b44;">Valor da meta (R$)</label>
          <input id="metaValor" type="number" min="1" step="any" placeholder="Ex: 5000"
                 class="filtro-select" style="width:100%;">
        </div>

        <p id="metaErro" style="color:#c0392b;font-size:13px;min-height:16px;margin:0;"></p>

        <div class="confirm-actions">
          <button class="btn ghost" id="metaCancelar">Cancelar</button>
          <button class="btn primary" id="metaSalvar">Salvar meta</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const fechar = () => wrap.remove();
    document.getElementById('metaCancelar').addEventListener('click', fechar);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) fechar(); });

    document.getElementById('metaSalvar').addEventListener('click', async () => {
      const tipo     = document.getElementById('metaTipo').value;
      const periodo  = document.getElementById('metaPeriodo').value;
      const valor    = Number(document.getElementById('metaValor').value);
      const erroEl   = document.getElementById('metaErro');
      const btnSalvar = document.getElementById('metaSalvar');

      if (!valor || valor <= 0) {
        erroEl.textContent = 'Informe um valor maior que zero.';
        return;
      }
      erroEl.textContent = '';
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando…';

      try {
        await DB.salvarMeta({ id: DB.gerarId(), tipo, periodo, valor });
        fechar();
        aoSalvar();
      } catch (erro) {
        erroEl.textContent = erro.message || 'Não foi possível criar a meta.';
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Salvar meta';
      }
    });

    // Foco automático no campo de valor ao abrir
    requestAnimationFrame(() => {
      const input = document.getElementById('metaValor');
      if (input) input.focus();
    });
  }

  return { renderizar, inicializar, ROTULO_PERIODO, definirUsuario };
})();