# Kiểm kê web khách (apps/web/src/app, trừ admin)

Commit: 77bf4676 (nhánh main, chỉ đọc). Đường dẫn file tương đối với `apps/web/src/`. Cột "Đăng nhập" là gate thấy trong `page.tsx`; route-map `packages/app-core/src/route-map.json` ghi `private` riêng, ghi ở cột đó.

## 1. Bảng trang

| URL | File nguồn | Chức năng | Cần đăng nhập? | Điều kiện hiện (cờ / system_configs) | Lối vào |
|---|---|---|---|---|---|
| / | app/page.tsx | Trang chủ (banner, flash sale, lối tắt) | Không | — | Thanh đáy (lib/web-nav.ts:17), header logo (components/site-header.tsx:25) |
| /san-pham | app/san-pham/page.tsx | Danh mục sản phẩm, lọc, tìm kiếm (redirect ?query về BROWSE_PATH, page.tsx:54) | Không | — | Thanh đáy (lib/web-nav.ts:18), header (site-header), gio-hang/page.tsx:289 |
| /san-pham/[slug] | app/san-pham/[slug]/page.tsx | Chi tiết sản phẩm, mua, chọn biến thể | Không | — | components/product-card.tsx (href) và nhiều trang |
| /product/[slug] | app/product/[slug]/route.ts | Route handler 307 sang /san-pham/[slug], giữ ?ref= (route.ts:15-21) | Không | — | Chỉ link ngoài (Content Kit, chia sẻ của Mini App); không có href trong web |
| /vuon-xanh | app/vuon-xanh/page.tsx | Vườn Xanh (tab giữa thanh đáy) | Route-map private; trang import login-required | — | Thanh đáy giữa (lib/web-nav.ts:19), tai-khoan/diem-xanh/page.tsx:177 |
| /tu-van | app/tu-van/page.tsx | Trợ lý AI tư vấn sản phẩm | Có, khách thấy LoginRequired (tu-van/page.tsx:212) | aiAdvisorEnabled (tu-van/page.tsx:197, tắt thì aiOff) | Menu Cá nhân khi c.aiEnabled (components/account/account-menu.ts:48); components/home/home-extras.tsx:59 |
| /tai-khoan | app/tai-khoan/page.tsx | Trang Cá nhân (menu, mục theo cờ) | Có (LoginRequired) | chat.enabled (tai-khoan/page.tsx:84), aiAdvisorEnabled (:137), loyalty.marketplaceClaimEnabled (:138), CASHBACK_ENABLED (:140) | Thanh đáy (lib/web-nav.ts:21), header avatar (site-header.tsx:64) |
| /tai-khoan/ho-so | app/tai-khoan/ho-so/page.tsx | Sửa hồ sơ | Có (LoginRequired) | — | Trang Cá nhân (tai-khoan/page.tsx:167), cai-dat/page.tsx:152 |
| /tai-khoan/cai-dat | app/tai-khoan/cai-dat/page.tsx | Cài đặt (cỡ chữ, v.v.) | Có (LoginRequired) | — | Menu (account-menu.ts:79) |
| /tai-khoan/dia-chi | app/tai-khoan/dia-chi/page.tsx | Sổ địa chỉ | Có (LoginRequired) | — | Menu (account-menu.ts:50), thanh-toan/page.tsx:950 |
| /tai-khoan/yeu-thich | app/tai-khoan/yeu-thich/page.tsx | Sản phẩm yêu thích | Có (route-map private; LoginRequired) | — | Menu (account-menu.ts:49) |
| /tai-khoan/diem-xanh | app/tai-khoan/diem-xanh/page.tsx | Hạng thành viên và Điểm Xanh | Có (LoginRequired) | Trường card.posCreditEnabled (diem-xanh/page.tsx:471); chưa rõ cờ điều khiển | Menu (account-menu.ts:57), kho-qua/page.tsx:180 |
| /tai-khoan/vi-tubu | app/tai-khoan/vi-tubu/page.tsx | Ví Tubu (AFFILIATE/DEALER thấy mục riêng) | Có (LoginRequired) | Theo role AFFILIATE/DEALER (vi-tubu/page.tsx) | Menu (account-menu.ts:58), hoan-tien/page.tsx:137 |
| /tai-khoan/thong-bao | app/tai-khoan/thong-bao/page.tsx | Thông báo | Có (LoginRequired) | — | Menu (account-menu.ts:76), home-view.tsx:185 |
| /tai-khoan/don-hang | app/tai-khoan/don-hang/page.tsx | Danh sách đơn | Có (LoginRequired) | — | Thanh đáy (lib/web-nav.ts:20, có badge đơn đang xử lý), thanh-toan/page.tsx:364 |
| /tai-khoan/don-hang/[code] | app/tai-khoan/don-hang/[code]/page.tsx | Chi tiết một đơn | Có (LoginRequired) | — | don-hang/page.tsx:67, home/order-strip.tsx (href) |
| /gio-hang | app/gio-hang/page.tsx | Giỏ hàng | Có (LoginRequired; route-map private) | — | Header giỏ (components/site-header.tsx:47), phone-cart-button.tsx, add-to-cart.tsx |
| /thanh-toan | app/thanh-toan/page.tsx | Thanh toán (đặt đơn, mã giảm, nhận rác lấy quà) | Có (LoginRequired) | waste.pickup (thanh-toan/page.tsx:127) | gio-hang/page.tsx:461, add-to-cart.tsx:132 |
| /thanh-toan/chuyen-khoan/[code] | app/thanh-toan/chuyen-khoan/[code]/page.tsx | Thông tin chuyển khoản một đơn | Có (LoginRequired) | — | Sau đặt đơn (lib/order-view.ts:198), ctv-order-sheet.tsx:250 |
| /hoan-tien | app/hoan-tien/page.tsx | Hoàn tiền sàn ngoài | Khách thấy LoginRequired khi guest (hoan-tien/page.tsx:120); route-map public | CASHBACK_ENABLED=false (packages/app-core/src/features.ts:10): menu ẩn (account-menu.ts:68), bị loại khỏi sitemap (app/sitemap.ts:30). Trang vẫn tồn tại; chưa rõ có chặn theo cờ không | Không có lối vào đang hiện |
| /ho-tro/chat | app/ho-tro/chat/page.tsx | Chat CSKH | Có (LoginRequired) | chat.enabled (menu account-menu.ts:78) | san-pham/[slug]/pdp-extras.tsx:332, tai-khoan/page.tsx:246 |
| /cau-chuyen | app/cau-chuyen/page.tsx | Câu chuyện thương hiệu | Không | — | Menu (account-menu.ts:77), home-extras.tsx:105 |
| /gioi-thieu | app/gioi-thieu/page.tsx | Giới thiệu, hỗ trợ | Không | — | Menu (account-menu.ts:80) |
| /chinh-sach/[loai] | app/chinh-sach/[loai]/page.tsx | Chính sách (notFound nếu loại sai) | Không | — | Footer (components/site-footer.tsx:93, :114), dang-nhap/page.tsx:68 |
| /dang-nhap | app/dang-nhap/page.tsx | Đăng nhập | Không | — | Header khi khách (components/site-header.tsx:76), coupon-claim-gate.tsx:106 |
| /dang-nhap/callback | app/dang-nhap/callback/page.tsx | Nhận về sau OAuth | Không | — | Không có link trong web (đích redirect của OAuth) |
| /brand/[slug] | app/brand/[slug]/page.tsx | Trang nhãn hàng (notFound nếu không có) | Không | — | components/catalog/browse-view.tsx:244, view-brand-link.tsx:13 |
| /mua-chung | app/mua-chung/page.tsx | Danh sách mua chung nhóm | Không | — | Menu (account-menu.ts:46), san-pham/[slug]/pdp-extras.tsx:248 |
| /mua-chung/[id] | app/mua-chung/[id]/page.tsx | Chi tiết một nhóm mua chung | Không | — | mua-chung/group-buy-view.tsx:40 |
| /cong-dong | app/cong-dong/page.tsx | Cộng đồng (feed) | Không | — | Menu (account-menu.ts:51), thanh vuon-xanh/page.tsx:45 |
| /cong-dong/[id] | app/cong-dong/[id]/page.tsx | Chi tiết bài viết, bình luận, báo cáo | Một phần: LoginRequired trong page.tsx; route-map private | — | cong-dong/feed-view.tsx:91 |
| /cong-dong/su-kien | app/cong-dong/su-kien/page.tsx | Sự kiện cộng đồng | Có (LoginRequired; route-map private) | — | cong-dong/feed-view.tsx:187 |
| /cong-dong/xep-hang | app/cong-dong/xep-hang/page.tsx | Bảng xếp hạng cộng đồng | Có (LoginRequired; route-map private) | — | cong-dong/feed-view.tsx:182 |
| /hoc-vien | app/hoc-vien/page.tsx | Danh sách khoá học | Có (AcademyAuthGate, course-list.tsx:101; route-map private) | isWebRouteReady('/hoc-vien') (ctv/page.tsx:449) | ctv/page.tsx:449 (chỉ khi route sẵn sàng); không có trong menu |
| /hoc-vien/[courseId] | app/hoc-vien/[courseId]/page.tsx | Chi tiết khoá học | Có (AcademyAuthGate, course-detail.tsx:119) | — | hoc-vien/course-list.tsx:25 |
| /ctv | app/ctv/page.tsx | Đăng ký và trang cộng tác viên (registerAffiliate, ctv/page.tsx:152) | Có (LoginRequired; route-map private) | — | Menu (account-menu.ts:67), tai-khoan/vi-tubu/page.tsx:197, hoc-vien/course-list.tsx:61 |
| /ctv/gian-hang | app/ctv/gian-hang/page.tsx | Dựng và quản lý gian hàng CTV (StorefrontBuilder, TemplateSheet) | Có (phase authenticated, ctv/gian-hang/page.tsx:37; route-map private) | — | ctv/page.tsx:368, components/affiliate/storefront-owner.tsx:73 |
| /dai-ly | app/dai-ly/page.tsx | Kênh đại lý, đăng ký đại lý (applyDealer) | Có (LoginRequired; route-map private) | — | Menu (account-menu.ts:37, :39, :40), brand/[slug]/brand-actions.tsx:276 |
| /merchant | app/merchant/page.tsx | Cổng gian hàng đối tác (MERCHANT): store, sản phẩm, đơn | Có (role CUSTOMER/ADMIN, useAuth; không trong route-map) | subdomainEnabled (merchant/page.tsx:296, :481) | Không thấy link trong web (chỉ gõ trực tiếp hoặc từ kênh khác) |
| /nhan-vien | app/nhan-vien/page.tsx | Ca làm và chấm công (STAFF/ADMIN) | Có (role STAFF/ADMIN theo header comment; route-map private) | — | Menu (account-menu.ts:89) |
| /nhan-vien/bang-luong | app/nhan-vien/bang-luong/page.tsx | Lương của tôi | Có (route-map private) | — | Menu (account-menu.ts:90) |
| /chu-thuong-hieu | app/chu-thuong-hieu/page.tsx | Quản lý nhãn hàng của chủ nhãn | Route-map private; page.tsx không có LoginRequired | — | Menu khi c.ownedBrandName (account-menu.ts:70), brand-owner/brand-owner-hub.tsx:86 |
| /doi-rac | app/doi-rac/page.tsx | Trung tâm đổi rác lấy quà | Route-map private; page.tsx không có LoginRequired | — | Menu (account-menu.ts:47), tai-khoan/don-hang/[code]/order-extras.tsx:43, diem-xanh/page.tsx:178 |
| /doi-rac/quy-dinh | app/doi-rac/quy-dinh/page.tsx | Thể lệ đổi rác | Không (route-map public) | — | components/recycle/recycle-home.tsx:264 |
| /doi-rac/tao | app/doi-rac/tao/page.tsx | Tạo yêu cầu đổi rác | Route-map private | — | recycle-home.tsx, thanh-toan/page.tsx:137 |
| /doi-rac/diem-nhan | app/doi-rac/diem-nhan/page.tsx | Chọn điểm nhận rác | Route-map private | — | recycle-new.tsx:335, recycle-edit.tsx:148 |
| /doi-rac/quay | app/doi-rac/quay/page.tsx | Quầy đổi rác | Route-map private | — | recycle-desk.tsx:40, recycle-home.tsx:159 |
| /doi-rac/yeu-cau | app/doi-rac/yeu-cau/page.tsx | Danh sách yêu cầu đổi rác | Route-map private | — | recycle-home.tsx, order-extras.tsx:43 |
| /doi-rac/yeu-cau/[id] | app/doi-rac/yeu-cau/[id]/page.tsx | Chi tiết yêu cầu | Route-map private | — | recycle-home.tsx (href yeu-cau/${id}) |
| /doi-rac/yeu-cau/[id]/sua | app/doi-rac/yeu-cau/[id]/sua/page.tsx | Sửa yêu cầu | Route-map private | — | recycle-request.tsx:122, recycle-edit.tsx:62 (editPath) |
| /doi-rac/xong/[id] | app/doi-rac/xong/[id]/page.tsx | Kết quả sau khi tạo yêu cầu | Route-map private | — | recycle-request.tsx:369, recycle-requests.tsx:97 |
| /kho-qua | app/kho-qua/page.tsx | Kho quà | Có (LoginRequired) | — | diem-xanh/page.tsx:179, cua-toi/page.tsx:64 |
| /kho-qua/cua-toi | app/kho-qua/cua-toi/page.tsx | Quà của tôi | Có (LoginRequired) | — | kho-qua/page.tsx:190, :235 |
| /s/[slug] | app/s/[slug]/page.tsx | Trang gian hàng công khai (xem mục 3) | Không (API lọc theo trạng thái) | Storefront visibility (mục 3); subdomainEnabled chỉ đổi cách hiện link (s/[slug]/page.tsx:161) | middleware.ts:28 (rewrite từ subdomain `/`), storefront-builder.tsx (href /s/${sf.slug}), merchant/page.tsx:314 |

