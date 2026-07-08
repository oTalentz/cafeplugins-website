# cafe plugins — Loja de Plugins Minecraft

Loja completa para vender plugins de Minecraft com **downloads via GitHub Releases**, **pagamento por PIX** (AbacatePay), **e-mails transacionais** (Brevo), **banco de dados gerenciado** (Turso / libSQL) e **programa de afiliados** com payouts mensais via PIX. Inclui painel do cliente/afiliado e painel admin.

```
+------------------+        +------------------+        +-------------------+
|  index.html      |  -->   |  /api/* (Node)   |  -->   |  Turso (libSQL)   |
|  account.html    |        |  Express + JWT   |        |  libsql://...     |
|  admin.html      |        |                  |        +-------------------+
|  download.html   |        |                  |
|  js/data.js      |        |                  |  -->   AbacatePay (PIX)
|  js/store.js     |        |                  |  -->   Brevo (e-mails)
|  js/admin.js     |        |                  |  -->   GitHub Releases
+------------------+        +------------------+
```

## Stack

- **Frontend**: HTML + CSS + JS vanilla (sem build, sem framework)
- **Backend**: Node.js 18+ ES Modules, Express, JWT — deployado como Vercel Serverless Function
- **DB**: Turso (libSQL) — SQLite distribuído
- **E-mail**: Brevo (ex-Sendinblue)
- **Pagamento**: AbacatePay (PIX)
- **Arquivos**: GitHub Releases (CDN gratuito)
- **Auth**: bcrypt + JWT (7 dias, iss/aud)
- **Host**: Vercel (frontend + backend, sem servidor persistente)

## Setup local

```bash
# 1. Instalar dependências (na raiz)
npm install

# 2. Configurar variáveis
cp api/.env.example api/.env
# edite api/.env com as chaves reais (Turso já vem preenchido)

# 3. Rodar
node api/server.js
# servidor em http://localhost:3000
# admin padrão: admin@cafeplugins.com / senha definida em ADMIN_PASSWORD
```

A primeira execução cria as tabelas (com migrations idempotentes), o admin e os produtos de seed.

## Variáveis de ambiente (api/.env)

| Variável | Obrigatório | Descrição |
|---|---|---|
| `TURSO_URL` | ✅ | URL do banco (já configurado) |
| `TURSO_TOKEN` | ✅ | Token JWT do Turso (já configurado) |
| `JWT_SECRET` | ✅ | Mude para uma string aleatória **≥32 chars** em produção (default bloqueado) |
| `ADMIN_EMAIL` | ✅ | E-mail do admin criado no bootstrap |
| `ADMIN_PASSWORD` | ✅ | Senha do admin (mude!) |
| `BREVO_API_KEY` | ❌ | Sem isso, e-mails viram **stub** (não enviam) |
| `BREVO_SENDER_EMAIL` | ❌ | E-mail remetente verificado no Brevo |
| `BREVO_SENDER_NAME` | ❌ | Nome do remetente (default: "cafe plugins") |
| `ABACATE_API_KEY` | ❌ | Sem isso, PIX vira **stub** (QR fake) |
| `ABACATE_URL` | ❌ | Default: `https://api.abacatepay.com/v1` |
| `ABACATE_WEBHOOK_SECRET` | ❌ | HMAC-SHA256 do body via header `x-webhook-signature` (recomendado). Fallback: header `X-Webhook-Secret`. |
| `MANUAL_PIX_KEY` | ❌ | PIX manual para modo stub (fallback) |
| `GITHUB_TOKEN` | ❌ | Só necessário para upload de plugins pelo admin |
| `APP_URL` | ❌ | URL pública (ex: `https://cafeplugins.com`) — usada em links de e-mail e download |
| `CORS_ORIGIN` | ❌ | Lista separada por vírgula. Em prod, defina o domínio final |
| `GATEWAY_FEE_FIXED` | ❌ | Taxa fixa do gateway PIX em R$ (default: `0.80`) — usada no cálculo de comissão líquida |
| `TAX_RATE` | ❌ | Alíquota de imposto (decimal, ex: `0.06` para 6% Simples Nacional). Default `0` (não desconta) |
| `AFFILIATE_NET_COMMISSION` | ❌ | `true` (default) → comissão sobre o líquido (subtotal − taxa − impostos). `false` → sobre o bruto |
| `MIN_PAYOUT` | ❌ | Mínimo de saque em R$ (default: `10`) |
| `MAX_MANUAL_COMMISSION` | ❌ | Limite de comissão manual em R$ (default: `10000`) |
| `NODE_ENV` | ❌ | `production` bloqueia default JWT_SECRET e ativa hardenings |
| `PORT` | ❌ | Default: 3000 |

