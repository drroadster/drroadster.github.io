// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · pages/overview.js
//  Overview page: greeting, net balance hero, trend chart,
//  category lists, recent transactions list.
// ═══════════════════════════════════════════════════════

import { getTransactions, filterByPeriod, summarise, catTotals, getBudgetStats, subscribe } from '../store.js';
import { buildLineChart, cssVar, hexToRgba, palette } from '../charts.js';
import { fmt, fmtK, esc, formatTxDateTime, pad2 } from '../utils.js';
import { t } from '../i18n.js';
import { onNavigate, navigate } from '../router.js';
import { CAT_ICONS, getCatIcon } from '../config.js';

let _period = 'month';
let _catDetailData = {};   // { categoryName: { transactions: [...], total: number, pct: number } }
let _catDetailSort = 'time';

// ── Public init ────────────────────────────────────────
export function initOverviewPage() {
  _wireControls();
  _wireBudgetLink();
  // Auto-refresh budget when store data changes
  subscribe('any', () => {
    if (document.getElementById('page-overview')?.classList.contains('active')) {
      if (_period === 'month') _renderBudget();
    }
  });
  onNavigate(page => { if (page === 'overview') render(); });
}

/** Re-render (called externally after data import / theme change). */
export function render() {
  _setGreeting();
  const all = getTransactions();
  const txs = filterByPeriod(_period, all);
  const { income, expense, net, saveRate } = summarise(txs);

  let mom = null;
  if (_period === 'month') mom = _computeMoM(all);

  _renderHero(net, txs.length);
  _renderHeroStats(income, expense, saveRate, mom);
  _renderBudget();
  _renderTrendChart(txs);
  _renderPies(txs);
  _renderRecent(txs);
}

// ── Controls (period segmented buttons) ────────────────
function _wireControls() {
  document.querySelectorAll('#periodSeg .seg-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _period = btn.dataset.period;
      document.querySelectorAll('#periodSeg .seg-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });
}

// ── Greeting ────────────────────────────────────────────
function _setGreeting() {
  const el = document.getElementById('greetingText');
  if (!el) return;
  const h = new Date().getHours();
  let key = 'overviewGreetMorning';
  if (h >= 12 && h < 14) key = 'overviewGreetNoon';
  else if (h >= 14 && h < 18) key = 'overviewGreetAfternoon';
  else if (h >= 18 && h < 23) key = 'overviewGreetEvening';
  else if (h >= 23 || h < 5)  key = 'overviewGreetLate';
  el.textContent = t(key);
}

// ── Hero ────────────────────────────────────────────────
function _renderHero(net, count) {
  const valEl = document.getElementById('netAmount');
  const subEl = document.getElementById('netSub');
  if (valEl) valEl.textContent = `${net >= 0 ? '+' : '−'}¥${fmt(Math.abs(net))}`;
  if (subEl) {
    const label = { month: t('periodMonth'), quarter: t('periodQuarter'),
                     year: t('periodYear'), all: t('periodAll') }[_period];
    subEl.textContent = count ? `${count} 笔交易 · ${label}` : '暂无数据';
  }
}
function _renderHeroStats(income, expense, saveRate, mom) {
  const incEl  = document.getElementById('heroIncome');
  const expEl  = document.getElementById('heroExpense');
  const rateEl = document.getElementById('heroSaveRate');

  function _momHtml(cur, prev) {
    if (prev === null || prev === undefined || prev === 0) return '';
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    if (!isFinite(pct)) return '';
    const up = pct >= 0;
    return ` <span class="hero-stat-mom ${up ? 'up' : 'down'}">${up ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%</span>`;
  }

  if (incEl) {
    incEl.innerHTML = `¥${fmt(income)}${mom ? _momHtml(income, mom.income) : ''}`;
  }
  if (expEl) {
    expEl.innerHTML = `¥${fmt(expense)}${mom ? _momHtml(expense, mom.expense) : ''}`;
  }
  if (rateEl) {
    const currRate = saveRate !== null ? saveRate : null;
    const prevRate = mom && mom.saveRate !== null ? mom.saveRate : null;
    let momPart = '';
    if (currRate !== null && prevRate !== null && prevRate !== 0) {
      const pctDiff = (currRate - prevRate) * 100;
      if (isFinite(pctDiff)) {
        const up = pctDiff >= 0;
        momPart = ` <span class="hero-stat-mom ${up ? 'up' : 'down'}">${up ? '↑' : '↓'}${Math.abs(pctDiff).toFixed(1)}pp</span>`;
      }
    }
    rateEl.innerHTML = `${currRate !== null ? Math.round(currRate * 100) + '%' : '—'}${momPart}`;
  }
}

// ── Budget ────────────────────────────────────────────
let _budgetRingChart = null;

function _wireBudgetLink() {
  const link = document.querySelector('.budget-manage-link');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('settings');
    });
  }
}

