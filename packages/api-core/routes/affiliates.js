import { Router } from 'express';
import { get, all, run } from 'api-core/lib/db.js';
import { requireAuth, requireAdmin } from 'api-core/lib/auth.js';
import { uid, nowISO, generateAffCode, todayISO } from 'api-core/lib/util.js';
import { sanitizePixKey, sanitizeText, LIMITS } from 'api-core/lib/sanitize.js';
import { rateLimit } from 'api-core/lib/security.js';
import { GATEWAY_FEE_FIXED, TAX_RATE, AFFILIATE_NET_COMMISSION, MIN_PAYOUT, MAX_MANUAL_COMMISSION } from 'api-core/lib/config.js';
import { auditLog } from 'api-core/lib/audit.js';

const router = Router();

const becomeLimiter = rateLimit({ scope: 'aff:become', windowMs: 60_000, max: 5, message: 'Muitas tentativas. Aguarde 1 minuto.' });
const clickLimiter = rateLimit({ scope: 'aff:click', windowMs: 60_000, max: 30, message: 'Muitos registros. Tente novamente.' });
const payoutLimiter = rateLimit({ scope: 'aff:payout', windowMs: 60_000, max: 3, message: 'Muitas solicitações de saque. Aguarde.' });

// Ativa conta de afiliado para o usuário logado
router.post('/become', becomeLimiter, requireAuth, async (req, res) => {
  const u = req.user;
  if (u.is_affiliate) return res.status(400).json({ error: 'Você já é afiliado' });
  if (u.role === 'admin') return res.status(400).json({ error: 'Admin não pode ser afiliado' });

  // Gera código único (até 10 tentativas)
  let code;
  let codeOk = false;
  for (let i = 0; i < 10; i++) {
    code = generateAffCode(u.name);
    const existing = await get('SELECT 1 FROM users WHERE affiliate_code = ?', [code]);
    if (!existing) { codeOk = true; break; }
  }
  if (!codeOk) {
    return res.status(500).json({ error: 'Não foi possível gerar um código único. Tente novamente.' });
  }
  await run(
    'UPDATE users SET is_affiliate = 1, affiliate_code = ?, affiliate_rate = 25, affiliate_status = ? WHERE id = ?',
    [code, 'active', u.id]
  );
  const updated = await get('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json({ affiliate: serializeAff(updated) });
});

// Stats do afiliado logado
router.get('/me/stats', requireAuth, async (req, res) => {
  if (!req.user.is_affiliate) return res.status(400).json({ error: 'Você não é afiliado' });
  const stats = JSON.parse(req.user.daily_stats || '{}');
  const last30 = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last30[key] = stats[key] || { clicks: 0, sales: 0, earned: 0 };
  }
  // Totais do mês atual + últimos 30 dias
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  let monthClicks = 0, monthSales = 0, monthEarned = 0;
  for (const [k, v] of Object.entries(stats)) {
    if (k >= monthStart) {
      monthClicks += Number(v.clicks || 0);
      monthSales += Number(v.sales || 0);
      monthEarned += Number(v.earned || 0);
    }
  }
  const orders = await all('SELECT * FROM orders WHERE affiliate_code = ? ORDER BY created_at DESC LIMIT 20', [req.user.affiliate_code]);
  const payouts = await all('SELECT * FROM payouts WHERE affiliate_id = ? ORDER BY requested_at DESC', [req.user.id]);
  const pending = +(Number(req.user.total_earned || 0) - Number(req.user.paid_out || 0)).toFixed(2);
  const conversion = Number(req.user.clicks || 0) > 0
    ? +((Number(req.user.total_sales || 0) / Number(req.user.clicks || 0)) * 100).toFixed(1)
    : 0;
  res.json({
    affiliate: serializeAff(req.user),
    dailyStats: last30,
    month: { clicks: monthClicks, sales: monthSales, earned: +monthEarned.toFixed(2) },
    pending,
    conversion,
    recentOrders: orders.map(serializeAffiliateOrder),
    payouts,
    // Constantes úteis para o painel exibir a fórmula
    fees: {
      gatewayFeeFixed: GATEWAY_FEE_FIXED,
      taxRate: TAX_RATE,
      netCommission: AFFILIATE_NET_COMMISSION
    }
  });
});

