# G6 `builder-shop` (đợt 6b): P2 về trình dựng và trang shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa 10 lỗi P2 (số 24, 25, 26, 27, 28, 29, 30, 31, 35, 36 của `review/final-critique.md`) ở màn dựng gian hàng (`/storefront` Mini, `/ctv/gian-hang` web), trang shop web (`/s/:slug`, `/brand/:slug`) và nút Mini có icon, sao cho web 375px giống Mini cả giao diện và web 1280 hết khoảng trống/giãn quá khổ.

**Architecture:** Chữ và quy tắc không đổi; việc là vẽ. Nút Mini sửa một chỗ ở CSS của `.tubu-btn` (nút chữ, icon, nút phụ đang tắt) kèm token mới ở `packages/design-tokens`; web nhận cùng token qua một lớp CSS chung (không thêm `max-md:`). Màn dựng sửa theo từng số trong cả hai app; từ lg web có bố cục riêng (hai nút lên hàng tiêu đề, chi tiết khối hai cột). Trang shop web từ lg giới hạn bề rộng `ComboCard` và vẽ kệ ít món thành lưới, quy tắc "ít món" nằm ở app-core.

**Tech Stack:** React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind 3 (web), vitest, Playwright (Mini mock toàn bộ API; web qua `web-gate.sh`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (Q1, Q12), §5 (Màn dựng, Khung trang shop, Web máy tính); `02-ke-hoach.md` (Global Constraints, "Giao diện dùng chung", P9, P10); `review/final-critique.md` P2 số 24..31, 35, 36; `review/critique-store.md` SB-02, SB-08; `plans/P10-storefront-builder.md`; `plans/handoff-wave3.md`, `handoff-wave4b-4f.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới đã chạy `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Web khổ điện thoại phải giống Mini App cả giao diện (luật chủ dặn): sửa Mini ở 375px trước, rồi web cùng nhánh; web dưới `md` ra cùng số đo với Mini.
- Vùng chạm >= 44px (nới bằng `tubu-hit-44`, không đổi chiều cao hiển thị), tương phản >= 4,5:1 cho chữ, axe 0 vi phạm ở 375px; tiêu đề khối Inter 16/700; giá giảm `--color-text-price-deal`.
- Chỉ dùng token; không hex, không `var(--stone-…)` trong mã màn. `pnpm lint:parity` chạy bánh cóc px và `max-md:` (`scripts/uiux/ds-baseline.json`): không thêm số px viết tay hay `max-md:` mới (CSS thuần không đếm); hạ được thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline.
- KHÔNG sửa file của G1 (`voucher.ts`, `voucher-ticket.tsx`, Ưu đãi, `GuestLinkCard`, chip phiếu `brand-view.tsx`/`shop-page.ts`), G4 (Trang chủ, `home-shelves`, `product-tile.tsx` ghi chú Giờ vàng), G5 (`catalog/*`, `scroll-rail.tsx`, `ban-chay`, `hub.ts`, `category-row.tsx`, `campaign-body.tsx`, `DESIGN.md`). `shop-copy.ts` không đụng (chữ mới của gói không có; chữ trình dựng ở `BUILDER_COPY`).
- Máy chung thiếu RAM: lúc làm chỉ chạy vitest theo file; gate đầy đủ đúng một lần ở cuối. Không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình không phải của mình.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ file xung quanh).

## Review Focus

1. Nút chữ Mini không còn rộng tối thiểu 120px nhưng nút `fullWidth` và nút trong `StickyActionBar` không đổi bề rộng. Test: e2e Mini đo "Sắp xếp" và hai nút dính đáy.
2. Nút phụ đang tắt đọc được (>= 4,5:1) ở cả hai app, cùng một cặp token. Test: `contrast.spec.ts` cặp mới; e2e Mini đo màu tính ra.
3. "Thêm ảnh bìa" đã có ảnh bìa thì không hiện nút; chưa có thì bấm mở đúng sheet hồ sơ và Tab tới được. Test: vitest Mini/web.
4. Chi tiết khối chỉ có một lối lùi ở điện thoại nhưng từ md web vẫn có link lùi (không có nút lùi nổi); khối không có `slug` sản phẩm thì menu ⋯ không có "Bài đăng mẫu". Test: vitest hai app.
5. Kệ ngang đúng ngưỡng (số món bằng và hơn một so với trần "ít món"), combo chỉ 1 món (hiện như hàng dòng), khối rỗng: lg vẽ đúng bố cục, không tràn ngang. Test: `collection-view.spec` + `shop-section.spec` web.

---

## File Structure

