# Gói thongbao: trung tâm thông báo hai nền

- Nhánh `review/e2e-thongbao`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-thongbao`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG. Chạy song song. Gói canhan chạy SAU gói này và dùng hàm đếm chưa đọc của gói này.
- Mục: E-4, E-5, E-32, E-71, E-81 (phần client + flash API), E-83, E-84, E-87, E-89, E-90.

## Mục tiêu

Mỗi tin có tiêu đề đúng loại và nút đi đúng chỗ, giống nhau trên Mini và web, luật đặt một chỗ ở app-core. Danh sách tin tải thêm được. Có API đếm chưa đọc riêng.

## Được sửa

- app-core: `notification-route.ts` (mới) + spec, `api/account.ts` (thêm hàm phân trang và `getUnreadNotificationCount`), `queries/account.ts`.
- Mini: `pages/notifications.tsx`, `pages/orders.tsx`, `components/orders/orders-tabs.ts`, `pages/community-events.tsx`, `services/account-api.ts`, spec cạnh.
- Web: `components/account/notification-view.ts`, `app/tai-khoan/thong-bao/**`, spec cạnh.
- API: `notifications/notifications.controller.ts`, `notifications/notifications.module.ts`, `notifications/notification-feed.service.ts` (mới), `common/notify-admins.ts`, `support-chat/bridge-health.cron.ts`, `flash-sale/flash-sale.service.ts`, `lifecycle/review-invite.service.ts`, spec cạnh.

## KHÔNG sửa

- `notifications/notifications.service.ts` (api-tin). Logic phân trang đặt ở `notification-feed.service.ts` mới.
- `apps/api/prisma/seed.ts`, `notification-variables.ts` (doirac). Gói này không thêm mẫu tin.
- `apps/miniapp/src/i18n/vi.ts` (ctv): chữ nhãn/tiêu đề đặt trong `notification-route.ts` hoặc file của mình (hiện các nhãn tin đã là chữ trong file, không ở vi.ts).
- Mini `pages/home.tsx`, `pages/profile.tsx`, web `home-view.tsx`, `header-bell.tsx`, `tai-khoan/page.tsx` (canhan sẽ chuyển sang hàm đếm chưa đọc).
- `groupbuy/**` (muachung thêm `product_slug` cho `GROUP_BUY_SUCCESS`).

## Chồng chéo

- canhan chạy sau và gộp nhánh này: giữ tên hàm `getUnreadNotificationCount(http)` và key `['notifications', 'unread']` (nằm dưới tiền tố `['notifications']` để các invalidate cũ vẫn đúng).
- muachung thêm `product_slug` vào tin `GROUP_BUY_SUCCESS`. Client của gói này dùng nếu có, không có thì giữ nút cũ.
- api-tin thêm `notifySafe` ở `notifications.service.ts`. Gói này không sửa file đó.
- ctv gọi `notifyAdmins` (không truyền `audience`). Thêm tham số mới phải là tuỳ chọn, mặc định giữ hành vi cũ (chỉ ADMIN).

## Mục việc

Làm E-5 trước: tạo `packages/app-core/src/notification-route.ts` chứa luật tiêu đề và đích (không gồm icon). Mini `notifications.tsx` và web `notification-view.ts` gọi chung. Các mục khác thêm nhánh vào file này.

### E-4 (P2) Tin cho đối tác dẫn tới đơn 404 (DODANG-02 + CSKH-01)
- Vấn đề: `MERCHANT_ORDER_NEW`, `_OVERDUE`, `_CANCELLED`, `MERCHANT_RETURN_*` mang `order_code`; nút "Xem chi tiết đơn hàng" mở trang đơn người mua, API trả 404 cho đối tác. Tiêu đề "Thông báo".
- Bằng chứng: Mini `pages/notifications.tsx:77-80, 115-117`; web `notification-view.ts:45-48, 114-116`; gửi ở `checkout.service.ts:728`, `merchant-sla.cron.ts:87`, `order-returns.service.ts:255, 487`; chặn `orders.service.ts:236-241`; trang đúng `apps/web/src/app/merchant/page.tsx:85-112`.
- Sửa: `notificationOrderLink` trả false cho mã bắt đầu `MERCHANT_` trừ `MERCHANT_ORDER_CANCELLED_BY_SELLER` (tin gửi khách). Tiêu đề "Gian hàng đối tác". Web: `MERCHANT_ORDER_*`, `MERCHANT_RETURN_*` → "Mở đơn cần xử lý" `/merchant?tab=fulfil`; `MERCHANT_PAYOUT_*` → `/merchant?tab=settlement`; `MERCHANT_PRODUCT_*` → `/merchant?tab=products` (đi thẳng, không qua `resolveWebRoute`). Mini: không có Cổng người bán, nên không có nút; thân chi tiết thêm câu "Mở trang Đối tác trên web Tubu Tree để xử lý đơn." (không link).
- Test: Mini `notifications.spec.ts`: `MERCHANT_ORDER_NEW` có `order_code` → action null; `MERCHANT_ORDER_CANCELLED_BY_SELLER` vẫn ra `/order/TB1`. Web `app/tai-khoan/thong-bao/page.spec.tsx` hoặc spec `notification-view`: `MERCHANT_ORDER_NEW` → `/merchant?tab=fulfil`.
- Xong khi: không còn tin MERCHANT nào mở trang đơn người mua.

### E-5 (P2) Tin hoa hồng, hạng, điểm sàn không có nút; nhãn gian hàng sai (DIEM-05 + CSKH-02 + CTV-05)
- Vấn đề: `COMMISSION_*`, `TIER_DROP_NOTICE`, `EXTERNAL_POINTS_*`, `CHAT_ORDER_POINTS_*` không có nút, tiêu đề chung. `STOREFRONT_APPROVED`, `_TAKEN_DOWN`, `_REINSTATED` có nút "Thêm vào gian hàng" sai việc.
- Bằng chứng: Mini `notifications.tsx:37-71, 99-152, :144`; web `notification-view.ts:96-147, :138`; gửi `affiliate.service.ts:1386-1393, 1422, 1450`, `tier-drop-notice.service.ts:128-134`; mẫu `apps/api/prisma/seed.ts:873-899`.
- Sửa (trong `notification-route.ts`, giữ thứ tự trước nhánh `route` chung):
  - `COMMISSION_WALLET_CREDITED`, `COMMISSION_WALLET_TAX_ONLY`, `COMMISSION_PAYOUT_*` → "Xem Ví Tubu" `/wallet`; `COMMISSION_*` khác → "Xem hoa hồng" `/affiliate?tab=commission`. Tiêu đề "Hoa hồng CTV" (Mini đã có).
  - `TIER_DROP_NOTICE` → tiêu đề "Hạng thành viên", nút "Xem cách giữ hạng" `/loyalty`.
  - `EXTERNAL_POINTS_*`, `CHAT_ORDER_POINTS_*` → tiêu đề "Điểm Xanh", nút "Xem Điểm Xanh" `/loyalty`.
  - `STOREFRONT_APPROVED`, `STOREFRONT_REINSTATED` → "Chia sẻ gian hàng" `/storefront`; `STOREFRONT_TAKEN_DOWN` → "Xem gian hàng" `/storefront`; `STOREFRONT_TRENDING_PRODUCTS` giữ "Thêm vào gian hàng".
  - Web đi qua `resolveWebRoute`; kiểm nó giữ `?tab=` khi đổi `/affiliate` sang `/ctv`.
- Test: `packages/app-core/src/notification-route.spec.ts`: duyệt danh sách mã gửi khách đọc từ `apps/api/prisma/seed.ts` (trừ `OPS_*`, mã admin, `MERCHANT_*`, `SUBSCRIPTION_*`), đòi tiêu đề khác "Thông báo". Mỗi mã trên một ca nhãn + đích ở spec Mini và web.
- Xong khi: hai nền dùng chung luật.

### E-32 (P3) Tin mời đánh giá có nút "Xem chi tiết đơn hàng" (MUAHANG-05)
- Vấn đề: `REVIEW_REQUEST` rơi vào nhánh xem đơn; 5 chạm mới tới form.
- Bằng chứng: `apps/api/src/modules/lifecycle/review-invite.service.ts:139-145`; Mini `notifications.tsx:115-116, :255-260`; web `notification-view.ts:115-116`. Mini PDP đã đọc `navState.reviewOrderId` (`product-detail.tsx:116`); web có `reviewHref(slug, orderId)` (`apps/web/src/lib/reviews-client.ts:98`).
- Sửa: API thêm `order_id: o.id` vào `data` ở `review-invite.service.ts`. `REVIEW_REQUEST` đặt trước nhánh đơn: có `product_slug` và `order_id` thì nút "Viết đánh giá": Mini `{ to: '/product/<slug>', state: { reviewOrderId } }` (mở rộng kiểu action có `state`, truyền vào `navigate`); web `reviewHref(slug, orderId)`. Thiếu `order_id` (tin cũ) thì "Viết đánh giá" tới `/order/:code`. Tiêu đề "Mời đánh giá".
- Test: spec review-invite (data có `order_id`); spec Mini và web cho hai ca (có/không `order_id`).
- Xong khi: tin mới mở thẳng form trong 2 chạm.

### E-71 (P3) Khách có gói định kỳ (đặt trên web) không xem được gói trong Mini (DODANG-11)
- Quyết định thay chủ: chỉ hiện tab "Định kỳ" cho khách ĐÃ có gói ACTIVE hoặc PAUSED. Không thêm lối tạo gói mới. Cờ `SUBSCRIPTIONS_IN_MINIAPP` giữ nguyên.
- Bằng chứng: `apps/miniapp/src/components/orders/orders-tabs.ts:26-34`; `pages/notifications.tsx:140-143` (SUBSCRIPTION trả null khi cờ tắt); mẫu tương tự `packages/app-core/src/home-layout.ts:130-134`.
- Sửa: `orders-tabs.ts` đổi `ORDERS_TABS` thành hàm `ordersTabs(hasSubscription: boolean)` (giữ hằng cũ = `ordersTabs(false)` nếu nơi khác còn dùng); `parseOrdersTab` nhận danh sách tab. `pages/orders.tsx` dùng query danh sách gói sẵn có (chỉ gọi khi đã đăng nhập) để biết `hasSubscription`. Tin `SUBSCRIPTION_*`: khi khách có gói thì nút "Xem gói" `/orders?tab=subscriptions`. Kiểm màn quản lý gói trong Mini vẫn ẩn mọi nút tạo gói.
- Test: `orders-tabs.spec.ts` (có gói/không gói), `orders-tabs-hidden.spec.ts` cập nhật, spec notifications.
- Xong khi: khách không có gói thấy Mini như cũ.

### E-81 (P3, phần của gói này) Nhắc giờ vàng và mua chung thành công về sai chỗ (CSKH-04)
- Vấn đề: `FLASH_STARTING` chỉ gửi `{ product }`, nút về Trang chủ. `GROUP_BUY_SUCCESS` về danh sách mua chung.
- Bằng chứng: `apps/api/src/modules/flash-sale/flash-sale.service.ts:645, 667`; Mini `notifications.tsx:120-123, 150`; web `notification-view.ts:119-122, 142`.
- Sửa: `flash-sale.service.ts:645` chọn thêm `slug`, dòng 667 thêm `product_slug` (FLASH đã dùng slug khi có). `GROUP_BUY_SUCCESS` có `product_slug` → "Dùng mã, mua ngay" `/product/:slug`; không có thì giữ cũ.
- Test: spec flash-sale (`notify` nhận `product_slug`); spec notifications ca `GROUP_BUY_SUCCESS` có slug.
- Xong khi: test xanh.

### E-83 (P3) Mini: lùi 3 lần mới thoát sau khi mở tin (CSKH-09)
- Vấn đề: mở chi tiết tin đẩy `history.pushState({notifDetail:true})`. Nút đi tiếp đóng overlay rồi `navigate(to)`, không gỡ mục lịch sử.
- Bằng chứng: Mini `notifications.tsx:205-215, 242-246, 440-444`.
- Sửa: khi `window.history.state?.notifDetail` đang có thì `navigate(action.to, { replace: true, state })` ở nút link và ở `openReorderReminder`.
- Test: `notifications-page.spec.tsx`: mở chi tiết, bấm nút, `navigate` nhận `replace: true`.
- Xong khi: lùi một lần từ màn đích về danh sách tin.

### E-84 (P3) Chỉ có 50 tin, đếm chưa đọc tải cả danh sách (CSKH-10 phần a + R-112 phần phân trang)
- Vấn đề: API trả cứng 50 tin; không có "Xem thêm"; đếm chưa đọc trên 50 tin đó.
- Bằng chứng: `notifications.service.ts:327-333` (`take: 50`); Mini `pages/home.tsx:52-53`, `pages/profile.tsx:100-101`; web `home-view.tsx:89`.
- Sửa:
  - API: `GET /me/notifications` nhận tham số tuỳ chọn `before` (ISO `sentAt`), `beforeId`, `limit` (mặc định 50 như cũ, tối đa 50). Vẫn trả MẢNG như cũ (không đổi dạng). Logic đặt ở `notification-feed.service.ts` mới, sắp `(sentAt desc, id desc)`, cùng bộ lọc với `listForUser` hiện tại (đọc kỹ để không lệch). Thêm `GET /me/notifications/unread-count` → `{ count }` (khai báo route trước route có tham số).
  - app-core `api/account.ts`: `getNotificationsPage(http, { before, beforeId, limit })` và `getUnreadNotificationCount(http)`; `queries/account.ts` thêm key `['notifications','unread']`.
  - Mini và web trang tin: `useInfiniteQuery` + nút "Xem thêm" (trang 20 tin; hết khi trang trả ít hơn `limit`).
- Test: spec feed service (3 trang không trùng, không sót, cùng `sentAt` vẫn ổn định theo id); spec controller unread-count; spec trang tin hai nền bấm "Xem thêm" nạp trang 2.
- Xong khi: client cũ gọi `GET /me/notifications` không tham số vẫn nhận đúng 50 tin như trước.

### E-87 (P3) Nhiều loại tin có tiêu đề chung "Thông báo" (CSKH-13 + R-112 phần tiêu đề)
- Vấn đề: REFUND_*, *_VOUCHER, GAME_*, CART_ABANDONED, PRICE_DROP_ALERT, GROUP_BUY_*, REVIEW_REQUEST, SUBSCRIPTION_*, COMMUNITY_* đều ra "Thông báo".
- Bằng chứng: Mini `notifications.tsx:37-71`; web `notification-view.ts:9, 12-39`.
- Sửa (trong `notification-route.ts`): REFUND_ → "Hoàn tiền đơn hàng"; mã kết thúc `_VOUCHER` → "Ưu đãi cho bạn"; GAME_ → "Vườn Xanh"; CART_ABANDONED → "Giỏ hàng của bạn"; PRICE_DROP_ALERT → "Giảm giá"; GROUP_BUY_ → "Mua chung"; REVIEW_REQUEST → "Mời đánh giá"; SUBSCRIPTION_ → "Đơn định kỳ"; COMMUNITY_ → "Cộng đồng". Quyết định thay chủ: GIỮ emoji trong thân mẫu tin (không sửa mẫu).
- Test: chung với spec của E-5.
- Xong khi: danh sách tin không còn mã gửi khách nào ra "Thông báo" (trừ mã thật sự chung).

### E-89 (P3) Mini: sự kiện cộng đồng hứa điểm nhưng không nói cách tham gia (CSKH-15 + R-133)
- Quyết định thay chủ: ghi cách tham gia ngay trên thẻ; số điểm thành dòng phụ; KHÔNG link ra ngoài, KHÔNG cho dự thi trong Mini.
- Bằng chứng: Mini `pages/community-events.tsx:47-56, 267`; chữ `vi.ts:845`.
- Sửa: thẻ danh sách và chi tiết: dòng chính dùng lại chữ có sẵn ở `vi.ts:845` ("Tham gia trên web Tubu Tree"); không ghi tên miền, không thêm hướng dẫn mở ngoài. Điểm thưởng thành dòng phụ cỡ nhỏ. Không thêm nút chép link, không mở ngoài. Không sửa `vi.ts`.
- Test: `community-events.spec.tsx`: thẻ có câu cách tham gia; không có thẻ `a` ra ngoài.
- Xong khi: Mini vẫn chỉ đọc.

### E-90 (P3) Cảnh báo cầu nối Zalo chỉ gửi ADMIN (CSKH-16)
- Vấn đề: `OPS_ZALO_BRIDGE_DOWN`, `OPS_ZALO_BRIDGE_ALERT` chỉ tới ADMIN; nhân viên CSKH trực chat không nhận. Tin OPS không có nút sang tab quản trị.
- Bằng chứng: `apps/api/src/modules/support-chat/bridge-health.cron.ts:124, 147`; `apps/api/src/common/notify-admins.ts:40`; web `app/admin/page.tsx:345`; `notification-view.ts:98`.
- Sửa: `notifyAdmins` thêm tuỳ chọn `audience?: 'admins' | 'admins+cskh'` (mặc định `'admins'`). `admins+cskh` lọc `OR: [{ role: 'ADMIN' }, { role: 'STAFF', staffPermissions: { has: 'CSKH' } }]`. Hai lời gọi trong `bridge-health.cron.ts` dùng `admins+cskh`. Web: `OPS_ZALO_BRIDGE_*` → "Mở Chat CSKH" `/admin?tab=supportChat` (đi thẳng). Mini giữ không nút.
- Test: spec `notify-admins` (lọc đúng người; mặc định chỉ ADMIN); spec web ca bridge.
- Xong khi: lời gọi `notifyAdmins` cũ không đổi hành vi.

## Kiểm riêng của gói
- Jest API: notifications, flash-sale, review-invite, notify-admins, bridge-health.
- Playwright: Mini toàn bộ; web spec `/tai-khoan/thong-bao`.

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
