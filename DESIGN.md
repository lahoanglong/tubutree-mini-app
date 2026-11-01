# DESIGN.md: giao diện mua sắm Tubu Tree

Luật chung cho mọi màn mua sắm của Mini App (`apps/miniapp`) và web (`apps/web`): Trang chủ, Danh mục, chi tiết sản phẩm, giỏ, gian hàng CTV, trang thương hiệu, Ưu đãi, Giờ vàng, Bán chạy nhất, chiến dịch. Đọc file này trước khi thêm hay sửa một màn. Agent dùng skill `.claude/skills/tubu-ui/SKILL.md`, skill trỏ về đây.

Thiết kế gốc và lý do từng quyết định: `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật), báo cáo chi tiết ở `docs/2026-10-31-shop-redesign/review/`.

Nguồn sự thật, mỗi thứ một chỗ:

| Chỗ | Vai |
|---|---|
| `packages/design-tokens/src/tokens.css` | giá trị: màu, cỡ chữ, khoảng cách, đổ bóng (3 lớp token) |
| `docs/design/ds-map.json` | thành phần ↔ file Mini ↔ file web ↔ màn dùng; `pnpm lint:parity` kiểm |
| `packages/app-core/src/commerce/` | logic: giá, nhãn, meta, đếm ngược, phiếu, bộ sưu tập (`productCardView`, `cardMetaLine`, `countdownText`, `collectionView`...) |
| `packages/app-core/src/merch/shelves.ts` | sổ kệ hàng: trần, sàn, chống trùng, "Xem tất cả" |
| `packages/app-core/src/shop-copy.ts` | chữ mua sắm dùng chung và bảng thuật ngữ cấm |
| `/ds-gallery` (chỉ bản dev) | vẽ mọi biến thể: Mini `apps/miniapp/src/pages/ds-gallery.tsx`, web `apps/web/src/app/ds-gallery/page.tsx` |

## Nguyên tắc

1. **Logic ở app-core, hình ở app.** Giá, nhãn, thứ tự nhãn, chữ đồng hồ, chữ phiếu và tổng combo là hàm thuần có spec trong `packages/app-core/src/commerce/`. Mini và web chỉ vẽ, không chép logic.
2. **Một thành phần, nhiều biến thể.** Thiếu kiểu thì thêm biến thể vào thành phần đã có, không tạo thẻ, tiêu đề, nhãn, giá hay phiếu mới song song.
3. **Token ba lớp:** primitive (chỉ nằm trong `tokens.css`) → semantic → component. Màn không viết hex, không dùng `var(--stone-…)`, không viết `fontSize` số.
4. **Mini 375px là bản gốc.** Web dưới `md` phải ra cùng số đo với Mini, đo bằng bài kiểm chứ không ước bằng mắt. Từ `md` và `lg` web có khuôn riêng (xem mục Khuôn trang web máy tính).
5. **Mỗi khối một ý định, có trần và có lối ra.** Kệ khai ở `shelves.ts` với trần số món, sàn số món, hạng chống trùng và "Xem tất cả".
6. **Không nhảy trang.** Khối mới có chiều cao giữ chỗ trong khung chờ; số đo thân thẻ dùng chung `TILE_METRICS`.
7. **Giá khách thấy bằng giá khách trả.** Giá thẻ, chi tiết, giỏ, báo giá và đặt đơn ra cùng số (thứ tự giảm Giờ vàng → combo → mã → hạng → điểm).

## Token

Chỉ nêu token dùng cho mua sắm; danh sách đầy đủ ở `packages/design-tokens/src/tokens.css`.

| Token | Dùng cho |
|---|---|
| `--color-text-price` | giá thường (đen) |
| `--color-text-price-deal` | giá đang giảm (Giờ vàng, giá sale), `--orange-700` #9A5200; không dùng đỏ |
| `--color-flash-solid-bg`, `--color-flash-solid-fg` | nền và chữ nhãn Giờ vàng đặc; chỉ `Badge` và thanh tiến độ được dùng |
| `--color-flash-fg` | chữ cam của khối Giờ vàng |
| `--color-countdown-bg`, `--color-countdown-fg` | ô số đồng hồ Giờ vàng (nền tối, chữ sáng) |
| `--color-voucher-bg`, `--color-voucher-fg`, `--color-voucher-edge`, `--color-voucher-stub-bg`, `--color-voucher-stub-fg` | phiếu mã giảm giá |
| `--color-bg-media`, `--color-bg-cover`, `--color-bg-chip`, `--color-track` | nền ô ảnh, bìa shop chưa có ảnh, chip chưa chọn, rãnh thanh tiến độ |
| `--tile-w-sm` (128px), `--tile-w-md` (148px) | hai bề rộng thẻ kệ duy nhất |
| `--type-price-tile-size`, `--type-price-tile-lh`, `--type-price-tile-weight` | giá trên thẻ: 16px, 1,25, 700 |
| `--space-block` (16px), `--space-section` (24px) | khoảng giữa hai khối ở màn danh sách và ở màn nội dung |
| `--elevation-nav` | thanh dưới |
| `--sort-bar-top` | chỗ `SortBar` dính; trang có header cố định đặt lại |
| `--color-border-focus` | viền focus của nút |

Tiêu đề khối trong luồng mua: Inter 16/700, -0.01em (Fraunces chỉ cho tiêu đề trang và số lớn từ 22px). Vùng chạm tối thiểu 44px, tương phản chữ tối thiểu 4,5:1.

## Thành phần

Cần gì thì dùng đó. Mini ở `apps/miniapp/src/components/ui/`, web ở `apps/web/src/components/mini/` (cùng tên, cùng props); đường dẫn đầy đủ và màn dùng ở `docs/design/ds-map.json`. Lệch props có chủ đích khai ở `propsDiff` kèm lý do.

### Thẻ sản phẩm

| Cần | Dùng |
|---|---|
| vẽ một thẻ từ `ProductCardView` | `ProductTile` (biến thể `grid`, `rail-sm`, `rail-md`, `flash`, `rank`, `line`) |
| thẻ nối dữ liệu thật (Giờ vàng, ngưỡng miễn phí giao) | `ProductCard` |
| lưới hoặc kệ ngang thẻ | `ProductGrid`, `ProductRail` |
| giá, giá gạch, "Tiết kiệm" | `PriceTag` (giá gạch chỉ được vẽ ở đây) |
| ảnh sản phẩm, ảnh nhỏ | `ProductImage`, `ProductThumb` |
| khung chờ thẻ | `ProductTileSkeleton`, `Skeleton` |
| tim yêu thích | `WishlistHeart` |

Kệ ngang chỉ dùng `rail-sm` và `flash` (`--tile-w-sm`, 128px) hoặc `rail-md` và `rank` (`--tile-w-md`, 148px); `grid` là hai cột. Số đo thân thẻ ở `TILE_METRICS` (`packages/app-core/src/commerce/tile-metrics.ts`), khung chờ đọc cùng chỗ. Hàng cùng kệ chênh đáy giá không quá 1px.

### Khối, tiêu đề, điều hướng trong trang

| Cần | Dùng |
|---|---|
| bọc một khối và đặt nhịp | `Section` |
| tiêu đề khối có "Xem tất cả" | `SectionHeader` (không tự dựng `<h2>` + nút) |
| tiêu đề nhỏ trong thẻ | `SectionTitle` |
| đồng hồ Giờ vàng | `Countdown` (`mode='clock'` HH:MM:SS chỉ ở đầu khối Giờ vàng và trang Giờ vàng; nơi khác `mode='text'`) |
| thanh "Đã bán n%" | `FlashSoldBar` |
| dải Giờ vàng ở chi tiết sản phẩm | `FlashPriceBar` |
| sắp xếp và lọc dính | `SortBar` |
| tab khung giờ Giờ vàng | `SlotTabs` |
| tab trong trang | `SegmentedTabs` |
| hàng cuộn ngang | `ScrollRow` |
| khối lỗi tại chỗ | `HomeBlockError` (kèm khung chờ cùng chiều cao) |

### Khuyến mãi và banner

| Cần | Dùng |
|---|---|
| phiếu mã giảm giá (`ticket`, `chip`, `row`) | `VoucherTicket` |
| combo "Mua cả bộ" | `ComboCard` |
| banner chiến dịch | `BannerCarousel` (nút dừng, tôn trọng giảm chuyển động, từ 5 giây mỗi ảnh) |

### Trang shop

`ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection` (vẽ theo `layout` của bộ sưu tập: kệ ≤10, lưới ≤6, dòng ≤5, combo), `TierBadge` (ẩn bậc thấp nhất).

### Thành phần nền

`Badge`, `Button`, `Card`, `Chip`, `Icon`, `IconButton`, `ListRow`, `KeyValueRow`, `ProgressBar`, `QuantitySelector`, `SearchField`, `StickyActionBar`, `Text`, `Heading`, `Timeline`, `StatTile`, `BottomSheet`, `EmptyState`, `BackButton`.

### Khuôn trang web (chỉ web)

`HubLayout`, `ListingLayout`, `PdpLayout`, `StoreLayout` ở `apps/web/src/components/layouts/`. Chi tiết ở mục Khuôn trang web máy tính.

## Sắp có (đợt 4b/4c)

Thành phần các gói đang làm song song với gói này, tên đã chốt trong `docs/2026-10-31-shop-redesign/02-ke-hoach.md`. Chưa có ở base nên chưa nằm trong bảng trên; gói nào xong thì chuyển dòng từ `upcoming` sang `components` của `docs/design/ds-map.json` và sang mục Thành phần.

| Tên | Gói | Đợt | Là gì |
|---|---|---|---|
| `SectionCard` | P10 | 4b | một khối của gian hàng ở màn dựng `/storefront` |
| `LayoutPicker` | P10 | 4b | chọn Lưới / Kệ ngang / Danh sách / Combo |
| `GuestLinkCard` | P14 | 4b | khối cần tài khoản ở `/offers` cho khách chưa đăng nhập; Mini đã có thẻ cùng tên mời liên kết Zalo ở `apps/miniapp/src/components/home/guest-link-card.tsx`, P14 quyết dùng lại hay đặt tên khác |
| `components/bundle/*` | P15 | 4c | khối combo và mua kèm ở chi tiết sản phẩm, giỏ, Trang chủ; kế hoạch chưa chốt tên thành phần |

## Luật kệ

Mỗi khối hàng ở mọi màn khai một dòng `ShelfSpec` trong `packages/app-core/src/merch/shelves.ts`; màn mới thêm kệ thì khai ở đó trước khi vẽ.

| Trường | Nghĩa |
|---|---|
| `id` | `<màn>.<tên>` (vd `home.flash`); `shelf(id)` chỉ nhận id nên id mang tiền tố màn |
| `screen` | `home`, `browse`, `pdp`, `shop`, `offers`, `flash` |
| `intent` | một ý định một kệ; hai kệ cùng `intent` trên một màn bị chặn |
| `layout` | `rail`, `grid`, `line`, `feed` |
| `maxItems`, `minItems` | trần và sàn số món; dưới sàn thì kệ ẩn hẳn, không để tiêu đề trơ |
| `dedupeRank` | hạng chống trùng, số nhỏ thắng: Giờ vàng 1 > Mua lại 2 > Combo 3 > Bán chạy 4 > Mới 5 > Gợi ý 6; `null` = không tham gia |
| `seeAllRoute` | lối "Xem tất cả", phải là route có trong `packages/app-core/src/route-map.json` |

`applyShelfDedupe` cắt `maxItems` và loại món đã bị kệ hạng cao chiếm; kệ còn dưới `minItems` trả rỗng và không chiếm món. Trang chủ tối đa 4 kệ hàng (không tính `feed`, và `home.purchased` không tính với khách mới). `packages/app-core/src/merch/shelves.spec.ts` chặn kệ thiếu ngân sách, `seeAllRoute` không có route, hai kệ cùng ý định và Trang chủ quá 4 kệ.

Trang chủ lúc lập tài liệu (nguồn thật là `shelves.ts`, đọc ở đó khi cần số đúng):

| Kệ | Bố cục | Trần / sàn | Hạng | Xem tất cả |
|---|---|---|---|---|
| `home.flash` | rail | 8 / 3 | 1 | `/flash-sale` |
| `home.purchased` | line | 10 / 1 | 2 | `/orders` |
| `home.combos` | rail | 4 / 2 | 3 | không |
| `home.bestSellers` | rail | 10 / 3 | 4 | `/best-sellers` |
| `home.suggest` | feed | 100 / 4 | 6 | `/browse` |

Thứ tự khối Trang chủ cho khách cũ: header dính → thẻ thành viên → việc cần làm → banner → lối tắt → Giờ vàng → Mua lại → danh mục → Bán chạy nhất → combo → hành trình → cộng đồng → Gợi ý hôm nay. Khách mới: `welcome` thay thẻ thành viên, không có Mua lại.

## Luật nhãn và giá

**Nhãn trên thẻ** (do `productCardView` tính, ở `packages/app-core/src/commerce/product-card-view.ts`):

- Chỗ A, trên ảnh: tối đa một nhãn, Giờ vàng "-x%" hoặc giảm giá "-x%".
- Chỗ nhãn, đầu dòng tên: tối đa một, ưu tiên Combo > Tubu chọn > Được yêu thích > Mới > Miễn phí giao hàng.
- Hết hàng thì ẩn mọi nhãn và hiện "Tạm hết hàng"; hàng ngừng bán ghi "Ngừng bán".
- "Miễn phí giao hàng" chỉ khi riêng món đó được miễn phí (Tubu giao và đạt ngưỡng), không gắn vì cả đơn đạt ngưỡng.
- "Được yêu thích": từ 4,8 sao, 20 đánh giá, 50 đã bán (cấu hình được, API tính); "Tubu chọn" là `isFeatured`.
- Dòng meta một dòng: "★ 4,8 · Đã bán 1,2k+" (`cardMetaLine`). Thẻ giữ chiều cao cố định kể cả thiếu meta.

**Giá:** giá thường đen (`--color-text-price`); giá đang giảm dùng `--color-text-price-deal`. Giá gạch chỉ vẽ qua `PriceTag`, luôn kèm chữ đọc "Giá" và "giá gốc". Giá chỉ hiện từ một nguồn: nơi vẽ không tự trừ.

**Đồng hồ Giờ vàng:** HH:MM:SS nhảy từng giây chỉ ở đầu khối Giờ vàng Trang chủ và đầu trang Giờ vàng, ô số nền tối. Nơi khác "Kết thúc sau 2 giờ 05 phút", cập nhật theo phút. Một bộ đếm cho cả khối. Hết giờ khi khách đang xem thì thẻ, chi tiết, giỏ trở về giá thường.

**Màu:** giữ chất "Deep Forest Apothecary"; Giờ vàng dùng cam đậm, không dùng đỏ "gào thét".

## Chữ chuẩn và thuật ngữ cấm

Chữ mua sắm dùng chung chỉ thêm vào `packages/app-core/src/shop-copy.ts` (khoá `SHOP_COPY`, kèm ngân sách độ dài ở `shop-copy-budget.ts`); màn gọi `fillCopy('<khoá>')`, không viết chữ thẳng trong mã. Chữ đã chốt: "Bán chạy nhất", "Miễn phí giao hàng", "Được yêu thích", "Tubu chọn", "Mã giảm giá", "Thương hiệu", "Gian hàng", "Giờ vàng" (hoa chữ G), "Tạm hết hàng", "Ngừng bán", "Kết thúc sau {t}". Giọng: "bạn" và "Tubu".

Thuật ngữ cấm trong chữ khách đọc (`FORBIDDEN_TERMS`), cột phải là chữ dùng thay:

| Cấm (mẫu) | Dùng |
|---|---|
| Nhãn hàng, theo dõi nhãn, nhãn này, Cùng nhà | Thương hiệu |
| Top | Bán chạy nhất |
| Freeship | Miễn phí giao hàng |
| voucher | Mã giảm giá |
| mã giảm không có chữ "giá" theo sau | Mã giảm giá |
| Flash sale | Giờ vàng |
| giờ vàng viết thường | Giờ vàng (hoa chữ G) |
| HSD | Hạn dùng hoặc Dùng đến |
| Chỉ còn | Còn {n} sản phẩm |
| Vui lòng, chúng tôi | Bạn hoặc Tubu |
| cửa hàng | Gian hàng |
| ba dấu chấm `...` | … (một ký tự) |
| `2h 05m`, `2h 5m` (mọi dạng `\d+h \d+m`) | countdownText, ví dụ "2 giờ 05 phút" |
| HOT, SỐC, Nhanh tay | bỏ chữ giục mua |

`packages/app-core/src/terminology.spec.ts` quét chữ hiển thị (cây cú pháp, không quét comment, tên biến, `className`, đường dẫn import) của `apps/miniapp/src` và `apps/web/src`, trừ quản trị. Mã cũ đang vi phạm nằm trong danh sách `EXEMPT` của spec, mỗi dòng có lý do và trần `max`: file đã miễn không được thêm vi phạm mới, và dòng miễn mà file đã sạch thì phải xoá. Sửa chữ cũ thì hạ `max` hoặc xoá dòng.

## Khuôn trang web máy tính

Mỗi trang mua sắm trên web dùng một khuôn trong `apps/web/src/components/layouts/`. Khuôn chỉ lo lưới từ `lg` (cột, độ rộng tối đa, vùng dính); dưới `md` trả nguyên con để khổ điện thoại giống Mini. Không cột dính, không vùng cuộn riêng bên trong trang.

| Khuôn | Trang | Slot |
|---|---|---|
| `HubLayout` | Trang chủ | `banner?`, `aside`, `children` (lưới 12 cột: banner 8 cột + `aside` 4 cột) |
| `ListingLayout` | Danh mục `/san-pham` | `breadcrumb?`, `title`, `caption?`, `toolbar?`, `sidebar?`, `children` (cột lọc 200px) |
| `PdpLayout` | chi tiết sản phẩm | `gallery`, `info`, `below`, `aside?` (ảnh và thông tin trong một thẻ, nút mua trong màn 1280×800) |
| `StoreLayout` | `/s/[slug]`, `/brand/[slug]` | `header`, `stats?`, `intro?`, `tabs?`, `children` |

Khung trang rộng: `PAGE_WIDE` ở `apps/web/src/lib/page-frame.ts`. Trang web mới không viết lớp `max-md:` để làm giống Mini: dựng từ thành phần Mini trong khuôn.

## Thêm màn mới

1. Mở `/ds-gallery` (chạy dev) chọn thành phần và biến thể; tra `docs/design/ds-map.json`.
2. Thiếu biến thể thì thêm vào thành phần có sẵn ở cả hai app (cùng props), cập nhật `ds-map.json`, `/ds-gallery`, mục Thành phần của file này và spec. Thành phần hoàn toàn mới: cùng các bước đó, thêm `contrast.spec.ts` nếu có cặp màu mới, `hit-target-guard.spec.tsx` nếu có nút mới.
3. Logic giá, nhãn, chữ đếm ngược, tổng combo viết ở `packages/app-core/src/commerce/` kèm spec.
4. Kệ hàng mới khai ở `shelves.ts`; route mới khai ở `packages/app-core/src/route-map.json` (Mini và web cùng nhánh).
5. Dựng từ `Section` + `SectionHeader` + `ProductGrid` hoặc `ProductRail`; Mini ở 375px trước, rồi web theo khuôn.
6. Chữ mới vào `shop-copy.ts` (và ngân sách độ dài).
7. Chạy bộ kiểm ở mục dưới, chụp 375px Mini và web đặt cạnh nhau (`apps/e2e/tests/visual-tour.miniapp.spec.ts`, `apps/e2e/tests/visual-tour.web.spec.ts`, rồi `apps/e2e/scripts/visual-pairs.mjs` ghép cặp), kèm trạng thái chờ, rỗng, lỗi, hết hàng.

## Kiểm tự động

Đã có:

| Bài kiểm | Chặn gì |
|---|---|
| `pnpm lint:parity` | route Mini ↔ web (`route-map.json`) và thành phần Mini ↔ web (`ds-map.json`: file, export, khoá props) |
| `pnpm lint:vars` | biến CSS chưa định nghĩa |
| `packages/app-core/src/terminology.spec.ts` | thuật ngữ cấm trong chữ hiển thị |
| `packages/app-core/src/shop-copy.spec.ts` | chữ mua sắm dính thuật ngữ cấm hoặc vượt ngân sách độ dài |
| `packages/app-core/src/merch/shelves.spec.ts` | luật sổ kệ |
| `apps/miniapp/src/components/ds-shop-guard.spec.ts`, `apps/web/src/components/ds-shop-guard.spec.ts` | thẻ tự chế, giá gạch ngoài `PriceTag`, lề âm ngang tay |
| `apps/miniapp/src/css/contrast.spec.ts` | cặp màu đạt tương phản |
| `apps/miniapp/src/components/ui/hit-target-guard.spec.tsx` | vùng chạm 44px |
| `packages/app-core/src/design-docs.spec.ts` | file này khớp `ds-map.json`, `.gitignore`, skill, `AGENTS.md`, mẫu PR |

Do gói P17b thêm sau khi đợt 4 vào xong (baseline lấy sau đợt 4): bánh cóc số px và lớp `max-md:`, e2e `ds-parity` so số đo 375px Mini ↔ web, axe smoke các màn mua sắm, mở rộng `ds-shop-guard`. Khi có, mục này và bảng Thành phần cập nhật theo.

## Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-10-31 | Q1–Q19 của `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (chữ tiêu đề khối, màu giá, đồng hồ, nhãn, tên nhãn, bán chạy, dung lượng Mini...) | thiết kế gian hàng kiểu Shopee; chủ giao quyền tự chốt |
| 2026-11-01 | Lập `DESIGN.md`, `docs/design/ds-map.json`, `scripts/check-ds-parity.mjs`, skill `tubu-ui`, `terminology.spec.ts` (P17a) | cơ chế giữ khớp cho màn làm sau; mã cũ vi phạm thuật ngữ vào `EXEMPT` thay vì sửa hàng loạt |
| 2026-11-01 | `.gitignore` bỏ qua `.claude/*` (thay vì cả thư mục) kèm `!.claude/skills/` | để skill `tubu-ui` vào git mà thư mục `worktrees` và cấu hình cục bộ trong `.claude` vẫn bị bỏ qua |
