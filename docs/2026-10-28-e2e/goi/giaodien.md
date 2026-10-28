# Gói giaodien: đánh bóng giao diện chung (thanh đáy, đăng nhập web, yêu thích, thẻ SP)

- Nhánh `review/e2e-giaodien`, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e-giaodien`. Luật chung: `docs/2026-10-28-e2e/tools/brief-worker.md`.
- money: KHÔNG. migration: KHÔNG. Chạy song song.
- Mục: E-92, E-93, E-94, E-95, E-98, E-101, E-107, E-115.

## Mục tiêu

Các chỗ lệch nhỏ giữa Mini và web 375 được sửa theo Mini. Mini mở trên khổ rộng không kéo dài. Thẻ SP có nhãn "Mới" đúng nghĩa.

## Được sửa

- Mini: `components/home/suggest-feed.tsx`, `components/bottom-nav.tsx`, `components/support-hotline.tsx`, `pages/wishlist.tsx`, `components/product-card.tsx`, `components/ui/product-tile.tsx`, `css/tokens.css`, `css/zaui-bridge.css`, spec cạnh.
- Web: `components/home/suggest-feed.tsx`, `components/bottom-nav.tsx`, `app/dang-nhap/**`, `app/tai-khoan/yeu-thich/**`, `components/product-card.tsx`, `components/support-hotline.tsx`, spec cạnh.
- app-core `api/catalog.ts` (chỉ thêm trường tuỳ chọn vào `ProductCard`) và hàm nhãn "Mới" (file mới, ví dụ `packages/app-core/src/product-badges.ts`).
- API `catalog/**`: chỉ phần dựng thẻ SP (thêm `createdAt` hoặc `isNew`).

## KHÔNG sửa

- Mini `components/app.tsx` (giohang): giới hạn 480px làm bằng CSS toàn cục, không sửa app.tsx.
- `apps/miniapp/src/i18n/vi.ts` (ctv): chữ mới đặt trong file của mình.
- `pages/product-detail.tsx`, web `san-pham/[slug]/**`, `add-to-cart.tsx` (muachung). Giỏ và thanh toán (giohang).
- `home-view.tsx`, `home-layout.ts`, Mini `pages/home.tsx` (canhan).
- Mọi file khác trong bản đồ cuối file thuộc gói khác.

## Chồng chéo

- muachung đổi trang SP web (R-98). Gói này chỉ đổi thẻ SP dùng chung ở danh sách.
- E-98 thêm nút giỏ nhanh: dùng tấm chọn phân loại có sẵn (Mini `components/variation-sheet` hoặc tương đương; web `components/variation-sheet.tsx`), không sửa tấm đó; nếu cần sửa thì ghi lại.

## Mục việc

### E-92 (P3) Khối "Gợi ý cho bạn" rỗng vẫn hiện tiêu đề và chip (R-92)
- Bằng chứng: ảnh `docs/2026-10-28-review/screens/mini375-empty/home__returning__mini375-empty__s1.png`; Mini và web `components/home/suggest-feed.tsx`.
- Sửa: danh sách rỗng (sau khi tải xong, không lỗi) thì ẩn cả khối ở hai nền. Đang tải vẫn giữ khung chờ.
- Test: spec suggest-feed hai nền (rỗng → không render tiêu đề).
- Xong khi: test xanh.

### E-93 (P3) Trang đăng nhập web: biểu tượng chung, không nói lợi ích, chờ chỉ là chữ (R-93)
- Bằng chứng: ảnh `screens/web375/dang-nhap__guest__web375__s1.png`; `apps/web/src/app/dang-nhap/**`.
- Sửa: dùng logo có sẵn (`apps/web/src/app/icon.png` hoặc component logo hiện có); thêm một dòng lợi ích lấy từ cấu hình công khai có sẵn (ví dụ quà khách mới) và không hiện nếu cấu hình rỗng; khung chờ dạng skeleton. Không viết số tiền cứng.
- Test: spec trang đăng nhập (có logo alt; skeleton khi đang tải).
- Xong khi: so ảnh 375px.

### E-94 (P3) Thanh đáy web: nhãn 12px, nhãn "Vườn Xanh" lệch (R-94)
- Bằng chứng: ảnh `screens/pairs/home.png`; web `components/bottom-nav.tsx` dùng `text-xs`, Mini dùng cỡ caption.
- Sửa: web dùng cỡ caption của token (như Mini); canh nhãn tab giữa cùng đường chân chữ.
- Test: `bottom-nav.spec.tsx` web (lớp cỡ chữ token).
- Xong khi: so ảnh 375px hai nền.

### E-95 (P3) Mini: bấm lại tab đang mở không làm gì (R-95)
- Bằng chứng: `apps/miniapp/src/components/bottom-nav.tsx:24-28` (`go()` trả về khi cùng đường).
- Sửa: cùng đường thì cuộn mượt về đầu trang (phần tử cuộn của trang, kiểm đúng phần tử trong zmp-ui). Web làm tương tự nếu hiện không có.
- Test: spec bottom-nav (cùng đường → gọi `scrollTo({ top: 0, behavior: 'smooth' })`, không `navigate`).
- Xong khi: test xanh.

### E-98 (P3) Yêu thích: thiếu nút thêm giỏ nhanh (R-100, phần còn lại)
- Bằng chứng: ảnh `screens/mini375/wishlist__returning__mini375__s1.png`, `screens/web375/wishlist__returning__web375__s1.png`. Mini đã có nhãn giảm giá và lớp hết hàng; web kiểm lại.
- Sửa: Mini và web thêm nút giỏ nhỏ trên thẻ yêu thích; SP một phân loại thì thêm thẳng, nhiều phân loại thì mở tấm chọn phân loại có sẵn; hết hàng thì ẩn nút. Web thêm nhãn "Hết hàng", "Đang giảm" nếu chưa có.
- Test: `wishlist.spec.tsx` (một phân loại → gọi thêm giỏ; nhiều → mở tấm; hết hàng → không nút); spec trang yêu thích web.
- Xong khi: nút ≥ 44px, có nhãn đọc màn hình.

### E-101 (P3) Mini ở khổ rộng không giới hạn chiều ngang (R-106)
- Quyết định thay chủ: giới hạn 480px, căn giữa.
- Bằng chứng: ảnh `screens/mini1280/product-slug__returning__mini1280__s1.png`, `screens/mini1280/profile__returning__mini1280__s1.png`.
- Sửa: CSS toàn cục Mini (`css/tokens.css` hoặc `css/zaui-bridge.css`): khung app `max-width: 480px; margin: 0 auto`; thanh đáy và nút dính đáy cũng giới hạn và căn giữa. Không sửa `app.tsx`.
- Test: spec CSS hiện có (`check-undefined-css-vars.spec.ts`) xanh; Playwright Mini ở 375 không đổi (so ảnh), ở 1280 khung 480px.
- Xong khi: ở 375px không lệch pixel nào đáng kể.

### E-107 (P3) "Cần hỗ trợ? Gọi …" xuống hai dòng, số tách khỏi câu (R-134)
- Bằng chứng: Mini `components/support-hotline.tsx` (`flexWrap: 'wrap'`); ảnh `screens/mini375-error500/recycle__returning__mini375-error500__s1.png`.
- Sửa: giữ "Gọi <số>" thành một khối không ngắt dòng (`white-space: nowrap` cho khối đó). Web giống vậy.
- Test: spec support-hotline (khối số có `nowrap`).
- Xong khi: so ảnh 375px.

### E-115 (P3) Nhãn "Mới" trên thẻ SP chưa đúng nghĩa (R-153)
- Quyết định thay chủ: "Mới" = SP tạo trong 30 ngày gần nhất.
- Bằng chứng: backlog cũ B-147; `packages/app-core/src/api/catalog.ts:10` (`ProductCard` chưa có `createdAt`/`isNew`).
- Sửa: API thêm `createdAt` (ISO) vào mọi nơi dựng thẻ SP (tìm chỗ map sang `ProductCard` trong `apps/api/src/modules/catalog/**` và các nơi khác trả thẻ SP; liệt kê trong báo cáo). app-core thêm `isNewProduct(createdAt, now)` (30 ngày). Thẻ SP hai nền dùng hàm này; thiếu `createdAt` thì không hiện nhãn. Không thêm truy vấn mới (chọn thêm cột trong select hiện có).
- Test: spec hàm (29 ngày → true, 31 ngày → false, thiếu → false); spec thẻ SP hai nền; spec API thẻ SP có `createdAt`.
- Xong khi: không có nhãn "Mới" nào dựa vào tiêu chí khác.

## Kiểm riêng của gói
- Playwright: Mini toàn bộ (đổi CSS toàn cục, thanh đáy); web cả bộ (thanh đáy, thẻ SP).
- Bundle: kiểm entry Mini không tăng.

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
