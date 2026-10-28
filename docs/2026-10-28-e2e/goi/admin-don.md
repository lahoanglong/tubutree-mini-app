# Gói admin-don: đơn, đổi/trả, ô ngày, câu đố trong quản trị

- Nhánh `review/e2e-admin-don`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-admin-don`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG.
- CHẠY SAU admin-hopviec VÀ api-tin: trước khi làm, `git merge review/e2e-admin-hopviec` và `git merge review/e2e-api-tin` (workflow đã gộp thì bỏ qua). Sau đó gói này được sửa `page.tsx`, `admin-client.ts`, `admin-order-filter.ts`, `order-status-actions.tsx`, `customer-refunds-tab.tsx`, `order-returns.service.ts`, `customer-refunds.service.ts`.
- Mục: E-29, E-51, E-53, E-54, E-58, E-70, E-76, E-118.

## Mục tiêu

Mọi ô ngày giờ trong quản trị hiện dd/mm/yyyy và giờ 24h. CSKH đi từ hồ sơ khách sang đơn và ngược lại trong một chạm. Kế toán xác nhận tiền xong thấy câu báo và đơn kế. Bộ lọc đơn lưu được trong URL. Tìm được đổi/trả và hoàn tiền theo mã đơn hoặc SĐT. Có màn thêm câu đố.

## Được sửa

- Web: `app/admin/page.tsx`, `lib/admin-client.ts`, `components/admin/vn-date-input.tsx` (+ spec), `claim-campaign-panel.tsx`, `season-admin.tsx`, `pos-credits-tab.tsx`, `payout-admin-tab.tsx`, `waste-point-detail.tsx`, `user-detail-drawer.tsx`, `order-extra-filters.tsx`, `order-status-actions.tsx`, `customer-refunds-tab.tsx`, tab Câu đố mới (ví dụ `components/admin/game-quiz-tab.tsx`), spec cạnh.
- API: `admin/admin-order-filter.ts`, `admin/admin.controller.ts`, `admin/admin.module.ts`, `admin/admin-game-quiz.controller.ts` (mới), `game/game-quiz.service.ts`, `orders/order-returns.service.ts` (chỉ `listForAdmin`), `orders/customer-refunds.service.ts` (chỉ `list`), controller admin của hai service đó, spec cạnh.
- app-core: hàm `isDirectVideoUrl` (file mới, ví dụ `packages/app-core/src/video-url.ts`) + spec. Mini `utils/video-url.ts` thành re-export.

## KHÔNG sửa

- `payroll-admin-tab.tsx` chỉ được sửa ô tháng (E-29); phần thưởng/phạt và tính lại là của admin-congcu. Nếu hai việc đụng cùng dòng, chỉ đổi ô tháng và ghi lại.
- `community-moderation-tab.tsx`, `support-chat-tab.tsx` (admin-congcu); `staff-roster-tab.tsx`, `storefronts-tab.tsx` (admin-nhansu); `ops-inbox-tab.tsx`, `ops-inbox.service.ts` (admin-hopviec, đã xong trước).
- `game/game.service.ts`, `game-garden.service.ts`, `game.controller.ts` (diem). `apps/api/prisma/schema.prisma`: câu đố dùng bảng `GameQuiz` có sẵn, không migration.
- KHÔNG đổi thưởng câu đố: `rewardPts = 0`, `waterReward` theo độ khó như seed (8/10/12).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- admin-congcu sửa `payroll-admin-tab.tsx` song song (thêm nút từng dòng). Gói này chỉ thay ô tháng ở dòng 151. Giữ khối sửa nhỏ để gộp không xung đột.
- admin-nhansu (sau admin-hopviec) có thể sửa `page.tsx` khu tab nhân sự; giữ khối sửa ở khu đơn/đổi trả/học viện/câu đố.

## Mục việc

### E-29 (P2) Còn ô ngày giờ gốc của trình duyệt (mm/dd, 12h) (VANHANH-08 = R-69)
- Bằng chứng: `app/admin/page.tsx:2675, 2678, 2874, 2877, 3033, 3041` (Giờ vàng `datetime-local`); `components/admin/claim-campaign-panel.tsx:302, 305`; `season-admin.tsx:80, 83`; `pos-credits-tab.tsx:55`; `payout-admin-tab.tsx:151` (tháng); `waste-point-detail.tsx:290`.
- Sửa: dùng `VnDateInput` cho mọi ô ngày; ô tháng dùng `VnMonthInput` (`vn-date-input.tsx:157`). Thêm `VnDateTimeInput` = `VnDateInput` + chọn giờ 00–23 và phút 00/15/30/45, giá trị vẫn `yyyy-mm-ddTHH:mm` để `new Date(...)` giữ nguyên. Áp cho Giờ vàng (tạo và sửa). Giá trị cũ không chia hết 15 phút thì hiện đúng phút cũ (thêm vào danh sách).
- Test: `vn-date-input.spec.tsx` (giờ 24h; giá trị cũ 20:07 vẫn hiện); spec Giờ vàng tạo đợt 20:00; `claim-campaign-panel.spec.tsx`.
- Xong khi: `rg 'type="date"|type="datetime-local"|type="month"' apps/web/src/app/admin apps/web/src/components/admin` không còn kết quả (trừ trong `vn-date-input.tsx` nếu dùng nội bộ).

### E-51 (P3) Hồ sơ khách và chi tiết đơn không dẫn qua lại (VANHANH-07)
- Bằng chứng: `components/admin/user-detail-drawer.tsx:134-155`; `app/admin/page.tsx:1642-1644, 1783-1849, 2123`; `admin/admin-users.controller.ts:29-30`.
- Sửa: API thêm lọc `userId` cho `GET /admin/orders` và file xuất (`admin-order-filter.ts`, cạnh `referrerUserId`). Web: mỗi đơn trong ngăn kéo hồ sơ là nút gọi `onOpenOrder(code)`; nút "Xem tất cả N đơn" gieo `extra.userId`. `OrderDetailBody` thêm dòng "Khách: tên · SĐT · Xem hồ sơ" mở `UserDetailDrawer` (ADMIN hoặc CSKH, theo quyền xem hồ sơ hiện có).
- Test: `user-detail-drawer.spec.tsx`; `page.spec.tsx` (Xem hồ sơ mở ngăn kéo); race `admin-order-list-filters.race-spec.ts` (lọc userId).
- Xong khi: quyền xem không mở rộng cho nhóm khác.

### E-53 (P3) Xác nhận tiền xong câu báo biến mất, phải mở lại đơn kế (VANHANH-10)
- Bằng chứng: `app/admin/page.tsx:1205, 1715`; `components/admin/order-status-actions.tsx:186-193`.
- Sửa: `OrderStatusActions` nhận `onPaid?(message)`. `OrdersTab` giữ dòng báo trên danh sách "Đã ghi nhận đơn X. Còn N đơn chờ." Trên điện thoại, đang ở hàng đợi thì mở đơn kế tiếp trong `q.data` thay vì đóng.
- Test: `page.spec.tsx` (sau xác nhận vẫn thấy câu báo; ngăn kéo sang đơn kế).
- Xong khi: test xanh.

### E-54 (P3) Hàng đợi chuyển khoản chỉ vào được từ thẻ; URL không lưu bộ lọc (VANHANH-11)
- Bằng chứng: `app/admin/page.tsx:390-412, 504-510, 1291-1303`; `components/admin/order-extra-filters.tsx:41, 114`.
- Sửa: `readUrlState`/`writeUrlState` thêm `status`, `invoice`, `queue`. `queueEl` (cả hai khổ) thêm chip "Chuyển khoản chờ tiền (n)" và "Đại lý chờ tiền (n)" (khoá `dealerTransferToConfirm` do admin-hopviec thêm), số từ `getOpsInbox`.
- Test: `page.spec.tsx` (mở `/admin?tab=orders&queue=bank_transfer_to_confirm` thì gọi API có `queue`).
- Xong khi: F5 giữ bộ lọc.

### E-58 (P3) Đổi/trả và hoàn tiền không tìm được theo mã đơn/SĐT (VANHANH-15)
- Bằng chứng: `app/admin/page.tsx:1878`; `lib/admin-client.ts:353, 1482-1485`; `components/admin/customer-refunds-tab.tsx:118`; service `orders/order-returns.service.ts` (`listForAdmin`), `orders/customer-refunds.service.ts` (`list`).
- Sửa: hai API admin thêm `q`: khớp mã đơn chính xác (qua `normalizeAdminOrderSearch`) hoặc SĐT (qua `findSearchUserIds`). Web ô tìm có debounce 300ms ở hai tab.
- Test: spec controller/service cho `q` (mã đơn, SĐT, rỗng); `customer-refunds-tab.spec.tsx`.
- Xong khi: không có `q` thì kết quả như cũ.

### E-70 (P3) Ô "Video URL" Học viện không cảnh báo link Mini không phát được (DODANG-09)
- Bằng chứng: Mini `pages/academy.tsx:217-233`, `utils/video-url.ts`; admin `app/admin/page.tsx:3899-3906, 4004-4006`.
- Sửa: đưa `isDirectVideoUrl` vào app-core; Mini `utils/video-url.ts` re-export. Hai ô "Video URL" admin hiện cảnh báo vàng khi link không phải file video trực tiếp: "Mini App chỉ phát file .mp4/.webm/.m4v. Link này chỉ xem được trên web." Không chặn lưu.
- Test: spec `isDirectVideoUrl` (mp4, YouTube, có query); spec admin (cảnh báo với link YouTube).
- Xong khi: Mini academy không đổi hành vi.

### E-76 (P3) Câu đố Vườn Xanh không có màn quản trị (DODANG-16)
- Phạm vi: chỉ xem, thêm, sửa. KHÔNG xoá, KHÔNG bật/tắt (bảng `GameQuiz` không có `isActive`). `rewardPts = 0`; `waterReward` theo độ khó như seed (8/10/12).
- Bằng chứng: `game/game-quiz.service.ts:33-59`; `apps/api/prisma/seed-game-quiz.ts`; mẫu controller `admin/admin-game-season.controller.ts` (đăng ký ở `admin/admin.module.ts`).
- Sửa: `AdminGameQuizController` dưới `/admin/engagement/quiz` (list có phân trang, create, update), quyền ADMIN như controller mùa; DTO kiểm câu hỏi, 2–4 đáp án, đáp án đúng nằm trong danh sách, độ khó hợp lệ. Web tab "Câu đố" cạnh tab Mùa.
- Test: spec controller (quyền ADMIN; tạo câu hợp lệ; thiếu đáp án → 400; `waterReward` theo độ khó); spec tab.
- Xong khi: câu mới vào vòng xoay hằng ngày như câu seed (đọc `game-quiz.service.ts` để chắc).

### E-118 (P3) Ô ngày: dòng nhắc che nút, không giải thích "hết hạn trước bắt đầu", báo đỏ khi đang gõ (R-167 + R-168 + R-169)
- Bằng chứng: `components/admin/vn-date-input.tsx:69, 77, 107, 141, 146`; `app/admin/page.tsx:2478`.
- Sửa: dòng nhắc chiếm chỗ trong luồng (bỏ `absolute`). Khi hết hạn sớm hơn bắt đầu, hiện câu "Ngày hết hạn phải sau ngày bắt đầu." cạnh nút Tạo đang khoá. Đặt lại `touched` khi focus.
- Test: `vn-date-input.spec.tsx` (gõ dở lần hai không báo đỏ; dòng nhắc không `absolute`); spec tạo mã (câu hết hạn trước bắt đầu).
- Xong khi: test xanh. (Ảnh `state-coupon-chua-ap-dung` chụp lại ở bước tích hợp, không phải việc của gói.)

## Kiểm riêng của gói
- Race spec: `admin-order-list-filters`, spec có `return`, `refund`.
- Playwright: web gate cả bộ admin; Mini toàn bộ.

## Bản đồ chủ file (mọi gói chạy song song, đây là luật)

Mỗi file nóng dưới đây chỉ MỘT gói được sửa. Gói khác cần đổi thì ghi vào báo cáo ("cần gói X sửa ..."), không tự sửa. Mũi tên "A → B" nghĩa là B chạy sau khi A xong (B đã gộp nhánh của A) nên B được sửa tiếp.

| File / thư mục | Gói giữ |
|---|---|
| `apps/api/prisma/schema.prisma`, thư mục migration có đổi schema | admin-hopviec → admin-nhansu |
| `apps/api/prisma/seed.ts`, `apps/api/src/modules/notifications/notification-variables.ts`, migration chèn mẫu tin | doirac |
| `apps/miniapp/src/i18n/vi.ts` | ctv (gói khác: dùng khoá có sẵn hoặc chữ trong file của mình) |
| `apps/miniapp/src/components/app.tsx` | giohang |
| `packages/app-core/src/route-map.json`, `scripts/check-platform-parity.mjs`, `apps/web/next.config.mjs` | dondep |
| `apps/web/src/app/admin/page.tsx`, `apps/web/src/lib/admin-client.ts` | admin-hopviec → admin-don |
| `apps/api/src/modules/ops/ops-inbox.service.ts`, `apps/web/src/components/admin/ops-inbox-tab.tsx`, `apps/api/src/modules/admin/admin.service.ts`, `admin-order-filter.ts`, `external-points/external-points-attention.ts`, `external-points/**` phần lọc admin; web `components/admin/{order-status-actions,pancake-attention,storefronts-tab,return-request-row,customer-refunds-tab,dealer-claims-tab,product-categories-tab,dealer-accounts-tab,reports-tab,external-claims-tab,account-deletion-panel}.tsx`, `lib/external-claims.ts`; `apps/api/src/modules/users/**` (nếu cần) | admin-hopviec; sau đó admin-don được sửa `admin-order-filter.ts`, `order-status-actions.tsx`, `customer-refunds-tab.tsx`; admin-nhansu được sửa `storefronts-tab.tsx` |
| `apps/api/src/modules/ops/ops.module.ts`, `ops/ledger-drift.cron.ts` (mới) | api-tin |
| `apps/api/src/modules/ops/ops-health.service.ts` | hotro |
| `apps/api/src/modules/notifications/notifications.service.ts` | api-tin |
| `apps/api/src/modules/notifications/notifications.controller.ts`, `notifications.module.ts`, `notification-feed.service.ts` (mới) | thongbao |
| `apps/miniapp/src/pages/notifications.tsx`, `apps/web/src/components/account/notification-view.ts`, `apps/web/src/app/tai-khoan/thong-bao/**`, `packages/app-core/src/notification-route.ts` (mới), `apps/api/src/modules/lifecycle/review-invite.service.ts`, `apps/api/src/modules/flash-sale/flash-sale.service.ts`, Mini `pages/orders.tsx`, `components/orders/orders-tabs.ts`, `pages/community-events.tsx` | thongbao |
| `apps/api/src/common/notify-admins.ts`, `apps/api/src/modules/support-chat/bridge-health.cron.ts` | thongbao |
| `packages/app-core/src/api/account.ts`, `packages/app-core/src/queries/account.ts`, `apps/miniapp/src/services/account-api.ts` | thongbao → canhan |
| `apps/api/src/modules/orders/{order-status,orders,order-reversal}.service.ts`, `refund-queue.ts` | api-tin |
| `apps/api/src/modules/orders/{order-returns,customer-refunds}.service.ts` | api-tin → admin-don |
| `apps/api/src/modules/orders/orders.controller.ts`, `orders.module.ts` | canhan |
| `apps/api/src/modules/subscriptions/**`, `loyalty/loyalty-expiry.service.ts`, `loyalty/tier-drop-notice.service.ts`, `lifecycle/lifecycle.service.ts`, `game/game-gift.service.ts`, `game/game-reminder.service.ts`, `integrations/pancake/pancake-order-body.ts`; Mini `pages/order-detail.tsx`, `utils/order-status.ts`; web `app/tai-khoan/don-hang/[code]/**`, `lib/order-view.ts`; app-core `api/orders.ts` | api-tin |
| `apps/api/src/modules/loyalty/loyalty.service.ts`, `loyalty.controller.ts`, `packages/app-core/src/api/loyalty.ts`, `checkout/checkout.service.ts`, `coupons/coupons.service.ts`, `merchant/merchant.controller.ts`, `merchant/merchant.service.ts` | diem |
| `apps/api/src/modules/game/game.service.ts`, `game-garden.service.ts`, `game.controller.ts`, `feed/community-feed.service.ts`, `feed/community-reward.service.ts`, `storefront/storefront.controller.ts` | diem |
| `apps/api/src/modules/game/game-quiz.service.ts`, `admin/admin.module.ts` | admin-don |
| `apps/api/src/modules/affiliate/**`, `storefront/storefront-quest.service.ts` | ctv |
| `apps/api/src/modules/storefront/storefront.service.ts`, `storefront-admin.*`, `staff/rbac/**`, `staff/dto/**` | admin-nhansu |
| `apps/api/src/modules/groupbuy/**`, app-core `api/groupbuy.ts` | muachung |
| `apps/api/src/modules/auth/**`, `analytics/analytics.controller.ts` | phien |
| `apps/api/src/modules/support-chat/support-chat.service.ts`, `integrations/zalo-oa/**`, `integrations/zns/zalo-oa-token.*` | hotro |
| `apps/api/src/modules/waste-exchange/**` | doirac |
| `apps/api/src/modules/dealer/**` | admin-hopviec |
| Mini `pages/checkout.tsx`, `pages/cart.tsx`, `components/checkout/**`, `store/storefront-context.ts`, `pages/storefront-view.tsx`; web `app/thanh-toan/**`, `app/gio-hang/**`, `components/coupon-box.tsx`, `components/referral-code-box.tsx`, `components/checkout/**`, `lib/storefront-context.ts`, `components/storefront-tracker.tsx`; app-core `coupon-use.ts`, `shipping-eta.ts` | giohang |
| Mini `pages/product-detail.tsx`, `pages/group-buy.tsx`, `utils/group-buy-copy.ts`, `utils/server-clock.ts`, `components/image-upload.tsx`; web `app/san-pham/[slug]/**`, `app/mua-chung/**`, `components/add-to-cart.tsx`, `lib/pdp-logic.ts`, `lib/reviews-client.ts`; app-core `group-buy-copy.ts`, `server-clock.ts` | muachung |
| Mini `store/auth.ts`, `services/api.ts`, `services/query-client.ts`, `components/ui/auth-gate.tsx`, `components/home/new-customer-gift.tsx`, `components/home/guest-link-card.tsx`, `components/coupon-claim-gate.tsx`, `components/game/guest-banner.tsx`, `pages/recycle.tsx`, `hooks/use-recycle-login.ts`, `components/waste-phone-needed.tsx` | phien |
| Mini `pages/profile.tsx`, `pages/home.tsx`, `pages/game.tsx`, `pages/offers.tsx`, `components/home/home-settling.tsx`; web `app/tai-khoan/page.tsx`, `components/account/account-menu.ts`, `components/home/home-view.tsx`, `components/home/use-home-settling.ts`, `components/header-bell.tsx`, `app/vuon-xanh/page.tsx`, `components/game/game-tabs.tsx`, `app/uu-dai/page.tsx`; app-core `home-layout.ts`, `features.ts`, `game-newbie.ts` | canhan |
| Mini `pages/loyalty.tsx`, `pages/rewards-mine.tsx`, `pages/external-points.tsx` (màn quét điểm `/points/scan`), `components/game/garden-hero.tsx`; web `app/tai-khoan/diem-xanh/**`, `app/kho-qua/cua-toi/**`, `components/game/garden-hero.tsx` | diem |
| Mini `pages/affiliate.tsx`, `pages/storefront-builder.tsx`, `pages/brand-owner*.tsx`, `pages/dealer*.tsx`, `pages/dealer-pricing.ts`, `services/storefront-api.ts`, `services/affiliate-api.ts`, `css/dealer-theme.css`; web `app/ctv/**`, `app/chu-thuong-hieu/**`, `components/brand-owner/**`, `components/dealer/**`, `app/dai-ly/**`, `app/s/**`; `packages/design-tokens/**`; app-core `api/storefront.ts`, `api/affiliate.ts` | ctv |
| Mini `pages/recycle-request.tsx`, `recycle-done.tsx`, `recycle-desk.tsx`, `utils/waste-labels.ts`; web `components/recycle/**` | doirac |
| Mini `pages/ai-advisor.tsx`, `pages/support-chat.tsx`; web `app/tu-van/**`, `app/ho-tro/chat/**`, `components/support-chat/**` | hotro |
| Mini `pages/admin.tsx`, `services/staff-api.ts`; app-core `api/staff.ts`; web `components/admin/staff-roster-tab.tsx`, `components/admin/storefronts-tab.tsx` (sau admin-hopviec), `lib/admin-storefronts-client.ts` | admin-nhansu |
| web `components/admin/community-moderation-tab.tsx`, `payroll-admin-tab.tsx`, `support-chat-tab.tsx`, `components/admin/support-chat/**`; app-core `api/payroll.ts`, `api/feed.ts` (chỉ thêm, nếu cần) | admin-congcu |
| web `components/admin/vn-date-input.tsx` và các tab dùng ô ngày (`claim-campaign-panel.tsx`, `season-admin.tsx`, `pos-credits-tab.tsx`, `payout-admin-tab.tsx`, `waste-point-detail.tsx`), `user-detail-drawer.tsx`, `order-extra-filters.tsx`, tab Câu đố (mới); API `admin/admin-order-filter.ts`, `admin/admin.controller.ts`, `admin/admin.module.ts`, `game/game-quiz.service.ts`; Mini `utils/video-url.ts` | admin-don (sau admin-hopviec, api-tin) |
| Mini `components/home/suggest-feed.tsx`, `components/bottom-nav.tsx`, `components/support-hotline.tsx`, `pages/wishlist.tsx`, `components/product-card.tsx`, `components/ui/product-tile.tsx`, `css/tokens.css`, `css/zaui-bridge.css`; web `components/home/suggest-feed.tsx`, `components/bottom-nav.tsx`, `components/support-hotline.tsx`, `app/dang-nhap/**`, `app/tai-khoan/yeu-thich/**`, `components/product-card.tsx`; app-core `api/catalog.ts` (chỉ thêm trường), API `catalog/**` phần dựng thẻ SP | giaodien |
| Mini và web `earn-sheet.tsx`, app-core `account-copy.ts`, `academy-access.ts`, `queries/feed.ts`, `route-map-parity.spec.ts`, file mã chết của E-78, web `app/cong-dong/**`, `apps/web/src/app/layout.tsx`, `apps/e2e/**` (trừ dòng 616–680 `shop.web.spec.ts`; gói khác chỉ thêm spec mới của chính mình) | dondep |

Gặp file không có trong bảng mà gói khác cũng có thể đụng: chỉ sửa nếu mục của gói bắt buộc, sửa ít nhất, ghi rõ trong báo cáo.
