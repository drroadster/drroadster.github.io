// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · pages/assets.js
//  Asset management: net worth hero, timeline charts,
//  bank-card grid (grouped by name initial), CSV import/export.
// ═══════════════════════════════════════════════════════

import { getAssets, upsertAsset, deleteAsset, getAssetHistory,
         recordSnapshot, importAssetSnapshots } from '../store.js';
import { subscribe } from '../store.js';
import { buildLineChart, buildDoughnut, buildHorizBar, buildSparklineSvg,
         cssVar, palette } from '../charts.js';
import { fmt, esc, fmtDateShort, uid, splitCSVLine, splitCSVLines,
         normalizeDate, parseMoney, pad2 } from '../utils.js';
import { t } from '../i18n.js';
import { showToast, onNavigate } from '../router.js';
import { ASSET_GRADIENTS, ASSET_GRADIENT_DEFAULT, ASSET_ICONS } from '../config.js';

// ── Valid asset categories (mirrored from config + HTML select) ──
const VALID_ASSET_CATEGORIES = new Set([
  '现金/储蓄', '基金/股票', '房产', '车辆', '加密货币', '固定资产', '其他投资',
]);
const DEFAULT_ASSET_CATEGORY = '其他投资';

/**
 * Normalize an asset category to a valid label.
 * If the category is an abnormal ID or unknown string, fall back to default.
 */
function _normalizeCategory(cat) {
  if (!cat || typeof cat !== 'string') return DEFAULT_ASSET_CATEGORY;
  if (VALID_ASSET_CATEGORIES.has(cat)) return cat;
  // Detect asset-ID-like strings (e.g. a17823702561070.25088001814070604)
  if (/^a\d{10,}/.test(cat) || cat.includes('.')) return DEFAULT_ASSET_CATEGORY;
  // Unknown string that doesn't look like an ID — still unknown, fall back
  return DEFAULT_ASSET_CATEGORY;
}

let _timelineRange = 90; // days, 0 = all
let _editingId = null;

// ── Public init ──────────────────────────────────────
export function initAssetsPage() {
  _wireControls();
  window.__rdstr_openAssetModal = () => openAssetModal(); // FAB hook
  onNavigate(page => { if (page === 'assets') render(); });
  // 订阅资产变更，确保任何来源的资产更新都会触发重绘
  subscribe('assets', () => {
    if (document.getElementById('page-assets')?.classList.contains('active')) {
      render();
    }
  });
}

export function render() {
  let assets = getAssets();

  // 防御性过滤：跳过 name 为空或 category 异常的资产
  assets = assets.filter(a => {
    if (!a.name || String(a.name).trim() === '') return false;
    return true;
  });
  // 将异常 category 归一化，保证图表和数据区正常展示
  assets = assets.map(a => ({
    ...a,
    category: _normalizeCategory(a.category),
  }));

  const total  = assets.reduce((s, a) => s + (a.value || 0), 0);

  _renderHero(total, assets.length);
  _renderTimeline();
  _renderDistribution(assets);
  _renderGrid(assets);
}

function _wireControls() {
  document.getElementById('addAssetBtn')?.addEventListener('click', () => openAssetModal());

  document.querySelectorAll('#timelineSeg .seg-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _timelineRange = parseInt(btn.dataset.range, 10);
      document.querySelectorAll('#timelineSeg .seg-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderTimeline();
    });
  });

  // Asset modal
  document.getElementById('assetModalCancel')?.addEventListener('click', closeAssetModal);
  document.getElementById('assetModalSave')?.addEventListener('click', _saveAsset);
  document.getElementById('assetModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'assetModal') closeAssetModal();
  });

  // Import / export
  document.getElementById('assetCsvInput')?.addEventListener('change', _handleAssetCSV);
  document.querySelectorAll('[data-export="asset"], [data-export="asset-history"]').forEach(btn => {
    btn.addEventListener('click', () => _exportAssetCSV(btn.dataset.export));
  });
}

