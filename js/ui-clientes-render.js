/**
 * ui-clientes-render.js
 * Aba Clientes, atalho pra Central de Dados e a renderização geral (router de abas + carrinho).
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-clientes-render.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

// --- Aba Clientes ---

function telaClientesHtml() {
  return `
    <div class="page">
      <div class="filtros">
        <input type="text" id="campoBuscaCliente" class="campo-busca" placeholder="Buscar cliente..."
          value="${escaparHtml(buscaCliente)}" oninput="aplicarFiltroCliente()">
      </div>
      <button type="button" class="btn primary" id="btnNovoCliente" style="width:auto;padding:9px 16px;margin-bottom:14px;">+ Novo Cliente</button>
      <div id="listaClientes"></div>
    </div>`;
}

function telaVaziaClientes() {
  return `<div class="empty">
    <p class="titulo">Nenhum cliente cadastrado</p>
    <p class="hint">Toque em "Novo Cliente" para cadastrar o primeiro.</p>
  </div>`;
}

let _timerFiltroCliente = null;
function aplicarFiltroCliente() {
  const campo = document.getElementById('campoBuscaCliente');
  buscaCliente = campo ? campo.value : '';
  clearTimeout(_timerFiltroCliente);
  _timerFiltroCliente = setTimeout(atualizarListaClientes, 200);
}

function atualizarListaClientes() {
  const container = document.getElementById('listaClientes');
  if (!container) return;
  const termo = buscaCliente.trim().toLowerCase();
  const filtrados = termo
    ? clientesCache.filter(c => (c.nome || '').toLowerCase().includes(termo))
    : clientesCache;

  if (filtrados.length === 0) {
    container.innerHTML = clientesCache.length === 0 ? telaVaziaClientes() : '<div class="sem-resultado">Nenhum cliente encontrado com esse filtro.</div>';
  } else {
    container.innerHTML = filtrados
      .slice()
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
      .map(cartaoCliente)
      .join('');
  }
}

/** Card de listagem da aba Clientes — toque para editar. */
function cartaoCliente(cliente) {
  const contato = [cliente.telefone, cliente.email].filter(Boolean).join(' · ');
  return `
    <div class="product-card" onclick="abrirEdicaoCliente('${escaparHtml(cliente.id)}')">
      <div class="info">
        <div class="name">${escaparHtml(cliente.nome)}</div>
        ${contato ? `<div class="meta"><span class="price">${escaparHtml(contato)}</span></div>` : ''}
      </div>
    </div>`;
}

function abrirEdicaoCliente(id) {
  const cliente = clientesCache.find(c => c.id === id);
  if (cliente) abrirModalCliente(cliente);
}

function abrirModalCliente(cliente) {
  idClienteEmEdicao = cliente ? cliente.id : null;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'clienteModalWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>${cliente ? 'Editar cliente' : 'Novo Cliente'}</h2>

      <div class="field">
        <label for="fClienteNome">Nome</label>
        <input id="fClienteNome" type="text" placeholder="Ex: Dona Maria" value="${cliente ? escaparHtml(cliente.nome || '') : ''}">
      </div>
      <div class="row2">
        <div class="field">
          <label for="fClienteTelefone">Telefone</label>
          <input id="fClienteTelefone" type="text" inputmode="tel" placeholder="(00) 00000-0000" value="${cliente ? escaparHtml(cliente.telefone || '') : ''}">
        </div>
        <div class="field">
          <label for="fClienteEmail">E-mail</label>
          <input id="fClienteEmail" type="email" placeholder="cliente@email.com" value="${cliente ? escaparHtml(cliente.email || '') : ''}">
        </div>
      </div>
      <div class="field">
        <label for="fClienteCpf">CPF</label>
        <input id="fClienteCpf" type="text" inputmode="numeric" placeholder="000.000.000-00" value="${cliente ? escaparHtml(cliente.cpf || '') : ''}">
      </div>
      <div class="field">
        <label for="fClienteEndereco">Endereço</label>
        <input id="fClienteEndereco" type="text" placeholder="Rua, número, bairro" value="${cliente ? escaparHtml(cliente.endereco || '') : ''}">
      </div>
      <div class="field">
        <label for="fClienteObservacoes">Observações</label>
        <textarea id="fClienteObservacoes" rows="3" placeholder="Anotações internas">${cliente ? escaparHtml(cliente.observacoes || '') : ''}</textarea>
      </div>

      <p class="erro" id="erroCliente" style="display:none;"></p>
      <div class="modal-actions">
        ${cliente ? `<button type="button" class="btn danger" id="btnExcluirCliente" style="width:auto;padding:9px 16px;">Excluir</button>` : ''}
        <button type="button" class="btn ghost" id="btnCancelarCliente">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarCliente">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModalCliente(); });
  document.getElementById('btnCancelarCliente').addEventListener('click', fecharModalCliente);
  document.getElementById('btnSalvarCliente').addEventListener('click', salvarFormularioCliente);
  const btnExcluir = document.getElementById('btnExcluirCliente');
  if (btnExcluir) btnExcluir.addEventListener('click', () => excluirClienteComConfirmacao(cliente.id));
}

