# Gói democlean: dữ liệu demo do migration nạp vào mọi DB mới (P0)

Nhánh `lr/democlean`, worktree `.claude/worktrees/lr-democlean`. Kiểm chứng trên Postgres throwaway cổng 5565, DB `tubutree_it`. Phát hiện do điều phối viên nêu, chưa có ID trong D1–D7; báo cáo gọi là **P0-DEMO**.

## 1. Đã làm gì

**P0-DEMO.** Migration `20260616000000_demo_catalog_multibrand` chạy ở mọi lần `migrate deploy` đầu tiên, kể cả PROD. Không sửa migration cũ (lệch checksum). Thay vào đó có bốn phần:

| Phần | File chính |
|---|---|
| Danh sách chính xác id demo, chép từ file migration; spec đọc lại file migration và so từng dòng | `apps/api/src/config/demo-data/demo-catalog.ts`, `demo-catalog.spec.ts` |
| Script `prisma:cleanup-demo`: mặc định xem trước trong transaction READ ONLY; `--apply --expect-db=<tên DB>` (sai tên thì thoát 2) tắt SP và biến thể (isActive=false, không xoá), đổi 48 SKU demo thành `DEMO-<sku>`, trong một transaction; mã chỉ đổi khi có `--coupons=expire` (tắt + cắt `endAt` về lúc chạy), `--keep-coupon=WELCOME30` giữ mã được duyệt; cuối `--apply` in khối SQL hoàn tác đúng các dòng đã đổi; xem trước nêu tên SP demo bị sửa sau lúc nạp ("kiểm tay"); từ chối (thoát 2) khi DB không có dòng demo nào hoặc tham số lạ; đọc `DATABASE_URL` trước khi nạp Prisma (test khoá chuỗi import) | `apps/api/src/config/demo-data/cleanup.ts`, `apps/api/prisma/cleanup-demo-data.ts`, `apps/api/package.json` |
| Go-live check: `db.demo_products` (SP/biến thể demo còn bán), `db.demo_coupons` (mã demo còn hạn, của migration hay do seed tạo). FAIL sau deploy, WARN ở `--phase=pre-deploy` (dọn là một bước trong cửa sổ). `GO_LIVE_ACCEPT_DEMO_COUPONS=WELCOME30` hạ mã được duyệt xuống WARN; mã chỉ trùng tên (điều kiện khác) là WARN có nêu tên. Đăng ký bằng 5 dòng ở `db-checks.ts`, `collect.ts`; còn lại ở file mới | `apps/api/src/config/go-live/demo-data-checks.ts` |
| Runbook: bước 7c (sau 7b nạp tham chiếu, API còn dừng): xem trước → chủ shop quyết về mã → `--apply` (lưu bằng tee) → hoàn tác do tech lead; bước 4 và 10 nêu hai dòng kiểm mới; checklist phát hành: lần deploy PROD đầu theo runbook, không `deploy.sh` | `docs/launch/deploy-rollback-runbook.md`, `docs/2026-10-review/99-release-readiness.md` |
| Lọc hàng đã tắt ở các đường còn hở (vòng sửa): mua chung, giờ vàng sắp tới/đặt nhắc, cron nhắc giờ vàng và báo yêu thích, nhắc mua lại, mời đánh giá, giỏ bỏ quên, báo giảm giá, chip SP trên bài cộng đồng | `groupbuy.service.ts`, `flash-sale.service.ts`, `lifecycle.service.ts`, `review-invite.service.ts`, `remarketing.service.ts`, `community-feed.service.ts` |

