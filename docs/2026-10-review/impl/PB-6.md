# PB-6 — Home gộp request + cache + bundle

## Mục 1/2 — C-037 (Home gộp request): XONG (phần code + test đơn vị; e2e Playwright chưa chạy)

### Thiết kế
- API (`apps/api/src/modules/catalog/home.{controller,service}.ts`, `dto/home-me-query.dto.ts`):
  - `GET /api/home` (public): `bestSellers`, `featured`, `newest`, `flashActive`, `categories`, `brands`. Chỉ gọi lại đúng các hàm service
    của endpoint công khai lẻ (không đọc người dùng, không giá sỉ, không PII). Cache RAM chung 20 s (3 s nếu có khối lỗi),
    request đồng thời lúc hết cache dùng chung một lần dựng.
  - `GET /api/home/me` (JWT, `Cache-Control: private, no-store`, không cache chung): `forYou`, `flashUpcoming`, `purchasedItems`
    (`?purchasedLimit=`), `activeOrderCount`, `shippingOrders` (1 đơn SHIPPING mới nhất), `subscriptions`, `notifications`.
  - Mỗi khối chạy độc lập qua `block()`: lỗi → `null` + log warn, các khối khác vẫn trả.
  - `orders.module.ts` (exports thêm `OrdersService`, `PurchasedItemsService`) và `subscriptions.module.ts` (exports `SubscriptionsService`)
    sửa tối thiểu — ngoài nhóm file của gói, buộc phải làm để HomeService tái dùng dịch vụ có sẵn.
- Miniapp (`services/home-feed.ts`): khi Trang chủ đang mở (`useHomeFeed()` arm trong render), lần gọi ĐẦU của từng service lẻ
  (`fetchCategories/Brands/ForYou/ActiveFlashSales/UpcomingFlashSales/PurchasedItems/ActiveOrderCount/fetchOrders(SHIPPING,1,1)/
  getSubscriptions/getNotifications` và `fetchProducts` đúng 3 bộ tham số của Home) lấy từ 2 request gộp. Component + queryKey giữ nguyên.
  Lùi về request lẻ khi: API cũ 404/lỗi mạng/timeout 8 s, khối `null`, tham số lẻ không khớp, khối đã dùng (refetch định kỳ/invalidate).
  Kéo để làm mới gọi `resetHomeFeed()` nên làm mới cũng chỉ tốn 2 request gộp.
- `apps/e2e/tests/support/mock-api.ts`: fixture cho phép `GET /home`, `GET /home/me` ở trạng thái chưa mock (404) → các spec Home/Browse 4a/4b
  hiện có đi đường fallback như cũ.

### Số request mở Home (đếm bằng test `pages/home-requests.spec.tsx`, `api.get` giả)
- Đăng nhập: trước ~16 (`/products` x3, `/products/for-you`, `/categories`, `/brands`, `/flash-sales/active|upcoming`, `/me/purchased-items`,
  `/me/notifications`, `/me/subscriptions`, `/orders/active-count`, ...) → sau **2** (`/home`, `/home/me`). Cộng khung app (`/me`, `/cart`,
  `/me/wishlist/ids`, `/auth/*` — không thuộc Trang chủ) vẫn ≤ 5.
- Khách chưa đăng nhập: 1 (`/home`).

### Test (đỏ→xanh)
- API `home.service.spec.ts` (8): 6 khối + tham số khớp client, lỗi độc lập, cache 20 s/3 s, dùng chung lần dựng, khối cá nhân đúng userId không cache chéo.
- Miniapp `home-feed.spec.ts` (6), `home-requests.spec.tsx` (5: đếm 2 request, khách = 1, 404 → fallback lẻ, khối null → chỉ khối đó gọi lẻ, kéo làm mới).
  Viết test cùng lúc với code (không có lượt đỏ riêng); đường fallback kiểm chứng "không có feed thì ra đủ request lẻ".
- Smoke thật: build `nest build`, chạy trên Postgres 5556, `GET /api/home` 200 (6 khối), `GET /api/home/me` không token 401, có token khách 200 + `Cache-Control: private, no-store`.

