import { test } from 'node:test';
import assert from 'node:assert/strict';

// Testes das funções de auth que não precisam de DB
// Como auth.js importa bcrypt e jwt, testamos indiretamente

test('senha com bcrypt hash e compare funciona', async () => {
  const bcrypt = await import('bcryptjs');
  const hash = bcrypt.hashSync('test123', 10);
  assert.ok(hash);
  assert.ok(bcrypt.compareSync('test123', hash));
  assert.ok(!bcrypt.compareSync('wrong', hash));
});

test('JWT sign e verify funciona', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const secret = 'test-secret-at-least-32-characters-long!!';
  const token = jwt.sign({ userId: 'u-123', role: 'admin' }, secret, { expiresIn: '1h' });
  const decoded = jwt.verify(token, secret);
  assert.equal(decoded.userId, 'u-123');
  assert.equal(decoded.role, 'admin');
});

test('JWT com secret errado falha', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const secret = 'test-secret-at-least-32-characters-long!!';
  const token = jwt.sign({ userId: 'u-123' }, secret, { expiresIn: '1h' });
  assert.throws(() => jwt.verify(token, 'wrong-secret'));
});

test('JWT expirado falha', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const secret = 'test-secret-at-least-32-characters-long!!';
  const token = jwt.sign({ userId: 'u-123' }, secret, { expiresIn: '0s' });
  // Espera um pouco para expirar
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.throws(() => jwt.verify(token, secret));
});
