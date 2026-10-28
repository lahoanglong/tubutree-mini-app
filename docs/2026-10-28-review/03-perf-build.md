# 03. Kích thước bản build và quét hiệu năng tĩnh

Ngày đo: 2026-10-28, nhánh `review/2026-10-28` (main 9d0e95bd5). Chỉ đo và đọc mã, không sửa sản phẩm.
Chạy lại số đo: `node docs/2026-10-28-review/tools/perf/bundle-report.mjs [--build-miniapp] [--build-web] [--only=miniapp|web]` (từ gốc repo, PATH có Node 22; in JSON). Dùng để so trước/sau từng gói sửa.

## 1. Mini App (`apps/miniapp/www`)

Lệnh: `VITE_API_BASE_URL=https://api.tubutree.com/api vite build` rồi `node scripts/ci/bundle-budget.cjs apps/miniapp/www`.
Ghi chú: script `build` của package chạy thêm `tsc --noEmit` trước `vite build`; đã bỏ bước đó (chỉ đo kích thước). Build lần đầu không đặt `VITE_API_BASE_URL` bị chặn đúng như `src/build-env.ts` thiết kế.

| Chỉ số | Raw | Gzip |
|---|---:|---:|
| Entry `assets/index.Birii4Y3.module.js` | 711 KB | 222 KB |
| Tổng JS (142 file) | 1624 KB | 558 KB |
| CSS (2 file) | 128 KB | 21 KB |
| Ảnh và font (7 file) | 158 KB | 158 KB |
| Tất cả (153 file) | 1911 KB | 737 KB |

So ngưỡng (`scripts/ci/bundle-budget.cjs`):
- Entry 711 KB > ngưỡng cảnh báo 700 KB (vượt 11 KB) và > mục tiêu 450 KB (vượt 261 KB). Script in cảnh báo `::warning`.
- Tổng 1911 KB < ngưỡng 2048 KB (còn 137 KB).
- Giới hạn dung lượng gói của Zalo: chưa kiểm (đúng như script ghi).

10 file lớn nhất (raw / gzip):
1. `assets/index.Birii4Y3.module.js` 711 / 222 KB (entry)
2. `assets/index-DoUGtdrf.css` 127 / 21 KB
3. `assets/game.jrxeugFZ.module.js` 58 / 17 KB
4. `assets/affiliate.DBBcCmhk.module.js` 45 / 14 KB
5. `assets/checkout.9LWwsEBv.module.js` 44 / 13 KB
6. `assets/product-detail.I3C5h_yn.module.js` 39 / 12 KB
7. `assets/storefront-builder.CFWrLFgi.module.js` 39 / 11 KB
8. `assets/order-detail.DUk5cheQ.module.js` 33 / 11 KB
9. `assets/dealer.USVPElwp.module.js` 31 / 10 KB
10. `assets/qr-code.C9hEjEaK.module.js` 25 / 10 KB

Route lazy hay trong entry (đọc `apps/miniapp/src/components/app.tsx`):
- Trong entry: chỉ `/` (`HomePage`, app.tsx:6 import tĩnh). Kéo theo `pages/about-data.ts`, `settings-notify-prefs.ts`, `settings-legacy-sync.ts` (app.tsx:24 import tĩnh `useLegacyNotifyPrefsSync`).
- Lazy (`lazy(() => import(...))`, app.tsx:46-95): 50 trang, gồm browse, product-detail, cart, checkout, orders, order-detail, game, recycle*, rewards*, profile, loyalty, offers, wallet, affiliate, dealer, storefront-*, admin, staff...
- Vẫn nằm trong entry dù không phải route: `components/onboarding.tsx` (10,6 KB), `coupon-claim-gate.tsx` (7,6 KB), `open-app-router.tsx`, `bottom-nav`, `flash-sale.tsx` (9,8 KB), `purchased-rail.tsx` (8,1 KB), `subscribe-sheet.tsx` (6,3 KB), toàn bộ `i18n/vi.ts` (35,7 KB), `services/*-api.ts`. Các khối trang chủ (`components/home/*`) đều tĩnh.

