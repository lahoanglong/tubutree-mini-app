# K6 `ctv-tier` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa phần CTV bậc 2 theo `review/extra-critique-2.md` P2 #13, #14, #15: huy hiệu bậc ghi "CTV {tên bậc}" và đọc được; trình dựng gian hàng có phần đầu xem trước như khách thấy (có huy hiệu bậc), ô thống kê một dòng, tiêu đề khối Inter 16/700, khối Mini và web cao bằng nhau; khối "Thưởng mốc doanh số tháng" của web theo thang chữ Mini; đo trang CTV web 375 so Mini và sửa phần chênh nếu chỉ là khoảng cách/cỡ chữ.

**Architecture:** Chữ và quy tắc dùng chung ở `packages/app-core` (`shop-copy.ts` khoá `shop.tierBadge`, `commerce/shop-page.ts` hàm `ownerTierPreview`, `commerce/storefront-builder.ts` nhãn ô thống kê). Hai app chỉ vẽ: `TierBadge` đọc khoá chữ; `ShopHeader` thêm prop `titleAs` để dựng làm đầu xem trước trong trình dựng; trình dựng lấy bậc của chủ shop từ `GET /affiliate/tiers` (đã có, không đổi API) rồi quy về dạng `ownerTier` của trang công khai nên xem trước = khách thấy. Số đo Mini ↔ web cố định bằng bảng chuẩn của `ds-parity.shop.spec.ts`.

**Tech Stack:** React 18 (Mini: zmp-ui + Vite; web: Next 15 + Tailwind), vitest + jsdom, Playwright (mock `api` fixture).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q1 tiêu đề khối Inter 16/700, Q9 ẩn bậc thấp nhất trên trang công khai, hiện từ bậc 2). Nguồn việc: `review/extra-critique-2.md` P2 #13–#15; bàn giao `plans/handoff-wave6.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`) trước gate.
- Web khổ điện thoại giống Mini App cả giao diện: mọi thay đổi giao diện sửa cả hai app, cùng chữ, cùng số đo ở 375px.
- Chữ lấy từ `shop-copy.ts` / `BUILDER_COPY`, không viết thẳng; không thuật ngữ cấm (`FORBIDDEN_TERMS`). Tiêu đề khối Inter 16/700 -0.01em (biến thể `Heading font="ui"` của Mini; web dùng lớp mới `ui.blockTitle`), Fraunces chỉ tiêu đề trang.
- Chỉ token ngữ nghĩa; không hex, không `var(--stone-…)` mới, không `max-md:` mới, không px viết tay mới (`pnpm lint:parity`); hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline. `pnpm lint:vars` xanh.
- Vùng chạm ≥44px, tương phản ≥4,5:1, axe 0 vi phạm ở 375px màn đụng tới.
- Trang công khai `/s/:slug` chỉ hiện bậc từ bậc 2 (`ownerTier.publicBadge`); màn dựng cũng chỉ vẽ huy hiệu khi `publicBadge` (đúng cái khách thấy).
- Không sửa file của gói khác: K1 (`variation-sheet`, `add-to-cart`, `variation-picker`, `flash-line`, `pdp-bundles`), K2 (`thanh-toan/page.tsx`, `checkout.tsx`), K3 (`voucher-sheet`, `coupon-box`, `coupon-view`, `voucher.ts`, `voucher-ticket`, `pdp-extras`, `pdp-offers-sheet`), K4 (chữ API, `terminology.spec`, `shop-copy` khoá `addon.title`, `pickerStockText`), K5 (giỏ, `cart.service`), K7 (`mini.css` `.mini-sheet-*`, hai `bottom-sheet.tsx`, `ui/sheet.tsx`) và phiên 9b (`flash-sale.tsx` hai app, `flash-boot-script.ts`, `home-layout.ts`, `home-initial.ts`, `apps/web/src/app/page.tsx`). `shop-copy.ts` K4 cũng sửa: chỉ THÊM dòng `shop.tierBadge` ở nhóm "Trang shop", không đụng dòng khác (gộp tay khi merge).
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao" không hiển nhiên, tiếng Việt, theo mật độ file xung quanh.
- Máy thiếu RAM: chạy test theo file khi làm; gate đầy đủ đúng một lần ở cuối; e2e `--workers=2`.

## Review Focus

