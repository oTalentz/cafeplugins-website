import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText, sanitizeUrl, sanitizeIdentifier, sanitizeDownloadToken, escapeHtml, stripHtml, LIMITS } from 'api-core/lib/sanitize.js';

test('escapeHtml escapa caracteres perigosos', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
  assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(escapeHtml("'apostrophe'"), '&#39;apostrophe&#39;');
});

test('stripHtml remove tags HTML', () => {
  assert.equal(stripHtml('<p>texto</p>'), 'texto');
  assert.equal(stripHtml('<script>alert(1)</script>hello'), 'hello');
  assert.equal(stripHtml('<b>bold</b> <i>italic</i>'), 'bold italic');
});

test('sanitizeText remove caracteres de controle', () => {
  assert.equal(sanitizeText('hello\x00world'), 'helloworld');
  assert.equal(sanitizeText('normal text'), 'normal text');
});

test('sanitizeText respeita limite max', () => {
  const long = 'a'.repeat(500);
  const result = sanitizeText(long, { max: 100 });
  assert.ok(result.length <= 100);
});

test('sanitizeUrl aceita apenas http(s) e mailto', () => {
  assert.ok(sanitizeUrl('https://example.com'));
  assert.ok(sanitizeUrl('http://example.com'));
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('data:text/html,<script>'), '');
  assert.equal(sanitizeUrl('ftp://example.com'), '');
});

test('sanitizeIdentifier rejeita caracteres especiais', () => {
  assert.equal(sanitizeIdentifier('abc123'), 'abc123');
  assert.equal(sanitizeIdentifier('abc-123_def'), 'abc-123_def');
  assert.equal(sanitizeIdentifier('abc 123'), '');
  assert.equal(sanitizeIdentifier('abc;DROP TABLE'), '');
});

test('sanitizeDownloadToken valida hex de 64 chars', () => {
  const valid = 'a'.repeat(64);
  assert.equal(sanitizeDownloadToken(valid), valid);
  assert.equal(sanitizeDownloadToken('short'), '');
  assert.equal(sanitizeDownloadToken('g'.repeat(64)), ''); // g nao é hex
});

test('LIMITS tem valores definidos', () => {
  assert.ok(LIMITS.name > 0);
  assert.ok(LIMITS.description > 0);
  assert.ok(LIMITS.tagline > 0);
});
