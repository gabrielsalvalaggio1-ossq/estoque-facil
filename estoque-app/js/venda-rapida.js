/**
 * venda-rapida.js — T7 Venda Ultrarrápida
 *
 * Funcionalidades:
 *   1. Busca instantânea: campo sempre focado ao entrar na aba Venda.
 *   2. Enter adiciona ao carrinho (1 resultado visível → adiciona; múltiplos → seleciona o primeiro focado).
 *   3. Navegação por teclado: ArrowDown/ArrowUp/Tab movem foco entre cards; Enter seleciona.
 *   4. ESC limpa a busca e volta ao estado inicial (sem fechar modal — isso fica no app.js).
 *   5. Atalho *N: digitar "*3" ao final do nome aplica quantidade N ao produto adicionado.
 *   6. F1–F4 durante cobrança: seleciona forma de pagamento (Dinheiro/Pix/Cartão/Fiado).
 *
 * Regras de convivência:
 *   - Nunca interfere quando há um modal aberto (.modal-wrap presente no DOM).
 *   - Nunca dispara quando o foco está em input/textarea/select DENTRO de modal.
 *   - Não altera nenhuma regra de negócio nem a lógica de carrinho existente.
 *   - ESC aqui só limpa busca; fechar modais continua sendo responsabilidade do app.js.
 *   - F1–F4 só agem quando o comprovante/modal de cobrança está aberto.
 *   - Compatível com atalhos.js (não duplica Ctrl+N, Ctrl+F, Ctrl+S, ESC de modal).
 */

