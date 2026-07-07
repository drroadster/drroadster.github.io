// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · pages/transactions.js
//  Transaction ledger: list (collapsible by month), quick-add
//  keypad modal, detail/edit sheet, CSV import/export,
//  data cleanup tools.
// ═══════════════════════════════════════════════════════

import {
  getTransactions, addTransactions, updateTransaction, deleteTransaction,
  deleteByCategory, renormalizeAllCategories, clearTransactions,
  txFingerprint, normalizeCategory, isLoading, isLoggedIn,
} from '../store.js';
import { fmt, esc, formatTxDateTime, nowAsDatetimeLocal, pad2,
         normalizeDate, splitCSVLine, splitCSVLines, parseMoney } from '../utils.js';
import { t } from '../i18n.js';
import { showToast } from '../router.js';
import { CAT_ICONS, EXPENSE_CATS, INCOME_CATS, ALL_CATS, getCustomCategories, getCatIcon, addCustomCategory, removeCustomCategory, getAllCategories } from '../config.js';
import { onNavigate } from '../router.js';
import { categorize } from '../ai/categorizer.js';
import { learn } from '../ai/userMemoryEngine.js';

// ── State ────────────────────────────────────────────
let _filterType = '';              // '' | '收入' | '支出'
const _expandedMonths = new Set(); // YYYY-MM keys currently expanded
let _quickType  = '支出';
let _keypadVal  = '0';
let _selectedCat = '';
let _isCustomCat = false;

// Calendar view state
let _currentView = 'list';          // 'list' | 'calendar'
let _calYear, _calMonth;           // current year/month for calendar nav
let _selectedCalDay = null;        // 'YYYY-MM-DD' selected day
let _editingTxId = null;           // tx id currently editing time

// ── Public init ──────────────────────────────────────
export function initTransactionsPage() {
  _wireListControls();
  _wireQuickAddModal();
  _wireImportExport();
  _initTimePopover();
  _initCalendarNav();
  _initViewToggle();
  window.__rdstr_openTxModal = openTxModal; // FAB hook (router.js)
  onNavigate(page => { if (page === 'transactions') render(); });
}