function fecharModalCliente() {
  const el = document.getElementById('clienteModalWrap');
  if (el) el.remove();
  idClienteEmEdicao = null;
}

async function salvarFormularioCliente() {
  const btnSalvar = document.getElementById('btnSalvarCliente');
  const erroEl = document.getElementById('erroCliente');
  if (btnSalvar.disabled) return; // já está salvando — ignora cliques repetidos

  const nome = document.getElementById('fClienteNome').value.trim();
  if (!nome) {
    if (erroEl) {
      erroEl.textContent = 'Informe o nome do cliente.';
      erroEl.style.display = '';
    }
    return;
  }
  if (erroEl) erroEl.style.display = 'none';

  const dados = {
    nome,
    telefone: document.getElementById('fClienteTelefone').value.trim(),
    email: document.getElementById('fClienteEmail').value.trim(),
    cpf: document.getElementById('fClienteCpf').value.trim(),
    endereco: document.getElementById('fClienteEndereco').value.trim(),
    observacoes: document.getElementById('fClienteObservacoes').value.trim()
  };

  btnSalvar.disabled = true;
  const textoOriginal = btnSalvar.textContent;
  btnSalvar.textContent = 'Salvando…';

  try {
    if (idClienteEmEdicao) {
      await DB.editarCliente(idClienteEmEdicao, dados);
    } else {
      await DB.salvarCliente(dados);
    }
    clientesCache = await DB.listarClientes();
    fecharModalCliente();
    renderizarConteudo();
    mostrarToast('Cliente salvo com sucesso.', 'sucesso');
  } catch (erro) {
    if (erroEl) {
      erroEl.textContent = erro.message || 'Não foi possível salvar. Verifique sua conexão e tente novamente.';
      erroEl.style.display = '';
    } else {
      mostrarToast(erro.message || 'Não foi possível salvar o cliente.', 'erro');
    }
    btnSalvar.disabled = false;
    btnSalvar.textContent = textoOriginal;
  }
}

async function excluirClienteComConfirmacao(id) {
  if (!await mostrarConfirm('Excluir este cliente?', { confirmText: 'Excluir', cancelText: 'Cancelar', tipo: 'perigo' })) return;
  try {
    await DB.excluirCliente(id);
    clientesCache = await DB.listarClientes();
    fecharModalCliente();
    renderizarConteudo();
    mostrarToast('Cliente excluído.', 'sucesso');
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível excluir o cliente.', 'erro');
  }
}

// --- Central de Dados ---

async function carregarCentralDados() {
  const main = document.getElementById('main');
  if (!assinaturaCache) {
    try { assinaturaCache = await DB.buscarAssinatura(); } catch (e) { assinaturaCache = null; }
  }
  main.innerHTML = await CentralDados.renderizar(produtosCache, vendasCache, assinaturaCache);
  CentralDados.inicializar(produtosCache, vendasCache, carregarCentralDados);
}

// --- Render geral ---

