/**
 * importacao.js
 * Regras de negócio do módulo de Importação de Produtos.
 * Não sabe nada sobre o wizard/HTML — só sobre ler arquivos, mapear
 * colunas, validar linhas e gravar produtos (reaproveitando Produtos.*).
 *
 * Mesmo padrão de camadas do resto do projeto (ver produtos.js/vendas.js):
 * este arquivo é puro JS de domínio; quem desenha a tela é app.js.
 */

const CAMPOS_PRODUTO = [
  { chave: 'nome',          rotulo: 'Nome',              obrigatorio: true  },
  { chave: 'categoria',     rotulo: 'Categoria',         obrigatorio: false },
  { chave: 'codigo',        rotulo: 'Código',            obrigatorio: false },
  { chave: 'codigoBarras',  rotulo: 'Código de barras',  obrigatorio: false },
  { chave: 'precoCusto',    rotulo: 'Preço de custo',    obrigatorio: false },
  { chave: 'preco',         rotulo: 'Preço de venda',    obrigatorio: true  },
  { chave: 'estoque',       rotulo: 'Quantidade',        obrigatorio: true  },
  { chave: 'fornecedor',    rotulo: 'Fornecedor',        obrigatorio: false },
  { chave: 'marca',         rotulo: 'Marca',             obrigatorio: false },
  { chave: 'unidade',       rotulo: 'Unidade',           obrigatorio: false },
];

// Palavras-chave usadas no mapeamento automático — a primeira coluna do
// arquivo cujo cabeçalho bate com algum desses termos (sem acento, minúsculo)
// é escolhida automaticamente para aquele campo. O usuário pode sempre
// sobrescrever manualmente na etapa de mapeamento.
const SINONIMOS_CAMPO = {
  nome:         ['nome', 'produto', 'descricao', 'descrição', 'nome do produto'],
  categoria:    ['categoria', 'departamento', 'grupo'],
  codigo:       ['codigo', 'código', 'sku', 'referencia', 'referência', 'cod'],
  codigoBarras: ['codigo de barras', 'código de barras', 'ean', 'gtin', 'barras'],
  precoCusto:   ['preco de custo', 'preço de custo', 'custo', 'valor de custo'],
  preco:        ['preco', 'preço', 'preco de venda', 'preço de venda', 'valor', 'valor unitario', 'valor unitário'],
  estoque:      ['estoque', 'quantidade', 'qtd', 'qtde', 'saldo'],
  fornecedor:   ['fornecedor', 'emitente'],
  marca:        ['marca'],
  unidade:      ['unidade', 'un', 'und'],
};

function normalizarTexto(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase().trim();
}

// -------------------------------------------------------------------------
// Parsing — CSV
// -------------------------------------------------------------------------

/** Detecta se o CSV usa ";" (padrão Excel BR) ou "," como separador. */
function detectarSeparadorCsv(primeiraLinha) {
  const pontoEVirgula = (primeiraLinha.match(/;/g) || []).length;
  const virgula = (primeiraLinha.match(/,/g) || []).length;
  return pontoEVirgula >= virgula ? ';' : ',';
}

/** Parser simples de linha CSV, com suporte a valores entre aspas. */
function parsearLinhaCsv(linha, separador) {
  const valores = [];
  let atual = '';
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (c === separador && !dentroDeAspas) {
      valores.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  valores.push(atual);
  return valores.map(v => v.trim());
}

function parsearCsv(texto) {
  // Remove BOM UTF-8 (\uFEFF) que o Excel no Windows adiciona ao início do
  // arquivo — sem isso, o primeiro campo do cabeçalho fica como "\uFEFFnome"
  // e quebra o mapeamento automático de colunas.
  const textoLimpo = texto.charCodeAt(0) === 0xFEFF ? texto.slice(1) : texto;
  const linhas = textoLimpo.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
  if (!linhas.length) return { cabecalho: [], linhas: [] };
  const separador = detectarSeparadorCsv(linhas[0]);
  const cabecalho = parsearLinhaCsv(linhas[0], separador);
  const dados = linhas.slice(1).map(l => parsearLinhaCsv(l, separador));
  return { cabecalho, linhas: dados };
}

// -------------------------------------------------------------------------
// Parsing — XLSX (via SheetJS, carregado sob demanda — projeto é "zero
// dependências" por padrão; só baixamos essa lib quando alguém de fato
// importa/exporta um .xlsx, e guardamos em cache pra não baixar de novo)
// -------------------------------------------------------------------------

let _sheetJsPromise = null;
function carregarSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_sheetJsPromise) return _sheetJsPromise;
  _sheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de planilhas Excel. Verifique sua conexão.'));
    document.head.appendChild(script);
  });
  return _sheetJsPromise;
}

