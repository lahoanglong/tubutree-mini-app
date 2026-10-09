# A4 — Audit UI/UX Tubu Tree (Mini App + Web)

| | |
|---|---|
| Ngày | 2026-10-09 |
| Commit | `080bc75` (nhánh `hardening/2026-10`) |
| Phạm vi | Zalo Mini App (`apps/miniapp`, 40 file trang, 42 route) và Web Next.js (`apps/web`, 12 file `page.tsx`, 36 màn chụp gồm 19 tab admin + 5 tab merchant). Chỉ đọc + đo; không sửa mã nguồn ứng dụng. |
| Phương pháp | (1) Liệt kê route từ `app.tsx` + `app/**/page.tsx`. (2) Playwright (1 Chromium, 1 context) chụp từng route ở 390x844 và 1440x900 cho các trạng thái normal / empty / loading / error / long; mọi `/api/*` bị chặn bởi mock (`scripts/uiux/lib/api-router.mjs`), chỉ GET catalog/config đọc từ API local :3001. (3) Đo trên từng ảnh: `boundingBox` mọi phần tử tương tác (<44px), cỡ chữ (<12px), tràn ngang, h1, axe-core 4.12 (WCAG 2.x A/AA). (4) Quét tĩnh (`static-scan.mjs`) + `eslint src --format json`. (5) Đếm bước từ mã nguồn. |
| Giới hạn chính | 3 trang Mini App (`/loyalty`, `/brand/:slug`, `/s/:slug`) không chụp được vì Vite dev của chủ máy trả 504 "Outdated Optimize Dep" cho `qrcode` (không được phép khởi động lại Vite) — chấm theo mã. Dữ liệu và ảnh sản phẩm là mock/giữ chỗ nên không đánh giá được độ đẹp ảnh thật. Điểm thứ bậc/CTA/copy/premium là chấm tay (sai số ±1). Danh sách đầy đủ ở mục 9. |
| Cách chạy lại | `node scripts/uiux/capture.mjs miniapp` / `web` (có `--only regex --vp 390 --states normal --force`), `node scripts/uiux/static-scan.mjs`, `node scripts/uiux/scorecard.mjs miniapp|web`, `node scripts/uiux/build-report-data.mjs coverage|metrics|axe|states|contrast <app>` |

## 0. Tóm tắt điều hành

- Mini App (kênh bán chính) đã có luồng mua hàng chín muồi: Home → PDP → Checkout dùng DS v2 sạch (0 alias legacy trên `home`, `browse`, `product-detail`, `cart`, `checkout`, `orders`, `order-detail`), CTA rõ ("Mua ngay · 260.000đ", "Đặt hàng · 798.000đ"), trạng thái trống có minh hoạ + nút hành động (`cart`, `checkout`, `not-found`). Điểm trung bình 41 trang: **3,5/5**.
- DS v2 mới migrate xong khoảng 1/4 số trang: **30/40 trang còn dùng alias legacy v1** (tổng 1.616 lần dùng, đầu bảng `game` 163, `loyalty` 150, `affiliate` 129, `dealer` 121, `storefront-builder` 88); 40/40 trang vẫn trộn ZaUI (`Page` ×40, `Box` ×58, `Text` ×56, `Button` ×42); ESLint báo **105 lỗi** (76 `tubu-ds/no-raw-color` ở 19 file, 29 `no-restricted-imports` ở 29 file trang).
- **Web chưa dùng palette v2**: 0 lớp DS v2, 227 lần dùng palette v1 (cam `#E08C1C` + lá + xanh Tailwind mặc định), 17 hex, 0 lần dùng Fraunces. Cùng một thương hiệu hai diện mạo: Mini App xanh rừng/be, Web cam/lá. Điểm trung bình 36 màn web: **2,5/5**.
- **Một nguyên nhân gốc cho phần lớn lỗi tương phản của Mini App**: token `--color-text-disabled` = `--stone-400` = `#9E978A` (2,89:1 trên trắng, 2,63:1 trên nền `#F6F4EF`) đang dùng cho chữ có nghĩa ("★ Mới", mô tả, nhãn phụ). 29/41 trang dính (131 nút axe). Web: chữ `#A8A8A0` (2,39:1) ×62 nút, chữ trắng trên nút cam `#E08C1C` (2,64:1) ×16 — **CTA chính của web không đạt 4,5:1**.
- Chủ nhãn (brand owner) **không có màn xem đơn/doanh thu** (API chỉ có `owner/me` + khuyến mãi): luồng thứ 5 không thực hiện được.
- Số chạm theo mã: khách mới đặt đơn đầu từ Home ≈ 12 chạm (3 màn); khách cũ qua "Mua lại" ở Home 5 chạm (qua PDP "Mua ngay" 3); CTV lên đơn hộ ≈ 13 chạm; admin duyệt đơn Chờ → Đang vận chuyển ≈ 4 chạm; brand owner không có đường.
- 40 phát hiện: 0 P0, 9 P1, 19 P2, 12 P3 (mục 7); 7 quyết định cần chủ dự án (mục 8).


## 1. Bảng route

Nguồn: `apps/miniapp/src/components/app.tsx:188-232` (react-router, `AnimationRoutes`) và `apps/web/src/app/**/page.tsx` (Next App Router; `find` cho ra 12 file `page.tsx`). Cột "Lối vào" là đường đi người dùng thật; cột "DS v2" = trạng thái migrate (trang "sạch" = 0 lần dùng alias legacy v1, đo bằng `scripts/uiux/static-scan.mjs`).

### 1.1 Zalo Mini App (42 route = 40 file trang + `/academy/:courseId` dùng chung file + 1 redirect)

| # | Route | File | Vai trò / điều kiện | Lối vào | DS v2 |
|---|---|---|---|---|---|
| 1 | `/` | pages/home.tsx | mọi người (khách mới / mua lại có bố cục khác) | tab "Trang chủ" | sạch (còn `Page` ZaUI) |
| 2 | `/browse` (+`?q=`) | pages/browse.tsx | mọi người | tab "Danh mục", ô tìm kiếm Home | sạch |
| 3 | `/product/:slug` | pages/product-detail.tsx | mọi người | thẻ sản phẩm | sạch (còn `Box`,`Text`,`Page`) |
| 4 | `/cart` | pages/cart.tsx | đăng nhập | icon giỏ ở header | sạch (còn `Box`,`Text`,`Page`) |
| 5 | `/checkout` | pages/checkout.tsx | đăng nhập | "Thanh toán" ở giỏ / "Mua ngay" | sạch (còn `Box`,`Text`,`Input`) |
| 6 | `/bank-payment/:code` | pages/bank-payment.tsx | đăng nhập | sau đặt đơn chuyển khoản | sạch (còn `Box`,`Text`) |
| 7 | `/orders` (+`?tab=`) | pages/orders.tsx | đăng nhập | tab "Đơn hàng" | sạch |
| 8 | `/order/:code` | pages/order-detail.tsx | đăng nhập | dòng đơn / thông báo | sạch (còn `Box`,`Text`, 2 `Sheet` ZaUI) |
| 9 | `/game` | pages/game.tsx | đăng nhập | tab "Vườn Xanh" (giữa) | CHƯA — 163 alias legacy |
| 10 | `/feed` | pages/feed.tsx | đăng nhập | Cá nhân → Cộng đồng hỏi đáp; khối "Cộng đồng Vườn Tubu" ở Home | CHƯA — 34 |
| 11 | `/feed/leaderboard` | pages/community-leaderboard.tsx | đăng nhập | nút cúp ở `/feed` | CHƯA — 15 |
| 12 | `/feed/events` | pages/community-events.tsx | đăng nhập | nút sự kiện ở `/feed` | CHƯA — 26 |
| 13 | `/feed/:id` | pages/post-detail.tsx | đăng nhập | thẻ bài viết | CHƯA — 60 |
| 14 | `/ai-advisor` | pages/ai-advisor.tsx | đăng nhập | Cá nhân → Trợ lý AI 24/7; khối ở Home | CHƯA — 34 |
| 15 | `/group-buy` | pages/group-buy.tsx | đăng nhập | Cá nhân → Mua chung nhóm; khối ở Home; PDP | CHƯA — 16 |
| 16 | `/refill` | pages/refill.tsx | đăng nhập | Cá nhân → Trạm Refill & Đổi vỏ | CHƯA — 37 |
| 17 | `/beta` | pages/beta.tsx | đăng nhập | Cá nhân → Cài đặt → "Beta Tester" | CHƯA — 23 |
| 18 | `/profile` | pages/profile.tsx | đăng nhập | tab "Cá nhân" | CHƯA — 43 |
| 19 | `/loyalty` | pages/loyalty.tsx | đăng nhập | Cá nhân → Hạng thành viên & Điểm Xanh; ô điểm ở đầu trang Cá nhân | CHƯA — 150 |
| 20 | `/wallet` | pages/wallet.tsx | đăng nhập | Cá nhân → Ví | CHƯA — 62 |
| 21 | `/addresses` | pages/addresses.tsx | đăng nhập | Cá nhân | CHƯA — 13 |
| 22 | `/notifications` | pages/notifications.tsx | đăng nhập | chuông ở header | CHƯA — 21 |
| 23 | `/affiliate` | pages/affiliate.tsx | CTV (`AFFILIATE`) | Cá nhân → Cộng tác viên | CHƯA — 129 |
| 24 | `/academy`, `/academy/:courseId` | pages/academy.tsx | CTV | Affiliate | CHƯA — 23 |
| 25 | `/cashback` | pages/cashback.tsx | đăng nhập | Cá nhân | CHƯA — 26 |
| 26 | `/dealer` | pages/dealer.tsx | đại lý / đăng ký đại lý | Cá nhân → Kênh đại lý | CHƯA — 121 (+ `--dealer-*` giữ hex v1) |
| 27 | `/about` | pages/about.tsx | mọi người | Cá nhân | CHƯA — 29 |
| 28 | `/wishlist` | pages/wishlist.tsx | đăng nhập | tim ở thẻ / Cá nhân | CHƯA (1) — dùng `components/product-card.tsx` cũ |
| 29 | `/edit-profile` | pages/edit-profile.tsx | đăng nhập | Cá nhân | CHƯA — 1 |
| 30 | `/settings` | pages/settings.tsx | đăng nhập | Cá nhân | CHƯA — 23 |
| 31 | `/brand-story` | pages/brand-story.tsx | mọi người | Home "Thương hiệu Việt / Hành trình nguyên liệu" | CHƯA — 15 alias + 107 hex/rgb |
| 32 | `/storefront` | pages/storefront-builder.tsx | CTV | Cá nhân → Gian hàng của tôi | CHƯA — 88 |
| 33 | `/s/:slug` | pages/storefront-view.tsx | mọi người (link CTV chia sẻ) | link ngoài | sạch |
| 34 | `/brand/:slug` | pages/brand-view.tsx | mọi người | chip thương hiệu | sạch |
| 35 | `/brand-owner` | pages/brand-owner.tsx | chủ nhãn (`Brand.ownerUserId`) | Cá nhân → Quản lý nhãn hàng | CHƯA — 23 |
| 36 | `/admin` | pages/admin.tsx | ADMIN (nhân sự: phân quyền/duyệt ca/lương) | Cá nhân → Quản trị nhân sự | CHƯA — 32 |
| 37 | `/admin/community` | pages/community-moderation.tsx | ADMIN | Admin | CHƯA — 23 |
| 38 | `/staff` | pages/staff.tsx | STAFF | Cá nhân → Ca làm & chấm công | CHƯA — 41 |
| 39 | `/my-payroll` | pages/my-payroll.tsx | STAFF | Staff | CHƯA — 17 |
| 40 | `/subscriptions` | (redirect → `/orders?tab=subscriptions`) | — | — | — |
| 41 | `*` | pages/not-found.tsx | — | URL lạ | CHƯA — 4 |

(Số trong cột DS v2 = số lần dùng alias legacy v1 trong file trang, theo scripts/uiux/static-scan.mjs.)

(Không trang riêng: Onboarding là lớp phủ `components/onboarding.tsx`; chi tiết thông báo là overlay trong `/notifications`.)

### 1.2 Web (Next.js, `apps/web`)

