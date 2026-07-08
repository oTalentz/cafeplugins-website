// =====================================================
//  cafe plugins - Configuração centralizada
//  Constantes usadas em rotas/lib (não armazena credenciais)
// =====================================================

// URLs e domínios
export const APP_URL = process.env.APP_URL || 'https://cafeplugins.com';
export const CORS_ORIGINS = (process.env.CORS_ORIGIN || APP_URL)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// AbacatePay
export const ABACATE_URL = process.env.ABACATE_URL || 'https://api.abacatepay.com/v2';
export const ABACATE_TIMEOUT_MS = 8000;

// Brevo
export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

// Taxa fixa do gateway de pagamento (AbacatePay PIX por transação).
// Em R$, cobrada do valor recebido na transação.
// Configurável via env: GATEWAY_FEE_FIXED (em reais, ex: "0.80")
export const GATEWAY_FEE_FIXED = (() => {
  const v = Number(process.env.GATEWAY_FEE_FIXED);
  return isFinite(v) && v >= 0 ? +v.toFixed(2) : 0.80;
})();

// Alíquota de imposto sobre o faturamento da loja (Simples Nacional, etc).
// Decimal: 0.06 = 6%. Configurável via env: TAX_RATE (decimal, ex: "0.06" ou "0")
// Por padrão 0 (não desconta imposto da comissão, conforme decisão do produto).
export const TAX_RATE = (() => {
  const v = Number(process.env.TAX_RATE);
  return isFinite(v) && v >= 0 && v <= 1 ? +v : 0;
})();

// Comissão de afiliado aplicada sobre o valor LÍQUIDO (após taxa do gateway).
// Se false, aplica sobre o valor bruto (subtotal). Para preservar margem da loja,
// o default é true. Configurável via env: AFFILIATE_NET_COMMISSION ("false" desliga).
export const AFFILIATE_NET_COMMISSION = (() => {
  const v = String(process.env.AFFILIATE_NET_COMMISSION || 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
})();

// Mínimo para saque de afiliado (em R$).
// Evita saques com valor inferior ao custo de uma tx PIX de saída (~R$ 0,80).
export const MIN_PAYOUT = (() => {
  const v = Number(process.env.MIN_PAYOUT);
  return isFinite(v) && v >= 0 ? +v.toFixed(2) : 10;
})();

// Valor máximo de comissão manual que admin pode adicionar (proteção contra erro).
export const MAX_MANUAL_COMMISSION = (() => {
  const v = Number(process.env.MAX_MANUAL_COMMISSION);
  return isFinite(v) && v > 0 ? +v : 10000;
})();

// Validação de telefone brasileiro
export const PHONE_MIN_DIGITS = 10;
export const PHONE_MAX_DIGITS = 11;

// Soma do que entra na conta da loja por transação PIX, descontando gateway.
// Usado em exibição apenas — cálculo real fica em fees.js.
export function getEffectiveFeeDescription() {
  const parts = [];
  if (GATEWAY_FEE_FIXED > 0) parts.push(`Taxa gateway R$ ${GATEWAY_FEE_FIXED.toFixed(2)}`);
  if (TAX_RATE > 0) parts.push(`Impostos ${(TAX_RATE * 100).toFixed(1)}%`);
  return parts.length === 0 ? 'Sem taxas descontadas' : parts.join(' + ');
}
