// ═══════════════════════════════════════════════════════
//  ROADSTER v2.3 · store.js
//  Centralised reactive data store — Realtime Sync 版
//
//  所有读写必须经过此模块。UI 层禁止直接操作 localStorage / Firestore。
//
//  v2.3 变更：
//  • 移除 origin / syncStatus 字段，数据模型简化为：在Firestore即为云端，在rdstr_drafts即为本地草稿
//  • 引入 _syncAdapter 模式：登录时通过adapter走Firestore，未登录时走localStorage草稿
//  • 登录状态下所有数据来自 onSnapshot 推送，localStorage 仅存草稿
//  • 写入采用乐观更新（先写内存+emit，后台异步写Firestore）
//
//  架构：
//  Pages/UI → mutate → store.js → if logged in: _syncAdapter → Firestore
//                                → if logged out: rdstr_drafts → localStorage
//
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

/** 本地草稿（未上传的记录） */
let _drafts = [];
/** 资产本地草稿（未上传的资产） */
let _assetDrafts = [];

/** 是否已登录 */
let _isLoggedIn = false;

/** 登录后等待云端数据首次到达 */
let _loading = false;

/** Firestore 写入失败重试配置 */
const RETRY_MAX = 3;
const RETRY_BASE_DELAY = 2000;

/**
 * Fire-and-forget: 带指数退避重试的 Firestore 写入。
 * 成功即结束，失败后保存到对应草稿并持久化到 localStorage。
 * @param {Function} writeFn - 写入函数，返回 Promise
 * @param {Object} record   - 待写入的记录
 * @param {string} label    - 日志标签
 * @param {'tx'|'asset'} type - 记录类型
 */
function _retryAndPersist(writeFn, record, label, type) {
  (async () => {
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        await writeFn();
        return; // 成功
      } catch (err) {
        if (attempt < RETRY_MAX) {
          const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
          console.warn(`[store] ${label} 失败 (${attempt}/${RETRY_MAX})，${delay}ms 后重试:`, err.message || err);
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error(`[store] ${label} 重试 ${RETRY_MAX} 次后仍失败，保存到草稿:`, err.message || err);
        }
      }
    }

    // 全部重试失败 → 保存到草稿
    if (type === 'tx') {
      _drafts.push(record);
      _persist(LS.DRAFTS, _drafts);
    } else {
      _assetDrafts.push(record);
      _persist(LS.ASSETS_DRAFTS, _assetDrafts);
    }
  })();
}

/**
 * Sync adapter — 由 syncManager 注入。
 * 登录时提供 Firestore 读写方法；退出时清空。
 * @type {{ writeTx(id:string, data:Object):Promise<void>, deleteTx(id:string):Promise<void>,
 *           writeAsset(id:string, data:Object):Promise<void>, deleteAsset(id:string):Promise<void> }|null}
 */
let _syncAdapter = null;

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

// ── Sync adapter ──────────────────────────────────────

/**
 * 设置同步适配器（登录时由 syncManager 调用）。
 * @param {Object} adapter
 */
export function setSyncAdapter(adapter) {
  _syncAdapter = adapter;
  _isLoggedIn = true;
  _loading = true; // 等待 onSnapshot 推送首批数据
  console.log('[store] sync adapter set, logged in mode');
}

/**
 * 清除同步适配器（退出登录时调用）。
 */
export function clearSyncAdapter() {
  _syncAdapter = null;
  _isLoggedIn = false;
  console.log('[store] sync adapter cleared, logged out mode');
}

// ── Initialise ────────────────────────────────────────

