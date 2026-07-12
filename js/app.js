/**
 * app.js
 * Ponto de entrada do app: restrição de abas por papel do usuário e boot
 * (iniciar/criarEmpresaEContinuar). Todo o resto da interface foi dividido
 * em módulos ui-*.js, carregados antes deste — veja index.html pra ordem.
 */

// --- Inicialização ---

document.querySelectorAll('[data-tab]').forEach(botao => {
  botao.addEventListener('click', () => {
    if (modoSelecaoEtiquetas && botao.dataset.tab !== 'estoque') cancelarSelecaoEtiquetas();
    abaAtual = botao.dataset.tab;

    // Bloqueio defensivo: se usuário não-Pro tentar acessar Central ou Atividades
    // diretamente (ex: via JS console), exibe tela de upgrade em vez do conteúdo.
    if (abaAtual === 'central' || abaAtual === 'atividades') {
      const ehPlanoPro = usuarioLogadoPlano === 'pro' || usuarioLogadoPlano === 'pro_anual';
      if (!ehPlanoPro) {
        document.getElementById('main').innerHTML = criarTelaUpgradePro(abaAtual);
        document.getElementById('main').querySelector('[data-acao="ir-para-assinatura"]')
          ?.addEventListener('click', () => { abaAtual = 'assinatura'; renderizarTudo(); });
        return;
      }
    }

    renderizarTudo();

    // Aba "Estoque" sem produtos ainda: mostra a tela de boas-vindas em vez
    // do estado vazio padrão (a menos que a pessoa já tenha dispensado).
    if (abaAtual === 'estoque' && typeof deveMostrarBoasVindas === 'function' && deveMostrarBoasVindas()) {
      renderizarTelaBoasVindas();
    } else if (abaAtual !== 'estoque') {
      // Navegar para qualquer outra aba já conta como "dar uma volta pelo app"
      // pro checklist de primeiros passos.
      localStorage.setItem('mevExplorouApp', '1');
    }
    if (typeof atualizarChecklistPrimeirosPassos === 'function') atualizarChecklistPrimeirosPassos();

    requestAnimationFrame(() => {
      if (abaAtual === 'estoque') document.getElementById('campoBusca')?.focus();
      if (abaAtual === 'venda')   document.getElementById('campoBuscaVenda')?.focus();
    });
  });
});

/**
 * Tela de bloqueio exibida para usuários Free/Essencial que tentam acessar
 * a Central de Dados (plano Pro) ou Atividades (plano Pro).
 *
 * Design: cartão centralizado com CTA para ir à aba Assinatura.
 * NÃO substitui o bloqueio em central-dados.js — é uma segunda camada
 * de defesa que também melhora o UX (CTA claro em vez de conteúdo vazio).
 */
function criarTelaUpgradePro(aba) {
  const ehCentral = aba === 'central';
  const icone  = ehCentral ? '📊' : '🕵️';
  const titulo = ehCentral ? 'Dashboard Pro' : 'Histórico de Atividades';
  const descricao = ehCentral
    ? `Filtros de período, gráfico de vendas, ranking de produtos e clientes,
       controle de fiado, alertas de estoque — tudo em um painel poderoso.
       Disponível exclusivamente no plano Pro.`
    : `Veja um registro completo de tudo que foi feito na sua conta: quem
       cadastrou produto, fez venda, alterou preço e muito mais. Recurso
       exclusivo do plano Pro.`;

  const beneficios = ehCentral ? [
    '📅 Filtro por hoje, semana, mês ou período personalizado',
    '📊 Gráfico de vendas interativo por período',
    '🏆 Produtos e clientes mais rentáveis',
    '💳 Controle de devedores de fiado',
    '📦 Alertas automáticos de estoque baixo',
    '🎯 Metas mensais e comparativos',
  ] : [
    '🕵️ Auditoria completa de todas as ações',
    '👥 Quem fez o quê e quando',
    '🔍 Filtro por tipo de ação e colaborador',
  ];

  return `<div class="page">
    <div class="pro-paywall">
      <div class="pro-paywall-icone">${icone}</div>
      <h2 class="pro-paywall-titulo">${titulo}</h2>
      <p class="pro-paywall-desc">${descricao}</p>
      <ul class="pro-paywall-lista">
        ${beneficios.map(b => `<li>${b}</li>`).join('')}
      </ul>
      <div class="pro-paywall-badge">Plano Pro</div>
      <button type="button" class="btn primary pro-paywall-cta" data-acao="ir-para-assinatura">
        Ver planos e fazer upgrade →
      </button>
      <p class="pro-paywall-nota">Sem fidelidade · Cancele a qualquer momento</p>
    </div>
  </div>`;
}

