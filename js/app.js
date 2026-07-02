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

function renderizarEstatisticas() {
  const { totalItens, valorEmEstoque, estoqueBaixo } = Produtos.calcularEstatisticas(produtosCache);
  document.getElementById('statItems').textContent = totalItens;
  document.getElementById('statValue').textContent = formatarMoeda(valorEmEstoque).replace('R$ ', 'R$');
  document.getElementById('statLow').textContent = estoqueBaixo;
}

function renderizarAbas() {
  document.querySelectorAll('nav.tabs button').forEach(botao => {
    botao.classList.toggle('active', botao.dataset.tab === abaAtual);
  });
  document.getElementById('fabWrap').style.display = abaAtual === 'estoque' ? 'block' : 'none';
}

function renderizarConteudo() {
  const main = document.getElementById('main');

  if (abaAtual === 'estoque') {
    if (produtosCache.length === 0) {
      main.innerHTML = telaVaziaEstoque();
    } else {
      const dica = `<p class="dica-venda">Toque em <strong>Vender</strong> no produto para montar a cobrança</p>`;
      main.innerHTML = dica + produtosCache.map(cartaoProduto).join('');
    }
  } else {
    if (vendasCache.length === 0) {
      main.innerHTML = telaVaziaVendas();
    } else {
      main.innerHTML = vendasCache.map(linhaVenda).join('');
    }
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

  return `<div class="product-card">
    <div class="info" onclick="abrirEdicao('${produto.id}')">
      <div class="name">${escaparHtml(produto.nome)}</div>
      <div class="meta">
        <span class="price">${formatarMoeda(produto.preco)}</span>
        <span class="stock ${estoqueBaixo ? 'low' : ''}">${produto.estoque} em estoque</span>
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

function linhaVenda(venda) {
  const data = new Date(venda.data);
  const dataFormatada = data.toLocaleDateString('pt-BR') + ' · ' +
    data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const nomesItens = venda.itens.map(i => `${i.quantidade}x ${i.nome}`).join(', ');

  return `<div class="sale-row">
    <div>
      <div class="d">${dataFormatada}</div>
      <div class="n">${escaparHtml(nomesItens)}</div>
    </div>
    <div class="t">${formatarMoeda(venda.total)}</div>
  </div>`;
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

  renderizarConteudo();
  renderizarCarrinho();
}

// --- Modal de produto ---

function abrirModalProduto(produto) {
  idEmEdicao = produto ? produto.id : null;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'productModalWrap';
  wrap.innerHTML = `
    <div class="modal">
      <h2>${produto ? 'Editar produto' : 'Novo produto'}</h2>
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
          <label for="fEstoque">Estoque</label>
          <input id="fEstoque" type="number" inputmode="numeric" min="0" placeholder="0" value="${produto ? produto.estoque : ''}">
        </div>
      </div>
      <div class="field">
        <label for="fMinimo">Avisar quando estoque chegar em</label>
        <input id="fMinimo" type="number" inputmode="numeric" min="0" placeholder="Ex: 5" value="${produto && produto.estoqueMinimo ? produto.estoqueMinimo : ''}">
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

  const btnCancelar = document.getElementById('btnCancelar');
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);

  const btnExcluir = document.getElementById('btnExcluir');
  if (btnExcluir) btnExcluir.addEventListener('click', () => excluirProdutoComConfirmacao(produto.id));

  setTimeout(() => document.getElementById('fNome').focus(), 50);
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
  const estoqueMinimo = parseInt(document.getElementById('fMinimo').value, 10);

  try {
    if (idEmEdicao) {
      await Produtos.editarProduto(idEmEdicao, { nome, preco, estoque, estoqueMinimo });
    } else {
      await Produtos.criarProduto({ nome, preco, estoque, estoqueMinimo });
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
      <button class="btn primary" id="btnConfirmar" style="width:100%;">Confirmar cobrança</button>
      <button class="btn ghost" id="btnVoltar" style="width:100%;margin-top:10px;">Voltar</button>
    </div>`;
  document.body.appendChild(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnVoltar').addEventListener('click', () => wrap.remove());
  document.getElementById('btnConfirmar').addEventListener('click', async () => {
    await Vendas.registrarVenda(itens);
    carrinho = {};
    await recarregarDados();
    wrap.remove();
    renderizarTudo();
  });
}

// --- Inicialização ---

document.querySelectorAll('nav.tabs button').forEach(botao => {
  botao.addEventListener('click', () => {
    abaAtual = botao.dataset.tab;
    renderizarTudo();
  });
});

document.getElementById('btnAddProduct').addEventListener('click', () => abrirModalProduto(null));
document.getElementById('btnCobrar').addEventListener('click', abrirComprovante);

async function iniciar() {
  document.getElementById('dateLabel').textContent = dataDeHoje();
  await recarregarDados();
  renderizarTudo();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Service worker não registrado:', err);
    });
  }
}

iniciar();
