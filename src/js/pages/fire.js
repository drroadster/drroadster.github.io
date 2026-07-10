// ═══════════════════════════════════════════════════════
//  ROADSTER v2.3 · pages/fire.js
//  FIRE (Financial Independence, Retire Early) analysis page.
//  Data source: store.js (real user transactions + assets).
//  Settings stored in localStorage key `fire_settings`.
// ═══════════════════════════════════════════════════════

import { getTransactions, getAssets, getAssetHistory, subscribe } from '../store.js';
import { onNavigate, showToast } from '../router.js';

// ── FIRE Types ────────────────────────────────────────
const FIRE_TYPES = [
  { key: 'lean',    name: 'Lean FIRE',    icon: '🌱', color: '#30D9A0', desc: '精简生活，7成日常支出', mult: 0.7 },
  { key: 'barista', name: 'Barista FIRE', icon: '☕', color: '#FFC24D', desc: '兼职收入覆盖一半支出', mult: 0.5 },
  { key: 'coast',   name: 'Coast FIRE',   icon: '⛵', color: '#4DA3FF', desc: '停止储蓄，靠增值达标', mult: null },
  { key: 'regular', name: '标准 FIRE',    icon: '🔥', color: '#FF9F43', desc: '4%法则覆盖全部支出', mult: 1 },
  { key: 'fat',     name: 'Fat FIRE',     icon: '💎', color: '#B98CFF', desc: '宽裕生活，1.75倍支出', mult: 1.75 },
];

const ASSET_CATS = [
  { key: '现金/储蓄', color: '#4DA3FF' },
  { key: '基金/股票', color: '#30D9A0' },
  { key: '公积金/社保', color: '#B98CFF' },
  { key: '房产',      color: '#FFC24D' },
  { key: '车辆',      color: '#FF9F43' },
  { key: '加密货币',  color: '#FF6961' },
  { key: '固定资产',  color: '#8E8E93' },
  { key: '其他投资',  color: '#8E8E93' },
];

// ── Default Settings ──────────────────────────────────
const DEFAULT_SETTINGS = {
  monthlyExpense: 8000,
  swr: 4,
  age: null,
  retireAge: 60,
  expectedReturn: 7,
  volatility: 15,
  inflation: 2.5,
};

// ── State ─────────────────────────────────────────────
let _initialized = false;
let _settings = { ...DEFAULT_SETTINGS };
let _mcResult = null;
let _mcDebounce = null;

// ── Helpers ───────────────────────────────────────────
function fmtMoney(n) {
  n = Math.round(n || 0);
  return '¥' + n.toLocaleString('zh-CN');
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthKey(d) { return d.slice(0, 7); }
function randNormal(mean, std) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + std * z;
}

