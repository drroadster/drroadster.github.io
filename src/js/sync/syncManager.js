// ═══════════════════════════════════════════════════════
//  ROADSTER v2.3 · sync/syncManager.js
//  实时同步管理器（onSnapshot）
//
//  职责：
//  • 提供 sync adapter（write/delete）给 store.js
//  • 管理 onSnapshot 监听生命周期
//  • 草稿上传 + 重复检测
//  • 退出时清理监听
//
//  数据模型（简化）：
//  • Firestore 中的记录 = 已同步的完整数据
//  • rdstr_drafts 中的记录 = 未上传的本地草稿
//  • 登录后 store 内存由 onSnapshot 驱动
// ═══════════════════════════════════════════════════════

import { getCurrentUser, firebaseApp } from '../auth.js';
import * as store from '../store.js';
import { mergeAssetsFromCloud } from '../store.js';
import { COLLECTIONS } from '../config.js';
import {
  getFirestore,
  collection, doc, setDoc, deleteDoc,
  onSnapshot, getDocs, query,
} from 'firebase/firestore';

const _db = getFirestore(firebaseApp);

// ── 内部状态 ──────────────────────────────────────────
/** @type {Function|null} */
let _unsubscribeTx = null;

/** @type {Function|null} */
let _unsubscribeAssets = null;

