# P3b `cart-storefront-api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API giỏ + gian hàng cho đợt nâng cấp gian hàng: `CartLine.listUnitPrice`, `POST /cart/items/batch` (một transaction, hỏng một món thì không ghi món nào), kẹp `comboDiscountPct`, `ownerTier.publicBadge`, `/flash-sales/upcoming` công khai.

**Architecture:** Mọi thay đổi nằm trong `apps/api/src/modules/{cart,storefront,affiliate,flash-sale}` cộng `packages/app-core/src/api/{cart,flash-sale}.ts`. Không đổi `schema.prisma`: `listUnitPrice` và `publicBadge` là trường tính. Batch giỏ khoá dòng `carts` của khách (`FOR NO KEY UPDATE`, cùng khoá `lockForCheckout`) rồi đọc hàng, kiểm tồn, `upsert increment` trong cùng transaction, nên hai batch song song của một khách xếp hàng sau nhau và kiểm tồn thấy số lượng của batch trước.

**Tech Stack:** NestJS, Prisma/Postgres, class-validator, jest (unit + `test/integration-race` trên Postgres thật), vitest (app-core).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q9, Q12 và mục "Giỏ", "Khung trang shop"); `docs/2026-10-31-shop-redesign/02-ke-hoach.md` mục P3b + bảng API ở "Giao diện dùng chung"; nguồn `review/backend-gap.md` §4 (thiếu 5, 6), BG-8, BG-9; `review/critique-store.md` Q1; `review/critique-shop.md` CT-02.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; `npx prisma generate` chạy trong `apps/api`.
- Không sửa `apps/api/prisma/schema.prisma` (P3a giữ). Không file thuộc P1/P2/P3a (catalog/brand/category, `api/catalog.ts`, `api/brand.ts`, `commerce/**`, UI).
- Đường tiền: thứ tự giảm Giờ vàng → combo → mã → hạng → điểm, chia về `OrderItem.paidTotal`; batch không mở đường giá thứ hai: giá giỏ vẫn do `priceCart` tính.
- Lỗi cho khách: `BadRequestException` kèm câu tiếng Việt; mã ổn định cho FE ở trường `code` (mẫu `TOTAL_CHANGED`).
- Chữ theo `review/ux-copy.md` B: "{tên} chỉ còn {n} sản phẩm." / "{tên} đã hết hàng." Không "Freeship", "Top", "Kho voucher".
- Route công khai: `@Public()`; route theo khách `private, no-store` (`HomeController.me`). `OptionalJwtAuthGuard` cho route công khai cần biết người xem.
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ comment của file xung quanh. Commit nhỏ, cuối message `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Không deploy, không đọc/ghi PROD, không push.

## Review Focus

1. Batch có cùng `variationId` hai lần (hoặc dòng đã có trong giỏ): tồn kho tính trên tổng (đang có + tất cả dòng batch), lỗi chỉ ra đúng `variationId`, giỏ không đổi. Test: Task 2 (`gộp dòng trùng`, `tính cả số đang có trong giỏ`).
2. Hai batch song song của một khách trên món còn 3 tồn (mỗi batch +2): đúng một batch thành công, batch kia lỗi `STOCK` và không ghi dòng nào khác của nó. Test: Task 8 race `batch song song`.
3. Giỏ chưa có dòng `carts` (khách mới) gọi batch: tạo giỏ rồi thêm, không 500. Test: Task 2 (`giỏ chưa tồn tại`) + Task 8.
4. `listUnitPrice` khi không có sale/Giờ vàng phải bằng `unitPrice` (FE không vẽ giá gạch), khi có Giờ vàng hoặc `salePrice` thì bằng `retailPrice`. Test: Task 1.
5. `comboDiscountPct` null/0/dưới trần giữ nguyên, combo không còn sống vẫn null, thiếu cấu hình dùng mặc định 30; bậc thấp nhất không bật `publicBadge`; token hỏng/hết hạn ở `/flash-sales/upcoming` coi như khách (không 401). Test: Task 5, 6, 7.

---

## File Structure

| File | Việc |
|---|---|
| `apps/api/src/modules/cart/cart.service.ts` | `listUnitPrice` trong `priceCart`; `addItemsBatch` + `BatchRejection` |
| `apps/api/src/modules/cart/cart.batch-error.ts` (mới) | `CART_BATCH_REJECTED`, `cartBatchRejected(...)`: dựng `BadRequestException` có `code/reason/variationId` |
| `apps/api/src/modules/cart/dto/cart.dto.ts` | `AddItemsBatchDto`, `BatchItemDto` |
| `apps/api/src/modules/cart/cart.controller.ts` | `POST items/batch` |
| `apps/api/src/modules/storefront/storefront.service.ts` | kẹp `comboDiscountPct` trong `getPublicBySlug` |
| `apps/api/src/modules/affiliate/affiliate.service.ts` | `getPublicTier` thêm `publicBadge` |
| `apps/api/src/modules/flash-sale/flash-sale.controller.ts` + `flash-sale.service.ts` | `/upcoming` công khai, `userId?` |
| `apps/api/src/common/decorators/public-cache.decorator.spec.ts` | cập nhật ca `upcoming` (vẫn không public cache, nay là `private, no-store`) |
| `packages/app-core/src/api/cart.ts` (+ `.spec.ts`) | `CartLine.listUnitPrice`, `addCartItemsBatch`, `CART_BATCH_REJECTED` |
| `packages/app-core/src/api/flash-sale.ts` | chỉ chú thích: `fetchUpcomingFlashSales` không cần phiên |
| `apps/api/test/integration-race/cart-batch.race-spec.ts` (mới) | race batch + upcoming trên Postgres thật |

---

### Task 1: `CartLine.listUnitPrice` ở API

**Files:**
- Modify: `apps/api/src/modules/cart/cart.service.ts` (hàm `priceCart`, khối `lines`)
- Test: `apps/api/src/modules/cart/cart.service.spec.ts`

**Interfaces:**
- Produces: mỗi phần tử `items[]` của `getCart`/`getCartSelection`/`getCartForCheckout` có `listUnitPrice: number` = `variation.retailPrice` (giá niêm yết trước `salePrice` và Giờ vàng). Báo giá checkout spread `items` nên cũng mang trường này (vô hại).

- [ ] **Step 1: Viết test đỏ** trong `describe('CartService guard tồn kho')` (dùng mẫu dòng giỏ của test `getCart: dòng SP ngừng bán…`): `it('getCart: listUnitPrice = giá niêm yết; bằng unitPrice khi không giảm, cao hơn khi có salePrice hoặc Giờ vàng')`. Ba dòng: (a) `retailPrice 50000, salePrice null`, không flash → `unitPrice 50000`, `listUnitPrice 50000`; (b) `retailPrice 50000, salePrice 42000` → `unitPrice 42000`, `listUnitPrice 50000`; (c) `retailPrice 50000`, `flashMap` có `{ variationId, flashPrice: 33000, quota 10, soldCount 1, perUserLimit 5, endAt, itemId }` → `unitPrice 33000`, `listUnitPrice 50000`. Lấy hình dạng entry của `resolveEffective` từ test ENGAGE-4 cùng file.
- [ ] **Step 2: Chạy, thấy FAIL** (`listUnitPrice` undefined): `cd apps/api && npx jest src/modules/cart/cart.service.spec.ts -t listUnitPrice`
- [ ] **Step 3: Cài đặt:** thêm `listUnitPrice: it.variation.retailPrice` vào object dòng trong `priceCart`, đặt cạnh `unitPrice`, kèm một comment "vì sao" (FE gạch giá và tính "Tiết kiệm"; `unitPrice` đã là giá sau sale/Giờ vàng).
- [ ] **Step 4: Chạy lại cả `cart.service.spec.ts` và `src/modules/checkout`** (spec checkout có thể so `items` bằng `toEqual`): `npx jest src/modules/cart src/modules/checkout`. Mong đợi PASS; spec nào so đúng hình dòng thì thêm `listUnitPrice` vào kỳ vọng.
- [ ] **Step 5: Commit** `feat(api): giỏ trả listUnitPrice (giá niêm yết) cho dòng`

---

### Task 2: `CartService.addItemsBatch` (một transaction, hỏng một món thì không ghi món nào)

**Files:**
- Create: `apps/api/src/modules/cart/cart.batch-error.ts`
- Modify: `apps/api/src/modules/cart/cart.service.ts`
- Test: `apps/api/src/modules/cart/cart.service.spec.ts` (describe mới `CartService.addItemsBatch`, dựng `setup` như `CartService.addItems`)

**Interfaces:**
- Consumes: `ADD_ITEM_INCLUDE`, `assertSellable`, `assertStock`, `ensureCart`, `analytics.recordMany`, `getCart` (đều có sẵn).
- Produces:
  ```ts
  // cart.batch-error.ts
  export const CART_BATCH_REJECTED = 'CART_BATCH_REJECTED';
  export type CartBatchReason = 'UNAVAILABLE' | 'STOCK';
  export function cartBatchRejected(i: { reason: CartBatchReason; variationId: string; productName: string | null; message: string }): BadRequestException;
  // thân lỗi: { statusCode: 400, error: 'Bad Request', code: CART_BATCH_REJECTED, reason, variationId, productName, message }
  // cart.service.ts
  async addItemsBatch(userId: string, lines: { variationId: string; quantity: number }[], addSource: string | undefined, storefrontSlug?: string): ReturnType<CartService['getCart']>
  ```
  Hành vi: gộp dòng trùng `variationId` (cộng số lượng, giữ thứ tự đến lần đầu); `ensureCart`; trong MỘT `$transaction`: `SELECT "id" FROM "carts" WHERE "id" = ${cartId} FOR NO KEY UPDATE`, đọc `variation.findMany` (ADD_ITEM_INCLUDE) và `cartItem.findMany` của các id, kiểm từng dòng theo thứ tự đến (không bán được → `UNAVAILABLE`, vượt tồn tính cả số đang có → `STOCK`); dòng đầu tiên hỏng thì ném `cartBatchRejected` (transaction chưa ghi gì); đạt hết thì `upsert increment` theo thứ tự `variationId` tăng dần + `analytics.recordMany` (`addSource ?? 'pdp'`), rồi ngoài transaction `return this.getCart(userId, storefrontSlug)`. Chữ lỗi: STOCK còn hàng → `"{tên} chỉ còn {stock} sản phẩm. Chưa có món nào được thêm vào giỏ."`, stock 0 → `"{tên} đã hết hàng. Chưa có món nào được thêm vào giỏ."`; UNAVAILABLE → lời của `assertSellable` (đã nêu tên gian hàng nếu tạm nghỉ) cộng "Chưa có món nào được thêm vào giỏ."; không tìm thấy variation → `productName: null`, "Sản phẩm không khả dụng. Chưa có món nào được thêm vào giỏ."

- [ ] **Step 1: Viết test đỏ** (mock prisma như `addItems`, thêm `tx.$queryRaw` và `tx.variation.findMany`/`tx.cartItem.findMany`):
  - `3 dòng đạt → một transaction, khoá carts trước, 3 upsert increment theo thứ tự variationId, một recordMany, rồi getCart`
  - `một món hết hàng → ném lỗi code CART_BATCH_REJECTED, reason STOCK, variationId đúng, tx.cartItem.upsert KHÔNG được gọi, analytics không ghi`
  - `món không bán được / không tồn tại → reason UNAVAILABLE`
  - `gộp dòng trùng: [v1×2, v1×2] với tồn 3 → STOCK (tính trên tổng 4)`
  - `tính cả số đang có trong giỏ: giỏ có v1×2, tồn 3, thêm 2 → STOCK`
  - `giỏ chưa tồn tại: ensureCart (cart.upsert) chạy trước transaction`
  - `không gửi addSource → props.addSource = 'pdp'`
  - Review Focus 1, 3.
- [ ] **Step 2: Chạy, thấy FAIL** (`addItemsBatch is not a function`): `npx jest src/modules/cart/cart.service.spec.ts -t addItemsBatch`
- [ ] **Step 3: Cài đặt** `cart.batch-error.ts` rồi `addItemsBatch` theo "Hành vi" ở trên. Không tái dùng `addItems` (nó cố ý bỏ qua dòng hỏng và đọc ngoài transaction).
- [ ] **Step 4: Chạy lại** `npx jest src/modules/cart` → PASS.
- [ ] **Step 5: Commit** `feat(api): addItemsBatch, thêm nhiều món vào giỏ trong một transaction`

---

### Task 3: `POST /cart/items/batch`

**Files:**
- Modify: `apps/api/src/modules/cart/dto/cart.dto.ts`, `apps/api/src/modules/cart/cart.controller.ts`
- Test: `apps/api/src/modules/cart/cart.controller.spec.ts` (+ ca DTO trong cùng file, dùng `createValidationPipe()` từ `common/validation-pipe`)

**Interfaces:**
- Produces:
  ```ts
  export class BatchItemDto { variationId: string; quantity: number /* int 1..999 */ }
  export class AddItemsBatchDto { items: BatchItemDto[] /* 1..20 */; addSource?: string /* cùng IsIn với AddItemDto */ }
  // controller
  @Post('items/batch') addItemsBatch(@CurrentUser('sub') userId, @Body() dto: AddItemsBatchDto, @Query() q: CartQueryDto) // → toPublicCart(await cart.addItemsBatch(userId, dto.items, dto.addSource, q.storefrontSlug))
  ```
  Khai báo trước `@Post('items')`? Không cần (đường dẫn khác nhau), nhưng đặt ngay dưới `addItem`.

- [ ] **Step 1: Viết test đỏ:** (a) controller chuyển `dto.items`, `dto.addSource`, `q.storefrontSlug` cho `addItemsBatch` và trả giỏ đã `toPublicCart` (không lộ `ownerUserId`, như ca R2-MERCHANT-14); (b) `ValidationPipe` từ chối: `items` rỗng, 21 phần tử, `quantity: 0`, `quantity: 1000`, `variationId` thiếu, trường lạ trong phần tử, `addSource` ngoài danh sách; chấp nhận 1 và 20 phần tử.
- [ ] **Step 2: Chạy, thấy FAIL:** `npx jest src/modules/cart/cart.controller.spec.ts`
- [ ] **Step 3: Cài đặt** DTO (`@ValidateNested({ each: true }) @Type(() => BatchItemDto) @ArrayMinSize(1) @ArrayMaxSize(20)`) và route.
- [ ] **Step 4: Chạy lại** `npx jest src/modules/cart` → PASS.
- [ ] **Step 5: Commit** `feat(api): POST /cart/items/batch`

---

### Task 4: app-core `listUnitPrice` + `addCartItemsBatch`

**Files:**
- Modify: `packages/app-core/src/api/cart.ts`
- Test: `packages/app-core/src/api/cart.spec.ts`

**Interfaces:**
- Produces (giữ đúng tên ở bảng "Giao diện dùng chung"):
  ```ts
  // CartLine: listUnitPrice?: number  (tuỳ chọn như các trường mới khác của file: API cũ chưa trả; fixture của app không vỡ tsc)
  export const CART_BATCH_REJECTED = 'CART_BATCH_REJECTED';
  export const addCartItemsBatch = (http: HttpClient, items: { variationId: string; quantity: number }[], addSource: AddToCartSource, storefrontSlug?: string | null) => Promise<CartSummary>;
  // POST /cart/items/batch, body { items, addSource }, query storefrontSlug khi có (cartOpts)
  ```

- [ ] **Step 1: Viết test đỏ** trong `cart.spec.ts`: không slug → `{ method: 'post', path: '/cart/items/batch', body: { items: [{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 2 }], addSource: 'pdp' } }`; có slug → thêm `opts: { query: { storefrontSlug: 'ctv-a' } }`; `CART_BATCH_REJECTED === 'CART_BATCH_REJECTED'`.
- [ ] **Step 2: Chạy, thấy FAIL:** `cd packages/app-core && npx vitest run src/api/cart.spec.ts`
- [ ] **Step 3: Cài đặt** trong `cart.ts`, kèm `listUnitPrice?: number` có chú thích (giá niêm yết trước sale/Giờ vàng; có và lớn hơn `unitPrice` thì dòng đang giảm).
- [ ] **Step 4: Chạy lại** `npx vitest run src/api` và `npx tsc --noEmit` trong `packages/app-core` → PASS.
- [ ] **Step 5: Commit** `feat(app-core): addCartItemsBatch + CartLine.listUnitPrice`

---

### Task 5: kẹp `comboDiscountPct` trang gian hàng

**Files:**
- Modify: `apps/api/src/modules/storefront/storefront.service.ts` (`getPublicBySlug`, khối `collections`)
- Test: `apps/api/src/modules/storefront/storefront.service.spec.ts`

**Interfaces:**
- Produces: `collections[].comboDiscountPct` = `Math.min(pct, storefront.max_combo_pct)` khi không null (cấu hình mặc định 30, đọc một lần cho cả trang), `null` giữ `null`. Cùng công thức với `combo.service.ts:108-111` để trang không hứa hơn số tiền thật được trừ.

- [ ] **Step 1: Viết test đỏ** (mẫu `makePrisma` + `config` của file): cấu hình `storefront.max_combo_pct = 20`, bộ sưu tập COMBO `comboDiscountPct: 45` với 2 sản phẩm khác nhau → `20`; `12` → `12`; combo chỉ còn 1 sản phẩm (không sống) → `null`; bộ sưu tập thường `comboDiscountPct: null` → `null`; không cấu hình (mock trả mặc định) → trần 30. Review Focus 5.
- [ ] **Step 2: Chạy, thấy FAIL:** `npx jest src/modules/storefront/storefront.service.spec.ts -t comboDiscountPct`
- [ ] **Step 3: Cài đặt:** đọc `await this.config.get<number>('storefront.max_combo_pct', 30)` một lần trước `collections.map`; áp `Math.min` cho giá trị không null. Comment: dữ liệu ghi trước khi có trần vẫn bị checkout kẹp.
- [ ] **Step 4: Chạy lại** `npx jest src/modules/storefront` → PASS.
- [ ] **Step 5: Commit** `fix(api): trang gian hàng kẹp % combo theo storefront.max_combo_pct`

---

### Task 6: `ownerTier.publicBadge`

**Files:**
- Modify: `apps/api/src/modules/affiliate/affiliate.service.ts` (`getPublicTier`), `apps/api/src/modules/storefront/storefront.service.ts` (chỉ nếu cần chuyển nguyên đối tượng; hiện `ownerTier` được trả nguyên)
- Test: `apps/api/src/modules/affiliate/affiliate.service.spec.ts` (`describe('AffiliateService.getPublicTier')`), `storefront.service.spec.ts`

**Interfaces:**
- Produces: `getPublicTier(userId, now?) → { name: string; emoji: string; publicBadge: boolean }`; `publicBadge = tier.name !== CTV_TIERS[0].name` (ẩn bậc thấp nhất, §4 Q9). `Storefront.ownerTier` giữ `null` cho MERCHANT/BRAND/mẫu. Chỉ thêm một cờ boolean, vẫn không lộ doanh số.

- [ ] **Step 1: Viết test đỏ:** doanh số 15.000.000 → `{ name: 'Bạc', emoji: '🌳', publicBadge: true }`; `null` doanh số → `Tân binh` với `publicBadge: false`; 3.000.000 (Đồng, bậc 2) → `publicBadge: true` (ngưỡng đúng ở biên); ca cũ `Object.keys(t)` đổi thành `['name','emoji','publicBadge']`. Trong spec storefront: mock `getPublicTier` trả `publicBadge: false` thì `ownerTier.publicBadge === false` đi qua nguyên vẹn.
- [ ] **Step 2: Chạy, thấy FAIL:** `npx jest src/modules/affiliate/affiliate.service.spec.ts -t getPublicTier`
- [ ] **Step 3: Cài đặt** trong `getPublicTier`; import `CTV_TIERS` từ `./ctv-milestones` (file đã import `tierForRevenue` từ đó). Cập nhật comment của hàm.
- [ ] **Step 4: Chạy lại** `npx jest src/modules/affiliate src/modules/storefront` → PASS. (Mini/web hiện vẫn vẽ mọi `ownerTier` không null; P9 đọc `publicBadge`.)
- [ ] **Step 5: Commit** `feat(api): ownerTier.publicBadge, ẩn bậc thấp nhất với khách`

---

### Task 7: `/flash-sales/upcoming` công khai

**Files:**
- Modify: `apps/api/src/modules/flash-sale/flash-sale.controller.ts`, `apps/api/src/modules/flash-sale/flash-sale.service.ts` (`listUpcoming`), `packages/app-core/src/api/flash-sale.ts` (chỉ chú thích)
- Test: `apps/api/src/modules/flash-sale/flash-sale.service.spec.ts`, `apps/api/src/modules/flash-sale/flash-sale.controller.spec.ts` (mới), `apps/api/src/common/decorators/public-cache.decorator.spec.ts`

**Interfaces:**
- Produces: `GET /flash-sales/upcoming` có `@Public() @UseGuards(OptionalJwtAuthGuard) @Header('Cache-Control', 'private, no-store')`, tham số `@CurrentUser('sub') userId?: string`. `listUpcoming(userId?: string, now?: Date)`: không `userId` thì không truy vấn `reminders` và mọi dòng `reminded: false`. Hình dạng dòng không đổi. Hai route `remind` giữ JWT bắt buộc.

- [ ] **Step 1: Viết test đỏ:** (a) service: `listUpcoming(undefined)` → `findMany` được gọi với `include.reminders` vắng (không truy vấn nhắc), mọi dòng `reminded === false`; có `userId` + một nhắc → `reminded: true` (ca cũ giữ nguyên); (b) controller metadata: `IS_PUBLIC_KEY` true trên `upcoming`, `GUARDS_METADATA` chứa `OptionalJwtAuthGuard`, `Cache-Control` là `private, no-store`; `remind` và `cancelRemind` KHÔNG public; (c) sửa ca `public-cache.decorator.spec.ts` "endpoint theo user KHÔNG được public cache": `upcoming` nay `toBe('private, no-store')` và là public. Review Focus 5 (token hỏng thành khách) được `OptionalJwtAuthGuard` bảo đảm, đã có `optional-jwt-auth.guard.spec.ts`; không viết lại.
- [ ] **Step 2: Chạy, thấy FAIL:** `npx jest src/modules/flash-sale src/common/decorators/public-cache.decorator.spec.ts`
- [ ] **Step 3: Cài đặt** controller + service (`include` có điều kiện theo `userId`). Chú thích `fetchUpcomingFlashSales` trong app-core: không cần phiên, có phiên thì `reminded` theo khách.
- [ ] **Step 4: Chạy lại** các spec trên + `npx jest src/common` → PASS.
- [ ] **Step 5: Commit** `feat(api): /flash-sales/upcoming công khai, reminded=false khi chưa đăng nhập`

---

### Task 8: race spec trên Postgres thật

**Files:**
- Create: `apps/api/test/integration-race/cart-batch.race-spec.ts` (dựng module như `cart-combo-equals-quote.race-spec.ts`; dùng `createUser`, `randCode`, `warmPool` từ `./helpers`)

**Interfaces:**
- Consumes: `CartService.addItemsBatch`, `CartService.updateItem`, `CartService.getCart`, `FlashSaleService.listUpcoming`.

- [ ] **Step 1: Viết spec** (Review Focus 2, 3; tên chính xác):
  - `batch song song, mỗi batch +2 trên món còn 3 tồn: đúng một batch thành công, batch kia CART_BATCH_REJECTED/STOCK và dòng khác của nó không vào giỏ` (hai batch `[A×2, B×1]`; kết quả: A = 2, B = 1, một dòng mỗi biến thể).
  - `năm batch song song +1 trên món đủ tồn: số lượng đúng 5, một dòng, không mất cộng dồn`.
  - `batch song song với updateItem đặt số lượng tuyệt đối: số lượng cuối là một trong hai thứ tự hợp lệ, vẫn một dòng` (dòng có sẵn qty 1; batch +2, update → 5: cuối cùng 5 hoặc 7).
  - `khách chưa có giỏ: batch tạo giỏ và thêm đủ món`.
  - `món hết hàng ở giữa batch: lỗi có variationId, giỏ trống (không tạo dòng nào)`.
  - `listUpcoming: không userId → reminded false cho mọi món; có nhắc của khách → true` (đợt `startAt` tương lai, dùng `prisma.flashSale.create` + `flashSaleItem.create`; dọn dữ liệu cuối bài).
  - `getCart trả listUnitPrice = retailPrice` cho dòng có `salePrice`.
- [ ] **Step 2: Chạy với DB riêng** (xem "Môi trường kiểm" bên dưới): `DATABASE_URL=postgresql://tubu@127.0.0.1:25542/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand cart-batch` → PASS. Spec đã viết sau khi Task 2 xong nên không có bước đỏ riêng; nếu một ca đỏ, sửa `addItemsBatch` (không nới spec).
- [ ] **Step 3: Chạy thêm** `cart-combo-equals-quote` và `p3-don-flash-cart` race spec (cùng DB) để chắc `listUnitPrice` không làm vỡ so số giỏ = báo giá.
- [ ] **Step 4: Commit** `test(api): race batch giỏ + upcoming công khai`

