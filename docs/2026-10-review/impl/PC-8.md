# PC-8 — Admin web + seed/config

## Mục 1/2 — C-053, C-054, C-032 (seed/config/NS-1)

| Mục | Trạng thái | Commit |
| --- | --- | --- |
| C-053 seed đủ mẫu thông báo, mã giảm giá sinh nhật, lời ORDER_DELIVERED/WELCOME | XONG (phần ZNS cần Zalo duyệt mẫu: xem "Chưa làm") | f3ffcf8, a0e96fa |
| C-054 khoá config chết, lệch khoá voucher chào mừng, hệ số Ví 1,5 | XONG (xoá vật lý dòng chết trên prod để PD-2) | e2c2876, a0e96fa, 61d054a |
| C-032 NS-1 (% khách có đơn thứ 2 trong 30 ngày) tính trong aggregation + hiện trên dashboard | XONG | 557bfbb, 61d054a |

### C-053
- `seed.ts` có đủ 8 mẫu từng thiếu: ACCOUNT_DELETION_REQUESTED, DEALER_CREDIT_PAYMENT_CONFIRMED, DEALER_CREDIT_PAYMENT_REPORTED,
  FLASH_STARTING, POINTS_EXPIRING, RETURN_APPROVED_NO_REFUND, STOREFRONT_TRENDING_PRODUCTS, SUBSCRIPTION_ORDER_FAILED.
  `REFILL_APPROVED/REJECTED` không cần mẫu (ghi `notificationLog` trực tiếp).
- Mã giảm giá sinh nhật: `membership_tiers.birthdayVoucherAmount` LOC_BIEC 50.000, DAI_THU 150.000, CO_THU 300.000 (chỉ điền chỗ còn NULL).
- ORDER_DELIVERED: `'Đơn {{order_code}} đã giao thành công.{{points_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿'`. `points_note` do
  `order-status.service.ts` gắn chỉ khi chuyển sang DELIVERED và `pointsEarned > 0`; mẫu cũ hứa điểm cho cả đơn không có điểm.
- WELCOME_VOUCHER: `'... mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng trước {{expires}} 🎁'`. `min_order_note` do `vouchers.service.ts#grant`
  gắn khi voucher có đơn tối thiểu (bản cũ không nói điều kiện).
- Hai file service trên nằm ngoài nhóm file của gói, chỉ sửa tối thiểu (build biến cho mẫu).
- Prod KHÔNG chạy `prisma db seed` (chạy lại sẽ đè giá, hạng, config không `createOnly`), nên dữ liệu tham chiếu lên prod bằng migration
  idempotent `20261010150000_reference_data_templates_voucher_eta`: INSERT 8 mẫu `ON CONFLICT DO NOTHING`; UPDATE lời ORDER_DELIVERED/WELCOME_VOUCHER
  chỉ khi nội dung còn đúng bản seed cũ (admin đã sửa thì giữ); điền `birthdayVoucherAmount` chỗ NULL; INSERT khoá `voucher.*`, `shipping.eta_*`.

### C-054
- `system-config/dead-config-keys.ts`: danh sách 24 khoá chết kèm lý do (22 khoá audit + 2 hệ số ví `affiliate|cashback.tubu_wallet_multiplier`).
  - `validateAdminConfigValue` từ chối ghi: 400 `"<key>": khoá này không còn được hệ thống đọc nên sửa sẽ không có tác dụng. <lý do>`.
  - `GET /admin/config` (không lọc category) trả thêm `deprecated: true/false`. UI hiện nhãn "Không dùng", khoá ô nhập, ẩn nút Lưu.
  - Seed bỏ 24 khoá này; dòng đã có trên prod còn nguyên, chỉ bị đánh dấu.
- Lệch khoá voucher chào mừng: code đọc `voucher.welcome_*` còn seed cũ ghi `loyalty.welcome_voucher_*` (không ai đọc). Seed nay có `voucher.welcome_amount` 30.000,
  `welcome_min_order` 199.000, `birthday_amount` 50.000, `winback_days` 60, `winback_amount` 50.000, `milestones` (1tr→30k, 3tr→100k, 5tr→200k), tất cả `createOnly`.
