# P4 `product-tile` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** một thẻ sản phẩm duy nhất (`ProductTile` vẽ, `ProductCard` thông minh, `ProductGrid`, `ProductRail`, `PriceTag` mở rộng) ở Mini App và web; mọi chỗ vẽ thẻ chuyển sang nó; xoá `CatalogTile`, `RelatedTile` và thẻ chết của web.

**Kiến trúc:** `productCardView` (P2, `packages/app-core/src/commerce/product-card-view.ts`) quyết giá, nhãn, meta, chữ đọc; hai app chỉ vẽ `ProductCardView`. Chiều cao thân thẻ lấy từ một bảng số đo trong app-core (`commerce/tile-metrics.ts`) để thẻ, khung chờ và web dùng cùng con số. Chữ của thẻ tách khỏi `shop-copy` để `productCardView` không kéo cả bảng ~140 khoá vào gói đầu Mini App (entry 676 KB, trần 700 KB, mục tiêu ≤ 690 KB).

**Tech stack:** TypeScript, React 18 (Mini App: zmp-ui + inline style + token CSS; web: Next 15 + Tailwind + inline style), vitest + testing-library, Playwright (`E2E_SCOPE=miniapp`, mock API).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q2, Q4, Q5, Q13 là luật; §5 "Thẻ sản phẩm"); chữ ký ở `02-ke-hoach.md` "Giao diện dùng chung" và mục P4. Nguồn: `review/design-system.md` B2–B4, B6, B11; `review/critique-shop.md` CS-01; `review/polish.md` PL-01..03, PL-11, PL-12, PL-14, PL-15; `review/a11y.md` A1, A5, A6, P2-4, P2-6, P2-8, B2; `review/web.md` W-01. Bàn giao đợt 1: `plans/handoff-wave1.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Giữ đúng tên, chữ ký ở "Giao diện dùng chung": `ProductTile {view, variant, href, onAdd?, note?, priority?}`, `ProductCard {product, variant, flash?, rank?, inCombo?, showBrand?, note?}`, `ProductGrid/ProductRail {items, variant, rankFrom?}`, `PriceTag` thêm `tone?: 'default'|'deal'`, `layout?: 'inline'|'stack'`. Thêm prop optional được; không đổi hay đổi tên cái đã chốt. Mini: `apps/miniapp/src/components/ui/<tên>.tsx`; web: `apps/web/src/components/mini/<tên>.tsx`.
- Giá đang giảm (Giờ vàng hoặc giá sale) dùng `--color-text-price-deal`; giá thường đen; không đỏ. Giá thẻ `--type-price-tile-*` (16/700).
- Bề rộng thẻ kệ chỉ `--tile-w-sm` 128 hoặc `--tile-w-md` 148. Thẻ lưới cùng hàng chênh đáy giá ≤ 1px. Tên 2 dòng 22px/dòng (không hạ line-height: dấu "Ẩ", "Ổ" bị cắt), meta một dòng nowrap + ellipsis.
- Nhãn: slot A trên ảnh tối đa 1, slot nhãn đầu tên tối đa 1, hết hàng ẩn mọi nhãn (do `productCardView` quyết, tile không tự thêm). Badge không ghi đè `style`: dùng tông `flash`/`verified`.
- Vùng chạm ≥ 44px, tương phản ≥ 4,5:1, axe 0 vi phạm ở 375px.
- Entry Mini App ≤ 690 KB (trần cứng 700): ghi số trước (676) và sau. Khung chờ dựng từ cùng hằng với thẻ thật.
- KHÔNG đổi tiêu đề khối / "Xem tất cả" (P5 và gói màn), KHÔNG sửa `/ds-gallery` (P5), KHÔNG sửa file của gói khác; nếu buộc phải đụng thì ghi vào notes. `shop-copy.ts` và `vi.ts` là file gộp tay khi merge: chỉ thêm khoá, không đổi khoá có sẵn.
- Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt, mật độ như file quanh đó. Không `git stash` trần, không push, không PROD. Máy thiếu RAM: chạy vitest theo file, gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Sản phẩm thiếu ảnh, thiếu sao, thiếu đã bán, tên Việt dài có dấu: thẻ vẫn cùng chiều cao, meta giữ chỗ, tên cắt 2 dòng. Test ở T3 (vitest `meta=null`, cùng `minHeight` ô meta) và T12 (`tile-rhythm` trên dữ liệu có 3 kiểu thiếu).
2. Giờ vàng hết giờ khi khách đang xem: thẻ tự về giá thường đúng mốc `endAt`, không chờ lần tải lại danh sách. Test ở T4 (fake timers).
3. Hết hàng: không nhãn, tên/giá vẫn vào `aria-describedby`, thẻ vẫn mở được chi tiết. Test ở T3.
4. Hạng ≥ 10 hoặc `rank` thiếu: ruy-băng không tràn khỏi ảnh, không "#undefined". Test ở T3.
5. Khách chưa đăng nhập và API cấu hình chưa về (`launchDate` undefined, `freeshipThreshold` chưa có): không nhãn "Mới" / "Miễn phí giao hàng" chớp rồi tắt. Test ở T4.
6. Web ISR: lần hydrate đầu không lệch HTML máy chủ (không nhãn theo giờ máy khách trước khi `useHydrated`). Test ở T10.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/tile-copy.ts` | `TILE_COPY` + `fillTileCopy`: chữ thẻ nằm trên đường nạp gói đầu; `SHOP_COPY` spread lại |
| `packages/app-core/src/commerce/product-card-view.ts` | dùng `fillTileCopy`; thêm `spoken.meta?`; export `pickCardFlash` |
| `packages/app-core/src/commerce/card-meta.ts` | thêm `cardMetaSpoken` |
| `packages/app-core/src/commerce/tile-metrics.ts` | số đo px của thân thẻ theo biến thể + `tileBodyHeight` |
| `apps/miniapp/src/components/ui/{price-tag,product-image,product-tile,product-card,product-grid,product-rail,skeleton}.tsx` | thành phần Mini |
| `apps/miniapp/src/components/wishlist-heart.tsx` | nhãn `Yêu thích ${tên}`, tim nảy |
| `apps/miniapp/src/hooks/{use-free-ship-threshold,use-flash-expiry}.ts` | hook cho `ProductCard` |
| `apps/miniapp/src/components/{catalog,home,reorder}/*`, `pages/{product-detail,wishlist,brand-view,storefront-view}.tsx`, `components/{flash-sale,storefront-preview}.tsx` | chuyển sang `ProductCard`/`ProductTile` |
| `apps/miniapp/src/components/ds-shop-guard.spec.ts` | cấm `CatalogTile`/`RelatedTile`, `line-through` ngoài `price-tag.tsx`, Badge ghi đè màu |
| `apps/web/src/components/mini/{price-tag,product-image,product-tile,product-card,product-grid,product-rail,skeleton}.tsx` | thành phần web |
| `apps/web/src/components/catalog/wishlist-heart.tsx` | như Mini |
| `apps/web/src/lib/{use-free-ship-threshold,use-flash-expiry}.ts` | hook web |
| `apps/web/src/components/product-card.tsx`, `mini/product-tile.tsx` cũ | xoá; chỗ gọi trỏ `@/components/mini` |
| `apps/web/src/components/ds-shop-guard.spec.ts` | như Mini |
| `apps/e2e/tests/tile-rhythm.miniapp.spec.ts` | Playwright 375px |

