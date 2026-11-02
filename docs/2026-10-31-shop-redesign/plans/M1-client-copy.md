# M1 client-copy: viết lại chữ khách đọc ở Mini App và web (đợt 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xoá mọi dòng `EXEMPT` của `terminology.spec.ts` có lý do VOICE, ELLIPSIS, BRAND, STORE_CTV, STOCK, FLASH, EXPIRY bằng cách viết lại chữ, rồi xoá các hằng `REASON` không còn dùng. Giữ STORE_PHYSICAL và LEGAL.

**Architecture:** Bộ quét `terminology.spec.ts` là bài kiểm đỏ/xanh: mỗi task xoá trước các dòng `EXEMPT` của nhóm (spec đỏ, liệt kê chỗ còn vi phạm), sửa chữ ở mã và ở test khớp chữ cũ (spec xanh), commit. Câu có mặt ở cả Mini App và web đi qua file mới `packages/app-core/src/client-copy.ts` để hai app ra cùng chữ. Chữ do API trả không đổi (gói M2); nhánh client so khớp chữ API giữ nguyên.

**Tech Stack:** TypeScript, vitest (app-core, miniapp, web), Playwright (e2e Mini), `docs/2026-10-28-review/tools/gate.sh`.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4; `DESIGN.md` mục "Chữ chuẩn và thuật ngữ cấm"; `plans/handoff-wave7.md` §4; danh sách EXEMPT trong `packages/app-core/src/terminology.spec.ts`.

## Global Constraints

- Giọng "bạn" và "Tubu". Không "Vui lòng", không "chúng tôi" (trừ `packages/app-core/src/legal.ts`, giữ nguyên).
- Câu lỗi: nói chuyện gì xảy ra + khách làm gì tiếp, ngắn ("Thử lại sau ít phút").
- "..." ba dấu chấm thành "…" một ký tự, kể cả chữ giữ chỗ "https://…".
- "Nhãn hàng" thành "Thương hiệu"; "Đang xem cửa hàng" thành "Gian hàng"; "Chỉ còn n" thành "Còn n …"; "giờ vàng" viết thường thành "Giờ vàng" (hoa G), "Ưu đãi giờ vàng" thành "Giờ vàng"; "HSD" thành "hạn dùng".
- Giữ dòng EXEMPT STORE_PHYSICAL (cửa hàng = điểm bán/điểm nhận thật) và LEGAL.
- Không sửa `apps/api`, `apps/web/src/app/admin`, `scripts/uiux/ds-shop-rules.mjs`, voucher-ticket, category-row, sticky-action-bar, trình dựng CTV (`storefront-builder.tsx`), `flash-line*`, `shop-copy.ts`, variation-sheet, product-detail. File thuộc gói khác mà buộc đụng thì ghi vào notes.
- Trước khi đổi chữ: grep chữ cũ (`apps/*/src`, `apps/e2e/tests`, `*.spec.*`), kiểm không có mã so chữ để rẽ nhánh (`includes`/`===`/regex).
- Không chụp ảnh 375px (gói chữ); notes có bảng cũ → mới.

## Review Focus

- Mã so chữ cũ để rẽ nhánh: `login-errors.ts` (`VIETNAMESE_CHARS`, `UPSTREAM_ZALO_FAILURE`), `error-text.ts` (`isBusinessMessage` so `GENERIC_ERROR`), `client-api.ts`. Test: `client-api.spec.ts` ép `GENERIC_ERROR` hằng, `error-text.spec.ts` vẫn coi câu chung không phải lời nghiệp vụ.
- Cùng một câu hai app lệch chữ: `client-copy.spec.ts` kiểm hằng, spec từng app kiểm màn dùng đúng hằng.
- Chữ giữ chỗ/nhãn nút đổi dấu "…" làm test cũ khớp chữ đỏ: chạy vitest từng app sau mỗi task.
- e2e Mini khớp chữ cũ ("Quản lý nhãn hàng"): sửa ở `features.miniapp.spec.ts`; web `pro.web.spec.ts` chạy bằng `web-gate.sh`.
- `Đang xem cửa hàng` (vi.ts `storefront.inStore`) còn dùng ở đâu: grep `inStore` và đọc chữ hiển thị thật.
- Chữ dịch `Chỉ còn` ở Đổi rác: giữ đúng đơn vị (thùng, điểm), không biến thành "Còn n sản phẩm".

