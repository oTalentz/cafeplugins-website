import { Router } from 'express';
import { get, all, run } from 'api-core/lib/db.js';
import { requireAuth, requireAdmin, hashPassword, sanitizeUser } from 'api-core/lib/auth.js';
import { uid, nowISO, todayISO, isValidEmail, licenseKey, randomToken } from 'api-core/lib/util.js';
import { sanitizeIdentifier, sanitizeText as st } from 'api-core/lib/sanitize.js';
import { sendMail, orderPaidEmail } from 'api-core/lib/mailer.js';
import { calculateBreakdown } from 'api-core/lib/fees.js';
import { createAbacateProduct } from 'api-core/lib/payments.js';
import { auditLog, getAuditLogs } from 'api-core/lib/audit.js';

const router = Router();

const MIN_ADMINS = 1;

// Admin: stats do dashboard
router.get('/stats', requireAdmin, async (req, res) => {
  const orderStats = await all(
    "SELECT status, COUNT(*) as count, COALESCE(SUM(total), 0) as sum_total FROM orders GROUP BY status"
  );
  const productCount = await get("SELECT COUNT(*) as c FROM products WHERE active = 1");
  const buyerCount = await get("SELECT COUNT(*) as c FROM users WHERE role = 'buyer'");
  const affCount = await get("SELECT COUNT(*) as c FROM users WHERE is_affiliate = 1");

  let receita = 0, vendas = 0, pendentes = 0;
  for (const row of orderStats) {
    if (row.status === 'pago') { receita = Number(row.sum_total); vendas = Number(row.count); }
    if (row.status === 'pendente') { pendentes = Number(row.count); }
  }

  res.json({
    kpis: {
      receita: +receita.toFixed(2),
      vendas,
      plugins: productCount?.c || 0,
      pendentes,
      compradores: buyerCount?.c || 0,
      afiliados: affCount?.c || 0
    }
  });
});

// Admin: listar todos os usuários
router.get('/users', requireAdmin, async (req, res) => {
  const users = await all("SELECT id, email, name, role, is_affiliate, affiliate_code, affiliate_status, created_at FROM users ORDER BY created_at DESC");
  res.json({ users });
});

// Admin: detalhes do usuário (conta + pedidos + dados afiliados)
router.get('/users/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const user = await get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const email = (user.email || '').toLowerCase();
  const orders = await all(
    `SELECT * FROM orders WHERE (buyer_email IS NOT NULL AND LOWER(buyer_email) = LOWER(?)) OR user_id = ? ORDER BY created_at DESC`,
    [email, id]
  );
  const payouts = user.is_affiliate
    ? await all('SELECT * FROM payouts WHERE affiliate_id = ? ORDER BY requested_at DESC', [id])
    : [];
  const clicks = user.is_affiliate && user.affiliate_code
    ? await all('SELECT * FROM clicks WHERE affiliate_code = ? ORDER BY created_at DESC LIMIT 100', [user.affiliate_code])
    : [];
  const downloadsLog = await all(
    `SELECT d.* FROM downloads_log d JOIN orders o ON d.order_id = o.id WHERE LOWER(o.buyer_email) = LOWER(?) OR o.user_id = ? ORDER BY d.created_at DESC LIMIT 100`,
    [email, id]
  );

  res.json({
    user: sanitizeUser(user),
    orders: orders.map(serializeOrderForAdmin),
    payouts,
    clicks,
    downloadsLog
  });
});

