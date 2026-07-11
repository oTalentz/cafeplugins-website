const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
const fmtDay = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
};

function toast(msg, ok = true) {
  const stack = $('#toastStack');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `<span class="dot"></span><span>${escHtml(msg)}</span>`;
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

function adminConfirm({ title, message, okText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal open';
    wrap.innerHTML = `
      <div class="modal-card admin-prompt-card">
        <div class="modal-head">
          <h2>${escHtml(title)}</h2>
          <button type="button" class="icon-btn" data-cancel>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          ${message ? `<p style="color:var(--ink-2); font-size:0.9375rem; margin:0 0 4px; line-height:1.6">${message}</p>` : ''}
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
            <button type="button" class="btn btn-secondary" data-cancel>${cancelText}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    function keyHandler(e) { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); }
    document.addEventListener('keydown', keyHandler);
    const close = (val) => { wrap.remove(); document.removeEventListener('keydown', keyHandler); resolve(val); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(false); });
    wrap.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => close(false));
    wrap.querySelector('[data-ok]').onclick = () => close(true);
    wrap.querySelector('[data-ok]')?.focus();
  });
}

function adminPrompt({ title, message, placeholder = '', defaultValue = '', okText = 'OK' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal open';
    wrap.innerHTML = `
      <div class="modal-card admin-prompt-card">
        <div class="modal-head">
          <h2>${escHtml(title)}</h2>
          <button type="button" class="icon-btn" data-cancel>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          ${message ? `<p style="color:var(--ink-3); font-size:0.875rem; margin:0 0 12px">${message}</p>` : ''}
          <input class="input" type="text" autofocus value="${escAttr(defaultValue || '')}" placeholder="${escAttr(placeholder)}" />
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px">
            <button type="button" class="btn btn-ghost" data-cancel>Cancelar</button>
            <button type="button" class="btn btn-primary" data-ok>${okText}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('input');
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const close = (val) => { wrap.remove(); resolve(val); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
    wrap.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => close(null));
    wrap.querySelector('[data-ok]').onclick = () => close(input.value.trim());
    input.onkeydown = (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
    };
  });
}

async function checkAuth() {
  // Esconde splash IMEDIATAMENTE (antes de qualquer fetch) para evitar flash de UI
  const splash = document.getElementById('adminSplash');
  if (splash) splash.style.display = 'none';
  // Aguarda DB.init() para popular cache.me (caso tenha sessão salva)
  try { await DB.init(); } catch (e) { console.warn('DB.init failed:', e.message); }
  if (DB.isAuthed()) {
    try { await DB._refreshUserData(); } catch {}
    showAdmin();
  } else {
    // Sem sessão → mostrar login (que está com display:none por padrão)
    $('#loginScreen').style.display = 'flex';
  }
}

$('#loginBtn').onclick = async () => {
  const pass = $('#passInput').value;
  const email = $('#emailInput').value;
  const loginBtn = $('#loginBtn');
  const endLoading = Loading.buttonStart(loginBtn, 'Entrar');
  try {
    const result = await DB.authenticateAdmin(email, pass);
    if (result.error) {
      // Admin precisa confirmar e-mail
      if (result.code === 'EMAIL_NOT_VERIFIED') {
        showAdminVerifyEmailPanel(result.email || email, result.devCode);
        return;
      }
      $('#passInput').classList.add('error');
      toast(result.error, false);
      return;
    }
    showAdmin();
    // Refresh em background (não bloqueia UI)
    DB.init()
      .then(() => DB._refreshUserData())
      .then(() => renderAll())
      .catch(e => console.warn('Background refresh failed:', e.message));
  } catch (err) {
    toast(err.message || 'Erro ao entrar', false);
  } finally {
    endLoading();
  }
};
$('#passInput').onkeydown = (e) => { if (e.key === 'Enter') $('#loginBtn').click(); };
$('#logoutBtn').onclick = () => { DB.logout(); location.href = 'index.html'; };

// Painel de verificação de e-mail (admin)
async function showAdminVerifyEmailPanel(email, devCode) {
  const ls = $('#loginScreen');
  ls.innerHTML = `
    <div class="login-card">
      <div class="logo">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 2c0 1.2 1 1.8 1 3s-1 1.8-1 3"/>
          <path d="M14 2c0 1.2 1 1.8 1 3s-1 1.8-1 3"/>
          <path d="M5 9h11v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9z"/>
          <path d="M16 12h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/>
        </svg>
      </div>
      <h1>Confirme seu e-mail</h1>
      <p>Enviamos um código de 6 dígitos para <strong>${escHtml(email)}</strong>. Válido por 10 minutos.</p>
      <form id="adminVerifyForm">
        <div class="input-group">
          <label>Código</label>
          <input class="input" type="text" id="adminVerifyCode" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" style="letter-spacing:0.5em; text-align:center; font-size:1.25rem" autocomplete="one-time-code" required />
          <div id="adminVerifyDevCode" style="margin-top:8px; color:var(--success); font-size:0.8125rem; text-align:center; display:${devCode ? 'block' : 'none'}">Dev: <code>${devCode || ''}</code></div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center; margin-top:8px">Confirmar</button>
        <button type="button" class="btn btn-ghost" id="adminVerifyResendBtn" style="width:100%; justify-content:center; margin-top:8px">Reenviar código</button>
        <button type="button" class="btn btn-ghost" id="adminVerifyBackBtn" style="width:100%; justify-content:center; margin-top:4px; font-size:0.8125rem">Voltar ao login</button>
      </form>
    </div>
  `;
  setTimeout(() => $('#adminVerifyCode')?.focus(), 50);
  $('#adminVerifyForm').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#adminVerifyCode').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('Código inválido', false); return; }
    const submitBtn = e.target.querySelector('button[type=submit]');
    const endLoading = Loading.buttonStart(submitBtn, 'Confirmando…');
    let r;
    try { r = await DB.verifyEmailCode(email, code); } catch (err) { r = { error: err.message }; }
    endLoading();
    if (r.error) { toast(r.error, false); return; }
    // Sucesso: e-mail confirmado. Mas admin ainda não logou (precisa fazer login normal)
    toast('E-mail confirmado! Faça login novamente.');
    location.reload();
  };
  $('#adminVerifyResendBtn').onclick = async () => {
    try {
      const r = await DB.requestVerifyEmail(email);
      const dev = $('#adminVerifyDevCode');
      if (r.devCode) { dev.style.display = 'block'; dev.innerHTML = 'Dev: <code>' + r.devCode + '</code>'; }
      toast('Código reenviado');
    } catch (e) { toast(e.message || 'Erro', false); }
  };
  $('#adminVerifyBackBtn').onclick = () => location.reload();
}

function showAdmin() {
  $('#loginScreen').style.display = 'none';
  $('#adminShell').style.display = 'grid';
  const me = DB.getCurrentUser();
  if (me) {
    const nameEl = $('#adminUserName');
    const emailEl = $('#adminUserEmail');
    const av = $('.user .avatar');
    if (nameEl) nameEl.textContent = me.name || 'Admin';
    if (emailEl) emailEl.textContent = me.email || '';
    if (av) av.textContent = (me.name || me.email || 'AD').slice(0, 2).toUpperCase();
  }
  // Wire do botão Atualizar
  const refBtn = $('#dashboardRefreshBtn');
  if (refBtn && !refBtn.onclick) refBtn.onclick = refreshAllFromBackend;
  renderAll();
  // Restaura a última seção ativa (ou dashboard como default)
  restoreActivePage();
  // Refresh em background: garante que o admin SEMPRE vê dados frescos
  // (especialmente após pagamentos que podem ter ocorrido em outro dispositivo)
  DB._refreshUserData().then(() => renderAll()).catch(e => console.warn('Background refresh failed:', e.message));
}

$$('#sideNav button').forEach(btn => {
  btn.onclick = () => {
    $$('#sideNav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    $$('.page-section').forEach(s => s.classList.remove('active'));
    const target = $(`.page-section[data-section="${page}"]`);
    if (target) target.classList.add('active');
    if (page === 'payouts') renderPayouts();
    if (page === 'health') renderHealth();
    if (page === 'licenses') renderLicenses();
    // Persistir a seção ativa para restaurar após reload
    try { localStorage.setItem('pixelforge_admin_active_page', page); } catch (e) {}
  };
});

// Restaura a última seção ativa após reload
function restoreActivePage() {
  let saved = 'dashboard';
  try { saved = localStorage.getItem('pixelforge_admin_active_page') || 'dashboard'; } catch (e) {}
  const target = $(`#sideNav button[data-page="${saved}"]`);
  if (target) {
    target.click();
  } else {
    // fallback para dashboard
    $('#sideNav button[data-page="dashboard"]')?.click();
  }
}

// Carrega payouts assim que o admin entra (necessário para o badge de pendentes)
(async function() {
  if (DB.isAuthed() && cache.me && cache.me.role === 'admin') {
    try { await DB.getAllPayouts('all'); } catch {}
  }
})();
$$('[data-jump]').forEach(b => b.onclick = () => {
  $(`#sideNav button[data-page="${b.dataset.jump}"]`).click();
});

$$('[data-close]').forEach(b => b.onclick = () => $(`#${b.dataset.close}`).classList.remove('open'));
$$('.modal').forEach(m => m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); });

// Empty trash handler
document.addEventListener('DOMContentLoaded', () => {
  const emptyBtn = document.getElementById('emptyTrashBtn');
  if (emptyBtn) {
    emptyBtn.addEventListener('click', async () => {
      const count = DB.getTrashedOrders().length;
      if (count === 0) { toast('Lixeira já está vazia'); return; }
      const ok = await adminConfirm({
        title: 'Esvaziar lixeira',
        message: `Deseja excluir <strong>permanentemente</strong> todos os <strong>${count}</strong> pedidos da lixeira? Esta ação <strong>não pode ser desfeita</strong>.`,
        okText: `Sim, excluir ${count} pedidos`,
        danger: true
      });
      if (!ok) return;
      const endLoading = Loading.buttonStart(emptyBtn, 'Esvaziando…');
      try {
        const r = await DB.emptyTrash();
        endLoading();
        if (r.error) { toast(r.error, false); return; }
        renderAll();
        toast(`Lixeira esvaziada: ${r.deleted} pedido${r.deleted !== 1 ? 's' : ''} excluído${r.deleted !== 1 ? 's' : ''} permanentemente`);
      } catch (err) {
        endLoading();
        toast(err.message || 'Erro ao esvaziar lixeira', false);
      }
    });
  }
});

