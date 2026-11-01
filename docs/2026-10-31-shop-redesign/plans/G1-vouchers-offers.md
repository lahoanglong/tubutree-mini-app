# G1 `vouchers-offers` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các MINOR còn lại của F10d (chữ phiếu mã, chấm đỏ Ưu đãi, phiếu cao không đều) và năm P2 của `review/final-critique.md` về mã giảm giá và Ưu đãi (số 23, 32, 33, 34, 37), ở cả Mini App và web.

**Architecture:** Luật chữ và đếm nằm ở `packages/app-core` (`voucher.ts`, helper `see-all.ts` mới, khoá `zalo.link`); hai app chỉ vẽ cùng cấu trúc. `VoucherTicket` và `Heading` sửa tại chỗ, không thành phần song song. Banner Ưu đãi từ lg đổi tỉ lệ bằng biến CSS cục bộ, không đổi `--banner-ratio` của điện thoại.

**Tech Stack:** TypeScript, React 18 (Mini: zmp-ui + Vite, web: Next 15 + Tailwind 3), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q1, Q5, Q10, Q13). Nguồn việc: các dòng `[F10d]` của MINOR F10 và `review/final-critique.md` bảng P2 dòng 23, 32, 33, 34, 37 (ảnh ở `.claude/worktrees/shop-capture/docs/2026-10-31-shop-redesign/screens/final/`). Bàn giao các đợt trước: `plans/handoff-wave*.md` (đặc biệt `F10d-offers-vouchers.md` phần "Vòng sửa sau review").

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree đã chạy `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chức năng cho khách: Mini App và web cùng gói; logic và chữ ở `packages/app-core`. Chữ mới thêm cả `shop-copy.ts` lẫn `shop-copy-budget.ts` (spec bắt thiếu một bên). Hai file đó và `ds-map.json` gộp tay với G2/G3: chỉ thêm dòng ở cuối nhóm của mình, xoá đúng dòng của mình.
- Tiêu đề khối Inter 16/700 -0.01em; Fraunces chỉ cho tiêu đề trang và số ≥22px (Q1).
- Số tiền trên phiếu viết rút gọn bằng `vndShort`; một phiếu không trộn "99.000đ" với "99k".
- Phiếu `ticket` cao ~88px ở 375px; vùng chạm ≥44px; tương phản ≥4,5:1; axe 0 vi phạm ở 375px trên màn đụng tới.
- Số px viết tay và lớp `max-md:` chỉ được giảm (`pnpm lint:parity`, baseline `scripts/uiux/ds-baseline.json`): dùng token, lớp Tailwind có sẵn; nếu gói hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline.
- Không đổi `--banner-ratio` (điện thoại 5 / 2). Mini entry ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`).
- Không sửa file của G2 (giỏ, `flash-price.ts`, `price.ts`, `pdp-view.ts`, `.tubu-scroll-pad-sticky-bar`) và G3 (PDP hai app, `components/product/*` trừ `pdp-bundles.tsx`, `terminology.spec.ts` ngoài phần hạ trần). Không deploy, không đọc/ghi PROD, không push, không `git stash` trần.
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.

## Review Focus

1. Tên mã admin đặt có số nhỏ không đơn vị (số lượt, số đơn, số bạn) hoặc ghi tiền bằng chữ ("20.000 đồng", "20.000 VND", "50 nghìn"): phiếu không bao giờ in "20k đồng", không mất số lượng; tên chỉ có số của chính mã vẫn bị bỏ. Test: Task 1 bảng tên.
2. Ví có đúng 4 mã sắp hết hạn, Ưu đãi chỉ vẽ 3: chấm đỏ còn sáng cho mã thứ 4 tới khi khách thấy mã đó (ở `/vouchers?tab=mine` thì tắt). Test: Task 3 (hook và hai trang).
3. Phiếu có mã dài, tên admin đặt, hạn dùng và "Còn n lượt" cùng lúc, ở 375px và 320px: nhãn một dòng, không cắt mã, chiều cao nằm trong khung 88–104px. Test: Task 4 e2e `voucher-ticket-height`.
4. Chip phiếu của thương hiệu có chữ phụ dài (mã nằm cuối câu): không mất mã bằng "…" ở hai dòng đầu. Test: Task 4 vitest chip.
5. Khối "xem tất cả" khi mục rỗng, đúng 1 mục, đúng bằng số đang vẽ: ẩn khi 0, "Tất cả (n)" từ 1 mục. Test: Task 2.

