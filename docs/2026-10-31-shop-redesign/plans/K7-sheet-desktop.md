# K7 sheet-desktop (đợt 7c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ md (768px) mọi sheet web là hộp thoại giữa màn rộng tối đa 480px, không tay nắm; tiêu đề mọi sheet (Mini + web) là tiêu đề khối Inter 16/700. Dưới md giữ bottom sheet như cũ.

**Architecture:** Hai sheet web: `components/mini/bottom-sheet.tsx` (style ở `mini.css`, class `.mini-sheet-*`) và `components/ui/sheet.tsx` (Tailwind). Cả hai dùng chung một token bề rộng `--dialog-w` (480px, `tokens.css`), một keyframes `tubu-dialog-pop` (`mini.css`), một bóng `--elevation-4` và bo `--radius-sheet`. Tiêu đề dùng `Heading variant="title-sm" font="ui"` (Mini + web) và class Tailwind tương đương ở `ui/sheet.tsx`. KHÔNG sửa file của gói khác (`variation-sheet.tsx`, `coupon-box.tsx`, `pdp-extras.tsx`, `pdp-offers-sheet.tsx`).

**Tech Stack:** React 18, Next 15 + Tailwind (web), zmp-ui + Vite (Mini), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 Q1 (tiêu đề khối Inter 16/700, Fraunces chỉ tiêu đề trang và số ≥22px) và §5 mục "A11y và chuyển động chung"; nguồn lỗi `review/extra-critique-2.md` P2 #2 (tiêu đề sheet) và P2 #3 (sheet web máy tính).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Tiêu đề khối Inter 16/700 -0.01em; Fraunces chỉ tiêu đề trang và số ≥22px.
- Web khổ điện thoại (dưới md) giống Mini App cả giao diện: bottom sheet dính đáy, rộng hết khung, có tay nắm (`mini`) hoặc hàng thanh kéo `md:hidden` (`ui/sheet`, R-193): KHÔNG đổi hành vi dưới md, KHÔNG đổi hàng thanh kéo.
- Giữ nguyên hành vi đóng (mask, Esc, nút Đóng, `dismissible`), focus trap, `role="dialog" aria-modal aria-labelledby`.
- Tôn trọng `prefers-reduced-motion` ở hiệu ứng mở mới.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm.
- `pnpm lint:parity` (bánh cóc px và `max-md:`) và `pnpm lint:vars` xanh: không thêm px viết tay trong `.ts/.tsx` (CSS thuần không đếm), không thêm `max-md:`. Tailwind: không dùng `shadow-[var(--x)]` (bị đọc thành màu; có luật chặn), khai `boxShadow` trong `tailwind.config.ts`.
- Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt. Không deploy, không push, không đọc/ghi PROD, không `git stash` trần.
- Không đụng: `variation-sheet.tsx`, `add-to-cart.tsx`, `coupon-box.tsx`, `pdp-extras.tsx`, `pdp-offers-sheet.tsx`, `thanh-toan/page.tsx` (gói K1/K2/K3), `flash-sale.tsx`, `flash-boot-script.ts`, `home-layout.ts` (phiên 9b).

## Review Focus

1. Sheet cao hơn 85vh (nội dung dài, `size="full"` 92vh): từ md hộp bị kẹp 85vh, phần thân cuộn trong hộp, tiêu đề và chân luôn thấy; không cuộn nền. Test: e2e web đo `boundingBox().height <= 0.85 × viewport` với sheet nhiều nội dung; vitest class `md:max-h-[85vh]` ở `ui/sheet`.
2. Khung hẹp 768–800px: hộp không chạm mép (còn lề ≥16px mỗi bên). Test: css.spec khẳng định `width: min(calc(100% - 32px), var(--dialog-w))`.
3. Người bật giảm chuyển động: hộp hiện ngay, không scale/fade. Test: css.spec (khối `prefers-reduced-motion` tắt `animation`) vitest class `md:motion-safe:animate-dialog-pop` ở `ui/sheet` và bản Tailwind sinh thật (`tailwind.config.spec.ts`: luật animation chỉ nằm trong md > no-preference), e2e `emulateMedia({ reducedMotion: 'reduce' })` ở 1280 khẳng định animation-name `none`. Lỗi đã gặp ở review: `md:animate-*` kèm `motion-reduce:animate-none` thua về thứ tự CSS (luật md sinh sau luật motion-reduce) nên giảm chuyển động vẫn chạy hiệu ứng; dùng `md:motion-safe:`.
4. Sheet `size="auto"` nội dung ngắn (vài dòng): hộp ôm nội dung, không kéo dài 50% màn (luật `min-height: 50%` của bản điện thoại không áp từ md). Test: css.spec `min-height: 0` trong khối md; e2e đo chiều cao hộp của `ui/sheet` nội dung ngắn nhỏ hơn 50vh.
5. Hai sheet chồng nhau, `dismissible=false`: không đổi (focus trap và Esc chỉ ở sheet trên cùng). Test: các ca có sẵn trong `bottom-sheet.spec.tsx`/`sheet.spec.tsx` vẫn xanh.

