# Audit hiệu năng gl-1103 (vùng `hieunang`)

Ngày đo: 2026-11-03, mã `main` 52fd5cd65 (= PROD 0aa8af5d1 + tài liệu), lane 5. Chỉ đọc và đo, không sửa mã, không commit, không đụng PROD. Mọi file thô nằm ở `docs/2026-11-03-golive/audit/hieunang/` (đường dẫn tương đối từ gốc worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs`).

## 0. Điều kiện đo (đọc trước khi tin số tuyệt đối)

- Máy đo dùng chung với nhiều phiên khác: load average 50 đến 166 trong suốt buổi đo (baseline 28/10 đo lúc load ≈ 1,4). Vì vậy FCP/LCP/TBT/Lighthouse tuyệt đối bị thổi phồng (ví dụ `perf-main.json` Mini home:returning FCP 9908 ms, một run 40 s). Không dùng chúng để kết luận "chậm hơn 28/10".
- Những thứ KHÔNG phụ thuộc tải máy và đáng tin: kích thước gói (byte), số request, số lời gọi API, số câu SQL, header `Cache-Control`, CLS cấu trúc (cùng một ca nhảy lặp lại 3/3 run hoặc 2/2 run), so sánh tương đối hai bản build đo cùng điều kiện.
- Emulation của công cụ: Moto G, 375×812, Slow 4G 1,6 Mbps/150 ms, CPU ×4 (web1280 không giảm CPU). Bản build production: Mini static trên 3603 (`vite build --mode perf`), web `next start` trên 3601, API SQL-đếm trên 3611, dữ liệu lane 5 (không có ảnh SP, không có Giờ vàng/combo đang chạy, nên các nhánh đó không được đo).
- Run lẻ có LCP 50 đến 66 s (Mini `best-sellers`, `loyalty`; web375 `offers`) là máy đứng hình; chạy lại thì mất (`probe-mini-rerun.log`). Không tính.

## 1. So với 28/10 (`docs/2026-10-28-review/perf/baseline.json`)

| Chỉ số | 28/10 (9d0e95bd5) | 31/10 – 01/11 | Nay (52fd5cd65) | Nhận xét |
|---|---|---|---|---|
| Mini entry (raw / gzip) | 711 / 222 KB | 695 / 217 (#88); 631 / 196 (cổng 01/11) | 659 / 205 KB | Dưới ngưỡng cảnh báo 700, trên đích 450. Không hồi quy. |
| Mini tổng (raw / gzip) | 1945 / 751 KB | 1997 / 774 KB | 2214 / 862 KB (212 file) | +217 KB raw, +88 KB gzip so với 31/10; vượt ngưỡng cảnh báo 2048 KB của `bundle-budget.cjs` (xem HIEUNANG-08). |
| Mini JS tải khi mở (idle prefetch) | 222 KB, 1 request JS | 330 KB sau integ | 396 đến 401 KB, 77 đến 78 request JS | Xem HIEUNANG-07. Tổng request 88 đến 117 (28/10: 20). |
| Web First Load (gzip) trang khách | `/` 204, `/san-pham` 157, PDP 174, `/gio-hang` 163, `/thanh-toan` 191, `/tai-khoan` 170 | | `/` 260, `/san-pham` 222, PDP 231, `/gio-hang` 224, `/thanh-toan` 245, `/tai-khoan` 225 | +44 đến +65 KB gần như mọi trang (xem HIEUNANG-01). Chung 103 → 104 KB. |
| Web JS chuyển qua mạng, trang chủ returning | 369 KB | 375 KB (integ) | 482 KB | +113 KB (+31 %). |
| API gọi khi mở web trang chủ returning | 21 | | 11 đến 12 | Tốt hơn nhiều (dùng `/home` + `/home/me`). |
| API gọi khi mở Mini trang chủ returning | 11 | | 11 | Giữ nguyên. |
| CLS web trang chủ returning (cold) | 0,416 | 0 (integ, máy có cookie gợi ý) | 0,198 (375), 0,324 (1280) | Giảm so với 28/10, nhưng ca máy mới/chưa có gợi ý còn 0,14 đến 0,32 (HIEUNANG-03). |
| SQL `/home/me` (lần 1 / 2) | 26 / 18 | 17 đến 19 | 15 / 11 | Đạt đích ≤ 12 (R-82) khi nóng. |
| SQL `/cart` (lần 1 / 2) | 22 / 18 | 13 (R-82); 7 đến 8 giỏ lane 3/9 | 20 / 15 | Đích ≤ 8 chưa đạt với giỏ persona returning lane 5 (HIEUNANG-05). |
| SQL `/home` | 21 (không cache) | | 21 → 0 (cache `s-maxage=10`) | Tốt. |
| SQL `/products?limit=12` | 3 / 3 | | 3 / 3 | Giữ nguyên. |
| Lighthouse (khách, tải máy cao) | | | home 96, list 87, PDP 90 (run 61/90/95), TBT 228 đến 317 ms | Không tin: load 50 đến 108. |

Các tệp: `docs/2026-11-03-golive/audit/perf-main.json`, `hieunang/bundle-mini.json`, `hieunang/bundle-web.json`, `hieunang/next-build-table.log`, `hieunang/sql-main.json`, `hieunang/mini-chunks.json`.

## 2. Phát hiện

Mức: P2 = lỗi nhỏ có thật hoặc lệch nhỏ; P3 = đánh bóng. Không có P0/P1 ở vùng này: không thấy gì chặn mở khách.

### HIEUNANG-01 (P2, web375 + web1280, owner 2a, effort S) First Load JS của web tăng 44 đến 65 KB trên gần như mọi trang khách

- Bằng chứng: bảng `next build` hai thời điểm (28/10: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/apps/web/.next/bundle-report-next-build.log`; nay: `hieunang/next-build-table.log`): `/` 204 → 260, `/san-pham` 157 → 222, PDP 174 → 231, `/gio-hang` 163 → 224, `/thanh-toan` 191 → 245, `/tai-khoan` 170 → 225, `/tai-khoan/diem-xanh` 179 → 223, `/uu-dai` 165 → 230, `/doi-rac` 166 → 220. Chunk chung gần như không đổi (103 → 104), tức mỗi trang tự gánh thêm.
- Nguyên nhân (đã chứng minh bằng thực nghiệm): `apps/web/src/components/mini/index.ts` là barrel (28/10: 31 dòng; nay ~70 dòng, thêm ProductCard/Grid/Rail, VoucherTicket/Picker, ShopSection, ComboCard, BannerCarousel…) có 64 file import từ `@/components/mini`, mà `apps/web/package.json` không khai `sideEffects`, nên webpack không bỏ được export không dùng. Chứng cứ chẩn đoán: `/nhan-vien/bang-luong` (214 KB) chỉ import `EmptyState` từ barrel mà nặng hơn `/nhan-vien` (156 KB) 58 KB, chunk phụ chứa `product-tile`, khoá query flash-sales/wishlist, mã voucher.
- Thực nghiệm: bản sao `apps/web` ở thư mục tạm, chỉ thêm `"sideEffects": ["*.css","**/*.css"]` (diff ở `hieunang/exp-patch.diff`), `next build` đầy đủ (`hieunang/exp-build.log`). First Load: `/` 260 → 244, `/san-pham` 222 → 193, `/gio-hang` 224 → 186, `/thanh-toan` 245 → 205, `/tai-khoan` 225 → 174, `/tai-khoan/diem-xanh` 223 → 171, `/tai-khoan/don-hang` 236 → 208, `/uu-dai` 230 → 211, `/doi-rac` 220 → 167, `/ban-chay` 210 → 179, `/nhan-vien/bang-luong` 214 → 158. PDP không đổi (231 → 233: nó dùng thật các thành phần đó).
- Đề xuất: thêm `"sideEffects": ["*.css", "**/*.css"]` vào `apps/web/package.json`; quét xác nhận không có import chỉ-để-chạy-hiệu-ứng ngoài CSS (grep `apps/web/src` không thấy); chạy đủ vitest web + e2e; thêm vào `bundle-budget` một ngưỡng First Load theo trang để lần sau bắt được. Cách phụ: đổi import barrel sang đường dẫn trực tiếp ở các trang nặng.
- Chưa kiểm: đo trên Slow 4G thật sau khi sửa (máy tải cao); e2e đầy đủ với `sideEffects`.

