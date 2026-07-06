// ═══════════════════════════════════════════════════════
//  ROADSTER v2.1 · sync/versionManager.js
//  版本管理与唯一 ID 生成
//
//  职责：
//  • 生成全局唯一 ID（设备标识 + 时间戳 + 随机串）
//  • 版本号递增管理
//  • 设备标识持久化（localStorage）
// ═══════════════════════════════════════════════════════

// ── 设备标识 ──────────────────────────────────────────
const DEVICE_ID_KEY = 'rdstr_device_id';

/**
 * 获取或生成设备标识。
 * 持久化在 localStorage，每个浏览器/设备唯一。
 * @returns {string}
 */
export function getDeviceId() {
  try {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch {
    return 'dev-unknown';
  }
}

// ── 唯一 ID 生成 ─────────────────────────────────────
const _devicePrefix = () => getDeviceId().split('-')[1] || 'xx';

/**
 * 生成交易唯一 ID。
 * 格式：tx-{设备短标识}-{时间戳36进制}-{随机6位}
 * @returns {string}
 */
export function generateTxId() {
  return `tx-${_devicePrefix()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 生成资产唯一 ID。
 * 格式：ast-{设备短标识}-{时间戳36进制}-{随机6位}
 * @returns {string}
 */
export function generateAssetId() {
  return `ast-${_devicePrefix()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 版本号 ────────────────────────────────────────────

/**
 * 版本号递增（用于乐观锁/冲突检测）。
 * @param {number} [currentVersion=0]
 * @returns {number}
 */
export function nextVersion(currentVersion) {
  return (currentVersion || 0) + 1;
}
