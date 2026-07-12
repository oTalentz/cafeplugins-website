import { Router } from 'express';
import { get, all, run } from 'api-core/lib/db.js';
import { requireAuth, requireAdmin, optionalAuth, getCurrentUser, extractToken } from 'api-core/lib/auth.js';
import {
  paymentGateway,
  createPixCharge,
  createCardCheckout,
  checkPaymentStatus,
  verifyWebhookSignature,
  verifyMercadoPagoWebhook
} from 'api-core/lib/gateway.js';
import { sendCode } from 'api-core/lib/codes.js';
import { sendMail, orderPaidEmail } from 'api-core/lib/mailer.js';
import { uid, licenseKey, randomToken, nowISO, todayISO, isValidEmail, generateAffCode } from 'api-core/lib/util.js';
import { sanitizeDownloadToken, sanitizeIdentifier, sanitizeText, sanitizeUrl, LIMITS } from 'api-core/lib/sanitize.js';
import { rateLimit, timingSafeEqual } from 'api-core/lib/security.js';
import { calculateBreakdown } from 'api-core/lib/fees.js';
import { createLogger } from 'api-core/lib/logger.js';
import { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from 'api-core/lib/config.js';
import { createWatermarkedJar, fetchOriginalJar, filenameForDownload, filenameForFreeDownload, generateAndUploadWatermarkedJar } from 'api-core/lib/jar-watermark.js';
import { auditLog } from 'api-core/lib/audit.js';

const router = Router();
const log = createLogger('orders');

const checkoutLimiter = rateLimit({ scope: 'orders:checkout', windowMs: 60_000, max: 8, message: 'Muitas tentativas de checkout. Aguarde um instante.' });
const downloadLimiter = rateLimit({ scope: 'orders:download', windowMs: 60_000, max: 30, message: 'Muitos downloads. Tente novamente em breve.' });
const webhookLimiter = rateLimit({ scope: 'orders:webhook', windowMs: 60_000, max: 60, message: 'Too many webhook calls.' });
const statusLimiter = rateLimit({ scope: 'orders:status', windowMs: 60_000, max: 30, message: 'Muitas consultas. Aguarde um instante.' });

const ALLOWED_STATUS = new Set(['pendente', 'pago', 'cancelado', 'reembolsado']);
const ALLOWED_PAYMENT_METHODS = new Set(['pix', 'cartao']);

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
  // PIX e cartão são suportados via gateway ativo (Mercado Pago/AbacatePay).
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

  // Validação de estoque: bloqueia produtos esgotados (stock = 0).
  // O decremento só acontece quando o pedido é efetivamente pago.
  for (const item of orderItems) {
    const p = productMap.get(item.id);
    if (p && Number(p.stock) === 0) {
      return res.status(400).json({ error: `Produto ${item.name} esgotado` });
    }
  }

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
      // Race condition fix: INSERT OR IGNORE evita crash se duas requisições concorrentes
      // tentarem criar o mesmo usuário (email é UNIQUE). Re-buscamos o user após o insert.
      await run(
        'INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)',
        [id, e, cleanName, 'NO_PASSWORD', 'buyer', nowISO()]
      );
      buyer = await get('SELECT * FROM users WHERE email = ?', [e]);
      // Envia code de verificação imediatamente (respeita cooldown)
      try {
        await sendCode(e, 'verify');
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

  // Pedido gratuito: aprova automaticamente sem passar por gateway.
  // Não envia e-mail de confirmação para pedidos gratuitos.
  if (subtotal === 0) {
    try {
      await markOrderPaid(orderId, { skipEmail: true });
    } catch (err) {
      log.error('Erro ao aprovar pedido gratuito', { orderId, error: err.message });
    }
    const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
    return res.json({ order: serialize(order), pix: { paid: true }, checkoutUrl: null, cardError: null });
  }

  // Cria cobrança conforme gateway ativo
  let pix = { stub: paymentGateway() === 'manual' };
  let checkoutUrl = null;
  let cardError = null;
  const redirectUrl = `${process.env.APP_URL || 'https://cafeplugins.com'}/api/orders/${orderId}/return`;

  if (paymentMethod === 'pix') {
    try {
      pix = await createPixCharge({
        orderId,
        amount: subtotal,
        description: `Pedido #${orderId}`.slice(0, 256),
        customer: { name: cleanName, email: e, items: orderItems }
      });
      await run(
        'UPDATE orders SET payment_id = ?, pix_qr_code = ?, pix_qr_image = ?, pix_expires_at = ? WHERE id = ?',
        [pix.paymentId || null, pix.pixQrCode || null, pix.pixQrImage || null, pix.expiresAt || null, orderId]
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
    const gateway = paymentGateway();
    let abacateItems = null;

    // Cartão via AbacatePay exige que todos os produtos estejam sincronizados
    if (gateway === 'abacate') {
      abacateItems = orderItems
        .filter(i => i.abacateProductId)
        .map(i => ({ id: i.abacateProductId, quantity: 1 }));

      if (abacateItems.length !== orderItems.length) {
        const missing = orderItems.filter(i => !i.abacateProductId).map(i => i.name);
        log.warn('Card checkout: missing abacate_product_id', { missing: missing.join(', ') });
        await run('DELETE FROM orders WHERE id = ?', [orderId]);
        return res.status(409).json({
          error: `Cartão indisponível: "${missing.join(', ')}" ainda não está sincronizado com a AbacatePay. Use PIX ou peça ao admin para sincronizar.`,
          code: 'CARD_PRODUCT_NOT_SYNCED',
          unsyncedIds: orderItems.filter(i => !i.abacateProductId).map(i => i.id)
        });
      }
    }

    try {
      const cardResult = await createCardCheckout({
        orderId,
        amount: subtotal,
        description: `Pedido #${orderId}`.slice(0, 256),
        customer: { name: cleanName, email: e, cellphone: cleanPhone },
        redirectUrl,
        ...(abacateItems ? { abacateItems } : {}),
        items: orderItems
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

// Webhook da AbacatePay (v1 e v2)
// Validação CRÍTICA: HMAC-SHA256 do rawBody com header 'x-abacate-signature'.
// Fallback: 'X-Webhook-Secret' APENAS para dev/migração. NUNCA via query string.
router.post('/webhook', webhookLimiter, async (req, res) => {
  const expectedSecret = process.env.ABACATE_WEBHOOK_SECRET;
  const signature = req.headers['x-abacate-signature'] || req.headers['x-webhook-signature'];
  const headerSecret = req.headers['x-webhook-secret'];
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!expectedSecret) {
    log.warn('ABACATE_WEBHOOK_SECRET não configurado — webhook ABERTO (DEV ONLY, BLOQUEADO EM PROD)');
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Webhook não configurado' });
    }
  } else {
    if (signature) {
      if (!verifyWebhookSignature(rawBody, signature, expectedSecret)) {
        log.warn('HMAC inválido', { ip: req.ip });
        return res.status(401).json({ error: 'Assinatura inválida' });
      }
    } else if (headerSecret) {
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
  log.info('webhook abacate recebido', { event, dataKeys: data ? Object.keys(data) : null });

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

  const paymentId = data?.id || data?.paymentId || data?.payment?.id || data?.billing?.id || data?.checkoutId;
  const metadataOrderId = data?.metadata?.orderId || data?.payment?.metadata?.orderId || data?.checkout?.metadata?.orderId;

  let order = null;
  if (paymentId && typeof paymentId === 'string' && paymentId.length <= 128) {
    order = await get('SELECT * FROM orders WHERE payment_id = ?', [paymentId]);
  }
  if (!order && metadataOrderId && typeof metadataOrderId === 'string' && metadataOrderId.length <= 64) {
    order = await get('SELECT * FROM orders WHERE id = ?', [metadataOrderId]);
  }

  if (!order) {
    log.warn('pedido não encontrado', { paymentId, metadataOrderId });
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }

  if (order.status === 'pago') {
    return res.json({ ok: true, alreadyPaid: true, orderId: order.id });
  }

  await markOrderPaid(order.id);
  const updated = await get('SELECT * FROM orders WHERE id = ?', [order.id]);
  res.json({ ok: true, orderId: order.id });
});

// Webhook do Mercado Pago
// Notificações de "order" (Checkout API Orders) enviam o ID da ordem em data.id.
// Notificações de "payment" (Checkout Pro / legacy) enviam o ID do pagamento.
// Validação de assinatura via header x-signature (se MERCADOPAGO_WEBHOOK_SECRET estiver configurado).
// IMPORTANTE: em dev a assinatura é opcional; em produção é obrigatória.
router.post('/webhook/mercadopago', webhookLimiter, async (req, res) => {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.query.data_id || req.query.id || req.body?.data?.id;
  const topic = req.query.type || req.body?.type || '';
  const rawBody = req.rawBody || '';

  if (secret) {
    const valid = verifyMercadoPagoWebhook({ xSignature, xRequestId, dataId, secret });
    if (!valid) {
      log.warn('MP webhook: assinatura inválida', { ip: req.ip });
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
  } else if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    log.warn('MP webhook: secret não configurado');
    return res.status(503).json({ error: 'Webhook não configurado' });
  } else {
    log.warn('MP webhook: modo dev — assinatura ignorada');
  }

  log.info('MP webhook recebido', { topic, dataId });

  // Acessa a notificação por query ou body
  if (topic && !['payment', 'order'].includes(topic)) {
    return res.status(200).json({ ok: true, ignored: true, topic });
  }

  if (!dataId) {
    return res.status(400).json({ error: 'data.id ausente' });
  }

  // Consulta o pagamento no Mercado Pago
  let payment;
  try {
    payment = await checkPaymentStatus(dataId);
  } catch (e) {
    log.error('MP webhook: erro ao consultar pagamento', { dataId, error: e.message });
    return res.status(502).json({ error: 'Falha ao consultar pagamento' });
  }

  if (!payment || !payment.paid) {
    return res.status(200).json({ ok: true, ignored: true, status: payment?.status });
  }

  // Encontra o pedido por payment_id ou external_reference
  const paymentId = payment.id;
  const externalReference = payment.external_reference;
  let order = null;
  if (paymentId) {
    order = await get('SELECT * FROM orders WHERE payment_id = ?', [String(paymentId)]);
  }
  if (!order && externalReference) {
    order = await get('SELECT * FROM orders WHERE id = ?', [String(externalReference)]);
  }

  if (!order) {
    log.warn('MP webhook: pedido não encontrado', { paymentId, externalReference });
    return res.status(404).json({ error: 'Pedido não encontrado' });
  }

  if (order.status === 'pago') {
    return res.json({ ok: true, alreadyPaid: true, orderId: order.id });
  }

  await markOrderPaid(order.id);
  const updated = await get('SELECT * FROM orders WHERE id = ?', [order.id]);
  res.json({ ok: true, orderId: order.id });
});

// Confirmação manual (admin) — use apenas como override operacional
router.post('/:id/confirm', requireAdmin, async (req, res) => {
  const { manualOverride = false, reason = '' } = req.body || {};
  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (order.status === 'pago') return res.json({ ok: true, alreadyPaid: true, order: serialize(order, { admin: true }) });
  if (!order.payment_id) {
    return res.status(400).json({ error: 'Pedido sem cobrança gerada. Confira o gateway ativo.' });
  }
  const gatewayStatus = await checkPaymentStatus(order.payment_id, order.id).catch(() => null);
  const gatewayPaid = gatewayStatus && gatewayStatus.paid;
  if (!gatewayPaid) {
    if (!manualOverride || String(reason).trim().length < 10) {
      return res.status(409).json({ error: 'Pagamento não confirmado pelo gateway. Informe override manual com justificativa.' });
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
      const s = await checkPaymentStatus(order.payment_id, order.id);
      if (s && s.paid) {
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

  // FALLBACK: se o pedido está pendente MAS tem payment_id, faz check direto no gateway.
  // Isso garante confirmação rápida mesmo se o webhook falhar ou demorar.
  if (order.status === 'pendente' && order.payment_id) {
    try {
      const pixStatus = await checkPaymentStatus(order.payment_id, order.id);
      if (pixStatus && pixStatus.paid) {
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
  const items = JSON.parse(order.items || '[]');
  let maxDownloads = 5;
  try {
    const first = items[0];
    if (first && first.id) {
      const product = await get('SELECT max_downloads FROM products WHERE id = ?', [first.id]);
      if (product && product.max_downloads) maxDownloads = Number(product.max_downloads);
    }
  } catch {}
  res.json({
    token: order.download_token,
    items: items.map(i => ({ id: i.id, name: i.name, downloadUrl: i.downloadUrl })),
    maxDownloads,
    downloadUrl: `${process.env.APP_URL || 'https://cafeplugins.com'}/download.html?t=${order.download_token}`
  });
});

// =====================================================
//  Cron: verifica pedidos pendentes órfãos (webhook não chegou)
//  Chamado por Vercel Cron a cada 15 min.
//  Protegido por CRON_SECRET (header x-cron-secret).
//  Busca pedidos pendentes criados há mais de 2 min (tempo razoável
//  para o webhook chegar) e consulta o gateway para confirmar pagamento.
// =====================================================
router.get('/cron/poll-pending', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    // Aceita secret via header Authorization: Bearer (Vercel Cron)
    // ou via query param ?secret= (cron-job.org, EasyCron, etc)
    const authHeader = req.headers['authorization'] || '';
    const headerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const querySecret = req.query.secret || '';
    if (!timingSafeEqual(cronSecret, headerSecret) && !timingSafeEqual(cronSecret, querySecret)) {
      return res.status(403).json({ error: 'Não autorizado' });
    }
  }
  try {
    // Busca pedidos pendentes há mais de 2 minutos (webhook pode ter falhado)
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const pending = await all(
      "SELECT * FROM orders WHERE status = 'pendente' AND created_at < ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 50",
      [cutoff]
    );
    if (pending.length === 0) {
      return res.json({ ok: true, checked: 0, confirmed: 0 });
    }
    let confirmed = 0;
    for (const order of pending) {
      if (!order.payment_id) continue;
      try {
        const status = await checkPaymentStatus(order.payment_id, order.id);
        if (status && status.paid) {
          await markOrderPaid(order.id);
          confirmed++;
          log.info('cron: pedido confirmado via poll', { orderId: order.id, paymentId: order.payment_id });
        }
      } catch (e) {
        log.warn('cron: erro ao verificar pedido', { orderId: order.id, error: e.message });
      }
    }
    res.json({ ok: true, checked: pending.length, confirmed });
  } catch (e) {
    log.error('cron poll-pending error', { error: e.message });
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Download do JAR watermarkado (público, validado pelo token)
router.get('/:id/download', downloadLimiter, async (req, res) => {
  const t = sanitizeDownloadToken(req.query.t || '');
  if (!t) return res.status(400).json({ error: 'Token ausente' });

  const order = await get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!order || !timingSafeEqual(order.download_token || '', t)) {
    log.warn('download rejeitado: token inválido', { orderId: req.params.id });
    return res.status(403).json({ error: 'Token inválido' });
  }
  log.info('download iniciado', { orderId: order.id, buyerEmail: order.buyer_email, status: order.status, productId: (JSON.parse(order.items || '[]')[0] || {}).id });
  if (order.status !== 'pago') return res.status(402).json({ error: 'Pedido não pago' });
  if (order.download_expires_at && order.download_expires_at < nowISO()) {
    log.warn('download rejeitado: token expirado', { orderId: order.id, download_expires_at: order.download_expires_at });
    return res.status(410).json({ error: 'Token de download expirado. Solicite um novo na sua conta.' });
  }

  // E-mail verificado
  if (order.user_id) {
    const buyer = await get('SELECT email_verified FROM users WHERE id = ?', [order.user_id]);
    if (buyer && !buyer.email_verified) {
      log.warn('download rejeitado: e-mail não verificado', { orderId: order.id, userId: order.user_id });
      return res.status(403).json({ error: 'Confirme seu e-mail para liberar o download.' });
    }
  }

  const items = JSON.parse(order.items || '[]');
  const item = items[0];
  if (!item || !item.id) {
    log.warn('download rejeitado: item do pedido inválido', { orderId: order.id, item });
    return res.status(404).json({ error: 'Arquivo do plugin não configurado' });
  }

  const product = await get('SELECT * FROM products WHERE id = ?', [item.id]);
  const maxDownloads = product && product.max_downloads ? Number(product.max_downloads) : 5;
  let downloads = [];
  try { downloads = JSON.parse(order.downloads || '[]'); } catch {}
  if (downloads.length >= maxDownloads) {
    log.warn('download rejeitado: limite atingido', { orderId: order.id, downloadCount: downloads.length, maxDownloads });
    return res.status(403).json({ error: 'Limite de downloads atingido para esta compra.', code: 'DOWNLOAD_LIMIT_REACHED' });
  }

  // Sempre usa o download_url MAIS RECENTE do produto, nao o salvo no pedido.
  // Isso garante que reuploads/admin atualizacoes sejam refletidos em pedidos antigos.
  const downloadUrl = (product && product.download_url) ? product.download_url : item.downloadUrl;
  if (!downloadUrl) {
    log.warn('download rejeitado: downloadUrl nao configurado', { orderId: order.id, productId: item.id });
    return res.status(404).json({ error: 'Arquivo do plugin nao configurado' });
  }

  // Plugins gratuitos (price=0): servem o JAR original diretamente, sem watermark
  // e sem necessidade de licença. Download mais simples, sem complicações.
  const isFree = Number(item.price) === 0;

  // Registra o download (atômico: só incrementa se abaixo do limite)
  const logEntry = JSON.stringify({ ts: nowISO(), ip: req.ip, ua: (req.headers['user-agent'] || '').slice(0, 100) });
  const upd = await run(
    `UPDATE orders SET downloads = json_insert(coalesce(downloads, '[]'), '$[#]', json(?))
     WHERE id = ? AND json_array_length(coalesce(downloads, '[]')) < ?`,
    [logEntry, order.id, maxDownloads]
  );
  if ((upd?.rowsAffected || 0) === 0) {
    log.warn('download rejeitado: limite atingido (atômico)', { orderId: order.id, maxDownloads });
    return res.status(403).json({ error: 'Limite de downloads atingido para esta compra.', code: 'DOWNLOAD_LIMIT_REACHED' });
  }

  // FAST PATH: se o JAR watermarkado já foi pré-gerado no pagamento, redireciona
  // para o GitHub. Evita timeout no serverless (geração on-the-fly pode demorar >10s).
  if (!isFree && order.watermarked_url) {
    log.info('download via redirect (JAR pré-gerado)', { orderId: order.id });
    const filename = filenameForDownload({ productName: item.name, productId: item.id });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.redirect(302, order.watermarked_url);
  }

  // SLOW PATH: gera o JAR on-the-fly (fallback se pré-geração falhou ou plugin gratuito)
  log.info('gerando build watermarkada on-the-fly', { orderId: order.id, downloadUrl, productId: item.id });
  try {
    let jar;
    let filename;
    if (isFree) {
      log.info('plugin gratuito: servindo JAR original sem watermark', { orderId: order.id, productId: item.id });
      jar = await fetchOriginalJar(downloadUrl);
      filename = filenameForFreeDownload({ productName: item.name, productId: item.id });
    } else {
      jar = await createWatermarkedJar({
        originalUrl: downloadUrl,
        licenseKey: order.license_key,
        orderId: order.id,
        buyerEmail: order.buyer_email,
        productId: item.id
      });
      filename = filenameForDownload({ productName: item.name, productId: item.id });
    }

    res.setHeader('Content-Type', 'application/java-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', jar.length);
    res.end(jar);
  } catch (e) {
    log.error('erro ao gerar JAR', { orderId: order.id, error: e.message, stack: e.stack });
    return res.status(500).json({ error: 'Erro ao gerar build do plugin: ' + e.message });
  }
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
  res.json({ order: await serializeDownloadOrder(order) });
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
    return res.status(400).json({ error: 'Não é possível marcar como pago sem um pagamento registrado. Confirme via gateway.' });
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
    // Restaura estoque se o pedido estava pago e está sendo revertido
    if (wasPaid && isReversing) {
      try {
        const items = JSON.parse(order.items || '[]');
        for (const item of items) {
          await run('UPDATE products SET stock = stock + 1 WHERE id = ?', [item.id]);
        }
      } catch (e) {
        log.warn('erro ao restaurar estoque', { orderId: req.params.id, error: e.message });
      }
    }
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
  // Audit log para reembolso/cancelamento
  if (status === 'reembolsado' || status === 'cancelado') {
    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'order_status_change',
      targetType: 'order',
      targetId: req.params.id,
      details: { from: order.status, to: status },
      ip: req.ip
    });
  }
  res.json({ order: serialize(updated, { admin: true }) });
});

// Renova download token expirado (dono do pedido, autenticado)
router.post('/:id/renew-download', requireAuth, async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const order = await get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return res.status(404).json({ error: 'Pedido nao encontrado' });
  if (order.buyer_email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  if (order.status !== 'pago') return res.status(400).json({ error: 'Pedido nao esta pago' });
  const newToken = randomToken(32);
  const newExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await run('UPDATE orders SET download_token = ?, download_expires_at = ? WHERE id = ?', [newToken, newExpires, id]);
  log.info('download token renovado', { orderId: id });
  res.json({ downloadToken: newToken, expiresAt: newExpires });
});

// Reenvia código de verificação para o e-mail do buyer (público via token de download)
router.post('/:id/resend-verify', async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const t = sanitizeDownloadToken(req.query.t || '');
  if (!t) return res.status(400).json({ error: 'Token ausente' });
  const order = await get('SELECT * FROM orders WHERE id = ? AND download_token = ?', [id, t]);
  if (!order) return res.status(404).json({ error: 'Pedido nao encontrado' });
  try {
    await sendCode(order.buyer_email, 'verify');
    res.json({ ok: true });
  } catch (err) {
    res.status(429).json({ error: err.message || 'Erro ao reenviar codigo' });
  }
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

  // Decrementa estoque de cada produto (só quando pago)
  try {
    const items = JSON.parse(order.items || '[]');
    for (const item of items) {
      await run('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0', [item.id]);
    }
  } catch (e) {
    log.warn('erro ao decrementar estoque', { orderId, error: e.message });
  }

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

  // Pré-gera JAR watermarkado e faz upload para GitHub (evita timeout no download).
  // Só para plugins pagos (gratuitos não precisam de watermark).
  // Falhas aqui não bloqueiam o pagamento — o download ainda funciona via geração on-the-fly.
  const isFree = Number(order.subtotal || 0) === 0;
  if (!isFree) {
    try {
      const items = JSON.parse(order.items || '[]');
      const item = items[0];
      if (item && item.id) {
        const product = await get('SELECT download_url FROM products WHERE id = ?', [item.id]);
        const downloadUrl = (product && product.download_url) ? product.download_url : item.downloadUrl;
        if (downloadUrl) {
          const watermarkedUrl = await generateAndUploadWatermarkedJar({
            originalUrl: downloadUrl,
            licenseKey: order.license_key,
            orderId: order.id,
            buyerEmail: order.buyer_email,
            productId: item.id,
            productName: item.name
          });
          if (watermarkedUrl) {
            await run('UPDATE orders SET watermarked_url = ? WHERE id = ?', [watermarkedUrl, order.id]);
            log.info('JAR watermarkado pré-gerado', { orderId: order.id, watermarkedUrl });
          }
        }
      }
    } catch (e) {
      log.warn('falha ao pré-gerar JAR watermarkado (download usará fallback on-the-fly)', { orderId, error: e.message });
    }
  }

  if (!opts.skipEmail) {
    // Pedidos gratuitos (subtotal=0) não enviam e-mail de confirmação.
    // Só enviamos para pedidos pagos com valor real.
    const isFree = Number(order.subtotal || 0) === 0;
    if (!isFree) {
      try {
        const products = JSON.parse(order.items || '[]');
        const tpl = orderPaidEmail({ order, buyer: { name: order.buyer_name }, products });
        await sendMail({ to: order.buyer_email, ...tpl });
      } catch (err) {
        console.error('Paid mailer error:', err.message);
      }
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
  const downloadCount = downloads.length;
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
    downloadCount,
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

async function serializeDownloadOrder(o) {
  if (!o) return null;
  let items = [];
  let downloads = [];
  try { items = JSON.parse(o.items || '[]'); } catch {}
  try { downloads = JSON.parse(o.downloads || '[]'); } catch {}
  let maxDownloads = 5;
  try {
    const first = items[0];
    if (first && first.id) {
      const product = await get('SELECT max_downloads FROM products WHERE id = ?', [first.id]);
      if (product && product.max_downloads) maxDownloads = Number(product.max_downloads);
    }
  } catch {}
  return {
    id: o.id,
    status: o.status,
    license_key: o.license_key,
    licenseKey: o.license_key,
    download_token: o.download_token,
    downloadToken: o.download_token,
    download_expires_at: o.download_expires_at,
    downloadExpiresAt: o.download_expires_at,
    downloadCount: downloads.length,
    maxDownloads,
    items: items.map(i => ({
      id: i.id,
      name: i.name,
      price: Number(i.price) || 0,
      downloadUrl: i.downloadUrl || ''
    })),
    downloads: downloads.map(d => ({ ts: d.ts }))
  };
}

export default router;
