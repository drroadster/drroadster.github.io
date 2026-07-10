// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · charts.js
//  All Chart.js chart builders in one place.
//
//  Design principles:
//  • Every chart is created via a named builder function.
//  • A central registry (_charts) tracks instances so rebuilds
//    always destroy the previous chart first (prevents canvas leak).
//  • Colors are resolved at render time via cssVar() so they follow
//    the active theme without needing separate dark-mode charts.
//  • maintainAspectRatio: false on every chart — sizing is handled
//    purely by the CSS wrapper (.chart-trend, .chart-pie, etc.).
//  • ChartDataLabels is registered globally but disabled by default;
//    each pie/bar chart that wants labels opts in explicitly.
// ═══════════════════════════════════════════════════════

// Palette is read from CSS variables (--palette-0..11) at call time
// so doughnut/bar colours update instantly on theme switch.
export function palette() {
  const style = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 0; i < 12; i++) {
    colors.push(style.getPropertyValue(`--palette-${i}`).trim());
  }
  return colors;
}

// ── Chart registry ────────────────────────────────────
/** @type {Record<string, Chart>} */
const _charts = {};

function _destroy(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}
function _save(id, chart) { _charts[id] = chart; return chart; }

// ── Color helpers ─────────────────────────────────────
/**
 * Read a CSS custom property value at call time (theme-aware).
 * @param {string} name  e.g. '--color-green'
 */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Convert a hex color + alpha → rgba() string.
 * Needed because Chart.js fill colors can't use CSS color-mix/var().
 */
export function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Shared axis defaults (theme-aware, called at render time) ──
function _axisDefaults() {
  const gridColor = cssVar('--color-sep');
  const tickColor = cssVar('--color-label-4');
  return {
    x: {
      grid:  { display: false },
      ticks: { font: { size: 11 }, color: tickColor,
                maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
    },
    y: {
      grid:  { color: gridColor },
      ticks: { font: { size: 11 }, color: tickColor },
    },
  };
}

function _legendDefaults() {
  return {
    display: true,
    position: 'top',
    labels: {
      font: { size: 12, weight: 600 },
      boxWidth: 10,
      usePointStyle: true,
      padding: 16,
      color: cssVar('--color-label-2'),
    },
  };
}

// ── Plugin setup ──────────────────────────────────────
export function setupChartDefaults(Chart, ChartDataLabels) {
  if (ChartDataLabels) {
    Chart.register(ChartDataLabels);
    // Off by default — each chart opts in via plugins.datalabels
    Chart.defaults.set('plugins.datalabels', { display: false });
  }
}

// ── 1. Trend / timeline line chart ───────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {object[]} datasets  [{label, data, color}]
 * @param {object}   [opts]
 */
export function buildLineChart(canvasId, labels, datasets, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const axDef = _axisDefaults();
  const chartDatasets = datasets.map(d => ({
    label:                    d.label,
    data:                     d.data,
    borderColor:              d.color,
    backgroundColor:          d.fill ? hexToRgba(d.color, d.fillAlpha ?? 0.13) : 'transparent',
    fill:                     !!d.fill,
    tension:                  0.5,
    cubicInterpolationMode:   'monotone',
    pointRadius:              labels.length > 20 ? 0 : 3,
    pointHoverRadius:         6,
    borderWidth:              d.borderWidth ?? 2.5,
    pointBackgroundColor:     d.color,
    pointBorderColor:         cssVar('--color-surface-solid'),
    pointBorderWidth:         2,
    borderDash:               d.dash ?? [],
  }));

  return _save(canvasId, new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: chartDatasets },
    options: {
      responsive:           true,
      maintainAspectRatio:  false,
      interaction:          { mode: 'index', intersect: false },
      plugins: {
        legend:     opts.hideLegend ? { display: false } : _legendDefaults(),
        tooltip:    { callbacks: { label: c => `  ¥${_fmt(c.raw)}` } },
        datalabels: { display: false },
      },
      scales: {
        x: { ...axDef.x, ...(opts.xTicks ?? {}) },
        y: {
          ...axDef.y,
          ticks: { ...axDef.y.ticks, callback: v => '¥' + _fmtK(v) },
        },
      },
    },
  }));
}

// ── 2. Doughnut / pie chart ───────────────────────────
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {number[]} data       — negative values are filtered out
 * @param {string}   legendId   — element to render legend chips into
 * @param {object}   [opts]
 */
