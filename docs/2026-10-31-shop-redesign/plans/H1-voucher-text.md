# H1 `voucher-text` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa bốn MINOR còn lại của G1 (mã giảm giá): cắt phần đầu tên mã chỉ khi nó chép đúng nhãn, đơn vị đôi "20k vnđ" là một con số, tên đã cắt đọc tự nhiên ở biến thể `row`, và nhãn "Liên kết Zalo" một nguồn.

**Architecture:** Luật chữ nằm ở `packages/app-core/src/commerce/voucher.ts` (`voucherView.name`); `VoucherTicket` hai app (Mini `components/ui`, web `components/mini`) chỉ đổi thứ tự dòng meta của `row`, cùng cấu trúc. Nhãn Zalo giữ ở `homeCopy.profile.guestCta`, khoá `zalo.link` của shop-copy bị xoá.

**Tech Stack:** TypeScript, vitest (app-core, Mini, web), React 18 (Mini: zmp-ui + Vite, web: Next 15 + Tailwind), Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q5 chữ chuẩn). Nguồn việc: bốn dòng `[G1]` MINOR của `g6a-minors.txt` (review G1 đợt 6a) và mục "Vòng sửa sau review (đợt 6a)" của `plans/G1-vouchers-offers.md`. Bàn giao: `plans/handoff-wave4b-4f.md` mục 5.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree cần `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ giao diện tiếng Việt; không "Top", "Freeship", "Kho voucher", "Nhãn hàng" ở chữ hiển thị (`terminology.spec`).
- Số tiền trên phiếu rút gọn bằng `vndShort`; một phiếu không trộn "99.000đ" với "99k" và không bao giờ in "20k đồng".
- Phiếu `ticket` cao ~88px ở 375px (khung 88-104px của e2e `voucher-ticket-height`); vùng chạm ≥44px; axe 0 vi phạm. Không đổi bố cục ticket.
- Số px viết tay và lớp `max-md:` chỉ được giảm (`pnpm lint:parity`, `scripts/uiux/ds-baseline.json`): gói này không thêm px.
- Mini entry ≤700 KB: `home-copy.ts` không import `shop-copy.ts` (sẽ kéo bảng chữ mua sắm vào gói đầu).
- Không sửa file của G4 (Trang chủ), G5 (duyệt), G6 (trình dựng); `shop-copy.ts` và `shop-copy-budget.ts` chỉ xoá đúng một dòng `zalo.link` (gộp tay).
- Không push, không deploy, không đọc/ghi PROD, không `git stash` trần. Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.

## Review Focus

1. Tên có số của chính mã nhưng không phải số của nhãn (FREESHIP có `maxDiscount`, AMOUNT có `minOrder` bằng số đứng đầu tên): tên giữ nguyên, số vẫn hiện trên phiếu. Test: Task 1.
2. Đơn vị đôi viết kiểu khác (`20k đồng`, `20k vnđ`, `20k VND`, `1,5tr đồng`) và "đồng" là chữ thường ("20k đồng hành cùng bạn"): cụm tiền là một con số, chữ "đồng hành" không bị nuốt. Test: Task 2.
3. Tên đã cắt khi không có điều kiện (`condition` rỗng), có điều kiện, kèm mã: dòng meta của `row` không bắt đầu bằng mảnh chữ thường đứng trước điều kiện khi có điều kiện. Test: Task 3 hai app.
4. Trang Mã giảm giá khi tài khoản khách và Ưu đãi: hai thẻ khách cùng một nhãn từ cùng một khoá; sửa nhãn ở một chỗ đổi cả hai. Test: Task 4.
5. Phiếu `ticket` ở 375px/320px sau khi đổi mã nguồn tên: chiều cao và tên "cho 3 đơn" đủ chữ. Test: e2e `voucher-ticket-height` (Task 5).

---

## File Structure

| Việc | File |
|---|---|
| Luật cắt phần đầu theo nhãn, cụm tiền | `packages/app-core/src/commerce/voucher.ts` (+ `voucher.spec.ts`) |
| Thứ tự meta của `row` | `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (+ hai `voucher-ticket.spec.tsx`) |
| Nhãn Zalo một nguồn | `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`, `shop-copy.spec.ts`; `apps/miniapp/src/pages/offers.tsx`, `pages/vouchers.spec.tsx`, `pages/offers.spec.tsx` |

