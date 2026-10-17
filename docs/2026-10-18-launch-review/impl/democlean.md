# Gói democlean: dữ liệu demo do migration nạp vào mọi DB mới (P0)

Nhánh `lr/democlean`, worktree `.claude/worktrees/lr-democlean`. Kiểm chứng trên Postgres throwaway cổng 5565, DB `tubutree_it`. Phát hiện do điều phối viên nêu, chưa có ID trong D1–D7; báo cáo gọi là **P0-DEMO**.

## 1. Đã làm gì

**P0-DEMO.** Migration `20260616000000_demo_catalog_multibrand` chạy ở mọi lần `migrate deploy` đầu tiên, kể cả PROD. Không sửa migration cũ (lệch checksum). Thay vào đó có bốn phần:

| Phần | File chính |
|---|---|
| Danh sách chính xác id demo, chép từ file migration; spec đọc lại file migration và so từng dòng | `apps/api/src/config/demo-data/demo-catalog.ts`, `demo-catalog.spec.ts` |
| Script `prisma:cleanup-demo`: mặc định xem trước trong transaction READ ONLY; `--apply` tắt SP và biến thể (isActive=false, không xoá) trong một transaction; mã chỉ đổi khi có `--coupons=expire` (tắt + cắt `endAt` về lúc chạy), `--keep-coupon=WELCOME30` giữ mã được duyệt; từ chối (thoát 2) khi DB không có dòng demo nào hoặc tham số lạ; đòi `DATABASE_URL` trước khi nạp Prisma | `apps/api/src/config/demo-data/cleanup.ts`, `apps/api/prisma/cleanup-demo-data.ts`, `apps/api/package.json` |
| Go-live check: `db.demo_products` (SP/biến thể demo còn bán), `db.demo_coupons` (mã demo còn hạn). FAIL sau deploy, WARN ở `--phase=pre-deploy` (dọn là một bước trong cửa sổ). `GO_LIVE_ACCEPT_DEMO_COUPONS=WELCOME30` hạ mã được duyệt xuống WARN. Đăng ký bằng 5 dòng ở `db-checks.ts`, `collect.ts`; còn lại ở file mới | `apps/api/src/config/go-live/demo-data-checks.ts` |
| Runbook: bước 7b (sau migrate, API còn dừng): xem trước → chủ shop quyết về mã → `--apply`; bước 4 và 10 nêu hai dòng kiểm mới; một dòng ở checklist phát hành | `docs/launch/deploy-rollback-runbook.md`, `docs/2026-10-review/99-release-readiness.md` |

Cách nhận diện (không đoán theo mẫu tên):
- Sản phẩm, biến thể: `pancakeId` nằm trong đúng 44 + 48 giá trị của migration. pancakeId là cột unique và không bao giờ là mã Pancake thật. Seed (`prisma/seed.ts:919,933`) sinh cùng pancakeId nhưng id biến thể là cuid khác nhau mỗi lần, nên khớp theo pancakeId đúng cho cả DB từng seed. Biến thể khác nằm dưới SP demo (thêm sau) cũng bị tắt, vì giờ vàng chỉ lọc `variation.isActive` (`flash-sale.service.ts:142-147`).
- Mã: chỉ coi là demo khi cả id lẫn mã khớp dòng migration (migration bỏ qua khi mã đã có, nên trùng mã chưa chắc là dòng của nó). Trùng mã mà id khác: script không đụng, go-live chỉ WARN.
- Danh mục, nhãn: giữ nguyên, chỉ báo (danh mục nào sẽ trống, nhãn có công khai không).

Vì sao tắt là đủ: mọi nơi khách thấy hoặc đặt hàng đều lọc `isActive`: catalog/tìm kiếm/gợi ý/danh mục/nhãn trang chủ (`PUBLIC_PRODUCT_WHERE`, `catalog/public-product.ts:11`), PDP (`catalog.service.ts:265`), sitemap (gọi catalog list, `apps/web/src/app/sitemap.ts:27`), gian hàng (`storefront.service.ts:294`), trang nhãn (`brand.service.ts:104`), giờ vàng (`flash-sale.service.ts:107,145`), giỏ/checkout/đại lý/định kỳ/CTV (`SELLABLE_VARIATION_WHERE`, `cart/sellable.ts:13`). `pancakeHold` để NULL = "admin tắt": đồng bộ Pancake không tự bật lại (`pancake-sync.service.ts:311-321`, `holdPatch`). Mã: `isActive=false` chặn áp mã và ví (`coupons.service.ts:67`, `loyalty.service.ts:699`); cắt thêm `endAt` vì trang nhãn chỉ xét hạn (`brand.service.ts:253-262,275-283`).

## 2. Kiểm chứng

