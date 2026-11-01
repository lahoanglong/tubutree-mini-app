# H2 `minors-g2g3` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các MINOR reviewer để lại sau đợt 6a cho G2 (giỏ hàng) và G3 (chi tiết SP), cộng một e2e web chập chờn trên CI PR #113: web khổ điện thoại giống Mini App ở cột ô chọn giỏ, token thanh tiến độ, đường kẻ trên chip phân loại, tên đọc của sao; test đúng thứ tự khối PDP không bị skip; tài liệu thiết kế khớp quyết định; chữ Mua chung "mã giảm giá"; e2e Theo dõi chờ hydrate.

**Architecture:** Không thêm thành phần. Token ngữ nghĩa mới nằm ở `packages/design-tokens/src/tokens.css` (hai app cùng đọc); chữ Mua chung sửa ở ba file nguồn rồi bỏ ba dòng miễn của `terminology.spec.ts`; phần còn lại là sửa CSS/lớp của file cũ và e2e.

**Tech Stack:** React 18 (Mini: zmp-ui + Vite; web: Next 15 + Tailwind), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật; §5 sửa ở Task 7). Nguồn việc: các dòng `[G2]`, `[G3]` MINOR của review đợt 6a (`g6a-minors.txt`) và e2e chập chờn PR #113. Bàn giao: `plans/handoff-wave4b-4f.md` mục 5.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ giao diện tiếng Việt; "Mã giảm giá" luôn có chữ "giá" (`terminology.spec`, `FORBIDDEN_TERMS`).
- Màu hiện ra giữ nguyên: thanh tiến độ miễn phí giao vẫn là rãnh `--stone-200` và đầu fill `--forest-200`.
- Chỉ token ngữ nghĩa ở trang mua sắm, không trỏ bậc primitive (`--stone-*`, `--forest-*`); token mới phải định nghĩa ở file định nghĩa (`pnpm lint:vars`).
- Số px viết tay và lớp `max-md:` chỉ được giảm (`pnpm lint:parity`, `scripts/uiux/ds-baseline.json`); CSS thuần không bị đếm nên px của khung chạm đặt trong `mini.css`.
- Vùng chạm ≥44px, axe 0 vi phạm ở 375px. Không `waitForTimeout` để chờ hydrate.
- Không sửa file của G4 (Trang chủ), G5 (danh mục, ban-chay, category-row, product-card-view, campaign-body, `DESIGN.md` ngoài một dòng token), G6 (trình dựng, brand-body, shop-top-bar, shop-section, phone-ui, button Mini, `css/tokens.css` Mini).
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.

## Review Focus

1. Cột ô chọn giỏ web 24px nhưng vùng chạm phải còn 44px và bấm phần nhô ra vẫn đổi lựa chọn; từ md giữ bố cục cũ. Test: Task 1 (vitest lớp + e2e đo toạ độ ở 375 và 1280).
2. Đường kẻ dưới hàng thông tin: chỉ có giữa các hàng, không sau hàng cuối, cả khi chỉ có "Ưu đãi" (không có "Vận chuyển") và khi chỉ có "Vận chuyển". Test: Task 4.
3. Tên đọc của sao khi điểm là số nguyên (đánh giá của một khách: "5 trên 5 sao") và khi là trung bình ("4,4 trên 5 sao"). Test: Task 5.
4. Test thứ tự khối PDP không được skip lặng lẽ khi DB e2e chỉ có sản phẩm một phân loại. Test: Task 6.
5. Nút Theo dõi bấm đúng lúc trang vừa tải xong (trước hydrate) không được mất. Test: Task 9 (`--repeat-each=5`).

---

## File Structure

