// =============================================================
//  cafe plugins - Camada de dados (compat layer)
//  Interface síncrona sobre o backend /api/*.
//  As páginas chamam DB.xxx(); os dados vêm de um cache local
//  que é alimentado pelo backend.
// =============================================================

const API_BASE = (window.PF_API_BASE || '/api');
const USE_BACKEND = window.PF_USE_BACKEND !== false;

// Dev detection: localhost, 127.0.0.1, ?dev=1, ou *.vercel.app preview
const IS_DEV = (function () {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local')) return true;
    if (h.endsWith('.vercel.app')) return true; // previews da Vercel
    if (new URLSearchParams(location.search).has('dev')) return true;
    return false;
  } catch { return false; }
})();
window.__IS_DEV__ = IS_DEV;

// Cache em memória
const cache = {
  products: [],
  orders: [],
  affiliates: [],
  payouts: [],
  users: [],
  buyers: [],
  me: null,
  _ready: false
};

const TOKEN_KEY = 'pf_token';
const USER_KEY = 'pf_user';
const REF_KEY = 'pf_ref';

// =============================================================
//  Normalização: backend retorna snake_case, frontend usa camelCase
// =============================================================
function toCamel(s) { return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }

function normalizeOrder(o) {
  if (!o) return null;
  const c = {};
  for (const k in o) {
    if (k === 'items' && typeof o[k] === 'string') {
      try { c.items = JSON.parse(o[k]); } catch { c.items = []; }
    } else if (k === 'downloads' && typeof o[k] === 'string') {
      try { c.downloads = JSON.parse(o[k]); } catch { c.downloads = []; }
    } else {
      c[toCamel(k)] = o[k];
    }
  }
  // Helpers extras
  c.buyer = { name: c.buyerName || '', email: c.buyerEmail || '' };
  c.isPaid = c.status === 'pago';
  c.affiliateCode = c.affiliateCode || c.affiliate_code;
  c.licenseKey = c.licenseKey || c.license_key;
  c.downloadToken = c.downloadToken || c.download_token;
  c.createdAt = c.createdAt || c.created_at;
  c.paidAt = c.paidAt || c.paid_at;
  c.paymentId = c.paymentId || c.payment_id;
  c.paymentMethod = c.paymentMethod || c.payment_method;
  // Aliases usados pelo frontend
  c.payment = c.paymentMethod || c.payment || 'pix';
  c.pixQrCode = c.pixQrCode || c.pix_qr_code;
  c.pixQrImage = c.pixQrImage || c.pix_qr_image;
  c.userId = c.userId || c.user_id;
  c.affiliateId = c.affiliateId || c.affiliate_id;
  c.subtotal = Number(c.subtotal || c.subtotal === 0 ? c.subtotal : 0);
  c.gatewayFee = Number(c.gatewayFee || c.gateway_fee || 0);
  c.netAmount = Number(c.netAmount || c.net_amount || 0);
  c.commission = Number(c.commission || 0);
  c.commissionRate = Number(c.commissionRate || c.commission_rate || 0);
  // breakdown é enviado pelo backend como objeto; garante que existe
  if (!c.breakdown) {
    const effectiveNet = c.netAmount > 0 ? c.netAmount : c.subtotal;
    c.breakdown = {
      subtotal: c.subtotal,
      gatewayFee: c.gatewayFee,
      netAmount: effectiveNet,
      commission: c.commission,
      commissionRate: c.commissionRate,
      storeKeeps: +Math.max(0, c.subtotal - c.gatewayFee - c.commission).toFixed(2)
    };
  }
  return c;
}

