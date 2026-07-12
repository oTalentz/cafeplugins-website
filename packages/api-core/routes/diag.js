import { Router } from 'express';
import { envStatus, isReady, get, all } from 'api-core/lib/db.js';
import { checkEnv, createLogger } from 'api-core/lib/logger.js';
import { requireAdmin } from 'api-core/lib/auth.js';
import { isValidEmail } from 'api-core/lib/util.js';
import { paymentGateway, pixEnabled, cardEnabled } from 'api-core/lib/gateway.js';
import { mercadoPagoEnabled } from 'api-core/lib/mercadopago.js';

const router = Router();
const log = createLogger('diag');

async function brevoFetch(path, apiKey) {
  const r = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: {
      'api-key': apiKey,
      'Accept': 'application/json'
    }
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

async function checkBrevo() {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || '').trim();
  const senderName = process.env.BREVO_SENDER_NAME || 'cafe plugins';

  if (!apiKey) {
    return { ok: false, error: 'BREVO_API_KEY não configurado' };
  }

  // 1. Valida chave e recupera dados da conta
  const account = await brevoFetch('/account', apiKey);
  if (!account.ok) {
    return {
      ok: false,
      error: `Brevo API retornou ${account.status}${account.body?.message ? ': ' + account.body.message : ''}`,
      status: account.status
    };
  }

  const accountEmail = account.body.email;
  const company = account.body.companyName || account.body.company || null;

  // 2. Sender é obrigatório para envio real
  if (!senderEmail) {
    return {
      ok: false,
      error: 'BREVO_SENDER_EMAIL não configurado (remetente obrigatório para envio)',
      account: { email: accountEmail, company }
    };
  }

  if (!isValidEmail(senderEmail)) {
    return {
      ok: false,
      error: 'BREVO_SENDER_EMAIL inválido',
      account: { email: accountEmail, company }
    };
  }

  // 3. Verifica se o remetente está cadastrado e ativo no Brevo
  const senders = await brevoFetch('/senders', apiKey);
  if (!senders.ok) {
    return {
      ok: false,
      error: `Não foi possível listar remetentes do Brevo: ${senders.status}`,
      account: { email: accountEmail, company },
      sender: { email: senderEmail, name: senderName, configured: false }
    };
  }

  const list = Array.isArray(senders.body?.senders) ? senders.body.senders : [];
  const sender = list.find(s => s.email && s.email.toLowerCase() === senderEmail.toLowerCase());

  if (!sender) {
    return {
      ok: false,
      error: `Remetente ${senderEmail} não encontrado no Brevo. Crie/verifique o sender em Transactional > Senders & Domains.`,
      account: { email: accountEmail, company },
      sender: { email: senderEmail, name: senderName, configured: false }
    };
  }

  if (!sender.active) {
    return {
      ok: false,
      error: `Remetente ${senderEmail} está inativo no Brevo. Verifique o e-mail de confirmação.`,
      account: { email: accountEmail, company },
      sender: { email: sender.email, name: sender.name, active: false, id: sender.id }
    };
  }

  return {
    ok: true,
    email: accountEmail,
    company,
    sender: { email: sender.email, name: sender.name, active: true, id: sender.id }
  };
}

const REQUIRED = [
  'TURSO_URL',
  'TURSO_TOKEN',
  'JWT_SECRET'
];

const OPTIONAL = [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  'PAYMENT_GATEWAY',
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'MERCADOPAGO_URL',
  'ABACATE_API_KEY',
  'ABACATE_WEBHOOK_SECRET',
  'MANUAL_PIX_KEY',
  'GITHUB_TOKEN',
  'GITHUB_PLUGIN_REPO',
  'LICENSE_PRIVATE_KEY',
  'LICENSE_PUBLIC_KEY',
  'APP_URL',
  'CORS_ORIGIN',
  'NODE_ENV'
];

// Endpoint público para verificar env vars (sem autenticação)
// Útil para debug rápido de erro 500
router.get('/env', (_req, res) => {
  const envStatus = {
    TURSO_URL: !!process.env.TURSO_URL,
    TURSO_TOKEN: !!process.env.TURSO_TOKEN,
    JWT_SECRET: !!process.env.JWT_SECRET,
    ADMIN_EMAIL: !!process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    APP_URL: !!process.env.APP_URL,
    CORS_ORIGIN: !!process.env.CORS_ORIGIN,
    NODE_ENV: process.env.NODE_ENV || 'development',
    VERCEL: !!process.env.VERCEL
  };

  const missing = Object.entries(envStatus)
    .filter(([key, has]) => !has && key !== 'VERCEL' && key !== 'NODE_ENV')
    .map(([key]) => key);

  res.json({
    status: missing.length > 0 ? 'error' : 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    vercel: !!process.env.VERCEL,
    envStatus,
    missing: missing.length > 0 ? missing : undefined,
    message: missing.length > 0
      ? `Variáveis de ambiente faltando: ${missing.join(', ')}`
      : 'Todas as variáveis de ambiente essenciais configuradas'
  });
});

