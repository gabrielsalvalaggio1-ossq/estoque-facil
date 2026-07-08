/**
 * functions/api/[[path]].js  (v2 — empresas, papéis e auditoria)
 *
 * Muda em relação à v1:
 *  - Os dados não são mais isolados por e-mail direto — são isolados por
 *    "empresa" (várias pessoas podem compartilhar a mesma empresa).
 *  - Cada e-mail pertence a uma empresa com um papel: dono, vendedor ou
 *    estoquista. O papel decide o que a pessoa pode fazer.
 *  - Toda escrita em vendas/movimentos carimba automaticamente quem fez
 *    (criado_por / registrado_por) — o cliente não escolhe isso, o servidor
 *    decide com base em quem está logado, pra não dar pra falsificar.
 *
 * Rotas:
 *   POST /api/empresas               -> cria uma empresa nova (self-service, vira "dono")
 *   GET  /api/me                     -> { email, empresaId, papel, nomeEmpresa, plano }
 *   GET  /api/membros                -> lista membros da empresa (só dono)
 *   POST /api/membros                -> adiciona um membro à empresa (só dono, respeita limite do plano)
 *   DELETE /api/membros/:email       -> remove um membro da empresa (só dono)
 *   GET  /api/:store                 -> lista registros da empresa nesse store
 *   GET  /api/:store/:id             -> um registro específico
 *   POST /api/:store                 -> cria um registro
 *   PUT  /api/:store/:id             -> atualiza um registro
 *   DELETE /api/:store/:id           -> remove um registro
 *   GET  /api/atividades             -> histórico de atividades da empresa (só dono, recurso do plano Pro)
 *
 * Toda escrita relevante (criar/editar/excluir registro, adicionar/remover
 * membro, mudar/cancelar plano) também grava uma linha em `atividades`
 * (ver registrarAtividade), pra o dono saber exatamente quem fez o quê.
 *
 * Requer o binding D1 "DB", igual antes.
 */

const STORES_VALIDOS = ['produtos', 'vendas', 'movimentos'];
const PAPEIS_VALIDOS = ['dono', 'vendedor', 'estoquista'];
const ROTULOS_PAPEL = { dono: 'Dono', vendedor: 'Vendedor', estoquista: 'Estoquista' };