---

## File Structure

| Việc | File |
|---|---|
| Chữ phiếu: tiền bằng chữ, số nhỏ không đơn vị | `packages/app-core/src/commerce/voucher.ts` (+ `voucher.spec.ts`) |
| "Tất cả (n)" một mẫu | `packages/app-core/src/commerce/see-all.ts` (mới, + spec), `shop-copy.ts`, `shop-copy-budget.ts`; dùng ở `apps/miniapp/src/components/offers/offers-collect.tsx`, `pages/offers.tsx`, `pages/brand-view.tsx`, `components/ui/shop-section.tsx` và bản web (`apps/web/src/components/offers/offers-collect.tsx`, `app/uu-dai/page.tsx`, `components/shop-page/brand-body.tsx`, `components/mini/shop-section.tsx`) |
| Chấm đỏ chỉ theo mã vẽ | `apps/miniapp/src/pages/offers.tsx`, `pages/vouchers.tsx`, `hooks/use-offers-dot.ts` (+ spec); `apps/web/src/app/uu-dai/page.tsx`, `app/ma-giam-gia/vouchers-view.tsx`, `lib/use-offers-dot.ts` (+ spec) |
| Phiếu | `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (+ spec), `apps/e2e/tests/voucher-ticket-height.miniapp.spec.ts` |
| Fraunces dưới 22px | `components/ui/text.tsx` và `components/mini/text.tsx` (`Heading font`), `loyalty/daily-check-in-card.tsx`, `home/guest-link-card.tsx` (Mini) và `mini/guest-link-card.tsx` (web), `offers/offers-points-strip.tsx` hai app |
| Nhãn Zalo một chỗ | `shop-copy.ts` (`zalo.link`), `apps/miniapp/src/components/home/guest-link-card.tsx`, `loyalty/guest-points-note.tsx`, `loyalty/daily-check-in-card.tsx`, `pages/offers.tsx` |
| Banner lg | `apps/web/src/components/campaign/campaign-banner.tsx` (+ spec) |

---

### Task 1: Chữ phiếu: tiền viết bằng chữ và số nhỏ không đơn vị (app-core)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher.ts` (`FIGURE_RE`, `figureValue`, `wordsOf`, `restatesCoupon`, `unifyFigures`)
- Test: `packages/app-core/src/commerce/voucher.spec.ts`

**Interfaces:**
- Produces: không đổi chữ ký công khai (`voucherView`, `couponTitle`). Hành vi: đơn vị tiền viết chữ (`đồng`, `dong`, `VND`, `vnđ`) đi cùng số thành một cụm có đơn vị (cùng nghĩa `đ`), nên `restatesCoupon` coi "20.000 đồng" như "20.000đ" và `unifyFigures` đổi cả cụm ("20.000 đồng" thành "20k"), không bao giờ ra "20k đồng". Số trơn nhỏ không đơn vị (<1.000) trong tên mã là thông tin riêng (số đơn, số bạn, số lượt) nên tên chứa nó KHÔNG bị coi là nhắc lại mã (`restatesCoupon` trả false), số đó để nguyên.