document.getElementById('btnAddProduct').addEventListener('click', () => {
  const podeVerEstoque = usuarioLogadoPapel === 'dono' || usuarioLogadoPapel === 'estoquista' || usuarioLogadoPapel === 'gerente';
  const jaViuOnboarding = localStorage.getItem(CHAVE_ONBOARDING);
  if (podeVerEstoque && produtosCache.length === 0 && !jaViuOnboarding) {
    abrirOnboarding();
  } else {
    abrirModalProduto(null);
  }
});
document.getElementById('btnEscanearVender').addEventListener('click', abrirScannerParaVender);
document.getElementById('btnCobrar').addEventListener('click', abrirComprovante);
document.getElementById('btnExportar').addEventListener('click', abrirMenuExportar);
document.getElementById('btnExportarSidebar').addEventListener('click', abrirMenuExportar);
document.querySelectorAll('[data-acao="importar-produtos"]').forEach(botao => {
  botao.addEventListener('click', abrirWizardImportacao);
});

document.getElementById('btnSelecionarEtiquetas').addEventListener('click', ativarModoSelecaoEtiquetas);
document.getElementById('btnCancelarSelecaoEtiquetas').addEventListener('click', cancelarSelecaoEtiquetas);
document.getElementById('btnImprimirEtiquetasSelecionadas').addEventListener('click', abrirConfigEtiquetas);

// T5: ações em lote (excluir/mudar categoria de vários produtos de uma vez)
document.getElementById('btnSelecionarLote').addEventListener('click', ativarModoSelecaoLote);
document.getElementById('btnCancelarSelecaoLote').addEventListener('click', cancelarSelecaoLote);
document.getElementById('btnSelecionarTodosLote').addEventListener('click', selecionarTodosLote);
document.getElementById('btnExcluirSelecionadosLote').addEventListener('click', confirmarExclusaoLote);
document.getElementById('btnMudarCategoriaLote').addEventListener('click', abrirAlterarCategoriaLote);

// Fecha o modal mais recente ao pressionar ESC.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const btnScanner = document.getElementById('btnFecharScanner');
  if (btnScanner) { btnScanner.click(); return; }
  const modais = document.querySelectorAll('.modal-wrap');
  if (!modais.length) return;
  modais[modais.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: false }));
});

/**
 * Esconde as abas que o papel da pessoa logada não deveria ver.
 * A aba Central (dashboard Pro) e Atividades só aparecem para donos no plano Pro.
 * Usuários Free e Essencial não veem essas abas na navegação.
 */
