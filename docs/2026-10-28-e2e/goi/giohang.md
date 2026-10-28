# Gói giohang: giỏ, thanh toán, người giới thiệu

- Nhánh `review/e2e-giohang`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-giohang`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (mã giảm, người giới thiệu, hoa hồng). Hai lượt review Opus. migration: KHÔNG. Chạy song song, không chờ gói nào.
- Mục: E-6, E-7, E-8, E-10, E-48, E-97, E-99.

## Mục tiêu

Khách thấy mình có mã dùng được ngay ở giỏ và thanh toán. Mã giới thiệu chỉ khoá khi thật sự là CTV. Link CTV trên web giữ được qua lần ghé sau. Ngày giao dự kiến không hứa cho hàng gian hàng tự giao. Giỏ web giống Mini.

## Được sửa

- Mini: `pages/checkout.tsx`, `pages/cart.tsx`, `components/checkout/**`, `store/storefront-context.ts`, `pages/storefront-view.tsx`, `components/app.tsx` (chỉ đoạn `recordReferralTouch`/`setSfContext` dòng 187–208), spec cạnh các file đó.
- Web: `app/thanh-toan/**`, `app/gio-hang/**`, `components/coupon-box.tsx`, `components/referral-code-box.tsx`, `components/checkout/**`, `lib/storefront-context.ts`, `components/storefront-tracker.tsx`, spec cạnh.
- app-core: `coupon-use.ts`, `shipping-eta.ts`, spec cạnh.

## KHÔNG sửa

- `apps/miniapp/src/i18n/vi.ts` (gói ctv giữ): dùng khoá có sẵn (`vi.cart.subtotal` đã có) hoặc chữ đặt trong file của mình.
- `apps/api/**`: gói này không đổi API. `affiliate/**` là của ctv.
- `pages/product-detail.tsx`, `pages/group-buy.tsx`, web `add-to-cart.tsx` (muachung). `store/auth.ts`, `services/api.ts` (phien).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- ctv sửa `affiliate.service.ts` (`recordTouch` đọc header `X-Client-Platform`). Gói này không đổi body gửi `/affiliate/touch`.
- muachung áp mã nhóm sau khi thêm giỏ (gọi `applyCoupon` của app-core). Gói này chỉ hiện câu gợi ý, không tự áp mã.
- phien đổi `store/auth.ts`. Gói này không đụng `ensurePhone()` trong `checkout.tsx` (giữ nguyên lời gọi ở dòng ~1094).

## Mục việc

### E-6 (P2) Giỏ và thanh toán không nói khách đang có mã dùng được (MUAHANG-01)
- Vấn đề: dòng "Mã giảm giá" ở giỏ và thanh toán (cả hai nền) chỉ ghi "Chọn hoặc nhập mã giảm giá". Danh sách mã chỉ tải khi mở tấm chọn mã. Khách mới dễ đặt đơn đầu mà quên mã chào mừng 30.000đ (mã chỉ cho đơn đầu).
- Bằng chứng: Mini `pages/checkout.tsx:647-657`, `pages/cart.tsx:608-618`, `components/checkout/voucher-sheet.tsx:58-70` (`enabled: visible`); web `components/coupon-box.tsx:114-121` (đã tải previews nhưng không hiện), `:245-250`; API `checkout.controller.ts:16-22` (`POST /checkout/coupon-previews`).
- Sửa (quyết định thay chủ: chỉ gợi ý, KHÔNG tự áp mã):
  - app-core `coupon-use.ts`: thêm hàm thuần `couponHint(previews)` trả `{ count, maxSaving } | null`. `maxSaving` = lớn nhất của `discount + freeshipSaving` trên các mã `eligible`.
  - Mini `checkout.tsx`, `cart.tsx`: khi giỏ chưa có mã, gọi `getCouponPreviews` với cùng `previewParams` và debounce như VoucherSheet (dùng chung query key để VoucherSheet không gọi lại). Có hint thì dòng phụ thành "Bạn có N mã dùng được · giảm đến X" (màu thương hiệu). Không có thì giữ câu cũ.
  - Web `coupon-box.tsx`: dòng thu gọn dùng `previews` sẵn có, cùng câu.
- Test: spec `coupon-use.spec.ts` cho `couponHint` (không mã, 1 mã, nhiều mã, mã không eligible). `checkout.spec.tsx`/`cart.spec.tsx` Mini và `coupon-box.spec.tsx` web: có mã eligible thì hiện câu và số tiền; không có thì câu cũ.
- Xong khi: hai nền hiện cùng câu; không có lời gọi previews thừa khi đã có mã; không tự áp mã.

### E-7 (P2) Ô mã người giới thiệu khoá cả mã của khách thường (CTV-04)
- Vấn đề: mọi `?ref=` đều bị coi là mã gắn sẵn ("Bạn đang mua qua link giới thiệu", giấu nút Đổi). Mã của khách thường bị máy chủ bỏ qua, nên không ai được ghi công và khách không nhập được mã CTV thật.
- Bằng chứng: Mini `components/checkout/referral-code-box.tsx:81-104`, `pages/checkout.tsx:675-679`, `components/app.tsx:187-207`; web `components/referral-code-box.tsx:57-73`, `app/thanh-toan/page.tsx:637-641`; máy chủ bỏ qua `apps/api/src/modules/affiliate/affiliate.service.ts:229-236`.
- Sửa: thêm `referralEligible: boolean | null` vào storefront-context hai nền. Đặt từ kết quả `recordReferralTouch` đang gọi (Mini `app.tsx:191`, web `storefront-tracker.tsx`). Gian hàng CTV (`storefront-view.tsx`, `rememberStorefront` type CTV) đặt `true`. Hai trang thanh toán chỉ truyền `linkedCode` khi `referralEligible === true`; còn lại ô nhập trống và nút "Nhập mã" hiện. `effectiveReferralCode` khi gửi đơn bỏ mã chưa xác nhận hợp lệ (trừ mã khách tự gõ). Mã CTV hợp lệ vẫn khoá như cũ.
- Test: spec `referral-code-box` hai nền (mã gắn sẵn không hợp lệ thì hiện ô nhập); `checkout.spec` Mini (đơn không gửi mã thường); spec storefront-context (touch trả ok:false thì `referralEligible=false`).
- Xong khi: luật ai được ghi công không đổi; chỉ đổi cái khách thấy và mã không hợp lệ không gửi kèm đơn.

### E-8 (P2) Web mất nguồn giới thiệu khi khách chưa đăng nhập đóng tab (CTV-01)
- Vấn đề: web chỉ nhớ ref trong `sessionStorage`. "Chạm" phía máy chủ chỉ ghi khi đã đăng nhập. Khách mở link CTV, đóng tab, hôm sau đăng nhập và mua: đơn không có người giới thiệu.
- Bằng chứng: web `lib/storefront-context.ts:11-14, 34, 64`; `components/storefront-tracker.tsx:23, 39-44, 54`; Mini không bị (`app.tsx:187-196`).
- Sửa: trong `rememberEntryLink` và `rememberStorefront` (chỉ type CTV) ghi thêm `{ referralCode, slug, kind, savedAt }` vào `localStorage` khoá `tubu_web_ref_pending` (bọc try/catch). Trong `ReferralCapture`: khi `status === 'authenticated'` và `sessionStorage` rỗng, đọc bản chờ còn trong 7 ngày (hằng `PENDING_REF_TTL_DAYS = 7`), gọi `recordReferralTouch`, rồi xoá bản chờ (cả khi `ok:false`). Bản `sessionStorage` vẫn ưu tiên.
- Test: `apps/web/src/components/storefront-tracker.spec.tsx`: mở `/?ref=ABC` khi chưa đăng nhập, xoá `sessionStorage`, chuyển sang `authenticated` thì có `POST /affiliate/touch` với `ABC`; bản chờ quá 7 ngày thì không gọi; localStorage ném lỗi thì không vỡ trang.
- Xong khi: test xanh; không đổi API.

### E-10 (P2) "Giao dự kiến" hứa cả cho hàng gian hàng tự giao (MUAHANG-03)
- Vấn đề: thanh toán và màn đặt xong hiện "Giao dự kiến" cho cả lần đặt. Chi tiết đơn cố ý ẩn ngày đó với đơn gian hàng đối tác.
- Bằng chứng: Mini `pages/checkout.tsx:97, :1020`, `components/checkout/order-success.tsx:105, :161`; web `app/thanh-toan/page.tsx:135, :722`, `components/checkout/order-success.tsx:226, :356`; luật ẩn `packages/app-core/src/shipping-eta.ts:23-25, :41`; kiện có `fulfiller.kind` ở `checkout.service.ts:282-290, :1347-1355`.
- Sửa: thêm `checkoutEtaLabel(eta, kinds: string[])` vào `shipping-eta.ts`: không có kiện `TUBU` thì `null`; có cả `TUBU` và `MERCHANT` thì thêm hậu tố " (hàng Tubu Tree)". Thanh toán truyền `quote.shipments.map(s => s.fulfiller.kind)`; màn đặt xong truyền `order.splitOrders?.map(o => o.fulfiller.kind) ?? [order.fulfiller?.kind]` (kiểm đúng tên trường trong DTO thật). Áp cho 4 file.
- Test: `shipping-eta.spec.ts` (chỉ MERCHANT thì null; trộn thì có hậu tố; chỉ TUBU giữ như cũ); spec thanh toán web và `order-success` Mini.
- Xong khi: hai nền giống nhau, chi tiết đơn không đổi.

### E-48 (P3) Mini mở gian hàng đối tác xoá mã CTV đang có (CTV-10 phần a)
- Vấn đề: Mini mở mọi `/s/:slug` đều đặt `kind: 'ctv'` và `referralCode: null`, xoá mã CTV trong phiên và gửi slug gian hàng đối tác làm `storefrontSlug`. Web phân biệt theo `type`.
- Bằng chứng: Mini `pages/storefront-view.tsx:47-49`; web `lib/storefront-context.ts:77-91`.
- Sửa: `setSfContext(sf.type === 'CTV' ? { slug: sf.slug, referralCode: sf.referralCode ?? null, kind: 'ctv' } : { slug: sf.slug, kind: 'brand' })`, không xoá mã đang có khi là gian hàng đối tác. Khớp hành vi web (đọc `rememberStorefront` web để chép đúng tên `kind`).
- Test: `storefront-view.spec.tsx`: gian hàng MERCHANT không xoá `referralCode`; gian hàng CTV đặt mã của CTV.
- Xong khi: test xanh. (Phần b, `platform` của sự kiện touch, do gói ctv làm phía API.)

### E-97 (P3) Giỏ rỗng web không có dải gợi ý như Mini (R-99)
- Vấn đề: web giỏ rỗng chỉ có chữ, không có dải gợi ý; chữ và nút khác Mini.
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/web375/cart__new__web375__s1.png` so `screens/mini375/cart__new__mini375__s1.png`; mã `apps/web/src/app/gio-hang/page.tsx` (khối giỏ rỗng), Mini `pages/cart.tsx` (khối rỗng).
- Sửa: web dùng cùng câu, cùng nút và cùng nguồn gợi ý như Mini (dùng query/hàm app-core mà Mini dùng; component thẻ SP web có sẵn). Không thêm API.
- Test: spec trang giỏ web: giỏ rỗng có tiêu đề dải gợi ý và nút giống Mini.
- Xong khi: so ảnh 375px hai nền khớp bố cục.

### E-99 (P3) "Tạm tính (đã giảm)" hiện cả khi không có giảm (R-101)
- Vấn đề: nhãn tổng ghi "(đã giảm)" kể cả khi không áp mã nào.
- Bằng chứng: ảnh `screens/mini375/cart__returning__mini375__s1.png`, `screens/web375/cart__returning__web375__s1.png`; khoá chữ `vi.cart.subtotal` đã có.
- Sửa: chỉ thêm "(đã giảm)" khi tổng giảm > 0; ngược lại dùng `vi.cart.subtotal` (Mini) và chữ tương ứng web.
- Test: spec giỏ hai nền: không giảm thì không có "(đã giảm)"; có giảm thì có.
- Xong khi: test xanh.

## Kiểm riêng của gói
- Race spec liên quan thanh toán (chọn trong `apps/api/test/integration-race/` các spec có `checkout`, `coupon`, `referral`) chỉ cần chạy nếu đụng API (gói này không đụng API thì ghi "không đụng API").
- Playwright web: spec giỏ, thanh toán (cả bộ nếu đổi khung thanh toán). Mini: toàn bộ.

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
