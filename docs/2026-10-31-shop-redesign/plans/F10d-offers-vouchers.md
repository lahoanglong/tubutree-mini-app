# F10d `offers-vouchers` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa sáu lỗi P1 số 14 đến 19 của `review/final-critique.md`: đầu trình dựng khối web 375, khối Giờ vàng và "Mã của tôi" ở Ưu đãi, thẻ Điểm danh, phiếu mã giảm giá, và Ưu đãi khi chưa đăng nhập, ở cả Mini App và web.

**Architecture:** Chữ và luật (nhãn phiếu một cách ghi số, tên mã bị bỏ khi nhắc lại số, trần "Mã của tôi", khoá chữ mới) nằm ở `packages/app-core`; hai app chỉ vẽ cùng cấu trúc. Phiếu (`VoucherTicket`) và thẻ điểm danh (`DailyCheckInCard`) sửa tại chỗ, không tạo thành phần song song. Khối cần tài khoản dùng `GuestLinkCard` (Mini mở rộng thẻ sẵn có cho khách chưa đăng nhập, web thêm thành phần cùng tên).

**Tech Stack:** TypeScript, React 18 (Mini: zmp-ui + Vite, web: Next 15 + Tailwind), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q1, Q3, Q5, Q10; §5 Ưu đãi); sáu lỗi ở `docs/2026-10-31-shop-redesign/review/final-critique.md` bảng P1, dòng 14 đến 19 (ảnh ở `.claude/worktrees/shop-capture/docs/2026-10-31-shop-redesign/screens/final/`). Bàn giao các đợt trước: `plans/handoff-wave*.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chức năng cho khách: Mini App và web cùng gói; logic và chữ ở `packages/app-core`, app không chép logic. Chữ mới thêm cả `shop-copy.ts` lẫn `shop-copy-budget.ts` (spec bắt thiếu một bên).
- Chữ: "Giờ vàng hôm nay" (Q10), "Mã giảm giá", không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng". Số tiền trên thẻ viết rút gọn bằng `vndShort` ("99k", "1,5tr"), số đầy đủ chỉ ở tấm chi tiết (ux-copy `coupon.detailLines`). Một phiếu không trộn "99.000đ" với "99k".
- Đồng hồ: HH:MM:SS (`mode="clock"`) chỉ ở đầu khối Giờ vàng Trang chủ và trang Giờ vàng; Ưu đãi dùng `mode="text"` (Q3).
- Tiêu đề khối Inter 16/700; vùng chạm ≥44px; tương phản ≥4,5:1; axe 0 vi phạm ở 375px trên màn đụng tới.
- Phiếu `ticket` cao ~88px ở 375px. Mini entry ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`).
- Khối mới hoặc đổi chiều cao phải giữ chỗ cho khung chờ (`offers-cls.miniapp.spec`).
- Không sửa file của F10a (`scroll-row`, `product-tile`, `tile-metrics`, `card-meta`, `flash-slots`), F10b (giỏ, `best-sellers/flash-sale/campaign/vouchers` pages), F10c (PDP web). `shop-copy.ts`, `shop-copy-budget.ts`, `ds-map.json` là file gộp tay khi merge: chỉ thêm dòng ở cuối nhóm của mình.
- Không deploy, không đọc/ghi PROD, không push, không `git stash` trần.
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh.

## Review Focus

1. Tên mã admin đặt là chữ tự do (rỗng, rất dài, chỉ khoảng trắng, nhắc lại số theo kiểu "99.000đ", "99k", "99000"): phiếu vẫn một nhãn một dòng, không lặp số, không lỗi. Test: Task 1 `voucherView` ca bảng tên; Task 3 e2e chiều cao.
2. "Mã của tôi" có 0, 1, 3, 4 mã: không cắt khi ≤3, "Tất cả (n)" chỉ khi >3, mã đã hết hạn không chiếm chỗ ba phiếu đầu. Test: Task 2 `minePreview`; Task 5 vitest hai trang.
3. Khách chưa đăng nhập mở Ưu đãi lúc phiên đang khôi phục hoặc mất mạng (`loading`, `unavailable`): không hiện `GuestLinkCard` mời đăng nhập nhầm cho người đang có phiên. Test: Task 7 vitest ba pha.
4. Thẻ Điểm danh compact khi đã điểm danh hôm nay (nút khoá), khi API lỗi, khi `pointsBlocked`: nút vẫn thấy được, luật mở bằng bàn phím và có tên đọc, không vỡ ở 320px. Test: Task 6.
5. Giờ vàng hết giờ khi khách đang xem Ưu đãi: khối ẩn, không để lại hàng đồng hồ trống. Test: Task 4 (giữ ca `onEnd` cũ).

