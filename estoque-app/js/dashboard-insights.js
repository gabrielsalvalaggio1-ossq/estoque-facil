/**
 * dashboard-insights.js  (T10 — Dashboard Inteligente Pro)
 *
 * Funcionalidades do plano Pro:
 *   1. Filtro de período (hoje / esta semana / este mês / personalizado)
 *   2. Gráfico de vendas no período selecionado
 *   3. Produtos mais vendidos no período
 *   4. Clientes que mais compraram no período
 *   5. Maiores devedores de fiado
 *   6. Alertas de estoque baixo (quantidade abaixo do mínimo)
 *   7. Comparativo período vs período anterior
 *   8. Padrões de venda (melhor dia / horário de pico)
 *   9. Meta mensal rápida
 *
 * Estratégia: não toca em central-dados.js nem em outros arquivos existentes.
 * Aguarda o evento "cdRenderizado" ou usa MutationObserver no #cdConteudo
 * como fallback. Estado do filtro de período sobrevive à navegação entre abas
 * (salvo em this._periodoAtivo).
 *
 * Depende de: vendasCache, produtosCache, usuarioLogadoPapel,
 * formatarMoeda, escaparHtml (todos globais, definidos em app.js/db.js).
 */

;(function () {
  'use strict';

  // ── Constantes ────────────────────────────────────────────────────────────
  const CHAVE_META_RAPIDA   = 'mev_meta_mensal_rapida';
  const CHAVE_PERIODO       = 'mev_dashboard_periodo';
  const PERIODOS = ['hoje', 'semana', 'mes', 'personalizado'];

  // ── Estado persistido entre re-renders ───────────────────────────────────
  let _periodoAtivo = (function () {
    try { return localStorage.getItem(CHAVE_PERIODO) || 'mes'; } catch { return 'mes'; }
  })();
  let _dataInicio = null;
  let _dataFim    = null;

  // ── Helpers de data ───────────────────────────────────────────────────────
  function inicioDia(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function fimDia(d)    { const x = new Date(d); x.setHours(23,59,59,999); return x; }
  function inicioMes(d) { const x = inicioDia(d); x.setDate(1); return x; }
  function inicioSemana(d) {
    const x = inicioDia(d);
    x.setDate(x.getDate() - x.getDay()); // domingo
    return x;
  }
  function inicioMesAnterior(d) {
    const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() - 1); x.setHours(0,0,0,0);
    return x;
  }
  function fimMesAnterior(d) {
    const x = inicioMes(d); x.setMilliseconds(-1); return x;
  }
  function inicioSemanaAnterior(d) {
    const x = inicioSemana(d); x.setDate(x.getDate() - 7); return x;
  }
  function fimSemanaAnterior(d) {
    const x = inicioSemana(d); x.setMilliseconds(-1); return x;
  }
  function inicioOntem(d) {
    const x = inicioDia(d); x.setDate(x.getDate() - 1); return x;
  }
  function fimOntem(d) {
    return fimDia(inicioOntem(d));
  }

  /** Retorna { inicio, fim } para o período ativo. */
  function calcularIntervalo() {
    const agora = new Date();
    switch (_periodoAtivo) {
      case 'hoje':
        return { inicio: inicioDia(agora), fim: fimDia(agora) };
      case 'semana':
        return { inicio: inicioSemana(agora), fim: fimDia(agora) };
      case 'mes':
        return { inicio: inicioMes(agora), fim: fimDia(agora) };
      case 'personalizado':
        if (_dataInicio && _dataFim) {
          return { inicio: inicioDia(new Date(_dataInicio)), fim: fimDia(new Date(_dataFim)) };
        }
        return { inicio: inicioMes(agora), fim: fimDia(agora) };
      default:
        return { inicio: inicioMes(agora), fim: fimDia(agora) };
    }
  }

  /** Retorna { inicio, fim } do período equivalente anterior. */
  function calcularIntervaloAnterior(intervalo) {
    const agora = new Date();
    const duracao = intervalo.fim - intervalo.inicio;
    switch (_periodoAtivo) {
      case 'hoje':
        return { inicio: inicioOntem(agora), fim: fimOntem(agora) };
      case 'semana':
        return { inicio: inicioSemanaAnterior(agora), fim: fimSemanaAnterior(agora) };
      case 'mes':
        return { inicio: inicioMesAnterior(agora), fim: fimMesAnterior(agora) };
      default:
        // Período personalizado: desloca o mesmo número de ms
        return {
          inicio: new Date(intervalo.inicio.getTime() - duracao - 1),
          fim:    new Date(intervalo.inicio.getTime() - 1),
        };
    }
  }

  // ── Cálculos ──────────────────────────────────────────────────────────────

  function vendasValidas(vendas) {
    return (vendas || [])
      .filter(v => v.status !== 'cancelada')
      .map(v => ({ ...v, _d: new Date(v.data || v.criadoEm || 0) }));
  }

  function filtrarPorIntervalo(vv, intervalo) {
    return vv.filter(v => v._d >= intervalo.inicio && v._d <= intervalo.fim);
  }

  /** Série diária dentro do intervalo para o gráfico de barras. */
  function seriePeriodo(vendas, intervalo) {
    const vv = filtrarPorIntervalo(vendasValidas(vendas), intervalo);
    const dias = [];
    const d = new Date(intervalo.inicio);
    while (d <= intervalo.fim) {
      const ini = inicioDia(d);
      const fim = fimDia(d);
      const rot = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      dias.push({ rotulo: rot, inicio: ini, fim, total: 0, qtd: 0 });
      d.setDate(d.getDate() + 1);
    }
    vv.forEach(v => {
      const dia = dias.find(dd => v._d >= dd.inicio && v._d <= dd.fim);
      if (dia) { dia.total += v.total || 0; dia.qtd++; }
    });
    return dias;
  }

  /** Top N produtos mais vendidos no período por quantidade. */
  function topProdutos(vendas, intervalo, n = 5) {
    const vv = filtrarPorIntervalo(vendasValidas(vendas), intervalo);
    const mapa = {};
    vv.forEach(v => {
      (v.itens || []).forEach(item => {
        const nome = item.nome || item.id || '?';
        if (!mapa[nome]) mapa[nome] = { nome, qtd: 0, receita: 0 };
        mapa[nome].qtd     += item.quantidade || 1;
        mapa[nome].receita += (item.preco || 0) * (item.quantidade || 1);
      });
    });
    return Object.values(mapa)
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, n);
  }

  /** Top N clientes que mais compraram no período por valor. */
  function topClientes(vendas, intervalo, n = 5) {
    const vv = filtrarPorIntervalo(vendasValidas(vendas), intervalo);
    const mapa = {};
    vv.forEach(v => {
      const cliente = (v.cliente && v.cliente.nome) ? v.cliente.nome : (v.clienteNome || null);
      if (!cliente) return;
      if (!mapa[cliente]) mapa[cliente] = { nome: cliente, compras: 0, total: 0 };
      mapa[cliente].compras++;
      mapa[cliente].total += v.total || 0;
    });
    return Object.values(mapa)
      .sort((a, b) => b.total - a.total)
      .slice(0, n);
  }

  /** Maiores devedores de fiado (independente de período). */
  function maioresDevedores(vendas, n = 5) {
    const vv = vendasValidas(vendas);
    const mapa = {};
    vv.forEach(v => {
      // Fiado: pagamento = 'fiado' e ainda não quitado
      const eFiado = v.pagamento === 'fiado' || v.tipoPagamento === 'fiado';
      const quitado = v.fiadoQuitado || v.quitado || false;
      if (!eFiado || quitado) return;
      const cliente = (v.cliente && v.cliente.nome) ? v.cliente.nome : (v.clienteNome || 'Sem nome');
      if (!mapa[cliente]) mapa[cliente] = { nome: cliente, divida: 0, vendas: 0 };
      mapa[cliente].divida += v.total || 0;
      mapa[cliente].vendas++;
    });
    return Object.values(mapa)
      .sort((a, b) => b.divida - a.divida)
      .slice(0, n);
  }

  /** Produtos com estoque abaixo do mínimo. */
  function alertasEstoque(produtos) {
    return (produtos || [])
      .filter(p => {
        const min = p.estoqueMinimo != null ? Number(p.estoqueMinimo) : 0;
        return Number(p.estoque) <= min;
      })
      .sort((a, b) => Number(a.estoque) - Number(b.estoque));
  }

  /** Melhor dia da semana (histórico completo). */
  function melhorDiaSemana(vendas) {
    const DIAS_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const porDia = new Array(7).fill(0);
    vendasValidas(vendas).forEach(v => porDia[v._d.getDay()]++);
    const max = Math.max(...porDia);
    if (max === 0) return null;
    const idx = porDia.indexOf(max);
    return { nome: DIAS_FULL[idx], total: max, porDia };
  }

  /** Melhor faixa de 3 horas. */
  function melhorFaixaHorario(vendas) {
    const blocos = new Array(8).fill(0);
    vendasValidas(vendas).forEach(v => { blocos[Math.floor(v._d.getHours() / 3)]++; });
    const max = Math.max(...blocos);
    if (max === 0) return null;
    const idx = blocos.indexOf(max);
    return { label: `${idx*3}h–${idx*3+3}h`, total: max };
  }

  /** Comparativo período atual vs anterior. */
  function comparativoPeriodo(vendas, intervalo, intervaloAnt) {
    const vv = vendasValidas(vendas);
    const atual   = filtrarPorIntervalo(vv, intervalo);
    const anterior = filtrarPorIntervalo(vv, intervaloAnt);
    const recAtual    = atual.reduce((s, v) => s + (v.total || 0), 0);
    const recAnterior = anterior.reduce((s, v) => s + (v.total || 0), 0);
    function variacao(a, b) { if (!b) return a > 0 ? 100 : 0; return ((a - b) / b) * 100; }
    return {
      receita: { atual: recAtual,    anterior: recAnterior, var: variacao(recAtual, recAnterior) },
      qtd:     { atual: atual.length, anterior: anterior.length, var: variacao(atual.length, anterior.length) },
    };
  }

  /** Meta mensal rápida salva no localStorage. */
  function lerMetaRapida() {
    try { const r = localStorage.getItem(CHAVE_META_RAPIDA); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function salvarMetaRapida(valor) {
    try { localStorage.setItem(CHAVE_META_RAPIDA, JSON.stringify({ valor })); } catch {}
  }

  // ── SVG ───────────────────────────────────────────────────────────────────

  function svgBarrasPeriodo(serie) {
    const maxPontos = 31;
    const dados = serie.length > maxPontos
      ? serie.slice(serie.length - maxPontos)
      : serie;

    const W = 340, H = 100;
    const ML = 4, MR = 4, MB = 20, MT = 10;
    const areaW = W - ML - MR;
    const areaH = H - MT - MB;
    const n = dados.length;
    const gap = n > 14 ? 2 : 4;
    const barW = (areaW - gap * (n - 1)) / n;
    const maxVal = Math.max(...dados.map(d => d.total), 1);
    const mostrarRotulo = n <= 14;

    const barras = dados.map((d, i) => {
      const x = ML + i * (barW + gap);
      const h = Math.max((d.total / maxVal) * areaH, d.total > 0 ? 3 : 0);
      const y = MT + areaH - h;
      const hoje = i === dados.length - 1 && _periodoAtivo !== 'personalizado';
      const cor = hoje ? '#1B3A2F' : d.total > 0 ? '#C5B99A' : '#E8E4DB';
      const r = Math.min(3, barW / 2);
      const path = h > 0
        ? `M${x},${y+r} a${r},${r} 0 0 1 ${r},-${r} h${barW-2*r} a${r},${r} 0 0 1 ${r},${r} V${MT+areaH} H${x} Z`
        : '';
      const labelY = H - 4;
      return `
        ${path ? `<path d="${path}" fill="${cor}"/>` : `<rect x="${x}" y="${MT+areaH-1}" width="${barW}" height="1" fill="${cor}"/>`}
        ${mostrarRotulo ? `<text x="${x + barW/2}" y="${labelY}" font-family="IBM Plex Mono,monospace" font-size="7.5" fill="#6B7169" text-anchor="middle">${escaparHtml(d.rotulo)}</text>` : ''}
        ${d.total > 0 && barW > 18 ? `<text x="${x + barW/2}" y="${y - 3}" font-family="IBM Plex Mono,monospace" font-size="7" fill="${hoje ? '#1B3A2F' : '#8A6A22'}" text-anchor="middle">${formatarMoeda(d.total).replace('R$\u00a0','')}</text>` : ''}`;
    }).join('');

    // Linha de zero
    const zeroY = MT + areaH;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible;" xmlns="http://www.w3.org/2000/svg">
      <line x1="${ML}" y1="${zeroY}" x2="${W-MR}" y2="${zeroY}" stroke="#E0DDD5" stroke-width="1"/>
      ${barras}
    </svg>`;
  }

  function svgDiasSemana(porDia) {
    const DIAS = ['D','S','T','Q','Q','S','S'];
    const max = Math.max(...porDia, 1);
    const W = 200, H = 48, barW = 20, gap = 8;
    const areaH = H - 16;
    const totalW = 7 * barW + 6 * gap;
    const offsetX = (W - totalW) / 2;
    const barras = porDia.map((v, i) => {
      const h = Math.max((v / max) * areaH, v > 0 ? 2 : 0);
      const x = offsetX + i * (barW + gap);
      const cor = v === max ? '#1B3A2F' : '#D9D4C2';
      return `
        <rect x="${x}" y="${areaH - h}" width="${barW}" height="${h}" rx="3" fill="${cor}"/>
        <text x="${x + barW/2}" y="${H - 2}" font-size="8" font-family="IBM Plex Mono,monospace" fill="#5B6259" text-anchor="middle">${DIAS[i]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${barras}</svg>`;
  }

  // ── HTML dos blocos ───────────────────────────────────────────────────────

  function htmlFiltros() {
    const labels = { hoje: 'Hoje', semana: 'Esta semana', mes: 'Este mês', personalizado: 'Personalizado' };
    const btns = PERIODOS.map(p =>
      `<button class="di-filtro-btn${_periodoAtivo === p ? ' ativo' : ''}" data-di-periodo="${p}">${labels[p]}</button>`
    ).join('');

    const mostrarCustom = _periodoAtivo === 'personalizado';
    const customHtml = mostrarCustom ? `
      <div class="di-custom-datas">
        <input type="date" id="diDataInicio" class="di-input di-input-data" value="${_dataInicio || ''}" placeholder="Início"/>
        <span class="di-custom-sep">→</span>
        <input type="date" id="diDataFim" class="di-input di-input-data" value="${_dataFim || ''}" placeholder="Fim"/>
        <button class="btn primary di-btn-aplicar" style="padding:8px 14px;font-size:13px;width:auto;">Aplicar</button>
      </div>` : '';

    return `<div class="di-filtros-wrap">
      <div class="di-filtros-btns">${btns}</div>
      ${customHtml}
    </div>`;
  }

  function tagVariacao(v) {
    if (Math.abs(v) < 1) return `<span class="di-tag neutro">→ estável</span>`;
    const p = v > 0;
    return `<span class="di-tag ${p ? 'up' : 'down'}">${p ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
  }

  function htmlComparativo(comp) {
    const labels = { hoje: 'ontem', semana: 'semana passada', mes: 'mês anterior', personalizado: 'período anterior' };
    const sub = labels[_periodoAtivo] || 'período anterior';
    return `<div class="di-bloco di-bloco-comparativo">
      <p class="di-titulo-secao">📅 Resultado do período vs. ${sub}</p>
      <div class="di-comp-grid">
        <div class="di-comp-item">
          <span class="di-comp-label">Receita</span>
          <span class="di-comp-val">${formatarMoeda(comp.receita.atual)}</span>
          ${tagVariacao(comp.receita.var)}
          <span class="di-comp-sub">Ant.: ${formatarMoeda(comp.receita.anterior)}</span>
        </div>
        <div class="di-comp-item">
          <span class="di-comp-label">Vendas</span>
          <span class="di-comp-val">${comp.qtd.atual}</span>
          ${tagVariacao(comp.qtd.var)}
          <span class="di-comp-sub">Ant.: ${comp.qtd.anterior}</span>
        </div>
      </div>
    </div>`;
  }

  function htmlGraficoPeriodo(serie) {
    const totalReceita = serie.reduce((s, d) => s + d.total, 0);
    const totalVendas  = serie.reduce((s, d) => s + d.qtd, 0);
    const ticketMedio  = totalVendas > 0 ? totalReceita / totalVendas : 0;
    return `<div class="di-bloco">
      <div class="di-grafico-header">
        <p class="di-titulo-secao">📊 Vendas no período</p>
        <div class="di-grafico-kpis">
          <span class="di-kpi"><span class="di-kpi-val">${formatarMoeda(totalReceita)}</span><span class="di-kpi-label">receita</span></span>
          <span class="di-kpi-sep">·</span>
          <span class="di-kpi"><span class="di-kpi-val">${totalVendas}</span><span class="di-kpi-label">vendas</span></span>
          <span class="di-kpi-sep">·</span>
          <span class="di-kpi"><span class="di-kpi-val">${formatarMoeda(ticketMedio)}</span><span class="di-kpi-label">ticket médio</span></span>
        </div>
      </div>
      <div class="di-grafico-wrap">${svgBarrasPeriodo(serie)}</div>
      ${serie.every(d => d.total === 0) ? `<p class="di-vazio">Nenhuma venda registrada neste período.</p>` : ''}
    </div>`;
  }

  function htmlTopProdutos(produtos) {
    if (!produtos.length) return `<div class="di-bloco">
      <p class="di-titulo-secao">🏆 Produtos mais vendidos</p>
      <p class="di-vazio">Nenhuma venda com itens neste período.</p>
    </div>`;

    const maxQtd = produtos[0].qtd;
    const itens = produtos.map((p, i) => {
      const pct = maxQtd > 0 ? (p.qtd / maxQtd) * 100 : 0;
      return `<li class="di-ranking-item">
        <span class="di-ranking-pos">${i + 1}</span>
        <div class="di-ranking-info">
          <span class="di-ranking-nome">${escaparHtml(p.nome)}</span>
          <div class="di-ranking-barra-wrap">
            <div class="di-ranking-barra" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>
        <div class="di-ranking-nums">
          <span class="di-ranking-qtd">${p.qtd}×</span>
          <span class="di-ranking-rec">${formatarMoeda(p.receita)}</span>
        </div>
      </li>`;
    }).join('');

    return `<div class="di-bloco">
      <p class="di-titulo-secao">🏆 Produtos mais vendidos</p>
      <ul class="di-ranking-lista">${itens}</ul>
    </div>`;
  }

  function htmlTopClientes(clientes) {
    if (!clientes.length) return `<div class="di-bloco">
      <p class="di-titulo-secao">👥 Clientes que mais compraram</p>
      <p class="di-vazio">Nenhuma venda identificada a clientes neste período.</p>
    </div>`;

    const maxTotal = clientes[0].total;
    const itens = clientes.map((c, i) => {
      const pct = maxTotal > 0 ? (c.total / maxTotal) * 100 : 0;
      return `<li class="di-ranking-item">
        <span class="di-ranking-pos">${i + 1}</span>
        <div class="di-ranking-info">
          <span class="di-ranking-nome">${escaparHtml(c.nome)}</span>
          <div class="di-ranking-barra-wrap">
            <div class="di-ranking-barra di-ranking-barra--cliente" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>
        <div class="di-ranking-nums">
          <span class="di-ranking-qtd">${c.compras}×</span>
          <span class="di-ranking-rec">${formatarMoeda(c.total)}</span>
        </div>
      </li>`;
    }).join('');

    return `<div class="di-bloco">
      <p class="di-titulo-secao">👥 Clientes que mais compraram</p>
      <ul class="di-ranking-lista">${itens}</ul>
    </div>`;
  }

  function htmlDevedores(devedores) {
    if (!devedores.length) return `<div class="di-bloco di-bloco-ok">
      <p class="di-titulo-secao">💳 Fiado em aberto</p>
      <p class="di-vazio di-vazio-ok">✓ Nenhum fiado em aberto. Ótimo!</p>
    </div>`;

    const totalDivida = devedores.reduce((s, d) => s + d.divida, 0);
    const itens = devedores.map((d, i) => `
      <li class="di-devedor-item">
        <span class="di-ranking-pos">${i + 1}</span>
        <span class="di-devedor-nome">${escaparHtml(d.nome)}</span>
        <div class="di-devedor-right">
          <span class="di-devedor-count">${d.vendas} venda${d.vendas > 1 ? 's' : ''}</span>
          <span class="di-devedor-val">${formatarMoeda(d.divida)}</span>
        </div>
      </li>`).join('');

    return `<div class="di-bloco di-bloco-alerta">
      <div class="di-bloco-topo-row">
        <p class="di-titulo-secao">💳 Maiores devedores de fiado</p>
        <span class="di-total-divida">Total: ${formatarMoeda(totalDivida)}</span>
      </div>
      <ul class="di-devedor-lista">${itens}</ul>
    </div>`;
  }

  function htmlAlertasEstoque(itens) {
    if (!itens.length) return `<div class="di-bloco di-bloco-ok">
      <p class="di-titulo-secao">📦 Estoque baixo</p>
      <p class="di-vazio di-vazio-ok">✓ Todos os produtos acima do estoque mínimo.</p>
    </div>`;

    const criticos  = itens.filter(p => Number(p.estoque) === 0);
    const baixos    = itens.filter(p => Number(p.estoque) > 0);

    const renderItem = p => {
      const min = p.estoqueMinimo != null ? Number(p.estoqueMinimo) : 0;
      const zerado = Number(p.estoque) === 0;
      return `<li class="di-estoque-item${zerado ? ' di-estoque-zerado' : ''}">
        <span class="di-estoque-nome">${escaparHtml(p.nome || p.id)}</span>
        <div class="di-estoque-right">
          <span class="di-estoque-min">mín: ${min}</span>
          <span class="di-estoque-atual">${zerado ? '⚠ zerado' : `${Number(p.estoque)} em estoque`}</span>
        </div>
      </li>`;
    };

    return `<div class="di-bloco di-bloco-alerta">
      <p class="di-titulo-secao">📦 Estoque baixo (${itens.length} produto${itens.length > 1 ? 's' : ''})</p>
      <ul class="di-estoque-lista">
        ${criticos.map(renderItem).join('')}
        ${baixos.map(renderItem).join('')}
      </ul>
      ${itens.length > 5 ? `<p class="di-vazio" style="margin-top:8px;">Mostrando ${Math.min(itens.length, 10)} de ${itens.length} produtos.</p>` : ''}
    </div>`;
  }

  function htmlPadroes(diaSemana, faixaH) {
    if (!diaSemana && !faixaH) return '';
    return `<div class="di-bloco">
      <p class="di-titulo-secao">🔎 Padrões de venda (histórico)</p>
      <div class="di-padroes-grid">
        ${diaSemana ? `<div class="di-padrao-card">
          <span class="di-padrao-label">Melhor dia</span>
          <span class="di-padrao-valor">${diaSemana.nome}</span>
          <span class="di-padrao-sub">${diaSemana.total} vendas históricas</span>
          <div class="di-dias-svg">${svgDiasSemana(diaSemana.porDia)}</div>
        </div>` : ''}
        ${faixaH ? `<div class="di-padrao-card">
          <span class="di-padrao-label">Horário de pico</span>
          <span class="di-padrao-valor">${faixaH.label}</span>
          <span class="di-padrao-sub">${faixaH.total} vendas nessa faixa</span>
        </div>` : ''}
      </div>
    </div>`;
  }

  function htmlMeta(receitaMes, ehDono) {
    if (!ehDono) return '';
    const meta = lerMetaRapida();
    if (meta && meta.valor > 0) {
      const pct = Math.min((receitaMes / meta.valor) * 100, 100);
      const cor = pct >= 100 ? '#1B3A2F' : pct >= 60 ? '#D9A441' : '#E2572B';
      return `<div class="di-bloco">
        <p class="di-titulo-secao">🎯 Meta mensal rápida</p>
        <p class="di-meta-lbl">Meta: <strong>${formatarMoeda(meta.valor)}</strong> &nbsp;·&nbsp; Atual: <strong>${formatarMoeda(receitaMes)}</strong></p>
        <div class="di-meta-barra-wrap">
          <div class="di-meta-barra-fill" style="width:${pct.toFixed(1)}%;background:${cor};"></div>
        </div>
        <div class="di-meta-info-row">
          <span>${pct.toFixed(0)}% da meta</span>
          <span>Faltam ${formatarMoeda(Math.max(meta.valor - receitaMes, 0))}</span>
        </div>
        <button class="di-btn-link" data-di-acao="editar-meta">Alterar meta</button>
      </div>`;
    }
    return `<div class="di-bloco">
      <p class="di-titulo-secao">🎯 Meta mensal rápida</p>
      <p class="di-meta-hint">Defina quanto quer faturar este mês e acompanhe o progresso aqui.</p>
      <div class="di-meta-form">
        <input type="number" id="diMetaInput" min="1" step="any" placeholder="Ex: 5000" class="di-input"/>
        <button class="btn primary di-btn-salvar-meta" style="width:auto;padding:9px 14px;font-size:13.5px;">Definir meta</button>
      </div>
    </div>`;
  }

  // ── Render principal ──────────────────────────────────────────────────────

  function renderInsights(vendas, produtos) {
    const container = document.getElementById('cdConteudo');
    if (!container) return;

    const jaExiste = container.querySelector('.di-wrap');
    if (jaExiste) jaExiste.remove();

    const intervalo     = calcularIntervalo();
    const intervaloAnt  = calcularIntervaloAnterior(intervalo);
    const serie         = seriePeriodo(vendas, intervalo);
    const comp          = comparativoPeriodo(vendas, intervalo, intervaloAnt);
    const topProd       = topProdutos(vendas, intervalo, 5);
    const topCli        = topClientes(vendas, intervalo, 5);
    const devedores     = maioresDevedores(vendas, 5);
    const estoqueAlerta = alertasEstoque(produtos).slice(0, 10);
    const diaSemana     = melhorDiaSemana(vendas);
    const faixaH        = melhorFaixaHorario(vendas);
    const ehDono        = typeof usuarioLogadoPapel !== 'undefined' && usuarioLogadoPapel === 'dono';

    // Receita do mês corrente para a meta (sempre usa mês, independente do filtro)
    const receitaMes = (() => {
      const agora = new Date();
      const ini = inicioMes(agora);
      return vendasValidas(vendas)
        .filter(v => v._d >= ini)
        .reduce((s, v) => s + (v.total || 0), 0);
    })();

    const wrap = document.createElement('div');
    wrap.className = 'di-wrap';
    wrap.innerHTML =
      htmlFiltros() +
      htmlComparativo(comp) +
      htmlGraficoPeriodo(serie) +
      `<div class="di-grid-2col">
        ${htmlTopProdutos(topProd)}
        ${htmlTopClientes(topCli)}
      </div>` +
      `<div class="di-grid-2col">
        ${htmlDevedores(devedores)}
        ${htmlAlertasEstoque(estoqueAlerta)}
      </div>` +
      htmlPadroes(diaSemana, faixaH) +
      htmlMeta(receitaMes, ehDono);

    const primeiroFilho = container.firstElementChild;
    if (primeiroFilho && primeiroFilho.nextSibling) {
      container.insertBefore(wrap, primeiroFilho.nextSibling);
    } else {
      container.appendChild(wrap);
    }

    // ── Event listeners ──────────────────────────────────────────────────────

    // Filtros de período
    wrap.querySelectorAll('[data-di-periodo]').forEach(btn => {
      btn.addEventListener('click', () => {
        _periodoAtivo = btn.dataset.diPeriodo;
        try { localStorage.setItem(CHAVE_PERIODO, _periodoAtivo); } catch {}
        renderInsights(vendas, produtos);
      });
    });

    // Datas personalizadas
    const btnAplicar = wrap.querySelector('.di-btn-aplicar');
    if (btnAplicar) {
      btnAplicar.addEventListener('click', () => {
        _dataInicio = document.getElementById('diDataInicio')?.value || null;
        _dataFim    = document.getElementById('diDataFim')?.value    || null;
        renderInsights(vendas, produtos);
      });
    }

    // Meta rápida — salvar
    const btnSalvar = wrap.querySelector('.di-btn-salvar-meta');
    if (btnSalvar) {
      btnSalvar.addEventListener('click', () => {
        const input = document.getElementById('diMetaInput');
        const val = parseFloat((input?.value || '').replace(',', '.'));
        if (!val || val <= 0) { input?.focus(); return; }
        salvarMetaRapida(val);
        renderInsights(vendas, produtos);
      });
    }

    // Meta rápida — editar
    const btnEditar = wrap.querySelector('[data-di-acao="editar-meta"]');
    if (btnEditar) {
      btnEditar.addEventListener('click', () => {
        localStorage.removeItem(CHAVE_META_RAPIDA);
        renderInsights(vendas, produtos);
      });
    }
  }

  // ── Observadores ──────────────────────────────────────────────────────────

  let _observer = null, _ultimoHash = '';

  function iniciarObservador() {
    const alvo = document.getElementById('cdConteudo');
    if (!alvo) return;
    if (_observer) _observer.disconnect();
    _observer = new MutationObserver(() => {
      const hash = alvo.innerHTML.slice(0, 120);
      if (hash === _ultimoHash) return;
      _ultimoHash = hash;
      if (!alvo.querySelector('.cd-grid-cartoes, .cd-grid-graficos')) return;
      requestAnimationFrame(() => {
        const v = typeof vendasCache !== 'undefined' ? vendasCache : [];
        const p = typeof produtosCache !== 'undefined' ? produtosCache : [];
        renderInsights(v, p);
      });
    });
    _observer.observe(alvo, { childList: true, subtree: false });
  }

  function aguardarCentralDados() {
    if (document.getElementById('cdConteudo')) { iniciarObservador(); return; }
    const main = document.getElementById('main');
    if (!main) return;
    const obs = new MutationObserver(() => {
      if (document.getElementById('cdConteudo')) { obs.disconnect(); iniciarObservador(); }
    });
    obs.observe(main, { childList: true, subtree: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aguardarCentralDados);
  } else {
    aguardarCentralDados();
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn && btn.dataset.tab === 'central') setTimeout(aguardarCentralDados, 50);
  }, true);

})();