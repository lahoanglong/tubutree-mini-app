# I1 `minors-final` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa nốt bốn MINOR còn lại sau đợt 6 (`plans/handoff-wave6.md` §4): test cấp trang cho dây `divider` của PDP web, ca e2e "sản phẩm một phân loại" chắc chắn chạy trên CI, nhãn ô vòng quay "Mã giảm giá" đủ chữ "giá" (nếu đo thấy vừa), chip mã ở trang thương hiệu không mất mã khi phụ đề dài.

**Architecture:** Không thêm thành phần. Mục 1 và 2 chỉ thêm test (và một hàm hỗ trợ e2e). Mục 3 đổi hai chuỗi trong `packages/app-core/src/game-wheel.ts` nếu số đo cho phép, rồi bỏ dòng miễn trong `terminology.spec.ts`. Mục 4 sửa `VoucherTicket variant="chip"` ở hai app (cùng một logic, hai bản chép) để mã nằm hàng riêng dưới phụ đề đã cắt hai dòng; `brand-view` (Mini) và `brand-body` (web) không phải sửa vì chỉ truyền `voucher` + `variant`.

**Tech Stack:** React 18 (Mini: zmp-ui + Vite; web: Next 15 + Tailwind), vitest + jsdom, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q5 "Mã giảm giá" luôn có chữ "giá"). Nguồn việc: `plans/handoff-wave6.md` §4 (ba gạch đầu PDP, vòng quay, chip mã G1) và review H2/H3.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ giao diện tiếng Việt; "Mã giảm giá" luôn có chữ "giá" (`terminology.spec`, `FORBIDDEN_TERMS`).
- Chỉ token ngữ nghĩa ở trang mua sắm; không `max-md:` mới, không px viết tay mới ngoài số đã có (`pnpm lint:parity`, `scripts/uiux/ds-baseline.json`); hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline. `pnpm lint:vars` xanh.
- Chữ ô vòng quay không nhỏ hơn cỡ đang dùng (Mini 12px, web `text-caption`); nhãn được xuống 2 dòng trong ô, không tràn khỏi vòng.
- Web khổ điện thoại giống Mini App cả giao diện: `VoucherTicket` hai app sửa y hệt nhau.
- Không sửa file của phiên song song (`sheet.tsx`, `flash-sale.tsx` hai app, `home-layout.ts`, `affiliate.tsx`, `ctv/page.tsx`, `dob-input.ts`, `edit-profile.tsx`, `tai-khoan/ho-so`, admin `page.tsx`, community-moderation).
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt, theo mật độ file xung quanh.
- Máy thiếu RAM: chỉ chạy test theo file khi đang làm; gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Khách đã đăng nhập có đúng một hàng "Ưu đãi ›" (gian hàng tạm nghỉ, không có hàng Vận chuyển): hàng cuối không được kẻ đường dưới. Test: Task 1 ca `divider` vắng hàng Vận chuyển.
2. Sản phẩm một phân loại trên PDP web 375px: không vẽ chip phân loại, Số lượng vẫn là dải riêng đúng thứ tự khối. Trên CI thiếu sản phẩm một phân loại thì đỏ chứ không skip. Test: Task 2.
3. Nhãn vòng quay xuống 2 dòng không tràn ra ngoài ô/vòng ở 375px. Test: Task 3 (số đo e2e Mini).
4. Phụ đề chip dài hơn 2 dòng, mã 15 ký tự: mã vẫn thấy nguyên vẹn, không bị "…", không ra ngoài khung chip. Test: Task 4 (vitest hai app + brand page, e2e Mini đo hộp).
5. Chip không có mã (khuyến mãi thương hiệu không gắn mã) không vẽ hàng mã rỗng. Test: Task 4.

---

## File Structure

