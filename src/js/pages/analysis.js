// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · pages/analysis.js
//  Financial analysis: health score, fortune snapshot,
//  smart suggestions, linear prediction, weekday rhythm.
//
//  NOTE: this is the v2.0 baseline. v2.2 will replace the
//  scoring/prediction logic with a proper Engine module — see
//  the architecture comment at the bottom of this file.
// ═══════════════════════════════════════════════════════

import { getTransactions, getAssets, catTotals } from '../store.js';
import { buildLineChart, buildVertBar, cssVar, hexToRgba } from '../charts.js';
import { fmt, fmtK, esc, pad2, clamp } from '../utils.js';
import { onNavigate } from '../router.js';

export function initAnalysisPage() {
  onNavigate(page => {
    if (page === 'analysis') {
      // Reset to "财务分析" tab
      document.querySelectorAll('[data-analysis-tab]').forEach(t =>
        t.classList.toggle('active', t.dataset.analysisTab === 'analysis')
      );
      document.querySelectorAll('[data-analysis-panel]').forEach(p =>
        p.classList.toggle('active', p.dataset.analysisPanel === 'analysis')
      );
      render();
    }
  });
}

export function render() {
  const txs = getTransactions();
  if (!txs.length) {
    _renderEmptyStates();
    return;
  }
  const stats = _computeStats(txs);
  _renderHealthScore(stats);
  _renderFortune(stats);
  _renderSuggestions(stats);
  _renderPrediction(stats);
  _renderWeekday(stats);
}

function _renderEmptyStates() {
  _setHealthScoreEmpty();
  _el('fortuneCard').innerHTML = _emptyBlock('🔮', '积累数据后生成专属财运卡');
  _el('suggestionsList').innerHTML = `<div class="card glass">${_emptyBlock('💡', '积累数据后生成个性化建议')}</div>`;
  _setPredictionEmpty();
  const wd = _el('weekdayChart'); if (wd) wd.style.display = 'none';
}

// ── Stats computation ──────────────────────────────────
function _computeStats(txs) {
  const monthMap = {};
  txs.forEach(t => {
    const k = t.date.slice(0, 7);
    if (!monthMap[k]) monthMap[k] = { income: 0, expense: 0 };
    if (t.type === '收入') monthMap[k].income += t.amount; else monthMap[k].expense += t.amount;
  });
  const months = Object.keys(monthMap).sort();
  const totalIncome  = txs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);

  const monthRates = months.map(k => monthMap[k].income > 0
    ? (monthMap[k].income - monthMap[k].expense) / monthMap[k].income : null).filter(v => v !== null);
  const avgSaveRate = monthRates.length ? monthRates.reduce((a,b)=>a+b,0) / monthRates.length : null;

  const expCats = catTotals(txs, '支出');
  const expKeys = Object.keys(expCats);
  const topCat  = expKeys.sort((a,b) => expCats[b] - expCats[a])[0];
  const topCatShare = topCat ? expCats[topCat] / totalExpense : 0;
  const smallestCat = expKeys.sort((a,b) => expCats[a] - expCats[b])[0] || topCat;

  const nets = months.map(k => monthMap[k].income - monthMap[k].expense);
  const meanNet = nets.length ? nets.reduce((a,b)=>a+b,0) / nets.length : 0;
  const variance = nets.length > 1 ? nets.reduce((s,n)=>s+Math.pow(n-meanNet,2),0) / nets.length : 0;
  const stdNet = Math.sqrt(variance);

  const assets = getAssets();
  const totalAssets = assets.reduce((s,a)=>s+a.value, 0);
  const avgMonthlyExpense = months.length ? totalExpense / months.length : 0;
  const monthsCovered = avgMonthlyExpense > 0 ? totalAssets / avgMonthlyExpense : null;

  const weekdayTotals = [0,0,0,0,0,0,0], weekdayCounts = [0,0,0,0,0,0,0];
  txs.filter(t => t.type === '支出').forEach(t => {
    const wd = new Date(t.date).getDay();
    weekdayTotals[wd] += t.amount; weekdayCounts[wd]++;
  });

  return { months, monthMap, totalIncome, totalExpense, avgSaveRate,
           topCat, topCatShare, smallestCat, expCats,
           stdNet, meanNet, totalAssets, monthsCovered,
           weekdayTotals, weekdayCounts, txCount: txs.length };
}