function normalizeAffiliate(a) {
  if (!a) return null;
  const c = {};
  for (const k in a) c[toCamel(k)] = a[k];
  // Helpers
  c.code = c.code || c.affiliateCode;
  c.affiliateCode = c.affiliateCode || c.code;
  c.rate = c.rate != null ? c.rate : (c.affiliateRate || 25);
  c.status = c.status || c.affiliateStatus || 'active';
  c.totalSales = c.totalSales || c.totalSales || 0;
  c.totalEarned = c.totalEarned || c.totalEarned || 0;
  c.paidOut = c.paidOut || c.paidOut || 0;
  c.dailyStats = c.dailyStats || c.daily_stats || {};
  c.banReason = c.banReason || c.banReason || '';
  c.createdAt = c.createdAt || c.created_at;
  return c;
}

function getToken() { return sessionStorage.getItem(TOKEN_KEY); }
function setToken(t) { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); }
function setStoredUser(u) {
  const norm = u ? normalizeUser(u) : null;
  norm ? sessionStorage.setItem(USER_KEY, JSON.stringify(norm)) : sessionStorage.removeItem(USER_KEY);
}

// Normaliza user do backend (snake_case) para camelCase do frontend
function normalizeUser(u) {
  if (!u) return null;
  const c = { ...u };
  c.createdAt = c.createdAt || c.created_at || null;
  c.updatedAt = c.updatedAt || c.updated_at || null;
  c.emailVerified = c.email_verified != null ? !!c.email_verified : (c.emailVerified || false);
  c.emailVerifiedAt = c.emailVerifiedAt || c.email_verified_at || null;
  c.tokenVersion = c.tokenVersion || c.token_version || 0;
  c.affiliateCode = c.affiliateCode || c.affiliate_code || null;
  c.affiliateRate = c.affiliateRate || c.affiliate_rate || 25;
  c.affiliateStatus = c.affiliateStatus || c.affiliate_status || 'active';
  c.isAffiliate = c.isAffiliate != null ? !!c.isAffiliate : (c.is_affiliate != null ? !!c.is_affiliate : false);
  c.totalEarned = Number(c.totalEarned || c.total_earned || 0);
  c.totalSales = Number(c.totalSales || c.total_sales || 0);
  c.paidOut = Number(c.paidOut || c.paid_out || 0);
  c.clicks = Number(c.clicks || 0);
  c.conversions = Number(c.conversions || 0);
  c.pixKey = c.pixKey || c.pix_key || '';
  c.pixHolder = c.pixHolder || c.pix_holder || '';
  c.banReason = c.banReason || c.ban_reason || null;
  return c;
}
function getStoredUser() { try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let r;
  try {
    r = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch (netErr) {
    const e = new Error('Sem conexão com o servidor');
    e.status = 0;
    e.url = API_BASE + path;
    e.hint = 'API fora do ar. Verifique /api/diag';
    if (typeof window !== 'undefined' && window.console) {
      console.error('[API] falha de rede:', API_BASE + path, netErr);
    }
    throw e;
  }
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) {
    const e = new Error((data && data.error) || ('Erro ' + r.status));
    e.status = r.status;
    e.data = data;
    e.url = API_BASE + path;
    if (data && data.code) e.code = data.code;
    if (typeof window !== 'undefined' && window.console) {
      console.error('[API] erro', r.status, API_BASE + path, data);
    }
    throw e;
  }
  return data;
}

