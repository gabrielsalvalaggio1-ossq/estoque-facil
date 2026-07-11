/**
 * ui-etiquetas.js
 * Impressão de etiquetas (seleção de produtos, config e preview).
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-etiquetas.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

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
          <option value="personalizado">Personalizado (inserir medidas)</option>
        </select>
      </div>

      <div class="field" id="campoPersonalizado" style="display:none;">
        <label>Medidas personalizadas</label>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <label style="display:flex; flex-direction:column; gap:3px; font-size:13px;">
            Largura (mm)
            <input type="number" id="fLarguraMm" min="10" max="300" step="0.5" value="50" class="filtro-select" style="width:90px;">
          </label>
          <label style="display:flex; flex-direction:column; gap:3px; font-size:13px;">
            Altura (mm)
            <input type="number" id="fAlturaMm" min="10" max="300" step="0.5" value="30" class="filtro-select" style="width:90px;">
          </label>
          <label style="display:flex; flex-direction:column; gap:3px; font-size:13px;">
            Tipo de folha
            <select id="fFolhaPersonalizado" class="filtro-select" style="width:160px;">
              <option value="continua">Rolo / Térmica</option>
              <option value="grade-a4">Folha A4 adesiva</option>
            </select>
          </label>
        </div>
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
        <label for="fAlturaCodigoBarras">Altura do código de barras</label>
        <select id="fAlturaCodigoBarras" class="filtro-select">
          <option value="10">Pequena</option>
          <option value="14" selected>Média</option>
          <option value="18">Grande</option>
        </select>
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
  aplicarFocusTrap(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModalEtiquetas(); });
  document.getElementById('btnCancelarConfigEtiquetas').addEventListener('click', fecharModalEtiquetas);
  document.getElementById('btnPreVisualizarEtiquetas').addEventListener('click', () => {
    abrirPreviewEtiquetas(produtosSelecionadosLista);
  });

  // Mostra/oculta campos de medidas personalizadas
  document.getElementById('fModeloEtiqueta').addEventListener('change', function() {
    document.getElementById('campoPersonalizado').style.display =
      this.value === 'personalizado' ? '' : 'none';
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
  const selectAltura = document.getElementById('fAlturaCodigoBarras');
  return {
    exibir: {
      nome: document.getElementById('checkNome').checked,
      codigoInterno: document.getElementById('checkCodigoInterno').checked,
      codigoBarras: document.getElementById('checkCodigoBarras').checked,
      preco: document.getElementById('checkPreco').checked,
      empresa: document.getElementById('checkEmpresa').checked
    },
    alturaCodigoBarras: selectAltura ? parseFloat(selectAltura.value) : null
  };
}

function _coletarModeloCustom() {
  const modeloId = document.getElementById('fModeloEtiqueta').value;
  if (modeloId !== 'personalizado') return null;
  const largura = parseFloat(document.getElementById('fLarguraMm').value) || 50;
  const altura = parseFloat(document.getElementById('fAlturaMm').value) || 30;
  const folha = document.getElementById('fFolhaPersonalizado').value;
  return Etiquetas.criarModeloPersonalizado(largura, altura, folha);
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
  const modeloCustom = _coletarModeloCustom();
  const itens = _coletarItensEtiquetas(produtosSelecionadosLista);
  const totalEtiquetas = itens.reduce((soma, i) => soma + i.quantidade, 0);

  const { modelo, html } = Etiquetas.gerarHtmlFolhaEtiquetas(itens, modeloId, config, usuarioLogadoNomeEmpresa, modeloCustom);

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
  aplicarFocusTrap(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) fecharPreviewEtiquetas(); });
  document.getElementById('btnVoltarConfigEtiquetas').addEventListener('click', () => {
    fecharPreviewEtiquetas();
    abrirConfigEtiquetas();
  });
  document.getElementById('btnImprimirEtiquetasFinal').addEventListener('click', () => {
    imprimirEtiquetas(itens, modeloId, config, modeloCustom);
  });
}

/** Abre uma aba nova só com a folha de etiquetas (CSS de impressão isolado do resto do app) e dispara o print(). */
function imprimirEtiquetas(itens, modeloId, config, modeloCustom) {
  const documentoHtml = Etiquetas.gerarDocumentoImpressaoEtiquetas(itens, modeloId, config, usuarioLogadoNomeEmpresa, modeloCustom);
  const janela = window.open('', '_blank');
  if (!janela) {
    mostrarToast('Não foi possível abrir a janela de impressão. Verifique se o navegador está bloqueando pop-ups.', 'info');
    return;
  }

  // Fecha a UI do app ANTES de focar a janela de impressão — assim o
  // MutationObserver do focus-trap descarta o elementoAnterior enquanto o
  // foco ainda está no documento principal, evitando que o foco suma.
  fecharPreviewEtiquetas();
  cancelarSelecaoEtiquetas();

  janela.document.open();
  janela.document.write(documentoHtml);
  janela.document.close();

  // Não usamos janela.onload: após document.write + document.close em uma
  // janela aberta por window.open, o onload frequentemente já disparou
  // (Chrome/mobile) ou nunca dispara (Safari), deixando o print() sem ser
  // chamado. setTimeout de 0 ms garante que o browser termine de parsear o
  // documento antes de acionar o diálogo de impressão.
  setTimeout(() => {
    try {
      janela.focus();
      janela.print();
    } catch (e) {
      // Janela pode ter sido fechada manualmente pelo usuário — ignora.
    }
  }, 0);
}