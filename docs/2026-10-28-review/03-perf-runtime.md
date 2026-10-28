# 03b. Đo hiệu năng chạy thật (số TRƯỚC, baseline)

Ngày đo: 2026-10-28 09:20 đến 09:50. Mã `9d0e95bd5` (nhánh `review/2026-10-28`, không sửa gì ở `apps/` `packages/`). Dữ liệu: lane 5 (Postgres 25432, Redis db 5).
Số gốc: `perf/baseline.json` (có đủ 3 lần chạy, load máy trước mỗi phép đo). Chạy lại một lệnh, mỗi gói sửa đo sau để so:

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
node docs/2026-10-28-review/tools/perf/run-all.mjs --label <gói> --out docs/2026-10-28-review/perf/after-<gói>.json   # ~25 phút
node docs/2026-10-28-review/tools/perf/table.mjs perf/baseline.json perf/after-<gói>.json   # bảng "trước → sau"
```
Tuỳ chọn: `--build-web` (mã `apps/web` đổi thì build lại trước khi đo), `--only web,lh,mini,api`, `--runs`, `--duration`. Script tự bật rồi tự dừng web 3601, máy chủ tĩnh Mini App 3603, API phụ 3611. Mã đo ở `R/tools/perf/` (`lib.mjs`, `web.mjs`, `lighthouse.mjs`, `mini.mjs`, `mini-static.mjs`, `api.mjs`, `prisma-query-log.cjs`, `run-all.mjs`, `table.mjs`).

## 1. Cách đo (để hiểu giới hạn của số)

- Mỗi số đo chạy 3 lần, lấy trung vị; trình duyệt mới mỗi lần (không cache). `top -l 1 -n 0` ghi trước mỗi lần: load 1,3 đến 1,7 lúc đo web/Mini App/API; cuối lượt đo API load lên 7,5 (do agent khác, các số autocannon có thể bị ảnh hưởng nhẹ; 3 lần chạy của mỗi endpoint lệch nhau dưới 1 ms).
- Web: build có sẵn `apps/web/.next` (đã trỏ API lane 5 lúc build, không cần build lại) chạy `next start` cổng 3601. Playwright Chromium, Moto G 360x640 dsf 3, Slow 4G (1,6 Mbps xuống, 150 ms RTT) và CPU x4 qua CDP. Web-vitals đọc bằng PerformanceObserver trong trang: FCP, LCP, CLS (tổng mọi dịch chuyển), TBT (tổng phần dài hơn 50 ms của long task từ FCP tới cuối phép đo, không phải tới TTI), INP (độ trễ lớn nhất của một lần bấm thật, Event Timing).
- Persona: trang chủ, danh sách, thanh toán dùng `returning` (cookie `tubu_rt` + cờ như `web-session.mjs`). Chi tiết SP dùng `new` vì bước bấm "Thêm vào giỏ" ghi vào giỏ; script xoá dòng vừa thêm sau mỗi lần (đã kiểm: giỏ `new` về 0, `returning` còn 2 dòng như seed).
- Thao tác INP: home bấm "Mã của tôi", list bấm sắp xếp "Bán chạy", detail "Thêm vào giỏ", checkout "Mã giảm giá".
- Lighthouse 13.6.0 mobile (mô phỏng mặc định của nó) chạy được cho 3 trang công khai, khách chưa đăng nhập; thanh toán cần đăng nhập nên chỉ có số Playwright. Số Lighthouse và Playwright khác nhau (Lighthouse mô phỏng băng thông tính toán, LCP chọn phần tử khác) nên chỉ so trước/sau trong CÙNG công cụ.
- Mini App: bản `apps/miniapp/www` đang trỏ `api.tubutree.com` nên KHÔNG dùng. Build riêng `VITE_API_BASE_URL=http://localhost:3251/api vite build --mode perf` ra `docs/2026-10-20-uat/tools/uat-harness/state/perf-mini-www` (đã gitignore; `--mode perf` vì bản `production` từ chối localhost theo `src/build-env.ts`). Bản build tĩnh chạy ngoài Zalo cần hai thứ bộ khung cũ không có: (1) `window.APP_ID` vì ZMPRouter ở production đặt basename `/zapps/<APP_ID>` (không có thì trang trắng, không báo lỗi), URL đo là `/zapps/2070857098114207963/...`; (2) khoá lưu của ZMP storage có tiền tố `<APP_ID>_`. Persona `returning` nhét refresh token thật vào `localStorage` (app gọi `/auth/refresh`); `guest` để app tự gọi `/auth/guest`. Máy chủ tĩnh `mini-static.mjs` có gzip như CDN.
- API: `autocannon@8.0.0`, 10 kết nối, 20 giây, 3 lần, header `x-throttle-bypass`. autocannon không có p95: bảng ghi p90, p97,5 (cận trên của p95) và p99. Dữ liệu lane rất ít và API chạy cùng máy với Postgres/Redis, nên chỉ dùng so tương đối trước/sau.
- Đếm SQL: API phụ cổng 3611 cùng DB/Redis lane 5, nạp `prisma-query-log.cjs` (`node -r`) bọc `PrismaClient` để phát sự kiện query. Cách có sẵn "bật log query Prisma" không có trong mã (`PrismaService` không đặt `log`, và `DEBUG=prisma:query` không in gì ở Prisma 5.22), nên dùng lớp bọc ngoài mã sản phẩm. Gọi mỗi endpoint hai lần: lần 1 có thể trúng hoặc trượt cache Redis/bộ nhớ, lần 2 thường trúng cache. Số SQL không tính BEGIN/COMMIT. Cron nền của API phụ có thể chen một câu (config_public lần 2 ra 1 câu là kiểu nhiễu này, chưa kiểm).
- Giới hạn chung: ảnh sản phẩm trong seed trống, nên LCP luôn là chữ; khi có ảnh thật số LCP sẽ khác. CPU x4 trên máy M-series nhẹ hơn điện thoại thật nên TBT = 0 không có nghĩa là không có việc nặng.