Cách nhận diện (không đoán theo mẫu tên):
- Sản phẩm, biến thể: `pancakeId` nằm trong đúng 44 + 48 giá trị của migration. pancakeId là cột unique và không bao giờ là mã Pancake thật. Seed (`prisma/seed.ts:919,933`) sinh cùng pancakeId nhưng id biến thể là cuid khác nhau mỗi lần, nên khớp theo pancakeId đúng cho cả DB từng seed. Biến thể khác nằm dưới SP demo (thêm sau) cũng bị tắt, vì giờ vàng chỉ lọc `variation.isActive` (`flash-sale.service.ts:142-147`).
- Mã (`classifyDemoCoupon`, `demo-catalog.ts`): `migration` khi id khớp dòng migration; `seed` khi id khác nhưng mã và điều kiện (type, value, minOrder, maxDiscount, perUserLimit, scope PUBLIC) khớp bản demo, tức dòng `prisma db seed` tạo (`seed.ts:951-958`, cùng điều kiện, id cuid, hạn 2027-01-01); hai loại này là mã demo, `--coupons=expire` tắt, go-live sau deploy FAIL. `name-only` khi chỉ trùng tên: coi là mã thật, script không đụng, go-live WARN nêu tên. Test khoá điều kiện theo cả SQL migration lẫn `seed.ts`.
- Danh mục, nhãn: giữ nguyên, chỉ báo (danh mục nào sẽ trống, nhãn có công khai không).

Vì sao tắt là đủ: các nơi khách thấy hoặc đặt hàng lọc hàng đã tắt: catalog/tìm kiếm/gợi ý/"thường mua kèm"/AI tư vấn/danh mục/nhãn trang chủ (`PUBLIC_PRODUCT_WHERE`, `catalog/public-product.ts:11`), PDP (`catalog.service.ts:265`), sitemap (gọi catalog list, `apps/web/src/app/sitemap.ts:27`), gian hàng (`storefront.service.ts:294`), trang nhãn (`brand.service.ts:104`), yêu thích (`wishlist.service.ts:23`), giờ vàng (`flash-sale.service.ts:107,145`), giỏ/checkout/đại lý/định kỳ/CTV lên hộ (`SELLABLE_VARIATION_WHERE`, `cart/sellable.ts:13`; `affiliate.service.ts:527`), "đã mua" và mua lại từ đơn (`purchased-items.service.ts:81-83`, `orders.service.ts:479-482`). Vòng sửa thêm lọc ở các đường còn hở (mục 6, điểm 3). `pancakeHold` để NULL = "admin tắt": đồng bộ Pancake không tự bật lại (`pancake-sync.service.ts:311-321`, `holdPatch`). Mã: `isActive=false` chặn áp mã và ví (`coupons.service.ts:67`, `loyalty.service.ts:699`); cắt thêm `endAt` vì trang nhãn chỉ xét hạn (`brand.service.ts:253-262,275-283`).

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

- **Trang nhãn bỏ qua `Coupon.isActive`** (`brand.service.ts:253-262` gắn mã vào khuyến mãi, `:275-283` nút chép mã chỉ xét hạn và lượt): mã bị admin tắt bằng nút trong Quản trị vẫn hiện "chạm để chép" trên trang nhãn, rồi khách dán vào thanh toán thì bị từ chối. P2. Script đã cắt cả `endAt` nên mã demo không bị. Không sửa vì là lỗi chung, ngoài gói.
- Biến thể demo mang pancakeId `seed-...`, mà `SELLABLE_PANCAKE_VARIATION_WHERE` chỉ loại tiền tố `MCH_` (`cart/sellable.ts:40-45`, `pancake-fulfilment.ts:4`): trước khi dọn, đơn đại lý/định kỳ/CTV trên hàng demo sẽ đẩy mã giả sang Pancake. Dọn xong thì hết đường này; không thêm tiền tố `seed-` vào bộ lọc vì tắt là đủ.
- Lượt quét toàn bộ của đồng bộ Pancake có thể tự tắt hàng demo (`pancake-sync.service.ts:274-310`) nhưng chỉ khi số "biến mất" ≤ 50% (`MAX_REMOVED_RATIO`), nên DB ít hàng thật sẽ không tự tắt. Không dựa vào đó.
- Danh mục và nhãn demo giữ nguyên (đúng yêu cầu). Hoàn tác: khối SQL in cuối `--apply`, tech lead chạy (runbook 7c); không dùng backup bước 6 (có trước migration).
- **Đã biết, chưa sửa** (không ai mua được hàng demo qua đây; runbook 7c cũng ghi): ví mã còn liệt kê mã mua chung đã cấp cho SP demo (`loyalty.service.ts:713-720`, chỉ lấy tên SP); lịch sử đơn hiện dòng demo ghi "ngừng bán"; `GET /products/<slug>/reviews` vẫn trả đánh giá của SP đã tắt (`reviews.service.ts:297`, PDP đã 404); `resolveEffective` của giờ vàng (`flash-sale.service.ts:107`) chỉ lọc `variation.isActive` nhưng đó là tính giá, checkout chặn hàng không bán bằng `assertVariationsSellable`.
- **Ngoài phạm vi, chưa sửa:** `brand.service.ts:104`, `wishlist.service.ts:23`, `community-feed.service.ts:469` lọc `isActive` nhưng không lọc `approvalStatus` (SP đối tác chờ duyệt/bị từ chối vẫn hiện ở trang nhãn, yêu thích, và gắn được vào bài khi đăng). Cùng dạng: `storefront-reminder.service.ts:38` (tin nhắc CTV), `brand.service.ts:153` (trần hoa hồng CTV). Không ảnh hưởng hàng demo vì đã tắt.
- Ca "DB không có demo" ở mức CLI/`--apply` được kiểm qua `hasDemoData` trong một transaction rollback, chưa kiểm bằng một DB rỗng riêng (cần dựng đủ ~20 bảng mà kế hoạch đọc).

