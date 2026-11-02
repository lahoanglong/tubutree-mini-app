# M4 flash-allowance: khách đăng nhập thấy đúng số suất Giờ vàng còn mua được Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nút, tổng và ghi chú ở PDP, bảng chọn phân loại và bảng Thêm nhanh ở Yêu thích ghi đúng số máy chủ sẽ tính cho khách đã đăng nhập, kể cả số suất Giờ vàng khách đã mua ở đơn trước (`perUserLeft`).

**Architecture:** thêm endpoint có xác thực `GET /flash-sales/me/allowance?items=<flashSaleItemId,…>` ở file API mới, gọi lại `FlashSaleService.resolveEffective(…, userId)` (cùng hàm giỏ và đặt đơn dùng) nên số khớp máy chủ từng chữ; không đụng response cache dùng chung của `/active` và `/slots`. app-core nhận `perUserLeft` tuỳ chọn trên `FlashPriceItem` (cũng là tham số của `flashLinePreview`), `allowance = min(giới hạn mỗi khách, suất còn lại của đợt, perUserLeft)`; hai app gọi endpoint một lần cho các suất của sản phẩm đang vẽ (khoá không chứa số lượng), trộn `perUserLeft` vào danh sách `flash` rồi truyền như cũ. Máy chủ KHÔNG đổi luật tính giá (vượt suất thì cả dòng tính giá thường, `handoff-wave7.md` §3).

**Tech Stack:** NestJS + Prisma (jest, race spec trên Postgres thật), TypeScript, vitest (app-core, Mini, web), React Query, Playwright (Mini mock API; web cần API thật).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật); nguồn việc `plans/handoff-wave7.md` §1 (K1+L1) và §4 dòng đầu; mẫu `plans/L1-flash-cart-aware.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước jest/tsc API.
- Chữ qua `shop-copy` (khoá mới đặt cạnh `flash.sheetOver*`, ngân sách độ dài ở `shop-copy-budget.ts`), viết hoa "Giờ vàng", không "Chỉ còn", không "Top"/"Freeship". Không sửa chữ có sẵn trong `flash-sale.service.ts` (M2 tách chữ ra `flash-sale-notice.ts`): chỉ thêm file mới.
- Giá đang giảm màu `--color-text-price-deal`, không đỏ; vùng chạm ≥44px; axe 0 vi phạm ở 375px; web dưới `md` ra cùng số đo Mini; token semantic, không hex, không px viết tay mới; `pnpm lint:parity` và `pnpm lint:vars` xanh.
- Danh sách Giờ vàng (`/active`, `/slots`, `/slots/:id/items`) là cache dùng chung: KHÔNG đưa số theo khách vào đó. Số theo khách chỉ đi qua endpoint mới, `Cache-Control: private, no-store`, lấy `userId` từ JWT, không nhận `userId` từ request.
- Khách chưa đăng nhập, API cũ (404), request lỗi: không gọi / bỏ qua kết quả, UI như hiện nay, không chặn nút.
- Không sửa file của M1/M2/M3 (xem task); việc buộc đụng thì ghi vào notes. Không deploy, không push, không đọc/ghi PROD. Máy chung thiếu RAM: vitest/jest theo file khi làm, gate đầy đủ một lần ở cuối. Commit cuối message có `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Khách đã mua hết suất (`perUserLeft = 0`): nút, tổng và ghi chú ở PDP, bảng chọn, Yêu thích đều ghi giá thường, ghi chú ngắn, không vỡ bố cục. Test: Task 2 (parity), 3, 4, 5.
2. Số về muộn (request chậm): vùng ghi chú đã giữ chỗ nên ô Số lượng không nhảy. Test: Task 5 (e2e đo vị trí ô Số lượng, route allowance trễ).
3. `0 < perUserLeft < số chọn` và `perUserLeft` lớn hơn suất còn lại của đợt: allowance là số nhỏ nhất, khớp `priceFlashLine`. Test: Task 2.
4. Khách chưa đăng nhập, API 404/500, id sai: không gọi, không lỗi, UI như cũ; id lạ hoặc đợt hết giờ thì endpoint bỏ khỏi kết quả (không 404). Test: Task 1, 3, 4.
5. Không lộ khách khác: `?userId=…` bị bỏ qua, chỉ `sub` của JWT. Test: Task 1 (HTTP thật), race spec.