Lệnh kiểm một file: `cd packages/app-core && npx vitest run src/<đường dẫn>.spec.ts`; `cd apps/miniapp && npx vitest run src/<đường dẫn>`; `cd apps/web && npx vitest run src/<đường dẫn>`.

## Điều chỉnh đã chốt trước khi làm (lệch kế hoạch chung, có lý do)

- Chữ thẻ tách ra `tile-copy.ts` (không import `shop-copy`): đo ở `handoff-wave1.md` cho thấy import `SHOP_COPY` vào gói đầu là +6–7 KB, vượt 700 KB.
- `ProductCardView.spoken.meta?: string | null` thêm optional (a11y P2-4, P2-6: "★" đọc thành "ngôi sao đen", "1,2k+" đọc thành "ca cộng"). Optional để fixture của gói khác vẫn biên dịch.
- `pickCardFlash(product, allFlash, now)` thêm vào app-core: `productCardView` nhận MỘT suất Giờ vàng, mà sản phẩm nhiều phân loại có nhiều suất; `ProductCard` cần chọn đúng suất thắng của `cardPricing`.
- `ProductTile` thêm prop optional ngoài bảng chung: `wishlist?: ReactNode`, `imageOverlay?: ReactNode`, `footer?: ReactNode`, `addLabel?: string`, `hidePrice?: boolean`; Mini thêm `navState?`, `onOpen?`. `onAdd` vẽ nút phụ cuối thẻ (nhãn `addLabel`, mặc định "Thêm").
- Không làm `nameHasBrand` (CS-01 ý 2): P2 không có hàm này, và thẻ cao cố định cần dòng nhãn hiệu luôn giữ chỗ trong cùng một lưới. Ghi vào notes cho P17.
- Khối Giờ vàng Trang chủ chỉ đổi vỏ thẻ sang `ProductTile` biến thể `flash` (thanh % và nút nhắc đặt ở `footer`, chữ giữ nguyên); P6/P12 làm lại khối.

---

### Task 1: app-core: chữ thẻ tách file, chữ đọc meta, chọn suất Giờ vàng, số đo thân thẻ

