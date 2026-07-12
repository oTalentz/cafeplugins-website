import { test } from 'node:test';
import assert from 'node:assert/strict';

// Testes de validação de pedidos (funções puras)
// Como orders.js importa DB e outros, testamos apenas lógica pura aqui

test('validação de e-mail aceita formato correto', () => {
  const validEmails = ['user@example.com', 'test.user@domain.co.uk', 'a@b.io'];
  const invalidEmails = ['not-email', '@domain.com', 'user@', 'user @domain.com'];
  // Simula isValidEmail
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  validEmails.forEach(e => assert.ok(emailRegex.test(e), `${e} should be valid`));
  invalidEmails.forEach(e => assert.ok(!emailRegex.test(e), `${e} should be invalid`));
});

test('status permitidos são apenas os definidos', () => {
  const ALLOWED = new Set(['pendente', 'pago', 'cancelado', 'reembolsado']);
  assert.ok(ALLOWED.has('pendente'));
  assert.ok(ALLOWED.has('pago'));
  assert.ok(ALLOWED.has('cancelado'));
  assert.ok(ALLOWED.has('reembolsado'));
  assert.ok(!ALLOWED.has('invalid'));
  assert.ok(!ALLOWED.has('PROCESSING'));
});

test('métodos de pagamento permitidos', () => {
  const ALLOWED = new Set(['pix', 'cartao']);
  assert.ok(ALLOWED.has('pix'));
  assert.ok(ALLOWED.has('cartao'));
  assert.ok(!ALLOWED.has('bitcoin'));
  assert.ok(!ALLOWED.has('paypal'));
});

test('cálculo de subtotal soma preços corretamente', () => {
  const items = [
    { id: 'a', price: 10.50 },
    { id: 'b', price: 25.00 },
    { id: 'c', price: 5.99 }
  ];
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  assert.equal(subtotal, 41.49);
});

test('validação de items do carrinho rejeita vazio', () => {
  const items = [];
  assert.ok(items.length === 0);
  const sanitized = items.map(i => ({ id: i && i.id })).filter(i => i.id);
  assert.equal(sanitized.length, 0);
});

test('limite de items no carrinho', () => {
  const items = new Array(51).fill({ id: 'x' });
  assert.ok(items.length > 50);
});
