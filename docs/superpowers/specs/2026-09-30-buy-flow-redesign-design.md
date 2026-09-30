# Dự án 4 — Redesign luồng mua (spec)

Ngày: 2026-09-30 · Nhánh gốc: `main` (`549a25e`) · Tiền đề: Design System v2 đã xong (dự án 3), analytics nền đã có (dự án 2).

## 1. Mục tiêu & tiêu chí thành công

**North-star:** tỉ lệ khách có đơn thứ 2 trong 30 ngày và số đơn/khách/tháng. Dự án 4 làm phần **giao diện + luồng** của vòng mua lại; kênh nhắc ngoài app (ZNS/OA) và engine chu kỳ theo SKU thuộc dự án 5.

Tiêu chí thành công (đo được):
1. Khách cũ mở app thấy kệ "Mua lại" trước mọi kệ khác; mua lại một sản phẩm đã mua tối đa **2 chạm** từ Home (chạm "Mua lại" → xác nhận trong sheet), so với 6 chạm hiện nay.
2. Mọi điểm vào "Mua lại" (Home, thẻ đơn, chi tiết đơn, thông báo nhắc) dùng chung một luồng và bắn cùng bộ event (`reorder_clicked`, `reorder_completed`), gắn `addSource='repurchase'`/`'reorder_notification'`.
3. Tab bar phản ánh hành vi lặp lại: tab **Đơn hàng** thay tab "Ví & HH".
4. Không dòng hết hàng nào có thể đi tới bước "Đặt hàng" mà không được báo trước; retry sau timeout không tạo đơn trùng.
5. Home, Browse, màn đặt hàng thành công dùng 100% component DS v2 (không còn biến CSS cũ `--neutral-*/--primary-*/--leaf-*` trong các file này).

Nguồn phát hiện: `docs/audit-2026-09/02-purchase-funnel.md` (A2-04…A2-57), `01-ia-navigation.md`, `docs/superpowers/plans/2026-09-28-design-system-v2-followups.md`.

## 2. Phạm vi

**Trong phạm vi (4 đợt, làm tuần tự, mỗi đợt một plan riêng, mỗi đợt merge/verify được riêng):**
- **4a** Nhịp mua lại + tab bar + màn đặt hàng thành công.
- **4b** Khám phá & tìm kiếm (Home + Browse).
- **4c** PDP & hết hàng.
- **4d** Giỏ & checkout (logic; đụng luồng tiền).

**Ngoài phạm vi (không làm, không lén làm):**
- Kênh ZNS/OA, engine chu kỳ mua lại theo SKU, Subscribe & Save 2.0, chương trình "đơn thứ 2" (dự án 5).
- Web shop (`apps/web` giữ nguyên palette/spacing cũ) và web admin (dự án 7).
- Nhập dữ liệu nội dung sản phẩm (dung tích/HSD/cách dùng/loại da) — cần admin của dự án 7; PDP chỉ hiển thị khi dữ liệu tồn tại.
- Resize/srcset ảnh, tối ưu số request lần render đầu (A2-49/A2-50).
- Migrate ~35 trang còn lại ngoài luồng mua (game, loyalty, CTV…) — sẽ dần theo dự án 5/6; khối alias legacy trong `css/tokens.css` vẫn giữ tới khi xong.

**Quyết định đã chốt với chủ shop (2026-09-30):** làm cả 4 nhóm + đổi kiến trúc thông tin (tab bar) ngay trong đợt đầu; cách tổ chức = một spec, 4 đợt.

