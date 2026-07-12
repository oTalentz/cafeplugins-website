# cafe plugins — Loja de Plugins Minecraft

Loja completa para vender plugins de Minecraft com **downloads via GitHub Releases**, **pagamento via Mercado Pago** (PIX transparente + cartão), **e-mails transacionais** (Brevo), **banco de dados gerenciado** (Turso / libSQL), **programa de afiliados** com payouts via PIX, **licenciamento com watermark** (JWT assinado embutido no JAR) e **SDK Java** para validação de licenças. Inclui painel do cliente/afiliado e painel admin.

```
+------------------+        +------------------+        +-------------------+
|  index.html      |  -->   |  /api/* (Node)   |  -->   |  Turso (libSQL)   |
|  account.html    |        |  Express + JWT   |        |  libsql://...     |
|  admin.html      |        |                  |        +-------------------+
|  download.html   |        |                  |
|  js/data.js      |        |                  |  -->   Mercado Pago (PIX + cartão)
|  js/store.js     |        |                  |  -->   Brevo (e-mails)
|  js/admin.js     |        |                  |  -->   GitHub Releases (JARs + capas)
+------------------+        +------------------+
```

## Stack

- **Frontend**: HTML + CSS + JS vanilla (sem build, sem framework)
- **Backend**: Node.js 18+ ES Modules, Express, JWT — deployado como Vercel Serverless Function
- **DB**: Turso (libSQL) — SQLite distribuído
- **E-mail**: Brevo (ex-Sendinblue)
- **Pagamento**: Mercado Pago (PIX transparente + cartão via Checkout Pro/Orders API)
- **Arquivos**: GitHub Releases (CDN gratuito — JARs e capas/banners)
- **Auth**: bcrypt + JWT (7 dias, iss/aud)
- **Licenciamento**: JWT RS256 assinado embutido no JAR (`cafe-watermark.jwt`) + SDK Java para validação
- **Host**: Vercel (frontend + backend, sem servidor persistente)

## Funcionalidades

### Loja (pública)
- Catálogo de plugins com capa/banner, badge, preço, tagline e vídeo
- Busca de produtos na landing page
- Checkout PIX (QR code transparente) ou cartão (redirect Mercado Pago)
- Programa de afiliados com `?ref=CODE` (cookie 30 dias, atribuição first-click)
- Dashboard público de afiliados com copiador de link
- Página de download com licença e instruções
- FAQ e SEO dinâmico (meta tags por produto)

### Painel admin
- Dashboard com receita, vendas, plugins, compradores e afiliados
- Gestão de plugins: criar, editar, upload de JAR e capa/banner (com preview)
- Identificação visual na lista: pills **JAR ✓/✗** e **Capa ✓/✗** + thumbnail da capa
- Gestão de vendas: confirmar, atualizar status, lixeira, restaurar, exportar CSV
- Gestão de afiliados: banir/pausar, comissão manual, alertas de self-referral
- Payouts: aprovar em bulk, rejeitar com motivo, filtros por status
- Validação de licenças: consultar e revogar ativações por servidor
- API Health: diagnóstico em tempo real (env, DB, Brevo, Mercado Pago, JWT)
- Configurações: export/import JSON, limpar dados de teste

### Painel do cliente/afiliado
- Meus pedidos com status e download
- Tornar-se afiliado e gerar código único
- Estatísticas diárias, conversão, payouts pendentes
- Atualizar chave PIX para saques

### Backend
- Migrations idempotentes (versionadas)
- Validação e decremento de estoque
- Watermark obrigatório no JAR (SDK Java bloqueia sem watermark válido)
- Proxy de capa: `/api/products/:id/cover` busca imagem do GitHub com token
- Audit log de ações admin
- Rate limiting em auth e webhooks
- Security headers e sanitização de inputs

## Setup local

```bash
# 1. Instalar dependências (na raiz)
npm install

# 2. Configurar variáveis
cp api/.env.example api/.env
# edite api/.env com as chaves reais (Turso, JWT_SECRET, ADMIN_PASSWORD, etc.)

# 3. Rodar
node api/server.js
# servidor em http://localhost:3000
# admin definido em ADMIN_EMAIL / ADMIN_PASSWORD no .env
```

A primeira execução cria as tabelas (com migrations idempotentes), o admin e os produtos de seed.

## Variáveis de ambiente (api/.env)