/** Load drafts from localStorage. Call once at startup. */
export function initStore() {
  _drafts   = _read(LS.DRAFTS);
  _history  = _read(LS.ASSET_HISTORY);

  // 如果存在旧格式数据（rdstr_tx / rdstr_assets），迁移到 drafts
  _migrateOldDataToDrafts();

  // 未登录时用草稿填充内存
  _transactions = [..._drafts];
  _assetDrafts   = _read(LS.ASSETS_DRAFTS);
  _assets       = [..._assetDrafts];

  // V2 类别标准化
  migrateDataV2();

  // 清理异常资产数据（ID 不匹配标准格式的资产）
  _cleanAbnormalAssets();

  // 消费快捷指令添加队列（add.html 写入）
  _consumeShortcutQueue();
}

/**
 * 清理结构性异常的资产（内存 + 草稿 + 历史）。
 *
 * 清理条件（仅两种明确的结构性问题）：
 *   - 无 ID 或 ID 非字符串
 *   - name 为空/null
 *
 * 不再以 ID 格式作为清理依据。Firestore 文档 ID 格式多变（旧版含小数点、新版 ast- 前缀等），
 * ID 格式与内部数据有效性无关。category 字段也由页面 _normalizeCategory 兜底，不在存储层清理。
 */
function _cleanAbnormalAssets() {
  // 注意：资产 ID 可以是任意 Firestore 合法文档 ID，格式不固定。
  // 仅清理明确的结构性异常：无 ID / 非字符串 / 空名称。
  // 不以 ID 格式（如含小数点、ast- 前缀）作为清理依据——
  // 这些是旧版 ID 或 Firestore 生成的合法 ID，内部数据完全有效。
  const badAssets = _assets.filter(a => {
    if (!a.id || typeof a.id !== 'string') return true;
    if (!a.name || String(a.name).trim() === '') return true;
    return false;
  });

  if (badAssets.length === 0) return;

  const badIds = new Set(badAssets.map(a => a.id));
  const reasons = badAssets.map(a => {
    const parts = [];
    if (!a.name || String(a.name).trim() === '') parts.push('空名称');
    return `${a.id} [${parts.join(',')}]`;
  });
  console.warn('[store] 检测到异常资产:', reasons.join('; '));

  // 从内存移除
  _assets = _assets.filter(a => !badIds.has(a.id));

  // 同步清理草稿
  const draftBefore = _assetDrafts.length;
  _assetDrafts = _assetDrafts.filter(a => !badIds.has(a.id));
  if (_assetDrafts.length < draftBefore) {
    _persist(LS.ASSETS_DRAFTS, _assetDrafts);
  }

  // 清理历史快照中异常资产的 breakdown 条目
  let historyChanged = false;
  _history = _history.map(h => {
    const cleanBreakdown = { ...h.breakdown };
    let removed = false;
    for (const id of badIds) {
      if (id in cleanBreakdown) { delete cleanBreakdown[id]; removed = true; }
    }
    if (removed) {
      historyChanged = true;
      const newTotal = Object.values(cleanBreakdown).reduce((s, v) => s + v, 0);
      return { ...h, breakdown: cleanBreakdown, total: newTotal };
    }
    return h;
  });
  if (historyChanged) {
    _persist(LS.ASSET_HISTORY, _history);
  }

  console.log(`[store] 已清理 ${badAssets.length} 条异常资产（内存+草稿+历史）`);
  _emit('assets');
  _emit('history');
}

/**
 * 消费 add.html 写入的快捷指令记账队列。
 * 将待处理记录转为正式交易，支持去重和类别标准化。
 * @returns {{ added: number, skipped: number }}
 */
function _consumeShortcutQueue() {
  try {
    const raw = localStorage.getItem('rdstr_shortcut_queue');
    if (!raw) return { added: 0, skipped: 0 };

    const queue = JSON.parse(raw);
    localStorage.removeItem('rdstr_shortcut_queue');

    if (!Array.isArray(queue) || queue.length === 0) return { added: 0, skipped: 0 };

    const existing = new Set(_transactions.map(txFingerprint));
    let added = 0, skipped = 0;

    for (const item of queue) {
      const fp = txFingerprint(item);
      if (existing.has(fp)) { skipped++; continue; }

      existing.add(fp);
      addTx(item);
      added++;
    }

    return { added, skipped };
  } catch (e) {
    console.warn('[store] 快捷指令队列消费失败:', e);
    return { added: 0, skipped: 0 };
  }
}

