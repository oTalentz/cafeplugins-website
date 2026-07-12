// =============================================================
//  PixelForge - Lógica da loja
// =============================================================

const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// Helpers de cookie para first-click attribution de afiliado
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}
function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
}

// First-click attribution: salva ref da URL no cookie cafe_aff (30 dias).
// Se já existe cookie, NÃO sobrescreve (first-click wins).
const urlParams = new URLSearchParams(window.location.search);
const refParam = urlParams.get('ref');
if (refParam && !getCookie('cafe_aff')) {
  setCookie('cafe_aff', refParam.toUpperCase(), 30);
}

// CRIT-04 FIX: escape HTML para innerHTML com dados do servidor
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STORAGE_KEYS = {
  cart: 'pixelforge_cart',
  theme: 'pixelforge_theme',
  ref: 'pf_ref',
  notice: 'pixelforge_notice_dismissed'
};

let state = {
  products: [],
  cart: JSON.parse(localStorage.getItem(STORAGE_KEYS.cart) || '[]'),
  filter: 'Todos'
};

// Termo de busca atual (aplicado junto com os filtros de categoria/preço)
let _searchQuery = '';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Mapeia texto do badge → classe CSS para cor semantica
const BADGE_TYPE = {
  'novo': 'tag-new',
  'new': 'tag-new',
  'mais vendido': 'tag-bestseller',
  'bestseller': 'tag-bestseller',
  'best seller': 'tag-bestseller',
  'premium': 'tag-premium',
  'oferta': 'tag-offer',
  'sale': 'tag-offer',
  'desconto': 'tag-offer'
};
function badgeClass(text) {
  if (!text) return '';
  return BADGE_TYPE[text.toLowerCase().trim()] || '';
}

// Sub-tag: Gratis vs Pago (baseado em price)
function priceTag(p) {
  const v = Number(p && p.price);
  if (!v || v <= 0) return { label: 'Grátis', cls: 'subtag-free' };
  return { label: 'Pago', cls: 'subtag-paid' };
}

function toast(msg, ok = true) {
  const stack = $('#toastStack');
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `<span class="dot"></span><span>${escHtml(msg)}</span>`;
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 2400);
  setTimeout(() => t.remove(), 2800);
}

function persistCart() {
  localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(state.cart));
  renderCartBadge();
}

// Ordem fixa dos filtros (Todos, tipo de preco, categoria)
const FILTERS = ['Todos', 'Free', 'Pago', 'Economia', 'PvP', 'Utilidade'];

function renderFilters() {
  const wrap = $('#filters');
  wrap.innerHTML = '';
  FILTERS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (state.filter === cat ? ' active' : '');
    btn.textContent = cat;
    btn.onclick = () => { state.filter = cat; renderFilters(); renderProducts(_searchQuery); };
    wrap.appendChild(btn);
  });
}

// Decide se um produto passa pelo filtro selecionado
function applyFilter(p, filter) {
  if (!filter || filter === 'Todos') return true;
  if (filter === 'Free') return !(Number(p.price) > 0);
  if (filter === 'Pago') return Number(p.price) > 0;
  return p.category === filter;
}

function renderProducts(searchQuery = '') {
  const grid = $('#productGrid');
  grid.innerHTML = '';
  let list = state.filter === 'Todos' ? state.products : state.products.filter(p => applyFilter(p, state.filter));

  // Filtro por texto (nome, tagline ou descrição)
  if (searchQuery) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(searchQuery) ||
      (p.tagline || '').toLowerCase().includes(searchQuery) ||
      (p.description || '').toLowerCase().includes(searchQuery)
    );
  }

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      </div>
      <h3>Nenhum plugin encontrado</h3>
      <p>Tente outra categoria.</p>
    </div>`;
    return;
  }

  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'product-card';
    const cover = p.coverImage || p.cover_image || '';
    const coverHTML = cover
      ? `<div class="cover" style="position:relative; margin:-16px -16px 12px -16px; height:120px; overflow:hidden; border-radius:12px 12px 0 0; background:var(--surface-2)">
           <img src="${escHtml(cover)}" alt="${escHtml(p.name)}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block" onerror="this.parentElement.style.display='none'" />
         </div>`
      : '';
    card.innerHTML = `
      ${coverHTML}
      <div class="top">
        <div class="icon">${escHtml((p.name || '?').charAt(0))}</div>
        <div class="top-tags">
          ${p.badge ? `<span class="badge ${badgeClass(p.badge)}">${escHtml(p.badge)}</span>` : ''}
          <span class="subtag ${priceTag(p).cls}">${priceTag(p).label}</span>
        </div>
      </div>
      <h3>${escHtml(p.name)}</h3>
      <p class="tagline">${escHtml(p.tagline)}</p>
      <div class="meta">
        <span>${escHtml(p.category)}</span>
        <span>${escHtml(p.version)}</span>
        ${p.video ? `<span title="Tem vídeo de demonstração"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg> Vídeo</span>` : ''}
      </div>
      <div class="price-row">
        <div class="price">${brl(p.price)}${p.oldPrice ? `<small>${brl(p.oldPrice)}</small>` : ''}</div>
        <button class="add" title="Adicionar ao carrinho" aria-label="Adicionar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add')) addToCart(p);
      else openProductModal(p);
    });
    grid.appendChild(card);
  });
}

