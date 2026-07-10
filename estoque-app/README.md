# Meu Estoque

Controle de estoque e vendas simples para pequenos comerciantes. Feito para quem hoje usa caderno, Excel ou WhatsApp — sem curva de aprendizado.

## Por que este stack

Custo mensal: **R$ 0**, sem exceções.

| Camada | Escolha | Por quê |
|---|---|---|
| Interface | HTML + CSS + JS puro | Sem build step, sem dependências, qualquer navegador roda |
| Dados | IndexedDB (navegador) | Funciona 100% offline, não depende de servidor nem de internet |
| Instalação | PWA (manifest + service worker) | Vira "app" na tela inicial sem passar por loja (evita taxa anual da Apple) |
| Hospedagem | Cloudflare Pages | Grátis, deploy automático, suporta headers customizados para o service worker |
| Versionamento | GitHub | Grátis, histórico completo, integra direto com Cloudflare Pages |

Flutter e Supabase foram considerados e adiados de propósito — ver "Roadmap" abaixo.

## Estrutura

```
estoque-app/
├── index.html          → estrutura da página
├── manifest.json        → torna o app instalável
├── service-worker.js    → cache offline
├── _headers              → configuração do Cloudflare Pages
├── css/style.css
├── js/
│   ├── db.js             → único arquivo que fala com o IndexedDB
│   ├── produtos.js       → regras de negócio de estoque
│   ├── vendas.js         → regras de negócio de vendas
│   └── app.js             → interface (renderização e eventos)
└── icons/
```

Cada camada tem uma responsabilidade só: `db.js` nunca sabe de HTML, `app.js` nunca fala direto com o banco. Isso importa porque, quando entrarmos no plano Premium com sincronização (Supabase), só `db.js` precisa mudar — o resto do app não percebe a troca.

## Como rodar localmente

Não pode abrir o `index.html` direto com duplo clique (IndexedDB e service worker exigem um servidor, mesmo que local). Rode:

```bash
cd estoque-app
python3 -m http.server 8000
```

Depois abra `http://localhost:8000` no navegador.

## Como publicar (Cloudflare Pages, grátis)

1. Suba esta pasta para um repositório no GitHub.
2. Em [pages.cloudflare.com](https://pages.cloudflare.com), conecte o repositório.
3. Build command: (nenhum) — Output directory: `/`
4. Deploy. A cada `git push`, o site atualiza sozinho.

## Como o comerciante instala no celular

1. Abre o link do site no navegador do celular.
2. Menu do navegador → "Adicionar à tela inicial" (Android) ou "Adicionar à Tela de Início" (iPhone).
3. Pronto — abre como app, ícone próprio, sem barra de navegador.

## Limitações conscientes da V1

- Os dados ficam **só no aparelho**. Se o comerciante trocar de celular ou desinstalar o navegador, perde os dados. Isso é aceitável na V1 porque backup é funcionalidade Premium — mas deve ficar claro para o usuário (ver "Próximos passos").
- Um usuário só, um dispositivo só. Sem login.

## Foto do produto e leitor de código de barras

Ambos gratuitos, sem serviço externo:

- **Foto**: usa `<input type="file">` do próprio navegador (câmera ou galeria). A imagem é redimensionada e comprimida no dispositivo antes de salvar (máx. 480px, JPEG ~70%), para o IndexedDB não crescer demais.
- **Código de barras**: usa a API nativa `BarcodeDetector` do navegador — sem biblioteca externa, sem custo. Funciona no **Chrome (Android e desktop)**. **Não funciona no Safari/iPhone**, pois a Apple não implementa essa API no WebKit. Por isso o campo de código de barras sempre aceita digitação manual como alternativa garantida, em qualquer navegador.

## Roadmap

**V1 (atual, gratuita):** cadastro de produtos, registro de vendas com forma de pagamento (dinheiro, pix, cartão, fiado) e nome do cliente, cancelamento de venda com devolução automática ao estoque, histórico de entradas/saídas por produto, exportação do estoque em CSV, onboarding com dados de exemplo na primeira abertura, estoque automático, instalável, offline.

**V1.1 (ainda gratuita, sugerido):** aviso visível na tela ("seus dados estão salvos só neste aparelho") + botão de exportar/importar um arquivo `.json` de backup manual — resolve parte da dor de perder dados, sem precisar de Supabase ainda.

**Premium (futuro, quando fizer sentido cobrar):** Supabase (Postgres + Auth, free tier) para backup em nuvem e multiusuário; relatórios avançados; exportação para Excel; leitura de código de barras (via câmera, API nativa do navegador — ainda grátis); impressão de recibo.