// Solicita payout
router.post('/payouts', payoutLimiter, requireAuth, async (req, res) => {
  if (!req.user.is_affiliate) return res.status(400).json({ error: 'Você não é afiliado' });
  if (req.user.affiliate_status !== 'active') return res.status(403).json({ error: 'Sua conta de afiliado não está ativa' });
  const { pixKey, pixHolder } = req.body || {};
  const pending = +(Number(req.user.total_earned || 0) - Number(req.user.paid_out || 0)).toFixed(2);
  if (pending <= 0) return res.status(400).json({ error: 'Sem saldo a receber' });
  // Mínimo de saque (configurável via env MIN_PAYOUT; default R$ 10 para evitar tx PIX caras em saques pequenos)
  if (pending < MIN_PAYOUT) {
    return res.status(400).json({ error: `Mínimo para saque é R$ ${MIN_PAYOUT.toFixed(2)}. Você tem R$ ${pending.toFixed(2)} a receber.` });
  }
  // Verifica se já tem payout pendente
  const existingPayout = await get("SELECT id FROM payouts WHERE affiliate_id = ? AND status = 'pendente'", [req.user.id]);
  if (existingPayout) return res.status(409).json({ error: 'Você já tem uma solicitação de saque pendente' });

  // PIX key do afiliado (pode atualizar aqui também)
  const finalPixKey = sanitizePixKey(String(pixKey || req.user.pix_key || ''));
  const finalPixHolder = sanitizeText(String(pixHolder || req.user.pix_holder || ''), { max: 200 });
  if (!finalPixKey) return res.status(400).json({ error: 'Informe sua chave PIX para receber o saque' });

  const id = uid('po-');
  // Race condition fix: INSERT condicional atômico. Se duas requisições concorrentes
  // passarem pelo SELECT acima, apenas uma terá rowsAffected=1; a outra verá 0 e falhará.
  const ins = await run(
    `INSERT INTO payouts (id, affiliate_id, affiliate_code, amount, method, pix_key, pix_holder, status, note, requested_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'pendente', '', ? WHERE NOT EXISTS (
       SELECT 1 FROM payouts WHERE affiliate_id = ? AND status = 'pendente'
     )`,
    [id, req.user.id, req.user.affiliate_code, pending, 'Pix', finalPixKey, finalPixHolder, nowISO(), req.user.id]
  );
  if ((ins?.rowsAffected || 0) === 0) {
    return res.status(409).json({ error: 'Você já tem uma solicitação de saque pendente' });
  }
  // Salva a chave PIX no user também
  await run('UPDATE users SET pix_key = ?, pix_holder = ? WHERE id = ?', [finalPixKey, finalPixHolder, req.user.id]);
  const created = await get('SELECT * FROM payouts WHERE id = ?', [id]);
  res.json({ payout: created });
});

// Afiliado atualiza sua própria chave PIX
router.put('/me/pix', requireAuth, async (req, res) => {
  if (!req.user.is_affiliate) return res.status(400).json({ error: 'Você não é afiliado' });
  const { pixKey, pixHolder } = req.body || {};
  const finalPixKey = sanitizePixKey(String(pixKey || ''));
  const finalPixHolder = sanitizeText(String(pixHolder || ''), { max: 200 });
  if (!finalPixKey) return res.status(400).json({ error: 'Informe sua chave PIX' });
  await run('UPDATE users SET pix_key = ?, pix_holder = ? WHERE id = ?', [finalPixKey, finalPixHolder, req.user.id]);
  res.json({ ok: true });
});

// Admin: listar todos os afiliados
router.get('/admin/all', requireAdmin, async (req, res) => {
  const affs = await all('SELECT * FROM users WHERE is_affiliate = 1 ORDER BY created_at DESC');
  res.json({ affiliates: affs.map(serializeAff) });
});

