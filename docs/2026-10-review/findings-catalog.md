# Catalog phát hiện đã khử trùng, hardening 2026-10

- **Nguồn:** 6 báo cáo `01-pm.md` (A1), `02-arch-data.md` (A2), `03-perf.md` (A3), `04-uiux.md` (A4), `05-security-money.md` (A5), `06-test-baseline.md` (A6), kèm mục "Kiểm chứng độc lập (verifier)" cuối mỗi file (có file 2 lượt).
- **Commit:** `080bc75` (nhánh `hardening/2026-10`). Ngày gộp: 2026-10-09. Chỉ đọc báo cáo, không kiểm lại bằng mã nguồn.
- **Quy tắc mức cuối:** mức sau điều chỉnh của verifier nếu verifier đề xuất đổi; verifier bác bỏ hoặc lỗi thời thì vào mục "Đã loại"; mục verifier không kiểm giữ mức gốc và đánh dấu "chưa kiểm". Gộp các phát hiện cùng nguyên nhân gốc/cùng chỗ sửa vào một dòng (cột "Trùng").
- **Bản JSON cùng nội dung:** `findings-catalog.json` (các trường `c, ids, sev, title, files, group, kind, effort, model, verify_cmd, verifier, decision`).

## 1. Bảng đếm

Đếm theo mức cuối × nguồn của **ID gốc đứng đầu** mỗi dòng (một dòng gộp được tính một lần, ở nguồn của ID đầu).

| Mức | A1 PM | A2 Dữ liệu | A3 Hiệu năng | A4 UI/UX | A5 Bảo mật | A6 Test | Tổng |
|---|---:|---:|---:|---:|---:|---:|---:|
| P0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| P1 | 13 | 4 | 2 | 2 | 3 | 0 | 24 |
| P2 | 24 | 14 | 9 | 19 | 3 | 3 | 72 |
| P3 | 5 | 8 | 3 | 10 | 0 | 1 | 27 |
| **Tổng** | **42** | **26** | **14** | **31** | **7** | **4** | **124** |

- **Đã loại:** 2 mục nguyên (Typecheck-001, API-001) và 8 khẳng định/ý con bị bác bỏ (xem mục 3); không có mục LỖI THỜI.
- **ID gốc:** A1 45, A2 25, A3 17, A4 40, A5 11, A6 7 = **145** ID. Sau khử trùng còn **124** dòng catalog (trong đó 20 dòng gộp từ 2 ID trở lên) + 2 ID đã loại. Một số ID bị tách phần ra hai dòng (A1-011, A1-013, A2-007, A2-017, A4-009) nên tổng không phải là phép cộng đơn giản.
- **Quyết định chủ dự án:** 31 câu đã gộp (mục 4).
- **Verifier:** XÁC NHẬN 38, MỘT PHẦN 5, chưa kiểm 81 (verifier kiểm toàn bộ P0/P1 của cả 6 báo cáo cộng vài mục P2/P3 lấy mẫu).
- **Chú ý khẩn:** A2-002 và A2-003 đang chạy trên PROD (`22e36d4`); A2-001 chưa có trên PROD nhưng phải sửa trước lần deploy kế tiếp; A5N-01 là P0 duy nhất.
- **Công sức** S/M/L; **Model** đề xuất haiku/sonnet/opus theo báo cáo gốc (mục gộp lấy mức cao hơn).

## 2. Bảng phát hiện theo mức

### P0 (1)

| Mã C | ID gốc (+Trùng) | Tiêu đề | File chính | Nhóm file | Loại | Công sức | Model | Lệnh kiểm chứng | Verifier | Quyết định |
|---|---|---|---|---|---|---|---|---|---|---|
| C-001 | A5N-01 (+A1-011 phần ghi đơn dưới tên CTV) | Đơn CTV lên hộ ghi userId=CTV: huỷ/trả hàng hoàn tiền vào ví CTV, khách đã trả tiền mất trắng | apps/api/src/modules/orders/order-reversal.service.ts:104,121-122; apps/api/src/modules/affiliate/affiliate.service.ts:323-347 | api/orders+affiliate | tiền | L | opus | Fixture: CTV POST /affiliate/orders BANK_TRANSFER -> UPDATE paymentStatus=PAID -> POST /orders/{code}/cancel -> SELECT walletBalance FROM users (CTV phải = 0). Vá nhanh (M): chặn CTV tự huỷ đơn placedForCustomer đã PAID; sửa gốc (L): userId = khách cuối | XÁC NHẬN (A5 verifier x2; A1-011 verifier: một phần, phần ghi đơn dưới tên CTV đúng). Verifier A5 bổ sung: lỗi cũng xảy ra với trả hàng (reviewReturn) và COD đã giao bị trả | Q-01 |

### P1 (24)

