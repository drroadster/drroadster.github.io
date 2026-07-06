// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · store.js
//  Centralised reactive data store — Delta Sync 版
//
//  所有读写必须经过此模块。UI 层禁止直接操作 localStorage。
//
//  v2.1 变更：
//  • 每条交易/资产独立记录，包含完整同步元数据：
//    id, createdAt, updatedAt, deviceId, version, deleted, syncStatus
//  • 新增 ID 级 CRUD 操作（getTx / addTx / updateTx / deleteTx）
//  • 保持与 v2.0 的完全向后兼容
//  • 自动迁移旧数据格式
//
//  架构：
//  ┌────────────┐   mutate   ┌────────────┐  persist  ┌────────────┐
//  │   Pages    │ ────────▶  │   Store    │ ────────▶ │localStorage│
//  └────────────┘            └────────────┘           └────────────┘
//                                  │ emit
//                            ┌─────▼──────┐
//                            │ Subscribers│ (charts, sync engine, etc.)
//                            └────────────┘
// ═══════════════════════════════════════════════════════

import { LS, ALL_CATS, CAT_KEYWORD_MAP, getAllCategories, getCustomCategories } from './config.js';
import { generateTxId, generateAssetId, getDeviceId, nextVersion } from './sync/versionManager.js';

// ── State ─────────────────────────────────────────────
/** @type {Transaction[]} */
let _transactions = [];
/** @type {Asset[]} */
let _assets       = [];
/** @type {Snapshot[]} */
let _history      = [];

// ── Change subscribers ────────────────────────────────
/** @type {Map<string, Set<Function>>} */
const _subs = new Map([
  ['transactions', new Set()],
  ['assets',       new Set()],
  ['history',      new Set()],
  ['any',          new Set()],
]);

function _emit(channel) {
  (_subs.get(channel) || new Set()).forEach(cb => {
    try { cb(); } catch (e) { console.error('[store] subscriber error', e); }
  });
  (_subs.get('any') || new Set()).forEach(cb => {
    try { cb(channel); } catch (e) {}
  });
}

/**
 * Subscribe to store changes.
 * @param {'transactions'|'assets'|'history'|'any'} channel
 * @param {Function} cb
 * @returns {() => void}  unsubscribe
 */
export function subscribe(channel, cb) {
  if (!_subs.has(channel)) _subs.set(channel, new Set());
  _subs.get(channel).add(cb);
  return () => _subs.get(channel).delete(cb);
}

// ── Initialise ────────────────────────────────────────
/** Load all data from localStorage. Call once at startup. */
export function initStore() {
  _transactions = _read(LS.TX);
  _assets       = _read(LS.ASSETS);
  _history      = _read(LS.ASSET_HISTORY);

  // V2 数据迁移（类别标准化 + 添加同步元数据）
  migrateDataV2();

  // v2.1 数据迁移（为旧数据补充 sync 元数据字段）
  migrateDataV21();
}

/**
 * Replace the entire store from an external source (e.g. cloud merge).
 * Used by syncManager after merge.
 */
export function reloadFromStorage() {
  _transactions = _read(LS.TX);
  _assets       = _read(LS.ASSETS);
  _history      = _read(LS.ASSET_HISTORY);
  _emit('transactions');
  _emit('assets');
  _emit('history');
}

// ═══════════════════════════════════════════════════════
//  v2.1 新增：ID 级 CRUD（带同步元数据）
// ═══════════════════════════════════════════════════════

/**
 * 为新记录生成完整的同步元数据。
 * @param {'tx'|'asset'} type
 * @returns {Object} 元数据字段
 */
function _newSyncMeta(type) {
  const now = new Date().toISOString();
  return {
    id:        type === 'tx' ? generateTxId() : generateAssetId(),
    createdAt: now,
    updatedAt: now,
    deviceId:  getDeviceId(),
    version:   1,
    deleted:   false,
    syncStatus:'local',
  };
}

// ── Transactions (ID-level) ──────────────────────────

/**
 * 按 ID 获取单条交易。
 * @param {string} id
 * @returns {Transaction|undefined}
 */
export function getTx(id) {
  return _transactions.find(t => t.id === id);
}

/**
 * 新增一条交易（自动生成 ID 和同步元数据）。
 * @param {Partial<Transaction>} tx - 至少包含 type, amount, category
 * @returns {Transaction}
 */
export function addTx(tx) {
  const meta = _newSyncMeta('tx');
  const record = { ...tx, ...meta };
  _transactions.push(record);
  _persist(LS.TX, _transactions);
  _emit('transactions');
  return record;
}