| Việc | File |
|---|---|
| Test cấp trang `divider` PDP | `apps/web/src/app/san-pham/[slug]/page.spec.tsx` |
| Ca e2e một phân loại | `apps/e2e/tests/support/pdp-product.ts` (+ `singleVariationProduct`, `assertProductOnCi`), `apps/e2e/tests/pdp-mobile.web.spec.ts` |
| Nhãn vòng quay | `packages/app-core/src/game-wheel.ts`, `game-wheel.spec.ts`, `terminology.spec.ts`, `apps/miniapp/src/components/wheel.spec.tsx`, `apps/e2e/tests/wheel-labels.miniapp.spec.ts` (mới) |
| Chip mã thương hiệu | `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (+ hai spec), `apps/miniapp/src/pages/brand-view.spec.tsx`, `apps/web/src/components/shop-page/brand-body.spec.tsx` |

---

### Task 1: Test cấp trang cho `divider` của PdpCoupons (PDP web)

**Files:**
- Test: `apps/web/src/app/san-pham/[slug]/page.spec.tsx`
- Không sửa `page.tsx`.

**Interfaces:**
- Consumes: `PdpCoupons({ productId, divider })` (`pdp-extras.tsx`), dây `divider={Boolean(fulfillerText || !fromStore)}` ở `page.tsx:155`. `fulfillerText = pdpFulfillerText(product)` (null khi `fulfiller.kind === 'UNAVAILABLE'`), `fromStore = kind === 'MERCHANT' || 'UNAVAILABLE'`.
- Produces: không (chỉ test).

- [ ] **Step 1: Mock của spec thành biến được.** `useAuth` trả `api.auth` (mặc định khách: `{ status: 'idle', initialized: true, sessionUnavailable: false }`); `coreHttp.get` trả `api.coupons` cho `/me/coupons` và vẫn ném `offline` cho đường khác; `fetchCanReview` trả `{ canReview: false }`-dạng hợp lệ khi `api.auth.status === 'authenticated'`, vẫn ném khi khách. `beforeEach` đặt lại hai biến.
- [ ] **Step 2: Viết ba ca trong `describe('PDP: đường kẻ dưới hàng Ưu đãi (divider) ở cấp trang')`:**
  - `chỉ có "Ưu đãi" (gian hàng tạm nghỉ, không hàng Vận chuyển): hàng Ưu đãi không có đường kẻ dưới` — `fulfiller: { kind: 'UNAVAILABLE', reason: 'STORE_PAUSED', name: 'Gốm Minh An', shippingFee: null, freeShipFrom: null }`; khẳng định `pdp-offers` có hàng "Ưu đãi", không có hàng "Vận chuyển", `style.boxShadow` của hàng Ưu đãi không chứa `inset 0 -1px 0`.
  - `Tubu giao hàng: có cả Ưu đãi và Vận chuyển, hàng Ưu đãi có đường kẻ, hàng Vận chuyển không` — `fulfiller: { kind: 'TUBU' }, fulfilment: 'TUBU'`.
  - `gian hàng đối tác giao (MERCHANT): có Vận chuyển nên Ưu đãi có đường kẻ` — `fulfiller: { kind: 'MERCHANT', name: 'Gốm Minh An', shippingFee: 30000, freeShipFrom: null }`.
  Mỗi ca dùng `api.auth` đã đăng nhập, `api.coupons = [{ code: 'ALL', type: 'AMOUNT', value: 20000, minOrder: null, maxDiscount: null, endAt: '2026-12-01' }]`, chờ `flush()` để truy vấn mã về.
- [ ] **Step 3: Chạy.** `pnpm --filter @tubutree/web exec vitest run "src/app/san-pham/[slug]/page.spec.tsx"` -> ba ca mới PASS cùng các ca cũ.
- [ ] **Step 4: Thử đột biến (ghi vào notes).** (a) xoá `divider={...}` khỏi `page.tsx:155` -> ca "chỉ có Ưu đãi" phải ĐỎ; (b) đảo thành `divider={!(fulfillerText || !fromStore)}` -> ca 1 hoặc 2 phải ĐỎ; khôi phục `page.tsx` bằng `git checkout -- <file>` rồi chạy lại xanh.
- [ ] **Step 5: Commit** `test(web): PDP cấp trang kiểm dây divider của hàng Ưu đãi (đường kẻ chỉ khi còn hàng Vận chuyển)`.

### Task 2: Ca e2e "sản phẩm một phân loại" chắc chắn chạy

**Files:**
- Modify: `apps/e2e/tests/support/pdp-product.ts`, `apps/e2e/tests/pdp-mobile.web.spec.ts`

**Interfaces:**
- Produces: `singleVariationProduct(request: APIRequestContext, scan?: number): Promise<PdpProduct | null>` (sản phẩm đầu tiên theo danh sách có đúng 1 phân loại); `assertProductOnCi(p: PdpProduct | null, what: string, env?: NodeJS.ProcessEnv): void` (ném lỗi khi `GITHUB_ACTIONS === 'true'` mà `p` null; ngoài CI để spec `test.skip` có lý do).

- [ ] **Step 1: Tách thân ca "thứ tự khối" thành hàm** `assertPdpBlockOrder(page: Page, hasChips: boolean): Promise<void>` trong spec (nguyên văn phần đo, không đổi số đo); ca cũ gọi hàm này với sản phẩm từ 2 phân loại (`multiVariationProduct`, bỏ `?? firstProduct`), ca mới gọi với sản phẩm một phân loại.
- [ ] **Step 2: Viết ca mới** `sản phẩm một phân loại ở 375px: không có chip phân loại, Số lượng vẫn là dải riêng, thứ tự khối như Mini App` — `p = await singleVariationProduct(request)`; `assertProductOnCi(p, ...)` rồi `test.skip(!p, lý do)`; `openPdp375(page, api, p, () => 3)`; thêm `await expect(page.locator('[data-section="pdp-variation-chips"]')).toHaveCount(0)` và `pdp-quantity` hiện.
- [ ] **Step 3: Đổi ca cũ dùng `multiVariationProduct`** cùng `assertProductOnCi` (hai ca đa phân loại không skip lặng lẽ trên CI). Thêm ca `plain` kiểm `assertProductOnCi`: CI + null -> ném; CI + có -> không; ngoài CI + null -> không (theo mẫu `a11y-shop.web.spec.ts:198`).
- [ ] **Step 4: Chạy** (cuối, trong gate web một lần): `E2E_API_PORT=3442 E2E_WEB_PORT=3443 E2E_MINIAPP_PORT=3444 bash apps/e2e/scripts/web-gate.sh tests/pdp-mobile.web.spec.ts ...` -> ca mới không skipped. Đột biến: cho `singleVariationProduct` trả `null` -> ca mới ĐỎ khi `GITHUB_ACTIONS=true`.
- [ ] **Step 5: Commit** `test(e2e): PDP web có ca sản phẩm một phân loại chạy chắc trên CI (không skip lặng lẽ)`.

### Task 3: Nhãn ô vòng quay "Mã giảm giá"

**Files:**
- Modify: `packages/app-core/src/game-wheel.ts` (dòng 15, 19), `packages/app-core/src/game-wheel.spec.ts`, `packages/app-core/src/terminology.spec.ts` (dòng EXEMPT `game-wheel.ts`, khoá `REASON.COUPON`, khoá `USE.coupon` nếu không còn ai dùng)
- Create: `apps/e2e/tests/wheel-labels.miniapp.spec.ts`
- Test: `apps/miniapp/src/components/wheel.spec.tsx`

**Interfaces:**
- Consumes: `WHEEL_SLOTS: readonly WheelSlot[]` (`{ kind, emoji, label }`).
- Produces: nhãn ô COUPON = `'Mã giảm giá'` (cả hai ô).

- [ ] **Step 1: Đo trước (ảnh `screens/I1/wheel-*-before.png`).** Vẽ ô vòng quay Mini (Vite 3441) và web (Next 3442) ở 375px bằng `visual-g2.game.*.spec.ts` (`GAME_SHOTS_DIR`) với nhãn cũ; ghi bề rộng chữ thật của "Chúc may mắn" (nhãn dài sẵn có) và hộp nhãn 72px.
- [ ] **Step 2: Test đỏ.** `game-wheel.spec.ts`: `it('nhãn ô COUPON là "Mã giảm giá" (D2), không có nhãn nào ngắn hơn D2 cho phép')` khẳng định mọi ô `kind === 'COUPON'` có `label === 'Mã giảm giá'`; `terminology.spec` vẫn xanh (đang miễn). Test e2e `wheel-labels.miniapp.spec.ts` (chạy bằng mock `/game`): với mỗi nhãn của vòng quay ở 375px, hộp chữ nằm trọn trong vòng (cách tâm ≤ bán kính trong 114px) và chữ ≤ 2 dòng; cỡ chữ không nhỏ hơn 12px.
- [ ] **Step 3: Quyết định theo số đo.** Nếu "Mã giảm giá" vừa (≤ 2 dòng, trong ô, chữ không thu nhỏ) ở cả Mini và web 375px: đổi hai chuỗi trong `game-wheel.ts`, bỏ dòng EXEMPT và `REASON.COUPON` (và `USE.coupon` nếu thừa) ở `terminology.spec.ts`, sửa test đơn vị khớp chữ cũ. Nếu không vừa: giữ nguyên, ghi số đo vào notes, ghi lại lý do ở `REASON.COUPON`, đóng task bằng commit tài liệu.
- [ ] **Step 4: Chạy** `pnpm --filter @tubutree/app-core exec vitest run src/game-wheel.spec.ts src/terminology.spec.ts`, `pnpm --filter @tubutree/miniapp exec vitest run src/components/wheel.spec.tsx`, e2e Mini `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3441 npx playwright test tests/wheel-labels.miniapp.spec.ts` -> PASS. Ảnh sau `wheel-*-after.png`.
- [ ] **Step 5: Commit** `fix(app-core): nhãn ô vòng quay "Mã giảm giá" đủ chữ "giá" (D2), bỏ dòng miễn terminology` (hoặc `docs` nếu giữ).

### Task 4: Chip mã ở trang thương hiệu không mất mã khi phụ đề dài

**Files:**
- Modify: `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (hai bản y hệt)
- Test: `apps/miniapp/src/components/ui/voucher-ticket.spec.tsx`, `apps/web/src/components/mini/voucher-ticket.spec.tsx`, `apps/miniapp/src/pages/brand-view.spec.tsx`, `apps/web/src/components/shop-page/brand-body.spec.tsx`, `apps/e2e/tests/voucher-chip-code.miniapp.spec.ts` (mới)

