# D6 — UI/UX Mini App 390px (ảnh chụp thật)

Phiên UAT 2026-10-20, nhánh `uat/2026-10-20`. Chỉ chụp và đọc mã, không sửa mã nguồn. Phạm vi: `apps/miniapp` (vùng phiên UAT). Web không thuộc nhánh này.

Kết quả: 22 phát hiện. P0: 0. P1: 0. P2: 7. P3: 15. Trong đó 11 mục là việc D7 còn mở (ghi mã cũ), 11 mục mới.

Luồng mua lõi đạt: Trang chủ → đơn COD thành công mất **3 chạm** (Mua ngay) hoặc **5 chạm** (qua giỏ). Axe: 0 critical, chỉ còn `color-contrast` mức serious ở 3 màn mới (đổi rác, trình dựng gian hàng). 8 màn lõi trên WebKit giống Chromium.

Mọi đường dẫn ảnh bên dưới tính từ `docs/2026-10-20-uat/`.

## 1. Cách làm

| Việc | Công cụ | Ghi chú |
|---|---|---|
| Chụp | `tools/uiux/capture.mjs` (bản sao `scripts/uiux/capture.mjs`, cách chạy ghi ở đầu file) | Vite `apps/miniapp` cổng 3223, mở bằng `http://localhost:3223`. Lý do: `zmp-sdk` ngoài Zalo chỉ giả `getStorage/login` khi host là `localhost`; mở `127.0.0.1` thì không có phiên (PAGEERROR, không gọi `/auth`) |
| Dữ liệu | `tools/uiux/lib/api-router.mjs`, `lib/sessions.mjs`, `lib/fabricate.mjs` | Chặn `/api/**` trong trình duyệt. GET công khai (sản phẩm, danh mục, `/config/public`) đi thẳng tới API UAT `127.0.0.1:3221` (DB `tubutree_uat`), phần còn lại là dữ liệu giả theo schema (`tools/uiux/extract-endpoints.mjs` → `tools/uiux/generated/miniapp-endpoints.json`, 255 endpoint + 4 wishlist) |
| Trạng thái | `routes.mjs` | normal / empty / loading / error / offline. Offline: `route.abort('internetdisconnected')` + `navigator.onLine = false` + sự kiện `offline` |
| Màn | `tools/uiux/routes.mjs` | 59 màn: toàn bộ `routes.mjs` gốc + 6 route có trong `app.tsx` mà gốc thiếu (`/group-buy/:id`, `/points/scan`, `/refill`, `/subscriptions`, SP không tồn tại, giỏ rỗng có gợi ý) |
| Đo | trong `capture.mjs` | vùng chạm (thô + hiệu dụng, tính cả `::after` của `tubu-hit-44`), axe-core 4.12.0, h1, `<main>`, tràn ngang, chữ trên màn |
| Xem ảnh | `tools/uiux/sheet.mjs` | Ghép tờ xem nhanh bằng Chromium (máy không có PIL/ImageMagick): `screens/sheets/` (118 tờ) |
| Đếm chạm | `tools/uiux/flow-cod.mjs` | Trang chủ → thẻ SP → Mua ngay (hoặc Thêm giỏ → giỏ → Thanh toán) → Đặt hàng, ghi `screens/flow/` |
| Tổng hợp | `tools/uiux/summarize.mjs` | `metrics`, `axe`, `small <id>`, `text <key>`, `grep <regex>` trên `screens/miniapp.jsonl` |

Số bản ghi trong `screens/miniapp.jsonl`: 298, lỗi chụp 0 (`logs/uiux-capture-chromium.log`, `logs/uiux-capture-pass2.log`, `logs/uiux-capture-pass3.log`).

| Engine | normal | empty | loading | error | offline |
|---|---|---|---|---|---|
| Chromium (59 màn) | 59 | 51 | 49 | 50 | 49 |
| WebKit (8 màn lõi) | 8 | 8 | 8 | 8 | 8 |

Số màn ở trạng thái empty/loading/error/offline ít hơn 59 vì vài màn không có GET dữ liệu (cài đặt, thể lệ, redirect, SP không tồn tại, giỏ rỗng có gợi ý) nên chỉ chụp normal.

Sửa trong bản sao so với bản gốc (không đụng `scripts/uiux/`):
- Đổi `loadEndpoints` để không cắt `/:p0` cuối đường dẫn: bản gốc biến `/waste/requests/:p0` thành `/waste/requests`, làm màn chi tiết yêu cầu đổi rác không có dữ liệu.
- Thêm `realism()` cho `/orders` và `/orders/:code`: trạng thái xoay vòng, đơn đầu là chuyển khoản còn hạn, tổng tiền khớp, `manualHandling: false`. Dữ liệu sinh ngẫu nhiên trước đó ẩn nút thanh toán.
- Thêm persona `customer-emptycart`.

Bỏ qua các lỗi do dữ liệu giả, theo D7 mục 2. Ví dụ: tên SP lặp, hạn điểm đã qua ("còn 0 ngày"), lý do ẩn SP là một đoạn mô tả dài, kệ "Mua lại" có slug không có trong DB, số tiền ở thanh toán khi bấm Mua ngay là của giỏ mẫu.

## 2. Bảng điểm từng màn (D7 → nay)

Thang 1–5 như `docs/2026-10-18-launch-review/D7-uiux-visual.md`. Tăng 8 màn, giảm 0 màn. Ảnh chính: `screens/miniapp/<id>__normal__390.png`; tờ xem nhanh: `screens/sheets/<id>__normal__p1.png`, `screens/sheets/<id>__states.png`.