## 2. Bố cục theo khổ màn hình

Các file khung (đã đọc):
- `app/layout.tsx:28-56`: body `flex min-h-screen flex-col`; SiteHeader (:43), SiteFooter (:49), BackButton `md:!hidden` (:52), BottomNav (:53).
- `components/site-header.tsx:22`: `hidden md:block` (đầu trang, sticky). Có nav ngang `hidden ... md:flex` (:36) và các tab từ `readyNavTabs()`.
- `components/bottom-nav.tsx:41`: `md:hidden`, 5 mục (lib/web-nav.ts:16-22); chỉ hiện ở 5 route gốc (bottom-nav.tsx: `if (!isRoot) return null`).
- `components/site-footer.tsx:46`: footer đầy đủ `hidden md:block`; :105 footer gọn `md:hidden`.
- `app/s/[slug]/page.tsx:80`: `max-md:pb-[calc(90px+var(--safe-bottom))]` chừa chỗ cho thanh đáy.
- Không thấy breakpoint `lg:` hay `xl:` trong các file khung đã đọc.

Theo khổ (theo mã):
- 375 px (dưới md): thanh đầu ẩn; thanh đáy 5 mục hiện (bottom-nav.tsx:41); footer gọn (site-footer.tsx:105); nút Back hiện (layout.tsx:52). Lưới sản phẩm `grid-cols-2` (components/catalog/browse-view.tsx:266; app/s/[slug]/page.tsx:225, :261).
- 768 px (md, từ 768): header ngang hiện (site-header.tsx:22); thanh đáy ẩn; footer đầy đủ (site-footer.tsx:46); lưới `md:grid-cols-4` (browse-view.tsx:266, s/[slug]/page.tsx:261), dù `sm:grid-cols-3` (browse-view.tsx:266) áp dụng từ 640 px.
- 1280 px: cùng bố cục md (không có override lg/xl trong các file khung); khung nội dung giới hạn `max-w-5xl` (s/[slug]/page.tsx:80) hoặc `max-w-6xl` (site-footer.tsx:47).

