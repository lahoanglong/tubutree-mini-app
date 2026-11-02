# M2 api-copy (đợt 8): chữ API và lưới chữ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bỏ "Vui lòng" và "chúng tôi" khỏi chữ API trả cho khách, tách câu Giờ vàng của khách ra khỏi `flash-sale.service.ts`, và đặt lưới trong `terminology.spec.ts` để hai chữ này không quay lại API.

**Architecture:** Bộ quét chữ cấm nằm trong `packages/app-core/src/terminology.spec.ts` (đọc cây cú pháp). Thêm một luật quét MỌI file `apps/api/src/**/*.ts` (trừ `*.spec.ts`) chỉ với luật `Bạn hoặc Tubu`; hai sửa lỗ bộ quét ở đoạn template; câu khách đọc của Giờ vàng nằm ở file mới `flash-sale-notice.ts` để bộ quét tự quét. Việc viết lại chữ giữ mã lỗi (`code`), giữ nguyên mệnh đề đầu câu mà client cũ so khớp, chỉ đổi phần "Vui lòng …".

**Tech Stack:** NestJS + jest (`apps/api`), vitest + TypeScript compiler API (`packages/app-core`), Playwright mock (`apps/e2e`), jest race spec trên Postgres cụm riêng cổng 25591.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (luật chữ), `DESIGN.md` mục "Chữ chuẩn và thuật ngữ cấm", `docs/2026-10-31-shop-redesign/plans/handoff-wave7.md` §4 (mục "Chữ API" và "Bộ quét chữ cấm"). Gói này không có mục trong `02-ke-hoach.md`; đặc tả là bốn việc của lệnh giao gói M2.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Giọng: "bạn" và "Tubu". Câu mệnh lệnh ngắn hoặc "Bạn …"; câu lỗi nói rõ chuyện gì và khách làm gì tiếp. Giữ nguyên nghĩa và số liệu chèn vào câu (`${vnd(...)}`, `${formatPoints(...)}`).
- Giữ mã lỗi (`code`) và trạng thái HTTP hiện có. Chỉ đổi chữ.
- Mini App bản cũ trên máy khách vẫn chạy với API mới: client so khớp `/đăng nhập Zalo/i` (cổng nhận mã, `real-user.ts`), `/không đủ tồn kho/`, `'Vượt giới hạn mua ưu đãi.'`, `'Hết suất ưu đãi.'` (`checkout.tsx`, `checkout-rules.ts`), `STALE_PATTERN` của hoàn tiền (`customer-refunds-admin.ts`: `không còn chờ|vừa được xử lý|vừa thay đổi|không còn ở trạng thái|…`), `/hoá đơn/i` và `/đang tắt/i` (`loyalty-pos.ts`). Các chữ này KHÔNG đổi; chỉ đổi đuôi "Vui lòng …" đứng sau chúng. Trong API: `classifyOrderError` so `tồn kho`, `Tổng tiền đơn vừa thay đổi`, `Địa chỉ giao hàng`, `Phường/xã không thuộc`, `Số dư`, `COD`: mệnh đề đầu giữ nguyên.
- Luật quét "Vui lòng"/"chúng tôi" là không phân biệt hoa thường (mẫu `FORBIDDEN_TERMS` có cờ `i`), nên "vui lòng" viết thường cũng phải đổi: tổng 112 dòng ở 47 file, không chỉ 50 dòng "Vui lòng" viết hoa. Comment không tính.
- KHÔNG sửa file client (`apps/miniapp/src`, `apps/web/src`, `packages/app-core/src` trừ `terminology.spec.ts` và `DESIGN.md`): gói M1 đang viết lại chữ client. Luật quét mới bắt chỗ thật ở client thì ghi vào notes.
- KHÔNG sửa danh sách `EXEMPT` và hằng `REASON` trong `terminology.spec.ts` (M1). Chỉ thêm khối mới.
- Không đổi chữ ký public của `FlashSaleService` (gói M4 thêm endpoint ở file mới).
- Máy thiếu RAM: chỉ chạy test theo file khi làm; gate đầy đủ đúng một lần ở cuối. Không kill tiến trình không phải của mình. Không `git stash` trần. Không push. Không đọc/ghi PROD.
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh. Commit message có dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Khách Mini App cũ nhận câu "Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo…" vẫn phải mở cổng đăng nhập Zalo: câu mới còn `đăng nhập Zalo` (Task 4 ghim bằng test).
2. Câu Giờ vàng "Hết suất ưu đãi." và "Vượt giới hạn mua ưu đãi." giữ NGUYÊN chữ sau khi chuyển file (client cũ so khớp chính xác): Task 2 ghim giá trị và ghim `FlashSaleService` vẫn xuất lại các tên cũ.
3. Mock e2e và race spec khớp chữ cũ: CI đỏ ở đợt 7 vì race spec. Task 8 chạy các race spec nhắc tới chữ đổi, không chỉ jest.
4. Giá trị truy vấn (`?tab=HOT`, `&sort=hot`) và mã dính ký tự mã (`FREESHIP-${id}`, `HOT_${x}`, `${base}/HOT/${id}`) không bị bắt nhầm khi bộ quét xét từ viết thường (Task 1).
5. Mọi dòng "vui lòng" viết thường (đợt trước đếm sót 62 dòng): luật quét của Task 3 không phân biệt hoa thường nên không dòng nào lọt.

