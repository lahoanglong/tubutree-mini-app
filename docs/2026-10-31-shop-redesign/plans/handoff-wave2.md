# Bàn giao đợt 2 (P4 product-tile, P5 section-kit)

Gộp vào nhánh tích hợp: P4 35a749465 → 8debdd27f, P5 1fef7925a → 6e011e818 (không xung đột). Cả hai APPROVE sau 1–2 lượt sửa.

## Đã có, gói sau dùng lại (không tự chế)

- **Thẻ sản phẩm (P4), hai app:** `PriceTag`, `ProductImage`, `WishlistHeart`, `ProductTile`, `ProductCard`, `ProductGrid`, `ProductRail`, `ProductTileSkeleton` là nguồn duy nhất vẽ thẻ. `ds-shop-guard.spec` ở mỗi app chặn thẻ tự chế và giá gạch (`line-through`) ngoài `price-tag.tsx`. `CatalogTile`, `RelatedTile`, `apps/web/src/components/mini/product-tile.tsx` cũ đã xoá.
- Số đo thân thẻ: `TILE_METRICS` + `tileBodyHeight(variant, { brand })` trong app-core; khung chờ dựng từ cùng số đo. Đổi số đo thì sửa cùng chỗ (spec khối giá dùng `TILE_METRICS.price + TILE_METRICS.compare`).
- Thẻ xếp chồng (rail-sm, rail-md, flash, rank): khối giá luôn giữ 36px (giá + dòng gạch) để giá chính thẳng hàng trong kệ.
- Nhãn trên ảnh: `CardBadge.short` ("-x%"); khung ảnh `tubu-tile-media` có container query ngưỡng 164px (Chrome ≥105, Safari ≥16).
- Trang thương hiệu: `ProductCard showBrand={false}` ở cả hai app.
- Web `RailShell`: tràn mép bằng class `-mx-4 max-w-none md:-mx-3` (điện thoại thẻ đầu x=12 như Mini, md+ thẳng tiêu đề). Kệ trang chủ web và PDP dùng chung.
- **Section kit (P5), hai app:** `SectionHeader`, `Section`, `Countdown`, `FlashSoldBar`, `SortBar`, `VoucherTicket`, `ComboCard`, `BannerCarousel` (Mini `components/ui`, web `components/mini`, xuất qua `mini/index.ts`). Chưa gắn vào màn nào, kể cả 3 nút "Xem tất cả" chép tay: gói màn làm.
  - `SectionHeader` có bảng `IconName` 6 icon (zap, flame, tag, sparkles, ticket, gift) để không phình entry; icon khác truyền thẳng `LucideIcon`.
  - `VoucherTicket` thêm prop `reason`, `expiring`. `ComboCardItem` có `thumbnail?`. `ComboCard` tự xử lý món hết hàng ("Combo tạm hết"), không cần prop `soldOut` ngoài.
  - `SortBar` dính dùng token `--sort-bar-top` (khai ở design-tokens), mờ mép khi tràn, tự cuộn tab đang chọn vào khung.
  - Web `Countdown` chỉ đọc giờ sau khi mount (lượt đầu trống, tránh lệch hydrate).
- **/ds-gallery:** Mini là route lazy chỉ khi `import.meta.env.DEV` (đường dẫn `/ds-gallery`, không phải `/#/ds-gallery`); web `notFound()` ở production + robots noindex; route-map lane `ds`. Chưa có thẻ sản phẩm trong gallery.

## Sửa trên nhánh tích hợp sau đợt 1 (gói sau phải biết)

- `NotifyRegion` (Mini) dùng `aria-live` polite/assertive + `data-testid="notify-status|notify-alert"`, KHÔNG mang `role="alert"/"status"` (vùng thường trực rỗng làm `getByRole('alert')` bắt nhầm).
- `Badge` hai app: `lineHeight: var(--type-label-lh)`. Không để nhãn 12px thừa kế line-height khối cha (làm khung chờ đo sẵn lệch).
- Chip md nhìn 36px, vùng chạm 44px: e2e đo bằng `apps/e2e/tests/support/hit-area.ts` (`expectChipHitArea44(chip, { control })`), không đòi chiều cao thật 44.
- Vitest Mini: `asyncUtilTimeout` 3s (`apps/miniapp/src/vitest-setup.ts`).
- gate.sh KHÔNG chạy Playwright. Gói giao diện chạy thêm cả bộ e2e Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=<cổng> npx playwright test --workers=2`.

## Việc còn mở, giao cho gói sau

- **P9 (ComboCard ở gian hàng):** khi `saving > 0` truyền `tone="deal"` cho `PriceTag` (hai app, `combo-card.tsx`); trạng thái tạm hết: bỏ giá gạch `compareAt` và nhãn "Combo -n%" (khoản tiết kiệm không mua được), tên nút đọc kèm tên combo ("Combo tạm hết: {title}") để hai combo hết hàng trên một trang không trùng tên; chụp lại 375px trạng thái tạm hết ở hai app.
- **Thẻ sản phẩm vào /ds-gallery:** việc riêng sau đợt 3 hoặc P17.
- `TOUR['/offers']` chưa có trong `apps/e2e/tests/support/tour.ts` (có từ base): visual-tour đỏ ở bước thu thập khi đặt `VISUAL_DIR`. P11/P14 (đụng /offers) thêm.
- `apps/e2e/scripts/visual-pairs.mjs` còn lặp lane `ds` (cặp rỗng); P17 lọc như `tour.ts` (`DEV_ONLY_LANES`).
- Lề âm tay `margin: '0 -16px'` còn ở `category-row`, `shortcut-grid` trang chủ web: P6 thay bằng khuôn chung.

## Bẫy môi trường

- Entry Mini sau đợt 2: 682 KB (trần mềm 690, cứng 700). `SHOP_COPY` chưa vào entry; import `fillCopy`/bảng chữ vào đường nạp đầu sẽ thêm vài KB: chỉ import chữ cần, ghi số trước/sau.
- Web bật `font-feature-settings` cv02–04 toàn trang, Mini không: số không tabular rộng khác nhau giữa hai app (dùng `tabular-nums` cho giá/đếm).
- Web dev: `apps/web/.next/cache/fetch-cache` giữ phản hồi API giả cũ; đổi dữ liệu mock thì xoá thư mục đó và khởi động lại `next dev` (cache cả trong bộ nhớ).
- Trang server web (`brand/[slug]`, `s/[slug]`) không truyền được prop hàm xuống client `ProductGrid`.
- Chạy web e2e cục bộ không có API thật: API giả phải trả `/api/health` 200 và `/api/products` dạng `{data:[],meta:{page,limit,total}}`, không thì trang chủ SSR 500 và Playwright chờ webServer hết hạn.
- Cổng: mỗi gói chỉ dùng cổng được giao; 3290/3291/3295 tôi đã dùng để chạy kiểm.