## 3. Gian hàng /s/[slug]

### Trang hiện gì
- `app/s/[slug]/page.tsx:49` StorefrontPage, `revalidate = 300` (:26). Dữ liệu `getStorefront(slug)` (lib/api.ts:214) gọi `GET /storefront/public/:slug` (storefront.controller.ts:102). Không có dữ liệu thì `notFound()` (page.tsx:56).
- Hiển thị: ảnh bìa (:85-103); avatar, tên, tick "Đã được Tubu Tree duyệt" khi `badgeLabel` có (:133-138); địa chỉ kho và SĐT chỉ khi `isPartnerStore(sf)` (:65-73); bộ sưu tập và sản phẩm (:75-77).
- Cờ hiện subdomain: `sf.subdomainEnabled && sf.subdomain` (page.tsx:161).

### Bảng gian hàng được tạo bằng cách nào
- Model: `Storefront` (apps/api/prisma/schema.prisma:623). `type StorefrontType { CTV BRAND MERCHANT }` (:1462-1466). `Brand` (:486) có storefront qua `brandId` (:636).
- Trường trạng thái: `isPublished` (:645), `approvedAt` (admin duyệt, CTV), `takenDownAt` (admin gỡ), `isPartner`, `ordersPausedAt`.
- `DealerApplication` (:1893) là đơn xin làm đại lý, không tạo gian hàng.