| Màn (id) | D7 | Nay | Đã sửa so với D7 (thấy trên ảnh) | Còn lại | Ảnh |
|---|---|---|---|---|---|
| Trang chủ (`home`) | 3,5 | 3,5 | Tiêu đề kệ không còn emoji, dùng icon. Lỗi chỉ còn 1 dải cấp trang | Logo vẫn là bản có tagline (D7 việc 5, chờ chủ). Danh mục cùng một icon (D6-09). Bóng gợi ý Vườn Xanh che nội dung lần đầu (D6-16) | `screens/sheets/home__normal__p1.png` |
| Trang chủ khách mới (`home-new-customer`) | 3 | 4 | Khối "Quà khách mới" đứng đầu (D7 việc 1) | Chữ 199.000đ khác 200.000đ ở trang SP (D6-18) | `screens/sheets/home-new-customer__normal__p1.png` |
| Danh mục (`browse`) | 4 | 4 | — | Danh mục cùng icon, tên bị cắt (D6-09). Trạng thái lỗi hiện "0 sản phẩm" (D6-08) | `screens/sheets/browse__normal__p1.png`, `screens/sheets/browse__states.png` |
| Chi tiết SP (`product-detail`) | 4 | 4,5 | Tên SP 17/600, tiêu đề mục cùng một kiểu (D7 việc 3) | Icon Chat OA chưa thấy vì bản chụp không có `VITE_ZALO_OA_ID` (D6-21, chưa kiểm chứng) | `screens/sheets/product-detail__normal__p1.png`, `screens/sheets/product-detail__normal__pair.png` |
| Giỏ (`cart`) | 4 | 4 | Giỏ rỗng có kệ "Có thể bạn thích" | Không có thành tiền dòng khi SL > 1 (D6-10) | `screens/sheets/cart__normal__p1.png`, `screens/miniapp/cart-empty-suggest__normal__390.png` |
| Thanh toán (`checkout`) | 3,5 | 3,5 | — | Cảnh báo địa giới cũ nằm dưới cả danh sách (D6-03). Không có dòng dự kiến giao (D6-20). Khối điểm vẫn dày chữ (D7 việc 11) | `screens/sheets/checkout__normal__p1.png` |
| Chuyển khoản (`bank-payment`) | 3 | 3,5 | Hạn chuyển khoản + đếm ngược trong hộp cảnh báo | Hàng tiêu đề tách đôi (D6-01). Chữ đỏ căn giữa (D6-12). Lỗi/offline là chữ trơn (D6-02) | `screens/sheets/bank-payment__normal__p1.png`, `screens/sheets/bank-payment__states.png` |
| Đơn hàng (`orders`) | 3,5 | 4,5 | Thẻ chờ thanh toán có "Thanh toán ngay" + "Hạn …" (D7 việc 2) | — | `screens/sheets/orders__normal__p1.png` |
| Chi tiết đơn (`order-detail`) | 4 | 4,5 | Không tìm thấy đơn có tiêu đề, "Về trang chủ", hotline | Email CSKH `tubutree@gmail.com` (D6-22). "tự huỷ" và "Hủy đơn" trên cùng màn (D8-15) | `screens/sheets/order-detail__normal__p1.png`, `screens/sheets/order-detail__states.png` |
| Cộng đồng (`feed`) | 3 | 3 | Tên tác giả 1 dòng | Đầu trang ~380px trước bài đầu, 2 nút chỉ có icon (D6-05) | `screens/sheets/feed__normal__p1.png` |
| Chi tiết bài (`post-detail`) | 3 | 3 | Hàng tác giả 1 dòng | Ảnh vẫn xếp dọc, chưa carousel (D7 việc 8) | `screens/sheets/post-detail__normal__p1.png` |
| Điểm Xanh (`loyalty`) | 3 | 3 | — | Vẫn 7 khối, mã giảm giá không có nút "Dùng" (D7 việc 11). "×1.2 · 130.000 điểm Xanh" (D6-06). "Vườn Cây Tubu" (D6-07) | `screens/sheets/loyalty__normal__p1.png` |
| Ví (`wallet`) | 3 | 3 | "Mời thêm -2" đã ẩn | Số "130.000 / điểm" gãy 2 dòng (D6-11) | `screens/sheets/wallet__normal__p1.png` |
| Vườn Xanh (`game`) | 2,5 | 3 | Có tab. Số vòng quay đã định dạng. Nút "Điểm danh" không còn bị cắt | Vẫn nhiều nút to trên một tab | `screens/sheets/game__normal__p1.png` |
| CTV (`affiliate`) | 3 | 3,5 | Hàng lối tắt lên đầu, 2 ô KPI cùng kiểu (D7 việc 9) | — | `screens/sheets/affiliate__normal__p1.png` |
| Gian hàng của tôi (`storefront-builder`) | 3 | 3 | — | Ô bìa trống, 3 icon mỗi dòng (D7 việc 10). Tên SP bị ẩn mờ 3,31:1 (D6-14) | `screens/sheets/storefront-builder__normal__p1.png` |
| Gian hàng công khai (`storefront-view`) | 3 (rỗng 2) | 3 (rỗng 3,5) | Không tồn tại: có tiêu đề, "Về trang chủ", hotline | Hàng tiêu đề lỗi/404 tách đôi (D6-01). Hộp lời giới thiệu CTV vẫn tách khỏi thẻ | `screens/sheets/storefront-view__states.png` |
| Trang nhãn (`brand-view`) | 3 | 3 | "nhận tới % hoa hồng" đã ẩn khi rỗng | 4 thẻ khuyến mãi to, khối đại lý | `screens/sheets/brand-view__normal__p1.png` |
| Chủ nhãn (`brand-owner`) | 2,5 | 3,5 | Danh sách khuyến mãi không còn vỡ cột (IconButton) | — | `screens/sheets/brand-owner__normal__p1.png` |
| Kênh đại lý (`dealer`) | 3,5 | 3,5 | — | Vẫn màu navy riêng (cần chủ quyết theo D7) | `screens/sheets/dealer__normal__p1.png` |
| Thông báo (`notifications`) | 3,5 | 3,5 | — | Mọi mục cùng icon chuông | `screens/sheets/notifications__normal__p1.png` |
| Cá nhân (`profile`) | 4 | 4 | — | Số in serif (D6-13). Hàng thẻ 2 + 1, không có hàng trạng thái đơn (D7) | `screens/sheets/profile__normal__p1.png` |
| Cài đặt (`settings`) | 4,5 | 4,5 | — | — | `screens/sheets/settings__normal__p1.png` |
| Quản trị (`admin`) | 3,5 | 3,5 | — | "Thu hồi" đỏ, "Huỷ" xanh | `screens/sheets/admin__normal__p1.png` |
| Duyệt cộng đồng (`admin-community`) | 3,5 | 3,5 | — | Ảnh bài to, "Từ chối" đỏ đặc | `screens/sheets/admin-community__normal__p1.png` |
| Mua chung (`group-buy`) | 3 | 3 | — | Nhóm hết hạn vẫn nằm trên | `screens/sheets/group-buy__normal__p1.png` |
| Trợ lý AI (`ai-advisor`) | 4–4,5 | không chấm | — | `aiAdvisorEnabled: false` ở UAT nên route về `/` | `screens/miniapp/ai-advisor__normal__390.png` |
| Yêu thích (`wishlist`) | 4,5 | 4,5 | — | — | `screens/sheets/wishlist__normal__p1.png` |
| Học viện (`academy`, `academy-course`) | 4 | 4 | — | — | `screens/sheets/academy__normal__p1.png` |
| Về Tubu (`about`) | 4 | 4 | — | — | `screens/sheets/about__normal__p1.png` |
| 404 (`not-found`) | 4,5 | 4,5 | — | — | `screens/miniapp/not-found__normal__390.png` |

Màn mới, D7 chưa chấm:

| Màn (id) | Nay | Ghi chú | Ảnh |
|---|---|---|---|
| Đổi rác (`recycle`) | 3 | Món "Sắp có" làm mờ 0,55 | `screens/sheets/recycle__normal__p1.png` |
| Thể lệ đổi rác (`recycle-rules`) | không chấm | Trang chữ | `screens/sheets/recycle-rules__normal__p1.png` |
| Đổi rác chọn món (`recycle-new`) | 3 | axe serious ×12 (D6-04) | `screens/sheets/recycle-new__normal__p1.png` |
| Đổi rác lấy điểm (`recycle-points`) | 3 | axe serious ×12 (D6-04) | `screens/sheets/recycle-points__normal__p1.png` |
| Yêu cầu của tôi (`recycle-requests`) | 4 | — | `screens/sheets/recycle-requests__normal__p1.png` |
| Chi tiết yêu cầu (`recycle-request`, `recycle-edit`, `recycle-done`) | 3,5 | "Cần hỗ trợ?" lặp 2 lần (D6-15) | `screens/sheets/recycle-request__normal__p1.png` |
| Nhận hàng tại điểm (`recycle-desk`) | 3,5 | — | `screens/sheets/recycle-desk__normal__p1.png` |
| Kho quà (`rewards`) | 3 | Chữ luật dài ngay đầu | `screens/sheets/rewards__normal__p1.png` |
| Quà của tôi (`rewards-mine`) | 4 | — | `screens/sheets/rewards-mine__normal__p1.png` |
| Tích điểm ngoài app (`cashback`) | 4 | Tính năng tắt, hiện "Chưa mở" rõ ràng | `screens/sheets/cashback__normal__p1.png` |
| Quét mã điểm (`points-scan`) | 3,5 | — | `screens/sheets/points-scan__normal__p1.png` |
| Sổ địa chỉ (`addresses`) | 4 | — | `screens/sheets/addresses__normal__p1.png` |
| Đặt định kỳ (`orders-subscriptions`, `subscriptions-redirect`, `refill-redirect`) | 3,5 | — | `screens/sheets/orders-subscriptions__normal__p1.png` |
| Ca làm (`staff`) | 3 | "Quên checkout?", "Copy tuần trước" bị cắt (D8-12) | `screens/miniapp/staff__normal__390.png` |
| Lương (`my-payroll`) | 3,5 | — | `screens/miniapp/my-payroll__normal__390.png` |
| Sửa hồ sơ (`edit-profile`) | 3,5 | — | `screens/sheets/edit-profile__normal__p1.png` |
| Câu chuyện thương hiệu (`brand-story`) | 4 | Emoji 🌿 trong câu dẫn | `screens/sheets/brand-story__normal__p1.png` |
| Bảng xếp hạng (`feed-leaderboard`) | 3,5 | Huy chương là emoji 🥇🥈🥉 (D6-19) | `screens/sheets/feed-leaderboard__normal__p1.png` |
| Sự kiện (`feed-events`) | 4 | — | `screens/sheets/feed-events__normal__p1.png` |
| Chi tiết mua chung (`group-buy-detail`) | 3,5 | — | `screens/sheets/group-buy-detail__normal__p1.png` |
| Đặt đơn thành công | 4,5 | Có mã đơn, tổng, "Chuẩn bị tiền mặt khi nhận hàng", điểm sẽ nhận, các bước tiếp theo | `screens/flow/chromium-buynow-03.png` |