---

## File Structure

| Việc | File |
|---|---|
| Nhãn phiếu, bỏ tên lặp, trần mã | `packages/app-core/src/commerce/voucher.ts`, `voucher-center.ts` (+ spec) |
| Chữ mới | `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts`, `daily-check-in-copy.ts`, `commerce/storefront-builder.ts` (`BUILDER_COPY`) |
| Phiếu | `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (+ spec) |
| Ưu đãi | `apps/miniapp/src/pages/offers.tsx`, `components/offers/offers-flash.tsx`; `apps/web/src/app/uu-dai/page.tsx`, `components/offers/offers-flash.tsx` (+ spec) |
| Điểm danh | `apps/miniapp/src/components/loyalty/daily-check-in-card.tsx`, `apps/web/src/components/loyalty/daily-check-in-card.tsx` (+ spec) |
| Khối cần tài khoản | `apps/miniapp/src/components/home/guest-link-card.tsx`, `apps/web/src/components/mini/guest-link-card.tsx` (mới) + `mini/index.ts`, `docs/design/ds-map.json` |
| Trình dựng web | `apps/web/src/app/ctv/gian-hang/page.tsx`, `components/affiliate/storefront-section-detail.tsx` (+ spec) |
| e2e | `apps/e2e/tests/offers.miniapp.spec.ts`, `offers.web.spec.ts`, `ctv-375.web.spec.ts`, `voucher-ticket-height.miniapp.spec.ts` (mới) |

---

### Task 1: Nhãn phiếu một cách ghi số, tên mã nhắc lại số thì bỏ (app-core)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher.ts`, `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`
- Test: `packages/app-core/src/commerce/voucher.spec.ts`, `packages/app-core/src/shop-copy.spec.ts`

**Interfaces:**
- Consumes: `vndShort` (`commerce/money.ts`), `fillCopy`.
- Produces: `couponTitle(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string` ("Giảm 20k", "Giảm 10%, tối đa 50k", "Miễn phí giao hàng"); `voucherView().title` dùng `couponTitle` (không còn `couponLabel`); `voucherView().name` là `null` khi tên admin nhắc lại số của nhãn hoặc của điều kiện (`restates`); `couponLabel` giữ nguyên (giỏ và PDP vẫn dùng chữ đầy đủ). Khoá chữ `coupon.titlePercentMax` = "Giảm {pct}%, tối đa {max}" (ngân sách 22).

