/**
 * dashboard-insights.js  (T10 — Dashboard Inteligente)
 *
 * Estende a Central de Dados com seis blocos de inteligência:
 *   1. Melhor dia da semana (histórico completo, não só o período)
 *   2. Melhor faixa de horário
 *   3. Comparativo mês atual vs. mês anterior (receita + quantidade)
 *   4. Gráfico SVG dos últimos 7 dias (barras inline, zero Canvas)
 *   5. Metas mensais rápidas (configuráveis pelo dono mesmo no Essencial)
 *   6. Alertas automáticos enriquecidos (estoque crítico, produto parado,
 *      meta em risco, tendência de queda)
 *
 * Estratégia de integração: não toca em central-dados.js nem em nenhum
 * outro arquivo existente. Ao carregar, aguarda o DOM estar pronto e
 * depois escuta o evento sintético "cdRenderizado" que o CentralDados
 * dispara. Quando a Central de Dados não dispara esse evento (versões
 * anteriores), usa um MutationObserver no #cdConteudo como fallback.
 *
 * Depende de: vendasCache, produtosCache, usuarioLogadoPapel,
 * formatarMoeda, escaparHtml (todos globais, definidos em app.js/db.js).
 * Usa apenas dados já carregados em memória — nenhuma rota nova.
 */