---

## File structure

| File | Việc |
|---|---|
| `packages/shared-types/src/flash-allowance.ts` (+ `index.ts`) | type `FlashAllowanceEntry`, `FlashAllowanceResponse`, hằng `FLASH_ALLOWANCE_MAX_ITEMS` |
| `apps/api/src/modules/flash-sale/flash-allowance.service.ts` + `.spec.ts` | `parseAllowanceItemIds`, `FlashAllowanceService.forUser` |
| `apps/api/src/modules/flash-sale/flash-allowance.controller.ts` + `.spec.ts`, `flash-sale.module.ts` | route, header, guard mặc định |
| `apps/api/test/integration-race/flash-allowance.race-spec.ts` | DB thật: số khớp `priceFlashLine` |
| `packages/app-core/src/commerce/flash-line.ts` + `.spec.ts`, `flash-price.ts` | `perUserLeft` vào luật dòng và ghi chú |
| `packages/app-core/src/commerce/flash-allowance.ts` + `.spec.ts`, `api/flash-allowance.ts` + `.spec.ts` | khoá truy vấn, chọn id, trộn kết quả, đường dẫn |
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | khoá `flash.sheetSpent`, `flash.sheetOverLeft` |
| Mini: `services/shop-api.ts`, `hooks/use-flash-allowance.ts` + spec, `pages/product-detail.tsx`, `pages/wishlist.tsx` + specs | gọi và truyền |
| Web: `lib/shop-client.ts`, `lib/use-flash-allowance.ts` + spec, `components/add-to-cart.tsx`, `app/tai-khoan/yeu-thich/quick-add.tsx` + specs | như Mini |
| `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts`, `flash-sheet-price.web.spec.ts`, mock Mini nếu cần | ca đã hết suất, số về muộn |

---

### Task 1: API endpoint `GET /flash-sales/me/allowance`

**Files:**
- Create: `packages/shared-types/src/flash-allowance.ts`; `apps/api/src/modules/flash-sale/flash-allowance.service.ts`, `flash-allowance.controller.ts` và `.spec.ts` của hai file; `apps/api/test/integration-race/flash-allowance.race-spec.ts`
- Modify: `packages/shared-types/src/index.ts`, `apps/api/src/modules/flash-sale/flash-sale.module.ts`

**Interfaces:**
- Produces (shared-types):
  ```ts
  export const FLASH_ALLOWANCE_MAX_ITEMS = 50;
  export interface FlashAllowanceEntry { perUserLeft: number; allowance: number }
  export interface FlashAllowanceResponse { items: Record<string, FlashAllowanceEntry> }
  ```
- Produces (API): `parseAllowanceItemIds(raw: unknown): string[]` (400 `BadRequestException` khi không phải một chuỗi `a,b,c` các id `^[A-Za-z0-9_-]{1,64}$`, rỗng, hoặc quá 50 id sau khi bỏ trùng); `FlashAllowanceService.forUser(userId: string, itemIds: string[], now?: Date): Promise<FlashAllowanceResponse>`; controller `@Controller('flash-sales/me')`, `@Get('allowance')`, `@Header('Cache-Control', 'private, no-store')`, không `@Public()` (JwtAuthGuard toàn app trả 401 cho khách).
- Hành vi `forUser`: đọc `flashSaleItem` theo id (`id`, `variationId`), gọi `FlashSaleService.resolveEffective(variationIds, now, userId)`, chỉ giữ id mà offer của phân loại có đúng `itemId` đó và có `perUserLeft`/`allowance`; suất không còn chạy (hết giờ, hết suất, tắt) không có trong kết quả. Không đổi `FlashSaleService`.

