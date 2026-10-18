# Gói config-2: giá trị cấu hình chủ dự án đã chốt (2026-10-18)

Nhánh `lr2/config`. Mỗi mục: đã đổi gì, ở đâu.

| Mục | Đổi | Nơi đổi |
|---|---|---|
| A6 tài khoản | `payment.bank_account_no` 8386790906, `payment.bank_account_name` "CONG TY TNHH TUBU TREE", `payment.bank_name` "Ngân hàng TMCP Kỹ Thương Việt Nam"; `payment.bank_bin` 970407 (Techcombank) giữ nguyên | migration `20261018200000_launch_owner_config` (chỉ UPDATE dòng còn giá trị mẫu cũ), `prisma/seed.ts`, fixture web. Go-live `db.bank_account` chỉ WARN khi số còn là 9984606774; thiếu khoá vẫn FAIL |
| A4 mã demo | Giữ WELCOME30, FREESHIP, XANH10 | `demo-data-checks.ts`: ba mã luôn tính là đã duyệt (WARN, không FAIL), mã demo khác vẫn FAIL. Runbook 7c: lệnh (c), không `--coupons=expire` |
| A5 sản phẩm demo | Xác nhận đường dọn tắt 44 sản phẩm, 48 biến thể, giữ danh mục | `config/demo-data/cleanup.ts` chỉ `UPDATE products/variations SET isActive=false`, đổi SKU `DEMO-`, không đụng bảng `categories` (chỉ báo danh mục trống). Hướng dẫn đồng bộ Pancake: runbook 1.6.1 |
| B2 | `affiliate.hold_days` 10 | `affiliate.service.ts`, `seed.ts` (reference nạp từ seed), tài liệu sổ tay |
| B3 | `storefront.require_approval` mặc định true | `storefront-config.ts`, `reference-data/config-selection.ts` |
| B5 | freeship đơn đầu bật, từ 199.000đ | `pricing.service.ts` (hai hằng mặc định), `public-config.ts`, migration (UPDATE khi còn false/0). Cộng dồn với mã khách mới: có (đơn đầu vừa giảm tiền hàng vừa miễn phí giao kiện Tubu); mã FREESHIP không bị tiêu cho đơn đó |
| B13, B14 | `home.new_customer_layout` true; `community.public_preview` true | `public-config.ts`, `community-public-preview.ts` (hằng `PUBLIC_PREVIEW_DEFAULT`), `community-feed.service.ts`, `config-selection.ts` |
| B19 | `coupon.staff_max_percent` 30, `staff_max_amount_vnd` 100.000, `staff_daily_budget_vnd` 10.000.000, `staff_max_usage` 1.000 giữ | `admin/coupon-input-rules.ts`, `seed.ts`. Khoảng cho phép của validator không đổi (đủ rộng) |
| Gomdon | SĐT kho 0899149229, địa chỉ giữ nguyên | migration (`jsonb_set` chỉ khi còn 0965573541), `gomdon-config.ts`, `seed.ts`, tài liệu |
| API_CPUS | khuyến nghị `API_CPUS=2` (VPS từ 8 vCPU) | `.env.production.example`, `docker-compose.vietnix.yml` (comment), runbook, `impl/infra.md` |
| A11, A12, B4, Bộ Công Thương | tài liệu | runbook mục 1.6.2 đến 1.6.5, `tools/backup/README.md` (mục Google Drive, bỏ ví dụ chỉ R2), `ops/crontab.backup.example`, `03-cau-hoi-sang.md` |

Hàng cấu hình đã có trong DB (đã chạy reference seed) với giá trị cũ của hold_days, cờ bố cục, cờ xem trước, duyệt gian hàng, trần nhân viên KHÔNG bị migration đổi (không phân biệt được "mặc định cũ" với "admin cố ý đặt"); `seed-reference` dùng `skipDuplicates` nên cũng không ghi đè. PROD chưa chạy reference seed nên các dòng này sẽ được tạo với giá trị mới. DB dev/UAT đã có dòng cũ thì đổi tay ở Quản trị, Cấu hình.

## Kiểm chứng

- Migration trên DB tạm (`postgres:16-alpine`, cổng 5561): `prisma migrate deploy` áp hết; truy vấn xác nhận `payment.*` đã mới, `shipping.first_order_free_enabled` = true, `min_subtotal` = 199000, SĐT kho = 0899149229; `prisma migrate diff --from-url ... --to-schema-datamodel ... --exit-code` = 0 (không lệch). Container đã gỡ.
- `apps/api`: `npx jest src/config src/modules/system-config prisma/reference-data src/modules/pricing src/modules/storefront src/modules/feed src/modules/admin src/modules/coupons src/modules/cart src/modules/affiliate src/modules/integrations/gomdon src/modules/integrations/payment src/modules/merchant/merchant-fulfilment`: 128 suite, 2975 test, đạt hết sau khi sửa `deploy-scripts.spec.ts` (tên remote cron mẫu) ở lượt cuối. `npx tsc --noEmit` apps/api và apps/web đạt.
- Web: `vitest run src/app/admin/page.spec.tsx src/components/admin/config-item.spec.tsx` (148 test) đạt; miniapp `home-blocks.spec.ts` đạt.

## Điểm mở

- Đồng bộ Pancake không gán danh mục (`categoryIds` rỗng): hàng thật không hiện trong trang danh mục, danh mục giữ lại bị Mini App ẩn cho tới khi có hàng; Quản trị chưa có màn gán cho hàng kho Tubu. Tạm gán bằng SQL (runbook 1.6.1). Gán tự động theo nhóm hàng Pancake là tính năng riêng, chưa làm.
- Đồng bộ ghi đè tên, mô tả, giá, ảnh mỗi lần: sửa trong Quản trị sẽ mất.
- Lần quét đầu bán ngay toàn bộ hàng của shop Pancake (đã duyệt, đang bán); cần soát và tắt tay món không muốn bán.
- Wildcard `*.tubutree.com` cần vhost Apache mới nạp SAU vhost `app.`/`api.`; chưa kiểm trên VPS (không có quyền).
- Chưa chạy bộ race (`reference-seed.race-spec.ts`); đã đọc: danh sách `extraKeys` khớp (không thêm, bớt khoá).