### HIEUNANG-02 (P2, web375 + web1280, owner 2a, effort S) Trang động theo `[slug]` (PDP, brand, chính sách) dựng lại ở máy chủ mỗi lượt, không phải ISR

- Bằng chứng (`next start` bản main trên cổng 3606): `/san-pham/mat-ong-rung-bhnong`, `/chinh-sach/dieu-khoan`, `/brand/fuwa3e` trả `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`; `/` trả `x-nextjs-cache: HIT`, `s-maxage=60`; `/gio-vang`, `/uu-dai`, `/cau-chuyen`, `/doi-rac` HIT `s-maxage=3600`. Bảng build đánh `ƒ` (động) cho `/san-pham/[slug]`, `/brand/[slug]`, `/chinh-sach/[loai]`, `/chien-dich/[slug]`; `.next/prerender-manifest.json` chỉ liệt kê `/khoi-phuc/[hint]` (route duy nhất có `generateStaticParams`).
- Mâu thuẫn với mã: `apps/web/src/app/san-pham/[slug]/page.tsx:31` có `export const revalidate = 300`, `brand/[slug]/page.tsx` `revalidate = 60`, `chinh-sach/[loai]/page.tsx` `revalidate = 300`, `apps/web/src/lib/api.ts:51` hứa "Next giữ bản đã render tốt" khi API lỗi. Thực tế các trang này không được cache.
- Hệ quả: PDP là trang đích của link CTV/chia sẻ (lượng truy cập lớn nhất ở ngoài Mini) đi qua SSR + vài lời gọi API mỗi lượt; khi API chậm hay lỗi, trang lỗi ngay thay vì giữ bản cũ.
- Thực nghiệm: bản sao với `export async function generateStaticParams() { return []; }` thêm vào ba trang trên (`hieunang/exp-patch.diff`): build chuyển thành `●` (SSG/ISR), `next start` cổng 3605 trả `Cache-Control: s-maxage=300, stale-while-revalidate=31535700`, `x-nextjs-cache: MISS` lượt đầu rồi HIT. Thời gian phản hồi PDP, 6 lượt `curl` liên tiếp cùng load ≈ 90: main 0,11 đến 0,72 s (trung vị ≈ 0,43 s), ISR 0,017 đến 0,22 s (trung vị ≈ 0,08 s).
- Ảnh hưởng nhìn thấy: bấm thẻ SP ở Trang chủ web 375 mất 1,4 đến 1,6 s tới khi thấy PDP, Mini 0,7 đến 1,0 s (mục 5, cùng điều kiện).
- Đề xuất: thêm `generateStaticParams` trả `[]` cho `san-pham/[slug]`, `brand/[slug]`, `chinh-sach/[loai]` (và xem `chien-dich/[slug]`, tôi không thử vì có thể dùng searchParams). Dữ liệu API đã qua Data Cache `fetch(..., { next: { revalidate } })` ở `lib/api.ts`, nên độ tươi không tệ hơn hiện tại. Lưu ý kiểm: Next lưu cả 404 của slug lạ 300 s (thấy `/san-pham/khong-ton-tai` trả `s-maxage=300`); cần xác nhận thư mục cache không phình do bot quét slug ngẫu nhiên (đặt giới hạn độ dài slug ở middleware nếu cần).
- Chưa kiểm: tải đồng thời (autocannon) vì máy tải cao; `chien-dich/[slug]`.

