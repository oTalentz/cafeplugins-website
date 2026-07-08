import { Router } from 'express';
import { get, all, run } from '../lib/db.js';
import { requireAuth, requireAdmin, optionalAuth, getCurrentUser, extractToken } from '../lib/auth.js';
import { createPixCharge, createCardCheckout, checkPaymentStatus, verifyWebhookSignature } from '../lib/payments.js';
import { sendMail, orderPaidEmail } from '../lib/mailer.js';
import { uid, licenseKey, randomToken, nowISO, todayISO, isValidEmail, generateAffCode } from '../lib/util.js';
import { sanitizeDownloadToken, sanitizeIdentifier, sanitizeText, sanitizeUrl, LIMITS } from '../lib/sanitize.js';
import { rateLimit, timingSafeEqual } from '../lib/security.js';
import { calculateBreakdown } from '../lib/fees.js';
import { createLogger } from '../lib/logger.js';
import { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from '../lib/config.js';

const router = Router();
const log = createLogger('orders');

const checkoutLimiter = rateLimit({ scope: 'orders:checkout', windowMs: 60_000, max: 8, message: 'Muitas tentativas de checkout. Aguarde um instante.' });
const downloadLimiter = rateLimit({ scope: 'orders:download', windowMs: 60_000, max: 30, message: 'Muitos downloads. Tente novamente em breve.' });
const webhookLimiter = rateLimit({ scope: 'orders:webhook', windowMs: 60_000, max: 60, message: 'Too many webhook calls.' });
const statusLimiter = rateLimit({ scope: 'orders:status', windowMs: 60_000, max: 30, message: 'Muitas consultas. Aguarde um instante.' });

const ALLOWED_STATUS = new Set(['pendente', 'pago', 'cancelado', 'reembolsado']);
const ALLOWED_PAYMENT_METHODS = new Set(['pix', 'cartao']);
const PAID_GATEWAY_STATUSES = new Set(['PAID', 'paid', 'CONFIRMED', 'confirmed', 'COMPLETED', 'completed']);

// Lista pedidos do usuário logado
router.get('/me', requireAuth, async (req, res) => {
  const orders = await all('SELECT * FROM orders WHERE buyer_email = ? ORDER BY created_at DESC', [req.user.email.toLowerCase()]);
  res.json({ orders: orders.map(o => serialize(o, { includeDownload: true })) });
});

// Lista pedidos onde o afiliado logado indicou
router.get('/affiliate', requireAuth, async (req, res) => {
  if (!req.user.affiliate_code) return res.json({ orders: [] });
  const orders = await all('SELECT * FROM orders WHERE affiliate_code = ? ORDER BY created_at DESC', [req.user.affiliate_code]);
  res.json({ orders: orders.map(o => serialize(o, { includeDownload: false })) });
});

// Cria um pedido (checkout)
router.post('/checkout', checkoutLimiter, optionalAuth, async (req, res) => {
  const b = req.body || {};
  const { name, email, items, affiliateCode, paymentMethod = 'pix' } = b;

  if (!name || !email || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (items.length > 50) return res.status(400).json({ error: 'Carrinho muito grande' });
  // Só PIX é suportado. Cartão/Boleto = "em breve".
  if (paymentMethod && !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({ error: 'Método de pagamento indisponível' });
  }
  // Items só podem ter id (string). Outros campos do client são IGNORADOS.
  const sanitizedItems = items
    .map(i => ({ id: sanitizeIdentifier(i && i.id, { max: 64 }) }))
    .filter(i => i.id);
  if (sanitizedItems.length === 0) return res.status(400).json({ error: 'Itens inválidos' });

  const cleanName = sanitizeText(name, { max: LIMITS.name });
  if (!cleanName) return res.status(400).json({ error: 'Nome inválido' });

  // Telefone (opcional mas recomendado para cartão via AbacatePay)
  const rawPhone = b.cellphone || b.phone || '';
  const cleanPhone = String(rawPhone).replace(/\D/g, '').slice(0, PHONE_MAX_DIGITS);
  if (cleanPhone && (cleanPhone.length < PHONE_MIN_DIGITS || cleanPhone.length > PHONE_MAX_DIGITS)) {
    return res.status(400).json({ error: `Telefone inválido (use DDD + número, ${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} dígitos)` });
  }

  // Valida produtos e preço — preço é SEMPRE do banco
  const productIds = [...new Set(sanitizedItems.map(i => i.id))];
  const placeholders = productIds.map(() => '?').join(',');
  const products = await all(`SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`, productIds);
  if (products.length !== productIds.length) {
    return res.status(400).json({ error: 'Um ou mais produtos não estão disponíveis' });
  }
  const productMap = new Map(products.map(p => [p.id, p]));
  let subtotal = 0;
  const orderItems = sanitizedItems.map(i => {
    const p = productMap.get(i.id);
    const price = Number(p.price);
    if (!(price >= 0) || !isFinite(price)) throw new Error('Preço inválido no banco');
    subtotal += price;
    return { id: p.id, name: p.name, price, downloadUrl: p.download_url || '', abacateProductId: p.abacate_product_id || null };
  });

  // Anti-double-purchase
  const e = email.toLowerCase().trim();
  const alreadyPaid = await all(
    `SELECT items FROM orders WHERE buyer_email = ? AND status = 'pago'`, [e]
  );
  const ownedIds = new Set();
  for (const o of alreadyPaid) {
    try { (JSON.parse(o.items) || []).forEach(it => ownedIds.add(it.id)); } catch {}
  }
  const conflict = orderItems.filter(i => ownedIds.has(i.id));
  if (conflict.length > 0) {
    return res.status(409).json({
      error: `Voc\u00ea j\u00e1 comprou: ${conflict.map(c => c.name).join(', ')}`,
      code: 'ALREADY_OWNED',
      ownedIds: [...ownedIds]
    });
  }

  // Resolve afiliado
  let affiliate = null;
  let commission = 0;
  let breakdown = null;
  if (affiliateCode) {
    const code = String(affiliateCode).trim().toUpperCase().slice(0, 32);
    affiliate = await get("SELECT * FROM users WHERE affiliate_code = ? AND affiliate_status = 'active'", [code]);
    if (!affiliate) return res.status(400).json({ error: 'C\u00f3digo de afiliado inv\u00e1lido' });
    if (affiliate.email.toLowerCase() === e) {
      return res.status(400).json({ error: 'Voc\u00ea n\u00e3o pode usar seu pr\u00f3prio c\u00f3digo de afiliado' });
    }
    const rate = Number(affiliate.affiliate_rate || 25);
    // Comissão calculada sobre o LÍQUIDO (subtotal − taxa gateway − impostos) para garantir
    // que a loja nunca pague ao afiliado mais do que efetivamente recebe.
    breakdown = calculateBreakdown(subtotal, rate);
    commission = breakdown.commission;
  }

  // Garante que o buyer existe como user
  let buyer = req.user;
  if (!buyer || buyer.email.toLowerCase() !== e) {
    const existing = await get('SELECT * FROM users WHERE email = ?', [e]);
    if (existing) {
      buyer = existing;
    } else {
      const id = uid('u-');
      // NO_PASSWORD: e-mail não verificado (será verificado após pagamento ou via code manual)
      await run(
        'INSERT INTO users (id, email, name, password_hash, role, created_at, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)',
        [id, e, cleanName, 'NO_PASSWORD', 'buyer', nowISO()]
      );
      buyer = await get('SELECT * FROM users WHERE id = ?', [id]);
      // Envia code de verificação imediatamente
      try {
        const { loginCode6 } = await import('../lib/util.js');
        const { sendMail, verifyEmail: verifyEmailTpl } = await import('../lib/mailer.js');
        const code = loginCode6();
        const codeId = uid('lc-');
        const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await run(
          'INSERT INTO login_codes (id, target_type, target_email, code, purpose, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
          [codeId, 'user', e, code, 'verify', expires, nowISO()]
        );
        const tpl = verifyEmailTpl({ code, email: e });
        await sendMail({ to: e, ...tpl });
      } catch (err) {
        log.error('verify code mailer error', { error: err.message });
      }
    }
  }

  // Cria pedido (pendente)
  const orderId = uid('ord-');
  const lk = licenseKey();
  const dt = randomToken(32);
  // HIGH-11 FIX: download_token expira em 7 dias
  const downloadExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await run(
    `INSERT INTO orders (id, buyer_email, buyer_name, user_id, affiliate_code, affiliate_id, commission, subtotal, total, status, payment_method, items, license_key, download_token, downloads, gateway_fee, net_amount, commission_rate, download_expires_at, buyer_cellphone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
    [
      orderId, e, cleanName, buyer.id,
      affiliate ? affiliate.affiliate_code : null,
      affiliate ? affiliate.id : null,
      commission,
      subtotal, subtotal,
      paymentMethod,
      JSON.stringify(orderItems),
      lk, dt,
      breakdown ? breakdown.gatewayFee : 0,
      breakdown ? breakdown.netAmount : subtotal,
      breakdown ? breakdown.commissionRate : 0,
      downloadExpires,
      cleanPhone || null,
      nowISO()
    ]
  );

  // Cria cobrança PIX apenas se for PIX
  let pix = { stub: !process.env.ABACATE_API_KEY };
  let checkoutUrl = null;
  let cardError = null;

  if (paymentMethod === 'pix') {
    try {
      pix = await createPixCharge({
        orderId,
        amount: subtotal,
        description: `Pedido #${orderId}`.slice(0, 37),
        customer: { name: cleanName, email: e }
      });
      await run(
        'UPDATE orders SET payment_id = ?, pix_qr_code = ?, pix_qr_image = ? WHERE id = ?',
        [pix.paymentId || null, pix.pixQrCode || null, pix.pixQrImage || null, orderId]
      );
    } catch (err) {
      log.error('Pix charge error', { error: err.message });
      // Em modo stub, retornamos o manualPixKey. Em produção, falhou de verdade.
      // Mantemos o pedido criado para o admin intervir, mas sinalizamos o erro.
      if (!pix.stub) {
        return res.status(502).json({
          error: `Falha ao gerar cobrança PIX: ${err.message}. Tente novamente.`,
          code: 'PIX_GENERATION_FAILED',
          order: serialize(await get('SELECT * FROM orders WHERE id = ?', [orderId]))
        });
      }
    }
  } else if (paymentMethod === 'cartao') {
    // Cartão: cria checkout hospedado via AbacatePay v2
    // Requer que todos os produtos tenham abacate_product_id (sync via admin)
    const abacateItems = orderItems
      .filter(i => i.abacateProductId)
      .map(i => ({ id: i.abacateProductId, quantity: 1 }));

    if (abacateItems.length !== orderItems.length) {
      // Bloqueia: sem sync com Abacate, não tem como cobrar cartão. Rollback do pedido.
      const missing = orderItems.filter(i => !i.abacateProductId).map(i => i.name);
      log.warn('Card checkout: missing abacate_product_id', { missing: missing.join(', ') });
      await run('DELETE FROM orders WHERE id = ?', [orderId]);
      return res.status(409).json({
        error: `Cartão indisponível: "${missing.join(', ')}" ainda não está sincronizado com a AbacatePay. Use PIX ou peça ao admin para sincronizar.`,
        code: 'CARD_PRODUCT_NOT_SYNCED',
        unsyncedIds: orderItems.filter(i => !i.abacateProductId).map(i => i.id)
      });
    }

    try {
      const cardResult = await createCardCheckout({
        orderId,
        amount: subtotal,
        description: `Pedido #${orderId}`.slice(0, 37),
        customer: { name: cleanName, email: e, cellphone: cleanPhone },
        redirectUrl: `${process.env.APP_URL || 'https://cafeplugins.com'}/api/orders/${orderId}/return`,
        abacateItems
      });
      if (cardResult && cardResult.checkoutUrl) {
        checkoutUrl = cardResult.checkoutUrl;
        await run(
          'UPDATE orders SET payment_id = ? WHERE id = ?',
          [cardResult.paymentId, orderId]
        );
      } else {
        // Sem URL: rollback do pedido. Cliente deve tentar de novo.
        log.warn('Card checkout returned no URL', { cardResult: JSON.stringify(cardResult).slice(0, 500) });
        log.warn('Raw response data', { raw: JSON.stringify(cardResult?.raw || {}).slice(0, 500) });
        await run('DELETE FROM orders WHERE id = ?', [orderId]);
        return res.status(502).json({
          error: 'Checkout de cartão não retornou URL válida. Tente novamente em alguns instantes.',
          code: 'CARD_CHECKOUT_NO_URL'
        });
      }
    } catch (err) {
      log.error('Card checkout error', { error: err.message });
      await run('DELETE FROM orders WHERE id = ?', [orderId]);
      return res.status(502).json({
        error: err.message || 'Erro ao criar checkout de cartão',
        code: 'CARD_CHECKOUT_FAILED'
      });
    }
  }

  // Registra click do afiliado (se houver)
  if (affiliate) {
    const clickId = uid('clk-');
    await run(
      'INSERT INTO clicks (id, affiliate_code, ip, user_agent, referrer, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [clickId, affiliate.affiliate_code, req.ip, (req.headers['user-agent'] || '').slice(0, 200), (req.headers['referer'] || '').slice(0, 500), nowISO()]
    );
  }

  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  res.json({ order: serialize(order), pix, checkoutUrl, cardError });
});

