// Tổng hợp kết quả `eslint src --format json` của miniapp theo rule. node scripts/uiux/eslint-summary.mjs <file.json>
import fs from 'node:fs';

const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const norm = (p) => p.replace(/\\/g, '/').replace(/.*apps\/miniapp\//, '');
const by = {};
let e = 0;
let w = 0;
for (const f of j) {
  for (const m of f.messages) {
    const r = m.ruleId || '(parse)';
    by[r] ??= { e: 0, w: 0, files: new Set() };
    if (m.severity === 2) {
      by[r].e++;
      e++;
    } else {
      by[r].w++;
      w++;
    }
    by[r].files.add(norm(f.filePath));
  }
}
console.log(`files linted ${j.length}; errors ${e}; warnings ${w}`);
console.log('| rule | error | warning | số file |');
console.log('|---|---|---|---|');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].e + b[1].w - (a[1].e + a[1].w))) console.log(`| ${k} | ${v.e} | ${v.w} | ${v.files.size} |`);
const tf = {};
for (const f of j) {
  for (const m of f.messages) {
    if (/tubu-ds|no-restricted-imports/.test(m.ruleId || '')) {
      const k = norm(f.filePath);
      tf[k] ??= {};
      tf[k][m.ruleId] = (tf[k][m.ruleId] || 0) + 1;
    }
  }
}
console.log('\nTop file vi phạm tubu-ds / no-restricted-imports:');
for (const [k, v] of Object.entries(tf)
  .sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))
  .slice(0, 25)) console.log(JSON.stringify(v), k);
console.log('\nMẫu:');
let n = 0;
for (const f of j)
  for (const m of f.messages)
    if (/tubu-ds/.test(m.ruleId || '') && n++ < 6) console.log(`${norm(f.filePath)}:${m.line} ${m.ruleId} ${m.message.slice(0, 120)}`);
