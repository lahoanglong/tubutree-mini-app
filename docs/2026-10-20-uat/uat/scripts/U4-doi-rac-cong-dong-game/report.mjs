#!/usr/bin/env node
// Dựng bảng ca U4 từ results/*.json và thay vào báo cáo uat/U4-doi-rac-cong-dong-game.md, giữa hai dấu
// <!-- U4-TABLE:BEGIN --> và <!-- U4-TABLE:END -->. Báo cáo chưa có hai dấu thì chỉ in bảng ra stdout.
// Dùng: node report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const REPORT = path.resolve(HERE, '../../U4-doi-rac-cong-dong-game.md');
const ORDER = ['00-setup', '10-recycle-customer', '20-recycle-desk', '30-community', '40-game', '50-notifications'];

const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();

function evidence(items) {
  return items
    .map((e) => (/^shots\/.+\.png$/.test(e) ? `[${path.basename(e, '.png')}](${e})` : e))
    .join('<br>');
}

const cases = [];
for (const name of ORDER) {
  const f = path.join(RESULTS, `${name}.json`);
  if (!fs.existsSync(f)) {
    console.error(`thiếu ${f}`);
    continue;
  }
  cases.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
}

const count = cases.reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
const lines = [
  `Tổng ${cases.length} ca: PASS ${count.PASS ?? 0}, FAIL ${count.FAIL ?? 0}, BLOCKED ${count.BLOCKED ?? 0}.`,
  '',
  '| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | Kết quả |',
  '|---|---|---|---|---|---|---|---|',
];
for (const c of cases) {
  const failed = (c.checks ?? []).filter((k) => !k.ok);
  const actual = [c.actual, failed.length ? `Kiểm tra trượt: ${failed.map((k) => `${k.name} (thực tế: ${JSON.stringify(k.detail ?? '').slice(0, 220)})`).join('; ')}` : '']
    .filter(Boolean)
    .join(' ');
  lines.push(
    `| ${cell(c.id)} | ${cell(c.role)} | ${cell(c.journey)} | ${cell(c.steps)} | ${cell(c.expected)} | ${cell(actual)} | ${cell(evidence(c.evidence ?? []))} | **${c.status}** |`,
  );
}
const table = lines.join('\n');

if (fs.existsSync(REPORT)) {
  const md = fs.readFileSync(REPORT, 'utf8');
  const re = /(<!-- U4-TABLE:BEGIN -->)[\s\S]*?(<!-- U4-TABLE:END -->)/;
  if (re.test(md)) {
    fs.writeFileSync(REPORT, md.replace(re, `$1\n${table}\n$2`));
    console.log(`đã thay bảng trong ${REPORT}`);
  } else {
    console.log(table);
  }
} else {
  console.log(table);
}
console.log(JSON.stringify(count));
