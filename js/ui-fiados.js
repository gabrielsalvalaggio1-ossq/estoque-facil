/**
 * ui-fiados.js
 * Tela "Gestão de Fiados" — análise de vendas fiado em aberto.
 *
 * Padrões seguidos:
 * - Chamadas via fetch /api/fiado (mesmo padrão de db.js)
 * - Modais com modal-wrap + document.body.appendChild (igual ui-clientes-render.js)
 * - escaparHtml para todo conteúdo dinâmico
 * - formatarMoeda para valores monetários (definida em ui-base.js)
 */

// Cache local da última carga de fiados
let fiadosCache = null;

/**
 * Renderiza a tela principal de Gestão de Fiados no #main.
 * Chamada pelo renderizarConteudo() quando abaAtual === 'fiados'.
 */
async function renderizarTelaFiados() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page">
      <h2>💳 Gestão de Fiados</h2>
      <div id="fiadosConteudo">
        <div class="fiados-loading">
          <span class="fiados-loading-icon">💳</span>
          <span>Carregando fiados…</span>
        </div>
      </div>
    </div>
  `;
  await carregarFiados();
}

async function carregarFiados() {
  try {
    const resp = await fetch('/api/fiado');
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => ({}));
      throw new Error(corpo.error || 'Erro ao carregar fiados.');
    }
    const dados = await resp.json();
    fiadosCache = dados;
    renderizarFiados(dados);
  } catch (erro) {
    const container = document.getElementById('fiadosConteudo');
    if (container) {
      container.innerHTML = `
        <div class="fiados-vazio">
          <span class="fiados-vazio-icon">⚠️</span>
          <p class="fiados-vazio-titulo">Erro ao carregar</p>
          <p class="fiados-vazio-dica">${escaparHtml(erro.message)}</p>
          <button class="btn ghost" onclick="carregarFiados()" style="margin-top:12px;">Tentar novamente</button>
        </div>
      `;
    }
  }
}

function renderizarFiados(dados) {
  const container = document.getElementById('fiadosConteudo');
  if (!container) return;

  const { totalGeral, qtdVendas, qtdClientes, clientes } = dados;

  const resumoHtml = `
    <div class="fiados-resumo">
      <div class="fiados-stat stat-destaque">
        <span class="fiados-stat-lbl">Total em aberto</span>
        <span class="fiados-stat-val">${formatarMoeda(totalGeral)}</span>
      </div>
      <div class="fiados-stat">
        <span class="fiados-stat-lbl">Vendas fiado</span>
        <span class="fiados-stat-val">${qtdVendas}</span>
      </div>
      <div class="fiados-stat">
        <span class="fiados-stat-lbl">Clientes</span>
        <span class="fiados-stat-val">${qtdClientes}</span>
      </div>
    </div>
  `;

  const btnAgregacaoHtml = clientes.length >= 2 ? `
    <button class="fiados-btn-agregar" onclick="abrirModalDuplicatasFiado()">
      🔍 Sugerir agregações de clientes
    </button>
  ` : '';

  if (clientes.length === 0) {
    container.innerHTML = `
      ${resumoHtml}
      <div class="fiados-vazio">
        <span class="fiados-vazio-icon">🎉</span>
        <p class="fiados-vazio-titulo">Nenhum fiado em aberto</p>
        <p class="fiados-vazio-dica">Todas as vendas no fiado estão quitadas ou não há vendas fiado registradas.</p>
      </div>
    `;
    return;
  }

  const listaHtml = clientes.map(c => {
    const inicial = (c.nome || '?')[0].toUpperCase();
    const ultima = c.ultimaVenda
      ? new Date(c.ultimaVenda).toLocaleDateString('pt-BR')
      : null;
    return `
      <div class="fiados-cliente-card" onclick="abrirDetalhesFiado('${escaparHtml(encodeURIComponent(c.nome))}')">
        <div class="fiados-cliente-avatar">${escaparHtml(inicial)}</div>
        <div class="fiados-cliente-info">
          <div class="fiados-cliente-nome">${escaparHtml(c.nome)}</div>
          <div class="fiados-cliente-meta">
            <span>${c.qtdVendas} venda${c.qtdVendas !== 1 ? 's' : ''}</span>
            ${ultima ? `<span>Última: ${ultima}</span>` : ''}
          </div>
        </div>
        <div class="fiados-cliente-total">${formatarMoeda(c.totalDevido)}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${resumoHtml}
    ${btnAgregacaoHtml}
    <p class="fiados-secao-titulo">Clientes com fiado em aberto</p>
    ${listaHtml}
  `;
}

// ---------------------------------------------------------------------------
// Modal de detalhes de um cliente
// ---------------------------------------------------------------------------

async function abrirDetalhesFiado(nomeEncoded) {
  const nome = decodeURIComponent(nomeEncoded);

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'fiadoDetalheWrap';
  wrap.innerHTML = `
    <div class="modal modal-cliente">
      <h2>💳 ${escaparHtml(nome)}</h2>
      <div class="fiados-loading" style="padding:24px 0;">
        <span class="fiados-loading-icon">💳</span>
        <span>Carregando…</span>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModalFiadoDetalhe(); });

  try {
    const resp = await fetch(`/api/fiado/cliente/${encodeURIComponent(nome)}`);
    if (!resp.ok) throw new Error('Erro ao carregar detalhes.');
    const dados = await resp.json();
    renderizarModalDetalhesFiado(wrap.querySelector('.modal'), dados, nome);
  } catch (erro) {
    wrap.querySelector('.modal').innerHTML = `
      <h2>💳 ${escaparHtml(nome)}</h2>
      <p style="color:var(--coral-deep);">${escaparHtml(erro.message)}</p>
      <button class="btn ghost" onclick="fecharModalFiadoDetalhe()">Fechar</button>
    `;
  }
}