;(function () {
  'use strict';

  // ── Chave de localStorage para metas rápidas (Essencial) ─────────────────
  // As metas do plano Pro vivem no D1; estas vivem só no navegador e são
  // exibidas somente na seção de insights — sem conflito.
  const CHAVE_META_RAPIDA = 'mev_meta_mensal_rapida';

  // ── Helpers de data ───────────────────────────────────────────────────────

  function inicioDia(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function inicioMes(d) { const x = inicioDia(d); x.setDate(1); return x; }
  function inicioMesAnterior(d) {
    const x = new Date(d);
    x.setDate(1);
    x.setMonth(x.getMonth() - 1);
    x.setHours(0,0,0,0);
    return x;
  }
  function fimMesAnterior(d) {
    const x = inicioMes(d);
    x.setMilliseconds(-1);
    return x;
  }

  // ── Cálculos ──────────────────────────────────────────────────────────────

  /** Filtra vendas não canceladas e converte data para Date. */
  function vendasValidas(vendas) {
    return (vendas || [])
      .filter(v => v.status !== 'cancelada')
      .map(v => ({ ...v, _d: new Date(v.data || v.criadoEm || 0) }));
  }

  /** Melhor dia da semana (index 0–6) e o total de vendas nele. */
  function melhorDiaSemana(vendas) {
    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const DIAS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const porDia = new Array(7).fill(0);
    vendasValidas(vendas).forEach(v => porDia[v._d.getDay()]++);
    const max = Math.max(...porDia);
    if (max === 0) return null;
    const idx = porDia.indexOf(max);
    return { abrev: DIAS[idx], nome: DIAS_FULL[idx], total: max, porDia };
  }

  /**
   * Melhor faixa de 3 horas (ex: "10h–13h").
   * Agrupa em blocos de 3h (0-2, 3-5, ... 21-23) e retorna o mais cheio.
   */
  function melhorFaixaHorario(vendas) {
    const blocos = new Array(8).fill(0); // 24h / 3 = 8 blocos
    vendasValidas(vendas).forEach(v => {
      const h = v._d.getHours();
      blocos[Math.floor(h / 3)]++;
    });
    const max = Math.max(...blocos);
    if (max === 0) return null;
    const idx = blocos.indexOf(max);
    const inicio = idx * 3;
    const fim = inicio + 3;
    return { label: `${inicio}h–${fim}h`, total: max, blocos };
  }

  /** Comparativo mês atual vs. mês anterior. */
  function comparativoMeses(vendas) {
    const agora = new Date();
    const iniAtual = inicioMes(agora);
    const iniAnterior = inicioMesAnterior(agora);
    const fimAnterior = fimMesAnterior(agora);

    const vv = vendasValidas(vendas);
    const atual  = vv.filter(v => v._d >= iniAtual);
    const anterior = vv.filter(v => v._d >= iniAnterior && v._d <= fimAnterior);

    const recAtual   = atual.reduce((s, v) => s + (v.total || 0), 0);
    const recAnterior = anterior.reduce((s, v) => s + (v.total || 0), 0);
    const qtdAtual   = atual.length;
    const qtdAnterior = anterior.length;

    function variacao(a, b) {
      if (!b) return a > 0 ? 100 : 0;
      return ((a - b) / b) * 100;
    }

    return {
      receita: { atual: recAtual, anterior: recAnterior, var: variacao(recAtual, recAnterior) },
      qtd:     { atual: qtdAtual, anterior: qtdAnterior, var: variacao(qtdAtual, qtdAnterior) },
    };
  }

  /** Série dos últimos N dias: array de { rotulo, total, qtd }. */
  function serie7dias(vendas, n = 7) {
    const agora = new Date();
    const dias = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(agora);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const fim = new Date(d); fim.setHours(23, 59, 59, 999);
      const rot = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      dias.push({ rotulo: rot, inicio: d, fim, total: 0, qtd: 0 });
    }
    vendasValidas(vendas).forEach(v => {
      const dia = dias.find(d => v._d >= d.inicio && v._d <= d.fim);
      if (dia) { dia.total += v.total || 0; dia.qtd++; }
    });
    return dias;
  }

  /** Meta mensal rápida salva no localStorage (só para Essencial). */
  function lerMetaRapida() {
    try {
      const raw = localStorage.getItem(CHAVE_META_RAPIDA);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function salvarMetaRapida(valor) {
    try { localStorage.setItem(CHAVE_META_RAPIDA, JSON.stringify({ valor })); } catch {}
  }

  /**
   * Alertas automáticos enriquecidos.
   * Retorna array de { tipo: 'ok'|'aviso'|'critico', icone, titulo, texto }
   */
  function gerarAlertasInsights(vendas, produtos, comp, meta) {
    const alertas = [];
    const agora = new Date();

    // 1. Estoque crítico
    const criticos = (produtos || []).filter(p => p.estoque <= (p.estoqueMinimo || 0) && p.estoque >= 0);
    if (criticos.length > 0) {
      const nomes = criticos.slice(0, 2).map(p => `"${p.nome}"`).join(', ');
      alertas.push({
        tipo: 'critico', icone: '📦',
        titulo: `${criticos.length} produto${criticos.length > 1 ? 's' : ''} com estoque crítico`,
        texto: `${nomes}${criticos.length > 2 ? ` e mais ${criticos.length - 2}` : ''} chegaram ao estoque mínimo.`,
      });
    }

    // 2. Produtos parados há mais de 30 dias
    const ultimaVenda = {};
    vendasValidas(vendas).forEach(v => {
      (v.itens || []).forEach(item => {
        if (!ultimaVenda[item.nome] || v._d > ultimaVenda[item.nome]) ultimaVenda[item.nome] = v._d;
      });
    });
    const parados = (produtos || []).filter(p => {
      const u = ultimaVenda[p.nome];
      if (!u) return p.estoque > 0; // nunca vendido, mas tem estoque
      return (agora - u) / 86400000 >= 30;
    }).slice(0, 2);
    parados.forEach(p => {
      const u = ultimaVenda[p.nome];
      const dias = u ? Math.floor((agora - u) / 86400000) : null;
      alertas.push({
        tipo: 'aviso', icone: '🐌',
        titulo: `"${p.nome}" está parado`,
        texto: dias ? `Sem venda há ${dias} dias.` : 'Nunca foi vendido.',
      });
    });

    // 3. Queda de faturamento vs. mês anterior
    if (comp.receita.anterior > 0 && comp.receita.var <= -15) {
      alertas.push({
        tipo: 'critico', icone: '📉',
        titulo: 'Queda no faturamento',
        texto: `Este mês está ${Math.abs(comp.receita.var).toFixed(0)}% abaixo do mês anterior.`,
      });
    } else if (comp.receita.anterior > 0 && comp.receita.var >= 15) {
      alertas.push({
        tipo: 'ok', icone: '📈',
        titulo: 'Crescimento no mês',
        texto: `Faturamento ${comp.receita.var.toFixed(0)}% acima do mês anterior. 👏`,
      });
    }

    // 4. Meta em risco
    if (meta && meta.valor > 0) {
      const diaDoMes = agora.getDate();
      const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
      const ritmoDiario = comp.receita.atual / diaDoMes;
      const previsao = ritmoDiario * diasNoMes;
      const pct = (comp.receita.atual / meta.valor) * 100;

      if (pct >= 100) {
        alertas.push({
          tipo: 'ok', icone: '🏆',
          titulo: 'Meta do mês batida!',
          texto: `Você já atingiu ${pct.toFixed(0)}% da meta de ${formatarMoeda(meta.valor)}.`,
        });
      } else if (previsao < meta.valor * 0.8) {
        alertas.push({
          tipo: 'critico', icone: '⚠️',
          titulo: 'Meta em risco',
          texto: `No ritmo atual, a previsão é ${formatarMoeda(previsao)} de ${formatarMoeda(meta.valor)} da meta.`,
        });
      }
    }

    return alertas;
  }

  // ── Renderização ──────────────────────────────────────────────────────────

  /** Barra de progresso de meta simples (HTML puro). */
  function htmlProgressoMeta(atual, meta) {
    const pct = Math.min((atual / meta) * 100, 100);
    const cor = pct >= 100 ? '#1B3A2F' : pct >= 60 ? '#D9A441' : '#E2572B';
    return `
      <div class="di-meta-barra" style="background:#EFEBDD;border-radius:99px;height:8px;overflow:hidden;margin:8px 0 4px;">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${cor};border-radius:99px;transition:width .4s ease;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-soft);">
        <span>${pct.toFixed(0)}% da meta</span>
        <span>Faltam ${formatarMoeda(Math.max(meta - atual, 0))}</span>
      </div>`;
  }

  /** SVG de barras dos últimos 7 dias (sem Canvas, sem libs). */
  function svgBarras7Dias(serie) {
    const W = 300, H = 90;
    const MARGEM_L = 4, MARGEM_R = 4, MARGEM_B = 20, MARGEM_T = 8;
    const areaW = W - MARGEM_L - MARGEM_R;
    const areaH = H - MARGEM_T - MARGEM_B;
    const n = serie.length;
    const gap = 4;
    const barW = (areaW - gap * (n - 1)) / n;
    const maxVal = Math.max(...serie.map(d => d.total), 1);

    const barras = serie.map((d, i) => {
      const x = MARGEM_L + i * (barW + gap);
      const h = Math.max((d.total / maxVal) * areaH, d.total > 0 ? 3 : 0);
      const y = MARGEM_T + areaH - h;
      const hoje = i === n - 1;
      const cor = hoje ? '#1B3A2F' : '#D9D4C2';
      const r = Math.min(3, barW / 2);
      // Caminho com bordas arredondadas só no topo
      const path = h > 0
        ? `M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2*r} a${r},${r} 0 0 1 ${r},${r} V${MARGEM_T + areaH} H${x} Z`
        : '';
      const labelY = H - 4;
      return `
        ${path ? `<path d="${path}" fill="${cor}"/>` : ''}
        <text x="${x + barW / 2}" y="${labelY}"
              font-family="IBM Plex Mono,monospace" font-size="8" fill="#5B6259"
              text-anchor="middle">${escaparHtml(d.rotulo)}</text>
        ${d.total > 0 ? `<text x="${x + barW / 2}" y="${y - 2}"
              font-family="IBM Plex Mono,monospace" font-size="7" fill="${hoje ? '#1B3A2F' : '#8A6A22'}"
              text-anchor="middle">${formatarMoeda(d.total).replace('R$\u00a0', '')}</text>` : ''}`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible;"
              xmlns="http://www.w3.org/2000/svg">${barras}</svg>`;
  }

  /** Minibarras de dias da semana (SVG). */
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
      const y = areaH - h;
      const cor = v === max ? '#1B3A2F' : '#D9D4C2';
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${cor}"/>
        <text x="${x + barW/2}" y="${H - 2}" font-size="8" font-family="IBM Plex Mono,monospace"
              fill="#5B6259" text-anchor="middle">${DIAS[i]}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">${barras}</svg>`;
  }

  /** Renderiza o bloco inteiro de insights e o injeta no #cdConteudo. */
  function renderInsights(vendas, produtos) {
    const container = document.getElementById('cdConteudo');
    if (!container) return;

    // Evita duplicatas se for chamado mais de uma vez por render
    const jaExiste = container.querySelector('.di-wrap');
    if (jaExiste) jaExiste.remove();

    const diaSemana = melhorDiaSemana(vendas);
    const faixaH    = melhorFaixaHorario(vendas);
    const comp      = comparativoMeses(vendas);
    const serie     = serie7dias(vendas, 7);
    const meta      = lerMetaRapida();
    const alertas   = gerarAlertasInsights(vendas, produtos, comp, meta);

    const ehDono = typeof usuarioLogadoPapel !== 'undefined' && usuarioLogadoPapel === 'dono';

    // ── 3. Comparativo ───────────────────────────────────────────────────────
    function tagVariacao(v) {
      if (Math.abs(v) < 1) return `<span class="di-tag neutro">→ sem mudança</span>`;
      const positivo = v > 0;
      return `<span class="di-tag ${positivo ? 'up' : 'down'}">${positivo ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
    }

    const htmlComparativo = `
      <div class="di-bloco">
        <p class="di-titulo-secao">📅 Mês atual vs. mês anterior</p>
        <div class="di-comp-grid">
          <div class="di-comp-item">
            <span class="di-comp-label">Receita</span>
            <span class="di-comp-val">${formatarMoeda(comp.receita.atual)}</span>
            ${tagVariacao(comp.receita.var)}
            <span class="di-comp-sub">Mês ant.: ${formatarMoeda(comp.receita.anterior)}</span>
          </div>
          <div class="di-comp-item">
            <span class="di-comp-label">Vendas</span>
            <span class="di-comp-val">${comp.qtd.atual}</span>
            ${tagVariacao(comp.qtd.var)}
            <span class="di-comp-sub">Mês ant.: ${comp.qtd.anterior}</span>
          </div>
        </div>
      </div>`;

    // ── 4. Gráfico 7 dias ────────────────────────────────────────────────────
    const htmlGrafico7 = `
      <div class="di-bloco">
        <p class="di-titulo-secao">📊 Últimos 7 dias</p>
        <div class="di-grafico-7d">${svgBarras7Dias(serie)}</div>
      </div>`;

    // ── 1 + 2. Padrões de venda ───────────────────────────────────────────────
    const htmlPadroes = (diaSemana || faixaH) ? `
      <div class="di-bloco">
        <p class="di-titulo-secao">🔎 Seus padrões de venda</p>
        <div class="di-padroes-grid">
          ${diaSemana ? `
          <div class="di-padrao-card">
            <span class="di-padrao-label">Melhor dia</span>
            <span class="di-padrao-valor">${diaSemana.nome}</span>
            <span class="di-padrao-sub">${diaSemana.total} vendas históricas</span>
            <div class="di-dias-svg">${svgDiasSemana(diaSemana.porDia)}</div>
          </div>` : ''}
          ${faixaH ? `
          <div class="di-padrao-card">
            <span class="di-padrao-label">Horário de pico</span>
            <span class="di-padrao-valor">${faixaH.label}</span>
            <span class="di-padrao-sub">${faixaH.total} vendas nessa faixa</span>
          </div>` : ''}
        </div>
      </div>` : '';

    // ── 5. Meta mensal rápida ────────────────────────────────────────────────
    // Aparece para o dono em qualquer plano. No Pro, é complementar
    // às metas do D1 (mais completas). No Essencial, é a única opção.
    const receitaMes = comp.receita.atual;
    const htmlMeta = ehDono ? `
      <div class="di-bloco">
        <p class="di-titulo-secao">🎯 Meta mensal rápida</p>
        ${meta && meta.valor > 0 ? `
          <p class="di-meta-lbl">Meta: <strong>${formatarMoeda(meta.valor)}</strong> &nbsp;·&nbsp; Atual: <strong>${formatarMoeda(receitaMes)}</strong></p>
          ${htmlProgressoMeta(receitaMes, meta.valor)}
          <button class="di-btn-link" data-di-acao="editar-meta">Alterar meta</button>
        ` : `
          <p class="di-meta-hint">Defina quanto quer faturar este mês e acompanhe o progresso aqui.</p>
          <div class="di-meta-form">
            <input type="number" id="diMetaInput" min="1" step="any"
                   placeholder="Ex: 5000" class="di-input"/>
            <button class="btn primary di-btn-salvar-meta" style="width:auto;padding:9px 14px;font-size:13.5px;">
              Definir meta
            </button>
          </div>
        `}
      </div>` : '';

    // ── 6. Alertas automáticos ───────────────────────────────────────────────
    const htmlAlertas = alertas.length > 0 ? `
      <div class="di-bloco">
        <p class="di-titulo-secao">🚨 Alertas automáticos</p>
        <div class="di-alertas">
          ${alertas.map(a => `
            <div class="di-alerta di-alerta-${a.tipo}">
              <span class="di-alerta-icone">${a.icone}</span>
              <div>
                <p class="di-alerta-titulo">${escaparHtml(a.titulo)}</p>
                <p class="di-alerta-texto">${escaparHtml(a.texto)}</p>
              </div>
            </div>`).join('')}
        </div>
      </div>` : '';

    // ── Monta o wrapper e injeta ANTES do primeiro filho do #cdConteudo ──────
    const wrap = document.createElement('div');
    wrap.className = 'di-wrap';
    wrap.innerHTML = htmlComparativo + htmlGrafico7 + htmlPadroes + htmlMeta + htmlAlertas;

    // Insere logo depois do grid de cartões de indicadores (primeiro filho)
    const primeiroFilho = container.firstElementChild;
    if (primeiroFilho && primeiroFilho.nextSibling) {
      container.insertBefore(wrap, primeiroFilho.nextSibling);
    } else {
      container.appendChild(wrap);
    }

    // ── Event listeners ──────────────────────────────────────────────────────
    const btnSalvar = wrap.querySelector('.di-btn-salvar-meta');
    if (btnSalvar) {
      btnSalvar.addEventListener('click', () => {
        const input = document.getElementById('diMetaInput');
        const val = parseFloat((input?.value || '').replace(',', '.'));
        if (!val || val <= 0) {
          input?.focus();
          return;
        }
        salvarMetaRapida(val);
        renderInsights(vendas, produtos); // re-renderiza só este bloco
      });
    }

    const btnEditar = wrap.querySelector('[data-di-acao="editar-meta"]');
    if (btnEditar) {
      btnEditar.addEventListener('click', () => {
        localStorage.removeItem(CHAVE_META_RAPIDA);
        renderInsights(vendas, produtos);
      });
    }
  }

  // ── Observador: detecta quando o #cdConteudo é (re)populado ──────────────

  let _observer = null;
  let _ultimoHash = '';

  function iniciarObservador() {
    const alvo = document.getElementById('cdConteudo');
    if (!alvo) return;

    if (_observer) _observer.disconnect();

    _observer = new MutationObserver(() => {
      // Verifica se o conteúdo mudou de verdade (evita loop infinito)
      const hash = alvo.innerHTML.slice(0, 120);
      if (hash === _ultimoHash) return;
      _ultimoHash = hash;

      // Só injeta se a Central de Dados estiver visível
      if (!alvo.querySelector('.cd-grid-cartoes, .cd-grid-graficos')) return;

      // Aguarda um frame para o CentralDados terminar de inicializar os canvas
      requestAnimationFrame(() => {
        const v = typeof vendasCache !== 'undefined' ? vendasCache : [];
        const p = typeof produtosCache !== 'undefined' ? produtosCache : [];
        renderInsights(v, p);
      });
    });

    _observer.observe(alvo, { childList: true, subtree: false });
  }

  // ── Observador de roteamento: detecta troca de aba para inicializar ───────

  function aguardarCentralDados() {
    // Tenta encontrar o #cdConteudo imediatamente
    if (document.getElementById('cdConteudo')) {
      iniciarObservador();
      return;
    }

    // Senão, observa o #main até ele aparecer
    const main = document.getElementById('main');
    if (!main) return;

    const obs = new MutationObserver(() => {
      if (document.getElementById('cdConteudo')) {
        obs.disconnect();
        iniciarObservador();
      }
    });
    obs.observe(main, { childList: true, subtree: false });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aguardarCentralDados);
  } else {
    aguardarCentralDados();
  }

  // Re-inicializa se o usuário navegar de volta à aba Central
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn && btn.dataset.tab === 'central') {
      setTimeout(aguardarCentralDados, 50);
    }
  }, true);

})();