/**
 * 更新一条交易的部分字段。
 * 自动更新 updatedAt、递增 version、设置 syncStatus 为 'local'。
 * @param {string} id
 * @param {Partial<Transaction>} changes
 * @returns {boolean} 是否找到并更新
 */
export function updateTx(id, changes) {
  const idx = _transactions.findIndex(t => t.id === id);
  if (idx === -1) return false;

  _transactions[idx] = {
    ..._transactions[idx],
    ...changes,
    updatedAt:  new Date().toISOString(),
    version:    nextVersion(_transactions[idx].version),
    syncStatus: _transactions[idx].syncStatus === 'synced' ? 'local' : _transactions[idx].syncStatus,
  };
  _persist(LS.TX, _transactions);
  _emit('transactions');
  return true;
}

/**
 * 软删除一条交易（设置 deleted=true，不物理删除）。
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTx(id) {
  return updateTx(id, { deleted: true });
}

// ── Assets (ID-level) ────────────────────────────────

/**
 * 按 ID 获取单个资产。
 * @param {string} id
 * @returns {Asset|undefined}
 */
export function getAsset(id) {
  return _assets.find(a => a.id === id);
}

/**
 * 新增一个资产。
 * @param {Partial<Asset>} asset
 * @returns {Asset}
 */
export function addAsset(asset) {
  const meta = _newSyncMeta('asset');
  const record = { ...asset, ...meta };
  _assets.push(record);
  _persist(LS.ASSETS, _assets);
  _emit('assets');
  return record;
}

/**
 * 更新一个资产的部分字段。
 * @param {string} id
 * @param {Partial<Asset>} changes
 * @returns {boolean}
 */
export function updateAsset(id, changes) {
  const idx = _assets.findIndex(a => a.id === id);
  if (idx === -1) return false;

  _assets[idx] = {
    ..._assets[idx],
    ...changes,
    updatedAt:  new Date().toISOString(),
    version:    nextVersion(_assets[idx].version),
    syncStatus: _assets[idx].syncStatus === 'synced' ? 'local' : _assets[idx].syncStatus,
  };
  _persist(LS.ASSETS, _assets);
  _emit('assets');
  return true;
}

/**
 * 软删除一个资产。
 * @param {string} id
 * @returns {boolean}
 */
export function deleteAssetV21(id) {
  return updateAsset(id, { deleted: true });
}

// ═══════════════════════════════════════════════════════
//  v2.1 新增：Sync Engine 专用方法
// ═══════════════════════════════════════════════════════

/**
 * 获取原始交易数组（包含所有元数据，不排序）。
 * 供 syncManager 使用，UI 层应使用 getTransactions()。
 * @returns {Transaction[]}
 */
export function getTransactionsRaw() {
  return [..._transactions];
}

/**
 * 获取原始资产数组（包含所有元数据）。
 * @returns {Asset[]}
 */
export function getAssetsRaw() {
  return [..._assets];
}

/**
 * 替换全部交易数据（用于 Merge 后回写）。
 * @param {Transaction[]} items
 */
export function replaceAllTransactions(items) {
  _transactions = items;
  _persist(LS.TX, _transactions);
  _emit('transactions');
}

/**
 * 替换全部资产数据。
 * @param {Asset[]} items
 */
export function replaceAllAssets(items) {
  _assets = items;
  _persist(LS.ASSETS, _assets);
  _emit('assets');
}

/**
 * 获取待上传的交易（syncStatus !== 'synced' 且未删除）。
 * @returns {Transaction[]}
 */
export function getPendingTransactions() {
  return _transactions.filter(t =>
    t.syncStatus !== 'synced' && t.deleted !== true
  );
}

/**
 * 获取待上传的资产。
 * @returns {Asset[]}
 */
export function getPendingAssets() {
  return _assets.filter(a =>
    a.syncStatus !== 'synced' && a.deleted !== true
  );
}

/**
 * 将所有「未同步」的记录标记为待上传（local → pending_upload）。
 * 用于登录同步前批量准备上传队列。
 */
export function markAllPendingUpload() {
  let txChanged = false, assetChanged = false;

  _transactions.forEach(t => {
    if (t.syncStatus === 'local' && t.deleted !== true) {
      t.syncStatus = 'pending_upload';
      txChanged = true;
    }
  });

  _assets.forEach(a => {
    if (a.syncStatus === 'local' && a.deleted !== true) {
      a.syncStatus = 'pending_upload';
      assetChanged = true;
    }
  });

  if (txChanged)  { _persist(LS.TX, _transactions); _emit('transactions'); }
  if (assetChanged) { _persist(LS.ASSETS, _assets); _emit('assets'); }
}