Thành phần entry theo gói (KB rendered, trước nén): app src 360, react-dom 133, zmp-sdk 128, zmp-ui 102, @tanstack/query-core 76, @react-spring/core 47, @use-gesture/core 38, resize-observer-polyfill 33, @remix-run/router 32, lucide-react 29, react-transition-group 21, react-router 20. Hạ entry xuống 450 KB cần bớt 261 KB: chỉ riêng app src (360 KB) không đủ nếu giữ nguyên thư viện; phần thư viện khung (~640 KB) là lõi zmp-ui/zmp-sdk/react. Lưu ý: tách vendor ra chunk riêng sẽ qua được kiểm tra "entry lớn nhất" nhưng không giảm số byte tải lần đầu.

Font: 4 file Inter + 2 file Fraunces woff2 (Fraunces 500/600 mỗi file ~19 KB), logo trang chủ PNG 14 KB.

## 2. Web (`apps/web`, `next build`)

Lệnh: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3251/api API_BASE_URL=http://localhost:3251/api next build`. Build thành công khi API lane 5 chưa chạy (không cần API lúc build; trang ISR render ra phần khung). Thư mục `apps/web/.next` giữ nguyên cho `next start`. Log bảng route lưu ở `apps/web/.next/bundle-report-next-build.log`. Cảnh báo duy nhất: `react-hooks/exhaustive-deps` ở `src/components/ui/segmented-tabs.tsx:28` (thiếu dep `ref`).

First Load JS (gzip, số của chính Next):

| Route | Riêng route | First Load JS |
|---|---:|---:|
| `/` | 177 B | 204 KB |
| `/san-pham` | 15,9 KB | 157 KB |
| `/san-pham/[slug]` | 26,8 KB | 174 KB |
| `/gio-hang` | 8,3 KB | 163 KB |
| `/thanh-toan` | 19,8 KB | 191 KB |
| `/tai-khoan` | 21,1 KB | 170 KB |
| `/tai-khoan/diem-xanh` | 12,6 KB | 179 KB |
| `/tai-khoan/don-hang` | 13,5 KB | 184 KB |
| `/tai-khoan/don-hang/[code]` | 19,4 KB | 191 KB |
| `/uu-dai` | 7,24 KB | 165 KB |
| `/vuon-xanh` | 27,9 KB | 169 KB |
| `/doi-rac` | 5,7 KB | 166 KB |
| `/kho-qua` | 9,11 KB | 153 KB |
| `/mua-chung` | 156 B | 156 KB |
| `/dang-nhap` | 5,25 KB | 142 KB |
| `/admin` (nhân sự) | 187 KB | 356 KB |

Dùng chung mọi trang: 103 KB (`chunks/b7e0a1e7-…` 54,2 KB + `chunks/2309-…` 47 KB gzip). Middleware 35,1 KB. Trung vị First Load của 62 route có JS: 155 KB.
Chunk lớn nhất (raw): `app/admin/page` 774 KB (gz 181), `chunks/5750.*` 332 KB (gz 111; là SDK lỗi Sentry, nạp qua `import('./sentry-client')` lúc rảnh trong `src/lib/error-report.ts:12`, không nằm trong First Load), `framework-*` 214 KB, `2309-*` 171 KB, `b7e0a1e7-*` 169 KB, `main-*` 126 KB, `polyfills-*` 110 KB.
`/` nặng nhất trong trang khách (204 KB) dù mã riêng chỉ 177 B: toàn bộ khối trang chủ nằm trong chunk dùng chung với layout và nhiều chunk con (27 file JS theo manifest).

## 3. Phát hiện tĩnh

Mã phát hiện đánh số P-xx (perf, đợt 1028). Mức: NẶNG, VỪA, NHẸ.

