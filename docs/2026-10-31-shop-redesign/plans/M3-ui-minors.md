# M3 ui-minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sửa 4 MINOR giao diện còn lại từ đợt 6–7 (`handoff-wave6.md` §4, `handoff-wave7.md` §4): nhãn hàng danh mục Trang chủ không bị "…" oan, tên mã admin đặt xuống tối đa 2 dòng, thanh dính web không dùng màu thô, trình dựng gian hàng CTV vẽ ngay không chờ `/affiliate/tiers`.

**Architecture:** toàn bộ phía client, hai app sửa cùng cách (luật web khổ điện thoại = Mini App). Số đo dùng chung đặt ở `packages/app-core/src/home-layout.ts`; Mini 375px làm trước, web theo cùng số. Không sửa API, không đổi số tiền.

**Tech Stack:** React 18, zmp-ui + Vite (Mini), Next 15 + Tailwind (web), TanStack Query, vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); nguồn MINOR: `plans/handoff-wave6.md` §4 (dòng ~79–86), `plans/handoff-wave7.md` §4; kế hoạch gốc liên quan `plans/G1-vouchers-offers.md`, `plans/K6-ctv-tier.md`.

## Global Constraints

- `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Web khổ điện thoại giống Mini App cả giao diện: mỗi sửa giao diện làm ở cả hai app cùng số đo.
- Chữ nhãn nhỏ dùng token `--type-label-*` (12px, 600); không có chữ dưới 12px. Giá giảm `--color-text-price-deal`, không dùng đỏ. Vùng chạm ≥ 44px, tương phản ≥ 4,5:1, axe 0 vi phạm ở 375px.
- Số px viết tay và màu thô chỉ được giảm (`scripts/uiux/ds-baseline.json`); hạ được số thì `node scripts/uiux/ds-ratchet.mjs --write` rồi commit baseline. Không nới baseline.
- Không sửa file của gói song song: M1 (chữ hiển thị app + `terminology.spec.ts` EXEMPT/REASON), M2 (chữ API, logic bộ quét), M4 (flash-line, variation-sheet, PDP giá Giờ vàng, bảng thêm nhanh Yêu thích). Nếu buộc phải đụng thì ghi vào notes.
- Không push, không đọc/ghi PROD. Máy chung thiếu RAM: vitest theo file, gate đầy đủ một lần ở cuối, e2e `--workers=2`.
- Comment chỉ giải thích "vì sao" không hiển nhiên (tiếng Việt, theo mật độ của file); không comment kể lại thay đổi.
- Bài học CI: Linux vẽ chữ rộng hơn Mac. Test e2e về chữ không đo sát mép; tái hiện bằng `page.addStyleTag({ content: '*{font-family:Verdana !important}' })` và chỉ khẳng định bất biến (chiều cao vùng nhãn, không tràn ngang), không khẳng định "vừa khít".

## Review Focus

1. Nhãn danh mục là MỘT từ dài hơn cột ("Probiotics", 10 ký tự), hoặc tên chỉ một từ ngắn ("Thú cưng"): vùng nhãn vẫn cao đúng `CATEGORY_LABEL_HEIGHT`, mọi ô trong hàng thẳng hàng, không tràn ngang trang. Test Task 1 (vitest + e2e Verdana).
2. Tên mã admin đặt 40 ký tự trong phiếu có cả "Còn 3 lượt" và mã 15 ký tự, ở 375px và 320px: tên tối đa 2 dòng (có "…" khi quá), nút "Lưu mã"/"Dùng ngay" giữ nguyên bề rộng và nằm trọn trong phiếu, phiếu không tràn ngang. Test Task 2 (vitest + e2e).
3. `/affiliate/tiers` treo mãi: trình dựng, "Sửa hồ sơ", danh sách khối vẽ và bấm được ngay; chỗ huy hiệu bậc là khung chờ cao bằng huy hiệu thật. Test Task 4.
4. `/affiliate/tiers` lỗi 500 / về bậc thấp nhất (không có `publicBadge`) / mất mạng (`paused`): không màn lỗi, không huy hiệu, không để lại hàng huy hiệu rỗng. Test Task 4.
5. Gian hàng MERCHANT: không gọi `/affiliate/tiers`, không khung chờ huy hiệu. Test Task 4.

---

## File Structure

- `packages/app-core/src/home-layout.ts`: thêm hằng `CATEGORY_LABEL_GUTTER` và `CATEGORY_LABEL_TRACKING` cạnh `CATEGORY_LABEL_HEIGHT` (Task 1; bản đầu dùng `CATEGORY_LABEL_BLEED` lấn 2px sang ô kề, reviewer bắt chữ hai nhãn kề chạm nhau nên bỏ).
- `apps/miniapp/src/components/home/category-row.tsx` + `.spec.tsx`, `apps/web/src/components/home/category-row.tsx` + `.spec.tsx` (Task 1).
- `apps/miniapp/src/components/ui/voucher-ticket.tsx` + `.spec.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` + `.spec.tsx` (Task 2).
- `apps/web/src/components/sticky-action-bar.tsx` + `.spec.tsx`, `scripts/uiux/ds-shop-rules.mjs` (Task 3).
- `apps/miniapp/src/components/ui/tier-badge.tsx`, `apps/web/src/components/mini/tier-badge.tsx` (thêm `TierBadgeSkeleton`); `apps/miniapp/src/pages/storefront-builder.tsx` + `.spec.tsx`; `apps/web/src/app/ctv/gian-hang/page.tsx` + `page.spec.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx`; `packages/app-core/src/commerce/shop-page.ts` (chỉ chữ chú thích của `ownerTierPending`) (Task 4).
- `apps/e2e/tests/category-row-labels.miniapp.spec.ts` (mới), `apps/e2e/tests/voucher-ticket-height.miniapp.spec.ts`, e2e trình dựng Mini hiện có (Task 5).
- `docs/2026-10-31-shop-redesign/PROGRESS.md`, `scripts/uiux/ds-baseline.json` (Task 6).

Số đo đã đo (Mac, Inter 600, độ rộng chữ px): `thiên nhiên` 69,9 / 64,5 · `Nông sản &` 71,6 / 66,1 · `Thực phẩm` 71,0 / 65,6 (13px / 12px). Cột hàng 5 ô (≤10 ô) rộng 68,6px; cột cuộn 5,5 rộng 62,4px (siết -0,01em: 63,2 / 64,9 / 64,5 ở 12px). Hiện nhãn dùng 13px (`caption`) nên "Mỹ phẩm thiên nhiên" và "Nông sản & Thực phẩm" cần 3 dòng và bị "…" ở dòng hai.

---

### Task 1: nhãn danh mục Trang chủ: 12px, tối đa 2 dòng, ngắt theo từ, thẳng hàng

**Files:**
- Modify: `packages/app-core/src/home-layout.ts` (cạnh dòng 582)
- Modify: `apps/miniapp/src/components/home/category-row.tsx`, `apps/web/src/components/home/category-row.tsx` (hàm `Label`)
- Test: `apps/miniapp/src/components/home/category-row.spec.tsx`, `apps/web/src/components/home/category-row.spec.tsx`

**Interfaces:**
- Produces: `export const CATEGORY_LABEL_GUTTER = 1;` (px mỗi bên nhãn chừa trong ô, chỉ ở chế độ cuộn 5,5 cột; hai nhãn kề cách nhau ≥ 2px) và `CATEGORY_LABEL_TRACKING = '-0.04em'`. `CATEGORY_LABEL_HEIGHT` (32) và `CATEGORY_CELL_HEIGHT` không đổi, nên `HOME_SETTLING_HEIGHTS.categories` và khung chờ không đổi.

- [ ] **Step 1: Test đỏ** (cả hai app). Thêm `describe('nhãn hai dòng (M3)')` với tên thật `LONG = ['Chăm sóc nhà cửa thiên nhiên', 'Nông sản & đặc sản', 'Thực phẩm hữu cơ']`:
  - mỗi nhãn: `style.getPropertyValue('-webkit-line-clamp') === '2'`, `style.whiteSpace` không là `nowrap`, không có `textOverflow: ellipsis` một dòng, `textAlign: center`, `height` đúng `${CATEGORY_LABEL_HEIGHT}px`; văn bản đầy đủ có trong DOM (`getByRole('button', { name: LONG[0] })`).
  - nhãn dùng token nhãn nhỏ: `style.fontSize === 'var(--type-label-size)'` và `style.lineHeight === 'var(--type-label-lh)'` (không còn `--type-caption-*` và không còn `16px` viết tay).
  - lưới tới 10 ô (6 danh mục): nhãn `width: 100%`, không `marginLeft/marginRight`; lưới quá 10 ô (12 danh mục): `width: 100%`, `boxSizing: border-box`, `paddingLeft`/`paddingRight` bằng `CATEGORY_LABEL_GUTTER`, `letterSpacing` bằng `CATEGORY_LABEL_TRACKING` (đọc hằng, không gõ số), không lấn lề âm.
  - tên một từ 10 ký tự ("Probiotics") và tên một từ ngắn ("Thú cưng"): cùng `height` `32px`, `overflowWrap: anywhere` (từ dài hơn cột thì mới ngắt giữa từ, vì cắt bằng overflow sẽ mất chữ cuối không có "…").
- [ ] **Step 2:** chạy `cd apps/miniapp && npx vitest run src/components/home/category-row.spec.tsx` và `cd apps/web && npx vitest run src/components/home/category-row.spec.tsx`; kỳ vọng FAIL (nhãn còn `caption`, chưa có bleed).
- [ ] **Step 3: Implement** `Label({ children, scrolls })` ở hai app: `Text variant="label"` (12px/600 từ token, bỏ `fontWeight` và `lineHeight` viết tay); khi `scrolls`: `letterSpacing: CATEGORY_LABEL_TRACKING`, `boxSizing: border-box`, `padding: 0 CATEGORY_LABEL_GUTTER`. Giữ `display: -webkit-box`, clamp 2, `height: CATEGORY_LABEL_HEIGHT`, `overflow: hidden`. Cập nhật câu chú thích của `Label` (vì sao 12px, vì sao siết chữ và chừa 1px mỗi bên: 5,5 cột chỉ rộng 62,4px). Cập nhật hai test cũ nói "cột 5,5 hẹp" và "siết chữ" cho khớp (nhãn nay dùng `label`).
- [ ] **Step 4:** chạy lại hai lệnh Step 2; kỳ vọng PASS toàn file (cả các ca cũ).
- [ ] **Step 5: Commit** `fix(home): nhãn danh mục 12px tối đa hai dòng, lấn 2px ở cột 5,5 để tên dài không bị "…" oan`.

### Task 2: tên mã admin đặt tối đa 2 dòng ở phiếu `ticket`

**Files:**
- Modify: `apps/miniapp/src/components/ui/voucher-ticket.tsx` (khối `ticket && (showMeta || name)`, kiểu `TITLE_ONE_LINE`), `apps/web/src/components/mini/voucher-ticket.tsx` (cùng nội dung)
- Test: `apps/miniapp/src/components/ui/voucher-ticket.spec.tsx`, `apps/web/src/components/mini/voucher-ticket.spec.tsx`

**Interfaces:**
- Consumes: `VoucherView.name` (không đổi, app-core `commerce/voucher.ts`).
- Produces: `voucher-name` của `ticket` là `display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden` (cùng `TITLE_CLAMP` đã có), `flex: 1 1 0; minWidth: 0`; hàng điều kiện + tên `alignItems: flex-start` (tên hai dòng không làm điều kiện trôi theo đường cơ sở). Nút chính không đổi (`flex: 0 0 auto`).

- [ ] **Step 1: Test đỏ** (cả hai app, thay ca "ticket: tên admin đặt có hàng riêng (một dòng...)"): với `name: 'Chương trình tri ân khách hàng thân thiết'` (40 ký tự): `voucher-name` có `-webkit-line-clamp` `2`, không `whiteSpace: nowrap`, không `textOverflow: ellipsis`; hàng cha `display: flex`, `alignItems: flex-start`, điều kiện đứng trước tên; nút "Lưu mã" vẫn `flex: 0 0 auto` và không nằm trong phần tử có `overflow: hidden`. Ca `row` giữ nguyên (tên trong dòng meta), ca `chip` giữ nguyên (không vẽ tên).
- [ ] **Step 2:** chạy `npx vitest run src/components/ui/voucher-ticket.spec.tsx` (Mini) và `npx vitest run src/components/mini/voucher-ticket.spec.tsx` (web); kỳ vọng FAIL.
- [ ] **Step 3: Implement** ở hai file giống hệt nhau (web chỉ khác dòng `'use client'` và chú thích nguồn): `voucher-name` dùng `TITLE_CLAMP`; hàng điều kiện + tên `alignItems: 'flex-start'`; sửa chú thích "tên co bằng '…'" thành "tối đa hai dòng" và bỏ câu "mỗi dòng caption 20px nên hàng riêng cho tên làm phiếu cao hơn" cho khớp (phiếu có tên dài cao thêm tối đa một dòng caption, e2e Task 5 đo).
- [ ] **Step 4:** chạy lại hai lệnh Step 2; kỳ vọng PASS toàn file.
- [ ] **Step 5: Commit** `fix(voucher): tên mã admin đặt xuống tối đa hai dòng thay vì cắt một dòng ở khoảng 100px`.

### Task 3: thanh dính web dùng token semantic và vào lưới chặn

**Files:**
- Modify: `apps/web/src/components/sticky-action-bar.tsx` (dòng `className` của `div`), `scripts/uiux/ds-shop-rules.mjs` (mảng `WEB_SHOP`, dòng regex `components/(flash-price|add-to-cart|...)`)
- Test: `apps/web/src/components/sticky-action-bar.spec.tsx`; chạy `apps/web/src/ds-shop-guard.spec.ts` (đường thật có thể khác: `ls apps/web/src/**/ds-shop-guard.spec.ts`)

**Interfaces:**
- Produces: nền `bg-[var(--color-bg-surface)]`, bóng `shadow-[var(--elevation-3)]` (cùng hai token của `components/mini/sticky-action-bar.tsx`), bỏ `border-t border-stone-200 bg-stone-0` và `shadow-raised`. `WEB_SHOP` khớp `components/sticky-action-bar.tsx`.

- [ ] **Step 1: Test đỏ:** `sticky-action-bar.spec.tsx` thêm ca "màu bằng token semantic": `className` chứa `bg-[var(--color-bg-surface)]` và `shadow-[var(--elevation-3)]`, không khớp `/\b(?:bg|border)-stone-\d+\b/`. Chạy `ds-shop-guard.spec` web sau khi thêm file vào `WEB_SHOP` nhưng CHƯA sửa className: kỳ vọng FAIL ở luật màu thô (chứng minh lưới đã quét file).
- [ ] **Step 2:** `cd apps/web && npx vitest run src/components/sticky-action-bar.spec.tsx` kỳ vọng FAIL; thêm `sticky-action-bar` vào regex `WEB_SHOP`, chạy guard kỳ vọng FAIL.
- [ ] **Step 3: Implement** đổi className theo Interfaces.
- [ ] **Step 4:** chạy lại spec và `ds-shop-guard.spec` web (và Mini, vì `ds-shop-rules.mjs` dùng chung): PASS; không nới `ds-baseline.json`.
- [ ] **Step 5: Commit** `fix(web): thanh dính đáy dùng token màu semantic như Mini, đưa vào lưới ds-shop-guard`.

### Task 4: trình dựng gian hàng CTV vẽ ngay, chỉ chỗ huy hiệu bậc chờ

**Files:**
- Modify: `apps/miniapp/src/pages/storefront-builder.tsx` (`StorefrontBuilderPage`, `Builder`, hàng `badges`), `apps/web/src/app/ctv/gian-hang/page.tsx`, `apps/web/src/components/affiliate/storefront-builder.tsx`, `apps/miniapp/src/components/ui/tier-badge.tsx`, `apps/web/src/components/mini/tier-badge.tsx`, `packages/app-core/src/commerce/shop-page.ts` (chú thích)
- Test: `apps/miniapp/src/pages/storefront-builder.spec.tsx`, `apps/web/src/app/ctv/gian-hang/page.spec.tsx`

**Interfaces:**
- Produces: `TierBadgeSkeleton(): JSX.Element` ở hai app, `data-testid="tier-badge-skeleton"`, `aria-hidden`, cao đúng `Badge` md (12px × `--type-label-lh` + 2 × 3px ≈ 22px, đo ở Step 5), bo `--radius-pill`, rộng cỡ nhãn "CTV Đồng". `Builder`/`StorefrontBuilder` nhận thêm `tierPending: boolean`. `ownerTierPending(q)` giữ nguyên chữ ký, nghĩa mới: "chỗ huy hiệu còn chờ" (không còn chặn dựng).

- [ ] **Step 1: Test đỏ** (cả hai app, sửa các ca "bậc về muộn hơn gian hàng: chờ cả hai" và "đang chờ bậc: khung chờ, chưa vẽ trình dựng" cho đúng thiết kế mới):
  - bậc không bao giờ về (promise treo): có `shop-cover`, h2 tên shop, nút "Sửa hồ sơ", danh sách khối; có đúng một `tier-badge-skeleton` trong hàng huy hiệu; không `role=alert`/`ErrorState`.
  - bậc về sau (`release(tiersAt(1))`): khung chờ biến mất, "CTV Đồng" hiện, không dựng lại phần còn lại (cùng nút DOM `shop-cover` trước và sau).
  - bậc lỗi 500: sau khi lỗi không còn khung chờ, không huy hiệu, không `ErrorState`, trình dựng vẫn đủ.
  - bậc 1 (không `publicBadge`): không huy hiệu, không khung chờ; không có `CTV tuyển chọn` thì phần tử `badges` không để lại hàng rỗng (không có div huy hiệu).
  - mất mạng (`paused`): không khung chờ (`ownerTierPending` false), dựng đủ (ca có sẵn, giữ).
  - MERCHANT: không gọi `/affiliate/tiers` và không khung chờ (ca có sẵn, thêm khẳng định không có `tier-badge-skeleton`).
- [ ] **Step 2:** `cd apps/miniapp && npx vitest run src/pages/storefront-builder.spec.tsx` và `cd apps/web && npx vitest run src/app/ctv/gian-hang/page.spec.tsx`; kỳ vọng FAIL ở các ca mới.
- [ ] **Step 3: Implement:** bỏ nhánh `return <BuilderLoading />` / `<Skeleton height={120} />` chờ bậc ở hai trang; truyền `tierPending={sf.type === 'CTV' && ownerTierPending(tiersQ)}`; hàng `badges` ở `Builder`/`StorefrontBuilder`: huy hiệu "CTV tuyển chọn" (nếu có), rồi `tier ? <TierBadge/> : tierPending ? <TierBadgeSkeleton/> : null`; truyền `badges` là `undefined` khi cả ba đều trống. Sửa chú thích đầu `StorefrontBuilderPage` (không còn chờ bậc) và chú thích `ownerTierPending` ở app-core.
- [ ] **Step 4:** chạy lại hai lệnh Step 2 và `cd packages/app-core && npx vitest run src/commerce/shop-page.spec.ts`; kỳ vọng PASS.
- [ ] **Step 5:** đo huy hiệu thật bằng Playwright (Task 5) và chỉnh `TierBadgeSkeleton` cho cao bằng nhau; **Commit** `fix(ctv): trình dựng gian hàng vẽ ngay, chỉ chỗ huy hiệu bậc chờ /affiliate/tiers`.

### Task 5: e2e Mini + ảnh 375px

**Files:**
- Create: `apps/e2e/tests/category-row-labels.miniapp.spec.ts`
- Modify: `apps/e2e/tests/voucher-ticket-height.miniapp.spec.ts`, e2e trình dựng Mini hiện có (tìm `grep -l "storefront" apps/e2e/tests/*builder*.miniapp.spec.ts`)
- Xoá: `apps/e2e/tests/zz-m3-scratch.miniapp.spec.ts` (đo tạm, không commit)

- [ ] **Step 1: category-row-labels** (Mini; `mockDiscovery` + `api.get('/categories', …)` 12 và 7 danh mục tên thật, `viewport 375×812`, và một ca bật Verdana): mọi nhãn cao đúng 32px; trong cùng hàng mọi ô có cùng `top` của nhãn; trang không tràn ngang (`documentElement.scrollWidth <= innerWidth`); 7 danh mục + "Tất cả" xếp 5 cột, 12 danh mục cuộn ngang và ô thứ 6 ló mép. Chạy `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3601 npx playwright test tests/category-row-labels.miniapp.spec.ts --workers=1 --reporter=line`; PASS.
- [ ] **Step 2: voucher-ticket-height:** thêm mã có tên 40 ký tự vào `COLLECT` và `WALLET`; ở 375px: `voucher-name` cao ≤ 2 dòng caption (≤ 41px), nút chính nằm trong hộp phiếu và cùng bề rộng với nút của phiếu trơn; cập nhật trần chiều cao theo thiết kế mới (tên hai dòng cộng thêm tối đa một dòng caption 20px; ghi số đo thật vào chú thích đầu file) và bỏ ràng buộc "chênh ≤ 16px" cho phiếu có tên hai dòng; ở 320px: mã 15 ký tự và nút vẫn trọn trong phiếu.
- [ ] **Step 3: trình dựng:** thêm ca vào e2e trình dựng Mini: `/affiliate/tiers` không trả lời (route giữ treo), `shop-cover` và nút "Sửa hồ sơ" hiện trong 3 giây, có `tier-badge-skeleton`; sau khi bậc về (route trả `tiersAt(1)`) khung chờ được thay bằng huy hiệu mà vị trí `y` của khối "Cài đặt gian hàng" dưới nó không đổi (≤ 1px).
- [ ] **Step 4: ảnh:** chụp 375px trước/sau, cả hai app, ghi ở `docs/2026-10-31-shop-redesign/screens/M3/` (thư mục gitignore): hàng danh mục Trang chủ (7 và 12 danh mục), phiếu tên 40 ký tự ("Mã giảm giá" Mini `/vouchers`, web `/ma-giam-gia`), trình dựng CTV với bậc treo. Vite dev Mini cổng 3601, Next dev web cổng 3602, tắt server khi xong. Web dùng `mockDiscovery`-tương đương (`/ds-gallery` nếu có) hoặc DB e2e; việc nào không dựng được ghi rõ trong notes.
- [ ] **Step 5: Commit** `test(e2e): nhãn danh mục, tên mã 40 ký tự và trình dựng CTV khi bậc treo (Mini)`.

### Task 6: ratchet, PROGRESS, gate

**Files:**
- Modify: `scripts/uiux/ds-baseline.json` (chỉ hạ), `docs/2026-10-31-shop-redesign/PROGRESS.md`

- [ ] **Step 1:** `node scripts/uiux/ds-ratchet.mjs --write` nếu số px/màu thô hạ (xem `git diff scripts/uiux/ds-baseline.json`: chỉ được giảm); `pnpm lint:parity`, `pnpm lint:vars`.
- [ ] **Step 2:** thêm mục M3 vào PROGRESS (đã sửa gì, quyết định thay chủ: 12px + chừa 1px mỗi bên và siết chữ ở cột 5,5, tên mã tối đa 2 dòng cao thêm tối đa 20px, huy hiệu bậc là khung chờ).
- [ ] **Step 3:** gate đầy đủ một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 173de56b3 --out <gate-M3.txt>`; sau đó e2e Mini đầy đủ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3601 npx playwright test --workers=2 --reporter=line` và `E2E_API_PORT=3602 E2E_WEB_PORT=3603 E2E_MINIAPP_PORT=3604 bash apps/e2e/scripts/web-gate.sh tests/ds-parity.shop.spec.ts tests/a11y-shop.web.spec.ts`. Bước FAIL phải so với base (worktree tạm) rồi ghi "có sẵn" hoặc sửa tới PASS.
- [ ] **Step 4: Commit** `docs(shop): PROGRESS đợt 8 M3 ui-minors` (kèm baseline nếu đổi).

---

## Self-Review

- Spec coverage: (1) Task 1 + Task 5 Step 1; (2) Task 2 + Task 5 Step 2; (3) Task 3; (4) Task 4 + Task 5 Step 3; chụp 375px Task 5 Step 4; gate Task 6.
- Tên nhất quán: `CATEGORY_LABEL_GUTTER` / `CATEGORY_LABEL_TRACKING` (Task 1), `TierBadgeSkeleton` / `tier-badge-skeleton` / `tierPending` (Task 4, Task 5), `ownerTierPending` giữ chữ ký.
- Không đụng file gói khác: `home-layout.ts` chỉ thêm một hằng (M1 không sửa số đo, M4 không đụng).