## 2. Bảng số trung vị

### Web, Moto G + 4G chậm + CPU x4 (next start, API lane 5)

| Trang | persona | FCP ms | LCP ms | CLS | TBT ms | INP ms | tải JS KB | request | API |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| home / | returning | 668 | 668 | 0.416 | 0 | 32 | 369 | 89 | 21 |
| list /san-pham | returning | 568 | 3036 | 0.000 | 0 | 16 | 357 | 72 | 10 |
| detail /san-pham/mat-ong-rung-bhnong | new | 576 | 576 | 0.012 | 0 | 32 | 244 | 51 | 12 |
| checkout /thanh-toan | returning | 560 | 2916 | 0.313 | 0 | 32 | 232 | 48 | 8 |

### Web, Lighthouse mobile (khách)

| Trang | Điểm | FCP | LCP | TBT | CLS | SI |
|---|---:|---:|---:|---:|---:|---:|
| home | 94 | 1204 | 1204 | 0 | 0.143 | 1204 |
| list | 85 | 779 | 4387 | 0 | 0.000 | 1011 |
| detail | 84 | 1203 | 4526 | 0 | 0.042 | 1205 |

### Mini App, 375 + 4G chậm + CPU x4 (bản build tĩnh, API lane 5)

| Ô | FCP ms | LCP ms | thẻ SP đầu ms | CLS | TBT ms | JS KB | request | API | /auth xong | /home xong |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| home:returning | 1652 | 1652 | 2322 | 0.456 | 0 | 222 | 20 | 11 | 1910 | 2277 |
| home:guest | 1648 | 3384 | 2235 | 0.828 | 0 | 222 | 20 | 11 | 3019 | 2189 |
| browse:returning | 1604 | 2532 | 2509 | 0.000 | 0 | 234 | 26 | 11 | 1809 | - |
| browse:guest | 1612 | 3328 | 3305 | 0.000 | 0 | 234 | 26 | 11 | 2999 | - |
| product:returning | 1600 | 2608 | 2588 | 0.000 | 0 | 270 | 38 | 13 | 1846 | - |
| product:guest | 1604 | 3304 | 3269 | 0.036 | 0 | 270 | 38 | 13 | 2997 | - |

### API lane 5, autocannon 10 kết nối (ms; p97,5 là cận trên của p95)