// Webhook do gateway de pagamento (AbacatePay v1 e v2)
// Validação CRÍTICA: HMAC-SHA256 do rawBody com header 'x-abacate-signature' (AbacatePay)
// ou 'x-webhook-signature' (genérico). Fallback: 'X-Webhook-Secret' APENAS para dev/migração.
// NUNCA aceita secret via query string (vaza em logs).
router.post('/webhook', webhookLimiter, async (req, res) => {
  const expectedSecret = process.env.ABACATE_WEBHOOK_SECRET;
  // AbacatePay usa 'x-abacate-signature'; fallback para 'x-webhook-signature' e 'x-webhook-secret'
  const signature = req.headers['x-abacate-signature'] || req.headers['x-webhook-signature'];
  const headerSecret = req.headers['x-webhook-secret'];
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!expectedSecret) {
    log.warn('ABACATE_WEBHOOK_SECRET não configurado — webhook ABERTO (DEV ONLY, BLOQUEADO EM PROD)');
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Webhook não configurado' });
    }
  } else {
    // Tenta HMAC primeiro (produção)
    if (signature) {
      if (!verifyWebhookSignature(rawBody, signature, expectedSecret)) {
        log.warn('HMAC inválido', { ip: req.ip });
        return res.status(401).json({ error: 'Assinatura inválida' });
      }
    } else if (headerSecret) {
      // Fallback para header secret (dev/migração)
      log.warn('usando X-Webhook-Secret fallback (HMAC não enviado). Migre para x-abacate-signature.');
      if (!timingSafeEqual(headerSecret, expectedSecret)) {
        log.warn('secret inválido', { ip: req.ip });
        return res.status(401).json({ error: 'Webhook secret inválido' });
      }
    } else {
      log.warn('sem assinatura nem secret', { ip: req.ip });
      return res.status(401).json({ error: 'Webhook sem autenticação' });
    }
  }

  const body = req.body || {};
  const { event, data } = body;

  // Log do payload completo para debug de webhooks
  log.info('webhook recebido', { event, dataKeys: data ? Object.keys(data) : null });

  if (!event || typeof event !== 'string' || event.length > 64) {
    return res.status(400).json({ error: 'event inválido' });
  }

  const paidEvents = new Set([
    'payment.confirmed',
    'pix.paid',
    'billing.paid',
    'checkout.completed',
    'transparent.completed',
    'checkout.paid'
  ]);
  if (!paidEvents.has(event)) {
    return res.status(200).json({ ok: true, ignored: true, event });
  }

  // AbacatePay billing.paid envia data.payment.id e data.billing.id (aninhado)
  // /v2/checkouts retorna data.id (checkout) com metadata.orderId
  // /v2/transparents retorna data.id (transparent) com metadata.orderId
  // Compatível com: data.id, data.paymentId, data.payment.id, data.billing.id, data.checkoutId
  const paymentId = data?.id || data?.paymentId || data?.payment?.id || data?.billing?.id || data?.checkoutId;
  const metadataOrderId = data?.metadata?.orderId || data?.payment?.metadata?.orderId || data?.checkout?.metadata?.orderId;

  let order = null;

  // Busca por paymentId (caminho principal)
  if (paymentId && typeof paymentId === 'string' && paymentId.length <= 128) {
    order = await get('SELECT * FROM orders WHERE payment_id = ?', [paymentId]);
  }

  // Fallback: busca por metadata.orderId (salvo no createPixCharge)
  if (!order && metadataOrderId && typeof metadataOrderId === 'string' && metadataOrderId.length <= 64) {
    order = await get('SELECT * FROM orders WHERE id = ?', [metadataOrderId]);
    log.info('encontrado via metadata.orderId', { metadataOrderId });
  }

  if (!order) {
    log.warn('pedido não encontrado', { paymentId, metadataOrderId });
    // Log parcial do payload para debug (sem dados sensíveis)
    log.warn('payload keys', {
      event,
      dataKeys: data ? Object.keys(data) : null,
      paymentKeys: data?.payment ? Object.keys(data.payment) : null,
      billingKeys: data?.billing ? Object.keys(data.billing) : null
    });
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }

  if (order.status === 'pago') {
    return res.json({ ok: true, alreadyPaid: true, orderId: order.id });
  }

  await markOrderPaid(order.id);
  const updated = await get('SELECT * FROM orders WHERE id = ?', [order.id]);
  res.json({ ok: true, orderId: order.id, license: updated.license_key });
});

