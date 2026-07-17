// ═══════════════════════════════════════════════════════
//  ROADSTER v2.4 · settings.js
//  个人中心页面。展示用户信息 + 四个功能入口。
// ═══════════════════════════════════════════════════════

import { navigate } from '../router.js';
import { getCurrentUser, logout } from '../auth.js';

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
        // 暂用占位：跳转到记账页的导出区域
        navigate('transactions');
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
