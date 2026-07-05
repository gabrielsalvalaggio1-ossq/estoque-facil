/**
 * app.js
 * Interface: renderização de telas e eventos de clique.
 * Toda regra de negócio vive em produtos.js e vendas.js — aqui só chamamos.
 */

let produtosCache = [];
let vendasCache = [];
let carrinho = {}; // { produtoId: quantidade }
let abaAtual = 'estoque';
let idEmEdicao = null;
let formaPagamentoEscolhida = 'dinheiro';

let filtroEstoque = { busca: '', categoria: '', situacao: 'todos' };
let filtroVendas = { periodo: 'todas', status: 'todas' };
let buscaVenda = '';
let imagemPendente = null; // base64 da foto escolhida/tirada, ainda não salva
let streamScannerAtivo = null;
let unidadeSelecionada = 'un'; // 'un' | 'kg' — estado do toggle de unidade no formulário de produto

const ROTULOS_PAGAMENTO = {
  dinheiro: '💵 Dinheiro',
  pix: '🔑 Pix',
  cartao: '💳 Cartão',
  fiado: '📝 Fiado'
};

const ICONE_PRODUTO_PLACEHOLDER = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>`;

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function dataDeHoje() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function recarregarDados() {
  [produtosCache, vendasCache] = await Promise.all([
    Produtos.listarProdutos(),
    Vendas.listarVendas()
  ]);
}

// --- Foto do produto ---

/**
 * Recebe um arquivo de imagem (foto tirada ou escolhida da galeria) e devolve
 * uma versão comprimida em base64. Redimensiona para no máximo 480px no lado
 * maior — suficiente para reconhecer o produto na lista, e mantém o
 * IndexedDB leve mesmo com dezenas de fotos cadastradas.
 */
function comprimirImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
      img.onload = () => {
        const ladoMaximo = 480;
        const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
        const largura = Math.round(img.width * escala);
        const altura = Math.round(img.height * escala);

        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, largura, altura);

        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

// --- Leitor de código de barras (câmera) ---

function suportaLeitorCodigoBarras() {
  return 'BarcodeDetector' in window;
}

/**
 * Abre a câmera e tenta ler um código de barras em tempo real usando a API
 * nativa do navegador (gratuita, sem serviço externo). Chama onDetectado(codigo)
 * assim que encontra um código válido e fecha sozinho.
 * Funciona em Chrome/Android e Chrome/Desktop. Não funciona no Safari/iPhone
 * (limitação do próprio navegador) — por isso sempre existe um campo de
 * digitação manual como alternativa em quem usa o código de barras.
 */
async function abrirScanner(onDetectado) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap scanner-wrap';
  wrap.id = 'scannerWrap';

  if (!suportaLeitorCodigoBarras()) {
    wrap.innerHTML = `
      <div class="scanner-box">
        <p class="rlabel">Leitor de código de barras</p>
        <h2>Não disponível neste navegador</h2>
        <p class="hint" style="margin-bottom:18px;">
          A leitura por câmera funciona no Chrome (Android ou computador).
          Não é suportada no Safari/iPhone. Você pode digitar o código manualmente:
        </p>
        <div class="field">
          <input id="fCodigoManual" type="text" inputmode="numeric" placeholder="Digite o código de barras">
        </div>
        <div class="modal-actions">
          <button class="btn ghost" id="btnFecharScanner">Cancelar</button>
          <button class="btn primary" id="btnUsarCodigoManual">Usar este código</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById('btnFecharScanner').addEventListener('click', () => wrap.remove());
    document.getElementById('btnUsarCodigoManual').addEventListener('click', () => {
      const codigo = document.getElementById('fCodigoManual').value.trim();
      wrap.remove();
      if (codigo) onDetectado(codigo);
    });
    return;
  }

  wrap.innerHTML = `
    <div class="scanner-box">
      <p class="rlabel">Aponte para o código de barras</p>
      <video id="scannerVideo" autoplay playsinline muted></video>
      <p class="hint" id="scannerStatus">Abrindo câmera…</p>
      <button class="btn ghost" id="btnFecharScanner" style="width:100%;">Cancelar</button>
    </div>`;
  document.body.appendChild(wrap);

  const encerrar = (resultado) => {
    if (streamScannerAtivo) {
      streamScannerAtivo.getTracks().forEach(t => t.stop());
      streamScannerAtivo = null;
    }
    wrap.remove();
    if (resultado) onDetectado(resultado);
  };

  document.getElementById('btnFecharScanner').addEventListener('click', () => encerrar(null));

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    streamScannerAtivo = stream;
    const video = document.getElementById('scannerVideo');
    video.srcObject = stream;

    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
    });

    const status = document.getElementById('scannerStatus');
    status.textContent = 'Procurando código…';

    const varrer = async () => {
      if (!streamScannerAtivo) return; // já foi encerrado
      try {
        const codigos = await detector.detect(video);
        if (codigos.length > 0) {
          encerrar(codigos[0].rawValue);
          return;
        }
      } catch (e) {
        // frame inválido momentâneo — ignora e tenta de novo
      }
      requestAnimationFrame(varrer);
    };
    requestAnimationFrame(varrer);
  } catch (erro) {
    document.getElementById('scannerStatus').textContent =
      'Não foi possível acessar a câmera. Verifique a permissão nas configurações do navegador.';
  }
}