// /diag é PROTEGIDO: requer auth admin. Não vaza mais previews de secrets.
// Em dev (sem VERCEL), permite acesso anônimo para facilitar debug.
router.get('/', requireAdmin, async (req, res) => {
  const t0 = Date.now();
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;

  const result = {
    ok: true,
    ts: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime()),
    node_version: process.version,
    vercel: !!process.env.VERCEL,
    env_region: process.env.VERCEL_REGION || 'local',
    env: {
      required: {},
      optional: {},
      missing_required: []
    },
    db: {
      initialized: isReady(),
      url: envStatus().url_value
    },
    checks: {}
  };

  for (const k of REQUIRED) {
    const v = process.env[k];
    result.env.required[k] = {
      set: !!v && v.trim() !== '',
      length: v ? v.length : 0
      // SEM preview — nunca vazar parte do secret
    };
    if (!v || v.trim() === '') result.env.missing_required.push(k);
  }
  for (const k of OPTIONAL) {
    const v = process.env[k];
    result.env.optional[k] = !!v && v.trim() !== '';
  }

  if (result.env.missing_required.length) {
    result.ok = false;
  }

  // Teste de DB
  try {
    const r = await get('SELECT COUNT(*) as c FROM products');
    result.checks.products = { ok: true, count: r.c };
  } catch (e) {
    result.checks.products = { ok: false, error: e.message, code: e.code };
    result.ok = false;
  }

  try {
    const r = await get('SELECT COUNT(*) as c FROM users');
    result.checks.users = { ok: true, count: r.c };
  } catch (e) {
    result.checks.users = { ok: false, error: e.message, code: e.code };
  }

  // Teste JWT (sem expor o secret)
  try {
    if (!process.env.JWT_SECRET) {
      result.checks.jwt = { ok: false, error: 'JWT_SECRET não configurado' };
      result.ok = false;
    } else {
      const jwt = await import('jsonwebtoken');
      const token = jwt.default.sign({ test: true }, process.env.JWT_SECRET, { expiresIn: '1m', issuer: 'cafe-plugins', audience: 'cafe-plugins-web' });
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET, { issuer: 'cafe-plugins', audience: 'cafe-plugins-web' });
      result.checks.jwt = { ok: decoded && decoded.test === true, can_sign: true, can_verify: true };
    }
  } catch (e) {
    result.checks.jwt = { ok: false, error: e.message };
  }

  // Teste Brevo
  try {
    result.checks.brevo = await checkBrevo();
  } catch (e) {
    result.checks.brevo = { ok: false, error: e.message };
  }

  // Teste AbacatePay: usa endpoint de listagem de cobranças PIX (read-only e público na auth)
  if (process.env.ABACATE_API_KEY) {
    try {
      const r = await fetch('https://api.abacatepay.com/v1/billing/list', {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.ABACATE_API_KEY}` }
      });
      const body = await r.json().catch(() => ({}));
      const apiOk = r.ok && (body.success !== false || Array.isArray(body?.data));
      result.checks.abacate = { ok: apiOk, status: r.status };
      // Teste adicional: catálog de produtos (essencial para cartão)
      if (apiOk) {
        try {
          const r2 = await fetch('https://api.abacatepay.com/v1/products/list', {
            method: 'GET',
            headers: { Authorization: `Bearer ${process.env.ABACATE_API_KEY}` }
          });
          const body2 = await r2.json().catch(() => ({}));
          const list = Array.isArray(body2?.data) ? body2.data : [];
          result.checks.abacate_products = {
            ok: r2.ok,
            status: r2.status,
            count: list.length
          };
        } catch (e) {
          result.checks.abacate_products = { ok: false, error: e.message };
        }
      }
    } catch (e) {
      result.checks.abacate = { ok: false, error: e.message };
    }
  } else {
    result.checks.abacate = { ok: false, error: 'ABACATE_API_KEY não configurado' };
  }

  // Teste Mercado Pago: valida o access token chamando /v1/payments/search (read-only)
  if (mercadoPagoEnabled()) {
    try {
      const mpUrl = (process.env.MERCADOPAGO_URL || 'https://api.mercadopago.com')
        + '/v1/payments/search?limit=1&sort=date_created&criteria=desc';
      const r = await fetch(mpUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
      });
      const body = await r.json().catch(() => ({}));
      // 200 = token válido; 401/403 = token inválido
      result.checks.mercadopago = {
        ok: r.ok,
        status: r.status,
        ...(r.ok ? {} : { error: body?.message || `HTTP ${r.status}` })
      };
    } catch (e) {
      result.checks.mercadopago = { ok: false, error: e.message };
    }
  } else {
    result.checks.mercadopago = { ok: false, error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' };
  }

  // Gateway ativo (resumo: qual gateway está em uso)
  result.checks.gateway = {
    ok: pixEnabled() || cardEnabled(),
    active: paymentGateway(),
    pix: pixEnabled(),
    card: cardEnabled()
  };

  result.duration_ms = Date.now() - t0;
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;
