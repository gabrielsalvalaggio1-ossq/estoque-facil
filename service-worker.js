/**
 * service-worker.js
 * Cacheia os arquivos do app para que ele funcione sem internet.
 * Os DADOS do usuário (produtos/vendas) ficam no IndexedDB, não aqui —
 * este arquivo só garante que a INTERFACE carregue offline.
 */

const CACHE_NAME = 'meu-estoque-v6';

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
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((respostaCache) => {
      const buscaRede = fetch(event.request)
        .then((respostaRede) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, respostaRede.clone());
          });
          return respostaRede;
        })
        .catch(() => respostaCache);

      return respostaCache || buscaRede;
    })
  );
});
