# Bàn giao đợt 3 (P6 home, P7 browse, P8 pdp-cart, P9 shop-page)

Gộp vào nhánh tích hợp (base gói 2e52b9be9): P7 19b67ffa3 → 272658ce1, P8 465c72de5 → 56c8e5100, P9 2cb4b2683 → 6cb6d06d3, P6 a54a8cf5f → 05c159fab. Cả bốn APPROVE: P7 lượt 2, P8 lượt 3, P6 và P9 lượt 4.

Xung đột khi gộp, đã gỡ:
- `apps/web/src/lib/use-media-query.ts` (P8 và P9 cùng thêm): giữ `mediaList` có try/catch của P8 + `subscribe` bọc `useCallback` của P9. Một hook duy nhất, đừng thêm bản thứ hai.
- `ProductRail` hai app: có cả `ranks` (P6, hạng thật của Bán chạy nhất, thắng `rankFrom`) và `noteOf` (P8, dòng ghi chú dưới thẻ, giữ chỗ khi một thẻ trong kệ có ghi chú).
- `apps/e2e/tests/support/discovery-mocks.ts`: giữ ca API cũ trả 400 cho `sort=best_seller_30d` (P7, hub lùi về `best_seller`).
- `shop.web.spec.ts` kệ Mua lại: thẻ đầu cách đầu kệ 48px (SectionHeader 44 + đệm 4 của P6), lề trái 12, rộng 148.

## Ràng buộc deploy (quan trọng)

**Không deploy `main` khi P6 đã vào mà P12 (trang Giờ vàng `/flash-sale`) chưa vào.** P6 đặt `/flash-sale` là `usable: false` trong `packages/app-core/src/merch/route-fallback.ts` vì trang chưa có. Hệ quả tới khi P12 vào:
- ô lối tắt Giờ vàng (§4 Q7: ô cố định đầu tiên) vắng, bốn ô cố định thành Mã giảm giá, Đổi rác, Mua chung, Đổi quà;
- khối Giờ vàng không có "Xem tất cả";
- `UpcomingFlashSales` (nơi duy nhất đặt "Nhắc tôi") đã rời Trang chủ theo thiết kế, nên khách không đặt nhắc được ở đâu.

Tôi chấp nhận lệch Q7 tạm thời này (chủ giao tự chốt thiết kế) vì P12 chạy ngay đợt 4. P12 xoá cờ `pending` của `/flash-sale` ở `ENTRIES` và `PENDING_TARGET`; các spec đang khoá trạng thái chờ sẽ đỏ đúng chỗ phải đổi: `home-layout.spec`, `shortcut-grid.spec` (hai app), `route-fallback.spec`, `home-shelves.spec`, `flash-sale.spec` (hai app), nhánh mặc định của các mock `routeUsable`.

## Đã có, gói sau dùng lại

- **Trang chủ (P6):** thứ tự khối theo §5 cho khách cũ/mới/chưa biết (`home-layout.ts`), Giờ vàng trước Mua lại (Q6), Countdown một lần ở đầu khối Giờ vàng. `useHomeShelves` (hai app) trả thêm `bestSellerRanks` (cùng chỉ số với `bestSellers`) và `onFlashEnd`; `FlashSale` có prop `onExpire`. Màn nào dùng hai thứ này phải nối cả hai. Suất Giờ vàng quá `endAt` bị lọc theo `serverNow()` trước chống trùng; web chỉ lọc sau hydrate để khớp HTML ISR. API: `GET /products` và `/for-you` nhận `?seed=YYYYMMDD` (ngày VN, `vnDateSeed`), `/home/me` tự truyền seed nên Gợi ý hôm nay ổn định trong ngày. Web lg dùng `HubLayout` (lưới 12 cột). Entry Mini sau P6: 622 KB (khối dưới màn đầu nạp lười).
- **Danh mục (P7):** `/browse` (web `/san-pham`) gốc là hub không gọi `fetchCatalog`; hub vẫn đẹp khi cây danh mục rỗng/phẳng (PROD hiện chưa có cây). app-core `browse/hub.ts` (`HUB_TILE_HEIGHT=102`, `hubPlaceholderTiles`) và `browse/scroll.ts` (`scrollDeltaToListTop`, chỉ cuộn lên) dùng chung hai app. `activeFilterChips` nhận `titleScope` thay `omitScope`: chỉ phạm vi đang làm tiêu đề mới bỏ chip. Web lg `ListingLayout` (h1 + breadcrumb, cột lọc 200px, phân trang số).
- **PDP + giỏ (P8):** `FlashPriceBar` (Countdown dạng chữ), chip phân loại lấy giá qua `variationPricing`, `ListRow` '›', sheet mã giảm `VoucherTicket variant=row`, chỗ trống cho Combo/Mua kèm của P15 (không render khi rỗng). Giỏ: giá gạch + "Tiết kiệm" khi `listUnitPrice > unitPrice`, chân dính (mã, miễn phí giao, tổng + tiết kiệm + nút). Mini: `VoucherSheet` ở cấp trang, không nằm trong `StickyActionBar`. Web giỏ điện thoại: ô −/+ 36px + `.tubu-hit-44-square` (vùng chạm 44). Web lg `PdpLayout`.
- **Gian hàng + thương hiệu (P9):** `ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection` (CAROUSEL/GRID/STACK/COMBO, "Thêm cả combo" gọi `addCartItemsBatch`, tất cả hoặc không), tối đa 6 khối/trang, ẩn bậc CTV thấp nhất. `ComboCard` hai app: `tone="deal"` khi tiết kiệm > 0; tạm hết thì bỏ giá gạch + nhãn "Combo -n%", tên nút "Combo tạm hết: {title}". Web lg `StoreLayout`. **P10 dùng `ShopSection` làm xem trước:** bản Mini bù lề cố định 16px, nên giữ khung xem trước có lề 16px hoặc thêm prop `bleed?: boolean` (mặc định true); `ShopHeader` web chỉ truyền `inStoreGrid` khi nằm trong header của `StoreLayout`.

