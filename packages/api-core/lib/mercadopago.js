// =====================================================
//  Integração Mercado Pago
//  - PIX transparente via /v1/orders (Checkout API Orders)
//  - Cartão via Checkout Pro (/checkout/preferences)
//  - Consulta de ordem/pagamento e validação de webhook
//
//  Requer MERCADOPAGO_ACCESS_TOKEN. Modo stub (manual) quando ausente.
// =====================================================

import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from './logger.js';
import { MERCADOPAGO_URL, MERCADOPAGO_TIMEOUT_MS, MERCADOPAGO_SANDBOX, APP_URL } from './config.js';

const log = createLogger('mercadopago');

function fetchWithTimeout(url, opts = {}, timeoutMs = MERCADOPAGO_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctl.signal })
    .finally(() => clearTimeout(t));
}

export function mercadoPagoEnabled() {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
}

function mpHeaders(idempotencyKey) {
  return {
    'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {})
  };
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

// Items para Checkout Pro (preferences)
function toPreferenceItems(orderItems) {
  return (orderItems || []).map(i => ({
    id: String(i.id).slice(0, 256),
    title: truncate(i.name || 'Produto', 100),
    description: truncate(i.name || 'Produto', 256),
    picture_url: i.pictureUrl || i.image || '',
    category_id: 'games',
    quantity: 1,
    currency_id: 'BRL',
    unit_price: Number(i.price || 0)
  }));
}

// Items para Orders API (Checkout API Orders)
function toOrderItems(orderItems) {
  const items = (orderItems || []).map(i => {
    const it = {
      title: truncate(i.name || 'Produto', 100),
      description: truncate(i.name || 'Produto', 256),
      unit_price: formatAmount(i.price),
      quantity: 1,
      category_id: 'games'
    };
    const pic = i.pictureUrl || i.image || '';
    if (pic) it.picture_url = pic;
    return it;
  });
  if (items.length === 0) {
    items.push({
      title: 'Pedido',
      unit_price: '0.00',
      quantity: 1
    });
  }
  return items;
}

function formatAmount(amount) {
  const n = Number(amount || 0);
  if (!isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export async function createPixCharge({ orderId, amount, description, customer }) {
  if (!mercadoPagoEnabled()) {
    return {
      stub: true,
      pixQrCode: process.env.MANUAL_PIX_KEY || '0'.repeat(64),
      pixQrImage: null,
      method: 'manual',
      message: 'Pagamento manual (Mercado Pago não configurado). Pague via PIX e aguarde a confirmação do admin.'
    };
  }

  const amt = Math.round(Number(amount) * 100) / 100;
  if (!isFinite(amt) || amt <= 0) throw new Error('Valor inválido');

  const notificationUrl = `${APP_URL}/api/orders/webhook/mercadopago`;
  const expirationTime = 'PT30M';
  const idempotencyKey = randomUUID();

  const body = {
    type: 'online',
    external_reference: String(orderId).slice(0, 256),
    total_amount: formatAmount(amt),
    description: truncate(description || `Pedido ${String(orderId).slice(-8)}`, 256),
    capture_mode: 'automatic_async',
    processing_mode: 'automatic',
    payer: {
      email: String(customer.email).slice(0, 256),
      first_name: String(customer.name || '').slice(0, 100)
    },
    transactions: {
      payments: [{
        amount: formatAmount(amt),
        payment_method: {
          id: 'pix',
          type: 'bank_transfer'
        },
        expiration_time: expirationTime
      }]
    },
    items: toOrderItems(customer.items || [])
  };

  const r = await fetchWithTimeout(`${MERCADOPAGO_URL}/v1/orders`, {
    method: 'POST',
    headers: mpHeaders(idempotencyKey),
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let resp;
  try { resp = JSON.parse(text); } catch { throw new Error(`Mercado Pago ${r.status}: resposta inválida`); }

  if (!r.ok || resp.errors || resp.error) {
    log.error('Mercado Pago PIX error', { status: r.status, error: resp?.message || resp?.errors || resp?.error || 'sem mensagem' });
    throw new Error(`Pagamento indisponível no momento (${r.status})`);
  }

  const payment = resp.transactions?.payments?.[0] || {};
  const pixData = payment.payment_method || {};
  const qrCode = pixData.qr_code ? String(pixData.qr_code).slice(0, 2048) : null;
  const qrBase64 = pixData.qr_code_base64 ? String(pixData.qr_code_base64).slice(0, 200000) : null;
  const qrImage = qrBase64 && !qrBase64.startsWith('data:') ? `data:image/png;base64,${qrBase64}` : qrBase64;

  if (!qrCode) throw new Error('Resposta incompleta do gateway (sem QR code)');

  return {
    stub: false,
    paymentId: String(resp.id || `mp_${orderId}`).slice(0, 128),
    pixQrCode: qrCode,
    pixQrImage: qrImage,
    method: 'pix',
    status: resp.status,
    statusDetail: resp.status_detail,
    expiresAt: payment.date_of_expiration
  };
}

export async function createCardCheckout({ orderId, amount, description, customer, redirectUrl, items }) {
  if (!mercadoPagoEnabled()) return null;

  const amt = Math.round(Number(amount) * 100) / 100;
  if (!isFinite(amt) || amt <= 0) throw new Error('Valor inválido');

  const notificationUrl = `${APP_URL}/api/orders/webhook/mercadopago`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const payer = { email: String(customer.email).slice(0, 256) };
  if (customer.name) {
    const full = String(customer.name).trim();
    const parts = full.split(/\s+/);
    const firstName = parts[0] || full;
    const surname = parts.slice(1).join(' ') || '';
    payer.name = firstName.slice(0, 100);
    if (surname) payer.surname = surname.slice(0, 100);
  }

  const preferenceItems = toPreferenceItems(items || []);
  if (preferenceItems.length === 0) {
    preferenceItems.push({
      id: String(orderId).slice(0, 256),
      title: truncate(description || 'Pedido', 100),
      description: truncate(description || 'Pedido', 256),
      quantity: 1,
      currency_id: 'BRL',
      unit_price: amt
    });
  }

  const body = {
    items: preferenceItems,
    payer,
    external_reference: String(orderId).slice(0, 256),
    back_urls: {
      success: redirectUrl,
      pending: redirectUrl,
      failure: redirectUrl
    },
    notification_url: notificationUrl,
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: expiresAt,
    payment_methods: {
      // Checkout Pro fica com cartão; PIX fica na opção transparente da loja.
      excluded_payment_types: [{ id: 'bank_transfer' }]
    },
    additional_info: truncate(description || `Pedido ${String(orderId).slice(-8)}`, 256)
  };

  const r = await fetchWithTimeout(`${MERCADOPAGO_URL}/checkout/preferences`, {
    method: 'POST',
    headers: mpHeaders(),
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let resp;
  try { resp = JSON.parse(text); } catch { throw new Error(`Mercado Pago ${r.status}: resposta inválida`); }

  if (!r.ok || resp.error) {
    log.error('Mercado Pago checkout error', { status: r.status, error: resp?.message || resp?.error || 'sem mensagem' });
    throw new Error(`Checkout indisponível no momento (${r.status})`);
  }

  const useSandbox = MERCADOPAGO_SANDBOX || (!process.env.VERCEL && process.env.NODE_ENV !== 'production');
  const checkoutUrl = useSandbox
    ? (resp.sandbox_init_point || resp.init_point || null)
    : (resp.init_point || resp.sandbox_init_point || null);
  if (!checkoutUrl) {
    log.error('Mercado Pago checkout: sem init_point', { dataKeys: Object.keys(resp) });
    return null;
  }

  return {
    checkoutUrl,
    paymentId: String(resp.id || `pref_${orderId}`).slice(0, 128),
    raw: resp
  };
}

// --- Consulta de ordem/pagamento ---

function normalizeOrderOrPayment(raw) {
  if (!raw) return null;
  // Orders API
  if (raw.type === 'online' || raw.type === 'qr' || raw.transactions) {
    const payment = raw.transactions?.payments?.[0] || {};
    return {
      id: raw.id,
      status: raw.status,
      status_detail: raw.status_detail,
      external_reference: raw.external_reference,
      paid: isPaidStatus(raw.status, raw.status_detail)
    };
  }
  // Legacy Payments API
  return {
    id: raw.id,
    status: raw.status,
    status_detail: raw.status_detail,
    external_reference: raw.external_reference,
    paid: isPaidStatus(raw.status, raw.status_detail)
  };
}

export async function getOrder(orderId) {
  if (!mercadoPagoEnabled() || !orderId) return null;
  const r = await fetchWithTimeout(`${MERCADOPAGO_URL}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!r.ok) return null;
  return normalizeOrderOrPayment(await r.json());
}

export async function getPayment(paymentId) {
  if (!mercadoPagoEnabled() || !paymentId) return null;
  const r = await fetchWithTimeout(`${MERCADOPAGO_URL}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!r.ok) return null;
  return normalizeOrderOrPayment(await r.json());
}

export async function searchOrderByExternalReference(externalReference) {
  if (!mercadoPagoEnabled() || !externalReference) return null;
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const begin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = `${MERCADOPAGO_URL}/v1/orders?` + new URLSearchParams({
    external_reference: String(externalReference).slice(0, 64),
    begin_date: begin,
    end_date: end,
    sort_by: 'created_date',
    sort_order: 'desc',
    page_size: '5'
  });
  const r = await fetchWithTimeout(url, {
    headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!r.ok) return null;
  const resp = await r.json();
  const results = resp?.data || [];
  return normalizeOrderOrPayment(results[0]) || null;
}

export async function searchPaymentByExternalReference(externalReference) {
  if (!mercadoPagoEnabled() || !externalReference) return null;
  const url = `${MERCADOPAGO_URL}/v1/payments/search?` + new URLSearchParams({
    external_reference: String(externalReference),
    sort: 'date_created',
    criteria: 'desc',
    limit: '5'
  });
  const r = await fetchWithTimeout(url, {
    headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  if (!r.ok) return null;
  const resp = await r.json();
  const results = resp?.results || [];
  return normalizeOrderOrPayment(results[0]) || null;
}

export function isPaidStatus(status, statusDetail) {
  const s = String(status || '').toLowerCase();
  return s === 'approved' || s === 'authorized' || s === 'accredited' || s === 'processed' ||
    (s === 'pending' && String(statusDetail || '').toLowerCase() === 'accredited');
}

/**
 * Valida assinatura do webhook Mercado Pago.
 * Header x-signature: `ts=...,v1=...`
 * Header x-request-id (uuid)
 * Query data.id
 * Manifest: `id:[data_id];request-id:[x_request_id];ts:[ts];`
 */
export function verifyWebhookSignature(xSignature, xRequestId, dataId, secret) {
  if (!secret || !xSignature) return false;
  try {
    const parts = xSignature.split(',').reduce((acc, part) => {
      const [k, v] = part.trim().split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return false;

    const manifestParts = [];
    if (dataId) manifestParts.push(`id:${String(dataId)}`);
    if (xRequestId) manifestParts.push(`request-id:${xRequestId}`);
    if (ts) manifestParts.push(`ts:${ts}`);
    const manifest = manifestParts.join(';') + ';';

    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