- [ ] **Step 1: Test đỏ**
  - `flash-allowance.service.spec.ts` (prisma và `FlashSaleService` giả): `parseAllowanceItemIds('a,b')` = `['a','b']`, `'a,a'` = `['a']`, 50 id khác nhau vẫn qua; ném `BadRequestException` với `undefined`, `''`, `'a,,b'`, `'a b'`, `'../x'`, `'x'.repeat(65)`, `['a','b']` (tham số lặp), 51 id. `forUser('u1', ['fi1','fi2','fi3'])` với `resolveEffective` trả `Map{v1 → {itemId:'fi1', perUserLeft:1, allowance:1}, v2 → {itemId:'khác', …}}` và `fi3` không có dòng DB ra đúng `{ items: { fi1: { perUserLeft: 1, allowance: 1 } } }`; `resolveEffective` nhận `userId` đúng như truyền vào; suất của người tạo đợt (`ownSale`, 0/0) ra `{perUserLeft: 0, allowance: 0}`; không dòng DB nào thì không gọi `resolveEffective` và ra `{ items: {} }`.
  - `flash-allowance.controller.spec.ts`: metadata (không `IS_PUBLIC_KEY`, header `private, no-store`); HTTP thật theo mẫu `flash-sale.controller.spec.ts` (JwtModule + `APP_GUARD` `JwtAuthGuard`, service giả): không Authorization → 401; token hợp lệ → 200 và service nhận `sub` của token; `?items=a&userId=khác` vẫn chỉ `sub`; `items` thiếu hoặc sai → 400.
  - `flash-allowance.race-spec.ts` (Postgres thật, mẫu `catalog-flash-card-price.race-spec.ts`): đợt đang chạy, suất `quota 10, perUserLimit 3`; khách A đã mua 2 (`flashSalePurchase`), B đã mua 3, C chưa mua: `forUser` ra `{1,1}`, `{0,0}`, `{3,3}`; `soldCount = 9` thì C `{perUserLeft 3, allowance 1}`; `soldCount = quota` hoặc đợt hết giờ thì id vắng; mỗi ca đối chiếu với `priceFlashLine(standing, qty, resolveEffective(…, userId).get(variationId))` rằng `qty = allowance + 1` ra giá thường.
- [ ] **Step 2: Chạy** `cd apps/api && npx jest src/modules/flash-sale/flash-allowance` Expected: FAIL (file chưa có).
- [ ] **Step 3: Cài đặt** theo Interfaces; thêm hai class vào `providers` và controller vào `controllers` của `FlashSaleModule`; `index.ts` của shared-types thêm `export * from './flash-allowance'`, rồi `pnpm --filter @tubutree/shared-types build`.
- [ ] **Step 4: Chạy lại** Expected: PASS; `npx tsc --noEmit -p apps/api/tsconfig.json`; race spec với DB riêng (`bash docs/2026-10-20-uat/tools/pg-native.sh start 25593`, tạo DB `tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25593/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/flash-allowance.race-spec.ts`).
- [ ] **Step 5: Commit** `feat(api): GET /flash-sales/me/allowance trả số suất Giờ vàng khách còn mua được (theo resolveEffective)`.

### Task 2: app-core, `perUserLeft` vào luật dòng, chữ, đường dẫn và trộn kết quả

**Files:**
- Modify: `packages/app-core/src/commerce/flash-line.ts` + `.spec.ts`, `packages/app-core/src/flash-price.ts`, `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`
- Create: `packages/app-core/src/commerce/flash-allowance.ts` + `.spec.ts`, `packages/app-core/src/api/flash-allowance.ts` + `.spec.ts`

