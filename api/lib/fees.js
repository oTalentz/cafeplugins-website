// =====================================================
//  cafe plugins - Cálculo de comissão e taxas
//  Garante que a loja não saia no prejuízo pagando afiliado
//  ao descontar gateway + impostos do valor bruto.
// =====================================================

import { GATEWAY_FEE_FIXED, TAX_RATE, AFFILIATE_NET_COMMISSION } from './config.js';

/**
 * Calcula o breakdown de uma venda:
 *  - subtotal (preço bruto)
 *  - gatewayFee (taxa fixa do gateway em R$)
 *  - taxAmount (impostos sobre o subtotal em R$)
 *  - netAmount (líquido que a loja recebe antes da comissão)
 *  - commissionRate (% aplicado)
 *  - commission (valor que o afiliado recebe)
 *  - storeNet (líquido final da loja após pagar afiliado)
 *
 * @param {number} subtotal - preço total do pedido em R$ (já validado)
 * @param {number} rate - % de comissão do afiliado (ex: 25)
 * @param {object} [opts]
 * @param {number} [opts.gatewayFee] - override da taxa do gateway
 * @param {number} [opts.taxRate] - override do imposto
 * @param {boolean} [opts.netCommission] - se true, comissão é sobre o líquido
 * @returns {object} { subtotal, gatewayFee, taxAmount, netAmount, commissionRate, commission, storeNet, affiliateNet, storeKeeps }
 */
export function calculateBreakdown(subtotal, rate, opts = {}) {
  const sub = round2(Number(subtotal) || 0);
  const r = clamp(Number(rate) || 0, 0, 100);
  const gw = round2(opts.gatewayFee != null ? Number(opts.gatewayFee) : GATEWAY_FEE_FIXED);
  const tax = clamp(opts.taxRate != null ? Number(opts.taxRate) : TAX_RATE, 0, 1);
  const netCommission = opts.netCommission != null ? Boolean(opts.netCommission) : AFFILIATE_NET_COMMISSION;

  const taxAmount = round2(sub * tax);
  const netAmount = round2(Math.max(0, sub - gw - taxAmount));
  const commissionRaw = netCommission ? netAmount * (r / 100) : sub * (r / 100);
  const commission = round2(Math.max(0, commissionRaw));
  // Garante que comissão nunca exceda o líquido (loja nunca paga mais do que recebe)
  const safeCommission = Math.min(commission, netAmount);
  // storeKeeps = subtotal − taxa gateway − comissão. Se subtotal < taxa, isso seria negativo
  // (transação inviável — gateway nem aceita), mas usamos Math.max(0, ...) na exibição.
  const finalStoreKeeps = round2(sub - gw - taxAmount - safeCommission);
  const transactionViable = sub > gw;

  return {
    subtotal: sub,
    gatewayFee: round2(gw),
    taxAmount,
    taxRate: tax,
    netAmount,
    commissionRate: r,
    commission: safeCommission,
    storeNet: finalStoreKeeps,
    affiliateNet: safeCommission,
    transactionViable,
    // Mantém compat com chamadas legadas
    raw: {
      gross_commission: round2(sub * (r / 100)),
      net_commission: round2(netAmount * (r / 100))
    }
  };
}

/**
 * Atalho: retorna só o valor da comissão para gravar em orders.commission
 * e creditar em total_earned.
 */
export function calculateCommission(subtotal, rate, opts) {
  return calculateBreakdown(subtotal, rate, opts).commission;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
