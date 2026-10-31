# P3a catalog-api: Kế hoạch triển khai

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development (khuyên dùng) hoặc superpowers:executing-plans để làm từng task. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** API catalog trả đủ dữ liệu cho thẻ sản phẩm mới (`fulfiller`, `isLoved`), sắp "Bán chạy nhất" theo 30 ngày, danh mục hai tầng có đếm cả con, trang thương hiệu phân trang thật, và Gợi ý liên quan xếp theo đã bán.

**Kiến trúc:** `CatalogService` đổi `toCard` đồng bộ thành `toCards` bất đồng bộ theo lô (một truy vấn gian hàng chỉ khi trang có hàng đối tác, đọc ngưỡng "Được yêu thích" từ `SystemConfigService` có mặc định trong mã). Thêm cột `Product.soldApp30d` tính trong `recomputeSoldCounts` (cron 03:00 sẵn có). `categories()` trả cây; lọc `?category=<cha>` mở rộng sang con qua bộ nhớ id con 60 giây. Route `GET /brand/public/:slug/products` đặt ở `CatalogController` (dùng chung `listPage` với `/products`, không cần `BrandModule` import `CatalogModule`).

**Tech stack:** NestJS 10, Prisma 5.22, Postgres 16, jest (`apps/api`), vitest (`packages/app-core`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 Q5, Q18 là luật). Mục P3a trong `02-ke-hoach.md`; nguồn `review/backend-gap.md` §1–2, §8 (BG-4, BG-10, BG-13); `review/ia-merch.md` IA-01, C2.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; `npx prisma generate` chạy trong `apps/api` sau khi đổi schema.
- Ngưỡng "Được yêu thích": `ratingAvg ≥ catalog.loved_min_rating` (4.8), `reviewCount ≥ catalog.loved_min_reviews` (20), `sold ≥ catalog.loved_min_sold` (50), với `sold = soldExternal + soldApp` (Q5, Q18).
- "Bán chạy nhất" 30 ngày: `soldApp30d` giảm dần, hoà theo `sold` tổng, hoà nữa theo `id` tăng (Q18). Không trộn `soldExternal` vào `soldApp30d`.
- Mọi truy vấn công khai dùng `PUBLIC_PRODUCT_WHERE` (isActive + approvalStatus APPROVED), không viết bộ lọc thứ hai.
- Danh sách phân trang theo quy ước sẵn có: `{ data, meta: { page, limit, total } }`, `limit ≤ 100`.
- Cây danh mục: `productCount` của cha cộng cả con, mỗi sản phẩm đếm một lần dù gán cả cha và con; `/products?category=<cha>` gồm sản phẩm của con.
- Chỉ P3a sửa `prisma/schema.prisma` trong đợt. Không sửa file của P1, P2, P3b (xem danh sách trong yêu cầu gói). Không sửa `interface ProductCard` ở `packages/app-core/src/api/catalog.ts` (P2 thêm `fulfiller?`, `isLoved?`).
- Comment chỉ giải thích "vì sao", tiếng Việt, theo mật độ file xung quanh. Không deploy, không đọc/ghi PROD, không `git stash` trần.

## Review Focus

1. Sản phẩm đúng ngưỡng (4,8 sao, 20 đánh giá, 50 đã bán) là `isLoved=true`, thiếu một điều kiện là `false`; ngưỡng cấu hình gõ sai (chuỗi, âm, NaN) thì dùng mặc định chứ không làm mọi thẻ thành "Được yêu thích". Test: `catalog-loved.spec.ts` và `catalog.service.spec.ts` (Task 3).
2. Đơn giao đúng 29 ngày tính, 31 ngày trước không tính, đơn đã `RETURNED` không tính, đơn không còn đơn nào thì `soldApp30d` về 0 (cột không kẹt số cũ). Test: jest `recomputeSoldCounts` và race spec (Task 1).
3. Danh mục: sản phẩm gán cả cha lẫn con đếm một lần; vòng `parentId` (A cha của B, B cha của A) hoặc id danh mục lạ không làm API treo; danh mục mồ côi (cha không còn) thành gốc. Test: jest `categories`, `list` category (Task 4).
4. Thương hiệu: slug chưa đăng 404; trang vượt tổng trả `data: []` kèm `total` đúng; sản phẩm chưa duyệt hoặc ẩn không vào `productCount` và danh sách; `limit > 100` bị 400 bởi DTO. Test: jest `listBrandProducts`, `getPublicBySlug`, DTO (Task 5).
5. Hàng đối tác: gian hàng tạm nghỉ, đã đóng là `fulfiller.kind='UNAVAILABLE'`; không tìm thấy gian hàng thì `MERCHANT` mặc định, không ném lỗi; trang toàn hàng Tubu không thêm truy vấn gian hàng. Test: `catalog.service.spec.ts` (Task 3).

