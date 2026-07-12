# MEV — Meu Estoque e Vendas

Controle de estoque e vendas para pequenos comerciantes. Feito para quem hoje usa caderno, Excel ou WhatsApp — sem curva de aprendizado, sem mensalidade no plano gratuito.

## Por que este stack

Custo base: **R$ 0**, sem exceções no plano gratuito.

| Camada | Escolha | Por quê |
|---|---|---|
| Interface | HTML + CSS + JS puro | Sem build step, sem dependências, qualquer navegador roda |
| Dados | IndexedDB (navegador) | Funciona 100% offline, não depende de servidor |
| Instalação | PWA (manifest + service worker) | Vira "app" na tela inicial sem passar por loja |
| Hospedagem | Cloudflare Pages + Functions | Grátis, deploy automático via GitHub, suporta backend serverless |
| Pagamentos | MercadoPago (Checkout Pro) | Integração via Cloudflare Functions para assinaturas do plano Pro |
| Auth | Cloudflare Workers + JWT | Login com email/senha, convite de equipe por link |

## Funcionalidades

### Plano Gratuito
- Cadastro de produtos com foto, código de barras e categoria
- Registro de vendas (dinheiro, Pix, cartão, fiado)
- Controle de estoque automático (debita na venda, repõe no cancelamento)
- Histórico de entradas e saídas por produto
- Venda rápida com carrinho inteligente
- Clientes com busca T9 (digita pelo número do celular)
- Exportação do estoque em CSV
- Impressão de etiquetas de preço
- PWA instalável, funciona offline

### Plano Pro
- **Central de Dados** — dashboard com KPIs, metas, alertas de estoque crítico e análise de giro
- **Atividades** — log completo de tudo que aconteceu no sistema
- Importação de produtos via planilha CSV/Excel
- Impressão de etiquetas em lote
- Controle de devedores de fiado

### Multiusuário
| Papel | Acesso |
|---|---|
| **Dono** | Tudo — estoque, vendas, histórico, central, equipe, assinatura |
| **Estoquista** | Estoque + conta |
| **Vendedor** | Venda + conta |

Donos convidam a equipe por link. Cada membro faz login com a própria conta.

## Estrutura do projeto

```
estoque-app/
├── index.html                    → app principal (SPA)
├── login.html                    → tela de login
├── cadastro.html                 → criação de conta
├── esqueci-senha.html
├── redefinir-senha.html
├── planos.html                   → página de planos e preços
├── manifest.json                 → torna o app instalável (PWA)
├── service-worker.js             → cache offline
├── _headers                      → headers do Cloudflare Pages
│
├── css/
│   ├── style.css                 → base + design tokens (CSS custom properties)
│   ├── visual-upgrade.css        → refinamentos visuais globais
│   ├── dashboard-insights.css    → Central de Dados
│   ├── microinteracoes.css       → animações e transições
│   ├── carrinho-inteligente.css  → módulo de carrinho
│   ├── venda-rapida.css          → módulo de venda rápida
│   ├── estoque-inteligencia.css  → alertas e inteligência de estoque
│   ├── clientes-t9.css           → busca de clientes
│   └── estados.css               → estados vazios e de carregamento
│
├── js/
│   ├── db.js                     → único arquivo que fala com IndexedDB
│   ├── produtos.js               → regras de negócio de estoque
│   ├── vendas.js                 → regras de negócio de vendas
│   ├── app.js                    → boot, restrições por papel, navegação entre abas
│   ├── init.js                   → inicialização e dados de exemplo
│   ├── login.js                  → autenticação
│   ├── ui-base.js                → componentes base de UI
│   ├── ui-estoque-venda.js       → renderização das abas Estoque e Venda
│   ├── ui-clientes-render.js     → aba Clientes + aba Contato
│   ├── ui-produto-modal.js       → modal de cadastro/edição de produto
│   ├── ui-equipe-assinatura.js   → abas Conta e Assinatura
│   ├── ui-comprovante-atividades.js → aba Atividades e comprovantes
│   ├── ui-onboarding-importacao.js  → onboarding e importação de planilha
│   ├── ui-etiquetas.js           → impressão de etiquetas
│   ├── central-dados.js          → aba Central de Dados (Pro)
│   ├── dashboard-insights.js     → gráficos e insights do dashboard
│   ├── carrinho-inteligente.js   → lógica do carrinho
│   ├── venda-rapida.js           → fluxo de venda rápida
│   ├── checkout-modal.js         → modal de checkout com MercadoPago
│   ├── importacao.js             → lógica de importação CSV/Excel
│   ├── estoque-inteligencia.js   → alertas e sugestões de reposição
│   ├── estados.js                → estados vazios e de erro
│   ├── selecao-lote.js           → seleção em lote para etiquetas
│   ├── etiquetas.js              → geração de etiquetas PDF
│   ├── atalhos.js                → atalhos de teclado globais
│   ├── analytics.js              → eventos de analytics
│   └── gtag.js                   → Google Tag Manager
│
└── functions/api/
    ├── [[path]].js               → API principal (auth, dados, equipe)
    ├── auth/[[path]].js          → rotas de autenticação
    ├── checkout-mp-iniciar.js    → inicia sessão de checkout MercadoPago
    ├── checkout-mp-assinar.js    → processa assinatura Pro
    └── webhook-mp.js             → webhook de eventos do MercadoPago
```

