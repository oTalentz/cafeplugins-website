# AGENTS.md

Notas para agentes/devs que trabalham neste projeto.

## Vercel Serverless Functions + helpers compartilhados

O Vercel usa **Node File Trace** para empacotar Serverless Functions. Ele empacota
corretamente imports vindos de `node_modules`, mas **não empacota helpers
compartilhados importados por caminhos relativos dentro de `api/`**.

Sintoma: runtime `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/api/lib/db.js'`
ao chamar `/api/*`, mesmo com `.vercelignore` correto e `includeFiles`.

### Estrutura que funcura

- `api/index.js` e `api/server.js` ficam em `api/` (entrypoints da Vercel Function).
- Todo código compartilhado vive em `packages/api-core/` como um package local.
- `package.json` raiz declara `"api-core": "file:./packages/api-core"` e `workspaces: ["packages/*"]`.
- Imports usam caminho de package: `api-core/lib/db.js`, `api-core/routes/auth.js`.

### Configuração Vercel

- `vercel.json` usa `functions` apontando apenas para `api/index.js`:

```json
{
  "functions": {
    "api/index.js": { "maxDuration": 10 }
  }
}
```

- Rewrites mantêm `/api/(.*)` -> `/api/index` e `/(.*)` -> `/index.html`.

## Comandos úteis

```bash
# Instalar dependências (na raiz)
npm install

# Rodar localmente
node api/server.js

# Testes
node --test packages/api-core/tests/**/*.test.js
```

## Variáveis de ambiente obrigatórias

- `TURSO_URL`
- `TURSO_TOKEN`
- `JWT_SECRET` (>= 32 chars, diferente de `change-me-in-production`)

Outras variáveis (BREVO, Mercado Pago, ABACATE, etc.) são opcionais e caem em modo stub.
