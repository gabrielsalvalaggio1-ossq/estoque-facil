/**
 * service-worker.js
 * Cacheia os arquivos do app para que ele funcione sem internet.
 * Os DADOS do usuário (produtos/vendas) ficam no IndexedDB, não aqui —
 * este arquivo só garante que a INTERFACE carregue offline.
 */

const CACHE_NAME = 'meu-estoque-v7';

const ARQUIVOS_ESSENCIAIS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/produtos.js',
  './js/vendas.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
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