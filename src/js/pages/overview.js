// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · pages/overview.js
//  Overview page: greeting, net balance hero, trend chart,
//  category pies, recent transactions list.
// ═══════════════════════════════════════════════════════

import { getTransactions, filterByPeriod, summarise, catTotals } from '../store.js';
import { buildLineChart, buildDoughnut, cssVar, hexToRgba } from '../charts.js';
import { fmt, fmtK, esc, formatTxDateTime, pad2 } from '../utils.js';
import { t } from '../i18n.js';
import { onNavigate } from '../router.js';
import { CAT_ICONS } from '../config.js';

let _period = 'month';

// ── Public init ────────────────────────────────────────
export function initOverviewPage() {
  _wireControls();
  onNavigate(page => { if (page === 'overview') render(); });
}

/** Re-render (called externally after data import / theme change). */
export function render() {
  _setGreeting();
  const all = getTransactions();
  const txs = filterByPeriod(_period, all);
  const { income, expense, net, saveRate } = summarise(txs);

  _renderHero(net, txs.length);
  _renderHeroStats(income, expense, saveRate);
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
function _renderHeroStats(income, expense, saveRate) {
  const incEl  = document.getElementById('heroIncome');
  const expEl  = document.getElementById('heroExpense');
  const rateEl = document.getElementById('heroSaveRate');
  if (incEl)  incEl.textContent  = `¥${fmt(income)}`;
  if (expEl)  expEl.textContent  = `¥${fmt(expense)}`;
  if (rateEl) rateEl.textContent = saveRate !== null ? `${Math.round(saveRate * 100)}%` : '—';
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

// ── Category pies ──────────────────────────────────────
function _renderPies(txs) {
  const expCats = catTotals(txs, '支出');
  const incCats = catTotals(txs, '收入');
  const hasData = Object.values(expCats).some(v => v > 0) || Object.values(incCats).some(v => v > 0);

  const section = document.getElementById('pieSection');
  if (section) section.style.display = hasData ? '' : 'none';
  if (!hasData) return;

  buildDoughnut('expensePieChart', Object.keys(expCats), Object.values(expCats), 'expenseLegend');
  buildDoughnut('incomePieChart',  Object.keys(incCats), Object.values(incCats), 'incomeLegend');
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
  const icon = isLoss ? '📉' : (CAT_ICONS[tx.category] || '💳');

  return `<div class="tx-row" data-tx-id="${tx.id}">
    <div class="tx-icon" style="background:${bg}">${icon}</div>
    <div class="tx-info">
      <div class="tx-name">${esc(tx.category)}${tx.note ? ' · ' + esc(tx.note) : ''}${isLoss ? ' · 亏损' : ''}</div>
      <div class="tx-meta">${formatTxDateTime(tx.date)}</div>
    </div>
    <div class="tx-amount ${cls}">${sign}¥${fmt(Math.abs(tx.amount))}</div>
  </div>`;
}
