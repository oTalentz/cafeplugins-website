// =============================================================
//  cafe plugins — Sistema de Loading global
//  - Loader bar no topo (para requests em background)
//  - Overlay full-screen (para ações críticas)
//  - Patch no fetch (auto-mostra/esconde)
//  - Helpers para spinners em botões e skeletons em listas
// =============================================================

(function() {
  let _barEl = null;
  let _overlayEl = null;
  let _activeRequests = 0;
  let _overlayShownAt = 0;
  let _overlayMinDuration = 350; // evita flash rápido
  let _barVisibleTimer = null;
  const _barHideDelay = 250; // espera 250ms antes de esconder (evita flicker)

  function ensureBar() {
    if (_barEl) return _barEl;
    _barEl = document.createElement('div');
    _barEl.className = 'global-loader';
    document.body.appendChild(_barEl);
    return _barEl;
  }

  function ensureOverlay() {
    if (_overlayEl) return _overlayEl;
    _overlayEl = document.createElement('div');
    _overlayEl.className = 'global-overlay';
    _overlayEl.innerHTML = `
      <div class="global-overlay-content">
        <div class="spinner lg"></div>
        <div class="text" data-overlay-text>Carregando…</div>
        <div class="subtext" data-overlay-sub></div>
      </div>`;
    document.body.appendChild(_overlayEl);
    return _overlayEl;
  }

  function showBar() {
    const bar = ensureBar();
    bar.classList.add('visible', 'indeterminate');
    if (_barVisibleTimer) clearTimeout(_barVisibleTimer);
    _barVisibleTimer = null;
  }

  function hideBar() {
    if (_barVisibleTimer) clearTimeout(_barVisibleTimer);
    _barVisibleTimer = setTimeout(() => {
      if (_activeRequests > 0) return;
      if (_barEl) _barEl.classList.remove('visible', 'indeterminate', 'determinate');
    }, _barHideDelay);
  }

  function showOverlay(text = 'Carregando…', sub = '') {
    const ov = ensureOverlay();
    ov.querySelector('[data-overlay-text]').textContent = text;
    ov.querySelector('[data-overlay-sub]').textContent = sub;
    ov.classList.add('visible');
    _overlayShownAt = Date.now();
  }

  function hideOverlay() {
    if (!_overlayEl) return;
    const elapsed = Date.now() - _overlayShownAt;
    const wait = Math.max(0, _overlayMinDuration - elapsed);
    setTimeout(() => {
      if (_overlayEl) _overlayEl.classList.remove('visible');
    }, wait);
  }

  // ===== API pública =====
  const Loading = {
    // Bar
    showBar(text) { showBar(); },
    hideBar() { hideBar(); },
    setProgress(pct) {
      const bar = ensureBar();
      bar.classList.remove('indeterminate');
      bar.classList.add('determinate');
      bar.style.setProperty('--progress', `${Math.max(0, Math.min(100, pct))}%`);
    },

    // Overlay
    showOverlay(text, sub) { showOverlay(text, sub); },
    hideOverlay() { hideOverlay(); },

    // Auto-tracking de requests (chamado pelo data.js)
    requestStart() {
      _activeRequests++;
      if (_activeRequests > 0) showBar();
    },
    requestEnd() {
      _activeRequests = Math.max(0, _activeRequests - 1);
      if (_activeRequests === 0) hideBar();
    },

    // Atalho: executar função com overlay
    async withOverlay(text, fn, sub) {
      showOverlay(text, sub);
      try {
        return await fn();
      } finally {
        hideOverlay();
      }
    },

    // Atalho: spinner em botão
    buttonStart(btn, label = '') {
      if (!btn) return () => {};
      const originalHtml = btn.innerHTML;
      const originalText = btn.textContent;
      btn.classList.add('btn-loading');
      btn.disabled = true;
      if (label) btn.setAttribute('data-loading-label', label);
      return function buttonEnd() {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
        if (btn.hasAttribute('data-loading-label')) {
          btn.textContent = btn.getAttribute('data-loading-label');
          btn.removeAttribute('data-loading-label');
        } else {
          btn.innerHTML = originalHtml;
          if (!btn.innerHTML || btn.innerHTML === originalHtml) {
            btn.textContent = originalText;
          }
        }
      };
    },

    // Skeleton helpers
    skeleton(text = 'Carregando…', lines = 3) {
      return Array.from({ length: lines }, (_, i) =>
        `<div class="skeleton text" style="width:${100 - i * 8}%">${text}</div>`
      ).join('');
    },
    skeletonCards(count = 4) {
      // Layout LATERAL: cada placeholder é uma linha horizontal cheia
      // (avatar à esquerda + 2 textos à direita). Sem empilhamento vertical.
      return `
        <div class="skeleton-list">
          ${Array.from({ length: count }, () => `
            <div class="skeleton-row">
              <div class="skeleton avatar"></div>
              <div class="skeleton-row-content">
                <div class="skeleton text" style="width:35%"></div>
                <div class="skeleton text" style="width:80%"></div>
              </div>
            </div>`).join('')}
        </div>`;
    },
    skeletonTable(rows = 5) {
      return `
        <div class="tab-loading-skeleton">
          ${Array.from({ length: rows }, () => `
            <div class="skeleton-row">
              <div class="skeleton avatar"></div>
              <div class="skeleton text"></div>
              <div class="skeleton text" style="flex:0.5"></div>
            </div>`).join('')}
        </div>`;
    },
    section(text = 'Carregando…') {
      return `<div class="section-loading"><div class="spinner lg"></div><div>${text}</div></div>`;
    }
  };

  // Patch no fetch (auto-track)
  if (window.fetch && !window.fetch.__loadingPatched) {
    const origFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      // Não mostra loading para algumas chamadas internas (ex: heartbeat, analytics)
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('heartbeat') || url.includes('analytics')) {
        return origFetch(input, init);
      }
      Loading.requestStart();
      return origFetch(input, init).finally(() => Loading.requestEnd());
    };
    window.fetch.__loadingPatched = true;
  }

  window.Loading = Loading;
})();
