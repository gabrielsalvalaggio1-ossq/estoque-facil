// init.js — handlers estáticos do index.html que não pertencem ao app.js.
// Substitui o bloco <script> inline do final de index.html e o onclick inline
// do elemento #statLowWrap.

document.addEventListener('DOMContentLoaded', function () {
  // Botão de logout na sidebar (o app.js registra o btnLogout da aba Conta;
  // este arquivo cuida do btnLogoutSidebar separado na nav lateral).
  var btnLogoutSidebar = document.getElementById('btnLogoutSidebar');
  if (btnLogoutSidebar) {
    btnLogoutSidebar.addEventListener('click', function () {
      if (typeof fazerLogout === 'function') fazerLogout();
    });
  }

  // Card de estoque baixo no header — substitui onclick="irParaEstoqueBaixo()" inline.
  var statLowWrap = document.getElementById('statLowWrap');
  if (statLowWrap) {
    statLowWrap.addEventListener('click', function () {
      if (typeof irParaEstoqueBaixo === 'function') irParaEstoqueBaixo();
    });
  }
});
