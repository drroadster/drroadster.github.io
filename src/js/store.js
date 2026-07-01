// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · store.js
//  Centralised reactive data store.
//
//  All reads and writes go through this module.
//  UI layers never touch localStorage directly.
//
//  Architecture (preview of v2.1 Store/Engine split):
//  ┌────────────┐   mutate   ┌────────────┐  persist  ┌────────────┐
//  │   Pages    │ ─────────▶ │   Store    │ ────────▶ │localStorage│
//  └────────────┘            └────────────┘           └────────────┘
//                                  │ emit
//                            ┌─────▼──────┐
//                            │ Subscribers│ (charts, auth sync, etc.)
//                            └────────────┘
// ═══════════════════════════════════════════════════════

import { LS, ALL_CATS, CAT_KEYWORD_MAP } from './config.js';

// ── State ─────────────────────────────────────────────
/** @type {Transaction[]} */
let _transactions = [];
/** @type {Asset[]} */
let _assets       = [];
/** @type {Snapshot[]} */
let _history      = [];

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

// ── Initialise ────────────────────────────────────────
/** Load all data from localStorage. Call once at startup. */
export function initStore() {
  _transactions = _read(LS.TX);
  _assets       = _read(LS.ASSETS);
  _history      = _read(LS.ASSET_HISTORY);
}

/**
 * Replace the entire store from an external source (e.g. cloud merge).
 * Used by db.js after loadCloudData() writes to localStorage.
 */
export function reloadFromStorage() {
  _transactions = _read(LS.TX);
  _assets       = _read(LS.ASSETS);
  _history      = _read(LS.ASSET_HISTORY);
  _emit('transactions');
  _emit('assets');
  _emit('history');
}

// ── Transactions ──────────────────────────────────────

/** @returns {Transaction[]} sorted newest-first */
export function getTransactions() {
  return [..._transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Add one or more transactions (deduplicated by fingerprint).
 * @param {Transaction|Transaction[]} items
 * @returns {{ added: number, duplicates: number }}
 */
export function addTransactions(items) {
  const arr     = Array.isArray(items) ? items : [items];
  const existing = new Set(_transactions.map(_fp));
  let added = 0, duplicates = 0;

  for (const tx of arr) {
    const key = _fp(tx);
    if (existing.has(key)) { duplicates++; continue; }
    // Normalise category before storing
    const normalised = { ...tx, category: normalizeCategory(tx.category || tx.note || '') };
    _transactions.push(normalised);
    existing.add(key);
    added++;
  }

  if (added) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return { added, duplicates };
}

/**
 * Update an existing transaction by id.
 * @param {string}  id
 * @param {Partial<Transaction>} patch
 * @returns {boolean}
 */
export function updateTransaction(id, patch) {
  const idx = _transactions.findIndex(t => t.id === id);
  if (idx === -1) return false;
  _transactions[idx] = { ..._transactions[idx], ...patch };
  _persist(LS.TX, _transactions);
  _emit('transactions');
  return true;
}

/**
 * Delete a transaction by id.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTransaction(id) {
  const before = _transactions.length;
  _transactions = _transactions.filter(t => t.id !== id);
  if (_transactions.length === before) return false;
  _persist(LS.TX, _transactions);
  _emit('transactions');
  return true;
}

/**
 * Delete all transactions in a category.
 * @param {string} category
 * @returns {number} count deleted
 */
export function deleteByCategory(category) {
  const before = _transactions.length;
  _transactions = _transactions.filter(t => t.category !== category);
  const n = before - _transactions.length;
  if (n) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return n;
}

/**
 * Re-normalise all transaction categories using the keyword map.
 * @returns {number} count changed
 */
export function renormalizeAllCategories() {
  let changed = 0;
  _transactions.forEach(t => {
    const norm = normalizeCategory(t.category);
    if (norm !== t.category) { t.category = norm; changed++; }
  });
  if (changed) { _persist(LS.TX, _transactions); _emit('transactions'); }
  return changed;
}

/** Clear all transactions. */
export function clearTransactions() {
  _transactions = [];
  _persist(LS.TX, _transactions);
  _emit('transactions');
}

// ── Assets ────────────────────────────────────────────

/** @returns {Asset[]} */
export function getAssets() { return [..._assets]; }

/**
 * Add or update an asset.  If an asset with the same id exists it is
 * updated; otherwise a new one is pushed.
 * @param {Asset} asset
 */
export function upsertAsset(asset) {
  const idx = _assets.findIndex(a => a.id === asset.id);
  if (idx === -1) {
    _assets.push(asset);
  } else {
    _assets[idx] = { ..._assets[idx], ...asset };
  }
  _persist(LS.ASSETS, _assets);
  _emit('assets');
}

/**
 * Delete an asset by id.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteAsset(id) {
  const before = _assets.length;
  _assets = _assets.filter(a => a.id !== id);
  if (_assets.length === before) return false;
  _persist(LS.ASSETS, _assets);
  _emit('assets');
  return true;
}

// ── Asset History (snapshots) ─────────────────────────

/** @returns {Snapshot[]} chronological */
export function getAssetHistory() { return [..._history]; }

/**
 * Record a new snapshot of total + per-asset breakdown.
 * Deduplicates by calendar day (last write wins).
 */
export function recordSnapshot() {
  const total     = _assets.reduce((s, a) => s + (a.value || 0), 0);
  const breakdown = Object.fromEntries(_assets.map(a => [a.id, a.value || 0]));

  // Check if last snapshot is identical (no-op guard)
  if (_history.length) {
    const last = _history[_history.length - 1];
    if (last.total === total &&
        JSON.stringify(last.breakdown) === JSON.stringify(breakdown)) return;
  }

  const ts  = new Date().toISOString();
  const day = ts.slice(0, 10);

  // Replace any existing same-day entry
  const idx = _history.findIndex(h => h.ts.slice(0, 10) === day);
  const snap = { ts, total, breakdown };
  if (idx === -1) _history.push(snap);
  else            _history[idx] = snap;

  // Keep sorted
  _history.sort((a, b) => a.ts.localeCompare(b.ts));
  _persist(LS.ASSET_HISTORY, _history);
  _emit('history');
}

/**
 * Import snapshots from CSV (asset rows).
 * @param {Snapshot[]} snaps
 * @returns {number} added count
 */
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

// ── Computed helpers (used by pages) ─────────────────

/**
 * Filter transactions by period.
 * @param {'month'|'quarter'|'year'|'all'} period
 * @param {Transaction[]} [txs]  defaults to getTransactions()
 */
export function filterByPeriod(period, txs) {
  txs = txs || getTransactions();
  const now = new Date();
  return txs.filter(t => {
    const d = new Date(t.date);
    if (period === 'month')   return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'quarter') return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
    if (period === 'year')    return d.getFullYear() === now.getFullYear();
    return true;
  });
}

/**
 * Sum income and expense for a list of transactions.
 * @param {Transaction[]} txs
 * @returns {{ income: number, expense: number, net: number, saveRate: number|null }}
 */
export function summarise(txs) {
  const income  = txs.filter(t => t.type === '收入').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === '支出').reduce((s, t) => s + t.amount, 0);
  const net     = income - expense;
  const saveRate = income > 0 ? net / income : null;
  return { income, expense, net, saveRate };
}