function renderizarModalDetalhesFiado(modal, dados, nome) {
  const { totalDevido, qtdVendas, vendas } = dados;

  const statsHtml = `
    <div class="fiados-modal-stats">
      <div class="fiados-modal-stat destaque">
        <span class="fiados-modal-stat-lbl">Total em aberto</span>
        <span class="fiados-modal-stat-val">${formatarMoeda(totalDevido)}</span>
      </div>
      <div class="fiados-modal-stat">
        <span class="fiados-modal-stat-lbl">Vendas fiado</span>
        <span class="fiados-modal-stat-val">${qtdVendas}</span>
      </div>
    </div>
  `;

  const historicoHtml = vendas.length === 0
    ? `<p class="cliente-sem-historico">Nenhuma venda encontrada.</p>`
    : `
      <p class="fiados-historico-titulo">Histórico de vendas fiado</p>
      ${vendas.map((v, idx) => {
        const data = v.data ? new Date(v.data).toLocaleDateString('pt-BR') : '—';
        const itensHtml = (v.itens || []).map(item => {
          const qtdStr = item.unidade === 'kg'
            ? `${Number(item.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg`
            : `${item.quantidade}×`;
          const precoTotal = (item.precoUnitario || 0) * (item.quantidade || 1);
          return `
            <div class="fiados-venda-item">
              <span class="fiados-venda-item-nome">${escaparHtml(item.nome)}</span>
              <span class="fiados-venda-item-qtd">${qtdStr}</span>
              <span class="fiados-venda-item-preco">${formatarMoeda(precoTotal)}</span>
            </div>
          `;
        }).join('');

        const vendaIdSafe = escaparHtml(v.id || '');
        const nomeSafe = escaparHtml(encodeURIComponent(nome));

        return `
          <div class="fiados-venda-row" id="fiadoVenda_${idx}">
            <div class="fiados-venda-header" onclick="toggleItensVendaFiado(${idx})">
              <span class="fiados-venda-data">${data}</span>
              <span style="flex:1;"></span>
              <span class="fiados-venda-total">${formatarMoeda(v.total)}</span>
              <span class="fiados-venda-chevron" id="fiadoChevron_${idx}">▾</span>
            </div>
            <div class="fiados-venda-itens" id="fiadoItens_${idx}">
              ${itensHtml || '<p style="font-size:12px;color:var(--ink-soft);padding:4px 0;">Sem itens detalhados.</p>'}
              <div class="fiados-venda-quitar-row">
                <button class="btn ghost fiados-btn-quitar-venda"
                  onclick="quitar1VendaFiado('${vendaIdSafe}','${nomeSafe}',${idx})">
                  ✅ Quitar esta venda
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;

  modal.innerHTML = `
    <h2>💳 ${escaparHtml(nome)}</h2>
    ${statsHtml}
    <div class="fiados-quitar-total-wrap">
      <button class="btn primary fiados-btn-quitar-total"
        onclick="quitarTodasVendasFiado('${escaparHtml(encodeURIComponent(nome))}')">
        ✅ Quitar tudo — ${formatarMoeda(totalDevido)}
      </button>
    </div>
    ${historicoHtml}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn ghost" onclick="fecharModalFiadoDetalhe()">Fechar</button>
    </div>
  `;
}


// ---------------------------------------------------------------------------
// Quitação de fiado
// ---------------------------------------------------------------------------

async function quitar1VendaFiado(vendaId, nomeEncoded, idx) {
  const nome = decodeURIComponent(nomeEncoded);
  const ok = confirm(`Confirmar quitação desta venda de ${nome}?`);
  if (!ok) return;
  const btn = document.querySelector(`#fiadoItens_${idx} .fiados-btn-quitar-venda`);
  if (btn) { btn.disabled = true; btn.textContent = 'Quitando…'; }
  try {
    const resp = await fetch('/api/fiado/quitar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendaId }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Erro ao quitar.'); }
    const row = document.getElementById(`fiadoVenda_${idx}`);
    if (row) {
      row.style.opacity = '0.45'; row.style.pointerEvents = 'none';
      const totalEl = row.querySelector('.fiados-venda-total');
      if (totalEl) { totalEl.style.textDecoration = 'line-through'; totalEl.style.color = 'var(--ink-soft)'; }
      if (btn) btn.remove();
    }
    await _atualizarResumoModalFiado(nome);
    carregarFiados();
  } catch (erro) {
    alert(erro.message);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Quitar esta venda'; }
  }
}

async function quitarTodasVendasFiado(nomeEncoded) {
  const nome = decodeURIComponent(nomeEncoded);
  const ok = confirm(`Quitar TODAS as vendas fiado de ${nome}?

Essa ação marca todo o débito como pago.`);
  if (!ok) return;
  const btnTotal = document.querySelector('.fiados-btn-quitar-total');
  if (btnTotal) { btnTotal.disabled = true; btnTotal.textContent = 'Quitando…'; }
  try {
    const resp = await fetch('/api/fiado/quitar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeCliente: nome }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Erro ao quitar.'); }
    const resultado = await resp.json();
    fecharModalFiadoDetalhe();
    await carregarFiados();
    _mostrarToastFiado(`✅ ${resultado.quitadas} venda${resultado.quitadas !== 1 ? 's' : ''} quitada${resultado.quitadas !== 1 ? 's' : ''} — ${formatarMoeda(resultado.totalQuitado || 0)}`);
  } catch (erro) {
    alert(erro.message);
    if (btnTotal) { btnTotal.disabled = false; }
  }
}