- Hệ số Ví x1,5: không code nào đọc. `GET /system-config/public` trả `affiliateWalletMultiplier: 1` cố định (giữ trường cho miniapp cũ), bỏ đọc DB.
- ETA giao hàng: `shipping.eta_min_days/eta_max_days` seed là JSON null (`createOnly`) để miniapp ẩn dòng ETA đến khi admin nhập số.
  `SystemConfigService.set` trước đây chặn đổi kiểu và `typeof null === 'object'`, nên admin không đặt được giá trị đầu. Sửa: bỏ kiểm kiểu khi giá trị cũ là null,
  `oldValue` lịch sử ghi `Prisma.JsonNull`.
- `dead-config-keys.spec.ts` quét mã nguồn (đã bỏ comment): khoá chết không có chỗ đọc; mọi khoá seed phải có chỗ đọc; không khoá chết nào được seed.

### C-032 NS-1
- Định nghĩa: cohort = khách có đơn hợp lệ ĐẦU TIÊN (RETAIL, không CANCELLED/RETURNED) rơi vào ngày VN D−30; lặp = có đơn hợp lệ thứ 2 trong
  [đơn đầu, đơn đầu + 30 ngày], gồm cả đơn cùng ngày. Khoá khách: `endCustomerKey` (đơn lên hộ) > SĐT chuẩn hoá > userId, nên hai tài khoản cùng SĐT là một khách.
- Dòng snapshot ngày D lưu SỐ ĐẾM `ns1CohortSize`, `ns1RepeatCount` (không lưu %), để dashboard gộp đúng theo số khách thay vì trung bình các tỉ lệ ngày.
- Truy vấn nhẹ: cohort chỉ một ngày, cửa sổ `[đầu ngày D−30, +31 ngày)` theo `createdAt`, không bọc cột trong hàm, không window function.
  EXPLAIN trên 250k đơn / 60k user (rollback sau khi đo): cohort-day `Bitmap Index Scan on orders_status_createdAt_idx` ~10 ms; đơn theo user `orders_userId_status_idx`
  5,7 ms cho 40 user; đơn lên hộ index riêng `orders_end_customer_key_proxy_idx` 1,7 ms.
- NS-1 là truy vấn phụ: lỗi thì log + giữ nguyên snapshot ngày, bỏ hai cột NS-1. `backfillNs1(date)` chỉ `updateMany` dòng còn NULL, KHÔNG tạo dòng
  (cron `data-retention` xoá raw event theo ngày đã có snapshot, tạo dòng ma sẽ làm mất dữ liệu). Script: `apps/api/scripts/backfill-ns1.ts`.
- Web: `components/admin/ns1-card.tsx` (`summarizeNs1` gộp theo số đếm, bỏ dòng null; thẻ hiện `42,9%`, `3/7 khách`, cảnh báo "Mẫu còn nhỏ" khi cohort < 30,
  "—" + giải thích khi chưa có dữ liệu) đặt đầu `analytics-tab.tsx`. `components/admin/config-item.tsx` tách khỏi `page.tsx` (diff `page.tsx` chỉ xoá khối cũ + 1 import).
  Nút Lưu và ô nhập cao tối thiểu 44px, `min-w-0` trên ô nhập để không tràn ở 390px.

### Test (đỏ→xanh)
- Spec đơn vị viết cùng lúc/trước code; lượt đỏ đã xác nhận riêng cho NS-1, null→số của `SystemConfigService.set` và hai spec web (lỗi import khi chưa có component). Các spec còn lại chạy xanh sau khi code xong (lượt đỏ riêng không ghi lại):
  - `notification-templates-seed.spec.ts` (mới): 8 mã thiếu, mọi mã truyền vào `.notify(` phải có mẫu seed, id/mã không trùng, render thật `NotificationsService` cho DELIVERED/WELCOME.
  - `order-status.service.spec.ts` +3 (`points_note`), `vouchers.service.spec.ts` +3 (`min_order_note`).
  - `dead-config-keys.spec.ts` (mới), `admin-config-rules.spec.ts`, `admin-recycling-config.spec.ts`, `system-config.controller.spec.ts`.
  - `system-config.service.spec.ts`: null→số được set (đỏ vì `typeof null` bị coi là đổi kiểu), chuỗi vẫn bị chặn.
  - `analytics-aggregation.service.spec.ts`: NS-1 6 test + `backfillNs1` 2 test (cohort/lặp/khách cũ/biên 30 ngày/cùng SĐT/đơn lên hộ/cohort rỗng/hình dạng truy vấn).
  - Web: `ns1-card.spec.tsx` 5, `config-item.spec.tsx` 4 (đỏ khi chưa có component: lỗi import).
