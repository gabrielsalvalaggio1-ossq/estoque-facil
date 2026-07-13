/**
 * ui-estoque-venda.js
 * Dashboard (cabeçalho), aba Estoque e aba Venda (cardápio + histórico de vendas).
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-estoque-venda.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

// ── T14: Lazy loading de imagens de produto ──────────────────────────────
// Pixel transparente 1x1 usado como placeholder enquanto a foto real não
// entra na viewport — evita o ícone de "imagem quebrada" e uma requisição
// indesejada por src="" (alguns navegadores tratam src vazio como refetch
// da própria página).
const PIXEL_TRANSPARENTE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/** Monta a tag <img> de uma foto de produto com lazy loading (loading="lazy"
 *  nativo + IntersectionObserver como mecanismo real de adiar o carregamento
 *  via data-src, cobrindo também navegadores sem suporte a `loading`). */
function imagemProdutoLazy(urlImagem, classeExtra = '') {
  return `<img src="${PIXEL_TRANSPARENTE}" data-src="${escaparHtml(urlImagem)}" alt="" loading="lazy" decoding="async" class="thumb${classeExtra ? ' ' + classeExtra : ''}">`;
}

let _observerImagensLazy = null;

/** Ativa o carregamento das fotos de produto visíveis dentro de `escopo`.
 *  Precisa ser chamada depois de qualquer innerHTML que insira imagens com
 *  data-src, já que os elementos antigos observados somem com o innerHTML. */
