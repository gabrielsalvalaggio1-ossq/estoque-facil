/**
 * ui-base.js
 * Estado global do app, formatação (moeda/data), toasts/confirm, foto do produto, leitor de código de barras.
 * Deve ser o primeiro script de UI carregado — os demais módulos ui-*.js dependem do estado e helpers definidos aqui.
 */

/**
 * ui-base.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

/**
 * app.js
 * Interface: renderização de telas e eventos de clique.
 * Toda regra de negócio vive em produtos.js e vendas.js — aqui só chamamos.
 */

let produtosCache = [];
let vendasCache = [];
let clientesCache = [];
let carrinho = {}; // { produtoId: quantidade }
let abaAtual = 'estoque';
let idEmEdicao = null;
let idClienteEmEdicao = null;
let clienteIdSelecionadoNaVenda = null; // preenchido quando um cliente cadastrado é escolhido no autocomplete da cobrança
let formaPagamentoEscolhida = 'dinheiro';

let filtroEstoque = { busca: '', categoria: '', fornecedor: '', situacao: 'todos', agrupar: 'nenhum' };
let filtroVendas = { periodo: 'todas', status: 'todas' };
let buscaCliente = '';

// Estado do wizard de Importação de Produtos (ver seção "Importação de
// Produtos" mais abaixo). Fica em memória só durante o wizard aberto.
let estadoImportacao = null;
let buscaVenda = '';
let categoriaVenda = '';
let imagemPendente = null; // base64 da foto escolhida/tirada, ainda não salva
let streamScannerAtivo = null;
let unidadeSelecionada = 'un'; // 'un' | 'kg' — estado do toggle de unidade no formulário de produto

// Set de IDs de vendas cujo cancelamento já está em andamento — evita duplo clique.
const cancelamentoEmAndamento = new Set();
const quitacaoEmAndamento = new Set();

// --- Impressão de etiquetas (ver js/etiquetas.js pro motor de geração) ---
let modoSelecaoEtiquetas = false;
let produtosSelecionadosEtiquetas = new Set(); // ids dos produtos marcados

// --- T5: Ações em lote no Estoque (ver js/selecao-lote.js) ---
let modoSelecaoLote = false;
let produtosSelecionadosLote = new Set(); // ids dos produtos marcados para excluir/mudar categoria em lote
let usuarioLogadoNomeEmpresa = ''; // usado no campo opcional "nome da empresa" da etiqueta
let usuarioLogadoNomeDono = ''; // nome de quem criou a empresa (dono)

const ROTULOS_PAGAMENTO = {
  dinheiro: '💵 Dinheiro',
  pix: '🔑 Pix',
  cartao: '💳 Cartão',
  fiado: '📝 Fiado'
};

/**
 * T15: acessibilidade — prende o foco de Tab/Shift+Tab dentro de um modal
 * enquanto ele estiver aberto, e devolve o foco pro elemento que abriu o
 * modal quando ele for removido. Sem isso, Tab escapa para trás do modal
 * (para elementos escondidos atrás do overlay), o que é uma armadilha de
 * navegação por teclado para quem não usa mouse/toque.
 * Uso: chamar logo depois de `document.body.appendChild(wrap)`.
 */
function aplicarFocusTrap(wrap) {
  // Captura o elemento com foco AGORA — mas só vai usar se ainda estiver
  // no DOM e visível quando o modal fechar.
  const elementoAnterior = document.activeElement;
  wrap.setAttribute('role', wrap.getAttribute('role') || 'dialog');
  wrap.setAttribute('aria-modal', 'true');

  const seletorFocavel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const aoPressionarTab = (e) => {
    if (e.key !== 'Tab') return;
    const focaveis = Array.from(wrap.querySelectorAll(seletorFocavel)).filter(el => !el.disabled && el.offsetParent !== null);
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };
  wrap.addEventListener('keydown', aoPressionarTab);

  function devolverFoco() {
    // Só devolve o foco se o elemento estiver no DOM E visível
    // (offsetParent === null = display:none — .focus() nesse estado
    // faz o foco sumir do documento, travando o app).
    const estaNoDOM   = elementoAnterior && document.body.contains(elementoAnterior);
    const estaVisivel = estaNoDOM && elementoAnterior.offsetParent !== null;
    if (estaVisivel && typeof elementoAnterior.focus === 'function') {
      elementoAnterior.focus();
    } else {
      // Fallback seguro: body sempre existe e sempre está visível.
      document.body.focus();
    }
  }

  // Guarda a função de limpeza no próprio wrap para que fechar*() possa
  // desconectar o observer ANTES de remover o elemento do DOM, eliminando
  // a corrida entre o observer do modal que fecha e o aplicarFocusTrap()
  // do modal que abre em seguida (bug "Voltar" no fluxo de etiquetas).
  const observer = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      observer.disconnect();
      devolverFoco();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Expõe desconexão manual no wrap: chame wrap._ftDisconnect() antes de
  // remover o wrap quando houver outro modal abrindo na sequência.
  wrap._ftDisconnect = () => {
    observer.disconnect();
    wrap.removeEventListener('keydown', aoPressionarTab);
  };
}

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