**Quyết định tự chọn (ghi để chủ shop phản đối nếu cần):**
- Ngày giao dự kiến = khoảng cố định từ `SystemConfig` (`shipping.eta_min_days`, `shipping.eta_max_days`), chưa tính theo tỉnh.
- "Báo khi có hàng" chỉ nhắc **in-app** (`BACK_IN_STOCK`), chưa ZNS (mẫu ZNS chưa được Zalo duyệt — audit A3-01).
- Tìm không dấu bằng extension Postgres `unaccent` (trusted từ PG13, chủ DB tạo được); nếu môi trường prod không tạo được, fallback = chuẩn hoá chuỗi tìm ở tầng service (bỏ dấu tiếng Việt bằng hàm thuần) trên cột `name` đã có — quyết định ở plan 4b sau khi kiểm tra DB prod.
- Cột nội dung mới cho Product **không** thêm ở dự án này (chỉ đọc `variation.attributes` sẵn có).

## 3. Phần dùng chung (làm trước, trong plan 4a)

### 3.1 API: `GET /me/purchased-items`
Trả các variation khách đã mua thành công (đơn `DELIVERED`), nhóm theo variation:
```
{ items: [{ variationId, productId, slug, productName, variationName, thumbnail,
            price, salePrice?, inStock, timesBought, lastPurchasedAt }], nextCursor? }
```
Sắp xếp `lastPurchasedAt desc`, phân trang theo cursor, mặc định 20. Không đổi schema (thumbnail lấy bằng join `Variation → Product`). Loại variation/sản phẩm đã ngừng bán khỏi kết quả (hoặc trả kèm `inStock:false` nếu chỉ hết hàng). Chỉ trả dữ liệu của chính user (auth bắt buộc; không nhận `userId` từ client).

### 3.2 API: `POST /orders/:code/repurchase` v2
- Body tuỳ chọn `{ items?: [{ orderItemId, quantity }] }`; không truyền = toàn bộ dòng như cũ (tương thích ngược).
- Mỗi dòng xử lý độc lập; **một dòng lỗi không dừng cả vòng lặp**. Trả `{ cart, results: [{ orderItemId, status: 'added'|'partial'|'skipped', reason?: 'OUT_OF_STOCK'|'INACTIVE'|'NOT_APPROVED'|'EXCEEDS_STOCK', addedQuantity }] }`.
- Kiểm `Product.approvalStatus` như `cart.addItem` (hiện thiếu).
- Truyền `addSource: 'repurchase'` (hoặc `'reorder_notification'` khi client báo) để `add_to_cart` không còn bị ghi nhầm là `'pdp'`.
- Không thêm cột `thumbnail` vào `OrderItem`; ảnh lấy bằng join theo `variationId` khi liệt kê đơn.

### 3.3 Miniapp: `useReorder()` + `ReorderSheet`
- `ReorderSheet` (BottomSheet DS v2): danh sách dòng có checkbox + `QuantitySelector`, dòng hết hàng mờ + không chọn được, tổng tạm tính, CTA "Thêm vào giỏ (n)". Thành công → cập nhật `['cart']` → toast + nút "Xem giỏ" (không tự chuyển trang nếu mua lại từ Home).
- `useReorder(source)` bao gồm gọi API, xử lý `results` (thông báo dòng bị bỏ qua bằng lý do tiếng Việt), bắn event.
- Điểm dùng: kệ Home, thẻ đơn, chi tiết đơn, thông báo `REORDER_REMINDER`, kệ "Mua lại" trong tab Đơn hàng.
- Mua lại **một sản phẩm** (từ `purchased-items`) dùng `cart.addItem` trực tiếp (`addSource:'repurchase'`) + mở sheet chỉ khi cần chọn số lượng/phân loại khác.

### 3.4 Events (client, qua `trackEvent`)
`reorder_clicked {source: home_rail|order_card|order_detail|notification|orders_tab, orderCode?, variationId?}`, `reorder_completed {source, added, skipped}`, `reorder_reminder_cta {notificationId}`, `search_result_clicked {q, position}`, `filter_applied {type}`, `stock_alert_subscribed {variationId}`. Tên event tự do ở server (`@IsString`), không cần đổi DTO.

