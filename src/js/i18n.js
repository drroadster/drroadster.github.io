// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · i18n.js
//  Lightweight ZH / EN translation.
//  Usage:
//    import { t, initI18n, toggleLang } from './i18n.js';
//    t('navOverview')           → '概览' or 'Overview'
//    t('toastTxAdded', {type})  → dynamic string
// ═══════════════════════════════════════════════════════

import { LS } from './config.js';

/** @type {'zh'|'en'} */
let _lang = 'zh';

// ── Dictionaries ──────────────────────────────────────
const DICT = {
  zh: {
    // Nav
    navOverview:      '概览',
    navTransactions:  '记账',
    navAssets:        '资产',
    navAnalysis:      '分析',
    addBtn:           '新增',
    brandSub:         'PERSONAL FINANCE COPILOT',

    // Periods
    periodMonth:   '本月',
    periodQuarter: '本季',
    periodYear:    '今年',
    periodAll:     '全部',

    // Overview
    overviewGreetMorning:   '早上好',
    overviewGreetNoon:      '中午好',
    overviewGreetAfternoon: '下午好',
    overviewGreetEvening:   '晚上好',
    overviewGreetLate:      '夜深了',
    overviewSubtitle:       '这是你的财务总览',
    netBalance:             '净结余 · NET BALANCE',
    totalIncome:            '收入',
    totalExpense:           '支出',
    savingsRate:            '储蓄率',

    // Transactions page
    txTitle:      '记账明细',
    txSubtitle:   '每一笔收支，一目了然',
    txSearch:     '🔍 搜索备注 / 类别…',
    txAll:        '全部',
    txIncome:     '收入',
    txExpense:    '支出',
    txDataMgmt:   '🧹 数据管理',

    // Assets
    assetTitle:     '资产管理',
    assetSubtitle:  '追踪你的财富版图',
    netWorth:       '总净资产 · NET WORTH',
    assetTimeline:  '总资产走势',
    assetBreakdown: '各资产明细走势',
    assetDist:      '资产分布',
    assetStruct:    '资产结构',
    assetDetail:    '资产明细',
    addAsset:       '＋ 添加',

    // Analysis
    analysisTitle:     '财务分析',
    analysisSubtitle:  '读懂财务健康，预见未来',
    healthScore:       '财务健康评分',
    scoreDetail:       '评分细则',
    fortune:           '🔮 财运速览',
    fortuneSub:        '基于你的数据规律生成',
    suggestions:       '💡 智能建议',
    prediction:        '📡 未来预测',
    predictionSub:     '基于历史趋势线性预测',
    rhythm:            '📅 消费节奏',
    rhythmSub:         '按星期几查看消费分布',

    // Quick-add modal
    typeExpense:      '支出',
    typeIncome:       '收入',
    categoryLabel:    '类别',
    dateLabel:        '时间',
    noteLabel:        '备注（可选）',
    notePlaceholder:  '补充说明',
    cancel:           '取消',
    save:             '保存',
    addRecord:        '新增记录',
    addTx:            '🧾 记账数据',
    addTxSub:         '一笔收入或支出',
    addAssetModal:    '🏦 资产数据',
    addAssetSub:      '更新资产金额',

    // Auth
    authLogin:        '登录',
    authRegister:     '注册',
    authLoginDesc:    '登录后数据安全同步到云端',
    authRegisterDesc: '注册后数据自动同步，随时换设备',
    authForgot:       '忘记密码？',
    authSendReset:    '发送重置邮件',
    authBackLogin:    '← 返回登录',
    authName:         '昵称（可选）',
    authEmail:        '邮箱',
    authPassword:     '密码',
    authPasswordPH:   '至少 6 位',
    authLogout:       '退出登录',
    authSyncNow:      '☁️ 立即同步到云端',

    // Import
    importTitle:      '导入数据',
    importTxTab:      '🧾 记账数据',
    importAssetTab:   '🏦 资产数据',
    importTxTitle:    '📂 上传记账 CSV',
    importTxDesc:     '表头：时间 / 收支 / 类别 / 金额 / 备注（顺序任意，自动识别）',
    importAssetTitle: '📂 上传资产 CSV',
    importAssetDesc:  '首行表头：时间, 资产名称1, 资产名称2, …',
    pasteTitle:       '✏️ 手动粘贴记账数据',
    pasteDesc:        '从 Numbers 复制后粘贴，首行为表头自动识别',
    parsePaste:       '解析并导入',
    loadSample:       '载入示例数据',
    clearData:        '清空记账数据',

    // Export
    exportTitle:       '导出数据',
    exportTxCsv:       '导出记账数据 CSV',
    exportTxCsvDesc:   '所有收支记录，可导入 Numbers / Excel',
    exportAssetCsv:    '导出资产明细 CSV',
    exportAssetCsvDesc:'当前资产明细，时间快照格式',
    exportHistoryCsv:  '导出资产走势 CSV',
    exportHistoryDesc: '所有历史快照，首行为资产名称',

    // Storage warning
    storageWarn:      '数据保存在本设备浏览器缓存中',
    storageWarnDesc:  '清除浏览器数据、更换设备会导致本地数据丢失。建议定期导出备份。已登录用户数据已自动同步。',

    // Toasts / errors
    toastInvalidAmount:  '⚠️ 请填写有效金额',
    toastNeedCategory:   '⚠️ 请选择类别',
    toastNeedDate:       '⚠️ 请选择日期',
    toastDuplicate:      '⚠️ 该记录已存在，未重复添加',
    toastTxAdded:        (p) => `✅ 已添加 1 笔${p.type}`,
    toastTxUpdated:      '✅ 记录已更新',
    toastTxDeleted:      '🗑️ 已删除该记录',
    toastAssetSaved:     '✅ 资产已保存，快照已记录',
    toastAssetDeleted:   '🗑️ 已删除该资产',
    toastSynced:         '✅ 数据已同步到云端',
    toastSyncFailed:     (p) => `❌ 同步失败：${p.msg}`,
    toastCloudLoaded:    (p) => `☁️ 已从云端加载 ${p.n} 条记录`,
    toastImportOk:       (p) => `✅ 成功导入 ${p.n} 条记录`,
    toastAssetImportOk:  (p) => `✅ 导入 ${p.n} 条快照，${p.a} 项资产`,
    toastExportDone:     '✅ 已导出，请查看下载文件夹',
    toastNoData:         '⚠️ 暂无数据可导出',
    toastClearDone:      '🗑️ 已清空所有交易记录',
    toastLoginOk:        '✅ 登录成功',
    toastRegisterOk:     '🎉 注册成功，数据已同步！',
    toastLogoutOk:       '👋 已退出登录',
    toastResetSent:      '📧 重置邮件已发送，请查收',
    toastAutoFill:       '💡 已自动填入金额，选择类别后保存',

    // Auth errors
    authErrNotFound:     '该邮箱尚未注册',
    authErrWrongPwd:     '密码错误',
    authErrInvalidCred:  '邮箱或密码不正确',
    authErrEmailUsed:    '该邮箱已被注册',
    authErrWeakPwd:      '密码强度太弱，至少 6 位',
    authErrInvalidEmail: '邮箱格式不正确',
    authErrTooMany:      '尝试次数过多，请稍后再试',
    authErrNetwork:      '网络连接失败，请检查网络',
    authErrUnknown:      (p) => `操作失败（${p.code}）`,
  },

  en: {
    navOverview:      'Overview',
    navTransactions:  'Ledger',
    navAssets:        'Assets',
    navAnalysis:      'Insights',
    addBtn:           'Add',
    brandSub:         'PERSONAL FINANCE COPILOT',

    periodMonth:   'Month',
    periodQuarter: 'Quarter',
    periodYear:    'Year',
    periodAll:     'All',

    overviewGreetMorning:   'Good morning',
    overviewGreetNoon:      'Good noon',
    overviewGreetAfternoon: 'Good afternoon',
    overviewGreetEvening:   'Good evening',
    overviewGreetLate:      'Burning midnight oil',
    overviewSubtitle:       'Your financial overview',
    netBalance:             'NET BALANCE',
    totalIncome:            'Income',
    totalExpense:           'Expense',
    savingsRate:            'Savings',

    txTitle:      'Transactions',
    txSubtitle:   'Every move, crystal clear',
    txSearch:     '🔍 Search note / category…',
    txAll:        'All',
    txIncome:     'Income',
    txExpense:    'Expense',
    txDataMgmt:   '🧹 Data Mgmt',

    assetTitle:     'Assets',
    assetSubtitle:  'Map your wealth',
    netWorth:       'NET WORTH',
    assetTimeline:  'Net Worth Trend',
    assetBreakdown: 'Per-Asset Trend',
    assetDist:      'Distribution',
    assetStruct:    'Structure',
    assetDetail:    'Asset Detail',
    addAsset:       '＋ Add',

    analysisTitle:    'Insights',
    analysisSubtitle: 'Understand your finances, predict your future',
    healthScore:      'Financial Health Score',
    scoreDetail:      'Score Breakdown',
    fortune:          '🔮 Fortune Snapshot',
    fortuneSub:       'Generated from your spending patterns',
    suggestions:      '💡 Smart Suggestions',
    prediction:       '📡 Forecast',
    predictionSub:    'Linear extrapolation from history',
    rhythm:           '📅 Spending Rhythm',
    rhythmSub:        'Spending by day of week',

    typeExpense:     'Expense',
    typeIncome:      'Income',
    categoryLabel:   'Category',
    dateLabel:       'Date & Time',
    noteLabel:       'Note (optional)',
    notePlaceholder: 'Add a note',
    cancel:          'Cancel',
    save:            'Save',
    addRecord:       'New Record',
    addTx:           '🧾 Transaction',
    addTxSub:        'Income or expense',
    addAssetModal:   '🏦 Asset',
    addAssetSub:     'Update asset value',

    authLogin:        'Login',
    authRegister:     'Register',
    authLoginDesc:    'Sync your data securely to the cloud',
    authRegisterDesc: 'Register to sync across all your devices',
    authForgot:       'Forgot password?',
    authSendReset:    'Send reset email',
    authBackLogin:    '← Back to login',
    authName:         'Display name (optional)',
    authEmail:        'Email',
    authPassword:     'Password',
    authPasswordPH:   'At least 6 characters',
    authLogout:       'Sign out',
    authSyncNow:      '☁️ Sync now',

    importTitle:      'Import',
    importTxTab:      '🧾 Transactions',
    importAssetTab:   '🏦 Assets',
    importTxTitle:    '📂 Upload CSV',
    importTxDesc:     'Headers: date / type / category / amount / note (any order)',
    importAssetTitle: '📂 Upload Asset CSV',
    importAssetDesc:  'Row 0: time, AssetName1, AssetName2, …',
    pasteTitle:       '✏️ Paste data',
    pasteDesc:        'Paste from Numbers — first row is header, auto-detected',
    parsePaste:       'Parse & import',
    loadSample:       'Load sample data',
    clearData:        'Clear transactions',

    exportTitle:       'Export',
    exportTxCsv:       'Export Transactions CSV',
    exportTxCsvDesc:   'All income/expense records for Numbers / Excel',
    exportAssetCsv:    'Export Asset Snapshot CSV',
    exportAssetCsvDesc:'Current asset values',
    exportHistoryCsv:  'Export Asset History CSV',
    exportHistoryDesc: 'All historical snapshots, one column per asset',

    storageWarn:     'Data lives in your browser\'s local storage',
    storageWarnDesc: 'Clearing browser data or switching devices will erase local data. Export a backup regularly. Logged-in users are synced automatically.',

    toastInvalidAmount:  '⚠️ Please enter a valid amount',
    toastNeedCategory:   '⚠️ Please pick a category',
    toastNeedDate:       '⚠️ Please pick a date',
    toastDuplicate:      '⚠️ Entry already exists — not added',
    toastTxAdded:        (p) => `✅ Added 1 ${p.type} entry`,
    toastTxUpdated:      '✅ Entry updated',
    toastTxDeleted:      '🗑️ Entry deleted',
    toastAssetSaved:     '✅ Asset saved & snapshot recorded',
    toastAssetDeleted:   '🗑️ Asset deleted',
    toastSynced:         '✅ Data synced to cloud',
    toastSyncFailed:     (p) => `❌ Sync failed: ${p.msg}`,
    toastCloudLoaded:    (p) => `☁️ Loaded ${p.n} records from cloud`,
    toastImportOk:       (p) => `✅ Imported ${p.n} records`,
    toastAssetImportOk:  (p) => `✅ Imported ${p.n} snapshots, ${p.a} assets`,
    toastExportDone:     '✅ Exported — check your downloads',
    toastNoData:         '⚠️ No data to export',
    toastClearDone:      '🗑️ All transactions cleared',
    toastLoginOk:        '✅ Logged in',
    toastRegisterOk:     '🎉 Account created & data synced!',
    toastLogoutOk:       '👋 Signed out',
    toastResetSent:      '📧 Reset email sent — check your inbox',
    toastAutoFill:       '💡 Amount pre-filled — pick a category and save',

    authErrNotFound:     'No account found for this email',
    authErrWrongPwd:     'Incorrect password',
    authErrInvalidCred:  'Email or password is incorrect',
    authErrEmailUsed:    'This email is already registered',
    authErrWeakPwd:      'Password too weak — use at least 6 characters',
    authErrInvalidEmail: 'Invalid email format',
    authErrTooMany:      'Too many attempts — please wait and try again',
    authErrNetwork:      'Network error — check your connection',
    authErrUnknown:      (p) => `Action failed (${p.code})`,
  },
};