export function buildDoughnut(canvasId, labels, data, legendId, opts = {}) {
  _destroy(canvasId);
  const ctx  = document.getElementById(canvasId);
  const legEl = legendId ? document.getElementById(legendId) : null;

  // Filter out zero/negative slices (can't be rendered in a doughnut)
  const pairs  = labels.map((l, i) => [l, data[i]]).filter(([, v]) => v > 0);
  const fLabels = pairs.map(p => p[0]);
  const fData   = pairs.map(p => p[1]);
  const fColors = palette().slice(0, fLabels.length);

  if (!fData.length) {
    if (ctx)   ctx.style.display = 'none';
    if (legEl) legEl.innerHTML   = '<div style="font-size:12px;color:var(--color-label-4)">暂无数据</div>';
    return;
  }

  if (ctx) ctx.style.display = '';
  const total = fData.reduce((s, v) => s + v, 0);

  const chart = _save(canvasId, new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: fLabels,
      datasets: [{
        data:            fData,
        backgroundColor: fColors,
        borderWidth:     2,
        borderColor:     cssVar('--color-surface-solid'),
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              opts.cutout ?? '62%',
      plugins: {
        legend:     { display: false },
        tooltip:    { callbacks: { label: c => `  ¥${_fmt(c.raw)}` } },
        datalabels: {
          display:    true,
          color:      cssVar('--color-surface-solid'),
          font:       { size: 11, weight: 700 },
          formatter:  (val) => {
            const pct = total > 0 ? (val / total) * 100 : 0;
            return pct < 6 ? '' : pct.toFixed(0) + '%';
          },
          textStrokeColor: 'rgba(0,0,0,0.22)',
          textStrokeWidth: 2,
        },
      },
    },
  }));

  // Build legend
  if (legEl) {
    legEl.innerHTML = fLabels.map((l, i) => {
      const pct = total > 0 ? ((fData[i] / total) * 100).toFixed(0) : 0;
      return `<div class="legend-chip">
        <div class="legend-dot" style="background:${fColors[i]}"></div>
        ${_esc(l)}
        <span style="color:var(--color-label-4);font-weight:500">
          ¥${_fmt(fData[i])} · ${pct}%
        </span>
      </div>`;
    }).join('');
  }

  return chart;
}

// ── 3. Horizontal bar chart ───────────────────────────
export function buildHorizBar(canvasId, labels, data, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const colors = palette().slice(0, labels.length);
  const axDef  = _axisDefaults();

  return _save(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors,
        borderRadius: 8, borderSkipped: false,
      }],
    },
    options: {
      indexAxis:           'y',
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:     { display: false },
        tooltip:    { callbacks: { label: c => `  ¥${_fmt(c.raw)}` } },
        datalabels: {
          display:   true, anchor: 'end', align: 'right', offset: 4,
          color:     cssVar('--color-label-2'),
          font:      { size: 10.5, weight: 700 },
          formatter: v => '¥' + _fmtK(v),
        },
      },
      scales: {
        x: { ...axDef.x, grid: { color: cssVar('--color-sep') },
             ticks: { ...axDef.y.ticks, callback: v => '¥' + _fmtK(v) } },
        y: { ...axDef.y, grid: { display: false } },
      },
    },
  }));
}

// ── 4. Vertical bar chart (weekday rhythm) ────────────
export function buildVertBar(canvasId, labels, data, colors, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const axDef = _axisDefaults();

  return _save(canvasId, new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderRadius: 8, borderSkipped: false }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:     { display: false },
        tooltip:    opts.tooltipCb ? { callbacks: { label: opts.tooltipCb } }
                                   : { callbacks: { label: c => `  ¥${_fmt(c.raw)}` } },
        datalabels: {
          display:   true, anchor: 'end', align: 'top', offset: 2,
          color:     cssVar('--color-label-3'),
          font:      { size: 10, weight: 700 },
          formatter: v => v > 0 ? '¥' + _fmtK(v) : '',
        },
      },
      scales: {
        x: axDef.x,
        y: { ...axDef.y, ticks: { ...axDef.y.ticks, callback: v => '¥' + _fmtK(v) } },
      },
    },
  }));
}

// ── 5. SVG Sparkline (asset bank cards) ──────────────
/**
 * Pure SVG — no Chart.js instance created.
 * @param {number[]} points   historical values, oldest first
 * @returns {string} SVG markup, or '' if < 2 points
 */
export function buildSparklineSvg(points) {
  if (!points || points.length < 2) return '';

  const W = 64, H = 28, P = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = P + (i / (points.length - 1)) * (W - P * 2);
    const y = P + (1 - (v - min) / range) * (H - P * 2);
    return [+x.toFixed(1), +y.toFixed(1)];
  });

  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const up      = points[points.length - 1] >= points[0];
  const stroke  = up ? cssVar('--color-green') : cssVar('--color-red');
  const [lx, ly] = coords[coords.length - 1];

  return `<svg class="bank-card-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">
    <path d="${d}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="${stroke}"/>
  </svg>`;
}

// ── 6. Destroy all charts (e.g. on page unload / theme change) ──
export function destroyAllCharts() {
  Object.keys(_charts).forEach(_destroy);
}

// ── 7. Expose refresh hook for theme.js ──────────────
// theme.js calls window.__rdstr_refreshChartsForTheme after a swap.
// The active page module should re-render its charts.
// This is wired in main.js, not here, to avoid circular deps.

// ── Formatting helpers ────────────────────────────────
function _fmt(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e8)  return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿';
  if (Math.abs(n) >= 1e4)  return (n / 1e4).toFixed(2).replace(/\.?0+$/, '') + '万';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function _fmtK(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(0) + '亿';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '万';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}
function _esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
