# P12 flash-slots: trang Giờ vàng theo khung giờ (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang `/flash-sale` ↔ `/gio-vang` có tab khung giờ, đồng hồ, chip danh mục, thẻ `line` + thanh đã bán + Mua ngay/Nhắc tôi; API khung giờ công khai; gỡ ràng buộc deploy của đợt 3 (ô lối tắt Giờ vàng, "Xem tất cả", "Nhắc tôi" về lại).

**Architecture:** API thêm `GET /flash-sales/slots` và `/slots/:id/items` (công khai, cache RAM 3 giây, `serverNow` gắn sau cache) dựng từ `FlashSale`/`FlashSaleItem` có sẵn, thêm `FlashSaleItem.sortOrder`. Logic chọn tab, nhãn tab, phím mũi tên, thứ tự món, chip danh mục và câu lỗi `FLASH_LIMIT` ở `packages/app-core`; Mini App và web chỉ vẽ cùng tên `SlotTabs`. Giá vẫn đi đường cũ (`consumeQuotas` trong transaction đặt đơn); gói chỉ đổi dạng lỗi vượt giới hạn.

**Tech Stack:** NestJS + Prisma + Postgres (jest, race spec), vitest, React 18 + zmp-ui (Mini), Next 15 (web), Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 Q3, Q7, Q14, §5 "Giờ vàng"; mục P12 của `02-ke-hoach.md`; `review/backend-gap.md` §1, §7; `review/ia-merch.md` D1; `review/a11y.md` B4; `review/ux-copy.md` B1, UC-07; `plans/handoff-wave3.md` (Ràng buộc deploy, Việc còn mở).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới cần `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Chữ: "Giờ vàng" luôn hoa chữ G; "Mua ngay", "Nhắc tôi", "Đã đặt nhắc", "Mỗi khách tối đa {n}", "Đã bán hết", "Sắp hết" lấy từ `SHOP_COPY` (đã có đủ khoá `flash.*`; không thêm khoá nếu không buộc, thêm thì thêm cả `shop-copy-budget.ts`).
- Q3: `Countdown mode="clock"` (HH:MM:SS) chỉ ở đầu trang Giờ vàng; nơi khác dạng chữ. Một bộ đếm cho cả trang.
- Q14: khung mặc định `["12:00","20:00"]`, cấu hình `flashsale.slots`. Giờ theo múi Việt Nam.
- a11y B4: `tablist` `aria-label="Khung giờ"`, tên tab "12:00, đang diễn ra", roving tabindex (0 tab chọn, -1 còn lại), mũi tên trái/phải + Home/End, `aria-controls` tới `tabpanel` có `aria-labelledby`, đổi tab không dời focus, dấu tab chọn ≥3:1; thanh % `aria-hidden` + chữ luôn hiện; nút nhắc `aria-pressed` + tên kèm tên sản phẩm; hết khung giờ báo `polite` một lần "Khung {giờ} đã kết thúc".
- Giá Giờ vàng màu `--color-text-price-deal`; không dùng đỏ. Vùng chạm ≥44px, axe 0 vi phạm ở 375px.
- Chunk vào Mini ≤700 KB; trang mới là chunk theo route (`lazy` trong `app.tsx`). Ghi số entry trước/sau.
- Khách chưa đăng nhập xem được trang (không màn lỗi 401); chỉ thao tác cần tài khoản (Nhắc tôi, Mua ngay) mở cổng đăng nhập.
- Đường tiền không đổi: thứ tự giảm, `OrderItem.paidTotal`. Gói đụng `consumeQuotas`/đặt đơn nên review lượt 2.
- Không deploy, không đọc/ghi PROD, không push. Không `git stash` trần. Máy thiếu RAM: chỉ chạy test theo file, gate đầy đủ một lần ở cuối.
- `route-map.json`, `shop-copy.ts`, `vi.ts`, `app.tsx` là file gộp tay khi merge; `route-fallback.ts`: P13 sửa mục `/best-sellers` cùng file, gói này chỉ xoá mục `/flash-sale`.

## Quyết định lúc viết kế hoạch

- **Khung giờ = `FlashSale`.** `GET /flash-sales/slots` trả mọi đợt `isActive`, chưa kết thúc, có `startAt` trước 00:00 giờ VN của ngày kia, có ≥1 món bán được (`itemCount > 0`). Không lọc theo `flashsale.slots`, vì đợt nhập tay giờ lạ (đang có trên PROD) sẽ biến mất khỏi trang trong khi Trang chủ vẫn hiện. `flashsale.slots` là lưới khung mặc định mà admin sinh đợt từ đó (`generateSlots`, Task 10; nút "Tạo khung giờ" ở Task 11). Đợt đã kết thúc không thành tab; `GET /slots/:id/items` của đợt đã kết thúc vẫn 200 với `slot.status='ENDED'` và `items: []` (mở từ thông báo cũ: "Khung giờ này đã kết thúc"), id lạ hoặc đợt tắt thì 404.
- **Phản hồi bọc:** `{ serverNow, slots }` và `{ serverNow, slot, items }` (không phải mảng có `serverNow` mỗi dòng như `listActive`) để danh sách rỗng vẫn đồng bộ được đồng hồ.
- **Hết suất:** `soldOut = soldCount >= quota || variation.stock <= 0`; món hết suất vẫn trả (mờ, xuống cuối, nút khoá). Món hết hàng thật hoặc không còn rẻ hơn giá đang bán (`isStillDiscounted`) bị loại như `listActive`.
- **`listActive`:** thêm `saleId`, `title`, `startAt`, `perUserLimit` (PDP đã đọc `perUserLimit` để ghi "Mỗi khách tối đa {n}") và tham số `limit` tuỳ chọn. Khối gộp `/home` KHÔNG truyền `limit`: cache `['flash-sales','active']` còn nuôi giá Giờ vàng trên mọi thẻ, cắt bớt thì thẻ món bị cắt hiện giá thường.
- **FLASH_LIMIT:** `BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'FLASH_LIMIT', limit: n, message: <câu kế hoạch đã điền n> })`; `n` = `perUserLimit` của suất vừa vượt, đọc trong cùng transaction trước khi ném. Hai app coi mã này là "sửa được ở giỏ"; vẫn nhận câu cũ "Vượt giới hạn mua ưu đãi." khi API cũ.
- **"Nhắc tôi" sau đăng nhập không tự đặt lại** (khách bấm lần nữa): giữ gọn, ghi vào notes.
- **"Mua ngay"** thêm đúng 1 sản phẩm của phân loại có suất vào giỏ (nguồn `buy_now`) rồi sang thanh toán đúng dòng đó, như nút ở trang chi tiết.

## Review Focus

1. Khung giờ kết thúc khi khách đang xem (`Countdown.onEnd`): tab chuyển sang khung kế (hoặc trạng thái "đã kết thúc"), nút Mua ngay không còn gửi giá Giờ vàng cũ. Test: vitest page `onEnd` đổi tab; API `slots` với `endAt <= now` không trả.
2. Khách chưa đăng nhập: xem được, Nhắc tôi/Mua ngay mở cổng đăng nhập, không lời gọi cần JWT. Test: e2e Mini persona guest; vitest web guest đi `/dang-nhap`.
3. Suất không có món, API 404/500, không có khung nào: trạng thái rỗng (`flash.emptyTitle`/`emptyCta`), lỗi có "Thử lại", không nhảy trang. Test: vitest ba nhánh.
4. Tên sản phẩm dài có dấu, thiếu ảnh, món hết suất/hết kho, `quota = 0`: dòng không tràn, thanh % không NaN. Test: vitest `FlashSlotItem` + `flashSoldText`.
5. Hai khách mua món cuối của suất: đúng một thành công, `soldCount = quota`, khách thua nhận `PRICE_CHANGED`; khách vượt giới hạn nhận `FLASH_LIMIT` kèm `limit`. Test: race spec.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/merch/route-fallback.ts` (+ spec) | gỡ mục `/flash-sale` khỏi `ENTRIES`/`PENDING_TARGET` |
| `apps/api/prisma/schema.prisma` + migration `*_flash_item_sort_order` | `FlashSaleItem.sortOrder Int @default(0)` |
| `apps/api/src/modules/flash-sale/flash-slots.ts` (+ spec) | hàm thuần: ranh giới ngày VN, `slotStatus`, `parseSlotClocks`, `slotStartsFor`, `SLOT_ITEM_ORDER_BY` |
| `apps/api/src/modules/flash-sale/flash-sale.service.ts`, `flash-sale.controller.ts`, `flash-sale-admin.controller.ts` | `listSlots`, `listSlotItems`, `listActive` mở rộng, `overLimitError`, `setItemSortOrder`, `generateSlots` |
| `apps/api/src/modules/checkout/checkout.service.ts`, `affiliate/affiliate.service.ts` | ném `FLASH_LIMIT` thay chuỗi cũ |
| `apps/api/test/integration-race/flash-slot-last-unit.race-spec.ts` | hai khách mua món cuối |
| `packages/app-core/src/api/flash-sale.ts`, `queries/flash-sale.ts` | kiểu + `fetchFlashSlots`, `fetchFlashSlotItems`, `flashSlotsQuery`, `flashSlotItemsQuery` |
| `packages/app-core/src/commerce/flash-slots.ts` (+ spec) | chọn tab, nhãn tab, phím, thứ tự món, chip danh mục |
| `packages/app-core/src/commerce/flash-limit.ts` (+ spec) | `FLASH_LIMIT_CODE`, `flashLimitNotice(err)` |
| `apps/miniapp/src/components/ui/slot-tabs.tsx`, `apps/web/src/components/mini/slot-tabs.tsx` (+ spec) | `SlotTabs` |
| `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/web/src/components/mini/product-tile.tsx` | thêm prop `action?: ReactNode` cho biến thể `line` |
| `apps/miniapp/src/components/flash/*`, `pages/flash-sale.tsx`; `apps/web/src/components/flash/*`, `app/gio-vang/*` | màn Giờ vàng |
| `packages/app-core/src/route-map.json`, `apps/miniapp/src/components/app.tsx`, `apps/miniapp/src/services/api.ts` | route + GET công khai |
| `apps/e2e/tests/flash-slots.miniapp.spec.ts` (+ mock), `flash-slots.web.spec.ts` | e2e |

