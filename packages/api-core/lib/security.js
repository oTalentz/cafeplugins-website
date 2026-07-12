// =====================================================
//  Middlewares de segurança:
//  - rateLimit (Turso-backed, funciona em serverless multi-instância)
//  - securityHeaders (CSP, HSTS, X-Frame, etc)
//  - timingSafeEqual (constant-time compare para secrets)
// =====================================================

import { timingSafeEqual as _nativeTimingSafeEqual } from 'node:crypto';
import { run as dbRun, get as dbGet } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('security');

// Rate limit Turso-backed: funciona em serverless (multi-instância).
// Usa a tabela rate_limits (scope, ip, window_start, count).
// Fallback in-memory se DB não estiver pronto (cold start).
const _buckets = new Map();

function _key(scope, id) { return `${scope}|${id}`; }
function _now() { return Date.now(); }

export function rateLimit({ scope, windowMs = 60_000, max = 5, message = 'Muitas requisições. Tente novamente em instantes.' } = {}) {
  return async (req, res, next) => {
    try {
    const id = req.ip || req.headers['x-forwarded-for'] || 'anon';
    const key = _key(scope, id);
    const now = _now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;

    // Tenta usar Turso (distribuído). Se falhar, usa in-memory fallback.
    let count = 0;
    try {
      // UPSERT: incrementa count se a janela for a mesma, reseta se mudou.
      await dbRun(
        `INSERT INTO rate_limits (scope, ip, window_start, count, created_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(scope, ip) DO UPDATE SET
           count = CASE WHEN window_start = ? THEN count + 1 ELSE 1 END,
           window_start = CASE WHEN window_start = ? THEN window_start ELSE ? END`,
        [scope, id, windowStart, new Date(now).toISOString(),
         windowStart, windowStart, windowStart]
      );
      const row = await dbGet('SELECT count, window_start FROM rate_limits WHERE scope = ? AND ip = ?', [scope, id]);
      count = row ? Number(row.count) : 1;
    } catch (e) {
      // DB não pronto (cold start) — fallback in-memory
      const b = _buckets.get(key) || { count: 0, resetAt: now + windowMs };
      if (now > b.resetAt) { b.count = 0; b.resetAt = now + windowMs; }
      b.count += 1;
      _buckets.set(key, b);
      count = b.count;
    }

    const remaining = Math.max(0, max - count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(windowEnd / 1000)));
    if (count > max) {
      const retryAfter = Math.ceil((windowEnd - now) / 1000);
      return res.status(429).json({ error: message, retryAfter });
    }
    next();
    } catch (err) {
      log.warn('rateLimit error, allowing request', { error: err.message });
      next();
    }
  };
}

// Limpa buckets in-memory expirados (fallback apenas)
setInterval(() => {
  const now = _now();
  for (const [k, b] of _buckets) {
    if (now > b.resetAt + 300_000) _buckets.delete(k);
  }
}, 300_000).unref?.();

// Constant-time compare para secrets (usa implementação nativa do Node que
// não vaza informação via timing mesmo quando tamanhos diferem)
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Compara contra si mesmo para gastar o mesmo tempo, mas retorna false
    _nativeTimingSafeEqual(ab, ab);
    return false;
  }
  return _nativeTimingSafeEqual(ab, bb);
}

// Headers de segurança
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  // HSTS só faz sentido em HTTPS — Vercel já manda
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP: sem inline scripts/styles, só self + CDNs explícitos
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      // HIGH-15 FIX: removido 'unsafe-inline'. Estilos inline devem ser movidos para CSS files.
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      // LOW-19: permite YouTube embeds para vídeos de produtos
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "connect-src 'self' https://cafeplugins.com https://*.cafeplugins.com https://*.vercel.app https://api.abacatepay.com https://api.brevo.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
  next();
}