**Files:**
- Create: `packages/app-core/src/commerce/tile-copy.ts`, `packages/app-core/src/commerce/tile-metrics.ts`, `packages/app-core/src/commerce/tile-metrics.spec.ts`, `packages/app-core/src/commerce/tile-copy.spec.ts`
- Modify: `packages/app-core/src/commerce/product-card-view.ts`, `packages/app-core/src/commerce/card-meta.ts`, `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`; specs `product-card-view.spec.ts`, `card-meta.spec.ts`

**Interfaces:**
- Produces: `TILE_COPY: Readonly<Record<TileCopyKey, string>>`, `fillTileCopy(key: TileCopyKey, vars?: Record<string, string|number>): string`; `cardMetaSpoken(p: Pick<ProductCard,'ratingAvg'|'sold'>): string | null`; `ProductCardView.spoken.meta?: string | null`; `pickCardFlash(product: {slug; basePrice; salePrice?; repVariationId?; pinnedVariationId?}, allFlash: readonly FlashPriceItem[], now: number): FlashPriceItem | null`; `TILE_METRICS`, `tileBodyHeight(variant: CardVariant, o?: { brand?: boolean; note?: boolean; footer?: number }): number`.

- [ ] **Step 1: test đỏ.** `tile-copy.spec.ts`: (a) mọi khoá `TILE_COPY` có trong `SHOP_COPY` với cùng chữ; (b) đọc nguồn `product-card-view.ts` và `card-meta.ts`, khẳng định không có `from '../shop-copy'` (chặn tái phạm kéo bảng chữ vào gói đầu). `card-meta.spec.ts`: `cardMetaSpoken({ratingAvg:4.8, sold:1234})` = `"4,8 sao, đã bán hơn 1.200"`; `{sold:52}` = `"đã bán 52"`; `{ratingAvg:NaN, sold:0}` = `null`. `product-card-view.spec.ts`: `spoken.meta` khớp; `pickCardFlash` trả suất rẻ nhất còn hạn của đúng slug, `null` khi hết hạn / sai slug / suất không rẻ hơn giá bán, và `productCardView({... flash: pickCardFlash(...)})` ra cùng giá với `cardPricing`. `tile-metrics.spec.ts`: `tileBodyHeight('grid', {brand:true})` = 118, `('grid',{brand:false})` = 102, `rail-md` = 134, `rail-sm` = 96, `flash` có `note` + `footer: 28` = 140, `line` = 80.
- [ ] **Step 2:** chạy 4 spec trên, thấy đỏ.
- [ ] **Step 3:** `tile-copy.ts` chứa các khoá thẻ dùng (`flash.badge`, `badge.*`, `stock.out`, `price.*`, `combo.tileTag`, `rank.spoken`, `meta.ratingSpoken` "{avg} sao", `meta.soldSpoken` "đã bán {n}", `meta.soldSpokenOver` "đã bán hơn {n}"); `shop-copy.ts` bỏ các dòng đó khỏi literal và `...TILE_COPY`; thêm ba khoá mới vào `shop-copy-budget.ts` (null). `product-card-view.ts` đổi `fillCopy` → `fillTileCopy`; thêm `pickCardFlash`, `spoken.meta`. `card-meta.ts` thêm `cardMetaSpoken` (làm tròn xuống theo đơn vị đang hiện: 1,2k+ → 1.200). `tile-metrics.ts`: số đo ở bảng dưới.

  | Biến thể | Công thức thân thẻ (px) |
  |---|---|
  | grid | 8 + [16 nhãn hiệu] + 44 tên + 4 + 20 giá + 2 + 16 meta + 8 |
  | rail-md | như grid, giá xếp chồng thêm 16 dòng giá gạch |
  | rank | 8 + 44 + 4 + 20 + 16 + 2 + 16 + 8 (không nhãn hiệu) |
  | rail-sm | 8 + 40 tên (caption 2 dòng) + 4 + 20 + 16 + 8 |
  | flash | như rail-sm + 16 nếu có `note` + `footer` |
  | line | 80 (ảnh 64 + 2×8) |
- [ ] **Step 4:** chạy cả thư mục `src/commerce` và `shop-copy.spec.ts`; xanh (`npx vitest run src/commerce src/shop-copy.spec.ts`).
- [ ] **Step 5: commit** `feat(app-core): chữ thẻ tách file khỏi shop-copy, chữ đọc meta, pickCardFlash, số đo thân thẻ`.

### Task 2: Mini: PriceTag, ProductImage, WishlistHeart

**Files:** Modify `apps/miniapp/src/components/ui/{price-tag,product-image}.tsx`, `apps/miniapp/src/components/wishlist-heart.tsx`, `apps/miniapp/src/css/tokens.css` (keyframe `tubu-heart-pop`); specs `ui/price-tag.spec.tsx`, `ui/product-image.spec.tsx`, `wishlist-heart.spec.tsx` (nếu chưa có thì tạo).

