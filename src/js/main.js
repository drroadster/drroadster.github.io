// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · main.js
//  Application entry point. Wires every module together.
//  Load order matters: config has no deps, then theme/i18n,
//  then auth/db (Firebase), then store, then router, then
//  pages, then the app-level glue (FAB, auth UI, deep-link).
// ═══════════════════════════════════════════════════════

import { initTheme, setTheme, getTheme } from './theme.js';
import { initI18n, toggleLang, t } from './i18n.js';
import { initStore, reloadFromStorage } from './store.js';
import { initRouter, navigate, onNavigate, fabAction, showToast, currentPage } from './router.js';

import { initOverviewPage,     render as renderOverview }     from './pages/overview.js';
import { initTransactionsPage, render as renderTransactions, openTxModal } from './pages/transactions.js';
import { initAssetsPage,       render as renderAssets,       openAssetModal } from './pages/assets.js';
import { initAnalysisPage,     render as renderAnalysis }     from './pages/analysis.js';

import {
  onAuthChange, getCurrentUser, registerWithEmail, loginWithEmail,
  logout, sendReset,
} from './auth.js';
import { syncToCloud, loadCloudData, onSyncStatus, getLastSyncDate, scheduleSyncToCloud } from './db.js';

import { nowAsDatetimeLocal, pad2 } from './utils.js';

// ════════════════════════════════════════════════════
//  1. THEME + LANGUAGE
// ════════════════════════════════════════════════════

initTheme();
initI18n();

document.querySelectorAll('[data-theme-opt]').forEach(btn => {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeOpt));
});
document.querySelectorAll('[data-lang-btn]').forEach(btn => {
  btn.addEventListener('click', toggleLang);
});

// Charts need to re-render when theme/lang changes (colors/labels differ)
window.__rdstr_refreshChartsForTheme = function () {
  const page = currentPage();
  if (page === 'overview')     renderOverview();
  else if (page === 'assets')  renderAssets();
  else if (page === 'analysis') renderAnalysis();
  // transactions page has no charts
};

// ════════════════════════════════════════════════════
//  2. DATA STORE
// ════════════════════════════════════════════════════

initStore();

// Whenever any store write happens, schedule a debounced cloud sync
// (only takes effect if a user is logged in — see scheduleSyncToCloud).
window.__rdstr_onStoreWrite = function () {
  const user = getCurrentUser();
  if (user) scheduleSyncToCloud(user.uid);
};

// ════════════════════════════════════════════════════
//  3. ROUTER + PAGES
// ════════════════════════════════════════════════════

initRouter();

initOverviewPage();
initTransactionsPage();
initAssetsPage();
initAnalysisPage();

// Wire nav buttons (topbar + tabbar share [data-page] attribute)
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
});

// FAB (both desktop standalone + mobile tab-bar slot)
document.getElementById('fabDesktop')?.addEventListener('click', fabAction);
document.getElementById('fabTab')?.addEventListener('click', fabAction);

// Top-bar "+ New" button (desktop) — same context-aware behaviour as FAB
document.getElementById('topAddBtn')?.addEventListener('click', fabAction);

// Initial render of the landing page
renderOverview();

// ════════════════════════════════════════════════════
//  4. ADD-CHOICE MODAL (overview/analysis pages → pick tx or asset)
// ════════════════════════════════════════════════════

window.__rdstr_openAddChoice = function () {
  document.getElementById('choiceModal')?.classList.add('open');
};
document.getElementById('choiceModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'choiceModal') closeChoiceModal();
});
function closeChoiceModal() {
  document.getElementById('choiceModal')?.classList.remove('open');
}
document.getElementById('choiceTx')?.addEventListener('click', () => {
  closeChoiceModal();
  openTxModal();
});
document.getElementById('choiceAsset')?.addEventListener('click', () => {
  closeChoiceModal();
  openAssetModal();
});

// ════════════════════════════════════════════════════
//  5. AUTH UI
// ════════════════════════════════════════════════════

