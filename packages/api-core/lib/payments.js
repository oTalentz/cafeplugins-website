// =====================================================
//  Pagamentos - AbacatePay v2 (PIX via /v2/transparents/create)
//  Documentação: https://docs.abacatepay.com
//
//  Endpoint:  POST https://api.abacatepay.com/v2/transparents/create
//  - amount obrigatório (em centavos), dentro de { data: {...} }
//  - description opcional, max 37 chars
//  - customer opcional; se enviado, TODOS name/cellphone/email/taxId obrigatórios
//  - metadata opcional (objeto)
//
//  Resposta: { data: { id, brCode, brCodeBase64, ... }, success: true, error: null }
//
//  Se ABACATE_API_KEY não estiver setado, opera em modo "manual":
//  gera um QR PIX fake. Admin confirma pagamento depois.
// =====================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from './logger.js';
import { ABACATE_URL, ABACATE_TIMEOUT_MS } from './config.js';

const log = createLogger('payments');

function fetchWithTimeout(url, opts = {}, timeoutMs = ABACATE_TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctl.signal })
    .finally(() => clearTimeout(t));
}

export function abacateEnabled() {
  return Boolean(process.env.ABACATE_API_KEY);
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

export async function createPixCharge({ orderId, amount, description, customer }) {
  if (!abacateEnabled()) {
    return {
      stub: true,
      pixQrCode: process.env.MANUAL_PIX_KEY || '0000000000000000000000000000000000000000000000000000000000000000',
      pixQrImage: null,
      method: 'manual',
      message: 'Pagamento manual (AbacatePay não configurado). Pague via PIX e aguarde a confirmação do admin.'
    };
  }

  const amt = Math.round(Number(amount) * 100);
  if (!isFinite(amt) || amt <= 0) throw new Error('Valor inválido');

  // Não envia customer se faltar campo obrigatório (vai dar 400 do gateway)
  const hasFullCustomer = customer && customer.name && customer.cellphone && customer.email;
  const safeCustomer = hasFullCustomer ? {
    name: String(customer.name).slice(0, 100),
    cellphone: String(customer.cellphone).slice(0, 20),
    email: String(customer.email).slice(0, 200),
    ...(customer.taxId ? { taxId: String(customer.taxId).slice(0, 20) } : {})
  } : null;

  // v2: request body precisa ser wrapped em { data: {...} }
  const body = {
    data: {
      amount: amt,
      expiresIn: 3600,
      description: truncate(description || `Pedido ${String(orderId).slice(-8)}`, 37),
      metadata: { orderId: String(orderId).slice(0, 64) },
      ...(safeCustomer ? { customer: safeCustomer } : {})
    }
  };

  const r = await fetchWithTimeout(`${ABACATE_URL}/transparents/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ABACATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let resp;
  try { resp = JSON.parse(text); } catch { throw new Error(`AbacatePay ${r.status}: resposta inválida`); }

  // v2: response é { data: {...}, success: true, error: null }
  if (!r.ok || resp.error) {
    log.error('AbacatePay error', { status: r.status, error: resp?.error || 'sem mensagem' });
    throw new Error(`Pagamento indisponível no momento (${r.status})`);
  }

  const pix = resp.data || {};
  if (!pix.brCode) throw new Error('Resposta incompleta do gateway (sem brCode)');
  // v2: id pode estar em pix.id; se não tiver, usa orderId como identificador
  const paymentId = pix.id ? String(pix.id).slice(0, 128) : `transparent_${orderId}`;
  return {
    stub: false,
    paymentId,
    pixQrCode: String(pix.brCode).slice(0, 1024),
    pixQrImage: pix.brCodeBase64 ? String(pix.brCodeBase64).slice(0, 200000) : null,
    method: 'pix',
    status: pix.status,
    expiresAt: pix.expiresAt
  };
}

export async function checkPaymentStatus(paymentId) {
  if (!abacateEnabled() || !paymentId) return null;
  // v2: /transparents/check?id=xxx (retorna { data: { id, status }, success, error })
  const r = await fetchWithTimeout(`${ABACATE_URL}/transparents/check?id=${encodeURIComponent(paymentId)}`, {
    headers: { 'Authorization': `Bearer ${process.env.ABACATE_API_KEY}` }
  });
  if (!r.ok) return null;
  const resp = await r.json();
  return resp.data || null;
}

/**
 * Cria checkout hospedado para cartão de crédito via AbacatePay v2.
 * Retorna { checkoutUrl, paymentId, raw } ou null se falhar.
 *
 * Doc AbacatePay v2 (/v2/checkouts/create):
 *   - amount obrigatório (em centavos)
 *   - items: array de { id (AbacatePay product id), quantity }
 *   - methods: ['CARD'] para cartão
 *   - returnUrl: URL de retorno após pagamento
 *   - customer (opcional mas recomendado): { name, cellphone, email, taxId }
 *   - metadata (opcional): { orderId, ... }
 */
export async function createCardCheckout({ orderId, amount, description, customer, redirectUrl, abacateItems, items }) {
  if (!abacateEnabled()) return null;

  const amt = Math.round(Number(amount) * 100);
  if (!isFinite(amt) || amt <= 0) throw new Error('Valor inválido');

  // Para AbacatePay cartão, o customer completo é recomendado para antifraude
  const hasFullCustomer = customer && customer.name && customer.cellphone && customer.email;
  const safeCustomer = hasFullCustomer ? {
    name: String(customer.name).slice(0, 100),
    cellphone: String(customer.cellphone).slice(0, 20),
    email: String(customer.email).slice(0, 200),
    ...(customer.taxId ? { taxId: String(customer.taxId).slice(0, 20) } : {})
  } : customer && customer.email ? { email: String(customer.email).slice(0, 200) } : null;

  // Items do catálogo AbacatePay (sincronizados via /admin/sync-products)
  let safeItems;
  if (abacateItems && abacateItems.length > 0) {
    safeItems = abacateItems.map(i => ({ id: String(i.id), quantity: Number(i.quantity || 1) }));
  } else {
    safeItems = (items || []).map(i => ({
      name: String(i.name || 'Item').slice(0, 100),
      price: Math.round(Number(i.price || 0) * 100),
      quantity: Number(i.quantity || 1)
    })).filter(i => i.price > 0);
    if (safeItems.length === 0) {
      safeItems.push({ name: description || 'Pedido', price: amt, quantity: 1 });
    }
  }

  const body = {
    data: {
      amount: amt,
      description: truncate(description || `Pedido ${String(orderId).slice(-8)}`, 37),
      expiresIn: 3600,
      items: safeItems,
      methods: ['CARD'],
      metadata: { orderId: String(orderId).slice(0, 64) },
      ...(safeCustomer ? { customer: safeCustomer } : {}),
      ...(redirectUrl ? { returnUrl: redirectUrl } : {})
    }
  };

  const r = await fetchWithTimeout(`${ABACATE_URL}/checkouts/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ABACATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let resp;
  try { resp = JSON.parse(text); } catch { throw new Error(`AbacatePay ${r.status}: resposta inválida`); }

  if (!r.ok || resp.error) {
    log.error('Card checkout error', { status: r.status, error: resp?.error || 'sem mensagem', body: text.slice(0, 500) });
    throw new Error(`AbacatePay cartão: ${resp?.error?.message || `HTTP ${r.status}`}`);
  }

  const data = resp.data || {};
  // Campos oficiais (v2): data.url é a URL do checkout hospedado. data.id é o ID do checkout.
  const checkoutUrl = data.url || data.checkoutUrl || data.paymentUrl || data.link || null;

  if (!checkoutUrl) {
    log.error('Card checkout: sem URL na resposta', { dataKeys: Object.keys(data) });
    return null;
  }

  return {
    checkoutUrl,
    paymentId: data.id ? String(data.id).slice(0, 128) : `checkout_${orderId}`,
    raw: data
  };
}

/**
 * Verifica assinatura HMAC do webhook AbacatePay.
 * Header: 'x-abacate-signature' = HMAC-SHA256(body, secret) em hex
 * Retorna true se bater, false caso contrário.
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Cria produto no catálogo AbacatePay v2.
 * Retorna { id } (AbacatePay product ID) ou null.
 */
export async function createAbacateProduct({ externalId, name, price, description, imageUrl }) {
  if (!abacateEnabled()) return null;

  const body = {
    data: {
      externalId: String(externalId).slice(0, 64),
      name: String(name).slice(0, 100),
      price: Math.round(Number(price) * 100),
      currency: 'BRL',
      ...(description ? { description: String(description).slice(0, 500) } : {}),
      ...(imageUrl ? { imageUrl: String(imageUrl).slice(0, 500) } : {})
    }
  };

  const r = await fetchWithTimeout(`${ABACATE_URL}/products/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ABACATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let resp;
  try { resp = JSON.parse(text); } catch { throw new Error(`AbacatePay ${r.status}: resposta inválida`); }

  if (!r.ok || resp.error) {
    log.error('Create product error', { status: r.status, error: resp?.error || text.slice(0, 200) });
    return null;
  }

  const data = resp.data || {};
  log.info('Product created', { id: data.id, externalId });
  return { id: data.id || null };
}

/**
 * Deleta produto do catálogo AbacatePay v2.
 */
export async function deleteAbacateProduct(productId) {
  if (!abacateEnabled() || !productId) return false;

  const r = await fetchWithTimeout(`${ABACATE_URL}/products/delete`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ABACATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: { id: productId } })
  });

  if (!r.ok) {
    log.warn('Delete product failed', { status: r.status });
    return false;
  }
  return true;
}