// Admin: banir/desbanir/pausar
router.post('/admin/:id/status', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const { status, reason } = req.body || {};
  if (!['active', 'paused', 'banned'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  if (reason && String(reason).length > 500) {
    return res.status(400).json({ error: 'Motivo muito longo' });
  }
  const u = await get('SELECT id FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: 'Afiliado não encontrado' });
  await run('UPDATE users SET affiliate_status = ?, ban_reason = ? WHERE id = ?', [status, sanitizeText(reason || '', { max: 500 }), id]);
  await auditLog({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action: 'affiliate_status_change',
    targetType: 'affiliate',
    targetId: id,
    details: { status, reason: reason || null },
    ip: req.ip
  });
  res.json({ ok: true });
});

// Admin: listar payouts
router.get('/admin/payouts', requireAdmin, async (req, res) => {
  const { status } = req.query;
  let rows;
  if (status && status !== 'all' && ['pendente', 'pago', 'rejeitado'].includes(status)) {
    rows = await all('SELECT p.*, u.name as affiliate_name, u.email as affiliate_email FROM payouts p JOIN users u ON u.id = p.affiliate_id WHERE p.status = ? ORDER BY p.requested_at DESC', [status]);
  } else {
    rows = await all('SELECT p.*, u.name as affiliate_name, u.email as affiliate_email FROM payouts p JOIN users u ON u.id = p.affiliate_id ORDER BY p.requested_at DESC');
  }
  res.json({ payouts: rows });
});

// Admin: aprovar payout
router.post('/admin/payouts/:id/approve', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const { method = 'Pix' } = req.body || {};
  const p = await get('SELECT * FROM payouts WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Payout não encontrado' });
  if (p.status !== 'pendente') return res.status(400).json({ error: `Payout já está ${p.status}` });
  // Verifica que o affiliate ainda está válido
  const aff = await get('SELECT * FROM users WHERE id = ?', [p.affiliate_id]);
  if (!aff) return res.status(404).json({ error: 'Afiliado não encontrado' });
  await run('UPDATE payouts SET status = ?, method = ?, processed_at = ? WHERE id = ?', ['pago', String(method).slice(0, 30), nowISO(), id]);
  await run('UPDATE users SET paid_out = paid_out + ? WHERE id = ?', [Number(p.amount), p.affiliate_id]);
  res.json({ ok: true });
});

// Admin: rejeitar payout
router.post('/admin/payouts/:id/reject', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const { reason = '' } = req.body || {};
  const p = await get('SELECT * FROM payouts WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Payout não encontrado' });
  if (p.status !== 'pendente') return res.status(400).json({ error: `Payout já está ${p.status}` });
  await run('UPDATE payouts SET status = ?, method = ?, processed_at = ? WHERE id = ?', ['rejeitado', sanitizeText(String(reason), { max: 500 }), nowISO(), id]);
  res.json({ ok: true });
});

// Admin: excluir payout
router.delete('/admin/payouts/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const p = await get('SELECT * FROM payouts WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Payout não encontrado' });
  await run('DELETE FROM payouts WHERE id = ?', [id]);
  res.json({ ok: true });
});

// Admin: comissão manual
router.post('/admin/:id/manual-commission', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  const { amount, note } = req.body || {};
  const amt = Math.round(Number(amount) * 100) / 100; // MED-27 FIX: arredondar para 2 casas
  if (!isFinite(amt) || amt <= 0 || amt > MAX_MANUAL_COMMISSION) return res.status(400).json({ error: `Valor inválido. Deve ser > 0 e <= ${MAX_MANUAL_COMMISSION}` });
  const u = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ error: 'Afiliado não encontrado' });
  if (!u.is_affiliate) return res.status(400).json({ error: 'Usuário não é afiliado' });
  if (u.affiliate_status === 'banned') return res.status(400).json({ error: 'Afiliado banido não pode receber comissão' }); // LOW-14
  await run('UPDATE users SET total_earned = total_earned + ? WHERE id = ?', [amt, id]);
  // MED-05 FIX: salvar nota de auditoria (futura migração criará tabela manual_commissions;
  // por ora, logamos). Garante rastreabilidade.
  console.log(`[audit] admin ${req.user.email} adicionou R$${amt} ao afiliado ${u.email}${note ? ' nota: ' + String(note).slice(0, 200) : ''}`);
  res.json({ ok: true });
});