### Ảnh

**P-01 NẶNG. Ảnh sản phẩm không qua biến đổi kích thước.**
- Màn: mọi lưới/thẻ sản phẩm (Trang chủ, Danh mục, Giỏ, Mua lại), Mini App và web, khổ 375px.
- Bằng chứng: URL ảnh đi từ DB ra thẳng, `apps/api/src/common/public-image.ts:29` (`if (!value.startsWith('data:')) return value;`). Web đặt `images: { unoptimized: true }` (`apps/web/next.config.mjs:78`). Đo 8 ảnh `thumbnail` đầu của `GET https://api.tubutree.com/api/products?limit=12` (host `content.pancake.vn`): 169, 77, 112, 83, 88, 69, 777, 493 KB, tổng 1868 KB cho 8 thẻ, trong khi thẻ hiển thị ~160px. Ảnh 777 KB và 493 KB là gốc, không phải thumb.
- Nơi vẽ: `apps/miniapp/src/components/ui/product-image.tsx:53`, `apps/miniapp/src/components/ui/product-thumb.tsx:33-40`, `apps/web/src/components/mini/product-image.tsx:78-90`, `apps/web/src/components/mini/product-thumb.tsx:37-44`. Không có `srcset`/`sizes`.
- Hướng: cần lớp đổi cỡ (ví dụ proxy ảnh ở API hoặc tham số của host nguồn) hoặc `next/image` với `remotePatterns`; chưa kiểm host Pancake có hỗ trợ tham số cỡ. Ảnh Cloudinary (upload của khách/nhãn) cũng chưa gắn `w_`/`f_auto` (grep không thấy ở `apps/`).

**P-02 VỪA. `<img>` không có width/height hay aspect-ratio (gây CLS).**
- `apps/web/src/app/cong-dong/[id]/page.tsx:316` (`w-full`, `loading=lazy`, không chiều cao), `apps/web/src/app/cong-dong/su-kien/page.tsx:78` (`max-h-44 w-full`), `apps/web/src/components/community/public-preview-list.tsx:47` (`max-h-56 w-full`): ảnh bài đăng, chiều cao chỉ biết sau khi tải, đẩy nội dung bên dưới.
- Chat CSKH: `apps/web/src/components/support-chat/message-list.tsx:56` và `apps/miniapp/src/components/support-chat/message-list.tsx:56` (`maxWidth: 100%`, không kích thước); khung chat tự cuộn nên CLS nhẹ.
- Đã ổn (không CLS): thẻ sản phẩm và `ProductThumb` có khung cố định (`position:relative`/`width,height` của hộp cha); `product-gallery.tsx:75` có 800x800; ảnh bìa gian hàng/nhãn có `h-*` cố định (`s/[slug]/page.tsx:92`, `brand/[slug]/page.tsx:51`); ảnh đánh giá 64x64.

**P-03 NHẸ. Thiếu `loading="lazy"` ở ảnh trong danh sách.**
- `apps/web/src/app/tai-khoan/ho-so/page.tsx:198`, `apps/web/src/app/tai-khoan/page.tsx:217` (avatar, ở đầu trang nên chấp nhận được), `apps/web/src/components/mini/tiles.tsx:32` (ô gian hàng/danh mục, không lazy), `apps/web/src/components/account/*`. Phần lớn ảnh danh sách khác đã lazy. Ảnh đầu trang chi tiết web đặt `eager`+`fetchPriority=high` đúng (`product-gallery.tsx:81-82`).

### N+1 ở API