### 3.5 Điều hướng
- Tạo `apps/miniapp/src/components/nav-config.ts` là nguồn duy nhất cho tab bar + `ROOTS` (thay bản lặp ở `back-button.tsx:15`, `bottom-nav.tsx:28`).
- `CartButton` (icon + `CartBadge`) là component dùng chung ở header mọi trang mua sắm; cart count query dùng chung một hook `useCartCount()` (thay 3 bản `useQuery(['cart'])` lặp ở home/browse/PDP).

## 4. Đợt 4a — Nhịp mua lại + tab bar + đặt hàng thành công

### 4a.1 Tab bar
5 tab: Trang chủ · Danh mục · Vườn Xanh (giữa, giữ dạng vòng tròn) · **Đơn hàng** (thay `/wallet`) · Cá nhân. Badge trên tab Đơn hàng = số đơn đang xử lý (`PENDING_PAYMENT/CONFIRMED/PACKED/SHIPPING`) từ endpoint nhẹ `GET /orders/active-count`.
- `/orders` thành trang gốc (có bottom padding, không back-button).
- `/wallet` thành trang con mở từ Cá nhân (`profile.tsx` đã truyền `state.from`).
- Hub Cá nhân: bỏ các mục đã có ở tab (Đơn hàng, Đặt định kỳ), giữ Ví/Ưu đãi/Yêu thích/Sổ địa chỉ; không tái cấu trúc sâu hơn (thuộc dự án 5).

### 4a.2 Trang Đơn hàng (tab)
Đầu trang: kệ **Mua lại** (lưới `purchased-items`, `ProductTile` biến thể mua lại). Dưới: `SegmentedTabs` Tất cả · Đang xử lý · Đang giao · Đã giao · Đã huỷ/hoàn · Định kỳ (nhúng nội dung `/subscriptions`, route cũ redirect). Thêm tab "Đang đóng gói" và "Đã hoàn" vốn thiếu (A2-47).
- Thẻ đơn: ảnh sản phẩm đầu (join), số món, tổng tiền, trạng thái, nút **Mua lại** (mở `ReorderSheet`).

### 4a.3 Home — kệ Mua lại (chỉ phần dùng chung; migrate toàn trang ở 4b)
Khách đã đăng nhập có ≥1 đơn giao thành công: kệ "Mua lại" là khối đầu tiên dưới ô tìm; khách mới không thấy kệ này. Ở 4a chỉ thêm khối này vào Home hiện tại (chưa migrate DS v2 toàn trang); 4b hoàn tất migrate.
- `/products/for-you`: bỏ điều kiện loại sản phẩm đã mua (`catalog.service.ts:207`); sản phẩm đã mua vẫn có thể xuất hiện nhưng xếp sau các sản phẩm chưa mua trong cùng kết quả.

### 4a.4 Thông báo nhắc mua lại
`REORDER_REMINDER` mở `ReorderSheet` với đúng variation từ payload (`variation_id`); payload hiện thiếu `product_slug` khi sản phẩm không còn slug → fallback: mở `/orders`. Thay CTA hardcode + emoji trong `notifications.tsx` bằng `Button` DS v2 cho loại này. Bắn `reorder_reminder_cta`.

### 4a.5 Màn đặt hàng thành công (`components/checkout/order-success.tsx`)
Làm lại theo DS v2: mã đơn (copy được), tổng tiền, điểm sẽ nhận, **ngày giao dự kiến** (config), 3 bước tiếp theo (xác nhận → đóng gói → giao), CTA chính "Theo dõi đơn", phụ "Tiếp tục mua sắm"; gợi ý "Đặt định kỳ" hiện với đơn có sản phẩm cho phép đặt định kỳ (dùng cùng điều kiện mà PDP đang dùng để hiện nút "Đặt định kỳ"; đơn không có sản phẩm nào đủ điều kiện thì ẩn). Bỏ lá rơi/emoji chức năng.

## 5. Đợt 4b — Khám phá & tìm kiếm