// ── Settings persistence ──────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem('fire_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      _settings = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      _settings = { ...DEFAULT_SETTINGS };
    }
  } catch (e) {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

function saveSettings() {
  try {
    localStorage.setItem('fire_settings', JSON.stringify(_settings));
  } catch (e) {
    console.error('[fire] Failed to save settings:', e);
  }
}

// ── Data mapping: Roadster store → FIRE internal format ──
function getMappedTransactions() {
  const txs = getTransactions();
  return txs.map(t => ({
    id: t.id,
    date: t.date ? t.date.slice(0, 10) : todayStr(),
    type: t.type === '收入' ? 'income' : 'expense',
    cat: t.category || '其他',
    amount: Number(t.amount) || 0,
    note: t.note || '',
  }));
}

function getMappedAssets() {
  const assets = getAssets();
  return assets.map(a => ({
    id: a.id,
    key: a.category || '其他',
    name: a.name || '资产',
    amount: Number(a.value) || 0,
  }));
}

// ── FIRE Calculations ─────────────────────────────────
function netWorth(assets) {
  return assets.reduce((s, a) => s + (Number(a.amount) || 0), 0);
}

function annualExpense(settings) {
  return (settings.monthlyExpense || 0) * 12;
}

function realReturnPct(settings) {
  const nom = settings.expectedReturn || 0;
  const inf = settings.inflation || 0;
  return ((1 + nom / 100) / (1 + inf / 100) - 1) * 100;
}

function monthFlow(transactions) {
  const mk = monthKey(todayStr());
  let income = 0, expense = 0;
  transactions.forEach(t => {
    if (monthKey(t.date) === mk) {
      if (t.type === 'income') income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    }
  });
  return { income, expense };
}

function avgMonthlyNetSavings(transactions, settings) {
  const byMonth = {};
  transactions.forEach(t => {
    const mk = monthKey(t.date);
    byMonth[mk] = byMonth[mk] || { income: 0, expense: 0 };
    if (t.type === 'income') byMonth[mk].income += Number(t.amount) || 0;
    else byMonth[mk].expense += Number(t.amount) || 0;
  });
  const months = Object.keys(byMonth);
  if (months.length === 0) return Math.max(0, (settings.monthlyExpense || 0) * 0.3);
  let total = 0;
  months.forEach(mk => { total += (byMonth[mk].income - byMonth[mk].expense); });
  return total / months.length;
}

function contribution(settings, transactions) {
  return avgMonthlyNetSavings(transactions, settings);
}

function fireTargets(settings) {
  const ae = annualExpense(settings);
  const swr = settings.swr || 4;
  const regular = ae / (swr / 100);
  const years = Math.max(0, (settings.retireAge || 60) - (settings.age || 30));
  const r = realReturnPct(settings) / 100;
  const coast = years > 0 ? regular / Math.pow(1 + r, years) : regular;

  const out = {};
  FIRE_TYPES.forEach(ft => {
    if (ft.key === 'coast') out[ft.key] = coast;
    else out[ft.key] = ae * ft.mult / (swr / 100);
  });
  return out;
}

function genericProjection(nw, target, contrib, realRetPct) {
  const monthlyReturn = Math.pow(1 + realRetPct / 100, 1 / 12) - 1;
  let months = 0, maxMonths = 600, cur = nw;
  while (cur < target && months < maxMonths) {
    cur = cur * (1 + monthlyReturn) + contrib;
    months++;
  }
  return cur >= target ? months : null;
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const mx = (p0.x + p1.x) / 2;
    d += ' C ' + mx + ' ' + p0.y + ', ' + mx + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y;
  }
  return d;
}

// ── Monte Carlo ───────────────────────────────────────
function monteCarloAccumulate(nw0, contrib, realRetPct, volPct, months, target) {
  const N = 400;
  const sampleEvery = Math.max(1, Math.round(months / 40));
  const numSamples = Math.floor(months / sampleEvery) + 1;
  const matrix = [];
  for (let s = 0; s < numSamples; s++) matrix.push([]);

  const monthlyMean = realRetPct / 100 / 12;
  const monthlyStd = (volPct / 100) / Math.sqrt(12);
  let reached = 0;

  for (let i = 0; i < N; i++) {
    let nw = nw0;
    let reachedMonth = null;
    for (let m = 1; m <= months; m++) {
      const r = randNormal(monthlyMean, monthlyStd);
      nw = Math.max(0, nw * (1 + r) + contrib);
      if (reachedMonth === null && nw >= target) reachedMonth = m;
      if (m % sampleEvery === 0) matrix[m / sampleEvery].push(nw);
    }
    if (reachedMonth !== null) reached++;
  }

  matrix[0] = new Array(N).fill(nw0);
  const series = matrix.map((arr, idx) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    function pct(p) { const i = Math.floor(p * (sorted.length - 1)); return sorted[Math.max(0, i)]; }
    return { month: idx * sampleEvery, p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) };
  });

  return { successProb: reached / N, series, months };
}