**Interfaces:**
- Produces: `PriceTag` thêm `tone?: 'default'|'deal'|'inverse'`, `layout?: 'inline'|'stack'`, `size?: 'tile'` (16/700 qua `--type-price-tile-*`), `value: number | null` (null → "—"); luôn có `<span sr-only>Giá </span>` trước giá và `, giá gốc ` trước giá gạch (`Giá Giờ vàng ` khi `flash`). `WishlistHeart` thêm `productName?: string`; nhãn cố định `Yêu thích ${productName}` + `aria-pressed`. `ProductImage` hiện dần 200ms ở `onLoad` (ảnh `img.complete` hiện ngay), khung `outline: 1px solid var(--color-media-outline)`, ô thay thế nền `--color-bg-media` không nhuộm màu nhãn.

- [ ] **Step 1: test đỏ.** price-tag: (a) có chữ "Giá 39.000đ" và ", giá gốc 52.000đ" trong text (sr-only) khi có `compareAt`; (b) `flash` → "Giá Giờ vàng"; (c) `tone="deal"` đặt `color: var(--color-text-price-deal)`, mặc định `--color-text-price`; (d) `layout="stack"` đặt giá gạch ở dòng riêng (`flexDirection: column`); (e) `value=null` → "—", không gạch. heart: `getByRole('button', {name: 'Yêu thích Nước rửa chén'})` có `aria-pressed="false"` và nhãn không đổi sau khi bấm. image: ảnh bắt đầu `opacity: 0`, sau `fireEvent.load` thành `1`.
- [ ] **Step 2:** chạy 3 spec, thấy đỏ. **Step 3:** cài đặt (`PriceTag` chữ đọc dùng `TILE_COPY` qua `fillTileCopy('price.spoken'...)`; dùng chung `SR_ONLY` của `ui/sr-only.ts`). **Step 4:** chạy lại 3 spec + `tiles.spec.tsx` + `hit-target-guard.spec.tsx`, xanh. **Step 5: commit** `feat(miniapp): PriceTag tone/layout/chữ đọc, ảnh hiện dần, tim nảy có tên sản phẩm`.

### Task 3: Mini: `ProductTile` mới + `ProductTileSkeleton`

**Files:** Rewrite `apps/miniapp/src/components/ui/product-tile.tsx`; modify `ui/skeleton.tsx` (thêm `ProductTileSkeleton`, `ProductCardSkeleton`/`ProductGridSkeleton` dựng từ nó); rewrite `ui/product-tile.spec.tsx`.

**Interfaces:**
- Consumes: `ProductCardView`, `CardVariant` (T1), `tileBodyHeight`, `PriceTag` (T2).
- Produces: `ProductTile(props: { view: ProductCardView; variant: CardVariant; href: string; onAdd?(): void; addLabel?: string; note?: string; priority?: boolean; wishlist?: ReactNode; imageOverlay?: ReactNode; footer?: ReactNode; hidePrice?: boolean; navState?: Record<string, unknown>; onOpen?(): void })`; `ProductTileSkeleton({ variant, brand?: boolean })`; `TILE_NAME_MIN_HEIGHT = 44` (giữ export cũ). Nút tên giữ `className="tubu-tile-link"` + `aria-label={view.name}` (e2e cũ chọn theo đó); vỏ thẻ `className="tubu-press-card"`, `data-ds="product-tile" data-ds-variant`.

- [ ] **Step 1: test đỏ (`product-tile.spec.tsx`).** Với mỗi `CardVariant` (`it.each`): render được, vỏ có `data-ds-variant`. Cụ thể: (a) `meta=null` vẫn có phần tử meta cao đúng `16px` (grid, rail-md, rank) và thân thẻ `minHeight` bằng `tileBodyHeight(variant)`; (b) `aria-describedby` của nút tên trỏ tới phần tử chứa `spoken.stock`, `spoken.badges`, `spoken.price`, `spoken.meta` theo thứ tự (a11y A5); (c) `stock='out'`: không `imageBadge`/`label`, có chữ `stockText`, nút tên vẫn bấm được → `navigate(href)`; (d) `rank=12` ruy-băng có chữ "12" và `maxWidth` không tràn, `rank=null` không vẽ ruy-băng; (e) `label` vẽ inline đầu dòng tên và tên vẫn `WebkitLineClamp: 2`; (f) bấm gọi `onOpen` rồi `navigate(href, { state: navState })`; (g) `onAdd` → nút nhãn `addLabel`, bấm không điều hướng; (h) `hidePrice` không in giá nhưng giữ chiều cao; (i) giá thường màu `--color-text-price`, `isDeal` màu `--color-text-price-deal`; (j) vỏ có class `tubu-press-card`; (k) ảnh nằm trong khung `aspect-ratio: 1/1` (không nhảy khi tải); (l) skeleton: chiều cao thân bằng `tileBodyHeight` cùng biến thể.
- [ ] **Step 2:** chạy, thấy đỏ. **Step 3:** cài đặt theo `design-system.md` B2: ảnh 1:1 nền `--color-bg-media`; slot A (`imageBadge`: `Badge tone` = `flash` → `flash` có icon Zap, còn lại `promo`) góc trái trên cách mép 8, riêng `rank` thì ruy-băng hạng (tông `--color-rank-1..3-bg`, từ 4 `--color-rank-n-*`) ở slot A và nhãn giảm xuống góc trái dưới; hết hàng phủ `--color-bg-scrim-light` + `stockText`; thân thẻ flex-column, `padding: var(--tile-inset)`, dòng nhãn hiệu 12/500 tertiary không chấm, tên `body-sm` 2 dòng (`caption` ở rail-sm/flash) với `label` inline đầu dòng, `PriceTag size="tile"` (xếp chồng ở rail-md/rail-sm/flash/rank, hàng ngang ở grid, hàng `margin-top:auto`), meta `label` 12/500 nowrap + ellipsis cao 16, `note` một dòng 16 dưới giá. `line`: ảnh 64 trái, tên + giá phải, `onAdd` ở cuối hàng.
- [ ] **Step 4:** `npx vitest run src/components/ui/product-tile.spec.tsx src/components/ui/skeleton.spec.tsx`, xanh. **Step 5: commit** `feat(miniapp): ProductTile 6 biến thể thân thẻ cố định, khung chờ cùng số đo`.