---

## File Structure

- Modify: `packages/design-tokens/src/tokens.css` (thêm `--dialog-w`).
- Modify: `apps/web/src/components/mini/mini.css` (khối `.mini-sheet-*`, keyframes `tubu-dialog-pop`), `apps/web/src/components/mini/css.spec.ts` (ca CSS mới).
- Modify: `apps/web/src/components/mini/bottom-sheet.tsx` (+ `bottom-sheet.spec.tsx`): tiêu đề Inter 16/700.
- Modify: `apps/miniapp/src/components/ui/bottom-sheet.tsx` (+ `bottom-sheet.spec.tsx`): tiêu đề Inter 16/700.
- Modify: `apps/web/src/components/ui/sheet.tsx` (+ `sheet.spec.tsx`, và một dòng `md:max-w-lg` → `md:max-w-[var(--dialog-w)]` ở `app/san-pham/[slug]/pdp-extras.spec.tsx`), `apps/web/tailwind.config.ts` (+ `tailwind.config.spec.ts`): hộp thoại md; tiêu đề `mt-1.5` để tâm trùng nút Đóng.
- Create: `apps/e2e/tests/sheet-desktop.web.spec.ts` (web 1280 + 375), `apps/e2e/tests/sheet-title.miniapp.spec.ts` (Mini 375).
- Modify: `DESIGN.md` (một dòng nhật ký quyết định + dòng token `--dialog-w`).

---

### Task 1: Token `--dialog-w` và CSS hộp thoại từ md cho `.mini-sheet-*`

**Files:**
- Modify: `packages/design-tokens/src/tokens.css` (cạnh `--section-header-h`)
- Modify: `apps/web/src/components/mini/mini.css` (khối "Sheet", trước `.tubu-shop-top-bar`)
- Test: `apps/web/src/components/mini/css.spec.ts`

**Interfaces:**
- Produces: token `--dialog-w: 480px`; `@keyframes tubu-dialog-pop` (opacity 0→1, `translateY(8px) scale(0.97)` → `none`, dùng chung `ui/sheet` ở Task 3); lớp `.mini-sheet-*` không đổi tên.

- [ ] **Step 1: Viết test đỏ** trong `css.spec.ts`, `describe('mini.css: sheet từ md là hộp thoại giữa màn')`. Lấy khối md bằng regex trên `@media (min-width: 768px)` đứng ngay sau `.mini-sheet-handler::before`. Các ca:
  - `ẩn tay nắm`: khối md khớp `/\.mini-sheet-handler\s*\{[^}]*display:\s*none/`.
  - `hộp giữa màn, rộng tối đa --dialog-w, còn lề 16px mỗi bên`: khối md có `.mini-sheet-root` với `display: flex; align-items: center; justify-content: center`; `.mini-sheet-panel` có `position: relative`, `width: min(calc(100% - 32px), var(--dialog-w))`, `min-height: 0`, `max-height: 85vh`, `border-radius: var(--radius-sheet)`, `box-shadow: var(--elevation-4)`.
  - `mở bằng fade/scale, giảm chuyển động thì tắt`: khối md có `animation: tubu-dialog-pop`; css có `@keyframes tubu-dialog-pop`; trong một `@media (prefers-reduced-motion: reduce)` có `.mini-sheet-panel` với `animation: none`.
  - `dưới md không đổi`: phần ngoài khối md vẫn có `border-radius: 16px 16px 0 0` và `animation: slideUp`.
  - `tokens.css` có `--dialog-w: 480px`.