/** 重复检测 SHA1 摘要 */
async function _sha1(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Adapter 工厂 ──────────────────────────────────────

/**
 * 为 store.js 创建 sync adapter，提供 Firestore 读写方法。
 * @param {string} uid
 * @returns {Object}
 */
function _createAdapter(uid) {
  return {
    writeTx: async (id, data) => {
      const { id: _id, ...rest } = data;
      await setDoc(doc(_db, COLLECTIONS.transactions(uid), id), rest);
    },
    deleteTx: async (id) => {
      await deleteDoc(doc(_db, COLLECTIONS.transactions(uid), id));
    },
    writeAsset: async (id, data) => {
      const { id: _id, ...rest } = data;
      await setDoc(doc(_db, COLLECTIONS.assets(uid), id), rest);
    },
    deleteAsset: async (id) => {
      await deleteDoc(doc(_db, COLLECTIONS.assets(uid), id));
    },
  };
}

// ── onSnapshot 生命周期 ───────────────────────────────

/**
 * 启动 onSnapshot 监听，推送数据时通过 callback 传给 caller。
 * @param {string} uid
 * @param {Function} onData - (records: Transaction[]) => void
 */
export function initSyncListeners(uid, onData) {
  if (!uid) return;

  console.log('[syncManager] 启动 onSnapshot 监听');

  // 监听交易集合
  const txRef = collection(_db, COLLECTIONS.transactions(uid));
  _unsubscribeTx = onSnapshot(txRef, (snapshot) => {
    const records = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    onData(records);
  }, (err) => {
    console.error('[syncManager] onSnapshot 错误:', err);
  });

  // 监听资产集合
  const assetRef = collection(_db, COLLECTIONS.assets(uid));
  _unsubscribeAssets = onSnapshot(assetRef, (snapshot) => {
    const records = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    mergeAssetsFromCloud(records);
  }, (err) => {
    console.error('[syncManager] assets onSnapshot 错误:', err);
  });
}

/**
 * 停止 onSnapshot 监听。
 */
export function stopSyncListeners() {
  if (_unsubscribeTx) {
    _unsubscribeTx();
    _unsubscribeTx = null;
  }
  if (_unsubscribeAssets) {
    _unsubscribeAssets();
    _unsubscribeAssets = null;
  }
  console.log('[syncManager] onSnapshot 监听已停止');
}

// ── 登录入口 ──────────────────────────────────────────

/**
 * 登录时调用：设置 adapter + 启动 onSnapshot + 初始化 store。
 * @param {string} uid
 * @param {Function} onData - 数据更新回调
 */
export function onLoginSync(uid, onData) {
  const adapter = _createAdapter(uid);
  store.setSyncAdapter(adapter);
  initSyncListeners(uid, onData);
}

/**
 * 退出登录时调用：停止监听 + 清除 adapter + 切换本地模式。
 */
export function onLogoutSync() {
  stopSyncListeners();
  store.clearSyncAdapter();
  store.switchToLocalMode();
}

// ── 草稿上传 ──────────────────────────────────────────

/**
 * 检测草稿与云端的重复情况，不写入。
 * @param {string} uid
 * @param {Transaction[]} drafts
 * @returns {Promise<{draft:Transaction, cloud:Transaction}[]>}
 */
export async function checkDuplicates(uid, drafts) {
  if (!uid || drafts.length === 0) return [];

  const txRef = collection(_db, COLLECTIONS.transactions(uid));
  const snap = await getDocs(query(txRef));
  const cloudMap = new Map();

  for (const d of snap.docs) {
    const data = d.data();
    if (data.deleted) continue;
    const fp = `${(data.date || '').slice(0, 10)}|${data.note || ''}|${data.amount}`;
    cloudMap.set(fp, { id: d.id, ...data });
  }

  const dups = [];
  for (const draft of drafts) {
    const fp = `${(draft.date || '').slice(0, 10)}|${draft.note || ''}|${draft.amount}`;
    const existing = cloudMap.get(fp);
    if (existing) dups.push({ draft, cloud: existing });
  }

  return dups;
}

/**
 * 上传草稿到 Firestore。
 * 检测重复（note + date + amount 三元组），返回重复列表。
 * @param {string} uid
 * @param {Transaction[]} drafts
 * @returns {Promise<{ uploaded: string[], duplicates: {draft:Transaction, cloud:Transaction}[] }>}
 */
export async function uploadDrafts(uid, drafts) {
  if (!uid || drafts.length === 0) return { uploaded: [], duplicates: [] };

  console.log(`[syncManager] 上传 ${drafts.length} 条草稿`);

  // 获取现有云端记录用于去重
  const txRef = collection(_db, COLLECTIONS.transactions(uid));
  const snap = await getDocs(query(txRef));
  const cloudMap = new Map();

  for (const d of snap.docs) {
    const data = d.data();
    if (data.deleted) continue;
    const fp = `${(data.date || '').slice(0, 10)}|${data.note || ''}|${data.amount}`;
    cloudMap.set(fp, { id: d.id, ...data });
  }

  const uploaded = [];
  const duplicates = [];

  for (const draft of drafts) {
    const fp = `${(draft.date || '').slice(0, 10)}|${draft.note || ''}|${draft.amount}`;
    const existing = cloudMap.get(fp);

    if (existing) {
      duplicates.push({ draft, cloud: existing });
    } else {
      const { id, ...rest } = draft;
      await setDoc(doc(_db, COLLECTIONS.transactions(uid), id), rest);
      uploaded.push(id);
    }
  }

  console.log(`[syncManager] 草稿上传完成：${uploaded.length} 条成功, ${duplicates.length} 条重复`);
  return { uploaded, duplicates };
}

// ── 资产草稿上传 ──────────────────────────────────────

/**
 * 检测资产草稿与云端的重复情况（按 name + category 去重）。
 * @param {string} uid
 * @param {Asset[]} drafts
 * @returns {Promise<{draft:Asset, cloud:Asset}[]>}
 */
export async function checkAssetDuplicates(uid, drafts) {
  if (!uid || drafts.length === 0) return [];

  const assetRef = collection(_db, COLLECTIONS.assets(uid));
  const snap = await getDocs(query(assetRef));
  const cloudMap = new Map();

  for (const d of snap.docs) {
    const data = d.data();
    if (data.deleted) continue;
    const fp = `${data.name || ''}|${data.category || ''}`;
    cloudMap.set(fp, { id: d.id, ...data });
  }

  const dups = [];
  for (const draft of drafts) {
    const fp = `${draft.name || ''}|${draft.category || ''}`;
    const existing = cloudMap.get(fp);
    if (existing) dups.push({ draft, cloud: existing });
  }

  return dups;
}

/**
 * 上传资产草稿到 Firestore。
 * @param {string} uid
 * @param {Asset[]} drafts
 * @returns {Promise<{ uploaded: string[], duplicates: {draft:Asset, cloud:Asset}[] }>}
 */
export async function uploadAssetDrafts(uid, drafts) {
  if (!uid || drafts.length === 0) return { uploaded: [], duplicates: [] };

  console.log(`[syncManager] 上传 ${drafts.length} 个资产草稿`);

  const assetRef = collection(_db, COLLECTIONS.assets(uid));
  const snap = await getDocs(query(assetRef));
  const cloudMap = new Map();

  for (const d of snap.docs) {
    const data = d.data();
    if (data.deleted) continue;
    const fp = `${data.name || ''}|${data.category || ''}`;
    cloudMap.set(fp, { id: d.id, ...data });
  }

  const uploaded = [];
  const duplicates = [];

  for (const draft of drafts) {
    const fp = `${draft.name || ''}|${draft.category || ''}`;
    const existing = cloudMap.get(fp);

    if (existing) {
      duplicates.push({ draft, cloud: existing });
    } else {
      const { id, ...rest } = draft;
      await setDoc(doc(_db, COLLECTIONS.assets(uid), id), rest);
      uploaded.push(id);
    }
  }

  console.log(`[syncManager] 资产草稿上传完成：${uploaded.length} 个成功, ${duplicates.length} 个重复`);
  return { uploaded, duplicates };
}
