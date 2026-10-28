# Gói doirac: Đổi rác lấy quà (khách và quầy)

- Nhánh `review/e2e-doirac`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-doirac`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG (không đổi cách cộng điểm). migration: CÓ (chỉ migration chèn một mẫu tin `WASTE_REQUEST_EXPIRING`, KHÔNG đổi `schema.prisma`). Chạy song song.
- Gói này giữ `apps/api/prisma/seed.ts` và `apps/api/src/modules/notifications/notification-variables.ts`: chỉ gói này được sửa hai file đó.
- Mục: E-22, E-37, E-38, E-40, E-41, E-42, E-127.
- Cờ `waste.enabled` đang TẮT trên PROD; không bật.

## Mục tiêu

Khách được nhắc trước khi yêu cầu hết hạn. Khách MAIL_IN không bị dọa "hết hạn" khi đã gửi kiện. Số dư sau khi đổi là số mới. Quầy tra lại được yêu cầu vừa duyệt của đồng nghiệp. Quầy web quét được mã.

## Được sửa

- API: `waste-exchange/**`, `apps/api/prisma/seed.ts`, `notifications/notification-variables.ts`, thư mục migration mới `apps/api/prisma/migrations/20261029HHMMSS_waste_request_expiring_template/`.
- Mini: `pages/recycle-request.tsx`, `pages/recycle-done.tsx`, `pages/recycle-desk.tsx`, `utils/waste-labels.ts`, spec cạnh.
- Web: `components/recycle/**`.
- app-core: file mới cho dòng thời gian đổi rác (ví dụ `packages/app-core/src/waste-timeline.ts`) + spec; `packages/shared-types/src/waste.ts` nếu cần thêm trường.

## KHÔNG sửa

- `apps/api/prisma/schema.prisma` (admin-hopviec → admin-nhansu).
- KHÔNG đổi thể lệ, số điểm, trần, hạn giữ chỗ. Chữ thông báo không hứa điều gì mới.
- Mini `pages/recycle.tsx`, `hooks/use-recycle-login.ts`, `components/waste-phone-needed.tsx` (phien). `pages/profile.tsx`, web `account-menu.ts` (canhan làm lối vào quầy).
- `apps/miniapp/src/i18n/vi.ts` (ctv).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- canhan thêm hàng "Nhận hàng tại điểm" ở Cá nhân/menu, gọi `getDeskPoints()` có sẵn. Không đổi dạng trả về của `GET /waste/desk/points`.
- Gói khác cần mẫu tin mới thì ghi vào báo cáo của họ; đợt này chỉ gói này thêm mẫu.

## Mục việc

### E-22 (P2) Không nhắc trước hạn; MAIL_IN đã gửi kiện bị báo "hết hạn" (DOIRAC-03)
- Quyết định thay chủ: chữ MAIL_IN không hứa gì; chỉ hướng khách nhắn CSKH kèm mã vận đơn.
- Bằng chứng: `waste-exchange/pickup/waste-expiry.cron.ts:39, 91`; `core/waste-notifier.service.ts:21` (`WASTE_EXPIRED_DETAIL_TEXT` nằm trong mã); `customer/waste-requests.service.ts:107`; `receiving/waste-receive.service.ts:28, 148, 342`; mẫu `nt-waste-request-expired` ở `apps/api/prisma/seed.ts` khoảng dòng 918.
- Sửa:
  - Nhắc: trong `waste-expiry.cron.ts`, cùng giờ chạy, chọn yêu cầu OPEN (DROP_OFF, và MAIL_IN chưa có mã vận đơn) có `expiresAt` trong 24–48 giờ tới; gửi mẫu mới `WASTE_REQUEST_EXPIRING` (INAPP, TRANSACTIONAL, đích `/recycle/r/:id`), `dedupeKey` theo request id.
  - Mẫu: thêm vào `seed.ts` cạnh `nt-waste-request-expired` (createOnly như các mẫu khác) và migration `INSERT ... ON CONFLICT DO NOTHING` (theo cách các migration mẫu tin trước đã làm; tìm bằng `rg -l "INSERT INTO \"notification_templates\"" apps/api/prisma/migrations`). Thêm biến ở `notification-variables.ts`. Cập nhật `waste-exchange/waste-notify.codes.spec.ts` (spec này đọc `seed.ts`).
  - Hết hạn MAIL_IN: trong `waste-notifier.service.ts`, chữ riêng cho MAIL_IN, ví dụ "Yêu cầu đã hết hạn giữ chỗ. Nếu bạn đã gửi kiện, hãy nhắn CSKH kèm mã vận đơn để được hỗ trợ." (không hứa mở lại, không hứa điểm).
  - Đích của tin trên web đi qua route-map có sẵn (`/recycle/r/:id`); không sửa `route-map.json` (dondep giữ).
- Test: `waste-expiry.cron.spec.ts`: yêu cầu hết hạn sau 30 giờ → đúng 1 tin; chạy lần hai không gửi lại; MAIL_IN đã có vận đơn → không nhắc. Ca chữ MAIL_IN. `waste-notify.codes.spec.ts` xanh.
- Xong khi: migration chạy được trên DB sạch và DB đã có mẫu (không lỗi trùng).

### E-37 (P3) "Số dư mới" ở màn Đổi xong là số cũ (DOIRAC-01)
- Bằng chứng: Mini `pages/recycle-request.tsx:155, 158-162`, `pages/recycle-done.tsx:34-35, 79-80`, `services/query-client.ts:50` (tươi 10 giây); web `components/recycle/recycle-request.tsx:141-146`, `recycle-done.tsx:41-42, 85`.
- Sửa: Mini `recycle-request.tsx` effect 158-162: khi `liveStatus` rời OPEN, gọi `invalidateAfterWasteWrite(qc)` và invalidate `WASTE_QUERY_KEYS.rewards` trước `navigate`. Web dùng `WASTE_REDEEM_INVALIDATE_KEYS` từ app-core. `recycle-done.tsx` (hai nền): `refetchOnMount: 'always'` cho meQ và rewardsQ; chỉ hiện dòng số dư khi `meQ.isFetchedAfterMount`.
- Test: `recycle-request.spec.tsx` (hai nền): OPEN→COMPLETED gọi invalidate với `['waste']`. `recycle-done.spec.tsx`: cache cũ thì không hiện "Số dư mới" tới khi gọi lại xong.
- Xong khi: test xanh.

### E-38 (P3) Quầy tra mã yêu cầu đồng nghiệp vừa duyệt ra "Không tìm thấy" (DOIRAC-02, CHỈ phần b)
- Quyết định thay chủ: chỉ làm phần (b) cho nhân viên cùng điểm. Phần (a) (hiện quà đã trao/đã huỷ ở quầy) chờ chủ, KHÔNG làm.
- Bằng chứng: `waste-exchange/receiving/waste-desk.service.ts:50-58` (ghi LOOKUP_MISS rồi 404), `:134-142` (chỉ người duyệt xem được); cảnh báo `catalog/waste-alerts.ts:77-85, 182-183`.
- Sửa: `findRequest` cho mọi nhân viên của CÙNG điểm xem yêu cầu COMPLETED/REJECTED đóng trong `WASTE_DESK_RECENT_MS`, dạng chỉ đọc (không nút duyệt), không ghi LOOKUP_MISS. Giữ che SĐT. Client hai nền thêm chữ cho yêu cầu đã đóng ("Đã duyệt lúc HH:mm" / "Đã từ chối").
- Test: `receiving/waste-desk.service.spec.ts`: yêu cầu COMPLETED do người khác cùng điểm duyệt 1 giờ trước → trả chỉ đọc, không LOOKUP_MISS; khác điểm → vẫn 404; quá `WASTE_DESK_RECENT_MS` → 404.
- Xong khi: không lộ dữ liệu cho nhân viên điểm khác.

### E-40 (P3) PICKUP đã RECEIVED vẫn tô bước "Chờ kho nhận" (DOIRAC-05)
- Bằng chứng: Mini `utils/waste-labels.ts:38, 120, 185-186`; web `components/recycle/recycle-labels.ts:52, 165`; PICKUP lên RECEIVED ở `receiving/waste-receive.service.ts:119, 157-160`.
- Sửa: nhãn bước 3 PICKUP "Kho nhận, đếm"; RECEIVED trả `current: 3`. Chuyển `TIMELINE_STEPS` và `timelineFor` vào app-core, hai nền dùng chung.
- Test: spec app-core `timelineFor` cho PICKUP OPEN (có/không đơn), IN_TRANSIT, RECEIVED.
- Xong khi: hai bản chép cũ bị xoá.

### E-41 (P3) Quầy báo "Tubu sẽ cộng 0 điểm" (DOIRAC-06)
- Bằng chứng: Mini `pages/recycle-desk.tsx:251, 340`; web `components/recycle/recycle-desk.tsx:359`.
- Sửa: `pointsAwarded === 0` thì tiêu đề và snackbar "Đã ghi nhận. Lần này chưa đủ để cộng điểm".
- Test: `recycle-desk.spec.tsx` hai nền với `pointsAwarded: 0`.
- Xong khi: test xanh.

### E-42 (P3) Quầy web không quét được mã; thứ tự thẻ và màu nút khác Mini (DOIRAC-08 + R-135)
- Bằng chứng: `apps/web/src/components/recycle/recycle-desk.tsx` (không có quét; Mini có ở `pages/recycle-desk.tsx:19, 212`); ảnh `docs/2026-10-28-review/screens/web375/recycle-desk__staff__web375__s1.png` so `screens/mini375/recycle-desk__staff__mini375__s1.png`.
- Sửa: nút "Quét mã của khách" dùng `BarcodeDetector` + `getUserMedia` của trình duyệt (không thêm thư viện); máy không hỗ trợ thì ẩn nút, giữ ô gõ. Đưa thẻ hạn mức lên trước như Mini. Nút "Từ chối cả yêu cầu" dùng màu cảnh báo.
- Test: spec web: có `BarcodeDetector` giả thì kết quả điền vào ô và gọi tra mã; không có thì không hiện nút.
- Xong khi: so ảnh 375px.

### E-127 (P3) Quầy điểm đối tác mặc định "đã nhận" cả món chỉ kho HCMC nhận (DOIRAC-07)
- Vấn đề: ở điểm PARTNER, quầy điền sẵn số khách khai cho mọi dòng, kể cả món `warehouseOnly` (hộp sữa, vỏ chai Tubu). Bấm duyệt mới nhận 409 `PARTNER_NOT_ACCEPTED`, không biết dòng nào sai. Xảy ra khi admin bật `warehouseOnly` sau khi khách đã tạo yêu cầu.
- Bằng chứng: `waste-exchange/receiving/waste-confirm.service.ts:69, 130-133`; quầy chỉ lấy `hazardous` của món (`receiving/waste-desk.service.ts:128, 156`); lọc lúc đăng ký `core/waste-hold.service.ts:245-255`.
- Sửa: thêm `warehouseOnly` vào dòng của DTO quầy (`packages/shared-types/src/waste.ts` và `waste-desk.service.ts`). Hai màn quầy: điểm PARTNER thì đặt mặc định 0 cho dòng đó và ghi "Chỉ kho HCMC nhận, trả lại khách". Không đổi luật nhận.
- Test: `receiving/waste-desk.service.spec.ts` (dòng có `warehouseOnly`); `recycle-desk.spec.tsx` hai nền (điểm PARTNER → mặc định 0 và có câu).
- Xong khi: duyệt ở điểm PARTNER với yêu cầu như trên không còn 409.

## Kiểm riêng của gói
- Race spec bắt buộc: spec có `waste` trong `apps/api/test/integration-race/`.
- Chạy migration mới trên cụm race (race-one.sh dựng DB từ migration).
- Playwright: Mini toàn bộ; web spec `/doi-rac`.

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
