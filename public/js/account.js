const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// CRIT-04 FIX: escape HTML para innerHTML com dados do servidor
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

let pendingEmail = null;
let pendingCode = null;

function showLogin() {
  $('#loginView').style.display = 'grid';
  $('#dashboardView').style.display = 'none';
}

function showDashboard() {
  $('#loginView').style.display = 'none';
  $('#dashboardView').style.display = 'block';
}

function activateTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}

function setupTabs() {
  $$('.tab').forEach(b => b.onclick = () => {
    activateTab(b.dataset.tab);
    if (b.dataset.tab === 'afiliado') renderAffiliatePanel();
  });
}

function setupEmailForm() {
  const form = $('#emailForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#emailInput').value.trim();
    const password = $('#passwordInput').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('E-mail inválido', false); return; }
    if (!password) { toast('Informe a senha', false); return; }
    verifyPasswordLogin(email, password);
  });
  $('#codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#codeInput').value.trim();
    if (!/^\d{6}$/.test(code)) { toast('Digite o código de 6 dígitos', false); return; }
    verifyCode(pendingEmail, code);
  });
  $('#resendBtn').onclick = () => { if (pendingEmail) sendCode(pendingEmail); };
}

async function verifyPasswordLogin(email, password) {
  const submitBtn = $('#emailForm button[type=submit]') || $('#emailForm button');
  const endLoading = Loading.buttonStart(submitBtn, 'Entrar');
  const result = await DB.authenticateUser(email, password);
  endLoading();
  if (result.error) {
    // Backend pode pedir verificação de e-mail
    if (result.code === 'EMAIL_NOT_VERIFIED') {
      pendingEmail = result.email || email;
      $('#emailForm').style.display = 'none';
      showVerifyEmailPanel(pendingEmail);
      toast('Confirme seu e-mail para entrar. Enviamos um novo código.', false);
      const resendBtn = $('#resendBtn') || $('#emailForm button[type=submit]');
      if (result.retryAfter && resendBtn) {
        startResendCooldown(resendBtn, result.retryAfter);
      }
      return;
    }
    // CRIT-01 FIX: backend agora retorna 401 + code: 'USE_CODE' para NO_PASSWORD
    // (mesma resposta que senha errada, para não diferenciar)
    if (result.code === 'USE_CODE' || result.code === 'NO_PASSWORD') {
      pendingEmail = email;
      const useCode = confirm(
        `E-mail ou senha incorretos.\n\n` +
        `Se você é novo (comprou sem criar senha), podemos enviar um código de 6 dígitos para o seu e-mail agora. ` +
        `(OK para enviar código / Cancelar para tentar outra senha)`
      );
      if (useCode) {
        await sendCode(email);
      } else {
        $('#passwordInput').focus();
        $('#passwordInput').select();
      }
    } else {
      toast(result.error, false);
    }
    return;
  }
  if (result.role === 'affiliate') {
    toast(`Bem-vindo, ${result.affiliate.name}!`);
  } else {
    toast(`Bem-vindo, ${result.buyer.name}!`);
  }
  enterApp();
  try {
    await DB.init();
    await DB._refreshUserData();
    renderAll();
  } catch (e) { console.warn('Post-login refresh failed:', e.message); }
}