function aplicarRestricoesDePapel(papel) {
  const ehPlanoPago = usuarioLogadoPlano && usuarioLogadoPlano !== 'gratis' && usuarioLogadoPlano !== 'free';
  const ehPlanoPro  = usuarioLogadoPlano === 'pro' || usuarioLogadoPlano === 'pro_anual';

  const abasPorPapel = {
    // Central e Atividades: exclusivo para donos no plano Pro
    dono:       ['estoque', 'venda', 'historico', ...(ehPlanoPro ? ['central', 'atividades'] : []), 'conta', 'assinatura', 'contato'],
    vendedor:   ['venda', 'conta', 'contato'],
    estoquista: ['estoque', 'conta', 'contato'],
    gerente:    ['estoque', 'venda', 'historico', 'conta', 'contato'],
  };

  const permitidas = papel === null ? [] : (abasPorPapel[papel] || abasPorPapel.dono);

  document.querySelectorAll('[data-tab]').forEach(botao => {
    botao.style.display = permitidas.includes(botao.dataset.tab) ? '' : 'none';
  });

  // Importação de Produtos: dono, estoquista e gerente podem, mas apenas em planos pagos.
  const podeImportar = (papel === 'dono' || papel === 'estoquista' || papel === 'gerente') && ehPlanoPago;
  document.querySelectorAll('[data-acao="importar-produtos"]').forEach(botao => {
    botao.style.display = podeImportar ? '' : 'none';
  });

  // Etiquetas de preço: planos pagos apenas.
  const podeEtiquetas = (papel === 'dono' || papel === 'estoquista' || papel === 'gerente') && ehPlanoPago;
  const btnEtiquetas = document.getElementById('btnSelecionarEtiquetas');
  if (btnEtiquetas) btnEtiquetas.style.display = podeEtiquetas ? '' : 'none';

  // KPI "Vendido no mês" e Exportar: só o dono vê
  const ehFuncionario = papel === 'vendedor' || papel === 'estoquista';
  const statMesWrap = document.getElementById('statMes')?.closest('.stat');
  if (statMesWrap) statMesWrap.style.display = ehFuncionario ? 'none' : '';
  document.getElementById('btnExportar')?.style && (document.getElementById('btnExportar').style.display = ehFuncionario ? 'none' : '');
  document.getElementById('btnExportarSidebar')?.style && (document.getElementById('btnExportarSidebar').style.display = ehFuncionario ? 'none' : '');

  if (!permitidas.includes(abaAtual)) {
    abaAtual = permitidas[0];
    document.querySelectorAll('[data-tab]').forEach(botao => {
      botao.classList.toggle('active', botao.dataset.tab === abaAtual);
    });
  }
}

/**
 * Verdadeiro quando a pessoa logada deveria ver a tela de boas-vindas em
 * tela cheia em vez do estado vazio padrão da aba Estoque: papel que
 * gerencia estoque, catálogo vazio, e ainda não dispensou o guia.
 * A tela em si (telaBoasVindasHtml/renderizarTelaBoasVindas) mora em
 * ui-onboarding-importacao.js.
 */
function deveMostrarBoasVindas() {
  const podeVerEstoque = usuarioLogadoPapel === 'dono' || usuarioLogadoPapel === 'estoquista' || usuarioLogadoPapel === 'gerente';
  return podeVerEstoque
    && abaAtual === 'estoque'
    && produtosCache.length === 0
    && localStorage.getItem('mevBoasVindasDispensada') !== '1';
}

