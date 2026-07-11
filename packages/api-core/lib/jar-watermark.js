import jwt from 'jsonwebtoken';
import AdmZip from 'adm-zip';
import { createLogger } from './logger.js';

const log = createLogger('jar-watermark');

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

/**
 * Gera uma build personalizada (watermark) do JAR para um comprador.
 *
 * O watermark é um JWT assinado com RS256 (mesma chave da API de licença)
 * inserido dentro do JAR em `/cafe-watermark.jwt`. Ele contém:
 * licenseKey, orderId, buyerEmail, productId e issuedAt.
 *
 * O plugin Java lê esse arquivo e valida com a chave pública. Como o JWT
 * é assinado pelo backend, o cliente não pode alterar o watermark; se o
 * JAR vazar, dá para rastrear qual pedido/origem vazou.
 */
export async function createWatermarkedJar({ originalUrl, licenseKey, orderId, buyerEmail, productId }) {
  if (!LICENSE_PRIVATE_KEY) {
    throw new Error('LICENSE_PRIVATE_KEY não configurado');
  }
  if (!originalUrl || !licenseKey || !orderId || !productId) {
    throw new Error('Parâmetros insuficientes para gerar JAR watermarkado');
  }

  log.info('gerando build watermarkada', { orderId, productId, buyerEmail });

  const res = await fetch(originalUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Falha ao baixar JAR original: ${res.status} ${res.statusText}`);
  }

  const jarBuffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(jarBuffer);

  const watermark = jwt.sign(
    {
      licenseKey,
      orderId,
      buyerEmail: buyerEmail || '',
      productId,
      issuedAt: new Date().toISOString()
    },
    LICENSE_PRIVATE_KEY,
    {
      algorithm: 'RS256',
      expiresIn: '10y',
      issuer: 'cafe-plugins',
      audience: productId
    }
  );

  // Remove watermark antigo se existir (re-download)
  zip.deleteFile('cafe-watermark.jwt');
  zip.addFile('cafe-watermark.jwt', Buffer.from(watermark, 'utf-8'));

  const out = zip.toBuffer();
  log.info('build watermarkada gerada', { orderId, productId, size: out.length });
  return out;
}

export function filenameForDownload({ productName, productId }) {
  const safe = String(productName || productId)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}-licenciado.jar`;
}