### 5b.1 Home (migrate DS v2 hoàn toàn)
Thứ tự khối (khách cũ): Header (logo, chuông, `CartButton`) → ô tìm → **kệ Mua lại** → dải "đơn đang giao / kỳ định kỳ kế tiếp" (nếu có) → Flash sale → "Dành cho bạn" → "Bán chạy" → Danh mục thật → "Đã xem gần đây" → Featured/Mới về. Khách mới: bỏ kệ Mua lại và dải đơn; ưu tiên Flash sale + Bán chạy + Danh mục. Bỏ 2 nút AI/Mua chung khỏi vị trí đầu (chuyển thành thẻ nhỏ dưới) — copy hero "Khám phá vườn" đổi để không nhầm với game Vườn Xanh (A2-33). Lưới sản phẩm đầu tiên nằm trong 5 khối đầu (hiện là khối thứ 11).

### 5b.2 Browse (migrate DS v2)
- Danh mục thật từ `GET /categories` (fallback 4 phân khúc nếu rỗng); bỏ "Xu hướng = 6 thương hiệu".
- Gợi ý khi gõ bằng `GET /search/suggest` (debounce 250 ms, sản phẩm + danh mục + từ khoá gần đây).
- Tìm không dấu (§2).
- Bộ lọc trong một `BottomSheet`: khoảng giá, chỉ còn hàng, thương hiệu, đánh giá ≥4; áp dụng bằng nút, hiện số kết quả.
- Sắp xếp: Gợi ý · Bán chạy · Mới nhất · Giá tăng · Giá giảm. **Implement `best_seller`** trong `orderBy` theo `soldApp + soldExternal desc`.
- Trạng thái `q`, `sort`, lọc, `segment`, `brand` đồng bộ URL (`useSearchParams`, `replace:true`) → quay lại từ PDP giữ nguyên; khôi phục vị trí cuộn bằng `sessionStorage` theo key URL.
- Hiển thị số kết quả; `search_performed` + `search_result_clicked`.

### 5b.3 API bổ sung
`GET /products`: thêm `minPrice`, `maxPrice`, `inStock` (bool) vào `ProductQueryDto` + where; `best_seller` trong `orderBy`; tìm không dấu. Giữ tương thích ngược (tham số mới đều tuỳ chọn); web shop vẫn gọi được như cũ.

### 5b.4 Đã xem gần đây
Lưu 20 sản phẩm (`slug, name, thumbnail, price`) trong `localStorage` (`tubu_recently_viewed`), ghi ở PDP mở thành công, hiện ở Home và trang tìm rỗng. Không đồng bộ server ở dự án này.

## 6. Đợt 4c — PDP & hết hàng

- **Phân loại lên đầu:** khối chọn phân loại đặt ngay dưới tên/giá (trong màn hình đầu ở 375×667), dạng `Chip` co giãn; ảnh gallery giữ nhưng thấp hơn.
- **Thông tin sản phẩm:** khối "Thông tin" hiển thị các cặp từ `variation.attributes` (dung tích, khối lượng…) + `Brand.origin` khi có; ẩn khi rỗng.
- **Ngày giao dự kiến:** dòng "Giao dự kiến {min}–{max} ngày" từ config public (`usePublicConfig`).
- **Đổi trả:** "Đổi trả trong N ngày" đọc `returns.window_days` (thay chữ cứng "7 ngày"; đồng bộ chi tiết đơn).
- **Hết hàng:**
  - Bảng mới `StockAlert (id, userId, variationId, createdAt, notifiedAt?)` unique `(userId, variationId)` (migration Prisma).
  - `POST /me/stock-alerts {variationId}` (idempotent), `DELETE /me/stock-alerts/:variationId`; CTA "Báo khi có hàng" thay nút xám; đã đăng ký → "Đã đăng ký — huỷ".
  - Khi stock variation chuyển 0 → >0 (điểm ghi tồn kho hiện có: đồng bộ Pancake và điều chỉnh tay) → tạo thông báo in-app `BACK_IN_STOCK` (payload có `product_slug`, `variation_id`) và đánh dấu `notifiedAt`. Idempotent: mỗi cặp chỉ thông báo một lần cho mỗi lần "có lại hàng".
  - Rail "Sản phẩm tương tự còn hàng" (cùng thương hiệu hoặc phân khúc, `inStock`, tối đa 6) hiển thị ngay dưới CTA hết hàng.
