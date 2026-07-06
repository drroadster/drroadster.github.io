// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/uploadQueue.js
//  上传队列 — 将本地变更逐条上传到 Firestore
//
//  职责：
//  • 接收待上传记录并入队
//  • 逐条上传到 Firestore 独立 Document
//  • 上传成功后更新本地 syncStatus 为 "synced"
//  • 失败自动重试（最多 MAX_RETRIES 次）
// ═══════════════════════════════════════════════════════

import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseApp } from '../auth.js';
import { SYNC } from '../config.js';

const _db = getFirestore(firebaseApp);
const MAX_RETRIES = SYNC.maxRetries;

// ── 内部队列 ──────────────────────────────────────────
/** @type {{ uid: string, item: Object, collection: string, retries: number, addedAt: number }[]} */
let _queue = [];

// ── 入队操作 ──────────────────────────────────────────

/**
 * 将单条记录加入上传队列。
 * @param {string} uid        - 用户 ID
 * @param {Object} item       - 要上传的记录（包含 id 字段）
 * @param {string} collection - Firestore 子集合名（'transactions' | 'assets'）
 */
export function addToQueue(uid, item, collection) {
  // 避免重复入队
  if (_queue.some(t => t.item.id === item.id && t.collection === collection)) return;

  _queue.push({
    uid,
    item,
    collection,
    retries: 0,
    addedAt: Date.now(),
  });
}

/**
 * 批量加入上传队列。
 * @param {string}   uid
 * @param {Object[]} items
 * @param {string}   collection
 */
export function addBatchToQueue(uid, items, collection) {
  items.forEach(item => addToQueue(uid, item, collection));
}

// ── 队列处理 ──────────────────────────────────────────

/**
 * 处理上传队列：逐条上传到 Firestore。
 *
 * @param {Function} [onProgress] - 进度回调 (completed: number, total: number) => void
 * @returns {Promise<{ success: number, failed: number, failures: Object[] }>}
 */
export async function processQueue(onProgress) {
  const total = _queue.length;
  let success = 0, failed = 0;
  const failures = [];

  // 浅拷贝当前队列（处理过程中可能有新条目入队）
  const tasks = [..._queue];

  for (const task of tasks) {
    try {
      // 构建 Firestore 文档路径：users/{uid}/{collection}/{itemId}
      const ref = doc(_db, 'users', task.uid, task.collection, task.item.id);

      // 构建上传数据：去除本地状态标记，由云端管理时间戳
      const data = { ...task.item };
      delete data.syncStatus;
      // 使用服务器时间戳（自动转换为各时区可读格式）
      data.updatedAt = serverTimestamp();

      await setDoc(ref, data, { merge: true });
      success++;

      // 从队列中移除已完成任务
      _queue = _queue.filter(t => t !== task);
    } catch (err) {
      task.retries++;
      // 记录 Firestore 错误码以便诊断
      const errorDetail = err.code ? `${err.code}: ${err.message}` : err.message;
      if (task.retries >= MAX_RETRIES) {
        failed++;
        failures.push({ id: task.item.id, error: errorDetail });
        _queue = _queue.filter(t => t !== task);
        console.error(`[uploadQueue] 上传失败（已重试 ${MAX_RETRIES} 次）:`, task.item.id, errorDetail);
      } else {
        const delay = 2000 * task.retries;
        console.warn(`[uploadQueue] 上传重试 ${task.retries}/${MAX_RETRIES}:`, task.item.id, errorDetail);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (onProgress) onProgress(success + failed, total);
  }

  return { success, failed, failures };
}

// ── 队列管理 ──────────────────────────────────────────

/** 清空上传队列。退出登录时调用。 */
export function clearQueue() {
  _queue = [];
}

/** 获取当前队列中的待处理条目数。 */
export function getQueueSize() {
  return _queue.length;
}

/** 获取队列中所有待处理条目（用于调试）。 */
export function getQueueItems() {
  return _queue.map(t => ({ id: t.item.id, collection: t.collection, retries: t.retries }));
}