## 3. Trạng thái rỗng / lỗi / đang tải / offline

D7 việc 7 đã làm. Gần như mọi màn ở trạng thái lỗi và offline có icon cảnh báo, tiêu đề "Chưa tải được …", câu "Có vẻ mất mạng…" khi offline, nút "Thử lại" và hotline 0984 606 774. Rỗng dùng hình lá/tìm kiếm, khác icon lỗi. Ví dụ: `screens/sheets/home__states.png`, `screens/sheets/orders__states.png`, `screens/sheets/loyalty__states.png`.

| Màn | D7 rỗng/lỗi | Nay | Bằng chứng (chữ trên màn, `summarize.mjs text <key>`) |
|---|---|---|---|
| Trang chủ lỗi | 2,5 | 4 | `home__error__390`: "Chưa tải được Trang chủ / Máy chủ đang bận, thử lại nhé. / Thử lại / Cần hỗ trợ? / Gọi 0984 606 774" |
| SP không tồn tại | 2,5 | 4,5 | `product-notfound__normal__390`: "Không tìm thấy / Không tìm thấy sản phẩm này. / Về trang chủ / Cần hỗ trợ? / Có thể bạn thích …" |
| Giỏ rỗng | 4 | 4,5 | `cart-empty-suggest__normal__390`: "Giỏ còn trống đấy / Khám phá ngay / Có thể bạn thích …" |
| Chi tiết đơn không thấy | 3 | 4 | `order-detail__empty__390`: "Không tìm thấy đơn hàng này. / Về trang chủ / Cần hỗ trợ?" (chưa có lối "Đơn của tôi") |
| Gian hàng không tồn tại | 2 | 3,5 | `storefront-view__empty__390`: "Gian hàng này không tồn tại hoặc đã ngừng hoạt động. / Về trang chủ / Cần hỗ trợ?" (hàng tiêu đề tách đôi, D6-01) |
| Chuyển khoản lỗi | 3,5 | 3 | `bank-payment__error__390`: chỉ "Không tải được thông tin thanh toán. / Thử lại / Xem đơn hàng"; offline giống hệt, không báo mất mạng (D6-02) |
| Danh mục lỗi | 3,5 | 3,5 | `screens/miniapp/browse__error__390.png`: có khối lỗi chuẩn nhưng đầu danh sách ghi "0 sản phẩm" (D6-08) |

Ngoại lệ không phải lỗi: `profile`, `edit-profile`, `brand-story`, `points-scan` không có GET bắt buộc hoặc tự lùi về dữ liệu có sẵn, nên error/offline trông như normal.

## 4. Số đo chung

- Cấu trúc: 59/59 màn normal có `<main>` và đúng 1 `h1`. 0 màn tràn ngang ở 390px.
- Axe (`node docs/2026-10-20-uat/tools/uiux/summarize.mjs axe`): `serious color-contrast => recycle-new×12, recycle-points×12, storefront-builder×2`. Không có critical, moderate hay minor. Theo D7, axe lúc đó cũng 0 vi phạm ở các màn cũ. 3 màn có lỗi đều là màn mới hoặc mới đổi (D6-04, D6-14). Không thấy lại C-071, C-072, C-077, C-114.
- Vùng chạm hiệu dụng dưới 44px (đã tính `tubu-hit-44`/`tubu-hit-44-square`). Chip 36px và stepper 36px đạt nhờ `::after`, nên C-068 coi như đã xử lý. Còn thật:
  - ô tìm kiếm cao 42px (`browse` 266×42, `feed` 326×42, `dealer` 190×42), nguồn `components/ui/search-field.tsx:77` (D6-16);
  - bóng gợi ý Vườn Xanh 243,8×42,5 (`orders`, `profile`, `browse` …), nguồn `components/garden-hint-bubble.tsx:38` (D6-16).
- Dương tính giả của phép đo, không ghi phát hiện:
  - `cart` 4 mục là ô chọn 24×24, bọc trong `hitArea('checkbox-hit-area', …)` ở `components/ui/form.tsx:137`;
  - tên SP 210×18 có `tubu-hit-44` ở `pages/cart.tsx:464`;
  - `brand-view` "Chứng nhận" 358×24 là `ScrollRow` cuộn ngang, không phải nút (`pages/brand-view.tsx:172`).
- Tiền và điểm: đều qua `formatVnd`/`formatPoints` (`utils/format.ts:99-102`). Không thấy "NaN", "-0", số không dấu chấm nghìn. Chỗ sai duy nhất là hệ số hạng "×1.2" và "điểm Xanh" ghép chữ ở `loyalty.tsx` (D6-06).
- Thuật ngữ: không có "xu" trên màn khách, trừ nhãn "Điểm Xanh (xu cũ)" (`i18n/vi.ts:448`, đã chấp nhận). Câu "Điểm không hết hạn dùng trả đơn hàng tới 100%" ở ví là luật lô quy đổi từ xu cũ (`about-data.ts:49`), không phải lỗi. Lẫn chữ: "Vườn Cây" (D6-07); "ship" / "vận chuyển" / "giao" (D6-17); Hủy/Huỷ (D8-15).

## 5. Luồng mua lõi: đếm chạm Trang chủ → đơn COD thành công

Persona khách cũ, có 1 địa chỉ mặc định theo địa giới mới. `flow-cod.mjs` ghi đè `POST /cart/items`, `GET /cart`, `GET /me/addresses`, `POST /checkout/place-order`; không ghi gì vào API thật. Cuộn trang không tính là chạm.

| Cách mua | Engine | Số chạm | Các chạm (kích thước nút) | Bằng chứng |
|---|---|---|---|---|
| Mua ngay | Chromium | 3 | thẻ SP 153×44 → "Mua ngay" 145×48 → "Đặt hàng" 358×48 | `screens/flow/flow-chromium-buynow.json`, `screens/flow/chromium-buynow-00..03.png` |
| Mua ngay | WebKit | 3 | như trên | `screens/flow/flow-webkit-buynow.json`, `screens/flow/webkit-buynow-00..03.png` |
| Qua giỏ | Chromium | 5 | thẻ SP → "Thêm vào giỏ" → icon giỏ 48×48 → "Thanh toán" 358×48 → "Đặt hàng" | `screens/flow/flow-chromium-cart.json`, `screens/flow/chromium-cart-00..05.png` |

- COD được chọn sẵn (`COD chọn sẵn: true` trong JSON). Màn thành công rõ ràng (`screens/flow/chromium-buynow-03.png`).
- Thẻ SP thật đầu tiên nằm ở y=2513px trên Trang chủ khách cũ. Nguyên nhân là kệ "Mua lại" và giờ vàng của bộ chụp dùng SP giả. Với dữ liệu thật, thẻ "Mua lại" ở màn đầu bấm được ngay. Không tính là lỗi.
- Khách mới chưa có địa chỉ: chưa đo, chưa kiểm chứng. C-065 (form địa chỉ khách mới ~12 chạm) vẫn ghi mở trong `docs/2026-10-review/findings-catalog.md:107`.

## 6. Phát hiện

Vùng file: mọi mục đều trong `apps/miniapp` (vùng phiên UAT), trừ khi ghi khác. "Mã cũ" là ID trong D7, catalog hoặc báo cáo UAT khác; trống nghĩa là mới.

