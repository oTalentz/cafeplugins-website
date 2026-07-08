import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: join(__dirname, '..', '.env') });

import { createClient } from '@libsql/client';
import { createLogger } from './logger.js';

const log = createLogger('db');

let _db = null;
let _initPromise = null;
let _initialized = false;

function getClient() {
  if (_db) return _db;
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
    const err = new Error('TURSO_URL ou TURSO_TOKEN não configurados');
    err.code = 'ENV_MISSING';
    log.error('cliente Turso não pode ser criado (env missing)', {
      hasUrl: !!process.env.TURSO_URL,
      hasToken: !!process.env.TURSO_TOKEN
    });
    throw err;
  }
  log.info('criando cliente Turso', { url: process.env.TURSO_URL.replace(/:[^\/]*@/, ':***@') });
  try {
    _db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_TOKEN
    });
    log.info('cliente Turso criado com sucesso');
  } catch (err) {
    log.error('erro ao criar cliente Turso', { error: err.message, stack: err.stack });
    throw err;
  }
  return _db;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer',
  is_affiliate INTEGER NOT NULL DEFAULT 0,
  affiliate_code TEXT UNIQUE,
  affiliate_rate REAL DEFAULT 25,
  affiliate_status TEXT DEFAULT 'active',
  ban_reason TEXT,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  total_sales REAL DEFAULT 0,
  total_earned REAL DEFAULT 0,
  paid_out REAL DEFAULT 0,
  daily_stats TEXT,
  created_by_ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_affiliate_code ON users(affiliate_code);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  price REAL NOT NULL,
  old_price REAL,
  category TEXT,
  version TEXT,
  badge TEXT,
  features TEXT,
  stock INTEGER DEFAULT 999,
  video TEXT,
  image TEXT,
  download_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_email TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  user_id TEXT,
  affiliate_code TEXT,
  affiliate_id TEXT,
  commission REAL DEFAULT 0,
  subtotal REAL NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  payment_method TEXT,
  payment_id TEXT,
  pix_qr_code TEXT,
  pix_qr_image TEXT,
  items TEXT NOT NULL,
  license_key TEXT,
  download_token TEXT,
  downloads TEXT,
  paid_at TEXT,
  -- Breakdown de taxas (comissão LÍQUIDA)
  gateway_fee REAL DEFAULT 0,
  net_amount REAL DEFAULT 0,
  commission_rate REAL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_email ON orders(buyer_email);
