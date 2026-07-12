# cafe plugins

Loja de plugins Minecraft com checkout (PIX + cartão), licenciamento com watermark, downloads via GitHub Releases, e-mails transacionais, programa de afiliados e SDK Java para validação.

## Stack

- **Frontend**: HTML/CSS/JS vanilla (sem build)
- **Backend**: Node.js 18+ ES Modules + Express + JWT (Vercel Serverless)
- **DB**: Turso (libSQL)
- **Pagamento**: Mercado Pago (PIX + cartão)
- **E-mail**: Brevo
- **Arquivos**: GitHub Releases (JARs + capas)
- **Licenciamento**: JWT RS256 embutido no JAR + SDK Java

## Estrutura

```
api/                    Entry points Vercel (index.js, server.js)
packages/api-core/      Backend compartilhado (routes, lib)
packages/cafe-license-java/  SDK Java para validação de licenças
public/                 Frontend (HTML, CSS, JS)
vercel.json             Config deploy + rewrites + headers
```

## Setup local

```bash
npm install
node api/server.js   # http://localhost:3000
```

As variáveis obrigatórias (`TURSO_URL`, `TURSO_TOKEN`, `JWT_SECRET`) precisam estar no ambiente. Sem opcionais, o sistema roda em modo stub (sem pagamento real, sem e-mail, sem GitHub).

## Variáveis de ambiente

### Obrigatórias

| Variável | Descrição |
|---|---|
| `TURSO_URL` | URL do banco (`libsql://...turso.io`) |
| `TURSO_TOKEN` | Token de acesso Turso |
| `JWT_SECRET` | String aleatória ≥32 chars (bloqueado em prod se fraco) |

### Pagamento

| Variável | Descrição |
|---|---|
| `PAYMENT_GATEWAY` | `mercadopago` (default se token configurado) ou `manual` |
| `MERCADOPAGO_ACCESS_TOKEN` | Token de produção do Mercado Pago |
| `MERCADOPAGO_WEBHOOK_SECRET` | Validação `x-signature` dos webhooks |
| `MERCADOPAGO_URL` | Default: `https://api.mercadopago.com` |
| `MANUAL_PIX_KEY` | Fallback PIX manual (modo stub) |

### E-mail

| Variável | Descrição |
|---|---|
| `BREVO_API_KEY` | Chave da API Brevo |
| `BREVO_SENDER_EMAIL` | Remetente verificado no Brevo |
| `BREVO_SENDER_NAME` | Nome do remetente |

### GitHub (downloads e uploads)

| Variável | Descrição |
|---|---|
| `GITHUB_TOKEN` | Token com permissão `repo` (acessar releases) |
| `GITHUB_REPO` | Repo onde ficam os JARs/capas |
| `GITHUB_PLUGIN_REPO` | Repo alternativo para watermark (default igual ao `GITHUB_REPO`) |

### Licenciamento

| Variável | Descrição |
|---|---|
| `LICENSE_PRIVATE_KEY` | Chave privada RS256 (PEM) — assina watermarks e licenças |
| `LICENSE_PUBLIC_KEY` | Chave pública RS256 (PEM) — validada pelo SDK Java |
| `LICENSE_TOKEN_TTL` | Validade do token (default: `7d`) |
| `LICENSE_ACTIVATION_LIMIT` | Máx. de servidores por licença (default: `1`) |

### Admin e app

| Variável | Descrição |
|---|---|
| `ADMIN_EMAIL` | E-mail do admin criado no bootstrap |
| `ADMIN_PASSWORD` | Senha do admin (mín. 12 chars em prod) |
| `APP_URL` | URL pública (links de e-mail/download) |
| `CORS_ORIGIN` | Domínios permitidos (vírgula-separado) |
| `NODE_ENV` | `production` ativa hardenings |

### Negócio

| Variável | Descrição |
|---|---|
| `GATEWAY_FEE_FIXED` | Taxa fixa PIX em R$ (default: `0.80`) |
| `TAX_RATE` | Alíquota de imposto (ex: `0.06` = 6%) |
| `AFFILIATE_NET_COMMISSION` | `true` = comissão sobre líquido (default) |
| `MIN_PAYOUT` | Saque mínimo em R$ (default: `10`) |

## Comandos

```bash
npm start          # Servidor local
npm test           # Testes (node --test)
npm run dev        # Watch mode
npm run lint       # ESLint
npm run format     # Prettier
```

## Deploy (Vercel)

O projeto é 100% serverless. `vercel.json` configura tudo:

1. Importar o repo no [vercel.com/new](https://vercel.com/new)
2. Adicionar variáveis de ambiente no painel da Vercel
3. Redeploy

**Webhook Mercado Pago**: `https://<dominio>/api/orders/webhook/mercadopago` (eventos: `order`, `payment`)

**Health check**: `GET /api/health` retorna status do backend (público) · `GET /api/diag` retorna diagnóstico completo (admin)

## Licenciamento de plugins

Plugins pagos recebem um `cafe-watermark.jwt` assinado (RS256) embutido no JAR no momento do download. O SDK Java (`packages/cafe-license-java`) valida o watermark offline e faz re-verificação periódica opcional.

Plugins gratuitos (price=0) não geram watermark nem licença — download direto do JAR original.

Gerar par de chaves RS256:

```bash
node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});console.log(k.privateKey);console.log(k.publicKey);"
```

## Testes

```bash
npm test   # 29 testes (auth, sanitize, fees, payments, orders)
```
