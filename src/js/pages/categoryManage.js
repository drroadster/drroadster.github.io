// ═══════════════════════════════════════════════════════
//  ROADSTER v2.4 · categoryManage.js
//  支出类目管理页面。系统分类只读，自定义分类可增删。
// ═══════════════════════════════════════════════════════

import { EXPENSE_CATS, getCustomCategories, addCustomCategory, removeCustomCategory } from '../config.js';
import { navigate, showToast } from '../router.js';

/**
 * 初始化类目管理页面并渲染。
 */
export function initCategoryManagePage() {
  render();
}

function render() {
  const container = document.getElementById('categoryManageContent');
  if (!container) return;

  const systemCats = EXPENSE_CATS;
  const customCats = getCustomCategories();

  container.innerHTML = `
    <div class="cat-manage-section">
      <div class="cat-manage-section-title">系统分类（不可删）</div>
      ${systemCats.map(c => `
        <div class="cat-manage-row">
          <span class="cat-manage-icon">${c.icon}</span>
          <span class="cat-manage-name">${_esc(c.label ? c.label.split(' ')[0] : c.v)}</span>
          <span class="cat-manage-tag">系统</span>
        </div>
      `).join('')}
    </div>

    <div class="cat-manage-section">
      <div class="cat-manage-section-title">自定义分类</div>
      ${customCats.length === 0
        ? '<div class="cat-manage-empty">暂无自定义分类</div>'
        : customCats.map(c => `
            <div class="cat-manage-row">
              <span class="cat-manage-icon">${c.icon}</span>
              <span class="cat-manage-name">${_esc(c.label || c.v)}</span>
              <button class="cat-manage-del" data-cat="${_esc(c.v)}" title="删除">🗑</button>
            </div>
          `).join('')}
      <div class="cat-manage-add">
        <input class="field-input cat-manage-input" id="newCatInput" placeholder="输入名称，如「宠物」「快递」">
        <button class="btn btn-primary btn-sm" id="addCatBtn">+ 添加自定义分类</button>
      </div>
    </div>
  `;

  // 删除自定义分类
  container.querySelectorAll('.cat-manage-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const catV = btn.dataset.cat;
      if (confirm(`确认删除自定义分类「${catV}」？已使用此类目的记录不会受影响。`)) {
        removeCustomCategory(catV);
        showToast(`已删除「${catV}」`);
        render();
      }
    });
  });

  // 添加自定义分类
  const addBtn = document.getElementById('addCatBtn');
  const input = document.getElementById('newCatInput');
  if (addBtn && input) {
    addBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        showToast('请输入类目名称');
        return;
      }
      const ok = addCustomCategory(name, '📦');
      if (!ok) {
        showToast(`类目「${name}」已存在`);
        return;
      }
      input.value = '';
      showToast(`已添加「${name}」`);
      render();
    });

    // 回车提交
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn.click();
    });
  }
}

/** HTML 转义 */
function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