| Việc | File |
|---|---|
| Cột ô chọn giỏ web | `apps/web/src/app/gio-hang/page.tsx`, `apps/web/src/components/mini/mini.css`, `cart-mini.spec.tsx`, `apps/e2e/tests/cart-display.web.spec.ts` |
| Token thanh tiến độ | `packages/design-tokens/src/tokens.css` (+ `tokens.spec.ts`), Mini `pages/cart.tsx` (+ `cart.spec.tsx`), web `gio-hang/page.tsx` (+ `cart-mini.spec.tsx`), `DESIGN.md` (một dòng bảng token) |
| Độ đậm tên dòng Mini | `apps/e2e/tests/cart-display.miniapp.spec.ts` |
| Đường kẻ PDP web | `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx`, `page.tsx`, `pdp-extras.spec.tsx` |
| Tên đọc của sao | `apps/web/src/app/san-pham/[slug]/product-reviews.tsx`, `apps/miniapp/src/components/reviews-section.tsx` (+ hai spec) |
| Tách e2e PDP | `apps/e2e/tests/pdp-mobile.web.spec.ts` |
| Tài liệu §5 | `docs/2026-10-31-shop-redesign/01-thiet-ke.md` |
| Chữ Mua chung | `apps/miniapp/src/utils/group-buy-copy.ts`, `apps/web/src/lib/pdp-logic.ts`, `packages/app-core/src/group-buy-copy.ts`, `packages/app-core/src/terminology.spec.ts` (+ spec chứa chữ cũ) |
| e2e Theo dõi | `apps/e2e/tests/shop.web.spec.ts` |

---

### Task 1: Cột ô chọn giỏ web 24px + khoảng 12px (G2, PL-19)

**Files:**
- Modify: `apps/web/src/app/gio-hang/page.tsx` (nhãn bọc ô chọn của dòng giỏ; thêm `data-testid="cart-line-thumb"` cho `Link` ảnh)
- Modify: `apps/web/src/components/mini/mini.css` (lớp `.tubu-hit-flush`)
- Test: `apps/web/src/app/gio-hang/cart-mini.spec.tsx`, `apps/e2e/tests/cart-display.web.spec.ts`

**Interfaces:**
- Produces: lớp CSS `.tubu-hit-flush` (cùng tên và cùng ý với lớp của Mini `css/tokens.css`): dưới md khung chạm 44px chỉ chiếm 24px bề ngang bố cục (đệm hai bên 10px, lề âm 10px hai bên, `min-width: 44px`); từ md không có tác dụng.