1. Gian hàng bậc 1 (Tân binh, `publicBadge=false`) không vẽ huy hiệu, cả ở trang khách và xem trước trong trình dựng. Test: Task 1 `ownerTierPreview` + Task 4 ca "Tân binh".
2. Tải bậc lỗi (401/404/mạng) hoặc chậm: trình dựng vẫn vẽ đủ đầu xem trước không huy hiệu, không màn lỗi, không nhảy trang khi bậc về muộn (huy hiệu nằm trong hàng huy hiệu đã có chỗ). Test: Task 4 ca "tải bậc lỗi".
3. Tên bậc dài ("Kim Cương") và tên shop dài trong xem trước: không tràn ngang 375px, huy hiệu một dòng. Test: Task 4 e2e Mini ca tên dài + `scrollWidth`.
4. Trình đọc màn hình: huy hiệu đọc "CTV Đồng" (emoji `aria-hidden`), tiêu đề xem trước không thêm một `h1` thứ hai. Test: Task 2 `readableText`, Task 3 `titleAs`.
5. Ô thống kê ở 320px (nhãn xuống dòng) Mini và web vẫn cao bằng nhau (cùng cỡ chữ). Test: Task 5 `ds-parity` + đo tay 320px ghi notes.

---

## File Structure

| Việc | File |
|---|---|
| Chữ + quy tắc dùng chung | `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`, `shop-copy.spec.ts`; `commerce/shop-page.ts` + `shop-page.spec.ts`; `commerce/storefront-builder.ts` + `storefront-builder.spec.ts` |
| Huy hiệu bậc | `apps/miniapp/src/components/ui/tier-badge.tsx` (+ `tier-badge.spec.tsx` mới), `apps/web/src/components/mini/tier-badge.tsx` (+ `surfaces.spec.tsx`), `apps/miniapp/src/pages/affiliate.tsx:562`, `apps/web/src/components/affiliate/tier-card.tsx:24` |
| Đầu xem trước | `apps/miniapp/src/components/ui/shop-header.tsx`, `apps/web/src/components/mini/shop-header.tsx` (+ spec hai bên), `apps/miniapp/src/pages/storefront-builder.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx` (+ spec hai bên) |
| Thống kê, tiêu đề khối | `apps/miniapp/src/components/storefront-builder/stats-panel.tsx`, `apps/web/src/components/affiliate/storefront-panels.tsx`, `apps/web/src/lib/guest-ui.ts` (`ui.blockTitle`) |
| Thưởng mốc | `apps/web/src/components/affiliate/milestone-rewards.tsx`, `apps/miniapp/src/components/affiliate/milestone-rewards.tsx` (chỉ gắn `data-testid`) |
| Trang CTV | `apps/web/src/app/ctv/page.tsx`, `apps/miniapp/src/pages/affiliate.tsx`, `apps/web/src/components/affiliate/tier-card.tsx` (chỉ nếu số đo cho thấy lệch đơn giản) |
| e2e | `apps/e2e/tests/ds-parity.shop.spec.ts`, `apps/e2e/tests/support/ds-parity.ts`, `support/builder-mocks.ts`, `support/builder-web-mocks.ts`, `shop-page.miniapp.spec.ts`, `storefront-builder.miniapp.spec.ts`, spec nào gọi thêm `/affiliate/tiers` |

---