- **Gọn CTA (A2-37):** giữ đúng 2 CTA đáy (Thêm vào giỏ / Mua ngay). "Đặt định kỳ", "Mở nhóm mua chung", "Nội dung bán hàng" (CTV), chip mã gom vào một khối "Ưu đãi & tuỳ chọn" (accordion), không cạnh tranh với CTA chính.
- Số review/điểm: sửa tính `count/average/distribution` trên toàn bộ review bằng aggregate (A2-36) nếu chi phí nhỏ; nếu cần đổi contract lớn thì bỏ khỏi đợt này.
- Migrate phần PDP còn lại sang `Text`/`Heading` DS v2 (khoản nợ I3 của dự án 3).

## 7. Đợt 4d — Giỏ & checkout (đụng luồng tiền, review đặc biệt)

- **Giỏ:**
  - `getCart` trả thêm `available:boolean` + `unavailableReason` cho từng dòng (variation/sản phẩm bị ẩn, hết hàng, không duyệt).
  - Dòng không khả dụng tự bỏ chọn, checkbox khoá, nút "Chuyển vào yêu thích" + "Xoá"; dòng vượt tồn kho được kẹp số lượng có thể mua + cảnh báo.
  - Nút "Thanh toán" bật khi có ≥1 dòng khả dụng được chọn.
- **Quote (`CheckoutService.compute`/`quote`):** kiểm tồn kho và trả `unavailableLines` (không throw), để checkout chặn từ sớm; `placeOrder` giữ nguyên kiểm tra + `reserveVariationStock` như hiện nay (nguồn sự thật cuối cùng).
- **Idempotency:** `checkout.tsx:219` chỉ sinh key mới khi server trả **4xx xác định** (lỗi nghiệp vụ, lỗi validate). Timeout/mất mạng/5xx: giữ nguyên key, lần bấm sau là retry an toàn (server replay theo key). Sinh key mới khi thành công (`onSuccess`) như hiện nay.
- **Địa chỉ:** `AddressSection` tự mở form khi khách chưa có địa chỉ; tên + SĐT điền sẵn từ tài khoản (đã có trong `AddressForm`).
- **Gợi ý freeship:** khi thiếu ≤ 60.000đ so với ngưỡng, hiện tối đa 3 sản phẩm còn hàng có giá ≤ phần thiếu × 1.5 (chọn theo bán chạy), thêm giỏ 1 chạm (`addSource:'cart_suggestion'` — thêm vào `AddItemDto`).
- **Mã tốt nhất:** tự áp mã có lợi nhất trong các mã khả dụng nếu khách chưa chọn; hiện "Có n mã khả dụng"; khách bỏ mã thì không tự áp lại.
- **Điểm/xu:** dòng giải thích ngắn "1 điểm = 1.000đ, tối đa 20% đơn"; giải thích vì sao đơn trả bằng xu không tích điểm.
- **Ngưỡng freeship theo hạng:** thanh freeship dùng ngưỡng theo hạng của khách (đọc từ cùng nguồn với `pricing.service.ts`); hạng luôn freeship không hiện "mua thêm".
- **Kiểm chứng đặc biệt:** test với Postgres thật (race đặt hàng đôi, retry sau timeout giữ key, dòng hết hàng giữa quote và place), theo mẫu 16 race test của dự án 0.

## 8. Kiến trúc, đơn vị và giao diện