- [ ] **Step 1: Test đỏ.**
  - vitest `cart-mini.spec.tsx`: nhãn bọc `input[aria-label^="Chọn "]` của dòng có lớp `tubu-hit-flush`; `Link` ảnh có `data-testid="cart-line-thumb"`.
  - e2e `cart-display.web.spec.ts`, describe mới `'Giỏ web: ô chọn cột 24 + khoảng 12 (G2, PL-19)'` ở 375px, cùng phép đo với ca Mini: chiều rộng ô vẽ = 24, `control.x - row.x` = 12, `thumb.x - (control.x + control.width)` = 12, nhãn `hit` rộng 44 và cao ≥ 44, bấm cách mép trái nhãn 3px đổi lựa chọn rồi bấm cách mép phải 3px đổi lại.
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/web exec vitest run src/app/gio-hang/cart-mini.spec.tsx` -> FAIL ở ca mới.
- [ ] **Step 3: Cài đặt.** Nhãn: thêm `tubu-hit-flush`, giữ `h-11 w-9 flex-none` (từ md y nguyên). `.tubu-hit-flush` trong `@media (max-width: 767.98px)`: `box-sizing: border-box; padding-inline: 10px; margin-inline: -10px; min-width: 44px`. Không thêm `max-md:` mới (bánh cóc).
- [ ] **Step 4: Chạy xanh** lệnh Step 2. e2e web chạy ở Task 10.
- [ ] **Step 5: Commit** `fix(web): ô chọn giỏ khổ điện thoại chiếm cột 24px + khoảng 12px như Mini (G2 MINOR, PL-19)`.

### Task 2: Token thanh tiến độ miễn phí giao dùng chung (G2)

**Files:**
- Modify: `packages/design-tokens/src/tokens.css`, `apps/miniapp/src/pages/cart.tsx`, `apps/web/src/app/gio-hang/page.tsx`, `DESIGN.md`
- Test: `packages/design-tokens/src/tokens.spec.ts`, `apps/miniapp/src/pages/cart.spec.tsx`, `apps/web/src/app/gio-hang/cart-mini.spec.tsx`

**Interfaces:**
- Produces: `--color-progress-fill-from: var(--forest-200)` (đầu dải màu của phần đã đầy; đích vẫn `--color-action-primary-bg`). Rãnh dùng `--color-track` đã có (`bg-track` của Tailwind preset), không thêm token rãnh thứ hai.

- [ ] **Step 1: Test đỏ.** `tokens.spec.ts`: thêm `['--color-progress-fill-from', 'var(--forest-200)']` vào bảng `it.each` của token commerce. Mini `cart.spec.tsx` (ca "chân dính gọn", chỗ đã kiểm `--color-track`): style của phần fill (con của `freeship-bar`) chứa `var(--color-progress-fill-from)` và không chứa `action-secondary-border`. Web `cart-mini.spec.tsx` (ca "chưa đủ freeship: ... thanh tiến độ"): `freeship-fill` có style chứa `var(--color-progress-fill-from)`, `freeship-bar` có lớp `bg-track` và không có `bg-stone-200`, outerHTML không khớp `/var\(--(?:stone|forest)-\d+\)/`.
- [ ] **Step 2: Chạy đỏ** ba spec (tokens, Mini cart, web cart-mini).
- [ ] **Step 3: Cài đặt.** Khai báo token cạnh `--color-track` kèm chú thích "đầu dải màu thanh tiến độ". Mini: gradient bắt đầu `var(--color-progress-fill-from)`. Web: `bg-stone-200` -> `bg-track`; gradient dùng token mới thay `var(--forest-200)`. `DESIGN.md` bảng Token: thêm `--color-progress-fill-from` vào dòng của `--color-track` (chỉ sửa dòng đó).
- [ ] **Step 4: Chạy xanh**; `pnpm lint:vars` xanh.
- [ ] **Step 5: Commit** `refactor(design-tokens): thanh tiến độ miễn phí giao hai app dùng chung --color-track + --color-progress-fill-from (G2 MINOR)`.

### Task 3: e2e đo độ đậm tên dòng giỏ ở Mini (G2)

**Files:**
- Test: `apps/e2e/tests/cart-display.miniapp.spec.ts`

- [ ] **Step 1:** thêm ca `'tên dòng đậm 500 như web'` (dòng đầu, 375px): nút tên `getByRole('button', { name: 'Sản phẩm thử 1' })` có `getComputedStyle(el).fontWeight` bằng `'500'`.
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3421 npx playwright test cart-display.miniapp.spec.ts` -> nếu `Text bold` của ZaUI không ra 500 thì đo thật, sửa giá trị bên web (mã web, không đổi Mini) cho hai app cùng số và ghi vào notes; ra 500 thì ca xanh ngay.
- [ ] **Step 3: Commit** `test(e2e): giỏ Mini kiểm tên dòng đậm 500, không chỉ đo web (G2 MINOR)`.

### Task 4: Hàng thông tin cuối của PDP web không vẽ đường kẻ dưới (G3)

**Files:**
- Modify: `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx` (`PdpShippingRow`, `PdpCoupons`), `apps/web/src/app/san-pham/[slug]/page.tsx`
- Test: `apps/web/src/app/san-pham/[slug]/pdp-extras.spec.tsx`

**Interfaces:**
- Produces: `PdpShippingRow` không có `boxShadow` (luôn là hàng cuối của khối thông tin). `PdpCoupons({ productId: string; divider?: boolean })`, mặc định `true`: `divider` quyết định đường kẻ dưới hàng "Ưu đãi"; trang cha truyền `divider={hasShippingRow}` với `hasShippingRow = Boolean(fulfillerText || !fromStore)` (đúng điều kiện đang dựng `PdpShippingRow`). Mini vẽ đường kẻ chỉ giữa các hàng (`i < infoRows.length - 1`): hai app cùng luật.

