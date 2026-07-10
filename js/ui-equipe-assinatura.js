/**
 * ui-equipe-assinatura.js
 * Aba Conta: gestão de equipe e Minha Assinatura, além de salvar/excluir produto.
 * Depende de estado e helpers globais definidos em ui-base.js (carregado antes deste).
 */

/**
 * ui-equipe-assinatura.js
 * Parte de app.js, dividido em módulos menores para facilitar manutenção.
 * Depende de estado global e helpers definidos em ui-base.js (carregado antes).
 */

// --- Gestão de equipe (aba Conta, só visível pra "dono") ---

// Guarda a última lista de membros carregada, pra poder referenciar cada
// linha por índice nos cliques de remover/confirmar sem precisar escapar
// e-mails em seletores CSS.
let membrosEquipeCache = [];

// --- Minha assinatura (/api/assinatura) ---------------------------------

let assinaturaCache = null;

const ESTADO_ASSINATURA_UI = {
  ACTIVE:   { rotulo: 'Ativo',              classe: 'ativo' },
  TRIAL:    { rotulo: 'Ativo',              classe: 'ativo' },
  PAST_DUE: { rotulo: 'Pagamento pendente', classe: 'pendente' },
  CANCELED: { rotulo: 'Cancelado',          classe: 'cancelado' },
  EXPIRED:  { rotulo: 'Cancelado',          classe: 'cancelado' },
  // 'FREE' não é mais gravado como status (era um valor legado, confundia
  // plano com status de ciclo de vida) — mantido aqui só pra não quebrar
  // contas antigas que ainda tenham essa linha no banco.
  FREE:     { rotulo: 'Ativo',              classe: 'ativo' },
};

const PLANOS_CATALOGO_MENSAL = [
  { id: 'free',      nome: 'MEV Free',  precoTexto: 'Grátis' },
  { id: 'essencial', nome: 'Essencial', precoTexto: 'R$ 19,90/mês' },
  { id: 'pro',       nome: 'Pro',       precoTexto: 'R$ 39,90/mês' },
];
const PLANOS_CATALOGO_ANUAL = [
  { id: 'free',            nome: 'MEV Free',  precoTexto: 'Grátis' },
  { id: 'essencial_anual', nome: 'Essencial', precoTexto: 'R$ 16,58/mês · R$ 199/ano' },
  { id: 'pro_anual',       nome: 'Pro',       precoTexto: 'R$ 33,25/mês · R$ 399/ano' },
];

function formatarDataCurta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

async function carregarTelaAssinatura() {
  const container = document.getElementById('assinaturaContainer');
  if (!container) return;
  try {
    assinaturaCache = await DB.buscarAssinatura();
    container.innerHTML = telaAssinaturaHtml(assinaturaCache);
    inicializarAcoesAssinatura();
  } catch (erro) {
    container.innerHTML = `<div class="card-info"><p class="erro" style="margin:0;">${escaparHtml(erro.message || 'Não foi possível carregar sua assinatura.')}</p></div>`;
  }
}

