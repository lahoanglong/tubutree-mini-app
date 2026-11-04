// Dựng báo cáo L4 từ results.jsonl (lấy dòng cuối của mỗi ID) + findings.json (Lỗi, CẦN CHỦ, Hạn chế bộ khung, ghi chú tay).
// Chạy: node build-report.mjs   -> ghi docs/2026-11-04-uat/L4-doi-rac-cong-dong.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../..');
const rows = new Map();
for (const l of fs.readFileSync(path.join(HERE, 'results.jsonl'), 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  rows.set(r.id, r);
}
const all = [...rows.values()];
const F = JSON.parse(fs.readFileSync(path.join(HERE, 'findings.json'), 'utf8'));

const A = 'apps/api/src/modules';
const SRC = [
  [/^W-0[1-6]$/, `${A}/waste-exchange/core/waste-access.service.ts:63-72`],
  [/^W-1\d$/, `${A}/waste-exchange/waste-seed-data.ts:37-42; customer/waste-customer.controller.ts`],
  [/^W-2[01]$/, `${A}/waste-exchange/core/waste-hold.service.ts:137; customer/waste-requests.service.ts:47`],
  [/^W-2[2-7]$/, `${A}/waste-exchange/core/waste-hold.service.ts:247; waste-seed-data.ts:39-40 (warehouseOnly)`],
  [/^W-(28|29|30)$/, `${A}/waste-exchange/core/waste-caps.ts:21-37; core/waste-hold.service.ts:85-117`],
  [/^W-3[1-5]$/, `${A}/waste-exchange/customer/waste-requests.service.ts (huỷ/chi tiết); waste.constants.ts:14`],
  [/^W-3[6-9]$/, `${A}/waste-exchange/customer/waste-customer.controller.ts:227-229; common/idempotency-key`],
  [/^W-4\d$/, `${A}/waste-exchange/customer/waste-requests.service.ts (MAIL_IN); SystemConfig waste.mailin_min_points`],
  [/^W-49$/, `${A}/waste-exchange/customer/waste-requests.service.ts:47 (không đụng sổ điểm)`],
  [/^D-0\d$|^D-1\d$/, `${A}/waste-exchange/receiving/waste-desk.controller.ts; waste-confirm.service.ts:90,444`],
  [/^D-[2-5]\d$/, `${A}/waste-exchange/receiving/waste-confirm.service.ts:90-256; waste-quota.ts:48-62`],
  [/^D-6\d$|^D-7\d$/, `${A}/waste-exchange/catalog/waste-gift-redemptions.service.ts; catalog/waste-gift-expiry.cron.ts`],
  [/^D-8\d$/, `${A}/waste-exchange/pickup/waste-expiry.cron.ts:114-125; migration 20261103210000_waste_expiring_template_end_of_day`],
  [/^D-9\d$/, `${A}/waste-exchange/receiving/waste-reverse.service.ts:43-99`],
  [/^M-/, `${A}/waste-exchange/receiving/waste-receive.service.ts:89-190; waste-match.ts:30-58`],
  [/^G-/, `${A}/game/checkin-streak.ts:42-61; game-economy.service.ts:83,126,148; game.service.ts:201-249`],
  [/^C-0\d$|^C-1\d$|^C-2\d$|^C-3\d$/, `${A}/feed/community-feed.service.ts:322,642; community-reward.service.ts:86-121; content-filter.ts`],
  [/^C-[4-7]\d/, `${A}/feed/community-feed.service.ts:719; community-feed.controller.ts (@Roles)`],
  [/^R-/, 'FOR UPDATE khoá dòng: waste-confirm.service.ts:326,396; waste-reverse.service.ts:43; idempotency-key'],
  [/^P-W/, `${A}/waste-exchange/receiving/waste-admin-requests.controller.ts:96-160 (@Roles); common/staff-access.ts:21-33`],
  [/^P-[GC]/, `${A}/game/game.controller.ts (JWT); feed/community-feed.controller.ts`],
  [/^TZ-/, 'apps/api/src/common/vn-time.ts; game-economy.service.ts:83,148; game.service.ts:241'],
  [/^U-F-community|^U-F-comment|^U-F-cskh/, 'apps/miniapp/src/pages/feed.tsx, post-detail.tsx; packages/app-core/src/route-map.json:47-50'],
  [/^U-F-create|^U-F-cancel/, 'apps/miniapp/src/pages/recycle-new.tsx:377-500,748; recycle-request.tsx'],
  [/^U-F-desk/, 'apps/miniapp/src/pages/recycle-desk.tsx; packages/app-core/src/waste-desk.ts:31-39'],
  [/^U-F-garden/, 'apps/miniapp/src/pages/game.tsx; apps/miniapp/src/components/bottom-nav.tsx:27-58'],
  [/^U-F-guest/, 'packages/app-core/src/route-map.json (private)'],
  [/^U-/, 'packages/app-core/src/route-map.json:38-76; apps/miniapp/src/components/bottom-nav.tsx:27-58'],
];
const srcOf = (id) => (SRC.find(([re]) => re.test(id)) ?? [null, ''])[1];
const scriptOf = (id) => {
  if (/^W-/.test(id)) return '10-waste-api.mjs';
  if (/^D-9[0-5]/.test(id)) return '21-waste-reverse.mjs';
  if (/^D-/.test(id)) return '20-waste-desk.mjs';
  if (/^M-/.test(id)) return '25-waste-mailin.mjs';
  if (/^G-/.test(id)) return '30-game-api.mjs';
  if (/^C-/.test(id)) return '40-community-api.mjs';
  if (/^R-/.test(id)) return '60-race.mjs';
  if (/^P-/.test(id)) return '70-perm.mjs';
  if (/^TZ-/.test(id)) return '80-tz.mjs';
  return '50-ui.mjs';
};
const cell = (s, n = 420) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, n);
const surfaceName = (r) => ({ API: 'api', mini375: 'mini375', web375: 'web375', web1280: 'web1280' })[r.viewport] ?? r.viewport ?? '';