- [ ] **Step 1: Test đỏ** (`voucher.spec.ts`, mô tả `voucherView: tên admin nhắc lại số` thêm các ca; mã `coupon({ value: 20_000, minOrder: 300_000 })` loại AMOUNT):
  - `'Tặng 20.000 đồng cho bạn'` → `name` null (chỉ có số của mã và từ nối); `'Giảm 20.000 VND'` → null; `'Giảm 20.000vnđ'` → null.
  - Tên được giữ: `'Tặng 20.000 đồng cho đơn đầu tiên'` → `'Tặng 20k cho đơn đầu tiên'`; `'Giảm 20.000 VND cho khách mới'` → `'Giảm 20k cho khách mới'`; không ca nào chứa chuỗi `'k đồng'` hay `'k VND'`.
  - Số lạ cạnh tiền chữ để nguyên: `'Tặng 5.000 đồng vào ví'` (5.000 không phải số của mã) → `'Tặng 5.000 đồng vào ví'`.
  - Số nhỏ không đơn vị giữ tên: `'Giảm 20k cho 3 đơn'`, `'Giảm 20.000đ cho 2 đơn'` (đơn từ 300k), `'Giảm 20k khi mua 2'`, `'Giảm 20k cho 100 bạn'` → `name` bằng đúng `'Giảm 20k cho 3 đơn'`, `'Giảm 20k cho 2 đơn'`, `'Giảm 20k khi mua 2'`, `'Giảm 20k cho 100 bạn'`. FREESHIP `minOrder 99_000` với `'Freeship 2 đơn từ 99k'` → `'Freeship 2 đơn từ 99k'` (giữ).
  - Ca cũ vẫn xanh: `'Giảm 20k'`, `'Giảm 30000đ'`, `'Giảm 10% tối đa 50.000đ'` → null.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher.spec.ts`
- [ ] **Step 3: Cài đặt** trong `voucher.ts`: thêm nhánh đơn vị `đồng|dong|vn[đd]` (chữ không dính chữ cái liền sau, như `đ`) vào `FIGURE_RE` và coi nó là `đ` trong `figureValue`; thêm `dong\b|vnd\b` vào mẫu số đơn vị của `wordsOf` (chữ đã `fold`); trong `restatesCoupon` mỗi số trơn không đơn vị mà `figureValue` trả null (số nhỏ) thì trả `false` ngay.
- [ ] **Step 4: Chạy xanh** lệnh Step 2 rồi `npx tsc --noEmit` và `npx vitest run src/commerce` trong `packages/app-core`.
- [ ] **Step 5: Commit** `fix(app-core): tên mã ghi tiền bằng chữ không thành "20k đồng", số nhỏ không đơn vị giữ tên (G1 F10d MINOR)`.

### Task 2: Một mẫu "Tất cả (n)" cho Ưu đãi và Thương hiệu (app-core + hai app)

**Files:**
- Create: `packages/app-core/src/commerce/see-all.ts`, `packages/app-core/src/commerce/see-all.spec.ts`
- Modify: `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` (xoá `shop.seeAllN` và `coupon.allCount`, không còn nơi dùng sau task này); Mini: `components/offers/offers-collect.tsx`, `pages/offers.tsx`, `pages/brand-view.tsx`, `components/ui/shop-section.tsx`; web: `components/offers/offers-collect.tsx`, `app/uu-dai/page.tsx`, `components/shop-page/brand-body.tsx`, `components/mini/shop-section.tsx`
- Test: `see-all.spec.ts`, `apps/miniapp/src/pages/offers.spec.tsx`, `apps/web/src/app/uu-dai/page.spec.tsx`, spec của `shop-section` hai app (nếu đang kiểm nhãn "Tất cả (n)" thì giữ nguyên chữ)

**Interfaces:**
- Produces: `seeAllLabel(total: number | null | undefined): string | null` trong `@tubutree/app-core/commerce/see-all`: `fillCopy('section.seeAllCount', { n })` khi `total` là số hữu hạn ≥ 1, ngược lại `null`. Quy ước: `n` là số mục trang đích sẽ vẽ (Mã của tôi: `mine.total`; Nhận mã: `all.length` của `collectRows`; Sản phẩm nổi bật/ShopSection: tổng sản phẩm); nút không vẽ khi `null`. Tên đọc không đổi (đã có `spoken` hoặc mặc định "Tất cả (8) Mã của tôi").

- [ ] **Step 1: Test đỏ**: `see-all.spec.ts`: `seeAllLabel(0)`, `seeAllLabel(null)`, `seeAllLabel(undefined)`, `seeAllLabel(NaN)` là `null`; `seeAllLabel(1)` là `'Tất cả (1)'`; `seeAllLabel(16)` là `'Tất cả (16)'`. `offers.spec.tsx` (Mini) và `uu-dai/page.spec.tsx` (web): ví có 0 mã thì `SectionHeader` của "Mã của tôi" không có nút (`queryByRole('button', { name: /Tất cả/ })` null, cũng không "Xem tất cả" cho khối này); ví 2 mã thì nút tên "Tất cả (2) Mã của tôi"; ví 8 mã thì "Tất cả (8) Mã của tôi" và đúng 3 phiếu.
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/commerce/see-all.spec.ts` (app-core), `npx vitest run src/pages/offers.spec.tsx` (miniapp), `npx vitest run src/app/uu-dai/page.spec.tsx` (web).
- [ ] **Step 3: Cài đặt** `seeAllLabel`; đổi mọi chỗ gọi `fillCopy('section.seeAllCount' | 'shop.seeAllN', ...)` ở danh sách file trên sang `seeAllLabel` (bỏ `action` khi nhãn `null`); "Mã của tôi" truyền `action={label ? { onPress, label } : undefined}`; xoá hai khoá khỏi hai file chữ.
- [ ] **Step 4: Chạy xanh** ba lệnh Step 2 + `npx vitest run src/shop-copy.spec.ts` (app-core) + spec `shop-section`/`brand-view`/`offers-collect` của hai app.
- [ ] **Step 5: Commit** `fix(offers): một mẫu "Tất cả (n)", ẩn khi rỗng, ở Ưu đãi và Thương hiệu (G1 P2 #33)`.

