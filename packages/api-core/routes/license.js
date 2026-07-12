import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { get, all, run } from 'api-core/lib/db.js';
import { createLogger } from 'api-core/lib/logger.js';
import { sanitizeIdentifier, sanitizeText, LIMITS } from 'api-core/lib/sanitize.js';
import { requireAdmin } from 'api-core/lib/auth.js';
import { uid, nowISO } from 'api-core/lib/util.js';
import { rateLimit, timingSafeEqual } from 'api-core/lib/security.js';

const router = Router();
const log = createLogger('license');

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const LICENSE_TOKEN_TTL = process.env.LICENSE_TOKEN_TTL || '7d';
const LICENSE_LIMIT = Math.max(1, Number(process.env.LICENSE_ACTIVATION_LIMIT || 3));

function hasItem(order, pluginId) {
  try {
    const items = JSON.parse(order.items || '[]');
    return Array.isArray(items) && items.some(i => i && i.id === pluginId);
  } catch { return false; }
}

function signLicense(payload) {
  if (!LICENSE_PRIVATE_KEY) throw new Error('LICENSE_PRIVATE_KEY não configurado');
  return jwt.sign(payload, LICENSE_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: LICENSE_TOKEN_TTL,
    issuer: 'cafe-plugins',
    audience: payload.pluginId
  });
}

// Verifica se a licença permite rodar o plugin neste servidor.
// Resposta é um JWT assinado (RS256) com claims licenseKey, pluginId e serverId,
// que o SDK Java valida offline durante o ciclo de vida do plugin.
router.post('/verify', rateLimit({ scope: 'license:verify', windowMs: 60_000, max: 30 }), async (req, res) => {
  const { licenseKey, pluginId, serverId } = req.body || {};
  if (!licenseKey || !pluginId || !serverId) {
    return res.status(400).json({ valid: false, code: 'MISSING_FIELDS', error: 'licenseKey, pluginId e serverId são obrigatórios' });
  }

  const cleanLicenseKey = sanitizeText(String(licenseKey), { max: 32 });
  const cleanPluginId = sanitizeIdentifier(String(pluginId), { max: 64 });
  const cleanServerId = sanitizeText(String(serverId), { max: 128 });
  if (!cleanLicenseKey || !cleanPluginId || !cleanServerId) {
    return res.status(400).json({ valid: false, code: 'INVALID_FIELDS', error: 'Campos inválidos' });
  }

  try {
    const order = await get('SELECT * FROM orders WHERE license_key = ? AND status = ?', [cleanLicenseKey, 'pago']);
    if (!order) {
      return res.status(403).json({ valid: false, code: 'LICENSE_NOT_FOUND', error: 'Licença não encontrada ou pagamento não confirmado' });
    }
    if (!hasItem(order, cleanPluginId)) {
      return res.status(403).json({ valid: false, code: 'PLUGIN_NOT_OWNED', error: 'Licença não cobre este plugin' });
    }

    const product = await get('SELECT id FROM products WHERE id = ? AND active = 1', [cleanPluginId]);
    if (!product) {
      return res.status(403).json({ valid: false, code: 'PLUGIN_NOT_FOUND', error: 'Plugin não existe ou está inativo' });
    }

    const existing = await all(
      'SELECT * FROM activations WHERE license_key = ? AND plugin_id = ? AND revoked = 0 ORDER BY last_seen DESC',
      [cleanLicenseKey, cleanPluginId]
    );

    const activeForServer = existing.find(a => timingSafeEqual(a.server_id || '', cleanServerId));
    if (activeForServer) {
      await run('UPDATE activations SET last_seen = ? WHERE id = ?', [nowISO(), activeForServer.id]);
      const token = signLicense({
        licenseKey: cleanLicenseKey,
        pluginId: cleanPluginId,
        serverId: cleanServerId,
        buyer: order.buyer_email
      });
      return res.json({ valid: true, token, expiresIn: LICENSE_TOKEN_TTL });
    }

    if (existing.length >= LICENSE_LIMIT) {
      return res.status(403).json({
        valid: false,
        code: 'ACTIVATION_LIMIT_REACHED',
        error: 'Limite de ativações atingido. Revogue no painel ou entre em contato.',
        activeServers: existing.map(a => ({ firstSeen: a.first_seen, lastSeen: a.last_seen }))
      });
    }

    const id = uid('act-');
    const ip = sanitizeText(String(req.headers['x-forwarded-for'] || req.ip || ''), { max: 64 });
    const ua = sanitizeText(String(req.headers['user-agent'] || ''), { max: 250 });
    const now = nowISO();
    await run(
      `INSERT INTO activations (id, license_key, plugin_id, server_id, ip, user_agent, first_seen, last_seen, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, cleanLicenseKey, cleanPluginId, cleanServerId, ip, ua, now, now, now]
    );

    const token = signLicense({
      licenseKey: cleanLicenseKey,
      pluginId: cleanPluginId,
      serverId: cleanServerId,
      buyer: order.buyer_email
    });
    return res.json({ valid: true, token, expiresIn: LICENSE_TOKEN_TTL });
  } catch (e) {
    log.error('erro no license verify', { error: e.message });
    return res.status(500).json({ valid: false, code: 'INTERNAL_ERROR', error: 'Erro interno na validação de licença' });
  }
});

// Admin: lista ativações (opcionalmente filtradas por plugin ou licença)
router.get('/activations', requireAdmin, async (req, res) => {
  const { pluginId, licenseKey } = req.query || {};
  let sql = 'SELECT * FROM activations WHERE 1=1';
  const args = [];
  if (pluginId) {
    sql += ' AND plugin_id = ?';
    args.push(sanitizeIdentifier(String(pluginId), { max: 64 }));
  }
  if (licenseKey) {
    sql += ' AND license_key = ?';
    args.push(sanitizeText(String(licenseKey), { max: 32 }));
  }
  sql += ' ORDER BY last_seen DESC LIMIT 500';
  const list = await all(sql, args);
  res.json({ activations: list });
});

// Admin: revoga uma ativação específica (libera o slot de licença)
router.post('/activations/:id/revoke', requireAdmin, async (req, res) => {
  const id = sanitizeIdentifier(String(req.params.id), { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  const act = await get('SELECT * FROM activations WHERE id = ?', [id]);
  if (!act) return res.status(404).json({ error: 'Ativação não encontrada' });

  await run('UPDATE activations SET revoked = 1, revoked_at = ? WHERE id = ?', [nowISO(), id]);
  log.info('ativação revogada', { id, licenseKey: act.license_key, pluginId: act.plugin_id });
  res.json({ ok: true });
});

export default router;