async function parsearXlsx(arquivo) {
  const XLSX = await carregarSheetJs();
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const primeiraAba = workbook.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(workbook.Sheets[primeiraAba], { header: 1, raw: false, defval: '' });
  const linhasNaoVazias = matriz.filter(l => l.some(v => String(v || '').trim() !== ''));
  if (!linhasNaoVazias.length) return { cabecalho: [], linhas: [] };
  const cabecalho = linhasNaoVazias[0].map(v => String(v || '').trim());
  const linhas = linhasNaoVazias.slice(1).map(l => l.map(v => String(v ?? '').trim()));
  return { cabecalho, linhas };
}

// -------------------------------------------------------------------------
// Parsing — XML da NF-e (DOMParser nativo do navegador, sem dependência)
// -------------------------------------------------------------------------

function textoTag(no, tag) {
  const el = no.getElementsByTagName(tag)[0];
  return el ? el.textContent.trim() : '';
}

/**
 * Lê um XML de NF-e e devolve uma linha por item (tag <det>), já nos
 * campos internos do produto — não passa pelo mapeamento de colunas
 * (o layout da NF-e é padronizado pela SEFAZ, não tem o que mapear).
 */
function parsearXmlNfe(textoXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(textoXml, 'application/xml');
  const erroParse = doc.getElementsByTagName('parsererror')[0];
  if (erroParse) throw new Error('Arquivo XML inválido ou corrompido.');

  const infNFe = doc.getElementsByTagName('infNFe')[0];
  if (!infNFe) throw new Error('Este arquivo não parece ser um XML de NF-e válido.');

  const emit = doc.getElementsByTagName('emit')[0];
  const nomeFornecedor = emit ? textoTag(emit, 'xNome') : '';

  const itens = Array.from(doc.getElementsByTagName('det'));
  if (!itens.length) throw new Error('Nenhum item (produto) encontrado na NF-e.');

  const produtos = itens.map(det => {
    const prod = det.getElementsByTagName('prod')[0];
    if (!prod) return null;
    return {
      nome: textoTag(prod, 'xProd'),
      codigo: textoTag(prod, 'cProd'),
      codigoBarras: (() => {
        const ean = textoTag(prod, 'cEAN');
        return (ean && ean !== 'SEM GTIN') ? ean : '';
      })(),
      ncm: textoTag(prod, 'NCM'),
      cfop: textoTag(prod, 'CFOP'),
      precoCusto: textoTag(prod, 'vUnCom'),
      estoque: textoTag(prod, 'qCom'),
      unidade: (textoTag(prod, 'uCom') || '').toLowerCase().startsWith('kg') ? 'kg' : 'un',
      fornecedor: nomeFornecedor,
      categoria: '',
      preco: textoTag(prod, 'vUnCom'), // sem preço de venda na NF-e; usa o de custo como sugestão inicial
    };
  }).filter(Boolean);

  return { cabecalho: null, linhas: produtos, jaMapeado: true };
}

// -------------------------------------------------------------------------
// Mapeamento automático de colunas
// -------------------------------------------------------------------------

/** Sugere, para cada campo do produto, qual coluna do cabeçalho bate melhor. */
function sugerirMapeamento(cabecalho) {
  const normalizados = cabecalho.map(normalizarTexto);
  const mapeamento = {};
  CAMPOS_PRODUTO.forEach(({ chave }) => {
    const sinonimos = SINONIMOS_CAMPO[chave] || [chave];
    const indice = normalizados.findIndex(col => sinonimos.some(s => col === s || col.includes(s)));
    mapeamento[chave] = indice >= 0 ? cabecalho[indice] : '';
  });
  return mapeamento;
}

