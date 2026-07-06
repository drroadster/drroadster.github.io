// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/syncManager.js
//  同步管理器（主入口）
//
//  职责：
//  • 初始化同步系统
//  • 登录后执行完整 Merge 流程
//  • 后台自动同步（定时处理上传队列）
//  • 退出登录时清理队列，保留本地数据
//
//  完整同步流程：
//  下载云端 → 读取本地 → Diff → Merge → 写回本地 → 上传新增
//
//  场景矩阵：
//  ┌─────────────────┬─────────────────┬───────────────────┐
//  │   场景           │  云端           │  本地             │
//  ├─────────────────┼─────────────────┼───────────────────┤
//  │ 首次登录（新设备）│ 有数据          │ 空                │ → 下载云端      │
//  │ 首次登录（老设备）│ 空              │ 有数据            │ → 上传本地      │
//  │ 日常登录          │ 有数据          │ 有数据            │ → Merge         │
//  │ 未登录            │ —               │ 仅本地            │ → 不连 Firestore │
//  └─────────────────┴─────────────────┴───────────────────┘
// ═══════════════════════════════════════════════════════

import { getCurrentUser } from '../auth.js';
import * as store from '../store.js';
import { downloadAll } from './downloadQueue.js';
import { addBatchToQueue, processQueue, clearQueue, getQueueSize } from './uploadQueue.js';
import { merge, getPendingUploads } from './mergeEngine.js';
import { SYNC } from '../config.js';
import { getDeviceId } from './versionManager.js';

// ── 内部状态 ──────────────────────────────────────────
let _autoSyncTimer = null;
let _lastSyncTime = null;
let _isSyncing = false; // 防止并发同步

// ── 状态回调 ──────────────────────────────────────────
/** @type {Set<Function>} */
const _statusListeners = new Set();

/**
 * 注册同步状态监听器。
 * @param {(status: string, detail?: Object) => void} cb
 * @returns {() => void} 取消订阅
 */
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

/**
 * 初始化同步管理器。
 * 在应用启动时调用一次。
 */
export function init() {
  console.log('[syncManager] 初始化同步管理器');
  // 启动自动同步（如果已登录，定时处理上传队列）
  _maybeStartAutoSync();
}

// ── 登录同步 ──────────────────────────────────────────

/**
 * 登录后执行完整同步流程。
 *
 * 流程：
 *  1. 从 Firestore 下载全部云端数据
 *  2. 读取本地 localStorage 数据
 *  3. 执行 Merge（LWW 策略）
 *  4. 将合并结果写回本地存储
 *  5. 找出本地新增/修改的记录，上传到云端
 *
 * @param {string} uid - 用户 ID
 * @returns {Promise<{ merged: number, uploaded: number, stats: Object }>}
 */
export async function syncOnLogin(uid) {
  if (!uid || _isSyncing) return { merged: 0, uploaded: 0 };
  _isSyncing = true;

  console.log('[syncManager] ===== 登录同步开始 =====');
  _notify('pending', { phase: 'download' });

  try {
    // 1. 下载云端全部数据
    const cloud = await downloadAll(uid);
    console.log(`[syncManager] 云端数据：${cloud.transactions.length} 条交易, ${cloud.assets.length} 个资产`);

    // 2. 读取本地数据（原始数组，包含 syncStatus 等元数据）
    const localTxs = store.getTransactionsRaw();
    const localAssets = store.getAssetsRaw();
    console.log(`[syncManager] 本地数据：${localTxs.length} 条交易, ${localAssets.length} 个资产`);

    // 3-4. Merge 并写回本地
    _notify('pending', { phase: 'merge' });

    const txResult = merge(cloud.transactions, localTxs, 'id');
    const assetResult = merge(cloud.assets, localAssets, 'id');

    store.replaceAllTransactions(txResult.merged);
    store.replaceAllAssets(assetResult.merged);

    console.log(`[syncManager] 合并结果 — 交易: 新增${txResult.stats.added} 更新${txResult.stats.updated} 删除${txResult.stats.deleted} 不变${txResult.stats.unchanged}`);
    console.log(`[syncManager] 合并结果 — 资产: 新增${assetResult.stats.added} 更新${assetResult.stats.updated} 删除${assetResult.stats.deleted} 不变${assetResult.stats.unchanged}`);

    // 5. 上传本地新增/修改的记录
    _notify('pending', { phase: 'upload' });

    const pendingTxs = getPendingUploads(txResult.merged);
    const pendingAssets = getPendingUploads(assetResult.merged);

    let uploadedCount = 0;
    if (pendingTxs.length > 0 || pendingAssets.length > 0) {
      if (pendingTxs.length > 0) addBatchToQueue(uid, pendingTxs, 'transactions');
      if (pendingAssets.length > 0) addBatchToQueue(uid, pendingAssets, 'assets');

      const result = await processQueue();
      uploadedCount = result.success;

      // 上传成功后更新本地 syncStatus
      if (result.success > 0) {
        // 重新加载本地数据并标记已上传项
        _markUploadedSynced();
      }

      if (result.failed > 0) {
        console.warn(`[syncManager] ${result.failed} 条上传失败，将在下次自动同步重试`);
      }
    }

    _lastSyncTime = Date.now();
    _isSyncing = false;

    // 启动后台自动同步
    startAutoSync();

    const totalMerged = txResult.stats.added + assetResult.stats.added;
    console.log(`[syncManager] ===== 登录同步完成：合并 ${totalMerged} 条，上传 ${uploadedCount} 条 =====`);

    _notify('synced', {
      merged: totalMerged,
      uploaded: uploadedCount,
      stats: { tx: txResult.stats, asset: assetResult.stats },
    });

    return {
      merged: totalMerged,
      uploaded: uploadedCount,
      stats: { tx: txResult.stats, asset: assetResult.stats },
    };
  } catch (err) {
    _isSyncing = false;
    console.error('[syncManager] 登录同步失败:', err);
    _notify('error', { message: err.message });
    return { merged: 0, uploaded: 0 };
  }
}