export function render() {
  // Toggle visibility based on current view
  const listCard = document.getElementById('listViewCard');
  const calView  = document.getElementById('calendarView');
  const calDetail = document.getElementById('calDayDetail');
  if (listCard) listCard.style.display = _currentView === 'list' ? '' : 'none';
  if (calView)  calView.style.display  = _currentView === 'calendar' ? '' : 'none';

  const q = (document.getElementById('txSearch')?.value || '').toLowerCase();
  let txs = getTransactions();

  if (_currentView === 'calendar') {
    // Init calendar to latest transaction month if not set
    if (!_calYear) {
      if (txs.length) {
        const d = new Date(txs[0].date);
        _calYear = d.getFullYear();
        _calMonth = d.getMonth() + 1;
      } else {
        const now = new Date();
        _calYear = now.getFullYear();
        _calMonth = now.getMonth() + 1;
      }
    }
    _renderCalendar(txs);
    return;
  }

  if (_filterType) txs = txs.filter(t => t.type === _filterType);
  if (q) txs = txs.filter(t => `${t.category}${t.note}`.toLowerCase().includes(q));

  const el = document.getElementById('fullTxList');
  if (!el) return;

  if (!txs.length) {
    if (isLoading()) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon spin">↻</div>
      <div class="empty-text">加载中…</div></div>`;
    } else {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>
      <div class="empty-text">没有匹配的记录</div></div>`;
    }
    return;
  }

  if (q) { // flat list while searching
    el.innerHTML = txs.map(_rowHtml).join('');
    _wireRowClicks(el);
    return;
  }

  // Group by YYYY-MM, collapsible
  const groups = {}; const order = [];
  txs.forEach(tx => {
    const key = (tx.date || '').slice(0, 7);
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(tx);
  });
  if (_expandedMonths.size === 0 && order.length) _expandedMonths.add(order[0]);

  el.innerHTML = order.map(month => {
    const items = groups[month];
    const income  = items.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
    const expense = items.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
    const isOpen  = _expandedMonths.has(month);
    const [yr, mo] = month.split('-');
    return `<div class="tx-month-group">
      <div class="tx-month-header" data-month="${month}">
        <div class="tx-month-label">
          <span class="tx-month-chevron ${isOpen ? 'open' : ''}">›</span>
          <span>${yr}年${parseInt(mo)}月</span>
          <span class="tx-month-count">${items.length} 笔</span>
        </div>
        <div class="tx-month-summary">
          ${income  > 0 ? `<span style="color:var(--color-green)">+¥${fmt(income)}</span>`  : ''}
          ${expense > 0 ? `<span style="color:var(--color-red)">-¥${fmt(expense)}</span>` : ''}
        </div>
      </div>
      <div class="tx-month-body ${isOpen ? 'open' : ''}">
        ${items.map(_rowHtml).join('')}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.tx-month-header').forEach(h => {
    h.addEventListener('click', () => {
      const m = h.dataset.month;
      _expandedMonths.has(m) ? _expandedMonths.delete(m) : _expandedMonths.add(m);
      render();
    });
  });
  _wireRowClicks(el);
}

function _wireRowClicks(container) {
  container.querySelectorAll('[data-tx-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tx-edit-btn')) return;
      if (e.target.closest('.tx-time-pill')) return;
      openTxDetail(row.dataset.txId);
    });
  });
  container.querySelectorAll('.tx-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTx(btn.dataset.txId);
    });
  });
  container.querySelectorAll('.tx-time-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      _openTimePopover(pill);
    });
  });
}

function _rowHtml(tx) {
  const isLoss = tx.type === '收入' && tx.amount < 0;
  const isGain = tx.type === '收入' && tx.amount >= 0;
  const sign = isLoss ? '−' : (isGain ? '+' : '−');
  const cls  = isGain ? 'income' : (isLoss ? 'loss' : '');
  const bg = isGain
    ? 'linear-gradient(135deg,rgba(52,199,89,.16),rgba(0,199,190,.16))'
    : isLoss
      ? 'linear-gradient(135deg,rgba(255,59,48,.16),rgba(255,149,0,.12))'
      : 'linear-gradient(135deg,rgba(0,122,255,.14),rgba(175,82,222,.14))';
  const icon = isLoss ? '📉' : (getCatIcon(tx.category));
  const timeDisplay = formatTxDateTime(tx.date);
  const isEditing = _editingTxId === tx.id;
  const editCls = isEditing ? ' time-editing' : '';

  // 存储位置标签
  const storageTag = _storageTagHtml(tx);
  // 智能分类标签
  const gCatLabel = tx.gCategory ? _gCategoryBadge(tx) : '';
  // 分类来源标签
  const sourceTag = _sourceTagHtml(tx);

  return `<div class="tx-row${editCls}" data-tx-id="${tx.id}">
    <div class="tx-icon" style="background:${bg}">${icon}</div>
    <div class="tx-info">
      <div class="tx-name">${esc(tx.category)}${tx.note ? ' · ' + esc(tx.note) : ''}${isLoss ? ' · 亏损' : ''}</div>
      <div class="tx-meta">
        <span class="tx-time-pill${isEditing ? ' editing' : ''}" data-tx-id="${tx.id}" data-tx-time="${esc(tx.date)}" title="点击修改时间">🕐 ${esc(timeDisplay)}</span>
        ${gCatLabel}${sourceTag}${storageTag}
      </div>
    </div>
    <div class="tx-amount ${cls}">${sign}¥${fmt(Math.abs(tx.amount))}</div>
    <button class="tx-edit-btn" data-tx-id="${tx.id}" title="编辑">✏️</button>
  </div>`;
}

// ── List controls (search / filter) ────────────────────
function _wireListControls() {
  const search = document.getElementById('txSearch');
  if (search) search.addEventListener('input', render);

  document.querySelectorAll('#txTypeSeg .seg-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterType = btn.dataset.tf;
      document.querySelectorAll('#txTypeSeg .seg-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });

  const cleanupBtn = document.getElementById('dataCleanupBtn');
  if (cleanupBtn) cleanupBtn.addEventListener('click', openDataCleanup);
}

// ════════════════════════════════════════════════════
//  VIEW TOGGLE (list ↔ calendar)
// ════════════════════════════════════════════════════

function _initViewToggle() {
  document.querySelectorAll('#txViewSeg .seg-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentView = btn.dataset.view;
      document.querySelectorAll('#txViewSeg .seg-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (_currentView === 'calendar') _selectedCalDay = null;
      render();
    });
  });
}

// ════════════════════════════════════════════════════
//  TIME POPOVER (click time pill → edit datetime)
// ════════════════════════════════════════════════════

function _initTimePopover() {
  const popover = document.getElementById('timePopover');
  if (!popover) return;

  document.addEventListener('click', (e) => {
    if (!popover.classList.contains('open')) return;
    if (!popover.contains(e.target) && !e.target.closest('.tx-time-pill')) {
      _closeTimePopover();
    }
  });

  document.getElementById('timePopoverCancel')?.addEventListener('click', _closeTimePopover);
  document.getElementById('timePopoverConfirm')?.addEventListener('click', _confirmTimeEdit);

  // Also confirm on Enter key in the input
  document.getElementById('timePopoverInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _confirmTimeEdit();
    if (e.key === 'Escape') _closeTimePopover();
  });
}

function _openTimePopover(pillEl) {
  const txId = pillEl.dataset.txId;
  const tx = getTransactions().find(t => t.id === txId);
  if (!tx) return;

  // Close any previously open popover
  _closeTimePopover(false);

  _editingTxId = txId;

  // Update the pill visual
  pillEl.classList.add('editing');
  pillEl.closest('.tx-row')?.classList.add('time-editing');

  // Set the input value — pre-fill with existing date/time
  const input = document.getElementById('timePopoverInput');
  if (input) {
    let dateVal = tx.date || '';
    if (dateVal.length === 10) {
      // Date only (CSV import): "2026-07-06" → "2026-07-06T00:00"
      dateVal += 'T00:00';
    } else if (dateVal.length === 16) {
      // Missing seconds: "2026-07-06T14:30" → "2026-07-06T14:30:00"
      dateVal += ':00';
    }
    input.value = dateVal;
  }

  // Position the popover
  const popover = document.getElementById('timePopover');
  if (!popover) return;

  const rect = pillEl.getBoundingClientRect();
  const popW = 280;
  let left = rect.left + rect.width / 2 - popW / 2;
  const top = rect.bottom + 8;

  // Clamp to viewport
  if (left < 10) left = 10;
  if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.add('open');

  setTimeout(() => input?.focus(), 100);
}

function _closeTimePopover(restore = true) {
  const popover = document.getElementById('timePopover');
  if (popover) popover.classList.remove('open');

  if (restore && _editingTxId) {
    // Remove editing visual
    document.querySelectorAll('.tx-time-pill.editing').forEach(p => p.classList.remove('editing'));
    document.querySelectorAll('.tx-row.time-editing').forEach(r => r.classList.remove('time-editing'));
  }
  _editingTxId = null;
}

function _confirmTimeEdit() {
  if (!_editingTxId) return;
  const input = document.getElementById('timePopoverInput');
  const newDate = input?.value;
  if (!newDate) return;

  const date = newDate.length === 16 ? newDate + ':00' : newDate;
  updateTransaction(_editingTxId, { date });

  _closeTimePopover(false);
  showToast('时间已更新');
  render();
  import('./overview.js').then(m => m.render());
}

// ════════════════════════════════════════════════════
//  CALENDAR VIEW
// ════════════════════════════════════════════════════

function _initCalendarNav() {
  document.getElementById('calPrev')?.addEventListener('click', () => {
    if (_calMonth === 1) { _calMonth = 12; _calYear--; }
    else { _calMonth--; }
    _selectedCalDay = null;
    render();
  });
  document.getElementById('calNext')?.addEventListener('click', () => {
    if (_calMonth === 12) { _calMonth = 1; _calYear++; }
    else { _calMonth++; }
    _selectedCalDay = null;
    render();
  });
}

function _renderCalendar(txs) {
  const titleEl = document.getElementById('calTitle');
  const gridEl  = document.getElementById('calGrid');
  const detailEl = document.getElementById('calDayDetail');
  const dayListEl = document.getElementById('calDayList');
  const dayHeaderEl = document.getElementById('calDayHeader');

  if (!titleEl || !gridEl) return;

  titleEl.textContent = `${_calYear}年${_calMonth}月`;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  // Build day → transactions map for the current month
  const dayMap = {};
  const monthPrefix = `${_calYear}-${pad2(_calMonth)}-`;
  txs.forEach(tx => {
    const dayKey = (tx.date || '').slice(0, 10);
    if (!dayKey.startsWith(monthPrefix)) return;
    if (!dayMap[dayKey]) dayMap[dayKey] = [];
    dayMap[dayKey].push(tx);
  });

  // Calculate first day of month and total days
  const firstDay = new Date(_calYear, _calMonth - 1, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth, 0).getDate();

  // Build grid cells
  const cells = [];

  // Day headers
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  dayNames.forEach(d => {
    cells.push(`<div class="cal-day-header">${d}</div>`);
  });

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) {
    cells.push('<div class="cal-day other-month"></div>');
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    const dayKey = `${monthPrefix}${pad2(d)}`;
    const dayTxs = dayMap[dayKey] || [];
    const income  = dayTxs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
    const expense = dayTxs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
    const net = income - expense;

    let dotCls = '';
    if (dayTxs.length > 0) {
      if (net > 0) dotCls = 'cal-dot--green';
      else if (net < 0) dotCls = 'cal-dot--red';
      else dotCls = 'cal-dot--gray';
    }

    const isToday   = dayKey === todayKey;
    const isSelected = dayKey === _selectedCalDay;

    let cls = 'cal-day';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';

    let amountHtml = '';
    if (dayTxs.length > 0) {
      if (net !== 0) {
        const amtCls = net > 0 ? 'income' : 'expense';
        const sign = net > 0 ? '+' : '';
        amountHtml = `<span class="cal-day-amount ${amtCls}">${sign}${fmt(Math.abs(net))}</span>`;
      } else {
        amountHtml = '<span class="cal-day-amount" style="color:var(--color-label-4)">¥0</span>';
      }
    }

    let dotsHtml = '';
    if (dayTxs.length > 0) {
      dotsHtml = `<div class="cal-day-dots"><span class="cal-dot ${dotCls}"></span></div>`;
    }

    cells.push(`<div class="${cls}" data-day="${dayKey}">
      <span class="cal-day-num">${d}</span>
      ${amountHtml}
      ${dotsHtml}
    </div>`);
  }

  // Trailing empty cells
  const totalCells = startDow + daysInMonth;
  const remainder = totalCells % 7;
  if (remainder > 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      cells.push('<div class="cal-day other-month"></div>');
    }
  }

  gridEl.innerHTML = cells.join('');

  // Wire day clicks
  gridEl.querySelectorAll('.cal-day:not(.other-month)').forEach(cell => {
    cell.addEventListener('click', () => _selectCalDay(cell.dataset.day, txs));
  });

  // Show/hide day detail
  if (_selectedCalDay && detailEl && dayListEl && dayHeaderEl) {
    const dayTxs = txs.filter(t => (t.date || '').slice(0, 10) === _selectedCalDay);
    if (dayTxs.length) {
      detailEl.style.display = '';
      const income  = dayTxs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
      const expense = dayTxs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
      const net = income - expense;
      const dateLabel = _selectedCalDay.replace(/-/g, '/');
      const dayOfWeek = ['日','一','二','三','四','五','六'][new Date(_selectedCalDay).getDay()];
      dayHeaderEl.innerHTML = `📅 ${dateLabel} 周${dayOfWeek}
        <span class="cal-day-summary">
          ${income > 0 ? `<span class="cal-sum-income">+¥${fmt(income)}</span>` : ''}
          ${expense > 0 ? `<span class="cal-sum-expense">-¥${fmt(expense)}</span>` : ''}
          <span style="color:${net >= 0 ? 'var(--color-green)' : 'var(--color-red)'};font-weight:700">
            结余 ${net >= 0 ? '+' : ''}¥${fmt(net)}
          </span>
        </span>`;

      const sorted = [...dayTxs].sort((a, b) => new Date(b.date) - new Date(a.date));
      dayListEl.innerHTML = sorted.map(_rowHtml).join('');
      _wireRowClicks(dayListEl);
    } else {
      detailEl.style.display = 'none';
    }
  } else if (detailEl) {
    detailEl.style.display = 'none';
  }

  // Monthly summary bar
  _renderCalStickyBar(txs, monthPrefix);
}

function _selectCalDay(dayKey, txs) {
  _selectedCalDay = (_selectedCalDay === dayKey) ? null : dayKey;
  _renderCalendar(txs);
}

function _renderCalStickyBar(txs, monthPrefix) {
  const detailEl = document.getElementById('calDayDetail');
  if (!detailEl) return;

  // Remove existing sticky bar
  const existing = detailEl.querySelector('.cal-sticky-bar');
  if (existing) existing.remove();

  const monthTxs = txs.filter(t => (t.date || '').startsWith(monthPrefix));
  const income  = monthTxs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
  const expense = monthTxs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
  const net = income - expense;

  const bar = document.createElement('div');
  bar.className = 'cal-sticky-bar';
  bar.innerHTML = `
    <span class="cal-bar-income">收入 +¥${fmt(income)}</span>
    <span class="cal-bar-expense">支出 -¥${fmt(expense)}</span>
    <span class="cal-bar-net ${net >= 0 ? 'positive' : 'negative'}">结余 ${net >= 0 ? '+' : ''}¥${fmt(net)}</span>`;
  detailEl.appendChild(bar);
}

// ════════════════════════════════════════════════════
//  QUICK-ADD MODAL (keypad amount entry + icon category grid)
// ════════════════════════════════════════════════════

function _wireQuickAddModal() {
  const modal = document.getElementById('txModal');
  if (!modal) return;

  modal.addEventListener('click', (e) => { if (e.target === modal) closeTxModal(); });

  document.getElementById('segExpense')?.addEventListener('click', () => _setQuickType('支出'));
  document.getElementById('segIncome')?.addEventListener('click', () => _setQuickType('收入'));

  // Keypad
  document.querySelectorAll('.keypad-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => _keypadInput(btn.dataset.key));
  });
  document.getElementById('keypadDel')?.addEventListener('click', _keypadDelete);

  document.getElementById('txCategoryCustom')?.addEventListener('input', () => {
    _selectedCat = document.getElementById('txCategoryCustom').value.trim();
  });

  document.getElementById('txModalSave')?.addEventListener('click', saveQuickTx);
  document.getElementById('txModalCancel')?.addEventListener('click', closeTxModal);
}

export function openTxModal() {
  _keypadVal = '0';
  _quickType = '支出';
  _setQuickType('支出');
  const customEl = document.getElementById('txCategoryCustom');
  if (customEl) customEl.value = '';
  const noteEl = document.getElementById('txNote');
  if (noteEl) noteEl.value = '';
  const dateEl = document.getElementById('txDate');
  if (dateEl) dateEl.value = nowAsDatetimeLocal();
  _renderKeypadDisplay();
  document.getElementById('txModal')?.classList.add('open');
}
export function closeTxModal() {
  document.getElementById('txModal')?.classList.remove('open');
}

function _setQuickType(type) {
  _quickType = type;
  document.getElementById('segExpense')?.classList.toggle('active', type === '支出');
  document.getElementById('segIncome')?.classList.toggle('active', type === '收入');
  _renderCatGrid();
}

function _keypadInput(ch) {
  if (ch === '.') {
    if (_keypadVal.includes('.')) return;
    _keypadVal += '.';
  } else {
    if (_keypadVal === '0') _keypadVal = ch;
    else {
      const parts = _keypadVal.split('.');
      if (parts[1] && parts[1].length >= 2) return;
      if (_keypadVal.replace('.', '').length >= 9) return;
      _keypadVal += ch;
    }
  }
  _renderKeypadDisplay();
}
function _keypadDelete() {
  _keypadVal = _keypadVal.length > 1 ? _keypadVal.slice(0, -1) : '0';
  _renderKeypadDisplay();
}
function _renderKeypadDisplay() {
  const el = document.getElementById('amountText');
  if (el) el.textContent = _keypadVal;
}

function _renderCatGrid() {
  const list = _quickType === '支出' ? EXPENSE_CATS : INCOME_CATS;
  const custom = getCustomCategories();
  const grid = document.getElementById('catGrid');
  if (!grid) return;

  const items = [...list, ...custom, { v: '__custom__', icon: '✏️', label: '自定义' }];
  grid.innerHTML = items.map(c => {
    const selected = (c.v === '__custom__' && _isCustomCat) || (!_isCustomCat && _selectedCat === c.v);
    return `<div class="cat-item ${selected ? 'selected' : ''}" data-cat="${esc(c.v)}">
      <div class="cat-icon">${c.icon}</div>
      <div class="cat-name">${esc(c.label ? c.label.split(' ')[0] : c.v)}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.cat-item').forEach(item => {
    item.addEventListener('click', () => _selectCategory(item.dataset.cat));
  });

  const customInput = document.getElementById('txCategoryCustom');
  if (customInput) customInput.classList.toggle('show', _isCustomCat);
}

