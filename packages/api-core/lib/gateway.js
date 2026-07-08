// =====================================================
//  Gateway de pagamento (Abstração)
//
//  Seleciona Mercado Pago ou AbacatePay conforme env:
//  - PAYMENT_GATEWAY=mercadopago ou PAYMENT_GATEWAY=abacate
//  - Se não definido, prefere Mercado Pago se MERCADOPAGO_ACCESS_TOKEN existir,
//    senão AbacatePay se ABACATE_API_KEY existir, senão manual.
// =====================================================

import {
  createPixCharge as createAbacatePix,
  createCardCheckout as createAbacateCard,
  checkPaymentStatus as checkAbacateStatus,
  verifyWebhookSignature as verifyAbacateSignature
} from './payments.js';
import {
  createPixCharge as createMercadoPagoPix,
  createCardCheckout as createMercadoPagoCard,
  getOrder as getMercadoPagoOrder,
  getPayment as getMercadoPagoPayment,
  searchOrderByExternalReference as searchMercadoPagoOrder,
  searchPaymentByExternalReference,
  isPaidStatus,
  mercadoPagoEnabled,
  verifyWebhookSignature as verifyMercadoPagoSignature
} from './mercadopago.js';
import { createLogger } from './logger.js';

const log = createLogger('gateway');

export function paymentGateway() {
  const configured = String(process.env.PAYMENT_GATEWAY || '').toLowerCase();
  if (configured === 'mercadopago') return 'mercadopago';
  if (configured === 'abacate') return 'abacate';
  if (configured === 'manual') return 'manual';
  if (mercadoPagoEnabled()) return 'mercadopago';
  if (process.env.ABACATE_API_KEY) return 'abacate';
  return 'manual';
}

export function pixEnabled() {
  return paymentGateway() !== 'manual';
}

export function cardEnabled() {
  const g = paymentGateway();
  return g === 'mercadopago' || (g === 'abacate' && process.env.ABACATE_API_KEY);
}

export async function createPixCharge(args) {
  const g = paymentGateway();
  if (g === 'mercadopago') return createMercadoPagoPix(args);
  if (g === 'abacate') return createAbacatePix(args);
  return {
    stub: true,
    pixQrCode: process.env.MANUAL_PIX_KEY || '0'.repeat(64),
    pixQrImage: null,
    method: 'manual',
    message: 'Pagamento manual (gateway não configurado). Pague via PIX e aguarde a confirmação do admin.'
  };
}

export async function createCardCheckout(args) {
  const g = paymentGateway();
  if (g === 'mercadopago') return createMercadoPagoCard(args);
  if (g === 'abacate') return createAbacateCard(args);
  return null;
}

export async function checkPaymentStatus(paymentId, orderId) {
  const g = paymentGateway();
  if (g === 'mercadopago') {
    let result = null;
    if (paymentId) {
      // Tenta como Orders API (ORD...) ou legacy payment id
      result = await getMercadoPagoOrder(paymentId).catch(e => {
        log.warn('MP get order failed', { paymentId, error: e.message });
        return null;
      });
      if (!result) {
        result = await getMercadoPagoPayment(paymentId).catch(e => {
          log.warn('MP get payment failed', { paymentId, error: e.message });
          return null;
        });
      }
    }
    if (!result && orderId) {
      result = await searchMercadoPagoOrder(orderId).catch(e => {
        log.warn('MP search order failed', { orderId, error: e.message });
        return null;
      });
      if (!result) {
        result = await searchPaymentByExternalReference(orderId).catch(e => {
          log.warn('MP search payment failed', { orderId, error: e.message });
          return null;
        });
      }
    }
    if (!result) return null;
    return {
      id: result.id,
      status: result.status,
      status_detail: result.status_detail,
      external_reference: result.external_reference,
      paid: isPaidStatus(result.status, result.status_detail)
    };
  }
  if (g === 'abacate') {
    const s = await checkAbacateStatus(paymentId).catch(() => null);
    if (!s) return null;
    return { ...s, paid: isAbacatePaid(s.status) };
  }
  return null;
}

function isAbacatePaid(status) {
  const s = String(status || '').toLowerCase();
  return s === 'paid' || s === 'approved' || s === 'confirmed' || s === 'completed' || s === 'accredited';
}

export function verifyWebhookSignature(rawBody, signature, secret) {
  return verifyAbacateSignature(rawBody, signature, secret);
}

export function verifyMercadoPagoWebhook({ xSignature, xRequestId, dataId, secret }) {
  return verifyMercadoPagoSignature(xSignature, xRequestId, dataId, secret);
}