---

### Task 1: Gỡ cờ pending của `/flash-sale`

**Files:**
- Modify: `packages/app-core/src/merch/route-fallback.ts`, `route-fallback.spec.ts`, `home-shelves.spec.ts`, `packages/app-core/src/home-layout.spec.ts`, `packages/app-core/src/merch/shelves.spec.ts` (`PLANNED_ROUTES`)
- Modify: `apps/miniapp/src/components/home/shortcut-grid.spec.tsx`, `apps/web/src/components/home/shortcut-grid.spec.tsx`, `apps/miniapp/src/components/flash-sale.spec.tsx`, `apps/web/src/components/home/flash-sale.spec.tsx`, nhánh mặc định của mock `routeUsable` trong các spec đó
- Modify: `packages/app-core/src/home-layout.ts` (bỏ dòng `if (s.id === 'flash' && !routeUsable('/flash-sale')) return [];`), chú thích `shortcut-visuals.ts` hai app, chú thích `UpcomingFlashSales`/`NextSlotLine`

**Interfaces:**
- Produces: `liveRoute('/flash-sale','mini') === '/flash-sale'`, `liveRoute('/flash-sale','web') === '/gio-vang'`, `routeUsable('/flash-sale') === true`, `seeAllHref('home.flash'|'offers.flash', platform)` ra route thật.

- [ ] **Step 1: Sửa spec cho khớp trạng thái mới (đỏ)**: `route-fallback.spec.ts` đổi `Giờ vàng chờ P12 ... false` thành `routeUsable('/flash-sale')` là `true` và `liveRoute('/flash-sale','mini'|'web')` là `'/flash-sale'`/`'/gio-vang'`; `home-layout.spec`/`shortcut-grid.spec` (hai app) đòi ô Giờ vàng là ô cố định đầu tiên trở lại; `home-shelves.spec`/`flash-sale.spec` đòi "Xem tất cả" và dòng "suất kế" là nút dẫn `/flash-sale` (`/gio-vang`) kèm chữ "Nhắc tôi"; mock `routeUsable` mặc định trả `true`.
- [ ] **Step 2: Chạy, thấy đỏ**: `npx vitest run packages/app-core/src/merch packages/app-core/src/home-layout.spec.ts` và hai app theo file. Expected: FAIL đúng các ca vừa sửa.
- [ ] **Step 3: Xoá `'/flash-sale'` khỏi `ENTRIES` và `PENDING_TARGET`** (đổi chú thích đầu file/`routeUsable` cho khớp; không đụng mục `/best-sellers` và `/vouchers`). Giữ `liveRoute` tra `ENTRIES` cho `/flash-sale` bằng một mục `{ mini:'/flash-sale', web:'/gio-vang', pending:false }`. Xoá dòng chặn trong `home-layout.ts`; bỏ `'/flash-sale'` khỏi `PLANNED_ROUTES` ở `shelves.spec.ts` (route đã vào `route-map.json` ở Task 6).
- [ ] **Step 4: Chạy lại, xanh.**
- [ ] **Step 5: Commit** `feat(app-core): bỏ cờ chờ của /flash-sale, ô Giờ vàng trở lại làm ô cố định đầu tiên`

### Task 2: API, cột `sortOrder` + hàm thuần khung giờ

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`FlashSaleItem.sortOrder Int @default(0)`), tạo migration bằng `prisma migrate dev --name flash_item_sort_order` vào DB riêng (`tubutree_it`, cụm 25545)
- Modify: `apps/api/src/modules/flash-sale/flash-active.ts` (`ACTIVE_FLASH_ORDER_BY` thêm `{ sortOrder: 'asc' }` đứng đầu)
- Create: `apps/api/src/modules/flash-sale/flash-slots.ts`, `flash-slots.spec.ts`

**Interfaces:**
- Produces (file `flash-slots.ts`):
  - `type FlashSlotStatus = 'LIVE' | 'UPCOMING' | 'ENDED'`
  - `slotStatus(s: { startAt: Date; endAt: Date }, now: Date): FlashSlotStatus` (LIVE khi `startAt <= now < endAt`)
  - `vnDayStart(now: Date): Date` (00:00 giờ VN của ngày chứa `now`), `vnHorizonEnd(now: Date): Date` (00:00 VN của ngày kia)
  - `DEFAULT_SLOT_CLOCKS: readonly string[] = ['12:00','20:00']`, `FLASH_SLOT_MINUTES = 120`
  - `parseSlotClocks(raw: unknown): string[]` (mảng chuỗi `HH:MM` hợp lệ, bỏ trùng, tăng dần; hỏng hoặc rỗng → `DEFAULT_SLOT_CLOCKS`)
  - `slotStartsFor(now: Date, clocks: readonly string[], days: number): Date[]` (mỗi ngày VN từ hôm nay, `days` ngày; bỏ khung đã kết thúc `start + FLASH_SLOT_MINUTES <= now`)
  - `SLOT_ITEM_ORDER_BY = [{ sortOrder:'asc' },{ flashPrice:'asc' },{ variationId:'asc' },{ id:'asc' }]`

