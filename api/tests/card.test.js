// Testes do fluxo de cartão (AbacatePay v2).
// Usa node:test (built-in, sem dependências).
// Mocka as chamadas de rede para AbacatePay via stubs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== Mock de fetch (antes de importar payments.js) =====
const originalFetch = globalThis.fetch;
let fetchMock = null;

function mockFetch(handler) {
  fetchMock = handler;
  globalThis.fetch = async (url, opts) => handler(url, opts);
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  fetchMock = null;
}

// Helper para criar um Response-like
function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

// ===== Setup: forçar ABACATE_API_KEY para entrar no modo "habilitado" =====
process.env.ABACATE_API_KEY = 'test_key_abc';
process.env.ABACATE_URL = ''; // força default
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-chars-aaaa';

// ===== Importações dinâmicas (após mock) =====
const { calculateBreakdown } = await import('../lib/fees.js');
const { createCardCheckout, abacateEnabled, createAbacateProduct, verifyWebhookSignature } = await import('../lib/payments.js');

// ====================================================================
test('abacateEnabled retorna true com ABACATE_API_KEY setada', () => {
  assert.equal(abacateEnabled(), true);
});

// ====================================================================
test('fees: R$ 25 com afiliado 25% → comissão R$ 6,05 (líquido)', () => {
  const b = calculateBreakdown(25, 25);
  assert.equal(b.subtotal, 25);
  assert.equal(b.gatewayFee, 0.8);
  assert.equal(b.netAmount, 24.2);
  assert.equal(b.commission, 6.05);
  assert.equal(b.commissionRate, 25);
  assert.equal(b.storeNet, 18.15);
  assert.equal(b.transactionViable, true);
});

// ====================================================================
test('fees: comissão nunca excede o líquido (loja protegida)', () => {
  // R$ 0,50 com taxa R$ 0,80 → líquido negativo → comissão = 0
  const b = calculateBreakdown(0.5, 25);
  assert.equal(b.commission, 0);
  assert.equal(b.netAmount, 0);
  assert.equal(b.transactionViable, false);
});

// ====================================================================
test('fees: TAX_RATE 6% desconta do líquido', () => {
  const b = calculateBreakdown(100, 25, { taxRate: 0.06 });
  assert.equal(b.taxAmount, 6);
  assert.equal(b.netAmount, 93.2);
  assert.equal(b.commission, 23.3);
});

// ====================================================================
test('createCardCheckout: retorna checkoutUrl do campo data.url (v2)', async () => {
  let called = null;
  mockFetch((url, opts) => {
    called = { url, opts };
    return makeResponse(200, {
      data: {
        id: 'checkout_abc123',
        url: 'https://pay.abacatepay.com/checkout_abc123',
        status: 'PENDING'
      },
      success: true
    });
  });
  try {
    const r = await createCardCheckout({
      orderId: 'ord-test1234',
      amount: 25,
      description: 'Pedido teste',
      customer: { name: 'Cliente Teste', email: 'cliente@x.com', cellphone: '11999998888' },
      redirectUrl: 'https://cafeplugins.com/account.html',
      abacateItems: [{ id: 'prod_abc', quantity: 1 }]
    });
    assert.equal(called.url, 'https://api.abacatepay.com/v2/checkouts/create');
    assert.equal(r.checkoutUrl, 'https://pay.abacatepay.com/checkout_abc123');
    assert.equal(r.paymentId, 'checkout_abc123');
    assert.equal(r.raw.id, 'checkout_abc123');
  } finally {
    restoreFetch();
  }
});