## Cấu trúc file

| File | Việc |
|---|---|
| `apps/api/prisma/schema.prisma` + migration `20261031130000_product_sold_app_30d` | cột `soldApp30d` + index |
| `apps/api/src/modules/catalog/catalog-loved.ts` (+ `.spec.ts`) | khoá cấu hình, mặc định, `isLoved`, chuẩn hoá ngưỡng |
| `apps/api/src/modules/catalog/catalog.service.ts` | `toCards`, `listPage`, `listBrandProducts`, `categories` cây, `categoryScope`, `recomputeSoldCounts`, `related`, sort 30 ngày |
| `apps/api/src/modules/catalog/dto/product-query.dto.ts` | `PRODUCT_SORTS`, thêm `best_seller_30d` |
| `apps/api/src/modules/catalog/dto/brand-products-query.dto.ts` (+ spec) | query `/brand/public/:slug/products` |
| `apps/api/src/modules/catalog/catalog.controller.ts` | route `brand/public/:slug/products` |
| `apps/api/src/modules/brand/brand.service.ts` (+ spec) | `PUBLIC_PRODUCT_WHERE` cho `products`, thêm `productCount` |
| `apps/api/prisma/seed.ts`, `src/modules/system-config/system-config.service.ts`, `reference-config-selection.spec.ts` | ba khoá `catalog.loved_*`: seed, luật ghi, danh sách duyệt |
| `apps/api/test/integration-race/catalog-merch-api.race-spec.ts` | Postgres thật: cron 30 ngày, cây danh mục, thương hiệu, thẻ |
| `packages/app-core/src/api/catalog.ts` (+ spec), `api/brand.ts` (+ spec) | `CatalogSort`, `CategoryDTO`, `fetchBrandProducts`, `BrandView.productCount` |
| `apps/e2e/tests/support/discovery-mocks.ts` | thêm `children: []` cho mẫu `CategoryDTO` để tsc xanh |

## Chuẩn bị (một lần)

- [ ] Dùng worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P3a`, nhánh `shop/P3a-catalog-api`. `git status` sạch (trừ file không theo dõi sẵn có).
- [ ] Mở DB riêng: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25541`, rồi tạo DB `tubutree_it` (`pg-native.sh createdb 25541 tubutree_it`; nếu script trỏ sai đường dẫn prisma thì chạy `CREATE DATABASE tubutree_it;` bằng `npx prisma db execute --url postgresql://tubu@127.0.0.1:25541/postgres --stdin` trong `apps/api`). `export DATABASE_URL=postgresql://tubu@127.0.0.1:25541/tubutree_it`.

---