function monteCarloDecumulate(startNW, annualWithdraw, realRetPct, volPct, years) {
  const N = 400;
  const months = years * 12;
  const monthlyWithdraw = annualWithdraw / 12;
  const monthlyMean = realRetPct / 100 / 12;
  const monthlyStd = (volPct / 100) / Math.sqrt(12);
  let survive = 0;

  for (let i = 0; i < N; i++) {
    let nw = startNW;
    let ok = true;
    for (let m = 1; m <= months; m++) {
      const r = randNormal(monthlyMean, monthlyStd);
      nw = nw * (1 + r) - monthlyWithdraw;
      if (nw <= 0) { ok = false; break; }
    }
    if (ok) survive++;
  }
  return survive / N;
}

function runMonteCarlo() {
  const assets = getMappedAssets();
  const nw = netWorth(assets);
  const targets = fireTargets(_settings);
  const contrib = contribution(_settings, getMappedTransactions());
  const realRet = realReturnPct(_settings);
  const years = Math.max(10, (_settings.retireAge || 60) - (_settings.age || 30));
  const months = Math.min(600, years * 12);

  const result = monteCarloAccumulate(nw, contrib, realRet, _settings.volatility || 15, months, targets.regular);
  const decumProb = monteCarloDecumulate(targets.regular, annualExpense(_settings), realRet, _settings.volatility || 15, 30);
  _mcResult = { accum: result, decumProb, years };
  renderMonteCarlo();
}

// ── Rendering ─────────────────────────────────────────
function renderAll() {
  const transactions = getMappedTransactions();
  const assets = getMappedAssets();
  const nw = netWorth(assets);
  const targets = fireTargets(_settings);

  // Today date
  const todayDateEl = document.getElementById('fireDate');
  if (todayDateEl) {
    todayDateEl.textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    });
  }

  // Hero stats
  const pct = targets.regular > 0 ? Math.min(100, nw / targets.regular * 100) : 0;
  const netWorthValEl = document.getElementById('netWorthVal');
  const fireTargetValEl = document.getElementById('fireTargetVal');
  const progressPctEl = document.getElementById('progressPct');
  if (netWorthValEl) netWorthValEl.textContent = fmtMoney(nw);
  if (fireTargetValEl) fireTargetValEl.textContent = fmtMoney(targets.regular);
  if (progressPctEl) progressPctEl.textContent = pct.toFixed(1) + '%';

  // ETA
  const etaMonths = genericProjection(nw, targets.regular, contribution(_settings, transactions), realReturnPct(_settings));
  const etaEl = document.getElementById('etaVal');
  if (etaEl) {
    if (etaMonths === null) { etaEl.textContent = '难以估算'; etaEl.style.fontSize = '16px'; }
    else if (etaMonths === 0) { etaEl.textContent = '已达成'; }
    else {
      const d = new Date();
      d.setMonth(d.getMonth() + etaMonths);
      etaEl.textContent = d.getFullYear() + '年 · 约' + (etaMonths / 12).toFixed(1) + '年后';
      etaEl.style.fontSize = '16px';
    }
  }

  // Ring
  const r = 86;
  const circ = 2 * Math.PI * r;
  const ring = document.getElementById('ringFill');
  if (ring) {
    ring.setAttribute('stroke-dasharray', circ.toFixed(1));
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = (circ - (circ * pct / 100)).toFixed(1);
    });
  }

  renderFireTypes(targets, nw, transactions);
  renderMonthFlow(transactions);
  renderAllocation(assets, nw);
  renderTxList(transactions);
  renderAssetList(assets);
  updateSliderLabels();
  syncSettingsToForm();
}

