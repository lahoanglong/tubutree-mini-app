# Gói muachung: mua chung, trang sản phẩm, đánh giá video, đồng hồ máy chủ

- Nhánh `review/e2e-muachung`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-muachung`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (áp mã giảm, giá giờ vàng). Hai lượt review Opus. migration: KHÔNG. Chạy song song.
- Mục: E-9, E-11 (phần Mini mua chung), E-33, E-44, E-81 (phần API groupbuy), E-96, E-100, E-116.

## Mục tiêu

Nút "Mua ngay với mã" của nhóm đủ người áp mã thật. Người được rủ mở link thấy đúng nhóm. Web tải được video đánh giá như Mini. Mini chỉ còn một đồng hồ máy chủ và trang SP không dùng suất giờ vàng đã hết.

## Được sửa

- Mini: `pages/product-detail.tsx`, `pages/group-buy.tsx`, `utils/group-buy-copy.ts`, `utils/server-clock.ts`, `components/image-upload.tsx`, `components/reviews-section.tsx` (chỉ nếu cần dùng hàm chung), spec cạnh.
- Web: `app/san-pham/[slug]/**`, `app/mua-chung/**`, `components/add-to-cart.tsx`, `lib/pdp-logic.ts`, `lib/reviews-client.ts`, spec cạnh.
- app-core: `group-buy-copy.ts`, `server-clock.ts`, file mới cho tải video Cloudinary (ví dụ `packages/app-core/src/cloudinary-video.ts`), `api/groupbuy.ts`.
- API: `apps/api/src/modules/groupbuy/**`.

## KHÔNG sửa

- `apps/miniapp/src/i18n/vi.ts` (ctv), `components/app.tsx` (giohang), `store/auth.ts` và `services/api.ts` (phien).
- Mini `pages/checkout.tsx`, `pages/cart.tsx`, web `app/thanh-toan/**`, `coupon-box.tsx` (giohang). Mini `pages/notifications.tsx`, web `notification-view.ts`, `flash-sale.service.ts` (thongbao).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- thongbao thêm nút cho tin `GROUP_BUY_SUCCESS` dựa vào `product_slug`. Gói này thêm `product_slug` vào dữ liệu tin ở `groupbuy.service.ts`. Giữ đúng tên khoá `product_slug`.
- phien giữ `ensurePhone()` trả `null` khi không liên kết được (không ném). Gói này gọi `useAuthStore.getState().ensurePhone()` như `components/home/guest-link-card.tsx` đang làm.
- ctv chặn khách vãng lai đăng ký CTV (phía API). Gói này chỉ đổi nút Tham gia mua chung.

## Mục việc

### E-9 (P2) Nút "Mua ngay với mã giảm X%" không áp mã (MUAHANG-02)
- Vấn đề: nhóm đủ người, nút chính chỉ mở trang SP. Mã không vào giỏ, khách phải tự nhớ và chọn lại.
- Bằng chứng: Mini `pages/group-buy.tsx:93, :206-219`; web `app/mua-chung/group-buy-view.tsx:192, :227-236`; mã cấp theo SP `apps/api/src/modules/groupbuy/groupbuy.service.ts:478-505`.
- Sửa:
  - Mini: nút SUCCESS gọi `navigate('/product/<slug>', { state: { variationId: g.variationId, applyCoupon: g.couponCode } })`. `product-detail.tsx` đọc `applyCoupon` từ `navState` (cạnh `reviewOrderId` dòng ~116). Sau khi `addMutation` hoặc `buyNowMutation` thành công thì gọi `applyCoupon(http, code)` của `@tubutree/app-core/api/cart`, báo "Đã áp mã <code>". Lỗi thì toast lời máy chủ, không chặn mua. KHÔNG dùng `useCouponUse` (nó chuyển sang /browse khi giỏ rỗng).
  - Web: `productHref` thêm `?ma=<code>`; trang SP đọc `ma`, `add-to-cart.tsx` sau khi thêm giỏ thành công gọi `applyCoupon`.
- Test: `group-buy.spec.tsx` (nút gửi state có mã); `product-detail-coupons.spec.tsx` hoặc spec mới (mua ngay xong gọi applyCoupon đúng mã; applyCoupon lỗi vẫn vào giỏ); `group-buy-view.spec.tsx` web và spec `add-to-cart`.
- Xong khi: nhóm đủ người bấm nút, thêm giỏ, mã đã áp; không đổi luật mã.

### E-11 (P2, phần của gói này) Khách vãng lai bấm "Tham gia" mua chung chỉ nhận lỗi (CTV-03)
- Vấn đề: khách vãng lai bấm Tham gia chỉ nhận "chỉ dành cho tài khoản đã đăng nhập Zalo", không có lối liên kết.
- Bằng chứng: Mini `pages/group-buy.tsx:94`; API `groupbuy.service.ts:80-83`.
- Sửa: `onJoin` của Mini: nếu `isGuestUser(user)` (`apps/miniapp/src/utils/guest-user.ts`) thì gọi `ensurePhone()`; trả `null` thì dừng (không gọi API); có user thì tham gia tiếp.
- Test: `apps/miniapp/src/pages/group-buy.spec.tsx`: khách bấm Tham gia gọi `ensurePhone`, không gọi API tham gia khi `ensurePhone` trả null.
- Xong khi: test xanh. Phần API `register` CTV và `findEligibleReferrer` do gói ctv làm.

### E-33 (P3) Web không tải được video đánh giá (MUAHANG-06 + DODANG-10)
- Vấn đề: form đánh giá web chỉ giữ video cũ, câu thưởng không nhắc video. Mini tải được (thưởng 15.000 so với 10.000 điểm).
- Bằng chứng: web `lib/reviews-client.ts:108-120`, `app/san-pham/[slug]/product-reviews.tsx:396-397, :470`; Mini `components/reviews-section.tsx:527, :549-553`, `components/image-upload.tsx:212-250`.
- Sửa: tách phần gọi Cloudinary `/video/upload` (preset, giới hạn dung lượng, 60 giây) của Mini `VideoUpload` vào file app-core mới. Mini `image-upload.tsx` dùng lại hàm đó. Web thêm nút chọn video ở `product-reviews.tsx`, gửi `videoUrl`. `rewardHint` web nhận nhánh video như Mini. Bỏ dòng "Web chưa tải video lên được". Không thêm thư viện.
- Test: spec hàm app-core (gọi đúng URL và preset; quá 60 giây hoặc quá dung lượng thì báo lỗi). Spec `product-reviews` web: tải giả thành công thì body có `videoUrl`, câu thưởng đổi sang mức video.
- Xong khi: hai nền cùng giới hạn và cùng câu thưởng (số tiền thưởng lấy từ dữ liệu sẵn có, không đổi).

### E-44 (P3) Khách chưa đăng nhập mở link mời mua chung không thấy nhóm (CTV-06)
- Vấn đề: `GET /group-buy/:id` cần đăng nhập. Web khách chưa đăng nhập mở `/mua-chung/<id>` chỉ thấy danh sách chung.
- Bằng chứng: `apps/api/src/modules/groupbuy/groupbuy.controller.ts:24-27` (không `@Public`, khác `:17-22`); web `app/mua-chung/group-buy-view.tsx:44-46, 66` (`enabled: … && authed`).
- Sửa: thêm `@Public()` và `@UseGuards(OptionalJwtAuthGuard)` cho `detail` (theo route danh sách). `userId` tuỳ chọn; `couponCode` chỉ trả khi người xem đã tham gia. Web bỏ điều kiện `authed` ở `invitedQ`, khoá truy vấn gắn pha đăng nhập như `listQ`. Thẻ được mời hiện nút "Đăng nhập để tham gia" (đã có ở `GroupCard`).
- Test: spec controller groupbuy (khách gọi chi tiết 200, không có `couponCode`; người đã tham gia có `couponCode`); `group-buy-view.spec.tsx` (khách thấy thẻ nhóm được mời).
- Xong khi: không lộ mã cho người chưa tham gia.

### E-81 (P3, phần của gói này) Tin mua chung thành công không có slug SP (CSKH-04)
- Vấn đề: `GROUP_BUY_SUCCESS` không có `product_slug`, nút trong tin về danh sách Mua chung.
- Bằng chứng: `apps/api/src/modules/groupbuy/groupbuy.service.ts:240-241, 257-263`.
- Sửa: `select` thêm `slug` của SP, dữ liệu tin thêm `product_slug`. (Nút "Dùng mã, mua ngay" ở client do thongbao làm.)
- Test: spec groupbuy service: `notify` nhận `product_slug`.
- Xong khi: test xanh.

### E-96 (P3) Trang SP web khác Mini (R-98)
- Vấn đề: tiêu đề mục dùng font có chân, ô số lượng khác kiểu, khối đánh giá rỗng chỉ là chữ trơn.
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/web375/product-slug__returning__web375__s2.png`, `__s3.png` so `screens/mini375/product-slug__returning__mini375__s2.png`, `__s3.png`.
- Sửa: web dùng cùng kiểu tiêu đề mục, ô số lượng và khối đánh giá rỗng như Mini (token `@tubutree/design-tokens`, Tailwind). Không đổi bố cục máy tính ngoài phần này.
- Test: spec component liên quan (khối đánh giá rỗng có nút/câu như Mini). So ảnh 375px.
- Xong khi: ảnh 375px hai nền khớp ở ba phần trên.

### E-100 (P3) Câu mua chung khó hiểu (R-102)
- Vấn đề: "Đủ 3 người: mỗi người nhận mã giảm 15%, dùng cho đơn từ 102.000đ" không nói giảm ngay hay mã cho đơn sau.
- Bằng chứng: `packages/app-core/src/group-buy-copy.ts:38`; ảnh `screens/mini375/group-buy__returning__mini375__s1.png`.
- Sửa: tách hai ý: "Còn thiếu N người" và "Đủ nhóm: mỗi người nhận mã giảm X% cho đơn từ Y". Chỉ đổi cách nói, không đổi số hay luật.
- Test: spec `group-buy-copy` cập nhật; spec trang mua chung hai nền.
- Xong khi: hai nền dùng cùng hàm chữ.

### E-116 (P3) Mini có hai đồng hồ máy chủ; trang SP không lọc suất giờ vàng đã hết (R-154)
- Vấn đề: `apps/miniapp/src/utils/server-clock.ts` chép lại `packages/app-core/src/server-clock.ts`. PDP `flashItem` không lọc theo `endAt`, nên suất đã hết vẫn có thể hiện giá giờ vàng tới khi tải lại.
- Bằng chứng: hai file trên; nơi nhập đồng hồ Mini: `use-countdown`, `use-remaining`, `use-flash-sales-poller`, `payment-api`, `shop-api`, `flash-sale`, `purchased-rail`, `catalog-pricing`.
- Sửa: Mini `utils/server-clock.ts` chỉ còn `export { ... } from '@tubu/app-core/...'` (giữ tên hàm `syncServerClock`, `serverNow` để không sửa nơi nhập). Nếu hai bản khác hành vi, giữ hành vi app-core và ghi rõ trong báo cáo. PDP lọc `flashItem` theo `serverNow() < endAt` (Mini `product-detail.tsx`, web `lib/pdp-logic.ts`).
- Test: spec đồng hồ (Mini import qua re-export cùng một trạng thái với app-core); spec PDP: suất có `endAt` đã qua thì không dùng giá giờ vàng.
- Xong khi: chỉ còn một bản logic; bundle Mini không tăng.

## Kiểm riêng của gói
- Race spec: các spec có `groupbuy`, `flash` trong `apps/api/test/integration-race/`.
- Playwright: Mini toàn bộ; web spec `/san-pham`, `/mua-chung` (nhớ ca chập chờn B-130 đã biết).

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