### Task 1: Cột `soldApp30d` + tính trong cron 03:00

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Product`, cạnh `soldApp`, và khối `@@index`)
- Create: `apps/api/prisma/migrations/20261031130000_product_sold_app_30d/migration.sql`
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`recomputeSoldCounts`)
- Test: `apps/api/src/modules/catalog/catalog.service.spec.ts` (describe `"đã bán"`), `apps/api/test/integration-race/catalog-merch-api.race-spec.ts` (tạo mới ở task này, các task sau thêm ca)

**Interfaces:**
- Produces: `Product.soldApp30d: number` (Prisma), `recomputeSoldCounts(): Promise<{ updated: number }>` giữ nguyên chữ ký; hằng `SOLD_WINDOW_DAYS = 30` không export.

- [ ] **Step 1: Test đỏ (jest)** trong describe `"đã bán"`: (a) hai lời gọi `orderItem.groupBy` (`mockResolvedValueOnce` cho tổng, rồi cho 30 ngày) với p1 tổng 8, 30 ngày 3 → `product.update` được gọi với `{ where: { id: 'p1' }, data: { soldApp: 8, soldApp30d: 3 } }`; (b) lời gọi thứ hai có `where: { order: { status: 'DELIVERED', deliveredAt: { gte: <Date> } } }` với `gte` cách `Date.now()` đúng 30 × 864e5 ms (dùng `jest.spyOn(Date, 'now')`); (c) p2 chỉ có trong tổng (không có trong 30 ngày) → `soldApp30d: 0`; (d) `updateMany` đưa về 0 cả hai cột: `where: { OR: [{ soldApp: { not: 0 } }, { soldApp30d: { not: 0 } }], id: { notIn: ['p1','p2'] } }`, `data: { soldApp: 0, soldApp30d: 0 }`; không có đơn nào thì bỏ `id.notIn`. Sửa hai ca cũ của describe theo dạng mới.
- [ ] **Step 2: Chạy đỏ.** `cd apps/api && npx jest src/modules/catalog/catalog.service.spec.ts -t "đã bán"` → FAIL.
- [ ] **Step 3: Schema + migration.** Thêm `soldApp30d Int @default(0)` (comment: số lượng đơn DELIVERED trong 30 ngày gần nhất, cron 03:00 ghi, chỉ để xếp hạng, không hiển thị) và `@@index([soldApp30d])`. `DATABASE_URL` trỏ DB riêng, `cd apps/api && npx prisma migrate dev --name product_sold_app_30d`; đổi tên thư mục migration thành `20261031130000_product_sold_app_30d`; nội dung đúng hai câu `ALTER TABLE "products" ADD COLUMN "soldApp30d" INTEGER NOT NULL DEFAULT 0;` và `CREATE INDEX "products_soldApp30d_idx" ON "products"("soldApp30d");`. Kiểm không lệch: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DB tạm>` ra "No difference" (hoặc dựng DB mới bằng `migrate deploy` rồi `migrate status`). `npx prisma generate`.
- [ ] **Step 4: Sửa `recomputeSoldCounts`** (`catalog.service.ts`): chạy `Promise.all` hai `orderItem.groupBy` (tổng; và thêm `order.deliveredAt >= now − 30 ngày`), gộp thành hai map theo product (cùng bảng `variation → productId`), ghi `soldApp` + `soldApp30d` từng dòng, và `updateMany` reset như test (d). Comment "vì sao": đơn thiếu `deliveredAt` (dữ liệu trước cột này) không vào cửa sổ 30 ngày, chấp nhận vì cửa sổ ngắn hơn tuổi dữ liệu đó.
- [ ] **Step 5: Race spec (đỏ rồi xanh)** `catalog-merch-api.race-spec.ts`, describe `"soldApp30d (real Postgres)"`: tạo sản phẩm + biến thể; đơn DELIVERED `deliveredAt = now − 29d` (qty 3), `now − 31d` (qty 5), đơn RETURNED `now − 1d` (qty 7), đơn DELIVERED `deliveredAt: null` (qty 11) (dùng `createOrder` của `helpers.ts`, `items: { create: [...] }`); gọi `new CatalogService(prisma).recomputeSoldCounts()` rồi đọc sản phẩm: `soldApp30d === 3` và `soldApp === 3 + 5 + 11`. Ca hai: xoá đơn 29 ngày rồi chạy lại → `soldApp30d === 0`. Dọn bằng `deleteItData`.
- [ ] **Step 6: Chạy xanh.** jest như Step 2 → PASS; race: `cd apps/api && DATABASE_URL=postgresql://tubu@127.0.0.1:25541/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand catalog-merch-api` (trước đó `npx prisma migrate deploy`) → PASS.
- [ ] **Step 7: Commit.** `git add apps/api/prisma apps/api/src/modules/catalog apps/api/test/integration-race/catalog-merch-api.race-spec.ts && git commit -m "feat(api): cột soldApp30d, cron 03:00 tính đơn giao 30 ngày"` (kèm dòng Co-Authored-By).