- [ ] **Step 1: Test đỏ.** `pdp-extras.spec.tsx`: `PdpShippingRow` dựng ra phần tử không có `box-shadow` inline; `PdpCoupons divider={false}` không có `box-shadow` và `divider` mặc định có `inset 0 -1px 0`. Ca trang (`page.spec.tsx` nếu đã dựng được cả hai) hoặc spec cấp trang cha: có "Vận chuyển" thì "Ưu đãi" có đường kẻ và "Vận chuyển" không; không có "Vận chuyển" thì "Ưu đãi" không có.
- [ ] **Step 2: Chạy đỏ** `pnpm --filter @tubutree/web exec vitest run "src/app/san-pham/\[slug\]/pdp-extras.spec.tsx"`.
- [ ] **Step 3: Cài đặt** như Interfaces.
- [ ] **Step 4: Chạy xanh**, cộng `page.spec.tsx` cùng thư mục.
- [ ] **Step 5: Commit** `fix(web): PDP bỏ đường kẻ dưới hàng thông tin cuối như Mini, không còn đường xám trên chip phân loại (G3 MINOR)`.

### Task 5: Tên đọc của sao theo vi-VN (G3)

**Files:**
- Modify: `apps/web/src/app/san-pham/[slug]/product-reviews.tsx` (`Stars`), `apps/miniapp/src/components/reviews-section.tsx` (`Stars`)
- Test: `apps/web/src/app/san-pham/[slug]/product-reviews.spec.tsx`, `apps/miniapp/src/components/reviews-section.spec.tsx`

**Interfaces:**
- Consumes: `formatRating(avg: number): string` (`@tubutree/app-core/commerce/card-meta`, 4.4 -> "4,4"), hàm `PdpRating` đang dùng. Không viết hàm mới. `PdpRating` (`pdp-sections.tsx`) đã đúng, không đổi.
- Produces: `aria-label` của `Stars`: số nguyên (đánh giá của một khách) giữ "5 trên 5 sao"; số lẻ (điểm trung bình) là `${formatRating(value)} trên 5 sao`, tức "4,4 trên 5 sao".

- [ ] **Step 1: Test đỏ.** Mỗi app một ca: `<Stars value={4.4} />` có tên truy cập "4,4 trên 5 sao" (không có "4.4"); `value={5}` vẫn "5 trên 5 sao". Sửa ca Mini cũ chờ '3.6 trên 5 sao' thành '3,6 trên 5 sao'.
- [ ] **Step 2: Chạy đỏ** hai spec (web `product-reviews.spec.tsx`, Mini `reviews-section.spec.tsx`).
- [ ] **Step 3: Cài đặt:** `Number.isInteger(value) ? String(value) : formatRating(value)` ở nhãn; import `formatRating` ở web (Mini đã import).
- [ ] **Step 4: Chạy xanh.**
- [ ] **Step 5: Commit** `fix(miniapp,web): tên đọc của Stars theo vi-VN "4,4 trên 5 sao" (G3 MINOR)`.

### Task 6: Tách e2e PDP: thứ tự khối chạy với firstProduct (G3)

**Files:**
- Modify: `apps/e2e/tests/pdp-mobile.web.spec.ts`

