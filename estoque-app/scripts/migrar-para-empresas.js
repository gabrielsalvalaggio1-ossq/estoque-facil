/**
 * migrar-para-empresas.js
 *
 * Roda uma única vez, depois de aplicar schema-empresas.sql.
 *
 * O que faz:
 *  1. Lista todos os e-mails distintos que já têm registros salvos
 *     (usuario_email na tabela `registros`, do jeito que era isolado antes).
 *  2. Para cada e-mail, cria uma "empresa solo" (nome = "Loja de <email>"),
 *     torna esse e-mail o `dono` dela em `membros`, e atualiza todos os
 *     registros antigos daquele e-mail para apontar pra essa empresa_id nova.
 *
 * Depois de rodar isso, todo mundo que já usava o app continua vendo
 * exatamente os mesmos dados de antes — só que agora "dentro" de uma
 * empresa, prontos para você convidar funcionários pra ela se quiser.
 *
 * Como rodar:
 *   node migrar-para-empresas.js NOME_DO_SEU_BANCO
 *
 * Requer o wrangler já autenticado (npx wrangler login) e configurado no projeto.
 */

const { execSync } = require('child_process');

const nomeDoBanco = process.argv[2];
if (!nomeDoBanco) {
  console.error('Uso: node migrar-para-empresas.js NOME_DO_SEU_BANCO');
  process.exit(1);
}

function rodarSql(sql) {
  const comando = `npx wrangler d1 execute ${nomeDoBanco} --remote --json --command "${sql.replace(/"/g, '\\"')}"`;
  const saida = execSync(comando, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  return JSON.parse(saida);
}

function gerarIdEmpresa() {
  return 'empresa-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function main() {
  console.log('Buscando e-mails com dados existentes...');
  const resultado = rodarSql('SELECT DISTINCT usuario_email FROM registros WHERE empresa_id IS NULL');
  const emails = (resultado[0]?.results || []).map(r => r.usuario_email).filter(Boolean);

  if (emails.length === 0) {
    console.log('Nenhum registro pendente de migração. Nada a fazer.');
    return;
  }

  console.log(`Encontrados ${emails.length} usuário(s) para migrar:`, emails);

  for (const email of emails) {
    const empresaId = gerarIdEmpresa();
    const nomeEmpresa = `Loja de ${email}`;

    console.log(`\n-> Migrando ${email} para empresa ${empresaId}`);

    rodarSql(
      `INSERT INTO empresas (id, nome, dono_email) VALUES ('${empresaId}', '${nomeEmpresa.replace(/'/g, "''")}', '${email.replace(/'/g, "''")}')`
    );

    rodarSql(
      `INSERT INTO membros (empresa_id, usuario_email, papel) VALUES ('${empresaId}', '${email.replace(/'/g, "''")}', 'dono')`
    );

    rodarSql(
      `UPDATE registros SET empresa_id = '${empresaId}' WHERE usuario_email = '${email.replace(/'/g, "''")}' AND empresa_id IS NULL`
    );

    console.log(`   OK — registros de ${email} migrados.`);
  }

  console.log('\nMigração concluída. Todos os usuários existentes agora são "dono" da própria empresa.');
}

main().catch(erro => {
  console.error('Erro durante a migração:', erro);
  process.exit(1);
});