---

### Task 2: `sort=best_seller_30d`

**Files:**
- Modify: `apps/api/src/modules/catalog/dto/product-query.dto.ts`, `apps/api/src/modules/catalog/catalog.service.ts` (`list`)
- Modify: `packages/app-core/src/api/catalog.ts` (`CatalogSort`)
- Test: `catalog.service.spec.ts` (describe `list — best_seller`), `packages/app-core/src/api/catalog.spec.ts`, `apps/api/test/integration-race/catalog-merch-api.race-spec.ts`

**Interfaces:**
- Produces: `export const PRODUCT_SORTS = ['price_asc','price_desc','newest','best_seller','best_seller_30d','rating'] as const` và `type ProductSort`; `CatalogSort` thêm `'best_seller_30d'`.

- [ ] **Step 1: Test đỏ.** jest: `list({ page:1, limit:3, sort:'best_seller_30d' })` với ba hàng xếp hạng `{id:'a',soldApp30d:5,soldApp:50,soldExternal:0}`, `{id:'b',soldApp30d:5,soldApp:10,soldExternal:100}`, `{id:'c',soldApp30d:9,soldApp:0,soldExternal:0}`, `{id:'d',soldApp30d:5,soldApp:50,soldExternal:0}` → thứ tự `c, b, a, d` (30 ngày giảm, hoà theo tổng đã bán giảm, hoà nữa id tăng); `select` của câu xếp hạng đúng `{ id: true, soldApp30d: true, soldApp: true, soldExternal: true }`; câu lấy thẻ là `include` như `best_seller`. vitest: `catalogParams({ page: 1, limit: 12, sort: 'best_seller_30d' })` có `sort: 'best_seller_30d'` (kiểm bằng typecheck + giá trị).
- [ ] **Step 2: Chạy đỏ** (`npx jest ... -t "best_seller_30d"`; `cd packages/app-core && npx vitest run src/api/catalog.spec.ts`).
- [ ] **Step 3: Cài đặt.** DTO dùng `PRODUCT_SORTS` cho `@IsIn` và kiểu `sort`. Service: `if (sort === 'best_seller_30d') return this.listRanked(..., compare, price, undefined, false)` (tách `listBestSellers30d` cạnh `listBestSellers`, cùng bộ nhớ 60 giây vì không phụ thuộc giá). app-core: thêm vào union.
- [ ] **Step 4: Race (thêm ca).** Ba sản phẩm cùng nhãn có `soldApp30d` 9/5/5 và `soldApp+soldExternal` khác nhau (ghi thẳng bằng `prisma.product.update`) → `catalog.list({ page:1, limit:10, sort:'best_seller_30d', brand })` ra đúng thứ tự, `meta.total === 3`.
- [ ] **Step 5: Chạy xanh** (jest, vitest, race) rồi commit `feat(api): sắp xếp bán chạy 30 ngày (best_seller_30d)`.

---

### Task 3: `fulfiller` + `isLoved` trên thẻ; ba khoá `catalog.loved_*`

**Files:**
- Create: `apps/api/src/modules/catalog/catalog-loved.ts`, `catalog-loved.spec.ts`
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`toCard` → `toCards`, mọi chỗ gọi), `apps/api/prisma/seed.ts`, `apps/api/src/modules/system-config/system-config.service.ts` (RANGES), `apps/api/src/modules/system-config/reference-config-selection.spec.ts` (`APPROVED_LOADED_KEYS`)
- Test: `catalog.service.spec.ts`, race spec

**Interfaces:**
- Produces (`catalog-loved.ts`):
  ```ts
  export const CATALOG_LOVED_KEYS = { minRating: 'catalog.loved_min_rating', minReviews: 'catalog.loved_min_reviews', minSold: 'catalog.loved_min_sold' } as const;
  export interface LovedThresholds { minRating: number; minReviews: number; minSold: number }
  export const DEFAULT_LOVED_THRESHOLDS: LovedThresholds; // 4.8, 20, 50
  export function sanitizeLovedThreshold(value: unknown, fallback: number, max: number): number; // số hữu hạn trong [0, max], không thì fallback
  export function isLoved(p: { ratingAvg: number; reviewCount: number; sold: number }, t: LovedThresholds): boolean;
  ```
