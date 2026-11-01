# G4 `home-polish` (đợt 6b): P2 Trang chủ và MINOR còn lại của F10a, F9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các lỗi nhỏ còn lại của Trang chủ ở Mini App và web: Mua lại không biến mất khi chỉ khác phân loại với món Giờ vàng, kệ Bán chạy nhất không ghi số hạng gây hiểu lầm, tiêu đề "Hành trình nguyên liệu"/"Cộng đồng hỏi đáp" dùng `SectionHeader`, lời chào thành viên dùng tên gọi, Bán chạy nhất không tụt dưới 3 món khi có 3–4 combo, ghi chú Giờ vàng "Tối đa n/khách" có tên đọc không đọc dấu "/".

**Architecture:** Logic chọn khoá chống trùng, tên gọi và điều kiện bỏ số hạng nằm ở `packages/app-core` (`merch/home-shelves.ts`, `person-name.ts`, `commerce/flash-slots.ts`) kèm spec; Mini App và web chỉ nối vào và vẽ. Mỗi sửa giao diện có test đỏ trước (vitest theo file); e2e Mini chạy bộ đầy đủ một lần ở cuối.

**Tech Stack:** TypeScript, vitest (app-core, Mini, web), jest (API, chỉ `home.service.spec`), Playwright (e2e Mini), React Query v5.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1, Q4, Q6, Q18), §5 ("Trang chủ", thứ tự chống trùng); `review/final-critique.md` P2 số 3, 4, 5, 7; danh sách MINOR F10 dòng `[F10a]`; `plans/F9-home-combos-dedupe.md` mục "Sửa theo review vòng 1" (MINOR `HOME_BEST_SELLER_LIMIT`).

## Quyết định thiết kế (chủ giao "tự chốt thiết kế"; ghi vào `01-thiet-ke.md` §5, chủ đổi được sau)

