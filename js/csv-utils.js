/**
 * csv-utils.js — Escaping compartilhado para geração de CSV.
 *
 * Motivo de existir: produtos.js e vendas.js geravam CSV trocando ';' por
 * ',' na mão em cada campo. Isso "resolve" o delimitador, mas não trata
 * aspas nem quebras de linha dentro do valor (ex.: nome de produto colado
 * do WhatsApp com \n, ou observação com aspas) — quando isso acontece a
 * linha vaza pra fora da célula e desalinha todas as colunas seguintes no
 * Excel/Sheets. Esta função aplica a regra padrão do formato CSV (RFC 4180):
 * qualquer campo que contenha o delimitador, aspas ou quebra de linha vai
 * entre aspas, com aspas internas duplicadas.
 *
 * Também neutraliza "CSV injection": se o campo começa com =, +, -, @, TAB
 * ou CR, alguns editores de planilha interpretam isso como fórmula. Um nome
 * de cliente digitado como "=CMD(...)" não deve virar fórmula executável
 * ao abrir a planilha — prefixamos com apóstrofo nesse caso.
 */
function formatarCampoCsv(valor) {
  let texto = valor === null || valor === undefined ? '' : String(valor);

  // Neutraliza início de fórmula (mantém legível, só evita execução).
  if (/^[=+\-@\t\r]/.test(texto)) {
    texto = "'" + texto;
  }

  const precisaAspas = /[;"\r\n]/.test(texto);
  if (precisaAspas) {
    texto = '"' + texto.replace(/"/g, '""') + '"';
  }
  return texto;
}

/** Monta uma linha CSV a partir de um array de valores, aplicando o escaping campo a campo. */
function montarLinhaCsv(valores) {
  return valores.map(formatarCampoCsv).join(';');
}

window.CsvUtils = { formatarCampoCsv, montarLinhaCsv };