// Estados possíveis de assinaturas.status (schema-assinaturas.sql).
// Observação: 'FREE' não é um status de ciclo de vida — é um plano
// (plano_id = 'free'). O status correto de uma assinatura do plano free é
// 'ACTIVE' (ativa, só que sem cobrança). Mantemos 'FREE' na lista só por
// compatibilidade com linhas antigas que ainda tiverem esse valor gravado.
const ESTADOS_ASSINATURA = ['ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'FREE'];

// Em quais estados a empresa ainda pode ESCREVER (vender, cadastrar produto,
// etc). Fora desses, só leitura — ninguém perde o histórico, só para de
// crescer o estoque/vendas até regularizar o pagamento.
// 'FREE' segue incluído por compatibilidade com dados antigos (ver acima).
const ESTADOS_QUE_PERMITEM_ESCRITA = new Set(['ACTIVE', 'TRIAL', 'PAST_DUE', 'FREE']);

const MENSAGENS_BLOQUEIO_ASSINATURA = {
  CANCELED: 'Sua assinatura foi cancelada. Reative um plano para voltar a cadastrar e vender.',
  EXPIRED: 'Sua assinatura expirou. Escolha um plano para continuar usando o sistema.',
};

// -------------------------------------------------------------------------
// Sistema central de permissões por plano. Uma única fonte de verdade:
// a coluna `planos.recursos` (JSON) + `planos.limite_produtos` /
// `planos.limite_membros`. Toda rota que precisa checar "meu plano deixa
// fazer isso?" chama verificarPlano(db, empresaId, recurso) — nunca decide
// isso com um `if` solto espalhado pelo código.
// -------------------------------------------------------------------------

// O que cada recurso bloqueado deve dizer pro usuário, e a partir de qual
// plano ele passa a estar disponível — usado tanto na mensagem quanto pra
// UI decidir qual botão de upgrade mostrar.
const INFO_RECURSOS = {
  produtos:           { rotulo: 'Cadastro de produtos além do limite',   planoMinimo: 'essencial' },
  clientes:           { rotulo: 'Histórico e cadastro de clientes',      planoMinimo: 'essencial' },
  relatorios:         { rotulo: 'Relatórios completos',                  planoMinimo: 'essencial' },
  backup:             { rotulo: 'Backup e exportação de dados',          planoMinimo: 'essencial' },
  equipe:             { rotulo: 'Convidar pessoas para a equipe',        planoMinimo: 'essencial' },
  permissoes_papeis:  { rotulo: 'Papéis e permissões por pessoa',        planoMinimo: 'pro' },
  auditoria:          { rotulo: 'Auditoria completa de ações',           planoMinimo: 'pro' },
};

const NOME_PLANO = { free: 'Free', essencial: 'Essencial', pro: 'Pro' };

/** Busca o plano + recursos vigentes da empresa, já com o JSON parseado. */
async function carregarPlanoDaEmpresa(db, empresaId) {
  const linha = await db
    .prepare(`
      SELECT a.status AS status, a.data_expiracao AS dataExpiracao, a.cancelado_em AS canceladoEm,
             p.id AS planoId, p.nome AS planoNome, p.preco_centavos AS precoCentavos, p.ciclo AS ciclo,
             p.limite_produtos AS limiteProdutos, p.limite_membros AS limiteMembros, p.recursos AS recursosJson
      FROM assinaturas a
      JOIN planos p ON p.id = a.plano_id
      WHERE a.empresa_id = ?
      ORDER BY a.criado_em DESC
      LIMIT 1
    `)
    .bind(empresaId)
    .first();

  if (!linha) return null;
  let recursos = {};
  try { recursos = JSON.parse(linha.recursosJson || '{}'); } catch { recursos = {}; }
  return {
    status: linha.status,
    dataExpiracao: linha.dataExpiracao,
    canceladoEm: linha.canceladoEm,
    planoId: linha.planoId,
    planoNome: linha.planoNome,
    precoCentavos: linha.precoCentavos,
    ciclo: linha.ciclo,
    limiteProdutos: linha.limiteProdutos,
    limiteMembros: linha.limiteMembros,
    recursos,
  };
}

function bloqueado(recurso, planoAtualId) {
  const info = INFO_RECURSOS[recurso] || { rotulo: recurso, planoMinimo: 'essencial' };
  const nomeNecessario = NOME_PLANO[info.planoMinimo] || info.planoMinimo;
  return {
    permitido: false,
    status: 403,
    error: `${info.rotulo} é um recurso do plano ${nomeNecessario}. Faça upgrade para desbloquear.`,
    recurso,
    planoAtual: planoAtualId,
    planoNecessario: info.planoMinimo,
  };
}

/**
 * Função central de permissões. Chama pra qualquer recurso gateado por
 * plano ANTES de executar a ação. Dois tipos de checagem:
 *  - "produtos"/"membros": recurso com LIMITE numérico (conta quantidade
 *    já existente e compara com planos.limite_produtos/limite_membros).
 *  - qualquer outra chave: feature liga/desliga lida de planos.recursos.
 *
 * Retorna { permitido: true } quando pode seguir, ou o objeto de
 * `bloqueado(...)` (permitido:false + mensagem amigável) quando não pode.
 */
async function verificarPlano(db, empresaId, recurso, extra = {}) {
  const plano = await carregarPlanoDaEmpresa(db, empresaId);
  if (!plano) {
    return { permitido: false, status: 402, error: 'Não encontramos uma assinatura ativa para sua empresa.' };
  }

  if (recurso === 'produtos') {
    if (plano.limiteProdutos == null) return { permitido: true, plano };
    const { total } = await db
      .prepare(`SELECT COUNT(*) AS total FROM registros WHERE empresa_id = ? AND store = 'produtos'`)
      .bind(empresaId)
      .first();
    if (total >= plano.limiteProdutos) {
      return {
        permitido: false, status: 403,
        error: `Você atingiu o limite de ${plano.limiteProdutos} produtos do plano ${NOME_PLANO[plano.planoId] || plano.planoId}. Faça upgrade para cadastrar produtos ilimitados.`,
        recurso, planoAtual: plano.planoId, planoNecessario: 'essencial',
      };
    }
    return { permitido: true, plano };
  }

  if (recurso === 'membros') {
    // Recurso liga/desliga primeiro (mensagem melhor que "limite atingido"
    // quando o plano nem oferece equipe) e só depois checa quantidade.
    if (plano.recursos.equipe !== true) return { ...bloqueado('equipe', plano.planoId), plano };
    const { total } = await db
      .prepare(`SELECT COUNT(*) AS total FROM membros WHERE empresa_id = ?`)
      .bind(empresaId)
      .first();
    if (total >= plano.limiteMembros) {
      return {
        permitido: false, status: 403,
        error: `Você atingiu o limite de ${plano.limiteMembros} pessoas do plano ${NOME_PLANO[plano.planoId] || plano.planoId}. Faça upgrade para adicionar mais gente na equipe.`,
        recurso: 'membros', planoAtual: plano.planoId, planoNecessario: 'pro',
      };
    }
    return { permitido: true, plano };
  }

  if (recurso === 'papel_diferenciado') {
    // Definir vendedor/estoquista (em vez de todo mundo ser "dono") exige
    // o plano com permissoes_papeis.
    if (plano.recursos.permissoes_papeis !== true) return { ...bloqueado('permissoes_papeis', plano.planoId), plano };
    return { permitido: true, plano };
  }

  // Qualquer outro recurso é uma feature simples liga/desliga.
  if (plano.recursos[recurso] !== true) return { ...bloqueado(recurso, plano.planoId), plano };
  return { permitido: true, plano };
}

// O que cada papel pode fazer em cada store.
// 'leitura' = só GET. 'total' = GET/POST/PUT/DELETE. ausente = sem acesso nenhum.
const PERMISSOES = {
  dono:       { produtos: 'total',  vendas: 'total',  movimentos: 'total' },
  vendedor:   { produtos: 'leitura', vendas: 'total',  movimentos: null },
  estoquista: { produtos: 'total',  vendas: null,      movimentos: 'total' },
};

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Descobre a qual empresa e com qual papel esse e-mail pertence. */
async function resolverMembro(db, email) {
  const linha = await db
    .prepare(`
      SELECT m.empresa_id AS empresaId, m.papel AS papel, e.nome AS nomeEmpresa, e.plano AS plano,
             e.dono_email AS donoEmail,
             (SELECT u.nome FROM usuarios u WHERE u.email = e.dono_email) AS nomeDono
      FROM membros m
      JOIN empresas e ON e.id = m.empresa_id
      WHERE m.usuario_email = ?
      LIMIT 1
    `)
    .bind(email)
    .first();
  return linha || null;
}

/**
 * Busca o status corrente da assinatura da empresa (schema-assinaturas.sql).
 * Roda em toda request autenticada que já tem empresa — uma query simples,
 * indexada por empresa_id.
 */
async function statusAssinatura(db, empresaId) {
  const linha = await db
    .prepare(`
      SELECT status, plano_id AS planoId, data_expiracao AS dataExpiracao
      FROM assinaturas
      WHERE empresa_id = ?
      ORDER BY criado_em DESC
      LIMIT 1
    `)
    .bind(empresaId)
    .first();
  // Nenhuma assinatura encontrada não significa "cancelada" — significa que
  // a empresa ainda não teve uma linha criada (ex.: conta antiga, migração
  // incompleta). O padrão seguro é tratar como o plano FREE, ativo — nunca
  // bloquear ou rotular como cancelado quem nunca assinou nada.
  return linha || { status: 'ACTIVE', planoId: 'free', dataExpiracao: null };
}

/**
 * Decide se o método da requisição pode passar dado o status da assinatura.
 * GET sempre passa (leitura/exportação continuam disponíveis mesmo vencida).
 * Retorna null quando pode seguir, ou um objeto de erro pra devolver 402.
 */
function gateEscritaPorAssinatura(method, status) {
  if (method === 'GET') return null;
  if (ESTADOS_QUE_PERMITEM_ESCRITA.has(status)) return null;
  return { error: MENSAGENS_BLOQUEIO_ASSINATURA[status] || 'Assinatura inativa.', status };
}

/**
 * POST /api/empresas — cadastro self-service. Quem chama ainda não precisa
 * pertencer a nenhuma empresa; é justamente essa a rota que resolve isso.
 * Quem cria vira automaticamente "dono" no plano grátis.
 */
async function criarEmpresa(db, email, request) {
  const jaEhMembro = await db
    .prepare('SELECT empresa_id FROM membros WHERE usuario_email = ?')
    .bind(email)
    .first();
  if (jaEhMembro) {
    return json({ error: 'Esse e-mail já está associado a uma empresa.' }, 409);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const nomeEmpresa = ((corpo && corpo.nomeEmpresa) || '').trim();
  if (!nomeEmpresa) {
    return json({ error: 'Informe o nome da empresa.' }, 400);
  }

  const empresaId = crypto.randomUUID();

  await db
    .prepare(`
      INSERT INTO empresas (id, nome, dono_email, plano, criado_em)
      VALUES (?, ?, ?, 'free', datetime('now'))
    `)
    .bind(empresaId, nomeEmpresa, email)
    .run();

  await db
    .prepare(`
      INSERT INTO membros (empresa_id, usuario_email, papel, criado_em)
      VALUES (?, ?, 'dono', datetime('now'))
    `)
    .bind(empresaId, email)
    .run();

  // Toda empresa nova nasce com uma assinatura FREE ativa (status ACTIVE) —
  // sem isso, verificarPlano() não encontra plano nenhum e bloqueia tudo (402),
  // e a tela de assinatura mostraria "cancelada" pra quem acabou de entrar.
  const usuarioDono = await db.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first();
  await db
    .prepare(`
      INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio)
      VALUES (?, ?, ?, 'free', 'ACTIVE', datetime('now'))
    `)
    .bind('sub-' + empresaId, empresaId, usuarioDono ? usuarioDono.id : null)
    .run();

  await db
    .prepare('UPDATE usuarios SET plano_atual = ?, status_assinatura = ? WHERE email = ?')
    .bind('free', 'ACTIVE', email)
    .run();

  await registrarAtividade(db, {
    empresaId, email, papel: 'dono', acao: 'criou_empresa', store: 'empresa', registroId: empresaId,
    descricao: `Criou a empresa "${nomeEmpresa}"`,
  });

  return json({ email, empresaId, papel: 'dono', nomeEmpresa, plano: 'free' }, 201);
}

function permissaoPara(papel, store) {
  const regras = PERMISSOES[papel];
  if (!regras) return null;
  return regras[store] || null;
}

/** Quantos "donos" a empresa tem — usado pra nunca deixar zero. */
async function contarDonos(db, empresaId) {
  const linha = await db
    .prepare(`SELECT COUNT(*) AS total FROM membros WHERE empresa_id = ? AND papel = 'dono'`)
    .bind(empresaId)
    .first();
  return linha ? linha.total : 0;
}

/**
 * Trata todas as rotas /api/membros. Só quem é "dono" da própria empresa
 * pode gerenciar a equipe — todo o resto recebe 403.
 */
async function tratarRotaMembros(db, emailLogado, membro, emailAlvo, request) {
  if (membro.papel !== 'dono') {
    return json({ error: 'Só o dono da empresa pode gerenciar a equipe.' }, 403);
  }

  const empresaId = membro.empresaId;

  // GET /api/membros — lista os membros da empresa.
  if (request.method === 'GET' && !emailAlvo) {
    const { results } = await db
      .prepare(`
        SELECT usuario_email AS email, papel, criado_em AS criadoEm
        FROM membros
        WHERE empresa_id = ?
        ORDER BY criado_em ASC
      `)
      .bind(empresaId)
      .all();
    return json(results);
  }

  // POST /api/membros — adiciona um novo membro.
  if (request.method === 'POST' && !emailAlvo) {
    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json({ error: 'Corpo da requisição inválido.' }, 400);
    }

    const email = ((corpo && corpo.email) || '').trim().toLowerCase();
    const papel = corpo && corpo.papel;

    if (!email || !email.includes('@')) {
      return json({ error: 'Informe um e-mail válido.' }, 400);
    }
    if (!PAPEIS_VALIDOS.includes(papel)) {
      return json({ error: `Papel inválido. Use um destes: ${PAPEIS_VALIDOS.join(', ')}.` }, 400);
    }

    // Por enquanto, um e-mail só pode pertencer a uma empresa.
    const existente = await db
      .prepare('SELECT empresa_id AS empresaId FROM membros WHERE usuario_email = ?')
      .bind(email)
      .first();

    if (existente) {
      const mensagem = existente.empresaId === empresaId
        ? 'Esse e-mail já faz parte da sua equipe.'
        : 'Esse e-mail já pertence a outra empresa. Por enquanto, cada e-mail só pode estar em uma empresa.';
      return json({ error: mensagem }, 409);
    }

    // Recurso central de permissões: precisa do plano com "equipe" e ter
    // vaga dentro do limite (verificarPlano já faz as duas checagens).
    const checagemEquipe = await verificarPlano(db, empresaId, 'membros');
    if (!checagemEquipe.permitido) {
      return json({
        error: checagemEquipe.error,
        recurso: checagemEquipe.recurso,
        planoAtual: checagemEquipe.planoAtual,
        planoNecessario: checagemEquipe.planoNecessario,
      }, checagemEquipe.status);
    }

    // Convidar alguém com papel diferente de "dono" (vendedor/estoquista com
    // acesso limitado) exige o plano com papéis e permissões por pessoa.
    if (papel !== 'dono') {
      const checagemPapel = await verificarPlano(db, empresaId, 'papel_diferenciado');
      if (!checagemPapel.permitido) {
        return json({
          error: checagemPapel.error,
          recurso: checagemPapel.recurso,
          planoAtual: checagemPapel.planoAtual,
          planoNecessario: checagemPapel.planoNecessario,
        }, checagemPapel.status);
      }
    }

    await db
      .prepare(`
        INSERT INTO membros (empresa_id, usuario_email, papel, criado_em)
        VALUES (?, ?, ?, datetime('now'))
      `)
      .bind(empresaId, email, papel)
      .run();

    await registrarAtividade(db, {
      empresaId, email: emailLogado, papel: membro.papel, acao: 'adicionou_membro', store: 'membros', registroId: email,
      descricao: `Adicionou ${email} à equipe como ${ROTULOS_PAPEL[papel] || papel}`,
    });

    return json({ email, papel }, 201);
  }

  // PUT /api/membros/:email — edita o papel de um membro já existente.
  if (request.method === 'PUT' && emailAlvo) {
    const emailDecodificado = decodeURIComponent(emailAlvo).trim().toLowerCase();

    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return json({ error: 'Corpo da requisição inválido.' }, 400);
    }

    const papel = corpo && corpo.papel;
    if (!PAPEIS_VALIDOS.includes(papel)) {
      return json({ error: `Papel inválido. Use um destes: ${PAPEIS_VALIDOS.join(', ')}.` }, 400);
    }

    const alvo = await db
      .prepare('SELECT papel FROM membros WHERE empresa_id = ? AND usuario_email = ?')
      .bind(empresaId, emailDecodificado)
      .first();

    if (!alvo) {
      return json({ error: 'Esse e-mail não é membro da sua empresa.' }, 404);
    }

    // Nunca deixar a empresa sem nenhum dono ao rebaixar o único dono.
    if (alvo.papel === 'dono' && papel !== 'dono') {
      const totalDonos = await contarDonos(db, empresaId);
      if (totalDonos <= 1) {
        return json({ error: 'Não é possível rebaixar o único dono da empresa.' }, 400);
      }
    }

    // Promover alguém pra um papel diferente de "dono" (vendedor/estoquista
    // com permissões limitadas) exige o mesmo plano que adicionar exige.
    if (papel !== 'dono') {
      const checagemPapel = await verificarPlano(db, empresaId, 'papel_diferenciado');
      if (!checagemPapel.permitido) {
        return json({
          error: checagemPapel.error,
          recurso: checagemPapel.recurso,
          planoAtual: checagemPapel.planoAtual,
          planoNecessario: checagemPapel.planoNecessario,
        }, checagemPapel.status);
      }
    }

    if (alvo.papel === papel) {
      return json({ email: emailDecodificado, papel });
    }

    await db
      .prepare('UPDATE membros SET papel = ? WHERE empresa_id = ? AND usuario_email = ?')
      .bind(papel, empresaId, emailDecodificado)
      .run();

    await registrarAtividade(db, {
      empresaId, email: emailLogado, papel: membro.papel, acao: 'editou_membro', store: 'membros', registroId: emailDecodificado,
      descricao: `Alterou o papel de ${emailDecodificado} de ${ROTULOS_PAPEL[alvo.papel] || alvo.papel} para ${ROTULOS_PAPEL[papel] || papel}`,
    });

    return json({ email: emailDecodificado, papel });
  }

  // DELETE /api/membros/:email — remove um membro.
  if (request.method === 'DELETE' && emailAlvo) {
    const emailDecodificado = decodeURIComponent(emailAlvo).trim().toLowerCase();

    if (emailDecodificado === emailLogado.trim().toLowerCase()) {
      return json({ error: 'Você não pode remover a si mesmo da equipe. Peça para outro dono fazer isso.' }, 400);
    }

    const alvo = await db
      .prepare('SELECT papel FROM membros WHERE empresa_id = ? AND usuario_email = ?')
      .bind(empresaId, emailDecodificado)
      .first();

    if (!alvo) {
      return json({ error: 'Esse e-mail não é membro da sua empresa.' }, 404);
    }

    // Nunca deixar a empresa sem nenhum dono.
    if (alvo.papel === 'dono') {
      const totalDonos = await contarDonos(db, empresaId);
      if (totalDonos <= 1) {
        return json({ error: 'Não é possível remover o único dono da empresa.' }, 400);
      }
    }

    await db
      .prepare('DELETE FROM membros WHERE empresa_id = ? AND usuario_email = ?')
      .bind(empresaId, emailDecodificado)
      .run();

    await registrarAtividade(db, {
      empresaId, email: emailLogado, papel: membro.papel, acao: 'removeu_membro', store: 'membros', registroId: emailDecodificado,
      descricao: `Removeu ${emailDecodificado} da equipe`,
    });

    return json({ ok: true });
  }

  return json({ error: 'Rota ou método não suportado para /api/membros.' }, 405);
}

