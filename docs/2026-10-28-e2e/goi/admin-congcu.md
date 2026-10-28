# Gói admin-congcu: công cụ quản trị cộng đồng, lương, chat CSKH

- Nhánh `review/e2e-admin-congcu`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-admin-congcu`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (thưởng/phạt lương). Hai lượt review Opus. migration: KHÔNG. Chạy song song.
- Mục: E-27, E-68, E-72, E-112.

## Mục tiêu

Nhân viên trả lời được câu hỏi cộng đồng từ admin web. Admin web quản lý sự kiện cộng đồng như Mini. Chủ thưởng/phạt và tính lại lương không cần kỹ thuật. Tab Chat CSKH dùng được ở 375px.

## Được sửa

- Web: `components/admin/community-moderation-tab.tsx`, `components/admin/payroll-admin-tab.tsx` (phần nút từng dòng), `components/admin/support-chat-tab.tsx`, `components/admin/support-chat/**`, spec cạnh.
- app-core: `api/payroll.ts`, `api/feed.ts` (chỉ thêm hàm nếu thiếu), spec cạnh.

## KHÔNG sửa

- API: gói này không đổi API (mọi endpoint đã có: `community-feed.controller.ts:146-178`, `admin-payroll.controller.ts:52, 83`, `addComment`).
- `app/admin/page.tsx`, `lib/admin-client.ts` (admin-hopviec → admin-don). Nếu cần thêm tab mới vào `page.tsx`: KHÔNG; đặt "Sự kiện" là một view bên trong `community-moderation-tab.tsx`.
- `payroll-admin-tab.tsx` dòng 151 (ô tháng) do admin-don đổi sang `VnMonthInput`; gói này không đụng ô tháng.
- `support-chat/support-chat.service.ts` và màn chat khách (hotro).
- KHÔNG đổi công thức lương, giá ca.
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- admin-don sửa ô tháng trong `payroll-admin-tab.tsx` cùng đêm. Giữ khối sửa của gói này ở phần dòng nhân viên để gộp không xung đột.
- Hộp việc đã có khoá `communityReports` và `communityUnanswered` (`ops-inbox.service.ts:127-130`); phần "Báo cáo (n)" của R-75 đã xong, chỉ còn Sự kiện.

## Mục việc

### E-27 (P2) "Câu hỏi chưa ai trả lời" dẫn vào ngõ cụt (VANHANH-05)
- Bằng chứng: `components/admin/community-moderation-tab.tsx:391, 404-414` (chỉ dẫn "Trả lời trong ứng dụng"); Mini chỉ đọc `apps/miniapp/src/pages/post-detail.tsx:44-45, 366-391`; web có ô trả lời `apps/web/src/app/cong-dong/[id]/page.tsx:133-134`; `feed/community-unanswered.ts:22-27`.
- Sửa: `UnansweredRow` thêm ô trả lời ngay trong dòng, gọi `addComment(coreHttp, p.id, body)` (`@tubutree/app-core`), xong thì invalidate `QUERY_KEYS.unanswered` và `['admin-ops-inbox']`. Thêm link "Mở bài" tới `/cong-dong/${p.id}`. Sửa câu dẫn "Trả lời ngay tại đây hoặc mở bài trên web."
- Test: `community-moderation-tab.spec.tsx` (gửi trả lời gọi API rồi dòng biến mất; link đúng `href`).
- Xong khi: không còn câu dẫn sang Mini.

### E-68 (P3) Admin web không quản lý sự kiện cộng đồng (DODANG-07 = R-75 phần còn lại)
- Bằng chứng: Mini `pages/community-moderation.tsx:80-99`; web `components/admin/community-moderation-tab.tsx:29-33` (pending, reports, published, unanswered); API `feed/community-feed.controller.ts:146-178`; hàm có sẵn `packages/app-core/src/api/feed.ts:252-270`.
- Sửa: thêm view `events`: danh sách từ `/feed/admin/events`, nút Đóng, nút Chọn người thắng (chọn bài dự thi), form Tạo sự kiện (các trường như Mini). Dùng hàm app-core có sẵn. Chọn người thắng hiện kết quả `rewarded` nếu API trả (gói diem đổi API trả `{ ok, rewarded }`; xử lý được cả khi chưa có).
- Test: spec tab (có nút "Sự kiện"; bấm Đóng gọi đúng hàm; tạo sự kiện gửi đúng body).
- Xong khi: tính năng như Mini.

### E-72 (P3) Không có màn thưởng/phạt lương và tính lại tháng (DODANG-12)
- Bằng chứng: `staff/payroll/admin-payroll.controller.ts:52` (recompute), `:83` (adjust); `payroll.service.ts:443`; không có trong `packages/app-core/src/api/payroll.ts`, `components/admin/payroll-admin-tab.tsx`.
- Sửa: `adjustPayroll` và `recomputePayroll` vào `api/payroll.ts` (đúng body theo DTO của controller). Mỗi dòng nhân viên thêm "Thưởng/phạt" (số tiền ±, lý do bắt buộc, hộp xác nhận nhắc số tiền) và "Tính lại tháng" (hộp xác nhận). Tháng đã chốt/khoá thì ẩn nút nếu API báo trạng thái đó.
- Test: spec tab (gọi đúng endpoint và body; thiếu lý do không gửi; huỷ hộp xác nhận không gọi).
- Xong khi: không có lời gọi nào khi người dùng chưa xác nhận.

### E-112 (P3) Tab Chat CSKH ở 375px: thẻ cầu nối chiếm màn, tin nằm dưới danh sách (R-150)
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/admin375/tab-supportChat__admin__admin375__s1.png`, `..._s2.png`.
- Sửa: ở khổ hẹp, thẻ "Cầu nối Zalo" thu thành một dòng trạng thái (bấm để mở chi tiết); bấm hội thoại mở ngăn kéo toàn màn chứa tin. Khổ máy tính giữ bố cục hai cột.
- Test: spec tab (khổ hẹp: bấm hội thoại mở ngăn kéo).
- Xong khi: so ảnh 375px.

## Kiểm riêng của gói
- Jest API không đổi (không đụng API); vẫn chạy gate đầy đủ.
- Playwright: web spec admin cộng đồng, lương, chat; Mini toàn bộ.

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