| File | Việc |
|---|---|
| `packages/design-tokens/src/tokens.css`; `apps/miniapp/src/css/contrast.spec.ts` | token nút phụ tắt (Task 1) |
| `apps/miniapp/src/css/tokens.css` (+ `tokens-button-polish.spec.ts`) | nút chữ, icon, nút phụ tắt, chiều cao 44 (Task 1) |
| `apps/web/src/components/mini/mini.css`, `apps/web/src/lib/phone-ui.ts`; `apps/web/src/components/shop-page/brand-body.tsx`; `apps/web/src/components/mini/shop-top-bar.tsx` (+ spec) | web: nút phụ tắt, vùng chạm, đệm thanh đầu (Task 2) |
| `apps/miniapp/src/pages/storefront-builder.tsx`, `components/storefront-builder/section-detail.tsx`, `components/storefront-builder/stats-panel.tsx` (+ spec) | Mini: thanh dính, đệm thẻ, ảnh bìa, lối lùi, "Bài đăng mẫu" (Task 3) |
| `apps/web/src/components/affiliate/storefront-builder.tsx`, `storefront-section-detail.tsx` (+ `app/ctv/gian-hang/page.spec.tsx`) | web 375: ảnh bìa, lối lùi, "Bài đăng mẫu" (Task 4) |
| cùng hai file web + `app/ctv/gian-hang/page.tsx` | web lg: nút lên hàng tiêu đề, chi tiết hai cột (Task 5) |
| `packages/app-core/src/commerce/collection-view.ts` (+spec), `apps/web/src/components/mini/shop-section.tsx` (+spec) | web lg: ComboCard trần, kệ ít món thành lưới (Task 6) |
| `apps/e2e/tests/builder-polish.miniapp.spec.ts` (mới), `apps/e2e/tests/builder-polish.web.spec.ts` (mới) | đo 375px / 1280 (Task 1, 3, 5, 6) |

## Task 1: Nút Mini: nút chữ, icon, nút phụ đang tắt (P2 #25, #26, #27)

**Files:**
- Modify: `packages/design-tokens/src/tokens.css`, `apps/miniapp/src/css/tokens.css`, `apps/miniapp/src/components/ui/button.tsx`
- Test: `apps/miniapp/src/css/tokens-button-polish.spec.ts` (mới), `apps/miniapp/src/css/contrast.spec.ts`, `apps/e2e/tests/builder-polish.miniapp.spec.ts` (mới)

**Interfaces:**
- Produces: token `--color-action-secondary-bg-disabled` (= `--stone-100`) và `--color-action-secondary-fg-disabled` (= `--stone-500`, 4,70:1 trên nền đó); lớp CSS `.tubu-btn-44` (chiều cao đúng 44) dùng ở Task 3 và `tubu-btn-44` ghi vào mục lớp của Button.
- Quy tắc: `.tubu-btn.zaui-btn-tertiary` không `min-width`, đệm ngang 8px (như `ui.btnText` px-2 của web); `.tubu-btn .zaui-btn-icon` căn giữa dọc và cách chữ 8px.