- [ ] **Step 2: Chạy, thấy đỏ.** `pnpm --filter @tubutree/web exec vitest run src/components/mini/css.spec.ts` → FAIL các ca mới.

- [ ] **Step 3: Cài đặt.**
  - `tokens.css`: `--dialog-w: 480px; /* hộp thoại web máy tính: sheet từ md, cùng bề rộng ở hai sheet web */`.
  - `mini.css`: viết lại khối `@media (min-width: 768px)` của sheet (bỏ `left:50% / translateX(-50%) / animation: none`); thêm `@keyframes tubu-dialog-pop`; mask fade nhẹ cùng tên keyframes `tubu-dialog-fade` (opacity); khối `prefers-reduced-motion` tắt cả hai animation của sheet. Gốc `.mini-sheet-root` căn bằng flex ở md để không dùng `transform` căn giữa (transform dành cho animation). Cập nhật chú thích đầu khối: từ md là hộp thoại, không còn tay nắm.

- [ ] **Step 4: Chạy lại, thấy xanh** (lệnh Step 2) và `pnpm --filter @tubutree/web exec vitest run src/components/mini/bottom-sheet.spec.tsx`.

- [ ] **Step 5: Commit** `feat(web): sheet mini từ md là hộp thoại giữa màn rộng tối đa 480px, bỏ tay nắm, mở fade/scale` (+ token và spec).

### Task 2: Tiêu đề sheet Inter 16/700 ở Mini và `components/mini` của web

**Files:**
- Modify: `apps/web/src/components/mini/bottom-sheet.tsx:114`, `apps/miniapp/src/components/ui/bottom-sheet.tsx:174`
- Test: `apps/web/src/components/mini/bottom-sheet.spec.tsx`, `apps/miniapp/src/components/ui/bottom-sheet.spec.tsx`

**Interfaces:**
- Consumes: `Heading` (`font?: 'display' | 'ui'`, `variant: HeadingVariant`, `id`) của `text.tsx` mỗi app (đã có).
- Produces: tiêu đề sheet là `<h2>` có `fontFamily: var(--font-ui)`, `fontSize: var(--type-title-sm-size)`, `fontWeight: 700`, `letterSpacing: -0.01em`.

- [ ] **Step 1: Viết test đỏ** (cả hai spec), ca `tiêu đề là tiêu đề khối: Inter 16/700, không phải Fraunces 18`: mở sheet có `title`, lấy `h2`, khẳng định `style.fontFamily` = `var(--font-ui)`, `style.fontSize` = `var(--type-title-sm-size)`, `style.fontWeight` = `700`, `style.letterSpacing` = `-0.01em`.
- [ ] **Step 2: Chạy, thấy đỏ.** web: `pnpm --filter @tubutree/web exec vitest run src/components/mini/bottom-sheet.spec.tsx`; Mini: `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/bottom-sheet.spec.tsx`.
- [ ] **Step 3: Cài đặt:** đổi `Heading variant="title-md" as="h2"` thành `Heading variant="title-sm" font="ui" as="h2"` ở cả hai file (giữ `id={titleId}`).
- [ ] **Step 4: Chạy lại, thấy xanh** (hai lệnh Step 2; thêm `typography.spec.tsx`/`text.spec.tsx` của web nếu đỏ).
- [ ] **Step 5: Commit** `fix(ui): tiêu đề sheet là tiêu đề khối Inter 16/700 ở Mini và web (final-critique P2 #2)`.

### Task 3: `ui/sheet.tsx` cùng dạng hộp thoại và tiêu đề Inter 16/700

**Files:**
- Modify: `apps/web/src/components/ui/sheet.tsx`, `apps/web/tailwind.config.ts`
- Test: `apps/web/src/components/ui/sheet.spec.tsx`, `apps/web/tailwind.config.spec.ts`

**Interfaces:**
- Consumes: `--dialog-w`, `tubu-dialog-pop` (Task 1).
- Produces: Tailwind `boxShadow.dialog = 'var(--elevation-4)'`, `animation['dialog-pop'] = 'tubu-dialog-pop 180ms ease-out both'`; `Sheet` props và `data-sheet-handle`, `data-sheet-body`, `data-sheet-footer` giữ nguyên.