**Interfaces:**
- `FlashPriceItem` thêm `perUserLeft?: number | null` (số suất khách còn mua được giá Giờ vàng của suất này, đã trừ đơn trước; thiếu = chưa biết).
- `flashLinePreview(i)` thêm `perUserLeft?: number | null`; hữu hạn thì `Math.max(0, Math.floor(n))`, không thì chưa biết. `limit` hiệu lực = số nhỏ nhất trong các số đã biết (`limit`, `perUserLeft`); khác `limit` thông thường, `perUserLeft = 0` nghĩa là hết suất (mọi số lượng > 0 tính giá thường), `limit ≤ 0` vẫn là chưa biết như hiện nay.
- `variationLinePreview` đọc `perUserLeft` từ suất tìm được; `allowance = min(limit, quotaLeft, perUserLeft)` (các số đã biết); `allowanceBy: 'perUser' | 'quota' | 'bought' | null` (`'bought'` khi `perUserLeft` đã biết và nhỏ hơn giới hạn mỗi khách hoặc giới hạn chưa biết, và không phải đợt sắp hết); `limit` vẫn là giới hạn mỗi khách để ghi "Tối đa n/khách".
- `overLimitNote`: `allowance === 0` → `flash.sheetSpent`; `inCart > allowance` → `sheetOverInCartAlready`; `inCart > 0` → `sheetOverInCart`; sau đó theo `allowanceBy` (`quota` → `sheetOverQuota`, `bought` → `sheetOverLeft`, còn lại `sheetOverLimit`).
- Khoá chữ: `'flash.sheetSpent': 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.'` (≤ 90, đúng cho cả người tạo đợt, nơi máy chủ cũng trả `perUserLeft 0`), `'flash.sheetOverLeft': 'Bạn còn {n} suất Giờ vàng. Mua {qty} thì cả dòng tính giá thường.'` (≤ 90).
- `api/flash-allowance.ts`: `flashAllowancePath(itemIds: readonly string[]): string` = `/flash-sales/me/allowance?items=<id mã hoá, nối bằng dấu phẩy>`; `fetchFlashAllowance(http: HttpClient, itemIds: readonly string[]): Promise<FlashAllowanceResponse>`.
- `commerce/flash-allowance.ts`: `flashAllowanceKey(itemIds: readonly string[]): readonly ['orders', 'flash-allowance', string]` (nằm dưới `'orders'` để lần đặt đơn thành công, vốn `invalidateQueries(['orders'])`, làm số suất tải lại mà không phải sửa trang thanh toán); `allowanceItemIds(flash: readonly { itemId?: string; variationId: string }[], variationIds: readonly string[]): string[]` (id của các suất thuộc các phân loại đó, không trùng, sắp xếp, tối đa `FLASH_ALLOWANCE_MAX_ITEMS`); `withFlashAllowance<T extends { itemId?: string }>(flash: readonly T[], res: FlashAllowanceResponse | null | undefined): (T & { perUserLeft?: number | null })[]` (không có `res` hoặc không khớp suất nào thì trả lại đúng mảng đầu vào; không sửa phần tử gốc; bỏ dòng có `perUserLeft` không phải số).

