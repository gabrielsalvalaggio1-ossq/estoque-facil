/**
 * service-worker.js
 * Cacheia os arquivos do app para que ele funcione sem internet.
 * Os DADOS do usuário (produtos/vendas) ficam no IndexedDB, não aqui —
 * este arquivo só garante que a INTERFACE carregue offline.
 */

// T14: versão incrementada porque a lista de arquivos essenciais mudou —
// isso força o novo service worker a reinstalar o cache (senão o browser
// continuaria usando o cache antigo, sem os arquivos novos, até um
// unregister manual). Sempre suba esse número ao alterar ARQUIVOS_ESSENCIAIS.
const CACHE_NAME = 'meu-estoque-v12';

const ARQUIVOS_ESSENCIAIS = [
  './',
  './index.html',
  './manifest.json',

  // CSS — todo arquivo referenciado em <link rel="stylesheet"> no index.html
  './css/style.css',
  './css/microinteracoes.css',
  './css/venda-rapida.css',
  './css/estoque-inteligencia.css',
  './css/carrinho-inteligente.css',
  './css/clientes-t9.css',
  './css/dashboard-insights.css',
  './css/estados.css',

  // JS — todo <script src="..."> local do index.html (scripts de terceiros,
  // como pdf.js do cdnjs e o gtag.js do Google, ficam de fora do precache:
  // são cross-origin e entram no cache automaticamente em runtime, via
  // stale-while-revalidate, no primeiro fetch bem-sucedido).
  './js/analytics.js',
  './js/gtag.js',
  './js/db.js',
  './js/produtos.js',
  './js/vendas.js',
  './js/importacao.js',
  './js/central-dados.js',
  './js/dashboard-insights.js',
  './js/etiquetas.js',
  './js/ui-base.js',
  './js/estoque-inteligencia.js',
  './js/ui-estoque-venda.js',
  './js/ui-clientes-render.js',
  './js/ui-produto-modal.js',
  './js/ui-equipe-assinatura.js',
  './js/ui-comprovante-atividades.js',
  './js/ui-onboarding-importacao.js',
  './js/ui-etiquetas.js',
  './js/estados.js',
  './js/app.js',
  './js/venda-rapida.js',
  './js/atalhos.js',
  './js/carrinho-inteligente.js',
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

  // Requisições cross-origin (fontes, SDKs de terceiros, analytics) nunca
  // devem passar pelo cache — o SW não tem como armazená-las de forma útil
  // e tentar interceptá-las só gera erros de CSP no console.
  if (url.origin !== self.location.origin) return;

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