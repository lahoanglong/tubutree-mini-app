# A3 — Hiệu năng và tải (Performance + Load)

- **Ngày:** 2026-10-09
- **Commit:** `080bc75` (nhánh `hardening/2026-10`)
- **Phạm vi:** `apps/api` (NestJS + Prisma + Postgres), miniapp (Vite), web (Next 14). Không đụng PROD, không gọi dịch vụ ngoài.
- **Phương pháp:**
  1. Quét tĩnh bằng `scripts/loadtest/static-scan.cjs` (kết quả thô `results/static-scan.txt`), rồi lọc tay các trường hợp thật.
  2. DB riêng `tubutree_perf` trong container `tubu_pg` (1033 MB), seed lớn bằng `seed-large.ts`.
  3. `EXPLAIN (ANALYZE, BUFFERS)` các câu SQL trích từ `log_statement=all` khi gọi API thật (`sql-capture.cjs` → `explain-run.cjs` → `results/explain-all.json`, 105 câu) cộng các câu cron viết tay (`explain-cron.sql`).
  4. Tải: 1 instance API riêng cổng 3301 (`start-api.sh`, `node dist/main.js`, 768 MB heap) trỏ `tubutree_perf`, Redis DB số 5, mọi token dịch vụ ngoài để trống. Bộ phát tải tự viết bằng Node `fetch` (`loadlib.cjs` + `scenarios.cjs`), vì máy không có k6. Mỗi kịch bản chạy 3 lần cố định (16 VU) lấy trung vị, rồi ramp tăng dần.
  5. Bundle: build production trong worktree tạm (miniapp `vite build`, web `next build`), đo bằng `bundle-size.cjs`. Đếm request/bytes từng màn bằng Playwright (`page-weight.cjs`).
- **Giới hạn (đọc trước khi dùng số):**
  - Máy 14 lõi logic (Intel Core Ultra 5 225H), 15,5 GB RAM, **chỉ còn ~1,9 GB RAM trống khi đo**. API, Postgres (container WSL), Redis, bộ phát tải và các agent khác chạy chung một máy. Số tuyệt đối chỉ là cận tham khảo, không phải năng lực của VPS Vietnix (chưa biết cấu hình VPS: chưa kiểm chứng).
  - Lần đo sớm của kịch bản `home` (thư mục `results/run1-localhost`, `run2-127-with-dockerstats`) cho kết quả kém hơn nhiều (110–146 rps, lỗi 5–11%) so với lượt cuối (802 rps). Nguyên nhân ghi trong comment của `run-all2.sh`: dùng tên `localhost` (nhiễu resolve) và lấy mẫu `docker stats` giữa chừng. Chỉ dùng số của lượt cuối (`run-all2.sh`, `BASE=127.0.0.1`).
  - Throttler bị vượt bằng `X-Forwarded-For` riêng cho mỗi VU (API đặt `trust proxy=1`, `apps/api/src/main.ts:57`). Không có biến env tắt throttler. Ngưỡng 429 đo riêng ở mục 4.
  - Dữ liệu seed tất định, phân phối do tôi chọn (chưa so với PROD). Mọi kết quả "bao nhiêu người đồng thời" bên dưới là **ước lượng** theo giả định ghi rõ.
  - Số đo bundle miniapp bản production chỉ có kích thước file. Không đếm được request thật của bản production vì app cần Zalo SDK để khởi động (Playwright chỉ thấy 4 request rồi dừng). Số request miniapp lấy từ server dev (Vite).
  - Bản build web bị xoá cùng worktree, nên không chạy lại được `web-crawl-probe.cjs` (xem A3-003, bằng chứng là tĩnh + thăm dò API).

---

## 1. Bảng tổng hợp số đo

### 1.1 Tải API (1 instance, 16 VU cố định, trung vị 3 lần × 12 s; `results/*.json`)

| Kịch bản | Nội dung mỗi vòng | rps | p50 ms | p95 ms | p99 ms | Lỗi | 429 | CPU (lõi) | RSS |
|---|---|---|---|---|---|---|---|---|---|
| browse | list/search/suggest/PDP/related/categories/brands/flash (xác suất theo `scenarios.cjs`) | 534 | 23,7 | 74,3 | 87 | 0% | 0 | 2,5 | 423 MB |
| auth | `POST /auth/guest` + `GET /auth/me` + `POST /auth/refresh` | 535 | 32,8 | 46,0 | 58,9 | 0% | 0 | 2,2 | 430 MB |
| cart | `GET /cart`, `POST /cart/items`, `GET /cart` | 258 | 52,6 | 120,9 | 145,4 | 0% | 0 | 2,7 | 390 MB |
| checkout COD | thêm giỏ → quote → place-order (Idempotency-Key) | 206 | 63,9 | 138,4 | 156,3 | 0% | 0 | 2,8 | 404 MB |
| events | `POST /events` lô 10 sự kiện | 225 | 64,5 | 84,5 | 110,9 | 0% | 0 | 2,3 | 433 MB |
| home (16 request song song/VU) | 16 GET như miniapp Home | 802 | 191,9 | 326,4 | 382,6 | **3,3%** (ECONNRESET) | 0 | 3,1 | 358 MB |

Độ trễ từng endpoint ở 16 VU (cột p95, `perLabel` trong json):

| Endpoint | p50 ms | p95 ms |
|---|---|---|
| `GET /brands`, `/categories` (cache 60 s) | 2,9–3,3 | 18,7–19,2 |
| `GET /products/:slug` (PDP) | 13,4 | 37,6 |
| `GET /products` (list) | 27,8 | 57,2 |
| `GET /search/suggest` | 55,7 | 90,1 |
| `GET /products?q=` (tìm kiếm) | 69,5 | 101,1 |
| `POST /cart/items` | 88,1 | 122,7 |
| `POST /checkout/quote` | 45,6 | 57,1 |
| `POST /checkout/place-order` (COD) | 125,6 | 157,1 |
| `POST /auth/guest` | 39,2 | 49,1 |
| Home: `/products/for-you` | 338 | 444 |
| Home: mọi endpoint còn lại | 180–235 | 241–309 |

Trong kịch bản home, mọi endpoint có p50 gần như bằng nhau (180–235 ms) dù chi phí rất khác nhau. Điều này cho thấy độ trễ do **hàng đợi trong một tiến trình Node** (256 request đang bay: 16 VU × 16), không phải do từng câu SQL.

### 1.2 Ngưỡng gãy (ramp, 10–12 s/bậc; gãy = p95 > 1 s hoặc lỗi > 1%)

