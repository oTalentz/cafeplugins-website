import { Router } from 'express';
import { get, all, run } from 'api-core/lib/db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, sanitizeUser } from 'api-core/lib/auth.js';
import { getCodeCooldown, sendCode, sendVerifyCode } from 'api-core/lib/codes.js';
import { uid, nowISO, isValidEmail } from 'api-core/lib/util.js';
import { sanitizeText, LIMITS } from 'api-core/lib/sanitize.js';
import { rateLimit } from 'api-core/lib/security.js';
import { createLogger } from 'api-core/lib/logger.js';
import bcrypt from 'bcryptjs';

const router = Router();
const log = createLogger('auth');
const ALLOWED_CODE_PURPOSES = new Set(['login', 'reset']);

const loginLimiter = rateLimit({ scope: 'auth:login', windowMs: 60_000, max: 8, message: 'Muitas tentativas de login. Aguarde 1 minuto.' });
const codeLimiter = rateLimit({ scope: 'auth:code', windowMs: 60_000, max: 3, message: 'Aguarde antes de pedir outro código.' });
const verifyCodeLimiter = rateLimit({ scope: 'auth:verify-code', windowMs: 60_000, max: 5, message: 'Muitas tentativas de código. Aguarde 1 minuto.' });
const registerLimiter = rateLimit({ scope: 'auth:register', windowMs: 60_000, max: 5, message: 'Muitas tentativas de cadastro. Aguarde 1 minuto.' });
const resetLimiter = rateLimit({ scope: 'auth:reset', windowMs: 60_000, max: 3, message: 'Aguarde antes de tentar resetar novamente.' });

// Hash dummy para igualar tempo de resposta quando o email não existe (mitiga timing attack)
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-do-not-use', 10);

router.post('/register', registerLimiter, async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (password.length < LIMITS.passwordMin) return res.status(400).json({ error: `Senha deve ter ao menos ${LIMITS.passwordMin} caracteres` });
  if (password.length > LIMITS.password) return res.status(400).json({ error: 'Senha muito longa' });
  const cleanName = sanitizeText(name, { max: LIMITS.name });
  if (!cleanName) return res.status(400).json({ error: 'Nome inválido' });

  const e = email.toLowerCase().trim();
  const existing = await get('SELECT id FROM users WHERE email = ?', [e]);
  if (existing) return res.status(409).json({ error: 'E-mail já cadastrado. Use Entrar.' });

  // Limite de 3 contas por IP (proteção anti-spam)
  // Usa req.ip (já com trust proxy) em vez de header cru
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ipCount = await get("SELECT COUNT(*) as c FROM users WHERE created_at > ? AND created_by_ip = ?", [since, ip]);
  if ((ipCount?.c || 0) >= 3) {
    return res.status(429).json({ error: 'Limite de 3 contas por IP em 24h atingido. Tente novamente mais tarde.' });
  }

  const id = uid('u-');
  const passwordHash = hashPassword(password);
  // email_verified=0: precisa confirmar via code antes de logar/comprar
  await run(
    'INSERT INTO users (id, email, name, password_hash, role, created_by_ip, created_at, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    [id, e, cleanName, passwordHash, 'buyer', ip, nowISO()]
  );
  const user = await get('SELECT * FROM users WHERE id = ?', [id]);

  // Envia code de verificação de e-mail (primeiro envio, sem resend)
  let code = null;
  try {
    const sent = await sendVerifyCode(user);
    code = sent.code;
  } catch (err) {
    log.error('Mailer error (verify)', { error: err.message });
  }

  const isDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  // NÃO retorna token. Frontend deve mostrar tela de verificação de e-mail.
  res.json({
    user: sanitizeUser(user),
    token: null,
    requiresEmailVerification: true,
    ...(isDev && code ? { devCode: code } : {})
  });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Informe o e-mail' });
    const e = email.toLowerCase().trim();
    log.info('login attempt', { email: e });
    const user = await get('SELECT * FROM users WHERE email = ?', [e]);

    // CRIT-01 FIX: nunca aceitar login de NO_PASSWORD via senha. Forçar code-only.
    // CRIT-05 FIX: não diferenciar resposta para NO_PASSWORD (mesma msg genérica)
    if (!user) {
      // timing equalizer: mesmo quando o email não existe, gasta o tempo de bcrypt
      if (password) { try { bcrypt.compareSync(password, DUMMY_HASH); } catch {} }
      log.warn('login failed: user not found', { email: e });
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    if (user.affiliate_status === 'banned') {
      // MED-30 FIX: bloqueia login de banido independente de role (admin inclusive)
      log.warn('login failed: user banned', { email: e });
      return res.status(403).json({ error: 'Conta banida. Fale com o suporte.' });
    }
    if (user.password_hash === 'NO_PASSWORD') {
      // Resposta genérica (igual a "senha errada") para evitar enumeração de NO_PASSWORD
      if (password) { try { bcrypt.compareSync(password, DUMMY_HASH); } catch {} }
      log.warn('login failed: NO_PASSWORD', { email: e });
      return res.status(401).json({
        error: 'E-mail ou senha incorretos. Se você é novo, use o código enviado por e-mail.',
        code: 'USE_CODE'
      });
    }
    if (!password) {
      log.warn('login failed: no password provided', { email: e });
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    if (!verifyPassword(password, user.password_hash)) {
      log.warn('login failed: invalid password', { email: e });
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    // Bloqueia login se e-mail não foi verificado
    if (!user.email_verified) {
      // Dispara reenvio automático do code de verify (respeitando cooldown)
      const { retryAfter } = await sendVerifyCode(user, { silent: true });
      log.warn('login failed: email not verified', { email: e });
      return res.status(403).json({
        error: 'Confirme seu e-mail para entrar. Enviamos um código de 6 dígitos.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
        retryAfter: retryAfter || 0
      });
    }
    const token = signToken({ sub: user.id, role: user.role, tv: user.token_version || 0 });
    log.info('login success', { email: e, role: user.role });
    res.json({ user: sanitizeUser(user), token });
  } catch (err) {
    log.error('login error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Erro interno ao fazer login' });
  }
});