## 5. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

(Q1–Q6 giữ nguyên; xem thêm mục 6.)

- **Q1. Ba mã WELCOME30 / FREESHIP / XANH10: giữ mã nào?** Mặc định của script: giữ nguyên cả ba, in cảnh báo; go-live FAIL `db.demo_coupons` cho tới khi quyết. Khuyên tắt cả ba (`--coupons=expire`): WELCOME30 trùng mã chào mừng hệ thống tự tặng mỗi khách mới (30.000đ cho đơn từ 199.000đ), giữ cả hai thì khách mới được giảm chào mừng hai lần; FREESHIP không giới hạn tổng lượt. Muốn giữ WELCOME30: `--coupons=expire --keep-coupon=WELCOME30` rồi go-live với `GO_LIVE_ACCEPT_DEMO_COUPONS=WELCOME30`.
- **Q2. Tài khoản 9984606774 Techcombank "CONG TY TUBU TREE" có phải tài khoản thật nhận tiền chuyển khoản?** Mặc định: giữ (go-live đã WARN). Sai thì sửa ở Quản trị, Cấu hình, nhóm payment trước khi mở bán.
- **Q3. Kho lấy hàng gomdon "Fuwa3e Tubu HCM", Golf Park 1 đường số 2, P. Long Bình, TP Thủ Đức, 0965573541 có đúng?** Mặc định: giữ.
- **Q4. Tám nhãn BH.Nong, Cobote, Fuwa3e, Hector, Le Plateau Coffee, Pơ Lang, Sokfram, Visante có phải nhãn Tubu Tree phân phối thật?** Mặc định: giữ, chưa công khai.
- **Q5. Bảy danh mục demo: giữ để gán hàng thật, hay bỏ?** Mặc định: giữ; sau khi dọn đều trống và miniapp tự ẩn.
- **Q6. Các số kinh doanh tự phát tiền ở mục 3** (mã chào mừng, sinh nhật, quay lại, mốc chi tiêu, hoa hồng đối tác 15%, mua chung 15%, khấu trừ TNCN 10% từ 2 triệu, đổi trả 7 ngày): xác nhận hoặc sửa ở Quản trị, Cấu hình. Mặc định: giữ (bằng mặc định trong mã).

## 6. Vòng sửa sau review Opus (REQUEST_CHANGES, 1 lỗi chặn)

Bước 0: dựng lại `lr-democlean-pg` cổng 5565, `migrate deploy` 186 migration, drift `--exit-code` 0; gộp `review/2026-10-18-launch` (`107cf5c9`), bước dọn thành **7c** sau 7b refseed (`CLEANUP_HINT`, runbook bước 4/10, 99-release-readiness 3b).

