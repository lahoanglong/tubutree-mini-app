// Quét tĩnh DS v2 cho miniapp + web (chỉ đọc). Ghi scripts/uiux/results/static-scan.json.
//   node scripts/uiux/static-scan.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/scripts/uiux/lib/pw.mjs';

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const isSpec = (p) => /\.(spec|test)\.(ts|tsx)$/.test(p);

const mini = walk(path.join(ROOT, 'apps/miniapp/src')).filter((p) => /\.(tsx?|css)$/.test(p) && !isSpec(p));
const web = walk(path.join(ROOT, 'apps/web/src')).filter((p) => /\.(tsx?|css)$/.test(p) && !isSpec(p));

const LEGACY = /var\(--(neutral-\d+|primary-\d+|leaf-\d+|success|warning|danger|info|success-bg|warning-bg|danger-bg|info-bg|sun-\d+|clay-(?:200|800)|radius-(?:sm|md|lg|xl|full)|shadow-(?:xs|sm|md|lg)|dealer-[a-z-]+)(?=[,)])/g;
const HEX = /(?<![&\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!\w)/g;
const RGB = /\brgba?\(\s*\d/g;
const ZUI_UI = new Set(['Box', 'Text', 'Page', 'Button', 'Sheet', 'Input', 'Avatar', 'Spinner', 'Select', 'Switch', 'Radio', 'Checkbox', 'Header', 'Icon', 'List', 'Modal', 'Tabs', 'Swiper', 'Picker', 'DatePicker', 'Stepper']);

function count(re, s) {
  return (s.match(re) ?? []).length;
}

const rows = [];
for (const f of mini) {
  const s = fs.readFileSync(f, 'utf8');
  const r = rel(f);
  const isCss = f.endsWith('.css');
  const stripped = isCss ? s.replace(/\/\*[\s\S]*?\*\//g, '') : s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Dòng định nghĩa token (tokens.css) không tính là hardcode trong code.
  const hexLines = stripped.split('\n').filter((l) => !(isCss && /^\s*--[\w-]+\s*:/.test(l)));
  const hexText = hexLines.join('\n');
  // hex trong comment/URL anchor "#" (vd href="#abc") thường ngắn; giữ nguyên, đã loại # sau & hoặc chữ.
  const zuiImports = [];
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'zmp-ui'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) zuiImports.push(name);
    }
  }
  const usesDsV2 = /from\s+'(\.\.?\/)+(components\/)?ui\/|from\s+'@\/components\/ui|from\s+'\.\/ui\//.test(s) || /components\/ui\//.test(s);
  const zuiUi = zuiImports.filter((n) => ZUI_UI.has(n));
  const zmpIcons = /from\s+'zmp-ui-icons'|zaui-icons|zmp-ui\/icon/.test(s);
  const lucide = /from\s+'lucide-react'/.test(s);
  const emojiRe = /[\u{1F300}-\u{1FAFF}☀-➿]/gu;
  rows.push({
    file: r,
    hex: count(HEX, hexText),
    rgb: count(RGB, hexText),
    legacy: count(LEGACY, stripped),
    zuiAll: zuiImports,
    zuiUi,
    usesDsV2,
    zmpIcons,
    lucide,
    emoji: count(emojiRe, stripped),
    isPage: r.includes('/pages/'),
  });
}

const sum = (a, k) => a.reduce((x, y) => x + (typeof y[k] === 'number' ? y[k] : 0), 0);
const webRows = [];
for (const f of web) {
  const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  webRows.push({
    file: rel(f),
    hex: count(HEX, s),
    rgb: count(RGB, s),
    legacyPalette: count(/\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration|placeholder)-(?:primary|leaf|clay|sun)-\d{2,3}\b/g, s),
    neutralCls: count(/\b(?:bg|text|border|ring|divide)-neutral-\d{2,3}\b/g, s),
    greenRed: count(/\b(?:bg|text|border|ring)-(?:green|emerald|red|amber|blue|yellow|orange|rose|sky|indigo|violet|purple)-\d{2,3}\b/g, s),
    v2Cls: count(/\b(?:bg|text|border|ring)-(?:forest|sage|stone|honey|terracotta)-\d{2,3}\b/g, s),
    lucide: /from\s+'lucide-react'/.test(s),
    emoji: count(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, s),
    fraunces: /Fraunces|font-display|font-serif/.test(s),
  });
}

fs.writeFileSync(
  '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/tools/static-scan.json',
  JSON.stringify({ at: new Date().toISOString(), mini: rows, web: webRows }, null, 1),
);
console.log('miniapp files', rows.length, 'hex', sum(rows, 'hex'), 'rgb', sum(rows, 'rgb'), 'legacy', sum(rows, 'legacy'));
console.log('web files', webRows.length, 'hex', sum(webRows, 'hex'), 'rgb', sum(webRows, 'rgb'), 'legacyPalette', sum(webRows, 'legacyPalette'), 'neutral', sum(webRows, 'neutralCls'), 'greenRed', sum(webRows, 'greenRed'), 'v2', sum(webRows, 'v2Cls'));