### Task 3: Chấm đỏ Ưu đãi chỉ đánh dấu mã thật sự vẽ (hai app)

**Files:**
- Modify: Mini `pages/offers.tsx`, `pages/vouchers.tsx`; web `app/uu-dai/page.tsx`, `app/ma-giam-gia/vouchers-view.tsx` (hook `useMarkExpiringSeen` ở `hooks/use-offers-dot.ts` và `lib/use-offers-dot.ts` giữ chữ ký `(coupons: readonly CouponDTO[] | undefined) => void`)
- Test: `apps/miniapp/src/hooks/use-offers-dot.spec.tsx`, `apps/web/src/lib/use-offers-dot.spec.tsx`, `offers.spec.tsx`/`uu-dai/page.spec.tsx`, `vouchers.spec.tsx`/`vouchers-view.spec.tsx`

**Interfaces:**
- Produces: nơi gọi truyền CHỈ các mã đang được vẽ: Ưu đãi truyền `mine.shown.map((r) => r.coupon)` (bọc `useMemo` theo `rows` để tham chiếu ổn định), trang Mã giảm giá truyền các mã của `shown` khi `tab === 'mine'` (đã qua chip lọc). Hook không đổi hành vi: đánh dấu mã sắp hết hạn trong mảng nhận vào.

- [ ] **Step 1: Test đỏ**: hook (cả hai app): ví 4 mã sắp hết hạn `A,B,C,D`; `useMarkExpiringSeen([A,B,C])` rồi `useOffersDot` vẫn khác `null` (`'coupon-expiring'`) vì `D` chưa thấy; thêm `useMarkExpiringSeen([A,B,C,D])` thì `null`. Trang Ưu đãi (Mini và web): ví 4 mã sắp hết hạn, render trang rồi đọc khoá `tubu_offers_seen_coupons` trong localStorage: chỉ chứa 3 khoá `code@endAt` (mã thứ 4 không có). Trang Mã giảm giá tab "Mã của tôi": mở thì cả 4 khoá được ghi; đổi chip "Miễn phí giao hàng" làm còn mã không sắp hết hạn thì không thêm khoá nào.
- [ ] **Step 2: Chạy đỏ.** vitest từng file ở miniapp và web.
- [ ] **Step 3: Cài đặt** như Interfaces; trang Mã giảm giá gọi hook vô điều kiện (hooks không đặt trong `if`) với mảng rỗng khi không phải tab mine hoặc chưa đăng nhập.
- [ ] **Step 4: Chạy xanh** lệnh Step 2 + `use-offers-dot.spec` + `bottom-nav*.spec`.
- [ ] **Step 5: Commit** `fix(offers): chấm đỏ chỉ tắt cho mã thật sự vẽ, trang Mã giảm giá cũng đánh dấu (G1 F10d MINOR)`.

### Task 4: Phiếu cao đều, chip không cắt mã (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (hai file giống nhau trừ `'use client'` và dòng nguồn)
- Test: `voucher-ticket.spec.tsx` hai app; `apps/e2e/tests/voucher-ticket-height.miniapp.spec.ts`