- Viết SAU code (không có lượt đỏ riêng): 3 race spec trên Postgres thật `retention-ns1.race-spec.ts` (3), `system-config-unset-key.race-spec.ts` (3).

### Lệnh kiểm chứng (kết quả thật)
- `cd apps/api && npx jest src/modules/analytics src/modules/system-config src/modules/admin src/modules/notifications src/modules/vouchers src/modules/orders/order-status.service.spec.ts`
  -> `Test Suites: 18 passed, 18 total` / `Tests: 348 passed, 348 total`.
- `cd apps/api && npx tsc --noEmit -p tsconfig.json` -> exit 0 (tsconfig gồm `prisma/**`).
- Race trên Postgres thật (container `tubu_it_pc8`, DB `tubutree_it`, `npx jest -c test/integration-race/jest.config.js --runInBand retention-ns1 system-config-unset-key retention-snapshot`)
  -> `Test Suites: 3 passed, 3 total` / `Tests: 10 passed, 10 total`.
- `npx prisma migrate status` -> `117 migrations found in prisma/migrations` / `Database schema is up to date!`; `prisma migrate diff` không lệch schema.
- Migration chạy lại lần 2 trên DB riêng: mọi INSERT `0 0`, UPDATE `0`; giá trị admin sửa tay không bị ghi đè. `npx tsx prisma/seed.ts` trọn gói chạy được, `createOnly` giữ giá trị đã sửa.
- `cd apps/web && npx vitest run src/components/admin src/lib/admin-helpers.spec.ts` -> 8 file `src/components/admin` 72 test xanh; `admin-helpers.spec.ts` 32 xanh.
- `cd apps/web && npx tsc --noEmit` -> exit 0. `npx eslint` trên 7 file web đã sửa -> exit 0 (0 lỗi, 0 cảnh báo).
- Chưa chạy Playwright (quy định RAM máy, và gói này chỉ sửa admin web, không đụng miniapp nên không có lỗi tubu-ds để đối chiếu).

### Migration
- `20261010150000_reference_data_templates_voucher_eta` (dữ liệu tham chiếu, idempotent, không đổi schema).
- `20261010160000_retention_ns1_columns` (`ALTER TABLE "retention_daily_snapshot" ADD COLUMN "ns1CohortSize" INTEGER, ADD COLUMN "ns1RepeatCount" INTEGER`; cột nullable, không khoá bảng lâu).
- Runbook deploy: chạy `prisma migrate deploy`, rồi chạy MỘT lần `npx tsx scripts/backfill-ns1.ts` để điền NS-1 cho các ngày đã có snapshot.

### Giả định
- NS-1 tính mọi trạng thái khác CANCELLED/RETURNED (đúng định nghĩa "đơn hợp lệ" sẵn có của analytics), không riêng DELIVERED.
- Trạng thái đơn lấy tại lúc tính: đơn bị huỷ/trả về sau ngày tính không được cập nhật vào số đã lưu.
- Dashboard gộp NS-1 qua các ngày đang hiển thị (30 dòng gần nhất), theo số đếm.
- `affiliateWalletMultiplier` giữ trường, cố định 1, cho miniapp cũ (audit đề nghị bỏ hẳn; bỏ trường là việc khi hết bản miniapp cũ).
- Giá trị voucher chào mừng trên prod KHÔNG sao từ `loyalty.welcome_voucher_*` cũ vì khoá đó chưa từng có tác dụng; dùng mặc định 30.000/199.000 (admin sửa được ở khoá `voucher.*`).
- Biến `value` trong thông báo voucher vẫn là chuỗi thô ("30000"), chỉ `min_order_note` được định dạng, để không đổi hành vi các mẫu khác.

### Chưa làm / giao người khác
- ORDER_CONFIRMED/ORDER_SHIPPING (ZNS) chưa có `zaloTemplateId`: cần user xin Zalo duyệt mẫu, code không làm thay được.
- Lời "voucher" ở các mẫu khác để PC-9/PD-2.
- Dòng config chết vẫn nằm trong DB prod (có nhãn deprecated); xoá vật lý để PD-2.
- Nút mở lại claim Q-09 và C-092/C-094/C-122 do các lượt khác trong gói PC-8 làm.