// ── 1. Health score ─────────────────────────────────────
function _renderHealthScore(s) {
  const dims = [];

  let saveScore = s.avgSaveRate === null ? 50 : clamp(50 + s.avgSaveRate * 100, 0, 100);
  dims.push({ key:'储蓄率', score:saveScore, weight:.35,
    detail: s.avgSaveRate !== null ? `平均储蓄率 ${Math.round(s.avgSaveRate*100)}%` : '暂无足够数据' });

  const concScore = clamp(100 - s.topCatShare*100, 0, 100);
  dims.push({ key:'消费分散度', score:concScore, weight:.2,
    detail: s.topCat ? `「${s.topCat}」占支出 ${Math.round(s.topCatShare*100)}%` : '暂无数据' });

  const relVol = s.meanNet !== 0 ? Math.abs(s.stdNet/s.meanNet) : (s.stdNet>0?1:0);
  const stabScore = clamp(100 - relVol*60, 0, 100);
  dims.push({ key:'现金流稳定性', score:stabScore, weight:.2,
    detail: s.months.length>=2 ? '基于月度净结余波动计算' : '数据月份不足，按中性评估' });

  let efScore = s.monthsCovered === null ? 50 : clamp((s.monthsCovered/6)*100, 0, 100);
  dims.push({ key:'应急资金覆盖', score:efScore, weight:.25,
    detail: s.monthsCovered !== null ? `资产可覆盖 ${s.monthsCovered.toFixed(1)} 个月支出` : '请在「资产」中录入资产数据' });

  const total = Math.round(dims.reduce((sum,d) => sum + d.score*d.weight, 0));

  const scoreEl = _el('healthScore');
  const labelEl = _el('healthScoreLabel');
  const barEl   = _el('healthScoreBar');
  const breakdownEl = _el('scoreBreakdownList');
  if (!scoreEl) return;

  scoreEl.textContent = total;
  let label, color;
  if (total >= 85)      { label = '优秀 · 财务状况稳健';     color = cssVar('--color-green'); }
  else if (total >= 70) { label = '良好 · 整体健康有提升空间'; color = cssVar('--color-blue'); }
  else if (total >= 50) { label = '一般 · 建议关注收支结构';   color = cssVar('--color-orange'); }
  else                  { label = '需要关注 · 建议调整消费习惯'; color = cssVar('--color-red'); }
  if (labelEl) labelEl.textContent = label;

  if (barEl) {
    const filled = Math.round(total / 20);
    barEl.innerHTML = Array.from({length:5}).map((_, i) =>
      `<div style="width:32px;height:6px;border-radius:3px;background:${i<filled?'rgba(255,255,255,.95)':'rgba(255,255,255,.25)'}"></div>`
    ).join('');
  }

  if (breakdownEl) {
    breakdownEl.innerHTML = dims.map(d => {
      const pct = Math.round(d.score);
      const barColor = pct>=70 ? cssVar('--color-green') : pct>=45 ? cssVar('--color-orange') : cssVar('--color-red');
      return `<div style="margin-bottom:16px">
        <div class="flex-between" style="margin-bottom:6px">
          <span style="font-size:13.5px;font-weight:700">${d.key}</span>
          <span style="font-size:13px;font-weight:700;color:${barColor}">${pct}</span>
        </div>
        <div style="height:7px;border-radius:4px;background:var(--color-surface-2);overflow:hidden">
          <div class="score-bar-fill" style="height:100%;width:${pct}%;border-radius:4px;background:${barColor}"></div>
        </div>
        <div style="font-size:11.5px;color:var(--color-label-4);margin-top:5px;font-weight:600">${d.detail}</div>
      </div>`;
    }).join('');
  }
}
function _setHealthScoreEmpty() {
  const scoreEl = _el('healthScore'); if (scoreEl) scoreEl.textContent = '—';
  const labelEl = _el('healthScoreLabel'); if (labelEl) labelEl.textContent = '导入数据后开始评分';
  const barEl = _el('healthScoreBar'); if (barEl) barEl.innerHTML = '';
  const bd = _el('scoreBreakdownList'); if (bd) bd.innerHTML = _emptyBlock('', '暂无数据可评分');
}

