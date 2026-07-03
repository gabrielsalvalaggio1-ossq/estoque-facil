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
let imagemPendente = null; // base64 da foto escolhida/tirada, ainda não salva
let streamScannerAtivo = null;

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
  produtosCache = await Produtos.listarProdutos();
  vendasCache = await Vendas.listarVendas();
}

async function buscarEmailUsuario() {
  try {
    const res = await fetch('/me');
    const data = await res.json();
    return data.email;
  } catch (e) {
    return null;
  }
}
async function atualizarEmailConta() {
  const email = await buscarEmailUsuario();
  const el = document.getElementById('emailUsuario');

  if (el) {
    el.textContent = email || 'Não logado';
  }
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
    abaAtual = 'estoque';
    alterarCarrinho(produto.id, 1);
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
    const dica = `<p class="dica-venda">Toque em <strong>Vender</strong> no produto para montar a cobrança</p>`;
    container.innerHTML = dica + filtrados.map(cartaoProduto).join('');
  }
}

function telaVaziaEstoque() {
  return `<div class="empty">
    <p class="titulo">Nenhum produto ainda</p>
    <p class="hint">Toque no + para cadastrar seu primeiro item.</p>
  </div>`;
}

function telaVaziaVendas() {
  return `<div class="empty">
    <p class="titulo">Nenhuma venda registrada</p>
    <p class="hint">Suas cobranças aparecem aqui.</p>
  </div>`;
}

