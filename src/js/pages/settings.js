// ═══════════════════════════════════════════════════════
//  ROADSTER v2.4 · settings.js
//  个人中心页面。展示用户信息 + 四个功能入口。
// ═══════════════════════════════════════════════════════

import { navigate, showToast } from '../router.js';
import { getCurrentUser, logout } from '../auth.js';
import { getTransactions } from '../store.js';
import { pad2 } from '../utils.js';

/**
 * 初始化个人中心页面。
 * 读取当前用户信息，渲染头像、昵称、邮箱和功能菜单。
 */
export function initSettingsPage() {
  const el = document.getElementById('settingsList');
  if (!el) return;

  const user = getCurrentUser();

  // 头像区
  const initials = (user?.displayName || user?.email?.split('@')[0] || '?')[0].toUpperCase();
  const nickname = user?.displayName || user?.email?.split('@')[0] || '未登录';
  const email = user?.email || '';

  el.innerHTML = `
    <div class="settings-profile">
      <div class="settings-avatar">${initials}</div>
      <div class="settings-profile-info">
        <div class="settings-nickname">${_esc(nickname)}</div>
        <div class="settings-email">${_esc(email)}</div>
      </div>
    </div>

    <div class="settings-menu">
      <div class="settings-menu-item" data-action="budget">
        <span class="settings-menu-icon">📊</span>
        <span class="settings-menu-label">预算管理</span>
        <span class="settings-menu-arrow">›</span>
      </div>
      <div class="settings-menu-item" data-action="export">
        <span class="settings-menu-icon">📤</span>
        <span class="settings-menu-label">数据导出</span>
        <span class="settings-menu-arrow">›</span>
      </div>
      <div class="settings-menu-item" data-action="categoryManage">
        <span class="settings-menu-icon">🏷️</span>
        <span class="settings-menu-label">类目管理</span>
        <span class="settings-menu-arrow">›</span>
      </div>
      <div class="settings-menu-item" data-action="logout">
        <span class="settings-menu-icon">⚙️</span>
        <span class="settings-menu-label">账号设置</span>
        <span class="settings-menu-arrow">›</span>
      </div>
    </div>
  `;

  // 绑定菜单点击事件
  el.querySelectorAll('.settings-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'budget') {
        navigate('budget');
      } else if (action === 'categoryManage') {
        navigate('categoryManage');
      } else if (action === 'export') {
        _exportCSV();
      } else if (action === 'logout') {
        handleSignOut();
      }
    });
  });
}

/**
 * 执行登出操作。
 */
async function handleSignOut() {
  try {
    await logout();
    // 登出后导航回概览页
    navigate('overview');
  } catch (err) {
    console.error('[settings] 登出失败:', err);
  }
}

/** HTML 转义 */
function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

/**
 * 导出所有交易数据为 CSV 并触发浏览器下载。
 */
function _exportCSV() {
  const txs = getTransactions();
  if (!txs || txs.length === 0) {
    showToast('暂无交易数据可导出');
    return;
  }

  // 按时间升序排列
  const sorted = [...txs].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });

  const header = '日期,类型,分类,子分类,金额,备注';
  const rows = sorted.map(t => {
    const date = t.date?.slice(0, 10) || '';
    const type = t.type || '';
    const cat  = t.category || '';
    const sub  = t.gSubCategory || t.subCategory || '';
    const amt  = t.amount != null ? t.amount : '';
    const note = t.note || '';
    return [date, type, cat, sub, amt, note].map(_csvEscape).join(',');
  });

  const csv = '\uFEFF' + header + '\n' + rows.join('\n');

  const now = new Date();
  const ts = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const filename = `Roadster_交易数据_${ts}.csv`;

  _download(filename, csv, 'text/csv;charset=utf-8');
  showToast(`已导出 ${sorted.length} 条记录`);
}

/** CSV 字段转义 */
function _csvEscape(v) {
  v = String(v ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 触发浏览器下载 */
function _download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
