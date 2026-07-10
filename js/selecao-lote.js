/**
 * selecao-lote.js
 * T5: ações em lote na aba Estoque — selecionar vários produtos de uma vez
 * para excluir ou mudar a categoria de todos, sem precisar abrir e salvar
 * o formulário produto por produto.
 *
 * Segue o mesmo padrão já usado pela seleção de etiquetas (ui-etiquetas.js):
 * modo de seleção próprio, barra flutuante com contagem/ações, sem tocar no
 * fluxo normal de edição de produto. Depende de estado e helpers definidos
 * em ui-base.js (carregado antes deste).
 */

function ativarModoSelecaoLote() {
  if (modoSelecaoEtiquetas) cancelarSelecaoEtiquetas();
  modoSelecaoLote = true;
  produtosSelecionadosLote = new Set();
  document.getElementById('selecaoLoteBar').style.display = 'flex';
  document.getElementById('btnAddProduct').style.display = 'none';
  document.getElementById('btnEscanearVender').style.display = 'none';
  document.getElementById('btnSelecionarEtiquetas').style.display = 'none';
  document.getElementById('btnSelecionarLote').style.display = 'none';
  atualizarBarraSelecaoLote();
  atualizarListaProdutos();
}

function cancelarSelecaoLote() {
  modoSelecaoLote = false;
  produtosSelecionadosLote = new Set();
  document.getElementById('selecaoLoteBar').style.display = 'none';
  document.getElementById('btnAddProduct').style.display = '';
  document.getElementById('btnEscanearVender').style.display = '';
  document.getElementById('btnSelecionarEtiquetas').style.display = '';
  document.getElementById('btnSelecionarLote').style.display = '';
  atualizarListaProdutos();
}

function alternarSelecaoProdutoLote(id) {
  if (produtosSelecionadosLote.has(id)) {
    produtosSelecionadosLote.delete(id);
  } else {
    produtosSelecionadosLote.add(id);
  }
  atualizarBarraSelecaoLote();
  atualizarListaProdutos();
}

function atualizarBarraSelecaoLote() {
  const n = produtosSelecionadosLote.size;
  document.getElementById('selecaoLoteCount').textContent =
    n === 0 ? 'Nenhum produto selecionado' : `${n} produto${n > 1 ? 's' : ''} selecionado${n > 1 ? 's' : ''}`;
  document.getElementById('btnExcluirSelecionadosLote').disabled = n === 0;
  document.getElementById('btnMudarCategoriaLote').disabled = n === 0;
}

async function confirmarExclusaoLote() {
  const ids = Array.from(produtosSelecionadosLote);
  if (!ids.length) return;

  const confirmou = await mostrarConfirm(
    `Excluir ${ids.length} produto${ids.length > 1 ? 's' : ''} selecionado${ids.length > 1 ? 's' : ''}? Essa ação não pode ser desfeita.`,
    { confirmText: 'Excluir', cancelText: 'Cancelar', tipo: 'perigo' }
  );
  if (!confirmou) return;

  const btn = document.getElementById('btnExcluirSelecionadosLote');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Excluindo…';

  try {
    await Produtos.excluirProdutosEmLote(ids);
    await recarregarDados();
    cancelarSelecaoLote();
    renderizarTudo();
    mostrarToast(`${ids.length} produto${ids.length > 1 ? 's excluídos' : ' excluído'} com sucesso.`, 'sucesso');
  } catch (erro) {
    mostrarToast(erro.message || 'Não foi possível excluir os produtos selecionados. Verifique sua conexão e tente novamente.', 'erro');
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

/** Modal simples para escolher a nova categoria dos produtos selecionados. */
function abrirAlterarCategoriaLote() {
  const ids = Array.from(produtosSelecionadosLote);
  if (!ids.length) return;

  const categorias = Produtos.listarCategorias(produtosCache);

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'categoriaLoteModalWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'tituloCategoriaLote');
  wrap.innerHTML = `
    <div class="modal">
      <h2 id="tituloCategoriaLote">Mudar categoria</h2>
      <p class="hint-unidade" style="margin-top:-8px;">
        ${ids.length} produto${ids.length > 1 ? 's selecionados' : ' selecionado'}.
      </p>

      <div class="field">
        <label for="fCategoriaLote">Nova categoria</label>
        <input id="fCategoriaLote" type="text" list="listaCategoriasLote" placeholder="Ex: Bebidas">
        <datalist id="listaCategoriasLote">
          ${categorias.map(c => `<option value="${escaparHtml(c)}">`).join('')}
        </datalist>
      </div>

      <p class="erro" id="erroCategoriaLote" style="display:none;"></p>
      <div class="modal-actions">
        <button class="btn ghost" id="btnCancelarCategoriaLote">Cancelar</button>
        <button class="btn primary" id="btnConfirmarCategoriaLote">Aplicar</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  aplicarFocusTrap(wrap);

  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.getElementById('btnCancelarCategoriaLote').addEventListener('click', () => wrap.remove());
  document.getElementById('btnConfirmarCategoriaLote').addEventListener('click', () => confirmarAlterarCategoriaLote(ids, wrap));

  setTimeout(() => document.getElementById('fCategoriaLote').focus(), 50);
}

async function confirmarAlterarCategoriaLote(ids, wrap) {
  const campo = document.getElementById('fCategoriaLote');
  const erro = document.getElementById('erroCategoriaLote');
  const categoria = campo.value.trim();
  if (!categoria) {
    erro.textContent = 'Digite o nome da categoria.';
    erro.style.display = 'block';
    return;
  }

  const btn = document.getElementById('btnConfirmarCategoriaLote');
  btn.disabled = true;
  btn.textContent = 'Aplicando…';

  try {
    await Produtos.alterarCategoriaEmLote(produtosCache, ids, categoria);
    await recarregarDados();
    wrap.remove();
    cancelarSelecaoLote();
    renderizarTudo();
    mostrarToast(`Categoria atualizada para ${ids.length} produto${ids.length > 1 ? 's' : ''}.`, 'sucesso');
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível mudar a categoria. Tente novamente.';
    erro.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Aplicar';
  }
}