function renderizarConteudo() {
  const main = document.getElementById('main');

  if (abaAtual === 'estoque') {
    main.innerHTML = barraFiltrosEstoque();
    atualizarListaProdutos();
  }

else if (abaAtual === 'venda') {
  const categoriasVenda = Produtos.listarCategorias(produtosCache);
  main.innerHTML = `
    <div class="page-venda">
      <div class="venda-topbar">
        <input 
          id="campoBuscaVenda"
          type="text"
          placeholder="Buscar produto..."
          oninput="aplicarFiltroVenda()"
          class="campo-busca"
          value="${escaparHtml(buscaVenda)}"
        />
        ${categoriasVenda.length > 0 ? `
        <select id="seletorCategoriaVenda" class="filtro-select" onchange="aplicarFiltroVenda()">
          <option value="">Todas as categorias</option>
          ${categoriasVenda.map(c => `<option value="${escaparHtml(c)}" ${c === categoriaVenda ? 'selected' : ''}>${escaparHtml(c)}</option>`).join('')}
        </select>` : ''}
      </div>

      <div id="listaVenda"></div>
    </div>
  `;

  atualizarListaVenda();
}

  else if (abaAtual === 'historico') {
    main.innerHTML = barraFiltrosVendas();
    atualizarListaVendas();
  }

  else if (abaAtual === 'central') {
    carregarCentralDados();
  }

  else if (abaAtual === 'clientes') {
    main.innerHTML = telaClientesHtml();
    atualizarListaClientes();
    document.getElementById('btnNovoCliente').addEventListener('click', () => abrirModalCliente(null));
  }

  else if (abaAtual === 'conta') {
    main.innerHTML = `
      <div class="page">
        <h2>👤 Minha Conta</h2>

        <div class="card-info">
          <p><strong>Empresa:</strong> ${escaparHtml(usuarioLogadoNomeEmpresa || 'Não configurado')}</p>
          <p><strong>Dono:</strong> ${escaparHtml(usuarioLogadoNomeDono || 'Não configurado')}</p>
          <p><strong>Logado como:</strong> ${escaparHtml(usuarioLogadoEmail || 'Carregando…')}</p>
          <button type="button" class="btn danger" id="btnLogout" style="width:auto;padding:9px 16px;margin-top:10px;">Sair da conta</button>
        </div>

        ${usuarioLogadoPapel === 'dono' ? `
        <div class="card-info">
          <h3>Nome da empresa</h3>
          <div class="field">
            <input type="text" id="inputNomeEmpresaConta" class="filtro-select" value="${escaparHtml(usuarioLogadoNomeEmpresa || '')}">
          </div>
          <p class="erro" id="erroNomeEmpresaConta" style="display:none;"></p>
          <button type="button" class="btn primary" id="btnSalvarNomeEmpresaConta" style="width:auto;padding:9px 16px;margin-top:10px;">Salvar</button>
        </div>` : ''}

        <div class="card-info">
          <p><strong>Produtos cadastrados:</strong> ${produtosCache.length}</p>
          <p><strong>Vendas registradas:</strong> ${vendasCache.length}</p>
          <p><strong>Status:</strong> Sistema ativo</p>
        </div>

        <div class="card-info">
          <h3>Resumo rápido</h3>
          <p>Total em vendas hoje: ${formatarMoeda(Vendas.calcularVendasDoDia(vendasCache))}</p>
          ${usuarioLogadoPapel === 'dono' ? `<p>Total no mês: ${formatarMoeda(Vendas.calcularVendasDoMes(vendasCache))}</p>` : ''}
        </div>

        ${usuarioLogadoPapel === 'dono' && produtosCache.length === 0 ? `
        <div class="card-info">
          <h3>Dados de demonstração</h3>
          <p>Quer ver o sistema funcionando com produtos de exemplo? Isso não apaga nada do que você já cadastrou.</p>
          <button type="button" class="btn ghost" id="btnCarregarExemploConta" style="width:auto;padding:9px 16px;margin-top:10px;">Carregar exemplo</button>
        </div>` : ''}

        ${usuarioLogadoPapel === 'dono' ? cartaoGestaoEquipeHtml() : ''}
      </div>
    `;
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', fazerLogout);

    const btnSalvarNomeEmpresaConta = document.getElementById('btnSalvarNomeEmpresaConta');
    if (btnSalvarNomeEmpresaConta) {
      btnSalvarNomeEmpresaConta.addEventListener('click', () => salvarNomeEmpresaConta(btnSalvarNomeEmpresaConta));
    }

    const btnCarregarExemploConta = document.getElementById('btnCarregarExemploConta');
    if (btnCarregarExemploConta) {
      btnCarregarExemploConta.addEventListener('click', () => carregarDadosExemplo(btnCarregarExemploConta));
    }

    if (usuarioLogadoPapel === 'dono') {
      inicializarGestaoEquipe();
    }
  }

  else if (abaAtual === 'atividades') {
    main.innerHTML = telaAtividadesHtml();
    carregarTelaAtividades();
  }

  else if (abaAtual === 'assinatura') {
    main.innerHTML = `
      <div class="page">
        <h2>💳 Minha assinatura</h2>
        <div id="assinaturaContainer"><p class="team-msg">Carregando…</p></div>
      </div>
    `;
    carregarTelaAssinatura();
  }

  else if (abaAtual === 'contato') {
    main.innerHTML = `
      <div class="page">
        <h2>📞 Contato e Suporte</h2>

        <div class="card-info">
          <p>Suporte do sistema</p>
          <p><strong>Email:</strong> mevmeuestoqueevendas@gmail.com</p>
          <p><strong>WhatsApp:</strong> (51) 99445-9862</p>
        </div>

        <div class="card-info">
          <h3>Ajuda rápida</h3>
          <p>• Adicionar produtos → botão “Adicionar produto”</p>
          <p>• Fazer vendas → aba “Venda”</p>
          <p>• Exportar dados → botão Exportar</p>
        </div>
      </div>
    `;
  }
}