- [ ] **Step 1: Test đỏ** `flash-slots.spec.ts`: `slotStatus` ở ba mốc; `vnDayStart(new Date('2026-11-01T18:00:00Z'))` (01:00 ngày 2 giờ VN) là `2026-11-01T17:00:00Z`; `vnHorizonEnd` cùng mốc đó là `2026-11-03T17:00:00Z`; `parseSlotClocks(['20:00','12:00','12:00','25:99','x'])` là `['12:00','20:00']`, `parseSlotClocks(null)` và `[]` là mặc định; `slotStartsFor` lúc 13:00 VN, hai khung, 2 ngày ra 4 mốc (12:00 hôm nay còn vì 12:00 + 120 phút > 13:00), lúc 14:00 VN ra 3 mốc (12:00 hôm nay bị bỏ).
- [ ] **Step 2: Chạy**: `cd apps/api && npx jest src/modules/flash-sale/flash-slots.spec.ts`, đỏ.
- [ ] **Step 3: Cài hàm theo chữ ký trên** (VN = UTC+7 không DST: cộng/trừ `7*3600e3`).
- [ ] **Step 4: Thêm cột + migration**; `ACTIVE_FLASH_ORDER_BY` có `sortOrder` đứng đầu (spec `flash-sale.service.spec.ts` ghim thứ tự `orderBy` nếu có thì sửa theo). Chạy `npx prisma generate`, jest hai file, xanh.
- [ ] **Step 5: Commit** `feat(api): FlashSaleItem.sortOrder và hàm thuần khung giờ Giờ vàng`

### Task 3: API, endpoint khung giờ + `listActive` mở rộng + `FLASH_LIMIT`

**Files:**
- Modify: `flash-sale.service.ts`, `flash-sale.controller.ts`, `flash-sale-admin.controller.ts`, `flash-sale.service.spec.ts`, `flash-sale.controller.spec.ts`
- Modify: `apps/api/src/modules/checkout/checkout.service.ts` (dòng ném `FLASH_OVER_LIMIT_MSG`), `affiliate/affiliate.service.ts` (cùng chỗ) và spec hai file

**Interfaces:**
- Produces (service):
  - `listSlots(now?: Date): Promise<{ serverNow: string; slots: FlashSlotDTO[] }>`; `FlashSlotDTO = { id; title; startAt: string; endAt: string; status: FlashSlotStatus; itemCount: number }`, xếp theo `startAt`
  - `listSlotItems(slotId: string, now?: Date): Promise<{ serverNow: string; slot: FlashSlotDTO; items: FlashSlotItemDTO[] }>` (404 `NotFoundException` khi lạ/tắt; đã kết thúc → `items: []`); `FlashSlotItemDTO = { itemId; variationId; variationName: string|null; productId; productSlug; productName; thumbnail; categoryIds: string[]; flashPrice; retailPrice; salePrice: number|null; soldCount; quota; soldOut: boolean; perUserLimit }`, đủ `SLOT_ITEM_ORDER_BY`
  - `listActive(now?: Date, limit?: number)`: thêm `saleId`, `title`, `startAt`, `perUserLimit` vào mỗi dòng
  - `overLimitError(tx: Prisma.TransactionClient, flashSaleItemId: string): Promise<BadRequestException>` và hằng `FLASH_LIMIT = 'FLASH_LIMIT'`, `flashOverLimitMessage(n: number): string` = "Giá Giờ vàng chỉ áp cho {n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé."
  - `setItemSortOrder(itemId: string, sortOrder: number, actor?: CouponActor)`
- Endpoint: `GET /flash-sales/slots`, `GET /flash-sales/slots/:id/items` (`@Public() @PublicCache('LIVE')`); `GET /flash-sales/active?limit=` (`@Query('limit')` số nguyên 1–50, tuỳ chọn); admin `PATCH /admin/flash-sales/items/:itemId` body `{ sortOrder: number }`; `AddItemDto.sortOrder?: number`.
- Cache RAM 3 giây theo khoá (`slots`, `slot:<id>`), gom request đồng thời, kẹp tối đa 50 khoá; `serverNow` gắn sau khi đọc cache.

- [ ] **Step 1: Test đỏ** (service, prisma giả như spec hiện có): (a) `listSlots` chỉ trả đợt active chưa kết thúc có món, `status` đúng, xếp theo `startAt`, loại đợt `endAt <= now`; (b) `listSlotItems` giữ món `soldCount>=quota` với `soldOut:true`, món `stock=0` cũng `soldOut:true`, loại món không còn rẻ hơn giá đang bán, đúng thứ tự, đợt kết thúc → `items:[]` + `status:'ENDED'`, id lạ → `NotFoundException`; (c) `listActive` có `perUserLimit/saleId/title/startAt`, `limit=2` cắt còn 2; (d) `overLimitError` đọc `perUserLimit` của suất và ném `{ code:'FLASH_LIMIT', limit:5, message: 'Giá Giờ vàng chỉ áp cho 5 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.' }`; (e) cache: hai lần gọi trong 3 giây chỉ một lần đọc DB, `serverNow` mới ở lần hai; (f) controller: hai route công khai, `limit` ngoài 1–50 bị bỏ qua hoặc 400.
- [ ] **Step 2: Checkout/affiliate**: test đỏ cũ-mới: `OVER_LIMIT` ném đúng body trên (`checkout.service.spec.ts`, `affiliate.service.spec.ts` đổi chỗ so với `FLASH_OVER_LIMIT_MSG`); `FLASH_OVER_LIMIT_MSG` giữ export (client cũ) nhưng không còn ném.
- [ ] **Step 3: Cài** theo Interfaces; `listSlots`/`listSlotItems` dùng `SELLABLE_VARIATION_WHERE`, `isStillDiscounted`, `publicImage('product', …)`; `categoryIds` lấy từ quan hệ danh mục của sản phẩm (kiểm schema `Product` lúc làm); `overLimitError` chạy trên `tx` đang mở.
- [ ] **Step 4: Chạy** `npx jest src/modules/flash-sale src/modules/checkout/checkout.service.spec.ts src/modules/affiliate/affiliate.service.spec.ts`, xanh. `npx tsc -p apps/api --noEmit`.
- [ ] **Step 5: Commit** `feat(api): /flash-sales/slots, /slots/:id/items, listActive mở rộng, lỗi FLASH_LIMIT`

### Task 4: Race, hai khách mua món cuối suất

**Files:**
- Create: `apps/api/test/integration-race/flash-slot-last-unit.race-spec.ts` (theo mẫu `r13-flash-*.race-spec.ts` gần nhất)