function _selectCategory(v) {
  if (v === '__custom__') {
    _isCustomCat = true; _selectedCat = '';
    _renderCatGrid();
    setTimeout(() => document.getElementById('txCategoryCustom')?.focus(), 50);
  } else {
    _isCustomCat = false; _selectedCat = v;
    const customEl = document.getElementById('txCategoryCustom');
    if (customEl) customEl.value = '';
    _renderCatGrid();
  }
}

function _getSelectedCategory() {
  if (_isCustomCat) return document.getElementById('txCategoryCustom')?.value.trim() || '';
  return _selectedCat;
}

export async function saveQuickTx() {
  let amount = parseFloat(_keypadVal);
  const category = _getSelectedCategory();
  const dateRaw   = document.getElementById('txDate')?.value || '';
  const note      = document.getElementById('txNote')?.value.trim() || '';

  if (isNaN(amount) || amount === 0) { showToast(t('toastInvalidAmount')); return; }
  if (!dateRaw)  { showToast(t('toastNeedDate'));    return; }

  const date = dateRaw.length === 16 ? dateRaw + ':00' : dateRaw;
  const allowsNegative = (_quickType === '收入' && category === '理财');
  if (!allowsNegative) amount = Math.abs(amount);

  // 调用智能分类器
  const classifyResult = await categorize(note, category, _quickType);

  // 未选择类目时，以 AI 智能分类结果填充 category
  const finalCategory = category || classifyResult.gCategory || '其他';

  const tx = {
    id: `t${Date.now()}${Math.random().toString(36).slice(2,8)}`,
    date, type: _quickType, amount, category: finalCategory, note,
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
  closeTxModal();

  if (duplicates && !added) { showToast(t('toastDuplicate')); return; }
  showToast(t('toastTxAdded', { type: _quickType === '支出' ? t('typeExpense') : t('typeIncome') }));
  render();
  import('./overview.js').then(m => m.render());
}

// ════════════════════════════════════════════════════
//  DETAIL + EDIT SHEET
// ════════════════════════════════════════════════════

export function openTxDetail(txId) {
  const tx = getTransactions().find(x => x.id === txId);
  if (!tx) return;

  const isLoss = tx.type === '收入' && tx.amount < 0;
  const isGain = tx.type === '收入' && tx.amount >= 0;
  const sign   = isLoss ? '−' : (isGain ? '+' : '−');
  const grad   = isGain ? 'var(--grad-income)' : isLoss ? 'var(--grad-expense)' : 'var(--grad-asset)';

  const content = document.getElementById('txDetailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="tx-detail-header" style="background:${grad};border-radius:var(--r-lg);padding:32px 22px 24px;text-align:center;color:#fff;margin:-4px -4px 18px">
      <div style="width:54px;height:54px;border-radius:18px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:25px;margin:0 auto 12px;backdrop-filter:blur(8px)">
        ${isLoss ? '📉' : (getCatIcon(tx.category))}
      </div>
      <div style="font-size:13px;font-weight:700;opacity:.85;margin-bottom:6px">${tx.type}${isLoss ? ' · 亏损' : ''}</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:-1px">${sign}¥${fmt(Math.abs(tx.amount))}</div>
    </div>
    <div class="flex-between" style="padding:11px 2px;border-bottom:1px solid var(--color-sep)">
      <span style="font-size:13px;color:var(--color-label-3);font-weight:700">📁 类别</span>
      <span style="font-size:13.5px;font-weight:700">${esc(tx.category)}</span>
    </div>
    <div class="flex-between" style="padding:11px 2px;border-bottom:1px solid var(--color-sep)">
      <span style="font-size:13px;color:var(--color-label-3);font-weight:700">🕐 时间</span>
      <span style="font-size:13.5px;font-weight:700">${formatTxDateTime(tx.date)}</span>
    </div>
    ${tx.note ? `<div class="flex-between" style="padding:11px 2px">
      <span style="font-size:13px;color:var(--color-label-3);font-weight:700">📝 备注</span>
      <span style="font-size:13.5px;font-weight:700;text-align:right">${esc(tx.note)}</span>
    </div>` : ''}
    <div class="flex-between" style="padding:11px 2px">
      <span style="font-size:13px;color:var(--color-label-3);font-weight:700">🔑 哈希值</span>
      <span style="font-size:12px;font-weight:600;font-family:monospace;color:var(--color-label-3)">${_txHash(tx)}</span>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="txDetailClose">关闭</button>
      <button class="btn btn-danger" id="txDetailDelete">🗑️ 删除</button>
    </div>`;

  document.getElementById('txDetailClose')?.addEventListener('click', closeTxDetail);
  document.getElementById('txDetailDelete')?.addEventListener('click', () => _deleteFromDetail(tx.id));
  document.getElementById('txDetailModal')?.classList.add('open');
}
export function closeTxDetail() {
  document.getElementById('txDetailModal')?.classList.remove('open');
}
function _deleteFromDetail(id) {
  if (!confirm('确认删除这条记录？')) return;
  deleteTransaction(id);
  closeTxDetail();
  showToast(t('toastTxDeleted'));
  render();
  import('./overview.js').then(m => m.render());
}

export function openEditTx(txId) {
  const tx = getTransactions().find(x => x.id === txId);
  if (!tx) return;

  const options = ALL_CATS.map(c =>
    `<option value="${esc(c)}" ${tx.category === c ? 'selected' : ''}>${getCatIcon(c)} ${esc(c)}</option>`
  ).join('');

  const gCat = tx.gCategory || '';
  const sourceTag = tx.source
    ? `<span class="tx-source-tag" title="${esc(tx.matchedRule || '')}">${_sourceLabel(tx.source)}</span>`
    : '';

  const content = document.getElementById('txDetailContent');
  if (!content) return;
  content.innerHTML = `
    <div style="padding:4px 0 16px;font-size:17px;font-weight:800">编辑记录</div>
    <div class="field"><label class="field-label">智能分类</label>
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <span style="font-size:14px;font-weight:700;background:var(--color-surface-2);padding:4px 12px;border-radius:var(--r-sm)">${esc(gCat)}</span>
        ${sourceTag}
      </div>
    </div>
    <div class="field">
      <label class="field-label">收支类型</label>
      <div class="segmented" style="width:100%">
        <button class="seg-pill ${tx.type === '支出' ? 'active' : ''}" style="flex:1" id="editTypeExp">支出</button>
        <button class="seg-pill ${tx.type === '收入' ? 'active' : ''}" style="flex:1" id="editTypeInc">收入</button>
      </div>
    </div>
    <div class="field"><label class="field-label">类别</label>
      <select class="field-select" id="editCategory">${options}</select></div>
    <div class="field"><label class="field-label">金额</label>
      <input class="field-input" id="editAmount" type="number" value="${Math.abs(tx.amount)}" step="0.01"></div>
    <div class="field"><label class="field-label">备注</label>
      <input class="field-input" id="editNote" value="${esc(tx.note || '')}"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="editCancel">取消</button>
      <button class="btn btn-primary" id="editSave">保存</button>
    </div>`;

  let editType = tx.type;
  const origCategory = tx.category;
  const origNote = tx.note || '';

  document.getElementById('editTypeExp')?.addEventListener('click', function () {
    editType = '支出'; this.classList.add('active');
    document.getElementById('editTypeInc')?.classList.remove('active');
  });
  document.getElementById('editTypeInc')?.addEventListener('click', function () {
    editType = '收入'; this.classList.add('active');
    document.getElementById('editTypeExp')?.classList.remove('active');
  });
  document.getElementById('editCancel')?.addEventListener('click', closeTxDetail);
  document.getElementById('editSave')?.addEventListener('click', () => {
    const newCat = document.getElementById('editCategory').value;
    const newAmt = parseFloat(document.getElementById('editAmount').value);
    const newNote = document.getElementById('editNote').value.trim();
    if (isNaN(newAmt) || newAmt <= 0) { showToast(t('toastInvalidAmount')); return; }

    const patch = { type: editType, category: newCat, amount: newAmt, note: newNote };

    // 如果用户修改了分类，标记 userOverride 并触发学习
    if (newCat !== origCategory || newNote !== origNote) {
      patch.userOverride = true;
      // 学习：用现有 gCategory 或新 category 做训练
      const effectiveCat = tx.gCategory || normalizeCategory(newCat);
      learn(newNote || newCat, effectiveCat);
    }

    updateTransaction(tx.id, patch);
    closeTxDetail();
    showToast(t('toastTxUpdated'));
    render();
    import('./overview.js').then(m => m.render());
  });

  document.getElementById('txDetailModal')?.classList.add('open');
}

// ════════════════════════════════════════════════════
//  DATA CLEANUP
// ════════════════════════════════════════════════════

export function openDataCleanup() {
  const txs = getTransactions();
  const catCounts = {};
  txs.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
  const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const dirty  = sorted.filter(([c]) => !ALL_CATS.includes(c));

  const content = document.getElementById('txDetailContent');
  if (!content) return;
  content.innerHTML = `
    <div style="padding:4px 0 12px;font-size:17px;font-weight:800">🧹 数据清理</div>
    <div style="font-size:12.5px;color:var(--color-label-3);margin-bottom:14px;font-weight:600">
      共 ${txs.length} 条记录，${sorted.length} 个类别
    </div>
    ${dirty.length ? `
      <div style="font-size:13px;font-weight:800;margin-bottom:8px;color:var(--color-orange)">⚠️ 可能需要清理的类别</div>
      ${dirty.map(([c, n]) => `
        <div class="tx-row" style="padding:10px 0;gap:10px;cursor:default">
          <div style="flex:1">
            <div style="font-size:13.5px;font-weight:700">${esc(c)}</div>
            <div style="font-size:11.5px;color:var(--color-label-4)">${n} 条记录</div>
          </div>
          <button class="btn btn-secondary btn-xs" data-reclass="${esc(c)}">重新归类</button>
          <button class="btn btn-danger btn-xs" data-delcat="${esc(c)}">删除</button>
        </div>`).join('')}
      <div class="divider" style="margin:12px 0"></div>
    ` : '<div style="font-size:13px;color:var(--color-green);padding:8px 0">✅ 所有记录类别均标准</div>'}
    <div style="font-size:13px;font-weight:800;margin-bottom:8px">全部类别</div>
    ${sorted.map(([c, n]) => `
      <div class="tx-row" style="padding:8px 0;gap:10px;cursor:default">
        <div class="tx-icon" style="background:linear-gradient(135deg,rgba(0,122,255,.12),rgba(175,82,222,.12));font-size:16px">${getCatIcon(c)}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:700">${esc(c)}</div></div>
        <div style="font-size:12px;color:var(--color-label-4)">${n} 条</div>
        <button class="btn btn-danger btn-xs" data-delcat="${esc(c)}">删除全部</button>
      </div>`).join('')}
    <div class="btn-row">
      <button class="btn btn-secondary" id="cleanupClose">关闭</button>
      <button class="btn btn-primary" id="openCatManageBtn">🗂️ 类目管理</button>
      <button class="btn btn-danger" id="cleanupRenormalize">批量重新归类</button>
    </div>`;

  content.querySelectorAll('[data-reclass]').forEach(btn =>
    btn.addEventListener('click', () => _reclassify(btn.dataset.reclass)));
  content.querySelectorAll('[data-delcat]').forEach(btn =>
    btn.addEventListener('click', () => _deleteCategory(btn.dataset.delcat)));
  document.getElementById('cleanupClose')?.addEventListener('click', closeTxDetail);
  document.getElementById('openCatManageBtn')?.addEventListener('click', () => {
    closeTxDetail();
    openCatManage();
  });
  document.getElementById('cleanupRenormalize')?.addEventListener('click', _renormalizeAll);

  document.getElementById('txDetailModal')?.classList.add('open');
}

function _reclassify(oldCat) {
  const newCat = normalizeCategory(oldCat);
  if (newCat === oldCat) { showToast(`"${oldCat}" 已是标准类别`); return; }
  const count = getTransactions().filter(t => t.category === oldCat).length;
  if (!confirm(`将 ${count} 条「${oldCat}」归类为「${newCat}」？`)) return;
  getTransactions().forEach(t => { if (t.category === oldCat) updateTransaction(t.id, { category: newCat }); });
  showToast(`✅ 已归类 ${count} 条为「${newCat}」`);
  openDataCleanup();
  render();
}
function _deleteCategory(cat) {
  const count = getTransactions().filter(t => t.category === cat).length;
  if (!confirm(`确认删除全部 ${count} 条「${cat}」记录？此操作不可撤销。`)) return;
  deleteByCategory(cat);
  showToast(`🗑️ 已删除 ${count} 条「${cat}」记录`);
  openDataCleanup();
  render();
  import('./overview.js').then(m => m.render());
}
function _renormalizeAll() {
  const total = getTransactions().length;
  if (!confirm(`对全部 ${total} 条记录重新执行智能归类？`)) return;
  const changed = renormalizeAllCategories();
  showToast(`✅ 完成，${changed} 条记录已更新`);
  openDataCleanup();
  render();
}

// ════════════════════════════════════════════════════
//  CATEGORY MANAGEMENT
// ════════════════════════════════════════════════════

export function openCatManage() {
  const modal = document.getElementById('catManageModal');
  if (!modal) return;
  _renderCatManage();
  modal.classList.add('open');
}

function _closeCatManage() {
  document.getElementById('catManageModal')?.classList.remove('open');
}

function _renderCatManage() {
  const listEl = document.getElementById('catManageList');
  if (!listEl) return;

  const builtIn = ALL_CATS;
  const custom  = getCustomCategories();

  listEl.innerHTML = `
    <div style="font-size:13px;font-weight:800;margin-bottom:8px">🏗️ 系统类目（不可删除）</div>
    ${builtIn.map(c => {
      const icon = getCatIcon(c);
      return `<div class="tx-row" style="padding:8px 0;gap:10px;cursor:default">
        <div class="tx-icon" style="background:linear-gradient(135deg,rgba(0,122,255,.12),rgba(175,82,222,.12));font-size:16px">${icon}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:700">${esc(c)}</div></div>
        <span style="font-size:11px;color:var(--color-label-4);font-weight:600">系统</span>
      </div>`;
    }).join('')}
    ${custom.length ? `
      <div class="divider" style="margin:10px 0"></div>
      <div style="font-size:13px;font-weight:800;margin-bottom:8px">✏️ 自定义类目</div>
      ${custom.map(c => {
        return `<div class="tx-row" style="padding:8px 0;gap:10px;cursor:default">
          <div class="tx-icon" style="background:linear-gradient(135deg,rgba(52,199,89,.12),rgba(0,199,190,.12));font-size:16px">${c.icon}</div>
          <div style="flex:1"><div style="font-size:13.5px;font-weight:700">${esc(c.v)}</div></div>
          <button class="btn btn-danger btn-xs" data-delcustom="${esc(c.v)}">删除</button>
        </div>`;
      }).join('')}
    ` : '<div style="font-size:12px;color:var(--color-label-4);padding:8px 0">暂无自定义类目</div>'}`;

  // Wire delete buttons
  listEl.querySelectorAll('[data-delcustom]').forEach(btn => {
    btn.addEventListener('click', () => _deleteCustomCat(btn.dataset.delcustom));
  });

  // Wire add button
  const addBtn = document.getElementById('addCatBtn');
  if (addBtn) {
    const newHandler = () => _addCustomCat();
    addBtn.replaceWith(addBtn.cloneNode(true));
    document.getElementById('addCatBtn')?.addEventListener('click', newHandler);
  }

  // Wire Enter key on input
  const input = document.getElementById('newCatName');
  if (input) {
    const enterHandler = (e) => { if (e.key === 'Enter') _addCustomCat(); };
    input.replaceWith(input.cloneNode(true));
    document.getElementById('newCatName')?.addEventListener('keydown', enterHandler);
  }

  // Wire close
  const closeBtn = document.getElementById('catManageClose');
  if (closeBtn) {
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    document.getElementById('catManageClose')?.addEventListener('click', _closeCatManage);
  }
}

function _addCustomCat() {
  const input = document.getElementById('newCatName');
  const name = input?.value.trim();
  if (!name) { showToast('请输入类目名称'); return; }

  const ok = addCustomCategory(name);
  if (!ok) { showToast(`类目「${name}」已存在`); return; }

  if (input) input.value = '';
  showToast(`✅ 类目「${name}」已添加`);
  _renderCatManage();
}

function _deleteCustomCat(v) {
  if (!confirm(`确认删除自定义类目「${v}」？已使用此类目的记录不会受影响。`)) return;
  removeCustomCategory(v);
  showToast(`🗑️ 类目「${v}」已删除`);
  _renderCatManage();
}

// ════════════════════════════════════════════════════
//  IMPORT (CSV / paste) + EXPORT
// ════════════════════════════════════════════════════

function _wireImportExport() {
  document.getElementById('csvInput')?.addEventListener('change', _handleCSVFile);
  document.getElementById('parsePasteBtn')?.addEventListener('click', _parsePaste);
  document.getElementById('loadSampleBtn')?.addEventListener('click', _loadSample);
  document.getElementById('clearDataBtn')?.addEventListener('click', _clearAll);

  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => _exportCSV(btn.dataset.export));
  });

  // Import tab switcher
  document.getElementById('importTabTx')?.addEventListener('click', () => _switchImportTab('tx'));
  document.getElementById('importTabAsset')?.addEventListener('click', () => _switchImportTab('asset'));
}

function _switchImportTab(tab) {
  document.getElementById('importPanelTx').style.display    = tab === 'tx' ? '' : 'none';
  document.getElementById('importPanelAsset').style.display = tab === 'asset' ? '' : 'none';
  document.getElementById('importTabTx')?.classList.toggle('active', tab === 'tx');
  document.getElementById('importTabAsset')?.classList.toggle('active', tab === 'asset');
}

// ── Column header detection ───────────────────────────
const HEADER_MAP = {
  date:     ['时间','日期','date','time'],
  type:     ['收支','类型','收支类型','type'],
  amount:   ['金额','amount','money'],
  category: ['类别','分类','category'],
  note:     ['备注','说明','note','memo'],
};
function _detectColumns(headerCols) {
  const idx = { date:-1, type:-1, amount:-1, category:-1, note:-1 };
  headerCols.forEach((h, i) => {
    const clean = h.replace(/^\uFEFF/, '').trim().toLowerCase();
    for (const key in HEADER_MAP) {
      if (idx[key] === -1 && HEADER_MAP[key].some(a => clean === a || clean.includes(a))) idx[key] = i;
    }
  });
  return idx;
}

function _parseRow(cols, idx) {
  if (!cols?.length) return null;
  const get = (key, fb) => (idx[key] >= 0 && idx[key] < cols.length) ? cols[idx[key]]
                          : (fb !== undefined && fb < cols.length ? cols[fb] : '');
  const date = normalizeDate(get('date', 0));
  if (!date) return null;

  let amount = parseMoney(get('amount', 2));
  if (isNaN(amount)) return null;

  const typeRaw = get('type', 1);
  let type;
  if (/收/.test(typeRaw)) type = '收入';
  else if (/支/.test(typeRaw)) type = '支出';
  else type = amount < 0 ? '支出' : '收入';

  const categoryRaw = get('category', 3) || '';
  const note = get('note', 4) || '';
  const category = normalizeCategory(categoryRaw || note);

  const isInvestment = category === '理财';
  if (type === '支出' || (type === '收入' && !isInvestment)) amount = Math.abs(amount);
  if (amount === 0) return null;

  return { id: `t${Date.now()}${Math.random().toString(36).slice(2,8)}`,
           date, type, amount, category, note };
}

function _handleCSVFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => _parseCSV(ev.target.result, 'dedupBanner');
  reader.readAsText(file, 'UTF-8');
}

function _parseCSV(text, bannerId) {
  const lines = splitCSVLines(text);
  if (lines.length < 2) { _banner(bannerId, '⚠️ 文件内容为空', 'warn'); return; }
  const idx = _detectColumns(splitCSVLine(lines[0]));
  const parsed = []; let failed = 0;
  for (let i = 1; i < lines.length; i++) {
    const tx = _parseRow(splitCSVLine(lines[i]), idx);
    tx ? parsed.push(tx) : failed++;
  }
  _commitImport(parsed, bannerId, failed);
}

function _parsePaste() {
  const text = document.getElementById('pasteData')?.value.trim();
  if (!text) { showToast('⚠️ 请先粘贴数据'); return; }
  const lines = splitCSVLines(text);
  const first = lines[0].split(/\t|,/).map(c => c.trim());
  const looksHeader = first.some(c => ['时间','日期','收支','类型','金额','类别','分类','备注','说明'].includes(c));
  const start = looksHeader ? 1 : 0;
  const idx = looksHeader ? _detectColumns(first) : { date:0, type:1, amount:2, category:3, note:4 };
  const parsed = []; let failed = 0;
  for (let i = start; i < lines.length; i++) {
    const tx = _parseRow(lines[i].split(/\t|,/).map(c => c.trim()), idx);
    tx ? parsed.push(tx) : failed++;
  }
  _commitImport(parsed, 'dedupBanner2', failed);
}

function _commitImport(parsed, bannerId, failed) {
  if (!parsed.length) {
    _banner(bannerId, `⚠️ 未能解析任何有效数据${failed ? `（${failed} 行格式无法识别）` : ''}`, 'warn');
    return;
  }
  const { added, duplicates } = addTransactions(parsed);
  if (!added) { _banner(bannerId, `⚠️ 本次 ${parsed.length} 条均已存在`, 'warn'); return; }

  let msg = `✅ 成功导入 <strong>${added}</strong> 条`;
  if (duplicates) msg += ` · 过滤 <strong>${duplicates}</strong> 条重复`;
  if (failed)     msg += ` · <strong>${failed}</strong> 行无法识别`;
  _banner(bannerId, msg, duplicates || failed ? 'warn' : 'ok');

  const pasteEl = document.getElementById('pasteData');
  if (pasteEl) pasteEl.value = '';
  showToast(t('toastImportOk', { n: added }));
  render();
  import('./overview.js').then(m => m.render());
}

function _banner(id, msg, type) {
  const el = document.getElementById(id); if (!el) return;
  el.className = `banner show ${type === 'ok' ? 'banner-ok' : 'banner-warn'}`;
  el.innerHTML = msg;
}

function _clearAll() {
  if (!confirm('确认清空所有交易记录？')) return;
  clearTransactions();
  showToast(t('toastClearDone'));
  render();
  import('./overview.js').then(m => m.render());
}

function _loadSample() {
  const el = document.getElementById('pasteData');
  if (!el) return;
  el.value = [
    '2025-01-05\t收入\t12000\t工资\t1月薪资',
    '2025-01-08\t支出\t3200\t房租\t1月房租',
    '2025-01-10\t支出\t280\t餐饮\t聚餐',
    '2025-01-18\t收入\t2000\t兼职\t设计项目',
    '2025-02-03\t收入\t12000\t工资\t2月薪资',
    '2025-02-05\t支出\t3200\t房租\t2月房租',
    '2025-03-01\t收入\t12000\t工资\t3月薪资',
    '2025-03-22\t收入\t1200\t兼职\t翻译项目',
  ].join('\n');
  showToast('示例数据已填入，点击「解析并导入」');
}

// ── CSV export ─────────────────────────────────────────
function _csvEscape(v) {
  v = String(v ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function _download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _exportCSV(kind) {
  const today = new Date();
  const stamp = `${today.getFullYear()}${pad2(today.getMonth()+1)}${pad2(today.getDate())}`;

  if (kind === 'tx') {
    const txs = getTransactions();
    if (!txs.length) { showToast(t('toastNoData')); return; }
    const rows = [['时间','收支','类别','金额','备注','智能分类','分类来源'].join(','),
      ...[...txs].sort((a,b)=>new Date(a.date)-new Date(b.date))
        .map(t => [t.date, t.type, t.category, t.amount, t.note || '', t.gCategory || '', t.source || ''].map(_csvEscape).join(','))];
    _download(`Roadster_记账数据_${stamp}.csv`, '\uFEFF' + rows.join('\n'), 'text/csv;charset=utf-8');
    showToast(t('toastExportDone'));
  }
  // asset-csv / asset-history-csv are handled in pages/assets.js
}

// ════════════════════════════════════════════════════
//  AI 分类辅助函数
// ════════════════════════════════════════════════════

/**
 * 生成 gCategory 徽章 HTML
 * @param {Transaction} tx
 * @returns {string}
 */
function _gCategoryBadge(tx) {
  if (!tx.gCategory || tx.gCategory === '其他') return '';

  const colorMap = {
    '餐饮': '#ff9500',
    '交通': '#5ac8fa',
    '购物': '#ff2d55',
    '住房': '#af52de',
    '娱乐': '#30d158',
    '医疗': '#ff3b30',
    '教育': '#5856d6',
    '收入': '#34c759',
    '投资': '#ffd60a',
    '其他': '#8e8e93',
  };
  const color = colorMap[tx.gCategory] || '#8e8e93';
  const sourceLabel = _sourceLabel(tx.source);

  return `<span class="tx-gcat-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;font-size:11px;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:600;display:inline-flex;align-items:center;gap:3px">
    ${esc(tx.gCategory)}
    ${sourceLabel ? `<span style="font-size:9px;opacity:0.7">${sourceLabel}</span>` : ''}
  </span>`;
}

/**
 * 来源标签文字
 * @param {string} source
 * @returns {string}
 */
function _sourceLabel(source) {
  if (!source) return '';
  const map = {
    'merchant': '🏪 商户',
    'rule':     '📏 规则',
    'user':     '🧠 记忆',
    'ai':       '🤖 AI',
    'none':     '',
  };
  return map[source] || '';
}

/**
 * 分类来源标签 HTML（新功能 2）
 * @param {Transaction} tx
 * @returns {string}
 */
function _sourceTagHtml(tx) {
  const source = tx.source;
  if (source === 'none') return '';
  // 历史存量数据 source 字段缺失，默认视为手动添加
  const effectiveSource = source || 'user';

  const map = {
    'ai':       { icon: '🤖', label: 'AI分类', color: '#af52de' },
    'rule':     { icon: '⚡', label: '自动',   color: '#5ac8fa' },
    'merchant': { icon: '🏪', label: '自动',   color: '#34c759' },
    'user':     { icon: '✋', label: '手动',   color: '#ff9500' },
  };
  const cfg = map[effectiveSource];
  if (!cfg) return '';

  return `<span class="tx-tag tx-tag--source" style="background:${cfg.color}18;color:${cfg.color};border:1px solid ${cfg.color}33;font-size:10.5px;padding:1px 5px;border-radius:3px;margin-left:5px;font-weight:500;display:inline-flex;align-items:center;gap:2px;opacity:0.85">${cfg.icon} ${cfg.label}</span>`;
}

/**
 * 存储位置标签 HTML（v2.3：基于登录状态，不再依赖 tx.syncStatus）
 * @param {Transaction} tx
 * @returns {string}
 */
function _storageTagHtml(tx) {
  // v2.3: 登录 = 云端，未登录 = 本地
  const loggedIn = isLoggedIn();

  if (loggedIn) {
    return '<span class="tx-tag tx-tag--storage" style="background:rgba(52,199,89,.12);color:#34c759;border:1px solid rgba(52,199,89,.2);font-size:10.5px;padding:1px 5px;border-radius:3px;margin-left:5px;font-weight:500;display:inline-flex;align-items:center;gap:2px;opacity:0.75">☁️ 云端</span>';
  }
  return '<span class="tx-tag tx-tag--storage" style="background:rgba(142,142,147,.12);color:var(--color-label-3);border:1px solid rgba(142,142,147,.18);font-size:10.5px;padding:1px 5px;border-radius:3px;margin-left:5px;font-weight:500;display:inline-flex;align-items:center;gap:2px;opacity:0.75">💻 本地</span>';
}

/**
 * 交易唯一哈希值（djb2，32-bit hex）。
 * 基于 id+date+type+amount+category+note 生成，任意字段不同则哈希不同。
 * @param {Transaction} tx
 * @returns {string}
 */
function _txHash(tx) {
  const raw = `${tx.id}|${tx.date}|${tx.type}|${tx.amount}|${tx.category}|${tx.note || ''}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