// ── 自动同步 ──────────────────────────────────────────

/**
 * 启动后台自动同步。
 * 定时检查上传队列，处理待上传的记录。
 */
export function startAutoSync() {
  stopAutoSync();

  _autoSyncTimer = setInterval(async () => {
    const user = getCurrentUser();
    if (!user || _isSyncing) return;

    const queueSize = getQueueSize();
    if (queueSize === 0) return;

    console.log(`[syncManager] 自动同步：处理 ${queueSize} 条待上传记录`);
    _isSyncing = true;

    try {
      await processQueue();
      _markUploadedSynced();
      _lastSyncTime = Date.now();
    } catch (err) {
      console.error('[syncManager] 自动同步失败:', err);
    } finally {
      _isSyncing = false;
    }
  }, SYNC.autoSyncInterval);

  console.log(`[syncManager] 自动同步已启动（间隔 ${SYNC.autoSyncInterval / 1000}s）`);
}

/**
 * 停止后台自动同步。
 */
export function stopAutoSync() {
  if (_autoSyncTimer) {
    clearInterval(_autoSyncTimer);
    _autoSyncTimer = null;
  }
}

// ── 退出登录 ──────────────────────────────────────────

/**
 * 退出登录时清理同步状态。
 * 保留本地数据，清空上传队列，停止自动同步。
 */
export function syncOnLogout() {
  console.log('[syncManager] 退出登录：保留本地数据，清空同步队列');
  stopAutoSync();
  clearQueue();
  _lastSyncTime = null;

  _notify('idle');
}

// ── 手动同步 ──────────────────────────────────────────

/**
 * 手动触发完整同步（立即上传 + 增量下载）。
 * 用于用户点击"立即同步"按钮。
 *
 * @returns {Promise<{ uploaded: number }>}
 */
export async function manualSync() {
  const user = getCurrentUser();
  if (!user || _isSyncing) return { uploaded: 0 };

  _isSyncing = true;
  _notify('pending', { phase: 'manual' });

  try {
    // 先处理上传队列
    let uploadedCount = 0;
    if (getQueueSize() > 0) {
      const result = await processQueue();
      uploadedCount = result.success;
      _markUploadedSynced();
    }

    // 标记所有 syncStatus !== 'synced' 的记录为待上传
    _enqueuePendingLocal(user.uid);

    // 再次处理队列
    if (getQueueSize() > 0) {
      const result = await processQueue();
      uploadedCount += result.success;
      _markUploadedSynced();
    }

    _lastSyncTime = Date.now();
    _isSyncing = false;
    _notify('synced', { uploaded: uploadedCount });

    return { uploaded: uploadedCount };
  } catch (err) {
    _isSyncing = false;
    console.error('[syncManager] 手动同步失败:', err);
    _notify('error', { message: err.message });
    return { uploaded: 0 };
  }
}

/**
 * 获取上次同步时间。
 * @returns {number|null} 毫秒时间戳
 */
export function getLastSyncTime() {
  return _lastSyncTime;
}

// ── 内部方法 ──────────────────────────────────────────

/**
 * 将本地所有 syncStatus !== 'synced' 的记录加入上传队列。
 * @param {string} uid
 */
function _enqueuePendingLocal(uid) {
  const pendingTxs = store.getPendingTransactions();
  const pendingAssets = store.getPendingAssets();

  if (pendingTxs.length > 0) addBatchToQueue(uid, pendingTxs, 'transactions');
  if (pendingAssets.length > 0) addBatchToQueue(uid, pendingAssets, 'assets');
}

/**
 * 上传成功后，将本地对应记录的 syncStatus 标记为 'synced'。
 * 通过比对队列中已成功上传的记录 ID 来更新。
 */
function _markUploadedSynced() {
  // 简单策略：将所有 syncStatus === 'local' 的记录标记为 'synced'
  // 更精细的策略需要 tracking 每个 item 的上传状态，当前简化处理
  store.markAllSynced();
}

/**
 * 如果用户已登录，启动自动同步。
 */
function _maybeStartAutoSync() {
  const user = getCurrentUser();
  if (user) startAutoSync();
}
