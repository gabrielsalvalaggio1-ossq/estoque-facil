/**
 * estados.js – T3 do Roadmap MEV
 *
 * Funções globais de estado da aplicação:
 *   criarSkeletonMain(n)        → HTML de skeleton para o #main
 *   criarErroMain(msg, retry)   → HTML de erro com botão "Tentar novamente"
 *   criarSemResultado(titulo, dica) → HTML de "sem resultados"
 *
 * Detecção de offline/online com banner persistente.
 * Sem dependências externas — funciona com Cloudflare Pages.
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     Skeleton
     ───────────────────────────────────────────────────────────── */

  /**
   * Retorna HTML de N itens skeleton para colocar em #main enquanto
   * os dados ainda não chegaram do servidor.
   * @param {number} [n=6] — número de itens fake
   */
  function criarSkeletonMain(n) {
    n = n || 6;
    var items = '';
    for (var i = 0; i < n; i++) {
      items += [
        '<div class="skeleton-item">',
        '  <div class="skeleton-thumb"></div>',
        '  <div class="skeleton-linhas">',
        '    <div class="skeleton-linha larga"></div>',
        '    <div class="skeleton-linha media"></div>',
        '  </div>',
        '  <div class="skeleton-valor"></div>',
        '</div>'
      ].join('');
    }
    return '<div class="skeleton-lista">' + items + '</div>';
  }

  /* ─────────────────────────────────────────────────────────────
     Error State
     ───────────────────────────────────────────────────────────── */

  /**
   * Retorna HTML de estado de erro.
   * @param {string}   [msg]       — mensagem técnica (opcional, exibida pequena)
   * @param {string}   [retryId]   — id do botão para o caller adicionar listener
   */
  function criarErroMain(msg, retryId) {
    retryId = retryId || 'btnEstadoErroRetry';
    var detalhe = msg
      ? '<span class="estado-detalhe">' + _esc(msg) + '</span>'
      : '';
    return [
      '<div class="estado-erro">',
      '  <span class="estado-icone">⚠️</span>',
      '  <p class="estado-titulo">Não foi possível carregar</p>',
      '  <p class="estado-dica">Verifique sua conexão e tente novamente.</p>',
      '  <button class="btn-tentar-novamente" id="' + retryId + '">Tentar novamente</button>',
      detalhe,
      '</div>'
    ].join('');
  }

  /* ─────────────────────────────────────────────────────────────
     Sem Resultados
     ───────────────────────────────────────────────────────────── */

  /**
   * Retorna HTML de "sem resultados" para buscas/filtros vazios.
   * @param {string} titulo — ex: "Nenhum produto encontrado"
   * @param {string} [dica] — ex: "Tente outro termo ou remova os filtros."
   */
  function criarSemResultado(titulo, dica) {
    return [
      '<div class="sem-resultado-estado">',
      '  <span class="sem-resultado-icone">🔍</span>',
      '  <p class="sem-resultado-titulo">' + _esc(titulo) + '</p>',
      dica ? '  <p class="sem-resultado-dica">' + _esc(dica) + '</p>' : '',
      '</div>'
    ].join('');
  }

  /* ─────────────────────────────────────────────────────────────
     Offline Detection
     ───────────────────────────────────────────────────────────── */

  var MSG_OFFLINE = [
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"',
    '     stroke="currentColor" stroke-width="2.5"',
    '     stroke-linecap="round" stroke-linejoin="round">',
    '  <line x1="1" y1="1" x2="23" y2="23"/>',
    '  <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>',
    '  <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>',
    '  <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>',
    '  <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>',
    '  <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>',
    '  <line x1="12" y1="20" x2="12.01" y2="20"/>',
    '</svg>',
    ' Sem conexão — você está offline'
  ].join('');

  function _inserirBannerOffline() {
    if (document.getElementById('bannerOffline')) return;
    var banner = document.createElement('div');
    banner.id = 'bannerOffline';
    banner.className = 'banner-offline';
    banner.innerHTML = MSG_OFFLINE;
    // Insere diretamente no body como primeiro filho para
    // ficar fora do flex #shell e ocupar toda a largura.
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function _atualizarEstadoOffline() {
    _inserirBannerOffline();
    var banner = document.getElementById('bannerOffline');
    if (navigator.onLine) {
      document.body.classList.remove('offline');
      // Banner verde de "voltou" visível por ~3 s, depois some
      if (banner) {
        banner.classList.remove('banner-offline--voltou');
        banner.innerHTML = '✓ Conexão restaurada';
        banner.classList.add('banner-offline--voltou');
        banner.style.display = 'block';
        setTimeout(function () {
          banner.classList.remove('banner-offline--voltou');
          banner.style.display = '';
        }, 3400);
      }
    } else {
      // Restaura a mensagem offline antes de exibir o banner
      if (banner) {
        banner.classList.remove('banner-offline--voltou');
        banner.style.display = '';
        banner.innerHTML = MSG_OFFLINE;
      }
      document.body.classList.add('offline');
    }
  }

  // Estado inicial
  window.addEventListener('DOMContentLoaded', function () {
    _inserirBannerOffline();
    if (!navigator.onLine) {
      document.body.classList.add('offline');
    }
  });

  window.addEventListener('offline', _atualizarEstadoOffline);
  window.addEventListener('online',  _atualizarEstadoOffline);

  /* ─────────────────────────────────────────────────────────────
     Utilitário interno
     ───────────────────────────────────────────────────────────── */

  function _esc(txt) {
    return String(txt || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ─────────────────────────────────────────────────────────────
     Expõe globalmente (mesmo padrão dos demais módulos do projeto)
     ───────────────────────────────────────────────────────────── */

  window.criarSkeletonMain   = criarSkeletonMain;
  window.criarErroMain       = criarErroMain;
  window.criarSemResultado   = criarSemResultado;

})();
