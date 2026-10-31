# Review design system: thẻ sản phẩm, nhãn, giá, tiêu đề khối và cơ chế giữ khớp

Vai: kiến trúc sư design system. Đọc mã main `13536d955` trong worktree `shop-redesign`, không sửa mã. Lúc viết, `screens/` chưa có ảnh nên mọi bằng chứng là `file:dòng`. Skill đã nạp và làm theo: `design:design-system` (audit + extend), `ecc:design-system` (audit 10 chiều), `ui-ux-pro-max:design-system` (token 3 lớp, spec thành phần).

Số đếm lấy bằng grep và một script quét tạm (không commit) trên 90 file phạm vi Mini (`pages/{home,browse,product-detail,storefront-view,storefront-builder,brand-view,offers}.tsx`, `components/{home,catalog,ui,reorder}/`, `flash-sale.tsx`, `product-card.tsx`, `storefront-*.tsx`, `store-page-shell.tsx`, `loyalty/coupon-card.tsx`) và các file web tương ứng (`components/{product-card,flash-price,new-product-badge}.tsx`, `components/{home,catalog,reorder}/`, `app/{page.tsx,san-pham,s,brand,uu-dai,ctv/gian-hang}`).

---

## 0. Kết luận

- **Điểm hệ thống cho phạm vi mua sắm: 54/100.** Màu ổn: Mini có 0 hex/rgb vì `ds-no-legacy-aliases.spec.ts` chặn, và contrast có bài kiểm. Phần yếu là tầng thành phần mua sắm: có 6 kiểu thẻ sản phẩm với 5 bề rộng kệ ngang, 6 kiểu tiêu đề khối dùng 2 họ chữ, 10 kiểu nhãn và 3 kiểu phiếu giảm giá. 13 token khoảng cách đang được dùng 0 lần, trong khi có 490 số px viết tay.
- Không có P0. Có 12 P1 và 7 P2 (mục A4).
- Ba việc phải xong trước khi dựng 4 tính năng mới (Flash sale, Top bán chạy, Banner + kho voucher, Combo):
  1. Một đường ống cho thẻ sản phẩm: `app-core` quyết định giá, nhãn và điều hướng, còn `ProductTile` chỉ vẽ. Dùng chung ở cả hai app.
  2. `SectionHeader`, `Section`, `ProductGrid` và `ProductRail`.
  3. Thêm lớp token 3 (commerce).

  Nếu chưa có ba việc này, mỗi tính năng mới sẽ tự dựng thêm một thẻ, một tiêu đề và một nhãn riêng, đúng như cách các khối Giờ vàng và Đã xem gần đây đã làm.
- Cơ chế giữ khớp gồm 6 phần:
  - `packages/design-tokens/DESIGN.md`.
  - `packages/app-core/src/ds-map.json`, tương tự `route-map.json` nhưng cho thành phần.
  - Trang mẫu `/ds-gallery` ở cả hai app.
  - Bộ bài kiểm: rào tĩnh kiểu bánh cóc, kiểm logic nhãn, so số đo 375px giữa Mini và web, kiểm token.
  - Skill dự án `tubu-ui`. Lưu ý: hiện `.gitignore` bỏ qua cả thư mục `.claude/`, nên skill này sẽ không được commit (xem C3).
  - Checklist PR.

### Điểm theo 10 chiều (ecc audit, chỉ phạm vi mua sắm)

| Chiều | Điểm | Lý do chính |
|---|---:|---|
| Màu | 8 | 0 hex trong Mini. Còn 24 chỗ trỏ thẳng bậc primitive (`var(--stone-100)`…). Web dùng 321 lớp primitive |
| Thứ bậc chữ | 5 | Tiêu đề khối lúc Fraunces lúc Inter. PDP còn 25 `Text size=` của ZaUI. Nhãn 11px |
| Nhịp khoảng cách | 3 | 0/13 token `--space-*` được dùng. 12 cách đệm khối khác nhau ngay trên Trang chủ |
| Nhất quán thành phần | 4 | 6 kiểu thẻ, 3 lớp bọc chép logic, 2 Badge ở web |
| Mini ↔ web 375px | 5 | Có `components/mini`, nhưng thẻ thật của web là bản Tailwind riêng. Có 5 lớp "giả Mini" song song |
| Trạng thái (chờ, rỗng, hết hàng) | 7 | Có khung chờ, hết hàng, lỗi theo khối. Nhưng có 2 khung chờ cho cùng một thẻ |
| Truy cập | 7 | Rào vùng chạm 44px và contrast có test. Nhãn 11px trái quy tắc ≥12px của chính dự án |
| Chuyển động | 7 | Có token motion và giảm chuyển động. Chưa có Countdown hay Banner |
| Độ dày thông tin | Không chấm | Agent `ia-merch` phụ trách |
| AI-slop | 9 | Không lạm dụng gradient hay glass. Gradient duy nhất là thẻ Điểm Xanh (`offers.tsx:117`), có lý do |

---

## A. Kiểm kê

### A1. Số đếm

