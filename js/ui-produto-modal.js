/**
 * ui-produto-modal.js
 * Modal de criar/editar produto (foto, unidade, preço de custo).
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-produto-modal.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

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
          ${imagemPendente ? `<img src="${escaparHtml(imagemPendente)}" alt="">` : ICONE_PRODUTO_PLACEHOLDER}
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
        ${produto ? '<button class="btn ghost" id="btnDuplicar">Duplicar</button>' : ''}
        <button class="btn primary" id="btnSalvar">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);

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
      mostrarToast('Não foi possível usar essa foto. Tente outra.', 'erro');
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

  const btnDuplicar = document.getElementById('btnDuplicar');
  if (btnDuplicar) btnDuplicar.addEventListener('click', () => duplicarProdutoAtual(produto));

  setTimeout(() => document.getElementById('fNome').focus(), 50);
}

/** Atualiza a área de pré-visualização da foto e os botões (mostra/some "Remover"). */
function atualizarPreviewFoto() {
  const preview = document.getElementById('fotoPreview');
  preview.innerHTML = imagemPendente ? `<img src="${escaparHtml(imagemPendente)}" alt="">` : ICONE_PRODUTO_PLACEHOLDER;

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

/**
 * T5: cria uma cópia do produto (nome + " (cópia)", estoque zerado, sem
 * código de barras — ver Produtos.duplicarProduto) e recarrega a lista.
 * Fica no modal de edição porque é a ação mais natural quando o lojista já
 * está olhando pro produto que quer duplicar (ex: variações de cor/tamanho).
 */
async function duplicarProdutoAtual(produto) {
  const btn = document.getElementById('btnDuplicar');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Duplicando…';
  try {
    await Produtos.duplicarProduto(produto);
    await recarregarDados();
    fecharModal();
    renderizarTudo();
    mostrarToast('Produto duplicado. Edite a cópia para ajustar o que for diferente.', 'sucesso');
  } catch (e) {
    mostrarErroFormulario(e.message || 'Não foi possível duplicar o produto. Tente novamente.');
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function mostrarErroFormulario(mensagem) {
  const erro = document.getElementById('erroForm');
  erro.textContent = mensagem;
  erro.style.display = 'block';
}