```
# unit (api)
npx jest src/config/demo-data src/config/go-live
Tests:       302 passed, 302 total

# race, Postgres thật 5565/tubutree_it, sau migrate deploy (186 migration)
npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/demo-cleanup.race-spec.ts
  ✓ trước khi dọn: hàng demo hiện và đặt được ở mọi nơi (fixture có nghĩa)
  ✓ xem trước: đúng số dòng của migration, nêu dòng tham chiếu, không ghi gì
  ✓ --apply (mặc định giữ mã): tắt 44 SP + 48 biến thể, không xoá dòng nào, dòng tham chiếu còn nguyên
  ✓ sau khi tắt: catalog, tìm kiếm, PDP, danh mục, nhãn, gian hàng, giờ vàng, giỏ/checkout đều không còn hàng demo
  ✓ chạy lại: không lỗi, không đổi gì
  ✓ --coupons=expire --keep-coupon=WELCOME30: tắt hai mã còn lại, WELCOME30 vẫn dùng được; go-live FAIL tới khi chấp nhận giữ
  ✓ --coupons=expire: tắt và cắt hạn mã còn lại của migration, khách không dùng được nữa, chạy lại không đổi
  ✓ DB không có dòng demo nào: kế hoạch báo không có, hasDemoData=false (điều kiện CLI và --apply dùng để từ chối)
  ✓ CLI: xem trước và --apply qua tsx đều thoát 0 trên DB đã dọn; tham số sai thoát 2
Tests:       9 passed, 9 total   (chạy 3 lần trên cùng DB, lần nào cũng xanh; afterAll trả DB về đúng trạng thái sau migrate)

npx tsc --noEmit -p tsconfig.json          # sạch (cả race spec, qua tsconfig tạm)
npx eslint <các file đã sửa> --max-warnings=0   # sạch
```

Fixture của race spec: một đơn DELIVERED có dòng biến thể demo, giỏ, đánh giá, yêu thích, gian hàng đã đăng có SP demo, đợt giờ vàng đang chạy có biến thể demo. Spec gọi service thật (CatalogService list/suggest/getBySlug/categories/brands, StorefrontService.getPublicBySlug, FlashSaleService.listActive, assertVariationsSellable, CouponsService.validateAndCompute) và `collectDbSnapshot` thật của go-live.

Chạy tay CLI và go-live check thật trên DB throwaway:

```
[FAIL] db.demo_products  Sản phẩm demo của migration: 44 sản phẩm, 48 biến thể demo đang bán (...)
[FAIL] db.demo_coupons   Mã giảm giá demo của migration: còn dùng được, chủ dự án chưa duyệt: FREESHIP (hạn 2026-12-31), WELCOME30 (...), XANH10 (...)
$ pnpm run prisma:cleanup-demo -- --apply
Đã tắt 44 sản phẩm, 48 biến thể; đã tắt 0 mã giảm giá. ...
$ pnpm run prisma:cleanup-demo -- --apply           # chạy lại
1. Sản phẩm demo: tìm thấy 44/44, đang bán 0 → không cần đổi
$ pnpm run prisma:cleanup-demo -- --apply --coupons=expire
Đã tắt 0 sản phẩm, 0 biến thể; đã tắt 3 mã giảm giá. ...
[PASS] db.demo_products  Sản phẩm demo của migration: 44 sản phẩm demo đều đã tắt
[PASS] db.demo_coupons   Mã giảm giá demo của migration: không mã demo nào còn dùng được
```

**Sự cố trong lúc làm (đã sửa, không ghi gì):** khi thử nhánh "thiếu DATABASE_URL" bằng `env -u DATABASE_URL`, bản đầu của CLI vẫn nối vào DB dev `localhost:5434/tubutree`, vì `@prisma/client` lúc import tự đổ `apps/api/.env` vào `process.env`. Lượt đó là xem trước: transaction `SET TRANSACTION READ ONLY` mở trước mọi truy vấn, và nó dừng ở lỗi P2021 (thiếu bảng) trước khi đọc xong; không có lệnh ghi nào. Đã sửa: CLI đọc `DATABASE_URL` trước khi nạp Prisma (import động) và truyền thẳng `datasourceUrl`; kiểm lại bằng một `.env` tạm trỏ DB throwaway: thoát 2 "Chưa đặt DATABASE_URL". Lưu ý chung: `go-live:check` và các script khác dùng `new PrismaClient()` cũng sẽ đọc `apps/api/.env` khi thiếu biến (đã ghi trong tài liệu của chúng; không đổi ở gói này).

## 3. Mọi dữ liệu migration nạp vào DB mới

Đếm mọi bảng sau `migrate deploy` trên DB rỗng: chỉ 7 bảng có dòng.