| # | Route | File | Vai trò | Ghi chú |
|---|---|---|---|---|
| 1 | `/` | app/page.tsx | mọi người | trang chủ web, SSR (gọi API ở server) |
| 2 | `/san-pham/[slug]` | app/san-pham/[slug]/page.tsx | mọi người | SSR |
| 3 | `/gio-hang` | app/gio-hang/page.tsx | đăng nhập | client |
| 4 | `/thanh-toan` | app/thanh-toan/page.tsx | đăng nhập | client |
| 5 | `/tai-khoan` | app/tai-khoan/page.tsx | đăng nhập | client |
| 6 | `/dang-nhap`, `/dang-nhap/callback` | app/dang-nhap/** | khách | OAuth Zalo (PKCE) |
| 7 | `/s/[slug]` | app/s/[slug]/page.tsx | mọi người | gian hàng CTV/đại lý (cũng qua subdomain rewrite ở `middleware.ts`) |
| 8 | `/brand/[slug]` | app/brand/[slug]/page.tsx | mọi người | SSR |
| 9 | `/merchant` | app/merchant/page.tsx | DEALER / AFFILIATE / ADMIN | 5 tab trong trang (state, không có URL): Gian hàng & Subdomain, Tài khoản VietQR, Kho hàng & Giao nhận, Quản lý sản phẩm, Đơn hàng thuộc kho |
| 10 | `/admin` (+`?tab=`) | app/admin/page.tsx (2.714 dòng) | ADMIN | 19 tab: dashboard, dealers, dealerClaims, payouts, orders, returns, cashback, posCredits, users, config, coupons, brands, merchantProducts, flashSales, faqs, contentKit, academy, quickReplies, analytics |
| 11 | `/admin/pos` | app/admin/pos/page.tsx | ADMIN (thu ngân) | màn tích điểm tại quầy |
| — | không có route riêng cho **nhãn hàng**, **nhân sự**, **CTV** trên web | — | — | CTV dùng `/merchant`; nhãn hàng + nhân sự chỉ có trong Mini App (`/brand-owner`, `/staff`, `/admin`) |


## 2. Ma trận chụp và quan sát theo trạng thái

Ảnh nằm ở `docs/2026-10-review/screens/<miniapp|web>/<route-id>__<state>__<390|1440>.png`. Ô ghi viewport đã chụp (390, 1440, hoặc 390+1440); "–" = không áp dụng cho route đó (chỉ chụp trạng thái có ý nghĩa). Mini App ở 1440 chỉ để kiểm tra bố cục khung điện thoại trên desktop (Zalo không chạy ở cỡ này). Web admin/merchant ở 390 chỉ chụp trạng thái `normal`.

Kết quả: **Mini App 368 ảnh / 41 route-id (0 lỗi chụp)**, **Web 186 ảnh / 36 route-id (0 lỗi chụp)**. Ngoài ra 3 route Mini App (`loyalty`, `brand-view`, `storefront-view`) không chụp được (xem mục 9).

### 2.1 Mini App

| route | path | persona | normal | empty | loading | error | long |
|---|---|---|---|---|---|---|---|
| home | `/` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| home-new-customer | `/` | customer-new | 1440+390 | 1440+390 | – | – | – |
| browse | `/browse` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| browse-search | `/browse?q=nuoc` | customer | 1440+390 | 1440+390 | – | – | – |
| product-detail | `/product/mat-ong-rung-bhnong` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| cart | `/cart` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| checkout | `/checkout` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| bank-payment | `/bank-payment/TUBU26100901` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| orders | `/orders` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| orders-subscriptions | `/orders?tab=subscriptions` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| order-detail | `/order/TUBU26100901` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| game | `/game` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| feed | `/feed` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| feed-leaderboard | `/feed/leaderboard` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| feed-events | `/feed/events` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| post-detail | `/feed/post-1` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| ai-advisor | `/ai-advisor` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| group-buy | `/group-buy` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| refill | `/refill` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| beta | `/beta` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| profile | `/profile` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| wallet | `/wallet` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| addresses | `/addresses` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| notifications | `/notifications` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| affiliate | `/affiliate` | ctv | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| academy | `/academy` | ctv | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| academy-course | `/academy/course-1` | ctv | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| cashback | `/cashback` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| dealer | `/dealer` | dealer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| about | `/about` | customer | 1440+390 | – | – | – | – |
| wishlist | `/wishlist` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| edit-profile | `/edit-profile` | customer | 1440+390 | – | – | 1440+390 | – |
| settings | `/settings` | customer | 1440+390 | – | – | – | – |
| brand-story | `/brand-story` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| storefront-builder | `/storefront` | ctv | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| brand-owner | `/brand-owner` | dealer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| admin | `/admin` | admin | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| admin-community | `/admin/community` | admin | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| my-payroll | `/my-payroll` | staff | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| not-found | `/khong-ton-tai` | customer | 1440+390 | – | – | – | – |
| staff | `/staff` | staff | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |

Tổng 368 ảnh, 41 route-id.

### 2.2 Web

| route | path | persona | normal | empty | loading | error | long |
|---|---|---|---|---|---|---|---|
| home | `/` | customer | 1440+390 | – | – | – | – |
| san-pham | `/san-pham/mat-ong-rung-bhnong` | customer | 1440+390 | – | – | – | – |
| gio-hang | `/gio-hang` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| thanh-toan | `/thanh-toan` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| tai-khoan | `/tai-khoan` | customer | 1440+390 | 1440+390 | 1440+390 | 1440+390 | 1440+390 |
| dang-nhap | `/dang-nhap` | guest | 1440+390 | – | – | – | – |
| dang-nhap-callback | `/dang-nhap/callback?code=x&state=y` | guest | 1440+390 | – | – | – | – |
| storefront | `/s/tubu-demo` | customer | 1440+390 | – | – | – | – |
| brand | `/brand/bh-nong` | customer | 1440+390 | – | – | – | – |
| admin-pos | `/admin/pos` | admin | 1440+390 | 1440+390 | – | 1440+390 | – |
| merchant-denied | `/merchant` | customer | 1440+390 | – | – | – | – |
| admin-dashboard | `/admin?tab=dashboard` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-dealers | `/admin?tab=dealers` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-dealerClaims | `/admin?tab=dealerClaims` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-payouts | `/admin?tab=payouts` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-orders | `/admin?tab=orders` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-returns | `/admin?tab=returns` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-cashback | `/admin?tab=cashback` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-posCredits | `/admin?tab=posCredits` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-users | `/admin?tab=users` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-config | `/admin?tab=config` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-coupons | `/admin?tab=coupons` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-brands | `/admin?tab=brands` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-merchantProducts | `/admin?tab=merchantProducts` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-flashSales | `/admin?tab=flashSales` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-faqs | `/admin?tab=faqs` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-contentKit | `/admin?tab=contentKit` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-academy | `/admin?tab=academy` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-quickReplies | `/admin?tab=quickReplies` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| admin-analytics | `/admin?tab=analytics` | admin | 1440+390 | 1440 | 1440 | 1440 | 1440 |
| merchant-1 | `/merchant` | dealer | 1440+390 | 1440 | – | 1440 | – |
| merchant-2 | `/merchant` | dealer | 1440+390 | 1440 | – | 1440 | – |
| merchant-3 | `/merchant` | dealer | 1440+390 | 1440 | – | 1440 | – |
| merchant-4 | `/merchant` | dealer | 1440+390 | 1440 | – | 1440 | – |
| merchant-5 | `/merchant` | dealer | 1440+390 | 1440 | – | 1440 | – |
| merchant-ctv | `/merchant` | ctv | 1440+390 | – | – | – | – |

Tổng 186 ảnh, 36 route-id.

### 2.3 Quan sát theo trạng thái (đã xem ảnh)

| Trạng thái | Quan sát | Bằng chứng |
|---|---|---|
| empty | Tốt ở giỏ/checkout: minh hoạ + câu "Giỏ còn trống đấy" + nút "Khám phá ngay". Danh sách thông báo/ví/đơn hàng trống hiển thị câu chữ nhưng không phải trang nào cũng có nút hành động. | `cart__empty__390.png`, `checkout__empty__390.png` |
| loading | 33/40 file trang dùng `Skeleton` (grep `Skeleton` trong `pages/*.tsx`); 7 file không dùng: `about`, `ai-advisor`, `brand-story`, `home` (khối con có thể có skeleton riêng), `not-found`, `profile`, `settings` — trong đó `profile` và `ai-advisor` dùng `Spinner` ZaUI. Ảnh loading chụp lúc API bị giữ nên chỉ phản ánh khung chờ đầu. | `scripts/uiux/results/miniapp.jsonl` (state=loading) |
| error | `home` khi catalog lỗi: các khối "Mua lại", "Ưu đãi giờ vàng", "Dành cho bạn", "Bán chạy" biến mất im lặng, trang trông như Home rất thưa — không có thông báo lỗi, không nút thử lại (A4-017). `profile`/`edit-profile`/`ai-advisor`/`brand-story` ở trạng thái error vẫn hiển thị khung như bình thường (dữ liệu hồ sơ lấy từ store đăng nhập nên chấp nhận được; `ai-advisor`: hành vi khi gửi tin lỗi chưa kiểm chứng). Web admin hiện thông báo lỗi đỏ rõ ("Không tải được danh sách đơn hàng: Máy chủ đang bận, vui lòng thử lại sau.") nhưng không có nút thử lại. | `home__error__390.png`, `ai-advisor__error__390.png`, `web/admin-orders__error__1440.png` |
| long | Các trang dài nhất: `game` (≥12 khối, cắt ở 3.200px khi chụp), `storefront-builder`, `affiliate`, `home` (cuộn lâu mới tới "Danh mục"). Trang `game` không có điều hướng nội bộ (mục lục/neo) giữa các khối. | `game__normal__390.png`, `home__normal__390.png` |

Lưu ý công cụ: cờ "KHÔNG có thông báo lỗi" của `build-report-data.mjs states` chỉ nhìn 500 ký tự đầu của `bodyText`, nên cho dương tính giả với web admin; kết luận trong bảng trên đã đối chiếu bằng ảnh.


## 3. Bảng chấm điểm (1–5)

Thang điểm và nguồn:

| Tiêu chí | Nguồn | Quy tắc |
|---|---|---|
| Token DS v2 | tự động, `static-scan.mjs` trên file trang | 5 = 0 alias legacy và 0 màu thô; 4 = ≤15 alias hoặc ≤4 màu thô; 3 = 16–40; 2 = 41–100 hoặc ≥5 màu thô; 1 = >100 alias hoặc >50 hex. Web = 1 (0 lớp DS v2). |
| Thứ bậc thị giác, CTA, copy tiếng Việt, "premium" | **chấm tay** từ ảnh 390px (sai số ±1) | Thứ bậc: tiêu đề/nhóm/nhấn rõ; CTA: một hành động chính rõ nhãn + vị trí; copy: tự nhiên, nhất quán thuật ngữ, có dấu; premium: cảm giác "xanh tự nhiên cao cấp" (Fraunces + be/rừng, khoảng thở, không lẫn palette). |
| Tap ≥44px | tự động, `boundingBox` ở 390 (với web: ở 390) | 5 = 0 phần tử nhỏ; 4 = ≤10% hoặc ≤2; 3 = ≤25%; 2 = ≤50%; 1 = >50%. |
| Contrast | tự động, axe `color-contrast` (số nút vi phạm) | 5 = 0; 4 = 1–2; 3 = 3–5; 2 = 6–9; 1 = ≥10. |

Điểm TB = trung bình các cột có số. Cột "ảnh" dẫn tới ảnh `normal` 390px.

**Điểm mù của chỉ số tap**: đo bằng `boundingBox` của phần tử có thể tương tác (button/a/input/role); các `Text onClick` không role (vd. `ActionLink` ở `addresses.tsx:178-200`) và vùng bấm mở rộng bằng `::before`/padding của cha (`hit-44-css.spec.tsx`) có thể làm số đo cao hơn hoặc thấp hơn thực tế. Dùng làm chỉ báo, không phải kết luận.

### 3.1 Mini App (41 route-id đã chụp; 3 route không chụp — mục 9)

TB các cột: token 3,3 · thứ bậc 3,2 · CTA 3,4 · copy 3,8 · tap 4,0 · contrast 3,5 · premium 3,2; **TB chung 3,5**. Thấp nhất: `dealer` 2,0, `storefront-builder` 2,4, `about` 2,6, `game` 2,6, `settings` 2,9. Cao nhất: `not-found` 4,4, `product-detail` / `order-detail` / `bank-payment` 4,3, `checkout` / `browse` 4,1.

Ba trang không chụp được, chấm token theo mã (các cột khác không chấm): `loyalty` token 1 (150 alias legacy, emoji hạng ở `loyalty.tsx:36-41`), `brand-view` token 5, `storefront-view` token 5 (0 alias; vẫn trộn `Box`/`Page` ZaUI).

| trang | token DS v2 | thứ bậc | CTA | copy VN | tap ≥44px | contrast | premium | TB | vấn đề chính | ảnh |
|---|---|---|---|---|---|---|---|---|---|---|
| `home` | 5 | 4 | 4 | 4 | 3 | 3 | 4 | **3.9** | Dải "Mua lại" cắt ngang không gợi ý cuộn; "★ Mới" tone disabled xám nhạt (product-tile.tsx:174,179); 12 phần tử tap <44px; khi catalog lỗi các khối biến mất, không có nút thử lại | [ảnh](screens/miniapp/home__normal__390.png) |
| `home-new-customer` | 5 | 4 | 4 | 4 | 3 | 2 | 4 | **3.7** | contrast×9 trên ảnh khách mới; chữ <12px ×11 | [ảnh](screens/miniapp/home-new-customer__normal__390.png) |
| `browse` | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **4.1** | Không có h1; 6 tap nhỏ; nested-interactive×30 (thẻ chứa nút tim) | [ảnh](screens/miniapp/browse__normal__390.png) |
| `browse-search` | 5 | 4 | 4 | 4 | 3 | 3 | 4 | **3.9** | contrast×4 ở kết quả tìm kiếm | [ảnh](screens/miniapp/browse-search__normal__390.png) |
| `product-detail` | 4 | 4 | 5 | 4 | 4 | 5 | 4 | **4.3** | Viewport chặn zoom (index.html:7); chữ <12px ×17; không có h1; trang dài, "Cam kết Tubu" và mô tả nằm sau 4 khối khuyến mãi | [ảnh](screens/miniapp/product-detail__normal__390.png) |
| `cart` | 5 | 4 | 4 | 4 | 1 | 5 | 4 | **3.9** | 13/23 phần tử tương tác <44px; nhãn "Mã giảm giá" (cart.tsx:446) ≠ "Mã ưu đãi" (voucher-sheet.tsx:162) | [ảnh](screens/miniapp/cart__normal__390.png) |
| `checkout` | 5 | 4 | 5 | 4 | 2 | 5 | 4 | **4.1** | label×6 (radio/checkbox thiếu nhãn); Ví Tubu/TubuXu bị làm mờ nhưng không nói vì sao; "48/65000 điểm" không có dấu phân cách nghìn | [ảnh](screens/miniapp/checkout__normal__390.png) |
| `bank-payment` | 5 | 4 | 4 | 4 | 5 | 5 | 3 | **4.3** | Trang rất thưa, không có h1; mã QR dựa vào CSP/Vite nên chưa kiểm chứng nội dung thật | [ảnh](screens/miniapp/bank-payment__normal__390.png) |
| `orders` | 5 | 4 | 4 | 4 | 5 | 2 | 4 | **4.0** | contrast×6; chữ <12px ×5; thẻ "Mua lại" lặp lại đúng thẻ ở Home | [ảnh](screens/miniapp/orders__normal__390.png) |
| `orders-subscriptions` | 5 | 4 | 4 | 3 | 5 | 2 | 4 | **3.9** | contrast×7; thông báo giảm giá 12% hiển thị trên cả đơn đã huỷ | [ảnh](screens/miniapp/orders-subscriptions__normal__390.png) |
| `order-detail` | 5 | 4 | 4 | 3 | 5 | 5 | 4 | **4.3** | Dòng sự kiện hiện enum thô `ev.status ?? "—"` (order-detail.tsx ~401); chữ <12px ×20; 2 Sheet ZaUI | [ảnh](screens/miniapp/order-detail__normal__390.png) |
| `game` | 1 | 2 | 3 | 3 | 5 | 1 | 3 | **2.6** | 163 alias legacy, 107 emoji, trang dài >3200px chứa ≥12 khối; số không định dạng ("1250000", "65.000 xu"); contrast×10; 4 lỗi console | [ảnh](screens/miniapp/game__normal__390.png) |
| `feed` | 3 | 3 | 3 | 4 | 1 | 4 | 3 | **3.0** | 26/35 phần tử tương tác <44px; button-name×1; scrollable-region-focusable×5 | [ảnh](screens/miniapp/feed__normal__390.png) |
| `feed-leaderboard` | 4 | 4 | 3 | 4 | 5 | 3 | 3 | **3.7** | Lặp "điểm uy tín" ở từng hàng; contrast×3; huy chương emoji | [ảnh](screens/miniapp/feed-leaderboard__normal__390.png) |
| `feed-events` | 3 | 3 | 3 | 4 | 5 | 4 | 3 | **3.6** | contrast×2; không h1 | [ảnh](screens/miniapp/feed-events__normal__390.png) |
| `post-detail` | 2 | 3 | 3 | 4 | 2 | 4 | 3 | **3.0** | 60 alias legacy; 7/15 tap nhỏ | [ảnh](screens/miniapp/post-detail__normal__390.png) |
| `ai-advisor` | 3 | 3 | 4 | 4 | 5 | 4 | 3 | **3.7** | Ô nhập + nút "Gửi" (disabled) xám trên xám; khi lỗi mạng chưa thấy thông báo trong ảnh error | [ảnh](screens/miniapp/ai-advisor__normal__390.png) |
| `group-buy` | 3 | 3 | 4 | 4 | 5 | 2 | 3 | **3.4** | contrast×9 | [ảnh](screens/miniapp/group-buy__normal__390.png) |
| `refill` | 3 | 3 | 3 | 4 | 5 | 3 | 3 | **3.4** | button-name×2 (nút icon không nhãn); 37 alias legacy | [ảnh](screens/miniapp/refill__normal__390.png) |
| `beta` | 3 | 3 | 3 | 4 | 5 | 2 | 3 | **3.3** | contrast×6; nút "Gửi góp ý" vô hiệu hoá nhạt; 3 lỗi console | [ảnh](screens/miniapp/beta__normal__390.png) |
| `profile` | 2 | 3 | 3 | 4 | 5 | 1 | 3 | **3.0** | contrast×10; 43 alias legacy; menu 17 mục không nhóm theo mức dùng | [ảnh](screens/miniapp/profile__normal__390.png) |
| `wallet` | 2 | 3 | 3 | 4 | 5 | 2 | 3 | **3.1** | contrast×6; 62 alias legacy | [ảnh](screens/miniapp/wallet__normal__390.png) |
| `addresses` | 4 | 3 | 3 | 4 | 5 | 5 | 3 | **3.9** | ActionLink là Text onClick không role/min-height (addresses.tsx:178-200) | [ảnh](screens/miniapp/addresses__normal__390.png) |
| `notifications` | 3 | 3 | 3 | 4 | 5 | 3 | 3 | **3.4** | aria-prohibited-attr×3; contrast×4 | [ảnh](screens/miniapp/notifications__normal__390.png) |
| `affiliate` | 1 | 3 | 3 | 3 | 4 | 4 | 3 | **3.0** | 129 alias legacy; trang rất dài; thuật ngữ "Tubu Xu"/"TubuXu"/"xu" lẫn lộn (affiliate.tsx:368) | [ảnh](screens/miniapp/affiliate__normal__390.png) |
| `academy` | 3 | 3 | 3 | 4 | 5 | 2 | 3 | **3.3** | contrast×9 | [ảnh](screens/miniapp/academy__normal__390.png) |
| `academy-course` | 3 | 3 | 3 | 4 | 4 | 5 | 3 | **3.6** | Không có h1 | [ảnh](screens/miniapp/academy-course__normal__390.png) |
| `cashback` | 2 | 3 | 3 | 4 | 5 | 3 | 3 | **3.3** | contrast×4; 26 alias legacy + 5 màu thô | [ảnh](screens/miniapp/cashback__normal__390.png) |
| `dealer` | 1 | 2 | 3 | 3 | 1 | 2 | 2 | **2.0** | 20/23 tap nhỏ; 121 alias; contrast×8; `--dealer-*` giữ hex v1 | [ảnh](screens/miniapp/dealer__normal__390.png) |
| `about` | 3 | 3 | 2 | 2 | 1 | 5 | 2 | **2.6** | Hotline/email giữ chỗ (about.tsx:181-183: "1900 1234", "hotro@tubutree.com") chưa xác nhận; 14/16 tap nhỏ | [ảnh](screens/miniapp/about__normal__390.png) |
| `wishlist` | 4 | 3 | 3 | 4 | 5 | 2 | 3 | **3.4** | Dùng components/product-card.tsx cũ (không phải ProductTile); contrast×7 | [ảnh](screens/miniapp/wishlist__normal__390.png) |
| `edit-profile` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | **3.7** | label×3 (ô nhập thiếu nhãn gắn kết) | [ảnh](screens/miniapp/edit-profile__normal__390.png) |
| `settings` | 3 | 3 | 3 | 3 | 2 | 3 | 3 | **2.9** | aria-toggle-field-name×3; mũi tên bằng ký tự "›" (settings.tsx:225) | [ảnh](screens/miniapp/settings__normal__390.png) |
| `brand-story` | 1 | 3 | 2 | 4 | 5 | 5 | 3 | **3.3** | 102 hex + 5 rgb trong file; chữ <12px ×29; không h1 | [ảnh](screens/miniapp/brand-story__normal__390.png) |
| `storefront-builder` | 2 | 2 | 3 | 3 | 1 | 4 | 2 | **2.4** | 64/100 phần tử tương tác <44px; 88 alias legacy; trang rất dài | [ảnh](screens/miniapp/storefront-builder__normal__390.png) |
| `brand-owner` | 3 | 3 | 3 | 3 | 2 | 4 | 3 | **3.0** | 12/24 tap nhỏ; label×3; không có màn doanh thu/đơn hàng cho chủ nhãn | [ảnh](screens/miniapp/brand-owner__normal__390.png) |
| `admin` | 3 | 3 | 3 | 3 | 5 | 5 | 3 | **3.6** | 3 lỗi console; tiêu đề trang thiếu h1; 32 alias legacy | [ảnh](screens/miniapp/admin__normal__390.png) |
| `admin-community` | 3 | 3 | 3 | 4 | 5 | 4 | 3 | **3.6** | contrast×2 | [ảnh](screens/miniapp/admin-community__normal__390.png) |
| `my-payroll` | 2 | 3 | 3 | 4 | 5 | 5 | 3 | **3.6** | button-name×2; 7 màu rgb thô | [ảnh](screens/miniapp/my-payroll__normal__390.png) |
| `not-found` | 4 | 4 | 4 | 5 | 5 | 5 | 4 | **4.4** | Tiêu đề đè lên hình minh hoạ (ảnh not-found__normal__390) | [ảnh](screens/miniapp/not-found__normal__390.png) |
| `staff` | 2 | 3 | 4 | 4 | 5 | 3 | 3 | **3.4** | button-name×2; contrast×4; 41 alias legacy | [ảnh](screens/miniapp/staff__normal__390.png) |


### 3.2 Web (36 màn: 11 trang + 19 tab admin + 5 tab merchant + 1 merchant CTV)

TB các cột: token 1,0 · thứ bậc 3,1 · CTA 3,2 · copy 4,0 · tap 1,1 · contrast 2,7 · premium 2,3; **TB chung 2,5**. Điểm tap thấp phần lớn do admin/merchant là công cụ chuột máy tính (nút `text-xs px-2.5 py-1`) — đây là bảng điều khiển nội bộ nên độ ưu tiên thấp hơn trang khách (`home`, `san-pham`, `gio-hang`, `thanh-toan`, `tai-khoan`: 5–19 phần tử nhỏ/trang).

| trang | token DS v2 | thứ bậc | CTA | copy VN | tap ≥44px | contrast | premium | TB | vấn đề chính | ảnh |
|---|---|---|---|---|---|---|---|---|---|---|
| `home` | 1 | 4 | 4 | 4 | 2 | 1 | 3 | **2.7** | Hero gradient + CTA cam (palette v1); chữ <12px ×86; contrast×20 | [ảnh](screens/web/home__normal__390.png) |
| `san-pham` | 1 | 4 | 4 | 4 | 1 | 3 | 3 | **2.9** | CTA cam, placeholder lá; 6/7 tap nhỏ | [ảnh](screens/web/san-pham__normal__390.png) |
| `gio-hang` | 1 | 3 | 4 | 4 | 1 | 2 | 3 | **2.6** | 19/20 tap nhỏ; contrast×8 | [ảnh](screens/web/gio-hang__normal__390.png) |
| `thanh-toan` | 1 | 3 | 4 | 4 | 1 | 3 | 3 | **2.7** | 11/16 tap nhỏ | [ảnh](screens/web/thanh-toan__normal__390.png) |
| `tai-khoan` | 1 | 3 | 3 | 4 | 1 | 3 | 3 | **2.6** | Header gradient cam; không h1 | [ảnh](screens/web/tai-khoan__normal__390.png) |
| `dang-nhap` | 1 | 4 | 4 | 4 | 1 | 3 | 3 | **2.9** | contrast×3 | [ảnh](screens/web/dang-nhap__normal__390.png) |
| `dang-nhap-callback` | 1 | 3 | 3 | 3 | 1 | 4 | 3 | **2.6** | Không h1; trạng thái chờ OAuth trống | [ảnh](screens/web/dang-nhap-callback__normal__390.png) |
| `storefront` | 1 | 3 | 3 | 4 | 1 | 4 | 3 | **2.7** | Palette v1 | [ảnh](screens/web/storefront__normal__390.png) |
| `brand` | 1 | 3 | 3 | 4 | 1 | 4 | 3 | **2.7** | Palette v1 | [ảnh](screens/web/brand__normal__390.png) |
| `admin-pos` | 1 | 3 | 4 | 4 | 1 | 5 | 3 | **3.0** | 6/6 tap nhỏ | [ảnh](screens/web/admin-pos__normal__390.png) |
| `merchant-denied` | 1 | 3 | 3 | 4 | 1 | 5 | 3 | **2.9** | Không h1; chỉ báo từ chối | [ảnh](screens/web/merchant-denied__normal__390.png) |
| `admin-dashboard` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-dashboard__normal__390.png) |
| `admin-dealers` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-dealers__normal__390.png) |
| `admin-dealerClaims` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-dealerClaims__normal__390.png) |
| `admin-payouts` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-payouts__normal__390.png) |
| `admin-orders` | 1 | 3 | 3 | 4 | 1 | 1 | 2 | **2.1** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-orders__normal__390.png) |
| `admin-returns` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-returns__normal__390.png) |
| `admin-cashback` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-cashback__normal__390.png) |
| `admin-posCredits` | 1 | 3 | 3 | 4 | 1 | 4 | 2 | **2.6** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-posCredits__normal__390.png) |
| `admin-users` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-users__normal__390.png) |
| `admin-config` | 1 | 3 | 3 | 4 | 1 | 1 | 2 | **2.1** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-config__normal__390.png) |
| `admin-coupons` | 1 | 3 | 3 | 4 | 1 | 4 | 2 | **2.6** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-coupons__normal__390.png) |
| `admin-brands` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-brands__normal__390.png) |
| `admin-merchantProducts` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-merchantProducts__normal__390.png) |
| `admin-flashSales` | 1 | 3 | 3 | 4 | 1 | 1 | 2 | **2.1** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-flashSales__normal__390.png) |
| `admin-faqs` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-faqs__normal__390.png) |
| `admin-contentKit` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-contentKit__normal__390.png) |
| `admin-academy` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-academy__normal__390.png) |
| `admin-quickReplies` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-quickReplies__normal__390.png) |
| `admin-analytics` | 1 | 3 | 3 | 4 | 1 | 5 | 2 | **2.7** | Bảng quản trị palette v1, nút <44px | [ảnh](screens/web/admin-analytics__normal__390.png) |
| `merchant-1` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-1__normal__390.png) |
| `merchant-2` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-2__normal__390.png) |
| `merchant-3` | 1 | 3 | 3 | 4 | 1 | 3 | 2 | **2.4** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-3__normal__390.png) |
| `merchant-4` | 1 | 3 | 3 | 4 | 2 | 1 | 2 | **2.3** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-4__normal__390.png) |
| `merchant-5` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-5__normal__390.png) |
| `merchant-ctv` | 1 | 3 | 3 | 4 | 1 | 2 | 2 | **2.3** | Console palette v1, giữ hex theme | [ảnh](screens/web/merchant-ctv__normal__390.png) |


### 3.3 Tổng hợp axe-core (trạng thái `normal`; Mini App @390, Web @1440)

Mini App:

| rule | mức | số trang | tổng nút |
|---|---|---|---|
| landmark-one-main | moderate | 41 | 41 |
| meta-viewport | moderate | 41 | 41 |
| region | moderate | 40 | 574 |
| page-has-heading-one | moderate | 34 | 34 |
| color-contrast | serious | 29 | 131 |
| nested-interactive | serious | 9 | 112 |
| scrollable-region-focusable | serious | 9 | 16 |
| button-name | critical | 4 | 7 |
| label | critical | 3 | 12 |
| aria-prohibited-attr | serious | 1 | 3 |
| aria-toggle-field-name | serious | 1 | 3 |


Web:

| rule | mức | số trang | tổng nút |
|---|---|---|---|
| color-contrast | serious | 33 | 209 |
| heading-order | moderate | 12 | 12 |
| select-name | critical | 8 | 9 |
| label | critical | 5 | 10 |
| page-has-heading-one | moderate | 3 | 3 |
| target-size | serious | 2 | 24 |
| landmark-one-main | moderate | 1 | 1 |
| region | moderate | 1 | 2 |


Ghi chú:
- `landmark-one-main` / `region` / `page-has-heading-one` / `meta-viewport`: toàn bộ Mini App không có `<main>` hay `<h1>` trên 34/41 trang (vì dùng `Page`/`Box` ZaUI → `div`), và `meta-viewport` do `user-scalable=no` (`apps/miniapp/index.html:7`). Đây là mức moderate, nhưng `meta-viewport` là lỗi WCAG 1.4.4 thật (A4-004).
- `nested-interactive` ×112 trên 9 trang: mẫu axe cho thấy thẻ sản phẩm (`div[aria-label="<tên sản phẩm>"]`) là phần tử tương tác chứa phần tử tương tác khác (nút tim; chưa truy vết từng nút còn lại) — trình đọc màn hình không truy cập được nút con (A4-015).
- `button-name` (critical) ×7 trên `feed`, `refill`, `my-payroll`, `staff`; `label` (critical) ×12 trên `checkout` (×6), `edit-profile` (×3), `brand-owner` (×3) (A4-005).
- **Chi tiết contrast, Mini App** (`build-report-data.mjs contrast miniapp`): 100% nút vi phạm là `#9E978A` trên `#FFFFFF` (2,89:1), `#F6F4EF` (2,63:1) hoặc `#EEF4EF` (2,59:1), cần 4,5:1 — tức token `--color-text-disabled` (`packages/design-tokens/src/tokens.css:28,99`) dùng cho chữ thông tin.
- **Chi tiết contrast, Web** (`contrast web`): `#A8A8A0` trên trắng 2,39:1 ×62; chữ trắng trên `#16A34A` 3,29:1 ×30 (nút xanh Tailwind); chữ trắng trên `#E08C1C` 2,64:1 ×16 (CTA cam); chữ `#E08C1C` trên `#FAFAF8` 2,53:1 ×10 (A4-006).


## 4. Quét tĩnh

Nguồn: `scripts/uiux/static-scan.mjs` → `scripts/uiux/results/static-scan.json` (190 file `.ts/.tsx/.css` của Mini App, 63 file của Web, bỏ `*.spec.*`); ESLint chạy bằng `npx eslint src --format json` trong `apps/miniapp` (286 file), tổng hợp bằng `scripts/uiux/eslint-summary.mjs`.

### 4.1 Tổng quan Mini App

| Chỉ số | Giá trị | Ghi chú |
|---|---|---|
| Alias legacy v1 (`var(--neutral-*, --primary-*, --leaf-*, --success/warning/danger/info(-bg), --sun-*, --clay-*, --radius-*, --shadow-*, --dealer-*)`) | **1.616 lần**, 30/40 trang | Khối alias nằm ở `apps/miniapp/src/css/tokens.css:25-117`, ánh xạ về stone/forest/sage nên không vỡ giao diện nhưng `--leaf-*`→sage cho ra xanh ô-liu khác xanh rừng của DS v2 (A4-002) |
| Hex trong mã (ngoài định nghĩa token) | 148 | `brand-story.tsx` 102, `utils/brands.ts` 17, `avatar-crop-modal.tsx` 8, `storefront-builder.tsx` 8, `error-boundary.tsx` 3 |
| `rgb()/rgba()` | 71 | `dealer.tsx` 9, `onboarding.tsx` 8, `my-payroll.tsx` 7, `profile.tsx` 6, `affiliate.tsx` 6, `wallet.tsx` 5 |
| Trang trộn ZaUI với DS v2 | 40/40 trang import `Page` từ `zmp-ui`; 34/40 trang cũng import `components/ui/*` | Số lần import: `Box` 58, `Text` 56, `Button` 42, `Input` 22, `Sheet` 22, `Avatar` 4, `Spinner` 3, `Select/Checkbox/Radio/Switch` 1 mỗi loại |
| Icon | 0 file dùng `zmp-ui-icons`; 64 file dùng `lucide-react` | Đạt quy ước "icon chức năng = Lucide" |
| Emoji | `i18n/vi.ts` 35, `game.tsx` 107 (được phép), `onboarding.tsx` 22, `loyalty.tsx` 15 (hạng: được phép), `reviews-section.tsx` 12, `community/post-card.tsx` 9, `wheel.tsx` 8, `bank-payment.tsx` 7, `brand-view.tsx` 7, `wallet.tsx` 6, `post-detail.tsx` 6 | Ngoài game/hạng: `onboarding`, `reviews-section`, `post-card`, `bank-payment`, `brand-view`, `wallet`, `post-detail`, `vi.ts` dùng emoji làm trang trí/chức năng (A4-031) |
| Component trùng | `components/product-card.tsx` (cũ, chỉ `pages/wishlist.tsx` import) song song `components/ui/product-tile.tsx` (DS v2, dùng ở Home/Browse/PDP); `components/ui/primitives.tsx` (không file nào import, chỉ có spec); `Sheet` ZaUI (22 import) song song `ui/bottom-sheet.tsx`; `Button` ZaUI (42) song song `ui/button.tsx` | A4-012, A4-020 |

### 4.2 Alias legacy, màu thô và ZaUI theo từng trang Mini App

(sắp theo số alias legacy giảm dần; "dùng DS v2" = file có import từ `components/ui/*`)

| trang | alias legacy v1 | hex | rgb() | ZaUI trộn | dùng DS v2 |
|---|---|---|---|---|---|
| game.tsx | 163 | 0 | 2 | Box/Page/Text/Button | có |
| loyalty.tsx | 150 | 0 | 4 | Box/Page/Text/Button | có |
| affiliate.tsx | 129 | 1 | 6 | Box/Page/Text/Button/Input/Sheet | có |
| dealer.tsx | 121 | 0 | 9 | Box/Page/Text/Button/Input/Sheet | có |
| storefront-builder.tsx | 88 | 8 | 1 | Box/Page/Text/Button/Input/Sheet | có |
| wallet.tsx | 62 | 0 | 5 | Box/Page/Text/Button/Input/Sheet | có |
| post-detail.tsx | 60 | 0 | 0 | Box/Page/Text/Button/Input/Sheet | có |
| profile.tsx | 43 | 0 | 6 | Box/Page/Text/Button/Avatar/Spinner | không |
| staff.tsx | 41 | 0 | 3 | Box/Page/Text/Button/Input/Sheet | có |
| refill.tsx | 37 | 0 | 0 | Box/Page/Text/Button | có |
| ai-advisor.tsx | 34 | 0 | 0 | Box/Page/Text/Button/Input/Spinner | không |
| feed.tsx | 34 | 0 | 0 | Box/Page/Text/Button/Input | có |
| admin.tsx | 32 | 0 | 0 | Box/Page/Text/Button/Input/Sheet | có |
| about.tsx | 29 | 1 | 1 | Box/Page/Text/Button/Sheet | không |
| cashback.tsx | 26 | 3 | 2 | Box/Page/Text/Button/Sheet/Avatar | có |
| community-events.tsx | 26 | 0 | 0 | Box/Page/Text/Button | có |
| academy.tsx | 23 | 0 | 0 | Box/Page/Text/Button | có |
| beta.tsx | 23 | 0 | 0 | Box/Page/Text/Button/Input | có |
| brand-owner.tsx | 23 | 0 | 0 | Box/Page/Text/Button/Input/Sheet | có |
| community-moderation.tsx | 23 | 0 | 0 | Box/Page/Text/Button/Input | có |
| settings.tsx | 23 | 0 | 0 | Box/Page/Text/Button | không |
| notifications.tsx | 21 | 0 | 0 | Box/Page/Text/Button | có |
| my-payroll.tsx | 17 | 0 | 7 | Box/Page/Text/Button/Input/Sheet | có |
| group-buy.tsx | 16 | 0 | 0 | Box/Page/Text/Button | có |
| brand-story.tsx | 15 | 102 | 5 | Box/Page/Text/Sheet/Button | không |
| community-leaderboard.tsx | 15 | 0 | 0 | Box/Page/Text/Button | có |
| addresses.tsx | 13 | 0 | 0 | Box/Page/Text/Button/Sheet | có |
| not-found.tsx | 4 | 0 | 0 | Box/Page/Text/Button | không |
| edit-profile.tsx | 1 | 0 | 0 | Box/Page/Text/Button/Input/Avatar | có |
| wishlist.tsx | 1 | 0 | 0 | Box/Page | có |
| bank-payment.tsx | 0 | 0 | 0 | Box/Page/Text | có |
| brand-view.tsx | 0 | 0 | 0 | Box/Page | có |
| browse.tsx | 0 | 0 | 0 | Page | có |
| cart.tsx | 0 | 0 | 0 | Box/Page/Text | có |
| checkout.tsx | 0 | 0 | 0 | Box/Page/Text/Input | có |
| home.tsx | 0 | 0 | 0 | Page | có |
| order-detail.tsx | 0 | 0 | 0 | Box/Page/Text/Sheet | có |
| orders.tsx | 0 | 0 | 0 | Page | có |
| product-detail.tsx | 0 | 0 | 1 | Box/Page/Text | có |
| storefront-view.tsx | 0 | 0 | 0 | Box/Page | có |

Các file không phải trang có nhiều alias nhất: `components/affiliate/ctv-order-sheet.tsx` 39, `components/reviews-section.tsx` 34, `components/checkout/voucher-sheet.tsx` 32 — nghĩa là cả Checkout (trang "sạch") vẫn kéo một sheet còn palette cũ.

### 4.3 ESLint Mini App (`npx eslint src --format json`)

Kết quả: 286 file, **105 lỗi, 1 cảnh báo**; exit code 1 (lint hiện đỏ, nên không thể làm cổng CI nếu không dọn trước).

| rule | error | warning | số file |
|---|---|---|---|
| tubu-ds/no-raw-color | 76 | 0 | 19 |
| no-restricted-imports | 29 | 0 | 29 |
| @typescript-eslint/consistent-type-imports | 0 | 1 | 1 |


File vi phạm `tubu-ds/no-raw-color` nhiều nhất: `brand-story.tsx` 12, `dealer.tsx` 9, `my-payroll.tsx` 7, `avatar-crop-modal.tsx` 7, `cashback.tsx` 5, `wallet.tsx` 5, `onboarding.tsx` 5. 29 trang vi phạm `no-restricted-imports` (dùng `Button` từ `zmp-ui` thay vì `components/ui/button`). Đối chiếu: `packages/eslint-config/index.js` định nghĩa các luật này; `icon-button-aria-label` không có lỗi nào.

### 4.4 Web còn dùng palette cũ không?

**Có, toàn bộ.** Số liệu `static-scan.mjs` (63 file `apps/web/src`):

| Chỉ số | Giá trị |
|---|---|
| Lớp Tailwind palette v1 (`primary-*`, `leaf-*`, …) | 227 |
| Lớp `neutral-*` (xám v1) | 841 |
| Lớp xanh/đỏ Tailwind mặc định (`green-*`, `red-*`) | 416 |
| Lớp DS v2 (forest/sage/stone/honey/terracotta) | **0** |
| Hex thô | 17 (`merchant/page.tsx` 8, `s/[slug]/page.tsx` 5, `product-card.tsx` 2, …) |
| File dùng Fraunces | **0** (Mini App dùng Fraunces cho tiêu đề) |
| Icon | 23 file `lucide-react` (đạt); emoji 22 |

Bằng chứng cấu hình: `apps/web/tailwind.config.ts` + `tailwind.config.spec.ts` giữ palette v1 nguyên văn (cam `#E08C1C`); `apps/web/src/app/globals.css:12-13` đặt `neutral.900`; `apps/web/src/app/page.tsx:22-58` hero gradient `from-leaf-900 via-leaf-800 to-primary-900` + CTA cam. File web nặng nhất: `merchant/page.tsx` (30 palette + 8 hex + 178 `neutral-*`), `page.tsx` 29, `gio-hang/page.tsx` 26, `thanh-toan/page.tsx` 20, `s/[slug]/page.tsx` 12 (+5 hex), `site-header.tsx` 16.

Web `next lint` không chạy (RAM máy thấp, mục 9).

### 4.5 Đối chiếu với tài liệu kế hoạch DS v2

`docs/superpowers/plans/2026-09-28-design-system-v2-followups.md` liệt kê các việc còn lại sau DS v2. Kiểm lại trên commit này:

| Mục cũ | Trạng thái hôm nay | Bằng chứng |
|---|---|---|
| Pinch-zoom bị chặn | **CÒN MỞ** | `apps/miniapp/index.html:7` `maximum-scale=1.0, user-scalable=no` |
| `ui/primitives.tsx` thừa | **CÒN MỞ** | 0 file import (chỉ `primitives.spec.tsx`) |
| `Chip` <44px | **CÒN MỞ** | `components/ui/chip.tsx:53` `padding 6–8px`, `minHeight 32/36` |
| Inter chỉ có 400/500 | **CÒN MỞ** | `packages/design-tokens/src/fonts.css`; UI dùng `fontWeight 600/700` (vd `chip.tsx:50`) → trình duyệt tự làm đậm giả |
| Tailwind preflight toàn cục | **CÒN MỞ** | cấu hình web/miniapp không đặt `preflight:false` |
| Khoá bấm đúp của `Button` chỉ qua `loading` | **CÒN MỞ** | `components/ui/button.tsx:55-58` (không có `useRef` khoá đồng bộ) |
| Helper bàn phím cho phần tử bấm được không phải nút | **CÒN MỞ** | `addresses.tsx:178-200` `Text onClick` không role |
| Gỡ alias legacy | **CÒN MỞ** | 30/40 trang (4.1) |
| Tim yêu thích vùng bấm 44px | ĐÃ SỬA | `wishlist-heart.spec.tsx` + ảnh `home__normal__390.png` |
| `SearchField` focus ring/nút xoá | ĐÃ SỬA | `ui/search-field.tsx` + `search-field-css.spec.tsx` |

(Tài liệu `docs/audit-2026-09/04-design-system.md` và `docs/2026-10-review/*` của các nhiệm vụ khác chưa được đối chiếu chi tiết — chưa kiểm chứng.)


## 5. Đếm bước theo 5 luồng

Đếm từ mã nguồn (đường ngắn nhất người dùng bình thường đi được), **chưa chạy E2E thật trên Zalo**. "Chạm" = một lần bấm nút/mục/ô; "gõ" = nhập một trường văn bản; "màn" = số màn hình (route/sheet) đi qua trước màn kết quả.

| # | Luồng | Đường đi | Chạm | Gõ | Màn | Bằng chứng | Nhận xét |
|---|---|---|---|---|---|---|---|
| 1 | Khách **mới** đặt đơn đầu từ Home (COD, 1 sản phẩm, chưa có địa chỉ) | Home → chạm thẻ sản phẩm (1) → PDP, "Mua ngay" (2) → Checkout, "Thêm địa chỉ mới" (3) → chọn Tỉnh (4–5) + Phường (6–7) → gõ Người nhận, SĐT, Địa chỉ (3 lần gõ + 3 chạm vào ô = 8–10) → "Lưu" (11) → "Đặt hàng" (12) → màn thành công | **≈ 12** (+1–2 nếu lớp phủ giới thiệu "Để sau", `onboarding.tsx:130`) | 3 | 3 + kết quả | `product-detail.tsx:196-218,700-750` ("Mua ngay" đi thẳng `/checkout`, tiết kiệm 2 chạm so với giỏ), `checkout/address-section.tsx:84`, `address-form.tsx:14-40,113-140`, `checkout.tsx:723-745` | Địa chỉ chiếm 8/12 chạm. Form luôn trống (`address-form.tsx:16-18` `EMPTY_FORM`): tên/SĐT từ hồ sơ Zalo không tự điền (A4-024). Nếu sản phẩm nhiều biến thể thêm ≥1 chạm chọn biến thể. |
| 2 | Khách **cũ** mua lại | (a) Home, dải "Mua lại": nút "Mua lại" (1) → `ReorderSheet` xác nhận (2) → ở lại Home → icon giỏ (3) → "Thanh toán" (4) → "Đặt hàng" (5). (b) Từ PDP: thẻ (1) → "Mua ngay" (2) → "Đặt hàng" (3). (c) Tab Đơn hàng: tab (1) → "Mua lại" (2) → sheet xác nhận (3) → tự sang giỏ → "Thanh toán" (4) → "Đặt hàng" (5) | **3–5** | 0 | 3–4 | `reorder/purchased-rail.tsx:49,88,93` (không truyền `navigateToCart`), `orders.tsx:119`, `order-detail.tsx:709` (có `navigateToCart`), `hooks/use-reorder.ts:70` | Chỉ nhánh Home "Mua lại" ở lại Home sau khi thêm giỏ; khách phải tự tìm giỏ (A4-023). Đây là đường chính của khách quay lại nên đáng dài hơn đường PDP 2 chạm. |
| 3 | CTV **lên đơn hộ** khách | Tab Cá nhân (1) → "Cộng tác viên" (2) → nút "Lên đơn hộ" (3) → Sheet: gõ Người nhận, SĐT (2 gõ) + Tỉnh (4–5), Phường (6–7), gõ Địa chỉ → tìm sản phẩm (gõ + chạm chọn: 8–9, +1 gõ) → chỉnh số lượng nếu >1 → "Tạo đơn" (10) → màn kết quả có mã đơn + nút chia sẻ | **≈ 10–13** | 4 | 2 màn + 1 sheet | `pages/affiliate.tsx:488-496,772-778` (nút mở sheet dùng `var(--primary-600)`), `components/affiliate/ctv-order-sheet.tsx:205-218,241-249,283,306` | Nhập địa chỉ tay mỗi lần, không có "khách hàng đã lưu/gần đây"; đường vào nằm sâu (Cá nhân → CTV → nút giữa trang `affiliate.tsx` dài, 129 alias). |
| 4 | Admin xử lý đơn **Chờ → Đã giao vận** (web `/admin?tab=orders`) | Đăng nhập → `/admin` → tab "Đơn hàng" (1; là tab 5/19, ở 390px phải cuộn ngang) → (tuỳ chọn tìm theo mã) → mở dòng đơn (2) → "Xác nhận" (3) → ("Đóng gói" tuỳ chọn) → "Giao vận" (4) | **4 (5 nếu đóng gói)** | 0–1 | 1 trang | `apps/web/src/app/admin/page.tsx:116-136` (19 tab), `:835-860` (các nút chuyển trạng thái), `:865` và `:882` (DELIVERED/HUỶ có `window.confirm`) | Giả định hàng vẫn mở sau mỗi lần chuyển (chưa chạy). Không có thao tác hàng loạt cho nhiều đơn. Nút "Xác nhận" hiện cả ở PACKED/SHIPPING/RETURNED vì điều kiện loại trừ chỉ có CONFIRMED/DELIVERED/CANCELLED (`:835`) (A4-007). |
| 5 | Chủ nhãn xem **đơn/doanh thu** | Tab Cá nhân (1) → "Quản lý nhãn hàng" (2) → `/brand-owner`: chỉ có hồ sơ nhãn + khuyến mãi | **không thực hiện được** | – | – | `apps/miniapp/src/pages/brand-owner.tsx` (0 lần xuất hiện "doanh thu"/"đơn hàng"), `apps/api/src/modules/brand/brand.controller.ts:39-59` (chỉ `owner/me`, `owner/me/promotions`), `merchant.controller.ts:180` (`@Roles` DEALER/AFFILIATE/ADMIN, không có chủ nhãn) | Chủ nhãn không có kênh nào để thấy đơn hoặc doanh thu của sản phẩm mình (A4-001). Nếu phải hỏi quản trị viên gửi tay, số bước thực tế ngoài ứng dụng. |

Mục tiêu đề xuất cho luồng 1: ≤8 chạm bằng cách tự điền tên/SĐT từ Zalo và chọn Tỉnh/Phường nhanh hơn (A4-024; mục tiêu là đề xuất, không phải số đo).


## 6. Điểm tốt nên giữ

- **Luồng mua chính sạch DS v2**: `home`, `browse`, `product-detail`, `cart`, `checkout`, `orders`, `order-detail` có 0 alias legacy; tiêu đề Fraunces + nền be + nút xanh rừng cho cảm giác "xanh tự nhiên cao cấp" nhất quán (`product-detail__normal__390.png`, `checkout__normal__390.png`).
- **CTA rõ**: PDP có CTA đôi "Thêm vào giỏ" (viền) + "Mua ngay · 260.000đ" (đặc); Checkout có thanh dưới "Đặt hàng · 798.000đ"; "Mua ngay" đi thẳng checkout (tiết kiệm 2 chạm, `product-detail.tsx:196`).
- **Trạng thái trống/404 có hồn**: minh hoạ + câu thân thiện + nút ("Giỏ còn trống đấy", "Trang này lạc vào vườn rồi").
- **Bảo vệ giá khi "Mua ngay"**: chỉ tính đúng dòng vừa thêm và báo khi số lượng gộp với giỏ (`product-detail.tsx:203-218`).
- **Điều hướng 5 mục** (`nav-config.ts`) gọn, tab "Vườn Xanh" nổi ở giữa; nút quay lại nổi `back-button.tsx` nhất quán.
- **Công cụ bảo vệ DS đã có sẵn** (`tubu-ds/no-raw-color`, `icon-button-aria-label`, `hit-44-css.spec`); chỉ cần dọn nợ cũ rồi bật làm cổng.
- **Đã sửa từ followups**: vùng chạm 44px của nút tim; `SearchField` có focus ring và nút xoá.
- Không có đoạn tràn ngang nào ở cả 554 ảnh (cột "tràn ngang" của `metrics` toàn "-").


## 7. Phát hiện

Định dạng mỗi mục: **ID · Mức · Tiêu đề** — Trạng thái; rồi Bằng chứng / Tác động / Đề xuất sửa / Kiểm chứng / Effort · Model · Nhóm file. Mức: P0 = chặn bán hàng/mất tiền/lộ dữ liệu; P1 = sai nghiêm trọng hoặc lỗi a11y/thương hiệu trên đường chính; P2 = sai rõ nhưng có đường vòng; P3 = đánh bóng. Không có P0 trong phạm vi UI/UX vì các đường mua hàng chính đều hoàn thành được trong ảnh chụp và không thấy lỗi chặn; các lỗi liên quan tiền/quyền (nút trạng thái admin) xếp P1 vì chưa kiểm chứng phía API.

### P1

**A4-001 · P1 · Chủ nhãn không có màn xem đơn/doanh thu** — MỚI
- Bằng chứng: `apps/miniapp/src/pages/brand-owner.tsx` không có chuỗi "doanh thu"/"đơn hàng" (grep); `apps/api/src/modules/brand/brand.controller.ts:39-59` chỉ có `owner/me` (GET/PATCH) và `owner/me/promotions` (CRUD); `apps/api/src/modules/merchant/merchant.controller.ts:180` `@Roles` DEALER/AFFILIATE/ADMIN, không có chủ nhãn.
- Tác động: luồng 5 (chủ nhãn xem đơn/doanh thu) không thực hiện được; chủ nhãn là đối tác bán hàng nên thiếu số liệu của chính mình.
- Đề xuất: thêm endpoint `owner/me/orders` + `owner/me/revenue` (lọc theo `Brand.ownerUserId`, chỉ trả các dòng thuộc nhãn, ẩn thông tin khách) và tab "Đơn & doanh thu" trong `/brand-owner`. Xem quyết định D1.
- Kiểm chứng: `grep -c "doanh thu" apps/miniapp/src/pages/brand-owner.tsx` > 0; e2e đăng nhập chủ nhãn → tab hiện đơn của nhãn mình, không hiện đơn nhãn khác.
- L · opus (thiết kế API + quyền) · `apps/api/src/modules/brand/**`, `apps/miniapp/src/pages/brand-owner.tsx`

**A4-002 · P1 · DS v2 chưa migrate xong: 30/40 trang còn alias legacy, 40/40 trộn ZaUI** — CÒN MỞ từ `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`
- Bằng chứng: `scripts/uiux/results/static-scan.json` — 1.616 lần dùng alias; `game.tsx` 163, `loyalty.tsx` 150, `affiliate.tsx` 129, `dealer.tsx` 121, `storefront-builder.tsx` 88, `wallet.tsx` 62, `post-detail.tsx` 60; khối alias ở `apps/miniapp/src/css/tokens.css:25-117` (`--leaf-*`→sage cho ra xanh ô-liu lệch so với xanh rừng).
- Tác động: giao diện không đồng nhất giữa các trang (xanh rừng ↔ ô-liu), mỗi lần đổi token phải sửa hai nơi; điểm token trung bình chỉ 3,3/5.
- Đề xuất: migrate theo lô (game+loyalty, affiliate+dealer+storefront-builder, wallet+post-detail+feed, phần còn lại), mỗi lô chạy lại `static-scan.mjs` đến 0 alias rồi xoá khối alias.
- Kiểm chứng: `node scripts/uiux/static-scan.mjs && node -e "const s=require('./scripts/uiux/results/static-scan.json');console.log(s.mini.reduce((a,r)=>a+r.legacy,0))"` → 0.
- L · sonnet (có thể giao Antigravity theo lô; có lệnh kiểm chứng) · `apps/miniapp/src/pages/**`, `apps/miniapp/src/components/**`, `apps/miniapp/src/css/tokens.css`

**A4-003 · P1 · Web chưa dùng palette DS v2 (cam/lá v1, 0 lớp v2, 0 Fraunces)** — MỚI (palette v1 được giữ có chủ đích bởi `apps/web/tailwind.config.spec.ts`, nhưng chưa có kế hoạch di chuyển trong tài liệu đã đọc)
- Bằng chứng: `apps/web/tailwind.config.ts` (palette v1), `apps/web/src/app/page.tsx:22-58` (gradient `leaf-900→primary-900`, CTA cam), `scripts/uiux/results/static-scan.json` (`web`: 227 palette v1, 841 `neutral-*`, 416 `green-/red-`, 0 v2, 17 hex); ảnh `screens/web/home__normal__390.png`, `san-pham__normal__390.png`, `tai-khoan__normal__390.png`.
- Tác động: cùng thương hiệu có hai diện mạo (Mini App xanh rừng/be + Fraunces; Web cam + lá + xanh Tailwind). Khách vào từ link chia sẻ CTV (`/s/[slug]`) thấy Web, không thấy "xanh tự nhiên cao cấp" đã chốt trong lộ trình.
- Đề xuất: đưa `packages/design-tokens` làm preset Tailwind của web, thay `primary/leaf/neutral` bằng token v2, thêm Fraunces cho tiêu đề; làm theo thứ tự trang khách (`/`, `/san-pham`, `/gio-hang`, `/thanh-toan`, `/tai-khoan`, `/s`, `/brand`) rồi mới admin/merchant. Xem quyết định D2.
- Kiểm chứng: `node scripts/uiux/static-scan.mjs` rồi `web` có `legacyPalette=0`; `node scripts/uiux/capture.mjs web --only '^home$' --vp 390 --force` rồi xem ảnh.
- L · sonnet (token) + opus (thiết kế lại hero) · `apps/web/tailwind.config.ts`, `apps/web/src/app/**`, `apps/web/src/components/**`

**A4-004 · P1 · Chặn phóng to bằng hai ngón (user-scalable=no)** — CÒN MỞ từ followups
- Bằng chứng: `apps/miniapp/index.html:7` `maximum-scale=1.0, user-scalable=no`; axe `meta-viewport` trên 41/41 trang.
- Tác động: vi phạm WCAG 1.4.4; người lớn tuổi/mắt kém (nhóm khách mua đồ gia dụng) không phóng chữ được.
- Đề xuất: bỏ `maximum-scale` và `user-scalable=no` (giữ `viewport-fit=cover`).
- Kiểm chứng: `grep -n "user-scalable" apps/miniapp/index.html` rỗng; axe `meta-viewport` = 0 trên `capture.mjs miniapp --only '^home$' --states normal --vp 390 --force`.
- S · haiku · `apps/miniapp/index.html`

**A4-005 · P1 · axe "critical": nút không tên, ô nhập không nhãn** — MỚI
- Bằng chứng: Mini App — `button-name` ×7 (`feed` 1, `refill` 2, `my-payroll` 2, `staff` 2), `label` ×12 (`checkout` 6, `edit-profile` 3, `brand-owner` 3), `aria-toggle-field-name` ×3 (`settings`), `aria-prohibited-attr` ×3 (`notifications`); Web — `select-name` ×9 trên 8 màn admin/merchant, `label` ×10 trên 5 màn. Nguồn: `build-report-data.mjs metrics miniapp|web`.
- Tác động: trình đọc màn hình không đọc được trang thanh toán (radio/checkbox) và nhiều nút icon; thiếu nhãn ô nhập cũng làm tự điền địa chỉ trình duyệt kém.
- Đề xuất: dùng `IconButton` với `aria-label` (luật `tubu-ds/icon-button-aria-label` đã có), gắn `label` cho radio/checkbox ở `checkout.tsx` (qua `ui/form.tsx` `Field`), `aria-label` cho switch ở `settings.tsx` và cho `<select>` admin.
- Kiểm chứng: `node scripts/uiux/capture.mjs miniapp --only '^(checkout|feed|refill|staff|my-payroll|edit-profile|brand-owner|settings|notifications)$' --vp 390 --states normal --force && node scripts/uiux/build-report-data.mjs axe miniapp` không còn `button-name`/`label`.
- M · sonnet · `apps/miniapp/src/pages/{checkout,feed,refill,staff,my-payroll,edit-profile,brand-owner,settings,notifications}.tsx`, `apps/web/src/app/admin/**`, `apps/web/src/app/merchant/page.tsx`

**A4-006 · P1 · Tương phản chữ không đạt 4,5:1 trên diện rộng; CTA cam của web chỉ 2,64:1** — MỚI
- Bằng chứng: Mini App — `#9E978A` (token `--color-text-disabled` = `--stone-400`, `packages/design-tokens/src/tokens.css:28,99`) trên `#FFFFFF` 2,89:1, trên `#F6F4EF` 2,63:1, trên `#EEF4EF` 2,59:1; 29/41 trang, 131 nút (`build-report-data.mjs contrast miniapp`); ví dụ `product-tile.tsx:174,179` `tone="disabled"` cho "★ Mới" và số đánh giá. Web — `#A8A8A0` trên trắng 2,39:1 ×62, trắng trên `#E08C1C` 2,64:1 ×16 (nút CTA), trắng trên `#16A34A` 3,29:1 ×30, `#E08C1C` trên `#FAFAF8` 2,53:1 ×10 (`contrast web`).
- Tác động: mô tả phụ, nhãn, đánh giá, giá cũ khó đọc ngoài nắng; CTA chính của web dưới ngưỡng.
- Đề xuất: (Mini App) đổi `Text tone="disabled"` dùng cho chữ thông tin sang `tone="tertiary"` (`--stone-500`+) hoặc nâng `--color-text-disabled` lên ≥4,5:1 và chỉ dành cho trạng thái vô hiệu thật; (Web) nút cam đổi sang tông tối đủ ≥4,5:1 (`#b86a10` hiện chỉ 4,11:1, cần tối hơn nữa), `neutral-400` → `neutral-600` cho chữ.
- Kiểm chứng: `node scripts/uiux/build-report-data.mjs contrast miniapp` không in dòng nào; tương tự `contrast web`.
- S (Mini App, một token) + M (Web) · sonnet · `packages/design-tokens/src/tokens.css`, `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/web/tailwind.config.ts`

**A4-007 · P1 · Admin web hiện nút chuyển trạng thái không hợp lệ và cho chuyển ngược** — MỚI
- Bằng chứng: `apps/web/src/app/admin/page.tsx:835-841` nút "Xác nhận" hiện khi `status ∉ {CONFIRMED, DELIVERED, CANCELLED}` nghĩa là cả PACKED, SHIPPING, RETURNED; `:855-858` "Giao vận" hiện cho CONFIRMED hoặc PACKED; `:865` DELIVERED và `:882` HUỶ có `window.confirm`, các nút còn lại bấm là đổi ngay.
- Tác động: một cú chạm nhầm có thể đưa đơn đang giao về "Đã xác nhận" hoặc đơn đã trả về xác nhận; DELIVERED kích hoạt điểm xanh/hoa hồng CTV (`:866` thông báo) nên sai thứ tự gây sai tiền. Phía API có chặn chuyển trạng thái sai không: **chưa kiểm chứng** (không đọc `orders` service trong nhiệm vụ này).
- Đề xuất: lập bảng chuyển hợp lệ một nơi (PENDING→CONFIRMED→PACKED→SHIPPING→DELIVERED; huỷ chỉ trước SHIPPING) dùng chung cho hiển thị nút và kiểm tra ở API; giữ `window.confirm` hiện có ở DELIVERED/HUỶ (`:865,882`).
- Kiểm chứng: test đơn vị bảng chuyển trạng thái; `curl` PATCH trạng thái ngược trên DB test phải trả 4xx.
- S (UI) + M (API) · sonnet · `apps/web/src/app/admin/page.tsx`, `apps/api/src/modules/orders/**`

**A4-008 · P1 · Trang "Về Tubu Tree & Hỗ trợ" hiển thị hotline/email giữ chỗ** — MỚI
- Bằng chứng: `apps/miniapp/src/pages/about.tsx:181-183` `1900 1234 (8h–21h)`, `Tubu Tree Official`, `hotro@tubutree.com`; `:186-190` các `LinkRow` chính sách.
- Tác động: khách gặp sự cố đơn gọi nhầm số/gửi nhầm email; làm giảm độ tin cậy của thương hiệu.
- Đề xuất: chủ dự án cung cấp số/OA/email thật hoặc đưa vào `app_config` (admin sửa được), ẩn dòng chưa có. Xem quyết định D3.
- Kiểm chứng: `grep -n "1900 1234" apps/miniapp/src/pages/about.tsx` rỗng.
- S · haiku · `apps/miniapp/src/pages/about.tsx`

**A4-009 · P1 · Vùng chạm dưới 44px ở các trang khách và công cụ bán hàng** — MỚI (khác với Chip, A4-011)
- Bằng chứng: `build-report-data.mjs metrics` — Mini App: `storefront-builder` 64/100, `feed` 26/35, `dealer` 20/23, `about` 14/16, `cart` 13/23, `home` 12/97, `brand-owner` 12/24; Web khách: `gio-hang` 19/20, `home` 14/44, `thanh-toan` 11/16; Web admin 23–67 nút nhỏ/tab; axe `target-size` ×24 (`admin-faqs`, `admin-quickReplies`).
- Tác động: bấm nhầm/trượt trên điện thoại, đặc biệt giỏ hàng (bước quyết định mua) và `storefront-builder` của CTV.
- Đề xuất: dùng class `hit-44` (đã có spec `hit-44-css.spec.tsx`) cho stepper/nút xoá ở `cart.tsx`, `ctv-order-sheet.tsx`, các hàng ở `storefront-builder.tsx`; web: `min-h-11` cho nút ở trang khách, admin để sau. Cảnh báo điểm mù số đo (mục 3).
- Kiểm chứng: `node scripts/uiux/capture.mjs miniapp --only '^(cart|storefront-builder|feed|dealer|about)$' --vp 390 --states normal --force && node scripts/uiux/build-report-data.mjs metrics miniapp` cột `tap<44` giảm về ≤2.
- M · sonnet · `apps/miniapp/src/pages/{cart,storefront-builder,feed,dealer,about}.tsx`, `apps/web/src/app/{gio-hang,thanh-toan}/page.tsx`

### P2

**A4-010 · P2 · ESLint của Mini App đỏ: 105 lỗi** — MỚI
- Bằng chứng: `npx eslint src --format json` trong `apps/miniapp`: `tubu-ds/no-raw-color` 76 (19 file), `no-restricted-imports` 29 (29 file trang dùng `Button` ZaUI), 1 cảnh báo `consistent-type-imports`; `components/error-boundary.tsx:78,88` `#1a1a1a`/`#16a34a`; `brand-story.tsx` 12 lỗi (102 hex).
- Tác động: luật bảo vệ DS không chạy được như cổng chặn; vi phạm mới lẫn trong nhiễu.
- Đề xuất: dọn từng file (token hoá màu; chuyển `Button` sang `ui/button`) rồi bật lint làm cổng CI. Màu `brand-story.tsx`/`utils/brands.ts` là màu nhận diện từng vùng miền nên cần danh sách token riêng thay vì hex rải rác.
- Kiểm chứng: `cd apps/miniapp && npx eslint src` exit 0.
- M · sonnet (giao Antigravity được) · `apps/miniapp/src/pages/brand-story.tsx`, `apps/miniapp/src/utils/brands.ts`, `apps/miniapp/src/components/{avatar-crop-modal,onboarding,error-boundary,image-upload}.tsx`

**A4-011 · P2 · `Chip` nhỏ hơn 44px** — CÒN MỞ từ followups
- Bằng chứng: `apps/miniapp/src/components/ui/chip.tsx:53` `padding 6–8px`, `minHeight 32/36`.
- Tác động: chip lọc danh mục/trạng thái khó bấm, nhất là hàng "Tất cả / Chờ thanh toán / Đang xử lý" ở `orders`.
- Đề xuất: vùng bấm 44px bằng pseudo-element, giữ hình dạng 32–36px.
- Kiểm chứng: `chip.spec.tsx` thêm kiểm tra `hit-44`; đo lại `orders` tap<44 = 0.
- S · haiku · `apps/miniapp/src/components/ui/chip.tsx`

**A4-012 · P2 · `ui/primitives.tsx` không còn ai dùng** — CÒN MỞ từ followups
- Bằng chứng: không file nào import (chỉ `primitives.spec.tsx`); `grep -rn "ui/primitives" apps/miniapp/src` chỉ ra spec.
- Tác động: hai tập primitive song song gây nhầm khi viết trang mới.
- Đề xuất: xoá file và spec.
- Kiểm chứng: `pnpm --filter miniapp test` + `pnpm --filter miniapp build` xanh.
- S · haiku · `apps/miniapp/src/components/ui/primitives*.tsx`

**A4-013 · P2 · Inter chỉ nạp 400/500 nhưng UI dùng 600/700** — CÒN MỞ từ followups
- Bằng chứng: `packages/design-tokens/src/fonts.css`; `components/ui/chip.tsx:50` `fontWeight 600`.
- Tác động: trình duyệt tự làm đậm giả, chữ đậm hơi nhoè, mất độ "premium".
- Đề xuất: nạp thêm 600/700 (hoặc font biến thiên) cho Inter.
- Kiểm chứng: DevTools Network: có file weight 600/700; chụp lại `home` và so ảnh.
- S · sonnet · `packages/design-tokens/src/fonts.css`

**A4-014 · P2 · `Button` chỉ khoá bấm đúp qua prop `loading`** — CÒN MỞ từ followups
- Bằng chứng: `apps/miniapp/src/components/ui/button.tsx:55-58` (`if (loading) return;`, không `useRef` đồng bộ).
- Tác động: hai lần chạm nhanh trước khi `loading` render có thể gọi `onPress` hai lần (đặt hàng, thanh toán). Ghi chú: `checkout.tsx` có `submitting` riêng nên rủi ro nằm ở nút khác.
- Đề xuất: thêm khoá `useRef` trong `Button` khi `onPress` trả Promise.
- Kiểm chứng: `button-guard.spec.ts` thêm ca bấm 2 lần đồng bộ.
- S · sonnet · `apps/miniapp/src/components/ui/button.tsx`

**A4-015 · P2 · Thẻ sản phẩm là phần tử tương tác chứa phần tử tương tác (nested-interactive ×112)** — MỚI
- Bằng chứng: axe `nested-interactive` trên 9 trang (`home` 26, `browse` 30, `product-detail` 8, `checkout` 4, `orders` 6…); mẫu `div[aria-label="Dầu tràm cho bé Cobote"]` (thẻ) chứa nút tim.
- Tác động: trình đọc màn hình không focus được nút con (tim yêu thích, "Mua lại").
- Đề xuất: thẻ dùng liên kết phủ (`::after`) trên tiêu đề, nút tim/mua lại là anh em chứ không phải con.
- Kiểm chứng: `build-report-data.mjs axe miniapp` không còn `nested-interactive`.
- M · sonnet · `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/miniapp/src/components/reorder/purchased-rail.tsx`

**A4-016 · P2 · Phần tử bấm được không phải nút (Text onClick) thiếu role/bàn phím** — CÒN MỞ từ followups
- Bằng chứng: `apps/miniapp/src/pages/addresses.tsx:178-200` `ActionLink` là `<Text onClick>` không `role`, không `min-height`; `pages/settings.tsx:223-225` hàng chứa ký tự "›".
- Tác động: không truy cập được bằng bàn phím/AT, vùng chạm nhỏ (nút Sửa/Xoá địa chỉ).
- Đề xuất: dùng `ListRow`/`Button variant="ghost"`; helper bàn phím chung.
- Kiểm chứng: axe + tap<44 của `addresses`.
- S · haiku · `apps/miniapp/src/pages/addresses.tsx`, `settings.tsx`

**A4-017 · P2 · Home khi catalog lỗi mất khối im lặng, không có thông báo/thử lại** — MỚI
- Bằng chứng: `screens/miniapp/home__error__390.png` chỉ còn Danh mục, hero và 2 mục; không có chữ lỗi; so với `home__normal__390.png`.
- Tác động: người dùng tưởng cửa hàng ít hàng; không có đường tải lại ngoài kéo-để-làm-mới.
- Đề xuất: khối "Không tải được sản phẩm — Thử lại" khi `isError` của các truy vấn catalog.
- Kiểm chứng: `capture.mjs miniapp --only '^home$' --states error --vp 390 --force` rồi xem ảnh có thông báo.
- S · sonnet · `apps/miniapp/src/pages/home.tsx`, `apps/miniapp/src/components/home/**`

**A4-018 · P2 · Checkout: phương thức Ví/TubuXu bị làm mờ mà không nói lý do** — MỚI
- Bằng chứng: `screens/miniapp/checkout__normal__390.png` — "Ví Tubu (130.000đ)" và "TubuXu (149.000 xu)" mờ không có dòng giải thích (thiếu số dư hay không đủ tiền); đoạn Điểm Xanh "Dùng được 48/65000 điểm" chưa định dạng nghìn.
- Tác động: khách không biết cần làm gì để dùng ví/xu.
- Đề xuất: dòng phụ "Số dư chưa đủ (cần 798.000đ)"; định dạng số bằng `utils/format.ts`.
- Kiểm chứng: ảnh `checkout` sau sửa; test thành phần checkout.
- S · sonnet · `apps/miniapp/src/pages/checkout.tsx`

**A4-019 · P2 · Thuật ngữ không nhất quán** — MỚI
- Bằng chứng: "Mã giảm giá" (`cart.tsx:446`, `checkout` ảnh) vs "Mã ưu đãi" (`checkout/voucher-sheet.tsx:162`); "Tubu Xu" (`affiliate.tsx:368`, `affiliate/milestone-copy.ts:22`, `utils/format.ts:52`) vs "TubuXu" (checkout ảnh) vs "xu"; "điểm Xanh" / "điểm uy tín" (`feed-leaderboard` lặp "điểm uy tín" mỗi hàng).
- Tác động: khách khó hiểu đây là cùng thứ hay hai thứ khác nhau (tiền tệ nội bộ).
- Đề xuất: chốt bảng thuật ngữ trong `i18n/vi.ts` (xem D4) và thay thế.
- Kiểm chứng: `grep -rn "Tubu Xu\|TubuXu" apps/miniapp/src | grep -v spec` còn đúng một dạng.
- S · haiku · `apps/miniapp/src/i18n/vi.ts`, nơi dùng

**A4-020 · P2 · Component trùng: `product-card.tsx` cũ, `Sheet`/`Button` ZaUI song song DS v2** — MỚI
- Bằng chứng: `components/product-card.tsx` chỉ `pages/wishlist.tsx` dùng; `Sheet` ZaUI 22 lần import vs `components/ui/bottom-sheet.tsx`; `Button` ZaUI 42 lần vs `components/ui/button.tsx`.
- Tác động: wishlist trông khác thẻ ở Home/Browse; hai kiểu sheet có hành vi đóng/animation khác nhau.
- Đề xuất: wishlist dùng `ProductTile`; thay `Sheet` bằng `BottomSheet` theo lô; xoá `product-card.tsx`.
- Kiểm chứng: `grep -rn "components/product-card" apps/miniapp/src` rỗng.
- M · sonnet · `apps/miniapp/src/pages/wishlist.tsx`, `components/product-card.tsx`, các file dùng `Sheet`

**A4-021 · P2 · Định dạng số không nhất quán** — MỚI
- Bằng chứng: `screens/miniapp/game__normal__390.png` ("1250000", "65.000 xu", "89000"); Home "1280 điểm Xanh" (`home__error__390.png`) vs Profile "1.280 điểm"; `order-detail.tsx:205,301,405` dùng `toLocaleString('vi-VN')` trực tiếp thay vì `utils/format.ts`; `pages/game.tsx:109-204,493,556-634`.
- Tác động: giá/điểm khó đọc, trông thiếu cẩn thận.
- Đề xuất: mọi số tiền/điểm/xu đi qua `utils/format.ts`; thêm luật ESLint cấm `toLocaleString` trong pages.
- Kiểm chứng: `grep -rn "toLocaleString" apps/miniapp/src/pages | wc -l` → 0; ảnh `game`.
- S · haiku · `apps/miniapp/src/pages/{game,home,order-detail}.tsx`

**A4-023 · P2 · "Mua lại" ở Home không dẫn tới giỏ (5 chạm)** — MỚI
- Bằng chứng: `components/reorder/purchased-rail.tsx:49,88,93` không truyền `navigateToCart`; `orders.tsx:119`, `order-detail.tsx:709` có truyền.
- Tác động: luồng "mua lại" chính của khách cũ dài hơn đường PDP (3 chạm) 2 chạm; khách thêm xong tưởng đã đặt.
- Đề xuất: truyền `navigateToCart` hoặc thêm "Xem giỏ" trong snackbar xác nhận.
- Kiểm chứng: e2e Home "Mua lại" → URL `/cart`.
- S · sonnet · `apps/miniapp/src/components/reorder/purchased-rail.tsx`

**A4-024 · P2 · Form địa chỉ luôn trống: khách mới đặt đơn đầu mất ≈12 chạm** — MỚI
- Bằng chứng: `apps/miniapp/src/components/address-form.tsx:16-18` `EMPTY_FORM`; địa chỉ chiếm 8/12 chạm (mục 5).
- Tác động: điểm rơi lớn nhất của khách mới ngay trước thanh toán.
- Đề xuất: điền sẵn tên/SĐT từ hồ sơ Zalo (cần `getUserInfo`/`getPhoneNumber` đã cấp quyền), nhớ Tỉnh gần nhất. Xem quyết định D5.
- Kiểm chứng: đếm lại luồng 1 ≤ 8 chạm.
- M · sonnet · `apps/miniapp/src/components/address-form.tsx`, `components/checkout/address-section.tsx`

**A4-025 · P2 · CTV lên đơn hộ: nhập tay toàn bộ, đường vào sâu, nút còn màu v1** — MỚI
- Bằng chứng: `pages/affiliate.tsx:488-496` (nút `var(--primary-600)`), `components/affiliate/ctv-order-sheet.tsx:205-218,283,306`; luồng 3 ≈ 13 chạm.
- Tác động: CTV lên nhiều đơn mỗi ngày nhưng mỗi đơn nhập lại địa chỉ.
- Đề xuất: "khách gần đây" tự điền, lối tắt "Lên đơn hộ" ở đầu `/affiliate` và trong tab Cá nhân.
- Kiểm chứng: đếm lại luồng 3.
- M · sonnet · `apps/miniapp/src/components/affiliate/ctv-order-sheet.tsx`, `pages/affiliate.tsx`

**A4-026 · P2 · Trang `game` quá dài, không điều hướng nội bộ, nhiều alias/emoji** — MỚI
- Bằng chứng: `screens/miniapp/game__normal__390.png` (≥12 khối, ảnh bị cắt ở 3.200px); `static-scan` `game.tsx`: 163 alias, 107 emoji; TB điểm 2,6.
- Tác động: người chơi không tìm được tính năng; tab giữa của thanh điều hướng nhưng trang kém "premium" nhất.
- Đề xuất: chia theo tab/chip neo ("Hôm nay / Cây / Mùa / Cộng đồng") và gộp khối ít dùng; token hoá màu.
- Kiểm chứng: ảnh `game` ≤ 2 màn đầu chứa hành động chính; `static-scan` alias = 0.
- L · opus (phân nhóm nội dung) · `apps/miniapp/src/pages/game.tsx`

**A4-027 · P2 · Admin web: 19 tab trong một trang 2.714 dòng, tab bị cuộn ngang ở 390px không gợi ý** — MỚI
- Bằng chứng: `apps/web/src/app/admin/page.tsx:116-136` (19 tab), ảnh `web/admin-orders__error__1440.png` (tab "Đơn hàng" là tab thứ 5, hàng tab cắt ở "Tích điểm tại quầy").
- Tác động: khó dùng trên điện thoại, khó bảo trì; số chạm luồng 4 phụ thuộc cuộn.
- Đề xuất: tách mỗi tab thành route con (`/admin/orders`) + menu bên; gộp nhóm (Vận hành / Đối tác / Nội dung / Cấu hình).
- Kiểm chứng: `ls apps/web/src/app/admin` có thư mục theo tab.
- L · sonnet · `apps/web/src/app/admin/**`

**A4-028 · P2 · Chia sẻ lỗi bị nuốt im lặng** — MỚI
- Bằng chứng: `components/share-sheet.tsx:63` `.catch(() => {})`; `pages/affiliate.tsx:282-285` `.catch(() => {})`.
- Tác động: CTV bấm "Chia sẻ" mà không có gì xảy ra khi API Zalo từ chối — mất đơn hoa hồng.
- Đề xuất: snackbar "Chưa chia sẻ được, thử lại" + sao chép liên kết dự phòng.
- Kiểm chứng: test mock `shareLink` reject → có snackbar.
- S · haiku · `apps/miniapp/src/components/share-sheet.tsx`, `pages/affiliate.tsx`

**A4-029 · P2 · Vùng cuộn ngang không focus được và không gợi ý cuộn** — MỚI
- Bằng chứng: axe `scrollable-region-focusable` ×16 trên 9 trang (`home` 2, `feed` 5, `product-detail` 2…); `orders-subscriptions__normal__390.png` hàng chip cắt ("Đang gi…"); dải "Mua lại" ở Home cắt thẻ thứ 3.
- Tác động: người dùng bàn phím/AT không tới được nội dung; khách không biết còn thẻ ở bên phải (cắt giữa thẻ là gợi ý có sẵn, nhưng chip row không có).
- Đề xuất: `tabIndex=0` + `role="region"` + `aria-label` cho vùng cuộn; thêm mờ dần ở mép.
- Kiểm chứng: axe `scrollable-region-focusable` = 0.
- S · sonnet · `apps/miniapp/src/components/ui/segmented-tabs.tsx`, `components/home/**`

### P3

**A4-030 · P3 · Merchant web chuyển tab bằng state, không có URL** — MỚI. Bằng chứng: `apps/web/src/app/merchant/page.tsx:180,255`. Tác động: không chia sẻ/đánh dấu/reload về đúng tab. Đề xuất: `?tab=`. Kiểm chứng: reload giữ tab. S · haiku · `apps/web/src/app/merchant/page.tsx`

**A4-031 · P3 · Emoji dùng làm icon ngoài game/hạng** — MỚI. Bằng chứng: `onboarding.tsx` 22, `reviews-section.tsx` 12, `community/post-card.tsx` 9, `bank-payment.tsx` 7, `brand-view.tsx` 7, `wallet.tsx` 6, `post-detail.tsx` 6, `i18n/vi.ts` 35. Tác động: hiển thị khác nhau theo thiết bị, lệch quy ước "icon = Lucide". Đề xuất: thay bằng `Icon` Lucide, giữ emoji cho game/hạng. Kiểm chứng: `static-scan` emoji của các file này = 0. S · haiku · các file trên.

**A4-032 · P3 · Trang 404: tiêu đề đè lên hình minh hoạ** — MỚI. Bằng chứng: `screens/miniapp/not-found__normal__390.png`. Tác động: nhìn lỗi layout ở trang hiếm gặp. Đề xuất: tăng khoảng cách hình–tiêu đề. Kiểm chứng: chụp lại. S · haiku · `apps/miniapp/src/pages/not-found.tsx`

**A4-033 · P3 · Mũi tên bằng ký tự "›"** — MỚI. Bằng chứng: `pages/settings.tsx:223-225`. Đề xuất: icon `ChevronRight` của `ListRow`. S · haiku · `pages/settings.tsx`

**A4-034 · P3 · Thiếu `<main>` và `<h1>` ở 34/41 trang Mini App; web 3 trang không h1** — MỚI. Bằng chứng: axe `landmark-one-main` 41/41, `page-has-heading-one` 34/41; Web `tai-khoan`, `dang-nhap/callback`, `merchant-denied`. Đề xuất: `PageHeader` render `<h1>`, vỏ `Page` render `<main>`. Kiểm chứng: axe hai luật này = 0. S · sonnet · `apps/miniapp/src/components/ui/page-header.tsx`

**A4-035 · P3 · Thứ tự heading sai ở 12 màn web** — MỚI. Bằng chứng: axe `heading-order` ×12 (`home`, `admin-config`, `admin-flashSales`, `merchant-1…5`…). Đề xuất: chỉnh cấp heading. S · haiku · `apps/web/src/app/**`

**A4-036 · P3 · Tailwind preflight áp dụng toàn cục** — CÒN MỞ từ followups. Bằng chứng: không có `preflight:false` trong `apps/miniapp/tailwind.config.ts`, `apps/web/tailwind.config.ts`. Tác động: reset có thể ghi đè kiểu ZaUI. Đề xuất: đánh giá `corePlugins.preflight:false` + reset riêng. Kiểm chứng: so ảnh trước/sau trên 5 trang. M · sonnet · `apps/miniapp/tailwind.config.ts`

**A4-037 · P3 · Lỗi console khi chụp (có thể do mock)** — MỚI, nguyên nhân chưa kiểm chứng. Bằng chứng: Mini App `game` 4, `beta` 3, `admin` 3; Web `admin-dealers` 4, `admin-config` 3, `merchant-2` 1 (`results/*.jsonl` trường `errors`). Đề xuất: đọc `errors` để tách lỗi do mock với lỗi thật. S · haiku · không sửa mã.

**A4-038 · P3 · Chữ <12px nhiều** — MỚI. Bằng chứng: web `home` 86, `admin-posCredits` 26; Mini App `brand-story` 29, `order-detail` 20, `product-detail` 17, `home` 16. Đề xuất: sàn 12px cho chữ phụ. S · haiku · các file trên.

**A4-039 · P3 · `ErrorBoundary` dùng màu thô và nút nhỏ** — MỚI. Bằng chứng: `components/error-boundary.tsx:78,88` `#1a1a1a`, `#16a34a`, `padding 10px 28px`. Tác động: màn lỗi nghiêm trọng khác hẳn DS (xanh lục Tailwind). Đề xuất: dùng token + `Button`. S · haiku · `components/error-boundary.tsx`

**A4-040 · P3 · Admin web dùng hộp thoại `window.confirm` gốc** — MỚI. Bằng chứng: `apps/web/src/app/admin/page.tsx:865,882,1307`. Tác động: không đồng bộ giao diện, không tuỳ biến câu chữ/nút. Đề xuất: dialog DS. S · haiku · `apps/web/src/app/admin/page.tsx`

**A4-022 · P3 · Lịch sử vận chuyển in nguyên chuỗi `status` của hãng vận chuyển** — MỚI. Bằng chứng: `apps/miniapp/src/pages/order-detail.tsx:186,401` (`journey` lấy từ `o.shippingHistory`, in `{ev.status ?? '—'}`; nhãn đã dịch có sẵn ở `i18n/vi.ts:267-275` `orderStatus` nhưng không dùng cho dòng này). Tác động: nếu nguồn trả mã/tiếng Anh khách sẽ thấy mã; giá trị thực tế khi chạy **chưa kiểm chứng** (mock trả chuỗi tiếng Việt). Đề xuất: ánh xạ qua bảng nhãn, rơi về `ev.code`/"Đang cập nhật" thay vì "—". Kiểm chứng: test `order-detail` với `status:'delivering'`. S · haiku · `apps/miniapp/src/pages/order-detail.tsx`


## 8. Quyết định nghiệp vụ cần chủ dự án

Phương án đầu tiên là phương án khuyến nghị.

| # | Câu hỏi | Phương án | Lý do |
|---|---|---|---|
| D1 | Chủ nhãn có được tự xem đơn và doanh thu của nhãn mình không? (A4-001) | (1) Có: tab chỉ-đọc trong `/brand-owner`, lọc theo nhãn, ẩn tên/SĐT khách, chỉ hiện số đơn/doanh thu/sản phẩm bán chạy; (2) Gửi báo cáo tuần qua Zalo OA; (3) Không, quản trị gửi tay | Chủ nhãn là đối tác bán hàng, báo cáo chủ động giảm việc cho quản trị; ẩn PII tránh vấn đề dữ liệu cá nhân. Cần chủ dự án chốt phạm vi dữ liệu được xem. |
| D2 | Web có cần đồng bộ diện mạo với Mini App (xanh rừng + Fraunces) không? (A4-003) | (1) Có, làm trước các trang khách (`/`, `/san-pham`, `/gio-hang`, `/thanh-toan`, `/tai-khoan`, `/s`), admin để sau; (2) Giữ cam/lá v1 cho web và chấp nhận hai diện mạo; (3) Thu hẹp web thành trang đích dẫn vào Mini App | Khách vào từ link CTV thấy Web trước nên nó quyết định ấn tượng thương hiệu; admin là công cụ nội bộ, không cần gấp. |
| D3 | Thông tin liên hệ thật cho trang "Về Tubu Tree & Hỗ trợ"? (A4-008) | (1) Cung cấp hotline, Zalo OA, email thật (lưu `app_config` để admin sửa); (2) Ẩn các dòng chưa có đến khi có | Số giả gây gọi nhầm; chỉ chủ dự án biết kênh hỗ trợ thật. |
| D4 | Chốt thuật ngữ tiền tệ nội bộ (A4-019) | (1) "Tubu Xu" (đang dùng ở `utils/format.ts`, `affiliate`), voucher = "Mã ưu đãi", điểm = "Điểm Xanh", điểm cộng đồng = "Điểm uy tín"; (2) "xu Tubu" viết thường; (3) Giữ như hiện tại | Một tên duy nhất cho mỗi loại giảm hiểu nhầm giữa xu (tiêu trong app) và điểm; phương án 1 ít đổi nhất. |
| D5 | Có xin quyền Zalo (tên + số điện thoại) để tự điền địa chỉ không? (A4-024) | (1) Có, xin ở bước đặt đơn đầu tiên; (2) Chỉ nhớ tỉnh/phường lần trước; (3) Giữ form trống | Giảm khoảng 3–4 chạm cho khách mới; cần Zalo duyệt quyền và nói rõ mục đích sử dụng. |
| D6 | Có bỏ chặn phóng to (`user-scalable=no`) không? (A4-004) | (1) Bỏ chặn; (2) Giữ chặn chỉ ở màn Vòng quay/Game | Chặn phóng to vi phạm WCAG 1.4.4 và ảnh hưởng người lớn tuổi; game có thể dùng `touch-action` riêng thay vì chặn toàn app. |
| D7 | Admin web có cần dùng được trên điện thoại không? (A4-027, A4-009) | (1) Chỉ máy tính (tối ưu bảng, bỏ ràng buộc 44px); (2) Hỗ trợ điện thoại cho các tab Đơn hàng/Đổi trả/Rút tiền | Quyết định phạm vi công sức: 19 tab hiện toàn nút nhỏ; duyệt đơn và rút tiền ngoài văn phòng là nhu cầu thật nhất. |

## 9. Giới hạn và môi trường

- **3 trang Mini App không chụp được**: `/loyalty`, `/brand/:slug`, `/s/:slug` — Vite dev (cổng 3113, của chủ máy) trả HTTP 504 "Outdated Optimize Dep" cho phụ thuộc `qrcode` (qua `components/qr-code.tsx`/share). Không được phép khởi động lại Vite nên điểm của 3 trang chỉ chấm token theo mã (`loyalty` 150 alias, `brand-view`/`storefront-view` sạch). Đã xoá 30 bản ghi/ảnh lỗi của 3 trang này khỏi `results/miniapp.jsonl` và `screens/miniapp`.
- **Dữ liệu mock**: toàn bộ `/api/*` được mock theo kiểu TypeScript (`scripts/uiux/lib/fabricate.mjs`); chỉ GET catalog/config đọc API local. Tên, giá, ảnh sản phẩm là giữ chỗ (ô chữ cái "TR/TT") nên không đánh giá được ảnh thật, độ dài chữ thật, hay hành vi khi API chậm. Trang web SSR (`/`, `/san-pham`, `/brand`) gọi API từ server nên không mock được bằng `page.route` — chúng hiển thị dữ liệu thật từ API local :3001.
- **Điểm mù của chỉ số tap** (mục 3) và `nested-interactive` (axe chỉ chọn một vài nút/trang).
- **Điểm thủ công** (thứ bậc/CTA/copy/premium) có sai số ±1; chưa có khảo sát người dùng thật.
- **Đếm bước từ mã nguồn**, chưa chạy E2E trên Zalo thật; lớp phủ quyền Zalo (đăng nhập/lấy SĐT) không mô phỏng được.
- **Web `next lint` không chạy**: RAM máy thấp (khoảng 0,4–1,3 GB trống, WSL 2,2 GB, tác tử khác đang `next start`) nên chỉ chạy lệnh nhẹ; chỉ Mini App có ESLint.
- Giữ 1 Chromium, 1 context tại một thời điểm; không đụng API :3001, Vite :3113, Next :3112, PROD hay dịch vụ ngoài. Không sửa mã `apps/**`/`packages/**`; chỉ ghi vào `docs/2026-10-review/` và `scripts/uiux/`.
- **Sửa công cụ giữa chừng**: lần chụp đầu đo quá sớm (trang chưa tải xong) → thêm vòng chờ nội dung ổn định, xoá kết quả của chính mình và chụp lại toàn bộ; `staff` từng sập do chuỗi ngày giả (`approvedStart/End`) → sửa `fabricate.mjs`, chụp lại `staff`.
- Dung lượng ảnh `docs/2026-10-review/screens` ≈ 90 MB (554 PNG); cân nhắc không commit hoặc nén (không commit trong nhiệm vụ này).
- Tài liệu `docs/audit-2026-09/*` và `docs/2026-10-review/0[1-3,5-6]-*.md` (nhiệm vụ song song) chưa được đối chiếu từng mục; chỉ đối chiếu `design-system-v2-followups.md`.


## Kiểm chứng độc lập (verifier)

Ngày 2026-10-09, commit `080bc75`. Verifier đọc lại mã và chạy lại lệnh nhẹ: `node scripts/uiux/static-scan.mjs` (cho cùng số: Mini App 1.616 alias legacy, web 227/841/416/0 v2), tính lại tỉ lệ tương phản bằng công thức WCAG, đọc lại `scripts/uiux/results/{miniapp,web}.jsonl` (số đếm axe và tap), đọc mã API `order-transition.ts`. Không chạy lại Playwright. Báo cáo không có P0; kiểm hết 9 mục P1.

| ID | Phán quyết | Bằng chứng | Mức đề xuất |
|---|---|---|---|
| A4-001 | XÁC NHẬN (là thiếu tính năng, không phải lỗi) | `brand.controller.ts` chỉ có `public/:slug`, `:slug/follow*`, `owner/me` (GET/PATCH), `owner/me/promotions` (CRUD), không có endpoint đơn/doanh thu; `grep -ci "doanh thu\|đơn hàng" brand-owner.tsx` = 0; web không có route nhãn hàng. | P2 (tính năng mới cần quyết định D1, không làm gãy luồng đang có) |
| A4-002 | XÁC NHẬN | Chạy lại `static-scan.mjs`: 30/40 file trang có alias legacy, tổng 1.616; `game.tsx` 163, `loyalty.tsx` 150. Khối alias `css/tokens.css:25-30` tự ghi "TẠM THỜI", nên đây là nợ đã biết có chủ đích. Khẳng định "ô-liu lệch xanh rừng" chưa kiểm chứng bằng ảnh (chỉ thấy `--leaf-600: var(--sage-600)` ở `tokens.css:77`). | P2 (nợ thiết kế, không chặn giao khách) |
| A4-003 | XÁC NHẬN | `apps/web/tailwind.config.ts:24-33` palette v1 cam `#E08C1C`; `app/page.tsx:22` gradient `from-leaf-900 via-leaf-800 to-primary-900`, `:48` CTA `bg-primary-600 text-white`; scan web: 0 lớp v2. Nhãn "MỚI" chưa đúng: file cấu hình ghi "parity with prod, not a redesign" nên là quyết định có chủ đích đang chờ dự án redesign. | P1 giữ nguyên chỉ khi chủ dự án muốn đồng bộ thương hiệu; nếu không thì P2 |
| A4-004 | XÁC NHẬN | `apps/miniapp/index.html:7` có `maximum-scale=1.0, user-scalable=no`; axe `meta-viewport` 41/41 trang trong `miniapp.jsonl`. Chưa kiểm chứng việc WebView Zalo có tôn trọng thuộc tính này hay không (iOS Safari đã bỏ qua từ iOS 10). | P2 (sửa 1 dòng, tác động thực tế chưa chắc) |
| A4-005 | XÁC NHẬN MỘT PHẦN | Số đếm khớp dữ liệu axe: `button-name` 7 (feed 1, refill 2, my-payroll 2, staff 2), `label` 12 (checkout 6, edit-profile 3, brand-owner 3), `aria-toggle-field-name` 3 (settings), `select-name` 9 và `label` 10 trên web. Nhưng ở `checkout.tsx:433` và `settings.tsx:132` phần tử cha `role="radio"`/`"switch"` có tên lấy từ nội dung con; chỉ `<input>` ZaUI bên trong thiếu nhãn, nên câu "trình đọc màn hình không đọc được trang thanh toán" là phóng đại. Switch ở `settings.tsx:132` đúng là không có tên (nhãn là `Text` anh em, nằm ngoài). | P2 (lỗi a11y thật nhưng có đường vòng) |
| A4-006 | XÁC NHẬN | Tính lại: `#9E978A` trên `#FFF` 2,90:1, trên `#F6F4EF` 2,64:1; trắng trên `#E08C1C` 2,65:1; `#A8A8A0` trên trắng 2,39:1; trắng trên `#16A34A` 3,30:1; `#B86A10` 4,11:1 (khớp báo cáo, lệch 0,01 do làm tròn). `tokens.css:28,99` `--color-text-disabled: var(--stone-400)`; `product-tile.tsx:174,179` `tone="disabled"`; axe `color-contrast` 29 trang 131 nút (miniapp.jsonl). CTA trắng-trên-cam ở `app/page.tsx:48` đúng. | P1 giữ nguyên |
| A4-007 | BÁC BỎ phần tác động tiền; giữ phần UI | UI đúng như mô tả (`admin/page.tsx:835` "Xác nhận" hiện ở PACKED/SHIPPING/RETURNED). Nhưng API đã chặn: `order-transition.ts:38-44` bảng chuyển chỉ cho đi tới, `SHIPPING→CONFIRMED` không có trong bảng; `order-status.service.ts:73` gọi `assertTransition` và `admin.service.ts:437` đi qua `OrderStatusService.setStatus` (lỗi trả 400 qua `toHttpBadRequest`). Nên không thể lùi trạng thái hay kích hoạt điểm/hoa hồng sai thứ tự từ các nút này; còn lại chỉ là nút hiển thị rồi báo lỗi 400. Mục "chưa kiểm chứng phía API" của báo cáo nay đã có đáp án. | P3 |
| A4-008 | XÁC NHẬN, đổi trạng thái | `about.tsx:181-183` vẫn là `1900 1234 (8h–21h)`, `Tubu Tree Official`, `hotro@tubutree.com`. Không phải "MỚI": CÒN MỞ từ `docs/audit-2026-09/01-ia-navigation.md:350` (A1-17) và `00-MASTER-SUMMARY.md:292`. Không xác minh được số có thật hay không (cần chủ dự án). | P1 giữ nguyên; trạng thái sửa thành CÒN MỞ từ audit-2026-09 A1-17 |
| A4-009 | XÁC NHẬN | `miniapp.jsonl` @390 normal: cart 13/23, storefront-builder 64/100, feed 26/35, dealer 20/23, about 14/16, brand-owner 12/24, home 12/97; web gio-hang 19/20, thanh-toan 11/16, home 14/44. Nút tăng/giảm số lượng ở giỏ đo 36x36 (`quantity-selector.tsx` dựng `Box role="button"` với `className` chỉ `tubu-press`, không có `hit-44`). Điểm mù đo đã được báo cáo tự nêu. | P1 giữ nguyên cho cart, checkout và storefront-builder; P2 cho phần admin web |

Tóm tắt: 9 mục P1 kiểm; XÁC NHẬN 6 (A4-002, A4-003, A4-004, A4-006, A4-008, A4-009), XÁC NHẬN MỘT PHẦN 1 (A4-005), BÁC BỎ phần tác động 1 (A4-007), XÁC NHẬN nhưng là tính năng 1 (A4-001); LỖI THỜI 0; CHƯA RÕ 0. Đề xuất đổi mức: A4-001 P1→P2, A4-002 P1→P2, A4-004 P1→P2, A4-005 P1→P2, A4-007 P1→P3. Lưu ý: lần chạy lại `static-scan.mjs` đã ghi đè `scripts/uiux/results/static-scan.json` với nội dung cùng số liệu.