async function iniciar() {
  document.getElementById('dateLabel').textContent = dataDeHoje();

  document.getElementById('main').innerHTML = criarSkeletonMain(6);

  let usuario;
  try {
    usuario = await DB.buscarUsuarioLogado();
  } catch (erro) {
    document.getElementById('main').innerHTML = criarErroMain(erro.message, 'btnRetryInicio');
    document.getElementById('btnRetryInicio')?.addEventListener('click', iniciar);
    return;
  }

  usuarioLogadoEmail = usuario.email || '';
  const sidebarEmail = document.getElementById('sidebarEmail');
  if (sidebarEmail) sidebarEmail.textContent = usuarioLogadoEmail;

  if (!usuario.empresaId) {
    mostrarTelaCriarEmpresa();
    return;
  }

  usuarioLogadoPapel = usuario.papel || 'dono';
  usuarioLogadoPlano = usuario.plano || 'gratis';
  usuarioLogadoNomeEmpresa = usuario.nomeEmpresa || '';
  usuarioLogadoNomeDono = usuario.nomeDono || '';
  if (sidebarEmail) {
    sidebarEmail.textContent = usuarioLogadoNomeEmpresa || usuarioLogadoEmail;
  }
  aplicarRestricoesDePapel(usuarioLogadoPapel);

  try {
    await recarregarDados();
  } catch (erro) {
    document.getElementById('main').innerHTML = criarErroMain(erro.message, 'btnRetryDados');
    document.getElementById('btnRetryDados')?.addEventListener('click', iniciar);
    return;
  }

  renderizarTudo();

  if (deveMostrarBoasVindas()) {
    renderizarTelaBoasVindas();
  } else if (produtosCache.length > 0) {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const ultimoDiaComInsights = localStorage.getItem(CHAVE_INSIGHTS_ULTIMO_DIA);
    if (ultimoDiaComInsights !== hojeStr) {
      abrirTelaInsights();
    }
  }
  if (typeof atualizarChecklistPrimeirosPassos === 'function') atualizarChecklistPrimeirosPassos();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Service worker não registrado:', err);
    });
  }
}

/**
 * Tela mostrada quando o e-mail logado ainda não pertence a nenhuma empresa.
 */
function mostrarTelaCriarEmpresa() {
  document.querySelectorAll('[data-tab]').forEach(botao => { botao.style.display = 'none'; });
  const toolbarEstoque = document.getElementById('toolbarEstoque');
  const toolbarVenda = document.getElementById('toolbarVenda');
  if (toolbarEstoque) toolbarEstoque.style.display = 'none';
  if (toolbarVenda) toolbarVenda.style.display = 'none';

  document.getElementById('main').innerHTML = `
    <div class="page">
      <h2>🏁 Criar sua empresa</h2>
      <p class="hint-unidade" style="margin:-6px 0 18px;">
        Esse e-mail ainda não está associado a nenhuma empresa. Crie a sua pra
        começar — você vira o "dono" e depois pode convidar sua equipe.
      </p>

      <div class="field">
        <label for="fNomeEmpresa">Nome da empresa</label>
        <input id="fNomeEmpresa" type="text" placeholder="Ex: Mercado da Esquina">
      </div>

      <p class="erro" id="erroCriarEmpresa" style="display:none;"></p>
      <button type="button" class="btn primary" id="btnCriarEmpresa" style="width:100%;">Criar empresa</button>
    </div>
  `;

  document.getElementById('btnCriarEmpresa').addEventListener('click', criarEmpresaEContinuar);
  setTimeout(() => {
    const campo = document.getElementById('fNomeEmpresa');
    if (campo) campo.focus();
  }, 50);
}

async function criarEmpresaEContinuar() {
  const btn = document.getElementById('btnCriarEmpresa');
  if (!btn || btn.disabled) return;

  const erro = document.getElementById('erroCriarEmpresa');
  erro.style.display = 'none';

  const campoNome = document.getElementById('fNomeEmpresa');
  const nomeEmpresa = campoNome.value.trim();
  if (!nomeEmpresa) {
    erro.textContent = 'Informe o nome da empresa.';
    erro.style.display = 'block';
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Criando…';

  try {
    await DB.criarEmpresa(nomeEmpresa);
    await iniciar();
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível criar a empresa. Tente novamente.';
    erro.style.display = 'block';
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

aplicarRestricoesDePapel(null);
iniciar().then(() => {
  const hash = window.location.hash;
  if (hash.startsWith('#checkout=')) {
    const planoId = hash.replace('#checkout=', '');
    history.replaceState(null, '', window.location.pathname);
    requestAnimationFrame(() => {
      if (typeof abrirModalCheckoutMP === 'function' && planoId) {
        abrirModalCheckoutMP(planoId, async () => {
          await recarregarDados();
          renderizarTudo();
        });
      }
    });
  }
});