**Interfaces:**
- Consumes: `VoucherView` (`title`, `name`, `condition`, `expiry`, `quota`, `code`) không đổi.
- Produces: biến thể `ticket`: hàng đáy = hạn dùng · số lượt · mã (`voucher-expiry`, `voucher-quota`, `voucher-code` cùng một hàng `display:flex; flex-wrap:wrap` có `data-testid="voucher-foot"`, mỗi mục `nowrap`, dấu " ·" dính đuôi mục trước; mã dài nhất nên đứng cuối, hàng hẹp chỉ gãy ở mã); `voucher-meta` của ticket chỉ còn điều kiện (vẽ khi `condition` khác rỗng) và đứng chung một hàng flex với `voucher-name` (tên co bằng "…", dấu "·" `aria-hidden`), vì mỗi dòng caption cao 20px nên hàng riêng cho tên làm phiếu cao hơn. Thân ticket đệm `8px 10px 8px 12px`, `display:flex; flex-direction:column; justify-content:center`. `row` giữ mã trong `voucher-meta`. `chip`: `voucher-meta` cho phép tối đa hai dòng (`-webkit-line-clamp: 2`, bỏ `nowrap`) để chữ phụ dài có mã cuối câu ("Giảm 15% đơn từ 250.000đ với mã BEPXANH15") không mất mã thành "…" ở dòng đầu; tiêu đề chip vẫn một dòng.

- [ ] **Step 1: Test đỏ**: `ticket` với `name: 'Chào bạn mới'`, `quota: 'Còn 3 lượt'`: `voucher-foot` chứa hạn, số lượt và mã theo thứ tự đó; `voucher-meta` có text đúng `'Đơn từ 250k'` (không chứa mã); không `condition` thì không có `voucher-meta`; không `expiry` mà có mã thì `voucher-foot` vẫn có mã; `row` giữ `'Đơn từ 250k · FUWA3E'`. `chip` với `condition: 'Giảm 15% đơn từ 250.000đ với mã BEPXANH15'`: `voucher-meta` có `WebkitLineClamp` '2', không `white-space: nowrap`. e2e: bỏ `EDGE_CODES`/124: ở 375px mọi phiếu cao 88–96px, riêng phiếu có hàng đáy gãy dòng tối đa 104px, chênh trong một danh sách ≤16px; nhãn một dòng (≤24px). Ở 320px chỉ kiểm mã 15 ký tự nằm trọn trong phiếu (nhãn có thể gãy hai dòng ở máy nhỏ nhất, không đặt trần cao).
- [ ] **Step 2: Chạy đỏ.** vitest `voucher-ticket.spec.tsx` ở miniapp và web; e2e `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3381 npx playwright test voucher-ticket-height`.
- [ ] **Step 3: Cài đặt** như Interfaces; một bản mã cho hai app. Đo bằng e2e và chỉnh trần theo số đo thật (ghi số vào notes).
- [ ] **Step 4: Chạy xanh** hai vitest + các spec dùng `VoucherTicket` (`offers`, `vouchers`, `pdp-offers-sheet`, `voucher-sheet`, `brand-view`, `campaign`, `shop-page`) + e2e Step 2; spec nào đỏ vì bố cục mới thì sửa chữ mong đợi theo thiết kế.
- [ ] **Step 5: Commit** `fix(ui): phiếu mã đưa mã xuống hàng hạn dùng, điều kiện và tên admin một hàng, cao đều 88-98px; chip hai dòng không cắt mã (G1 F10d MINOR, P2 #23)`.

### Task 5: Fraunces dưới 22px ở Ưu đãi thành Inter (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/ui/text.tsx`, `apps/web/src/components/mini/text.tsx`; Mini `components/loyalty/daily-check-in-card.tsx`, `components/home/guest-link-card.tsx`, `components/offers/offers-points-strip.tsx`; web `components/loyalty/daily-check-in-card.tsx`, `components/mini/guest-link-card.tsx`, `components/offers/offers-points-strip.tsx`
- Test: `text.spec.tsx` hai app (nếu chưa có thì thêm cạnh file), spec của ba thành phần trên ở hai app

**Interfaces:**
- Produces: `Heading` thêm prop `font?: 'display' | 'ui'` (mặc định `'display'`); `'ui'` đặt `fontFamily: var(--font-ui)` và `fontWeight: 700`, vẫn theo `variant` cho cỡ và `letterSpacing -0.01em`. Ba chỗ dưới 22px ở Ưu đãi dùng `font="ui"`: tiêu đề "Điểm danh mỗi ngày", tiêu đề `GuestLinkCard`, số điểm của dải Điểm Xanh (giữ cỡ `title-md` 18px để dải không đổi chiều cao).