async function _atualizarResumoModalFiado(nome) {
  try {
    const resp = await fetch(`/api/fiado/cliente/${encodeURIComponent(nome)}`);
    if (!resp.ok) return;
    const dados = await resp.json();
    const statTotal = document.querySelector('.fiados-modal-stat.destaque .fiados-modal-stat-val');
    const statQtd = document.querySelector('.fiados-modal-stat:not(.destaque) .fiados-modal-stat-val');
    if (statTotal) statTotal.textContent = formatarMoeda(dados.totalDevido);
    if (statQtd) statQtd.textContent = dados.qtdVendas;
    const btnTotal = document.querySelector('.fiados-btn-quitar-total');
    if (btnTotal) {
      if (dados.totalDevido <= 0) { btnTotal.remove(); }
      else { btnTotal.textContent = `✅ Quitar tudo — ${formatarMoeda(dados.totalDevido)}`; }
    }
  } catch { }
}

function _mostrarToastFiado(msg) {
  const toast = document.createElement('div');
  toast.className = 'fiados-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('fiados-toast--visivel'));
  setTimeout(() => { toast.classList.remove('fiados-toast--visivel'); setTimeout(() => toast.remove(), 300); }, 3000);
}
function toggleItensVendaFiado(idx) {
  const itensEl = document.getElementById(`fiadoItens_${idx}`);
  const chevronEl = document.getElementById(`fiadoChevron_${idx}`);
  if (!itensEl) return;
  const estaAberto = itensEl.classList.contains('aberto');
  itensEl.classList.toggle('aberto', !estaAberto);
  if (chevronEl) chevronEl.classList.toggle('aberto', !estaAberto);
}

