/**
 * ui-comprovante-atividades.js
 * Comprovante de venda, exportação de CSV e Histórico de Atividades.
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-comprovante-atividades.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

// --- Comprovante de venda ---

function abrirComprovante() {
  const ids = Object.keys(carrinho);
  if (ids.length === 0) return;

  const itens = ids
    .map(id => {
      const produto = produtosCache.find(p => p.id === id);
      if (!produto) return null;
      return {
        produtoId: id,
        nome: produto.nome,
        quantidade: carrinho[id],
        precoUnitario: produto.preco,
        unidade: produto.unidade
      };
    })
    .filter(Boolean);

  if (itens.length === 0) return;
  const total = itens.reduce((soma, i) => soma + i.precoUnitario * i.quantidade, 0);
  // T4: lembra a última forma de pagamento escolhida
  formaPagamentoEscolhida = localStorage.getItem('mev_forma_pgto') || 'dinheiro';
  clienteIdSelecionadoNaVenda = null;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'receiptWrap';
  wrap.innerHTML = `
    <div class="receipt">
      <p class="rlabel">Comprovante</p>
      <h2>Cobrança</h2>
      <p class="rdate">${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
      ${itens.map(i => `<div class="ritem"><span><span class="qn">${Vendas.formatarQuantidadeItem(i)}</span>${escaparHtml(i.nome)}</span><span>${formatarMoeda(i.precoUnitario * i.quantidade)}</span></div>`).join('')}
      <div class="rtotal"><span>Total</span><span>${formatarMoeda(total)}</span></div>

      <p class="pay-label" id="labelCliente">Nome do cliente <span id="spanClienteOpcional">(opcional)</span><span id="spanClienteObrigatorio" style="display:none;color:#E24B4A;"> (obrigatório no fiado)</span></p>
      <div class="field autocomplete-wrap" style="margin-bottom:4px;position:relative;">
        <input id="fCliente" type="text" placeholder="Ex: Dona Maria" autocomplete="off">
        <div id="sugestoesCliente" class="autocomplete-sugestoes" style="display:none;"></div>
      </div>
      <button type="button" class="link-mais-opcoes" id="btnInfoCliente" style="padding:4px 0 10px;">+ Informações do cliente</button>
      <div id="infoClienteAvancado" style="display:none;">
        <div class="field">
          <label for="fClienteVendaTelefone">Telefone</label>
          <input id="fClienteVendaTelefone" type="text" inputmode="tel" placeholder="(00) 00000-0000" autocomplete="off">
        </div>
        <div class="field">
          <label for="fClienteVendaEmail">E-mail</label>
          <input id="fClienteVendaEmail" type="email" placeholder="cliente@email.com" autocomplete="off">
        </div>
        <div class="row2">
          <div class="field">
            <label for="fClienteVendaCpf">CPF</label>
            <input id="fClienteVendaCpf" type="text" inputmode="numeric" placeholder="000.000.000-00" autocomplete="off">
          </div>
        </div>
        <div class="field">
          <label for="fClienteVendaEndereco">Endereço</label>
          <input id="fClienteVendaEndereco" type="text" placeholder="Rua, número, bairro" autocomplete="off">
        </div>
        <div class="field">
          <label for="fClienteVendaObs">Observações</label>
          <textarea id="fClienteVendaObs" rows="2" placeholder="Anotações internas" style="resize:vertical;"></textarea>
        </div>
      </div>

      <p class="pay-label">Forma de pagamento</p>
      <div class="pay-options" id="payOptions">
        ${Vendas.FORMAS_PAGAMENTO.map(forma => `
          <button type="button" class="pay-btn ${forma === formaPagamentoEscolhida ? 'selected' : ''}" data-forma="${forma}">
            ${ROTULOS_PAGAMENTO[forma]}
          </button>`).join('')}
      </div>

      <button class="btn primary" id="btnConfirmar" style="width:100%;">Confirmar cobrança</button>
      <button class="btn ghost" id="btnVoltar" style="width:100%;margin-top:10px;">Voltar</button>
    </div>`;
  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnVoltar').addEventListener('click', () => wrap.remove());

  // Toggle informações avançadas do cliente
  document.getElementById('btnInfoCliente').addEventListener('click', function() {
    const painel = document.getElementById('infoClienteAvancado');
    const aberto = painel.style.display !== 'none';
    painel.style.display = aberto ? 'none' : 'block';
    this.textContent = aberto ? '+ Informações do cliente' : '– Ocultar informações do cliente';
  });

  configurarAutocompleteClienteVenda();

  document.getElementById('payOptions').addEventListener('click', e => {
    const botao = e.target.closest('.pay-btn');
    if (!botao) return;
    formaPagamentoEscolhida = botao.dataset.forma;
    localStorage.setItem('mev_forma_pgto', formaPagamentoEscolhida); // T4: persiste escolha
    document.querySelectorAll('#payOptions .pay-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.forma === formaPagamentoEscolhida);
    });
    // Fiado: nome do cliente obrigatório
    const eFiado = formaPagamentoEscolhida === 'fiado';
    document.getElementById('spanClienteOpcional').style.display = eFiado ? 'none' : '';
    document.getElementById('spanClienteObrigatorio').style.display = eFiado ? '' : 'none';
    document.getElementById('fCliente').required = eFiado;
    atualizarBtnConfirmarFiado();
  });

  function atualizarBtnConfirmarFiado() {
    const eFiado = formaPagamentoEscolhida === 'fiado';
    const temCliente = document.getElementById('fCliente').value.trim().length > 0;
    const btn = document.getElementById('btnConfirmar');
    if (!btn) return;
    btn.disabled = eFiado && !temCliente;
    btn.title = (eFiado && !temCliente) ? 'Informe o nome do cliente para registrar fiado' : '';
  }

  document.getElementById('fCliente').addEventListener('input', atualizarBtnConfirmarFiado);

  document.getElementById('btnConfirmar').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return; // já está processando — ignora cliques repetidos
    // Guarda extra: valida fiado mesmo que o listener de input não tenha rodado
    if (formaPagamentoEscolhida === 'fiado' && !document.getElementById('fCliente').value.trim()) {
      document.getElementById('fCliente').focus();
      mostrarToast('Informe o nome do cliente para registrar como fiado.', 'info');
      return;
    }
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = 'Registrando venda…';

    const cliente = document.getElementById('fCliente').value;
    const clienteSelecionado = clienteIdSelecionadoNaVenda
      ? clientesCache.find(c => c.id === clienteIdSelecionadoNaVenda)
      : null;
    const clienteId = (clienteSelecionado && clienteSelecionado.nome === cliente.trim()) ? clienteSelecionado.id : null;

    // Salva/atualiza dados avançados do cliente se preenchidos
    const telVal  = (document.getElementById('fClienteVendaTelefone') || {}).value || '';
    const emlVal  = (document.getElementById('fClienteVendaEmail') || {}).value || '';
    const cpfVal  = (document.getElementById('fClienteVendaCpf') || {}).value || '';
    const endVal  = (document.getElementById('fClienteVendaEndereco') || {}).value || '';
    const obsVal  = (document.getElementById('fClienteVendaObs') || {}).value || '';
    const temDadosAvancados = telVal || emlVal || cpfVal || endVal || obsVal;
    const nomeCliente = cliente.trim();

    if (nomeCliente && temDadosAvancados) {
      try {
        const dadosCliente = { nome: nomeCliente, telefone: telVal, email: emlVal, cpf: cpfVal, endereco: endVal, observacoes: obsVal };
        if (clienteId) {
          // Atualiza cliente existente
          await DB.salvarCliente({ ...clienteSelecionado, ...dadosCliente });
        } else {
          // Cria novo cliente
          await DB.salvarCliente({ id: DB.gerarId(), ...dadosCliente });
        }
        clientesCache = await DB.listarClientes();
      } catch (e) { /* não bloqueia a venda se falhar */ }
    }

    try {
      await Vendas.registrarVenda(itens, { formaPagamento: formaPagamentoEscolhida, cliente: nomeCliente, clienteId });
      carrinho = {};
      await recarregarDados();
      wrap.remove();
      renderizarTudo();
      mostrarToast('Venda registrada com sucesso!', 'sucesso');
      pulsarValor('statHoje');
    } catch (erro) {
      mostrarToast(erro.message || 'Não foi possível registrar a venda. Verifique sua conexão e tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
}

/**
 * Liga o campo "Nome do cliente" do comprovante a uma lista de sugestões
 * pesquisada em clientesCache enquanto a pessoa digita — sem impedir a
 * digitação livre de um nome que ainda não está cadastrado.
 */
function configurarAutocompleteClienteVenda() {
  const input = document.getElementById('fCliente');
  const lista = document.getElementById('sugestoesCliente');
  if (!input || !lista) return;

  let selecionandoCliente = false;
  const renderSugestoes = () => {
    if (selecionandoCliente) { selecionandoCliente = false; return; }
    const termo = input.value.trim().toLowerCase();
    clienteIdSelecionadoNaVenda = null;
    if (!termo) { lista.style.display = 'none'; lista.innerHTML = ''; return; }

    const encontrados = clientesCache
      .filter(c => (c.nome || '').toLowerCase().includes(termo))
      .slice(0, 6);

    if (encontrados.length === 0) { lista.style.display = 'none'; lista.innerHTML = ''; return; }

    lista.innerHTML = encontrados.map(c => `
      <div class="autocomplete-item" data-id="${escaparHtml(c.id)}">
        <span>${escaparHtml(c.nome)}</span>
        ${c.telefone ? `<span class="d">${escaparHtml(c.telefone)}</span>` : ''}
      </div>`).join('');
    lista.style.display = 'block';
  };

  input.addEventListener('input', renderSugestoes);
  input.addEventListener('focus', renderSugestoes);

  lista.addEventListener('click', e => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    const cliente = clientesCache.find(c => c.id === item.dataset.id);
    if (!cliente) return;
    selecionandoCliente = true;
    input.value = cliente.nome;
    clienteIdSelecionadoNaVenda = cliente.id;
    lista.style.display = 'none';
    lista.innerHTML = '';
    // Preenche campos avançados automaticamente com dados do cliente selecionado
    const tel = document.getElementById('fClienteVendaTelefone');
    const eml = document.getElementById('fClienteVendaEmail');
    const cpf = document.getElementById('fClienteVendaCpf');
    const end = document.getElementById('fClienteVendaEndereco');
    const obs = document.getElementById('fClienteVendaObs');
    if (tel || eml || cpf || end || obs) {
      if (tel) tel.value = cliente.telefone || '';
      if (eml) eml.value = cliente.email || '';
      if (cpf) cpf.value = cliente.cpf || '';
      if (end) end.value = cliente.endereco || '';
      if (obs) obs.value = cliente.observacoes || '';
      // Abre o painel se tiver algum dado para mostrar
      if (cliente.telefone || cliente.email || cliente.cpf || cliente.endereco || cliente.observacoes) {
        const painel = document.getElementById('infoClienteAvancado');
        const btn = document.getElementById('btnInfoCliente');
        if (painel && painel.style.display === 'none') {
          painel.style.display = 'block';
          if (btn) btn.textContent = '– Ocultar informações do cliente';
        }
      }
    }
    input.dispatchEvent(new Event('input')); // reaproveita a validação de fiado já existente, sem apagar a seleção
  });

  document.addEventListener('click', function fecharAoClicarFora(e) {
    if (!lista.isConnected) { document.removeEventListener('click', fecharAoClicarFora); return; }
    if (e.target !== input && !lista.contains(e.target)) lista.style.display = 'none';
  });
}



