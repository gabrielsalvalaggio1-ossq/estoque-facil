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

let filtroEstoque = { busca: '', categoria: '', fornecedor: '', situacao: 'todos', agrupar: 'nenhum' };
let filtroVendas = { periodo: 'todas', status: 'todas' };

// Estado do wizard de Importação de Produtos (ver seção "Importação de
// Produtos" mais abaixo). Fica em memória só durante o wizard aberto.
let estadoImportacao = null;
let buscaVenda = '';
let categoriaVenda = '';
let imagemPendente = null; // base64 da foto escolhida/tirada, ainda não salva
let streamScannerAtivo = null;
let unidadeSelecionada = 'un'; // 'un' | 'kg' — estado do toggle de unidade no formulário de produto

// --- Impressão de etiquetas (ver js/etiquetas.js pro motor de geração) ---
let modoSelecaoEtiquetas = false;
let produtosSelecionadosEtiquetas = new Set(); // ids dos produtos marcados
let usuarioLogadoNomeEmpresa = ''; // usado no campo opcional "nome da empresa" da etiqueta
let usuarioLogadoNomeDono = ''; // nome de quem criou a empresa (dono)

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

  // Carrega a assinatura em segundo plano só pra quem é dono — é quem vê o
  // pill de plano na Equipe e a aba Minha Assinatura. Erro aqui não deve
  // travar o resto do app (por isso não tem await bloqueando, nem throw).
  if (usuarioLogadoPapel === 'dono') {
    DB.buscarAssinatura().then(a => { assinaturaCache = a; }).catch(() => {});
  }
}

// --- Campo monetário com máscara brasileira (usado no Preço de Custo) ---

/**
 * Aplica, em tempo real, a máscara "1.234,56" enquanto a pessoa digita —
 * o mesmo padrão de campo de valor que qualquer sistema de PDV/ERP brasileiro
 * usa. Trata o que foi digitado como centavos (dígitos puros), então não
 * importa se a pessoa digita rápido ou cola um número: o resultado nunca
 * fica num formato inválido pra interpretar depois.
 */
function aplicarMascaraMoeda(input) {
  let digitos = input.value.replace(/\D/g, '');
  if (!digitos) { input.value = ''; return; }
  digitos = digitos.replace(/^0+(?=\d)/, '');
  while (digitos.length < 3) digitos = '0' + digitos;

  const centavos = digitos.slice(-2);
  const parteInteira = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  input.value = `${parteInteira},${centavos}`;
}

/** Converte "1.234,56" (string mascarada) pra 1234.56 (número, em reais). */
function valorMonetarioParaNumero(valorFormatado) {
  if (!valorFormatado || !valorFormatado.trim()) return null;
  const limpo = valorFormatado.trim().replace(/\./g, '').replace(',', '.');
  const numero = parseFloat(limpo);
  return isNaN(numero) ? null : numero;
}