### Task 4: Mini: `ProductCard`, `ProductGrid`, `ProductRail`

**Files:** Create `apps/miniapp/src/components/ui/{product-card,product-grid,product-rail}.tsx` + `.spec.tsx`, `apps/miniapp/src/hooks/{use-free-ship-threshold,use-flash-expiry}.ts` + spec.

**Interfaces:**
- Consumes: `productCardView`, `pickCardFlash` (T1), `ProductTile` (T3), `useCatalogLaunchDate` (có sẵn), `usePublicConfig` (`hooks/use-public-config.ts`), `fetchActiveFlashSales` (queryKey `['flash-sales','active']`), `serverNow`.
- Produces: `ProductCard({ product: ProductCard; variant: CardVariant; flash?: FlashPriceItem | null; rank?: number; inCombo?: boolean; showBrand?: boolean; note?: string; listSource?: string; showWishlist?: boolean; imageOverlay?: ReactNode; onOpen?(): void })`; `ProductGrid({ items; variant: CardVariant; rankFrom?: number; listSource?; loading?; skeletonCount? })` (`<ul role="list">`, 2 cột, `data-testid="catalog-grid"`, khung chờ `data-testid="catalog-grid-skeleton"`); `ProductRail({ items; variant: 'rail-sm'|'rail-md'|'rank'|'flash'; rankFrom?; label: string; listSource? })` (`ScrollRow`, bề rộng `--tile-w-sm|md`, `padding: var(--rail-pad-block)`, vỏ thẻ `display:flex; height:100%`); `useFreeShipThreshold(): number | null`; `useFlashExpiry(endAt?: string): void` (render lại đúng `endAt`).

- [ ] **Step 1: test đỏ.** ProductCard: (a) Giờ vàng thắng → giá deal, `imageBadge` "Giờ vàng -x%", điều hướng mang `state.variationId` của suất; không có suất → `pinnedVariationId` nếu có; (b) `fake timers`: suất `endAt` = now+1s, tiến 2s → thẻ về giá thường, không nhãn Giờ vàng (Review Focus 2); (c) `useCatalogLaunchDate()` = undefined → không "Mới" dù tạo hôm nay, sang `null` → có "Mới" (Review Focus 5); (d) `freeshipThreshold` chưa về → không "Miễn phí giao hàng"; về và `fulfiller.kind==='TUBU'`, giá ≥ ngưỡng → có; (e) `flash` truyền vào thắng cache. Grid/Rail: `rankFrom={1}` truyền `rank` tăng dần; rail không nhãn khi `rail-sm`; lưới là `ul role=list` với `li` mỗi thẻ; `loading` vẽ đúng `skeletonCount` thẻ khung chờ.
- [ ] **Step 2:** chạy, thấy đỏ. **Step 3:** cài đặt: `ProductCard` chọn suất bằng `pickCardFlash(product, flashQ.data ?? [], serverNow())` khi không truyền `flash`; `now = serverNow()`; chuẩn bị `product` bỏ `createdAt` khi `launchDate === undefined` (chưa biết mốc: không gắn "Mới"); `onOpen` + `haptic('light')` + `navState` = `{ listSource, variationId | pinnedVariationId }`; tim `<WishlistHeart productId productName floating />` truyền vào `wishlist`. **Step 4:** chạy 3 spec + hooks spec, xanh. **Step 5: commit** `feat(miniapp): ProductCard, ProductGrid, ProductRail dùng productCardView`.

