# Kế hoạch: nâng cấp gian hàng Tubu Tree

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development (mỗi gói: một agent làm, một reviewer kiểm) hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** làm lại gian hàng Mini App + web theo `01-thiet-ke.md`, thêm 4 nhóm chức năng bán hàng và cơ chế chặn lệch hệ thống cho việc sau.

**Kiến trúc:** logic thẻ/nhãn/chữ/luật kệ đặt ở `packages/app-core/src/commerce/` và `merch/`; Mini App (`apps/miniapp`, zmp-ui) và web (`apps/web`, Next + Tailwind) chỉ vẽ cùng tên thành phần, cùng props. API NestJS + Prisma thêm trường, endpoint, model cho chức năng mới, giá đi qua đường chia dòng sẵn có.

**Tech stack:** pnpm + turbo, NestJS/Prisma/Postgres, React 18 + zmp-ui + Vite (Mini App), Next 15 + Tailwind (web), vitest, jest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (quyết định ở §4 là luật). Báo cáo chi tiết: `review/*.md`.

Kế hoạch này chia đợt thành 17 gói. Mỗi gói có kế hoạch chi tiết riêng `plans/P<n>-<tên>.md` (định dạng writing-plans: task TDD, file, chữ ký, test) do agent làm gói viết ở bước đầu, dựa trên phần của gói trong file này. Phần dưới chốt những gì nhiều gói dùng chung: tên, chữ ký, route, thứ tự.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. `npx prisma generate` chạy trong `apps/api`.
- Chức năng cho khách: Mini App và web trong cùng gói. Route mới thêm vào `packages/app-core/src/route-map.json`; `pnpm lint:parity` xanh.
- Logic gọi API, giá, nhãn, chữ nằm ở `packages/app-core`; app không chép logic. Khả năng nền tảng qua `PlatformBridge`.
- Chữ giao diện tiếng Việt theo `01-thiet-ke.md` §4 Q5: "Bán chạy nhất", "Miễn phí giao hàng", "Được yêu thích", "Tubu chọn", "Mã giảm giá", "Thương hiệu", "Tạm hết hàng", "Ngừng bán", "Kết thúc sau {t}". Không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng". Bộ chữ mới lấy ở `review/ux-copy.md` mục B.
- Giá giảm màu `--color-text-price-deal` (= `--orange-700 #9A5200`); giá thường đen; không dùng đỏ.
- Tiêu đề khối Inter 16/700 -0.01em; Fraunces chỉ tiêu đề trang và số ≥22px.
- Bề rộng thẻ kệ chỉ `--tile-w-sm` 128px hoặc `--tile-w-md` 148px. Thẻ lưới cùng hàng chênh đáy giá ≤1px.
- Vùng chạm ≥44px, tương phản ≥4,5:1 cho chữ, axe 0 vi phạm ở 375px trên màn đụng tới.
- Chunk vào Mini App ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`); khối dưới màn đầu nạp lười kèm chiều cao giữ chỗ; trang mới là chunk theo route. Ghi số trước/sau trong PR khi entry đổi.
- Khung chờ Trang chủ không làm trang nhảy: khối mới có chiều cao trong `HOME_SETTLING_HEIGHTS` (`home-layout.ts`).
- Đường tiền: thứ tự giảm Giờ vàng → combo → mã → hạng → điểm, chia về `OrderItem.paidTotal`; một đơn một mã. Gói đụng giá có race test giỏ = báo giá = đặt đơn.
- Không deploy, không đọc/ghi PROD. Không kill tiến trình của người khác. Không `git stash` trần.
- Comment chỉ giải thích "vì sao" không hiển nhiên, theo mật độ comment của file xung quanh (tiếng Việt).

## Review Focus

1. Giờ vàng hết giờ khi khách đang xem (đồng hồ về 0): thẻ, PDP, giỏ trở về giá thường; nút thêm giỏ không đưa giá Giờ vàng cũ vào giỏ. Test: P2 `productCardView` với `now > endAt` trả `isFlash=false`; P8 test PDP đổi giá khi `Countdown.onEnd`.
2. Sản phẩm thiếu ảnh, thiếu sao, thiếu đã bán, tên tiếng Việt dài có dấu: thẻ vẫn cùng chiều cao, meta giữ chỗ, tên cắt 2 dòng. Test: P4 `tile-rhythm` (Playwright 375px) và vitest `ProductTile` với `meta=null`.
3. Khách chưa đăng nhập ở `/offers`, `/flash-sale`, trang shop, Bán chạy nhất: thấy nội dung, thao tác cần tài khoản mở cổng đăng nhập, không màn lỗi 401. Test: P12, P14, P9 mỗi gói một e2e persona `guest`.
4. Giờ vàng + combo + mã cùng lúc: giá thẻ/PDP/giỏ = số trừ khi đặt đơn, mỗi dòng lấy khoản giảm lớn nhất. Test: P15 race spec `bundle-price-parity`.
5. Kệ ít hơn `minItems`, API 404/500: khối ẩn hoặc hiện khối lỗi theo mẫu `home-block-error.tsx`, không nhảy trang. Test: P6 vitest `home-blocks` với nguồn rỗng/lỗi; P2 `applyShelfDedupe` làm kệ dưới `minItems` thì trả rỗng.

---

## Giao diện dùng chung (chốt cho mọi gói)

### app-core (P2 tạo; gói khác chỉ import)

Đường import: `@tubutree/app-core/commerce/<file>` và `@tubutree/app-core/merch/shelves` (package.json đã có `"./*": "./src/*.ts"`).

```ts
// commerce/product-card-view.ts
export type CardVariant = 'grid' | 'rail-sm' | 'rail-md' | 'flash' | 'rank' | 'line';
export type CardBadgeKind = 'flash' | 'discount' | 'combo' | 'featured' | 'loved' | 'new' | 'freeship';
export interface CardBadge { kind: CardBadgeKind; text: string; spoken: string }
export interface ProductCardInput {
  product: ProductCard;               // api/catalog.ts, có thêm trường P3 (fulfiller?, isLoved?)
  flash?: FlashPriceItem | null;      // flash-price.ts
  variant: CardVariant;
  now: number;
  rank?: number;
  inCombo?: boolean;
  showBrand?: boolean;                // mặc định true; trang thương hiệu truyền false
  freeShipThreshold?: number | null;  // ngưỡng miễn phí giao của khách; null = không gắn nhãn
}
export interface ProductCardView {
  id: string; slug: string; name: string; brandLine: string | null;
  price: number; compareAt: number | null; discountPct: number;
  isFlash: boolean; isDeal: boolean;
  imageBadge: CardBadge | null;       // slot A: flash -x% hoặc -x%, tối đa 1
  label: CardBadge | null;            // tối đa 1, ưu tiên combo > featured > loved > new > freeship
  meta: string | null;                // "★ 4,8 · Đã bán 1,2k+"
  stock: 'in' | 'out'; stockText: string | null; // "Tạm hết hàng"
  rank: number | null;
  spoken: { price: string; stock: string | null; badges: string | null };
}
export function productCardView(input: ProductCardInput): ProductCardView;

