// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · utils.js
//  Shared pure-function utilities: formatting, date parsing,
//  CSV line splitting. No DOM access, no state — safe to
//  import from any module without side effects.
// ═══════════════════════════════════════════════════════

// ── Number formatting ─────────────────────────────────

/** Format a number as ¥-style currency string with 万/亿 abbreviation. */
export function fmt(n) {
  n = Number(n) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(2).replace(/\.?0+$/, '') + '万';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Compact format for axis labels (no decimals). */
export function fmtK(n) {
  n = Number(n) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(0) + '亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(0) + '万';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

/** Zero-pad a number to 2 digits. */
export function pad2(n) { return String(n).padStart(2, '0'); }

// ── Date formatting ────────────────────────────────────

/**
 * Display a stored date string. Supports both legacy "YYYY-MM-DD"
 * and the newer "YYYY-MM-DDTHH:mm:ss" — shows time when present.
 */
export function formatTxDateTime(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('T')) {
    const [datePart, timePart] = dateStr.split('T');
    const hms = (timePart || '').slice(0, 8);
    return hms ? `${datePart} ${hms}` : datePart;
  }
  return dateStr;
}

/** Short date for chart axis labels, e.g. "6/21 17:30". */
export function fmtDateShort(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Current moment as "YYYY-MM-DDTHH:mm:ss" for <input type=datetime-local>. */
export function nowAsDatetimeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
         `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Normalise a wide variety of date string formats to "YYYY-MM-DD".
 * Supports:
 *   • ISO:               2026-06-10
 *   • Chinese full:       2026年6月10日
 *   • Chinese month+EN:  "7月 10, 2021"  (Numbers zh-locale export)
 *   • Slash D/M/Y or M/D/Y with 2-or-4-digit year
 *   • Fallback to native Date parsing
 * @param {string} s
 * @returns {string|null}
 */
export function normalizeDate(s) {
  if (!s) return null;
  s = String(s).trim().replace(/^"|"$/g, ''); // strip stray quotes
  if (!s) return null;

  // "7月 10, 2021" / "10月 10, 2021" — Chinese month, EN day/year
  const CN_MONTHS = {
    '1月':1,'2月':2,'3月':3,'4月':4,'5月':5,'6月':6,
    '7月':7,'8月':8,'9月':9,'10月':10,'11月':11,'12月':12,
  };
  const cnM = s.match(/^(\d{1,2}月)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (cnM) {
    const month = CN_MONTHS[cnM[1]];
    if (month) return `${cnM[3]}-${pad2(month)}-${pad2(cnM[2])}`;
  }

  // Standard Chinese: 2026年6月10日
  let cn = s.replace(/年/, '-').replace(/月/, '-').replace(/日/, '').trim();
  let m = cn.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // ISO / YYYY-MM-DD
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  // D/M/YY or D/M/YYYY (disambiguate by >12 rule, default D/M/Y)
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    if (y.length === 2) y = (parseInt(y, 10) < 70 ? '20' : '19') + y;
    let day, month;
    if (a > 12)      { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else             { day = a; month = b; }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // Fallback: native Date parsing (handles "Jun 10, 2026" etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return null;
}

// ── CSV parsing ────────────────────────────────────────

/**
 * Split a single CSV line respecting quoted fields (commas inside
 * quotes are NOT treated as delimiters; "" inside quotes = escaped quote).
 * @param {string} line
 * @returns {string[]}
 */
export function splitCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim());
}

/** Strip a UTF-8 BOM and normalise line endings, returning non-empty lines. */
export function splitCSVLines(text) {
  text = text.replace(/^\uFEFF/, '');
  return text.trim().split(/\r\n|\n|\r/).map(l => l.trim()).filter(Boolean);
}

/**
 * Parse a money string that may use thousands-separator commas and/or
 * surrounding quotes, e.g. `"290,149"` → 290149.
 * @param {string} raw
 * @returns {number}  NaN if unparseable
 */
export function parseMoney(raw) {
  if (raw === null || raw === undefined) return NaN;
  const cleaned = String(raw).replace(/^"|"$/g, '').replace(/,/g, '').replace(/[^\d.\-]/g, '');
  return parseFloat(cleaned);
}

// ── Misc ────────────────────────────────────────────────

/** HTML-escape a string for safe innerHTML interpolation. */
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

/** Generate a reasonably-unique id (not cryptographically secure). */
export function uid(prefix = 'id') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/** Clamp a number between min and max. */
export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
