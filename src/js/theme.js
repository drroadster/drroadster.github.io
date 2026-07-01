// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · theme.js
//  Light / dark mode toggle.
//  - Reads saved preference from localStorage on init
//  - Falls back to system prefers-color-scheme
//  - Applies a brief CSS transition class so the swap feels smooth
//  - Syncs all [data-theme-opt] buttons in the DOM
// ═══════════════════════════════════════════════════════

import { LS } from './config.js';

/** @type {'light'|'dark'} */
let _current = 'light';

/**
 * Initialise theme.  Call once at app startup before first render.
 * Reads localStorage → falls back to system preference.
 */
export function initTheme() {
  const saved = localStorage.getItem(LS.THEME);
  if (saved === 'light' || saved === 'dark') {
    _current = saved;
  } else {
    _current = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  _apply(_current, false); // no animation on first load
}

/**
 * Set theme explicitly.
 * @param {'light'|'dark'} mode
 */
export function setTheme(mode) {
  if (mode !== 'light' && mode !== 'dark') return;
  _current = mode;
  localStorage.setItem(LS.THEME, mode);
  _apply(mode, true);
}

/** Toggle between light and dark. */
export function toggleTheme() {
  setTheme(_current === 'dark' ? 'light' : 'dark');
}

/** Current theme value. */
export function getTheme() { return _current; }

// ── Internal ──────────────────────────────────────────

function _apply(mode, animate) {
  const root = document.documentElement;

  if (animate) {
    // Add transition class, swap theme, remove after transition ends
    root.classList.add('theme-transitioning');
    requestAnimationFrame(() => {
      root.setAttribute('data-theme', mode);
      setTimeout(() => root.classList.remove('theme-transitioning'), 350);
    });
  } else {
    root.setAttribute('data-theme', mode);
  }

  // Sync all toggle buttons that carry data-theme-opt attribute
  document.querySelectorAll('[data-theme-opt]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOpt === mode);
  });

  // Re-render charts if the active page has them (charts read CSS vars at
  // creation time, so a theme change requires a fresh render)
  if (typeof window.__rdstr_refreshChartsForTheme === 'function') {
    window.__rdstr_refreshChartsForTheme();
  }
}
