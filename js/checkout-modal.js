/**
 * checkout-modal.js
 * Modal de Checkout Transparente do Mercado Pago.
 * Suporta: Cartão de crédito, Pix (todos os planos), Boleto (planos anuais).
 *
 * Uso:
 *   abrirModalCheckoutMP(planoId, callbackSucesso)
 */

const CHECKOUT_NOMES_PLANO = {
  essencial:       'Essencial Mensal — R$ 19,90/mês',
  essencial_anual: 'Essencial Anual — R$ 199,00/ano',
  pro:             'Pro Mensal — R$ 39,90/mês',
  pro_anual:       'Pro Anual — R$ 399,00/ano',
};

const CHECKOUT_VALORES_PLANO = {
  essencial:       '19.90',
  essencial_anual: '199.00',
  pro:             '39.90',
  pro_anual:       '399.00',
};

// Boleto só nos planos anuais
function _temBoleto(planoId) {
  return planoId === 'essencial_anual' || planoId === 'pro_anual';
}

let _mpInstance = null;
let _checkoutCallback = null;
let _checkoutPlanoId = null;

function carregarSDKMercadoPago(publicKey) {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago) {
      if (!_mpInstance) _mpInstance = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      resolve(_mpInstance);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.onload = () => {
      _mpInstance = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      resolve(_mpInstance);
    };
    script.onerror = () => reject(new Error('Não foi possível carregar o SDK do Mercado Pago.'));
    document.head.appendChild(script);
  });
}