- Produces (`CatalogService`): thẻ có thêm `fulfiller: ProductFulfiller` (luôn có) và `isLoved: boolean`; `private async toCards(rows: CardRow[]): Promise<Card[]>` thay `toCard` ở `list`/`listRanked`/`related`/`boughtTogether`/`getForYou`; `CardRow` là kiểu tham số cũ của `toCard` cộng `fulfilment?: string; storefrontId?: string | null`.

- [ ] **Step 1: Test đỏ `catalog-loved.spec.ts`.** `isLoved({ratingAvg:4.8,reviewCount:20,sold:50}, DEFAULT)===true`; thiếu từng điều kiện (4.7, 19, 49) cho `false`; `sanitizeLovedThreshold('x',4.8,5)`, `(-1,…)`, `(NaN,…)`, `(99,4.8,5)` đều trả fallback, `(4.5,4.8,5)` trả 4.5.
- [ ] **Step 2: Test đỏ `catalog.service.spec.ts`** (describe mới `"thẻ: fulfiller và isLoved"`): (a) `list` với `config.get` trả ngưỡng 4.5/5/10 → thẻ `ratingAvg 4.5, reviewCount 5, soldApp 4 + soldExternal 6` là `isLoved: true`, thẻ khác `false`; không truyền `config` thì dùng mặc định 4.8/20/50; `config.get` trả `'abc'` cho một khoá thì khoá đó dùng mặc định. (b) trang toàn hàng Tubu: `fulfiller` là `{ kind:'TUBU', name:'Tubu Tree', shippingFee:null, freeShipFrom:null }` và `prisma.storefront.findMany` KHÔNG được gọi. (c) hàng `fulfilment:'MERCHANT', storefrontId:'s1'`: một lời gọi `storefront.findMany` với `where: { id: { in: ['s1'] } }` (không trùng id dù nhiều thẻ cùng gian hàng); gian hàng mở, `shippingFee: 20000`, `freeShipFrom: 300000` → `{ kind:'MERCHANT', name:<title>, shippingFee:20000, freeShipFrom:300000 }`; gian hàng đối tác có `ordersPausedAt` → `kind:'UNAVAILABLE', reason:'STORE_PAUSED'`; không có dòng gian hàng nào trả về → `MERCHANT`, `name:'Gian hàng đối tác'`. Sửa mẫu `card()` nếu cần; không đụng các assert `include` của ca cũ.
- [ ] **Step 3: Chạy đỏ** (`npx jest src/modules/catalog`).
- [ ] **Step 4: Cài `catalog-loved.ts`** theo Interfaces. Trần `max`: rating 5, reviews 100000, sold 10000000.
- [ ] **Step 5: Cài `toCards`** trong `CatalogService`: đọc ba ngưỡng (một `Promise.all` ba `this.config?.get`, qua `sanitizeLovedThreshold`; không có `config` thì mặc định); gom `storefrontId` duy nhất của hàng `fulfilment === 'MERCHANT'`, một `prisma.storefront.findMany({ where: { id: { in } }, select: { id, title, type, isPartner, shippingFee, freeShipFrom, ordersPausedAt, owner: { select: { role: true, isBlocked: true } } } })` chỉ khi có id; `fulfiller = await this.fulfillerOf(p.fulfilment ?? 'TUBU', store ?? null)`; `isLoved(...)` với `sold = soldExternal + soldApp`. Đổi `list`, `listRanked`, `related`, `boughtTogether`, `getForYou` sang `await this.toCards(...)`. Comment "vì sao": truy vấn gian hàng theo lô để thẻ hàng Tubu (đa số) không tốn thêm truy vấn.
- [ ] **Step 6: Khoá cấu hình.** `prisma/seed.ts` `SYSTEM_CONFIGS` thêm ba dòng `category: 'catalog'`, `createOnly: true` (chủ tự chỉnh, deploy không ghi đè), mô tả tiếng Việt nêu mặc định 4.8 / 20 / 50. `system-config.service.ts` RANGES: `catalog.loved_min_rating` `{ min: 0, max: 5 }`, `catalog.loved_min_reviews` `{ min: 0, max: 100000, integer: true }`, `catalog.loved_min_sold` `{ min: 0, max: 10000000, integer: true }`. Thêm ba khoá vào `APPROVED_LOADED_KEYS` (theo thứ tự chữ cái, sau `catalog.launch_date`).
- [ ] **Step 7: Chạy xanh.** `npx jest src/modules/catalog src/modules/system-config src/modules/brand` PASS (sửa assert exact-shape của ca cũ nếu thẻ có thêm hai trường; không nới lỏng assert khác).
- [ ] **Step 8: Race (thêm ca).** Sản phẩm `ratingAvg 4.8, reviewCount 20, soldApp 50` và một sản phẩm `MERCHANT` gắn gian hàng tạm nghỉ (`ordersPausedAt` có giá trị, `isPartner`) → `catalog.list` trả `isLoved:true` / `false` và `fulfiller.kind` `TUBU` / `UNAVAILABLE` đúng.
- [ ] **Step 9: Commit** `feat(api): thẻ sản phẩm trả fulfiller và isLoved, ba khoá catalog.loved_*`.

