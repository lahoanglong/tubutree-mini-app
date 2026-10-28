# Gói hotro: Zalo OA, chat CSKH, trợ lý AI

- Nhánh `review/e2e-hotro`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-hotro`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG. Chạy song song.
- Cờ `chat.enabled` đang TẮT trên PROD; không bật. Không đổi cách gửi tin cho khách ngoài phần mục yêu cầu.
- Mục: E-15, E-23, E-62, E-75, E-82, E-105, E-106.

## Mục tiêu

Token OA không mất khi ghi lỗi giữa chừng và được làm mới hai lần trước hạn. Webhook OA bỏ sự kiện không phải tin khách và không để tin kẹt. Trả lời OA thất bại không bị ghi là đã trả lời. Đọc chat thì chuông hết số. Trợ lý AI giữ hội thoại khi khách xem SP rồi quay lại.

## Được sửa

- API: `integrations/zns/zalo-oa-token.*`, `integrations/zalo-oa/**`, `ops/ops-health.service.ts`, `support-chat/support-chat.service.ts`, spec cạnh; cron mới trong `integrations/zalo-oa/`.
- Mini: `pages/ai-advisor.tsx`, `pages/support-chat.tsx`, `store/ai-advisor.ts` (mới), spec cạnh.
- Web: `app/tu-van/**`, `app/ho-tro/chat/**`, `components/support-chat/**`, `lib/ai-advisor-store.ts` (mới), spec cạnh.
- `docs/GO-LIVE-KEYS.md` mục 5 (chỉ nếu đổi hướng dẫn webhook).

## KHÔNG sửa

- `store/auth.ts` (phien): store AI tự xoá bằng cách subscribe `useAuthStore` (khi `user` thành null), không sửa `logout()`. Web tương tự với auth-context sẵn có (đọc trạng thái, không sửa file auth).
- `support-chat/bridge-health.cron.ts`, `common/notify-admins.ts` (thongbao). `notifications/**` (thongbao, api-tin).
- `apps/web/src/components/admin/support-chat-tab.tsx`, `components/admin/support-chat/**` (admin-congcu).
- `apps/miniapp/src/i18n/vi.ts` (ctv). `components/app.tsx` (giohang).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- api-tin thêm cron lệch sổ gửi `OPS_HEALTH_ALERT`; gói này thêm kiểm hạn token OA vào `ops-health.service.ts`. Hai việc không chung file.
- admin-congcu sửa tab Chat CSKH của admin; gói này sửa màn chat của khách và service chat.

## Mục việc

### E-15 (P2) Làm mới token OA: ghi rời ba khoá, một lần thử trước hạn, không theo dõi (KYTHUAT-05)
- Bằng chứng: `integrations/zns/zalo-oa-token.service.ts:78-80`; `zalo-oa-token.util.ts:4` (`thresholdHours = 6`); `zalo-oa-token.cron.ts:18` (`0 0 */6 * * *`); `zns-result.ts:20`; `notifications.service.ts:32-35`; `ops/ops-health.service.ts` (không kiểm hạn token, khoảng dòng 158).
- Sửa: `refresh()` ghi ba khoá trong một `this.prisma.$transaction([...upsert])`, `K_REFRESH` đầu tiên; transaction lỗi thì `logger.error` kèm 6 ký tự cuối của refresh token mới để cứu tay. Ngưỡng mặc định 13 giờ (hơn hai chu kỳ cron). `ops-health.service.ts`: kiểm `zalo.oa_token_expires_at`, WARN khi còn dưới 3 giờ hoặc đã quá hạn mà ZNS đã cấu hình (không cấu hình thì bỏ qua).
- Test: `zalo-oa-token.service.spec.ts` (ghi lỗi → rollback, có log); `zalo-oa-token.util.spec.ts` (còn 12 giờ → `needsRefresh` true); spec ops-health (còn 2 giờ → WARN; chưa cấu hình → không cảnh báo).
- Xong khi: không gửi tin nào mới.

### E-23 (P2) Trợ lý AI mất hội thoại khi khách mở SP rồi quay lại (CSKH-06)
- Bằng chứng: Mini `pages/ai-advisor.tsx:41, 182`; web `app/tu-van/page.tsx:52, 65`; Mini `components/app.tsx:223` (`AnimationRoutes` gỡ trang cũ).
- Sửa: Mini store trong bộ nhớ `store/ai-advisor.ts` (zustand, tối đa 40 tin), trang đọc/ghi qua store; xoá khi `useAuthStore` chuyển sang không có user hoặc đổi user id (subscribe trong file store). Web `lib/ai-advisor-store.ts` tương tự, xoá khi đăng xuất (theo trạng thái auth-context). Không lưu xuống `localStorage`.
- Test: `ai-advisor.spec.tsx` (Mini) và `apps/web/src/app/tu-van/page.spec.tsx`: gửi câu, có trả lời, unmount rồi render lại thì tin còn; đăng xuất thì rỗng.
- Xong khi: chỉ ảnh hưởng khi cờ AI bật; bundle Mini entry không tăng (store chỉ nhập từ trang lazy).

### E-62 (P3) Webhook OA nhận cả sự kiện OA tự gửi; tin xếp hàng lỗi kẹt mãi (KYTHUAT-07, phần b và c)
- Quyết định thay chủ: chỉ làm lọc sự kiện và cron xếp lại. Cơ chế ký `X-ZEvent-Signature` (phần a) chờ chủ xác nhận trên dashboard Zalo, KHÔNG làm.
- Bằng chứng: `integrations/zalo-oa/zalo-oa-webhook.controller.ts:36-38` (TODO), `:57, :67, :86-90`; so `integrations/pancake/pancake-events-reconcile.service.ts:51`.
- Sửa: chỉ nhận `event_name` bắt đầu bằng `user_send_`; loại khác trả 200 rồi bỏ (không lưu). Cron 10 phút xếp hàng lại `oa_inbound_messages` còn RECEIVED quá 5 phút (theo mẫu reconcile Pancake, có khoá chạy một lượt).
- Test: `zalo-oa-webhook.controller.spec.ts` (`oa_send_text` → không lưu, 200; `user_send_text` → lưu); spec cron (RECEIVED quá 5 phút → xếp lại một lần).
- Xong khi: không đổi cách xác thực hiện tại.

### E-75 (P3) Trả lời qua OA coi là thành công khi Zalo báo lỗi trong body (DODANG-15)
- Bằng chứng: `integrations/zalo-oa/zalo-oa-message.client.ts:10-13` (TODO), `:27-33`; `zalo-oa-events.processor.ts:50-54`; so `zns-result.ts`.
- Sửa: `sendText` đọc `res.data.error`; khác 0 thì trả `false` và log `error`, `message`. Processor không đánh dấu REPLIED khi `false`.
- Test: spec client (`{ error: -230 }` → false); spec processor (false → không REPLIED).
- Xong khi: test xanh.

### E-82 (P3) Đọc chat xong chuông vẫn báo tin mới (CSKH-08)
- Bằng chứng: `support-chat/support-chat.service.ts:196-235`; Mini `pages/support-chat.tsx:168-169`; Mini `pages/home.tsx:52-53` (chuông).
- Sửa: `markRead` sau khi ghi `customerReadAt`: `notificationLog.updateMany({ where: { userId, channel: 'INAPP', templateCode: 'SUPPORT_CHAT_REPLY', status: { not: 'READ' }, sentAt: { lte: now } }, data: { status: 'READ' } })`. Mini `support-chat.tsx` và web `app/ho-tro/chat/page.tsx` sau khi gọi `markSupportChatRead`: `qc.invalidateQueries({ queryKey: ['notifications'] })`.
- Test: `support-chat.service.spec.ts` (markRead đổi log chuông sang READ, không đụng log khác); spec màn chat hai nền (có invalidate).
- Xong khi: test xanh.

### E-105 (P3) Nút phụ ở trợ lý AI và chat khác kiểu giữa hai nền (R-130)
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/mini375/ai-advisor__returning__mini375__s1.png` so `screens/web375/ai-advisor__returning__web375__s1.png`.
- Sửa: dùng một kiểu nút phụ theo token chung (theo Mini) ở trợ lý AI và chat web.
- Test: spec component (lớp/kiểu nút phụ).
- Xong khi: so ảnh 375px.

### E-106 (P3) Web 1280: dải trả lời nhanh trong băng trắng giữa khung chat (R-131, phần còn lại)
- Bằng chứng: ảnh `screens/web1280/chat__returning__web1280__s1.png`. Trang AI đã `max-w-2xl` (phần đó xong).
- Sửa: dải chip cùng nền với khung chat; nút trong dải không kéo dài quá `max-w-sm`.
- Test: spec trang chat web (lớp nền dải chip).
- Xong khi: so ảnh 1280px.

## Kiểm riêng của gói
- Jest API zalo-oa, zns, ops-health, support-chat.
- Playwright: Mini toàn bộ; web spec `/tu-van`, `/ho-tro`.

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
