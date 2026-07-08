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

// --- Validação de campos que acabam renderizados como atributo HTML no
// front-end (produto.id, venda.id, produto.imagem). Sem isso, o servidor
// aceitava qualquer string do cliente nesses campos, abrindo espaço para
// XSS armazenado quando esse valor era inserido sem escape em atributos
// como onclick/src. Restringe apenas o formato — não muda nenhum fluxo,
// pois o `id` gerado pelo front-end (DB.gerarId() em js/db.js) e a
// `imagem` gerada pela câmera/galeria (comprimirImagem() em js/app.js,
// sempre "data:image/jpeg;base64,...") já respeitam essas regras.
const ID_REGISTRO_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGEM_DATA_URI_REGEX = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]{1,2000000}$/;

function idDeRegistroValido(id) {
  return typeof id === 'string' && ID_REGISTRO_REGEX.test(id);
}

function imagemValida(imagem) {
  if (imagem === null || imagem === undefined || imagem === '') return true; // campo opcional
  return typeof imagem === 'string' && IMAGEM_DATA_URI_REGEX.test(imagem);
}

// Limites de comprimento para campos de texto livre — evita payloads gigantes
// que consumiriam espaço no D1 e tornaria as listagens lentas.
const LIMITES_TEXTO = {
  nome: 200, categoria: 100, fornecedor: 150, marca: 100,
  codigoBarras: 80, codigo: 80, unidade: 10,
  cliente: 150, vendedor: 150, motivo: 300,
};

function validarTexto(valor, campo) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') return `Campo "${campo}" deve ser texto.`;
  const limite = LIMITES_TEXTO[campo];
  if (limite && valor.length > limite) return `Campo "${campo}" excede ${limite} caracteres.`;
  return null;
}

function validarRegistro(store, registro) {
  if (!registro || !idDeRegistroValido(registro.id)) {
    return 'Campo "id" inválido. Use apenas letras, números, "_" e "-" (máximo 64 caracteres).';
  }
  if (store === 'produtos') {
    if (!registro.nome || typeof registro.nome !== 'string' || !registro.nome.trim()) {
      return 'Campo "nome" é obrigatório.';
    }
    const erroNome = validarTexto(registro.nome, 'nome');
    if (erroNome) return erroNome;
    const erroCategoria = validarTexto(registro.categoria, 'categoria');
    if (erroCategoria) return erroCategoria;
    const erroFornecedor = validarTexto(registro.fornecedor, 'fornecedor');
    if (erroFornecedor) return erroFornecedor;
    const erroMarca = validarTexto(registro.marca, 'marca');
    if (erroMarca) return erroMarca;
    const erroCodBarras = validarTexto(registro.codigoBarras, 'codigoBarras');
    if (erroCodBarras) return erroCodBarras;
    const erroCodigo = validarTexto(registro.codigo, 'codigo');
    if (erroCodigo) return erroCodigo;
    if (typeof registro.preco !== 'number' || registro.preco < 0) {
      return 'Campo "preco" deve ser um número >= 0.';
    }
    if (typeof registro.estoque !== 'number' || registro.estoque < 0) {
      return 'Campo "estoque" deve ser um número >= 0.';
    }
    if (registro.estoqueMinimo !== undefined && registro.estoqueMinimo !== null &&
        (typeof registro.estoqueMinimo !== 'number' || registro.estoqueMinimo < 0)) {
      return 'Campo "estoqueMinimo" deve ser um número >= 0.';
    }
    if (registro.precoCusto !== undefined && registro.precoCusto !== null &&
        (typeof registro.precoCusto !== 'number' || registro.precoCusto < 0)) {
      return 'Campo "precoCusto" deve ser um número >= 0.';
    }
    if (!imagemValida(registro.imagem)) {
      return 'Campo "imagem" inválido.';
    }
  } else if (store === 'vendas') {
    if (typeof registro.total !== 'number' || registro.total < 0) {
      return 'Campo "total" deve ser um número >= 0.';
    }
    if (!Array.isArray(registro.itens)) {
      return 'Campo "itens" deve ser um array.';
    }
    const erroCliente = validarTexto(registro.cliente, 'cliente');
    if (erroCliente) return erroCliente;
    const erroVendedor = validarTexto(registro.vendedor, 'vendedor');
    if (erroVendedor) return erroVendedor;
  } else if (store === 'movimentos') {
    if (!idDeRegistroValido(registro.produtoId)) {
      return 'Campo "produtoId" inválido.';
    }
    if (typeof registro.quantidade !== 'number' || registro.quantidade <= 0) {
      return 'Campo "quantidade" deve ser um número > 0.';
    }
    if (!['entrada', 'saída', 'saida'].includes(registro.tipo)) {
      return 'Campo "tipo" deve ser "entrada", "saída" ou "saida".';
    }
    const erroMotivo = validarTexto(registro.motivo, 'motivo');
    if (erroMotivo) return erroMotivo;
  }
  return null;
}