CREATE INDEX IF NOT EXISTS idx_orders_affiliate_code ON orders(affiliate_code);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id ON orders(payment_id);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL,
  affiliate_code TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  note TEXT,
  requested_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_affiliate_id ON payouts(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

CREATE TABLE IF NOT EXISTS clicks (
  id TEXT PRIMARY KEY,
  affiliate_code TEXT NOT NULL,
  fingerprint TEXT,
  ip TEXT,
  user_agent TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_affiliate_code ON clicks(affiliate_code);
CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON clicks(created_at);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_target ON login_codes(target_email, target_type, purpose);

CREATE TABLE IF NOT EXISTS downloads_log (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_downloads_log_order_id ON downloads_log(order_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export async function initSchema() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const client = getClient();
    // Habilita enforcement de foreign keys (desativado por padrão no SQLite)
    await client.execute('PRAGMA foreign_keys = ON');
    const statements = SCHEMA_SQL
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(Boolean);
    log.info(`aplicando schema (${statements.length} statements)`);
    for (const stmt of statements) {
      try {
        await client.execute(stmt);
      } catch (e) {
        if (!/already exists/i.test(e.message || '')) {
          log.error('falha ao executar statement', { sql: stmt.slice(0, 60), error: e.message });
          throw e;
        }
      }
    }
    // Migrations: adicionar colunas novas se não existirem
    await runMigrations();
    _initialized = true;
    log.info('schema inicializado');
  })();
  return _initPromise;
}

const MIGRATIONS = [
  // [id, tabela, coluna, definicao]
  { id: 'pix_key_users', table: 'users', column: 'pix_key', def: 'TEXT' },
  { id: 'pix_holder_users', table: 'users', column: 'pix_holder', def: 'TEXT' },
  { id: 'pix_key_payouts', table: 'payouts', column: 'pix_key', def: 'TEXT' },
  { id: 'pix_holder_payouts', table: 'payouts', column: 'pix_holder', def: 'TEXT' },
  { id: 'created_by_ip_users', table: 'users', column: 'created_by_ip', def: 'TEXT' },
  // Comissão líquida: campos do breakdown armazenados em orders
  // (gateway_fee, net_amount, commission_rate) — order.commission é a comissão LÍQUIDA final.
  { id: 'gateway_fee_orders', table: 'orders', column: 'gateway_fee', def: 'REAL DEFAULT 0' },
  { id: 'net_amount_orders', table: 'orders', column: 'net_amount', def: 'REAL DEFAULT 0' },
  { id: 'commission_rate_orders', table: 'orders', column: 'commission_rate', def: 'REAL DEFAULT 0' },
  // HIGH-01 FIX: token_version para revogação de JWT (logout, troca de senha)
  { id: 'token_version_users', table: 'users', column: 'token_version', def: 'INTEGER DEFAULT 0' },
  // HIGH-11 FIX: token de download expira em 7 dias
  { id: 'download_expires_orders', table: 'orders', column: 'download_expires_at', def: 'TEXT' },
  // Verificação de e-mail obrigatória em primeiros acessos
  { id: 'email_verified_users', table: 'users', column: 'email_verified', def: 'INTEGER DEFAULT 0' },
  { id: 'email_verified_at_users', table: 'users', column: 'email_verified_at', def: 'TEXT' },
  // Lixeira temporária (soft-delete): deleted_at = ISO timestamp. Auto-exclui após 7 dias.
  { id: 'deleted_at_orders', table: 'orders', column: 'deleted_at', def: 'TEXT' },
  // AbacatePay product ID (para checkout com cartão v2)
  { id: 'abacate_product_id', table: 'products', column: 'abacate_product_id', def: 'TEXT' },
  // Telefone do comprador para antifraude (AbacatePay cartão)
  { id: 'buyer_cellphone_orders', table: 'orders', column: 'buyer_cellphone', def: 'TEXT' },
  { id: 'buyer_tax_id_orders', table: 'orders', column: 'buyer_tax_id', def: 'TEXT' },
  // Backfill: admins existentes são auto-confirmados (criados via bootstrap pelo owner)
  { id: 'backfill_admin_verified', table: 'users', column: 'noop', def: 'noop', post: async (db) => {
    // Marca todos os admins existentes como verificados (idempotente)
    try {
      const now = new Date().toISOString();
      await db.execute({ sql: "UPDATE users SET email_verified = 1, email_verified_at = COALESCE(email_verified_at, ?) WHERE role = 'admin' AND (email_verified IS NULL OR email_verified = 0)", args: [now] });
      log.info('backfill: admins marcados como email_verified=1');
    } catch (e) { log.warn('backfill admin verified skip:', e.message); }
  } }
];

async function runMigrations() {
  const client = getClient();
  for (const m of MIGRATIONS) {
    // Migration "post-only" (sem table/column): executa um hook de dados
    if (m.post) {
      try {
        log.info(`migration post: ${m.id}`);
        await m.post(client);
      } catch (e) {
        log.warn(`migration post skip ${m.id}: ${e.message}`);
      }
      continue;
    }
    try {
      // Tenta adicionar a coluna. Se já existir, SQLite/libSQL retorna erro
      // "duplicate column" e ignoramos.
      log.info(`migration: ensure ${m.table}.${m.column}`);
      await client.execute({ sql: `ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.def}`, args: [] });
      log.info(`migration: added ${m.table}.${m.column}`);
    } catch (e) {
      const msg = String(e.message || '');
      if (/duplicate column|already exists/i.test(msg)) {
        log.info(`migration: ${m.table}.${m.column} already exists`);
      } else {
        log.warn(`migration skip ${m.id}: ${msg}`);
      }
    }
  }
}

export async function get(sql, params = []) {
  const client = getClient();
  const r = await client.execute({ sql, args: params });
  return r.rows[0] || null;
}

export async function all(sql, params = []) {
  const client = getClient();
  const r = await client.execute({ sql, args: params });
  return r.rows;
}

export async function run(sql, params = []) {
  const client = getClient();
  const r = await client.execute({ sql, args: params });
  return { lastInsertRowid: Number(r.lastInsertRowid || 0), rowsAffected: r.rowsAffected };
}

export async function tx(fn) {
  const client = getClient();
  await client.execute('BEGIN');
  try {
    const result = await fn();
    await client.execute('COMMIT');
    return result;
  } catch (e) {
    await client.execute('ROLLBACK');
    throw e;
  }
}

export function isReady() {
  return _initialized;
}

export function envStatus() {
  return {
    url: !!process.env.TURSO_URL,
    token: !!process.env.TURSO_TOKEN,
    url_value: process.env.TURSO_URL ? process.env.TURSO_URL.replace(/:[^\/]*@/, ':***@') : null
  };
}