/** Converte as linhas brutas (array de strings) + mapeamento em objetos { nome, preco, ... }. */
function aplicarMapeamento(cabecalho, linhas, mapeamento) {
  const indicePorCampo = {};
  CAMPOS_PRODUTO.forEach(({ chave }) => {
    const coluna = mapeamento[chave];
    indicePorCampo[chave] = coluna ? cabecalho.indexOf(coluna) : -1;
  });
  return linhas.map(linha => {
    const item = {};
    CAMPOS_PRODUTO.forEach(({ chave }) => {
      const idx = indicePorCampo[chave];
      item[chave] = idx >= 0 ? (linha[idx] || '') : '';
    });
    return item;
  });
}

// -------------------------------------------------------------------------
// Normalização de valores (moeda/número em formato BR ou US)
// -------------------------------------------------------------------------

function paraNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return NaN;
  if (typeof valor === 'number') return valor;
  let s = String(valor).trim().replace(/[^\d,.\-]/g, '');
  // "1.234,56" (BR) -> "1234.56" | "1234.56" (US) permanece igual
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return Number(s);
}

// -------------------------------------------------------------------------
// Validação de cada linha
// -------------------------------------------------------------------------

/**
 * Valida uma linha já mapeada e classifica a duplicidade em relação aos
 * produtos já cadastrados (por código de barras, senão por código, senão
 * por nome exato) — reaproveita Produtos.buscarPorCodigoBarras quando dá.
 * Retorna { erros: string[], duplicado: produto|null }.
 */
function validarLinhaImportacao(item, produtosExistentes, vistosNaPlanilha) {
  const erros = [];

  const nome = (item.nome || '').trim();
  if (!nome) erros.push('Nome é obrigatório.');

  const preco = paraNumero(item.preco);
  if (item.preco === '' || isNaN(preco) || preco < 0) erros.push('Preço de venda inválido.');

  const estoque = paraNumero(item.estoque);
  if (item.estoque === '' || isNaN(estoque)) erros.push('Quantidade inválida.');
  else if (estoque < 0) erros.push('Estoque não pode ser negativo.');

  if (item.precoCusto !== '' && item.precoCusto !== undefined) {
    const custo = paraNumero(item.precoCusto);
    if (isNaN(custo) || custo < 0) erros.push('Preço de custo inválido.');
  }

  // Duplicidade dentro da própria planilha (mesmo código de barras/código duas vezes).
  const chaveDuplicidade = (item.codigoBarras || item.codigo || '').trim();
  if (chaveDuplicidade) {
    if (vistosNaPlanilha.has(chaveDuplicidade)) {
      erros.push('Código repetido dentro do próprio arquivo.');
    } else {
      vistosNaPlanilha.add(chaveDuplicidade);
    }
  }

  // Duplicidade contra o estoque já cadastrado.
  let duplicado = null;
  if (item.codigoBarras && item.codigoBarras.trim()) {
    duplicado = Produtos.buscarPorCodigoBarras(produtosExistentes, item.codigoBarras);
  }
  if (!duplicado && item.codigo && item.codigo.trim()) {
    duplicado = produtosExistentes.find(p => p.codigo && String(p.codigo).trim() === String(item.codigo).trim()) || null;
  }
  if (!duplicado && nome) {
    duplicado = produtosExistentes.find(p => normalizarTexto(p.nome) === normalizarTexto(nome)) || null;
  }

  return { erros, duplicado };
}

/**
 * Roda a validação em todas as linhas mapeadas de uma vez, pra alimentar a
 * tela de pré-visualização (uma linha = um status: ok / duplicado / erro).
 */
function validarTodasAsLinhas(itensMapeados, produtosExistentes) {
  const vistosNaPlanilha = new Set();
  return itensMapeados.map((item, indice) => {
    const { erros, duplicado } = validarLinhaImportacao(item, produtosExistentes, vistosNaPlanilha);
    return {
      linha: indice + 1,
      item,
      erros,
      duplicado,
      // Estratégia padrão pra duplicidade — o usuário pode trocar por linha na pré-visualização.
      acaoDuplicidade: duplicado ? 'atualizar_produto' : 'criar_novo',
    };
  });
}