/**
 * 从旧格式 rdstr_tx / rdstr_assets 迁移到 rdstr_drafts。
 * 仅执行一次（guard: MIGRATED_V23）。
 */
function _migrateOldDataToDrafts() {
  try {
    if (localStorage.getItem(LS.MIGRATED_V23)) return;
  } catch { return; }

  const oldTx = _read('rdstr_tx');
  const oldAssets = _read('rdstr_assets');

  // 旧数据全部作为草稿（去掉 origin/syncStatus）
  const clean = (arr) => arr.map(item => {
    const { origin, syncStatus, ...rest } = item;
    return rest;
  });

  const cleanedTx = clean(oldTx).filter(t => !t.deleted);
  const cleanedAssets = clean(oldAssets).filter(a => !a.deleted);

  if (cleanedTx.length > 0 || cleanedAssets.length > 0) {
    _drafts = cleanedTx;
    _persist(LS.DRAFTS, _drafts);
    // 资产迁移到 rdstr_asset_drafts（修复：之前遗漏了资产持久化）
    _assetDrafts = cleanedAssets;
    _persist(LS.ASSETS_DRAFTS, _assetDrafts);
    console.log(`[store] 已迁移旧数据到 drafts：${cleanedTx.length} 条交易, ${cleanedAssets.length} 个资产`);
  }

  // 清理旧 key（仅在资产已成功持久化后才删除）
  try { localStorage.removeItem('rdstr_tx'); } catch {}
  try { localStorage.removeItem('rdstr_assets'); } catch {}
  try { localStorage.setItem(LS.MIGRATED_V23, '1'); } catch {}
}

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
    _persist(LS.DRAFTS, _transactions);
    _emit('transactions');
  }

  try { localStorage.setItem(LS.MIGRATED_V2, '1'); } catch {}
  return changed;
}

// ── Cloud merge ───────────────────────────────────────

/**
 * 合并云端数据到内存（由 syncManager onSnapshot 推送时调用）。
 * 保留内存中未被云端覆盖的待写入记录（乐观更新保护）。
 * @param {Transaction[]} cloudRecords
 */
export function mergeFromCloud(cloudRecords) {
  const inMemory = new Map(_transactions.map(r => [r.id, r]));

  for (const cr of cloudRecords) {
    if (cr.deleted) {
      inMemory.delete(cr.id);
    } else {
      inMemory.set(cr.id, cr);
    }
  }

  _transactions = [...inMemory.values()];
  _loading = false; // 云端数据已到达
  _emit('transactions');
}

/**
 * 合并云端资产数据到内存（由 syncManager onSnapshot 推送时调用）。
 * 合并后自动清理不匹配标准 ID 格式的异常资产（内存 + Firestore + 草稿 + 历史）。
 * @param {Asset[]} cloudRecords
 */
export function mergeAssetsFromCloud(cloudRecords) {
  const inMemory = new Map(_assets.map(r => [r.id, r]));

  for (const cr of cloudRecords) {
    if (cr.deleted) {
      inMemory.delete(cr.id);
    } else {
      inMemory.set(cr.id, cr);
    }
  }

  _assets = [...inMemory.values()];

  // 仅清理结构性异常：无 ID / 非字符串 ID / 空名称。
  // 不以 ID 格式（小数点和 ast- 前缀等）作为清理依据。
  const badAssets = _assets.filter(a => {
    if (!a.id || typeof a.id !== 'string') return true;
    if (!a.name || String(a.name).trim() === '') return true;
    return false;
  });
  if (badAssets.length > 0) {
    const badIds = new Set(badAssets.map(a => a.id));
    console.warn('[store] 云端同步中发现异常资产:', badAssets.map(a => `${a.id}`).join(', '));
    _assets = _assets.filter(a => !badIds.has(a.id));
  }

  _loading = false;
  _emit('assets');
}