| Hạng mục | Mini App | Web | Ghi chú |
|---|---|---|---|
| **Kiểu thẻ sản phẩm** | **6**: ProductTile lưới hoặc kệ · thẻ Giờ vàng đang bán (`flash-sale.tsx:146-195`) · thẻ Sắp diễn ra (`flash-sale.tsx:211-263`) · thẻ Đã xem gần đây (`recently-viewed-rail.tsx:51-99`) · thẻ Mua lại gọn (`purchased-rail.tsx:184`) · dòng gợi ý tìm kiếm (`suggest-list.tsx`, ProductThumb) | **7**: `components/product-card.tsx` (Tailwind, chạy thật) · `components/mini/product-tile.tsx` và `mini/product-card.tsx` (không trang nào import, chỉ spec) · Giờ vàng ×2 · Đã xem gần đây · RebuyTile · CompactRebuyCard | Mini có thêm **3 lớp bọc** chép cùng logic giá, nhãn và điều hướng: `product-card.tsx`, `CatalogTile` (`catalog-grid.tsx:23`), `RelatedTile` (`product-detail.tsx:1175`) |
| Bề rộng thẻ kệ ngang | **5**: 120 (`recently-viewed-rail.tsx:13`), 132 (`flash-sale.tsx:37`), 148 (`purchased-rail.tsx:28`), 150 (`product-detail.tsx:952,973`), 156 (`best-seller-rail.tsx:14`) | **4**: 128 (`w-32`), 144 (`w-36`), 148, 156 | Mỗi khối tự đặt một số riêng |
| Khoảng cách lưới 2 cột | **3**: 12 (`catalog-grid.tsx:14`), 10 (`storefront-view.tsx:145`, `brand-view.tsx:257`), 8 (`storefront-preview.tsx:34`) | 1 nguồn `lib/product-grid.ts:5` (gap 12) và `storefront-preview` gap 8 | Web đã có một hằng cho lưới, Mini thì chưa |
| **Kiểu tiêu đề khối** | **6**, dùng 2 họ chữ: `Heading title-sm` (Fraunces 16, 25 chỗ) · Heading + "Xem tất cả" chép tay ×3 (`best-seller-rail.tsx:33-47`, `purchased-rail.tsx:108-121` margin âm, `community-preview.tsx:66-79` không margin âm) · Heading màu promo + icon (`flash-sale.tsx:121`) · icon + Heading trong `div` (`brand-view.tsx:201-204`) · `SectionTitle` (Inter 16, 7 chỗ, PDP) · `Heading title-lg as h2` (`browse.tsx:226`) | **7 hằng hoặc kiểu**: `ui.sectionTitle` 18 serif (`lib/guest-ui.ts:14`) · `phoneSectionTitle` 16 (`lib/phone-ui.ts:14`) · `mini.sectionTitle` Inter 16 (`order-mobile/mobile-ui.tsx:13`) · `mini-skin` title-md 18 (`pro-shared/mini-skin.ts:19`) · `miniSectionTitle` (`loyalty/mini-surface.tsx:14`) · `Heading` của `components/mini` · `TITLE` Giờ vàng 18 (`home/flash-sale.tsx:31`) | `section-title.tsx:9-11` ghi rằng dùng `Heading` cho tiêu đề mục làm trang "lúc serif lúc sans". Lỗi đó vẫn còn |
| **Kiểu nhãn (badge)** | **10**: Badge 7 tông × 2 cỡ · `-X%` promo nhạt · "Giờ vàng -X%" có icon Zap, nền cam đặc ghi đè bằng `style` (`product-card.tsx:12`, `catalog-grid.tsx:13`) · `-X%` cam đặc không chữ "Giờ vàng" (`product-detail.tsx:1189-1195`, `flash-sale.tsx:44`) · "Mới" · "Đã mua N lần" · huy hiệu "đã duyệt" ghi đè Badge success thành nền xanh đặc ×2 (`storefront-view.tsx:96`, `brand-view.tsx:129`) · đồng hồ (Badge promo + Clock) · chứng nhận ×2 kiểu (`product-detail.tsx:595-618` tự vẽ, `brand-view.tsx:185-191` Badge) · viên "hết hàng" trên ảnh | **6**: `ui/badge.tsx` (Tailwind, 12px) · `mini/badge.tsx` (inline, 11px), cả hai cùng nằm trong `home/flash-sale.tsx:21-22` · `CardSaleBadge` (lớp do nơi gọi truyền vào) · `NewProductBadge` (span tự vẽ, `new-product-badge.tsx:18`) · `PdpPrice` badge, giảm thường dùng **đỏ danger** (`flash-price.tsx:88`) · span xanh đặc ở `/s/` (`app/s/[slug]/page.tsx:157`) | `FlashBadge` và `CountdownChip` ở `ui/tiles.tsx:17-23` không ai dùng. `CountdownChip` còn vẽ ra span rỗng |
| **Kiểu giá** | **4**: PriceTag inline · PriceTag flash kèm dòng gạch giá vẽ riêng bằng `Text` (`flash-sale.tsx:172-177`) · PriceTag xl kèm badge rời (PDP `:498-516`) · giá trong chuỗi mã giảm (`couponLabel`) | **5**: `ProductPriceRow` · `PdpPrice` · `<p>` ở Giờ vàng (`home/flash-sale.tsx:141,171`) · `mini/PriceTag` ở Mua lại · `Money` | Web điện thoại để giá nặng 700, Mini 600 |
| Kiểu phiếu giảm giá | **3**: `CouponCard` (nền promo, viền `--clay-100`) · chip mã ở PDP (`--clay-50/500/700`, ZaUI Text, `product-detail.tsx:620-668`) · mã khuyến mãi ở trang nhãn (viền promo-fg, `brand-view.tsx:213-243`) | chưa đếm hết | Cần gom lại trước khi làm "kho voucher" |
| Khung chờ thẻ sản phẩm | **2**: `ProductCardSkeleton` (`ui/skeleton.tsx:23`, khối 11/13/13/15px) · `CatalogGridSkeleton` (`catalog-grid.tsx:86`, dựng từ hằng của thẻ thật) | 1 (`ui/skeleton`) | Bản ở `ui/skeleton.tsx` lệch kích thước thẻ thật |

### A2. Độ phủ token (90 file phạm vi Mini)

| Nhóm | Token đã định nghĩa | Đang dùng | Giá trị lọt ngoài token |
|---|---|---|---|
| Màu | ~70 semantic | phần lớn | 0 hex/rgb. **24** chỗ trỏ thẳng primitive: `--stone-100` nền ảnh (`product-tile.tsx:114`, `flash-sale.tsx:154,215`, `recently-viewed-rail.tsx:80`), chip (`chip.tsx:52`) · `--stone-200` rãnh tiến độ (`progress-bar.tsx:24`) · `--forest-700` bìa gian hàng (`store-page-shell.tsx:27`, `storefront-preview.tsx:18`) · `--clay-*` mã giảm giá (`product-detail.tsx:526,648-657`, `coupon-card.tsx:29`) · `--sage-100/--forest-100` trình dựng (`storefront-builder.tsx:361`) |
| Khoảng cách | 13 (`--space-inline/stack/inset/gutter/section`) | **0 lần** | **490** số viết tay. `gap`: 8 (50 lần), 6 (28), 4 (19), 10 (19), 12 (18), 2 (5), 5 (2), 7 (1), 16 (1). Đệm khối Trang chủ có 12 cách khác nhau (A4 DS-05) |
| Bo góc | 5 | 80 lần | 3 số thô (`storefront-view.tsx:150` 10px, `category-grid.tsx`, …) |
| Cỡ chữ | thang `--type-*` đủ | tốt | 5 `fontSize` số, trong đó 3 chỗ dưới 12px: Badge sm **11px** (`badge.tsx:35`, có mặt trên mọi thẻ), ngôi sao 11px (`product-tile.tsx:217`), số giỏ 11px. PDP còn **25** `Text size=` của ZaUI (`product-detail.tsx:2`), toàn app 159 |
| Bóng | 4 elevation | tốt | 0 |
| Web (phạm vi) | dùng preset Tailwind | — | **321** lớp primitive (`bg-stone-0`, `text-forest-700`…) so với **34** lớp ngữ nghĩa qua `[var(--color-*)]`. 111 giá trị tuỳ ý `[…]`. `text-xs` (12px) xuất hiện 69 lần ở những chỗ Mini dùng caption 13px, còn `text-caption` chỉ 3 lần |

### A3. Lệch Mini ↔ web ở khổ 375

| Chỗ | Mini | Web | Nên theo |
|---|---|---|---|
| Thẻ lưới: dòng nhãn hiệu, dòng sao/đã bán | caption 13/600 | `text-xs` 12 (`product-card.tsx:68`) | 13 (token caption) |
| Thẻ lưới: giá | price-sm 14/600 | `text-sm font-bold` 14/700 (`:79`) | 14/600 |
| Thẻ lưới: hết hàng | phủ sáng `--color-bg-scrim-light` + "Tạm hết — sẽ về sớm" | phủ tối `stone-900/45` + "Hết hàng" (`:41-42`) | Mini (chữ để agent ux-copy chốt) |
| Nhãn giảm trên ảnh | 11px | 12px | 12px |
| Thẻ Giờ vàng | 132px, không viền, tên caption 13 | 144px, viền stone-200, tên 12px (`home/flash-sale.tsx:29`) | thành phần chung (B2 `flash`) |
| Tiêu đề Giờ vàng, Đã xem gần đây | Fraunces 16 | Fraunces 18, không có lớp `max-md:` (`home/flash-sale.tsx:31`, `recently-viewed-rail.tsx:27`) | `SectionHeader` |
| Thẻ Đã xem gần đây | 120px | 128px (`recently-viewed-rail.tsx:32`) | `--tile-w-sm` |
| PDP nhãn giảm thường | không có, chỉ có giá gạch | đỏ danger, chỉ máy tính (`flash-price.tsx:88`) | promo, một kiểu |
| Huy hiệu gian hàng "đã duyệt" | Badge ép nền forest-600 | span forest-700 (`s/[slug]/page.tsx:157`) | Badge tông `verified` |
| Biến CSS dùng chung | `apps/miniapp/src/css/tokens.css` | `components/mini/mini.css` khai lại `--safe-*`, `--dur-*`, shimmer, pulse, 11 `--color-brand-*` hex (`mini.css:19-29`) | chuyển về `packages/design-tokens` |

### A4. Phát hiện