## Cấu trúc file

- Sửa `packages/app-core/src/terminology.spec.ts`: `TEMPLATE_WORD_PROSE`, `displayStrings` (Việc 4), `findHits(sources, terms?)`, khối mới "toàn bộ API" (Việc 3). Không đụng `EXEMPT`/`REASON`.
- Tạo `apps/api/src/modules/flash-sale/flash-sale-notice.ts` + `flash-sale-notice.spec.ts`; `flash-sale.service.ts` import và xuất lại (Việc 2).
- Sửa ~47 file `apps/api/src/**` (bảng ở Task 3 đến 6), spec cùng thư mục, `apps/api/test/integration-race/*.race-spec.ts`, `apps/e2e/tests/recycle-desk.miniapp.spec.ts` (mock trả câu của API).
- Sửa `DESIGN.md` (đoạn "`packages/app-core/src/terminology.spec.ts` quét chữ hiển thị…").

---

### Task 1: Bộ quét: từ cấm viết thường ở đoạn template và giá trị truy vấn (Việc 4)

**Files:**
- Modify: `packages/app-core/src/terminology.spec.ts` (hằng `TEMPLATE_WORD_PROSE` dòng 36, `displayStrings` dòng 56-80, describe đối chứng)
- Test: cùng file

**Interfaces:**
- Consumes: `FORBIDDEN_TERMS` (`./shop-copy`), `findHits(sources)`, `displayStrings(source, fileName)`.
- Produces: `displayStrings` vẫn trả `{ line: number; text: string }[]`; không đổi chữ ký. Hằng mới `QUERY_VALUE = /[?&=][^\s&#]*/g`.

- [ ] **Step 1: Viết ca đối chứng đỏ** trong `describe('findHits: mọi đoạn template (đầu, giữa, cuối) có từ hoa ASCII đứng riêng (L5 4)')` và thêm `describe('findHits: từ cấm viết thường và giá trị truy vấn trong template (M2)')`:
  - bắt (mỗi ca đúng một hit, `use` kèm theo): `` `${n} voucher` `` → `Mã giảm giá`; `` `${n} freeship` `` → `Miễn phí giao hàng`; `` `${n} flash sale` `` → `Giờ vàng`; `` `${a} · voucher ${b}` `` → `Mã giảm giá`; `` `${n} hot` `` → `bỏ chữ giục mua`.
  - không bắt: `` `/san-pham?tab=HOT` ``, `` `${base}?tab=HOT&page=${p}` ``, `` `${base}&sort=hot` ``, `` `/x?sort=hot&page=${p}` ``, `` `${base}/voucher/${id}` ``, `` `voucher-${id}` ``, `` `${a}_voucher` ``, `` `${a}-freeship` ``, `` `FREESHIP-${id}` ``, `` `HOT_${x}` ``, `` `${base}/HOT/${id}` ``, `` `${a}.voucher` ``, `` `${a}/flash sale/${b}` `` không cần (khoảng trắng trong đường dẫn không gặp); `` `https://api.tubu.vn/vouchers/${id}` ``.
  - `displayStrings`: `'const label = `${n} voucher`;'` chứa `voucher`; `` 'const u = `/x?tab=HOT&p=${p}`;' `` KHÔNG chứa chữ `HOT`.
