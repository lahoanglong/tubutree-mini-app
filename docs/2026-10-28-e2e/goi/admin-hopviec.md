# Gói admin-hopviec: hộp việc "Hôm nay" của quản trị

- Nhánh `review/e2e-admin-hopviec`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-admin-hopviec`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (xác nhận tiền đơn đại lý, công nợ đại lý). Hai lượt review Opus. migration: CÓ (bảng `DealerCreditPaymentReport`).
- Gói này giữ ĐẦU TIÊN `apps/api/prisma/schema.prisma`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/lib/admin-client.ts`. Gói admin-don và admin-nhansu chạy SAU gói này và gộp nhánh này. Sửa hai file admin lớn theo khối nhỏ, không đổi format cả file, để gói sau gộp dễ.
- Mục: E-1, E-24, E-25, E-26 (API + web), E-28, E-52, E-55, E-56, E-59, E-60.

## Mục tiêu

Mọi việc có hạn chót (đơn đại lý chờ tiền, xoá tài khoản, ca chờ duyệt, đại lý báo đã trả nợ) có thẻ trong hộp việc, có giờ còn lại, xếp theo độ gấp. Số trên thẻ cập nhật ngay sau khi xử lý. "Hôm nay" đọc đúng nghĩa và bấm được.

## Được sửa

- API: `ops/ops-inbox.service.ts`, `admin/admin.service.ts`, `admin/admin-order-filter.ts`, `admin/admin-revenue.ts`, `dealer/**`, `external-points/external-points-attention.ts` và phần lọc admin của `external-points/**`, `users/**` (chỉ nếu cần đếm yêu cầu xoá), `apps/api/prisma/schema.prisma`, migration mới `apps/api/prisma/migrations/20261029HHMMSS_dealer_credit_payment_report/`, spec cạnh, race spec mới trong `apps/api/test/integration-race/`.
- Web: `app/admin/page.tsx`, `lib/admin-client.ts`, `lib/external-claims.ts`, `components/admin/{ops-inbox-tab,order-status-actions,pancake-attention,storefronts-tab,return-request-row,customer-refunds-tab,dealer-claims-tab,product-categories-tab,dealer-accounts-tab,dealer-credit-panel,reports-tab,reports-revenue-section,external-claims-tab,account-deletion-panel}.tsx`, spec cạnh.

## KHÔNG sửa

- `components/admin/vn-date-input.tsx` (admin-don): mốc "Hôm nay"/"Hôm qua" của Báo cáo tính ngay trong `reports-tab.tsx`, không sửa `datePresets`.
- `orders/order-returns.service.ts`, `orders/customer-refunds.service.ts` (api-tin → admin-don). `ops/ops-health.service.ts` (hotro). `ops/ops.module.ts` (api-tin).
- Mini `pages/admin.tsx` (admin-nhansu làm số trên tab "Duyệt ca").
- KHÔNG đổi TTL tự huỷ, hạn mức nợ, cách tính doanh thu đã có (chỉ thêm số và đổi nhãn).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- admin-don sau gói này: thêm lọc `userId` vào `admin-order-filter.ts`, `onPaid` vào `order-status-actions.tsx`, ô tìm vào `customer-refunds-tab.tsx`, và nhiều khối trong `page.tsx`. Đừng đổi tên hàm export của các file đó.
- admin-nhansu sau gói này: thêm migration cột `RoleGrant.staffPermissions`, `Storefront.contentChangedAt`, lọc mới trong `storefronts-tab.tsx`. Đặt tên migration của gói này với giờ sớm hơn.
- `openInbox` trong `page.tsx` có `target: Record<Exclude<InboxKey,...>, Tab>` liệt kê đủ khoá: mỗi khoá mới phải thêm ở đó.

## Mục việc