| Bảng | Dòng | Migration | Phân loại |
|---|---|---|---|
| `products` | 44 (ảnh picsum bị `20260703010000` xoá, `brandId` do `20260626020000` gắn) | `20260616000000` | **Demo cần dọn**: script tắt |
| `variations` | 48, tổng tồn 6.610 | `20260616000000` | **Demo cần dọn**: script tắt |
| `coupons` | 3: WELCOME30, FREESHIP, XANH10, PUBLIC, hạn 2026-12-31 | `20260616000000` | **Demo, chủ dự án quyết** giữ hay tắt (Q1) |
| `categories` | 7: cat-baby, cat-cleaning, cat-coffee, cat-food, cat-mom, cat-personal, cat-skincare | `20260616000000` | **Cần xác nhận** (Q5). Sau khi tắt SP demo cả 7 trống; đồng bộ Pancake không ghi `categoryIds` (`catalog.service.ts:440`), miniapp tự ẩn danh mục trống |
| `brands` | 8, `isPublished=false`, id = md5(tên) | `20260626020000_brand_backfill` (từ tên nhãn SP demo) | **Cần xác nhận** (Q4). Có thể là nhãn thật (Fuwa3e còn xuất hiện trong kho gomdon). Chưa công khai nên khách không thấy |
| `notification_templates` | 72, kênh INAPP, không `zaloTemplateId`, không chứa SĐT/URL/email (đã truy vấn) | nhiều migration | **An toàn** |
| `system_configs` | 50 | nhiều migration | Chia nhóm dưới đây |

`system_configs` (50 khoá):
- **Cần chủ dự án xác nhận, thông tin thật (5):** `payment.bank_bin` 970407, `payment.bank_account_no` 9984606774, `payment.bank_account_name` "CONG TY TUBU TREE", `payment.bank_name` Techcombank (`20260625070000`; go-live đã WARN `db.bank_account` khi còn số này) (Q2). `shipping.gomdon.config.defaultWarehouse` = "Fuwa3e Tubu HCM", "Golf Park, 1 đường số 2", P. Long Bình, TP Thủ Đức, 0965573541 (`20260926100000`) (Q3).
- **Cần chủ dự án xác nhận, số kinh doanh tự phát tiền (15).** Đều bằng giá trị mặc định trong mã, nên cron vẫn chạy với số đó kể cả khi không có dòng: `voucher.welcome_amount` 30.000 + `voucher.welcome_min_order` 199.000 (cron mỗi giờ tặng mã cho mọi khách mới, `vouchers.service.ts:157-163`), `voucher.birthday_amount` 50.000, `voucher.winback_amount` 50.000 / `voucher.winback_days` 60, `voucher.milestones` (1 triệu→30.000, 3 triệu→100.000, 5 triệu→200.000) (`20261010150000`); `merchant.commission_pct` 0,15, `merchant.default_shipping_fee` 30.000, `merchant.settlement_hold_days` 7, `affiliate.pit_withhold_pct` 0,1 / `affiliate.pit_withhold_threshold` 2.000.000 (kế toán xác nhận) (`20261014011009`); `groupbuy.discount_pct` 15 / `target_size` 3 / `window_hours` 48 (`20260624050000`); `returns.window_days` 7 (`20260926100000`) (Q6).
- **An toàn, ngưỡng vận hành/kỹ thuật (25):** `ops.alert_*` (6), `flashsale.max_discount_pct` 0,9, `flashsale.max_duration_days` 31, `beta.features` [], `storefront.identifier_cooldown_days` 90, `dealer.reward_claim_grace_days` 30, `orders.dealer_pending_payment_ttl_hours` 72, `merchant.confirm_sla_hours` 24, `merchant.ship_sla_hours` 48, `merchant.deliver_sla_days` 7, `merchant.negative_payout_due_days` 7, `merchant.consignment_settle_from` (= lúc chạy migration, đúng ý), `shipping.eta_min_days`/`eta_max_days` null, `shipping.gomdon.recycling_enabled` false, `game.*` (5).
- **Ngoài phạm vi (đổi rác, phiên khác) (5):** `refill.seeds_per_bottle` 50, `refill.monthly_cap_bottles` 20, `refill.pickup_address`/`pickup_hours`/`pickup_phone` rỗng.

INSERT chạy trên DB mới nhưng ra 0 dòng (backfill từ user/đơn/SP/gian hàng có sẵn, không phải demo): `wallet_transactions` (`20261010041004`), `xu_points_conversions`/`points_transactions`/`coin_transactions` (`20261012110000`), `notification_logs` (`20261012160000`), `user_admin_events` (`20261014150100`), `merchant_pancake_links` (`20261014160000`), `storefront_terms_history` (`20261014180200`), `refill_pickup_locations` (`20261015070000`, chỉ khi `refill.pickup_address` khác rỗng). Không migration nào tạo user, beta tester, CTV, gian hàng, đơn hay đánh giá.