/**
 * 将所有记录的 syncStatus 标记为 'synced'。
 * 在上传队列全部处理完成后调用。
 */
export function markAllSynced() {
  let txChanged = false, assetChanged = false;

  _transactions.forEach(t => {
    if (t.syncStatus !== 'synced' && t.deleted !== true) {
      t.syncStatus = 'synced';
      txChanged = true;
    }
  });

  _assets.forEach(a => {
    if (a.syncStatus !== 'synced' && a.deleted !== true) {
      a.syncStatus = 'synced';
      assetChanged = true;
    }
  });

  if (txChanged)  { _persist(LS.TX, _transactions); _emit('transactions'); }
  if (assetChanged) { _persist(LS.ASSETS, _assets); _emit('assets'); }
}

// ═══════════════════════════════════════════════════════
//  v2.0 兼容层（保持现有页面代码不变）
// ═══════════════════════════════════════════════════════

/** @returns {Transaction[]} sorted newest-first */
export function getTransactions() {
  return [..._transactions]
    .filter(t => t.deleted !== true)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Add one or more transactions (deduplicated by fingerprint).
 * v2.1: 自动为新记录添加同步元数据。
 * @param {Transaction|Transaction[]} items
 * @returns {{ added: number, duplicates: number }}
 */
export function addTransactions(items) {
  const arr      = Array.isArray(items) ? items : [items];
  const existing = new Set(_transactions.map(_fp));
  let added = 0, duplicates = 0;

  for (const inputTx of arr) {
    const key = _fp(inputTx);
    if (existing.has(key)) { duplicates++; continue; }

    // 如果传入的记录缺少同步元数据，自动补充
    const tx = inputTx.id && inputTx.createdAt
      ? inputTx
      : { ...inputTx, ..._newSyncMeta('tx'), date: inputTx.date };

    // Normalise category before storing
    const normalised = { ...tx, category: normalizeCategory(tx.category || tx.note || '') };
    _transactions.push(normalised);
    existing.add(key);
    added++;
  }

  if (added) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return { added, duplicates };
}

/**
 * Update an existing transaction by id.
 * v2.1: 委托给 updateTx，自动处理同步元数据。
 * @param {string}  id
 * @param {Partial<Transaction>} patch
 * @returns {boolean}
 */
export function updateTransaction(id, patch) {
  return updateTx(id, patch);
}

/**
 * Delete a transaction by id (soft delete).
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTransaction(id) {
  return deleteTx(id);
}

/**
 * Delete all transactions in a category.
 * @param {string} category
 * @returns {number} count deleted
 */
export function deleteByCategory(category) {
  let n = 0;
  _transactions.forEach(t => {
    if (t.category === category && !t.deleted) {
      t.deleted = true;
      t.updatedAt = new Date().toISOString();
      t.syncStatus = t.syncStatus === 'synced' ? 'local' : t.syncStatus;
      n++;
    }
  });
  if (n) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return n;
}

/**
 * Re-normalise all transaction categories using the keyword map.
 * @returns {number} count changed
 */
export function renormalizeAllCategories() {
  let changed = 0;
  _transactions.forEach(t => {
    if (t.deleted) return;
    const norm = normalizeCategory(t.category);
    if (norm !== t.category) { t.category = norm; changed++; }
  });
  if (changed) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return changed;
}

/** Clear all transactions. */
export function clearTransactions() {
  _transactions = [];
  _persist(LS.TX, _transactions);
  _emit('transactions');
}

// ── Assets (compat) ──────────────────────────────────

/** @returns {Asset[]} */
export function getAssets() {
  return [..._assets].filter(a => a.deleted !== true);
}

/**
 * Add or update an asset. If an asset with the same id exists it is
 * updated; otherwise a new one is pushed.
 * v2.1: 自动补充同步元数据。
 * @param {Asset} asset
 */
export function upsertAsset(asset) {
  const idx = _assets.findIndex(a => a.id === asset.id);
  if (idx === -1) {
    // 新资产：补充同步元数据
    const record = asset.id && asset.createdAt
      ? asset
      : { ...asset, ..._newSyncMeta('asset') };
    _assets.push(record);
  } else {
    // 更新已有资产
    _assets[idx] = {
      ..._assets[idx],
      ...asset,
      updatedAt:  new Date().toISOString(),
      version:    nextVersion(_assets[idx].version),
      syncStatus: _assets[idx].syncStatus === 'synced' ? 'local' : _assets[idx].syncStatus,
    };
  }
  _persist(LS.ASSETS, _assets);
  _emit('assets');
}

/**
 * Delete an asset by id (soft delete).
 * @param {string} id
 * @returns {boolean}
 */
export function deleteAsset(id) {
  return deleteAssetV21(id);
}

// ── Asset History (snapshots) ─────────────────────────

/** @returns {Snapshot[]} chronological */
export function getAssetHistory() { return [..._history]; }

/**
 * Record a new snapshot of total + per-asset breakdown.
 */
export function recordSnapshot() {
  const total     = _assets.filter(a => !a.deleted).reduce((s, a) => s + (a.value || 0), 0);
  const breakdown = Object.fromEntries(_assets.filter(a => !a.deleted).map(a => [a.id, a.value || 0]));

  if (_history.length) {
    const last = _history[_history.length - 1];
    if (last.total === total &&
        JSON.stringify(last.breakdown) === JSON.stringify(breakdown)) return;
  }

  const ts  = new Date().toISOString();
  const day = ts.slice(0, 10);

  const idx = _history.findIndex(h => h.ts.slice(0, 10) === day);
  const snap = { ts, total, breakdown };
  if (idx === -1) _history.push(snap);
  else            _history[idx] = snap;

  _history.sort((a, b) => a.ts.localeCompare(b.ts));
  _persist(LS.ASSET_HISTORY, _history);
  _emit('history');
}

export function importAssetSnapshots(snaps) {
  let added = 0;
  snaps.forEach(s => {
    const day = (s.ts || '').slice(0, 10);
    if (!day) return;
    const idx = _history.findIndex(h => h.ts.slice(0, 10) === day);
    if (idx === -1) { _history.push(s); added++; }
    else            { _history[idx] = s; }
  });
  _history.sort((a, b) => a.ts.localeCompare(b.ts));
  if (added) { _persist(LS.ASSET_HISTORY, _history); _emit('history'); }
  return added;
}

// ═══════════════════════════════════════════════════════
//  v2.1 数据迁移
// ═══════════════════════════════════════════════════════

const MIGRATED_V21_KEY = 'rdstr_migrated_v21';

/**
 * 将 v2.0 旧格式数据迁移到 v2.1 Delta Sync 格式。
 * 为每条记录补充：createdAt, updatedAt, deviceId, version, deleted, syncStatus
 * 仅执行一次（由 MIGRATED_V21_KEY 守卫）。
 * @returns {{ txCount: number, assetCount: number }}
 */
export function migrateDataV21() {
  try {
    if (localStorage.getItem(MIGRATED_V21_KEY)) return { txCount: 0, assetCount: 0 };
  } catch { return { txCount: 0, assetCount: 0 }; }

  const deviceId = getDeviceId();
  const now = new Date().toISOString();
  let txChanged = 0, assetChanged = 0;

  // 迁移交易
  _transactions.forEach(tx => {
    let modified = false;
    if (!tx.id)         { tx.id = generateTxId(); modified = true; }
    if (!tx.createdAt)  { tx.createdAt = tx.date || now; modified = true; }
    if (!tx.updatedAt)  { tx.updatedAt = tx.date || now; modified = true; }
    if (!tx.deviceId)   { tx.deviceId = deviceId; modified = true; }
    if (tx.version == null) { tx.version = 1; modified = true; }
    if (tx.deleted == null) { tx.deleted = false; modified = true; }
    if (!tx.syncStatus) { tx.syncStatus = 'local'; modified = true; }
    if (modified) txChanged++;
  });

  // 迁移资产
  _assets.forEach(asset => {
    let modified = false;
    if (!asset.id)         { asset.id = generateAssetId(); modified = true; }
    if (!asset.createdAt)  { asset.createdAt = asset.updatedAt || now; modified = true; }
    if (!asset.updatedAt)  { asset.updatedAt = asset.createdAt || now; modified = true; }
    if (!asset.deviceId)   { asset.deviceId = deviceId; modified = true; }
    if (asset.version == null) { asset.version = 1; modified = true; }
    if (asset.deleted == null) { asset.deleted = false; modified = true; }
    if (!asset.syncStatus) { asset.syncStatus = 'local'; modified = true; }
    if (modified) assetChanged++;
  });

  // 持久化迁移结果
  if (txChanged > 0)    _persist(LS.TX, _transactions);
  if (assetChanged > 0) _persist(LS.ASSETS, _assets);

  try { localStorage.setItem(MIGRATED_V21_KEY, '1'); } catch {}

  if (txChanged > 0 || assetChanged > 0) {
    console.log(`[store] v2.1 迁移完成：${txChanged} 条交易, ${assetChanged} 个资产`);
  }

  return { txCount: txChanged, assetCount: assetChanged };
}

// ═══════════════════════════════════════════════════════
//  v2.0 数据迁移（保留）
// ═══════════════════════════════════════════════════════

/**
 * V2 data migration: normalise all categories once at startup.
 */
export function migrateDataV2() {
  try {
    if (localStorage.getItem(LS.MIGRATED_V2)) return 0;
  } catch { return 0; }

  let changed = 0;
  _transactions.forEach(t => {
    const raw = t.category || '';
    const norm = normalizeCategory(raw);
    if (norm !== raw) {
      t.category = norm;
      changed++;
    }
  });

  if (changed) {
    _persist(LS.TX, _transactions);
    _emit('transactions');
  }

  try { localStorage.setItem(LS.MIGRATED_V2, '1'); } catch {}
  return changed;
}

// ── Computed helpers (used by pages) ─────────────────

export function filterByPeriod(period, txs) {
  txs = txs || getTransactions();
  const now = new Date();
  return txs.filter(t => {
    if (t.deleted) return false;
    const d = new Date(t.date);
    if (period === 'month')   return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'quarter') return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
    if (period === 'year')    return d.getFullYear() === now.getFullYear();
    return true;
  });
}

