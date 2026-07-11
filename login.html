// login.js — lógica exclusiva da página login.html.
// Substitui os blocos <script> inline que existiam nessa página.

// Exibe mensagem de sessão expirada por inatividade (gravada por app.js antes do redirect).
(function () {
  var msg = sessionStorage.getItem('_mev_sessao_expirada');
  if (msg) {
    sessionStorage.removeItem('_mev_sessao_expirada');
    var el = document.getElementById('erro');
    if (el) el.textContent = msg;
  }
})();

function voltar() {
  // Se a pessoa chegou até aqui navegando dentro do próprio site, volta
  // pra tela anterior de verdade. Se abriu o link direto (sem histórico),
  // cai na página de planos — nunca no index.
  if (document.referrer && document.referrer.indexOf(location.origin) === 0 && history.length > 1) {
    history.back();
  } else {
    window.location.href = '/planos.html';
  }
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;
  const erroEl = document.getElementById('erro');
  const botao = document.getElementById('btnEntrar');
  erroEl.textContent = '';

  if (!email || !senha) {
    erroEl.textContent = 'Preencha e-mail e senha.';
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Entrando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await res.json();

    if (data.ok) {
      // Se veio com ?next=planos, volta pra lá (o plano_pendente já está no sessionStorage)
      const params = new URLSearchParams(window.location.search);
      const next = params.get('next');
      window.location.href = next === 'planos' ? '/planos.html' : '/index.html';
      return;
    }
    erroEl.textContent = data.error || 'Erro no login.';
  } catch (e) {
    erroEl.textContent = 'Não foi possível conectar ao servidor.';
  }

  botao.disabled = false;
  botao.textContent = 'Entrar';
}

// Substitui os atributos onclick/onsubmit inline que existiam no HTML
// (necessário para CSP sem 'unsafe-inline' em event handlers estáticos).
document.addEventListener('DOMContentLoaded', function () {
  var btnVoltar = document.querySelector('.auth-voltar');
  if (btnVoltar) btnVoltar.addEventListener('click', voltar);

  // Se veio com ?plano=X, atualiza o link "Criar conta" para passar o plano
  var params = new URLSearchParams(window.location.search);
  var planoParam = params.get('plano');
  if (planoParam) {
    var linkCadastro = document.querySelector('a[href="/cadastro.html"]');
    if (linkCadastro) {
      // Detecta ciclo pelo sufixo do planoId (essencial_anual → anual)
      var ciclo = planoParam.endsWith('_anual') ? 'anual' : 'mensal';
      var planoBase = planoParam.replace('_anual', '').replace('_mensal', '');
      linkCadastro.href = '/cadastro.html?plano=' + planoBase + '&ciclo=' + ciclo;
    }
  }

  var formLogin = document.querySelector('.auth-form');
  if (formLogin) {
    formLogin.addEventListener('submit', function (e) {
      e.preventDefault();
      login();
    });
  }
});