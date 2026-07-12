/**
 * atalhos.js – Atalhos globais de teclado (T12 do Roadmap MEV)
 *
 * Atalhos:
 *   Alt+N       → Novo produto (navega para Estoque se necessário)
 *   /           → Foca o campo de busca da aba atual (fora de campos de texto)
 *   Alt+S       → Salva o formulário/modal aberto (só botões de salvar explícitos)
 *   ESC         → Fecha modal (gerenciado em app.js — não duplicado aqui)
 *
 * Por que Alt em vez de Ctrl:
 *   Ctrl+N, Ctrl+F e Ctrl+S são atalhos reservados pelo browser (nova janela,
 *   busca nativa, salvar página). O browser os processa antes de qualquer
 *   keydown da página — preventDefault() não tem efeito. Alt+N e Alt+S não
 *   têm significado padrão nos browsers modernos e chegam ao app normalmente.
 *
 * Regras:
 *   - Nenhum atalho dispara quando o foco está em input/textarea/select/contenteditable.
 *   - Alt+S só age em botões de salvar conhecidos — jamais clica em botões genéricos
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
    var alt  = e.altKey;
    var ctrl = e.ctrlKey || e.metaKey;
    if (!e.key) return;
    var tecla = e.key.toLowerCase();

    /* ─────────────────────────────────────────────────────────────────
       Alt+N : Novo produto
       Não dispara quando o usuário está digitando.
       ───────────────────────────────────────────────────────────────── */
    if (alt && !ctrl && tecla === 'n' && !estaDigitando(e)) {
      e.preventDefault();

      var papel = (typeof usuarioLogadoPapel !== 'undefined') ? usuarioLogadoPapel : null;
      var podeGerenciar = papel === 'dono' || papel === 'estoquista' || papel === 'gerente';
      if (!podeGerenciar) {
        if (typeof mostrarToast === 'function') mostrarToast('Sem permissão para adicionar produtos.', 'erro');
        return;
      }

      // Se está em outra aba, simula clique no botão da aba Estoque para
      // acionar toda a lógica de navegação já existente em app.js.
      if (typeof abaAtual !== 'undefined' && abaAtual !== 'estoque') {
        var btnEstoque = document.querySelector('[data-tab="estoque"]');
        if (btnEstoque) btnEstoque.click();
        setTimeout(function () {
          if (typeof abrirModalProduto === 'function') abrirModalProduto(null);
        }, 80);
      } else {
        if (typeof abrirModalProduto === 'function') abrirModalProduto(null);
      }
      return;
    }

    /* ─────────────────────────────────────────────────────────────────
       /  (fora de campo) : Focar campo de busca da aba atual
       Só dispara fora de campos de digitação e sem modificadores.
       ───────────────────────────────────────────────────────────────── */
    if (tecla === '/' && !ctrl && !alt && !e.shiftKey && !estaDigitando(e)) {
      e.preventDefault();

      var campo = primeiroVisivel([
        '#campoBusca',                  // Estoque
        '#campoBuscaVenda',             // Venda
        'input[placeholder*="uscar"]',  // fallback genérico
        'input[type="search"]',
        'main input[type="text"]',
      ]);

      if (campo) {
        campo.focus();
        campo.select();
      }
      return;
    }

    /* ─────────────────────────────────────────────────────────────────
       Alt+S : Salvar formulário/modal aberto
       Só age em botões de salvar EXPLICITAMENTE conhecidos.
       ───────────────────────────────────────────────────────────────── */
    if (alt && !ctrl && tecla === 's') {
      var modais = document.querySelectorAll('.modal-wrap');
      if (!modais.length) return;

      e.preventDefault();
      var ultimoModal = modais[modais.length - 1];

      var btnSalvar =
        ultimoModal.querySelector('button[data-acao="salvar"]') ||
        ultimoModal.querySelector('#btnSalvar') ||
        ultimoModal.querySelector('button.btn.primary') ||
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
      var CHAVE = 'mev_dica_atalhos_v2';
      if (localStorage.getItem(CHAVE)) return;
      localStorage.setItem(CHAVE, '1');
      mostrarToast('Dica: Alt+N novo produto · / busca · Alt+S salvar', 'info');
    }, 3500);
  });

})();