| Kịch bản | C=4 | C=8 | C=16 | C=32 | C=64 | C=96 | Ngưỡng gãy |
|---|---|---|---|---|---|---|---|
| browse (p95 ms / rps) | 38 / 299 | 60 / 401 | 75 / 547 | 245 / 310 | 436 / 307 | **1013** / 210 | **C≈96** (p95 vượt 1 s) |
| checkout (p95 ms / rps) | 48 / 148 | 75 / 185 | 151 / 198 | 292 / 206 | 712 / 190 | **1463** / 127 | **C≈96** |
| cart | 49 / 177 | 49 / 281 | 71 / 392 | 139 / 414 | 259 / 446 | không đo | chưa tới 1 s ở C=64 |
| auth | 15 / 450 | 29 / 523 | 52 / 496 | 96 / 499 | 164 / 547 | không đo | chưa tới 1 s ở C=64 |
| events | 37 / 145 | không đo | 134 / 217 | không đo | 369 / 199 | không đo | chưa tới 1 s ở C=64 |
| home (16 request/VU), p95 ms / rps | C=2: 35 / 724 | C=4: 129 / 601 (C=8: 171 / 771) | C=16: 354 / 685, lỗi 0,07% | không đo | không đo | không đo | chưa tới 1 s ở 16 VU (256 request đang bay) |

Số C=96 lấy từ lượt đo bổ sung `results/ramp-high/` (`FIX_SEC=3`, nên trung vị 16 VU của lượt đó thấp hơn bảng 1.1, do chạy ngắn và máy chia sẻ). Không bậc nào có lỗi > 1% hay 429. Cả hai kịch bản browse và checkout mất throughput khi vượt C=16 (browse từ 547 xuống 310 rps ở C=32), tức là đã bão hoà ở khoảng 16 kết nối đồng thời.

**Ước lượng người dùng đồng thời (giả định, chưa kiểm chứng ở PROD):** một người đang dùng app tạo trung bình ~0,6–1 request/giây (mở Home = 17 request, PDP = 13, Browse = 9, rồi ~10–15 giây/màn). Với máy đo này, 1 instance giữ p95 < 250 ms tới ~C=32 kịch bản browse (khoảng 300 rps) → **~300–500 người đang thao tác đồng thời**, và gãy ở ~C=96. Trên VPS nhỏ hơn máy đo thì con số này thấp hơn. Ước lượng này **không tính** A3-001 (`/me/coupons`): một endpoint đó có thể làm treo cả API (xem bên dưới).

### 1.3 Flash sale và đặt đơn trùng (`results/flash.log`)

| Bài kiểm | Kết quả |
|---|---|
| 200 user mua cùng 1 suất (quota 50), 3 vòng | Mỗi vòng: 50 thành công, 150 bị từ chối đúng (hết suất / đổi giá), **oversell = 0**, tồn kho, `soldCount`, `order_items` khớp nhau (`consistent:true`). Độ trễ vòng: p50 1,23–1,30 s, p95 1,34–1,41 s, tổng 1,36–1,44 s |
| 10 request song song cùng 1 user | Chỉ 1 đơn tạo (201), 9 bị chặn "Vượt giới hạn mua ưu đãi" |
| 10 request song song cùng Idempotency-Key | Chỉ 1 đơn tạo, `ordersCreated: 1` |

### 1.4 Thời gian một lần gọi (không tải, `results/sql-capture-out.txt`, DB lớn)

PDP 13 ms · related 12 · bought-together 21 · categories 23 (lần đầu, rồi cache) · brands 7 · list catalog 21–81 · search 48 · suggest 34 · for-you 46 · giỏ 17 · list đơn 15 (khách nhiều đơn: 17, 20 KB) · đếm đơn đang xử lý 6 · flash active 10 · notifications 6 · **feed 84–92** · **admin đơn 98 (34 KB)** · **admin dashboard 114**. Không gồm `/me/coupons` (xem A3-001: **742–913 ms**).

### 1.5 Dung lượng tải trang

| Màn | Môi trường | Số request | Bytes (raw / gzip) | Ghi chú |
|---|---|---|---|---|
| Miniapp entry (mọi màn) | **PROD build** | 4 (HTML, 1 JS, 1 CSS, ảnh logo) | 743 KB / 216 KB | `index.*.js` 617 KB raw / 196 KB gz + CSS 125 KB / 20 KB; bắt buộc tải xong mới khởi động |
| Miniapp tổng bundle | PROD build | 106 file | 1526 KB / 583 KB | 98 JS = 1256 KB / 417 KB. Chunk route lớn nhất: game 37 KB, affiliate 35 KB, checkout 32 KB, product-detail 28 KB |
| Miniapp Home | DEV (Vite, không bundle) | 117 (95 JS), **17 API** | 5481 KB / 1243 KB | Chỉ dùng để đếm API |
| Miniapp Browse / PDP / Cart / Checkout / Orders | DEV | 111–124, API 9 / 13 / 3 / 8 / 5 | 5,5–5,8 MB | như trên |
| Web trang chủ `/` | **PROD build** (`next start`) | 29 (18 JS) | 758 KB / 234 KB | 0 request API phía trình duyệt (SSR) |
| Web PDP `/san-pham/[slug]` | PROD build | 22 (15 JS) | 537 KB / 204 KB | |
| Web First Load JS (chung) | PROD build | | 87,3 KB | `/admin` 147 KB, `/merchant` 129 KB, `/thanh-toan` 120 KB, `/gio-hang` 113 KB, `/san-pham/[slug]` 101 KB |

So với `docs/audit-2026-09/07-tech-analytics.md`: entry miniapp tăng từ 505 KB / 158,7 KB gz lên **617 KB / 196 KB gz** (+22% / +24%), tổng bundle từ 1,38 MB lên 1,53 MB.

---

## 2. Điểm còn tốt (đã đo, không cần sửa)

- Không có oversell, không có đơn trùng dưới 200 user cùng mua 1 suất flash (mục 1.3).
- Phần lớn SQL nóng dùng index, dưới 3 ms: PDP, giỏ, list đơn của user (khách 20.000+ đơn: 0,85 ms), notifications (0,22 ms), flash active (0,1 ms), order_items/variations theo khoá.
- Đăng nhập khách và refresh p95 46 ms ở 16 VU, không lỗi.
- Kiểm tra `findMany` không `take`: phần lớn là bảng nhỏ (danh mục, ca làm, bậc hạng, mẫu trả lời nhanh, FAQ), truy vấn theo `id IN (...)` của trang hiện tại, hoặc theo từng user. Không phải lỗi hiệu năng ở quy mô hiện tại.
- Nightly `ec569f5b52` (feed tag upsert "tuần tự") **không đúng**: `community-feed.service.ts:497` dùng `Promise.all` (song song), tối đa `MAX_TAGS` thẻ. Bỏ khỏi danh sách.

---

## 3. Phát hiện

Quy ước nhóm file: thư mục/module bị đụng. Công sức S/M/L. Model đề xuất haiku/sonnet/opus.

### P1

**A3-001 | P1 | `GET /me/coupons` nạp mọi coupon còn hạn của mọi khách rồi lọc bằng JS: 742–913 ms một lần gọi, 8 lần song song cùng lúc làm cả API đứng 3,3–4,8 s**