- [ ] **Step 2: Chạy, thấy đỏ.** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → FAIL ở các ca "bắt" viết thường và ca `?tab=HOT`.
- [ ] **Step 3: Cài đặt.** `TEMPLATE_WORD_PROSE` thêm nhánh chữ thường: `/(?<![A-Za-z0-9_\-/.=])(?:[A-Z][a-z]|[A-Za-z]{2,}(?![A-Za-z0-9_\-/=]))/` (`=` thêm vào lookbehind và lookahead). Trong `displayStrings`, với `ts.isTemplateHead|Middle|Tail` thay `n.text` bằng `n.text.replace(QUERY_VALUE, ' ')` trước khi xét và trước khi `push`. Chuỗi thường và `NoSubstitutionTemplateLiteral` giữ nguyên.
- [ ] **Step 4: Chạy xanh.** Cùng lệnh; toàn bộ `terminology.spec.ts` PASS, gồm "không có chữ cấm ngoài danh sách miễn" trên cây thật.
- [ ] **Step 5: Nếu cây thật có hit mới ở client** (luật mới bắt chỗ thật): KHÔNG sửa client, KHÔNG thêm vào `EXEMPT`; ghi `file:dòng: chữ` vào notes cho người gộp, và chốt hành vi bằng ca đối chứng. Rồi commit:

```bash
git add packages/app-core/src/terminology.spec.ts
git commit -m "test(app-core): bộ quét chữ cấm xét từ viết thường ở đoạn template, bỏ giá trị truy vấn"
```

### Task 2: Tách câu khách đọc của Giờ vàng ra `flash-sale-notice.ts` (Việc 2)

**Files:**
- Create: `apps/api/src/modules/flash-sale/flash-sale-notice.ts`, `apps/api/src/modules/flash-sale/flash-sale-notice.spec.ts`
- Modify: `apps/api/src/modules/flash-sale/flash-sale.service.ts` (dòng 27-31, 358, 828-829)

**Interfaces:**
- Produces (từ `flash-sale-notice.ts`, mọi tên giữ nguyên chữ):

```ts
export const FLASH_SOLD_OUT_MSG: string;           // 'Hết suất ưu đãi.'
export const FLASH_OVER_LIMIT_MSG: string;         // 'Vượt giới hạn mua ưu đãi.'
export const FLASH_LIMIT: string;                  // 'FLASH_LIMIT'
export const flashOverLimitMessage: (n: number) => string;
export const FLASH_ALREADY_STARTED_MSG: string;    // 'Ưu đãi đã bắt đầu.'
export const FLASH_SLOT_NOT_FOUND_MSG: string;     // 'Không tìm thấy khung Giờ vàng.'
export const FLASH_ITEM_NOT_FOUND_MSG: string;     // 'Không tìm thấy sản phẩm Giờ vàng.'
```

- `flash-sale.service.ts` import các tên trên và xuất lại: `export { FLASH_SOLD_OUT_MSG, FLASH_OVER_LIMIT_MSG, FLASH_LIMIT, flashOverLimitMessage, FLASH_ALREADY_STARTED_MSG } from './flash-sale-notice';` để mọi chỗ `import … from './flash-sale.service'` còn chạy. Chữ quản trị (`FLASH_START_LOCKED_MSG`, `FLASH_ITEM_CLASH_MSG`, `FLASH_ADMIN_SALE_MSG`, "Đợt flash sale …") ở lại service.

- [ ] **Step 1: Viết `flash-sale-notice.spec.ts` đỏ:** import từ `./flash-sale-notice` (file chưa có); ghim từng giá trị chữ ở trên (client cũ so khớp `'Hết suất ưu đãi.'` và `'Vượt giới hạn mua ưu đãi.'`), `flashOverLimitMessage(2)` bằng `'Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.'`; một ca import cả hai đường (`./flash-sale.service` và `./flash-sale-notice`) và `expect(a.FLASH_SOLD_OUT_MSG).toBe(b.FLASH_SOLD_OUT_MSG)` cho năm tên xuất lại; một ca đọc `flash-sale-notice.ts` qua `fs` kiểm không chứa `flash sale`/`Flash sale`/`Freeship` (tự chứng là file chữ sạch thuật ngữ).
- [ ] **Step 2: Chạy:** `cd apps/api && npx jest src/modules/flash-sale/flash-sale-notice.spec.ts` → FAIL "Cannot find module './flash-sale-notice'".
- [ ] **Step 3: Tạo `flash-sale-notice.ts`**, thay hai chuỗi inline ở service bằng `FLASH_SLOT_NOT_FOUND_MSG` / `FLASH_ITEM_NOT_FOUND_MSG`, xoá bản định nghĩa cũ và xuất lại như Interfaces. Không đổi chữ ký `FlashSaleService`.
- [ ] **Step 4: Chạy xanh:** `npx jest src/modules/flash-sale src/modules/checkout/checkout.service.spec.ts src/modules/affiliate/affiliate.service.spec.ts` → PASS; `npx tsc --noEmit -p apps/api/tsconfig.json` sạch.
- [ ] **Step 5: Commit** `refactor(flash-sale): tách câu khách đọc ra flash-sale-notice.ts để bộ quét chữ tự quét`.