function startResendCooldown(btn, seconds, onDone) {
  if (!btn) return;
  btn.disabled = true;
  let left = seconds;
  const tick = () => {
    btn.textContent = `Reenviar (${left}s)`;
    if (--left < 0) {
      btn.disabled = false;
      btn.textContent = 'Reenviar código';
      if (onDone) onDone();
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

async function sendCode(email) {
  const btn = $('#resendBtn') || $('#emailForm button[type=submit]');
  const endLoading = Loading.buttonStart(btn, 'Enviar código');
  let res;
  try {
    res = await DB.generateLoginCode('user', email.toLowerCase());
  } catch (err) {
    endLoading();
    const retryAfter = err.data && err.data.retryAfter;
    if (retryAfter) {
      toast(`Aguarde ${retryAfter}s para reenviar.`, false);
      startResendCooldown(btn, retryAfter);
    } else {
      toast(err.message || 'Erro ao enviar código', false);
    }
    return;
  }
  endLoading();
  if (!res || !res.ok) {
    toast('E-mail não cadastrado', false);
    return;
  }
  pendingEmail = email;
  $('#codeEmail').textContent = email;
  $('#codeInput').value = '';
  $('#emailForm').style.display = 'none';
  $('#codeForm').style.display = 'block';
  $('#devCode').textContent = res.devCode || '—';
  startResendCooldown(btn, res.retryAfter || 60);
  setTimeout(() => $('#codeInput').focus(), 50);
}

async function verifyCode(email, code) {
  const submitBtn = $('#codeForm button[type=submit]') || $('#codeForm button');
  const endLoading = Loading.buttonStart(submitBtn, 'Verificar');
  let r;
  try { r = await DB.verifyCode(email, code, 'login'); } catch (e) { r = { error: e.message }; }
  endLoading();
  if (r.error) {
    toast(r.error || 'Código inválido ou expirado', false);
    return;
  }
  // CRIT-01 FIX: se backend diz que precisa criar senha, mostrar form
  if (r.code === 'SET_PASSWORD_REQUIRED') {
    pendingCode = code;
    pendingEmail = email;
    showSetPasswordForm();
    return;
  }
  enterApp();
  try {
    await DB.init();
    await DB._refreshUserData();
    renderAll();
  } catch (e) { console.warn('Post-login refresh failed:', e.message); }
}

function showSetPasswordForm() {
  // Reaproveita o #codeForm para mostrar "Defina sua senha"
  const cf = $('#codeForm');
  cf.innerHTML = `
    <h2 style="font-size:1.25rem; margin-bottom:6px">Crie sua senha</h2>
    <p class="text-muted" style="font-size:0.875rem; margin-bottom:14px">Como esta é sua primeira vez logando, defina uma senha para sua conta.</p>
    <form id="setPwdForm">
      <input class="input" type="password" id="setPwdInput" required placeholder="Mínimo 10 caracteres" minlength="10" autocomplete="new-password" />
      <input class="input" type="password" id="setPwdInput2" required placeholder="Repita a senha" minlength="10" autocomplete="new-password" style="margin-top:8px" />
      <button class="btn btn-primary" type="submit" style="margin-top:12px; width:100%">Criar senha e entrar</button>
    </form>
  `;
  $('#setPwdForm').onsubmit = async (e) => {
    e.preventDefault();
    const p1 = $('#setPwdInput').value;
    const p2 = $('#setPwdInput2').value;
    if (p1.length < 10) { toast('Senha deve ter no mínimo 10 caracteres', false); return; }
    if (p1 !== p2) { toast('As senhas não coincidem', false); return; }
    const submitBtn = e.target.querySelector('button');
    const endLoading = Loading.buttonStart(submitBtn, 'Criando…');
    try {
      await DB.setPassword(pendingEmail, pendingCode, p1);
      endLoading();
      toast('Senha criada! Bem-vindo.');
      enterApp();
      try { await DB.init(); await DB._refreshUserData(); renderAll(); }
      catch (e) { console.warn('Post-login refresh failed:', e.message); }
    } catch (err) {
      endLoading();
      toast(err.message || 'Erro ao criar senha', false);
    }
  };
  setTimeout(() => $('#setPwdInput').focus(), 50);
}

function enterApp() {
  const buyer = DB.getCurrentBuyer();
  const aff = DB.getCurrentAffiliate();
  if (!buyer && !aff) { showLogin(); return; }
  showDashboard();
  $('#helloUser').textContent = aff ? `Olá, ${aff.name}` : (buyer ? `Olá, ${buyer.name}` : 'Olá');
  $('#helloSub').textContent = aff
    ? 'Acompanhe seus ganhos, comissões e pedidos indicados.'
    : 'Veja seus downloads, licenças e dados de compra. Aqui você também pode se tornar afiliado.';
  $('#tabAfiliado').style.display = '';
  $('#affPill').style.display = aff ? '' : 'none';
  if (aff) DB.recalcAffiliateStats();
  const initialTab = location.hash.replace('#', '') || 'compras';
  activateTab(['compras', 'dados', 'afiliado'].includes(initialTab) ? initialTab : 'compras');
  renderAll();
  renderEmailVerifyBanner();
}

function renderEmailVerifyBanner() {
  const u = DB.getCurrentBuyer() || DB.getCurrentAffiliate();
  // remove banner antigo se houver
  const old = $('#emailVerifyBanner');
  if (old) old.remove();
  if (!u || !u.email || u.email_verified) return;
  const banner = document.createElement('div');
  banner.id = 'emailVerifyBanner';
  banner.style.cssText = 'background:rgba(217,119,6,0.1); border:1px solid rgba(217,119,6,0.3); color:var(--ink); padding:12px 16px; border-radius:8px; margin-bottom:16px; display:flex; align-items:center; gap:10px; font-size:0.875rem';
  banner.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; color:var(--warning)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span style="flex:1">Confirme seu e-mail <strong>${escHtml(u.email)}</strong> para liberar downloads e saques.</span>
    <button class="btn btn-secondary" id="emailVerifyBannerBtn" style="padding:4px 12px; font-size:0.8125rem">Verificar agora</button>
  `;
  const head = document.querySelector('.account-head') || document.querySelector('.tabs');
  if (head) head.parentNode.insertBefore(banner, head.nextSibling);
  $('#emailVerifyBannerBtn').onclick = async () => {
    pendingEmail = u.email;
    showVerifyEmailPanel(u.email, null);
    showLogin();
  };
}

function renderAll() {
  renderOrders();
  renderDataPanel();
  const aff = DB.getCurrentAffiliate();
  if (aff && $('.tab.active')?.dataset.tab === 'afiliado') renderAffiliatePanel();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderOrders() {
  const buyer = DB.getCurrentBuyer() || DB.getCurrentUser();
  const target = $('#ordersList');

  if (!buyer || !buyer.email) { target.innerHTML = ''; return; }
  const orders = DB.getOrdersByEmail(buyer.email);
  if (orders.length === 0) {
    target.innerHTML = emptyOrders('Você ainda não tem compras', 'Explore o catálogo e faça sua primeira compra.');
    return;
  }
  target.innerHTML = orders.map(o => {
    const item = o.items[0];
    const ic = (item?.name || '?').charAt(0).toUpperCase();
    const isPaid = o.status === 'pago';
    const isFree = Number(o.total) === 0;
    const hasUrl = item?.downloadUrl;
    const isPix = o.payment === 'pix';
    const hasPixQr = !!o.pixQrCode;
    const viewQrLabel = (typeof I18N !== 'undefined' ? I18N.t('account.view_pix_qr') : 'Ver QR do Pix');
    return `
      <div class="order-card" data-order-id="${escHtml(o.id)}">
        <div class="order-ic">${escHtml(ic)}</div>
        <div class="order-info">
          <h4>${escHtml(item?.name || 'Plugin')}</h4>
          <div class="meta">
            <span>${fmtDate(o.createdAt)}</span>
            <span>${brl(o.total)}</span>
            <span><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></span>
            <span>${escHtml(o.paymentMethod || o.payment || 'pix')}</span>
            ${isPaid && !isFree ? `<span>Licença <code>${escHtml(o.licenseKey)}</code></span>` : ''}
          </div>
        </div>
        <div class="order-actions">
          ${!isPaid && isPix && hasPixQr ? `<button class="btn btn-secondary view-pix-qr" data-order-id="${escHtml(o.id)}" style="font-size:0.8125rem">${escHtml(viewQrLabel)}</button>` : ''}
          ${isPaid && hasUrl ? `<a href="download.html?t=${encodeURIComponent(o.downloadToken)}" class="btn btn-primary">Baixar</a>` : ''}
          ${!isPaid && !(isPix && hasPixQr) ? '<span style="color:var(--ink-3); font-size:0.8125rem">aguardando pagamento</span>' : ''}
          ${isPaid && !hasUrl ? '<span style="color:var(--ink-3); font-size:0.8125rem">link em breve</span>' : ''}
        </div>
      </div>`;
  }).join('');

  $$('.view-pix-qr', target).forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.orderId;
      const order = orders.find(o => o.id === id);
      if (order) openPixModal(order);
    };
  });
}

function openPixModal(order) {
  const modal = $('#pixModal');
  if (!modal) return;

  $('#pixOrderId').textContent = order.id;
  $('#pixAmount').textContent = brl(order.total);
  $('#pixQrImage').src = order.pixQrImage || '';
  $('#pixQrImage').style.display = order.pixQrImage ? '' : 'none';
  $('#pixCopyPaste').value = order.pixQrCode || '';
  $('#pixStatus').textContent = 'Aguardando pagamento…';
  $('#pixStatus').className = 'pill warn';

  const expiresAt = order.pixExpiresAt ? new Date(order.pixExpiresAt).getTime() : Date.now() + 30 * 60 * 1000;
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

  let stopped = false;
  let pollTimer = null;
  async function poll() {
    if (stopped) return;
    try {
      const r = await DB.getOrderStatus(order.id);
      if (r && r.is_paid) {
        stopped = true;
        $('#pixStatus').textContent = 'Pago! Licença liberada.';
        $('#pixStatus').className = 'pill ok';
        renderOrders(); // atualiza botão para Baixar
        toast('Pagamento confirmado! Atualizando pedidos…');
        return;
      }
      if (r && r.status === 'cancelado') {
        stopped = true;
        $('#pixStatus').textContent = 'Pedido cancelado';
        $('#pixStatus').className = 'pill danger';
        return;
      }
    } catch {}
    pollTimer = setTimeout(poll, 5000);
  }
  poll();

  modal.style.display = 'flex';
  $('#pixCloseBtn').onclick = () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    modal.style.display = 'none';
  };
  modal.onclick = (e) => { if (e.target === modal) $('#pixCloseBtn').click(); };
}

function emptyOrders(title, sub) {
  return `<div class="empty-orders">
    <div class="ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg></div>
    <h3>${escHtml(title)}</h3>
    <p>${escHtml(sub)}</p>
    <a href="index.html" class="btn btn-primary">Ver catálogo</a>
  </div>`;
}

function renderDataPanel() {
  const aff = DB.getCurrentAffiliate();
  const buyer = DB.getCurrentBuyer();
  if (aff) {
    $('#dataPanel').innerHTML = `<div class="kv-list">
      <div class="kv"><div class="lbl">Nome</div><div class="val">${escHtml(aff.name)}</div></div>
      <div class="kv"><div class="lbl">E-mail</div><div class="val">${escHtml(aff.email)}</div></div>
      <div class="kv"><div class="lbl">Código de afiliado</div><div class="val"><code>${escHtml(aff.code)}</code></div></div>
      <div class="kv"><div class="lbl">Comissão</div><div class="val">${aff.rate}%</div></div>
      <div class="kv"><div class="lbl">Status</div><div class="val"><span class="pill ${aff.status === 'active' ? 'ok' : aff.status === 'paused' ? 'warn' : 'danger'}">${escHtml(aff.status)}</span></div></div>
      <div class="kv"><div class="lbl">Cadastrado em</div><div class="val">${fmtDate(aff.createdAt)}</div></div>
      ${renderPasswordForm('affiliate')}
    </div>`;
    wirePasswordForm('affiliate');
    return;
  }
  if (buyer) {
    const orders = DB.getOrdersByEmail(buyer.email);
    $('#dataPanel').innerHTML = `<div class="kv-list">
      <div class="kv"><div class="lbl">Nome</div><div class="val">${escHtml(buyer.name)}</div></div>
      <div class="kv"><div class="lbl">E-mail</div><div class="val">${escHtml(buyer.email)}</div></div>
      <div class="kv"><div class="lbl">Total de compras</div><div class="val">${orders.length}</div></div>
      <div class="kv"><div class="lbl">Conta criada em</div><div class="val">${fmtDate(buyer.createdAt)}</div></div>
      ${renderPasswordForm('buyer')}
    </div>`;
    wirePasswordForm('buyer');
  }
}

function renderPasswordForm(role) {
  return `<div class="kv" style="display:block">
    <div class="lbl" style="margin-bottom:8px">${role === 'affiliate' ? 'Senha' : 'Senha'}</div>
    <form id="changePwdForm" style="display:grid; gap:8px; max-width:340px">
      <input class="input" type="password" name="current" placeholder="Senha atual" />
      <input class="input" type="password" name="newpwd" placeholder="Nova senha (mín. 4)" minlength="4" required />
      <input class="input" type="password" name="confirm" placeholder="Confirmar nova senha" minlength="4" required />
      <button type="submit" class="btn btn-secondary" style="justify-content:center">Atualizar senha</button>
    </form>
  </div>`;
}

function wirePasswordForm(role) {
  const form = $('#changePwdForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form;
    const newPwd = f.newpwd.value;
    const confirm = f.confirm.value;
    if (newPwd !== confirm) { toast('As senhas não conferem', false); return; }
    try {
      if (role === 'affiliate') {
        await DB.changePassword(f.current.value, newPwd);
      } else {
        await DB.changePassword(f.current.value, newPwd);
      }
      f.reset();
      toast('Senha atualizada');
    } catch (err) {
      toast(err.message || 'Erro ao atualizar senha', false);
    }
  });
}

let _affPanelLoaded = false;
let _affPanelLoading = null;
// Copia o link de divulgação do afiliado para a área de transferência
function copyAffiliateLink() {
  const aff = DB.getCurrentAffiliate();
  const code = aff && (aff.code || aff.affiliateCode);
  if (!code) return;
  const link = window.location.origin + '/?ref=' + code;
  navigator.clipboard.writeText(link).then(() => {
    toast('Link copiado: ' + link);
  }).catch(() => {
    // Fallback para navegadores sem permissão de clipboard
    const input = document.createElement('input');
    input.value = link;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    toast('Link copiado');
  });
}

function renderAffiliatePanel() {
  const buyer = DB.getCurrentBuyer();
  const aff = DB.getCurrentAffiliate();

  if (!aff) {
    if (!buyer) { $('#affiliatePanel').innerHTML = ''; return; }
    $('#affiliatePanel').innerHTML = `
      <div class="aff-cta-wrap">
        <div class="aff-cta-icon-big">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <h2>Torne-se afiliado</h2>
        <p>Você já tem conta. Ative agora o programa de afiliados e ganhe <strong>25% de comissão</strong> em cada venda indicada pelo seu código, para sempre.</p>

        <div class="aff-cta-stats">
          <div><div class="num">25%</div><div class="lbl">de comissão</div></div>
          <div><div class="num">30d</div><div class="lbl">de cookie</div></div>
          <div><div class="num">Pix</div><div class="lbl">pagamento</div></div>
        </div>

        <ul class="aff-cta-bullets">
          <li><span class="check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span> Código exclusivo gerado na hora</li>
          <li><span class="check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span> Painel com cliques, vendas e conversões</li>
          <li><span class="check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span> Saque por Pix quando quiser</li>
        </ul>

        <button class="btn btn-primary" id="becomeAffBtn" style="min-width:200px; justify-content:center">
          Quero ser afiliado
        </button>
        <p class="aff-cta-note">Ao ativar, um registro de afiliado é criado usando seu e-mail <strong>${escHtml(buyer.email)}</strong>.</p>
      </div>
    `;
    $('#becomeAffBtn')?.addEventListener('click', () => becomeAffiliate());
    return;
  }

  // Se ainda não carregou stats frescas, mostra esqueleto e dispara fetch (uma vez)
  if (!_affPanelLoaded) {
    $('#affiliatePanel').innerHTML = `
      <div class="skeleton" style="height:80px; border-radius:10px; margin-bottom:14px"></div>
      <div class="skeleton" style="height:200px; border-radius:10px; margin-bottom:14px"></div>
      <div class="skeleton" style="height:160px; border-radius:10px"></div>`;
    if (!_affPanelLoading) {
      _affPanelLoading = DB.getMyAffiliateStats()
        .then(s => {
          if (s && s.affiliate) {
            // Atualiza cache.me (camelCase)
            if (cache.me) {
              Object.assign(cache.me, {
                isAffiliate: 1,
                clicks: Number(s.affiliate.clicks || 0),
                conversions: Number(s.affiliate.conversions || 0),
                totalSales: Number(s.affiliate.total_sales || 0),
                totalEarned: Number(s.affiliate.total_earned || 0),
                paidOut: Number(s.affiliate.paid_out || 0),
                dailyStats: s.affiliate.daily_stats || {},
                pixKey: s.affiliate.pix_key || '',
                pixHolder: s.affiliate.pix_holder || '',
                affiliateCode: s.affiliate.code || s.affiliate.affiliate_code,
                affiliateStatus: s.affiliate.status || s.affiliate.affiliate_status || 'active',
                affiliateRate: s.affiliate.affiliate_rate || 25
              });
              setStoredUser(cache.me);
            }
            // Salva payouts no cache (normalizado camelCase)
            if (s.payouts) {
              cache.payouts = s.payouts.map(p => ({
                ...p,
                affiliateId: p.affiliate_id || p.affiliateId,
                affiliateCode: p.affiliate_code || p.affiliateCode,
                requestedAt: p.requested_at || p.requestedAt,
                processedAt: p.processed_at || p.processedAt,
                pixKey: p.pix_key || p.pixKey,
                pixHolder: p.pix_holder || p.pixHolder
              }));
            }
            // Salva recentOrders no cache
            if (s.recentOrders) {
              // Marca como do afiliado, não do buyer
              cache.affiliateOrders = s.recentOrders.map(o => ({
                ...o,
                affiliateCode: o.affiliate_code || o.affiliateCode,
                buyerName: o.buyer_name || o.buyerName,
                buyerEmail: o.buyer_email || o.buyerEmail,
                createdAt: o.created_at || o.createdAt,
                items: (() => { try { return typeof o.items === 'string' ? JSON.parse(o.items) : o.items; } catch { return []; } })()
              }));
            }
            // Salva dados do mês para o painel
            cache.affiliateStatsMonth = s.month || { clicks: 0, sales: 0, earned: 0 };
            // Salva constantes de taxa para o banner de breakdown
            if (s.fees) window.__affFees = s.fees;
          }
          _affPanelLoaded = true;
        })
        .catch(e => { console.warn('getMyAffiliateStats failed:', e.message); })
        .finally(() => { _affPanelLoading = null; });
    }
    // Re-tenta renderizar quando o fetch terminar
    _affPanelLoading.finally(() => {
      if (_affPanelLoaded) renderAffiliatePanel();
    });
    return;
  }

  // === Renderiza com dados frescos ===
  const fresh = aff;
  const statsMonth = cache.affiliateStatsMonth || { clicks: 0, sales: 0, earned: 0 };
  const pending = +(fresh.totalEarned - fresh.paidOut).toFixed(2);
  const conversion = fresh.clicks > 0 ? ((fresh.totalSales / fresh.clicks) * 100).toFixed(1) : '0.0';
  const link = `${location.origin}${location.pathname.replace('account.html', 'index.html')}?ref=${fresh.code}`;

  const myPayouts = (cache.payouts || []).filter(p => (p.affiliateId || p.affiliate_id) === fresh.id);
  const refs = (cache.affiliateOrders || []).slice(0, 10);

  $('#affiliatePanel').innerHTML = `
    <div class="aff-hero">
      <div class="aff-hero-ic">${escHtml((fresh.name || 'A').charAt(0).toUpperCase())}</div>
      <div class="aff-hero-info">
        <h2>${escHtml(fresh.name || 'Afiliado')}</h2>
        <p>${escHtml(fresh.email || '')} · código <code style="background:var(--bg); padding:1px 6px; border-radius:3px; color:var(--ink)">${escHtml(fresh.code || '—')}</code> · ${fresh.rate || 25}% de comissão</p>
      </div>
      <span class="pill ${fresh.status === 'active' ? 'ok' : fresh.status === 'paused' ? 'warn' : 'danger'}">${escHtml(fresh.status || 'active')}</span>
    </div>

    <div class="aff-stats-mini">
      <div class="aff-stat-mini">
        <div class="lbl">Cliques no mês</div>
        <div class="num">${statsMonth.clicks}</div>
        <div class="sub">${fresh.clicks || 0} no total</div>
      </div>
      <div class="aff-stat-mini">
        <div class="lbl">Conversão</div>
        <div class="num">${conversion}%</div>
        <div class="sub">${fresh.totalSales || 0} vendas no total</div>
      </div>
      <div class="aff-stat-mini">
        <div class="lbl">Ganho no mês</div>
        <div class="num">${brl(statsMonth.earned)}</div>
        <div class="sub">${brl(fresh.totalEarned || 0)} acumulado</div>
      </div>
      <div class="aff-stat-mini">
        <div class="lbl">A receber</div>
        <div class="num">${brl(pending)}</div>
        <div class="sub">${brl(fresh.paidOut || 0)} já pagos</div>
      </div>
    </div>

    ${renderChart(fresh.dailyStats || {})}

    ${(() => {
      const fees = (typeof window !== 'undefined' && window.__affFees) || { gatewayFeeFixed: 0, taxRate: 0, netCommission: true };
      const gw = (fees.gatewayFeeFixed || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const tax = fees.taxRate > 0 ? ` − impostos ${(fees.taxRate * 100).toFixed(1)}%` : '';
      return `<div class="aff-fee-info" style="background:var(--bg-subtle); border:1px solid var(--line); border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:0.8125rem; color:var(--ink-3)">
        <strong style="color:var(--ink)">Como sua comissão é calculada</strong><br>
        Preço do produto${tax ? '' : ' (subtotal)'} − taxa do gateway (${gw})${tax} = valor líquido${fees.netCommission ? ' → comissão <strong>' + (fresh.rate || 25) + '%</strong> sobre o líquido' : ''}.
      </div>`;
    })()}

    <div class="aff-share">
      <h3>Compartilhe seu link</h3>
      <p>Cada compra feita por este link em até 30 dias gera comissão para você.</p>
      <div class="aff-share-row">
        <span class="label">Código</span>
        <input class="input" value="${escHtml(fresh.code || '')}" readonly id="shareCode" />
        <button class="btn btn-secondary" id="copyCodeBtn">Copiar</button>
      </div>
      <div class="aff-share-row">
        <span class="label">Link</span>
        <input class="input" value="${link}" readonly id="shareLink" />
        <button class="btn btn-primary" id="copyLinkBtn">Copiar link</button>
      </div>
      <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap">
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Olha esse plugin: ' + link)}" style="font-size:0.8125rem">WhatsApp</a>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Indicação cafe plugins')}" style="font-size:0.8125rem">Telegram</a>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Olha esse plugin: ' + link)}" style="font-size:0.8125rem">X/Twitter</a>
      </div>
    </div>

    <div class="aff-section">
      <h3>Chave PIX para receber</h3>
      <p style="color:var(--ink-3); font-size:0.875rem; margin-bottom:12px">Informe sua chave PIX (CPF, e-mail, celular ou chave aleatória) e o nome do titular. Usamos isso para te pagar via Pix.</p>
      <div class="aff-share-row">
        <span class="label">Chave PIX</span>
        <input class="input" id="pixKeyInput" value="${escHtml(fresh.pixKey || '')}" placeholder="sua@chave.com ou CPF" />
      </div>
      <div class="aff-share-row">
        <span class="label">Titular</span>
        <input class="input" id="pixHolderInput" value="${escHtml(fresh.pixHolder || '')}" placeholder="Seu nome completo" />
      </div>
      <button class="btn btn-secondary" id="savePixBtn" style="margin-top:8px">Salvar chave PIX</button>
    </div>

    ${pending >= 10 ? `<div class="payout-cta">
      <div class="payout-cta-info">
        <h3>Você tem <strong>${brl(pending)}</strong> a receber</h3>
        <p>Solicite o saque e o admin vai processar via Pix em até 5 dias úteis.</p>
      </div>
      <button class="btn btn-primary" id="requestPayoutBtn">Pedir saque</button>
    </div>` : pending > 0 ? `<div class="payout-cta" style="opacity:0.7">
      <div class="payout-cta-info">
        <h3>Você tem <strong>${brl(pending)}</strong> a receber</h3>
        <p>Valor mínimo para saque é R$ 10,00. Continue indicando e peça o saque quando atingir.</p>
      </div>
      <button class="btn btn-secondary" disabled>Pedir saque</button>
    </div>` : ''}

    <div class="aff-section">
      <h3>Histórico de pagamentos</h3>
      ${myPayouts.length === 0 ? '<p style="color:var(--ink-3); font-size:0.875rem">Nenhum saque solicitado ainda.</p>' : `
        <table class="mini-table">
          <thead><tr><th>Solicitado</th><th>Valor</th><th>Chave PIX</th><th>Status</th></tr></thead>
          <tbody>${myPayouts.map(p => `<tr>
            <td>${fmtDate(p.requestedAt || p.requested_at)}</td>
            <td><strong>${brl(p.amount)}</strong></td>
            <td><code style="background:var(--bg-subtle); padding:2px 6px; border-radius:3px; font-size:0.75rem">${escHtml(p.pixKey || p.pix_key || '—')}</code>${p.pixHolder || p.pix_holder ? `<br><small style="color:var(--ink-3)">${escHtml(p.pixHolder || p.pix_holder)}</small>` : ''}</td>
            <td><span class="pill ${p.status === 'pago' ? 'ok' : p.status === 'rejeitado' ? 'danger' : 'warn'}">${p.status}</span></td>
          </tr>`).join('')}</tbody>
        </table>`}
    </div>

    <div class="aff-section">
      <h3>Últimas vendas indicadas</h3>
      ${refs.length === 0 ? '<p style="color:var(--ink-3); font-size:0.875rem">Nenhuma venda ainda. Compartilhe seu link e ganhe 25% por venda!</p>' : `
        <table class="mini-table">
          <thead><tr><th>Data</th><th>Cliente</th><th>Produto</th><th>Comissão</th><th>Status</th></tr></thead>
          <tbody>${refs.map(o => {
            const b = o.breakdown || {};
            const hasBreakdown = b.subtotal > 0 && b.gatewayFee > 0;
            return `<tr>
            <td>${fmtDate(o.createdAt || o.created_at)}</td>
            <td>${escHtml(o.buyerName || o.buyer_name || '—')}<br><small style="color:var(--ink-3)">${escHtml(o.buyerEmail || o.buyer_email || '')}</small></td>
            <td>${escHtml(o.items?.[0]?.name || '—')}<br><small style="color:var(--ink-3)">${brl(b.subtotal || 0)}</small></td>
            <td>
              <strong>${brl(o.commission || 0)}</strong>
              ${hasBreakdown ? `<br><small style="color:var(--ink-3); font-size:0.7rem" title="Subtotal ${brl(b.subtotal)} − gateway ${brl(b.gatewayFee)} = líquido ${brl(b.netAmount)} → ${b.commissionRate || 25}% = ${brl(b.commission)}">${brl(b.subtotal)} − ${brl(b.gatewayFee)} = ${brl(b.netAmount)}</small>` : ''}
            </td>
            <td><span class="pill ${o.status === 'pago' ? 'ok' : o.status === 'pendente' ? 'warn' : 'danger'}">${escHtml(o.status)}</span></td>
          </tr>`;
          }).join('')}</tbody>
        </table>`}
    </div>
  `;

  const copy = (input) => {
    input.select();
    try { navigator.clipboard.writeText(input.value); toast('Copiado'); }
    catch (e) { document.execCommand('copy'); toast('Copiado'); }
  };
  $('#copyCodeBtn')?.addEventListener('click', () => copy($('#shareCode')));
  $('#copyLinkBtn')?.addEventListener('click', copyAffiliateLink);
  $('#requestPayoutBtn')?.addEventListener('click', () => requestPayout(pending));
  $('#savePixBtn')?.addEventListener('click', () => savePixKey());
}

async function savePixKey() {
  const key = $('#pixKeyInput')?.value.trim();
  const holder = $('#pixHolderInput')?.value.trim();
  if (!key) { toast('Informe sua chave PIX', false); return; }
  try {
    await DB.updateMyPix(key, holder);
    if (cache.me) { cache.me.pix_key = key; cache.me.pix_holder = holder; }
    toast('Chave PIX salva');
  } catch (e) {
    toast(e.message || 'Erro ao salvar', false);
  }
}

async function requestPayout(pending) {
  if (pending <= 0) return;
  if (!confirm(`Confirmar solicitação de saque de ${brl(pending)}?`)) return;
  try {
    await DB.requestPayout();
    toast('Solicitação enviada. O admin vai processar em breve.');
    renderAffiliatePanel();
  } catch (err) {
    toast(err.message || 'Erro ao solicitar saque', false);
  }
}

async function becomeAffiliate() {
  const buyer = DB.getCurrentBuyer();
  if (!buyer) { toast('Faça login na sua conta de cliente primeiro', false); return; }
  if (DB.getCurrentAffiliate()) { toast('Você já é afiliado', false); return; }
  const btn = $('#becomeAffBtn');
  const endLoading = btn ? Loading.buttonStart(btn, 'Ativando…') : () => {};
  try {
    const result = await DB.createAffiliateFromBuyer(buyer.email);
    endLoading();
    if (result.error) { toast(result.error, false); return; }
    // backend retorna affiliate em snake_case. Normalizar:
    const aff = DB.getCurrentAffiliate(); // já bate pelo isAffiliate
    // fallback: pegar do result
    const code = (aff && aff.code) || (result.affiliate && (result.affiliate.code || result.affiliate.affiliate_code)) || '—';
    toast(`Bem-vindo! Seu código: ${code}`);
    // Resetar cache do painel para forçar reload
    _affPanelLoaded = false;
    _affPanelLoading = null;
    $('#affPill').style.display = '';
    // Re-init DB para pegar o user atualizado
    await DB.init();
    // Ativar tab afiliado
    activateTab('afiliado');
    renderAffiliatePanel();
  } catch (err) {
    endLoading();
    toast(err.message || 'Erro ao se tornar afiliado', false);
  }
}

function setupRegister() {
  const showReg = $('#showRegisterLink');
  const showLog = $('#showLoginLink');
  const form = $('#registerForm');
  if (showReg) showReg.onclick = () => {
    $('#emailForm').style.display = 'none';
    $('#codeForm').style.display = 'none';
    $('#registerForm').style.display = 'block';
    setTimeout(() => $('#regName')?.focus(), 50);
  };
  if (showLog) showLog.onclick = () => {
    $('#registerForm').style.display = 'none';
    $('#codeForm').style.display = 'none';
    $('#emailForm').style.display = 'block';
    setTimeout(() => $('#emailInput')?.focus(), 50);
  };
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type=submit]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Criando...'; }
      const name = $('#regName').value.trim();
      const email = $('#regEmail').value.trim();
      const p1 = $('#regPassword').value;
      const p2 = $('#regPassword2').value;
      if (p1 !== p2) {
        toast('As senhas não conferem', false);
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Criar conta'; }
        return;
      }
      try {
        const result = await DB.createBuyerAccount({ name, email, password: p1 });
        if (result.error) { toast(result.error, false); return; }
        // Backend agora exige verificação de e-mail. Vai para tela de código.
        if (result.requiresEmailVerification) {
          pendingEmail = email;
          $('#registerForm').style.display = 'none';
          $('#emailForm').style.display = 'none';
          $('#codeForm').style.display = 'none';
          showVerifyEmailPanel(email, result.devCode);
          toast('Conta criada! Confirme seu e-mail para continuar.');
          return;
        }
        toast(`Conta criada! Bem-vindo, ${result.buyer.name}!`);
        enterApp();
      } catch (err) {
        toast(err.message || 'Erro ao criar conta', false);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Criar conta'; }
      }
    });
  }
}

function showVerifyEmailPanel(email, devCode) {
  pendingEmail = email;
  $('#verifyForm').style.display = 'block';
  $('#verifyEmail').textContent = email;
  $('#verifyCodeInput').value = '';
  if (devCode) {
    $('#verifyDevCode').style.display = '';
    $('#verifyDevCode').textContent = devCode;
  } else {
    $('#verifyDevCode').style.display = 'none';
  }
  setTimeout(() => $('#verifyCodeInput').focus(), 50);
  // Wire resend
  if (!$('#verifyResendBtn').onclick) {
    $('#verifyResendBtn').onclick = async () => {
      const btn = $('#verifyResendBtn');
      try {
        const r = await DB.requestVerifyEmail(pendingEmail);
        if (r.devCode) {
          $('#verifyDevCode').style.display = '';
          $('#verifyDevCode').textContent = r.devCode;
        }
        toast('Código reenviado');
        startResendCooldown(btn, r.retryAfter || 60);
      } catch (e) {
        const retryAfter = e.data && e.data.retryAfter;
        if (retryAfter) {
          toast(`Aguarde ${retryAfter}s para reenviar.`, false);
          startResendCooldown(btn, retryAfter);
        } else {
          toast(e.message || 'Erro ao reenviar', false);
        }
      }
    };
    $('#verifyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = $('#verifyCodeInput').value.trim();
      if (!/^\d{6}$/.test(code)) { toast('Código inválido', false); return; }
      const submitBtn = e.target.querySelector('button[type=submit]');
      const endLoading = Loading.buttonStart(submitBtn, 'Confirmando…');
      let r;
      try { r = await DB.verifyEmailCode(pendingEmail, code); } catch (err) { r = { error: err.message }; }
      endLoading();
      if (r.error) { toast(r.error, false); return; }
      if (r.code === 'SET_PASSWORD_REQUIRED') {
        pendingCode = code;
        showSetPasswordForm();
        return;
      }
      // Sucesso: e-mail verificado. Vamos para o dashboard.
      $('#verifyForm').style.display = 'none';
      toast('E-mail confirmado! Bem-vindo.');
      enterApp();
      try { await DB.init(); await DB._refreshUserData(); renderAll(); }
      catch (e) { console.warn('Post-verify refresh failed:', e.message); }
    });
  }
}

function renderChart(dailyStats, isFresh = false) {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const stat = dailyStats[key] || { clicks: 0, sales: 0, earned: 0 };
    days.push({
      key,
      clicks: Number(stat.clicks || 0),
      sales: Number(stat.sales || 0),
      earned: Number(stat.earned || 0),
      label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    });
  }
  const totalClicks = days.reduce((s, d) => s + d.clicks, 0);
  const totalSales = days.reduce((s, d) => s + d.sales, 0);
  const totalEarned = days.reduce((s, d) => s + d.earned, 0);
  const avgClicks = totalClicks / 30;
  const realMax = Math.max(0, ...days.map(d => d.clicks));
  const maxClicks = realMax > 0 ? realMax : 0;
  // Dimensões
  const W = 640, H = 180, padL = 36, padR = 12, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const slot = chartW / days.length;
  const barW = slot * 0.55;
  const gap = slot * 0.45;
  const today = new Date(); today.setHours(0,0,0,0);
  const isEmpty = totalClicks === 0;

  // Pontos de venda (sobre as barras)
  let salesPoints = '';
  let salesLabels = '';
  days.forEach((d, i) => {
    if (d.sales > 0) {
      const x = padL + i * slot + slot / 2;
      const y = padT + 4;
      salesPoints += `<circle cx="${x}" cy="${y}" r="4" fill="var(--success, #22c55e)" stroke="var(--bg)" stroke-width="2"><title>${d.label}: ${d.sales} venda(s) · ${brl(d.earned)}</title></circle>`;
      salesLabels += `<text x="${x}" y="${y - 8}" text-anchor="middle" font-size="10" fill="var(--ink-2)" font-weight="600">${d.sales}</text>`;
    }
  });

  let bars = '';
  let xLabels = '';
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const h = maxClicks > 0 ? (d.clicks / maxClicks) * chartH : 0;
    const y = padT + chartH - h;
    const isToday = new Date(d.key + 'T00:00:00').getTime() === today.getTime();
    const renderH = h > 0 ? h : 1.5;
    const renderY = h > 0 ? y : (padT + chartH - 1.5);
    const opacity = h > 0 ? (isToday ? 1 : 0.85) : 0.18;
    bars += `<rect x="${x}" y="${renderY}" width="${barW}" height="${renderH}" rx="1.5" fill="var(--ink-3)" opacity="${opacity}">
      <title>${d.label}: ${d.clicks} cliques, ${d.sales} venda(s), ${brl(d.earned)}</title>
    </rect>`;
    if (i === 0 || i === 9 || i === 19 || i === 29) {
      xLabels += `<text x="${x + barW/2}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${d.label}</text>`;
    }
  });

  // Y-axis labels
  const yLabels = maxClicks > 0
    ? `<text x="${padL - 8}" y="${padT + chartH + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">0</text>
       <text x="${padL - 8}" y="${padT + 10}" text-anchor="end" font-size="10" fill="var(--ink-3)">${maxClicks}</text>
       ${avgClicks >= 1 ? `<text x="${padL - 8}" y="${padT + chartH/2 + 3}" text-anchor="end" font-size="9" fill="var(--ink-3)" opacity="0.7">média ${avgClicks.toFixed(1)}</text>` : ''}`
    : `<text x="${padL - 8}" y="${padT + chartH + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">0 cliques</text>`;

  // Empty state com mensagem amigável
  const emptyHint = isEmpty ? `
    <div style="position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; color:var(--ink-3); font-size:0.8125rem; text-align:center; padding:0 16px">
      <div>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 6px; opacity:0.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <div style="font-weight:500">Sem cliques ainda nos últimos 30 dias</div>
        <div style="font-size:0.75rem; margin-top:4px; opacity:0.8">Compartilhe seu link de afiliado para começar</div>
      </div>
    </div>` : '';

  return `<div class="chart-wrap" style="position:relative">
    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:6px; gap:12px; flex-wrap:wrap">
      <div>
        <h3 style="margin:0 0 2px">Últimos 30 dias</h3>
        <p style="margin:0; color:var(--ink-3); font-size:0.8125rem">${totalClicks} cliques · ${totalSales} vendas · ${brl(totalEarned)} em comissões</p>
      </div>
      <div style="font-size:0.75rem; color:var(--ink-3); display:flex; gap:12px">
        <span><strong style="color:var(--ink)">${totalClicks}</strong> cliques</span>
        <span><strong style="color:var(--ink)">${totalSales}</strong> vendas</span>
        <span><strong style="color:var(--success, #22c55e)">${brl(totalEarned)}</strong> ganho</span>
      </div>
    </div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; display:block">
      <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="var(--line)" stroke-width="1" />
      ${yLabels}
      ${bars}
      ${salesPoints}
      ${salesLabels}
      ${xLabels}
    </svg>
    ${emptyHint}
    <div class="chart-legend" style="display:flex; gap:14px; margin-top:10px; font-size:0.75rem; color:var(--ink-3); flex-wrap:wrap">
      <span style="display:inline-flex; align-items:center; gap:5px">
        <span style="display:inline-block; width:10px; height:10px; background:var(--ink-3); border-radius:2px; opacity:0.85"></span>
        Cliques por dia
      </span>
      <span style="display:inline-flex; align-items:center; gap:5px">
        <span style="display:inline-block; width:8px; height:8px; background:var(--success, #22c55e); border-radius:50%; border:2px solid var(--bg)"></span>
        Vendas (verde) com contagem
      </span>
    </div>
  </div>`;
}

