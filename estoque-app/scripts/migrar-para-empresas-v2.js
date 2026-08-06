/**
 * migrar-para-empresas.js (v2 — usa --file em vez de --command)
 *
 * Mesma lógica da v1, mas evita passar SQL direto na linha de comando.
 * No Windows, o cmd.exe interpreta aspas simples/duplas de um jeito que
 * quebra comandos com --command, e o erro que aparece muitas vezes nem
 * fala de aspas — aparece como "Authentication error" ou coisa parecida,
 * porque o comando que chega no wrangler já vem cortado/mal formado.
 *
 * Aqui, cada consulta é escrita num arquivo .sql temporário e executada
 * com --file, que já provou funcionar no seu ambiente.
 *
 * Como rodar (igual antes):
 *   node migrar-para-empresas.js estoque-db
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const nomeDoBanco = process.argv[2];
if (!nomeDoBanco) {
  console.error('Uso: node migrar-para-empresas.js NOME_DO_SEU_BANCO');
  process.exit(1);
}

const arquivoTemp = path.join(__dirname, '.tmp-migracao.sql');

function rodarSql(sql) {
  fs.writeFileSync(arquivoTemp, sql, 'utf8');
  try {
    const comando = `npx wrangler d1 execute ${nomeDoBanco} --remote --json --file="${arquivoTemp}"`;
    const saida = execSync(comando, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
    // O wrangler imprime linhas de progresso (ex: "├ Checking...") antes do
    // JSON de verdade quando usamos --file. Pegamos só a partir do primeiro
    // "[" ou "{", que é onde o JSON realmente começa.
    const inicioColchete = saida.indexOf('[');
    const inicioChave = saida.indexOf('{');
    const candidatos = [inicioColchete, inicioChave].filter(i => i !== -1);
    if (candidatos.length === 0) {
      throw new Error('Não encontrei JSON na resposta do wrangler:\n' + saida);
    }
    const inicio = Math.min(...candidatos);
    return JSON.parse(saida.slice(inicio));
  } finally {
    if (fs.existsSync(arquivoTemp)) fs.unlinkSync(arquivoTemp);
  }
}

function escaparAspas(texto) {
  return String(texto).replace(/'/g, "''");
}

function gerarIdEmpresa() {
  return 'empresa-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function main() {
  console.log('Buscando e-mails com dados existentes...');
  const resultado = rodarSql('SELECT DISTINCT usuario_email FROM registros WHERE empresa_id IS NULL;');
  const emails = (resultado[0]?.results || []).map(r => r.usuario_email).filter(Boolean);

  if (emails.length === 0) {
    console.log('Nenhum registro pendente de migração. Nada a fazer.');
    return;
  }

  console.log(`Encontrados ${emails.length} usuário(s) para migrar:`, emails);

  for (const email of emails) {
    const empresaId = gerarIdEmpresa();
    const emailEscapado = escaparAspas(email);
    const nomeEmpresa = escaparAspas(`Loja de ${email}`);

    console.log(`\n-> Migrando ${email} para empresa ${empresaId}`);

    rodarSql(`INSERT INTO empresas (id, nome, dono_email) VALUES ('${empresaId}', '${nomeEmpresa}', '${emailEscapado}');`);
    rodarSql(`INSERT INTO membros (empresa_id, usuario_email, papel) VALUES ('${empresaId}', '${emailEscapado}', 'dono');`);
    rodarSql(`UPDATE registros SET empresa_id = '${empresaId}' WHERE usuario_email = '${emailEscapado}' AND empresa_id IS NULL;`);

    console.log(`   OK — registros de ${email} migrados.`);
  }

  console.log('\nMigração concluída. Todos os usuários existentes agora são "dono" da própria empresa.');
}

main().catch(erro => {
  console.error('Erro durante a migração:', erro);
  process.exit(1);
});