# PC-4 — Báo cáo thực thi

## C-016 — Xoá tài khoản: màn admin xử lý + ẩn danh dữ liệu cá nhân — XONG

Commit: `74ca61c` (service + race spec), `73ae344` (API admin), `28cf5fb` (web admin), `1a6e292` (chú thích).

### Đã làm
- `apps/api/src/modules/users/account-deletion.service.ts` (mới):
  - `process(requestId, adminId, note?)`: một transaction, khoá `FOR UPDATE` dòng yêu cầu rồi dòng user. Yêu cầu đã RESOLVED → trả `alreadyProcessed: true` (idempotent; 2 admin cùng bấm chỉ xử lý một lần). Không còn user → chỉ đóng yêu cầu.
  - Chặn (400, `code: ACCOUNT_DELETION_BLOCKED`, `message` tiếng Việt liệt kê đủ lý do, `blockers[]`) khi: quyền ADMIN/STAFF; Ví Tubu ≠ 0; còn xu; hoàn tiền mua sắm chờ (`cashbackPending` hoặc CashbackTransaction PENDING/CONFIRMED); đơn PENDING_PAYMENT/CONFIRMED/PACKED/SHIPPING; lệnh rút REQUESTED/APPROVED; đổi trả REQUESTED; OrderCustomerRefund PENDING; gói định kỳ ACTIVE/PAUSED; hoa hồng PENDING/LOCKED/APPROVED chưa vào lô trả; tổng công nợ đại lý ≠ 0. Bị chặn thì rollback, yêu cầu giữ PENDING.
  - Ẩn danh: users (fullName = "Người dùng đã xoá"; phone/email/dob/avatarUrl/zaloId/zalo token = null; metadata chỉ còn `anonymizedAt` + `deletionRequestId`; `isBlocked = true`); mọi địa chỉ (recipient/phone/street; giữ dòng vì FK RESTRICT từ gói đã huỷ); `orders.shippingAddress` (recipient/phone/street, giữ tỉnh/huyện/xã + mã) và `note`/`recyclingNote` = null; thu hồi mọi refresh token; hồ sơ đại lý (ownerName/phone/address/ảnh CCCD/ảnh cửa hàng); gian hàng (gỡ xuất bản, xoá tài khoản ngân hàng + địa chỉ/SĐT kho). Đóng mọi yêu cầu PENDING trùng của cùng khách.
  - KHÔNG xoá/sửa: đơn (tổng tiền, trạng thái, userId), hoa hồng, sổ Ví, lệnh rút, sổ công nợ đại lý, xu/điểm.
  - `list(status)`: tối đa 100 yêu cầu + thông tin khách + lý do chặn hiện tại (gom bằng groupBy, cố định 8 truy vấn cho cả danh sách).
- `admin-account-deletion.controller.ts` (mới, `@Roles('ADMIN')`): `GET /admin/account-deletion-requests?status=PENDING|RESOLVED|ALL`, `POST /admin/account-deletion-requests/:id/process` body `{ note? }` (≤500 ký tự). Đăng ký trong `users.module.ts`.
- Web admin: `apps/web/src/components/admin/account-deletion-panel.tsx` (mới): khối "Yêu cầu xoá tài khoản" hiển thị dưới tab **Người dùng**: lọc Chờ xử lý/Đã xử lý/Tất cả, xem lý do chặn, ô ghi chú, nút "Xử lý (ẩn danh)" (khoá khi còn lý do chặn, hỏi xác nhận, hiện lỗi server). `page.tsx` chỉ thêm 2 dòng (import + một dòng render) để tránh đụng PC-8.

### Test (đỏ → xanh)
- `apps/api/test/integration-race/account-deletion.race-spec.ts` (Postgres thật, 11 test): ẩn danh đúng + giữ đơn/hoa hồng/sổ Ví/đơn khách khác; chặn ví, xu, hoàn tiền, đơn đang giao, lệnh rút, hoa hồng+đổi trả+công nợ đại lý (liệt kê đủ), quyền STAFF; 404; 6 lần gọi đồng thời → đúng 1 lần xử lý; đóng yêu cầu trùng; danh sách có lý do chặn. Đỏ trước khi có service (không tìm thấy module). Kiểm thêm: bỏ 2 câu `FOR UPDATE` thì test đồng thời đỏ (`Expected length: 1, Received length: 6`), khôi phục thì xanh.
- `apps/api/src/modules/users/admin-account-deletion.controller.spec.ts` (3 test): chỉ ADMIN, không public; chuyển tham số; từ chối status lạ.
- `apps/web/src/components/admin/account-deletion-panel.spec.tsx` (5 test).

