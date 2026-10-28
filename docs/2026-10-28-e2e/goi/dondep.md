# Gói dondep: đồng bộ route hai nền, mã chết, e2e ổn định

- Nhánh `review/e2e-dondep`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-dondep`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG. Chạy song song.
- Gói này giữ `packages/app-core/src/route-map.json`, `scripts/check-platform-parity.mjs`, `apps/web/next.config.mjs`: chỉ gói này được sửa ba file đó.
- Mục: E-65, E-67, E-69, E-78, E-114.

## Mục tiêu

Web không còn trang Mini đã bỏ. Cổng parity bắt được lần sau. Học viện không mời khách thường. Xoá mã chết. E2E web chờ trang hydrate trước khi thao tác.

## Được sửa

- `packages/app-core/src/route-map.json`, `packages/app-core/src/route-map-parity.spec.ts`, `scripts/check-platform-parity.mjs`, `apps/web/next.config.mjs`.
- Web `app/cong-dong/**` (xoá `xep-hang/`, sửa `feed-view.tsx`), `app/layout.tsx` hoặc `app/providers.tsx` (dấu hydrate), `components/home/earn-sheet.tsx`.
- Mini `components/home/earn-sheet.tsx`.
- app-core `account-copy.ts`, `academy-access.ts`, `queries/feed.ts`, `queries/payment.ts`, `queries/reviews.ts`, file barrel/`package.json` exports của app-core nếu có dòng tương ứng.
- File mã chết của E-78 và spec đi kèm; `a11y-input-labels.spec.ts`, `ds-c076-pc10c1.spec.ts` (chỉ danh sách đường dẫn).
- `apps/e2e/**` (helper chờ hydrate), TRỪ `apps/e2e/tests/shop.web.spec.ts` dòng 616–680 (PR #69 của phiên khác).

## KHÔNG sửa

- API (không đổi). Mini `components/app.tsx` (giohang): gói này không sửa route Mini.
- `apps/miniapp/src/i18n/vi.ts` (ctv). `components/home/suggest-feed.tsx`, `bottom-nav.tsx` (giaodien). `home-view.tsx`, `home-layout.ts` (canhan).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- Gói khác thêm spec e2e mới của riêng họ trong `apps/e2e/tests/`; gói này chỉ sửa helper chung. Đổi helper thì giữ chữ ký cũ.
- canhan có thể sửa `account-menu.ts` (đường Học viện đã lọc theo vai ở đó); gói này chỉ sửa earn-sheet và hàm quyền.

## Mục việc

### E-65 (P3) Web còn trang "Bảng xếp hạng" cộng đồng Mini đã bỏ (DODANG-04 = R-132)
- Quyết định của chủ (đã chốt): bỏ trên web cho giống Mini.
- Bằng chứng: `apps/web/src/app/cong-dong/xep-hang/page.tsx`; `apps/web/src/app/cong-dong/feed-view.tsx:184-188`; `packages/app-core/src/route-map.json:44`; Mini `components/app.tsx:234` (`/feed/leaderboard` → `/feed`).
- Sửa: `route-map.json:44` đổi `"web"` thành `"/cong-dong"`. Xoá thư mục `cong-dong/xep-hang/`. Xoá khối nút "Xếp hạng" ở `feed-view.tsx`. `next.config.mjs` thêm redirect permanent `/cong-dong/xep-hang` → `/cong-dong`. Không ai gọi `communityLeaderboardQuery` thì xoá ở `queries/feed.ts:63`. Giữ API.
- Test: `pnpm lint:parity` xanh; spec `feed-view` không còn nút "Xếp hạng"; spec redirect nếu có spec cho `next.config`.
- Xong khi: sitemap web không còn đường này (kiểm `app/sitemap.ts`).

### E-67 (P3) Cổng parity không bắt trường hợp Mini đã chuyển hướng mà web vẫn có trang (DODANG-06)
- Bằng chứng: `scripts/check-platform-parity.mjs`; Mini `components/app.tsx:234, 240, 273`; `route-map.json:76` (`/refill` còn `skip`, web có `/doi-rac`).
- Sửa: trong script, với mỗi `<Route path=X element={<Navigate to=Y …/>}>` (chỉ dạng `element` là `Navigate` trực tiếp; bỏ dạng có điều kiện như `/cashback`), buộc dòng `X` có `web` bằng `web` của dòng `Y` (bỏ query). Báo lỗi nếu khác. Sửa dòng `/refill` thành `"web": "/doi-rac"` (bỏ `skip`).
- Test: thêm ca vào `packages/app-core/src/route-map-parity.spec.ts` (đã nhập `parseMiniAppRoutes`, `checkParity`): route-map giả lệch → lỗi; khớp → không lỗi; Navigate có điều kiện → bỏ qua.
- Xong khi: `pnpm lint:parity` xanh trên repo thật sau E-65.

### E-69 (P3) Bảng "Kiếm tiền" mời mọi khách vào Học viện; hai hàm quyền trùng (DODANG-08 = R-53 phần còn lại)
- Bằng chứng: Mini `components/home/earn-sheet.tsx:9-13`; web `components/home/earn-sheet.tsx:8-12`; `packages/app-core/src/account-copy.ts:36-39` (`canSeeAcademy`), `academy-access.ts:2-6` (`canUseAcademy`).
- Sửa: giữ một hàm `canUseAcademy` ở `academy-access.ts`; `account-copy.ts` re-export tên cũ `canSeeAcademy` (để nơi gọi khác không phải sửa). Hai `earn-sheet.tsx` lọc mục `academy` khi `!canUseAcademy(user?.role)`.
- Test: spec `earn-sheet` hai nền (USER không thấy "Học viện", AFFILIATE thấy); spec hàm quyền.
- Xong khi: hai hàm cho cùng kết quả mọi vai (spec bảng vai).

### E-78 (P3) Mã chết (DODANG-18)
- Bằng chứng: `apps/miniapp/src/components/home/home-extras.tsx`; `apps/miniapp/src/components/home/home-section.tsx`; `apps/web/src/components/home/home-section.tsx`; `apps/miniapp/src/components/community/product-picker.tsx`; `packages/app-core/src/queries/payment.ts`; `packages/app-core/src/queries/reviews.ts`.
- Sửa: trước khi xoá, `rg` tên file và tên export trong toàn repo (trừ spec của chính nó). Không ai dùng thì xoá file và spec đi kèm. Gỡ dòng export tương ứng ở barrel/`package.json` app-core. Cập nhật danh sách đường dẫn trong `a11y-input-labels.spec.ts:15` và `ds-c076-pc10c1.spec.ts:15` nếu có file bị xoá.
- Test: `pnpm -r typecheck` và test hai app xanh.
- Xong khi: còn ai dùng thì giữ và ghi lý do.

### E-114 (P3) E2E web chập chờn vì thao tác trước khi hydrate (R-152, B-130)
- Bằng chứng: backlog cũ B-130; khoảng 10 ca `/san-pham` chập chờn đã biết.
- Sửa: web đặt `data-hydrated="true"` trên `body` (hoặc phần tử gốc) trong một effect phía client chạy một lần ở `app/providers.tsx` hoặc `layout.tsx`. Helper e2e web (`apps/e2e` chỗ mở trang) chờ `body[data-hydrated="true"]` trước khi bấm/gõ. Không đổi giao diện.
- Test: chạy `/san-pham` web gate 3 lần, ghi số ca đỏ trước/sau.
- Xong khi: không tăng thời gian chạy bộ e2e quá 10% (ghi số).

## Kiểm riêng của gói
- `pnpm lint:parity`, typecheck mọi app.
- Playwright: web cả bộ (đổi helper chung); Mini toàn bộ.

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