### Task 5: Mini: chuyển Trang chủ, Danh mục, kệ phụ sang `ProductCard`

**Files:** Modify `components/catalog/{catalog-grid,suggested-rail,recently-viewed-rail}.tsx`, `components/home/{best-seller-rail,suggest-feed}.tsx`, `components/reorder/purchased-rail.tsx`, `components/storefront-preview.tsx`, `components/ui/skeleton.tsx` (xoá `ProductCardSkeleton` cũ nếu không còn chỗ gọi), specs tương ứng (`catalog-grid.spec.tsx`, `suggested-rail.spec.tsx`, `suggest-feed.spec.tsx`, `product-card.spec.tsx` cũ, `catalog-pricing.spec.ts`, `discovery-hit-targets.spec.tsx`).

**Interfaces:** `CatalogGrid` và `CatalogGridSkeleton` giữ tên và `data-testid` (`catalog-grid`, `catalog-grid-skeleton`, `catalog-tile-skeleton`) nhưng thành vỏ mỏng của `ProductGrid`; xoá `CatalogTile` và `TILE_BODY_HEIGHT` (thay bằng `tileBodyHeight`).

- [ ] **Step 1: sửa spec cũ trước (đỏ vì tên cũ).** `catalog-grid.spec.tsx`: giữ ca giá Giờ vàng/hết hàng/điều hướng `listSource`; thêm ca thẻ không sao không đã bán cùng chiều cao thân thẻ với thẻ có đủ. `suggest-feed.spec.tsx`, `suggested-rail.spec.tsx`: chỉ đổi chỗ chọn nếu selector đổi. Chạy, ghi các ca đỏ.
- [ ] **Step 2:** chuyển lần lượt: `CatalogGrid` → `ProductGrid variant="grid"`; `BestSellerRail` → `ProductRail variant="rail-md"` (xoá `TILE_WIDTH`, `RAIL_TILE_EXTRA`; khung chờ `ProductTileSkeleton variant="rail-md"`); `SuggestFeed` giữ `CatalogGrid`; `RecentlyViewedRail` → `ProductTile variant="rail-sm"` với `hidePrice` khi chưa có giá thật (`product` lấy từ `fetchProductsBySlugs`; thẻ dựng từ `productCardView` với `ProductCard` ghép từ `{slug,name,thumbnail}` + giá hiện hành); `PurchasedRail` (`rail` khối) → `ProductTile variant="rail-md"` với `onAdd` + `addLabel="Mua lại"` và `note` "Đã mua n lần" khi `timesBought > 1`; `StorefrontPreview` → `ProductCard showWishlist={false}`.
- [ ] **Step 3:** chạy `npx vitest run src/components/catalog src/components/home src/components/reorder src/components/storefront-preview src/pages/discovery-hit-targets.spec.tsx`, xanh. **Step 4: commit** `refactor(miniapp): Trang chủ, Danh mục, Đã xem, Mua lại vẽ thẻ bằng ProductCard/ProductTile`.

### Task 6: Mini: chuyển PDP, Giờ vàng, gian hàng, thương hiệu, Yêu thích; xoá thẻ cũ; Badge thôi ghi đè

**Files:** Modify `pages/{product-detail,wishlist,brand-view,storefront-view}.tsx`, `components/flash-sale.tsx`; delete `components/product-card.tsx` (+ `product-card.spec.tsx`, nội dung chuyển sang spec của `ui/product-card`); modify specs đụng tới.

- [ ] **Step 1:** `product-detail.tsx`: xoá `RelatedTile`; `bought-together` và "Cùng nhà"/"Có thể bạn thích" dùng `ProductRail variant="rail-md"`; Badge ghi đè `style` ở ~509 chuyển `tone="flash"`. `storefront-view.tsx` ~96, `brand-view.tsx` ~129: Badge ghi đè → `tone="flash"` / `verified`; lưới dùng `ProductGrid` (`showBrand={false}` ở trang thương hiệu). `wishlist.tsx`: `ProductGrid` với `imageOverlay` giỏ nhanh. `flash-sale.tsx`: vỏ thẻ `FlashSale` và `UpcomingFlashCard` → `ProductTile variant="flash"` (view dựng bằng `productCardView` từ suất Giờ vàng; thanh % + chữ đã bán, nút "Nhắc tôi", chữ mở bán nằm ở `footer`/`note`, giữ nguyên chữ và test id cũ).
- [ ] **Step 2:** chạy `npx vitest run src/pages src/components` (theo thư mục, từng nhóm), sửa spec nào gắn với cấu trúc cũ (không sửa kỳ vọng hành vi). **Step 3:** `grep -rn "CatalogTile\|RelatedTile\|components/product-card'" apps/miniapp/src` rỗng. **Step 4: commit** `refactor(miniapp): PDP, Giờ vàng, gian hàng, thương hiệu, Yêu thích dùng thẻ chung; xoá CatalogTile, RelatedTile`.

