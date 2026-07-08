/**
 * js/etiquetas.js — Motor de geração de etiquetas para impressão
 *
 * API pública (usada por app.js):
 *   Etiquetas.listarModelosEtiqueta()
 *     → [{ id, nome }, ...]
 *
 *   Etiquetas.gerarHtmlFolhaEtiquetas(itens, modeloId, config, nomeEmpresa)
 *     → { modelo, html }
 *     onde html é a string innerHTML a inserir dentro de .folha-etiquetas
 *     e modelo é o objeto completo do modelo escolhido.
 *     Dispara a renderização dos códigos de barras via JsBarcode (CDN, async).
 *
 *   Etiquetas._cssEtiquetas(modelo)
 *     → string CSS a injetar via <style> no preview e no documento de impressão.
 *
 *   Etiquetas.gerarDocumentoImpressaoEtiquetas(itens, modeloId, config, nomeEmpresa)
 *     → string HTML completa (<!DOCTYPE html>…</html>) para window.open + print().
 *
 * Parâmetros comuns:
 *   itens        [{ produto, quantidade }]  — produto é o objeto completo do DB
 *   modeloId     string                     — id do modelo (ex: 'padrao_50x30')
 *   config       { exibir: { nome, codigoInterno, codigoBarras, preco, empresa } }
 *   nomeEmpresa  string                     — exibido quando config.exibir.empresa === true
 */