| # | Commit | Sửa |
|---|---|---|
| 1 (chặn) | `1a4d3855` | Mã do seed tạo (id khác, điều kiện như bản demo) là mã demo: `--coupons=expire` tắt, `--keep-coupon` giữ, go-live sau deploy FAIL, `hasDemoData` tính cả mã seed (DB chỉ còn mã seed không thoát 2). Mã chỉ trùng tên: WARN nêu tên. Test đỏ trước: race spec chèn dòng cùng mã, id khác migration; trước sửa go-live ra WARN (đúng như reviewer tái hiện). Runbook 7c: nhánh `KHÔNG ĐỤNG`, nhánh DB chỉ còn mã seed, dữ liệu demo khác do seed tạo (missions, game_quizzes, cashback_merchants, mục tiêu cộng đồng, mùa giải, loài cây, cấp đại lý, mẫu thông báo); sửa câu WARN ở bước 10 |
| 2 | `3497aaec` | `--apply` đổi SKU demo thành `DEMO-<sku>` (`sku NOT LIKE 'DEMO-%'`, chỉ biến thể trong danh sách migration). Race spec: biến thể thật cùng SKU bị P2002 trước khi dọn, tạo được sau khi dọn |
| 3 | `b167392b` | Lọc hàng đã tắt/chưa duyệt: `groupbuy.service.ts` listOpen (cả nhóm đã đủ người của mình) và join; `flash-sale.service.ts` listActive, listUpcoming, setReminder, cron FLASH_STARTING, báo yêu thích; `lifecycle.service.ts` SQL nhắc mua lại và `notifyWishlistPriceDrop` (đồng bộ Pancake vẫn đổi giá hàng đã tắt); `review-invite.service.ts`; `remarketing.service.ts` (giỏ bỏ quên, quét thêm); chip SP trên bài cộng đồng (`FEED_INCLUDE`). Unit test từng chỗ + một race test gọi service thật; bỏ từng sửa thì race test đỏ đúng ở chỗ đó |
| 4 | `426bbc57` | Hoàn tác: `--apply` ghi id từng dòng trước khi đổi, in khối `BEGIN..COMMIT` bật lại đúng các dòng đó, gỡ tiền tố SKU, trả `isActive`/`endAt` cũ của mã. Runbook bỏ "khôi phục backup bước 6". Race spec chạy khối hoàn tác và so lại đúng trạng thái trước |
| 5 | `e9b4f671` | `--apply` bắt buộc `--expect-db=<tên DB>`, khác tên DB trong `DATABASE_URL` thì thoát 2 trước khi nối. `cleanup-import-chain.spec.ts` đi chuỗi import tĩnh của CLI bằng TypeScript compiler API: không import runtime `@prisma/client`, không gói ngoài nào ngoài `node:*` |
| 6 | `1ca0e50c` | Xem trước nêu tên SP demo còn bán có `updatedAt` sau lúc nạp, ghi "KIỂM TAY TRƯỚC KHI APPLY", không tự bỏ qua. Ngưỡng `2026-06-15T16:46:26Z`: `updatedAt` muộn nhất migration ghi là `16:46:25.484Z`, nên mốc `16:46:25Z` đúng như đề sẽ đánh dấu cả 44 SP; làm tròn lên giây, test khoá theo SQL. Chỉ xét SP còn đang bán (lệnh `updateMany` của chính `--apply` đẩy `updatedAt`) |
| 7 | `ccdcca11` | Lệnh xem trước `-T … 2>&1 \| tee`, đọc chữ in ra thay mã thoát; "dòng bắt đầu bằng `DB:`"; 99-release-readiness: lần deploy PROD đầu theo runbook mục 5, không `deploy.sh` (nếu lỡ: hàng demo bán được tới khi dọn). `couponsExpired` = số dòng thật sự đổi (sửa nằm ở `426bbc57`; trước đó đếm cả mã đã tắt mà chưa tới ngày bắt đầu, không bị đổi); race test khoá. `collect.spec` phủ `demoData` |