- **Bằng chứng:** `apps/api/src/modules/loyalty/loyalty.service.ts:490-497` (`getAvailableCoupons`: `coupon.findMany({ where: { startAt <= now, endAt >= now } })` không `take`, không lọc scope trong SQL, rồi `coupons.filter(isCouponEligible)` trong Node). Trên `tubutree_perf`: 105.005 coupon, 35.019 còn hạn; câu SQL chỉ 13,5 ms (`Seq Scan on coupons`, 1957 buffers) nhưng cả endpoint 742, 913, 795 ms (`coupon-probe.cjs`). 8 request song song (`coupon-conc.cjs`): 3 vòng, mỗi request 2,4–4,8 s, tổng 3,4 / 4,8 / 3,9 s. DB dev local chỉ có 11 coupon nên không ai thấy.
- **Tác động:** endpoint được gọi mỗi lượt xem PDP của khách đã đăng nhập (đếm API PDP: có `/me/coupons`, `page-weight.json`). Chi phí là CPU Node (serialize 35k dòng, JSON, filter), nên 8 khách mở PDP cùng lúc chặn event loop ~4 s cho **mọi** endpoint khác (checkout, flash sale). Chi phí tuyến tính theo số coupon cá nhân (6 nơi sinh coupon theo từng khách, nguồn: A7-09). Số 35k là do seed 2 coupon cá nhân/khách × 50k khách; ở 10k khách thì ước khoảng 1/5 (chưa kiểm chứng).
- **Đề xuất sửa:** lọc scope ngay trong SQL (`scope = PUBLIC` hoặc `scopeMeta.userId = :user` hoặc nhóm hạng của user), thêm index `(endAt, startAt)` hoặc partial index theo scope, `take` hợp lý; chuyển phần `isCouponEligible` còn lại sang trang kết quả nhỏ. Nên chặn: coupon cá nhân hết hạn được dọn định kỳ.
- **Lệnh kiểm chứng:** `node scripts/loadtest/coupon-probe.cjs` và `node scripts/loadtest/coupon-conc.cjs` (cần instance 3301 chạy, `bash scripts/loadtest/start-api.sh`). Sau sửa kỳ vọng < 30 ms và 8 song song < 150 ms.
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/api/src/modules/loyalty`, `apps/api/src/modules/coupons`, `apps/api/prisma` (migration index)
- **Trạng thái:** CÒN MỞ từ `docs/audit-2026-09/07-tech-analytics.md` A7-09 (nay có số đo).

**A3-002 | P1 | Throttler toàn cục 60 req/phút/IP trong khi mở Home đã tốn 17 request: khách thật có thể bị 429 giữa hành trình mua; miniapp không xử lý 429**

- **Bằng chứng:** `apps/api/src/app.module.ts:58` (`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])`), `:109` (`APP_GUARD`). Không có storage Redis (bộ đếm trong RAM từng instance). Thăm dò `throttle-probe.cjs`: 1 IP, `/products`, kết quả `{"ok":60,"throttled":20,"firstThrottledAtRequest":61}` (`results/throttle.json`). Số request mỗi màn (`page-weight.json`, dev): Home 17, Browse 9, PDP 13, Cart 3, Checkout 8, Orders 5 → đi qua 4 màn đầu đã 42, thêm cuộn danh sách/đổi màn là vượt 60 trong một phút. `grep "429"` trong `apps/miniapp/src` không có xử lý riêng; `services/api.ts:21` ghi React Query `retry: false` cho 4xx. Chỉ endpoint AI có `UserThrottlerGuard` theo userId (`ai-advisor.controller.ts:16`).
- **Tác động:** 429 với người dùng đang mua; các khách sau cùng một IP (wifi cửa hàng, CGNAT nhà mạng di động ở Việt Nam) dùng chung một bộ đếm. Mức độ thật ở PROD chưa kiểm chứng (phụ thuộc phân bố IP và tần suất đổi màn thực tế). Load test của tôi tránh được vì mỗi VU có IP riêng nên không đo được ảnh hưởng này.
- **Đề xuất sửa:** khoá đếm theo `userId` khi có JWT (mở rộng `UserThrottlerGuard`), theo IP khi khách chưa đăng nhập; nâng giới hạn chung (gợi ý ~300/phút) và giữ giới hạn thấp chỉ cho endpoint nhạy cảm; thêm xử lý 429 (đọc `Retry-After`, thông báo thân thiện) ở miniapp; giảm số request của Home (A3-009).
- **Lệnh kiểm chứng:** `node scripts/loadtest/throttle-probe.cjs`; Playwright: mở Home + Browse + PDP trong 30 s với một IP, không được nhận 429.
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/api/src/app.module.ts`, `apps/api/src/common` (guard), `apps/miniapp/src/services/api.ts`
- **Trạng thái:** CÒN MỞ từ `docs/audit-2026-09/07-tech-analytics.md` A7-02 và `06-web.md` A6-13 (nay có số đo thực: 60 rồi 429; nặng thêm vì Home hiện 17 request).

**A3-003 | P1 | SSR của web dùng chung một bộ đếm throttle cho mọi khách: trang sản phẩm có thể ra 404 khi bị 429**

- **Bằng chứng:** `apps/web/src/lib/api.ts:61-67` (`getProduct`: `if (!res.ok) return null`), `apps/web/src/app/san-pham/[slug]/page.tsx:29-30` (`if (!product) notFound()`). Web gọi API nội bộ `http://api:3001/api` (`docker-compose.vietnix.yml:91`, `docker-compose.prod.yml:85`), mọi request SSR đến từ cùng một IP container, không có `X-Forwarded-For` của khách. Route `/san-pham/[slug]` là động (`ƒ`) trong bảng build (`results/web-build.log`) và `fetch` chỉ cache 300 s theo từng slug, nên mỗi sản phẩm khác nhau trong cùng một phút là một request mới. Giới hạn 60/phút/IP đã xác nhận ở A3-002. Không có `SkipThrottle` cho catalog (chỉ webhook/cashback, `grep SkipThrottle`).
- **Tác động:** Googlebot hoặc khách mở nhiều sản phẩm khác nhau (từ sitemap, chia sẻ) chạm 60 slug/phút thì trang thứ 61 trở đi trả "không tìm thấy" dù sản phẩm còn bán; có thể ảnh hưởng SEO. Chưa chạy end-to-end (build web đã bị xoá), và chưa kiểm chứng việc Next có cache luôn phản hồi lỗi hay không.
- **Đề xuất sửa:** cho SSR một đường không bị throttle (header bí mật nội bộ hoặc `skipIf` theo IP mạng nội bộ); đồng thời `getProduct` phân biệt 404 với lỗi khác (lỗi tạm thì `throw` để Next hiển thị lỗi 5xx/ISR giữ bản cũ, không `notFound()`).
- **Lệnh kiểm chứng:** build web rồi chạy `scripts/loadtest/web-crawl-probe.cjs` (120 slug trong vài giây; mong đợi 0 trang 404 giả).
- **Công sức:** S · **Model:** sonnet
- **Nhóm file:** `apps/web/src/lib/api.ts`, `apps/web/src/app/san-pham`, `apps/api/src/app.module.ts`
- **Trạng thái:** MỚI

**A3-004 | P1 | Các endpoint đăng nhập giới hạn 5 lần/phút/IP: đã đo, lần thứ 6 trở đi bị 429**