const Etiquetas = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Modelos disponíveis
  // ---------------------------------------------------------------------------

  /**
   * colunas: quantas etiquetas por linha na folha A4 (só informativo para CSS).
   * Os tamanhos mm são os do label físico — o CSS usa mm diretamente.
   */
  const MODELOS = [
    {
      id: 'padrao_50x30',
      nome: 'Padrão 50×30 mm',
      larguraMm: 50,
      alturaMm: 30,
      colunas: 4,
      fonteEmpresaPx: 6,
      fonteNomePx: 8,
      fontePrecoPx: 11,
      fonteSecPx: 6,
      alturaBarcodeMm: 10,
    },
    {
      id: 'medio_80x40',
      nome: 'Médio 80×40 mm',
      larguraMm: 80,
      alturaMm: 40,
      colunas: 2,
      fonteEmpresaPx: 7,
      fonteNomePx: 10,
      fontePrecoPx: 14,
      fonteSecPx: 7,
      alturaBarcodeMm: 14,
    },
    {
      id: 'grande_100x50',
      nome: 'Grande 100×50 mm',
      larguraMm: 100,
      alturaMm: 50,
      colunas: 2,
      fonteEmpresaPx: 8,
      fonteNomePx: 12,
      fontePrecoPx: 17,
      fonteSecPx: 8,
      alturaBarcodeMm: 18,
    },
    {
      id: 'pequeno_40x25',
      nome: 'Pequeno 40×25 mm',
      larguraMm: 40,
      alturaMm: 25,
      colunas: 5,
      fonteEmpresaPx: 5,
      fonteNomePx: 7,
      fontePrecoPx: 9,
      fonteSecPx: 5,
      alturaBarcodeMm: 8,
    },
  ];

  // ---------------------------------------------------------------------------
  // JsBarcode — carregamento lazy para o preview dentro do app
  // ---------------------------------------------------------------------------

  const JSBARCODE_CDN =
    'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/barcodes/JsBarcode.code128.min.js';

  let _jsBarcodePromise = null;

  function _carregarJsBarcode() {
    if (typeof JsBarcode !== 'undefined') return Promise.resolve(true);
    if (_jsBarcodePromise) return _jsBarcodePromise;
    _jsBarcodePromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = JSBARCODE_CDN;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return _jsBarcodePromise;
  }

  // ---------------------------------------------------------------------------
  // Utilitários internos
  // ---------------------------------------------------------------------------

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _formatarPreco(valor) {
    return 'R$\u00a0' + Number(valor || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function _modeloPorId(id) {
    return MODELOS.find(m => m.id === id) || MODELOS[0];
  }

  /**
   * Retorna o HTML de um <svg> vazio com os atributos que JsBarcode precisa.
   * A renderização real acontece depois que JsBarcode for carregado
   * (veja _renderizarBarcodes).
   */
  function _svgBarcode(codigo, modelo) {
    const uid = 'bc-' + Math.random().toString(36).slice(2, 9);
    // height em px (aprox: 1mm ≈ 3.78px)
    const hPx = Math.round(modelo.alturaBarcodeMm * 3.78);
    return (
      `<svg class="etq-barcode" id="${uid}"` +
      ` data-codigo="${_esc(codigo)}"` +
      ` data-altura="${hPx}"` +
      `></svg>`
    );
  }

  /**
   * Percorre todos os <svg class="etq-barcode"> no documento e renderiza
   * os códigos de barras via JsBarcode. Chamado após inserção no DOM.
   */
  function _renderizarBarcodes(raiz) {
    const svgs = (raiz || document).querySelectorAll('svg.etq-barcode');
    if (!svgs.length) return;
    svgs.forEach(svg => {
      const val = svg.getAttribute('data-codigo');
      const hPx = parseInt(svg.getAttribute('data-altura'), 10) || 25;
      if (!val) return;
      try {
        JsBarcode(svg, val, {
          format: 'CODE128',
          height: hPx,
          fontSize: 7,
          textMargin: 1,
          margin: 0,
          displayValue: true,
        });
      } catch (e) {
        // código inválido — exibe só o texto
        svg.outerHTML = `<span class="etq-ci">${_esc(val)}</span>`;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Geração de HTML de uma etiqueta individual
  // ---------------------------------------------------------------------------

  function _htmlEtiqueta(produto, config, nomeEmpresa, modelo) {
    if (!produto || typeof produto !== 'object') return '';
    const ex = config && config.exibir ? config.exibir : {};
    const cb = produto.codigoBarras ? String(produto.codigoBarras).trim() : '';
    const ci = produto.codigo       ? String(produto.codigo).trim()       : '';

    let conteudo = '';

    if (ex.empresa && nomeEmpresa) {
      conteudo += `<div class="etq-empresa">${_esc(nomeEmpresa)}</div>`;
    }

    if (ex.nome !== false) {
      conteudo += `<div class="etq-nome">${_esc(produto.nome || '')}</div>`;
    }

    if (ex.preco !== false) {
      conteudo += `<div class="etq-preco">${_formatarPreco(produto.preco)}</div>`;
    }

    // Código de barras: se existir e estiver marcado, renderiza com JsBarcode
    if (ex.codigoBarras !== false && cb) {
      conteudo += _svgBarcode(cb, modelo);
    }

    // Código interno: exibe abaixo do barcode (ou sozinho se não houver barcode)
    if (ex.codigoInterno !== false && ci) {
      conteudo += `<div class="etq-ci">${_esc(ci)}</div>`;
    }

    return `<div class="etiqueta">${conteudo}</div>`;
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /** Retorna a lista de modelos disponíveis para popular o <select>. */
  function listarModelosEtiqueta() {
    return MODELOS.map(m => ({ id: m.id, nome: m.nome }));
  }

  /**
   * Gera o HTML interno da folha de etiquetas e agenda a renderização
   * dos códigos de barras assim que JsBarcode estiver disponível.
   *
   * @param {Array}  itens        [{ produto, quantidade }]
   * @param {string} modeloId
   * @param {object} config       { exibir: { nome, codigoInterno, codigoBarras, preco, empresa } }
   * @param {string} nomeEmpresa
   * @returns {{ modelo, html }}
   */
  function gerarHtmlFolhaEtiquetas(itens, modeloId, config, nomeEmpresa) {
    const modelo = _modeloPorId(modeloId);
    let html = '';
    for (const { produto, quantidade } of itens) {
      const qtd = Math.max(1, Number(quantidade) || 1);
      for (let i = 0; i < qtd; i++) {
        html += _htmlEtiqueta(produto, config, nomeEmpresa, modelo);
      }
    }

    // Renderizar barcodes após o HTML ser inserido no DOM pelo app.js
    _carregarJsBarcode().then(ok => {
      if (!ok || typeof JsBarcode === 'undefined') return;
      // Pequeno delay para garantir que o DOM foi atualizado
      setTimeout(() => _renderizarBarcodes(document), 50);
    });

    return { modelo, html };
  }

  /**
   * CSS da folha de etiquetas.
   * Injetado via <style> tanto no preview do modal quanto no documento de impressão.
   *
   * @param {object} modelo — objeto completo retornado por _modeloPorId()
   * @returns {string} CSS
   */
  function _cssEtiquetas(modelo) {
    const l = modelo.larguraMm;
    const a = modelo.alturaMm;
    return `
/* === Folha de etiquetas === */
.folha-etiquetas {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}
.etiqueta {
  width: ${l}mm;
  height: ${a}mm;
  padding: 1.5mm 2mm;
  box-sizing: border-box;
  border: 0.25mm dashed #bbb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  overflow: hidden;
  font-family: Arial, Helvetica, sans-serif;
  gap: 0.5mm;
}
.etq-empresa {
  font-size: ${modelo.fonteEmpresaPx}px;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  line-height: 1.2;
}
.etq-nome {
  font-size: ${modelo.fonteNomePx}px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  line-height: 1.2;
}
.etq-preco {
  font-size: ${modelo.fontePrecoPx}px;
  font-weight: bold;
  line-height: 1.2;
}
.etq-barcode {
  max-width: 100%;
  height: ${modelo.alturaBarcodeMm}mm;
  display: block;
}
.etq-ci {
  font-size: ${modelo.fonteSecPx}px;
  color: #555;
  font-family: 'Courier New', Courier, monospace;
  line-height: 1.2;
}
@media print {
  .etiqueta {
    border-color: transparent;
  }
}
`.trimStart();
  }

  /**
   * Gera um documento HTML completo para abrir em nova aba e imprimir.
   * JsBarcode é carregado via CDN na <head> do documento gerado.
   *
   * @param {Array}  itens
   * @param {string} modeloId
   * @param {object} config
   * @param {string} nomeEmpresa
   * @returns {string} HTML completo
   */
  function gerarDocumentoImpressaoEtiquetas(itens, modeloId, config, nomeEmpresa) {
    const modelo = _modeloPorId(modeloId);
    let html = '';
    for (const { produto, quantidade } of itens) {
      const qtd = Math.max(1, Number(quantidade) || 1);
      for (let i = 0; i < qtd; i++) {
        html += _htmlEtiqueta(produto, config, nomeEmpresa, modelo);
      }
    }
    const css = _cssEtiquetas(modelo);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Etiquetas — ${_esc(modelo.nome)}</title>
  <script src="${JSBARCODE_CDN}"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; }
    ${css}
    @media print {
      @page { margin: 5mm; size: A4; }
      body { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="folha-etiquetas">${html}</div>
  <script>
    window.addEventListener('load', function () {
      var svgs = document.querySelectorAll('svg.etq-barcode');
      svgs.forEach(function (svg) {
        var val = svg.getAttribute('data-codigo');
        var hPx = parseInt(svg.getAttribute('data-altura'), 10) || 25;
        if (!val || typeof JsBarcode === 'undefined') return;
        try {
          JsBarcode(svg, val, {
            format: 'CODE128',
            height: hPx,
            fontSize: 7,
            textMargin: 1,
            margin: 0,
            displayValue: true,
          });
        } catch (e) {
          svg.outerHTML = '<span style="font-size:7px;font-family:monospace;">' +
            val.replace(/[<>&"]/g, function(c){return({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]);}) +
            '<\/span>';
        }
      });
    });
  <\/script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Exportação
  // ---------------------------------------------------------------------------

  return {
    listarModelosEtiqueta,
    gerarHtmlFolhaEtiquetas,
    _cssEtiquetas,
    gerarDocumentoImpressaoEtiquetas,
  };
})();
