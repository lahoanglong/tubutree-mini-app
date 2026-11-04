// R2: dựng báo cáo lane từ results/*.jsonl (lấy dòng mới nhất mỗi ID) + results/ui-cases.jsonl (ca giao diện ghi tay) + results/sections.md (Lỗi, Hạn chế, CẦN CHỦ viết tay).
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/R2-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, OUT } from './lib.mjs';

const FILES = ['A1', 'A2', 'A3', 'A4', 'B', 'U3', 'U4', 'R1', 'ui-cases'];
const latest = new Map();
const order = [];
for (const f of FILES) {
  const p = path.join(RESULTS, `${f}.jsonl`);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (!latest.has(r.id)) order.push(r.id);
    latest.set(r.id, { ...r, file: f });
  }
}
const rows = order.map((id) => latest.get(id));
const cnt = (s) => rows.filter((r) => r.status === s).length;
const pass = cnt('PASS');
const fail = cnt('FAIL');
const blocked = cnt('BLOCKED');
const canchu = cnt('CAN_CHU');

const cell = (v, n = 150) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const lab = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', CAN_CHU: 'CẦN CHỦ' };
const groups = [
  ['A1', 'Nhóm A1. Báo giá và đặt đơn COD (API) so với oracle luật + SQL'],
  ['A2', 'Nhóm A2. Mã giảm giá, giờ vàng, tồn kho, giỏ (API)'],
  ['A3', 'Nhóm A3. Chuyển khoản QR, webhook ngân hàng, huỷ, mua lại, danh sách đơn (API + SQL)'],
  ['A4', 'Nhóm A4. Danh mục, tìm kiếm, chi tiết sản phẩm, phiếu mã (API)'],
  ['B', 'Nhóm B. Tái hiện lỗi API tìm thấy khi bấm giao diện'],
  ['U3', 'Nhóm U3. Hành trình bấm tay qua giao diện (Mini 375, web 375, web 1280)'],
  ['U4', 'Nhóm U4. Quy tắc Mini (5 tab, không link ngoài) và kiểm tra bố cục'],
  ['ui-cases', 'Nhóm U1/U2. So sánh giao diện Mini 375 với web 375, web 1280 không vỡ'],
  ['R1', 'Nhóm R1. Đối soát SQL toàn DB lane'],
];
let md = '';
for (const [f, title] of groups) {
  const rs = rows.filter((r) => r.file === f);
  if (!rs.length) continue;
  md += `\n### ${title}\n\n| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rs) {
    md += `| ${cell(r.id, 40)} | ${cell(r.persona, 20)} | ${cell(r.surface, 12)} | ${cell(r.journey, 24)} | ${cell(r.step, 140)} | ${cell(r.expected, 170)} | ${cell(r.actual, 190)} | ${cell(r.evidence ?? '', 200)} | ${lab[r.status] ?? r.status} |\n`;
  }
}
const sectionsFile = path.join(RESULTS, 'sections.md');
const sections = fs.existsSync(sectionsFile) ? fs.readFileSync(sectionsFile, 'utf8') : '';
const head = fs.existsSync(path.join(RESULTS, 'head.md')) ? fs.readFileSync(path.join(RESULTS, 'head.md'), 'utf8') : '';
const summary = `\n## Tổng kết số ca\n\nTổng ${rows.length} ca: PASS ${pass}, FAIL ${fail}, BLOCKED ${blocked}, CẦN CHỦ ${canchu} (CẦN CHỦ không tính FAIL).\n`;
const file = path.join(OUT, 'L1-mua-hang.md');
fs.writeFileSync(file, `${head}${summary}${sections}\n## Bảng ca\n${md}\n`);
console.log(JSON.stringify({ file, total: rows.length, pass, fail, blocked, canchu }));