| ID | Mức | Màn | Bằng chứng | Vấn đề | Đề xuất |
|---|---|---|---|---|---|
| DS-01 | P1 | Trang chủ, Danh mục, PDP, gian hàng, nhãn | `product-card.tsx:12,30-38`; `catalog-grid.tsx:13,32-38`; `product-detail.tsx:1175-1199` | Ba lớp bọc chép cùng luật giá, nhãn và điều hướng. `RelatedTile` đã trôi: SP đang Giờ vàng hiện "Giờ vàng -30%" có icon ở lưới nhưng chỉ "-30%" ở kệ PDP. Thêm một lớp bọc mới (Top bán chạy, Gợi ý) sẽ trôi lần thứ tư | Thêm `packages/app-core/src/commerce/product-card-view.ts` (B2) để quyết giá, nhãn và đích điều hướng. Mỗi app giữ **một** lớp bọc thông minh `ProductCard`. Xoá `CatalogTile` và `RelatedTile` (giữ `CatalogGrid` thành `ProductGrid`) |
| DS-02 | P1 | Trang chủ, PDP, Danh mục | A1 hàng "Kiểu thẻ", "Bề rộng thẻ" | 5 thẻ tự vẽ nằm ngoài ProductTile (Giờ vàng ×2, Đã xem, cả hai bản web) và 5 bề rộng kệ. Mắt thấy mỗi kệ một kiểu, nên trang trông rối | Thêm các biến thể `flash`, `rail size=sm|md`, `rank`, `line` vào ProductTile (B2). Chỉ giữ 2 bề rộng là `--tile-w-sm` 128 và `--tile-w-md` 148 |
| DS-03 | P1 | Trang chủ | `catalog-grid.tsx:27-30` (không truyền `flash` cho PriceTag); `flash-sale.tsx:172-177` | Cùng một SP, cùng một màn: ở dải Giờ vàng giá màu cam, ở lưới Gợi ý giá màu đen. Dải Giờ vàng còn vẽ giá gạch bằng `Text` riêng thay vì dùng PriceTag | Mọi thẻ truyền `flash={view.price.isFlash}`. Giá gạch chỉ đi qua PriceTag, thêm `layout="stack"` cho thẻ hẹp (B4) |
| DS-04 | P1 | mọi màn trong phạm vi | A1 hàng "Kiểu tiêu đề khối" | 6 kiểu tiêu đề trên Mini, 7 hằng trên web, 2 họ chữ. "Xem tất cả" chép tay 3 lần, lề khác nhau. Web để Giờ vàng và Đã xem gần đây 18px trên điện thoại | Thêm `SectionHeader` (B5). Luật: khối hàng và kệ dùng `SectionHeader` (Fraunces 16/600), nhóm nội dung hoặc biểu mẫu trong một màn dùng `SectionTitle` (Inter 16/600). Câu hỏi E1 cho chủ |
| DS-05 | P1 | Trang chủ, Danh mục | Đệm khối: `best-seller-rail.tsx:29` `8px 0 4px`, `category-row.tsx:21` `4px 0 8px`, `flash-sale.tsx:118` `marginTop 16`, `suggest-feed.tsx:55` `16px 16px 0`, `community-preview.tsx:65` `8px 16px`, `brand-journey.tsx:27` `8px 16px 8px`, `shortcut-grid.tsx:45` `0 0 12px`… | Khoảng trống giữa hai khối dao động 8–24px tuỳ khối đứng cạnh nhau. 0 token khoảng cách được dùng | Thêm `Section` (B5): khoảng cách giữa khối là `--space-block` 16px ở màn danh sách và `--space-section` 24px ở màn nội dung. Khối không tự đặt đệm trên/dưới. Thêm bài kiểm bánh cóc cho số px (C2 T2) |
| DS-06 | P1 | mọi thẻ SP | `badge.tsx:35`; `product-tile.tsx:217`; `tiles.tsx:17-23`; `storefront-view.tsx:96`; `brand-view.tsx:129`; web `home/flash-sale.tsx:21-22`, `new-product-badge.tsx:18`, `flash-price.tsx:88` | Nhãn sm 11px trái quy tắc "cấm cỡ dưới 12px" của DS v2 (§Thang chữ). 4 chỗ ghi đè `style` để có nền đặc. Stub `FlashBadge`/`CountdownChip` bị bỏ. Web có 2 Badge trong cùng một file. Chưa có luật thẻ được bao nhiêu nhãn, nhãn nào thắng | Badge: mọi cỡ dùng label 12/600, sm chỉ khác đệm. Thêm tông `flash` và `verified` (nền đặc), cấm ghi đè màu qua `style`. Xoá `FlashBadge`/`CountdownChip`. Luật vị trí và ưu tiên đặt ở app-core (B3). Web giữ một Badge |
| DS-07 | P1 | PDP, Ưu đãi, nhãn | `coupon-card.tsx:25-30`; `product-detail.tsx:620-668`; `brand-view.tsx:213-243` | 3 cách vẽ phiếu giảm giá với 3 bộ màu (promo, clay primitive, promo-fg). Chip ở PDP còn dùng `Text` của ZaUI | `VoucherTicket` (B9) với 3 biến thể và token `--color-voucher-*`. Phải làm trước "kho voucher" |
| DS-08 | P1 | thẻ SP, gian hàng, PDP | A2 hàng "Màu" | 24 chỗ dùng primitive, trái luật ghi ở đầu `tokens.css` ("Layer 1 … NEVER referenced outside this file"). Lý do là thiếu token ngữ nghĩa cho nền ảnh, rãnh tiến độ, bìa, chip, phiếu | Thêm token ở B1, thay 24 chỗ, rồi thêm bài kiểm cấm primitive ngoài `css/` và `components/ui` (C2 T1c) |
| DS-09 | P1 | web 375 mọi màn | A2 hàng "Web"; `lib/phone-ui.ts`, `loyalty/mini-surface.tsx`, `order-mobile/mobile-ui.tsx`, `pro-shared/mini-skin.ts`, `components/mini/` (44, 13, 31… file import) | Web có 5 lớp "cho giống Mini" song song. Preset Tailwind chỉ cung cấp bậc primitive nên trang phải viết `text-[var(--color-text-secondary)]` hoặc dùng thẳng `stone-*`. Mỗi lane tự chế lớp `max-md:` của mình | Thêm lớp ngữ nghĩa vào `tailwind-preset.ts`, ví dụ `text-fg-secondary`, `bg-surface`, `bg-canvas`, `bg-media`, `text-price`, `bg-flash-solid` (map sang `var(--color-*)`). Gom 4 lớp `max-md:` vào một file `apps/web/src/lib/mobile-skin.ts`. File SHOP đã chuyển bị cấm lớp primitive (C2 T4) |
| DS-10 | P1 | web lưới SP | `components/mini/product-tile.tsx`, `mini/product-card.tsx` (chỉ `product.spec.tsx` import); `components/product-card.tsx` | Web có 2 nguồn cho thẻ: bản Mini chép sang nhưng không dùng, và bản Tailwind đang chạy đã lệch (A3). Agent sau dễ sửa nhầm bản chết | Xoá 2 file chết. `components/product-card.tsx` là thẻ duy nhất của web (một DOM cho hai khổ, đúng với ISR). Phần `max-md:` theo spec B2 và gắn `data-ds-*` để bài so số đo (C2 T9) bắt lệch |
| DS-11 | P1 | PDP | `product-detail.tsx:2` (import `Text` từ zmp-ui), 25 `Text size=` | PDP là màn mua sắm quan trọng nhất nhưng nằm ngoài thang chữ, có `size="xSmall"` và màu ghi đè | Chuyển sang `Text variant` của DS. Thêm vào danh sách bánh cóc "cấm Text của ZaUI" (C2 T1e) |
| DS-12 | P1 | cơ chế | `packages/design-tokens/package.json` (không có script `test`) | 3 spec của gói token (36 test, đã chạy tay ở `packages/design-tokens`: xanh) **không chạy trong `turbo run test`**, nên CI không bảo vệ token | Thêm `"test": "vitest run"`. Mở rộng `tailwind-preset.spec.ts` để so mọi hex của preset với `tokens.css` (hiện chỉ so forest-600) |
| DS-13 | P2 | gian hàng, nhãn | `storefront-view.tsx:145,150`; `brand-view.tsx:257`; `storefront-preview.tsx:34` | Lưới gap 10 và 8, khác Danh mục (12). Ghi chú CTV bo góc 10 viết tay | Dùng `ProductGrid` (B6). Ghi chú CTV dùng `--radius-control` |
| DS-14 | P2 | lưới SP | `ui/skeleton.tsx:23-43` so `catalog-grid.tsx:86-107` | 2 khung chờ cho cùng một thẻ. Bản ở `ui/` lệch thẻ thật nên trang dùng nó sẽ nhảy khi tải xong | Thay bằng một `ProductTileSkeleton variant` dựng từ hằng của ProductTile. Xoá `ProductCardSkeleton` và `ProductGridSkeleton` |
| DS-15 | P2 | thẻ SP | `product-tile.tsx:41-42` | `variant` khai `list/line/compact` và `mode` nhưng không nơi nào dùng (`compact` còn không được xử lý). API hứa những thứ không có | Thay bằng bộ biến thể ở B2 |
| DS-16 | P2 | trang nhãn | `brand-view.tsx:255-263` | Mọi thẻ đều in cùng một dòng "chấm màu + tên nhãn", tốn 20px mỗi thẻ mà không thêm thông tin | Prop `hideBrand` |
| DS-17 | P2 | cơ chế | `apps/miniapp/src/css/tokens.css:13-28`, `apps/web/src/components/mini/mini.css:5-31`, `tailwind-preset.ts:31-46` | Cùng một biến được khai ở 2 đến 3 nơi bằng tay | Chuyển vào `packages/design-tokens/src/{runtime.css,brand.css}`. Preset kiểm bằng spec (DS-12) |
| DS-18 | P2 | cơ chế | `apps/web/.eslintrc.json` chỉ `next/core-web-vitals`; `package.json` có `lint:vars` nhưng `ci.yml` không chạy | Rule ESLint `tubu-ds/*` chỉ áp cho Mini. Bài kiểm biến CSS chưa định nghĩa không chạy trong CI | Phía web kiểm bằng vitest (T4), vì web dùng ESLint 8 legacy nên gắn plugin nội bộ khó. Thêm `pnpm lint:vars` vào `ci.yml` |
| DS-19 | P2 | cơ chế | `.gitignore:45` `.claude/` | Skill dự án đặt ở `.claude/skills/` sẽ không vào git, nên máy hoặc worktree khác không có | Xem C3 |