// ── 2. Fortune card ──────────────────────────────────────
function _renderFortune(s) {
  const card = _el('fortuneCard'); if (!card) return;
  const saveRatePct = s.avgSaveRate !== null ? Math.round(s.avgSaveRate*100) : null;
  let mood, icon, color;
  if (saveRatePct === null)      { mood='观望期'; icon='🌤️'; color='var(--color-orange)'; }
  else if (saveRatePct >= 30)    { mood='顺风期'; icon='☀️'; color='var(--color-green)'; }
  else if (saveRatePct >= 10)    { mood='平稳期'; icon='⛅'; color='var(--color-blue)'; }
  else if (saveRatePct >= 0)     { mood='紧绷期'; icon='🌥️'; color='var(--color-orange)'; }
  else                           { mood='调整期'; icon='🌧️'; color='var(--color-red)'; }
  const luckScore = clamp(Math.round(50 + (saveRatePct||0)*1.2), 5, 99);

  card.innerHTML = `
    <div class="flex-row gap-16" style="align-items:flex-start">
      <div style="font-size:40px;line-height:1">${icon}</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800;color:${color}">本月财运：${mood}</div>
        <div style="font-size:12.5px;color:var(--color-label-3);margin-top:3px;font-weight:600">基于储蓄率与消费规律推算，仅供参考娱乐</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:22px;font-weight:800">${luckScore}</div>
        <div style="font-size:10px;color:var(--color-label-4);font-weight:700">财运值</div>
      </div>
    </div>
    <div class="divider" style="margin:16px 0"></div>
    <div class="grid-2" style="gap:10px">
      <div class="card-flat">
        <div style="font-size:11px;color:var(--color-label-4);font-weight:700;margin-bottom:4px">💰 招财类别</div>
        <div style="font-size:13.5px;font-weight:700">${esc(s.smallestCat || '—')}</div>
        <div style="font-size:11px;color:var(--color-label-4);margin-top:2px">消费最克制</div>
      </div>
      <div class="card-flat">
        <div style="font-size:11px;color:var(--color-label-4);font-weight:700;margin-bottom:4px">⚠️ 破财类别</div>
        <div style="font-size:13.5px;font-weight:700">${esc(s.topCat || '—')}</div>
        <div style="font-size:11px;color:var(--color-label-4);margin-top:2px">支出占比最高</div>
      </div>
    </div>`;
}