const count = (s) => all.filter((r) => r.status === s).length;
const pass = count('PASS'), fail = count('FAIL'), blocked = count('BLOCKED'), owner = count('CẦN CHỦ');
const groups = [
  ['Đổi rác: tạo yêu cầu, điểm nhận, hạn mức, huỷ, idempotency (W)', /^W-/],
  ['Đổi rác: quầy xác nhận, cộng điểm, quà, hết hạn, thu hồi (D)', /^D-/],
  ['Đổi rác: gửi về kho MAIL_IN (M)', /^M-/],
  ['Vườn Xanh: điểm danh, chuỗi, nhiệm vụ, quay, sương (G)', /^G-/],
  ['Cộng đồng: đăng, xem, bình luận, kiểm duyệt (C)', /^C-/],
  ['Đua song song (R)', /^R-/],
  ['Quyền theo vai trò (P)', /^P-/],
  ['Ranh giới ngày giờ VN (TZ)', /^TZ-/],
  ['Giao diện: ma trận trang × khổ (U-mini375/web375/web1280)', /^U-(mini375|web375|web1280)-/],
  ['Giao diện: hành trình bấm thật (U-F)', /^U-F-/],
];

const lines = [];
lines.push('# L4 — Đổi rác, Cộng đồng, Vườn Xanh (UAT 04/11/2026)');
lines.push('');
lines.push(`Lane 4 (API 3241, web 3242, Mini 3243, Pancake giả 3248, DB \`tubutree_uat_l4\`, Redis db 4). Mã nguồn SHA ${F.sha} (bằng PROD). ${F.runInfo}`);
lines.push('');
lines.push(`**Kết quả: ${all.length} ca — PASS ${pass}, FAIL ${fail}, BLOCKED ${blocked}, CẦN CHỦ ${owner}.**`);
lines.push('');
lines.push('Chạy lại toàn bộ (lane mới, khoảng 12 phút): `bash docs/2026-11-04-uat/scripts/L4-doi-rac-cong-dong/run-api-cases.sh` (đường dẫn trong worktree gl-1103-docs, chạy với `cd` vào worktree uat-1104).');
lines.push('');
lines.push('| Nhóm | PASS | FAIL | BLOCKED | CẦN CHỦ |');
lines.push('|---|---|---|---|---|');
for (const [name, re] of groups) {
  const g = all.filter((r) => re.test(r.id));
  lines.push(`| ${name} | ${g.filter((r) => r.status === 'PASS').length} | ${g.filter((r) => r.status === 'FAIL').length} | ${g.filter((r) => r.status === 'BLOCKED').length} | ${g.filter((r) => r.status === 'CẦN CHỦ').length} |`);
}
lines.push('');
for (const sec of F.sections ?? []) {
  lines.push(`## ${sec.title}`);
  lines.push('');
  for (const l of sec.lines) lines.push(l);
  lines.push('');
}

lines.push('## Bảng ca');
lines.push('');
lines.push('Cột "Kỳ vọng" ghi quy tắc kèm nguồn (file:dòng hoặc khoá SystemConfig). "Bằng chứng" là script chạy lại được (thư mục `scripts/L4-doi-rac-cong-dong/`) hoặc ảnh chụp (thư mục `shots/L4-doi-rac-cong-dong/`); các ca có cộng/trừ điểm đã đối chiếu số dư = tổng sổ bằng SQL ngay trong script.');
lines.push('');
lines.push('| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng (nguồn quy tắc) | Thực tế | Bằng chứng | PASS/FAIL/BLOCKED |');
lines.push('|---|---|---|---|---|---|---|---|---|');
const order = (id) => {
  const m = id.match(/^([A-Z]+)(?:-([A-Za-z0-9]+))?/);
  return id;
};
const sorted = [...all].sort((a, b) => {
  const ga = groups.findIndex(([, re]) => re.test(a.id));
  const gb = groups.findIndex(([, re]) => re.test(b.id));
  if (ga !== gb) return ga - gb;
  return a.id.localeCompare(b.id, 'vi', { numeric: true });
});
for (const r of sorted) {
  const src = srcOf(r.id);
  const ev = r.evidence ? `${scriptOf(r.id)}; ${String(r.evidence).replace(/^\.\.\//, '')}` : scriptOf(r.id);
  lines.push(`| ${r.id} | ${cell(r.persona, 30)} | ${surfaceName(r)} | ${cell(r.journey, 40)} | ${cell(r.step, 160)} | ${cell(r.expected, 380)}${src ? ` — nguồn: ${cell(src, 200)}` : ''} | ${cell(r.actual, 360)} | ${cell(ev, 200)} | ${r.status} |`);
}
lines.push('');
fs.writeFileSync(path.join(OUT, 'L4-doi-rac-cong-dong.md'), lines.join('\n'));
console.log(`ghi ${path.join(OUT, 'L4-doi-rac-cong-dong.md')}: ${all.length} ca, PASS ${pass}, FAIL ${fail}, BLOCKED ${blocked}, CẦN CHỦ ${owner}`);