**Interfaces:**
- Consumes: `VoucherView.code: string` (`''` khi khuyến mãi không gắn mã, `promotionVoucher` ở `app-core/commerce/shop-page.ts`).
- Produces: `VoucherTicket variant="chip"` vẽ thêm `data-testid="voucher-code"` (nowrap, không bao giờ cắt) ở hàng riêng NGAY SAU `voucher-meta`, chỉ khi `v.code` khác rỗng; `voucher-meta` của chip vẫn cắt 2 dòng (`-webkit-line-clamp: 2`).

- [ ] **Step 1: Test đỏ (vitest, cả hai app).**
  - sửa ca `chip chỉ có tiêu đề và điều kiện: không mã...` thành `chip: có mã thì mã ở hàng riêng sau điều kiện; không mã thì không vẽ hàng mã`: `view()` (code `FUWA3E`) -> `voucher-code` có chữ `FUWA3E`, là anh em đứng SAU `voucher-meta`, không nằm trong `voucher-meta`; `view({ code: '' })` -> không có `voucher-code`.
  - ca mới `chip: phụ đề dài hơn 2 dòng vẫn thấy mã nguyên vẹn` — `condition` ~160 ký tự kết bằng "với mã NHANLOCXANH2026", `code: 'NHANLOCXANH2026'`: `voucher-meta` giữ `WebkitLineClamp = '2'` và `overflow: hidden`; `voucher-code` có `whiteSpace: 'nowrap'`, `textContent === 'NHANLOCXANH2026'` và không nằm trong phần tử bị `overflow: hidden`/line-clamp.
  - `brand-view.spec.tsx` (Mini) và `brand-body.spec.tsx` (web): khuyến mãi có `subtitle` rất dài và `couponCode` -> trang có `brand-vouchers` chứa `voucher-code` đúng mã; khuyến mãi không mã -> không có `voucher-code`.