### Task 3: Luật quét "Vui lòng"/"chúng tôi" toàn API, đỏ trước (Việc 3)

**Files:**
- Modify: `packages/app-core/src/terminology.spec.ts` (thêm khối mới sau describe "file chữ khách đọc của API")

**Interfaces:**
- `findHits(sources, terms = FORBIDDEN_TERMS)`: tham số `terms` thêm có mặc định.
- `API_SRC = 'apps/api/src'`; `loadApiSources(): { file: string; text: string }[]` đọc mọi `*.ts` dưới `API_SRC` trừ `*.spec.ts`, KHÔNG áp `NOT_SCANNED` cho thư mục `admin/` (chữ quản trị của API cũng đổi). `API_VOICE = FORBIDDEN_TERMS.filter((t) => t.use === 'Bạn hoặc Tubu')`.
- `API_VOICE_EXEMPT: { file: string; max: number; reason: string }[] = []`: chỗ dành cho văn bản pháp lý nếu có trong API, mỗi dòng có lý do và `max` bằng đúng số chỗ.

- [ ] **Step 1: Viết test.** Describe `chữ "Vui lòng" và "chúng tôi" trong toàn bộ API (M2)`:
  - ca đối chứng nguồn giả: `findHits([{ file: 'apps/api/src/common/x.ts', text: "export const m = 'Vui lòng thử lại';" }], API_VOICE)` ra đúng một hit `Bạn hoặc Tubu`; `'… vui lòng …'` viết thường cũng bắt; `'… chúng tôi …'` bắt; `` `${n} sản phẩm, vui lòng chọn lại` `` bắt; `file: 'apps/api/src/modules/admin/x.ts'` vẫn bắt.
  - ca cây thật: `loadApiSources()` có hơn 300 file, có `apps/api/src/modules/checkout/checkout.service.ts` và `apps/api/src/modules/admin/admin.service.ts`, không có file `.spec.ts`; hits ngoài `API_VOICE_EXEMPT` bằng `[]`; mỗi dòng `API_VOICE_EXEMPT` có lý do >10 ký tự, trỏ file có thật, `max` bằng đúng số chỗ hiện có (không hơn, không kém).
- [ ] **Step 2: Chạy, thấy đỏ:** `cd packages/app-core && npx vitest run src/terminology.spec.ts -t "toàn bộ API"` → FAIL, liệt kê các `file:dòng` còn "Vui lòng" (khoảng 112). Ghi số hit đầu và cuối vào PROGRESS của commit.
- [ ] **Step 3: Cài `findHits` có `terms`, `loadApiSources`, `API_VOICE_EXEMPT` rỗng.** Giữ test đỏ, chưa commit: commit cùng Task 7 khi xanh.

### Task 4: Viết lại chữ API, nhóm nền (auth, phiên, hệ thống bận, tài khoản, shop nhỏ)

**Files (nguồn, rồi spec cùng thư mục):** `common/real-user.ts`, `common/lock-busy.ts`, `common/guards/jwt-auth.guard.ts`, `common/filters/prisma-exception.filter.ts`, `modules/auth/auth.service.ts`, `modules/auth/zalo.service.ts`, `modules/storefront/identifier-validation.ts`, `modules/storefront/storefront.service.ts`, `modules/coupons/coupons.service.ts`, `modules/coupons/coupon-claim.service.ts`, `modules/users/users.service.ts`, `modules/users/dto/address.dto.ts`, `modules/game/game.service.ts`, `modules/game/game-garden.service.ts`, `modules/reviews/reviews.service.ts`, `modules/merchant/merchant.service.ts`, `modules/ops/ops-email.ts`, `modules/staff/shifts/shifts.service.ts`, `modules/staff/attendance/attendance.controller.ts`, `modules/staff/attendance/attendance.service.ts`, `modules/external-points/external-claim.service.ts`, `modules/admin/admin-coupon-batch.service.ts`, `modules/admin/admin.service.ts`

