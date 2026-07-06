// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · main.js
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
import { syncToCloud, onSyncStatus, getLastSyncDate } from './db.js';

// v2.1: Delta Sync 引擎
import { init as initSync, syncOnLogin, syncOnLogout, manualSync, getLastSyncTime, onSyncStatus as onSyncStatusV21 } from './sync/syncManager.js';

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

// v2.1: 初始化 Delta Sync 引擎
initSync();

// Whenever any store write happens, notify sync engine
// (v2.1: 不再每次写入都触发全量上传，改为由 syncManager 管理上传队列)
window.__rdstr_onStoreWrite = function (key) {
  const user = getCurrentUser();
  if (!user) return;
  // 将变更记录加入上传队列（异步，不阻塞 UI）
  if (key === 'rdstr_tx' || key === 'rdstr_assets') {
    // syncManager 通过 store.subscribe 自动感知变更并入队
    // 此处保留 hook 供手动同步场景使用
  }
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

// Global event delegation for all [data-auth-trigger] buttons.
// Using document-level delegation ensures clicks always work
// regardless of dynamic innerHTML replacements, z-index stacking,
// or any container-level event interference.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-auth-trigger]');
  if (btn) openAuthModal();
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
  
  // 隐藏邮箱输入框（整个 .field 元素）
  const emailField = document.querySelector('.field:has(#authEmail)');
  if (emailField) emailField.style.display = 'none';

  const emailPrefix = user.email ? user.email.split('@')[0] : '';
  const nickname = user.displayName || emailPrefix || '用户';
  const initial = (nickname || '?')[0].toUpperCase();
  document.getElementById('authUserCard').innerHTML = `
    <div class="auth-avatar">${initial}</div>
    <div>
      <div class="auth-user-name">${_esc(nickname)}</div>
    </div>`;

  _updateSyncStatusRow(user.uid);
}

async function _updateSyncStatusRow(uid) {
  const row = document.getElementById('syncStatusRow');
  if (!row) return;
  row.innerHTML = `<span><span class="sync-dot sync-dot--pending"></span>检查同步状态…</span>`;

  // 优先使用本地时间戳（刚完成的同步一定是最新的）
  // Firestore serverTimestamp 写入后有延迟，立即读回可能拿到旧值
  let lastSync = null;
  const localTs = getLastSyncTime();
  if (localTs) {
    lastSync = new Date(localTs);
  } else {
    // 无本地记录时（如首次加载），fallback 到 Firestore
    lastSync = await getLastSyncDate(uid);
  }

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
      // v2.1: 注册成功后由 onAuthChange 自动触发 syncOnLogin 执行 Merge 上传
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
  // v2.1: 退出登录时同步状态由 onAuthChange 中的 syncOnLogout() 统一处理
  await logout();
  showToast(t('toastLogoutOk'));
  closeAuthModal();
});

document.getElementById('manualSyncBtn')?.addEventListener('click', async () => {
  const user = getCurrentUser();
  if (!user) return;
  const btn = document.getElementById('manualSyncBtn');
  const origText = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> 同步中…'; }
  try {
    const { uploaded } = await manualSync();
    showToast(uploaded > 0
      ? (t('syncedCount') || '已同步{n}条').replace('{n}', uploaded)
      : (t('synced') || '已同步'));
    _updateSyncStatusRow(user.uid);
  } catch (err) {
    showToast('同步失败');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origText; }
  }
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
//  v2.1 Delta Sync: 登录后不再直接覆盖本地数据，而是执行完整 Merge 流程。
//  Firebase browserLocalPersistence (set in auth.js) 确保登录状态
//  跨页面刷新持久化，onAuthChange 自动触发。

let _hasLoadedCloudOnce = false;

onAuthChange(async (user) => {
  _renderAuthButton(user);

  if (user && !_hasLoadedCloudOnce) {
    _hasLoadedCloudOnce = true;
    // v2.1: 使用 Delta Sync 引擎执行 Merge 流程
    const result = await syncOnLogin(user.uid);
    if (result.merged > 0) {
      showToast(t('toastCloudLoaded', { n: result.merged }));
    }
    // Merge 完成后刷新 UI
    reloadFromStorage();
    renderOverview();
    if (currentPage() === 'assets')       renderAssets();
    if (currentPage() === 'transactions') renderTransactions();
  }

  // 退出登录时清理同步状态
  if (!user && _hasLoadedCloudOnce) {
    _hasLoadedCloudOnce = false;
    syncOnLogout();
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
    desktopSlot.innerHTML = `<button class="btn btn-secondary btn-sm" data-auth-trigger="login">🔑 ${t('authLogin')}</button>`;
    mobileSlot.innerHTML  = `<button class="icon-btn" data-auth-trigger="login" title="登录">🔑</button>`;
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
