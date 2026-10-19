// Tóm tắt docs/2026-10-20-uat/screens/miniapp.jsonl (bản ghi cuối của mỗi key thắng).
//   node docs/2026-10-20-uat/tools/uiux/summarize.mjs [metrics|axe|small <id>|text <key>|errors]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/pw.mjs';

const file = path.join(ROOT, 'docs/2026-10-20-uat/screens/miniapp.jsonl');
const recs = new Map();
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try {
    const j = JSON.parse(l);
    recs.set(j.key, j);
  } catch {
    /* dòng hỏng */
  }
}
const [mode = 'metrics', arg] = process.argv.slice(2);
const all = [...recs.values()];
if (mode === 'metrics') {
  console.log('key | fail | tap<44/total | hOverflow | h1 | tiny<12 | axe serious+critical | unmocked | errors');
  for (const r of all) {
    const ax = Array.isArray(r.axe) ? r.axe.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}×${v.count}`).join(',') : '';
    console.log([r.key, r.fail ? 'FAIL' : '', `${r.tapSmall}/${r.tapTotal}`, r.hOverflow ? 'H!' : '', r.h1, r.tinyText, ax, (r.unmocked ?? []).join(' '), (r.errors ?? []).filter((e) => !/PAGEERROR Object|Failed to load resource/.test(e)).join(' ; ').slice(0, 160)].join(' | '));
  }
} else if (mode === 'axe') {
  const agg = {};
  for (const r of all) for (const v of Array.isArray(r.axe) ? r.axe : []) {
    const k = `${v.impact} ${v.id}`;
    (agg[k] ??= []).push(`${r.id}×${v.count}`);
  }
  for (const [k, v] of Object.entries(agg).sort()) console.log(k, '=>', v.join(', '));
} else if (mode === 'axe-detail') {
  for (const r of all) for (const v of Array.isArray(r.axe) ? r.axe : []) if (!arg || v.id === arg) console.log(r.key, v.impact, v.id, JSON.stringify(v.n));
} else if (mode === 'small') {
  for (const r of all) if (r.id === arg || r.key === arg) console.log(r.key, '\n  ' + (r.tapSmallList ?? []).join('\n  '));
} else if (mode === 'text') {
  console.log(recs.get(arg)?.bodyText);
} else if (mode === 'grep') {
  const re = new RegExp(arg, 'i');
  for (const r of all) {
    const lines = (r.bodyText ?? '').split('\n').filter((x) => re.test(x));
    if (lines.length) console.log(r.key, '::', [...new Set(lines)].slice(0, 6).join(' || '));
  }
}