/**
 * 切换到本地模式（退出登录时调用）。
 * 清空云端数据，恢复草稿。
 */
export function switchToLocalMode() {
  _drafts = _read(LS.DRAFTS);
  _transactions = [..._drafts];
  _assetDrafts = _read(LS.ASSETS_DRAFTS);
  _assets = [..._assetDrafts];
  _history = _read(LS.ASSET_HISTORY);
  _emit('transactions');
  _emit('assets');
  _emit('history');
}

// ── Drafts management ─────────────────────────────────

/** 获取所有草稿 */
export function getDrafts() {
  return [..._drafts];
}

/** 清空草稿（上传完成后调用） */
export function clearDrafts() {
  _drafts = [];
  _persist(LS.DRAFTS, []);
}

/** 获取所有资产草稿 */
export function getAssetDrafts() {
  return [..._assetDrafts];
}

/** 清空资产草稿（上传完成后调用） */
export function clearAssetDrafts() {
  _assetDrafts = [];
  _persist(LS.ASSETS_DRAFTS, []);
}

// ═══════════════════════════════════════════════════════
//  v2.3 ID 级 CRUD（无 origin/syncStatus）
// ═══════════════════════════════════════════════════════

/**
 * 为新记录生成同步元数据（不含 origin/syncStatus）。
 * @param {'tx'|'asset'} type
 * @returns {Object}
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
  };
}

// ── Transactions ──────────────────────────────────────

/** @param {string} id @returns {Transaction|undefined} */
export function getTx(id) {
  return _transactions.find(t => t.id === id);
}

/**
 * 新增一条交易。登录时乐观写入 + 后台 Firestore；未登录时写入草稿。
 * @param {Partial<Transaction>} tx
 * @returns {Transaction}
 */
export function addTx(tx) {
  const meta = _newSyncMeta('tx');
  const record = { ...tx, ...meta };

  if (_syncAdapter && _isLoggedIn) {
    // 乐观更新：先写入内存
    _transactions.push(record);
    _emit('transactions');

    // 后台写入 Firestore（fire-and-forget 带重试）
    _retryAndPersist(
      () => _syncAdapter.writeTx(record.id, record),
      record,
      'writeTx',
      'tx'
    );
  } else {
    // 未登录：存入草稿
    _drafts.push(record);
    _persist(LS.DRAFTS, _drafts);
    _transactions.push(record);
    _emit('transactions');
  }

  return record;
}

/**
 * 更新一条交易。
 * @param {string} id
 * @param {Partial<Transaction>} changes
 * @returns {boolean}
 */
export function updateTx(id, changes) {
  const idx = _transactions.findIndex(t => t.id === id);
  if (idx === -1) return false;

  _transactions[idx] = {
    ..._transactions[idx],
    ...changes,
    updatedAt: new Date().toISOString(),
    version:   nextVersion(_transactions[idx].version),
  };

  if (_syncAdapter && _isLoggedIn) {
    _emit('transactions');
    _retryAndPersist(
      () => _syncAdapter.writeTx(id, _transactions[idx]),
      _transactions[idx],
      'writeTx(update)',
      'tx'
    );
  } else {
    // 同步更新草稿
    const draftIdx = _drafts.findIndex(d => d.id === id);
    if (draftIdx !== -1) {
      _drafts[draftIdx] = _transactions[idx];
      _persist(LS.DRAFTS, _drafts);
    }
    _emit('transactions');
  }

  return true;
}

