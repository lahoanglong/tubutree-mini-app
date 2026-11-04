// Gộp results/*.json thành báo cáo lane 5. Chạy lại bất cứ lúc nào: node build-report.mjs
// Quy tắc gộp: file liệt kê trong FILES theo thứ tự; id trùng thì file sau thắng; id nằm trong SUPERSEDED bị bỏ ở file cũ.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = path.join(here, 'results');
const DOCS = path.resolve(here, '..', '..');
const SHOTS = path.join(DOCS, 'shots', 'L5-admin-van-hanh-cskh');
const OUT = path.join(DOCS, 'L5-admin-van-hanh-cskh.md');
const ld = (f) => JSON.parse(fs.readFileSync(path.join(R, f), 'utf8'));

const ROLES = ['admin', 'cskh', 'kho', 'ketoan', 'marketing', 'staff'];
const FILES = [
  '01-body-limits.json', '02-matrix-api.json',
  ...ROLES.map((r) => `03-matrix-ui-${r}.json`),
  '04-orders-list-pay.json', '04-orders-filters.json', '05-returns.json', '06-pancake-refunds.json', '07-ops-misc.json', '08-chat.json',
  '09-admin375-admin_cskh_ketoan_kho_marketing.json', '10-mini375.json', '11-desk375.json', '12-orders-ui.json', '13-chat-ui.json',
  '15-races.json', '16-races-refunds.json', '17-forms-ui.json', '18-money-ui.json', '18-money-ui-ERR5_ERR6.json',
  '21-ui-actions.json', '21-ui-actions-A_C.json', '22-payout-ui.json', '23-inbox-counts.json', '19-b01.json', '20-b01-ui.json',
];
const MERGE_INTO = { 'L5-B01-UI': 'L5-B01' };
const BUG_IDS = new Set(['L5-B01']);

const rows = new Map();
const src = new Map();
const ui = new Map();
for (const f of FILES) {
  for (const r of ld(f)) {
    if (MERGE_INTO[r.id]) { ui.set(MERGE_INTO[r.id], r); continue; }
    rows.set(r.id, r);
    src.set(r.id, f);
  }
}
for (const [id, u] of ui) {
  const r = rows.get(id);
  r.actual = `${r.actual}. Bằng giao diện (CSKH 1280): ${u.actual}`;
  r.step = `${r.step}. Giao diện: ${u.step}`;
  r.evidence = { api: r.evidence, ui: u.evidence };
}
const all = [...rows.values()];
const by = (v) => all.filter((r) => r.verdict === v);
const nPass = by('PASS').length, nFail = by('FAIL').length, nBlocked = by('BLOCKED').length, nCan = by('CAN_CHU').length;
const unknownFails = by('FAIL').filter((r) => !BUG_IDS.has(r.id)).map((r) => r.id);
if (unknownFails.length) console.warn('CẢNH BÁO: FAIL chưa có mục trong phần Lỗi:', unknownFails.join(', '));