---

### Task 1: Cắt phần đầu tên chỉ khi chép đúng nhãn (app-core)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher.ts` (`trimRepeatedLead`, nơi gọi trong `voucherView`)
- Test: `packages/app-core/src/commerce/voucher.spec.ts`

**Interfaces:**
- Produces: `trimRepeatedLead(name: string, title: string): string` (nội bộ, bỏ tham số `c`). Số được phép trong phần đầu bị cắt là số của nhãn `title` (`figuresIn(title)`), không phải `knownFigures(c)` (gồm cả `maxDiscount`, `minOrder` mà nhãn không in). `voucherView`, `couponTitle` không đổi chữ ký.

- [ ] **Step 1: Test đỏ** trong `describe('voucherView: tên admin nhắc lại số ...')`, ca mới `'phần đầu chỉ bị cắt khi chép đúng nhãn: số của đơn tối thiểu hay trần giảm đứng đầu tên thì tên giữ nguyên'`:
  - FREESHIP `coupon({ type: 'FREESHIP', value: 0, maxDiscount: 30_000, minOrder: null })`, tên `'Freeship 30k cho đơn đầu'` → `name` bằng đúng `'Freeship 30k cho đơn đầu'` (nhãn "Miễn phí giao hàng" không có số 30k).
  - AMOUNT `coupon({ value: 20_000, minOrder: 100_000 })`, tên `'Giảm 100k cho khách mới'` → `'Giảm 100k cho khách mới'`.
  - PERCENT `coupon({ type: 'PERCENT', value: 10, maxDiscount: 50_000, minOrder: 300_000 })`: `'Giảm 10% tối đa 50k cho khách mới'` → `'cho khách mới'` (nhãn "Giảm 10%, tối đa 50k": cả chữ và số đều của nhãn); `'Giảm 300k cho khách mới'` → giữ nguyên.
  - Ca cũ của khối `'phần đầu tên chép lại nhãn thì cắt ...'` vẫn xanh.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher.spec.ts` — Expected: FAIL ở hai ca đầu (tên bị cắt thành `'cho đơn đầu'`, `'cho khách mới'`).
- [ ] **Step 3: Cài đặt** trong `voucher.ts`: `trimRepeatedLead(name, title)` dựng `labelFigures = new Set(figuresIn(title))` và dừng ở số không thuộc `labelFigures`; sửa docstring ("ít nhất một số của nhãn", nêu rõ số `maxDiscount`/`minOrder` không đủ); `voucherView` gọi `trimRepeatedLead(unifyFigures(named, c), title)`.
- [ ] **Step 4: Chạy xanh** lệnh Step 2, rồi `npx tsc --noEmit` (trong `packages/app-core`).
- [ ] **Step 5: Commit** `fix(app-core): tên mã chỉ bị cắt phần đầu khi chép đúng nhãn, không cắt theo số trần hay đơn tối thiểu (H1, G1 MINOR)`.

### Task 2: Cụm số + đơn vị + chữ tiền tệ là một con số (app-core)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher.ts` (`FIGURE_RE`, `figureValue`, `wordsOf`, `trimRepeatedLead`)
- Test: `packages/app-core/src/commerce/voucher.spec.ts`

**Interfaces:**
- Consumes: `trimRepeatedLead(name, title)` của Task 1.
- Produces: `FIGURE_RE` nhóm 3 (đơn vị) có thể là cụm `k`/`tr` + chữ tiền tệ (`đồng`, `dong`, `vnđ`, `vnd`, `đ`, `₫`, cách bằng khoảng trắng): `figureValue` nhận cả cụm ("20k vnđ" là 20.000, "1,5tr đồng" là 1.500.000); `đồng` đứng trước "hành" hoặc "thời" không phải tiền ("đồng hành"). `trimRepeatedLead` tách token theo cùng mẫu số (cụm tiền một token), nên không bao giờ để "vnđ" đứng đầu phần đuôi.