### Chưa làm / giả định
- Chưa chạy Playwright (quy định RAM). Rủi ro còn lại: e2e 4b chạy trong trình duyệt thật ở nhánh fallback (404) — logic giống test vitest.
- `Cache-Control` cho `/home` công khai để mục C-039 (lượt sau). Cache RAM per-instance như brands/categories (xem comment trong CatalogService).
- Giả định: `limit` 6/12/6 cố định ở server khớp `SECTION_LIMIT` của miniapp; lệch thì client tự lùi về request lẻ.

## Mục 2/2 — C-039 (Cache-Control API công khai) + C-088 (bundle miniapp)

### C-039: XONG (commit 69ab874)
- `common/decorators/public-cache.decorator.ts`: `@PublicCache('STATIC'|'CATALOG'|'LIVE')` -> `Cache-Control: public, max-age=60, s-maxage=300` /
  `max-age=15, s-maxage=30` / `max-age=5, s-maxage=10`.
- Gắn cho: `GET /products`, `/products/:slug`, `/related`, `/bought-together`, `/brands`, `/categories`, `/home`, flash-sale đang chạy,
  system-config công khai, FAQ, brand công khai, geo provinces/communes. KHÔNG gắn cho for-you, upcoming, `/home/me`, mọi route theo user/giá sỉ.
- Test: `public-cache.decorator.spec.ts` (đọc metadata header của từng route; kiểm route theo user không có `public`). Cùng `src/modules/catalog`:
  6 suite / 105 test xanh, `tsc --noEmit` apps/api sạch.
- ETag: Express bật sẵn weak ETag cho body JSON, không cấu hình thêm.
- Giả định: `Vary: Origin` do CORS đã gắn nên cache chung an toàn. Cache nóng vẫn là RAM từng instance (không đổi sang Redis, ngoài phạm vi).

### C-088: BỎ phần sửa code (đo + phân tích, không đổi gì được commit)
Đo bằng `vite build` (plugin generateBundle tạm in thành phần entry, đã xoá):
- Entry hiện tại: `index.*.module.js` 630.96 kB / **201.34 kB gz**; CSS 127.8 kB (zaui.css ~101 kB + app ~26 kB).
- Thành phần entry (rendered, chưa minify): react-dom 133, axios 125, zmp-sdk 124 (barrel `zmp-sdk/apis`, không tree-shake được), zmp-ui 102,
  @tanstack/query-core 74, react-spring 47+20+8+7, use-gesture 38, resize-observer-polyfill 33, router 32+20, react-transition-group 21,
  lucide 17; code ứng dụng (components/ui, i18n, app, home...) chỉ ~110 kB. Tức ~80% entry là vendor bắt buộc cho khung app.
- Route: 37/37 trang đã `React.lazy` (app.tsx), qrcode nằm chunk `qr-code` lazy (24.6 kB), game/admin/loyalty/community/storefront-builder đều chunk riêng.
  Không còn thư viện nặng nào để dynamic-import thêm.
- Thử `manualChunks` (vendor-react/zmp-ui/zmp-sdk/data): entry còn 131.97 kB / **43.17 kB gz** (đạt số "entry gz <= 150 kB") NHƯNG tổng JS lần mở đầu
  tăng 631 -> 684 kB, gz 201.3 -> 218.6 kB (+8,6%) vì mất nén chung, và còn tách thêm CSS vendor. Không giảm lần tải đầu mà tăng; lợi ích cache hash
  vendor ít giá trị với gói Zalo Mini App phát hành theo phiên bản. Vì vậy KHÔNG commit (đã gỡ cấu hình thử, working tree sạch).
- Muốn giảm thật cần quyết định chủ dự án: bỏ axios (dùng fetch, -~12 kB gz), thay/hạn chế zmp-ui bằng DS tự viết, hoặc xin Zalo bản zmp-sdk tree-shakable.
  Mục tiêu "entry gz <= 150 kB" không đạt được nếu chỉ lazy-load; con số 201 kB gz giữ nguyên (không tăng so với trước gói).

## Review lượt 1