- [ ] **Step 1:** ca "thứ tự khối ở 375px" dùng `(await multiVariationProduct(request)) ?? (await firstProduct(request))`, `test.skip(!p, 'DB e2e chưa có sản phẩm nào')` (chỉ skip khi không có sản phẩm nào). Khối bắt buộc: `pdp-main`, `pdp-quantity`, `pdp-quick-reviews`, `pdp-reviews`; `pdp-variation-chips` bắt buộc và đứng ngay trước `pdp-quantity` khi sản phẩm có từ 2 phân loại. Khe 8px giữa các dải từ Số lượng trở xuống và không tràn ngang chạy với mọi sản phẩm; khe chip -> Số lượng chỉ kiểm khi có chip. Kho của mock: mọi phân loại còn hàng (stock 3).
- [ ] **Step 2:** ca mới `'chip phân loại hết hàng khoá, "Còn 3 sản phẩm" nằm trong khối thông tin chính'`: `multiVariationProduct`, `test.skip(!p, 'DB e2e không có sản phẩm nào từ 2 phân loại')`, phân loại đầu stock 0, còn lại 3; chuyển sang đây phần kiểm `pdp-low-stock` và chip khoá.
- [ ] **Step 3:** chạy ở Task 10 (web-gate); ca thứ tự khối báo "passed", ca chip "passed" khi seed có sản phẩm 2 phân loại.
- [ ] **Step 4: Commit** `test(e2e): PDP web 375 thứ tự khối không phụ thuộc sản phẩm 2 phân loại, chip hết hàng thành ca riêng (G3 MINOR)`.

### Task 7: Design doc §5 ghi đúng quyết định về chip phân loại (G3)