| Endpoint | p50 | p90 | p97,5 | p99 | req/s | SQL lần 1 | SQL lần 2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| home /home | 0.0 | 1.0 | 1.0 | 1.0 | 11113 | 22 | 0 |
| products_list /products?limit=12 | 2.0 | 3.0 | 3.0 | 4.0 | 3554 | 3 | 3 |
| product_detail /products/mat-ong-rung-bhnong | 1.0 | 2.0 | 2.0 | 2.0 | 5387 | 3 | 3 |
| config_public /config/public | 0.0 | 1.0 | 1.0 | 1.0 | 13102 | 0 | 1 |
| home_me /home/me?purchasedLimit=10 | 9.0 | 10.0 | 11.0 | 12.0 | 1099 | 26 | 18 |
| me /me | 1.0 | 2.0 | 2.0 | 2.0 | 5939 | 1 | 2 |
| cart /cart | 9.0 | 10.0 | 11.0 | 11.0 | 1064 | 22 | 18 |

Ghi chú bảng: ô Mini App `browse`/`product` thêm để so; "thẻ SP đầu" = lúc chữ tên sản phẩm (trong 8 sản phẩm đầu của `/products`) xuất hiện trong DOM; "/auth xong", "/home xong" = ms từ lúc bắt đầu điều hướng tới khi request kết thúc. Web "API" = số request tới API trong lúc tải (kể cả trùng); "request" = mọi request của trang.

## 3. Nhận xét ngắn

Màn chậm nhất theo từng chỉ số (Slow 4G, CPU x4):

1. **Mini App trang chủ, CLS 0,46 (returning) và 0,83 (guest).** Trên 0,1 là "kém" (kém khi trên 0,25). Nguồn dịch chuyển lấy bằng LayoutShift.sources (đo thêm một lần, không nằm trong run-all): các khối trang chủ hiện không đồng thời rồi đẩy nhau xuống. Khối "Danh mục", "Hành trình nguyên liệu", "Ưu đãi giờ vàng", lưới lối tắt "Đổi quà/Vườn Xanh/Đổi rác/Mua chung" (cao 208 px, bị đẩy 126 → 496 px), "Bán chạy", "Mua lại": mỗi khối đến lúc /home, /flash-sales, /home/me về là nhảy 100 đến 370 px. Ba lần chạy cho đúng cùng số (0,456 ba lần), nên là lỗi cố định, không phải nhiễu. Nghi nguyên nhân: khối không giữ chiều cao sẵn (skeleton thấp hơn nội dung thật), khối cá nhân chèn lên trên khối đã vẽ. File nguồn: `apps/miniapp/src/components/home/*` (chưa đọc chi tiết từng khối).
2. **Web trang chủ, CLS 0,42 (returning); thanh toán CLS 0,31.** Cùng kiểu: lưới lối tắt "Đổi quà/Vườn Xanh/Đổi rác/Mua chung" nhảy 324 → 500 px (0,131), "Danh mục" và "Ưu đãi giờ vàng" nhảy sau 3,1 đến 3,8 giây. Thanh toán: "Phương thức thanh toán", "Mã người giới thiệu", "Ghi chú" bị đẩy xuống khoảng 120 đến 250 px lúc địa chỉ và quote về (t=2,9 giây, tổng 0,31). Lighthouse khách vãng lai: home CLS 0,143.
3. **Web danh sách và thanh toán, LCP 3,0 và 2,9 giây trong khi FCP 0,57 giây.** Khung hiện sớm nhưng phần chính (thẻ sản phẩm, dòng đầu của thanh toán) phải chờ dữ liệu phía trình duyệt: danh sách gọi thêm 10 request API, thanh toán 8 request (`/auth/refresh`, `/me`, `/me/addresses`, `/cart`, `/checkout/quote`, ...), tuần tự nhiều bước (refresh rồi mới tới các lời gọi khác). Lighthouse khách: danh sách LCP 4,4 giây (điểm 85), chi tiết SP LCP 4,5 giây (điểm 84), trang chủ 1,2 giây (điểm 94).
4. **Web trang chủ nặng request nhất: 89 request, 21 lời gọi API, 369 KB JS truyền (đã nén).** Khách đã đăng nhập gọi cùng lúc `/me`, `/me/coupons`, `/me/notifications`, `/me/loyalty`, `/me/wishlist/ids`, `/me/purchased-items`, `/me/daily-check-in`, `/orders` (2 trạng thái), `/cart`, `/flash-sales/active` (hai lần), `/feed`, `/feed/public-preview`... `/flash-sales/active` bị gọi hai lần trong cùng lần tải (theo `screens/index-web375.jsonl` của lane chụp ảnh; chưa kiểm chỗ phát sinh trong mã).
5. **Mini App FCP 1,6 giây là gần như toàn bộ thời gian tải entry.** Entry 222 KB gzip (711 KB raw, vượt ngưỡng 700 KB của `bundle-budget`) tải qua 1,6 Mbps mất khoảng 1,1 giây cộng RTT; trước đó màn trắng. Trang chủ chỉ tải 1 file JS (route khác lazy: browse 8 file, product 19 file). TBT 0 vì CPU x4 chưa đủ làm long task; chỉ 1 long task ở trang chủ.
6. **Mini App khách (guest): `/auth/guest` xong lúc 3,0 giây, returning `/auth/refresh` xong lúc 1,9 giây;** LCP khách 3,4 giây vs returning 1,65 giây (trang chủ) và 2,5 đến 2,6 giây (browse, product). Chênh 1,1 giây rất có thể là hành vi ngoài Zalo: `getAccessToken` thử lại với giới hạn 3 giây (`apps/miniapp/src/services/zmp-bridge.ts:64`) rồi mới rơi về khách; trong Zalo thật có thể khác. Chưa kiểm trong Zalo, nên không dùng số khách làm mốc tuyệt đối. Thẻ sản phẩm đầu của khách vẫn hiện lúc 2,2 giây vì `/home` không chờ đăng nhập (xong 2,2 giây).
7. **API: nhanh ở dữ liệu ít, nhưng nhiều câu SQL cho các endpoint cá nhân.** `/home` 22 câu lần đầu (0 sau cache), `/home/me` 26 rồi 18 câu (p50 9 ms, nặng nhất, ~1100 req/s), `GET /cart` 22 rồi 18 câu (p50 9 ms, ~1060 req/s, chỉ để đọc giỏ), `/products` 3 câu, chi tiết SP 3 câu, `/me` 1 đến 2 câu, `/config/public` 0 đến 1 câu (p50 0 ms, 13 000 req/s). Mở trang chủ returning gọi `/home` + `/home/me` + `/cart` + `/me` + `/me/loyalty` + `/me/coupons` + `/orders` + `/feed`... Tổng SQL một lần mở trang chủ returning cỡ vài chục câu. Với dữ liệu thật lớn hơn, `/home/me` và `/cart` là hai ứng viên chậm trước. Chưa đọc `EXPLAIN` từng câu.
8. **Chạm bấm (INP) tốt:** 16 đến 32 ms ở cả 4 màn web; chưa phải vấn đề ở mức đo này (bấm "Thêm vào giỏ" chỉ đo độ trễ vẽ lại, không đo thời gian API trả về).