// -------------------------------------------------------------------------
// Execução da importação (grava de fato, reaproveitando Produtos.*)
// -------------------------------------------------------------------------

/**
 * Executa a importação linha a linha, em série (pra não estourar limite de
 * produtos do plano no meio de um lote e pra progresso ficar previsível).
 * `acaoPorLinha` — 'criar_novo' | 'atualizar_produto' | 'atualizar_estoque' | 'ignorar'.
 * `aoProgredir(feito, total)` é chamado a cada linha, pra UI atualizar a barra.
 */
async function executarImportacao(linhasValidas, { aoProgredir } = {}) {
  const resultado = { criados: 0, atualizados: 0, ignorados: 0, comErro: 0, erros: [] };
  const total = linhasValidas.length;
  let feito = 0;

  for (const linha of linhasValidas) {
    try {
      if (linha.erros && linha.erros.length) {
        resultado.comErro++;
        resultado.erros.push({ linha: linha.linha, nome: linha.item.nome, motivo: linha.erros.join(' ') });
        continue;
      }

      const acao = linha.acaoDuplicidade;
      if (acao === 'ignorar') {
        resultado.ignorados++;
        continue;
      }

      const dadosProduto = {
        nome: linha.item.nome,
        categoria: linha.item.categoria,
        preco: paraNumero(linha.item.preco),
        precoCusto: linha.item.precoCusto !== '' ? paraNumero(linha.item.precoCusto) : null,
        estoque: paraNumero(linha.item.estoque),
        estoqueMinimo: 0,
        codigoBarras: linha.item.codigoBarras,
        codigo: linha.item.codigo,
        fornecedor: linha.item.fornecedor,
        marca: linha.item.marca,
        unidade: linha.item.unidade === 'kg' ? 'kg' : 'un',
      };

      if (acao === 'atualizar_produto' && linha.duplicado) {
        await Produtos.editarProduto(linha.duplicado.id, dadosProduto);
        resultado.atualizados++;
      } else if (acao === 'atualizar_estoque' && linha.duplicado) {
        await Produtos.editarProduto(linha.duplicado.id, { ...linha.duplicado, estoque: dadosProduto.estoque });
        resultado.atualizados++;
      } else {
        await Produtos.criarProduto(dadosProduto);
        resultado.criados++;
      }
    } catch (erro) {
      resultado.comErro++;
      resultado.erros.push({ linha: linha.linha, nome: linha.item.nome, motivo: (erro && erro.message) || 'Erro desconhecido.' });
    } finally {
      feito++;
      if (aoProgredir) aoProgredir(feito, total);
    }
  }

  return resultado;
}

// -------------------------------------------------------------------------
// Exportação dos erros em Excel (reaproveita o mesmo SheetJS já usado pra ler .xlsx)
// -------------------------------------------------------------------------

async function exportarErrosXlsx(erros, nomeArquivo = 'erros-importacao.xlsx') {
  const XLSX = await carregarSheetJs();
  const linhas = [['Linha', 'Nome', 'Motivo do erro']]
    .concat(erros.map(e => [e.linha, e.nome || '', e.motivo]));
  const planilha = XLSX.utils.aoa_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, 'Erros');
  XLSX.writeFile(workbook, nomeArquivo);
}