// ── Public API ────────────────────────────────────────

/** Initialise i18n. Reads localStorage, falls back to 'zh'. */
export function initI18n() {
  const saved = localStorage.getItem(LS.LANG);
  _lang = (saved === 'en' || saved === 'zh') ? saved : 'zh';
  _apply();
}

/**
 * Translate a key.
 * @param {string} key
 * @param {object} [params]
 * @returns {string}
 */
export function t(key, params) {
  const dict = DICT[_lang] || DICT.zh;
  const val  = dict[key];
  if (typeof val === 'function') return val(params || {});
  if (val !== undefined) return val;
  // Fallback to zh if key missing in en
  const fallback = DICT.zh[key];
  if (typeof fallback === 'function') return fallback(params || {});
  return fallback ?? key;
}

/** Toggle between zh and en. */
export function toggleLang() {
  _lang = _lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem(LS.LANG, _lang);
  _apply();
  if (typeof window.__rdstr_refreshChartsForTheme === 'function') {
    window.__rdstr_refreshChartsForTheme();
  }
}

/** Current language. */
export function getLang() { return _lang; }

// ── Internal ──────────────────────────────────────────

function _apply() {
  document.documentElement.lang = _lang === 'zh' ? 'zh-CN' : 'en';

  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (typeof val === 'string') el.textContent = val;
  });

  // Update placeholder attributes
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    const val = t(key);
    if (typeof val === 'string') el.placeholder = val;
  });

  // Update lang-toggle button labels
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.textContent = _lang === 'zh' ? 'EN' : '中';
  });
}
