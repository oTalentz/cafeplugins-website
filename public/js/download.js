const $ = (s) => document.querySelector(s);

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHref(url) {
  try {
    const u = new URL(String(url || ''), location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
  } catch {
    return '#';
  }
}

function renderError(title, sub) {
  $('#dlContent').innerHTML = `
    <div class="dl-err-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <div>
      <div class="dl-title">${escHtml(title)}</div>
      <div class="dl-sub">${escHtml(sub)}</div>
    </div>
  `;
}

function renderReady(order) {
  const item = order.items[0];
  const isPaid = order.status === 'pago';
  if (!isPaid) {
    renderError('Pagamento pendente', 'Esta compra ainda não foi confirmada pelo vendedor. Volte mais tarde.');
    return;
  }
  if (!item.downloadUrl) {
    renderError('Link indisponível', 'O vendedor ainda não configurou o link de download deste plugin.');
    return;
  }
  const ic = (item.name || '?').charAt(0).toUpperCase();
  const downloadCount = (order.downloads || []).length;
  $('#dlContent').innerHTML = `
    <div class="dl-ok-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <div>
      <div class="dl-title">Pronto para baixar</div>
      <div class="dl-sub">${downloadCount === 0 ? 'Primeiro download desta compra.' : `Já baixado ${downloadCount}x. Link pessoal e intransferível.`}</div>
    </div>
    <div class="dl-product">
      <div class="dl-product-ic">${escHtml(ic)}</div>
      <div class="dl-product-info">
        <strong>${escHtml(item.name)}</strong>
        <small>Pedido ${escHtml(order.id)}</small>
      </div>
    </div>
    <div class="dl-key">
      <span>Licença</span>
      <code>${escHtml(order.licenseKey)}</code>
    </div>
    <a href="${escHtml(safeHref(item.downloadUrl))}" target="_blank" rel="noopener" id="dlBtn" class="btn btn-primary" style="width:100%; justify-content:center">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      Baixar ${escHtml(item.name)}
    </a>
  `;
  const btn = $('#dlBtn');
  btn.addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    const token = params.get('t') || order.downloadToken;
    DB.logOrderDownload(order.id, token);
  });
}

(async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  if (!token) {
    renderError('Link inválido', 'Esta URL não contém um token de download válido.');
    return;
  }
  const order = await DB.getOrderByToken(token);
  if (!order) {
    renderError('Link não encontrado', 'O token expirou ou não existe. Verifique o link enviado por e-mail.');
    return;
  }
  setTimeout(() => renderReady(order), 400);
})();