let _authMode = 'login'; // 'login' | 'register' | 'reset'

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  if (getCurrentUser()) renderLoggedInSection();
  else switchAuthMode('login');
  modal.classList.add('open');
}
function closeAuthModal() {
  document.getElementById('authModal')?.classList.remove('open');
}
document.getElementById('authModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'authModal') closeAuthModal();
});

document.querySelectorAll('[data-auth-trigger]').forEach(btn => {
  btn.addEventListener('click', openAuthModal);
});

function switchAuthMode(mode) {
  _authMode = mode;
  clearAuthError();

  const els = {
    tabBar:    document.getElementById('authTabBar'),
    loggedIn:  document.getElementById('loggedInSection'),
    nameField: document.getElementById('authNameField'),
    pwdField:  document.getElementById('authPasswordField'),
    forgotBtn: document.getElementById('forgotPwdBtn'),
    reset:     document.getElementById('resetSection'),
    submitBtn: document.getElementById('authSubmitBtn'),
    modeDesc:  document.getElementById('authModeDesc'),
    tabLogin:  document.getElementById('tabLogin'),
    tabReg:    document.getElementById('tabRegister'),
  };

  els.loggedIn.style.display = 'none';
  els.tabBar.style.display   = '';
  els.reset.style.display    = 'none';
  els.submitBtn.style.display = '';
  els.forgotBtn.style.display = '';

  if (mode === 'login') {
    els.nameField.style.display = 'none';
    els.pwdField.style.display  = '';
    els.submitBtn.querySelector('span').textContent = t('authLogin');
    els.modeDesc.textContent = t('authLoginDesc');
    els.tabLogin.classList.add('active'); els.tabReg.classList.remove('active');
  } else if (mode === 'register') {
    els.nameField.style.display = '';
    els.pwdField.style.display  = '';
    els.submitBtn.querySelector('span').textContent = t('authRegister');
    els.modeDesc.textContent = t('authRegisterDesc');
    els.tabLogin.classList.remove('active'); els.tabReg.classList.add('active');
  } else if (mode === 'reset') {
    els.tabBar.style.display    = 'none';
    els.submitBtn.style.display = 'none';
    els.forgotBtn.style.display = 'none';
    els.reset.style.display     = '';
    els.modeDesc.textContent    = t('authForgot');
  }
}

function renderLoggedInSection() {
  const user = getCurrentUser();
  if (!user) return;
  clearAuthError();

  document.getElementById('authTabBar').style.display    = 'none';
  document.getElementById('loggedInSection').style.display = '';
  document.getElementById('authSubmitBtn').style.display   = 'none';
  document.getElementById('forgotPwdBtn').style.display    = 'none';
  document.getElementById('authNameField').style.display   = 'none';
  document.getElementById('authPasswordField').style.display = 'none';
  document.getElementById('resetSection').style.display    = 'none';
  document.getElementById('authModeDesc').textContent      = '已登录';

  const initial = (user.displayName || user.email || '?')[0].toUpperCase();
  document.getElementById('authUserCard').innerHTML = `
    <div class="auth-avatar">${initial}</div>
    <div>
      <div class="auth-user-name">${_esc(user.displayName || '用户')}</div>
      <div class="auth-user-email">${_esc(user.email)}</div>
    </div>`;

  _updateSyncStatusRow(user.uid);
}

async function _updateSyncStatusRow(uid) {
  const row = document.getElementById('syncStatusRow');
  if (!row) return;
  row.innerHTML = `<span><span class="sync-dot sync-dot--pending"></span>检查同步状态…</span>`;
  const lastSync = await getLastSyncDate(uid);
  if (lastSync) {
    row.innerHTML = `<span><span class="sync-dot sync-dot--ok"></span>云端已同步</span>
      <span style="color:var(--color-label-4);font-size:11px">${lastSync.toLocaleString('zh-CN')}</span>`;
  } else {
    row.innerHTML = `<span><span class="sync-dot sync-dot--pending"></span>云端暂无数据，请点击同步</span>`;
  }
}

