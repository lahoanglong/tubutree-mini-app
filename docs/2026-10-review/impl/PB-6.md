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
