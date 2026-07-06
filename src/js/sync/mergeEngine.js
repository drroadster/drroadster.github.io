// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/mergeEngine.js
//  本地与云端数据合并引擎
//
//  策略：Last Write Wins (LWW)
//  • 本地有、云端无 → 保留本地（标记为待上传）
//  • 云端有、本地无 → 下载到本地
//  • 双方都有、相同 ID → 比较 updatedAt，最新者获胜
//  • deleted=true 的记录 → 删除本地对应记录
// ═══════════════════════════════════════════════════════

/**
 * 合并云端和本地数据，返回合并后的完整列表。
 *
 * @param {Object[]} cloudItems - 云端数据数组
 * @param {Object[]} localItems - 本地数据数组
 * @param {string}   [idField='id'] - 用作唯一标识的字段名
 * @returns {{ merged: Object[], stats: { added: number, updated: number, deleted: number, unchanged: number } }}
 */
export function merge(cloudItems, localItems, idField = 'id') {
  const stats = { added: 0, updated: 0, deleted: 0, unchanged: 0 };

  // 以 ID 为 key 建立本地索引
  const localMap = new Map();
  localItems.forEach(item => {
    if (item[idField] != null) localMap.set(item[idField], item);
  });

  const resultMap = new Map();

  // ── 处理云端数据 ──
  for (const cloudItem of cloudItems) {
    const id = cloudItem[idField];
    if (id == null) continue;

    const localItem = localMap.get(id);

    // 云端标记为软删除 → 不保留
    if (cloudItem.deleted === true) {
      if (localItem) stats.deleted++;
      localMap.delete(id);
      continue;
    }

    if (!localItem) {
      // 云端有、本地无 → 下载到本地
      resultMap.set(id, { ...cloudItem, syncStatus: 'synced' });
      stats.added++;
    } else {
      // 双方都有 → 比较 updatedAt
      const cloudTime = _parseTime(cloudItem.updatedAt || cloudItem.createdAt);
      const localTime = _parseTime(localItem.updatedAt || localItem.createdAt);

      if (cloudTime > localTime) {
        // 云端更新 → 以云端为准
        resultMap.set(id, { ...cloudItem, syncStatus: 'synced' });
        stats.updated++;
      } else {
        // 本地更新或相同 → 保留本地版本
        resultMap.set(id, localItem);
        stats.unchanged++;
      }
    }

    localMap.delete(id);
  }

  // ── 处理仅在本地存在的数据 ──
  for (const [id, localItem] of localMap) {
    // 本地已软删除 → 跳过
    if (localItem.deleted === true) continue;
    resultMap.set(id, localItem);
    stats.unchanged++;
  }

  return {
    merged: Array.from(resultMap.values()),
    stats,
  };
}

/**
 * 从数据列表中筛选出需要上传的记录。
 * 条件：syncStatus !== 'synced' 且未被软删除。
 *
 * @param {Object[]} items
 * @param {string}   [idField='id']
 * @returns {Object[]}
 */
export function getPendingUploads(items, idField = 'id') {
  return items.filter(item =>
    item.syncStatus !== 'synced' && item.deleted !== true
  );
}

/**
 * 对比两组 ID 列表，找出新增、删除和共有项。
 *
 * @param {string[]} cloudIds
 * @param {string[]} localIds
 * @returns {{ toDownload: string[], toUpload: string[], common: string[] }}
 */
export function diffIds(cloudIds, localIds) {
  const cloudSet = new Set(cloudIds);
  const localSet = new Set(localIds);

  return {
    toDownload: [...cloudSet].filter(id => !localSet.has(id)),
    toUpload: [...localSet].filter(id => !cloudSet.has(id)),
    common: [...cloudSet].filter(id => localSet.has(id)),
  };
}

// ── 内部工具 ──────────────────────────────────────────

/**
 * 将时间字符串或 Firestore Timestamp 转为毫秒时间戳。
 * @param {string|Object|undefined|null} t
 * @returns {number}
 */
function _parseTime(t) {
  if (!t) return 0;
  // Firestore Timestamp 对象（有 toDate 方法）
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  // ISO 字符串
  return new Date(t).getTime();
}