| ID | Mức | Nhóm | Mã cũ | Vị trí | Tóm tắt |
|---|---|---|---|---|---|
| D6-01 | P2 | agent sửa ngay | D7 Chuyển khoản (1), còn mở | `pages/bank-payment.tsx:102,125,148,180`; `pages/storefront-view.tsx:43,48`; `css/tokens.css:62-64` | Hàng tiêu đề tách đôi: `className="page"` cộng 48px đệm trên, chồng với khoảng chừa 48px của PageHeader |
| D6-02 | P2 | agent sửa ngay | D7 trạng thái Chuyển khoản; liên quan D14-02 | `pages/bank-payment.tsx:123-143` | Lỗi/offline ở màn chuyển khoản là chữ trơn, không icon, tiêu đề, hotline, không báo mất mạng |
| D6-03 | P2 | agent sửa ngay | D7 việc 11 (Thanh toán (1)), còn mở | `components/checkout/address-section.tsx:40-74` | Cảnh báo "địa giới cũ" nằm sau cả danh sách địa chỉ, không rõ thuộc thẻ nào |
| D6-04 | P2 | agent sửa ngay | — | `pages/recycle-new.tsx:134`; `pages/recycle.tsx:304` | Món "Sắp có" mờ 0,55 làm chữ còn 3,99:1 và 2,38:1, axe serious ×12 mỗi màn |
| D6-05 | P2 | agent sửa ngay | D7 việc 8 (phần nút chữ), còn mở | `pages/feed.tsx:153-195` | Cộng đồng: ~380px đầu trang trước bài đầu; Xếp hạng/Sự kiện chỉ là icon |
| D6-06 | P3 | agent sửa ngay | — | `pages/loyalty.tsx:217,530`; `utils/format.ts:99-102` | Hiện "Tích điểm ×1.2 · 130.000 điểm Xanh": dấu chấm thập phân, "điểm Xanh" viết thường |
| D6-07 | P2 | agent sửa ngay | — | `pages/loyalty.tsx:443,456` | Gọi Vườn Xanh là "Vườn Cây" / "Vườn Cây Tubu", trái tên đã chốt |
| D6-08 | P3 | agent sửa ngay | — | `pages/browse.tsx:218-220`; `components/catalog/result-header.tsx:28` | Danh mục lỗi tải vẫn ghi "0 sản phẩm" |
| D6-09 | P3 | agent sửa ngay | D7 "ngoài top 12", còn mở | `hooks/use-categories.ts:39`; `components/catalog/category-grid.tsx:63` | Mọi danh mục thật cùng icon `LayoutGrid`, tên cắt 1 dòng ("Mỹ phẩm thiên …") |
| D6-10 | P3 | agent sửa ngay | D7 Giỏ, còn mở | `pages/cart.tsx:475` | Dòng SP chỉ có đơn giá, không có thành tiền khi SL > 1 |
| D6-11 | P3 | agent sửa ngay | D7 Ví (1), còn mở | `pages/wallet.tsx:192-210` | Số Điểm Xanh `price-xl` gãy "130.000 / điểm" vì cột giữa hẹp |
| D6-12 | P3 | agent sửa ngay | D7 Chuyển khoản, còn mở | `pages/bank-payment.tsx:208-211` | Hướng dẫn "Giữ nguyên nội dung …" là chữ đỏ xSmall, như báo lỗi |
| D6-13 | P3 | agent sửa ngay | D7 Cá nhân / việc 6, còn mở | `pages/profile.tsx:424` | Số điểm/tiền ở Cá nhân in `Heading` (serif Fraunces) |
| D6-14 | P3 | agent sửa ngay | — | `pages/storefront-builder.tsx:408` | Tên SP đang ẩn mờ 0,5, chữ 3,31:1, axe serious ×2 |
| D6-15 | P3 | agent sửa ngay | — | `pages/recycle-request.tsx:369`; `components/support-contact.tsx:39` | "Cần hỗ trợ? Nhắn Tubu Tree" ngay trên "Cần hỗ trợ?" của SupportContact |
| D6-16 | P3 | agent sửa ngay | — | `components/ui/search-field.tsx:77`; `components/garden-hint-bubble.tsx:32-38` | Ô tìm kiếm 42px, bóng gợi ý 42,5px, dưới 44px; bóng che nội dung lần đầu |
| D6-17 | P3 | agent sửa ngay | C-113 (phần chữ) | `i18n/vi.ts:226-227`; `pages/cart.tsx:681` | "miễn phí ship 🌿" ở giỏ, "Miễn phí vận chuyển" ở SP, "Miễn phí giao" ở Trang chủ |
| D6-18 | P3 | cần chủ quyết | — | `pages/product-detail.tsx:290-291,487`; cấu hình `freeshipThreshold`, `newCustomer.firstOrderFreeShip.minSubtotal` | Hai ngưỡng freeship 200.000đ và 199.000đ hiện ở hai màn, lệch nhau 1.000đ |
| D6-19 | P3 | agent sửa ngay | C-113, còn mở ở chỗ mới | `pages/community-leaderboard.tsx:19`; `pages/group-buy.tsx:63`; `pages/brand-story.tsx:27` | Emoji vẫn làm icon/trang trí ngoài game và hạng |
| D6-20 | P3 | agent sửa ngay + chủ tự làm | D7 việc 11 (dòng dự kiến giao), còn mở | `components/checkout/order-success.tsx:102`; cấu hình `shippingEta` | Thanh toán không có dòng "dự kiến giao"; chỉ màn thành công có, và UAT để `shippingEta` null |
| D6-21 | P2 | chủ tự làm | liên quan nhánh D10 (env) | `pages/product-detail.tsx:752`; `components/image-upload.tsx:6-7` | Thiếu `VITE_ZALO_OA_ID` thì mất icon Chat OA; thiếu `VITE_CLOUDINARY_*` thì không đổi được ảnh đại diện |
| D6-22 | P3 | chủ tự làm | D7 câu hỏi 4, còn mở | cấu hình `support.email` | Email CSKH công khai vẫn là `tubutree@gmail.com` |

### D6-01 — Hàng tiêu đề tách đôi ở Chuyển khoản và Gian hàng công khai (lỗi/404)

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí:
  - `pages/bank-payment.tsx:180` `<Page className="page" …>` rồi `:181` `<PageHeader title="Quét QR để chuyển khoản" …/>`. Cùng kiểu ở các nhánh `:102` (đang tải), `:125` (lỗi), `:148` (đã thanh toán).
  - `pages/storefront-view.tsx:48-49` (lỗi/404) và `:43` (đang tải).
  - Gốc ở `css/tokens.css:62-64`: `body.with-back-btn .page { padding-top: calc(var(--safe-top) + 48px); }`.
  - `components/ui/page-header.tsx:18,34` đã chừa sẵn `BACK_BUTTON_TITLE_CLEARANCE = 48` bên trái tiêu đề.
- Kịch bản:
  1. Khách vào `/bank-payment/<mã>` từ thanh toán. Trang con nên body có `with-back-btn`.
  2. `.page` đẩy cả PageHeader xuống 48px.
  3. Nút quay lại (fixed, top-left) nằm trong dải trống phía trên, tiêu đề nằm dòng dưới. Hai hàng thay vì một.
  - Màn khác dùng `<Page>` không có `className="page"` + PageHeader nên không bị.
  - Đây đúng là điều D7 ghi: "hàng tiêu đề khác mọi màn (nút quay lại một dòng, tiêu đề một dòng)". Nay đã tìm ra gốc.
- Bằng chứng: `screens/sheets/bank-payment__normal__p1.png`, `screens/sheets/bank-payment__normal__pair.png` (WebKit giống), `screens/sheets/storefront-view__states.png`. `rg -l 'className="page"' pages | xargs grep -l PageHeader` ra `bank-payment.tsx`, `storefront-view.tsx`, `checkout.tsx` và `game-layout.spec.tsx` (file test). Ở `checkout.tsx:362` chỉ có màn thành công, không có PageHeader nên không bị.
- Sửa: bỏ `className="page"` ở 6 chỗ trên (PageHeader đã tự cộng `--safe-top`, `page-header.tsx:30`). Nhánh đang tải không có PageHeader thì giữ đệm bằng `style={{ paddingTop: 'var(--safe-top)' }}`.
- Test: `bank-payment.spec.tsx` render khi `document.body.classList.add('with-back-btn')`, kiểm `container.querySelector('.page')` là null. Thêm chụp lại 390px bằng `tools/uiux/capture.mjs miniapp --only '^bank-payment$'`, tiêu đề phải ở y < 60.

