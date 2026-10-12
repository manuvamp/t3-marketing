// Fetched and run inside T3 Code's page by the one-line T3 patch (patches/toggle-loader.cjs).
// Splits T3 into two modes. Clicking the "T3 Code" wordmark (or Ctrl+Alt+M) switches between them:
//  - Coding: plain T3, showing only chats created in Coding mode.
//  - Marketing: T3's own left bar showing only chats created in Marketing mode (any folder), a red LABEL in place of
//    the wordmark, and your dashboard (served by server/) in the main area. Clicking a chat (or T3's new-chat button)
//    shows that real T3 chat; "Dashboard" returns. A chat keeps the mode it was created in (server/t3-modes.mjs
//    decides, from the switches reported here).
// Chats stay 100% T3: this only hides rows and lays the dashboard over the main area.
// It re-fetches itself every 30s and swaps in a newer copy, so updates don't need a T3 restart.
(() => {
  const SRC = document.currentScript?.textContent || '';
  const prev = window.__t3mToggle;
  const kept = prev?.overlay || null;
  prev?.destroy?.(true); // an older copy hands over its overlay (and its loaded dashboard)
  const ORIGIN = 'http://127.0.0.1:4780';
  const RED = '#e53125';
  const LABEL = 'Marketing'; // shown in red in place of T3's wordmark while in Marketing mode
  const cleanups = [];
  const timers = [];
  let mode = localStorage.getItem('t3m:mode') === 'marketing' ? 'marketing' : 'coding';
  let view = 'dashboard'; // in Marketing mode: the dashboard or a T3 chat
  let split = { marketing: new Set(), coding: new Set() };
  let splitAt = 0;
  let splitErr = 'not fetched';
  let overlay = null;
  let frame = null;
  let dashBtn = null;

  const pill = (title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:6px;'
      + `border:1px solid rgba(229,49,37,.6);background:transparent;color:${RED};font:600 11.5px/18px system-ui,sans-serif;`
      + 'cursor:pointer;-webkit-app-region:no-drag;white-space:nowrap;flex:none;margin-left:6px;';
    return b;
  };
  const tell = (msg) => { try { frame?.contentWindow?.postMessage(msg, ORIGIN); } catch { /* not ready */ } };
  const showing = () => mode === 'marketing' && view === 'dashboard';

  function ensureOverlay() {
    if (overlay) return;
    if (kept?.querySelector('iframe')?.src.startsWith(ORIGIN)) {
      overlay = kept;
      frame = overlay.querySelector('iframe');
      frame.src = `${ORIGIN}/?embed=t3&v=${Date.now()}#home`; // reload once, so the dashboard picks up a newer version too
    } else {
      kept?.remove();
      overlay = document.createElement('div');
      overlay.id = 't3m-overlay';
      frame = document.createElement('iframe');
      frame.src = `${ORIGIN}/?embed=t3#home`;
      frame.title = 'Dashboard';
      frame.allow = 'clipboard-read; clipboard-write';
      frame.style.cssText = 'width:100%;height:100%;border:0;display:block;-webkit-app-region:no-drag;';
      overlay.append(frame);
      document.body.appendChild(overlay);
    }
    // no-drag: T3's top bars are window drag regions, which would swallow clicks on the dashboard's top strip.
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:45;background:#0b0b0c;display:none;-webkit-app-region:no-drag;';
    const onLoad = () => { tell('t3m:host'); tell(showing() ? 't3m:show' : 't3m:hide'); };
    frame.addEventListener('load', onLoad);
    cleanups.push(() => frame.removeEventListener('load', onLoad));
    onLoad();
  }

  // The dashboard covers only T3's main area, right of its left bar (or everything when the bar is collapsed).
  // It is created the first time Marketing mode shows it, and measures only while showing (no work in Coding mode).
  function layout() {
    if (showing()) {
      ensureOverlay();
      const r = sideEl?.isConnected ? sideEl.getBoundingClientRect() : null;
      overlay.style.left = `${r && r.width > 60 && r.left >= -1 ? Math.round(r.right) : 0}px`;
    }
    const want = showing() ? 'block' : 'none';
    if (overlay && overlay.style.display !== want) { overlay.style.display = want; tell(want === 'block' ? 't3m:show' : 't3m:hide'); }
    // Marketing mode shows a red LABEL in place of T3's "T3 Code" wordmark, so the mode is obvious at a glance.
    // T3's own wordmark is only hidden (never edited), so React keeps owning it.
    for (const a of document.querySelectorAll('a[aria-label="Go to threads"]')) {
      const tip = mode === 'marketing' ? 'Switch to Coding (Ctrl+Alt+M)' : 'Switch to Marketing (Ctrl+Alt+M)';
      if (a.title !== tip) a.title = tip;
      const own = a.firstElementChild && a.firstElementChild.id !== 't3m-brand' ? a.firstElementChild : null;
      let brand = a.querySelector('#t3m-brand');
      if (mode === 'marketing' && !brand) {
        brand = document.createElement('span');
        brand.id = 't3m-brand';
        brand.textContent = LABEL;
        brand.className = own?.className || '';
        brand.style.color = RED;
        a.append(brand);
      }
      if (mode !== 'marketing') brand?.remove();
      const want = mode === 'marketing' ? 'none' : '';
      if (own && own.style.display !== want) own.style.display = want;
    }
    if (dashBtn) {
      dashBtn.style.display = mode === 'marketing' ? 'inline-flex' : 'none';
      dashBtn.style.background = showing() ? 'rgba(229,49,37,.15)' : 'transparent';
    }
  }

  async function refreshSplit() {
    if (Date.now() - splitAt < 3000) return;
    splitAt = Date.now();
    try {
      // Sending the mode also records each switch, so a chat created now lands in this mode.
      const s = await (await fetch(`${ORIGIN}/api/t3/split?mode=${mode}`, { cache: 'no-store' })).json();
      split = { marketing: new Set(s.marketing), coding: new Set(s.coding) };
      splitErr = '';
      filterRows();
    } catch (e) { splitErr = String(e?.message || e); /* server down: show everything */ }
    report();
  }

  // Tells the companion server what the toggle sees on T3's page (counts, plus up to 3 labels of chats it can't place), for troubleshooting:
  // GET /api/t3/last-report on the dashboard server shows the latest one.
  let reportAt = 0;
  function report() {
    if (Date.now() - reportAt < 20000) return;
    reportAt = Date.now();
    const list = rows();
    const q = new URLSearchParams({
      mode, view, splitErr,
      rows: list.length, hidden: list.filter((r) => r.box.style.display === 'none').length,
      marketing: list.filter((r) => r.marketing === true).length, unknown: list.filter((r) => r.marketing === null).length,
      unknownLabels: list.filter((r) => r.marketing === null).slice(0, 3).map((r) => r.box.querySelector('[aria-label]')?.getAttribute('aria-label')).join(' | '),
      sidebar: !!document.querySelector('[data-sidebar="sidebar"]'),
    });
    fetch(`${ORIGIN}/api/t3/report?${q}`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  }

  // The chat id behind a row. T3's card rows carry no id in the DOM, so it's read (read-only) from the `thread`
  // prop React gave the row; T3's compact rows have it in their data-testid.
  function threadId(box) {
    const tagged = box.querySelector('[data-testid^="thread-row-"]');
    if (tagged) return tagged.dataset.testid.slice('thread-row-'.length);
    const el = box.querySelector('[role="button"]') || box;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let f = key && el[key], i = 0; f && i < 25; f = f.return, i++) {
      const id = f.memoizedProps?.thread?.id;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  // T3's chat rows as [{box, marketing}], marketing = true/false, or null when the chat isn't known yet.
  function rows() {
    const out = [];
    for (const box of document.querySelectorAll('li[data-thread-item]')) {
      const id = threadId(box);
      out.push({ box, id, marketing: split.marketing.has(id) ? true : split.coding.has(id) ? false : null });
    }
    return out;
  }

  // Show only the current mode's chats. A chat we don't know yet (just created) stays visible and triggers a refresh.
  function filterRows() {
    for (const { box, marketing } of rows()) {
      if (marketing === null && splitErr === '') refreshSplit();
      const hide = marketing !== null && (mode === 'marketing' ? !marketing : marketing);
      const want = hide ? 'none' : '';
      if (box.style.display !== want) box.style.display = want;
    }
  }

  function setMode(m) {
    mode = m;
    view = 'dashboard';
    localStorage.setItem('t3m:mode', m);
    filterRows();
    layout();
    splitAt = 0;
    refreshSplit();
    reportAt = 0;
    setTimeout(report, 300);
  }

  // The Dashboard pill at the right end of T3's "T3 Code" header row (its wordmark is <a aria-label="Go to threads">).
  function place() {
    if (!dashBtn) {
      dashBtn = pill('Dashboard');
      dashBtn.id = 't3m-dash';
      dashBtn.textContent = 'Dashboard';
      dashBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); view = 'dashboard'; layout(); });
    }
    if (dashBtn.isConnected) return;
    for (const a of document.querySelectorAll('a[aria-label="Go to threads"]')) {
      const r = a.getBoundingClientRect();
      if (!r.width || r.left > 420 || r.top > 90) continue;
      let row = a.parentElement;
      for (let i = 0; row && i < 3 && !(getComputedStyle(row).display.includes('flex') && row.getBoundingClientRect().width > r.width + 40); i++) row = row.parentElement;
      row = row || a.parentElement;
      dashBtn.style.marginLeft = 'auto';
      row.append(dashBtn);
      return;
    }
  }

  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  // Clicking the wordmark switches modes instead of T3's "go to threads" (capture phase, so T3's router never sees it).
  // Opening a chat (or starting one) in Marketing mode shows that T3 chat instead of the dashboard.
  on(document, 'click', (e) => {
    if (!e.target.closest) return;
    if (e.button === 0 && e.target.closest('a[aria-label="Go to threads"]')) { e.preventDefault(); e.stopPropagation(); setMode(mode === 'marketing' ? 'coding' : 'marketing'); return; }
    if (mode !== 'marketing') return;
    if (e.target.closest('li[data-thread-item], [data-testid^="thread-row-"], [data-testid="new-thread-button"], [aria-label^="New thread in"]')) { view = 'chat'; layout(); }
  }, true);
  on(window, 'keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); setMode(mode === 'marketing' ? 'coding' : 'marketing'); }
    // T3's own new-chat shortcut also leaves the dashboard.
    if (mode === 'marketing' && e.ctrlKey && !e.altKey && e.code === 'KeyN') { view = 'chat'; layout(); }
  }, true);
  on(window, 'message', (e) => {
    if (e.origin !== ORIGIN) return;
    if (e.data === 't3m:close') setMode('coding');
  }, true);
  on(window, 'resize', () => { if (showing()) layout(); });

  // Event-driven, so it costs nothing while T3 streams a chat: rows are re-filtered only when T3's left bar
  // changes (batched), and the dashboard is re-measured only when that bar is resized.
  let sideEl = null;
  let filterT = 0;
  const mo = new MutationObserver(() => { if (!filterT) filterT = setTimeout(() => { filterT = 0; filterRows(); }, 150); });
  const ro = new ResizeObserver(() => { if (showing()) layout(); });
  cleanups.push(() => { mo.disconnect(); ro.disconnect(); clearTimeout(filterT); });
  function watch() {
    if (!dashBtn?.isConnected) { place(); layout(); } // T3 re-rendered its header: re-add the pill and the red tint
    if (sideEl?.isConnected) return;
    sideEl = document.querySelector('[data-sidebar="sidebar"]');
    mo.disconnect();
    ro.disconnect();
    if (!sideEl) return;
    mo.observe(sideEl, { childList: true, subtree: true });
    ro.observe(sideEl);
    filterRows();
    layout();
  }

  // Self-update: when the server serves a newer version of this file, run it (it replaces this copy).
  async function checkUpdate() {
    if (document.visibilityState !== 'visible') return;
    try {
      const r = await fetch(`${ORIGIN}/t3-toggle.js`, { cache: 'no-store' });
      const text = r.ok ? await r.text() : '';
      if (text && SRC && text !== SRC) {
        const s = document.createElement('script');
        s.textContent = text;
        document.head.append(s);
      }
    } catch { /* server is down: keep the current copy */ }
  }

  window.__t3mToggle = {
    destroy(keepOverlay) {
      for (const t of timers) clearInterval(t);
      for (const c of cleanups) c();
      dashBtn?.remove();
      for (const { box } of rows()) box.style.display = '';
      for (const el of document.querySelectorAll('#t3m-brand')) el.remove();
      for (const a of document.querySelectorAll('a[aria-label="Go to threads"]')) { a.removeAttribute('title'); if (a.firstElementChild) a.firstElementChild.style.display = ''; }
      if (!keepOverlay) overlay?.remove();
    },
    get overlay() { return overlay; },
  };

  const start = () => {
    if (kept) ensureOverlay(); // adopt (and hide or reposition) an older copy's dashboard
    refreshSplit();
    watch();
    layout();
    // Light housekeeping only: re-attach after T3 re-renders its header or left bar, pick up new chats' projects,
    // and look for a newer copy of this file.
    const visible = () => document.visibilityState === 'visible';
    timers.push(setInterval(watch, 2000), setInterval(() => { if (visible()) { splitAt = 0; refreshSplit(); } }, 30000), setInterval(checkUpdate, 30000));
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
