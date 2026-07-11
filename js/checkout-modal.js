/**
 * checkout-modal.js
 * Modal de Checkout Transparente do Mercado Pago.
 * Funciona tanto na página /planos (público) quanto na aba Assinatura (app).
 *
 * Uso:
 *   abrirModalCheckoutMP(planoId, callbackSucesso)
 *
 * Onde planoId é: 'essencial' | 'essencial_anual' | 'pro' | 'pro_anual'
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

let _mpInstance = null;
let _checkoutCallback = null;
let _checkoutPlanoId = null;

// Carrega o SDK do Mercado Pago (só uma vez)
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

  // Cria o overlay do modal
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
        <p class="checkout-mp-erro" id="checkoutMPErro" style="display:none;"></p>

        <button type="button" class="checkout-mp-btn-pagar" id="btnCheckoutPagar">
          🔒 Confirmar assinatura
        </button>

        <p class="checkout-mp-seguro">
          Pagamento processado pelo Mercado Pago · Seus dados não passam pelos nossos servidores
        </p>
      </form>

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

  // Estilos inline do modal (não dependem do style.css do app)
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
        font-size: 14px; color: #D9A441; font-weight: 600; margin: 0 0 24px;
      }
      .checkout-mp-loading {
        display: flex; align-items: center; gap: 10px;
        color: #5B6259; font-size: 14px; padding: 20px 0;
      }
      .checkout-mp-spinner {
        width: 18px; height: 18px; border: 2px solid #e0e0e0;
        border-top-color: #1B3A2F; border-radius: 50%;
        animation: checkoutSpin .7s linear infinite; flex-shrink: 0;
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
      .checkout-mp-input-mp iframe {
        width: 100%; height: 46px; border: none; display: block;
      }
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
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  // Mascara CPF
  const campoCPF = document.getElementById('checkoutCPF');
  if (campoCPF) {
    campoCPF.addEventListener('input', () => {
      let v = campoCPF.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
      else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
      else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
      campoCPF.value = v;
    });
  }

  // Fecha ao clicar fora ou no X
  document.getElementById('btnFecharCheckoutMP').addEventListener('click', fecharModalCheckoutMP);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModalCheckoutMP(); });
  document.addEventListener('keydown', _escCheckout);

  // Carrega SDK e monta o formulário
  try {
    if (!window.DB) throw new Error('Módulo de dados não carregado. Recarregue a página e tente novamente.');
    const { publicKey } = await window.DB.iniciarCheckout();
    const mp = await carregarSDKMercadoPago(publicKey);
    const cardForm = mp.cardForm({
      amount: CHECKOUT_VALORES_PLANO[_checkoutPlanoId] || '19.90',
      iframe: true,
      form: {
        id: 'checkoutMPForm', // deve ser um <form> real para o SDK do MP montar os iframes
        cardNumber: { id: 'checkoutNumeroCartao', placeholder: '0000 0000 0000 0000' },
        cardExpirationMonth: { id: 'checkoutMes', placeholder: 'MM' },
        cardExpirationYear: { id: 'checkoutAno', placeholder: 'AA' },
        securityCode: { id: 'checkoutCVV', placeholder: '123' },
        cardholderName: { id: 'checkoutNomeTitular' },
        issuer: { id: 'checkoutIssuer' }, // campo oculto
        installments: { id: 'checkoutParcelas' }, // campo oculto
      },
      callbacks: {
        onFormMounted: () => {
          document.getElementById('checkoutMPCarregando').style.display = 'none';
          document.getElementById('checkoutMPForm').style.display = 'block';
        },
        onError: (erros) => {
          const msg = Array.isArray(erros) ? erros.map(e => e.message || e.cause || JSON.stringify(e)).join('; ') : JSON.stringify(erros);
          console.error('MP CardForm erros:', erros);
          mostrarErroCheckout('SDK: ' + msg);
        },
        onSubmit: async (event) => {
          event.preventDefault();
          const { token, cardholderName } = cardForm.getCardFormData();
          const cpfLimpo = (document.getElementById('checkoutCPF')?.value || '').replace(/\D/g, '');
          await processarPagamento({ token, nomeCartao: cardholderName, cpf: cpfLimpo });
        },
      },
    });

    document.getElementById('btnCheckoutPagar').addEventListener('click', () => {
      cardForm.submit();
    });

  } catch (erro) {
    document.getElementById('checkoutMPCarregando').style.display = 'none';
    document.getElementById('checkoutMPForm').style.display = 'block';
    mostrarErroCheckout(erro.message || 'Erro ao carregar o formulário de pagamento.');
  }
}

async function processarPagamento({ token, nomeCartao, cpf }) {
  const btnPagar = document.getElementById('btnCheckoutPagar');
  const erroEl = document.getElementById('checkoutMPErro');

  if (!token) {
    mostrarErroCheckout('Verifique os dados do cartão e tente novamente.');
    return;
  }

  if (btnPagar) { btnPagar.disabled = true; btnPagar.textContent = 'Processando…'; }
  if (erroEl) erroEl.style.display = 'none';

  try {
    const resultado = await window.DB.assinarComCartao({
      token,
      planoId: _checkoutPlanoId,
      nomeCartao,
      cpf,
    });

    if (resultado.planoAtivado) {
      // Mostra tela de sucesso
      document.getElementById('checkoutMPForm').style.display = 'none';
      document.getElementById('checkoutMPSucesso').style.display = 'block';
      document.getElementById('btnCheckoutContinuar').addEventListener('click', () => {
        fecharModalCheckoutMP();
        if (_checkoutCallback) _checkoutCallback();
      });
    } else {
      // Pagamento pendente (raro, mas pode acontecer)
      mostrarErroCheckout('Pagamento em análise. Assim que confirmado, seu plano será ativado automaticamente.');
      if (btnPagar) { btnPagar.disabled = false; btnPagar.textContent = '🔒 Confirmar assinatura'; }
    }
  } catch (erro) {
    mostrarErroCheckout(erro.message || 'Não foi possível processar o pagamento. Tente novamente.');
    if (btnPagar) { btnPagar.disabled = false; btnPagar.textContent = '🔒 Confirmar assinatura'; }
  }
}

function mostrarErroCheckout(mensagem) {
  const el = document.getElementById('checkoutMPErro');
  if (!el) return;
  el.textContent = mensagem;
  el.style.display = 'block';
}

function fecharModalCheckoutMP() {
  const overlay = document.getElementById('checkoutMPOverlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _escCheckout);
  _checkoutCallback = null;
  _checkoutPlanoId = null;
}

function _escCheckout(e) {
  if (e.key === 'Escape') fecharModalCheckoutMP();
}