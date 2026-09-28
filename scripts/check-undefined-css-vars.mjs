#!/usr/bin/env node
// Repo-root script — CI guardrail mirroring audit's own C2 method (comm -13 defs used).
//
// Quét apps/miniapp/src/**/*.{css,ts,tsx} tìm mọi tham chiếu var(--x), đối chiếu với các
// token được định nghĩa trong 3 file nguồn: design-tokens gốc, tokens.css riêng của miniapp,
// và cầu nối theme ZaUI (zaui-bridge.css). Không tự sửa gì — chỉ báo cáo file:line.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFINITION_FILES = [
  'packages/design-tokens/src/tokens.css',
  'apps/miniapp/src/css/tokens.css',
  'apps/miniapp/src/css/zaui-bridge.css',
];

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

const defined = new Set();
for (const f of DEFINITION_FILES) {
  const text = readFileSync(f, 'utf-8');
  for (const m of text.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
}

const files = walk('apps/miniapp/src', ['.ts', '.tsx', '.css']);
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf-8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/var\(--([a-zA-Z0-9-]+)/g)) {
      if (!defined.has(m[1])) {
        console.error(`${f}:${i + 1}: var(--${m[1]}) is not defined anywhere`);
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