## Endpoints da API

### Autenticação (`/api/auth/*`)
- `POST /register` — `{ name, email, password }` (limite 3 contas/IP/24h)
- `POST /login` — `{ email, password }` → `{ token, user }`
- `POST /request-code` — envia código de 6 dígitos por e-mail (login ou reset)
- `POST /verify-code` — `{ email, code, purpose }` → login ou reset
- `POST /reset-password` — `{ email, code, newPassword }`
- `POST /change-password` — `{ currentPassword, newPassword }` (auth)
- `GET  /me` — usuário logado (auth)

### Produtos (`/api/products/*`)
- `GET  /` — público, lista ativos
- `GET  /all` — todos (admin)
- `GET  /:id` — detalhe
- `POST /` — criar (admin)
- `PUT  /:id` — atualizar (admin)
- `DELETE /:id` — deletar (admin)

### Pedidos (`/api/orders/*`)
- `POST /checkout` — `{ name, email, items, affiliateCode? }` → cria pedido + PIX + cookie 30d do afiliado. Retorna `breakdown` com `subtotal/gatewayFee/netAmount/commission/commissionRate/storeKeeps`
- `POST /webhook` — webhook do AbacatePay (v1 `billing.paid` / v2 `checkout.completed`, `transparent.completed`)
- `POST /:id/confirm` — confirma manual (admin)
- `PATCH /:id` — atualiza status (admin, transições validadas)
- `GET  /me` — meus pedidos (auth)
- `GET  /affiliate` — pedidos indicados pelo meu código (auth)
- `GET  /:id` — detalhe (dono ou admin; inclui `breakdown`)
- `GET  /:id/status` — status (dono via auth, ou guest com `?email=` exato)
- `GET  /:id/download-token` — token curto p/ download (dono)
- `GET  /by-token?t=` — lookup público (apenas pedidos pagos)
- `GET  /` — todos (admin; cada order inclui `breakdown`)

### Afiliados (`/api/affiliates/*`)
- `POST /become` — ativa conta de afiliado para o usuário logado (gera código único)
- `GET  /me/stats` — `{ affiliate, dailyStats, month, pending, conversion, recentOrders, payouts, fees }` — cada `recentOrder` inclui `breakdown` completo
- `PUT  /me/pix` — atualiza chave PIX do afiliado
- `POST /payouts` — solicita saque via PIX (**mínimo `MIN_PAYOUT`**, default R$ 10)
- `GET  /admin/all` — todos afiliados (admin)
- `POST /admin/:id/status` — banir/pausar/desbanir (admin)
- `GET  /admin/payouts?status=` — lista payouts (admin)
- `POST /admin/payouts/:id/approve` — marca como pago (admin)
- `POST /admin/payouts/:id/reject` — rejeita com motivo (admin)
- `DELETE /admin/payouts/:id` — exclui payout (admin)
- `POST /admin/:id/manual-commission` — adiciona comissão manual (admin, máx `MAX_MANUAL_COMMISSION`)
- `GET  /lookup?code=` — público, valida código de afiliado (usado pelo `?ref=`; retorna `fees`)
- `POST /click` — registra click de afiliado (deduplicado por IP+code+24h)

