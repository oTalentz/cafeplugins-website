import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { existsSync } from 'node:fs';

import { initSchema, get, run, all } from 'api-core/lib/db.js';
import { hashPassword } from 'api-core/lib/auth.js';
import { uid, nowISO, randomToken } from 'api-core/lib/util.js';
import { SEED_PRODUCTS } from 'api-core/lib/seed-products.js';
import { createLogger, checkEnv } from 'api-core/lib/logger.js';
import { securityHeaders } from 'api-core/lib/security.js';
import { performanceMiddleware, healthCheck, getMetrics } from 'api-core/lib/monitoring.js';
import { abacateEnabled, createAbacateProduct } from 'api-core/lib/payments.js';
import { mailerEnabled } from 'api-core/lib/mailer.js';
import { CORS_ORIGINS } from 'api-core/lib/config.js';

const log = createLogger('server');

import authRoutes from 'api-core/routes/auth.js';
import productsRoutes from 'api-core/routes/products.js';
import ordersRoutes from 'api-core/routes/orders.js';
import affiliatesRoutes from 'api-core/routes/affiliates.js';
import adminRoutes from 'api-core/routes/admin.js';
import diagRoutes from 'api-core/routes/diag.js';
import licenseRoutes from 'api-core/routes/license.js';

const ROOT = process.env.STATIC_ROOT
  ? process.env.STATIC_ROOT
  : join(__dirname, '..', 'public');
const ROOT_RESOLVED = resolve(ROOT);

function safeStaticPath(reqPath) {
  const relativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^[/\\]+/, '');
  const file = resolve(ROOT_RESOLVED, relativePath);
  if (file !== ROOT_RESOLVED && !file.startsWith(ROOT_RESOLVED + sep)) return null;
  return file;
}

export async function bootstrap() {
  const log = createLogger('bootstrap');
  log.info('bootstrap iniciando', { region: process.env.VERCEL_REGION || 'local', node_env: process.env.NODE_ENV });
  log.info('verificando env vars...');
  // Apenas TURSO_URL, TURSO_TOKEN e JWT_SECRET são obrigatórias
  // Brevo e AbacatePay são opcionais (funcionam em modo stub)
  const envCheck = checkEnv(['TURSO_URL', 'TURSO_TOKEN', 'JWT_SECRET']);
  if (!envCheck.ok) {
    log.error('ENV vars obrigatórias faltando', { missing: envCheck.missing });
    throw new Error(`Env vars faltando: ${envCheck.missing.join(', ')}`);
  }

  // Valida força do JWT_SECRET antes de subir
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-production' || process.env.JWT_SECRET.length < 32) {
    log.error('JWT_SECRET ausente ou fraco. Defina um secret com pelo menos 32 chars aleatórios.');
    if (process.env.VERCEL) throw new Error('JWT_SECRET inseguro em produção');
  }

  // Logar status de integrações opcionais
  const hasBrevo = mailerEnabled();
  const hasAbacate = !!process.env.ABACATE_API_KEY;
  log.info('status de integrações', { brevo: hasBrevo ? 'configurado' : 'stub mode', abacate: hasAbacate ? 'configurado' : 'manual mode' });

  // Em prod, exige HTTPS
  if (process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    log.warn('NODE_ENV não é "production" em Vercel — assumindo prod');
  }

  log.info('inicializando schema...');
  await initSchema();
  log.info('verificando admin...');
  await ensureAdmin();
  log.info('verificando seed de produtos...');
  await ensureSeedProducts();
  // Sincroniza produtos já existentes com a AbacatePay (idempotente: só sincroniza
  // os que não têm abacate_product_id). Garante que cartão funciona logo após o deploy.
  // WRAP em try/catch: se AbacatePay estiver lento/fora, o backend NÃO pode ficar
  // indisponível só por causa disso. O admin pode re-sincronizar manualmente depois.
  try {
    await Promise.race([
      syncAbacateProducts(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('sync timeout (5s)')), 5000))
    ]);
  } catch (err) {
    log.warn('sync AbacatePay falhou no bootstrap (não-bloqueante):', { error: err.message });
  }
  log.info('bootstrap OK');
}

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@cafeplugins.com').toLowerCase();
  const existing = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (existing) {
    if (existing.role !== 'admin') {
      await run('UPDATE users SET role = ? WHERE id = ?', ['admin', existing.id]);
    }
    return;
  }
  const id = uid('u-');
  // Em prod, exige ADMIN_PASSWORD do env. Em dev, gera uma senha aleatória e loga.
  const isProd = process.env.VERCEL || process.env.NODE_ENV === 'production';
  const password = process.env.ADMIN_PASSWORD || (isProd ? null : `dev-${randomToken(8)}`);

  if (isProd && (!password || password.length < 12)) {
    // HIGH-13 FIX: rejeita ADMIN_PASSWORD fraca em produção
    throw new Error('ADMIN_PASSWORD deve ter no mínimo 12 caracteres em produção. Defina antes de subir.');
  }
  if (!password) {
    throw new Error('ADMIN_PASSWORD não definido em produção. Defina antes de subir.');
  }
  await run(
    'INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    [id, email, 'Administrador', hashPassword(password), 'admin', nowISO(), nowISO()]
  );
  log.info(`admin criado: ${email}${isProd ? '' : ` (senha dev: ${password})`}`);
}