- [ ] **Step 1: Test đỏ** (`voucher.spec.ts`): `couponTitle({type:'FIXED',value:20000})` = "Giảm 20k"; `{type:'PERCENT',value:10,maxDiscount:50000}` = "Giảm 10%, tối đa 50k"; `{type:'PERCENT',value:15}` = "Giảm 15%"; `{type:'FREESHIP'}` = "Miễn phí giao hàng"; `{type:'FIXED',value:12500}` = "Giảm 12.500đ" (không tròn nghìn thì đủ số, cùng luật `vndShort`). `voucherView` bảng tên admin: "Giảm 10% tối đa 50.000đ" với mã 10% tối đa 50k → `name` null; "Miễn phí giao hàng đơn từ 99.000đ" với FREESHIP minOrder 99000 → null; "Giảm 20.000đ đơn từ 150k" (mã giảm 20k) → null; "Quà khách mới" → "Quà khách mới"; "  " → null; tên chứa số khác ("Tặng 5 lần") → giữ. `shop-copy.spec` xanh khi thêm khoá ở cả hai file.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher.spec.ts src/shop-copy.spec.ts`
- [ ] **Step 3: Cài đặt** `couponTitle`, đổi `voucherView.title`, thêm hàm nội bộ `moneyFigures(text: string): number[]` (đọc "99.000đ", "99k", "1,5tr", "99000đ", "10%" về cùng đơn vị: đồng, phần trăm lấy `-pct` để không lẫn tiền) và `restates(name, ...texts)`: tên chứa nguyên văn chữ (so không dấu, không phân biệt hoa thường) hoặc mọi số của chữ kia đều có trong tên (chữ kia phải có ít nhất một số). Số của nhãn lấy từ `c.value`, `c.maxDiscount`, `c.minOrder` (không đọc ngược từ chữ).
- [ ] **Step 4: Chạy xanh** lệnh Step 2, rồi `npx tsc --noEmit` và `npx vitest run src/commerce` trong `packages/app-core`.
- [ ] **Step 5: Commit** `feat(app-core): nhãn phiếu rút gọn một cách ghi số, bỏ tên mã nhắc lại số (F10d P1 #18)`.

### Task 2: Trần "Mã của tôi" và khoá chữ Ưu đãi (app-core)

**Files:**
- Modify: `packages/app-core/src/commerce/voucher-center.ts`, `shop-copy.ts`, `shop-copy-budget.ts`, `daily-check-in-copy.ts`, `commerce/storefront-builder.ts`
- Test: `voucher-center.spec.ts`, `shop-copy.spec.ts`, `daily-check-in-copy.spec.ts` (nếu có, không thì gắn vào `shop-copy.spec.ts`)

**Interfaces:**
- Produces: `MINE_PREVIEW_MAX = 3`; `minePreview<T extends { view: VoucherView }>(rows: T[]): { shown: T[]; total: number; hasMore: boolean }` (mã còn dùng được đứng trước mã đã dùng/hết hạn, sau đó theo thứ tự đầu vào, cắt `MINE_PREVIEW_MAX`). Khoá `SHOP_COPY`: `flash.todayTitle` "Giờ vàng hôm nay" (18), `section.seeAllCount` "Tất cả ({n})" (14), `login.cta` "Đăng nhập" (12), `offers.guestPointsTitle` "Điểm Xanh và điểm danh" (26), `offers.guestPointsBody` "Đăng nhập để xem điểm, hạng và điểm danh nhận thưởng mỗi ngày." (null), `offers.guestMineBody` "Đăng nhập để xem mã bạn đã lưu và dùng ngay khi mua hàng." (null). `checkInCopy.ruleToggle` = "Luật điểm danh". `BUILDER_COPY.addProduct` = "Thêm sản phẩm".

- [ ] **Step 1: Test đỏ**: `minePreview` với 0, 1, 3, 4 hàng (4 hàng: `hasMore` true, `shown.length` 3, `total` 4); hàng `used`/`expired` nằm sau hàng `saved` dù đứng trước trong đầu vào. `shop-copy.spec` (cùng tập khoá, ngân sách, không thuật ngữ cấm) xanh sau khi thêm.
- [ ] **Step 2: Chạy đỏ.** `cd packages/app-core && npx vitest run src/commerce/voucher-center.spec.ts src/shop-copy.spec.ts`
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Chạy xanh** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(app-core): trần Mã của tôi và khoá chữ Ưu đãi (F10d P1 #15, #16, #19)`.

### Task 3: `VoucherTicket` một nhãn một dòng, cao ~88px (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/ui/voucher-ticket.tsx`, `apps/web/src/components/mini/voucher-ticket.tsx` (hai file giống nhau trừ `'use client'`)
- Test: `voucher-ticket.spec.tsx` hai app; Create `apps/e2e/tests/voucher-ticket-height.miniapp.spec.ts`

**Interfaces:**
- Consumes: `VoucherView` (Task 1: `title` ngắn, `name` null khi lặp).
- Produces: dòng đáy của `ticket` = hạn dùng · mã · số lượt (`data-testid` `voucher-expiry`, `voucher-code`, `voucher-quota` giữ nguyên, nằm cùng một hàng `flex-wrap`); `voucher-meta` chỉ còn "tên · điều kiện" và vẽ khi có ít nhất một trong hai; biến thể `row` giữ mã trong `voucher-meta`; `chip` không đổi. Nhãn `ticket` một dòng, `white-space: nowrap`, nếu vẫn quá rộng thì giảm xuống cỡ `--type-label-size` (không cắt chữ bằng dấu "…").

- [ ] **Step 1: Test đỏ** (vitest): `ticket` với mã 10% tối đa 50k, tên "Giảm 10% tối đa 50.000đ" → tiêu đề "Giảm 10%, tối đa 50k", `voucher-meta` chứa "Đơn từ 300k" và không chứa "50.000đ"; mã `NHAN10` nằm trong cùng phần tử với hạn (`voucher-expiry` và `voucher-code` có cùng cha), không trong `voucher-meta`; không còn "99.000đ" khi điều kiện là "Đơn từ 99k". e2e `voucher-ticket-height.miniapp.spec.ts` (375px, API giả có sáu mã gồm tên dài, tên lặp số, FREESHIP, mã còn 3 lượt): mọi `[data-testid=voucher-body]` cha `role=group` có chiều cao 88 đến 96px (ca có dòng "Còn n lượt" tối đa 104), nhãn không quá một dòng (`getBoundingClientRect().height` của nhãn ≤ 22px).
- [ ] **Step 2: Chạy đỏ.** `cd apps/miniapp && npx vitest run src/components/ui/voucher-ticket.spec.tsx`; `cd apps/web && npx vitest run src/components/mini/voucher-ticket.spec.tsx`
- [ ] **Step 3: Cài đặt** như Interfaces; dùng chung một bản mã cho hai app.
- [ ] **Step 4: Chạy xanh** hai lệnh Step 2 + các spec dùng `VoucherTicket` (`offers`, `vouchers`, `pdp-offers-sheet`, `voucher-sheet`, `brand-view`, `campaign`); spec nào đỏ vì chữ rút gọn thì sửa chữ mong đợi theo thiết kế (ghi vào notes). Chạy e2e: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3377 npx playwright test voucher-ticket-height`.
- [ ] **Step 5: Commit** `fix(ui): phiếu mã giảm giá nhãn một dòng, mã xuống hàng hạn, cao ~88px (F10d P1 #18)`.

### Task 4: Khối Giờ vàng ở Ưu đãi dùng đồng hồ chữ và tiêu đề "Giờ vàng hôm nay" (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/offers/offers-flash.tsx`, `apps/web/src/components/offers/offers-flash.tsx`
- Test: `offers-flash.spec.tsx` hai app

**Interfaces:**
- Consumes: `fillCopy('flash.todayTitle')` (Task 2), `Countdown mode="text"`.
- Produces: tiêu đề khối = "Giờ vàng hôm nay" (`SectionHeader` không còn `trailing`); hàng "Kết thúc sau {t}" (`Countdown mode="text"`) ngay dưới tiêu đề, cao cố định `FLASH_TEXT_ROW_H = 24` px; khung chờ (có gợi ý) thêm đúng khoảng trống 24px để khối không nhảy.

- [ ] **Step 1: Test đỏ**: khối có tiêu đề "Giờ vàng hôm nay"; có `role="timer"` với tên bắt đầu "Kết thúc sau"; không có `data-testid="countdown-cell"`; hết giờ (`onEnd`) thì cả khối ẩn (giữ ca cũ).
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/components/offers/offers-flash.spec.tsx` trong từng app.
- [ ] **Step 3: Cài đặt** như Interfaces.
- [ ] **Step 4: Chạy xanh** + `offers-cls.miniapp.spec` (Task 9).
- [ ] **Step 5: Commit** `fix(offers): Giờ vàng hôm nay dùng đồng hồ chữ, không nhảy giây (F10d P1 #15)`.

### Task 5: "Mã của tôi" cắt ba phiếu và nút "Tất cả (n)" (hai app)

**Files:**
- Modify: `apps/miniapp/src/pages/offers.tsx`, `apps/web/src/app/uu-dai/page.tsx`
- Test: `apps/miniapp/src/pages/offers.spec.tsx`, `apps/web/src/app/uu-dai/page.spec.tsx`

**Interfaces:**
- Consumes: `minePreview`, `fillCopy('section.seeAllCount', { n })`.
- Produces: khối "Mã của tôi" vẽ tối đa 3 `VoucherTicket`; `SectionHeader.action` có `label` "Tất cả (n)" khi `hasMore`, ngược lại nhãn mặc định "Xem tất cả"; tên đọc của nút vẫn là "Xem tất cả Mã của tôi"; bỏ chữ "n mã" cạnh tiêu đề (trùng với nút).

- [ ] **Step 1: Test đỏ**: 8 mã trong ví → đúng 3 phiếu, nút tên "Tất cả (8)" dẫn tới `/vouchers?tab=mine` (web `/ma-giam-gia?tab=mine`); 2 mã → 2 phiếu, nút "Xem tất cả"; 0 mã → khối rỗng như cũ.
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/pages/offers.spec.tsx` (Mini), `npx vitest run src/app/uu-dai/page.spec.tsx` (web).
- [ ] **Step 3: Cài đặt** như Interfaces.
- [ ] **Step 4: Chạy xanh**; sửa `offers.miniapp.spec` ca "Tất cả N mã và Xem tất cả" theo nhãn mới.
- [ ] **Step 5: Commit** `fix(offers): Mã của tôi cắt ba phiếu, nút Tất cả (n) (F10d P1 #16)`.

### Task 6: Thẻ Điểm danh bản compact (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/loyalty/daily-check-in-card.tsx`, `apps/web/src/components/loyalty/daily-check-in-card.tsx`, `apps/miniapp/src/pages/offers.tsx`, `apps/web/src/app/uu-dai/page.tsx`
- Test: `daily-check-in-card.spec.tsx` hai app

**Interfaces:**
- Produces: prop `compact?: boolean` (mặc định false, trang Điểm Xanh giữ thẻ đầy đủ). Compact: một hàng đầu (tiêu đề, "Ngày n/7", nút điểm danh cỡ vừa bên phải), hàng 7 ô ngày, dòng "Hôm nay nhận …" (bỏ khi đã điểm danh), nút `type=button` "Luật điểm danh" (`aria-expanded`, `aria-controls` trỏ vùng luật, vùng cao tối thiểu 44px cho nút) mở/đóng đoạn `checkInRule(status)`. Luật mặc định đóng. Khối ghi chú khách vãng lai (`GuestPointsNote`) và `message` của web giữ nguyên chỗ.

- [ ] **Step 1: Test đỏ**: `compact` không hiện đoạn luật lúc đầu; bấm nút "Luật điểm danh" (`aria-expanded` false → true) thì hiện đúng `checkInRule(status)`; bàn phím Enter cũng mở; nút điểm danh vẫn là `getByRole('button', { name: 'Điểm danh' })` và khoá khi `checkedInToday` (tên "Đã điểm danh"); không compact thì luật luôn hiện (giữ ca cũ của trang Điểm Xanh).
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/components/loyalty/daily-check-in-card.spec.tsx` trong từng app.
- [ ] **Step 3: Cài đặt** như Interfaces; đo ở Task 9 (mục tiêu ≤ ~160px ở 375px, thay 340px).
- [ ] **Step 4: Chạy xanh**; `offers.spec`/`page.spec` truyền `compact`.
- [ ] **Step 5: Commit** `fix(offers): thẻ Điểm danh compact, luật mở khi bấm (F10d P1 #17)`.

### Task 7: Ưu đãi chưa đăng nhập: mỗi khối một `GuestLinkCard`, giữ Đổi quà (hai app)

**Files:**
- Modify: `apps/miniapp/src/components/home/guest-link-card.tsx`, `apps/miniapp/src/pages/offers.tsx`, `apps/web/src/app/uu-dai/page.tsx`, `apps/web/src/components/mini/index.ts`, `docs/design/ds-map.json` (chuyển `GuestLinkCard` từ `upcoming` sang `components`)
- Create: `apps/web/src/components/mini/guest-link-card.tsx` (+ spec), spec Mini cho chế độ khách
- Test: `offers.spec.tsx`, `uu-dai/page.spec.tsx`

**Interfaces:**
- Produces: `GuestLinkCard({ title: string; body: string; cta: string })` ở cả hai app. Mini: giữ chế độ cũ (tài khoản khách chưa liên kết Zalo) và thêm chế độ khách chưa đăng nhập (`useAuthPhase() === 'guest'`: nút gọi `useAuthStore.getState().login()`); pha `loading`/`unavailable` không vẽ gì. Web: chỉ chế độ khách (`useAuthPhase() === 'guest'`), nút là `Link` tới `loginHref(pathname)`. Cả hai dùng `fillCopy('login.cta')` làm nhãn ở Ưu đãi (một nhãn, hết "Đăng nhập ngay" và "Đăng nhập với Zalo").
- Ưu đãi khi `phase === 'guest'`: Banner, Giờ vàng, Nhận mã như cũ; rồi `GuestLinkCard` "Điểm Xanh và điểm danh" (`offers.guestPointsTitle/Body`), `GuestLinkCard` "Mã của tôi" (`coupon.tabMine` + `offers.guestMineBody`), rồi khối Đổi quà và tiện ích (cùng danh sách như khi đăng nhập). `loading` giữ khung chờ, `unavailable` giữ `SessionUnavailable`.

- [ ] **Step 1: Test đỏ**: khách (`guest`) thấy đúng 2 `GuestLinkCard` (hai region tên "Điểm Xanh và điểm danh", "Mã của tôi"), cả hai nút tên "Đăng nhập", còn mục "Đổi quà" và không gọi `getLoyalty/getCoupons`; bấm nút Mini gọi `login`; web nút có `href` bắt đầu `/dang-nhap?returnTo=%2Fuu-dai`; pha `loading` và `unavailable` không có `GuestLinkCard`; đã đăng nhập không có `GuestLinkCard` kiểu khách chưa đăng nhập (Mini: tài khoản khách vẫn thấy thẻ liên kết Zalo như cũ). `check-ds-parity` xanh: `node scripts/check-ds-parity.mjs`.
- [ ] **Step 2: Chạy đỏ.** vitest hai app như các task trước.
- [ ] **Step 3: Cài đặt** như Interfaces.
- [ ] **Step 4: Chạy xanh** + `pnpm lint:parity`.
- [ ] **Step 5: Commit** `fix(offers): khách chưa đăng nhập thấy GuestLinkCard từng khối và Đổi quà (F10d P1 #19)`.

### Task 8: Đầu khối của trình dựng web 375 (web)

**Files:**
- Modify: `apps/web/src/app/ctv/gian-hang/page.tsx`, `apps/web/src/components/affiliate/storefront-section-detail.tsx`
- Test: `apps/web/src/app/ctv/gian-hang/page.spec.tsx`, `apps/web/src/components/affiliate/storefront-section-detail.spec.tsx` (nếu chưa có thì thêm), `apps/e2e/tests/ctv-375.web.spec.ts`

**Interfaces:**
- Consumes: `BUILDER_COPY.addProduct` (Task 2).
- Produces: khi URL có `?khoi=` dưới md: `PageHeader` có `className` thêm `max-md:hidden` (h1 "Gian hàng của tôi" vẫn trong DOM: `<h1 className="sr-only md:hidden">` đứng thay để mỗi trang đúng một h1 đọc được) và đầu trang chi tiết dựng như Mini: dải nền `--color-bg-surface` tràn mép, hàng đầu chừa 52px trái cho nút lùi nổi ("‹ Gian hàng của tôi" + ⋯), tiêu đề khối `h2` cỡ `--type-title-lg-size`. Nút "Thêm sản phẩm" `w-full`, chữ `BUILDER_COPY.addProduct`. Từ md giữ nguyên bố cục máy tính.

- [ ] **Step 1: Test đỏ**: render trang với `?khoi=c1`: `PageHeader` có lớp `max-md:hidden`; có đúng một h1; nút "Thêm sản phẩm" có lớp `w-full`; không có `?khoi=`: `PageHeader` không có `max-md:hidden`. `ctv-375.web.spec`: ở `/ctv/gian-hang?khoi=c1` 375px, khoảng cách từ đỉnh trang tới dòng "‹ Gian hàng của tôi" ≤ 72px, nút "Thêm sản phẩm" rộng ≥ 90% khung nội dung, `expectFits` (không tràn ngang) vẫn xanh.
- [ ] **Step 2: Chạy đỏ.** `npx vitest run src/app/ctv/gian-hang src/components/affiliate/storefront-section-detail` trong `apps/web`.
- [ ] **Step 3: Cài đặt** như Interfaces. `Shell` đọc `useSearchParams` trong một component con bọc `Suspense` (fallback là `PageHeader` thường) để build tĩnh không lỗi.
- [ ] **Step 4: Chạy xanh** + `E2E_API_PORT=3378 E2E_WEB_PORT=3379 E2E_MINIAPP_PORT=3380 bash apps/e2e/scripts/web-gate.sh ctv-375.web.spec.ts` rồi `affiliate.web.spec.ts` (nếu máy cho phép; ghi kết quả vào notes).
- [ ] **Step 5: Commit** `fix(web): đầu trang chi tiết khối của trình dựng gọn như Mini ở 375px (F10d P1 #14)`.

### Task 9: Chụp 375 trước/sau, e2e, gate

**Files:**
- Create: ảnh ở `docs/2026-10-31-shop-redesign/screens/F10d/` (thư mục gitignore), kịch bản chụp tạm ở scratchpad (không commit)
- Modify (nếu e2e cũ đỏ vì thiết kế mới): `apps/e2e/tests/offers.miniapp.spec.ts`, `offers-cls.miniapp.spec.ts`, `offers.web.spec.ts`, `shop.web.spec.ts`

- [ ] **Step 1: Chụp "trước"** ở base (`git worktree` tạm hoặc chụp trước Task 3): Ưu đãi (đăng nhập, khách), Mã giảm giá, trình dựng khối web, cả Mini (Vite dev cổng 3377) và web (Next dev cổng 3378, host `localhost`), API giả/mock như `apps/e2e/tests/support/*-mocks.ts`.
- [ ] **Step 2: Chụp "sau"** cùng cảnh, lưu `before/` và `after/`, nêu đường dẫn trong notes; tắt server của mình khi xong.
- [ ] **Step 3: e2e Mini** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3377 npx playwright test --workers=2 --reporter=line`; e2e đỏ vì thiết kế mới (nhãn "Tất cả (n)", chiều cao phiếu, chip 36px/vùng chạm 44px qua `tests/support/hit-area.ts`) thì sửa test, đỏ vì hồi quy thì sửa mã.
- [ ] **Step 4: Gate** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-F10d --base 201046ff2 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F10d.txt` (một lần, cuối). Bước FAIL đối chiếu base: có sẵn thì ghi "có sẵn".
- [ ] **Step 5: Commit** các sửa test e2e: `test(e2e): theo Ưu đãi và phiếu mới (F10d)`.

---

## Self-Review

- Phủ spec: #14 Task 8; #15 Task 4 (+ khoá Task 2); #16 Task 2, 5; #17 Task 6; #18 Task 1, 3; #19 Task 2, 7. Chụp 375 và e2e: Task 9.
- Kiểu nhất quán: `couponTitle`, `minePreview`, `MINE_PREVIEW_MAX`, `FLASH_TEXT_ROW_H`, khoá `flash.todayTitle`, `section.seeAllCount`, `login.cta`, `offers.guestPointsTitle/Body`, `offers.guestMineBody`, `BUILDER_COPY.addProduct`, `checkInCopy.ruleToggle` định nghĩa ở Task 1, 2 và dùng đúng tên ở các task sau.
- Không đụng file của F10a/b/c: `voucher-ticket.tsx` là thành phần dùng chung (chỉ lớp phiếu), không sửa `vouchers.tsx`.

---

## Vòng sửa sau review (1 MAJOR, 4 MINOR)

- **Thẻ Điểm danh gọn giữ chỗ đúng chiều cao (MAJOR).** Đo ở 375px với phần thưởng thật của máy chủ (`todayPoints` 1.000, `todayWater` 65): thẻ cũ cao 218px (dòng "Hôm nay nhận" gãy hai dòng) và khung chờ 164px, nên "Mã của tôi" nhảy 53px khi thẻ về. Bản mới cao **156px** cả lúc chưa và đã điểm danh, khung chờ `CHECK_IN_COMPACT_HEIGHT = 156` (hai app). Cách làm: nút "Luật" (chữ nhìn thấy ngắn, tên đọc vẫn "Luật điểm danh", nằm trọn trong tên đọc) lên hàng đầu cạnh "Ngày n/7", đoạn luật mở ngay dưới hàng đầu; dòng cuối dưới 7 ô cỡ caption và dùng bản ngắn `checkInTodayLine(status, { short: true })` ("Nhận +1.000 Điểm Xanh · +65 giọt nước"; ô hôm nay đã tô sáng ngay trên) nên vừa một dòng kể cả ở 360px (bản "Hôm nay nhận ..." chỉ còn 4px dư ở 360px); nút Điểm danh ở bản gọn đệm 12px, bỏ min-width 120px của ZaUI (như thanh dính) vì "Đã điểm danh" 148px làm tiêu đề gãy dòng ở 360px (lần chạy web đầu tiên lệch 24px); khi đã điểm danh dòng đó thành "Hôm nay bạn đã điểm danh rồi" để thẻ không co lại. Nút luật nhìn cao 24px, vùng chạm 44px bằng `tubu-hit-44`.
  - Mock e2e dùng chung `mockHomeEngagement` nay trả `todayPoints/todayWater/pointsDone/waterDone` như máy chủ thật (`checkInStatus()` xuất ra để spec giữ response lại).
  - Test mới: `offers.miniapp.spec` (hai ca chưa/đã điểm danh) và `shop.web.spec` (cùng hai ca ở web): giữ response `/me/daily-check-in`, đo khung chờ, thả ra, thẻ thật phải cao bằng khung chờ và "Mã của tôi", "Đổi quà" không dịch. Đã thử đổi hằng số thành 164: ca Mini đỏ.
  - **Còn cao hơn khung chờ (đã biết):** tài khoản khách `pointsBlocked` (thêm khối mời đăng nhập Zalo, lazy), 320px khi đã điểm danh (tiêu đề gãy dòng, thẻ cao 180px; các trạng thái khác ở 320px vẫn 156px), thông báo bình đầy (`tankFull`) làm dòng cuối gãy. Đây là nhóm nhỏ, không đo vào khung chờ.
- **Tên đọc nút "Tất cả (n)" (MINOR).** Bỏ `spoken` ở "Mã của tôi" nên tên đọc là "Tất cả (8) Mã của tôi" (chứa nhãn nhìn thấy, WCAG 2.5.3). Cập nhật vitest hai app và e2e.
- **Một cách ghi đếm cho hai tiêu đề (MINOR).** "Nhận mã" cũng dùng `section.seeAllCount` ("Tất cả (3)"), tên đọc "Tất cả (3) Mã giảm giá". Khoá `coupon.allCount` ("Tất cả {n} mã") không còn nơi dùng; giữ nguyên dòng ở `shop-copy.ts` và `shop-copy-budget.ts` vì hai file này gộp tay với các gói F10a/b/c, xoá khi gộp xong.
- **Tên mã admin đặt không mất gợi ý phạm vi (MINOR).** `restatesCoupon` chỉ bỏ tên khi mọi từ của tên là từ của nhãn, của điều kiện hoặc từ nối ("cho", "tặng", "bạn"...) và mọi số là số của chính mã. "Giảm 20k cho đơn đầu tiên", "Giảm 10% riêng mỹ phẩm" giữ nguyên. Tên được giữ ghi lại số của mã theo cách của phiếu ("Giảm 20.000đ cho đơn đầu tiên" thành "Giảm 20k cho đơn đầu tiên"), số lạ ("Tặng 5 lần") để nguyên. Đơn vị "đ", "k", "tr" chỉ tính khi không dính chữ cái liền sau ("50 đồng", "10 trở lên" không bị hiểu nhầm).
- **Chú thích sai về PDP (MINOR).** Sửa chú thích `couponTitle`: mọi nơi vẽ phiếu qua `voucherView` (Ưu đãi, Mã giảm giá, chiến dịch, **tấm ưu đãi ở trang chi tiết sản phẩm** Mini `pdp-offers-sheet.tsx` và web `pdp-extras.tsx`) ghi dạng rút gọn. **Cho F10c:** tấm ưu đãi PDP đổi từ "Giảm 30.000đ" sang "Giảm 30k" và có thể ẩn tên mã nhắc lại số; chụp lại ảnh, test mới không đòi dạng đầy đủ. `coupon-card.tsx` (ví cũ) và giỏ vẫn dùng `couponLabel` đầy đủ.