---

## B. Bộ thành phần chuẩn cho mua sắm

### B0. Nguyên tắc
1. **Logic ở app-core, hình ở app.** Giá, nhãn, thứ tự nhãn, chữ đồng hồ, chữ phiếu và tổng combo đều là hàm thuần trong `packages/app-core/src/commerce/`, có spec. Mini và web chỉ vẽ. Đây là chỗ đã giữ được `cardPricing` khớp giữa hai app, nên làm tiếp cho nhãn.
2. **Một thành phần, nhiều biến thể.** Không tạo thẻ mới khi một biến thể có thể đáp ứng.
3. **Token 3 lớp:** primitive (chỉ dùng trong `tokens.css`) → semantic → component (lớp 3 mới, B1).
4. **Mini 375 là bản gốc.** Web dưới `md` phải ra cùng số đo, đo bằng bài kiểm, không ước bằng mắt.
5. Mọi thành phần mới gắn `data-ds="<tên>" data-ds-variant="<biến thể>"`, và các phần con gắn `data-ds-part`, để test tìm được.

### B1. Token bổ sung (`packages/design-tokens/src/tokens.css`)

```css
/* Layer 2: semantic, bổ sung */
--color-bg-media: var(--stone-100);        /* nền ô ảnh SP và khung chờ ảnh */
--color-bg-cover: var(--forest-700);       /* bìa gian hàng/nhãn chưa có ảnh */
--color-bg-chip: var(--stone-100);         /* chip chưa chọn */
--color-track: var(--stone-200);           /* rãnh thanh tiến độ */
--color-verified-bg: var(--forest-600);    --color-verified-fg: var(--stone-0);
--color-voucher-bg: var(--orange-50);      --color-voucher-fg: var(--orange-800);
--color-voucher-edge: var(--tubu-orange);  /* viền đứt và răng cưa, trang trí */
--color-voucher-stub-bg: var(--tubu-orange); --color-voucher-stub-fg: var(--stone-900); /* 6,75:1 */
--color-voucher-ship-bg: var(--color-status-success-fg); --color-voucher-ship-fg: var(--stone-0); /* ~5,3:1 */
--color-rank-1-bg: var(--honey-600);  /* ~5,0:1 với chữ trắng; honey-500 chỉ ~3,7:1 nên không dùng */
--color-rank-2-bg: var(--stone-600);
--color-rank-3-bg: var(--clay-600);   /* ~5,7:1 */
--color-rank-fg: var(--stone-0);
--color-rank-n-bg: var(--stone-100);  --color-rank-n-fg: var(--stone-700);
--color-countdown-bg: var(--color-bg-inverse); --color-countdown-fg: var(--color-text-inverse);
--radius-tag: var(--p-radius-1);      /* 4px: ô đếm ngược, ruy-băng hạng */

/* Layer 3: component (commerce). Chỉ components/ui và thành phần web tương ứng dùng. */
--tile-w-sm: 128px;                   /* Giờ vàng, Đã xem, kệ Top: ở 375px thấy 2,6 thẻ */
--tile-w-md: 148px;                   /* Bán chạy, Mua lại, Thường mua kèm: thấy 2,25 thẻ */
--tile-gap: var(--p-space-4);         /* 12px, cả lưới lẫn kệ */
--tile-inset: var(--p-space-3);       /* 8px đệm thân thẻ (hiện 10, lệch thang 4pt) */
--rail-pad-block: var(--p-space-2) var(--p-space-4); /* 4px trên, 12px dưới: chừa bóng và vòng focus */
--section-header-h: 44px;
--space-block: var(--p-space-5);      /* 16px giữa hai khối ở màn danh sách */
--banner-ratio: 5 / 2;                /* 343 x 137 ở 375px */
--badge-h-sm: 20px; --badge-h-md: 24px;
```

Đổi `--tile-inset` từ 10 xuống 8 thì phải sửa `BODY_PADDING` ở `catalog-grid.tsx:76` và đo lại `TILE_BODY_HEIGHT` (e2e `buy-flow-4b` kiểm lệch ≤16px). Các cặp màu mới phải vào `css/contrast.spec.ts` (C2 T8). Phía web, `tailwind-preset.ts` cung cấp các token trên thành lớp ngữ nghĩa (DS-09).

### B2. `ProductTile` (vẽ) + `ProductCard` (thông minh) + `productCardView` (app-core)

**Logic (một nơi):**

```ts
// packages/app-core/src/commerce/product-card-view.ts
export type TileVariant = 'grid' | 'rail' | 'flash' | 'rank' | 'line';
export interface ProductCardView {
  id: string; slug: string; name: string; brand: string; thumbnail: string | null; inStock: boolean;
  price: { value: number; compareAt: number | null; isFlash: boolean; salePct: number; from?: boolean };
  badges: CardBadge[];                       // đã xếp ưu tiên và cắt theo slot/biến thể (B3)
  meta: { rating?: { avg: number; count: number }; soldLabel?: string };   // formatSold gom về app-core
  nav: { slug: string; variationId?: string; pinnedVariationId?: string; listSource?: string };
}
export function productCardView(p: ProductCard, ctx: {
  variant: TileVariant; flash: readonly FlashPriceItem[]; now: number; launchDate?: string | null;
  extras?: { freeship?: boolean; favorite?: boolean; bestCouponLabel?: string; timesBought?: number; rank?: number };
}): ProductCardView;
```

**Vẽ:** Mini `apps/miniapp/src/components/ui/product-tile.tsx`. Web `apps/web/src/components/product-card.tsx` (một DOM, `max-md:` theo cùng số đo).