async function ensureSeedProducts() {
  const count = await get('SELECT COUNT(*) as c FROM products');
  if (count.c > 0) return;
  for (const p of SEED_PRODUCTS) {
    await run(
      `INSERT INTO products (id, name, tagline, description, price, old_price, category, version, badge, features, stock, video, image, download_url, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        p.id, p.name, p.tagline || '', p.description || '',
        p.price, p.oldPrice || null,
        p.category || '', p.version || '1.20+', p.badge || null,
        JSON.stringify(p.features || []),
        p.stock || 999,
        p.video || '', p.image || '', p.downloadUrl || '',
        nowISO()
      ]
    );
  }
  log.info(`${SEED_PRODUCTS.length} produtos semeados`);
}

// Sincroniza produtos ativos sem abacate_product_id com a AbacatePay.
// Idempotente: pula produtos que já têm sync. Falha silenciosa (não bloqueia bootstrap).
async function syncAbacateProducts() {
  if (!abacateEnabled()) {
    log.warn('AbacatePay desabilitado (sem ABACATE_API_KEY). Cartão indisponível até configurar.');
    return;
  }
  const products = await all(
    'SELECT * FROM products WHERE active = 1 AND (abacate_product_id IS NULL OR abacate_product_id = "")'
  );
  if (products.length === 0) {
    log.info('produtos já sincronizados com AbacatePay.');
    return;
  }
  let synced = 0;
  let failed = 0;
  for (const p of products) {
    try {
      const r = await createAbacateProduct({
        externalId: p.id,
        name: p.name,
        price: Number(p.price),
        description: p.description || p.tagline || p.name,
        imageUrl: p.image || ''
      });
      if (r && r.id) {
        await run('UPDATE products SET abacate_product_id = ? WHERE id = ?', [r.id, p.id]);
        synced++;
      } else {
        failed++;
        log.warn(`sync falhou para "${p.name}" (${p.id})`);
      }
    } catch (err) {
      failed++;
      log.warn(`sync erro para "${p.name}" (${p.id})`, { error: err.message });
    }
  }
  log.info(`AbacatePay: ${synced} sincronizados, ${failed} falharam de ${products.length}`);
}

export async function createApp() {
  const app = express();
  app.set('trust proxy', true);

  // Middleware de performance/monitoramento em todas as rotas
  app.use(performanceMiddleware);

  // Raw body para webhooks (precisamos do JSON bruto para validar HMAC)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/orders/webhook')) {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        req.rawBody = data;
        try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
        next();
      });
    } else {
      next();
    }
  });

  // Upload de JAR: aceita body raw (qualquer content-type) com limite de 32MB.
  // O Vercel Hobby limita payload em ~4.5MB; planos Pro/Enterprise permitem mais.
  app.use('/api/products/:id/upload', express.raw({ limit: '32mb', type: () => true }));

  app.use(express.json({ limit: '256kb' })); // reduzido de 1mb

  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.use(morgan('tiny'));
  }

  // Security headers em todas as rotas (incluindo static)
  app.use(securityHeaders);

  // CORS: restrito por padrão. NUNCA aceita '*' com credentials=true.
  const corsList = CORS_ORIGINS.filter(s => s !== '*'); // HIGH-16: '*' removido por segurança
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // mobile/curl sem origin
      if (corsList.length === 0) return cb(null, false); // sem origins permitidos
      if (corsList.includes(origin)) return cb(null, true);
      // Bloqueia silenciosamente
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 86400
  }));

  // Health check básico
  app.get('/api/health', (_req, res) => {
    const health = healthCheck();
    res.json({ ok: true, ...health });
  });

  // Métricas para admin (performance, erros, etc)
  app.get('/api/metrics', (_req, res) => {
    const metrics = getMetrics();
    res.json(metrics);
  });

  app.use('/api/diag', diagRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/affiliates', affiliatesRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/license', licenseRoutes);

  app.use((err, req, res, next) => {
    const log = createLogger('express');
    const isProd = process.env.VERCEL || process.env.NODE_ENV === 'production';
    log.error('erro não tratado', {
      path: req.path,
      method: req.method,
      error: err.message,
      stack: isProd ? undefined : err.stack,
      code: err.code
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro interno', ...(isProd ? {} : { detail: err.message, code: err.code }) });
    }
  });

  app.use(express.static(ROOT, {
    setHeaders: (res, filepath) => {
      if (filepath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    const file = safeStaticPath(req.path);
    if (!file) return res.status(404).send('Not found');
    if (existsSync(file) && !req.path.match(/\.\w+$/)) {
      return res.sendFile(join(ROOT, 'index.html'));
    }
    res.sendFile(file, err => {
      if (err) res.status(404).send('Not found');
    });
  });

  return app;
}

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 3000);
  bootstrap().then(async () => {
    const app = await createApp();
    app.listen(PORT, () => {
      log.info(`cafe-plugins API rodando em http://localhost:${PORT}`);
      log.info(`Admin: ${process.env.ADMIN_EMAIL || 'admin@cafeplugins.com'}`);
      log.info(`Frontend: http://localhost:${PORT}/`);
    });
  }).catch(err => {
    log.error('Bootstrap error', { error: err.message });
    process.exit(1);
  });
}