**Quy tắc đổi (áp cho mọi task 4 đến 6):**
1. `Vui lòng <việc>.` đầu câu → `Bạn <việc> nhé.`; việc nhập liệu/ghi chú cho người xử lý → `Nhập …`, `Ghi …`, `Xem lại …` (mệnh lệnh ngắn, không "Bạn").
2. `, vui lòng <việc>.` hoặc `— vui lòng <việc>.` → `, bạn <việc> nhé.` / `— bạn <việc> nhé.`; chuỗi không có dấu chấm cuối (`PANCAKE_*`, `RETRY`, `STALE_REQUEST`) → bỏ "nhé", giữ nguyên không dấu chấm.
3. Mệnh đề đầu câu, số liệu `${…}` và thứ tự câu giữ nguyên.
4. `ops-email.ts`: `vui lòng không trả lời` → `không cần trả lời`.

**Interfaces:** Consumes: không. Produces: các chuỗi mới; `real-user.ts` giữ cụm `đăng nhập Zalo`.

- [ ] **Step 1: Test đỏ.** Sửa trước các `expect(...)` trong spec cùng thư mục sang chữ mới (jwt-auth.guard.spec, zalo.service.spec, storefront.service.spec ×2, identifier-validation.spec, coupons.service.spec, shifts.service.spec, waste-customer.controller.spec dòng 88). Thêm ghim tương thích client vào `common/real-user.spec.ts` (tạo nếu chưa có): thông điệp khách vãng lai khớp `/đăng nhập Zalo/i`.
- [ ] **Step 2: Chạy đỏ:** `cd apps/api && npx jest <các spec trên>` → FAIL ở đúng các câu vừa sửa.
- [ ] **Step 3: Đổi chữ nguồn theo quy tắc.** Dùng script thay thế theo bảng cặp (chuỗi cũ → mới) cho nguồn, spec, race spec, e2e một lượt; xem `git diff` từng file.
- [ ] **Step 4: Xanh:** cùng lệnh PASS; `perl`/`grep` không còn "vui lòng" (không phân biệt hoa thường, bỏ comment) trong các file nhóm này.
- [ ] **Step 5: Commit** `refactor(api): bỏ "Vui lòng" khỏi chữ lỗi nhóm nền (auth, phiên, hệ thống bận)`.

### Task 5: Viết lại chữ API, nhóm đặt đơn và giá

**Files:** `modules/checkout/checkout.service.ts`, `checkout-split.ts`, `total-changed.ts`, `modules/pricing/pricing.service.ts`, `modules/cart/sellable.ts`, `modules/subscriptions/subscriptions.service.ts`, `modules/integrations/pancake/address-geo.ts`, `modules/integrations/pancake/geo.service.ts` và spec cùng thư mục (`checkout.service.spec`, `checkout-split.spec`, `affiliate.service.spec` dòng 921, `order-error-classifier.spec`), race spec `r6-checkout`, `r13-checkout-partner-flag`, `d2-dealer-revoke-partner`.

- [ ] **Step 1:** sửa expect trong spec và race spec sang chữ mới; giữ `order-error-classifier.spec` đúng loại lỗi (`ADDRESS_INVALID`, `BALANCE`).
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/checkout src/modules/pricing src/modules/cart src/modules/subscriptions src/modules/analytics src/modules/integrations/pancake` → FAIL.
- [ ] **Step 3:** đổi nguồn theo quy tắc Task 4. Đuôi `Vui lòng tải lại trang thanh toán.` → `Bạn tải lại trang thanh toán nhé.` Cập nhật comment `checkout.service.ts:824` trích câu cũ.
- [ ] **Step 4:** cùng lệnh PASS.
- [ ] **Step 5: Commit** `refactor(api): bỏ "Vui lòng" khỏi chữ lỗi đặt đơn, giá và địa chỉ`.

### Task 6: Viết lại chữ API, nhóm đơn hàng, hoàn tiền, đại lý, CTV, rác

**Files:** `modules/orders/orders.service.ts`, `order-returns.service.ts`, `customer-refunds.service.ts`, `refund-destination.ts`, `order-status.service.ts`, `order-reversal.service.ts`, `modules/integrations/pancake/pancake-sync-hooks.ts`, `modules/integrations/payment/zalopay.service.ts`, `modules/dealer/dealer.service.ts`, `modules/affiliate/affiliate.service.ts`, `modules/waste-exchange/core/waste-messages.ts`, `waste-exchange/receiving/{waste-confirm,waste-confirm-lines,waste-receive,waste-reverse,waste-admin-requests}.service.ts` (hoặc `-lines.ts`) và spec cùng thư mục; race spec `r9-ctv-checkout`, `r9-sync-blocked-cancel`, `pancake-cancel-unreachable`, `waste-confirm`, `waste-cross-lane`; mock e2e `apps/e2e/tests/recycle-desk.miniapp.spec.ts` (câu trả 409 và `getByText`); đổi tên ca `waste-requests.service.spec.ts:189` ("409 Vui lòng thử lại").

- [ ] **Step 1:** sửa expect ở spec, race spec, mock e2e sang chữ mới. Mệnh đề đầu của `customer-refunds.service.ts` giữ để `STALE_PATTERN` của web còn khớp.
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/orders src/modules/dealer src/modules/affiliate src/modules/waste-exchange src/modules/integrations src/modules/staff` → FAIL.
- [ ] **Step 3:** đổi nguồn theo quy tắc Task 4.
- [ ] **Step 4:** cùng lệnh PASS.
- [ ] **Step 5: Commit** `refactor(api): bỏ "Vui lòng" khỏi chữ lỗi đơn hàng, hoàn tiền, đại lý, CTV và đổi rác`.