Mỗi đơn vị một mục đích, kiểm thử độc lập:
- `nav-config.ts` — dữ liệu tab/roots; `bottom-nav.tsx`, `back-button.tsx` chỉ đọc.
- `useCartCount()`, `useReorder()`, `useRecentlyViewed()`, `useSearchState()` — hook tách khỏi trang.
- `ReorderSheet`, `CartButton`, `FilterSheet`, `SuggestList`, `PurchasedRail`, `StockAlertButton`, `ShippingEta` — component trong `components/` (dùng primitive `ui/*` của DS v2, không tạo primitive mới trừ khi thiếu thật sự; nếu thiếu, thêm vào `ui/` kèm test).
- API: `PurchasedItemsService` (trong module orders hoặc users), `StockAlertsService` (module catalog), mở rộng `CatalogService`/`OrdersService`/`CartService`/`CheckoutService`.
- Tất cả trang mới/migrate tuân thủ ESLint `tubu-ds` (không màu thô, IconButton có `aria-label`), hit area ≥44px, chạy `pnpm lint:vars` sạch.

## 9. Xử lý lỗi & trạng thái

- Mọi kệ mới có Skeleton (loading), ẩn im lặng khi rỗng (kệ Mua lại/Đã xem), ErrorState có "Thử lại" ở Browse.
- `ReorderSheet`: lỗi mạng giữ nguyên lựa chọn, báo rõ dòng nào không thêm được và vì sao.
- Deploy: thêm cột/bảng mới là additive (`StockAlert`; migration `unaccent` nếu chọn); tham số mới của `/products` tuỳ chọn; API `repurchase` v2 tương thích ngược → **deploy API trước, miniapp sau**. Nếu miniapp mới chạy với API cũ: `purchased-items` 404 → ẩn kệ Mua lại (không lỗi), `available` thiếu → coi là khả dụng.

## 10. Kiểm thử & xác minh

- Unit: vitest (miniapp) cho hook/component; jest (api) cho service mới, gồm `repurchase` v2 từng lý do bỏ qua, `purchased-items` (loại đơn chưa giao, chỉ dữ liệu của chính user), `best_seller`, bộ lọc, `StockAlert` idempotent, thông báo `BACK_IN_STOCK` đúng một lần.
- API với Postgres thật: `repurchase` một dòng lỗi không ảnh hưởng dòng khác; checkout retry giữ key (4d).
- E2E Playwright miniapp (mock): mỗi đợt thêm spec mới trong `apps/e2e/tests/`: Home→Mua lại 2 chạm; tab Đơn hàng + badge; Browse (gợi ý, lọc, giữ trạng thái khi quay lại); PDP hết hàng → Báo khi có hàng; giỏ dòng hết hàng bị khoá; checkout retry sau timeout. Kiểm tra bố cục ở 320/375/390px (bài học sticky bar của dự án 3).
- Trực quan: screenshot 375px các trang chính mỗi đợt; chạy full suite `--workers=1` trước khi kết thúc đợt.
- Review: reviewer riêng cho từng task; review đặc biệt (Opus, tập trung logic tiền/tồn kho) cho 4d; review toàn bộ dự án ở cuối như dự án 3.

## 11. Rủi ro & khoản nợ đã biết

- Đổi tab bar ảnh hưởng thói quen: mục Ví chuyển vào Cá nhân — chấp nhận (chủ shop đã chọn).
- `unaccent` phụ thuộc quyền DB prod (xem §2); có phương án fallback.
- `BACK_IN_STOCK` phụ thuộc điểm cập nhật tồn kho: cần liệt kê đủ chỗ ghi `stock` (đồng bộ Pancake, điều chỉnh tay, trả hàng) ở plan 4c; chỗ nào bỏ sót sẽ không gửi được thông báo (không gây lỗi nghiệp vụ).
- Khối alias legacy trong `css/tokens.css` vẫn còn tới khi ~35 trang còn lại được migrate; các file của dự án 4 không được dùng biến cũ.
- Các mục nợ của dự án 3 (`followups.md`) được xử lý khi chạm đúng file (Button label diacritics, thứ tự `aria-*`, allowlist lint `--zaui-*`, e2e sticky bar 320px) — liệt kê thành task nhỏ trong plan 4a.