### Task 7: Mini: nút "Thêm vào giỏ" tự đổi "Đã thêm", huy hiệu giỏ nảy (PL-12)

**Files:** Modify `pages/product-detail.tsx` (nút thêm giỏ, chỗ `useNotify`), `components/ui/cart-badge.tsx` nếu cần; spec `pages/product-detail*.spec.tsx` hoặc file mới `pdp-add-feedback.spec.tsx`.

- [ ] **Step 1: test đỏ.** Thêm giỏ thành công → nút hiện icon Check + "Đã thêm" đúng 1.200ms (fake timers) rồi về nhãn cũ; `minWidth` khoá theo bề rộng trước khi đổi; vùng `role=status` (useNotify) nhận "Đã thêm vào giỏ"; `prefers-reduced-motion` không đổi kiểu chuyển (chỉ đổi chữ). **Step 2:** chạy đỏ. **Step 3:** cài đặt bằng state `justAdded`; chuyển chéo opacity + scale .92→1 160ms vào, 120ms ra; bỏ snackbar đầu màn khi không có ghi chú. **Step 4:** chạy xanh. **Step 5: commit** `feat(miniapp): nút thêm giỏ tự xác nhận "Đã thêm" 1,2s`.

### Task 8: Mini: spec chặn thẻ tự chế

**Files:** Create `apps/miniapp/src/components/ds-shop-guard.spec.ts`.

- [ ] **Step 1: viết spec (đỏ nếu còn sót).** Quét `apps/miniapp/src/**/*.{ts,tsx}` (bỏ `*.spec.*`): (a) không có chuỗi `CatalogTile` / `RelatedTile`; (b) `line-through` chỉ ở `components/ui/price-tag.tsx` (liệt kê ngoại lệ có sẵn có lý do, như `flash-sale.tsx` đã thay thì không còn); (c) `<Badge ... style={...background` không ghi đè nền (tông `flash`/`verified` thay). **Step 2:** chạy; nếu đỏ do chỗ còn sót thì chuyển nốt. **Step 3: commit** `test(miniapp): chặn thẻ sản phẩm tự chế và giá gạch ngoài PriceTag`.

### Task 9: web: PriceTag, ProductImage, WishlistHeart

**Files:** Modify `apps/web/src/components/mini/{price-tag,product-image}.tsx`, `apps/web/src/components/catalog/wishlist-heart.tsx` + specs (`mini/product.spec.tsx`, `wishlist-heart.spec.tsx`).

- [ ] **Step 1: test đỏ** cùng kỳ vọng như T2 (chữ đọc "Giá", ", giá gốc", `Giá Giờ vàng`, `tone="deal"`, `layout="stack"`, tim `Yêu thích ${tên}` + `aria-pressed`, ảnh hiện dần, `alt=""` cho ảnh trong thẻ có chữ (a11y P2-3)). **Step 2:** chạy đỏ. **Step 3:** cài đặt (sao chép logic, chữ lấy từ `fillTileCopy`). **Step 4:** chạy xanh. **Step 5: commit** `feat(web): PriceTag tone/layout/chữ đọc, ảnh hiện dần, tim có tên sản phẩm`.

### Task 10: web: `ProductTile`, `ProductCard`, `ProductGrid`, `ProductRail`, khung chờ

**Files:** Rewrite `apps/web/src/components/mini/{product-tile,product-card}.tsx`; create `mini/{product-grid,product-rail}.tsx`; modify `mini/skeleton.tsx`, `components/ui/skeleton.tsx`, `mini/index.ts`, `lib/{use-free-ship-threshold,use-flash-expiry}.ts` (mới); specs `mini/product-tile.spec.tsx`, `mini/product-card.spec.tsx`, `mini/product.spec.tsx`.

**Interfaces:** cùng props như Mini (T3, T4) trừ `href` là `next/link`; `ProductCard` ('use client') nhận `priority?: boolean` (số thẻ đầu `PRIORITY_CARDS = 4`, tải ảnh ngay) và `quickAdd` đổi tên `imageOverlay`. Một DOM, số đo như Mini ở khổ điện thoại; từ `md` thêm viền `border-stone-200`, `shadow-card`, hover nâng nhẹ, tên hover `text-forest-700` (giữ nhìn máy tính hiện có). Trước `useHydrated()`: không nhãn "Mới", không Giờ vàng (HTML ISR giống lần hydrate đầu).

