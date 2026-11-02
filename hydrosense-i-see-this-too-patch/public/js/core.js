// js/core.js — shared client core: API wrapper, escaping, toasts/dialogs, shared header/footer,
// theme, and the English ⇄ Tamil engine. Loaded on every page (no inline scripts anywhere: strict CSP).
(function () {
  'use strict';

  // ------------------------------------------------------------------ storage (never throws)
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // ------------------------------------------------------------------ escaping
  window.esc = function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  // ------------------------------------------------------------------ language engine
  const TA = window.HS_TA || { exact: {}, patterns: [] };
  const origText = new WeakMap();   // text node -> English original
  const setText = new WeakMap();    // text node -> Tamil string we wrote
  const origAttr = new WeakMap();   // element -> { attr: English original }
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  let lang = store.get('hs_lang', 'en') === 'ta' ? 'ta' : 'en';
  let titleEn = null;

  function lookup(core) {
    if (Object.prototype.hasOwnProperty.call(TA.exact, core)) return TA.exact[core];
    for (let i = 0; i < TA.patterns.length; i++) {
      const m = core.match(TA.patterns[i][0]);
      if (m) {
        const out = TA.patterns[i][1].apply(null, m.slice(1).map((x) => (x === undefined ? '' : x)));
        if (out) return out;
      }
    }
    return null;
  }
  // Translate a plain JS string (used for toasts / dialogs / document title).
  window.t = function t(s) {
    if (lang !== 'ta' || typeof s !== 'string') return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const hit = lookup(m[2].replace(/\s+/g, ' '));
    return hit == null ? s : m[1] + hit + m[3];
  };

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE', 'PRE']);
  function skipped(el) {
    return !el || SKIP_TAGS.has(el.nodeName) || (el.closest && el.closest('[data-no-tr], .leaflet-control-attribution'));
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (skipped(parent)) return;
    const data = node.data;
    if (setText.has(node) && setText.get(node) === data) return; // already ours
    if (!data.trim()) return;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(data);
    const hit = lookup(m[2].replace(/\s+/g, ' '));
    if (hit == null) return;
    const next = m[1] + hit + m[3];
    origText.set(node, data);
    setText.set(node, next);
    node.data = next;
  }

  function translateAttrs(el) {
    if (!el.closest || el.closest('[data-no-tr], .leaflet-control-attribution')) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      let rec = origAttr.get(el);
      if (rec && rec[a] && rec[a].tr === cur) continue;
      const hit = lookup(cur.replace(/\s+/g, ' ').trim());
      if (hit == null) continue;
      if (!rec) { rec = {}; origAttr.set(el, rec); }
      rec[a] = { en: cur, tr: hit };
      el.setAttribute(a, hit);
    }
    if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button') && el.value) {
      const hit = lookup(el.value.trim()); if (hit) el.value = hit;
    }
  }

  function translateTree(root) {
    if (lang !== 'ta' || !root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    translateAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    while (n) {
      if (n.nodeType === 3) translateTextNode(n); else translateAttrs(n);
      n = w.nextNode();
    }
  }

  function restoreTree() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = w.nextNode();
    while (n) {
      if (n.nodeType === 3) {
        if (origText.has(n) && n.data === setText.get(n)) n.data = origText.get(n);
        origText.delete(n); setText.delete(n);
      } else {
        const rec = origAttr.get(n);
        if (rec) { for (const a in rec) if (n.getAttribute(a) === rec[a].tr) n.setAttribute(a, rec[a].en); origAttr.delete(n); }
      }
      n = w.nextNode();
    }
  }

  const observer = new MutationObserver((muts) => {
    if (lang !== 'ta') return;
    observer.disconnect();
    try {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(translateTree);
        else if (m.type === 'characterData') translateTextNode(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
      }
    } finally { startObserver(); }
  });
  function startObserver() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function applyLang(next, persist) {
    lang = next === 'ta' ? 'ta' : 'en';
    if (persist) store.set('hs_lang', lang);
    document.documentElement.lang = lang;
    observer.disconnect();
    if (titleEn === null) titleEn = document.title;
    if (lang === 'ta') { translateTree(document.body); document.title = window.t(titleEn); }
    else { restoreTree(); document.title = titleEn; }
    startObserver();
    const btn = document.getElementById('langToggleBtn');
    if (btn) { btn.textContent = lang === 'ta' ? 'English' : 'தமிழ்'; btn.setAttribute('aria-label', lang === 'ta' ? 'Switch to English' : 'தமிழுக்கு மாற்று'); }
    window.dispatchEvent(new CustomEvent('hs-lang', { detail: lang }));
  }
  window.hsLang = () => lang;
  window.hsSetLang = (l) => applyLang(l, true);

  // ------------------------------------------------------------------ theme
  function setTheme(th) {
    store.set('hs_theme', th);
    document.documentElement.setAttribute('data-theme', th);
    const b = document.getElementById('themeToggleBtn');
    if (b) b.textContent = th === 'dark' ? '☀️' : '🌙';
    window.dispatchEvent(new CustomEvent('hs-theme', { detail: th }));
  }

  // ------------------------------------------------------------------ API wrapper
  window.api = {
    async request(method, url, body, isForm) {
      const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'HydroSense' } };
      if (body && !isForm) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      else if (body && isForm) opts.body = body;
      let res;
      try { res = await fetch(url, opts); }
      catch (e) { throw new Error('Network error. Please check your connection and try again.'); }
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return data;
    },
    get(url) { return this.request('GET', url); },
    post(url, body) { return this.request('POST', url, body, false); },
    put(url, body) { return this.request('PUT', url, body, false); },
    del(url, body) { return this.request('DELETE', url, body, false); },
    postForm(url, fd) { return this.request('POST', url, fd, true); },
  };

  let mePromise = null;
  window.currentUser = function currentUser(force) {
    if (!mePromise || force) mePromise = api.get('/api/auth/me').then((d) => d.user).catch(() => null);
    return mePromise;
  };
  window.requireAuth = function requireAuth(role) {
    return currentUser().then((u) => {
      if (!u || (role && u.role !== role)) {
        location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
        return null;
      }
      return u;
    });
  };
  window.statusLabel = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  window.fmtDate = function fmtDate(d) {
    try {
      const dt = new Date(String(d).includes('T') ? d : String(d).replace(' ', 'T') + 'Z');
      if (isNaN(dt)) return d;
      // Same numeric format in both languages (dd-mm-yyyy, 24 h) so dates never need re-rendering when the language changes.
      return dt.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
    } catch (e) { return d; }
  };
  window.fmtDay = function fmtDay(d) {
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-'); } catch (e) { return d; }
  };

  // ------------------------------------------------------------------ toast + dialogs
  function toastWrap() {
    let w = document.getElementById('toastWrap');
    if (!w) { w = document.createElement('div'); w.id = 'toastWrap'; w.className = 'toast-wrap'; w.setAttribute('role', 'status'); w.setAttribute('aria-live', 'polite'); document.body.appendChild(w); }
    return w;
  }
  window.toast = function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.textContent = msg;
    toastWrap().appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6500 : 4200);
  };
  window.confirmDialog = function confirmDialog({ title, message, okText, danger }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-icon">${danger ? '⚠️' : '❓'}</div>
        <h3>${esc(title || 'Are you sure?')}</h3><p>${esc(message || '')}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" data-act="no">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${esc(okText || 'Confirm')}</button>
        </div></div>`;
      const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      wrap.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (a) done(a.dataset.act === 'yes'); else if (e.target === wrap) done(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      wrap.querySelector('[data-act="no"]').focus();
    });
  };
  // Show an error from a caught exception, in the current language.
  window.showError = (e) => toast(e && e.message ? e.message : 'Something went wrong. Please try again.', 'error');

  // ------------------------------------------------------------------ shared header / footer
  const LOGO = `<svg class="nav__logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="hsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs><path d="M16 2.5C16 2.5 5.5 14 5.5 20.2a10.5 10.5 0 0 0 21 0C26.5 14 16 2.5 16 2.5Z" fill="url(#hsg)"/><path d="M10.5 20.5c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.8 0 2.4-1 3-.6" fill="none" stroke="#04201d" stroke-width="1.7" stroke-linecap="round" opacity=".7"/></svg>`;
  const NAV = [
    ['/index.html', 'Home'], ['/report.html', 'Report Issue'], ['/track.html', 'Track'], ['/community.html', 'Community'],
    ['/map.html', 'Map'], ['/water-bodies.html', 'Water Bodies'], ['/news.html', 'News'],
  ];

  function buildHeader() {
    const host = document.getElementById('hs-header');
    if (!host) return;
    const here = location.pathname === '/' ? '/index.html' : location.pathname;
    host.outerHTML = `<nav class="nav" id="siteNav" aria-label="Main">
      <div class="nav__inner">
        <a href="/" class="nav__brand" aria-label="HydroSense home">${LOGO}<span data-no-tr>HydroSense</span></a>
        <ul class="nav__links" id="navLinks">${NAV.map(([h, l]) => `<li><a href="${h}"${here === h ? ' class="active" aria-current="page"' : ''}>${l}</a></li>`).join('')}</ul>
        <div class="nav__controls">
          <button class="nav__icon-btn" id="themeToggleBtn" type="button" aria-label="Toggle dark / light theme" data-no-tr></button>
          <button class="nav__icon-btn" id="langToggleBtn" type="button" data-no-tr></button>
        </div>
        <div class="nav__cta" id="navCta"></div>
        <button class="nav__icon-btn nav__toggle" id="navToggle" type="button" aria-label="Menu" aria-expanded="false" data-no-tr>☰</button>
      </div></nav>`;
    document.getElementById('themeToggleBtn').addEventListener('click', () => setTheme(store.get('hs_theme', 'dark') === 'dark' ? 'light' : 'dark'));
    document.getElementById('langToggleBtn').addEventListener('click', () => applyLang(lang === 'ta' ? 'en' : 'ta', true));
    const nav = document.getElementById('siteNav');
    document.getElementById('navToggle').addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      document.getElementById('navToggle').setAttribute('aria-expanded', String(open));
    });
    setTheme(store.get('hs_theme', 'dark'));
    fillNavCta().then(fitNav);
    window.addEventListener('resize', fitNav);
    window.addEventListener('hs-lang', () => setTimeout(fitNav, 0));
  }

  // Collapse the menu into a hamburger whenever the links don't fit on one line.
  function fitNav() {
    const nav = document.getElementById('siteNav');
    if (!nav) return;
    nav.classList.remove('compact', 'tiny');
    const inner = nav.querySelector('.nav__inner');
    if (inner.scrollWidth > inner.clientWidth + 1) {
      nav.classList.add('compact');
      // Still too wide (small phones): move the login / dashboard buttons into the menu.
      if (inner.scrollWidth > inner.clientWidth + 1) nav.classList.add('tiny');
    } else nav.classList.remove('open');
  }

  async function fillNavCta() {
    const slot = document.getElementById('navCta');
    if (!slot) return;
    const user = await currentUser();
    if (!user) {
      slot.innerHTML = '<a class="btn btn-ghost btn-sm" href="/login.html">Log in</a><a class="btn btn-primary btn-sm hide-sm" href="/register.html">Sign up</a>';
    } else {
      const dash = user.role === 'authority' ? '/authority-dashboard.html' : '/dashboard.html';
      slot.innerHTML = `<a class="btn btn-ghost btn-sm" href="${dash}">${user.role === 'authority' ? 'Authority dashboard' : 'My reports'}</a>
        <a class="btn btn-outline btn-sm hide-sm" href="/settings.html">Settings</a>`;
    }
    // Same links inside the hamburger menu, shown only when the header is too narrow for the buttons.
    const ul = document.getElementById('navLinks');
    if (ul) {
      ul.querySelectorAll('.mobile-only').forEach((n) => n.remove());
      const items = user
        ? [[user.role === 'authority' ? '/authority-dashboard.html' : '/dashboard.html', user.role === 'authority' ? 'Authority dashboard' : 'My reports'], ['/settings.html', 'Settings']]
        : [['/login.html', 'Log in'], ['/register.html', 'Sign up']];
      ul.insertAdjacentHTML('beforeend', items.map(([h, l]) => `<li class="mobile-only"><a href="${h}">${l}</a></li>`).join(''));
    }
    if (lang === 'ta') { translateTree(slot); if (ul) translateTree(ul); }
    fitNav();
  }

  function buildFooter() {
    const host = document.getElementById('hs-footer');
    if (!host) return;
    host.outerHTML = `<footer class="footer"><div class="container">
      <div class="footer__grid">
        <div><a href="/" class="nav__brand" style="margin-bottom:10px;" aria-label="HydroSense home">${LOGO}<span data-no-tr>HydroSense</span></a>
          <p>HydroSense — a citizen-powered water-body monitoring and environmental accountability platform.</p></div>
        <div><h5>Explore</h5><a href="/map.html">GIS Map</a><a href="/water-bodies.html">Water Bodies</a><a href="/news.html">Water-Body News</a><a href="/track.html">Track a Report</a><a href="/community.html">Community Reports</a></div>
        <div><h5>About</h5><a href="/about.html">About</a><a href="/faq.html">FAQ</a><a href="/contact.html">Contact</a><a href="/report.html">Report a Water Issue</a></div>
      </div>
      <div class="footer__bottom"><span>© ${new Date().getFullYear()} HydroSense</span><span>AI assists. It never decides.</span></div>
    </div></footer>`;
  }

  // ------------------------------------------------------------------ boot
  function revealOnScroll() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    document.documentElement.classList.add('reveal-ready');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  function boot() {
    buildHeader();
    buildFooter();
    const main = document.querySelector('main');
    if (main && !main.id) main.id = 'main';
    if (main && !document.querySelector('.skip-link')) {
      const a = document.createElement('a'); a.href = '#main'; a.className = 'skip-link'; a.textContent = 'Skip to content';
      document.body.insertBefore(a, document.body.firstChild);
    }
    applyLang(lang, false);
    revealOnScroll();
    window.dispatchEvent(new Event('hs-ready'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