### Task 1: Chữ và quy tắc bậc ở app-core

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts` (nhóm "Trang shop"), `shop-copy-budget.ts`, `commerce/shop-page.ts`, `commerce/storefront-builder.ts`
- Test: `packages/app-core/src/shop-copy.spec.ts`, `commerce/shop-page.spec.ts`, `commerce/storefront-builder.spec.ts`

**Interfaces:**
- Produces: `SHOP_COPY['shop.tierBadge'] = 'CTV {name}'` (ngân sách `null`: tên bậc là chữ tự do); `ownerTierPreview(r: { tier: { name: string; emoji: string }; allTiers: readonly { name: string; emoji: string }[] } | null | undefined): { name: string; emoji: string; publicBadge: boolean } | null` ở `commerce/shop-page.ts` (khớp `CtvTiersResponse` của `api/affiliate.ts`); `BUILDER_COPY.statsOrders = 'Đơn hàng'`, `statsRevenue = 'Doanh thu'`, `statsCommission = 'Hoa hồng'`.
- Consumes: `publicTier` có sẵn ở `shop-page.ts:116`.

- [ ] **Step 1: Viết test đỏ.**
  - `shop-copy.spec.ts`: `it('huy hiệu bậc CTV ghi "CTV {tên bậc}"')`: `fillCopy('shop.tierBadge', { name: 'Đồng' }) === 'CTV Đồng'`, `fillCopy('shop.tierBadge', { name: 'Kim Cương' }) === 'CTV Kim Cương'`.
  - `shop-page.spec.ts` trong `describe('ownerTierPreview')`: bậc đầu của `allTiers` (`Tân binh`) → `publicBadge: false`; `Đồng` → `{ name: 'Đồng', emoji: '🌿', publicBadge: true }`; `null`/`undefined` → `null`; `allTiers: []` → `publicBadge: false` (không biết bậc thấp nhất thì không khoe); ghép `publicTier(ownerTierPreview(đồng))` → `{ name: 'Đồng', emoji: '🌿' }` và `publicTier(ownerTierPreview(tânBinh))` → `null`.
  - `storefront-builder.spec.ts`: ba nhãn thống kê đúng chữ trên và mỗi nhãn ≤ 9 ký tự (vừa ô ~78px ở 375px, một dòng).
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/app-core exec vitest run src/shop-copy.spec.ts src/commerce/shop-page.spec.ts src/commerce/storefront-builder.spec.ts` → FAIL (khoá/hàm chưa có).
- [ ] **Step 3: Cài đặt** đúng chữ ký ở Interfaces. `shop.tierBadge` thêm cuối nhóm "Trang shop", `SHOP_COPY_MAX['shop.tierBadge'] = null`. `ownerTierPreview`: `publicBadge = allTiers.length > 0 && tier.name !== allTiers[0].name` (bậc thấp nhất là phần tử đầu của `allTiers`, cùng luật `getPublicTier` ở API `tier.name !== CTV_TIERS[0].name`).
- [ ] **Step 4: Chạy xanh** cùng lệnh + `pnpm --filter @tubutree/app-core exec vitest run src/terminology.spec.ts src/shop-copy.spec.ts`.
- [ ] **Step 5: Commit** `feat(app-core): chữ "CTV {bậc}", ownerTierPreview và nhãn ô thống kê trình dựng (K6)`.

### Task 2: Huy hiệu bậc ghi "CTV {tên bậc}" (P2 #13)

**Files:**
- Modify: `apps/miniapp/src/components/ui/tier-badge.tsx`, `apps/web/src/components/mini/tier-badge.tsx`, `apps/miniapp/src/pages/affiliate.tsx` (dòng `CTV {d.tier.name}`), `apps/web/src/components/affiliate/tier-card.tsx` (dòng `CTV {tier.name}`)
- Test: `apps/miniapp/src/components/ui/tier-badge.spec.tsx` (mới), `apps/web/src/components/mini/surfaces.spec.tsx`, `apps/miniapp/src/pages/storefront-view.spec.tsx:352-360`, `apps/web/src/app/s/storefront-page.spec.tsx`, `apps/e2e/tests/shop-page.miniapp.spec.ts`

**Interfaces:**
- Consumes: `fillCopy('shop.tierBadge', { name })` (Task 1).
- Produces: `TierBadge({ name, emoji })` hai app: chữ hiện ra `CTV {name}`, emoji `aria-hidden`; props không đổi.

