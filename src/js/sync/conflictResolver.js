// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/conflictResolver.js
//  冲突检测与解决
//
//  当前策略：Last Write Wins (LWW)
//  预留接口：交互式冲突解决（未来可让用户在 UI 中选择版本）
//
//  冲突定义：
//  同一个 ID 的记录在云端和本地都有修改，
//  且 updatedAt 不同（说明至少一方在另一方不知情的情况下修改了）
// ═══════════════════════════════════════════════════════

/**
 * 检测两条记录是否存在冲突。
 * 冲突条件：ID 相同，且双方的 updatedAt 时间戳不同。
 *
 * @param {Object} cloudDoc - 云端记录
 * @param {Object} localDoc - 本地记录
 * @returns {boolean}
 */
export function detect(cloudDoc, localDoc) {
  if (!cloudDoc || !localDoc) return false;

  const cloudTime = _parseTime(cloudDoc.updatedAt || cloudDoc.createdAt);
  const localTime = _parseTime(localDoc.updatedAt || localDoc.createdAt);

  // 时间戳不同说明存在潜在冲突
  return cloudTime !== localTime;
}

/**
 * 解决冲突：默认采用 Last Write Wins（最后写入获胜）。
 * 比较 updatedAt（回退到 createdAt），取较新的版本。
 *
 * @param {Object} cloudDoc - 云端记录
 * @param {Object} localDoc - 本地记录
 * @returns {Object} 胜出的记录（附带 _conflictResolved: true 标记）
 */
export function resolve(cloudDoc, localDoc) {
  const cloudTime = _parseTime(cloudDoc.updatedAt || cloudDoc.createdAt);
  const localTime = _parseTime(localDoc.updatedAt || localDoc.createdAt);

  if (cloudTime >= localTime) {
    return { ...cloudDoc, _conflictResolved: true };
  }
  return { ...localDoc, _conflictResolved: true };
}

// ── 交互式冲突解决接口（预留） ────────────────────────

/** @type {Function|null} */
let _interactiveResolver = null;

/**
 * 注册交互式冲突解决回调。
 * 回调签名：(cloudDoc, localDoc) => Promise<resolvedDoc>
 *
 * @param {Function} resolver
 */
export function setInteractiveResolver(resolver) {
  _interactiveResolver = resolver;
}

/**
 * 尝试通过交互方式解决冲突（如果注册了解析器）。
 * 未注册时回退到 LWW。
 *
 * @param {Object} cloudDoc
 * @param {Object} localDoc
 * @returns {Promise<Object>}
 */
export async function resolveInteractive(cloudDoc, localDoc) {
  if (_interactiveResolver) {
    return await _interactiveResolver(cloudDoc, localDoc);
  }
  return resolve(cloudDoc, localDoc);
}

// ── 内部工具 ──────────────────────────────────────────

/**
 * 将多种时间格式统一转为毫秒时间戳。
 * @param {string|Object|undefined|null} t
 * @returns {number}
 */
function _parseTime(t) {
  if (!t) return 0;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  return new Date(t).getTime();
}