// -------------------------------------------------------------------------
// Parsing — PDF da DANFE (via PDF.js, carregado sob demanda — mesmo padrão
// de "zero dependências até alguém realmente precisar" usado no SheetJS).
//
// AVISO IMPORTANTE (leia antes de confiar cegamente no resultado):
// DANFE é um *documento auxiliar visual* — não existe um layout único
// garantido por lei, cada emissor/gráfica posiciona os campos de um jeito
// (fontes, colunas, quebras de linha diferentes). Diferente do XML da NF-e
// (que é estruturado e 100% confiável), aqui estamos "advinhando" a partir
// de texto solto extraído do PDF. Por isso:
//   - A extração da CHAVE DE ACESSO e do CNPJ do emitente costuma ser muito
//     confiável (formatos numéricos fixos e bem definidos por lei).
//   - A extração da TABELA DE PRODUTOS é heurística: funciona bem pra maioria
//     das DANFEs "padrão retrato", mas pode falhar ou vir incompleta em
//     layouts fora do comum (nome de produto quebrado em 2 linhas, colunas
//     coladas sem espaço, DANFE "paisagem", etc).
//   - Por isso a função devolve também `confianca` por item e os dados
//     SEMPRE devem passar pela tela de pré-visualização/validação do wizard
//     (validarTodasAsLinhas) antes de gravar — nunca grave direto sem o
//     usuário conferir, igual já é feito hoje pro CSV/XLSX.
// -------------------------------------------------------------------------

let _pdfJsPromise = null;
function carregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfJsPromise) return _pdfJsPromise;
  _pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      // O worker precisa ser apontado explicitamente pro PDF.js processar
      // o PDF fora da thread principal (senão trava a UI em PDFs grandes).
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o leitor de PDF. Verifique sua conexão.'));
    document.head.appendChild(script);
  });
  return _pdfJsPromise;
}

/**
 * Extrai o texto de um PDF reconstruindo as LINHAS pela posição (x, y) de
 * cada fragmento de texto — em vez de só concatenar na ordem que o PDF.js
 * devolve (que muitas vezes embaralha colunas). Itens com o mesmo "y"
 * (dentro de uma tolerância, pra absorver pequenas variações de baseline
 * entre fontes) são considerados a mesma linha visual e ordenados por "x".
 * Isso é o que torna a extração mais resiliente entre layouts diferentes.
 */
async function extrairLinhasPdf(arquivo) {
  const pdfjsLib = await carregarPdfJs();
  const buffer = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const todasAsLinhas = [];
  const TOLERANCIA_Y = 2.5; // px de diferença de baseline ainda considerados a mesma linha

  for (let numPagina = 1; numPagina <= pdf.numPages; numPagina++) {
    const pagina = await pdf.getPage(numPagina);
    const conteudo = await pagina.getTextContent();

    // Agrupa os fragmentos de texto por posição vertical (y).
    const porLinha = [];
    conteudo.items.forEach(item => {
      if (!item.str || !item.str.trim()) return;
      const x = item.transform[4];
      const y = item.transform[5];
      let linha = porLinha.find(l => Math.abs(l.y - y) <= TOLERANCIA_Y);
      if (!linha) {
        linha = { y, fragmentos: [] };
        porLinha.push(linha);
      }
      linha.fragmentos.push({ x, texto: item.str });
    });

    // PDF.js usa y crescente de baixo pra cima — ordenamos do topo pra baixo.
    porLinha.sort((a, b) => b.y - a.y);
    porLinha.forEach(linha => {
      linha.fragmentos.sort((a, b) => a.x - b.x);
      // Só insere espaço entre fragmentos quando há um "salto" horizontal
      // perceptível — preserva palavras que o PDF quebrou em vários
      // fragmentos (comum em PDFs gerados por sistemas de nota fiscal).
      let texto = '';
      let xAnterior = null;
      linha.fragmentos.forEach(f => {
        if (xAnterior !== null && (f.x - xAnterior) > 1.5) texto += ' ';
        texto += f.texto;
        xAnterior = f.x + f.texto.length * 1.5; // estimativa grosseira de largura
      });
      todasAsLinhas.push(texto.replace(/\s+/g, ' ').trim());
    });
  }

  return todasAsLinhas.filter(l => l !== '');
}

// -------------------------------------------------------------------------
// Regex de mineração de dados da DANFE
// -------------------------------------------------------------------------

/** Chave de acesso: sempre 44 dígitos, às vezes exibida em 11 blocos de 4. */
function extrairChaveAcesso(textoCompleto) {
  // Aceita tanto "43240747960950189658550010000213301068255693" corrida
  // quanto "4324 0747 9609 5018 9658 5500 1000 0213 3010 6825 5693" espaçada.
  const match = textoCompleto.match(/(?:\d[ ]?){44}/);
  if (!match) return '';
  return match[0].replace(/\s+/g, '');
}