### HIEUNANG-03 (P2, mini375 + web375 + web1280, owner 2a, effort S) Dải "Việc cần làm" chèn vào Trang chủ không có chỗ giữ khi máy chưa nhớ được đơn: CLS 0,14 đến 0,32

- Bằng chứng: `hieunang/home-probe2.log` (cold = máy chưa có gợi ý): web returning 0,198 (3/3 run, `perf-main.json`), 0,170/0,171 (home-probe); `hieunang/probe-web375-returning.json` home 0,194: nguồn ca nhảy 0,1367 "Danh mục…", "Giờ vàng/Mã giảm giá/Đổi rác/Mua chung" và "Bán chạy" cùng bị đẩy xuống 144 px lúc ~6,9 s; `hieunang/probe-web1280-returning.json` home 0,324 (ca 0,2925: khối lối tắt cao 498 px bị đẩy 64 px = một dòng việc, lúc 4,4 s); Mini returning cold run 1: 0,141 (một ca, y252→396 và y152→296 cùng lúc 8,9 s), run 2: 0,004 (phụ thuộc thời điểm API về). Khi đã có gợi ý (lần mở sau): Mini 0,009 (`home-probe2.log`, "mini returning warm"), web 0,053.
- Nguyên nhân: `apps/miniapp/src/components/home/todo-strip.tsx:116` và `apps/web/src/components/home/todo-strip.tsx:109` là chỗ DUY NHẤT ghi `tubu_home_todo_rows` (`writeTodoRows`), và chỉ ghi khi Trang chủ đã chốt. Khung chờ chỉ dựng khi `rememberedRows > 0` (`todo-strip.tsx:139-141`). Hai ca thực tế hay gặp: (1) máy mới/xoá dữ liệu; (2) khách mua đơn đầu tiên (hoặc đơn mới sau một thời gian không có đơn đang xử lý) rồi quay về Trang chủ: lần mở trước ghi `rows = 0`, nay `/me/summary` báo có đơn đang xử lý và dải hiện ra đẩy cả trang xuống. Ca (2) suy ra từ mã (cùng nhánh `rememberedRows = 0` với phép đo cold); chưa dựng riêng từng bước đặt đơn thật.
- Đề xuất: ghi `writeTodoRows(storage, userId, 1)` ở màn đặt đơn thành công (COD và chuyển khoản đều sinh ít nhất một dòng), và/hoặc khi `/me/summary.orders.active > 0` mà `todoQ` còn loading thì dựng khung chờ 1 dòng (`todoSkeletonHeight(1)` = 64 px) thay vì `null` (`/me/summary` về trước `/orders/home-todo` nên đã biết có việc). Đích: CLS ca này < 0,05.
- Ghi chú: web dựng nội dung "khách mới" ở máy chủ rồi thay (R-174, đã biết); số CLS ở đây là của dải việc, không phải của R-174.