function setupLogout() {
  $('#logoutBtn').onclick = () => {
    if (!confirm('Sair da sua conta?')) return;
    DB.clearBuyerSession();
    DB.clearAffiliateSession();
    _affPanelLoaded = false;
    _affPanelLoading = null;
    cache.affiliateOrders = null;
    cache.affiliateStatsMonth = null;
    location.href = 'index.html';
  };
}

async function refreshOrders() {
  const btn = $('#refreshOrdersBtn');
  if (!btn) return;
  const endLoading = Loading.buttonStart(btn, 'Atualizar');
  try {
    await DB._refreshUserData();
    renderAll();
    toast('Pedidos atualizados');
  } catch (e) {
    toast(e.message || 'Falha ao atualizar', false);
  } finally {
    endLoading();
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pixelforge_theme', next); } catch (e) {}
}

async function init() {
  // Esconde splash IMEDIATAMENTE para evitar flash
  const splash = $('#loadingSplash');
  if (splash) splash.style.display = 'none';
  try { await DB.init(); } catch (e) { console.warn('DB.init falhou:', e.message); }
  // Popula cache.orders antes de renderizar (síncrono do ponto de vista do usuário)
  try { await DB._refreshUserData(); } catch (e) { console.warn('Initial refresh failed:', e.message); }
  $('#themeToggle').onclick = toggleTheme;
  setupEmailForm();
  setupRegister();
  setupTabs();
  setupLogout();
  $('#refreshOrdersBtn')?.addEventListener('click', refreshOrders);
  enterApp();
  handleCardReturn();
  if (location.hash === '#register') {
    $('#emailForm').style.display = 'none';
    $('#codeForm').style.display = 'none';
    $('#registerForm').style.display = 'block';
    setTimeout(() => $('#regName')?.focus(), 50);
  }
}

init();

// Detecta retorno do checkout hospedado do gateway (cartão).
// /api/orders/:id/return redireciona para cá com ?return=paid|cancelled|notfound&order=ID
function handleCardReturn() {
  try {
    const params = new URLSearchParams(location.search);
    const ret = params.get('return');
    if (!ret) return;
    const orderId = params.get('order');
    // Limpa a URL sem causar reload
    try { history.replaceState({}, '', location.pathname + (location.hash || '')); } catch {}

    if (ret === 'paid') {
      toast(`Pagamento confirmado! ${orderId ? `Pedido ${orderId}` : ''} está liberado.`);
      // Re-fetch e força scroll para o pedido
      DB.getMyOrders().then(() => {
        renderOrders();
        if (orderId) {
          setTimeout(() => {
            const el = document.querySelector(`[data-order-id="${CSS.escape(orderId)}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 200);
        }
      });
    } else if (ret === 'cancelled') {
      toast('Pagamento não concluído. Você pode tentar de novo.', false);
    } else if (ret === 'notfound') {
      toast('Pedido não encontrado. Se você pagou, entre em contato.', false);
    }
  } catch {}
}