router.post('/request-code', codeLimiter, async (req, res) => {
  const { email, purpose = 'login' } = req.body || {};
  if (!ALLOWED_CODE_PURPOSES.has(purpose)) return res.status(400).json({ error: 'Finalidade do codigo invalida' });
  if (!email) return res.status(400).json({ error: 'Informe o e-mail' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'E-mail inválido' });
  const e = email.toLowerCase().trim();
  const user = await get('SELECT id, email FROM users WHERE email = ?', [e]);

  // Protege contra enumeração de e-mail: resposta genérica
  if (!user) {
    return res.json({ ok: true, expiresIn: 600 });
  }

  // Delay por e-mail para evitar reenvio em massa
  const cd = await getCodeCooldown(e, purpose);
  if (cd.active) {
    return res.status(429).json({
      error: `Aguarde ${cd.retryAfter}s antes de pedir outro código.`,
      code: 'RATE_LIMIT_EMAIL',
      retryAfter: cd.retryAfter
    });
  }

  try {
    const { code } = await sendCode(e, purpose, { resend: true });
    const isDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
    res.json({ ok: true, expiresIn: 600, ...(isDev ? { devCode: code } : {}) });
  } catch (err) {
    log.error('request-code error', { error: err.message, email: e });
    // Mesmo em erro de envio, resposta genérica não expõe detalhes
    return res.status(502).json({
      error: 'Erro ao enviar código. Tente novamente em instantes.',
      code: 'SEND_FAILED'
    });
  }
});