// ── Hero ────────────────────────────────────────────────
function _renderHero(total, count) {
  const valEl = document.getElementById('totalAssetVal');
  const subEl = document.getElementById('totalAssetSub');
  if (valEl) valEl.textContent = `¥${fmt(total)}`;
  if (subEl) {
    const last = getAssetHistory().slice(-1)[0];
    const lastDate = last ? new Date(last.ts).toLocaleDateString('zh-CN') : '从未';
    subEl.textContent = count ? `共 ${count} 项资产 · 上次更新 ${lastDate}` : '手动更新各资产以计算总值';
  }
  _renderNetworthStats(total);
}

function _renderNetworthStats(total) {
  const wrap = document.getElementById('networthStats');
  if (!wrap) return;
  const assets = getAssets().filter(a => a.deleted !== true);
  if (!assets.length) { wrap.innerHTML = ''; return; }

  const history = getAssetHistory();
  let momChange = null, momPct = null;
  if (history.length >= 2) {
    const now = new Date();
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const past = [...history].reverse().find(h => new Date(h.ts) <= monthAgo);
    if (past) { momChange = total - past.total; momPct = past.total ? (momChange / past.total) * 100 : null; }
  }

  const catTotals = {};
  assets.forEach(a => {
    const cat = _normalizeCategory(a.category);
    catTotals[cat] = (catTotals[cat] || 0) + (a.value || 0);
  });
  const topCat = Object.keys(catTotals).sort((a,b) => catTotals[b] - catTotals[a])[0];

  const pills = [
    `<div class="hero-stat"><div class="hero-stat-label">资产项数</div><div class="hero-stat-value">${assets.length} 项</div></div>`,
    momChange !== null
      ? `<div class="hero-stat"><div class="hero-stat-label">近30天变化</div><div class="hero-stat-value ${momChange >= 0 ? 'up' : 'down'}">${momChange >= 0 ? '+' : '−'}¥${fmt(Math.abs(momChange))}${momPct !== null ? ` (${momChange >= 0 ? '+' : ''}${momPct.toFixed(1)}%)` : ''}</div></div>`
      : `<div class="hero-stat"><div class="hero-stat-label">近30天变化</div><div class="hero-stat-value" style="opacity:.5">积累中</div></div>`,
    `<div class="hero-stat"><div class="hero-stat-label">最大占比</div><div class="hero-stat-value">${esc(topCat || '—')}</div></div>`,
  ];
  wrap.innerHTML = pills.join('');
}

// ── Timeline charts ────────────────────────────────────
function _renderTimeline() {
  const history = getAssetHistory();
  const emptyEl = document.getElementById('timelineEmpty');
  const wrapEl  = document.getElementById('assetTimelineWrap');
  const bkCard  = document.getElementById('breakdownCard');
  const bkEmpty = document.getElementById('breakdownEmpty');

  if (!history.length) {
    if (wrapEl) wrapEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    if (bkCard) bkCard.style.display = 'none';
    if (bkEmpty) bkEmpty.style.display = '';
    return;
  }
  if (wrapEl) wrapEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  let hist = [...history];
  if (_timelineRange > 0) {
    const cutoff = Date.now() - _timelineRange * 86400000;
    hist = hist.filter(h => new Date(h.ts).getTime() >= cutoff);
    if (!hist.length) hist = [history[history.length - 1]];
  }

  const labels = hist.map(h => fmtDateShort(h.ts));
  const totals = hist.map(h => h.total);

  buildLineChart('assetTimelineChart', labels,
    [{ label: '总资产', data: totals, color: cssVar('--color-blue'), fill: true }],
    { hideLegend: true });

  // Per-asset breakdown (only if 2+ assets have history)
  const allIds = [...new Set(hist.flatMap(h => Object.keys(h.breakdown || {})))];
  const allAssets = getAssets().filter(a => a.deleted !== true);
  const nameMap = Object.fromEntries(allAssets.map(a => [a.id, a.name]));
  // 过滤掉 name 为空的资产在 breakdown 中的条目
  const validIds = allIds.filter(id => nameMap[id] && String(nameMap[id]).trim() !== '');

  if (validIds.length > 1) {
    if (bkCard) bkCard.style.display = '';
    if (bkEmpty) bkEmpty.style.display = 'none';

    const p = palette();
    const datasets = validIds.map((id, i) => ({
      label: nameMap[id] || id,
      data:  hist.map(h => h.breakdown?.[id] ?? 0),
      color: p[i % p.length],
      fill:  false,
    }));
    buildLineChart('assetBreakdownChart', labels, datasets, { hideLegend: true });

    const legEl = document.getElementById('timelineLegend');
    if (legEl) {
      legEl.innerHTML = validIds.map((id, i) => `
        <div class="legend-chip">
          <div class="legend-dot" style="background:${p[i % p.length]}"></div>
          ${esc(nameMap[id] || id)}
        </div>`).join('');
    }
  } else {
    if (bkCard) bkCard.style.display = 'none';
    if (bkEmpty) bkEmpty.style.display = '';
  }
}