- [ ] **Step 1: Viết test đỏ.**
  - Mini `tier-badge.spec.tsx`: `it('chữ đọc được là "CTV Đồng": emoji aria-hidden, chữ còn lại có "CTV"')` với hàm `readableText(el)` (nhân bản cây, bỏ nút `[aria-hidden]`, `textContent.trim()`): `readableText(container) === 'CTV Đồng'`; `container.querySelector('[aria-hidden]')!.textContent === '🌿'`; tên bậc "Kim Cương" ra `'CTV Kim Cương'`.
  - Web `surfaces.spec.tsx` ca `TierBadge`: `c.textContent === '🥇CTV Vàng'` và cùng ca `readableText`.
  - `storefront-view.spec.tsx` (Mini) và `s/storefront-page.spec.tsx` (web): ca `publicBadge: true` mong `CTV Bạc` thay `Bạc`; ca `publicBadge: false` vẫn không có huy hiệu.
  - e2e Mini `shop-page.miniapp.spec.ts`: ca mới `gian hàng bậc 2: huy hiệu "CTV Đồng" ở đầu shop, cây trợ năng đọc "CTV Đồng"`: `api.get('/storefront/public/:slug', { ...SHOP_STOREFRONT, ownerTier: { name: 'Đồng', emoji: '🌿', publicBadge: true } })`, `expect(page.getByText('CTV Đồng')).toBeVisible()` và `expect(page.getByText('CTV Đồng')).toHaveCount(1)`.
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/tier-badge.spec.tsx src/pages/storefront-view.spec.tsx`; `pnpm --filter @tubutree/web exec vitest run src/components/mini/surfaces.spec.tsx src/app/s/storefront-page.spec.tsx`.
- [ ] **Step 3: Cài đặt** `TierBadge` hai app (bản web giữ dòng "Nguồn:" như cũ) dùng `fillCopy('shop.tierBadge', { name })`. Đổi hai chỗ ghi "CTV {tên bậc}" ở trang CTV sang cùng khoá để một chữ, một nguồn. Cập nhật câu chú thích đầu hàm nếu còn nói "chỉ name+emoji hiển thị tên bậc".
- [ ] **Step 4: Chạy xanh** các lệnh Step 2 + `pnpm --filter @tubutree/web exec vitest run src/components/affiliate/tier-card.spec.tsx` + `pnpm --filter @tubutree/miniapp exec vitest run src/pages/affiliate.spec.tsx`; e2e Mini `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3511 npx playwright test tests/shop-page.miniapp.spec.ts --workers=2 --reporter=line` → PASS.
- [ ] **Step 5: Commit** `fix(ui): huy hiệu bậc CTV ghi "CTV {tên bậc}", chữ từ shop-copy (hai app)`.

### Task 3: `ShopHeader` nhận `titleAs`

**Files:**
- Modify: `apps/miniapp/src/components/ui/shop-header.tsx`, `apps/web/src/components/mini/shop-header.tsx`
- Test: `apps/miniapp/src/components/ui/shop-header.spec.tsx`, `apps/web/src/components/mini/shop-header.spec.tsx`

**Interfaces:**
- Produces: `ShopHeaderProps.titleAs?: ElementType` (mặc định `'h1'`, giữ nguyên chỗ gọi hiện có). Màn dựng truyền `'h2'` để trang không có hai `h1`.

- [ ] **Step 1: Test đỏ** (cả hai spec): `it('titleAs đổi thẻ tiêu đề, mặc định h1')`: không truyền → `getByRole('heading', { level: 1, name: 'Gian hàng Lan' })`; `titleAs="h2"` → `level: 2` và `queryByRole('heading', { level: 1 })` null.
- [ ] **Step 2: Chạy đỏ** `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/shop-header.spec.tsx`, `pnpm --filter @tubutree/web exec vitest run src/components/mini/shop-header.spec.tsx`.
- [ ] **Step 3: Cài đặt** thêm prop vào hai bản (cập nhật chú thích prop `title` "h1 (Fraunces)" cho đúng: h1 mặc định).
- [ ] **Step 4: Chạy xanh** hai lệnh trên.
- [ ] **Step 5: Commit** `feat(ui): ShopHeader nhận titleAs (đầu xem trước trong trình dựng không thêm h1)`.

### Task 4: Trình dựng có đầu xem trước như khách thấy (P2 #14, phần 1)

**Files:**
- Modify: `apps/miniapp/src/pages/storefront-builder.tsx` (khối thẻ hồ sơ ở nhánh danh sách khối, hiện dòng ~620-668), `apps/web/src/components/affiliate/storefront-builder.tsx` (thẻ hồ sơ ~dòng 490-540)
- Test: `apps/miniapp/src/pages/storefront-builder.spec.tsx` (+ mock `../services/affiliate-api`), `apps/web/src/app/ctv/gian-hang/page.spec.tsx` (ca `profile-cover` dòng 1228-1242 đổi sang `shop-cover`), `apps/e2e/tests/storefront-builder.miniapp.spec.ts`, `support/builder-mocks.ts`, `support/builder-web-mocks.ts`, spec e2e nào dựng trình dựng mà chưa mock `/affiliate/tiers` (tìm bằng `grep -rn "storefront/me'" apps/e2e/tests`)

**Interfaces:**
- Consumes: `ownerTierPreview`, `publicTier` (app-core `commerce/shop-page`), `TierBadge`, `ShopHeader` (`titleAs`), Mini `getCtvTiers` (`services/affiliate-api`), web `affiliateCtvTiersQuery(coreHttp)`.
- Produces: đầu thẻ hồ sơ của trình dựng = `ShopHeader` (bìa, avatar, tên `h2`, huy hiệu bậc nếu `publicBadge`, ghi chú `headerNote`) như trang khách, bên dưới là phần của chủ shop: nhãn trạng thái + địa chỉ, "Thêm ảnh bìa" (khi chưa có bìa), ghi chú làm mới, lý do ẩn, hai nút Sửa hồ sơ / Cài đặt (giữ nguyên chữ, thứ tự, `data-testid="hidden-reason"`). Thẻ bỏ ô ảnh bìa 56px và `data-testid="profile-cover"`; ca gradient `max-md:bg-[linear-gradient…]` bỏ cùng (bìa thiếu là bìa phẳng `--color-bg-cover` như khách thấy).

- [ ] **Step 1: Test đỏ.**
  - Mini `storefront-builder.spec.tsx`: mock `vi.mock('../services/affiliate-api', …)` với `getCtvTiers: vi.fn()`; `beforeEach` trả bậc 1 (`tier: Tân binh`). Ca mới `đầu xem trước: tên (h2), huy hiệu "CTV Đồng" khi bậc 2`: `getCtvTiers` trả bậc `Đồng` → `findByText('CTV Đồng')`; ca `bậc 1 (Tân binh): không huy hiệu`; ca `tải bậc lỗi: vẫn vẽ tên shop và nút "Sửa hồ sơ", không huy hiệu` (`getCtvTiers.mockRejectedValue`); ca `ghi chú của shop (headerNote) hiện ở đầu xem trước` (`Mua giúp mình nhé`). Ca cũ `heading level 2 'Cửa hàng Xanh'` (dòng 196) vẫn xanh.
  - Web `page.spec.tsx`: cùng bốn ca (mock `coreHttp.get('/affiliate/tiers')` theo mẫu các mock hiện có của spec); sửa ca `ảnh bìa thiếu…` thành: bìa thiếu → `[data-testid="shop-cover"]` có `background` `var(--color-bg-cover)` và nút "Thêm ảnh bìa" vẫn có `tubu-hit-44` không đậm; bìa có dữ liệu → `style` chứa `url("https://cdn.example/c.jpg%22);background:red;(%22")` (cùng chuỗi cũ).
  - e2e Mini `storefront-builder.miniapp.spec.ts`: ca `gian hàng bậc 2: đầu xem trước có "CTV Đồng", không tràn ngang`: `mockBuilder(api, { tier: 'Đồng' })`, `page.getByText('CTV Đồng')` hiện, `scrollWidth <= clientWidth`; ca tên shop dài 80 ký tự + bậc `Kim Cương`: không tràn ngang. `builder-mocks.ts` thêm `tier?: 'Tân binh' | 'Đồng' | 'Kim Cương'` (mặc định `Tân binh`) và `api.get('/affiliate/tiers', …)` dựng từ `CTV_TIERS` của `affiliate-mocks.ts`; `builder-web-mocks.ts` thêm mock cùng dữ liệu (bậc 1).
- [ ] **Step 2: Chạy đỏ** `pnpm --filter @tubutree/miniapp exec vitest run src/pages/storefront-builder.spec.tsx`; `pnpm --filter @tubutree/web exec vitest run src/app/ctv/gian-hang/page.spec.tsx`.
- [ ] **Step 3: Cài đặt.**
  - Mỗi trình dựng: `const tiersQ = useQuery({ … staleTime: 5 * 60_000, retry: false })` (Mini: `queryKey: ['affiliate-ctv-tiers'], queryFn: getCtvTiers` cùng khoá với trang CTV để dùng chung cache; web: `affiliateCtvTiersQuery(coreHttp)`); `const previewTier = publicTier(ownerTierPreview(tiersQ.data))`.
  - Thẻ hồ sơ: `Card`/`div` không đệm, `overflow: hidden`; `ShopHeader title coverUrl avatarUrl note={sf.headerNote} titleAs="h2" badges={previewTier && <TierBadge …/>}` (Mini dùng `apiMediaUrl` như `storefront-view.tsx`; web truyền `sf.coverUrl`/`sf.avatarUrl` như `storefront-body.tsx`), rồi khối đệm 16px chứa phần của chủ shop giữ y nguyên mã cũ. Web: bỏ lớp `max-md:bg-[linear-gradient…]` và `cssUrl` nếu không còn ai dùng trong file (hạ baseline `max-md` → chạy `ds-ratchet --write`).
  - Không thêm nhãn "CTV tuyển chọn"/dấu tích duyệt vào xem trước (không đổi luật hiển thị; ghi notes).
- [ ] **Step 4: Chạy xanh** hai lệnh Step 2 + `pnpm --filter @tubutree/web exec vitest run src/components/affiliate` + `pnpm --filter @tubutree/miniapp exec vitest run src/pages/storefront-builder.spec.tsx src/pages/storefront-signup.spec.tsx`; e2e Mini `tests/storefront-builder.miniapp.spec.ts tests/features.miniapp.spec.ts tests/storefront-signup.miniapp.spec.ts --workers=2`: ca nào đỏ vì `/affiliate/tiers` chưa mock thì thêm mock cho spec đó (không `allowUnmocked` che).
- [ ] **Step 5: Commit** `feat(ui): trình dựng gian hàng có đầu xem trước như khách thấy, có huy hiệu bậc (hai app)`.

### Task 5: Ô thống kê một dòng, tiêu đề khối Inter, khối Mini = web (P2 #14, phần 2)

**Files:**
- Modify: `apps/miniapp/src/components/storefront-builder/stats-panel.tsx`, `apps/web/src/components/affiliate/storefront-panels.tsx` (`StatsSection`, `StatBox`), `apps/web/src/lib/guest-ui.ts` (thêm `ui.blockTitle`), `apps/miniapp/src/pages/storefront-builder.tsx` (tiêu đề "Bố cục gian hàng" + `data-testid="builder-sections-head"`), `apps/web/src/components/affiliate/storefront-builder.tsx` (cùng tiêu đề)
- Test: `apps/miniapp/src/pages/storefront-builder.spec.tsx`, `apps/web/src/app/ctv/gian-hang/page.spec.tsx`, `apps/e2e/tests/ds-parity.shop.spec.ts`, `apps/e2e/tests/support/ds-parity.ts`

**Interfaces:**
- Consumes: `BUILDER_COPY.statsOrders/statsRevenue/statsCommission` (Task 1); `phoneCaption`, `phoneBodySm` (`lib/phone-ui.ts`).
- Produces: `ui.blockTitle` (web) = `'font-ui text-[length:var(--type-title-sm-size)] font-bold leading-[var(--type-title-sm-lh)] tracking-[-0.01em] text-[var(--color-text-primary)]'` (cùng giá trị `pdpSectionTitle`, mọi khổ); `data-testid` `builder-stats` (khối thống kê), `builder-stat` (mỗi ô), `builder-sections-head` (hàng tiêu đề "Bố cục gian hàng") ở cả hai app; probes `ds-parity`: `builder-stats-title`, `builder-stats-card`, `builder-stat-value`, `builder-stat-label`, `builder-sections-title`.

- [ ] **Step 1: Đo Mini và web, chưa sửa.** Thêm vào `ds-parity.ts` các probe trên (props: tiêu đề/giá trị/nhãn `TEXT`, thẻ `['height', 'paddingTop', 'paddingBottom', 'borderRadius']`) và scenario `Trình dựng: tiêu đề khối + ô thống kê` (route `{ miniapp: '/storefront', web: '/ctv/gian-hang' }`, `ready: '[data-testid="builder-stats"]'`; Mini `mockBuilder(api, { storefront: { isPublished: true, status: 'LIVE' } })`, web `mockBuilder` + `setBuilderSession`; cả hai `api.get('/storefront/me/stats', { orders7d: 0, orders30d: 0, revenue30d: 0, commission30d: 0, byProduct: [] })`). Chạy Mini: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3511 npx playwright test tests/ds-parity.shop.spec.ts --project='Zalo Mini App' -g 'Trình dựng'` và đọc file đính kèm `ds-parity-miniapp.json` làm `EXPECTED` (chiều cao thẻ Mini là chuẩn: khớp bố cục Mini, web sửa theo). Ghi số đo trước (Mini/web, chiều cao thẻ ~200/170 đo ở bước chụp "trước") vào notes.
- [ ] **Step 2: Test đỏ.** `EXPECTED` (số đo Mini đã đo, tiêu đề khối `fontSize 16px / lineHeight 24px / fontWeight 700 / letterSpacing -0.16px / fontFamilyKind inter`) + `diffMeasure` cho web đỏ ở chỗ lệch hiện có (tiêu đề Fraunces 16/600, nhãn 12px/16px); vitest `storefront-builder.spec.tsx` (Mini) và `page.spec.tsx` (web): nhãn ô là `Đơn hàng`/`Doanh thu`/`Hoa hồng`, tiêu đề `Thống kê 30 ngày` và `Bố cục gian hàng` là `h2` có font Inter (Mini: `style.fontFamily === 'var(--font-ui)'` và `fontWeight` 700; web: `className` chứa `font-ui` và `font-bold`, không chứa `font-display`).
- [ ] **Step 3: Cài đặt.** Mini: nhãn lấy `BUILDER_COPY.*`, `<Heading variant="title-sm" font="ui" as="h2">` cho hai tiêu đề, thêm `data-testid`. Web: nhãn cùng `BUILDER_COPY.*`, `StatBox` nhãn `text-xs ${phoneCaption}`, giá trị `text-base` giữ + khớp `body-md` của Mini (đo; thiếu thì thêm lớp `max-md:` KHÔNG mới: dùng hằng có sẵn ở `phone-ui.ts`), tiêu đề `ui.blockTitle` thay `${ui.sectionTitle} ${phoneSectionTitle}`, dòng "Chưa có đơn nào…" `text-xs ${phoneCaption}`. Lặp đo → sửa tới khi hai bên cùng số đo ở Mini 375 (dung sai 0,5px của `diffMeasure`), gồm chiều cao thẻ thống kê.
- [ ] **Step 4: Chạy xanh.** `pnpm --filter @tubutree/miniapp exec vitest run src/pages/storefront-builder.spec.tsx`; `pnpm --filter @tubutree/web exec vitest run src/app/ctv/gian-hang/page.spec.tsx src/components/affiliate`; e2e `ds-parity.shop.spec.ts` hai project (Mini ngay; web qua web-gate ở Task 8, hoặc cục bộ bằng Next dev + API giả như ghi ở `handoff-wave2.md`) → PASS. Đo thêm tay ở 320px (nhãn xuống dòng) rằng chiều cao thẻ thống kê hai app bằng nhau, ghi vào notes.
- [ ] **Step 5: Commit** `fix(ui): ô thống kê trình dựng nhãn ngắn, tiêu đề khối Inter 16/700, khối Mini bằng web (hai app); ds-parity thêm trình dựng`.

