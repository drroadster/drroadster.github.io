// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · auth.js
//  Firebase Authentication — email/password.
//
//  Key design decisions:
//  • browserLocalPersistence: login survives page refresh, tab close,
//    and app re-open. The SDK silently re-hydrates the session from
//    IndexedDB without any extra code on our side.
//  • onAuthStateChanged is the single source of truth for login state.
//    Other modules subscribe via onAuthChange() rather than storing
//    currentUser themselves.
//  • Auth errors are mapped to i18n keys before being exposed, so UI
//    layers just call t(err.i18nKey) without parsing Firebase codes.
// ═══════════════════════════════════════════════════════

import { FIREBASE_CONFIG } from './config.js';
import { t } from './i18n.js';

// Firebase SDK — loaded via importmap in index.html
import { initializeApp, getApps }              from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';

// ── Singleton initialisation ──────────────────────────
// Guard against double-init when the module is hot-reloaded in dev.
const _app  = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

// Use the standard getAuth() + setPersistence() pattern (Firebase docs
// recommendation for web). browserLocalPersistence stores the session in
// IndexedDB so it survives page refresh, tab close, and browser restart.
// Must be called before any sign-in operation — setPersistence is
// fire-and-forget here because sign-in only happens on user click,
// which always occurs well after this module has loaded.
const _auth = getAuth(_app);
setPersistence(_auth, browserLocalPersistence);

// Export the app instance so db.js can reuse it.
export { _app as firebaseApp };

// ── Internal state ────────────────────────────────────
/** @type {import('firebase/auth').User | null} */
let _user = null;

/** Subscribers registered via onAuthChange(). */
const _subscribers = new Set();

// ── Auth state listener ───────────────────────────────
// onAuthStateChanged fires immediately with the persisted session on
// page load (or null if not logged in), so subscribers get the correct
// state without any extra init dance.
onAuthStateChanged(_auth, (user) => {
    _user = user;
    _subscribers.forEach(cb => {
      try { cb(user); } catch (e) { console.error('[auth] subscriber error', e); }
    });
});

// ── Public API ────────────────────────────────────────

/** Current user (null if logged out). */
export function getCurrentUser() { return _user; }

/**
 * Register a callback that fires whenever auth state changes.
 * Called immediately with the current state on registration.
 * Returns an unsubscribe function.
 * @param {(user: import('firebase/auth').User | null) => void} cb
 */
export function onAuthChange(cb) {
  _subscribers.add(cb);
  // Deliver current state immediately so late-subscribers don't miss it
  try { cb(_user); } catch (e) { /* ignore */ }
  return () => _subscribers.delete(cb);
}

/**
 * Sign up with email + password.
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName]
 * @returns {Promise<import('firebase/auth').UserCredential>}
 * @throws {{ i18nKey: string, raw: Error }}
 */
export async function registerWithEmail(email, password, displayName) {
  try {
    const cred = await createUserWithEmailAndPassword(_auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    return cred;
  } catch (e) {
    throw _wrapError(e);
  }
}

/**
 * Sign in with email + password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('firebase/auth').UserCredential>}
 * @throws {{ i18nKey: string, raw: Error }}
 */
export async function loginWithEmail(email, password) {
  try {
    return await signInWithEmailAndPassword(_auth, email, password);
  } catch (e) {
    throw _wrapError(e);
  }
}

/**
 * Sign out the current user.
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await signOut(_auth);
  } catch (e) {
    throw _wrapError(e);
  }
}

/**
 * Send a password-reset email.
 * @param {string} email
 * @returns {Promise<void>}
 * @throws {{ i18nKey: string, raw: Error }}
 */
export async function sendReset(email) {
  try {
    await sendPasswordResetEmail(_auth, email);
  } catch (e) {
    throw _wrapError(e);
  }
}

/**
 * Whether a user is currently authenticated.
 * @returns {boolean}
 */
export function isLoggedIn() { return _user !== null; }

// ── Error mapping ─────────────────────────────────────
const _ERR_MAP = {
  'auth/user-not-found':         'authErrNotFound',
  'auth/wrong-password':         'authErrWrongPwd',
  'auth/invalid-credential':     'authErrInvalidCred',
  'auth/email-already-in-use':   'authErrEmailUsed',
  'auth/weak-password':          'authErrWeakPwd',
  'auth/invalid-email':          'authErrInvalidEmail',
  'auth/too-many-requests':      'authErrTooMany',
  'auth/network-request-failed': 'authErrNetwork',
};

/**
 * Wraps a raw Firebase Auth error with an i18n key so the UI can call
 * t(err.i18nKey) directly, or fall back to err.message.
 * @param {Error & { code?: string }} raw
 */
function _wrapError(raw) {
  const i18nKey = _ERR_MAP[raw.code] ?? null;
  const message = i18nKey
    ? t(i18nKey)
    : t('authErrUnknown', { code: raw.code ?? raw.message });
  const wrapped = new Error(message);
  wrapped.i18nKey = i18nKey;
  wrapped.code    = raw.code;
  wrapped.raw     = raw;
  return wrapped;
}