function telaAssinaturaHtml(a) {
  const ehPlanoGratuito = a.planoId === 'free';
  // O plano FREE nunca deve exibir "cancelada": não há cobrança, então não
  // existe cancelamento de verdade nesse plano — só existe "upgrade" ou
  // "continuar no free". Isso protege a UI mesmo se algum dado antigo/
  // inconsistente ainda tiver um status diferente de ACTIVE gravado.
  const estado = ehPlanoGratuito
    ? { rotulo: 'Plano Gratuito', classe: 'gratis' }
    : (ESTADO_ASSINATURA_UI[a.status] || { rotulo: a.status, classe: 'gratis' });
  const emCanceladoOuExpirado = !ehPlanoGratuito && (a.status === 'CANCELED' || a.status === 'EXPIRED');

  let preco;
  if (a.planoId === 'free' || !a.precoCentavos) {
    preco = 'Grátis';
  } else if (a.ciclo === 'anual' || (a.planoId || '').endsWith('_anual')) {
    // precoCentavos = total anual (ex: 19900 = R$ 199,00/ano)
    preco = formatarMoeda(a.precoCentavos / 100) + '/ano';
  } else {
    preco = formatarMoeda(a.precoCentavos / 100) + '/mês';
  }

  const proximaCobranca = a.planoId === 'free'
    ? 'Não se aplica (plano grátis)'
    : emCanceladoOuExpirado
      ? 'Assinatura cancelada — sem próxima cobrança'
      : formatarDataCurta(a.dataExpiracao);

  const formaPagamento = a.planoId === 'free'
    ? 'Nenhuma — plano grátis não exige pagamento'
    : 'Ativado manualmente — sem cobrança automática por enquanto';

  const podeAgir = ehPlanoGratuito || a.status !== 'CANCELED';
  const cicloAtual = (a.planoId || '').endsWith('_anual') ? 'anual' : 'mensal';

  return `
    <div class="card-info card-plano-atual">
      <div class="plano-atual-topo">
        <div>
          <p class="plano-atual-nome">${escaparHtml(a.planoNome || NOME_PLANO_FALLBACK[a.planoId] || a.planoId)}</p>
          <p class="plano-atual-preco">${escaparHtml(preco)}</p>
        </div>
        <span class="status-pill status-${estado.classe}"><span class="dot"></span>${escaparHtml(estado.rotulo)}</span>
      </div>

      <div class="plano-atual-linha">
        <span class="lbl">Próxima cobrança</span>
        <span class="val">${escaparHtml(proximaCobranca)}</span>
      </div>
      <div class="plano-atual-linha">
        <span class="lbl">Forma de pagamento</span>
        <span class="val">${escaparHtml(formaPagamento)}</span>
      </div>
    </div>

    ${(!ehPlanoGratuito && a.status === 'PAST_DUE') ? `
      <div class="aviso-assinatura aviso-pendente">
        ⚠️ Não conseguimos confirmar seu último pagamento. Regularize para não perder acesso à escrita de dados.
      </div>` : ''}
    ${emCanceladoOuExpirado ? `
      <div class="aviso-assinatura aviso-cancelado">
        Sua assinatura está cancelada. Escolha um plano abaixo para reativar o sistema.
      </div>` : ''}

    <div class="card-info">
      <h3>Planos disponíveis</h3>

      <div class="toggle-ciclo-wrap">
        <button type="button" class="btn-ciclo${cicloAtual === 'mensal' ? ' ativo' : ''}" data-ciclo="mensal">
          Mensal
        </button>
        <button type="button" class="btn-ciclo${cicloAtual === 'anual' ? ' ativo' : ''}" data-ciclo="anual">
          Anual <span class="tag-desconto-anual">2 meses grátis</span>
        </button>
      </div>

      <div class="lista-planos-troca" id="listaMensalAssinatura" ${cicloAtual === 'anual' ? 'hidden' : ''}>
        ${PLANOS_CATALOGO_MENSAL.map(p => {
          const ehAtual = p.id === a.planoId && podeAgir;
          const textoBotao = emCanceladoOuExpirado ? 'Reativar' : (PLANOS_ORDEM[p.id] > PLANOS_ORDEM[a.planoId] ? 'Fazer upgrade' : 'Mudar para este');
          return `
          <div class="opcao-plano ${ehAtual ? 'atual' : ''}">
            <div>
              <p class="opcao-plano-nome">${escaparHtml(p.nome)}</p>
              <p class="opcao-plano-preco">${escaparHtml(p.precoTexto)}</p>
            </div>
            ${ehAtual
              ? '<span class="opcao-plano-tag">Plano atual</span>'
              : `<button type="button" class="btn ${p.id === 'free' ? '' : 'primary'} btn-sm btn-trocar-plano" data-plano="${p.id}">${textoBotao}</button>`
            }
          </div>`;
        }).join('')}
      </div>

      <div class="lista-planos-troca" id="listaAnualAssinatura" ${cicloAtual === 'mensal' ? 'hidden' : ''}>
        ${PLANOS_CATALOGO_ANUAL.map(p => {
          const ehAtual = p.id === a.planoId && podeAgir;
          const textoBotao = emCanceladoOuExpirado ? 'Reativar' : (PLANOS_ORDEM[p.id] > PLANOS_ORDEM[a.planoId] ? 'Fazer upgrade' : 'Mudar para este');
          return `
          <div class="opcao-plano ${ehAtual ? 'atual' : ''}">
            <div>
              <p class="opcao-plano-nome">${escaparHtml(p.nome)}</p>
              <p class="opcao-plano-preco">${escaparHtml(p.precoTexto)}</p>
            </div>
            ${ehAtual
              ? '<span class="opcao-plano-tag">Plano atual</span>'
              : `<button type="button" class="btn ${p.id === 'free' ? '' : 'primary'} btn-sm btn-trocar-plano" data-plano="${p.id}">${textoBotao}</button>`
            }
          </div>`;
        }).join('')}
      </div>

      <p class="erro" id="erroAssinatura" style="display:none;margin-top:10px;"></p>
    </div>

    ${(podeAgir && !ehPlanoGratuito) ? `
      <div class="card-info" id="cardCancelarAssinatura">
        <h3>Cancelar assinatura</h3>
        <p class="texto-secundario">
          Você para de ser cobrado e perde acesso aos recursos pagos. Seus dados continuam salvos.
        </p>
        <button type="button" class="btn danger btn-sm" id="btnCancelarAssinatura">Cancelar assinatura</button>
      </div>
    ` : ''}
  `;
}