- [ ] **Step 1: Viết spec**: một suất `quota=1, perUserLimit=5`, hai khách có giỏ cùng một biến thể, `Promise.all` hai lần đặt đơn. Assert: đúng 1 đơn thành công, người kia nhận `PRICE_CHANGED`, `soldCount===1`, `flash_sale_purchases` đúng 1 dòng; ca thứ hai: một khách đặt 3 khi `perUserLimit=2` (giỏ tính đủ suất rồi hạ `perUserLimit` giữa chừng) nhận `code:'FLASH_LIMIT', limit:2`; ca thứ ba: sau đơn thắng `GET /slots/:id/items` báo `soldOut:true`.
- [ ] **Step 2: DB riêng**: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25545`, tạo DB `tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25545/tubutree_it`, `npx prisma migrate deploy`.
- [ ] **Step 3: Chạy** `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/flash-slot-last-unit.race-spec.ts`, ghi kết quả vào mục "Kết quả đo" cuối file này.
- [ ] **Step 4: Commit** `test(race): hai khách mua món cuối suất Giờ vàng`

### Task 5: app-core, kiểu, query, logic dùng chung

**Files:**
- Modify: `packages/app-core/src/api/flash-sale.ts`, `queries/flash-sale.ts` (+ spec đã có)
- Create: `packages/app-core/src/commerce/flash-slots.ts`, `flash-slots.spec.ts`, `commerce/flash-limit.ts`, `flash-limit.spec.ts`

**Interfaces:**
- Produces (`api/flash-sale.ts`): `FlashSlot`, `FlashSlotItem`, `FlashSlotsResponse`, `FlashSlotItemsResponse` (cùng hình DTO ở Task 3, ngày là chuỗi ISO), `fetchFlashSlots(http): Promise<FlashSlotsResponse>`, `fetchFlashSlotItems(http, slotId): Promise<FlashSlotItemsResponse>` (cả hai `anonymous: true`, gọi `syncServerClock(res.serverNow)`); `FlashSaleActiveItem` thêm `saleId?`, `title?`, `startAt?`.
- Produces (`queries/flash-sale.ts`): `flashSlotsQuery(http)` khoá `['flash-sales','slots']`; `flashSlotItemsQuery(http, id)` khoá `['flash-sales','slots',id,'items']`.
- Produces (`commerce/flash-slots.ts`):
  - `slotTabs(slots: FlashSlot[], now: number): SlotTab[]` (bỏ `ENDED`, tối đa 5, theo `startAt`); `SlotTab = { id: string; clock: string; caption: string; spoken: string; status: FlashSlotStatus }`, `caption` ∈ {"Đang diễn ra","Sắp diễn ra","Ngày mai"} (Ngày mai = khác ngày VN với `now`), `spoken` = "12:00, đang diễn ra"
  - `initialSlotId(slots: FlashSlot[], now: number): string | null` (LIVE sớm nhất, không có thì UPCOMING sớm nhất)
  - `slotAfterEnd(slots: FlashSlot[], endedId: string, now: number): string | null` (khung kế của khung vừa hết)
  - `tabKeyTarget(key: string, index: number, count: number): number | null` (ArrowRight/ArrowLeft quay vòng, Home 0, End count-1, phím khác null)
  - `FLASH_CHIP_MIN_ITEMS = 12`; `slotCategoryChips(items: FlashSlotItem[], categories: { id: string; name: string; children?: { id: string }[] }[]): { id: string; name: string; count: number }[]` (rỗng khi `items.length < FLASH_CHIP_MIN_ITEMS`; chỉ danh mục có ≥1 món, tính cả con)
  - `slotListView(items: FlashSlotItem[], categoryId: string | null, categories): FlashSlotItem[]` (lọc theo danh mục cha gồm con; món `soldOut` xuống cuối, giữ thứ tự tương đối)
- Produces (`commerce/flash-limit.ts`): `FLASH_LIMIT_CODE = 'FLASH_LIMIT'`; `flashLimitNotice(err: unknown): string | null` (mã `FLASH_LIMIT` và có `limit` số → `fillCopy('flash.overLimitError', { n })`; có mã mà thiếu `limit` → `message` của lỗi; không phải mã này → null); `limit` đọc ở `err.limit` (ApiError web) hoặc `err.response.data.limit` (Mini).

- [ ] **Step 1: Test đỏ**: `slotTabs` (2 hôm nay + 1 ngày mai → caption/spoken đúng, loại ENDED, cắt 5), `initialSlotId` ba nhánh, `slotAfterEnd`, `tabKeyTarget` (quay vòng, Home/End, 'a' → null), `slotCategoryChips` (11 món → rỗng, 12 món hai danh mục → hai chip kèm số, danh mục cha tính món của con), `slotListView` (hết suất xuống cuối, lọc cha), `flashLimitNotice` (Mini + web + thiếu limit + mã khác). Query key và `fetchFlashSlots` gọi đúng đường dẫn, `anonymous`.
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/commerce/flash-slots.spec.ts src/commerce/flash-limit.spec.ts src/api/flash-sale.spec.ts src/queries/queries.spec.ts`, đỏ.
- [ ] **Step 3: Cài** theo Interfaces (giờ VN dùng `slotClock` của `merch/flash-next-slot.ts`).
- [ ] **Step 4: Chạy lại, xanh; `npx tsc -p packages/app-core --noEmit`.**
- [ ] **Step 5: Commit** `feat(app-core): khung giờ Giờ vàng, chip danh mục, câu lỗi FLASH_LIMIT`

### Task 6: Mini App, `SlotTabs`, màn `/flash-sale`

**Files:**
- Create: `apps/miniapp/src/components/ui/slot-tabs.tsx` (+ spec), `apps/miniapp/src/components/flash/flash-slot-item.tsx` (+ spec), `apps/miniapp/src/pages/flash-sale.tsx` (+ spec)
- Modify: `apps/miniapp/src/components/ui/product-tile.tsx` (prop `action`), `components/app.tsx` (`lazy(() => import('../pages/flash-sale'))` + `<Route path="/flash-sale">`), `packages/app-core/src/route-map.json` (`{ "miniapp": "/flash-sale", "web": "/gio-vang", "private": false }` trong lane `shop`), `apps/miniapp/src/services/api.ts` (`PUBLIC_GET_PATHS` thêm `/^\/flash-sales\/slots(?:\/[^/]+\/items)?$/` và `/^\/flash-sales\/upcoming$/` không được thêm: dùng token nếu có) + `auth-gate.spec.ts`; `i18n`: không thêm khoá nếu không buộc

**Interfaces:**
- Consumes: Task 5 (`slotTabs`, `initialSlotId`, `slotAfterEnd`, `tabKeyTarget`, `slotListView`, `slotCategoryChips`, `flashSlotsQuery`, `flashSlotItemsQuery`), `Countdown`, `FlashSoldBar`, `ProductTile`, `Chip`, `fetchUpcomingFlashSales`/`setFlashReminder`/`cancelFlashReminder` (shop-api), `useAuthStore().login`.
- Produces: `SlotTabs` props `{ tabs: SlotTab[]; value: string; onChange(id: string): void; panelId: string }` (tablist + tab; `slotTabId(id)` xuất ra để panel dùng `aria-labelledby`); `FlashSlotItem` props `{ item: FlashSlotItem; slotStatus: FlashSlotStatus; reminded: boolean; remindPending: boolean; onBuy(): void; onToggleRemind(): void }`; `ProductTile` thêm `action?: ReactNode` (chỉ biến thể `line`, đặt chỗ `AddButton`, bọc `onClick stopPropagation`).
- Màn: tiêu đề trang "Giờ vàng" (Fraunces, Q1) + `Countdown mode="clock"` của khung đang chọn nếu LIVE (UPCOMING dùng `kind="starts"` dạng chữ); `SlotTabs`; chip danh mục (`Chip`, `aria-pressed`); danh sách `ProductTile variant="line"` mỗi dòng có `FlashSoldBar` ở `footer` và `action` là Mua ngay (LIVE) hoặc Nhắc tôi/Đã đặt nhắc (UPCOMING, `aria-pressed`, tên "Nhắc tôi {tên}" / "Bỏ nhắc {tên}"); dòng "Mỗi khách tối đa {n}" qua `note`; món `soldOut` mờ (`opacity .55`), nút khoá `aria-disabled`; vùng `role="status"` báo "Khung {giờ} đã kết thúc" một lần khi `Countdown.onEnd`, rồi chuyển sang `slotAfterEnd`. Khách chưa đăng nhập: `onBuy`/`onToggleRemind` gọi `login()`. Trạng thái: tải (khung chờ cao bằng thật), không khung (`flash.emptyTitle/Body/Cta` → `/browse`), lỗi (`ErrorState` + Thử lại), khung đã kết thúc (`flash.endedTitle`, `flash.endedCta`). `reminded` lấy từ `fetchUpcomingFlashSales` ghép theo `itemId`; đặt/bỏ nhắc cập nhật lạc quan, báo `flash.remindedToast`/`unremindToast` qua `useNotify`.