| # | Mức | Kết luận | Xử lý |
|---|-----|----------|-------|
| 1 | major, flashActive trong `/home` chịu 3 lớp cache (~65s) | ĐÚNG, đã sửa (commit "address review flash…") | Tách khối flash khỏi blob 20s: slot riêng TTL RAM 3s (chỉ để gom request đồng thời); header `GET /home` hạ về `LIVE` (5s/10s). Tối đa ~18s thay vì ~65s, cùng bậc endpoint lẻ. Test đỏ→xanh: "sau 6s dựng lại flashActive, categories/bestSellers vẫn dùng cache 20s", "flash trong 2s dùng cache". |
| 2 | minor, C-088 không có code, entry 201 KB gz > 150 | ĐÚNG, ghi nhận, KHÔNG sửa code | **C-088 trạng thái: HOÃN, chờ chủ dự án quyết định** (không đánh dấu xong). Phương án cần duyệt: bỏ axios (~-12 kB gz), DS tự viết thay zmp-ui, hoặc chấp nhận manualChunks (entry 43 kB gz nhưng tổng JS lần đầu +8,6%). Chưa bisect nguồn tăng 22% so với tháng 9 (cần quyết định trước mới đáng làm). |
| 3 | minor, `@Header` gắn cả response lỗi | ĐÚNG, đã sửa (commit "address review Cache-Control…") | `@PublicCache` đổi thành metadata + `PublicCacheInterceptor` chỉ set header khi handler thành công 2xx (lỗi guard/validation vốn chạy trước interceptor nên không bị gắn). Test thật qua HTTP (`public-cache.interceptor.spec.ts`): 200 có `public, max-age=15, s-maxage=30`; 404 không có `public`. Đã xác nhận ĐỎ với `@Header` cũ ("Received: public, max-age=15, s-maxage=30"). `public-cache.decorator.spec.ts` đọc policy từ metadata mới. |
| 4 | minor, phiên feed không gắn user | ĐÚNG, đã sửa (commit "address review feed…") | Feed `/home/me` ghi access token lúc phản hồi về; `take()` trả null nếu token hiện tại khác → khối cá nhân không trao cho tài khoản khác, rơi về request lẻ (refresh token trong cửa sổ hiếm cũng chỉ là lùi về lẻ, an toàn). Thêm `getAccessToken()` vào `services/api.ts`. Test `home-feed.spec.ts` đỏ→xanh. |
| 5 | minor, khối chậm giữ cả `/home/me` tới 8s | ĐÚNG, đã sửa | `HomeService.block()` cắt từng khối ở 2,5s → null (client gọi lẻ khối đó); `FEED_TIMEOUT_MS` 8s→4s. Test fake-timer "khối chậm quá hạn thì thành null". Chi phí 1 RTT tuần tự khi API cũ 404 giữ nguyên (đổi lấy tương thích, chỉ xảy ra lúc API cũ). |
| 6 | minor, Playwright 4b chưa mock `/home` | KHÔNG sửa trong lượt này | Quy định gói cấm chạy Playwright (RAM 15,5GB); viết spec e2e không chạy được là rủi ro đưa spec hỏng. Việc còn lại: thêm spec `buy-flow-4b-home-merged` mock `GET /home`+`/home/me` có dữ liệu, assert `api.callsTo('/home')===1` và route lẻ 0; chạy suite `buy-flow-4b-*` một lần trước merge. Test vitest `home-requests.spec.tsx` chỉ đếm khối Home (2 request); con số "≤5 gồm khung app" là ước lượng từ các request khung (`/me`, `/cart`, `/me/wishlist/ids`, `/auth/*`). |

### Kiểm chứng lượt này
- `npx jest src/common/decorators src/modules/catalog --maxWorkers=1` (apps/api): 7 suite / 110 test xanh.
- `npx tsc --noEmit -p tsconfig.json` (apps/api) và `npx tsc --noEmit` (apps/miniapp) sạch; ESLint các file đã sửa sạch.
- `npx vitest run src/services/home-feed.spec.ts src/pages/home-requests.spec.tsx` (apps/miniapp): 12 test xanh.
- Migration: không có.