/** CNPJ do emitente. Usa o formato COM barra (xx.xxx.xxx/xxxx-xx) pra não
 * confundir com o CPF do destinatário (que não tem barra). */
function extrairCnpjEmitente(textoCompleto) {
  const match = textoCompleto.match(/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}/);
  return match ? match[0] : '';
}

/**
 * Razão social do emitente. DANFE não tem um rótulo único e confiável pra
 * isso (varia "EMITENTE", "REMETENTE", canhoto "RECEBEMOS DE...", etc), então
 * tentamos alguns padrões comuns, do mais confiável pro mais genérico.
 */
function extrairRazaoSocialEmitente(textoCompleto) {
  // Padrão 1: canhoto de recebimento, presente na maioria das DANFEs.
  let m = textoCompleto.match(/RECEBEMOS DE (.+?) OS PRODUTOS/i);
  if (m) return m[1].trim();

  // Padrão 2: rótulo explícito de emitente/remetente.
  m = textoCompleto.match(/(?:EMITENTE|REMETENTE)\s*[:\-]?\s*([A-ZÀ-Ú0-9.,\/ ]{5,80}?)(?:\s{2,}|CNPJ)/i);
  if (m) return m[1].trim();

  return ''; // não achou com confiança — melhor deixar em branco do que "advinhar" errado
}

/**
 * Tabela de produtos. A linha de item de uma DANFE "padrão retrato" segue
 * (em geral) a ordem: CÓDIGO  DESCRIÇÃO  [NCM CST CFOP]  UNID  QTDE  VL.UNIT  VL.TOTAL
 * Como nem toda DANFE traz NCM/CST/CFOP visíveis do mesmo jeito, usamos duas
 * tentativas: uma mais específica (com NCM/CFOP, maior confiança) e uma
 * mais genérica (só código/descrição/unidade/qtde/valores) como fallback.
 */
const NUM_BR = '\\d{1,3}(?:\\.\\d{3})*,\\d{2,4}'; // "1.234,5678" ou "5,00"

// Tentativa específica: exige NCM (8 díg.) + CST + CFOP (4 díg.) entre a
// descrição e a unidade — é o formato mais comum em DANFE de venda.
const RE_ITEM_ESPECIFICO = new RegExp(
  '^([A-Z0-9.\\-\\/]{2,15})\\s+(.+?)\\s*\\d{8}\\s*\\d{2,4}\\s+\\d{4}\\s+' +
  '([A-Z]{2,4})\\s+(' + NUM_BR + ')\\s+(' + NUM_BR + ')\\s+(' + NUM_BR + ')'
);

// Fallback genérico: CÓDIGO ... UNIDADE QTDE VL.UNIT VL.TOTAL no fim da linha
// (sem exigir NCM/CST/CFOP) — pega layouts mais enxutos.
const RE_ITEM_GENERICO = new RegExp(
  '^([A-Z0-9.\\-\\/]{2,15})\\s+(.+?)\\s+' +
  '(UN|UND|PC|PCT|CX|KG|LT|L|MT|M|PAR|DZ|CJ)\\.?\\s+(' + NUM_BR + ')\\s+(' + NUM_BR + ')\\s+(' + NUM_BR + ')\\s*$'
);

/** Converte "1.234,56" -> 1234.56 (reaproveita a mesma lógica do resto do arquivo). */
function numeroBr(valor) {
  return paraNumero(valor);
}

/**
 * Varre as linhas de texto do PDF e monta os itens da nota. Linhas que não
 * batem com nenhum dos dois padrões (ex.: continuação de descrição em uma
 * segunda linha, tipo "PRETO TRI CUT" embaixo do produto anterior) são
 * anexadas à descrição do último item reconhecido, em vez de descartadas —
 * assim a descrição fica mais completa mesmo em DANFEs que quebram o nome
 * do produto em várias linhas.
 */
