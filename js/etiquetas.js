/**
 * etiquetas.js — Módulo de Impressão de Etiquetas
 *
 * Fica de propósito num arquivo separado, independente de produtos.js/app.js,
 * porque isso é o que torna fácil adicionar um modelo de etiqueta novo no
 * futuro (60x40, rolo térmico contínuo, etc): basta registrar um objeto novo
 * em MODELOS_ETIQUETA — nenhuma outra parte do código precisa mudar.
 *
 * Responsabilidades deste arquivo:
 *  1. Registro de modelos de etiqueta (tamanho físico em mm + como a folha
 *     é organizada na impressão: grade em A4 adesivo, ou etiqueta única
 *     contínua pra impressora térmica).
 *  2. Gerador de código de barras Code128 em SVG, sem nenhuma dependência
 *     externa (mesma filosofia "zero dependências" do resto do projeto —
 *     ver comentário no topo de db.js).
 *  3. Montagem do HTML de pré-visualização e do HTML final de impressão.
 *
 * Nada aqui decide QUAIS produtos foram selecionados nem desenha a tela de
 * seleção — isso é responsabilidade do app.js (fluxo/estado da UI). Este
 * módulo só sabe transformar "produtos + configuração" em HTML pronto pra
 * mostrar ou imprimir.
 */

// -------------------------------------------------------------------------
// 1. Code128 (subset B) — código de barras sem biblioteca externa.
// -------------------------------------------------------------------------

// Tabela de padrões Code128: cada índice (0-106) vira 11 módulos de
// barra/espaço (6 números = 6 larguras alternando preto/branco). Fonte: a
// especificação pública do Code128, subset B (cobre texto ASCII 32-127,
// suficiente pra código interno alfanumérico e códigos de barra numéricos).
const CODE128B_PADROES = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];
const CODE128_START_B = 104;
const CODE128_STOP = 106;

/**
 * Codifica um texto em Code128B e devolve um array de "módulos" (0 = espaço
 * branco, 1 = barra preta), já incluindo start/checksum/stop.
 * Aceita apenas caracteres ASCII 32-127 (cobre letras, números e a maioria
 * da pontuação — suficiente pra id interno e para EAN/UPC digitados).
 */
function code128Codificar(texto) {
  const valores = [CODE128_START_B];
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo < 32 || codigo > 127) continue; // caractere fora do subset B: ignora
    valores.push(codigo - 32);
  }

  let checksum = CODE128_START_B;
  for (let i = 1; i < valores.length; i++) checksum += valores[i] * i;
  valores.push(checksum % 103);
  valores.push(CODE128_STOP);

  const modulos = [];
  valores.forEach(v => {
    const padrao = CODE128B_PADROES[v];
    for (let i = 0; i < padrao.length; i++) {
      const largura = parseInt(padrao[i], 10);
      const preto = i % 2 === 0; // posições pares = barra, ímpares = espaço
      for (let j = 0; j < largura; j++) modulos.push(preto ? 1 : 0);
    }
  });
  return modulos;
}

/**
 * Gera o SVG de um código de barras Code128 pronto pra imprimir.
 * larguraMm/alturaMm definem o tamanho físico real da barra (não da label
 * inteira) — importante pra manter proporção correta em qualquer impressora.
 */
function gerarSvgCodigoBarras(texto, larguraMm, alturaMm) {
  const valor = String(texto || '').trim();
  if (!valor) return '';
  const modulos = code128Codificar(valor);
  if (!modulos.length) return '';

  const larguraModulo = larguraMm / modulos.length;
  let x = 0;
  let barras = '';
  modulos.forEach(m => {
    if (m === 1) {
      barras += `<rect x="${x.toFixed(3)}" y="0" width="${larguraModulo.toFixed(3)}" height="${alturaMm}" fill="#000"/>`;
    }
    x += larguraModulo;
  });

  return `<svg viewBox="0 0 ${larguraMm} ${alturaMm}" width="${larguraMm}mm" height="${alturaMm}mm" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${barras}</svg>`;
}