- [ ] **Step 1: Test đỏ** (mã `coupon({ value: 20_000, minOrder: 300_000 })` loại AMOUNT, thêm ca `'đơn vị đôi ...'`):
  - `'Tặng 20k vnđ'`, `'Giảm 20k VND'`, `'Tặng 20k đồng'` → `name` null.
  - `'Tặng 20k đồng cho bạn mới'` → `'cho bạn mới'`; `'Tặng 20k vnđ cho bạn mới'` → `'cho bạn mới'`; `'Giảm 20k VND cho khách mới'` → `'cho khách mới'`.
  - `view('Giảm 1,5tr đồng cho khách mới', { value: 1_500_000 })` → `'cho khách mới'`.
  - Số lạ giữ nguyên cả cụm: `'Tặng 5k đồng vào ví'` (mã 20k) → `'Tặng 5k đồng vào ví'`.
  - "đồng" thường: `'Giảm 20k đồng hành cùng bạn'` → `'đồng hành cùng bạn'` (không thành `'hành cùng bạn'`).
  - Mọi tên trên: `name` không khớp `/k\s*(đồng|vnđ|VND)/i` và khi có `condition` thì `name` không bằng `'vnđ'`/chuỗi bắt đầu bằng `'vnđ'`.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher.spec.ts` — Expected: FAIL (tên ra `'vnđ'`, `'vnđ cho bạn mới'`, `'đồng cho bạn mới'`).
- [ ] **Step 3: Cài đặt** trong `voucher.ts`: nhóm đơn vị của `FIGURE_RE` thêm nhánh `(?:tr|k)(?!\p{L})(?:\s*CURRENCY)?` với `CURRENCY` = chữ tiền tệ không dính chữ cái liền sau và `đồng` không đứng trước `\s+(?:hành|thời)`; `figureValue` nhận đơn vị theo tiền tố (`tr`, `k`, `%`, còn lại là đồng); `wordsOf` (chữ đã `fold`) bỏ cả cụm tiền sau số cùng luật; `trimRepeatedLead` tách token bằng mẫu `FIGURE_RE.source + '|\\S+'` (cờ `giu`) thay `/\S+/g` (số + đơn vị + tiền là một token). Cập nhật comment đầu `FIGURE_RE` nói "cụm đơn vị đôi".
- [ ] **Step 4: Chạy xanh** lệnh Step 2, rồi `npx vitest run src/commerce` và `npx tsc --noEmit` trong `packages/app-core`.
- [ ] **Step 5: Commit** `fix(app-core): "20k vnđ" và "20k đồng" là một con số, tên không còn bắt đầu bằng "vnđ" (H1, G1 MINOR)`.

### Task 3: Tên đã cắt đọc tự nhiên ở biến thể `row` (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (hai file giống nhau trừ dòng `'use client'` và dòng nguồn; sửa y hệt)
- Test: `apps/miniapp/src/components/ui/voucher-ticket.spec.tsx`, `apps/web/src/components/mini/voucher-ticket.spec.tsx`

**Interfaces:**
- Produces: dòng `voucher-meta` (testid giữ nguyên) của `row` đọc `điều kiện · tên · mã`: tên đã cắt ("cho 3 đơn") đứng sau điều kiện, không dẫn đầu dòng; nếu không có điều kiện thì tên đứng đầu (ngay dưới nhãn, đọc tiếp nhãn: "Giảm 20k" / "cho 3 đơn · GIAM20"). `ticket` (tên một hàng riêng sau điều kiện) và `chip` (không tên) không đổi. Props của `VoucherTicket` không đổi.

- [ ] **Step 1: Test đỏ** (cả hai spec, sửa ca `'ticket: tên admin đặt có hàng riêng ...; row giữ tên đầu dòng meta'` đổi tên thành `'... row: tên sau điều kiện'` và thêm ca `row`):
  - `view({ name: 'Chào bạn mới' })` row → `voucher-meta` text `'Đơn từ 250k · Chào bạn mới · FUWA3E'`.
  - `view({ name: 'Chào bạn mới', condition: '' })` row → `'Chào bạn mới · FUWA3E'`.
  - `view({ name: 'cho 3 đơn', title: 'Giảm 20k', condition: 'Đơn từ 100k', code: 'GIAM20' })` row → `'Đơn từ 100k · cho 3 đơn · GIAM20'` và text không bắt đầu bằng `'cho'`.
  - `ticket` cùng dữ liệu: `voucher-name` text `'cho 3 đơn'` (không đổi), `voucher-meta` text `'Đơn từ 100k'`.
- [ ] **Step 2: Chạy đỏ.** `cd apps/miniapp && npx vitest run src/components/ui/voucher-ticket.spec.tsx`; `cd apps/web && npx vitest run src/components/mini/voucher-ticket.spec.tsx` — Expected: FAIL ở ba ca `row` (tên đứng đầu).
- [ ] **Step 3: Cài đặt** ở `metaNode`: ghép các phần `[v.condition, metaName, codeInMeta ? codeNode : null]` bỏ phần rỗng, nối bằng `' · '` (`Fragment`); sửa comment đầu file ("hàng chọn mã ở thanh toán giữ tên trong dòng meta") nói đúng thứ tự mới và lý do (tên đã cắt chỉ đọc được ngay sau nhãn hoặc sau điều kiện).
- [ ] **Step 4: Chạy xanh** hai lệnh Step 2, rồi `npx vitest run src/components/product/pdp-offers-sheet.spec.tsx` (Mini) và các spec web có `variant="row"` (`npx vitest run src/app/san-pham`).
- [ ] **Step 5: Commit** `fix(voucher): tên đã cắt đứng sau điều kiện ở dòng meta của biến thể row, Mini và web như nhau (H1, G1 MINOR)`.

### Task 4: Nhãn "Liên kết Zalo" một nguồn (app-core + Mini)

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts` và `shop-copy-budget.ts` (xoá dòng `'zalo.link'`); `apps/miniapp/src/pages/offers.tsx` (dòng `GuestLinkCard`, thay `fillCopy('zalo.link')` bằng `homeCopy.profile.guestCta`)
- Test: `packages/app-core/src/shop-copy.spec.ts`, `apps/miniapp/src/pages/offers.spec.tsx`, `apps/miniapp/src/pages/vouchers.spec.tsx`