function serializeOrderForAdmin(o) {
  if (!o) return null;
  let items = [], downloads = [];
  try { items = JSON.parse(o.items || '[]'); } catch {}
  try { downloads = JSON.parse(o.downloads || '[]'); } catch {}
  const subtotal = Number(o.subtotal || 0);
  const gatewayFee = Number(o.gateway_fee || 0);
  const netAmount = Number(o.net_amount || 0);
  const commission = Number(o.commission || 0);
  const commissionRate = Number(o.commission_rate || 0);
  const effectiveNet = netAmount > 0 ? netAmount : subtotal;
  return {
    ...o,
    items,
    downloads,
    paymentMethod: o.payment_method || 'pix',
    paymentId: o.payment_id || null,
    affiliateCode: o.affiliate_code || null,
    affiliateId: o.affiliate_id || null,
    userId: o.user_id || null,
    licenseKey: o.license_key || null,
    downloadToken: o.download_token || null,
    downloadExpiresAt: o.download_expires_at || null,
    buyerCellphone: o.buyer_cellphone || null,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    deletedAt: o.deleted_at,
    isPaid: o.status === 'pago',
    isTrashed: !!o.deleted_at,
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

// Admin: excluir usuário
//   - Bloqueia self-delete
//   - Bloqueia deletar o ÚLTIMO admin (lockout)
//   - Remove todos os dados associados: pedidos, pagamentos, cliques, downloads e códigos de login
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode deletar sua própria conta.' });
  const target = await get('SELECT id, role, email, affiliate_code FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.role === 'admin') {
    const otherAdmins = await all("SELECT id FROM users WHERE role = 'admin' AND id != ?", [id]);
    if (otherAdmins.length < MIN_ADMINS) {
      return res.status(400).json({ error: 'Não é possível deletar o último admin do sistema.' });
    }
  }

  // Cascade: remove todos os dados associados para manter integridade
  if (target.email || target.id) {
    // orders do user (cobre buyer_email e user_id)
    const userOrders = await all(
      'SELECT id FROM orders WHERE (buyer_email IS NOT NULL AND LOWER(buyer_email) = LOWER(?)) OR user_id = ?',
      [target.email || '', target.id]
    );
    const orderIds = userOrders.map(o => o.id);
    if (orderIds.length) {
      // logs de download referenciam pedidos
      await run(`DELETE FROM downloads_log WHERE order_id IN (${orderIds.map(() => '?').join(',')})`, orderIds);
    }
    await run(
      'DELETE FROM orders WHERE (buyer_email IS NOT NULL AND LOWER(buyer_email) = LOWER(?)) OR user_id = ?',
      [target.email || '', target.id]
    );
  }
  if (target.id) {
    // payouts do afiliado
    await run('DELETE FROM payouts WHERE affiliate_id = ?', [target.id]);
    // clicks do afiliado
    await run('DELETE FROM clicks WHERE affiliate_code IN (SELECT affiliate_code FROM users WHERE id = ?)', [target.id]);
    // códigos de login/verificação associados
    await run('DELETE FROM login_codes WHERE target_email = (SELECT email FROM users WHERE id = ?)', [target.id]);
  }
  // finalmente deleta o user
  await run('DELETE FROM users WHERE id = ?', [id]);
  await auditLog({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action: 'delete_user',
    targetType: 'user',
    targetId: id,
    details: { email: target.email, role: target.role },
    ip: req.ip
  });
  res.json({ ok: true });
});