```ts
export interface ProductTileProps {
  view: ProductCardView;
  variant?: TileVariant;                 // mặc định 'grid'
  size?: 'sm' | 'md';                    // rail/flash/rank: bề rộng --tile-w-sm | --tile-w-md
  hideBrand?: boolean;                   // trang nhãn (DS-16)
  flash?: { soldPct: number; state: 'live' | 'upcoming' | 'soldout'; startsAt?: string; reminded?: boolean };
  action?: { kind: 'rebuy' | 'add' | 'remind'; label: string; onPress: () => void; pending?: boolean };
  trailing?: ReactNode;                  // chỉ 'line': checkbox combo, nút thêm
  showWishlist?: boolean;                // mặc định true ở grid và rail
  imageOverlay?: ReactNode;              // giữ cho nút giỏ nhanh ở Yêu thích
  priority?: boolean;                    // web: ảnh LCP
  onPress: () => void;                   // web dùng Link tới view.nav
}
```

Lớp bọc thông minh: Mini `components/product-card.tsx` nhận `{ product, variant, listSource }`, tự lấy Giờ vàng và ngày mở bán (cùng queryKey), gọi `productCardView` rồi điều hướng. Đây là lớp bọc **duy nhất**.

**Biến thể** (số đo ở 375px, đệm trang 16):

| Biến thể | Dùng ở | Rộng | Ảnh | Nhãn hiệu | Tên | Dòng meta | Giá | Nhãn (B3) | Phụ |
|---|---|---|---|---|---|---|---|---|---|
| `grid` | Danh mục, Gợi ý hôm nay, gian hàng, trang nhãn, Yêu thích, trang Flash sale (lưới) | 1fr ≈ 165px | 1:1 | có (`hideBrand` ẩn) | body-sm 2 dòng, cao tối thiểu 44 | ★ 4,8 (12) · Đã bán 1,2k | PriceTag sm inline | A ≤ 2, D ≤ 1, C ≤ 2 (luôn giữ chỗ 20px) | tim góc phải trên |
| `rail` md | Bán chạy, Mua lại, Thường mua kèm, Cùng nhà | 148 | 1:1 | có | 2 dòng | Đã bán | sm | A ≤ 1, C ≤ 1 | `action` rebuy |
| `rail` sm | Đã xem gần đây | 128 | 1:1 | không | caption 2 dòng | không | sm `stack` | không | không tim |
| `flash` | Giờ vàng (Trang chủ, trang riêng) | 128 hoặc 1fr | 1:1 | không | caption 2 dòng + 1 dòng phân loại | không | sm `flash` + `stack` | A = nhãn flash | thanh % đã bán có chữ trong thanh ("Đã bán 62%", ≥90% đổi thành "Sắp hết"). `upcoming`: nút "Nhắc tôi" thay thanh. `soldout`: phủ sáng + "Đã bán hết" |
| `rank` | Top bán chạy theo danh mục | 148 (kệ) hoặc `line` (bảng) | 1:1 | không | 2 dòng | "Đã bán 1,2k" đậm (label 12/600) | sm | A = ruy-băng hạng. Nhãn giảm chuyển xuống góc trái dưới ảnh | 1–3 dùng màu rank-1..3, từ 4 trở đi rank-n |
| `line` | gợi ý tìm kiếm, dòng combo, thêm từ giỏ | 100% | thumb 56 (64 ở giỏ) | không | 1–2 dòng | tuỳ | sm | không | `trailing` |

**Trạng thái:**

| Trạng thái | Hình | Hành vi |
|---|---|---|
| Mặc định | nền surface, `--elevation-1`, `--radius-card` | lớp phủ `::after` của nút tên (đã có) |
| Nhấn | `.tubu-press` (scale .97) | |
| Focus | viền `--color-border-focus` vẽ trên lớp phủ (đã có) | Tab đi qua tên → tim → nút |
| Hết hàng | `--color-bg-scrim-light` + viên giữa ảnh. **Ẩn mọi nhãn trừ hạng**. Giá vẫn hiện | vẫn mở được PDP |
| Không ảnh | `ProductImageFallback` (lá + chấm màu nhãn) | |
| Đang tải | `ProductTileSkeleton variant` dựng từ cùng hằng (DS-14) | không nhảy khi tải xong |
| Tên dài, số lớn | cắt 2 dòng. "Đã bán 1,2tr+" theo `formatSold` | |

**Token dùng:** `--color-bg-surface`, `--color-bg-media`, `--elevation-1`, `--radius-card`, `--tile-*`, `--type-body-sm-*`, `--type-caption-*`, `--type-price-sm-*`, `--color-rating`, `--color-text-secondary/tertiary`.

### B3. Hệ nhãn trên thẻ

Vị trí (slot):

- **A**: góc trái trên ảnh, xếp dọc, cách mép 8px, cách nhau 4px.
- **D**: ngay trước tên, inline, tối đa 1.
- **C**: một hàng dưới giá, không xuống dòng, tràn thì ẩn.
- **Phủ**: giữa ảnh.

Tim yêu thích (góc phải trên) và dòng ★/đã bán không phải nhãn.