## Bảng chữ chuẩn (cũ → mới), nhóm khách hay gặp

| Chỗ | Cũ | Mới |
|---|---|---|
| Lỗi chung (Mini error-boundary, web error-state, home-text, global-error, client-api GENERIC_ERROR, loyalty-pos) | Đã có lỗi xảy ra — Vui lòng thử lại / Có lỗi xảy ra. Vui lòng thử lại. | Đã có lỗi xảy ra. Thử lại sau ít phút. |
| Mất mạng (Mini vi.ts + web client-api) | Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại. | Mất kết nối. Kiểm tra mạng rồi thử lại. |
| Quá lâu (web client-api) | Máy chủ phản hồi quá lâu. Vui lòng thử lại. | Máy chủ phản hồi quá lâu. Thử lại sau ít phút. |
| Trang lỗi web `error.tsx` | Đã có lỗi xảy ra khi tải trang. Vui lòng thử lại. | Không tải được trang. Thử lại sau ít phút. |
| Phiên đăng nhập hết hạn (web) | … Vui lòng đăng nhập lại. | … Đăng nhập lại để tiếp tục. |
| Mã Zalo hỏng / thiếu mã | … Vui lòng đăng nhập lại. | … Đăng nhập lại để tiếp tục. |
| Đăng nhập lỗi chung | Không đăng nhập được lúc này. Vui lòng thử lại; nếu vẫn lỗi, hãy liên hệ hotline để được hỗ trợ. | Không đăng nhập được lúc này. Thử lại sau ít phút; nếu vẫn lỗi, liên hệ hotline để được hỗ trợ. |
| Đăng nhập: cấu hình / Zalo bận / chưa xong / quá nhiều lần | Vui lòng thử lại sau hoặc liên hệ…; Vui lòng đợi một lúc…; Vui lòng thử lại.; Vui lòng đợi ít phút… | Thử lại sau hoặc liên hệ…; Đợi một lúc…; Thử đăng nhập lại.; Đợi ít phút… |
| Nhập tài khoản nhận hoàn tiền | Vui lòng nhập tên ngân hàng. / …tên chủ tài khoản. | Nhập tên ngân hàng. / Nhập tên chủ tài khoản. |
| Chuyển khoản: giao dịch lỗi | … Vui lòng liên hệ bộ phận hỗ trợ. | … Liên hệ Tubu để được hỗ trợ. |
| Chuyển khoản: chép số tài khoản lỗi | Không thể sao chép {x}. Vui lòng sao chép thủ công. | Không thể sao chép {x}. Bạn chép thủ công nhé. |
| Chưa thấy tiền về (Mini) | … Vui lòng kiểm tra lại sau ít phút nhé! | … Kiểm tra lại sau ít phút nhé! |
| Tải thêm lỗi (thông báo, đơn hàng, lịch sử) | Không tải thêm được X. Vui lòng thử lại. | Không tải thêm được X. Thử lại sau ít phút. |
| Ảnh đại diện | Không tải được ảnh, vui lòng thử lại. | Không tải được ảnh. Thử lại sau ít phút. |
| Vượt tồn ở thanh toán | … Vui lòng sửa số lượng trong giỏ. / … Vui lòng bỏ khỏi giỏ… | … Sửa số lượng trong giỏ để tiếp tục. / … Bỏ khỏi giỏ để đặt các món còn lại. |
| Hoàn tiền sàn | Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn... | Đã ghi nhận hoàn tiền! Đang chuyển hướng sang sàn… |
| Thương hiệu | Nhãn hàng trên Tubu Tree; Quản lý nhãn hàng | Thương hiệu trên Tubu Tree; Quản lý thương hiệu |
| Gian hàng CTV | Đang xem cửa hàng | Gian hàng |
| Giờ vàng | Giá giờ vàng; Ưu đãi giờ vàng; Xem ưu đãi giờ vàng | Giá Giờ vàng; Giờ vàng; Xem Giờ vàng |
| Hạn dùng | sai HSD | sai hạn dùng |
| Đổi rác | …chỉ còn n {đơn vị} / Tháng này bạn chỉ còn n điểm… | …còn n {đơn vị} / Tháng này bạn còn n điểm… |

---