### HIEUNANG-04 (P2, web375, owner 2a, effort S) Chân trang gọn hiện dưới khung chờ rồi bị đẩy khỏi màn hình khi nội dung về: CLS 0,2 đến 0,34 trên 5 màn đăng nhập

- Bằng chứng (`hieunang/probe-web375-returning.json`, 1 run mỗi màn, persona returning): `/vuon-xanh` 0,342, `/doi-rac` 0,257, `/tai-khoan/diem-xanh` 0,216, `/uu-dai` 0,21, `/tai-khoan/thong-bao` 0,206, `/tai-khoan` 0,09. Nguồn mỗi ca: `FOOTER.mt-8.border-t "Hotline: 0984 606 774…" y634→0` (đã rời màn hình) cùng `DIV.md:hidden` (đệm thanh đáy). Mini cùng màn: 0 đến 0,05 (không có chân trang). Web 1280 không bị (≤ 0,064: `cart` 0,064, `game` 0,048).
- Phim chụp liên tục `/vuon-xanh` (`hieunang/film-game.log`, ảnh `hieunang/film-game-web375/f02_4908ms.jpg`, `f04_6434ms.jpg`, `f06_7964ms.jpg`): khung chờ chỉ cao ~480 px, hàng "Hotline: 0984 606 774 / Điều khoản Bảo mật Đổi trả Vận chuyển" hiện ở y≈633 đến 750, rồi ở f06 nội dung dài 2725 px thay vào và chân trang rời khỏi màn hình. Ảnh `hieunang/shots/cart__returning__web375__d2500__s1.png` cho thấy cùng hiện tượng ở `/gio-hang` khi API chậm.
- Nguyên nhân: `apps/web/src/components/skeletons/route-skeleton.tsx:125` (nhánh `standalone`) và `:145` (nhánh còn lại, đường của `AuthLoading`) đều dùng `min-h-[80vh]`, ghi chú (dòng 112) trong hàm nói "đủ cao để chân trang nằm dưới màn hình" nhưng 80 vh (650 px) cộng đệm vẫn để chân trang hở ở y 633 đến 750 trên màn 812 px, phía trên thanh đáy. R-76 đề xuất "ẩn chân trang khi đang tải" nhưng phần này chưa có (chỉ có `body:has([data-sticky-bar]) footer[data-compact-footer]` ở `apps/web/src/app/globals.css:95`).
- Đề xuất: ở `globals.css` thêm trong `@media (max-width: 767.98px)`: `body:has([role="status"][aria-busy="true"]) footer[data-compact-footer] { display: none; }`, hoặc đổi `min-h-[80vh]` thành `min-h-[100svh]` cho khung chờ. Đích: CLS các màn trên < 0,1.
- Chưa kiểm: thời điểm API ngoài đời thật (Slow 4G + tải máy cao làm khung chờ kéo dài hơn bình thường, ca nhảy vẫn có cấu trúc giống nhau ở mọi tốc độ vì chân trang luôn hở).

### HIEUNANG-05 (P3, api, owner 2a, effort M) Câu SQL còn nhiều ở vài điểm nóng: `/cart` 15, `/orders/home-todo` 15, `/me/loyalty` 11, `/home/me` 11