function renderDashboard() {
  try {
    const products = DB.getProducts() || [];
    const orders = DB.getOrders() || [];
    const payouts = DB.getPayouts() || [];
    const paidOrders = orders.filter(o => o && o.status === 'pago');
    const revenue = paidOrders.reduce((s, x) => s + Number(x.total || 0), 0);
    const pending = orders.filter(o => o && o.status === 'pendente').length;
    const affPending = payouts.filter(p => p && p.status === 'pendente').length;

    $('#statGrid').innerHTML = `
      <div class="stat-card">
        <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
        <div class="body"><div class="lbl">Receita total</div><div class="num">${brl(revenue)}</div><div class="delta">${paidOrders.length} vendas concluídas</div></div>
      </div>
      <div class="stat-card">
        <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
        <div class="body"><div class="lbl">Plugins ativos</div><div class="num">${products.length}</div><div class="delta">${products.filter(p => p.badge).length} em destaque</div></div>
      </div>
      <div class="stat-card">
        <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>
        <div class="body"><div class="lbl">Pedidos no total</div><div class="num">${orders.length}</div><div class="delta">${orders.length === 0 ? 'comece a vender' : 'histórico'}</div></div>
      </div>
      <div class="stat-card">
        <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
        <div class="body"><div class="lbl">Payouts pendentes</div><div class="num">${affPending}</div><div class="delta">${pending === 0 ? 'tudo em dia' : `${pending} pedidos pendentes também`}</div></div>
      </div>
    `;

    // Sanitizar orders para garantir buyer/items como objetos
    const safeOrders = orders.map(o => ({
      ...o,
      buyer: o.buyer && typeof o.buyer === 'object' ? o.buyer : { name: o.buyerName || '', email: o.buyerEmail || '' },
      items: Array.isArray(o.items) ? o.items : [],
      total: Number(o.total || 0),
      affiliateCode: o.affiliateCode || o.affiliate_code || null,
      payment: o.paymentMethod || o.payment_method || o.payment || '—',
      createdAt: o.createdAt || o.created_at,
      status: o.status || 'pendente'
    }));

    const recent = safeOrders.slice(0, 5);
    if (recent.length === 0) {
      $('#recentSales').innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--ink-3); padding:40px">Nenhum pedido registrado ainda.</td></tr>`;
    } else {
      $('#recentSales').innerHTML = recent.map(o => `
        <tr>
          <td><strong>${escHtml(o.buyer.name || '—')}</strong><br><small style="color:var(--ink-3)">${escHtml(o.buyer.email || '')}</small></td>
          <td>${o.items.length}</td>
          <td><strong>${brl(o.total)}</strong>${o.affiliateCode ? `<br><small style="color:var(--ink-3)">via <code>${escHtml(o.affiliateCode)}</code></small>` : ''}</td>
          <td>${escHtml(o.payment)}</td>
          <td><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></td>
          <td><small style="color:var(--ink-3)">${fmtDate(o.createdAt)}</small></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('renderDashboard error:', err);
  }
}

function renderProducts() {
  const list = DB.getProducts();
  if (list.length === 0) {
    $('#productsTable').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-3); padding:40px">Nenhum plugin cadastrado. Clique em "Novo plugin" para começar.</td></tr>`;
    return;
  }
  $('#productsTable').innerHTML = list.map(p => {
    const synced = !!p.abacateProductId;
    return `
    <tr>
      <td>
        <div class="row-product">
          <div class="ic">${escHtml((p.name || '?').charAt(0))}</div>
          <div class="info"><strong>${escHtml(p.name)}</strong><small>${escHtml(p.tagline)}</small></div>
        </div>
      </td>
      <td>${escHtml(p.category)}</td>
      <td>${escHtml(p.version)}</td>
      <td><strong>${brl(p.price)}</strong>${p.oldPrice ? ` <small style="color:var(--ink-3); text-decoration:line-through">${brl(p.oldPrice)}</small>` : ''}</td>
      <td>${p.badge ? `<span class="pill">${escHtml(p.badge)}</span>` : '<span style="color:var(--ink-3)">—</span>'}</td>
      <td>${synced
        ? '<span class="pill ok" title="Sincronizado com AbacatePay (cartão habilitado)">Cartão OK</span>'
        : '<span class="pill warn" title="Sem sync com AbacatePay — cartão indisponível para este plugin. Clique em Sync AbacatePay acima.">Sem sync</span>'}</td>
      <td style="text-align:right">
        <div class="actions justify-end">
          <button class="icon-btn" data-edit="${p.id}" title="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" data-del="${p.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $$('[data-edit]').forEach(b => b.onclick = () => openProductModal(b.dataset.edit));
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (confirm('Excluir este plugin?')) {
      try {
        await DB.deleteProduct(b.dataset.del);
        renderAll();
        toast('Plugin excluído');
      } catch (err) {
        toast(err.message || 'Erro ao excluir', false);
      }
    }
  });
}

let editingId = null;
function openProductModal(id = null) {
  editingId = id;
  const form = $('#productForm');
  form.reset();
  if (id) {
    const p = DB.getProducts().find(x => x.id === id);
    $('#productModalTitle').textContent = 'Editar plugin';
    form.name.value = p.name;
    form.tagline.value = p.tagline;
    form.description.value = p.description;
    form.video.value = p.video || '';
    form.downloadUrl.value = p.downloadUrl || '';
    form.price.value = p.price;
    form.oldPrice.value = p.oldPrice || '';
    form.category.value = p.category;
    form.version.value = p.version;
    form.badge.value = p.badge || '';
    form.stock.value = p.stock || 999;
    form.maxDownloads.value = p.maxDownloads || 5;
    form.features.value = (p.features || []).join('\n');
  } else {
    $('#productModalTitle').textContent = 'Novo plugin';
  }
  $('#productModal').classList.add('open');
}

$('#newProductBtn').onclick = () => openProductModal();

// Sync products to AbacatePay
const syncBtn = document.getElementById('syncAbacateBtn');
if (syncBtn) {
  syncBtn.onclick = async () => {
    const endLoading = Loading.buttonStart(syncBtn, 'Sincronizando...');
    try {
      const r = await DB.syncProductsToAbacate();
      endLoading();
      if (r.ok) {
        toast(`${r.synced} produto${r.synced !== 1 ? 's' : ''} sincronizado${r.synced !== 1 ? 's' : ''} com AbacatePay${r.failed ? ` (${r.failed} falhou)` : ''}`);
        await DB.getAllProducts();
        renderProducts();
      } else {
        toast(r.error || 'Erro ao sincronizar', false);
      }
    } catch (err) {
      endLoading();
      toast(err.message || 'Erro ao sincronizar', false);
    }
  };
}

$('#saveProductBtn').onclick = async () => {
  const f = $('#productForm');
  if (!f.name.value || !f.price.value) { toast('Preencha os campos obrigatórios', false); return; }
  const videoUrl = f.video.value.trim();
  if (videoUrl && !DB.parseVideoUrl(videoUrl)) {
    toast('URL de vídeo não reconhecida. Use YouTube, Vimeo ou .mp4', false);
    return;
  }
  const data = {
    name: f.name.value,
    tagline: f.tagline.value,
    description: f.description.value,
    video: videoUrl || '',
    downloadUrl: f.downloadUrl.value.trim() || '',
    price: parseFloat(f.price.value),
    oldPrice: f.oldPrice.value ? parseFloat(f.oldPrice.value) : null,
    category: f.category.value,
    version: f.version.value,
    badge: f.badge.value || null,
    stock: parseInt(f.stock.value) || 999,
    maxDownloads: parseInt(f.maxDownloads.value) || 5,
    features: f.features.value.split('\n').map(s => s.trim()).filter(Boolean)
  };
  try {
    let result;
    if (editingId) {
      result = await DB.updateProduct(editingId, data);
      toast('Plugin atualizado');
    } else {
      result = await DB.addProduct(data);
      toast('Plugin criado');
    }
    // Feedback de sync com AbacatePay (cartão)
    if (result && result.abacate) {
      if (result.abacate.synced || result.abacate.resynced) {
        toast('Sincronizado com AbacatePay (cartão habilitado)', true);
      } else if (result.abacate.error) {
        toast(`Plugin salvo, mas sync com AbacatePay falhou: ${result.abacate.error}. Cartão indisponível até "Sync AbacatePay".`, false);
      }
    }
    $('#productModal').classList.remove('open');
    renderAll();
  } catch (err) {
    toast(err.message || 'Erro ao salvar plugin', false);
  }
};

let _salesTab = 'active';
let _trashSearch = '';
let _selectedOrders = new Set();

function updateSelectAllCheckbox() {
  const cb = $('#selectAllCheckbox');
  if (!cb) return;
  const rows = $$('#salesTable .row-checkbox');
  const allChecked = rows.length > 0 && rows.every(r => r.checked);
  cb.checked = allChecked;
  cb.indeterminate = !allChecked && rows.some(r => r.checked);
}

function onRowCheckboxClick(checkbox, orderId) {
  if (checkbox.checked) _selectedOrders.add(orderId);
  else _selectedOrders.delete(orderId);
  const row = checkbox.closest('tr');
  if (row) row.classList.toggle('selected', checkbox.checked);
  updateSelectAllCheckbox();
}

function renderSales() {
  $$('.sale-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.saletab === _salesTab);
    t.onclick = () => { _salesTab = t.dataset.saletab; renderSales(); };
  });

  // Badge da lixeira na aba
  const trashCount = DB.getTrashedOrders().length;
  const trashBadge = $('#trashBadge');
  if (trashBadge) {
    trashBadge.textContent = trashCount;
    trashBadge.style.display = trashCount > 0 ? '' : 'none';
    trashBadge.title = trashCount === 1 ? '1 pedido na lixeira' : trashCount + ' pedidos na lixeira';
  }

  // Toolbar da lixeira (search + empty)
  const toolbar = $('#trashToolbar');
  if (toolbar) {
    toolbar.style.display = _salesTab === 'trash' ? 'flex' : 'none';
    if (_salesTab === 'trash') {
      const searchInput = $('#trashSearchInput');
      if (searchInput) {
        searchInput.value = _trashSearch;
        clearTimeout(searchInput._debounce);
        searchInput.oninput = () => {
          clearTimeout(searchInput._debounce);
          searchInput._debounce = setTimeout(() => {
            _trashSearch = searchInput.value.trim().toLowerCase();
            renderTrashSales();
          }, 200);
        };
      }
    }
  }

  if (_salesTab === 'trash') {
    renderTrashSales();
  } else {
    renderActiveSales();
  }
}

function renderActiveSales() {
  $('#salesThead').innerHTML = `<th style="width:32px"><input type="checkbox" class="row-checkbox select-all" id="selectAllCheckbox" title="Selecionar todos" /></th><th>ID</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>Status</th><th>Data</th><th style="text-align:right">Ações</th>`;

  const orders = (DB.getOrders() || []).map(o => ({
    ...o,
    buyer: o.buyer && typeof o.buyer === 'object' ? o.buyer : { name: o.buyerName || '', email: o.buyerEmail || '' },
    items: Array.isArray(o.items) ? o.items : [],
    total: Number(o.total || 0),
    affiliateCode: o.affiliateCode || o.affiliate_code || null,
    payment: o.paymentMethod || o.payment_method || o.payment || 'pix',
    createdAt: o.createdAt || o.created_at,
    status: o.status || 'pendente'
  }));

  if (orders.length === 0) {
    $('#salesTable').innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--ink-3); padding:40px">Nenhum pedido ativo. Use o botão "Registrar venda" para adicionar.</td></tr>`;
    return;
  }
  _selectedOrders = new Set([..._selectedOrders].filter(id => orders.some(o => o.id === id)));
  $('#salesTable').innerHTML = orders.map(o => {
    const checked = _selectedOrders.has(o.id);
    return `<tr class="${checked ? 'selected' : ''}">
      <td style="width:32px"><input type="checkbox" class="row-checkbox" data-order="${o.id}" ${checked ? 'checked' : ''} /></td>
      <td><code style="background:var(--bg-subtle); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:var(--ink-2)">${o.id}</code></td>
      <td><strong>${escHtml(o.buyer.name || '—')}</strong><br><small style="color:var(--ink-3)">${escHtml(o.buyer.email || '')}</small></td>
      <td>${o.items.length}</td>
      <td><strong>${brl(o.total)}</strong>${o.affiliateCode ? `<br><small style="color:var(--ink-3)">via <code>${escHtml(o.affiliateCode)}</code></small>` : ''}</td>
      <td>${escHtml(o.payment)}</td>
      <td><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></td>
      <td><small style="color:var(--ink-3)">${fmtDate(o.createdAt)}</small></td>
      <td style="text-align:right">
        <div class="actions justify-end">
          <button class="icon-btn" data-view="${o.id}" title="Ver detalhes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn" data-status="${o.id}" title="Alterar status">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 4v5h-5"/></svg>
          </button>
          <button class="icon-btn danger" data-delsale="${o.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Wire row checkboxes
  $$('#salesTable .row-checkbox:not(.select-all)').forEach(cb => {
    cb.onclick = () => onRowCheckboxClick(cb, cb.dataset.order);
    cb.closest('tr').onclick = (e) => {
      if (e.target.type !== 'checkbox' && !e.target.closest('.icon-btn')) {
        cb.checked = !cb.checked;
        onRowCheckboxClick(cb, cb.dataset.order);
        cb.closest('tr').classList.toggle('selected', cb.checked);
      }
    };
  });
  // Wire select-all
  const selectAll = $('#selectAllCheckbox');
  if (selectAll) {
    selectAll.onclick = () => {
      const checked = selectAll.checked;
      $$('#salesTable .row-checkbox:not(.select-all)').forEach(cb => {
        cb.checked = checked;
        if (checked) _selectedOrders.add(cb.dataset.order);
        else _selectedOrders.delete(cb.dataset.order);
        cb.closest('tr').classList.toggle('selected', checked);
      });
    };
  }

  $$('[data-view]').forEach(b => b.onclick = () => openSaleDetail(b.dataset.view));
  $$('[data-status]').forEach(b => b.onclick = async () => {
    const order = DB.getOrders().find(x => x.id === b.dataset.status);
    if (!order) { toast('Pedido não encontrado', false); return; }
    const next = order.status === 'pago' ? 'pendente' : order.status === 'pendente' ? 'cancelado' : 'pago';
    try {
      const patch = { status: next };
      if (next === 'pago') {
        patch.manualOverride = true;
        patch.reason = 'Confirmação manual via painel administrativo';
      }
      await DB.updateOrder(order.id, patch);
      await DB.getAllOrders();
      renderAll();
      toast(`Status: ${next}`);
    } catch (err) {
      toast(err.message || 'Erro ao atualizar', false);
    }
  });
  $$('[data-delsale]').forEach(b => b.onclick = async () => {
    const order = DB.getOrders().find(x => x.id === b.dataset.delsale);
    if (!order) { toast('Pedido não encontrado', false); return; }
    let force = true;
    if (order.status !== 'pago') {
      force = false;
      const ok = await adminConfirm({
        title: 'Mover para lixeira',
        message: `Deseja mover o pedido <strong>${order.id}</strong> para a lixeira? Ele ficará disponível por <strong>7 dias</strong> antes de ser removido automaticamente.`,
        okText: 'Mover para lixeira',
        danger: true
      });
      if (!ok) return;
    } else {
      let ok = await adminConfirm({
        title: 'Excluir permanentemente',
        message: `Este pedido <strong>está pago</strong>. A exclusão é <strong>irreversível</strong> e a comissão do afiliado será revertida.`,
        okText: 'Excluir permanentemente',
        danger: true
      });
      if (!ok) return;
      ok = await adminConfirm({
        title: 'Última confirmação',
        message: 'Tem <strong>absoluta certeza</strong>? Esta ação <strong>não pode ser desfeita</strong>.',
        okText: 'Sim, excluir permanentemente',
        danger: true
      });
      if (!ok) return;
    }
    const btn = b;
    const endLoading = Loading.buttonStart(btn, 'Excluindo…');
    try {
      const r = await DB.deleteOrder(b.dataset.delsale, force);
      endLoading();
      if (r.error) { toast(r.error, false); return; }
      await DB.getAllOrders();
      if (order.status === 'pago') await DB._refreshUserData();
      await DB.getAllTrashedOrders();
      renderAll();
      toast(force ? 'Pedido excluído permanentemente' : 'Pedido movido para a lixeira');
    } catch (err) {
      endLoading();
      toast(err.message || 'Erro ao excluir', false);
    }
  });
}

function renderTrashSales() {
  const all = DB.getTrashedOrders();
  const paidCount = all.filter(o => o.status === 'pago').length;

  // Filtro por busca textual
  const q = _trashSearch;
  const orders = q
    ? all.filter(o => {
        const buyer = o.buyer && typeof o.buyer === 'object' ? o.buyer : { name: o.buyerName || '', email: o.buyerEmail || '' };
        const name = (buyer.name || '').toLowerCase();
        const email = (buyer.email || '').toLowerCase();
        const id = (o.id || '').toLowerCase();
        return name.includes(q) || email.includes(q) || id.includes(q);
      })
    : all;

  // Cabeçalho da tabela muda para colunas da lixeira
  $('#salesThead').innerHTML = `<th style="width:32px"><input type="checkbox" class="row-checkbox select-all" id="selectAllCheckbox" title="Selecionar todos" /></th><th>ID</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>Excluído em</th><th>Expira em</th><th style="text-align:right">Ações</th>`;

  // Info de busca
  const info = $('#trashSearchInfo');
  if (info) {
    if (q && orders.length === 0) {
      info.innerHTML = `Nenhum resultado para "<strong>${escHtml(q)}</strong>"`;
    } else if (q) {
      info.innerHTML = `${orders.length} de ${all.length}`;
    } else {
      info.innerHTML = `${all.length} pedido${all.length !== 1 ? 's' : ''}`;
    }
  }

  _selectedOrders = new Set([..._selectedOrders].filter(id => orders.some(o => o.id === id)));
  $('#salesTable').innerHTML = orders.map(o => {
    const checked = _selectedOrders.has(o.id);
    const buyer = o.buyer && typeof o.buyer === 'object' ? o.buyer : { name: o.buyerName || '', email: o.buyerEmail || '' };
    const items = Array.isArray(o.items) ? o.items : [];
    const trashInfo = o.trashInfo || {};
    const remaining = trashInfo.remainingDays != null
      ? `${trashInfo.remainingDays}d ${trashInfo.remainingHours}h`
      : '—';
    const remainingClass = (trashInfo.remainingDays != null && trashInfo.remainingDays <= 1) ? 'danger' : '';
    const remainingTitle = trashInfo.expiresAt
      ? `Expira em ${fmtDate(trashInfo.expiresAt)}`
      : '';
    return `<tr class="${checked ? 'selected' : ''}">
      <td style="width:32px"><input type="checkbox" class="row-checkbox" data-order="${o.id}" ${checked ? 'checked' : ''} /></td>
      <td><code style="background:var(--bg-subtle); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:var(--ink-2)">${o.id}</code></td>
      <td><strong>${escHtml(buyer.name || '—')}</strong><br><small style="color:var(--ink-3)">${escHtml(buyer.email || '')}</small></td>
      <td>${items.length}</td>
      <td><strong>${brl(o.total)}</strong></td>
      <td><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></td>
      <td><small style="color:var(--ink-3)">${fmtDate(trashInfo.deletedAt)}</small></td>
      <td><small style="color:${remainingClass ? 'var(--danger)' : 'var(--ink-3)'}" title="${remainingTitle}">${remaining}</small></td>
      <td style="text-align:right">
        <div class="actions justify-end">
          <button class="icon-btn" data-restore="${o.id}" title="Restaurar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button class="icon-btn danger" data-deltrash="${o.id}" title="Excluir permanentemente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  if (orders.length === 0) {
    $('#salesTable').innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--ink-3); padding:40px">${q ? 'Nenhum pedido encontrado para esta busca.' : 'Lixeira vazia. Pedidos excluídos aparecem aqui.'}</td></tr>`;
  }

  // Wire row checkboxes
  $$('#salesTable .row-checkbox:not(.select-all)').forEach(cb => {
    cb.onclick = () => {
      cb.closest('tr').classList.toggle('selected', cb.checked);
      onRowCheckboxClick(cb, cb.dataset.order);
    };
    cb.closest('tr').onclick = (e) => {
      if (e.target.type !== 'checkbox' && !e.target.closest('.icon-btn')) {
        cb.checked = !cb.checked;
        cb.closest('tr').classList.toggle('selected', cb.checked);
        onRowCheckboxClick(cb, cb.dataset.order);
      }
    };
  });
  // Wire select-all
  const selectAll = $('#selectAllCheckbox');
  if (selectAll) {
    selectAll.onclick = () => {
      const checked = selectAll.checked;
      $$('#salesTable .row-checkbox:not(.select-all)').forEach(cb => {
        cb.checked = checked;
        if (checked) _selectedOrders.add(cb.dataset.order);
        else _selectedOrders.delete(cb.dataset.order);
        cb.closest('tr').classList.toggle('selected', checked);
      });
    };
  }

  // Wire restore buttons
  $$('[data-restore]').forEach(b => b.onclick = async () => {
    const id = b.dataset.restore;
    const ok = await adminConfirm({
      title: 'Restaurar pedido',
      message: `Deseja restaurar o pedido <strong>${id}</strong>? Ele voltará para a lista de pedidos ativos.`,
      okText: 'Restaurar'
    });
    if (!ok) return;
    const btn = b;
    const endLoading = Loading.buttonStart(btn, 'Restaurando…');
    try {
      const r = await DB.restoreOrder(id);
      endLoading();
      if (r.error) { toast(r.error, false); return; }
      if (r.restored) {
        await DB.getAllOrders();
        await DB.getAllTrashedOrders();
        renderAll();
        toast('Pedido restaurado');
      }
    } catch (err) {
      endLoading();
      toast(err.message || 'Erro ao restaurar', false);
    }
  });

  // Wire permanent delete buttons
  $$('[data-deltrash]').forEach(b => b.onclick = async () => {
    const id = b.dataset.deltrash;
    const order = orders.find(o => o.id === id);
    if (!order) return;
    const isPaid = order.status === 'pago';
    const ok = await adminConfirm({
      title: 'Excluir permanentemente',
      message: isPaid
        ? `Este pedido <strong>está pago</strong>. A comissão já foi revertida, mas o registro será perdido para sempre.`
        : `O pedido <strong>${id}</strong> será excluído <strong>permanentemente</strong>. Esta ação <strong>não pode ser desfeita</strong>.`,
      okText: 'Excluir permanentemente',
      danger: true
    });
    if (!ok) return;
    const btn = b;
    const endLoading = Loading.buttonStart(btn, 'Excluindo…');
    try {
      const r = await DB.deleteOrder(id, true);
      endLoading();
      if (r.error) { toast(r.error, false); return; }
      await DB.getAllTrashedOrders();
      renderAll();
      toast('Pedido excluído permanentemente');
    } catch (err) {
      endLoading();
      toast(err.message || 'Erro ao excluir', false);
    }
  });
}

function openSaleDetail(id) {
  const o = DB.getOrders().find(x => x.id === id);
  if (!o) return;
  const b = o.breakdown || {};
  const hasBreakdown = b.subtotal > 0 && b.gatewayFee > 0;
  const breakdownHtml = hasBreakdown ? `
    <div class="sale-items full" style="margin-top:10px; background:var(--bg-subtle); padding:10px; border-radius:6px">
      <strong style="display:block; margin-bottom:8px; font-weight:600">Breakdown de taxas</strong>
      <div class="it"><span>Subtotal (preço bruto)</span><strong>${brl(b.subtotal)}</strong></div>
      <div class="it" style="color:var(--ink-3)"><span>− Taxa gateway (AbacatePay)</span><strong>− ${brl(b.gatewayFee)}</strong></div>
      <div class="it" style="color:var(--ink-3)"><span>− Impostos${b.taxRate ? ` (${(b.taxRate * 100).toFixed(1)}%)` : ''}</span><strong>${b.taxAmount ? '− ' + brl(b.taxAmount) : '—'}</strong></div>
      <div class="it" style="border-top:1px solid var(--line); padding-top:6px; margin-top:6px"><span>Líquido (base da comissão)</span><strong>${brl(b.netAmount)}</strong></div>
      ${o.affiliateCode ? `<div class="it" style="color:var(--ink-3)"><span>− Comissão afiliado (${b.commissionRate || 25}%)</span><strong>− ${brl(b.commission || 0)}</strong></div>
      <div class="it" style="color:var(--success, #4ade80)"><span><strong>Loja recebe</strong></span><strong>${brl(b.storeKeeps)}</strong></div>` : ''}
    </div>` : '';
  $('#saleDetailBody').innerHTML = `
    <div class="sale-detail">
      <div class="kv"><div class="lbl">ID</div><div class="val"><code>${escHtml(o.id)}</code></div></div>
      <div class="kv"><div class="lbl">Status</div><div class="val"><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></div></div>
      <div class="kv"><div class="lbl">Cliente</div><div class="val">${escHtml(o.buyer.name)}</div></div>
      <div class="kv"><div class="lbl">E-mail</div><div class="val">${escHtml(o.buyer.email)}</div></div>
      <div class="kv"><div class="lbl">Pagamento</div><div class="val">${escHtml(o.payment)}</div></div>
      <div class="kv"><div class="lbl">Data</div><div class="val">${fmtDate(o.createdAt)}</div></div>
      <div class="kv"><div class="lbl">Licença</div><div class="val"><code>${escHtml(o.licenseKey)}</code></div></div>
      <div class="kv"><div class="lbl">Token de download</div><div class="val"><a href="download.html?t=${encodeURIComponent(o.downloadToken || '')}" target="_blank" style="color:var(--ink); text-decoration:underline">${escHtml((o.downloadToken || '').slice(0,12))}…</a></div></div>
      <div class="kv"><div class="lbl">Downloads</div><div class="val">${(o.downloads || []).length} ${(o.downloads && o.downloads.length) ? '· último em ' + fmtDay(o.downloads[o.downloads.length-1].ts) : ''}</div></div>
      ${o.affiliateCode ? `<div class="kv"><div class="lbl">Afiliado</div><div class="val"><code>${escHtml(o.affiliateCode)}</code></div></div><div class="kv"><div class="lbl">Comissão</div><div class="val">${brl(o.commission || 0)}</div></div>` : ''}
      <div class="sale-items full">
        <strong style="display:block; margin-bottom:8px; font-weight:600">Itens</strong>
        ${o.items.map(i => `<div class="it"><span>${escHtml(i.name)}</span><strong>${brl(i.price)}</strong></div>`).join('')}
        <div class="it" style="border-top:1px solid var(--line); margin-top:6px; padding-top:10px"><span>Total</span><strong style="font-size:1.0625rem">${brl(o.total)}</strong></div>
      </div>
      ${breakdownHtml}
    </div>
  `;
  $('#saleDetailModal').classList.add('open');
}

$('#newSaleBtn').onclick = () => {
  const sel = $('#saleProductSelect');
  sel.innerHTML = DB.getProducts().map(p => `<option value="${escAttr(p.id)}">${escHtml(p.name)} — ${brl(p.price)}</option>`).join('');
  $('#saleForm').reset();
  $('#saleModal').classList.add('open');
};

$('#saveSaleBtn').onclick = async () => {
  const f = $('#saleForm');
  const productId = f.productId.value;
  const product = DB.getProducts().find(p => p.id === productId);
  if (!product) { toast('Selecione um plugin', false); return; }

  const refCode = (f.affiliateCode.value || '').trim().toUpperCase();
  let affiliate = null;
  if (refCode) {
    affiliate = await DB.findAffiliateByCode(refCode);
    if (!affiliate) { toast('Código de afiliado inválido', false); return; }
    if (affiliate.status !== 'active') { toast('Afiliado não está ativo', false); return; }
    if (DB.isSelfReferral(affiliate, f.buyerEmail.value)) { toast('Self-referral bloqueado', false); return; }
    // A comissão é calculada pelo backend (sobre o líquido) — não enviar valor aqui.
  }

  try {
    const result = await DB.addOrder({
      buyer: { name: f.buyerName.value, email: f.buyerEmail.value },
      payment: f.payment.value,
      paymentMethod: f.payment.value,
      items: [{ id: product.id, name: product.name, price: product.price, downloadUrl: product.downloadUrl || '' }],
      total: product.price,
      affiliateCode: affiliate ? affiliate.code : null
    });
    const order = result.order;
    // Se o admin escolheu status 'pago' direto, confirmar o pedido manualmente
    if (order && f.status.value === 'pago') {
      try {
        await DB.updateOrder(order.id, {
          status: 'pago',
          manualOverride: true,
          reason: 'Pedido criado e pago manualmente pelo administrador'
        });
      } catch (e) { console.warn('updateOrder pago falhou:', e.message); toast(e.message || 'Erro ao confirmar pagamento', false); }
    }
    // Re-fetch do backend para garantir consistência total (incluindo credit de afiliado)
    await DB.getAllOrders();
    await DB._refreshUserData();
    $('#saleModal').classList.remove('open');
    renderAll();
    toast('Pedido registrado');
  } catch (err) {
    toast(err.message || 'Erro ao registrar pedido', false);
  }
};

function detectFraud() {
  const alerts = [];
  const orders = (DB.getOrders() || []);
  const affs = (DB.getAffiliates() || []);
  affs.forEach(a => {
    const aCode = a.code || a.affiliateCode;
    const aEmail = (a.email || '').toLowerCase();
    const selfOrders = orders.filter(o => {
      const oCode = o.affiliateCode || o.affiliate_code;
      const oEmail = (o.buyer && o.buyer.email) || o.buyerEmail || o.buyer_email || '';
      return oCode === aCode && oEmail.toLowerCase() === aEmail;
    });
    if (selfOrders.length > 0) {
      alerts.push({ type: 'self', aff: a, orders: selfOrders });
    }
  });
  return alerts;
}

function renderAffiliates() {
  DB.recalcAffiliateStats();
  const list = (DB.getAffiliates() || []).map(a => ({
    ...a,
    code: a.code || a.affiliateCode,
    rate: a.rate || a.affiliateRate || 25,
    status: a.status || a.affiliateStatus || 'active',
    totalEarned: Number(a.totalEarned || 0),
    totalSales: Number(a.totalSales || 0),
    paidOut: Number(a.paidOut || 0),
    clicks: Number(a.clicks || 0),
    conversions: Number(a.conversions || 0),
    pixKey: a.pixKey || a.pix_key || '',
    pixHolder: a.pixHolder || a.pix_holder || ''
  }));
  const totalEarned = list.reduce((s, a) => s + a.totalEarned, 0);
  const totalPaid = list.reduce((s, a) => s + a.paidOut, 0);
  const totalPending = Math.max(0, totalEarned - totalPaid);
  const activeCount = list.filter(a => a.status === 'active').length;
  const totalClicks = list.reduce((s, a) => s + (a.clicks || 0), 0);
  const fraud = detectFraud();

  $('#affStatGrid').innerHTML = `
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/></svg></div>
      <div class="body"><div class="lbl">Afiliados ativos</div><div class="num">${activeCount}</div><div class="delta">${list.length} no total</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20M12 2v20"/></svg></div>
      <div class="body"><div class="lbl">Cliques totais</div><div class="num">${totalClicks}</div><div class="delta">deduplicados por dia</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <div class="body"><div class="lbl">Comissão total</div><div class="num">${brl(totalEarned)}</div><div class="delta">gerada</div></div>
    </div>
    <div class="stat-card" style="${fraud.length > 0 ? 'border-color:var(--danger)' : ''}">
      <div class="ic" style="${fraud.length > 0 ? 'background:color-mix(in srgb, var(--danger) 15%, transparent); color:var(--danger)' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div class="body"><div class="lbl">Alertas de fraude</div><div class="num">${fraud.length}</div><div class="delta">${fraud.length === 0 ? 'tudo limpo' : 'revisar abaixo'}</div></div>
    </div>
  `;

  if (list.length === 0) {
    $('#affiliatesTable').innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--ink-3); padding:40px">Nenhum afiliado cadastrado ainda. Eles aparecem aqui quando alguém se cadastrar pela loja.</td></tr>`;
    return;
  }

  const fraudIds = new Set(fraud.flatMap(f => f.orders.map(o => o.id)));

  $('#affiliatesTable').innerHTML = list.map(a => {
    const isBanned = a.status === 'banned';
    return `
    <tr>
      <td>
        <div class="row-product">
          <div class="ic">${escHtml((a.name || '?').charAt(0).toUpperCase())}</div>
          <div class="info">
            <strong>${escHtml(a.name)}</strong>
            <small>${escHtml(a.email)}</small>
            ${fraud.find(f => f.aff.id === a.id) ? '<small style="color:var(--danger); font-weight:500">⚠ Self-referral detectado</small>' : ''}
          </div>
        </div>
      </td>
      <td><code style="background:var(--bg-subtle); padding:3px 8px; border-radius:4px; font-size:0.8125rem; color:var(--ink)">${escHtml(a.code)}</code></td>
      <td>${a.rate}%</td>
      <td>${a.clicks || 0}</td>
      <td>${a.totalSales || 0}</td>
      <td><strong>${brl(a.totalEarned)}</strong></td>
      <td style="color:var(--ink-3)">${brl(a.paidOut)}</td>
      <td><span class="pill ${a.status === 'active' ? 'ok' : a.status === 'paused' ? 'warn' : 'danger'}">${a.status === 'active' ? 'ativo' : a.status === 'paused' ? 'pausado' : 'banido'}</span></td>
      <td style="text-align:right">
        <div class="actions justify-end">
          <button class="icon-btn" data-detail="${a.id}" title="Ver detalhes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn" data-manualcomm="${a.id}" title="Adicionar comissão manual">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="icon-btn" data-toggle-aff="${a.id}" title="${a.status === 'active' ? 'Pausar' : 'Ativar'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${a.status === 'active' ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>'}</svg>
          </button>
          <button class="icon-btn ${isBanned ? '' : 'danger'}" data-ban="${a.id}" title="${isBanned ? 'Desbanir' : 'Banir'}" style="${isBanned ? 'color:var(--ink-2)' : ''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          </button>
          <button class="icon-btn danger" data-delaff="${a.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $$('[data-detail]').forEach(b => b.onclick = () => openAffiliateDetail(b.dataset.detail));
  $$('[data-manualcomm]').forEach(b => b.onclick = () => openManualComm(b.dataset.manualcomm));
  $$('[data-toggle-aff]').forEach(b => b.onclick = async () => {
    const a = DB.getAffiliates().find(x => x.id === b.dataset.toggleAff);
    if (!a) return;
    const next = a.status === 'active' ? 'paused' : 'active';
    try {
      await DB.updateAffiliate(a.id, { status: next });
      renderAll();
      toast(next === 'active' ? 'Afiliado ativado' : 'Afiliado pausado');
    } catch (err) {
      toast(err.message || 'Erro', false);
    }
  });
  $$('[data-ban]').forEach(b => b.onclick = async () => {
    const a = DB.getAffiliates().find(x => x.id === b.dataset.ban);
    if (!a) return;
    try {
      if (a.status === 'banned') {
        await DB.updateAffiliate(a.id, { status: 'active' });
        toast('Afiliado desbanido');
      } else {
        const reason = await adminPrompt({
          title: 'Banir afiliado',
          message: 'Informe o motivo do ban (opcional). O afiliado não poderá mais acessar a conta.',
          placeholder: 'Ex: fraude em vendas',
          okText: 'Banir'
        });
        if (reason === null) return;
        await DB.updateAffiliate(a.id, { status: 'banned', banReason: reason || '' });
        toast('Afiliado banido');
      }
      renderAll();
    } catch (err) {
      toast(err.message || 'Erro', false);
    }
  });
  $$('[data-delaff]').forEach(b => b.onclick = () => {
    if (!confirm('Excluir este afiliado? Pedidos antigos com o código dele continuam registrados.')) return;
    DB.deleteAffiliate(b.dataset.delaff);
    renderAll();
    toast('Afiliado excluído');
  });
}

// =============================================================
//  USUÁRIOS
// =============================================================
function renderUsers() {
  const users = (DB.getUsers ? DB.getUsers() : DB.getBuyers()) || [];
  const totalUsers = users.length;
  const totalBuyers = users.filter(u => u.role === 'buyer').length;
  const totalAffiliates = users.filter(u => u.isAffiliate).length;
  const totalAdmins = users.filter(u => u.role === 'admin').length;

  $('#usersStatGrid').innerHTML = `
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
      <div class="body"><div class="lbl">Total de usuários</div><div class="num">${totalUsers}</div><div class="delta">cadastrados</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <div class="body"><div class="lbl">Compradores</div><div class="num">${totalBuyers}</div><div class="delta">contas</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg></div>
      <div class="body"><div class="lbl">Afiliados</div><div class="num">${totalAffiliates}</div><div class="delta">cadastrados</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <div class="body"><div class="lbl">Administradores</div><div class="num">${totalAdmins}</div><div class="delta">ativos</div></div>
    </div>
  `;

  if (users.length === 0) {
    $('#usersTable').innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--ink-3); padding:40px">Nenhum usuário cadastrado ainda.</td></tr>`;
    return;
  }

  $('#usersTable').innerHTML = users.map(u => {
    const roleLabel = u.role === 'admin' ? 'admin' : u.role === 'buyer' ? 'comprador' : u.role;
    const status = u.isAffiliate ? (u.affiliateStatus || 'active') : 'active';
    return `
    <tr>
      <td>
        <div class="row-product">
          <div class="ic">${escHtml((u.name || '?').charAt(0).toUpperCase())}</div>
          <div class="info">
            <strong>${escHtml(u.name)}</strong>
            <small>${escHtml(u.affiliateCode ? 'Código: ' + u.affiliateCode : 'Sem código de afiliado')}</small>
          </div>
        </div>
      </td>
      <td>${escHtml(u.email)}</td>
      <td><span class="pill ${u.role === 'admin' ? 'warn' : 'ok'}">${escHtml(roleLabel)}</span></td>
      <td><span class="pill ${status === 'active' ? 'ok' : status === 'paused' ? 'warn' : 'danger'}">${status === 'active' ? 'ativo' : status === 'paused' ? 'pausado' : 'banido'}</span></td>
      <td style="color:var(--ink-3)">${fmtDay(u.createdAt)}</td>
      <td style="text-align:right">
        <div class="actions justify-end">
          <button class="icon-btn" data-user-detail="${u.id}" title="Ver detalhes">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn danger" data-user-del="${u.id}" title="Excluir usuário e dados">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $$('[data-user-detail]').forEach(b => b.onclick = () => openUserDetail(b.dataset.userDetail));
  $$('[data-user-del]').forEach(b => b.onclick = async () => {
    const id = b.dataset.userDel;
    const u = DB.getUser && DB.getUser(id);
    if (!u) return;
    const confirmed = await adminConfirm({
      title: 'Excluir usuário',
      message: `Tem certeza que deseja remover <strong>${escHtml(u.name)}</strong> (${escHtml(u.email)}) e todos os dados associados (pedidos, pagamentos, cliques, downloads, códigos de login)? Esta ação não pode ser desfeita.`,
      okText: 'Excluir tudo',
      danger: true
    });
    if (!confirmed) return;
    try {
      await DB.deleteUser(id);
      await DB._refreshUserData();
      renderAll();
      toast('Usuário e dados associados removidos');
    } catch (err) {
      toast(err.message || 'Erro ao excluir usuário', false);
    }
  });
}

async function openUserDetail(id) {
  const cached = DB.getUser && DB.getUser(id);
  if (!cached) return;
  $('#userDetailTitle').textContent = cached.name;
  $('#userDetailBody').innerHTML = '<div style="padding:40px; text-align:center; color:var(--ink-3)"><div class="spinner"></div><br>Carregando detalhes…</div>';
  $('#userDetailModal').classList.add('open');

  let data;
  try {
    data = await DB.getUserDetails(id);
  } catch (err) {
    $('#userDetailBody').innerHTML = `<p style="color:var(--danger); padding:20px">${escHtml(err.message || 'Erro ao carregar detalhes')}</p>`;
    return;
  }

  const u = data.user || cached;
  const orders = data.orders || [];
  const payouts = data.payouts || [];
  const clicks = data.clicks || [];
  const downloadsLog = data.downloadsLog || [];
  const totalOrders = orders.length;
  const paidOrders = orders.filter(o => o.isPaid || o.status === 'pago');
  const totalSpent = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const pendingOrders = orders.filter(o => o.status === 'pendente');

  $('#userDetailBody').innerHTML = `
    <div class="sale-detail">
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px">
        <div class="ic" style="width:48px; height:48px; border-radius:50%; background:var(--ink); color:var(--bg); display:grid; place-items:center; font-size:1.25rem; font-weight:600">${escHtml((u.name || '?').charAt(0).toUpperCase())}</div>
        <div style="flex:1">
          <strong style="font-size:1.0625rem">${escHtml(u.name)}</strong>
          <div style="color:var(--ink-3); font-size:0.875rem">${escHtml(u.email)}</div>
          <div style="margin-top:4px"><span class="pill ${u.role === 'admin' ? 'warn' : 'ok'}">${escHtml(u.role === 'admin' ? 'admin' : u.role === 'buyer' ? 'comprador' : u.role)}</span> ${u.isAffiliate ? `<span class="pill ${(u.affiliateStatus || 'active') === 'active' ? 'ok' : 'warn'}">afiliado</span>` : ''}</div>
        </div>
      </div>
      <div class="kv"><div class="lbl">ID</div><div class="val"><code style="font-size:0.75rem">${escHtml(u.id)}</code></div></div>
      <div class="kv"><div class="lbl">E-mail</div><div class="val">${escHtml(u.email)}</div></div>
      <div class="kv"><div class="lbl">Cadastrado em</div><div class="val">${fmtDate(u.createdAt)}</div></div>
      ${u.emailVerified ? `<div class="kv"><div class="lbl">E-mail verificado</div><div class="val">${fmtDate(u.emailVerifiedAt)}</div></div>` : ''}
      ${u.isAffiliate ? `
        <div class="kv"><div class="lbl">Código de afiliado</div><div class="val">${escHtml(u.affiliateCode)}</div></div>
        <div class="kv"><div class="lbl">Taxa de comissão</div><div class="val">${u.affiliateRate || 25}%</div></div>
        <div class="kv"><div class="lbl">Status de afiliado</div><div class="val">${escHtml(u.affiliateStatus || 'active')}</div></div>
        <div class="kv"><div class="lbl">Cliques</div><div class="val">${Number(u.clicks || 0)}</div></div>
        <div class="kv"><div class="lbl">Vendas</div><div class="val">${Number(u.conversions || 0)}</div></div>
        <div class="kv"><div class="lbl">Total ganho</div><div class="val">${brl(u.totalEarned || 0)}</div></div>
        <div class="kv"><div class="lbl">Pago</div><div class="val">${brl(u.paidOut || 0)}</div></div>
      ` : ''}
      ${u.banReason ? `<div class="kv"><div class="lbl">Motivo do ban</div><div class="val" style="color:var(--danger)">${escHtml(u.banReason)}</div></div>` : ''}

      <div style="margin-top:18px">
        <strong style="display:block; margin-bottom:8px; font-weight:600">Resumo de pedidos</strong>
        <div class="kv"><div class="lbl">Total de pedidos</div><div class="val">${totalOrders}</div></div>
        <div class="kv"><div class="lbl">Pedidos pagos</div><div class="val">${paidOrders.length}</div></div>
        <div class="kv"><div class="lbl">Pendentes</div><div class="val">${pendingOrders.length}</div></div>
        <div class="kv"><div class="lbl">Total gasto</div><div class="val"><strong>${brl(totalSpent)}</strong></div></div>
      </div>

      <div style="margin-top:18px">
        <strong style="display:block; margin-bottom:8px; font-weight:600">Pedidos (${orders.length})</strong>
        ${orders.length === 0 ? '<p style="color:var(--ink-3); font-size:0.875rem">Nenhum pedido encontrado.</p>' : `
          <table style="width:100%; font-size:0.8125rem; border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--line); text-align:left; color:var(--ink-3)"><th style="padding:6px 0">Data</th><th>ID</th><th>Produto</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>${orders.slice(0, 20).map(o => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:8px 0; color:var(--ink-3)">${fmtDay(o.createdAt)}</td><td><code>${escHtml(o.id)}</code></td><td>${escHtml(o.items && o.items[0]?.name || '—')}</td><td>${brl(o.total || 0)}</td><td><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></td></tr>`).join('')}</tbody>
          </table>`}
      </div>

      ${u.isAffiliate && payouts.length > 0 ? `
        <div style="margin-top:18px">
          <strong style="display:block; margin-bottom:8px; font-weight:600">Payouts (${payouts.length})</strong>
          <table style="width:100%; font-size:0.8125rem; border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--line); text-align:left; color:var(--ink-3)"><th style="padding:6px 0">Data</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>${payouts.map(p => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:8px 0; color:var(--ink-3)">${fmtDay(p.requested_at || p.requestedAt)}</td><td>${brl(p.amount || 0)}</td><td><span class="pill ${p.status === 'pago' ? 'ok' : p.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(p.status)}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      ${u.isAffiliate && clicks.length > 0 ? `
        <div style="margin-top:18px">
          <strong style="display:block; margin-bottom:8px; font-weight:600">Últimos cliques (${clicks.length})</strong>
          <table style="width:100%; font-size:0.8125rem; border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--line); text-align:left; color:var(--ink-3)"><th style="padding:6px 0">Data</th><th>IP</th><th>User Agent</th></tr></thead>
            <tbody>${clicks.map(c => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:8px 0; color:var(--ink-3)">${fmtDay(c.created_at || c.createdAt)}</td><td>${escHtml(c.ip || '—')}</td><td style="color:var(--ink-3); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escHtml(c.user_agent || c.userAgent || '—')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}

      ${downloadsLog.length > 0 ? `
        <div style="margin-top:18px">
          <strong style="display:block; margin-bottom:8px; font-weight:600">Downloads (${downloadsLog.length})</strong>
          <table style="width:100%; font-size:0.8125rem; border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--line); text-align:left; color:var(--ink-3)"><th style="padding:6px 0">Data</th><th>Pedido</th><th>IP</th></tr></thead>
            <tbody>${downloadsLog.map(d => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:8px 0; color:var(--ink-3)">${fmtDay(d.created_at || d.createdAt)}</td><td><code>${escHtml(d.order_id || d.orderId)}</code></td><td>${escHtml(d.ip || '—')}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function openAffiliateDetail(id) {
  const a = DB.getAffiliates().find(x => x.id === id);
  if (!a) return;
  const refs = DB.getOrders().filter(o => (o.affiliateCode || '').toUpperCase() === a.code);
  const clicks = DB.getClicksByCode(a.code);
  const pending = +(a.totalEarned - a.paidOut).toFixed(2);
  const conversion = a.clicks > 0 ? ((a.totalSales / a.clicks) * 100).toFixed(1) : '0.0';

  $('#affDetailTitle').textContent = a.name;
  $('#affDetailBody').innerHTML = `
    <div class="sale-detail">
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px">
        <div class="ic" style="width:48px; height:48px; border-radius:50%; background:var(--ink); color:var(--bg); display:grid; place-items:center; font-size:1.25rem; font-weight:600">${escHtml((a.name || '?').charAt(0).toUpperCase())}</div>
        <div style="flex:1">
          <strong style="font-size:1.0625rem">${escHtml(a.name)}</strong>
          <div style="color:var(--ink-3); font-size:0.875rem">${escHtml(a.email)}</div>
          <div style="margin-top:4px"><span class="pill ${a.status === 'active' ? 'ok' : a.status === 'paused' ? 'warn' : 'danger'}">${escHtml(a.status)}</span> <code style="background:var(--bg-subtle); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:var(--ink); margin-left:6px">${escHtml(a.code)}</code></div>
        </div>
      </div>
      <div class="kv"><div class="lbl">Comissão</div><div class="val">${a.rate}%</div></div>
      <div class="kv"><div class="lbl">Cliques (total)</div><div class="val">${a.clicks || 0}</div></div>
      <div class="kv"><div class="lbl">Conversão</div><div class="val">${conversion}%</div></div>
      <div class="kv"><div class="lbl">Vendas comissionadas</div><div class="val">${a.totalSales}</div></div>
      <div class="kv"><div class="lbl">Total ganho</div><div class="val">${brl(a.totalEarned)}</div></div>
      <div class="kv"><div class="lbl">Pago</div><div class="val">${brl(a.paidOut)}</div></div>
      <div class="kv"><div class="lbl">A pagar</div><div class="val"><strong>${brl(pending)}</strong></div></div>
      <div class="kv"><div class="lbl">Cadastrado em</div><div class="val">${fmtDay(a.createdAt)}</div></div>
      ${a.banReason ? `<div class="kv"><div class="lbl">Motivo do ban</div><div class="val" style="color:var(--danger)">${escHtml(a.banReason)}</div></div>` : ''}
      ${renderChartSvg(a.dailyStats || {})}
      <div style="margin-top:18px">
        <strong style="display:block; margin-bottom:8px; font-weight:600">Últimas vendas indicadas (${refs.length})</strong>
        ${refs.length === 0 ? '<p style="color:var(--ink-3); font-size:0.875rem">Nenhuma venda ainda.</p>' : `
          <table style="width:100%; font-size:0.8125rem; border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--line); text-align:left; color:var(--ink-3)"><th style="padding:6px 0">Data</th><th>Cliente</th><th>Produto</th><th>Comissão</th></tr></thead>
            <tbody>${refs.slice(0, 8).map(o => `<tr style="border-bottom:1px solid var(--line)"><td style="padding:8px 0; color:var(--ink-3)">${fmtDay(o.createdAt)}</td><td>${escHtml(o.buyer.name)}</td><td>${escHtml(o.items[0]?.name || '—')}</td><td><strong>${brl(o.commission)}</strong></td></tr>`).join('')}</tbody>
          </table>`}
      </div>
    </div>
  `;
  $('#affiliateDetailModal').classList.add('open');
}

let manualCommAffId = null;
function openManualComm(id) {
  manualCommAffId = id;
  $('#manualCommForm').reset();
  $('#manualCommModal').classList.add('open');
}
$('#saveManualCommBtn').onclick = async () => {
  const f = $('#manualCommForm');
  const amount = parseFloat(f.amount.value);
  const note = f.note.value.trim();
  if (!amount || amount <= 0) { toast('Valor inválido', false); return; }
  if (!note) { toast('Informe um motivo', false); return; }
  const submitBtn = f.querySelector('button[type=submit]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Salvando...'; }
  try {
    await DB.manualCommission(manualCommAffId, amount, note);
    $('#manualCommModal').classList.remove('open');
    toast('Comissão manual adicionada');
    await DB.getAllAffiliates();
    renderAll();
  } catch (err) {
    toast(err.message || 'Erro ao adicionar comissão', false);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Salvar'; }
  }
};

function renderChartSvg(dailyStats) {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const stat = dailyStats[key] || { clicks: 0, sales: 0, earned: 0 };
    days.push({ key, ...stat, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) });
  }
  const maxClicks = Math.max(1, ...days.map(d => d.clicks));
  const W = 560, H = 120, padL = 24, padR = 8, padT = 6, padB = 20;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slotW = chartW / days.length;
  const barW = slotW * 0.7;
  const gap = slotW * 0.3;
  let bars = '';
  let xLabels = '';
  days.forEach((d, i) => {
    const x = padL + i * slotW + gap / 2;
    const h = (d.clicks / maxClicks) * chartH;
    const y = padT + chartH - h;
    const fill = d.sales > 0 ? 'var(--ink)' : 'var(--ink-3)';
    const op = d.clicks > 0 ? (d.sales > 0 ? 1 : 0.7) : 0.2;
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="1" fill="${fill}" opacity="${op}"><title>${d.label}: ${d.clicks} cliques, ${d.sales} vendas</title></rect>`;
    if (i % 7 === 0) xLabels += `<text x="${x + barW/2}" y="${H - 6}" text-anchor="middle" fill="var(--ink-3)" font-size="9" font-family="Inter">${d.label}</text>`;
  });
  return `<div style="margin:14px 0 6px; padding:14px; background:var(--bg); border:1px solid var(--line); border-radius:var(--radius)">
    <strong style="font-size:0.875rem; font-weight:600">Últimos 30 dias</strong>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:${H}px; display:block; margin-top:8px" preserveAspectRatio="none">
      <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="var(--line)" />
      <text x="${padL - 4}" y="${padT + 9}" text-anchor="end" fill="var(--ink-3)" font-size="9" font-family="Inter">${maxClicks}</text>
      <text x="${padL - 4}" y="${padT + chartH + 3}" text-anchor="end" fill="var(--ink-3)" font-size="9" font-family="Inter">0</text>
      ${bars}
      ${xLabels}
    </svg>
  </div>`;
}

let payoutFilter = 'pendente';
async function renderPayouts() {
  // Sempre busca do servidor para garantir dados atualizados
  try { await DB.getAllPayouts(payoutFilter === 'all' ? 'all' : payoutFilter); } catch (e) { console.warn('getAllPayouts failed:', e.message); }
  const all = (DB.getPayouts() || []).map(p => ({
    ...p,
    amount: Number(p.amount || 0),
    affiliateId: p.affiliateId || p.affiliate_id,
    affiliateCode: p.affiliateCode || p.affiliate_code,
    status: p.status || 'pendente',
    method: p.method || 'Pix',
    requestedAt: p.requestedAt || p.requested_at,
    processedAt: p.processedAt || p.processed_at,
    pixKey: p.pixKey || p.pix_key,
    pixHolder: p.pixHolder || p.pix_holder
  }));
  const pending = all.filter(p => p.status === 'pendente');
  const paid = all.filter(p => p.status === 'pago');
  const rejected = all.filter(p => p.status === 'rejeitado');
  const totalPending = pending.reduce((s, p) => s + p.amount, 0);
  const totalPaid = paid.reduce((s, p) => s + p.amount, 0);

  $('#payoutBadge').textContent = pending.length;
  $('#payoutBadge').style.display = pending.length > 0 ? '' : 'none';

  $('#payoutStatGrid').innerHTML = `
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
      <div class="body"><div class="lbl">Solicitações pendentes</div><div class="num">${pending.length}</div><div class="delta">${brl(totalPending)}</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>
      <div class="body"><div class="lbl">Já pagos</div><div class="num">${paid.length}</div><div class="delta">${brl(totalPaid)}</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
      <div class="body"><div class="lbl">Rejeitados</div><div class="num">${rejected.length}</div><div class="delta">histórico</div></div>
    </div>
    <div class="stat-card">
      <div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
      <div class="body"><div class="lbl">Total sacado</div><div class="num">${brl(totalPaid)}</div><div class="delta">${all.length} saques no total</div></div>
    </div>
  `;

  const list = payoutFilter === 'all' ? all : all.filter(p => p.status === payoutFilter);
  if (list.length === 0) {
    $('#payoutsTable').innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-3); padding:40px">Nenhuma solicitação ${payoutFilter === 'pendente' ? 'pendente' : payoutFilter === 'pago' ? 'paga' : payoutFilter === 'rejeitado' ? 'rejeitada' : ''}.</td></tr>`;
    return;
  }
  $('#payoutsTable').innerHTML = list.map(p => {
    const aff = DB.getAffiliates().find(a => a.id === p.affiliateId);
    const pixKey = p.pixKey || p.pix_key || aff?.pixKey || aff?.pix_key || '—';
    const pixHolder = p.pixHolder || p.pix_holder || aff?.pixHolder || aff?.pix_holder || '';
    return `<tr>
      <td><small style="color:var(--ink-3)">${fmtDate(p.requestedAt || p.requested_at)}</small>${(p.processedAt || p.processed_at) ? `<br><small style="color:var(--ink-3)">processado: ${fmtDay(p.processedAt || p.processed_at)}</small>` : ''}</td>
      <td><strong>${escHtml(aff?.name) || '—'}</strong><br><small style="color:var(--ink-3)"><code>${escHtml(p.affiliateCode || p.affiliate_code)}</code></small></td>
      <td><strong>${brl(p.amount)}</strong></td>
      <td>${escHtml(p.method || '—')}</td>
      <td style="font-size:0.8125rem"><code style="background:var(--bg-subtle); padding:2px 6px; border-radius:3px; color:var(--ink)">${escHtml(pixKey)}</code>${pixHolder ? `<br><small style="color:var(--ink-3)">${escHtml(pixHolder)}</small>` : ''}</td>
      <td><span class="pill ${p.status === 'pago' ? 'ok' : p.status === 'rejeitado' ? 'danger' : 'warn'}">${escHtml(p.status)}</span></td>
      <td style="text-align:right">
        <div class="actions justify-end">
          ${p.status === 'pendente' ? `
            <button class="icon-btn" data-pay-payout="${p.id}" title="Marcar como pago">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
            </button>
            <button class="icon-btn danger" data-reject-payout="${p.id}" title="Rejeitar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </button>
          ` : ''}
          <button class="icon-btn danger" data-del-payout="${p.id}" title="Excluir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $$('.payout-filter').forEach(b => b.onclick = () => {
    payoutFilter = b.dataset.status;
    $$('.payout-filter').forEach(x => x.classList.toggle('active', x === b));
    renderPayouts();
  });
  $$('[data-pay-payout]').forEach(b => b.onclick = async () => {
    const p = DB.getPayouts().find(x => x.id === b.dataset.payPayout);
    if (!p) return;
    const aff = DB.getAffiliates().find(a => a.id === p.affiliateId);
    const method = await adminPrompt({
      title: 'Confirmar pagamento',
      message: `Pagamento de ${brl(p.amount)} para ${escHtml(aff?.name || 'afiliado')}.`,
      placeholder: 'Pix',
      defaultValue: 'Pix',
      okText: 'Marcar como pago'
    });
    if (method === null) return;
    try {
      await DB.updatePayout(p.id, { status: 'pago', method: method || 'Pix', processedAt: new Date().toISOString() });
      if (aff) await DB.updateAffiliate(aff.id, { paidOut: (aff.paidOut || 0) + p.amount });
      renderAll();
      toast('Payout marcado como pago');
    } catch (err) {
      toast(err.message || 'Erro ao processar', false);
    }
  });
  $$('[data-reject-payout]').forEach(b => b.onclick = async () => {
    const reason = await adminPrompt({
      title: 'Rejeitar payout',
      message: 'Informe o motivo (opcional).',
      placeholder: 'Ex: dados bancários inválidos',
      okText: 'Rejeitar'
    });
    if (reason === null) return;
    try {
      await DB.updatePayout(b.dataset.rejectPayout, { status: 'rejeitado', method: reason || '' });
      renderAll();
      toast('Payout rejeitado');
    } catch (err) {
      toast(err.message || 'Erro ao rejeitar', false);
    }
  });
  $$('[data-del-payout]').forEach(b => b.onclick = async () => {
    if (!confirm('Excluir este payout?')) return;
    try {
      await DB.deletePayout(b.dataset.delPayout);
      renderAll();
      toast('Payout excluído');
    } catch (err) {
      toast(err.message || 'Erro ao excluir', false);
    }
  });
}



$('#exportBtn').onclick = () => {
  const data = DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pixelforge-backup-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Backup exportado');
};

$('#importInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!confirm('Importar substituindo todos os dados atuais?')) return;
      DB.importAll(data);
      renderAll();
      toast('Dados importados');
    } catch { toast('Arquivo inválido', false); }
  };
  reader.readAsText(file);
};

$('#resetBtn').onclick = async () => {
  if (!confirm('Limpar TODOS os dados de teste? Isso apaga usuários, pedidos, afiliados, payouts e cliques.')) return;
  if (!confirm('Tem certeza? Esta ação não pode ser desfeita e mantém apenas o admin.')) return;
  try {
    const r = await DB.resetAll();
    toast(`Limpo: ${r.removed.users} usuários, ${r.removed.orders} pedidos, ${r.removed.affiliates} afiliados`);
    await DB._refreshUserData();
    renderAll();
  } catch (err) {
    toast(err.message || 'Erro ao limpar dados', false);
  }
};

function renderAll() {
  renderDashboard();
  renderProducts();
  renderSales();   // já atualiza o badge da lixeira internamente
  renderAffiliates();
  renderUsers();
  renderPayouts();
  $('#payoutBadge').textContent = DB.getPayouts().filter(p => p.status === 'pendente').length;
  $('#payoutBadge').style.display = $('#payoutBadge').textContent === '0' ? 'none' : '';
  if ($('.page-section[data-section="licenses"].active')) renderLicenses();
  pingHealthIndicator();
}

// Refresh forçado: refaz fetch do backend e re-renderiza tudo
async function refreshAllFromBackend() {
  const btn = $('#dashboardRefreshBtn');
  const endLoading = btn ? Loading.buttonStart(btn, 'Atualizando…') : () => {};
  try {
    await DB._refreshUserData();
    renderAll();
    toast('Dados atualizados');
  } catch (e) {
    toast(e.message || 'Erro ao atualizar', false);
  } finally {
    endLoading();
  }
}

// =============================================================
//  API Health (admin-only)
// =============================================================
async function pingHealthIndicator() {
  const dot = $('#healthDot');
  if (!dot) return;
  dot.style.display = '';
  dot.className = 'nav-dot';
  const t0 = Date.now();
  try {
    const r = await fetch(API_BASE + '/health');
    const ms = Date.now() - t0;
    if (r.ok) {
      dot.classList.add('ok');
      dot.title = 'API OK (' + ms + 'ms)';
    } else {
      dot.classList.add('err');
      dot.title = 'API respondeu ' + r.status;
    }
  } catch (e) {
    dot.classList.add('err');
    dot.title = 'API fora do ar: ' + (e.message || e);
  }
}

let _healthLoading = false;
async function renderHealth() {
  if (_healthLoading) return;
  _healthLoading = true;
  try { await _renderHealthImpl(); }
  finally { _healthLoading = false; }
}

async function _renderHealthImpl() {
  const hero = $('#healthHero');
  const heroTitle = $('#healthHeroTitle');
  const heroMeta = $('#healthHeroMeta');
  const barFill = $('#healthBarFill');
  const barLabel = $('#healthBarLabel');
  const lastCheck = $('#healthLastCheck');
  const envPill = $('#healthEnvPill');
  const envBody = $('#healthEnvBody');
  const reqPill = $('#healthRequiredPill');
  const reqBody = $('#healthRequiredBody');
  const checksPill = $('#healthChecksPill');
  const checksBody = $('#healthChecksBody');
  const optBody = $('#healthOptionalBody');
  const raw = $('#healthRaw');
  if (!hero) return;

  // Loading state
  hero.setAttribute('data-status', 'loading');
  heroTitle.textContent = 'Verificando…';
  heroMeta.textContent = 'Conectando ao backend…';
  barFill.style.width = '0%'; barFill.className = 'health-bar-fill';
  barLabel.textContent = '— / — obrigatórias';
  lastCheck.textContent = 'verificando…';
  envPill.textContent = '—'; envPill.className = 'pill';
  envBody.innerHTML = '<div class="health-kv-row"><div class="health-kv-k muted">Carregando…</div></div>';
  reqPill.textContent = '—'; reqPill.className = 'pill';
  reqBody.innerHTML = '<div class="health-var-row muted">Carregando…</div>';
  checksPill.textContent = '—'; checksPill.className = 'pill';
  checksBody.innerHTML = '<div class="health-check-row muted">Carregando…</div>';

  // Stat cards skeleton
  $('#hcStatus').textContent = '—'; $('#hcStatus').className = 'num';
  $('#hcStatusDelta').textContent = 'aguardando';
  $('#hcUptime').textContent = '—'; $('#hcUptimeDelta').textContent = 'Node —';
  $('#hcProducts').textContent = '—';
  $('#hcUsers').textContent = '—';

  const t0 = Date.now();
  let data, err;
  try {
    data = await DB.apiFetch('/diag');
  } catch (e) { err = e; }
  const ms = Date.now() - t0;

  if (err || !data) {
    hero.setAttribute('data-status', 'err');
    heroTitle.textContent = 'Falha de conexão';
    heroMeta.innerHTML = `<strong>${escAttr(err ? err.message : 'resposta vazia')}</strong><br><span style="color:var(--ink-3)">O backend não respondeu em ${ms}ms. Pode estar fora do ar ou a sessão expirou.</span>`;
    barFill.style.width = '0%';
    barLabel.textContent = 'sem dados';
    lastCheck.textContent = new Date().toLocaleTimeString('pt-BR');
    $('#hcStatus').textContent = 'Erro'; $('#hcStatus').className = 'num err';
    $('#hcStatusDelta').textContent = err ? err.message : 'sem resposta';
    raw.textContent = err ? (err.stack || err.message) : 'no response';
    return;
  }

  const ok = !!data.ok;
  hero.setAttribute('data-status', ok ? 'ok' : 'err');
  heroTitle.textContent = ok ? 'Todos os sistemas operacionais' : 'Problemas detectados';
  const missing = (data.env && data.env.missing_required) || [];
  heroMeta.innerHTML = ok
    ? `Resposta em <strong>${data.duration_ms || ms}ms</strong> · ${(data.env && data.env.required) ? Object.keys(data.env.required).length : 0} variáveis obrigatórias checadas`
    : `<strong>${missing.length}</strong> variável(is) obrigatória(s) ausente(s) e/ou serviço com falha`;

  // Coverage bar
  const reqMap = (data.env && data.env.required) || {};
  const reqKeys = Object.keys(reqMap);
  const reqSet = reqKeys.filter(k => reqMap[k] && reqMap[k].set).length;
  const pct = reqKeys.length ? Math.round((reqSet / reqKeys.length) * 100) : 0;
  barFill.style.width = pct + '%';
  barFill.className = 'health-bar-fill' + (pct === 100 ? '' : pct >= 50 ? ' warn' : ' err');
  barLabel.textContent = `${reqSet} / ${reqKeys.length} obrigatórias (${pct}%)`;
  lastCheck.textContent = new Date(data.ts || Date.now()).toLocaleTimeString('pt-BR');

  // Stat cards
  $('#hcStatus').textContent = ok ? 'OK' : 'Falha';
  $('#hcStatus').className = 'num ' + (ok ? 'ok' : 'err');
  $('#hcStatusDelta').textContent = `${ms}ms resposta`;
  $('#hcUptime').textContent = formatUptime(data.uptime_sec || 0);
  $('#hcUptimeDelta').textContent = `Node ${data.node_version || '—'}`;
  $('#hcProducts').textContent = (data.checks && data.checks.products && data.checks.products.count != null) ? data.checks.products.count : '—';
  $('#hcUsers').textContent = (data.checks && data.checks.users && data.checks.users.count != null) ? data.checks.users.count : '—';

  // Tone stat-card icons
  document.querySelectorAll('#healthSummary .ic').forEach((ic, i) => {
    ic.setAttribute('data-tone', i === 0 ? (ok ? 'ok' : 'err') : '');
  });

  // Ambiente
  envPill.textContent = data.vercel ? 'Vercel' : 'Local';
  envPill.className = 'pill ' + (data.vercel ? 'ok' : '');
  const dbUrl = (data.db && data.db.url) || '—';
  const dbOk = data.db && data.db.initialized;
  envBody.innerHTML = `
    <div class="health-kv-row"><div class="health-kv-k">Ambiente</div><div class="health-kv-v">${data.vercel ? 'Vercel (serverless)' : 'Local'}</div></div>
    <div class="health-kv-row"><div class="health-kv-k">Região</div><div class="health-kv-v">${escHtml(data.env_region || '—')}</div></div>
    <div class="health-kv-row"><div class="health-kv-k">Node</div><div class="health-kv-v">${escHtml(data.node_version || '—')}</div></div>
    <div class="health-kv-row"><div class="health-kv-k">Uptime</div><div class="health-kv-v">${formatUptime(data.uptime_sec || 0)}</div></div>
    <div class="health-kv-row"><div class="health-kv-k">Banco</div><div class="health-kv-v"><code>${escHtml(dbUrl)}</code></div></div>
    <div class="health-kv-row"><div class="health-kv-k">DB inicializado</div><div class="health-kv-v">${dbOk ? '<span class="pill ok">sim</span>' : '<span class="pill danger">não</span>'}</div></div>
  `;

  // Variáveis obrigatórias
  const allReq = reqKeys.map(k => ({ k, ...reqMap[k] }));
  const reqOk = allReq.filter(v => v.set).length;
  const reqMissing = allReq.length - reqOk;
  reqPill.textContent = reqMissing === 0 ? `${reqOk} / ${allReq.length} OK` : `${reqMissing} faltando`;
  reqPill.className = 'pill ' + (reqMissing === 0 ? 'ok' : 'danger');
  reqBody.innerHTML = allReq.length === 0
    ? '<div class="health-var-row muted">Nenhuma variável checada.</div>'
    : allReq.map(v => `
      <div class="health-var-row">
        <div class="health-var-icon ${v.set ? 'ok' : 'err'}">${v.set
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        }</div>
        <div class="health-var-name"><code>${escHtml(v.k)}</code></div>
        <div class="health-var-meta">${v.set ? v.length + ' chars' : 'ausente'}</div>
      </div>
    `).join('');

  // Variáveis opcionais
  const optMap = (data.env && data.env.optional) || {};
  const optKeys = Object.keys(optMap);
  const optSet = optKeys.filter(k => optMap[k]).length;
  if (optKeys.length > 0) {
    $('#healthEnvOptionalWrap').style.display = '';
    optBody.innerHTML = optKeys.map(k => `
      <div class="health-var-row">
        <div class="health-var-icon ${optMap[k] ? 'ok' : 'err'}">${optMap[k]
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        }</div>
        <div class="health-var-name"><code>${escHtml(k)}</code></div>
        <div class="health-var-meta">${optMap[k] ? 'definida' : 'ausente'}</div>
      </div>
    `).join('');
    $('#healthEnvOptionalWrap').querySelector('h3').textContent = `Variáveis opcionais (${optSet} / ${optKeys.length})`;
  } else {
    $('#healthEnvOptionalWrap').style.display = 'none';
  }

  // Checagens
  const checks = data.checks || {};
  const checkKeys = Object.keys(checks);
  const checksOkCount = checkKeys.filter(k => checks[k] && checks[k].ok).length;
  const checksFailCount = checkKeys.length - checksOkCount;
  checksPill.textContent = checksFailCount === 0
    ? `${checksOkCount} / ${checkKeys.length} OK`
    : `${checksFailCount} com falha`;
  checksPill.className = 'pill ' + (checksFailCount === 0 ? 'ok' : 'danger');
  checksBody.innerHTML = checkKeys.length === 0
    ? '<div class="health-check-row muted">Nenhuma checagem retornada.</div>'
    : checkKeys.map(k => {
      const c = checks[k] || {};
      const isOk = c.ok;
      const details = [];
      if (c.count != null) details.push('count = ' + c.count);
      if (c.status) details.push('HTTP ' + c.status);
      if (c.can_sign) details.push('assinatura ok');
      if (c.can_verify) details.push('verificação ok');
      if (c.error) details.push(c.error);
      if (c.code) details.push('código ' + c.code);
      const meta = details.length ? details.join(' · ') : (isOk ? 'sem detalhes' : 'falha desconhecida');
      return `
        <div class="health-check-row">
          <div class="health-check-icon ${isOk ? 'ok' : 'err'}">${isOk
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          }</div>
          <div class="health-check-body">
            <div class="health-check-name">${escHtml(k)}</div>
            <div class="health-check-desc">${escHtml(meta)}</div>
          </div>
        </div>
      `;
    }).join('');

  raw.textContent = JSON.stringify(data, null, 2);
  pingHealthIndicator();
}

function formatUptime(s) {
  s = Number(s) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) { return escHtml(s); }

document.addEventListener('DOMContentLoaded', checkAuth);

// Wire up health refresh button (existe no DOM do admin)
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('healthRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => renderHealth());

  const rawToggle = document.getElementById('healthRawToggle');
  const rawWrap = document.getElementById('healthRawWrap');
  if (rawToggle && rawWrap) {
    rawToggle.addEventListener('click', () => {
      const open = rawWrap.style.display !== 'none';
      rawWrap.style.display = open ? 'none' : '';
      rawToggle.innerHTML = open
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="6 9 12 15 18 9"/></svg> Expandir JSON'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="18 15 12 9 6 15"/></svg> Ocultar JSON';
    });
  }
});

(function setupTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('pixelforge_theme', next); } catch(e) {}
  });
})();

// ===========================================================
//  VALIDADOR DE LICENÇAS
// ===========================================================

function renderLicensePluginFilter() {
  const sel = $('#licenseFilterPlugin');
  if (!sel) return;
  const products = DB.getProducts() || [];
  sel.innerHTML = '<option value="">Todos os plugins</option>' +
    products.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join('');
}

async function renderLicenses() {
  renderLicensePluginFilter();
  const tbody = $('#licenseTable');
  if (!tbody) return;

  const key = ($('#licenseFilterKey')?.value || '').trim().toUpperCase();
  const plugin = $('#licenseFilterPlugin')?.value || '';

  try {
    const r = await DB.getLicenseActivations({ licenseKey: key, pluginId: plugin });
    const list = (r.activations || []).map(a => ({
      ...a,
      id: a.id,
      licenseKey: a.license_key,
      pluginId: a.plugin_id,
      serverId: a.server_id,
      ip: a.ip,
      firstSeen: a.first_seen,
      lastSeen: a.last_seen,
      revoked: !!a.revoked
    }));

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-3); padding:40px">Nenhuma ativação encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(a => `
      <tr>
        <td><code style="font-size:0.75rem">${a.licenseKey}</code></td>
        <td><code style="font-size:0.75rem">${a.pluginId}</code></td>
        <td><code style="font-size:0.75rem">${a.serverId}</code></td>
        <td>${a.ip || '—'}</td>
        <td>${a.firstSeen ? new Date(a.firstSeen).toLocaleString('pt-BR') : '—'}</td>
        <td>${a.lastSeen ? new Date(a.lastSeen).toLocaleString('pt-BR') : '—'}</td>
        <td style="text-align:right">
          <button class="btn btn-danger" data-revoke-license="${a.id}" ${a.revoked ? 'disabled' : ''}>${a.revoked ? 'Revogado' : 'Revogar'}</button>
        </td>
      </tr>
    `).join('');

    $$('[data-revoke-license]').forEach(b => {
      if (b.disabled) return;
      b.onclick = async () => {
        if (!confirm('Revogar esta ativação? O servidor precisará validar a licença novamente.')) return;
        try {
          const end = Loading.buttonStart(b, 'Revogando…');
          await DB.revokeLicenseActivation(b.dataset.revokeLicense);
          end();
          toast('Ativação revogada', true);
          renderLicenses();
        } catch (err) {
          toast(err.message || 'Erro ao revogar', false);
        }
      };
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger); padding:40px">Erro ao carregar: ${err.message}</td></tr>`;
  }
}

function setupLicenseValidator() {
  const checkBtn = $('#licenseCheckBtn');
  const searchBtn = $('#licenseSearchBtn');
  if (checkBtn) {
    checkBtn.onclick = async () => {
      const result = $('#licenseCheckResult');
      result.style.color = 'var(--ink-3)';
      result.textContent = 'Validando…';
      try {
        const r = await DB.validateLicense({
          licenseKey: ($('#licenseCheckKey').value || '').trim().toUpperCase(),
          pluginId: ($('#licenseCheckPlugin').value || '').trim(),
          serverId: ($('#licenseCheckServer').value || '').trim()
        });
        result.style.color = 'var(--success)';
        result.innerHTML = `Licença válida. Token expira em: ${r.expiresIn || '—'}`;
      } catch (err) {
        result.style.color = 'var(--danger)';
        result.textContent = err.message || 'Licença inválida';
      }
    };
  }
  if (searchBtn) {
    searchBtn.onclick = () => renderLicenses();
  }
}

document.addEventListener('DOMContentLoaded', setupLicenseValidator);
