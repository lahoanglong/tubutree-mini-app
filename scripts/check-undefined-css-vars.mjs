#!/usr/bin/env node
// Repo-root script — CI guardrail mirroring audit's own C2 method (comm -13 defs used).
//
// Quét apps/miniapp/src/**/*.{css,ts,tsx} tìm mọi tham chiếu var(--x), đối chiếu với các
// token được định nghĩa trong 3 file nguồn: design-tokens gốc, tokens.css riêng của miniapp,
// và cầu nối theme ZaUI (zaui-bridge.css). Không tự sửa gì — chỉ báo cáo file:line.
//
// Bỏ qua có chủ đích (không phải lỗ hổng):
//  - File test (*.spec.* / *.test.*): chứa chuỗi regex/fixture như `var(--color-` chứ không
//    phải tham chiếu CSS thật.
//  - Mảnh template literal `var(--type-${variant}-size)`: tên biến chỉ có ở runtime, không kiểm
//    tĩnh được (các biến --type-*-size/lh/weight thật đều định nghĩa trong design-tokens).
//  - `--zaui-*`: biến runtime do zmp-ui tự đặt (vd --zaui-safe-area-inset-bottom), không nằm
//    trong 3 file định nghĩa của repo.
// Khi trích định nghĩa, comment CSS bị bỏ trước — nếu không, một câu chú thích kiểu
// "--font-mono: ..." sẽ bị tính nhầm là đã định nghĩa (đã từng xảy ra).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFINITION_FILES = [
  'packages/design-tokens/src/tokens.css',
  'apps/miniapp/src/css/tokens.css',
  'apps/miniapp/src/css/zaui-bridge.css',
];

const RUNTIME_PREFIXES = ['zaui-'];
const SKIP_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

const defined = new Set();
for (const f of DEFINITION_FILES) {
  const text = stripCssComments(readFileSync(f, 'utf-8'));
  for (const m of text.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
}

const files = walk('apps/miniapp/src', ['.ts', '.tsx', '.css']).filter((f) => !SKIP_FILE.test(f));
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf-8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Nhóm 2 bắt `${` ngay sau tên → đây là mảnh template literal, tên thật chỉ có ở runtime.
    for (const m of lines[i].matchAll(/var\(--([a-zA-Z0-9-]+)(\$\{)?/g)) {
      const name = m[1];
      if (m[2]) continue;
      if (RUNTIME_PREFIXES.some((p) => name.startsWith(p))) continue;
      if (!defined.has(name)) {
        console.error(`${f}:${i + 1}: var(--${name}) is not defined anywhere`);
        bad++;
      }
    }
  }
}
if (bad > 0) {
  console.error(`\n${bad} undefined CSS variable reference(s).`);
  process.exit(1);
}
console.log('OK — every var(--x) reference is defined.');