---

### Task 4: Cây danh mục + `productCount` cộng con + lọc cha gồm con

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`categories`, `listWhere`, thêm `categoryScope`), `packages/app-core/src/api/catalog.ts` (`CategoryDTO`), `apps/e2e/tests/support/discovery-mocks.ts`
- Test: `catalog.service.spec.ts` (describe `categories — productCount`, `list — bộ lọc`), `packages/app-core/src/api/catalog.spec.ts`, race spec

**Interfaces:**
- Produces: `export type CategoryNode = CategoryWithCount & { children: CategoryNode[] }`; `categories(): Promise<CategoryNode[]>` (gốc là `parentId` null hoặc cha không còn; `children` theo `sortOrder`, `id`); `CategoryDTO` có `parentId: string | null; productCount: number; children: CategoryDTO[]`; `GET /products?category=<id>` khớp `categoryIds hasSome [id, ...mọi cháu]`, không có con thì giữ `{ has: id }`.

- [ ] **Step 1: Test đỏ.** jest: danh mục `cha` có hai con `con1`, `con2`, thêm `mo-coi` (parentId lạ) và `ca`, `cb` (vòng: `ca.parentId='cb'`, `cb.parentId='ca'`). Sản phẩm: `{categoryIds:['con1']}`, `{categoryIds:['cha','con1']}` (đếm cha một lần), `{categoryIds:['con2']}`, `{categoryIds:[]}` → `cha.productCount === 3`, `con1 === 2`, `con2 === 1`, gốc gồm `cha` và `mo-coi` (không có `ca`, `cb`, hàm không treo), `cha.children.map(id)` = `['con1','con2']`. Ca cũ (hai danh mục phẳng) đổi kỳ vọng thêm `children: []`. Cache 60 giây vẫn hai truy vấn một lần. `list({ category:'cha', ... })` → `where.categoryIds` là `{ hasSome: ['cha','con1','con2'] }`; `category:'con1'` → `{ has: 'con1' }`; `category:'khong-co'` → `{ has: 'khong-co' }` (không lỗi); vòng `ca`/`cb` cho `category:'ca'` trả `hasSome ['ca','cb']` và kết thúc. Bộ nhớ id con có TTL 60 giây (hai lần `list` cùng `category` chỉ một `category.findMany`). vitest: kiểu `CategoryDTO` lồng cây (typecheck) và mẫu e2e có `children: []`.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Cài đặt.** `categories()`: `findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })`; với mỗi sản phẩm lấy tập `categoryIds` rồi đi lên cha (có tập `visited` chống vòng), mỗi danh mục trong tập được cộng 1; dựng cây bằng bản đồ `parentId → con`. `categoryScope(id)`: bộ nhớ `Map<parentId, childIds[]>` hạn 60 giây (`TTL_MS`) đọc `category.findMany({ select: { id: true, parentId: true } })`, BFS có `visited`. `listWhere`: `if (category) { const scope = await this.categoryScope(category); where.categoryIds = scope.length > 1 ? { hasSome: scope } : { has: category }; }`. Comment: cùng hạn chế per-instance như `categoriesCache` (đã nêu ở đầu class).
- [ ] **Step 4: app-core + e2e.** `CategoryDTO`: `productCount: number` (bỏ `?`), thêm `children: CategoryDTO[]`; sửa comment `productCount` (API trước 4b không có, kiểu giữ cho API mới). Thêm `children: []` vào ba mẫu trong `discovery-mocks.ts`. `pnpm`/`npx tsc --noEmit` trong `packages/app-core`, `apps/web`, `apps/miniapp`, `apps/e2e` phải xanh (chỗ nào vỡ vì `productCount` bắt buộc thì sửa tối thiểu, ghi vào notes).
- [ ] **Step 5: Race (thêm ca).** Dựng `cha` + `con` + hai sản phẩm (một gán `[cha, con]`, một gán `[con]`) cùng nhãn: `catalog.categories()` cho `cha.productCount === 2` và `cha.children[0].productCount === 2`; `catalog.list({ page:1, limit:10, category: cha.id, brand })` trả cả hai sản phẩm, `total === 2`. Dọn danh mục sau test.
- [ ] **Step 6: Chạy xanh** (jest catalog + home, vitest app-core, race) và commit `feat(api): danh mục hai tầng (cây, productCount cộng con, lọc cha gồm con)`.