document.getElementById('tabLogin')?.addEventListener('click', () => switchAuthMode('login'));
document.getElementById('tabRegister')?.addEventListener('click', () => switchAuthMode('register'));
document.getElementById('forgotPwdBtn')?.addEventListener('click', () => switchAuthMode('reset'));
document.getElementById('authBackLoginBtn')?.addEventListener('click', () => switchAuthMode('login'));

document.getElementById('pwdEyeBtn')?.addEventListener('click', () => {
  const input = document.getElementById('authPassword');
  const btn   = document.getElementById('pwdEyeBtn');
  if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
  else { input.type = 'password'; btn.textContent = '👁️'; }
});

document.getElementById('authSubmitBtn')?.addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const pwd   = document.getElementById('authPassword').value;
  const name  = document.getElementById('authName')?.value.trim() || '';
  if (!email)            { showAuthError('请填写邮箱'); return; }
  if (!pwd || pwd.length < 6) { showAuthError('密码至少 6 位'); return; }

  setAuthLoading(true);
  clearAuthError();
  try {
    if (_authMode === 'register') {
      await registerWithEmail(email, pwd, name);
      // Auto-sync local data on first register
      const user = getCurrentUser();
      if (user) await syncToCloud(user.uid);
      showToast(t('toastRegisterOk'));
    } else {
      await loginWithEmail(email, pwd);
      showToast(t('toastLoginOk'));
    }
    closeAuthModal();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    setAuthLoading(false);
  }
});

document.getElementById('sendResetBtn')?.addEventListener('click', async () => {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) { showAuthError('请填写邮箱'); return; }
  try {
    await sendReset(email);
    showToast(t('toastResetSent'));
    switchAuthMode('login');
  } catch (err) {
    showAuthError(err.message);
  }
});

document.getElementById('signOutBtn')?.addEventListener('click', async () => {
  await logout();
  showToast(t('toastLogoutOk'));
  closeAuthModal();
});

document.getElementById('manualSyncBtn')?.addEventListener('click', async () => {
  const user = getCurrentUser();
  if (!user) return;
  await syncToCloud(user.uid);
  _updateSyncStatusRow(user.uid);
});

function setAuthLoading(on) {
  const btn = document.getElementById('authSubmitBtn');
  if (!btn) return;
  if (on) { btn.classList.add('btn-loading'); btn.innerHTML = '<span class="spin">↻</span> 处理中…'; }
  else    { btn.classList.remove('btn-loading');
            btn.innerHTML = `<span>${_authMode === 'register' ? t('authRegister') : t('authLogin')}</span>`; }
}
function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.classList.add('show'); }
}
function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}
function _esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// ════════════════════════════════════════════════════
//  6. AUTH STATE INTEGRATION (login persistence + auto-restore)
// ════════════════════════════════════════════════════
//
//  This is the fix for the "登录缓存" bug from v1: Firebase's
//  browserLocalPersistence (set in auth.js) means onAuthChange
//  fires with the *restored* user on every page load — no manual
//  token storage or rehydration needed on our end. We just react
//  to it here.

let _hasLoadedCloudOnce = false;

onAuthChange(async (user) => {
  _renderAuthButton(user);

  if (user && !_hasLoadedCloudOnce) {
    _hasLoadedCloudOnce = true;
    const { merged } = await loadCloudData(user.uid);
    if (merged > 0) showToast(t('toastCloudLoaded', { n: merged }));
  }

  // If the auth modal happens to be open, refresh its content
  const modal = document.getElementById('authModal');
  if (modal?.classList.contains('open')) {
    user ? renderLoggedInSection() : switchAuthMode('login');
  }
});