| Mã C | ID gốc (+Trùng) | Tiêu đề | File chính | Nhóm file | Loại | Công sức | Model | Lệnh kiểm chứng | Verifier | Quyết định |
|---|---|---|---|---|---|---|---|---|---|---|
| C-002 | A2-005 | Hoa hồng CTV tạo ngoài transaction của đơn, nuốt lỗi, không unique, không cron bù | apps/api/src/modules/checkout/checkout.service.ts:424-427; apps/api/src/modules/affiliate/affiliate.service.ts:458-503 | api/affiliate+checkout+prisma | tiền | M | sonnet | SQL: SELECT o.code FROM orders o WHERE o."referrerUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c."orderId"=o.id); spec: commission.create ném lỗi -> đơn rollback hoặc cron bù tạo đúng 1 dòng | XÁC NHẬN (A2 verifier x2) |  |
| C-003 | A1-005 | 3 chương trình giới thiệu; voucher REFER 50k+50k chạy ngầm và không thu hồi khi đơn bị trả | apps/api/src/modules/affiliate/affiliate.service.ts:517-531; apps/api/src/modules/orders/order-status.service.ts:145-148 | api/affiliate+orders | tiền | M | opus | grep -rn 'grantReferralReward\\|REFER-' apps/api/src --include=*.ts \| grep -v spec; spec: DELIVERED rồi RETURNED -> coupon REFER-* bị vô hiệu | XÁC NHẬN (A1 verifier x2) | Q-05 |
| C-004 | A2-001 (+A5N-06, A3-014, A2-017 phần gộp khách thiếu bảng) | Gộp khách->Zalo (mergeGuestInto): nuốt P2002 trong tx làm kẹt phiên; số dư đọc ngoài tx; sót bảng | apps/api/src/modules/auth/auth.service.ts:296-315; apps/api/src/modules/auth/auth.service.ts:324-327 | api/auth | dữ liệu | M | opus | cd apps/api && DATABASE_URL=...tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand -t merge (race-spec mới: guest+target cùng điểm danh 1 ngày -> ensurePhone trả token target, số dư cộng đúng) | XÁC NHẬN (A2 verifier x2; tác động hiệu chỉnh: kẹt phiên khách, KHÔNG chặn đặt hàng). A5N-06 (đua cộng đôi) chưa kiểm động; A3-014, A2-017 chưa kiểm | Q-11 |
| C-005 | A3-004 | Auth throttle 5 lần/phút/IP: người thứ 6 cùng wifi/CGNAT không đăng nhập hay refresh được | apps/api/src/modules/auth/auth.controller.ts:53,67,80,93 | api/auth | hiệu năng | S | sonnet | 7 lần POST /api/auth/refresh cùng X-Forwarded-For: 401 x5 rồi 429 (đo trên API 3001); sau sửa kỳ vọng không 429 ở IP chung | XÁC NHẬN (chi tiết sai: refresh có bộ đếm riêng, không tính chung với guest) | Q-22 |
| C-006 | A1-013 (phần a) | Khuyến mãi nhãn hàng lưu couponCode tự do, không kiểm mã có tồn tại; khách chép mã sai | apps/api/src/modules/brand/brand.service.ts:195-210; apps/miniapp/src/pages/brand-view.tsx:178-206 | api/brand | tính năng | S | sonnet | sed -n '190,212p' apps/api/src/modules/brand/brand.service.ts; spec: couponCode không tồn tại -> 400 | XÁC NHẬN (A1 verifier x2) |  |
| C-007 | A5N-04 | SP bị gỡ/chưa duyệt vẫn đặt được từ giỏ cũ, CTV lên hộ, gói định kỳ và đại lý | apps/api/src/modules/cart/cart.service.ts:28-63; apps/api/src/modules/checkout/checkout.service.ts:499-505 | api/cart+checkout+affiliate+dealer+subscriptions | dữ liệu | M | sonnet | Thêm SP vào giỏ -> UPDATE products SET approvalStatus='REJECTED',isActive=false -> POST /api/checkout/quote phải loại dòng/400. Thêm helper assertPurchasable dùng cho cả affiliate.service.ts:280, dealer.service.ts:177, subscriptions.service.ts:54,216 | XÁC NHẬN (A5 verifier x2; phạm vi RỘNG hơn báo cáo: SP PENDING_REVIEW vẫn isActive=true) | Q-14 |
| C-008 | A5N-03 | Đại lý không có tier bỏ qua hạn mức công nợ: đặt CREDIT 1,6 tỷ vẫn 201 | apps/api/src/modules/dealer/dealer.service.ts:195,209 | api/dealer | tiền | S | sonnet | JWT DEALER không tier -> POST /api/dealer/orders paymentMethod CREDIT 20000x80000 phải bị từ chối; setUserRole('DEALER') phải bắt buộc chọn tier | XÁC NHẬN (x2; nguyên nhân đúng là admin cấp role DEALER trực tiếp qua POST /admin/users/role, không phải duyệt hồ sơ) | Q-07 |
| C-009 | A1-002 | Rò tiền: 500đ Ví -> 600 xu -> 600 giọt nước -> coupon 30k (x60), tối đa 3 lần/ngày | apps/api/src/modules/game/game.service.ts:338-365; apps/api/src/modules/game/game.service.ts:583-584 | api/game | tiền | S | opus | psql: select key,value from system_configs where key in ('game.xu_per_seed','game.tree_default_target'); spec: mua 600 giọt -> tưới -> thu hoạch -> coupon.minOrder >= ngưỡng mới | XÁC NHẬN (A1 verifier x2; rò có trần 3 coupon/ngày/người, lượt 2 'cân nhắc P2') | Q-02 |
| C-010 | A1-007 | Hứa 'cây thật PanNature' và perk hạng (hotline ưu tiên, hộp quà) mà không có quy trình thực hiện | apps/miniapp/src/pages/about.tsx:14-50; apps/api/src/modules/game/game.service.ts:369 | api/game+miniapp/pages/about | tính năng | M | sonnet | grep -rn real_tree_ apps/api/src --include=*.ts (hiện 0); psql: select name,perks from membership_tiers (lệnh gốc dùng cột code là sai, cột đúng là name) | XÁC NHẬN (A1 verifier lượt 1) | Q-16 |
| C-011 | A2-002 | Reconcile đẩy sang Pancake đơn đại lý còn backorder sau 15 phút, trái thiết kế (đang chạy trên PROD) | apps/api/src/modules/integrations/pancake/pancake-push-reconcile.service.ts:47-52; apps/api/src/modules/integrations/pancake/pancake-order.service.ts:79-84 | api/integrations/pancake | dữ liệu | S | sonnet | grep -n backorderedQty apps/api/src/modules/integrations/pancake/pancake-push-reconcile.service.ts (phải có); spec: đơn DEALER item backorderedQty=3, createdAt 20 phút trước -> reconcile() không gọi enqueuePush | XÁC NHẬN (A2 verifier x2; lỗi đang chạy trên PROD 22e36d4) | Q-08 |
| C-012 | A3-001 (+A2-008 phần coupon, A7-09) | GET /me/coupons nạp mọi coupon còn hạn rồi lọc bằng JS: 742-913 ms/lần, 8 song song đứng API ~4 s | apps/api/src/modules/loyalty/loyalty.service.ts:490-497 | api/loyalty+coupons | hiệu năng | M | sonnet | bash scripts/loadtest/start-api.sh rồi node scripts/loadtest/coupon-probe.cjs && node scripts/loadtest/coupon-conc.cjs (kỳ vọng <30 ms, 8 song song <150 ms) | XÁC NHẬN (EXPLAIN + code; số 742-913 ms chưa chạy lại; tác động tỉ lệ với số coupon cá nhân còn hạn trên PROD, chưa biết) | Q-21 |
| C-013 | A5N-02 | /merchant/orders rò invoiceRequest (MST, email), note, userId, referrerUserId cho CTV | apps/api/src/modules/merchant/merchant.service.ts:493-516 | api/merchant | bảo mật | S | sonnet | JWT role AFFILIATE: GET /api/merchant/orders không còn các trường trên (nên chuyển include sang select tường minh) | XÁC NHẬN (A5 verifier x2; bổ sung endCustomerKey) |  |
| C-014 | A2-003 | Xoá địa chỉ làm xoá cứng gói giao định kỳ (FK ON DELETE CASCADE), đang chạy trên PROD | apps/api/prisma/schema.prisma:2159-2160; apps/api/src/modules/users/users.service.ts:110-114 | api/prisma+users+subscriptions | dữ liệu | S | sonnet | psql: select confdeltype from pg_constraint where conname='subscriptions_addressId_fkey' (phải ra 'r'); thêm test xoá địa chỉ đang gắn gói | XÁC NHẬN (A2 verifier x2; đang chạy trên PROD) | Q-12 |
| C-015 | A1-016 | Giao định kỳ: đơn đầu chậm một chu kỳ, chỉ COD, không sửa được số lượng/địa chỉ | apps/api/src/modules/subscriptions/subscriptions.service.ts:66,290 | api/subscriptions+miniapp/orders | tính năng | M | sonnet | grep -n 'nextRunAt\\|paymentMethod' apps/api/src/modules/subscriptions/subscriptions.service.ts | XÁC NHẬN (A1 verifier x2) | Q-13 |
| C-016 | A1-017 | Xoá tài khoản chỉ ghi yêu cầu, không có màn admin xử lý, không có hàm xoá/ẩn danh dữ liệu | apps/api/src/modules/users/users.controller.ts:35; apps/api/src/modules/users/users.service.ts:142-173 | api/users+admin+web/admin | bảo mật | M | opus | grep -rn deletion apps/web/src apps/api/src/modules/admin (hiện 0 kết quả) | XÁC NHẬN (A1 verifier x2; hành vi trung thực, rủi ro là thiếu quy trình xử lý) |  |
| C-017 | A1-003 | Không có cơ chế nào đẩy đơn thứ 2 trong 30 ngày và không có tin mời đánh giá sau giao | apps/api/src/modules/vouchers/vouchers.service.ts:85-125; apps/api/src/modules/lifecycle/lifecycle.service.ts:68-76 | api/vouchers+lifecycle+game | tính năng | M | sonnet | psql: select code from missions (không có đơn 2); spec vouchers.service.spec.ts: đơn đầu DELIVERED tạo coupon SECOND-* | XÁC NHẬN (A1 verifier x2) |  |
| C-018 | A1-010 | Quiz onboarding phủ mọi route (cả link CTV/sản phẩm), 'Để sau' không nhớ; hứa quà/gợi ý không có | apps/miniapp/src/components/onboarding.tsx:66-69,124,224; apps/api/src/modules/users/users.service.ts:122-129 | miniapp/components/onboarding | UI | S | sonnet | grep -rn segments apps/api/src/modules --include=*.ts \| grep -v spec; e2e: mở /product/:slug lần đầu không bị quiz phủ | XÁC NHẬN (A1 verifier lượt 1) |  |
| C-019 | A1-008 (+A4-008) | Trang Về Tubu Tree: hotline 1900 1234 và email giữ chỗ, FAQ hard-code sai, FAQ admin không tới khách | apps/miniapp/src/pages/about.tsx:181-183; apps/miniapp/src/pages/about.tsx:14-50 | miniapp/pages/about+api/faq | tính năng | S | sonnet | grep -n 1900 apps/miniapp/src/pages/about.tsx (phải rỗng); grep -rn '/faqs' apps/miniapp/src (phải có kết quả) | XÁC NHẬN (A1 verifier x2, A4 verifier; số hotline có thật hay không: chưa kiểm chứng) | Q-17 |
| C-020 | A1-012 | Caption CTV 'Nhập mã X khi mua' nhưng checkout không có ô nhập mã giới thiệu | apps/miniapp/src/pages/affiliate.tsx:539-541; apps/miniapp/src/pages/checkout.tsx:178 | miniapp/pages/affiliate+checkout | tính năng | S | haiku | grep -n 'Nhập mã\\|qua mã\\|với mã' apps/miniapp/src/pages/affiliate.tsx (đổi sang link; hoặc thêm ô mã ở checkout: sonnet) | XÁC NHẬN (A1 verifier x2) |  |
| C-021 | A4-009 (phần Mini App + web khách) | Vùng chạm <44px ở giỏ, checkout, storefront-builder, feed, dealer, about (cart 13/23) | apps/miniapp/src/pages/cart.tsx; apps/miniapp/src/components/ui/quantity-selector.tsx | miniapp/pages/cart+checkout+storefront-builder+feed | UI | M | sonnet | node scripts/uiux/capture.mjs miniapp --only '^(cart\|storefront-builder\|feed\|dealer\|about)$' --vp 390 --states normal --force && node scripts/uiux/build-report-data.mjs metrics miniapp (cột tap<44 <=2) | XÁC NHẬN (A4 verifier: giữ P1 cho cart/checkout/storefront-builder; điểm mù đo đã được báo cáo tự nêu) |  |
| C-022 | A1-009 | Công tắc tắt thông báo khuyến mãi là giả: chỉ lưu localStorage, server không đọc (rủi ro pháp lý) | apps/miniapp/src/pages/settings.tsx:8,12,58; apps/api/src/modules/notifications | miniapp/pages/settings+api/notifications | tính năng | M | sonnet | grep -rn notifyPromo apps/api/src (hiện 0; sau sửa phải có trong notifications) | XÁC NHẬN (A1 verifier x2) |  |
| C-023 | A4-006 | Tương phản chữ <4,5:1 diện rộng (text-disabled #9E978A, 131 nút) và CTA cam của web chỉ 2,64:1 | packages/design-tokens/src/tokens.css:28,99; apps/miniapp/src/components/ui/product-tile.tsx:174,179 | packages/design-tokens+miniapp/ui+web/tailwind | UI | M | sonnet | node scripts/uiux/build-report-data.mjs contrast miniapp (không in dòng nào); tương tự contrast web | XÁC NHẬN (A4 verifier, tính lại tỉ lệ WCAG) |  |
| C-024 | A1-006 (+A4-007) | Đơn CK lẻ: không có 'Đã nhận tiền'; nút trạng thái sai; PENDING_PAYMENT->DELIVERED được; không huỷ | apps/web/src/app/admin/page.tsx:835,862; apps/api/src/modules/admin/admin.service.ts:431-451 | web/admin/orders+api/admin | tiền | M | opus | sed -n '830,890p' apps/web/src/app/admin/page.tsx; spec admin.service.spec.ts: đơn BANK_TRANSFER chưa PAID gọi DELIVERED phải ném lỗi | XÁC NHẬN (A1 verifier x2). A4-007: BÁC BỎ phần 'lùi trạng thái' (API order-transition.ts chặn 400) nhưng PENDING_PAYMENT->DELIVERED vẫn hợp lệ nên phần tiền của A1-006 đứng | Q-06 |
| C-025 | A1-014 | Web khách thiếu chi tiết đơn/QR trả lại, voucher, tìm kiếm, footer; dẫn khách vào 'Kênh Đối Tác' | apps/web/src/app/thanh-toan/page.tsx:153-158; apps/web/src/components/site-header.tsx:50-55 | web/shop | tính năng | L | sonnet | grep -rn merchant apps/web/src/components/site-header.tsx apps/web/src/app/page.tsx (phải rỗng sau sửa) | XÁC NHẬN (A1 verifier x1) |  |

### P2 (72)

| Mã C | ID gốc (+Trùng) | Tiêu đề | File chính | Nhóm file | Loại | Công sức | Model | Lệnh kiểm chứng | Verifier | Quyết định |
|---|---|---|---|---|---|---|---|---|---|---|
| C-026 | A2-012 | Cron: 27/28 không timeZone, container không TZ (03:00 chạy 10:00 VN), mốc 'đầu ngày' lệch | apps/api/src/modules/catalog/catalog.service.ts:473; docker-compose.vietnix.yml:47-70 | api (mọi module @Cron)+docker-compose+common | hạ tầng | M | sonnet | grep -rn '@Cron(' apps/api/src \| grep -vc timeZone (phải = 0); grep -rn 'setHours(0, 0, 0, 0)' apps/api/src --include=*.ts \| grep -v spec (phải rỗng). Gồm dealer.cron.ts:14 (A1 §7 #6) | XÁC NHẬN (A2 verifier: 28 decorator, chỉ 1 có timeZone; compose/Dockerfile không có TZ) | Q-09 |
| C-027 | A3-006 | Admin đơn và dashboard quét tuần tự bảng orders (không index createdAt; tìm kiếm ILIKE) | apps/api/src/modules/admin/admin.service.ts:395-405; apps/api/src/modules/admin/admin-order-filter.ts:91-94 | api/admin+prisma(migration) | hiệu năng | S | haiku | docker exec -i tubu_pg psql -U tubu -d tubutree_perf -f scripts/loadtest/explain-cron.sql (mục C8) và EXPLAIN các câu #85/#97/#100 | chưa kiểm |  |
| C-028 | A1-011 (phần CTV tự giới thiệu) | CTV nhập SĐT của chính mình làm khách nhận hàng để tự hưởng hoa hồng đơn hộ | apps/api/src/modules/affiliate/affiliate.service.ts:403,463-465 | api/affiliate | tiền | S | opus | sed -n '398,408p;460,466p' apps/api/src/modules/affiliate/affiliate.service.ts; spec: endCustomerKey == SĐT của CTV bị chặn hoặc không sinh hoa hồng | MỘT PHẦN (A1 verifier: đơn mua thường đã chặn tự giới thiệu, hoa hồng đơn hộ là có chủ ý; chỗ hở chỉ là nhập SĐT của chính mình; hạ P2) | Q-01 |
| C-029 | A1-038 | CTV không nhận thông báo khi có hoa hồng mới, được duyệt, đã rút | apps/api/src/modules/affiliate/affiliate.service.ts | api/affiliate+prisma(seed) | tính năng | S | sonnet | grep -n notify apps/api/src/modules/affiliate/affiliate.service.ts (hiện không có dòng) | chưa kiểm |  |
| C-030 | A2-007 (phần /events) (+A5N-07) | POST /events: eventName/props không whitelist, throttle theo x-device-id; ghi được order_paid giả | apps/api/src/modules/analytics/analytics.controller.ts:17-50,98; apps/api/src/modules/analytics/dto/ingest-events.dto.ts:7-20 | api/analytics | bảo mật | S | sonnet | grep -n 'IsIn\\|MaxLength' apps/api/src/modules/analytics/dto/ingest-events.dto.ts; POST /api/events eventName=order_paid phải 400 | XÁC NHẬN (A2 verifier x2 cho phần throttle/body 10MB; A5N-07 chưa kiểm lượt verifier) | Q-24 |
| C-031 | API-002 | 2 lỗi lint API: any ở analytics.controller.ts và unused trong community-feed.service.spec.ts | apps/api/src/modules/analytics/analytics.controller.ts; apps/api/src/modules/feed/community-feed.service.spec.ts | api/analytics+feed | test | S | haiku | cd apps/api && npx eslint src (exit 0) | chưa kiểm |  |
| C-032 | A1-004 | Dashboard chưa đo north-star NS-1 (% khách có đơn 2 trong 30 ngày); chỉ có NS-2 và DAU | apps/api/src/modules/analytics/analytics-aggregation.service.ts:13-15; apps/web/src/app/admin/page.tsx:135 | api/analytics+web/admin | tính năng | M | sonnet | grep -n 'NS-1\\|ns1\\|secondOrder' apps/api/src/modules/analytics/*.ts (hiện 0) | XÁC NHẬN (A1 verifier x2; đo lường, hạ P1->P2) |  |
| C-033 | A3-002 (+A3-003) | Throttle 60/phút/route/IP: IP dùng chung dễ 429; miniapp không xử lý 429; SSR web notFound() khi 429 | apps/api/src/app.module.ts:58,109; apps/web/src/lib/api.ts:61-67 | api/app.module+web/lib+miniapp/services | hiệu năng | M | sonnet | node scripts/loadtest/throttle-probe.cjs; web: build + node scripts/loadtest/web-crawl-probe.cjs (0 trang 404 giả) | MỘT PHẦN (A3 verifier: khoá đếm theo class+handler+IP nên không phải 60/phút chung toàn IP; hạ P1->P2; phần miniapp không xử lý 429 và notFound() cho mọi lỗi vẫn đúng) | Q-22 |
| C-034 | A1-013 (phần b) (+A4-001) | Chủ nhãn không có màn xem đơn/doanh thu/đối soát (API chỉ có owner/me và khuyến mãi) | apps/api/src/modules/brand/brand.controller.ts:39-59; apps/miniapp/src/pages/brand-owner.tsx | api/brand+miniapp/pages/brand-owner | tính năng | L | opus | grep -ci 'doanh thu' apps/miniapp/src/pages/brand-owner.tsx (>0); e2e chủ nhãn chỉ thấy đơn của nhãn mình, ẩn tên/SĐT khách | XÁC NHẬN (A4 verifier: là thiếu tính năng, hạ P1->P2; A1 verifier giữ P1 cho cả A1-013 nên tách hai phần) | Q-18 |
| C-035 | A1-037 | Sắp xếp theo giá dùng basePrice trong khi hiển thị/lọc dùng giá sale | apps/api/src/modules/catalog/catalog.service.ts:379-382; apps/api/src/modules/catalog/catalog.service.ts:142-144 | api/catalog | tính năng | S | sonnet | sed -n '376,384p' apps/api/src/modules/catalog/catalog.service.ts (ORDER BY COALESCE(salePrice, basePrice)) | chưa kiểm |  |
| C-036 | A5N-08 | GET /products/:slug lộ pancakeId (ID nội bộ Pancake) ở product và variations | apps/api/src/modules/catalog/catalog.service.ts:188 | api/catalog | bảo mật | S | sonnet | curl -s http://localhost:3001/api/products/<slug> \| grep -c pancakeId (phải 0) | chưa kiểm (đã đo động bởi A5) |  |
| C-037 | A3-009 | Mở Home tốn 17 request (16 song song): cần endpoint gộp BFF GET /home | apps/api/src/modules/catalog; apps/miniapp/src/pages/home.tsx | api/catalog+miniapp/pages/home+services | hiệu năng | L | opus | PERF_BASE=... node scripts/loadtest/page-weight.cjs (đếm request Home); RAMP=2,4,8,16 node scripts/loadtest/scenarios.cjs home | chưa kiểm |  |
| C-038 | A3-007 (+A5N-11) | Tìm kiếm không dấu quét tuần tự products bằng translate()+regexp_replace; suggest q không giới hạn | apps/api/src/modules/catalog/catalog.service.ts:164-176; apps/api/src/modules/catalog/catalog.controller.ts:58 | api/catalog+prisma(migration) | hiệu năng | M | sonnet | EXPLAIN câu #7 trong explain-all.json dùng index (<3 ms); curl suggest?q=<chuỗi dài> trả 400 | chưa kiểm |  |
| C-039 | A3-012 | API công khai không gắn Cache-Control; cache dữ liệu nóng chỉ nằm trong RAM một instance | apps/api/src/modules/catalog/catalog.service.ts:38-40; apps/api/src/modules/system-config/system-config.service.ts:11-32 | api/catalog+system-config+flash-sale | hiệu năng | S | haiku | curl -I localhost:3301/api/categories có header Cache-Control | chưa kiểm |  |
| C-040 | A2-013 | Logic trùng: sinh mã đơn x4 (ymd UTC), maskName x4, báo admin x3, chuẩn hoá SĐT x3, dayKey VN x7 | apps/api/src/modules/checkout/checkout.service.ts:621-632; apps/api/src/modules/dealer/dealer.service.ts:1426-1433 | api/common+checkout+affiliate+dealer+subscriptions+game | hạ tầng | M | haiku | grep -rn 'private async generate.*Code\\|private maskName\\|function maskFullName\\|notifyAdminsOf' apps/api/src --include=*.ts \| grep -v spec (chỉ còn định nghĩa trong common/) | chưa kiểm |  |
| C-041 | A2-014 | 5 service >800 dòng ôm nhiều trách nhiệm (dealer 1.434, loyalty 1.297, affiliate 1.128, feed 1.099) | apps/api/src/modules/dealer/dealer.service.ts; apps/api/src/modules/loyalty/loyalty.service.ts | api/dealer+loyalty+affiliate+feed+integrations/gomdon | hạ tầng | L | sonnet | find apps/api/src -name '*.service.ts' ! -name '*.spec.ts' -exec wc -l {} + \| sort -rn \| head (không file >800 dòng); toàn bộ 2.364 unit test còn pass. Làm SAU A2-015 | chưa kiểm |  |
| C-042 | A3-005 | Feed đếm reaction/comment bằng join gộp toàn bảng: 63-90 ms ở 20k bài, tăng tuyến tính | apps/api/src/modules/feed/community-feed.service.ts:151,353 | api/feed+prisma | hiệu năng | M | sonnet | node scripts/loadtest/explain-run.cjs (sau sql-capture.cjs); EXPLAIN câu feed <5 ms, không còn Seq Scan on feed_reactions | chưa kiểm |  |
| C-043 | A1-024 | Vòng quay không trần lượt/ngày; khoá game.spin_buy_daily_limit không code nào đọc | apps/api/src/modules/game/game.service.ts:104-125 | api/game | tiền | S | sonnet | grep -rn spin_buy_daily_limit apps/api/src (hiện 0 kết quả) | chưa kiểm |  |
| C-044 | A1-025 | Season Pass chết từ 31/08, không có công cụ tạo mùa | apps/api/src/modules/game/season-pass.service.ts:73,114-116; apps/miniapp/src/pages/game.tsx:411 | api/game+web/admin | tính năng | M | sonnet | psql: select code,"startAt","endAt" from seasons | chưa kiểm | Q-16 |
| C-045 | A2-010 | PancakeWebhookEvent không dedupe, không index, không cron cứu sự kiện FAILED (đơn kẹt trạng thái cũ) | apps/api/prisma/schema.prisma:2074-2085; apps/api/src/modules/integrations/pancake/pancake.processor.ts:56-80 | api/integrations/pancake+prisma | dữ liệu | M | sonnet | race-spec: gửi cùng payload 5 lần đồng thời chỉ có 1 dòng (mirror gomdon.race-spec.ts (g)) | chưa kiểm |  |
| C-046 | A2-007 (phần dọn log) (+A3-008, A2-008 index refresh_tokens) | Bảng log phình không TTL: refresh_tokens, analytics_events, notification_logs, webhook events | apps/api/src/modules/auth/auth.service.ts:338,432,442; apps/api/src/modules/notifications/notifications.service.ts:55-81 | api/jobs+auth+notifications+analytics+integrations | hạ tầng | M | sonnet | psql: SELECT relname,n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10 trước/sau; spec cho cron dọn; EXPLAIN C11/C6 trong scripts/loadtest/explain-cron.sql | chưa kiểm (A2 verifier chỉ kiểm phần /events của A2-007) | Q-21 |
| C-047 | A1-001 | Khách học 6 loại giá trị và ~6 thước tiến độ; Điểm Xanh và TubuXu trùng vai trò trừ tiền đơn | apps/miniapp/src/pages/profile.tsx:288-294; apps/api/src/modules/checkout/checkout.service.ts:183-204 | api/loyalty+wallet+checkout | tính năng | L | opus | grep -n 'pointsBalance\\|coinsBalance\\|walletBalance' apps/miniapp/src/pages/profile.tsx apps/miniapp/src/pages/checkout.tsx (hub chỉ còn <=3 số dư) | XÁC NHẬN (A1 verifier lượt 1; là quyết định thiết kế, hạ P1->P2) | Q-03 |
| C-048 | A3-011 | Node đơn tiến trình bão hoà ~16 kết nối; nhân bản instance chưa an toàn; chưa đặt pool Prisma | apps/api/src/modules/catalog/catalog.service.ts:29-40; apps/api/src/main.ts | api/main.ts+jobs+catalog+docker-compose | hạ tầng | L | opus | RAMP=16,32,64,96 node scripts/loadtest/scenarios.cjs browse trước/sau; đặt connection_limit/pool_timeout theo cấu hình VPS | chưa kiểm | Q-23 |
| C-049 | A3-010 | ECONNRESET ~3,3% ở ~800 rps (kịch bản home), chưa rõ nguyên nhân phía server hay bộ phát tải | apps/api/src/main.ts; scripts/loadtest/conn-probe2.cjs | api/main.ts+scripts/loadtest | hiệu năng | S | sonnet | node scripts/loadtest/conn-probe2.cjs; RAMP=16 FIX_SEC=12 node scripts/loadtest/scenarios.cjs home nhiều lần, so tỉ lệ lỗi | chưa kiểm (nguyên nhân chưa kiểm chứng) |  |
| C-050 | A5N-05 | Ảnh minh chứng đổi trả nhận URL javascript:/data: gây stored-XSS trong admin web | apps/api/src/modules/orders/orders.controller.ts:9; apps/web/src/app/admin/page.tsx:1160-1167 | api/orders+web/admin | bảo mật | S | sonnet | POST /orders/{code}/return-request images=['javascript:...'] phải 400; admin chỉ render src bắt đầu https:// | chưa kiểm (đã đo động bởi A5) |  |
| C-051 | A2-017 (phần FK) | Hơn 80 cột *Id không có FK (kể cả bảng tiền: dealer_credit_ledgers, coupon_redemptions...) | apps/api/prisma/schema.prisma | api/prisma | dữ liệu | M | sonnet | SQL 'cột *Id không FK' trong phụ lục A2 phải ngắn lại; chạy tìm dòng mồ côi trên bản sao PROD trước khi thêm FK ON DELETE RESTRICT | chưa kiểm |  |
| C-052 | A2-008 | Thiếu index cho truy vấn cron/inbox (notification_logs, cashback_transactions, commissions, tokens) | apps/api/prisma/schema.prisma:2066; apps/api/src/modules/affiliate/affiliate.service.ts:767-774 | api/prisma(migration) | hiệu năng | S | haiku | EXPLAIN từng truy vấn trên tubutree_perf sau khi thêm index phải ra Index Scan (gộp chung migration với A3-006) | chưa kiểm |  |
| C-053 | A1-019 | Seed chưa áp: thiếu 8 mẫu thông báo, voucher sinh nhật NULL; tin ORDER_DELIVERED/WELCOME sai lời | apps/api/prisma/seed.ts:639-641; apps/api/src/modules/notifications/notifications.service.ts:51-55 | api/prisma(seed)+docs/runbook | dữ liệu | S | sonnet | psql: select code from notification_templates so với grep -o "code: '[A-Z_]*'" apps/api/prisma/seed.ts; thêm bước seed upsert vào runbook deploy | chưa kiểm |  |
| C-054 | A1-032 (+A1-033, A1-043) | 22 khoá config chết vẫn sửa được; khoá voucher chào mừng lệch tên; ETA không bật được; hệ số Ví 1,5 | apps/api/prisma/seed.ts:22-23; apps/api/src/modules/system-config/system-config.controller.ts:36,42-43 | api/prisma(seed)+system-config+web/admin | dữ liệu | S | sonnet | for k in payment.cod_max_amount voucher.welcome_amount loyalty.welcome_voucher_amount; do grep -rn "'$k'" apps/api/src --include=*.ts \| grep -v spec \| wc -l; done; curl -s localhost:3001/api/config/public \| grep -o 'affiliateWalletMultiplier[^,]*' | chưa kiểm |  |
| C-055 | A2-009 (+A5N-10) | Cột Int 32-bit cho doanh số/ngưỡng tích luỹ và tổng đơn đại lý: >2,15 tỷ gây lỗi 500 | apps/api/prisma/schema.prisma:472,506,1067,1156; apps/api/src/modules/dealer/dealer.service.ts | api/prisma+brand/dto+dealer | dữ liệu | S | sonnet | POST tạo DealerReward threshold=3000000000 phải 400 hoặc 201, không 500; POST /api/dealer/orders CREDIT quantity 100000 phải 400 | chưa kiểm (A5N-10 đã đo động bởi A5, chưa qua verifier) | Q-10 |
| C-056 | A1-036 | Chấm công: rớt vùng GPS một heartbeat là tự chấm ra, mất giờ công | apps/api/src/modules/staff/attendance.service.ts:152-164 | api/staff | tính năng | S | sonnet | sed -n '150,166p' apps/api/src/modules/staff/attendance.service.ts (chỉ checkout sau 2-3 heartbeat liên tiếp) | chưa kiểm |  |
| C-057 | A2-011 | Tạo gói định kỳ không chống trùng: double-tap ra 2 gói, mỗi kỳ 2 đơn COD | apps/api/src/modules/subscriptions/subscriptions.service.ts:49-80; apps/api/prisma/schema.prisma:2151-2170 | api/subscriptions+prisma | dữ liệu | S | sonnet | race-spec: 3 lệnh create đồng thời chỉ có 1 gói | chưa kiểm | Q-13 |
| C-058 | A2-015 | Thiếu race test Postgres thật: checkout oversell, coupon, flash, ví/xu, groupbuy, backorder, định kỳ | apps/api/test/integration-race/ | api/test/integration-race | test | M | sonnet | cd apps/api && DATABASE_URL=...tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand | chưa kiểm |  |
| C-059 | A5N-09 | Voucher chào mừng/sinh nhật/winback cấp cho cả guest (farm); birthday LIMIT 500 không ORDER BY | apps/api/src/modules/vouchers/vouchers.service.ts:143-146; apps/api/src/modules/auth/auth.controller.ts:28 | api/vouchers+auth | tiền | M | sonnet | spec: guest chưa có zaloId/SĐT không nhận voucher; birthday cron có ORDER BY + phân trang | chưa kiểm (chỉ đọc mã) | Q-05 |
| C-060 | A2-004 (+A1-022) | Ví Tubu (tiền thật, rút được) không có sổ cái/lịch sử; 8 chỗ ghi số dư; khách và CTV không có sao kê | apps/api/prisma/schema.prisma:232; apps/api/src/modules/wallet/wallet.service.ts:93,177 | api/wallet+affiliate+cashback+orders+checkout+auth | tiền | L | opus | grep -n '^model WalletTransaction' apps/api/prisma/schema.prisma; SQL: users có walletBalance <> SUM(delta) phải = 0 | XÁC NHẬN (A2 verifier x2: câu 'không có lịch sử nào' nói quá, phần lớn dựng lại được từ payouts/cashback; hạ P1->P2; nâng lại P1 nếu mở rút tiền rộng) | Q-04 |
| C-061 | A2-006 | Mẫu catch P2002 rồi đi tiếp trong interactive transaction (grantCoins, coupons.redeem): bẫy chờ nổ | apps/api/src/modules/wallet/coins.service.ts:65-90; apps/api/src/modules/coupons/coupons.service.ts:144-157 | api/wallet+coupons | dữ liệu | S | sonnet | grep -rn -B3 P2002 apps/api/src/modules --include=*.ts \| grep -n 'tx\.' (không còn catch-continue trong tx) | chưa kiểm |  |
| C-062 | E2E-001 | 6 E2E miniapp fail: spec loyalty không mock POST /events (5 test); storefront CTV dính Vite 504 | apps/e2e/tests/loyalty.miniapp.spec.ts:154,176,210,227,255; apps/e2e/tests/design-system-pilot.miniapp.spec.ts:236 | apps/e2e/tests (miniapp) | test | M | sonnet | cd apps/e2e && npx playwright test loyalty.miniapp.spec.ts (thêm api.allowUnmocked('POST /events') như buy-flow-mocks.ts:77); pilot:236 chạy lại trên Vite sạch | XÁC NHẬN lỗi tái hiện 6/6; nguyên nhân là trôi mock (không phải lỗi sản phẩm); pilot:236 vẫn CHƯA RÕ (nghi môi trường); hạ P1->P2 |  |
| C-063 | E2E-003 | E2E admin dealer pagination fail: test cũ tìm 'hồ sơ cũ hơn', UI đã đổi thành 'mới hơn' (order=asc) | apps/e2e/tests/admin.spec.ts:132; apps/web/src/app/admin/page.tsx:294-303 | apps/e2e/tests (web admin) | test | S | haiku | npx playwright test admin.spec.ts -g 'Dealer applications' (cập nhật mock và chuỗi 'mới hơn') | XÁC NHẬN lỗi tái hiện; là test cũ, không phải lỗi UI (hạ P1->P2) |  |
| C-064 | A4-025 | CTV lên đơn hộ: nhập tay toàn bộ (~13 chạm), đường vào sâu, nút còn màu v1 | apps/miniapp/src/components/affiliate/ctv-order-sheet.tsx:205-218,283,306; apps/miniapp/src/pages/affiliate.tsx:488-496 | miniapp/components/affiliate | UI | M | sonnet | đếm lại luồng 3 (A4 mục 5); 'khách gần đây' tự điền | chưa kiểm |  |
| C-065 | A4-024 | Form địa chỉ luôn trống: khách mới đặt đơn đầu mất ~12 chạm | apps/miniapp/src/components/address-form.tsx:16-18; apps/miniapp/src/components/checkout/address-section.tsx | miniapp/components/checkout | UI | M | sonnet | đếm lại luồng 1 <=8 chạm (A4 mục 5) | chưa kiểm | Q-27 |
| C-066 | A4-023 | 'Mua lại' ở Home không dẫn tới giỏ (5 chạm so với 3 qua PDP) | apps/miniapp/src/components/reorder/purchased-rail.tsx:49,88,93 | miniapp/components/reorder | UI | S | sonnet | e2e: Home 'Mua lại' -> URL /cart (hoặc snackbar 'Xem giỏ') | chưa kiểm |  |
| C-067 | A4-028 | Chia sẻ lỗi bị nuốt im lặng (.catch(() => {})), CTV bấm chia sẻ mà không có phản hồi | apps/miniapp/src/components/share-sheet.tsx:63; apps/miniapp/src/pages/affiliate.tsx:282-285 | miniapp/components/share-sheet+pages/affiliate | UI | S | haiku | test mock shareLink reject thì có snackbar và sao chép liên kết dự phòng | chưa kiểm |  |
| C-068 | A4-011 | Chip nhỏ hơn 44px (padding 6-8px, minHeight 32/36) | apps/miniapp/src/components/ui/chip.tsx:53 | miniapp/components/ui | UI | S | haiku | chip.spec.tsx thêm kiểm tra hit-44; đo lại orders tap<44 = 0 | chưa kiểm |  |
| C-069 | A4-012 | ui/primitives.tsx không file nào import (chỉ có spec) | apps/miniapp/src/components/ui/primitives.tsx | miniapp/components/ui | UI | S | haiku | grep -rn 'ui/primitives' apps/miniapp/src (chỉ còn spec trước khi xoá); pnpm --filter miniapp test và build xanh | chưa kiểm |  |
| C-070 | A4-014 | Button chỉ khoá bấm đúp qua prop loading (không khoá đồng bộ useRef) | apps/miniapp/src/components/ui/button.tsx:55-58 | miniapp/components/ui | UI | S | sonnet | button-guard.spec.ts thêm ca bấm 2 lần đồng bộ onPress chỉ gọi 1 lần | chưa kiểm |  |
| C-071 | A4-029 | Vùng cuộn ngang không focus được, không gợi ý cuộn (axe scrollable-region-focusable x16) | apps/miniapp/src/components/ui/segmented-tabs.tsx; apps/miniapp/src/components/home | miniapp/components/ui+home | UI | S | sonnet | axe scrollable-region-focusable = 0 | chưa kiểm |  |
| C-072 | A4-015 | Thẻ sản phẩm là phần tử tương tác chứa nút tim/mua lại (nested-interactive x112) | apps/miniapp/src/components/ui/product-tile.tsx; apps/miniapp/src/components/reorder/purchased-rail.tsx | miniapp/components/ui+reorder | UI | M | sonnet | node scripts/uiux/build-report-data.mjs axe miniapp không còn nested-interactive | chưa kiểm |  |
| C-073 | A1-028 | Lời và danh mục cộng đồng nói về cây cảnh, trong khi hàng bán là mỹ phẩm, tẩy rửa, thực phẩm | apps/miniapp/src/i18n/vi.ts:462-527; apps/api/prisma/seed.ts | miniapp/i18n+api/prisma(seed) | tính năng | S | haiku | grep -n 'lưỡi hổ\\|sen đá\\|chăm cây' apps/miniapp/src/i18n/vi.ts apps/miniapp/src/pages/profile.tsx | chưa kiểm |  |
| C-074 | A1-021 (+A4-019) | Thuật ngữ lẫn lộn (Mã giảm giá/Mã ưu đãi; Tubu Xu/TubuXu); kho voucher nằm khối thứ 7 của /loyalty | apps/miniapp/src/i18n/vi.ts; apps/miniapp/src/pages/loyalty.tsx | miniapp/i18n+pages/loyalty+profile+checkout | UI | S | haiku | grep -rn 'Tubu Xu\\|TubuXu' apps/miniapp/src \| grep -v spec (còn đúng một dạng); grep -c 'mã giảm giá' apps/miniapp/src/i18n/vi.ts | chưa kiểm | Q-26 |
| C-075 | A4-004 | Viewport chặn phóng to (user-scalable=no) vi phạm WCAG 1.4.4 | apps/miniapp/index.html:7 | miniapp/index.html | UI | S | haiku | grep -n user-scalable apps/miniapp/index.html (phải rỗng); axe meta-viewport = 0 | XÁC NHẬN (A4 verifier: hạ P1->P2; WebView Zalo có tôn trọng thuộc tính hay không chưa kiểm chứng) | Q-28 |
| C-076 | A4-002 (+A4-010, Miniapp-001, A4-020, A4-039) | DS v2 chưa xong: 30/40 trang còn alias legacy (1.616), 40/40 trộn ZaUI, ESLint miniapp đỏ 105 lỗi | apps/miniapp/src/css/tokens.css:25-117; apps/miniapp/src/pages/brand-story.tsx | miniapp/pages+components (DS v2) | UI | L | sonnet | node scripts/uiux/static-scan.mjs (tổng alias legacy = 0); cd apps/miniapp && npx eslint src (exit 0). Chia 4 lô theo A4-002: game+loyalty, affiliate+dealer+storefront-builder, wallet+post-detail+feed, phần còn lại | XÁC NHẬN (A4-002: hạ P1->P2, nợ có chủ đích; lint 105 lỗi: A4 và A6 cùng số, A6 chưa kiểm lại) |  |
| C-077 | A4-005 | axe critical: nút icon không tên (7), ô nhập/radio thiếu nhãn (12), switch không tên (3), select (9) | apps/miniapp/src/pages/settings.tsx:132; apps/miniapp/src/pages/checkout.tsx:433 | miniapp/pages+web/admin+web/merchant | UI | M | sonnet | node scripts/uiux/capture.mjs miniapp --only '^(checkout\|feed\|refill\|staff\|my-payroll\|edit-profile\|brand-owner\|settings\|notifications)$' --vp 390 --states normal --force && node scripts/uiux/build-report-data.mjs axe miniapp | MỘT PHẦN (A4 verifier: số đếm khớp, nhưng 'trình đọc không đọc được trang thanh toán' là phóng đại; hạ P1->P2) |  |
| C-078 | A4-016 (+A4-033) | Text onClick không role/min-height (addresses ActionLink) và mũi tên ký tự '›' ở settings | apps/miniapp/src/pages/addresses.tsx:178-200; apps/miniapp/src/pages/settings.tsx:223-225 | miniapp/pages/addresses+settings | UI | S | haiku | axe + tap<44 của addresses; dùng ListRow/Button ghost và icon ChevronRight | chưa kiểm |  |
| C-079 | A1-027 | 'Hành trình nguyên liệu': 2/8 nút ra danh sách rỗng (lọc theo tên nhãn); trang nhãn mồ côi | apps/miniapp/src/pages/brand-story.tsx:539; apps/miniapp/src/pages/product-detail.tsx:292-299 | miniapp/pages/brand-story+product-detail | UI | S | sonnet | curl -s 'http://localhost:3001/api/products?brand=Le%20Plateau&limit=1' (sau sửa total > 0) | chưa kiểm |  |
| C-080 | A4-018 | Checkout: Ví/TubuXu bị làm mờ không nói lý do; '48/65000 điểm' không có dấu phân cách nghìn | apps/miniapp/src/pages/checkout.tsx | miniapp/pages/checkout | UI | S | sonnet | ảnh checkout sau sửa; test thành phần checkout | chưa kiểm |  |
| C-081 | A1-034 | Đại lý: giao diện chặn đặt trước (max=tồn kho) dù API hỗ trợ backorder; nhãn '-X%' là mặc định bậc | apps/miniapp/src/pages/dealer.tsx:625; apps/api/src/modules/dealer/dealer.service.ts:145 | miniapp/pages/dealer+api/dealer | tính năng | S | sonnet | grep -n 'max={row.stock}' apps/miniapp/src/pages/dealer.tsx (phải rỗng) | chưa kiểm |  |
| C-082 | A1-023 (+A4-026) | Trang game 1.285 dòng/~20 khối, không điều hướng nội bộ; hai điểm danh (Điểm Xanh và Vườn) mỗi ngày | apps/miniapp/src/pages/game.tsx; apps/api/src/modules/loyalty/loyalty.service.ts:1127-1143 | miniapp/pages/game+api/loyalty+game | UI | L | opus | wc -l apps/miniapp/src/pages/game.tsx; ảnh game: 2 màn đầu chứa hành động chính; static-scan alias game = 0 | chưa kiểm |  |
| C-083 | A4-021 | Định dạng số không nhất quán (1250000, 65.000 xu, toLocaleString trực tiếp) | apps/miniapp/src/pages/game.tsx:109-204,493,556-634; apps/miniapp/src/pages/order-detail.tsx:205,301,405 | miniapp/pages/game+home+order-detail | UI | S | haiku | grep -rn toLocaleString apps/miniapp/src/pages \| wc -l (phải = 0) | chưa kiểm |  |
| C-084 | A4-017 | Home khi catalog lỗi mất khối im lặng, không thông báo và không nút thử lại | apps/miniapp/src/pages/home.tsx; apps/miniapp/src/components/home | miniapp/pages/home+components/home | UI | S | sonnet | node scripts/uiux/capture.mjs miniapp --only '^home$' --states error --vp 390 --force rồi xem ảnh | chưa kiểm |  |
| C-085 | A1-018 | Nút trong thông báo dẫn sai (regex theo nội dung); tin giảm giá/cộng đồng không có route | apps/miniapp/src/pages/notifications.tsx:286-417; apps/api/src/modules/lifecycle/lifecycle.service.ts:210 | miniapp/pages/notifications+api/lifecycle | UI | M | sonnet | grep -n 'cây\|vườn' apps/miniapp/src/pages/notifications.tsx (hết regex); mọi tin gửi kèm data.route | chưa kiểm |  |
| C-086 | A1-020 (+A1-026) | Hub Cá nhân 15 mục, set READY là code chết, thanh số dư thiếu xu/voucher; cashback còn trong hub | apps/miniapp/src/pages/profile.tsx:26-48; apps/miniapp/src/pages/profile.tsx:288-294 | miniapp/pages/profile | UI | S | sonnet | sed -n '26,48p' apps/miniapp/src/pages/profile.tsx; grep -n cashback apps/miniapp/src/pages/profile.tsx | chưa kiểm | Q-15 |
| C-087 | A1-029 | Đổi vỏ không có danh sách cửa hàng nhận; hai luồng tái chế (đổi vỏ và Gomdon) đều dở/tắt | apps/miniapp/src/pages/refill.tsx:63 | miniapp/pages/refill+api/gomdon | tính năng | S | sonnet | grep -n 'cửa hàng' apps/miniapp/src/pages/refill.tsx | chưa kiểm |  |
| C-088 | A3-013 | Bundle miniapp: entry 617 KB (196 KB gz) + CSS 125 KB, tăng 22% so với audit tháng 9 | apps/miniapp/vite.config.ts; apps/miniapp/src/store/auth.ts | miniapp/vite.config+store/auth | hiệu năng | M | sonnet | cd apps/miniapp && npx vite build && node scripts/loadtest/bundle-size.cjs apps/miniapp/www (mục tiêu entry <450 KB raw) | chưa kiểm |  |
| C-089 | A4-013 | Inter chỉ nạp weight 400/500 nhưng UI dùng 600/700 (đậm giả) | packages/design-tokens/src/fonts.css; apps/miniapp/src/components/ui/chip.tsx:50 | packages/design-tokens | UI | S | sonnet | DevTools Network có file weight 600/700; chụp lại home và so ảnh | chưa kiểm |  |
| C-090 | A2-016 (+A5N-08 liên quan) | shared-types gần như không dùng (web 0 file); API trả thẳng entity Prisma, lộ cột nội bộ | packages/shared-types/src; apps/api/src/modules/checkout/checkout.service.ts:658-662 | packages/shared-types+api controllers+web/lib+miniapp/services | hạ tầng | L | sonnet | grep -rln '@tubutree/shared-types' apps/web/src \| wc -l (>0); snapshot test /checkout/place-order không chứa idempotencyKey | chưa kiểm |  |
| C-091 | A1-030 | Admin chia 2 nơi (web 19 tab và miniapp /admin); 6 endpoint admin có API mà không có UI | apps/web/src/app/admin/page.tsx:117-137 | web/admin | tính năng | L | sonnet | grep -rn 'attendance/live\\|manual-checkout\\|payroll/.*recompute' apps/web/src apps/miniapp/src (hiện 0) | chưa kiểm |  |
| C-092 | A1-031 | Admin đơn thiếu địa chỉ giao và lịch sử trạng thái; nhập ID thô; không duyệt đánh giá/định kỳ | apps/web/src/app/admin/page.tsx:1891-1899; apps/web/src/app/admin/page.tsx:2257-2263 | web/admin | tính năng | M | sonnet | grep -n 'shippingAddress\\|status-history' apps/web/src/app/admin/page.tsx | chưa kiểm |  |
| C-093 | A4-027 (+A4-009 phần admin web) | Admin web: 19 tab trong một trang 2.714 dòng, tab cuộn ngang ở 390px, nút nhỏ 23-67/tab | apps/web/src/app/admin/page.tsx:116-136 | web/admin | UI | L | sonnet | ls apps/web/src/app/admin (có thư mục theo tab); chạy scripts/uiux metrics web: tap<44 giảm | MỘT PHẦN (A4 verifier xác nhận số đo nút nhỏ, P2 cho phần admin web; A4-027 chưa kiểm) | Q-29 |
| C-094 | A1-039 | Hoá đơn VAT: nhận yêu cầu lúc thanh toán nhưng không có nút xuất (issue-invoice không ai gọi) | apps/api/src/modules/orders/orders.controller.ts:43; apps/web/src/app/admin/page.tsx | web/admin+api/orders | tính năng | S | sonnet | grep -rn issue-invoice apps/web/src apps/miniapp/src (hiện 0) | chưa kiểm |  |
| C-095 | A1-015 | Tên miền lệch: SITE_URL mặc định shop. nhưng PROD/CORS dùng app.; middleware rewrite host shop. | apps/web/src/lib/site.ts:7; apps/web/src/middleware.ts:29-30 | web/lib+middleware+miniapp/share | hạ tầng | S | sonnet | grep -rn 'shop.tubutree.com' apps --include=*.ts --include=*.tsx | MỘT PHẦN (A1 verifier x2: khẳng định 'CORS chỉ có app.' SAI vì main.ts cho mọi *.tubutree.com; còn lại middleware và link chia sẻ; host PROD chưa kiểm chứng; hạ P2) | Q-20 |
| C-096 | A1-035 | Cổng web /merchant trùng gian hàng miniapp và chỉ xem; TODO 'đối tác tự giao' | apps/web/src/app/merchant/page.tsx:1273-1306; apps/api/src/modules/merchant/merchant.service.ts:531 | web/merchant+api/merchant | tính năng | S | sonnet | grep -n TODO apps/api/src/modules/merchant/merchant.service.ts | chưa kiểm | Q-19 |
| C-097 | A4-003 | Web chưa dùng palette DS v2: 0 lớp v2, 227 lần palette v1 cam/lá, 0 Fraunces (hai diện mạo) | apps/web/tailwind.config.ts:24-33; apps/web/src/app/page.tsx:22,48 | web/tailwind+app | UI | L | sonnet | node scripts/uiux/static-scan.mjs (web legacyPalette=0); node scripts/uiux/capture.mjs web --only '^home$' --vp 390 --force | XÁC NHẬN (A4 verifier: P1 chỉ khi chủ dự án muốn đồng bộ thương hiệu, nếu không P2; chưa có quyết định nên xếp P2) | Q-25 |

### P3 (27)

| Mã C | ID gốc (+Trùng) | Tiêu đề | File chính | Nhóm file | Loại | Công sức | Model | Lệnh kiểm chứng | Verifier | Quyết định |
|---|---|---|---|---|---|---|---|---|---|---|
| C-098 | A1-042 | 19 endpoint API không FE nào gọi (faqs, issue-invoice, redeem-points, status-history...) | apps/api/src/modules (nhiều module) | api (nhiều module) | tính năng | M | sonnet | với mỗi path: grep -rn '<path>' apps/web/src apps/miniapp/src | chưa kiểm |  |
| C-099 | A1-045 | Ghi nhận giới thiệu chỉ giữ 3 ngày (attribution_days); khoá last_click_window_days là khoá chết | apps/api/src/modules/affiliate/affiliate.service.ts:95 | api/affiliate | tính năng | S | haiku | grep -n attribution_days apps/api/src/modules/affiliate/affiliate.service.ts | chưa kiểm | Q-31 |
| C-100 | A3-015 | Hai danh sách chưa giới hạn: affiliateLink.findMany và subscription.findMany theo user | apps/api/src/modules/affiliate/affiliate.service.ts:141; apps/api/src/modules/subscriptions/subscriptions.service.ts:85 | api/affiliate+subscriptions | hiệu năng | S | haiku | grep -n findMany <hai file> có take | chưa kiểm |  |
| C-101 | A3-017 | Cron đêm retention quét toàn bộ đơn: 476 ms ở 200k đơn, tăng tuyến tính | apps/api/src/modules/analytics/analytics-aggregation.service.ts:18-36 | api/analytics | hiệu năng | M | sonnet | scripts/loadtest/explain-cron.sql mục C1 | chưa kiểm |  |
| C-102 | A2-023 | Tồn kho âm lọt qua forcePancakeStock/create làm reserveAvailable trả số âm | apps/api/src/modules/catalog/variation-stock.ts:122-131,145-166; apps/api/src/modules/integrations/pancake/pancake-sync.service.ts:197 | api/catalog+integrations/pancake | dữ liệu | S | sonnet | race-spec: stock=-3, reserveAvailableVariationStock(q=5) kết quả 0, reservedStock không giảm | chưa kiểm (chưa kiểm chứng Pancake có trả số âm) |  |
| C-103 | A2-025 | Flash sale: lần mua đầu đồng thời của cùng user nhận thông báo PRICE_CHANGED sai nghĩa | apps/api/src/modules/flash-sale/flash-sale.service.ts:117-137; apps/api/src/modules/checkout/checkout.service.ts:219-232 | api/flash-sale+checkout | dữ liệu | S | haiku | race-spec flash (thuộc A2-015 mục 3) | chưa kiểm |  |
| C-104 | A3-016 | Cron sync Pancake và import giá đại lý truy vấn tuần tự từng biến thể (chục nghìn query/15 phút) | apps/api/src/modules/integrations/pancake/pancake-sync.service.ts:169-178; apps/api/src/modules/admin/admin.service.ts:661-667 | api/integrations/pancake+admin | hiệu năng | M | sonnet | log thời gian một lượt sync trên dữ liệu Pancake giả lập | chưa kiểm (chưa đo được vì thiếu khoá Pancake) |  |
| C-105 | A2-019 | Trùng khái niệm dữ liệu: 2 sổ điểm/xu, 2 hệ điểm danh, lô vườn 2 dạng lưu, cờ 'đã nhắc' rải 6 nơi | apps/api/prisma/schema.prisma:904,989,934,1374-1376 | api/loyalty+wallet+game+lifecycle+prisma | dữ liệu | L | opus | không áp dụng (thiết kế); xong khi có ADR được duyệt; liên quan Q-03 | chưa kiểm | Q-03 |
| C-106 | A2-021 | Vòng phụ thuộc mức thư mục (12 module); DealerService lấy qua ModuleRef, lỗi wiring chỉ log | apps/api/src/modules/orders/order-reversal.service.ts:200-208 | api/orders+integrations/pancake+gomdon+dealer | hạ tầng | M | sonnet | node cycles.cjs apps/api/src (script ở phụ lục A2): SCC lớn phải tách | chưa kiểm |  |
| C-107 | A2-020 | Trạng thái kiểu String thay vì enum (Subscription.status, OrderStatusHistory...) | apps/api/prisma/schema.prisma:2161,1862-1865 | api/prisma | dữ liệu | S | haiku | grep -nE 'status +String' apps/api/prisma/schema.prisma (ngắn lại) | chưa kiểm |  |
| C-108 | A2-018 | Bảng/cột chết hoặc chỉ ghi không đọc (CohortRepeatSnapshot, FunnelDailySnapshot, BetaFeedback...) | apps/api/prisma/schema.prisma; apps/api/src/modules/analytics/analytics-aggregation.service.ts:13-16 | api/prisma+analytics+beta+affiliate | dữ liệu | S | haiku | grep -rnw 'dauEventBased\\|badgeImageUrl\\|pancakeCustomerId' apps/*/src | chưa kiểm |  |
| C-109 | A2-022 | 13 partial unique index chốt tiền mà Prisma không thấy; db push sẽ làm mất chúng | apps/api/prisma/migrations; CI | api/prisma+CI | hạ tầng | S | haiku | docker exec tubu_pg psql -U tubu -d <db> -At -c "select count(*) from pg_indexes where schemaname='public' and indexdef ilike '% where %'" (phải ra 13) | XÁC NHẬN (A2 verifier: pg_indexes trả đúng 13) |  |
| C-110 | A2-024 | Review @@unique([userId, productId]) chặn đánh giá lại khi mua lại | apps/api/prisma/schema.prisma:2037 | api/prisma+reviews | tính năng | S | sonnet | không áp dụng (quyết định nghiệp vụ) | chưa kiểm | Q-30 |
| C-111 | E2E-002 | E2E API quote: JWT của user không tồn tại nên API trả 'tham chiếu không hợp lệ' thay vì 'giỏ trống' | apps/e2e/tests/api.spec.ts:47; apps/e2e/global-setup.ts:50-55 | apps/e2e (fixture) | test | S | haiku | npx playwright test api.spec.ts (seed user thật trong global-setup hoặc nới regex) | XÁC NHẬN lỗi tái hiện; trôi fixture, không phải lỗi checkout (hạ P1->P3) |  |
| C-112 | A4-036 | Tailwind preflight áp dụng toàn cục, có thể ghi đè kiểu ZaUI | apps/miniapp/tailwind.config.ts; apps/web/tailwind.config.ts | miniapp+web/tailwind | UI | M | sonnet | so ảnh trước/sau trên 5 trang khi đặt corePlugins.preflight:false | chưa kiểm |  |
| C-113 | A4-031 | Emoji dùng làm icon ngoài game/hạng (onboarding, reviews-section, post-card, bank-payment...) | apps/miniapp/src/components/onboarding.tsx; apps/miniapp/src/pages/bank-payment.tsx | miniapp/components+pages (nhiều file) | UI | S | haiku | static-scan emoji của các file này = 0 | chưa kiểm |  |
| C-114 | A4-034 | Thiếu <main> và <h1> ở 34/41 trang Mini App; web 3 trang không h1 | apps/miniapp/src/components/ui/page-header.tsx | miniapp/components/ui | UI | S | sonnet | axe landmark-one-main và page-has-heading-one = 0 | chưa kiểm |  |
| C-115 | A1-041 | Màn đơn trống 'Mua đơn đầu - nhận 30k voucher' sai nghĩa (voucher cấp trước đơn đầu, từ 199k) | apps/miniapp/src/i18n/vi.ts:204 | miniapp/i18n | UI | S | haiku | grep -n 'Mua đơn đầu' apps/miniapp/src/i18n/vi.ts | chưa kiểm |  |
| C-116 | A4-038 | Chữ <12px nhiều (web home 86, brand-story 29, order-detail 20, product-detail 17) | apps/miniapp/src/pages/brand-story.tsx; apps/web/src/app/page.tsx | miniapp/pages+web/app | UI | S | haiku | đo lại cột chữ <12px bằng build-report-data.mjs metrics | chưa kiểm |  |
| C-117 | A1-044 | Đăng ký CTV một chạm, không có bước đồng ý điều khoản hoa hồng/thuế | apps/miniapp/src/pages/affiliate.tsx:154 | miniapp/pages/affiliate | tính năng | S | sonnet | sed -n '150,160p' apps/miniapp/src/pages/affiliate.tsx | chưa kiểm |  |
| C-118 | A1-040 | Beta Tester không có tác dụng; góp ý beta không ai đọc | apps/miniapp/src/pages/settings.tsx:95; apps/api/src/modules/beta/beta.service.ts:18 | miniapp/pages/beta+settings | tính năng | S | haiku | grep -rn 'betaFeedback\\|BetaFeedback' apps/web/src apps/api/src/modules/admin (hiện 0) | chưa kiểm | Q-19 |
| C-119 | A4-032 | Trang 404: tiêu đề đè lên hình minh hoạ | apps/miniapp/src/pages/not-found.tsx | miniapp/pages/not-found | UI | S | haiku | chụp lại not-found__normal__390.png | chưa kiểm |  |
| C-120 | A4-022 | Lịch sử vận chuyển in nguyên chuỗi status của hãng vận chuyển, '—' khi rỗng | apps/miniapp/src/pages/order-detail.tsx:186,401 | miniapp/pages/order-detail | UI | S | haiku | test order-detail với status:'delivering' hiển thị nhãn tiếng Việt | chưa kiểm (giá trị thực tế khi chạy chưa kiểm chứng) |  |
| C-121 | A4-037 | Lỗi console khi chụp (game 4, beta 3, admin 3): chưa phân biệt lỗi do mock hay lỗi thật | scripts/uiux/results/*.jsonl | scripts/uiux (không sửa mã) | test | S | haiku | đọc trường errors trong results/*.jsonl, tách lỗi do mock với lỗi thật | chưa kiểm (nguyên nhân chưa kiểm chứng) |  |
| C-122 | A4-040 | Admin web dùng window.confirm gốc, không đồng bộ giao diện | apps/web/src/app/admin/page.tsx:865,882,1307 | web/admin | UI | S | haiku | grep -n 'window.confirm' apps/web/src/app/admin/page.tsx | chưa kiểm |  |
| C-123 | A4-035 | Thứ tự heading sai ở 12 màn web (heading-order) | apps/web/src/app | web/app | UI | S | haiku | axe heading-order = 0 trên web | chưa kiểm |  |
| C-124 | A4-030 | Merchant web chuyển tab bằng state, không có URL (?tab=) | apps/web/src/app/merchant/page.tsx:180,255 | web/merchant | UI | S | haiku | reload trang giữ nguyên tab | chưa kiểm |  |

## 3. Đã loại

| ID | Lý do |
|---|---|
| Typecheck-001 (A6) | Lỗi MÔI TRƯỜNG, không phải lỗi code: thiếu packages/shared-types/dist nên tsc báo TS2307. Điều phối viên đã build lại shared-types, typecheck API + miniapp exit 0. Fresh clone cần build @tubutree/shared-types trước khi chạy tsc trần (pnpm install không sửa được, đúng như verifier A6). Không lập mục P3 riêng vì turbo.json đã có dependsOn ['^build'] cho typecheck/lint/test nên chạy qua turbo là đủ. |
| API-001 (A6) | Không tái hiện: verifier A6 chạy jest đầy đủ được 133 suite/2364 test pass, riêng src/modules/game 10 suite/149 test pass (có game-gift.service.spec.ts); điều phối viên cũng không tái hiện. Nhiều khả năng là OOM/áp lực RAM lúc chạy đồng thời. |
| A6 mục 4 #2 'ZaloPay webhook: không có test' (khẳng định con) | BÁC BỎ: zalopay.service.spec.ts có describe handleCallback (verify MAC) với khoảng 12 test (MAC sai/đúng, idempotent, đơn đã huỷ/trả, lệch số tiền...). |
| A6 mục 4 'COD refund dedicated: không có' (khẳng định con) | BÁC BỎ: test/integration-race/cod-return-refund.race-spec.ts tồn tại (3 case). |
| A6 mục 4 'commission reconcile / coupon farm: không có' (khẳng định con) | CHƯA RÕ, nhiều khả năng sai (có cashback.service.spec, points-reconcile.spec, affiliate.race-spec; coupons.service.spec có perUserLimit); không lập mục. Khoảng trống thật về race test nằm ở A2-015. |
| A1-015 phần 'CORS chỉ có app.' (khẳng định con) | BÁC BỎ: apps/api/src/main.ts:36 có tubuOriginRe cho mọi *.tubutree.com nên shop. không bị chặn CORS. Phần còn lại (middleware rewrite shop., link chia sẻ trỏ host khác) vẫn nằm ở mục tên miền. |
| A2-001 phần 'chặn đặt hàng vĩnh viễn' (khẳng định con) | BÁC BỎ: checkout.tsx:734 gọi ensurePhone().catch(() => undefined) rồi vẫn đặt đơn. Tác động đúng là phiên khách kẹt, không gộp được vào tài khoản Zalo thật. |
| A3-002 phần '42 request qua Home+Browse+PDP vượt 60/phút' (khẳng định con) | BÁC BỎ: @nestjs/throttler 6.5.0 đếm theo class+handler+IP nên các route khác nhau không dùng chung bộ đếm 60/phút. |
| A4-007 phần 'lùi trạng thái làm sai điểm/hoa hồng' (khẳng định con) | BÁC BỎ: order-transition.ts chặn chuyển ngược, API trả 400. Phần PENDING_PAYMENT->DELIVERED (nhảy cóc hợp lệ) vẫn đúng và nằm trong mục đơn CK lẻ. |
| A5N-03 phần 'duyệt hồ sơ chưa gán tier' (khẳng định con) | SAI nguyên nhân: luồng duyệt hồ sơ bắt buộc chọn tier (admin.service.ts:228). Đường thật là admin cấp role DEALER trực tiếp qua POST /admin/users/role. Mục A5N-03 vẫn giữ. |
| nightly ec569f5b52 'feed tag upsert tuần tự' (A3 mục 2/4) | KHÔNG ĐÚNG: community-feed.service.ts:497 đã dùng Promise.all. |
| A5 Phần 1: tái kiểm 22 P0 audit 2026-09 và bản vá prod-readiness | Không phải phát hiện mới: 20 mục còn hiệu lực (đã vá), A3-01 chỉ vá nửa code (nửa còn lại cần Zalo duyệt mẫu ZNS: việc của chủ dự án), A5-10 (CCCD/Cloudinary trên Zalo) chưa kiểm chứng động. Hai bản vá A6-06 và A7-01 để lộ hệ quả mới đã lập mục (A5N-01, A5N-06). |

## 4. Quyết định chủ dự án (đã gộp)

Sắp theo mức ảnh hưởng (tiền và dữ liệu trước). Phương án khuyến nghị đứng đầu và có nhãn "(Khuyến nghị)". Dòng "Mã C liên quan" của mỗi câu trỏ về các dòng catalog ở mục 2.

### Q-01. Đơn CTV 'lên đơn hộ': ai là chủ đơn, tiền hoàn về đâu khi huỷ/trả, và CTV có được tự giới thiệu chính mình không?

1. (Khuyến nghị) Hoàn về khách thật theo SĐT snapshot; chặn CTV tự huỷ đơn đã PAID (admin xử lý hoàn); về lâu dài ghi userId = khách cuối, CTV là referrer; chặn CTV nhập SĐT của chính mình để hưởng hoa hồng
2. Giữ hoàn về ví CTV, buộc CTV tự chuyển lại khách (không kiểm soát được, dễ mất tiền khách)
3. Chỉ chặn đường huỷ của CTV, giữ nguyên chủ đơn là CTV (vá nhanh, north-star của khách cuối vẫn không đo được)

- **Lý do:** Khách đã trả tiền cho đơn hộ nhưng tiền huỷ/trả chảy vào ví CTV rồi rút được; đồng thời điểm, hạng, nhắc mua lại đi về CTV chứ không về khách.
- **ID liên quan:** A5N-01, A1-011
- **Mã C liên quan:** C-001, C-028
- **Nguồn câu hỏi:** A5 Q1 + A1 (luật CTV tự giới thiệu)

### Q-02. Chặn đường rò xu -> giọt nước -> coupon 30k như thế nào?

1. (Khuyến nghị) Bỏ mua giọt nước bằng xu và đặt minOrder của coupon thu hoạch theo ngưỡng chung (199k)
2. Giữ mua giọt nước nhưng nâng giá lên từ 50 xu/giọt
3. Giữ nguyên (tối đa 90.000đ coupon/ngày/người, đã có trần 3 lần/ngày)

- **Lý do:** 500đ Ví đổi ra coupon 30.000đ (gấp 60 lần); xu thưởng giới thiệu cũng đi theo đường này.
- **ID liên quan:** A1-002
- **Mã C liên quan:** C-009
- **Nguồn câu hỏi:** A1 Q2

### Q-03. Có gộp Điểm Xanh với TubuXu không?

1. (Khuyến nghị) Gộp xu thưởng vào Điểm Xanh, bỏ đổi Ví -> Xu, cho Ví trả một phần đơn
2. Giữ hai loại nhưng đổi tên cho rõ và cho xu trả một phần đơn
3. Giữ nguyên

- **Lý do:** Khách đang phải học 6 loại giá trị và hơn 9 tỉ giá; điểm và xu cùng trừ tiền đơn theo hai luật khác nhau. Khi gộp: xu mua từ Ví là tiền trả trước nên không thể cho hết hạn, và phải giữ sổ giao dịch cũ.
- **ID liên quan:** A1-001, A2-019
- **Mã C liên quan:** C-047, C-105
- **Nguồn câu hỏi:** A1 Q1

### Q-04. Khi bắt đầu ghi sổ cái Ví Tubu, xử lý số dư ví hiện có thế nào?

1. (Khuyến nghị) Ghi một dòng 'Số dư đầu kỳ' cho mỗi user tại ngày triển khai
2. Dựng lại lịch sử từ 6 nguồn (payout, cashback, hoàn đơn, trả ví, đổi xu, rút); tốn công và không khớp 100% vì gộp khách không để lại vết

- **Lý do:** Chính xác tuyệt đối từ ngày triển khai, công sức nhỏ. Nâng A2-004 lên P1 nếu muốn có sao kê ví trước khi mở rút tiền rộng rãi.
- **ID liên quan:** A2-004, A1-022
- **Mã C liên quan:** C-060
- **Nguồn câu hỏi:** A2 Q3

### Q-05. Luật cấp và thu hồi voucher thưởng: gộp 3 chương trình giới thiệu thế nào, và voucher chào mừng/sinh nhật/winback có cấp cho tài khoản guest không?

1. (Khuyến nghị) Một chương trình thưởng theo đơn thứ 2 trong 30 ngày, thu hồi nếu trả hàng, CTV chỉ hưởng hoa hồng; mọi voucher chào mừng/sinh nhật/winback chỉ cấp cho user có zaloId/SĐT thật
2. Giữ voucher 50k+50k nhưng hiển thị rõ và thu hồi khi trả hàng; guest vẫn nhận voucher (rủi ro farm)
3. Giữ nguyên

- **Lý do:** Voucher REFER chạy ngầm, không thu hồi khi đơn bị trả và cộng thêm cho CTV; guest chỉ cần deviceId là nhận voucher, rò ngân sách khuyến mãi.
- **ID liên quan:** A1-005, A5N-09
- **Mã C liên quan:** C-003, C-059
- **Nguồn câu hỏi:** A1 Q4 + A5 Q4

### Q-06. Đơn chuyển khoản lẻ chưa trả tiền xử lý thế nào?

1. (Khuyến nghị) Thêm nút 'Đã nhận tiền' (ghi log), chặn DELIVERED khi CK chưa PAID, tự huỷ PENDING_PAYMENT sau 24 giờ
2. Chỉ dựa vào webhook Pancake và huỷ tay
3. Giữ nguyên

- **Lý do:** Hiện admin có thể đẩy đơn chưa trả tiền lên DELIVERED, kích hoạt điểm và hoa hồng; webhook không tới thì đơn giữ tồn kho mãi.
- **ID liên quan:** A1-006, A4-007
- **Mã C liên quan:** C-024
- **Nguồn câu hỏi:** A1 Q6

### Q-07. Đại lý được cấp role DEALER nhưng chưa có tier: xử lý đơn CREDIT thế nào?

1. (Khuyến nghị) creditLimit mặc định = 0: từ chối CREDIT khi chưa có tier; setUserRole('DEALER') bắt buộc chọn tier
2. Cho hạn mức mặc định nhỏ (ví dụ 2 triệu); vẫn hở nếu admin quên

- **Lý do:** Hiện đơn CREDIT 1,6 tỷ vẫn được tạo và ghi nợ không trần.
- **ID liên quan:** A5N-03
- **Mã C liên quan:** C-008
- **Nguồn câu hỏi:** A5 Q2

### Q-08. Đơn đại lý còn backorder: khi nào đẩy sang kho Pancake?

1. (Khuyến nghị) Chỉ khi đủ 100% hàng (đúng thiết kế đã duyệt 12/09)
2. Tách đơn: phần có hàng đẩy ngay, phần đặt trước đẩy sau
3. Đẩy ngay toàn bộ (phải bỏ cơ chế giữ chỗ backorder)

- **Lý do:** Reconcile 15 phút đang đẩy sớm trái thiết kế và đang chạy trên PROD.
- **ID liên quan:** A2-002, A1-034
- **Mã C liên quan:** C-011, C-081
- **Nguồn câu hỏi:** A2 Q4

### Q-09. Có duyệt các luật tiền mà agent trước đã tự chọn và đang chạy trong code không (11 mục A1 mục 7)?

1. (Khuyến nghị) Duyệt cả gói: điểm danh 8 điểm/tuần, hạng chỉ tính mua hàng, doanh số CTV theo đơn chốt, bỏ bonus bậc CTV, claim đại lý bị từ chối là cuối (thêm nút admin 'mở lại'), thưởng quý ngày 10 (đặt timeZone), Tab Đơn hàng 7 tab, ETA ẩn tới khi đặt config
2. Duyệt trừ Cổ Thụ giảm 5% mọi đơn (đổi sang freeship và quà)
3. Xem từng mục

- **Lý do:** Đã chạy trong code nhưng chưa được duyệt; riêng Cổ Thụ 5% là chi phí cần chủ dự án duyệt, và kỳ thưởng Q3 PROD (01-10/10) có thể đã chạy theo luật cũ (chưa kiểm chứng).
- **ID liên quan:** A1 mục 7, A2-012
- **Mã C liên quan:** C-026
- **Nguồn câu hỏi:** A1 Q7

### Q-10. Ngưỡng thưởng/doanh số đại lý có cần hỗ trợ trên 2,1 tỷ đồng không?

1. (Khuyến nghị) Có: chuyển các cột tích luỹ sang BigInt (kèm @Max ở DTO)
2. Giới hạn cứng 2 tỷ ở form admin

- **Lý do:** Đại lý VIP có doanh số quý/năm có thể vượt mức Int 32-bit; hiện nhập vượt là lỗi 500 và chặn claim.
- **ID liên quan:** A2-009, A5N-10
- **Mã C liên quan:** C-055
- **Nguồn câu hỏi:** A2 Q8

### Q-11. Gộp khách vào tài khoản Zalo khi cả hai đã điểm danh cùng ngày: xử lý lượt trùng thế nào?

1. (Khuyến nghị) Giữ cả hai lượt điểm đã cộng, đổi khoá dòng của khách thành MERGED:<guestId>:<dayKey>
2. Chỉ giữ lượt của tài khoản Zalo và trừ điểm lượt của khách

- **Lý do:** Điểm đã thuộc về khách, trừ lại gây khó chịu; số tiền nhỏ.
- **ID liên quan:** A2-001
- **Mã C liên quan:** C-004
- **Nguồn câu hỏi:** A2 Q1

### Q-12. Khách xoá địa chỉ đang gắn gói giao định kỳ thì sao?

1. (Khuyến nghị) Chặn xoá và báo 'Địa chỉ đang dùng cho gói X, hãy đổi địa chỉ gói trước'
2. Cho xoá nhưng chuyển gói sang PAUSED và gửi thông báo
3. Cho xoá và tự chuyển gói sang địa chỉ mặc định

- **Lý do:** Hiện gói bị xoá cứng, không thông báo, không khôi phục (đang chạy trên PROD).
- **ID liên quan:** A2-003
- **Mã C liên quan:** C-014
- **Nguồn câu hỏi:** A2 Q2

### Q-13. Quy tắc gói giao định kỳ: có cho nhiều gói cùng sản phẩm không; lần giao đầu và cách thanh toán?

1. (Khuyến nghị) Cho nhiều gói cùng sản phẩm chỉ khi khác địa chỉ, chặn trùng cùng địa chỉ (câu phụ A1-016: giao lần đầu ngay hoặc cho chọn ngày; cho phép thêm Ví/CK)
2. Mỗi sản phẩm chỉ 1 gói đang hoạt động
3. Không chặn (giữ như hiện tại)

- **Lý do:** Double-tap đang tạo 2 gói và mỗi kỳ 2 đơn COD; đơn đầu hiện chậm một chu kỳ, chỉ COD.
- **ID liên quan:** A2-011, A1-016
- **Mã C liên quan:** C-015, C-057
- **Nguồn câu hỏi:** A2 Q6 + A1 (thanh toán gói định kỳ)

### Q-14. Sản phẩm bị gỡ/chưa duyệt còn trong giỏ hoặc đường đặt khác: ứng xử thế nào?

1. (Khuyến nghị) Lọc khỏi giỏ + báo 'sản phẩm đã ngừng bán' và re-check lúc đặt ở mọi đường (giỏ, CTV lên hộ, định kỳ, đại lý)
2. Chỉ cảnh báo, vẫn cho đặt (không khuyến nghị)

- **Lý do:** Nhất quán lời hứa kiểm định; SP PENDING_REVIEW hiện vẫn isActive=true nên đặt được qua 3 đường ngoài giỏ.
- **ID liên quan:** A5N-04
- **Mã C liên quan:** C-007
- **Nguồn câu hỏi:** A5 Q3

### Q-15. Hoàn tiền sàn ngoài (AccessTrade) giữ hay ẩn?

1. (Khuyến nghị) Ẩn khỏi hub tới khi có key AccessTrade và đo được tác động lên đơn tại Tubu
2. Giữ
3. Xoá hẳn

- **Lý do:** Kéo khách sang sàn khác, ngược north-star; chưa có key nên không có nguồn tiền hoàn thật.
- **ID liên quan:** A1-026, A1-020
- **Mã C liên quan:** C-086
- **Nguồn câu hỏi:** A1 Q3

### Q-16. Season Pass, 'cây thật' PanNature và perk hạng: vận hành thật hay ẩn?

1. (Khuyến nghị) Ẩn Season Pass; đổi lời 'cây thật' thành 'góp quỹ trồng cây'; bỏ perk không có quy trình khỏi hạng, tới khi có công cụ tạo mùa và hợp đồng PanNature có ngân sách
2. Vận hành tiếp: làm admin tạo mùa, quy trình trồng và báo cáo cây
3. Xoá cả hai

- **Lý do:** Đang hứa với khách (có rủi ro quảng cáo sai) mà không có quy trình thực hiện; mùa duy nhất hết hạn 31/08.
- **ID liên quan:** A1-007, A1-025
- **Mã C liên quan:** C-010, C-044
- **Nguồn câu hỏi:** A1 Q5

### Q-17. Thông tin liên hệ thật cho trang Về Tubu Tree & Hỗ trợ?

1. (Khuyến nghị) Cung cấp hotline, Zalo OA, email thật và lưu vào app_config để admin sửa
2. Ẩn các dòng chưa có tới khi có

- **Lý do:** Số '1900 1234' có vẻ là số mẫu (chưa kiểm chứng), khách gọi nhầm và Zalo có thể từ chối khi duyệt bản. Chỉ chủ dự án biết kênh hỗ trợ thật.
- **ID liên quan:** A1-008, A4-008
- **Mã C liên quan:** C-019
- **Nguồn câu hỏi:** A4 D3

### Q-18. Chủ nhãn có được tự xem đơn và doanh thu nhãn mình không?

1. (Khuyến nghị) Có: tab chỉ-đọc trong /brand-owner, lọc theo nhãn, ẩn tên/SĐT khách, chỉ hiện số đơn/doanh thu/sản phẩm bán chạy
2. Gửi báo cáo tuần qua Zalo OA
3. Không, quản trị gửi tay

- **Lý do:** Chủ nhãn là đối tác bán hàng; ẩn PII để tránh vấn đề dữ liệu cá nhân. Cần chốt phạm vi dữ liệu được xem.
- **ID liên quan:** A1-013, A4-001
- **Mã C liên quan:** C-006, C-034
- **Nguồn câu hỏi:** A4 D1

### Q-19. Giữ hay bỏ: cổng web /merchant (hướng marketplace), Mua chung nhóm, Beta Tester?

1. (Khuyến nghị) Bỏ lối vào /merchant khỏi web khách và ghi rõ 'chỉ xem'; xoá /beta; giữ Mua chung chờ số liệu dùng
2. Đầu tư /merchant thành marketplace thật (đối tác tự giao, đối soát)
3. Giữ nguyên

- **Lý do:** /merchant trùng gian hàng miniapp, chỉ xem nhưng lại được quảng bá cho khách; Beta không có tác dụng; chưa có số liệu dùng Mua chung trong DB local.
- **ID liên quan:** A1-035, A1-040
- **Mã C liên quan:** C-096, C-118
- **Nguồn câu hỏi:** A1 (câu chờ ngoài 8 câu)

### Q-20. Tên miền chính của web/link chia sẻ?

1. (Khuyến nghị) app.tubutree.com: đổi mặc định ở site.ts và fallback ở miniapp
2. shop.tubutree.com kèm loại khỏi rewrite ở middleware (CORS đã cho mọi *.tubutree.com)

- **Lý do:** SITE_URL mặc định shop. nhưng PROD/CORS dùng app.; host nào đang phục vụ web trên PROD chưa kiểm chứng.
- **ID liên quan:** A1-015
- **Mã C liên quan:** C-095
- **Nguồn câu hỏi:** A1 Q8

### Q-21. Thời hạn lưu dữ liệu log và coupon cá nhân hết hạn?

1. (Khuyến nghị) analytics thô 13 tháng (sau đó chỉ giữ số tổng hợp), notification_logs 180 ngày, webhook/OA 90 ngày, refresh token thu hồi/hết hạn 30 ngày; dọn coupon cá nhân hết hạn theo lô (số của A2)
2. Phương án A3: analytics thô 180 ngày, thông báo 90 ngày, token 30 ngày (nhẹ đĩa hơn trên VPS dùng chung)
3. Giữ vĩnh viễn và nâng ổ đĩa

- **Lý do:** Hai báo cáo đề xuất số khác nhau (A2: 13 tháng/180 ngày; A3: 180/90 ngày): cần chủ dự án chốt, kể cả nghĩa vụ lưu kế toán/riêng tư; coupon cá nhân là nguyên nhân gốc của A3-001.
- **ID liên quan:** A2-007, A3-008, A3-001
- **Mã C liên quan:** C-012, C-030, C-046
- **Nguồn câu hỏi:** A2 Q7 + A3 Q2/Q4

### Q-22. Chính sách giới hạn tốc độ (throttle)?

1. (Khuyến nghị) Đếm theo userId khi có JWT, theo IP khi chưa đăng nhập; giới hạn chung khoảng 300/phút; đăng nhập/refresh đếm theo thiết bị hoặc tài khoản và nới giới hạn IP; SSR web được miễn
2. Giữ nguyên (rủi ro 429 với IP dùng chung)
3. Tắt ở lớp app, dựa vào Caddy/Cloudflare

- **Lý do:** Verifier A3 đính chính: khoá đếm theo từng route nên rủi ro thực nằm ở IP dùng chung (wifi cửa hàng, CGNAT) và route nóng nhất; auth 5 lần/phút/IP vẫn đúng.
- **ID liên quan:** A3-004, A3-002, A3-003
- **Mã C liên quan:** C-005, C-033
- **Nguồn câu hỏi:** A3 Q1

### Q-23. Có chạy từ 2 instance API trong thời gian tới không (và cấu hình VPS Vietnix)?

1. (Khuyến nghị) Chưa: ở 1 instance, sửa A3-001, feed counts, Home BFF trước (giảm tải nhiều hơn)
2. Có: chuyển cache và throttler sang Redis, thêm khoá phân tán cho cron, đặt connection_limit theo vCPU

- **Lý do:** Cache, bộ đếm throttle và cron nằm trong RAM từng instance nên nhân bản làm lệch và có thể chạy cron trùng. Cần biết số vCPU/RAM VPS.
- **ID liên quan:** A3-011, A2-012
- **Mã C liên quan:** C-026, C-048
- **Nguồn câu hỏi:** A3 Q3

### Q-24. Có whitelist eventName của POST /events không?

1. (Khuyến nghị) Whitelist; chặn client ghi order_paid/order_placed; throttle theo userId
2. Để mở, lọc ở tầng báo cáo (dữ liệu bẩn khó truy vết)

- **Lý do:** Bảo toàn tính đúng của analytics v2 sắp dựng; hiện client bơm được sự kiện giả với số tiền tuỳ ý.
- **ID liên quan:** A5N-07, A2-007
- **Mã C liên quan:** C-030, C-046
- **Nguồn câu hỏi:** A5 Q5

### Q-25. Web có cần đồng bộ diện mạo với Mini App (xanh rừng + Fraunces) không?

1. (Khuyến nghị) Có, làm trước các trang khách (/, /san-pham, /gio-hang, /thanh-toan, /tai-khoan, /s), admin để sau
2. Giữ cam/lá v1 cho web và chấp nhận hai diện mạo
3. Thu hẹp web thành trang đích dẫn vào Mini App

- **Lý do:** Khách vào từ link CTV thấy Web trước nên nó quyết định ấn tượng thương hiệu. Nếu chọn có thì nâng A4-003 lên P1.
- **ID liên quan:** A4-003
- **Mã C liên quan:** C-097
- **Nguồn câu hỏi:** A4 D2

### Q-26. Chốt thuật ngữ cho voucher và tiền tệ nội bộ?

1. (Khuyến nghị của điều phối, hợp nhất A1/A4) 'Mã giảm giá' cho voucher/coupon (đã dùng ở giỏ và checkout) và 'Tubu Xu' một dạng; sẽ đổi lại nếu Q-03 chọn gộp xu vào Điểm Xanh
2. Phương án A4 D4: voucher = 'Mã ưu đãi', 'Tubu Xu', 'Điểm Xanh', 'Điểm uy tín'
3. Giữ như hiện tại

- **Lý do:** A1 (mục 3.3) đề xuất 'Mã giảm giá' còn A4 (D4) đề xuất 'Mã ưu đãi' cho voucher: hai báo cáo mâu thuẫn, cần chủ dự án chọn một.
- **ID liên quan:** A4-019, A1-021
- **Mã C liên quan:** C-074
- **Nguồn câu hỏi:** A4 D4 + A1 mục 3.3

### Q-27. Có xin quyền Zalo (tên + số điện thoại) để tự điền địa chỉ không?

1. (Khuyến nghị) Có, xin ở bước đặt đơn đầu tiên
2. Chỉ nhớ tỉnh/phường lần trước
3. Giữ form trống

- **Lý do:** Giảm khoảng 3-4 chạm cho khách mới; cần Zalo duyệt quyền và nói rõ mục đích sử dụng.
- **ID liên quan:** A4-024
- **Mã C liên quan:** C-065
- **Nguồn câu hỏi:** A4 D5

### Q-28. Có bỏ chặn phóng to (user-scalable=no) không?

1. (Khuyến nghị) Bỏ chặn
2. Chỉ giữ chặn ở màn Vòng quay/Game (dùng touch-action riêng)

- **Lý do:** Vi phạm WCAG 1.4.4; ảnh hưởng người lớn tuổi. WebView Zalo có tôn trọng thuộc tính hay không chưa kiểm chứng.
- **ID liên quan:** A4-004
- **Mã C liên quan:** C-075
- **Nguồn câu hỏi:** A4 D6

### Q-29. Admin web có cần dùng được trên điện thoại không?

1. (Khuyến nghị theo A4) Chỉ máy tính (tối ưu bảng, bỏ ràng buộc 44px)
2. Hỗ trợ điện thoại cho các tab Đơn hàng/Đổi trả/Rút tiền

- **Lý do:** Quyết định phạm vi công sức cho 19 tab; duyệt đơn và rút tiền ngoài văn phòng là nhu cầu thật nhất (lưu ý: lý do của A4 nghiêng về phương án hai).
- **ID liên quan:** A4-027, A4-009
- **Mã C liên quan:** C-021, C-093
- **Nguồn câu hỏi:** A4 D7

### Q-30. Đánh giá khi mua lại (Review unique theo userId+productId)?

1. (Khuyến nghị) Giữ 1 đánh giá cho mỗi sản phẩm nhưng cho sửa khi mua lại, hiển thị 'đã mua N lần', chỉ thưởng điểm lần đầu
2. 1 đánh giá cho mỗi đơn, thưởng điểm mỗi lần

- **Lý do:** Chống farm điểm mà vẫn cập nhật được cảm nhận.
- **ID liên quan:** A2-024
- **Mã C liên quan:** C-110
- **Nguồn câu hỏi:** A2 Q5

### Q-31. Cửa sổ ghi nhận giới thiệu CTV (hiện 3 ngày) nên là bao nhiêu?

1. (Khuyến nghị của điều phối, báo cáo A1 chỉ nói 'thường 7-30') 7 ngày
2. 30 ngày
3. Giữ 3 ngày

- **Lý do:** Khách cân nhắc lâu hơn 3 ngày thì CTV mất hoa hồng; đây là quyết định nghiệp vụ, không có số liệu PROD.
- **ID liên quan:** A1-045
- **Mã C liên quan:** C-099
- **Nguồn câu hỏi:** A1 (câu chờ ngoài 8 câu)

Các câu của A6 (E2E mock, typecheck workspace, lint DS v2) là việc kỹ thuật, không cần chủ dự án quyết; đã xử lý trong C của E2E-001 và dòng DS v2.

## 5. Ghi chú môi trường và sự cố

- A3 (sự cố đã khôi phục): khi xoá worktree tạm D:\tubu-wt-perf, git worktree remove --force đi xuyên junction và xoá nhầm 34 file đã theo dõi trong packages/ cùng node_modules (apps/*, .pnpm). Đã khôi phục 34 file từ HEAD (git status sạch), pnpm install --frozen-lockfile --offline --force dựng lại node_modules; API 3001, miniapp 3113, web 3112 trả 200. Bộ test chưa chạy lại ngay sau sự cố (verifier A6/A2 sau đó chạy lại API: 2364 test pass). Thư mục rỗng D:\tubu-wt-perf còn sót, xoá tay khi tiện.
- A3: DB tubutree_perf (1033 MB; 50.004 user, 200.000 đơn, 105.005 coupon) được GIỮ LẠI để đo lại; instance API cổng 3301 đã tắt; dọn dữ liệu test bằng scripts/loadtest/cleanup-test-data.sql. Máy chỉ còn 1,1-1,9 GB RAM trống khi đo nên số tuyệt đối chỉ là cận tham khảo; số trên VPS Vietnix chưa kiểm chứng. Dữ liệu seed lớn là tổng hợp (A3-001 phụ thuộc số coupon cá nhân thật trên PROD).
- A4: 3 trang miniapp (/loyalty, /brand/:slug, /s/:slug) KHÔNG chụp được vì Vite dev 3113 trả 504 'Outdated Optimize Dep' cho qrcode (không được phép restart Vite), chấm theo mã; cùng nguyên nhân khiến E2E design-system-pilot.miniapp.spec.ts:236 fail (A6, nghi môi trường). Toàn bộ /api bị mock nên không đánh giá được ảnh thật; web next lint không chạy (thiếu RAM). docs/2026-10-review/screens ~90 MB (554 PNG) chưa commit. Verifier A4 chạy lại static-scan.mjs ghi đè static-scan.json với số liệu y hệt.
- A1: không truy cập PROD (mọi câu về PROD là chưa kiểm chứng); DB local ít dữ liệu (13 user, 3 đơn) và chưa chạy seed mới nhất (thiếu 8 mẫu thông báo, birthdayVoucherAmount NULL, khoá shipping.eta_*); khi viết screens/ còn rỗng. Không có e2e cho game, cộng đồng, flash sale, tạo gói định kỳ, Ví/Xu, giới thiệu, cashback, mua chung, AI, Academy, Content Kit, nhân sự, /merchant, web shop khách, admin xử lý đơn.
- A2: DB tạm tubutree_shadow_a2, tubutree_a2_probe, tubutree_verify_a2, tubutree_verify2_a2 đã tạo rồi DROP; không ghi gì vào tubutree/tubutree_it/tubutree_perf. 12 migration chưa lên PROD (22e36d4..HEAD) chỉ thêm mới, riêng unique mission_progress có thể fail nếu PROD có dòng trùng (chưa kiểm chứng). A2-002 và A2-003 ĐANG chạy trên PROD (22e36d4); A2-001 chưa có trên PROD, phải sửa trước lần deploy kế tiếp. Không có madge nên dò vòng phụ thuộc bằng script Tarjan tự viết.
- A5: NODE_ENV=development, không có secret tích hợp nên KHÔNG kiểm chứng động được đường fail-closed của webhook ở production (chỉ đọc mã); webhook token tĩnh chưa thấy chống replay/nonce (ghi nhận, chưa lập mục). Fixture sec-a5-* đã dọn (verifier kiểm lại 0 dòng). A5-10 (upload CCCD/Cloudinary trên Zalo) chưa kiểm chứng. JWT strategy không truy DB nên đổi role/block chỉ hiệu lực khi access token 15 phút hết hạn (đánh đổi thiết kế đã biết). Xin Zalo duyệt mẫu ZNS (A3-01) là việc của chủ dự án.
- A6: verifier không chạy lại được miniapp (838 test) và race (39 test) do RAM, nên hai bộ này CHƯA kiểm chứng; số liệu API đúng là 133 suite/2364 test pass (báo cáo gốc ghi 2356 + 1 suite lỗi). 8 E2E fail tái hiện đúng (6 miniapp, 1 API, 1 web admin), cả ba mục đều là trôi mock/fixture chứ không phải lỗi sản phẩm. Thư mục scripts/loadtest/ và scripts/uiux/ chưa commit là của các agent khác.
- Chung: mọi báo cáo chỉ đọc/đo trên commit 080bc75, không sửa mã nguồn, không đụng PROD. Catalog này không kiểm chứng lại bằng code; trạng thái 'chưa kiểm' nghĩa là verifier chỉ kiểm các mục P0/P1 (và vài mục P2 lấy mẫu).
