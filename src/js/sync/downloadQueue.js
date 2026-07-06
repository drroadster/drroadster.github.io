// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/downloadQueue.js
//  下载队列 — 从 Firestore 批量拉取云端数据
//
//  职责：
//  • 下载用户全部交易和资产数据
//  • 支持增量下载（按 updatedAt 过滤）
//  • 处理软删除标记（deleted=true）
//  • 将 Firestore Timestamp 转为 ISO 字符串
// ═══════════════════════════════════════════════════════

import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { firebaseApp } from '../auth.js';

const _db = getFirestore(firebaseApp);

// ── 全量下载 ──────────────────────────────────────────

/**
 * 下载用户全部云端数据（交易 + 资产）。
 *
 * @param {string} uid - 用户 ID
 * @returns {Promise<{ transactions: Object[], assets: Object[] }>}
 */
export async function downloadAll(uid) {
  const [transactions, assets] = await Promise.all([
    _downloadCollection(uid, 'transactions'),
    _downloadCollection(uid, 'assets'),
  ]);
  return { transactions, assets };
}

// ── 增量下载 ──────────────────────────────────────────

/**
 * 增量下载：仅拉取 updatedAt 在指定时间之后的记录。
 * 注意：Firestore 需要复合索引才能高效执行时间范围查询，
 * 当前实现为全量下载后在客户端过滤。若数据量增长，建议
 * 在 Firebase Console 创建复合索引：
 *   Collection: transactions  Fields: updatedAt ASC, __name__ ASC
 *   Collection: assets        Fields: updatedAt ASC, __name__ ASC
 *
 * @param {string}         uid   - 用户 ID
 * @param {Date|string}    since - 起始时间（ISO 字符串或 Date 对象）
 * @returns {Promise<{ transactions: Object[], assets: Object[] }>}
 */
export async function downloadSince(uid, since) {
  const sinceDate = typeof since === 'string' ? new Date(since) : since;

  const [transactions, assets] = await Promise.all([
    _downloadCollection(uid, 'transactions'),
    _downloadCollection(uid, 'assets'),
  ]);

  return {
    transactions: transactions.filter(tx => _getUpdatedAt(tx) >= sinceDate),
    assets: assets.filter(ast => _getUpdatedAt(ast) >= sinceDate),
  };
}

// ── 内部方法 ──────────────────────────────────────────

/**
 * 下载 Firestore 某个子集合的全部文档。
 * Firestore 文档路径：users/{uid}/{collectionName}
 *
 * @param {string} uid            - 用户 ID
 * @param {string} collectionName - 子集合名（'transactions' | 'assets'）
 * @returns {Promise<Object[]>}
 */
async function _downloadCollection(uid, collectionName) {
  try {
    const colRef = collection(_db, 'users', uid, collectionName);
    const snapshot = await getDocs(colRef);
    const items = [];

    snapshot.forEach(docSnap => {
      const data = docSnap.data();

      // 将 Firestore Timestamp 对象转换为 ISO 字符串（本地可比较）
      if (data.updatedAt && typeof data.updatedAt.toDate === 'function') {
        data.updatedAt = data.updatedAt.toDate().toISOString();
      }
      if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        data.createdAt = data.createdAt.toDate().toISOString();
      }

      // 标记来源为云端已同步
      items.push({ ...data, id: docSnap.id, syncStatus: 'synced' });
    });

    return items;
  } catch (err) {
    // 集合不存在（首次使用）时静默返回空数组
    console.warn(`[downloadQueue] 下载 ${collectionName} 失败:`, err.message);
    return [];
  }
}

/**
 * 从记录中提取更新时间戳。
 * @param {Object} item
 * @returns {Date}
 */
function _getUpdatedAt(item) {
  const val = item.updatedAt || item.createdAt || 0;
  if (val instanceof Date) return val;
  return new Date(val);
}