export function summarise(txs) {
  const income  = txs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
  const net     = income - expense;
  const saveRate = income > 0 ? net / income : null;
  return { income, expense, net, saveRate };
}

export function catTotals(txs, type) {
  const m = {};
  txs.filter(t => t.type === type).forEach(t => {
    m[t.category] = (m[t.category] || 0) + t.amount;
  });
  return m;
}

// ── Category normalisation ────────────────────────────

export function normalizeCategory(raw) {
  if (!raw) return '其他';

  let s = raw.trim().replace(/^[^\w\u4e00-\u9fa5a-zA-Z]+/, '').trim();
  if (!s) return '其他';

  s = s.replace(/\s*-?CN¥[\d.]+$/i, '').trim();
  if (!s) return '其他';

  const allCats = getAllCategories();
  const exact = allCats.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;

  const haystack = `${raw} ${s}`.toLowerCase();
  for (const { canon, kw } of CAT_KEYWORD_MAP) {
    if (kw.test(haystack)) return canon;
  }

  return '其他';
}

// ── Transaction fingerprint ───────────────────────────
export function txFingerprint(tx) {
  return `${(tx.date || '').slice(0, 10)}|${tx.type}|${tx.amount}|${tx.category}`;
}
const _fp = txFingerprint;

// ── Misc helpers ──────────────────────────────────────

