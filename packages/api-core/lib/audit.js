import { run, all } from 'api-core/lib/db.js';
import { uid, nowISO } from 'api-core/lib/util.js';
import { createLogger } from './logger.js';

const log = createLogger('audit');

export async function auditLog({ adminId, adminEmail, action, targetType, targetId, details, ip }) {
  const id = uid('audit-');
  await run(
    'INSERT INTO audit_log (id, admin_id, admin_email, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, adminId, adminEmail, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null, ip || null, nowISO()]
  );
  log.info('audit', { action, targetType, targetId, adminEmail });
}

export async function getAuditLogs(limit = 100, offset = 0) {
  return await all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
}