| Variável | Obrigatório | Descrição |
|---|---|---|
| `TURSO_URL` | ✅ | URL do banco (ex: `libsql://...turso.io`) |
| `TURSO_TOKEN` | ✅ | Token de acesso do Turso |
| `JWT_SECRET` | ✅ | String aleatória **≥32 chars** em produção (default bloqueado) |
| `ADMIN_EMAIL` | ✅ | E-mail do admin criado no bootstrap |
| `ADMIN_PASSWORD` | ✅ | Senha do admin (mín. 12 chars em produção) |
| `BREVO_API_KEY` | ❌ | Sem isso, e-mails viram **stub** (não enviam) |
| `BREVO_SENDER_EMAIL` | ❌ | E-mail remetente verificado no Brevo |
| `BREVO_SENDER_NAME` | ❌ | Nome do remetente (default: "cafe plugins") |
| `EMAIL_CODE_COOLDOWN_SECONDS` | ❌ | Segundos de espera entre envios de códigos (default: `60`) |
| `PAYMENT_GATEWAY` | ❌ | `mercadopago` (default se token configurado), `abacate` ou `manual` |
| `MERCADOPAGO_ACCESS_TOKEN` | ❌ | Access token de produção/teste do Mercado Pago. Sem isso cai no stub. |
| `MERCADOPAGO_WEBHOOK_SECRET` | ❌ | Secret para validar assinatura dos webhooks (`x-signature`) |
| `MERCADOPAGO_URL` | ❌ | Default: `https://api.mercadopago.com` |
| `MERCADOPAGO_SANDBOX` | ❌ | `true` para usar URLs de teste do Checkout Pro |
| `ABACATE_API_KEY` | ❌ | Chave da AbacatePay (apenas se `PAYMENT_GATEWAY=abacate`) |
| `ABACATE_WEBHOOK_SECRET` | ❌ | HMAC-SHA256 do body via header `x-webhook-signature` |
| `MANUAL_PIX_KEY` | ❌ | PIX manual para modo stub (fallback) |
| `GITHUB_TOKEN` | ❌ | Necessário para upload de JARs e capas pelo admin |
| `GITHUB_PLUGIN_REPO` | ❌ | Repo onde JARs/capas são armazenados (default: `oTalentz/Bestiary-Plugin-CafePlugins2026`) |
| `LICENSE_PRIVATE_KEY` | ❌ | Chave privada RS256 (PEM) para assinar watermarks e licenças |
| `LICENSE_PUBLIC_KEY` | ❌ | Chave pública RS256 (PEM) embutida nos JARs |
| `LICENSE_TOKEN_TTL` | ❌ | Validade do token de licença (default: `7d`) |
| `LICENSE_ACTIVATION_LIMIT` | ❌ | Máximo de servidores ativos por licença (default: `1`) |
| `APP_URL` | ❌ | URL pública (ex: `https://cafeplugins.com`) — links de e-mail e download |
| `CORS_ORIGIN` | ❌ | Lista separada por vírgula. Em prod, defina o domínio final |
| `GATEWAY_FEE_FIXED` | ❌ | Taxa fixa do gateway PIX em R$ (default: `0.80`) — cálculo de comissão líquida |
| `TAX_RATE` | ❌ | Alíquota de imposto (decimal, ex: `0.06` para 6%). Default `0` |
| `AFFILIATE_NET_COMMISSION` | ❌ | `true` (default) → comissão sobre líquido. `false` → sobre bruto |
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
- `POST /verify-email` — verifica e-mail com código (pós-registro)
- `POST /resend-verification` — reenvia código de verificação
- `POST /reset-password` — `{ email, code, newPassword }`
- `POST /change-password` — `{ currentPassword, newPassword }` (auth)
- `GET  /me` — usuário logado (auth)

### Produtos (`/api/products/*`)
- `GET  /` — público, lista ativos
- `GET  /all` — todos (admin, inclui `download_url` e `cover_image`)
- `GET  /:id` — detalhe
- `GET  /:id/cover` — proxy de capa (busca imagem do GitHub com token, retorna como imagem pública)
- `POST /` — criar (admin)
- `PUT  /:id` — atualizar (admin)
- `POST /:id/upload` — upload de JAR (admin, embute chave pública e envia para GitHub)
- `POST /:id/upload-cover` — upload de capa/banner (admin, envia para GitHub)
- `GET  /:id/test-download` — testa se o JAR está acessível (admin)
- `DELETE /:id` — deletar (admin)