Tra SKU trước khi đổi (điểm 2), không chỗ nào gãy:
- `setSoldExternal` (`catalog.service.ts:586-594`) và nhập giá đại lý CSV (`admin.service.ts:1392-1411`) tra `sku IN (...)`: sau khi đổi, SKU gốc chỉ khớp biến thể thật, không còn khớp hàng demo (đúng ý).
- Tìm SP trong Quản trị (`admin.service.ts:344`) dùng `contains`, gõ `FUWA-DW-1L` vẫn ra `DEMO-FUWA-DW-1L`.
- Lịch sử giá đại lý (`admin.service.ts:1472-1476`) lọc cột `dealer_price_history.sku` (bản chụp), dòng cũ giữ SKU cũ, không ảnh hưởng.
- Đẩy đơn Pancake dùng `variation.pancakeId` (`pancake-order-body.ts:263-276`), không dùng SKU.
- Đồng bộ Pancake upsert theo `pancakeId` (`pancake-sync.service.ts:411-425`): pancakeId `seed-...` không có trên Pancake nên không ghi đè SKU demo, còn biến thể thật cùng SKU nay tạo được.
- Dòng đơn không lưu SKU; `dealer.service.ts:182`, `lookupVariations` chỉ hiển thị; SKU merchant dạng `MCH-…` không trùng.

Quét nốt (điểm 3), đã đúng sẵn: gợi ý "cùng nhãn"/"thường mua kèm"/"Dành cho bạn" (`catalog.service.ts:301-341`), AI tư vấn (`ai-advisor.service.ts:93`, `PUBLIC_PRODUCT_WHERE`), đại lý (`dealer.service.ts`, `SELLABLE_*`), đơn CTV lên hộ (`affiliate.service.ts:516-527`), sitemap (catalog list), yêu thích (`isActive`), loyalty (chỉ tên SP cho mã mua chung). Chỗ để lại: mục 4.

Kiểm chứng vòng sửa (Postgres 5565/`tubutree_it`):

```
# race: gói + spec của module đã sửa lọc
npx jest -c test/integration-race/jest.config.js --runInBand demo-cleanup groupbuy-expiry-notify r10-reorder-reminder-scope \
  second-order-review-invite wishlist-price-drop-cooldown feed-like-count merge-reversal-flash-lock r13-flash-existing-row-lock r13-reversal-flash-order
Test Suites: 9 passed, 9 total
Tests:       37 passed, 37 total        (demo-cleanup: 13 test)

# unit
npx jest src/config/demo-data src/config/go-live src/modules/groupbuy src/modules/flash-sale src/modules/lifecycle src/modules/feed
Test Suites: 23 passed, 23 total
Tests:       785 passed, 785 total

npx tsc --noEmit -p tsconfig.json                 # 0 (và race spec qua tsconfig tạm: 0)
npx eslint <19 file .ts đã sửa từ 107cf5c9>       # 0
```

Gộp về sau: `community-feed.service.ts` chỉ đổi khối `FEED_INCLUDE.productTags` (thêm `where`) và một dòng import; phiên `lr/community` đang sửa cùng file, có thể chạm khi gộp.


## 7. Vòng sửa sau review lượt 2 (APPROVE kèm sửa)

Bước 0: dựng lại `lr-democlean-pg` (5565, `--rm --tmpfs`), `migrate deploy`, drift 0; chạy lại `prisma generate` trong worktree vì một reviewer đã sinh Prisma client qua symlink `node_modules`.