(function () {
  'use strict';

  // ─── Constantes ─────────────────────────────────────────────────────────────

  /** Índice do card de produto com foco virtual (navegação por teclado). */
  let _indiceFoco = -1;

  /** Último valor do campo de busca sem o sufixo *N (para detectar mudança). */
  let _buscaSemSufixo = '';

  /** Quantidade pendente extraída do sufixo *N (null = nenhum). */
  let _quantidadePendente = null;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** True se há um modal aberto no DOM. */
  function modalAberto() {
    return document.querySelectorAll('.modal-wrap').length > 0;
  }

  /** True se o foco está num campo de texto/select (não num card). */
  function focadoEmCampo(e) {
    const t = e ? e.target : document.activeElement;
    return (
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable
    );
  }

  /** Retorna os cards de produto visíveis na lista de venda. */
  function cardsVisiveis() {
    return Array.from(
      document.querySelectorAll('#listaVenda .product-card.venda-card')
    );
  }

  /** Campo de busca da aba Venda (pode não existir se outra aba estiver ativa). */
  function campoBusca() {
    return document.getElementById('campoBuscaVenda');
  }

  /** True se a aba Venda está ativa. */
  function abaVendaAtiva() {
    return typeof abaAtual !== 'undefined' && abaAtual === 'venda';
  }

  // ─── 1. Auto-foco ao entrar na aba ─────────────────────────────────────────
  // O renderizarConteudo em ui-clientes-render.js já chama atualizarListaVenda()
  // e depois o app.js faz requestAnimationFrame + focus. Mas para garantir
  // (inclusive em re-renders parciais), observamos quando o campo aparece.

  const _observer = new MutationObserver(() => {
    if (!abaVendaAtiva()) return;
    const campo = campoBusca();
    if (campo && document.activeElement !== campo && !modalAberto()) {
      // Só foca se nenhum outro elemento já tem foco intencional
      if (document.activeElement === document.body || document.activeElement === null) {
        campo.focus();
      }
    }
  });

  // Observa inserções no #main para detectar quando a aba Venda é montada
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.getElementById('main');
    if (main) {
      _observer.observe(main, { childList: true, subtree: false });
    }
  });

  // ─── 2 + 5. Enter adiciona ao carrinho; *N define quantidade ────────────────

  /**
   * Analisa o valor atual do campo de busca e extrai:
   *   { termoLimpo, quantidade }
   * Ex: "arroz*3" → { termoLimpo: "arroz", quantidade: 3 }
   *     "feijão"  → { termoLimpo: "feijão", quantidade: 1 }
   */
  function parsearCampo(valor) {
    const str = (valor || '').trim();
    const match = str.match(/^(.+?)\*(\d+(?:[.,]\d+)?)$/);
    if (match) {
      const termo = match[1].trim();
      const qtd = parseFloat(match[2].replace(',', '.'));
      return { termoLimpo: termo, quantidade: isNaN(qtd) || qtd <= 0 ? 1 : qtd };
    }
    return { termoLimpo: str, quantidade: 1 };
  }

  /**
   * Filtra os produtos da aba Venda pelo termo (mesma lógica de atualizarListaVenda).
   * Inclui todos os produtos — sem estoque também são retornados (o card os desabilita).
   */
  function produtosFiltrados(termo) {
    if (typeof produtosCache === 'undefined') return [];
    const t = (termo || '').trim().toLowerCase();
    const cat = typeof categoriaVenda !== 'undefined' ? categoriaVenda : '';
    return produtosCache.filter(p => {
      if (t && !p.nome.toLowerCase().includes(t)) return false;
      if (cat && (p.categoria || (typeof Produtos !== 'undefined' ? Produtos.CATEGORIA_PADRAO : 'Geral')) !== cat) return false;
      return true;
    });
  }

  /**
   * Adiciona produto ao carrinho com quantidade opcional.
   * Reutiliza alterarCarrinho (global de ui-clientes-render.js).
   */
  function adicionarComQuantidade(produtoId, quantidade) {
    const produto = typeof produtosCache !== 'undefined'
      ? produtosCache.find(p => p.id === produtoId)
      : null;
    if (!produto || produto.estoque <= 0) return;

    const qtdFinal = Math.min(quantidade, produto.estoque);

    if (produto.unidade === 'kg') {
      // Para produtos por peso, usa definirQuantidadeCarrinho
      if (typeof definirQuantidadeCarrinho === 'function') {
        definirQuantidadeCarrinho(produtoId, qtdFinal);
      }
    } else {
      // Para produtos por unidade: se já há quantidade no carrinho, substitui
      const atual = (typeof carrinho !== 'undefined' && carrinho[produtoId]) ? carrinho[produtoId] : 0;
      const delta = qtdFinal - atual;
      if (delta !== 0 && typeof alterarCarrinho === 'function') {
        alterarCarrinho(produtoId, delta);
      } else if (delta === 0) {
        // Produto já está com a quantidade certa — apenas feedback visual
        _piscarCard(produtoId);
      }
    }
  }

  /** Pisca brevemente o card para dar feedback quando já estava no carrinho. */
  function _piscarCard(produtoId) {
    const card = document.querySelector(`[onclick*="${produtoId}"]`);
    if (!card) return;
    card.style.transition = 'opacity 80ms';
    card.style.opacity = '0.4';
    setTimeout(() => { card.style.opacity = ''; }, 160);
  }

  // ─── 3. Navegação por teclado nos cards ────────────────────────────────────

  function moverFocoCard(direcao) {
    const cards = cardsVisiveis();
    if (cards.length === 0) return;

    if (_indiceFoco < 0 || _indiceFoco >= cards.length) {
      _indiceFoco = direcao > 0 ? 0 : cards.length - 1;
    } else {
      _indiceFoco = (_indiceFoco + direcao + cards.length) % cards.length;
    }

    cards.forEach((c, i) => c.classList.toggle('foco-teclado', i === _indiceFoco));
    cards[_indiceFoco].focus();
    cards[_indiceFoco].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function resetarFocoCards() {
    _indiceFoco = -1;
    cardsVisiveis().forEach(c => c.classList.remove('foco-teclado'));
  }

  // ─── 4. ESC limpa busca ─────────────────────────────────────────────────────

  function limparBusca() {
    const campo = campoBusca();
    if (!campo) return;
    campo.value = '';
    if (typeof buscaVenda !== 'undefined') buscaVenda = '';
    _quantidadePendente = null;
    _buscaSemSufixo = '';
    resetarFocoCards();
    if (typeof atualizarListaVenda === 'function') atualizarListaVenda();
    campo.focus();
  }

  // ─── 6. F1–F4: forma de pagamento no comprovante ────────────────────────────

  const MAPA_FKEY_PAGAMENTO = {
    F1: 'dinheiro',
    F2: 'pix',
    F3: 'cartao',
    F4: 'fiado'
  };

  /**
   * Seleciona a forma de pagamento no modal de cobrança/comprovante.
   * Procura botões/chips com data-forma ou radio inputs com value correspondente.
   */
  function selecionarFormaPagamento(forma) {
    // Tenta clicar num botão/chip com data-forma="dinheiro" etc.
    const btnForma =
      document.querySelector(`.modal-wrap [data-forma="${forma}"]`) ||
      document.querySelector(`.modal-wrap button[data-pagamento="${forma}"]`) ||
      document.querySelector(`.modal-wrap .chip[data-forma="${forma}"]`);

    if (btnForma) {
      btnForma.click();
      return;
    }

    // Fallback: radio input
    const radio = document.querySelector(`.modal-wrap input[type="radio"][value="${forma}"]`);
    if (radio) {
      radio.click();
      return;
    }

    // Fallback: select de forma de pagamento
    const select = document.querySelector('.modal-wrap select#formaPagamento, .modal-wrap select[name="formaPagamento"]');
    if (select) {
      select.value = forma;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ─── Listener principal de keydown ─────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    const tecla = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    // ── F1–F4: só agem quando há modal de cobrança aberto ──────────────────
    if (MAPA_FKEY_PAGAMENTO[tecla] && modalAberto()) {
      // Só interfere se o modal de cobrança estiver presente (tem campo de pagamento)
      const temCampoForma =
        document.querySelector('.modal-wrap [data-forma]') ||
        document.querySelector('.modal-wrap input[name="formaPagamento"]') ||
        document.querySelector('.modal-wrap select#formaPagamento') ||
        document.querySelector('.modal-wrap .chip[data-forma]');

      if (temCampoForma) {
        e.preventDefault();
        selecionarFormaPagamento(MAPA_FKEY_PAGAMENTO[tecla]);
        return;
      }
    }

    // A partir daqui, todos os atalhos requerem a aba Venda ativa e sem modal
    if (!abaVendaAtiva() || modalAberto()) return;

    // ── ESC: limpa busca (só se campo de busca tem valor ou cards têm foco) ──
    if (tecla === 'Escape' && !modalAberto()) {
      const campo = campoBusca();
      if (campo && (campo.value || _indiceFoco >= 0)) {
        e.stopImmediatePropagation(); // evita que app.js tente fechar modal inexistente
        limparBusca();
        return;
      }
      // Se busca já está vazia, deixa o ESC propagar (app.js cuida do resto)
      return;
    }

    // ── ArrowDown / Tab (sem Shift) → próximo card ─────────────────────────
    if (tecla === 'ArrowDown' || (tecla === 'Tab' && !e.shiftKey && !focadoEmCampo(e))) {
      // Tab só captura quando o foco NÃO está no campo de busca ou select
      if (tecla === 'Tab' && document.activeElement === campoBusca()) return;
      if (tecla === 'Tab' && document.activeElement && document.activeElement.tagName === 'SELECT') return;

      const cards = cardsVisiveis();
      if (cards.length === 0) return;
      e.preventDefault();
      moverFocoCard(1);
      return;
    }

    // ── ArrowUp / Shift+Tab → card anterior ────────────────────────────────
    if (tecla === 'ArrowUp' || (tecla === 'Tab' && e.shiftKey && _indiceFoco >= 0)) {
      if (tecla === 'Tab' && document.activeElement === campoBusca()) return;
      const cards = cardsVisiveis();
      if (cards.length === 0) return;
      e.preventDefault();
      // Shift+Tab no primeiro card → volta ao campo de busca
      if (_indiceFoco <= 0) {
        resetarFocoCards();
        campoBusca()?.focus();
        return;
      }
      moverFocoCard(-1);
      return;
    }

    // ── Enter: adiciona produto com foco, ou o único resultado ────────────
    if (tecla === 'Enter') {
      // Caso A: há um card com foco de teclado
      if (_indiceFoco >= 0) {
        const cards = cardsVisiveis();
        const card = cards[_indiceFoco];
        if (card) {
          // Extrai o produtoId do onclick do card ou do botão "Vender" interno
          const idMatch = (card.getAttribute('onclick') || '')
            .match(/alterarCarrinho\(['"]([^'"]+)['"]/);
          const produtoId = idMatch ? idMatch[1] : null;

          if (produtoId) {
            const campo = campoBusca();
            const { quantidade } = parsearCampo(campo ? campo.value : '');
            e.preventDefault();
            adicionarComQuantidade(produtoId, quantidade);
            limparBusca();
            return;
          }
        }
      }

      // Caso B: campo de busca com exatamente 1 resultado com estoque
      const campo = campoBusca();
      if (campo && document.activeElement === campo) {
        const { termoLimpo, quantidade } = parsearCampo(campo.value);
        if (!termoLimpo) return;

        const disponiveis = produtosFiltrados(termoLimpo).filter(p => p.estoque > 0);
        if (disponiveis.length === 1) {
          e.preventDefault();
          adicionarComQuantidade(disponiveis[0].id, quantidade);
          limparBusca();
        }
        // Múltiplos resultados: manda o foco pro primeiro card
        else if (disponiveis.length > 1) {
          e.preventDefault();
          _indiceFoco = -1;
          moverFocoCard(1);
        }
        return;
      }

      // Caso C: Enter num card focado nativamente (Tab do navegador)
      const cardFocado = document.activeElement?.closest?.('.venda-card');
      if (cardFocado) {
        const btn = cardFocado.querySelector('.sellbtn:not([disabled]), .qtybtn.add:not([disabled])');
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
    }

  }, true); // capture=true para ter prioridade antes do handler do app.js

  // ─── Limpar foco dos cards ao digitar no campo de busca ─────────────────────
  // Usa event delegation — o campo pode ser (re)criado a cada render.

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'campoBuscaVenda') {
      resetarFocoCards();

      // Atalho *N: atualiza a lista filtrando apenas pelo termo base
      const { termoLimpo, quantidade } = parsearCampo(e.target.value);
      if (termoLimpo !== _buscaSemSufixo) {
        _buscaSemSufixo = termoLimpo;
        // Injeta só o termo limpo no estado global e re-renderiza
        if (typeof buscaVenda !== 'undefined') buscaVenda = termoLimpo;
        // Não altera o value do campo — o usuário continua vendo "*3"
        if (typeof atualizarListaVenda === 'function') atualizarListaVenda();
      }
      _quantidadePendente = quantidade > 1 ? quantidade : null;
    }
  }, true);

  // ─── Tornar cards focáveis por teclado ──────────────────────────────────────
  // Os cards são <div> — precisam de tabindex para receber foco.
  // Usamos MutationObserver na listaVenda para adicionar tabindex dinamicamente.

  const _observerCards = new MutationObserver(() => {
    document.querySelectorAll('#listaVenda .product-card.venda-card:not([tabindex])').forEach(card => {
      card.setAttribute('tabindex', '-1');
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    const listaVenda = document.getElementById('listaVenda');
    if (listaVenda) {
      _observerCards.observe(listaVenda, { childList: true, subtree: true });
    } else {
      // Fallback: observa o main inteiro para detectar quando listaVenda é criado
      const main = document.getElementById('main');
      if (main) {
        const obs2 = new MutationObserver(() => {
          const lv = document.getElementById('listaVenda');
          if (lv) {
            _observerCards.observe(lv, { childList: true, subtree: true });
            obs2.disconnect();
          }
        });
        obs2.observe(main, { childList: true, subtree: true });
      }
    }
  });

  // Também re-aplica após cada atualizarListaVenda (que pode recriar os cards)
  const _atualizarListaVendaOriginal =
    typeof window !== 'undefined' ? window.atualizarListaVenda : undefined;

  // Patch aplicado após DOMContentLoaded para garantir que a função global exista
  document.addEventListener('DOMContentLoaded', () => {
    const _orig = window.atualizarListaVenda;
    if (typeof _orig === 'function') {
      window.atualizarListaVenda = function () {
        _orig.apply(this, arguments);
        resetarFocoCards();
        // tabindex adicionado pelo MutationObserver acima
      };
    }
  });

  // ─── Badge visual de quantidade pendente (*N) ───────────────────────────────

  function atualizarBadgeQtd(quantidade) {
    const campo = campoBusca();
    if (!campo) return;

    let badge = document.getElementById('qtd-pendente-badge');
    if (quantidade && quantidade > 1) {
      campo.classList.add('tem-sufixo');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'qtd-pendente-badge';
        // Insere após o campo de busca se ele estiver num wrapper
        campo.parentNode.style.position = campo.parentNode.style.position || 'relative';
        campo.parentNode.appendChild(badge);
      }
      badge.textContent = `×${quantidade}`;
      badge.style.display = '';
    } else {
      campo.classList.remove('tem-sufixo');
      if (badge) badge.style.display = 'none';
    }
  }

  // ─── Legenda de atalhos abaixo do campo de busca ────────────────────────────

  function injetarHintAtalhos() {
    if (document.getElementById('venda-atalhos-hint')) return;
    const campo = campoBusca();
    if (!campo) return;

    const hint = document.createElement('div');
    hint.id = 'venda-atalhos-hint';
    hint.innerHTML =
      '<span><kbd>Enter</kbd> adiciona</span>' +
      '<span><kbd>↑↓</kbd> navegar</span>' +
      '<span><kbd>nome*3</kbd> qtd</span>' +
      '<span><kbd>F1–F4</kbd> pagamento</span>' +
      '<span><kbd>Esc</kbd> limpar</span>';

    // Insere abaixo do topbar da venda
    const topbar = campo.closest('.venda-topbar');
    if (topbar && topbar.parentNode) {
      topbar.parentNode.insertBefore(hint, topbar.nextSibling);
    }
  }

  // Observa quando o campo de busca aparece para injetar o hint
  const _observerHint = new MutationObserver(() => {
    if (abaVendaAtiva() && campoBusca() && !document.getElementById('venda-atalhos-hint')) {
      injetarHintAtalhos();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const main = document.getElementById('main');
    if (main) _observerHint.observe(main, { childList: true, subtree: true });
  });

  // Atualiza o badge toda vez que o input muda
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'campoBuscaVenda') {
      const { quantidade } = parsearCampo(e.target.value);
      atualizarBadgeQtd(quantidade);
    }
  });

  // ─── Dica de atalhos de venda (uma vez por sessão) ───────────────────────────
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (typeof mostrarToast !== 'function') return;
      const CHAVE = 'mev_dica_venda_rapida_v1';
      if (localStorage.getItem(CHAVE)) return;
      localStorage.setItem(CHAVE, '1');
      mostrarToast('Venda rápida: Enter adiciona · *3 = 3 un · F1–F4 pagamento', 'info');
    }, 5000); // 5 s após o load, depois da dica de atalhos gerais (3,5 s)
  });

})();
