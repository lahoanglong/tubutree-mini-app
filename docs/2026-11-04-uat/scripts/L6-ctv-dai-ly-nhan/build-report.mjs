// Dựng báo cáo lane 6: ghép report-parts/head.md + bảng ca từ results.jsonl + report-parts/tail.md.
// Chạy: node build-report.mjs   (không cần lane đang chạy). Mỗi id lấy dòng ghi cuối cùng trong results.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../L6-ctv-dai-ly-nhan.md');
const rows = new Map();
for (const line of fs.readFileSync(path.join(HERE, 'results.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  rows.set(r.id, r);
}
const key = (id) => {
  const m = /^L6-([A-Z]+)(\d+)(.*)$/.exec(id);
  return m ? [m[1], Number(m[2]), m[3]] : [id, 0, ''];
};
const sorted = [...rows.values()].sort((a, b) => {
  const [pa, na, sa] = key(a.id);
  const [pb, nb, sb] = key(b.id);
  return pa === pb ? na - nb || sa.localeCompare(sb) : pa.localeCompare(pb);
});
const cell = (v, n) => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const count = (v) => sorted.filter((r) => r.verdict === v).length;
const lines = [
  `Tổng ${sorted.length} ca: PASS ${count('PASS')}, FAIL ${count('FAIL')}, BLOCKED ${count('BLOCKED')}, CẦN CHỦ ${count('CẦN CHỦ')}.`,
  '',
  '| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng (nguồn luật) | Thực tế | Bằng chứng | Kết quả |',
  '|---|---|---|---|---|---|---|---|---|',
  ...sorted.map((r) => `| ${r.id} | ${cell(r.persona, 20)} | ${cell(r.size, 40)} | ${cell(r.journey ?? r.title, 90)} | ${cell(r.step, 140)} | ${cell(r.expect, 260)} | ${cell(r.actual, 300)} | ${cell(r.evidence, 140)} | ${r.verdict} |`),
  '',
];
const part = (f) => fs.readFileSync(path.join(HERE, 'report-parts', f), 'utf8');
fs.writeFileSync(OUT, `${part('head.md')}\n${lines.join('\n')}\n${part('tail.md')}`);
console.log(`ghi ${OUT}: ${sorted.length} ca; PASS ${count('PASS')} FAIL ${count('FAIL')} BLOCKED ${count('BLOCKED')} CẦN CHỦ ${count('CẦN CHỦ')}`);
