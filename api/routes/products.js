import { Router } from 'express';
import { get, all, run } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { uid, nowISO } from '../lib/util.js';
import { sanitizeIdentifier, sanitizeText, sanitizeUrl, LIMITS } from '../lib/sanitize.js';
import { createAbacateProduct, deleteAbacateProduct } from '../lib/payments.js';
import { createLogger } from '../lib/logger.js';

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
    downloadUrl: sanitizeUrl(b.downloadUrl || ''),
    price: Number(b.price),
    oldPrice: b.oldPrice != null && b.oldPrice !== '' ? Number(b.oldPrice) : null,
    stock: Number(b.stock ?? 999)
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
  const id = sanitizeIdentifier(b.id, { max: 64 }) || uid('pf-');
  const features = Array.isArray(b.features) ? b.features.slice(0, 20).map(f => sanitizeText(String(f), { max: 200 })) : [];
  await run(
    `INSERT INTO products (id, name, tagline, description, price, old_price, category, version, badge, features, stock, video, image, download_url, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, c.name, c.tagline, c.description,
      c.price, c.oldPrice,
      c.category, c.version, c.badge,
      JSON.stringify(features),
      c.stock,
      c.video, c.image, c.downloadUrl,
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
    features,
    active: Boolean(p.active)
  };
  if (!admin) {
    delete out.download_url;
    delete out.downloadUrl;
  }
  return out;
}

export default router;