### D6-02 — Trạng thái lỗi/offline của Chuyển khoản là chữ trơn

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/bank-payment.tsx:123-143`. Chỉ có `<Text>Không tải được thông tin thanh toán.</Text>`, nút "Thử lại" và "Xem đơn hàng".
- Mã cũ: D7 bảng trạng thái, hàng "Chuyển khoản": "không có icon; khác kiểu các màn khác". Còn mở. D14-02 đã ghi phần nghiệp vụ của cùng nhánh (đơn đã huỷ vẫn hiện QR); D6-02 chỉ là phần hiển thị.
- Kịch bản: khách mất mạng ở bước quét QR. Màn hiện cùng một câu như khi máy chủ lỗi. Không có câu "Có vẻ mất mạng…", không có hotline, trong khi mọi màn khác đều có. Đây là màn có tiền, khách dễ lo.
- Bằng chứng: `screens/sheets/bank-payment__states.png`; chữ trên màn `bank-payment__error__390` = "Thanh toán chuyển khoản | Không tải được thông tin thanh toán. | Thử lại | Xem đơn hàng"; offline giống hệt (`screens/miniapp/bank-payment__offline__390.png`).
- Sửa: dùng chung `ErrorState` (`components/ui/empty-state.tsx:115`) như các màn khác (icon, tiêu đề, câu offline khi `!navigator.onLine`, hotline), giữ 2 nút. Làm cùng D14-02 (phân biệt 400 "Đơn đã hủy" với lỗi mạng).
- Test: `bank-payment.spec.tsx`: (a) query lỗi → có role `alert`, chữ "Thử lại", "Xem đơn hàng" và số hotline; (b) `navigator.onLine = false` → có câu mất mạng.

### D6-03 — Cảnh báo địa giới cũ nằm sai chỗ ở thanh toán

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `components/checkout/address-section.tsx:40-42` vẽ mọi `AddressCard`, rồi `:44-74` mới vẽ khối `role="alert"` cho `selected`.
- Mã cũ: D7 việc 11 và hàng "Thanh toán (RC)" (1). Còn mở. Bên web đã làm cảnh báo trong từng thẻ (D7 hàng web "Thanh toán").
- Kịch bản: khách có 2 địa chỉ, địa chỉ đang chọn (thẻ 1) theo địa giới cũ. Hộp vàng hiện dưới thẻ 2, như thể thẻ 2 có vấn đề.
- Bằng chứng: `screens/sheets/checkout__normal__p1.png`, `screens/sheets/checkout__normal__pair.png`.
- Sửa: đưa khối cảnh báo vào trong `AddressCard` khi `active && isLegacyGeo(a)` (`utils/address-memory.ts:19`), hoặc chỉ hiện địa chỉ đang chọn + nút "Đổi" như D7 đề xuất.
- Test: `address-section.spec.tsx`: 2 địa chỉ, chọn thẻ 1 cũ → `alert` nằm trong thẻ 1 (`within(card1).getByRole('alert')`).

### D6-04 — Món "Sắp có" ở đổi rác không đạt tương phản

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/recycle-new.tsx:134` `...(comingSoon ? { opacity: 0.55 } : null)`; `pages/recycle.tsx:304` `opacity: item.status === 'COMING_SOON' ? 0.55 : 1`.
- Kịch bản: khách mở `/recycle/new` hoặc `/recycle/points`. Tên và mô tả món sắp có hiện 3,99:1 và 2,38:1, dưới 4,5:1. Người lớn tuổi hoặc ngoài nắng khó đọc.
- Bằng chứng: `summarize.mjs axe` → `serious color-contrast => recycle-new×12, recycle-points×12, …`; ảnh `screens/sheets/recycle-new__normal__p1.png`, `screens/sheets/recycle-points__normal__p1.png`.
- Sửa: bỏ `opacity`; dùng chữ `tone="tertiary"` (đã đạt token) + Badge "Sắp có" + `aria-disabled`.
- Test: Playwright `/recycle/new` với axe-core: 0 vi phạm serious. Hoặc spec kiểm phần tử `data-status="COMING_SOON"` không có `opacity` < 1.

### D6-05 — Đầu trang Cộng đồng quá cao, nút chỉ có icon

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/feed.tsx:153` PageHeader, `:154` CommunityChannels, `:167-184` hai `IconButton` Trophy/PartyPopper chỉ có `label` ẩn, `:186-194` nút "Đăng bài", sau đó ô tìm và 2 hàng chip.
- Mã cũ: D7 việc 8. Phần "tên 1 dòng" đã sửa; phần "nút có chữ Xếp hạng/Sự kiện" còn mở.
- Kịch bản: khách mở tab Cộng đồng ở 390×844. Khoảng 380px đầu là tiêu đề, kênh, hàng nút, ô tìm, 2 hàng chip. Bài đầu tiên chỉ lộ một phần. Khách không đoán được cúp và pháo hoa là "Xếp hạng" và "Sự kiện".
- Bằng chứng: `screens/sheets/feed__normal__p1.png`; `summarize.mjs small feed` cho ô tìm ở y=215, chip hàng 1 y=270, chip hàng 2 y=315.
- Sửa: đổi 2 IconButton thành Button `variant="secondary" size="sm"` có chữ; gộp hàng chip sắp xếp vào một nút "Sắp xếp"; hoặc thu CommunityChannels thành 1 dòng.
- Test: `feed.spec.tsx` có nút tên "Xếp hạng" và "Sự kiện" nhìn thấy (`getByRole('button', { name: 'Xếp hạng' })` có chữ hiện). Chụp lại: bài đầu tiên bắt đầu trước y=330.

### D6-06 — Hệ số hạng và chữ "điểm Xanh" ở trang Điểm Xanh

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/loyalty.tsx:217` `Tích điểm ×{data.tier?.multiplier ?? 1} · {formatPoints(lots?.total ?? 0)} Xanh`; `utils/format.ts:101` trả `${formatNumber(v)} điểm`; `pages/loyalty.tsx:530` `· ×{t.multiplier}`.
- Kịch bản: khách hạng Lộc Biếc (hệ số 1,2) thấy "Tích điểm ×1.2 · 130.000 điểm Xanh". Hai lỗi:
  - "1.2" dùng dấu chấm thập phân, trong khi số nghìn cũng dùng dấu chấm ("130.000"). Luật trong brief viết "×1,2".
  - "điểm Xanh" viết thường chữ đầu, trái thuật ngữ "Điểm Xanh". D8 quét chữ tĩnh không bắt được vì chuỗi ghép lúc chạy.
- Bằng chứng: `summarize.mjs grep 'điểm Xanh'` → `loyalty__normal__390 :: … Tích điểm ×1.2 · 130.000 điểm Xanh`; ảnh `screens/sheets/loyalty__normal__p1.png`.
- Sửa: `Tích điểm ×${formatNumber(m)} · ${formatNumber(total)} Điểm Xanh` (`formatNumber` theo vi-VN in "1,2"); `:530` dùng cùng cách.
- Test: `loyalty.spec.tsx` với `multiplier: 1.2` → có "×1,2" và "Điểm Xanh", không có "điểm Xanh".

### D6-07 — "Vườn Cây" thay cho "Vườn Xanh"

- Mức P2, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/loyalty.tsx:443` "…giọt nước Vườn Xanh điểm danh riêng trong Vườn Cây."; `:456` `title="Vườn Cây Tubu"`, bấm vào `navigate('/game')` (`:459`).
- Kịch bản: khách thấy tab giữa là "Vườn Xanh", vào Điểm Xanh lại thấy lối tắt "Vườn Cây Tubu" dẫn tới cùng màn. Hai tên cho một tính năng, trái thuật ngữ đã chốt.
- Bằng chứng: chữ trên `loyalty__normal__390`; ảnh `screens/sheets/loyalty__normal__p1.png`. `i18n/vi.ts:762` còn "Cộng đồng Vườn Tubu" làm tiêu đề Cộng đồng: tên cộng đồng, có thể cố ý, cần chủ xác nhận.
- Sửa: `:443` "…điểm danh riêng trong Vườn Xanh."; `:456` "Vườn Xanh".
- Test: `loyalty.spec.tsx` không có chuỗi "Vườn Cây"; thêm `rg -n "Vườn Cây" apps/miniapp/src` vào kiểm chữ nếu có.

### D6-08 — Danh mục lỗi tải vẫn ghi "0 sản phẩm"

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/browse.tsx:218-220` `total={firstPage?.meta.total ?? 0}` + `isLoading={products.isLoading}`; `components/catalog/result-header.tsx:28` in số khi không tải.
- Kịch bản: API sản phẩm lỗi 500 hoặc mất mạng. Khối lỗi hiện đúng, nhưng phía trên vẫn có "0 sản phẩm". Khách nghĩ cửa hàng hết hàng.
- Bằng chứng: `screens/miniapp/browse__error__390.png`, `screens/miniapp/browse__offline__390.png`, `screens/sheets/browse__states.png`.
- Sửa: truyền `total={products.isError ? undefined : …}`; `ResultHeader` ẩn số khi `total` undefined.
- Test: `browse.spec.tsx` mock lỗi → không có "0 sản phẩm", có "Thử lại".

