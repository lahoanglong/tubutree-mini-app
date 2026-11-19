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
| `--color-flash-solid-bg`, `--color-flash-solid-fg` | nền và chữ nhãn Giờ vàng đặc; `Badge`, thanh tiến độ và biến thể `flash` của `Button` được dùng (nút "Mua ngay" ở Giờ vàng là chủ ý: cùng màu với nhãn Giờ vàng trên thẻ để khách nối nhãn với nút mua; định nghĩa ở `apps/miniapp/src/components/ui/button.tsx`) |
| `--color-flash-fg` | chữ cam của khối Giờ vàng |
| `--color-countdown-bg`, `--color-countdown-fg` | ô số đồng hồ Giờ vàng (nền tối, chữ sáng) |
| `--color-voucher-bg`, `--color-voucher-fg`, `--color-voucher-edge`, `--color-voucher-stub-bg`, `--color-voucher-stub-fg` | phiếu mã giảm giá |
| `--color-bg-media`, `--color-bg-cover`, `--color-bg-chip`, `--color-track`, `--color-progress-fill-from` | nền ô ảnh, bìa shop chưa có ảnh, chip chưa chọn, rãnh thanh tiến độ, đầu dải màu của phần đã đầy (hai app cùng token) |
| `--tile-w-sm` (128px), `--tile-w-md` (148px) | hai bề rộng thẻ kệ duy nhất |
| `--type-price-tile-size`, `--type-price-tile-lh`, `--type-price-tile-weight` | giá trên thẻ: 16px, 1,25, 700 |
| `--space-block` (16px), `--space-section` (24px) | khoảng giữa hai khối ở màn danh sách và ở màn nội dung |
| `--elevation-nav` | thanh dưới |
| `--sort-bar-top` | chỗ `SortBar` dính; trang có header cố định đặt lại |
| `--dialog-w` (480px) | bề rộng tối đa của sheet web từ md (hộp thoại giữa màn); hai sheet web dùng chung |
| `--color-border-focus` | viền focus của nút |
| `--color-story-ring-from`, `--color-story-ring-to`, `--color-story-ring-seen` | viền vòng Story đầu Trang chủ: chuyển sắc xanh lá → chanh khi chưa xem, xám nhạt khi đã xem trong phiên |

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
| khung chờ thẻ bài đăng của bảng tin | `PostCardSkeleton` (số đo `POST_CARD_SKELETON` ở `packages/app-core/src/community-skeleton.ts`, Mini và web cùng đọc) |
| tim yêu thích | `WishlistHeart` |

Kệ ngang chỉ dùng `rail-sm`, `flash` và `rank` (`--tile-w-sm`, 128px) hoặc `rail-md` (`--tile-w-md`, 148px); `grid` là hai cột. Số đo thân thẻ ở `TILE_METRICS` (`packages/app-core/src/commerce/tile-metrics.ts`), khung chờ đọc cùng chỗ. Hàng cùng kệ chênh đáy giá không quá 1px.

### Câu chuyện sản phẩm

| Cần | Dùng |
|---|---|
| dải kể câu chuyện nguyên liệu ở trang chi tiết (thẻ chia đôi: sân khấu bên trên, mọi chương hiện sẵn dạng thẻ `story-step-card` bấm để chọn; vòng cung biến thể, lắp ghép nguyên liệu, điểm chỉ thành phần). Trang chi tiết web và Mini không có nút hay khung toàn màn hình mở lại cùng nội dung; nút mua nằm ở thanh dưới | `ProductStoryShowcase` |
| dải vòng tròn Story đầu Trang chủ (mỗi vòng mở khung Reel toàn màn của một món Bán chạy nhất) | `StoryReelStrip` (logic chọn món, kịch bản dự phòng, trạng thái đã xem ở `commerce/story-reel.ts`; host `HomeStoryReel` ở `components/home/` mỗi app) |

Cấu hình `ProductStoryConfig` lưu ở cột `Product.storyConfig` (kiểu và `parseStoryConfig` ở `packages/shared-types/src/product-story.ts`). Trang vẽ cấu hình đã lưu, nếu không có thì kịch bản mẫu theo slug (10 sản phẩm ở `story-presets.ts`), nếu không có thì tự sinh từ thành phần (`resolveStoryConfig`, `packages/app-core/src/commerce/product-story.ts`); không có gì để kể thì không vẽ. Nguyên liệu là sprite vector (`story-sprites.ts`), màu qua `--color-story-tone-*`, quầng nền qua `--color-story-ambient-*`. Chữ ở `story.*` của `shop-copy.ts`. Khách bật giảm chuyển động thì vẽ bản tĩnh đủ nội dung. Admin sửa và xem trước ở Story Studio trong ngăn kéo sản phẩm. Khung sân khấu là hình vuông 1:1, xPct/yPct của lớp nguyên liệu và điểm chỉ tính theo khung đó, ảnh sản phẩm lề `STORY_PRODUCT_INSET_PCT` (12%) mỗi cạnh ở Mini, web và Studio (`product-story.spec.ts` canh CSS hai app). Vòng cung chỉ giữ khi nó liệt kê đúng các phân loại đang bán, lệch thì dựng lại từ phân loại thật. Sprite nguyên liệu và quầng chỉ vẽ trên ảnh tách nền (khung `cutout`); ảnh thường không có lớp nào đè lên. Khung toàn màn chỉ còn cho Reel ở Trang chủ, hết hàng thì nút "Thêm vào giỏ" ở đó khoá (`buyDisabled`). Ảnh sân khấu (`cutoutUrl`) trỏ ảnh đã đăng ký của sản phẩm (`/public-image/product/<id>/<số>`) hoặc link https.

Khung Reel là `ProductStoryShowcase` với `fullscreen` và `reel`: thanh đáy chỉ có "Thêm vào giỏ · {giá}" và "Câu chuyện kế" (không có "Mua ngay"), cấu hình lấy từ `resolveReelStoryConfig` (bỏ vòng cung; món không có thành phần, preset hay nhãn chủ lực nhận kịch bản dự phòng chỉ gồm điều có trong dữ liệu sản phẩm: tên, chứng nhận do admin nhập, mô tả ngắn, giao hàng). Món admin đã tắt câu chuyện (`enabled: false`) bị bỏ qua. Dải ẩn khi dưới 3 món.

### Miễn phí giao hàng ở giỏ