function addToCart(product) {
  if (state.cart.find(i => i.id === product.id)) {
    toast('Esse plugin já está no carrinho', false);
    return;
  }
  state.cart.push(product);
  persistCart();
  renderCart();
  toast(`${product.name} adicionado`);
}

function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  persistCart();
  renderCart();
}

function renderCartBadge() {
  const badge = $('#cartBadge');
  if (state.cart.length > 0) {
    badge.classList.add('show');
    badge.textContent = state.cart.length;
  } else {
    badge.classList.remove('show');
  }
}

function renderCart() {
  const body = $('#cartBody');
  const foot = $('#cartFoot');
  if (state.cart.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg>
        </div>
        <h3>Seu carrinho está vazio</h3>
        <p>Adicione alguns plugins para começar.</p>
      </div>`;
    foot.style.display = 'none';
    return;
  }
  body.innerHTML = state.cart.map(p => `
    <div class="cart-item">
      <div class="ic">${escHtml((p.name || '?').charAt(0))}</div>
      <div class="info">
        <h4>${escHtml(p.name)}</h4>
        <small>${escHtml(p.category)}</small>
      </div>
      <strong>${brl(p.price)}</strong>
      <button class="remove" data-id="${escHtml(p.id)}" aria-label="Remover">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');
  $$('.remove', body).forEach(b => b.onclick = () => removeFromCart(b.dataset.id));
  const total = state.cart.reduce((s, i) => s + i.price, 0);
  $('#cartTotal').textContent = brl(total);
  foot.style.display = 'block';
}

function openCart()  { renderCart(); $('#cartDrawer').classList.add('open'); $('#drawerOverlay').classList.add('open'); }
function closeCart() { $('#cartDrawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }

function openProductModal(p) {
  updateMetaForProduct(p);
  $('#modalTitle').textContent = p.name;
  $('#modalPrice').innerHTML = `${brl(p.price)}${p.oldPrice ? ` <small style="color:var(--ink-3); text-decoration:line-through; font-size:0.875rem; font-weight:400; margin-left:4px">${brl(p.oldPrice)}</small>` : ''}`;

  const video = DB.parseVideoUrl(p.video);
  const cover = p.coverImage || p.cover_image || '';
  const coverHTML = cover
    ? `<div class="cover-modal" style="margin:-20px -24px 16px -24px; height:200px; overflow:hidden; border-radius:12px 12px 0 0; background:var(--surface-2)">
         <img src="${escHtml(cover)}" alt="${escHtml(p.name)}" style="width:100%; height:100%; object-fit:cover; display:block" onerror="this.parentElement.style.display='none'" />
       </div>`
    : '';
  const videoHTML = video
    ? `<div class="video-label">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
         Vídeo de demonstração
       </div>
       <div class="video-embed">
         ${video.type === 'file'
           ? `<video src="${escHtml(video.src)}" controls preload="metadata"></video>`
           : `<iframe src="${escHtml(video.src)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`}
       </div>`
    : '';

  $('#modalBody').innerHTML = `
    ${coverHTML}
    <p style="color:var(--ink-2); margin-bottom:8px; font-size:0.9375rem">${escHtml(p.description)}</p>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; align-items:center">
      ${p.badge ? `<span class="badge ${badgeClass(p.badge)}">${escHtml(p.badge)}</span>` : ''}
      <span class="subtag ${priceTag(p).cls}">${priceTag(p).label}</span>
      <span class="badge">${escHtml(p.category)}</span>
      <span class="badge">${escHtml(p.version)}</span>
    </div>
    ${videoHTML}
    <ul class="feature-list">
      ${(p.features || []).map(f => `<li>${escHtml(f)}</li>`).join('')}
    </ul>
  `;
  $('#modalAdd').onclick = () => { addToCart(p); closeProductModal(); };
  $('#productModal').classList.add('open');
}
function closeProductModal() { $('#productModal').classList.remove('open'); }

// SEO: atualiza meta tags dinamicamente quando um produto é aberto no modal
function updateMetaForProduct(p) {
  if (!p) return;
  document.title = (p.name || 'Plugin') + ' - Cafe Plugins';
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = p.tagline || (p.description || '').slice(0, 160) || '';
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = (p.name || 'Plugin') + ' - Cafe Plugins';
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = p.tagline || '';
}

function openCheckout() {
  if (state.cart.length === 0) return;
  
  // Verifica se usuário está logado - exige login para comprar
  const me = DB.getCurrentUser();
  if (!me) {
    toast(I18N ? I18N.t('auth.login_required') : 'Faça login para continuar a compra', false);
    // Abre modal de autenticação
    const authModal = $('#authModal');
    if (authModal) {
      showAuthStep('user');
      authModal.classList.add('open');
    }
    return;
  }
  
  closeCart();
  const total = state.cart.reduce((s, i) => s + i.price, 0);
  $('#checkoutTotal').textContent = brl(total);

  // Esconde forma de pagamento para produtos gratuitos
  const paymentGroup = $('#paymentMethod')?.closest('.input-group');
  if (paymentGroup) paymentGroup.style.display = total === 0 ? 'none' : '';

  // Preenche dados do usuário logado
  $('#buyerName').value = me.name || '';
  $('#buyerEmail').value = me.email || '';

  $('#paymentMethod').value = total === 0 ? 'pix' : 'pix';
  const urlRef = new URLSearchParams(location.search).get('ref');
  const cookieRef = DB.getRefCookie();
  const prefilled = (cookieRef || urlRef || '').toUpperCase();
  $('#affiliateCode').value = prefilled;
  const refNote = $('#refNote');
  if (refNote) {
    if (prefilled) {
      DB.findAffiliateByCode(prefilled).then(a => {
        if (a) {
          refNote.textContent = `Código ${a.code} aplicado (${a.rate}% de comissão)`;
          refNote.style.display = 'block';
        } else {
          refNote.textContent = '';
          refNote.style.display = 'none';
        }
      });
    } else refNote.style.display = 'none';
  }
  $('#checkoutModal').classList.add('open');
}
function closeCheckout() { $('#checkoutModal').classList.remove('open'); }

async function confirmPurchase() {
  const name = $('#buyerName').value.trim();
  const email = $('#buyerEmail').value.trim();
  const method = $('#paymentMethod').value;
  const typedCode = $('#affiliateCode').value.trim().toUpperCase();

  if (!name || !email) { toast('Preencha nome e e-mail', false); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('E-mail inválido', false); return; }

  const total = state.cart.reduce((s, i) => s + i.price, 0);

  const existingOrders = DB.getOrdersByEmail(email);
  const alreadyOwned = state.cart
    .map(i => i.id)
    .filter(id => existingOrders.some(o => o.status === 'pago' && (o.items || []).some(it => it.id === id)));
  if (alreadyOwned.length > 0) {
    const names = state.cart.filter(i => alreadyOwned.includes(i.id)).map(i => i.name).join(', ');
    if (!confirm(`Você já comprou: ${names}. Comprar de novo?`)) return;
  }

  let affiliate = null;
  let commission = 0;
  if (typedCode) {
    affiliate = await DB.findAffiliateByCode(typedCode);
    if (!affiliate) { toast('Código de afiliado inválido', false); return; }
    if (affiliate.status !== 'active') { toast('Este afiliado está pausado ou banido', false); return; }
    if (DB.isSelfReferral(affiliate, email)) { toast('Você não pode usar seu próprio código de afiliado', false); return; }
    commission = +(total * (affiliate.rate / 100)).toFixed(2);
    DB.setRefCookie(affiliate.code);
  }

  const submitBtn = $('#confirmPurchase');
  const isCard = method === 'cartao';
  const isFree = total === 0;
  const loadingLabel = isCard ? 'Processando pagamento...' : (isFree ? 'Liberando plugin...' : 'Gerando PIX...');
  const btnLabel = isCard ? 'Pagar com Cartão' : (isFree ? 'Obter grátis' : 'Pagar com PIX');
  const endLoading = Loading.buttonStart(submitBtn, btnLabel);

  try {
    const result = await Loading.withOverlay(
      loadingLabel,
      () => DB.addOrder({
        buyer: { name, email },
        paymentMethod: method,
        payment: method,
        items: state.cart.map(i => {
          const p = DB.getProduct(i.id);
          return { id: i.id, name: i.name, price: i.price, downloadUrl: p?.downloadUrl || '' };
        }),
        total,
        affiliateCode: affiliate ? affiliate.code : (getCookie('cafe_aff') || null),
        commission: affiliate ? commission : 0
      })
    );

    const order = result.order;
    const pix = result.pix;
    const checkoutUrl = result.checkoutUrl;
    const cardError = result.cardError;

    if (affiliate) {
      DB.registerClick(affiliate.code);
    }
    DB.clearRefCookie();
    try { history.replaceState({}, '', location.pathname); } catch (e) {}

    // Se for cartão e o backend reportou erro, NÃO esvaziar carrinho — cliente
    // pode tentar de novo ou trocar para PIX.
    if (isCard && cardError) {
      toast(cardError, false);
      return;
    }

    state.cart = [];
    persistCart();
    closeCheckout();

    // Se for cartão, redirecionar para checkout seguro do gateway (Mercado Pago/AbacatePay)
    if (isCard && checkoutUrl) {
      toast(I18N ? I18N.t('payment.card.redirect') : 'Redirecionando para pagamento com cartão...');
      setTimeout(() => {
        window.location.href = checkoutUrl;
      }, 800);
      return;
    }

    // Se for cartão mas não tem checkoutUrl, algo falhou - reabre o checkout
    if (isCard && !checkoutUrl) {
      toast(I18N ? I18N.t('payment.card.unavailable') : 'Pagamento com cartão indisponível. Tente novamente ou use PIX.', false);
      return;
    }

    // Pedido gratuito: aprovado automaticamente, redireciona para download
    if (isFree && order.status === 'pago') {
      toast('Plugin liberado! Redirecionando para sua conta...');
      setTimeout(() => { window.location.href = 'account.html#compras'; }, 1200);
      return;
    }

    // Se for PIX, abrir modal de pagamento com QR code
    const pixQrCode = order.pixQrCode || order.pix_qr_code;
    const pixQrImage = order.pixQrImage || order.pix_qr_image;
    if (method === 'pix' && pixQrCode) {
      showPixModal({
        pixQrCode,
        pixQrImage,
        expiresAt: pix?.expiresAt || order.pixExpiresAt || null
      }, order);
    } else if (method === 'pix' && !pixQrCode) {
      // Pedido criado mas PIX falhou - mostra toast para ir ao account
      showPostPurchaseToast(order, affiliate, commission);
      const pixFailMsg = I18N ? I18N.t('payment.pix.failed') : 'Pedido criado, mas a cobrança PIX falhou. Use o link "Ver minha conta" para tentar novamente.';
      toast(pixFailMsg, false);
    } else {
      showPostPurchaseToast(order, affiliate, commission);
    }
  } catch (err) {
    const msg = (err && err.data && err.data.code === 'ALREADY_OWNED') ? `Você já comprou esses plugins.` : (err.message || 'Erro ao processar pedido');
    toast(msg, false);
  } finally {
    endLoading();
  }
}

function showPostPurchaseToast(order, affiliate, commission) {
  const stack = $('#toastStack');
  const t = document.createElement('div');
  t.className = 'toast success-wide';
  const affLine = affiliate
    ? `<div class="ref-line">Afiliado <code>${escHtml(affiliate.code)}</code> ganhou ${brl(commission)}</div>`
    : '';
  t.innerHTML = `
    <span class="dot"></span>
    <div class="toast-body">
      <div class="toast-title">Pedido criado!</div>
      <div class="toast-sub">Pedido <code>${escHtml(order.id)}</code>${affLine}</div>
      <div class="toast-actions">
        <a href="account.html#compras" class="btn btn-primary" style="padding:6px 12px; font-size:0.8125rem">Ver minha conta</a>
        <button class="btn btn-secondary toast-close" style="padding:6px 12px; font-size:0.8125rem">Fechar</button>
      </div>
    </div>`;
  stack.appendChild(t);
  t.querySelector('.toast-close').onclick = () => t.remove();
  setTimeout(() => { t.style.opacity = '0'; }, 9000);
  setTimeout(() => t.remove(), 9500);
}

function showPixModal(pix, order) {
  // Mostra QR code do PIX, código copia-e-cola e timer
  const modal = $('#pixModal');
  if (!modal) return;
  $('#pixOrderId').textContent = order.id;
  $('#pixAmount').textContent = brl(order.total);
  $('#pixQrImage').src = pix.pixQrImage || '';
  $('#pixCopyPaste').value = pix.pixQrCode || '';
  $('#pixStatus').textContent = 'Aguardando pagamento…';
  $('#pixStatus').className = 'pill warn';

  // Timer
  const expiresAt = pix.expiresAt ? new Date(pix.expiresAt).getTime() : Date.now() + 30 * 60 * 1000;
  const timerEl = $('#pixTimer');
  function tick() {
    const left = Math.max(0, expiresAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    if (left <= 0) {
      timerEl.textContent = 'expirado';
      $('#pixStatus').textContent = 'PIX expirado';
      $('#pixStatus').className = 'pill danger';
      return;
    }
    setTimeout(tick, 1000);
  }
  tick();

  $('#pixCopyBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#pixCopyPaste').value);
      toast('Código PIX copiado');
    } catch {
      $('#pixCopyPaste').select();
      document.execCommand('copy');
      toast('Código PIX copiado');
    }
  };

  // Polling status a cada 5s
  let stopped = false;
  let pollTimer = null;
  async function pollStatus() {
    if (stopped) return;
    try {
      // HIGH-09 FIX: ?email= removido. Se guest, status só funciona após login/criação de senha.
      const r = await DB.getOrderStatus(order.id);
      if (r && r.is_paid) {
        stopped = true;
        $('#pixStatus').textContent = 'Pago! Licença liberada.';
        $('#pixStatus').className = 'pill ok';
        // Adiciona botao de baixar / ir para conta
        try {
          const mod = $('#pixModal .modal-body');
          if (mod && !mod.querySelector('.pix-success-actions')) {
            const actions = document.createElement('div');
            actions.className = 'pix-success-actions';
            actions.style.cssText = 'margin-top:18px; display:flex; gap:8px; justify-content:center';
            const isLoggedIn = !!DB.getCurrentUser();
            actions.innerHTML = isLoggedIn
              ? '<a href="account.html#compras" class="btn btn-primary" style="padding:8px 16px">Ver meus downloads</a>'
              : '<a href="account.html" class="btn btn-primary" style="padding:8px 16px">Criar senha e acessar</a>';
            mod.appendChild(actions);
          }
        } catch {}
        toast('Pagamento confirmado! Seus plugins estao liberados.');
        // Atualiza cache.orders para o usuario ver na conta
        if (DB.getCurrentUser()) {
          DB.getMyOrders().catch(() => {});
        }
        return;
      }
      if (r && r.status === 'cancelado') {
        stopped = true;
        $('#pixStatus').textContent = 'Pedido cancelado';
        $('#pixStatus').className = 'pill danger';
        return;
      }
    } catch {}
    pollTimer = setTimeout(pollStatus, 5000);
  }
  pollStatus();

  modal.classList.add('open');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
  $('#pixCloseBtn').onclick = () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    modal.classList.remove('open');
  };
}

async function init() {
  // Mostra skeleton enquanto carrega
  const grid = $('#productGrid');
  if (grid) grid.innerHTML = Loading.skeletonCards(6);

  // Atualiza nav IMEDIATAMENTE com o que estiver no sessionStorage,
  // para o usuário logado não ver o modal de login (botão "Painel").
  updateNavForAuth();

  // Inicializa cache a partir do backend
  try { await DB.init(); } catch (e) { console.warn('DB.init falhou:', e.message); }

  // Sincroniza state.products com o cache populado pelo DB.init()
  state.products = DB.getProducts();

  renderFilters();
  renderProducts();
  renderCartBadge();
  renderCart();

  // Busca por texto na landing page (filtra em tempo real)
  const searchInput = document.getElementById('productSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      _searchQuery = searchInput.value.toLowerCase().trim();
      renderProducts(_searchQuery);
    });
  }

  $('#openCart').onclick     = openCart;
  $('#closeCart').onclick    = closeCart;
  $('#drawerOverlay').onclick = closeCart;
  $('#closeModal').onclick   = closeProductModal;
  $('#productModal').onclick = (e) => { if (e.target.id === 'productModal') closeProductModal(); };
  $('#checkoutBtn').onclick  = openCheckout;
  $('#closeCheckout').onclick = closeCheckout;
  $('#checkoutModal').onclick = (e) => { if (e.target.id === 'checkoutModal') closeCheckout(); };
  $('#confirmPurchase').onclick = async () => { await confirmPurchase(); };
  $('#themeToggle').onclick = toggleTheme;
  handleRefFromURL().catch(() => {});
  setupPainel();
  updateNavForAuth();
  setupAccountNotice();
  setupAffCta();
}

async function handleRefFromURL() {
  const ref = new URLSearchParams(location.search).get('ref');
  if (!ref) return;
  const aff = await DB.findAffiliateByCode(ref);
  if (!aff || aff.status !== 'active') {
    try { history.replaceState({}, '', location.pathname); } catch (e) {}
    return;
  }
  DB.setRefCookie(aff.code);
  DB.registerClick(aff.code);
  try { history.replaceState({}, '', location.pathname); } catch (e) {}
  const nav = document.querySelector('.nav');
  if (nav) {
    const banner = document.createElement('div');
    banner.className = 'ref-banner';
    banner.innerHTML = `Você veio pelo link do afiliado <strong>${escHtml(aff.name)}</strong> · código <code>${escHtml(aff.code)}</code> ativo por 30 dias`;
    nav.parentNode.insertBefore(banner, nav.nextSibling);
  }
}

function updateNavForAuth() {
  const me = DB.getCurrentUser();
  const buyer = DB.getCurrentBuyer();
  const aff = DB.getCurrentAffiliate();
  const btn = $('#painelBtn');
  const label = $('#painelBtnLabel');
  if (!btn || !label) return;
  if (me && me.role === 'admin') {
    btn.classList.add('logged-in');
    label.textContent = 'Admin';
    btn.onclick = () => { location.href = 'admin.html'; };
  } else if (aff) {
    btn.classList.add('logged-in');
    label.textContent = aff.name.split(' ')[0];
    btn.onclick = () => { location.href = 'account.html'; };
  } else if (buyer) {
    btn.classList.add('logged-in');
    label.textContent = buyer.name.split(' ')[0];
    btn.onclick = () => { location.href = 'account.html'; };
  } else {
    btn.classList.remove('logged-in');
    label.textContent = 'Painel';
    btn.onclick = openPainel;
  }
}

function openPainel() {
  // Se já logado, vai direto para o painel (não abre modal de login)
  const me = DB.getCurrentUser();
  if (me) {
    if (me.role === 'admin') { location.href = 'admin.html'; return; }
    if (me.role === 'buyer' || me.is_affiliate) { location.href = 'account.html'; return; }
  }

  $('#painelModal').classList.add('open');
  showAuthStep(currentAuthTab);
  setTimeout(() => {
    const sel = currentAuthTab === 'admin' ? '#authAdminForm [name="password"]' : '#authUserForm [name="email"]';
    $(sel)?.focus();
  }, 50);
}

let currentAuthTab = 'user';
function showVerifyEmailPanel(email, devCode) {
  const target = $('#verifyEmailTarget');
  if (target) target.textContent = email;
  const code = $('#verifyEmailCode');
  if (code) code.value = '';
  const dev = $('#verifyEmailDevCode');
  if (dev) {
    if (devCode) { dev.style.display = ''; dev.textContent = devCode; }
    else { dev.style.display = 'none'; }
  }
}

function showAuthStep(step) {
  const tabs = $('#authTabs');
  const userForm = $('#authUserForm');
  const adminForm = $('#authAdminForm');
  const forgot = $('#forgotPanel');
  const verify = $('#verifyEmailPanel');
  const title = $('#painelTitle');
  if (forgot) forgot.style.display = 'none';
  if (verify) verify.style.display = 'none';
  if (step === 'forgot') {
    if (tabs) tabs.style.display = 'none';
    userForm.style.display = 'none';
    adminForm.style.display = 'none';
    forgot.style.display = 'block';
    title.textContent = 'Recuperar senha';
    resetForgotSteps();
    return;
  }
  if (step === 'verify') {
    if (tabs) tabs.style.display = 'none';
    userForm.style.display = 'none';
    adminForm.style.display = 'none';
    if (verify) verify.style.display = 'block';
    title.textContent = 'Confirme seu e-mail';
    setTimeout(() => $('#verifyEmailCode')?.focus(), 50);
    return;
  }
  currentAuthTab = step;
  if (tabs) {
    tabs.style.display = '';
    $$('#authTabs .auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === step));
  }
  userForm.style.display = step === 'user' ? 'flex' : 'none';
  adminForm.style.display = step === 'admin' ? 'flex' : 'none';
  title.textContent = 'Entrar';
}

function resetForgotSteps() {
  $('#forgotStep1').style.display = 'block';
  $('#forgotStep2').style.display = 'none';
  $('#forgotStep3').style.display = 'none';
  $('#forgotEmailForm').reset();
  $('#forgotCodeForm').reset();
  $('#forgotPwdForm').reset();
  $('#forgotDevCode').textContent = '------';
}

let forgotEmail = '';
function setupPainel() {
  const modal = $('#painelModal');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
  $$('#painelModal [data-close]').forEach(b => b.onclick = () => modal.classList.remove('open'));

  if (window.__IS_DEV__) {
    $$('#devCredsUser, #devCredsAdmin').forEach(el => { if (el) el.style.display = ''; });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
  });

  const goReg = $('#goRegisterBtn');
  if (goReg) goReg.addEventListener('click', () => modal.classList.remove('open'));

  $$('#authTabs .auth-tab').forEach(t => t.onclick = () => {
    showAuthStep(t.dataset.authTab);
  });

  $('#authUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const submitBtn = f.querySelector('button[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Entrando...'; }
    try {
      const result = await DB.authenticateUser(f.email.value, f.password.value);
      if (result.error) {
        if (result.code === 'EMAIL_NOT_VERIFIED') {
          showVerifyEmailPanel(result.email || f.email.value, null);
          showAuthStep('verify');
          toast('Confirme seu e-mail para entrar.', false);
          return;
        }
        toast(result.error, false);
        return;
      }
      if (result.role === 'affiliate') {
        toast(`Bem-vindo, ${result.affiliate.name}!`);
        closePainelThen(() => { location.href = 'account.html'; });
      } else if (result.role === 'buyer') {
        toast(`Bem-vindo, ${result.buyer.name}!`);
        closePainelThen(() => { location.href = 'account.html'; });
      }
    } catch (err) {
      toast(err.message || 'Erro ao entrar', false);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar'; }
    }
  });

  $('#authAdminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const submitBtn = f.querySelector('button[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Entrando...'; }
    try {
      const result = await DB.authenticateAdmin(f.email.value, f.password.value);
      if (result.error) { toast(result.error, false); return; }
      toast(`Bem-vindo, ${result.user.name}!`);
      closePainelThen(() => { location.href = 'admin.html'; });
    } catch (err) {
      toast(err.message || 'Erro ao entrar', false);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar'; }
    }
  });

  const fpwd = $('#forgotPwdBtn');
  if (fpwd) fpwd.onclick = () => showAuthStep('forgot');
  const fback = $('#forgotBackBtn');
  if (fback) fback.onclick = () => showAuthStep('user');

  // Verificação de e-mail
  const vback = $('#verifyEmailBackBtn');
  if (vback) vback.onclick = () => showAuthStep('user');
  const vform = $('#verifyEmailForm');
  if (vform) vform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#verifyEmailTarget')?.textContent || '').trim();
    const code = $('#verifyEmailCode').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('Código inválido', false); return; }
    const submitBtn = e.target.querySelector('button[type=submit]');
    const endLoading = Loading.buttonStart(submitBtn, 'Confirmando…');
    let r;
    try { r = await DB.verifyEmailCode(email, code); } catch (err) { r = { error: err.message }; }
    endLoading();
    if (r.error) { toast(r.error, false); return; }
    // E-mail confirmado. Tenta login automático.
    toast('E-mail confirmado! Entrando...');
    closePainelThen(() => { location.href = 'account.html'; });
  });
  const vresend = $('#verifyEmailResendBtn');
  if (vresend) vresend.onclick = async () => {
    const email = ($('#verifyEmailTarget')?.textContent || '').trim();
    if (!email) return;
    try {
      await DB.requestVerifyEmail(email);
      toast('Código reenviado');
    } catch (e) { toast(e.message || 'Erro ao reenviar', false); }
  };

  const fEmail = $('#forgotEmailForm');
  if (fEmail) fEmail.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgotEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('E-mail inválido', false); return; }
    try {
      const r = await DB.requestCode(email, 'reset');
      forgotEmail = email;
      $('#forgotDevCode').textContent = r.devCode || '—';
      $('#forgotStep1').style.display = 'none';
      $('#forgotStep2').style.display = 'block';
      setTimeout(() => $('#forgotCode').focus(), 50);
    } catch (err) {
      toast(err.message || 'Erro ao enviar código', false);
    }
  });

  const fCode = $('#forgotCodeForm');
  if (fCode) fCode.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#forgotCode').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('Digite os 6 dígitos', false); return; }
    $('#forgotStep2').style.display = 'none';
    $('#forgotStep3').style.display = 'block';
  });

  const fPwd = $('#forgotPwdForm');
  if (fPwd) fPwd.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const p1 = f.password.value;
    const p2 = f.password2.value;
    if (p1 !== p2) { toast('As senhas não conferem', false); return; }
    if (p1.length < 4) { toast('Senha muito curta (mínimo 4 caracteres)', false); return; }
    const code = $('#forgotCode').value.trim();
    const submitBtn = f.querySelector('button[type=submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Salvando...'; }
    try {
      const r = await DB.resetPassword(forgotEmail, code, p1);
      if (r && r.error) { toast(r.error, false); return; }
      toast('Senha atualizada! Entrando…');
      // Auto-login após reset
      try {
        const lr = await DB.login(forgotEmail, p1);
        if (lr && lr.user) { /* ok */ } else { throw new Error('login pós-reset falhou'); }
      } catch (_) {
        // se falhar, deixa o usuário logar manualmente
      }
      closePainelThen(() => { location.href = 'account.html'; });
    } catch (err) {
      toast(err.message || 'Erro ao redefinir senha', false);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Definir nova senha'; }
    }
  });
}

function closePainelThen(cb) {
  $('#painelModal').classList.remove('open');
  setTimeout(cb, 200);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pixelforge_theme', next); } catch(e) {}
}

function setupAffCta() {
  const cta = $('#openPainelFromAffCta');
  if (!cta) return;
  // Se já logado, customiza o botão: vai direto para o painel
  const me = DB.getCurrentUser();
  if (me) {
    cta.textContent = me.is_affiliate ? 'Abrir meu painel' : 'Abrir minha conta';
  }
  cta.onclick = openPainel;
}

function setupAccountNotice() {
  const notice = $('#accountNotice');
  if (!notice) return;
  // Esconde o banner se o usuário já está logado
  const me = DB.getCurrentUser();
  if (me) { notice.style.display = 'none'; return; }
  try {
    if (sessionStorage.getItem('pixelforge_notice_dismissed') === '1') {
      notice.style.display = 'none';
      return;
    }
  } catch (e) {}
  const close = $('#noticeCloseBtn');
  if (close) close.onclick = () => {
    notice.style.display = 'none';
    try { sessionStorage.setItem('pixelforge_notice_dismissed', '1'); } catch (e) {}
  };
  const log = $('#noticeLoginBtn');
  if (log) log.onclick = () => openPainel();
}

document.addEventListener('DOMContentLoaded', init);