### Task 6: "Thưởng mốc doanh số tháng" của web theo thang chữ Mini (P2 #15, phần 1)

**Files:**
- Modify: `apps/web/src/components/affiliate/milestone-rewards.tsx` (dòng 112-155 và các dòng chữ trong `renderRow`), `apps/miniapp/src/components/affiliate/milestone-rewards.tsx` (chỉ thêm `data-testid`)
- Test: `apps/web/src/components/affiliate/milestone-rewards.spec.tsx`, `apps/e2e/tests/ds-parity.shop.spec.ts`, `apps/e2e/tests/support/ds-parity.ts`

**Interfaces:**
- Consumes: `phoneCaption` (13/20), `phoneBodySm` (dòng 22), `phoneBrandLabel` ở `lib/phone-ui.ts`.
- Produces: `data-testid` `milestone-rewards` (thẻ), `milestone-title`, `milestone-meta` (dòng tháng · đã chốt), `milestone-note` (dòng "Doanh số đã chốt = …"), `milestone-row-title`, `milestone-row-meta` ở cả hai app; probes `ds-parity` cùng tên.

- [ ] **Step 1: Đo.** Thêm probes + scenario `Trang CTV: Thưởng mốc doanh số tháng` (route `{ miniapp: '/affiliate', web: '/ctv' }`, `ready: '[data-testid="milestone-rewards"]'`; Mini `mockSession(AFFILIATE)` + `mockAffiliateDashboard(api, { milestones: CTV_MILESTONES })`; web phiên giả như `affiliate.web.spec.ts` + cùng mock; cả hai thêm `api.get('/affiliate/dashboard', CTV_DASHBOARD)` nếu chưa có). Chạy Mini, lấy `ds-parity-miniapp.json` làm `EXPECTED` (kỳ vọng: caption 13/20, thân `body-sm` 14/22, tiêu đề thẻ 14/22 đậm).
- [ ] **Step 2: Test đỏ.** Web `milestone-rewards.spec.tsx`: `it('chữ theo thang Mini: dòng chú thích dùng phoneCaption, tiêu đề và tên mốc dùng phoneBodySm')` kiểm `className` của `milestone-meta`, `milestone-note`, `milestone-row-meta` chứa `max-md:text-[length:var(--type-caption-size)]` và của `milestone-title`/`milestone-row-title` chứa `max-md:leading-[var(--type-body-sm-lh)]`; e2e `ds-parity` web đỏ ở các thuộc tính chữ lệch.
- [ ] **Step 3: Cài đặt.** Web: mọi `text-xs` trong khối ghép thêm `${phoneCaption}`, mọi `text-sm` ghép `${phoneBodySm}`; nút "Nhận thưởng"/"Nhận tất cả" khớp chiều cao nút Mini (đo `getBoundingClientRect` của nút Mini, web ghép lớp có sẵn, không px mới; vùng chạm ≥44px giữ). Lặp đo → sửa tới khi `diffMeasure` rỗng và chiều cao thẻ hai bên bằng nhau (dung sai 0,5px). Không đổi chức năng nhận thưởng.
- [ ] **Step 4: Chạy xanh.** `pnpm --filter @tubutree/web exec vitest run src/components/affiliate/milestone-rewards.spec.tsx src/app/ctv/page.spec.tsx`; `pnpm --filter @tubutree/miniapp exec vitest run src/components/affiliate/milestone-rewards.spec.tsx src/pages/affiliate.spec.tsx`; e2e `ds-parity.shop.spec.ts` (Mini ngay, web ở Task 8).
- [ ] **Step 5: Commit** `fix(ui): Thưởng mốc doanh số tháng ở web theo thang chữ Mini (hai app có data-testid, ds-parity thêm trang CTV)`.