### Lệnh kiểm chứng + output
```
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand account-deletion address-subscription
PASS test/integration-race/account-deletion.race-spec.ts
PASS test/integration-race/address-subscription.race-spec.ts
Tests:       18 passed, 18 total
cd apps/api && npx jest --maxWorkers=1 src/modules/users      -> Tests: 23 passed, 23 total
cd apps/web && npx vitest run src/components/admin/account-deletion-panel.spec.tsx   -> Tests 5 passed (5)
npx tsc --noEmit -p tsconfig.json (api), npx tsc --noEmit (web): không lỗi
npx eslint <các file đã sửa> (api + web): không lỗi
```

### Migration
Không cần: bảng `account_deletion_requests` đã có `status/adminNote/reviewedBy/reviewedAt`.

### Giả định
- Ẩn danh thay vì xoá cứng; đơn, hoa hồng, sổ Ví, lệnh rút (kể cả `bankInfo` của lệnh đã trả), công nợ đại lý giữ cho kế toán/đối soát.
- Còn xu cũng chặn (xu là tiền khách đã trả, không tự huỷ thay khách); Điểm Xanh không chặn (không quy ra tiền).
- `invoiceRequest` (MST, tên công ty, email nhận hoá đơn) giữ nguyên: là chứng từ hoá đơn VAT của doanh nghiệp.
- Giữ `referralCode`, `pancakeCustomerId` (định danh nội bộ/đối soát, không phải dữ liệu cá nhân trực tiếp).
- Không báo khách sau khi xử lý: zaloId/SĐT đã xoá nên không còn kênh; CSKH liên hệ khách trước khi bấm (ghi vào ô ghi chú).

### Việc còn lại (ngoài nhóm file của gói)
- `JwtAuthGuard` không kiểm `isBlocked`: access token cũ còn dùng được tới hết `JWT_ACCESS_TTL` (15 phút) sau khi ẩn danh; refresh đã bị chặn. Nên kiểm `isBlocked` ở guard hoặc checkout.
- Link CTV/`referralCode` của tài khoản đã ẩn danh vẫn gắn được hoa hồng cho đơn mới (affiliate/checkout không kiểm `isBlocked` của người giới thiệu).
- Dữ liệu đã đẩy sang Pancake, ảnh CCCD/ảnh trong kho lưu trữ, nội dung bài viết cộng đồng do khách tự viết không bị xoá (cần quy trình xoá ở dịch vụ ngoài / storage).

---

## C-022 — Công tắc tắt thông báo khuyến mãi lưu server, server tôn trọng — XONG

Commit: `458722a` (API + migration + race spec), `afa0f1f` (miniapp Cài đặt).

### Đã làm
- Migration `20261010090000_user_notify_prefs`: thêm `users.notifyPromo`, `users.notifyGarden` BOOLEAN NOT NULL DEFAULT true (additive; khách cũ giữ hành vi gửi như hiện tại).
- `notifications/notification-categories.ts` (mới): phân nhóm theo templateCode. PROMO = CART_ABANDONED, PRICE_DROP_ALERT, FLASH_STARTING, VOUCHER_EXPIRING, WELCOME/BIRTHDAY/WINBACK/MILESTONE_VOUCHER, REORDER_REMINDER, STOREFRONT_TRENDING_PRODUCTS; GARDEN = GAME_CHECKIN_REMINDER, GAME_TREE_THIRSTY; còn lại là tin giao dịch, luôn gửi.
- `NotificationsService.notify`: khách đã tắt nhóm (hoặc không tìm thấy user) thì bỏ qua hoàn toàn (không ghi tin trong app, không gửi ZNS). Đây là điểm gửi chung của mọi luồng marketing (lifecycle, remarketing, vouchers, flash-sale, storefront-reminder đều gọi `notify`), nên không phải sửa từng nơi gửi.
- API `GET/PATCH /me/notifications/prefs` (`{ notifyPromo?, notifyGarden? }`, kiểm boolean bằng class-validator).
- Miniapp `settings.tsx`: công tắc đọc/ghi server (khoá cho tới khi tải xong; lưu lỗi thì trả về như cũ và báo lỗi). Khách từng tắt trên máy (bản cũ lưu `tubu_prefs`): lần mở Cài đặt đầu tiên đẩy lựa chọn TẮT lên server rồi xoá khỏi máy (không bao giờ tự bật lại). Bỏ công tắc giả "Cập nhật đơn hàng" (tin giao dịch luôn gửi), thay bằng dòng thông tin. Cả hàng là `role=switch` cao >= 44px.