### Task 1: ELLIPSIS (31 chỗ) — "..." thành "…"

**Files:** Modify các file có dòng `EXEMPT` `USE.ellipsis` (trừ không có STORE): mini `reviews-section.tsx`, `storefront-pickers.tsx`, `wheel.tsx`, `i18n/vi.ts`, `pages/cashback.tsx`; web `hoan-tien/page.tsx`, `merchant/{image-url-field,page,product-form}.tsx`, `thanh-toan/page.tsx`, `affiliate/{storefront-sheets,storefront-signup}.tsx`, `dealer/{credit-tab,dealer-apply,price-tab,rewards-card}.tsx`, `game/wheel.tsx`, `staff/{payroll-hub,shift-sheets}.tsx`, `lib/browse-text.ts`; app-core `game-newbie.ts`. Test khớp chữ: `wheel.spec.tsx`, `search-field.spec.tsx`, `cashback.spec.tsx` (mini), `hoan-tien/page.spec.tsx` (web). Sửa: `packages/app-core/src/terminology.spec.ts` (xoá dòng `USE.ellipsis` và `REASON.ELLIPSIS`).

**Interfaces:** Consumes: bộ quét `displayStrings/findHits` (không đổi). Produces: không có tên mới.

- [ ] **Step 1: Test đỏ.** Xoá mọi dòng `EXEMPT` có `use: USE.ellipsis` khỏi `terminology.spec.ts`. Chạy `pnpm --filter @tubutree/app-core exec vitest run src/terminology.spec.ts`; mong đợi FAIL "không có chữ cấm ngoài danh sách miễn" liệt kê 31 chỗ.
- [ ] **Step 2: Sửa chữ.** Thay `...` bằng `…` đúng ở chuỗi hiển thị (không đụng toán tử spread). Sửa 4 test khớp chữ cũ.
- [ ] **Step 3: Xanh.** `terminology.spec` xanh; `pnpm --filter @tubutree/miniapp exec vitest run src/components/wheel.spec.tsx src/components/ui/search-field.spec.tsx src/pages/cashback.spec.tsx` và `pnpm --filter @tubutree/web exec vitest run src/app/hoan-tien` xanh.
- [ ] **Step 4: Commit** `feat(copy): "..." thành "…" ở chữ khách đọc (M1)`.

### Task 2: BRAND — "Nhãn hàng" thành "Thương hiệu"

**Files:** mini `i18n/vi.ts` (`badgeBrand`), `pages/brand-owner.tsx`, `pages/profile.tsx`; web `chu-thuong-hieu/layout.tsx`, `account/account-menu.ts`, `brand-owner/brand-owner-hub.tsx`, `lib/brand-owner-view.ts`, `lib/storefront-badge.ts`; test: `storefront-badge.spec.ts`, `storefront-view.spec.tsx`, `profile-brand-owner.spec.tsx`, `brand-owner.spec.tsx` (mini), `hub.spec.tsx`, `chu-thuong-hieu/page.spec.tsx`, `page-titles.spec.ts`, `account-menu.spec.ts` (web), `apps/e2e/tests/features.miniapp.spec.ts`, `apps/e2e/tests/pro.web.spec.ts`. Mới: `packages/app-core/src/client-copy.ts` và `client-copy.spec.ts` (Task 2 tạo với `BRAND_OWNER_TITLE`, `BRAND_BADGE`; Task 4 thêm phần còn lại).

- [ ] **Step 1:** xoá dòng `USE.brand` khỏi EXEMPT, chạy spec: FAIL 11 chỗ.
- [ ] **Step 2:** đổi "Quản lý nhãn hàng" thành "Quản lý thương hiệu", "Nhãn hàng trên Tubu Tree" thành "Thương hiệu trên Tubu Tree", "Đăng nhập để quản lý nhãn hàng của bạn." thành "Đăng nhập để quản lý thương hiệu của bạn.", "Tài khoản này không có quyền quản lý nhãn hàng." thành "Tài khoản này không có quyền quản lý thương hiệu."; sửa test/e2e khớp. Mô tả test (`it('...')`) nói "nhãn hàng" giữ nguyên nếu không khớp chữ hiển thị.
- [ ] **Step 3:** spec + các vitest nêu trên xanh. **Step 4:** commit `feat(copy): Thương hiệu thay Nhãn hàng ở màn chủ thương hiệu (M1)`.