- [ ] **Step 1: test đỏ.** Bộ spec của T3 (biến thể, `meta=null` cùng chiều cao, describedby thứ tự, hết hàng, hạng, `onAdd`) và của T4 (Giờ vàng thắng và hết hạn, `launchDate`, freeship, `useHydrated` false → render tĩnh không có nhãn "Mới"), thêm: link là `<a href="/san-pham/slug?v=…">` qua `productHref`; một thẻ chỉ có MỘT liên kết tới sản phẩm (tên), tim và nút là anh em, không lồng. **Step 2:** chạy đỏ. **Step 3:** cài đặt. **Step 4:** `npx vitest run src/components/mini`, xanh. **Step 5: commit** `feat(web): ProductTile, ProductCard, ProductGrid, ProductRail cùng số đo với Mini App`.

### Task 11: web: chuyển chỗ gọi, xoá thẻ cũ, spec chặn

**Files:** Modify `app/{gio-hang/empty-cart,tai-khoan/yeu-thich/page,brand/[slug]/page,s/[slug]/page,san-pham/[slug]/pdp-rails}.tsx`, `components/{home/best-seller-rail,home/suggest-feed,catalog/browse-view,catalog/recently-viewed-rail,affiliate/storefront-preview,reorder/purchased-rail,home/flash-sale}.tsx`, specs đụng tới; delete `components/product-card.tsx`, `components/product-card.spec.tsx` (ca còn giá trị chuyển sang `mini/product-card.spec.tsx`), `components/new-product-badge.tsx` nếu hết chỗ dùng; create `components/ds-shop-guard.spec.ts`.

- [ ] **Step 1:** đổi `import ProductCard from '@/components/product-card'` → `import { ProductCard } from '@/components/mini'`; lưới dùng `ProductGrid` (`GRID_PRODUCTS` giữ bên trong), kệ dùng `ProductRail`; `PRIORITY_CARDS` đổi nơi import. Nơi vẽ giá/thẻ riêng (`recently-viewed-rail`, `home/flash-sale`, `purchased-rail`) dùng `ProductTile`/`PriceTag` như Mini. **Step 2:** spec chặn: không `CatalogTile`/`RelatedTile`/`@/components/product-card`; `line-through` chỉ trong `mini/price-tag.tsx`. **Step 3:** chạy `npx vitest run src/components src/app` theo nhóm; sửa spec gắn cấu trúc cũ. **Step 4: commit** `refactor(web): mọi lưới và kệ dùng ProductCard chung; xoá thẻ cũ`.

### Task 12: Playwright `tile-rhythm`, chụp 375px Mini ↔ web, bundle, gate

**Files:** Create `apps/e2e/tests/tile-rhythm.miniapp.spec.ts`; ảnh ở `docs/2026-10-31-shop-redesign/screens/P4/` (gitignore).

- [ ] **Step 1: viết `tile-rhythm.miniapp.spec.ts`** (mock API như `buy-flow-4b-browse.miniapp.spec.ts`; dữ liệu có thẻ thiếu ảnh, thiếu sao/đã bán, tên dài có dấu "Ẩ", hết hàng): ở `/browse` và Trang chủ khối Gợi ý, trong mỗi hàng 2 thẻ chênh `bottom` của hàng giá ≤ 1px và chênh chiều cao thẻ ≤ 1px; mọi meta một dòng (`height` ≤ 16). Chạy `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3291 npx playwright test tile-rhythm`. Khi `buy-flow-4b` cũ còn kiểm lệch khung chờ ≤ 16px thì chạy lại nó.
- [ ] **Step 2:** dựng Vite Mini (cổng 3291) + Next web (cổng 3292), chụp 375px cùng dữ liệu mock, so, lưu `screens/P4/`, tắt server của mình.
- [ ] **Step 3:** gate đầy đủ một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base f299f8dcf --out <gate-P4.txt>`; FAIL nào cũng FAIL ở base thì ghi "có sẵn". Entry Mini ≤ 690 KB, ghi số trước (676) và sau.
- [ ] **Step 4: commit** `test(e2e): tile-rhythm 375px, thẻ cùng nhịp ở Danh mục và Gợi ý hôm nay`.

## Self-review (đã chạy)

- Phủ mục P4: `ProductTile`/`ProductCard`/`ProductGrid`/`ProductRail`/`PriceTag` hai app (T2–T4, T9–T10); thân thẻ cố định + khung chờ (T1, T3, T10); đổi mọi chỗ vẽ thẻ (T5, T6, T11); xoá `CatalogTile`, `RelatedTile`, thẻ chết web (T6, T11); tim `Yêu thích ${tên}` + `aria-pressed` (T2, T9); "Đã thêm" 1,2s (T7); spec `product-tile`, `ds-shop-guard` hai app, `tile-rhythm` (T3, T8, T11, T12); ngân sách entry (T1, T12).
- Nhất quán tên: `pickCardFlash`, `fillTileCopy`, `tileBodyHeight`, `useFreeShipThreshold`, `useFlashExpiry` dùng đúng một kiểu ở mọi task.
- Review Focus 1–6 mỗi dòng có test ở task trỏ tới.