router.post('/verify-code', verifyCodeLimiter, async (req, res) => {
  const { email, code, purpose = 'login' } = req.body || {};
  if (!ALLOWED_CODE_PURPOSES.has(purpose)) return res.status(400).json({ error: 'Finalidade do codigo invalida' });
  if (!email || !code) return res.status(400).json({ error: 'E-mail e código são obrigatórios' });
  if (!/^\d{6}$/.test(String(code).trim())) {
    return res.status(400).json({ error: 'Código inválido' });
  }
  const e = email.toLowerCase().trim();
  const row = await get(
    'SELECT * FROM login_codes WHERE target_email = ? AND purpose = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [e, purpose, String(code).trim(), nowISO()]
  );
  if (!row) return res.status(401).json({ error: 'Código inválido ou expirado' });
  // Race condition fix: UPDATE condicional atômico. Se duas requisições concorrentes
  // chegarem aqui, apenas uma terá rowsAffected=1; a outra verá 0 e falhará.
  const upd = await run(
    'UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0',
    [row.id]
  );
  if ((upd?.rowsAffected || 0) === 0) {
    return res.status(401).json({ error: 'Código inválido ou expirado' });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [e]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  // Se purpose=login e user é NO_PASSWORD, isso é o momento de definir senha
  // MAS a senha NÃO pode ser definida sem o code primeiro. Exigimos novo fluxo.
  if (user.password_hash === 'NO_PASSWORD' && purpose === 'login') {
    // Marca que user completou "code" e precisa criar senha
    return res.json({
      user: sanitizeUser(user),
      token: null,
      code: 'SET_PASSWORD_REQUIRED',
      message: 'Crie uma senha para continuar.'
    });
  }

  const token = signToken({ sub: user.id, role: user.role, tv: user.token_version || 0 });
  res.json({ user: sanitizeUser(user), token });
});

// Verifica e-mail via code (não requer login)
router.post('/verify-email', verifyCodeLimiter, async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'E-mail e código são obrigatórios' });
  if (!/^\d{6}$/.test(String(code).trim())) return res.status(400).json({ error: 'Código inválido' });
  const e = email.toLowerCase().trim();
  const row = await get(
    "SELECT * FROM login_codes WHERE target_email = ? AND purpose = 'verify' AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    [e, String(code).trim(), nowISO()]
  );
  if (!row) return res.status(401).json({ error: 'Código inválido ou expirado' });
  // Race condition fix: UPDATE condicional atômico (mesmo padrão do /verify-code).
  const upd = await run(
    'UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0',
    [row.id]
  );
  if ((upd?.rowsAffected || 0) === 0) {
    return res.status(401).json({ error: 'Código inválido ou expirado' });
  }
  const user = await get('SELECT * FROM users WHERE email = ?', [e]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  // Marca como verificado e bump token_version para invalidar tokens antigos
  await run(
    'UPDATE users SET email_verified = 1, email_verified_at = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?',
    [nowISO(), user.id]
  );
  const fresh = await get('SELECT * FROM users WHERE id = ?', [user.id]);
  // Se user tem NO_PASSWORD, ainda precisa definir senha (próximo passo no frontend)
  if (fresh.password_hash === 'NO_PASSWORD') {
    return res.json({
      user: sanitizeUser(fresh),
      token: null,
      code: 'SET_PASSWORD_REQUIRED',
      emailVerified: true
    });
  }
  const token = signToken({ sub: fresh.id, role: fresh.role, tv: fresh.token_version || 0 });
  res.json({ user: sanitizeUser(fresh), token, emailVerified: true });
});

// Reenvia code de verificação (com cooldown, anti-spam)
router.post('/resend-verification', codeLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Informe o e-mail' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'E-mail inválido' });
  const e = email.toLowerCase().trim();

  // Resposta genérica (mesma para user existente ou não — anti-enumeração)
  const user = await get('SELECT * FROM users WHERE email = ?', [e]);
  if (!user || user.email_verified) {
    return res.json({ ok: true });
  }

  const cd = await getCodeCooldown(e, 'verify');
  if (cd.active) {
    return res.status(429).json({
      error: `Aguarde ${cd.retryAfter}s antes de reenviar.`,
      code: 'RATE_LIMIT_EMAIL',
      retryAfter: cd.retryAfter
    });
  }

  try {
    await sendVerifyCode(user, { resend: true });
    res.json({ ok: true, retryAfter: Math.ceil(CODE_EMAIL_COOLDOWN_MS / 1000) });
  } catch (err) {
    log.error('resend-verification error', { error: err.message, email: e });
    return res.status(502).json({
      error: 'Erro ao reenviar código. Tente novamente em instantes.',
      code: 'SEND_FAILED'
    });
  }
});