/**
 * 删除一条交易（软删除）。
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTx(id) {
  const idx = _transactions.findIndex(t => t.id === id);
  if (idx === -1) return false;

  _transactions[idx].deleted = true;
  _transactions[idx].updatedAt = new Date().toISOString();

  if (_syncAdapter && _isLoggedIn) {
    _emit('transactions');
    _retryAndPersist(
      () => _syncAdapter.deleteTx(id),
      _transactions[idx],
      'deleteTx',
      'tx'
    );
  } else {
    // 从草稿中移除
    _drafts = _drafts.filter(d => d.id !== id);
    _persist(LS.DRAFTS, _drafts);
    _transactions = _transactions.filter(t => t.id !== id);
    _emit('transactions');
  }

  return true;
}

/**
 * 删除指定分类下所有交易。
 * @param {string} category
 * @returns {number}
 */
export function deleteByCategory(category) {
  let n = 0;
  const toDelete = [];
  _transactions.forEach(t => {
    if (t.category === category && !t.deleted) {
      t.deleted = true;
      t.updatedAt = new Date().toISOString();
      toDelete.push(t.id);
      n++;
    }
  });

  if (n === 0) return 0;

  if (_syncAdapter && _isLoggedIn) {
    _emit('transactions');
    toDelete.forEach(id => {
      _retryAndPersist(
        () => _syncAdapter.deleteTx(id),
        { id, deleted: true },
        'deleteTx(batch)',
        'tx'
      );
    });
  } else {
    _drafts = _drafts.filter(d => !toDelete.includes(d.id));
    _persist(LS.DRAFTS, _drafts);
    _transactions = _transactions.filter(t => !t.deleted);
    _emit('transactions');
  }

  return n;
}

/**
 * 清空所有交易。
 */
export function clearTransactions() {
  if (_syncAdapter && _isLoggedIn) {
    const ids = _transactions.map(t => t.id);
    _transactions = [];
    _emit('transactions');
    ids.forEach(id => {
      _retryAndPersist(
        () => _syncAdapter.deleteTx(id),
        { id, deleted: true },
        'deleteTx(clear)',
        'tx'
      );
    });
  } else {
    _drafts = [];
    _persist(LS.DRAFTS, []);
    _transactions = [];
    _emit('transactions');
  }
}

// ── Assets ────────────────────────────────────────────

/** @returns {Asset[]} */
export function getAssets() {
  return [..._assets].filter(a => a.deleted !== true);
}

/** @param {string} id @returns {Asset|undefined} */
export function getAsset(id) {
  return _assets.find(a => a.id === id);
}

/** @param {Partial<Asset>} asset @returns {Asset} */
export function addAsset(asset) {
  const meta = _newSyncMeta('asset');
  const record = { ...asset, ...meta };

  if (_syncAdapter && _isLoggedIn) {
    _assets.push(record);
    _emit('assets');
    _retryAndPersist(
      () => _syncAdapter.writeAsset(record.id, record),
      record,
      'writeAsset',
      'asset'
    );
  } else {
    _assetDrafts.push(record);
    _persist(LS.ASSETS_DRAFTS, _assetDrafts);
    _assets.push(record);
    _emit('assets');
  }

  return record;
}

/** @param {string} id @param {Partial<Asset>} changes @returns {boolean} */
export function updateAsset(id, changes) {
  const idx = _assets.findIndex(a => a.id === id);
  if (idx === -1) return false;

  _assets[idx] = {
    ..._assets[idx],
    ...changes,
    updatedAt: new Date().toISOString(),
    version:   nextVersion(_assets[idx].version),
  };

  if (_syncAdapter && _isLoggedIn) {
    _emit('assets');
    _retryAndPersist(
      () => _syncAdapter.writeAsset(id, _assets[idx]),
      _assets[idx],
      'writeAsset(update)',
      'asset'
    );
  } else {
    const dIdx = _assetDrafts.findIndex(d => d.id === id);
    if (dIdx !== -1) _assetDrafts[dIdx] = _assets[idx];
    else _assetDrafts.push(_assets[idx]);
    _persist(LS.ASSETS_DRAFTS, _assetDrafts);
    _emit('assets');
  }

  return true;
}

