/**
 * atalhos.js – Atalhos globais de teclado (T12 do Roadmap MEV)
 *
 * Atalhos:
 *   Ctrl+N / ⌘N     → Novo produto (navega para Estoque se necessário)
 *   Ctrl+F / ⌘F / / → Foca o campo de busca do tab atual
 *   Ctrl+S / ⌘S     → Salva o formulário/modal aberto (só botões de salvar explícitos)
 *   ESC             → Fecha modal (gerenciado em app.js — não duplicado aqui)
 *
 * Regras:
 *   - Nenhum atalho dispara quando o foco está em input/textarea/select/contenteditable.
 *   - Ctrl+S só age em botões de salvar conhecidos — jamais clica em botões genéricos
 *     ou de confirmação, para evitar ações destrutivas acidentais.
 *   - Comparações de tecla são case-insensitive (e.key.toLowerCase()).
 */

(function () {
  'use strict';

  /** Retorna true se o evento originou de um campo de digitação. */
  function estaDigitando(e) {
    var t = e.target;
    return (
      t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable
    );
  }

  /** Retorna o primeiro elemento visível que corresponda a qualquer seletor da lista. */
  function primeiroVisivel(seletores) {
    for (var i = 0; i < seletores.length; i++) {
      try {
        var todos = document.querySelectorAll(seletores[i]);
        for (var j = 0; j < todos.length; j++) {
          if (todos[j].offsetParent !== null) return todos[j];
        }
      } catch (_) { /* seletor inválido — ignora */ }
    }
    return null;
  }

  document.addEventListener('keydown', function (e) {
    var ctrl = e.ctrlKey || e.metaKey;
    if (!e.key) return; // ignora eventos sem key (ex: disparados por scripts)
    var tecla = e.key.toLowerCase(); // case-insensitive: evita problemas com CapsLock

    /* ─────────────────────────────────────────────────────────────────
       Ctrl+N / ⌘N : Novo produto
       Não dispara quando o usuário está digitando.
       ───────────────────────────────────────────────────────────────── */
    if (ctrl && tecla === 'n' && !estaDigitando(e)) {
      e.preventDefault();

      var papel = (typeof usuarioLogadoPapel !== 'undefined') ? usuarioLogadoPapel : null;
      var podeGerenciar = papel === 'dono' || papel === 'estoquista';
      if (!podeGerenciar) {
        if (typeof mostrarToast === 'function') mostrarToast('Sem permissão para adicionar produtos.', 'erro');
        return;
      }

      // Se está em outra aba, navega para Estoque primeiro
      if (typeof abaAtual !== 'undefined' && abaAtual !== 'estoque') {
        abaAtual = 'estoque';
        document.querySelectorAll('[data-tab]').forEach(function (b) {
          b.classList.toggle('active', b.dataset.tab === 'estoque');
        });
        if (typeof renderizarTudo === 'function') renderizarTudo();
        setTimeout(function () {
          if (typeof abrirModalProduto === 'function') abrirModalProduto(null);
        }, 80);
      } else {
        if (typeof abrirModalProduto === 'function') abrirModalProduto(null);
      }
      return;
    }

    /* ─────────────────────────────────────────────────────────────────
       Ctrl+F / ⌘F  ou  /  (fora de campo) : Focar campo de busca
       Ambos só disparam fora de campos de digitação.
       ───────────────────────────────────────────────────────────────── */
    var ehBarra = tecla === '/' && !ctrl && !e.altKey && !e.shiftKey;

    if (((ctrl && tecla === 'f') || ehBarra) && !estaDigitando(e)) {
      e.preventDefault();

      var campo = primeiroVisivel([
        '#campoBusca',                   // Estoque — id fixo em ui-estoque-venda.js
        '#buscaVenda',                   // Venda (caso exista)
        'input[placeholder*="uscar"]',   // fallback genérico (Buscar / buscar)
        'input[type="search"]',
        'main input[type="text"]',       // qualquer input de texto dentro do main
      ]);

      if (campo) {
        campo.focus();
        campo.select();
      }
      return;
    }

    /* ─────────────────────────────────────────────────────────────────
       Ctrl+S / ⌘S : Salvar formulário/modal aberto
       Só age em botões de salvar EXPLICITAMENTE conhecidos — jamais em
       botões genéricos como "button:last-of-type" ou "button.primary",
       que podem representar confirmações destrutivas.
       ───────────────────────────────────────────────────────────────── */
    if (ctrl && tecla === 's') {
      var modais = document.querySelectorAll('.modal-wrap');
      if (!modais.length) return; // sem modal → não bloqueia Ctrl+S do navegador

      e.preventDefault();
      var ultimoModal = modais[modais.length - 1];

      // Procura apenas por botões de salvar com atributos/classes explícitas;
      // NÃO usa fallbacks genéricos para não disparar confirm/delete por acidente.
      var btnSalvar =
        ultimoModal.querySelector('button[data-acao="salvar"]') ||
        ultimoModal.querySelector('button.btn-destaque[type="button"]') ||
        ultimoModal.querySelector('button[type="submit"]');

      if (btnSalvar && !btnSalvar.disabled) {
        btnSalvar.click();
      }
      return;
    }
  });

  /* ─────────────────────────────────────────────────────────────────
     Dica de atalhos na primeira visita (3,5 s após carregamento)
     ───────────────────────────────────────────────────────────────── */
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (typeof mostrarToast !== 'function') return;
      var CHAVE = 'mev_dica_atalhos_v1';
      if (localStorage.getItem(CHAVE)) return;
      localStorage.setItem(CHAVE, '1');
      mostrarToast('Dica: Ctrl+N novo produto · Ctrl+F busca · Ctrl+S salvar', 'info');
    }, 3500);
  });

})();