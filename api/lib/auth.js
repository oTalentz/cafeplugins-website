import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { get } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('auth');

const RAW_SECRET = process.env.JWT_SECRET;
if (!RAW_SECRET || RAW_SECRET === 'change-me-in-production' || RAW_SECRET.length < 32) {
  // Bloqueia startup em prod se o secret for fraco/default.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    throw new Error('JWT_SECRET ausente ou fraco. Defina JWT_SECRET com pelo menos 32 caracteres aleatórios em produção.');
  }
  // LOW-04 FIX: em dev sem secret, gera um aleatório por processo (não fixa) para evitar tokens forjáveis
  if (!RAW_SECRET) {
    const rand = randomBytes(32).toString('hex');
    process.env.JWT_SECRET = rand;
    log.warn('JWT_SECRET não definido. Gerado aleatório para esta sessão (apenas dev).');
  }
}
const SECRET = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES || '24h'; // LOW-03: 24h em vez de 7d

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain, hash) {
  try { return bcrypt.compareSync(plain, hash); } catch { return false; }
}

export function signToken(payload) {
  return jwt.sign(payload, SECRET, {
    expiresIn: EXPIRES,
    issuer: 'cafe-plugins',
    audience: 'cafe-plugins-web',
    jwtid: randomUUID()
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET, {
      issuer: 'cafe-plugins',
      audience: 'cafe-plugins-web'
    });
  } catch { return null; }
}

export function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, token_version, ...rest } = u;
  return rest;
}

export async function getCurrentUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || !payload.sub) return null;
  const user = await get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!user) return null;
  // HIGH-01 FIX: token_version mismatch → token foi invalidado (logout, troca de senha)
  if (payload.tv != null && Number(user.token_version || 0) !== Number(payload.tv)) return null;
  return user;
}

export function requireAuth(req, res, next) {
  getCurrentUser(req).then(user => {
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    req.user = user;
    next();
  }).catch(next);
}

export function requireAdmin(req, res, next) {
  getCurrentUser(req).then(user => {
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admin' });
    req.user = user;
    next();
  }).catch(next);
}

export function optionalAuth(req, _res, next) {
  getCurrentUser(req).then(user => { req.user = user; next(); }).catch(() => next());
}