function renderFireTypes(targets, nw, transactions) {
  const wrap = document.getElementById('firetypeGrid');
  if (!wrap) return;
  wrap.innerHTML = '';

  FIRE_TYPES.forEach(ft => {
    const target = targets[ft.key];
    const pct = target > 0 ? Math.min(100, nw / target * 100) : 0;
    const contrib = contribution(_settings, transactions);
    const etaM = genericProjection(nw, target, contrib, realReturnPct(_settings));
    let etaText;
    if (ft.key === 'coast') {
      etaText = nw >= target ? '已达成 Coast' : '尚需增值追赶';
    } else if (etaM === null) {
      etaText = '难以估算';
    } else if (etaM === 0) {
      etaText = '已达成';
    } else {
      etaText = '约 ' + (etaM / 12).toFixed(1) + ' 年后';
    }

    const card = document.createElement('div');
    card.className = 'firetype-card glass';
    card.innerHTML =
      '<div class="ft-icon" style="background:' + ft.color + '22;color:' + ft.color + '">' + ft.icon + '</div>' +
      '<div class="ft-name">' + ft.name + '</div>' +
      '<div class="ft-desc">' + ft.desc + '</div>' +
      '<div class="ft-target">' + fmtMoney(target) + '</div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + ft.color + '"></div></div>' +
      '<div class="ft-eta">' + etaText + '</div>';
    wrap.appendChild(card);
  });
}

function renderMonthFlow(transactions) {
  const f = monthFlow(transactions);
  const maxV = Math.max(f.income, f.expense, 1);
  const incomeVal = document.getElementById('incomeVal');
  const expenseVal = document.getElementById('expenseVal');
  const incomeBar = document.getElementById('incomeBar');
  const expenseBar = document.getElementById('expenseBar');
  const savingsRatePill = document.getElementById('savingsRatePill');
  const monthLabel = document.getElementById('monthLabel');

  if (incomeVal) incomeVal.textContent = fmtMoney(f.income);
  if (expenseVal) expenseVal.textContent = fmtMoney(f.expense);
  if (incomeBar) incomeBar.style.height = Math.max(6, f.income / maxV * 80) + 'px';
  if (expenseBar) expenseBar.style.height = Math.max(6, f.expense / maxV * 80) + 'px';

  const net = f.income - f.expense;
  const rate = f.income > 0 ? (net / f.income * 100) : 0;
  if (savingsRatePill) savingsRatePill.textContent = '储蓄率 ' + rate.toFixed(0) + '%';

  const now = new Date();
  if (monthLabel) monthLabel.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
}

function renderAllocation(assets, total) {
  const donut = document.getElementById('donut');
  const legend = document.getElementById('allocLegend');
  const countPill = document.getElementById('assetCountPill');
  if (!donut || !legend) return;

  legend.innerHTML = '';
  if (countPill) countPill.textContent = assets.length + ' 项资产';

  if (total <= 0 || assets.length === 0) {
    donut.style.background = 'rgba(255,255,255,0.06)';
    legend.innerHTML = '<div class="empty-hint">暂无资产数据，请在资产页面添加</div>';
    return;
  }

  let acc = 0;
  const stops = [];
  assets.forEach(a => {
    const val = Number(a.amount) || 0;
    if (val <= 0) return;
    const start = acc / total * 360;
    acc += val;
    const end = acc / total * 360;
    const cat = ASSET_CATS.find(c => c.key === a.key) || { color: '#8E8E93' };
    stops.push(cat.color + ' ' + start.toFixed(1) + 'deg ' + end.toFixed(1) + 'deg');
  });
  donut.style.background = 'conic-gradient(' + stops.join(',') + ')';

  assets.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).forEach(a => {
    const cat = ASSET_CATS.find(c => c.key === a.key) || { color: '#8E8E93' };
    const pct = total > 0 ? ((a.amount || 0) / total * 100) : 0;
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = '<span class="legend-dot" style="background:' + cat.color + '"></span><span class="legend-name">' + (a.name || '资产') + '</span><span class="legend-val">' + pct.toFixed(0) + '%</span>';
    legend.appendChild(row);
  });
}

