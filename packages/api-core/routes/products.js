import { Router } from 'express';
import { get, all, run } from 'api-core/lib/db.js';
import { requireAdmin } from 'api-core/lib/auth.js';
import { uid, nowISO } from 'api-core/lib/util.js';
import { sanitizeIdentifier, sanitizeText, sanitizeUrl, LIMITS } from 'api-core/lib/sanitize.js';
import { createAbacateProduct, deleteAbacateProduct } from 'api-core/lib/payments.js';
import { createLogger } from 'api-core/lib/logger.js';
import { embedPublicKeyInJar, uploadJarToGitHubRelease, fetchOriginalJar } from 'api-core/lib/jar-watermark.js';
import { auditLog } from 'api-core/lib/audit.js';

const router = Router();
const log = createLogger('products');

router.get('/', async (req, res) => {
  try {
    log.info('fetching products');
    const rows = await all('SELECT * FROM products WHERE active = 1 ORDER BY name');
    log.info('products fetched', { count: rows.length });
    res.json({ products: rows.map(p => serialize(p, { admin: false })) });
  } catch (err) {
    log.error('products fetch error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

router.get('/all', requireAdmin, async (req, res) => {
  const rows = await all('SELECT * FROM products ORDER BY name');
  res.json({ products: rows.map(p => serialize(p, { admin: true })) });
});

router.get('/:id', async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const p = await get('SELECT * FROM products WHERE id = ? AND active = 1', [id]);
  if (!p) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json({ product: serialize(p, { admin: false }) });
});

function cleanProductBody(b) {
  return {
    name: sanitizeText(b.name, { max: LIMITS.name }),
    tagline: sanitizeText(b.tagline, { max: LIMITS.tagline }),
    description: sanitizeText(b.description, { max: LIMITS.description, multiline: true }),
    category: sanitizeText(b.category, { max: LIMITS.category }),
    version: sanitizeText(b.version, { max: LIMITS.version }),
    badge: sanitizeText(b.badge || '', { max: LIMITS.badge }) || null,
    video: sanitizeUrl(b.video || ''),
    image: sanitizeUrl(b.image || ''),
    coverImage: sanitizeUrl(b.coverImage || ''),
    downloadUrl: sanitizeUrl(b.downloadUrl || ''),
    price: Number(b.price),
    oldPrice: b.oldPrice != null && b.oldPrice !== '' ? Number(b.oldPrice) : null,
    stock: Number(b.stock ?? 999),
    maxDownloads: Number.isFinite(Number(b.maxDownloads)) ? Number(b.maxDownloads) : 5
  };
}

router.post('/', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nome é obrigatório' });
  const c = cleanProductBody(b);
  if (!isFinite(c.price) || c.price < 0) return res.status(400).json({ error: 'Preço inválido (precisa ser ≥ 0)' });
  if (c.oldPrice != null && (!isFinite(c.oldPrice) || c.oldPrice < 0)) {
    return res.status(400).json({ error: 'Preço antigo inválido' });
  }
  if (!isFinite(c.stock) || c.stock < 0 || c.stock > 999999) {
    return res.status(400).json({ error: 'Estoque inválido' });
  }
  if (!isFinite(c.maxDownloads) || c.maxDownloads < 1 || c.maxDownloads > 1000) {
    return res.status(400).json({ error: 'Limite de downloads inválido (1-1000)' });
  }
  const id = sanitizeIdentifier(b.id, { max: 64 }) || uid('pf-');
  const features = Array.isArray(b.features) ? b.features.slice(0, 20).map(f => sanitizeText(String(f), { max: 200 })) : [];
  await run(
    `INSERT INTO products (id, name, tagline, description, price, old_price, category, version, badge, features, stock, video, image, cover_image, download_url, max_downloads, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, c.name, c.tagline, c.description,
      c.price, c.oldPrice,
      c.category, c.version, c.badge,
      JSON.stringify(features),
      c.stock,
      c.video, c.image, c.coverImage, c.downloadUrl,
      c.maxDownloads,
      b.active === false ? 0 : 1,
      nowISO()
    ]
  );

  // Sync para AbacatePay (para checkout com cartão)
  let abacateProductId = null;
  let abacateSyncError = null;
  try {
    const result = await createAbacateProduct({
      externalId: id,
      name: c.name,
      price: c.price,
      description: c.description || c.tagline,
      imageUrl: c.image
    });
    if (result && result.id) {
      abacateProductId = result.id;
      await run('UPDATE products SET abacate_product_id = ? WHERE id = ?', [abacateProductId, id]);
    } else {
      abacateSyncError = 'AbacatePay não retornou ID do produto';
    }
  } catch (err) {
    abacateSyncError = err.message;
    console.warn('[products] AbacatePay sync failed (non-blocking):', err.message);
  }

  const created = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.json({
    product: serialize(created, { admin: true }),
    abacate: { synced: !!abacateProductId, id: abacateProductId, error: abacateSyncError }
  });
});

router.put('/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const existing = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Produto não encontrado' });
  const c = cleanProductBody(b);
  const fields = [];
  const args = [];
  if (b.name !== undefined) { fields.push('name = ?'); args.push(c.name); }
  if (b.tagline !== undefined) { fields.push('tagline = ?'); args.push(c.tagline); }
  if (b.description !== undefined) { fields.push('description = ?'); args.push(c.description); }
  if (b.category !== undefined) { fields.push('category = ?'); args.push(c.category); }
  if (b.version !== undefined) { fields.push('version = ?'); args.push(c.version); }
  if (b.badge !== undefined) { fields.push('badge = ?'); args.push(c.badge); }
  if (b.video !== undefined) { fields.push('video = ?'); args.push(c.video); }
  if (b.image !== undefined) { fields.push('image = ?'); args.push(c.image); }
  if (b.coverImage !== undefined) { fields.push('cover_image = ?'); args.push(c.coverImage); }
  if (b.downloadUrl !== undefined) { fields.push('download_url = ?'); args.push(c.downloadUrl); }
  if (b.price !== undefined) {
    if (!isFinite(c.price) || c.price < 0) return res.status(400).json({ error: 'Preço inválido' });
    fields.push('price = ?'); args.push(c.price);
  }
  if (b.oldPrice !== undefined) {
    if (c.oldPrice != null && (!isFinite(c.oldPrice) || c.oldPrice < 0)) {
      return res.status(400).json({ error: 'Preço antigo inválido' });
    }
    fields.push('old_price = ?'); args.push(c.oldPrice);
  }
  if (b.stock !== undefined) {
    if (!isFinite(c.stock) || c.stock < 0 || c.stock > 999999) return res.status(400).json({ error: 'Estoque inválido' });
    fields.push('stock = ?'); args.push(c.stock);
  }
  if (b.maxDownloads !== undefined) {
    if (!isFinite(c.maxDownloads) || c.maxDownloads < 1 || c.maxDownloads > 1000) return res.status(400).json({ error: 'Limite de downloads inválido' });
    fields.push('max_downloads = ?'); args.push(c.maxDownloads);
  }
  if (b.features !== undefined) {
    const features = Array.isArray(b.features) ? b.features.slice(0, 20).map(f => sanitizeText(String(f), { max: 200 })) : [];
    fields.push('features = ?'); args.push(JSON.stringify(features));
  }
  if (b.active !== undefined) { fields.push('active = ?'); args.push(b.active ? 1 : 0); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  fields.push('updated_at = ?'); args.push(nowISO());
  args.push(id);
  await run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, args);

  // Re-sync AbacatePay: delete old + create new (sem endpoint de update)
  const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
  let abacateReSyncError = null;
  let abacateResynced = false;
  if (updated && (b.name !== undefined || b.price !== undefined || b.description !== undefined)) {
    try {
      if (existing.abacate_product_id) {
        await deleteAbacateProduct(existing.abacate_product_id);
      }
      const result = await createAbacateProduct({
        externalId: id,
        name: updated.name,
        price: Number(updated.price),
        description: updated.description || updated.tagline,
        imageUrl: updated.image
      });
      if (result && result.id) {
        await run('UPDATE products SET abacate_product_id = ? WHERE id = ?', [result.id, id]);
        abacateResynced = true;
      } else {
        abacateReSyncError = 'AbacatePay não retornou ID do produto';
      }
    } catch (err) {
      abacateReSyncError = err.message;
      console.warn('[products] AbacatePay re-sync failed (non-blocking):', err.message);
    }
  }

  const final = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.json({
    product: serialize(final, { admin: true }),
    abacate: { resynced: abacateResynced, error: abacateReSyncError }
  });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  // Delete from AbacatePay if synced
  const existing = await get('SELECT abacate_product_id FROM products WHERE id = ?', [id]);
  if (existing && existing.abacate_product_id) {
    try { await deleteAbacateProduct(existing.abacate_product_id); } catch (e) { console.warn('[products] AbacatePay delete failed:', e.message); }
  }
  await run('DELETE FROM products WHERE id = ?', [id]);
  await auditLog({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action: 'delete_product',
    targetType: 'product',
    targetId: id,
    ip: req.ip
  });
  res.json({ ok: true });
});

function serialize(p, { admin = false } = {}) {
  if (!p) return null;
  let features = [];
  try { features = JSON.parse(p.features || '[]'); } catch { features = []; }
  const out = {
    ...p,
    price: Number(p.price),
    oldPrice: p.old_price != null ? Number(p.old_price) : null,
    stock: Number(p.stock || 0),
    maxDownloads: Number(p.max_downloads || 5),
    coverImage: p.cover_image || null,
    features,
    active: Boolean(p.active)
  };
  if (!admin) {
    delete out.download_url;
    delete out.downloadUrl;
  }
  return out;
}

// Upload de JAR pelo painel admin: recebe o arquivo bruto, embute a public key
// e o reenvia para uma release do GitHub configurada. A URL final é salva no produto.
router.post('/:id/upload', requireAdmin, async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'Arquivo .jar não enviado ou vazio' });
  }

  log.info('upload de JAR recebido', { id, size: buffer.length, productName: product.name, version: product.version });

  try {
    const withKey = embedPublicKeyInJar(buffer, id, process.env.APP_URL ? `${process.env.APP_URL}/api` : 'https://cafeplugins.com/api');
    log.info('JAR com chave publica gerado', { id, size: withKey.length });
    const version = `v${(product.version || '1.0').replace(/[^0-9.]/g, '')}`;
    const downloadUrl = await uploadJarToGitHubRelease({
      buffer: withKey,
      productId: id,
      productName: product.name,
      version
    });

    // Verifica se a URL gerada realmente é acessivel antes de salvar no banco.
    // Se o GitHub ainda nao propagou o asset ou o token nao consegue baixar,
    // evitamos salvar uma URL quebrada.
    log.info('verificando acessibilidade da URL gerada', { id, downloadUrl });
    try {
      const testBuffer = await fetchOriginalJar(downloadUrl);
      log.info('URL gerada acessivel', { id, downloadUrl, size: testBuffer.length });
    } catch (verifyErr) {
      log.error('URL gerada nao esta acessivel', { id, downloadUrl, error: verifyErr.message });
      throw new Error(`Upload criado, mas a URL nao esta acessivel: ${verifyErr.message}`);
    }

    await run('UPDATE products SET download_url = ?, updated_at = ? WHERE id = ?', [downloadUrl, nowISO(), id]);
    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    log.info('JAR processado e URL salva', { id, downloadUrl });
    res.json({ product: serialize(updated, { admin: true }), downloadUrl });
  } catch (e) {
    log.error('erro ao processar upload de JAR', { id, error: e.message, stack: e.stack });
    return res.status(500).json({ error: e.message || 'Erro ao processar JAR' });
  }
});

// Diagnostico: admin testa se o download_url do produto é acessivel
router.get('/:id/test-download', requireAdmin, async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });
  if (!product.download_url) return res.status(400).json({ ok: false, error: 'Produto nao tem download_url configurado' });

  try {
    const buf = await fetchOriginalJar(product.download_url);
    res.json({ ok: true, downloadUrl: product.download_url, size: buf.length, validJar: buf[0] === 0x50 && buf[1] === 0x4B });
  } catch (e) {
    log.error('diagnostico de download falhou', { id, downloadUrl: product.download_url, error: e.message });
    res.status(502).json({ ok: false, downloadUrl: product.download_url, error: e.message });
  }
});

// Proxy de capa: busca a imagem do GitHub (que pode estar em repo privado) com
// token e retorna como imagem publica. Permite usar <img src="/api/products/:id/cover">
// na loja sem expor o GITHUB_TOKEN.
router.get('/:id/cover', async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const p = await get('SELECT cover_image FROM products WHERE id = ? AND active = 1', [id]);
  if (!p || !p.cover_image) return res.status(404).json({ error: 'Sem capa' });
  const coverUrl = p.cover_image;
  try {
    // Tenta baixar a capa (fetchOriginalJar reusa logica de auth para GitHub)
    // mas precisamos do buffer bruto, sem validacao de ZIP.
    const token = process.env.GITHUB_TOKEN;
    let res2;
    const isApi = coverUrl.includes('api.github.com');
    const headers = isApi && token
      ? { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'User-Agent': 'cafe-plugins' }
      : { 'User-Agent': 'cafe-plugins' };
    res2 = await fetch(coverUrl, { redirect: 'manual', headers });
    if (res2.status >= 300 && res2.status < 400 && res2.headers.get('location')) {
      // Redirect do GitHub para URL assinada — segue sem headers de auth
      res2 = await fetch(res2.headers.get('location'), { redirect: 'follow' });
    }
    if (!res2.ok) {
      return res.status(502).json({ error: 'Falha ao buscar capa no GitHub: ' + res2.status });
    }
    const buf = Buffer.from(await res2.arrayBuffer());
    if (!buf.length) return res.status(502).json({ error: 'Capa veio vazia' });
    // Detecta content type pelo magic number
    let ct = 'image/png';
    if (buf[0] === 0xFF && buf[1] === 0xD8) ct = 'image/jpeg';
    else if (buf[0] === 0x89 && buf[1] === 0x50) ct = 'image/png';
    else if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') ct = 'image/webp';
    else if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') ct = 'image/gif';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  } catch (e) {
    log.error('erro no proxy de capa', { id, coverUrl, error: e.message });
    return res.status(502).json({ error: 'Erro ao buscar capa: ' + e.message });
  }
});

// Upload de capa/banner do produto: recebe a imagem bruta e envia para uma
// release do GitHub (mesmo bucket dos JARs). A URL final é salva no produto.
router.post('/:id/upload-cover', requireAdmin, async (req, res) => {
  const id = sanitizeIdentifier(req.params.id, { max: 64 });
  if (!id) return res.status(400).json({ error: 'ID invalido' });
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });

  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'Imagem não enviada ou vazia' });
  }
  // Limite de 4MB para capa (não exagerado)
  if (buffer.length > 4 * 1024 * 1024) {
    return res.status(400).json({ error: 'Imagem muito grande (máximo 4MB)' });
  }
  // Valida magic number (PNG/JPG/WEBP/GIF)
  const sig = buffer.slice(0, 12);
  const isPng = sig.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  const isJpg = sig.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]));
  const isWebp = sig.slice(0, 4).equals(Buffer.from('RIFF')) && sig.slice(8, 12).equals(Buffer.from('WEBP'));
  const isGif = sig.slice(0, 6).equals(Buffer.from('GIF89a')) || sig.slice(0, 6).equals(Buffer.from('GIF87a'));
  if (!isPng && !isJpg && !isWebp && !isGif) {
    return res.status(400).json({ error: 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.' });
  }
  const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : 'gif';

  log.info('upload de capa recebido', { id, size: buffer.length, ext, productName: product.name });

  try {
    const version = `v${(product.version || '1.0').replace(/[^0-9.]/g, '')}`;
    const coverUrl = await uploadJarToGitHubRelease({
      buffer,
      productId: id,
      productName: product.name,
      version,
      filename: `cover-${id}.${ext}`,
      contentType: isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/gif'
    });

    await run('UPDATE products SET cover_image = ?, updated_at = ? WHERE id = ?', [coverUrl, nowISO(), id]);
    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    log.info('capa salva', { id, coverUrl });
    res.json({ product: serialize(updated, { admin: true }), coverUrl });
  } catch (e) {
    log.error('erro ao fazer upload de capa', { id, error: e.message, stack: e.stack });
    res.status(500).json({ error: 'Erro ao enviar capa: ' + e.message });
  }
});

export default router;
