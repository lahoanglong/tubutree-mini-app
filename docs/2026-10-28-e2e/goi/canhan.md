# Gói canhan: Cá nhân, Trang chủ, Vườn Xanh (lối vào và số đếm)

- Nhánh `review/e2e-canhan`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-canhan`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG.
- CHẠY SAU gói thongbao: trước khi làm, `git merge review/e2e-thongbao` (workflow đã gộp sẵn thì bỏ qua). Dùng `getUnreadNotificationCount` và key `['notifications','unread']` của gói đó.
- Mục: E-19, E-21, E-39, E-66, E-77, E-79, E-91, E-121, E-122, E-123, E-124.

## Mục tiêu

Cá nhân và Trang chủ tải ít API hơn (một lời gọi đếm đơn, một lời gọi đếm tin). Thẻ thành viên báo sắp mất hạng. Nhiệm vụ mời bạn và quầy đổi rác có lối vào đúng. Khung chờ Trang chủ không giữ quá lâu khi phiên lỗi. Web Vườn Xanh giống Mini.

## Được sửa

- Mini: `pages/profile.tsx`, `pages/home.tsx`, `pages/game.tsx`, `pages/offers.tsx`, `components/home/home-settling.tsx`, `components/home/member-card.tsx`, spec cạnh.
- Web: `app/tai-khoan/page.tsx`, `components/account/account-menu.ts` (+ `account-menu.spec.ts`), `components/home/home-view.tsx`, `components/home/use-home-settling.ts`, `components/home/member-card.tsx`, `components/header-bell.tsx`, `app/vuon-xanh/page.tsx`, `components/game/game-tabs.tsx`, `app/uu-dai/page.tsx`, spec cạnh.
- app-core: `home-layout.ts`, `features.ts`, `game-newbie.ts`, `api/order-counts.ts` (mới), `api/account.ts`, `queries/account.ts` (sau thongbao), spec cạnh.
- API: `orders/orders.controller.ts`, `orders/orders.module.ts`, `orders/order-counts.service.ts` (mới); `apps/api/prisma/reference-data/config-selection.ts` (chỉ câu mô tả của `home.new_customer_layout`).

## KHÔNG sửa

- `orders/orders.service.ts` và các service đơn khác (api-tin). Đếm đơn đặt ở `order-counts.service.ts` mới.
- `notifications/**` API (thongbao, api-tin). `pages/notifications.tsx` (thongbao).
- `apps/miniapp/src/i18n/vi.ts` (ctv). `components/app.tsx` (giohang). `store/auth.ts` (phien).
- `home.new_customer_layout`: KHÔNG xoá khoá, KHÔNG xoá chỗ đọc ở `public-config.ts:120`, `system-config.service.ts:331`; `reference-seed.race-spec.ts:330` liệt kê khoá này.
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- doirac giữ màn quầy; gói này chỉ thêm hàng lối vào ở Cá nhân và menu tài khoản, gọi hàm điểm quầy có sẵn (Mini `services/waste-api`, web client trong `components/recycle/**` hoặc `lib/`), không sửa file của doirac.
- diem sửa `garden-hero.tsx` và trang Hạng. Gói này chỉ sửa `memberCardView` ở `home-layout.ts`.
- giaodien sửa `components/home/suggest-feed.tsx` (hai nền). Gói này không sửa file đó.

## Mục việc

### E-19 (P2) Thẻ thành viên Trang chủ/Ưu đãi mời lên hạng khi khách sắp bị hạ (DIEM-06)
- Bằng chứng: `packages/app-core/src/home-layout.ts:263-284`; dùng ở Mini `components/home/member-card.tsx:43`, `pages/offers.tsx:73`, web `app/uu-dai/page.tsx:110`, `components/home/member-card.tsx:40`; trang Hạng có `graceLine` (Mini `pages/loyalty.tsx:119, 249`).
- Sửa: trong `memberCardView`, khi `overview?.tierGrace` có thì `toGoLine = tierGraceLine(overview.tierGrace)` (`packages/app-core/src/loyalty-tier-copy.ts`), ưu tiên hơn câu lên hạng.
- Test: `home-layout.spec.ts` một ca có `tierGrace`, một ca không.
- Xong khi: bốn nơi dùng thẻ tự đổi theo, không sửa từng nơi.

### E-21 (P2) Nhiệm vụ "Mời 3 bạn" dẫn sang Ví (DODANG-01)
- Bằng chứng: Mini `pages/game.tsx:53-57` (`invite: '/wallet'`); web `app/vuon-xanh/page.tsx:63-67`; `packages/app-core/src/game-newbie.ts:211-231`; khối mời bạn Mini `pages/profile.tsx:405`, web `app/tai-khoan/page.tsx:349`.
- Sửa: đưa `MISSION_PATHS` vào `game-newbie.ts`, mỗi nền một bảng. `invite` → Mini `/profile?section=referral`, web `/tai-khoan?section=referral`. Thêm `id="referral"` cho khối mời bạn; đọc `?section=referral` rồi `scrollIntoView` khi dữ liệu có, theo cách `offers.tsx` làm với `?section=coupons`.
- Test: `game.spec.tsx` và spec Vườn Xanh web (nút mời bạn trỏ đường mới); spec profile cuộn tới mục.
- Xong khi: hai nền dùng chung bảng đường.

### E-39 (P3) Lối vào quầy "Nhận hàng tại điểm" chỉ nằm trong Đổi rác (DOIRAC-04)
- Bằng chứng: Mini `pages/recycle.tsx:278-285` (lối duy nhất); web `components/recycle/recycle-home.tsx:246`; route Mini `/recycle/desk`, web `/doi-rac/quay`.
- Sửa: thêm hàng "Nhận hàng tại điểm" vào Cá nhân Mini (`profile.tsx`) và menu tài khoản web (`account-menu.ts`), chỉ hiện khi `getDeskPoints()` (`GET /waste/desk/points`) trả ≥ 1 điểm. Chỉ gọi khi user là STAFF/ADMIN/đại lý hoặc vai có thể có điểm (đọc `waste-desk` để biết ai có điểm; nếu không lọc được theo vai thì gọi khi đã đăng nhập thật, `staleTime` dài). Dùng chung query key `WASTE_QUERY_KEYS`. Không gọi khi `waste.enabled` tắt nếu client đã biết cờ.
- Test: spec profile và `account-menu.spec.ts`: có điểm thì hiện và trỏ đúng; không điểm thì ẩn; khách thường không phát sinh lời gọi thừa.
- Xong khi: không thêm lời gọi API cho khách thường (kiểm số API ở Cá nhân không tăng với khách thường).

### E-66 (P3) Web Vườn Xanh còn tab "Cộng đồng" Mini đã bỏ (DODANG-05)
- Quyết định thay chủ: ẩn bằng cờ, đảo ngược được, không xoá mã.
- Bằng chứng: web `components/game/game-tabs.tsx:6`, `app/vuon-xanh/page.tsx:322-345`; Mini bỏ ở `pages/game-layout.spec.tsx:208`.
- Sửa: `features.ts` thêm `GAME_SOCIAL_ON_WEB = false` (comment nêu lý do: web 375 phải giống Mini). `game-tabs.tsx` lọc tab `community` khi cờ tắt; `vuon-xanh/page.tsx` không render panel.
- Test: spec `game-tabs` (không có "Cộng đồng"); spec trang Vườn Xanh web.
- Xong khi: đổi cờ thành true là hiện lại như cũ.

### E-77 (P3) Comment cờ Chặng Mùa sai; mô tả `home.new_customer_layout` hứa điều không có (DODANG-17)
- Quyết định thay chủ: KHÔNG nối cờ vào trang chủ và KHÔNG xoá khoá. Chỉ sửa chữ cho đúng hiện trạng.
- Bằng chứng: `packages/app-core/src/features.ts:6-7` ("chưa có công cụ tạo mùa", sai: công cụ có từ 27/10, `admin-game-season.controller.ts`); `apps/api/prisma/reference-data/config-selection.ts:117` (mô tả nói Mini đổi thứ tự khối, nhưng không client nào đọc `homeNewCustomerLayout`).
- Sửa: comment `features.ts` thành "Chặng Mùa: tắt chờ chủ quyết; công cụ tạo mùa đã có ở admin". Mô tả khoá thêm "Hiện chưa client nào đọc khoá này; đổi giá trị chưa có tác dụng." Chạy spec `reference-config-selection.spec.ts` và nếu race seed so mô tả thì cập nhật cho khớp.
- Test: spec liên quan xanh.
- Xong khi: không đổi giá trị hay hành vi nào.

### E-79 (P3) "Quản trị nhân sự" ở menu web mở tab Hôm nay (DODANG-19)
- Bằng chứng: `apps/web/src/components/account/account-menu.ts:82`; tab `staffRoster` ở `app/admin/page.tsx:322, 663`; spec `account-menu.spec.ts:142, :151-152`.
- Sửa: `to: '/admin?tab=staffRoster'`. Cập nhật spec dòng 142 và ca dòng ~151.
- Test: `account-menu.spec.ts`.
- Xong khi: test xanh.

### E-91 (P3) Cá nhân gọi 19 API, 3 lần chỉ để đếm đơn, tải 50 tin chỉ để đếm (R-114 + CSKH-10 phần b)
- Bằng chứng: Mini `pages/profile.tsx:113` (3 `useQueries` `fetchOrders(filter,1,1)`), `:100-101` (tải `['notifications']` để đếm); web `app/tai-khoan/page.tsx:108`; Trang chủ Mini `pages/home.tsx:52-53`, web `home-view.tsx:89`, `header-bell.tsx`.
- Sửa:
  - API: `GET /orders/status-counts` trong `orders.controller.ts`, khai báo TRƯỚC route `':code'`. Logic ở `order-counts.service.ts` mới: một `groupBy` theo các nhóm Cá nhân đang đếm (dùng đúng bộ lọc `filter` mà 3 `useQueries` đang dùng, đọc kỹ để số không lệch). Trả `{ [nhóm]: number }`.
  - app-core `api/order-counts.ts`: `getOrderStatusCounts(http)`; key `['orders','status-counts']` (dưới tiền tố `['orders']` để invalidate cũ vẫn làm mới).
  - Mini `profile.tsx`, web `tai-khoan/page.tsx`: thay 3 lời gọi bằng một. Số chưa đọc ở Cá nhân, Trang chủ, chuông web dùng `getUnreadNotificationCount` (thongbao) thay tải danh sách.
- Test: spec service đếm (khớp `fetchOrders(...).meta.total` cho từng nhóm trên dữ liệu giả); spec controller (route không bị `:code` nuốt); spec profile hai nền (một lời gọi đếm); spec home/chuông dùng key unread.
- Xong khi: đo lại số API ở Cá nhân (ghi trước/sau trong báo cáo).

### E-121 (P3) Phiên lỗi thì Trang chủ web giữ khung chờ chung 4,5 giây (R-173)
- Bằng chứng: `apps/web/src/components/home/home-view.tsx:86, 94`, `use-home-settling.ts:16`; Mini `components/home/home-settling.tsx`.
- Sửa: khi `phase === 'unavailable'` (hoặc tương đương Mini khi khôi phục phiên lỗi), thả khung chờ ngay và hiện bố cục khách mới mặc định.
- Test: spec `use-home-settling` với phiên lỗi: không chờ 4,5 giây.
- Xong khi: hai nền cùng hành vi.

### E-122 (P3) Khách cũ trên máy mới thấy nội dung đã dựng biến mất rồi hiện lại (R-174)
- Bằng chứng: `apps/web/src/components/home/use-home-settling.ts:11-13`.
- Sửa: giữ nội dung khách mới đã dựng ở máy chủ (Bán chạy, Gợi ý); chỉ giữ chỗ cho khối riêng của khách cũ. Không đổi thứ tự khối.
- Test: spec `home-view`: khi chưa biết loại khách, khối Bán chạy vẫn render.
- Xong khi: CLS đo lại vẫn 0 (ghi số trong báo cáo, dùng spec CLS có sẵn nếu có).

### E-123 (P3) Thiếu test cấp trang cho khung chờ Trang chủ (R-175)
- Bằng chứng: `apps/miniapp/src/pages/home.spec.tsx:40`.
- Sửa: thêm test trang: một truy vấn quyết định (Giờ vàng, số đơn) lỗi thì khung chờ chung thả và khối hiện lỗi kèm "Thử lại"; hẹn giờ 4,5 giây dưới StrictMode với giờ giả. Làm cho cả Mini và web.
- Xong khi: test mới xanh và đỏ nếu bỏ nhánh thả khung chờ (ghi lệnh chứng minh).

### E-124 (P3) Chiều cao khung chờ Trang chủ là số viết tay (R-176)
- Bằng chứng: `apps/miniapp/src/components/home/home-settling.tsx:9-12` (96, 138, 260) và bản web.
- Sửa: đưa vào hằng chung trong app-core (cạnh `FLASH_SKELETON_HEIGHT` hoặc `home-layout.ts`), hai nền dùng chung.
- Test: spec dùng hằng.
- Xong khi: không còn số viết tay ở hai file.

## Kiểm riêng của gói
- Jest API orders (route mới). Race spec có `orders` nếu đụng truy vấn đơn.
- Playwright: Mini toàn bộ; web cả bộ (đổi Trang chủ và Cá nhân).

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