async function diag() {
  try {
    const r = await fetch(API_BASE + '/diag');
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const DB = {
  // ===========================================================
  //  Diagnóstico
  // ===========================================================
  diag,
  apiBase: API_BASE,
  // ===========================================================
  async init() {
    if (!USE_BACKEND) return;
    const t0 = Date.now();
    const stored = getStoredUser();

    // Popula cache.me IMEDIATAMENTE (síncrono) para que o frontend
    // (ex: botão "Painel" da landpage) já saiba que o usuário está logado
    // antes do /auth/me terminar.
    if (stored && !cache.me) cache.me = stored;

    const tasks = [
      api('/products').then(r => { cache.products = r.products || []; })
        .catch(e => { console.warn('Init products error:', e.message); })
    ];
    if (stored) {
      cache.me = stored;
      tasks.push(
        api('/auth/me')
          .then(me => {
            cache.me = normalizeUser(me.user);
            setStoredUser(me.user);
          })
          .catch((e) => {
            // Só desloga se for 401 (token inválido/expirado). Erro de rede mantém sessão.
            if (e && e.status === 401) {
              setToken(null); setStoredUser(null); cache.me = null;
            } else {
              console.warn('[init] /auth/me falhou (mantendo cache local):', e.message);
            }
          })
      );
    }
    await Promise.all(tasks);

    if (cache.me) {
      // _refreshUserData em background, não bloqueia o ready
      this._refreshUserData()
        .then(() => console.info(`[DB] _refreshUserData OK em ${Date.now() - t0}ms`))
        .catch(e => console.warn('Background _refreshUserData failed:', e.message));
    }
    cache._ready = true;
    console.info(`[DB] init OK em ${Date.now() - t0}ms`);
  },

  async _refreshUserData() {
    if (!cache.me) return;
    if (cache.me.role === 'admin') {
      try { const r = await api('/admin/stats'); cache.adminStats = r; } catch {}
      // Pedidos ATIVOS (filtra lixeira por padrão)
      try { const r = await api('/orders'); cache.orders = (r.orders || []).map(normalizeOrder); } catch {}
      // LIXEIRA (separada)
      try { const r = await api('/orders?onlyTrashed=1'); cache.trashedOrders = (r.orders || []).map(normalizeOrder); } catch {}
      try { const r = await api('/affiliates/admin/all'); cache.affiliates = (r.affiliates || []).map(normalizeAffiliate); } catch {}
      try { const r = await api('/affiliates/admin/payouts'); cache.payouts = r.payouts || []; } catch {}
      try { const r = await api('/admin/users'); cache.users = (r.users || []).map(normalizeUser); } catch {}
    } else {
      // Buyer ou afiliado: carrega seus pedidos
      try { const r = await api('/orders/me'); cache.orders = (r.orders || []).map(normalizeOrder); } catch {}
    }
    if (cache.me.isAffiliate) {
      try { const r = await api('/affiliates/me/stats'); cache.affiliateStats = r; } catch {}
    }
  },

  // ===========================================================
  //  AUTH (compat shape: { error } | { role, affiliate|buyer })
  // ===========================================================
  async register({ name, email, password }) {
    const r = await api('/auth/register', { method: 'POST', body: { name, email, password } });
    if (r.token) setToken(r.token);
    const u = normalizeUser(r.user);
    setStoredUser(r.user); cache.me = u;
    return { buyer: u, requiresEmailVerification: r.requiresEmailVerification, devCode: r.devCode };
  },

  // usado tanto pelo form de cliente quanto pelo admin
  async login(email, password) {
    if (typeof email === 'object' && email && email.email) {
      password = email.password;
      email = email.email;
    }
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    const u = normalizeUser(r.user);
    setToken(r.token); setStoredUser(r.user); cache.me = u;
    return u;
  },

  async adminLogin(email, password) {
    if (typeof email === 'object' && email && email.email) {
      password = email.password;
      email = email.email;
    }
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (r.user.role !== 'admin') {
      setToken(null); setStoredUser(null); cache.me = null;
      throw new Error('Acesso restrito a admin');
    }
    const u = normalizeUser(r.user);
    setToken(r.token); setStoredUser(r.user); cache.me = u;
    return u;
  },

  // ===== Compat shape para store.js/account.js/admin.js (form handlers) =====
  async authenticateUser(email, password) {
    try {
      const u = await this.login(email, password);
      if (u.role === 'admin') return { error: 'Use a aba Admin para entrar como administrador' };
      if (u.isAffiliate) return { role: 'affiliate', affiliate: u };
      return { role: 'buyer', buyer: u };
    } catch (e) {
      const out = { error: e.message || 'E-mail ou senha incorretos' };
      if (e.code) out.code = e.code;
      // Captura email para reenvio de code
      if (e.data && e.data.email) out.email = e.data.email;
      return out;
    }
  },
  async authenticateAdmin(email, password) {
    try {
      const u = await this.adminLogin(email, password);
      return { role: 'admin', user: u };
    } catch (e) {
      const out = { error: e.message || 'E-mail ou senha incorretos' };
      if (e.code) out.code = e.code;
      if (e.data && e.data.email) out.email = e.data.email;
      if (e.data && e.data.devCode) out.devCode = e.data.devCode;
      return out;
    }
  },

  async requestCode(email, purpose = 'login') {
    return api('/auth/request-code', { method: 'POST', body: { email, purpose } });
  },
  async verifyCode(email, code, purpose = 'login') {
    const r = await api('/auth/verify-code', { method: 'POST', body: { email, code, purpose } });
    if (r.code === 'SET_PASSWORD_REQUIRED') return r;
    const u = normalizeUser(r.user);
    setToken(r.token); setStoredUser(r.user); cache.me = u;
    return { ...r, user: u };
  },

  // Verificação de e-mail (purpose separado)
  async requestVerifyEmail(email) {
    return api('/auth/resend-verification', { method: 'POST', body: { email } });
  },
  async verifyEmailCode(email, code) {
    const r = await api('/auth/verify-email', { method: 'POST', body: { email, code } });
    if (r.code === 'SET_PASSWORD_REQUIRED') return r;
    if (r.token) {
      const u = normalizeUser(r.user);
      setToken(r.token); setStoredUser(r.user); cache.me = u;
      return { ...r, user: u };
    }
    return r;
  },

  async setPassword(email, code, newPassword) {
    const r = await api('/auth/set-password', { method: 'POST', body: { email, code, newPassword } });
    if (r.token) {
      const u = normalizeUser(r.user);
      setToken(r.token); setStoredUser(r.user); cache.me = u;
      return { ...r, user: u };
    }
    return r;
  },

  // Expor api() para uso em handlers de UI que precisam ler dados pontuais
  async apiFetch(path, opts) { return api(path, opts); },
  async resetPassword(email, code, newPassword) {
    try {
      await api('/auth/reset-password', { method: 'POST', body: { email, code, newPassword } });
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  },
  async changePassword(currentPassword, newPassword) {
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  },
  setAffiliatePassword(id, pwd) { return this.changePassword('', pwd); },
  setBuyerPassword(email, pwd) { return this.changePassword('', pwd); },

  // Forgot password UI helpers (modal Painel → esqueci a senha)
  async requestPasswordReset(email) {
    try {
      const r = await this.requestCode(email, 'reset');
      return r.devCode || null;
    } catch (e) { return null; }
  },
  // Backend não tem endpoint público para "peek" — usamos devCode do requestCode
  async peekLatestLoginCode(target, email) {
    return null;
  },
  async generateLoginCode(target, email) {
    const purpose = target === 'reset' ? 'reset' : 'login';
    return this.requestCode(email, purpose);
  },
  async consumeLoginCode(target, email, code) {
    try {
      await this.verifyCode(email, code, 'login');
      return true;
    } catch { return false; }
  },

  // Logout / session
  logout() {
    setToken(null); setStoredUser(null); cache.me = null;
    return Promise.resolve();
  },
  isAuthed() { return !!cache.me; },
  getCurrentUser() { return cache.me; },
  getCurrentBuyer() { return cache.me && cache.me.role === 'buyer' ? cache.me : null; },
  getCurrentAffiliate() {
    if (!cache.me || !cache.me.isAffiliate) return null;
    // daily_stats pode vir como objeto (do backend) ou string (de sessionStorage)
    let dailyStats = cache.me.dailyStats;
    if (typeof dailyStats === 'string') {
      try { dailyStats = JSON.parse(dailyStats); } catch { dailyStats = {}; }
    }
    return {
      ...cache.me,
      id: cache.me.id,
      code: cache.me.affiliateCode || cache.me.code,
      rate: cache.me.affiliateRate || cache.me.rate || 25,
      status: cache.me.affiliateStatus || cache.me.status || 'active',
      clicks: Number(cache.me.clicks || 0),
      conversions: Number(cache.me.conversions || 0),
      totalEarned: Number(cache.me.totalEarned || 0),
      totalSales: Number(cache.me.totalSales || 0),
      paidOut: Number(cache.me.paidOut || 0),
      dailyStats: dailyStats || {},
      pixKey: cache.me.pixKey || '',
      pixHolder: cache.me.pixHolder || ''
    };
  },
  setBuyerSession(email) { /* sessão agora é JWT */ },
  setAffiliateSession(id) { /* sessão agora é JWT */ },
  clearBuyerSession() { return this.logout(); },
  clearAffiliateSession() { return this.logout(); },
  getBuyerSession() { return cache.me && cache.me.role === 'buyer' ? cache.me.email : null; },
  getAffiliateSession() { return cache.me && cache.me.isAffiliate ? cache.me.id : null; },
  setAffiliatePassword2() { /* alias - já tem */ },

  // ===========================================================
  //  PRODUCTS
  // ===========================================================
  getProducts() { return cache.products; },
  getProduct(id) { return cache.products.find(p => p.id === id) || null; },
  async getAllProducts() {
    if (!cache.me || cache.me.role !== 'admin') return cache.products;
    try { const r = await api('/products/all'); cache.products = r.products; return r.products; }
    catch { return cache.products; }
  },
  async createProduct(p) {
    const r = await api('/products', { method: 'POST', body: p });
    cache.products.push(r.product);
    return r;
  },
  async addProduct(p) { return this.createProduct(p); },
  async updateProduct(id, patch) {
    const r = await api('/products/' + id, { method: 'PUT', body: patch });
    const idx = cache.products.findIndex(p => p.id === id);
    if (idx >= 0) cache.products[idx] = r.product;
    return r;
  },
  async deleteProduct(id) {
    await api('/products/' + id, { method: 'DELETE' });
    cache.products = cache.products.filter(p => p.id !== id);
    return { ok: true };
  },
  saveProducts(list) {
    // Não implementado no backend (admin edita in-place via updateProduct)
    return Promise.resolve();
  },
  async syncProductsToAbacate() {
    const r = await api('/admin/sync-products', { method: 'POST', body: {} });
    return r;
  },

  // ===========================================================
  //  ORDERS
  // ===========================================================
  async checkout({ name, email, items, affiliateCode, paymentMethod = 'pix', cellphone }) {
    const r = await api('/orders/checkout', {
      method: 'POST',
      body: { name, email, items, affiliateCode, paymentMethod, cellphone }
    });
    const order = normalizeOrder(r.order);
    cache.orders.unshift(order);
    return { order, pix: r.pix, checkoutUrl: r.checkoutUrl, cardError: r.cardError };
  },
  async addOrder(data) {
    // data = { buyer, items, affiliateCode, paymentMethod, cellphone }
    const items = (data.items || []).map(i => ({
      id: i.id || i.productId,
      name: i.name || (this.getProduct(i.id || i.productId) || {}).name || '',
      price: Number(i.price != null ? i.price : (this.getProduct(i.id || i.productId) || {}).price || 0),
      downloadUrl: i.downloadUrl || (this.getProduct(i.id || i.productId) || {}).download_url || ''
    }));
    const r = await this.checkout({
      name: data.buyer && data.buyer.name,
      email: data.buyer && data.buyer.email,
      items,
      affiliateCode: data.affiliateCode,
      paymentMethod: data.paymentMethod || data.payment || 'pix',
      cellphone: data.cellphone || ''
    });
    return { order: r.order, pix: r.pix, checkoutUrl: r.checkoutUrl, cardError: r.cardError };
  },
  async updateOrder(id, patch) {
    if (patch.status === 'pago') {
      const body = {
        manualOverride: patch.manualOverride || false,
        reason: patch.reason || ''
      };
      const r = await api('/orders/' + id + '/confirm', { method: 'POST', body });
      const updated = normalizeOrder(r.order);
      // Atualiza cache local (substitui o item, ou adiciona se não existir)
      const idx = cache.orders.findIndex(o => o.id === id);
      if (idx >= 0) cache.orders[idx] = updated;
      else cache.orders.unshift(updated);
      return updated;
    }
    // Outros status (pendente, cancelado, reembolsado)
    const r = await api('/orders/' + id, { method: 'PATCH', body: patch });
    const updated = normalizeOrder(r.order);
    const idx = cache.orders.findIndex(o => o.id === id);
    if (idx >= 0) cache.orders[idx] = updated;
    else cache.orders.unshift(updated);
    return updated;
  },
  async getMyOrders() {
    if (!cache.me) return [];
    try { const r = await api('/orders/me'); cache.orders = (r.orders || []).map(normalizeOrder); return cache.orders; }
    catch { return cache.orders; }
  },
  async getOrder(id) {
    try { const r = await api('/orders/' + id); return normalizeOrder(r.order); }
    catch { return null; }
  },
  async getOrderStatus(id, email) {
    // HIGH-09 FIX: ?email= removido. Agora exige auth (JWT).
    // Se não há sessão, retorna null — caller deve mostrar "faça login" ou code flow.
    try {
      return await api('/orders/' + id + '/status');
    } catch (e) { return null; }
  },
  getOrders() { return cache.orders; },
  getOrdersByEmail(email) {
    if (!email) return [];
    const e = email.toLowerCase();
    return cache.orders.filter(o => {
      const oEmail = (o.buyerEmail || o.buyer_email || '').toLowerCase();
      return oEmail === e;
    });
  },
  async getOrderDownloadToken(id) {
    return api('/orders/' + id + '/download-token');
  },
  async getOrderByToken(token) {
    try { const r = await api('/orders/by-token?t=' + encodeURIComponent(token)); return normalizeOrder(r.order); }
    catch (e) { console.warn('getOrderByToken failed:', e.message); return null; }
  },
  async logOrderDownload(orderId, token) {
    try {
      const q = token ? '?t=' + encodeURIComponent(token) : '';
      return await api('/orders/' + orderId + '/log-download' + q, { method: 'POST', body: { t: token } });
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async getAllOrders() {
    try { const r = await api('/orders'); cache.orders = (r.orders || []).map(normalizeOrder); return cache.orders; }
    catch { return cache.orders; }
  },
  async confirmOrderPayment(id) {
    return api('/orders/' + id + '/confirm', { method: 'POST', body: {} });
  },
  async deleteOrder(id, force = false) {
    try {
      const path = '/orders/' + id + (force ? '?force=1' : '');
      const r = await api(path, { method: 'DELETE' });
      // Se foi soft-delete, move para trashedOrders; se foi permanent, remove dos dois
      if (r.softDeleted) {
        const order = cache.orders.find(o => o.id === id);
        if (order) {
          cache.orders = cache.orders.filter(o => o.id !== id);
          cache.trashedOrders = cache.trashedOrders || [];
          order.deletedAt = r.deletedAt;
          order.isTrashed = true;
          cache.trashedOrders.unshift(order);
        }
      } else if (r.permanent) {
        cache.orders = cache.orders.filter(o => o.id !== id);
        cache.trashedOrders = (cache.trashedOrders || []).filter(o => o.id !== id);
      }
      return r;
    } catch (e) {
      return { ok: false, error: e.message || 'Erro ao excluir' };
    }
  },

  // Restaura pedido da lixeira
  async restoreOrder(id) {
    try {
      const r = await api('/orders/' + id + '/restore', { method: 'POST' });
      if (r.restored) {
        const order = cache.trashedOrders.find(o => o.id === id);
        if (order) {
          cache.trashedOrders = cache.trashedOrders.filter(o => o.id !== id);
          order.deletedAt = null;
          order.isTrashed = false;
          cache.orders.unshift(order);
        }
      }
      return r;
    } catch (e) {
      return { ok: false, error: e.message || 'Erro ao restaurar' };
    }
  },

  getTrashedOrders() { return cache.trashedOrders || []; },

  async getAllTrashedOrders() {
    try {
      const r = await api('/orders?onlyTrashed=1');
      cache.trashedOrders = (r.orders || []).map(normalizeOrder);
      return cache.trashedOrders;
    } catch { return cache.trashedOrders || []; }
  },

  async emptyTrash() {
    try {
      const r = await api('/orders/trash/empty', { method: 'DELETE' });
      if (r.ok) cache.trashedOrders = [];
      return r;
    } catch (e) {
      return { ok: false, error: e.message || 'Erro ao esvaziar lixeira' };
    }
  },

  // ===========================================================
  //  AFFILIATES
  // ===========================================================
  async becomeAffiliate() {
    const r = await api('/affiliates/become', { method: 'POST', body: {} });
    if (cache.me) {
      cache.me.isAffiliate = 1;
      cache.me.affiliateCode = r.affiliate.affiliateCode || r.affiliate.affiliate_code;
      setStoredUser(cache.me);
    }
    return r.affiliate;
  },
  async createAffiliateFromBuyer(email) {
    return this.becomeAffiliate();
  },
  async createBuyerAccount({ name, email, password }) {
    return this.register({ name, email, password });
  },
  async findOrCreateBuyer(name, email) {
    // No MVP, o buyer é criado on-the-fly no checkout. Aqui só retornamos o user atual.
    return { email, name };
  },
  async getMyAffiliateStats() { return api('/affiliates/me/stats'); },
  async requestPayout(pixKey, pixHolder) {
    return api('/affiliates/payouts', { method: 'POST', body: { pixKey, pixHolder } });
  },
  async updateMyPix(pixKey, pixHolder) {
    return api('/affiliates/me/pix', { method: 'PUT', body: { pixKey, pixHolder } });
  },
  async getAllAffiliates() {
    try { const r = await api('/affiliates/admin/all'); cache.affiliates = (r.affiliates || []).map(normalizeAffiliate); return cache.affiliates; }
    catch { return cache.affiliates; }
  },
  getAffiliates() { return cache.affiliates; },
  getPayouts() { return cache.payouts; },
  async findAffiliateByCode(code) {
    if (!code) return null;
    const c = code.trim().toUpperCase();
    // 1) Procura no cache local
    const local = cache.affiliates.find(a => (a.affiliate_code || a.code) === c);
    if (local) return local;
    // 2) Fallback: lookup público (para guest checkout via ?ref=CODE)
    try {
      const r = await api('/affiliates/lookup?code=' + encodeURIComponent(c));
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        rate: r.rate,
        status: r.status
      };
    } catch {
      return null;
    }
  },
  findAffiliateByEmail(email) {
    if (!email) return null;
    return cache.affiliates.find(a => (a.email || '').toLowerCase() === email.toLowerCase()) || null;
  },
  async setAffiliateStatus(id, status, reason = '') {
    return api('/affiliates/admin/' + id + '/status', { method: 'POST', body: { status, reason } });
  },
  async updateAffiliate(id, patch) {
    if (patch.status) await this.setAffiliateStatus(id, patch.status, patch.banReason || '');
    return cache.affiliates.find(a => a.id === id) || null;
  },
  async getAllPayouts(status) {
    try {
      const url = '/affiliates/admin/payouts' + (status && status !== 'all' ? '?status=' + status : '');
      const r = await api(url);
      cache.payouts = r.payouts;
      return r.payouts;
    } catch { return cache.payouts; }
  },
  async approvePayout(id, method) {
    return api('/affiliates/admin/payouts/' + id + '/approve', { method: 'POST', body: { method } });
  },
  async rejectPayout(id, reason) {
    return api('/affiliates/admin/payouts/' + id + '/reject', { method: 'POST', body: { reason } });
  },
  async updatePayout(id, patch) {
    if (patch.status === 'pago') return this.approvePayout(id, patch.method);
    if (patch.status === 'rejeitado') return this.rejectPayout(id, patch.method);
    return null;
  },
  async manualCommission(id, amount, note) {
    return api('/affiliates/admin/' + id + '/manual-commission', { method: 'POST', body: { amount, note } });
  },
  async deleteAffiliate(id) { return { ok: true, stub: true }; },
  getPayoutsByAffiliate(affiliateId) {
    return cache.payouts.filter(p => p.affiliate_id === affiliateId);
  },
  getClicksByCode(code) {
    return []; // admin pode usar /affiliates/admin/all pra ver
  },
  addPayout(data) { return Promise.resolve({ ...data, id: 'po-stub', status: 'pendente', requested_at: new Date().toISOString() }); },
  async registerClick(code) {
    try { await api('/affiliates/click', { method: 'POST', body: { code } }); } catch {}
  },
  async recalcAffiliateStats() { /* backend já calcula em tempo real */ },

  // ===========================================================
  //  ADMIN
  // ===========================================================
  async getAdminStats() { return api('/admin/stats'); },
  async getAllUsers() {
    try { const r = await api('/admin/users'); cache.users = (r.users || []).map(normalizeUser); return cache.users; }
    catch { return cache.users; }
  },
  getUsers() { return cache.users; },
  getUser(id) { return cache.users.find(u => u.id === id) || null; },
  async getUserDetails(id) {
    const r = await api('/admin/users/' + id);
    if (r.user) r.user = normalizeUser(r.user);
    return r;
  },
  async deleteUser(id) { return api('/admin/users/' + id, { method: 'DELETE' }); },
  getBuyers() { return cache.users.filter(u => u.role === 'buyer'); },
  async deletePayout(id) {
    return api('/affiliates/admin/payouts/' + id, { method: 'DELETE' });
  },
  exportAll() { return { products: cache.products, orders: cache.orders, users: cache.users, affiliates: cache.affiliates, payouts: cache.payouts, _stub: true }; },
  importAll() { return { ok: true, stub: true }; },
  async resetAll() { return api('/admin/cleanup', { method: 'POST' }); },

  // ===========================================================
  //  UTIL
  // ===========================================================
  // MED-09 FIX: removido hashPassword enganoso. NUNCA hasheie senha no client —
  // sempre envie plain para o backend que faz bcrypt.
  isSelfReferral(affiliate, buyerEmail) {
    if (!affiliate || !buyerEmail) return false;
    return (affiliate.email || '').toLowerCase() === (buyerEmail || '').toLowerCase();
  },
  parseVideoUrl: (url) => {
    if (!url) return null;
    if (url.match(/\.(mp4|webm|ogg)(\?.*)?$/i)) return { type: 'file', src: url };
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (m) return { type: 'youtube', src: `https://www.youtube.com/embed/${m[1]}` };
    const v = url.match(/vimeo\.com\/(\d+)/);
    if (v) return { type: 'vimeo', src: `https://player.vimeo.com/video/${v[1]}` };
    return null;
  },
  setRefCookie(code) {
    if (code) { try { localStorage.setItem(REF_KEY, code); } catch {} }
    else { try { localStorage.removeItem(REF_KEY); } catch {} }
  },
  getRefCookie() { try { return localStorage.getItem(REF_KEY); } catch { return null; } },
  clearRefCookie() { try { localStorage.removeItem(REF_KEY); } catch {} },
};

window.DB = DB;
window.STORAGE_KEYS = {
  cart: 'pixelforge_cart_v6',
  theme: 'pixelforge_theme',
  ref: 'pf_ref',
  notice: 'pixelforge_notice_dismissed'
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DB.init());
} else {
  DB.init();
}