## 4. Chưa làm hoặc cố ý để lại

- **SKU demo vẫn giữ chỗ trong cột unique `variations.sku`** (vd `FUWA-DW-1L`, `POLANG-SP-300`). Nếu Pancake có biến thể thật cùng SKU, đồng bộ tạo biến thể (`pancake-sync.service.ts:411-434`, `sku: v.sku ?? v.id`) sẽ vấp unique và SP đó không đồng bộ được. Tắt không giải phóng SKU. Chưa kiểm được vì không có dữ liệu Pancake thật. Cách sửa nếu xảy ra: đổi SKU demo thành `DEMO-<sku>` (dòng đơn không lưu SKU; vẫn cần chủ dự án đồng ý vì nhập "đã bán ngoài sàn" theo SKU, `catalog.service.ts:586`). Không làm vì nằm ngoài "chỉ tắt".
- **Trang nhãn bỏ qua `Coupon.isActive`** (`brand.service.ts:253-262` gắn mã vào khuyến mãi, `:275-283` nút chép mã chỉ xét hạn và lượt): mã bị admin tắt bằng nút trong Quản trị vẫn hiện "chạm để chép" trên trang nhãn, rồi khách dán vào thanh toán thì bị từ chối. P2. Script đã cắt cả `endAt` nên mã demo không bị. Không sửa vì là lỗi chung, ngoài gói.
- Biến thể demo mang pancakeId `seed-...`, mà `SELLABLE_PANCAKE_VARIATION_WHERE` chỉ loại tiền tố `MCH_` (`cart/sellable.ts:40-45`, `pancake-fulfilment.ts:4`): trước khi dọn, đơn đại lý/định kỳ/CTV trên hàng demo sẽ đẩy mã giả sang Pancake. Dọn xong thì hết đường này; không thêm tiền tố `seed-` vào bộ lọc vì tắt là đủ.
- Lượt quét toàn bộ của đồng bộ Pancake có thể tự tắt hàng demo (`pancake-sync.service.ts:274-310`) nhưng chỉ khi số "biến mất" ≤ 50% (`MAX_REMOVED_RATIO`), nên DB ít hàng thật sẽ không tự tắt. Không dựa vào đó.
- Danh mục và nhãn demo giữ nguyên (đúng yêu cầu). Sản phẩm demo không có nút bật lại trong Quản trị; runbook nêu: gọi tech lead hoặc khôi phục backup bước 6.
- Ca "DB không có demo" ở mức CLI/`--apply` được kiểm qua `hasDemoData` trong một transaction rollback, chưa kiểm bằng một DB rỗng riêng (cần dựng đủ ~20 bảng mà kế hoạch đọc).

## 5. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

- **Q1. Ba mã WELCOME30 / FREESHIP / XANH10: giữ mã nào?** Mặc định của script: giữ nguyên cả ba, in cảnh báo; go-live FAIL `db.demo_coupons` cho tới khi quyết. Khuyên tắt cả ba (`--coupons=expire`): WELCOME30 trùng mã chào mừng hệ thống tự tặng mỗi khách mới (30.000đ cho đơn từ 199.000đ), giữ cả hai thì khách mới được giảm chào mừng hai lần; FREESHIP không giới hạn tổng lượt. Muốn giữ WELCOME30: `--coupons=expire --keep-coupon=WELCOME30` rồi go-live với `GO_LIVE_ACCEPT_DEMO_COUPONS=WELCOME30`.
- **Q2. Tài khoản 9984606774 Techcombank "CONG TY TUBU TREE" có phải tài khoản thật nhận tiền chuyển khoản?** Mặc định: giữ (go-live đã WARN). Sai thì sửa ở Quản trị, Cấu hình, nhóm payment trước khi mở bán.
- **Q3. Kho lấy hàng gomdon "Fuwa3e Tubu HCM", Golf Park 1 đường số 2, P. Long Bình, TP Thủ Đức, 0965573541 có đúng?** Mặc định: giữ.
- **Q4. Tám nhãn BH.Nong, Cobote, Fuwa3e, Hector, Le Plateau Coffee, Pơ Lang, Sokfram, Visante có phải nhãn Tubu Tree phân phối thật?** Mặc định: giữ, chưa công khai.
- **Q5. Bảy danh mục demo: giữ để gán hàng thật, hay bỏ?** Mặc định: giữ; sau khi dọn đều trống và miniapp tự ẩn.
- **Q6. Các số kinh doanh tự phát tiền ở mục 3** (mã chào mừng, sinh nhật, quay lại, mốc chi tiêu, hoa hồng đối tác 15%, mua chung 15%, khấu trừ TNCN 10% từ 2 triệu, đổi trả 7 ngày): xác nhận hoặc sửa ở Quản trị, Cấu hình. Mặc định: giữ (bằng mặc định trong mã).
