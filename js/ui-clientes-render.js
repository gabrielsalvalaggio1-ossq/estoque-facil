/**
 * ui-clientes-render.js  (T9 — versão melhorada)
 * Aba Clientes com:
 *   1. Histórico completo de compras por cliente
 *   2. Ticket médio
 *   3. Frequência de compra (dias médios entre visitas)
 *   4. Produtos favoritos (top 3)
 *   5. Ranking por total gasto / frequência / última visita
 *   6. Campo Observações (já salvo no D1 via DB.editarCliente)
 *   7. Badge de fiado pendente com valor total
 *
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

// ---------------------------------------------------------------------------
// Helpers de análise — operam sobre vendasCache (array global de vendas)
// ---------------------------------------------------------------------------

/**
 * Retorna todas as vendas associadas a um clienteId.
 * Considera tanto venda.clienteId quanto venda.cliente (nome) para compatibilidade
 * com vendas antigas que só guardavam o nome.
 */
function vendasDoCliente(clienteId, nomeCliente) {
  return (vendasCache || []).filter(v => {
    if (v.status === 'cancelada') return false;
    if (v.clienteId && v.clienteId === clienteId) return true;
    // fallback por nome (vendas sem clienteId)
    if (!v.clienteId && nomeCliente && (v.cliente || '').toLowerCase() === nomeCliente.toLowerCase()) return true;
    return false;
  });
}

/** Valor total gasto pelo cliente (soma de todas as vendas não canceladas). */
function totalGastoCliente(clienteId, nomeCliente) {
  return vendasDoCliente(clienteId, nomeCliente).reduce((s, v) => s + (v.total || 0), 0);
}

/** Total de fiado pendente (status 'fiado' sem quitação). */
function fiadoPendenteCliente(clienteId, nomeCliente) {
  return vendasDoCliente(clienteId, nomeCliente)
    .filter(v => v.formaPagamento === 'fiado' && !v.fiadoQuitado)
    .reduce((s, v) => s + (v.total || 0), 0);
}

/** Ticket médio: total / número de compras. Retorna 0 se não há compras. */
function ticketMedioCliente(clienteId, nomeCliente) {
  const vendas = vendasDoCliente(clienteId, nomeCliente);
  if (vendas.length === 0) return 0;
  return totalGastoCliente(clienteId, nomeCliente) / vendas.length;
}

/** Data da última compra (objeto Date ou null). */
function ultimaCompraCliente(clienteId, nomeCliente) {
  const vendas = vendasDoCliente(clienteId, nomeCliente);
  if (vendas.length === 0) return null;
  const datas = vendas.map(v => new Date(v.criadoEm || v.data || 0));
  return new Date(Math.max(...datas));
}

/**
 * Frequência média em dias entre visitas.
 * Com 1 visita não há intervalo → retorna null.
 * Com 2+ visitas retorna a média dos intervalos.
 */
function frequenciaMediaDias(clienteId, nomeCliente) {
  const vendas = vendasDoCliente(clienteId, nomeCliente);
  if (vendas.length < 2) return null;
  const datas = vendas
    .map(v => new Date(v.criadoEm || v.data || 0))
    .sort((a, b) => a - b);
  let somaIntervalos = 0;
  for (let i = 1; i < datas.length; i++) {
    somaIntervalos += (datas[i] - datas[i - 1]) / (1000 * 60 * 60 * 24);
  }
  return somaIntervalos / (datas.length - 1);
}

/**
 * Top N produtos mais comprados (por quantidade de itens na linha, não de
 * vendas). Retorna array de { nome, qtd } em ordem decrescente.
 */
function topProdutosCliente(clienteId, nomeCliente, n = 3) {
  const contagem = {};
  vendasDoCliente(clienteId, nomeCliente).forEach(v => {
    (v.itens || []).forEach(item => {
      const nome = item.nome || item.produto || '?';
      contagem[nome] = (contagem[nome] || 0) + (item.quantidade || 1);
    });
  });
  return Object.entries(contagem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([nome, qtd]) => ({ nome, qtd }));
}

// ---------------------------------------------------------------------------
// Estado local da aba Clientes
// ---------------------------------------------------------------------------

let ordenacaoClientes = 'nome'; // 'nome' | 'totalGasto' | 'frequencia' | 'ultimaVisita'

// ---------------------------------------------------------------------------
// Tela principal: cabeçalho + filtros + lista
// ---------------------------------------------------------------------------