### Task 7: Đo trang CTV web 375 so Mini, sửa phần chênh đơn giản (P2 #15, phần 2)

**Files:**
- Modify (chỉ nếu đo ra chênh khoảng cách/cỡ chữ): `apps/web/src/app/ctv/page.tsx`, `apps/web/src/components/affiliate/tier-card.tsx`, `apps/miniapp/src/pages/affiliate.tsx`
- Test: `apps/e2e/tests/ds-parity.shop.spec.ts` (thêm probe `ctv-tier-card`, `ctv-page-end`), vitest các file đụng

**Interfaces:**
- Consumes: scenario Task 6.

- [ ] **Step 1: Đo.** Sau Task 6, chạy lại `screens/K6` bản "sau" cho `affiliate-tier2` (script chụp ở mục Task 8): so từng thẻ Mini ↔ web (`top`, `height`, chữ đầu thẻ) trong `affiliate-tier2__after.json` hai bên; dựng bảng chênh theo thẻ (đo trước: Số dư Ví 48/48, thẻ bậc 195/193, thưởng mốc 416/318; mục tiêu chênh tổng ≤ 2px khi bỏ phần khung ngoài của web: chân trang, nút nổi).
- [ ] **Step 2: Phân loại từng chênh còn lại.** Cỡ chữ/khoảng cách/đệm/dòng cao (ví dụ thẻ bậc +2px) → sửa; chênh do khác chức năng (web có chân trang và khung riêng, Mini có tab dưới) → ghi notes, không làm. Với mỗi chênh sẽ sửa: thêm probe vào `ds-parity.ts` (đỏ trước), sửa, xanh.
- [ ] **Step 3: Chạy xanh** vitest các file đụng (`ctv/page.spec.tsx`, `tier-card.spec.tsx`, `affiliate.spec.tsx`) và e2e `ds-parity.shop.spec.ts`.
- [ ] **Step 4: Commit** `fix(ui): trang CTV web 375 khớp Mini ở khoảng cách và cỡ chữ còn lệch` (bỏ task, ghi lý do vào notes nếu đo ra không còn chênh đơn giản).