Chạy `docs/2026-10-20-uat/tools/perf/nplus1-scan.py` và `nplus1-scan2.py` trên `apps/api/src`, lọc module catalog, cart, checkout, orders, flash-sale, loyalty. Đọc mã từng dòng:
- `cart/cart.service.ts:438` (upsert theo dòng trong transaction): cố ý, sắp theo `variationId` để tránh deadlock (comment dòng 435-436). Số dòng = số SP thêm. Không phải N+1 đọc.
- `flash-sale/flash-sale.service.ts:227` (`UPDATE ... soldCount` từng dòng), `:285` (`flashSalePurchase.create`): cố ý, tuần tự theo `flashSaleItemId` để khoá ổn định.
- `checkout/checkout.service.ts:488, 591, 660` (mỗi `shipment` một lần tạo đơn/điểm/analytics), `:1201` (mỗi nhóm một `calcPointsEarned`), `:1273` (mỗi nhóm một `calcShippingFee`/`freeShipThreshold`): số vòng bằng số nhóm giao (thường 1-2). Các lời gọi cấu hình (`SystemConfigService.get`) có cache 60 giây (`system-config/system-config.service.ts:51-59`) nên không ra DB mỗi vòng.
- Giỏ `cart.service.ts:108-` (`priceCart`): một `findUniqueOrThrow` có include lồng, `flashSale.resolveEffective` một `findMany` theo `variationId in`. Không N+1.
- Chi tiết SP `catalog.service.ts:324-`: một `findUnique` có include (variations, brandRef, reviews take 20, storefront), thêm `fulfillerOf` chỉ đọc config (cache). Không N+1.
- Đơn hàng `orders/orders.service.ts:189-202`: `findMany` có `include: { items: true }` + `attachItemMedia` (gom theo lô). Không N+1.
- Kết luận: không thấy N+1 đọc ở trang chủ, danh sách, chi tiết, giỏ, thanh toán, đơn hàng. Các vòng await còn lại là cron/xuất file/ghi theo thứ tự khoá.

**P-04 NẶNG. Danh sách sản phẩm sắp "Bán chạy"/giá/lọc giá nạp TOÀN BỘ catalog mỗi lượt gọi.**
- `apps/api/src/modules/catalog/catalog.service.ts:154-178` (nhánh `best_seller`, `price_asc/desc`, có `minPrice/maxPrice`) → `listRanked` `:212-247`: `product.findMany` không `take` kèm toàn bộ `variations` (`:222-228`), sắp xếp ở bộ nhớ, rồi mới truy vấn lại cho trang. Comment dòng 164 tự ghi "đủ nhanh với vài trăm SP; vượt ~5k SP chuyển sang cột soldTotal có index". Hiện PROD có 111 sản phẩm (`meta.total`). Chi phí tăng tuyến tính theo catalog × phân loại.
- Ai gọi: kệ "Bán chạy" trang chủ khách mới (`apps/miniapp/src/components/home/best-seller-rail.tsx:21-23`, `apps/miniapp/src/pages/home.tsx:58-64`, `packages/app-core/src/queries/home.ts:8`), tab Bán chạy của lưới gợi ý (`suggest-feed.tsx:26`), sắp xếp và lọc giá ở Danh mục. Là endpoint công khai, nhiều người gọi đồng thời.
- Số đo thời gian: chưa đo (phiên này không chạy API); chỉ có kết cấu truy vấn.

**P-05 NHẸ. `activeFlashOffers()` thêm 1 truy vấn mỗi lượt `listRanked`** (`catalog.service.ts:250-275`), không cache. Một `findMany` theo điều kiện, nhẹ.

### Render thừa và refetch