function extrairItensPdf(linhas) {
  // Restringe a varredura à área da "tabela de produtos" (entre o cabeçalho
  // "DADOS DO PRODUTO" e o início da seção seguinte), pra não confundir
  // outras linhas do documento (endereço, impostos, etc.) com itens.
  const inicio = linhas.findIndex(l => /DADOS DO PRODUTO/i.test(l));
  const fim = linhas.findIndex((l, i) => i > inicio && /C[ÁA]LCULO DO ISSQN|DADOS ADICIONAIS/i.test(l));
  const linhasTabela = inicio >= 0
    ? linhas.slice(inicio + 1, fim >= 0 ? fim : linhas.length)
    : linhas; // se não achou o cabeçalho, tenta o documento inteiro mesmo assim

  const itens = [];

  linhasTabela.forEach(linhaBruta => {
    const linha = linhaBruta.trim();
    if (!linha) return;

    let m = linha.match(RE_ITEM_ESPECIFICO);
    let confianca = 'alta';
    if (!m) {
      m = linha.match(RE_ITEM_GENERICO);
      confianca = 'media';
    }

    if (m) {
      const [, codigo, descricao, unidade, qtde, vlUnit, vlTotal] = m;
      itens.push({
        codigo: codigo.trim(),
        nome: descricao.trim().replace(/\s{2,}/g, ' '),
        unidade: /kg/i.test(unidade) ? 'kg' : 'un',
        estoque: numeroBr(qtde),
        precoCusto: numeroBr(vlUnit),
        preco: numeroBr(vlUnit), // sem preço de venda na DANFE — usa o de custo como sugestão inicial
        vlTotalItem: numeroBr(vlTotal), // útil pra conferir manualmente na pré-visualização
        confianca,
      });
    } else if (itens.length && linha.length > 2 && !/^\d+$/.test(linha)) {
      // Não bateu com nenhum padrão de item novo — trata como possível
      // continuação da descrição do último item (heurística best-effort).
      itens[itens.length - 1].nome = (itens[itens.length - 1].nome + ' ' + linha).trim();
    }
  });

  return itens;
}

/**
 * Função principal: recebe o File do PDF, devolve os itens já no formato
 * usado pelo restante do wizard (mesmo formato de saída de parsearXmlNfe),
 * mais a chave de acesso e o fornecedor pra exibir no resumo da tela.
 * IMPORTANTE: assim como o XML, isso não passa pelo mapeamento de colunas,
 * mas — diferente do XML — DEVE passar pela pré-visualização com atenção,
 * já que a extração aqui é heurística (ver aviso no topo desta seção).
 */
async function parsearPdfDanfe(arquivo) {
  const linhas = await extrairLinhasPdf(arquivo);
  const textoCompleto = linhas.join('\n');

  const chaveAcesso = extrairChaveAcesso(textoCompleto);
  const cnpjEmitente = extrairCnpjEmitente(textoCompleto);
  const fornecedor = extrairRazaoSocialEmitente(textoCompleto);

  const itensBrutos = extrairItensPdf(linhas);
  if (!itensBrutos.length) {
    throw new Error('Não foi possível identificar a tabela de produtos neste PDF. O layout desta DANFE pode ser diferente do esperado — tente exportar/solicitar o XML da nota, que é 100% confiável, ou cadastre os produtos manualmente.');
  }

  const produtos = itensBrutos.map(item => ({
    nome: item.nome,
    codigo: item.codigo,
    codigoBarras: '',
    ncm: '',
    cfop: '',
    precoCusto: item.precoCusto,
    estoque: item.estoque,
    unidade: item.unidade,
    fornecedor,
    categoria: '',
    preco: item.preco,
    // Metadados extras, não fazem parte de CAMPOS_PRODUTO — usados só pra
    // a tela de pré-visualização sinalizar "confira este item com atenção".
    _confianca: item.confianca,
  }));

  return {
    cabecalho: null,
    linhas: produtos,
    jaMapeado: true,
    chaveAcesso,
    cnpjEmitente,
    fornecedor,
  };
}

window.Importacao = {
  CAMPOS_PRODUTO,
  parsearCsv,
  parsearXlsx,
  parsearXmlNfe,
  parsearPdfDanfe,
  sugerirMapeamento,
  aplicarMapeamento,
  validarTodasAsLinhas,
  executarImportacao,
  exportarErrosXlsx,
  paraNumero,
};