**Files:**
- Modify: `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§5, dòng Chi tiết SP)

- [ ] **Step 1:** thay "một dòng "Phân loại ›" mở sheet" bằng: giữ chip phân loại trên trang (hiện tên, giá Giờ vàng, hết hàng), bỏ dòng "Phân loại ›" (Thêm vào giỏ/Mua ngay vẫn mở bảng chọn từ 2 phân loại); kèm câu trỏ tới mục nhật ký quyết định ngày 2026-11-02 của `DESIGN.md` ("PDP: bỏ dòng "Phân loại ›", giữ chip").
- [ ] **Step 2:** `grep -n 'Phân loại ›' docs/2026-10-31-shop-redesign/01-thiet-ke.md` -> chỉ còn dòng ghi quyết định bỏ.
- [ ] **Step 3: Commit** `docs(shop-redesign): thiết kế §5 ghi giữ chip phân loại, bỏ dòng "Phân loại ›" (G3 MINOR)`.

### Task 8: Chữ Mua chung "mã giảm giá", bỏ ba dòng miễn (G3)

**Files:**
- Modify: `apps/miniapp/src/utils/group-buy-copy.ts` (hai chỗ), `apps/web/src/lib/pdp-logic.ts`, `packages/app-core/src/group-buy-copy.ts`, `packages/app-core/src/terminology.spec.ts`
- Test: `packages/app-core/src/group-buy-copy.spec.ts`, `apps/miniapp/src/utils/group-buy-copy.spec.ts`, `apps/web/src/lib/pdp-logic.spec.ts`, `apps/web/src/app/san-pham/[slug]/pdp-extras.spec.tsx`, `apps/web/src/app/mua-chung/group-buy-view.spec.tsx`, `apps/miniapp/src/pages/group-buy.spec.tsx`

- [ ] **Step 1: Test đỏ.** Sửa chữ kỳ vọng thành "mã giảm giá": `groupBuyPitch` ("Rủ đủ 3 người, mỗi người nhận mã giảm giá 15% khi nhóm đủ") ở Mini và web, `GROUP_BUY_MENU_HINT` ("Rủ bạn mua chung, đủ nhóm nhận mã giảm giá"), `groupRewardLine` ("Đủ nhóm: mỗi người nhận mã giảm giá 15% cho đơn từ ..."), và các ca trang Mua chung đang khớp chuỗi `groupRewardLine`. Bỏ ba dòng `EXEMPT` (`apps/miniapp/src/utils/group-buy-copy.ts`, `apps/web/src/lib/pdp-logic.ts`, `packages/app-core/src/group-buy-copy.ts`) khỏi `terminology.spec.ts`: spec thuật ngữ đỏ ngay vì ba file còn vi phạm.
- [ ] **Step 2: Chạy đỏ** `cd packages/app-core && npx vitest run src/terminology.spec.ts src/group-buy-copy.spec.ts`.
- [ ] **Step 3: Cài đặt** ba file nguồn ("mã giảm" -> "mã giảm giá" ở chuỗi hiển thị; comment giữ nguyên). `REASON.COUPON` vẫn còn bốn người dùng (`group-buy.tsx`, `group-buy-view.tsx`, `game-wheel.ts`, `home-copy.ts`), nên giữ; sửa câu giải thích cho đúng phần còn lại.
- [ ] **Step 4: Chạy xanh** app-core (terminology, group-buy-copy), Mini (`group-buy-copy.spec.ts`, `pages/group-buy.spec.tsx`), web (`pdp-logic.spec.ts`, `pdp-extras.spec.tsx`, `mua-chung/group-buy-view.spec.tsx`). Quét e2e: `grep -rn 'nhận mã giảm' apps/e2e/tests` không còn chữ cũ.
- [ ] **Step 5: Commit** `fix(copy): chữ Mua chung "mã giảm giá" ở app-core, Mini và web, bỏ ba dòng miễn REASON.COUPON (G3 MINOR)`.

### Task 9: e2e Theo dõi chờ hydrate trước khi bấm (PR #113)

**Files:**
- Modify: `apps/e2e/tests/shop.web.spec.ts` (ca 'đăng nhập: Theo dõi gửi POST rồi đổi thành Đang theo dõi; bấm lại gửi DELETE')

- [ ] **Step 1:** nút `Button` của `BrandActions` chỉ có `aria-pressed` khi đã hydrate và phiên đã `authenticated` (`aria-pressed={authed ? following : undefined}`): đó là tín hiệu chỉ client mới đặt. Đổi `getByRole('button', { name: 'Theo dõi' })` thành `getByRole('button', { name: 'Theo dõi', pressed: false })` trước lần bấm đầu, `{ name: 'Đang theo dõi', pressed: true }` trước lần bấm thứ hai; bỏ không dùng `waitForTimeout`.
- [ ] **Step 2:** chạy `--repeat-each=5` ca này qua web-gate (Task 10) -> 5/5 xanh.
- [ ] **Step 3: Commit** `test(e2e): Theo dõi thương hiệu chờ nút có aria-pressed (đã hydrate) trước khi bấm (CI #113)`.

### Task 10: Chụp so, gate, ghi nhận

- [ ] Ảnh "trước" đã chụp ở `docs/2026-10-31-shop-redesign/screens/H2/before/` (bằng spec chụp tạm `apps/e2e/tests/zz-h2-shots.{web,miniapp}.spec.ts`, không commit; xoá khi xong): `mini375-cart.png`, `web375-cart.png`, `mini375-pdp.png`, `web375-pdp.png`. Ảnh "sau" cùng tên ở `after/`. So: ảnh bắt đầu cùng x ở giỏ, thanh tiến độ cùng màu, không còn đường xám trên chip ở PDP web.
- [ ] `pnpm lint:parity` và `pnpm lint:vars`; nếu số px/`max-md:` giảm thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- [ ] e2e web: `E2E_API_PORT=3422 E2E_WEB_PORT=3423 E2E_MINIAPP_PORT=3424 bash apps/e2e/scripts/web-gate.sh tests/cart-display.web.spec.ts tests/web-checkout.web.spec.ts tests/pdp-mobile.web.spec.ts tests/shop.web.spec.ts tests/a11y-shop.web.spec.ts tests/ds-parity.shop.spec.ts`; riêng ca Theo dõi `--repeat-each=5 -g "Theo dõi gửi POST"`.
- [ ] Gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base fd851f2f9 --out .../gate-H2.txt`. Bước FAIL: so với base, đỏ cả ở base thì "có sẵn".
- [ ] e2e Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3421 npx playwright test --workers=2 --reporter=line`.

## Kết quả

(điền ở cuối)