| Ưu tiên | Nhãn | Slot | Màu | Điều kiện (hàm `cardBadges` ở app-core) |
|---:|---|---|---|---|
| 1 | Tạm hết hàng | Phủ | surface + text-primary trên scrim-light | `inStock === false`: tắt mọi nhãn khác trừ #2 |
| 2 | Hạng #n | A | `--color-rank-*` | biến thể `rank` |
| 3 | Icon Zap + "Giờ vàng -X%" (sm hẹp chỉ "-X%" kèm icon) | A | tông `flash` (`--color-flash-solid-*`) | `price.isFlash && salePct > 0` |
| 4 | -X% | A | tông `promo` | `!isFlash && salePct > 0` |
| 5 | Mới | A (dưới #3 hoặc #4) | tông `brand` | `isNewProduct(createdAt, now, launchDate)` |
| 6 | Đã mua N lần | A | tông `brand` | kệ Mua lại, `timesBought > 1` |
| 7 | Yêu thích | D | tông `verified` cỡ sm | cờ `isFavorite` từ API, tiêu chí do chủ chốt (E2) |
| 8 | Freeship | C | tông `success` | cờ freeship của SP hoặc ngưỡng (agent backend-gap) |
| 9 | Mã giảm Xk | C | VoucherTicket `chip` mini (viền đứt `--color-voucher-edge`) | mã tốt nhất áp được cho SP |

Tối đa theo biến thể:

| Biến thể | A | C | D |
|---|---:|---:|---:|
| grid | 2 | 2 | 1 |
| rail md | 1 | 1 | 0 |
| rail sm | 0 | 0 | 0 |
| flash | 1 (chỉ #3) | 0 | 0 |
| rank | 1 (#2), nhãn giảm xuống góc trái dưới | 0 | 0 |

Mỗi thẻ hiện tối đa 4 nhãn chữ. Mọi nhãn dùng label 12/600, cao `--badge-h-sm` 20px, bo pill. Không ghi đè màu qua `style`: Badge thêm 2 tông là `flash` và `verified`.

```ts
// packages/app-core/src/commerce/card-badges.ts
export type CardBadgeKind = 'soldout' | 'rank' | 'flash' | 'discount' | 'new' | 'timesBought' | 'favorite' | 'freeship' | 'voucher';
export interface CardBadge { kind: CardBadgeKind; slot: 'A' | 'C' | 'D' | 'overlay'; label: string; tone: BadgeTone }
export function cardBadges(input: CardBadgeInput, variant: TileVariant): CardBadge[];   // đã sắp và cắt
```

### B4. `PriceTag` (mở rộng bản có sẵn)

```ts
export interface PriceTagProps {
  value: number | null;                       // null → "—" (web đã làm, Mini chưa)
  compareAt?: number | null;
  flash?: boolean | { price: number };        // boolean đủ khi value đã là giá flash
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'inverse';
  layout?: 'inline' | 'stack';                // stack: giá gạch xuống dòng dưới (thẻ 128px)
  from?: boolean;                             // "Từ 99.000đ" khi nhiều phân loại (web PdpPrice đã có)
  discountPct?: number;                       // PDP: chữ "-20%" màu promo cạnh giá, thay badge rời
}
```

- Trạng thái: thường · giảm (có giá gạch) · Giờ vàng (`--color-flash-fg`, mọi nơi, kể cả lưới) · "Từ" · thiếu giá · nền tối.
- Token: `--type-price-*` (weight 600 ở sm/md, 700 ở lg/xl), `--color-text-price`, `--color-flash-fg`, `--color-text-price-compare`, `tabular-nums`.
- Luật: `line-through` và `formatVnd` cho giá chỉ được nằm trong `price-tag.tsx` (C2 T1b).
- Web: `ProductPriceRow`, `PdpPrice` và `<p>` ở Giờ vàng đều thay bằng web PriceTag, cùng số đo.
- Màu giá thường: đề xuất giữ đen. Câu hỏi E3.

### B5. `SectionHeader` và `Section` (nhịp khối)

```ts
export interface SectionHeaderProps {
  title: string;
  id?: string;                                  // để Section gắn aria-labelledby
  icon?: LucideIcon;
  tone?: 'default' | 'promo';                   // promo: chữ --color-promo-fg (Giờ vàng, Khuyến mãi)
  trailing?: ReactNode;                         // Countdown, "12 mã"
  action?: { label?: string; onPress?: () => void; href?: string };  // label mặc định "Xem tất cả"
  subtitle?: string;                            // 1 dòng caption tertiary
  as?: 'h2' | 'h3';
  inset?: boolean;                              // true: tự đệm ngang 16 (khối tràn mép như kệ)
}
export interface SectionProps { header?: SectionHeaderProps; density?: 'feed' | 'content'; bleed?: boolean; children: ReactNode }
```

- Hàng tiêu đề cao `--section-header-h` 44.
- Tiêu đề: `Heading title-sm` (Fraunces 16/600), một dòng, quá dài thì "…".
- Hành động: `Text label tone=brand` + `ChevronRight` 16. Vùng chạm 44 nhờ chiều cao hàng, mép phải thẳng hàng với lưới. Tên truy cập: "Xem tất cả {title}".
- Tiêu đề cách nội dung `--space-stack-sm` 8.
- `Section`: `margin-top` là `--space-block` 16 (feed) hoặc `--space-section` 24 (content). Khối con không tự đặt đệm trên/dưới. Thay 12 cách đệm ở DS-05.
- Web: `components/mini/section-header.tsx`, cùng props. `ui.sectionTitle` chỉ còn cho máy tính và trỏ về cùng thành phần.

### B6. `ProductGrid` và `ProductRail`

- `ProductGrid { columns?: 2; loading?: boolean; skeletonCount?: number; onEndReached?: () => void; children }`: lưới 2 cột, gap `--tile-gap`, có sentinel cuộn vô tận (gom từ `suggest-feed.tsx:31-44`) và nút "Xem thêm" dự phòng. Web dùng `GRID_PRODUCTS` (`lib/product-grid.ts:5`) bên trong.
- `ProductRail { label; size: 'sm' | 'md'; loading?; seeAll?: { href | onPress } ; children }`: `ScrollRow` + đệm `--rail-pad-block` + gap `--tile-gap`, thẻ rộng theo `size`, thẻ cuối có thể là "Xem tất cả". Web dùng `ScrollRail`/`ScrollRow arrows` bên trong.

### B7. `Countdown`

```ts
export interface CountdownProps {
  to: string | Date;
  variant?: 'blocks' | 'chip' | 'inline';     // blocks: HH:MM:SS ô tối (đầu Flash sale), chip: Badge promo + Clock
  prefix?: string;                            // "Kết thúc sau" | "Bắt đầu sau"
  onExpire?: () => void;                      // gọi 1 lần; hết giờ thì ẩn, không hiện 00:00:00
}
```

- Ô `blocks`: rộng tối thiểu 22, cao 20, `--radius-tag`, nền `--color-countdown-bg`, chữ `--color-countdown-fg`, label 12/600, `tabular-nums`. Từ 24 giờ trở lên hiện "2 ngày 03:15".
- Dùng `useCountdown` và `countdown-format` (app-core) đã có.
- Truy cập: `role="timer"`, `aria-label` cập nhật theo phút, phần chữ chạy từng giây đặt `aria-hidden`, không dùng `aria-live`.
- Web: giữ mẫu `key={afterMount}` của `home/flash-sale.tsx:105-118` để không lỗi hydrate.
- Thay chỗ của `CountdownChip` stub.

### B8. `BannerCarousel`

```ts
export interface BannerSlide { id: string; image: string; alt: string; to: string /* route nội bộ, /campaign/:slug */ }
export interface BannerCarouselProps { slides: BannerSlide[]; label: string; autoplayMs?: number /* 4500; 0 = tắt */; onSlideView?: (id: string) => void }
```

- Bố cục: rộng bằng trang trừ 2 × 16, tỉ lệ `--banner-ratio`, `--radius-media`. Cuộn bằng `scroll-snap-x mandatory`, không cần thư viện. Chấm 6px dưới giữa (`--color-media-dot-idle`, chấm đang chọn dùng surface).
- Truy cập: nút Tạm dừng nhìn 24, chạm 44 (WCAG 2.2.2). `aria-roledescription="carousel"`, mỗi slide `role="group" aria-label="2 / 5"`. Web có phím mũi tên.
- Hành vi: tự dừng khi chạm, khi tab ẩn hoặc khi bật giảm chuyển động. Chỉ 1 slide thì không có chấm, không tự chạy.
- Trạng thái:
  - Đang tải: Skeleton cùng tỉ lệ, giữ chỗ theo dấu nhớ như `readFlashHint` để CLS bằng 0.
  - Ảnh lỗi: nền `--color-bg-subtle` + chữ `alt`.
  - Rỗng: không vẽ gì.
- Ảnh rộng 686 (2x). Slide đầu tải ngay, các slide sau tải lười.

### B9. `VoucherTicket`

```ts
export interface VoucherTicketProps {
  coupon: CouponView;    // app-core couponView(): label "Giảm 20k", sub "Đơn từ 199k", kind 'amount'|'percent'|'freeship', endsLabel, expiring
  variant: 'ticket' | 'chip' | 'row';            // ticket: kho voucher, Ưu đãi · chip: PDP, giỏ, trang nhãn · row: chọn mã ở thanh toán
  state: 'claimable' | 'claimed' | 'usable' | 'used' | 'expired' | 'ineligible';
  reason?: string;                                // ineligible: "Đơn còn thiếu 50k"
  action?: { label: string; onPress: () => void; pending?: boolean };   // Lưu, Dùng, Chép
}
```

- `ticket`: cao khoảng 88.
  - Cuống trái 72px: nền `--color-voucher-stub-*`; loại freeship dùng `--color-voucher-ship-*`.
  - Răng cưa hai bên bằng `mask: radial-gradient`, vạch đứt `--color-voucher-edge`.
  - Phần phải: body-sm 700 `--color-voucher-fg`, caption phụ, HSD tertiary. Sắp hết hạn thì thêm chữ warning. Nút sm ở bên phải.
- `chip`: cao tối thiểu 44, nền `--color-voucher-bg`, viền đứt, label 12/700.
- `used`/`expired`: chữ disabled, cuống `--color-bg-chip`, có dấu "Đã dùng"/"Hết hạn", ẩn nút.
- `couponLabel` (đang nằm ở `coupon-card.tsx:14`) chuyển về app-core để web dùng chung.
- Thay cả 3 kiểu ở DS-07.

### B10. `ComboCard`

```ts
export interface ComboCardProps {
  title: string;                                   // "Mua kèm giảm giá"
  anchor: ProductCardView;                         // SP đang xem, không bỏ chọn được
  items: { view: ProductCardView; comboPrice: number; selected: boolean; disabledReason?: string }[];
  summary: { total: number; compareAt: number; saving: number };   // từ API, app-core chỉ định dạng
  onToggle: (productId: string) => void;
  onAdd: () => void; pending?: boolean;
  variant?: 'pdp' | 'cart';
}
```

- `pdp`: `Card outline` chứa:
  - `SectionHeader` có `trailing` là "Tiết kiệm 35k" màu promo.
  - Mỗi dòng: ProductTile `line` (thumb 56) + Checkbox ZaUI (đã theme, chạm 44) + PriceTag có `compareAt`.
  - Chân: "Tổng N món" PriceTag md + giá gạch + nút primary full "Thêm N món vào giỏ".
- `cart`: một dòng "Thêm {tên} giảm 15k" + nút secondary.
- Trạng thái:
  - Món hết hàng: checkbox tắt + "Tạm hết".
  - Chỉ còn SP đang xem: nút đổi thành "Thêm vào giỏ".
  - Đang thêm: `loading`.
  - Xong: snackbar + "Xem giỏ".
- Tiền combo lấy từ API, không tự tính ở máy khách.

### B11. Ánh xạ cũ → mới

| Hiện tại | Thay bằng |
|---|---|
| `components/product-card.tsx` + `CatalogTile` + `RelatedTile` (Mini) | `ProductCard` (một lớp bọc) + `productCardView` |
| Thẻ Giờ vàng, Sắp diễn ra (Mini `flash-sale.tsx`, web `home/flash-sale.tsx`) | ProductTile `flash` trong `ProductRail size=sm` |
| Thẻ Đã xem gần đây (Mini, web) | ProductTile `rail size=sm` (dữ liệu máy: `view` không có nhãn, tim tắt) |
| Kệ PDP 150px, Bán chạy 156px, Mua lại 148px | `ProductRail size=md` |
| `CatalogGrid`, lưới ở storefront-view, brand-view, storefront-preview | `ProductGrid` |
| Heading + nút "Xem tất cả" tự dựng (3 chỗ), `ui.sectionTitle`/`phoneSectionTitle`/`mini.sectionTitle`/`miniSectionTitle`/`mini-skin.sectionTitle`/`TITLE` | `SectionHeader` |
| Badge ghi đè `style` nền đặc (6 chỗ), `FlashBadge`, `CountdownChip`, `NewProductBadge`, `CardSaleBadge`, `mini/badge` ở web | Badge (tông `flash`, `verified`) + `cardBadges` |
| `CouponCard`, chip mã PDP, mã khuyến mãi trang nhãn | `VoucherTicket` |
| `ProductCardSkeleton`, `ProductGridSkeleton` | `ProductTileSkeleton` |

---

## C. Cơ chế để màn và chức năng làm sau vẫn khớp

### C1. Nguồn sự thật

| File | Vai |
|---|---|
| `packages/design-tokens/src/tokens.css` (+ `runtime.css`, `brand.css` chuyển từ Mini và web về) | giá trị: 3 lớp token |
| `packages/design-tokens/DESIGN.md` (**mới**) | luật: 5 nguyên tắc ở B0; bảng "cần gì → dùng gì"; spec B2–B10 rút gọn; bảng ưu tiên nhãn; nhịp khối; luật tiêu đề; nhật ký quyết định (ngày, quyết định, lý do). `AGENTS.md` thêm mục "Giao diện" trỏ tới đây |
| `packages/app-core/src/commerce/*.ts` + spec | logic: `product-card-view`, `card-badges`, `coupon-view`, `combo-summary`, `formatSold` (hiện chép ở `utils/format.ts:60` và `apps/web/src/lib/api.ts`) |
| `packages/app-core/src/ds-map.json` (**mới**) | bản đồ thành phần giống `route-map.json`: `{ "ProductTile": { "miniapp": "apps/miniapp/src/components/ui/product-tile.tsx", "web": "apps/web/src/components/product-card.tsx", "props": "ProductTileProps" }, … }` |
| Trang mẫu `/ds-gallery` (**mới**): Mini `pages/ds-gallery.tsx` (chỉ đăng ký route khi `import.meta.env.DEV` hoặc `VITE_DS_GALLERY`), web `app/ds-gallery/page.tsx` (`notFound()` ở production nếu thiếu `DS_GALLERY`) | vẽ mọi biến thể với mọi trạng thái từ `packages/app-core/src/ds-fixtures.ts` (tên dài, hết hàng, Giờ vàng, mới, không ảnh, đã bán 1,2tr). Thêm dòng `skip` có lý do vào `route-map.json`. Không dùng `app/__ds`: thư mục bắt đầu bằng `_` là private, Next không tạo route |

### C2. Bài kiểm tự động mới

| # | File | Kiểm gì | Chạy |
|---|---|---|---|
| T1 | `apps/miniapp/src/ds-shop-guard.spec.ts` | Trên danh sách bánh cóc `SHOP_FILES` (file phạm vi đợt này + **mọi file mới** dưới `components/{home,catalog,flash,campaign,voucher,combo}/` và page của route lane `shop`, `affiliate`, `/offers`):<br>(a) cấm `<ProductImage`, `<ProductThumb`, `aspectRatio: '1 / 1'` ngoài `components/ui/` (thẻ SP tự chế)<br>(b) cấm `line-through` và `formatVnd(` trong JSX ngoài `price-tag.tsx`<br>(c) cấm `var(--(forest\|sage\|stone\|clay\|honey\|terracotta\|orange\|red\|amber\|blue\|navy\|tubu-orange)-` ngoài `css/` và `components/ui/`<br>(d) cấm `fontSize:` số và `borderRadius:` số (trừ 0 và `'50%'`)<br>(e) cấm import `Text` từ `zmp-ui`<br>(f) cấm `--color-flash-solid-bg` ngoài `ui/badge.tsx`, `ui/progress-bar.tsx`<br>(g) cấm `<Heading variant="title-sm" as="h2"` trực tiếp, phải qua `SectionHeader` | `pnpm --filter @tubutree/miniapp test` (CI: `pnpm test:ci`) |
| T2 | cùng file T1, khối "bánh cóc số" | Đếm theo file: số px viết tay ở `padding/margin/gap`, chỗ dùng primitive, `Text size=` của ZaUI. **Không được tăng** so với `scripts/uiux/ds-baseline.json`. File mới phải bằng 0. Giảm thì cập nhật baseline bằng `node scripts/uiux/static-scan.mjs --write-baseline` (thêm cờ này vào script có sẵn) | như T1 |
| T3 | `packages/eslint-config/rules/{no-primitive-token,no-inline-font-size,no-adhoc-product-card}.js` + spec | Như T1(a), (c), (d), nhưng báo ngay trong editor | `pnpm lint` (Mini) |
| T4 | `apps/web/src/ds-shop-guard.spec.ts` | Bản web của T1 cho lớp Tailwind:<br>cấm `(bg\|text\|border)-(stone\|forest\|sage\|clay\|honey)-\d+` trong file SHOP đã chuyển (sau khi preset có lớp ngữ nghĩa)<br>cấm `line-through` ngoài PriceTag<br>cấm `<ProductImage` ngoài `product-card.tsx` và `components/mini/`<br>cấm `font-display text-lg` trên `h2` ngoài `SectionHeader`<br>cấm `w-32\|w-36\|w-\[\d+px\]` cho thẻ kệ<br>cấm import cả `ui/badge` lẫn `mini/badge` trong một file | `pnpm --filter @tubutree/web test` |
| T5 | `packages/app-core/src/commerce/card-badges.spec.ts`, `product-card-view.spec.ts` | bảng ưu tiên B3; số tối đa theo slot và biến thể; hết hàng ẩn nhãn; Giờ vàng thắng giảm thường; "Mới" theo `launchDate`; nhãn flash có chữ "Giờ vàng" ở mọi biến thể đủ rộng | `pnpm --filter @tubutree/app-core test` |
| T6 | `scripts/check-ds-parity.mjs`, gọi trong `pnpm lint:parity` | Với mỗi dòng của `ds-map.json`:<br>có đủ file Mini và web<br>tên khoá của `interface XProps` hai bên giống nhau (parse regex như `check-platform-parity.mjs`)<br>mọi file trong `apps/web/src/components/mini/` phải có người import, để bắt bản chết như DS-10 | `pnpm lint:parity` (đã có trong `ci.yml`) |
| T7 | `packages/design-tokens/package.json` thêm `"test": "vitest run"`; mở rộng `tailwind-preset.spec.ts` | 36 test hiện có chạy trong turbo. Mọi hex của preset bằng `tokens.css`. Lớp ngữ nghĩa trỏ đúng `var(--color-*)` | `pnpm test:ci` |
| T8 | `apps/miniapp/src/css/contrast.spec.ts` thêm khối | rank-1..3/n, cuống voucher (cả freeship), ô đếm ngược, chữ trên `--color-flash-solid-bg`, `--color-verified-*` | miniapp test |
| T9 | `apps/e2e/tests/ds-parity.shop.spec.ts` | Mở `/ds-gallery` của Mini và web ở 375×812 với cùng fixture. Với mỗi `[data-ds][data-ds-variant]`, đọc computed style của từng `data-ds-part` (font-size, weight, line-height, padding, radius, màu, cỡ ảnh) và so bằng nhau, dung sai 1px. Đồng thời chụp ảnh qua `captureVisual` vào `VISUAL_DIR` để người xem. So số đo thay vì so pixel nên không chập chờn vì font hay ảnh | `pnpm --filter @tubutree/e2e exec playwright test ds-parity` (`e2e.yml`) |
| T10 | `components/ui/hit-target-guard.spec.tsx` thêm | `action` của ProductTile, hành động của SectionHeader, nút Tạm dừng của Banner, nút của VoucherTicket, checkbox của ComboCard | miniapp test |
| T11 | `.github/workflows/ci.yml` | thêm bước `pnpm lint:vars` (DS-18) | CI |

### C3. Skill dự án `tubu-ui`

**Vướng:** `.gitignore:45` có dòng `.claude/`, nên `.claude/skills/tubu-ui/SKILL.md` không vào git. Có hai cách (câu hỏi E4):

- (a) Đổi thành `.claude/*` kèm `!.claude/skills/`, sao cho `worktrees/` vẫn bị bỏ qua.
- (b) Để skill ở `docs/agents/skills/tubu-ui/SKILL.md` và thêm vào `AGENTS.md`/`CLAUDE.md` câu "Trước khi làm UI, đọc docs/agents/skills/tubu-ui/SKILL.md". Agent không phải Claude cũng đọc được.

Đề xuất (a) và thêm câu trỏ của (b) vào `AGENTS.md`.

Nội dung skill (khung):

```
---
name: tubu-ui
description: Use before creating or changing any screen, component or style in apps/miniapp or apps/web of Tubu Tree. Gives the shop design-system rules, which component to reuse for each need, and the checks that prove new UI matches the current Mini App and web.
---
1. Đọc packages/design-tokens/DESIGN.md (bảng "cần gì → dùng gì", bảng nhãn, nhịp khối).
2. Tra ds-map.json: thành phần đã có thì dùng, KHÔNG dựng thẻ/tiêu đề/nhãn/giá/phiếu mới.
   Thiếu biến thể → thêm biến thể vào thành phần có sẵn, không tạo file song song.
3. Logic (giá, nhãn, chữ đếm ngược, tổng combo) viết ở packages/app-core/src/commerce + spec.
4. Làm Mini ở 375px trước, rồi web theo ds-map.json (cùng props, cùng data-ds-*).
5. Chỉ dùng token semantic/component: không hex, không var(--stone-…), không fontSize số, khoảng cách qua Section/ProductGrid/ProductRail.
6. Thành phần MỚI: thêm vào components/ui + bản web + ds-map.json + ds-gallery + DESIGN.md + spec + contrast/hit-target nếu có màu/nút.
7. Kiểm trước khi báo xong (dán output):
   pnpm --filter @tubutree/miniapp test -- ds- ; pnpm --filter @tubutree/web test -- ds- ;
   pnpm --filter @tubutree/app-core test ; pnpm lint ; pnpm lint:parity ; pnpm lint:vars ;
   pnpm --filter @tubutree/e2e exec playwright test ds-parity
8. Chụp 375px Mini + web của màn đã đổi (VISUAL_DIR=… visual-tour) và đặt cạnh nhau trong PR.
```

### C4. Checklist PR (`.github/pull_request_template.md`, **mới**, mục "Giao diện")

- [ ] Không có thẻ, tiêu đề, nhãn, giá hay phiếu tự dựng. Đã dùng thành phần ở `ds-map.json`.
- [ ] Logic giá và nhãn nằm ở `app-core/commerce`, có spec.
- [ ] Mini và web cùng làm trong nhánh này. `pnpm lint:parity` xanh, `ds-parity` xanh.
- [ ] Không hex, không primitive, không `fontSize` số. Baseline `ds-baseline.json` không tăng.
- [ ] Màu mới có trong `contrast.spec.ts`. Nút mới có trong `hit-target-guard`.
- [ ] Có ảnh 375 Mini và web đặt cạnh nhau. Có ảnh trạng thái chờ, rỗng, lỗi và hết hàng.
- [ ] `DESIGN.md` đã cập nhật nếu đổi luật hoặc thêm thành phần.

### C5. Quy trình khi làm màn mới

1. Mở trang `/ds-gallery` để chọn biến thể.
2. Nếu thiếu, thêm biến thể theo C3 bước 6.
3. Dựng màn từ `Section` + `SectionHeader` + `ProductGrid`/`ProductRail`.
4. Chạy bộ kiểm ở C3 bước 7.
5. PR theo C4.

Bánh cóc T2 bảo đảm màn cũ chỉ có thể sạch dần. Rào T1, T4 và T6 bảo đảm màn mới không lặp lại 6 kiểu thẻ.

---

## D. Thứ tự làm đề xuất

| Gói | Việc | Cỡ | Phụ thuộc |
|---|---|---|---|
| D1 Nền | Token B1 + chuyển biến chung về `packages/design-tokens` (DS-17) + script test (DS-12) + `DESIGN.md` + skill + PR template + T1/T2/T4 chạy chế độ bánh cóc (baseline = hiện trạng) | S–M | không |
| D2 Logic | `commerce/product-card-view`, `card-badges`, `coupon-view`, `formatSold` về app-core + T5 | S | D1 |
| D3 Thành phần Mini | ProductTile biến thể + `ProductCard` một lớp bọc, PriceTag mở rộng, Badge tông mới (12px), SectionHeader, Section, ProductGrid, ProductRail, Countdown, ProductTileSkeleton. Chuyển Trang chủ, Danh mục, PDP (kèm DS-11), gian hàng, nhãn sang dùng | M–L | D2 |
| D4 Web | Thẻ web theo B2, xoá bản chết (DS-10), PriceTag/SectionHeader web, lớp ngữ nghĩa preset (DS-09), gom `max-md:` + `ds-map.json` + T6 + `/ds-gallery` + T9 | M–L | D3 |
| D5 Thành phần cho tính năng mới | BannerCarousel, VoucherTicket, ComboCard, biến thể `rank`, biến thể `flash` lưới cho trang riêng + T8/T10 | M | D3 (Mini), D4 (web) |

---

## E. Câu hỏi cho chủ (mỗi câu có đề xuất mặc định)

1. **Tiêu đề khối hàng:** Fraunces 16 (đề xuất: đang là đa số với 25 chỗ, đúng DS v2) hay Inter 16 như PDP?
2. **Nhãn "Yêu thích":** tiêu chí nào? Đề xuất: điểm ≥ 4,8, ≥ 20 đánh giá, ≥ 50 đã bán, do API tính.
3. **Màu giá thường:** giữ đen như hiện tại, chỉ Giờ vàng màu cam (đề xuất, hợp "Deep Forest Apothecary"), hay cam hoặc đỏ cho mọi giá giảm như Shopee?
4. **Skill dự án:** mở `.gitignore` cho `.claude/skills/` (đề xuất) hay để skill trong `docs/agents/skills/`?