function renderizarCarrinho() {
  const ids = Object.keys(carrinho);
  // Conta produtos distintos, não a soma das quantidades — somar "2 un + 0,5 kg"
  // resultaria em "2,5 itens", o que não faz sentido nenhum para o usuário.
  const totalProdutos = ids.length;
  const totalValor = ids.reduce((soma, id) => {
    const produto = produtosCache.find(p => p.id === id);
    return soma + (produto ? produto.preco * carrinho[id] : 0);
  }, 0);

  const barra = document.getElementById('cartbar');
  if (totalProdutos > 0) {
    barra.style.display = 'flex';
    document.getElementById('cartCount').textContent =
      totalProdutos === 1 ? '1 item no carrinho' : `${totalProdutos} itens no carrinho`;
    document.getElementById('cartTotal').textContent = formatarMoeda(totalValor);
  } else {
    barra.style.display = 'none';
  }
}

function renderizarTudo() {
  renderizarEstatisticas();
  renderizarAbas();
  renderizarConteudo();
  renderizarCarrinho();
}

function alterarCarrinho(produtoId, delta) {
  const produto = produtosCache.find(p => p.id === produtoId);
  if (!produto) return;

  const atual = carrinho[produtoId] || 0;
  const novo = atual + delta;

  if (novo <= 0) {
    delete carrinho[produtoId];
  } else if (novo > produto.estoque) {
    return;
  } else {
    carrinho[produtoId] = novo;
  }

  atualizarListaVenda();
  renderizarCarrinho();
}

/** Primeiro toque em "Vender" de um produto por peso: começa com 100g, o vendedor ajusta o peso exato em seguida. */
function venderPeso(produtoId) {
  const produto = produtosCache.find(p => p.id === produtoId);
  if (!produto || produto.estoque <= 0) return;
  carrinho[produtoId] = Math.min(0.1, produto.estoque);
  atualizarListaVenda();
  renderizarCarrinho();
}

/** Define o peso exato digitado pelo vendedor (ex: valor lido na balança). */
function definirQuantidadeCarrinho(produtoId, valorDigitado) {
  const produto = produtosCache.find(p => p.id === produtoId);
  if (!produto) return;

  const bruto = String(valorDigitado).trim();
  if (bruto === '') {
    // Campo ficou vazio no meio da edição (ex: usuário apagou tudo antes de
    // digitar o novo valor) — mantém a quantidade anterior em vez de
    // esvaziar o carrinho sem o usuário perceber.
    atualizarListaVenda();
    return;
  }

  const novaQtd = parseFloat(bruto.replace(',', '.'));
  if (isNaN(novaQtd)) {
    atualizarListaVenda();
    return;
  }
  if (novaQtd <= 0) {
    delete carrinho[produtoId];
  } else {
    carrinho[produtoId] = Math.min(novaQtd, produto.estoque);
  }
  atualizarListaVenda();
  renderizarCarrinho();
}

function removerDoCarrinho(produtoId) {
  delete carrinho[produtoId];
  atualizarListaVenda();
  renderizarCarrinho();
}

