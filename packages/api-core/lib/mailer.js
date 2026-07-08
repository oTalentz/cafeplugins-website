// =====================================================
//  Mailer - Brevo (ex-Sendinblue) API
//  Documentação: https://developers.brevo.com/reference/sendtransacemail
//
//  Se BREVO_API_KEY não estiver definida, o mailer opera em
//  "stub mode": registra o conteúdo no console + log de atividade.
//  Ideal para desenvolvimento sem perder nenhum e-mail.
//
//  IMPORTANTE: todo conteúdo dinâmico passado para HTML é
//  escapado com escapeHtml() para prevenir XSS em emails.
// =====================================================

import { escapeHtml } from './sanitize.js';
import { createLogger } from './logger.js';
import { BREVO_URL } from './config.js';

const log = createLogger('mailer');

export function mailerEnabled() {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
}

export async function sendMail({ to, subject, html, text }) {
  if (!mailerEnabled()) {
    log.info('STUB mode', { to, subject, text: (text || '').slice(0, 200) });
    return { stubbed: true };
  }
  const body = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'cafe plugins',
      email: process.env.BREVO_SENDER_EMAIL
    },
    to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text
  };
  const r = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Brevo error ${r.status}: ${err}`);
  }
  return r.json();
}

export function loginCodeEmail({ code, email, purpose = 'login' }) {
  const title = purpose === 'reset' ? 'Redefini\u00e7\u00e3o de senha' : 'Seu c\u00f3digo de acesso';
  const safeCode = escapeHtml(code);
  const html = `
    <div style="font-family:Inter,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:24px; background:#0a0a0a; color:#fafafa; border-radius:12px">
      <h2 style="margin:0 0 8px; color:#fafafa; font-weight:600">${title}</h2>
      <p style="color:#a0a0a0; margin:0 0 24px; font-size:14px">
        Use o c&oacute;digo abaixo para ${purpose === 'reset' ? 'redefinir sua senha' : 'acessar sua conta'}. V&aacute;lido por 10 minutos.
      </p>
      <div style="background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; padding:24px; text-align:center; margin-bottom:16px">
        <div style="font-family:ui-monospace,Menlo,monospace; font-size:32px; font-weight:700; letter-spacing:0.3em; color:#fafafa">${safeCode}</div>
      </div>
      <p style="color:#606060; font-size:12px; margin:0">Se voc&ecirc; n&atilde;o fez essa solicita&ccedil;&atilde;o, ignore este e-mail.</p>
    </div>
  `;
  const text = `${title}\n\nSeu c\u00f3digo: ${code}\nV\u00e1lido por 10 minutos.\n\nSe voc\u00ea n\u00e3o fez essa solicita\u00e7\u00e3o, ignore este e-mail.`;
  return { subject: `[cafe plugins] ${title}`, html, text };
}

export function verifyEmail({ code, email }) {
  const safeCode = escapeHtml(code);
  const safeEmail = escapeHtml(email);
  const html = `
    <div style="font-family:Inter,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:24px; background:#0a0a0a; color:#fafafa; border-radius:12px">
      <h2 style="margin:0 0 8px; color:#fafafa; font-weight:600">Confirme seu e-mail</h2>
      <p style="color:#a0a0a0; margin:0 0 24px; font-size:14px">
        Ol&aacute;! Use o c&oacute;digo abaixo para confirmar que <strong>${safeEmail}</strong> &eacute; seu e-mail.
        V&aacute;lido por 10 minutos.
      </p>
      <div style="background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; padding:24px; text-align:center; margin-bottom:16px">
        <div style="font-family:ui-monospace,Menlo,monospace; font-size:32px; font-weight:700; letter-spacing:0.3em; color:#fafafa">${safeCode}</div>
      </div>
      <p style="color:#a0a0a0; font-size:13px; margin:0 0 4px">Por qu&ecirc; pedimos isso?</p>
      <p style="color:#808080; font-size:12px; margin:0 0 12px">
        Para proteger sua conta e garantir que voc&ecirc; receba downloads e comprovantes de compra.
      </p>
      <p style="color:#606060; font-size:12px; margin:16px 0 0">Se voc&ecirc; n&atilde;o criou uma conta, ignore este e-mail.</p>
    </div>
  `;
  const text = `Confirme seu e-mail\n\nSeu codigo: ${code}\nValido por 10 minutos.\n\nSe voce nao criou uma conta, ignore este e-mail.`;
  return { subject: '[cafe plugins] Confirme seu e-mail', html, text };
}

export function orderPaidEmail({ order, buyer, products }) {
  const safeName = escapeHtml(buyer.name);
  const itemsHtml = products.map(p => `
    <tr><td style="padding:8px; border-bottom:1px solid #2a2a2a">${escapeHtml(p.name)}</td><td style="padding:8px; text-align:right; border-bottom:1px solid #2a2a2a">R$ ${Number(p.price).toFixed(2)}</td></tr>
  `).join('');
  const total = products.reduce((s, p) => s + Number(p.price || 0), 0);
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  const downloadLink = order.download_token ? `${baseUrl}/download.html?t=${encodeURIComponent(order.download_token)}` : `${baseUrl}/account.html`;
  const safeOrderId = escapeHtml(order.id);
  const safeLicense = escapeHtml(order.license_key || '');
  const html = `
    <div style="font-family:Inter,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:24px; background:#0a0a0a; color:#fafafa; border-radius:12px">
      <h2 style="margin:0 0 8px">Pagamento confirmado</h2>
      <p style="color:#a0a0a0; font-size:14px">Oi, ${safeName}! Seus plugins est&atilde;o prontos para download.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px">${itemsHtml}</table>
      <p style="font-size:18px; font-weight:600; text-align:right; margin:0 0 16px">Total: R$ ${total.toFixed(2)}</p>
      <p style="text-align:center; margin:24px 0 0">
        <a href="${escapeHtml(downloadLink)}" style="background:#fafafa; color:#0a0a0a; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600; display:inline-block">Baixar meus plugins</a>
      </p>
      <p style="text-align:center; margin:12px 0 0; font-size:12px">
        <a href="${escapeHtml(baseUrl + '/account.html')}" style="color:#a0a0a0; text-decoration:underline">ou acessar minha conta</a>
      </p>
      <p style="color:#606060; font-size:12px; margin-top:24px">Pedido #${safeOrderId} &middot; Licen&ccedil;a: <code>${safeLicense}</code></p>
    </div>
  `;
  return { subject: '[cafe plugins] Pagamento confirmado', html };
}