- [ ] **Step 1: Viết test đỏ.**
  - `tailwind.config.spec.ts`: `ext.boxShadow` có `dialog: 'var(--elevation-4)'`; `ext.animation` có `'dialog-pop'` bắt đầu bằng `tubu-dialog-pop`.
  - `sheet.spec.tsx`, ca `hộp thoại từ md: rộng --dialog-w, cao tối đa 85vh, bo đủ góc, bóng, mở fade/scale tắt khi giảm chuyển động`: lấy `[role="dialog"]`, khẳng định `className` chứa `md:max-w-[var(--dialog-w)]`, `md:max-h-[85vh]`, `md:rounded-sheet`, `md:shadow-dialog`, `md:motion-safe:animate-dialog-pop`, và KHÔNG chứa `md:max-w-lg` hay `md:animate-dialog-pop` trần; nền `[data-sheet-backdrop]` chứa `md:motion-safe:animate-dialog-fade`. Ca `size="full"` có `md:h-[85vh]` (không còn `92vh` ở md). Ca `size="half"` giữ `h-[50vh]`.
  - ca `tiêu đề là tiêu đề khối`: `h2` có class `font-ui`, `text-base`, `font-bold`, không có `font-display`.
  - ca `hàng thanh kéo giữ nguyên`: `[data-sheet-handle]` có class `md:hidden` (R-193).
- [ ] **Step 2: Chạy, thấy đỏ.** `pnpm --filter @tubutree/web exec vitest run src/components/ui/sheet.spec.tsx tailwind.config.spec.ts`.
- [ ] **Step 3: Cài đặt.** `SIZE_CLASS`: auto `max-h-[92vh] md:max-h-[85vh]`, half `h-[50vh]`, full `h-[92vh] md:h-[85vh]`. Khung hộp: `md:max-w-[var(--dialog-w)] md:rounded-sheet md:shadow-dialog md:animate-dialog-pop motion-reduce:animate-none`; giữ `rounded-t-sheet shadow-card`. Tiêu đề: `font-ui text-base font-bold leading-6 tracking-[-0.01em] text-stone-900`. `tailwind.config.ts`: thêm `boxShadow.dialog`, `animation` (`dialog-pop`, `dialog-fade`). Cập nhật doc-comment của `Sheet` (từ md rộng tối đa 480px, cao tối đa 85vh).
- [ ] **Step 4: Chạy lại, thấy xanh** (lệnh Step 2 + toàn bộ spec dùng `Sheet`: `pnpm --filter @tubutree/web exec vitest run src/components/ui/sheet.spec.tsx src/app/san-pham src/app/kho-qua src/app/tai-khoan`).
- [ ] **Step 5: Commit** `feat(web): ui/sheet từ md rộng 480px, cao tối đa 85vh, bóng và mở fade/scale như sheet mini; tiêu đề Inter 16/700`.

### Task 4: E2E đo hộp thoại và tiêu đề

**Files:**
- Create: `apps/e2e/tests/sheet-desktop.web.spec.ts`, `apps/e2e/tests/sheet-title.miniapp.spec.ts`

**Interfaces:**
- Consumes: `./support/mock-api` (`test`, `expect`, `makeUser`, `mockSession`), `./support/pdp-product` (`firstProduct`), `./support/pilot-mocks` (`mockPilotProduct`, `PILOT_PRODUCT`, `PILOT_PRODUCT_NAME`, `PILOT_SLUG`).

- [ ] **Step 1: Viết spec web** (cần API thật như `pdp-desktop.web.spec.ts`, tự bỏ qua khi DB chưa có sản phẩm). Mock PDP như `pdp-desktop` (đã đăng nhập, `/me/coupons` có 2 mã để có sheet Ưu đãi). Helper `expectDialogBox(page, viewport)` đo `[role="dialog"]`: `boundingBox`. Ca 1280×800:
  - mở dòng "Ưu đãi" (`getByRole('button', { name: /Ưu đãi/ })`): tâm hộp cách tâm khung ≤2px cả hai trục, `width <= 480`, `height <= 0.85 × 800`, `[role="dialog"] > div[aria-hidden]` (tay nắm `.mini-sheet-handler`) có `display: none` (hoặc không có box), `border-top-left-radius` và `border-bottom-left-radius` đều > 0, tiêu đề `h2`: `fontFamily` bắt đầu `Inter`, `fontWeight` 700, `fontSize` 16px; Esc đóng; mở lại, bấm mask đóng.
  - mở `ui/sheet`: `getByTestId('pdp-points-earn')`: cùng các khẳng định (không có tay nắm thấy được: `[data-sheet-handle]` không visible); hộp nội dung ngắn cao dưới 50% khung (Review Focus 4).
  - Ca 375×812: mở lại hai sheet: hộp dính đáy (`box.y + box.height` bằng chiều cao khung ±1), rộng bằng khung (±1), `ui/sheet` có hàng thanh kéo visible; tiêu đề vẫn Inter 700 16px.