// commerce/card-meta.ts
export function formatRating(avg: number): string;                 // 4.8 -> "4,8"
export function formatSoldShort(n: number | null | undefined): string | null; // thay formatSold của miniapp utils/format.ts:63 và web lib/api.ts:445
export function cardMetaLine(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null;

// commerce/countdown.ts
export function countdownClock(ms: number): string;   // "02:05:33"; <1 giờ "05:33"; >24 giờ "2 ngày 03:15"; ≤0 "00:00"
export function countdownText(ms: number): string;    // "2 giờ 05 phút"; <1 phút "dưới 1 phút"
export function countdownSpoken(ms: number): string;  // "2 giờ 5 phút"

// commerce/flash-sold.ts
export function flashSoldText(pct: number, soldOut: boolean): string; // 0 -> "Vừa mở bán"; 1–89 -> "Đã bán n%"; ≥90 -> "Sắp hết"; soldOut -> "Đã bán hết"

// commerce/voucher.ts
export interface VoucherView { id: string; code: string; title: string; kind: 'discount' | 'freeship' | 'shop'; condition: string; expiry: string; state: 'collectable' | 'saved' | 'used' | 'expired' | 'soldout' | 'ineligible' }
export function couponLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string; // gộp 4 bản hiện có
export function voucherView(c: CouponDTO, now: number): VoucherView;
export function sortVouchers<T extends { expiresAt?: string | null }>(list: T[], now: number): T[]; // sắp hết hạn trước

// commerce/collection-view.ts
export const SECTION_BUDGET = { rail: 10, grid: 6, line: 5 } as const;
export const SHOP_MAX_SECTIONS = 6;
export interface SectionView<T> { layout: 'rail' | 'grid' | 'line' | 'combo'; items: T[]; total: number; hasMore: boolean; comboPct: number | null }
export function collectionView<T>(c: { kind: string; layout: string; items: T[]; comboDiscountPct?: number | null }): SectionView<T>;

// commerce/shop-stats.ts
export interface ShopStat { label: string; value: string; spoken: string }
export function shopStats(i: { productCount: number; ratingAvg?: number | null; sold?: number | null }): ShopStat[];

// merch/shelves.ts
export type ShelfScreen = 'home' | 'browse' | 'pdp' | 'shop' | 'offers' | 'flash';
export interface ShelfSpec { id: string; screen: ShelfScreen; intent: string; layout: 'rail' | 'grid' | 'line' | 'feed'; maxItems: number; minItems: number; dedupeRank: number | null; seeAllRoute: string | null }
export const SHELVES: readonly ShelfSpec[];
export function shelf(id: string): ShelfSpec;
export function applyShelfDedupe<T extends { id: string }>(shelves: { id: string; items: T[] }[]): { id: string; items: T[] }[];
// thứ tự dedupeRank: flash(1) > purchased(2) > combos(3) > bestSellers(4) > new(5) > suggest(6); cắt maxItems; kệ < minItems trả items []

// shop-copy.ts
export const SHOP_COPY: Record<string, string>;   // khoá chữ mua sắm dùng chung
export const FORBIDDEN_TERMS: readonly { pattern: RegExp; use: string }[];
```

### Thành phần (cùng tên, cùng props ở hai app)

Mini App: `apps/miniapp/src/components/ui/<tên>.tsx`. Web: `apps/web/src/components/mini/<tên>.tsx` (lớp giao diện khổ điện thoại đã có ở đó).

| Thành phần | Gói | Props chính |
|---|---|---|
| `ProductTile` | P4 | `view: ProductCardView; variant: CardVariant; href: string; onAdd?(): void; note?: string; priority?: boolean` |
| `ProductCard` | P4 | `product: ProductCard; variant: CardVariant; flash?: FlashPriceItem \| null; rank?: number; inCombo?: boolean; showBrand?: boolean; note?: string` (gọi `productCardView`, `useFlash`, ngưỡng miễn phí giao) |
| `ProductGrid`, `ProductRail` | P4 | `items: ProductCard[]; variant; rankFrom?: number` |
| `PriceTag` | P4 | thêm `tone?: 'default' \| 'deal'`, `layout?: 'inline' \| 'stack'`; luôn có chữ đọc "Giá", ", giá gốc" |
| `SectionHeader` | P5 | `title: string; icon?: IconName; tone?: 'default' \| 'promo'; trailing?: ReactNode; action?: { label?: string; to: string }` |
| `Section` | P5 | `id: string; spacing?: 'block' \| 'section'; children` |
| `Countdown` | P5 | `endAt: string; mode: 'clock' \| 'text'; onEnd?(): void` (role=timer, tên đọc cập nhật theo phút) |
| `FlashSoldBar` | P5 | `soldPct: number; soldOut?: boolean` (thanh aria-hidden, chữ luôn hiện) |
| `SortBar` | P5 | `value: string; options: { value: string; label: string; spoken?: string }[]; onChange(v): void; filterCount?: number; onFilter?(): void; sticky?: boolean` |
| `VoucherTicket` | P5 | `voucher: VoucherView; variant: 'ticket' \| 'chip' \| 'row'; primary?: { label: string; onClick(): void; busy?: boolean }; onDetail?(): void` |
| `ComboCard` | P5 | `title: string; items: ProductCardView[]; pct: number; total: number; comboTotal: number; onAddAll(): void; busy?: boolean` |
| `BannerCarousel` | P5 | `slides: { id: string; image: string; alt: string; href: string }[]; intervalMs?: number` (mặc định 5000; yêu cầu a11y P0 ở `review/a11y.md` mục B) |
| `ShopHeader`, `ShopStatsRow`, `ShopTopBar`, `ShopSection` | P9 | xem P9. Ràng buộc bố cục: `ShopSection` (Mini) đặt trong cột có lề trang 16px (kệ CAROUSEL lùi lề âm đúng 16px, như BLEED của web). P10 dùng `ShopSection` làm xem trước: hoặc khung xem trước giữ cột lề 16px, hoặc thêm prop `bleed?: boolean` (mặc định true) vào `ShopSection` Mini để tắt lề âm; không để khung khác lề mà vẫn dùng mặc định. `ShopHeader` (web) có prop `inStoreGrid` (mặc định false): chỉ truyền true khi nằm trong `header` của `StoreLayout` (từ lg gốc `lg:contents`, bìa và thông tin là ô của lưới); không truyền thì giữ bố cục điện thoại ở mọi khổ, nên xem trước gian hàng ở lg dùng `ShopHeader` trần |

### API (P3a, P3b tạo; tên hàm app-core là giao diện)

| Hàm app-core (file) | Endpoint | Ghi chú |
|---|---|---|
| `ProductCard` thêm `fulfiller?: ProductFulfiller; isLoved?: boolean` (api/catalog.ts) | `GET /products`, `/products/for-you`, `/products/:slug/related` | `isLoved` = ratingAvg ≥ cấu hình `catalog.loved_min_rating` (4.8), reviewCount ≥ `catalog.loved_min_reviews` (20), sold ≥ `catalog.loved_min_sold` (50) |
| `CatalogSort` thêm `'best_seller_30d'` | `GET /products?sort=best_seller_30d` | `soldApp30d` giảm dần, hoà theo `sold` tổng (§4 Q18); cột `Product.soldApp30d` + cron 03:00 |
| `CategoryDTO` thêm `parentId: string \| null; productCount: number; children: CategoryDTO[]`; `fetchCategories` trả cây | `GET /categories` | `productCount` cộng cả con; `/products?category=<cha>` gồm SP của con |
| `fetchBrandProducts(http, slug, { page, limit, sort })` (api/brand.ts) | `GET /brand/public/:slug/products` | phân trang thật, dùng `PUBLIC_PRODUCT_WHERE`; `BrandView.productCount` |
| `Storefront.collections[].comboDiscountPct` kẹp `storefront.max_combo_pct`; `Storefront.ownerTier.publicBadge: boolean` | `GET /storefronts/:slug` | ẩn bậc thấp nhất |
| `CartLine.listUnitPrice: number` | `GET /cart` | giá niêm yết trước Giờ vàng/sale, để hiện "Tiết kiệm" |
| `addCartItemsBatch(http, items: { variationId: string; quantity: number }[], addSource: AddToCartSource, storefrontSlug?: string \| null)` | `POST /cart/items/batch` | một transaction; lỗi một món thì không ghi món nào |
| `fetchUpcomingFlashSales` công khai | `GET /flash-sales/upcoming` | không phiên: `reminded=false` |

Route mới (thêm vào route-map.json, Mini ↔ web):

| Mini App | Web | Gói |
|---|---|---|
| `/flash-sale` | `/gio-vang` | P12 |
| `/best-sellers` | `/ban-chay` | P13 |
| `/campaign/:slug` | `/chien-dich/[slug]` | P11 |
| `/vouchers` | `/ma-giam-gia` | P14 |
| `/ds-gallery` (chỉ dev) | `/ds-gallery` (chỉ dev) | P5 (skip prod build) |

---

## Cách chạy mỗi gói

1. Tôi tạo worktree `.claude/worktrees/shop-P<n>` nhánh `shop/P<n>-<tên>` từ đỉnh nhánh tích hợp `shop/2026-10-31-redesign`.
2. Agent làm (sonnet) đọc `01-thiet-ke.md`, mục của gói trong file này và báo cáo được trỏ; viết `plans/P<n>-<tên>.md` theo writing-plans (task TDD, file, chữ ký, test, lệnh kiểm); làm theo từng task, commit nhỏ.
3. Agent chạy gate: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base <đỉnh tích hợp lúc tạo nhánh>` (tsc, eslint file đổi, vitest, jest API, lint:parity, build + bundle). Gói đụng API: thêm `npx prisma generate`, migrate vào DB tạm riêng, jest API. Gói đụng tiền: race suite liên quan.
4. Reviewer (agent `reviewer`, Opus) review diff theo spec + kế hoạch gói + Global Constraints; agent làm sửa; gói đụng tiền (P3b batch giỏ, P12 mua Giờ vàng, P14 nhận mã, P15) review lượt 2.
5. Tôi merge `--no-ff` vào nhánh tích hợp, chạy lại gate trên nhánh tích hợp; xong mỗi đợt mở PR nhánh tích hợp → main, merge khi CI xanh.
6. Đợt có giao diện: chụp lại màn đụng tới ở lane 7 (`docs/2026-10-31-shop-redesign/screens/capture-shop.mjs`), so trước/sau, ghi vào PROGRESS.

Khuôn trang web máy tính (`apps/web/src/components/layouts/`): P6 tạo `HubLayout`, P7 `ListingLayout`, P8 `PdpLayout`, P9 `StoreLayout`; gói sau dùng lại, P17 ghi vào `DESIGN.md`. Mỗi khuôn chỉ lo lưới lg (cột, độ rộng tối đa, vùng dính); dưới md trả nguyên con để khổ điện thoại giống Mini App.

Gói song song trong một đợt không được sửa chung file, trừ `route-map.json`, `shop-copy.ts` và file chữ `vi.ts` (gộp tay khi merge).

---

## Đợt 1: Nền (P1, P2, P3a, P3b song song)

### P1 `tokens-a11y`: token commerce + a11y nền
Nguồn: `review/design-system.md` B1, DS-07..DS-12; `review/a11y.md` P1 (focus, BottomSheet, snackbar, scroll-padding); `review/polish.md` PL-04, PL-09, PL-10.
- Token mới ở `packages/design-tokens/src/tokens.css` (+ ánh xạ Mini `apps/miniapp/src/css/tokens.css`, web tailwind preset): `--orange-700 #9A5200`, `--color-text-price-deal`, `--color-flash-fg` → orange-700, `--color-bg-media`, `--color-track`, `--color-bg-cover`, `--color-bg-chip`, `--color-voucher-*` (discount, freeship, shop: nền, viền, chữ), `--color-countdown-bg` (stone-900), `--tile-w-sm 128px`, `--tile-w-md 148px`, `--type-price-tile` (16/1.25/700), `--space-block 16px`, `--space-section 24px`, `--elevation-nav`, `--p-ease-spring`. Thay 24 chỗ trỏ primitive (DS-09).
- `Badge` mọi cỡ 12/600, thêm tone `flash`, `verified`; `Chip` md cao 36 + `.tubu-hit-44`, chưa chọn nền surface + viền `border-subtle`, chữ 600 cả hai trạng thái.
- Focus: `.zaui-btn:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:2px}` + quy tắc `:focus-visible` chung; `scroll-padding` cho `.zaui-page` và web `html`.
- Nhấn: `.tubu-press` co .96 (nút), `.tubu-press-card` co .985 (thẻ), bỏ đổi opacity; một listener `touchstart` passive ở `apps/miniapp/src/components/app.tsx`.
- Thanh dưới (polish PL-10, hai app): icon tab đang chọn tô 16% (prop `filled` cho `Icon`), nhãn 12px nét 500/600, `--elevation-nav` thay viền + bóng cũ, icon nảy .88→1 trong 220ms (tắt khi reduced-motion).
- `BottomSheet` Mini thành hộp thoại (chép `apps/web/src/components/mini/bottom-sheet.tsx:55-104` + test).
- `useNotify()` (`apps/miniapp/src/hooks/use-notify.ts`): ghi vùng `role=status`/`role=alert` trong `app.tsx` và gọi `openSnackbar`; đổi các file trong phạm vi đợt (PDP, brand-view, coupon-use) sang hook.
- `packages/design-tokens/package.json` thêm `"test": "vitest run"`; `ci.yml` thêm bước `pnpm lint:vars`; `contrast.spec.ts` thêm cặp: deal trên trắng ≥4,5, stone-900 chữ trên flash-solid ≥4,5, countdown chữ trắng trên stone-900.
- Test chứng minh: `contrast.spec` các cặp mới; `bottom-sheet.spec` (role=dialog, Esc đóng, trả focus); `use-notify.spec` (vùng status có chữ, bỏ emoji); `badge.spec` cỡ 12; `tokens` spec design-tokens chạy trong turbo.

### P2 `commerce-core`: logic dùng chung
Nguồn: `review/design-system.md` B2–B3, `review/ia-merch.md` C1 + F, `review/ux-copy.md` B + D, `review/a11y.md` P1 giá/nhãn đọc.
- Tạo đúng các file + chữ ký ở "Giao diện dùng chung / app-core". Chuyển `couponLabel` (4 bản), `formatSold` (2 bản), `formatCountdown` cũ về đây; bản cũ re-export để không vỡ chỗ gọi (gói màn sẽ đổi chỗ gọi).
- `SHELVES` khai: home `flash` (rail, max 8, min 3, rank 1, `/flash-sale`), `purchased` (line, max 10, min 1, rank 2, `/orders`), `combos` (rail, 4, 2, 3, null), `bestSellers` (rail, 10, 3, 4, `/best-sellers`), `suggest` (feed, 100, 4, 6, `/browse`); browse `recent`, `bestSellers`; pdp `combos` (2), `addons` (3), `boughtTogether`, `related` (feed); shop `section` (theo `SECTION_BUDGET`); offers `flash` (4).
- `shelves.spec.ts` chặn: thiếu `maxItems/minItems`; `seeAllRoute` không có trong `route-map.json`; hai kệ cùng `intent` trên một `screen`; `home` có >4 kệ hàng (`layout` khác `feed` và không tính `purchased` khi đối tượng là khách mới).
- `SHOP_COPY` + `FORBIDDEN_TERMS` + `shop-copy.spec.ts` (chữ ≤ ngân sách độ dài ở `review/ux-copy.md` C).
- Test chứng minh (vitest trong `packages/app-core`): `productCardView` (flash đang chạy → `isFlash`, `imageBadge.kind='flash'`, `isDeal`; `now > endAt` → giá thường; hết hàng → `label=null`, `imageBadge=null`, `stockText='Tạm hết hàng'`; ưu tiên nhãn combo > featured > loved > new > freeship; freeship chỉ khi `fulfiller` là Tubu và `price ≥ freeShipThreshold`); `cardMetaLine({ratingAvg:4.8,sold:1234})==='★ 4,8 · Đã bán 1,2k+'`; `countdownClock(7533000)==='02:05:33'`, `countdownClock(333000)==='05:33'`, `countdownClock(2*86400000+11700000)==='2 ngày 03:15'`; `flashSoldText(0,false)==='Vừa mở bán'`, `(68,false)==='Đã bán 68%'`, `(92,false)==='Sắp hết'`, `(100,true)==='Đã bán hết'`; `applyShelfDedupe` loại id đã có ở kệ hạng cao hơn và trả `[]` khi dưới `minItems`; `collectionView` CAROUSEL → `rail` cắt 10, GRID → `grid` cắt 6 + `hasMore`, STACK → `line` cắt 5, kind COMBO → `combo` + `comboPct`.

### P3a `catalog-api`
Nguồn: `review/backend-gap.md` §1–2, §8; `review/ia-merch.md` IA P0, C2.
- Theo bảng API: `fulfiller` + `isLoved` vào `toCard` (`catalog.service.ts:632-663`) và `ProductCard`; `Product.soldApp30d Int @default(0)` + index + cron 03:00 tính từ `OrderItem` đơn đã giao 30 ngày; `sort=best_seller_30d`; cây danh mục + `productCount` + lọc cha gồm con; `fetchBrandProducts` + `productCount` (sửa cắt cứng 30 ở `brand.service.ts:115`); `related()` sắp theo `sold`.
- Ba khoá cấu hình `catalog.loved_*` có mặc định ở bảng API.
- Test: jest service (isLoved theo ngưỡng; sort 30d hoà theo sold; danh mục cha đếm cả con; brand phân trang + total); test cron với dữ liệu 31 ngày trước bị loại; app-core `catalog.spec` cho kiểu mới.

### P3b `cart-storefront-api`
Nguồn: `review/backend-gap.md` §4, §8 (P2 batch, clamp); `review/critique-store.md` Q1; `review/critique-shop.md` 4.4.
- `CartLine.listUnitPrice`; `POST /cart/items/batch` + `addCartItemsBatch`; kẹp `comboDiscountPct` ở `storefront.service.ts:365`; `ownerTier.publicBadge`; `/flash-sales/upcoming` công khai (`flash-sale.controller.ts:20`).
- Test: jest batch (một món hết hàng → không món nào vào giỏ, trả lỗi có `variationId`); race spec batch song song với update giỏ không nhân đôi số lượng; clamp; upcoming không token trả 200 và `reminded=false`.

## Đợt 2: Thành phần (P4, P5 song song; cần P1, P2)

### P4 `product-tile`
Nguồn: DS B2/B4/B6, critique-shop CS-01, polish PL-01..03 + PL-13 (ảnh hiện dần, tim nảy), a11y P1 (describedby, tim, giá gạch), web P1 thẻ.
- `ProductTile` + `ProductCard` + `ProductGrid` + `ProductRail` + `PriceTag` mở rộng ở cả hai app, đúng props bảng thành phần. Thân thẻ cố định (tên 2 dòng 22px/dòng, hàng giá neo đáy bằng `margin-top:auto`, meta nowrap + ellipsis), cập nhật `TILE_BODY_HEIGHT` + skeleton.
- Đổi mọi chỗ vẽ thẻ sang `ProductCard`: home (best-seller, suggest, purchased, flash), catalog-grid, recently-viewed, suggested-rail, PDP related/bought-together, storefront-view, brand-view, wishlist; web tương ứng. Xoá `CatalogTile`, `RelatedTile`, `apps/web/src/components/mini/product-tile.tsx` chết. Tim yêu thích: nhãn `Yêu thích ${tên}` + `aria-pressed`.
- Nút "Thêm vào giỏ" ở PDP tự đổi "Đã thêm" 1,2s (polish PL-11), huy hiệu giỏ nảy.
- Test: vitest `product-tile.spec` (mỗi biến thể; `meta=null` vẫn giữ chiều cao; `spoken.price` trong `aria-describedby`); spec cấm thẻ tự chế (`ds-shop-guard.spec.ts` ở hai app: không import `CatalogTile`/`RelatedTile`, không `line-through` ngoài `price-tag.tsx`); Playwright `tile-rhythm.spec.ts` (E2E_SCOPE=miniapp, 375px: chênh đáy giá trong hàng ≤1px ở `/browse` và Trang chủ Gợi ý).

### P5 `section-kit`
Nguồn: DS B5, B7–B10, critique-shop SortBar, critique-store VoucherTicket/ComboCard, polish PL-07/08, a11y mục B (yêu cầu cho thành phần mới).
- `SectionHeader`, `Section`, `Countdown`, `FlashSoldBar`, `SortBar`, `VoucherTicket`, `ComboCard`, `BannerCarousel` ở hai app, đúng props. Chưa gắn vào màn (gói màn làm), trừ thay `SectionHeader` cho 3 chỗ "Xem tất cả" chép tay.
- `/ds-gallery` ở hai app (chỉ khi dev; Mini lazy route, web `notFound()` ở production) vẽ mọi biến thể + trạng thái của P4, P5. route-map dòng `skip` cho bản prod nếu lint yêu cầu.
- Test: `countdown.spec` (fake timers: mode clock đổi mỗi giây, `aria-label` chỉ đổi theo phút, `onEnd` gọi đúng một lần); `banner-carousel.spec` (`matchMedia('(prefers-reduced-motion: reduce)')` → không tự chạy; nút Dừng `aria-pressed`; slide ngoài khung `inert`; focus vào banner thì dừng); `flash-sold-bar.spec` (thanh aria-hidden, chữ hiện ở mọi pct); `sort-bar.spec` (đổi sort gọi onChange, "Lọc (2)"); `voucher-ticket.spec` (6 trạng thái, một nút chính).

## Đợt 3: Màn (P6–P10 song song; cần P3a, P3b, P4, P5)

### P6 `home` (Mini + web)
Nguồn: critique-shop 4.1 + sơ đồ A, ia-merch C5 + D2, polish PL-05/12, web P1 Trang chủ 1280, §4 Q6, Q7, Q11, Q13.
- Thứ tự khối ở `home-layout.ts` theo `01-thiet-ke.md` §5 (khách cũ/mới/chưa biết); thêm id `banner`, `combos` (render rỗng tới khi P11/P15 có dữ liệu; ẩn, không giữ chỗ khi lần trước không có, giống `FLASH_HINT_KEY`); kệ nối `SHELVES` + `applyShelfDedupe`.
- Header dính 56px (logo, tìm, chuông, giỏ); thẻ thành viên nền sáng; Việc cần làm 1 dòng; lối tắt 4 + "Tất cả" (sheet); Giờ vàng gọn (`SectionHeader tone=promo` + `Countdown mode=clock` + `ProductRail variant=flash` ≤8 + dòng "Suất kế tiếp {giờ} · {n} món · Nhắc tôi"); Mua lại 1 món = 1 dòng 88px; danh mục lưới 2×5; Bán chạy nhất cho cả hai loại khách (`variant=rank`); Gợi ý hôm nay: chip danh mục, `?seed=YYYYMMDD` xoay thứ tự (API `for-you`/`products` nhận `seed`), dừng 100 (máy tính 48).
- Web lg: lưới 12 cột (banner col-8 + cột phải thẻ thành viên/việc cần làm), ẩn lối tắt.
- Test: `home-layout.spec` thứ tự mới 3 loại khách; `home-blocks.spec` dedupe + ẩn khi rỗng/lỗi; Playwright Trang chủ returning 375: khối Giờ vàng có `boundingBox().y + height ≤ 812` khi không có banner; CLS đo bằng `PerformanceObserver` ≤0,02.

### P7 `browse` (Mini + web)
Nguồn: ia-merch C2, critique-shop 4.2, web P1 Danh mục 1280, §4 Q13.
- Gốc `/browse` = hub (danh mục tầng 1, Đã xem, Bán chạy nhất 10, logo thương hiệu, nút "Xem tất cả sản phẩm"); chế độ danh sách: `SortBar` dính (Phổ biến/Liên quan · Bán chạy · Mới · Giá ⇅ · Lọc (n)), chip tầng 2 khi danh mục có con, tiêu đề một lần + số SP caption, 20 món/trang. Chip "Giá thấp/Giá cao".
- Web lg: h1 theo danh mục/từ khoá + breadcrumb, cột lọc 200px cuộn theo trang, phân trang số; nút "Xem thêm" dùng `aria-disabled` + chuyển focus vào thẻ đầu trang mới.
- Test: vitest hub không gọi `fetchCatalog` khi ở gốc; SortBar đổi `sort` trên URL; danh mục cha hiện chip con; Playwright 375 thẻ đầu ở y ≤ 200 trong chế độ danh sách.

### P8 `pdp-cart` (Mini + web)
Nguồn: critique-shop 4.3 + 4.4, ia-merch C3, web P0 + P1 PDP, polish PL-08/11, ux-copy (hai dòng "Còn", "Khách thường mua cùng"), §4 Q8.
- PDP: `FlashPriceBar` dưới ảnh (giá deal, -%, `Countdown`, `FlashSoldBar`, "Mỗi khách tối đa {n}"); chip phân loại lấy giá qua `variationPricing` (sửa lỗi 120.000đ vs 84.000đ); `ListRow` "›" cho Ưu đãi/Vận chuyển/Phân loại; một dòng mã giảm mở sheet `VoucherTicket variant=row`; Đánh giá nhanh 2 mục; "Khách thường mua cùng"; "Có thể bạn cũng thích" (feed cuối trang); để chỗ cho Combo/Mua kèm (P15 điền). Đồng hồ hết giờ → đổi về giá thường (Review Focus 1).
- Web lg: lưới 440px + phần còn lại trong một thẻ trắng, bỏ cột cuộn riêng; nút mua trong khung nhìn 1280×800.
- Giỏ: dòng ~124px, giá gạch + "Tiết kiệm" từ `listUnitPrice`, Countdown thay "Đã bán 98%", chân dính (mã, miễn phí giao, tổng + tiết kiệm + nút).
- Test: vitest chip phân loại hiện giá Giờ vàng; PDP `onEnd` đổi giá; giỏ hiện "Tiết kiệm {x}" khi `listUnitPrice > unitPrice`; Playwright web 1280×800 nút "Thêm vào giỏ" `toBeInViewport()`.

### P9 `shop-page` (Mini + web, `/s/:slug` + `/brand/:slug`)
Nguồn: critique-store (4.1, 4.3, sơ đồ), ia-merch C4, web P1 gian hàng/thương hiệu, backend-gap §4, §4 Q9, Q12.
- `ShopHeader` (bìa phẳng `--color-bg-cover`, avatar thống nhất, tên, bậc nếu `publicBadge`, nút Theo dõi cho thương hiệu), `ShopStatsRow` (`shopStats`), voucher shop `VoucherTicket variant=chip`, `SegmentedTabs` Shop | Sản phẩm (n) | Danh mục (+ Câu chuyện cho thương hiệu), `ShopTopBar` hiện tên shop khi cuộn qua bìa; `ShopSection` theo `collectionView`; COMBO → `ComboCard` + "Thêm cả combo" gọi `addCartItemsBatch`. Tab Sản phẩm: `fetchCatalog` (CTV) hoặc `fetchBrandProducts` (thương hiệu) + `SortBar`. `ProductCard showBrand=false` ở trang thương hiệu. Ghi chú CTV qua prop `note`. Web lg: `StoreLayout` (bìa + đầu shop một hàng, lưới 5–6 cột, `SortBar`, phân trang số), bỏ bìa gradient tối.
- Test: vitest `ShopSection` theo 4 layout và cắt ngân sách; "Thêm cả combo" lỗi → báo lỗi, giỏ không đổi; Playwright guest `/s/uatctv` tab Sản phẩm có phân trang.

### P10 `storefront-builder` (Mini + web)
Nguồn: critique-store 4.2, ia-merch IA-07, a11y P1 trình dựng, backend-gap (API đã nhận layout/kind/combo ở `storefront.controller.ts:46-53`).
- Màn chính: `SectionCard` (tên, kiểu, x/y món, dải ảnh, cảnh báo vượt ngân sách hoặc >6 khối); trang chi tiết khối: `LayoutPicker` 4 ô (Lưới/Kệ ngang/Danh sách/Combo), ô % combo kẹp `clampComboPct`, xem trước bằng `ShopSection` thật; chế độ Sắp xếp riêng (nút ↑↓ có tên món, `aria-disabled` ở đầu/cuối, notify vị trí mới); Hành trình thành dải 56px mở sheet; thống kê 30 ngày lên đầu khi gian hàng LIVE. `LAYOUT_LABEL`/`KIND_LABEL` chuyển lên app-core.
- Test: vitest tạo khối COMBO gửi `kind`, `layout`, `comboDiscountPct`; nút ↑ ở đầu danh sách `aria-disabled` và giữ focus; preview dùng `ShopSection`.

## Đợt 4: Chức năng (P11–P16; P11, P12, P13, P14, P16 song song; P15 riêng sau cùng)

### P11 `campaigns`
Nguồn: backend-gap §3, ia-merch D3, a11y P0 banner.
- Prisma: `Campaign { id, slug @unique, title, placement (HOME_TOP|OFFERS_TOP), image, linkType (CAMPAIGN_PAGE|PRODUCT|CATEGORY|URL_INTERNAL), linkValue, audience (ALL|NEW|RETURNING), startAt, endAt, sortOrder, isActive }`, `CampaignProduct`, `CampaignCoupon`; ảnh loại `campaign` ở `public-image.ts`. API `GET /campaigns?placement=`, `GET /campaigns/:slug`, `GET /campaigns/:slug/products`; banner gộp vào phần tĩnh của `/home` (cache công khai). Admin `/admin/campaigns` CRUD + tải ảnh.
- Gắn `BannerCarousel` vào Trang chủ (khối `banner`) và `/offers`; trang `/campaign/:slug` ↔ `/chien-dich/[slug]` (ảnh đầu, mã gắn kèm, lưới SP).
- Test: jest lọc theo lịch + đối tượng; e2e banner ẩn khi không có chiến dịch; trang chiến dịch hết hạn trả 404 thân thiện.

### P12 `flash-slots`
Nguồn: backend-gap §1, ia-merch D1, a11y P0 thanh % + tab, ux-copy (perUserLimit), §4 Q3, Q14.
- API: `GET /flash-sales/slots` (hôm nay + ngày mai, khung từ `flashsale.slots` mặc định `["12:00","20:00"]`), `GET /flash-sales/slots/:id/items` (gồm món hết suất, `soldOut`, `perUserLimit`; PublicCache LIVE); `FlashSaleItem.sortOrder` + admin đặt thứ tự; `listActive` thêm `saleId/title/startAt` + `limit` cho dải Trang chủ; lỗi vượt giới hạn trả `{ code: 'FLASH_LIMIT', limit: n }`.
- Trang `/flash-sale` ↔ `/gio-vang`: `SlotTabs` (tablist, roving tabindex, mũi tên), `Countdown mode=clock`, chip danh mục, `ProductTile variant=line` + `FlashSoldBar` + Mua ngay/Nhắc tôi, món hết suất mờ cuối. Câu lỗi: "Giá Giờ vàng chỉ áp cho {n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé."
- Test: jest slots theo cấu hình; race: hai khách mua món cuối suất → một thành công; vitest SlotTabs phím mũi tên; e2e guest xem suất sắp tới, bấm Nhắc tôi mở cổng đăng nhập.

### P13 `best-sellers`
- Trang `/best-sellers` ↔ `/ban-chay`: tab danh mục tầng 1 (+ "Tất cả"), `ProductTile variant=rank`, `sort=best_seller_30d`, 20 món. Kệ Bán chạy nhất Trang chủ và hub Danh mục trỏ tới đây.
- Test: vitest tab đổi `category`; thẻ có số hạng 1..n.

### P14 `vouchers`
Nguồn: backend-gap §3 (kho voucher), critique-store /offers, ia-merch C6, web P1 Ưu đãi, §4 Q10, Q13.
- Prisma: `Coupon.listed Boolean @default(false)`, `Coupon.title String?`; chặn bật `listed` cho mã lô thẻ in. API `GET /coupons/collectable` (+ `claimedCount`, trạng thái của khách nếu có phiên); nhận bằng `POST /coupons/claim` sẵn có. Admin bật listed + tiêu đề.
- `/vouchers` ↔ `/ma-giam-gia`: tab Nhận mã / Mã của tôi / Đã dùng–hết hạn, chip lọc (Tất cả/Giảm giá/Miễn phí giao hàng/Của shop/Sắp hết hạn), `VoucherTicket`, `sortVouchers`. `/offers` theo Q10 (route `private:false`, khối cần tài khoản vẽ `GuestLinkCard`); web `/uu-dai` rời `AccountShell`, lưới 3 cột ở lg. Chỗ chọn mã ghi "Mỗi đơn dùng 1 mã".
- Test: jest collectable chỉ trả `listed` còn hạn còn lượt; race nhận mã lượt cuối; e2e guest `/offers` thấy Giờ vàng + Nhận mã.

### P15 `bundles` (đụng tiền, review hai lượt)
Nguồn: backend-gap §4–6, ia-merch D4, critique-shop (PDP combo/mua kèm), §4 Q15.
- Prisma `Bundle { id, kind (BUNDLE_PCT|ADDON), title, pct?, anchorProductId?, isActive, startAt, endAt }`, `BundleItem { bundleId, productId, variationId?, addonPrice? }`; loại hàng đối tác (`partner-goods.ts`); `addonPrice ≥ 0`. Quy về `comboPerLine`/`Order.comboDiscount` sẵn có; mỗi dòng lấy khoản giảm lớn nhất giữa combo gian hàng và bundle; trần giá nhân viên; hoa hồng theo `paidTotal` (kiểm luật hiện có, ghi kết luận vào plan gói).
- UI: PDP "Combo ưu đãi" (≤2 `ComboCard`) + "Mua kèm deal sốc" (≤3 dòng có checkbox), giỏ hiện dòng giảm combo, khối `combos` Trang chủ; admin `/admin/bundles`.
- Test: race `bundle-price-parity` (giỏ = báo giá = đặt đơn với Giờ vàng + bundle + mã); trả một món của combo hoàn đúng `paidTotal` dòng; jest hết hạn bundle không giảm.

### P16 `category-admin`
- Admin `/admin/categories`: cây 2 tầng (≤8 × ≤8, kéo hoặc ↑↓), gán hàng loạt SP vào lá (lọc theo tên/thương hiệu), hộp việc "SP chưa có danh mục (n)" ở trang admin chính. Đồng bộ Pancake không xoá danh mục đã gán tay.
- Test: jest gán hàng loạt idempotent; Pancake sync giữ `categoryIds` đã có.

## Đợt 5: Cơ chế + chốt (P17, rồi chụp so)

### P17 `mechanism`
Nguồn: design-system C1–C5, web M-1..M-6, ux-copy D, a11y C, ia-merch F, `01-thiet-ke.md` §6.
- `DESIGN.md` (gốc repo): nguyên tắc, token, bảng thành phần + biến thể, luật kệ (`SHELVES`), luật nhãn, chữ chuẩn + thuật ngữ cấm, khuôn trang web (`ListingLayout/PdpLayout/StoreLayout/HubLayout`), cách thêm màn mới.
- `docs/design/ds-map.json` (thành phần → file Mini → file web → màn) + `scripts/check-ds-parity.mjs` gắn vào `lint:parity` (thành phần trong map phải có ở cả hai app).
- `.gitignore`: `.claude/` → `.claude/*` + `!.claude/skills/`; `.claude/skills/tubu-ui/SKILL.md` (khi nào dùng, thành phần nào, khai kệ, lấy chữ, chạy kiểm gì, chụp so 375px); dòng trỏ skill trong `AGENTS.md`; `.github/pull_request_template.md` mục Giao diện.
- Bài kiểm chặn (baseline lấy sau đợt 4, chỉ được giảm): `ds-shop-guard.spec.ts` hai app (thẻ tự chế, giá gạch ngoài PriceTag, primitive màu ngoài `css/` và `components/ui`, `Text` zmp-ui trong trang mua sắm, gọi thẳng `openSnackbar`); `terminology.spec.ts` (FORBIDDEN_TERMS trên `apps/*/src`); `px-ratchet` + `max-md-ratchet` (baseline JSON ở `scripts/uiux/ds-baseline.json`); e2e `ds-parity.shop.spec.ts` so computed style 375px Mini vs web cho thẻ, tiêu đề khối, giá; axe smoke 375px các màn mua sắm.
- Test chứng minh: mỗi bài kiểm có một ca cố ý vi phạm (fixture) để thấy nó đỏ, rồi xanh trên mã thật.

### Chốt đợt
- Chụp lại toàn bộ màn trong phạm vi ở lane 7 (3 khổ), một agent review hình (design-critique) so với `screens/` cũ và `01-thiet-ke.md`; sửa P0/P1 còn lại.
- PR cuối vào main; cập nhật memory + PROGRESS; báo chủ việc của chủ (§7 thiết kế).
