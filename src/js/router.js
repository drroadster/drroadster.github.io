// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · router.js
//  Client-side page routing + toast notification system.
//
//  Pages are identified by their #page-{name} element.
//  Navigation updates:
//   • The active .page element (show/hide)
//   • All [data-page] nav items in topbar + tabbar
//   • The browser hash (#overview, #transactions, etc.)
//   • The context-aware FAB behaviour
// ═══════════════════════════════════════════════════════

/** @typedef {'overview'|'transactions'|'assets'|'analysis'|'fire'} PageName */

// ── Internal state ────────────────────────────────────
/** @type {PageName} */
let _current = 'overview';

/** Page-change subscribers. */
const _subscribers = new Set();

// ── Public API ────────────────────────────────────────

/**
 * Navigate to a page.
 * @param {PageName} name
 * @param {boolean} [pushHash=true]  update URL hash
 */
export function navigate(name, pushHash = true) {
  if (name === _current) return;
  _current = name;

  // Swap active page
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === `page-${name}`)
  );

  // Sync nav items (both topbar + tabbar share data-page attribute)
  document.querySelectorAll('[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === name)
  );

  // Scroll main content to top
  const main = document.getElementById('mainContent');
  if (main) main.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Update URL hash (makes browser back button work)
  if (pushHash) history.pushState({ page: name }, '', `#${name}`);

  // Notify subscribers (pages use this to trigger lazy renders)
  _subscribers.forEach(cb => {
    try { cb(name); } catch (e) { console.error('[router] subscriber error', e); }
  });
}

/**
 * Subscribe to page changes.
 * Callback fires immediately with the current page.
 * @param {(page: PageName) => void} cb
 * @returns {() => void}  unsubscribe
 */
export function onNavigate(cb) {
  _subscribers.add(cb);
  try { cb(_current); } catch (_) {}
  return () => _subscribers.delete(cb);
}

/** Current active page name. */
export function currentPage() { return _current; }

/**
 * Context-aware FAB action.
 * • On 'transactions' page → open quick-add transaction modal
 * • On 'assets' page       → open add-asset modal
 * • Elsewhere              → open choice modal
 */
export function fabAction() {
  // These hook functions are registered by the page modules
  const hooks = {
    transactions: '__rdstr_openTxModal',
    assets:       '__rdstr_openAssetModal',
  };
  const hook = hooks[_current];
  if (hook && typeof window[hook] === 'function') {
    window[hook]();
  } else if (typeof window.__rdstr_openAddChoice === 'function') {
    window.__rdstr_openAddChoice();
  }
}

/**
 * Initialise router: read hash on page load, handle popstate.
 */
export function initRouter() {
  const validPages = ['overview', 'transactions', 'assets', 'analysis', 'fire'];

  // Read initial hash
  const hash = window.location.hash.replace('#', '');
  if (validPages.includes(hash)) {
    _current = hash;
  } else {
    // Write canonical hash
    history.replaceState({ page: _current }, '', `#${_current}`);
  }

  // Set initial active states without triggering a full navigate()
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === `page-${_current}`)
  );
  document.querySelectorAll('[data-page]').forEach(el =>
    el.classList.toggle('active', el.dataset.page === _current)
  );

  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    const page = e.state?.page ?? 'overview';
    if (validPages.includes(page)) navigate(page, false);
  });
}

// ── Toast ─────────────────────────────────────────────
//  CSS-animation driven — immune to JS timer throttling.
//  JS only adds/removes the class and listens for animationend.

let _toastEl = null;

function _getToastEl() {
  if (!_toastEl) _toastEl = document.getElementById('toast');
  return _toastEl;
}

// Wire up animationend once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _wireToast);
} else {
  _wireToast();
}
function _wireToast() {
  const el = _getToastEl();
  if (!el) return;
  el.addEventListener('animationend', () => el.classList.remove('toast-run'));
}

/**
 * Show a toast notification.
 * @param {string} msg
 */
export function showToast(msg) {
  const el = _getToastEl();
  if (!el) return;
  // Remove class first (force reflow) so re-triggering restarts animation
  el.classList.remove('toast-run');
  el.textContent = msg;
  void el.offsetWidth;  // reflow
  el.classList.add('toast-run');
}
