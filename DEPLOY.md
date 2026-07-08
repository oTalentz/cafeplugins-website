# Guia de Deploy no Vercel

Este projeto está pronto para deploy 100% serverless no Vercel (frontend + backend em um único deploy).

## Pré-requisitos

- Conta em [vercel.com](https://vercel.com) (pode logar com GitHub)
- Repositório no GitHub: https://github.com/oTalentz/cafeplugins-website ✅
- Variáveis de ambiente prontas (ver lista abaixo)

## Passo a passo

### 1. Importar o projeto no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Clique em **"Import Git Repository"**
3. Selecione `oTalentz/cafeplugins-website`
4. **NÃO mude nada no formulário** — `vercel.json` já cuida de tudo:
   - Framework: Other (detectado automaticamente)
   - Build Command: (vazio)
   - Output Directory: (vazio)
5. Clique em **"Deploy"** — vai dar erro porque faltam env vars, tudo bem

### 2. Configurar variáveis de ambiente

Vá em **Settings → Environment Variables** e adicione estas variáveis (Production + Preview + Development):

| Variável | Valor (exemplo) | Onde conseguir |
|---|---|---|
| `TURSO_URL` | `libsql://cafeplugins-leocafe1.aws-us-west-2.turso.io` | Turso dashboard |
| `TURSO_TOKEN` | `eyJ...` (JWT) | Turso dashboard → Settings → Tokens |
| `JWT_SECRET` | (gerar com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) | aleatório |
| `ADMIN_EMAIL` | `admin@cafeplugins.com` | sua escolha |
| `ADMIN_PASSWORD` | (gerar com `node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"`) | aleatório, salve em CREDENTIALS.txt |
| `BREVO_API_KEY` | `xkeysib-...` | Brevo dashboard → SMTP & API |
| `BREVO_SENDER_EMAIL` | `noreply@cafeplugins.com` | remetente verificado na Brevo |
| `BREVO_SENDER_NAME` | `cafe plugins` | nome de exibição |
| `ABACATE_API_KEY` | `abc_prod_...` | AbacatePay dashboard |
| `APP_URL` | `https://cafeplugins.com` | domínio final |
| `CORS_ORIGIN` | `https://cafeplugins.com,https://www.cafeplugins.com` | domínios permitidos |
| `ABACATE_WEBHOOK_SECRET` | (gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | aleatório, salve em CREDENTIALS.txt |
| `NODE_ENV` | `production` | — |

### 3. Redeploy

Depois de salvar as env vars, vá em **Deployments → ... → Redeploy**.

Verifique os logs:
- Deve aparecer `bootstrap OK`
- Acesse `https://seu-projeto.vercel.app/api/health` → `{"ok": true}`
- Acesse `https://seu-projeto.vercel.app/` → deve carregar a loja

### 4. Configurar webhook do AbacatePay

No dashboard do AbacatePay (https://app.abacatepay.com):
- Transacional → Webhooks → Criar
- Versão: **v1**
- Nome: `cafeplugins-prod`
- URL: `https://cafeplugins.com/api/orders/webhook` (autenticação via header `x-webhook-signature` = HMAC-SHA256(body, secret))
- Eventos: marcar **billing.paid**
- Salvar

### 5. Domínio customizado

Vercel → Settings → Domains → adicionar `cafeplugins.com` e `www.cafeplugins.com`.

Vercel vai mostrar os registros DNS para configurar na Hostinger (A + CNAME).

Depois de propagar DNS (até 48h), atualizar env var:
- `APP_URL` = `https://cafeplugins.com`
- `CORS_ORIGIN` = `https://cafeplugins.com,https://www.cafeplugins.com`

## Cold Start e Performance

- Vercel serverless: ~500ms-2s de cold start na primeira requisição após inatividade
- Bootstrap (schema + seed) roda 1x por cold start e fica cacheado em memória
- Vercel Hobby: 10s timeout, 100 GB-hours/mês (suficiente para ~100k requests)
- Vercel Pro: 60s timeout, 1000 GB-hours/mês

## Verificação pós-deploy

- [ ] `https://cafeplugins.com/api/health` → `{"ok": true}`
- [ ] `https://cafeplugins.com/` carrega a loja com 6 produtos
- [ ] Login admin funciona
- [ ] Login buyer funciona
- [ ] Checkout PIX gera QR code real (não stub)
- [ ] Webhook de teste funciona: `POST /api/orders/webhook` com `x-webhook-signature` válido retorna 200 ignored
- [ ] E-mail de pagamento confirmado chega no destinatário
- [ ] Link de download no e-mail funciona
- [ ] Painel admin mostra KPIs atualizados

## Custos

- **Vercel Hobby**: grátis (até 100 GB-h/mês)
- **Turso Free**: 9 GB storage, 500M rows read/mês, 10M rows write/mês
- **Brevo Free**: 300 e-mails/dia
- **AbacatePay**: 1,5% por PIX confirmado (já descontado do valor recebido)
- **GitHub Releases**: grátis para repos públicos

**Total para 100 pedidos/mês: ~R$ 0** (só paga a % do AbacatePay sobre vendas confirmadas).