- [ ] **Step 1: Test đỏ**: `slot-tabs.spec.tsx` (role tablist + `aria-label="Khung giờ"`, `tabIndex` 0/-1, ArrowRight/Left/Home/End đổi tab và đổi focus theo roving, Enter/Space chọn, `aria-controls` = `panelId`, đổi tab bằng chuột không dời focus khỏi tab); `flash-slot-item.spec.tsx` (tên dài 80 ký tự + `thumbnail:null`, `quota:0` không NaN, `soldOut` mờ + nút `aria-disabled`, nhãn nhắc `aria-pressed`); `flash-sale.spec.tsx` (guest bấm Nhắc tôi → `login` được gọi, không lời gọi remind; đã đăng nhập bấm → `POST /flash-sales/items/:id/remind`; `Countdown.onEnd` chuyển sang khung kế; không khung → trạng thái rỗng; API 500 → Thử lại; id đã kết thúc → `endedTitle`).
- [ ] **Step 2: Chạy** `cd apps/miniapp && npx vitest run src/components/ui/slot-tabs.spec.tsx src/components/flash src/pages/flash-sale.spec.tsx src/components/ui/product-tile.spec.tsx src/services/auth-gate.spec.ts`, đỏ.
- [ ] **Step 3: Cài** (cổng `ecc:make-interfaces-feel-better` + `ui-ux-pro-max`: tab chọn gạch dưới 3px `--color-border-selected`, ô số đồng hồ nền tối, dòng `line` cao ≥80, nút Mua ngay `Button variant="flash"` vùng chạm 44 nhưng rộng ≤96 để tên không bị bóp; không số px mới viết tay nếu đã có token). Thêm `action` vào `ProductTile`.
- [ ] **Step 4: Chạy lại, xanh; `npx tsc -p apps/miniapp --noEmit`; `pnpm lint:parity`** (route-map đã có dòng, web `gio-vang/page.tsx` do Task 7 tạo: chạy parity sau Task 7).
- [ ] **Step 5: Commit** `feat(miniapp): trang Giờ vàng theo khung giờ (/flash-sale)`

### Task 7: Web, `SlotTabs`, trang `/gio-vang`

**Files:**
- Create: `apps/web/src/components/mini/slot-tabs.tsx` (+ spec, xuất ở `mini/index.ts`), `apps/web/src/components/flash/flash-slot-item.tsx` (+ spec), `apps/web/src/app/gio-vang/page.tsx` (server, `metadata` title "Giờ vàng | Tubu Tree"), `apps/web/src/app/gio-vang/flash-slots-view.tsx` (client, + spec)
- Modify: `apps/web/src/components/mini/product-tile.tsx` (prop `action`), `apps/web/src/components/home/shortcut-visuals.ts` (chú thích), sitemap nếu liệt kê trang tĩnh

**Interfaces:**
- Consumes/Produces: cùng tên, cùng props với Task 6 (web: `import { SlotTabs } from '@/components/mini'`); guest → `router.push(loginHref(\`${pathname}${search}\`))`; `HubLayout`/`ListingLayout` không dùng: từ md trang giữ cột một, `max-w` như `/uu-dai`; dữ liệu qua `coreHttp` + React Query (khung chờ khi tải, không SSR dữ liệu để không lệch HTML).
- [ ] **Step 1: Test đỏ**: spec tương ứng Task 6 (SlotTabs bàn phím, item, view với guest đi `/dang-nhap?...`, rỗng/lỗi/đã kết thúc).
- [ ] **Step 2: Chạy** `cd apps/web && npx vitest run src/components/mini/slot-tabs.spec.tsx src/components/flash src/app/gio-vang`, đỏ.
- [ ] **Step 3: Cài**; số đo dòng/tab khớp Mini (so ảnh 375px ở Task 9).
- [ ] **Step 4: Chạy lại, xanh; `npx tsc -p apps/web --noEmit`; `pnpm lint:parity` xanh.**
- [ ] **Step 5: Commit** `feat(web): trang Giờ vàng theo khung giờ (/gio-vang)`

### Task 8: Câu lỗi `FLASH_LIMIT` ở thanh toán và giỏ

**Files:**
- Modify: `apps/miniapp/src/pages/checkout.tsx` (nhánh `isCartFixableError`, dòng ~1321), `apps/web/src/lib/checkout-rules.ts` (+ spec), `apps/web/src/app/thanh-toan/page.tsx` (nhánh `isCartFixableError`), `apps/web/src/app/gio-hang/page.spec.tsx`, spec Mini `checkout`

**Interfaces:**
- Consumes: `flashLimitNotice(err)` (Task 5).
- Produces: lỗi `FLASH_LIMIT` (hoặc câu cũ) → thông báo "sửa ở giỏ" với chữ `flashLimitNotice(err) ?? message`, kèm đường về giỏ như các lỗi tồn kho.

- [ ] **Step 1: Test đỏ**: Mini: `placeOrder` bị từ chối `{ response:{ status:400, data:{ code:'FLASH_LIMIT', limit:2, message:'...' } } }` → màn hiện đúng "Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé." và giỏ được tải lại; web: `new ApiError(msg, 400, 'FLASH_LIMIT')` → cùng câu (dùng message vì `ApiError` không giữ `limit`); câu cũ "Vượt giới hạn mua ưu đãi." vẫn là lỗi sửa-ở-giỏ.
- [ ] **Step 2: Chạy** các spec tương ứng, đỏ. **Step 3: Cài.** **Step 4: Xanh.**
- [ ] **Step 5: Commit** `feat(checkout): hiện câu FLASH_LIMIT của Giờ vàng ở Mini và web`

### Task 9: e2e, ảnh 375px, đo bundle

**Files:**
- Create: `apps/e2e/tests/support/flash-slot-mocks.ts`, `apps/e2e/tests/flash-slots.miniapp.spec.ts`, `apps/e2e/tests/flash-slots.web.spec.ts` (chạy ở CI, cần API thật)
- Modify: `apps/e2e/tests/home-p6.miniapp.spec.ts`/`home-merged.*` nếu còn khoá trạng thái chờ (e2e Mini đỏ do ô Giờ vàng trở lại thì sửa theo thiết kế), `apps/e2e/tests/support/tour.ts` (`TOUR['/flash-sale']`)