// ── Distribution (pie + bar) ──────────────────────────
function _renderDistribution(assets) {
  if (!assets.length) {
    const pieEl = document.getElementById('assetPieChart');
    if (pieEl) pieEl.style.display = 'none';
    const legEl = document.getElementById('assetLegend');
    if (legEl) legEl.innerHTML = '<div style="font-size:12px;color:var(--color-label-4)">暂无数据</div>';
    return;
  }
  const cats = {};
  assets.forEach(a => { cats[a.category] = (cats[a.category] || 0) + a.value; });
  buildDoughnut('assetPieChart', Object.keys(cats), Object.values(cats), 'assetLegend');
  buildHorizBar('assetBarChart', Object.keys(cats), Object.values(cats));
}

// ── Bank-card grid (grouped by name initial, contacts-style) ──
function _renderGrid(assets) {
  const grid = document.getElementById('assetGrid');
  if (!grid) return;

  if (!assets.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏦</div><div class="empty-text">点击「＋ 添加」开始记录资产</div></div>`;
    return;
  }

  const sorted = [...assets].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const groups = {}; const order = [];
  sorted.forEach(a => {
    const letter = _firstIndexLetter(a.name);
    if (!groups[letter]) { groups[letter] = []; order.push(letter); }
    groups[letter].push(a);
  });

  grid.innerHTML = order.map(letter => `
    <div class="asset-letter-group">
      <div class="asset-letter-header">${letter}</div>
      <div class="asset-card-grid">${groups[letter].map(_bankCardHtml).join('')}</div>
    </div>`).join('');

  grid.querySelectorAll('[data-delete-asset]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); _deleteAssetConfirm(btn.dataset.deleteAsset); }));
  grid.querySelectorAll('[data-edit-asset]').forEach(btn =>
    btn.addEventListener('click', () => openAssetModal(btn.dataset.editAsset)));
}

function _firstIndexLetter(name) {
  const ch = (name || '').trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (/[0-9]/.test(ch)) return '#';
  if (/[\u4e00-\u9fa5]/.test(ch)) return '中';
  return '#';
}

function _bankCardHtml(asset) {
  const history = getAssetHistory();
  const points = history.filter(h => h.breakdown?.[asset.id] !== undefined).map(h => h.breakdown[asset.id]);
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const delta = prev !== null ? asset.value - prev : null;
  const deltaHtml = delta !== null
    ? `<div class="bank-card-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ¥${fmt(Math.abs(delta))}</div>`
    : `<div class="bank-card-delta" style="opacity:.5">首次记录</div>`;
  const sparkline = buildSparklineSvg(points);
  const initial = (asset.name || '?').trim().charAt(0).toUpperCase();
  const gradient = ASSET_GRADIENTS[asset.category] || ASSET_GRADIENT_DEFAULT;

  return `<div class="bank-card" style="background:${gradient}">
    <div class="bank-card-texture"></div>
    <div class="bank-card-top">
      <div class="bank-card-monogram">${esc(initial)}</div>
      <button class="bank-card-delete" data-delete-asset="${asset.id}">×</button>
    </div>
    <div class="bank-card-mid">
      <div class="bank-card-mid-row">
        <div>
          <div class="bank-card-name">${esc(asset.name)}</div>
          <div class="bank-card-value">¥${fmt(asset.value)}</div>
        </div>
        ${sparkline ? `<div class="bank-card-spark-wrap">${sparkline}</div>` : ''}
      </div>
    </div>
    <div class="bank-card-bottom">
      <div class="bank-card-note">${ASSET_ICONS[asset.category] || '💰'} ${esc(asset.category)}${asset.note ? ' · ' + esc(asset.note) : ''}</div>
      ${deltaHtml}
    </div>
    <button class="bank-card-update" data-edit-asset="${asset.id}">✏️ 更新金额</button>
  </div>`;
}

function _deleteAssetConfirm(id) {
  if (!confirm('确认删除此资产？')) return;
  deleteAsset(id);
  recordSnapshot();
  showToast(t('toastAssetDeleted'));
  render();
}

// ── Add / Edit asset modal ────────────────────────────
export function openAssetModal(id) {
  _editingId = id || null;
  const titleEl = document.getElementById('assetModalTitle');
  const nameEl  = document.getElementById('assetName');
  const catEl   = document.getElementById('assetCategory');
  const valEl   = document.getElementById('assetValue');
  const noteEl  = document.getElementById('assetNote');

  if (id) {
    const a = getAssets().find(x => x.id === id);
    if (!a) return;
    if (titleEl) titleEl.textContent = '更新资产';
    if (nameEl)  nameEl.value = a.name;
    if (catEl)   catEl.value = a.category;
    if (valEl)   valEl.value = a.value;
    if (noteEl)  noteEl.value = a.note || '';
  } else {
    if (titleEl) titleEl.textContent = '添加资产';
    if (nameEl)  nameEl.value = '';
    if (valEl)   valEl.value = '';
    if (noteEl)  noteEl.value = '';
  }
  document.getElementById('assetModal')?.classList.add('open');
}
export function closeAssetModal() {
  document.getElementById('assetModal')?.classList.remove('open');
}

function _saveAsset() {
  const name  = document.getElementById('assetName')?.value.trim();
  let category = document.getElementById('assetCategory')?.value;
  const value = parseFloat(document.getElementById('assetValue')?.value) || 0;
  const note  = document.getElementById('assetNote')?.value.trim();
  if (!name) { showToast('请填写资产名称'); return; }
  // 防御：确保 category 是有效分类标签
  category = _normalizeCategory(category);

  const asset = _editingId
    ? { id: _editingId, name, category, value, note, updatedAt: new Date().toISOString() }
    : { id: uid('a'), name, category, value, note, createdAt: new Date().toISOString() };

  upsertAsset(asset);
  recordSnapshot();
  closeAssetModal();
  showToast(t('toastAssetSaved'));
  render();
}

// ── CSV import (multi-asset snapshot format) ──────────
function _handleAssetCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => _parseAssetCSV(ev.target.result);
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
}