// ── 3. Smart suggestions ───────────────────────────────
function _renderSuggestions(s) {
  const wrap = _el('suggestionsList'); if (!wrap) return;
  const suggestions = [];

  if (s.avgSaveRate !== null && s.avgSaveRate < 0.1) {
    suggestions.push({ icon:'⚠️', color:'var(--color-red)', title:'储蓄率偏低',
      text:`平均储蓄率仅 ${Math.round(s.avgSaveRate*100)}%，建议优先检查「${s.topCat||'高频'}」类支出是否有压缩空间。` });
  } else if (s.avgSaveRate !== null && s.avgSaveRate >= 0.3) {
    suggestions.push({ icon:'🎉', color:'var(--color-green)', title:'储蓄表现优秀',
      text:`平均储蓄率达 ${Math.round(s.avgSaveRate*100)}%，可考虑将结余配置到基金/股票提升收益。` });
  }
  if (s.topCatShare > 0.4) {
    suggestions.push({ icon:'📊', color:'var(--color-orange)', title:'支出过度集中',
      text:`「${s.topCat}」占总支出 ${Math.round(s.topCatShare*100)}%，建议设置该类别月度预算上限。` });
  }
  if (s.monthsCovered !== null && s.monthsCovered < 3) {
    suggestions.push({ icon:'🛟', color:'var(--color-blue)', title:'应急资金不足',
      text:`当前资产仅能覆盖约 ${s.monthsCovered.toFixed(1)} 个月支出，建议积累至 3-6 个月。` });
  } else if (s.monthsCovered === null) {
    suggestions.push({ icon:'🏦', color:'var(--color-blue)', title:'尚未录入资产',
      text:'前往「资产」页面录入储蓄/投资情况，以便评估应急资金覆盖能力。' });
  }
  if (s.months.length >= 3) {
    const last3 = s.months.slice(-3).map(k => s.monthMap[k].expense);
    if (last3[2] > last3[0] * 1.2) {
      suggestions.push({ icon:'📈', color:'var(--color-red)', title:'支出呈上升趋势',
        text:'近 3 个月支出持续走高，建议复盘近期大额消费。' });
    }
  }
  if (!suggestions.length) {
    suggestions.push({ icon:'✅', color:'var(--color-green)', title:'财务状况良好', text:'各项指标暂未发现明显异常，继续保持当前节奏。' });
  }

  wrap.innerHTML = suggestions.map(sg => `
    <div class="card glass" style="margin-bottom:12px">
      <div class="flex-row gap-16" style="align-items:flex-start">
        <div style="font-size:24px;flex-shrink:0">${sg.icon}</div>
        <div>
          <div style="font-size:14.5px;font-weight:800;color:${sg.color}">${sg.title}</div>
          <div style="font-size:13px;color:var(--color-label-2);margin-top:4px;line-height:1.55;font-weight:500">${sg.text}</div>
        </div>
      </div>
    </div>`).join('');
}

// ── 4. Prediction (linear regression) ───────────────────
function _renderPrediction(s) {
  if (s.months.length < 2) { _setPredictionEmpty(); return; }
  const emptyEl = _el('predictionEmpty'), wrapEl = _el('predictionWrap'), sumEl = _el('predictionSummary');
  if (emptyEl) emptyEl.style.display = 'none';
  if (wrapEl)  wrapEl.style.display  = '';
  if (sumEl)   sumEl.style.display   = '';

  const months = s.months;
  const expSeries = months.map(k => s.monthMap[k].expense);
  const incSeries = months.map(k => s.monthMap[k].income);

  function linReg(arr) {
    const n = arr.length, xs = arr.map((_,i)=>i);
    const xMean = xs.reduce((a,b)=>a+b,0)/n, yMean = arr.reduce((a,b)=>a+b,0)/n;
    let num=0, den=0;
    for (let i=0;i<n;i++) { num += (xs[i]-xMean)*(arr[i]-yMean); den += Math.pow(xs[i]-xMean,2); }
    const b = den ? num/den : 0;
    return { a: yMean - b*xMean, b };
  }
  const expReg = linReg(expSeries), incReg = linReg(incSeries);

  const futureCount = 3, futureLabels = [];
  let [fy, fm] = months[months.length-1].split('-').map(Number);
  for (let i=1; i<=futureCount; i++) { fm++; if (fm>12){fm=1;fy++;} futureLabels.push(`${fy}-${pad2(fm)}`); }

  const allLabels = [...months, ...futureLabels];
  const expHist = expSeries.concat(Array(futureCount).fill(null));
  const incHist = incSeries.concat(Array(futureCount).fill(null));
  const expPred = Array(months.length-1).fill(null).concat([expSeries.at(-1)],
    futureLabels.map((_,i)=>Math.max(0, expReg.a+expReg.b*(months.length+i))));
  const incPred = Array(months.length-1).fill(null).concat([incSeries.at(-1)],
    futureLabels.map((_,i)=>Math.max(0, incReg.a+incReg.b*(months.length+i))));

  buildLineChart('predictionChart', allLabels, [
    { label:'历史支出', data:expHist, color:cssVar('--color-red'),   borderWidth:2.5 },
    { label:'预测支出', data:expPred, color:cssVar('--color-red'),   borderWidth:2, dash:[6,4] },
    { label:'历史收入', data:incHist, color:cssVar('--color-green'), borderWidth:2.5 },
    { label:'预测收入', data:incPred, color:cssVar('--color-green'), borderWidth:2, dash:[6,4] },
  ]);

  const nextExp = Math.max(0, expReg.a + expReg.b*months.length);
  const nextInc = Math.max(0, incReg.a + incReg.b*months.length);
  const nextNet = nextInc - nextExp;
  const trend = expReg.b>0 ? '上升' : expReg.b<0 ? '下降' : '持平';
  const trendColor = expReg.b>0 ? 'var(--color-red)' : expReg.b<0 ? 'var(--color-green)' : 'var(--color-label-3)';

  if (sumEl) sumEl.innerHTML = `
    <div class="grid-3" style="gap:10px">
      <div class="card-flat"><div style="font-size:11px;color:var(--color-label-4);font-weight:700">下月预计支出</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px">¥${fmt(nextExp)}</div></div>
      <div class="card-flat"><div style="font-size:11px;color:var(--color-label-4);font-weight:700">下月预计收入</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px">¥${fmt(nextInc)}</div></div>
      <div class="card-flat" style="grid-column:1/-1"><div style="font-size:11px;color:var(--color-label-4);font-weight:700">支出趋势</div>
        <div style="font-size:14px;font-weight:800;margin-top:3px;color:${trendColor}">呈${trend}趋势 · 预计净结余 ${nextNet>=0?'+':''}¥${fmt(Math.abs(nextNet))}</div></div>
    </div>
    <div style="font-size:11px;color:var(--color-label-4);margin-top:10px;font-weight:500">* 基于线性回归对历史月度数据的简单外推，仅供参考</div>`;
}
function _setPredictionEmpty() {
  const emptyEl = _el('predictionEmpty'), wrapEl = _el('predictionWrap'), sumEl = _el('predictionSummary');
  if (emptyEl) emptyEl.style.display = '';
  if (wrapEl)  wrapEl.style.display  = 'none';
  if (sumEl)   sumEl.style.display   = 'none';
}

