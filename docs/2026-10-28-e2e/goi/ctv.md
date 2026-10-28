# Gói ctv: CTV, gian hàng, hoa hồng, nhãn hàng, đại lý (giao diện)

- Nhánh `review/e2e-ctv`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-ctv`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: CÓ (hoa hồng, Ví, thưởng nhiệm vụ). Hai lượt review Opus. migration: KHÔNG. Chạy song song.
- Gói này giữ `apps/miniapp/src/i18n/vi.ts`: chỉ gói này được sửa file đó.
- Mục: E-11 (API + trang CTV Mini), E-43, E-46, E-47, E-49, E-73, E-108, E-109, E-110, E-111.

## Mục tiêu

Khách vãng lai không thành CTV và tài khoản đã gộp không được ghi công. Kế toán biết khi đơn đã trả hoa hồng bị trả hàng. CTV xem được lịch sử cũ và sắp xếp gian hàng. Các màn CTV, nhãn hàng, đại lý trên web 375 giống Mini.

## Được sửa

- API: `affiliate/**`, `storefront/storefront-quest.service.ts`, spec cạnh.
- app-core: `api/affiliate.ts`, `api/storefront.ts`, spec cạnh. `packages/design-tokens/**`.
- Mini: `pages/affiliate.tsx`, `pages/storefront-builder.tsx`, `pages/brand-owner*.tsx`, `pages/dealer*.tsx`, `pages/dealer-pricing.ts`, `services/storefront-api.ts`, `services/affiliate-api.ts`, `css/dealer-theme.css`, `i18n/vi.ts`, spec cạnh.
- Web: `app/ctv/**`, `app/chu-thuong-hieu/**`, `app/dai-ly/**`, `app/s/**`, `components/brand-owner/**`, `components/dealer/**`, `components/affiliate/**`, spec cạnh.

## KHÔNG sửa

- KHÔNG đổi tỉ lệ hoa hồng, ngưỡng thuế, lịch tự chuyển vào Ví, điều kiện thưởng nhiệm vụ (trừ đúng phần E-47 dưới đây), và KHÔNG trừ Ví CTV.
- `common/notify-admins.ts` (thongbao), `apps/api/prisma/seed.ts` và `notification-variables.ts` (doirac): gói này KHÔNG thêm mẫu tin; dùng mẫu có sẵn.
- `storefront/storefront.service.ts`, `storefront-admin.*` (admin-nhansu), `storefront/storefront.controller.ts` (diem; gói này không cần sửa controller vì API sắp xếp đã có).
- `orders/**` (api-tin), `auth/**` và `store/auth.ts` (phien), `group-buy.tsx` (muachung), storefront-context và `components/app.tsx` (giohang).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- giohang sửa storefront-context và ô mã giới thiệu ở thanh toán. Gói này không sửa chúng.
- muachung làm nút Tham gia mua chung cho khách vãng lai (`group-buy.tsx`). Gói này làm cổng đăng ký CTV ở `affiliate.tsx` và phía API.
- phien giữ `ensurePhone()` trả `null` khi không liên kết được. Gói này gọi như `components/home/guest-link-card.tsx`.
- thongbao làm nút cho tin `COMMISSION_*`, `STOREFRONT_*`; nếu đổi chữ trong vi.ts liên quan thông báo thì báo trong báo cáo, không phải việc của gói này.
- Gói khác không được sửa `vi.ts`. Nếu gói khác cần khoá mới, họ dùng chữ trong file của họ.

## Mục việc

### E-11 (P2) Khách vãng lai đăng ký CTV được; tài khoản đã gộp vẫn được ghi công (CTV-03)
- Bằng chứng: `affiliate/affiliate.service.ts:130-136` (`register` chỉ xét vai trò), `:229-236`, `:240-243`; `affiliate/affiliate-access.ts:4-6`; `auth/auth.service.ts:409-412, 745-755` (gộp bỏ lại affiliate ở dòng khách); Mini `pages/affiliate.tsx:139` (RegisterGate không xét khách).
- Sửa: `register()` thêm `if (!isRealUser(user)) throw new BadRequestException(REAL_USER_REQUIRED_MSG)` (`apps/api/src/common/real-user.ts`). `findEligibleReferrer` và `isCommissionEligible` chọn thêm `mergedIntoId`, trả null/false khi khác null. Mini `RegisterGate`: `isGuestUser(user)` thì gọi `ensurePhone()` trước; trả null thì dừng.
- Test: `affiliate.service.spec.ts` (khách đăng ký → 400; mã của dòng đã gộp → null; tài khoản thật vẫn đăng ký được); spec `affiliate.tsx` Mini (khách bấm đăng ký gọi `ensurePhone`, không gọi API khi null).
- Xong khi: không đổi luật ai thắng ghi công với tài khoản thật. Ghi vào báo cáo: chủ cần đếm (chỉ đọc) CTV là tài khoản khách trên PROD trước khi deploy.

### E-43 (P3) Đơn đã trả hoa hồng bị trả/hoàn: không ai biết (CTV-02, phần cảnh báo)
- Quyết định thay chủ: CHỈ cảnh báo kế toán. KHÔNG trừ Ví, không đổi hoa hồng. Cách thu hồi chờ chủ.
- Bằng chứng: `affiliate/affiliate.service.ts:1103-1120` (`reverseCommissionsForOrder` chỉ đụng PENDING/LOCKED); `orders/order-transition.ts:35-37`; `orders/order-status.service.ts:502-505`; `orders/order-reversal.service.ts:497-500`.
- Sửa: cuối `reverseCommissionsForOrder`, đọc hoa hồng của đơn có `status IN (APPROVED, PAID)`. Có thì `logger.warn` và gọi `notifyAdmins` (`apps/api/src/common/notify-admins.ts`) với mẫu có sẵn `OPS_REFUND_ALERT` (`'💸 Hoàn tiền đơn {{order_code}}: {{message}}'`), `message` ví dụ "hoa hồng CTV <tên/mã> <số tiền> đã <trạng thái>, cần kế toán xử lý". Chặn gửi lặp bằng `dedupeKey` theo `order.id` (đọc cách `notifyAdmins` nhận dedupe; nếu không có thì kiểm log gửi trước đó).
- Test: `affiliate.service.spec.ts`: đơn có hoa hồng PAID bị trả → `notifyAdmins` một lần, hoa hồng và Ví không đổi; gọi lần hai không gửi lại; chỉ PENDING thì không gửi.
- Xong khi: không có dòng sổ Ví mới.

### E-46 (P3) Lịch sử hoa hồng chỉ 100 dòng, lệnh chuyển chỉ 50 dòng (CTV-08, phần phân trang)
- Quyết định thay chủ: GIỮ lịch tự chuyển mỗi giờ và cách gửi tin như cũ; chỉ thêm phân trang.
- Bằng chứng: `affiliate/affiliate.service.ts:403-408, 423-427` (take cố định).
- Sửa: `GET /affiliate/commissions` và `/affiliate/payouts` nhận con trỏ theo `CursorPageQuery` như `listLinks`. Không tham số thì trả như cũ (giữ dạng trả về cũ cho client cũ; nếu buộc đổi dạng thì thêm endpoint `/page` mới). Mini `affiliate.tsx` và web `app/ctv/**` thêm "Tải thêm".
- Test: spec service phân trang ổn định; spec trang hai nền bấm "Tải thêm".
- Xong khi: client cũ không vỡ.

### E-47 (P3) Nhiệm vụ "Đơn hàng đầu tiên" đếm cả hoa hồng đã huỷ (CTV-09, phần REJECTED)
- Quyết định thay chủ: chỉ loại hoa hồng REJECTED. Phần "chỉ đơn đã giao / không tính đơn lên hộ / chỉ đơn qua gian hàng" chờ chủ, KHÔNG làm.
- Bằng chứng: `storefront/storefront-quest.service.ts:61-67, 92`.
- Sửa: `firstOrderCount` thêm `status: { not: 'REJECTED' }`.
- Test: `storefront-quest.service.spec.ts`: chỉ có hoa hồng REJECTED thì nhiệm vụ chưa xong.
- Xong khi: test xanh.

### E-49 (P3) Sự kiện `referral_touched` luôn ghi `platform: 'miniapp'` (CTV-10 phần b)
- Bằng chứng: `affiliate/affiliate.service.ts:206-215` (`recordTouch`, khoảng dòng 183).
- Sửa: controller đọc header `X-Client-Platform` (web gửi `web`, Mini gửi `miniapp`, đã có sẵn) và truyền xuống `recordTouch`; chỉ nhận `web`/`miniapp`, khác thì `miniapp`. Không cần đổi client.
- Test: `affiliate.service.spec.ts` hoặc spec controller: header `web` → sự kiện `platform: 'web'`.
- Xong khi: test xanh.

### E-73 (P3) Trình dựng gian hàng không sắp xếp được (DODANG-13)
- Bằng chứng: API có sẵn `storefront/storefront.controller.ts:88, 93`, `storefront.service.ts:583, 689`; client không gọi.
- Sửa: thêm `reorderCollections` và `reorderItems` vào `packages/app-core/src/api/storefront.ts`. Mini `storefront-builder.tsx` và web `app/ctv/gian-hang/**`: nút lên/xuống mỗi dòng (nút có nhãn, ≥ 44px), gọi API với `orderedIds` mới, cập nhật lạc quan và hoàn lại khi lỗi.
- Test: spec trình dựng hai nền: bấm "lên" gửi thứ tự đúng; lỗi thì về thứ tự cũ.
- Xong khi: hai nền giống nhau.

### E-108 (P3) Trình dựng gian hàng: nút khó hiểu, thao tác nguy hiểm nổi bật (R-136)
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/mini375/storefront__ctv__mini375__s1.png`, `__s3.png`, `screens/web375/storefront__ctv__web375__s3.png`; chữ ở `vi.storefront` (`apps/miniapp/src/i18n/vi.ts`).
- Sửa: "Nội dung" → "Bài đăng mẫu"; "+1.000 điểm" → nút "Nhận 1.000 điểm" (giữ đúng số và luật nhận hiện có); "Gỡ đăng" chuyển vào khu Cài đặt; ghim/ẩn/xoá gom vào menu "⋯" có chữ; Hành trình gian hàng lên đầu khi chưa xong 5/5. Hai nền.
- Test: spec trình dựng hai nền (nhãn mới; menu ⋯ có ba mục; thứ tự Hành trình).
- Xong khi: so ảnh 375px.

### E-109 (P3) Trang nhãn hàng web 375 tràn cột, ô ngày không nhãn, "Nhắn Tubu" sai đích (R-138)
- Bằng chứng: ảnh `screens/web375/brand-owner__brand__web375__s1.png`, `__s2.png`; 'Nhắn Tubu' rơi về `/gioi-thieu` khi chat tắt.
- Sửa: lưới `minmax(0,1fr)` ở khổ hẹp; nhãn trên mỗi ô ngày khuyến mãi; khi chat tắt đổi nút thành "Liên hệ Tubu" (dẫn tới trang hỗ trợ có sẵn, không mở ngoài ở Mini).
- Test: spec trang nhãn hàng web (nhãn ô ngày; nút khi chat tắt).
- Xong khi: không tràn ngang ở 375px.

### E-110 (P3) Lệch nhỏ CTV/gian hàng/đại lý giữa web 375 và Mini (R-140)
- Bằng chứng: ảnh `screens/mini375/affiliate__ctv__mini375__s3.png` so `screens/web375/affiliate__ctv__web375__s3.png`; `screens/pairs/storefront.png`; `screens/mini375/s-slug__guest__mini375__s1.png` so `screens/web375/s-slug__guest__web375__s1.png`.
- Sửa: chọn kiểu Mini cho: trạng thái rỗng (có hình hay không), kiểu chữ mã giới thiệu, chấm đầu dòng, khung chờ CTV (hero, 4 ô, 2 thẻ, cả hai nền), nút thêm SP, màu chip "Tân binh", ô CCCD, nút dính đáy bước 1.
- Test: spec component chạm tới; so ảnh 375px.
- Xong khi: liệt kê trong báo cáo mục nào đã khớp, mục nào để lại và vì sao.

### E-111 (P3) Màu kênh đại lý viết hex ngoài design-tokens (R-143)
- Bằng chứng: đã có token riêng trong `apps/miniapp/src/css/dealer-theme.css` và bản web, nhưng chưa nằm trong `packages/design-tokens`; web 375 lộ dải nền be ở chân trang (`screens/web375/dealer__returning__web375__s2.png`).
- Sửa: đưa bảng màu đại lý thành theme `dealer` trong `packages/design-tokens`; hai file dealer-theme dùng token đó. Sửa nền chân trang web trang đại lý. Không đổi màu thấy được (trừ dải be).
- Test: spec contrast/undefined-css-vars có sẵn xanh (`apps/miniapp/src/css/*.spec.ts`).
- Xong khi: không còn hex đại lý ngoài design-tokens.

## Kiểm riêng của gói
- Race spec bắt buộc: spec có `affiliate`, `commission`, `storefront`, `referral` trong `apps/api/test/integration-race/`.
- Playwright: Mini toàn bộ; web spec `/ctv`, `/s/`, `/dai-ly`, `/chu-thuong-hieu`.

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