- [ ] **Step 2: Chạy đỏ** bốn file spec (hai VoucherTicket, brand-view, brand-body).
- [ ] **Step 3: Cài đặt** trong cả hai `VoucherTicket`: `codeNode` cho chip dựng ở hàng riêng `display:block` sau `metaNode` (caption, màu tertiary, nowrap, `maxWidth: 100%`), thay điều kiện `showCode = variant !== 'chip' && Boolean(v.code)` bằng `Boolean(v.code)` nhưng chỉ đưa mã vào dòng meta/foot với ticket/row như cũ; chip không đưa mã vào `metaParts`. Cập nhật chú thích đầu hàm (chip có mã ở hàng riêng, phụ đề cắt 2 dòng).
- [ ] **Step 4: Chạy xanh** bốn spec. e2e Mini `voucher-chip-code.miniapp.spec.ts` (mock `/brand/public/:slug` có hai khuyến mãi: phụ đề dài + mã 15 ký tự; một không mã) ở 375px: hộp `voucher-code` nằm trọn trong hộp chip, không bị cắt (`scrollWidth <= clientWidth`), chip không tràn ngang trang. Ảnh `screens/I1/brand-chip-{mini,web}375-{before,after}.png`.
- [ ] **Step 5: Commit** `fix(ui): chip mã ở trang thương hiệu giữ mã ở hàng riêng khi phụ đề dài hơn 2 dòng (hai app)`.

### Task 5: Gate, ảnh 375px, bàn giao

- [ ] **Step 1:** `pnpm lint:parity`, `pnpm lint:vars`; hạ được số px/`max-md:` thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline.
- [ ] **Step 2:** Ảnh 375px Mini và web (vòng quay, chip thương hiệu) vào `docs/2026-10-31-shop-redesign/screens/I1/`; tắt máy chủ của mình.
- [ ] **Step 3:** `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 4364ec325 --out ../gate-I1.txt`; sau đó e2e Mini đầy đủ `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3441 npx playwright test --workers=2 --reporter=line`; web-gate một lần cho `pdp-mobile`, `shop`, `a11y-shop`, `ds-parity.shop`. Bước FAIL: so với base, ghi "có sẵn" hoặc sửa.
- [ ] **Step 4:** Ghi bản ghi vào `PROGRESS.md` (một dòng I1) và commit `docs(shop): I1 minors-final (đợt 7a)`.