- Bằng chứng (`hieunang/sql-main.json`, API 3611 với `prisma-query-log.cjs`, lần 1 → lần 2 nóng, persona returning lane 5): `/cart` 20 → 15 (đích R-82 ≤ 8: chưa đạt; mẫu câu lặp: 4× `system_configs`, 3× `storefronts`, `referral_touches`, `bundles`, `coupons`, `membership_tiers`, raw SQL flash), `/orders/home-todo` 16 → 15 (21 kể cả giao dịch; 3× `orders`, 4× `order_items`, 4× `variations`, 3× `products`), `/me/loyalty` 13 → 11, `/home/me` 15 → 11 (đạt đích ≤ 12), `/feed` 12 → 9, `/me/daily-check-in` 10 → 3, `/me/coupons` 5, `/orders?limit=10` 5.
- So sánh: 28/10 `/cart` 22/18, `/home/me` 26/18; PR #98 ghi `/cart` 7 đến 8 SQL với giỏ lane 3/9 (R-82 vẫn "một phần"). Giỏ của persona returning lane 5 có nhiều dòng hơn nên chưa chắc đây là hồi quy.
- Đề xuất: (a) `/cart` resolve cấu hình/attribution một lần mỗi request (đọc `system_configs` một lần, dùng lại storefront đã resolve); (b) `/orders/home-todo` gộp ba nhóm `orders` + `order_items` thành một truy vấn có `include` hoặc `select` hẹp (dải chỉ cần 3 dòng); (c) `/me/loyalty` kiểm các lần đọc `membership_tiers`/giao dịch lặp.
- Chưa kiểm: độ trễ p95 dưới tải (autocannon có sẵn trong `run-all` nhưng số đo bị méo vì máy tải).

### HIEUNANG-06 (P3, mini375 + web, owner 2a, effort M) Mỗi lần mở một tab gốc, Mini và web gọi 5 đến 6 lời API "khung chung" ngoài dữ liệu của chính màn đó