const NOME_PLANO_FALLBACK = { free: 'MEV Free', essencial: 'Essencial', pro: 'Pro', essencial_anual: 'Essencial Anual', pro_anual: 'Pro Anual' };
const PLANOS_ORDEM = { free: 0, essencial: 1, essencial_anual: 1, pro: 2, pro_anual: 2 };

function inicializarAcoesAssinatura() {
  document.querySelectorAll('.btn-trocar-plano').forEach(botao => {
    botao.addEventListener('click', () => trocarPlanoAssinatura(botao.dataset.plano, botao));
  });

  // Toggle mensal / anual na tela "Minha Assinatura"
  document.querySelectorAll('.btn-ciclo').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-ciclo').forEach(b => {
        b.classList.toggle('ativo', b === btn);
      });
      const ciclo = btn.dataset.ciclo;
      const listaMensal = document.getElementById('listaMensalAssinatura');
      const listaAnual  = document.getElementById('listaAnualAssinatura');
      if (listaMensal) listaMensal.hidden = ciclo !== 'mensal';
      if (listaAnual)  listaAnual.hidden  = ciclo !== 'anual';
    });
  });

  const btnCancelar = document.getElementById('btnCancelarAssinatura');
  if (btnCancelar) btnCancelar.addEventListener('click', pedirConfirmacaoCancelarAssinatura);
}

function mostrarErroAssinatura(mensagem) {
  const el = document.getElementById('erroAssinatura');
  if (!el) return;
  el.textContent = mensagem;
  el.style.display = 'block';
}

async function trocarPlanoAssinatura(planoId, botao) {
  if (!planoId || (botao && botao.disabled)) return;
  const textoOriginal = botao ? botao.textContent : '';

  // Sem gateway de pagamento por enquanto: qualquer plano (grátis ou pago)
  // é trocado direto pelo mesmo caminho, sem cobrança real.
  if (botao) { botao.disabled = true; botao.textContent = 'Aplicando…'; }
  try {
    await DB.mudarPlano(planoId);
    await carregarTelaAssinatura();
  } catch (erro) {
    mostrarErroAssinatura(erro.message || 'Não foi possível trocar de plano agora.');
    if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
  }
}