- [ ] **Step 2: Viết spec Mini** `sheet-title.miniapp.spec.ts`: mở `/wishlist` với `mockPilotProduct` + 2 phân loại (như `wishlist-quick-add.miniapp.spec.ts`), bấm nút thêm giỏ, chờ `getByRole('dialog').getByRole('heading', { name: 'Chọn phân loại' })`; khẳng định computed: `fontFamily` bắt đầu `Inter`, `fontWeight` `700`, `fontSize` `16px`.
- [ ] **Step 3: Chạy.** Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3521 npx playwright test tests/sheet-title.miniapp.spec.ts --workers=1 --reporter=line` → PASS (đỏ trước Task 2 nếu chạy trên base). Web: `E2E_API_PORT=3522 E2E_WEB_PORT=3523 E2E_MINIAPP_PORT=3524 bash apps/e2e/scripts/web-gate.sh tests/sheet-desktop.web.spec.ts tests/a11y-shop.web.spec.ts tests/ds-parity.shop.spec.ts tests/pdp-mobile.web.spec.ts --workers=2 --reporter=line`.
- [ ] **Step 4: Sửa test cũ đỏ vì thiết kế đã chốt** (nếu có: ca đo tiêu đề sheet Fraunces, ca đo sheet 560px), ghi vào notes.
- [ ] **Step 5: Commit** `test(e2e): sheet web từ md là hộp thoại giữa màn 480px, tiêu đề sheet Inter 16/700 ở Mini và web`.

### Task 5: Tài liệu, bánh cóc, chụp so, gate

**Files:**
- Modify: `DESIGN.md` (nhật ký: dòng ngày 2026-11-02 "Sheet: từ md hộp thoại giữa màn 480px (`--dialog-w`) …"; bảng token thêm `--dialog-w`), `scripts/uiux/ds-baseline.json` (chỉ khi đếm giảm).
- Screens (ngoài git): `docs/2026-10-31-shop-redesign/screens/K7/`.

- [ ] **Step 1: Cập nhật `DESIGN.md`** (một dòng nhật ký, một dòng token). Chạy `pnpm --filter @tubutree/app-core exec vitest run src/design-docs.spec.ts` → xanh (token trong DESIGN.md phải có trong `tokens.css`).
- [ ] **Step 2: Bánh cóc.** `pnpm lint:parity` và `pnpm lint:vars` xanh; nếu số px/`max-md:` giảm thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- [ ] **Step 3: Chụp** (Vite Mini cổng 3521, Next web cổng 3522, host localhost; API giả như `handoff-wave2.md` "Bẫy môi trường"): web1280 trước/sau sheet Ưu đãi và một `ui/sheet`; mini375/web375 tiêu đề sheet trước/sau. Lưu `screens/K7/`. Tắt server của mình khi xong.
- [ ] **Step 4: Gate:** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 07818cc2b --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-K7.txt`, rồi bộ e2e Mini đầy đủ (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3521 npx playwright test --workers=2 --reporter=line`). FAIL có từ base thì so log và ghi "có sẵn".
- [ ] **Step 5: Commit** `docs(design): ghi quyết định sheet hộp thoại từ md và token --dialog-w`.

## Self-Review

- Spec coverage: P2 #3 (Task 1 + 3, e2e Task 4), P2 #2 (Task 2 + 3), `ui/sheet` md (Task 3), ảnh trước/sau và notes (Task 5), 375 giữ nguyên (Task 4 ca 375, Task 1 "dưới md không đổi").
- Chữ ký nhất quán: `--dialog-w`, `tubu-dialog-pop`, `boxShadow.dialog`, `animation['dialog-pop']` dùng cùng tên ở Task 1, 3.
- Review Focus 1–5 đều có test ở Task 1/3/4.