- **Bằng chứng:** `apps/api/src/modules/auth/auth.controller.ts:53,67,80,93` (`@Throttle({ default: { ttl: 60_000, limit: 5 } })` cho `zalo-mini-app`, `guest`, `zalo-oauth`, `refresh`). Đo trên 3301, 7 lần `POST /auth/guest` từ một IP: `200 200 200 200 200 429 429`.
- **Tác động:** nhiều người cùng IP (CGNAT, wifi cửa hàng, buổi ra mắt/sự kiện) mở app trong cùng phút: người thứ 6 không đăng nhập được, và `refresh` cũng bị tính vào 5 lần đó (xem A6-13: lỗi refresh làm mất phiên). Thang đo load test của tôi không bắt được vì dùng IP riêng mỗi VU.
- **Đề xuất sửa:** giữ giới hạn thấp theo định danh (deviceId/số điện thoại/zaloId) thay vì chỉ theo IP; giới hạn IP nới ít nhất 10 lần; `refresh` tách giới hạn riêng theo `userId`.
- **Lệnh kiểm chứng:** 7 lần `curl -X POST /api/auth/guest` cùng `X-Forwarded-For` (như trên) trên instance 3301.
- **Công sức:** S · **Model:** sonnet
- **Nhóm file:** `apps/api/src/modules/auth`
- **Trạng thái:** CÒN MỞ từ `docs/audit-2026-09/07-tech-analytics.md` A7-02, `06-web.md` A6-13.

### P2

**A3-005 | P2 | Danh sách feed đếm reaction/comment bằng join gộp toàn bảng: 63–90 ms ở 20k bài, tăng tuyến tính theo kích thước bảng**

