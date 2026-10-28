#!/usr/bin/env node
// So hai bản build Mini App theo từng chunk (bỏ mã băm trong tên file), để biết tổng tăng ở đâu.
//   node docs/2026-10-28-review/tools/perf/chunk-diff.mjs <www trước> <www sau> [--min=0.3]
// In các chunk lệch quá --min KB (raw), rồi dòng tổng. Tên trùng sau khi bỏ mã băm thì cộng dồn.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const min = Number((process.argv.find((x) => x.startsWith('--min=')) || '--min=0.3').slice(6));
if (!a || !b) {
  console.error('dùng: chunk-diff.mjs <www trước> <www sau> [--min=0.3]');
  process.exit(2);
}

function sizes(dir) {
  const out = new Map();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(dir, p).split(path.sep).join('/');
      const key = rel.replace(/[.-][A-Za-z0-9_-]{8}(?=\.(module\.)?(js|css)$)/, '');
      const buf = fs.readFileSync(p);
      const cur = out.get(key) || { raw: 0, gz: 0 };
      cur.raw += buf.length;
      cur.gz += /\.(js|css|html|json|svg)$/.test(p) ? zlib.gzipSync(buf).length : buf.length;
      out.set(key, cur);
    }
  })(dir);
  return out;
}

const kb = (n) => (n / 1024).toFixed(1);
const A = sizes(path.resolve(a));
const B = sizes(path.resolve(b));
const rows = [];
for (const k of new Set([...A.keys(), ...B.keys()])) {
  const x = A.get(k) || { raw: 0, gz: 0 };
  const y = B.get(k) || { raw: 0, gz: 0 };
  const d = y.raw - x.raw;
  if (Math.abs(d) / 1024 >= min) rows.push([d, `${d > 0 ? '+' : ''}${kb(d)} KB raw (${kb(x.raw)} -> ${kb(y.raw)}; gz ${y.gz - x.gz > 0 ? '+' : ''}${kb(y.gz - x.gz)})  ${k}${!A.has(k) ? '  [mới]' : !B.has(k) ? '  [bỏ]' : ''}`]);
}
rows.sort((p, q) => q[0] - p[0]);
for (const [, line] of rows) console.log(line);
const sum = (m, f) => [...m.values()].reduce((s, v) => s + v[f], 0);
console.log(`TỔNG raw ${kb(sum(A, 'raw'))} -> ${kb(sum(B, 'raw'))} (${kb(sum(B, 'raw') - sum(A, 'raw'))}); gz ${kb(sum(A, 'gz'))} -> ${kb(sum(B, 'gz'))}`);