function baixarCsv(nomeArquivo, conteudo) {
  const blob = new Blob(['\ufeff' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function abrirMenuExportar() {
  const dataArquivo = new Date().toISOString().slice(0, 10);
  const ehPlanoPago = usuarioLogadoPlano && usuarioLogadoPlano !== 'gratis' && usuarioLogadoPlano !== 'free';

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'exportWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Exportar dados</h2>
      <p class="hint" style="margin:-8px 0 16px;">Escolha o que você quer baixar em planilha (CSV).</p>

      <button class="opt" id="expEstoque">
        📦 Estoque atual
        <span class="d">Produto, categoria, quantidade e histórico de entradas/saídas</span>
      </button>
      <button class="opt" id="expMovimentos">
        🔄 Movimentações
        <span class="d">Todo histórico de entradas e saídas, com data e motivo</span>
      </button>
      <button class="opt" id="expVendas">
        🧾 Vendas do período
        <span class="d">Respeita o filtro de período aberto na aba Histórico</span>
      </button>
      <button class="opt" id="expClientes">
        👤 Clientes
        <span class="d">Total de compras e valor gasto por cliente</span>
      </button>
      <button class="opt" id="expFiado">
        📝 Fiado em aberto
        <span class="d">Lista de fiados pendentes e quitados para cobrança</span>
      </button>

      ${ehPlanoPago ? `
      <div class="secao-avancada-titulo" style="margin:16px 0 10px;">Recursos do plano pago</div>
      <button class="opt" id="expVendedor">
        🏷️ Vendas por vendedor
        <span class="d">Filtra e exporta as vendas de um vendedor específico</span>
      </button>` : `
      <div style="margin-top:16px; padding:12px 14px; background:var(--paper-dim); border:1px solid var(--line); border-radius:10px;">
        <p style="margin:0 0 4px; font-weight:600; font-size:13px;">🔒 Vendas por vendedor</p>
        <p style="margin:0; font-size:12px; color:var(--ink-soft);">Disponível nos planos pagos. <a href="planos.html" style="color:var(--accent);">Ver planos →</a></p>
      </div>`}

      <button class="btn ghost" id="btnFecharExport" style="width:100%; margin-top:14px;">Fechar</button>
    </div>`;

  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnFecharExport').addEventListener('click', () => wrap.remove());

  document.getElementById('expEstoque').addEventListener('click', () => {
    if (produtosCache.length === 0) { mostrarToast('Cadastre ao menos um produto para exportar.', 'info'); return; }
    baixarCsv(`estoque-${dataArquivo}.csv`, Produtos.gerarCsvEstoque(produtosCache));
    wrap.remove();
  });

  document.getElementById('expMovimentos').addEventListener('click', async () => {
    const movimentos = await Produtos.listarMovimentos();
    if (movimentos.length === 0) { mostrarToast('Ainda não há movimentações registradas.', 'info'); return; }
    baixarCsv(`movimentacoes-${dataArquivo}.csv`, Produtos.gerarCsvMovimentos(movimentos));
    wrap.remove();
  });

  document.getElementById('expVendas').addEventListener('click', () => {
    const vendasDoPeriodo = Vendas.filtrarVendas(vendasCache, filtroVendas);
    if (vendasDoPeriodo.length === 0) { mostrarToast('Nenhuma venda no período selecionado na aba Histórico.', 'info'); return; }
    baixarCsv(`vendas-${dataArquivo}.csv`, Vendas.gerarCsvVendas(vendasDoPeriodo));
    wrap.remove();
  });

  document.getElementById('expClientes').addEventListener('click', () => {
    const historico = Vendas.calcularHistoricoClientes(vendasCache);
    if (historico.length === 0) { mostrarToast('Ainda não há vendas com nome de cliente registrado.', 'info'); return; }
    baixarCsv(`clientes-${dataArquivo}.csv`, Vendas.gerarCsvClientes(vendasCache));
    wrap.remove();
  });

  document.getElementById('expFiado').addEventListener('click', () => {
    const fiadoAtivas = vendasCache.filter(v => v.formaPagamento === 'fiado' && v.status !== 'cancelada');
    if (fiadoAtivas.length === 0) { mostrarToast('Não há vendas no fiado registradas.', 'info'); return; }
    baixarCsv(`fiado-${dataArquivo}.csv`, Vendas.gerarCsvFiado(vendasCache));
    wrap.remove();
  });

  if (ehPlanoPago) {
    document.getElementById('expVendedor').addEventListener('click', () => {
      wrap.remove();
      abrirExportarPorVendedor(dataArquivo);
    });
  }
}
function abrirExportarPorVendedor(dataArquivo) {
  // Guarda de segurança: nunca executa para plano gratuito,
  // mesmo que alguém chame a função diretamente.
  const ehPlanoPago = usuarioLogadoPlano && usuarioLogadoPlano !== 'gratis' && usuarioLogadoPlano !== 'free';
  if (!ehPlanoPago) {
    mostrarToast('Recurso disponível apenas nos planos pagos.', 'info');
    return;
  }

  const vendedores = Vendas.listarVendedores(vendasCache);
  if (vendedores.length === 0) {
    mostrarToast('Nenhuma venda com vendedor identificado ainda.', 'info');
    return;
  }

  const dataRef = dataArquivo || new Date().toISOString().slice(0, 10);

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'exportVendedorWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Exportar por vendedor</h2>
      <p class="hint" style="margin:-8px 0 16px;">Selecione o vendedor e o período para exportar.</p>

      <div class="field">
        <label for="selVendedor">Vendedor</label>
        <select id="selVendedor" class="filtro-select" style="width:100%;">
          <option value="">— Todos os vendedores —</option>
          ${vendedores.map(v => `<option value="${escaparHtml(v)}">${escaparHtml(v)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="selPeriodoVendedor">Período</label>
        <select id="selPeriodoVendedor" class="filtro-select" style="width:100%;">
          <option value="todas">Todo o histórico</option>
          <option value="hoje">Hoje</option>
          <option value="semana">Últimos 7 dias</option>
          <option value="mes">Este mês</option>
        </select>
      </div>

      <div class="row2" style="gap:8px; margin-top:6px;">
        <button class="btn ghost" id="btnVoltarExport">← Voltar</button>
        <button class="btn primary" id="btnConfirmarExportVendedor">Exportar CSV</button>
      </div>
    </div>`;

  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });

  document.getElementById('btnVoltarExport').addEventListener('click', () => {
    wrap.remove();
    abrirMenuExportar();
  });

  document.getElementById('btnConfirmarExportVendedor').addEventListener('click', () => {
    const vendedor = document.getElementById('selVendedor').value;
    const periodo  = document.getElementById('selPeriodoVendedor').value;

    const filtradas = Vendas.filtrarVendas(vendasCache, { periodo, vendedor });
    if (filtradas.length === 0) {
      mostrarToast('Nenhuma venda encontrada com esse filtro.', 'info');
      return;
    }

    const sufixoVendedor = vendedor ? `-${vendedor.replace(/\s+/g, '_')}` : '-todos';
    baixarCsv(`vendas${sufixoVendedor}-${dataRef}.csv`, Vendas.gerarCsvVendas(filtradas));
    wrap.remove();
  });
}

// --- Histórico de atividades (só dono, recurso do plano Pro) ---

const ROTULOS_ACAO_ATIVIDADE = {
  criou: '➕ Cadastrou',
  atualizou: '✏️ Editou',
  excluiu: '🗑️ Excluiu',
  adicionou_membro: '👥 Adicionou à equipe',
  editou_membro: '✏️ Editou papel na equipe',
  removeu_membro: '👤 Removeu da equipe',
  mudou_plano: '💳 Mudou de plano',
  cancelou_assinatura: '💳 Cancelou assinatura',
  criou_empresa: '🏢 Criou a empresa',
};

const ROTULOS_STORE_ATIVIDADE = {
  produtos: 'Produtos',
  vendas: 'Vendas',
  clientes: 'Clientes',
  movimentos: 'Movimentos',
  membros: 'Equipe',
  assinatura: 'Assinatura',
  empresa: 'Empresa',
  metas: 'Metas',
};

const ICONES_STORE_ATIVIDADE = {
  produtos: '📦',
  vendas: '🧾',
  clientes: '🧑',
  movimentos: '🔁',
  membros: '👥',
  assinatura: '💳',
  empresa: '🏢',
  metas: '🎯',
};

// Chips de tipo de ação exibidos no topo da tela — os quatro primeiros são
// os mais usados no dia a dia (venda, produto, cliente, equipe); o restante
// completa a lista de áreas que geram atividade no sistema.
const TIPOS_ATIVIDADE = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'vendas', rotulo: '🧾 Vendas' },
  { valor: 'produtos', rotulo: '📦 Produtos' },
  { valor: 'clientes', rotulo: '🧑 Clientes' },
  { valor: 'membros', rotulo: '👥 Equipe' },
  { valor: 'movimentos', rotulo: '🔁 Estoque' },
  { valor: 'assinatura', rotulo: '💳 Assinatura' },
  { valor: 'empresa', rotulo: '🏢 Empresa' },
];

const ATIVIDADES_POR_PAGINA = 20;

let filtroAtividades = { store: '', usuario: '', inicio: '', fim: '' };

// Estado da lista carregada (itens acumulados + paginação por scroll infinito).
let estadoAtividades = { itens: [], offset: 0, temMais: true, carregando: false, erro: null };
let observerAtividades = null;

/** Monta um card avisando que o recurso pertence a um plano superior, com link pra upgrade. */
function cartaoRecursoBloqueadoHtml(erro) {
  const nomeNecessario = NOME_PLANO_FALLBACK[erro.planoNecessario] || erro.planoNecessario || 'Pro';
  return `
    <div class="card-info">
      <h3>🔒 Recurso do plano ${escaparHtml(nomeNecessario)}</h3>
      <p>${escaparHtml(erro.message || 'Esse recurso não está disponível no seu plano atual.')}</p>
      <a href="planos.html" class="btn primary" style="display:inline-block;width:auto;padding:9px 16px;margin-top:10px;text-decoration:none;">Ver planos</a>
    </div>
  `;
}

function contarFiltrosAvancadosAtivos() {
  return ['usuario', 'inicio', 'fim'].filter(chave => filtroAtividades[chave]).length;
}

function telaAtividadesHtml() {
  return `
    <div class="page">
      <h2>📜 Histórico de atividades</h2>
      <p class="hint">Veja quem fez cada ação dentro da sua empresa.</p>

      <div class="atividades-filtros">
        <div class="chips" id="chipsAtividadeTipo">
          ${TIPOS_ATIVIDADE.map(t => `
            <button type="button" class="chip${filtroAtividades.store === t.valor ? ' active' : ''}" data-store="${t.valor}">${t.rotulo}</button>
          `).join('')}
        </div>

        <button type="button" class="link-mais-opcoes atividades-toggle-filtros" id="btnMaisFiltrosAtividade">
          <span id="rotuloMaisFiltrosAtividade">⚙️ Mais filtros</span><span id="badgeFiltrosAtividade" class="atividades-filtro-badge" style="display:none;"></span>
        </button>

        <div id="painelMaisFiltrosAtividade" class="atividades-painel-filtros" style="display:none;">
          <div class="field">
            <label for="filtroAtividadeUsuario">Usuário</label>
            <select id="filtroAtividadeUsuario" class="filtro-select" style="margin-bottom:0;">
              <option value="">Todos os usuários</option>
            </select>
          </div>
          <div class="row2">
            <div class="field">
              <label for="filtroAtividadeInicio">De</label>
              <input type="date" id="filtroAtividadeInicio">
            </div>
            <div class="field">
              <label for="filtroAtividadeFim">Até</label>
              <input type="date" id="filtroAtividadeFim">
            </div>
          </div>
          <button type="button" class="btn ghost" id="btnLimparFiltrosAtividade" style="width:auto;padding:8px 14px;margin-bottom:4px;">Limpar filtros</button>
        </div>
      </div>

      <div id="listaAtividades" class="atividades-lista"><p class="team-msg">Carregando…</p></div>
      <p id="rodapeAtividades" class="atividades-rodape" style="display:none;"></p>
      <div id="sentinelAtividades"></div>
    </div>
  `;
}

/** Formata "YYYY-MM-DD HH:MM:SS" (UTC, como o SQLite grava) pro horário local em pt-BR. */
function formatarDataHoraAtividade(dataSql) {
  const data = new Date(String(dataSql).replace(' ', 'T') + 'Z');
  if (isNaN(data.getTime())) return dataSql;
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function atividadeCardHtml(atividade) {
  const rotuloStore = ROTULOS_STORE_ATIVIDADE[atividade.store] || 'Geral';
  const iconeStore = ICONES_STORE_ATIVIDADE[atividade.store] || '📌';
  const rotuloPapel = ROTULOS_PAPEL[atividade.papel] || atividade.papel || '';
  const papelClasse = ['dono', 'vendedor', 'estoquista', 'gerente'].includes(atividade.papel) ? atividade.papel : 'vendedor';

  return `
    <div class="atividade-card">
      <span class="atividade-icone" aria-hidden="true">${iconeStore}</span>
      <div class="atividade-corpo">
        <p class="atividade-desc">${escaparHtml(atividade.descricao)}</p>
        <div class="atividade-meta">
          <span class="atividade-user">
            <span class="atividade-avatar" aria-hidden="true">${escaparHtml(gerarIniciaisEmail(atividade.usuarioEmail))}</span>
            ${escaparHtml(atividade.usuarioEmail || '')}
          </span>
          ${rotuloPapel ? `<span class="role-chip ${papelClasse}"><span class="dot"></span>${escaparHtml(rotuloPapel)}</span>` : ''}
          <span class="atividade-tag">${escaparHtml(rotuloStore)}</span>
        </div>
        <span class="atividade-data">${escaparHtml(formatarDataHoraAtividade(atividade.criadoEm))}</span>
      </div>
    </div>
  `;
}

async function carregarTelaAtividades() {
  // Reseta o estado a cada entrada na tela (evita misturar páginas de visitas anteriores).
  estadoAtividades = { itens: [], offset: 0, temMais: true, carregando: false, erro: null };

  document.querySelectorAll('#chipsAtividadeTipo .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filtroAtividades.store = chip.dataset.store;
      document.querySelectorAll('#chipsAtividadeTipo .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.store === filtroAtividades.store);
      });
      carregarListaAtividades(true);
    });
  });

  const btnMaisFiltros = document.getElementById('btnMaisFiltrosAtividade');
  const painelFiltros = document.getElementById('painelMaisFiltrosAtividade');
  if (btnMaisFiltros && painelFiltros) {
    btnMaisFiltros.addEventListener('click', () => {
      const aberto = painelFiltros.style.display !== 'none';
      painelFiltros.style.display = aberto ? 'none' : 'block';
      document.getElementById('rotuloMaisFiltrosAtividade').textContent = aberto ? '⚙️ Mais filtros' : '⚙️ Ocultar filtros';
    });
  }

  const seletorUsuario = document.getElementById('filtroAtividadeUsuario');
  if (seletorUsuario) {
    try {
      const membros = await DB.listarMembros();
      seletorUsuario.innerHTML = '<option value="">Todos os usuários</option>' +
        membros.map(m => `<option value="${escaparHtml(m.email)}">${escaparHtml(m.email)}</option>`).join('');
      seletorUsuario.value = filtroAtividades.usuario;
    } catch (e) { /* mantém só a opção "Todos" se não conseguir listar a equipe */ }
    seletorUsuario.addEventListener('change', () => {
      filtroAtividades.usuario = seletorUsuario.value;
      atualizarBadgeFiltrosAtividade();
      carregarListaAtividades(true);
    });
  }

  const campoInicio = document.getElementById('filtroAtividadeInicio');
  const campoFim = document.getElementById('filtroAtividadeFim');
  if (campoInicio) {
    campoInicio.value = filtroAtividades.inicio;
    campoInicio.addEventListener('change', () => {
      filtroAtividades.inicio = campoInicio.value;
      atualizarBadgeFiltrosAtividade();
      carregarListaAtividades(true);
    });
  }
  if (campoFim) {
    campoFim.value = filtroAtividades.fim;
    campoFim.addEventListener('change', () => {
      filtroAtividades.fim = campoFim.value;
      atualizarBadgeFiltrosAtividade();
      carregarListaAtividades(true);
    });
  }

  const btnLimpar = document.getElementById('btnLimparFiltrosAtividade');
  if (btnLimpar) {
    btnLimpar.addEventListener('click', () => {
      filtroAtividades.usuario = '';
      filtroAtividades.inicio = '';
      filtroAtividades.fim = '';
      if (seletorUsuario) seletorUsuario.value = '';
      if (campoInicio) campoInicio.value = '';
      if (campoFim) campoFim.value = '';
      atualizarBadgeFiltrosAtividade();
      carregarListaAtividades(true);
    });
  }

  atualizarBadgeFiltrosAtividade();
  configurarScrollInfinitoAtividades();
  await carregarListaAtividades(true);
}

function atualizarBadgeFiltrosAtividade() {
  const badge = document.getElementById('badgeFiltrosAtividade');
  if (!badge) return;
  const total = contarFiltrosAvancadosAtivos();
  badge.textContent = String(total);
  badge.style.display = total > 0 ? 'inline-flex' : 'none';
}

function configurarScrollInfinitoAtividades() {
  if (observerAtividades) {
    observerAtividades.disconnect();
    observerAtividades = null;
  }
  const sentinela = document.getElementById('sentinelAtividades');
  if (!sentinela || typeof IntersectionObserver === 'undefined') return;
  observerAtividades = new IntersectionObserver((entradas) => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) carregarListaAtividades(false);
    });
  }, { rootMargin: '200px' });
  observerAtividades.observe(sentinela);
}

/**
 * Carrega o histórico de atividades. Quando `reiniciar` é true, zera a lista
 * e recomeça da primeira página (usado ao trocar filtros); caso contrário,
 * busca a próxima página e adiciona ao final (usado pelo scroll infinito).
 */
async function carregarListaAtividades(reiniciar) {
  const container = document.getElementById('listaAtividades');
  const rodape = document.getElementById('rodapeAtividades');
  if (!container) return;

  if (reiniciar) {
    estadoAtividades = { itens: [], offset: 0, temMais: true, carregando: false, erro: null };
    container.innerHTML = '<p class="team-msg">Carregando…</p>';
    if (rodape) rodape.style.display = 'none';
  }

  if (estadoAtividades.carregando || !estadoAtividades.temMais) return;
  estadoAtividades.carregando = true;
  if (rodape && estadoAtividades.itens.length > 0) {
    rodape.style.display = 'block';
    rodape.textContent = 'Carregando mais…';
  }

  try {
    const resposta = await DB.listarAtividades({
      store: filtroAtividades.store || undefined,
      usuario: filtroAtividades.usuario || undefined,
      inicio: filtroAtividades.inicio || undefined,
      fim: filtroAtividades.fim || undefined,
      limite: ATIVIDADES_POR_PAGINA,
      offset: estadoAtividades.offset,
    });
    const itens = (resposta && resposta.itens) || [];
    estadoAtividades.itens = estadoAtividades.itens.concat(itens);
    estadoAtividades.offset += itens.length;
    estadoAtividades.temMais = !!(resposta && resposta.temMais);

    if (estadoAtividades.itens.length === 0) {
      container.innerHTML = '<p class="team-msg">Nenhuma atividade encontrada com esses filtros.</p>';
    } else {
      container.innerHTML = estadoAtividades.itens.map(atividadeCardHtml).join('');
    }

    if (rodape) {
      if (!estadoAtividades.temMais && estadoAtividades.itens.length > 0) {
        rodape.style.display = 'block';
        rodape.textContent = 'Fim do histórico.';
      } else {
        rodape.style.display = 'none';
      }
    }
  } catch (erro) {
    estadoAtividades.temMais = false; // evita novas tentativas automáticas via scroll
    if (estadoAtividades.itens.length === 0) {
      container.innerHTML = erro && erro.recurso
        ? cartaoRecursoBloqueadoHtml(erro)
        : `<p class="erro" style="margin:0;">${escaparHtml((erro && erro.message) || 'Não foi possível carregar o histórico de atividades.')}</p>`;
    } else if (rodape) {
      rodape.style.display = 'block';
      rodape.textContent = 'Não foi possível carregar mais atividades.';
    }
  } finally {
    estadoAtividades.carregando = false;
  }
}

// --- Onboarding (primeira utilização) ---

const CHAVE_ONBOARDING = 'estoqueFacilOnboardingVisto';

const PRODUTOS_EXEMPLO = [
  { nome: 'Coca-Cola lata', preco: 6, estoque: 24, estoqueMinimo: 6, categoria: 'Bebidas', imagem:'img/cocacola.jpg'},
  { nome: 'Salgado assado', preco: 7, estoque: 15, estoqueMinimo: 5, categoria: 'Salgados', imagem:'img/salgado.jpg' },
  { nome: 'Água mineral 500ml', preco: 3, estoque: 30, estoqueMinimo: 8, categoria: 'Bebidas',imagem:'img/agua500ml.png' },
  { nome: 'Brigadeiro', preco: 2.5, estoque: 20, estoqueMinimo: 5, categoria: 'Doces',imagem:'img/brigadeiro.jpg' }
];

function abrirOnboarding() {
  // Segurança extra: nunca oferecer os exemplos se já existe produto
  // cadastrado, mesmo que a função seja chamada de outro ponto no futuro.
  if (produtosCache.length > 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap modal-wrap-centro';
  wrap.id = 'onboardWrap';
  wrap.innerHTML = `
    <div class="onboard">
      <div class="emoji">👋</div>
      <h2>Bem-vindo(a) ao Meu Estoque e Vendas</h2>
      <p>Cadastre produtos, venda em poucos toques e o estoque se atualiza sozinho. Quer começar vendo um exemplo pronto, ou prefere cadastrar do zero?</p>
      <button class="btn primary" id="btnExemplo">Carregar exemplo</button>
      <button class="btn ghost" id="btnZero">Começar do zero</button>
    </div>`;
  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);

  const fechar = () => {
    localStorage.setItem(CHAVE_ONBOARDING, '1');
    wrap.remove();
  };

  document.getElementById('btnZero').addEventListener('click', fechar);
  document.getElementById('btnExemplo').addEventListener('click', async () => {
    const botao = document.getElementById('btnExemplo');
    const sucesso = await carregarDadosExemplo(botao);
    if (sucesso) fechar();
  });
}

/**
 * Importa os produtos de demonstração (PRODUTOS_EXEMPLO) para a conta do
 * usuário logado. Usada tanto no modal de boas-vindas (primeiro acesso)
 * quanto no botão "Carregar exemplo" disponível na aba Conta.
 *
 * Nunca sobrescreve dados reais: se já existirem produtos cadastrados,
 * pede confirmação antes de prosseguir. Em caso de erro de rede/API,
 * mostra mensagem amigável em vez de falhar silenciosamente.
 *
 * Retorna true se os dados foram importados (ou o usuário confirmou e tudo
 * deu certo) e false se o usuário cancelou ou se ocorreu um erro.
 */
async function carregarDadosExemplo(botao) {
  if (produtosCache.length > 0) {
    const confirmar = await mostrarConfirm(
      `Você já tem ${produtosCache.length} produto(s) cadastrado(s). ` +
      `Carregar os dados de exemplo vai ADICIONAR novos produtos de demonstração ` +
      `sem apagar os que você já tem. Deseja continuar?`,
      { confirmText: 'Continuar', cancelText: 'Cancelar' }
    );
    if (!confirmar) return false;
  }

  const textoOriginal = botao ? botao.textContent : null;
  if (botao) {
    botao.disabled = true;
    botao.textContent = 'Carregando…';
  }

  try {
    for (const p of PRODUTOS_EXEMPLO) {
      await Produtos.criarProduto(p);
    }
    await recarregarDados();
    renderizarTudo();
    mostrarToast('Dados de exemplo carregados com sucesso! 🎉', 'sucesso');
    return true;
  } catch (erro) {
    mostrarToast(
      erro && erro.message
        ? `Não foi possível carregar os dados de exemplo: ${erro.message}`
        : 'Não foi possível carregar os dados de exemplo. Verifique sua conexão e tente novamente.',
      'erro'
    );
    return false;
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }
}