---

### Task 9: Gate cuối

- [ ] **Step 1:** `export PATH=...; cd apps/api && npx prisma generate`; kiểm `git status` sạch, không đụng file ngoài bảng File Structure.
- [ ] **Step 2: Gate đầy đủ đúng một lần** từ worktree: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P3b --base 64abdc5e5 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P3b.txt`.
- [ ] **Step 3:** Bước FAIL nào: chạy lại đúng bước đó ở base (worktree tạm hoặc so log); FAIL cũng có ở base → ghi "có sẵn", còn lại do gói thì sửa tới PASS.
- [ ] **Step 4:** Race spec liên quan lần cuối + `pg-native.sh stop 25542`.

## Môi trường kiểm

- DB riêng: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25542`; tạo DB `tubutree_it` trong cụm (tên đúng, `setup-env.ts` đòi); `DATABASE_URL=postgresql://tubu@127.0.0.1:25542/tubutree_it`; áp migration bằng `npx prisma migrate deploy` (gói này không thêm migration).
- Máy thiếu RAM: chỉ chạy jest/vitest theo file trong lúc làm; không chạy song song hai bộ nặng.

## Điều chỉnh lúc làm

- Ca DTO của batch nằm ở `cart/dto/cart.dto.spec.ts` (không phải `cart.controller.spec.ts`), gọi `createValidationPipe()` thật.
- Race spec bắt một lỗi có sẵn: hai lượt tạo giỏ đầu tiên của cùng khách song song làm `cart.upsert` thua tranh unique `userId` (P2002) và trả 500 (nhấn đúp "Thêm cả combo" ở khách mới). `ensureCart` nay bắt P2002 rồi đọc giỏ đã có (test đơn vị trong `CartService.addItemsBatch`, race spec `hai batch song song`). Đã kiểm: bỏ khoá `carts` thì race spec đỏ 3/3.
- `CartLine.listUnitPrice` ở app-core để tuỳ chọn (`?`): fixture `CartLine` ở Mini/web chưa có trường này, bắt buộc sẽ vỡ tsc ở file gói khác.

## Ghi chú cho gói sau

- `CartLine` còn bản chép ở `apps/miniapp/src/services/shop-api.ts:77` và `apps/web/src/lib/shop-client.ts:13`: P8 thêm `listUnitPrice` ở đó (P3b chỉ sửa app-core).
- Lỗi batch: thân `{ code: 'CART_BATCH_REJECTED', reason: 'UNAVAILABLE'|'STOCK', variationId, productName, message }`. Web `ApiError` hiện chỉ giữ `code` và `message` (không có `variationId`): `message` đã nêu tên món; P9 muốn tô đúng dòng thì mở rộng `ApiError`.
