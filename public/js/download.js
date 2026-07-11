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
  const product = DB.getProduct ? DB.getProduct(item.id) : null;
  const ic = (item.name || '?').charAt(0).toUpperCase();
  const downloadCount = order.downloadCount || (order.downloads || []).length;
  const maxDownloads = product && product.maxDownloads ? product.maxDownloads : (order.maxDownloads || 5);
  $('#dlContent').innerHTML = `
    <div class="dl-ok-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <div>
      <div class="dl-title">Pronto para baixar</div>
      <div class="dl-sub">${downloadCount === 0 ? 'Primeiro download desta compra.' : `Baixado ${downloadCount}x de ${maxDownloads}.`}</div>
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
    <button id="dlBtn" class="btn btn-primary" style="width:100%; justify-content:center" ${downloadCount >= maxDownloads ? 'disabled' : ''}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      Baixar ${escHtml(item.name)}
    </button>
  `;
  const btn = $('#dlBtn');
  btn.addEventListener('click', async () => {
    const params = new URLSearchParams(location.search);
    const token = params.get('t') || order.downloadToken;
    if (!token) return;
    try {
      btn.disabled = true;
      const res = await fetch(`/api/orders/${order.id}/download?t=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        renderError('Download bloqueado', data.error || 'Não foi possível baixar o plugin.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const header = res.headers.get('content-disposition') || '';
      const match = header.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `${escHtml(item.name)}.jar`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await DB.logOrderDownload(order.id, token);
      renderReady(order);
    } catch (e) {
      renderError('Erro no download', e.message);
    }
  });
}

(async function init() {
  try { await DB.init(); } catch (e) { console.warn('DB.init failed:', e.message); }
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