**P-06 VỪA. Truy vấn danh sách ở trang chủ/danh mục dùng `staleTime` mặc định 10 giây dù comment hứa 60 giây.**
- `apps/miniapp/src/services/query-client.ts:42-47`: mặc định 10 giây, comment nói "Catalog… override staleTime: 60_000 tại từng useQuery (xem browse.tsx/home.tsx)". Nhưng `best-seller-rail.tsx:22`, `home.tsx:59`, `suggest-feed.tsx:25-26` (cả `for-you` và `home-suggest`), `browse.tsx:79` (`products/browse` infinite) không có `staleTime`. Quay lại Trang chủ hoặc Danh mục sau >10 giây là gọi lại toàn bộ danh sách (kể cả `sort=best_seller` của P-04). `brands` và `flash-sales` thì có (60 giây, 30 giây).
- Web: `apps/web/src/lib/query-client.ts:12` không đặt `staleTime` (mặc định 0) nên mỗi lần mount lại trang là refetch; chỉ 65 chỗ đặt `staleTime` riêng so với ~201 `useQuery` ngoài admin/merchant (đếm bằng grep). Bù lại `refetchOnWindowFocus: false`. Ngoại lệ có chủ ý: kệ Bán chạy web dùng `initialData` + `staleTime: 60_000` (`apps/web/src/components/home/best-seller-rail.tsx:22`).

**P-07 NHẸ. Khung chờ dùng `key={i}`** (`category-row.tsx:30`, `best-seller-rail.tsx:53`, `catalog-grid.tsx:91`, `home-extras.tsx:79`, web `home-section.tsx:62`, `suggest-feed.tsx:71`): chỉ là skeleton, không đổi thứ tự, không ảnh hưởng. Danh sách thật dùng `key={p.id}` (ví dụ web `suggest-feed.tsx:82`). Còn `key={i}` ở nguyên liệu SP (`apps/miniapp/src/pages/product-detail.tsx:731`, mảng tĩnh) và chấm gallery (`:1050`): vô hại. Tổng 90 `key={i}` trong web+miniapp ngoài admin/merchant; chỉ đọc những nơi liệt kê trên.

Đã đọc và không phải vấn đề:
- Web `AuthProvider` (`apps/web/src/lib/auth-context.tsx:235`) tạo object `value` mới mỗi lần render, nhưng provider chỉ render lại khi state đổi (cha `Providers` không đổi), nên không gây render thừa thật.
- Mini App: `FlashSalesPoller` là chủ duy nhất của `refetchInterval` (`hooks/use-flash-sales-poller.ts`), mọi nơi khác chỉ đọc cache. `refetchOnWindowFocus` chỉ cho query đang lỗi tạm (`query-client.ts:41`). Effect gốc `app.tsx:142-159` đăng ký listener một lần (deps rỗng), nhưng không có cleanup (chỉ chạy 1 lần suốt vòng đời app, chấp nhận được).
- `queryClient.clear()` khi đăng xuất đã có (`app.tsx:100`).

## 4. Năm phát hiện nặng nhất (xếp hạng)

1. P-01: ảnh sản phẩm không đổi cỡ, đo thực 69-777 KB mỗi thẻ (8 thẻ = 1868 KB).
2. Entry Mini App 711 KB raw / 222 KB gzip, vượt ngưỡng 700 KB và mục tiêu 450 KB (vượt 261 KB); onboarding, flash-sale, purchased-rail, subscribe-sheet, toàn bộ `vi.ts` đều nằm trong entry.
3. P-04: `sort=best_seller`, sắp giá và lọc giá nạp toàn bộ catalog + phân loại mỗi lượt (O(catalog), hiện 111 SP).
4. P-06: danh sách trang chủ/danh mục refetch sau 10 giây (Mini App) hoặc mỗi lần mount (web), nhân với P-04.
5. Web `/` First Load 204 KB (cao nhất trong trang khách, +49 KB so với trung vị 155 KB) và `/thanh-toan`, `/tai-khoan/don-hang/[code]` 191 KB; P-02 CLS ở ảnh bài đăng cộng đồng.

## 5. Chưa kiểm
- Thời gian phản hồi thật của API (không chạy API và DB trong phiên này).
- LCP/CLS/TBT thật trên trình duyệt (phần này dành cho bước đo bằng trình duyệt ở lane 3600-3619).
- Host Pancake có hỗ trợ tham số đổi cỡ ảnh không.
- `27269722.*.js` (122 KB raw, 38 KB gz) trong `.next/static/chunks`: chưa xác định nội dung và trang dùng.