// ====================================================================
test('createCardCheckout: com customer completo, envia name/cellphone/email', async () => {
  let sentBody = null;
  mockFetch((url, opts) => {
    sentBody = JSON.parse(opts.body);
    return makeResponse(200, {
      data: { id: 'checkout_x', url: 'https://pay.abacatepay.com/x' }
    });
  });
  try {
    await createCardCheckout({
      orderId: 'ord-test',
      amount: 10,
      description: 'teste',
      customer: { name: 'Maria', email: 'maria@x.com', cellphone: '11988887777' },
      redirectUrl: 'https://x.com/return',
      abacateItems: [{ id: 'p1', quantity: 1 }]
    });
    assert.equal(sentBody.data.customer.name, 'Maria');
    assert.equal(sentBody.data.customer.cellphone, '11988887777');
    assert.equal(sentBody.data.customer.email, 'maria@x.com');
    assert.deepEqual(sentBody.data.methods, ['CARD']);
    assert.equal(sentBody.data.returnUrl, 'https://x.com/return');
    assert.equal(sentBody.data.metadata.orderId, 'ord-test');
    // Items: deve usar abacateItems (com id de produto)
    assert.equal(sentBody.data.items[0].id, 'p1');
    assert.equal(sentBody.data.items[0].quantity, 1);
  } finally {
    restoreFetch();
  }
});

// ====================================================================
test('createCardCheckout: 4xx do gateway → throw com mensagem', async () => {
  mockFetch((url, opts) => makeResponse(400, {
    error: { message: 'Invalid customer.taxId' }
  }));
  try {
    await assert.rejects(
      () => createCardCheckout({
        orderId: 'ord-1',
        amount: 10,
        description: 't',
        customer: { name: 'A', email: 'a@x.com', cellphone: '11988887777' },
        abacateItems: [{ id: 'p1', quantity: 1 }]
      }),
      /taxId|Invalid/
    );
  } finally {
    restoreFetch();
  }
});

// ====================================================================
test('createCardCheckout: resposta OK mas sem url → retorna null', async () => {
  mockFetch(() => makeResponse(200, { data: { id: 'abc' } }));
  try {
    const r = await createCardCheckout({
      orderId: 'ord-1',
      amount: 10,
      description: 't',
      customer: { name: 'A', email: 'a@x.com' },
      abacateItems: [{ id: 'p1', quantity: 1 }]
    });
    assert.equal(r, null);
  } finally {
    restoreFetch();
  }
});

// ====================================================================
test('createAbacateProduct: cria produto no catálogo', async () => {
  let called = null;
  mockFetch((url, opts) => {
    called = { url, opts };
    return makeResponse(200, { data: { id: 'prod_xyz' } });
  });
  try {
    const r = await createAbacateProduct({
      externalId: 'pf-001',
      name: 'CrystalPvP',
      price: 29.9,
      description: 'Plugin PvP',
      imageUrl: 'https://x.com/i.png'
    });
    assert.equal(called.url, 'https://api.abacatepay.com/v2/products/create');
    const body = JSON.parse(called.opts.body);
    assert.equal(body.data.externalId, 'pf-001');
    assert.equal(body.data.name, 'CrystalPvP');
    assert.equal(body.data.price, 2990); // centavos
    assert.equal(body.data.currency, 'BRL');
    assert.equal(r.id, 'prod_xyz');
  } finally {
    restoreFetch();
  }
});

// ====================================================================
test('createAbacateProduct: passa AbortController.signal para o fetch (permite timeout)', async () => {
  // Validação indireta: garante que o fetch recebe um signal.
  // Se um dia o signal for removido, esse teste falha (regressão).
  let receivedSignal = null;
  mockFetch((url, opts) => {
    receivedSignal = opts && opts.signal;
    return makeResponse(200, { data: { id: 'p_x' } });
  });
  try {
    await createAbacateProduct({ externalId: 'p', name: 'X', price: 10 });
    assert.ok(receivedSignal, 'fetch deveria ter recebido um signal');
    assert.ok(receivedSignal instanceof AbortSignal, 'signal deve ser AbortSignal');
  } finally {
    restoreFetch();
  }
});

test('verifyWebhookSignature: HMAC válido', async () => {
  const { createHmac } = await import('node:crypto');
  const secret = 'whsec_test_1234567890';
  const body = '{"event":"billing.paid","data":{}}';
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, sig, secret), true);
  // signature errada
  assert.equal(verifyWebhookSignature(body, 'a'.repeat(64), secret), false);
  // secret errado (mas mesmo length)
  const wrongSig = createHmac('sha256', 'other').update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, wrongSig, secret), false);
  // sem signature
  assert.equal(verifyWebhookSignature(body, null, secret), false);
  // signature de tamanho diferente
  assert.equal(verifyWebhookSignature(body, 'short', secret), false);
});
