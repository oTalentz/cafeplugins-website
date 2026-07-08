// =====================================================
//  Códigos de e-mail (login/reset/verify) com cooldown
//  por e-mail para conter abuso de reenvio/spam.
// =====================================================

import { get, run } from './db.js';
import { sendMail, loginCodeEmail, verifyEmail as verifyEmailTpl } from './mailer.js';
import { uid, loginCode6, nowISO } from './util.js';
import { createLogger } from './logger.js';

const log = createLogger('codes');

const _cooldownSeconds = Number(process.env.EMAIL_CODE_COOLDOWN_SECONDS);
export const CODE_EMAIL_COOLDOWN_MS = (
  Number.isFinite(_cooldownSeconds) && _cooldownSeconds > 0
    ? _cooldownSeconds
    : 60
) * 1000;

export async function getCodeCooldown(email, purpose) {
  const recent = await get(
    'SELECT created_at FROM login_codes WHERE target_email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
    [email, purpose]
  );
  if (!recent) return { active: false, retryAfter: 0 };
  const ageMs = Date.now() - new Date(recent.created_at).getTime();
  const remaining = CODE_EMAIL_COOLDOWN_MS - ageMs;
  if (remaining > 0) return { active: true, retryAfter: Math.ceil(remaining / 1000) };
  return { active: false, retryAfter: 0 };
}

// Envia um novo código respeitando o cooldown.
// - resend=true => se estiver em cooldown, lança erro com retryAfter.
// - silent=true => se estiver em cooldown, não envia e retorna { sent: false, retryAfter }.
// Usado no login (reenvio automático) e no checkout de guest.
export async function sendCode(email, purpose, { resend = false, silent = false } = {}) {
  const cd = await getCodeCooldown(email, purpose);
  if (cd.active) {
    if (resend) {
      const err = new Error(`Aguarde ${cd.retryAfter}s antes de reenviar.`);
      err.code = 'RATE_LIMIT_EMAIL';
      err.status = 429;
      err.retryAfter = cd.retryAfter;
      throw err;
    }
    if (silent) return { sent: false, retryAfter: cd.retryAfter, code: null };
  }
  const code = loginCode6();
  const codeId = uid('lc-');
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await run(
    'INSERT INTO login_codes (id, target_type, target_email, code, purpose, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [codeId, 'user', email, code, purpose, expires, nowISO()]
  );
  const tpl = purpose === 'verify'
    ? verifyEmailTpl({ code, email })
    : loginCodeEmail({ code, email, purpose });
  await sendMail({ to: email, ...tpl });
  return { sent: true, retryAfter: 0, code };
}

// Wrapper específico para verificação de e-mail (registro, login, checkout guest)
export async function sendVerifyCode(user, opts = {}) {
  return sendCode(user.email, 'verify', opts);
}