function renderTxList(transactions) {
  const list = document.getElementById('txList');
  if (!list) return;

  const sorted = transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty-hint">还没有记录，前往记账页面添加</div>';
    return;
  }

  list.innerHTML = '';
  sorted.forEach(t => {
    const c = getCatInfo(t.type, t.cat);
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML =
      '<div class="list-icon" style="background:' + c.color + '26;color:' + c.color + '">' + c.icon + '</div>' +
      '<div class="list-main"><div class="list-title">' + c.name + (t.note ? (' · ' + t.note) : '') + '</div><div class="list-sub">' + t.date + '</div></div>' +
      '<div class="list-amount" style="color:' + (t.type === 'income' ? '#30D9A0' : '#FF6961') + '">' + (t.type === 'income' ? '+' : '-') + fmtMoney(t.amount) + '</div>';
    list.appendChild(row);
  });
}

function renderAssetList(assets) {
  const list = document.getElementById('assetList');
  if (!list) return;

  if (assets.length === 0) {
    list.innerHTML = '<div class="empty-hint">还没有资产记录</div>';
    return;
  }

  list.innerHTML = '';
  assets.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).forEach(a => {
    const cat = ASSET_CATS.find(c => c.key === a.key) || { color: '#8E8E93' };
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML =
      '<div class="list-icon" style="background:' + cat.color + '26;color:' + cat.color + '">●</div>' +
      '<div class="list-main"><div class="list-title">' + (a.name || '资产') + '</div></div>' +
      '<div class="list-amount">' + fmtMoney(a.amount) + '</div>';
    list.appendChild(row);
  });
}

function renderMonteCarlo() {
  if (!_mcResult) return;
  const accum = _mcResult.accum;

  const mcAccumProb = document.getElementById('mcAccumProb');
  if (mcAccumProb) {
    mcAccumProb.textContent = (accum.successProb * 100).toFixed(0) + '%';
    mcAccumProb.style.color = accum.successProb > 0.7 ? '#30D9A0' : (accum.successProb > 0.4 ? '#FFC24D' : '#FF6961');
  }
  const mcAccumSub = document.getElementById('mcAccumSub');
  if (mcAccumSub) mcAccumSub.textContent = '未来 ' + _mcResult.years + ' 年内，400 次随机模拟中达成标准 FIRE 目标的比例';

  const mcDecumProb = document.getElementById('mcDecumProb');
  if (mcDecumProb) {
    mcDecumProb.textContent = (_mcResult.decumProb * 100).toFixed(0) + '%';
    mcDecumProb.style.color = _mcResult.decumProb > 0.7 ? '#30D9A0' : (_mcResult.decumProb > 0.4 ? '#FFC24D' : '#FF6961');
  }

  const mcProbHero = document.getElementById('mcProbHero');
  if (mcProbHero) mcProbHero.textContent = (accum.successProb * 100).toFixed(0) + '%';

  const svg = document.getElementById('mcChart');
  if (!svg) return;
  svg.innerHTML = '';

  const series = accum.series;
  if (series.length < 2) return;

  const W = 600, H = 180, pad = 10;
  const target = fireTargets(_settings).regular;
  const allVals = [];
  series.forEach(s => { allVals.push(s.p10, s.p50, s.p90); });
  allVals.push(target);
  const maxV = Math.max.apply(null, allVals) * 1.05;
  const minV = 0;
  const maxM = series[series.length - 1].month || 1;

  function toXY(m, v) {
    return { x: pad + (W - 2 * pad) * (m / maxM), y: H - pad - (H - 2 * pad) * ((v - minV) / (maxV - minV)) };
  }

  const p10pts = series.map(s => toXY(s.month, s.p10));
  const p50pts = series.map(s => toXY(s.month, s.p50));
  const p90pts = series.map(s => toXY(s.month, s.p90));
  const ns = 'http://www.w3.org/2000/svg';

  // Band (p10-p90)
  const band = document.createElementNS(ns, 'path');
  let bandD = 'M ' + p90pts[0].x + ' ' + p90pts[0].y;
  for (let i = 0; i < p90pts.length - 1; i++) {
    const a = p90pts[i], b = p90pts[i + 1];
    const mx = (a.x + b.x) / 2;
    bandD += ' C ' + mx + ' ' + a.y + ', ' + mx + ' ' + b.y + ', ' + b.x + ' ' + b.y;
  }
  const rev = p10pts.slice().reverse();
  for (let i = 0; i < rev.length; i++) {
    bandD += ' L ' + rev[i].x + ' ' + rev[i].y;
  }
  bandD += ' Z';
  band.setAttribute('d', bandD);
  band.setAttribute('fill', 'rgba(77,163,255,0.16)');
  band.setAttribute('stroke', 'none');
  svg.appendChild(band);

  // Target line
  const targetY = toXY(maxM, target).y;
  const tline = document.createElementNS(ns, 'line');
  tline.setAttribute('x1', pad);
  tline.setAttribute('x2', W - pad);
  tline.setAttribute('y1', targetY);
  tline.setAttribute('y2', targetY);
  tline.setAttribute('stroke', '#FFC24D');
  tline.setAttribute('stroke-width', '2');
  tline.setAttribute('stroke-dasharray', '6 6');
  svg.appendChild(tline);

  // Median line
  const medianLine = document.createElementNS(ns, 'path');
  medianLine.setAttribute('d', smoothPath(p50pts));
  medianLine.setAttribute('fill', 'none');
  medianLine.setAttribute('stroke', '#4DA3FF');
  medianLine.setAttribute('stroke-width', '3');
  medianLine.setAttribute('stroke-linecap', 'round');
  medianLine.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(medianLine);
}

