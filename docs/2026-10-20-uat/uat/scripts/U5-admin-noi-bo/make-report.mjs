#!/usr/bin/env node
// Dựng uat/U5-admin-noi-bo.md từ results/*.json (bảng ca + ma trận vai trò × tab) và phần phát hiện viết tay bên dưới.
// Dùng: node make-report.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const OUT = path.resolve(HERE, '../../U5-admin-noi-bo.md');
const FILES = ['u5-matrix', 'u5-orders', 'u5-money', 'u5-marketing', 'u5-admin-ops', 'u5-miniapp'];

const cases = FILES.flatMap((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, `${f}.json`), 'utf8')).map((c) => ({ ...c, file: `${f}.mjs` })));
cases.sort((a, b) => a.id.localeCompare(b.id));
const raw = JSON.parse(fs.readFileSync(path.join(RESULTS, 'u5-matrix-raw.json'), 'utf8'));
const cell = (s) => String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
const count = cases.reduce((m, c) => ((m[c.verdict] = (m[c.verdict] ?? 0) + 1), m), {});
let head = '';
try {
  head = execFileSync('git', ['-C', HERE, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  head = '(không đọc được)';
}
const runAt = cases.map((c) => c.at).filter(Boolean).sort();

const L = [];
L.push('# U5: admin nội bộ (lane 5)');
L.push('');
L.push(`Chạy trên lane 5 của bộ khung UAT: API 3251, web 3252, Mini App 3253, giả Pancake 3258, DB \`tubutree_uat_l5\`, Redis db 5. Mã nguồn ở worktree \`uat\`, HEAD \`${head}\` lúc dựng báo cáo. Kết quả ghi từ ${runAt[0] ?? '?'} đến ${runAt.at(-1) ?? '?'} (UTC). Web admin chụp ở 1440x900, Mini App ở 390x844 (Chromium).`);
L.push('');
L.push(`Kết quả: **${count.PASS ?? 0} PASS, ${count.FAIL ?? 0} FAIL, ${count.BLOCKED ?? 0} BLOCKED** trên ${cases.length} ca.`);
L.push('');
L.push('FAIL:');
for (const c of cases.filter((x) => x.verdict === 'FAIL')) L.push(`- ${c.id}: ${c.journey}${c.note ? ` (${c.note})` : ''}.`);
L.push('');
L.push('Chạy lại sau khi sửa (lane đã bật bằng `lane-up.sh 5 --web`, PATH có Node 22):');
L.push('');
L.push('```bash');
L.push('cd docs/2026-10-20-uat/uat/scripts/U5-admin-noi-bo');
L.push('node u5-matrix.mjs            # U5-01..08 (thêm --no-ui để bỏ phần web)');
L.push('node u5-orders.mjs            # U5-10..15');
L.push('node u5-money.mjs             # U5-20..23');
L.push('node u5-marketing.mjs         # U5-30..35');
L.push('node u5-admin-ops.mjs         # U5-40..48');
L.push('node u5-miniapp.mjs           # U5-50..55');
L.push('node make-report.mjs          # dựng lại file này');
L.push('```');
L.push('');
L.push('Mỗi script nhận `--only=U5-xx,U5-yy`. Ca tiền và điểm đọc DB trước và sau, so số dư cột với tổng sổ (`wallet_transactions`, `points_transactions`, `dealer_credit_ledgers`, `payouts`, `commissions`, `cashback_transactions`). DB lane tích dữ liệu qua các lần chạy, nên ca so chênh lệch trước/sau chứ không so số tuyệt đối.');
L.push('');
L.push('## Bảng ca');
L.push('');
L.push('| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | Kết quả |');
L.push('|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const ev = `${cell(c.evidence)}; script \`${c.file} --only=${c.id}\``;
  L.push(`| ${c.id} | ${cell(c.role)} | ${cell(c.journey)} | ${cell(c.steps)} | ${cell(c.expected)} | ${cell(c.actual)}${c.note ? ` **Ghi chú: ${cell(c.note)}.**` : ''} | ${ev} | ${c.verdict} |`);
}
L.push('');

// Ma trận vai trò × tab
const ROLES = [
  ['admin', 'ADMIN'],
  ['ketoan', 'KẾ TOÁN'],
  ['marketing', 'MARKETING'],
  ['cskh', 'CSKH'],
  ['kho', 'KHO'],
  ['staff', 'NHÂN VIÊN (không nhóm)'],
  ['returning', 'KHÁCH'],
];
L.push('## Ma trận vai trò × tab × kết quả');
L.push('');
L.push('Mỗi ô: tab có trên menu web admin hay không (`có` / `—`), rồi mã HTTP khi gọi API đọc đại diện của tab bằng token vai trò đó. Kỳ vọng lấy từ `apps/api/src/common/staff-permissions.matrix.spec.ts` và `STAFF_TABS` ở `apps/web/src/app/admin/page.tsx`; mọi ô khớp kỳ vọng (U5-01..07 PASS). ADMIN 400 ở Duyệt ca và Lương là do thiếu tham số tuần/tháng trong lời gọi thử, không phải lỗi quyền. Khách mở /admin thấy "Bạn không có quyền truy cập trang quản trị.".');
L.push('');
L.push(`| Tab | API đọc | ${ROLES.map((r) => r[1]).join(' | ')} |`);
L.push(`|---|---|${ROLES.map(() => '---').join('|')}|`);
for (const [key, label, apiPath] of raw.tabs) {
  if (key === 'reports') {
    for (const sub of ['reports.revenue', 'reports.sources']) {
      const row = ROLES.map(([r]) => {
        const m = raw.matrix[r];
        const menu = m?.ui?.labels?.includes(label) ? 'có' : '—';
        return `${menu} · ${m?.api?.[sub] ?? '?'}`;
      });
      L.push(`| ${label} (${sub === 'reports.revenue' ? 'doanh thu' : 'nguồn khách'}) | GET /admin/${sub.replace('.', '/')} | ${row.join(' | ')} |`);
    }
    continue;
  }
  const row = ROLES.map(([r]) => {
    const m = raw.matrix[r];
    const menu = m?.ui?.labels?.includes(label) ? 'có' : '—';
    return `${menu} · ${m?.api?.[key] ?? '?'}`;
  });
  L.push(`| ${label} | ${cell(apiPath)} | ${row.join(' | ')} |`);
}
L.push('');
L.push('Thao tác ghi nhạy cảm (U5-08), cả 19 lời gọi đều 403: KẾ TOÁN duyệt/từ chối rút tiền, đổi trạng thái đơn, đổi cấu hình, xuất người dùng, duyệt thưởng đại lý; MARKETING đổi cấu hình, mở nhiệm vụ, tạo sự kiện cộng đồng, mở nhãn hàng, xuất CSV đơn; CSKH khoá user, đổi vai trò, chọn người thắng sự kiện, xuất CSV đơn; KHO bấm "Đã nhận tiền"; NHÂN VIÊN không nhóm xem đơn, cấp quyền nhân sự; KHÁCH đọc hộp việc. Ca nghiệp vụ còn thử thêm: KẾ TOÁN duyệt rút tiền 403 (U5-20), KẾ TOÁN duyệt ca 403 (U5-52), MARKETING sửa mẫu ORDER_CANCELLED 403 (U5-34), MARKETING tạo mã vượt trần 403 (U5-31, U5-32).');
L.push('');

L.push(findings().trim());
L.push('');
fs.writeFileSync(OUT, `${L.join('\n')}\n`);
console.log(`${OUT}: ${JSON.stringify(count)} / ${cases.length} ca`);

/** Phần viết tay: phát hiện, hạn chế bộ khung, ca BLOCKED, phần chưa kiểm chứng, dữ liệu để lại trong DB lane. */
function findings() {
  return `
## Lỗi tìm thấy

Đã tra \`docs/2026-10-review/findings-catalog.md\`, \`docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md\` và các báo cáo D1–D15 của đêm nay. Ba mục đầu là lỗi đã biết, còn mở; UAT chạy lại thấy vẫn còn. Hai mục cuối chưa thấy ghi ở đâu.

### U5-B01 (P1, cần chủ quyết): MARKETING phát giảm giá vượt trần qua flash sale. Trùng D2-01, còn mở

- \`apps/api/src/modules/flash-sale/flash-sale-admin.controller.ts:21-26\` (AddItemDto: \`perUserLimit\` chỉ có \`@Min(1)\`), \`apps/api/src/modules/flash-sale/flash-sale.service.ts:374-403\` (\`addItem\` không có kiểm tra trần nào cho staff).
- Kịch bản: uat_marketing (STAFF, nhóm MARKETING) gọi \`POST /admin/flash-sales\` rồi \`POST /admin/flash-sales/:id/items\` với COBOTE-PW-100 (giá 79.000đ), \`flashPrice\` 7.900đ (giảm 90%), \`quota\` 150, \`perUserLimit\` 150. Cả hai lệnh trả 201. Một khách mua được 150 món, tổng giảm 10.665.000đ. Cùng người đó tạo coupon 31% hoặc giảm 100.001đ thì bị 403 (U5-31), vượt 10 triệu/ngày thì bị 400 (U5-32). Vậy luật B19 chỉ đang chặn ở coupon.
- Bằng chứng: U5-35 trong bảng trên, DB \`flash_sale_items\` {"flashPrice":7900,"quota":150,"perUserLimit":150}. Sau khi đo, ADMIN đã xoá đợt flash sale (200).
- Đề xuất: như D2-01. Khi người gọi không phải ADMIN, áp trần staff cho \`addItem\`; ở checkout chặn người tạo đợt mua giá flash. Test: MARKETING thêm món giảm 50% → 400; ADMIN thêm món giảm 90% → 201.
- Vùng file: phiên UAT (apps/api). Script tái hiện: \`node u5-marketing.mjs --only=U5-35\`.

### U5-B02 (P1, agent sửa ngay): CSKH và MARKETING ghim được bài cộng đồng, trái B8. Trùng D2-02, còn mở

- \`apps/api/src/modules/feed/community-feed.controller.ts:317-321\` (\`@AllowStaff(...COMMUNITY_MODERATORS)\` trên \`POST feed/admin/:id/pin\`), \`apps/web/src/components/admin/community-moderation-tab.tsx:288-290\` (nút Ghim hiện cho mọi người kiểm duyệt).
- Kịch bản: một khách chưa mua đăng bài, bài vào PENDING. uat_cskh mở web admin, vào Cộng đồng → Chờ duyệt, bấm "Duyệt" (201, đúng luật). Sang tab Đã đăng, bấm "Ghim" → 201, \`feed_posts.isPinned=true\`. Gọi \`POST /feed/admin/:id/pin {pinned:true}\` bằng token MARKETING → 201. B8: chỉ ADMIN được ghim.
- Bằng chứng: U5-54, ảnh \`shots/U5-admin-noi-bo/community-cskh-pin-1440.png\`, SQL \`feed_posts.isPinned\`. Sau ca, ADMIN đã bỏ ghim.
- Đề xuất: như D2-02. Bỏ \`@AllowStaff\` ở pin, ẩn nút Ghim/Bỏ ghim khi người xem không phải ADMIN. Test: \`canRun('pin', cskh) === false\`; e2e CSKH không thấy nút Ghim.
- Vùng file: API thuộc phiên UAT; \`community-moderation-tab.tsx\` thuộc phiên web, hỏi phiên đó trước khi sửa. Script: \`node u5-miniapp.mjs --only=U5-54\`.

### U5-B03 (P3, agent sửa ngay): hộp "Việc cần xử lý" của kế toán thiếu hoá đơn VAT chờ xuất và rút tiền chờ chi. Trùng D2-03, còn mở

- \`apps/api/src/modules/ops/ops-inbox.service.ts:100\` (\`payouts\`: audience 'ADMIN', chỉ đếm REQUESTED), \`:112\` (\`invoicePending\`: audience 'ADMIN'; comment dòng 111 còn ghi "issue-invoice chỉ ADMIN").
- Kịch bản: kế toán xuất được hoá đơn VAT ở U5-22 (201) và bấm "Đã chuyển khoản" cho rút tiền đã duyệt ở U5-20 (201). Nhưng \`GET /admin/ops/inbox\` bằng token kế toán chỉ trả customerRefunds, merchantToSettle, merchantPayoutsPending, wasteToCount, wasteUnmatched. Không có mục hoá đơn chờ xuất, cũng không có mục rút tiền đã duyệt chờ chi. Kế toán phải tự mở từng tab mới thấy việc.
- Bằng chứng: U5-46 (số mục từng vai trò, đối chiếu SQL), U5-22 (ghi chú).
- Đề xuất: như D2-03. Cho audience của \`invoicePending\` thêm ['KE_TOAN'], thêm khoá đếm payout APPROVED cho ['KE_TOAN']. Test: viewer KE_TOAN thấy hai khoá này, viewer CSKH không thấy.
- Vùng file: phiên UAT. Script: \`node u5-admin-ops.mjs --only=U5-46\`.

### U5-B04 (P3, agent sửa ngay): tab Cấu hình lưu thẳng nhiều khoá tiền/điểm, không có hộp "Xác nhận đổi cấu hình tiền/điểm"

- \`apps/web/src/components/admin/config-item.tsx:9\`: \`MONEY_PREFIXES = ['payment.', 'loyalty.', 'shipping.', 'wallet.', 'waste.']\`. Hộp xác nhận ở \`:31-37\` chỉ bật cho các tiền tố này.
- Kịch bản: ADMIN sửa \`affiliate.min_withdraw_bank\` thành 60000 rồi bấm Lưu. API nhận PUT ngay (200), DB thành 60000, không có hộp xác nhận. \`coupon.staff_max_percent\` cũng vậy. Ngược lại \`loyalty.max_redeem_pct\` có hộp xác nhận (U5-40). Các nhóm khoá tiền/điểm khác cũng lưu thẳng: \`affiliate.default_rate_pct\`, \`affiliate.pit_withhold_pct\`, \`coupon.staff_*\` (trần B19), \`cashback.merchant_user_share\`, \`dealer.max_discount_pct\`, \`flashsale.max_discount_pct\`, \`merchant.commission_pct\`, \`voucher.*_amount\`, \`referral.*_points\`, \`groupbuy.discount_pct\`, \`subscribe.discount_pct\`, \`community.*_reward_points\`, \`game.*\`. Gõ nhầm một số 0 ở đây là có hiệu lực ngay cho mọi đơn.
- Bằng chứng: U5-48, ảnh \`shots/U5-admin-noi-bo/config-affiliate-noconfirm-admin-1440.png\`, \`system_config_history\` ghi uat_admin. Ca đã trả giá trị về 50000.
- Đề xuất: thêm 'affiliate.', 'coupon.', 'cashback.', 'dealer.', 'flashsale.', 'merchant.', 'voucher.', 'referral.', 'groupbuy.', 'subscribe.', 'community.', 'game.' vào MONEY_PREFIXES. Cách khác: đánh dấu "tiền/điểm" ngay trên từng khoá ở API để không phải giữ danh sách. Test: \`config-item\` với khoá \`affiliate.min_withdraw_bank\` phải mở hộp xác nhận trước khi gọi \`setConfig\`.
- Vùng file: phiên web (apps/web), hỏi phiên đó trước. Script: \`node u5-admin-ops.mjs --only=U5-48\`.

### U5-B05 (P2, agent sửa ngay; chủ xem lại mức): lô thẻ hộp hàng sàn để trống ngày hết hạn thì hạn 30 ngày, luật đã chốt là 60 ngày

- \`apps/web/src/components/admin/claim-campaign-panel.tsx:80\` (\`localDayIso(f.endAt, true, Date.now() + 30 * 864e5)\`), \`:228\` (gợi ý "Bỏ trống = 30 ngày").
- Kịch bản: MARKETING tạo lô thẻ mà để trống ô "Hết hạn ngày". Cả lô sẽ hết hạn sau 30 ngày. Luật đã chốt trong \`00-brief.md:41\` là "Thẻ hộp hàng sàn: … hạn 60 ngày". Thẻ còn nằm trong kho và trong hộp trước khi tới tay khách, nên hạn 30 ngày dễ hết trước khi khách dùng. U5-30 tự điền +60 ngày nên PASS. Phần còn lại của luật đúng: 30.000đ, đơn từ 199.000đ, chỉ khách mới, mỗi thẻ một mã.
- Mức: theo định nghĩa trong brief, đây là "sai luật đã chốt" (P0). Ghi P2 vì chỉ sai khi bỏ trống ô ngày, và form có hiện gợi ý 30 ngày. Chủ nâng mức nếu muốn.
- Đề xuất: đổi mặc định và gợi ý thành 60 ngày. Tốt hơn nữa là đọc từ một khoá cấu hình. Test: \`claim-campaign-panel\` gửi \`endAt\` = hôm nay + 60 ngày khi ô trống.
- Vùng file: phiên web (apps/web). Script: \`node u5-marketing.mjs --only=U5-30\` (ca này điền ngày; muốn thử mặc định thì bỏ trống ô "Hết hạn ngày").

## Hạn chế bộ khung

Các mục dưới đây đến từ bộ khung giả, không phải lỗi app, và không tính FAIL.

1. Bộ khung không giả được lời gọi từ server tới Zalo (\`graph.zalo.me\`), nên checkin/checkout theo vị trí không chạy được (U5-55). Mini App chạy trên Chromium 390x844 với \`zmp-sdk\` giả, không phải webview Zalo thật. Chưa chạy WebKit.
2. Chuyển khoản ngân hàng và bước Pancake ghép nội dung chuyển khoản đều là giả (\`bank-webhook.mjs\`, \`fake-pancake.mjs\`). Đã kiểm phía Tubu xử lý webhook: đủ tiền, thiếu tiền, sai nội dung. Chưa kiểm Pancake thật.
3. Postback AccessTrade là giả, gửi kèm token của lane (U5-21).
4. Cron không chờ tới giờ thật. U5-20 và U5-21 lùi mốc thời gian trong DB lane (deliveredAt/lockedAt lùi 11 ngày; mốc cashback lùi 31 ngày), rồi chạy job bằng \`run-job.mjs\` (\`commissions.approve-due\`, \`cashback.settle\`). Đây là sửa dữ liệu để thử, không phải đường đi của app.
5. Script luôn gửi \`x-throttle-bypass\`, nên không đo giới hạn tần suất (ví dụ 5 bài/phút ở \`POST /feed\`).
6. Vai trò và trạng thái khoá được cache 5 giây trong mỗi tiến trình (\`apps/api/src/modules/auth/session-state.service.ts:27\`). Ca khoá/mở khoá chờ 5,5 giây rồi mới đọc lại.
7. DB lane giữ dữ liệu qua các lần chạy:
   - Tồn kho FUWA-GL-500 về 0 sau nhiều đơn sỉ, script phải đổi sang SKU khác.
   - Persona khách thành "tin cậy" khi có đơn đã giao hoặc bài đã duyệt (\`approvePost\` đặt \`isTrusted\` ở \`community-feed.service.ts:666-667\`), sau đó bài mới tự lên PUBLISHED (\`:574-580\`). Vì vậy mỗi lần chạy, script tự chọn một tác giả chưa được tin cậy.
   - Các số tuyệt đối (tổng đơn, dư nợ đại lý, doanh thu) đổi theo từng lần chạy, nên ca chỉ so chênh lệch trước/sau hoặc so với SQL ngay lúc chạy.
8. Ghi chú "Đã xử lý" ở mục Cần xử lý Pancake chỉ ghi vào log API (\`admin.controller.ts:398-401\`), nên U5-45 phải đọc \`tools/uat-harness/state/lane-5/logs/api.log\`.
9. Lần chạy đầu của U5-40 dừng giữa chừng (chờ một hộp xác nhận không bao giờ hiện, chính là U5-B04) và để \`affiliate.min_withdraw_bank\` = 60000 trong DB lane. U5-48 đã trả về 50000, và có thêm bước dọn bằng API khi ca lỗi.
10. OA/ZNS tắt ở lane nên không kiểm được tin gửi khách sau thao tác admin.
11. Ở ma trận quyền, lời gọi thử Duyệt ca và Lương của ADMIN trả 400 vì thiếu tham số tuần/tháng. Lỗi nằm ở lời gọi thử, quyền vẫn đúng.
12. Next dev biên dịch trang lần đầu mất 10–20 giây, máy dùng chung có lúc tải tới 100+. Script chờ tối đa 90 giây cho mỗi trang.

## Ca BLOCKED

- U5-55, checkin/checkout ca theo vị trí. Có hai lý do:
  - Mini App lấy vị trí bằng \`getLocation\`, API đổi token đó lấy toạ độ qua \`https://graph.zalo.me/v2.0/me/info\` (\`apps/api/src/modules/staff/attendance/zalo-location.ts:21\`). Bộ khung không giả được lời gọi này.
  - Đường dự phòng là trình duyệt gửi lat/lng (\`attendance.controller.ts:70-72\`). Đường này cũng không chạy: DB lane chưa có \`attendance.office_lat\`/\`office_lng\` và \`office_ips\` rỗng, nên \`verifyPresence\` trả NOT_CONFIGURED (\`verify.ts:20-22\`). Toạ độ công ty cố ý không seed, admin nhập khi go-live (\`docs/2026-10-18-launch-review/impl/refseed.md:87\`).
  - Vì vậy phần lương tính theo giờ công thật cũng chưa kiểm.

## Chưa kiểm chứng

- Tin gửi khách (ZNS/OA, thông báo trong app) sau khi admin khoá tài khoản, hoàn tiền, xuất hoá đơn, từ chối bài.
- Rút tiền vượt 2.000.000đ để thấy khấu trừ thuế TNCN 10%. U5-20 chỉ rút 56.960đ, \`taxWithheld\` = 0. Chưa thử rút về Ví Tubu.
- Báo cáo doanh thu nhiều ngày và đơn đặt sát nửa đêm giờ Việt Nam. U5-44 chỉ thử hôm nay.
- Cấp vai trò STAFF kèm nhóm quyền, cấp ADMIN (có hộp xác nhận riêng), cấp DEALER kèm hạng.
- Các file kế toán xuất: \`reports/order-items/export\`, \`exports/tax\`, \`exports/payouts\`, \`exports/refunds\`.
- Thêm/sửa/xoá ở các tab chỉ đọc qua ma trận: FAQ, Academy, Content Kit, nhãn hàng, gian hàng, đối tác, nhiệm vụ, giá đại lý, hoa hồng.
- Web admin ở khổ điện thoại (ca này chỉ chạy 1440).

## Dữ liệu để lại trong DB lane 5

\`lane-down.sh 5\` chạy không có \`--drop\`, nên DB \`tubutree_uat_l5\` vẫn còn sau ca:
- Các đơn thử và đơn sỉ của uat_dealer, cùng sổ công nợ (gồm các lần ghi nhận đã trả 1.000.000đ).
- Lô thẻ UATL5986 (5 mã).
- Bài cộng đồng "UAT U5-5x".
- Ca làm ngày 2026-10-21 của uat_staff, đã duyệt.
- Đơn TUBU2026101934527 vẫn ở hàng đợi Cần xử lý Pancake (sinh ra từ ca trả một phần U5-15).

Cấu hình đã trả về như cũ: \`loyalty.max_redeem_pct\` 0.2, \`affiliate.min_withdraw_bank\` 50000. uat_ctv_pending đã mở khoá, uat_brand về lại CUSTOMER.
`;
}