**Interfaces:**
- Consumes: `homeCopy.profile.guestCta` (`home-copy.ts`, giữ nguyên `'Liên kết Zalo'`), đã là nguồn của trang Cá nhân và trang Mã giảm giá.
- Produces: không còn `SHOP_COPY['zalo.link']`; một nhãn nút liên kết Zalo cho Ưu đãi, Mã giảm giá và Cá nhân.

- [ ] **Step 1: Test đỏ**: `shop-copy.spec.ts` thay ca `'G1: một nhãn liên kết Zalo ...'` bằng: `SHOP_COPY` không có khoá `'zalo.link'`, `SHOP_COPY_MAX` cũng không, và không giá trị nào của `SHOP_COPY` bằng `homeCopy.profile.guestCta` (không nhân đôi nhãn). `offers.spec.tsx` (khách bị chặn Điểm Xanh) và `vouchers.spec.tsx` (tài khoản khách ở Mã của tôi): nút của thẻ khách có tên đúng `homeCopy.profile.guestCta` (import `homeCopy`), thay vì chuỗi viết tay.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/shop-copy.spec.ts` — Expected: FAIL (còn khoá `zalo.link`).
- [ ] **Step 3: Cài đặt**: xoá hai dòng khoá, đổi `offers.tsx`; tìm lại bằng `grep -rn "zalo.link" apps packages` rằng không còn chỗ dùng.
- [ ] **Step 4: Chạy xanh** Step 2, rồi `npx tsc --noEmit` ở app-core, `cd apps/miniapp && npx vitest run src/pages/offers.spec.tsx src/pages/vouchers.spec.tsx src/pages/profile-hub.spec.tsx`, và `cd packages/app-core && npx vitest run src/terminology.spec.ts`.
- [ ] **Step 5: Commit** `fix(copy): nhãn Liên kết Zalo một nguồn homeCopy.profile.guestCta, bỏ khoá zalo.link trùng (H1, G1 MINOR)`.

### Task 5: Kiểm cuối, ảnh 375, gate

**Files:**
- Tạo (không commit): `apps/e2e/tests/h1-shots.miniapp.spec.ts`, `apps/e2e/tests/h1-shots.web.spec.ts` (chụp ảnh tạm; xoá khi xong); ảnh ở `docs/2026-10-31-shop-redesign/screens/H1/` (gitignore).

- [ ] **Step 1: Ảnh "trước"** chụp trước Task 1 trên base 334f0936b: Mini 375 `/vouchers?tab=mine` (mã `GIAM20` tên "Giảm 20k cho 3 đơn", `GIAM100` tên "Giảm 20k vnđ cho bạn mới") và hộp "Mã giảm giá" ở PDP (hai app, cùng dữ liệu); web chụp bằng `bash apps/e2e/scripts/web-gate.sh tests/h1-shots.web.spec.ts`.
- [ ] **Step 2: Vitest liên quan**: `packages/app-core` (`voucher.spec`, `shop-copy.spec`, `terminology.spec`), miniapp (`voucher-ticket`, `pdp-offers-sheet`, `offers`, `vouchers`), web (`voucher-ticket`, `uu-dai`, `ma-giam-gia`, `san-pham`). Expected: PASS.
- [ ] **Step 3: e2e Mini**: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3405 npx playwright test tests/vouchers.miniapp.spec.ts tests/offers.miniapp.spec.ts tests/voucher-ticket-height.miniapp.spec.ts --workers=1 --reporter=line`. Expected: PASS (`GIAM20` vẫn "cho 3 đơn", phiếu 88-104px).
- [ ] **Step 4: e2e web**: `E2E_API_PORT=3406 E2E_WEB_PORT=3407 E2E_MINIAPP_PORT=3408 bash apps/e2e/scripts/web-gate.sh tests/offers.web.spec.ts tests/pdp-mobile.web.spec.ts` rồi (cùng lượt) `tests/h1-shots.web.spec.ts` cho ảnh "sau". Expected: PASS.
- [ ] **Step 5: Ảnh "sau"** Mini và web cùng dữ liệu Step 1, đặt cạnh nhau (Mini ↔ web) và so; tắt mọi server do mình mở.
- [ ] **Step 6: Gate**: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 334f0936b --out <worktree>/../gate-H1.txt`, rồi bộ e2e Mini đầy đủ `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3405 npx playwright test --workers=2 --reporter=line`. Bước FAIL phải so với base trước khi kết luận.

---

## Self-Review

- Bốn việc: (1) Task 1, (2) Task 2, (3) Task 3, (4) Task 4; ảnh, e2e, gate ở Task 5. Mọi số, chuỗi trong test lấy từ báo cáo reviewer (`Freeship 30k cho đơn đầu`, `Giảm 100k cho khách mới`, `Tặng 20k vnđ`, `Tặng 20k đồng cho bạn mới`, `Giảm 20k VND`, `cho 3 đơn · Đơn từ 100k · GIAM20`).
- Tên nhất quán: `trimRepeatedLead(name, title)` (Task 1 định nghĩa, Task 2 dùng), `FIGURE_RE`, `figureValue`, `wordsOf`, testid `voucher-meta`/`voucher-name`, `homeCopy.profile.guestCta`.
- Hai biến thể của Task 3 (row và ticket) đều có test ở cả hai app.