function pedirConfirmacaoCancelarAssinatura() {
  const card = document.getElementById('cardCancelarAssinatura');
  if (!card) return;
  card.innerHTML = `
    <h3>Cancelar assinatura</h3>
    <div class="team-confirm" style="justify-content:flex-start;">
      <span>Tem certeza? Você perde acesso aos recursos pagos imediatamente.</span>
      <button type="button" class="btn-confirmar-sim" id="btnConfirmarCancelar">Sim, cancelar</button>
      <button type="button" class="btn-confirmar-nao" id="btnVoltarCancelar">Voltar</button>
    </div>
  `;
  document.getElementById('btnConfirmarCancelar').addEventListener('click', confirmarCancelarAssinatura);
  document.getElementById('btnVoltarCancelar').addEventListener('click', carregarTelaAssinatura);
}

async function confirmarCancelarAssinatura() {
  const btn = document.getElementById('btnConfirmarCancelar');
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelando…'; }
  try {
    await DB.cancelarAssinatura('Cancelado pelo dono pela tela de assinatura');
    await carregarTelaAssinatura();
  } catch (erro) {
    mostrarErroAssinatura(erro.message || 'Não foi possível cancelar agora.');
    await carregarTelaAssinatura();
  }
}

const ROTULOS_PAPEL = { dono: 'Dono', vendedor: 'Vendedor', estoquista: 'Estoquista' };

// PLANOS_INFO legado foi removido — o pill de plano na Equipe agora lê
// direto de assinaturaCache (ver telaAssinaturaHtml / cartaoGestaoEquipeHtml),
// que é a mesma fonte de verdade da tela "Minha assinatura".

// Papel selecionado no toggle de "adicionar membro" (substitui o antigo <select>).
let papelEquipeSelecionado = 'vendedor';

function gerarIniciaisEmail(email) {
  const nomeParte = (email || '').split('@')[0] || '?';
  const pedacos = nomeParte.split(/[._-]/).filter(Boolean);
  if (pedacos.length >= 2) return (pedacos[0][0] + pedacos[1][0]).toUpperCase();
  return nomeParte.slice(0, 2).toUpperCase();
}

function cartaoGestaoEquipeHtml() {
  const nomePlano = (assinaturaCache && (assinaturaCache.planoNome || NOME_PLANO_FALLBACK[assinaturaCache.planoId])) || 'MEV Free';
  const maxMembros = (assinaturaCache && assinaturaCache.limiteMembros) || 1;
  return `
    <div class="card-info">
      <div class="team-header">
        <h3>Equipe</h3>
        <span class="team-plan-pill">${escaparHtml(nomePlano)} · até ${maxMembros} pessoa${maxMembros > 1 ? 's' : ''}</span>
      </div>

      <div id="listaMembros" class="team-list">
        <p class="team-msg">Carregando…</p>
      </div>

      <div class="team-add">
        <p class="team-add-label">Adicionar membro</p>

        <div class="field">
          <label for="fMembroEmail">E-mail do funcionário</label>
          <input id="fMembroEmail" type="email" placeholder="pessoa@exemplo.com" autocomplete="off">
        </div>

        <div class="field">
          <label>Papel</label>
          <div class="papel-toggle" id="papelToggle">
            <button type="button" class="papel-opt selected" data-papel="vendedor">Vendedor</button>
            <button type="button" class="papel-opt" data-papel="estoquista">Estoquista</button>
          </div>
        </div>

        <p class="erro" id="erroEquipe" style="display:none;"></p>
        <button type="button" class="btn primary" id="btnAdicionarMembro" style="width:100%;">Adicionar à equipe</button>
      </div>
    </div>
  `;
}

function inicializarGestaoEquipe() {
  papelEquipeSelecionado = 'vendedor';
  carregarListaMembros();

  const btnAdicionar = document.getElementById('btnAdicionarMembro');
  if (btnAdicionar) btnAdicionar.addEventListener('click', adicionarMembroDaEquipe);

  document.querySelectorAll('#papelToggle .papel-opt').forEach(botao => {
    botao.addEventListener('click', () => {
      papelEquipeSelecionado = botao.dataset.papel;
      document.querySelectorAll('#papelToggle .papel-opt').forEach(b => {
        b.classList.toggle('selected', b.dataset.papel === papelEquipeSelecionado);
      });
    });
  });
}