function _renderBudget() {
  const section = document.getElementById('budgetSection');
  if (!section) return;

  const now = new Date();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const stats = getBudgetStats(monthYear);

  if (!stats || stats.totalBudget === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  // ── Ring chart ──
  const spent = stats.totalSpent;
  const remaining = Math.max(stats.totalBudget - spent, 0);
  const progress = stats.totalProgress;

  const canvas = document.getElementById('budgetRingChart');
  if (canvas) {
    if (_budgetRingChart) { _budgetRingChart.destroy(); _budgetRingChart = null; }

    const trackColor = cssVar('--glass-input');
    const spentColor = progress >= 100
      ? cssVar('--color-red')
      : progress > 80
        ? cssVar('--color-orange')
        : cssVar('--color-green');

    _budgetRingChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: remaining > 0 ? [spent, remaining] : [spent],
          backgroundColor: [spentColor, trackColor],
          borderWidth: 0,
          borderRadius: spent > 0 && remaining > 0 ? 99 : 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  }

  // Center text
  const pctEl = document.getElementById('budgetPercent');
  const sumEl = document.getElementById('budgetSummary');
  if (pctEl) pctEl.textContent = `${Math.min(progress, 999)}%`;
  if (sumEl) sumEl.textContent = `¥${fmt(spent)} / ¥${fmt(stats.totalBudget)}`;

  // ── Category progress bars ──
  const listEl = document.getElementById('budgetCategoryList');
  if (!listEl) return;

  if (!stats.categories.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--color-label-4);padding:8px 0;text-align:center">暂无分类预算</div>';
    return;
  }

  listEl.innerHTML = stats.categories.map(c => {
    const barProgress = Math.min(c.progress, 100);
    let barCls = '';
    if (c.progress > 100) barCls = 'over';
    else if (c.progress > 80) barCls = 'warn';

    return `<div class="budget-category-row">
      <span class="budget-cat-icon">${esc(c.icon)}</span>
      <span class="budget-cat-name">${esc(c.label)}</span>
      <div class="budget-bar">
        <div class="budget-bar-fill ${barCls}" style="width:${barProgress}%"></div>
      </div>
      <span class="budget-cat-amounts">¥${fmt(c.spent)} / ¥${fmt(c.budget)}</span>
    </div>`;
  }).join('');
}

// ── Month-over-Month helper ────────────────────────────
function _getPrevMonthTxs(allTxs) {
  const now = new Date();
  let pm = now.getMonth() - 1;
  let py = now.getFullYear();
  if (pm < 0) { pm = 11; py--; }
  return allTxs.filter(t => {
    if (t.deleted) return false;
    const d = new Date(t.date);
    return d.getFullYear() === py && d.getMonth() === pm;
  });
}

function _computeMoM(allTxs) {
  const prevTxs = _getPrevMonthTxs(allTxs);
  if (!prevTxs.length) return null;
  return summarise(prevTxs);
}

