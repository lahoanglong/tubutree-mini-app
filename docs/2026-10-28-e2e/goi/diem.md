# Gói diem: Điểm Xanh, hạng, Vườn, quà

- Nhánh `review/e2e-diem`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-diem`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (điểm, mã giảm). Hai lượt review Opus. migration: KHÔNG. Chạy song song.
- Mục: E-16 (chỉ dòng `loyalty.service.ts:442`), E-17, E-18, E-20, E-35, E-74, E-102, E-103, E-104, E-117, E-119.

## Mục tiêu

Thưởng sự kiện không mất. Tưới cây không quét cả bảng mã. Lịch sử điểm xem được hết. Quà của tôi nói rõ mã còn dùng được không. Trang Hạng gọn. Số "còn thiếu để giữ hạng" khớp lượt hạ hạng.

## Được sửa

- API: `loyalty/loyalty.service.ts`, `loyalty/loyalty.controller.ts`, `checkout/checkout.service.ts`, `coupons/coupons.service.ts`, `game/game.service.ts`, `game/game-garden.service.ts`, `game/game.controller.ts`, `feed/community-feed.service.ts`, `feed/community-reward.service.ts`, `storefront/storefront.controller.ts` (chỉ `by-host`), `merchant/merchant.controller.ts`, `merchant/merchant.service.ts` (chỉ `customDomain`), `daily-check-in/**` (chỉ nếu cần cho E-74), spec cạnh.
- app-core `api/loyalty.ts` (+ spec), `loyalty-tier-copy.ts` nếu cần.
- Mini: `pages/loyalty.tsx`, `pages/rewards-mine.tsx`, `pages/external-points.tsx`, `components/game/garden-hero.tsx`, spec cạnh.
- Web: `app/tai-khoan/diem-xanh/**`, `app/kho-qua/cua-toi/**`, `components/game/garden-hero.tsx`, spec cạnh.

## KHÔNG sửa

- KHÔNG đổi luật điểm, số điểm, tỉ lệ, hạn mức, trần thu hoạch. Chỉ đổi cách đếm, cách hiện.
- `loyalty/loyalty-expiry.service.ts`, `loyalty/tier-drop-notice.service.ts` (api-tin). `game/game-quiz.service.ts` (admin-don). `storefront/storefront.service.ts` (admin-nhansu). `affiliate/**` (ctv).
- `home-layout.ts` (canhan), `pages/game.tsx`, web `vuon-xanh/page.tsx` (canhan). `apps/miniapp/src/i18n/vi.ts` (ctv).
- `apps/api/prisma/schema.prisma`: gói này không có migration (index `(userId)` của `points_transactions` đủ cho phân trang).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- api-tin thêm cron lệch sổ và đổi warn→error trong `loyalty-expiry.service.ts`; gói này chỉ đổi dòng `loyalty.service.ts:442`.
- canhan sửa `memberCardView` (dòng giữ hạng ở Trang chủ). Gói này sửa trang Hạng.
- DIEM-01 (khách vãng lai nhận điểm danh) là việc của chủ, KHÔNG làm.

## Mục việc

### E-16 (P2, phần của gói này) Lỗi từng khách ở cron xét hạng chỉ ghi warn (DIEM-02)
- Bằng chứng: `apps/api/src/modules/loyalty/loyalty.service.ts:442`; `common/cron-run/track-cron.ts` chỉ coi log error là ERRORS.
- Sửa: `logger.warn` → `logger.error` ở dòng đó (giữ nội dung log).
- Test: spec recalc: lỗi từng khách thì log error.
- Xong khi: test xanh.

### E-17 (P2) Chọn người thắng sự kiện: đóng trước, cộng điểm sau, lỗi thì mất thưởng (DIEM-03)
- Bằng chứng: `apps/api/src/modules/feed/community-feed.service.ts:1515-1540` (updateMany CLOSED 1515-1519; `rewarded = false` + warn 1521-1526; `return { ok: true }` 1535).
- Sửa: tính `expiresAt` trước; gói `updateMany` OPEN→CLOSED và `rewards.grant(..., tx, expiresAt)` trong một `$transaction` (`community-reward.service.ts` nhận `tx`). Cộng lỗi thì ném để rollback, sự kiện vẫn OPEN. Trả `{ ok: true, rewarded }`. Tin "trúng" gửi SAU commit.
- Test: `community-feed.service.spec.ts`: grant ném → sự kiện vẫn OPEN, không có tin; gọi lại thành công → CLOSED, có điểm, một tin. Race spec nếu có spec cộng đồng.
- Xong khi: số điểm thưởng không đổi.

### E-18 (P2) Đếm trần mã thu hoạch quét cả bảng `coupons` trong tx Serializable (DIEM-04)
- Bằng chứng: `game/game.service.ts:383-388, 476`; `game/game-garden.service.ts:214-222, 276`; index `apps/api/prisma/migrations/20261010040000_coupon_scope_partial_indexes/migration.sql`.
- Sửa: hàm chung `countHarvestCoupons(tx, userId, dayStart, monthStart)` dùng `tx.$queryRaw` dạng `SELECT count(*) FILTER (WHERE "startAt" >= $day) AS day, count(*) FILTER (WHERE "startAt" >= $month) AS month FROM coupons WHERE scope = 'USER_GROUP' AND ("scopeMeta"->>'userId') = $userId AND (code LIKE 'HARVEST%' OR code LIKE 'GARDEN%')`. Kiểm điều kiện khớp đúng điều kiện cũ (tiền tố mã, cột ngày). Dùng ở cả hai file. Ép kiểu bigint → number.
- Test: spec trần cũ xanh; race spec thêm `EXPLAIN` khẳng định có `coupons_user_group_userId_idx`.
- Xong khi: số đếm bằng cách cũ trên cùng dữ liệu (thêm ca so sánh).

### E-20 (P2) Lịch sử điểm chỉ 100 dòng, "Xem thêm" không tải thêm (DIEM-07, R-41)
- Bằng chứng: `loyalty/loyalty.service.ts:757-765` (`take: 100`); `loyalty/loyalty.controller.ts:20-23`; Mini `pages/loyalty.tsx:59, 87, 424, 452`; web `app/tai-khoan/diem-xanh/page.tsx:59, 84, 330, 344-346`.
- Sửa: `GET me/points/transactions` nhận tuỳ chọn `before` (ISO createdAt), `beforeId`, `limit` (mặc định 100 như cũ, tối đa 100). Không tham số thì trả như cũ (mảng). app-core thêm hàm trang. Mini và web dùng `useInfiniteQuery`, trang 20, "Xem thêm" tải tiếp. Sắp `(createdAt desc, id desc)`.
- Test: spec service: 3 trang không trùng, không sót, cùng createdAt ổn định; client cũ không tham số nhận 100 dòng.
- Xong khi: hai nền xem được dòng cũ hơn 100.

### E-35 (P3) Quà của tôi: mã giảm không có hạn dùng, không biết đã dùng chưa (DIEM-08)
- Bằng chứng: Mini `pages/rewards-mine.tsx:61-72` (`navigate('/loyalty')` dòng 70); web `app/kho-qua/cua-toi/page.tsx:61`; DTO `loyalty.service.ts:1804-1826`.
- Sửa: `toGiftRedemptionDTO` thêm `couponEndAt` và `couponUsed` (join `coupon.endAt`, có lượt dùng của user). Mini và web: dòng phụ "Mã X · HSD dd/mm" hoặc "Đã dùng" hoặc "Hết hạn". Còn hạn và chưa dùng thì bấm gọi hook dùng mã như nút "Dùng ngay" ở `rewards.tsx:189-215` (Mini `useCouponUse`; web hàm tương ứng); đã dùng/hết hạn thì không bấm.
- Test: spec DTO (3 trạng thái); spec trang hai nền.
- Xong khi: không thêm truy vấn N+1 (một truy vấn cho cả danh sách).

### E-74 (P3) Endpoint cũ không màn nào gọi (DODANG-14)
- Bằng chứng: `game/game.controller.ts:49` (`POST /game/check-in`); `loyalty/loyalty.controller.ts:69` (`GET /me/loyalty/check-in`); `storefront/storefront.controller.ts:103` (`GET /storefront/by-host`); `merchant/merchant.controller.ts:56`, `merchant.service.ts:483-491` (`customDomain`); `apps/web/src/middleware.ts:21-29` chỉ xử lý subdomain.
- Sửa: trước khi xoá, `rg` toàn repo VÀ kiểm bản Mini đang chạy (`git show 9d0e95bd5:apps/miniapp/src` bằng `git grep 9d0e95bd5 -- apps/miniapp`) không gọi hai endpoint check-in. Không ai gọi thì xoá `POST /game/check-in` (giữ `economy.checkIn` vì daily-check-in dùng) và `GET /me/loyalty/check-in`. `by-host`/`customDomain`: KHÔNG xoá, chỉ thêm comment "chưa dùng: web chỉ xử lý subdomain" (giữ cột DB).
- Test: jest API xanh; cập nhật spec controller liên quan.
- Xong khi: còn ai gọi thì giữ và ghi lý do.

### E-102 (P3) Vườn luôn ghi "Cây Dứa Fuwa3e" (R-121)
- Bằng chứng: `DEFAULT_TREE_TYPE = 'Cây Dứa Fuwa3e'` hiện ở `garden-hero` (hai nền); ảnh `docs/2026-10-28-review/screens/flows/mini/4-diem-xanh-hang-vuon-diem-danh/11-vuon-xanh-sau-khi-diem-danh-o-trang-chu.png`.
- Sửa: hiện loài đang trồng nếu dữ liệu vườn có; không có thì "Cây của bạn". Không đổi loài hay phần thưởng.
- Test: spec garden-hero hai nền (có loài / không loài).
- Xong khi: không còn hiện giá trị mặc định như tên thật.

### E-103 (P3) Trang Hạng dài, mã giảm hiện ở 3 chỗ (R-122)
- Quyết định thay chủ: bỏ khối mã trên trang Hạng, thay bằng một dòng "Ví mã (n) ›" tới Ưu đãi mục mã (Mini `/offers?section=coupons`, web `/uu-dai?section=coupons`). Không có mã thì dòng "Đổi quà ›" tới Kho quà.
- Bằng chứng: ảnh `screens/mini375/loyalty__returning__mini375__s1.png`, `s2`, `s3`; Mini `pages/loyalty.tsx`, web `app/tai-khoan/diem-xanh/page.tsx`.
- Sửa: như trên, hai nền giống nhau. Số `n` lấy từ query mã đang dùng sẵn (không thêm API).
- Test: spec trang Hạng hai nền (có mã → dòng "Ví mã (n)"; không mã → "Đổi quà").
- Xong khi: so ảnh 375px hai nền.

### E-104 (P3) Màn quét điểm: mã nhập hợp lệ vẫn là nút phụ (R-125)
- Bằng chứng: Mini `pages/external-points.tsx` (route `/points/scan`); ảnh `screens/mini375/points-scan__returning__mini375__s1.png`.
- Sửa: mã gõ tay hợp lệ thì nút gửi thành nút chính; thêm khoảng 12–16px trước tiêu đề danh sách.
- Test: `external-points.spec.tsx`: gõ mã hợp lệ thì nút có kiểu chính.
- Xong khi: test xanh.

### E-117 (P3) Xem trước mã chỉ xét 50 mã đầu theo id (R-155)
- Bằng chứng: `checkout/checkout.service.ts:955` (`couponPreviews`), `getAvailableCoupons` sắp theo id; `coupons/coupons.service.ts:192` cắt `COUPON_PREVIEW_LIMIT = 50`.
- Sửa: trước khi cắt, sắp mã riêng của khách (scope USER/USER_GROUP có userId) trước mã công khai, giữ thứ tự id trong mỗi nhóm. Không đổi luật mã.
- Test: spec: 60 mã công khai + 1 mã riêng id lớn → mã riêng nằm trong 50 mã xét.
- Xong khi: test xanh.

### E-119 (P3) Số "còn thiếu để giữ hạng" lệch khung với lượt hạ hạng (R-171)
- Bằng chứng: `loyalty/loyalty.service.ts:642-651` (`tierKeepGap`: `since = until − 12 tháng`); lượt hạ hạng 03:15 tính từ giờ chạy − 12 tháng; comment `:642-643` sai.
- Sửa: tính `since` từ lượt 03:15 (giờ VN) đầu tiên sau `until` trừ 12 tháng, cho khớp lượt hạ hạng. Sửa comment. Không đổi luật giữ hạng.
- Test: ca khoảng hở (đơn nằm giữa `until − 12 tháng` và lượt 03:15 − 12 tháng): số báo bằng số lượt hạ hạng dùng.
- Xong khi: test đỏ trước, xanh sau.

## Kiểm riêng của gói
- Race spec bắt buộc: spec có `loyalty`, `game`, `garden`, `harvest`, `coupon`, `community` trong `apps/api/test/integration-race/`.
- Playwright: Mini toàn bộ; web spec `/tai-khoan/diem-xanh`, `/kho-qua`, `/vuon-xanh`.

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