---

### Task 5: Thương hiệu: `GET /brand/public/:slug/products` + `productCount`

**Files:**
- Create: `apps/api/src/modules/catalog/dto/brand-products-query.dto.ts` (+ `.spec.ts`)
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`list` tách `listPage`, thêm `listBrandProducts`), `catalog.controller.ts`, `apps/api/src/modules/brand/brand.service.ts` (`getPublicBySlug`), `brand.service.spec.ts`, `packages/app-core/src/api/brand.ts`
- Test: `catalog.service.spec.ts`, `brand.service.spec.ts`, `brand-products-query.dto.spec.ts`, `packages/app-core/src/api/brand.spec.ts`, race spec

**Interfaces:**
- Produces: `class BrandProductsQuery extends PaginationQuery { sort?: ProductSort }`; `CatalogService.listBrandProducts(slug: string, query: BrandProductsQuery): Promise<PaginatedResult<Card>>`; route `GET /brand/public/:slug/products` (`@Public() @PublicCache('CATALOG')`); `BrandService.getPublicBySlug` trả thêm `productCount: number` và `products` (giữ cho client cũ, tối đa 30 theo thứ tự cũ) lọc bằng `PUBLIC_PRODUCT_WHERE`; app-core:
  ```ts
  export interface BrandProductsQuery { page?: number; limit?: number; sort?: CatalogSort }
  export const fetchBrandProducts = (http: HttpClient, slug: string, query?: BrandProductsQuery) => Promise<PageResponse<ProductCard>>; // GET /brand/public/<slug>/products
  BrandView.productCount: number
  ```

- [ ] **Step 1: Test đỏ.** jest `listBrandProducts`: slug chưa đăng (`brand.findFirst` null) → `NotFoundException`; slug có → `product.findMany` where gồm `{ isActive: true, approvalStatus: 'APPROVED', brandId: 'b1' }`, trang 2 `limit 2` cho `skip 2, take 2` và `meta` đúng, `sort:'newest'` đi `orderBy createdAt desc`, `sort:'best_seller'` đi đường xếp hạng. `getPublicBySlug`: `product.count` được gọi với where trên và `productCount` trong kết quả; `products` where có `approvalStatus: 'APPROVED'` (sửa mock `makePrisma` thêm `product.count`). DTO: `limit=101` lỗi, `sort=lung_tung` lỗi, mặc định `page 1, limit 20`. vitest: `fetchBrandProducts(http, 'tubu', { page: 2, limit: 12, sort: 'newest' })` gọi `get` `/brand/public/tubu/products` với `query: { page: 2, limit: 12, sort: 'newest' }`; bỏ khoá `undefined`; slug lạ được mã hoá (`'../x'` → `..%2Fx`).
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Cài đặt.** Tách `list(query)` thành `listPage(where, { page, limit, sort, minPrice, maxPrice })` (thân cũ) và `list` chỉ còn `listPage(await this.listWhere(query), query)`; `listBrandProducts` tìm `brand.findFirst({ where: { slug, isPublished: true }, select: { id: true } })`, 404 `'Nhãn hàng không tồn tại hoặc chưa đăng.'`, rồi `listPage({ ...PUBLIC_PRODUCT_WHERE, brandId }, query)`. Controller thêm route. `BrandService.getPublicBySlug`: một hằng where dùng cho `findMany` (giữ `take: 30`) và `count`. app-core: thêm hàm và `productCount`.
- [ ] **Step 4: Race (thêm ca).** Nhãn đã đăng với 5 sản phẩm APPROVED + 1 PENDING_REVIEW + 1 `isActive:false`: `listBrandProducts(slug, {page:1,limit:2})` → 2 thẻ, `total === 5`; trang 3 → 1 thẻ; trang 4 → `data: []`, `total === 5`; `new BrandService(prisma, config).getPublicBySlug(slug)` → `productCount === 5`.
- [ ] **Step 5: Chạy xanh** (jest catalog + brand, vitest app-core, race) và commit `feat(api): trang thương hiệu phân trang thật và productCount`.