/**
 * Group transactions by category and sum amounts.
 * @param {Transaction[]} txs
 * @param {'收入'|'支出'} type
 * @returns {Record<string, number>}
 */
export function catTotals(txs, type) {
  const m = {};
  txs.filter(t => t.type === type).forEach(t => {
    m[t.category] = (m[t.category] || 0) + t.amount;
  });
  return m;
}

// ── Category normalisation ────────────────────────────

/**
 * Map any raw category string → canonical value.
 * Strips leading emoji, does keyword fuzzy match.
 * @param {string} raw
 * @returns {string}  canonical category or '其他'
 */
export function normalizeCategory(raw) {
  if (!raw) return '其他';

  // Strip leading non-letter/non-CJK characters (emoji, symbols, hyphens…)
  let s = raw.trim().replace(/^[^\w\u4e00-\u9fa5a-zA-Z]+/, '').trim();
  if (!s) return '其他';

  // Exact canonical match (case-insensitive)
  const exact = ALL_CATS.find(c => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;

  // Keyword fuzzy match over full raw string + stripped string
  const haystack = `${raw} ${s}`.toLowerCase();
  for (const { canon, kw } of CAT_KEYWORD_MAP) {
    if (kw.test(haystack)) return canon;
  }

  return '其他';
}

// ── Transaction fingerprint ───────────────────────────
/**
 * Deduplification key: same day + type + amount + category = duplicate.
 * Time-of-day is deliberately ignored (the same purchase recorded twice).
 */
export function txFingerprint(tx) {
  return `${(tx.date || '').slice(0, 10)}|${tx.type}|${tx.amount}|${tx.category}`;
}
const _fp = txFingerprint; // alias

// ── Misc helpers ──────────────────────────────────────

/** Canonical category from a transaction (alias for clarity). */
export function getCategory(tx) { return tx.category || '其他'; }

// ── Internal persistence ──────────────────────────────
function _read(key) {
  try   { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function _persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Signal db.js to schedule a cloud sync
    if (typeof window.__rdstr_onStoreWrite === 'function') {
      window.__rdstr_onStoreWrite(key);
    }
  } catch (e) {
    console.warn('[store] localStorage write failed:', key, e);
  }
}

// ── Type definitions (JSDoc only — no runtime cost) ───
/**
 * @typedef {{ id:string, date:string, type:'收入'|'支出', amount:number, category:string, note:string }} Transaction
 * @typedef {{ id:string, name:string, category:string, value:number, note:string, createdAt:string, updatedAt?:string }} Asset
 * @typedef {{ ts:string, total:number, breakdown:Record<string,number> }} Snapshot
 */