function cartaoProduto(produto) {
  const estoqueBaixo = produto.estoque <= (produto.estoqueMinimo || 0);
  const qtdNoCarrinho = carrinho[produto.id] || 0;
  const semEstoqueParaAdicionar = qtdNoCarrinho >= produto.estoque;
  const categoria = produto.categoria || Produtos.CATEGORIA_PADRAO;
  const miniatura = produto.imagem
    ? `<img src="${produto.imagem}" alt="" class="thumb">`
    : `<span class="thumb thumb-placeholder">${ICONE_PRODUTO_PLACEHOLDER}</span>`;

  return `<div class="product-card">
    ${miniatura}
    <div class="info" onclick="abrirEdicao('${produto.id}')">
      <div class="name">${escaparHtml(produto.nome)}</div>
      <div class="meta">
        <span class="price">${formatarMoeda(produto.preco)}</span>
        <span class="stock ${estoqueBaixo ? 'low' : ''}">${produto.estoque} em estoque</span>
        <span class="cat">${escaparHtml(categoria)}</span>
      </div>
    </div>
    <div class="actions">
      ${qtdNoCarrinho > 0 ? `
        <button class="qtybtn" onclick="alterarCarrinho('${produto.id}', -1)" aria-label="Remover um">–</button>
        <span class="qtd">${qtdNoCarrinho}</span>
        <button class="qtybtn add" onclick="alterarCarrinho('${produto.id}', 1)"
          ${semEstoqueParaAdicionar ? 'disabled' : ''} aria-label="Adicionar mais um">+</button>
      ` : `
        <button class="sellbtn" onclick="alterarCarrinho('${produto.id}', 1)"
          ${produto.estoque <= 0 ? 'disabled' : ''}>Vender</button>
      `}
    </div>
  </div>`;
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
  const nomesItens = venda.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ');
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

async function cancelarVendaComConfirmacao(id) {
  if (!confirm('Cancelar esta venda? O estoque dos produtos será devolvido.')) return;
  await Vendas.cancelarVenda(id);
  await recarregarDados();
  renderizarTudo();
}

// --- Render geral ---

function renderizarConteudo() {
  const main = document.getElementById('main');

  if (abaAtual === 'estoque') {
    main.innerHTML = barraFiltrosEstoque();
    atualizarListaProdutos();
  }

  else if (abaAtual === 'vendas') {
    main.innerHTML = barraFiltrosVendas();
    atualizarListaVendas();
  }

  else if (abaAtual === 'contato') {
    main.innerHTML = `
      <div class="pagina">
        <h2>Contato</h2>
        <p>Se precisar de ajuda, fale com o suporte.</p>

        <div class="card">
          <p><strong>Email:</strong> suporte@estoqueapp.com</p>
          <p><strong>WhatsApp:</strong> (51) 99999-9999</p>
        </div>
      </div>
    `;
  }

  else if (abaAtual === 'conta') {
  main.innerHTML = `
    <div class="pagina">
      <h2>Conta</h2>

      <div class="card">
        <p><strong>Email:</strong> <span id="emailUsuario">Carregando...</span></p>

        <p><strong>Status:</strong> Usuário gratuito</p>
        <p><strong>Produtos cadastrados:</strong> ${produtosCache.length}</p>
        <p><strong>Vendas registradas:</strong> ${vendasCache.length}</p>
      </div>

      <button class="btn primary" onclick="abrirMenuExportar()">
        Exportar dados
      </button>
    </div>
  `;

  setTimeout(atualizarEmailConta, 0);
}
}

function renderizarCarrinho() {
  const ids = Object.keys(carrinho);
  const totalItens = ids.reduce((soma, id) => soma + carrinho[id], 0);
  const totalValor = ids.reduce((soma, id) => {
    const produto = produtosCache.find(p => p.id === id);
    return soma + (produto ? produto.preco * carrinho[id] : 0);
  }, 0);

  const barra = document.getElementById('cartbar');
  if (totalItens > 0) {
    barra.style.display = 'flex';
    document.getElementById('cartCount').textContent =
      totalItens === 1 ? '1 item no carrinho' : `${totalItens} itens no carrinho`;
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

  atualizarListaProdutos();
  renderizarCarrinho();
}

// --- Modal de produto ---

function abrirModalProduto(produto) {
  idEmEdicao = produto ? produto.id : null;
  imagemPendente = produto ? (produto.imagem || null) : null;
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
      <div class="row2">
        <div class="field">
          <label for="fPreco">Preço (R$)</label>
          <input id="fPreco" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" value="${produto ? produto.preco : ''}">
        </div>
        <div class="field">
          <label for="fEstoque">Quantidade</label>
          <input id="fEstoque" type="number" inputmode="numeric" min="0" placeholder="0" value="${produto ? produto.estoque : ''}">
        </div>
      </div>

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

function fecharModal() {
  const el = document.getElementById('productModalWrap');
  if (el) el.remove();
}

function mostrarErroFormulario(mensagem) {
  const erro = document.getElementById('erroForm');
  erro.textContent = mensagem;
  erro.style.display = 'block';
}

async function salvarFormularioProduto() {
  const nome = document.getElementById('fNome').value.trim();
  const preco = parseFloat(document.getElementById('fPreco').value);
  const estoque = parseInt(document.getElementById('fEstoque').value, 10);
  const campoMinimo = document.getElementById('fMinimo');
  const campoCategoria = document.getElementById('fCategoria');
  const campoCodigo = document.getElementById('fCodigoBarras');
  const estoqueMinimo = campoMinimo ? parseInt(campoMinimo.value, 10) : NaN;
  const categoria = campoCategoria ? campoCategoria.value : '';
  const codigoBarras = campoCodigo ? campoCodigo.value.trim() : '';

  try {
    if (idEmEdicao) {
      await Produtos.editarProduto(idEmEdicao, { nome, preco, estoque, estoqueMinimo, categoria, imagem: imagemPendente, codigoBarras });
    } else {
      await Produtos.criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, imagem: imagemPendente, codigoBarras });
    }
    await recarregarDados();
    fecharModal();
    renderizarTudo();
  } catch (erro) {
    mostrarErroFormulario(erro.message);
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

  const itens = ids.map(id => {
    const produto = produtosCache.find(p => p.id === id);
    return {
      produtoId: id,
      nome: produto.nome,
      quantidade: carrinho[id],
      precoUnitario: produto.preco
    };
  });
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
      ${itens.map(i => `<div class="ritem"><span><span class="qn">${i.quantidade}x</span>${escaparHtml(i.nome)}</span><span>${formatarMoeda(i.precoUnitario * i.quantidade)}</span></div>`).join('')}
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

  document.getElementById('btnConfirmar').addEventListener('click', async () => {
    const cliente = document.getElementById('fCliente').value;
    await Vendas.registrarVenda(itens, { formaPagamento: formaPagamentoEscolhida, cliente });
    carrinho = {};
    await recarregarDados();
    wrap.remove();
    renderizarTudo();
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
      <button class="opt" id="expVendas">Vendas do período<span class="d">Respeita o filtro de período aberto na aba Vendas</span></button>
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
    if (vendasDoPeriodo.length === 0) { alert('Nenhuma venda no período selecionado na aba Vendas.'); return; }
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
  wrap.className = 'modal-wrap';
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

async function iniciar() {
  document.getElementById('dateLabel').textContent = dataDeHoje();
  await recarregarDados();
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

iniciar();