// ── Sliders ───────────────────────────────────────────
function updateSliderLabels() {
  const contrib = contribution(_settings, getMappedTransactions());
  const sliderContrib = document.getElementById('sliderContribution');
  if (sliderContrib && !sliderContrib.matches(':active')) {
    sliderContrib.value = Math.max(0, Math.round(contrib));
  }

  const valContrib = document.getElementById('valContribution');
  const valReturn = document.getElementById('valReturn');
  const valVol = document.getElementById('valVol');
  const valInflation = document.getElementById('valInflation');
  const realReturnNote = document.getElementById('realReturnNote');

  if (valContrib) valContrib.textContent = fmtMoney(document.getElementById('sliderContribution')?.value || 0);
  if (valReturn) valReturn.textContent = _settings.expectedReturn + '%';
  if (valVol) valVol.textContent = _settings.volatility + '%';
  if (valInflation) valInflation.textContent = _settings.inflation + '%';
  if (realReturnNote) realReturnNote.textContent = realReturnPct(_settings).toFixed(2) + '%';
}

function scheduleMc() {
  clearTimeout(_mcDebounce);
  _mcDebounce = setTimeout(runMonteCarlo, 450);
}

function syncSettingsToForm() {
  const setMonthlyExpense = document.getElementById('setMonthlyExpense');
  const setSwr = document.getElementById('setSwr');
  const setAge = document.getElementById('setAge');
  const setRetireAge = document.getElementById('setRetireAge');
  if (setMonthlyExpense) setMonthlyExpense.value = _settings.monthlyExpense;
  if (setSwr) setSwr.value = _settings.swr;
  if (setAge) setAge.value = _settings.age || '';
  if (setRetireAge) setRetireAge.value = _settings.retireAge || '';
}