// ── 5. Weekday rhythm ────────────────────────────────────
function _renderWeekday(s) {
  const canvas = _el('weekdayChart');
  if (!canvas || !s.weekdayTotals.some(v => v>0)) {
    if (canvas) canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';
  const labels = ['周日','周一','周二','周三','周四','周五','周六'];
  const maxVal = Math.max(...s.weekdayTotals);
  const red = cssVar('--color-red'), blue = cssVar('--color-blue');
  const colors = s.weekdayTotals.map(v => v===maxVal && v>0 ? red : hexToRgba(blue, .55));
  buildVertBar('weekdayChart', labels, s.weekdayTotals, colors, {
    tooltipCb: c => `  ¥${fmt(c.raw)} · ${s.weekdayCounts[c.dataIndex]}笔`,
  });
}

// ── Helpers ────────────────────────────────────────────
function _el(id) { return document.getElementById(id); }
function _emptyBlock(icon, text) {
  return `<div class="empty-state" style="padding:24px 0">
    <div class="empty-icon">${icon}</div><div class="empty-text">${text}</div></div>`;
}

/* ═══════════════════════════════════════════════════════
   ARCHITECTURE NOTE for v2.2 (AI Financial Analysis):

   The scoring/prediction logic above is intentionally kept as plain
   functions operating on the Store's transaction/asset arrays. This
   is the v2.0 baseline.

   In v2.2 this will be refactored into a dedicated `Engine` module:

     src/js/engine/
       scoring.js       — health score (replace heuristic weights
                           with a configurable rule engine)
       prediction.js     — replace linear regression with a proper
                           time-series model (e.g. exponential
                           smoothing or a small seasonal-decompose)
       fire.js          — FIRE retirement calculator
       budget.js        — budget tracking & alerts
       insights.js       — AI-generated natural-language insights
                           (calls an LLM with the user's anonymised
                           aggregate stats, never raw transaction text)

   pages/analysis.js will become a thin presentation layer that
   calls Engine functions and renders the result — exactly the
   Store/Engine split outlined in the v2.1 roadmap.
   ═══════════════════════════════════════════════════════ */
