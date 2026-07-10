/**
 * app.js
 * Ponto de entrada do app: restrição de abas por papel do usuário e boot
 * (iniciar/criarEmpresaEContinuar). Todo o resto da interface foi dividido
 * em módulos ui-*.js, carregados antes deste — veja index.html pra ordem.
 */

// --- Inicialização ---

// Injeta o botão da aba "Clientes" na barra de navegação, clonando um botão
// [data-tab] existente pra herdar exatamente o mesmo markup/estilo (o HTML
// estático do projeto não faz parte deste arquivo, então a aba nova precisa
// nascer aqui em vez de em index.html).
// Aba Clientes removida da navegação principal.
// Clientes agora são gerenciados diretamente no modal de venda
// (campo "Informações do cliente" expansível).

document.querySelectorAll('[data-tab]').forEach(botao => {
  botao.addEventListener('click', () => {
    if (modoSelecaoEtiquetas && botao.dataset.tab !== 'estoque') cancelarSelecaoEtiquetas();
    abaAtual = botao.dataset.tab;
    renderizarTudo();
    // T4: auto-foca o campo de busca ao mudar de aba
    requestAnimationFrame(() => {
      if (abaAtual === 'estoque') document.getElementById('campoBusca')?.focus();
      if (abaAtual === 'venda')   document.getElementById('campoBuscaVenda')?.focus();
    });
  });
});

document.getElementById('btnAddProduct').addEventListener('click', () => {
  const podeVerEstoque = usuarioLogadoPapel === 'dono' || usuarioLogadoPapel === 'estoquista';
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
// Para o scanner (que tem lógica de parar câmera), procura o botão de fechar.
// Para os demais modais, simula um clique no fundo escuro (mesma lógica do
// "clique fora pra fechar" que cada modal já possui).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Scanner tem cleanup de câmera — delega pro botão de cancelar
  const btnScanner = document.getElementById('btnFecharScanner');
  if (btnScanner) { btnScanner.click(); return; }
  // Demais modais: aciona o handler de click-fora já existente em cada wrap
  const modais = document.querySelectorAll('.modal-wrap');
  if (!modais.length) return;
  modais[modais.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: false }));
});

/**
 * Esconde as abas que o papel da pessoa logada não deveria ver:
 * vendedor só mexe em Venda, estoquista só mexe em Estoque, dono vê tudo.
 * Conta e Contato ficam liberados pra todo mundo.
 * Recursos pagos (aba Atividades e importação de produtos) ficam ocultos
 * para usuários no plano gratuito.
 */
function aplicarRestricoesDePapel(papel) {
  const ehPlanoPago = usuarioLogadoPlano && usuarioLogadoPlano !== 'gratis' && usuarioLogadoPlano !== 'free';

  const abasPorPapel = {
    // Aba Atividades só aparece para donos em planos pagos
    dono: ['estoque', 'venda', 'historico', ...(ehPlanoPago ? ['central', 'atividades'] : []), 'conta', 'assinatura', 'contato'],
    vendedor: ['venda', 'conta', 'contato'],
    estoquista: ['estoque', 'conta', 'contato']
  };
  // null = ainda carregando: esconde todas as abas até o papel real chegar.
  // Evita que vendedores/estoquistas vejam brevemente abas de dono durante o
  // tempo entre o carregamento do JS e a resposta de /api/me.
  const permitidas = papel === null ? [] : (abasPorPapel[papel] || abasPorPapel.dono);

  document.querySelectorAll('[data-tab]').forEach(botao => {
    botao.style.display = permitidas.includes(botao.dataset.tab) ? '' : 'none';
  });

  // Importação de Produtos: dono e estoquista podem pelo papel,
  // mas apenas em planos pagos (recurso premium).
  const podeImportar = (papel === 'dono' || papel === 'estoquista') && ehPlanoPago;
  document.querySelectorAll('[data-acao="importar-produtos"]').forEach(botao => {
    botao.style.display = podeImportar ? '' : 'none';
  });

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

async function iniciar() {
  document.getElementById('dateLabel').textContent = dataDeHoje();

  // Evita a tela em branco enquanto os primeiros fetches ao D1 respondem
  // (o app só passa a renderizar dados quando eles realmente chegaram).
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

  // E-mail autenticado mas ainda sem empresa nenhuma: mostra a tela de
  // cadastro self-service em vez de tentar carregar estoque/vendas.
  if (!usuario.empresaId) {
    mostrarTelaCriarEmpresa();
    return;
  }

  usuarioLogadoPapel = usuario.papel || 'dono';
  usuarioLogadoPlano = usuario.plano || 'gratis';
  usuarioLogadoNomeEmpresa = usuario.nomeEmpresa || '';
  usuarioLogadoNomeDono = usuario.nomeDono || '';
  aplicarRestricoesDePapel(usuarioLogadoPapel);

  try {
    await recarregarDados();
  } catch (erro) {
    document.getElementById('main').innerHTML = criarErroMain(erro.message, 'btnRetryDados');
    document.getElementById('btnRetryDados')?.addEventListener('click', iniciar);
    return;
  }

  renderizarTudo();

  if (produtosCache.length > 0) {
    const hojeStr = new Date().toISOString().slice(0, 10);
    const ultimoDiaComInsights = localStorage.getItem(CHAVE_INSIGHTS_ULTIMO_DIA);
    if (ultimoDiaComInsights !== hojeStr) {
      abrirTelaInsights();
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Service worker não registrado:', err);
    });
  }
}

/**
 * Tela mostrada quando o e-mail logado ainda não pertence a nenhuma
 * empresa. Some com as abas e barras de ferramentas (não fazem sentido
 * ainda) e deixa só o formulário de cadastro.
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
    await iniciar(); // agora a empresa existe — recarrega tudo do zero
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível criar a empresa. Tente novamente.';
    erro.style.display = 'block';
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// Esconde todas as abas imediatamente (papel ainda é null).
// Evita flash de conteúdo de "dono" para vendedores/estoquistas
// durante o carregamento inicial — as abas corretas aparecem após
// aplicarRestricoesDePapel() ser chamado dentro de iniciar().
aplicarRestricoesDePapel(null);
iniciar();