1. **P2 #3, Mua lại vs Giờ vàng chống trùng theo phân loại (`variationId`), không theo slug.** Khách đã mua Can 5L vẫn thấy Can 5L ở Mua lại khi Can 1L đang Giờ vàng. Các kệ còn lại (combo, Bán chạy nhất, Gợi ý) giữ chống trùng theo slug như F9: Giờ vàng và Mua lại vẫn chiếm slug của món cho các kệ dưới.
2. **P2 #4, Bán chạy nhất giữ chống trùng nhưng ẩn số khi hạng hụt.** Hạng hiển thị không liền từ 1 (có hạng bị kệ trên chiếm) thì thẻ ghi "Bán chạy" thay "#n"; hạng liền 1..k thì giữ số. Màu phù hiệu khi không ghi số luôn là màu hạng thường (không vàng/bạc/đồng), để không ngầm xếp thứ tự.
3. **P2 #7, tên gọi = từ cuối của họ tên Việt** ("Nguyễn Thị Quay Lại" → "Lại"; "Chào Lại"). Thanh đầu web (`site-header.tsx`) dùng cùng helper. Chữ "Lại" trên thanh đầu của ảnh chụp là tên gọi thật của người dùng thử UAT "Nguyễn Thị Quay Lại", không phải lỗi chữ.
4. **F9 MINOR, nâng `HOME_BEST_SELLER_LIMIT` từ 12 lên 24** (= trần kệ 10 + dư 2 + `HOME_COMBOS_LIMIT` 4 × 3 món một combo thường gặp), không chặn số món một combo chiếm (combo là đơn vị nguyên, chặn là để món trùng lặp ở hai kệ).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Chức năng cho khách: Mini App và web cùng gói, cùng tên thành phần, cùng props; logic ở `packages/app-core`, app không chép logic.
- Chữ giao diện qua `shop-copy.ts`/`tile-copy.ts` kèm ngân sách độ dài ở `shop-copy-budget.ts` (spec ép cùng tập khoá). Không thuật ngữ cấm ("Top", "Freeship", "Nhãn hàng", "Kho voucher").
- Tiêu đề khối Inter 16/700 -0.01em (Q1). Giá giảm `--color-text-price-deal`. Vùng chạm ≥44px, axe 0 vi phạm ở 375px.
- `pnpm lint:parity` chạy bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`): không thêm số px viết tay hay `max-md:`; hạ được thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline.
- KHÔNG sửa file của G1 (`voucher.ts`, `voucher-ticket`, Ưu đãi, `brand-view` chip phiếu, `GuestLinkCard`), G5 (`components/catalog/*`, `scroll-rail.tsx`, `ban-chay/*`, `browse/hub.ts`, `category-row.tsx`, `product-card-view.ts`, `campaign-body.tsx`, `DESIGN.md`), G6 (trình dựng gian hàng, `phone-ui.ts`, `button.tsx`, `tokens.css .tubu-btn`, `sticky-action-bar.tsx`, `shop-top-bar.tsx`, `brand-body.tsx`, `shop-section.tsx`). Nếu buộc phải đụng, ghi vào notes.
- Máy chung thiếu RAM: lúc làm chỉ vitest theo file; gate đầy đủ đúng một lần ở cuối. Không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình không phải của mình.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Khách cũ mua Can 5L, Giờ vàng đang có Can 1L cùng slug: Mua lại vẫn hiện Can 5L; mua đúng Can 1L thì Mua lại bỏ nó. Test: Task 2 (app-core `home-shelves.spec`, hook Mini và web).
2. Mua lại có hai phân loại của cùng một sản phẩm (Can 1L và 5L đều từng mua): cả hai hiện, Bán chạy nhất vẫn bỏ sản phẩm đó (slug bị chiếm). Test: Task 2.
3. Tên có khoảng trắng thừa, một từ, rỗng, null, chỉ emoji, ngoặc cuối ("Hoa (Mẹ Bắp)"): không cắt giữa từ, không "Chào undefined", rỗng thì "bạn". Test: Task 1.
4. Hạng Bán chạy nhất `[1,2,4,5]` hoặc `[2,3]` (kệ trên chiếm hạng 1): không ghi số, chữ đọc vẫn nói "Bán chạy" chứ không "Hạng 4 bán chạy"; `[1,2,3]` giữ số; trang `/best-sellers` (hạng liền theo `rankFrom`) không đổi. Test: Task 3.
5. Bốn combo mỗi combo 3 món đều là 12 món bán chạy nhất, kèm Giờ vàng và Mua lại chiếm thêm: Bán chạy nhất vẫn ≥ 3 món. Hằng API và app-core không lệch (Mini chỉ dùng khối gộp khi `limit` trùng đúng). Test: Task 4.
6. Ghi chú Giờ vàng không có giới hạn hợp lệ (0, NaN, âm) hoặc không có phân loại: chữ đọc rỗng, không "Tối đa 0 sản phẩm". Test: Task 6.

---

### Task 1: Tên gọi cho lời chào thành viên (P2 #7)

**Files:**
- Create: `packages/app-core/src/person-name.ts`, `packages/app-core/src/person-name.spec.ts`
- Modify: `apps/miniapp/src/components/home/member-card.tsx:88`, `apps/web/src/components/home/member-card.tsx:58`, `apps/web/src/components/site-header.tsx:72-76`
- Test: `apps/miniapp/src/components/home/member-card.spec.tsx`, `apps/web/src/components/home/member-card.spec.tsx`, `apps/web/src/components/site-header.spec.tsx`; sửa `apps/e2e/tests/shop.web.spec.ts:751` (`Chào Nguyễn Văn An` → `Chào An`)

**Interfaces:**
- Produces: `export function givenName(fullName: string | null | undefined): string | null` (`@tubutree/app-core/person-name`): từ cuối của họ tên sau khi cắt khoảng trắng; bỏ dấu câu/emoji ở hai đầu từ; từ cuối rỗng sau khi bỏ thì lùi về từ trước nó; không còn từ nào thì `null`.

- [ ] **Step 1: Test đỏ** `person-name.spec.ts`: `givenName('Nguyễn Thị Quay Lại') === 'Lại'`; `'  Nguyễn   Văn An  ' → 'An'`; `'An' → 'An'`; `'Hoa (Mẹ Bắp)' → 'Bắp'`; `'🌸 Hoa 🌸' → 'Hoa'`; `'🌸' → null`; `'' / '   ' / null / undefined → null`; không cắt từ (`'Nguyễn' → 'Nguyễn'`).
- [ ] **Step 2:** `pnpm --filter @tubutree/app-core exec vitest run src/person-name.spec.ts` → FAIL (module không có).
- [ ] **Step 3: Cài `givenName`** bằng tách theo `/\s+/`, bỏ ký tự không phải chữ/số ở hai đầu bằng `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu`, duyệt từ cuối lên lấy từ đầu tiên còn lại.
- [ ] **Step 4:** chạy lại → PASS.
- [ ] **Step 5: Test đỏ ba nơi dùng.** Mini `member-card.spec.tsx`: người dùng `fullName: 'Nguyễn Thị Quay Lại'` → thấy "Chào Lại", không "Nguyễn". Web `member-card.spec.tsx`: cùng ca. Web `site-header.spec.tsx`: nút tài khoản hiện "Lại" (và chữ cái đầu "N" ở ô tròn như cũ); `fullName` rỗng hiện "Tài khoản".
- [ ] **Step 6: Nối vào** `greeting = homeCopy.member.greeting(givenName(user.fullName) ?? <fallback hiện có>)` ở hai thẻ thành viên; `site-header.tsx` dùng `givenName(user?.fullName) ?? 'Tài khoản'` thay `split(' ').slice(-1)[0]`. Giữ nguyên `aria-label` của thẻ (đã chứa lời chào).
- [ ] **Step 7:** chạy `person-name.spec.ts`, hai `member-card.spec.tsx`, `site-header.spec.tsx` → PASS; sửa `shop.web.spec.ts:751`.
- [ ] **Step 8: Commit** `feat(app-core): lời chào thẻ thành viên và thanh đầu web dùng tên gọi (P2 #7)`.

### Task 2: Mua lại chống trùng Giờ vàng theo phân loại (P2 #3)

**Files:**
- Modify: `packages/app-core/src/merch/home-shelves.ts` (thêm `variationKey`, `flashShelfEntry`, `purchasedShelfEntry`; chú thích), `apps/miniapp/src/components/home/use-home-shelves.ts`, `apps/web/src/components/home/use-home-shelves.ts` (`flashSlugs` → `flashVariationIds`), `apps/miniapp/src/pages/home.tsx:121`, `apps/web/src/components/home/home-view.tsx:159`, `apps/miniapp/src/components/home/home-lazy.tsx` (kiểu props đi theo), `apps/miniapp/src/components/reorder/purchased-rail.tsx:77,97`, `apps/web/src/components/reorder/purchased-rail.tsx:45,204` (prop `exclude` → `excludeVariations`)
- Test: `packages/app-core/src/merch/home-shelves.spec.ts`, `apps/miniapp/src/components/home/use-home-shelves.spec.tsx`, `apps/web/src/components/home/use-home-shelves.spec.tsx`, spec của `PurchasedRail` hai app (`purchased-rail.spec.tsx`)

**Interfaces:**
- Produces (`merch/home-shelves.ts`):
  - `export const variationKey = (variationId: string): string` → `` `variation:${variationId}` `` (tiền tố để không đụng slug/id bộ).
  - `export function flashShelfEntry<T extends { productSlug: string; variationId: string }>(item: T): ShelfEntry<T>` → `{ id: item.productSlug, also: [variationKey(item.variationId)], item }`.
  - `export function purchasedShelfEntry<T extends { slug: string; variationId: string }>(item: T): ShelfEntry<T>` → `{ id: variationKey(item.variationId), also: [item.slug], item }`: lọc theo phân loại (khoá riêng), nhưng vẫn chiếm slug cho kệ dưới.
  - `HomeShelves.flashVariationIds: ReadonlySet<string>` (thay `flashSlugs`): `variationId` của các suất Giờ vàng đang hiện. `PurchasedRail` nhận `excludeVariations?: ReadonlySet<string>` và lọc `!excludeVariations?.has(p.variationId)`.

- [ ] **Step 1: Test đỏ app-core** (`home-shelves.spec.ts`, khối "Mua lại theo phân loại"), dùng `flashShelfEntry`/`purchasedShelfEntry`: (a) Giờ vàng `{productSlug:'can', variationId:'v1l'}` ×3 món + Mua lại `{slug:'can', variationId:'v5l'}` → `purchased` còn `v5l`; (b) Mua lại `{slug:'can', variationId:'v1l'}` → `purchased` rỗng; (c) Mua lại có `v1l` và `v5l` của `can` mà Giờ vàng chỉ `v1l` → còn `v5l` và `bestSellers` có `can` bị bỏ (slug bị Giờ vàng chiếm); (d) `seen` có `can`.
- [ ] **Step 2:** `pnpm --filter @tubutree/app-core exec vitest run src/merch/home-shelves.spec.ts` → FAIL.
- [ ] **Step 3: Cài ba hàm** ở `home-shelves.ts`; sửa chú thích `composeHomeShelves` (Mua lại chống trùng Giờ vàng theo phân loại, các kệ khác theo slug).
- [ ] **Step 4:** chạy lại → PASS.
- [ ] **Step 5: Test đỏ hook** (hai app): flash `{productSlug:'can', variationId:'v1l'}` + mua `{slug:'can', variationId:'v5l'}` → `flashVariationIds` là `{'v1l', ...}`, không chứa `v5l`; thay các ca `flashSlugs` cũ (Mini `use-home-shelves.spec.tsx:58-61,78,144,162`, web `:88,141`). `bought()` của spec Mini đã có `variationId: v-<slug>`, `flashEnding` đang cố định `variationId: 'v'` nên đổi thành `v-<slug>`.
- [ ] **Step 6: Test đỏ `PurchasedRail`**: `excludeVariations={new Set(['v1l'])}` với hai món cùng slug khác phân loại → chỉ món `v5l` hiện; khi mọi món bị loại khối ẩn (ca có sẵn đổi sang prop mới).
- [ ] **Step 7: Nối hook** dùng `flashShelfEntry`/`purchasedShelfEntry`, trả `flashVariationIds` (= `new Set(composed.flash.map((it) => it.variationId))`), cập nhật hai nơi truyền prop và kiểu.
- [ ] **Step 8:** chạy hai `use-home-shelves.spec.tsx`, hai `purchased-rail.spec.tsx`, Mini `home.spec.tsx` và `home-requests.spec.tsx`, web `home-view.spec.tsx` → PASS; `tsc --noEmit` ba nơi.
- [ ] **Step 9: Commit** `fix(home): Mua lại chống trùng Giờ vàng theo phân loại, kệ dưới vẫn theo slug (P2 #3)`.

### Task 3: Bán chạy nhất không ghi số khi hạng hụt (P2 #4)

**Files:**
- Modify: `packages/app-core/src/commerce/tile-copy.ts` (+ `shop-copy-budget.ts`), `packages/app-core/src/merch/home-shelves.ts` (`ranksAreSequential`), `apps/miniapp/src/components/ui/{product-tile,product-card,product-rail}.tsx`, `apps/web/src/components/mini/{product-tile,product-card,product-rail}.tsx`, `apps/miniapp/src/components/home/best-seller-rail.tsx`, `apps/web/src/components/home/best-seller-rail.tsx`
- Test: `packages/app-core/src/merch/home-shelves.spec.ts`, `product-tile.spec.tsx` hai app, `best-seller-rail.spec.tsx` hai app, `packages/app-core/src/shop-copy.spec.ts` (tự kiểm tập khoá)

**Interfaces:**
- Produces: `export function ranksAreSequential(ranks: readonly number[]): boolean` (`merch/home-shelves.ts`): true khi `ranks[i] === i + 1` với mọi i (rỗng cũng true).
- Produces: khoá `TILE_COPY['rank.plain'] = 'Bán chạy'` (ngân sách 10 ký tự ở `SHOP_COPY_MAX`); chữ đọc của thẻ không số cũng là `rank.plain`.
- Produces: prop `rankPlain?: boolean` trên `ProductTile`, `ProductCard`, `ProductRail` (cả hai app). `ProductTile` với `variant="rank"` và `rankPlain`: phù hiệu hạng (`data-ds-part="rank"`) ghi `Bán chạy`, nền/màu là `--color-rank-n-*` với mọi hạng, chữ đọc trong `aria-describedby` là `Bán chạy` thay `Hạng {n} bán chạy`. Không `rankPlain`: như cũ. `BestSellerRail` truyền `rankPlain={ranks !== undefined && !ranksAreSequential(ranks)}`.

- [ ] **Step 1: Test đỏ** (a) app-core: `ranksAreSequential([1,2,3]) === true`, `([]) === true`, `([1,2,4]) === false`, `([2,3]) === false`; (b) `product-tile.spec.tsx` hai app: `rank` 4 + `rankPlain` → phù hiệu text `Bán chạy`, `style.background === 'var(--color-rank-n-bg)'`, `rank` 1 + `rankPlain` cũng `rank-n`; mô tả đọc chứa `Bán chạy` và không chứa `Hạng`; không `rankPlain` giữ `#4` (ca có sẵn); (c) `best-seller-rail.spec.tsx` hai app: `ranks=[1,2,4]` → mọi phù hiệu là `Bán chạy`, không `#`; `ranks=[1,2,3]` giữ `#1,#2,#3`; không truyền `ranks` giữ `#1..#n`.
- [ ] **Step 2:** chạy các spec trên → FAIL.
- [ ] **Step 3: Cài**: `ranksAreSequential` + khoá `rank.plain`; `ProductTile` hai app: `rankPlain` đổi nội dung/màu phù hiệu và `rankSpoken`; `ProductCard`/`ProductRail` chuyển tiếp `rankPlain`; `BestSellerRail` truyền như trên.
- [ ] **Step 4:** chạy `shop-copy.spec.ts`, các spec ở Step 1, `terminology.spec.ts` (app-core) → PASS.
- [ ] **Step 5: Commit** `fix(home): thẻ Bán chạy nhất ghi "Bán chạy" thay số khi hạng hụt vì kệ trên chiếm (P2 #4)`.

### Task 4: `HOME_BEST_SELLER_LIMIT` theo số combo (F9 MINOR)

**Files:**
- Modify: `packages/app-core/src/home-layout.ts:447-448`, `apps/api/src/modules/catalog/home.service.ts:24-26`
- Test: `packages/app-core/src/home-layout.spec.ts`, `packages/app-core/src/merch/home-shelves.spec.ts`, `apps/api/src/modules/catalog/home.service.spec.ts` (đã dùng hằng, chạy lại)

**Interfaces:**
- Produces: `HOME_BEST_SELLER_LIMIT = 24` ở cả `home-layout.ts` và `home.service.ts` (cùng giá trị, API không import app-core); `queries/home.ts` và Mini `home-best-seller-query.ts` đã đọc từ app-core nên không cần sửa.

- [ ] **Step 1: Test đỏ** (a) `home-layout.spec.ts`: `HOME_BEST_SELLER_LIMIT >= shelf('home.bestSellers').maxItems + 2 + shelf('home.combos').maxItems * 3`; (b) cùng spec đọc `apps/api/src/modules/catalog/home.service.ts` bằng `readFileSync` + regex `HOME_BEST_SELLER_LIMIT = (\d+)` và khẳng định bằng hằng app-core (như `tree-title.spec.ts`); (c) `home-shelves.spec.ts`: bốn combo mỗi combo 3 slug lấy từ 12 món đầu của bảng 24 món, Giờ vàng chiếm 3 món, Mua lại 2 món → `bestSellers` còn đúng 10 món (đủ trần kệ, ≥ 3).
- [ ] **Step 2:** `pnpm --filter @tubutree/app-core exec vitest run src/home-layout.spec.ts src/merch/home-shelves.spec.ts` → FAIL.
- [ ] **Step 3:** đổi cả hai hằng sang 24, sửa hai chú thích ("lấy dư để đủ sau khi bỏ món của Giờ vàng, Mua lại và tối đa 4 combo × 3 món").
- [ ] **Step 4:** chạy lại hai spec → PASS; `cd apps/api && npx jest src/modules/catalog/home.service.spec.ts` → PASS; Mini `home-requests.spec.tsx`, `home-feed` spec (khối gộp vẫn nhận ra `limit` mới) → PASS.
- [ ] **Step 5: Commit** `fix(home): Bán chạy nhất lấy 24 món để không tụt dưới 3 món khi có 3–4 combo (F9 MINOR)`.

### Task 5: "Hành trình nguyên liệu" và "Cộng đồng hỏi đáp" dùng `SectionHeader` (P2 #5)

**Files:**
- Modify: `apps/miniapp/src/components/home/{brand-journey,community-preview}.tsx`, `apps/web/src/components/home/{brand-journey,community-preview}.tsx`
- Test: `apps/miniapp/src/pages/home-parts.spec.tsx` (hoặc spec mới `home-below-headers.spec.tsx` cạnh file nếu ca không có chỗ), `apps/web/src/components/home/home-parts.spec.tsx`

**Interfaces:**
- Consumes: `SectionHeader({ title, action })` ở `components/ui/section-header.tsx` (Mini) và `components/mini/section-header.tsx` (web), `action: { label, to }`.
- Produces: mỗi khối có `data-testid="section-header"` với `h2` Inter 16/700 (không `font-family` Fraunces); hành động "Xem bản đồ" (hành trình, tới `/brand-story` Mini, `/cau-chuyen` web) và "Xem tất cả" (cộng đồng, tới `/feed` Mini, `/cong-dong` web) nằm ở tiêu đề; thẻ bản đồ giữ nguyên là nút mở cùng đích, không còn chữ CTA riêng.

- [ ] **Step 1: Test đỏ** (hai app): render `BrandJourney`/`CommunityPreview` (mock như spec Trang chủ) → trong vùng có đúng một `section-header`, `h2` tên "Hành trình nguyên liệu"/"Cộng đồng hỏi đáp", `getComputedStyle(h2).fontFamily` không chứa `font-display` (kiểm theo style inline `var(--font-ui)`); nút có tên "Xem bản đồ Hành trình nguyên liệu" / "Xem tất cả Cộng đồng hỏi đáp" bấm mở đúng đường; thẻ bản đồ (icon + `homeCopy.journey.body`) vẫn mở `/brand-story` hoặc `/cau-chuyen`.
- [ ] **Step 2:** chạy hai spec → FAIL.
- [ ] **Step 3: Sửa bốn file**: hành trình = `SectionHeader` (action CTA) đứng trên thẻ nền `--color-bg-subtle`, trong thẻ còn nút icon + `body` + chevron và dải chip; cộng đồng = thay hàng tiêu đề + nút tay bằng `SectionHeader` (action `homeCopy.community.seeAll`). Lề trái/phải theo cách các khối khác bọc `SectionHeader` (Mini bọc `padding: '0 16px'`, web không bọc).
- [ ] **Step 4:** chạy hai spec và `home-below-*.spec.tsx` Mini → PASS; không thêm px viết tay (`pnpm lint:parity` ở Task 7).
- [ ] **Step 5: Commit** `fix(home): Hành trình nguyên liệu và Cộng đồng hỏi đáp dùng SectionHeader Inter 16/700 (P2 #5)`.

### Task 6: Tên đọc của ghi chú Giờ vàng, sửa chú thích đo chữ thẻ (F10a MINOR)

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts` (+ `shop-copy-budget.ts`), `packages/app-core/src/commerce/flash-slots.ts`, `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/web/src/components/mini/product-tile.tsx`, `apps/miniapp/src/components/flash/flash-slot-item.tsx:85`, `apps/web/src/components/flash/flash-slot-item.tsx:85`, `packages/app-core/src/commerce/tile-metrics.ts` (chú thích)
- Test: `packages/app-core/src/commerce/flash-slots.spec.ts`, `product-tile.spec.tsx` hai app

**Interfaces:**
- Produces: khoá `'flash.limitSpoken': 'Tối đa {n} sản phẩm mỗi khách'` (ngân sách `null`, câu đọc không hiển thị).
- Produces: `export function slotItemNoteSpoken(item: Pick<FlashSlotItem, 'variationName' | 'perUserLimit'>): string` (`flash-slots.ts`): `[Tối đa n sản phẩm mỗi khách, tên phân loại]` nối bằng ", "; giới hạn không hợp lệ (0, NaN, âm) thì bỏ; rỗng khi không có gì.
- Produces: prop `noteSpoken?: string` trên `ProductTile` (hai app): có giá trị thì chữ nhìn thấy của dòng ghi chú là `aria-hidden` và chữ đọc được nối vào `aria-describedby` của nút tên SAU chữ đọc giá (ngăn bằng ", "); không có thì như cũ (các nơi khác dùng `note`, như "Đã mua 3 lần", không đổi).

- [ ] **Step 1: Test đỏ** `flash-slots.spec.ts`: `slotItemNoteSpoken({ perUserLimit: 2, variationName: 'Gói 80 tờ' }) === 'Tối đa 2 sản phẩm mỗi khách, Gói 80 tờ'`; chỉ giới hạn → `'Tối đa 5 sản phẩm mỗi khách'`; chỉ phân loại → `'500g'`; `perUserLimit` 0/NaN/-3 và không phân loại → `''`; không chứa `/`. `product-tile.spec.tsx` hai app: `note="Tối đa 2/khách · Gói 80 tờ" noteSpoken="Tối đa 2 sản phẩm mỗi khách, Gói 80 tờ"` → phần tử `[data-ds-part="note"]` có `aria-hidden="true"`, mô tả của nút tên chứa `Tối đa 2 sản phẩm mỗi khách`, không chứa `/`; có `note` mà không `noteSpoken` → ghi chú KHÔNG `aria-hidden` (hành vi cũ).
- [ ] **Step 2:** chạy `flash-slots.spec.ts` và hai `product-tile.spec.tsx` → FAIL.
- [ ] **Step 3: Cài**: khoá + ngân sách, `slotItemNoteSpoken`, `noteSpoken` ở hai `ProductTile` (`description` thêm `noteSpoken` sau giá khi có), hai `flash-slot-item.tsx` truyền `noteSpoken={slotItemNoteSpoken(item)}`. Sửa chú thích `tile-metrics.ts` (ngưỡng đo với Inter đi kèm app qua `fonts.css`, rủi ro duy nhất là chữ dự phòng lúc `font-display: swap` hoặc ký tự ngoài tập con woff2).
- [ ] **Step 4:** chạy `shop-copy.spec.ts`, `flash-slots.spec.ts`, hai `product-tile.spec.tsx`, hai `flash-slot-item.spec.tsx` (nếu có) → PASS.
- [ ] **Step 5: Commit** `fix(flash): ghi chú "Tối đa n/khách" có tên đọc không đọc dấu gạch chéo, sửa chú thích đo chữ thẻ (F10a)`.

### Task 7: Ghi quyết định, chụp so, kiểm cuối (không thêm mã tính năng)

**Files:**
- Modify: `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §5 (một dòng "Trang chủ": bốn quyết định ở trên), `docs/2026-10-31-shop-redesign/PROGRESS.md` (một dòng), `scripts/uiux/ds-baseline.json` nếu số px/`max-md:` hạ
- Test: e2e Mini (`apps/e2e/tests/home-p6*.miniapp.spec.ts`, `home-merged.miniapp.spec.ts`) sửa theo thiết kế nếu đỏ vì chữ/phù hiệu mới

- [ ] **Step 1:** chạy `apps/e2e/tests/home-p6.miniapp.spec.ts`, `home-p6-cls.miniapp.spec.ts`, `home-merged.miniapp.spec.ts`, `tile-rhythm.miniapp.spec.ts`, `flash-sale.miniapp.spec.ts` (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3393`); test đỏ vì thiết kế đã chốt (Mua lại theo phân loại, phù hiệu "Bán chạy", lời chào tên gọi) thì sửa test, đỏ vì hồi quy thì sửa mã. Ghi từng ca sửa vào notes.
- [ ] **Step 2: Chụp 375px** Trang chủ Mini (Vite 3393), web 375 và web 1280 (Next 3394), trước (base `cca490dbc`) và sau, vào `docs/2026-10-31-shop-redesign/screens/G4/{before,after}/`; so Mini ↔ web; tắt server của mình.
- [ ] **Step 3:** `pnpm lint:parity`, `pnpm lint:vars`, `a11y-shop.miniapp.spec.ts`, `ds-parity.shop.spec.ts` (nếu chạy được); hạ baseline thì `node scripts/uiux/ds-ratchet.mjs --write` và commit.
- [ ] **Step 4:** gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base cca490dbc --out <worktree>/../gate-G4.txt`; bước FAIL kiểm lại ở base trước khi ghi "có sẵn". Race: gói không đổi đường tiền hay schema, không chạy (ghi vào notes).
- [ ] **Step 5:** bộ e2e Mini đầy đủ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3393 npx playwright test --workers=2 --reporter=line`.
- [ ] **Step 6: Commit** `docs(shop): G4 ghi quyết định Trang chủ và kết quả`.

## Tự rà

- Phủ: P2 #3 (Task 2), #4 (Task 3), #5 (Task 5), #7 (Task 1); F9 MINOR (Task 4); F10a MINOR hai mục (Task 6); chụp so, e2e, gate (Task 7). Mục "ảnh sau F10a cũ" của MINOR F10a là việc chụp ảnh của gói F10a, không thuộc G4 (G4 chụp lại Trang chủ ở Task 7).
- Tên nhất quán: `givenName`, `variationKey`, `flashShelfEntry`, `purchasedShelfEntry`, `flashVariationIds`, `excludeVariations`, `ranksAreSequential`, `rankPlain`, `rank.plain`, `slotItemNoteSpoken`, `noteSpoken`, `flash.limitSpoken`.
- Không đụng file G1/G5/G6; `product-card-view.ts` (G5) không sửa vì phù hiệu không số đi qua prop `rankPlain` của thẻ, không qua `ProductCardView`.

## Kết quả thực hiện (ghi sau khi chạy)

- Việc phát sinh ngoài kế hoạch: (1) `member-card.tsx` hai app đổi `{' · '}` thành `{' · '}` vì dòng flex nuốt khoảng trắng đầu, tên gọi ngắn làm lộ "Chào An· Mầm Xanh" (ảnh `screens/G4/after/mini375-member.png` lúc đầu); (2) `queries/home.spec.ts` (app-core) còn giả định limit 12, gate bắt được, đổi sang `HOME_BEST_SELLER_LIMIT`; (3) e2e đỏ vì thiết kế mới, đã sửa: `home-h.miniapp.spec` và `shop.web.spec` (thẻ thành viên: lời chào theo tên gọi), `buy-flow-4b.miniapp.spec` (limit 24), `bundles.miniapp.spec` (thẻ "Bán chạy"), `shop.web.spec:751` ("Chào An").
- Không tìm thấy câu "máy thật dùng chữ khác" trong `tile-metrics.ts`; bình luận số đo meta vốn đã nói đúng "Inter 12px/500". Thêm hai câu nói rõ Inter đi kèm app và rủi ro chỉ ở chữ dự phòng lúc swap.
- Header web 1280 vẫn hiện "Lại" cho tài khoản thử "Nguyễn Thị Quay Lại" (đó là tên gọi thật của hồ sơ thử), không phải bỏ chữ "Lại" như đề bài hiểu nhầm.