function fecharModalFiadoDetalhe() {
  const wrap = document.getElementById('fiadoDetalheWrap');
  if (!wrap) return;
  wrap.classList.add('modal-wrap--saindo');
  setTimeout(() => wrap.remove(), 180);
}

// ---------------------------------------------------------------------------
// Modal de duplicatas
// ---------------------------------------------------------------------------

async function verificarDuplicatasFiado() {
  const resp = await fetch('/api/fiado/duplicatas');
  if (!resp.ok) return [];
  const dados = await resp.json();
  return dados.grupos || [];
}

async function abrirModalDuplicatasFiado() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.id = 'fiadoDuplicatasWrap';
  wrap.innerHTML = `
    <div class="modal modal-cliente">
      <h2>⚠️ Nomes parecidos</h2>
      <div class="fiados-loading" style="padding:24px 0;">
        <span class="fiados-loading-icon">🔍</span>
        <span>Verificando…</span>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) fecharModalDuplicatasFiado(); });

  try {
    const grupos = await verificarDuplicatasFiado();
    renderizarModalDuplicatas(wrap.querySelector('.modal'), grupos);
  } catch (erro) {
    wrap.querySelector('.modal').innerHTML = `
      <h2>⚠️ Nomes parecidos</h2>
      <p style="color:var(--coral-deep);">Erro ao verificar duplicatas.</p>
      <button class="btn ghost" onclick="fecharModalDuplicatasFiado()">Fechar</button>
    `;
  }
}

function renderizarModalDuplicatas(modal, grupos) {
  if (grupos.length === 0) {
    modal.innerHTML = `
      <h2>⚠️ Nomes parecidos</h2>
      <div class="fiados-vazio" style="padding:24px 0;">
        <span class="fiados-vazio-icon">✅</span>
        <p class="fiados-vazio-titulo">Nenhuma duplicata encontrada</p>
        <p class="fiados-vazio-dica">Todos os nomes parecem ser de pessoas diferentes.</p>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick="fecharModalDuplicatasFiado()">Fechar</button>
      </div>
    `;
    return;
  }

  const gruposHtml = grupos.map((grupo, gIdx) => {
    const nomes = grupo.nomes;
    const itensHtml = nomes.map(n => `
      <div class="fiados-dup-item">
        <span class="fiados-dup-nome">${escaparHtml(n.nome)}</span>
        <span class="fiados-dup-valor">${formatarMoeda(n.total)}</span>
      </div>
    `).join('');

    // Lista de nomes para uso nos botões (serializada em JSON)
    const nomesJson = escaparHtml(JSON.stringify(nomes.map(n => n.nome)));
    const primeiroNome = escaparHtml(nomes[0].nome);

    return `
      <div class="fiados-dup-grupo" id="fiadoDupGrupo_${gIdx}">
        <p class="fiados-dup-titulo">Possíveis nomes da mesma pessoa</p>
        <div class="fiados-dup-lista">${itensHtml}</div>
        <div class="fiados-dup-total-linha">
          <span>Total combinado</span>
          <span>${formatarMoeda(grupo.totalCombinado)}</span>
        </div>
        <div class="fiados-dup-acoes">
          <button class="btn primary" onclick='confirmarUnificacaoFiado(${gIdx}, ${nomesJson})'>
            Unificar
          </button>
          <button class="btn danger" onclick='marcarPessoasDiferentesFiado(${gIdx}, ${nomesJson})'>
            São diferentes
          </button>
          <button class="btn ghost" onclick='ignorarGrupoDuplicataFiado(${gIdx})'>
            Ignorar
          </button>
        </div>
      </div>
    `;
  }).join('');

  modal.innerHTML = `
    <h2>⚠️ Nomes parecidos</h2>
    <p style="font-size:13px;color:var(--ink-soft);margin-bottom:14px;">
      O sistema encontrou nomes que podem ser da mesma pessoa. Confirme ou descarte cada sugestão.
    </p>
    <div id="fiadoGruposDuplicatas">
      ${gruposHtml}
    </div>
    <div class="modal-actions" style="margin-top:8px;">
      <button class="btn ghost" onclick="fecharModalDuplicatasFiado()">Fechar</button>
    </div>
  `;
}

/**
 * Abre sub-modal para o usuário escolher o nome canônico antes de unificar.
 */
function confirmarUnificacaoFiado(gIdx, nomes) {
  // Cria um pequeno prompt inline dentro do grupo
  const grupoEl = document.getElementById(`fiadoDupGrupo_${gIdx}`);
  if (!grupoEl) return;

  const opcoesHtml = nomes.map((nome, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
      <input type="radio" name="nomeCanonical_${gIdx}" value="${escaparHtml(nome)}" ${i === 0 ? 'checked' : ''}>
      <span style="font-size:13.5px;">${escaparHtml(nome)}</span>
    </label>
  `).join('');

  // Substitui as ações pelo seletor de nome principal
  const acoesEl = grupoEl.querySelector('.fiados-dup-acoes');
  acoesEl.innerHTML = `
    <div style="width:100%;">
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 8px;">Escolha o nome principal:</p>
      ${opcoesHtml}
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn primary" onclick="executarUnificacaoFiado(${gIdx}, ${escaparHtml(JSON.stringify(nomes))})">
          Confirmar unificação
        </button>
        <button class="btn ghost" onclick="carregarModalDuplicatasNovamente()">Cancelar</button>
      </div>
    </div>
  `;
}

