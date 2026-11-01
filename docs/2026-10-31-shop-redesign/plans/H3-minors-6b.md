# H3 minors-6b: MINOR còn lại của G4, G5, G6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa mười MINOR reviewer Opus để lại sau đợt 6b (G4 trang chủ, G5 duyệt, G6 trình dựng/shop), không đổi hành vi tiền, không thêm màn mới.

**Architecture:** Việc nhỏ rải ở `packages/app-core` (tên gọi), hook kệ Trang chủ hai app, hai thành phần Trang chủ (`BrandJourney`, `CategoryRow`), `NumberedPager` web, `ShopSection` web, trình dựng gian hàng web (quyết định hai nút bằng CSS thay JS), CSS nút Mini (chỉ soát, sửa nếu lệch) và hai bài e2e (tương phản, kệ không lặp). Mỗi task một commit, test đỏ trước.

**Tech Stack:** pnpm + turbo, React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind (web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1–Q19), §5 (Trang chủ, Danh mục, Màn dựng, Web máy tính); nguồn: `review/final-critique.md` và ba review MINOR của G4/G5/G6 (`plans/G4-home-polish.md`, `G5-browse-misc.md`, `G6-builder-shop.md`); bàn giao `plans/handoff-wave4b-4f.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới đã `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Web khổ điện thoại giống Mini App cả giao diện (luật chủ): mỗi thay đổi hình ở một app phải có ở app kia, cùng số đo.
- Chữ giao diện lấy ở `shop-copy.ts` / `home-copy.ts`; không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng".
- Vùng chạm >= 44px; chữ >= 4,5:1; axe 0 vi phạm serious/critical ở 375px màn đụng tới.
- `pnpm lint:parity` (gồm bánh cóc px và `max-md:` theo `scripts/uiux/ds-baseline.json`, chỉ được giảm) và `pnpm lint:vars` xanh; px viết tay hay `max-md:` mới là đỏ; hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- Không đụng vùng của H2: giỏ hàng web/Mini, `PdpShippingRow`, `Stars`, chữ "Mua chung", terminology EXEMPT, `pdp-mobile`/`cart-display`/`shop.web` test Theo dõi, `01-thiet-ke.md` §5, token thanh tiến độ trong `design-tokens`. `DESIGN.md` chỉ thêm dòng ở cuối nhật ký quyết định.
- Không push, không deploy, không đọc/ghi PROD. Máy thiếu RAM: chỉ chạy test theo file trong lúc làm; gate đầy đủ một lần ở cuối.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Tên gọi chỉ có chữ số hoặc ký hiệu ("Lan 1990", "1990", "Hoa 2k" không bị đổi): lời chào về dạng không tên, không "Chào 1990". Test `person-name.spec`.
2. Giờ vàng ẩn (dưới mức tối thiểu): tập loại trừ Mua lại rỗng, KHÔNG loại phân loại nào (giữ hành vi cũ: không ai chiếm món). Test hook hai app, ca "Giờ vàng 2 món".
3. Suất Giờ vàng đã quá `endAt` không vào tập loại trừ (cả hai phân loại). Test hook hai app, ca hết giờ.
4. Phân loại thứ hai của cùng sản phẩm trong Giờ vàng nhưng khách chưa mua nó: không ảnh hưởng gì (chỉ lọc theo `variationId` đã mua). Test hook.
5. Trang nhảy khi tải ở trình dựng lg: hàng tiêu đề giữ cùng chiều cao mọi trạng thái (tải, lỗi, ký, dựng). Test e2e đo `y` của h1 từng khung.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/person-name.ts` (+spec) | T1 bỏ từ không có chữ cái |
| `apps/{miniapp,web}/src/components/home/use-home-shelves.ts` (+spec) | T2 `flashVariationIds` từ danh sách Giờ vàng còn hạn trước chống trùng slug |
| `apps/{miniapp,web}/src/components/home/brand-journey.tsx` (+ `home-below-headers.spec.tsx`) | T3 một điểm dừng, một tên đọc |
| `apps/web/src/components/catalog/numbered-pager.tsx` (+spec), `DESIGN.md` | T4 bỏ đệm nav ở điện thoại, dòng nhật ký |
| `apps/{miniapp,web}/src/components/home/category-row.tsx` (+spec) | T5 nhãn danh mục 5,5 cột |
| `apps/web/src/components/mini/shop-section.tsx` (+spec), `apps/e2e/tests/builder-polish.web.spec.ts` | T6 lưới kệ ít món cùng cột chuẩn; T8 kệ không lặp tên |
| `apps/web/src/app/ctv/gian-hang/page.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx` (+ `page.spec.tsx`), `builder-polish.web.spec.ts` | T7 hai nút lên hàng tiêu đề bằng CSS |
| `apps/miniapp/src/css/tokens.css` (chỉ khi lệch), ảnh `screens/H3/` | T9 soát nút ghost/icon Mini |
| `apps/e2e/tests/support/builder-mocks.ts` (mới), `a11y-shop.web.spec.ts`, `builder-polish.web.spec.ts` | T10 axe và tương phản nút tắt ở chi tiết khối web 375 |
| `scripts/uiux/ds-baseline.json` | T11 hạ baseline nếu số px giảm |

---

### Task 1: `givenName` bỏ từ chỉ có chữ số và ký hiệu (G4 #1)

**Files:** Modify `packages/app-core/src/person-name.ts`; Test `packages/app-core/src/person-name.spec.ts`.

**Interfaces:** Produces: `givenName(fullName: string | null | undefined): string | null` (chữ ký không đổi): từ cuối **có ít nhất một chữ cái** (`\p{L}`) sau khi bỏ ký hiệu hai đầu; toàn số/ký hiệu thì `null`.

- [ ] **Step 1: test đỏ** thêm vào `person-name.spec.ts`: `givenName('Lan 1990')` là `'Lan'`; `givenName('Nguyễn Thị Hoa 2024')` là `'Hoa'`; `givenName('1990')`, `givenName('2024 🌸 99')` là `null`; `givenName('An2')` là `'An2'` (có chữ cái thì giữ).
- [ ] **Step 2:** `pnpm --filter @tubutree/app-core exec vitest run src/person-name.spec.ts` -> FAIL (`'1990'`).
- [ ] **Step 3:** vòng lùi từ cuối: chỉ trả từ khi `/\p{L}/u.test(word)`; cập nhật doc comment ("từ chỉ có chữ số cũng lùi").
- [ ] **Step 4:** PASS, cộng `pnpm --filter @tubutree/miniapp exec vitest run src/components/home/member-card` và web `member-card`, `site-header` (người gọi).
- [ ] **Step 5:** commit `fix(app-core): givenName bỏ từ chỉ có chữ số, "Lan 1990" chào "Lan" (H3 #1)`.

### Task 2: Mua lại loại trừ MỌI phân loại đang Giờ vàng (G4 #2)

**Files:** Modify `apps/miniapp/src/components/home/use-home-shelves.ts:84`, `apps/web/src/components/home/use-home-shelves.ts:107`; Test cả hai `use-home-shelves.spec.tsx`.

**Interfaces:** Consumes `flashShelfEntry`, `composeHomeShelves` (app-core, không đổi). Produces: `HomeShelves.flashVariationIds: ReadonlySet<string>` nay gồm `variationId` của MỌI suất còn hạn trong danh sách gốc khi kệ Giờ vàng đang hiện (`composed.flash.length > 0`); kệ ẩn (dưới `minItems`) thì tập rỗng như cũ. `PurchasedRail excludeVariations` giữ nguyên.

- [ ] **Step 1: test đỏ** (mỗi app): fixture Giờ vàng `a` hai phân loại (`v-a-1l`, `v-a-5l`) cộng `b`, `c` (3 sản phẩm nên kệ hiện, `flash` có 3 món vì chống trùng slug); Mua lại có `bought('a','v-a-5l')`. Khẳng định `flash.map(f => f.productSlug)` là `['a','b','c']` (kệ chỉ một thẻ cho `a`), `[...flashVariationIds].sort()` gồm `v-a-1l`, `v-a-5l`, `v-b`, `v-c`, và `purchased.filter(p => !flashVariationIds.has(p.variationId))` rỗng. Ca giữ hành vi: kệ ẩn (2 sản phẩm) thì `flashVariationIds.size` là 0; suất `a` phân loại 5L quá `endAt` thì không nằm trong tập.
- [ ] **Step 2:** `vitest run` hai file `use-home-shelves.spec.tsx` -> FAIL (thiếu `v-a-5l`).
- [ ] **Step 3:** tách `liveFlash` (đã lọc hạn, như lọc hiện có) trước `.map(flashShelfEntry)`; `flashVariationIds = composed.flash.length > 0 ? new Set(liveFlash.map(i => i.variationId)) : EMPTY` (một hằng rỗng ngoài hook để danh tính ổn định). Sửa doc comment hai hook và `HomeShelves.flashVariationIds`.
- [ ] **Step 4:** PASS hai file + `purchased-rail.spec.tsx` hai app.
- [ ] **Step 5:** commit `fix(home): Mua lại loại trừ mọi phân loại đang Giờ vàng, không chỉ phân loại hiện ở kệ (H3 #2)`.

### Task 3: "Hành trình nguyên liệu" một điểm dừng, một tên đọc (G4 #3)

**Files:** Modify `apps/miniapp/src/components/home/brand-journey.tsx`, `apps/web/src/components/home/brand-journey.tsx`; Test hai `home-below-headers.spec.tsx`.

**Interfaces:** Nút "Xem bản đồ" của `SectionHeader` (tên đọc "Xem bản đồ Hành trình nguyên liệu") là điều khiển duy nhất cho bàn phím và trình đọc màn hình. Thẻ bản đồ vẫn bấm được bằng tay/chuột: nút giữ `aria-hidden="true"` và `tabIndex={-1}` (axe `aria-hidden-focus` chấp nhận phần tử không tab được). Chip nhãn giữ nguyên.

- [ ] **Step 1: test đỏ** (mỗi app): trong `BrandJourney`, `getAllByRole('button', { name: /Xem bản đồ/ })` (Mini) / các `a`,`button` có tên chứa "bản đồ" đọc được (web) đúng 1; nút thẻ (chứa chữ "nhãn Việt") có `aria-hidden="true"`, `tabIndex === -1` và bấm vẫn gọi `navigate('/brand-story')` / `push('/cau-chuyen')`. Sửa ca cũ "thẻ bản đồ và chip nhãn vẫn bấm được" cho khớp (dòng `getByRole('button', { name: /Xem bản đồ/ })` đã đúng nghĩa là nút tiêu đề).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** thêm hai thuộc tính vào `<button>` thẻ ở cả hai file, thêm một câu comment giải thích vì sao ("hai nút cùng mở một trang").
- [ ] **Step 4:** PASS hai spec; e2e `home-h.miniapp.spec.ts` dòng 184 (vùng "Hành trình nguyên liệu") vẫn đúng vì chip nằm ngoài nút thẻ.
- [ ] **Step 5:** commit `fix(home): Hành trình nguyên liệu chỉ một điểm dừng tab và một tên đọc (H3 #3)`.

### Task 4: Pager số web: bỏ dải trống ở điện thoại (G5 #4)

**Files:** Modify `apps/web/src/components/catalog/numbered-pager.tsx`, `DESIGN.md` (một dòng cuối nhật ký); Test `apps/web/src/components/catalog/numbered-pager.spec.tsx`.

**Interfaces:** `<nav>` đổi `pt-3` thành `md:pt-3 focus-within:pt-3`: dưới md phần số đã `sr-only` nên nav cao 0; khi bàn phím nhảy vào "Trang sau" (`focus-within`) nav lấy lại đệm.

- [ ] **Step 1: test đỏ** `numbered-pager.spec.tsx`: lớp của `nav` có `md:pt-3` và `focus-within:pt-3`, không có `pt-3` trần (tách theo khoảng trắng).
- [ ] **Step 2:** FAIL. **Step 3:** sửa lớp; thêm dòng cuối bảng `## Nhật ký quyết định` của `DESIGN.md`: `| 2026-11-02 | Pager số ẩn ở điện thoại (sr-only, giữ liên kết cho SEO), "Xem thêm" là điều khiển chính; nav không đệm trên khi ẩn (H3 #4) | điện thoại giống Mini App chỉ có "Xem thêm"; liên kết trang vẫn có trong HTML cho crawler vì canonical của ?page=N trỏ về chính nó |`.
- [ ] **Step 4:** PASS + `design-docs.spec` của app-core (`pnpm --filter @tubutree/app-core exec vitest run src/design-docs.spec.ts`). e2e đo ở T11 (nav cao 0 ở 375px trên trang Danh mục).
- [ ] **Step 5:** commit `fix(web): pager số không để dải trống ở điện thoại, ghi quyết định vào DESIGN.md (H3 #4)`.

### Task 5: Nhãn danh mục 5,5 cột (G5 #5)

**Files:** Modify `apps/miniapp/src/components/home/category-row.tsx`, `apps/web/src/components/home/category-row.tsx`; Test hai `category-row.spec.tsx`.

**Interfaces:** `Label` đã là `Text variant="caption"` + `WebkitLineClamp: 2` + `LABEL_HEIGHT` 32 ở cả hai app (kế hoạch ghi "một dòng" là nhầm: đo ảnh G5 cho thấy đã hai dòng, còn cắt "Chăm sóc c…" vì cột 5,5 chỉ rộng ~62px). Việc làm: ô nhãn bỏ đệm ngang 2px (`cellStyle.padding` thành `0`) để nhãn dùng đủ cột (+4px), giữ `CATEGORY_SCROLL_COLUMNS = 5.5`, `LABEL_HEIGHT` (khung chờ không đổi). Hai app cùng sửa.

- [ ] **Step 1: đo trước** (Playwright, Mini 375 và web 375 cuộn quá 10 ô, seed danh mục thật): với `padding 0 2px` ghi số nhãn bị cắt (`scrollHeight > clientHeight`) và chiều rộng nhãn; chụp `screens/H3/before/{mini375,web375}-home-categories.png`.
- [ ] **Step 2: test đỏ** mỗi `category-row.spec.tsx`: `button` của ô danh mục có `padding` 0 (style) và nhãn có `-webkit-line-clamp: 2` (khẳng định giữ, không đổi); chiều cao khung chờ không đổi (`categoriesBlockHeight` đã có spec ở app-core).
- [ ] **Step 3:** sửa `cellStyle.padding` hai file. **Step 4:** PASS + `home-layout.spec`; đo lại và chụp `after/`; ghi số nhãn cắt trước/sau và cặp mini375/web375 vào notes. Nếu không nhãn nào được cứu thì vẫn giữ (hạ px baseline, bằng hai app) và nói rõ trong notes: nhãn dài hơn 2 dòng ở cột 62px là hệ quả của quyết định 5,5 cột (G5), không phải bug.
- [ ] **Step 5:** commit `fix(home): ô danh mục 5,5 cột bỏ đệm ngang, nhãn hai dòng dùng đủ cột ở hai app (H3 #5)`.

### Task 6: Kệ ít món ở lg dùng lưới chuẩn của trang (G6 #6)

**Files:** Modify `apps/web/src/components/mini/shop-section.tsx` (xoá `RAIL_AS_GRID`, dùng `GRID_PRODUCTS`), `DESIGN.md` (một dòng); Test `shop-section.spec.tsx`, `apps/e2e/tests/builder-polish.web.spec.ts`.

**Interfaces:** Consumes `GRID_PRODUCTS` (`apps/web/src/lib/product-grid.ts`: `grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-5 xl:grid-cols-6`). `ProductGrid` trong `shop-rail-lg` không truyền `className` (mặc định `GRID_PRODUCTS`): thẻ cùng bề rộng như lưới Sản phẩm; hàng chưa đầy là chủ ý, giống hàng cuối của lưới Sản phẩm.

- [ ] **Step 1: test đỏ** `shop-section.spec.tsx`: `ul` trong `shop-rail-lg` có `lg:grid-cols-5` và `xl:grid-cols-6`, không có `grid-cols-6` trần; kệ 4 món vẫn `railFitsRow` (kệ giữ cho dưới lg). e2e: đổi tên ca thành "kệ ít món là lưới cùng cột với lưới Sản phẩm (5 cột ở lg, 6 ở xl), kệ nhiều món vẫn là kệ ngang"; khẳng định chiều rộng thẻ = `(rộng lưới - khe 16px * (cột - 1)) / cột` sai số 1px ở 1280 (6 cột) và 1100 (5 cột), thẻ đầu sát mép trái khung, bỏ khẳng định "chiếm >= 60% hàng". Bỏ khẳng định "thẻ >= 148px" (không còn đúng nghĩa).
- [ ] **Step 2:** vitest FAIL (`grid-cols-6`). **Step 3:** sửa file; dòng `DESIGN.md`: `| 2026-11-02 | Kệ ngang <= 6 món ở lg vẽ lưới cùng số cột lưới Sản phẩm (5 cột lg, 6 cột xl), hàng chưa đầy dồn trái (H3 #6) | thẻ phải bằng bề rộng thẻ của lưới Sản phẩm; giãn cột theo số món làm thẻ to hơn mọi lưới khác của web |`.
- [ ] **Step 4:** vitest PASS; e2e web chạy ở T11. **Step 5:** commit `fix(web): kệ ít món ở lg dùng lưới chuẩn của trang, đổi tên e2e cho đúng điều nó đo (H3 #6)`.

### Task 7: Hai nút trình dựng lên hàng tiêu đề bằng CSS (G6 #7)

**Files:** Modify `apps/web/src/app/ctv/gian-hang/page.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx`; Test `apps/web/src/app/ctv/gian-hang/page.spec.tsx` (khối "từ lg"), `builder-polish.web.spec.ts`.

**Interfaces:** Bỏ `useMediaQuery(LG_UP)` khỏi `StorefrontBuilder`. Thanh dính đáy luôn vẽ khi không ở chi tiết khối, thêm lớp `lg:hidden`. Cổng vào ô `builder-head-actions` (ô đã `hidden lg:flex`) vẽ mọi khổ, nên một CSS quyết định bản nào thấy; ô tìm bằng `useIsomorphicLayoutEffect` (chạy trước khi trình duyệt vẽ, không trễ một khung). `PageHeader` của trang thêm `lg:min-h-11` ở mọi trạng thái để hàng tiêu đề cao 44px từ lần vẽ đầu (không dịch ~14px khi nút tới). Hai bộ nút cùng đọc một `actions()` của trình dựng nên cùng trạng thái "Đang gửi…".

- [ ] **Step 1: test đỏ** `page.spec.tsx` thay ba ca "từ lg" cũ: (a) thanh `builder-bar` luôn có, lớp chứa `lg:hidden`; (b) ô `builder-head-actions` chứa đúng hai nút ("Xem trước", nút chính) ở cả hai khổ giả `matchMedia`; (c) bấm "Xem trước" ở ô tiêu đề mở bản xem trước; (d) vào chi tiết khối rồi lùi, ô được dựng lại và vẫn có hai nút; (e) `header` của trang có `lg:min-h-11`; đã đăng và chưa đăng đều có nút ở cả hai chỗ. e2e (1280×800, mock): cài `addInitScript` ghi mỗi khung (`requestAnimationFrame`) `y` của h1 và của nút đầu trong ô; sau khi nút xuất hiện chờ 500ms, khẳng định `y` của h1 chênh <= 1px suốt các khung từ lần h1 xuất hiện, và `y` nút không đổi từ khung đầu thấy được; `builder-bar` không hiện (`toBeHidden`), "Xem trước" nhìn thấy đúng 1 (`locator(':visible')`); ở 375 ô tiêu đề ẩn, thanh đáy hiện.
- [ ] **Step 2:** vitest + e2e (khi chạy được) FAIL trên mã cũ (e2e: ghi nhận dịch của h1 ở base để chứng minh bài bắt được lỗi).
- [ ] **Step 3:** sửa `StorefrontBuilder` (xoá `wide`, `LG_UP`, import; `useIsomorphicLayoutEffect` hoặc `useEffect` khi không có ở repo: dùng `typeof window !== 'undefined' ? useLayoutEffect : useEffect` cục bộ) và `Shell` (`className="md:mt-1 lg:min-h-11"`).
- [ ] **Step 4:** vitest PASS cả `page.spec.tsx`, `storefront-section-detail`, `use-media-query.spec`; `pnpm lint:parity` (`max-md:` không tăng). **Step 5:** commit `fix(web): hai nút trình dựng lên hàng tiêu đề bằng CSS, hàng tiêu đề giữ chiều cao, hết nháy một khung (H3 #7)`.

### Task 8: Kệ không lặp thẻ trong cây trợ năng, không tải ảnh hai lần (G6 #8)

**Files:** Test `apps/web/src/components/mini/shop-section.spec.tsx`, `apps/e2e/tests/builder-polish.web.spec.ts` (không đổi mã nguồn nếu kiểm xanh).

**Interfaces:** Quyết định: giữ hai bản (kệ `lg:hidden`, lưới `hidden lg:block`) vì chọn một bản bằng JS làm trang công khai nháy ở lg khi hydrate (lỗi giống T7); CSS `display:none` đưa bản ẩn ra khỏi cây trợ năng, thẻ bản ẩn là ảnh `loading="lazy"` (trình duyệt không tải ảnh trong `display:none`). Task này khoá điều đó bằng test.

- [ ] **Step 1: test** vitest: bản lưới và bản kệ đều mang ảnh `loading="lazy"` (`priorityCount` mặc định 0), và trong mỗi `ShopSection` kệ ít món có đúng hai hộp (`shop-rail` + `shop-rail-lg`), một `lg:hidden` một `hidden lg:block`, số thẻ bằng nhau. e2e (1280 và 375, gian hàng mẫu): trong khối "Kệ ít món", `getByRole('link')` (Playwright bỏ phần tử ẩn) có đúng `LG_SHELF_FEW` liên kết sản phẩm, tên không trùng nhau; và `locator('img:visible')` đúng bằng số thẻ có ảnh.
- [ ] **Step 2:** chạy trên mã hiện tại; nếu đỏ thì sửa mã (vd ảnh bản ẩn `loading` eager) cho tới xanh, nếu xanh thì ghi vào notes "đã đúng, nay có test khoá". **Step 3:** commit `test(web): khoá kệ ít món không lặp thẻ trong cây trợ năng và ảnh lazy ở bản ẩn (H3 #8)`.

### Task 9: Soát nút ghost/icon Mini sau đổi CSS toàn app (G6 #9)

**Files:** Modify (chỉ khi lệch) `apps/miniapp/src/css/tokens.css:621-640`; tạm (không commit) `apps/e2e/tests/h3-capture.miniapp.spec.ts`; ảnh `docs/2026-10-31-shop-redesign/screens/H3/{before,after}/`.

**Interfaces:** CSS cần soát: `.tubu-btn .zaui-btn-icon` (khung icon `width/height:auto`, `margin-right:8px`, căn giữa) áp cho MỌI `Button` có `icon`; `.tubu-btn.zaui-btn-tertiary` (min-width 0, đệm 8px) áp cho MỌI nút `variant="ghost"`. "Trước" = `tokens.css` ở `16a6d187a^`.

- [ ] **Step 1:** liệt kê màn: giỏ (`/cart`: "Xoá" ghost), tài khoản (`/profile`), đơn hàng (`/orders`: Mua lại/Đăng ký ghost), Ưu đãi (`/offers`, `/vouchers`), chi tiết đơn (`/order/:code`), thêm `rewards` (`icon={Info}`), `support` (`icon` ghost), `cart`. Dùng `mockTourWorld` của e2e với khổ 375×812.
- [ ] **Step 2:** chụp "trước": đặt tạm `tokens.css` từ `git show 16a6d187a^:apps/miniapp/src/css/tokens.css`, chụp; khôi phục file; chụp "sau". So từng cặp, đo bằng `getBoundingClientRect` các nút ghost/icon (rộng, cao, khoảng icon–chữ), ghi bảng lệch.
- [ ] **Step 3:** nếu có nút bị cắt chữ, tràn hàng hay lệch hàng so với trước thì sửa bằng lớp riêng ở nút đó hoặc chỉnh CSS (không nới baseline px), kèm spec `tokens-button-polish.spec.ts`; nếu không lệch thì không đổi mã. Xoá spec chụp tạm.
- [ ] **Step 4:** commit (nếu có sửa) `fix(miniapp): ...`; danh sách màn đã soát và kết quả vào notes bàn giao.

### Task 10: Tương phản 375px ở chi tiết khối web (G6 #10, web #25)

**Files:** Create `apps/e2e/tests/support/builder-mocks.ts` (chuyển `USER`, `product`, `mockBuilder` từ `builder-polish.web.spec.ts`, thêm tham số kiểu khối); Modify `builder-polish.web.spec.ts` (import), `a11y-shop.web.spec.ts`.

**Interfaces:** Produces `mockBuilder(api: MockApi, opts?: { comboCollection?: boolean }): void` và `setBuilderSession(page): Promise<void>` (đặt `tubu_web_session`). `a11y-shop.web.spec.ts` thêm màn "Chi tiết khối (trình dựng)" vào `SCREENS` (đường `/ctv/gian-hang?khoi=c1`, `ready: '[data-testid="shop-section-preview"]'`, bộ sưu tập kiểu COMBO có >= 2 sản phẩm để có ô `%` và nút "Lưu" đang tắt) và bài riêng "nút phụ đang tắt đủ tương phản": đọc `color` và `background-color` đã tính của nút "Lưu" tắt, tính tỉ lệ WCAG, `>= 4.5`.

- [ ] **Step 1: test đỏ**: thêm màn và bài tương phản (với hàm `contrast(rgbA, rgbB)` trong test); chạy trước khi chuyển mock thì thiếu `builder-mocks`: tạo file + import trước, rồi bài tương phản chạy; để chứng minh bài bắt được lỗi, chạy một lần với `phoneSecondary` tạm bỏ lớp `tubu-phone-secondary` (ghi kết quả đỏ) rồi hoàn tác.
- [ ] **Step 2:** chạy `a11y-shop.web.spec.ts -g "Chi tiết khối"` và `builder-polish.web.spec.ts` trong `web-gate.sh` (T11). **Step 3:** commit `test(e2e): axe và tương phản nút phụ đang tắt ở chi tiết khối web 375px (H3 #10)`.

### Task 11: Chụp so, baseline, gate

- [ ] **Step 1:** `pnpm lint:parity`, `pnpm lint:vars`; `node scripts/uiux/ds-ratchet.mjs --write` nếu px giảm (T5) rồi commit `chore(ds): hạ baseline px (H3)`.
- [ ] **Step 2:** chụp `mini375` và `web375` các màn đã đổi (Trang chủ: Hành trình, Danh mục; trình dựng 375 và 1280; Danh mục web nav) trước/sau vào `screens/H3/` (gitignore), so từng cặp; tắt server của mình.
- [ ] **Step 3:** vitest các file đã sửa; e2e Mini cục bộ: `home-h.miniapp.spec.ts`, `home-*.miniapp.spec.ts`, `a11y-shop.miniapp.spec.ts`, `ds-parity.shop.spec.ts`; web qua `web-gate.sh` cho `shop.web`, `affiliate.web`, `ctv-375.web`, `home-*.web`, `a11y-shop.web`, `ds-parity.shop`, `builder-polish.web`, spec duyệt.
- [ ] **Step 4:** `gate.sh` đúng một lần (`--base 14fda531f --out .../gate-H3.txt`), rồi bộ e2e Mini đầy đủ `--workers=2`. Bước FAIL kiểm lại ở base; có sẵn thì ghi "có sẵn".
- [ ] **Step 5:** ghi "Ghi chú thực hiện" cuối file này (chỗ lệch kế hoạch, số đo, màn đã soát).

---

## Self-Review

- Phủ spec: mười mục của gói H3 có task T1–T10; baseline/gate ở T11.
- Giữ tên: không đổi chữ ký công khai; `HomeShelves.flashVariationIds` đổi nghĩa (rộng hơn), cùng tên, người dùng là `PurchasedRail excludeVariations` ở hai app.
- Lệch có chủ đích đã nêu ở trước task: T5 (đã hai dòng), T8 (giữ hai bản, khoá bằng test).