### Test (đỏ → xanh)
- `apps/api/src/modules/notifications/notification-prefs.spec.ts` (25 test): đỏ trước khi có module (`Cannot find module './notification-categories'`).
- `apps/api/test/integration-race/notification-prefs.race-spec.ts` (Postgres thật, 3 test): mặc định true; tắt thì DB lưu false, `notify(CART_ABANDONED)` không tạo `notification_logs`, ZNS không gọi, `ORDER_CONFIRMED` vẫn ghi; bật lại thì gửi.
- `apps/miniapp/src/pages/settings.spec.tsx` (5 test, gồm cả C-078): chạy với `settings.tsx` cũ thì 5 failed; bản mới 5 passed.

## C-018 — Quiz onboarding — XONG
Commit `b392e6d`. `components/onboarding-rules.ts` (mới) + `onboarding.tsx`: quiz chỉ hiện ở `/` cho khách chưa làm; không hiện ở route khác (sản phẩm, gian hàng, checkout...), khi URL có `?s=`/`?ref=`, hoặc khi app được mở bằng link CTV/gian hàng (đọc `window.location` lúc khởi động). "Để sau" là nút thật, nhớ 7 ngày (`tubu_onboarding_snooze_until` trong bộ nhớ Zalo); chưa đọc xong bộ nhớ thì không hiện (tránh nháy). Bỏ lời hứa "nhận quà chào mừng" và "sẽ gợi ý sản phẩm phù hợp hơn" (segments chưa nơi nào dùng; quà chào mừng do cron cấp cho mọi khách mới, không phụ thuộc quiz). Test `components/onboarding.spec.tsx` 12 test; với `onboarding.tsx` cũ: 4 failed.

## C-019 — Trang Về Tubu Tree (Q-17) — XONG
Commit `32db9b9` (API), `8fa3218` (miniapp).
- `seed.ts` thêm 3 khoá `createOnly`: `support.hotline` = "0899 149 229", `support.email` = "tubutree@gmail.com", `support.zalo_oa_name` = "" (chưa có OA). Admin sửa ở tab Cấu hình (`PUT /admin/config`; tên khoá không khớp regex bí mật).
- `GET /config/public` trả thêm `support: { hotline, email, zaloOaName }`; giá trị trống hoặc sai kiểu thành null. Thiếu khoá thì mặc định giá trị Q-17. (Sửa `system-config.controller.ts` ngoài nhóm file: bắt buộc vì đặc tả C-019 yêu cầu SystemConfig public; chỉ thêm 3 khoá đọc + 1 trường trả về.)
- `about.tsx`: khối Hỗ trợ đọc config, ẩn dòng null (ẩn cả khối nếu trống hết). FAQ đọc `GET /faqs` (FAQ admin), nhóm lọc theo `category` admin nhập; admin chưa có FAQ hoặc lỗi mạng thì dùng bản dự phòng trong `about-data.ts`, đã sửa câu thanh toán (COD, chuyển khoản, Ví Tubu, TubuXu; bỏ ZaloPay). Bỏ khỏi bản dự phòng 2 câu chưa kiểm chứng được: phí ship cố định 19.000đ/200.000đ (ngưỡng là config) và "góp 1 cây thật" (Q-16 do PD-1). Đổi nút sang Button DS v2.
- Test: `system-config.controller.spec.ts` +2 (đỏ 2 failed → xanh); `pages/about.spec.tsx` 4 test (bản cũ: 3 failed). `grep -n 1900 apps/miniapp/src/pages/about.tsx` rỗng; `grep -rn "'/faqs'" apps/miniapp/src` có kết quả.

## C-078 — ActionLink + mũi tên — XONG
Commit `afa0f1f` (settings), `5eefdd6` (addresses). Sổ địa chỉ: Đặt mặc định/Sửa/Xóa là `<button>` cao 44px; nút thêm/xoá dùng Button DS v2 (icon Lucide `Plus`). Cài đặt: hàng điều hướng dùng `ListRow` (role=button, minHeight 44, icon `ChevronRight`), không còn ký tự `›`. Hub Cá nhân: "Sửa hồ sơ ›" thay bằng icon. Test `addresses.spec.tsx` 3 test (bản cũ 3 failed) + 1 test trong `settings.spec.tsx`.