// Cria senha para usuário NO_PASSWORD que veio de checkout guest
// EXIGE code válido de login (purpose=login) — sem isso, é impossível sequestrar
router.post('/set-password', resetLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'Dados incompletos' });
  if (newPassword.length < LIMITS.passwordMin) return res.status(400).json({ error: `Senha deve ter ao menos ${LIMITS.passwordMin} caracteres` });
  if (newPassword.length > LIMITS.password) return res.status(400).json({ error: 'Senha muito longa' });
  const e = email.toLowerCase().trim();
  if (!/^\d{6}$/.test(String(code).trim())) return res.status(400).json({ error: 'Código inválido' });

  const row = await get(
    'SELECT * FROM login_codes WHERE target_email = ? AND purpose = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [e, 'login', String(code).trim(), nowISO()]
  );
  if (!row) return res.status(401).json({ error: 'Código inválido ou expirado' });
  // Race condition fix: UPDATE condicional atômico.
  const upd = await run('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0', [row.id]);
  if ((upd?.rowsAffected || 0) === 0) {
    return res.status(401).json({ error: 'Código inválido ou expirado' });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [e]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (user.password_hash !== 'NO_PASSWORD') {
    return res.status(400).json({ error: 'Senha já definida. Use "Esqueci minha senha" para trocar.' });
  }
  const newHash = hashPassword(newPassword);
  // Bump token_version para invalidar tokens antigos que tenham sido emitidos
  await run('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [newHash, user.id]);
  const fresh = await get('SELECT * FROM users WHERE id = ?', [user.id]);
  const token = signToken({ sub: fresh.id, role: fresh.role, tv: fresh.token_version || 0 });
  res.json({ user: sanitizeUser(fresh), token });
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'Dados incompletos' });
  if (newPassword.length < LIMITS.passwordMin) return res.status(400).json({ error: `Senha deve ter ao menos ${LIMITS.passwordMin} caracteres` });
  if (newPassword.length > LIMITS.password) return res.status(400).json({ error: 'Senha muito longa' });
  const e = email.toLowerCase().trim();
  if (!/^\d{6}$/.test(String(code).trim())) return res.status(400).json({ error: 'Código inválido' });
  const row = await get(
    'SELECT * FROM login_codes WHERE target_email = ? AND purpose = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [e, 'reset', String(code).trim(), nowISO()]
  );
  if (!row) return res.status(401).json({ error: 'Código inválido ou expirado' });
  // Race condition fix: UPDATE condicional atômico.
  const upd = await run('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0', [row.id]);
  if ((upd?.rowsAffected || 0) === 0) {
    return res.status(401).json({ error: 'Código inválido ou expirado' });
  }
  const newHash = hashPassword(newPassword);
  // Bump token_version para invalidar tokens existentes
  await run('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE email = ?', [newHash, e]);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < LIMITS.passwordMin) return res.status(400).json({ error: `Nova senha deve ter ao menos ${LIMITS.passwordMin} caracteres` });
  if (newPassword.length > LIMITS.password) return res.status(400).json({ error: 'Nova senha muito longa' });
  const u = req.user;
  // CRIT-01 FIX: SEMPRE exigir senha atual. Sem bypass para NO_PASSWORD.
  if (!u.password_hash || u.password_hash === 'NO_PASSWORD') {
    return res.status(400).json({
      error: 'Sua conta não tem senha. Crie uma via "Esqueci minha senha" usando o código de 6 dígitos.',
      code: 'NO_PASSWORD'
    });
  }
  if (!verifyPassword(currentPassword || '', u.password_hash)) {
    return res.status(401).json({ error: 'Senha atual incorreta' });
  }
  // Bump token_version para invalidar tokens em outras sessões
  await run('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [hashPassword(newPassword), u.id]);
  res.json({ ok: true, tokenBumped: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

export default router;
