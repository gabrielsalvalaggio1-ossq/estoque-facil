/**
 * service-worker.js
 * Cacheia os arquivos do app para que ele funcione sem internet.
 * Os DADOS do usuário (produtos/vendas) ficam no IndexedDB, não aqui —
 * este arquivo só garante que a INTERFACE carregue offline.
 */

const CACHE_NAME = 'meu-estoque-v9';

const ARQUIVOS_ESSENCIAIS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/produtos.js',
  './js/vendas.js',
  './js/importacao.js',
  './js/central-dados.js',
  './js/etiquetas.js',
  './js/app.js',
  './js/analytics.js',
  './js/gtag.js',
  './js/init.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Páginas que NUNCA devem ser servidas do cache: são as páginas públicas de
// entrada (login, cadastro, planos) e o esqueleto legado (app.html). Elas
// não fazem sentido "offline" (não dá pra logar sem internet) e, se ficarem
// em cache, toda atualização nelas (como o snippet do Microsoft Clarity)
// fica sempre uma versão atrasada — quem já tinha uma cópia cacheada de
// antes da mudança nunca vê a versão nova, só a de novo-antes-da-anterior,
// porque a estratégia cache-first devolve o cache na hora e só atualiza o
// cache em segundo plano pra PRÓXIMA visita. Isso foi o que fez o Clarity
// (e qualquer outro ajuste nessas páginas) parecer que só funcionava no app.
const PAGINAS_SEMPRE_DA_REDE = [
  '/login.html',
  '/cadastro.html',
  '/planos.html',
  '/app.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_ESSENCIAIS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

// Estratégia: cache primeiro, com atualização em segundo plano (stale-while-revalidate).
// Garante que o app abre instantaneamente mesmo offline, e se atualiza quando há internet.
//
// IMPORTANTE: isso só vale para os arquivos ESTÁTICOS do app (html/css/js/ícones).
// Chamadas para /api/... NUNCA passam por aqui — cada pessoa logada nesse
// aparelho precisa sempre ver os dados de verdade (estoque, vendas, membros,
// sessão) vindos direto do servidor. Cachear /api/me ou /api/produtos, por
// exemplo, poderia mostrar dados de uma conta antiga depois de um logout ou
// troca de usuário no mesmo navegador — um risco tanto de bug quanto de
// vazamento de dados entre contas no mesmo aparelho.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // deixa passar direto pro servidor

  // Páginas públicas/de entrada: sempre buscar da rede, nunca do cache (ver
  // comentário de PAGINAS_SEMPRE_DA_REDE acima). Isso garante que qualquer
  // mudança nelas — como o Microsoft Clarity — apareça imediatamente em
  // todas as páginas, não só no app.
  if (PAGINAS_SEMPRE_DA_REDE.includes(url.pathname)) return;

  event.respondWith(
    (async () => {
      const respostaCache = await caches.match(event.request);

      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          // Clona ANTES de qualquer outra coisa tocar no corpo da resposta,
          // pra nunca correr o risco de "body already used".
          const copiaParaCache = respostaRede.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copiaParaCache))
            .catch(() => {}); // cache é um bônus; se falhar, não quebra a navegação
          return respostaRede;
        })
        .catch(() => respostaCache);

      return respostaCache || buscaRede;
    })()
  );
});