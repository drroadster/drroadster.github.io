// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · db.js
//  Firestore cloud sync layer.
//
//  Responsibilities:
//  • Read cloud data on login → merge with local (dedup by fingerprint)
//  • Write (setDoc merge) whenever local data changes (debounced 2 s)
//  • Expose syncToCloud() for manual sync + status callbacks
//  • Gracefully degrade when offline — local storage still works
//
//  Data shape stored in Firestore:
//  {
//    transactions:  Transaction[],
//    assets:        Asset[],
//    assetHistory:  Snapshot[],
//    updatedAt:     Timestamp,   ← serverTimestamp()
//    clientVersion: string,
//  }
// ═══════════════════════════════════════════════════════

import { userDocPath, LS, APP_VERSION } from './config.js';
import { firebaseApp } from './auth.js';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  enableIndexedDbPersistence,
} from 'firebase/firestore';

// ── Singleton Firestore instance ──────────────────────
const _db = getFirestore(firebaseApp);

// Enable offline persistence (Firestore's built-in IndexedDB cache).
// This means read queries work even when the device is offline.
// Must be called before any other Firestore operations.
enableIndexedDbPersistence(_db).catch(err => {
  if (err.code === 'failed-precondition') {
    // Multiple tabs open — persistence only works in one at a time.
    console.warn('[db] IndexedDB persistence unavailable (multiple tabs)');
  } else if (err.code === 'unimplemented') {
    // Browser doesn't support it.
    console.warn('[db] IndexedDB persistence not supported in this browser');
  }
});

// ── Sync status callbacks ─────────────────────────────
/** @type {Set<(status: 'idle'|'pending'|'synced'|'error', msg?: string) => void>} */
const _statusCbs = new Set();

/** Register a sync-status listener. Returns unsubscribe fn. */
export function onSyncStatus(cb) {
  _statusCbs.add(cb);
  return () => _statusCbs.delete(cb);
}

function _emitStatus(status, msg) {
  _statusCbs.forEach(cb => {
    try { cb(status, msg); } catch (_) {}
  });
}

// ── Auto-sync debounce ────────────────────────────────
let _syncTimer = null;
let _currentUid = null;

/**
 * Call after every local data mutation.  Debounces actual Firestore
 * write by 2 s so rapid-fire edits only trigger one upload.
 * @param {string} uid  — must be provided; db.js doesn't import auth
 *                        directly to avoid circular deps.
 */
export function scheduleSyncToCloud(uid) {
  if (!uid) return;
  _currentUid = uid;
  clearTimeout(_syncTimer);
  _emitStatus('pending');
  _syncTimer = setTimeout(() => syncToCloud(uid, true), 2000);
}

// ── Core sync: upload ─────────────────────────────────
/**
 * Immediately upload current localStorage data to Firestore.
 * @param {string}  uid
 * @param {boolean} [silent=false]  suppress toast (used for auto-sync)
 * @returns {Promise<void>}
 */
export async function syncToCloud(uid, silent = false) {
  if (!uid) return;
  clearTimeout(_syncTimer);
  _emitStatus('pending');

  const payload = {
    transactions:  _readLocal(LS.TX),
    assets:        _readLocal(LS.ASSETS),
    assetHistory:  _readLocal(LS.ASSET_HISTORY),
    updatedAt:     serverTimestamp(),
    clientVersion: APP_VERSION,
  };

  try {
    await setDoc(doc(_db, userDocPath(uid)), payload, { merge: true });
    _emitStatus('synced');
    if (!silent) {
      // Let the UI layer surface the toast via window hook
      _callHook('onSyncSuccess');
    }
  } catch (err) {
    _emitStatus('error', err.message);
    if (!silent) _callHook('onSyncError', err.message);
    console.error('[db] syncToCloud failed:', err);
  }
}

// ── Core sync: download + merge ───────────────────────
/**
 * Load cloud data for uid, merge with localStorage, persist result.
 * Merge strategy:
 *   • Transactions → union by fingerprint (date|type|amount|category)
 *   • Assets       → cloud wins (most recent authoritative values)
 *   • AssetHistory → union by day (keep last entry per calendar day)
 * @param {string} uid
 * @returns {Promise<{merged: number}>} number of net-new transactions
 */
export async function loadCloudData(uid) {
  if (!uid) return { merged: 0 };

  _emitStatus('pending');
  try {
    const snap = await getDoc(doc(_db, userDocPath(uid)));
    if (!snap.exists()) {
      _emitStatus('idle');
      return { merged: 0 };
    }

    const cloud = snap.data();
    const cloudTxs   = Array.isArray(cloud.transactions)  ? cloud.transactions  : [];
    const cloudAssets = Array.isArray(cloud.assets)        ? cloud.assets        : [];
    const cloudHist   = Array.isArray(cloud.assetHistory)  ? cloud.assetHistory  : [];

    const localTxs   = _readLocal(LS.TX);
    const localAssets = _readLocal(LS.ASSETS);
    const localHist   = _readLocal(LS.ASSET_HISTORY);

    // ── Merge transactions (dedup by fingerprint) ──
    const fp  = tx => `${(tx.date||'').slice(0,10)}|${tx.type}|${tx.amount}|${tx.category}`;
    const seen = new Set(cloudTxs.map(fp));
    const added = [];
    localTxs.forEach(tx => {
      if (!seen.has(fp(tx))) { added.push(tx); seen.add(fp(tx)); }
    });
    const mergedTxs = [...cloudTxs, ...added]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // ── Merge assets (cloud wins; if cloud empty, keep local) ──
    const mergedAssets = cloudAssets.length ? cloudAssets : localAssets;

    // ── Merge history (union by day, keep last entry per day) ──
    const dayMap = {};
    [...localHist, ...cloudHist].forEach(h => {
      const day = (h.ts || '').slice(0, 10);
      if (day) dayMap[day] = h;  // later wins
    });
    const mergedHist = Object.values(dayMap)
      .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

    // ── Persist merged result ──
    _writeLocal(LS.TX,            mergedTxs);
    _writeLocal(LS.ASSETS,        mergedAssets);
    _writeLocal(LS.ASSET_HISTORY, mergedHist);

    // Signal the app to reload from localStorage
    _callHook('onCloudDataLoaded', { count: mergedTxs.length });

    _emitStatus('synced');
    return { merged: added.length };

  } catch (err) {
    _emitStatus('error', err.message);
    console.error('[db] loadCloudData failed:', err);
    return { merged: 0 };
  }
}

/**
 * Fetch the last-sync timestamp from the cloud document (for display).
 * @param {string} uid
 * @returns {Promise<Date|null>}
 */
export async function getLastSyncDate(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(_db, userDocPath(uid)));
    if (!snap.exists()) return null;
    const ts = snap.data()?.updatedAt;
    return ts?.toDate?.() ?? null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────

function _readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function _writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[db] localStorage write failed:', e); }
}

/**
 * Call a window-level hook set by the UI layer.
 * This avoids circular imports: db.js → auth.js is fine, but
 * db.js → pages/overview.js would create a cycle.
 */
function _callHook(name, payload) {
  if (typeof window[`__rdstr_${name}`] === 'function') {
    try { window[`__rdstr_${name}`](payload); }
    catch (e) { console.error(`[db] hook ${name} threw:`, e); }
  }
}