| # | Commit | Sửa |
|---|---|---|
| 1 | `06a07cc0` | Runbook 7c: trước `--apply` kiểm không có `.demo-cleanup-apply.txt` (có thì đổi tên); kiểm chạy lại `tee` sang `.demo-cleanup-rerun.txt`, cấm ghi đè file chứa khối hoàn tác |
| 2 | `efe3e342` | Dòng mang id migration mà điều kiện khác bản demo: bản xem trước in `[ĐIỀU KIỆN ĐÃ SỬA so với bản demo: kiểm tay, dùng --keep-coupon=<mã> nếu là mã thật]`, vẫn là mã demo (`--coupons=expire` vẫn tắt). Thêm: `willExpire` dùng đúng điều kiện của `--apply` (mã đã tắt chưa tới ngày bắt đầu thì không ghi "sẽ TẮT"). Runbook nhánh tương ứng |
| 3 | `8c7582cd` | `--apply` tắt sản phẩm bằng SQL thô nên `products.updatedAt` giữ nguyên (biến thể và mã không có cột này); khối hoàn tác vốn không đụng `updatedAt`. Race spec: sau apply + hoàn tác, `updatedAt` đúng như trước và danh sách "KIỂM TAY" rỗng (đỏ với bản `updateMany`) |
| 4 | `cba69c5d` | Runbook hoàn tác: Pancake đã tạo biến thể thật mang SKU gốc thì câu gỡ tiền tố vấp `variations_sku_key`, cả khối dừng trước `COMMIT` (không đổi gì), tech lead bỏ câu SKU rồi chạy lại. Đã chạy thật trên DB throwaway (dưới) |
| 5 | `7a85296b` | Trần `groupbuy.max_open_per_user` đếm với cùng điều kiện như `listOpen` (`LISTED_GROUP_PRODUCT`: SP đang bán, không phải hàng đối tác). Race: nhóm ẩn trên hàng đã tắt không giữ chỗ (đỏ với bản cũ). Đã biết, ghi runbook: bật lại SP đã tắt thì nhóm cũ còn hạn hiện lại, khách có thể tạm vượt trần tới khi chúng hết hạn |
| 6 | `4d110a0d` | Mời đánh giá đọc hàng chưa đánh giá kèm trạng thái bán TRƯỚC khi giành đơn: còn hàng chưa đánh giá nhưng đều ngừng bán thì `SKIPPED`, không ghi `reviewInvitedAt` (lượt sau còn mời được nếu hàng bật lại trong cửa sổ 7 ngày). Race: đơn vẫn chưa đánh dấu (đỏ với bản cũ) |

`--expect-db` chỉ so tên DB: giữ nguyên theo quyết định review.

Kiểm chứng (Postgres 5565/`tubutree_it`):

```
npx jest -c test/integration-race/jest.config.js --runInBand demo-cleanup groupbuy-expiry-notify second-order-review-invite
Test Suites: 3 passed, 3 total
Tests:       22 passed, 22 total            (demo-cleanup: 14)
npx jest src/config/demo-data src/config/go-live src/modules/groupbuy src/modules/lifecycle src/modules/flash-sale src/modules/feed
Test Suites: 23 passed, 23 total
Tests:       787 passed, 787 total
npx tsc --noEmit -p tsconfig.json            # 0 (race spec qua tsconfig tạm: 0)
npx eslint <8 file .ts đổi từ f2a3cc57>      # 0

# CLI thật: xem trước → --apply → khối hoàn tác qua psql → xem trước
1. Sản phẩm demo: tìm thấy 44/44, đang bán 44 → sẽ TẮT 44 (isActive=false, không xoá)     # không có "KIỂM TAY"
Đã tắt 44 sản phẩm, 48 biến thể; đổi 48 SKU sang DEMO-<sku>; đã tắt 3 mã giảm giá.
psql -v ON_ERROR_STOP=1 < undo.sql  →  BEGIN, UPDATE 44, UPDATE 48 (x2), UPDATE 1 (x3), COMMIT
1. Sản phẩm demo: tìm thấy 44/44, đang bán 44 → sẽ TẮT 44 (isActive=false, không xoá)     # vẫn không "KIỂM TAY"; hai bản xem trước giống hệt (trừ dòng DB:)

# hoàn tác khi đã có biến thể thật mang SKU gốc VIS-SR-30
ERROR:  duplicate key value violates unique constraint "variations_sku_key"   (psql thoát 3, SP demo đang bán vẫn 0)
xoá biến thể xung đột, chạy lại khối  →  COMMIT, 48 biến thể bật lại, 0 SKU còn tiền tố DEMO-
```