// -------------------------------------------------------------------------
// 2. Registro de modelos de etiqueta.
//
// Cada modelo define:
//  - larguraMm/alturaMm: tamanho físico da etiqueta.
//  - folha: 'grade-a4' (várias etiquetas por página, pra folha adesiva A4)
//           ou 'continua' (uma etiqueta por "página", pra impressora
//           térmica com rolo — cada @page já nasce do tamanho da etiqueta).
//  - margemMm / espacamentoMm: só usados no modo 'grade-a4'.
//
// Pra adicionar um modelo novo no futuro (ex.: rolo térmico 40x25 da Argox,
// ou etiqueta 33x25 de 3 colunas), basta acrescentar uma entrada aqui — o
// resto do módulo (preview, impressão, cálculo de barras) já funciona.
// -------------------------------------------------------------------------

const MODELOS_ETIQUETA = {
  padrao_50x30: {
    id: 'padrao_50x30',
    nome: 'Padrão 50 × 30 mm (folha A4 adesiva)',
    larguraMm: 50,
    alturaMm: 30,
    folha: 'grade-a4',
    margemMm: 8,
    espacamentoMm: 3
  },
  termica_40x25: {
    id: 'termica_40x25',
    nome: 'Rolo térmico 40 × 25 mm',
    larguraMm: 40,
    alturaMm: 25,
    folha: 'continua',
    margemMm: 0,
    espacamentoMm: 0
  },
  pequena_33x22: {
    id: 'pequena_33x22',
    nome: 'Pequena 33 × 22 mm (folha A4 adesiva)',
    larguraMm: 33,
    alturaMm: 22,
    folha: 'grade-a4',
    margemMm: 8,
    espacamentoMm: 2
  }
};

function listarModelosEtiqueta() {
  return Object.values(MODELOS_ETIQUETA);
}

// -------------------------------------------------------------------------
// 3. Montagem do HTML de cada etiqueta individual + da folha inteira.
// -------------------------------------------------------------------------

