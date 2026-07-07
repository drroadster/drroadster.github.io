// ═══════════════════════════════════════════════════════
//  ROADSTER v2.2 · sync/syncManager.js
//  同步管理器（手动上传模式）
//
//  职责：
//  • 登录后下载云端数据并排显示
//  • 检测重复（同时同备注）并提示用户
//  • 用户手动上传本地数据
//  • 退出登录时清除云端来源数据
//
//  数据模型：
//  • origin='local'  + syncStatus='local'  → 本地新建，未上传
//  • origin='local'  + syncStatus='synced' → 已上传到云端
//  • origin='cloud'  + syncStatus='synced' → 从云端下载
//
//  场景：
//  ┌────────────┬──────────────────────┬──────────────────┐
//  │   场景      │  显示                │  操作             │
//  ├────────────┼──────────────────────┼──────────────────┤
//  │ 未登录      │ 仅本地 (origin=local) │ 本地增删改       │
//  │ 登录        │ 本地 + 云端           │ 可手动上传        │
//  │ 退出        │ 清除云端，保留本地    │ —                │
//  └────────────┴──────────────────────┴──────────────────┘
// ═══════════════════════════════════════════════════════

import { getCurrentUser, firebaseApp } from '../auth.js';
import * as store from '../store.js';
import { downloadAll } from './downloadQueue.js';
import { addBatchToQueue, processQueue, clearQueue, getQueueSize } from './uploadQueue.js';
import { SYNC, userDocPath } from '../config.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const _db = getFirestore(firebaseApp);
const LS_LAST_SYNC = 'roadster:lastSync';

// ── 内部状态 ──────────────────────────────────────────
let _isSyncing = false;
let _lastSyncTime = null;

/** @type {Set<Function>} */
const _statusListeners = new Set();

export function onSyncStatus(cb) {
  _statusListeners.add(cb);
  return () => _statusListeners.delete(cb);
}

function _notify(status, detail) {
  _statusListeners.forEach(cb => {
    try { cb(status, detail); } catch (_) {}
  });
}

// ── 初始化 ────────────────────────────────────────────

export function init() {
  console.log('[syncManager] v2.2 手动上传模式');
  const saved = localStorage.getItem(LS_LAST_SYNC);
  if (saved) _lastSyncTime = parseInt(saved, 10);
}

// ── 登录同步 ──────────────────────────────────────────

/**
 * 登录后下载云端数据并排显示。不自动合并，不自动上传。
 *
 * @param {string} uid
 * @returns {Promise<{ cloudCount: number, duplicates: Object[] }>}
 */
export async function syncOnLogin(uid) {
  if (!uid || _isSyncing) return { cloudCount: 0, duplicates: [] };
  _isSyncing = true;

  console.log('[syncManager] ===== 登录：下载云端数据 =====');
  _notify('pending', { phase: 'download' });

  try {
    const cloud = await downloadAll(uid);
    const cloudTxs = cloud.transactions || [];
    console.log(`[syncManager] 云端共 ${cloudTxs.length} 条交易`);

    // 检测重复
    const duplicates = store.findDuplicates(cloudTxs);
    const duplicateIds = new Set(duplicates.map(d => d.cloud.id));

    // 非重复记录添加为云端来源
    const nonDupes = cloudTxs.filter(tx => !duplicateIds.has(tx.id));
    const added = store.addCloudTransactions(nonDupes);

    _lastSyncTime = Date.now();
    _persistLastSync(uid);
    _isSyncing = false;

    console.log(`[syncManager] 登录完成：新增 ${added} 条，重复 ${duplicates.length} 条`);
    _notify('synced', { added, duplicates: duplicates.length });

    return { cloudCount: added, duplicates };
  } catch (err) {
    _isSyncing = false;
    console.error('[syncManager] 登录失败:', err);
    _notify('error', { message: err.message });
    return { cloudCount: 0, duplicates: [] };
  }
}

// ── 手动上传 ──────────────────────────────────────────

/**
 * 用户手动触发上传：将本地未同步数据推送到云端。
 *
 * @param {string} uid
 * @returns {Promise<{ uploaded: number, failed: number }>}
 */
export async function uploadToCloud(uid) {
  if (!uid || _isSyncing) return { uploaded: 0, failed: 0 };
  _isSyncing = true;

  console.log('[syncManager] ===== 手动上传 =====');
  _notify('pending', { phase: 'upload' });

  try {
    const pendingTxs = store.getPendingTransactions();
    const pendingAssets = store.getPendingAssets();

    const total = pendingTxs.length + pendingAssets.length;
    if (total === 0) {
      _isSyncing = false;
      _notify('synced', { uploaded: 0 });
      return { uploaded: 0, failed: 0 };
    }

    console.log(`[syncManager] 待上传：${pendingTxs.length} 条交易, ${pendingAssets.length} 个资产`);

    // 标记为上传中
    store.markAllPendingUpload();

    // 加入队列并处理
    if (pendingTxs.length > 0) addBatchToQueue(uid, pendingTxs, 'transactions');
    if (pendingAssets.length > 0) addBatchToQueue(uid, pendingAssets, 'assets');

    const result = await processQueue();

    // 标记已同步
    if (result.success > 0) {
      store.markBatchAsSynced(pendingTxs.map(t => t.id));
    }

    _lastSyncTime = Date.now();
    _persistLastSync(uid);
    _isSyncing = false;

    console.log(`[syncManager] 上传完成：成功 ${result.success} 条，失败 ${result.failed} 条`);
    _notify('synced', { uploaded: result.success, failed: result.failed });

    return { uploaded: result.success, failed: result.failed };
  } catch (err) {
    _isSyncing = false;
    console.error('[syncManager] 上传失败:', err);
    _notify('error', { message: err.message });
    return { uploaded: 0, failed: 0 };
  }
}

// ── 退出登录 ──────────────────────────────────────────

export function syncOnLogout() {
  console.log('[syncManager] 退出：清除云端数据，保留本地');
  clearQueue();
  _lastSyncTime = null;

  const removed = store.removeCloudData();

  // force reload into memory
  store.reloadFromStorage();

  localStorage.removeItem(LS_LAST_SYNC);
  _notify('idle');

  console.log(`[syncManager] 已移除云端 ${removed} 条记录`);
}

// ── 手动同步（保留） ──────────────────────────────────

export async function manualSync() {
  const user = getCurrentUser();
  if (!user || _isSyncing) return { uploaded: 0, downloaded: 0 };

  const { cloudCount } = await syncOnLogin(user.uid);
  const { uploaded } = await uploadToCloud(user.uid);

  return { uploaded, downloaded: cloudCount };
}

// ── 公开查询 ──────────────────────────────────────────

export function getLastSyncTime() { return _lastSyncTime; }
export function isSyncing() { return _isSyncing; }
export { getQueueSize };

// ── 内部 ──────────────────────────────────────────────

async function _persistLastSync(uid) {
  localStorage.setItem(LS_LAST_SYNC, String(_lastSyncTime));
  try {
    await setDoc(doc(_db, userDocPath(uid)), { updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[syncManager] 写入时间戳失败:', err.message);
  }
}
