# F3 `wave3-fixups` (đợt 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dọn sáu việc mở sau đợt 3 (lề âm web, Back/cuộn của Danh mục Mini, hàng mã giảm ở giỏ web, link cuối `/s/[slug]`, thanh Đã bán Giờ vàng, bundle Mini) mà hình ở 375/768/1280 không đổi.

**Architecture:** một lớp CSS tràn mép `.tubu-bleed` (+ `.tubu-bleed-rail` cho kệ) ở design system của từng app thay mọi lề âm tay; `ds-shop-guard.spec` chặn lề âm tay quay lại. Các sửa còn lại là sửa hành vi/kiểu nhỏ ở đúng file, mỗi sửa có test đỏ trước.

**Tech Stack:** React 18/19, Vite + zmp-ui (Mini), Next 15 + Tailwind 3.4 (web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật), `02-ke-hoach.md` (Global Constraints, "Giao diện dùng chung"), `plans/handoff-wave3.md` (việc còn mở), `plans/P6-home.md` (mục "Cần chủ quyết" lề âm), `plans/P9-shop-page.md` (vòng sửa 3), `plans/P7-browse.md` ("Sửa sau review").

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Hình KHÔNG đổi: số đo 375/768/1280 giữ nguyên (thẻ đầu kệ x=12 ở 375 như Mini). Số đo trước đo ở "Số đo trước" dưới; sau đo lại bằng cùng spec, phải khớp từng số.
- Chữ giao diện tiếng Việt theo `01-thiet-ke.md` §4 Q5; không đổi chữ trong gói này.
- Vùng chạm ≥44px, tương phản ≥4,5:1, không cuộn ngang ở 320/375.
- Chunk vào Mini ≤700 KB; ghi số trước/sau nếu entry đổi (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`).
- Máy thiếu RAM: chỉ chạy vitest theo file khi làm; gate đầy đủ đúng một lần ở cuối; không kill tiến trình không phải của mình; không `git stash` trần; không push; không đọc/ghi PROD.
- Không đụng file P11 (campaigns, banner trong khối `banner` Trang chủ và `/offers`), P12 (`flash-sale` API/trang/`route-fallback.ts` mục `/flash-sale`), P13 (best-sellers, `route-fallback.ts` mục Bán chạy nhất). Gói này không đụng `route-map.json`, `shop-copy.ts`, `route-fallback.ts`.
- Comment chỉ giải thích "vì sao" không hiển nhiên, theo mật độ file xung quanh (tiếng Việt). Commit kết thúc bằng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Từ md trở lên mọi khối tràn mép không đổi (lề 0, `max-width` cũ của `.scroll-x` giữ nguyên); riêng kệ sản phẩm lùi 12px từ md. Test: `css.spec` (luật `.tubu-bleed` chỉ nằm trong `@media not all and (min-width: 768px)`; `.tubu-bleed-rail` có đủ hai mốc) + số đo 768/1280 ở "Số đo trước/sau".
2. `.scroll-x { max-width: 100% }` cắt hàng cuộn đã nới lề. Test: `css.spec` khẳng định `.tubu-bleed` đứng SAU `.scroll-x` trong `mini.css` (cùng độ đặc hiệu, luật sau thắng).
3. Gửi từ khoá rỗng hoặc chỉ khoảng trắng khi đang ở hub không được PUSH (không chồng mục lịch sử, không rời hub). Test Task 4.
4. Gửi từ khoá khi đang ở danh sách vẫn là REPLACE và vẫn về đầu danh sách (hành vi cũ của P7). Test Task 4.
5. Hàng mã giảm ở chân dính khi mã đã áp có tên mã dài hoặc gợi ý dài: cắt `…` trên một dòng, hàng vẫn cao 44px, không tràn ngang 320px. Test Task 5.

## Số đo trước (Next dev 3318 + API giả 3316, spec tạm `apps/e2e/tests/f3-measure.web.spec.ts`, project Web Customer, không commit)

Số liệu ghi ở `.../scratchpad/measure-before.json`. Các số phải giữ nguyên sau Task 2:

| Khổ | Số đo |
|---|---|
| 375 Trang chủ | thanh tìm dính x0 w375 h56 (ml -16, pl 16, top 0); lưới lối tắt x8 w359, ô đầu x8 w71,8; hàng danh mục x0 w375, ô đầu x16; kệ Bán chạy x0 w375, thẻ đầu x12 w128; hàng chip gợi ý x0 w375 (ml -16, pl 16, dính top 56), chip đầu x16 |
| 375 /san-pham | kệ hub x0 w375, thẻ đầu x12; SortBar dính x0 w375 (ml -16, top 58); chip bộ lọc x0 w375 (ml -16, pl 16, max-width none) |
| 768 | Trang chủ: lối tắt x24 w720, hàng danh mục x24 w720, kệ Bán chạy x12 w744 (thẻ đầu x24), chip x24 w720; /san-pham: kệ hub x12 w744, SortBar x24 w720, chip lọc x24 w720 |
| 1280 | Trang chủ: lối tắt ẩn, hàng danh mục x64 w1152, kệ x52 w1176 (thẻ đầu x64), chip x64 w1152; /san-pham: kệ hub x52 w1176, SortBar x288 w928, chip lọc x288 w928 |

Hai bộ cũ chạy trước (đã ghi): `shop.web.spec.ts` các nhóm "Trang chủ", "danh mục /san-pham", "nhãn hàng", "gian hàng theo khung" trên hai project điện thoại và máy tính: 47 passed, 15 skipped, 3 failed (đỏ có sẵn do API giả: `gõ hiện gợi ý sản phẩm...` ở hai project và `điện thoại 320px: không cuộn ngang kể cả khi đang mở gợi ý`), log `e2e-web-before.log`.

## Số đo bundle Mini (đã đo, không có task mã)

Base d389e5d8b (trước đợt 3) so HEAD 77433c0d0, `vite build` cùng `VITE_API_BASE_URL`: tổng 2031 → 2106 KB (+75), JS 175 → 193 file; entry 682 → 625 KB (−57, P6 nạp lười khối dưới màn đầu); chunk dùng chung mới `index.*` 79 KB (zmp-ui Sheet/Modal + react-spring + use-gesture, nay tách khỏi entry vì chỉ trang lười dùng). Phần tăng theo chunk: `shop-products-tab` +10,8, `storefront-view` +8,3, `browse` +5,7, `banner-carousel` +5,7 (đã nạp lười ở `home-banner`), `voucher-ticket` +5,6, `product-detail` +3,9, `sort-bar` +3,0, `bottom-sheet` +2,4, `pdp-view` +1,6, `earn-sheet` +1,4, `home-below` +1,1, `cart` +1,0, `offers` −6,4. Phân tích sourcemap: không có module nằm ở hai chunk, không import thừa đáng kể. Kết luận: tăng do tính năng thật của P4–P9 (khung chờ Trang chủ, gian hàng, SortBar, mã giảm), không có chunk lặp hay import thừa để cắt rẻ; 2048 KB là ngưỡng cảnh báo không phải giới hạn. Không sửa mã ở việc này.

## File Structure

- `apps/web/src/components/mini/mini.css`: thêm `.tubu-bleed`, `.tubu-bleed-rail`, `.tubu-flash-fill` (sau `.scroll-x`).
- `apps/miniapp/src/css/tokens.css`: thêm `.tubu-bleed` (Mini luôn là khổ điện thoại) và `.tubu-flash-fill`.
- Thay lề âm tay (web): `components/mini/product-rail.tsx`, `components/home/{category-row,shortcut-grid,suggest-feed,home-view}.tsx`, `components/catalog/{active-filters,category-chip-row,browse-view}.tsx`. Mini: `components/ui/shop-section.tsx`, `pages/brand-view.tsx`.
- Guard: `apps/web/src/components/ds-shop-guard.spec.ts`, `apps/miniapp/src/components/ds-shop-guard.spec.ts`.
- Danh mục: `apps/miniapp/src/pages/browse.tsx`, `apps/web/src/components/catalog/browse-view.tsx`.
- Giỏ web: `apps/web/src/components/coupon-box.tsx`.
- `/s/[slug]`: `apps/web/src/components/affiliate/storefront-owner.tsx`.
- Thanh Đã bán: `apps/miniapp/src/components/ui/flash-sold-bar.tsx`, `apps/web/src/components/mini/flash-sold-bar.tsx`.

---

### Task 1: Lớp `.tubu-bleed` ở web + guard đỏ trước

**Files:**
- Modify: `apps/web/src/components/mini/mini.css` (sau khối `.scroll-x`, dòng ~353-360)
- Test: `apps/web/src/components/mini/css.spec.ts`, `apps/web/src/components/ds-shop-guard.spec.ts`

**Interfaces:**
- Produces: lớp CSS `.tubu-bleed` (dưới md: `margin-inline: calc(var(--space-block) * -1); max-width: none`; từ md không luật nào) và `.tubu-bleed-rail` (mọi khổ lùi `calc(var(--space-block) * -1)`, `max-width: none`; từ md lùi `calc(var(--p-space-4) * -1)`, đúng đệm 12px của kệ). Đệm ngang (`px-4`, `max-md:px-2`...) vẫn do Tailwind của từng nơi dùng, lớp chỉ giữ lề âm và `max-width`.
- Produces: hàm `bleedViolations(files: { rel: string; text: string }[]): string[]` trong `ds-shop-guard.spec.ts` (trả `rel` các file trong `components/(home|catalog|shop-page|mini)/` còn lề âm tay).

- [ ] **Step 1: Viết test đỏ** trong `css.spec.ts` (mô tả `mini.css: tràn mép dùng chung`): (a) `.tubu-bleed` có `margin-inline: calc(var(--space-block) * -1)` và `max-width: none`, và mọi luật `.tubu-bleed` nằm trong `@media not all and (min-width: 768px)`; (b) `.tubu-bleed-rail` có luật gốc `-` `--space-block`, và trong `@media (min-width: 768px)` lùi `var(--p-space-4)`; (c) vị trí chuỗi `.tubu-bleed` đứng sau `.scroll-x {` trong file. Trong `ds-shop-guard.spec.ts` thêm `it('không lề âm tay ở home, catalog, shop-page, mini: dùng .tubu-bleed')` chạy `bleedViolations(FILES)` kỳ vọng `[]`, và `it('bleedViolations bắt lề âm tay (fixture cố ý vi phạm)')` với ba fixture: `className="max-md:-mx-4 px-4"` ở `components/home/x.tsx`, `style={{ margin: '0 -16px' }}` ở `components/mini/y.tsx`, `'-mx-4 md:-mx-3'` ở `components/catalog/z.tsx` → cả ba `rel` có mặt; và fixture sạch `className="tubu-bleed px-4"`, cùng `-mx-4` ở `components/loyalty/mini-surface.tsx` (ngoài phạm vi) → không có mặt.
- [ ] **Step 2: Chạy cho đỏ:** `cd apps/web && npx vitest run src/components/mini/css.spec.ts src/components/ds-shop-guard.spec.ts` → FAIL (thiếu lớp; guard thật đỏ ở `product-rail.tsx`, `category-row.tsx`, `shortcut-grid.tsx`, `suggest-feed.tsx`, `home-view.tsx`, `active-filters.tsx`, `category-chip-row.tsx`, `browse-view.tsx`).
- [ ] **Step 3: Cài `bleedViolations`** trong spec: phạm vi `^components/(home|catalog|shop-page|mini)/`, mẫu `(?<![\w-])-mx-[\w.\[\]]+|margin:\s*['"]0 -|margin(Inline|Left|Right)\w*:\s*-`; `FILES` đã bỏ spec/`.d.ts` nên `mini.css` (nơi định nghĩa lớp) không bị quét. Thêm hai luật CSS vào `mini.css` đúng như Interfaces, kèm một comment giải thích vì sao đặt sau `.scroll-x` và vì sao chỉ dưới md.
- [ ] **Step 4: Chạy lại** hai spec: phần CSS xanh; guard thật còn đỏ ở các file chưa thay (Task 2 sửa).
- [ ] **Step 5: Commit** `feat(web): lớp .tubu-bleed tràn mép dùng chung + guard chặn lề âm tay` (chưa xanh toàn bộ guard: gộp commit với Task 2 nếu muốn giữ từng commit xanh; ưu tiên gộp Task 1 và 2 thành hai commit liền nhau không có lần chạy gate giữa chúng).

### Task 2: Thay lề âm tay bằng `.tubu-bleed` ở web (hình không đổi)

**Files:**
- Modify: `components/mini/product-rail.tsx` (`BLEED` → `'tubu-bleed-rail'`), `components/home/category-row.tsx` (`SCROLL_BLEED` → `'tubu-bleed max-md:px-4'`), `components/home/shortcut-grid.tsx` (`max-md:-mx-2 lg:hidden` → `tubu-bleed max-md:px-2 lg:hidden`), `components/home/suggest-feed.tsx` (`CHIPS_CLASS`: bỏ `max-md:-mx-4 max-md:max-w-none`, thêm `tubu-bleed`), `components/home/home-view.tsx` (`STICKY_SEARCH`: `-mx-4` → `tubu-bleed`, bỏ `md:mx-0`), `components/catalog/active-filters.tsx` và `category-chip-row.tsx` (`-mx-4 px-4 md:mx-0 md:px-0` → `tubu-bleed px-4 md:px-0`; bỏ `maxWidth: 'none'` ở style vì lớp đã có), `components/catalog/browse-view.tsx` (dòng ~257 `max-md:-mx-4 ... max-md:px-4` → `tubu-bleed ... max-md:px-4`; dòng ~363 `-mx-4 md:mx-0` → `tubu-bleed`).
- Test: `components/home/category-row.spec.tsx`, `shortcut-grid.spec.tsx`, `suggest-feed.spec.tsx`, `components/mini/product-grid.spec.tsx`, `components/catalog/category-chip-row.spec.tsx`, `active-filters.spec.tsx`, `browse-view.spec.tsx`, `ds-shop-guard.spec.ts`.

**Interfaces:**
- Consumes: `.tubu-bleed`, `.tubu-bleed-rail` (Task 1).
- Produces: không có API mới; mọi nơi trên mang lớp thay cho lề âm Tailwind/inline.

- [ ] **Step 1: Sửa spec cũ theo lớp mới (đỏ trên mã cũ):** các khẳng định lớp cũ chuyển thành: `category-row.spec` (dòng ~131-139) lưới có `tubu-bleed`, không `-mx-`; `shortcut-grid.spec` (~151-156) section có `tubu-bleed` + `max-md:px-2`, mã nguồn không còn `-mx-`; `suggest-feed.spec` (~110) hàng chip có `tubu-bleed`, `max-md:sticky`, `max-md:top-14`, `max-md:z-10`, `max-md:px-4`; `product-grid.spec` (~95) vùng kệ có `tubu-bleed-rail`; `category-chip-row.spec` (~49) có `tubu-bleed`.
- [ ] **Step 2: Chạy cho đỏ:** `cd apps/web && npx vitest run src/components/home src/components/catalog src/components/mini src/components/ds-shop-guard.spec.ts` → FAIL ở các ca vừa sửa và guard.
- [ ] **Step 3: Thay lớp** ở các file trên (không đổi `px-*`, `sticky`, `bg`, `z`); giữ nguyên mọi style khác. Cập nhật comment đầu `RailShell` và `category-row` nói lề âm nay do `.tubu-bleed*`.
- [ ] **Step 4: Chạy lại** lệnh Step 2 → PASS toàn bộ.
- [ ] **Step 5: Đo sau, so số đo trước:** Next dev 3318 vẫn chạy (đọc `.next` nóng), `F3_OUT=<scratchpad>/measure-after.json ... npx playwright test tests/f3-measure.web.spec.ts --project='Web Customer' --workers=1`; so `measure-before.json` bằng `diff` đã bỏ trường `cls`: không khác số nào. Chạy lại nhóm `shop.web.spec.ts` như "Số đo trước": cùng 47 passed, cùng 3 failed có sẵn.
- [ ] **Step 6: Commit** `refactor(web): gom lề âm tay về .tubu-bleed (RailShell, danh mục, lối tắt, chip gợi ý, thanh tìm dính, chip và SortBar của Danh mục)`.

### Task 3: Mini: lớp `.tubu-bleed` + thay `margin: '0 -16px'`, guard Mini

**Files:**
- Modify: `apps/miniapp/src/css/tokens.css` (sau `.scroll-x`), `components/ui/shop-section.tsx:133`, `pages/brand-view.tsx:288`
- Test: `components/ui/shop-section.spec.tsx`, `pages/brand-view.spec.tsx`, `components/ds-shop-guard.spec.ts`, `apps/e2e/tests/shop-page.miniapp.spec.ts` (không đổi, chạy lại)

**Interfaces:**
- Produces: `.tubu-bleed { margin-inline: calc(var(--space-block) * -1); max-width: none; }` (Mini không có khổ md). Wrapper `data-testid="shop-rail"` và `data-testid="brand-featured-rail"` giữ nguyên testid, đổi `style={{ margin: '0 -16px' }}` thành `className="tubu-bleed"`.

- [ ] **Step 1: Test đỏ:** `shop-section.spec` và `brand-view.spec` khẳng định wrapper kệ có `className` chứa `tubu-bleed` và `style.margin` rỗng (thay khẳng định `-16px` cũ), lưới GRID không có lớp; `ds-shop-guard.spec` thêm `it('không margin: 0 -Npx tay ở Mini')` quét `FILES` kỳ vọng `[]` và một ca fixture cố ý vi phạm cho hàm lọc cùng kiểu Task 1 (hàm `bleedHits(files)`, mẫu `margin:\s*['"]0 -`).
- [ ] **Step 2: Chạy:** `cd apps/miniapp && npx vitest run src/components/ui/shop-section.spec.tsx src/pages/brand-view.spec.tsx src/components/ds-shop-guard.spec.ts` → FAIL.
- [ ] **Step 3: Cài:** thêm lớp vào `tokens.css`, đổi hai chỗ.
- [ ] **Step 4: Chạy lại** → PASS; thêm `src/components/ui/product-grid.spec.tsx` để chắc không vỡ.
- [ ] **Step 5: Commit** `refactor(miniapp): .tubu-bleed thay margin 0 -16px ở kệ gian hàng và thương hiệu + guard`.

### Task 4: Mini + web: gửi từ khoá khi ở hub là PUSH và về đầu danh sách

**Files:**
- Modify: `apps/miniapp/src/pages/browse.tsx` (`commit`, dòng ~176), `apps/web/src/components/catalog/browse-view.tsx` (`commit`, dòng ~179)
- Test: `apps/miniapp/src/pages/browse.spec.tsx`, `apps/web/src/components/catalog/browse-view.spec.tsx`

**Interfaces:**
- Consumes: hook cuộn của Mini (`use-scroll-restoration.ts`: PUSH → `scrollTop = 0`; REPLACE giữ vị trí), `router.push` của web (mặc định cuộn lên đầu).
- Produces: `commit(term: string): void` (cả hai app): khi `hubState` và từ khoá sau `trim()` khác rỗng → điều hướng PUSH tới `browseHref({ q })` (Mini: `navigate(browseHref({ q: t }))`; web: `openFromHub({ q: t })`), không gọi `update`; ngược lại giữ nguyên (`scrollToListTop(); update({ q: t })`). Dùng chung cho Enter ở ô tìm, chạm từ khoá gần đây, chạm dòng "Tìm …" ở bảng gợi ý (`onPickKeyword={commit}`).

- [ ] **Step 1: Test đỏ Mini** (`browse.spec.tsx`, nhóm "hub (gốc /browse)"): (a) `gửi từ khoá từ hub: PUSH, Back về hub`: `renderAt('/browse')`, gõ `nuoc rua` + `fireEvent.submit(screen.getByRole('search'))` → `loc()` `'/browse?q=nuoc+rua'` và `navType()` `'PUSH'`; (b) `chạm từ khoá gần đây ở bảng gợi ý khi ở hub là PUSH`: `localStorage.setItem('tubu_recent_searches', JSON.stringify(['nuoc rua']))`, focus ô tìm, bấm nút "nuoc rua" trong `region` "Gợi ý tìm kiếm" → `navType()` `'PUSH'`; (c) `hub cuộn sâu: danh sách mới bắt đầu từ đầu trang`: dựng `scrollTop` ghi/đọc được không kẹp (như khối "vị trí cuộn" nhưng không giới hạn theo lưới), đặt `scroller.scrollTop = 900` ở hub, gửi từ khoá, sau `listPainted()` `scroller.scrollTop` bằng `0`; (d) `gửi trống hoặc toàn khoảng trắng ở hub không đổi URL, không PUSH`: submit với `'   '` → `loc()` vẫn `'/browse'`, `navType()` vẫn `'POP'`; (e) `trong danh sách gửi từ khoá vẫn REPLACE` (đã có dòng ~744 chứng minh ở `?all=1`, thêm `expect` cùng nội dung cho chạm từ khoá gần đây ở `/browse?all=1`).
- [ ] **Step 2: Chạy:** `cd apps/miniapp && npx vitest run src/pages/browse.spec.tsx -t "hub"` → (a)(b)(c) FAIL (đang REPLACE, vị trí giữ nguyên), (d)(e) PASS làm đối chứng.
- [ ] **Step 3: Cài `commit` ở Mini** như Interfaces (sau `stopEditing`, `setDraft`, ghi `recent`); cập nhật comment đầu file ("Từ hub chạm ô … gửi từ khoá cũng là PUSH").
- [ ] **Step 4: Chạy lại** cả `browse.spec.tsx` → PASS toàn bộ (kể cả ca "Enter mới ghi q" dòng ~215 và ca REPLACE dòng ~744).
- [ ] **Step 5: Test đỏ web** (`browse-view.spec.tsx`, theo cách spec đó giả `useRouter`): ở hub, gửi từ khoá gọi `push` đúng một lần với `'/san-pham?q=nuoc+rua'` và không gọi `replace`; chạm từ khoá gần đây ở hub cũng `push`; từ khoá rỗng ở hub không gọi `push`; ở danh sách (`?all=1`) gửi từ khoá gọi `replace` (không `push`).
- [ ] **Step 6: Cài `commit` ở web** như Interfaces; cập nhật comment đầu `BrowseView`. Chạy `cd apps/web && npx vitest run src/components/catalog/browse-view.spec.tsx` → PASS.
- [ ] **Step 7: Commit** `fix(browse): gửi từ khoá từ hub là PUSH (Back về hub) và danh sách bắt đầu từ đầu trang, Mini và web`.

### Task 5: Web giỏ điện thoại: hàng mã giảm một dòng 44px như `CouponRow` Mini

**Files:**
- Modify: `apps/web/src/components/coupon-box.tsx` (nhánh `sheet`: bọc ngoài dòng ~391 và hai nút kích hoạt dòng ~409-470)
- Test: `apps/web/src/components/coupon-box.spec.tsx` (khối `sheet`, dòng ~609), `apps/web/src/app/gio-hang/cart-mini.spec.tsx` (dòng ~216), `apps/e2e` đo tạm

**Interfaces:**
- Consumes: `couponHintText`, `formatVnd`, `fillCopy` đã import trong file.
- Produces: khi prop `sheet` bật, hàng kích hoạt là MỘT dòng `min-h-11` (44px): icon `Ticket` 20px màu `--clay-700` (không ô vuông 36px), nhãn "Mã giảm giá" đậm, gợi ý ("Chọn hoặc nhập mã giảm giá" hoặc `couponHintText(hint)`) cùng dòng, cắt `…` (`min-w-0 truncate`), phải là "Chọn mã" (hoặc `actionLabel`) + chevron 16px; khi đã có mã thì chip mã (`border-dashed` clay) + `-{số giảm}` cùng dòng và "Thay đổi". Viền dưới bằng `box-shadow: inset 0 -1px 0 var(--color-border-subtle)` (không `border-b`, để dòng đúng 44px). `data-testid="coupon-change"`, `aria-haspopup="dialog"`, tên truy cập chứa "Mã giảm giá" giữ nguyên. Nhánh không `sheet` (từ md) giữ nguyên từng chữ.

- [ ] **Step 1: Test đỏ** (`coupon-box.spec.tsx`, render `<CouponBox sheet currentCode={null} subtotal={300000} />` rồi có mã): nút kích hoạt có `min-h-11`, không có phần tử con `h-9 w-9` (ô icon 36px), không có `flex-col` bao nhãn và gợi ý (nhãn và gợi ý là anh em trong một hàng `flex`), phần gợi ý có lớp `truncate`, icon `Ticket` có `h-5 w-5`; ô ngoài không có lớp `border-b`; có mã `WELCOME30` và `appliedDiscount={30000}`: chip mã và `-30.000đ` cùng hàng với "Thay đổi", chip có `truncate`; không `sheet`: giữ nguyên khẳng định cũ của spec (đối chứng nhánh máy tính).
- [ ] **Step 2: Chạy:** `cd apps/web && npx vitest run src/components/coupon-box.spec.tsx src/app/gio-hang` → FAIL ở ca mới.
- [ ] **Step 3: Cài** nhánh `sheet` của `CouponBox` thành một hàng như Interfaces (một biến nội bộ `compact = sheet` chọn JSX; nhánh khác không đổi). Đo bằng trình duyệt cỡ chữ computed của "Mã giảm giá", gợi ý, "Chọn mã" ở Mini (`Text size="small"`/`xSmall`) rồi đặt cùng cỡ ở web.
- [ ] **Step 4: Chạy lại** lệnh Step 2 → PASS (kể cả `cart-mini.spec`, `page.spec`, `cart-parity.spec`).
- [ ] **Step 5: Đo hai app ở 375:** spec tạm đo `getBoundingClientRect` hàng mã giảm của Mini (`CouponRow`) và web: cao 44 cả hai, x/w của icon, nhãn, "Chọn mã" lệch ≤1px; chụp ảnh vào `docs/2026-10-31-shop-redesign/screens/F3/`.
- [ ] **Step 6: Commit** `fix(web): hàng mã giảm ở chân dính giỏ điện thoại là một dòng 44px như Mini`.

### Task 6: Web `/s/[slug]`: "Xem thêm ở Tubu Tree" như Mini

**Files:**
- Modify: `apps/web/src/components/affiliate/storefront-owner.tsx` (`MoreAtTubuLink` ~dòng 99, `LearnStorefrontLink` ~dòng 82)
- Test: `apps/web/src/components/affiliate/storefront-owner.spec.tsx`, `apps/web/src/app/s/[slug]/page.spec.tsx`

**Interfaces:**
- Produces: `MoreAtTubuLink({ referralCode })` vẽ `<p className="mt-2 text-center max-md:px-4">` chứa `<Link>` mang lớp `zaui-btn zaui-btn-tertiary tubu-btn` (nút ghost như `Button variant="ghost"`: `minHeight 44`, `borderRadius var(--radius-control)`, `fontWeight 600`, không gạch chân), bên trong `<span className="zaui-btn-container">` chứa chữ "Xem thêm ở Tubu Tree"; `LearnStorefrontLink` dùng `tubu-hit-44` thay `min-h-11` (vùng chạm 44 do `::after`, hộp bố cục cao một dòng như Mini). Khoảng giữa dòng "Tìm hiểu" và nút ghost bằng Mini: wrapper nút `mt-2` (8px).

- [ ] **Step 1: Test đỏ:** `storefront-owner.spec`: anchor của `MoreAtTubuLink` có `zaui-btn-tertiary`, không có `underline`, `href` giữ như cũ (`/san-pham` hoặc `/`), wrapper `p` có `mt-2` và không `mt-4`; `LearnStorefrontLink` anchor có `tubu-hit-44`, không `min-h-11`. `page.spec.tsx` của `/s/[slug]` (khối từ vòng sửa 3 đang khẳng định `min-h-11`): đổi sang `tubu-hit-44`.
- [ ] **Step 2: Chạy:** `cd apps/web && npx vitest run src/components/affiliate/storefront-owner.spec.tsx "src/app/s"` → FAIL.
- [ ] **Step 3: Cài** như Interfaces.
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Đo ở 375** (Next 3318 + API giả có `/storefront/public/uatctv`; Mini Vite 3317 với `mockShopPage` của e2e): khoảng từ đáy chữ "Tìm hiểu" tới đỉnh nút ghost, rộng/cao nút, màu chữ nút: hai app khớp ≤1px; ảnh vào `screens/F3/`.
- [ ] **Step 6: Commit** `fix(web): "Xem thêm ở Tubu Tree" là nút ghost như Mini, khoảng cách với dòng Tìm hiểu bằng Mini`.

### Task 7: Thanh "Đã bán x%" theo `prefers-reduced-motion`

**Files:**
- Modify: `apps/miniapp/src/components/ui/flash-sold-bar.tsx`, `apps/web/src/components/mini/flash-sold-bar.tsx`, `apps/web/src/components/mini/mini.css`, `apps/miniapp/src/css/tokens.css`
- Test: `apps/miniapp/src/components/ui/flash-sold-bar.spec.tsx`, `apps/web/src/components/mini/flash-sold-bar.spec.tsx`, `apps/web/src/components/mini/css.spec.ts`

**Interfaces:**
- Produces: thanh phần đã bán mang lớp `tubu-flash-fill`; chuyển động `transform 600ms var(--p-ease-out)` nằm ở CSS của lớp (không còn `transitionProperty/Duration/TimingFunction` inline); trong `@media (prefers-reduced-motion: reduce)` lớp có `transition-duration: 0.01ms !important`. Mini đã có luật toàn cục `*{transition-duration:.01ms!important}` ở reduced-motion nên chỉ đổi cách khai; web trước đây không có luật nên thanh chạy 600ms dù khách tắt chuyển động, còn Mini nhảy tức thì (chênh thật khi chụp hoặc đo ở chế độ giảm chuyển động).
- Chữ đọc, `aria-hidden`, chiều cao 16px và mọi số đo khác không đổi.

- [ ] **Step 1: Đo chênh trước (bằng chứng):** spec tạm hai app, `page.emulateMedia({ reducedMotion: 'reduce' })` rồi `no-preference`, cùng dữ liệu (suất 68% đã bán); đọc `getBoundingClientRect().width` của `[data-testid="flash-sold-fill"]` sau 100ms và sau 1000ms; ghi vào notes (kỳ vọng: reduce Mini đã đủ ngay, web chưa).
- [ ] **Step 2: Test đỏ:** `flash-sold-bar.spec` hai app: phần đã bán có lớp `tubu-flash-fill` và `style.transitionDuration` rỗng; `css.spec.ts` (web): `.tubu-flash-fill` có `transition-property: transform`, và trong khối `@media (prefers-reduced-motion: reduce)` có `.tubu-flash-fill` với `transition-duration: 0.01ms`.
- [ ] **Step 3: Chạy:** `cd apps/web && npx vitest run src/components/mini/flash-sold-bar.spec.tsx src/components/mini/css.spec.ts` và `cd apps/miniapp && npx vitest run src/components/ui/flash-sold-bar.spec.tsx` → FAIL.
- [ ] **Step 4: Cài:** hai component dùng lớp, chuyển ba thuộc tính transition sang CSS hai app; giữ nguyên `transform: scaleX(...)` và `shown`.
- [ ] **Step 5: Chạy lại** → PASS; đo lại như Step 1: ở reduce cả hai app đủ ngay sau 100ms; ở no-preference cả hai còn chạy 600ms, sau 1000ms bằng nhau. Nếu sau 1000ms hai app vẫn lệch ở cùng dữ liệu thì dừng và báo (lệch là do bố cục, không phải chuyển động).
- [ ] **Step 6: Commit** `fix(flash): thanh Đã bán tôn trọng giảm chuyển động ở web như Mini (transition vào lớp CSS)`.

### Task 8: Gate, e2e Mini, ảnh 375px, ghi số

- [ ] **Step 1:** dừng server của mình (Next 3318, API giả 3316) sau khi chụp xong; xoá `apps/e2e/tests/f3-measure.web.spec.ts` và mọi spec tạm (không commit). Ảnh 375px Mini (Vite 3317) và web (Next 3318): Trang chủ (lối tắt, danh mục, kệ, chip gợi ý, thanh tìm dính), giỏ chân dính, `/s/uatctv`, hàng Giờ vàng; vào `docs/2026-10-31-shop-redesign/screens/F3/` (gitignore), tắt server khi xong.
- [ ] **Step 2: Gate đúng một lần**, từ worktree: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-F3 --base 77433c0d0 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F3.txt`; expected `FAIL count: 0`. Bước FAIL: chạy lại bước đó ở `git worktree` tạm tại `77433c0d0` (cài `pnpm install --offline --frozen-lockfile --ignore-scripts`) hoặc so log: đỏ cả ở base thì ghi "có sẵn", do gói thì sửa tới PASS.
- [ ] **Step 3: e2e Mini đầy đủ:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3317 npx playwright test --workers=2 --reporter=line` (~4 phút, sau khi tắt server chụp). Đỏ vì thiết kế đã chốt thì sửa test theo thiết kế (dùng `tests/support/hit-area.ts` cho chip), đỏ vì hồi quy thì sửa mã.
- [ ] **Step 4:** thêm mục "Điều chỉnh lúc làm" và số đo sau vào cuối file này; commit `docs(shop-redesign): F3 điều chỉnh lúc làm, số đo trước/sau`.

## Self-review

- Phủ yêu cầu: (1) Task 1-3 (lớp, thay thế, guard + fixture, số đo 375/768/1280 trước/sau); (2) Task 4 (Mini và web, có test); (3) Task 5; (4) Task 6; (5) Task 7 (đo + sửa vì lệch thật ở reduced-motion); (6) mục "Số đo bundle Mini" (đã đo, không có phần cắt rẻ, ghi số và lý do).
- Tên nhất quán: `.tubu-bleed`, `.tubu-bleed-rail`, `.tubu-flash-fill`, `bleedViolations`/`bleedHits`, `commit`, `openFromHub` dùng cùng một tên ở mọi task.
- Tỉ lệ: mỗi task một lệnh kiểm; thân hàm không chép vào plan.

## Điều chỉnh lúc làm

- Task 1 và 2 gộp một commit (`2c39511b0`): lớp mới, guard và các chỗ thay chung một vòng đỏ rồi xanh, tách ra thì guard đỏ suốt giữa hai commit.
- Task 3 (Mini): guard Mini là `bleedHits` (chỉ bắt `margin: '0 -…'`); vùng chạm `margin: '-12px -6px'` của icon không bị coi là lề tràn mép.
- Task 4 (Mini): gửi từ khoá TRỐNG ở hub không làm gì (plan ghi "giữ nguyên"); trước đây nó replace sang `/browse?q=` rỗng và ghi thêm một mục lịch sử. Web làm cùng cách.
- Task 5: hàng sheet bỏ `border-b` của khung ngoài, gạch chân là bóng trong `inset 0 -1px 0` như Mini nên hàng cao đúng 44px; `panelAria` rút còn nhánh `aria-expanded` vì nhánh `sheet` giờ có hàng riêng.
- Task 6: `MoreAtTubuLink` bọc bằng `<div data-testid="more-at-tubu">` thay `<p>` (khối `zaui-btn-container` trong `<p>` là HTML sai).
- Task 7: lệch có thật (xem số đo), sửa đúng như plan; Mini chỉ đổi cách khai (lớp CSS), hành vi Mini không đổi.
- Bundle Mini (mục 6): không có task mã, chỉ ghi số.
- Ảnh 375px không có riêng hàng Giờ vàng: thanh Đã bán đã đo bằng số (bảng dưới) ở cả hai app.

## Số đo sau

Hình học các khối tràn mép (Next dev 3318, API giả 3316, Playwright; trước = bảng "Số đo trước"):

- 375, 768, 1280: mọi `x`/`w` của ô tìm dính, lưới danh mục, kệ Bán chạy nhất (thẻ đầu x=12 ở 375, x=24 ở 768, x=64 ở 1280), chip gợi ý, hub `/san-pham`, SortBar giữ nguyên số trước.
- Ba khác biệt không nhìn thấy: khung ngoài của dải lối tắt từ `x8 w359` thành `x0 w375` (lưới và ô bên trong giữ nguyên toạ độ); `max-width` của dải bộ lọc đang áp từ `none` thành `100%` ở 768/1280 (cùng `x`, `w`); chip danh mục con không đo trực tiếp (API giả không có danh mục con), cùng lớp với dải bộ lọc.

Hàng mã giảm giá trong chân dính giỏ ở 375px (Mini `CouponRow` so web `CouponBox sheet`, hai trạng thái chưa áp và đã áp mã):

- Hàng 343x44 ở cả hai, bóng gạch chân `0 -1px 0 inset` cùng màu, icon vé 20px tại x=16, chevron 16px tại x=343.
- Nhãn 14px/500, gợi ý 13px/400 màu tertiary cắt "…", "Chọn mã" 13px/500 màu brand: giống nhau. Chênh còn lại: line-height 18px (Mini) so 20px (web), chiều rộng chữ chênh ~2px do font; không nhìn thấy.

`/s/[slug]` ở 375px: nút "Xem thêm ở Tubu Tree" ở web đúng số của Mini (x82.1, rộng 210.8, cao 48, chữ 15px/600, xanh, `text-decoration: none`, bo 12px). Khoảng từ đáy dòng Tìm hiểu tới đỉnh nút: Mini 8,6px, web 9,0px (chênh 0,4px do khung dòng).

Thanh Đã bán Giờ vàng (suất 10/50 = 20% ở cả hai app, tỉ lệ scaleX đọc ở 100ms / 300ms / 1000ms):

| | trước, giảm chuyển động | sau, giảm chuyển động | sau, không ưu tiên |
|---|---|---|---|
| Mini | 0,2 / 0,2 / 0,2 | 0,2 / 0,2 / 0,2 | 0,067 / 0,169 / 0,2 |
| web | 0,086 / 0,175 / 0,2 | 0,2 / 0,2 / 0,2 | 0,086 / 0,175 / 0,2 |