function linhaMembroHtml(membro, indice) {
  const rotulo = ROTULOS_PAPEL[membro.papel] || membro.papel;
  const ehEuMesmo = (membro.email || '').toLowerCase() === (usuarioLogadoEmail || '').toLowerCase();

  return `
    <div class="team-row" id="teamRow${indice}">
      <span class="team-avatar" aria-hidden="true">${escaparHtml(gerarIniciaisEmail(membro.email))}</span>
      <div class="team-info">
        <span class="team-email">${escaparHtml(membro.email)}${ehEuMesmo ? ' <span class="team-you">(você)</span>' : ''}</span>
        <span class="role-chip ${escaparHtml(membro.papel)}"><span class="dot"></span>${escaparHtml(rotulo)}</span>
      </div>
      ${ehEuMesmo ? '' : `
        <div class="team-actions">
          <button type="button" class="btn-editar-membro" data-indice="${indice}" aria-label="Editar papel de ${escaparHtml(membro.email)}" title="Editar papel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button type="button" class="btn-remover-membro" data-indice="${indice}" aria-label="Remover ${escaparHtml(membro.email)} da equipe" title="Remover da equipe">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
          </button>
        </div>
      `}
    </div>
  `;
}

// Papel escolhido durante a edição inline de um membro (linha "teamRowN"
// vira um mini-formulário com toggle de papel + salvar/cancelar).
let papelEdicaoSelecionado = 'vendedor';

function pedirEdicaoPapelMembro(indice) {
  const membro = membrosEquipeCache[indice];
  const linha = document.getElementById(`teamRow${indice}`);
  if (!membro || !linha) return;

  papelEdicaoSelecionado = membro.papel === 'estoquista' ? 'estoquista' : 'vendedor';

  linha.innerHTML = `
    <div class="team-edit">
      <span class="team-edit-label">Papel de ${escaparHtml(membro.email)}</span>
      <div class="papel-toggle" id="papelEditToggle${indice}">
        <button type="button" class="papel-opt ${papelEdicaoSelecionado === 'vendedor' ? 'selected' : ''}" data-papel="vendedor">Vendedor</button>
        <button type="button" class="papel-opt ${papelEdicaoSelecionado === 'estoquista' ? 'selected' : ''}" data-papel="estoquista">Estoquista</button>
      </div>
      <div class="team-edit-actions">
        <button type="button" class="btn primary btn-salvar-membro" data-indice="${indice}">Salvar</button>
        <button type="button" class="btn-cancelar-edicao" data-indice="${indice}">Cancelar</button>
      </div>
    </div>
  `;

  linha.querySelectorAll(`#papelEditToggle${indice} .papel-opt`).forEach(botao => {
    botao.addEventListener('click', () => {
      papelEdicaoSelecionado = botao.dataset.papel;
      linha.querySelectorAll(`#papelEditToggle${indice} .papel-opt`).forEach(b => {
        b.classList.toggle('selected', b.dataset.papel === papelEdicaoSelecionado);
      });
    });
  });

  linha.querySelector('.btn-salvar-membro').addEventListener('click', () => confirmarEdicaoMembro(indice));
  linha.querySelector('.btn-cancelar-edicao').addEventListener('click', () => carregarListaMembros());
}

async function confirmarEdicaoMembro(indice) {
  const membro = membrosEquipeCache[indice];
  if (!membro) return;

  const linha = document.getElementById(`teamRow${indice}`);
  const btnSalvar = linha ? linha.querySelector('.btn-salvar-membro') : null;
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
  }

  try {
    await DB.editarMembro(membro.email, papelEdicaoSelecionado);
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível editar esse membro.');
    await carregarListaMembros();
  }
}