function _parseAssetCSV(text) {
  const lines = splitCSVLines(text);
  if (lines.length < 2) { _banner('⚠️ 文件内容为空', 'warn'); return; }

  const headers = splitCSVLine(lines[0]);
  const assetNames = headers.slice(1).map(h => h.trim()).filter(Boolean);
  if (!assetNames.length) { _banner('⚠️ 未找到资产列（第1列为时间，第2列起为资产名称）', 'warn'); return; }

  let snapCount = 0, skippedEmpty = 0, rowErrors = 0;
  const snapshots = [];

  lines.slice(1).forEach(line => {
    const cols = splitCSVLine(line);
    const date = normalizeDate(cols[0]);
    if (!date) { rowErrors++; return; }

    const breakdown = {}; let total = 0, hasAny = false;
    assetNames.forEach((name, i) => {
      const rawStr = (cols[i + 1] || '').trim();
      if (!rawStr) return;
      const val = parseMoney(rawStr);
      if (isNaN(val) || val < 0) return;
      hasAny = true;

      let asset = getAssets().find(a => a.name === name);
      if (!asset) {
        asset = { id: uid('a'), name, category: _guessCategory(name), value: val, note: '', createdAt: new Date().toISOString() };
      } else {
        asset = { ...asset, value: val };
      }
      upsertAsset(asset);
      breakdown[asset.id] = val;
      total += val;
    });

    if (!hasAny) { skippedEmpty++; return; }
    snapshots.push({ ts: date + 'T00:00:00.000Z', total, breakdown });
    snapCount++;
  });

  importAssetSnapshots(snapshots);

  if (!snapCount) {
    _banner(`⚠️ 未能导入任何数据（${rowErrors ? rowErrors + ' 行日期无法识别' : '所有行为空'}）`, 'warn');
    return;
  }
  let msg = `✅ 成功导入 ${snapCount} 条快照，${assetNames.length} 项资产`;
  if (skippedEmpty) msg += ` · 跳过 ${skippedEmpty} 条空行`;
  if (rowErrors)    msg += ` · ${rowErrors} 行日期无法识别`;
  _banner(msg, 'ok');
  showToast(t('toastAssetImportOk', { n: snapCount, a: assetNames.length }));
  render();
}