async function executarUnificacaoFiado(gIdx, nomes) {
  const selecionado = document.querySelector(`input[name="nomeCanonical_${gIdx}"]:checked`);
  if (!selecionado) return;

  const nomeCanonical = selecionado.value;
  const aliases = nomes.filter(n => n !== nomeCanonical);

  try {
    const resp = await fetch('/api/fiado/unificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeCanonical, aliases }),
    });
    if (!resp.ok) throw new Error('Erro ao unificar.');

    // Remove o grupo da tela
    const grupoEl = document.getElementById(`fiadoDupGrupo_${gIdx}`);
    if (grupoEl) {
      grupoEl.style.opacity = '0';
      grupoEl.style.transition = 'opacity 200ms';
      setTimeout(() => grupoEl.remove(), 220);
    }

    // Recarrega a lista principal em segundo plano
    carregarFiados();

    const container = document.getElementById('fiadoGruposDuplicatas');
    if (container && container.querySelectorAll('.fiados-dup-grupo').length <= 1) {
      setTimeout(() => fecharModalDuplicatasFiado(), 300);
    }
  } catch (erro) {
    alert('Erro ao unificar: ' + erro.message);
  }
}

async function marcarPessoasDiferentesFiado(gIdx, nomes) {
  // Marca todos os pares possíveis como "pessoas diferentes"
  const promessas = [];
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      promessas.push(
        fetch('/api/fiado/nao-unificar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nomeA: nomes[i], nomeB: nomes[j] }),
        })
      );
    }
  }
  await Promise.all(promessas).catch(() => {});

  const grupoEl = document.getElementById(`fiadoDupGrupo_${gIdx}`);
  if (grupoEl) {
    grupoEl.style.opacity = '0';
    grupoEl.style.transition = 'opacity 200ms';
    setTimeout(() => grupoEl.remove(), 220);
  }

  const container = document.getElementById('fiadoGruposDuplicatas');
  if (container && container.querySelectorAll('.fiados-dup-grupo').length <= 1) {
    setTimeout(() => fecharModalDuplicatasFiado(), 300);
  }
}

function ignorarGrupoDuplicataFiado(gIdx) {
  const grupoEl = document.getElementById(`fiadoDupGrupo_${gIdx}`);
  if (grupoEl) {
    grupoEl.style.opacity = '0';
    grupoEl.style.transition = 'opacity 200ms';
    setTimeout(() => grupoEl.remove(), 220);
  }
}

async function carregarModalDuplicatasNovamente() {
  const modal = document.querySelector('#fiadoDuplicatasWrap .modal');
  if (!modal) return;
  modal.innerHTML = `
    <h2>⚠️ Nomes parecidos</h2>
    <div class="fiados-loading" style="padding:24px 0;">
      <span class="fiados-loading-icon">🔍</span>
      <span>Verificando…</span>
    </div>
  `;
  try {
    const grupos = await verificarDuplicatasFiado();
    renderizarModalDuplicatas(modal, grupos);
  } catch { /* mantém loading */ }
}

function fecharModalDuplicatasFiado() {
  const wrap = document.getElementById('fiadoDuplicatasWrap');
  if (!wrap) return;
  wrap.classList.add('modal-wrap--saindo');
  setTimeout(() => wrap.remove(), 180);
}
