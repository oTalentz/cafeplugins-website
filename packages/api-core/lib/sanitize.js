// =====================================================
//  Sanitização de HTML e strings
//  Pensado para escapar entradas do usuário antes de
//  armazenar OU de injetar em HTML de email/template.
// =====================================================

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

export function escapeHtml(input) {
  if (input == null) return '';
  const s = String(input);
  return s.replace(/[&<>"'`=\/]/g, (c) => HTML_ESCAPE_MAP[c]);
}

const SCRIPT_RE = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const HTML_TAG_RE = /<\/?[a-z][\s\S]*?>/gi;

export function stripHtml(input, { allowNewlines = false } = {}) {
  if (input == null) return '';
  let s = String(input);
  s = s.replace(SCRIPT_RE, '');
  s = s.replace(HTML_TAG_RE, '');
  if (!allowNewlines) s = s.replace(/[\r\n]+/g, ' ');
  return s.trim();
}

// Sanitiza o que vai pro DB: remove tags perigosas, mas mantém acentos/espaços.
// Use para campos de TEXTO CURTO (nomes, títulos, descrições, categorias, etc).
// Limites duros para evitar payloads gigantes.
export function sanitizeText(input, { max = 500, multiline = false } = {}) {
  if (input == null) return '';
  let s = String(input);
  // Decodifica entidades HTML (&lt; &gt; &amp; &quot; &#39; &#xHH;) ANTES de remover tags
  // para evitar bypass via "entidade → tag" (vetor de XSS em innerHTML).
  s = decodeHtmlEntities(s);
  s = stripHtml(s, { allowNewlines: multiline });
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

function decodeHtmlEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d{1,7});/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// URLs: aceita só http(s) e mailto. Bloqueia javascript:, data:, vbscript:, file:.
// Retorna string vazia se inválida.
export function sanitizeUrl(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const proto = u.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'mailto:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function sanitizeIdentifier(input, { max = 64, pattern = /^[A-Za-z0-9_-]+$/ } = {}) {
  const s = String(input || '').trim().slice(0, max);
  if (!s || !pattern.test(s)) return '';
  return s;
}

export function sanitizeDownloadToken(input) {
  const s = String(input || '').trim();
  return /^[a-f0-9]{64}$/i.test(s) ? s : '';
}

export function sanitizePixKey(input) {
  const s = sanitizeText(input, { max: 200 });
  if (!s || s.length < 3 || s.length > 200) return '';
  if (!/^[\w@.+:\/\-\s]+$/u.test(s)) return '';
  return s;
}

// Limites razoáveis para um e-commerce
export const LIMITS = {
  name: 80,
  tagline: 140,
  description: 4000,
  category: 40,
  version: 20,
  badge: 20,
  email: 254,
  password: 128,
  passwordMin: 12, // MED-23: mínimo 12 chars em produção
  notes: 500,
  downloadUrl: 2048,
  imageUrl: 2048,
  videoUrl: 2048
};