- [ ] **Step 1: Viết e2e Mini** (API giả 100%): persona đã đăng nhập: mở `/flash-sale`, thấy tab "12:00" đang diễn ra + "20:00" sắp diễn ra, 14 món → chip danh mục hiện, món hết suất mờ cuối, chuyển sang tab 20:00 bằng phím mũi tên, bấm Nhắc tôi → `POST /flash-sales/items/:id/remind`; persona guest (`/auth/*` trả 401 `ACCOUNT_BLOCKED`): xem được trang, bấm Nhắc tôi → có lời gọi `/auth/guest` hoặc `/auth/zalo-mini-app` và không có `POST remind`; ô Giờ vàng là ô đầu của lối tắt Trang chủ; "Xem tất cả" Giờ vàng dẫn `/flash-sale`.
- [ ] **Step 2: Chạy** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3313 npx playwright test flash-slots.miniapp --reporter=line`, xanh.
- [ ] **Step 3: Ảnh 375px** Trang chủ (có ô Giờ vàng) và `/flash-sale` ở Mini (Vite dev 3313) và web (Next dev 3314, API giả), lưu `docs/2026-10-31-shop-redesign/screens/P12/`, so hai bản, sửa lệch; tắt server.
- [ ] **Step 4: Bundle**: `node scripts/ci/bundle-budget.cjs apps/miniapp/www` sau `pnpm --filter miniapp build`; ghi entry trước/sau.
- [ ] **Step 5: Commit** `test(e2e): trang Giờ vàng Mini (đăng nhập và khách), ô Giờ vàng ở Trang chủ`

### Task 10: `flashsale.slots` + sinh khung giờ (admin) — làm lại ở vòng review 2

**Files:**
- Modify: `apps/api/src/modules/system-config/system-config.service.ts` (`JSON_RULES['flashsale.slots']`), `apps/api/prisma/seed.ts` (`createOnly`), `reference-config-selection.spec.ts` + `system-config.service.spec.ts` theo cách P3a đã thêm `catalog.loved_min_*`; `flash-sale.service.ts` (`generateSlots`), `flash-sale-admin.controller.ts` (`POST /admin/flash-sales/generate-slots`), spec

**Interfaces:**
- Produces: `generateSlots(adminId: string, days: number, now?: Date): Promise<{ created: number; skipped: number }>` (đọc `flashsale.slots` qua `parseSlotClocks`, `days` 1–7, mỗi mốc từ `slotStartsFor` tạo một `FlashSale` rỗng `title: 'Giờ vàng HH:MM'`, `endAt = startAt + FLASH_SLOT_MINUTES`; bỏ mốc đã có đợt cùng `startAt`; qua `assertSaleWindow`); luật ghi `flashsale.slots`: mảng 1–6 chuỗi `HH:MM` hợp lệ, tăng dần, không trùng.

- [ ] **Step 1: Test đỏ**: cấu hình `["09:30"]` → khung 09:30; mặc định `["12:00","20:00"]` khi không cấu hình; chạy hai lần không tạo trùng; mốc đã kết thúc bị bỏ; `days=8` → 400; luật ghi từ chối `["25:00"]`, `[]`, trùng.
- [ ] **Step 2–4: Chạy đỏ, cài, xanh** (`npx jest src/modules/flash-sale src/modules/system-config`).
- [ ] **Step 5: Commit** `feat(api): cấu hình flashsale.slots và sinh khung giờ Giờ vàng cho admin`

### Task 11: Admin, thứ tự món + nút sinh khung — làm lại ở vòng review 2

**Files:**
- Create: `apps/web/src/components/admin/flash-item-order.tsx` (+ spec), `apps/web/src/components/admin/flash-slot-generator.tsx` (+ spec)
- Modify: `apps/web/src/app/admin/page.tsx` (hai dòng gắn component trong `FlashSalesTab`/`FlashSaleRow`), file API admin của web (`updateFlashItemOrder(itemId, sortOrder)`, `generateFlashSlots(days)`), kiểu `AdminFlashSale.items[].sortOrder`, `listSales` select thêm `sortOrder`

- [ ] **Step 1: Test đỏ**: ô "Thứ tự" nhập số nguyên ≥0 gọi `PATCH`, lỗi hiện chữ; nút "Tạo khung giờ 2 ngày tới" gọi `POST`, báo "Đã tạo n khung, bỏ qua m".
- [ ] **Step 2–4: Đỏ, cài, xanh** (`cd apps/web && npx vitest run src/components/admin/flash-*.spec.tsx`).
- [ ] **Step 5: Commit** `feat(admin): đặt thứ tự món và sinh khung giờ trong tab Giờ vàng`

### Task 12: Đo CLS trang chi tiết SP của web (Giờ vàng, 375px)

**Files:**
- Create (nếu cần sửa): `apps/web/src/app/san-pham/[slug]/pdp-extras.tsx`, `page.tsx`, spec tương ứng; đo bằng script Playwright tạm trong scratchpad (không commit)

- [ ] **Step 1: Đo**: Next dev cổng 3314 + API giả (sản phẩm có suất Giờ vàng đang chạy, `/flash-sales/active` trả suất), Playwright iPhone 375px, `PerformanceObserver({ type:'layout-shift', buffered:true })`, tổng CLS ba lần.
- [ ] **Step 2: Quyết**: CLS > 0,1 → test đỏ (`pdp-extras.spec`: `PdpFlashBar` có trong HTML ban đầu khi server truyền `initialFlash`) rồi tải `/flash-sales/active` ở server (`fetch` `revalidate: 5`) làm `initialData`; còn không thì ghi số đo vào "Kết quả đo" cuối file này, không đổi mã.
- [ ] **Step 3: Commit** (chỉ khi sửa mã) `fix(web): PDP Giờ vàng có dữ liệu từ server, hết nhảy trang`; nếu không, commit chung với Task 13.

### Task 13: Gate cuối, bàn giao

- [ ] **Step 1:** `npx prisma generate` (apps/api); dừng mọi server chụp ảnh của mình.
- [ ] **Step 2:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P12 --base 77433c0d0 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P12.txt`, mỗi FAIL phải PASS hoặc có chứng cứ "có sẵn từ base".
- [ ] **Step 3:** e2e Mini đủ bộ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3313 npx playwright test --workers=2 --reporter=line`; đỏ do thiết kế (chip 36px + vùng chạm 44px: `tests/support/hit-area.ts`) thì sửa test, đỏ do hồi quy thì sửa mã.
- [ ] **Step 4:** race spec Task 4 chạy lại trên DB riêng; `pg-native.sh stop 25545`.
- [ ] **Step 5:** ghi "Lệch kế hoạch" và "Kết quả đo" dưới đây, commit `docs(P12): kế hoạch cập nhật, số đo, bàn giao`.

## Điều chỉnh lúc làm

- **Task 10 và 11 làm đủ (vòng review 2)**: vòng đầu đã cắt cả hai (đề ghi ưu tiên thấp nhất) và ghi "cần chủ duyệt", review báo đó là lệch luật §4 Q14 và thiếu test bắt buộc của gói, nên khôi phục từ `cbfab6873` thay vì chờ duyệt. Có: `parseSlotClocks`, `slotStartsFor`, `flashSlotsProblem` (luật ghi) và `vnClock` ở `flash-slots.ts`; khoá `flashsale.slots` (`JSON_RULES` + seed `createOnly` + bảng khoá đã duyệt ở `reference-config-selection.spec.ts` + bảng ghi hợp lệ/sai ở `system-config.service.spec.ts`); `FlashSaleService.generateSlots` và `POST /admin/flash-sales/generate-slots` (MARKETING, đã vào bảng quyền nhân viên); ở tab Giờ vàng của admin có nút "Tạo khung giờ 2 ngày tới" (`flash-slot-generator.tsx`) và ô "Thứ tự" + nút Lưu cho từng món (`flash-item-order.tsx`, gọi `PATCH /admin/flash-sales/items/:itemId`).
  - `generateSlots`: `days` nguyên 1 đến 7; đọc `flashsale.slots` qua `parseSlotClocks` (khoá hỏng về 12:00/20:00); mốc đã kết thúc bị bỏ; mốc đã có đợt cùng `startAt` (kể cả đợt tắt) bị bỏ qua nên bấm hai lần không trùng; đợt rỗng `Giờ vàng HH:MM`, dài 120 phút, `createdBy` là người bấm; tra trùng và ghi cùng một giao dịch dưới khoá `pg_advisory_xact_lock(hashtext('flash.generate_slots'))`. Không đọc `flashsale.slots` ở `GET /slots` (xem Quyết định): khoá chỉ là lưới để sinh đợt.
  - Ô "Thứ tự" cho nhập số nguyên từ -1000 đến 1000 (cùng biên với DTO API; kế hoạch ghi "≥0" nhưng số âm là cách ghim lên trước các món mặc định 0 mà không phải sửa từng món khác). Lưu bằng nút, không lưu khi rời ô.
  - Khoá `flashsale.slots` nằm ở seed `createOnly`, tức PROD chỉ có dòng này sau khi chạy nạp dữ liệu tham chiếu; chưa nạp thì `generateSlots` vẫn chạy bằng giá trị mặc định ở mã (12:00, 20:00).
- **Nhắc tôi sau đăng nhập không tự đặt lại**: khách phải bấm lần nữa (đã ghi ở phần Quyết định).
- **Lỗi tìm ra khi viết e2e Mini**: chạm Mua ngay hoặc Nhắc tôi lúc phiên còn `loading` làm `login()` chạy song song với `restore()` của app. Trang `/flash-sale` giờ bỏ qua lần chạm đó (fdbf503d0); e2e đợi `GET /flash-sales/upcoming` (chỉ đi khi đã đăng nhập) trước khi bấm.
- **Bảng quyền nhân viên**: gate bắt được `PATCH /admin/flash-sales/items/:itemId` chưa có trong `staff-permissions.matrix.spec.ts`; thêm với nhóm MARKETING (1fc6d1a2e).
- **Web**: `ApiError` của web không mang `limit`, nên câu FLASH_LIMIT ở thanh toán web lấy nguyên câu máy chủ (đã có số). Tiêu đề trang web dùng "—" thay "|" như các trang khác. CTA của trạng thái rỗng đẩy `/san-pham`.
- **File ngoài phạm vi gói phải sửa**: `merch/shelves.spec.ts` và `route-map.json` (hết cờ pending), `components/home/flash-sale.tsx` của web (chuyển `flashCardProduct` sang `lib/flash-display.ts`), `page-titles.spec.ts`, `components/mini/index.ts` (xuất `SlotTabs`), `ProductTile` ở cả hai app (thêm `action`).
- **Có sẵn từ base, không phải của gói**: `visual-tour.*` ném "thiếu cấu hình cho route /offers" (route-map có `/offers`, `support/tour.ts` chưa có mục) khi chạy với `VISUAL_DIR`; CI thường bỏ qua file này. Gói chỉ thêm mục `/flash-sale` vào `TOUR`.
- **Spec web `flash-slots.web.spec.ts` đã chạy cục bộ ở vòng sửa review**: Next dev cổng 3314, `API_BASE_URL` trỏ cổng chết (trang `/gio-vang` là server component tĩnh, không gọi API lúc SSR; chỉ trang chủ `/` ném `ApiUnavailableError`, nên thăm dò sẵn sàng phải trỏ `/gio-vang`, không phải `/`), config Playwright tạm (đã xoá) chỉ gồm hai project "Web Customer Mobile" (Pixel 7) và "Web Customer". 12/12 xanh, gồm ca khách chưa đăng nhập bấm Nhắc tôi đi `/dang-nhap?returnTo=%2Fgio-vang`. Lần đầu 2 ca mobile đỏ vì route `/thanh-toan` và `/dang-nhap` còn biên dịch lần đầu (> 5 giây của `toHaveURL`); khởi động máy chủ trước và gọi `curl` làm nóng ba route thì xanh. CI dùng `next build` nên không gặp.
- **Vòng review 1** (sửa ở commit `fix(flash)`):
  - Khung sắp diễn ra không vẽ `FlashSoldBar` (chữ "Vừa mở bán" nói ngược "Bắt đầu sau ..."); chỗ thanh để trống cao 20px đúng như khi khung đang diễn ra để thẻ không nhảy lúc khung mở. Chỉ khung đang diễn ra mới có chữ "Vừa mở bán" (đúng `ux-copy.md` B1).
  - Tab khung giờ và đồng hồ dính (thiết kế §5) trong một khối `data-testid="flash-sticky"`; tabpanel chỉ còn chip và danh sách. **Mini: `top` của phần tử dính đo từ mép NỘI DUNG của `.zaui-page`** (đã đo cả WebKit lẫn Chromium: với `top: calc(var(--safe-top) + 56px)` tab dính ở y=104 vì `.page` đệm đầu 48px, để lộ khe 48px cho thẻ món cuộn qua dưới thanh nút lùi). Dùng `top: 8px` (56 trừ 48, không phụ thuộc tai thỏ) cho ra y=56 đúng dưới thanh. Vì vậy không dùng lớp `sticky-below-back` ở Mini (nó ép `top` bằng 56px + vùng an toàn). Web cuộn bằng `window` nên không dính đệm: dùng `sticky-below-back` + `top-[var(--header-h)]` (điện thoại 56px dưới thanh nút lùi, máy tính dưới thanh đầu trang của site); e2e đo cả Pixel 7 và Desktop Chrome. **Gói khác nên kiểm**: `STICKY_TOP = calc(var(--safe-top) + 56px)` ở `brand-view.tsx` và `storefront-view.tsx`, lớp `sticky-below-back` ở `game.tsx` của Mini có thể cùng bị dính thấp 48px nếu `Page` của chúng là `.page` có đệm đầu (chưa đo, ngoài phạm vi gói).
  - Nhãn trái đồng hồ đổi từ `flash.slotLive` (lặp chú thích tab) sang khoá mới `flash.endsLabel` = "Kết thúc sau" (ngân sách 12, có spec). Khoá mới là bắt buộc nên vượt "không thêm khoá"; chữ nhìn thấy `aria-hidden` vì tên đọc của `role="timer"` đã là "Kết thúc sau ...".
  - Món hết suất: chỉ ảnh (prop mới `dimMedia` của `ProductTile`, cả hai app) và nút (`opacity: .55`, nút `aria-disabled` nên không tính tương phản chữ) mờ; tên, giá, ghi chú, thanh "Đã bán hết" giữ nguyên để không tụt dưới 4,5:1 (mờ cả hàng với opacity .55 kéo chữ chính xuống cỡ 3,9:1). Giá vẫn cam nên món hết suất bớt "mờ" hơn bản trước; chọn đánh đổi này để P17 (axe) không báo.
- **Vòng review 2** (MAJOR Q14 ở bullet "Task 10 và 11 làm đủ" ở trên):
  - MINOR nút Nhắc tôi ở món hết hàng thật trong khung sắp mở: nút khoá (`aria-disabled`, mờ như ảnh, bấm không làm gì) ở cả hai app; **riêng khách đã đặt nhắc từ trước vẫn bỏ nhắc được** (khác đề xuất gốc, vì khoá luôn thì khách kẹt với một thông báo không tắt được). Mỗi app có 3 ca vitest (hết hàng chưa nhắc, hết hàng đã nhắc, còn hàng).
  - MINOR `route-fallback`: trả dòng vòng lặp ca "Bán chạy nhất và Mã giảm giá..." ở `route-fallback.spec.ts` về như base (ca riêng của `/flash-sale` ở đầu file đã khẳng định `routeUsable('/flash-sale')`) và trả câu đầu chú thích `route-fallback.ts` về như base. **Câu đó nay lỗi thời** (còn ghi `/flash-sale` P12 chưa có trang): người gộp P12 với P13 xoá "`/flash-sale` P12," khỏi câu cùng lúc với "`/best-sellers` P13,".
  - **Chỗ chắc chắn xung đột khi gộp P12 với P13** (cùng file `route-fallback.ts`/`.spec.ts`, các dòng liền kề nên git tính là một đoạn): dòng `'/flash-sale': { ..., pending: false }` kề dòng `'/best-sellers'` trong `ENTRIES`; hai dòng `liveRoute('/flash-sale', ...)` kề hai dòng `liveRoute('/best-sellers', ...)` trong spec. Giữ cả hai thay đổi (flash-sale: `pending:false`, `/flash-sale` đi thẳng; best-sellers: theo P13).
  - Race mới `flash-generate-slots.race-spec.ts`: 5 admin bấm "Tạo khung giờ" cùng lúc, 6 vòng, mỗi vòng đúng 4 đợt, `created` cộng lại 4, `skipped` cộng lại 16. Thử bỏ dòng khoá thì đỏ (20 đợt, mỗi mốc 5 bản), có khoá thì xanh.

## Kết quả đo

- **Race** (`flash-slot-last-unit.race-spec.ts`, Postgres native 25545, DB `tubutree_it`): hai khách mua món cuối đồng thời, 8 vòng, chạy 4 lần lúc làm và 1 lần cuối gói: đúng một đơn, người kia PRICE_CHANGED, `soldCount = 1`; FLASH_LIMIT kèm `limit`, đơn huỷ nguyên, suất không bị trừ; sau đơn thắng món cuối `GET /slots/:id/items` báo `soldOut`. 3 passed.
- **CLS PDP web 375×812** (Next dev + API giả, sản phẩm có suất Giờ vàng đang chạy, `layout-shift` observer): không có Giờ vàng 0,0057; có Giờ vàng 0,0957 với `/flash-sales/active` trả sau 300 ms và sau 1200 ms (phần do thanh Giờ vàng chèn dưới ảnh: 0,0900, đẩy cột thông tin xuống 136 px). Không vượt 0,1 nên không đổi mã (không `initialData`). Còn cách ngưỡng 0,004: nếu thanh Giờ vàng cao thêm hoặc khung nhìn thấp hơn thì phải làm bước server `initialData`.
- **Bundle Mini**: entry 625 KB (gate tích hợp đợt 3, base) thành 626 KB; tổng 2106 KB thành 2119 KB (chunk route `/flash-sale` riêng; tổng đã vượt mốc cảnh báo 2048 từ base). Mốc ≤ 700 KB còn dư.
- **Ảnh 375px** (Mini Vite 3313, web Next 3314, gitignored): `docs/2026-10-31-shop-redesign/screens/P12/` có `{mini,web}-home.png`, `{mini,web}-flash.png`, `{mini,web}-flash-upcoming.png`, và (vòng review 1, chụp lại sau khi sửa) `{mini,web}-flash-scrolled.png`: cuộn tới cuối khung 14 món, dải tab và đồng hồ "Kết thúc sau" ghim ngay dưới thanh nút lùi (y=56), khung sắp diễn ra không còn thanh "Vừa mở bán", món hết suất mờ ở ảnh và nút. Mô tả hai app dưới đây là của lần chụp đầu. So hai app: Trang chủ giống nhau (ô Giờ vàng đầu hàng, "Xem tất cả" ở khối Giờ vàng); trang Giờ vàng giống nhau từ tab trở xuống. Khác duy nhất là tiêu đề: Mini để chỗ cho nút Quay lại trên dòng riêng (khung `PageHeader` của Mini), web để cùng dòng; web có chân trang.
- **e2e Mini đủ bộ** (Vite 3313, 2 worker): 265 passed, 10 skipped, 0 failed. `flash-slots.miniapp.spec.ts` 8 ca; `home-p6`, `home-h`, `home-merged`, `tile-rhythm`, `mini-frame` không phải sửa.
- **Gate sau vòng review 2** (`gate-P12.txt`, `gate.sh --base 77433c0d0`, nguyên bộ một lần, HEAD sau commit `test(app-core)`): 0 FAIL. PASS shared-types, tsc x5, eslint x3, vitest-app-core 134 file/1674 test, vitest-miniapp 386/5930, vitest-miniapp-utc 386/5930, vitest-web 512/8678, jest-api 517 suite/12085 test, lint-parity, vite-build, bundle-mini (entry 626 KB, tổng 2119 KB, không đổi). Không FAIL nào "có sẵn từ base" lần này.
- **Race sau vòng review 2** (Postgres native 25545, DB `tubutree_it` dựng lại bằng `prisma migrate deploy`, đã `pg-native.sh stop 25545`): `flash-slot-last-unit` 3 passed, `flash-generate-slots` 1 passed (5 admin x 6 vòng, mỗi vòng đúng 4 đợt). Bỏ dòng khoá advisory của `generateSlots` thì spec đỏ (20 đợt thay vì 4).
- **Admin Giờ vàng chưa chụp ảnh/e2e**: nút "Tạo khung giờ" và ô "Thứ tự" kiểm bằng vitest (`flash-slot-generator.spec`, `flash-item-order.spec`, một ca ở `admin/page.spec`), chưa mở trình duyệt thật.
- **Gate sau vòng review 1** (`gate-P12.txt`, `gate.sh --base 77433c0d0`, chạy nguyên bộ một lần, HEAD sau commit `fix(flash)`): 0 FAIL. PASS shared-types, tsc x5 (api, web, miniapp, app-core, e2e), eslint x3, vitest-app-core 134 file/1674 test, vitest-miniapp 386/5927, vitest-miniapp-utc 386/5927, vitest-web 510/8664, jest-api 516 suite/12052 test, lint-parity, vite-build, bundle-mini (entry 626 KB, tổng 2119 KB, không đổi). Vòng này không đụng API nên race giữ kết quả cũ ở trên.
- **e2e vòng review 1**: `flash-slots.miniapp.spec.ts` 9/9 (Vite 3313, WebKit iPhone 12; có ca cuộn dính đo y=56); `flash-slots.web.spec.ts` 12/12 (Next dev 3314, Pixel 7 và Desktop Chrome; ca cuộn dính đo `top` đã tính và chân thanh đầu trang của site). Đo thử ở Chromium: Mini dính y=104 với `top: calc(var(--safe-top) + 56px)`, y=56 với `top: 8px`, cùng kết quả ở WebKit.
- **Gate lần đầu (trước vòng review 1)** (`gate-P12.txt` cũ, base 77433c0d0): PASS shared-types, tsc x5 (api, web, miniapp, app-core, e2e), eslint x3, vitest-app-core (134 file, 1674 test), lint-parity, vite-build, bundle-mini. Lần chạy đầu có 4 FAIL:
  - `jest-api`: thật, bảng quyền thiếu route mới; sửa ở 1fc6d1a2e, `staff-permissions.matrix.spec.ts` 50 passed.
  - `vitest-miniapp` (1 test), `vitest-miniapp-utc` (6 test), `vitest-web` (61 test): đều là "Test timed out in 5000ms" hoặc "không thấy phần tử" ở các file gói không đụng (suggest-feed, about, brand-view, browse, shop-products-tab, admin/page, brand-actions, s/[slug]/page, thanh-toan/coupon, user-detail-drawer, recycle-desk) khi máy thiếu RAM. Chạy lại riêng các file đó: 5 file Mini (TZ=UTC) 159 passed, suggest-feed 14 passed, 6 file web 425 passed. Gate tích hợp đợt 3 của base là 0 FAIL, nên đây là tải máy, không phải hồi quy.