function observarImagensLazy(escopo = document) {
  const imgs = escopo.querySelectorAll('img[data-src]');
  if (!imgs.length) return;

  if (!('IntersectionObserver' in window)) {
    // Navegador muito antigo: carrega tudo de uma vez (sem lazy, mas funcional).
    imgs.forEach(img => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
    return;
  }

  if (!_observerImagensLazy) {
    _observerImagensLazy = new IntersectionObserver((entradas, observer) => {
      entradas.forEach(entrada => {
        if (!entrada.isIntersecting) return;
        const img = entrada.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        observer.unobserve(img);
      });
    }, { rootMargin: '200px 0px' });
  }

  imgs.forEach(img => _observerImagensLazy.observe(img));
}

// ── T14: Cache de renders — evita re-renderizar listas que não mudaram ──
// Guarda o último HTML efetivamente aplicado em cada container. Se o HTML
// recém-gerado for idêntico ao anterior, pula o innerHTML (que força reflow
// e recriação de todos os nós filhos) — comum quando o usuário troca de aba
// e volta, ou quando um re-render é disparado sem nenhuma mudança real nos
// dados/filtros.
const _cacheRenderLista = {};
function renderizarSeMudou(container, html, chave) {
  if (!container) return false;
  const anterior = _cacheRenderLista[chave];
  // Compara também o elemento: ao trocar de aba o container é recriado do
  // zero (innerHTML novo, vazio) — nesse caso precisa renderizar de novo
  // mesmo que o HTML gerado seja idêntico ao da última vez.
  if (anterior && anterior.elemento === container && anterior.html === html) return false;
  _cacheRenderLista[chave] = { elemento: container, html };
  container.innerHTML = html;
  return true;
}

// --- Dashboard (cabeçalho) ---

function renderizarEstatisticas() {
  const { estoqueBaixo } = Produtos.calcularEstatisticas(produtosCache);
  document.getElementById('statHoje').textContent = formatarMoeda(Vendas.calcularVendasDoDia(vendasCache)).replace('R$ ', 'R$');
  document.getElementById('statMes').textContent = formatarMoeda(Vendas.calcularVendasDoMes(vendasCache)).replace('R$ ', 'R$');
  document.getElementById('statLow').textContent = estoqueBaixo;

  const maisVendidos = Produtos.calcularMaisVendidos(vendasCache, 3);
  const elTop = document.getElementById('topSellers');
  if (maisVendidos.length === 0) {
    elTop.style.display = 'none';
  } else {
    elTop.style.display = 'block';
    elTop.innerHTML = '🔥 Mais vendidos: <strong>' + maisVendidos.map(m => escaparHtml(m.nome)).join(', ') + '</strong>';
  }
}

function irParaEstoqueBaixo() {
  abaAtual = 'estoque';
  filtroEstoque.situacao = 'baixo';
  renderizarTudo();
}

function renderizarAbas() {
  document.querySelectorAll('[data-tab]').forEach(botao => {
    botao.classList.toggle('active', botao.dataset.tab === abaAtual);
  });
  document.getElementById('toolbarEstoque').style.display = abaAtual === 'estoque' ? 'flex' : 'none';
  document.getElementById('toolbarVenda').style.display = abaAtual === 'venda' ? 'flex' : 'none';
}

// --- Aba Estoque ---

function barraFiltrosEstoque() {
  const categorias = Produtos.listarCategorias(produtosCache);
  const fornecedores = Produtos.listarFornecedores(produtosCache);
  return `
    <div class="filtros">
      <input type="text" id="campoBusca" class="campo-busca" placeholder="Buscar produto..."
        value="${escaparHtml(filtroEstoque.busca)}" oninput="aplicarFiltroEstoque()">
      ${categorias.length > 1 ? `
      <select id="seletorCategoria" class="filtro-select" onchange="aplicarFiltroEstoque()">
        <option value="">Todas as categorias</option>
        ${categorias.map(c => `<option value="${escaparHtml(c)}" ${c === filtroEstoque.categoria ? 'selected' : ''}>${escaparHtml(c)}</option>`).join('')}
      </select>` : ''}
      ${fornecedores.length > 0 ? `
      <select id="seletorFornecedor" class="filtro-select" onchange="aplicarFiltroEstoque()">
        <option value="">Todos os fornecedores</option>
        ${fornecedores.map(f => `<option value="${escaparHtml(f)}" ${f === filtroEstoque.fornecedor ? 'selected' : ''}>${escaparHtml(f)}</option>`).join('')}
      </select>` : ''}
      ${(categorias.length > 1 || fornecedores.length > 0) ? `
      <select id="seletorAgrupar" class="filtro-select" onchange="aplicarFiltroEstoque()">
        <option value="nenhum" ${filtroEstoque.agrupar === 'nenhum' ? 'selected' : ''}>Não agrupar</option>
        <option value="categoria" ${filtroEstoque.agrupar === 'categoria' ? 'selected' : ''}>Agrupar por categoria</option>
        ${fornecedores.length > 0 ? `<option value="fornecedor" ${filtroEstoque.agrupar === 'fornecedor' ? 'selected' : ''}>Agrupar por fornecedor</option>` : ''}
      </select>` : ''}
      <div class="chips">
        <button class="chip ${filtroEstoque.situacao === 'todos' ? 'active' : ''}" onclick="definirSituacaoEstoque('todos')">Todos</button>
        <button class="chip ${filtroEstoque.situacao === 'baixo' ? 'active' : ''}" onclick="definirSituacaoEstoque('baixo')">Estoque baixo</button>
        <button class="chip ${filtroEstoque.situacao === 'disponivel' ? 'active' : ''}" onclick="definirSituacaoEstoque('disponivel')">Disponível</button>
      </div>
    </div>
    <div id="listaProdutos"></div>`;
}

function definirSituacaoEstoque(situacao) {
  filtroEstoque.situacao = situacao;
  renderizarConteudo();
}

let _timerfiltroEstoque = null;
function aplicarFiltroEstoque() {
  // Lê os filtros de selects imediatamente (sem debounce) — só a re-renderização
  // é adiada, pra não travar com catálogos grandes enquanto o usuário digita.
  const campoBusca = document.getElementById('campoBusca');
  const seletorCategoria = document.getElementById('seletorCategoria');
  const seletorFornecedor = document.getElementById('seletorFornecedor');
  const seletorAgrupar = document.getElementById('seletorAgrupar');
  filtroEstoque.busca = campoBusca ? campoBusca.value : '';
  filtroEstoque.categoria = seletorCategoria ? seletorCategoria.value : '';
  filtroEstoque.fornecedor = seletorFornecedor ? seletorFornecedor.value : '';
  filtroEstoque.agrupar = seletorAgrupar ? seletorAgrupar.value : 'nenhum';
  clearTimeout(_timerfiltroEstoque);
  _timerfiltroEstoque = setTimeout(atualizarListaProdutos, 200);
}

function atualizarListaProdutos() {
  const container = document.getElementById('listaProdutos');
  if (!container) return;
  const filtrados = Produtos.filtrarProdutos(produtosCache, filtroEstoque);
  let html;
  if (produtosCache.length === 0) {
    html = telaVaziaEstoque();
  } else if (filtrados.length === 0) {
    html = criarSemResultado('Nenhum produto encontrado', 'Tente outro filtro ou termo de busca.');
  } else if (filtroEstoque.agrupar === 'categoria' || filtroEstoque.agrupar === 'fornecedor') {
    html = agruparProdutosEstoqueHtml(filtrados, filtroEstoque.agrupar);
  } else {
    html = filtrados.map(cartaoProdutoEstoque).join('');
  }
  const mudou = renderizarSeMudou(container, html, 'estoque');
  if (mudou) observarImagensLazy(container);
  if (produtoRecemCriadoId) produtoRecemCriadoId = null;
}

/** Agrupa os produtos da aba Estoque em seções por categoria ou fornecedor,
 *  reaproveitando os cartões normais de gestão de estoque dentro de cada grupo. */
function agruparProdutosEstoqueHtml(produtos, tipo) {
  const agrupado = {};
  produtos.forEach(p => {
    const chave = tipo === 'fornecedor'
      ? ((p.fornecedor && String(p.fornecedor).trim()) || Produtos.SEM_FORNECEDOR)
      : (p.categoria || Produtos.CATEGORIA_PADRAO);
    if (!agrupado[chave]) agrupado[chave] = [];
    agrupado[chave].push(p);
  });
  const chaves = Object.keys(agrupado).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return chaves.map(chave => `
    <div class="categoria-grupo">
      <h3 class="categoria-titulo">${escaparHtml(chave)}</h3>
      ${agrupado[chave].map(cartaoProdutoEstoque).join('')}
    </div>
  `).join('');
}

function telaVaziaEstoque() {
  return criarEstadoVazio({
    icone: '📦',
    titulo: 'Nenhum produto ainda',
    dica: 'Toque em "Adicionar produto" para cadastrar seu primeiro item, ou importe uma planilha inteira de uma vez.',
  });
}

function telaVaziaVendas() {
  return criarEstadoVazio({
    icone: '🧾',
    titulo: 'Nenhuma venda registrada',
    dica: 'Suas cobranças aparecem aqui assim que você fizer a primeira venda na aba Venda.',
  });
}

/** Formata a quantidade em estoque de forma explícita quanto à unidade: '12 un' ou '2,500 kg'. */
function formatarQuantidadeEstoque(produto) {
  if (produto.unidade === 'kg') {
    return Number(produto.estoque).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
  }
  return produto.estoque + ' un';
}

/** Card de gestão (aba Estoque): mostra quantidade, sem botão de vender — toque para editar.
 *  Em modo de seleção (impressão de etiquetas), o toque marca/desmarca em vez de abrir edição. */
function cartaoProdutoEstoque(produto) {
  const estoqueBaixo = produto.estoque <= (produto.estoqueMinimo || 0);
  const categoria = produto.categoria || Produtos.CATEGORIA_PADRAO;
  const fornecedorTag = (produto.fornecedor && String(produto.fornecedor).trim())
    ? `<span class="cat fornecedor-tag">${escaparHtml(produto.fornecedor)}</span>`
    : '';
  const miniatura = produto.imagem
    ? imagemProdutoLazy(produto.imagem)
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  if (modoSelecaoEtiquetas || modoSelecaoLote) {
    const marcado = modoSelecaoLote
      ? produtosSelecionadosLote.has(produto.id)
      : produtosSelecionadosEtiquetas.has(produto.id);
    const aoClicar = modoSelecaoLote
      ? `alternarSelecaoProdutoLote('${escaparHtml(produto.id)}')`
      : `alternarSelecaoProdutoEtiqueta('${escaparHtml(produto.id)}')`;
    return `<div class="product-card modo-selecao ${marcado ? 'selecionado' : ''}" onclick="${aoClicar}">
      <span class="selecao-check" aria-hidden="true">${marcado ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}</span>
      ${miniatura}
      <div class="info">
        <div class="name">${escaparHtml(produto.nome)}</div>
        <div class="meta">
          <span class="price">${formatarMoeda(produto.preco)}${produto.unidade === 'kg' ? '/kg' : ''}</span>
          <span class="stock ${estoqueBaixo ? 'low' : ''}">${formatarQuantidadeEstoque(produto)} em estoque</span>
          <span class="cat">${escaparHtml(categoria)}</span>
          ${fornecedorTag}
        </div>
      </div>
    </div>`;
  }

  return `<div class="product-card${produto.id === produtoRecemCriadoId ? ' product-card--novo' : ''}" style="view-transition-name:produto-${escaparHtml(produto.id)}" onclick="abrirEdicao('${escaparHtml(produto.id)}')">
    ${miniatura}
    <div class="info">
      <div class="name">${escaparHtml(produto.nome)}</div>
      <div class="meta">
        <span class="price">${formatarMoeda(produto.preco)}${produto.unidade === 'kg' ? '/kg' : ''}</span>
        <span class="stock ${estoqueBaixo ? 'low' : ''}">${formatarQuantidadeEstoque(produto)} em estoque</span>
        <span class="cat">${escaparHtml(categoria)}</span>
        ${fornecedorTag}
      </div>
    </div>
    <span class="edit-hint" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </span>
  </div>`;
}

// --- Aba Venda (cardápio, por categoria, sem número de estoque) ---

// T4/T13: Enter no campo de busca adiciona ao carrinho se houver exatamente 1 resultado
function uxVendaEnter(e) {
  if (e.key !== 'Enter') return;
  // Lê o valor vivo do input (mais seguro que o estado global buscaVenda em composições IME)
  const termo = ((e.currentTarget || e.target).value || buscaVenda || '').trim().toLowerCase();
  if (!termo) return;
  const visiveis = produtosCache.filter(p => {
    if (!p.nome.toLowerCase().includes(termo)) return false;
    if (categoriaVenda && (p.categoria || Produtos.CATEGORIA_PADRAO) !== categoriaVenda) return false;
    return p.estoque > 0;
  });
  if (visiveis.length !== 1) return;
  e.preventDefault();
  alterarCarrinho(visiveis[0].id, 1);
  const campo = document.getElementById('campoBuscaVenda');
  if (campo) campo.value = '';
  buscaVenda = '';
  atualizarListaVenda();
  document.getElementById('campoBuscaVenda')?.focus();
}

let _timerFiltroVenda = null;
function aplicarFiltroVenda() {
  // Mesmo padrão de aplicarFiltroEstoque: lê os valores na hora, mas adia a
  // re-renderização — sem isso, catálogos grandes travavam a digitação.
  const campo = document.getElementById('campoBuscaVenda');
  const seletor = document.getElementById('seletorCategoriaVenda');
  buscaVenda = campo ? campo.value : '';
  categoriaVenda = seletor ? seletor.value : '';
  clearTimeout(_timerFiltroVenda);
  _timerFiltroVenda = setTimeout(atualizarListaVenda, 200);
}

function atualizarListaVenda() {
  const container = document.getElementById('listaVenda');
  if (!container) return;

  const termo = (buscaVenda || '').trim().toLowerCase();

  const filtrados = produtosCache.filter(p => {
    if (termo && !p.nome.toLowerCase().includes(termo)) return false;
    if (categoriaVenda && (p.categoria || Produtos.CATEGORIA_PADRAO) !== categoriaVenda) return false;
    return true;
  });

  if (filtrados.length === 0) {
    renderizarSeMudou(container, criarSemResultado('Nenhum produto aqui ainda', 'Adicione seu primeiro produto clicando em "Adicionar produto".'), 'venda');
    return;
  }

  const agrupado = {};

  filtrados.forEach(p => {
    const cat = p.categoria || Produtos.CATEGORIA_PADRAO;
    if (!agrupado[cat]) agrupado[cat] = [];
    agrupado[cat].push(p);
  });

  const categorias = Object.keys(agrupado).sort((a, b) =>
    a.localeCompare(b, 'pt-BR')
  );

  const html = categorias.map(cat => `
    <div class="venda-categoria">
      <h3 class="categoria-titulo">${escaparHtml(cat)}</h3>
      <div class="categoria-grid">
        ${agrupado[cat].map(cartaoProdutoVenda).join('')}
      </div>
    </div>
  `).join('');

  const mudou = renderizarSeMudou(container, html, 'venda');
  if (mudou) observarImagensLazy(container);
}
/** Card de venda (aba Venda): estilo cardápio — sem número de estoque, só nome, foto, preço e botão de vender. */
function cartaoProdutoVenda(produto) {
  const qtd = carrinho[produto.id] || 0;
  const ehPeso = produto.unidade === 'kg';
  const estoqueZerado = produto.estoque <= 0;
  const semMaisAdicionar = qtd >= produto.estoque;

  const img = produto.imagem
    ? imagemProdutoLazy(produto.imagem)
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  const idEscapado = escaparHtml(produto.id);

  let acoes;
  if (qtd > 0 && ehPeso) {
    // Produto por peso: em vez de +/-1 (que não faz sentido em kg), o
    // vendedor digita o peso exato pesado na balança.
    acoes = `
      <div class="qty-peso">
        <input type="number" class="input-peso" inputmode="decimal" step="0.001" min="0" max="${produto.estoque}"
          value="${qtd}" onchange="definirQuantidadeCarrinho('${idEscapado}', this.value)">
        <span class="unid-peso">kg</span>
        <button class="qtybtn" onclick="removerDoCarrinho('${idEscapado}')" title="Remover do carrinho">×</button>
      </div>`;
  } else if (qtd > 0) {
    acoes = `
      <button class="qtybtn" onclick="alterarCarrinho('${idEscapado}', -1)">−</button>
      <span class="qtd">${qtd}</span>
      <button class="qtybtn add" onclick="alterarCarrinho('${idEscapado}', 1)" ${semMaisAdicionar ? 'disabled' : ''}>+</button>`;
  } else {
    acoes = `
      <button class="sellbtn" onclick="${ehPeso ? `venderPeso('${idEscapado}')` : `alterarCarrinho('${idEscapado}', 1)`}" ${estoqueZerado ? 'disabled' : ''}>
        Vender
      </button>`;
  }

  return `
    <div class="product-card venda-card">
      ${img}

      <div class="info">
        <div class="name">${escaparHtml(produto.nome)}</div>
        <div class="meta">
          <span class="price">${formatarMoeda(produto.preco)}${ehPeso ? '/kg' : ''}</span>
          ${estoqueZerado ? `<span class="stock low">Esgotado</span>` : ''}
        </div>
      </div>

      <div class="actions">
        ${acoes}
      </div>
    </div>
  `;
}

// --- Aba Vendas ---

function barraFiltrosVendas() {
  return `
    <div class="filtros">
      <div class="chips chips-row">
        ${['todas', 'hoje', 'semana', 'mes'].map(p => `
          <button class="chip ${filtroVendas.periodo === p ? 'active' : ''}" onclick="definirFiltroVendas('periodo','${p}')">
            ${{ todas: 'Tudo', hoje: 'Hoje', semana: 'Semana', mes: 'Mês' }[p]}
          </button>`).join('')}
      </div>
      <div class="chips">
        ${['todas', 'ativas', 'canceladas'].map(s => `
          <button class="chip ${filtroVendas.status === s ? 'active' : ''}" onclick="definirFiltroVendas('status','${s}')">
            ${{ todas: 'Todas', ativas: 'Ativas', canceladas: 'Canceladas' }[s]}
          </button>`).join('')}
      </div>
    </div>
    ${resumoFinanceiro()}
    <div id="listaVendas"></div>`;
}

function definirFiltroVendas(chave, valor) {
  filtroVendas[chave] = valor;
  renderizarConteudo();
}

function resumoFinanceiro() {
  const vendasDoPeriodo = Vendas.filtrarVendas(vendasCache, { periodo: filtroVendas.periodo, status: 'todas' });
  const resumo = Vendas.calcularResumoFinanceiro(vendasDoPeriodo);
  if (vendasCache.length === 0) return '';

  return `<div class="resumo">
    <div class="linha-total">
      <span class="lbl">Total vendido</span>
      <span class="val">${formatarMoeda(resumo.totalVendido)}</span>
    </div>
    <div class="formas">
      <div class="forma"><span>Dinheiro</span><span>${formatarMoeda(resumo.porFormaPagamento.dinheiro)}</span></div>
      <div class="forma"><span>Pix</span><span>${formatarMoeda(resumo.porFormaPagamento.pix)}</span></div>
      <div class="forma"><span>Cartão</span><span>${formatarMoeda(resumo.porFormaPagamento.cartao)}</span></div>
      <div class="forma fiado"><span>Fiado em aberto</span><span>${formatarMoeda(resumo.totalFiadoEmAberto)}</span></div>
    </div>
  </div>`;
}

function atualizarListaVendas() {
  const container = document.getElementById('listaVendas');
  if (!container) return;
  const filtradas = Vendas.filtrarVendas(vendasCache, filtroVendas);
  let html;
  if (vendasCache.length === 0) {
    html = telaVaziaVendas();
  } else if (filtradas.length === 0) {
    html = criarSemResultado('Nenhuma venda encontrada', 'Tente outro período ou status.');
  } else {
    html = filtradas.map(linhaVenda).join('');
  }
  renderizarSeMudou(container, html, 'vendas');
}

function linhaVenda(venda) {
  const data = new Date(venda.data);
  const dataFormatada = data.toLocaleDateString('pt-BR') + ' · ' +
    data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nomesItens = venda.itens.map(i => `${Vendas.formatarQuantidadeItem(i)} ${i.nome}`).join(', ');
  const cancelada = venda.status === 'cancelada';
  const quitada = venda.status === 'quitada';
  const fiadoPendente = venda.formaPagamento === 'fiado' && venda.status === 'concluida';
  const rotuloPagamento = ROTULOS_PAGAMENTO[venda.formaPagamento] || ROTULOS_PAGAMENTO.dinheiro;

  return `<div class="sale-row ${cancelada ? 'cancelada' : ''}">
    <div>
      <div class="d">
        <span>${dataFormatada}</span>
        <span class="tag">${rotuloPagamento}</span>
        ${cancelada ? '<span class="tag cancelada">Cancelada</span>' : ''}
        ${quitada ? '<span class="tag quitada">Quitado</span>' : ''}
      </div>
      <div class="n">${escaparHtml(nomesItens)}</div>
      ${venda.cliente ? `<div class="cliente">${escaparHtml(venda.cliente)}</div>` : ''}
    </div>
    <div class="right">
      <div class="t">${formatarMoeda(venda.total)}</div>
      ${!cancelada ? `<button class="btnCancelarVenda" onclick="cancelarVendaComConfirmacao('${escaparHtml(venda.id)}')">Cancelar</button>` : ''}
      ${fiadoPendente ? `<button class="btnQuitarFiado" onclick="marcarFiadoQuitadoComConfirmacao('${escaparHtml(venda.id)}')">Marcar como quitado</button>` : ''}
    </div>
  </div>`;
}

async function marcarFiadoQuitadoComConfirmacao(id) {
  if (quitacaoEmAndamento.has(id)) return; // já está quitando essa venda
  if (!await mostrarConfirm('Marcar esta venda fiado como quitada (paga)? O estoque não será alterado.', { confirmText: 'Marcar como quitado', cancelText: 'Voltar' })) return;

  quitacaoEmAndamento.add(id);
  try {
    await Vendas.marcarFiadoQuitado(id);
    await recarregarDados();
    renderizarTudo();
    mostrarToast('Venda marcada como quitada.', 'sucesso');
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível marcar a venda como quitada. Verifique sua conexão e tente novamente.', 'erro');
  } finally {
    quitacaoEmAndamento.delete(id);
  }
}

/** Salva o novo nome da empresa (aba Conta) e atualiza a interface imediatamente em caso de sucesso. */
async function salvarNomeEmpresaConta(botao) {
  const input = document.getElementById('inputNomeEmpresaConta');
  const erroEl = document.getElementById('erroNomeEmpresaConta');
  if (!input) return;

  const novoNome = input.value.trim();
  if (erroEl) erroEl.style.display = 'none';

  if (!novoNome) {
    if (erroEl) {
      erroEl.textContent = 'Informe o nome da empresa.';
      erroEl.style.display = '';
    }
    return;
  }

  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Salvando…';

  try {
    const resultado = await DB.atualizarNomeEmpresa(novoNome);
    usuarioLogadoNomeEmpresa = resultado.nomeEmpresa;
    mostrarToast('Nome da empresa atualizado com sucesso.', 'sucesso');
    renderizarConteudo();
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message || 'Erro ao atualizar o nome da empresa.';
      erroEl.style.display = '';
    } else {
      mostrarToast(e.message || 'Erro ao atualizar o nome da empresa.', 'erro');
    }
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

async function fazerLogout() {
  if (!await mostrarConfirm('Sair da sua conta?', { confirmText: 'Sair', cancelText: 'Cancelar', tipo: 'perigo' })) return;
  try {
    // Encerra a sessão de verdade no servidor (apaga a linha em "sessoes" e
    // limpa o cookie), antes de voltar pra tela de login.
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // mesmo que a chamada falhe (ex: sem internet), ainda assim manda a
    // pessoa pro login — não faz sentido travar o logout por causa disso.
  }
  window.location.href = '/login.html';
}

let usuarioLogadoEmail = '';
let usuarioLogadoPapel = null; // null enquanto carrega; depois: 'dono' | 'vendedor' | 'estoquista'
let usuarioLogadoPlano = 'gratis'; // 'gratis' | 'equipe' — só importa pra quem é "dono"

async function cancelarVendaComConfirmacao(id) {
  if (cancelamentoEmAndamento.has(id)) return; // já está cancelando essa venda
  if (!await mostrarConfirm('Cancelar esta venda? O estoque dos produtos será devolvido.', { confirmText: 'Cancelar venda', cancelText: 'Voltar', tipo: 'perigo' })) return;

  cancelamentoEmAndamento.add(id);
  try {
    await Vendas.cancelarVenda(id);
    await recarregarDados();
    renderizarTudo();
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível cancelar a venda. Verifique sua conexão e tente novamente.', 'erro');
  } finally {
    cancelamentoEmAndamento.delete(id);
  }
}