### E-1 (P1) Đơn đại lý chuyển khoản chờ tiền không có trong hộp việc, tự huỷ sau 72 giờ (VANHANH-01)
- Bằng chứng: `admin/admin-order-filter.ts:133-138` (chỉ `type: 'RETAIL'`); `ops/ops-inbox.service.ts:110`; `orders/pending-payment-expiry.cron.ts:88-97`; `dealer/dealer.service.ts:359-365`; `orders/pending-payment-ttl.ts:7-8`.
- Sửa: `DEALER_TRANSFER_TO_CONFIRM_WHERE = { type: 'DEALER', status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', paymentMethod: 'BANK_TRANSFER' }` và queue `dealer_transfer_to_confirm` (`ORDER_QUEUES`). Hộp việc: khoá `dealerTransferToConfirm`, audience `['KE_TOAN']` (và ADMIN như các khoá kế toán khác), `hoursLeft` theo `readDealerPendingPaymentTtlHours`, bỏ đơn có `autoCancelBlockedAt`. Web: thêm khoá vào `InboxKey` (`admin-client.ts` khoảng dòng 1711), `INBOX_LABELS`/`INBOX_TAB` (nhãn "Đơn đại lý trả trước chờ xác nhận tiền"), dòng giờ tự huỷ như thẻ chuyển khoản lẻ, `openInbox` gieo `extra: { queue: 'dealer_transfer_to_confirm', order: 'asc' }`.
- Test: `ops-inbox.service.spec.ts` (KE_TOAN thấy khoá; chỉ đếm DEALER PENDING_PAYMENT BANK_TRANSFER UNPAID; giờ theo TTL đại lý); `ops-inbox-tab.spec.tsx`; ca DEALER trong `apps/api/test/integration-race/admin-order-list-filters.race-spec.ts`.
- Xong khi: lọc đơn lẻ cũ không đổi kết quả.

### E-24 (P2) Yêu cầu xoá tài khoản không có thẻ việc (VANHANH-02)
- Bằng chứng: `users/users.service.ts:259, 277` (hứa 3 ngày làm việc); `ops/ops-inbox.service.ts:29-63`; `app/admin/page.tsx:656`; `users/admin-account-deletion.controller.ts:14`.
- Sửa: khoá `accountDeletionPending`, audience `'ADMIN'`, đếm `accountDeletionRequest` `status: 'PENDING'`, kèm `oldestDays`. Web nhãn "Yêu cầu xoá tài khoản chờ xử lý", gợi ý "Đã hứa khách xử lý trong 3 ngày làm việc". `openInbox` mở tab `users` và cuộn tới `AccountDeletionPanel` (`id="account-deletions"`, `scrollIntoView` khi có seed).
- Test: `ops-inbox.service.spec.ts`; `account-deletion-panel.spec.tsx` (seed mở và cuộn đúng khối).
- Xong khi: chỉ ADMIN thấy (giữ quyền như cũ).

### E-25 (P2) Đại lý báo đã trả nợ: chỉ một tin, không lưu, kế toán không nhận (VANHANH-03)
- Bằng chứng: `dealer/dealer.service.ts:509-540`; `common/notify-admins.ts:39`; `dealer/dealer-admin.controller.ts:116-117` (`@AllowStaff('KE_TOAN')`); `app/admin/page.tsx:348`.
- Sửa: bảng `DealerCreditPaymentReport` (id, userId, amount, note, status REPORTED/RECORDED/DISMISSED, createdAt, resolvedBy, resolvedAt, resolveNote) bằng migration chỉ thêm. `reportCreditPayment` ghi một dòng rồi mới báo (giữ tin cũ). `adminRecordCreditPayment` nhận `reportId` tuỳ chọn và đóng báo cáo trong cùng transaction (chỉ đóng nếu còn REPORTED). Endpoint "Không thấy tiền" đặt DISMISSED kèm lý do. Hộp việc khoá `dealerCreditReported` (audience `['KE_TOAN']` + ADMIN) dẫn tới `dealerAccounts`. `dealer-accounts-tab.tsx`: khối "Đại lý báo đã chuyển (n)" với nút "Ghi nhận" (điền sẵn số tiền, vẫn qua luồng ghi nhận cũ) và "Không thấy tiền" (bắt nhập lý do).
- Test: `dealer.service.spec.ts` (báo tạo dòng; ghi nhận đóng dòng; chỉ báo thì không trừ nợ); race spec: ghi nhận hai lần cùng `reportId` chỉ trừ một lần.
- Xong khi: luồng ghi nhận cũ (không `reportId`) chạy như trước.