## C-085 — Nút trong thông báo — XONG (đích bài cộng đồng cụ thể: chờ module feed gửi post_id)
Commit `f6bd0ef` (lifecycle), `deb069e` (miniapp).
- `notificationAction(templateCode, data)` trong `notifications.tsx`: quyết định nút theo loại tin + dữ liệu có cấu trúc (order_code, product_slug, post_id, `data.route` nội bộ an toàn); bỏ hết regex theo nội dung. Thêm đích: PRICE_DROP_ALERT → sản phẩm (thiếu slug → Yêu thích), COMMUNITY_* → `/feed/:post_id` hoặc `/feed`, VOUCHER → "Xem mã giảm giá", POINTS → "Xem Điểm Xanh", CASHBACK → Ví Tubu, SUBSCRIPTION → gói định kỳ, DEALER, GROUP_BUY, REFILL. OPS_* không có nút. Mọi nút dùng Button DS v2.
- `lifecycle.service.ts`: PRICE_DROP_ALERT gửi kèm `product_slug` (tra theo productId, một truy vấn cho cả lô).
- Test: `notifications.spec.ts` +15 (bản cũ 15 failed); `lifecycle.service.spec.ts` sửa 1 + thêm 1 (đỏ 1 failed → xanh). `grep -n 'cây\|vườn' apps/miniapp/src/pages/notifications.tsx` rỗng.

## C-086 — Hub Cá nhân (Q-15) — XONG
Commit `81375f7`. Bỏ "Hoàn tiền sàn ngoài" khỏi hub (trang `/cashback` vẫn còn, chỉ ẩn lối vào); CTV + đại lý (+ nhãn hàng nếu có) gom nhóm "Hợp tác"; xoá set `READY` chết và snackbar "đang hoàn thiện"; thanh số dư 2×2: Điểm Xanh, Ví Tubu, TubuXu (`/me/wallet`, chung cache `['wallet']`), Mã giảm giá (số mã, chung cache `['coupons']`); ô số dư có role=button + aria-label. Test `profile.spec.ts` +3, `profile-hub.spec.tsx` 2 (bản cũ: 4 failed).

### Lệnh kiểm chứng (lượt C-022..C-086) + output
```
cd apps/api && npx jest --maxWorkers=1 src/modules/notifications src/modules/lifecycle src/modules/system-config src/modules/users src/modules/admin/config-redaction
Test Suites: 10 passed, 10 total
Tests:       148 passed, 148 total
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand notification-prefs account-deletion
PASS test/integration-race/notification-prefs.race-spec.ts
PASS test/integration-race/account-deletion.race-spec.ts
Tests:       14 passed, 14 total
cd apps/miniapp && npx vitest run src/pages/settings.spec.tsx src/pages/addresses.spec.tsx src/pages/about.spec.tsx src/pages/notifications.spec.ts src/pages/profile.spec.ts src/pages/profile-hub.spec.tsx src/components/onboarding.spec.tsx
Test Files  7 passed (7)
Tests  60 passed (60)
npx tsc --noEmit -p tsconfig.json (api), npx tsc --noEmit (miniapp): không lỗi
npx prisma migrate deploy + migrate diff (Postgres 5564): "All migrations have been successfully applied." / "-- This is an empty migration."
ESLint file đã sửa: 0 lỗi mới. settings/addresses/about/notifications/onboarding nay 0 lỗi (trước có lỗi import Button zmp-ui / màu thô); profile.tsx còn 3 lỗi màu nền rgba có sẵn từ trước (trước 5).
```

### Migration
`apps/api/prisma/migrations/20261010090000_user_notify_prefs` (2 cột BOOLEAN NOT NULL DEFAULT true, không cần backfill).

### Giả định
- Khách tắt "Khuyến mãi & mã giảm giá" thì không nhận cả tin trong app lẫn ZNS của nhóm PROMO; mã giảm giá vẫn được CẤP (chỉ không báo), khách thấy trong mục Mã giảm giá. REORDER_REMINDER và STOREFRONT_TRENDING_PRODUCTS xếp vào PROMO (tiếp thị); POINTS_EXPIRING, GAME_WATER_GIFT (bạn tặng nước) là tin tài khoản, luôn gửi.
- Không cho tắt tin đơn hàng (tin giao dịch: giao hàng, hoàn tiền); hiện dòng "luôn bật" thay công tắc giả.
- "Để sau" của quiz nhớ 7 ngày theo đề xuất A1-010.
- Thanh số dư dùng nhãn "TubuXu" như checkout/i18n hiện có.