// Confirmação manual (admin) — use apenas como override operacional
router.post('/:id/confirm', requireAdmin, async (req, res) => {
  const { manualOverride = false, reason = '' } = req.body || {};
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status === 'pago') return res.json({ ok: true, alreadyPaid: true, order: serialize(order, { admin: true }) });
  if (!order.payment_id) {
    return res.status(400).json({ error: 'Pedido sem cobrança PIX gerada. Use a AbacatePay para confirmar.' });
  }
  const gatewayStatus = await checkPaymentStatus(order.payment_id).catch(() => null);
  const gatewayPaid = gatewayStatus && PAID_GATEWAY_STATUSES.has(gatewayStatus.status);
  if (!gatewayPaid) {
    if (!manualOverride || String(reason).trim().length < 10) {
      return res.status(409).json({ error: 'Pagamento nao confirmado pelo gateway. Informe override manual com justificativa.' });
    }
    log.warn(`admin ${req.user.email} confirmou manualmente pedido ${order.id}`, { reason: String(reason).slice(0, 200) });
  }
  await markOrderPaid(order.id);
  const updated = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  res.json({ ok: true, order: serialize(updated, { admin: true }) });
});

// ===== ROTAS ESPECÍFICAS (antes da rota genérica /:id) =====

// Retorno do checkout hospedado do AbacatePay (cartão).
// O returnUrl do AbacatePay aponta para cá. Fazemos 2 coisas:
//   1) Refresh do status (failsafe do webhook)
//   2) Redireciona para a página de pedidos com sinal de sucesso/cancelamento
// Aceita o id via :id para que a URL seja determinística (AbacatePay não permite
// query string arbitrária no returnUrl em alguns casos).
router.get('/:id/return', statusLimiter, async (req, res) => {
  const orderId = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!orderId) return res.status(400).send('ID inválido');
  const order = await get('SELECT id, status, payment_id FROM orders WHERE id = ?', [orderId]);
  if (!order) {
    // Redireciona mesmo assim — frontend mostra "pedido não encontrado"
    const base = process.env.APP_URL || 'https://cafeplugins.com';
    return res.redirect(`${base}/account.html?return=notfound`);
  }

  // Failsafe: se ainda está pendente, consulta o gateway. Se o cliente
  // pagou e o webhook ainda não chegou, isso garante que o status atualize.
  if (order.status === 'pendente' && order.payment_id) {
    try {
      const s = await checkPaymentStatus(order.payment_id);
      if (s && PAID_GATEWAY_STATUSES.has(s.status)) {
        await markOrderPaid(order.id);
      }
    } catch (e) {
      // silencioso — frontend faz polling
    }
  }

  const fresh = await get('SELECT status FROM orders WHERE id = ?', [orderId]);
  const isPaid = fresh && fresh.status === 'pago';
  const base = process.env.APP_URL || 'https://cafeplugins.com';
  // Redireciona para account.html com query string simples — frontend decide o que mostrar
  const dest = isPaid
    ? `${base}/account.html?return=paid&order=${encodeURIComponent(orderId)}`
    : `${base}/account.html?return=cancelled&order=${encodeURIComponent(orderId)}`;
  res.redirect(302, dest);
});