// ── Trend chart (granularity adapts to period) ─────────
function _renderTrendChart(txs) {
  const canvas   = document.getElementById('trendChart');
  const emptyEl  = document.getElementById('trendEmpty');
  if (!canvas) return;

  if (!txs.length) {
    canvas.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  canvas.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  // Granularity: month period → daily buckets; quarter → weekly; year/all → monthly
  const granularity = _period === 'month' ? 'day' : _period === 'quarter' ? 'week' : 'month';

  const groups = {};
  function bucketKey(d) {
    if (granularity === 'day') return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (granularity === 'week') {
      const first = new Date(d.getFullYear(), 0, 1);
      const days  = Math.floor((d - first) / 86400000);
      const week  = Math.ceil((days + first.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${pad2(week)}`;
    }
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function bucketLabel(key, d) {
    if (granularity === 'day')  return `${d.getMonth() + 1}/${d.getDate()}`;
    if (granularity === 'week') return key.split('-W')[1] + '周';
    return key;
  }

  txs.forEach(tx => {
    const d = new Date(tx.date);
    const k = bucketKey(d);
    if (!groups[k]) groups[k] = { income: 0, expense: 0, label: bucketLabel(k, d) };
    if (tx.type === '收入') groups[k].income += tx.amount;
    else                    groups[k].expense += tx.amount;
  });

  let labels, incomeData, expenseData;

  if (granularity === 'day') {
    // Fill in missing days for a continuous curve
    const sortedKeys = Object.keys(groups).sort();
    const first = new Date(sortedKeys[0]);
    const last  = new Date(sortedKeys[sortedKeys.length - 1]);
    labels = []; incomeData = []; expenseData = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      const k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      incomeData.push(groups[k]?.income ?? 0);
      expenseData.push(groups[k]?.expense ?? 0);
    }
  } else {
    const sortedKeys = Object.keys(groups).sort();
    labels      = sortedKeys.map(k => groups[k].label);
    incomeData  = sortedKeys.map(k => groups[k].income);
    expenseData = sortedKeys.map(k => groups[k].expense);
  }

  buildLineChart('trendChart', labels, [
    { label: t('totalIncome'),  data: incomeData,  color: cssVar('--color-green'), fill: true },
    { label: t('totalExpense'), data: expenseData, color: cssVar('--color-red'),   fill: true, fillAlpha: 0.08 },
  ]);
}

// ── Category lists (replaces Chart.js doughnuts) ──────
function _renderPies(txs) {
  const expCats = catTotals(txs, '支出');
  const incCats = catTotals(txs, '收入');
  const hasData = Object.values(expCats).some(v => v > 0) || Object.values(incCats).some(v => v > 0);

  const section = document.getElementById('pieSection');
  if (section) section.style.display = hasData ? '' : 'none';
  if (!hasData) return;

  _catDetailData = {};
  _buildCatList('expenseLegend', expCats, txs, '支出');
  _buildCatList('incomeLegend',  incCats,  txs, '收入');

  // Wire sheet overlay close
  const overlay = document.getElementById('catDetailOverlay');
  if (overlay) {
    overlay.onclick = e => { if (e.target === overlay) _closeCatDetail(); };
  }
  // Wire sort segmented control
  document.querySelectorAll('#catDetailSortSeg .seg-pill').forEach(btn => {
    btn.onclick = () => {
      _catDetailSort = btn.dataset.sort;
      document.querySelectorAll('#catDetailSortSeg .seg-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderCatDetail();
    };
  });
}

function _buildCatList(legendId, catMap, allTxs, type) {
  const sorted = Object.entries(catMap)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const colors = palette();

  const legEl = document.getElementById(legendId);
  if (!legEl) return;

  if (!sorted.length) {
    legEl.innerHTML = '<div style="font-size:12px;color:var(--color-label-4);padding:8px 0">暂无数据</div>';
    return;
  }

  legEl.className = 'cat-list';

  // Store data for detail sheet
  sorted.forEach(([name, val]) => {
    const txsOfCat = allTxs.filter(tx => tx.category === name && tx.type === type);
    _catDetailData[name] = {
      transactions: txsOfCat,
      total: val,
      pct: total > 0 ? ((val / total) * 100).toFixed(1) : 0,
    };
  });

  legEl.innerHTML = sorted.map(([name, val], i) => {
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
    const color = colors[i % colors.length];
    const icon = getCatIcon(name);
    return `<div class="cat-list-row" data-cat-name="${esc(name)}">
      <div class="cat-list-icon" style="background:${color}22;color:${color}">${icon}</div>
      <span class="cat-list-name">${esc(name)}</span>
      <span class="cat-list-amount">¥${fmt(val)}</span>
      <span class="cat-list-pct">${pct}%</span>
    </div>`;
  }).join('');

  // Wire click handlers
  legEl.querySelectorAll('.cat-list-row').forEach(row => {
    row.addEventListener('click', () => _openCatDetail(row.dataset.catName));
  });
}

// ── Category Detail Sheet ─────────────────────────────
function _openCatDetail(catName) {
  const data = _catDetailData[catName];
  if (!data) return;

  const overlay = document.getElementById('catDetailOverlay');
  const titleEl = document.getElementById('catDetailTitle');
  if (!overlay || !titleEl) return;

  titleEl.textContent = `${catName} · ¥${fmt(data.total)} (${data.pct}%)`;
  _catDetailSort = 'time';
  // Reset sort pill
  document.querySelectorAll('#catDetailSortSeg .seg-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === 'time');
  });

  _renderCatDetail();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _closeCatDetail() {
  const overlay = document.getElementById('catDetailOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function _renderCatDetail() {
  const catName = (document.getElementById('catDetailTitle')?.textContent || '').split(' · ')[0];
  const data = _catDetailData[catName];
  const listEl = document.getElementById('catDetailList');
  if (!listEl || !data) return;

  let txs = [...data.transactions];

  // Sort
  switch (_catDetailSort) {
    case 'amount-desc': txs.sort((a, b) => b.amount - a.amount); break;
    case 'amount-asc':  txs.sort((a, b) => a.amount - b.amount);  break;
    default:            txs.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
  }

  if (!txs.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--color-label-4);font-size:13px">暂无记录</div>';
    return;
  }

  listEl.innerHTML = txs.map(tx => {
    const isGain = tx.type === '收入';
    const color = isGain ? 'var(--color-green)' : 'var(--color-orange)';
    const icon = getCatIcon(tx.category);
    const timeDisplay = formatTxDateTime(tx.date);
    const amountCls = isGain ? 'income' : 'expense';

    return `<div class="cat-detail-row">
      <div class="cat-detail-icon" style="background:${color}18;color:${color}">${icon}</div>
      <div class="cat-detail-info">
        <div class="cat-detail-note">${esc(tx.category)}${tx.note ? ' · ' + esc(tx.note) : ''}</div>
        <div class="cat-detail-date">${timeDisplay}</div>
      </div>
      <div class="cat-detail-amount ${amountCls}">¥${fmt(Math.abs(tx.amount))}</div>
    </div>`;
  }).join('');
}

// ── Recent transactions list ──────────────────────────
function _renderRecent(txs) {
  const el = document.getElementById('recentTxList');
  if (!el) return;
  const recent = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  el.innerHTML = recent.length
    ? recent.map(_txRowHtml).join('')
    : `<div class="empty-state"><div class="empty-icon">📋</div>
         <div class="empty-text">还没有交易记录<br>点击右下角「＋」开始记录</div></div>`;

  // Wire click handlers to open detail (deferred import to avoid cycle)
  el.querySelectorAll('[data-tx-id]').forEach(row => {
    row.addEventListener('click', () => {
      import('./transactions.js').then(m => m.openTxDetail(row.dataset.txId));
    });
  });
}

function _txRowHtml(tx) {
  const isLoss = tx.type === '收入' && tx.amount < 0;
  const isGain = tx.type === '收入' && tx.amount >= 0;
  const sign   = isLoss ? '−' : (isGain ? '+' : '−');
  const cls    = isGain ? 'income' : (isLoss ? 'loss' : '');
  const bg     = isGain
    ? 'linear-gradient(135deg,rgba(52,199,89,.16),rgba(0,199,190,.16))'
    : isLoss
      ? 'linear-gradient(135deg,rgba(255,59,48,.16),rgba(255,149,0,.12))'
      : 'linear-gradient(135deg,rgba(0,122,255,.14),rgba(175,82,222,.14))';
  const icon = isLoss ? '📉' : (getCatIcon(tx.category));

  return `<div class="tx-row" data-tx-id="${tx.id}">
    <div class="tx-icon" style="background:${bg}">${icon}</div>
    <div class="tx-info">
      <div class="tx-name">${esc(tx.category)}${tx.note ? ' · ' + esc(tx.note) : ''}${isLoss ? ' · 亏损' : ''}</div>
      <div class="tx-meta">${formatTxDateTime(tx.date)}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}¥${fmt(Math.abs(tx.amount))}</div>
  </div>`;
}