### E-26 (P2, phần API + web) Ca nhân viên chờ duyệt không có thẻ việc (VANHANH-04)
- Bằng chứng: `staff/attendance/attendance.service.ts:97-99`; `staff/shifts/shifts.service.ts:37`; `ops/ops-inbox.service.ts:29-63`; `components/admin/ops-inbox-tab.tsx:61-72`.
- Sửa: khoá `shiftsPending`, audience `'ADMIN'`, đếm `shift` `status: 'PENDING'` và `workDate >= hôm nay (giờ VN)`. Web nhãn "Ca nhân viên chờ duyệt", `INBOX_TAB.shiftsPending = 'shiftApproval'`, `openInbox` → `setTab('shiftApproval')`. (Số trên tab "Duyệt ca" của Mini do admin-nhansu làm.)
- Test: `ops-inbox.service.spec.ts` (ca quá khứ không đếm); `ops-inbox-tab.spec.tsx`.
- Xong khi: test xanh.

### E-28 (P2) "Doanh thu hôm nay" chỉ tính tiền đã thu, COD đặt hôm nay luôn 0đ (VANHANH-06)
- Bằng chứng: `admin/admin.service.ts:856-880`; `admin/admin-revenue.ts:16-20`; `components/admin/ops-inbox-tab.tsx:211`; `components/admin/reports-revenue-section.tsx:42-43`.
- Sửa: `getTodaySummary` thêm `gmv` hôm nay, hôm qua, 7 ngày, dùng đúng `GMV_ORDER_SQL` như báo cáo. Web đổi nhãn "Doanh thu" thành "Đã thu từ đơn hôm nay" và thêm dòng phụ "Giá trị đơn đặt X". Giữ số cũ.
- Test: race spec `admin-today-summary.race-spec.ts` (đơn COD CONFIRMED hôm nay: đã thu 0, giá trị đơn đặt = total; khớp `revenueReport` cùng ngày); `ops-inbox-tab.spec.tsx`.
- Xong khi: số "đã thu" không đổi.

### E-52 (P3) Xử lý xong việc mà số trên thẻ đứng tới 60 giây (VANHANH-09)
- Bằng chứng: `components/admin/order-status-actions.tsx:150-154`; `pancake-attention.tsx:36-41`; `storefronts-tab.tsx:61, 66-73, 197-200`; `return-request-row.tsx:69-71`; `customer-refunds-tab.tsx:137`; `dealer-claims-tab.tsx:152, 157`; `product-categories-tab.tsx:33`; `ops-inbox-tab.tsx:79`.
- Sửa: hàm `invalidateInbox(qc)` trong `lib/admin-client.ts` (invalidate `['admin-ops-inbox']`), gọi trong `onSuccess` của các mutation trên.
- Test: spec `order-status-actions` (sau xác nhận tiền có invalidate khoá inbox); spec `storefronts-tab`.
- Xong khi: test xanh.