// ── Category display ──────────────────────────────────
const EXPENSE_CATS = [
  { key: '餐饮', name: '餐饮', color: '#FF9F43', icon: '🍜' },
  { key: '交通', name: '交通', color: '#4DA3FF', icon: '🚌' },
  { key: '房租房贷', name: '房租房贷', color: '#B98CFF', icon: '🏠' },
  { key: '娱乐', name: '娱乐', color: '#FF6961', icon: '🎮' },
  { key: '购物', name: '购物', color: '#FFC24D', icon: '🛍️' },
  { key: '医疗', name: '医疗', color: '#30D9A0', icon: '💊' },
];
const INCOME_CATS = [
  { key: '工资', name: '工资', color: '#30D9A0', icon: '💼' },
  { key: '奖金', name: '奖金', color: '#FFC24D', icon: '🎁' },
  { key: '理财收益', name: '理财收益', color: '#4DA3FF', icon: '📈' },
  { key: '副业', name: '副业', color: '#B98CFF', icon: '🧩' },
];

function getCatInfo(type, catKey) {
  const list = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const found = list.find(c => c.key === catKey);
  if (found) return found;
  // Try partial match
  for (const c of list) {
    if (catKey && catKey.includes(c.key)) return c;
  }
  return { name: catKey || '其他', color: '#8E8E93', icon: '✳️' };
}

// ── AI Insight ────────────────────────────────────────
function buildSummary() {
  const assets = getMappedAssets();
  const transactions = getMappedTransactions();
  const nw = netWorth(assets);
  const targets = fireTargets(_settings);
  const f = monthFlow(transactions);
  const rate = f.income > 0 ? ((f.income - f.expense) / f.income * 100) : 0;

  const allocLines = assets.map(a => {
    const pct = nw > 0 ? (a.amount / nw * 100).toFixed(0) : 0;
    return (a.name || '资产') + ': ' + pct + '%';
  }).join('，');

  if (_mcResult) {
    const mc = _mcResult;
    return [
      '净资产：' + Math.round(nw) + ' 元（今日购买力）',
      '标准FIRE目标：' + Math.round(targets.regular) + ' 元，进度 ' + Math.min(100, nw / targets.regular * 100).toFixed(1) + '%',
      'Lean/Barista/Coast/Fat FIRE 目标分别约为：' + Math.round(targets.lean) + ' / ' + Math.round(targets.barista) + ' / ' + Math.round(targets.coast) + ' / ' + Math.round(targets.fat) + ' 元',
      '本月储蓄率：' + rate.toFixed(0) + '%',
      '资产配置：' + (allocLines || '暂无数据'),
      '假设：名义年化回报 ' + _settings.expectedReturn + '%，波动率 ' + _settings.volatility + '%，通胀 ' + _settings.inflation + '%，实际年化回报约 ' + realReturnPct(_settings).toFixed(1) + '%',
      '蒙特卡洛模拟：规划期内达成标准FIRE概率 ' + (mc.accum.successProb * 100).toFixed(0) + '%，退休后30年资金存续概率 ' + (mc.decumProb * 100).toFixed(0) + '%'
    ].join('\n');
  } else {
    return [
      '净资产：' + Math.round(nw) + ' 元（今日购买力）',
      '标准FIRE目标：' + Math.round(targets.regular) + ' 元，进度 ' + Math.min(100, nw / targets.regular * 100).toFixed(1) + '%',
      '本月储蓄率：' + rate.toFixed(0) + '%',
      '资产配置：' + (allocLines || '暂无数据'),
      '提示：请先运行蒙特卡洛模拟以获得概率估计'
    ].join('\n');
  }
}

async function generateAIInsight() {
  const out = document.getElementById('aiOutput');
  if (!out) return;
  out.innerHTML = '正在生成分析 <span class="dots"><span></span><span></span><span></span></span>';

  const summary = buildSummary();
  const prompt = '你是一名理财教育助手，服务对象在中国。基于以下用户的财务快照数据，用中文写一段200-350字的财务健康分析，内容依次包括：' +
    '1) 对当前储蓄率的评价；2) 资产配置集中度或多元化的观察；3) 蒙特卡洛模拟达成概率的解读，并说明该概率的局限性（历史不代表未来、模拟假设简化等）；' +
    '4) 一到两条通用的、非具体标的的改善方向（例如提高应急金比例、检视资产配置是否匹配风险承受能力、避免单一资产过度集中等，不要推荐任何具体基金、股票、平台或产品）。' +
    '最后必须单独成句加上：以上内容为一般性财务教育信息，不构成具体投资建议，请结合自身情况并按需咨询持牌专业人士。' +
    '只输出这段分析文本本身，不要加标题，不要使用markdown符号（不要出现#或*）。\n\n用户财务快照：\n' + summary;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    out.textContent = text || '暂时没有生成结果，请稍后重试。';
  } catch (e) {
    out.textContent = '生成失败，请检查网络后重试。';
  }
}