function telaClientesHtml() {
  return `
    <div class="page">
      <div class="clientes-toolbar">
        <input
          type="text"
          id="campoBuscaCliente"
          class="campo-busca"
          placeholder="Buscar cliente…"
          value="${escaparHtml(buscaCliente)}"
          oninput="aplicarFiltroCliente()"
        >
        <select id="seletorOrdemClientes" class="filtro-select" onchange="mudarOrdemClientes(this.value)">
          <option value="nome"         ${ordenacaoClientes === 'nome'         ? 'selected' : ''}>A–Z</option>
          <option value="totalGasto"   ${ordenacaoClientes === 'totalGasto'   ? 'selected' : ''}>Maior gasto</option>
          <option value="frequencia"   ${ordenacaoClientes === 'frequencia'   ? 'selected' : ''}>Mais frequente</option>
          <option value="ultimaVisita" ${ordenacaoClientes === 'ultimaVisita' ? 'selected' : ''}>Última visita</option>
        </select>
      </div>
      <button type="button" class="btn primary" id="btnNovoCliente"
        style="width:auto;padding:9px 16px;margin-bottom:4px;">
        + Novo Cliente
      </button>
      <div id="listaClientes"></div>
    </div>`;
}

function telaVaziaClientes() {
  return `<div class="empty">
    <p class="titulo">Nenhum cliente cadastrado</p>
    <p class="hint">Toque em "Novo Cliente" para cadastrar o primeiro.</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Filtro + ordenação
// ---------------------------------------------------------------------------

let _timerFiltroCliente = null;

function aplicarFiltroCliente() {
  const campo = document.getElementById('campoBuscaCliente');
  buscaCliente = campo ? campo.value : '';
  clearTimeout(_timerFiltroCliente);
  _timerFiltroCliente = setTimeout(atualizarListaClientes, 200);
}

function mudarOrdemClientes(valor) {
  ordenacaoClientes = valor;
  atualizarListaClientes();
}

function ordenarClientes(lista) {
  return lista.slice().sort((a, b) => {
    switch (ordenacaoClientes) {
      case 'totalGasto': {
        const diff = totalGastoCliente(b.id, b.nome) - totalGastoCliente(a.id, a.nome);
        return diff !== 0 ? diff : (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
      }
      case 'frequencia': {
        // Mais compras primeiro; quem nunca comprou fica no fim
        const fa = vendasDoCliente(a.id, a.nome).length;
        const fb = vendasDoCliente(b.id, b.nome).length;
        const diff = fb - fa;
        return diff !== 0 ? diff : (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
      }
      case 'ultimaVisita': {
        const da = ultimaCompraCliente(a.id, a.nome);
        const db2 = ultimaCompraCliente(b.id, b.nome);
        if (!da && !db2) return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
        if (!da) return 1;
        if (!db2) return -1;
        return db2 - da;
      }
      default:
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    }
  });
}

function atualizarListaClientes() {
  const container = document.getElementById('listaClientes');
  if (!container) return;

  const termo = buscaCliente.trim().toLowerCase();
  const filtrados = termo
    ? clientesCache.filter(c => (c.nome || '').toLowerCase().includes(termo)
        || (c.telefone || '').includes(termo)
        || (c.email || '').toLowerCase().includes(termo))
    : clientesCache;

  if (filtrados.length === 0) {
    container.innerHTML = clientesCache.length === 0
      ? telaVaziaClientes()
      : '<div class="sem-resultado">Nenhum cliente encontrado com esse filtro.</div>';
    return;
  }

  container.innerHTML = ordenarClientes(filtrados).map(cartaoCliente).join('');
}

// ---------------------------------------------------------------------------
// Card de listagem
// ---------------------------------------------------------------------------

function cartaoCliente(cliente) {
  const contato = [cliente.telefone, cliente.email].filter(Boolean).join(' · ');
  const fiado = fiadoPendenteCliente(cliente.id, cliente.nome);
  const total = totalGastoCliente(cliente.id, cliente.nome);
  const nVendas = vendasDoCliente(cliente.id, cliente.nome).length;
  const ultima = ultimaCompraCliente(cliente.id, cliente.nome);

  const badgeFiado = fiado > 0
    ? `<span class="cliente-badge-fiado">Fiado ${formatarMoeda(fiado)}</span>`
    : '';

  const metaInfo = nVendas > 0
    ? `<span>${nVendas} compra${nVendas !== 1 ? 's' : ''} · ${formatarMoeda(total)}</span>`
    : `<span class="sem-compras">Sem compras</span>`;

  const ultimaInfo = ultima
    ? `<span>Última: ${ultima.toLocaleDateString('pt-BR')}</span>`
    : '';

  return `
    <div class="product-card cliente-card ${fiado > 0 ? 'fiado-pendente' : ''}"
         onclick="abrirEdicaoCliente('${escaparHtml(cliente.id)}')">
      <div class="cliente-avatar">${(cliente.nome || '?')[0].toUpperCase()}</div>
      <div class="info">
        <div class="name">
          ${escaparHtml(cliente.nome)}
          ${badgeFiado}
        </div>
        ${contato ? `<div class="meta"><span class="price">${escaparHtml(contato)}</span></div>` : ''}
        <div class="meta cliente-meta-stats">
          ${metaInfo}
          ${ultimaInfo}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Abrir modal a partir da lista
// ---------------------------------------------------------------------------

function abrirEdicaoCliente(id) {
  const cliente = clientesCache.find(c => c.id === id);
  if (cliente) abrirModalCliente(cliente);
}

// ---------------------------------------------------------------------------
// Modal de cliente (formulário + histórico + estatísticas)
// ---------------------------------------------------------------------------

function abrirModalCliente(cliente) {
  idClienteEmEdicao = cliente ? cliente.id : null;

  const vendas = cliente ? vendasDoCliente(cliente.id, cliente.nome) : [];
  const fiado = cliente ? fiadoPendenteCliente(cliente.id, cliente.nome) : 0;
  const ticket = cliente ? ticketMedioCliente(cliente.id, cliente.nome) : 0;
  const freq = cliente ? frequenciaMediaDias(cliente.id, cliente.nome) : null;
  const tops = cliente ? topProdutosCliente(cliente.id, cliente.nome, 3) : [];

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'clienteModalWrap';

  // --- Seção de estatísticas (só aparece quando tem compras) ---
  const secaoStats = (cliente && vendas.length > 0) ? `
    <div class="cliente-stats-grid">
      <div class="cliente-stat">
        <span class="cliente-stat-lbl">Compras</span>
        <span class="cliente-stat-val">${vendas.length}</span>
      </div>
      <div class="cliente-stat">
        <span class="cliente-stat-lbl">Total gasto</span>
        <span class="cliente-stat-val">${formatarMoeda(vendas.reduce((s, v) => s + (v.total || 0), 0))}</span>
      </div>
      <div class="cliente-stat">
        <span class="cliente-stat-lbl">Ticket médio</span>
        <span class="cliente-stat-val">${formatarMoeda(ticket)}</span>
      </div>
      <div class="cliente-stat ${fiado > 0 ? 'stat-fiado' : ''}">
        <span class="cliente-stat-lbl">Fiado pendente</span>
        <span class="cliente-stat-val">${fiado > 0 ? formatarMoeda(fiado) : '—'}</span>
      </div>
    </div>
    ${freq !== null ? `
    <p class="cliente-freq-hint">
      ⏱ Retorna a cada <strong>${Math.round(freq)} dias</strong> em média.
    </p>` : ''}
    ${tops.length > 0 ? `
    <div class="cliente-tops">
      <p class="cliente-section-label">Produtos favoritos</p>
      <div class="cliente-tops-lista">
        ${tops.map((p, i) => `
          <div class="cliente-top-item">
            <span class="cliente-top-rank">#${i + 1}</span>
            <span class="cliente-top-nome">${escaparHtml(p.nome)}</span>
            <span class="cliente-top-qtd">${p.qtd % 1 === 0 ? p.qtd : p.qtd.toFixed(2)}×</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
  ` : '';

  // --- Histórico de compras ---
  const secaoHistorico = (cliente && vendas.length > 0) ? `
    <div class="cliente-historico">
      <p class="cliente-section-label">Histórico de compras</p>
      ${ordenarVendasDesc(vendas).map(v => {
        const data = new Date(v.criadoEm || v.data || 0);
        const dataStr = isNaN(data) ? '—' : data.toLocaleDateString('pt-BR');
        const isFiado = v.formaPagamento === 'fiado';
        const quitado = isFiado && v.fiadoQuitado;
        return `
          <div class="cliente-venda-row ${isFiado && !quitado ? 'fiado-em-aberto' : ''}">
            <div class="cvr-left">
              <span class="cvr-data">${dataStr}</span>
              <span class="cvr-pgto tag ${isFiado && !quitado ? 'fiado' : ''}">${
                labelFormaPagamento(v.formaPagamento, quitado)
              }</span>
            </div>
            <span class="cvr-total">${formatarMoeda(v.total || 0)}</span>
          </div>`;
      }).join('')}
    </div>
  ` : (cliente ? `<p class="cliente-sem-historico">Nenhuma compra registrada ainda.</p>` : '');

  wrap.innerHTML = `
    <div class="modal modal-cliente">
      <h2>${cliente ? 'Cliente' : 'Novo Cliente'}</h2>

      ${secaoStats}

      <div class="field">
        <label for="fClienteNome">Nome</label>
        <input id="fClienteNome" type="text" placeholder="Ex: Dona Maria"
          value="${cliente ? escaparHtml(cliente.nome || '') : ''}">
      </div>
      <div class="row2">
        <div class="field">
          <label for="fClienteTelefone">Telefone</label>
          <input id="fClienteTelefone" type="text" inputmode="tel" placeholder="(00) 00000-0000"
            value="${cliente ? escaparHtml(cliente.telefone || '') : ''}">
        </div>
        <div class="field">
          <label for="fClienteEmail">E-mail</label>
          <input id="fClienteEmail" type="email" placeholder="cliente@email.com"
            value="${cliente ? escaparHtml(cliente.email || '') : ''}">
        </div>
      </div>
      <div class="field">
        <label for="fClienteCpf">CPF</label>
        <input id="fClienteCpf" type="text" inputmode="numeric" placeholder="000.000.000-00"
          value="${cliente ? escaparHtml(cliente.cpf || '') : ''}">
      </div>
      <div class="field">
        <label for="fClienteEndereco">Endereço</label>
        <input id="fClienteEndereco" type="text" placeholder="Rua, número, bairro"
          value="${cliente ? escaparHtml(cliente.endereco || '') : ''}">
      </div>
      <div class="field">
        <label for="fClienteObservacoes">Observações</label>
        <textarea id="fClienteObservacoes" rows="3"
          placeholder="Anotações internas sobre o cliente…">${cliente ? escaparHtml(cliente.observacoes || '') : ''}</textarea>
      </div>

      ${secaoHistorico}

      <p class="erro" id="erroCliente" style="display:none;"></p>
      <div class="modal-actions">
        ${cliente ? `<button type="button" class="btn danger" id="btnExcluirCliente"
          style="width:auto;padding:9px 16px;">Excluir</button>` : ''}
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

// Ordena vendas da mais recente para a mais antiga
function ordenarVendasDesc(vendas) {
  return vendas.slice().sort((a, b) => {
    const da = new Date(a.criadoEm || a.data || 0);
    const db2 = new Date(b.criadoEm || b.data || 0);
    return db2 - da;
  });
}

// Rótulo amigável de forma de pagamento
function labelFormaPagamento(forma, fiadoQuitado) {
  const mapa = {
    dinheiro: 'Dinheiro',
    cartao: 'Cartão',
    pix: 'Pix',
    fiado: fiadoQuitado ? 'Fiado (quitado)' : 'Fiado',
  };
  return mapa[forma] || forma || '—';
}

// ---------------------------------------------------------------------------
// Fechar modal
// ---------------------------------------------------------------------------

function fecharModalCliente() {
  const el = document.getElementById('clienteModalWrap');
  if (el) el.remove();
  idClienteEmEdicao = null;
}

// ---------------------------------------------------------------------------
// Salvar / Excluir
// ---------------------------------------------------------------------------

async function salvarFormularioCliente() {
  const btnSalvar = document.getElementById('btnSalvarCliente');
  const erroEl = document.getElementById('erroCliente');
  if (btnSalvar.disabled) return;

  const nome = document.getElementById('fClienteNome').value.trim();
  if (!nome) {
    if (erroEl) { erroEl.textContent = 'Informe o nome do cliente.'; erroEl.style.display = ''; }
    return;
  }
  if (erroEl) erroEl.style.display = 'none';

  const dados = {
    nome,
    telefone:     document.getElementById('fClienteTelefone').value.trim(),
    email:        document.getElementById('fClienteEmail').value.trim(),
    cpf:          document.getElementById('fClienteCpf').value.trim(),
    endereco:     document.getElementById('fClienteEndereco').value.trim(),
    observacoes:  document.getElementById('fClienteObservacoes').value.trim(),
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

// ---------------------------------------------------------------------------
// Central de Dados (não mudou — mantido aqui por ser o mesmo arquivo)
// ---------------------------------------------------------------------------

async function carregarCentralDados() {
  const main = document.getElementById('main');
  if (!assinaturaCache) {
    try { assinaturaCache = await DB.buscarAssinatura(); } catch (e) { assinaturaCache = null; }
  }
  main.innerHTML = await CentralDados.renderizar(produtosCache, vendasCache, assinaturaCache);
  CentralDados.inicializar(produtosCache, vendasCache, carregarCentralDados);
}

// ---------------------------------------------------------------------------
// Render geral (router de abas + carrinho) — igual à versão anterior
// ---------------------------------------------------------------------------

function renderizarConteudo() {
  const main = document.getElementById('main');

  if (abaAtual === 'estoque') {
    main.innerHTML = barraFiltrosEstoque();
    atualizarListaProdutos();
  }

  else if (abaAtual === 'venda') {
    main.innerHTML = `
      <div class="page">
        <div class="filtros">
          <input
            type="text"
            id="campoBuscaVenda"
            class="campo-busca"
            placeholder="Buscar produto…"
            value="${escaparHtml(buscaVenda)}"
            oninput="aplicarFiltroVenda()"
          />
          ${categoriasVenda.length > 0 ? `
          <select id="seletorCategoriaVenda" class="filtro-select" onchange="aplicarFiltroVenda()">
            <option value="">Todas as categorias</option>
            ${categoriasVenda.map(c =>
              `<option value="${escaparHtml(c)}" ${c === categoriaVenda ? 'selected' : ''}>${escaparHtml(c)}</option>`
            ).join('')}
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
          <button type="button" class="btn danger" id="btnLogout"
            style="width:auto;padding:9px 16px;margin-top:10px;">Sair da conta</button>
        </div>

        ${usuarioLogadoPapel === 'dono' ? `
        <div class="card-info">
          <h3>Nome da empresa</h3>
          <div class="field">
            <input type="text" id="inputNomeEmpresaConta" class="filtro-select"
              value="${escaparHtml(usuarioLogadoNomeEmpresa || '')}">
          </div>
          <p class="erro" id="erroNomeEmpresaConta" style="display:none;"></p>
          <button type="button" class="btn primary" id="btnSalvarNomeEmpresaConta"
            style="width:auto;padding:9px 16px;margin-top:10px;">Salvar</button>
        </div>` : ''}

        <div class="card-info">
          <p><strong>Produtos cadastrados:</strong> ${produtosCache.length}</p>
          <p><strong>Vendas registradas:</strong> ${vendasCache.length}</p>
          <p><strong>Status:</strong> Sistema ativo</p>
        </div>

        <div class="card-info">
          <h3>Resumo rápido</h3>
          <p>Total em vendas hoje: ${formatarMoeda(Vendas.calcularVendasDoDia(vendasCache))}</p>
          ${usuarioLogadoPapel === 'dono'
            ? `<p>Total no mês: ${formatarMoeda(Vendas.calcularVendasDoMes(vendasCache))}</p>`
            : ''}
        </div>

        ${usuarioLogadoPapel === 'dono' && produtosCache.length === 0 ? `
        <div class="card-info">
          <h3>Dados de demonstração</h3>
          <p>Quer ver o sistema funcionando com produtos de exemplo? Isso não apaga nada do que você já cadastrou.</p>
          <button type="button" class="btn ghost" id="btnCarregarExemploConta"
            style="width:auto;padding:9px 16px;margin-top:10px;">Carregar exemplo</button>
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
          <p>• Adicionar produtos → botão "Adicionar produto"</p>
          <p>• Fazer vendas → aba "Venda"</p>
          <p>• Exportar dados → botão Exportar</p>
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Carrinho (não mudou)
// ---------------------------------------------------------------------------

function renderizarCarrinho() {
  const ids = Object.keys(carrinho);
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

function venderPeso(produtoId) {
  const produto = produtosCache.find(p => p.id === produtoId);
  if (!produto || produto.estoque <= 0) return;
  carrinho[produtoId] = Math.min(0.1, produto.estoque);
  atualizarListaVenda();
  renderizarCarrinho();
}

function definirQuantidadeCarrinho(produtoId, valorDigitado) {
  const produto = produtosCache.find(p => p.id === produtoId);
  if (!produto) return;

  const bruto = String(valorDigitado).trim();
  if (bruto === '') {
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