### Việc còn lại (ngoài nhóm file của gói)
- `community-feed.service.ts` (module feed) chưa gửi `post_id` trong tin COMMUNITY_*: nút hiện dẫn tới `/feed`; thêm `post_id: post.id` ở 3 lệnh `notify` thì FE tự mở thẳng bài (đã hỗ trợ).
- Lựa chọn tắt cũ lưu trên máy chỉ được chuyển lên server khi khách mở trang Cài đặt; muốn chuyển ngay lúc mở app thì gọi `legacyOptOuts` trong `components/app.tsx` (ngoài nhóm file).
- `services/account-api.ts`/`shop-api.ts` chưa khai báo kiểu `support`/prefs (để tránh đụng gói khác, kiểu khai báo cục bộ ở `pages/about-data.ts`, `pages/settings-notify-prefs.ts`).
- Template tin tiếp thị mới phải được thêm vào `notification-categories.ts`; nếu không sẽ bị coi là tin giao dịch và gửi cả khi khách đã tắt.

## Review lượt 1

| # | Mức | Finding | Kết quả |
|---|-----|---------|---------|
| 1 | major | FLASH_STARTING xếp PROMO → khách tắt khuyến mãi bấm "Nhắc tôi" mất nhắc vĩnh viễn (cron đặt `notifiedAt` trước khi `notify`) | **Đúng, đã sửa** (`a2a0a79`): FLASH_STARTING sang TRANSACTIONAL. Đã xác minh `flash-sale.service.ts:notifyStartedFlashSales` claim `notifiedAt` rồi mới gọi `notify`, `notify` return sớm không ném lỗi nên không có đường thử lại. Test đỏ→xanh: `notification-prefs.spec.ts` "đã tắt khuyến mãi nhưng tự bấm Nhắc tôi giờ vàng → vẫn nhận nhắc". |
| 2 | major | Lựa chọn tắt cũ trên máy chỉ đẩy lên server khi khách mở Cài đặt | **Đúng, đã sửa** (`5afa5df`): `pages/settings-legacy-sync.ts` (`syncLegacyNotifyPrefs` + hook `useLegacyNotifyPrefsSync`), `components/app.tsx` gọi hook khi `status === 'authenticated'` (2 dòng: import + gọi; file ngoài nhóm, chèn tối thiểu vì đây là nơi duy nhất chạy lúc mở app). Khoá cũ trên máy chỉ xoá SAU khi server nhận, lỗi mạng thì lần mở sau thử lại; máy không có khoá cũ thì không gọi mạng. Logic ở Cài đặt giữ làm dự phòng. Test mới `settings-legacy-sync.spec.tsx` (4 ca, gồm hook chỉ chạy khi đã đăng nhập) — đỏ (module chưa có) → xanh. |
| 3 | minor | Ẩn danh giữ `referralCode` → link/mã cũ của CTV vẫn ghi công | **Đã sửa** (`89237c2`): đổi `referralCode` sang `DEL<16 hex>` ngẫu nhiên (mọi tra cứu theo mã cũ ở checkout/auth/affiliate trượt — slug gian hàng = mã cũ viết thường cũng trượt vì tra theo `referralCode.toUpperCase()`), và cho hết hạn ngay các `ReferralTouch` còn hiệu lực trỏ về tài khoản đó. Race spec thêm ca kiểm cả hai. |
| 4 | minor | Ẩn danh sót `invoiceRequest`, gian hàng `title/headerNote/avatarUrl/coverUrl` | **Đã sửa** (`89237c2`): bỏ `email` khỏi `invoiceRequest`; gian hàng đặt `title` = "Người dùng đã xoá", xoá `headerNote/avatarUrl/coverUrl`. **Cố ý giữ** (ghi trong docblock service): MST/tên công ty/địa chỉ hoá đơn (hoá đơn VAT phải lưu theo luật kế toán), `Payout.bankInfo` và `OrderCustomerRefund` (chứng từ chi tiền phải đối soát). |
| 5 | minor | JwtStrategy không kiểm `isBlocked` → access token cũ còn dùng tới hết hạn | **Không sửa, chấp nhận rủi ro + ghi tài liệu**: `JWT_ACCESS_TTL` mặc định `15m` (`env.validation.ts`, `.env`). Kiểm `isBlocked` trong JwtStrategy là thêm 1 truy vấn DB cho MỌI request toàn hệ thống, thuộc module auth (ngoài nhóm file, gói khác có thể đang sửa) — cần quyết định riêng. Refresh token đã thu hồi, `issueTokens` chặn `isBlocked`. Ghi chú trong docblock `AccountDeletionService`. |
| 6 | minor | WELCOME/BIRTHDAY/MILESTONE_VOUCHER xếp PROMO | **Sửa một phần** (`a2a0a79`): MILESTONE_VOUCHER sang TRANSACTIONAL (thưởng khách tự kiếm qua giới thiệu, mã vẫn phát nên khách phải được báo). WELCOME/BIRTHDAY/WINBACK giữ PROMO (mã tặng mang tính tiếp thị, khách vẫn thấy trong mục Mã giảm giá). Cần chủ dự án xác nhận — xem Giả định. |
| 7 | minor | DEALER_* chỉ dành cho admin dẫn sang `/dealer`; COMMUNITY_* không gửi `post_id` | **Đã sửa**: (`281d954`) DEALER_CREDIT_PAYMENT_REPORTED, DEALER_REWARD_CLAIM_NEW (đã xác minh chỉ gửi cho user ADMIN ở `dealer.service.ts:394/920`) không còn nút; (`8740771`) `community-feed.service.ts` gửi `post_id` ở 3 lệnh notify (COMMUNITY_POST_APPROVED, NEW_ANSWER/EXPERT_REPLIED, BEST_ANSWER — đều kênh INAPP nên khoá thêm không ảnh hưởng ZNS). File module feed ngoài nhóm: sửa tối thiểu 3 dòng + 4 kỳ vọng spec. |
| 8 | minor | `toggleNotify` không chặn bấm chồng | **Đã sửa** (`f5d57a6`): công tắc khoá (`aria-disabled`) khi đang lưu; test đỏ→xanh "bấm hai lần liên tiếp khi đang lưu → chỉ gửi một yêu cầu". |