async function carregarListaMembros() {
  const container = document.getElementById('listaMembros');
  if (!container) return;
  container.innerHTML = '<p class="team-msg">Carregando…</p>';

  try {
    membrosEquipeCache = await DB.listarMembros();
    if (membrosEquipeCache.length === 0) {
      container.innerHTML = '<p class="team-msg">Nenhum membro cadastrado ainda.</p>';
      return;
    }
    container.innerHTML = membrosEquipeCache.map((m, i) => linhaMembroHtml(m, i)).join('');
    container.querySelectorAll('.btn-remover-membro').forEach(botao => {
      botao.addEventListener('click', () => pedirConfirmacaoRemoverMembro(Number(botao.dataset.indice)));
    });
    container.querySelectorAll('.btn-editar-membro').forEach(botao => {
      botao.addEventListener('click', () => pedirEdicaoPapelMembro(Number(botao.dataset.indice)));
    });
  } catch (erro) {
    container.innerHTML = `<p class="erro" style="margin:0;">${escaparHtml(erro.message || 'Não foi possível carregar a equipe.')}</p>`;
  }
}

function pedirConfirmacaoRemoverMembro(indice) {
  const membro = membrosEquipeCache[indice];
  const linha = document.getElementById(`teamRow${indice}`);
  if (!membro || !linha) return;

  linha.innerHTML = `
    <div class="team-confirm">
      <span>Remover ${escaparHtml(membro.email)} da equipe?</span>
      <button type="button" class="btn-confirmar-sim" data-indice="${indice}">Remover</button>
      <button type="button" class="btn-confirmar-nao" data-indice="${indice}">Cancelar</button>
    </div>
  `;
  linha.querySelector('.btn-confirmar-sim').addEventListener('click', () => confirmarRemoverMembro(indice));
  linha.querySelector('.btn-confirmar-nao').addEventListener('click', () => carregarListaMembros());
}

async function confirmarRemoverMembro(indice) {
  const membro = membrosEquipeCache[indice];
  if (!membro) return;

  const linha = document.getElementById(`teamRow${indice}`);
  const btnSim = linha ? linha.querySelector('.btn-confirmar-sim') : null;
  if (btnSim) {
    btnSim.disabled = true;
    btnSim.textContent = 'Removendo…';
  }

  try {
    await DB.removerMembro(membro.email);
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível remover esse membro.');
    await carregarListaMembros();
  }
}