### Task 7: Luật toàn API xanh và chốt

- [ ] **Step 1:** `cd packages/app-core && npx vitest run src/terminology.spec.ts` → toàn bộ PASS (luật Task 3 từ đỏ sang xanh, `API_VOICE_EXEMPT` vẫn rỗng). Quét độc lập: không còn `vui lòng`/`chúng tôi` ngoài comment và spec trong `apps/api/src` (perl với `-CSD` và `(?i)`).
- [ ] **Step 2:** Commit luật + ca đối chứng: `test(app-core): lưới chữ "Vui lòng"/"chúng tôi" quét mọi file API`.

### Task 8: `DESIGN.md`, race spec và gate

**Files:** `DESIGN.md` (đoạn dòng 192 "`packages/app-core/src/terminology.spec.ts` quét chữ hiển thị…")

- [ ] **Step 1:** Sửa đoạn mô tả: bỏ câu "service lớn lẫn chữ quản trị và log như `flash-sale.service.ts` không quét cả file, nên câu khách đọc ở đó phải tự giữ đúng thuật ngữ" và thay bằng việc câu khách đọc của Giờ vàng nằm ở `flash-sale-notice.ts`; thêm luật "Vui lòng"/"chúng tôi" quét mọi file `apps/api/src/**/*.ts` trừ `*.spec.ts` (không phân biệt hoa thường, kể cả `admin/`, văn bản pháp lý miễn bằng `API_VOICE_EXEMPT` có lý do + `max`); thêm hai thay đổi Việc 4 (đoạn template xét cả từ viết thường như `${n} voucher`; giá trị truy vấn `?tab=HOT`, `&sort=hot` không phải chữ khách đọc). Thêm một dòng vào bảng nhật ký thay đổi cuối file.
- [ ] **Step 2:** Race spec có khớp chữ đã đổi, với DB riêng: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25591`, tạo DB `tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25591/tubutree_it`, trong `apps/api`: `npx prisma migrate deploy` rồi `npx jest -c test/integration-race/jest.config.js --runInBand <các file race của Task 5, 6 và flash-slot-last-unit, p3-don-flash-cart>` → PASS.
- [ ] **Step 3:** Gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 173de56b3 --out .claude/worktrees/gate-M2.txt`. Bước FAIL: chạy lại ở base (worktree tạm) hoặc so log; FAIL có sẵn từ base ghi "có sẵn", do gói gây ra thì sửa tới PASS.
- [ ] **Step 4:** `pg-native.sh stop 25591`. Commit `docs(design): mô tả lưới chữ API và hai sửa bộ quét (M2)`.

## Tự rà

- Việc 1 → Task 4-6 (+ race/e2e ở đó); Việc 2 → Task 2; Việc 3 → Task 3 + 7; Việc 4 → Task 1; DESIGN.md → Task 8; kiểm → Task 8.
- Tên nhất quán: `API_VOICE`, `API_VOICE_EXEMPT`, `loadApiSources`, `QUERY_VALUE`, `FLASH_SLOT_NOT_FOUND_MSG`, `FLASH_ITEM_NOT_FOUND_MSG`.