### Lệnh kiểm chứng + output
```
cd apps/api && npx jest src/modules/notifications/notification-prefs.spec.ts --maxWorkers=1
  trước sửa: Tests: 3 failed, 25 passed, 28 total   sau sửa: Tests: 28 passed, 28 total
cd apps/api && npx jest src/modules/feed/community-feed.service.spec.ts --maxWorkers=1
  trước sửa: Tests: 3 failed, 207 passed            sau sửa: Tests: 210 passed, 210 total
cd apps/api && npx jest src/modules/flash-sale src/modules/notifications src/modules/users --maxWorkers=1
  Test Suites: 5 passed, 5 total / Tests: 97 passed, 97 total
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand account-deletion
  trước sửa: Tests: 1 failed, 11 passed (Expected: not "9CSJNQZ9TA")   sau sửa: Tests: 12 passed, 12 total
  ... notification-prefs: Tests: 3 passed, 3 total
cd apps/miniapp && npx vitest run src/pages/settings-legacy-sync.spec.tsx src/pages/settings.spec.tsx
  Test Files 2 passed / Tests 10 passed (settings.spec trước sửa: 1 failed | 5 passed)
cd apps/miniapp && npx vitest run src/pages/notifications.spec.ts
  trước sửa: 1 failed | 29 passed   sau sửa: Tests 30 passed (30)
npx tsc --noEmit -p tsconfig.json (api), npx tsc --noEmit (miniapp): không lỗi
ESLint file đã sửa: 0 lỗi (chỉ cảnh báo consistent-type-imports ở spec, cùng mẫu với spec có sẵn)
```

### Migration
Không có migration mới.

### Giả định (lượt review)
- Tin "nhắc giờ vàng" (khách tự đăng ký) và "thưởng mốc giới thiệu" là tin khách yêu cầu/được hưởng → luôn gửi. Mã chào mừng/sinh nhật/winback vẫn coi là tiếp thị.
- Lựa chọn tắt cũ trên máy được gán cho tài khoản đăng nhập đầu tiên trên máy đó sau khi cập nhật (máy dùng chung là trường hợp hiếm; luôn chỉ đẩy "tắt", không bao giờ bật lại).

### Việc còn lại
- Quyết định có kiểm `isBlocked`/tokenVersion trong JwtStrategy hay không (ảnh hưởng toàn API; hiện rủi ro giới hạn 15 phút).
- Xác nhận nghiệp vụ phân loại WELCOME/BIRTHDAY_VOUCHER.