export function getCategory(tx) { return tx.category || '其他'; }

// ── Internal persistence ──────────────────────────────
function _read(key) {
  try   { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function _persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Signal sync engine that local data changed
    if (typeof window.__rdstr_onStoreWrite === 'function') {
      window.__rdstr_onStoreWrite(key);
    }
  } catch (e) {
    console.warn('[store] localStorage write failed:', key, e);
  }
}

// ── Type definitions (JSDoc only — no runtime cost) ───
/**
 * @typedef {{
 *   id: string,
 *   date: string,
 *   type: '收入'|'支出',
 *   amount: number,
 *   category: string,
 *   note: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   deviceId: string,
 *   version: number,
 *   deleted: boolean,
 *   syncStatus: 'local'|'pending_upload'|'synced'|'conflict',
 *   gCategory: string,
 *   gSubCategory: string,
 *   tags: string[],
 *   confidence: number,
 *   source: string,
 *   aiUsed: boolean,
 *   userOverride: boolean,
 *   matchedRule: string
 * }} Transaction
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   category: string,
 *   value: number,
 *   note: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   deviceId: string,
 *   version: number,
 *   deleted: boolean,
 *   syncStatus: 'local'|'pending_upload'|'synced'|'conflict'
 * }} Asset
 *
 * @typedef {{ ts:string, total:number, breakdown:Record<string,number> }} Snapshot
 */