// ── Settings Modal ────────────────────────────────────
function openSettings() {
  syncSettingsToForm();
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeSettings() {
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.classList.remove('open');
}

function saveSettingsFromForm() {
  const setMonthlyExpense = document.getElementById('setMonthlyExpense');
  const setSwr = document.getElementById('setSwr');
  const setAge = document.getElementById('setAge');
  const setRetireAge = document.getElementById('setRetireAge');

  _settings.monthlyExpense = parseFloat(setMonthlyExpense?.value) || 0;
  _settings.swr = parseFloat(setSwr?.value) || 4;
  const ageVal = setAge?.value;
  _settings.age = ageVal ? parseInt(ageVal) : null;
  const retVal = setRetireAge?.value;
  _settings.retireAge = retVal ? parseInt(retVal) : 60;

  saveSettings();
  closeSettings();
  render();
  scheduleMc();
}

// ── Wire event listeners ──────────────────────────────
function wireEventListeners() {
  // Settings
  document.getElementById('fireSettingsBtn')?.addEventListener('click', openSettings);
  document.getElementById('fireSettingsSubmit')?.addEventListener('click', saveSettingsFromForm);
  document.getElementById('fireSettingsCancel')?.addEventListener('click', closeSettings);
  document.querySelectorAll('#settingsOverlay .modal-close').forEach(el => {
    el.addEventListener('click', closeSettings);
  });
  document.getElementById('settingsOverlay')?.addEventListener('click', function(e) {
    if (e.target === this) closeSettings();
  });

  // Monte Carlo run button
  document.getElementById('runMcBtn')?.addEventListener('click', runMonteCarlo);

  // AI insight
  document.getElementById('genAiBtn')?.addEventListener('click', generateAIInsight);

  // Sliders
  const sliderIds = ['sliderContribution', 'sliderReturn', 'sliderVol', 'sliderInflation'];
  sliderIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      switch (id) {
        case 'sliderContribution':
          // contribution slider is visual-only; actual contribution derived from store
          break;
        case 'sliderReturn':
          _settings.expectedReturn = parseFloat(el.value) || 0;
          break;
        case 'sliderVol':
          _settings.volatility = parseFloat(el.value) || 0;
          break;
        case 'sliderInflation':
          _settings.inflation = parseFloat(el.value) || 0;
          break;
      }
      updateSliderLabels();
      render();
      scheduleMc();
    });
    el.addEventListener('change', () => {
      saveSettings();
    });
  });
}

// ── Public API ────────────────────────────────────────

/**
 * Initialise the FIRE page module.
 * Must be called once at app startup.
 */
export function initFirePage() {
  if (_initialized) return;
  _initialized = true;

  // Load settings from localStorage
  loadSettings();

  // Register navigation callback — lazy render when user switches to fire page
  onNavigate(page => {
    if (page === 'fire') render();
  });

  // Subscribe to store changes — auto-refresh if fire page is active
  subscribe('any', () => {
    const firePage = document.getElementById('page-fire');
    if (firePage && firePage.classList.contains('active')) {
      render();
    }
  });

  // Wire event listeners
  wireEventListeners();
}

/**
 * Render the FIRE page.
 * Reads data from store, maps to internal format, renders all UI.
 */
export function render() {
  loadSettings();
  renderAll();
  runMonteCarlo();
}