- [ ] **Step 1: Test đỏ**
  - `flash-line.spec.ts`: trong `describe('flashLinePreview khớp priceFlashLine của máy chủ')` thêm bảng ca `perUserLeft` với `server(STANDING, inCart + qty, offer)` làm chuẩn (offer có `allowance = min(quotaLeft, perUserLeft)`, `quotaLeft`, `perUserLeft`; STANDING 35.000, FLASH 26.000, LIMIT 3): `perUserLeft 0, qty 1` → 35.000 và `overLimit true`; `perUserLeft 1, qty 1` → 26.000, `qty 2` → 35.000 `overLimit`; `perUserLeft 2, qty 2` → 26.000; `perUserLeft 3 (= limit), qty 4` → 35.000; `perUserLeft 5 (lớn hơn quotaLeft 2), qty 3` → 35.000 (suất đợt chặn); `perUserLeft 1, inCart 1, qty 1` → `lineQuantity 2` 35.000, `total` đúng `lineTotal − giá dòng(inCart)`; `perUserLeft` undefined/null/NaN/Infinity → như trước (26.000 với qty 3). Giữ nguyên ca "giới hạn 0 là chưa biết". `variationLinePreview` với suất `{perUserLimit 3, quota 10, soldCount 5, perUserLeft}`: `0` → `allowance 0, allowanceBy 'bought', limit 3, overLimit true, total = qty × 35.000`; `1` qty 2 → `allowance 1, 'bought'`; `3` → `allowanceBy 'perUser'`; `perUserLeft 5` với `quota 10, soldCount 8` → `allowance 2, 'quota'`; `perUserLimit` không có và `perUserLeft 2` → `allowance 2, 'bought'`; giá Giờ vàng ≥ giá đang bán thì `perUserLeft` bị bỏ qua (không phải Giờ vàng). `overLimitNote`: `perUserLeft 0` ra đúng chữ `sheetSpent` kể cả có `inCart > 0`; `perUserLeft 1, qty 2` ra `'Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.'`; không câu nào chứa "Chỉ còn".
  - `commerce/flash-allowance.spec.ts`, `api/flash-allowance.spec.ts`: theo Interfaces (khoá nằm dưới `'orders'`, đường dẫn mã hoá id, `allowanceItemIds` lọc theo phân loại và cắt ở 50, `withFlashAllowance` giữ tham chiếu khi không có gì để trộn và không sửa gốc).
  - `shop-copy.spec.ts` (nếu bảng giá trị xấu nhất thiếu khoá) và spec ngân sách tự kiểm hai khoá mới.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/commerce/flash-line.spec.ts src/commerce/flash-allowance.spec.ts src/api/flash-allowance.spec.ts src/shop-copy.spec.ts` Expected: FAIL.
- [ ] **Step 3: Cài đặt** theo Interfaces. Một hàm nội bộ gộp "số nhỏ nhất trong các số đã biết" dùng cho cả `flashLinePreview` và `variationLinePreview` (không chép hai lần); comment tiếng Việt nói vì sao `perUserLeft 0` khác `limit 0` (máy chủ `allowance 0` nghĩa là hết suất, `limit` không gửi nghĩa là chưa biết).
- [ ] **Step 4: Chạy lại** Expected: PASS; `npx tsc --noEmit -p packages/app-core`; `npx vitest run src/commerce src/terminology.spec.ts src/shop-copy.spec.ts`.
- [ ] **Step 5: Commit** `feat(app-core): perUserLeft vào luật dòng Giờ vàng, chữ hết suất, đường dẫn và trộn số suất theo khách`.

### Task 3: Mini, gọi một lần và truyền vào PDP, bảng chọn, Yêu thích

**Files:**
- Create: `apps/miniapp/src/hooks/use-flash-allowance.ts` + `.spec.tsx`
- Modify: `apps/miniapp/src/services/shop-api.ts` (thêm `fetchFlashAllowance(itemIds)` bằng `api.get(flashAllowancePath(ids))`), `apps/miniapp/src/pages/product-detail.tsx`, `apps/miniapp/src/pages/wishlist.tsx`, `apps/miniapp/src/components/variation-sheet.tsx` (chỉ khi cần chỗ giữ cho khối giá, xem Step 3), và spec `product-detail-flash.spec.tsx`, `wishlist-flash.spec.tsx`, `variation-sheet.spec.tsx`

**Interfaces:**
- Consumes: `flashAllowanceKey`, `allowanceItemIds`, `withFlashAllowance` (Task 2).
- Produces: `useFlashAllowance<T extends { itemId?: string; variationId: string }>(flash: readonly T[] | undefined, variationIds: readonly string[]): (T & { perUserLeft?: number | null })[]`. Chỉ gọi khi `useAuthPhase() === 'authenticated'` và có id; `staleTime 15_000`, `retry: false`, khoá không chứa số lượng; lỗi hoặc chưa về thì trả `flash` gốc. `VariationSheet` không đổi prop: nhận `flash` đã trộn.

- [ ] **Step 1: Test đỏ**
  - `use-flash-allowance.spec.tsx` (QueryClientProvider, `fetchFlashAllowance` giả, auth store giả): khách chưa đăng nhập và đang tải phiên không gọi; đã đăng nhập gọi đúng một lần với id của suất thuộc `variationIds` (suất của sản phẩm khác không vào); render lại và đổi prop không liên quan không gọi lần hai; trả danh sách có `perUserLeft`; API lỗi thì trả đúng danh sách gốc, không ném.
  - `variation-sheet.spec.tsx`: suất có `perUserLeft: 0` thì mode `add` ghi `Thêm vào giỏ · 35.000đ` (qty 1, giá thường), mode `buy` ghi `Mua ngay · …` theo giá thường, vùng `role=status` ghi đúng chữ `flash.sheetSpent`; `perUserLeft 1` qty 2 ghi `Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.`; không có `perUserLeft` ra số cũ.
  - `product-detail-flash.spec.tsx`: đã đăng nhập, mock allowance `{perUserLeft: 0}`: nút `Mua ngay` có `aria-label` ghi giá thường, ghi chú dưới ô Số lượng; `{perUserLeft 1}` chọn 2 ra ghi chú theo luật vượt suất; mock allowance 404: ra số cũ; khách chưa đăng nhập: không có request allowance.
  - `wishlist-flash.spec.tsx`: mở bảng chọn với `perUserLeft 0`: nút ghi giá thường và ghi chú; đóng bảng (không mở) không có request allowance.
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/hooks/use-flash-allowance.spec.tsx src/components/variation-sheet.spec.tsx src/pages/product-detail-flash.spec.tsx src/pages/wishlist-flash.spec.tsx` Expected: FAIL.
- [ ] **Step 3: Cài đặt**: hook theo Interfaces. `product-detail.tsx`: gọi `useFlashAllowance(flashQ.data, variations.map((v) => v.id))` ngay sau `variations`, rồi `flashList = runningFlash(<kết quả hook>)` ở chỗ tính `line` và truyền cho `VariationSheet` (các chỗ khác của trang giữ `flashQ.data`). `wishlist.tsx`: `useFlashAllowance(flashQ.data ?? [], picker?.variations.map((v) => v.id) ?? [])` rồi truyền `flash`. Nếu đo ở Task 5 thấy khối giá đầu bảng nhảy khi số về, thêm chỗ giữ trong `variation-sheet.tsx`; không đổi cách `pricing` (giá niêm yết của suất) hiển thị: giá hiển thị là giá của đợt, chỉ nút, tổng và ghi chú là số của riêng khách.
- [ ] **Step 4: Chạy lại** Expected: PASS; thêm `npx vitest run src/pages/product-detail src/pages/wishlist src/components/ds-shop-guard.spec.ts` và `npx tsc --noEmit -p apps/miniapp`.
- [ ] **Step 5: Commit** `feat(miniapp): nút và ghi chú Giờ vàng theo số suất khách còn mua được (PDP, bảng chọn, Yêu thích)`.

