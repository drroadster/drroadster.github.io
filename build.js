#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
//  ROADSTER v2.0 · build.js
//
//  Bundles the modular dev-mode source (index.html + src/css/*
//  + src/js/**) into a single self-contained roadster.html that
//  can be opened directly in a browser or hosted anywhere.
//
//  Strategy:
//  • CSS:  concatenate all 5 files in cascade order → one <style>
//  • JS:   esbuild bundles all ES modules (resolving import/export,
//          tree-shaking, Firebase imports left external since
//          they're loaded via importmap in the HTML) → one <script>
//  • HTML: strip the <link rel=stylesheet> and external <script
//          type=module src=...> tags, inject the bundled versions
//
//  Usage:  node build.js
//  Output: dist/roadster.html
// ═══════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function log(msg) { console.log(`[build] ${msg}`); }
function fail(msg) { console.error(`[build] ERROR: ${msg}`); process.exit(1); }

// ── Step 0: ensure esbuild is available ───────────────
let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  fail(
    'esbuild is not installed. Run:\n' +
    '  npm install --save-dev esbuild\n' +
    'then re-run `node build.js`.'
  );
}

// ── Step 1: bundle JS (resolves ESM imports/exports) ──
log('Bundling JavaScript (src/js/main.js → single IIFE)...');

const jsResult = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/js/main.js')],
  bundle: true,
  format: 'iife',           // classic <script>, no type=module needed
  target: ['es2020'],
  write: false,
  // Firebase modules are resolved via the browser's native importmap
  // (see index.html) — esbuild must NOT try to bundle them itself.
  external: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
  logLevel: 'warning',
});

if (jsResult.errors.length) {
  fail('esbuild reported errors:\n' + jsResult.errors.map(e => e.text).join('\n'));
}

let bundledJs = jsResult.outputFiles[0].text;

// esbuild's IIFE format can't leave `import` statements as external
// references inside an IIFE (browsers would reject `import` inside a
// non-module script). The clean fix: emit format:'esm' instead, and
// load the bundle itself via <script type="module">. We don't need a
// classic script — the only reason to avoid type=module was Safari
// <16.4 support for importmap, which is no longer a real constraint.
// Re-run with esm format:
const jsResultEsm = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/js/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  write: false,
  external: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
  logLevel: 'warning',
});
if (jsResultEsm.errors.length) {
  fail('esbuild (esm) reported errors:\n' + jsResultEsm.errors.map(e => e.text).join('\n'));
}
bundledJs = jsResultEsm.outputFiles[0].text;

log(`  → ${(bundledJs.length / 1024).toFixed(1)} KB`);

// ── Step 2: concatenate CSS in cascade order ──────────
log('Concatenating CSS (tokens → layout → components → charts → animations)...');

const CSS_ORDER = [
  'src/css/tokens.css',
  'src/css/layout.css',
  'src/css/components.css',
  'src/css/charts.css',
  'src/css/animations.css',
];

const bundledCss = CSS_ORDER.map(rel => {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) fail(`Missing CSS file: ${rel}`);
  return `/* ── ${rel} ── */\n` + fs.readFileSync(full, 'utf8');
}).join('\n\n');

log(`  → ${(bundledCss.length / 1024).toFixed(1)} KB`);

// ── Step 3: read index.html and inject bundles ────────
log('Injecting bundles into index.html...');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Remove the 5 <link rel="stylesheet" href="src/css/...."> lines
html = html.replace(
  /<link rel="stylesheet" href="src\/css\/[^"]+">\n?/g,
  ''
);

// Remove the external module script tag
html = html.replace(
  /<script type="module" src="src\/js\/main\.js"><\/script>\n?/,
  ''
);

// Inject bundled CSS right before </head>
html = html.replace(
  '</head>',
  `<style>\n${bundledCss}\n</style>\n</head>`
);

// Inject bundled JS right before </body>, as a module (so top-level
// import statements for Firebase via importmap still resolve)
html = html.replace(
  '</body>',
  `<script type="module">\n${bundledJs}\n</script>\n</body>`
);

// ── Step 4: write output ──────────────────────────────
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

const outPath = path.join(DIST, 'roadster.html');
fs.writeFileSync(outPath, html, 'utf8');

// Copy the icon alongside it so favicon/apple-touch-icon resolve
const iconSrc = path.join(ROOT, 'roadster-icon.svg');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(DIST, 'roadster-icon.svg'));
}

const stat = fs.statSync(outPath);
log(`✅ Built dist/roadster.html (${(stat.size / 1024).toFixed(1)} KB)`);
log('   Open it directly in a browser, or host the dist/ folder anywhere.');
