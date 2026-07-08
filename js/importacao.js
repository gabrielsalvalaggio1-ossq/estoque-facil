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
  const linhas = texto.split(/\r\n|\r|\n/).filter(l => l.trim() !== '');
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

window.Importacao = {
  CAMPOS_PRODUTO,
  parsearCsv,
  parsearXlsx,
  parsearXmlNfe,
  sugerirMapeamento,
  aplicarMapeamento,
  validarTodasAsLinhas,
  executarImportacao,
  exportarErrosXlsx,
  paraNumero,
};