### Task 4: web, cùng thay đổi

**Files:**
- Create: `apps/web/src/lib/use-flash-allowance.ts` + `.spec.tsx`
- Modify: `apps/web/src/lib/shop-client.ts` (thêm `getFlashAllowance(itemIds)` qua `fetchFlashAllowance(coreHttp, …)`), `apps/web/src/components/add-to-cart.tsx`, `apps/web/src/app/tai-khoan/yeu-thich/quick-add.tsx`, và spec `variation-sheet.spec.tsx`, `add-to-cart.spec.tsx`, `page-flash.spec.tsx` (bảng Thêm nhanh)

**Interfaces:**
- Consumes: Task 2. Produces: `useFlashAllowance` cùng chữ ký và hành vi như Mini, dùng `useAuthPhase` của `@/lib/auth-phase` và React Query (`useQuery` đã có trong hai file đích).

- [ ] **Step 1: Test đỏ**: bộ ca như Task 3 cho hook, bảng chọn, `add-to-cart` (nút máy tính, nút `Mua ngay` ở thanh dưới, `[data-section="pdp-flash-limit"]` ghi chữ hết suất) và bảng Thêm nhanh; khách `guest`/`loading` không có request.
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run src/lib/use-flash-allowance.spec.tsx src/components/variation-sheet.spec.tsx src/components/add-to-cart.spec.tsx "src/app/tai-khoan/yeu-thich"` Expected: FAIL.
- [ ] **Step 3: Cài đặt**: `add-to-cart.tsx` đổi `const flash = runningFlash(useActiveFlashSales())` để `variationLinePreview` và `VariationSheet` nhận danh sách đã trộn (giữ danh sách gốc cho `useFlashListExpiry`, `variationPricing` của chip và chọn phân loại mặc định); `quick-add.tsx` trộn trước khi truyền `flash`.
- [ ] **Step 4: Chạy lại** Expected: PASS; `npx tsc --noEmit -p apps/web`; `npx vitest run src/components/ds-shop-guard.spec.ts`.
- [ ] **Step 5: Commit** `feat(web): nút và ghi chú Giờ vàng theo số suất khách còn mua được (cùng Mini)`.

### Task 5: e2e, ảnh 375px, gate

**Files:**
- Modify: `apps/e2e/tests/flash-sheet-price.miniapp.spec.ts`, `apps/e2e/tests/flash-sheet-price.web.spec.ts`, `apps/e2e/tests/wishlist-quick-add.miniapp.spec.ts` (chỉ khi mock chung cần route mới); mock chung của Mini khi route lạ làm test đỏ
- Output ngoài git: `docs/2026-10-31-shop-redesign/screens/M4/`

- [ ] **Step 1: e2e Mini**: mock `GET /flash-sales/me/allowance` (mặc định cho mọi ca: 404 để như API cũ nếu route lạ gây đỏ); ca "đã dùng hết suất": `perUserLeft 0` thì nút `Mua ngay · 35.000đ` (giá thường) và `status` ghi chữ hết suất; ca "còn 1 suất, chọn 2": ghi chú `Bạn còn 1 suất…`; ca "số về muộn": route trễ 600ms, đo `boundingBox().y` của ô Số lượng trước và sau khi số về, lệch ≤ 1px. Chạy `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3611 npx playwright test tests/flash-sheet-price.miniapp.spec.ts tests/wishlist-quick-add.miniapp.spec.ts --workers=2 --reporter=line` Expected: PASS.
- [ ] **Step 2: e2e web**: thêm ca tương ứng vào `flash-sheet-price.web.spec.ts` (route allowance mock bằng `page.route`, số tiền theo `standing` và `FLASH_PRICE` của spec); chạy `E2E_API_PORT=3612 E2E_WEB_PORT=3613 E2E_MINIAPP_PORT=3614 bash apps/e2e/scripts/web-gate.sh tests/flash-sheet-price*.web.spec.ts`; không chạy được thì ghi lý do và cách CI chạy vào notes.
- [ ] **Step 3: Ảnh** 375px Mini (Vite dev 3611) và web (Next dev 3612, host localhost): bảng chọn Giờ vàng còn suất và đã hết suất theo khách; `mini375-*.png`, `web375-*.png` vào `screens/M4/`; so hai bản; tắt server của mình.
- [ ] **Step 4: Gate** từ worktree: `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-M4 --base 173de56b3 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-M4.txt` một lần; rồi bộ e2e Mini đầy đủ (`--workers=2`); bước FAIL phải so với base để ghi "có sẵn"; dừng cụm `pg-native.sh stop 25593`.
- [ ] **Step 5: Commit** `test(e2e): khách đã hết suất Giờ vàng thấy giá thường (Mini, web)`.

## Self-review

- Spec coverage: endpoint có xác thực, kiểm đầu vào, không lộ khách khác, khách chưa đăng nhập không gọi: Task 1, 3, 4; type ở shared-types: Task 1; `flash-line.ts` nhận số suất theo khách và spec chạy `priceFlashLine` thật với ca 0, nhỏ hơn, lớn hơn: Task 2; PDP, sheet, Yêu thích hai app với một request, không gọi lặp: Task 3, 4; chữ mới trong `shop-copy.ts` đúng ngân sách: Task 2; không nhảy bố cục: Task 5; e2e và ảnh: Task 5.
- Tên nhất quán: `perUserLeft`, `allowance`, `allowanceBy`, `useFlashAllowance`, `withFlashAllowance`, `allowanceItemIds`, `flashAllowanceKey`, `fetchFlashAllowance`, `flash.sheetSpent`, `flash.sheetOverLeft`.
- Chủ ý ngoài phạm vi (ghi notes): giá hiển thị đầu bảng và FlashPriceBar ở PDP vẫn là giá của đợt (chip từng phân loại cũng vậy), chỉ nút/tổng/ghi chú theo khách; số `perUserLeft` tải lại tối đa mỗi 15 giây hoặc sau khi đặt đơn (khoá nằm dưới `['orders']`); trang `/flash-sale` danh sách khung giờ chưa dùng số này.