const esc = (v, n) => {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  s = s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return n && s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const SHOT_BY_ID = {
  'L5-OUI-01': 'ui375-ketoan-order-open.png', 'L5-OUI-02a': 'ui375-ketoan-order-confirm-sheet.png', 'L5-OUI-02': 'ui375-ketoan-order-paid.png',
  'L5-OUI-03': 'ui1280-cskh-order-open.png', 'L5-OUI-04': 'ui1280-cskh-cancel-dialog.png', 'L5-OUI-05': 'ui375-kho-order-open.png', 'L5-OUI-07': 'ui1280-admin-order-open.png',
  'L5-FUI-01': 'ui375-marketing-coupon-over-cap.png', 'L5-FUI-02a': 'ui375-marketing-coupon-created.png', 'L5-FUI-02': 'ui375-marketing-coupon-created.png',
  'L5-FUI-04': 'ui375-marketing-template-04.png', 'L5-FUI-05': 'ui375-marketing-template-05.png',
  'L5-FUI-07-375': 'ui375-admin-opshealth.png', 'L5-FUI-07-1280': 'ui1280-admin-opshealth.png',
  'L5-CUI-01': 'ui375-cskh-chat-list.png', 'L5-CUI-03': 'ui375-cskh-chat-replied.png', 'L5-CUI-05': 'ui375-cskh-chat-block-dialog.png', 'L5-CUI-06': 'ui375-cskh-chat-blocked.png', 'L5-CUI-08': 'ui375-admin-chat-bridge.png',
  'L5-MUI-01': 'ui375-ketoan-customer-refunds.png', 'L5-MUI-02': 'ui375-ketoan-refund-claim-nobank.png', 'L5-MUI-03': 'ui375-admin-refund-claimed.png', 'L5-MUI-04': 'ui375-ketoan-refund-takeover-card.png',
  'L5-MUI-05': 'ui375-ketoan-refund-paid-dialog.png', 'L5-MUI-06': 'ui375-ketoan-refund-completed.png', 'L5-MUI-07': 'ui375-ketoan-payouts.png', 'L5-MUI-08': 'ui375-ketoan-payout-confirm.png',
  'L5-MUI-09': 'ui1280-ketoan-orders-pancake-attention.png', 'L5-MUI-11': 'ui375-ketoan-orders-pancake-attention.png', 'L5-MUI-12-cskh': 'ui375-cskh-returns.png', 'L5-MUI-12-kho': 'ui375-kho-returns.png',
  'L5-VUI-01': 'ui375-ketoan-vat-open.png', 'L5-VUI-02': 'ui375-ketoan-vat-bad-url.png', 'L5-VUI-03': 'ui375-ketoan-vat-confirm.png', 'L5-VUI-04': 'ui375-ketoan-vat-issued.png',
  'L5-RUI-01': 'ui375-cskh-return-card.png', 'L5-RUI-03': 'ui375-cskh-return-confirm.png', 'L5-RUI-04': 'ui375-cskh-return-approved.png', 'L5-RUI-05': 'ui375-kho-return-card.png', 'L5-RUI-06': 'ui375-kho-return-confirm.png',
  'L5-CFGUI-01': 'ui1280-admin-config-search.png', 'L5-CFGUI-03': 'ui1280-admin-config-confirm.png',
  'L5-PUI-01': 'ui375-admin-payouts.png', 'L5-PUI-02': 'ui375-admin-payout-approve-dialog.png', 'L5-PUI-03': 'ui375-admin-payout-reject-noreason.png', 'L5-PUI-04': 'ui375-admin-payout-reject-dialog.png',
  'L5-B01': 'ui1280-cskh-B01-cancel-lost-race.png',
};
function shotFor(r) {
  const cand = [];
  if (SHOT_BY_ID[r.id]) cand.push(SHOT_BY_ID[r.id]);
  const m = /^L5-UX-([a-z_]+)-(.+)$/.exec(r.id);
  if (m) cand.push(`ui1280-${m[1]}-${m[2]}.png`);
  const a = /^L5-A375-([a-z_]+)-(.+)$/.exec(r.id);
  if (a) cand.push(`ui375-${a[1]}-${a[2]}.png`);
  return cand.find((c) => fs.existsSync(path.join(SHOTS, c)));
}

const out = [];
const P = (s = '') => out.push(s);

// ───────── Đầu trang ─────────
P('# L5 — Admin, vận hành, CSKH: báo cáo UAT');
P();
P('Ngày chạy: 04/11/2026 (bắt đầu 03:56). Người chạy: UAT agent lane 5, khoá `L5-admin-van-hanh-cskh`.');
P('Mã đang thử: worktree `uat-1104` ở SHA `98803f006` (cùng bản với PROD tại lúc chạy). Lane 5: API 3251, web 3252, Mini 3253, Pancake giả 3258, DB `tubutree_uat_l5`, Redis db 5.');
P('Không sửa mã ứng dụng, không đụng PROD, không đẩy, không PR.');
P();
P('## Kết luận');
P();
P(`| Chỉ số | Số ca |`);
P(`|---|---|`);
P(`| Tổng số ca đã chạy | ${all.length} |`);
P(`| PASS | ${nPass} |`);
P(`| FAIL | ${nFail} |`);
P(`| BLOCKED | ${nBlocked} |`);
P(`| CẦN CHỦ (không tính FAIL) | ${nCan} |`);
P();
P('- Một lỗi thật: **L5-B01 (P2)**: bấm "Huỷ đơn" thua cuộc đua với "Đã nhận tiền" thì API trả 200, màn không báo gì, đơn vẫn chạy bình thường. Chi tiết ở mục "Lỗi".');
P('- Tiền, Ví, điểm: mọi ca có đụng tiền đều đối chiếu SQL; đối soát cuối buổi (`reconcile-wallet`, `reconcile-points`) báo 0 user lệch.');
P('- Quyền: 320 route admin gọi thẳng bằng 10 persona, 0 route sai quyền; 6 vai × 43 tab ở giao diện 1280, 0 sai.');
P('- Mục "CẦN CHỦ" có 4 điểm (2 ca trong bảng và 2 quan sát) chưa có luật nêu rõ nên không tính lỗi; 1 ca BLOCKED do bộ khung (cầu nối Zalo).');
P();

// ───────── Kịch bản đã chạy ─────────
P('## Script và số ca');
P();
P('Mọi script nằm ở `docs/2026-11-04-uat/scripts/L5-admin-van-hanh-cskh/`, kết quả thô ở `results/*.json`, ảnh ở `docs/2026-11-04-uat/shots/L5-admin-van-hanh-cskh/`. Chạy lại: `node build-report.mjs` ghép kết quả thành báo cáo này.');
P();
P('| Script | Nội dung | Số ca | FAIL |');
P('|---|---|---|---|');
const DESC = {
  '01-body-limits': 'Giới hạn thân request: webhook Pancake không token, JSON quá sâu / quá nhiều khoá, gzip hỏng, content-encoding lạ, vượt cỡ',
  '02-matrix-api': 'Gọi thẳng 320 route admin bằng anonymous, khách, CTV, đại lý, staff, kho, kế toán, marketing, CSKH, admin',
  '03-matrix-ui': 'Mở từng tab /admin?tab=… ở 1280 cho 6 vai (admin, CSKH, kho, kế toán, marketing, staff)',
  '04-orders-list-pay': 'Đơn hàng: danh sách, tìm kiếm, "Đã nhận tiền", huỷ, hoàn một phần / toàn phần theo luật',
  '04-orders-filters': 'Đơn hàng: bộ lọc trạng thái, thanh toán, hàng đợi, ngày, tìm kiếm, đếm theo trạng thái',
  '05-returns': 'Đổi/trả: khách chọn dòng, CSKH duyệt theo số xem trước, Kho "Đã nhận hàng về", trả nốt phần còn lại; đối chiếu Ví và điểm',
  '06-pancake-refunds': 'Hoàn tiền khách và "Cần xử lý Pancake": tiền dư, COD hoàn về, claim, đã chuyển khoản, tiếp quản',
  '07-ops-misc': 'Lệnh rút CTV (Admin duyệt, Kế toán chi), hoá đơn VAT, trần mã giảm giá Marketing, mẫu thông báo, cấu hình hệ thống, sức khoẻ vận hành, CSV che SĐT',
  '08-chat': 'Chat CSKH: bật/tắt, 200 tin mỗi ngày, trùng clientMsgId, chặn/bỏ chặn, quyền từng vai',
  '09-admin375': 'Các tab hay dùng ở 375 cho admin, CSKH, kế toán, kho, marketing',
  '10-mini375': 'Màn nội bộ Mini App 375: /staff, /recycle-desk, /admin',
  '11-desk375': 'Màn thu gom (recycle-desk) 375',
  '12-orders-ui': 'Đơn hàng bằng giao diện: Kế toán "Đã nhận tiền", CSKH "Huỷ đơn", Kho "Đã đóng gói", Admin xem đủ',
  '13-chat-ui': 'Chat CSKH bằng giao diện 375',
  '15-races': 'Hai người cùng bấm một việc (đồng thời): trạng thái đơn, hoàn tiền, lệnh rút',
  '16-races-refunds': 'Hoàn tiền khách đồng thời: verify, claim, mark-paid',
  '17-forms-ui': 'Biểu mẫu: mã giảm giá Marketing, mẫu thông báo, Sức khoẻ hệ thống (token Zalo giả)',
  '18-money-ui': 'Việc tiền bằng giao diện: Hoàn tiền khách, lệnh rút, chip "Cần xử lý Pancake", CSV, Đổi/Trả',
  '19-b01': 'Tái hiện L5-B01 bằng API (6 đơn)',
  '20-b01-ui': 'Tái hiện L5-B01 bằng giao diện (ảnh)',
  '21-ui-actions': 'VAT, Đổi/Trả duyệt + nhận hàng, cấu hình hệ thống bằng giao diện',
  '22-payout-ui': 'Lệnh rút cũ: Admin duyệt / từ chối bằng giao diện, hoàn Ví',
  '23-inbox-counts': 'Số trên "Việc cần xử lý" khớp danh sách và SQL cho từng vai; không rò thẻ của vai khác',
};
const group = new Map();
for (const r of all) {
  const f = src.get(r.id) ?? '19-b01.json';
  const key = f.replace(/\.json$/, '').replace(/-(admin|cskh|kho|ketoan|marketing|staff)$/, '').replace(/-admin_cskh.*$/, '').replace(/-ERR5_ERR6$/, '').replace(/-A_C$/, '').replace(/^(03-matrix-ui).*/, '$1').replace(/^(09-admin375).*/, '$1');
  const g = group.get(key) ?? { n: 0, f: 0 };
  g.n++; if (r.verdict === 'FAIL') g.f++;
  group.set(key, g);
}
for (const [k, g] of [...group.entries()].sort()) P(`| \`${k}\` | ${DESC[k] ?? ''} | ${g.n} | ${g.f} |`);
P();

// ───────── Ma trận vai trò × tab ─────────
P('## Ma trận vai trò x tab');
P();
P('Nguồn luật: bảng `EXPECTED` 320 route trong `apps/api/src/common/staff-permissions.matrix.spec.ts` và nhóm quyền trong `apps/web/src/app/admin/page.tsx:369-372` (CSKH: inbox, orders, externalOrders, externalClaims, returns, users, quickReplies, community, supportChat; KHO: inbox, orders, returns; KẾ TOÁN: inbox, orders, externalClaims, reports, merchantFulfilment, customerRefunds, cashback, dealerClaims, dealerAccounts, payouts; MARKETING theo bảng; STAFF thường: chỉ tab Đổi rác).');
P();
P('### Giao diện 1280: mở tab bằng URL `?tab=…`');
P('"Mở" = tab hiện đúng, có nội dung, không request lỗi. "Chặn" = tab bị cấm tự quay về tab mặc định, không lộ nội dung, không request lỗi. "LỖI" = lệch bảng quyền.');
P();
const tabs = [];
const cell = new Map();
for (const role of ROLES) {
  for (const r of ld(`03-matrix-ui-${role}.json`)) {
    const m = /^L5-UX-([a-z_]+)-(.+)$/.exec(r.id);
    if (!m || m[1] !== role) continue;
    if (!tabs.includes(m[2])) tabs.push(m[2]);
    const allowed = /được phép/.test(r.step);
    cell.set(`${role}|${m[2]}`, r.verdict === 'PASS' ? (allowed ? 'Mở' : 'Chặn') : 'LỖI');
  }
}
P(`| Tab | ${ROLES.join(' | ')} |`);
P(`|---|${ROLES.map(() => '---').join('|')}|`);
for (const t of tabs) P(`| \`${t}\` | ${ROLES.map((r) => cell.get(`${r}|${t}`) ?? '—').join(' | ')} |`);
P();
P(`Tổng: ${tabs.length} tab × ${ROLES.length} vai = ${tabs.length * ROLES.length} ô; số ô "LỖI": ${[...cell.values()].filter((v) => v === 'LỖI').length}.`);
P();
P('### API: gọi thẳng, không qua giao diện');
P();
const mx = ld('02-matrix-summary.json');
P('| Persona | Route cấm gọi đúng (401/403) | Route cấm gọi sai | Route được phép gọi đúng | Route được phép gọi sai | Route ghi bỏ qua (không gọi để khỏi đổi dữ liệu) |');
P('|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(mx)) P(`| ${k} | ${v.deniedOk} | ${v.deniedBad.length} | ${v.allowedOk} | ${v.allowedBad.length} | ${v.skipped} |`);
P();
P('Route bị bỏ qua là route ghi (POST/PUT/PATCH/DELETE) mà persona ĐƯỢC phép gọi nhưng không có dạng gọi an toàn (gọi thật sẽ đổi hoặc xoá dữ liệu); các route ghi quan trọng được kiểm riêng ở các script nghiệp vụ (04–08, 15, 16, 21, 22).');
P();
P('Nhóm route và người được phép theo bảng duyệt:');
P();
P(fs.readFileSync(path.join(R, '02-matrix-groups.md'), 'utf8').trim());
P();

// ───────── Bảng ca ─────────
P('## Bảng ca');
P();
P('Cột Bằng chứng: tệp kết quả thô (trong `results/`), kèm ảnh trong `shots/` nếu có; phần trích rút gọn từ bằng chứng nằm sau dấu `·`. Kỳ vọng ghi nguồn luật (tệp:dòng hoặc khoá SystemConfig) khi script có nêu.');
P();
const journeys = new Map();
for (const r of all) {
  const j = r.journey ?? '(khác)';
  if (!journeys.has(j)) journeys.set(j, []);
  journeys.get(j).push(r);
}
for (const [j, list] of journeys) {
  P(`### ${j}`);
  P();
  P('| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const r of list) {
    const shot = shotFor(r);
    const ev = `\`${src.get(r.id) ?? ''}\`${shot ? `, ảnh \`${shot}\`` : ''}${r.evidence != null && r.evidence !== '' ? ` · ${esc(r.evidence, 110)}` : ''}`;
    const verdict = r.verdict === 'CAN_CHU' ? 'CẦN CHỦ' : r.verdict;
    P(`| ${r.id} | ${esc(r.persona)} | ${esc(r.size)} | ${esc(j, 40)} | ${esc(r.step, 190)} | ${esc(r.expect, 210)} | ${esc(r.actual, 230)} | ${ev} | ${verdict} |`);
  }
  P();
}

// ───────── Lỗi ─────────
P('## Lỗi');
P();
P('### L5-B01 — P2 — "Huỷ đơn" thua cuộc đua với "Đã nhận tiền": API trả 200, màn không báo gì, đơn vẫn chạy');
P();
P('- Bề mặt: API và giao diện web 1280 (CSKH). Cùng lỗi, hai cách tái hiện.');
P('- Cấp: P2 (thiếu báo lỗi cho người bấm). Không phải P0/P1 vì không mất tiền, không lộ dữ liệu, đơn đã trả tiền vẫn nguyên và được đưa vào hàng "Cần xử lý Pancake" (xem ảnh: nhãn đỏ "Pancake: cần xử lý").');
P('- Triệu chứng: CSKH bấm "Huỷ đơn" và xác nhận; đúng lúc đó Kế toán bấm "Đã nhận tiền" cho cùng đơn chuyển khoản. Thao tác huỷ thua cuộc đua nhưng `PUT /admin/orders/:id/status` vẫn trả HTTP 200 kèm đơn ở trạng thái CONFIRMED; màn chỉ làm mới danh sách, không có dòng nào báo "chưa huỷ được". Người bấm tin rằng đơn đã huỷ trong khi đơn đã trả tiền và còn hiệu lực; Pancake thì đã nhận lệnh huỷ.');
P('- Kỳ vọng: huỷ thành công, hoặc API báo lỗi rõ (400/409 "đơn vừa đổi trạng thái, chưa huỷ được, tải lại") và màn hiện câu đó. Các nhánh khác của cùng hàm đã làm đúng như vậy (ví dụ `CancelAfterHandoverError` ngay dòng trên).');
P('- Cùng triệu chứng ở cuộc đua với "Đã đóng gói": ca L5-RACE-06 (Kho đóng gói thắng, CSKH huỷ trả 200, đơn PACKED). Ca đó vẫn PASS vì đơn không rơi vào trạng thái lai, nhưng người bấm huỷ cũng không được báo.');
P('- Tần suất: API 6/6 ở lần chạy đầu, 5/6 ở lần chạy ghi nhận (ca còn lại huỷ thắng, Kế toán nhận 403 "đã huỷ/trả" đúng luật). Giao diện: 1/1 khi chặn route để hai request đi cùng lúc (lần đầu, đơn `TUBU2026110399367`).');
P('- Nghi ngờ:');
P('  - `apps/api/src/modules/orders/order-status.service.ts:389-401` (nhánh `!won` kết thúc bằng `return current;`: coi như thành công dù đơn không đổi sang CANCELLED; chỉ ném lỗi khi đơn đã giao vận hoặc đích là SHIPPING/DELIVERED).');
P('  - `apps/api/src/modules/admin/admin.service.ts:1099-1111` (`updateOrderStatus` trả đơn hiện tại như thể thành công).');
P('  - `apps/web/src/components/admin/order-status-actions.tsx:161-164` (`onSuccess` chỉ làm mới, không so sánh trạng thái trả về với trạng thái muốn đặt).');
P('- Cách tái hiện (API): chạy `repro-L5-B01-cancel-race.mjs`, in "TÁI HIỆN n/6" và thoát mã 1.');
P('  `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L5-admin-van-hanh-cskh/repro-L5-B01-cancel-race.mjs` (chạy từ thư mục worktree `uat-1104`, lane 5 đang chạy).');
P('- Cách tái hiện (giao diện): `20-b01-ui.mjs` (CSKH 1280 mở hộp "Huỷ đơn", chặn route PUT để gọi "Đã nhận tiền" cùng lúc). Các bước tay: tạo đơn chuyển khoản chưa trả; CSKH mở đơn, bấm "Huỷ đơn", điền lý do; Kế toán và CSKH bấm xác nhận cùng một giây (cần hai người hoặc công cụ; bằng tay khó trúng).');
P('- Ảnh: `shots/L5-admin-van-hanh-cskh/ui1280-cskh-B01-cancel-lost-race.png` (đơn "Đã xác nhận", "Đã thanh toán", không có thông báo lỗi, nhãn "Pancake: cần xử lý"); hộp thoại huỷ ở `ui1280-cskh-cancel-dialog.png`.');
P('- Gợi ý (không sửa trong lane này): ở nhánh `!won`, nếu đích là CANCELLED và đơn hiện tại chưa CANCELLED thì ném lỗi chuyển trạng thái để `toHttpBadRequest` trả 400 có câu tiếng Việt.');
P();
P('Không có lỗi P0, P1, P3 nào khác.');
P();

// ───────── CẦN CHỦ ─────────
P('## CẦN CHỦ');
P();
P('Các điểm sau chưa có luật nêu rõ trong tài liệu hay mã, nên không tính FAIL:');
P();
P('1. **Admin thêm link ngoài hoặc dãy 8 chữ số vào mẫu thông báo hệ thống** (ca L5-TPL-A01, L5-TPL-A02): API cho phép (HTTP 200). Câu báo lỗi của nhân viên ghi "Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu", nên có vẻ cố ý, nhưng tài liệu không nói. Chủ chốt: admin có được chèn link ngoài vào mẫu gửi khách không? Chỗ chặn: `assertStaffBody` chỉ chạy khi người sửa là nhân viên (`apps/api/src/modules/admin/notification-templates-admin.service.ts`).');
P('2. **Đơn trả một phần vẫn nằm trong "Cần xử lý Pancake" sau khi Kho đã bấm "Đã nhận hàng về"**: lý do vẫn ghi `Tạo phiếu "Hoàn một phần" … trên Pancake … và bấm "Đã nhận hàng về" khi hàng về kho` (ví dụ đơn TUBU2026110306439 sau ca L5-RUI-06). Cờ không tự hết, phải có người bấm "Đã xử lý" (Kho bấm được: ca L5-PK-resolve-ok). Nếu việc còn lại là "tạo phiếu bên Pancake" thì cờ đúng nhưng câu nhắc "bấm Đã nhận hàng về" đã lỗi thời (P3, sai chữ); nếu cờ phải tự hết khi Kho xác nhận thì là lỗi P2. Chủ chốt luật xoá cờ.');
P('3. **Máy thu gom (`/recycle-desk`) hoạt động cho nhân viên khi chương trình đổi rác đang tắt**, trong khi khách thấy "Chương trình đang tạm dừng" (waste tắt trong lane, ca 11-desk375). Chủ chốt: tắt chương trình thì máy thu gom có nên khoá theo không?');
P('4. **Lỗi console 401 khi nạp /admin lần đầu ở web** (đã lọc ở 09-admin375; lần chạy đầu cho 11 ca FAIL chỉ vì dòng này). Có thể do bộ khung đăng nhập (token bơm sẵn, `/me` bootstrap chạy trước khi nạp xong), chưa rõ app thật có dòng này không. Cần xem trên bản thật có đăng nhập thật.');
P();

// ───────── BLOCKED ─────────
P('## Ca BLOCKED');
P();
for (const r of by('BLOCKED')) P(`- ${r.id}: ${esc(r.step, 160)}. Lý do: ${esc(r.actual, 200)}. Vì sao không tính lỗi: cần cầu nối Zalo thật (xem "Hạn chế bộ khung").`);
P();

// ───────── Đối soát ─────────
P('## Đối soát SQL');
P();
P('Chạy lại sau toàn bộ ca (`14-reconcile.sh`, kết quả `results/14-reconcile.txt`):');
P();
P('```');
P(fs.readFileSync(path.join(R, '14-reconcile.txt'), 'utf8').trim().replace(/\n{3,}/g, '\n\n'));
P('```');
P();
P('Các ca có tiền, Ví, điểm hoặc kho, mỗi ca đều đo trước và sau bằng SQL (sổ `wallet_transactions`, `points_transactions`, tồn `variations.stock`, bảng `payouts`, `order_customer_refunds`, `return_requests`):');
P();
P('| Luồng | Ca chính | Điều kiện đã đo |');
P('|---|---|---|');
P('| Đổi/trả từng phần và toàn phần | L5-RT-*, L5-RUI-04, L5-RUI-06 | Ví tăng đúng số xem trước; sổ Ví = số dư; điểm = sổ điểm và giảm theo phần; kho +1 chỉ khi Kho xác nhận; duyệt lần hai không hoàn thêm |');
P('| Hoàn tiền khách (Pancake, COD hoàn về, huỷ đơn đã trả) | L5-PK-*, L5-RF-*, L5-RRF-*, L5-MUI-03..06 | Chi tay: Ví không đổi; một khoản chỉ hoàn một lần dù bấm đồng thời; lý do tiếp quản ghi vào lịch sử đơn |');
P('| Lệnh rút CTV (luồng cũ) | L5-PAY-*, L5-MUI-08, L5-PUI-02..04 | Duyệt và chi không đổi Ví; từ chối hoàn amount + fee (+325.000đ ở L5-PUI-04), sổ Ví khớp |');
P('| Mã giảm giá của nhân viên | L5-CPN-*, L5-FUI-01..02a, L5-CFGUI-03 | Trần % (30), tối đa 100.000đ, 1000 lượt, ngân sách ngày 10.000.000đ; ngân sách ngày tính cả mã đã tắt |');
P('| Đơn: "Đã nhận tiền", huỷ | L5-OR-*, L5-OUI-*, L5-RACE-01, L5-RACE-02, L5-B01 | DB trạng thái và thanh toán trước/sau, lịch sử đơn ghi mã giao dịch |');
P();

// ───────── Hạn chế ─────────
P('## Hạn chế bộ khung');
P();
P('Các điểm sau do bộ khung UAT, không tính FAIL:');
P();
P('1. **Lệnh rút CTV dựng bằng SQL**: API không còn nhận lệnh rút BANK (`POST /affiliate/payouts` method BANK trả 400; `POST /wallet/withdraw` trả 410, xem L5-PAY-01, L5-PAY-02), nên lệnh REQUESTED để thử Duyệt / Từ chối / Đã chi được `INSERT` thẳng vào `payouts` (id tiền tố `uatpay…`, `uatpui…`, `uatrace…`). Luồng thật hiện nay là chuyển hoa hồng vào Ví.');
P('2. **Pancake giả (cổng 3258)**: trạng thái đơn đẩy bằng `pancake-webhook.mjs`; không có vận đơn, tem hay phiếu trả thật.');
P('3. **Không có token Zalo và cầu nối Zalo**: tin khách chuyển sang nhóm Zalo (L5-CHAT-35) không kiểm được (BLOCKED); cảnh báo `zalo.oa_token` kiểm bằng cách nạp token giả rồi trả lại.');
P('4. **`waste.enabled` tắt trong lane**: `seed-data.mjs all` sập vì phần đổi rác, nên chỉ nạp phần dùng được; ca 10-mini375 bật tạm rồi tắt lại (biến `WASTE=on`).');
P('5. **Giới hạn tốc độ**: gửi header `x-throttle-bypass` (API trực tiếp, và `context.route` cho request web); không có header thì vài chục request liên tiếp bị 429.');
P('6. **Đăng nhập web bằng token bơm** (`web-session.mjs`): không đi qua màn đăng nhập Zalo thật; dòng console 401 lúc nạp bị lọc (CẦN CHỦ 4).');
P('7. **Cuộc đua do hai request**: kết quả phụ thuộc thời điểm. L5-B01 tái hiện 6/6 rồi 5/6; chạy lại có thể ra 3/6 đến 6/6. Cuộc đua thật giữa hai người cần cửa sổ tính bằng mili-giây.');
P('8. **Dữ liệu UAT sống trong DB lane**: mã giảm giá `UAT…` do script tạo (ngân sách ngày của Marketing tính cả mã đã tắt, nên script xoá mã cũ trước khi chạy lại); lệnh rút APPROVED còn sót sau L5-PUI-02.');
P('9. **Một trình duyệt mỗi lần, Playwright dùng như thư viện** (không chạy `npx playwright test`).');
P();

// ───────── Chưa làm ─────────
P('## Đã làm và chưa làm trong 3 giờ');
P();
P('Đã làm: toàn bộ danh mục ca của brief (ma trận quyền, đơn hàng, hoàn tiền, đổi/trả, "Cần xử lý Pancake", sức khoẻ vận hành, SystemConfig, trần mã giảm giá, mẫu thông báo, CSV che SĐT, lệnh rút, VAT, chat CSKH, giới hạn thân request), kèm lặp lại bằng giao diện 375 cho các tab dùng hằng ngày.');
P();
P('Chưa làm hoặc chỉ làm một phần:');
P();
P('- Tab ngoài phạm vi vận hành/CSKH (đại lý, flash sale, học viện, nhân sự, lương…): chỉ kiểm quyền mở / chặn, không kiểm nghiệp vụ.');
P('- Gửi thật ZNS, Zalo OA, email SMTP: bộ khung dùng giả, không kiểm nội dung gửi đi ngoài bảng thông báo trong app.');
P('- CSV người dùng và CSV bảng lương: chỉ kiểm CSV đơn hàng (che SĐT cho Kế toán, đủ dòng).');
P('- Trải nghiệm 375 của các tab quản trị hiếm dùng (cấu hình, gian hàng, đại lý…): chỉ kiểm mở được và không tràn ngang cho admin; thao tác nghiệp vụ chỉ làm ở các tab hằng ngày.');
P('- Tải và hiệu năng: không đo.');
P('- Duyệt đổi/trả "Từ chối" bằng giao diện đến cùng: mới kiểm nhánh thiếu lý do (L5-RUI-02); từ chối có lý do kiểm ở API (05-returns).');
P();
P('## Trạng thái lane sau khi chạy');
P();
P('Có 1 ca FAIL (L5-B01) nên **lane 5 được giữ chạy** (không chạy `lane-down.sh 5`) để người sửa tái hiện. `chat.enabled` đang bật trong DB lane; `coupon.staff_max_percent` đã khôi phục về 30; `zalo.oa_*` đã trả về như ban đầu.');
P();

fs.writeFileSync(OUT, `${out.join('\n')}\n`);
console.log(JSON.stringify({ total: all.length, pass: nPass, fail: nFail, blocked: nBlocked, canChu: nCan, out: OUT }));