async function abrirModalCheckoutMP(planoId, callbackSucesso) {
  _checkoutCallback = callbackSucesso;
  _checkoutPlanoId = planoId;

  const temBoleto = _temBoleto(planoId);

  const overlay = document.createElement('div');
  overlay.id = 'checkoutMPOverlay';
  overlay.innerHTML = `
    <div class="checkout-mp-modal" role="dialog" aria-modal="true" aria-label="Checkout de assinatura">
      <button type="button" class="checkout-mp-fechar" id="btnFecharCheckoutMP" aria-label="Fechar">✕</button>

      <div class="checkout-mp-header">
        <p class="checkout-mp-eyebrow">Meu Estoque e Vendas</p>
        <h2 class="checkout-mp-titulo">Assinar plano</h2>
        <p class="checkout-mp-plano" id="checkoutNomePlano">${CHECKOUT_NOMES_PLANO[planoId] || planoId}</p>
      </div>

      <!-- Abas de método de pagamento -->
      <div class="checkout-mp-abas" id="checkoutAbas">
        <button type="button" class="checkout-mp-aba ativa" data-aba="cartao">💳 Cartão</button>
        <button type="button" class="checkout-mp-aba" data-aba="pix">Pix</button>
        ${temBoleto ? '<button type="button" class="checkout-mp-aba" data-aba="boleto">Boleto</button>' : ''}
      </div>

      <!-- CARTÃO -->
      <div id="checkoutPainelCartao">
        <div id="checkoutMPCarregando" class="checkout-mp-loading">
          <span class="checkout-mp-spinner"></span>
          Carregando formulário seguro…
        </div>

        <form id="checkoutMPForm" style="display:none;" onsubmit="return false;">
          <div class="checkout-mp-field">
            <label for="checkoutNumeroCartao">Número do cartão</label>
            <div id="checkoutNumeroCartao" class="checkout-mp-input-mp"></div>
          </div>

          <div class="checkout-mp-row">
            <div class="checkout-mp-field">
              <label for="checkoutMes">Mês</label>
              <div id="checkoutMes" class="checkout-mp-input-mp"></div>
            </div>
            <div class="checkout-mp-field">
              <label for="checkoutAno">Ano</label>
              <div id="checkoutAno" class="checkout-mp-input-mp"></div>
            </div>
            <div class="checkout-mp-field">
              <label for="checkoutCVV">CVV</label>
              <div id="checkoutCVV" class="checkout-mp-input-mp"></div>
            </div>
          </div>

          <div class="checkout-mp-field">
            <label for="checkoutNomeTitular">Nome no cartão</label>
            <input type="text" id="checkoutNomeTitular" class="checkout-mp-input"
              placeholder="Como está impresso no cartão"
              autocomplete="cc-name" maxlength="60">
          </div>

          <div class="checkout-mp-field">
            <label for="checkoutCPF">CPF do titular</label>
            <input type="text" id="checkoutCPF" class="checkout-mp-input"
              placeholder="000.000.000-00"
              autocomplete="off" maxlength="14" inputmode="numeric">
          </div>

          <select id="checkoutIssuer" style="display:none;"></select>
          <select id="checkoutTipoDoc" style="display:none;"></select>
          <select id="checkoutParcelas" style="display:none;"></select>

          <p class="checkout-mp-erro" id="checkoutMPErroCartao" style="display:none;"></p>

          <button type="button" class="checkout-mp-btn-pagar" id="btnCheckoutPagar">
            🔒 Confirmar assinatura
          </button>

          <p class="checkout-mp-seguro">
            Pagamento processado pelo Mercado Pago · Seus dados não passam pelos nossos servidores
          </p>
        </form>
      </div>

      <!-- PIX -->
      <div id="checkoutPainelPix" style="display:none;">
        <div id="checkoutPixGerar">
          <div class="checkout-mp-field">
            <label for="checkoutPixCPF">CPF do titular</label>
            <input type="text" id="checkoutPixCPF" class="checkout-mp-input"
              placeholder="000.000.000-00"
              autocomplete="off" maxlength="14" inputmode="numeric">
          </div>
          <p class="checkout-mp-erro" id="checkoutMPErroPix" style="display:none;"></p>
          <button type="button" class="checkout-mp-btn-pagar" id="btnGerarPix">
            Gerar QR Code Pix
          </button>
        </div>

        <div id="checkoutPixQR" style="display:none;" class="checkout-mp-pix-qr">
          <p class="checkout-mp-pix-instrucao">Escaneie o QR Code ou copie o código abaixo</p>
          <div id="checkoutPixQRImagem" class="checkout-mp-qr-imagem"></div>
          <div class="checkout-mp-pix-copia">
            <input type="text" id="checkoutPixCopiaCola" class="checkout-mp-input" readonly>
            <button type="button" class="checkout-mp-btn-copiar" id="btnCopiarPix">Copiar</button>
          </div>
          <p class="checkout-mp-pix-aguarda">
            <span class="checkout-mp-spinner"></span>
            Aguardando confirmação do pagamento…
          </p>
          <p class="checkout-mp-seguro">O plano será ativado automaticamente após o pagamento ser confirmado.</p>
        </div>
      </div>

      <!-- BOLETO -->
      ${temBoleto ? `
      <div id="checkoutPainelBoleto" style="display:none;">
        <div id="checkoutBoletoGerar">
          <div class="checkout-mp-field">
            <label for="checkoutBoletoCPF">CPF do titular</label>
            <input type="text" id="checkoutBoletoCPF" class="checkout-mp-input"
              placeholder="000.000.000-00"
              autocomplete="off" maxlength="14" inputmode="numeric">
          </div>
          <div class="checkout-mp-field">
            <label for="checkoutBoletoNome">Nome completo</label>
            <input type="text" id="checkoutBoletoNome" class="checkout-mp-input"
              placeholder="Como no CPF" maxlength="60">
          </div>
          <p class="checkout-mp-erro" id="checkoutMPErroBoleto" style="display:none;"></p>
          <button type="button" class="checkout-mp-btn-pagar" id="btnGerarBoleto">
            Gerar boleto
          </button>
        </div>

        <div id="checkoutBoletoGerado" style="display:none;" class="checkout-mp-boleto-gerado">
          <p class="checkout-mp-pix-instrucao">Boleto gerado! Copie o código ou abra o PDF para pagar.</p>
          <div class="checkout-mp-pix-copia">
            <input type="text" id="checkoutBoletoLinhaDigitavel" class="checkout-mp-input" readonly>
            <button type="button" class="checkout-mp-btn-copiar" id="btnCopiarBoleto">Copiar</button>
          </div>
          <a id="checkoutBoletoPDF" href="#" target="_blank" class="checkout-mp-btn-pagar checkout-mp-btn-boleto-pdf">
            Abrir boleto em PDF
          </a>
          <p class="checkout-mp-seguro">O plano será ativado automaticamente após a compensação (até 3 dias úteis).</p>
        </div>
      </div>
      ` : ''}

      <!-- SUCESSO (compartilhado) -->
      <div id="checkoutMPSucesso" style="display:none;" class="checkout-mp-sucesso">
        <div class="checkout-mp-sucesso-icone">✓</div>
        <h3>Assinatura ativada!</h3>
        <p>Seu plano já está ativo. Aproveite todos os recursos.</p>
        <button type="button" class="checkout-mp-btn-pagar" id="btnCheckoutContinuar">
          Continuar
        </button>
      </div>
    </div>
  `;

  if (!document.getElementById('checkoutMPStyles')) {
    const style = document.createElement('style');
    style.id = 'checkoutMPStyles';
    style.textContent = `
      #checkoutMPOverlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(18, 40, 31, 0.72);
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        backdrop-filter: blur(4px);
        animation: checkoutFadeIn .2s ease;
      }
      @keyframes checkoutFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .checkout-mp-modal {
        background: #fff; border-radius: 18px;
        padding: 32px 28px; width: 100%; max-width: 420px;
        position: relative; box-shadow: 0 24px 60px rgba(0,0,0,.22);
        animation: checkoutSlideUp .25s ease;
        max-height: 90vh; overflow-y: auto;
      }
      @keyframes checkoutSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .checkout-mp-fechar {
        position: absolute; top: 14px; right: 16px;
        background: none; border: none; cursor: pointer;
        font-size: 18px; color: #8A9088; padding: 4px 8px;
        border-radius: 6px; line-height: 1;
      }
      .checkout-mp-fechar:hover { background: #f0f0f0; color: #333; }
      .checkout-mp-eyebrow {
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .05em; color: #5B6259; margin: 0 0 6px;
      }
      .checkout-mp-titulo {
        font-size: 22px; font-weight: 700; color: #1B3A2F; margin: 0 0 4px;
        font-family: 'Fraunces', serif;
      }
      .checkout-mp-plano {
        font-size: 14px; color: #D9A441; font-weight: 600; margin: 0 0 18px;
      }
      .checkout-mp-abas {
        display: flex; gap: 6px; margin-bottom: 20px;
        border-bottom: 2px solid #E8E4D4; padding-bottom: 0;
      }
      .checkout-mp-aba {
        background: none; border: none; cursor: pointer;
        padding: 8px 14px; font-size: 14px; font-weight: 600;
        color: #8A9088; border-bottom: 2px solid transparent;
        margin-bottom: -2px; font-family: inherit; border-radius: 4px 4px 0 0;
        transition: color .15s;
      }
      .checkout-mp-aba:hover { color: #1B3A2F; }
      .checkout-mp-aba.ativa { color: #1B3A2F; border-bottom-color: #1B3A2F; }
      .checkout-mp-loading {
        display: flex; align-items: center; gap: 10px;
        color: #5B6259; font-size: 14px; padding: 20px 0;
      }
      .checkout-mp-spinner {
        width: 18px; height: 18px; border: 2px solid #e0e0e0;
        border-top-color: #1B3A2F; border-radius: 50%;
        animation: checkoutSpin .7s linear infinite; flex-shrink: 0;
        display: inline-block;
      }
      @keyframes checkoutSpin { to { transform: rotate(360deg); } }
      .checkout-mp-field { margin-bottom: 16px; }
      .checkout-mp-field label {
        display: block; font-size: 13px; font-weight: 600;
        color: #1F2420; margin-bottom: 6px;
      }
      .checkout-mp-input-mp {
        border: 1.5px solid #D9D4C2; border-radius: 9px;
        padding: 0; background: #FBFAF3;
        height: 46px; overflow: hidden; transition: border-color .2s;
      }
      .checkout-mp-input-mp iframe { width: 100%; height: 46px; border: none; display: block; }
      .checkout-mp-input-mp:focus-within { border-color: #1B3A2F; }
      .checkout-mp-input {
        width: 100%; border: 1.5px solid #D9D4C2; border-radius: 9px;
        padding: 12px 14px; font-size: 15px; background: #FBFAF3;
        font-family: inherit; outline: none; box-sizing: border-box;
        transition: border-color .2s;
      }
      .checkout-mp-input:focus { border-color: #1B3A2F; }
      .checkout-mp-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
      .checkout-mp-erro {
        background: #FCE4DA; color: #8F2E14; border-radius: 8px;
        padding: 10px 14px; font-size: 13.5px; margin-bottom: 14px;
      }
      .checkout-mp-btn-pagar {
        width: 100%; padding: 15px; border-radius: 11px; border: none;
        background: #1B3A2F; color: #fff; font-size: 15px; font-weight: 700;
        cursor: pointer; font-family: inherit;
        transition: background .2s, transform .15s;
        display: block; text-align: center; text-decoration: none;
        box-sizing: border-box;
      }
      .checkout-mp-btn-pagar:hover:not(:disabled) { background: #24463A; transform: translateY(-1px); }
      .checkout-mp-btn-pagar:disabled { opacity: .6; cursor: not-allowed; transform: none; }
      .checkout-mp-seguro {
        text-align: center; font-size: 12px; color: #8A9088; margin: 12px 0 0;
      }
      .checkout-mp-sucesso { text-align: center; padding: 16px 0; }
      .checkout-mp-sucesso-icone {
        width: 64px; height: 64px; border-radius: 50%;
        background: #1B3A2F; color: #fff; font-size: 28px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 18px;
      }
      .checkout-mp-sucesso h3 { font-size: 20px; color: #1B3A2F; margin: 0 0 8px; }
      .checkout-mp-sucesso p { color: #5B6259; font-size: 14px; margin: 0 0 24px; }

      /* Pix */
      .checkout-mp-pix-qr { text-align: center; }
      .checkout-mp-pix-instrucao { font-size: 14px; color: #3D4A3A; margin: 0 0 16px; }
      .checkout-mp-qr-imagem { display: flex; justify-content: center; margin-bottom: 16px; }
      .checkout-mp-qr-imagem img { width: 180px; height: 180px; border-radius: 8px; border: 1px solid #E8E4D4; }
      .checkout-mp-pix-copia { display: flex; gap: 8px; margin-bottom: 14px; }
      .checkout-mp-pix-copia .checkout-mp-input { flex: 1; font-size: 12px; padding: 10px 12px; }
      .checkout-mp-btn-copiar {
        padding: 10px 16px; border-radius: 9px; border: 1.5px solid #1B3A2F;
        background: #fff; color: #1B3A2F; font-weight: 700; cursor: pointer;
        font-family: inherit; font-size: 13px; white-space: nowrap;
        transition: background .15s;
      }
      .checkout-mp-btn-copiar:hover { background: #F0F4F1; }
      .checkout-mp-pix-aguarda {
        display: flex; align-items: center; justify-content: center;
        gap: 8px; font-size: 13px; color: #5B6259; margin: 4px 0 12px;
      }

      /* Boleto */
      .checkout-mp-boleto-gerado { text-align: center; }
      .checkout-mp-btn-boleto-pdf { margin-top: 10px; }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  // Máscara CPF (reutilizável)
  function aplicarMascaraCPF(campo) {
    campo.addEventListener('input', () => {
      let v = campo.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
      else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
      else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
      campo.value = v;
    });
  }

  ['checkoutCPF', 'checkoutPixCPF', 'checkoutBoletoCPF'].forEach(id => {
    const el = document.getElementById(id);
    if (el) aplicarMascaraCPF(el);
  });

  // Troca de abas
  document.querySelectorAll('.checkout-mp-aba').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.checkout-mp-aba').forEach(b => b.classList.remove('ativa'));
      btn.classList.add('ativa');
      const aba = btn.dataset.aba;
      document.getElementById('checkoutPainelCartao').style.display = aba === 'cartao' ? '' : 'none';
      document.getElementById('checkoutPainelPix').style.display = aba === 'pix' ? '' : 'none';
      const painelBoleto = document.getElementById('checkoutPainelBoleto');
      if (painelBoleto) painelBoleto.style.display = aba === 'boleto' ? '' : 'none';

      // Se voltou pra aba cartão e o form já foi montado, remove o loading
      if (aba === 'cartao') {
        const form = document.getElementById('checkoutMPForm');
        const loading = document.getElementById('checkoutMPCarregando');
        if (form && form.style.display !== 'none') return; // já visível
        if (form && loading && loading.style.display === 'none') return; // já ok
        // SDK já inicializado mas form ainda oculto — força exibição
        if (_mpInstance && form) {
          if (loading) loading.style.display = 'none';
          form.style.display = 'block';
        }
      }
    });
  });

  document.getElementById('btnFecharCheckoutMP').addEventListener('click', fecharModalCheckoutMP);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModalCheckoutMP(); });
  document.addEventListener('keydown', _escCheckout);

  // ── CARTÃO ──
  try {
    if (!window.DB) throw new Error('Módulo de dados não carregado. Recarregue a página.');
    const { publicKey } = await window.DB.iniciarCheckout();
    const mp = await carregarSDKMercadoPago(publicKey);
    const cardForm = mp.cardForm({
      amount: CHECKOUT_VALORES_PLANO[_checkoutPlanoId] || '19.90',
      iframe: true,
      form: {
        id: 'checkoutMPForm',
        cardNumber: { id: 'checkoutNumeroCartao', placeholder: '0000 0000 0000 0000' },
        cardExpirationMonth: { id: 'checkoutMes', placeholder: 'MM' },
        cardExpirationYear: { id: 'checkoutAno', placeholder: 'AA' },
        securityCode: { id: 'checkoutCVV', placeholder: '123' },
        cardholderName: { id: 'checkoutNomeTitular' },
        issuer: { id: 'checkoutIssuer' },
        installments: { id: 'checkoutParcelas' },
      },
      callbacks: {
        onFormMounted: () => {
          document.getElementById('checkoutMPCarregando').style.display = 'none';
          document.getElementById('checkoutMPForm').style.display = 'block';
        },
        onError: (erros) => {
          const msg = Array.isArray(erros) ? erros.map(e => e.message || e.cause || JSON.stringify(e)).join('; ') : JSON.stringify(erros);
          _mostrarErro('checkoutMPErroCartao', 'SDK: ' + msg);
        },
        onSubmit: async (event) => {
          event.preventDefault();
          const { token, cardholderName } = cardForm.getCardFormData();
          const cpf = (document.getElementById('checkoutCPF')?.value || '').replace(/\D/g, '');
          await _processarCartao({ token, nomeCartao: cardholderName, cpf });
        },
      },
    });

    document.getElementById('btnCheckoutPagar').addEventListener('click', () => cardForm.submit());

  } catch (erro) {
    document.getElementById('checkoutMPCarregando').style.display = 'none';
    document.getElementById('checkoutMPForm').style.display = 'block';
    _mostrarErro('checkoutMPErroCartao', erro.message || 'Erro ao carregar o formulário de pagamento.');
  }

  // ── PIX ──
  document.getElementById('btnGerarPix')?.addEventListener('click', async () => {
    const cpf = (document.getElementById('checkoutPixCPF')?.value || '').replace(/\D/g, '');
    if (cpf.length !== 11) { _mostrarErro('checkoutMPErroPix', 'Informe um CPF válido.'); return; }
    const btn = document.getElementById('btnGerarPix');
    btn.disabled = true; btn.textContent = 'Gerando…';
    _mostrarErro('checkoutMPErroPix', '');
    try {
      const res = await window.DB.assinarComCartao({ metodo: 'pix', planoId: _checkoutPlanoId, cpf });
      if (res.qrCode) {
        document.getElementById('checkoutPixGerar').style.display = 'none';
        document.getElementById('checkoutPixQR').style.display = '';
        document.getElementById('checkoutPixQRImagem').innerHTML = `<img src="${res.qrCodeBase64}" alt="QR Code Pix">`;
        document.getElementById('checkoutPixCopiaCola').value = res.qrCode;
        _iniciarPollingPagamento(res.pagamentoId);
      }
    } catch (e) {
      _mostrarErro('checkoutMPErroPix', e.message || 'Erro ao gerar Pix.');
      btn.disabled = false; btn.textContent = 'Gerar QR Code Pix';
    }
  });

  document.getElementById('btnCopiarPix')?.addEventListener('click', () => {
    const val = document.getElementById('checkoutPixCopiaCola').value;
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('btnCopiarPix');
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  });

  // ── BOLETO ──
  document.getElementById('btnGerarBoleto')?.addEventListener('click', async () => {
    const cpf = (document.getElementById('checkoutBoletoCPF')?.value || '').replace(/\D/g, '');
    const nome = (document.getElementById('checkoutBoletoNome')?.value || '').trim();
    if (cpf.length !== 11) { _mostrarErro('checkoutMPErroBoleto', 'Informe um CPF válido.'); return; }
    if (!nome) { _mostrarErro('checkoutMPErroBoleto', 'Informe o nome completo.'); return; }
    const btn = document.getElementById('btnGerarBoleto');
    btn.disabled = true; btn.textContent = 'Gerando…';
    _mostrarErro('checkoutMPErroBoleto', '');
    try {
      const res = await window.DB.assinarComCartao({ metodo: 'boleto', planoId: _checkoutPlanoId, cpf, nomeCartao: nome });
      if (res.boletoUrl) {
        document.getElementById('checkoutBoletoGerar').style.display = 'none';
        document.getElementById('checkoutBoletoGerado').style.display = '';
        document.getElementById('checkoutBoletoLinhaDigitavel').value = res.boletoLinhaDigitavel || '';
        document.getElementById('checkoutBoletoPDF').href = res.boletoUrl;
      } else if (res.status === 'rejected') {
        _mostrarErro('checkoutMPErroBoleto', 'Boleto não aprovado pelo Mercado Pago. Em ambiente de teste o boleto não é processado — tente em produção ou use Pix.');
        btn.disabled = false; btn.textContent = 'Gerar boleto';
      } else {
        _mostrarErro('checkoutMPErroBoleto', 'Erro ao gerar boleto. Tente novamente.');
        btn.disabled = false; btn.textContent = 'Gerar boleto';
      }
    } catch (e) {
      _mostrarErro('checkoutMPErroBoleto', e.message || 'Erro ao gerar boleto.');
      btn.disabled = false; btn.textContent = 'Gerar boleto';
    }
  });

  document.getElementById('btnCopiarBoleto')?.addEventListener('click', () => {
    const val = document.getElementById('checkoutBoletoLinhaDigitavel').value;
    navigator.clipboard.writeText(val).then(() => {
      const btn = document.getElementById('btnCopiarBoleto');
      btn.textContent = 'Copiado!';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  });
}

// Polling de status do pagamento Pix (verifica a cada 5s por até 10 min)
let _pollingInterval = null;
function _iniciarPollingPagamento(pagamentoId) {
  if (_pollingInterval) clearInterval(_pollingInterval);
  let tentativas = 0;
  const MAX = 120; // 120 × 5s = 10 min
  _pollingInterval = setInterval(async () => {
    tentativas++;
    if (tentativas > MAX) { clearInterval(_pollingInterval); return; }
    try {
      const res = await window.DB.assinarComCartao({ metodo: 'status', pagamentoId });
      if (res && res.planoAtivado) {
        clearInterval(_pollingInterval);
        _mostrarSucesso();
      }
    } catch (_) { /* continua tentando */ }
  }, 5000);
}

function _mostrarErro(idEl, msg) {
  const el = document.getElementById(idEl);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function _mostrarSucesso() {
  ['checkoutPainelCartao', 'checkoutPainelPix', 'checkoutPainelBoleto', 'checkoutAbas']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('checkoutMPSucesso').style.display = 'block';
  document.getElementById('btnCheckoutContinuar').addEventListener('click', () => {
    fecharModalCheckoutMP();
    if (_checkoutCallback) _checkoutCallback();
  });
}

async function _processarCartao({ token, nomeCartao, cpf }) {
  const btnPagar = document.getElementById('btnCheckoutPagar');
  if (!token) { _mostrarErro('checkoutMPErroCartao', 'Verifique os dados do cartão e tente novamente.'); return; }
  if (btnPagar) { btnPagar.disabled = true; btnPagar.textContent = 'Processando…'; }
  _mostrarErro('checkoutMPErroCartao', '');
  try {
    const resultado = await window.DB.assinarComCartao({ metodo: 'cartao', token, planoId: _checkoutPlanoId, nomeCartao, cpf });
    if (resultado.planoAtivado) {
      _mostrarSucesso();
    } else {
      _mostrarErro('checkoutMPErroCartao', 'Pagamento em análise. Assim que confirmado, seu plano será ativado automaticamente.');
      if (btnPagar) { btnPagar.disabled = false; btnPagar.textContent = '🔒 Confirmar assinatura'; }
    }
  } catch (erro) {
    _mostrarErro('checkoutMPErroCartao', erro.message || 'Não foi possível processar o pagamento. Tente novamente.');
    if (btnPagar) { btnPagar.disabled = false; btnPagar.textContent = '🔒 Confirmar assinatura'; }
  }
}

// Mantém retrocompatibilidade com chamadas antigas sem metodo
async function processarPagamento({ token, nomeCartao, cpf }) {
  await _processarCartao({ token, nomeCartao, cpf });
}

function mostrarErroCheckout(mensagem) { _mostrarErro('checkoutMPErroCartao', mensagem); }

function fecharModalCheckoutMP() {
  if (_pollingInterval) { clearInterval(_pollingInterval); _pollingInterval = null; }
  const overlay = document.getElementById('checkoutMPOverlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _escCheckout);
  _checkoutCallback = null;
  _checkoutPlanoId = null;
}

function _escCheckout(e) { if (e.key === 'Escape') fecharModalCheckoutMP(); }