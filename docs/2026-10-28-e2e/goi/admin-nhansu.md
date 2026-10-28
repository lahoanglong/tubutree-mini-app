# Gói admin-nhansu: nhân sự trên Mini, gian hàng đổi sau duyệt

- Nhánh `review/e2e-admin-nhansu`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-admin-nhansu`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: CÓ (cột `RoleGrant.staffPermissions`, cột `Storefront.contentChangedAt`; chỉ thêm).
- CHẠY SAU admin-hopviec: trước khi làm, `git merge review/e2e-admin-hopviec` (workflow đã gộp thì bỏ qua). Migration của gói này đặt giờ muộn hơn migration của admin-hopviec.
- Mục: E-26 (số trên tab Mini), E-50, E-57, E-113.

## Mục tiêu

Chủ thêm nhân viên trên điện thoại chọn được nhóm việc, kể cả lời mời chưa mở app. Mini báo số ca chờ duyệt. Admin thấy gian hàng đổi nội dung sau khi duyệt. Xác nhận nguy hiểm trên Mini dùng tấm xác nhận chung.

## Được sửa

- API: `staff/rbac/**`, `staff/dto/**`, `storefront/storefront.service.ts` (chỉ `updateMine`), `storefront/storefront-admin.*`, `apps/api/prisma/schema.prisma`, hai migration mới `apps/api/prisma/migrations/20261029HHMMSS_role_grant_staff_permissions/`, `.../20261029HHMMSS_storefront_content_changed_at/`, spec cạnh.
- app-core `api/staff.ts`. Mini `pages/admin.tsx`, `services/staff-api.ts`, spec cạnh.
- Web `components/admin/staff-roster-tab.tsx`, `components/admin/storefronts-tab.tsx`, `lib/admin-storefronts-client.ts`, spec cạnh.

## KHÔNG sửa

- KHÔNG bắt duyệt lại gian hàng, KHÔNG ẩn gian hàng, KHÔNG gỡ tick (quyết định thay chủ).
- `ops/ops-inbox.service.ts`, `ops-inbox-tab.tsx` (admin-hopviec). `affiliate/**`, `storefront-quest.service.ts`, `storefront-builder.tsx` (ctv). `storefront/storefront.controller.ts` (diem).
- `apps/miniapp/src/i18n/vi.ts` (ctv). `components/app.tsx` (giohang).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- admin-hopviec đã thêm `invalidateInbox` vào `storefronts-tab.tsx`; giữ nguyên.
- admin-don có thể chạy song song với gói này và sửa `page.tsx`. Gói này cố tránh `page.tsx`; nếu bắt buộc thì chỉ sửa khu tab nhân sự và ghi lại.
- ctv sửa trình dựng gian hàng phía CTV (sắp xếp, nhãn). Gói này chỉ ghi `contentChangedAt` trong `updateMine`.

## Mục việc

### E-26 (P2, phần Mini) Tab "Duyệt ca" trên Mini không hiện số chờ (VANHANH-04)
- Bằng chứng: Mini `pages/admin.tsx` (tab "Duyệt ca"); API đếm ca chờ do admin-hopviec thêm vào hộp việc (khoá `shiftsPending`).
- Sửa: nhãn tab hiện số ca chờ duyệt từ hôm nay (dùng API ca chờ sẵn có hoặc `GET` hộp việc; chọn lời gọi nhẹ nhất có sẵn, không thêm API mới nếu không cần).
- Test: `admin.spec.tsx` Mini (có 3 ca chờ → nhãn "Duyệt ca (3)").
- Xong khi: không gọi thêm API khi người xem không phải ADMIN.

### E-50 (P3) Gian hàng đổi tên/ảnh sau duyệt không ai biết (CTV-11)
- Quyết định thay chủ: chỉ đánh dấu và cho admin lọc, KHÔNG bắt duyệt lại.
- Bằng chứng: `storefront/storefront.service.ts:175-221` (`updateMine` không đụng `approvedAt`); `storefront/storefront-visibility.ts:14-16`; `storefront/storefront-admin.service.ts:167-176`.
- Sửa: cột `contentChangedAt DateTime?` (migration chỉ thêm). `updateMine` ghi `contentChangedAt = now` khi đổi `title`, `headerNote`, `avatarUrl`, `coverUrl` và gian hàng đã có `approvedAt`. API admin: lọc `changedAfterApproval=true`, và hành động "Đã xem" đặt `contentChangedAt = null` (ghi log admin như các hành động khác). Web `storefronts-tab.tsx`: chip "Đổi sau duyệt (n)" và nút "Đã xem".
- Test: spec storefront service (đổi tên sau duyệt → có `contentChangedAt`; đổi khi chưa duyệt → không); spec admin (lọc, Đã xem); `storefronts-tab.spec.tsx`.
- Xong khi: hiển thị cho khách không đổi.

### E-57 (P3) Thêm nhân sự trên Mini không chọn được nhóm việc (VANHANH-14)
- Bằng chứng: Mini `pages/admin.tsx:489, 551, 620`; `services/staff-api.ts:3, 25`; `staff/rbac/rbac.service.ts:82`; web `components/admin/staff-roster-tab.tsx:164`; `app/admin/page.tsx:343-344`.
- Sửa: cột `RoleGrant.staffPermissions String[] @default([])` (migration chỉ thêm). `GrantRoleDto` nhận `permissions?: StaffPermission[]` (kiểm giá trị hợp lệ). `applyGrants` chép nhóm sang user khi áp. Mini sheet "Thêm nhân sự" thêm chip chọn nhiều nhóm (CSKH, Kho, Marketing, Kế toán); thẻ nhân sự hiện nhóm. `staff-roster-tab.tsx` cho chọn nhóm cả với lời mời chờ. app-core `api/staff.ts` thêm tham số.
- Test: `rbac.service.spec.ts` (lời mời có nhóm → user đăng nhập nhận đúng nhóm; không truyền nhóm → như cũ); `admin.spec.tsx` Mini; spec `staff-roster-tab`.
- Xong khi: chỉ ADMIN cấp được nhóm (giữ quyền cũ).

### E-113 (P3) Mini quản trị nhân sự dùng `window.confirm` (R-151)
- Bằng chứng: Mini `pages/admin.tsx` (thu hồi quyền, cấp ADMIN gọi `window.confirm`); ảnh `docs/2026-10-28-review/screens/mini375/admin__admin__mini375__s1.png`.
- Sửa: dùng ConfirmSheet chung của Mini (tìm component xác nhận sẵn có trong `apps/miniapp/src/components/ui`); nút "Thu hồi" có viền đỏ.
- Test: `admin.spec.tsx` (bấm Thu hồi mở tấm xác nhận; không gọi `window.confirm`).
- Xong khi: `rg "window.confirm" apps/miniapp/src/pages/admin.tsx` không còn kết quả.

## Kiểm riêng của gói
- `npx prisma generate` sau khi đổi schema; hai migration chạy trên DB sạch, sau migration của admin-hopviec.
- Race spec có `rbac`/`staff`/`storefront`.
- Playwright: Mini toàn bộ; web spec admin nhân sự và gian hàng.

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
