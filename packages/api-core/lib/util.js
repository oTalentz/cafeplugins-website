// Helpers utilitários
import { randomBytes } from 'node:crypto';

export function uid(prefix = '') {
  // MED-12 FIX: 16 chars de random bytes hex (16^16 ≈ 10^19) — não enumerável
  return prefix + randomBytes(8).toString('hex');
}

export function licenseKey() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => {
    const bytes = randomBytes(4);
    return Array.from({ length: 4 }, (_, i) => a[bytes[i] % a.length]).join('');
  };
  return `PF-${seg()}-${seg()}-${seg()}`;
}

export function randomToken(n = 16) {
  return randomBytes(n).toString('hex');
}

export function loginCode6() {
  // CSPRNG, não Math.random
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

export function generateAffCode(name) {
  // Mantém semântica (baseado no nome) mas com sufixo aleatório de 4 chars
  // para tornar o código não-previsível a partir do nome.
  const base = (name || 'afiliado')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'AFILIADO';
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  return `${base}${suffix}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

export function isValidEmail(s) {
  // RFC simplificado: tem @, tem . depois do @, sem espaços
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}

export function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

export function sanitizeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}