### Pedidos (`/api/orders/*`)
- `POST /checkout` — `{ name, email, items, affiliateCode?, paymentMethod? }` → cria pedido + PIX/cartão + cookie 30d do afiliado. Retorna `breakdown` com `subtotal/gatewayFee/netAmount/commission/commissionRate/storeKeeps`, além de `checkoutUrl` (cartão), `pixQrCode`, `pixQrImage` e `pixExpiresAt` (PIX)
- `POST /webhook` — webhook da AbacatePay (legacy, validação HMAC `x-abacate-signature`)
- `POST /webhook/mercadopago` — webhook do Mercado Pago: evento `order` (Orders API) ou `payment` (Checkout Pro), validação `x-signature`
- `POST /:id/confirm` — confirma manual (admin)
- `PATCH /:id` — atualiza status (admin, transições validadas)
- `POST /:id/renew-download` — renova token de download (admin)
- `GET  /:id/return` — redirect pós-checkout cartão (redireciona para `account.html`)
- `GET  /me` — meus pedidos (auth)
- `GET  /affiliate` — pedidos indicados pelo meu código (auth)
- `GET  /:id` — detalhe (dono ou admin; inclui `breakdown`)
- `GET  /:id/status` — status (dono via auth ou admin)
- `GET  /:id/download-token` — token curto p/ download (dono)
- `GET  /:id/download?t=` — download do JAR watermarked (dono)
- `GET  /by-token?t=` — lookup público (apenas pedidos pagos)
- `GET  /` — todos (admin; cada order inclui `breakdown`)
- `DELETE /:id` — soft delete (admin, vai para lixeira)
- `DELETE /trash/empty` — esvazia lixeira (admin)
- `POST /:id/restore` — restaura da lixeira (admin)

### Afiliados (`/api/affiliates/*`)
- `POST /become` — ativa conta de afiliado (gera código único)
- `GET  /me/stats` — `{ affiliate, dailyStats, month, pending, conversion, recentOrders, payouts, fees }`
- `PUT  /me/pix` — atualiza chave PIX
- `POST /payouts` — solicita saque via PIX (**mínimo `MIN_PAYOUT`**)
- `GET  /admin/all` — todos afiliados (admin)
- `POST /admin/:id/status` — banir/pausar/desbanir (admin)
- `GET  /admin/payouts?status=` — lista payouts (admin)
- `POST /admin/payouts/:id/approve` — marca como pago (admin)
- `POST /admin/payouts/:id/reject` — rejeita com motivo (admin)
- `DELETE /admin/payouts/:id` — exclui payout (admin)
- `POST /admin/:id/manual-commission` — adiciona comissão manual (admin)
- `GET  /lookup?code=` — público, valida código de afiliado
- `POST /click` — registra click (deduplicado por IP+code+24h)

### Admin (`/api/admin/*`)
- `GET  /stats` — contadores gerais
- `GET  /users` — lista de usuários
- `GET  /users/:id` — detalhe de usuário
- `DELETE /users/:id` — excluir (bloqueia último admin)
- `POST /orders` — cria pedido manual (admin)
- `POST /sync-products` — sincroniza produtos com gateway de cartão
- `POST /cleanup` — limpa dados de teste
- `GET  /audit-log` — log de ações admin

### Licenças (`/api/license/*`)
- `POST /verify` — valida licença + server-id (usado pelo SDK Java)
- `GET  /activations` — lista ativações (admin)
- `POST /activations/:id/revoke` — revoga ativação (admin)

### Diagnóstico
- `GET  /api/diag` — verifica env, DB, Brevo, Mercado Pago, gateway ativo e JWT (admin)
- `GET  /api/health` — health check simples
- `GET  /api/diag/env` — status público das env vars (sem segredos)

Todos os endpoints `/api/admin/*` e mutações admin exigem `Authorization: Bearer <token>` de um usuário com `role: admin`.

## Cadastros externos necessários

A loja funciona sem Mercado Pago, Brevo ou GitHub (esses caem em modo stub automaticamente) — mas **Turso é obrigatório**. Para produção completa, você precisa destes serviços:

### 1. Turso (banco — obrigatório)
- Crie conta em [app.turso.tech](https://app.turso.tech)
- Crie um banco e copie `TURSO_URL` e `TURSO_TOKEN` para o `.env`
- O schema é criado com migrations idempotentes no primeiro boot

### 2. Brevo (e-mail)
- Crie conta grátis em [brevo.com](https://www.brevo.com) — 300 e-mails/dia grátis
- Em **Settings → API Keys**, copie a chave para `BREVO_API_KEY`
- Em **Transactional → Senders & Domains**, adicione e verifique seu e-mail remetente → `BREVO_SENDER_EMAIL`
- (Opcional) `BREVO_SENDER_NAME` — default: "cafe plugins"

### 3. Mercado Pago (pagamento)
- Crie conta em [mercadopago.com.br](https://www.mercadopago.com.br)
- Em **Seu negócio → Configurações → Credenciais**, copie o Access Token → `MERCADOPAGO_ACCESS_TOKEN`
- Configure o webhook em **Notificações → Webhooks**: URL = `https://cafeplugins.com/api/orders/webhook/mercadopago`, eventos `order` e `payment`
- (Opcional) `MERCADOPAGO_WEBHOOK_SECRET` para validar assinatura `x-signature`
- (Opcional) `MERCADOPAGO_SANDBOX=true` para testar com contas de teste

### 4. GitHub (JARs e capas)
- Crie um repositório (pode ser privado) para armazenar releases
- Gere um Personal Access Token com escopo `repo` → `GITHUB_TOKEN`
- (Opcional) `GITHUB_PLUGIN_REPO` — default: `oTalentz/Bestiary-Plugin-CafePlugins2026`
- O admin faz upload dos JARs e capas pelo painel — o backend envia para a release e salva a URL

### 5. Chaves de licenciamento (watermark)
- Gere um par de chaves RS256:
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```
- `LICENSE_PRIVATE_KEY` = conteúdo de `private.pem` (com `\n` literal)
- `LICENSE_PUBLIC_KEY` = conteúdo de `public.pem` (com `\n` literal)
- O backend assina o watermark; o SDK Java valida com a chave pública embutida no JAR

## SDK Java (licenciamento)

O SDK em `packages/cafe-license-java/` valida licenças online (chama a API) e valida o watermark offline (JWT embutido no JAR). O desenvolvedor do plugin coloca um arquivo `cafe-license.yml` dentro do JAR com `product-id`, `api-url` e `public-key`.

```java
// No onEnable do plugin:
@Override
public void onEnable() {
    saveDefaultConfig();
    String licenseKey = getConfig().getString("license-key", "");
    CafeLicense.verify(this, licenseKey);
}

// Re-verificação periódica (opcional, em minutos):
CafeLicense.startPeriodicCheck(this, licenseKey, 30); // a cada 30 min
```

O watermark (`cafe-watermark.jwt`) é embutido no JAR pelo backend no momento do download. Sem ele, o plugin **não funciona** — apenas builds baixadas oficialmente pela loja funcionam.

## Deploy na Vercel

1. Fork/clone este repo
2. Conecte na Vercel — ela detecta `api/index.js` automaticamente
3. Configure as variáveis de ambiente no dashboard da Vercel
4. Deploy — o schema é criado automaticamente no primeiro boot

O `vercel.json` já está configurado com:
- Serverless Function em `api/index.js` (maxDuration 60s, região `pdx1`)
- Rewrites: `/api/(.*)` → `/api/index`, `/(.*)` → `/index.html`
- Headers de cache para assets estáticos e security headers para `/api/*`
- `cleanUrls: true`, `trailingSlash: false`

## Estrutura do projeto

```
api/
  index.js            # entrypoint Vercel
  server.js           # servidor Express (dev local)
  .env                # variáveis (não commitar)
packages/
  api-core/
    lib/
      db.js           # Turso + migrations
      auth.js         # bcrypt + JWT
      payments.js     # AbacatePay (legacy/fallback)
      mercadopago.js  # Mercado Pago
      gateway.js      # abstração de gateway
      fees.js         # cálculo de comissão líquida
      jar-watermark.js # watermark + upload GitHub
      github.js       # API do GitHub (releases)
      mailer.js       # Brevo
      codes.js        # códigos de verificação por e-mail
      sanitize.js     # validação de inputs
      audit.js        # audit log
      security.js     # headers + rate limiting
      monitoring.js   # performance + health
      logger.js       # logging estruturado
      config.js       # constantes de config
      util.js         # helpers (uid, licenseKey, etc.)
      seed-products.js # produtos de seed
    routes/
      auth.js
      products.js
      orders.js
      affiliates.js
      admin.js
      license.js
      diag.js
  cafe-license-java/  # SDK Java para validação
public/
  index.html          # loja
  admin.html          # painel admin
  account.html        # painel cliente/afiliado
  download.html       # página de download
  css/
    style.css         # loja
    admin.css         # painel admin
    account.css       # painel cliente
    download.css      # página de download
    loading.css       # spinners/skeletons
  js/
    data.js           # camada de dados (API client)
    store.js          # loja
    admin.js          # painel admin
    account.js        # painel cliente/afiliado
    download.js       # página de download
    i18n.js           # internacionalização (pt-BR, en, es)
    loading.js        # helpers de loading
```

## Comandos

```bash
npm install        # instalar dependências
node api/server.js # rodar localmente
node --test        # testes
npm run format     # Prettier
```

## Licença

Proprietário — cafe plugins.