- **Bằng chứng:** `apps/api/src/modules/feed/community-feed.service.ts:151` (`_count: { select: { reactions: true, comments: ... } }`) và `:353` (sắp xếp phổ biến theo `reactions: { _count: 'desc' }`). EXPLAIN (`explain-all.json` #63, #70, #77): `Hash Left Join` với hai subquery `GROUP BY postId` quét **toàn bộ** `feed_reactions` (100.000 dòng, `Seq Scan` 5,9 ms) và `feed_comments` (50.000 dòng), không phụ thuộc `LIMIT 20`: Execution Time 63,1 / 90,4 / 83,7 ms; HTTP `/feed` 84–92 ms, so với các endpoint khác 6–48 ms. Bảng `feed_posts` chỉ có 20.000 dòng. `pg_stat_user_tables`: `feed_reactions` 15.863 seq scan.
- **Tác động:** cộng đồng là tính năng khám phá; ở 10 lần dữ liệu (200k bài, 1M reaction) ước tính 0,6–0,9 s mỗi lần tải feed (ngoại suy tuyến tính, chưa đo).
- **Đề xuất sửa:** thêm cột đếm phi chuẩn hoá `reactionCount`/`commentCount` trên `feed_posts` (cập nhật cùng giao dịch), sắp xếp theo cột đó; hoặc đếm chỉ cho 20 `id` của trang bằng `groupBy` có `where postId IN (...)`.
- **Lệnh kiểm chứng:** `node scripts/loadtest/explain-run.cjs` (sau `sql-capture.cjs`) hoặc `EXPLAIN ANALYZE` câu feed; mong đợi < 5 ms và không còn `Seq Scan on feed_reactions`.
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/api/src/modules/feed`, `apps/api/prisma` (migration)
- **Trạng thái:** MỚI

**A3-006 | P2 | Danh sách đơn admin và dashboard quét tuần tự bảng orders (không có index theo `createdAt`; tìm kiếm ILIKE)**

- **Bằng chứng:** `apps/api/src/modules/admin/admin.service.ts:395-405` (`order.findMany` `orderBy createdAt desc` kèm `include: { items: true, user }`, cộng `order.count`), `admin-order-filter.ts:91-94` (`code/phone/fullName contains ... insensitive`). Index hiện có: `orders_status_createdAt_idx`, `orders_userId_status_idx`, v.v., không có index chỉ `createdAt`. EXPLAIN: danh sách không lọc 67 ms (`Parallel Seq Scan on orders`, 66.667 dòng/worker, 5933 buffer đọc đĩa; #85), đơn mới nhất của dashboard 30,8 ms (#97), `SUM(total)` theo trạng thái 37,4 ms (#100), tìm theo mã đơn `ILIKE '%2026100%'` 65,7 ms (C8). HTTP: admin đơn 98 ms (34 KB), dashboard 114 ms.
- **Tác động:** màn quản trị chậm dần theo số đơn (tuyến tính); 200k đơn hiện 70–110 ms, chưa nghiêm trọng, nhưng đây là các màn nhân sự dùng hằng ngày. Trả cả `items` của 20 đơn (34 KB).
- **Đề xuất sửa:** thêm index `orders(createdAt DESC)`, `pg_trgm` GIN cho `code` và `users.phone`; dashboard dùng `groupBy` có cache ngắn; `select` hẹp thay `include: items: true` ở danh sách.
- **Lệnh kiểm chứng:** `docker exec -i tubu_pg psql -U tubu -d tubutree_perf -f scripts/loadtest/explain-cron.sql` (mục C8) và EXPLAIN các câu #85/#97/#100.
- **Công sức:** S · **Model:** haiku
- **Nhóm file:** `apps/api/prisma` (migration), `apps/api/src/modules/admin`
- **Trạng thái:** CÒN MỞ từ `docs/audit-2026-09/06-web.md` A6-45 (nay có số đo).

**A3-007 | P2 | Tìm kiếm không dấu quét tuần tự toàn bảng products bằng `translate()+regexp_replace` mỗi lần, 2 truy vấn/lần tìm**

- **Bằng chứng:** `apps/api/src/modules/catalog/catalog.service.ts:164-176` (`textWhere`: `$queryRaw` với `regexp_replace(lower(translate(p.name, ...)))` LIKE `%...%`, giới hạn 300 id), dùng ở `list` (`:140`) và `suggest` (`:368`). EXPLAIN (#7, #11, #21): `Seq Scan on products` 21,8–25,6 ms với 3.044 sản phẩm (2.744 dòng bị loại), tức ~8 µs/dòng; so với danh sách thường 1,5 ms. HTTP search 48 ms, p95 101 ms ở 16 VU; suggest p95 90 ms.
- **Tác động:** tuyến tính theo số sản phẩm: ~250 ms ở 30k sản phẩm (ngoại suy, chưa đo). Hiện tại tạm ổn, nhưng suggest chạy theo từng phím gõ.
- **Đề xuất sửa:** cột sinh `name_fold` (hoặc `unaccent`) + GIN `pg_trgm`; gom 2 truy vấn thành 1.
- **Lệnh kiểm chứng:** EXPLAIN câu #7 trong `explain-all.json`; mong đợi dùng index, < 3 ms.
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/api/src/modules/catalog`, `apps/api/prisma` (migration)
- **Trạng thái:** MỚI

**A3-008 | P2 | Ba bảng tăng vô hạn, không có job dọn: `refresh_tokens`, `analytics_events`, `notification_logs`**

- **Bằng chứng:** `grep` toàn `apps/api/src` không có `refreshToken.deleteMany` (chỉ `updateMany` thu hồi: `auth.service.ts:338,432,442`), không có xoá cho `analytics_events` và `notification_logs`. `refresh_tokens` chỉ có index `userId` (`schema.prisma:297`), không có index `expiresAt`; thử dọn token hết hạn: 168 ms (`Parallel Seq Scan`, 92.470/300.000 dòng hết hạn, C11). Mỗi lần đăng nhập khách và mỗi lần refresh thêm một dòng. Số dòng seed: `analytics_events` 500k (bảng này tăng thêm khi app hoạt động), `notification_logs` 500k, `refresh_tokens` 300k. Cron nhắc giỏ bỏ quên đã phát 200 thông báo/giờ trong lúc đo (`api-3301.log` 13:00 và 14:00).
- **Tác động:** DB phình đều, truy vấn thống kê (`analytics_events` quét song song 283 ms/7 ngày, C6) chậm dần, sao lưu to dần. Chưa thể nói mốc nguy hiểm vì chưa biết tốc độ sinh dữ liệu ở PROD (chưa kiểm chứng).
- **Đề xuất sửa:** cron dọn theo lô (xoá token hết hạn + thu hồi quá 30 ngày; gộp/giữ `analytics_events` thô ~180 ngày; `notification_logs` ~90 ngày), thêm index `refresh_tokens(expiresAt)`.
- **Lệnh kiểm chứng:** sau dọn, `SELECT count(*)` ba bảng giảm, chạy lại C11/C6 trong `explain-cron.sql`.
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/api/src/jobs`, `apps/api/src/modules/auth`, `apps/api/src/modules/analytics`, `apps/api/prisma`
- **Trạng thái:** MỚI

**A3-009 | P2 | Mở Home tốn 17 request (16 song song): làm tăng tải throttle và hàng đợi; cần một endpoint gộp**

- **Bằng chứng:** `page-weight.json` (Home, dev): 17 request API (`/auth/guest`, `/me`, `/me/notifications`, `/me/purchased-items`, `/me/subscriptions`, `/me/wishlist/ids`, `/orders`, `/orders/active-count`, `/cart`, `/products` ×3, `/products/for-you`, `/flash-sales/active`, `/flash-sales/upcoming`, `/brands`, `/categories`), tổng 23 KB raw. Đo tải kịch bản `home` (16 request song song/VU, 16 VU = 256 request đang bay): p95 326 ms, 802 rps (mỗi lượt mở Home ≈ 16 request → ~50 lượt mở Home/giây trên máy đo); mọi endpoint p50 180–235 ms (hàng đợi, không phải SQL).
- **Tác động:** tốn ngân sách throttle (A3-002), tốn kết nối, và chi phí lặp (JWT verify, `findUnique user`, guard) 16 lần/lần mở app.
- **Đề xuất sửa:** endpoint BFF `GET /home` trả gộp (sản phẩm nổi bật/bán chạy/mới, flash active, brands, categories, số đơn đang xử lý), phần cá nhân hoá (`/me/*`) tải sau; các thông tin ít đổi gắn `Cache-Control` (A3-012). Cần đo lại bằng `scenarios.cjs home` (đổi sang 1 request).
- **Lệnh kiểm chứng:** `PERF_BASE=... node scripts/loadtest/page-weight.cjs` (đếm request Home) và `RAMP=2,4,8,16 node scripts/loadtest/scenarios.cjs home`.
- **Công sức:** L · **Model:** opus (đụng hợp đồng FE/BE)
- **Nhóm file:** `apps/api/src/modules/catalog`, `apps/miniapp/src/pages/home*`, `apps/miniapp/src/services`
- **Trạng thái:** MỚI

**A3-010 | P2 | ECONNRESET ~3,3% ở ~800 rps (kịch bản home) chưa tìm ra nguyên nhân**

- **Bằng chứng:** `results/home.log`: run1 0%, run2 3,62%, run3 3,3% (mẫu lỗi: `fetch failed ECONNRESET` trên nhiều endpoint khác nhau, không riêng một endpoint nào); ở ramp C=16 chỉ 0,07%. CPU API 3,1 lõi, log API (`api-3301.log`) không có lỗi/crash nào lúc đó. Có hai probe chẩn đoán đã viết (`conn-probe.cjs`, `conn-probe2.cjs`: so `http.Agent keepAlive` với `fetch`/undici) nhưng **chưa có kết luận được lưu**. Không có cấu hình `keepAliveTimeout` trong `apps/api/src` (mặc định Node 5 s).
- **Tác động:** có thể là lỗi phía bộ phát tải (undici) khi máy quá tải, hoặc kết nối bị đóng phía server khi Node bị trễ vòng lặp. Chưa kiểm chứng; nếu là phía server thì khách sẽ thấy lỗi mạng khi tải cao.
- **Đề xuất sửa:** chạy `node scripts/loadtest/conn-probe2.cjs` để so client, chỉnh `server.keepAliveTimeout`/`headersTimeout` của Nest (`main.ts`) lớn hơn timeout của proxy Caddy, rồi đo lại.
- **Lệnh kiểm chứng:** `RAMP=16 FIX_SEC=12 node scripts/loadtest/scenarios.cjs home` nhiều lần, so tỷ lệ lỗi.
- **Công sức:** S · **Model:** sonnet
- **Nhóm file:** `apps/api/src/main.ts`, `scripts/loadtest`
- **Trạng thái:** MỚI (chưa kiểm chứng nguyên nhân)

**A3-011 | P2 | Một tiến trình Node bão hoà quanh 16 kết nối; nhân bản instance chưa an toàn (cache, throttle, cron theo từng instance); chưa đặt cỡ pool Prisma**

- **Bằng chứng:** ngưỡng gãy ở mục 1.2 (browse và checkout gãy tại C≈96, mất throughput từ C=32). `catalog.service.ts:29-40` tự ghi chú cache brands/categories "KHÔNG AN TOÀN KHI SCALE" (cache RAM theo instance, không invalidate). Throttler dùng bộ nhớ RAM (A3-002). Cron chạy trong mọi instance: log 3301 cho thấy `Welcome vouchers granted: 5000/5000` (1:02 PM) và `Cart abandon reminders sent: 200` (hằng giờ) chạy ngay trong API; chưa kiểm chứng là có khoá chống chạy trùng khi có 2 replica. `DATABASE_URL` trong `.env` không có `connection_limit`, nên pool Prisma mặc định = `số lõi × 2 + 1` (29 trên máy 14 lõi, nhưng chỉ 5–9 trên VPS 2–4 vCPU; cấu hình VPS chưa biết).
- **Tác động:** tăng năng lực bằng cách thêm instance sẽ làm lệch cache, làm throttle yếu đi (mỗi instance đếm riêng) và có nguy cơ chạy cron nhân đôi. Pool nhỏ trên VPS là một nút cổ chai tiềm ẩn chưa đo.
- **Đề xuất sửa:** (a) đặt `connection_limit`/`pool_timeout` tường minh theo cấu hình VPS; (b) trước khi chạy ≥2 instance: chuyển cache và throttler sang Redis, thêm khoá phân tán cho cron (hoặc tách worker); (c) giữ 1 instance cho tới khi cần, vì sửa A3-001, A3-005, A3-009 giảm tải nhiều hơn.
- **Lệnh kiểm chứng:** chạy `scenarios.cjs browse` với `RAMP=16,32,64,96` trước/sau.
- **Công sức:** L · **Model:** opus
- **Nhóm file:** `apps/api/src/main.ts`, `apps/api/src/jobs`, `apps/api/src/modules/catalog`, `docker-compose*.yml`
- **Trạng thái:** MỚI

**A3-012 | P2 | API công khai không gắn `Cache-Control`; cache dữ liệu nóng chỉ nằm trong RAM của một instance**

- **Bằng chứng:** `grep -rn "Cache-Control" apps/api/src` không có kết quả (chỉ có ETag mặc định của Express). `/categories`, `/brands` có cache RAM 60 s (`catalog.service.ts:38-40`, `:329`, `:348`); `/flash-sales/active` (gọi ở Home và mọi PDP) và danh sách sản phẩm không cache (flash: `flash_sales` 90.957 lần seq scan, `pg_stat_user_tables`, bảng nhỏ nên chưa đau). `SystemConfigService` có cache RAM với TTL ngắn (`system-config.service.ts:11-32`).
- **Tác động:** mỗi lượt mở app đều đi qua API và DB cho dữ liệu hầu như không đổi (sản phẩm, danh mục, thương hiệu, cấu hình công khai); không tận dụng cache của Zalo WebView/CDN.
- **Đề xuất sửa:** `Cache-Control: public, max-age=30–60, stale-while-revalidate` cho các GET ẩn danh (catalog, brands, categories, `/config/public`, `/flash-sales/active`); với request có token chỉ dùng `private`. Dùng Redis làm cache chung khi mở rộng (A3-011).
- **Lệnh kiểm chứng:** `curl -I localhost:3301/api/categories` có header; Playwright đếm số request lần mở thứ hai.
- **Công sức:** S · **Model:** haiku
- **Nhóm file:** `apps/api/src/modules/catalog`, `apps/api/src/modules/system-config`, `apps/api/src/modules/flash-sale`
- **Trạng thái:** MỚI

**A3-013 | P2 | Bundle miniapp: một file entry 617 KB (196 KB gz) + CSS 125 KB, tăng 22% so với audit tháng 9**

- **Bằng chứng:** `results/miniapp-bundle.txt`: `index.Hh9DG_ao.module.js` 617 KB raw / 196 KB gz; CSS 125 KB / 20 KB; tổng 98 JS 1256 KB / 417 KB gz. Build in cảnh báo "Some chunks are larger than 500 kB" (`miniapp-build.log`). So với 505 KB / 158,7 KB gz ở `docs/audit-2026-09/07-tech-analytics.md`. Chunk lazy theo route nhỏ (≤ 37 KB), nên phần thừa nằm ở entry. Cảnh báo "auth.ts is dynamically imported ... but also statically imported" làm mất hiệu quả tách chunk.
- **Tác động:** mọi màn phải tải 743 KB raw (216 KB gz) trước khi chạy; trên mạng di động chậm là vài giây (chưa đo thời gian thật trên Zalo). Chưa vượt giới hạn Zalo nhưng xu hướng tăng.
- **Đề xuất sửa:** tách vendor (`manualChunks`), kiểm tra thư viện kéo vào entry (zmp-sdk, zod, axios, react-query), sửa import tĩnh/động của `store/auth.ts`.
- **Lệnh kiểm chứng:** `cd apps/miniapp && npx vite build` rồi `node scripts/loadtest/bundle-size.cjs apps/miniapp/www` (mục tiêu entry < 450 KB raw).
- **Công sức:** M · **Model:** sonnet
- **Nhóm file:** `apps/miniapp` (vite.config, store/auth)
- **Trạng thái:** MỚI (tiếp nối nhận xét "bundle không phải nút thắt" của A7).

### P3

**A3-014 | P3 | N+1 khi gộp giỏ khách vào tài khoản: 2–3 truy vấn cho mỗi dòng giỏ, trong một transaction**

- **Bằng chứng:** `apps/api/src/modules/auth/auth.service.ts:260-275` (`for (const item of guestCart.items)`: `cartItem.findUnique` + `update`/`delete`, tuần tự).
- **Tác động:** chỉ chạy một lần khi khách đăng nhập và có giỏ khách; giỏ thường vài món, nên vài ms đến vài chục ms. Không đáng ưu tiên.
- **Đề xuất sửa:** một `findMany` các dòng trùng + `updateMany` cho phần chuyển, `deleteMany` phần trùng.
- **Lệnh kiểm chứng:** jest `auth.service.spec` + đếm query bằng `DEBUG=prisma:query`.
- **Công sức:** S · **Model:** haiku · **Nhóm file:** `apps/api/src/modules/auth`
- **Trạng thái:** CÒN MỞ từ nightly backlog `e64687732a`.

**A3-015 | P3 | Hai danh sách chưa giới hạn: `affiliateLink.findMany` theo user và `subscription.findMany` theo user**

- **Bằng chứng:** `apps/api/src/modules/affiliate/affiliate.service.ts:141` và `apps/api/src/modules/subscriptions/subscriptions.service.ts:85`; không có `take`.
- **Tác động:** theo từng user, thường dưới vài chục dòng; không đo thấy vấn đề (subscriptions seed 20.000 dòng, `/me/subscriptions` trong Home p95 294 ms chỉ do hàng đợi).
- **Đề xuất sửa:** thêm `take` (ví dụ 200) hoặc phân trang.
- **Lệnh kiểm chứng:** `grep -n "findMany" <hai file>` có `take`.
- **Công sức:** S · **Model:** haiku · **Nhóm file:** `apps/api/src/modules/affiliate`, `apps/api/src/modules/subscriptions`
- **Trạng thái:** CÒN MỞ từ nightly backlog `2f2f22fefe`, `9063c0ecda`.

**A3-016 | P3 | Cron đồng bộ Pancake và import giá đại lý thực hiện truy vấn tuần tự theo từng biến thể**

- **Bằng chứng:** `apps/api/src/modules/integrations/pancake/pancake-sync.service.ts:46` (`@Cron('0 */15 * * * *')`), `:169-178` (mỗi biến thể: `variation.findUnique` rồi `variation.upsert`, vòng `for`); `apps/api/src/modules/admin/admin.service.ts:661-667` (`importDealerPrices`: `variation.update` + `dealerPriceHistory.create` trong vòng lặp).
- **Tác động:** với ~3.000 sản phẩm × vài biến thể là chục nghìn truy vấn tuần tự mỗi 15 phút ngay trong tiến trình API (cùng event loop với khách). Chưa đo thời gian thật (không chạy được vì thiếu khoá Pancake); nên xem là rủi ro tiềm ẩn.
- **Đề xuất sửa:** gom `findMany` theo lô `pancakeId IN (...)` trước, upsert theo lô trong transaction.
- **Lệnh kiểm chứng:** log thời gian một lượt sync trên môi trường có dữ liệu giả lập Pancake.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `apps/api/src/modules/integrations/pancake`, `apps/api/src/modules/admin`
- **Trạng thái:** MỚI

**A3-017 | P3 | Cron đêm quét toàn bộ đơn hàng: snapshot retention 476 ms ở 200k đơn, tăng tuyến tính**

- **Bằng chứng:** `apps/api/src/modules/analytics/analytics-aggregation.service.ts:18-36` (`@Cron('0 3 * * *')`, hàm cửa sổ `ROW_NUMBER() OVER (PARTITION BY customer_key ...)` trên mọi đơn `RETAIL` không huỷ/trả, JOIN users và `regexp_replace` số điện thoại). EXPLAIN (C1): 476 ms, `Seq Scan on orders` 158.125 dòng, sắp xếp ra đĩa 7,3 MB. Funnel theo sự kiện 7 ngày: 283 ms (C6).
- **Tác động:** chạy 3 giờ sáng, ảnh hưởng thấp ở 200k đơn; ở vài triệu đơn là hàng chục giây và nhiều bộ nhớ làm việc. Truy vấn cohort 30/60/90 ngày mà tôi viết thử mất 2 s (C7), **chưa xác nhận là cùng câu với code** (chưa kiểm chứng), nên không tính làm bằng chứng.
- **Đề xuất sửa:** chỉ tính cho cửa sổ ngày cần (lọc `createdAt`), lưu `firstOrderAt` theo khách thay cho window toàn bảng.
- **Lệnh kiểm chứng:** `explain-cron.sql` mục C1.
- **Công sức:** M · **Model:** sonnet · **Nhóm file:** `apps/api/src/modules/analytics`
- **Trạng thái:** MỚI

---

## 4. Đối chiếu nguồn cũ

| Nguồn | Mục | Kết luận sau khi kiểm bằng code/số đo |
|---|---|---|
| nightly `e64687732a` | N+1 gộp giỏ khách | CÒN MỞ (A3-014) |
| nightly `ec569f5b52` | Tag upsert tuần tự | **Không đúng**, đã song song (`Promise.all`), bỏ |
| nightly `2f2f22fefe`, `9063c0ecda` | listLinks / subscriptions không `take` | CÒN MỞ (A3-015) |
| nightly `a27ac00a73` | `suggest(q)` không kiểm độ dài | Chưa kiểm chứng ảnh hưởng hiệu năng; endpoint đo p95 90 ms, xem A3-007 |
| `docs/audit-2026-09/07` A7-09 | `getAvailableCoupons` nạp mọi coupon | CÒN MỞ, nay có số đo (A3-001) |
| `docs/audit-2026-09/07` A7-02, `06-web` A6-13 | Throttle theo IP | CÒN MỞ (A3-002, A3-004) |
| `docs/audit-2026-09/06` A6-45 | Thiếu index đơn mặc định, ILIKE | CÒN MỞ (A3-006) |
| `docs/audit-2026-09/07` A7-15 | PDP gọi nhiều lần + CTE bought-together | Đo hiện tại: PDP 13 ms, bought-together lần đầu 94 ms, sau đó 18 ms; không còn là nút thắt ở 3k sản phẩm |
| `docs/audit-2026-09/07` bundle 505 KB | Entry miniapp | Tăng lên 617 KB (A3-013) |

---

## 5. Quyết định nghiệp vụ cần chủ dự án

1. **Chính sách giới hạn tốc độ (throttle)?**
   - Khuyến nghị: đếm theo `userId` khi đã đăng nhập, theo IP khi chưa; giới hạn chung ~300 request/phút; đăng nhập/refresh đếm theo thiết bị hoặc tài khoản, nới giới hạn IP; SSR web được miễn.
   - Vì sao: Home đã 17 request, khách thật chạm 60/phút chỉ sau 3–4 màn; 5 lần đăng nhập/phút/IP chặn người dùng cùng wifi/CGNAT.
   - Phương án khác: giữ nguyên (rủi ro 429 khi đông) hoặc tắt hẳn throttle ở lớp app và dựa vào Caddy/Cloudflare.
2. **Thời hạn lưu dữ liệu `analytics_events`, `notification_logs`, `refresh_tokens`?**
   - Khuyến nghị: token hết hạn xoá sau 30 ngày; `analytics_events` thô 180 ngày (giữ bảng snapshot tổng hợp lâu hơn); thông báo 90 ngày.
   - Vì sao: các bảng này tăng vô hạn, hiện không có job dọn (A3-008).
   - Cần biết: có nghĩa vụ lưu lâu hơn (kế toán, chính sách riêng tư) không.
3. **Có chạy từ 2 instance API trong thời gian tới không?**
   - Khuyến nghị: chưa; ở lại 1 instance, sửa A3-001, A3-005, A3-009 trước (giảm tải nhiều hơn so với nhân instance).
   - Vì sao: cache, bộ đếm throttle và cron hiện nằm trong RAM của từng instance, nhân bản sẽ làm lệch và có thể chạy cron trùng (A3-011).
   - Cần biết: cấu hình VPS Vietnix (số vCPU, RAM) để đặt `connection_limit` đúng.
4. **Coupon cá nhân (`USER_GROUP` + `scopeMeta.userId`) có cần dọn khi hết hạn và tách khỏi coupon công khai không?**
   - Khuyến nghị: có; xoá/ẩn coupon cá nhân đã hết hạn theo lô và đánh index theo phạm vi.
   - Vì sao: số coupon sinh theo số khách, là nguyên nhân gốc của A3-001; lọc trong SQL chỉ giải quyết một nửa nếu bảng vẫn phình.
   - Phương án khác: tách bảng coupon cá nhân (đổi lược đồ, tốn công hơn).

---

## 6. Cách tái tạo và vận hành lại

**DB đo** `tubutree_perf` được giữ lại (50.004 user, 3.044 sản phẩm, 200.000 đơn, 428.902 dòng order_items, 60.000 review, 20.000 bài feed, 500.000 analytics_events, 500.000 notification_logs, 105.005 coupon; 1033 MB). Kiểm: `docker exec tubu_pg psql -U tubu -d tubutree_perf -Atc "select count(*) from orders"`.

Tái tạo từ đầu (không đụng DB `tubutree`):

```
docker exec tubu_pg createdb -U tubu tubutree_perf
cd apps/api
DATABASE_URL="postgresql://tubu:tubu@localhost:5434/tubutree_perf?schema=public" npx prisma migrate deploy
DATABASE_URL=... npx tsx prisma/seed.ts
DATABASE_URL=... npx tsx ../../scripts/loadtest/seed-large.ts     # ~250 s, xem results/seed-large.log
```

Đo lại:

```
bash scripts/loadtest/start-api.sh            # API cổng 3301 -> tubutree_perf (DEBUG_SQL=1 để log SQL)
bash scripts/loadtest/run-all2.sh             # browse/home/auth/cart/events/checkout, 3 lần + ramp
node scripts/loadtest/flash.cjs               # oversell flash sale
node scripts/loadtest/throttle-probe.cjs      # ngưỡng 429
node scripts/loadtest/coupon-probe.cjs && node scripts/loadtest/coupon-conc.cjs
OUT_DIR=$PWD/scripts/loadtest/results/ramp-high FIX_SEC=3 RAMP=96,160 node scripts/loadtest/scenarios.cjs browse
docker exec -i tubu_pg psql -U tubu -d tubutree_perf < scripts/loadtest/cleanup-test-data.sql   # dọn dữ liệu test, trả tồn kho/flash
```

`run-all2.sh` không tự dọn dữ liệu test; chạy `cleanup-test-data.sql` sau mỗi đợt (đã chạy xong, DB hiện ở trạng thái gốc: 200.000 đơn, 50.004 user). Instance 3301 đã được tắt sau khi đo.

Biến môi trường của `scenarios.cjs`: `FIX_C`, `FIX_SEC`, `RAMP`, `RAMP_SEC`, `OUT_DIR` (thêm trong phiên này để không ghi đè kết quả cũ), `PERF_BASE`. `page-weight.cjs`: `M_URL`, `ONLY_MINIAPP`, `OUT_FILE`.

## 7. Ghi chú môi trường và sự cố trong phiên này

- Khi xoá worktree tạm `D:\tubu-wt-perf`, `git worktree remove --force` đi xuyên qua các **junction** mà phiên trước đã tạo trong worktree (`node_modules` gốc và `packages/*/node_modules` trỏ về repo chính) và **xoá nhầm nội dung của repo chính**: 34 file đã theo dõi trong `packages/` (design-tokens, eslint-config, shared-types, typescript-config), nội dung `apps/{api,web,miniapp}/node_modules` và một phần `node_modules/.pnpm`. Đã khắc phục ngay: 34 file khôi phục từ `HEAD` bằng `git show` rồi chuyển lại CRLF (`git status` sạch, 0 file đổi trên dấu vết theo dõi); `pnpm install --frozen-lockfile --offline --ignore-scripts --force` (22 giây, dùng store `D:\.pnpm-store`) dựng lại toàn bộ `node_modules`. Đã kiểm: Prisma client kết nối được, `@nestjs/core` nạp được, API 3001 (200), miniapp 3113 (200), web 3112 (200 sau lần biên dịch lại). **Chưa chạy lại bộ test sau sự cố.** Thư mục rỗng còn sót `D:\tubu-wt-perf` (không còn junction) không xoá được vì đường dẫn bị chặn xoá; xoá tay khi tiện.
- Máy chỉ còn ~1,9 GB RAM trống khi đo; các số đo chịu ảnh hưởng của các tiến trình khác.
- Cổng 3301 đã được tắt khi hoàn tất; không đụng cổng 3001, 3112, 3113.

---

## Kiểm chứng độc lập (verifier)

- **Ngày/commit kiểm:** 2026-10-09, `080bc75`. Phạm vi: toàn bộ 4 phát hiện P1 (báo cáo không có P0). Phương pháp: đọc code, EXPLAIN trên `tubutree_perf`, curl nhẹ vào API dev 3001 (chỉ `/auth/refresh` với token giả và `GET /brands`, không ghi dữ liệu). Không chạy lại load test (instance 3301 đã tắt, báo cáo là đo tải).

| ID | Phán quyết | Bằng chứng | Mức đề xuất |
|---|---|---|---|
| A3-001 | **XÁC NHẬN** (số 742–913 ms chưa chạy lại vì cần instance 3301) | `loyalty.service.ts:491-497` đúng như mô tả: `coupon.findMany` chỉ lọc `startAt/endAt`, không `take`, rồi `filter(isCouponEligible)` trong Node. `tubutree_perf`: `coupons` 105.005 dòng (PUBLIC 23, USER_GROUP 104.982), 35.019 còn hạn; `EXPLAIN ANALYZE` 15,3 ms, `shared hit=1957`. Miniapp gọi ở PDP khi đã đăng nhập (`product-detail.tsx:66-72`, `account-api.ts:189`). Lưu ý: 105k coupon là do seed 2 coupon cá nhân/khách × 50k khách; tác động ở PROD tỉ lệ với số coupon cá nhân đang còn hạn (chưa biết). | P1 giữ nguyên (có điều kiện theo số coupon cá nhân ở PROD) |
| A3-002 | **BÁC BỎ một phần**: giả định nền sai | `@nestjs/throttler` 6.5.0 tạo khoá đếm theo **class + handler + IP**, không phải một bộ đếm chung (`node_modules/@nestjs/throttler/dist/throttler.guard.js:148-151`: `prefix = ${className}-${handlerName}-${name}`). Vậy 60/phút là **mỗi route mỗi IP**; "Home 17 + Browse 9 + PDP 13 = 42 request rồi vượt 60" là sai, vì các request đó đi vào các handler khác nhau (Home chỉ gọi cùng một route `/products` 3 lần). Kiểm tay: 7 lần `GET /brands` cùng một XFF đều 200. Phần còn đúng: nhiều khách chung một IP (wifi cửa hàng, CGNAT) chung bộ đếm của từng route; miniapp không xử lý 429 riêng (`grep 429` trong `apps/miniapp/src` không có; `app.tsx:81-83` không retry 4xx). Nguy cơ thực nằm ở route nóng nhất (`/products`) với IP dùng chung, mức chưa kiểm chứng ở PROD. | **P1 → P2** (đề xuất sửa vẫn hợp lý: đếm theo userId, thêm xử lý 429; sửa lại mô tả "60/phút toàn IP") |
| A3-003 | **XÁC NHẬN code, tác động bị thổi phồng** | `apps/web/src/lib/api.ts:61-67` (`!res.ok → null`) và `san-pham/[slug]/page.tsx:29-30` (`notFound()`) đúng. Web gọi API qua `API_BASE_URL: http://api:3001/api` (`docker-compose.prod.yml:85`, `docker-compose.vietnix.yml:91`) nên mọi SSR chung một IP container. Nhưng vì khoá đếm theo handler (xem A3-002), giới hạn chỉ áp cho **riêng route chi tiết sản phẩm**: 60 slug khác nhau/phút cho toàn site (fetch cache 300 s theo slug). Chủ yếu crawler/burst; chưa kiểm chứng Next có cache phản hồi lỗi không (báo cáo cũng nêu). Việc `notFound()` cho mọi lỗi (kể cả 429/5xx) là lỗi thiết kế có thật. | **P1 → P2** |
| A3-004 | **XÁC NHẬN**, riêng một chi tiết sai | `auth.controller.ts:53,67,80,93` đều `limit: 5`. Kiểm trực tiếp trên 3001: `POST /auth/refresh` token giả cùng XFF: `401 401 401 401 401 429 429` (lần 6 bị chặn). Chi tiết sai: `refresh` có bộ đếm 5/phút **riêng** (khoá theo handler), không bị tính chung với `guest`; nhưng chính `refresh` 5/phút/IP lại khắc nghiệt hơn cho nhiều thiết bị chung IP. Chưa kiểm `POST /auth/guest` trực tiếp để tránh tạo user rác trong DB dev. | P1 giữ nguyên |

**Khẳng định "không có" đã kiểm:** `SkipThrottle` chỉ ở cashback/pancake webhook/payment/zalo-oa webhook (grep khớp báo cáo); `UserThrottlerGuard` chỉ ở `ai-advisor.controller.ts:16` (khớp).
