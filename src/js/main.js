// ═══════════════════════════════════════════════════════
//  ROADSTER v2.3 · main.js
//  Application entry point. Wires every module together.
//  Load order matters: config has no deps, then theme/i18n,
//  then auth/db (Firebase), then store, then router, then
//  pages, then the app-level glue (FAB, auth UI, deep-link).
// ═══════════════════════════════════════════════════════

import { initTheme, setTheme, getTheme } from './theme.js';
import { initI18n, toggleLang, t } from './i18n.js';
import { initStore, mergeFromCloud, mergeAssetsFromCloud, addTransactions, getDrafts, clearDrafts, getAssetDrafts, clearAssetDrafts, isLoading, getSyncSource, getTransactions } from './store.js';
import { initRouter, navigate, onNavigate, fabAction, showToast, currentPage } from './router.js';

import { initOverviewPage,     render as renderOverview }     from './pages/overview.js';
import { initTransactionsPage, render as renderTransactions, openTxModal } from './pages/transactions.js';
import { initAssetsPage,       render as renderAssets,       openAssetModal } from './pages/assets.js';
import { initAnalysisPage,     render as renderAnalysis }     from './pages/analysis.js';
import { initFirePage,         render as renderFire }         from './pages/fire.js';
import { initSettingsPage }                                  from './pages/settings.js';
import { initBudgetPage }                                    from './pages/budget.js';

import {
  onAuthChange, getCurrentUser, registerWithEmail, loginWithEmail,
  logout, sendReset,
} from './auth.js';

// v2.3: 实时同步（onSnapshot）
import { onLoginSync, onLogoutSync, uploadDrafts, checkDuplicates, uploadAssetDrafts, checkAssetDuplicates } from './sync/syncManager.js';

import { nowAsDatetimeLocal, pad2 } from './utils.js';
import { categorize } from './ai/categorizer.js';

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

// ════════════════════════════════════════════════════
//  3. ROUTER + PAGES
// ════════════════════════════════════════════════════

initRouter();

initOverviewPage();
initTransactionsPage();
initAssetsPage();
initAnalysisPage();
initFirePage();
initSettingsPage();
initBudgetPage();
initCategoryManagePage();

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

// ── Analysis page internal tab switching ──
function resetAnalysisTabs() {
  document.querySelectorAll('[data-analysis-tab]').forEach(t =>
    t.classList.toggle('active', t.dataset.analysisTab === 'analysis')
  );
  document.querySelectorAll('[data-analysis-panel]').forEach(p =>
    p.classList.toggle('active', p.dataset.analysisPanel === 'analysis')
  );
}

document.getElementById('analysisTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-analysis-tab]');
  if (!tab) return;
  const target = tab.dataset.analysisTab;
  // Update tab active states
  document.querySelectorAll('[data-analysis-tab]').forEach(t =>
    t.classList.toggle('active', t.dataset.analysisTab === target)
  );
  // Update panel visibility
  document.querySelectorAll('[data-analysis-panel]').forEach(p =>
    p.classList.toggle('active', p.dataset.analysisPanel === target)
  );
  // FIRE panel: trigger render when switching to it
  if (target === 'fire') {
    renderFire();
  }
});

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
document.getElementById('uploadConfirmModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'uploadConfirmModal') {
    if (_uploadResolve) {
      _uploadResolve(false);
      _uploadResolve = null;
    }
    document.getElementById('uploadConfirmModal').classList.remove('open');
  }
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
    // 仅在登录表单可见时启用 autocomplete，避免 Safari 已登录状态下弹窗
    document.getElementById('authEmail').setAttribute('autocomplete', 'email');
    document.getElementById('authPassword').setAttribute('autocomplete', 'current-password');
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

  // 移除 autocomplete 属性，防止 Safari 已登录时弹出密码自动填充
  const emailInput = document.getElementById('authEmail');
  const pwdInput = document.getElementById('authPassword');
  if (emailInput) emailInput.removeAttribute('autocomplete');
  if (pwdInput) pwdInput.removeAttribute('autocomplete');

  const emailPrefix = user.email ? user.email.split('@')[0] : '';
  const nickname = user.displayName || emailPrefix || '用户';
  const initial = (nickname || '?')[0].toUpperCase();
  document.getElementById('authUserCard').innerHTML = `
    <div class="auth-avatar">${initial}</div>
    <div>
      <div class="auth-user-name">${_esc(nickname)}</div>
    </div>`;

  _updateSyncBadge();
}