### Task 3: STORE_CTV, FLASH, EXPIRY, STOCK

**Files:** mini `i18n/vi.ts` (`inStore`, `flashPrice`), `utils/waste-labels.ts`, `pages/about-data.ts`; web `components/affiliate/ctv-order-copy.ts`, `lib/home-text.ts`, `merchant/settlement-tab.tsx`, `components/recycle/recycle-labels.ts`, `lib/faq-fallback.ts`; app-core `notification-route.ts`; test: `waste-labels.spec.ts`, `recycle-new.spec.tsx` (mini), `recycle-labels.spec.ts`, `recycle-new.spec.tsx`, `notification-view.spec.ts`, `ctv-order-sheet.spec.tsx` (web), `notifications.spec.ts`, `ctv-order-sheet.spec.tsx` (mini), `notification-route.spec.ts`.

- [ ] **Step 1:** xoá dòng `USE.store`+`REASON.STORE_CTV`, `USE.stock`, `USE.flash`, `USE.expiry` (giữ `USE.store`+`STORE_PHYSICAL`). Spec FAIL.
- [ ] **Step 2:** theo bảng: "Giá giờ vàng" thành "Giá Giờ vàng" (vi.ts và ctv-order-copy, giữ khớp), "Ưu đãi giờ vàng" thành "Giờ vàng", "Xem ưu đãi giờ vàng" thành "Xem Giờ vàng", chữ giờ vàng trong `settlement-tab.tsx` hoa chữ G, "sai HSD" thành "sai hạn dùng", `inStore` thành "Gian hàng", "chỉ còn" thành "còn" ở hai file nhãn Đổi rác. Sửa test khớp.
- [ ] **Step 3:** vitest các spec nêu trên xanh. **Step 4:** commit `feat(copy): Giờ vàng, hạn dùng, Còn n, Gian hàng (M1)`.

### Task 4: Chữ dùng chung `client-copy.ts` và VOICE

**Files:**
- Create (đã có từ Task 2, Task 4 mở rộng): `packages/app-core/src/client-copy.ts`, `packages/app-core/src/client-copy.spec.ts`.
- Modify (dùng hằng): mini `error-boundary.tsx`, `i18n/vi.ts`, `pages/{about,bank-payment,dealer,edit-profile,notifications,order-detail,cashback}.tsx`, `components/storefront-pickers.tsx`, `utils/refund-rules.ts`, `pages/profile.tsx`, `pages/brand-owner.tsx`; web `app/{error,global-error}.tsx`, `app/gioi-thieu/about-view.tsx`, `app/dang-nhap/callback/page.tsx`, `app/hoan-tien/page.tsx`, `app/merchant/page.tsx`, `app/tai-khoan/{don-hang/[code]/order-actions,don-hang/[code]/order-extras,don-hang/page,ho-so/page,orders-section,thong-bao/page,vi-tubu/page}.tsx`, `app/thanh-toan/bank-transfer-panel.tsx`, `components/ui/error-state.tsx`, `components/affiliate/{ctv-order-copy.ts,storefront-sheets.tsx}`, `components/dealer/{dealer-apply,price-tab}.tsx`, `lib/{auth-context.tsx,checkout-rules.ts,client-api.ts,customer-refunds-admin.ts,error-text.ts,home-text.ts,login-errors.ts,loyalty-pos.ts,refund-rules.ts}`; test khớp chữ cũ (xem lệnh grep ở bước 2).

**Interfaces:** Produces (`@tubutree/app-core/client-copy`):
- `ERROR_GENERIC: string`, `ERROR_NETWORK: string`, `AVATAR_READ_FAILED: string`
- `loadMoreFailed(what: string): string`
- `BANK_NAME_REQUIRED`, `ACCOUNT_NAME_REQUIRED`: string
- `BANK_TX_FAILED: string`, `bankCopyFailed(label: string): string`
- `DEALER_REJECTED_RESUBMIT: string`, `DEALER_PRICE_LOADING: string`
- `INVOICE_ISSUE_FAILED: string`, `returnWindowExpired(days: number): string`
- `STOREFRONT_TEMPLATE_HINT: string`, `STOREFRONT_TEMPLATE_BUSY: string`
- `ABOUT_MISSION: string`
- `overStockMessage(name: string, stock: number): string`
- `CASHBACK_REDIRECT: string`, `BRAND_OWNER_TITLE: string`, `BRAND_BADGE: string`