### E-55 (P3) Thẻ việc xếp theo thứ tự khai báo, không thấy việc cũ nhất (VANHANH-12)
- Bằng chứng: `ops/ops-inbox.service.ts:88-153, 167-173, 183-187`; `components/admin/ops-inbox-tab.tsx:106, 123-131`.
- Sửa: định nghĩa có thêm `oldest?: () => Promise<Date | null>` cho chuyển khoản lẻ và đại lý, gian hàng chờ duyệt, đổi/trả chờ duyệt, xoá tài khoản, ca chờ, đại lý báo trả nợ; trả `oldestAt`. Web xếp thẻ mở theo `hoursLeft` tăng dần, rồi `oldestAt` cũ nhất; mỗi thẻ thêm "Cũ nhất: N ngày/giờ".
- Test: `ops-inbox-tab.spec.tsx` (thứ tự thẻ); `ops-inbox.service.spec.ts` (`oldestAt`).
- Xong khi: không thêm truy vấn nặng (mỗi `oldest` là một `findFirst` có `orderBy` trên cột có index; ghi lại nếu thiếu index, không thêm migration index ở gói này).

### E-56 (P3) Số "Hôm nay" và đơn mới nhất không bấm được (VANHANH-13)
- Bằng chứng: `components/admin/ops-inbox-tab.tsx:187-195, 211-218`; `app/admin/page.tsx:1041-1058`; `components/admin/reports-tab.tsx:11-17`.
- Sửa: `TodayStat` nhận `onPress`. "Đơn hôm nay" mở tab Đơn với `from = to = hôm nay`; "Đã thu" mở Báo cáo mốc "Hôm nay"; "Khách mới" mở Người dùng. `ReportsTab` thêm mốc `today`, `yesterday` (tính trong `reports-tab.tsx`). Thẻ đơn mới nhất gọi `openOrderByCode`.
- Test: `ops-inbox-tab.spec.tsx`, `reports-tab.spec.tsx`.
- Xong khi: test xanh.

### E-59 (P3) "Đã xử lý" việc Pancake/thu gom không ghi lịch sử đơn (VANHANH-16)
- Bằng chứng: `admin/admin.service.ts:1319-1347, 1349-1357`; `components/admin/pancake-attention.tsx:77-87`.
- Sửa: sau `updateMany` thành công, `orderStatusHistory.create({ fromStatus: status, toStatus: status, actorType: 'ADMIN', actorId, note: 'Đã xử lý việc Pancake: <lý do cũ> — <ghi chú>' })` theo mẫu `resyncDeliveredEffects` (`admin.service.ts:1296`). Làm tương tự cho `markGomdonHandled`. Khách không thấy dòng này (`orders.service.ts:279` bỏ dòng cùng trạng thái; kiểm lại).
- Test: `admin.service.spec.ts` (có dòng lịch sử kèm ghi chú; khách không thấy).
- Xong khi: test xanh.

### E-60 (P3) Thẻ "Tích điểm đơn sàn cần xử lý" mở ra danh sách rỗng (VANHANH-17, thu hẹp)
- Phạm vi: chỉ thêm lọc `partial_refund` và gieo đúng lọc khi bấm thẻ. Cờ đơn sàn đang tắt.
- Bằng chứng: `external-points/external-points-attention.ts:29-40`; `components/admin/external-claims-tab.tsx:56`; `lib/external-claims.ts:171-174`; `app/admin/page.tsx:556`.
- Sửa: inbox trả thêm `parts` cho khoá này (review, attempts, partial, closed, stale). API `listExternalClaims` thêm lọc `partial_refund` (`state CREDITED`, `reviewReason` khác null). `ExternalClaimsTab` nhận seed và hiện chip có số; bấm thẻ mở chip có số > 0 đầu tiên.
- Test: `external-claims-tab.spec.tsx`; `ops-inbox.service.spec.ts`.
- Xong khi: tổng các phần bằng số trên thẻ.

## Kiểm riêng của gói
- Race spec bắt buộc: `admin-order-list-filters`, `admin-today-summary`, spec có `dealer`, `inbox`.
- `npx prisma generate` sau khi đổi schema; migration chạy trên DB sạch.
- Playwright: web gate cả bộ admin (`apps/e2e/tests/*admin*`), Mini toàn bộ.

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
