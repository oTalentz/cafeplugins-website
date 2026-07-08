# Guia de Deploy no Vercel

Este projeto roda 100% serverless no Vercel (frontend estático + backend em uma única Vercel Function).

## Pré-requisitos

- Conta em [vercel.com](https://vercel.com)
- Repositório no GitHub: `https://github.com/oTalentz/cafeplugins-website`
- Contas/opcionais:
  - [Turso](https://turso.tech) para o banco SQLite
  - [Mercado Pago](https://mercadopago.com.br) para PIX e cartão
  - [Brevo](https://brevo.com) para e-mails transacionais
  - [AbacatePay](https://abacatepay.com) se quiser PIX alternativo

## Passo a passo

### 1. Importar o projeto no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Importe `oTalentz/cafeplugins-website`
3. **Não mude** build/output settings — `vercel.json` já configura tudo:
   - Framework Preset: Other
   - Build Command: (vazio)
   - Output Directory: (vazio)
4. Deploy inicial vai falhar por falta de env vars. Isso é esperado.

### 2. Configurar variáveis de ambiente

Vá em **Settings → Environment Variables** e adicione (Production / Preview / Development):

| Variável | Obrigatória | Descrição |
|---|---|---|
| `TURSO_URL` | sim | URL do banco (ex: `libsql://...turso.io`) |
| `TURSO_TOKEN` | sim | Token de acesso do Turso |
| `JWT_SECRET` | sim | Mínimo 32 caracteres aleatórios. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_EMAIL` | sim | E-mail do admin padrão |
| `ADMIN_PASSWORD` | sim | Mínimo 12 caracteres |
| `APP_URL` | sim | Domínio final, ex: `https://cafeplugins.com` |
| `CORS_ORIGIN` | sim | Domínios permitidos, ex: `https://cafeplugins.com,https://www.cafeplugins.com` |
| `NODE_ENV` | sim | `production` |
| `PAYMENT_GATEWAY` | sim | `mercadopago` (padrão) ou `abacate` |
| `MERCADOPAGO_ACCESS_TOKEN` | se gateway=mercadopago | Access Token de produção da aplicação no Mercado Pago |
| `MERCADOPAGO_WEBHOOK_SECRET` | recomendado | Assinatura para validar webhooks (`x-signature`) |
| `MERCADOPAGO_SANDBOX` | não | `true` para usar `sandbox_init_point` no Checkout Pro |
| `BREVO_API_KEY` | se enviar e-mail | Chave SMTP/API da Brevo |
| `BREVO_SENDER_EMAIL` | se enviar e-mail | Remetente verificado na Brevo |
| `BREVO_SENDER_NAME` | se enviar e-mail | Nome do remetente |
| `ABACATE_API_KEY` | se gateway=abacate | Chave da AbacatePay |
| `ABACATE_WEBHOOK_SECRET` | se usar AbacatePay | HMAC-SHA256 do body via header `x-webhook-signature` |
| `LICENSE_PRIVATE_KEY` | se usar SDK de licença | Chave privada PEM RS256 para assinar tokens de licença de plugins |
| `LICENSE_PUBLIC_KEY` | se usar SDK de licença | Chave pública PEM RS256 (vai dentro do `cafe-license.yml` do plugin) |
| `LICENSE_TOKEN_TTL` | não | Tempo de validade do token de licença (default `7d`) |
| `LICENSE_ACTIVATION_LIMIT` | não | Máximo de servidores ativos por licença (default `1`) |

> Nunca salve credenciais em arquivos que possam ser commitados. O `.env` real fica apenas localmente; em produção use o painel da Vercel.

### Gerar par de chaves para licenças

```bash
node -e "const { generateKeyPairSync } = require('crypto'); const k = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}); console.log('---PRIVATE---\n'+k.privateKey); console.log('---PUBLIC---\n'+k.publicKey);"
```

Guarde a `LICENSE_PRIVATE_KEY` no painel da Vercel e cole a `LICENSE_PUBLIC_KEY` no `cafe-license.yml` dentro do jar de cada plugin.

### 3. Redeploy

Depois de salvar as variáveis, vá em **Deployments → ... → Redeploy**.

Verifique se a saúde está OK:
- `https://cafeplugins.com/api/health` deve retornar `{"ok":true}`
- `https://cafeplugins.com/` deve carregar a loja
- Login de admin e buyer devem funcionar
- Checkout gera QR (PIX) ou checkout URL (cartão)

### 4. Configurar domínio customizado

Vercel → Settings → Domains → adicione `cafeplugins.com` e `www.cafeplugins.com`.

Configure os registros DNS informados (geralmente um `A` e um `CNAME` para `www`).

### 5. Configurar webhooks

#### Mercado Pago

1. No painel do Mercado Pago, vá em **Aplicações → Webhooks**
2. URL: `https://cafeplugins.com/api/orders/webhook/mercadopago`
3. Eventos: **Order (Mercado Pago)**. Também pode ativar **Pagamentos** se usar Checkout Pro legado.
4. Ative a assinatura (`x-signature`) e copie o secret para `MERCADOPAGO_WEBHOOK_SECRET`

#### AbacatePay (se usar)

1. Dashboard da AbacatePay → Webhooks
2. URL: `https://cafeplugins.com/api/orders/webhook`
3. Evento: `billing.paid`
4. Header `x-webhook-signature` com `ABACATE_WEBHOOK_SECRET`

## Verificação pós-deploy

- [ ] Loja carrega na URL pública
- [ ] `/api/health` retorna `ok`
- [ ] Login admin funciona
- [ ] Login buyer funciona
- [ ] Checkout gera QR real de PIX (não stub)
- [ ] Cartão gera URL do Mercado Pago
- [ ] Webhook confirma pedido automaticamente
- [ ] E-mail de confirmação chega (se Brevo configurado)
- [ ] Link de download no e-mail funciona
- [ ] `/api/license/verify` responde corretamente para plugins com SDK

## Cold Start e limites

- Vercel Hobby: 10s timeout padrão (configurado para 30s em `vercel.json` mas limitado pelo plano)
- Vercel Pro: 60s timeout
- Turso Free: 9 GB storage, 500M leituras/mês
- Brevo Free: 300 e-mails/dia