/** Converte um número em reais pro formato mascarado, pra pré-preencher o campo ao editar. */
function numeroParaValorMonetario(numero) {
  if (numero === null || numero === undefined || isNaN(numero)) return '';
  return Number(numero).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (produtosCache.length === 0) {
    container.innerHTML = telaVaziaEstoque();
  } else if (filtrados.length === 0) {
    container.innerHTML = '<div class="sem-resultado">Nenhum produto encontrado com esse filtro.</div>';
  } else if (filtroEstoque.agrupar === 'categoria' || filtroEstoque.agrupar === 'fornecedor') {
    container.innerHTML = agruparProdutosEstoqueHtml(filtrados, filtroEstoque.agrupar);
  } else {
    container.innerHTML = filtrados.map(cartaoProdutoEstoque).join('');
  }
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

/** Card de gestão (aba Estoque): mostra quantidade, sem botão de vender — toque para editar.
 *  Em modo de seleção (impressão de etiquetas), o toque marca/desmarca em vez de abrir edição. */
function cartaoProdutoEstoque(produto) {
  const estoqueBaixo = produto.estoque <= (produto.estoqueMinimo || 0);
  const categoria = produto.categoria || Produtos.CATEGORIA_PADRAO;
  const fornecedorTag = (produto.fornecedor && String(produto.fornecedor).trim())
    ? `<span class="cat fornecedor-tag">${escaparHtml(produto.fornecedor)}</span>`
    : '';
  const miniatura = produto.imagem
    ? `<img src="${produto.imagem}" alt="" class="thumb">`
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  if (modoSelecaoEtiquetas) {
    const marcado = produtosSelecionadosEtiquetas.has(produto.id);
    return `<div class="product-card modo-selecao ${marcado ? 'selecionado' : ''}" onclick="alternarSelecaoProdutoEtiqueta('${produto.id}')">
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

  return `<div class="product-card" onclick="abrirEdicao('${produto.id}')">
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

function aplicarFiltroVenda() {
  const campo = document.getElementById('campoBuscaVenda');
  const seletor = document.getElementById('seletorCategoriaVenda');
  buscaVenda = campo ? campo.value : '';
  categoriaVenda = seletor ? seletor.value : '';
  atualizarListaVenda();
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

async function fazerLogout() {
  if (!confirm('Sair da sua conta?')) return;
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

// --- Modal de produto ---

function abrirModalProduto(produto) {
  idEmEdicao = produto ? produto.id : null;
  imagemPendente = produto ? (produto.imagem || null) : null;
  unidadeSelecionada = produto && produto.unidade === 'kg' ? 'kg' : 'un';
  const categorias = Produtos.listarCategorias(produtosCache);
  const fornecedores = Produtos.listarFornecedores(produtosCache);

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
          <input id="fPreco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" value="${produto ? produto.preco : ''}" oninput="avaliarAvisoCusto()">
        </div>
        <div class="field">
          <label id="lblEstoque" for="fEstoque">Quantidade</label>
          <input id="fEstoque" type="number" inputmode="decimal" step="${produto && produto.unidade === 'kg' ? '0.001' : '1'}" min="0" placeholder="0" value="${produto ? produto.estoque : ''}">
        </div>
      </div>
      <p class="hint-unidade" id="hintUnidade" style="display:${produto && produto.unidade === 'kg' ? 'block' : 'none'};">Preço por kg. Quantidade em estoque também em kg (ex: 12.5).</p>

      <button type="button" class="link-mais-opcoes" id="btnMaisOpcoes">+ Informações avançadas (custo, categoria, fornecedor, código de barras, aviso de estoque)</button>

      <div class="opcoes-avancadas" id="opcoesAvancadas" hidden>
        <p class="secao-avancada-titulo">Informações Avançadas</p>

        <div class="field">
          <label for="fPrecoCusto">Preço de custo (R$)</label>
          <div class="input-com-prefixo">
            <span class="prefixo-moeda">R$</span>
            <input id="fPrecoCusto" type="text" inputmode="decimal" placeholder="0,00"
              value="${produto && produto.precoCusto != null ? numeroParaValorMonetario(produto.precoCusto) : ''}"
              oninput="aplicarMascaraMoeda(this); avaliarAvisoCusto();">
          </div>
          <p class="hint-unidade" id="avisoCustoVenda" style="display:none;">Preço de custo maior que o preço de venda — confira os valores antes de salvar.</p>
          <p class="hint-unidade">Usado para calcular seu lucro. Deixe em branco se preferir não informar agora.</p>
        </div>

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
          <label for="fFornecedor">Fornecedor</label>
          <input id="fFornecedor" type="text" list="listaFornecedores" placeholder="Ex: Distribuidora Sul"
            value="${produto ? escaparHtml(produto.fornecedor || '') : ''}">
          <datalist id="listaFornecedores">
            ${fornecedores.map(f => `<option value="${escaparHtml(f)}">`).join('')}
          </datalist>
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

        <div class="bloco-dimensoes">
          <div class="dimensoes-titulo">
            <p class="secao-avancada-titulo">Dimensões do produto</p>
            <span class="tag-em-breve">Usado no frete da loja virtual</span>
          </div>
          <div class="dimensoes-grid">
            <div class="field">
              <label for="fPeso">Peso p/ envio</label>
              <input id="fPeso" type="number" inputmode="decimal" step="0.001" min="0" placeholder="0,000"
                value="${produto && produto.dimensoes && produto.dimensoes.peso != null ? produto.dimensoes.peso : ''}">
            </div>
            <div class="field">
              <label for="fAltura">Altura</label>
              <input id="fAltura" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00"
                value="${produto && produto.dimensoes && produto.dimensoes.altura != null ? produto.dimensoes.altura : ''}">
            </div>
            <div class="field">
              <label for="fLargura">Largura</label>
              <input id="fLargura" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00"
                value="${produto && produto.dimensoes && produto.dimensoes.largura != null ? produto.dimensoes.largura : ''}">
            </div>
            <div class="field">
              <label for="fComprimento">Comprimento</label>
              <input id="fComprimento" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00"
                value="${produto && produto.dimensoes && produto.dimensoes.comprimento != null ? produto.dimensoes.comprimento : ''}">
            </div>
          </div>
          <div class="dimensoes-unidade">
            <div class="field">
              <label for="fUnidadePeso">Unidade de peso</label>
              <select id="fUnidadePeso">
                <option value="kg" ${(!produto || !produto.dimensoes || !produto.dimensoes.unidadePeso || produto.dimensoes.unidadePeso === 'kg') ? 'selected' : ''}>kg</option>
                <option value="g" ${(produto && produto.dimensoes && produto.dimensoes.unidadePeso === 'g') ? 'selected' : ''}>g</option>
              </select>
            </div>
            <div class="field">
              <label for="fUnidadeMedida">Unidade de medida</label>
              <select id="fUnidadeMedida">
                <option value="cm" ${(!produto || !produto.dimensoes || !produto.dimensoes.unidadeMedida || produto.dimensoes.unidadeMedida === 'cm') ? 'selected' : ''}>cm</option>
                <option value="m" ${(produto && produto.dimensoes && produto.dimensoes.unidadeMedida === 'm') ? 'selected' : ''}>m</option>
              </select>
            </div>
          </div>
          <p class="hint-unidade">Peso e medidas da embalagem física, pra calcular o frete — não tem relação com "Vendido por: Peso (kg)" lá em cima, que é sobre como você cobra pelo produto. Tudo opcional, e só é usado quando a Loja Virtual estiver disponível.</p>
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
    e.target.textContent = abrir ? '– Ocultar informações avançadas' : '+ Informações avançadas (custo, categoria, fornecedor, código de barras, aviso de estoque)';
    if (abrir) avaliarAvisoCusto();
  });
  // Se o produto já tem custo, categoria personalizada, código de barras, mínimo ou dimensões definidas, mostra aberto.
  if (produto && (produto.precoCusto != null || produto.categoria || produto.fornecedor || produto.estoqueMinimo || produto.codigoBarras || (produto.dimensoes && Object.values(produto.dimensoes).some(v => v !== null && v !== undefined && v !== '')))) {
    document.getElementById('opcoesAvancadas').hidden = false;
    document.getElementById('btnMaisOpcoes').textContent = '– Ocultar informações avançadas';
    avaliarAvisoCusto();
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

/**
 * Aviso não-bloqueante: se o preço de custo digitado ficar maior que o
 * preço de venda, avisa a pessoa — mas não impede salvar (pode ser um
 * preço promocional temporário de verdade, quem decide é o dono da loja).
 */
function avaliarAvisoCusto() {
  const campoCusto = document.getElementById('fPrecoCusto');
  const campoPreco = document.getElementById('fPreco');
  const aviso = document.getElementById('avisoCustoVenda');
  if (!campoCusto || !campoPreco || !aviso) return;

  const custo = valorMonetarioParaNumero(campoCusto.value);
  const preco = parseFloat(campoPreco.value);
  const maiorQueVenda = custo !== null && !isNaN(preco) && custo > preco;
  aviso.style.display = maiorQueVenda ? 'block' : 'none';
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

// --- Minha assinatura (/api/assinatura) ---------------------------------

let assinaturaCache = null;

const ESTADO_ASSINATURA_UI = {
  ACTIVE:   { rotulo: 'Ativo',              classe: 'ativo' },
  TRIAL:    { rotulo: 'Ativo',              classe: 'ativo' },
  PAST_DUE: { rotulo: 'Pagamento pendente', classe: 'pendente' },
  CANCELED: { rotulo: 'Cancelado',          classe: 'cancelado' },
  EXPIRED:  { rotulo: 'Cancelado',          classe: 'cancelado' },
  // 'FREE' não é mais gravado como status (era um valor legado, confundia
  // plano com status de ciclo de vida) — mantido aqui só pra não quebrar
  // contas antigas que ainda tenham essa linha no banco.
  FREE:     { rotulo: 'Ativo',              classe: 'ativo' },
};

const PLANOS_CATALOGO = [
  { id: 'free',      nome: 'MEV Free',  precoTexto: 'R$ 0/mês' },
  { id: 'essencial', nome: 'Essencial', precoTexto: 'R$ 19,90/mês' },
  { id: 'pro',       nome: 'Pro',       precoTexto: 'R$ 39,90/mês' },
];

function formatarDataCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

async function carregarTelaAssinatura() {
  const container = document.getElementById('assinaturaContainer');
  if (!container) return;
  try {
    assinaturaCache = await DB.buscarAssinatura();
    container.innerHTML = telaAssinaturaHtml(assinaturaCache);
    inicializarAcoesAssinatura();
  } catch (erro) {
    container.innerHTML = `<div class="card-info"><p class="erro" style="margin:0;">${escaparHtml(erro.message || 'Não foi possível carregar sua assinatura.')}</p></div>`;
  }
}

function telaAssinaturaHtml(a) {
  const ehPlanoGratuito = a.planoId === 'free';
  // O plano FREE nunca deve exibir "cancelada": não há cobrança, então não
  // existe cancelamento de verdade nesse plano — só existe "upgrade" ou
  // "continuar no free". Isso protege a UI mesmo se algum dado antigo/
  // inconsistente ainda tiver um status diferente de ACTIVE gravado.
  const estado = ehPlanoGratuito
    ? { rotulo: 'Plano Gratuito', classe: 'gratis' }
    : (ESTADO_ASSINATURA_UI[a.status] || { rotulo: a.status, classe: 'gratis' });
  const emCanceladoOuExpirado = !ehPlanoGratuito && (a.status === 'CANCELED' || a.status === 'EXPIRED');

  const preco = a.planoId === 'free' || !a.precoCentavos
    ? 'Grátis'
    : formatarMoeda(a.precoCentavos / 100) + '/mês';

  const proximaCobranca = a.planoId === 'free'
    ? 'Não se aplica (plano grátis)'
    : emCanceladoOuExpirado
      ? 'Assinatura cancelada — sem próxima cobrança'
      : formatarDataCurta(a.dataExpiracao);

  const formaPagamento = a.planoId === 'free'
    ? 'Nenhuma — plano grátis não exige pagamento'
    : 'Cartão de crédito (gerenciado pelo seu gateway de pagamento)';

  const podeAgir = ehPlanoGratuito || a.status !== 'CANCELED';

  return `
    <div class="card-info card-plano-atual">
      <div class="plano-atual-topo">
        <div>
          <p class="plano-atual-nome">${escaparHtml(a.planoNome || NOME_PLANO_FALLBACK[a.planoId] || a.planoId)}</p>
          <p class="plano-atual-preco">${escaparHtml(preco)}</p>
        </div>
        <span class="status-pill status-${estado.classe}"><span class="dot"></span>${escaparHtml(estado.rotulo)}</span>
      </div>

      <div class="plano-atual-linha">
        <span class="lbl">Próxima cobrança</span>
        <span class="val">${escaparHtml(proximaCobranca)}</span>
      </div>
      <div class="plano-atual-linha">
        <span class="lbl">Forma de pagamento</span>
        <span class="val">${escaparHtml(formaPagamento)}</span>
      </div>
    </div>

    ${(!ehPlanoGratuito && a.status === 'PAST_DUE') ? `
      <div class="aviso-assinatura aviso-pendente">
        ⚠️ Não conseguimos confirmar seu último pagamento. Regularize para não perder acesso à escrita de dados.
      </div>` : ''}
    ${emCanceladoOuExpirado ? `
      <div class="aviso-assinatura aviso-cancelado">
        Sua assinatura está cancelada. Escolha um plano abaixo para reativar o sistema.
      </div>` : ''}

    <div class="card-info">
      <h3>Planos disponíveis</h3>
      <div class="lista-planos-troca">
        ${PLANOS_CATALOGO.map(p => `
          <div class="opcao-plano ${p.id === a.planoId && podeAgir ? 'atual' : ''}">
            <div>
              <p class="opcao-plano-nome">${escaparHtml(p.nome)}</p>
              <p class="opcao-plano-preco">${escaparHtml(p.precoTexto)}</p>
            </div>
            ${p.id === a.planoId && podeAgir
              ? '<span class="opcao-plano-tag">Plano atual</span>'
              : `<button type="button" class="btn ${p.id === 'free' ? '' : 'primary'} btn-trocar-plano" data-plano="${p.id}" style="width:auto;padding:8px 14px;">${emCanceladoOuExpirado ? 'Reativar' : (PLANOS_ORDEM[p.id] > PLANOS_ORDEM[a.planoId] ? 'Fazer upgrade' : 'Mudar para este')}</button>`
            }
          </div>
        `).join('')}
      </div>
      <p class="erro" id="erroAssinatura" style="display:none;margin-top:10px;"></p>
    </div>

    ${(podeAgir && !ehPlanoGratuito) ? `
      <div class="card-info" id="cardCancelarAssinatura">
        <h3>Cancelar assinatura</h3>
        <p style="font-size:13.5px;color:var(--ink-soft,#5B6259);margin:0 0 12px;">
          Você para de ser cobrado e perde acesso aos recursos pagos. Seus dados continuam salvos.
        </p>
        <button type="button" class="btn danger" id="btnCancelarAssinatura" style="width:auto;padding:9px 16px;">Cancelar assinatura</button>
      </div>
    ` : ''}
  `;
}

const NOME_PLANO_FALLBACK = { free: 'MEV Free', essencial: 'Essencial', pro: 'Pro' };
const PLANOS_ORDEM = { free: 0, essencial: 1, pro: 2 };

function inicializarAcoesAssinatura() {
  document.querySelectorAll('.btn-trocar-plano').forEach(botao => {
    botao.addEventListener('click', () => trocarPlanoAssinatura(botao.dataset.plano, botao));
  });

  const btnCancelar = document.getElementById('btnCancelarAssinatura');
  if (btnCancelar) btnCancelar.addEventListener('click', pedirConfirmacaoCancelarAssinatura);
}

function mostrarErroAssinatura(mensagem) {
  const el = document.getElementById('erroAssinatura');
  if (!el) return;
  el.textContent = mensagem;
  el.style.display = 'block';
}

async function trocarPlanoAssinatura(planoId, botao) {
  if (!planoId || (botao && botao.disabled)) return;
  const textoOriginal = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Aplicando…'; }

  try {
    await DB.mudarPlano(planoId);
    await carregarTelaAssinatura();
  } catch (erro) {
    mostrarErroAssinatura(erro.message || 'Não foi possível trocar de plano agora.');
    if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
  }
}

function pedirConfirmacaoCancelarAssinatura() {
  const card = document.getElementById('cardCancelarAssinatura');
  if (!card) return;
  card.innerHTML = `
    <h3>Cancelar assinatura</h3>
    <div class="team-confirm" style="justify-content:flex-start;">
      <span>Tem certeza? Você perde acesso aos recursos pagos imediatamente.</span>
      <button type="button" class="btn-confirmar-sim" id="btnConfirmarCancelar">Sim, cancelar</button>
      <button type="button" class="btn-confirmar-nao" id="btnVoltarCancelar">Voltar</button>
    </div>
  `;
  document.getElementById('btnConfirmarCancelar').addEventListener('click', confirmarCancelarAssinatura);
  document.getElementById('btnVoltarCancelar').addEventListener('click', carregarTelaAssinatura);
}

async function confirmarCancelarAssinatura() {
  const btn = document.getElementById('btnConfirmarCancelar');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  try {
    await DB.cancelarAssinatura('Cancelado pelo dono pela tela de assinatura');
    await carregarTelaAssinatura();
  } catch (erro) {
    mostrarErroAssinatura(erro.message || 'Não foi possível cancelar agora.');
    await carregarTelaAssinatura();
  }
}

const ROTULOS_PAPEL = { dono: 'Dono', vendedor: 'Vendedor', estoquista: 'Estoquista' };

// PLANOS_INFO legado foi removido — o pill de plano na Equipe agora lê
// direto de assinaturaCache (ver telaAssinaturaHtml / cartaoGestaoEquipeHtml),
// que é a mesma fonte de verdade da tela "Minha assinatura".

// Papel selecionado no toggle de "adicionar membro" (substitui o antigo <select>).
let papelEquipeSelecionado = 'vendedor';

function gerarIniciaisEmail(email) {
  const nomeParte = (email || '').split('@')[0] || '?';
  const pedacos = nomeParte.split(/[._-]/).filter(Boolean);
  if (pedacos.length >= 2) return (pedacos[0][0] + pedacos[1][0]).toUpperCase();
  return nomeParte.slice(0, 2).toUpperCase();
}

function cartaoGestaoEquipeHtml() {
  const nomePlano = (assinaturaCache && (assinaturaCache.planoNome || NOME_PLANO_FALLBACK[assinaturaCache.planoId])) || 'MEV Free';
  const maxMembros = (assinaturaCache && assinaturaCache.limiteMembros) || 1;
  return `
    <div class="card-info">
      <div class="team-header">
        <h3>Equipe</h3>
        <span class="team-plan-pill">${escaparHtml(nomePlano)} · até ${maxMembros} pessoa${maxMembros > 1 ? 's' : ''}</span>
      </div>

      <div id="listaMembros" class="team-list">
        <p class="team-msg">Carregando…</p>
      </div>

      <div class="team-add">
        <p class="team-add-label">Adicionar membro</p>

        <div class="field">
          <label for="fMembroEmail">E-mail do funcionário</label>
          <input id="fMembroEmail" type="email" placeholder="pessoa@exemplo.com" autocomplete="off">
        </div>

        <div class="field">
          <label>Papel</label>
          <div class="papel-toggle" id="papelToggle">
            <button type="button" class="papel-opt selected" data-papel="vendedor">Vendedor</button>
            <button type="button" class="papel-opt" data-papel="estoquista">Estoquista</button>
          </div>
        </div>

        <p class="erro" id="erroEquipe" style="display:none;"></p>
        <button type="button" class="btn primary" id="btnAdicionarMembro" style="width:100%;">Adicionar à equipe</button>
      </div>
    </div>
  `;
}

function inicializarGestaoEquipe() {
  papelEquipeSelecionado = 'vendedor';
  carregarListaMembros();

  const btnAdicionar = document.getElementById('btnAdicionarMembro');
  if (btnAdicionar) btnAdicionar.addEventListener('click', adicionarMembroDaEquipe);

  document.querySelectorAll('#papelToggle .papel-opt').forEach(botao => {
    botao.addEventListener('click', () => {
      papelEquipeSelecionado = botao.dataset.papel;
      document.querySelectorAll('#papelToggle .papel-opt').forEach(b => {
        b.classList.toggle('selected', b.dataset.papel === papelEquipeSelecionado);
      });
    });
  });
}

function linhaMembroHtml(membro, indice) {
  const rotulo = ROTULOS_PAPEL[membro.papel] || membro.papel;
  const ehEuMesmo = (membro.email || '').toLowerCase() === (usuarioLogadoEmail || '').toLowerCase();

  return `
    <div class="team-row" id="teamRow${indice}">
      <span class="team-avatar" aria-hidden="true">${escaparHtml(gerarIniciaisEmail(membro.email))}</span>
      <div class="team-info">
        <span class="team-email">${escaparHtml(membro.email)}${ehEuMesmo ? ' <span class="team-you">(você)</span>' : ''}</span>
        <span class="role-chip ${escaparHtml(membro.papel)}"><span class="dot"></span>${escaparHtml(rotulo)}</span>
      </div>
      ${ehEuMesmo ? '' : `
        <div class="team-actions">
          <button type="button" class="btn-editar-membro" data-indice="${indice}" aria-label="Editar papel de ${escaparHtml(membro.email)}" title="Editar papel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button type="button" class="btn-remover-membro" data-indice="${indice}" aria-label="Remover ${escaparHtml(membro.email)} da equipe" title="Remover da equipe">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
          </button>
        </div>
      `}
    </div>
  `;
}

// Papel escolhido durante a edição inline de um membro (linha "teamRowN"
// vira um mini-formulário com toggle de papel + salvar/cancelar).
let papelEdicaoSelecionado = 'vendedor';

function pedirEdicaoPapelMembro(indice) {
  const membro = membrosEquipeCache[indice];
  const linha = document.getElementById(`teamRow${indice}`);
  if (!membro || !linha) return;

  papelEdicaoSelecionado = membro.papel === 'estoquista' ? 'estoquista' : 'vendedor';

  linha.innerHTML = `
    <div class="team-edit">
      <span class="team-edit-label">Papel de ${escaparHtml(membro.email)}</span>
      <div class="papel-toggle" id="papelEditToggle${indice}">
        <button type="button" class="papel-opt ${papelEdicaoSelecionado === 'vendedor' ? 'selected' : ''}" data-papel="vendedor">Vendedor</button>
        <button type="button" class="papel-opt ${papelEdicaoSelecionado === 'estoquista' ? 'selected' : ''}" data-papel="estoquista">Estoquista</button>
      </div>
      <div class="team-edit-actions">
        <button type="button" class="btn primary btn-salvar-membro" data-indice="${indice}">Salvar</button>
        <button type="button" class="btn-cancelar-edicao" data-indice="${indice}">Cancelar</button>
      </div>
    </div>
  `;

  linha.querySelectorAll(`#papelEditToggle${indice} .papel-opt`).forEach(botao => {
    botao.addEventListener('click', () => {
      papelEdicaoSelecionado = botao.dataset.papel;
      linha.querySelectorAll(`#papelEditToggle${indice} .papel-opt`).forEach(b => {
        b.classList.toggle('selected', b.dataset.papel === papelEdicaoSelecionado);
      });
    });
  });

  linha.querySelector('.btn-salvar-membro').addEventListener('click', () => confirmarEdicaoMembro(indice));
  linha.querySelector('.btn-cancelar-edicao').addEventListener('click', () => carregarListaMembros());
}

async function confirmarEdicaoMembro(indice) {
  const membro = membrosEquipeCache[indice];
  if (!membro) return;

  const linha = document.getElementById(`teamRow${indice}`);
  const btnSalvar = linha ? linha.querySelector('.btn-salvar-membro') : null;
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
  }

  try {
    await DB.editarMembro(membro.email, papelEdicaoSelecionado);
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível editar esse membro.');
    await carregarListaMembros();
  }
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
    container.querySelectorAll('.btn-editar-membro').forEach(botao => {
      botao.addEventListener('click', () => pedirEdicaoPapelMembro(Number(botao.dataset.indice)));
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
  const email = campoEmail.value.trim();
  const papel = papelEquipeSelecionado;

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
  const campoFornecedor = document.getElementById('fFornecedor');
  const campoCodigo = document.getElementById('fCodigoBarras');
  const campoPrecoCusto = document.getElementById('fPrecoCusto');
  const estoqueMinimo = campoMinimo ? parseInt(campoMinimo.value, 10) : NaN;
  const categoria = campoCategoria ? campoCategoria.value : '';
  const fornecedor = campoFornecedor ? campoFornecedor.value.trim() : '';
  const codigoBarras = campoCodigo ? campoCodigo.value.trim() : '';
  // Campo mascarado ("1.234,56") — convertido pro número em reais que o
  // resto do sistema usa. `null` quando a pessoa deixou em branco.
  const precoCusto = campoPrecoCusto ? valorMonetarioParaNumero(campoPrecoCusto.value) : null;
  const unidade = unidadeSelecionada;

  // Dimensões do produto — todos os campos são opcionais (preparação para
  // o futuro cálculo de frete da Loja Virtual). Só gravamos números válidos;
  // campo em branco vira null, igual ao tratamento de precoCusto acima.
  const campoPeso = document.getElementById('fPeso');
  const campoAltura = document.getElementById('fAltura');
  const campoLargura = document.getElementById('fLargura');
  const campoComprimento = document.getElementById('fComprimento');
  const campoUnidadePeso = document.getElementById('fUnidadePeso');
  const campoUnidadeMedida = document.getElementById('fUnidadeMedida');
  const paraNumeroOuNull = (valor) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const numero = parseFloat(valor);
    return isNaN(numero) ? null : numero;
  };
  const dimensoes = {
    peso: campoPeso ? paraNumeroOuNull(campoPeso.value) : null,
    altura: campoAltura ? paraNumeroOuNull(campoAltura.value) : null,
    largura: campoLargura ? paraNumeroOuNull(campoLargura.value) : null,
    comprimento: campoComprimento ? paraNumeroOuNull(campoComprimento.value) : null,
    unidadePeso: campoUnidadePeso ? campoUnidadePeso.value : 'kg',
    unidadeMedida: campoUnidadeMedida ? campoUnidadeMedida.value : 'cm'
  };

  try {
    if (idEmEdicao) {
      await Produtos.editarProduto(idEmEdicao, { nome, preco, estoque, estoqueMinimo, categoria, fornecedor, imagem: imagemPendente, codigoBarras, unidade, precoCusto, dimensoes });
    } else {
      await Produtos.criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, fornecedor, imagem: imagemPendente, codigoBarras, unidade, precoCusto, dimensoes });
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
  movimentos: 'Movimentos',
  membros: 'Equipe',
  assinatura: 'Assinatura',
  empresa: 'Empresa',
};

let filtroAtividades = { store: '' };

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

function telaAtividadesHtml() {
  return `
    <div class="page">
      <h2>📜 Histórico de atividades</h2>
      <p class="hint">Veja quem fez cada ação dentro da sua empresa.</p>

      <div class="field" style="max-width:260px;margin:12px 0;">
        <label for="filtroAtividadeStore">Filtrar por área</label>
        <select id="filtroAtividadeStore" class="filtro-select">
          <option value="">Todas as áreas</option>
          <option value="produtos">Produtos</option>
          <option value="vendas">Vendas</option>
          <option value="movimentos">Movimentos</option>
          <option value="membros">Equipe</option>
          <option value="assinatura">Assinatura</option>
          <option value="empresa">Empresa</option>
        </select>
      </div>

      <div id="listaAtividades" class="team-list"><p class="team-msg">Carregando…</p></div>
    </div>
  `;
}

/** Formata "YYYY-MM-DD HH:MM:SS" (UTC, como o SQLite grava) pro horário local em pt-BR. */
function formatarDataHoraAtividade(dataSql) {
  const data = new Date(String(dataSql).replace(' ', 'T') + 'Z');
  if (isNaN(data.getTime())) return dataSql;
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function linhaAtividadeHtml(atividade) {
  const rotuloStore = ROTULOS_STORE_ATIVIDADE[atividade.store] || '';
  const rotuloPapel = ROTULOS_PAPEL[atividade.papel] || atividade.papel || '';
  const metaPartes = [atividade.usuarioEmail, rotuloPapel, rotuloStore, formatarDataHoraAtividade(atividade.criadoEm)]
    .filter(Boolean)
    .map(escaparHtml);

  return `
    <div class="team-row">
      <span class="team-avatar" aria-hidden="true">${escaparHtml(gerarIniciaisEmail(atividade.usuarioEmail))}</span>
      <div class="team-info">
        <span class="team-email">${escaparHtml(atividade.descricao)}</span>
        <span class="hint" style="font-size:12px;">${metaPartes.join(' · ')}</span>
      </div>
    </div>
  `;
}

async function carregarTelaAtividades() {
  const seletor = document.getElementById('filtroAtividadeStore');
  if (seletor) {
    seletor.value = filtroAtividades.store;
    seletor.addEventListener('change', () => {
      filtroAtividades.store = seletor.value;
      carregarListaAtividades();
    });
  }
  await carregarListaAtividades();
}

async function carregarListaAtividades() {
  const container = document.getElementById('listaAtividades');
  if (!container) return;
  container.innerHTML = '<p class="team-msg">Carregando…</p>';

  try {
    const atividades = await DB.listarAtividades({ store: filtroAtividades.store || undefined });
    if (atividades.length === 0) {
      container.innerHTML = '<p class="team-msg">Nenhuma atividade registrada ainda.</p>';
      return;
    }
    container.innerHTML = atividades.map(linhaAtividadeHtml).join('');
  } catch (erro) {
    container.innerHTML = erro && erro.recurso
      ? cartaoRecursoBloqueadoHtml(erro)
      : `<p class="erro" style="margin:0;">${escaparHtml((erro && erro.message) || 'Não foi possível carregar o histórico de atividades.')}</p>`;
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
    const confirmar = confirm(
      `Você já tem ${produtosCache.length} produto(s) cadastrado(s). ` +
      `Carregar os dados de exemplo vai ADICIONAR novos produtos de demonstração ` +
      `sem apagar os que você já tem. Deseja continuar?`
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
    alert('Dados de exemplo carregados com sucesso! 🎉');
    return true;
  } catch (erro) {
    alert(
      erro && erro.message
        ? `Não foi possível carregar os dados de exemplo: ${erro.message}`
        : 'Não foi possível carregar os dados de exemplo. Verifique sua conexão e tente novamente.'
    );
    return false;
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }
}

// --- Tela de boas-vindas com insights ---
//
// Diferente do onboarding acima (que só existe pra conta vazia, no
// primeiro acesso), esta tela aparece pra quem JÁ tem dados — uma vez por
// dia, no primeiro login do dia — com um resumo rápido do negócio antes de
// cair na tela de Estoque. O conteúdo muda de acordo com o papel da
// pessoa: dono/administrador vê o negócio inteiro, vendedor vê só as
// próprias vendas, estoquista vê só o lado de estoque.

const CHAVE_INSIGHTS_ULTIMO_DIA = 'mevInsightsUltimoDia';

function saudacaoPorHorario() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Início (00:00) de hoje e de ontem, como objetos Date — pra comparar "hoje vs ontem". */
function _limitesHojeOntem() {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const inicioOntem = new Date(inicioHoje);
  inicioOntem.setDate(inicioOntem.getDate() - 1);
  return { inicioHoje, inicioOntem };
}

/** Total vendido ontem (não existe um "período: ontem" em Vendas.filtrarVendas, então calcula direto aqui). */
function calcularVendidoOntem(vendas) {
  const { inicioHoje, inicioOntem } = _limitesHojeOntem();
  return vendas
    .filter(v => v.status !== 'cancelada')
    .filter(v => { const d = new Date(v.data); return d >= inicioOntem && d < inicioHoje; })
    .reduce((soma, v) => soma + v.total, 0);
}

/** Produto campeão de vendas nos últimos 7 dias (não a vida toda — mais útil pro dia a dia). */
function calcularMaisVendidoUltimos7Dias(vendas) {
  const limite = new Date();
  limite.setDate(limite.getDate() - 7);
  const recentes = vendas.filter(v => v.status !== 'cancelada' && new Date(v.data) >= limite);
  const topLista = Produtos.calcularMaisVendidos(recentes, 1);
  return topLista[0] || null;
}

/** Monta os cartões de insight de acordo com o papel de quem está logado. */
function montarCardsInsights() {
  const cards = [];

  if (usuarioLogadoPapel === 'dono' || usuarioLogadoPapel === 'administrador') {
    const vendidoHoje = Vendas.calcularVendasDoDia(vendasCache);
    const vendidoOntem = calcularVendidoOntem(vendasCache);
    let nota = '';
    if (vendidoOntem > 0) {
      const variacao = ((vendidoHoje - vendidoOntem) / vendidoOntem) * 100;
      nota = `${variacao >= 0 ? '↑' : '↓'} ${Math.abs(variacao).toFixed(0)}% vs ontem`;
    }
    cards.push({ id: 'vendidoHoje', icone: '💰', label: 'Vendido hoje', valor: formatarMoeda(vendidoHoje), nota });
    cards.push({ id: 'vendidoMes', icone: '📅', label: 'Vendido no mês', valor: formatarMoeda(Vendas.calcularVendasDoMes(vendasCache)), nota: '' });

    const top = calcularMaisVendidoUltimos7Dias(vendasCache);
    cards.push({
      id: 'maisVendido', icone: '🔥', label: 'Mais vendido (7 dias)',
      valor: top ? top.nome : '—',
      nota: top ? `${top.quantidade} ${top.quantidade === 1 ? 'unidade' : 'unidades'}` : 'Ainda sem vendas suficientes'
    });

    const { estoqueBaixo } = Produtos.calcularEstatisticas(produtosCache);
    cards.push({
      id: 'estoqueBaixo', icone: '📦', label: 'Estoque baixo', valor: String(estoqueBaixo),
      nota: estoqueBaixo > 0 ? 'Toque para ver quais' : 'Tudo certo por aqui',
      acao: estoqueBaixo > 0 ? irParaEstoqueBaixoDoInsight : null
    });
  } else if (usuarioLogadoPapel === 'vendedor') {
    const { inicioHoje } = _limitesHojeOntem();
    const minhasVendas = vendasCache.filter(v =>
      v.status !== 'cancelada' && (v.vendedor || '').toLowerCase() === usuarioLogadoEmail.toLowerCase()
    );
    const minhasHoje = minhasVendas
      .filter(v => new Date(v.data) >= inicioHoje)
      .reduce((soma, v) => soma + v.total, 0);

    cards.push({ id: 'minhasVendasHoje', icone: '💰', label: 'Suas vendas hoje', valor: formatarMoeda(minhasHoje), nota: '' });
    cards.push({ id: 'minhasVendasTotal', icone: '🧾', label: 'Suas vendas registradas', valor: String(minhasVendas.length), nota: 'no total' });
  } else if (usuarioLogadoPapel === 'estoquista') {
    const { totalItens, valorEmEstoque, estoqueBaixo } = Produtos.calcularEstatisticas(produtosCache);
    cards.push({ id: 'totalProdutos', icone: '📦', label: 'Produtos cadastrados', valor: String(totalItens), nota: '' });
    cards.push({ id: 'valorEstoque', icone: '💵', label: 'Valor em estoque', valor: formatarMoeda(valorEmEstoque), nota: '' });
    cards.push({
      id: 'estoqueBaixo', icone: '⚠️', label: 'Estoque baixo', valor: String(estoqueBaixo),
      nota: estoqueBaixo > 0 ? 'Toque para ver quais' : 'Tudo certo por aqui',
      acao: estoqueBaixo > 0 ? irParaEstoqueBaixoDoInsight : null
    });
  }

  return cards;
}

/** Uma frase curta e útil, escolhida a partir dos cartões já calculados (sem refazer nenhuma conta). */
function montarDicaDoDiaInsights(cards) {
  const estoqueCard = cards.find(c => c.id === 'estoqueBaixo');
  if (estoqueCard && parseInt(estoqueCard.valor, 10) > 0) {
    return `Você tem ${estoqueCard.valor} produto${estoqueCard.valor === '1' ? '' : 's'} perto de acabar. Bom repor antes que faltem.`;
  }
  const vendidoHojeCard = cards.find(c => c.id === 'vendidoHoje' || c.id === 'minhasVendasHoje');
  if (vendidoHojeCard && /^R\$\s?0,00$/.test(vendidoHojeCard.valor)) {
    return 'Ainda sem vendas hoje — que tal registrar a primeira?';
  }
  return 'Continue assim — seu negócio está em dia. 🎉';
}

function irParaEstoqueBaixoDoInsight() {
  fecharTelaInsights();
  irParaEstoqueBaixo();
}

function fecharTelaInsights() {
  const el = document.getElementById('insightsWrap');
  if (el) el.remove();
}

function abrirTelaInsights() {
  const cards = montarCardsInsights();
  if (!cards.length) return; // papel sem insight definido: não mostra nada
  const dica = montarDicaDoDiaInsights(cards);

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap modal-wrap-centro';
  wrap.id = 'insightsWrap';
  wrap.innerHTML = `
    <div class="onboard insights-tela">
      <div class="emoji">👋</div>
      <h2>${escaparHtml(saudacaoPorHorario())}${usuarioLogadoNomeEmpresa ? ', ' + escaparHtml(usuarioLogadoNomeEmpresa) : ''}!</h2>
      <p class="insights-data">${escaparHtml(dataDeHoje())}</p>
      <div class="insights-grid">
        ${cards.map((c, i) => `
          <div class="insight-card ${c.acao ? 'clicavel' : ''}" data-indice="${i}" ${c.acao ? 'role="button" tabindex="0"' : ''}>
            <span class="insight-icone">${c.icone}</span>
            <span class="insight-label">${escaparHtml(c.label)}</span>
            <span class="insight-valor">${escaparHtml(c.valor)}</span>
            ${c.nota ? `<span class="insight-nota">${escaparHtml(c.nota)}</span>` : ''}
          </div>
        `).join('')}
      </div>
      <p class="insights-dica">💡 ${escaparHtml(dica)}</p>
      <button class="btn primary" id="btnFecharInsights">Vamos lá</button>
    </div>`;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('.insight-card.clicavel').forEach(el => {
    const acao = cards[Number(el.dataset.indice)].acao;
    el.addEventListener('click', acao);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acao(); } });
  });

  const marcarComoVistaHoje = () => localStorage.setItem(CHAVE_INSIGHTS_ULTIMO_DIA, new Date().toISOString().slice(0, 10));
  document.getElementById('btnFecharInsights').addEventListener('click', () => {
    marcarComoVistaHoje();
    fecharTelaInsights();
  });
}

// --- Importação de Produtos (wizard) ---
// Regras de parsing/validação/execução vivem em js/importacao.js
// (window.Importacao) — aqui só desenhamos as telas e conectamos eventos,
// igual ao resto do app.js. Reaproveita Produtos.criarProduto/editarProduto
// por baixo do pano (via Importacao.executarImportacao), então nenhuma
// regra de cadastro/edição é duplicada.

const ORIGENS_IMPORTACAO = [
  { id: 'xlsx',    rotulo: 'Excel (.xlsx)',  emoji: '📊', disponivel: true },
  { id: 'csv',     rotulo: 'CSV (.csv)',     emoji: '📄', disponivel: true },
  { id: 'xml_nfe', rotulo: 'XML da NF-e',    emoji: '🧾', disponivel: true },
  { id: 'danfe',   rotulo: 'DANFE',          emoji: '📃', disponivel: false },
];

function abrirWizardImportacao() {
  estadoImportacao = {
    passo: 1,
    origem: null,
    arquivo: null,
    cabecalho: [],
    linhasBrutas: [],
    mapeamento: {},
    salvarMapeamentoParaProxima: true,
    linhasValidadas: [],
    resultado: null,
    erroAtual: null,
  };

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'importWrap';
  wrap.innerHTML = `<div class="modal import-modal"><div id="importCorpo"></div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) fecharWizardImportacao(); });

  renderizarPassoImportacao();
}

function fecharWizardImportacao() {
  const wrap = document.getElementById('importWrap');
  if (wrap) wrap.remove();
  estadoImportacao = null;
}

function renderizarPassoImportacao() {
  const corpo = document.getElementById('importCorpo');
  if (!corpo || !estadoImportacao) return;

  const passos = { 1: passoOrigemHtml, 2: passoUploadHtml, 3: passoMapeamentoHtml, 4: passoPrevisualizacaoHtml, 5: passoResultadoHtml };
  corpo.innerHTML = passos[estadoImportacao.passo]();
  conectarEventosDoPasso(estadoImportacao.passo);
}

// --- Passo 1: escolher origem ---

function passoOrigemHtml() {
  return `
    <h2>📥 Importar Produtos</h2>
    <p class="hint" style="margin-top:-10px;margin-bottom:16px;">De onde vêm os produtos que você quer importar?</p>
    <div class="import-origens">
      ${ORIGENS_IMPORTACAO.map(o => `
        <button type="button" class="import-origem-opt ${o.disponivel ? '' : 'disabled'}" data-origem="${o.id}" ${o.disponivel ? '' : 'disabled'}>
          <span class="emoji">${o.emoji}</span>
          <span>${o.rotulo}</span>
          ${o.disponivel ? '' : '<span class="d">Em breve</span>'}
        </button>
      `).join('')}
    </div>
    <button class="btn ghost" id="btnFecharImport" style="margin-top:16px;">Cancelar</button>
  `;
}

// --- Passo 2: upload ---

function passoUploadHtml() {
  const s = estadoImportacao;
  const rotuloOrigem = ORIGENS_IMPORTACAO.find(o => o.id === s.origem)?.rotulo || '';
  const aceita = { xlsx: '.xlsx,.xls', csv: '.csv', xml_nfe: '.xml' }[s.origem] || '';

  return `
    <h2>📥 Importar Produtos</h2>
    <p class="hint" style="margin-top:-10px;margin-bottom:16px;">Origem: <strong>${escaparHtml(rotuloOrigem)}</strong></p>

    <div class="import-upload-area" id="importUploadArea">
      <input type="file" id="importArquivoInput" accept="${aceita}" style="display:none;">
      <div class="import-upload-cta" id="importUploadCta">
        <span class="emoji">📎</span>
        <p>Toque para escolher o arquivo</p>
      </div>
    </div>

    <div id="importArquivoInfo"></div>
    <div id="importUploadErro"></div>

    <div class="import-wizard-nav">
      <button class="btn ghost" id="btnVoltarImport">Voltar</button>
      <button class="btn primary" id="btnAvancarUpload" disabled>Continuar</button>
    </div>
  `;
}

function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TAMANHO_MAXIMO_IMPORT_MB = 10;

async function processarArquivoSelecionado(arquivo) {
  const s = estadoImportacao;
  const infoEl = document.getElementById('importArquivoInfo');
  const erroEl = document.getElementById('importUploadErro');
  const btnAvancar = document.getElementById('btnAvancarUpload');
  erroEl.innerHTML = '';

  // Valida tamanho antes de tentar ler — arquivos muito grandes travam o browser
  if (arquivo.size > TAMANHO_MAXIMO_IMPORT_MB * 1024 * 1024) {
    erroEl.innerHTML = `<p class="erro" style="margin:8px 0 0;">Arquivo muito grande (${tamanhoLegivel(arquivo.size)}). O limite é ${TAMANHO_MAXIMO_IMPORT_MB} MB. Divida o arquivo em partes menores e importe em lotes.</p>`;
    btnAvancar.disabled = true;
    return;
  }
  infoEl.innerHTML = `
    <div class="import-arquivo-card">
      <p><strong>${escaparHtml(arquivo.name)}</strong> · ${tamanhoLegivel(arquivo.size)}</p>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:40%"></div></div>
      <p class="hint">Lendo arquivo…</p>
    </div>`;

  try {
    let resultado;
    if (s.origem === 'csv') {
      const texto = await arquivo.text();
      resultado = Importacao.parsearCsv(texto);
    } else if (s.origem === 'xlsx') {
      resultado = await Importacao.parsearXlsx(arquivo);
    } else if (s.origem === 'xml_nfe') {
      const texto = await arquivo.text();
      resultado = Importacao.parsearXmlNfe(texto);
    }

    if (!resultado.linhas.length) {
      throw new Error('Não encontramos nenhum produto nesse arquivo.');
    }

    s.arquivo = arquivo;
    s.cabecalho = resultado.cabecalho;
    s.linhasBrutas = resultado.linhas;
    s.jaMapeado = !!resultado.jaMapeado;

    infoEl.innerHTML = `
      <div class="import-arquivo-card">
        <p><strong>${escaparHtml(arquivo.name)}</strong> · ${tamanhoLegivel(arquivo.size)}</p>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:100%"></div></div>
        <p class="hint">${resultado.linhas.length} registro(s) encontrado(s).</p>
      </div>`;
    btnAvancar.disabled = false;
  } catch (erro) {
    infoEl.innerHTML = '';
    erroEl.innerHTML = `<p class="erro" style="margin:8px 0 0;">${escaparHtml((erro && erro.message) || 'Não foi possível ler o arquivo.')}</p>`;
    btnAvancar.disabled = true;
  }
}

// --- Passo 3: mapeamento de colunas (não se aplica ao XML da NF-e) ---

function passoMapeamentoHtml() {
  const s = estadoImportacao;
  return `
    <h2>📥 Importar Produtos</h2>
    <p class="hint" style="margin-top:-10px;margin-bottom:16px;">Confirme qual coluna do arquivo corresponde a cada campo.</p>

    <div class="import-mapeamento-lista">
      ${Importacao.CAMPOS_PRODUTO.map(campo => `
        <div class="field">
          <label>${escaparHtml(campo.rotulo)}${campo.obrigatorio ? ' *' : ''}</label>
          <select data-campo="${campo.chave}" class="import-map-select">
            <option value="">— não importar —</option>
            ${s.cabecalho.map(col => `<option value="${escaparHtml(col)}" ${s.mapeamento[campo.chave] === col ? 'selected' : ''}>${escaparHtml(col)}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>

    <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink-soft);margin:10px 0 4px;">
      <input type="checkbox" id="importSalvarMapeamento" ${s.salvarMapeamentoParaProxima ? 'checked' : ''}>
      Salvar este mapeamento para as próximas importações de ${s.origem === 'xlsx' ? 'Excel' : 'CSV'}
    </label>

    <div id="importMapeamentoErro"></div>

    <div class="import-wizard-nav">
      <button class="btn ghost" id="btnVoltarImport">Voltar</button>
      <button class="btn primary" id="btnAvancarMapeamento">Pré-visualizar</button>
    </div>
  `;
}

// --- Passo 4: pré-visualização editável ---

const ROTULOS_ACAO_DUPLICIDADE = {
  atualizar_produto: 'Atualizar produto',
  atualizar_estoque: 'Atualizar só estoque',
  ignorar: 'Ignorar',
  criar_novo: 'Criar novo mesmo assim',
};

function statusLinhaImportacao(linha) {
  if (linha.erros.length) return { classe: 'erro', rotulo: 'Erro' };
  if (linha.duplicado) return { classe: 'duplicado', rotulo: 'Duplicado' };
  return { classe: 'ok', rotulo: 'Novo' };
}

function passoPrevisualizacaoHtml() {
  const s = estadoImportacao;
  const total = s.linhasValidadas.length;
  const comErro = s.linhasValidadas.filter(l => l.erros.length).length;
  const duplicados = s.linhasValidadas.filter(l => !l.erros.length && l.duplicado).length;

  return `
    <h2>📥 Importar Produtos</h2>
    <p class="hint" style="margin-top:-10px;margin-bottom:12px;">
      ${total} registro(s) · ${duplicados} duplicado(s) · ${comErro} com erro. Revise antes de importar.
    </p>

    <div class="import-preview-tabela-wrap">
      <table class="import-preview-tabela">
        <thead>
          <tr>
            <th>Status</th><th>Nome</th><th>Categoria</th><th>Código</th><th>Cód. barras</th>
            <th>Custo</th><th>Venda</th><th>Qtd</th><th>Fornecedor</th><th>Marca</th><th>Unid.</th><th>Ação</th>
          </tr>
        </thead>
        <tbody>
          ${s.linhasValidadas.map((l, i) => {
            const st = statusLinhaImportacao(l);
            return `
            <tr data-linha="${i}" class="linha-${st.classe}">
              <td><span class="badge-status ${st.classe}" title="${escaparHtml(l.erros.join(' '))}">${st.rotulo}</span></td>
              <td><input data-campo="nome" value="${escaparHtml(l.item.nome)}"></td>
              <td><input data-campo="categoria" value="${escaparHtml(l.item.categoria)}"></td>
              <td><input data-campo="codigo" value="${escaparHtml(l.item.codigo)}"></td>
              <td><input data-campo="codigoBarras" value="${escaparHtml(l.item.codigoBarras)}"></td>
              <td><input data-campo="precoCusto" value="${escaparHtml(l.item.precoCusto)}"></td>
              <td><input data-campo="preco" value="${escaparHtml(l.item.preco)}"></td>
              <td><input data-campo="estoque" value="${escaparHtml(l.item.estoque)}"></td>
              <td><input data-campo="fornecedor" value="${escaparHtml(l.item.fornecedor)}"></td>
              <td><input data-campo="marca" value="${escaparHtml(l.item.marca)}"></td>
              <td><input data-campo="unidade" value="${escaparHtml(l.item.unidade)}"></td>
              <td>
                ${l.duplicado ? `
                <select data-acao-linha>
                  <option value="atualizar_produto" ${l.acaoDuplicidade === 'atualizar_produto' ? 'selected' : ''}>Atualizar produto</option>
                  <option value="atualizar_estoque" ${l.acaoDuplicidade === 'atualizar_estoque' ? 'selected' : ''}>Atualizar só estoque</option>
                  <option value="ignorar" ${l.acaoDuplicidade === 'ignorar' ? 'selected' : ''}>Ignorar</option>
                  <option value="criar_novo" ${l.acaoDuplicidade === 'criar_novo' ? 'selected' : ''}>Criar novo</option>
                </select>` : '<span class="hint">Criar novo</span>'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div id="importExecucaoProgresso"></div>

    <div class="import-wizard-nav">
      <button class="btn ghost" id="btnVoltarImport">Voltar</button>
      <button class="btn primary" id="btnConfirmarImportacao" ${total === 0 ? 'disabled' : ''}>Importar ${total} registro(s)</button>
    </div>
  `;
}

// --- Passo 5: relatório final ---

function passoResultadoHtml() {
  const r = estadoImportacao.resultado;
  return `
    <h2>✅ Importação concluída</h2>
    <div class="import-resultado-grid">
      <div class="import-resultado-item criado"><strong>${r.criados}</strong><span>Criados</span></div>
      <div class="import-resultado-item atualizado"><strong>${r.atualizados}</strong><span>Atualizados</span></div>
      <div class="import-resultado-item ignorado"><strong>${r.ignorados}</strong><span>Ignorados</span></div>
      <div class="import-resultado-item erro"><strong>${r.comErro}</strong><span>Com erro</span></div>
    </div>
    ${r.erros.length ? `<button class="btn ghost" id="btnExportarErrosImport" style="width:100%;margin-top:12px;">Exportar erros em Excel</button>` : ''}
    <button class="btn primary" id="btnFecharImportFinal" style="width:100%;margin-top:10px;">Concluir</button>
  `;
}

// --- Navegação/eventos de cada passo ---

function conectarEventosDoPasso(passo) {
  const btnFechar = document.getElementById('btnFecharImport');
  if (btnFechar) btnFechar.addEventListener('click', fecharWizardImportacao);
  const btnVoltar = document.getElementById('btnVoltarImport');
  if (btnVoltar) btnVoltar.addEventListener('click', voltarPassoImportacao);

  if (passo === 1) {
    document.querySelectorAll('.import-origem-opt').forEach(botao => {
      botao.addEventListener('click', () => {
        if (botao.disabled) return;
        estadoImportacao.origem = botao.dataset.origem;
        estadoImportacao.passo = 2;
        renderizarPassoImportacao();
      });
    });
  }

  if (passo === 2) {
    const input = document.getElementById('importArquivoInput');
    document.getElementById('importUploadCta').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) processarArquivoSelecionado(input.files[0]);
    });
    document.getElementById('btnAvancarUpload').addEventListener('click', async () => {
      if (estadoImportacao.origem === 'xml_nfe') {
        // XML da NF-e já vem mapeado — pula direto pra validação/pré-visualização.
        estadoImportacao.linhasValidadas = Importacao.validarTodasAsLinhas(estadoImportacao.linhasBrutas, produtosCache);
        estadoImportacao.passo = 4;
      } else {
        const mapeamentoSalvo = await DB.buscarMapeamentoImportacao(estadoImportacao.origem).catch(() => null);
        estadoImportacao.mapeamento = mapeamentoSalvo || Importacao.sugerirMapeamento(estadoImportacao.cabecalho);
        estadoImportacao.passo = 3;
      }
      renderizarPassoImportacao();
    });
  }

  if (passo === 3) {
    document.getElementById('btnAvancarMapeamento').addEventListener('click', async () => {
      document.querySelectorAll('.import-map-select').forEach(sel => {
        estadoImportacao.mapeamento[sel.dataset.campo] = sel.value;
      });

      const obrigatoriosFaltando = Importacao.CAMPOS_PRODUTO
        .filter(c => c.obrigatorio && !estadoImportacao.mapeamento[c.chave])
        .map(c => c.rotulo);
      if (obrigatoriosFaltando.length) {
        document.getElementById('importMapeamentoErro').innerHTML =
          `<p class="erro" style="margin:8px 0 0;">Mapeie pelo menos: ${escaparHtml(obrigatoriosFaltando.join(', '))}.</p>`;
        return;
      }

      estadoImportacao.salvarMapeamentoParaProxima = document.getElementById('importSalvarMapeamento').checked;
      if (estadoImportacao.salvarMapeamentoParaProxima) {
        DB.salvarMapeamentoImportacao(estadoImportacao.origem, estadoImportacao.mapeamento).catch(() => {});
      }

      const itens = Importacao.aplicarMapeamento(estadoImportacao.cabecalho, estadoImportacao.linhasBrutas, estadoImportacao.mapeamento);
      estadoImportacao.linhasValidadas = Importacao.validarTodasAsLinhas(itens, produtosCache);
      estadoImportacao.passo = 4;
      renderizarPassoImportacao();
    });
  }

  if (passo === 4) {
    document.querySelectorAll('.import-preview-tabela [data-campo]').forEach(input => {
      input.addEventListener('input', () => {
        const tr = input.closest('tr');
        const indice = Number(tr.dataset.linha);
        estadoImportacao.linhasValidadas[indice].item[input.dataset.campo] = input.value;
      });
    });
    document.querySelectorAll('[data-acao-linha]').forEach(select => {
      select.addEventListener('change', () => {
        const tr = select.closest('tr');
        const indice = Number(tr.dataset.linha);
        estadoImportacao.linhasValidadas[indice].acaoDuplicidade = select.value;
      });
    });

    document.getElementById('btnConfirmarImportacao').addEventListener('click', async () => {
      const btn = document.getElementById('btnConfirmarImportacao');
      btn.disabled = true;
      const progresso = document.getElementById('importExecucaoProgresso');

      const resultado = await Importacao.executarImportacao(estadoImportacao.linhasValidadas, {
        aoProgredir: (feito, total) => {
          progresso.innerHTML = `
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.round((feito / total) * 100)}%"></div></div>
            <p class="hint">Importando ${feito} de ${total}…</p>`;
        }
      });

      estadoImportacao.resultado = resultado;

      // Registra o resumo no histórico (auditoria) — não bloqueia a UI se falhar.
      DB.registrarImportacao({
        origem: estadoImportacao.origem,
        nomeArquivo: estadoImportacao.arquivo ? estadoImportacao.arquivo.name : 'arquivo',
        totalRegistros: estadoImportacao.linhasValidadas.length,
        criados: resultado.criados,
        atualizados: resultado.atualizados,
        ignorados: resultado.ignorados,
        comErro: resultado.comErro,
        erros: resultado.erros,
      }).catch(() => {});

      await recarregarDados();
      estadoImportacao.passo = 5;
      renderizarPassoImportacao();
    });
  }

  if (passo === 5) {
    const btnExportar = document.getElementById('btnExportarErrosImport');
    if (btnExportar) {
      btnExportar.addEventListener('click', () => {
        Importacao.exportarErrosXlsx(estadoImportacao.resultado.erros).catch(erro => {
          alert((erro && erro.message) || 'Não foi possível exportar os erros.');
        });
      });
    }
    document.getElementById('btnFecharImportFinal').addEventListener('click', () => {
      fecharWizardImportacao();
      renderizarTudo();
    });
  }
}

function voltarPassoImportacao() {
  if (!estadoImportacao) return;
  if (estadoImportacao.passo === 4 && estadoImportacao.jaMapeado) {
    estadoImportacao.passo = 2; // XML pulou o mapeamento, então volta direto pro upload
  } else if (estadoImportacao.passo > 1) {
    estadoImportacao.passo -= 1;
  } else {
    fecharWizardImportacao();
    return;
  }
  renderizarPassoImportacao();
}

// --- Impressão de etiquetas ---
//
// Fluxo: 1) "Etiquetas" na toolbar entra em modo de seleção (cards da tela
// Estoque viram checkboxes) → 2) barra flutuante mostra quantos foram
// marcados e libera "Imprimir Etiquetas" → 3) modal de configuração (qtd.
// por produto, modelo, quais informações mostrar) → 4) preview → 5) janela
// de impressão. A geração de HTML/SVG fica isolada em js/etiquetas.js.

function ativarModoSelecaoEtiquetas() {
  modoSelecaoEtiquetas = true;
  produtosSelecionadosEtiquetas = new Set();
  document.getElementById('selecaoEtiquetasBar').style.display = 'flex';
  document.getElementById('btnAddProduct').style.display = 'none';
  document.getElementById('btnEscanearVender').style.display = 'none';
  document.getElementById('btnSelecionarEtiquetas').style.display = 'none';
  atualizarBarraSelecaoEtiquetas();
  atualizarListaProdutos();
}

function cancelarSelecaoEtiquetas() {
  modoSelecaoEtiquetas = false;
  produtosSelecionadosEtiquetas = new Set();
  document.getElementById('selecaoEtiquetasBar').style.display = 'none';
  document.getElementById('btnAddProduct').style.display = '';
  document.getElementById('btnEscanearVender').style.display = '';
  document.getElementById('btnSelecionarEtiquetas').style.display = '';
  atualizarListaProdutos();
}

function alternarSelecaoProdutoEtiqueta(id) {
  if (produtosSelecionadosEtiquetas.has(id)) {
    produtosSelecionadosEtiquetas.delete(id);
  } else {
    produtosSelecionadosEtiquetas.add(id);
  }
  atualizarBarraSelecaoEtiquetas();
  atualizarListaProdutos();
}

function atualizarBarraSelecaoEtiquetas() {
  const n = produtosSelecionadosEtiquetas.size;
  document.getElementById('selecaoEtiquetasCount').textContent =
    n === 0 ? 'Nenhum produto selecionado' : `${n} produto${n > 1 ? 's' : ''} selecionado${n > 1 ? 's' : ''}`;
  document.getElementById('btnImprimirEtiquetasSelecionadas').disabled = n === 0;
}

/** Modal de configuração: quantidade por produto, modelo de etiqueta e quais informações exibir. */
function abrirConfigEtiquetas() {
  const idsSelecionados = Array.from(produtosSelecionadosEtiquetas);
  const produtosSelecionadosLista = produtosCache.filter(p => idsSelecionados.includes(p.id));
  if (!produtosSelecionadosLista.length) return;

  const modelos = Etiquetas.listarModelosEtiqueta();

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'etiquetasModalWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>Configurar etiquetas</h2>

      <div class="field">
        <label for="fModeloEtiqueta">Modelo de etiqueta</label>
        <select id="fModeloEtiqueta" class="filtro-select">
          ${modelos.map(m => `<option value="${m.id}" ${m.id === 'padrao_50x30' ? 'selected' : ''}>${escaparHtml(m.nome)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Informações na etiqueta</label>
        <div class="etiquetas-checks" id="etiquetasChecks">
          <label class="check-linha"><input type="checkbox" id="checkNome" checked> Nome do produto</label>
          <label class="check-linha"><input type="checkbox" id="checkCodigoInterno" checked> Código interno</label>
          <label class="check-linha"><input type="checkbox" id="checkCodigoBarras" checked> Código de barras</label>
          <label class="check-linha"><input type="checkbox" id="checkPreco" checked> Preço de venda</label>
          <label class="check-linha"><input type="checkbox" id="checkEmpresa"> Nome da empresa${usuarioLogadoNomeEmpresa ? '' : ' (não configurado)'}</label>
        </div>
      </div>

      <div class="field">
        <label>Quantidade por produto</label>
        <div class="etiquetas-lista-qtd" id="etiquetasListaQtd">
          ${produtosSelecionadosLista.map(p => `
            <div class="etiqueta-qtd-linha" data-produto-id="${p.id}">
              <span class="nome">${escaparHtml(p.nome)}</span>
              <input type="number" min="1" step="1" value="1" class="input-qtd-etiqueta" data-produto-id="${p.id}">
            </div>
          `).join('')}
        </div>
      </div>

      <p class="erro" id="erroEtiquetas" style="display:none;"></p>
      <div class="modal-actions">
        <button class="btn ghost" id="btnCancelarConfigEtiquetas">Cancelar</button>
        <button class="btn primary" id="btnPreVisualizarEtiquetas">Pré-visualizar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModalEtiquetas(); });
  document.getElementById('btnCancelarConfigEtiquetas').addEventListener('click', fecharModalEtiquetas);
  document.getElementById('btnPreVisualizarEtiquetas').addEventListener('click', () => {
    abrirPreviewEtiquetas(produtosSelecionadosLista);
  });
}

function fecharModalEtiquetas() {
  const el = document.getElementById('etiquetasModalWrap');
  if (el) el.remove();
}

function fecharPreviewEtiquetas() {
  const el = document.getElementById('etiquetasPreviewWrap');
  if (el) el.remove();
}

function _coletarConfigEtiquetas() {
  return {
    exibir: {
      nome: document.getElementById('checkNome').checked,
      codigoInterno: document.getElementById('checkCodigoInterno').checked,
      codigoBarras: document.getElementById('checkCodigoBarras').checked,
      preco: document.getElementById('checkPreco').checked,
      empresa: document.getElementById('checkEmpresa').checked
    }
  };
}

function _coletarItensEtiquetas(produtosSelecionadosLista) {
  return produtosSelecionadosLista.map(p => {
    const input = document.querySelector(`.input-qtd-etiqueta[data-produto-id="${p.id}"]`);
    const quantidade = input ? Math.max(1, parseInt(input.value, 10) || 1) : 1;
    return { produto: p, quantidade };
  });
}

/** Preview: mostra a folha em miniatura (escala reduzida na tela, tamanho real na impressão). */
function abrirPreviewEtiquetas(produtosSelecionadosLista) {
  const modeloId = document.getElementById('fModeloEtiqueta').value;
  const config = _coletarConfigEtiquetas();
  const itens = _coletarItensEtiquetas(produtosSelecionadosLista);
  const totalEtiquetas = itens.reduce((soma, i) => soma + i.quantidade, 0);

  const { modelo, html } = Etiquetas.gerarHtmlFolhaEtiquetas(itens, modeloId, config, usuarioLogadoNomeEmpresa);

  fecharModalEtiquetas();

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'etiquetasPreviewWrap';
  wrap.innerHTML = `
    <div class="modal modal-preview-etiquetas">
      <h2>Pré-visualização</h2>
      <p class="hint" style="margin:-8px 0 14px;">${totalEtiquetas} etiqueta${totalEtiquetas > 1 ? 's' : ''} · ${escaparHtml(modelo.nome)}</p>
      <div class="etiquetas-preview-scroll">
        <style>${Etiquetas._cssEtiquetas(modelo)}</style>
        <div class="folha-etiquetas etiquetas-preview-folha">${html}</div>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" id="btnVoltarConfigEtiquetas">Voltar</button>
        <button class="btn primary" id="btnImprimirEtiquetasFinal">🖨 Imprimir</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharPreviewEtiquetas(); });
  document.getElementById('btnVoltarConfigEtiquetas').addEventListener('click', () => {
    fecharPreviewEtiquetas();
    abrirConfigEtiquetas();
  });
  document.getElementById('btnImprimirEtiquetasFinal').addEventListener('click', () => {
    imprimirEtiquetas(itens, modeloId, config);
  });
}

/** Abre uma aba nova só com a folha de etiquetas (CSS de impressão isolado do resto do app) e dispara o print(). */
function imprimirEtiquetas(itens, modeloId, config) {
  const documentoHtml = Etiquetas.gerarDocumentoImpressaoEtiquetas(itens, modeloId, config, usuarioLogadoNomeEmpresa);
  const janela = window.open('', '_blank');
  if (!janela) {
    alert('Não foi possível abrir a janela de impressão. Verifique se o navegador está bloqueando pop-ups.');
    return;
  }
  janela.document.open();
  janela.document.write(documentoHtml);
  janela.document.close();
  janela.onload = () => {
    janela.focus();
    janela.print();
  };

  fecharPreviewEtiquetas();
  cancelarSelecaoEtiquetas();
}

// --- Inicialização ---

document.querySelectorAll('[data-tab]').forEach(botao => {
  botao.addEventListener('click', () => {
    if (modoSelecaoEtiquetas && botao.dataset.tab !== 'estoque') cancelarSelecaoEtiquetas();
    abaAtual = botao.dataset.tab;
    renderizarTudo();
  });
});

document.getElementById('btnAddProduct').addEventListener('click', () => abrirModalProduto(null));
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
 */
function aplicarRestricoesDePapel(papel) {
  const abasPorPapel = {
    dono: ['estoque', 'venda', 'historico', 'atividades', 'conta', 'assinatura', 'contato'],
    vendedor: ['venda', 'conta', 'contato'],
    estoquista: ['estoque', 'conta', 'contato']
  };
  const permitidas = abasPorPapel[papel] || abasPorPapel.dono;

  document.querySelectorAll('[data-tab]').forEach(botao => {
    botao.style.display = permitidas.includes(botao.dataset.tab) ? '' : 'none';
  });

  // Importação de Produtos segue a mesma regra de acesso do cadastro de
  // produtos: dono e estoquista podem, vendedor não vê a opção.
  const podeImportar = papel === 'dono' || papel === 'estoquista';
  document.querySelectorAll('[data-acao="importar-produtos"]').forEach(botao => {
    botao.style.display = podeImportar ? '' : 'none';
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
  usuarioLogadoNomeEmpresa = usuario.nomeEmpresa || '';
  usuarioLogadoNomeDono = usuario.nomeDono || '';
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
  if (!jaViuOnboarding && produtosCache.length === 0) {
    abrirOnboarding();
  } else if (produtosCache.length > 0) {
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

iniciar();