async function adicionarMembroDaEquipe() {
  const btn = document.getElementById('btnAdicionarMembro');
  if (!btn || btn.disabled) return;
  limparErroEquipe();

  const campoEmail = document.getElementById('fMembroEmail');
  const email = campoEmail.value.trim();
  const papel = papelEquipeSelecionado;

  if (!email || !email.includes('@')) {
    mostrarErroEquipe('Informe um e-mail válido.');
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Adicionando…';

  try {
    await DB.adicionarMembro(email, papel);
    campoEmail.value = '';
    await carregarListaMembros();
  } catch (erro) {
    mostrarErroEquipe(erro.message || 'Não foi possível adicionar esse membro.');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function mostrarErroEquipe(mensagem) {
  const erro = document.getElementById('erroEquipe');
  if (!erro) return;
  erro.textContent = mensagem;
  erro.style.display = 'block';
}

function limparErroEquipe() {
  const erro = document.getElementById('erroEquipe');
  if (!erro) return;
  erro.style.display = 'none';
  erro.textContent = '';
}

async function salvarFormularioProduto() {
  const btnSalvar = document.getElementById('btnSalvar');
  if (btnSalvar.disabled) return; // já está salvando — ignora cliques repetidos
  btnSalvar.disabled = true;
  const textoOriginal = btnSalvar.textContent;
  btnSalvar.textContent = 'Salvando…';

  const nome = document.getElementById('fNome').value.trim();
  const preco = parseFloat(document.getElementById('fPreco').value);
  // Produtos vendidos por peso aceitam quantidade decimal (ex: 12.5 kg);
  // produtos por unidade continuam em número inteiro.
  const estoque = unidadeSelecionada === 'kg'
    ? parseFloat(document.getElementById('fEstoque').value)
    : parseInt(document.getElementById('fEstoque').value, 10);
  const campoMinimo = document.getElementById('fMinimo');
  const campoCategoria = document.getElementById('fCategoria');
  const campoFornecedor = document.getElementById('fFornecedor');
  const campoCodigo = document.getElementById('fCodigoBarras');
  const campoPrecoCusto = document.getElementById('fPrecoCusto');
  const estoqueMinimo = campoMinimo ? parseInt(campoMinimo.value, 10) : NaN;
  const categoria = campoCategoria ? campoCategoria.value : '';
  const fornecedor = campoFornecedor ? campoFornecedor.value.trim() : '';
  const codigoBarras = campoCodigo ? campoCodigo.value.trim() : '';
  // Campo mascarado ("1.234,56") — convertido pro número em reais que o
  // resto do sistema usa. `null` quando a pessoa deixou em branco.
  const precoCusto = campoPrecoCusto ? valorMonetarioParaNumero(campoPrecoCusto.value) : null;
  const unidade = unidadeSelecionada;

  // Dimensões do produto — todos os campos são opcionais (preparação para
  // o futuro cálculo de frete da Loja Virtual). Só gravamos números válidos;
  // campo em branco vira null, igual ao tratamento de precoCusto acima.
  const campoPeso = document.getElementById('fPeso');
  const campoAltura = document.getElementById('fAltura');
  const campoLargura = document.getElementById('fLargura');
  const campoComprimento = document.getElementById('fComprimento');
  const campoUnidadePeso = document.getElementById('fUnidadePeso');
  const campoUnidadeMedida = document.getElementById('fUnidadeMedida');
  const paraNumeroOuNull = (valor) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') return null;
    const numero = parseFloat(valor);
    return isNaN(numero) ? null : numero;
  };
  const dimensoes = {
    peso: campoPeso ? paraNumeroOuNull(campoPeso.value) : null,
    altura: campoAltura ? paraNumeroOuNull(campoAltura.value) : null,
    largura: campoLargura ? paraNumeroOuNull(campoLargura.value) : null,
    comprimento: campoComprimento ? paraNumeroOuNull(campoComprimento.value) : null,
    unidadePeso: campoUnidadePeso ? campoUnidadePeso.value : 'kg',
    unidadeMedida: campoUnidadeMedida ? campoUnidadeMedida.value : 'cm'
  };

  try {
    if (idEmEdicao) {
      await Produtos.editarProduto(idEmEdicao, { nome, preco, estoque, estoqueMinimo, categoria, fornecedor, imagem: imagemPendente, codigoBarras, unidade, precoCusto, dimensoes });
    } else {
      await Produtos.criarProduto({ nome, preco, estoque, estoqueMinimo, categoria, fornecedor, imagem: imagemPendente, codigoBarras, unidade, precoCusto, dimensoes });
    }
    await recarregarDados();
    fecharModal();
    renderizarTudo();
  } catch (erro) {
    mostrarErroFormulario(erro.message || 'Não foi possível salvar. Verifique sua conexão e tente novamente.');
    btnSalvar.disabled = false;
    btnSalvar.textContent = textoOriginal;
  }
}

async function excluirProdutoComConfirmacao(id) {
  if (!await mostrarConfirm('Excluir este produto do estoque?', { confirmText: 'Excluir', cancelText: 'Cancelar', tipo: 'perigo' })) return;
  await Produtos.excluirProduto(id);
  delete carrinho[id];
  await recarregarDados();
  fecharModal();
  renderizarTudo();
}

function abrirEdicao(id) {
  const produto = produtosCache.find(p => p.id === id);
  if (produto) abrirModalProduto(produto);
}