## Việc còn mở

- **Lề âm web `max-md:-mx-4`/`-mx-2`** (RailShell, `category-row`, `shortcut-grid`, `STICKY_SEARCH`, hàng chip `suggest-feed.tsx`): tôi chốt giữ hình như hiện tại (thẻ đầu x=12 như Mini) nhưng gom về một lớp full-bleed dùng chung trong design system thay cho lề âm từng file; làm ở gói sửa F3.
- **"Xem tất cả" của Bán chạy nhất** tới `/browse?sort=best_seller` (tổng lượt bán) trong khi kệ xếp `best_seller_30d` (Q18): hạng đầu kệ và trang đích có thể khác. Giao P13.
- **CLS web PDP sản phẩm Giờ vàng** (`apps/web/src/app/san-pham/[slug]/pdp-extras.tsx`): SSR chưa có dữ liệu Giờ vàng nên `PdpFlashBar` (~120px) chèn vào sau khi client tải. Cách sửa thật là tải Giờ vàng ở server làm `initialData` (thêm một lời gọi API mỗi lượt SSR, dữ liệu theo giờ vào HTML có thể bị cache): đo CLS thật trước, gói P12 quyết.
- Mini `/cart` có hai nút tên "Quay lại" (một trong `#main-content`, một toàn cục z 200): e2e phải thăm dò bằng `elementFromPoint`. Chưa xem là lỗi a11y hay có sẵn; P17 rà.
- `LearnStorefrontLink` (web `/s/[slug]`): chủ gian hàng thấy dòng "Muốn có gian hàng như này?" thoáng qua rồi mới ẩn (server và hydrate coi là khách). Chấp nhận.
- Danh mục "Tẩy rửa sinh học" khác icon giữa Mini và web trong ảnh P6: có vẻ do slug khác nhau giữa mock Mini và stub, chưa kiểm sâu. P17 kiểm chéo.

## Bẫy môi trường

- Ảnh 375px các gói ở `screens/P6..P9/` (gitignore). Ảnh giỏ Mini của P8 (`mini-cart.png`) chụp trước hai commit sửa cuối, đã cũ.
- Bundle Mini: tổng ~2045 KB sát cảnh báo 2048 KB (P7 đo trước khi gộp P6). Gói sau thêm vào Mini đo lại bằng `node scripts/ci/bundle-budget.cjs apps/miniapp/www`.
- Web e2e chạy cục bộ không cần DB: API giả trả `/api/health` 200 và `/api/products` dạng `{data,meta}`, bật sẵn `next dev` trên cổng được giao (Playwright `reuseExistingServer`), chạy `E2E_SCOPE=web E2E_API_PORT=<cổng> E2E_WEB_PORT=<cổng> --project='Web Customer Mobile'`. `cart-lines.web.spec.ts` mock hết phía trình duyệt.
- Máy không có lệnh `timeout`.