### D6-09 — Danh mục cùng một icon, tên bị cắt

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `hooks/use-categories.ts:39` mọi danh mục thật lấy `icon: LayoutGrid`; `components/catalog/category-grid.tsx:63` `whiteSpace: 'nowrap'` + `textOverflow: 'ellipsis'`.
- Mã cũ: D7 hàng "Danh mục / tìm" và "Ngoài top 12". Còn mở.
- Kịch bản: khách ở `/browse` thấy 7 ô cùng icon lưới, "Mỹ phẩm thiên …", "Nông sản & Thự…".
- Bằng chứng: `screens/sheets/browse__normal__p1.png`, `screens/sheets/home__normal__p1.png`.
- Sửa: bảng icon theo slug danh mục (fallback `LayoutGrid`); nhãn tối đa 2 dòng (`-webkit-line-clamp: 2`, bỏ `nowrap`).
- Test: `use-categories.spec.ts`: slug đã biết → icon khác `LayoutGrid`; chụp lại 390px không có "…" ở tên danh mục.

### D6-10 — Giỏ không có thành tiền dòng

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/cart.tsx:475` `<PriceTag value={line.unitPrice} size="sm" />`.
- Mã cũ: D7 hàng "Giỏ hàng". Còn mở.
- Kịch bản: khách mua 3 chai, dòng vẫn chỉ ghi đơn giá; khách phải tự nhân.
- Bằng chứng: `screens/sheets/cart__normal__p1.png`, `screens/sheets/cart__normal__pair.png`.
- Sửa: khi `quantity > 1` thêm dòng nhỏ "Thành tiền {formatVnd(unitPrice × quantity)}" (hoặc dùng `line.total` nếu API trả).
- Test: `cart.spec.tsx` dòng SL 3, giá 95.000đ → có "285.000đ".

### D6-11 — Số Điểm Xanh ở Ví gãy hai dòng

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/wallet.tsx:192-210`: cột `flex: 1` chứa `price-xl` `formatPoints(...)` nằm giữa IconBubble, Badge hạng (`:205-209`) và chevron (`:210`).
- Mã cũ: D7 hàng "Ví Tubu" (1). Còn mở (D7 ghi `wallet.tsx:153`, nay dời xuống `:196`).
- Kịch bản: khách có 130.000 điểm và hạng Lộc Biếc: số hiện "130.000" dòng trên, "điểm" dòng dưới.
- Bằng chứng: `screens/sheets/wallet__normal__p1.png`.
- Sửa: `whiteSpace: 'nowrap'` cho số; dời Badge hạng xuống dưới số hoặc bỏ khỏi hàng.
- Test: chụp lại 390px, chiều cao phần tử số ≤ 1 dòng (Playwright `boundingBox().height` < 40).

### D6-12 — Hướng dẫn giữ nội dung chuyển khoản là chữ đỏ

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/bank-payment.tsx:208-211` `<Text size="xSmall" style={{ color: 'var(--color-text-danger)' … }}>`.
- Mã cũ: D7 hàng "Chuyển khoản". Còn mở.
- Kịch bản: khách chưa làm sai gì nhưng thấy chữ đỏ nhỏ như báo lỗi, ngay dưới mã QR.
- Bằng chứng: `screens/sheets/bank-payment__normal__p1.png`.
- Sửa: đưa vào hộp ghi chú `--color-status-warning-bg` cỡ body-sm, nội dung chuyển khoản in đậm có nút sao chép.
- Test: `bank-payment.spec.tsx` dòng hướng dẫn không dùng `--color-text-danger`.

### D6-13 — Số ở Cá nhân in serif

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/profile.tsx:424` `<Heading variant="title-sm" as="div" tone="brand">{value}</Heading>`.
- Mã cũ: D7 hàng "Cá nhân" và việc 6 (luật typography: số dùng Inter tabular). Còn mở ở chỗ này. Bố cục 2 + 1 là cố ý, không ghi lỗi.
- Bằng chứng: `screens/sheets/profile__normal__p1.png`.
- Sửa: `<Text variant="price-md">` (sans, tabular) thay Heading.
- Test: chụp lại; spec kiểm phần tử số không có class/biến font serif.