- [ ] **Step 1: Test đỏ**: `Heading font="ui"` có `style.fontFamily` là `var(--font-ui)` và `fontWeight` 700; không truyền `font` thì `var(--font-display)`. Mỗi thành phần: tiêu đề (`getByRole('heading', { name: 'Điểm danh mỗi ngày' })`, tiêu đề của `GuestLinkCard`, phần tử số điểm của dải) có `fontFamily` chứa `--font-ui`, không chứa `--font-display`.
- [ ] **Step 2: Chạy đỏ.** vitest các spec trên ở hai app.
- [ ] **Step 3: Cài đặt** như Interfaces.
- [ ] **Step 4: Chạy xanh** + `check-ds-parity` (`node scripts/check-ds-parity.mjs`) vì `Heading` nằm trong `ds-map.json`.
- [ ] **Step 5: Commit** `fix(offers): tiêu đề dưới 22px ở Ưu đãi dùng Inter theo Q1 (G1 P2 #32)`.

### Task 6: Ưu đãi guest Mini: một nhãn liên kết Zalo, bỏ ghi chú trùng (Mini)

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` (thêm `zalo.link`); Mini `components/home/guest-link-card.tsx`, `components/loyalty/guest-points-note.tsx`, `components/loyalty/daily-check-in-card.tsx`, `pages/offers.tsx`
- Test: `shop-copy.spec.ts`, Mini `offers.spec.tsx`, `daily-check-in-card.spec.tsx`, `guest-points-note` ở `missions-card.spec.tsx` và `g3.spec.tsx` (đổi chữ mong đợi của nút)

**Interfaces:**
- Produces: khoá `SHOP_COPY['zalo.link'] = 'Liên kết Zalo'` (ngân sách 14). `DailyCheckInCard` Mini thêm prop `guestNote?: boolean` (mặc định `true`; `false` thì không vẽ `GuestPointsNote` dù `pointsBlocked`). Ưu đãi truyền `guestNote={!isGuestUser(user)}` (khi tài khoản khách đã có `GuestLinkCard` ở trên, ghi chú trong thẻ là lặp). Nút `GuestLinkCard` ở Ưu đãi (tài khoản khách) dùng `fillCopy('zalo.link')`; `GuestPointsNote` giữ "Đăng nhập Zalo" (`guestCheckInCopy.cta`) vì câu ngay trên nó (`checkInCopy.guestPoints`, dùng chung với web) cũng nói "Đăng nhập Zalo", và nó nằm ở Điểm Xanh, Vườn Xanh, Chặng Mùa chứ không ở Ưu đãi (nơi `guestNote={false}`). `g3.spec`, e2e `loyalty.miniapp.spec` và `garden.miniapp.spec` không đổi. Web giữ "Đăng nhập Zalo" (liên kết tới trang đăng nhập web, nghĩa khác).

- [ ] **Step 1: Test đỏ**: `shop-copy.spec` xanh khi khoá có ở cả hai file; Mini `offers.spec`: tài khoản khách (`isGuestUser`) với `pointsBlocked`: đúng một nút tên "Liên kết Zalo" trong cả trang, không có `[data-testid=guest-points-note]`; tài khoản thật không có `GuestLinkCard` và không đổi. `daily-check-in-card.spec` (Mini): `guestNote={false}` + `pointsBlocked` không có ghi chú; mặc định vẫn có và nút tên "Liên kết Zalo". `missions-card.spec`/`g3.spec` không đổi (nút vẫn "Đăng nhập Zalo").
- [ ] **Step 2: Chạy đỏ.** `npx vitest run` các file trên trong `apps/miniapp`, `src/shop-copy.spec.ts` trong app-core.
- [ ] **Step 3: Cài đặt** như Interfaces (`homeCopy.profile.guestCta` ở Ưu đãi đổi sang `fillCopy('zalo.link')`; không xoá khoá cũ của `home-copy` vì trang Cá nhân còn dùng).
- [ ] **Step 4: Chạy xanh** các lệnh Step 2.
- [ ] **Step 5: Commit** `fix(offers): Ưu đãi khách Mini một nhãn Liên kết Zalo, bỏ ghi chú trùng với thẻ mời (G1 P2 #34)`.

### Task 7: Banner Ưu đãi web từ lg tỉ lệ 4:1 (web)

**Files:**
- Modify: `apps/web/src/components/campaign/campaign-banner.tsx`
- Test: `apps/web/src/components/campaign/campaign-banner.spec.tsx`

**Interfaces:**
- Produces: hai wrapper của `CampaignBanner` (khung chờ `BannerFrame` và `div[data-offers-banner]`) thêm lớp `lg:[--banner-ratio:4/1]` (chỉ ghi đè biến trong phạm vi banner Ưu đãi, từ lg; dưới lg vẫn `5 / 2`); ở 1152px bề rộng nội dung banner cao ~288px thay 460px. Khung chờ và banner thật cùng lớp nên không nhảy khi tải.

- [ ] **Step 1: Test đỏ**: render có slide: `[data-offers-banner]` có class chứa `lg:[--banner-ratio:4/1]`; lúc tải có gợi ý: `offers-banner-loading` có cùng class; ảnh vẫn dùng `aspectRatio: var(--banner-ratio)` (spec cũ). e2e đo (Task 8, `shop.web.spec`/capture): ở 1280×800 chiều cao banner ≤ 300px, ở 375px = bề rộng chia 2,5.
- [ ] **Step 2: Chạy đỏ.** `cd apps/web && npx vitest run src/components/campaign/campaign-banner.spec.tsx`
- [ ] **Step 3: Cài đặt** như Interfaces; không sửa `tokens.css`.
- [ ] **Step 4: Chạy xanh** lệnh Step 2 + `npx vitest run src/components/campaign`.
- [ ] **Step 5: Commit** `fix(web): banner Ưu đãi từ lg tỉ lệ 4:1, không đổi tỉ lệ điện thoại (G1 P2 #37)`.

### Task 8: Chụp trước/sau, e2e, bánh cóc, gate

**Files:**
- Create: ảnh ở `docs/2026-10-31-shop-redesign/screens/G1/` (thư mục gitignore), kịch bản chụp tạm ở scratchpad (không commit)
- Modify (nếu e2e cũ đỏ vì thiết kế mới): `apps/e2e/tests/offers.miniapp.spec.ts`, `offers.web.spec.ts`, `shop.web.spec.ts`, `voucher-ticket-height.miniapp.spec.ts`; `scripts/uiux/ds-baseline.json` nếu số px hạ

- [ ] **Step 1: Chụp "trước"** ở base `7d2fbce40` (worktree tạm hoặc chụp trước Task 4): Ưu đãi (đăng nhập, tài khoản khách), Mã giảm giá, trang thương hiệu; Mini (Vite dev cổng 3381) 375px, web (Next dev cổng 3382, host `localhost`) 375px, và 1280px cho Ưu đãi. API giả theo `apps/e2e/tests/support/*-mocks.ts`.
- [ ] **Step 2: Chụp "sau"** cùng cảnh, lưu `before/` và `after/`; so Mini với web 375px; tắt server của mình.
- [ ] **Step 3: e2e Mini** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3381 npx playwright test --workers=2 --reporter=line`; web một vòng `E2E_API_PORT=3382 E2E_WEB_PORT=3383 E2E_MINIAPP_PORT=3384 bash apps/e2e/scripts/web-gate.sh <spec>` cho `offers.web`, `vouchers`, `shop.web` (chấm đỏ Ưu đãi), `a11y-shop.web`, `ds-parity.shop` nếu máy cho phép. Đỏ vì thiết kế mới thì sửa test (ghi vào notes), đỏ vì hồi quy thì sửa mã.
- [ ] **Step 4: Bánh cóc** `pnpm lint:parity`; nếu hạ được số px/`max-md:` thì `node scripts/uiux/ds-ratchet.mjs --write` và commit `scripts/uiux/ds-baseline.json`.
- [ ] **Step 5: Gate** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-G1 --base 7d2fbce40 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-G1.txt` một lần, cuối. Bước FAIL đối chiếu base: có sẵn thì ghi "có sẵn".
- [ ] **Step 6: Commit** các sửa test e2e: `test(e2e): theo phiếu và Ưu đãi mới (G1)`.

---

## Self-Review

- Phủ yêu cầu: (a) Task 1; (b) Task 1; (c) Task 3; (d) Task 4; (e) Task 4 (chip); (f) Task 5; (g) Task 2; (h) Task 6; (i) Task 7; chụp, e2e, gate: Task 8.
- Tên nhất quán: `seeAllLabel` (Task 2), `Heading font`, `guestNote`, khoá `zalo.link`, `voucher-foot` định nghĩa ở Interfaces của từng task và dùng đúng tên ở test.
- Review Focus: dòng 1 Task 1, 2 Task 3, 3 và 4 Task 4, 5 Task 2.
- Phụ thuộc: Task 2 và Task 6 cùng sửa `shop-copy.ts`/`shop-copy-budget.ts` và `pages/offers.tsx`; làm theo thứ tự 1 đến 8.

---

## Vòng sửa sau review (đợt 6a)

- **Tên admin bị cắt ở dòng hẹp (MAJOR).** Dòng điều kiện + tên admin của `ticket` chỉ còn ~100px cho tên (cạnh "Đơn từ 100k" và nút "Lưu mã"/"Dùng ngay"), nên "Giảm 20k cho 3 đơn" hiện "Giảm 20k ch…" và mất "3 đơn". Sửa ở app-core, không đổi bố cục (giữ 88-98px): `voucherView.name` cắt phần đầu chép lại nhãn (`trimRepeatedLead`): chỉ khi phần đầu có ít nhất một số của chính mã và mọi từ đứng trước số đó là từ của nhãn hoặc "tặng/freeship/ship". "Giảm 20k cho 3 đơn" thành "cho 3 đơn", "Giảm 10% tối đa 50k cho khách mới" thành "cho khách mới"; "Giảm giá khách VIP", "Khách mới giảm 20k", "Freeship 2 đơn từ 99k" giữ nguyên. Tên admin không chép nhãn vẫn co bằng "…" ở ~100px: chấp nhận, vì trần chiều cao 104px không đủ chỗ cho dòng thứ hai khi phiếu có "Còn n lượt" và mã 15 ký tự (đã tính: hạn + lượt + điều kiện + mã dài cần 3 dòng đáy, thành 118px). e2e `voucher-ticket-height` thêm mã `GIAM20` (tên "Giảm 20k cho 3 đơn") ở "Mã của tôi" ("Dùng ngay") và "Nhận mã" ("Lưu mã"): `voucher-name` đúng "cho 3 đơn" và `scrollWidth <= clientWidth`.
- **Giờ vàng "Xem tất cả" không có "(n)" (MINOR).** Cố ý: trang đích `/flash-sale` chia theo khung giờ (hôm nay, ngày mai) và khung lần lượt hết giờ, không có một n đúng để hứa trước. Ghi bằng comment ở `offers-flash.tsx` hai app. Mẫu "Tất cả (n)" chỉ áp cho danh sách có tổng cố định (Mã của tôi, Nhận mã, sản phẩm thương hiệu).
- **Hai động từ cho một việc (MINOR).** Chọn: `zalo.link` ("Liên kết Zalo") chỉ ở Ưu đãi (`GuestLinkCard`); `GuestPointsNote` trả về "Đăng nhập Zalo" như trước, khớp câu "Đăng nhập Zalo để nhận Điểm Xanh" ngay trên nút và khớp web. Hoàn lại bốn chỗ test đã đổi chữ ở vòng đầu (`missions-card.spec`, `daily-check-in-card.spec`, e2e `loyalty`, `garden`).
- **Banner 4:1 cắt ảnh 5:2 (MINOR).** Ảnh vẫn phủ kín khung (không viền trống); form chiến dịch ở admin hiện lời nhắc dưới ô ảnh khi vị trí là "Đầu Ưu đãi": chữ và logo đặt ở dải giữa (~60% chiều cao) vì máy tính cắt phần trên và dưới. Test ở `campaigns-tab.spec.tsx`.
- **Mã cuối chữ phụ của chip thương hiệu (MINOR, không sửa).** Chữ phụ là chữ tự do của admin có chứa mã ("nhập với mã FUWA20K"); tách mã ra khỏi câu cần đoán chỗ cắt trong chữ tự do hoặc thêm một dòng cho mã (chip cao thêm 20px, mã hiện hai lần). Hai dòng đã đủ cho mọi dữ liệu mẫu (FUWA20K, BEPXANH15); câu chữ phụ dài quá hai dòng vẫn mất mã bằng "…" (nút "Sao chép" vẫn chép đúng mã). Muốn chắc cần đổi mô hình dữ liệu khuyến mãi (trường mã hiển thị riêng), ngoài phạm vi G1.
