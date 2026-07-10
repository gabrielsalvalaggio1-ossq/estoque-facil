/**
 * ui-onboarding-importacao.js
 * Onboarding, tela de boas-vindas com insights e o wizard de Importação de Produtos.
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-onboarding-importacao.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

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
    const { totalItens, estoqueBaixo } = Produtos.calcularEstatisticas(produtosCache);
    cards.push({ id: 'totalProdutos', icone: '📦', label: 'Produtos cadastrados', valor: String(totalItens), nota: '' });
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
  { id: 'danfe',   rotulo: 'DANFE (PDF)',    emoji: '📃', disponivel: true },
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
    <button class="btn ghost" id="btnFecharImport" style="width:60%;margin-top:14px;">Cancelar</button>
  `;
}

// --- Passo 2: upload ---

function passoUploadHtml() {
  const s = estadoImportacao;
  const rotuloOrigem = ORIGENS_IMPORTACAO.find(o => o.id === s.origem)?.rotulo || '';
  const aceita = { xlsx: '.xlsx,.xls', csv: '.csv', xml_nfe: '.xml', danfe: '.pdf' }[s.origem] || '';

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
    } else if (s.origem === 'danfe') {
      resultado = await Importacao.parsearPdfDanfe(arquivo);
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
      if (estadoImportacao.origem === 'xml_nfe' || estadoImportacao.origem === 'danfe') {
        // XML da NF-e e PDF da DANFE já vêm mapeados — pula direto pra validação/pré-visualização.
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
          mostrarToast((erro && erro.message) || 'Não foi possível exportar os erros.', 'erro');
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