---

### Task 6: `related()` xếp theo đã bán

**Files:**
- Modify: `apps/api/src/modules/catalog/catalog.service.ts` (`related`)
- Test: `catalog.service.spec.ts`, race spec

**Interfaces:**
- Produces: `related(slug)` vẫn trả mảng thẻ cùng nhãn (tối đa 8, không gồm chính nó) nhưng theo `soldApp + soldExternal` giảm dần, hoà theo `id` tăng. Hằng `RELATED_LIMIT = 8`.

- [ ] **Step 1: Test đỏ.** Mười sản phẩm cùng nhãn với tổng đã bán `[5,50,50,0,30,...]`: câu xếp hạng (`select: { id, soldApp, soldExternal }`, where `{ isActive, approvalStatus:'APPROVED', brand, id: { not: p.id } }`) trả lộn xộn → kết quả tám thẻ theo đúng thứ tự (hoà 50/50 theo id) và câu lấy thẻ dùng `id: { in: [...] }` với đúng 8 id; sản phẩm không tồn tại vẫn `NotFound`; sửa ca cũ `related(): where lọc approvalStatus APPROVED` cho khớp hai lời gọi `findMany`.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Cài đặt.** Câu một lấy `select` nhỏ của mọi sản phẩm cùng nhãn (không dùng `rankCache`: khoá theo từng slug sẽ đẩy khoá Bán chạy khỏi bộ nhớ trần 100), sắp trong TS, cắt 8; câu hai lấy thẻ (`include` biến thể) theo id rồi sắp lại đúng thứ tự, qua `toCards`.
- [ ] **Step 4: Race (thêm ca)** với `soldApp`/`soldExternal` khác nhau cùng nhãn: `catalog.related(slug)` ra đúng thứ tự, không có chính sản phẩm.
- [ ] **Step 5: Chạy xanh** và commit `feat(api): sản phẩm liên quan xếp theo đã bán`.

---

### Task 7: Gate và dọn

- [ ] **Step 1:** `cd apps/api && npx prisma generate`; chạy toàn bộ race spec của gói với DB riêng: `DATABASE_URL=postgresql://tubu@127.0.0.1:25541/tubutree_it npx jest -c test/integration-race/jest.config.js --runInBand catalog-merch-api catalog-flash-card-price catalog-slugs catalog-variation-order brand-owner-sales` → PASS (các spec catalog cũ chứng minh không hồi quy).
- [ ] **Step 2:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P3a --base 64abdc5e5 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P3a.txt` (chạy một lần, từ worktree). Bước FAIL: chạy lại bước đó ở `64abdc5e5` (worktree tạm) hoặc so log; FAIL cũng có ở base thì ghi "có sẵn", FAIL do gói thì sửa tới PASS.
- [ ] **Step 3:** `bash docs/2026-10-20-uat/tools/pg-native.sh stop 25541`. `git status` sạch, `git log --oneline 64abdc5e5..HEAD` đủ commit nhỏ.
