# Gói phien: phiên đăng nhập Mini App, tài khoản khách, đăng xuất

- Nhánh `review/e2e-phien`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-phien`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ theo nghĩa xác thực (đụng đăng nhập, gộp tài khoản). Hai lượt review Opus. migration: KHÔNG. Chạy song song.
- Mục: E-12, E-13, E-14, E-61, E-63, E-64.

## Mục tiêu

Lỗi tạm thời (429, 5xx, mạng) không đẩy khách quen về tài khoản "Khách". Tài khoản bị khoá thấy lời báo. Liên kết Zalo sau khi để app lâu vẫn chạy và báo đúng lý do khi lỗi. Cache được làm mới khi danh tính đổi. deviceId không lưu thô. Đăng xuất dọn sạch.

## Được sửa

- Mini: `store/auth.ts`, `services/api.ts`, `services/query-client.ts` (chỉ export `CATALOG_KEYS`), `components/ui/auth-gate.tsx`, `components/home/new-customer-gift.tsx` (+ spec), `components/home/guest-link-card.tsx`, `components/coupon-claim-gate.tsx`, `components/game/guest-banner.tsx`, `pages/recycle.tsx`, `hooks/use-recycle-login.ts`, `components/waste-phone-needed.tsx`, `utils/guest-user.ts`, spec cạnh (`store/auth.spec.ts`, `services/api.spec.ts`).
- API: `auth/**`, `analytics/analytics.controller.ts`, `common/real-user.ts` (chỉ nếu cần cho khoá băm), spec cạnh.

## KHÔNG sửa

- `pages/checkout.tsx` (giohang): GIỮ `ensurePhone()` trả `null` khi lỗi (checkout và các gói khác dựa vào). Thêm hàm MỚI ném lỗi cho các nút liên kết.
- `components/app.tsx` (giohang): đăng ký dọn cache đặt trong `store/auth.ts` (auth.ts nhập `queryClient` được, không tạo vòng: `query-client.ts` chỉ nhập QueryClient, catalog-stale, http).
- `admin/admin.service.ts` (admin-hopviec): chỉ đọc để kiểm `startsWith('guest_')` vẫn đúng.
- `apps/miniapp/src/i18n/vi.ts` (ctv): dùng `vi.errors.sessionUnavailable` có sẵn; lời "bị khoá" lấy từ máy chủ.
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- muachung (`group-buy.tsx`) và ctv (`affiliate.tsx`) gọi `ensurePhone()` và cần nó trả `null` khi không liên kết được. Đừng đổi chữ ký.
- hotro tạo store trợ lý AI và tự xoá khi `useAuthStore` chuyển sang chưa đăng nhập (họ subscribe). Đừng đổi tên trường `user`/`status` của store.

## Mục việc

### E-12 (P2) Lỗi 429/503/ACCOUNT_BLOCKED đẩy khách về tài khoản "Khách" (KYTHUAT-01)
- Bằng chứng: `apps/miniapp/src/store/auth.ts:124-131, 134-141` (login), `:172-174, 178-187, 190-195` (restore); `auth/auth.service.ts:961` (ACCOUNT_BLOCKED); `auth/zalo.service.ts:101` (503); `common/throttle/throttle.config.ts:21, 38, 62` (trần IP 30/phút).
- Sửa (`login` và `restore`): (1) chỉ khi `getZaloAccessToken()` ném (SDK, -1401, ngoài Zalo) mới về `loginGuest`. (2) `loginZaloMiniApp()` ném `HttpError` có response thì KHÔNG `loginGuest`: 401 `code === 'ACCOUNT_BLOCKED'` → `clearRefresh()`, `{ status: 'idle', error: <lời máy chủ> }`; 429, 5xx, không response → `{ status: 'error', error: vi.errors.sessionUnavailable }` (giữ phiên để `useSessionRecovery` thử lại). (3) Refresh lỗi mà không phải `isRefreshRejected` và máy còn refresh token → `'error'` rồi `return`, không đăng nhập lại từ đầu. (4) `auth-gate.tsx` hiện `error` khi có. KHÔNG đổi trần throttle.
- Test (`store/auth.spec.ts`): zalo-mini-app 503 → không `loginGuest`, status `'error'`; 429 → như trên; 401 ACCOUNT_BLOCKED → không `loginGuest`, `'idle'`, error chứa lời máy chủ; `getZaloAccessToken` ném -1401 → vẫn `loginGuest`; refresh 503 khi có token → không gọi `loginZaloMiniApp`.
- Xong khi: luồng chạy ngoài Zalo (trình duyệt dev, Playwright Mini) vẫn vào được bằng khách.

### E-13 (P2) Liên kết Zalo sau 15 phút bị 401 không làm mới; lỗi 409 bị nuốt (KYTHUAT-02)
- Bằng chứng: `apps/miniapp/src/services/api.ts:128, 164-165` (`req.url.includes('/auth/')`); `auth/auth.controller.ts:159-170` (ensure-phone cần JWT); `store/auth.ts:215-230` (`catch { return null }`); `auth/auth.service.ts:336, 488` (409).
- Sửa: `api.ts` thay hai chỗ bằng `isAnonAuthCall(url)` so path (bỏ query) với `/^\/auth\/(zalo-mini-app|guest|zalo-oauth|refresh|logout)$/`. Thêm `ensurePhoneOrThrow()` trong store: khách từ chối sheet (phoneToken null) → trả null; lỗi API → ném `HttpError`. `ensurePhone()` cũ gọi hàm mới và bắt lỗi trả null (giữ hành vi cũ). Các nút liên kết của gói (guest-link-card, new-customer-gift, coupon-claim-gate, game/guest-banner, recycle, use-recycle-login, waste-phone-needed) dùng `ensurePhoneOrThrow` và hiện `getErrorMessage(err)` thay câu "thất bại" chung.
- Test: `api.spec.ts`: 401 ở `/auth/ensure-phone` gọi refresh rồi gửi lại; 401 ở `/auth/refresh` không refresh. `auth.spec.ts`: 409 → `ensurePhoneOrThrow` ném lỗi mang message máy chủ; `ensurePhone` vẫn trả null.
- Xong khi: checkout không đổi hành vi.

### E-14 (P2) deviceId (khoá đăng nhập tài khoản khách) lưu thô (KYTHUAT-06)
- Bằng chứng: `auth/auth.service.ts:105-111` (`zaloId = guest_<deviceId>`); `admin/admin.controller.ts:447-450` (CSKH xem được); `admin/admin.service.ts:398`; Mini `services/api.ts:139-141` (`X-Device-Id`); `analytics/analytics.controller.ts:20, 28` (chép vào `anonymousId`); so `auth.service.ts:1022` (refresh token băm).
- Sửa: `loginAsGuest`: khoá mới `guest_h_<sha256(deviceId) hex>`. Tìm khoá băm trước; không thấy thì tìm khoá cũ `guest_<deviceId>` và đổi tại chỗ sang khoá băm (`updateMany where zaloId = cũ`); xử lý P2002 như hiện nay (hai request song song không tạo hai dòng). Giữ tiền tố `guest_` để các chỗ kiểm `startsWith('guest_')` và `_merged_` vẫn đúng (kiểm `common/real-user.ts`, `admin.service.ts:196`, `apps/miniapp/src/utils/guest-user.ts`). `analytics.controller.ts:28`: dùng `sha256(deviceId)` cắt 32 ký tự thay header thô.
- Test: `auth.service.spec.ts` (khách mới lưu khoá băm; dòng cũ đổi khoá và đăng nhập lại được bằng cùng deviceId; song song không tạo đôi); `analytics.controller.spec.ts` (anonymousId khác header thô). Race spec nếu có spec `guest`/`auth`.
- Xong khi: không mất tài khoản khách cũ.

### E-61 (P3) Danh tính đổi trong phiên mà cache vẫn số của tài khoản khách (KYTHUAT-03)
- Bằng chứng: `store/auth.ts:100-111, 223-226, 248-251`; `auth/auth.service.ts:283-284`; Mini `pages/game.tsx:87`, `pages/wallet.tsx:53`, `pages/checkout.tsx:178` (`['loyalty']`); `components/game/guest-banner.tsx` (invalidate riêng); `services/query-client.ts:44, 50`.
- Sửa: trong `store/auth.ts`, `useAuthStore.subscribe`: khi `prev.user?.id && s.user?.id && s.user.id !== prev.user.id` thì `queryClient.invalidateQueries({ predicate: (q) => !CATALOG_KEYS.some((k) => q.queryKey[0] === k[0]) })`. Lần đăng nhập đầu (prev null) không gọi. Export `CATALOG_KEYS` từ `query-client.ts`. Bỏ các invalidate rời trong `guest-banner.tsx`.
- Test: `auth.spec.ts`: ensurePhone trả user id khác → invalidate 1 lần; cùng id → không; đăng nhập đầu → không.
- Xong khi: không tạo import vòng (kiểm build Vite và `madge` nếu có, hoặc chạy vitest).

### E-63 (P3) Đăng xuất Mini không thu hồi refresh token, giữ thông tin hoá đơn (KYTHUAT-08)
- Bằng chứng: `store/auth.ts:233-243`; `pages/checkout.tsx:116, 285` (`tubu_invoice`); web làm đủ ở `apps/web/src/lib/auth-context.tsx:217, 224`.
- Sửa: `logout()` đọc refresh token trước khi xoá, gọi `api.post('/auth/logout', { refreshToken })` kiểu best-effort (`.catch` có log), rồi `localStorage.removeItem('tubu_invoice')` (bọc try). Không sửa checkout.tsx.
- Test: `auth.spec.ts`: logout gọi `/auth/logout` với token đã lưu và xoá `tubu_invoice`; API lỗi vẫn đăng xuất trên máy.
- Xong khi: test xanh.

### E-64 (P3) "Quà khách mới" trong Mini hứa giảm khi đặt định kỳ dù Mini ẩn định kỳ (DODANG-03 = R-157)
- Bằng chứng: `components/home/new-customer-gift.tsx:46` (dòng đẩy không điều kiện); spec đòi dòng này `new-customer-gift.spec.tsx:88, 128, 174, 181`; các chỗ đã lọc: `product-detail.tsx:615`, `profile.tsx:106`, `components/orders/orders-tabs.ts:26`.
- Sửa: bọc dòng đó bằng `if (SUBSCRIPTIONS_IN_MINIAPP)`. Sửa 4 chỗ spec thành `not.toHaveTextContent('Đặt định kỳ')`. Web giữ nguyên.
- Test: `new-customer-gift.spec.tsx`.
- Xong khi: test xanh.

## Kiểm riêng của gói
- Jest API auth, analytics. Race spec có `auth`/`guest`/`merge`.
- Playwright: Mini toàn bộ (đổi luồng đăng nhập). Web không đổi (chỉ chạy nếu đụng API dùng chung).

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