## 4. Gợi ý ưu tiên cho các gói sửa (số trước để so)

- CLS trang chủ Mini App/web và thanh toán web: giữ chỗ (min-height) cho từng khối, không chèn khối cá nhân phía trên khối đã vẽ. Đích: CLS dưới 0,1.
- LCP danh sách/thanh toán web: lấy dữ liệu ở máy chủ (đã ISR cho khung) hoặc gọi song song thay vì chờ `/auth/refresh`.
- Số request trang chủ web: gộp (kiểu `/home` + `/home/me` của Mini App) và bỏ gọi trùng `/flash-sales/active`.
- Mini App entry: chuyển `onboarding`, `coupon-claim-gate`, `flash-sale`, `purchased-rail`, `subscribe-sheet` sang lazy (xem `03-perf-build.md`); lưu ý tách vendor không giảm byte tải.
- SQL: giảm câu của `/home/me` và `GET /cart`.

## 5. Cái chưa kiểm

- Số Mini App đo ngoài Zalo (giả `APP_ID`, SDK không có); chưa so với Zalo thật.
- Ảnh sản phẩm thật (seed trống) và dữ liệu lớn: LCP và p95 API sẽ khác.
- Tiến trình dừng khi xong: cổng 3600 đến 3619 đã trống (`lsof` kiểm cuối, 0 tiến trình). Không dùng cổng khác ngoài lane 5 (API 3251, đọc và gọi API) và Postgres/Redis dùng chung.