### D6-14 — Tên SP đang ẩn trong trình dựng gian hàng không đạt tương phản

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/storefront-builder.tsx:408` `opacity: it.isHidden || it.hiddenReason ? 0.5 : 1`.
- Kịch bản: CTV có SP bị ẩn: tên SP còn 3,31:1. Badge "Khách không thấy: …" (`:410-413`) tràn thẻ trên ảnh, nhưng lý do ở dữ liệu giả là một đoạn mô tả dài. Với lý do thật: chưa kiểm chứng.
- Bằng chứng: axe `storefront-builder×2` (`summarize.mjs axe`); ảnh `screens/sheets/storefront-builder__normal__p1.png`.
- Sửa: bỏ `opacity`, dùng `tone="tertiary"`; Badge cho `maxWidth: '100%'` + `whiteSpace: 'normal'`.
- Test: axe `/storefront` (persona CTV) 0 serious.

### D6-15 — "Cần hỗ trợ?" lặp ở chi tiết yêu cầu đổi rác

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `pages/recycle-request.tsx:369` `Cần hỗ trợ? Nhắn Tubu Tree` ngay trước `<SupportContact />` (`:370`); SupportContact tự in `vi.orders.support` = "Cần hỗ trợ?" (`components/support-contact.tsx:39`, `i18n/vi.ts:346`).
- Bằng chứng: `summarize.mjs grep 'Cần hỗ trợ'` → `recycle-request__normal__390 :: Cần hỗ trợ? Nhắn Tubu Tree || Cần hỗ trợ?`; ảnh `screens/sheets/recycle-request__normal__p1.png`.
- Sửa: bỏ dòng `:369`.
- Test: `recycle-request.spec.tsx` `getAllByText(/Cần hỗ trợ/)` có độ dài 1.

### D6-16 — Ô tìm kiếm và bóng gợi ý dưới 44px

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí: `components/ui/search-field.tsx:77` `height: 42`; `components/garden-hint-bubble.tsx:38` `padding: '10px 14px'`, vị trí `bottom: calc(100% + 34px)` (`:34`).
- Kịch bản:
  - Ô tìm ở `browse`, `feed`, `dealer` cao 42px.
  - Bóng "Trồng cây mỗi ngày, nhận quà thật" cao 42,5px.
  - Bóng nổi trên thanh tab, che nội dung ở y≈709 mỗi lần cài mới (một lần mỗi máy).
- Bằng chứng: `summarize.mjs small browse` → `input[Tìm sản phẩm] 266x42`, `div[Trồng cây mỗi ngày, nhận quà thật] 243.8x42.5 @73,709`; `small dealer` → `input[Tìm sản phẩm] 190x42`; ảnh `screens/miniapp/orders__normal__390.png`.
- Sửa: `height: 44`; bóng `minHeight: 44`.
- Test: `search-field.spec.tsx` kiểm style height ≥ 44.

### D6-17 — Ba cách gọi "miễn phí vận chuyển", có emoji

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí:
  - `i18n/vi.ts:226` `freeshipReached: 'Bạn được miễn phí ship 🌿'`;
  - `i18n/vi.ts:227` "…để được miễn phí ship";
  - `pages/cart.tsx:681` "…giao được miễn phí ship".
- Kịch bản:
  - Giỏ ghi "miễn phí ship 🌿" và "Tạm tính (đã giảm, chưa gồm ship)".
  - Trang SP ghi "Miễn phí vận chuyển cho đơn từ 200.000đ".
  - Trang chủ khách mới ghi "Miễn phí giao cho đơn đầu tiên từ 199.000đ".
- Mã cũ: C-113 (emoji làm icon) ghi các chỗ onboarding, reviews-section, post-card, bank-payment; các chỗ đó nay không còn emoji. Chỗ này là mới.
- Bằng chứng: `summarize.mjs grep 'ship'` (`cart__normal__390 :: Bạn được miễn phí ship 🌿 || Tạm tính (đã giảm, chưa gồm ship)`), `grep '199|200\.000'`.
- Sửa: chọn một chữ (đề xuất "miễn phí vận chuyển", khớp trang SP), bỏ 🌿 hoặc thay bằng icon `Truck`.
- Test: kiểm chuỗi trong `vi.spec`/snapshot không có "ship" ở chữ khách.

### D6-18 — Hai ngưỡng freeship 200.000đ và 199.000đ

- Mức P3, nhóm cần chủ quyết. Vùng UAT (cấu hình).
- Vị trí: `pages/product-detail.tsx:290-291` lấy `cart.data?.freeshipThreshold` (đã đăng nhập) hoặc `config.freeshipThreshold`, in ở `:487`. `/config/public` UAT: `freeshipThreshold: 200000`, `newCustomer.firstOrderFreeShip { enabled: true, minSubtotal: 199000 }`.
- Kịch bản: khách mới thấy Trang chủ "Miễn phí giao cho đơn đầu tiên từ 199.000đ", vào SP thấy "Miễn phí vận chuyển cho đơn từ 200.000đ". Lệch 1.000đ trông như gõ sai. Luật đã chốt chỉ nói đơn đầu từ 199.000đ; ngưỡng chung 200.000đ không có trong luật. Chưa kiểm chứng giỏ thật của khách mới trả `freeshipThreshold` bao nhiêu (bản chụp dùng giỏ mẫu của khách cũ).
- Bằng chứng: `summarize.mjs grep '199|200\.000'` → `home-new-customer__normal__390 :: Miễn phí giao cho đơn đầu tiên từ 199.000đ`, `product-detail__normal__390 :: Miễn phí vận chuyển cho đơn từ 200.000đ`.
- Đề xuất cho chủ: (a) đặt ngưỡng chung 199.000đ cho cùng một số; hoặc (b) giữ hai số, nhưng trang SP của khách mới ghi theo luật đơn đầu.
- Test (nếu chọn b): `product-detail.spec.tsx` khách mới → chữ 199.000đ.

### D6-19 — Emoji còn làm icon ngoài game/hạng

- Mức P3, nhóm agent sửa ngay. Vùng UAT.
- Vị trí:
  - `pages/community-leaderboard.tsx:19` `MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }`;
  - `pages/group-buy.tsx:63` snackbar "🎉 … 🛒";
  - `pages/brand-story.tsx:27` câu dẫn kết bằng 🌿.
  - Emoji trong `loyalty.tsx` (hạng) và `components/wheel.tsx:9` (game) nằm ngoài phạm vi C-113 nên không ghi.
  - Câu chia sẻ (`affiliate.tsx:554`, `share-sheet.tsx:76`, `brand-view.tsx:297`) là chữ khách gửi đi, giữ được.
- Mã cũ: C-113. Các chỗ C-113 liệt kê đã sạch; đây là chỗ còn lại.
- Bằng chứng: `screens/sheets/feed-leaderboard__normal__p1.png`, `screens/sheets/brand-story__normal__p1.png`.
- Sửa: huy chương dùng icon `Medal` lucide tô vàng/bạc/đồng; bỏ emoji ở 2 chỗ còn lại.
- Test: `community-leaderboard.spec.tsx` không có ký tự emoji (regex `\p{Extended_Pictographic}`).

### D6-20 — Thanh toán chưa có dòng dự kiến giao

- Mức P3, nhóm agent sửa ngay + chủ tự làm. Vùng UAT.
- Vị trí: chỉ `components/checkout/order-success.tsx:102` in ETA, và chỉ khi có cấu hình; UAT `shippingEta` null.
- Mã cũ: D7 việc 11 ("dòng dự kiến giao"). Còn mở.
- Kịch bản: khách cân nhắc ở bước thanh toán không biết bao giờ nhận hàng.
- Bằng chứng: `screens/sheets/checkout__normal__p1.png` (không có dòng giao dự kiến); `screens/flow/chromium-buynow-03.png`.
- Sửa: agent thêm dòng ETA dưới phí vận chuyển ở thanh toán, ẩn khi cấu hình rỗng. Chủ điền cấu hình ETA.
- Test: `checkout.spec.tsx` có cấu hình ETA → có dòng "Dự kiến giao".

### D6-21 — Biến build ảnh hưởng giao diện: Chat OA và đổi ảnh đại diện

- Mức P2, nhóm chủ tự làm. Vùng UAT (env build).
- Vị trí: `pages/product-detail.tsx:752` icon Chat OA chỉ hiện khi `hasOA` (có `VITE_ZALO_OA_ID`); `components/image-upload.tsx:6-7` đọc `VITE_CLOUDINARY_*`.
- Kịch bản: bản build thiếu `VITE_ZALO_OA_ID` thì trang SP mất icon Chat OA (D7 việc 3). Thiếu `VITE_CLOUDINARY_*` thì đổi ảnh đại diện báo "Chưa đổi được ảnh đại diện…".
- Bằng chứng: bản chụp này build chỉ có `VITE_API_BASE_URL`, không thấy icon OA (`screens/sheets/product-detail__normal__p1.png`). Bản build PROD có 2 biến hay không: chưa kiểm chứng; nhánh D10 (ma trận env, `logs/d10-env-matrix-api.md`) phụ trách.
- Sửa: chủ đặt 2 biến khi build PROD.
- Test: bước kiểm sau build: `rg -c "<OA_ID>" apps/miniapp/dist` > 0.

### D6-22 — Email CSKH là Gmail

- Mức P3, nhóm chủ tự làm. Vùng cấu hình.
- Vị trí: `/config/public` UAT `support.email: 'tubutree@gmail.com'`, hiện ở chi tiết đơn và Về Tubu.
- Mã cũ: D7 câu hỏi 4. Còn mở.
- Bằng chứng: `screens/sheets/order-detail__normal__p1.png`, `screens/sheets/about__normal__p1.png`.
- Sửa: chủ đặt `support.email` theo tên miền.

### Mục D7 còn mở, không tách thành D6 (việc thiết kế lớn hơn hoặc đã có nhánh khác ghi)

| Mã cũ | Trạng thái nay | Ảnh |
|---|---|---|
| D7 việc 5 / câu hỏi 1: logo có tagline ở header (`components/home/home-header.tsx:21`) | Còn mở, chờ chủ quyết logo | `screens/sheets/home__normal__p1.png` |
| D7 việc 11: Điểm Xanh 7 khối, mã giảm giá không có nút "Dùng"; khối điểm ở thanh toán dày chữ | Còn mở | `screens/sheets/loyalty__normal__p1.png`, `screens/sheets/checkout__normal__p1.png` |
| D7 việc 8: ảnh chi tiết bài xếp dọc | Còn mở | `screens/sheets/post-detail__normal__p1.png` |
| D7 việc 10: trình dựng gian hàng ô bìa trống, 3 icon mỗi dòng | Còn mở | `screens/sheets/storefront-builder__normal__p1.png` |
| D7 Gian hàng công khai: lời giới thiệu CTV là hộp tách | Còn mở | `screens/miniapp/storefront-view__normal__390.png` |
| D7 Trang nhãn: 4 thẻ khuyến mãi to, khối đại lý | Còn mở | `screens/sheets/brand-view__normal__p1.png` |
| D7 Cá nhân: không có hàng trạng thái đơn | Còn mở | `screens/sheets/profile__normal__p1.png` |
| D7 Quản trị: "Thu hồi" đỏ, "Huỷ" xanh | Còn mở | `screens/sheets/admin__normal__p1.png` |
| D7 Duyệt cộng đồng: ảnh to, "Từ chối" đỏ đặc | Còn mở | `screens/sheets/admin-community__normal__p1.png` |
| D7 Mua chung: nhóm hết hạn ở trên | Còn mở | `screens/sheets/group-buy__normal__p1.png` |
| D7 Kênh đại lý: màu navy riêng | Còn mở, cần chủ quyết | `screens/sheets/dealer__normal__p1.png` |
| D7 Thông báo: một icon chuông cho mọi loại | Còn mở | `screens/sheets/notifications__normal__p1.png` |
| D8-15: Hủy/Huỷ, Xóa/Xoá | Còn mở. Ảnh: chi tiết đơn có "quá hạn đơn sẽ tự huỷ" cạnh nút "Hủy đơn"; sổ địa chỉ "Xóa", tìm kiếm "Xoá tìm kiếm & bộ lọc" | `screens/sheets/order-detail__normal__p1.png`, `screens/sheets/addresses__normal__p1.png` |
| D8-12: tiếng Anh ở màn nhân viên ("Quên checkout?" `staff.tsx:225`, "Copy tuần trước" `staff.tsx:481`, nút bị cắt chữ) | Còn mở | `screens/miniapp/staff__normal__390.png` |
| C-065: form địa chỉ khách mới nhiều chạm | Còn mở trong catalog; chưa đo lại | — |

### D7 đã sửa, thấy trên ảnh

- D7 việc 2: thẻ đơn chờ thanh toán có "Thanh toán ngay" + "Hạn …" (`screens/sheets/orders__normal__p1.png`).
- D7 việc 3: tên SP 17/600, tiêu đề mục một kiểu. Phần Chat OA chưa kiểm chứng (D6-21).
- D7 việc 7: trạng thái lỗi/rỗng có tiêu đề, icon riêng, hotline, kệ gợi ý; Trang chủ lỗi chỉ một dải.
- D7 việc 1: khối "Quà khách mới" lên đầu cho khách mới.
- D7 việc 8: tên tác giả bài cộng đồng 1 dòng.
- D7 việc 9: lối tắt CTV lên đầu, 2 ô KPI cùng kiểu.
- D7 việc 10: danh sách khuyến mãi chủ nhãn không vỡ cột.
- D7 việc 12:
  - kẹp "Đã bán" ≤ 100%;
  - bỏ emoji tiêu đề giờ vàng;
  - ẩn "Mời thêm -2";
  - ẩn "% hoa hồng" khi rỗng;
  - định dạng số vòng quay;
  - "Điểm danh" không cắt chữ.
- Chuyển khoản có hạn + đếm ngược trong hộp cảnh báo.
- Vườn Xanh chia tab.
- C-068 (chip < 44px): đạt nhờ `tubu-hit-44` (`components/ui/chip.tsx:42`).
- C-083: `toLocaleString` rải rác trong pages: 0 chỗ (format tập trung ở `utils/format.ts`).

## 7. Top 10 việc nâng điểm nhiều nhất cho ít công nhất

Mọi file trong `apps/miniapp/src`, vùng phiên UAT. Công sức S = dưới 30 phút kể cả test.

| # | Việc | File:dòng | Mã | Màn tăng dự kiến | Công |
|---|---|---|---|---|---|
| 1 | Bỏ `className="page"` ở các Page có PageHeader | `pages/bank-payment.tsx:102,125,148,180`; `pages/storefront-view.tsx:43,48` | D6-01 | Chuyển khoản 3,5 → 4; Gian hàng công khai (lỗi/404) | S |
| 2 | Dùng ErrorState chung cho lỗi/offline chuyển khoản | `pages/bank-payment.tsx:123-143` | D6-02 (+ D14-02) | Chuyển khoản lỗi 3 → 4 | S |
| 3 | Cảnh báo địa giới cũ vào trong thẻ đang chọn | `components/checkout/address-section.tsx:40-74` | D6-03 | Thanh toán 3,5 → 4 | S–M |
| 4 | Bỏ `opacity` món "Sắp có", dùng chữ tertiary + Badge | `pages/recycle-new.tsx:134`; `pages/recycle.tsx:304` | D6-04 | Đổi rác 3 → 3,5; axe về 0 ở 2 màn | S |
| 5 | Sửa chữ trang Điểm Xanh: "×1,2", "Điểm Xanh", "Vườn Xanh" | `pages/loyalty.tsx:217,443,456,530` | D6-06, D6-07 | Điểm Xanh (đúng thuật ngữ chốt) | S |
| 6 | Icon riêng theo danh mục + nhãn 2 dòng | `hooks/use-categories.ts:39`; `components/catalog/category-grid.tsx:63` | D6-09 | Danh mục 4 → 4,5; Trang chủ | S–M |
| 7 | Thành tiền dòng khi SL > 1 | `pages/cart.tsx:475` | D6-10 | Giỏ 4 → 4,5 | S |
| 8 | Số Điểm Xanh ở Ví không gãy: `nowrap`, Badge xuống dưới | `pages/wallet.tsx:196-209` | D6-11 | Ví 3 → 3,5 | S |
| 9 | Nút "Xếp hạng"/"Sự kiện" có chữ, gọn hàng chip | `pages/feed.tsx:167-184` | D6-05 | Cộng đồng 3 → 3,5 | S–M |
| 10 | Hướng dẫn chuyển khoản vào hộp ghi chú; ẩn "0 sản phẩm" khi lỗi | `pages/bank-payment.tsx:208-211`; `pages/browse.tsx:218-220` | D6-12, D6-08 | Chuyển khoản, Danh mục lỗi | S |

Ngay sau top 10, cũng cỡ S:
- ô tìm 44px (`components/ui/search-field.tsx:77`, D6-16);
- bỏ dòng "Cần hỗ trợ?" lặp (`pages/recycle-request.tsx:369`, D6-15);
- số ở Cá nhân dùng sans (`pages/profile.tsx:424`, D6-13);
- tên SP ẩn không mờ (`pages/storefront-builder.tsx:408`, D6-14);
- đổi chữ "ship" (`i18n/vi.ts:226-227`, `pages/cart.tsx:681`, D6-17).

## 8. Hạn chế, chưa làm

- Chạy trong Chromium/WebKit headless, ngoài Zalo. Chưa thử trên máy thật trong Zalo: thanh tiêu đề Zalo, safe-area thật, bàn phím ảo.
- Dữ liệu ngoài GET công khai là dữ liệu giả. Phần chấm điểm đã bỏ lỗi do dữ liệu giả, nhưng một số chi tiết phụ thuộc dữ liệu thật vẫn chưa kiểm chứng:
  - giỏ thật của khách mới trả ngưỡng freeship bao nhiêu (D6-18);
  - lý do ẩn SP thật có làm tràn Badge không (D6-14).
- Chưa đo số chạm của khách mới chưa có địa chỉ (C-065).
- Icon Chat OA trên trang SP chưa kiểm chứng: bản chụp không có `VITE_ZALO_OA_ID`.
- Trạng thái `long` (chữ dài) của bộ gốc không chạy. WebKit chỉ chạy 8 màn lõi.
- Ô ngày trong headless hiện dạng mm/dd/yyyy: chưa kiểm chứng trên Zalo.
- Trợ lý AI tắt ở UAT nên không chấm.

## 9. Chạy lại

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
(cd apps/miniapp && VITE_API_BASE_URL=http://127.0.0.1:3221/api npx vite --host 127.0.0.1 --port 3223)
node docs/2026-10-20-uat/tools/uiux/capture.mjs miniapp --vp 390
node docs/2026-10-20-uat/tools/uiux/capture.mjs miniapp --vp 390 --engine webkit --only '^(home|browse|product-detail|cart|checkout|bank-payment|orders|order-detail)$'
node docs/2026-10-20-uat/tools/uiux/flow-cod.mjs chromium buynow
node docs/2026-10-20-uat/tools/uiux/summarize.mjs axe
node docs/2026-10-20-uat/tools/uiux/sheet.mjs tiles bank-payment
```

Đã dừng Vite 3223 (PID 34674, 34725, 35080), cổng 3223 không còn nghe. API 3221 (PID 68811) giữ nguyên. Chromium headless PID 89164 là con của `node docs/2026-10-20-uat/tools/uiux/d7/capture.mjs --set admin` (PID 89091, phiên khác), không phải của nhánh này, nên không đụng.