- Bằng chứng (`hieunang/probe-mini-returning.json`, danh sách `calls`): `browse` 11 lời gọi, trong đó chỉ `/flash-sales/active`, `/brands`, `/products`, `/categories`, `/config/public` là của màn; còn lại là khung chung: `/auth/refresh`, `/me/summary`, `/me/daily-check-in`, `/me/coupons`, `/me/wishlist/ids`, `/cart`. `profile`: 13 lời gọi gồm `/me/loyalty`, `/me/wallet`, `/auth/me`, `/me/referral`, `/dealer/me`, `/me/support-chat/summary`. `home` 11. Cùng khung chung trên web (`probe-web375-returning.json`: `home` 12, `game` 10, `offers` 11).
- Nguyên nhân: `apps/miniapp/src/hooks/use-offers-dot.ts:16-26` dựng chấm đỏ tab "Ưu đãi" bằng hai query đầy đủ (`/me/daily-check-in` 3 SQL, `/me/coupons` 5 SQL) ở `bottom-nav.tsx:32`; `apps/miniapp/src/hooks/use-cart-count.ts:10` lấy cả giỏ (`GET /cart`, 15 SQL) chỉ để lấy `itemCount`.
- Đề xuất: đưa `checkedInToday`, `expiringCouponIds` và `cartItemCount` vào `/me/summary` (đã có, 4 SQL, dùng chung cho thanh đáy, chuông, dải việc theo PR #123); `useCartCount` và `useOffersDot` đọc từ đó. Ước tính bớt 3 request và khoảng 20 SQL mỗi lần mở tab gốc.
- Chưa kiểm: chênh lệch thời gian thật (bị máy tải che).

### HIEUNANG-07 (P3, mini375, owner 2a, effort S) Tải sẵn mã ở lúc rảnh kéo Mini lên ~396 KB gzip và 77 request JS mỗi lần mở, không có điều kiện mạng

- Bằng chứng: `docs/2026-11-03-golive/audit/perf-main.json` và `hieunang/probe-mini-returning.log`: mọi màn Mini đo đều `js 396 đến 427 KB`, 88 đến 117 request (home 97, browse 95, product 98, profile 117, game 110); 28/10: 222 KB, 1 request JS; sau integ 330 KB. `apps/miniapp/src/components/app.tsx:124-133` (`prefetchShoppingRoutes`) gọi ở `useEffect` của `MyApp` (mọi màn, không riêng Trang chủ) và tải `loadBrowse`, `loadProductDetail`, `loadCart`, `loadCheckout`, không xét `navigator.connection.saveData`/`effectiveType`.
- Đây là quyết định có chủ ý (R-79); số ghi nhận là nó đã lớn thêm +66 KB so với 28/10 vì các chunk (storefront-builder 43 → 65 KB, product-detail 40 → 50, checkout 45 → 48) và gói Sheet dùng chung 77 KB (react-spring + use-gesture, kéo bởi zmp-ui).
- Đề xuất: bỏ qua khi `saveData` hoặc `effectiveType` là `slow-2g`/`2g`/`3g`; hạ ưu tiên (tải chunk cart/checkout sau tương tác đầu hoặc sau 4 s).
- Chưa kiểm: trong Zalo thật gói Mini có thể được tải một lần thành bộ nhớ đệm cục bộ (nên prefetch gần như miễn phí); chưa có thiết bị Zalo thật nên không biết phép đo HTTP này có đại diện không.

### HIEUNANG-08 (P3, mini375, owner 2a, effort S) Tổng gói Mini 2214 KB raw vượt ngưỡng cảnh báo 2048 KB, CI in cảnh báo thường trực

- Bằng chứng: `hieunang/bundle-mini.json` (lệnh `node docs/2026-10-28-review/tools/perf/bundle-report.mjs --build-miniapp --only=miniapp`): entry 659 KB raw/205 KB gz (< 700, trên đích 450); tổng 2214 KB raw/862 KB gz, 212 file; 31/10 là 1997/774 KB; file zip `www` ≈ 897 KB. Thành phần entry: mã app 419 KB, react-dom 133, zmp-sdk 128 (kèm zod 48, của nhà cung cấp), query-core 74, zmp-ui 57, `vi.ts` 35,8, `shop-copy` 15,7 (`hieunang/mini-chunks.json`).
- Hệ quả: lần cảnh báo thường trực làm mất tác dụng cảnh báo ("vượt ngưỡng cảnh báo 2048 KB" in mỗi lần CI). Chưa rõ giới hạn dung lượng gói của Zalo (không xác minh được).
- Đề xuất: chủ nâng ngưỡng cảnh báo có ý thức (vd 2400 KB) để cảnh báo mới còn nghĩa; kiểm tra có chunk Sheet 77 KB có cần nạp không (chỉ khi mở sheet).

### HIEUNANG-09 (P3, mini375, owner 2a, effort S) Chat Mini: màn nhảy 0,174 CLS khi luồng tin về, kèm lời gọi `/me/support-chat` đôi một lần

- Bằng chứng: `hieunang/probe-mini-returning.log` (chat cls 0,174, dup `GET /me/support-chat` ×2), `probe-mini-rerun.json` (chạy lại: 0,174, một ca nhảy duy nhất lúc ~2,8 s: `DIV "Tubu Tree / Tubu Tree hỗ trợ 8:00…" y132→54 h675`); ảnh trước/sau `hieunang/shots/chat__returning__mini375__d1500__s1.png` (3 bong bóng chờ, bắt đầu y≈66) và `…__s2.png` (nội dung thật: nhãn "Tubu Tree", lời chào, tin khách, ô nhập dính đáy). Khung chờ (`apps/miniapp/src/pages/support-chat.tsx:213-226`) không có ô nhập và không có `minHeight`, còn nội dung thật có `minHeight: calc(100dvh - 72px)` và ô nhập `sticky`.
- Cờ `chat.enabled` đang tắt trên PROD (brief) nên chưa chạm khách thật; ghi lại vì sẽ bật.
- Đề xuất: dựng khung chờ cùng khung ngoài (cùng `minHeight`, cùng chỗ dành cho ô nhập). Lời gọi đôi: chỉ thấy 1 trong 3 lần đo (`refetchOnWindowFocus: true` ở dòng 83), mức tham khảo.

### HIEUNANG-10 (P3, web375 + web1280, owner 2a, effort S) Web gọi `GET /config/public` hai lần ở vài trang

- Bằng chứng: `probe-web375-returning.log`: `/tai-khoan` dup `GET /config/public` ×2, `/ho-tro/chat` ×2, `/tai-khoan/diem-xanh` ×2; `probe-web1280-returning.log`: `/tai-khoan/diem-xanh` ×2. Trang dùng `useQuery({ ...publicConfigQuery(coreHttp), enabled: authed })` (`apps/web/src/app/tai-khoan/page.tsx:107`, `diem-xanh/page.tsx:64`) trong khi nơi khác dùng `usePublicConfig` (`apps/web/src/lib/use-public-config.ts`) cùng khoá nhưng `staleTime` khác, nên lúc `enabled` đổi true có một lần tải thêm.
- Đề xuất: dùng chung một hook `usePublicConfig` cho mọi trang (cùng `staleTime`), bỏ khai báo query lặp. Tác động nhỏ (`/config/public` được cache 60 s ở CDN, 0 SQL), nên P3.

### HIEUNANG-11 (P3, công cụ, owner 2a, effort S) Bộ công cụ perf lệch với giao diện hiện tại và dễ trượt dưới tải

- INP không đo được cho Trang chủ và Danh mục: `run-all.mjs` → `web.mjs` bấm "Mã của tôi" và "Bán chạy" không còn tồn tại (`perf-main.json` `inp` rỗng ở home/list; 28/10 INP home = 32 ms).
- `cls-probe.mjs` cứng lane 2 (lane 2 hiện không chạy nên phải sao chép bản sửa); `lib.mjs:ensureServer` chờ tối đa 30 s (60 × 500 ms) nên `next start` mở chậm khi máy tải cao làm hỏng cả lượt đo (xảy ra ở lượt `probe.mjs web1280` đầu tiên, "web không lên trên cổng 3601").
- Đề xuất: cập nhật nút bấm theo giao diện mới, cho `cls-probe` nhận `--lane`, cho `ensureServer` hạn chờ cấu hình được (`PERF_SERVER_WAIT_S`).

## 3. Đo thêm nhưng không có lỗi (đã kiểm, giữ nguyên)

- Mini: console lỗi/pageError 0 trên 19 màn × persona returning, 6 màn guest (`probe-mini-returning.log`, `probe-mini-guest.log`). Web 375: 0; web 1280: 0.
- Không có lời gọi lỗi (status ≥ 400 hoặc đứt) ở mọi màn đã dò. Không có lời gọi API trùng ngoài HIEUNANG-09 và HIEUNANG-10.
- Ảnh SP web: `ProductImage` dùng `srcset` qua `/img`, `loading="lazy"`/`priority`, `fetchPriority`, kệ Bán chạy `priorityCount={2}`; font `Inter 400–700`, `Fraunces 500/600` đều `font-display: swap`; Caddy bật gzip + zstd. API `/home` 3,5 KB gzip, `/home/me` 3,3 KB, `/orders/home-todo` 1,3 KB.
- Tần suất thăm dò: chat 5 s, Giờ vàng 60 s (hợp lý). Web `QueryClient` mặc định `staleTime: 0` ngoài admin/catalog và `refetchOnWindowFocus: false`; Mini `staleTime` 10 s.
- CLS nhỏ ghi nhận, không đạt mức báo lỗi: Mini `offers` 0,104 một lần (chạy lại 0), Mini `recycle` 0,051 lặp 2/2 (mục "Yêu cầu đang xử lý" chèn đẩy 62 px), Mini `product-slug` 0,025, `profile` 0,028, `browse` 0,024. Web375 `product-slug` 0,017, `wishlist` 0,014, `cart` 0,01; web1280 `product-slug` 0,017, `cart` 0,064 (chân trang máy tính hộp, cùng nguyên nhân HIEUNANG-04).
- Quan sát ngoài vùng, chuyển cho vùng liên quan: Mini checkout lúc chờ (`docs/2026-10-28-review/screens/mini375-slow5s/`) chỉ có 3 thẻ dòng hàng, nút lùi đè lên thanh tiêu đề; web375 trang chủ lúc chờ API hiện nội dung "khách mới" (R-174, đã biết). `/brand/<slug>` trả 404 trên lane vì `slug: null` của dữ liệu seed (không phải lỗi của mã).

## 4. Chưa kiểm được

- Số tuyệt đối FCP/LCP/TBT/Lighthouse (load máy 50 đến 166).
- Zalo thật (WebView, tải gói, cache), nên không kiểm được ảnh hưởng thật của prefetch (HIEUNANG-07), giới hạn dung lượng gói (HIEUNANG-08), và Mini Testing.
- INP thật: công cụ cũ lệch giao diện; phần đo bằng `nav-probe.mjs` ở mục 5.
- Tải đồng thời trên API và web (autocannon) vì máy dùng chung quá tải; SSR PDP vs ISR chỉ đo độ trễ tương đối 6 lượt.
- Giờ vàng đang chạy, combo, ảnh SP (lane không có).
- PROD (không được phép), nên không biết cache `/img` đã nóng hay chưa và p95 thật.
- Trang `chien-dich/[slug]` dưới ISR.

## 5. Độ trễ điều hướng (bấm → thấy nội dung) và INP thô

Đo bằng `hieunang/nav-probe.mjs` (production build, Slow 4G, CPU ×4, persona returning, 2 run mỗi nền, load máy 60 đến 70; tính từ lúc bấm đến lúc thấy nội dung màn mới; `inp` là độ trễ sự kiện thô lớn nhất của thao tác, `null` = trình duyệt không ghi sự kiện). File: `hieunang/nav-mini.json`, `hieunang/nav-web375.json`, `.log`.

| Thao tác | Mini (run 1 / run 2) | Web 375 (run 1 / run 2) |
|---|---|---|
| Trang chủ → PDP (bấm thẻ SP) | 1040 / 670 ms, 7 API, INP 80 / 72 | 1379 / 1622 ms, 7 API, INP 72 / 64 |
| Tab Danh mục | 83 / 134 ms, 3 API | 585 / 583 ms, 1 API |
| Tab Vườn Xanh | 69 / 73 ms, 5 API | 124 / 119 ms, 5 API |
| Tab Ưu đãi | 97 / 146 ms, 4 API | 146 / 226 ms, 5 API |
| Tab Cá nhân | 53 / 70 ms, 6 API | 243 / 306 ms, 10 API |
| Tab Trang chủ (quay lại) | 177 / 250 ms, 1 API | 568 / 520 ms, 4 API |
| CLS cả phiên | 0,028 / 0,031 | 0,163 / 0,194 (ca dải Việc cần làm, HIEUNANG-03) |

- Mini: mọi thao tác ≤ 250 ms sau khi mở (chunk đã được tải sẵn lúc rảnh, xem HIEUNANG-07) và INP thô ≤ 88 ms; không thấy vấn đề.
- Web 375: điều hướng bằng RSC chậm hơn Mini rõ rệt (Danh mục 0,58 s so với 0,08 đến 0,13 s; PDP 1,4 đến 1,6 s so với 0,7 đến 1,0 s). Trang `/san-pham` và `/ban-chay` động theo thiết kế (đọc `searchParams`), PDP đang động ngoài ý muốn (HIEUNANG-02), nên cả ba đều qua máy chủ mỗi lượt; đây là chỗ HIEUNANG-02 có ảnh hưởng nhìn thấy được. Số tuyệt đối bị tải máy làm tăng; chênh lệch Mini/web là tương đối.
- INP của Trang chủ và Danh mục web (HIEUNANG-11 nói công cụ cũ không đo được) nay đo thủ công ở bảng này; chưa có số INP của thao tác ghi (thêm giỏ, đặt đơn) vì vùng `hieunang` không được ghi dữ liệu.

## 6. Lệnh tái hiện

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs
# bộ đo chuẩn (lane 5, cổng 3601/3603/3611)
node docs/2026-10-28-review/tools/perf/run-all.mjs --label gl1103-audit
node docs/2026-10-28-review/tools/perf/bundle-report.mjs --build-miniapp --only=miniapp
node docs/2026-10-28-review/tools/perf/home-probe.mjs "$PWD" web returning 2          # CLS Trang chủ cold
node docs/2026-10-28-review/tools/perf/home-probe.mjs "$PWD" mini returning 2 warm
# dò từng màn: API, trùng, lỗi, CLS + nguồn, LCP (kịch bản trong hieunang/)
node docs/2026-11-03-golive/audit/hieunang/probe.mjs <mini|web375|web1280> returning <khoá,khoá|all> [--delay ms] --out out.json
node docs/2026-11-03-golive/audit/hieunang/film.mjs web375 returning /vuon-xanh outDir 14 450   # phim chụp + dòng thời gian
node docs/2026-11-03-golive/audit/hieunang/shots.mjs <mini375|web375|web1280> returning home,cart 2500 outDir
node docs/2026-11-03-golive/audit/hieunang/sql5.mjs                                      # đếm SQL (API 3611)
# ISR: next start bản main và bản thử, so Cache-Control
curl -s -D - -o /dev/null http://127.0.0.1:3606/san-pham/mat-ong-rung-bhnong | grep -i cache-control
```

Các kịch bản `probe.mjs`, `film.mjs`, `shots.mjs`, `nav-probe.mjs`, `sql5.mjs` nằm trong `hieunang/` và dùng `docs/2026-10-28-review/tools/perf/lib.mjs` (đường dẫn worktree cố định trong đầu file).

## 7. Ảnh đã xem (đường dẫn)

- `hieunang/film-game-web375/f02_4908ms.jpg`, `f04_6434ms.jpg`, `f06_7964ms.jpg` (HIEUNANG-04: khung chờ, chân trang hở, nội dung sau).
- `hieunang/shots/cart__returning__web375__d2500__s1.png` (chân trang hở dưới khung chờ giỏ), `game__returning__web375__d2500__s1.png`, `home__returning__web375__d2500__s1.png`, `product-slug__returning__web375__d2500__s1.png`, `home__returning__web1280__d2500__s1.png`, `product-slug__returning__web1280__d2500__s1.png` (trạng thái chờ, API trễ 2,5 s).
- `hieunang/shots/chat__returning__mini375__d1500__s1.png`, `…__s2.png`, `recycle__returning__mini375__d1500__s1.png`, `…__s2.png` (Mini, API trễ 1,5 s).
- Có sẵn từ lượt `capture.mjs` ở máy khác: `docs/2026-10-28-review/screens/mini375-slow5s/` (5 khoá × 2 ảnh: home, browse-category, product-slug, cart, checkout), đã xem home s1/s2, product-slug s1, checkout s1.
- Lưu ý: `capture.mjs --lane 5 --state slow5s` cho web375/web1280 hết hạn 90 s trên `next dev` lane 5 khi máy tải cao (đã hủy tiến trình của tôi, các lượt chụp của vùng khác giữ nguyên). Thay bằng `shots.mjs` chạy trên bản build production.