### Task 8: Ratchet, gate, ảnh 375px, bàn giao

- [ ] **Step 1:** `pnpm lint:parity`, `pnpm lint:vars`; hạ được số px/`max-md:` thì `node scripts/uiux/ds-ratchet.mjs --write` và commit baseline (`chore(ds): hạ baseline sau K6`).
- [ ] **Step 2: Ảnh 375px.** Server do mình dựng (Vite 3511, Next dev 3512, API giả 3515 chỉ trả `/api/health`, gian hàng công khai bậc 2, cấu hình). Spec chụp tạm `apps/e2e/tests/zz-k6-shots.{miniapp,web}.spec.ts` + `playwright.k6.config.ts` (KHÔNG commit, xoá khi xong): `K6_TAG=before|after npx playwright test -c playwright.k6.config.ts --project=…` ra `docs/2026-10-31-shop-redesign/screens/K6/{mini375,web375}/<màn>__<before|after>__p{1..3}.png` + `<màn>__<tag>.json` (chiều cao thẻ). Ba màn: `s-ctv-tier2` (khách xem gian hàng bậc 2), `builder-tier2` (trình dựng), `affiliate-tier2` (trang CTV). Ảnh "trước" chụp từ base `07818cc2b` trước Task 1. Ghép cặp Mini | web để so. Tắt hết server của mình, xoá file tạm.
- [ ] **Step 3: Gate.** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-K6 --base 07818cc2b --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-K6.txt` (chạy từ worktree); rồi e2e Mini đầy đủ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3511 npx playwright test --workers=2 --reporter=line`; rồi web `E2E_API_PORT=3512 E2E_WEB_PORT=3513 E2E_MINIAPP_PORT=3514 bash apps/e2e/scripts/web-gate.sh tests/ctv-375.web.spec.ts tests/affiliate.web.spec.ts tests/a11y-shop.web.spec.ts tests/ds-parity.shop.spec.ts --workers=2 --reporter=line`. Bước FAIL: so với base (log hoặc worktree tạm) rồi ghi "có sẵn" hoặc sửa tới khi PASS. Test e2e cũ đỏ vì thiết kế mới (bìa phẳng thay gradient, huy hiệu "CTV …") thì sửa theo thiết kế và ghi vào notes.
- [ ] **Step 4:** Ghi một dòng K6 vào `PROGRESS.md` (việc đã làm, ảnh ở `screens/K6/`, chênh còn lại); commit `docs(shop): K6 ctv-tier (đợt 7c)`.