### Admin (`/api/admin/*`)
- `GET  /stats` — contadores gerais (receita, vendas, plugins, pendentes, compradores, afiliados)
- `GET  /users` — lista de usuários
- `DELETE /users/:id` — excluir (bloqueia último admin, preserva integridade com orders/affiliates)
- `POST /orders` — cria pedido manual (admin, opcionalmente com `affiliate_code` + `status: pago`)

### Diagnóstico
- `GET  /api/diag` — verifica env, DB, Brevo, AbacatePay (use `public/diag.html`)
- `GET  /api/health` — health check simples

Todos os endpoints `/api/admin/*` e mutações admin exigem `Authorization: Bearer <token>` de um usuário com `role: admin`.

## Cadastros externos necessários

A loja funciona **100% em modo stub** (sem nenhum cadastro externo) — mas para colocar em produção, você precisa destes serviços grátis:

### 1. Turso (banco)
Já configurado. O schema é criado com migrations idempotentes no primeiro boot.
👉 [app.turso.tech](https://app.turso.tech)

### 2. Brevo (e-mail)
- Crie conta grátis em [brevo.com](https://www.brevo.com) — 300 e-mails/dia grátis
- Em **Settings → API Keys**, copie a chave para `BREVO_API_KEY`
- Em **Transactional → Senders & Domains**, verifique o e-mail que vai usar como remetente (`BREVO_SENDER_EMAIL`)
- Sem isso: códigos de login e e-mails de pagamento viram **stub** (você vê no console mas ninguém recebe)

### 3. AbacatePay (PIX)
- Crie conta em [app.abacatepay.com](https://app.abacatepay.com) — só recebe pagamento, grátis
- Em **Configurações → API**, copie o token para `ABACATE_API_KEY`
- Em **Webhooks**, adicione a URL pública: `https://cafeplugins.com/api/orders/webhook` e configure o header `x-webhook-signature` (HMAC-SHA256 do body com `ABACATE_WEBHOOK_SECRET` como chave)
- Sem isso: o checkout gera um QR fake de 64 zeros. **Você precisa aprovar pedidos manualmente** pelo painel admin
- **Alternativa**: defina `MANUAL_PIX_KEY` no `.env` e mostre a chave PIX no checkout para o cliente pagar direto

### 4. GitHub Releases (arquivos de plugins)
- Os plugins `.jar` e imagens ficam em um repositório público de releases
- Para baixar, **não precisa de token** (releases são públicos)
- Para subir novos plugins pelo painel admin, precisa de `GITHUB_TOKEN` com permissão `repo`

## Fluxo de uma venda

1. Cliente vai em `index.html`, clica em **Comprar** num plugin
2. Modal de pagamento abre → frontend chama `POST /api/orders/checkout`
3. Backend valida produtos, anti-double-purchase, resolve afiliado, calcula **comissão líquida** (ver abaixo) e chama **AbacatePay** para gerar PIX
4. QR Code aparece no modal → cliente paga
5. **AbacatePay** envia webhook para `POST /api/orders/webhook` → backend chama `markOrderPaid()`:
   - Marca pedido como `pago`
   - Se há afiliado ativo: `conversions+1, total_sales+1, total_earned+=commission, daily_stats[hoje].sales+1/earned+`
   - Gera `license_key` e envia e-mail com link de download
6. Cliente acessa `account.html` → vê pedidos, clica em **Baixar** → `download.html` valida token → redireciona para GitHub Releases

**Failsafe do polling**: mesmo se o webhook falhar, o frontend faz polling em `GET /orders/:id/status` que automaticamente consulta a AbacatePay e chama `markOrderPaid` se estiver pago.

## Cálculo de comissão (modelo LÍQUIDO)

Para garantir que a loja nunca saia no prejuízo pagando afiliado, a comissão é calculada sobre o **valor líquido** (após descontar a taxa fixa do gateway e impostos). Centralizado em `api/lib/config.js` + `api/lib/fees.js`:

```
líquido = subtotal − gatewayFee − (subtotal × taxRate)
comissão = líquido × (affiliateRate / 100)
loja fica = subtotal − gatewayFee − (subtotal × taxRate) − comissão
```

| Preço | Taxa gateway | Impostos | Líquido | Comissão 25% | Loja fica |
|---|---|---|---|---|---|
| R$ 1,00 | R$ 0,80 | — | R$ 0,20 | R$ 0,05 | R$ 0,15 |
| R$ 10,00 | R$ 0,80 | — | R$ 9,20 | R$ 2,30 | R$ 6,90 |
| R$ 25,00 | R$ 0,80 | — | R$ 24,20 | R$ 6,05 | R$ 18,15 |
| R$ 100,00 | R$ 0,80 | — | R$ 99,20 | R$ 24,80 | R$ 74,40 |
| R$ 100,00 | R$ 0,80 | 6% (R$ 6) | R$ 93,20 | R$ 23,30 | R$ 69,90 |

**Configurável via env**: `GATEWAY_FEE_FIXED` (default 0,80), `TAX_RATE` (default 0), `AFFILIATE_NET_COMMISSION` (default true). Cada `order` armazena o breakdown completo (`gateway_fee`, `net_amount`, `commission_rate`, `commission`) e o `serializeOrder` retorna o objeto `breakdown` para o frontend exibir. Vendas manuais do admin (`/admin/orders`) também calculam automaticamente.

## Fluxo de afiliado

1. Cliente logado clica em **Torne-se afiliado** na aba "Afiliado" do `account.html`
2. Backend gera código único (ex: `LEONAR691C`) com 25% de comissão
3. Afiliado compartilha `https://cafeplugins.com/?ref=LEONAR691C`
4. Visitante chega → frontend chama `GET /affiliates/lookup?code=` para validar + `POST /affiliates/click` para registrar click (deduplicado por IP+24h)
5. Cookie de 30 dias é salvo no `localStorage` (`pf_ref`); checkout pré-preenche o campo
6. Cada venda paga com o código → comissão creditada automaticamente
7. Afiliado configura chave PIX em "Chave PIX para receber"
8. Quando saldo ≥ R$ 10, clica em **Pedir saque** → admin recebe solicitação
9. Admin aprova/rejeita em `admin.html` → aba Payouts (com chave PIX visível)
10. Saques mensais pagos via PIX manual pelo admin

## Deploy

### Vercel (recomendado — frontend + backend serverless)

1. Suba o projeto para GitHub
2. Crie um projeto em [vercel.com/new](https://vercel.com/new) e importe o repositório
3. **Nenhuma config de build** é necessária (já tem `vercel.json` na raiz)
4. Adicione as env vars no painel (Settings → Environment Variables):
   - `TURSO_URL`
   - `TURSO_TOKEN`
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL` (ex: `noreply@cafeplugins.com`)
   - `BREVO_SENDER_NAME` (ex: `cafe plugins`)
   - `ABACATE_API_KEY`
   - `ABACATE_WEBHOOK_SECRET`
   - `JWT_SECRET` (gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `APP_URL` (ex: `https://cafeplugins.com`)
   - `CORS_ORIGIN` (ex: `https://cafeplugins.com,https://www.cafeplugins.com`)
   - `NODE_ENV=production`
5. Deploy automático a cada push em `main`

**Estrutura serverless**: `api/index.js` é o único entry point. O Express é instanciado on-demand em cada request (cold start ~1-2s). `bootstrap()` (schema + migrations + admin) roda 1x por cold start e fica cacheado.

**Domínio customizado**: Vercel → Settings → Domains → adicionar domínio e configurar DNS (NS1/NS2.vercel-dns.com).

### Render.com (alternativa)
1. Web Service → Build: `npm install` → Start: `node api/server.js`
2. Adicione as env vars (mesmas do `.env`)

### Railway (alternativa)
Similar ao Render; defina o Root Directory como raiz (não `api`).

## Segurança (hardenings aplicados)

- **Rate limiting** em rotas sensíveis: register (5/min), login (8/min), code (3/min), reset (3/min), checkout (8/min), webhook (60/min), affiliate click (30/min), payout (3/min)
- **JWT_SECRET** ≥ 32 chars em prod; default bloqueado fora de dev
- **bcrypt** cost 12, JWT expira em 7d com iss/aud
- **Anti-double-purchase** no backend (409 `ALREADY_OWNED`) + confirm() no frontend
- **Self-referral** bloqueado (afiliado não pode usar o próprio código)
- **Dedup de click** (1 por IP+code+24h)
- **IP rate limit** em criação de conta (3 contas/IP/24h)
- **Sanitização** centralizada em `api/lib/sanitize.js` (HTML escape, URL allowlist, limites por campo)
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
- **Webhook secret** validado com `timingSafeEqual` (HMAC-safe)
- **Dev creds escondidos** em produção via `IS_DEV` (localhost, *.vercel.app, ?dev=1)

## Customização

- **Produtos**: edite `api/lib/seed-products.js` (roda 1x no primeiro boot)
- **Admin padrão**: mude `ADMIN_EMAIL` / `ADMIN_PASSWORD` no `.env` antes do primeiro boot
- **Comissão de afiliado**: 25% (default, configurável por afiliado em `users.affiliate_rate`)
- **Modelo de comissão**: `AFFILIATE_NET_COMMISSION=true` (líquido, default) ou `false` (bruto). Configurável em `api/lib/config.js`
- **Taxa do gateway**: `GATEWAY_FEE_FIXED=0.80` (R$ por transação PIX). Configurável em `api/lib/config.js`
- **Impostos**: `TAX_RATE=0` (decimal, `0.06` = 6% Simples Nacional). Configurável em `api/lib/config.js`
- **Mínimo de saque**: `MIN_PAYOUT=10` (R$). Configurável em `api/lib/config.js`
- **Visual**: `public/css/style.css` e `public/css/account.css`
- **Cache-bust**: scripts em `?v=20`, `style.css?v=11`

## Estrutura

```
.
├── public/                # Frontend estático
│   ├── index.html         # Loja (vitrine)
│   ├── account.html       # Painel cliente/afiliado
│   ├── admin.html         # Painel admin
│   ├── download.html      # Gateway de download (valida token)
│   ├── diag.html          # Diagnóstico do sistema
│   ├── css/
│   │   ├── style.css
│   │   ├── account.css
│   │   ├── admin.css
│   │   └── download.css
│   └── js/
│       ├── data.js        # Fachada DB (cache + API + normalização snake↔camel)
│       ├── store.js       # Lógica da loja + modal
│       ├── account.js     # Painel cliente/afiliado
│       ├── admin.js       # Painel admin
│       ├── download.js    # Download gateway
│       └── loading.js     # Helper de loading state
├── api/                   # Backend (Vercel Serverless)
│   ├── index.js           # Entry point Vercel (handler serverless)
│   ├── server.js          # Express app + bootstrap (schema/admin/migrations)
│   ├── .env.example
│   ├── lib/
│   │   ├── db.js          # Turso client + schema + migrations
│   │   ├── auth.js        # bcrypt + JWT
│   │   ├── mailer.js      # Brevo
│   │   ├── payments.js    # AbacatePay PIX + checkPaymentStatus
│   │   ├── config.js      # GATEWAY_FEE_FIXED, TAX_RATE, AFFILIATE_NET_COMMISSION, MIN_PAYOUT
│   │   ├── fees.js        # calculateBreakdown() — comissão líquida
│   │   ├── security.js    # rateLimit, timingSafeEqual
│   │   ├── sanitize.js    # XSS, URL allowlist, LIMITS
│   │   ├── github.js      # GitHub Releases
│   │   ├── util.js        # uid, license, token, etc
│   │   └── seed-products.js  # plugins seed
│   └── routes/
│       ├── auth.js
│       ├── products.js
│       ├── orders.js
│       ├── affiliates.js
│       └── admin.js
├── vercel.json            # Config Vercel (rewrites, builds, cache)
├── package.json           # Deps raiz
└── README.md
```

## Licença

MIT
