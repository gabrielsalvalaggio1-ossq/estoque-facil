/**
 * carrinho-inteligente.js — T8 Carrinho Inteligente
 *
 * Funcionalidades:
 *   1. Produtos relacionados: ao adicionar ao carrinho, sugere os 3 produtos
 *      mais vendidos juntos historicamente (co-ocorrência em vendasCache).
 *   2. Aviso de estoque baixo: destaca itens cujo estoque fica crítico após a venda.
 *   3. Margem da venda: exibe margem total e lucro estimado na barra do carrinho.
 *   4. Combos automáticos: detecta combos (≥5 co-ocorrências) e sugere com desconto opcional.
 *
 * Regras:
 *   - Não altera lógica de finalização, comprovante, carrinho ou D1.
 *   - Lê apenas: carrinho, produtosCache, vendasCache (globais de ui-base.js).
 *   - Injeta UI via DOM, sem sobrescrever innerHTML de nenhuma estrutura existente.
 *   - Patch cirúrgico em alterarCarrinho e venderPeso (globais de ui-clientes-render.js)
 *     para disparar atualizações após cada mudança no carrinho.
 */

(function () {
  'use strict';

  // ─── Configurações ───────────────────────────────────────────────────────────
  const MAX_SUGESTOES        = 3;   // produtos relacionados exibidos
  const MIN_COOCORRENCIAS    = 5;   // mínimo para virar sugestão de combo
  const COMBO_DESCONTO_PADRAO = 5;  // % de desconto sugerido no combo
  const ESTOQUE_CRITICO_FATOR = 0.5; // estoque pós-venda < 50% do mínimo → crítico

  // ─── Cache de cálculos (recalcula quando vendasCache muda) ─────────────────
  let _cacheVendasSnapshot = null;  // referência à array atual para invalidar
  let _cacheCoOcorrencia   = null;  // Map<prodId, Map<prodId, count>>
  let _cacheCombos         = null;  // Array<{ ids: Set, nomes: string[], contagem: number }>

  // ─── 1 + 4. Co-ocorrência e detecção de combos ──────────────────────────────

  /**
   * Constrói a matriz de co-ocorrência entre produtos a partir de vendasCache.
   * Também detecta combos (pares e triplas com ≥ MIN_COOCORRENCIAS co-ocorrências).
   * Resultado cacheado enquanto vendasCache não mudar.
   */
  function garantirCache() {
    const vendas = typeof vendasCache !== 'undefined' ? vendasCache : [];
    if (vendas === _cacheVendasSnapshot && _cacheCoOcorrencia) return;

    _cacheVendasSnapshot = vendas;
    _cacheCoOcorrencia = new Map();
    const contadorCombos = new Map(); // chave: "idA|idB" ordenado → count

    vendas.forEach(v => {
      if (v.status === 'cancelada') return;
      const ids = v.itens.map(i => i.produtoId).filter(Boolean);
      if (ids.length < 2) return;

      // Co-ocorrência par-a-par
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const idA = ids[a], idB = ids[b];

          // Matriz simétrica
          if (!_cacheCoOcorrencia.has(idA)) _cacheCoOcorrencia.set(idA, new Map());
          if (!_cacheCoOcorrencia.has(idB)) _cacheCoOcorrencia.set(idB, new Map());
          _cacheCoOcorrencia.get(idA).set(idB, (_cacheCoOcorrencia.get(idA).get(idB) || 0) + 1);
          _cacheCoOcorrencia.get(idB).set(idA, (_cacheCoOcorrencia.get(idB).get(idA) || 0) + 1);

          // Pares para combos
          const chave2 = [idA, idB].sort().join('|');
          contadorCombos.set(chave2, (contadorCombos.get(chave2) || 0) + 1);
        }

        // Triplas para combos (apenas se ≥3 itens)
        if (ids.length >= 3) {
          for (let b2 = a + 1; b2 < ids.length; b2++) {
            for (let c = b2 + 1; c < ids.length; c++) {
              const chave3 = [ids[a], ids[b2], ids[c]].sort().join('|');
              contadorCombos.set(chave3, (contadorCombos.get(chave3) || 0) + 1);
            }
          }
        }
      }
    });

    // Filtra combos com co-ocorrências suficientes
    _cacheCombos = [];
    contadorCombos.forEach((count, chave) => {
      if (count < MIN_COOCORRENCIAS) return;
      const ids = chave.split('|');
      const produtos = typeof produtosCache !== 'undefined' ? produtosCache : [];
      const nomes = ids.map(id => {
        const p = produtos.find(x => x.id === id);
        return p ? p.nome : null;
      }).filter(Boolean);
      if (nomes.length === ids.length) {
        _cacheCombos.push({ ids: new Set(ids), nomes, contagem: count });
      }
    });

    // Ordena combos por frequência
    _cacheCombos.sort((a, b) => b.contagem - a.contagem);
  }

  /**
   * Retorna até MAX_SUGESTOES produtos mais comprados junto com os ids do carrinho atual,
   * excluindo produtos já no carrinho e com estoque zero.
   */
  function sugerirRelacionados(idsCarrinho) {
    if (!idsCarrinho.length) return [];
    garantirCache();

    const produtos = typeof produtosCache !== 'undefined' ? produtosCache : [];
    const noCarrinho = new Set(idsCarrinho);
    const pontos = new Map(); // produtoId → total de co-ocorrências

    idsCarrinho.forEach(idAtual => {
      const vizinhos = _cacheCoOcorrencia.get(idAtual);
      if (!vizinhos) return;
      vizinhos.forEach((count, idVizinho) => {
        if (noCarrinho.has(idVizinho)) return;
        pontos.set(idVizinho, (pontos.get(idVizinho) || 0) + count);
      });
    });

    return Array.from(pontos.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SUGESTOES)
      .map(([id]) => produtos.find(p => p.id === id))
      .filter(p => p && p.estoque > 0);
  }

  /**
   * Detecta se o carrinho atual completa um combo conhecido.
   * Retorna o combo mais frequente que está totalmente no carrinho,
   * ou null se nenhum.
   */
  function detectarComboAtivo(idsCarrinho) {
    garantirCache();
    if (!_cacheCombos.length || !idsCarrinho.length) return null;

    const noCarrinho = new Set(idsCarrinho);
    for (const combo of _cacheCombos) {
      // Todos os IDs do combo precisam estar no carrinho
      let completo = true;
      for (const id of combo.ids) {
        if (!noCarrinho.has(id)) { completo = false; break; }
      }
      if (completo) return combo;
    }
    return null;
  }

  /**
   * Retorna combos que ainda faltam 1 produto para ser completados,
   * útil para sugerir "adicione X e ganhe desconto".
   */
  function combosQuaseProntos(idsCarrinho) {
    garantirCache();
    if (!_cacheCombos.length || !idsCarrinho.length) return [];

    const noCarrinho = new Set(idsCarrinho);
    const produtos = typeof produtosCache !== 'undefined' ? produtosCache : [];
    const resultado = [];

    for (const combo of _cacheCombos) {
      const faltando = [];
      for (const id of combo.ids) {
        if (!noCarrinho.has(id)) faltando.push(id);
      }
      if (faltando.length === 1) {
        const p = produtos.find(x => x.id === faltando[0]);
        if (p && p.estoque > 0) {
          resultado.push({ combo, produtoFaltando: p });
        }
      }
    }
    return resultado.slice(0, 2); // no máximo 2 sugestões de combo quasi-pronto
  }

  // ─── 2. Aviso de estoque pós-venda ─────────────────────────────────────────

  /**
   * Retorna lista de produtos cujo estoque ficará crítico após a venda.
   * Crítico: estoque restante < estoqueMinimo × ESTOQUE_CRITICO_FATOR, ou < 0.
   */
  function itensCriticosAposVenda(carrinhoAtual) {
    const produtos = typeof produtosCache !== 'undefined' ? produtosCache : [];
    const criticos = [];
    Object.entries(carrinhoAtual).forEach(([id, qtd]) => {
      const p = produtos.find(x => x.id === id);
      if (!p) return;
      const estoquePos = p.estoque - qtd;
      const min = p.estoqueMinimo || 0;
      if (estoquePos < 0 || (min > 0 && estoquePos < min * ESTOQUE_CRITICO_FATOR)) {
        criticos.push({ produto: p, estoquePos: Math.max(0, estoquePos) });
      }
    });
    return criticos;
  }

  // ─── 3. Margem da venda ────────────────────────────────────────────────────

  /**
   * Calcula margem e lucro estimado da venda atual.
   * Retorna { temDados, totalVenda, totalCusto, lucro, margem }.
   * temDados: true se pelo menos um produto tem custo cadastrado.
   */
  function calcularMargemVenda(carrinhoAtual) {
    const produtos = typeof produtosCache !== 'undefined' ? produtosCache : [];
    let totalVenda = 0, totalCusto = 0, itensComCusto = 0;

    Object.entries(carrinhoAtual).forEach(([id, qtd]) => {
      const p = produtos.find(x => x.id === id);
      if (!p) return;
      totalVenda += p.preco * qtd;
      if (p.precoCusto !== null && p.precoCusto !== undefined) {
        totalCusto += p.precoCusto * qtd;
        itensComCusto++;
      }
    });

    const temDados = itensComCusto > 0;
    const lucro = totalVenda - totalCusto;
    const margem = totalVenda > 0 && temDados ? (lucro / totalVenda) * 100 : null;

    return { temDados, totalVenda, totalCusto, lucro, margem };
  }

  // ─── Formatação de moeda (seguro: usa global formatarMoeda se existir) ───────
  function _moeda(valor) {
    if (typeof formatarMoeda === 'function') return formatarMoeda(valor);
    return 'R$ ' + Number(valor).toFixed(2).replace('.', ',');
  }

  function _escapar(str) {
    if (typeof escaparHtml === 'function') return escaparHtml(str);
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Renderização do painel de inteligência do carrinho ────────────────────

  const PAINEL_ID = 'carrinho-inteligente-painel';

  /**
   * Insere/atualiza o painel abaixo da barra do carrinho (#cartbar).
   * Criado uma única vez; atualizado a cada mudança de carrinho.
   */
  function renderizarPainel() {
    const carrinhoAtual = typeof carrinho !== 'undefined' ? carrinho : {};
    const ids = Object.keys(carrinhoAtual);

    // Remove o painel se o carrinho estiver vazio
    let painel = document.getElementById(PAINEL_ID);
    if (ids.length === 0) {
      if (painel) painel.remove();
      return;
    }

    // Cria o painel se não existir ainda
    if (!painel) {
      painel = document.createElement('div');
      painel.id = PAINEL_ID;
      // Insere logo após a cartbar
      const cartbar = document.getElementById('cartbar');
      if (cartbar && cartbar.parentNode) {
        cartbar.parentNode.insertBefore(painel, cartbar.nextSibling);
      } else {
        document.body.appendChild(painel);
      }
    }

    // ── Seção 3: Margem da venda ─────────────────────────────────────────────
    const margem = calcularMargemVenda(carrinhoAtual);
    let htmlMargem = '';
    if (margem.temDados) {
      const cor = margem.margem >= 30 ? 'verde' : margem.margem >= 10 ? 'amarelo' : 'vermelho';
      htmlMargem = `
        <div class="ci-secao ci-margem">
          <span class="ci-margem-chip ci-margem-${cor}" title="Margem e lucro estimado desta venda">
            <span class="ci-margem-pct">${margem.margem.toFixed(1)}%</span>
            <span class="ci-margem-sep">·</span>
            <span class="ci-margem-lucro">+${_moeda(margem.lucro)} lucro</span>
          </span>
        </div>`;
    }

    // ── Seção 2: Avisos de estoque crítico ──────────────────────────────────
    const criticos = itensCriticosAposVenda(carrinhoAtual);
    let htmlCriticos = '';
    if (criticos.length > 0) {
      const lista = criticos.map(c =>
        `<span class="ci-critico-item">
          ${_escapar(c.produto.nome)}
          <em>${c.estoquePos > 0 ? `sobram ${c.estoquePos}` : 'ficará zerado'}</em>
        </span>`
      ).join('');
      htmlCriticos = `
        <div class="ci-secao ci-avisos">
          <span class="ci-aviso-titulo">⚠ Estoque crítico após a venda</span>
          <div class="ci-criticos">${lista}</div>
        </div>`;
    }

    // ── Seção 4: Combos automáticos ─────────────────────────────────────────
    const comboAtivo = detectarComboAtivo(ids);
    const quaseProntos = comboAtivo ? [] : combosQuaseProntos(ids);
    let htmlCombos = '';

    if (comboAtivo) {
      const nomes = comboAtivo.nomes.map(_escapar).join(' + ');
      htmlCombos = `
        <div class="ci-secao ci-combo ci-combo-ativo">
          <span class="ci-combo-label">🎉 Combo detectado!</span>
          <span class="ci-combo-nomes">${nomes}</span>
          <span class="ci-combo-hint">Vendidos juntos ${comboAtivo.contagem}× — aplique um desconto no comprovante se quiser</span>
        </div>`;
    } else if (quaseProntos.length > 0) {
      const sugestoes = quaseProntos.map(({ combo, produtoFaltando }) => {
        const nomes = combo.nomes.map(_escapar).join(' + ');
        const idEscapado = _escapar(produtoFaltando.id);
        return `
          <div class="ci-combo-sugestao">
            <span class="ci-combo-nomes">${nomes}</span>
            <button class="ci-combo-btn" onclick="CarrinhoInteligente._adicionarProduto('${idEscapado}')">
              + ${_escapar(produtoFaltando.nome)} <em>${_moeda(produtoFaltando.preco)}</em>
            </button>
          </div>`;
      }).join('');
      htmlCombos = `
        <div class="ci-secao ci-combo">
          <span class="ci-combo-label">⚡ Combo quase completo</span>
          ${sugestoes}
        </div>`;
    }

    // ── Seção 1: Produtos relacionados ──────────────────────────────────────
    const relacionados = sugerirRelacionados(ids);
    let htmlRelacionados = '';
    if (relacionados.length > 0 && !comboAtivo) {
      const chips = relacionados.map(p => {
        const idEsc = _escapar(p.id);
        return `<button class="ci-rel-chip" onclick="CarrinhoInteligente._adicionarProduto('${idEsc}')" title="Adicionar ao carrinho">
          ${_escapar(p.nome)} <span class="ci-rel-preco">${_moeda(p.preco)}</span>
        </button>`;
      }).join('');
      htmlRelacionados = `
        <div class="ci-secao ci-relacionados">
          <span class="ci-rel-titulo">Frequentemente comprados juntos</span>
          <div class="ci-rel-chips">${chips}</div>
        </div>`;
    }

    // Monta o painel; omite seções vazias automaticamente
    const temConteudo = htmlMargem || htmlCriticos || htmlCombos || htmlRelacionados;
    painel.innerHTML = temConteudo
      ? `<div class="ci-painel">${htmlMargem}${htmlCriticos}${htmlCombos}${htmlRelacionados}</div>`
      : '';
  }

  // ─── API pública para callbacks de botões no HTML gerado ───────────────────
  function _adicionarProduto(produtoId) {
    if (typeof alterarCarrinho === 'function') {
      alterarCarrinho(produtoId, 1);
    }
  }

  // ─── Patch em alterarCarrinho e venderPeso ─────────────────────────────────
  // Aguarda DOMContentLoaded para garantir que as funções globais já foram definidas.

  function instalarPatches() {
    // Patch de alterarCarrinho
    const _origAlterar = window.alterarCarrinho;
    if (typeof _origAlterar === 'function') {
      window.alterarCarrinho = function () {
        _origAlterar.apply(this, arguments);
        renderizarPainel();
      };
    }

    // Patch de venderPeso
    const _origPeso = window.venderPeso;
    if (typeof _origPeso === 'function') {
      window.venderPeso = function () {
        _origPeso.apply(this, arguments);
        renderizarPainel();
      };
    }

    // Patch de removerDoCarrinho
    const _origRemover = window.removerDoCarrinho;
    if (typeof _origRemover === 'function') {
      window.removerDoCarrinho = function () {
        _origRemover.apply(this, arguments);
        renderizarPainel();
      };
    }

    // Patch de definirQuantidadeCarrinho
    const _origDefinir = window.definirQuantidadeCarrinho;
    if (typeof _origDefinir === 'function') {
      window.definirQuantidadeCarrinho = function () {
        _origDefinir.apply(this, arguments);
        renderizarPainel();
      };
    }
  }

  // Também re-renderiza quando o carrinho é limpo após venda (renderizarCarrinho é chamado)
  const _origRenderCarrinho = window.renderizarCarrinho;
  document.addEventListener('DOMContentLoaded', () => {
    instalarPatches();

    // Patch de renderizarCarrinho para detectar carrinho zerado após venda
    const _orig = window.renderizarCarrinho;
    if (typeof _orig === 'function') {
      window.renderizarCarrinho = function () {
        _orig.apply(this, arguments);
        // Painel some quando carrinho fica vazio
        const c = typeof carrinho !== 'undefined' ? carrinho : {};
        if (Object.keys(c).length === 0) {
          const p = document.getElementById(PAINEL_ID);
          if (p) p.remove();
        }
      };
    }
  });

  // ─── API pública ────────────────────────────────────────────────────────────
  window.CarrinhoInteligente = {
    _adicionarProduto,
    renderizarPainel,
    sugerirRelacionados,
    calcularMargemVenda,
    itensCriticosAposVenda,
    detectarComboAtivo
  };

})();