### Có form đăng ký gian hàng cho khách không?
Không có form "mở gian hàng" ở khách. Luồng theo mã là đăng ký CTV, rồi tự mở gian hàng CTV, hoặc đại lý.

### Luồng từng bước (theo mã)
1. Đăng ký CTV: `app/ctv/page.tsx:152` gọi `registerAffiliate` → `POST /affiliate/register` (apps/api/src/modules/affiliate/affiliate.controller.ts:77) → `affiliate.service.ts:121-127`: chỉ role CUSTOMER hoặc AFFILIATE (`affiliate-access.ts:4-6`) được đổi thành AFFILIATE.
2. Mở gian hàng CTV: `app/ctv/gian-hang/page.tsx:37` đọc `myStorefrontQuery`. Chọn mẫu hoặc để trống qua `TemplateSheet` (`components/affiliate/storefront-sheets.tsx:44-57`) → `createStorefront` = `POST /storefront` (`storefront.controller.ts:79`) → `storefront.service.ts:67-80`: role AFFILIATE hoặc ADMIN tạo mới; DEALER chỉ lấy gian hàng CTV cũ; tạo `type: 'CTV'`, ràng buộc `ownerUserId` duy nhất (schema.prisma:~655, dòng chưa kiểm chính xác).
3. Dựng và thêm sản phẩm: `PATCH /storefront/me` (storefront.controller.ts:81), `POST /storefront/me/collections` (:84), `POST /storefront/me/collections/:id/items` (:90). Web: components/affiliate/storefront-builder.tsx.
4. Đăng (bật hiển thị): `POST /storefront/me/publish` (storefront.controller.ts:82) → `storefront.service.ts:200-212` → `assertCanPublish` (`storefront-publish.ts:16-23`): phải có ít nhất 1 sản phẩm và không bị gỡ. Web: storefront-builder.tsx:112 → `publishStorefront` (packages/app-core/src/api/storefront.ts:136-137).
5. Duyệt CTV (admin): `POST /admin/storefronts/:id/approval` (apps/api/src/modules/storefront/storefront-admin.controller.ts:55) → `storefront-admin.service.ts:166-178` (`setApproved`): chỉ type CTV được duyệt, ghi `approvedAt`. Gỡ/đăng lại: `POST /admin/storefronts/:id/take-down` (controller:43) và `/reinstate` (:49). Trang quản trị: `components/admin/storefronts-tab.tsx` (trong `app/admin/page.tsx:108`, ngoài phạm vi).
6. Đại lý được mở gian hàng MERCHANT: web `app/dai-ly/page.tsx` → `applyDealer` (packages/app-core/src/api/dealer.ts:57-58) → `POST /dealer/apply` (apps/api/src/modules/dealer/dealer.controller.ts:44). Admin duyệt: `POST /admin/dealer-applications/:id/review` (admin.controller.ts:429). Gian hàng: `getOrCreateStore` (apps/api/src/modules/merchant/merchant.service.ts:316); trong transaction, vai trò DEALER tạo `type: 'MERCHANT', isPartner: true` (merchant.service.ts:352-384, dòng gần đúng); `isPublished: false`. Web: `app/merchant/page.tsx`, API `GET/PUT /merchant/store` (merchant.controller.ts:202, :210), `POST /merchant/store/publish` (:215).
7. Khách xem: `GET /storefront/public/:slug` → `getPublicBySlug` (storefront.service.ts:249-263) lọc theo `publicStorefrontWhere` (`storefront-visibility.ts:31-38`):
   - `isPublished: true`, `takenDownAt: null`;
   - chủ không bị khoá (`isBlocked`);
   - gian hàng CTV chỉ khi chủ có role trong `affiliate.commission_eligible_roles` (mặc định AFFILIATE, DEALER: `commission-eligibility.ts:8-9`) hoặc ADMIN;
   - nếu `storefront.require_approval` bật (mặc định true: `storefront-config.ts:7-8`, `:20-22`) thì gian hàng CTV phải có `approvedAt`; gian hàng MERCHANT và `isPartner` không cần.
8. Subdomain: `middleware.ts:22-34` đọc subdomain (`lib/tenant-subdomain.ts`), rewrite `/` → `/s/<subdomain>`. Middleware không đọc cờ `storefront.subdomain_enabled` (mặc định false: `storefront-config.ts:14-15`); cờ này chỉ dùng trong API để tắt subdomain trong phản hồi (storefront-config.ts:28-29).

### Trang không có lối vào (từ mã)
- `/dang-nhap/callback`: không có link trong web (đích OAuth).
- `/hoan-tien`: menu ẩn vì `CASHBACK_ENABLED=false` (features.ts:10; account-menu.ts:68).
- `/merchant`: không thấy link trong web (grep href/push/route không có).
- `/product/[slug]`: chỉ link ngoài từ Content Kit và chia sẻ của Mini App; không có href trong web.
- Không kiểm trong phạm vi: `app/robots.ts`, `app/sitemap.ts`, `opengraph-image`, `icon` (không phải page/route nên không nằm trong bảng).