// Estados possíveis de assinaturas.status (schema-assinaturas.sql).
const ESTADOS_ASSINATURA = ['ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'FREE'];

const ESTADOS_QUE_PERMITEM_ESCRITA = new Set(['ACTIVE', 'TRIAL', 'PAST_DUE', 'FREE']);

const MENSAGENS_BLOQUEIO_ASSINATURA = {
  CANCELED: 'Sua assinatura foi cancelada. Reative um plano para voltar a cadastrar e vender.',
  EXPIRED: 'Sua assinatura expirou. Escolha um plano para continuar usando o sistema.',
};

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

// Cache de plano por empresa — válido por 5 minutos por isolate do Worker.
// Cloudflare Workers reutilizam isolates no mesmo deployment, então este
// cache é efetivo entre requisições consecutivas no mesmo edge node,
// eliminando a query extra de JOIN assinaturas×planos a cada escrita.
const _planoCache = new Map(); // Map<empresaId, { plano: object, exp: number }>
const _PLANO_TTL_MS = 5 * 60 * 1000; // 5 minutos

function invalidarCachePlano(empresaId) {
  _planoCache.delete(empresaId);
}

async function carregarPlanoDaEmpresa(db, empresaId) {
  const agora = Date.now();
  const hit = _planoCache.get(empresaId);
  if (hit && hit.exp > agora) return hit.plano;

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
  const plano = {
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
  _planoCache.set(empresaId, { plano, exp: agora + _PLANO_TTL_MS });
  return plano;
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
    if (plano.recursos.permissoes_papeis !== true) return { ...bloqueado('permissoes_papeis', plano.planoId), plano };
    return { permitido: true, plano };
  }

  if (plano.recursos[recurso] !== true) return { ...bloqueado(recurso, plano.planoId), plano };
  return { permitido: true, plano };
}

// O que cada papel pode fazer em cada store.
// 'leitura' = só GET. 'total' = GET/POST/PUT/DELETE. ausente = sem acesso nenhum.
const PERMISSOES = {
  dono:       { produtos: 'total',  vendas: 'total',  movimentos: 'total' },
  vendedor:   { produtos: 'leitura', vendas: 'total',  movimentos: 'total' },
  estoquista: { produtos: 'total',  vendas: 'leitura',      movimentos: 'total' },
};

/**
 * Detecta se um PUT em /api/produtos vindo de um vendedor é uma baixa de
 * estoque originada por uma venda (e não uma edição manual de produto).
 *
 * O campo `totalSaidas` (número) é enviado apenas por darBaixaEstoque() no
 * frontend. Edições manuais de produto nunca chegam aqui com papel vendedor
 * (o modal de edição não é exibido pra eles).
 *
 * Nota de segurança: esta função só faz a triagem inicial. A proteção real
 * é feita no bloco PUT abaixo: quando o papel é "vendedor", o servidor lê o
 * produto do banco e aplica SOMENTE os campos seguros (estoque, totalSaidas,
 * atualizadoEm), descartando tudo o mais que o cliente tenha enviado.
 * Isso garante que um payload malicioso com campos extras (nome, preco, etc.)
 * seja ignorado pelo servidor, mesmo que passe por esta verificação.
 */
function ehBaixaDeEstoquePorVenda(corpo) {
  return (
    corpo !== null &&
    typeof corpo === 'object' &&
    typeof corpo.totalSaidas === 'number' &&
    typeof corpo.estoque === 'number'
  );
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function resolverMembro(db, email) {
  const linha = await db
    .prepare(`
      SELECT m.empresa_id AS empresaId, m.papel AS papel, e.nome AS nomeEmpresa,
             COALESCE(
               (SELECT plano_id FROM assinaturas
                WHERE empresa_id = e.id AND status IN ('ACTIVE','TRIALING')
                ORDER BY criado_em DESC LIMIT 1),
               e.plano, 'gratis'
             ) AS plano,
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
  return linha || { status: 'ACTIVE', planoId: 'free', dataExpiracao: null };
}

function gateEscritaPorAssinatura(method, status) {
  if (method === 'GET') return null;
  if (ESTADOS_QUE_PERMITEM_ESCRITA.has(status)) return null;
  return { error: MENSAGENS_BLOQUEIO_ASSINATURA[status] || 'Assinatura inativa.', status };
}

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

async function contarDonos(db, empresaId) {
  const linha = await db
    .prepare(`SELECT COUNT(*) AS total FROM membros WHERE empresa_id = ? AND papel = 'dono'`)
    .bind(empresaId)
    .first();
  return linha ? linha.total : 0;
}

async function tratarRotaMembros(db, emailLogado, membro, emailAlvo, request) {
  if (membro.papel !== 'dono') {
    return json({ error: 'Só o dono da empresa pode gerenciar a equipe.' }, 403);
  }

  const empresaId = membro.empresaId;

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

    const checagemEquipe = await verificarPlano(db, empresaId, 'membros');
    if (!checagemEquipe.permitido) {
      return json({
        error: checagemEquipe.error,
        recurso: checagemEquipe.recurso,
        planoAtual: checagemEquipe.planoAtual,
        planoNecessario: checagemEquipe.planoNecessario,
      }, checagemEquipe.status);
    }

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

    if (alvo.papel === 'dono' && papel !== 'dono') {
      const totalDonos = await contarDonos(db, empresaId);
      if (totalDonos <= 1) {
        return json({ error: 'Não é possível rebaixar o único dono da empresa.' }, 400);
      }
    }

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
  if (new Date(linha.expiresAt) < new Date()) return null;

  return linha.email;
}

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
    // Intencional: histórico é auxiliar, não crítico.
  }
}

const ORIGENS_IMPORTACAO_VALIDAS = ['xlsx', 'csv', 'xml_nfe'];

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
    const nomeArquivo = ((corpo && corpo.nomeArquivo) || '').trim().slice(0, 200).replace(/[<>"'&]/g, '_') || 'arquivo';
    const totalRegistros = Number(corpo && corpo.totalRegistros) || 0;
    const criados = Number(corpo && corpo.criados) || 0;
    const atualizados = Number(corpo && corpo.atualizados) || 0;
    const ignorados = Number(corpo && corpo.ignorados) || 0;
    const comErro = Number(corpo && corpo.comErro) || 0;
    const status = comErro > 0 ? 'concluida_com_erros' : 'concluida';
    const id = `imp-${crypto.randomUUID()}`;
    const detalhesErros = (corpo && Array.isArray(corpo.erros) && corpo.erros.length)
      ? JSON.stringify(corpo.erros).slice(0, 200000)
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

  if (primeiro === 'empresas' && request.method === 'POST') {
    try {
      return await criarEmpresa(db, email, request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao criar a empresa.' }, 500);
    }
  }

  const membro = await resolverMembro(db, email);

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

  const assinatura = await statusAssinatura(db, membro.empresaId);

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

  if (primeiro === 'assinatura' && request.method === 'POST') {
    if (membro.papel !== 'dono') {
      return json({ error: 'Só o dono da empresa pode alterar a assinatura.' }, 403);
    }

    let corpo;
    try { corpo = await request.json(); } catch (e) { return json({ error: 'Corpo da requisição inválido.' }, 400); }

    const acao = corpo && corpo.acao;
    const empresaId = membro.empresaId;

    if (acao === 'cancelar') {
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

      invalidarCachePlano(empresaId); // M-06: invalida cache após cancelamento
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
      const novoStatus = 'ACTIVE';

      let dataExpiracao = null;
      if (planoId !== 'free') {
        const data = new Date();
        data.setDate(data.getDate() + 30);
        dataExpiracao = data.toISOString();
      }

      await db
        .prepare(`
          UPDATE assinaturas
          SET status = 'CANCELED', cancelado_em = datetime('now'),
              motivo_cancelamento = 'Troca de plano', atualizado_em = datetime('now')
          WHERE empresa_id = ? AND status IN ('FREE','TRIAL','ACTIVE','PAST_DUE')
        `)
        .bind(empresaId)
        .run();

      invalidarCachePlano(empresaId); // M-06: invalida cache após troca de plano

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

      await db.prepare('UPDATE empresas SET plano = ? WHERE id = ?').bind(planoId, empresaId).run();

      await registrarAtividade(db, {
        empresaId, email, papel: membro.papel, acao: 'mudou_plano', store: 'assinatura', registroId: empresaId,
        descricao: `Alterou o plano para ${NOME_PLANO[planoId] || planoId}`,
      });

      return json({ ok: true, planoId, status: novoStatus, dataExpiracao });
    }

    return json({ error: 'Ação inválida. Use "mudar_plano" ou "cancelar".' }, 400);
  }

  const bloqueioAssinatura = gateEscritaPorAssinatura(request.method, assinatura.status);
  if (bloqueioAssinatura) {
    return json(bloqueioAssinatura, 402);
  }

  if (primeiro === 'membros') {
    try {
      return await tratarRotaMembros(db, email, membro, partes[1], request);
    } catch (erro) {
      return json({ error: erro.message || 'Erro interno ao gerenciar a equipe.' }, 500);
    }
  }

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

  // PATCH /api/produtos/:id/estoque — atualização atômica de estoque (C-03)
  // Substitui o padrão read-modify-write que sofria de race condition.
  // Aceita { delta: number, saidasDelta: number }:
  //   delta negativo = saída (venda)   | delta positivo = entrada (restauração)
  // O UPDATE é atômico no SQLite/D1: sem race condition entre vendedores paralelos.
  if (primeiro === 'produtos' && partes[1] && partes[2] === 'estoque' && request.method === 'PATCH') {
    const produtoId = partes[1];
    let corpo;
    try { corpo = await request.json(); } catch {
      return json({ error: 'Corpo da requisição inválido.' }, 400);
    }
    const { delta, saidasDelta } = corpo;
    if (typeof delta !== 'number' || typeof saidasDelta !== 'number') {
      return json({ error: 'Campos "delta" e "saidasDelta" são obrigatórios (número).' }, 400);
    }
    // Vendedor só pode reduzir estoque (saída de venda)
    if (membro.papel === 'vendedor' && delta > 0) {
      return json({ error: 'Vendedor não pode adicionar estoque diretamente.' }, 403);
    }

    const empresaIdPatch = membro.empresaId;

    // UPDATE atômico: a condição no WHERE garante que saídas só acontecem
    // se houver estoque suficiente — elimina a race condition de overselling.
    const resultado = await db.prepare(`
      UPDATE registros
      SET dados = json_set(dados,
        '$.estoque',     MAX(0, CAST(json_extract(dados, '$.estoque')     AS REAL) + ?),
        '$.totalSaidas', MAX(0, COALESCE(CAST(json_extract(dados, '$.totalSaidas') AS REAL), 0) + ?)
      )
      WHERE empresa_id = ? AND store = 'produtos' AND id = ?
        AND (? >= 0 OR CAST(json_extract(dados, '$.estoque') AS REAL) >= ABS(?))
    `).bind(delta, saidasDelta, empresaIdPatch, produtoId, delta, delta).run();

    if (resultado.meta.changes === 0) {
      // Nenhuma linha atualizada: produto não existe ou estoque insuficiente
      const existe = await db.prepare(
        'SELECT 1 FROM registros WHERE empresa_id = ? AND store = ? AND id = ?'
      ).bind(empresaIdPatch, 'produtos', produtoId).first();
      if (!existe) return json({ error: 'Produto não encontrado.' }, 404);
      return json({ error: 'Estoque insuficiente para esta operação.' }, 409);
    }

    // Retorna o produto atualizado
    const linha = await db.prepare(
      'SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?'
    ).bind(empresaIdPatch, 'produtos', produtoId).first();
    const produtoAtualizado = JSON.parse(linha.dados);

    await registrarAtividade(db, {
      empresaId: empresaIdPatch, email, papel: membro.papel,
      acao: delta < 0 ? 'atualizou' : 'atualizou', store: 'produtos', registroId: produtoId,
      descricao: delta < 0
        ? `Baixou estoque de "${produtoAtualizado.nome || produtoId}" em ${Math.abs(delta)} unidade(s) por venda`
        : `Restaurou estoque de "${produtoAtualizado.nome || produtoId}" em ${delta} unidade(s) por cancelamento`,
    });

    return json(produtoAtualizado);
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

  // --- CORREÇÃO: vendedor pode fazer PUT em produtos APENAS para baixa de
  // estoque por venda (darBaixaEstoque). Qualquer outra escrita em produtos
  // continua bloqueada para o papel vendedor.
  if (metodoEscrita && permissao !== 'total') {
    // Exceção: vendedor fazendo PUT em produtos — verifica se é baixa de estoque
    const ehExcecaoBaixa = (
      membro.papel === 'vendedor' &&
      store === 'produtos' &&
      request.method === 'PUT'
    );

    if (!ehExcecaoBaixa) {
      return json({ error: `Seu papel (${membro.papel}) só tem acesso de leitura a "${store}".` }, 403);
    }

    // É a exceção de baixa — mas ainda precisamos confirmar pelo corpo
    // que é realmente uma baixa de estoque e não uma edição disfarçada.
    // Clonamos o request para poder ler o corpo aqui E depois no PUT abaixo.
    const requestClone = request.clone();
    let corpoVerificacao;
    try {
      corpoVerificacao = await requestClone.json();
    } catch (e) {
      return json({ error: 'Corpo da requisição inválido.' }, 400);
    }

    if (!ehBaixaDeEstoquePorVenda(corpoVerificacao)) {
      return json({ error: `Seu papel (${membro.papel}) só pode atualizar produtos ao registrar uma venda.` }, 403);
    }
    // Verificação passou: deixa seguir para o bloco PUT abaixo.
  }

  const empresaId = membro.empresaId;

  try {
    if (request.method === 'GET' && !id) {
      // M-05: paginação — evita carregar milhares de registros de uma vez.
      // Defaults: limite=200, offset=0. Máximo aceito: 500 por request.
      const limiteBruto = parseInt(url.searchParams.get('limite'), 10);
      const offsetBruto = parseInt(url.searchParams.get('offset'), 10);
      const limite = Number.isFinite(limiteBruto) ? Math.min(Math.max(limiteBruto, 1), 500) : 200;
      const offset = Number.isFinite(offsetBruto) ? Math.max(offsetBruto, 0) : 0;
      const { results } = await db
        .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? LIMIT ? OFFSET ?')
        .bind(empresaId, store, limite, offset)
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
      const erro = validarRegistro(store, registro);
      if (erro) {
        return json({ error: erro }, 400);
      }

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

      // M-07: Idempotência para vendas — protege contra retry de rede onde o
      // cliente não sabe se a requisição anterior chegou ao servidor. Se já
      // existe uma venda com o mesmo id e status != 'cancelada', retorna ela
      // como 200 em vez de criar uma duplicata.
      if (store === 'vendas') {
        const existente = await db
          .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
          .bind(empresaId, 'vendas', registro.id)
          .first();
        if (existente) {
          const vendaExistente = JSON.parse(existente.dados);
          if (vendaExistente.status !== 'cancelada') {
            return json(vendaExistente, 200); // idempotente: retorna a venda já existente
          }
        }
      }

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
      let registro;
      try {
        registro = await request.json();
      } catch (e) {
        return json({ error: 'Corpo da requisição inválido.' }, 400);
      }
      if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
        return json({ error: 'Corpo da requisição deve ser um objeto JSON.' }, 400);
      }

      // SEGURANÇA — vendedor fazendo PUT em produto (baixa de estoque por venda):
      // O servidor lê o produto atual do banco e aplica SOMENTE os três campos
      // que uma baixa de estoque pode alterar (estoque, totalSaidas, atualizadoEm).
      // Todo o resto (nome, preco, categoria, imagem, etc.) vem do banco, não do
      // cliente — assim um payload malicioso com campos extras é simplesmente
      // descartado, independente do que o cliente tenha enviado.
      if (membro.papel === 'vendedor' && store === 'produtos') {
        const linhaAtual = await db
          .prepare('SELECT dados FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
          .bind(empresaId, store, id)
          .first();
        if (!linhaAtual) {
          return json({ error: 'Produto não encontrado.' }, 404);
        }
        let produtoAtual;
        try { produtoAtual = JSON.parse(linhaAtual.dados); } catch {
          return json({ error: 'Erro interno: registro corrompido.' }, 500);
        }

        // I-06: bloqueia venda quando o estoque atual (no banco) é zero.
        // O cliente pode ter lido o estoque antes de outro vendedor dar baixa,
        // por isso a verificação é feita aqui com o valor real do banco.
        const novoEstoque = typeof registro.estoque === 'number' ? registro.estoque : produtoAtual.estoque;
        if (novoEstoque < 0 || (produtoAtual.estoque <= 0 && novoEstoque <= 0)) {
          return json({ error: `Estoque insuficiente para "${produtoAtual.nome || 'produto'}". Estoque atual: ${produtoAtual.estoque}.` }, 409);
        }

        // Aplica somente os campos seguros de uma baixa de estoque
        registro = {
          ...produtoAtual,
          estoque: novoEstoque,
          totalSaidas: typeof registro.totalSaidas === 'number' ? registro.totalSaidas : produtoAtual.totalSaidas,
        };
      }

      // O "id" da URL é sempre a chave de verdade do registro (usada no
      // WHERE/ON CONFLICT abaixo). Forçamos o mesmo valor dentro do JSON
      // salvo em `dados`, em vez de confiar num "id" que o corpo da
      // requisição possa ter enviado divergente — é esse "id" de dentro do
      // JSON que volta pro front-end e é renderizado em atributos HTML.
      registro.id = id;
      registro.atualizado_por = email;
      registro.atualizado_em = new Date().toISOString();

      const erro = validarRegistro(store, registro);
      if (erro) {
        return json({ error: erro }, 400);
      }

      if (store === 'produtos') {
        const existe = await db
          .prepare('SELECT id FROM registros WHERE empresa_id = ? AND store = ? AND id = ?')
          .bind(empresaId, store, id)
          .first();
        if (!existe) {
          // Vendedor nunca pode criar produto novo via UPSERT
          if (membro.papel === 'vendedor') {
            return json({ error: `Seu papel (${membro.papel}) não pode criar produtos.` }, 403);
          }
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