## Arquitetura

- `db.js` é o único arquivo que acessa o IndexedDB. Nunca tem HTML, nunca renderiza nada.
- `produtos.js` e `vendas.js` contêm as regras de negócio — não sabem de banco nem de DOM.
- Os arquivos `ui-*.js` só renderizam. Nunca escrevem direto no banco.
- `app.js` é o ponto de entrada: faz o boot, aplica restrições por papel do usuário e gerencia a navegação entre abas.
- CSS usa custom properties como design tokens — sem pré-processador, sem build.

Essa separação existe por um motivo prático: quando o plano Premium migrar para sincronização em nuvem (Supabase), só `db.js` e `functions/` precisam mudar.

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+N` / `⌘N` | Novo produto (navega para Estoque se necessário) |
| `Ctrl+F` / `⌘F` / `/` | Foca o campo de busca da aba atual |
| `Ctrl+S` / `⌘S` | Salva o formulário/modal aberto |
| `ESC` | Fecha o modal aberto |

> Os atalhos não disparam quando o foco está em campos de texto.

## Como rodar localmente

IndexedDB e service worker exigem um servidor HTTP, mesmo que local:

```bash
cd estoque-app
python3 -m http.server 8000
```

Abra `http://localhost:8000` no navegador.

## Como publicar (Cloudflare Pages)

1. Suba a pasta para um repositório no GitHub.
2. Em [pages.cloudflare.com](https://pages.cloudflare.com), conecte o repositório.
3. Build command: (nenhum) — Output directory: `/`
4. A cada `git push`, o deploy acontece automaticamente.

As Cloudflare Functions em `functions/api/` são publicadas junto — não precisa de configuração extra.

## Como o comerciante instala no celular

1. Abre o link do site no navegador.
2. Menu → "Adicionar à tela inicial" (Android) ou "Adicionar à Tela de Início" (iPhone).
3. Abre como app, com ícone próprio, sem barra de navegador.

## Limitações conhecidas

- **Dados locais:** no plano gratuito os dados ficam só no dispositivo. Trocar de celular ou limpar o navegador apaga tudo. Backup manual via exportação CSV é a alternativa até o plano Pro com sincronização em nuvem.
- **Código de barras:** usa a API nativa `BarcodeDetector` do navegador. Funciona no Chrome (Android e desktop). Não funciona no Safari/iPhone — o campo sempre aceita digitação manual como alternativa.
- **Multiusuário:** cada papel acessa apenas as abas permitidas. Não há permissões granulares por produto ou categoria.