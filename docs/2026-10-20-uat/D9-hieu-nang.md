# D9 — Hiệu năng: bundle Mini App, số truy vấn SQL mỗi request, N+1

- **Ngày đo:** 2026-10-19 22:00–22:30 (giờ máy), phiên UAT `uat/2026-10-20`, mã `05e6ae97` (origin/main sau PR #23), `apps/api/dist` dựng lúc 21:58 từ cùng mã.
- **Vai:** chỉ đọc mã ứng dụng, không sửa. Mọi file tạo mới nằm trong `docs/2026-10-20-uat/` (báo cáo này, `perf-data/`, `tools/perf/`).
- **Đọc trước:** mục 0 (giới hạn của số đo). Số ms trong báo cáo là cận tham khảo của máy dev đang tải nặng, không phải năng lực VPS Vietnix.

## Tóm tắt

| Mức | Số phát hiện | ID |
|---|---|---|
| P0 | 0 | |
| P1 | 0 | |
| P2 | 3 | D9-01, D9-02, D9-03 |
| P3 | 6 | D9-04 … D9-09 |

1. **Không có P0/P1.** Trên 65 endpoint màn chính, số truy vấn SQL **không tăng theo số dòng** ở danh sách đơn, giỏ, feed, gian hàng, admin đơn, ví/điểm/thông báo (đo ở 3 cỡ dữ liệu, mục 2.3). Hai chỗ có N+1 thật nằm ở ghi: `POST /events` (N INSERT cho N sự kiện, D9-02) và `POST /orders/:code/repurchase` (~28 truy vấn mỗi dòng, D9-05).
2. **Phát hiện đáng làm nhất: D9-01.** Báo cáo "Khách mới theo nguồn" của admin (`/admin/reports/sources`) bị Postgres chuyển sang kế hoạch generic sau lần gọi thứ 5 (Prisma tái dùng câu đã prepare) và rơi vào vòng lặp lồng bình phương: **5,2k khách trong cửa sổ → 0,4–0,9 s, 20k khách → 5,6 s** (121 triệu dòng bị loại ở join filter), trong khi kế hoạch custom chỉ 32 ms / 108 ms.
3. **Bundle Mini App vẫn là mục mở A3-013, và xấu đi:** entry `index.*.js` **685 KB raw / 217 KB gzip**, bằng 98% ngưỡng cảnh báo 700 KB, gấp 1,52 lần mục tiêu 450 KB; so với đo 2026-10-09 (617 KB / 196 KB gz) tăng 11%. Tổng build 1.833 KB (đo cũ 1.526 KB, +20%).
4. **Trang chủ đã gộp request** (A3-009 đã đóng): mở Trang chủ chỉ cần `GET /home` (0 SQL khi cache nóng, 26 SQL khi dựng lại) + `GET /home/me` (25 SQL, p50 7,5–12,6 ms).
5. Kết luận tải: một tiến trình API trên máy đo (đang tải 25–34) chịu ~280 lượt "mở Trang chủ" mỗi giây (mỗi lượt 2 request) trước khi bão hoà; p95 212 ms ở 32 khách đồng thời (mục 2.5).

---

## 0. Phương pháp và giới hạn

**Cách đo số truy vấn.** `PrismaService` (`apps/api/src/prisma/prisma.service.ts`) không đặt `log` và không có biến môi trường bật log truy vấn, nên không dùng được log Prisma. Dùng đường brief cho phép: cụm Postgres riêng `25434` (bản embedded 16.14 của `tools/pg-native.sh`, có `pg_stat_statements.dylib`), bật bằng `shared_preload_libraries='pg_stat_statements'`, `compute_query_id=on`, `log_min_duration_statement=0` trong `data-25434/postgresql.conf` (không sửa mã). DB `tubutree_perf` = `migrate deploy` + `seed.ts` + `seed-reference.ts --with-business-defaults` (cùng cách DB UAT). API thứ hai `api-up.sh 3229 tubutree_perf 9 25434` (Redis db 9). Với mỗi endpoint: `pg_stat_statements_reset()` → 1 request → cộng `calls` (gồm cả `BEGIN`/`COMMIT`); lấy trung vị của 3 lần gọi nóng; rồi 20 lần gọi tuần tự lấy p50/p95. Token dev ký bằng `JWT_ACCESS_SECRET` của `apps/api/.env` (cùng thuật toán `scripts/dev-token.ts`, ký trong script để không hết hạn 1 giờ).

**Ba cỡ dữ liệu** (`tools/perf/seed-perf.cjs small|large`, `seed-bulk.cjs`) để bắt N+1 bằng cách so số truy vấn khi số dòng tăng:

| Cỡ | Khách | Đơn / dòng hàng | Bài feed / tim / bình luận | Coupon | Giỏ khách thử | Đơn khách thử |
|---|---|---|---|---|---|---|
| nhỏ | 32 | 42 / 84 | 5 / 10 / 5 | 3 | 1 dòng | 2 |
| vừa | 202 | 625 / 2.500 | 60 / 900 / 300 | 3 | 8 dòng | 25 |
| lớn | 5.202 | 50.625 / 102.500 | 10.060 / 50.900 / 20.300 | 20.003 | 8 dòng | 25 |

(Riêng D9-01 nâng thêm lên 20.202 khách / 95.629 đơn.)

**Giới hạn, đọc trước khi dùng số ms:**

- Máy dùng chung, load average 8–34 trong lúc đo (12 CPU). p95 và các lần đo ngắn nhiễu mạnh; **số truy vấn thì tất định** (đã lặp 3 lần, giống nhau ở mọi dòng).
- Postgres của phiên UAT chạy `fsync=off`, `synchronous_commit=off` (`tools/pg-native.sh`) và cùng máy với API, nên mọi INSERT/commit rẻ hơn PROD. Thời gian của các đường ghi (D9-02, D9-05) **thấp hơn** thực tế PROD; số truy vấn thì đúng.
- Chỉ đo một client tuần tự (trừ mục 2.5). Pancake/Gomdon/ZaloPay/ZNS tắt (không khoá), nên các bước gọi dịch vụ ngoài không có trong số đo.
- **Chưa kiểm chứng:** thời gian tải thật trên Zalo WebView (cần Zalo SDK, không chạy được trong trình duyệt thường); bundle web Next (brief cấm `next build`); số trên VPS Vietnix; đơn tách nhiều nhóm giao (nhiều gian hàng đối tác trong một giỏ); số dòng giỏ trên 12.
- `apps/miniapp/www/` (đã gitignore) giờ có bản build hôm nay; build chạy 2 lần (lần 2 để lấy thống kê module) + 1 lần thử tách vendor ra thư mục tạm, đều ~10 s.

---

## 1. Bundle Mini App

Lệnh: `cd apps/miniapp && npx tsc --noEmit` (qua), build bằng API Vite với đúng `vite.config.mts` (`tools/perf/build-stats.mjs`, thêm một plugin chỉ ghi thống kê, không đổi đầu ra), rồi `node scripts/ci/bundle-budget.cjs apps/miniapp/www` (`perf-data/bundle-budget.txt`). Vite 5.4.21, 2.728 module, build 9,5 s.

### 1.1 So ngân sách (`scripts/ci/bundle-budget.cjs`, ngưỡng cảnh báo, CI không chặn)

| Chỉ số | Đo hôm nay | Đo 2026-10-09 (`03-perf.md`) | Ngưỡng cảnh báo | Mục tiêu A3-013 |
|---|---|---|---|---|
| Entry `assets/index.ByCae4Gy.module.js` | **685 KB raw / 217 KB gzip** (701.907 byte; gzip -9: 215 KB) | 617 KB / 196 KB | 700 KB (đạt 98%) | < 450 KB (vượt 52%) |
| CSS `index-DX9QGa5R.css` | 126 KB / 20 KB gz | 125 KB / 20 KB | không có | |
| JS tổng | 1.508 KB / 518 KB gz, 131 file | 1.256 KB / 417 KB gz, 98 file | không có | |
| Tổng mọi file | **1.833 KB** raw / 738 KB gz, 142 file | 1.526 KB / 583 KB gz | 2.048 KB (đạt 89%) | |
| Chunk lazy lớn nhất | `affiliate` 46 KB, `game` 43, `checkout` 43, `product-detail` 38, `order-detail` 30, `storefront-builder` 29, `dealer` 28, `qr-code` 24 | game 37, affiliate 35, checkout 32 | | |

Vite vẫn in cảnh báo "Some chunks are larger than 500 kB" cho entry. `scripts/ci/bundle-budget.cjs` thoát 0 (không chặn) trừ khi `BUNDLE_BUDGET_STRICT=1`; `.github/workflows/ci.yml:60` không đặt cờ này, nên vượt ngưỡng chỉ hiện cảnh báo.

Tải đầu (HTML đồng bộ nạp `index.*.js` + `index-*.css`, `index.html`): 217 KB (JS gz) + 20 KB (CSS gz) + 1 KB HTML = **~238 KB nén**, cộng logo PNG 54 KB (`tubu-logo-*.png`) và tối đa 6 font woff2 147 KB (Inter 400/500/600/700 + Fraunces 500/600, `font-display: swap`, nạp khi dùng) ≈ **440 KB** trước khi Trang chủ vẽ đủ (ước tính cộng số liệu trên; chưa đo thời gian thật). Font icon `zaui-icons` nạp từ `h5.zadn.vn` (ngoài tầm kiểm soát).

### 1.2 Entry kéo thư viện nào (đo thật, không ước lượng)

Hai nguồn: (a) thống kê module của build thường (`perf-data/miniapp-chunks.json`, kích thước trước minify); (b) build thử tách vendor bằng `manualChunks` đặt trong script (`tools/perf/build-split.mjs`, **không sửa `vite.config.mts`**), cho kích thước **sau minify**:

| Nhóm thư viện (đều nằm trong entry hiện tại) | Raw sau minify | Gzip | Ghi chú |
|---|---|---|---|
| Mã ứng dụng (app src) | 175 KB | 55 KB | gồm `src/i18n/vi.ts` 35 KB trước minify, `app.tsx` 20 KB, `home.tsx` + các khối Trang chủ tĩnh |
| `zmp-ui` + `@react-spring` + `@use-gesture` + `resize-observer-polyfill` + `react-transition-group` | **150 KB** | 50 KB | lớn nhất; kèm CSS 99 KB / 14 KB gz (79% CSS của app) |
| `react-dom` + `scheduler` | 131 KB | 42 KB | không bớt được |
| `zmp-sdk` | 125 KB | 34 KB | kéo theo `zod` 48 KB trước minify nằm bên trong SDK (`zmp-sdk/apis/external/zod`) |
| `lucide-react` | 56 KB | 13 KB | dùng chung với các chunk lazy, nên con số này lớn hơn phần trong entry (24 KB trước minify) |
| `@tanstack/react-query` (query-core) | 47 KB | 14 KB | |
| `axios` | **44 KB** | 17 KB | dùng bởi `services/api.ts` và 10 file khác (`isAxiosError`, kiểu) |
| thư viện khác | 34 KB | 13 KB | |
| `react-router(-dom)` + `@remix-run/router` | 21 KB | 8 KB | |

Chunk lazy nặng thư viện: `qr-code.*` kéo `qrcode` 73 KB trước minify (chỉ khi mở màn mã QR, hợp lý); `index.BlBwkc7A` (27 KB) và `index.Bpe9zeDb` kéo thêm phần `zmp-ui` không vào entry. Không chunk lazy nào quá 46 KB.

Hệ quả: nếu bỏ hết phần lười tải được, entry vẫn không xuống dưới ~520 KB vì `react-dom` + `zmp-ui` + `zmp-sdk` + `react-query` + router đã chiếm 474 KB. Mục tiêu 450 KB của A3-013 không đạt được bằng tách chunk thường; chỉ đạt nếu thay `axios` (-40 KB) và giảm `zmp-ui`. Xem D9-03.

Cảnh báo cũ còn nguyên: `store/auth.ts` vừa import động (`services/api.ts:103`) vừa tĩnh (hơn 40 file), nên import động vô nghĩa (Vite in cảnh báo, không đổi kích thước).

---

## 2. API: số truy vấn SQL và thời gian mỗi request

### 2.1 Trang chủ (màn chính)

`apps/miniapp/src/services/home-feed.ts` gom các query lẻ vào `GET /home` (+ `GET /home/me` khi đã đăng nhập). Đo trên API 3229:

| Request | SQL | p50 / p95 ms (lớn) | KB |
|---|---|---|---|
| `GET /home` (công khai, cache RAM 20 s, flash 3 s) | **0** khi cache nóng; **26** khi dựng lại (đo sau 62 s nghỉ) | 0,5 / 1 (nóng); 8,5 (dựng lại) | 8,2 |
| `GET /home/me` (8 khối song song, mỗi khối tự cắt ở 2,5 s) | **25** (23 ở dữ liệu nhỏ) | 7,5 / 11,2 | 22,3 |
| `GET /cart` (đếm giỏ ở đầu trang) | 14 | 6,9 / 35,7 | 3,9 |

Cộng "mở Trang chủ" của khách đã đăng nhập ≈ 39 truy vấn nóng, vài chục ms phía máy chủ. `home/me` không thêm truy vấn khi số dòng tăng (23 → 25 là do kệ "Mua lại" có dữ liệu: 1 → 3 truy vấn).

### 2.2 Số truy vấn mỗi request theo luồng

Số SQL ở các luồng mua (đo thêm bằng `tools/perf/place-order-probe.cjs` trên khách riêng, K = số dòng giỏ):

| Luồng | K=1 | K=4 | K=8 | K=12 | Nhận xét |
|---|---|---|---|---|---|
| `POST /cart/items` (thêm món thứ K) | 33 | 28 | 28 | 28 | phẳng; mỗi lần thêm dựng lại cả giỏ |
| `POST /checkout/quote` | 21 | 18 | 18 | 18 | phẳng |
| `POST /checkout/place-order` (COD) | 47 | 54 | 62 | 70 | +2/dòng: 1 `UPDATE variations` giữ chỗ tồn (`checkout.service.ts:432` → `catalog/variation-stock.ts:77`, chủ ý để chống oversell) + 1 kiểm khoá ngoại nội bộ của Postgres |

Đây là đường tiền; mức tăng theo dòng là chủ ý, không báo lỗi.

### 2.3 Bảng đầy đủ: số SQL và thời gian ở ba cỡ dữ liệu

Cột "SQL nhỏ / vừa / lớn" là trung vị 3 lần gọi nóng. Số SQL **không đổi** giữa các cỡ (trừ khi ghi chú) nghĩa là **không có N+1 theo số dòng** ở endpoint đó. "–" = không đo được ở cỡ đó (`429`: throttle 30/phút của riêng route `coupon-previews`).

| Tên | Endpoint | SQL nhỏ / vừa / lớn | p50 ms nhỏ / vừa / lớn | p95 ms (lớn) | Dòng trả về (lớn) | KB (lớn) |
|---|---|---|---|---|---|---|
| home | GET /home | 0 / 0 / 0 | 1.2 / 3.4 / 0.5 | 1 | – | 8.2 |
| home-me | GET /home/me | 23 / 25 / 25 | 8.8 / 12.6 / 7.5 | 11.2 | – | 22.3 |
| products-l20 | GET /products?limit=20 | 5 / 5 / 5 | 5.6 / 6.4 / 4.4 | 6.3 | 20 | 4.8 |
| products-l1 | GET /products?limit=1 | 5 / 5 / 5 | 3.4 / 4.5 / 2.5 | 3.2 | 1 | 0.3 |
| products-sort-best | GET /products?limit=20&sort=best_seller | 3 / 3 / 3 | 5.6 / 6.7 / 3.6 | 4.4 | 20 | 4.7 |
| products-search | GET /products?limit=20&q=tui | 6 / 6 / 6 | 4.8 / 6.5 / 3.4 | 3.8 | 1 | 0.3 |
| products-for-you | GET /products/for-you | 6 / 6 / 6 | 8.6 / 12.1 / 6.8 | 9.1 | 10 | 2.3 |
| product-detail | GET /products/:slug | 4 / 4 / 4 | 3.6 / 4.3 / 3 | 3.8 | – | 1.2 |
| product-related | GET /products/:slug/related | 3 / 3 / 3 | 3.9 / 5.2 / 2.9 | 3.5 | 4 | 1.0 |
| product-bought-together | GET /products/:slug/bought-together | 4 / 4 / 4 | 4.8 / 8.3 / 20.6 | 26.1 | 6 | 1.5 |
| product-reviews | GET /products/:slug/reviews | 4 / 4 / 4 | 2.9 / 4.3 / 2.3 | 2.8 | 0 | 0.1 |
| categories | GET /categories | 0 / 0 / 0 | 0.8 / 1.8 / 0.5 | 0.8 | 7 | 0.9 |
| brands | GET /brands | 0 / 0 / 0 | 1.1 / 1.5 / 0.6 | 1 | 8 | 0.3 |
| search-suggest | GET /search/suggest?q=tui | 2 / 2 / 2 | 3.1 / 4.2 / 1.9 | 3.2 | 1 | 0.1 |
| flash-active | GET /flash-sales/active | 1 / 1 / 1 | 2.4 / 3.5 / 1.4 | 2.2 | 0 | 0.0 |
| flash-upcoming | GET /flash-sales/upcoming | 1 / 1 / 1 | 2.7 / 3.4 / 1.7 | 2.6 | 0 | 0.0 |
| cart | GET /cart | 14 / 14 / 14 | 8.6 / 10.5 / 6.9 | 35.7 | 8 | 3.9 |
| checkout-quote | POST /checkout/quote | 19 / 19 / 19 | 15.2 / 10.7 / 10.5 | 13.4 | 8 | 4.4 |
| checkout-quote-selected | POST /checkout/quote | 19 / 19 / 19 | 13.8 / 7.6 / 14.5 | 26.3 | 8 | 4.4 |
| checkout-coupon-previews | POST /checkout/coupon-previews | 0 / 25 / 25 | – / 8.4 / 15.3 | 20.3 | – | 0.3 |
| orders-l20 | GET /orders?limit=20 | 7 / 7 / 7 | 5.7 / 5.6 / 6.5 | 7.9 | 20 | 59.0 |
| orders-l1 | GET /orders?limit=1 | 7 / 7 / 7 | 5.5 / 2.8 / 4.3 | 6.6 | 1 | 3.0 |
| orders-group-processing | GET /orders?group=processing&limit=20 | 7 / 7 / 7 | 5.8 / 3.5 / 5.3 | 6 | 5 | 14.8 |
| orders-active-count | GET /orders/active-count | 1 / 1 / 1 | 1.9 / 0.7 / 1.5 | 2.1 | – | 0.0 |
| order-detail | GET /orders/PERFC000001 | 4 / 4 / 4 | 4.4 / 1.6 / 3.4 | 4.6 | 4 | 3.2 |
| order-detail-big | GET /orders/PERFC000001 | 4 / 4 / 4 | 4.3 / 1.8 / 4.3 | 9.1 | 4 | 3.2 |
| purchased-items | GET /me/purchased-items | 1 / 3 / 3 | 1.7 / 1.3 / 2.5 | 3.7 | 20 | 6.7 |
| me | GET /me | 1 / 1 / 1 | 3 / 0.8 / 1.7 | 2.1 | – | 0.4 |
| me-loyalty | GET /me/loyalty | 9 / 9 / 9 | 7.3 / 3.1 / 5.8 | 7.5 | – | 1.0 |
| me-points-tx | GET /me/points/transactions | 1 / 1 / 1 | 1.8 / 0.9 / 2.2 | 4.4 | 60 | 12.6 |
| me-coupons | GET /me/coupons | 4 / 4 / 4 | 5.8 / 1.4 / 3.3 | 4 | 3 | 0.4 |
| me-new-customer-offer | GET /me/new-customer-offer | 2 / 2 / 2 | 3.8 / 1.4 / 2.3 | 4 | – | 0.0 |
| me-wallet | GET /me/wallet | 3 / 3 / 3 | 4 / 1.6 / 3.1 | 4.6 | – | 0.1 |
| me-notifications | GET /me/notifications | 1 / 1 / 1 | 1.3 / 1.3 / 1.4 | 2.5 | 45 | 10.2 |
| me-wishlist | GET /me/wishlist | 3 / 3 / 3 | 4.2 / 2.5 / 4.3 | 8.5 | 20 | 4.7 |
| me-wishlist-ids | GET /me/wishlist/ids | 2 / 2 / 2 | 2.3 / 0.7 / 2.7 | 3.6 | 20 | 0.3 |
| me-subscriptions | GET /me/subscriptions | 4 / 4 / 4 | 3.8 / 1.2 / 3 | 3.9 | 8 | 3.2 |
| me-addresses | GET /me/addresses | 1 / 1 / 1 | 2.2 / 0.5 / 1.2 | 1.6 | 1 | 0.3 |
| feed | GET /feed | 9 / 9 / 9 | 4.9 / 2 / 9.6 | 13.5 | 20 | 7.9 |
| feed-popular | GET /feed?sort=popular | 9 / 9 / 9 | 6.2 / 2.3 / 5.1 | 7.2 | 20 | 8.0 |
| feed-leaderboard | GET /feed/leaderboard | 1 / 1 / 1 | 1.8 / 0.5 / 2.4 | 6.7 | 0 | 0.0 |
| feed-events | GET /feed/events | 1 / 1 / 1 | 2 / 0.5 / 2 | 3 | 0 | 0.0 |
| feed-post | GET /feed/perf-pb-1 | 9 / 9 / 9 | 3.9 / 1.3 / 4.9 | 8.3 | – | 0.4 |
| feed-comments | GET /feed/perf-pb-1/comments | 4 / 4 / 4 | 3.1 / 1.1 / 2.5 | 3.2 | 2 | 0.4 |
| storefront-public-list | GET /storefront/public-list | 1 / 1 / 1 | 2.7 / 0.8 / 2.2 | 2.8 | 1 | 0.1 |
| storefront-public | GET /storefront/public/devtest1 | 7 / 7 / 7 | 6.3 / 2.6 / 5.7 | 8.1 | – | 10.7 |
| storefront-me | GET /storefront/me | 5 / 5 / 5 | 4.1 / 1.8 / 3.7 | 5 | – | 17.4 |
| storefront-me-stats | GET /storefront/me/stats | 5 / 5 / 5 | 3.8 / 1 / 3.5 | 6.1 | – | 0.1 |
| affiliate-me | GET /affiliate/me | 2 / 2 / 2 | 4 / 1.2 / 3.4 | 4.9 | – | 0.3 |
| affiliate-dashboard | GET /affiliate/dashboard | 7 / 7 / 7 | 2.9 / 1.2 / 1.9 | 3 | – | 0.3 |
| affiliate-commissions | GET /affiliate/commissions | 2 / 2 / 2 | 2.4 / 1.9 / 2.2 | 2.6 | 40 | 14.8 |
| affiliate-links | GET /affiliate/links | 1 / 1 / 1 | 3.6 / 0.6 / 1.3 | 1.5 | 0 | 0.0 |
| admin-dashboard | GET /admin/dashboard/stats | 18 / 18 / 18 | 4.3 / 2.1 / 24.5 | 48.5 | – | 1.6 |
| admin-orders-l20 | GET /admin/orders?limit=20 | 8 / 8 / 8 | 7.8 / 5.6 / 13 | 42.9 | 20 | 54.9 |
| admin-orders-l1 | GET /admin/orders?limit=1 | 8 / 8 / 8 | 5.2 / 2.3 / 10.8 | 15.8 | 1 | 2.8 |
| admin-orders-status | GET /admin/orders?limit=20&status=CONFIRMED | 8 / 8 / 8 | 5.7 / 3.3 / 13.6 | 27.8 | 20 | 56.2 |
| admin-orders-search | GET /admin/orders?limit=20&search=PERFA0001 | 5 / 9 / 9 | 6.7 / 5.4 / 30.9 | 77.1 | 20 | 67.9 |
| admin-users | GET /admin/users?limit=20 | 4 / 4 / 4 | 4.8 / 1.3 / 2.9 | 3.6 | 20 | 5.6 |
| admin-coupons | GET /admin/coupons | 3 / 3 / 3 | 3.9 / 1.4 / 4.5 | 5.6 | 3 | 1.5 |
| admin-reviews | GET /admin/reviews | 6 / 6 / 6 | 3.5 / 2 / 4.3 | 13.9 | 12 | 3.9 |
| admin-subscriptions | GET /admin/subscriptions | 7 / 7 / 7 | 5.1 / 1.6 / 5.4 | 14.9 | 8 | 3.2 |
| admin-payouts | GET /admin/payouts | 4 / 4 / 4 | 2.8 / 0.8 / 3.1 | 13 | 0 | 0.0 |
| admin-reports-revenue | GET /admin/reports/revenue | 2 / 2 / 2 | 2.1 / 1.9 / 47.6 | 66.6 | – | 6.1 |
| admin-reports-sources | GET /admin/reports/sources | 1 / 1 / 1 | 2.7 / 126.2 / 542.8 | 736 | 33 | 7.2 |
| events-b1 | POST /events | – / – / 1 | – / – / 2.7 | 3.8 | – | 0.0 |
| events-b10 | POST /events | – / – / 10 | – / – / 9.4 | 14.3 | – | 0.0 |
| events-b50 | POST /events | – / – / 50 | – / – / 28.8 | 62 | – | 0.0 |
| repurchase-4lines | POST /orders/PERFC000001/repurchase | – / – / 124 | – / – / 42.4 | 123.3 | – | 11.8 |

Kết quả N+1 theo số dòng (cùng endpoint, số dòng trả về khác nhau, số SQL giữ nguyên):

| Endpoint | Số dòng nhỏ → lớn | SQL |
|---|---|---|
| `GET /orders` (limit=1 / 20) | 1 / 2 → 20 | 7 → 7 |
| `GET /cart` | 1 → 8 dòng | 14 → 14 |
| `GET /feed` | 5 → 20 bài (tim 10 → 900) | 9 → 9 |
| `GET /storefront/public/:slug` | 6 → 36 món | 7 → 7 |
| `GET /admin/orders` (limit=1 / 20) | 1 → 20 | 8 → 8 |
| `GET /me/wishlist`, `/me/subscriptions`, `/me/notifications`, `/affiliate/commissions` | 2 → 20, 1 → 8, 3 → 45, 2 → 40 | 3, 4, 1, 2 (không đổi) |

Trong cùng một request không có câu nào lặp theo số dòng; câu lặp 2 lần là các đọc thừa cố định (xem D9-07).

### 2.4 Thời gian ở quy mô lớn (50.625 đơn, 5.202 khách, 20.003 coupon)

Phần lớn endpoint giữ p50 dưới 10 ms. Chỗ tăng theo kích thước bảng (so cột nhỏ → vừa → lớn trong bảng 2.3):

| Endpoint | p50 nhỏ → vừa → lớn | Nguyên nhân |
|---|---|---|
| `GET /admin/reports/sources` | 2,7 → 126 → **543** ms | D9-01 |
| `GET /admin/reports/revenue` | 2,1 → 1,9 → 47,6 ms | quét `orders` (D9-06) |
| `GET /admin/dashboard/stats` | 4,3 → 2,1 → 24,5 ms (p95 48,5) | 17 truy vấn gộp toàn bảng `orders` (D9-06) |
| `GET /products/:slug/bought-together` | 4,8 → 8,3 → 20,6 ms | quét `order_items` (D9-04) |
| `GET /admin/orders?search=` | 6,7 → 5,4 → 30,9 ms (p95 77) | tìm `ILIKE` mã đơn, chấp nhận được |
| `GET /admin/coupons` | 3,9 → 1,4 → 4,5 ms | quét `coupons` 4 lần mỗi lượt (D9-09) |

Các mục đã sửa từ `03-perf.md` giữ được ở quy mô này: `GET /me/coupons` 3,3 ms với 20.003 coupon (A3-001), `GET /feed` 9,6 ms với 10.060 bài / 50.900 tim (A3-005), `GET /admin/orders` 13 ms với 50.625 đơn (A3-006).

### 2.5 Tải đồng thời nhẹ (`tools/perf/conc.cjs`, dữ liệu lớn, 6 s mỗi bậc)

Mỗi "khách ảo" mở Trang chủ liên tục (`GET /home` song song `GET /home/me`, token khách khác nhau mỗi vòng). Máy đang load 25–34, nên số chỉ để so cấp độ:

| Đồng thời | Lượt mở/giây | p50 ms | p95 ms | p99 ms | Lỗi / 429 |
|---|---|---|---|---|---|
| 1 | 92,7 | 9,2 | 20,7 | 29,6 | 0 / 0 |
| 8 | 199 | 35,8 | 76,3 | 117,6 | 0 / 0 |
| 32 | 284,5 | 98,6 | 212 | 251,8 | 0 / 0 |
| 64 | 278,7 | 213,3 | 418,4 | 579,7 | 0 / 0 |

Pool Prisma 25 mặc định của máy này; chạy lại với `connection_limit=5` cho ra 202,7 lượt/giây và p95 310 ms ở 32 đồng thời (chậm hơn ~30%). PROD đặt `connection_limit=20` (`docker-compose.vietnix.yml:87`) nên bậc "mặc định" là đại diện. Throughput phẳng từ 32 lên 64: một tiến trình Node đã bão hoà, tăng đồng thời chỉ làm tăng độ trễ.

---

## 3. Quét mã N+1 (không chạy, đọc tay)

Hai bộ lọc thô (`tools/perf/nplus1-scan.py`, `nplus1-scan2.py`, kết quả `perf-data/nplus1-scan*.txt`) tìm vòng `for`/`while`/`.map(async)` có `await` gọi Prisma hoặc service trong thân: 114 vòng, đọc tay từng vòng.

**Trên đường người dùng (ảnh hưởng thời gian phản hồi):**

| Vị trí | Vòng | Kết luận |
|---|---|---|
| `apps/api/src/modules/analytics/analytics.controller.ts:22` | `for (const e of dto.events) await recordBestEffort(...)` | **N+1 thật**, đã đo: N sự kiện = N INSERT (D9-02) |
| `apps/api/src/modules/orders/orders.service.ts:491` | `for (const line of lines) await this.cart.addItem(...)` | **N+1 thật**, đã đo: ~28 SQL mỗi dòng (D9-05) |
| `apps/api/src/modules/checkout/checkout.service.ts:432,456,559,628` | giữ chỗ tồn / tạo đơn / điểm theo từng dòng hoặc từng nhóm giao | chủ ý trong transaction, đã đo +2 SQL/dòng (mục 2.2) |
| `apps/api/src/modules/checkout/checkout.service.ts:1161,1233` | `calcPointsEarned` / `calcShippingFee` theo nhóm giao | số lần = số nhóm giao (thường 1–2); chưa đo đơn nhiều nhóm |
| `apps/api/src/modules/affiliate/affiliate.service.ts:1334` | `commission.aggregate` mỗi gian hàng của CTV | `storefront.ownerUserId` có ràng buộc `@@unique` (`schema.prisma`), tối đa 1 vòng: không phải lỗi |
| `apps/api/src/modules/flash-sale/flash-sale.service.ts:202,260` | theo món flash trong một đơn | số món nhỏ, trong transaction đặt đơn |

**Chỉ chạy nền/cron/quản trị (không chặn khách):** `pancake-sync.service.ts:444-470` (mỗi biến thể 1 `findUnique` + 1 `upsert`, mục A3-016 còn mở; tính ra ≤ 2 × số SKU mỗi 15 phút, vài nghìn truy vấn mỗi giờ so với ~280 lượt mở Trang chủ × 39 SQL mỗi giây ở mục 2.5, nên P3 như cũ), `admin.service.ts:1553` (import giá đại lý: 1 `UPDATE` mỗi biến thể đổi, một lần do admin), các cron nhắc (`lifecycle/*`, `remarketing`, `merchant-sla`, `game-reminder`, `flash-sale.service.ts:502`: vài truy vấn mỗi người nhận, mỗi lô có `take`), `waste-admin-*.service.ts` (đổi thứ tự danh mục), `external-chat.claim.ts`, `loyalty-expiry` (phân trang theo lô). Không có `findMany` rồi `await` trong vòng ở service danh sách của khách.

Đã đóng so với `03-perf.md` (kiểm lại bằng mã và số đo): A3-001, A3-005, A3-006/007 (index), A3-009 (Home), A3-010 (`keepAliveTimeout`: có trong `bootstrap.spec.ts:93`, `config/http-timeouts.spec.ts`), A3-014, A3-015.

---

## 4. Phát hiện

Vùng file: tất cả thuộc **vùng UAT** (`apps/api/**`, `apps/miniapp/**`), không có file vùng phiên web. `apps/miniapp/**` và `apps/api/**` được sửa theo brief; không đụng `packages/app-core/**`.

### D9-01 | P2 | agent sửa ngay | Báo cáo "Khách mới theo nguồn" chuyển sang kế hoạch generic sau 5 lần gọi và chạy bình phương theo số khách mới

- **Vị trí:** `apps/api/src/modules/admin/admin-reports.service.ts:103-175` (câu SQL `sourceReport`; các CTE `valid` dòng 130, `first_order` 134, `second_order` 137 tự join lại nhau).
- **Mô tả:** CTE không có thống kê nên planner ước 1 dòng cho `valid` / `first_order`. Prisma giữ câu đã prepare và tái dùng kế hoạch; sau 5 lần thực thi Postgres chuyển sang kế hoạch generic (không biết khoảng ngày) và chọn `Nested Loop` giữa `valid (n = 2)` và `first_order` thay cho hash join.
- **Kịch bản:** admin Marketing mở `/admin/reports/sources` (mặc định 30 ngày) lần thứ 6 trở đi trong cùng tiến trình API, khi trong cửa sổ có nhiều khách mới (đợt kéo khách từ sàn) → trang treo vài giây, một lõi Postgres kín trong lúc đó, dùng chung với đường mua của khách.
- **Bằng chứng (đo):**
  - Log Postgres, `execute` của câu này ở 5,2k khách / 50,6k đơn, 24 lần gọi liên tiếp: 5 lần đầu 54 / 117 / 120 / 209 / 320 ms, từ lần 6: 281–1.151 ms (trung vị ~540 ms; `tools/perf/planflip.py`: x4,5). Không câu SQL nào khác của 68 endpoint bị lật kế hoạch.
  - `tools/perf/plan-modes.cjs` (PREPARE + `plan_cache_mode`, cùng câu, tham số thật):

    | Cỡ | custom plan | generic plan | Dòng bị loại ở join filter (generic) |
    |---|---|---|---|
    | 5.202 khách, 50.625 đơn | 32–40 ms | 422 / 447 / 945 / 478 ms | 9.236.988 |
    | 20.202 khách, 95.629 đơn | 108–122 ms | **5.636–5.688 ms** | 121.005.504 |

    Khách ×3,9 → generic ×6–13: bình phương. Ở 50k khách mới ước tính vài chục giây (ngoại suy, chưa đo).
  - EXPLAIN generic: `Nested Loop (cost=0.00..0.20 rows=1) ... Rows Removed by Join Filter: 9236988` ở nhánh `CTE Scan on valid v` (n = 2) × `CTE Scan on first_order`.
- **Tác động và ngưỡng nâng mức:** hiện chưa có khách thật nên không ai thấy. Báo cáo chỉ dành cho admin, nhưng chi phí tính ở Postgres dùng chung. Nếu dự kiến hơn ~10.000 tài khoản mới trong 30 ngày đầu thì coi là P1.
- **Đề xuất sửa:** bỏ hai CTE tự join. Tính lần mua thứ nhất và thứ hai của mỗi khách trong một lần gộp: `SELECT user_id, (array_agg(at ORDER BY at, purchase_key))[1] AS first_at, (array_agg(at ORDER BY at, purchase_key))[2] AS second_at FROM purchase GROUP BY user_id`, rồi `first_order_users = COUNT(*) FILTER (WHERE first_at < created_at + window)` và `second_order_users = COUNT(*) FILTER (WHERE first_at < created_at + window AND second_at <= first_at + window)`. Cùng thứ tự `(at, purchase_key)` với `ROW_NUMBER()` nên giữ nguyên nghĩa. Phương án phụ: bọc truy vấn trong `$transaction` với `SET LOCAL plan_cache_mode = force_custom_plan`.
- **Test nên viết:** test tích hợp (Postgres thật, bộ `test/integration`): nạp 3.000 khách trong cửa sổ, mỗi người 2 đơn; gọi `sourceReport` 8 lần; khẳng định lần thứ 8 ≤ 3 × lần đầu và < 1 s; so kết quả số liệu (`newUsers`, `firstOrderUsers`, `secondOrderUsers`, `revenue`) trước/sau refactor trên cùng dữ liệu (đã có test nghiệp vụ của báo cáo, chạy lại phải xanh).
- **Cách tái hiện:** `tools/perf/seed-perf.cjs small|large`, `seed-bulk.cjs`, rồi `tools/perf/plan-modes.cjs <câu SQL lấy từ log> "text,timestamptz,timestamptz" "'unknown','2026-09-19 17:00:00+00','2026-10-19 17:00:00+00'"`.

### D9-02 | P2 | agent sửa ngay | `POST /events` ghi từng sự kiện một: N sự kiện = N INSERT tuần tự

- **Vị trí:** `apps/api/src/modules/analytics/analytics.controller.ts:22-37` (vòng `for ... await this.analytics.recordBestEffort(...)`), `apps/api/src/modules/analytics/analytics-events.service.ts:33-51` (`analyticsEvent.create`) và `:54-60`.
- **Kịch bản:** client gửi mỗi 10 giây một lô (`apps/miniapp/src/services/analytics.ts:18-19,64`: `MAX_BATCH = 50`, `FLUSH_INTERVAL_MS = 10_000`) → lô 50 sự kiện = 50 vòng gọi DB tuần tự trên một kết nối, mỗi INSERT một commit. Mỗi khách đang mở app là nguồn ghi thường xuyên nhất của hệ thống.
- **Bằng chứng (đo, `MUT=1 tools/perf/measure.cjs`):**

  | Lô | SQL | p50 / p95 ms |
  |---|---|---|
  | 1 sự kiện | 1 | 2,7 / 3,8 |
  | 10 sự kiện | 10 | 9,4 / 14,3 |
  | 50 sự kiện | 50 | 28,8 / 62 |

  Tuyến tính theo số sự kiện. Số ms trên Postgres `fsync=off`: trên PROD mỗi INSERT chờ ghi WAL nên đắt hơn (không đo được ở đây).
- **Đề xuất sửa:** một `analyticsEvent.createMany({ data: [...], skipDuplicates: true })` cho cả lô (`eventId` có unique nên trùng bị bỏ đúng như `P2002` nuốt ở `recordBestEffort` hiện nay); nếu `createMany` lỗi khác lỗi trùng thì lùi về vòng từng sự kiện. Thêm `recordManyBestEffort` ở `analytics-events.service.ts`.
- **Test nên viết:** unit với Prisma giả: 50 sự kiện → `createMany` gọi đúng 1 lần với 50 dòng; lô có `eventId` trùng → vẫn `accepted: 50`, 1 dòng trong DB (tích hợp); `createMany` ném lỗi → lùi về từng dòng, `accepted` không đổi.

### D9-03 | P2 | cần chủ quyết | Bundle Mini App: entry 685 KB, mục A3-013 vẫn mở và tăng 11% so với đo 09/10

- **Vị trí:** `apps/miniapp/vite.config.mts` (không có `manualChunks`), `apps/miniapp/src/services/api.ts:1` (axios), `apps/miniapp/src/components/app.tsx:2,6` (`zmp-ui` và `HomePage` tĩnh), `scripts/ci/bundle-budget.cjs` (ngưỡng entry 700 KB, mục tiêu 450 KB).
- **Bằng chứng:** mục 1.1 (685 KB / 217 KB gz; +68 KB, +11% so với 617 KB; tổng +20%) và mục 1.2 (phân rã sau minify). Còn 15 KB nữa là chạm ngưỡng cảnh báo 700 KB trong CI; vài tính năng nữa vào Trang chủ eager là đủ.
- **Tác động:** mọi màn phải tải xong ~238 KB nén (440 KB kèm logo + font) trước khi chạy; trên mạng di động chậm là vài giây (chưa đo thời gian thật trên Zalo). Chưa vượt giới hạn Zalo (giá trị giới hạn hiện hành: chưa kiểm, như chú thích trong `bundle-budget.cjs`).
- **Cần chủ quyết (hai hướng, không loại trừ nhau):**
  1. Thay `axios` bằng wrapper `fetch` mỏng: giảm ~40 KB raw / ~15 KB gz (đo: `v-axios` 44 KB / 17 KB gz). Rủi ro: viết lại interceptor làm mới token và xử lý 429 trong `services/api.ts`; ~11 file đang import kiểu/`isAxiosError`. Công sức M.
  2. Nâng ngưỡng cảnh báo lên ~750 KB và ghi lại là chấp nhận (entry không thể xuống 450 KB mà vẫn giữ `zmp-ui`, `zmp-sdk`, `react-dom`: 474 KB riêng phần này). Công sức S.
- **Đề xuất kèm theo (agent sửa được):** tách `src/i18n/vi.ts` (35 KB trước minify) theo nhóm màn lazy; bỏ import động vô nghĩa `services/api.ts:103`; đặt `BUNDLE_BUDGET_STRICT=1` sau khi chốt ngưỡng để hồi quy bị chặn ở PR.
- **Test nên viết:** `bundle-budget.cjs` đã là cổng; thêm vào CI một bước `BUNDLE_BUDGET_STRICT=1` với ngưỡng chốt.

### D9-04 | P3 | agent sửa ngay | `GET /products/:slug/bought-together` quét toàn bộ dòng hàng của sản phẩm trong 90 ngày ở mỗi lần xem PDP, không cache

- **Vị trí:** `apps/api/src/modules/catalog/catalog.service.ts:314-342`.
- **Bằng chứng:** p50 4,8 → 8,3 → **20,6 ms** (p95 26) ở 100k `order_items` (sản phẩm này có 4.298 dòng); EXPLAIN: `Parallel Seq Scan on order_items` ×2 (`Execution Time: 27,5 ms`, 3 lần quét tuần tự mỗi lượt gọi: `seqscan.json`). Chưa có cache máy chủ (chỉ header `PublicCache('CATALOG')` ở `catalog.controller.ts:44-46`).
- **Kịch bản:** sản phẩm bán chạy có hàng chục nghìn dòng hàng trong 90 ngày → mỗi lượt xem PDP đốt CPU DB tỉ lệ thuận; chi phí tăng theo doanh số. Số này đo trên danh mục 48 biến thể nên planner chọn quét tuần tự; trên danh mục thật (~3.000 SP) kế hoạch có thể dùng index `(variationId, backorderedQty)`: chưa kiểm chứng.
- **Đề xuất sửa:** cache RAM theo `slug` TTL 10 phút (cùng kiểu cache brands/categories: `catalog.service.ts:98,435,460`) hoặc tính trước theo cron đêm.
- **Test nên viết:** unit: gọi 2 lần trong TTL chỉ chạy 1 `$queryRaw`.

### D9-05 | P3 | agent sửa ngay | `POST /orders/:code/repurchase` gọi `cart.addItem` từng dòng, mỗi lần dựng lại cả giỏ (~28 truy vấn/dòng)

- **Vị trí:** `apps/api/src/modules/orders/orders.service.ts:491-503` (vòng `for (const line of lines) await this.cart.addItem(...)`), `apps/api/src/modules/cart/cart.service.ts:287`.
- **Bằng chứng (đo):** đơn 4 dòng → **124 SQL** (p50 42 ms, p95 123 ms), trong đó 4 lần dựng lại giỏ bị bỏ đi (kết quả `addItem` không dùng); mỗi `addItem` đo riêng 28 SQL (mục 2.2). Tuyến tính theo số dòng: đơn 20 dòng ≈ 570 SQL (ngoại suy). Tối đa 100 dòng theo DTO (`orders/dto/orders.dto.ts:32`).
- **Tác động:** nút "Mua lại" của đơn lớn chậm hơn cần thiết; ghi tối đa N transaction. Không chặn khách.
- **Đề xuất sửa:** thêm `CartService.addItems(userId, lines)` thêm cả loạt trong một transaction và dựng giỏ một lần cuối.
- **Test nên viết:** unit: repurchase 8 dòng → số lời gọi `cart.addItem`/dựng giỏ không tăng theo dòng; kết quả `results[]` giữ nguyên (added/partial/skipped).

### D9-06 | P3 | agent sửa ngay | Dashboard và báo cáo doanh thu admin quét toàn bảng `orders` mỗi lần mở

- **Vị trí:** `apps/api/src/modules/admin/admin.service.ts:734-800` (`getDashboardStats`: 17 truy vấn song song, 9 `COUNT/SUM` trên toàn `orders`), `apps/api/src/modules/admin/admin-reports.service.ts` (`revenueReport`).
- **Bằng chứng:** dashboard p50 4,3 → 2,1 → **24,5 ms** (p95 48,5); `GET /admin/reports/revenue` 47,6 ms ở 50k đơn; `seqscan.json`: dashboard 2 lần quét tuần tự `orders` (101k dòng), revenue 1 lần (50k dòng) mỗi lượt gọi. 17 truy vấn song song dùng 17 kết nối của pool 20.
- **Tác động:** tuyến tính theo số đơn; ở 500k đơn ước ~250 ms và chiếm gần hết pool mỗi lần mở (ngoại suy, chưa đo). Chấp nhận được ở quy mô mở bán.
- **Đề xuất sửa:** cache RAM 30–60 s cho `getDashboardStats` và gom các `COUNT` theo trạng thái thành một `groupBy status`.
- **Test nên viết:** unit: hai lần gọi trong 30 s chỉ chạy truy vấn 1 lần.

### D9-07 | P3 | agent sửa ngay | Đọc thừa cố định trên đường giỏ → thanh toán (không phải N+1)

- **Bằng chứng (SQL của một request, `perf-data/measure-bulk.json`):** `checkout/quote` 19 SQL (đo K=4: 18) trong đó `orders ... status <> CANCELLED LIMIT 1` (`hasPriorOrder`, `common/first-order.ts:32`) chạy 2 lần và `users (id, phone, zaloId)` 2 lần; `checkout/coupon-previews` 25 SQL với cùng hai câu lặp 2 lần, `coupon_redemptions` groupBy 2 lần; `GET /cart` 14 SQL gồm `carts` đọc 3 lần cùng dòng; `POST /cart/items` 28–33 SQL; `GET /home/me` 25 SQL. Gọi `hasPriorOrder` ở `pricing/pricing.service.ts:45` (freeship đơn đầu) và `coupons/coupons.service.ts:159,210`.
- **Tác động:** vài truy vấn nhanh (< 1 ms mỗi câu), không đổi theo số dòng; chỉ cộng dồn dưới tải (mục 2.5: 39 SQL mỗi lượt mở Trang chủ).
- **Đề xuất sửa:** truyền kết quả `hasPriorOrder`/user đã đọc xuống hàm con (một lần mỗi request). Làm khi có việc khác ở các file này, không cần riêng.

### D9-08 | P3 | agent sửa ngay | Logo Trang chủ là PNG 1059×384 (54 KB) hiển thị ở 83×30 px

- **Vị trí:** `apps/miniapp/src/assets/tubu-logo.png`, `apps/miniapp/src/components/home/home-header.tsx:3,11-12,21`.
- **Bằng chứng:** `assets/tubu-logo-Byq5sWhB.png` 55.273 byte, kích thước nguồn 1059×384 (đọc từ header PNG), hiển thị `LOGO_WIDTH = 83`, `LOGO_HEIGHT = 30`; nguồn lớn gấp 12,8 lần chiều rộng hiển thị (3× màn hình cần ~250 px). Đây là ảnh duy nhất trên đường tải đầu của Trang chủ ngoài font.
- **Đề xuất sửa:** xuất lại PNG 250×91 (hoặc SVG): tiết kiệm ~50 KB (~11% tải đầu 440 KB ở mục 1.1).
- **Test nên viết:** không cần; kiểm bằng `bundle-budget.cjs` (nhóm "Ảnh và font" 198 KB → ~150 KB).

### D9-09 | P3 | agent sửa ngay | Danh sách mã giảm giá admin quét tuần tự bảng `coupons` 4 lần mỗi lượt gọi

- **Vị trí:** `apps/api/src/modules/admin/admin.service.ts:1434-1451` (`where scope != USER_GROUP AND batch IS NULL`, `findMany` + `count`).
- **Bằng chứng:** `seqscan.json`: `GET /admin/coupons` → `coupons: 4x / 80.012 dòng` (20.003 dòng mỗi lần quét), p50 4,5 ms. Không có index phủ điều kiện (chỉ `coupons_batch_idx`, `createdById+createdAt`).
- **Tác động:** thấp ở 20k; tăng theo số mã cá nhân (mỗi khách mới 1–2 mã chào mừng); ở 500k mã ước ~100 ms (ngoại suy, chưa đo).
- **Đề xuất sửa:** partial index `coupons("startAt" DESC) WHERE scope <> 'USER_GROUP' AND batch IS NULL` (migration), kiểm lại EXPLAIN.
- **Test nên viết:** EXPLAIN trong test tích hợp: không còn `Seq Scan on coupons` với 20k dòng.

---

## 5. Không báo lại (đã biết, trạng thái hiện tại kèm bằng chứng)

| ID cũ | Trạng thái hôm nay | Bằng chứng |
|---|---|---|
| A3-013 / D6-08 (bundle) | **còn mở, xấu hơn** | mục 1; ghi lại thành D9-03 với số đo mới và phân rã thư viện |
| A3-016 / C-104 (Pancake tuần tự, import giá đại lý) | còn mở, P3 | `pancake-sync.service.ts:444-470`, `admin.service.ts:1553`; tác động tính ở mục 3 |
| A3-001, 005, 006, 007, 009, 010, 014, 015 | đã đóng, giữ được ở quy mô lớn | mục 2.4, mục 3 |

---

## 6. Việc chưa làm kịp / chưa kiểm chứng

- Thời gian tải Trang chủ trong trình duyệt/Zalo WebView thật (cần Zalo SDK; Playwright không khởi động được app production), số request thực của bản production.
- Bundle và First Load JS của web Next (brief cấm `next build`).
- Đơn tách nhiều nhóm giao (nhiều gian hàng đối tác trong một giỏ) ở `checkout.service.ts:1161,1233`; số dòng giỏ > 12.
- Số đo trên Postgres bật `fsync` và trên cấu hình VPS Vietnix; chi phí `POST /events` và `place-order` ở PROD vì thế cao hơn số ghi ở đây.
- Chưa dùng `pg_stat_statements` để dò chi phí cron nền (chỉ đo đường HTTP); cron nền không chạy lượt nào trong cửa sổ đo (đã loại câu `cron_leases`).

---

## 7. Công cụ và cách chạy lại (`docs/2026-10-20-uat/tools/perf/`)

| File | Việc |
|---|---|
| `build-stats.mjs` | build Mini App bằng API Vite + thống kê module từng chunk (`perf-data/miniapp-chunks.json`) |
| `build-split.mjs` | build thử tách vendor để đo kích thước sau minify (ghi ra thư mục tạm) |
| `seed-perf.cjs small\|large`, `seed-bulk.cjs` | nạp dữ liệu vào `tubutree_perf` (chỉ chạy khi `DATABASE_URL` có `tubutree_perf`) |
| `measure.cjs <nhãn> [lọc]` | đếm SQL + p50/p95 (20 lần). `COLD=1` đo lần dựng cache; `MUT=1` thêm `POST /events`, repurchase; `SEQ=1` đếm quét tuần tự |
| `place-order-probe.cjs`, `conc.cjs` | SQL theo số dòng giỏ; tải đồng thời mở Trang chủ |
| `plan-modes.cjs`, `explain.cjs`, `planflip.py`, `slowlog.py` | so kế hoạch custom/generic, EXPLAIN, dò câu bị lật kế hoạch, tóm tắt câu chậm trong log Postgres |
| `nplus1-scan.py`, `nplus1-scan2.py` | quét tĩnh await-trong-vòng |

Dữ liệu thô: `perf-data/measure-{small,large,bulk}.json|txt`, `measure-mut-*.json`, `place-order-probe.json`, `conc-pool-*.json`, `seqscan.json`, `bundle-budget.txt`, `nplus1-scan*.txt`, `table-endpoints.md`.

Dọn dẹp: API 3229 đã dừng (`api-up.sh stop 3229`), cụm Postgres 25434 đã dừng (`pg-native.sh stop 25434`), Redis db 9 đã `FLUSHDB`; API 3221 và cụm 25432 không đụng tới.