/** @param {string} id @returns {boolean} */
export function deleteAsset(id) {
  const idx = _assets.findIndex(a => a.id === id);
  if (idx === -1) return false;

  _assets[idx].deleted = true;
  _assets[idx].updatedAt = new Date().toISOString();

  if (_syncAdapter && _isLoggedIn) {
    _emit('assets');
    _retryAndPersist(
      () => _syncAdapter.deleteAsset(id),
      _assets[idx],
      'deleteAsset',
      'asset'
    );
  } else {
    _assetDrafts = _assetDrafts.filter(a => a.id !== id);
    _persist(LS.ASSETS_DRAFTS, _assetDrafts);
    _assets = _assets.filter(a => a.id !== id);
    _emit('assets');
  }

  return true;
}

/**
 * Add or update an asset (compat API).
 * @param {Asset} asset
 */
export function upsertAsset(asset) {
  const idx = _assets.findIndex(a => a.id === asset.id);
  if (idx === -1) {
    addAsset(asset);
  } else {
    updateAsset(asset.id, asset);
  }
}

// ── Asset History ─────────────────────────────────────

/** @returns {Snapshot[]} */
export function getAssetHistory() { return [..._history]; }

export function recordSnapshot() {
  const total = _assets.filter(a => !a.deleted).reduce((s, a) => s + (a.value || 0), 0);
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
//  v2.0 兼容层（保持所有 Pages 不变）
// ═══════════════════════════════════════════════════════

/** @returns {Transaction[]} sorted newest-first */
export function getTransactions() {
  return [..._transactions]
    .filter(t => t.deleted !== true)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** @returns {boolean} */
export function isLoading() { return _loading; }
/** @param {boolean} v */
export function setLoading(v) { _loading = v; }

/** @returns {number} 当前同步源类型：0=未登录本地, 1=云端 */
export function getSyncSource() { return _isLoggedIn ? 1 : 0; }

/** @returns {boolean} 是否已登录 */
export function isLoggedIn() { return _isLoggedIn; }

/**
 * Add one or more transactions (deduplicated by fingerprint).
 * v2.3: 自动路由到 addTx（走 Firestore 或草稿）。
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

    const normalised = { ...inputTx, category: normalizeCategory(inputTx.category || inputTx.note || '') };
    addTx(normalised);  // 内部已处理 emit + persist
    existing.add(key);
    added++;
  }

  return { added, duplicates };
}

/**
 * Update transaction by id (compat).
 * @param {string} id
 * @param {Partial<Transaction>} patch
 * @returns {boolean}
 */
export function updateTransaction(id, patch) {
  return updateTx(id, patch);
}

/**
 * Delete transaction by id (compat).
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTransaction(id) {
  return deleteTx(id);
}

/**
 * Re-normalise all transaction categories.
 * @returns {number}
 */
export function renormalizeAllCategories() {
  let changed = 0;
  _transactions.forEach(t => {
    if (t.deleted) return;
    const norm = normalizeCategory(t.category);
    if (norm !== t.category) { t.category = norm; changed++; }
  });
  if (changed) {
    // 批量更新到 Firestore 或草稿
    if (_syncAdapter && _isLoggedIn) {
      _transactions.forEach(t => {
        _retryAndPersist(
          () => _syncAdapter.writeTx(t.id, t),
          t,
          'writeTx(renorm)',
          'tx'
        );
      });
    } else {
      _persist(LS.DRAFTS, _drafts);
    }
    _emit('transactions');
  }
  return changed;
}

// ── Computed helpers (used by pages) ──────────────────

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

export function getCategory(tx) { return tx.category || '其他'; }

// ── Internal persistence ──────────────────────────────

function _read(key) {
  try   { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function _persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[store] localStorage write failed:', key, e);
  }
}

// ── Type definitions ──────────────────────────────────
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
 *   deleted: boolean
 * }} Asset
 *
 * @typedef {{ ts:string, total:number, breakdown:Record<string,number> }} Snapshot
 */