function _updateSyncBadge() {
  const el = document.getElementById('syncStatusRow');
  if (!el) return;
  const src = getSyncSource();
  if (src === 0) {
    el.innerHTML = '<span>📋 本地模式</span>';
  } else if (isLoading()) {
    el.innerHTML = '<span>☁️ 同步中…</span>';
  } else {
    const n = getTransactions().length;
    el.innerHTML = `<span>☁️ 云端 · ${n} 条</span>`;
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

// Upload confirmation modal
document.getElementById('uploadConfirmBtn')?.addEventListener('click', () => {
  if (_uploadResolve) {
    _uploadResolve(true);
    _uploadResolve = null;
  } else {
    document.getElementById('uploadConfirmModal').classList.remove('open');
  }
});
document.getElementById('uploadCancelBtn')?.addEventListener('click', () => {
  document.getElementById('uploadConfirmModal').classList.remove('open');
  if (_uploadResolve) { _uploadResolve(false); _uploadResolve = null; }
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
//  6. AUTH STATE INTEGRATION (v2.3 real-time sync)
// ════════════════════════════════════════════════════
//
//  v2.3 实时同步模式：
//  • 登录 → 启动 onSnapshot 监听，数据自动推送到 store
//  • 写入 → store 内部通过 sync adapter 直写 Firestore（乐观更新）
//  • 退出 → 停止监听，清空内存，恢复本地草稿

let _hasLoggedInOnce = false;
let _uploadResolve = null; // Promise resolver for upload confirmation modal

onAuthChange(async (user) => {
  _renderAuthButton(user);

  if (user) {
    _hasLoggedInOnce = true;

    // v2.3: 上传本地草稿到云端（弹窗确认 → 含重复检测）
    const drafts = getDrafts();
    if (drafts.length > 0) {
      const dups = await checkDuplicates(user.uid, drafts).catch(err => {
        console.error('[main] 重复检测失败:', err);
        return [];
      });
      const dupCount = dups.length;
      const newCount = drafts.length - dupCount;

      const confirmed = await new Promise(resolve => {
        _uploadResolve = resolve;
        // 重置弹窗状态
        document.getElementById('uploadResult').textContent = '';
        document.getElementById('uploadConfirmBody').style.display = '';
        document.getElementById('uploadCancelBtn').style.display = '';
        document.getElementById('uploadConfirmBtn').textContent = '确认上传';
        document.getElementById('uploadConfirmBtn').disabled = false;
        document.getElementById('uploadConfirmBody').innerHTML = `
          <p>共 <b>${drafts.length}</b> 条本地数据待上传。</p>
          ${newCount > 0 ? `<p>✅ 新增 <b>${newCount}</b> 条</p>` : ''}
          ${dupCount > 0 ? `<p style="color:var(--color-danger)">⚠️ 与云端重复 <b>${dupCount}</b> 条（将跳过）</p>` : ''}
        `;
        document.getElementById('uploadConfirmModal').classList.add('open');
      });

      if (confirmed) {
        // 进入上传中状态
        document.getElementById('uploadConfirmBody').innerHTML = `<p>正在上传...</p>`;
        document.getElementById('uploadCancelBtn').style.display = 'none';
        document.getElementById('uploadConfirmBtn').textContent = '上传中…';
        document.getElementById('uploadConfirmBtn').disabled = true;

        const result = await uploadDrafts(user.uid, drafts).catch(err => {
          console.error('[main] 草稿上传失败:', err);
          return { uploaded: [], duplicates: [], _failed: true };
        });

        // 显示结果
        const msgParts = [];
        if (result.uploaded.length > 0) msgParts.push(`${result.uploaded.length} 条已上传`);
        if (result.duplicates.length > 0) msgParts.push(`${result.duplicates.length} 条重复已跳过`);
        if (result._failed) {
          msgParts.push('⚠️ 网络错误，请稍后重试（本地草稿已保留）');
        }
        document.getElementById('uploadResult').textContent = msgParts.join('，') || '无数据上传';
        document.getElementById('uploadConfirmBody').style.display = 'none';
        document.getElementById('uploadConfirmBtn').textContent = '关闭';
        document.getElementById('uploadConfirmBtn').disabled = false;
        document.getElementById('uploadCancelBtn').style.display = 'none';

        // 仅在上传未失败时清除草稿（成功或全部重复都清除）
        if (!result._failed) {
          clearDrafts();
        }

        // 等待用户点关闭
        await new Promise(resolve => {
          _uploadResolve = () => {
            document.getElementById('uploadConfirmModal').classList.remove('open');
            resolve();
          };
        });
      } else {
        showToast('已取消上传');
      }
    }

    // 上传资产草稿（静默上传，去重保守处理）
    const assetDrafts = getAssetDrafts();
    if (assetDrafts.length > 0) {
      const assetResult = await uploadAssetDrafts(user.uid, assetDrafts).catch(err => {
        console.error('[main] 资产草稿上传失败:', err);
        return { uploaded: [], duplicates: [], _failed: true };
      });
      if (assetResult.uploaded.length > 0 || assetResult.duplicates.length > 0) {
        const parts = [];
        if (assetResult.uploaded.length > 0) parts.push(`${assetResult.uploaded.length} 个资产已同步`);
        if (assetResult.duplicates.length > 0) parts.push(`${assetResult.duplicates.length} 个重复已跳过`);
        if (assetResult._failed) parts.push('部分上传失败，草稿已保留');
        showToast(parts.join('，'));
      }
      // 仅在上传成功时清除草稿，失败时保留本地副本
      if (!assetResult._failed) {
        clearAssetDrafts();
      }
    }

    // 启动 onSnapshot 监听
    onLoginSync(user.uid, (cloudRecords) => {
      mergeFromCloud(cloudRecords);
      _updateSyncBadge();
      renderAllPages();
    }, () => {
      // 资产数据变更时，若当前在资产页则重绘
      renderAllPages();
    });
  }

  if (!user && _hasLoggedInOnce) {
    _hasLoggedInOnce = false;
    onLogoutSync();
    renderAllPages();
  }

  const modal = document.getElementById('authModal');
  if (modal?.classList.contains('open')) {
    user ? renderLoggedInSection() : switchAuthMode('login');
  }
});

function renderAllPages() {
  renderOverview();
  if (currentPage() === 'assets')       renderAssets();
  if (currentPage() === 'transactions') renderTransactions();
  if (currentPage() === 'analysis')     renderAnalysis();
  initSettingsPage();
  initBudgetPage();
  initCategoryManagePage();
}

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

// ════════════════════════════════════════════════════
//  7. URL QUICK-ADD (Shortcuts / 快捷指令自动记账)
// ════════════════════════════════════════════════════
//
//  Format: ?amount=121&note=咖啡&type=支出&date=2026-07-07
//  示例: https://drroadster.github.io/html?amount=36.5&note=猫咪零食
//  检测到 amount 参数后直接添加记录，跳过 UI。

(function handleUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const amount = p.get('amount');
  if (!amount) return;

  const openOnReady = async () => {
    const numeric = parseFloat(amount.replace(/[^\d.]/g, ''));
    if (isNaN(numeric) || numeric <= 0) return;

    const note  = p.get('note') || '';
    const type  = (p.get('type') === '收入' || p.get('type') === 'income') ? '收入' : '支出';

    let date;
    const dateParam = p.get('date') || p.get('time');
    if (dateParam) {
      const d = new Date(dateParam);
      date = isNaN(d)
        ? nowAsDatetimeLocal()
        : `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    } else {
      date = nowAsDatetimeLocal();
    }

    // AI 智能分类
    const classifyResult = await categorize(note, '', type);

    const tx = {
      id: `t${Date.now()}${Math.random().toString(36).slice(2,8)}`,
      date, type,
      amount: Math.abs(numeric),
      category: classifyResult.gCategory || '其他',
      note,
      gCategory: classifyResult.gCategory || '其他',
      gSubCategory: classifyResult.gSubCategory || '其他',
      tags: classifyResult.tags || [],
      confidence: classifyResult.confidence || 0,
      source: classifyResult.source || 'none',
      aiUsed: classifyResult.aiUsed || false,
      userOverride: false,
      matchedRule: classifyResult.matchedRule || '',
    };

    const { added, duplicates } = addTransactions([tx]);

    // 清除 URL 参数防止刷新重复添加
    window.history.replaceState({}, '', window.location.pathname);

    if (duplicates && !added) {
      showToast('已存在相同记录，未重复添加');
      return;
    }

    showToast(`已添加${type}：¥${numeric}${note ? ' · ' + note : ''}`);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(openOnReady, 300));
  } else {
    setTimeout(openOnReady, 300);
  }
})();

// ════════════════════════════════════════════════════
//  8. CHOICE MODAL CLOSE BUTTON
// ════════════════════════════════════════════════════
// Note: the choice modal has no dedicated close button by design —
// it's dismissed by clicking the overlay or selecting a choice card
// (both wired above).