/** Fluxo rápido de venda: escaneia e já adiciona 1 unidade do produto ao carrinho. */
function abrirScannerParaVender() {
  abrirScanner((codigo) => {
    const produto = Produtos.buscarPorCodigoBarras(produtosCache, codigo);
    if (!produto) {
      alert(`Nenhum produto cadastrado com o código ${codigo}.`);
      return;
    }
    if (produto.estoque <= 0) {
      alert(`${produto.nome} está sem estoque.`);
      return;
    }
    abaAtual = 'venda';
    if (produto.unidade === 'kg') {
      venderPeso(produto.id);
    } else {
      alterarCarrinho(produto.id, 1);
    }
    renderizarTudo();
  });
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
  return `
    <div class="filtros">
      <input type="text" id="campoBusca" class="campo-busca" placeholder="Buscar produto..."
        value="${escaparHtml(filtroEstoque.busca)}" oninput="aplicarFiltroEstoque()">
      ${categorias.length > 1 ? `
      <select id="seletorCategoria" class="filtro-select" onchange="aplicarFiltroEstoque()">
        <option value="">Todas as categorias</option>
        ${categorias.map(c => `<option value="${escaparHtml(c)}" ${c === filtroEstoque.categoria ? 'selected' : ''}>${escaparHtml(c)}</option>`).join('')}
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

function aplicarFiltroEstoque() {
  const campoBusca = document.getElementById('campoBusca');
  const seletorCategoria = document.getElementById('seletorCategoria');
  filtroEstoque.busca = campoBusca ? campoBusca.value : '';
  filtroEstoque.categoria = seletorCategoria ? seletorCategoria.value : '';
  atualizarListaProdutos();
}

function atualizarListaProdutos() {
  const container = document.getElementById('listaProdutos');
  if (!container) return;
  const filtrados = Produtos.filtrarProdutos(produtosCache, filtroEstoque);
  if (produtosCache.length === 0) {
    container.innerHTML = telaVaziaEstoque();
  } else if (filtrados.length === 0) {
    container.innerHTML = '<div class="sem-resultado">Nenhum produto encontrado com esse filtro.</div>';
  } else {
    container.innerHTML = filtrados.map(cartaoProdutoEstoque).join('');
  }
}

function telaVaziaEstoque() {
  return `<div class="empty">
    <p class="titulo">Nenhum produto ainda</p>
    <p class="hint">Toque em "Adicionar produto" para cadastrar seu primeiro item.</p>
  </div>`;
}

function telaVaziaVendas() {
  return `<div class="empty">
    <p class="titulo">Nenhuma venda registrada</p>
    <p class="hint">Suas cobranças aparecem aqui.</p>
  </div>`;
}

/** Formata a quantidade em estoque de forma explícita quanto à unidade: '12 un' ou '2,500 kg'. */
function formatarQuantidadeEstoque(produto) {
  if (produto.unidade === 'kg') {
    return Number(produto.estoque).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
  }
  return produto.estoque + ' un';
}

/** Card de gestão (aba Estoque): mostra quantidade, sem botão de vender — toque para editar. */
function cartaoProdutoEstoque(produto) {
  const estoqueBaixo = produto.estoque <= (produto.estoqueMinimo || 0);
  const categoria = produto.categoria || Produtos.CATEGORIA_PADRAO;
  const miniatura = produto.imagem
    ? `<img src="${produto.imagem}" alt="" class="thumb">`
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  return `<div class="product-card" onclick="abrirEdicao('${produto.id}')">
    ${miniatura}
    <div class="info">
      <div class="name">${escaparHtml(produto.nome)}</div>
      <div class="meta">
        <span class="price">${formatarMoeda(produto.preco)}${produto.unidade === 'kg' ? '/kg' : ''}</span>
        <span class="stock ${estoqueBaixo ? 'low' : ''}">${formatarQuantidadeEstoque(produto)} em estoque</span>
        <span class="cat">${escaparHtml(categoria)}</span>
      </div>
    </div>
    <span class="edit-hint" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    </span>
  </div>`;
}

// --- Aba Venda (cardápio, por categoria, sem número de estoque) ---

function aplicarFiltroVenda() {
  const campo = document.getElementById('campoBuscaVenda');
  buscaVenda = campo ? campo.value : '';
  atualizarListaVenda();
}

function atualizarListaVenda() {
  const container = document.getElementById('listaVenda');
  if (!container) return;

  const termo = (buscaVenda || '').trim().toLowerCase();

  const filtrados = termo
    ? produtosCache.filter(p => p.nome.toLowerCase().includes(termo))
    : produtosCache;

  if (filtrados.length === 0) {
    container.innerHTML = '<div class="sem-resultado">Nenhum produto encontrado.</div>';
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

  container.innerHTML = categorias.map(cat => `
    <div class="venda-categoria">
      <h3 class="categoria-titulo">${escaparHtml(cat)}</h3>
      <div class="categoria-grid">
        ${agrupado[cat].map(cartaoProdutoVenda).join('')}
      </div>
    </div>
  `).join('');
}
/** Card de venda (aba Venda): estilo cardápio — sem número de estoque, só nome, foto, preço e botão de vender. */
function cartaoProdutoVenda(produto) {
  const qtd = carrinho[produto.id] || 0;
  const ehPeso = produto.unidade === 'kg';
  const estoqueZerado = produto.estoque <= 0;
  const semMaisAdicionar = qtd >= produto.estoque;

  const img = produto.imagem
    ? `<img src="${produto.imagem}" class="thumb">`
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  let acoes;
  if (qtd > 0 && ehPeso) {
    // Produto por peso: em vez de +/-1 (que não faz sentido em kg), o
    // vendedor digita o peso exato pesado na balança.
    acoes = `
      <div class="qty-peso">
        <input type="number" class="input-peso" inputmode="decimal" step="0.001" min="0" max="${produto.estoque}"
          value="${qtd}" onchange="definirQuantidadeCarrinho('${produto.id}', this.value)">
        <span class="unid-peso">kg</span>
        <button class="qtybtn" onclick="removerDoCarrinho('${produto.id}')" title="Remover do carrinho">×</button>
      </div>`;
  } else if (qtd > 0) {
    acoes = `
      <button class="qtybtn" onclick="alterarCarrinho('${produto.id}', -1)">−</button>
      <span class="qtd">${qtd}</span>
      <button class="qtybtn add" onclick="alterarCarrinho('${produto.id}', 1)" ${semMaisAdicionar ? 'disabled' : ''}>+</button>`;
  } else {
    acoes = `
      <button class="sellbtn" onclick="${ehPeso ? `venderPeso('${produto.id}')` : `alterarCarrinho('${produto.id}', 1)`}" ${estoqueZerado ? 'disabled' : ''}>
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
  if (vendasCache.length === 0) {
    container.innerHTML = telaVaziaVendas();
  } else if (filtradas.length === 0) {
    container.innerHTML = '<div class="sem-resultado">Nenhuma venda encontrada com esse filtro.</div>';
  } else {
    container.innerHTML = filtradas.map(linhaVenda).join('');
  }
}

function linhaVenda(venda) {
  const data = new Date(venda.data);
  const dataFormatada = data.toLocaleDateString('pt-BR') + ' · ' +
    data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nomesItens = venda.itens.map(i => `${Vendas.formatarQuantidadeItem(i)} ${i.nome}`).join(', ');
  const cancelada = venda.status === 'cancelada';
  const rotuloPagamento = ROTULOS_PAGAMENTO[venda.formaPagamento] || ROTULOS_PAGAMENTO.dinheiro;

  return `<div class="sale-row ${cancelada ? 'cancelada' : ''}">
    <div>
      <div class="d">
        <span>${dataFormatada}</span>
        <span class="tag">${rotuloPagamento}</span>
        ${cancelada ? '<span class="tag cancelada">Cancelada</span>' : ''}
      </div>
      <div class="n">${escaparHtml(nomesItens)}</div>
      ${venda.cliente ? `<div class="cliente">${escaparHtml(venda.cliente)}</div>` : ''}
    </div>
    <div class="right">
      <div class="t">${formatarMoeda(venda.total)}</div>
      ${!cancelada ? `<button class="btnCancelarVenda" onclick="cancelarVendaComConfirmacao('${venda.id}')">Cancelar</button>` : ''}
    </div>
  </div>`;
}

function fazerLogout() {
  if (!confirm('Sair da sua conta?')) return;
  // Endpoint padrão do Cloudflare Access: limpa o cookie de sessão (CF_Authorization)
  // e leva de volta para a tela de login.
  window.location.href = '/cdn-cgi/access/logout';
}

let usuarioLogadoEmail = '';
let usuarioLogadoPapel = 'dono'; // 'dono' | 'vendedor' | 'estoquista' — padrão otimista até a API responder
let usuarioLogadoPlano = 'gratis'; // 'gratis' | 'equipe' — só importa pra quem é "dono"

async function cancelarVendaComConfirmacao(id) {
  if (cancelamentoEmAndamento.has(id)) return; // já está cancelando essa venda
  if (!confirm('Cancelar esta venda? O estoque dos produtos será devolvido.')) return;

  cancelamentoEmAndamento.add(id);
  try {
    await Vendas.cancelarVenda(id);
    await recarregarDados();
    renderizarTudo();
  } catch (erro) {
    alert(erro.message || 'Não foi possível cancelar a venda. Verifique sua conexão e tente novamente.');
  } finally {
    cancelamentoEmAndamento.delete(id);
  }
}

// --- Render geral ---

function renderizarConteudo() {
  const main = document.getElementById('main');

  if (abaAtual === 'estoque') {
    main.innerHTML = barraFiltrosEstoque();
    atualizarListaProdutos();
  }

else if (abaAtual === 'venda') {
  main.innerHTML = `
    <div class="page-venda">
      <div class="venda-topbar">
        <input 
          id="campoBuscaVenda"
          type="text"
          placeholder="Buscar produto..."
          oninput="aplicarFiltroVenda()"
          class="campo-busca"
        />
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

  else if (abaAtual === 'conta') {
    main.innerHTML = `
      <div class="page">
        <h2>👤 Minha Conta</h2>

        <div class="card-info">
          <p><strong>Logado como:</strong> ${escaparHtml(usuarioLogadoEmail || 'Carregando…')}</p>
          <button type="button" class="btn danger" id="btnLogout" style="width:auto;padding:9px 16px;margin-top:10px;">Sair da conta</button>
        </div>

        <div class="card-info">
          <p><strong>Produtos cadastrados:</strong> ${produtosCache.length}</p>
          <p><strong>Vendas registradas:</strong> ${vendasCache.length}</p>
          <p><strong>Status:</strong> Sistema ativo</p>
        </div>

        <div class="card-info">
          <h3>Resumo rápido</h3>
          <p>Total em vendas hoje: ${formatarMoeda(Vendas.calcularVendasDoDia(vendasCache))}</p>
          <p>Total no mês: ${formatarMoeda(Vendas.calcularVendasDoMes(vendasCache))}</p>
        </div>

        ${usuarioLogadoPapel === 'dono' ? cartaoGestaoEquipeHtml() : ''}
      </div>
    `;
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', fazerLogout);

    if (usuarioLogadoPapel === 'dono') {
      inicializarGestaoEquipe();
    }
  }

  else if (abaAtual === 'contato') {
    main.innerHTML = `
      <div class="page">
        <h2>📞 Contato e Suporte</h2>

        <div class="card-info">
          <p>Suporte do sistema</p>
          <p><strong>Email:</strong> gabriel.salvasantos@gmail.com</p>
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

// --- Modal de produto ---

function abrirModalProduto(produto) {
  idEmEdicao = produto ? produto.id : null;
  imagemPendente = produto ? (produto.imagem || null) : null;
  unidadeSelecionada = produto && produto.unidade === 'kg' ? 'kg' : 'un';
  const categorias = Produtos.listarCategorias(produtosCache);

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'productModalWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>${produto ? 'Editar produto' : 'Novo produto'}</h2>

      <div class="foto-area">
        <div class="foto-preview" id="fotoPreview">
          ${imagemPendente ? `<img src="${imagemPendente}" alt="">` : ICONE_PRODUTO_PLACEHOLDER}
        </div>
        <div class="foto-botoes">
          <button type="button" class="btn ghost btn-sm" id="btnTirarFoto">📷 Tirar foto</button>
          <button type="button" class="btn ghost btn-sm" id="btnGaleria">🖼 Galeria</button>
          ${imagemPendente ? '<button type="button" class="btn ghost btn-sm" id="btnRemoverFoto">Remover</button>' : ''}
        </div>
        <input type="file" accept="image/*" capture="environment" id="inputFotoCamera" hidden>
        <input type="file" accept="image/*" id="inputFotoGaleria" hidden>
      </div>

      <div class="field">
        <label for="fNome">Nome do produto</label>
        <input id="fNome" type="text" placeholder="Ex: Brigadeiro" value="${produto ? escaparHtml(produto.nome) : ''}">
      </div>

      <div class="field">
        <label>Vendido por</label>
        <div class="unidade-toggle" id="unidadeToggle">
          <button type="button" class="unidade-opt ${(!produto || produto.unidade !== 'kg') ? 'selected' : ''}" data-unidade="un">Unidade</button>
          <button type="button" class="unidade-opt ${(produto && produto.unidade === 'kg') ? 'selected' : ''}" data-unidade="kg">Peso (kg)</button>
        </div>
      </div>

      <div class="row2">
        <div class="field">
          <label id="lblPreco" for="fPreco">Preço (R$)</label>
          <input id="fPreco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" value="${produto ? produto.preco : ''}">
        </div>
        <div class="field">
          <label id="lblEstoque" for="fEstoque">Quantidade</label>
          <input id="fEstoque" type="number" inputmode="decimal" step="${produto && produto.unidade === 'kg' ? '0.001' : '1'}" min="0" placeholder="0" value="${produto ? produto.estoque : ''}">
        </div>
      </div>
      <p class="hint-unidade" id="hintUnidade" style="display:${produto && produto.unidade === 'kg' ? 'block' : 'none'};">Preço por kg. Quantidade em estoque também em kg (ex: 12.5).</p>

      <button type="button" class="link-mais-opcoes" id="btnMaisOpcoes">+ Mais opções (categoria, código de barras, aviso de estoque)</button>

      <div class="opcoes-avancadas" id="opcoesAvancadas" hidden>
        <div class="row2">
          <div class="field">
            <label for="fMinimo">Avisar com estoque em</label>
            <input id="fMinimo" type="number" inputmode="numeric" min="0" placeholder="Ex: 5" value="${produto && produto.estoqueMinimo ? produto.estoqueMinimo : ''}">
          </div>
          <div class="field">
            <label for="fCategoria">Categoria</label>
            <input id="fCategoria" type="text" list="listaCategorias" placeholder="Ex: Bebidas"
              value="${produto ? escaparHtml(produto.categoria || Produtos.CATEGORIA_PADRAO) : ''}">
            <datalist id="listaCategorias">
              ${categorias.map(c => `<option value="${escaparHtml(c)}">`).join('')}
            </datalist>
          </div>
        </div>
        <div class="field">
          <label for="fCodigoBarras">Código de barras</label>
          <div class="input-com-botao">
            <input id="fCodigoBarras" type="text" inputmode="numeric" placeholder="Digite ou escaneie"
              value="${produto ? escaparHtml(produto.codigoBarras || '') : ''}">
            <button type="button" class="btn-scan" id="btnEscanearNoForm" title="Escanear código de barras" aria-label="Escanear código de barras">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
            </button>
          </div>
        </div>
      </div>

      <p class="erro" id="erroForm" style="display:none;"></p>
      <div class="modal-actions">
        ${produto ? '<button class="btn danger" id="btnExcluir">Excluir</button>' : '<button class="btn ghost" id="btnCancelar">Cancelar</button>'}
        <button class="btn primary" id="btnSalvar">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModal(); });
  document.getElementById('btnSalvar').addEventListener('click', salvarFormularioProduto);

  document.getElementById('unidadeToggle').addEventListener('click', (e) => {
    const botao = e.target.closest('.unidade-opt');
    if (!botao) return;
    unidadeSelecionada = botao.dataset.unidade;
    atualizarCamposUnidade();
  });
  atualizarCamposUnidade();

  document.getElementById('btnMaisOpcoes').addEventListener('click', (e) => {
    const painel = document.getElementById('opcoesAvancadas');
    const abrir = painel.hidden;
    painel.hidden = !abrir;
    e.target.textContent = abrir ? '– Ocultar opções' : '+ Mais opções (categoria, código de barras, aviso de estoque)';
  });
  // Se o produto já tem categoria personalizada, código de barras ou mínimo definido, mostra aberto.
  if (produto && (produto.categoria || produto.estoqueMinimo || produto.codigoBarras)) {
    document.getElementById('opcoesAvancadas').hidden = false;
    document.getElementById('btnMaisOpcoes').textContent = '– Ocultar opções';
  }

  // --- Foto ---
  const inputCamera = document.getElementById('inputFotoCamera');
  const inputGaleria = document.getElementById('inputFotoGaleria');
  document.getElementById('btnTirarFoto').addEventListener('click', () => inputCamera.click());
  document.getElementById('btnGaleria').addEventListener('click', () => inputGaleria.click());

  const processarArquivoFoto = async (input) => {
    const arquivo = input.files && input.files[0];
    if (!arquivo) return;
    try {
      imagemPendente = await comprimirImagem(arquivo);
      atualizarPreviewFoto();
    } catch (e) {
      alert('Não foi possível usar essa foto. Tente outra.');
    }
  };
  inputCamera.addEventListener('change', () => processarArquivoFoto(inputCamera));
  inputGaleria.addEventListener('change', () => processarArquivoFoto(inputGaleria));

  const btnRemoverFoto = document.getElementById('btnRemoverFoto');
  if (btnRemoverFoto) btnRemoverFoto.addEventListener('click', () => {
    imagemPendente = null;
    atualizarPreviewFoto();
  });

  // --- Código de barras ---
  document.getElementById('btnEscanearNoForm').addEventListener('click', () => {
    abrirScanner((codigo) => {
      document.getElementById('fCodigoBarras').value = codigo;
    });
  });

  const btnCancelar = document.getElementById('btnCancelar');
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);

  const btnExcluir = document.getElementById('btnExcluir');
  if (btnExcluir) btnExcluir.addEventListener('click', () => excluirProdutoComConfirmacao(produto.id));

  setTimeout(() => document.getElementById('fNome').focus(), 50);
}

/** Atualiza a área de pré-visualização da foto e os botões (mostra/some "Remover"). */
function atualizarPreviewFoto() {
  const preview = document.getElementById('fotoPreview');
  preview.innerHTML = imagemPendente ? `<img src="${imagemPendente}" alt="">` : ICONE_PRODUTO_PLACEHOLDER;

  const botoesWrap = document.querySelector('.foto-botoes');
  const jaTemRemover = document.getElementById('btnRemoverFoto');
  if (imagemPendente && !jaTemRemover) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost btn-sm';
    btn.id = 'btnRemoverFoto';
    btn.textContent = 'Remover';
    btn.addEventListener('click', () => { imagemPendente = null; atualizarPreviewFoto(); });
    botoesWrap.appendChild(btn);
  } else if (!imagemPendente && jaTemRemover) {
    jaTemRemover.remove();
  }
}

/**
 * Aplica o efeito de escolher "Unidade" ou "Peso (kg)" no formulário:
 * marca o botão certo como selecionado, ajusta o campo de quantidade para
 * aceitar decimais quando for peso, troca os rótulos e mostra/esconde a dica.
 */
function atualizarCamposUnidade() {
  document.querySelectorAll('#unidadeToggle .unidade-opt').forEach(botao => {
    botao.classList.toggle('selected', botao.dataset.unidade === unidadeSelecionada);
  });

  const ehPeso = unidadeSelecionada === 'kg';

  const campoEstoque = document.getElementById('fEstoque');
  if (campoEstoque) {
    campoEstoque.step = ehPeso ? '0.001' : '1';
    campoEstoque.placeholder = ehPeso ? '0,000' : '0';
  }

  const lblPreco = document.getElementById('lblPreco');
  if (lblPreco) lblPreco.textContent = ehPeso ? 'Preço por kg (R$)' : 'Preço (R$)';

  const lblEstoque = document.getElementById('lblEstoque');
  if (lblEstoque) lblEstoque.textContent = ehPeso ? 'Quantidade (kg)' : 'Quantidade';

  const hint = document.getElementById('hintUnidade');
  if (hint) hint.style.display = ehPeso ? 'block' : 'none';
}

function fecharModal() {
  const el = document.getElementById('productModalWrap');
  if (el) el.remove();
}

function mostrarErroFormulario(mensagem) {
  const erro = document.getElementById('erroForm');
  erro.textContent = mensagem;
  erro.style.display = 'block';
}

// --- Gestão de equipe (aba Conta, só visível pra "dono") ---

// Guarda a última lista de membros carregada, pra poder referenciar cada
// linha por índice nos cliques de remover/confirmar sem precisar escapar
// e-mails em seletores CSS.
let membrosEquipeCache = [];

const ROTULOS_PAPEL = { dono: 'Dono', vendedor: 'Vendedor', estoquista: 'Estoquista' };

// Espelha os limites do backend (functions/api/[[path]].js) só pra exibição —
// quem decide de verdade se pode adicionar mais gente é sempre a API.
const PLANOS_INFO = {
  gratis: { rotulo: 'Grátis', maxMembros: 1 },
  equipe: { rotulo: 'Equipe', maxMembros: 5 },
};

function cartaoGestaoEquipeHtml() {
  const plano = PLANOS_INFO[usuarioLogadoPlano] || PLANOS_INFO.gratis;
  return `
    <div class="card-info">
      <h3>Gestão de equipe</h3>
      <p class="team-plano">
        Plano atual: <strong>${escaparHtml(plano.rotulo)}</strong>
        <span>· até ${plano.maxMembros} pessoa${plano.maxMembros > 1 ? 's' : ''} na equipe</span>
      </p>

      <div id="listaMembros">
        <p class="team-msg">Carregando…</p>
      </div>

      <div class="field" style="margin-top:16px;">
        <label for="fMembroEmail">E-mail do funcionário</label>
        <input id="fMembroEmail" type="email" placeholder="pessoa@exemplo.com" autocomplete="off">
      </div>
      <div class="field">
        <label for="fMembroPapel">Papel</label>
        <select id="fMembroPapel" class="filtro-select">
          <option value="vendedor">Vendedor</option>
          <option value="estoquista">Estoquista</option>
        </select>
      </div>

      <p class="erro" id="erroEquipe" style="display:none;"></p>
      <button type="button" class="btn primary" id="btnAdicionarMembro" style="width:100%;">Adicionar</button>
    </div>
  `;
}

function inicializarGestaoEquipe() {
  carregarListaMembros();
  const btnAdicionar = document.getElementById('btnAdicionarMembro');
  if (btnAdicionar) btnAdicionar.addEventListener('click', adicionarMembroDaEquipe);
}

function linhaMembroHtml(membro, indice) {
  const rotulo = ROTULOS_PAPEL[membro.papel] || membro.papel;
  const ehEuMesmo = (membro.email || '').toLowerCase() === (usuarioLogadoEmail || '').toLowerCase();

  return `
    <div class="team-row" id="teamRow${indice}">
      <div class="team-info">
        <span class="team-email">${escaparHtml(membro.email)}</span>
        <span class="tag ${escaparHtml(membro.papel)}">${escaparHtml(rotulo)}</span>
      </div>
      ${ehEuMesmo ? '' : `
        <div class="team-actions">
          <button type="button" class="btn-remover-membro" data-indice="${indice}">Remover</button>
        </div>
      `}
    </div>
  `;
}

async function carregarListaMembros() {
  const container = document.getElementById('listaMembros');
  if (!container) return;
  container.innerHTML = '<p class="team-msg">Carregando…</p>';

  try {
    membrosEquipeCache = await DB.listarMembros();
    if (membrosEquipeCache.length === 0) {
      container.innerHTML = '<p class="team-msg">Nenhum membro cadastrado ainda.</p>';
      return;
    }
    container.innerHTML = membrosEquipeCache.map((m, i) => linhaMembroHtml(m, i)).join('');
    container.querySelectorAll('.btn-remover-membro').forEach(botao => {
      botao.addEventListener('click', () => pedirConfirmacaoRemoverMembro(Number(botao.dataset.indice)));
    });
  } catch (erro) {
    container.innerHTML = `<p class="erro" style="margin:0;">${escaparHtml(erro.message || 'Não foi possível carregar a equipe.')}</p>`;
  }
}

function pedirConfirmacaoRemoverMembro(indice) {
  const membro = membrosEquipeCache[indice];
  const linha = document.getElementById(`teamRow${indice}`);
  if (!membro || !linha) return;

  linha.innerHTML = `
    <div class="team-confirm">
      <span>Remover ${escaparHtml(membro.email)} da equipe?</span>
      <button type="button" class="btn-confirmar-sim" data-indice="${indice}">Remover</button>
      <button type="button" class="btn-confirmar-nao" data-indice="${indice}">Cancelar</button>
    </div>
  `;
  linha.querySelector('.btn-confirmar-sim').addEventListener('click', () => confirmarRemoverMembro(indice));
  linha.querySelector('.btn-confirmar-nao').addEventListener('click', () => carregarListaMembros());
}

async function confirmarRemoverMembro(indice) {
  const membro = membrosEquipeCache[indice];
  if (!membro) return;

  const linha = document.getElementById(`teamRow${indice}`);
  const btnSim = linha ? linha.querySelector('.btn-confirmar-sim') : null;
  if (btnSim) {
    btnSim.disabled = true;
    btnSim.textContent = 'Removendo…';
  }

  try {
    await DB.removerMembro(membro.email);
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível remover esse membro.');
    await carregarListaMembros();
  }
}

async function adicionarMembroDaEquipe() {
  const btn = document.getElementById('btnAdicionarMembro');
  if (!btn || btn.disabled) return;
  limparErroEquipe();

  const campoEmail = document.getElementById('fMembroEmail');
  const campoPapel = document.getElementById('fMembroPapel');
  const email = campoEmail.value.trim();
  const papel = campoPapel.value;

  if (!email || !email.includes('@')) {
    mostrarErroEquipe('Informe um e-mail válido.');
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Adicionando…';

  try {
    await DB.adicionarMembro(email, papel);
    campoEmail.value = '';
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível adicionar esse membro.');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function mostrarErroEquipe(mensagem) {
  const erro = document.getElementById('erroEquipe');
  if (!erro) return;
  erro.textContent = mensagem;
  erro.style.display = 'block';
}

function limparErroEquipe() {
  const erro = document.getElementById('erroEquipe');
  if (!erro) return;
  erro.style.display = 'none';
  erro.textContent = '';
}

async function salvarFormularioProduto() {
  const btnSalvar = document.getElementById('btnSalvar');
  if (btnSalvar.disabled) return; // já está salvando — ignora cliques repetidos
  btnSalvar.disabled = true;
  const textoOriginal = btnSalvar.textContent;
  btnSalvar.textContent = 'Salvando…';

  const nome = document.getElementById('fNome').value.trim();
  const preco = parseFloat(document.getElementById('fPreco').value);
  // Produtos vendidos por peso aceitam quantidade decimal (ex: 12.5 kg);
  // produtos por unidade continuam em número inteiro.
  const estoque = unidadeSelecionada === 'kg'
    ? parseFloat(document.getElementById('fEstoque').value)
    : parseInt(document.getElementById('fEstoque').value, 10);
  const campoMinimo = document.getElementById('fMinimo');
  const campoCategoria = document.getElementById('fCategoria');
  const campoCodigo = document.getElementById('fCodigoBarras');
  const estoqueMinimo = campoMinimo ? parseInt(campoMinimo.value, 10) : NaN;
  const categoria = campoCategoria ? campoCategoria.value : '';
  const codigoBarras = campoCodigo ? campoCodigo.value.trim() : '';
  const unidade = unidadeSelecionada;

  try {
    if (idEmEdicao) {
      await Produtos.editarProduto(idEmEdicao, { nome, preco, estoque, estoqueMinimo, categoria, imagem: imagemPendente, codigoBarras, unidade });
    } else {
      await Produtos.criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, imagem: imagemPendente, codigoBarras, unidade });
    }
    await recarregarDados();
    fecharModal();
    renderizarTudo();
  } catch (erro) {
    mostrarErroFormulario(erro.message || 'Não foi possível salvar. Verifique sua conexão e tente novamente.');
    btnSalvar.disabled = false;
    btnSalvar.textContent = textoOriginal;
  }
}

async function excluirProdutoComConfirmacao(id) {
  if (!confirm('Excluir este produto do estoque?')) return;
  await Produtos.excluirProduto(id);
  delete carrinho[id];
  await recarregarDados();
  fecharModal();
  renderizarTudo();
}

function abrirEdicao(id) {
  const produto = produtosCache.find(p => p.id === id);
  if (produto) abrirModalProduto(produto);
}

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
  formaPagamentoEscolhida = 'dinheiro';

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

      <p class="pay-label">Nome do cliente (opcional)</p>
      <div class="field" style="margin-bottom:6px;">
        <input id="fCliente" type="text" placeholder="Ex: Dona Maria">
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

  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnVoltar').addEventListener('click', () => wrap.remove());

  document.getElementById('payOptions').addEventListener('click', e => {
    const botao = e.target.closest('.pay-btn');
    if (!botao) return;
    formaPagamentoEscolhida = botao.dataset.forma;
    document.querySelectorAll('#payOptions .pay-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.forma === formaPagamentoEscolhida);
    });
  });

  document.getElementById('btnConfirmar').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return; // já está processando — ignora cliques repetidos
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = 'Registrando venda…';

    const cliente = document.getElementById('fCliente').value;
    try {
      await Vendas.registrarVenda(itens, { formaPagamento: formaPagamentoEscolhida, cliente });
      carrinho = {};
      await recarregarDados();
      wrap.remove();
      renderizarTudo();
    } catch (erro) {
      alert(erro.message || 'Não foi possível registrar a venda. Verifique sua conexão e tente novamente.');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
}

// --- Exportações ---

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
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'exportWrap';
  wrap.innerHTML = `
    <div class="export-menu">
      <h2>Exportar dados</h2>
      <p class="hint">Escolha o que você quer baixar em planilha (CSV).</p>
      <button class="opt" id="expEstoque">Estoque atual<span class="d">Produto, categoria, quantidade e histórico de entradas/saídas</span></button>
      <button class="opt" id="expMovimentos">Movimentações<span class="d">Todo histórico de entradas e saídas, com data e motivo</span></button>
      <button class="opt" id="expVendas">Vendas do período<span class="d">Respeita o filtro de período aberto na aba Histórico</span></button>
      <button class="opt" id="expClientes">Clientes<span class="d">Total de compras e valor gasto por cliente</span></button>
      <button class="btn ghost" id="btnFecharExport">Fechar</button>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnFecharExport').addEventListener('click', () => wrap.remove());

  document.getElementById('expEstoque').addEventListener('click', () => {
    if (produtosCache.length === 0) { alert('Cadastre ao menos um produto para exportar.'); return; }
    baixarCsv(`estoque-${dataArquivo}.csv`, Produtos.gerarCsvEstoque(produtosCache));
    wrap.remove();
  });

  document.getElementById('expMovimentos').addEventListener('click', async () => {
    const movimentos = await Produtos.listarMovimentos();
    if (movimentos.length === 0) { alert('Ainda não há movimentações registradas.'); return; }
    baixarCsv(`movimentacoes-${dataArquivo}.csv`, Produtos.gerarCsvMovimentos(movimentos));
    wrap.remove();
  });

  document.getElementById('expVendas').addEventListener('click', () => {
    const vendasDoPeriodo = Vendas.filtrarVendas(vendasCache, filtroVendas);
    if (vendasDoPeriodo.length === 0) { alert('Nenhuma venda no período selecionado na aba Histórico.'); return; }
    baixarCsv(`vendas-${dataArquivo}.csv`, Vendas.gerarCsvVendas(vendasDoPeriodo));
    wrap.remove();
  });

  document.getElementById('expClientes').addEventListener('click', () => {
    const historico = Vendas.calcularHistoricoClientes(vendasCache);
    if (historico.length === 0) { alert('Ainda não há vendas com nome de cliente registrado.'); return; }
    baixarCsv(`clientes-${dataArquivo}.csv`, Vendas.gerarCsvClientes(vendasCache));
    wrap.remove();
  });
}

// --- Onboarding (primeira utilização) ---

const CHAVE_ONBOARDING = 'estoqueFacilOnboardingVisto';

const PRODUTOS_EXEMPLO = [
  { nome: 'Coca-Cola lata', preco: 6, estoque: 24, estoqueMinimo: 6, categoria: 'Bebidas' },
  { nome: 'Salgado assado', preco: 7, estoque: 15, estoqueMinimo: 5, categoria: 'Salgados' },
  { nome: 'Água mineral 500ml', preco: 3, estoque: 30, estoqueMinimo: 8, categoria: 'Bebidas' },
  { nome: 'Brigadeiro', preco: 2.5, estoque: 20, estoqueMinimo: 5, categoria: 'Doces' }
];

function abrirOnboarding() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap modal-wrap-centro';
  wrap.id = 'onboardWrap';
  wrap.innerHTML = `
    <div class="onboard">
      <div class="emoji">👋</div>
      <h2>Bem-vindo(a) ao Meu Estoque</h2>
      <p>Cadastre produtos, venda em poucos toques e o estoque se atualiza sozinho. Quer começar vendo um exemplo pronto, ou prefere cadastrar do zero?</p>
      <button class="btn primary" id="btnExemplo">Carregar exemplo</button>
      <button class="btn ghost" id="btnZero">Começar do zero</button>
    </div>`;
  document.body.appendChild(wrap);

  const fechar = () => {
    localStorage.setItem(CHAVE_ONBOARDING, '1');
    wrap.remove();
  };

  document.getElementById('btnZero').addEventListener('click', fechar);
  document.getElementById('btnExemplo').addEventListener('click', async () => {
    for (const p of PRODUTOS_EXEMPLO) {
      await Produtos.criarProduto(p);
    }
    await recarregarDados();
    renderizarTudo();
    fechar();
  });
}

// --- Inicialização ---

document.querySelectorAll('[data-tab]').forEach(botao => {
  botao.addEventListener('click', () => {
    abaAtual = botao.dataset.tab;
    renderizarTudo();
  });
});

document.getElementById('btnAddProduct').addEventListener('click', () => abrirModalProduto(null));
document.getElementById('btnEscanearVender').addEventListener('click', abrirScannerParaVender);
document.getElementById('btnCobrar').addEventListener('click', abrirComprovante);
document.getElementById('btnExportar').addEventListener('click', abrirMenuExportar);
document.getElementById('btnExportarSidebar').addEventListener('click', abrirMenuExportar);

/**
 * Esconde as abas que o papel da pessoa logada não deveria ver:
 * vendedor só mexe em Venda, estoquista só mexe em Estoque, dono vê tudo.
 * Conta e Contato ficam liberados pra todo mundo.
 */
function aplicarRestricoesDePapel(papel) {
  const abasPorPapel = {
    dono: ['estoque', 'venda', 'historico', 'conta', 'contato'],
    vendedor: ['venda', 'conta', 'contato'],
    estoquista: ['estoque', 'conta', 'contato']
  };
  const permitidas = abasPorPapel[papel] || abasPorPapel.dono;

  document.querySelectorAll('[data-tab]').forEach(botao => {
    botao.style.display = permitidas.includes(botao.dataset.tab) ? '' : 'none';
  });

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
  document.getElementById('main').innerHTML = `<div class="empty">
    <p class="titulo">Carregando…</p>
    <p class="hint">Buscando seus dados.</p>
  </div>`;

  let usuario;
  try {
    usuario = await DB.buscarUsuarioLogado();
  } catch (erro) {
    document.getElementById('main').innerHTML = `<div class="empty">
      <p class="titulo">Não foi possível carregar seus dados</p>
      <p class="hint">${escaparHtml(erro.message || 'Verifique sua conexão e tente novamente.')}</p>
    </div>`;
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
  aplicarRestricoesDePapel(usuarioLogadoPapel);

  try {
    await recarregarDados();
  } catch (erro) {
    document.getElementById('main').innerHTML = `<div class="empty">
      <p class="titulo">Não foi possível carregar seus dados</p>
      <p class="hint">${escaparHtml(erro.message || 'Verifique sua conexão e tente novamente.')}</p>
    </div>`;
    return;
  }

  renderizarTudo();

  const jaViuOnboarding = localStorage.getItem(CHAVE_ONBOARDING);
  if (!jaViuOnboarding && produtosCache.length === 0 && vendasCache.length === 0) {
    abrirOnboarding();
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

iniciar();