- [ ] **Step 1: Test đỏ (hằng).** `client-copy.spec.ts`: mỗi hằng/hàm không dính `FORBIDDEN_TERMS` (`FORBIDDEN_TERMS.filter(t => t.pattern.test(text))` rỗng); `overStockMessage('Dầu gội', 2)` bằng `Sản phẩm "Dầu gội" hiện còn 2 sản phẩm. Sửa số lượng trong giỏ để tiếp tục.`; `overStockMessage('Dầu gội', 0)` bằng `Sản phẩm "Dầu gội" đã hết hàng. Bỏ khỏi giỏ để đặt các món còn lại.`; `loadMoreFailed('thông báo')` bằng `Không tải thêm được thông báo. Thử lại sau ít phút.`; `returnWindowExpired(7)` bằng `Đã quá hạn đổi/trả (7 ngày kể từ khi nhận hàng). Cần hỗ trợ thêm, liên hệ Tubu bên dưới.`. Chạy: FAIL "Cannot find module".
- [ ] **Step 2: Test đỏ (bộ quét).** Xoá dòng `USE.voice` còn lại khỏi EXEMPT, giữ dòng `REASON.LEGAL`. Spec FAIL liệt kê 57 chỗ.
- [ ] **Step 3: Viết `client-copy.ts`** theo bảng chữ chuẩn (chữ ký ở Interfaces). Comment chỉ nói vì sao dùng chung ("hai app ra cùng một câu").
- [ ] **Step 4: Thay chữ ở mã.** Câu có ở cả hai app lấy từ `client-copy`; câu chỉ một app sửa tại chỗ theo bảng. Giữ nguyên nhánh so khớp chữ API (`UPSTREAM_ZALO_FAILURE`, `VIETNAMESE_CHARS`, `isBusinessMessage`). Tìm test khớp chữ cũ: `grep -rnE "Vui lòng|vui lòng" apps/miniapp/src apps/web/src apps/e2e/tests --include='*.spec.*' | grep -v admin`; chỉ sửa test khớp chữ client; chữ API trong mock/test (COD_OVER, "Zalo đang bận, vui lòng…") giữ nguyên.
- [ ] **Step 5: Xanh.** `terminology.spec`, `client-copy.spec`, rồi vitest cả `miniapp` và `web`. **Step 6: Commit** (tách 2 commit: `feat(app-core): client-copy chữ dùng chung hai app (M1)` và `feat(copy): bỏ "Vui lòng"/"chúng tôi" khỏi chữ khách đọc (M1)`).

### Task 5: Dọn EXEMPT và REASON

**Files:** Modify `packages/app-core/src/terminology.spec.ts`.

- [ ] **Step 1:** Xoá các hằng `REASON.{VOICE,ELLIPSIS,BRAND,STORE_CTV,STOCK,FLASH,EXPIRY}` và các khoá `USE` không còn dòng dùng (giữ `USE.voice` cho LEGAL, `USE.store` cho STORE_PHYSICAL; `USE` còn được dùng ngoài EXEMPT thì giữ). Chạy spec xanh, `pnpm --filter @tubutree/app-core exec tsc --noEmit` xanh.
- [ ] **Step 2:** `grep -c "reason: REASON" packages/app-core/src/terminology.spec.ts` chỉ còn các dòng STORE_PHYSICAL và LEGAL.
- [ ] **Step 3: Commit** `test(app-core): bỏ lý do miễn quét chữ đã sửa xong (M1)`.

### Task 6: Gate

- [ ] `pnpm --filter @tubutree/app-core test`, `pnpm --filter @tubutree/miniapp test`, `pnpm --filter @tubutree/web test`, `pnpm lint:parity`, `pnpm lint:vars`.
- [ ] e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3581 npx playwright test --workers=2 --reporter=line`.
- [ ] Web: `E2E_API_PORT=3582 E2E_WEB_PORT=3583 E2E_MINIAPP_PORT=3584 bash apps/e2e/scripts/web-gate.sh <spec web khớp chữ đã đổi>` (`pro.web.spec.ts`).
- [ ] `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 173de56b3 --out .../gate-M1.txt`; bước FAIL kiểm lại trên base.
