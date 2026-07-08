import { Router } from 'express';
import { envStatus, isReady, get, all } from 'api-core/lib/db.js';
import { checkEnv, createLogger } from 'api-core/lib/logger.js';
import { requireAdmin } from 'api-core/lib/auth.js';

const router = Router();
const log = createLogger('diag');

const REQUIRED = [
  'TURSO_URL',
  'TURSO_TOKEN',
  'JWT_SECRET',
  'BREVO_API_KEY',
  'ABACATE_API_KEY',
  'ABACATE_WEBHOOK_SECRET'
];

const OPTIONAL = [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
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
  if (process.env.BREVO_API_KEY) {
    try {
      const r = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': process.env.BREVO_API_KEY }
      });
      const body = await r.json().catch(() => ({}));
      result.checks.brevo = { ok: r.ok, status: r.status };
    } catch (e) {
      result.checks.brevo = { ok: false, error: e.message };
    }
  } else {
    result.checks.brevo = { ok: false, error: 'BREVO_API_KEY não configurado' };
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

  result.duration_ms = Date.now() - t0;
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;
