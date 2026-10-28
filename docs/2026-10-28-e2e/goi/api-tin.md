# Gói api-tin: gửi tin không im lặng, lệch sổ, tin đơn hàng

- Nhánh `review/e2e-api-tin`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-api-tin`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (điểm hết hạn, hoa hồng, hoàn tiền). Hai lượt review Opus. migration: KHÔNG. Chạy song song. Gói admin-don chạy sau gói này.
- Mục: E-3, E-16 (trừ dòng `loyalty.service.ts:442`), E-31, E-34, E-36, E-45, E-85, E-86.

## Mục tiêu

Không còn lời gửi tin nào nuốt lỗi. Lệch sổ điểm/Ví được phát hiện mỗi đêm. Tin giao hàng và ZNS không mất. Nút đánh giá không dẫn tới SP đã gỡ.

## Được sửa

- API: `notifications/notifications.service.ts`; `orders/order-status.service.ts`, `orders/orders.service.ts`, `orders/order-reversal.service.ts`, `orders/order-returns.service.ts`, `orders/customer-refunds.service.ts`, `orders/refund-queue.ts`; `subscriptions/**`; `loyalty/loyalty-expiry.service.ts`, `loyalty/tier-drop-notice.service.ts`; `lifecycle/lifecycle.service.ts`; `game/game-gift.service.ts`, `game/game-reminder.service.ts`; `integrations/pancake/pancake-order-body.ts`; `ops/ops.module.ts`, `ops/ledger-drift.cron.ts` (mới); `common/silent-notify-audit.spec.ts` (mới); spec cạnh.
- app-core `api/orders.ts`; Mini `pages/order-detail.tsx`, `utils/order-status.ts`; web `app/tai-khoan/don-hang/[code]/**`, `lib/order-view.ts`; spec cạnh.

## KHÔNG sửa

- `loyalty/loyalty.service.ts` (diem; dòng 442 warn→error là việc của diem). `affiliate/**` (ctv). `checkout/checkout.service.ts` (diem).
- `notifications.controller.ts`, `notifications.module.ts`, `notification-feed.service.ts`, `notify-admins.ts` (thongbao). `lifecycle/review-invite.service.ts` (thongbao).
- `ops/ops-health.service.ts` (hotro), `ops/ops-inbox.service.ts` (admin-hopviec).
- `apps/api/prisma/seed.ts`, `notification-variables.ts` (doirac): gói này KHÔNG thêm mẫu tin; cảnh báo ops dùng mẫu có sẵn.
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- admin-don chạy sau và thêm tìm kiếm `q` vào `order-returns.service.ts` (`listForAdmin`) và `customer-refunds.service.ts` (`list`). Đừng đổi chữ ký hai hàm này.
- thongbao thêm `audience` tuỳ chọn cho `notifyAdmins`. Gói này gọi `notifyAdmins` như cũ (không truyền `audience`).
- diem đổi `loyalty.service.ts`. Cron lệch sổ chỉ gọi `findPointsLotDrift` (`loyalty/points-reconcile.ts`) và `findWalletLedgerDrift` (`wallet/wallet-reconcile.ts`), không sửa hai file đó.

## Mục việc

### E-3 (P2) 24+ lời gửi tin nuốt lỗi không log (KYTHUAT-04 + CSKH-05)
- Vấn đề: `.notify(...).catch(() => undefined)` không log. Lỗi DB khi gửi "Đơn đã xác nhận", "Đã hoàn tiền" mất dấu.
- Bằng chứng: `orders/order-status.service.ts:476-478, 602-607, 611-613, 733-735`; `orders/orders.service.ts:489-494`; `orders/customer-refunds.service.ts:304-310, 409-414, 542-547`; `orders/refund-queue.ts:228-233, 470-475, 549-554`; `orders/order-returns.service.ts:253, 372-374, 492-496, 631`; `subscriptions/subscriptions.service.ts:708, 889-904`; `lifecycle/lifecycle.service.ts:260`; `game/game-gift.service.ts:117`; `game/game-reminder.service.ts:81, 138`; `loyalty/loyalty-expiry.service.ts:532-536`; `notify()` ở `notifications.service.ts:100-168`.
- Sửa: `NotificationsService.notifySafe(userId, code, data, opts?, context?)`: gọi `notify()` trong try; lỗi thì `this.logger.error` (mã tin, userId, context) và `captureServerError(err)` (`apps/api/src/config/sentry.ts:76`); trả boolean, không ném. Thay mọi `.notify(...).catch(() => undefined|null|{})` trong `apps/api/src/modules/**` (chạy `rg` để bắt hết, không chỉ danh sách trên). Thêm `apps/api/src/common/silent-notify-audit.spec.ts` (theo mẫu `beta-removed-audit.spec.ts`) quét `modules/**/*.ts` (bỏ spec), regex `\.notify\([\s\S]*?\)\s*\.catch\(\(\)\s*=>\s*(undefined|null|\{\s*\})\)`, đòi 0 kết quả.
- Test: `notifications.service.spec.ts`: `notifySafe` không ném, gọi `logger.error` có mã mẫu, gọi `captureServerError`. Audit spec đỏ trước khi thay, xanh sau.
- Xong khi: audit spec xanh; hành vi gửi tin khi không lỗi không đổi.

### E-16 (P2) Không có kiểm lệch sổ điểm/Ví tự động; lỗi cron chỉ warn (DIEM-02, trừ `loyalty.service.ts:442`)
- Bằng chứng: `loyalty/loyalty-expiry.service.ts:404-406, 452-456`; `common/cron-run/track-cron.ts` (chỉ log error mới thành ERRORS); `loyalty/points-reconcile.ts:61`, `wallet/wallet-reconcile.ts` chỉ dùng trong `apps/api/scripts/reconcile-*.ts`.
- Sửa: cron đọc-chỉ 04:30 giờ VN `ops/ledger-drift.cron.ts` (bọc `TrackCron`, đăng ký ở `ops.module.ts`): gọi `findPointsLotDrift` và `findWalletLedgerDrift`; có lệch thì `logger.error` kèm số user lệch (không in dữ liệu cá nhân) và `notifyAdmins` với mẫu có sẵn `OPS_HEALTH_ALERT` (`{{title}}: {{summary}}`). Đổi `logger.warn` ở `loyalty-expiry.service.ts:405, 453` thành `logger.error`. Không sửa sổ, chỉ báo.
- Test: spec cron mới (giả lệch → log error, kết quả ERRORS, gọi `notifyAdmins` một lần; không lệch → không gửi); spec expiry kiểm log error.
- Xong khi: cron không ghi gì vào sổ.

### E-31 (P3) Nút "Viết đánh giá" dẫn tới SP đã gỡ (404) (MUAHANG-04)
- Bằng chứng: Mini `pages/order-detail.tsx:362-371, 396-411`; web `app/tai-khoan/don-hang/[code]/page.tsx:330-337`; `reviews/review-eligibility.ts:51-72`; `catalog/catalog.service.ts:393-395`; cron mời đánh giá đã bỏ qua SP ngừng bán `lifecycle/review-invite.service.ts:118, 125`.
- Sửa: `orders.service.ts` `attachItemMedia` (khoảng dòng 347-356) trả thêm `productPublic: v.product.isActive && v.product.approvalStatus === 'APPROVED'`. Thêm trường vào `OrderItemView` (`packages/app-core/src/api/orders.ts`). Mini và web chi tiết đơn: chỉ hiện nút đánh giá và chỉ cho bấm dòng SP khi `productPublic !== false`.
- Test: `orders.service.spec.ts` (SP tắt → `productPublic=false`); `order-detail.spec.tsx` Mini; spec trang chi tiết đơn web.
- Xong khi: không còn link tới SP đã gỡ trong chi tiết đơn.

### E-34 (P3) Đơn định kỳ hiện ghi chú tiếng Anh như lời khách (MUAHANG-07)
- Quyết định thay chủ: KHÔNG đổi `note` lưu trong DB (kho/Pancake đang đọc). Chỉ đổi cách hiện.
- Bằng chứng: `subscriptions/subscriptions.service.ts:801` (`note: 'Đơn đặt định kỳ (Subscribe & Save)'`), `:792-795`; Mini `pages/order-detail.tsx:667-675`; web `app/tai-khoan/don-hang/[code]/page.tsx:388-391`; `apps/miniapp/src/utils/order-status.ts:216-218`; `apps/web/src/lib/order-view.ts:294-296`.
- Sửa: view đơn trả `source` nếu chưa có. Chi tiết đơn hai nền: khi `source === 'subscription'` thì không hiện khối "Ghi chú" nếu nội dung đúng bằng ghi chú cố định đó; thay bằng nhãn "Đơn định kỳ". `discountRows`: khi `source === 'subscription'` và chỉ có `discount` thì nhãn "Ưu đãi đặt định kỳ". Không đổi số tiền.
- Test: spec `discountRows` hai nền; spec chi tiết đơn (đơn định kỳ không hiện chữ tiếng Anh).
- Xong khi: `pancake-order-body` không đổi (chạy spec của nó).

### E-36 (P3) Cron hết hạn điểm quét lại toàn bộ khách từng có lô hết hạn (DIEM-09)
- Bằng chứng: `loyalty/loyalty-expiry.service.ts:380-419, 429-459`.
- Sửa: chỉ lấy ứng viên có `expiresAt > (mốc lần chạy thành công trước − 2 ngày)` và `expiresAt <= now`; đọc mốc từ bảng `cron_run` (TrackCron) sẵn có; không có mốc thì quét như cũ. Không thêm migration. Logic trừ điểm không đổi.
- Test: spec: khách đã xử lý hết hạn từ lâu không bị tải lại; lần đầu (không mốc) vẫn quét đủ; race spec điểm hết hạn hiện có xanh.
- Xong khi: số điểm trừ không đổi trên dữ liệu test.

### E-45 (P3) Trả một phần cắt hoa hồng mà không báo CTV (CTV-07)
- Bằng chứng: `orders/order-reversal.service.ts:497-537`; `orders/order-returns.service.ts:421-428, 445`; so `affiliate/affiliate.service.ts:1121-1130` (trả cả đơn có `COMMISSION_REVERSED`).
- Sửa: `reversePartialReturn` trả thêm `commissionCutBy: { affiliateUserId, amount }[]` (lấy `affiliateUserId` trong `findMany` ở `:504`). Sau commit ở `order-returns.service.ts` (cạnh `sendReferralNotices`), `notifySafe(uid, 'COMMISSION_REVERSED', { amount })` cho từng CTV có cắt > 0. Kiểm biến mẫu `COMMISSION_REVERSED` trong `seed.ts` (chỉ đọc) để truyền đủ biến.
- Test: spec order-returns: trả một phần có hoa hồng thì gửi đúng một tin với số đã cắt; không hoa hồng thì không gửi.
- Xong khi: số tiền cắt không đổi.

### E-85 (P3) Tin "Đã giao, được cộng X điểm" có thể mất hẳn (CSKH-11)
- Bằng chứng: `orders/order-status.service.ts:416` (ném trước), `:476-478` (gửi tin), `:215-222`, `:522-531` (chạy lại không gửi), so `:603-608`.
- Sửa: gửi `ORDER_DELIVERED` với `dedupeKey: 'order-delivered:' + code`. Trong `runDeliveredEffects`, sau khi ghi `deliveredEffectsAt` thành công, gửi `ORDER_DELIVERED` (kèm `points_note` như dòng 459-461) với cùng `dedupeKey`, nên lượt nào xong trước thì gửi, lượt sau bị chặn.
- Test: spec order-status: lần đầu `creditOrderPoints` ném → không có tin; `resyncDeliveredEffects` → đúng 1 tin; gọi lại → không thêm.
- Xong khi: đơn giao bình thường vẫn đúng một tin.

### E-86 (P3) ZNS báo trước hạ hạng không gửi lại sau FAILED (CSKH-12 + R-170)
- Bằng chứng: `notifications/notifications.service.ts:112-118, 170-177, 228-242, 307` (kiểm log ZNS không lọc trạng thái; `queue.add` lỗi thì log FAILED nhưng giữ `dedupeKey` và không ném).
- Sửa: cả hai phần: (1) `dedupeWhere` khi `channel === 'ZNS'` thêm `status: { in: ['PENDING', 'RETRYING', 'SENT'] }`; (2) khi `queue.add` lỗi, giải phóng claim (đổi `dedupeKey` của log FAILED, ví dụ thêm hậu tố `:failed:<id>`, hoặc xoá khoá) để lượt sau gửi lại. Không đổi số lần thử hay lịch.
- Test: `notifications.zns-queue.spec.ts`: `queue.add` lỗi → log FAILED; gọi lại `notify` với `retryZns` → tạo log mới và xếp job. Ca SENT vẫn chặn gửi trùng.
- Xong khi: không gửi ZNS đôi cho log SENT.

## Kiểm riêng của gói
- Race spec bắt buộc: các spec có `notif`, `refund`, `return`, `loyalty-expiry`, `order-status`, `subscription` trong `apps/api/test/integration-race/`.
- Playwright: Mini toàn bộ; web spec chi tiết đơn.

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
