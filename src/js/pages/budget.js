// ═══════════════════════════════════════════════════════
//  ROADSTER v2.4 · budget.js
//  预算管理页面。列表视图 + 按分类编辑。
// ═══════════════════════════════════════════════════════

import { navigate } from '../router.js';
import { EXPENSE_CATS, getCustomCategories } from '../config.js';
import { getBudgets, saveBudget, deleteBudget, subscribe } from '../store.js';

/** 当前正在编辑的分类（null = 列表视图） */
let _editingCategory = null;

/** 预算变更订阅注销函数 */
let _unsub = null;

/**
 * 初始化预算管理页面。
 * 设置 store 订阅，在页面激活时自动刷新。
 */
export function initBudgetPage() {
  const el = document.getElementById('budgetContent');
  if (!el) return;

  _render();

  // 只订阅一次
  if (!_unsub) {
    _unsub = subscribe('budgets', () => _render());
  }
}

function _render() {
  const el = document.getElementById('budgetContent');
  if (!el) return;

  if (_editingCategory) {
    renderEditPage(el, _editingCategory);
  } else {
    renderListPage(el);
  }
}

// ── 列表视图 ────────────────────────────────────────

function renderListPage(el) {
  const budgets = getBudgets();
  const custom = getCustomCategories().filter(c => c.custom);
  const allCats = [...EXPENSE_CATS, ...custom];

  // 按 category 分组：主预算 + 子分类预算
  const budgetMap = {};
  budgets.forEach(b => {
    if (!budgetMap[b.category]) budgetMap[b.category] = { main: null, subs: [] };
    if (b.subCategory) {
      budgetMap[b.category].subs.push(b);
    } else {
      budgetMap[b.category].main = b;
    }
  });

  let html = '';

  allCats.forEach(cat => {
    const bm = budgetMap[cat.v] || { main: null, subs: [] };
    const main = bm.main;
    const subs = bm.subs;

    const icon = cat.icon || '📌';
    // EXPENSE_CATS label 格式为 "Food 餐饮"，提取中文部分显示
    const label = _extractChinese(cat.label || cat.v);

    let summary;
    if (main) {
      const periodLabel = main.period === 'yearly' ? '年' : '月';
      summary = `${periodLabel} ¥${main.amount.toLocaleString()}`;
    } else {
      summary = '未设置';
    }

    let subSummary = '';
    if (subs.length > 0) {
      subSummary = '子分类：' + subs.map(s =>
        `${_esc(s.subCategory)}(月¥${s.amount.toLocaleString()})`
      ).join('、');
    }

    html += `
      <div class="budget-cat-row" data-category="${_escAttr(cat.v)}">
        <div class="budget-cat-icon">${icon}</div>
        <div class="budget-cat-info">
          <div class="budget-cat-name">${_esc(label)}</div>
          <div class="budget-cat-summary">${summary}</div>
          ${subSummary ? `<div class="budget-cat-subs">${subSummary}</div>` : ''}
        </div>
        <div class="budget-cat-arrow">›</div>
      </div>
    `;
  });

  el.innerHTML = html;

  // 点击整行进入编辑页
  el.querySelectorAll('.budget-cat-row').forEach(row => {
    row.addEventListener('click', () => {
      _editingCategory = row.dataset.category;
      _render();
    });
  });
}

// ── 编辑视图 ────────────────────────────────────────

function renderEditPage(el, category) {
  const budgets = getBudgets();
  const catInfo = EXPENSE_CATS.find(c => c.v === category) ||
    getCustomCategories().find(c => c.v === category) ||
    { icon: '📌', label: category };

  const mainBudget = budgets.find(b => b.category === category && !b.subCategory);
  const subBudgets = budgets.filter(b => b.category === category && b.subCategory);

  const icon = catInfo.icon || '📌';
  const label = _extractChinese(catInfo.label || category);

  const period = mainBudget?.period || 'monthly';
  const amount = mainBudget?.amount || '';

  el.innerHTML = `
    <div class="budget-edit-form">
      <div class="budget-edit-header">
        <button class="budget-back-btn" id="budgetBackBtn">← ${_esc(label)}预算</button>
      </div>

      <div class="budget-edit-main">
        <div class="budget-edit-label">预算周期</div>
        <div class="segmented" id="budgetPeriodSeg">
          <button class="seg-pill ${period === 'monthly' ? 'active' : ''}" data-period="monthly">每月</button>
          <button class="seg-pill ${period === 'yearly' ? 'active' : ''}" data-period="yearly">每年</button>
        </div>

        <div class="budget-edit-label" style="margin-top:16px">预算金额</div>
        <div class="budget-amount-row">
          <span class="budget-amount-symbol">¥</span>
          <input class="field-input budget-amount-input" id="budgetAmountInput"
                 type="number" inputmode="decimal" placeholder="0"
                 value="${amount}">
        </div>

        <button class="btn btn-primary btn-block" id="budgetSaveBtn" style="margin-top:16px">保存</button>
      </div>

      <div class="budget-edit-subs">
        <div class="budget-subs-header">子分类</div>

        ${subBudgets.map(s => `
          <div class="budget-sub-row">
            <span class="budget-sub-name">${_esc(s.subCategory)}</span>
            <span class="budget-sub-amount">¥${s.amount.toLocaleString()}/月</span>
            <button class="budget-sub-del" data-sub="${_escAttr(s.subCategory)}">🗑</button>
          </div>
        `).join('')}

        <div class="budget-add-sub" id="budgetAddSub">
          <input class="field-input budget-sub-name-input" id="budgetSubName" placeholder="子分类名称">
          <input class="field-input budget-sub-amount-input" id="budgetSubAmount"
                 type="number" inputmode="decimal" placeholder="金额">
          <button class="btn btn-secondary btn-sm" id="budgetAddSubBtn">＋ 添加</button>
        </div>
      </div>
    </div>
  `;

  // ── 绑定事件 ──

  document.getElementById('budgetBackBtn')?.addEventListener('click', () => {
    _editingCategory = null;
    _render();
  });

  // 周期切换
  document.querySelectorAll('#budgetPeriodSeg .seg-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#budgetPeriodSeg .seg-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // 保存主预算
  document.getElementById('budgetSaveBtn')?.addEventListener('click', () => {
    const activePeriod = document.querySelector('#budgetPeriodSeg .seg-pill.active')?.dataset.period || 'monthly';
    const amountVal = parseFloat(document.getElementById('budgetAmountInput')?.value) || 0;
    saveBudget({ category, subCategory: null, period: activePeriod, amount: amountVal });
  });

  // 添加子分类
  document.getElementById('budgetAddSubBtn')?.addEventListener('click', () => {
    const name = document.getElementById('budgetSubName')?.value.trim();
    const amountVal = parseFloat(document.getElementById('budgetSubAmount')?.value) || 0;
    if (!name || amountVal <= 0) return;

    saveBudget({ category, subCategory: name, period: 'monthly', amount: amountVal });

    document.getElementById('budgetSubName').value = '';
    document.getElementById('budgetSubAmount').value = '';
  });

  // 删除子分类
  el.querySelectorAll('.budget-sub-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteBudget(category, btn.dataset.sub);
    });
  });
}

// ── 工具函数 ────────────────────────────────────────

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 从 "Food 餐饮" 这类格式中提取中文部分，若无中文则返回原值 */
function _extractChinese(label) {
  const m = label.match(/[\u4e00-\u9fa5].*/);
  return m ? m[0] : label;
}