function _guessCategory(name) {
  const n = name.toLowerCase();
  if (/btc|eth|crypto|coin|usdt|bnb/.test(n)) return '加密货币';
  if (/stock|equity|share|fund|基金|股票|etf/.test(n)) return '基金/股票';
  if (/bank|存款|savings|alipay|weipay|wechat|支付宝|微信/.test(n)) return '现金/储蓄';
  if (/house|home|property|房|地产/.test(n)) return '房产';
  if (/car|vehicle|汽车|车/.test(n)) return '车辆';
  return '其他投资';
}

function _banner(msg, type) {
  const el = document.getElementById('assetImportBanner'); if (!el) return;
  el.className = `banner show ${type === 'ok' ? 'banner-ok' : 'banner-warn'}`;
  el.innerHTML = msg;
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

function _exportAssetCSV(kind) {
  const today = new Date();
  const stamp = `${today.getFullYear()}${pad2(today.getMonth()+1)}${pad2(today.getDate())}`;
  const assets = getAssets();
  const history = getAssetHistory();

  if (kind === 'asset') {
    if (!assets.length) { showToast(t('toastNoData')); return; }
    const rows = [['资产名称','类别','当前金额','备注'].join(','),
      ...assets.map(a => [a.name, a.category, a.value, a.note || ''].map(_csvEscape).join(','))];
    _download(`Roadster_资产明细_${stamp}.csv`, '\uFEFF' + rows.join('\n'), 'text/csv;charset=utf-8');
    showToast(t('toastExportDone'));

  } else if (kind === 'asset-history') {
    if (!history.length) { showToast(t('toastNoData')); return; }
    const idToName = Object.fromEntries(assets.map(a => [a.id, a.name]));
    const allIds = [...new Set(history.flatMap(h => Object.keys(h.breakdown || {})))];
    const header = ['时间', ...allIds.map(id => idToName[id] || id), '总资产'];
    const rows = history.map(h => {
      const vals = allIds.map(id => h.breakdown?.[id] ?? '');
      return [h.ts.slice(0,10), ...vals, h.total].map(_csvEscape).join(',');
    });
    _download(`Roadster_资产走势_${stamp}.csv`, '\uFEFF' + [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');
    showToast(t('toastExportDone'));
  }
}