async function sha256Hex(texto) {
  const dados = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Lê o cookie "session" (token cru) e descobre o e-mail do usuário, validando o hash contra a tabela sessoes. */
async function resolverEmailDaSessao(db, request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]);
  const linha = await db
    .prepare(`
      SELECT u.email AS email, s.expires_at AS expiresAt
      FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ?
    `)
    .bind(tokenHash)
    .first();

  if (!linha) return null;
  if (new Date(linha.expiresAt) < new Date()) return null; // sessão expirada

  return linha.email;
}

// -------------------------------------------------------------------------
// Histórico de atividades — grava quem fez cada ação relevante na empresa
// (criar/editar/excluir registros, mexer na equipe, mudar de plano). Serve
// exclusivamente pra leitura/auditoria: nunca decide permissão, e uma falha
// aqui nunca pode derrubar a operação principal que a originou.
// -------------------------------------------------------------------------

/**
 * Insere uma linha em `atividades`. Chamada em "fire and forget" lógico: o
 * INSERT é aguardado (pra garantir ordem no histórico), mas qualquer erro é
 * engolido — o pior cenário aceitável é faltar uma linha no histórico, nunca
 * quebrar a ação de verdade (criar produto, registrar venda etc.).
 */
async function registrarAtividade(db, { empresaId, email, papel, acao, store = null, registroId = null, descricao }) {
  try {
    await db
      .prepare(`
        INSERT INTO atividades (id, empresa_id, usuario_email, papel, acao, store, registro_id, descricao, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(`atv-${crypto.randomUUID()}`, empresaId, email, papel || null, acao, store, registroId, descricao)
      .run();
  } catch (erro) {
    // Intencional: ver comentário acima. Histórico é auxiliar, não crítico.
  }
}

const ORIGENS_IMPORTACAO_VALIDAS = ['xlsx', 'csv', 'xml_nfe'];

/**
 * GET  /api/importacoes            -> histórico de importações da empresa (mais recentes primeiro)
 * POST /api/importacoes            -> registra o resultado de uma execução do wizard (o processamento
 *                                      do arquivo em si acontece no navegador; o servidor só grava o
 *                                      resumo, os produtos já chegam via POST/PUT normal em /api/produtos)
 * A escrita (POST) já vem bloqueada mais acima por gateEscritaPorAssinatura quando a assinatura não
 * permite mais escrita — igual qualquer outro cadastro.
 */
async function tratarRotaImportacoes(db, membro, email, request, url, permissaoProdutos) {
  const empresaId = membro.empresaId;

  if (request.method === 'GET') {
    const limiteBruto = parseInt(url.searchParams.get('limite'), 10);
    const limite = Number.isFinite(limiteBruto) ? Math.min(Math.max(limiteBruto, 1), 100) : 20;
    const { results } = await db
      .prepare(`
        SELECT id, usuario_email AS usuarioEmail, origem, nome_arquivo AS nomeArquivo,
               total_registros AS totalRegistros, criados, atualizados, ignorados,
               com_erro AS comErro, status, criado_em AS criadoEm
        FROM historico_importacoes
        WHERE empresa_id = ?
        ORDER BY criado_em DESC
        LIMIT ${limite}
      `)
      .bind(empresaId)
      .all();
    return json(results);
  }

  if (request.method === 'POST') {
    if (permissaoProdutos !== 'total') {
      return json({ error: `Seu papel (${membro.papel}) só tem acesso de leitura a produtos, não pode importar.` }, 403);
    }
    const corpo = await request.json();
    const origem = ORIGENS_IMPORTACAO_VALIDAS.includes(corpo && corpo.origem) ? corpo.origem : null;
    if (!origem) {
      return json({ error: 'Informe uma origem válida (xlsx, csv ou xml_nfe).' }, 400);
    }
    const nomeArquivo = ((corpo && corpo.nomeArquivo) || '').trim() || 'arquivo';
    const totalRegistros = Number(corpo && corpo.totalRegistros) || 0;
    const criados = Number(corpo && corpo.criados) || 0;
    const atualizados = Number(corpo && corpo.atualizados) || 0;
    const ignorados = Number(corpo && corpo.ignorados) || 0;
    const comErro = Number(corpo && corpo.comErro) || 0;
    const status = comErro > 0 ? 'concluida_com_erros' : 'concluida';
    const id = `imp-${crypto.randomUUID()}`;
    const detalhesErros = (corpo && Array.isArray(corpo.erros) && corpo.erros.length)
      ? JSON.stringify(corpo.erros).slice(0, 200000) // limite defensivo de tamanho da coluna
      : null;

    await db
      .prepare(`
        INSERT INTO historico_importacoes
          (id, empresa_id, usuario_email, origem, nome_arquivo, total_registros, criados, atualizados, ignorados, com_erro, status, detalhes_erros, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(id, empresaId, email, origem, nomeArquivo, totalRegistros, criados, atualizados, ignorados, comErro, status, detalhesErros)
      .run();

    await registrarAtividade(db, {
      empresaId, email, papel: membro.papel, acao: 'importou_produtos', store: 'produtos', registroId: id,
      descricao: `Importou produtos de ${nomeArquivo} (${criados} criados, ${atualizados} atualizados, ${ignorados} ignorados, ${comErro} com erro)`,
    });

    return json({ id, status }, 201);
  }

  return json({ error: 'Método não suportado em /api/importacoes.' }, 405);
}

/**
 * GET  /api/mapeamentos-importacao?origem=xlsx  -> mapeamento salvo (ou null se nunca salvou)
 * POST /api/mapeamentos-importacao              -> salva/substitui o mapeamento de colunas da empresa
 *                                                   para aquela origem, pra próxima importação já vir preenchida.
 */
async function tratarRotaMapeamentosImportacao(db, membro, request, url) {
  const empresaId = membro.empresaId;

  if (request.method === 'GET') {
    const origem = url.searchParams.get('origem');
    if (!ORIGENS_IMPORTACAO_VALIDAS.includes(origem)) {
      return json({ error: 'Informe uma origem válida (xlsx ou csv).' }, 400);
    }
    const linha = await db
      .prepare('SELECT mapeamento FROM mapeamentos_importacao WHERE empresa_id = ? AND origem = ?')
      .bind(empresaId, origem)
      .first();
    if (!linha) return json(null);
    try {
      return json(JSON.parse(linha.mapeamento));
    } catch (e) {
      return json(null);
    }
  }

  if (request.method === 'POST') {
    const corpo = await request.json();
    const origem = corpo && corpo.origem;
    if (!ORIGENS_IMPORTACAO_VALIDAS.includes(origem)) {
      return json({ error: 'Informe uma origem válida (xlsx ou csv).' }, 400);
    }
    if (!corpo.mapeamento || typeof corpo.mapeamento !== 'object') {
      return json({ error: 'Informe o mapeamento de colunas.' }, 400);
    }
    await db
      .prepare(`
        INSERT INTO mapeamentos_importacao (empresa_id, origem, mapeamento, atualizado_em)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(empresa_id, origem)
        DO UPDATE SET mapeamento = excluded.mapeamento, atualizado_em = datetime('now')
      `)
      .bind(empresaId, origem, JSON.stringify(corpo.mapeamento))
      .run();
    return json({ ok: true });
  }

  return json({ error: 'Método não suportado em /api/mapeamentos-importacao.' }, 405);
}

const ROTULO_STORE_LOG = { produtos: 'produto', vendas: 'venda', movimentos: 'movimento' };

/** Monta uma descrição legível (pt-BR) pra uma ação sobre um registro de store. */
function descreverAcaoRegistro(store, dados, acao) {
  const rotulo = ROTULO_STORE_LOG[store] || store;
  let detalhe = '';

  if (store === 'produtos' && dados && dados.nome) {
    detalhe = `"${dados.nome}"`;
  } else if (store === 'vendas' && dados) {
    const valor = dados.total != null ? `R$ ${Number(dados.total).toFixed(2)}` : '';
    detalhe = dados.cliente ? `para ${dados.cliente}${valor ? ` (${valor})` : ''}` : valor;
  } else if (store === 'movimentos' && dados && dados.nomeProduto) {
    detalhe = `de "${dados.nomeProduto}"`;
  }

  // Cancelar venda é um PUT por baixo dos panos, mas merece um verbo próprio
  // no histórico em vez do genérico "editou".
  if (store === 'vendas' && acao === 'atualizou' && dados && dados.status === 'cancelada') {
    return `Cancelou venda${detalhe ? ' ' + detalhe : ''}`.trim();
  }

  const verbos = { criou: 'Cadastrou', atualizou: 'Editou', excluiu: 'Excluiu' };
  const verbo = verbos[acao] || acao;
  return `${verbo} ${rotulo}${detalhe ? ' ' + detalhe : ''}`.trim();
}

export async function onRequest(context) {
  const { request, env } = context;

  const db = env.DB;
  if (!db) {
    return json({ error: 'Binding D1 "DB" não configurado neste projeto Pages.' }, 500);
  }

  const email = await resolverEmailDaSessao(db, request);
  if (!email) {
    return json({ error: 'Não autenticado. Faça login novamente.' }, 401);
  }

  const url = new URL(request.url);
  const partes = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const primeiro = partes[0];

  // POST /api/empresas — cadastro self-service. Único caso em que a pessoa
  // ainda NÃO precisa pertencer a nenhuma empresa pra poder chamar a rota.
  if (primeiro === 'empresas' && request.method === 'POST') {
    try {
      return await criarEmpresa(db, email, request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao criar a empresa.' }, 500);
    }
  }

  const membro = await resolverMembro(db, email);

  // GET /api/me — a UI usa isso pra saber o que mostrar/esconder pra essa
  // pessoa. Funciona mesmo sem empresa: é assim que o front descobre que
  // precisa mostrar a tela de "criar sua empresa".
  if (primeiro === 'me' && request.method === 'GET') {
    if (!membro) {
      return json({ email, empresaId: null, papel: null, nomeEmpresa: null, nomeDono: null, plano: null });
    }
    return json({
      email,
      empresaId: membro.empresaId,
      papel: membro.papel,
      nomeEmpresa: membro.nomeEmpresa,
      nomeDono: membro.nomeDono,
      plano: membro.plano
    });
  }

  if (!membro) {
    return json({ error: 'Este e-mail ainda não foi associado a nenhuma empresa. Peça para o dono te convidar.' }, 403);
  }

  // Status de billing da empresa — calculado uma vez por request e reusado
  // tanto pelo gate de escrita quanto pela rota /api/assinatura.
  const assinatura = await statusAssinatura(db, membro.empresaId);

  // GET /api/assinatura — a UI usa isso pra montar a tela "Minha assinatura"
  // (plano, preço, status, próxima cobrança) e pra decidir quais botões
  // mostrar/esconder ou desabilitar com mensagem amigável em outras telas.
  if (primeiro === 'assinatura' && request.method === 'GET') {
    const plano = await carregarPlanoDaEmpresa(db, membro.empresaId);
    return json({
      status: assinatura.status,
      planoId: plano ? plano.planoId : assinatura.planoId,
      planoNome: plano ? plano.planoNome : null,
      precoCentavos: plano ? plano.precoCentavos : null,
      ciclo: plano ? plano.ciclo : null,
      dataExpiracao: plano ? plano.dataExpiracao : assinatura.dataExpiracao,
      canceladoEm: plano ? plano.canceladoEm : null,
      podeEscrever: ESTADOS_QUE_PERMITEM_ESCRITA.has(assinatura.status),
      limiteProdutos: plano ? plano.limiteProdutos : null,
      limiteMembros: plano ? plano.limiteMembros : null,
      recursos: plano ? plano.recursos : {},
    });
  }

  // POST /api/assinatura — trocar de plano (upgrade/downgrade) ou cancelar.
  // Fica de propósito ANTES do gate de escrita: reativar/trocar de plano é
  // exatamente a ação que uma empresa CANCELED/EXPIRED precisa poder fazer.
  // Só o dono mexe em billing da empresa.
  if (primeiro === 'assinatura' && request.method === 'POST') {
    if (membro.papel !== 'dono') {
      return json({ error: 'Só o dono da empresa pode alterar a assinatura.' }, 403);
    }

    let corpo;
    try { corpo = await request.json(); } catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400); }

    const acao = corpo && corpo.acao;
    const empresaId = membro.empresaId;

    if (acao === 'cancelar') {
      // O plano FREE não tem cobrança, então não existe "cancelar" — isso
      // evita que a assinatura de um usuário free vire CANCELED por engano
      // (seja por um clique indevido, seja por uma chamada direta à API).
      if (assinatura.planoId === 'free') {
        return json({ error: 'O plano gratuito não pode ser cancelado — não há cobrança para interromper.' }, 400);
      }

      await db
        .prepare(`
          UPDATE assinaturas
          SET status = 'CANCELED', cancelado_em = datetime('now'),
              motivo_cancelamento = ?, atualizado_em = datetime('now')
          WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
        `)
        .bind((corpo && corpo.motivo) || null, empresaId)
        .run();

      await db.prepare('UPDATE usuarios SET status_assinatura = ? WHERE email = ?').bind('CANCELED', email).run();

      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'cancelou_assinatura', store: 'assinatura', registroId: empresaId,
        descricao: `Cancelou a assinatura do plano ${NOME_PLANO[assinatura.planoId] || assinatura.planoId}`,
      });

      return json({ ok: true, status: 'CANCELED' });
    }

    if (acao === 'mudar_plano') {
      const planoId = corpo && corpo.planoId;
      const planoValido = await db.prepare('SELECT id FROM planos WHERE id = ? AND ativo = 1').bind(planoId).first();
      if (!planoValido) {
        return json({ error: `Plano "${planoId}" inválido.` }, 400);
      }

      const usuarioDono = await db.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first();
      // Toda assinatura (free ou paga) nasce com status ACTIVE — 'FREE'
      // nunca foi um status de ciclo de vida válido, era o plano_id.
      const novoStatus = 'ACTIVE';

      // Mensal, então "próxima cobrança" é ~30 dias a partir de agora.
      // (Isso é um cálculo local, sem gateway real integrado ainda — no dia
      // que plugar Stripe/Pagar.me, essa data passa a vir do webhook deles.)
      let dataExpiracao = null;
      if (planoId !== 'free') {
        const data = new Date();
        data.setDate(data.getDate() + 30);
        dataExpiracao = data.toISOString();
      }

      // Fecha o período corrente antes de abrir um novo — mantém o
      // histórico completo em vez de sobrescrever a linha existente.
      await db
        .prepare(`
          UPDATE assinaturas
          SET status = 'CANCELED', cancelado_em = datetime('now'),
              motivo_cancelamento = 'Troca de plano', atualizado_em = datetime('now')
          WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
        `)
        .bind(empresaId)
        .run();

      await db
        .prepare(`
          INSERT INTO assinaturas (id, empresa_id, usuario_id, plano_id, status, data_inicio, data_expiracao)
          VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
        `)
        .bind(`sub-${empresaId}-${Date.now()}`, empresaId, usuarioDono ? usuarioDono.id : null, planoId, novoStatus, dataExpiracao)
        .run();

      await db
        .prepare('UPDATE usuarios SET plano_atual = ?, status_assinatura = ?, data_inicio_assinatura = datetime(\'now\'), data_expiracao = ? WHERE email = ?')
        .bind(planoId, novoStatus, dataExpiracao, email)
        .run();

      // Mantém a coluna legada em sincronia, pra quem ainda lê empresas.plano.
      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();

      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'mudou_plano', store: 'assinatura', registroId: empresaId,
        descricao: `Alterou o plano para ${NOME_PLANO[planoId] || planoId}`,
      });

      return json({ ok: true, planoId, status: novoStatus, dataExpiracao });
    }

    return json({ error: 'Ação inválida. Use "mudar_plano" ou "cancelar".' }, 400);
  }

  // Bloqueia escrita (POST/PUT/DELETE) em QUALQUER rota abaixo — membros e
  // stores — se a assinatura da empresa não estiver num estado que permite.
  // Isolamento por empresa_id já garante que uma conta nunca vê dado de
  // outra; isto garante que uma conta inadimplente não continua operando
  // além do que o plano permite na própria conta.
  const bloqueioAssinatura = gateEscritaPorAssinatura(request.method, assinatura.status);
  if (bloqueioAssinatura) {
    return json(bloqueioAssinatura, 402); // 402 Payment Required
  }

  // /api/membros e /api/membros/:email — gestão de equipe (só dono).
  if (primeiro === 'membros') {
    try {
      return await tratarRotaMembros(db, email, membro, partes[1], request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao gerenciar a equipe.' }, 500);
    }
  }

  // /api/importacoes e /api/mapeamentos-importacao — módulo de Importação
  // de Produtos. Mesma regra de acesso do cadastro de produtos (store
  // "produtos"): dono e estoquista podem importar, vendedor não tem acesso
  // nenhum (nem leitura do histórico). Reaproveita PERMISSOES já existente
  // em vez de criar uma tabela de permissões nova.
  if (primeiro === 'importacoes' || primeiro === 'mapeamentos-importacao') {
    const permissaoProdutos = permissaoPara(membro.papel, 'produtos');
    if (!permissaoProdutos) {
      return json({ error: `Seu papel (${membro.papel}) não tem acesso à importação de produtos.` }, 403);
    }
    try {
      if (primeiro === 'mapeamentos-importacao') {
        return await tratarRotaMapeamentosImportacao(db, membro, request, url);
      }
      return await tratarRotaImportacoes(db, membro, email, request, url, permissaoProdutos);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno na importação de produtos.' }, 500);
    }
  }

  // GET /api/atividades — histórico completo de quem fez cada ação na
  // empresa (criar/editar/excluir produtos, vendas e movimentos; mexer na
  // equipe; mudar de plano). Só o dono vê — é ele quem precisa auditar o
  // que a equipe fez. Recurso exclusivo do plano Pro (verificarPlano cuida
  // da mensagem de upgrade).
  if (primeiro === 'atividades' && request.method === 'GET') {
    if (membro.papel !== 'dono') {
      return json({ error: 'Só o dono da empresa pode ver o histórico de atividades.' }, 403);
    }
    const checagemAtividades = await verificarPlano(db, membro.empresaId, 'auditoria');
    if (!checagemAtividades.permitido) {
      return json({
        error: checagemAtividades.error,
        recurso: 'auditoria',
        planoAtual: checagemAtividades.planoAtual,
        planoNecessario: checagemAtividades.planoNecessario,
      }, checagemAtividades.status);
    }

    // Filtro opcional por área (?store=produtos|vendas|movimentos|membros|assinatura|empresa)
    // e limite opcional (?limite=1..200, padrão 100) — sempre dentro da própria empresa.
    const storeFiltro = url.searchParams.get('store');
    const storesFiltraveis = STORES_VALIDOS.concat(['membros', 'assinatura', 'empresa']);
    const limiteBruto = parseInt(url.searchParams.get('limite'), 10);
    const limite = Number.isFinite(limiteBruto) ? Math.min(Math.max(limiteBruto, 1), 200) : 100;

    const condicoes = ['empresa_id = ?'];
    const binds = [membro.empresaId];
    if (storeFiltro && storesFiltraveis.includes(storeFiltro)) {
      condicoes.push('store = ?');
      binds.push(storeFiltro);
    }

    const { results } = await db
      .prepare(`
        SELECT id, usuario_email AS usuarioEmail, papel, acao, store, registro_id AS registroId,
               descricao, criado_em AS criadoEm
        FROM atividades
        WHERE ${condicoes.join(' AND ')}
        ORDER BY criado_em DESC
        LIMIT ${limite}
      `)
      .bind(...binds)
      .all();
    return json(results);
  }

  const store = primeiro;
  const id = partes[1];

  if (!STORES_VALIDOS.includes(store)) {
    return json({ error: `Store "${store}" inválido.` }, 404);
  }

  const permissao = permissaoPara(membro.papel, store);
  if (!permissao) {
    return json({ error: `Seu papel (${membro.papel}) não tem acesso a "${store}".` }, 403);
  }
  const metodoEscrita = ['POST', 'PUT', 'DELETE'].includes(request.method);
  if (metodoEscrita && permissao !== 'total') {
    return json({ error: `Seu papel (${membro.papel}) só tem acesso de leitura a "${store}".` }, 403);
  }

  const empresaId = membro.empresaId;

  try {
    if (request.method === 'GET' && !id) {
      const { results } = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ?')
        .bind(empresaId, store)
        .all();
      return json(results.map(r => JSON.parse(r.dados)));
    }

    if (request.method === 'GET' && id) {
      const row = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
        .bind(empresaId, store, id)
        .first();
      return json(row ? JSON.parse(row.dados) : null);
    }

    if (request.method === 'POST' && !id) {
      const registro = await request.json();
      if (!registro || !registro.id) {
        return json({ error: 'Registro precisa ter um campo "id".' }, 400);
      }

      // Limite de produtos do plano (Free = 50). Vendas e movimentos não têm
      // limite de quantidade em nenhum plano — só produtos.
      if (store === 'produtos') {
        const checagemProdutos = await verificarPlano(db, empresaId, 'produtos');
        if (!checagemProdutos.permitido) {
          return json({
            error: checagemProdutos.error,
            recurso: 'produtos',
            planoAtual: checagemProdutos.planoAtual,
            planoNecessario: checagemProdutos.planoNecessario,
          }, checagemProdutos.status);
        }
      }

      // Carimba quem criou — vem do servidor (e-mail autenticado), nunca do
      // que o cliente mandar, pra não dar pra forjar quem fez a ação.
      registro.criado_por = email;
      registro.criado_em = new Date().toISOString();

      await db
        .prepare('INSERT INTO registros (id, empresa_id, usuario_email, store, dados, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime("now"))')
        .bind(registro.id, empresaId, email, store, JSON.stringify(registro))
        .run();

      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'criou', store, registroId: registro.id,
        descricao: descreverAcaoRegistro(store, registro, 'criou'),
      });

      return json(registro, 201);
    }

    if (request.method === 'PUT' && id) {
      const registro = await request.json();
      registro.atualizado_por = email;
      registro.atualizado_em = new Date().toISOString();

      // O PUT usa UPSERT — se o ID não existe ainda, seria uma criação disfarçada.
      // Aplicamos o mesmo check de limite do POST para fechar esse bypass.
      if (store === 'produtos') {
        const existe = await db
          .prepare('SELECT id FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
          .bind(empresaId, store, id)
          .first();
        if (!existe) {
          const checagem = await verificarPlano(db, empresaId, 'produtos');
          if (!checagem.permitido) {
            return json({
              error: checagem.error,
              recurso: 'produtos',
              planoAtual: checagem.planoAtual,
              planoNecessario: checagem.planoNecessario,
            }, checagem.status);
          }
        }
      }

      await db
        .prepare(`
          INSERT INTO registros (id, empresa_id, usuario_email, store, dados, atualizado_em)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id, empresa_id, store)
          DO UPDATE SET dados = excluded.dados, atualizado_em = datetime('now'), usuario_email = excluded.usuario_email
        `)
        .bind(id, empresaId, email, store, JSON.stringify(registro))
        .run();

      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'atualizou', store, registroId: id,
        descricao: descreverAcaoRegistro(store, registro, 'atualizou'),
      });

      return json(registro);
    }

    if (request.method === 'DELETE' && id) {
      // Busca os dados antes de apagar só pra montar uma descrição legível
      // no histórico (ex.: "Excluiu produto \"Coca-Cola\"") — a exclusão em
      // si não muda em nada.
      const linhaExistente = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
        .bind(empresaId, store, id)
        .first();

      await db
        .prepare('DELETE FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
        .bind(empresaId, store, id)
        .run();

      let dadosExcluidos = null;
      if (linhaExistente) {
        try { dadosExcluidos = JSON.parse(linhaExistente.dados); } catch (e) { dadosExcluidos = null; }
      }
      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'excluiu', store, registroId: id,
        descricao: descreverAcaoRegistro(store, dadosExcluidos, 'excluiu'),
      });

      return json({ ok: true });
    }

    return json({ error: 'Rota ou método não suportado.' }, 405);
  } catch (erro) {
    return json({ error: erro.message || 'Erro interno ao acessar o banco.' }, 500);
  }
}