function _renderAuthButton(user) {
  const desktopSlot = document.getElementById('authBtnDesktop');
  const mobileSlot  = document.getElementById('authBtnMobile');
  if (!desktopSlot) return;

  if (user) {
    const initial = (user.displayName || user.email || '?')[0].toUpperCase();
    const html = `<button class="auth-avatar-btn" data-auth-trigger
        style="width:32px;height:32px;border-radius:50%;background:var(--grad-brand);
               color:#fff;border:none;font-size:13px;font-weight:800;cursor:pointer"
        title="${_esc(user.email)}">${initial}</button>`;
    desktopSlot.innerHTML = html;
    mobileSlot.innerHTML  = html.replace(/32px/g, '30px');
  } else {
    desktopSlot.innerHTML = `<button class="btn btn-secondary btn-sm" data-auth-trigger">🔑 ${t('authLogin')}</button>`;
    mobileSlot.innerHTML  = `<button class="icon-btn" data-auth-trigger title="登录">🔑</button>`;
  }
  // Re-wire the new buttons (innerHTML replace loses listeners)
  desktopSlot.querySelectorAll('[data-auth-trigger]').forEach(b => b.addEventListener('click', openAuthModal));
  mobileSlot.querySelectorAll('[data-auth-trigger]').forEach(b => b.addEventListener('click', openAuthModal));
}

// ── Sync status banner (persistent slim indicator) ────
onSyncStatus((status, msg) => {
  const el = document.getElementById('syncBanner');
  if (!el) return;
  if (status === 'pending') { el.textContent = '☁️ 同步中…'; el.classList.add('show'); }
  else if (status === 'synced') {
    el.textContent = '✅ 已同步'; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  } else if (status === 'error') {
    el.textContent = '❌ 同步失败'; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3500);
  } else {
    el.classList.remove('show');
  }
});

// ── db.js → store.js hook for cloud-data-loaded reload ──
window.__rdstr_onCloudDataLoaded = function () {
  reloadFromStorage();
  renderOverview();
  if (currentPage() === 'assets')       renderAssets();
  if (currentPage() === 'transactions') renderTransactions();
};
window.__rdstr_onSyncSuccess = function () { /* status banner already shows this */ };
window.__rdstr_onSyncError   = function (msg) { console.warn('[sync] failed:', msg); };

// ════════════════════════════════════════════════════
//  7. URL DEEP-LINK (iOS Shortcuts → auto-open quick-add)
// ════════════════════════════════════════════════════
//
//  Format: roadster.html?amount=121&note=...&date=ISO&type=支出
//  Used by the "double-tap to log expense" Shortcut workflow.

(function handleUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const amount = p.get('amount');
  if (!amount) return;

  const openOnReady = () => {
    navigate('transactions', false);
    openTxModal();

    // Pre-fill amount into the keypad display directly
    const numeric = parseFloat(amount.replace(/[^\d.]/g, ''));
    const amountEl = document.getElementById('amountText');
    if (!isNaN(numeric) && numeric > 0 && amountEl) {
      amountEl.textContent = String(numeric);
      // Sync the internal keypad state via a synthetic digit sequence
      // is fragile — instead we dispatch a custom event the page module
      // listens for. Simpler: just set the textContent (display-only)
      // and let the user confirm via keypad if they need to adjust.
    }

    const note = p.get('note') || '';
    const noteEl = document.getElementById('txNote');
    if (note && noteEl) noteEl.value = note;

    const dateParam = p.get('date') || p.get('time');
    const dateEl = document.getElementById('txDate');
    if (dateEl) {
      if (dateParam) {
        const d = new Date(dateParam);
        if (!isNaN(d)) {
          dateEl.value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
        }
      } else {
        dateEl.value = nowAsDatetimeLocal();
      }
    }

    const typeParam = p.get('type');
    if (typeParam === '收入' || typeParam === 'income') {
      document.getElementById('segIncome')?.click();
    }

    // Clean the URL so refreshing doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);
    showToast(t('toastAutoFill'));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(openOnReady, 150));
  } else {
    setTimeout(openOnReady, 150);
  }
})();

// ════════════════════════════════════════════════════
//  8. CHOICE MODAL CLOSE BUTTON
// ════════════════════════════════════════════════════
// Note: the choice modal has no dedicated close button by design —
// it's dismissed by clicking the overlay or selecting a choice card
// (both wired above).