- [ ] **Step 1: test đỏ.** `tokens-button-polish.spec.ts` đọc `src/css/tokens.css` và khẳng định: có luật `.tubu-btn.zaui-btn-tertiary` với `min-width: 0`; luật `.tubu-btn .zaui-btn-icon` có `align-items: center` và `margin-right: 8px`; luật nút phụ tắt dùng hai token mới; có `.tubu-btn.tubu-btn-44` với `height: 44px`. `contrast.spec.ts` thêm cặp (`--color-action-secondary-fg-disabled` trên `--color-action-secondary-bg-disabled`, >= 4,5). e2e Mini `builder-polish.miniapp.spec.ts` (mock `mockBuilder`, 375px, `/storefront`): (a) `getByRole('button', { name: 'Sắp xếp' })` có mép phải <= 375 − 16 − 8 + 1; (b) với "Sửa hồ sơ", "Cài đặt": tâm dọc icon (`svg`) lệch tâm dọc chữ <= 1px và khoảng icon–chữ trong 6–10px.
- [ ] **Step 2:** `pnpm --filter @tubutree/miniapp exec vitest run src/css/tokens-button-polish.spec.ts src/css/contrast.spec.ts` -> FAIL; e2e đỏ (đo số trước).
- [ ] **Step 3:** thêm hai token vào `packages/design-tokens/src/tokens.css` cạnh `--color-action-secondary-*`; thêm các luật CSS ở `apps/miniapp/src/css/tokens.css` (sau luật `.tubu-btn .zaui-btn-icon`); luật nút phụ tắt chọn `.tubu-btn.zaui-btn.zaui-btn-secondary[disabled]` (4 lớp để thắng `.zaui-btn-secondary.zaui-btn-disabled[disabled]` của ZaUI). Sửa số đo thật theo DOM do ZaUI sinh (đo trong e2e, không đoán).
- [ ] **Step 4:** vitest PASS; e2e (a)(b) PASS: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3401 npx playwright test tests/builder-polish.miniapp.spec.ts --workers=1`.
- [ ] **Step 5:** commit `fix(miniapp): nút chữ không rộng tối thiểu 120px, icon căn giữa cách chữ 8px, nút phụ tắt đọc được (G6: P2 #25 #26 #27)`.

## Task 2: Web: nút phụ tắt cùng token, vùng chạm câu chuyện, đệm thanh đầu (P2 #24, #25 web, #31)

**Files:**
- Modify: `apps/web/src/components/mini/mini.css`, `apps/web/src/lib/phone-ui.ts`, `apps/web/src/components/shop-page/brand-body.tsx:157`, `apps/web/src/components/mini/shop-top-bar.tsx:33`
- Test: `apps/web/src/components/mini/shop-top-bar.spec.tsx`, `apps/web/src/components/shop-page/brand-body.spec.tsx` (hoặc spec hiện có của hai file), `apps/web/src/lib/phone-ui.spec.ts` (mới nếu chưa có)

**Interfaces:**
- Produces: `phoneSecondary` thêm lớp thường `tubu-phone-secondary` (CSS ở `mini.css` trong `@media (max-width: 767px)`, `:disabled` dùng hai token của Task 1; không thêm `max-md:`). `ShopTopBar` đệm `0 96px 0 64px` như Mini. Nút "Đọc câu chuyện" dùng `tubu-hit-44` không `min-h-11`.

- [ ] **Step 1: test đỏ.** `shop-top-bar.spec`: style của `[data-testid="shop-top-bar"]` có `padding: 0 96px 0 64px`. brand-body spec: nút `shop.readStory` có class `tubu-hit-44` và không có `min-h-11`. `phone-ui` spec: `phoneSecondary` chứa `tubu-phone-secondary`.
- [ ] **Step 2:** `pnpm --filter @tubutree/web exec vitest run <ba spec>` -> FAIL.
- [ ] **Step 3:** sửa ba file + `mini.css` (`.tubu-phone-secondary.tubu-phone-secondary:disabled`, hai lớp lặp để thắng tiện ích Tailwind).
- [ ] **Step 4:** PASS. Commit `fix(web): thanh đầu shop chừa 96px, vùng chạm câu chuyện không chiếm chỗ, nút phụ tắt cùng token Mini (G6: P2 #24 #25 #31)`.

## Task 3: Mini: màn dựng (P2 #28, #29, #30)

**Files:**
- Modify: `apps/miniapp/src/pages/storefront-builder.tsx` (khối hồ sơ ~dòng 620-660, `StickyActionBar` ~dòng 720-748, item menu ~dòng 413), `apps/miniapp/src/components/storefront-builder/section-detail.tsx`, `apps/miniapp/src/components/storefront-builder/stats-panel.tsx`
- Test: `apps/miniapp/src/pages/storefront-builder.spec.tsx`, `apps/e2e/tests/builder-polish.miniapp.spec.ts`

**Interfaces:**
- `SectionDetailProps.onKit` bỏ (không còn nút trong hàng). Menu ⋯ của món (`ActionMenu` item) thêm hàng `{ key: 'kit', label: vi.contentKit.entryLabel, icon: Sparkles, onPress: () => setContentKitSlug(slug) }` khi `menuItem.product?.slug` có, đứng trước hàng Xoá.
- Hai nút thanh dính: mỗi nút bọc `<div style={{ flex: '1 1 0', minWidth: 0 }}>` + `Button fullWidth className="tubu-btn-44"` (cùng cấu trúc nên bề rộng bằng nhau; `flex: 1` của nút trần cộng đệm 24px làm nút trái rộng hơn 24px).
- Thẻ hồ sơ và thẻ Thống kê `Card padding={16}` (web `p-4`).
- "Thêm ảnh bìa" là `button` (cùng cấu trúc `tubu-hit-44`, chữ `Text variant="caption" tone="brand"`) gọi `setProfileOpen(true)` khi `!sf.coverUrl`.
- Chi tiết khối: bỏ nút lùi trong trang (nút lùi nổi của app lo việc đó); hàng đầu chỉ còn ⋯ ở phải, `justify-content: flex-end`, không `paddingLeft: 52`.

- [ ] **Step 1: test đỏ (vitest).** (a) spec "Bài đăng mẫu mở bộ nội dung bán hàng của đúng sản phẩm" đổi thành: bấm ⋯ của món rồi hàng "Bài đăng mẫu" trong menu, `ContentKitSheet` mở đúng `slug`; trong hàng món không còn nút tên "Bài đăng mẫu". (b) khối chưa có ảnh bìa: `getByRole('button', { name: 'Thêm ảnh bìa' })` bấm mở sheet hồ sơ; có `coverUrl` thì không có chữ. (c) `renderPage` render thêm `<BackButton />`; mọi `getByRole('button', { name: 'Gian hàng của tôi' })` đổi thành `{ name: 'Quay lại' }`, bỏ ca "trong trang lùi đúng một mục lịch sử" và cặp `'"Gian hàng của tôi" trong trang'` của `it.each`; thêm khẳng định chi tiết khối không có button tên "Gian hàng của tôi". e2e: hai nút dính đáy cùng `width` (±1) và cao 44; cạnh trái thẻ hồ sơ → chữ 16px; ở chi tiết khối chỉ có một nút tên "Quay lại" nhìn thấy; hàng món (`item-row`) cao <= 100px.
- [ ] **Step 2:** `pnpm --filter @tubutree/miniapp exec vitest run src/pages/storefront-builder.spec.tsx` -> FAIL (b, a, c); e2e đỏ.
- [ ] **Step 3:** sửa theo Interfaces; xoá `onKit` ở `SectionDetail` và dây nối ở `storefront-builder.tsx`; import `BackButton` đã có trong spec `renderWithBack`.
- [ ] **Step 4:** vitest + `storefront-builder.miniapp.spec.ts` + `builder-polish.miniapp.spec.ts` PASS. Commit `fix(miniapp): màn dựng: hai nút dính bằng nhau cao 44, đệm thẻ 16, "Thêm ảnh bìa" là nút, một lối lùi, "Bài đăng mẫu" vào menu ⋯ (G6: P2 #28 #29 #30)`.

## Task 4: Web 375: ảnh bìa, lối lùi, "Bài đăng mẫu" (P2 #29, #30 phía web)

**Files:**
- Modify: `apps/web/src/components/affiliate/storefront-builder.tsx` (dòng "Thêm ảnh bìa", item `ActionMenu`), `apps/web/src/components/affiliate/storefront-section-detail.tsx`
- Test: `apps/web/src/app/ctv/gian-hang/page.spec.tsx`

**Interfaces:** `StorefrontSectionDetailProps.onKit` bỏ; `ActionMenu` món thêm `{ key: 'kit', label: 'Bài đăng mẫu', icon: Sparkles, onPress: () => setKitSlug(slug) }` khi có `slug`; nút lùi trong trang `hidden md:inline-flex` (từ md không có nút lùi nổi, nên giữ; dưới md ẩn như Mini); "Thêm ảnh bìa" là `button.tubu-hit-44` mở `setProfileOpen(true)`.

- [ ] **Step 1: test đỏ.** Sửa hai ca "Bài đăng mẫu" (dòng ~602, ~1230) sang menu ⋯; thêm ca "Thêm ảnh bìa" là nút, mở sheet hồ sơ; nút lùi trong trang có class `hidden` và `md:inline-flex` (jsdom không áp media nên kiểm class); ca ~1230 bỏ phần "Bài đăng mẫu xanh đậm".
- [ ] **Step 2:** `pnpm --filter @tubutree/web exec vitest run "src/app/ctv/gian-hang/page.spec.tsx"` -> FAIL.
- [ ] **Step 3:** sửa hai file.
- [ ] **Step 4:** PASS. Commit `fix(web): trình dựng 375px giống Mini: "Thêm ảnh bìa" là nút, một lối lùi, "Bài đăng mẫu" vào menu ⋯ (G6: P2 #29 #30)`.

## Task 5: Web 1280: trình dựng không thanh dính, chi tiết khối hai cột (P2 #35)

**Files:**
- Modify: `apps/web/src/components/affiliate/storefront-builder.tsx:539-541` (+ các nút), `storefront-section-detail.tsx`, `apps/web/src/app/ctv/gian-hang/page.tsx` nếu cần chỗ cho nút ở hàng tiêu đề
- Test: `page.spec.tsx`, `apps/e2e/tests/builder-polish.web.spec.ts` (mới, dùng bộ mock của `ctv-375.web.spec.ts`)

**Interfaces:** Từ lg: hai nút "Xem trước" và "Chia sẻ" (cùng props/logic với thanh dính) hiện ở hàng tiêu đề (`hidden lg:flex`), thanh dính `lg:hidden`; chi tiết khối là lưới `lg:grid-cols-[28rem_minmax(0,1fr)]` (trái: đầu khối, bộ chọn kiểu, ô %, danh sách món; phải: "Khách sẽ thấy", dính `lg:sticky`), bỏ `lg:max-w-2xl`; danh sách món `lg:grid-cols-1`.

- [ ] **Step 1: test đỏ.** vitest: thanh dính có `lg:hidden`; có nhóm nút `data-testid="builder-head-actions"` với class `hidden lg:flex` chứa "Xem trước" và "Chia sẻ"; chi tiết khối: cột xem trước có `lg:col-start-2`. e2e 1280×800: không có phần tử `fixed/sticky` đáy nhìn thấy; trong chi tiết khối, `shop-section-preview` có `x` > 600 (nằm cột phải) và tổng bề rộng nội dung không vượt khung.
- [ ] **Step 2:** vitest + e2e FAIL.
- [ ] **Step 3:** sửa theo Interfaces. Hai nút ở hàng tiêu đề dùng cùng handler với nút dính (rút `headActions` thành một biến JSX dùng cho cả hai chỗ, `lg:hidden` / `hidden lg:flex`).
- [ ] **Step 4:** PASS. Commit `fix(web): trình dựng từ lg: hai nút lên hàng tiêu đề, bỏ thanh dính, chi tiết khối hai cột (G6: P2 #35)`.

## Task 6: Web 1280: gian hàng, ComboCard có trần, kệ ít món thành lưới (P2 #36)

**Files:**
- Modify: `packages/app-core/src/commerce/collection-view.ts`, `apps/web/src/components/mini/shop-section.tsx`
- Test: `packages/app-core/src/commerce/collection-view.spec.ts`, `apps/web/src/components/mini/shop-section.spec.tsx`, `apps/e2e/tests/builder-polish.web.spec.ts`

**Interfaces:**
- Produces (app-core): `export const RAIL_AS_GRID_MAX = 6` và `export function railFitsRow(count: number): boolean` (`count <= RAIL_AS_GRID_MAX`): từ ngần này món trở xuống một kệ ngang vừa một hàng ở lg nên không cần cuộn. 6 là số thẻ `--tile-w-md` 148px + khe 12px vừa trong khung `max-w-frame` 1152px trừ đệm kệ với dư tối thiểu 1 thẻ.
- Web `ShopSection`: layout `rail` với `railFitsRow(items.length)`: render cả `ProductRail` (`lg:hidden`) và `ProductGrid` (`hidden lg:grid`, lưới `grid-cols-6` bằng bề rộng khung, mỗi ô giãn) để dưới lg giữ y nguyên Mini; `ComboSection` bọc `lg:max-w-xl`.

- [ ] **Step 1: test đỏ.** `collection-view.spec`: `railFitsRow(0..6)` true, `railFitsRow(7)` false. `shop-section.spec` (web): kệ 4 món có `shop-rail-lg` ẩn dưới lg (class `lg:hidden`) và lưới `hidden lg:grid`; kệ 8 món chỉ có kệ ngang; combo có class `lg:max-w-xl`. e2e 1280: `shop-combo` rộng <= 600px; kệ 4 món: tổng bề rộng 4 thẻ >= 70% khung.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** thêm hàm + hằng ở app-core; sửa `ShopSection`. Lưới dùng lại `ProductGrid` với `className` gồm `grid-cols-6` (không tự vẽ thẻ).
- [ ] **Step 4:** PASS. Commit `fix(web): gian hàng từ lg: ComboCard có trần bề rộng, kệ ít món thành lưới (G6: P2 #36)`.

## Task 7: Chụp, baseline, gate

- [ ] **Step 1:** `node scripts/uiux/ds-ratchet.mjs --write` nếu số px/max-md giảm; commit baseline.
- [ ] **Step 2:** chụp mini375, web375, web1280 (trình dựng, chi tiết khối, gian hàng) trước/sau vào `docs/2026-10-31-shop-redesign/screens/G6/` (gitignore); so từng cặp.
- [ ] **Step 3:** vitest toàn bộ file đã sửa + `pnpm lint:parity` + `pnpm lint:vars`; e2e Mini `storefront-builder`, `storefront-signup`, `a11y-shop.miniapp`, `ds-parity.shop`; web `web-gate.sh tests/affiliate.web.spec.ts tests/ctv-375.web.spec.ts tests/shop.web.spec.ts` và `a11y-shop.web.spec.ts`.
- [ ] **Step 4:** gate cuối `docs/2026-10-28-review/tools/gate.sh`, rồi bộ e2e Mini đầy đủ.