// Lookup público do afiliado por código (usado pelo frontend para validar ?ref=CODE)
// Retorna apenas dados não-sensíveis. Não requer auth.
router.get('/lookup', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase().slice(0, 32);
  if (!code || !/^[A-Z0-9]+$/.test(code)) {
    return res.status(400).json({ error: 'code inválido' });
  }
  const aff = await get(
    'SELECT id, name, affiliate_code, affiliate_rate, affiliate_status FROM users WHERE affiliate_code = ? AND is_affiliate = 1',
    [code]
  );
  if (!aff || aff.affiliate_status !== 'active') {
    return res.status(404).json({ error: 'Código inválido ou afiliado inativo' });
  }
  res.json({
    id: aff.id,
    name: aff.name,
    code: aff.affiliate_code,
    rate: Number(aff.affiliate_rate || 25),
    status: aff.affiliate_status,
    // Constantes de taxa para o frontend mostrar no banner "Comissão calculada sobre o líquido"
    fees: {
      gatewayFeeFixed: GATEWAY_FEE_FIXED,
      taxRate: TAX_RATE,
      netCommission: AFFILIATE_NET_COMMISSION
    }
  });
});

// Registra click de afiliado (chamado pelo data.js quando cliente chega via ?ref=)
router.post('/click', clickLimiter, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'code obrigatório' });
    const c = code.trim().toUpperCase().slice(0, 32);
    if (!/^[A-Z0-9]+$/.test(c)) return res.status(400).json({ error: 'code inválido' });
    const aff = await get("SELECT id FROM users WHERE affiliate_code = ? AND affiliate_status = 'active'", [c]);
    if (!aff) return res.status(200).json({ ok: false });
    // Dedup: 1 click por IP+code+24h para não inflar
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ip = String(req.ip || '').slice(0, 64) || 'unknown';
    const recent = await get(
      'SELECT id FROM clicks WHERE affiliate_code = ? AND ip = ? AND created_at > ? LIMIT 1',
      [c, ip, since]
    );
    if (recent) return res.json({ ok: true, dedup: true });
    const id = uid('clk-');
    await run(
      'INSERT INTO clicks (id, affiliate_code, ip, user_agent, referrer, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, c, ip, (req.headers['user-agent'] || '').slice(0, 200), (req.headers['referer'] || '').slice(0, 500), nowISO()]
    );
    // Incrementa contador total + atualiza daily_stats.clicks para o dia
    const today = todayISO();
    const affUser = await get('SELECT daily_stats FROM users WHERE id = ?', [aff.id]);
    const dailyStats = safeJSON(affUser?.daily_stats, {});
    dailyStats[today] = dailyStats[today] || { clicks: 0, sales: 0, earned: 0 };
    dailyStats[today].clicks = (dailyStats[today].clicks || 0) + 1;
    await run(
      'UPDATE users SET clicks = clicks + 1, daily_stats = ? WHERE id = ?',
      [JSON.stringify(dailyStats), aff.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[affiliates/click] error:', err.message);
    // Resposta silenciosa (não bloqueia o cliente) mas loga o erro
    res.status(200).json({ ok: false, error: 'click_failed' });
  }
});

function serializeAff(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return {
    ...rest,
    is_affiliate: Boolean(u.is_affiliate),
    clicks: Number(u.clicks || 0),
    conversions: Number(u.conversions || 0),
    total_sales: Number(u.total_sales || 0),
    total_earned: Number(u.total_earned || 0),
    paid_out: Number(u.paid_out || 0),
    affiliate_rate: Number(u.affiliate_rate || 25),
    daily_stats: safeJSON(u.daily_stats, {}),
    pix_key: u.pix_key || '',
    pix_holder: u.pix_holder || ''
  };
}

// Serializa pedido para o painel do afiliado (inclui breakdown de taxas)
function serializeAffiliateOrder(o) {
  if (!o) return null;
  let items = [];
  try { items = JSON.parse(o.items || '[]'); } catch {}
  const subtotal = Number(o.subtotal || 0);
  const gatewayFee = Number(o.gateway_fee || 0);
  const netAmount = Number(o.net_amount || 0);
  const commission = Number(o.commission || 0);
  const commissionRate = Number(o.commission_rate || 0);
  const effectiveNet = netAmount > 0 ? netAmount : subtotal;
  return {
    id: o.id,
    buyer_name: o.buyer_name,
    buyer_email: o.buyer_email,
    items,
    subtotal,
    total: Number(o.total || 0),
    commission,
    status: o.status,
    created_at: o.created_at,
    breakdown: {
      subtotal,
      gatewayFee,
      netAmount: effectiveNet,
      commission,
      commissionRate,
      storeKeeps: +Math.max(0, subtotal - gatewayFee - commission).toFixed(2)
    }
  };
}

function safeJSON(s, fallback) {
  try { return JSON.parse(s || ''); } catch { return fallback; }
}

export default router;