/**
 * Estado vazio genérico e mais amigável — usado quando uma lista está
 * completamente vazia (nenhum produto/venda/cliente cadastrado ainda), e
 * não apenas sem resultado para um filtro (isso é criarSemResultado, em
 * estados.js). Ícone grande + título + dica curta, com um botão de ação
 * opcional (o próprio chamador conecta o clique, já que cada tela tem sua
 * própria forma de abrir o cadastro correspondente).
 */
function criarEstadoVazio({ icone = '📭', titulo = '', dica = '', acaoLabel = '', acaoId = '' } = {}) {
  return `
    <div class="empty empty-amigavel">
      <span class="empty-icone" aria-hidden="true">${icone}</span>
      <p class="titulo">${escaparHtml(titulo)}</p>
      ${dica ? `<p class="hint">${escaparHtml(dica)}</p>` : ''}
      ${acaoLabel && acaoId ? `<button type="button" class="btn primary empty-acao" id="${escaparHtml(acaoId)}">${escaparHtml(acaoLabel)}</button>` : ''}
    </div>
  `;
}

function dataDeHoje() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function recarregarDados() {
  const precisaProdutos = true;
  const precisaVendas   = usuarioLogadoPapel !== 'estoquista';
  const precisaClientes = usuarioLogadoPapel === 'dono' || usuarioLogadoPapel === 'vendedor';

  const [produtos, vendas, clientes] = await Promise.all([
    precisaProdutos ? Produtos.listarProdutos() : Promise.resolve(produtosCache),
    precisaVendas   ? Vendas.listarVendas()     : Promise.resolve(vendasCache),
    precisaClientes ? DB.listarClientes()       : Promise.resolve(clientesCache),
  ]);
  produtosCache = produtos;
  vendasCache   = vendas;
  clientesCache = clientes;

  // Carrega a assinatura em segundo plano só pra quem é dono — é quem vê o
  // pill de plano na Equipe e a aba Minha Assinatura. Erro aqui não deve
  // travar o resto do app (por isso não tem await bloqueando, nem throw).
  if (usuarioLogadoPapel === 'dono') {
    DB.buscarAssinatura().then(a => { assinaturaCache = a; }).catch(() => {});
  }

  // Atualiza o widget de "primeiros passos" (definido em
  // ui-onboarding-importacao.js) sempre que os dados mudam — é o ponto
  // central por onde praticamente toda ação do app passa depois de salvar.
  if (typeof atualizarChecklistPrimeirosPassos === 'function') {
    atualizarChecklistPrimeirosPassos();
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

/** Formata um número de bytes em KB / MB legível para o usuário. */
function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Notificações e diálogos do próprio app (substituem alert / confirm nativos) ---

/**
 * Exibe uma notificação temporária no fundo da tela.
 * Não bloqueia a thread — o usuário pode continuar interagindo.
 * tipo: 'info' | 'erro' | 'sucesso'
 */
function mostrarToast(mensagem, tipo = 'info') {
  document.getElementById('appToast')?.remove();
  const el = document.createElement('div');
  el.id = 'appToast';
  el.className = `app-toast app-toast--${tipo}`;
  el.textContent = mensagem;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('app-toast--visivel'));
  const fechar = () => {
    el.classList.remove('app-toast--visivel');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  };
  el.addEventListener('click', fechar);
  setTimeout(fechar, 4000);
}

/**
 * Exibe um diálogo de confirmação dentro do app (substitui confirm()).
 * Retorna Promise<boolean> — true se o usuário confirmou, false se cancelou.
 * opcoes: { confirmText, cancelText, tipo ('perigo' | 'default') }
 */
function mostrarConfirm(mensagem, { confirmText = 'Confirmar', cancelText = 'Cancelar', tipo = 'default' } = {}) {
  return new Promise((resolver) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap modal-wrap-centro';
    wrap.innerHTML = `
      <div class="confirm-dialog">
        <p class="confirm-msg">${escaparHtml(mensagem)}</p>
        <div class="confirm-actions">
          <button class="btn ghost" id="confirmNao">${escaparHtml(cancelText)}</button>
          <button class="btn ${tipo === 'perigo' ? 'danger' : 'primary'}" id="confirmSim">${escaparHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    aplicarFocusTrap(wrap);
    const fechar = (resultado) => { wrap.remove(); resolver(resultado); };
    document.getElementById('confirmNao').addEventListener('click', () => fechar(false));
    document.getElementById('confirmSim').addEventListener('click', () => fechar(true));
    // Clique no fundo escuro cancela (o handler global de ESC também funciona
    // porque o wrap usa a classe .modal-wrap e o evento é target === wrap)
    wrap.addEventListener('click', (e) => { if (e.target === wrap) fechar(false); });
    setTimeout(() => document.getElementById('confirmSim').focus(), 50);
  });
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
      mostrarToast(`Nenhum produto cadastrado com o código ${codigo}.`, 'erro');
      return;
    }
    if (produto.estoque <= 0) {
      mostrarToast(`${produto.nome} está sem estoque.`, 'info');
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