| Cần | Dùng |
|---|---|
| thanh tiến độ ở đầu giỏ: "Mua thêm {số} để được Miễn phí giao hàng", đạt thì câu chúc mừng và bỏ thanh | `FreeShippingProgressBar` (số liệu từ `freeshipProgress` ở `commerce/freeship-progress.ts`; vẽ theo phần ĐANG CHỌN, chỉ phần Tubu giao khi giỏ có hàng gian hàng tự giao; `shimmer` tắt khi giảm chuyển động; prop `onShopMore` thêm nút "Mua thêm" cao 44px cạnh dòng chữ khi chưa đạt, đạt rồi thì bỏ nút) |
| nhắc mã sắp mở khoá dưới thanh Miễn phí giao hàng ("Mua thêm {số} để mở khoá mã giảm giá …", thanh đầy dần; truyền `onShopMore` thì cùng hàng có nút "Mua thêm" một chạm về chọn món). Mời áp mã đã đủ điều kiện KHÔNG nằm ở dải này: nút "Áp dụng" một chạm là nút cuối của hàng "Mã giảm giá" ở chân dính (thay "Chọn mã ›" khi có mã chưa áp), mỗi hành động một nút | `CartVoucherHintStrip` (mã và số do `cartVoucherHint` ở `commerce/cart-voucher-hint.ts` quyết, chỉ dùng số của máy chủ: `discount` của xem trước và `shortfall`; chỉ nhắc khi còn thiếu không quá 100.000đ; giỏ đã có mã thì không vẽ; mỗi nền tảng có hook `useCartVoucherHint` riêng, cùng đầu vào, cùng kết quả) |
| dải 2–4 món nhỏ mua thêm ở đầu Giỏ nhắm mốc kế tiếp (Miễn phí giao hàng, rồi quà dùng thử 0đ), nút "+ Thêm" một chạm | `FreeshipAddonRail` (tubu-w7-02: mốc, dòng đầu và món ở `packages/app-core/src/cart/aov-upsell.ts`. `aovUpsellGoal` chọn mốc: chưa Miễn phí giao hàng thì nhắm `freeshipThreshold` của giỏ, đạt rồi thì nhắm quà dùng thử 0đ đầu tiên (`giftTrial.minOrder`, khoá `commerce.gift_trial_min_order`), không ghi cứng 199.000đ/299.000đ; khách đã chọn không nhận quà hay không có khối quà thì hết dải. Dòng đầu là prop `title`: mốc giao hàng dùng `freeship.addonsTitle` không số vì thanh tiến độ ngay trên đã nói "Mua thêm {số} để được Miễn phí giao hàng"; mốc quà dùng `aov.giftLine` "Thêm {số} nữa để nhận quà dùng thử 0đ" (bản `aov.giftLineTubu` khi giỏ có hàng gian hàng tự giao), số đều `tabular-nums`; prop `stage` ghi `data-stage`; `onShownChange` báo Giỏ dải còn chờ nguồn, đang hiện hay không, `aovGiftLockedRowShown` quyết dòng quà khoá; món quà cũng gửi vào `exclude` của `GET /upsell/freeship`. `pickAovAddons`: còn hàng, Tubu giao, chưa có trong giỏ, không phải món quà 0đ, giá không quá 120.000đ (`FREESHIP_UPSELL_MAX_PRICE`, máy chủ cắt cùng số) và không quá số còn thiếu + cửa sổ; món bù đủ trước (rẻ trước, hay giữ thứ tự máy chủ), rồi món gần đủ (đắt trước); tối đa 4, dưới 2 thì ẩn. Mini dùng `FreeshipBoosterRail`, web `FreeshipAddons` + `useFreeshipBoosterCards` (phần vẽ và thêm món `FreeshipAddonsView` là chunk tải sau, ngoài JS tải đầu của Giỏ; hook nguồn món và giá thẻ ở lại chunk đầu vì dùng chung với Trang chủ): cờ `commerce.freeship_booster_enabled` bật thì món từ `GET /upsell/freeship?gap=` (số còn thiếu của mốc đang nhắm, cửa sổ 45.000đ, bán chạy trước), tắt hay lỗi thì kệ Bán chạy nhất (cửa sổ 25.000đ). `pickFreeshipAddons` cũ chỉ còn cho nơi khác |
| vừa đạt Miễn phí giao hàng hoặc vừa lên bậc Hộp Xanh: dải đầu giỏ nảy nhẹ một lần, toả vòng sáng màu thành công | `CartUnlockSlot` bọc dải tiến độ (mức từ `cartUnlockLevel`, chỉ mừng khi mức vượt mức cao nhất đã thấy, `shouldCelebrateUnlock`; tắt sau `UNLOCK_CELEBRATE_MS`; lần vẽ đầu và tụt rồi lên lại không mừng; CSS `.tubu-unlock` chỉ đổi `transform` và `box-shadow` nên không xô bố cục, tắt khi giảm chuyển động) |

### Mua lại và mua kèm một chạm

| Cần | Dùng |
|---|---|
| dải "Mua lại món quen" ở Trang chủ: tối đa 6 thẻ ngang (ảnh vuông 128, tên một dòng, giá, "+ Thêm" một chạm) và nút "Thêm lại tất cả" | `QuickReorderStrip` (logic ở `commerce/quick-reorder.ts`: `buildQuickReorderItems` chọn món còn hàng, áp Giờ vàng đang chạy, tính phần trăm tiết kiệm và số lần đã đặt; host là `PurchasedRail` nhánh Trang chủ) |
| khối "Gợi ý mua kèm hợp vị" ở trang chi tiết: món đang xem + 2 món bổ trợ tick chọn, nút "Thêm n món vào giỏ · tổng" | `FrequentlyBoughtTogether` (logic ở `commerce/frequently-bought.ts`: `pickFbtPartners`, `buildFrequentlyBoughtBundle`, `frequentlyBoughtSummary`, `frequentlyBoughtLines`; nguồn món là dải "Khách thường mua cùng" của API, không có nguồn riêng) |
| dải cam kết ở trang chi tiết, ngay dưới chọn phân loại và Số lượng: ba trụ cột ngắn (Nguồn gốc rõ ràng, Giao hàng cẩn thận, Đổi trả dễ dàng) và lối xem chính sách | `ProductTrustStrip` (chữ, số trụ cột và đích lối xem do `productTrustStrip` ở `commerce/product-trust-strip.ts` quyết; chỉ hàng Tubu giao, gian hàng tự giao hay tạm nghỉ thì không vẽ; đổi trả tắt (`returns.window_days` = 0) thì bỏ trụ đổi trả và lối xem chuyển sang chính sách vận chuyển; lối xem là `<button>` mở `PolicySheet` ở Mini, `<a href="/chinh-sach/…">` ở web; không hứa chứng nhận hữu cơ hay giờ giao) |

`QuickReorderStrip` là cách vẽ của kệ `home.purchased` (cùng kệ, cùng hạng chống trùng, không thêm kệ thứ 5): khách cũ có từ 2 món còn hàng thì thấy dải, một món thì vẫn là dòng Mua lại 88px, tab Đơn hàng giữ `PurchasedRail` cũ (hai chạm qua `ReorderSheet`, vì ở đó khách chọn số lượng và Định kỳ). Giá ra qua `rebuyPricing` như dòng Mua lại, và hết suất Giờ vàng của khách (`flashAllowance` = 0) thì ghi giá thường vì giỏ tính giá thường. Hàm `buildQuickReorderItems` còn nhận món vừa xem cho khách chưa có đơn nhưng Trang chủ chưa nối nguồn đó (khối `purchased` không có ở bố cục khách mới; đổi thì phải đổi `homeBlockOrder` và khung chờ).

`FrequentlyBoughtTogether` nằm dưới thông tin chính và trên khối Combo/Mua kèm giá tốt; mặc định chọn hết, mỗi món một đơn vị, thêm theo lô tất cả-hoặc-không (`useBundleAdd`). Hai món bổ trợ chiếm chỗ của dải "Khách thường mua cùng" bên dưới (`pdpShelves({ claimed })`), nên dải đó có thể xuống dưới sàn 3 món và ẩn. Không có khuyến mãi riêng của bộ: số "Tiết kiệm" chỉ là phần Giờ vàng và giá bán đã giảm của từng món.

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
| bảng chọn mã ở giỏ và thanh toán (Mini và web dưới `md`: sheet; web từ `md`: panel tại chỗ) | `VoucherPicker` (mỗi mã một `VoucherTicket` hàng; thứ tự, nhãn nút Dùng / Bỏ chọn / Chưa đủ / Không áp dụng và lý do do `pickerRows` ở app-core; phiếu không dùng được không làm mờ cả thẻ) |
| combo "Mua cả bộ" | `ComboCard` |
| các món cùng một combo ở giỏ, dưới đầu nhóm "Combo: {tên} · Tiết kiệm {số}" | `CartComboBlock` (chia khối ở `packages/app-core/src/commerce/cart-combo.ts`, chữ ở `cart.combo*` của shop-copy; điện thoại là khối nền `--color-bg-subtle` bo đồng tâm, từ md bỏ nền, đầu nhóm là dải nền dịu và vạch dọc 4px `--color-border-strong` bên trái chạy hết khối để thấy bộ kết thúc ở đâu (vạch là phần tử giả vẽ đè lên lề, không chiếm chỗ nên ô chọn thẳng cột với dòng lẻ); sản phẩm chính của "mua kèm" cũng nằm trong khối; số Tiết kiệm màu `--color-text-price-deal`, bỏ chọn món thì theo giá phần chọn của máy chủ) |
| hộp hỏi một bước thay `window.confirm` (xoá món làm combo mất giảm) | `ConfirmSheet` (Mini `components/ui`, web dựng từ `Sheet`; nút xác nhận không ghi "Xoá" để khỏi lặp nhãn thùng rác) |
| banner chiến dịch | `BannerCarousel` (nút dừng, tôn trọng giảm chuyển động, từ 5 giây mỗi ảnh) |
| khối cần tài khoản khi chưa đăng nhập (Ưu đãi: Điểm Xanh và điểm danh, Mã của tôi) | `GuestLinkCard` (mỗi khối một thẻ, một nhãn nút "Đăng nhập" từ `login.cta`; Mini dùng lại thẻ mời liên kết Zalo cho tài khoản khách) |

### Trang shop

`ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection` (vẽ theo `layout` của bộ sưu tập: kệ ≤10, lưới ≤6, dòng ≤5, combo), `TierBadge` (ẩn bậc thấp nhất).

### Theo dõi đơn hàng

| Cần | Dùng |
|---|---|
| đầu trang đơn: trạng thái, một câu, lý do huỷ (đơn huỷ, nguyên văn từ `cancelReason` của API), mốc (ngày giao, hạn trả, hạn đổi/trả), bước kế tiếp | `OrderStatusHero` (chữ từ `orderHeadline` của `packages/app-core/src/commerce/order-tracking.ts`) |
| hành trình 5 bước có giờ thật, bước hiện tại `aria-current="step"`, mốc hãng gộp dưới "Đang giao" mới nhất trên cùng; chỉ vẽ khi `trackAddsDetail` đúng (đơn còn đang đi, hoặc đã giao mà hãng để lại mốc), vì đơn giao xong không có mốc hãng thì chỉ lặp lại thanh 4 bước ngay trên | `OrderTrack` (dữ liệu từ `orderTrack`) |
| thanh tiến trình gọn 4 bước (Đã tiếp nhận, Đang chuẩn bị, Đang giao hàng, Hoàn tất; đơn huỷ hoặc hoàn trả rẽ nhánh), bước hiện tại `aria-current="step"` có viền sáng nhẹ (giảm chuyển động thì đứng yên), giờ số đều, nút "Sao chép thông tin đơn" | `OrderTimelineTracker` (dữ liệu từ `buildOrderTimelineSteps`, chữ tóm tắt từ `formatOrderShareSummary`, cả hai ở `packages/app-core/src/commerce/order-timeline.ts`) |
| hãng vận chuyển, mã vận đơn, nút "Chép mã" | `OrderShipping` |
| thanh nút của đơn: đúng một nút chính theo trạng thái, việc còn lại vào "Thêm thao tác" | `OrderActionBar` (kế hoạch từ `orderActionPlan`; điều kiện từng nút lấy từ cờ API, không đoán) |

Máy tính (từ `lg`): hai cột gọn ở `/tai-khoan/don-hang/:code`, trái trạng thái + hành trình + vận chuyển + sản phẩm, phải tiền + địa chỉ + nút.

### Màn dựng gian hàng (CTV)

| Cần | Dùng |
|---|---|
| một khối của gian hàng ở `/storefront` (tên, kiểu, x/y món, dải ảnh, cảnh báo vượt ngân sách) | `SectionCard` |
| chọn kiểu khối: Lưới / Kệ ngang / Danh sách / Combo | `LayoutPicker` |

### Chia sẻ nhanh của CTV (W43B)

| Cần | Dùng |
|---|---|
| khối "Sản phẩm hoa hồng nổi bật" ở tab Chia sẻ của CTV: mỗi sản phẩm một dòng có mức % và số tiền dự kiến mỗi đơn, nút "Chép link giới thiệu" (≥ 44px, chép lời giới thiệu kèm link `?ref=<mã CTV>`, 2 giây thành "Đã chép link"), có trạng thái chờ, rỗng, lỗi + "Thử lại" | `AffiliateFeaturedProducts` (danh sách và link từ `featuredAffiliateProducts` và `buildAffiliateShareUrl` ở `packages/app-core/src/commerce/affiliate-share.ts`) |

### Thành phần nền

`Badge`, `Button`, `Card`, `Chip`, `Icon`, `IconButton`, `ListRow`, `KeyValueRow`, `ProgressBar`, `QuantitySelector`, `SearchField`, `StickyActionBar`, `Text`, `Heading`, `Timeline`, `StatTile`, `BottomSheet`, `EmptyState`, `BackButton`.

### Xem ảnh đánh giá và chọn địa giới (W42B)

`ReviewMediaLightbox` (Mini + web): ảnh/video đánh giá toàn màn hình, nền `--color-bg-lightbox` làm mờ, mở 220ms theo đường cong drawer (cùng tấm đáy), bộ đếm `n / N` số đều, nút Trước/Sau và × ≥ 44px, vuốt ngang, nút back đóng. `AddressLocationSheet` (chỉ web; Mini đã có trong `geo-picker.tsx`): sheet tìm không dấu cho Tỉnh/Thành phố và Phường/Xã, dòng ≥ 44px, chọn tỉnh xong tự mở Phường/Xã. Thêm giỏ: `playCartFeedback` (chấm bay 420ms tới `[data-cart-target]`) và huy hiệu giỏ nảy `.cart-badge-bump` 220ms; giảm chuyển động thì bỏ cả hai.

### Mini-game và Chẩn đoán tổ ấm (W164)

| Cần | Dùng |
|---|---|
| sảnh hai mini-game ở Vườn Xanh (`Hứng Sương Tinh Khiết`, `Phân Loại Vỏ Chai Thần Tốc`) kèm huy hiệu khung giờ thưởng và kỷ lục cá nhân | `ArcadeHub` (không props, tự giữ trạng thái mở lớp phủ; lượt dùng hôm nay từ `gameArcadeStatusQuery`) |
| lớp phủ toàn màn chơi một ván, bảng kết quả, Tip Sạch Lành, nút đăng nhập cho khách | `ArcadeGameOverlay` (`gameId`, `onClose`; không có route, canvas dựng bằng `mountArcade`, tải bằng `import()` động) |
| thẻ "Chọn bộ chăm nhà chuẩn cho gia đình bạn (30 giây)": 3 câu, gợi ý 2–3 sản phẩm thật, "+ Thêm vào giỏ" | `HomeQuizCard` (ở Vườn Xanh và khối `quiz` của Trang chủ, sau `journey`) |

Logic ở `packages/app-core/src/arcade/`: engine thuần không DOM (`dew-catcher.ts`, `refill-rush.ts`, toạ độ chuẩn hoá 0..1, `rng` tiêm vào để test), bộ vẽ và nhập liệu `arcade-canvas.ts` (nhận canvas qua giao diện cấu trúc tối thiểu, `raf/caf/now` tiêm vào, màu qua `theme` do app đọc từ token ngữ nghĩa nên không có hex), khung giờ thưởng giờ VN `arcade-config.ts`, `badge.ts`, `home-quiz.ts` (`pickKitProducts`), tip `arcade-tips.ts`. Tổng mã `arcade/` (không tính spec) dưới 30KB, `arcade-guard.spec` canh. Số liệu thưởng và trần chống cày ở máy chủ (`game-arcade.constants.ts`, `POST /game/arcade-complete`): 3 lượt thưởng mỗi ngày mỗi game, thêm 1 lượt khi ván xong trong khung `06:30–09:00` hoặc `20:00–22:00` giờ VN; hết lượt vẫn chơi và phá kỷ lục. Khách chưa đăng nhập chơi trọn vẹn, chỉ không lưu và không nhận thưởng. Chữ ở `arcade.*` và `homeQuiz.*` của `shop-copy.ts`. Hai câu hứa sản phẩm trong Tip (Bồ Hòn 0% Paraben & SLS; giữ vỏ chai TubuTree đổi Điểm Xanh & Quà tặng) là nguyên văn spec W164, các câu khác chỉ là lời khuyên sống xanh.

### Góc Sống Xanh: đánh giá ảnh có duyệt (tubu-w3-01)

| Cần | Dùng |
|---|---|
| dải "Khách hàng sống xanh cùng Tubu Tree" ở Trang chủ: tối đa 8 thẻ ảnh thật đã duyệt (mỗi sản phẩm một thẻ), 5 sao, dòng thẻ cảm nhận, 2 dòng nhận xét, tên sản phẩm; chạm thẻ mở trang sản phẩm | `GreenCornerStrip` (đứng ở chỗ thẻ Cộng đồng trong lưới Gợi ý, cùng ngày, không thêm khối; `fallback` là thẻ Cộng đồng khi cờ `reviews.green_corner_enabled` tắt, đang tải, API lỗi hay dưới 3 thẻ (không có khung chờ riêng, để chỗ đó không co giãn mỗi lần mở Trang chủ); thẻ cố định 148 × 252 trong `.tubu-green-*` ở `css/tokens.css` và `mini.css` nên từ 360 tới 1440px chỉ đổi số thẻ thấy được trong `ScrollRow`) |

Logic ở `packages/app-core/src/commerce/green-corner.ts` (`greenCornerCards`, thẻ cảm nhận `ECO_TAG_OPTIONS`, `toggleEcoTag` tối đa 3) và `review-copy.ts` (`greenCornerHint`, `pendingNotice`). Form đánh giá dùng `Chip` sẵn có cho thẻ cảm nhận; bộ lọc "Có ảnh" ở trang sản phẩm vẫn là chip của `reviewFilterChips`, thêm số đếm `photoCount` từ máy chủ. Ảnh của đánh giá chờ duyệt không có đường công khai; admin bấm Duyệt hay Hiện lại gửi kèm `mediaKey` của dòng đang xem, khách đổi ảnh sau đó thì máy chủ trả 409.

### Quà tặng dùng thử 0đ và Giờ Xanh Ưu Đãi (tubu-w3-06)

| Cần | Dùng |
|---|---|
| dòng quà tặng dùng thử 0đ theo mốc ở Giỏ (chưa đủ mốc: "Thêm {số} để nhận quà dùng thử 0đ", không nút) và Thanh toán (chỉ khi đã mở quà); nút chữ "Đổi"/"Chọn quà" mở tấm "Chọn quà tặng 0đ" (quà theo mốc, quà chưa mở mờ kèm "Đơn từ {số}", hàng cuối "Không nhận quà") | `GiftTrialRow` (`components/checkout/gift-rows.tsx` mỗi app, dưới `GiftNote`/`GiftRows`; không thêm dải hay thanh tiến độ thứ hai ở đầu giỏ) |
| khối Giờ vàng dạng "Giờ Xanh Ưu Đãi" ở Trang chủ và Ưu đãi (cờ `flashsale.green_hour_enabled`) | `FlashSale`/`OffersFlash` có sẵn: `SectionHeader` icon `leaf` tông mặc định, `FlashSoldBar tone="green"`, `Countdown tone="green"` (chữ và dấu ":" màu `--color-text-brand`, ô số giữ nền tối), nút ＋ `QuickAddButton` trên ảnh thẻ qua `ProductCardQuickAddContext`; cùng chiều cao, cùng đồng hồ. Nhãn "-x%" trên ảnh và giá giữ màu ưu đãi chung của thẻ |

Logic ở `packages/app-core/src/commerce/gift-trial.ts` (`giftTrialRowView`, `giftTrialSheetView`, `giftTrialPlaceField`, `isGiftTrialError`) và `commerce/green-hour.ts` (`flashBlockLook`, `greenHourCanQuickAdd`). Máy chủ quyết quà nào mở và quà nào đang chọn (`giftTrial` của giỏ và báo giá); app chỉ vẽ. Chữ ở `giftTrial.*` và `greenHour.title` của `shop-copy.ts`.

### Trang chi tiết giúp chốt: giá theo đơn vị, ngày nhận, còn thiếu để miễn phí giao (tubu-w4-02)

| Cần | Dùng |
|---|---|
| dòng "≈ 12.300đ / 100ml" ngay dưới giá trang chi tiết (cờ `catalog.unit_price_enabled`) | `UnitPriceLine` (Mini `components/pdp-decision/`, web `components/pdp-decision/` bọc trong `PdpUnitPrice` đọc phân loại đang chọn); chip phân loại và bảng chọn nhận `unit`/`better` của `VariationChip`: thêm đúng một dòng phụ, nhãn "Lợi hơn …" nằm cùng dòng |
| "Nhận dự kiến 20/11 – 24/11" và câu còn thiếu để miễn phí giao trong khối "Vận chuyển ›" (cờ `shipping.pdp_eta_enabled`) | Mini thêm dòng vào `shippingLines` của trang; web `PdpShipDecision` bọc câu tĩnh `PdpFreeship` (cờ tắt thì vẽ đúng câu cũ; cờ bật thì HTML giữ chỗ dòng ngày bằng chính câu đó tính ở một ngày cố định, ẩn, để bề ngang bằng chữ thật; câu còn thiếu thay câu tĩnh sau hydrate, từ md xuống hàng riêng; hàng gian hàng có ngưỡng giữ sẵn một dòng ẩn, Mini cũng vậy) |

Logic ở `packages/app-core/src/commerce/unit-price.ts` (`parseNetAmount` không đoán: mọi phân loại phải đọc được lượng cùng một chiều, `unitPriceView`, `variationUnitPrices`) và `commerce/pdp-view.ts` (`pdpEtaText` gọi đúng `checkoutEtaLabel` của thanh toán, `pdpFreeshipGap` cùng luật thanh tiến độ ở giỏ: ngưỡng máy chủ tính cho chính khách, dòng hết hàng không cộng, hàng gian hàng tự giao theo `freeShipFrom` của gian hàng). Ảnh chụp tên phân loại PROD ở `commerce/prod-variations.fixture.ts` là bảng kiểm của bộ đọc lượng.

### Nhiệm vụ hằng ngày, huy hiệu, chấm nhắc thanh đáy

| Cần | Dùng |
|---|---|
| 3 nhiệm vụ trong ngày (mỗi việc +5 💧, xong cả 3 thêm Điểm Xanh) đứng đầu thẻ Nhiệm vụ ở Vườn Xanh; nhiệm vụ một lần thu lại sau một nút | `MissionsCard` (tự tải `GET /game/daily`; cờ `engagement.daily_missions_enabled` tắt hay API cũ thì thẻ như trước) |
| hàng huy hiệu cuộn ngang ở Cá nhân (một thẻ, "n/8", đã đạt đứng trước, chưa đạt mờ kèm biểu tượng khoá, chạm thì báo điều kiện) | `BadgeRow` (không props; cờ `engagement.badges_enabled` bật thì thay dòng "Câu chuyện thương hiệu" trong menu) |
| chấm nhắc 8px ở tab Vườn Xanh (chưa chơi Đố Xanh hoặc chưa điểm danh) và tab Cá nhân (có thông báo chưa đọc, nhường số đơn đang xử lý) | `RemindDot` trong `BottomNav` của mỗi app; đứng yên, không nhấp nháy, nghĩa nằm ở `aria-label` của tab (`nav.gardenDot`, `nav.profileDot`) |

Logic ở `packages/app-core/src/engagement/` (`api.ts` đọc và kiểm dạng phản hồi, `view.ts` dựng dòng, chữ, chấm; mã thiết bị dùng chung `miniDeviceId` của `game-mini/api.ts`); chữ ở `daily.*`, `badges.*`, `nav.*Dot` của `shop-copy.ts`. Điểm danh chỉ nhắc một chỗ: khi chấm Vườn Xanh bật, tab Ưu đãi bỏ lý do "chưa điểm danh", chỉ còn mã sắp hết hạn. Trên web khổ điện thoại, chuông ở đầu Trang chủ (`home-header.tsx`) như Mini App; chấm tab Cá nhân báo thông báo chưa đọc ở mọi màn gốc nên không thêm chuông thứ hai vào thanh đầu trang.

### Khuôn trang web (chỉ web)

`HubLayout`, `ListingLayout`, `PdpLayout`, `StoreLayout` ở `apps/web/src/components/layouts/`. Chi tiết ở mục Khuôn trang web máy tính. `HomeEditorialHero` (`apps/web/src/components/home/`, chỉ web): khối giới thiệu mặc định của Trang chủ từ md khi không có banner chiến dịch, đứng ở slot `hero` của `HubLayout` (cùng tỉ lệ `--banner-ratio` nên chiến dịch về muộn không làm trang nhảy; điện thoại ẩn hẳn, chữ ở `homeCopy.hero`).

## Sắp có (đợt 4b/4c)

Thành phần chưa có đủ ở cả hai app, tên theo `docs/2026-10-31-shop-redesign/02-ke-hoach.md`, nên chưa nằm ở mục Thành phần. Gói nào làm xong thì chuyển dòng từ `upcoming` sang `components` của `docs/design/ds-map.json` và sang mục Thành phần; `packages/app-core/src/design-docs.spec.ts` đỏ nếu một dòng `upcoming` đã có `export` ở cả hai app mà chưa chuyển.

| Tên | Gói | Đợt | Là gì |
|---|---|---|---|
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
| `home.purchased` | rail | 6 / 1 | 2 | `/orders` |
| `home.combos` | rail | 4 / 2 | 3 | không |
| `home.bestSellers` | rail | 10 / 3 | 4 | `/best-sellers` |
| `home.suggest` | feed | 100 / 4 | 6 | `/browse` |

Thứ tự khối Trang chủ cho khách cũ: header dính → thẻ thành viên → việc cần làm → banner → lối tắt → dải Story (`stories`, không tính vào 4 kệ hàng) → Giờ vàng → Mua lại → danh mục → Bán chạy nhất → combo → hành trình → cộng đồng → Gợi ý hôm nay. Khách mới: `welcome` thay thẻ thành viên, không có Mua lại.

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

Nhãn đặt trên ô nhập (`Field`, địa chỉ, hoá đơn VAT, hồ sơ, đổi trả, ô nhập mã giảm giá) dùng bậc riêng `--type-field-label-*`: 12px, dòng 1,33, độ đậm 500 (Mini: `<Text variant="field-label">`; web: lớp `text-field-label`, `apps/web/src/field-label-style.spec.ts` quét các file có nhãn ô nhập). Bậc `--type-label-*` (12px, 600) chỉ dành cho chip, huy hiệu và nhãn nhỏ trên thẻ, không dùng cho nhãn ô nhập.

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
| Chỉ còn (trừ đúng câu "Chỉ còn {n} sản phẩm" của `stockText` khi tồn 1–20; "Chỉ còn n suất" vẫn cấm) | Còn {n} sản phẩm |
| Vui lòng, chúng tôi | Bạn hoặc Tubu |
| cửa hàng | Gian hàng |
| ba dấu chấm `...` | … (một ký tự) |
| `2h 05m`, `2h 5m` (mọi dạng `\d+h \d+m`) | countdownText, ví dụ "2 giờ 05 phút" |
| HOT, SỐC, Nhanh tay | bỏ chữ giục mua |

`packages/app-core/src/terminology.spec.ts` quét chữ hiển thị (cây cú pháp, không quét comment, tên biến, `className`, đường dẫn import; xuống dòng và thụt lề trong JSX gộp thành một dấu cách như khách đọc) của `apps/miniapp/src`, `apps/web/src` và `packages/app-core/src`, trừ quản trị, cùng các file API trả chữ cho khách (`*-notice.ts`, `*-notice.service.ts`, `*-price.ts`, `*-price.service.ts`, `cart/cart.batch-error.ts` và `cart/cart.stock-message.ts` trong `apps/api/src/modules`; service lớn lẫn chữ quản trị và log không quét cả file, nên câu khách đọc phải nằm ở một file đuôi `*-notice.ts` như `flash-sale/flash-sale-notice.ts` của Giờ vàng; thêm file API mới chỉ chứa chữ cho khách thì thêm vào `API_COPY_EXTRA` của spec). Riêng "Vui lòng" và "chúng tôi" bị quét ở MỌI file `apps/api/src/**/*.ts` trừ `*.spec.ts`, không phân biệt hoa thường và kể cả thư mục `admin/`, để hai chữ này không quay lại API (lỗi nghiệp vụ, chữ quản trị, tin nhắn); văn bản pháp lý nếu có trong API thì miễn bằng `API_VOICE_EXEMPT` của spec, mỗi dòng có lý do và `max` bằng đúng số chỗ (hiện rỗng). Các thuật ngữ cấm khác vẫn chỉ quét file chữ khách đọc. Mọi đoạn của chuỗi template (đầu, giữa, cuối) có từ ASCII đứng riêng, kể cả chữ hoa viết tắt sau dấu câu hay ngoặc (`HSD ${d}`, `(HSD ${d})`, `${n} HOT!`, `${n}, HSD.`) và từ viết thường (`${n} voucher`, `${n} freeship`, `${n} flash sale`), và mẫu `SỐC` không phân biệt hoa thường cũng bị bắt; mã định danh dính ký tự mã (`FREESHIP-${id}`, `${a}-FREESHIP`, `${base}/HOT/${id}`, `HOT_${x}`) thì không. Địa chỉ đầy đủ (`https://…/vouchers/${id}`) và giá trị truy vấn trong đường dẫn (`?tab=HOT`, `&sort=hot`) là mã gửi cho máy chủ nên không bị coi là chữ khách đọc. Mã cũ đang vi phạm nằm trong danh sách `EXEMPT` của spec, mỗi dòng có lý do và `max` bằng đúng số chỗ hiện có: thêm chỗ mới vào file đã miễn thì đỏ, sửa bớt mà không hạ `max` cũng đỏ ("hạ max xuống n"), sạch hẳn thì phải xoá dòng. Gói nào đổi hoặc bỏ chữ cũ ở file đã miễn chạy lại spec này và chỉnh `EXEMPT` ngay trong PR của mình; hai gói song song cùng đụng một file thì gói vào `main` sau chạy lại spec sau khi rebase.

Thẻ "Sắp diễn ra" của khối Giờ vàng Trang chủ hai app đọc chữ đếm ngược qua `useCountdown`, nay trả `countdownText` ("2 giờ 05 phút"); `formatCountdown` (chữ cũ "2h 05m") đã xoá và spec có ca chặn nó quay lại.

## Khuôn trang web máy tính

Mỗi trang mua sắm trên web dùng một khuôn trong `apps/web/src/components/layouts/`. Khuôn chỉ lo lưới từ `lg` (cột, độ rộng tối đa, vùng dính); dưới `md` trả nguyên con để khổ điện thoại giống Mini. Cột dính chỉ từ `lg` và chỉ ở ba chỗ: ô ảnh của `PdpLayout` (chỉ khi khung nhìn cao từ 48rem, thấp hơn thì không dính kẻo cắt đáy ảnh), khung "Đơn hàng" ở Giỏ hàng `/gio-hang` (`data-testid="cart-summary"`) và Thanh toán `/thanh-toan` (kèm nút đặt hàng dính đáy cột tóm tắt), cột trái cổng nhân viên (`staffLayout`); mọi chỗ dính đặt `top` theo biến chiều cao header. Dưới `lg` không có gì dính, các khối xếp dọc như Mini. Không vùng cuộn riêng bên trong trang.

| Khuôn | Trang | Slot |
|---|---|---|
| `HubLayout` | Trang chủ | `hero?`, `banner?`, `aside`, `children` (lưới 12 cột: banner hoặc `hero` 8 cột + `aside` 4 cột; `hero` chỉ từ md) |
| `ListingLayout` | Danh mục `/san-pham` | `breadcrumb?`, `title`, `caption?`, `toolbar?`, `sidebar?`, `children` (cột lọc 200px) |
| `PdpLayout` | chi tiết sản phẩm | `gallery`, `info`, `below`, `aside?` (từ `lg` ảnh 440px và thông tin trong một thẻ; ô ảnh dính dưới header khi khung nhìn cao từ 48rem, cột thông tin cuộn cùng trang; nút mua trong màn 1280×800) |
| `StoreLayout` | `/s/[slug]`, `/brand/[slug]` | `header`, `stats?`, `intro?`, `tabs?`, `children` |

Chân trang web ở 375px khác Mini là chủ ý: Mini App không có chân trang, web giữ chân trang `apps/web/src/components/site-footer.tsx` với các liên kết pháp lý (`apps/web/src/lib/legal.ts`) và dòng đơn vị vận hành, nên màn web dài hơn Mini ở cuối trang. Khi so ảnh 375px Mini ↔ web, bỏ qua phần chân trang này; không gỡ để cho giống.

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

| Bài kiểm | Chặn gì |
|---|---|
| `pnpm lint:parity` | route Mini ↔ web (`route-map.json`) và thành phần Mini ↔ web (`ds-map.json`: file, export, khoá props của mọi thành phần: đọc từ kiểu khai ở `props`, hoặc từ kiểu tham số đầu của hàm; lệch phải khai `propsDiff` kèm lý do, kiểu nằm ngoài file thì `propsUncompared` kèm lý do); nối thêm bánh cóc ở dòng kế |
| `scripts/uiux/ds-ratchet.mjs` (chạy trong `pnpm lint:parity`) | bánh cóc số px viết tay (n > 1, trong chuỗi, mẫu chuỗi và thuộc tính style số) và lớp `max-md:` của mã giao diện hai app so với `scripts/uiux/ds-baseline.json`: số tăng thì đỏ, file mới phải bằng 0, số giảm thì nhắc hạ baseline (thêm cờ strict thì đỏ) |
| `pnpm lint:vars` | biến CSS chưa định nghĩa |
| `packages/app-core/src/terminology.spec.ts` | thuật ngữ cấm trong chữ hiển thị của Mini, web và chữ dùng chung ở `packages/app-core/src` |
| `packages/app-core/src/shop-copy.spec.ts` | chữ mua sắm dính thuật ngữ cấm hoặc vượt ngân sách độ dài |
| `packages/app-core/src/merch/shelves.spec.ts` | luật sổ kệ |
| `apps/miniapp/src/components/ds-shop-guard.spec.ts`, `apps/web/src/components/ds-shop-guard.spec.ts` | thẻ tự chế, giá gạch ngoài `PriceTag`, lề âm ngang tay, primitive màu (`--forest-*`, `bg-stone-*`...) ở trang mua sắm, `Text` của zmp-ui ở trang mua sắm Mini, `openSnackbar` gọi thẳng (đi qua `useNotify`), `shadow-[var(--x)]` ở web (Tailwind đọc là màu bóng, phần tử mất bóng; viết `[box-shadow:var(--x)]`). Luật ở `scripts/uiux/ds-shop-rules.mjs`, mã cũ vi phạm ở mục `guards` của baseline |
| `apps/e2e/tests/ds-parity.shop.spec.ts` | số đo computed 375px của thẻ (flash, line, grid), tiêu đề khối và giá so với bảng chuẩn `apps/e2e/tests/support/ds-parity.ts`. Mỗi project (Mini, web) đo trang của mình rồi so với cùng bảng, không so hai server trực tiếp vì `playwright.config.ts` tách server theo scope và CI chạy hai project song song; web chỉ đo trang chạy hoàn toàn bằng mock phía trình duyệt (Ưu đãi, Giờ vàng, Yêu thích) |
| `apps/e2e/tests/a11y-shop.miniapp.spec.ts`, `apps/e2e/tests/a11y-shop.web.spec.ts` | axe WCAG AA ở 375px bảy màn mua sắm (Trang chủ, Danh mục, chi tiết sản phẩm, gian hàng, thương hiệu, Ưu đãi, Giờ vàng); chỉ `serious`/`critical` chặn, không tắt luật. Vi phạm có sẵn ghi ở `apps/e2e/tests/support/a11y-baseline.ts` kèm lý do (hiện rỗng). Web: chi tiết sản phẩm, gian hàng, thương hiệu do máy chủ dựng từ API thật, nên `support/a11y-db.ts` bảo đảm DB tạm (web-gate.sh, job CI) có nhãn công khai và gian hàng mẫu và ở đó trang 404 là lỗi, chỉ DB không phải DB tạm mới bỏ qua kèm lý do; Danh mục web đo cả hub lẫn danh sách; Trang chủ, Danh mục (danh sách) đợi thẻ sản phẩm dựng xong, Ưu đãi đợi nút "Lưu mã" |
| `apps/miniapp/src/css/contrast.spec.ts` | cặp màu đạt tương phản |
| `apps/miniapp/src/components/ui/hit-target-guard.spec.tsx` | vùng chạm 44px |
| `packages/app-core/src/design-docs.spec.ts` | file này khớp `ds-map.json`, `.gitignore`, skill, `AGENTS.md`, mẫu PR |

Baseline chỉ được giảm. Đỏ vì bánh cóc hoặc `ds-shop-guard` thì sửa mã (dùng token, `Text`, `PriceTag`, `useNotify`), không nới baseline. Sửa bớt mã cũ xong chạy `node scripts/uiux/ds-ratchet.mjs --write` để hạ baseline. Gộp nhiều nhánh làm song song thì chạy lại lệnh đó trên nhánh gộp: số baseline là số đếm của cây hiện tại, không cộng tay.

## Nhật ký quyết định

| Ngày | Quyết định | Lý do |
|---|---|---|
| 2026-10-31 | Q1–Q19 của `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (chữ tiêu đề khối, màu giá, đồng hồ, nhãn, tên nhãn, bán chạy, dung lượng Mini...) | thiết kế gian hàng kiểu Shopee; chủ giao quyền tự chốt |
| 2026-11-01 | Lập `DESIGN.md`, `docs/design/ds-map.json`, `scripts/check-ds-parity.mjs`, skill `tubu-ui`, `terminology.spec.ts` (P17a) | cơ chế giữ khớp cho màn làm sau; mã cũ vi phạm thuật ngữ vào `EXEMPT` thay vì sửa hàng loạt |
| 2026-11-01 | `.gitignore` bỏ qua `.claude/*` (thay vì cả thư mục) kèm `!.claude/skills/` | để skill `tubu-ui` vào git mà thư mục `worktrees` và cấu hình cục bộ trong `.claude` vẫn bị bỏ qua |
| 2026-11-01 | Bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`), e2e `ds-parity` so số đo bằng bảng chuẩn, axe smoke bảy màn, mở rộng `ds-shop-guard`, `terminology.spec` quét thêm `packages/app-core/src` (P17b) | baseline lấy sau đợt 4 nên mã cũ không phải sửa hàng loạt mà chỉ được giảm; so số đo bằng bảng chuẩn vì CI tách server Mini và web; thẻ web mất bóng do `shadow-[var(--x)]` được sửa và có luật chặn |
| 2026-11-02 | PDP: bỏ dòng "Phân loại ›", giữ chip; Số lượng liền dưới chip, ghi chú vận chuyển dời lên trên chip (G3) | chip đã nêu tên, giá Giờ vàng, hết hàng ngay trên màn; Thêm vào giỏ/Mua ngay vẫn mở bảng chọn từ 2 phân loại nên dòng "›" chỉ lặp; Đánh giá nhanh không còn chen giữa phân loại và Số lượng |
| 2026-11-02 | Sheet: từ md (768px) mọi sheet web là hộp thoại giữa màn rộng tối đa `--dialog-w` (480px), cao tối đa 85vh, bo đủ góc, bóng `--elevation-4`, mở fade/scale (tắt khi giảm chuyển động), không tay nắm; dưới md giữ bottom sheet. Tiêu đề mọi sheet (Mini + web) là tiêu đề khối Inter 16/700 (K7) | sheet trải ngang 560px cao gần hết màn trên máy tính trông như điện thoại phóng to; tiêu đề Fraunces 18px trái Q1 (final-critique P2 #2, #3); hai sheet web (`mini/bottom-sheet`, `ui/sheet`) cùng một dạng |
| 2026-11-02 | Dải "Có thể bạn cũng thích": khách web lấy 10 món bán chạy (`PDP_FEED_SOURCE_LIMIT`) | `/products/for-you` của API trả tối đa 10 món nên Mini chỉ có ngần ấy; nguồn khác nhau (bán chạy với gợi ý cá nhân) là chủ ý vì `for-you` cần đăng nhập, chỉ trần số món được cho bằng nhau |
| 2026-11-02 | Nút "Mua ngay" ở Giờ vàng dùng `--color-flash-solid-bg` qua `Button` biến thể `flash`; bảng Token ghi rõ ngoại lệ này (G5 #22) | giữ màu đặc của nhãn Giờ vàng để nhãn và nút mua cùng một nhận diện; đổi màu nút sẽ làm Giờ vàng lệch khỏi thẻ ngay bên cạnh |
| 2026-11-02 | Chân trang web ở 375px dài hơn Mini vì giữ liên kết pháp lý và đơn vị vận hành (G5 #38) | Mini không có chân trang; web là trang công khai nên cần các liên kết này; ghi ở mục Khuôn trang web để lần chụp so sau không coi là lỗi |
| 2026-11-02 | Pager số ẩn ở điện thoại (sr-only, giữ liên kết cho SEO), "Xem thêm" là điều khiển chính; nav không đệm trên khi ẩn (H3 #4) | điện thoại giống Mini App chỉ có "Xem thêm"; liên kết trang vẫn có trong HTML cho crawler vì canonical của ?page=N trỏ về chính nó |
| 2026-11-02 | Kệ ngang <= 6 món ở lg vẽ lưới cùng số cột lưới Sản phẩm (5 cột lg, 6 cột xl), hàng chưa đầy dồn trái; hai bản kệ + lưới chỉ khác nhau bằng CSS (H3 #6, #8) | thẻ phải bằng bề rộng thẻ của lưới Sản phẩm, giãn cột theo số món làm thẻ to hơn mọi lưới khác của web; chọn bản bằng JS làm trang công khai nháy khi hydrate nên giữ hai bản, bản ẩn `display:none` (không vào cây trợ năng, ảnh lazy không tải) |
| 2026-11-02 | "Mua kèm deal sốc" đổi thành "Mua kèm giá tốt" (`addon.title`); `pickerStockText` ghi "Còn n sản phẩm"; API nói "mã miễn phí giao", "Giờ vàng", "Còn n" (K4, P2 #11) | "deal sốc" là chữ giục mua trái luật bỏ chữ giục mua; chủ giao tự chốt chữ nên chọn "giá tốt" (nói đúng điều khách được, không giục). Đổi lại bằng một khoá trong `shop-copy.ts` |
| 2026-11-02 | Giỏ gom món của combo dưới đầu nhóm "Combo: {tên} · Tiết kiệm {số}"; bỏ món khoá của bộ thì hỏi trước bằng `ConfirmSheet` (không chặn), số Tiết kiệm của đầu nhóm lấy từ `comboGroups` của API (K5) | `comboGroups` cộng bằng `comboDiscount` vì cùng một lần khớp ở máy chủ nên khách thấy bộ nào giảm bao nhiêu mà tiền trả không đổi; số trong hộp báo là cận trên khi hai bộ chung một món; khi chỉ chọn một phần giỏ, đầu nhóm theo giá phần chọn của máy chủ (nhóm không còn trong đó thì bỏ chữ Tiết kiệm và nhắc chọn đủ món; còn nhưng giảm ít hơn thì ghi số của phần chọn) để khớp dòng ở chân dính, chưa có giá đó thì theo luật món khoá; sản phẩm chính của "mua kèm" là món khoá không mang giảm nhưng vẫn nằm trong khối, kẻo hộp báo hỏi về một món trông như món lẻ; giỏ vừa sửa ở máy khách (Mini) đưa `comboDiscount` ở chân về 0 và đánh dấu `comboPending`, còn số của các nhóm giữ lần trước: đầu nhóm giữ chỗ của số (ẩn, không đọc, không hiện số cũ) để không đổi số dòng và khối không nhảy dưới ngón tay khách mỗi lần bấm +/−, hộp báo bỏ món vẫn có số để báo; hai bộ chung món khi chọn một phần giỏ thì bộ mà máy chủ áp có khối riêng nên tổng đầu nhóm luôn bằng dòng ở chân; từ md vạch dọc bên trái ghi chỗ bộ kết thúc |
| 2026-11-02 | Chữ API bỏ "Vui lòng" và "chúng tôi" (giữ mệnh đề đầu câu mà client cũ so khớp); câu khách đọc của Giờ vàng tách ra `flash-sale-notice.ts`; `terminology.spec` quét mọi file API cho hai chữ này, đoạn template xét cả từ viết thường, bỏ giá trị truy vấn (M2) | lưới cũ chỉ quét file `*-notice.ts`/`*-price.ts` nên "Vui lòng" còn ~110 chỗ trong lỗi API; client cũ trên máy khách vẫn chạy với API mới nên chỉ đổi phần đuôi câu |
| 2026-11-05 | Thêm `ProductStoryShowcase` (dải câu chuyện sản phẩm) và Story Studio; sprite nguyên liệu là vector nội tuyến, màu qua token `--color-story-*`; kịch bản mẫu chỉ nêu điều có trong dữ liệu sản phẩm | giữ một bộ cấu hình cho Mini, web và Admin Live Preview; không tải tài nguyên ngoài nên dùng được ngoại tuyến và không phá dung lượng gói đầu; không bịa thông số (phần trăm chỉ lấy từ thành phần thật) |
| 2026-11-07 | W42A: dải Story đầu Trang chủ (`StoryReelStrip`, khối `stories` dưới lối tắt, nguồn Bán chạy nhất, cao 144px) và thanh Miễn phí giao hàng + dải bù đơn ở ĐẦU giỏ (`FreeShippingProgressBar`, `FreeshipAddonRail`); gỡ thanh Freeship khỏi chân dính | đề bài yêu cầu; tiêu đề dải giữ "Câu chuyện sản phẩm" và kịch bản dự phòng chỉ nêu dữ liệu có thật (không ghi Đà Lạt, VietGAP, thu hoạch sáng sớm, độ giòn ngọt) vì danh mục có cả dầu gội, nước rửa chén và `story-presets-launch.spec` chặn tuyên bố cần giấy tờ; câu chúc mừng không có dấu "!" theo `shop-copy.spec`; dải bù đơn chỉ nhận món Tubu giao vì hàng gian hàng tự giao không được miễn phí giao của Tubu |
| 2026-11-08 | W44B: gợi ý mã giảm giá ở ĐẦU giỏ dưới thanh Miễn phí giao hàng (`CartVoucherHintStrip`, logic `cartVoucherHint`): mời áp mã đã đủ điều kiện bằng một chạm và nhắc mã sắp mở khoá khi còn thiếu không quá 100.000đ | đề bài yêu cầu; chỉ nói số của máy chủ (`discount` của xem trước, `shortfall` đã loại dòng Giờ vàng) nên không hứa sai; mã giảm theo % hoặc miễn phí giao hàng nói "{n}%" và "mã Miễn phí giao hàng" thay vì bịa số tiền; chữ dùng "mã giảm giá" vì `terminology.spec` cấm "voucher"; chưa gắn ở Thanh toán vì trang đó tự áp mã tốt nhất (`useCheckoutCoupon`) và đã có dòng báo số mã |
| 2026-11-08 | W45A: dải cam kết `ProductTrustStrip` ở trang chi tiết (logic `productTrustStrip`), dưới khối chọn phân loại và Số lượng, trước dải câu chuyện; ba trụ cột "Nguồn gốc rõ ràng", "Giao hàng cẩn thận", "Đổi trả dễ dàng" và lối xem chính sách (Mini mở `PolicySheet`, web là liên kết) | đề bài yêu cầu ba trụ cột; chủ chọn đổi hai chữ đầu của đề ("Chuẩn hữu cơ & an toàn", "Giao nhanh đúng hẹn / Đóng gói chuẩn mát") sang chữ kiểm chứng được vì dải hiện trên mọi sản phẩm (cả nước rửa chén, dầu gội), hệ thống chưa có dữ liệu chứng nhận hữu cơ hay cam kết giờ giao/giữ mát và `story-presets-launch.spec` đã chặn các tuyên bố đó; hàng gian hàng tự giao không có cam kết đóng gói và đổi trả của Tubu nên không có dải |
| 2026-11-08 | W46A: dải lọc nhanh ở trang Sản phẩm yêu thích (logic `wishlistFilterView`, vẽ bằng `ScrollRow` + `Chip` sẵn có, không thêm thành phần): "Tất cả", "Đang giảm", "Còn hàng" kèm số đếm trên toàn danh sách; lọc ra rỗng thì câu báo theo bộ lọc và nút "Xem tất cả sản phẩm đã lưu" | "Đang giảm" là món có giá khuyến mãi của chính sản phẩm (`salePrice` thấp hơn `basePrice`, qua `discountView` như thẻ), không tính giá Giờ vàng vì thẻ tự đọc suất Giờ vàng theo khung giờ còn trang này không tải nó, nên thẻ gạch giá vì Giờ vàng có thể không được đếm; "Còn hàng" là `inStock !== false` (thiếu cờ coi là còn, cùng nút giỏ nhanh); dải cuộn ngang vì ba chip kèm số không vừa một hàng ở 320px; chip đã có vùng chạm 44px (`tubu-hit-44`) nên không dựng nút lọc riêng |
| 2026-11-08 | W51A: khối "Đánh giá nhanh" ở trang chi tiết (`PdpQuickReviews`) thêm huy hiệu "Đã mua" cạnh tên, dải tối đa 3 ảnh thật thu nhỏ dưới nhận xét và số đều (`tabular-nums`) cho "điểm · số lượt" và nút "Xem tất cả (n)"; Mini gắn `data-section="pdp-quick-reviews"` như web | đề bài yêu cầu; `pickQuickReviews` đã ưu tiên đánh giá có ảnh nhưng khối không vẽ ảnh nên lợi thế ấy bị giấu ngay trên màn đầu; huy hiệu dùng đúng cách vẽ của danh sách đầy đủ (web `bg-success-bg`, Mini `Badge` tông success); ảnh là ảnh trang trí 48px (`alt` rỗng, không phải nút) vì mở xem lớn đã có ở danh sách đầy đủ, nên khối không thêm vùng chạm nhỏ; web ghép gốc API chỉ cho đường dẫn bắt đầu bằng "/" (`mediaSrc` của danh sách đầy đủ, URL tuyệt đối như Cloudinary giữ nguyên) chứ không gọi trần `apiMediaUrl`; số đo Mini ở `css/pdp-quick-reviews.css` (bánh cóc px chỉ đếm TSX), web dùng lớp Tailwind cùng số (`mt-0.5`, `gap-1.5`, `h-12 w-12`, huy hiệu `gap-0.5`); chỉ đánh giá có `images` mới có dải ảnh, đánh giá chỉ có video chưa có thumbnail |
| 2026-11-08 | W48A: "Đang giảm" ở trang Yêu thích tính cả giá Giờ vàng (thay quyết định W46A ở dòng trên), và Mini trả focus về chip "Tất cả" sau "Xem tất cả sản phẩm đã lưu" như web | khách thấy thẻ gạch giá Giờ vàng ở "Tất cả" mà sang "Đang giảm" món đó biến mất thì tự mâu thuẫn; `wishlistFilterView(items, active, allFlash, now)` dùng chính `cardPricing` của thẻ (giá khuyến mãi hoặc suất Giờ vàng đang chạy thắng, hết hạn theo `endAt`, phân loại CTV ghim) nên "gạch giá" và "Đang giảm" không thể lệch; trang đọc cùng khoá `flash-sales/active` và cùng đồng hồ với thẻ (Mini `fetchActiveFlashSales` + `serverNow`, web `useActiveFlashSales` + `useFlashNow`) nên không thêm request, và tự vẽ lại đúng mốc suất hết giờ (`useFlashListExpiry`); Mini chỉ đọc Giờ vàng khi danh sách có món |
| 2026-11-08 | W50A: dòng "sắp mở khoá mã" của `CartVoucherHintStrip` có nút "Mua thêm" một chạm (prop `onShopMore`, `data-testid="cart-voucher-unlock-cta"`) ở Giỏ web và Mini; nút về trang chủ `/` | đề bài yêu cầu; khách đã thấy còn thiếu bao nhiêu thì cần lối ngay tại chỗ thay vì tự tìm đường quay lại chọn món; nút dùng biến thể `secondary` như "Áp dụng ngay" (biến thể `ghost` nhẹ hơn chưa được chụp 375px nên chưa chọn), cao 44px, chung hàng với chữ nhắc (`.tubu-vhint-head`, flex căn giữa, chữ co được `min-width: 0`) và gắn `aria-describedby` vào chính câu nhắc để trình đọc màn hình đọc đủ ngữ cảnh; không truyền `onShopMore` thì dòng giữ nguyên như cũ; đích `/` theo đề, khác lối thoát giỏ trống (`/san-pham`, `/browse`): đổi một chỗ ở trang nếu chủ muốn vào thẳng danh mục |
| 2026-11-08 | W43A: dải `QuickReorderStrip` thay cách vẽ kệ `home.purchased` (rail 6 món, không thêm kệ thứ 5) và khối `FrequentlyBoughtTogether` (kệ `pdp.frequentlyBought`, 2 món bổ trợ) ở trang chi tiết | đề bài yêu cầu; chủ chọn thay hình kệ Mua lại thay vì thêm kệ (Trang chủ đã đủ trần 4 kệ hàng, và hai khối cùng ý "mua lại" lặp nhau) và dùng dữ liệu "Khách thường mua cùng" có sẵn thay vì nguồn catalog mới (PDP đã có Combo, Mua kèm giá tốt và dải mua cùng); một chạm thay hai chạm ở Trang chủ vì thẻ đã có bay vào giỏ và huy hiệu nảy (W42B) báo rõ đã thêm; tab Đơn hàng giữ hai chạm |
| 2026-11-08 | W51B: nút "Mua thêm" trên thanh Miễn phí giao hàng ở đầu giỏ (`FreeShippingProgressBar`, prop `onShopMore`, đưa về Trang chủ), chỉ hiện khi chưa đạt ngưỡng | đề bài yêu cầu; chữ nút và tên truy cập (nêu số còn thiếu, bắt đầu bằng chữ hiện trên nút) nằm ở `freeship.shopMoreCta` và `freeship.shopMoreAria`; khối giữ chiều cao tối thiểu theo hàng nút 44px nên câu một dòng không co lại khi hết nút lúc đạt ngưỡng, còn câu dài (hàng gian hàng tự giao, màn hẹp) xuống ba dòng thì vẫn co lại khi đạt, chấp nhận vì nút không nhường chỗ cho chữ; đích Trang chủ khớp nút "Mua thêm" của dòng sắp mở khoá mã (W50A) cùng trang; khi một giỏ vừa thiếu để miễn phí giao vừa thiếu để mở khoá mã thì hai nút cùng hiện, cùng đích |
| 2026-11-13 | W141: trang tĩnh (`/cau-chuyen`, `/gio-vang`, `/doi-rac/quy-dinh`, `/cong-dong`, `/gioi-thieu`) dùng chung `staticPageMetadata` và `staticPageJsonLd` (canonical, OG, WebPage + BreadcrumbList); cổng nhân viên hai cột từ `lg` (`staffLayout`, prop `wide`); Mini bỏ nút "Xem câu chuyện sản phẩm" và khung toàn màn ở trang chi tiết (như web); đồng bộ e2e Story thẻ chia đôi | đề bài W60-T2 yêu cầu; `/doi-rac` không nằm trong breadcrumb vì trang đó noindex |
| 2026-11-15 | W166: Giỏ chỉ còn MỘT nút áp mã: bỏ dòng mời "Áp dụng ngay" ở thân giỏ, nút "Áp dụng" (một chạm, mã giảm nhiều nhất, `data-testid="cart-voucher-apply-cta"`) là nút cuối hàng "Mã giảm giá" ở chân dính khi có mã đủ điều kiện chưa áp, còn không thì giữ "Chọn mã ›"; thanh Miễn phí giao hàng khi đã đạt co thành một dòng gọn 36px (không giữ chiều cao 56/76px của lúc chưa đạt) | chủ chụp Giỏ 375x812: hai dải xanh trên danh sách (hộp ~76px gần trống và dải mời áp mã) cùng chân dính đã có hàng mã tạo hai nút cho một hành động và đẩy món hàng xuống (Luật Thép chống nhồi nhét: tối đa một nút cho mỗi hành động trên một màn hình); nút nằm NGOÀI vùng bấm mở danh sách (không lồng nút trong nút), bấm chữ của hàng vẫn mở danh sách; khoá chạm đúp, lời báo lỗi (`role=alert`, nút được mô tả bằng nó) và lời "Đã áp dụng mã" giữ nguyên của `useCartVoucherHint`; dòng "sắp mở khoá" (nút "Mua thêm") là hành động khác nên giữ ở thân giỏ |
| 2026-11-16 | W181: thư viện ảnh trang chi tiết (`ProductGallery` web, `Gallery` Mini) thêm video làm ô CUỐI dải cuộn, cùng khung vuông với ảnh (`PdpVideoSlide`, logic `pdpMedia` của app-core): ô hiện ảnh đầu làm poster kèm nút phát 44px, thẻ `<video preload="none" playsInline>` không tự phát và chỉ tải khi khách bấm; lỗi phát hiện câu "Không phát được video này."; chọn phân loại có ảnh riêng thì dải cuộn tới ảnh đó (chỉ khi khách tự chọn, mở trang không nhảy) | đề bài yêu cầu; cùng khung vuông nên không thêm CLS, không thư viện phát video nên không tăng gói Mini |
| 2026-11-18 | tubu-w3-02: dải bù đơn ở Giỏ (Mini và web `/gio-hang`) có nguồn mới `GET /upsell/freeship` sau cờ `commerce.freeship_booster_enabled` (mặc định tắt): tiêu đề "Thêm 1 món nhỏ để đủ Miễn phí giao hàng", cửa sổ giá số còn thiếu + 45.000đ, bán chạy trước; dải tiến độ đầu Giỏ mừng một lần khi vừa đạt Miễn phí giao hàng hay lên bậc Hộp Xanh (`CartUnlockSlot`) | đề bài yêu cầu; đề bài viết "Freeship" nhưng đó là thuật ngữ cấm nên chữ dùng "Miễn phí giao hàng"; hiệu ứng mừng chạy cả khi cờ tắt vì chỉ là chuyển động nhỏ trên thành phần đã có, không đổi dữ liệu; giỏ khách chưa đăng nhập không có dải bù đơn như trước |
| 2026-11-18 | tubu-w3-06: quà tặng dùng thử 0đ theo mốc giỏ (`GiftTrialRow`, mặc định từ 299.000đ hàng Tubu Tree giao) và dạng "Giờ Xanh Ưu Đãi" của khối Giờ vàng ở Trang chủ và Ưu đãi | đề bài yêu cầu; Luật Thép chống nhồi nhét: quà là MỘT dòng dưới danh sách (không thêm dải đầu giỏ cạnh thanh Miễn phí giao hàng và Hộp Xanh), Giờ Xanh dùng lại khối Giờ vàng thay vì thêm khối thứ hai (cùng suất, cùng giá) nên không thêm chiều cao; thanh đã bán xanh dùng cặp token đã có (`--color-action-secondary-fg` trên `--color-progress-fill-from`/`--color-action-secondary-bg`, `contrast.spec`); trang Giờ vàng giữ tên chốt "Giờ vàng" |
| 2026-11-18 | tubu-w3-08: gợi ý gửi lại bao bì sau cờ `checkout.return_packaging_nudge_enabled` (mặc định tắt). Thanh toán (Mini và web `/thanh-toan`): hàng "♻️ Đổi rác kèm đơn" nêu đúng bao bì khách còn giữ từ đơn đã giao tới cùng địa chỉ ("Đơn trước bạn có 1 thùng carton, 2 vỏ chai Tubu Tree") trên nền `--color-status-success-bg`; đủ ngưỡng điểm và máy chủ đã chạy kiểm tra của báo giá trên gói gợi ý (`oneTapReady`) thì công tắc áp luôn (một chạm, chữ "Bật để gửi kèm: miễn phí giao kiện Tubu Tree, +{điểm} Điểm Xanh"), không thì công tắc mở tấm đã điền sẵn. Chi tiết đơn đã giao: thẻ mời cũ giữ tiêu đề, dòng dưới nêu bao bì của đơn và điểm, dẫn tới tạo yêu cầu với `?from=<mã đơn>` để điền sẵn số lượng | đề bài yêu cầu thẻ thông minh; gộp vào hàng và công tắc sẵn có thay vì thêm thẻ/nút mới để giữ 1 CTA mỗi hành động; chỉ hứa miễn phí giao khi riêng bao bì đã đủ ngưỡng `waste.pickup_min_points` và qua trần tháng của món; nói "giao kiện Tubu Tree" vì miễn phí chỉ áp cho kiện Tubu giao, không cho hàng gian hàng tự giao; vỏ chai của đơn giao chưa đủ 7 ngày không vào gợi ý ở thanh toán (khách còn đang dùng); phiếu thu kèm khách đã đăng ký thắng gợi ý từ đơn |
| 2026-11-18 | tubu-w4-02: trang chi tiết (Mini và web `/san-pham/[slug]`) có giá theo đơn vị dưới giá và trong chip phân loại (cờ `catalog.unit_price_enabled`), "Nhận dự kiến …" và câu còn thiếu để miễn phí giao trong khối Vận chuyển (cờ `shipping.pdp_eta_enabled`); cả hai mặc định tắt | đề bài yêu cầu; nhãn "Lợi hơn" ở cùng dòng giá theo đơn vị để chip chỉ thêm một dòng; không đoán lượng (một phân loại không đọc được thì cả sản phẩm không hiện); ngày nhận không thêm giờ chốt đơn hay ngày kho nghỉ vì chủ chưa xác nhận; chữ "miễn phí giao" thay "miễn phí vận chuyển" của đề bài để cùng thuật ngữ với giỏ ("Freeship" bị cấm); câu còn thiếu rút thành "Món này + {số} là miễn phí giao" vì câu dài hơn xuống hai dòng ở 360px và khối Vận chuyển chỉ được cao thêm 24px |
| 2026-11-19 | tubu-w7-02: dải mua thêm ở đầu Giỏ (Mini và web `/gio-hang`) nhắm cả hai mốc: chưa Miễn phí giao hàng thì như cũ, đạt rồi thì nhắm quà dùng thử 0đ và dòng đầu dải nói số còn thiếu tới quà; tối đa 4 món, mỗi món không quá 120.000đ, bỏ món đang là quà 0đ | đề bài yêu cầu (PO duyệt A5 19/11); đề bài viết "Freeship" và "Miễn phí vận chuyển" nhưng "Freeship" bị cấm nên chữ dùng "Miễn phí giao hàng" như thanh tiến độ, câu bỏ "!" theo `shop-copy.spec`; dòng đầu không lặp tin của dải tiến độ ngay trên (luật không nói một tin hai lần trên một màn): mốc giao hàng thì thanh đã nói "Mua thêm {số} để được Miễn phí giao hàng" nên dải giữ tiêu đề không số, mốc quà thì dải trên đã báo "Đơn hàng đã được Miễn phí giao hàng" nên dòng đầu bỏ vế đó, chỉ nói số còn thiếu tới quà; không thêm dải hay nút mới (luật một CTA mỗi việc): dùng lại `FreeshipAddonRail` ở đúng chỗ cũ, nút "+ Thêm" giữ cao 44px, co 0,97 khi nhấn và tắt co khi giảm chuyển động như mọi `.tubu-btn`; dòng quà khoá ở dưới danh sách ẩn khi dải mốc quà đang hiện hay còn chờ nguồn (dải đã nói số còn thiếu) và khi giỏ tạm vừa đủ mốc mà giỏ chưa đọc lại (không nói "Thêm …" lúc khách đã đủ), hiện lại khi dải không đủ món (`aovGiftLockedRowShown` qua `showLocked` của `GiftTrialRow`); đủ mốc thì dòng đó vẫn là chỗ "Quà 0đ" và nút "Đổi"; mốc quà xét theo tiền hàng app đang thấy (giỏ tạm) để dải đổi ngay khi bấm, còn ô quà đổi theo giỏ máy chủ trả về; sàn hạ từ 3 xuống 2 món vì trần 120.000đ làm ít món đủ điều kiện hơn và hai thẻ vẫn đọc như một dải |