// Admin: limpeza controlada — remove TUDO exceto emails protegidos.
// Útil para limpar dados de teste antes de lançar.
router.post('/cleanup', requireAdmin, async (req, res) => {
  const PROTECTED_EMAILS = [
    ...(process.env.PROTECTED_EMAILS || '').split(','),
    process.env.ADMIN_EMAIL || 'admin@cafeplugins.com'
  ]
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  // Safety: se por algum motivo PROTECTED_EMAILS ficar vazio (ex: ADMIN_EMAIL=''
  // setado explicitamente), a query SQL seria inválida (NOT IN ()) e poderia
  // deletar TODOS os usuários. Bloqueia defensivamente.
  if (PROTECTED_EMAILS.length === 0) {
    return res.status(400).json({ error: 'Nenhum e-mail protegido configurado. Defina ADMIN_EMAIL antes de executar cleanup.' });
  }

  try {
    // 1. Pega IDs dos users protegidos
    const protectedUsers = await all(
      `SELECT id, email FROM users WHERE LOWER(email) IN (${PROTECTED_EMAILS.map(() => '?').join(',')})`,
      PROTECTED_EMAILS
    );
    const protectedIds = protectedUsers.map(u => u.id);

    // 2. Deleta orders onde o buyer_email NÃO é dos protegidos
    //    (cobre: orders de qualquer user deletado E orders de guest checkout com email não protegido)
    const r1 = await run(
      `DELETE FROM orders WHERE LOWER(buyer_email) NOT IN (${PROTECTED_EMAILS.map(() => '?').join(',')})`,
      PROTECTED_EMAILS
    );

    // 3. Deleta payouts de afiliados que serão removidos
    const affToDelete = await all(
      `SELECT id FROM users WHERE is_affiliate = 1 AND id NOT IN (${protectedIds.length ? protectedIds.map(() => '?').join(',') : "''"})`,
      protectedIds.length ? protectedIds : ['__none__']
    );
    const affIds = affToDelete.map(a => a.id);
    if (affIds.length) {
      await run(`DELETE FROM payouts WHERE affiliate_id IN (${affIds.map(() => '?').join(',')})`, affIds);
      await run(`DELETE FROM clicks WHERE affiliate_code IN (SELECT affiliate_code FROM users WHERE id IN (${affIds.map(() => '?').join(',')}))`, affIds);
    }

    // 4. Deleta users não protegidos (exceto admins não protegidos só se houver +1 admin)
    const allAdmins = await all("SELECT id FROM users WHERE role = 'admin'");
    const nonProtectedAdmins = allAdmins.filter(a => !protectedIds.includes(a.id));
    const protectedAdmins = allAdmins.filter(a => protectedIds.includes(a.id));
    if (nonProtectedAdmins.length && protectedAdmins.length === 0) {
      // Bloqueia: iria remover o último admin protegido? Não — está protegendo os protegidos.
      // Mas se não há admin protegido, não pode deletar admins não protegidos (lockout).
      return res.status(400).json({ error: 'Não é possível remover todos os admins. Mantenha pelo menos 1 admin.' });
    }
    const r2 = await run(
      `DELETE FROM users WHERE LOWER(email) NOT IN (${PROTECTED_EMAILS.map(() => '?').join(',')})`,
      PROTECTED_EMAILS
    );

    res.json({
      ok: true,
      removed: {
        orders: r1.rowsAffected || 0,
        users: r2.rowsAffected || 0,
        affiliates: affIds.length
      },
      protected: {
        emails: PROTECTED_EMAILS,
        usersFound: protectedUsers.length
      }
    });
  } catch (e) {
    console.error('[admin/cleanup] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Admin: criar pedido manual (com ou sem afiliado, pago ou pendente)
router.post('/orders', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const name = st(String(b.buyer_name || ''), { max: 80 });
  const email = String(b.buyer_email || '').toLowerCase().trim();
  if (!name) return res.status(400).json({ error: 'buyer_name obrigatório' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'buyer_email inválido' });
  if (name.length < 2) return res.status(400).json({ error: 'buyer_name muito curto' });
  const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  if (items.length === 0) return res.status(400).json({ error: 'items obrigatório' });
  if (items.length > 50) return res.status(400).json({ error: 'Máximo 50 itens por pedido' });
  // Resolve items com preço do banco
  const resolved = [];
  for (const it of items) {
    const productId = sanitizeIdentifier(it && it.id, { max: 64 });
    if (!productId) return res.status(400).json({ error: 'Produto invalido' });
    const product = await get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) return res.status(400).json({ error: `Produto ${it.id} não encontrado` });
    if (!product.active) return res.status(400).json({ error: `Produto ${it.id} não está ativo` });
    const price = Number(product.price);
    if (!isFinite(price) || price < 0) return res.status(400).json({ error: `Produto ${it.id} tem preço inválido` });
    resolved.push({ id: product.id, name: product.name, price, downloadUrl: product.download_url || '' });
  }
  const subtotal = +resolved.reduce((s, i) => s + i.price, 0).toFixed(2);
  if (subtotal <= 0) return res.status(400).json({ error: 'Subtotal deve ser positivo' });
  if (subtotal > 100000) return res.status(400).json({ error: 'Subtotal muito alto (máx R$ 100.000)' });
  const total = subtotal;
  const affiliateCode = b.affiliate_code ? String(b.affiliate_code).toUpperCase().slice(0, 32) : null;
  // Valida affiliate_code (formato + existência + ativo)
  let affiliate = null;
  if (affiliateCode) {
    if (!/^[A-Z0-9]+$/.test(affiliateCode)) return res.status(400).json({ error: 'affiliate_code inválido' });
    affiliate = await get('SELECT id, affiliate_status, affiliate_rate, email FROM users WHERE affiliate_code = ? AND is_affiliate = 1', [affiliateCode]);
    if (!affiliate) return res.status(400).json({ error: 'Código de afiliado não encontrado' });
    if (affiliate.affiliate_status !== 'active') return res.status(400).json({ error: 'Afiliado não está ativo' });
    // Bloqueia self-referral
    if (affiliate.email && affiliate.email.toLowerCase() === email) {
      return res.status(400).json({ error: 'Afiliado não pode ser o próprio comprador' });
    }
  }
  const affiliateId = affiliate?.id || null;
  // Comissão calculada sobre o LÍQUIDO (mesma lógica do checkout normal).
  const isActiveAff = affiliate && affiliate.affiliate_status === 'active';
  const rate = isActiveAff ? Number(affiliate.affiliate_rate || 25) : 0;
  const breakdown = calculateBreakdown(subtotal, rate);
  const commission = breakdown.commission;
  const id = uid('ord-');
  const downloadToken = randomToken(32);
  const license = licenseKey();
  const paymentMethod = ['pix'].includes(b.payment_method) ? b.payment_method : 'pix';
  const paymentId = b.payment_id ? String(b.payment_id).slice(0, 128) : null;
  const status = ['pendente', 'pago', 'cancelado'].includes(b.status) ? b.status : 'pendente';
  const initialStatus = status === 'pago' ? 'pendente' : status;
  if (status === 'pago' && !paymentId) {
    return res.status(400).json({ error: 'Pedido manual pago exige payment_id confirmado pelo gateway.' });
  }
  // Bloqueia duplicar pedido pendente para o mesmo buyer+product (anti-duplicação)
  const pendingOrders = await all(
    "SELECT id, items FROM orders WHERE buyer_email = ? AND status = 'pendente'",
    [email]
  );
  const existingPending = pendingOrders.find((order) => {
    try {
      const parsed = JSON.parse(order.items || '[]');
      return parsed.some((item) => item && item.id === resolved[0].id);
    } catch {
      return false;
    }
  });
  if (existingPending && items.length === 1) {
    return res.status(409).json({ error: `Já existe um pedido pendente (#${existingPending.id}) para este produto` });
  }

  // Cria ou encontra user
  let user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    const userId = uid('u-');
    await run(
      "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'buyer', ?)",
      [userId, email, name, 'NO_PASSWORD', nowISO()]
    );
    user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  }

  await run(
    `INSERT INTO orders (id, buyer_email, buyer_name, user_id, affiliate_code, affiliate_id, commission, subtotal, total, status, payment_method, payment_id, items, download_token, license_key, gateway_fee, net_amount, commission_rate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, email, name, user.id, affiliateCode, affiliateId, commission, subtotal, total, initialStatus, paymentMethod, paymentId, JSON.stringify(resolved), downloadToken, license, breakdown.gatewayFee, breakdown.netAmount, breakdown.commissionRate, nowISO()]
  );

  // Se status já é pago, credita afiliado e manda email.
  // HIGH-14/HIGH-18 FIX: o crédito de afiliado é feito via /admin/orders/:id/confirm
  // com verificação real no gateway AbacatePay. Aqui só criamos o pedido pendente.
  if (status === 'pago') {
    // Marca como pago AGORA (admin override). Se houver payment_id, verificamos no gateway primeiro.
    let verified = false;
    if (paymentId) {
      try {
        const { checkPaymentStatus } = await import('api-core/lib/payments.js');
        const pixStatus = await checkPaymentStatus(paymentId);
        if (pixStatus && (pixStatus.status === 'PAID' || pixStatus.status === 'paid' || pixStatus.status === 'CONFIRMED' || pixStatus.status === 'confirmed')) {
          verified = true;
        }
      } catch (e) {
        console.error('[admin/orders] checkPaymentStatus falhou:', e.message);
      }
    }
    if (!verified) {
      return res.status(409).json({ error: 'Pagamento nao confirmado pelo gateway; pedido manual nao foi criado como pago.' });
    }
    await run('UPDATE orders SET status = ?, paid_at = ? WHERE id = ?', ['pago', nowISO(), id]);
    // Credita afiliado
    if (affiliateCode && affiliateId) {
      const aff = await get('SELECT * FROM users WHERE id = ?', [affiliateId]);
      if (aff && aff.affiliate_status === 'active') {
        const today = todayISO();
        const dailyStats = JSON.parse(aff.daily_stats || '{}');
        dailyStats[today] = dailyStats[today] || { clicks: 0, sales: 0, earned: 0 };
        dailyStats[today].sales += 1;
        dailyStats[today].earned += commission;
        await run(
          `UPDATE users SET conversions = conversions + 1, total_sales = total_sales + 1, total_earned = total_earned + ?, daily_stats = ? WHERE id = ?`,
          [commission, JSON.stringify(dailyStats), aff.id]
        );
      }
    }
    try {
      const order = { id, download_token: downloadToken, license_key: license };
      const tpl = orderPaidEmail({ order, buyer: { name }, products: resolved });
      await sendMail({ to: email, ...tpl });
    } catch (e) { console.error('mailer err:', e.message); }
  }

  const created = await get('SELECT * FROM orders WHERE id = ?', [id]);
  res.json({ order: serializeOrder(created) });
});

function serializeOrder(o) {
  if (!o) return null;
  const subtotal = Number(o.subtotal || 0);
  const gatewayFee = Number(o.gateway_fee || 0);
  const netAmount = Number(o.net_amount || 0);
  const commission = Number(o.commission || 0);
  const commissionRate = Number(o.commission_rate || 0);
  const effectiveNet = netAmount > 0 ? netAmount : subtotal;
  return {
    ...o,
    subtotal,
    total: Number(o.total || 0),
    commission,
    items: (() => { try { return JSON.parse(o.items || '[]'); } catch { return []; } })(),
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

// Sync existing products to AbacatePay (one-time migration / manual re-sync).
// Executa em paralelo com limite de 4 (evita rate-limit do gateway) e timeout
// de 8s por produto. Garante que o endpoint termina dentro do maxDuration da
// Vercel (10s Hobby / 60s Pro).
router.post('/sync-products', requireAdmin, async (req, res) => {
  const products = await all('SELECT * FROM products WHERE active = 1 AND (abacate_product_id IS NULL OR abacate_product_id = "")');
  if (products.length === 0) {
    return res.json({ ok: true, synced: 0, failed: 0, total: 0, message: 'Nenhum produto precisa de sincronização' });
  }

  const results = await runSyncWithLimit(products, 4);
  const synced = results.filter(r => r.ok).length;
  const failed = results.length - synced;
  res.json({ ok: true, synced, failed, total: products.length, results });
});

async function runSyncWithLimit(products, concurrency) {
  const queue = products.slice();
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  return Promise.all(workers);

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) return;
      const r = await syncOne(p);
      results.push(r);
    }
  }
}

function syncOne(p) {
  // Promise.race: timeout de 8s por produto. Se a AbacatePay demorar,
  // contamos como falha para esse item (os outros continuam).
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; }, 8000);
  return Promise.race([
    createAbacateProduct({
      externalId: p.id,
      name: p.name,
      price: Number(p.price),
      description: p.description || p.tagline || p.name,
      imageUrl: p.image || ''
    }).then(async (result) => {
      clearTimeout(t);
      if (timedOut) return { id: p.id, ok: false, error: 'timeout' };
      if (result && result.id) {
        await run('UPDATE products SET abacate_product_id = ? WHERE id = ?', [result.id, p.id]);
        return { id: p.id, ok: true, abacateId: result.id };
      }
      return { id: p.id, ok: false, error: 'sem id na resposta' };
    }).catch((err) => {
      clearTimeout(t);
      if (timedOut) return { id: p.id, ok: false, error: 'timeout' };
      return { id: p.id, ok: false, error: err.message };
    }),
    new Promise((resolve) => setTimeout(() => {
      clearTimeout(t);
      resolve({ id: p.id, ok: false, error: 'timeout' });
    }, 8500))
  ]);
}

// Admin: audit log
router.get('/audit-log', requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const logs = await getAuditLogs(limit, offset);
  res.json({ logs });
});

export default router;