// Status do pedido — visível APENAS para admin OU dono autenticado.
// HIGH-09 FIX: removido fallback ?email= (enumerável; combinações order_id+email viáveis).
// Guest checkout precisa logar/criar senha para consultar status. O polling do modal
// é feito via JWT (criado automaticamente após login code).
router.get('/:id/status', statusLimiter, async (req, res) => {
  const order = await get('SELECT id, status, paid_at, buyer_email, user_id, payment_id FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

  const token = extractToken(req);
  const user = token ? await getCurrentUser(req) : null;
  const isAdmin = user && user.role === 'admin';
  const isOwnerByAuth = user && order.buyer_email.toLowerCase() === user.email.toLowerCase();

  if (!isAdmin && !isOwnerByAuth) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // FALLBACK: se o pedido está pendente MAS tem payment_id, faz check direto na AbacatePay
  // Isso garante confirmação rápida mesmo se o webhook falhar ou demorar.
  if (order.status === 'pendente' && order.payment_id) {
    try {
      const pixStatus = await checkPaymentStatus(order.payment_id);
      if (pixStatus && PAID_GATEWAY_STATUSES.has(pixStatus.status)) {
        await markOrderPaid(order.id);
        const fresh = await get('SELECT id, status, paid_at FROM orders WHERE id = ?', [order.id]);
        return res.json({
          id: fresh.id,
          status: fresh.status,
          is_paid: fresh.status === 'pago',
          paid_at: fresh.paid_at
        });
      }
    } catch (e) {
      // Silencioso — não vaza erro do gateway
      log.warn('checkPaymentStatus failed', { error: e.message });
    }
  }

  res.json({
    id: order.id,
    status: order.status,
    is_paid: order.status === 'pago',
    paid_at: order.paid_at
  });
});

// Retorna o download_token persistente (dono do pedido)
router.get('/:id/download-token', requireAuth, async (req, res) => {
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.buyer_email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  if (order.status !== 'pago') {
    return res.status(402).json({ error: 'Pagamento ainda não confirmado' });
  }
  // Bloqueia download se e-mail não verificado (force verify para liberar)
  if (!req.user.email_verified) {
    return res.status(403).json({
      error: 'Confirme seu e-mail para liberar o download. Enviamos um código de 6 dígitos.',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  res.json({
    token: order.download_token,
    items: JSON.parse(order.items || '[]').map(i => ({ id: i.id, name: i.name, downloadUrl: i.downloadUrl })),
    downloadUrl: `${process.env.APP_URL || 'https://cafeplugins.com'}/download.html?t=${order.download_token}`
  });
});

// Log de download (público, validado pelo próprio token)
router.post('/:id/log-download', downloadLimiter, async (req, res) => {
  const t = sanitizeDownloadToken(req.query.t || (req.body && req.body.t) || '');
  if (!t) return res.status(403).json({ error: 'Token invalido' });
  const order = await get('SELECT id, download_token, status, download_expires_at, user_id, buyer_email FROM orders WHERE id = ?', [req.params.id]);
  if (order && !timingSafeEqual(order.download_token || '', t)) return res.status(403).json({ error: 'Token invalido' });
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (!t || order.download_token !== t) return res.status(403).json({ error: 'Token inválido' });
  if (order.status !== 'pago') return res.status(402).json({ error: 'Pedido não pago' });
  // HIGH-11 FIX: verifica expiração
  if (order.download_expires_at && order.download_expires_at < nowISO()) {
    return res.status(410).json({ error: 'Token de download expirado. Solicite um novo na sua conta.' });
  }
  // Bloqueia download se e-mail do buyer não verificado
  if (order.user_id) {
    const buyer = await get('SELECT email_verified FROM users WHERE id = ?', [order.user_id]);
    if (buyer && !buyer.email_verified) {
      return res.status(403).json({ error: 'Confirme seu e-mail para liberar o download.' });
    }
  }
  // Reusa a função markOrderPaid-style: apenas append
  const existing = await get('SELECT downloads FROM orders WHERE id = ?', [order.id]);
  let downloads = [];
  try { downloads = JSON.parse(existing.downloads || '[]'); } catch {}
  downloads.push({ ts: nowISO(), ip: req.ip, ua: (req.headers['user-agent'] || '').slice(0, 100) });
  await run('UPDATE orders SET downloads = ? WHERE id = ?', [JSON.stringify(downloads), order.id]);
  res.json({ ok: true, count: downloads.length });
});

// Lookup por download_token (público; só retorna pedidos pagos)
router.get('/by-token', async (req, res) => {
  const t = sanitizeDownloadToken(req.query.t || '');
  if (!t) return res.status(400).json({ error: 'Token ausente' });
  const order = await get('SELECT * FROM orders WHERE download_token = ?', [t]);
  if (!order) return res.status(404).json({ error: 'Token inválido ou expirado' });
  if (order.status !== 'pago') return res.status(402).json({ error: 'Pedido ainda não foi pago' });
  // HIGH-11 FIX: verifica expiração
  if (order.download_expires_at && order.download_expires_at < nowISO()) {
    return res.status(410).json({ error: 'Token de download expirado. Solicite um novo na sua conta.' });
  }
  // Bloqueia download se e-mail do buyer não verificado
  if (order.user_id) {
    const buyer = await get('SELECT email_verified FROM users WHERE id = ?', [order.user_id]);
    if (buyer && !buyer.email_verified) {
      return res.status(403).json({ error: 'Confirme seu e-mail para liberar o download.' });
    }
  }
  res.json({ order: serializeDownloadOrder(order) });
});

// Lista todos os pedidos (admin)
router.get('/', requireAdmin, async (req, res) => {
  // Por padrão, retorna apenas pedidos ATIVOS (não na lixeira).
  // Use ?includeTrashed=1 para ver todos (lixeira), ou ?onlyTrashed=1 para ver só a lixeira.
  const includeTrashed = req.query.includeTrashed === '1';
  const onlyTrashed = req.query.onlyTrashed === '1';
  // Auto-cleanup: deleta permanentemente pedidos com mais de 7 dias na lixeira
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = await run('DELETE FROM orders WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
    if (r.rowsAffected) log.info(`auto-cleanup: ${r.rowsAffected} pedidos da lixeira (>7d) removidos`);
  } catch (e) { log.warn('auto-cleanup skip', { error: e.message }); }
  let sql = 'SELECT * FROM orders';
  const args = [];
  if (onlyTrashed) sql += ' WHERE deleted_at IS NOT NULL';
  else if (!includeTrashed) sql += ' WHERE deleted_at IS NULL';
  sql += ' ORDER BY created_at DESC LIMIT 500';
  const orders = await all(sql, args);
  res.json({ orders: orders.map(o => serialize(o, { admin: true })) });
});

// Esvazia lixeira — deleta permanentemente TODOS os pedidos na lixeira (admin)
router.delete('/trash/empty', requireAdmin, async (req, res) => {
  try {
    const result = await run("DELETE FROM orders WHERE deleted_at IS NOT NULL");
    res.json({ ok: true, deleted: result.rowsAffected || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao esvaziar lixeira' });
  }
});

// DELETE pedido (admin) — soft delete: vai para lixeira por 7 dias
router.delete('/:id', requireAdmin, async (req, res) => {
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  // Se já está na lixeira E tem force=1, exclui permanente
  if (order.deleted_at && req.query.force === '1') {
    await run('DELETE FROM orders WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, permanent: true });
  }
  // Para pedidos pagos, exige ?force=1 (frontend mostra confirmação extra)
  const force = req.query.force === '1';
  if (order.status === 'pago' && !force) {
    return res.status(400).json({
      error: 'Pedido pago. Para excluir definitivamente, marque a opção de confirmação.',
      code: 'PAID_REQUIRES_FORCE'
    });
  }
  // Se pago + force, reverte créditos do afiliado ANTES de deletar (hard-delete permanente)
  if (order.status === 'pago' && order.affiliate_code) {
    const aff = await get('SELECT * FROM users WHERE affiliate_code = ?', [order.affiliate_code]);
    if (aff && aff.affiliate_status === 'active') {
      const today = todayISO();
      const dailyStats = JSON.parse(aff.daily_stats || '{}');
      dailyStats[today] = dailyStats[today] || { clicks: 0, sales: 0, earned: 0 };
      dailyStats[today].sales = Math.max(0, (dailyStats[today].sales || 0) - 1);
      dailyStats[today].earned = Math.max(0, (dailyStats[today].earned || 0) - Number(order.commission || 0));
      await run(
        `UPDATE users SET conversions = MAX(0, conversions - 1), total_sales = MAX(0, total_sales - 1), total_earned = MAX(0, total_earned - ?), daily_stats = ? WHERE id = ?`,
        [Number(order.commission || 0), JSON.stringify(dailyStats), aff.id]
      );
    }
  }
  // Soft-delete: marca deleted_at ao invés de remover. Auto-cleanup em 7 dias.
  // Hard-delete só se ?force=1 (frontend pede confirmação extra para pagos + lixeira)
  if (force || (order.deleted_at && req.query.force === '1')) {
    const r = await run('DELETE FROM orders WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, permanent: true, deleted: r.rowsAffected || 0 });
  }
  // Soft-delete
  const deletedAt = new Date().toISOString();
  await run('UPDATE orders SET deleted_at = ? WHERE id = ?', [deletedAt, req.params.id]);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  res.json({ ok: true, softDeleted: true, deletedAt, expiresAt });
});

// POST /orders/:id/restore — restaura pedido da lixeira
router.post('/:id/restore', requireAdmin, async (req, res) => {
  const order = await get('SELECT id, deleted_at FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (!order.deleted_at) return res.status(400).json({ error: 'Pedido não está na lixeira' });
  await run('UPDATE orders SET deleted_at = NULL WHERE id = ?', [req.params.id]);
  res.json({ ok: true, restored: true });
});

// PATCH pedido (admin) - atualiza status. Status é validado por enum.
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status é obrigatório' });
  if (!ALLOWED_STATUS.has(status)) return res.status(400).json({ error: `Status inválido. Use um de: ${[...ALLOWED_STATUS].join(', ')}` });
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

  // Transições seguras:
  // - pendente -> pago: precisa de payment_id
  // - pendente -> cancelado: OK
  // - pago -> cancelado: OK (mas não permite reverter depois)
  if (status === 'pago' && !order.payment_id) {
    return res.status(400).json({ error: 'Não é possível marcar como pago sem um pagamento registrado. Confirme via AbacatePay.' });
  }
  if (status === 'pago' && order.status !== 'pendente') {
    return res.status(400).json({ error: `Transição inválida de "${order.status}" para "pago".` });
  }
  if (status === 'pendente' && order.status === 'pago') {
    return res.status(400).json({ error: 'Não é possível voltar para pendente um pedido já pago.' });
  }

  // Se está virando pago, delega tudo para markOrderPaid (que atualiza status + side effects)
  if (status === 'pago' && order.status === 'pendente') {
    try { await markOrderPaid(order.id, { skipEmail: false }); }
    catch (e) { log.error('markOrderPaid err', { error: e.message }); return res.status(500).json({ error: 'Falha ao processar pagamento' }); }
  } else {
    // MED-04 FIX: se está reembolsando/cancelando um pedido que estava pago,
    // reverter o crédito de afiliado (se houver).
    const wasPaid = (order.status === 'pago');
    const isReversing = (status === 'reembolsado' || status === 'cancelado');
    await run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    if (wasPaid && isReversing && order.affiliate_code) {
      const aff = await get('SELECT * FROM users WHERE affiliate_code = ?', [order.affiliate_code]);
      if (aff && aff.affiliate_status === 'active') {
        const today = todayISO();
        const dailyStats = JSON.parse(aff.daily_stats || '{}');
        dailyStats[today] = dailyStats[today] || { clicks: 0, sales: 0, earned: 0 };
        dailyStats[today].sales = Math.max(0, (dailyStats[today].sales || 0) - 1);
        dailyStats[today].earned = Math.max(0, (dailyStats[today].earned || 0) - Number(order.commission || 0));
        await run(
          `UPDATE users SET conversions = MAX(0, conversions - 1), total_sales = MAX(0, total_sales - 1), total_earned = MAX(0, total_earned - ?), daily_stats = ? WHERE id = ?`,
          [Number(order.commission || 0), JSON.stringify(dailyStats), aff.id]
        );
      }
    }
  }

  const updated = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  res.json({ order: serialize(updated, { admin: true }) });
});

// ===== ROTA GENÉRICA (sempre por último!) =====
router.get('/:id', requireAuth, async (req, res) => {
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.buyer_email.toLowerCase() !== req.user.email.toLowerCase() && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  res.json({ order: serialize(order, { admin: req.user.role === 'admin', includeDownload: true }) });
});

async function markOrderPaid(orderId, opts = {}) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return;
  if (order.status === 'pago') return;
  const paidAt = nowISO();
  // HIGH-03 FIX: usar conditional update — só marca pago se ainda estiver pendente.
  // Se duas chamadas simultâneas chegarem, apenas a primeira vence.
  const r = await run(
    "UPDATE orders SET status = 'pago', paid_at = ? WHERE id = ? AND status != 'pago'",
    [paidAt, orderId]
  );
  if (!r.rowsAffected) return; // Outra chamada já marcou como pago

  // Auto-verifica e-mail do buyer (alta confiança: pagamento real veio do PSP)
  if (order.user_id) {
    await run(
      'UPDATE users SET email_verified = 1, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND email_verified = 0',
      [paidAt, order.user_id]
    );
  }

  if (order.affiliate_code) {
    const aff = await get('SELECT * FROM users WHERE affiliate_code = ?', [order.affiliate_code]);
    if (aff && aff.affiliate_status === 'active') {
      const today = todayISO();
      const dailyStats = JSON.parse(aff.daily_stats || '{}');
      dailyStats[today] = dailyStats[today] || { clicks: 0, sales: 0, earned: 0 };
      dailyStats[today].sales += 1;
      dailyStats[today].earned += Number(order.commission || 0);
      await run(
        `UPDATE users SET conversions = conversions + 1, total_sales = total_sales + 1, total_earned = total_earned + ?, daily_stats = ? WHERE id = ?`,
        [Number(order.commission || 0), JSON.stringify(dailyStats), aff.id]
      );
    }
  }

  if (!opts.skipEmail) {
    try {
      const products = JSON.parse(order.items || '[]');
      const tpl = orderPaidEmail({ order, buyer: { name: order.buyer_name }, products });
      await sendMail({ to: order.buyer_email, ...tpl });
    } catch (err) {
      console.error('Paid mailer error:', err.message);
    }
  }
}

function serialize(o, { admin = false, includeDownload = false } = {}) {
  if (!o) return null;
  let items = [], downloads = [];
  try { items = JSON.parse(o.items || '[]'); } catch {}
  try { downloads = JSON.parse(o.downloads || '[]'); } catch {}
  const canExposeDownload = admin || (includeDownload && o.status === 'pago');
  if (!canExposeDownload) {
    items = items.map(({ downloadUrl, download_url, ...rest }) => rest);
  }
  // Breakdown (líquido) — campos podem ser 0 para pedidos legados (pré-refatoração)
  const subtotal = Number(o.subtotal || 0);
  const gatewayFee = Number(o.gateway_fee || 0);
  const netAmount = Number(o.net_amount || 0);
  const commission = Number(o.commission || 0);
  const commissionRate = Number(o.commission_rate || 0);
  // Fallback para orders antigos sem net_amount/commission_rate: assume líquido = subtotal
  const effectiveNet = netAmount > 0 ? netAmount : subtotal;
  // Lixeira: calcula dias e horas restantes até auto-cleanup (7 dias)
  let trashInfo = null;
  if (o.deleted_at) {
    const deletedMs = new Date(o.deleted_at).getTime();
    const expiresMs = deletedMs + 7 * 24 * 60 * 60 * 1000;
    const remainingMs = Math.max(0, expiresMs - Date.now());
    const totalHours = Math.floor(remainingMs / (60 * 60 * 1000));
    const remainingDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    trashInfo = {
      deletedAt: o.deleted_at,
      expiresAt: new Date(expiresMs).toISOString(),
      remainingDays,
      remainingHours
    };
  }
  const out = {
    ...o,
    subtotal,
    total: Number(o.total || 0),
    commission,
    items,
    downloads,
    is_paid: o.status === 'pago',
    is_trashed: !!o.deleted_at,
    // Garantir aliases camelCase (frontend lê paymentMethod, backend salva payment_method)
    paymentMethod: o.payment_method || o.paymentMethod || 'pix',
    payment: o.payment_method || o.paymentMethod || 'pix',
    paymentId: o.payment_id || o.paymentId || null,
    affiliateCode: o.affiliate_code || o.affiliateCode || null,
    userId: o.user_id || o.userId || null,
    cellphone: o.buyer_cellphone || o.cellphone || null,
    trashInfo,
    // Breakdown para o frontend exibir "preço − taxa gateway = líquido − comissão"
    breakdown: {
      subtotal,
      gatewayFee,
      netAmount: effectiveNet,
      commission,
      commissionRate,
      storeKeeps: +Math.max(0, subtotal - gatewayFee - commission).toFixed(2)
    }
  };
  if (!canExposeDownload) {
    delete out.download_token;
    delete out.downloadToken;
    delete out.license_key;
    delete out.licenseKey;
  }
  return out;
}

function serializeDownloadOrder(o) {
  if (!o) return null;
  let items = [];
  let downloads = [];
  try { items = JSON.parse(o.items || '[]'); } catch {}
  try { downloads = JSON.parse(o.downloads || '[]'); } catch {}
  return {
    id: o.id,
    status: o.status,
    license_key: o.license_key,
    licenseKey: o.license_key,
    download_token: o.download_token,
    downloadToken: o.download_token,
    download_expires_at: o.download_expires_at,
    downloadExpiresAt: o.download_expires_at,
    items: items.map(i => ({
      id: i.id,
      name: i.name,
      downloadUrl: i.downloadUrl || ''
    })),
    downloads: downloads.map(d => ({ ts: d.ts }))
  };
}

export default router;