/** Foge de HTML — cópia local pra este arquivo não depender de app.js carregar antes. */
function _escaparHtmlEtiqueta(texto) {
  return String(texto == null ? '' : texto).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _formatarMoedaEtiqueta(valor) {
  return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Gera o HTML de UMA etiqueta física (pode se repetir N vezes na folha,
 * de acordo com a quantidade escolhida pra esse produto).
 *
 * config.exibir = { nome, codigoInterno, codigoBarras, preco, empresa }
 */
function _htmlDeUmaEtiqueta(produto, modelo, config, nomeEmpresa) {
  const exibir = config.exibir || {};
  const partes = [];

  if (exibir.nome) {
    partes.push(`<div class="et-nome">${_escaparHtmlEtiqueta(produto.nome)}</div>`);
  }

  const linhaMeta = [];
  if (exibir.codigoInterno) linhaMeta.push(`<span class="et-codigo">#${_escaparHtmlEtiqueta(produto.id)}</span>`);
  if (exibir.preco) linhaMeta.push(`<span class="et-preco">${_formatarMoedaEtiqueta(produto.preco)}${produto.unidade === 'kg' ? '/kg' : ''}</span>`);
  if (linhaMeta.length) partes.push(`<div class="et-meta">${linhaMeta.join('')}</div>`);

  if (exibir.codigoBarras) {
    const valorBarras = (produto.codigoBarras && produto.codigoBarras.trim()) || produto.id;
    const larguraBarraMm = Math.max(modelo.larguraMm - 6, 10);
    const alturaBarraMm = Math.min(modelo.alturaMm * 0.42, 14);
    const svg = gerarSvgCodigoBarras(valorBarras, larguraBarraMm, alturaBarraMm);
    if (svg) {
      partes.push(`<div class="et-barras">${svg}</div>`);
      partes.push(`<div class="et-barras-texto">${_escaparHtmlEtiqueta(valorBarras)}</div>`);
    }
  }

  if (exibir.empresa && nomeEmpresa) {
    partes.push(`<div class="et-empresa">${_escaparHtmlEtiqueta(nomeEmpresa)}</div>`);
  }

  return `<div class="etiqueta" style="width:${modelo.larguraMm}mm;height:${modelo.alturaMm}mm;">
    <div class="etiqueta-conteudo">${partes.join('')}</div>
  </div>`;
}

/**
 * Monta a lista completa de etiquetas (respeitando a quantidade pedida por
 * produto) e devolve o HTML de todas elas já concatenadas, prontas pra
 * entrar tanto no preview quanto na página de impressão.
 *
 * itens = [{ produto, quantidade }]
 */
function gerarHtmlFolhaEtiquetas(itens, modeloId, config, nomeEmpresa) {
  const modelo = MODELOS_ETIQUETA[modeloId] || MODELOS_ETIQUETA.padrao_50x30;
  const etiquetasHtml = [];
  itens.forEach(({ produto, quantidade }) => {
    const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
    for (let i = 0; i < qtd; i++) {
      etiquetasHtml.push(_htmlDeUmaEtiqueta(produto, modelo, config, nomeEmpresa));
    }
  });
  return { modelo, html: etiquetasHtml.join('') };
}

/** CSS compartilhado entre preview (dentro do app) e a janela de impressão. */
function _cssEtiquetas(modelo) {
  const regraPagina = modelo.folha === 'continua'
    ? `@page{ size:${modelo.larguraMm}mm ${modelo.alturaMm}mm; margin:0; }`
    : `@page{ size:A4; margin:${modelo.margemMm}mm; }`;

  return `
    *{ box-sizing:border-box; }
    body{ margin:0; font-family:'Inter',Arial,sans-serif; background:#fff; }
    .folha-etiquetas{
      display:flex; flex-wrap:wrap;
      gap:${modelo.espacamentoMm}mm;
      ${modelo.folha === 'grade-a4' ? `padding:${modelo.margemMm}mm;` : 'padding:0;'}
    }
    .etiqueta{
      overflow:hidden;
      border:${modelo.folha === 'grade-a4' ? '1px dashed #ccc' : 'none'};
      display:flex; align-items:center; justify-content:center;
      page-break-inside:avoid; break-inside:avoid;
    }
    .etiqueta-conteudo{
      width:100%; padding:1.5mm 2mm;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:0.6mm; text-align:center; overflow:hidden;
    }
    .et-nome{ font-size:8.5px; font-weight:700; line-height:1.15; color:#111; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .et-meta{ display:flex; gap:4px; align-items:center; font-size:7.5px; color:#333; }
    .et-preco{ font-weight:700; font-size:9px; color:#111; }
    .et-codigo{ font-family:'IBM Plex Mono',monospace; color:#555; }
    .et-barras{ line-height:0; }
    .et-barras-texto{ font-family:'IBM Plex Mono',monospace; font-size:6.5px; letter-spacing:.04em; color:#111; }
    .et-empresa{ font-size:6.5px; color:#666; text-transform:uppercase; letter-spacing:.04em; }
    ${regraPagina}
    @media print{ .no-print{ display:none !important; } }
  `;
}

/** HTML completo (documento inteiro) pronto pra abrir numa aba/iframe de impressão. */
function gerarDocumentoImpressaoEtiquetas(itens, modeloId, config, nomeEmpresa) {
  const { modelo, html } = gerarHtmlFolhaEtiquetas(itens, modeloId, config, nomeEmpresa);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiquetas — MEV</title>
<style>${_cssEtiquetas(modelo)}</style>
</head>
<body>
  <div class="folha-etiquetas">${html}</div>
</body>
</html>`;
}

window.Etiquetas = {
  MODELOS_ETIQUETA,
  listarModelosEtiqueta,
  gerarHtmlFolhaEtiquetas,
  gerarDocumentoImpressaoEtiquetas,
  gerarSvgCodigoBarras,
  _cssEtiquetas
};
