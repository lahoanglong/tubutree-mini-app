# P16 `category-admin` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** admin dựng được cây danh mục hai tầng (≤8 gốc × ≤8 con mỗi cha, API chặn 400 tiếng Việt), sắp thứ tự bằng nút ↑↓, gán hàng loạt sản phẩm vào danh mục lá (idempotent), đồng bộ Pancake không đè danh mục đã gán tay, hộp việc "SP chưa có danh mục (n)" dẫn tới màn gán.

**Kiến trúc:** hiện chỉ có đường gán (`ProductCategoryAdminService.assign`) và tab web "Sản phẩm" (`product-categories-tab.tsx`); `Category` chỉ được seed, không có CRUD, nên gói thêm `CategoryAdminService` (tạo/đổi tên/chuyển cha/sắp xếp/xoá) dưới khoá advisory `catalog.category_tree` (cũng bao quanh gán ADD để luật "chỉ gán vào lá" không bị vượt bởi thao tác xen giữa). Đọc cho admin đi đường riêng `GET /admin/categories` (không cache, có `parentId`, `sortOrder`, số SP trực tiếp và cộng con) thay cho `/categories?flat=1` (cache 60s trong RAM + `s-maxage=300`) để màn không hiện dữ liệu cũ ngay sau khi sửa. Không migration: `Category.parentId/sortOrder` đã có. Tab web nâng cấp tại chỗ: thêm `CategoryTreePanel` phía trên danh sách SP; không có route mới (tab `?tab=productCategories`, nhãn menu "Sản phẩm").

**Tech stack:** NestJS + Prisma + Postgres (jest, race-spec trên Postgres thật), Next 15 + Tailwind + TanStack Query (vitest + testing-library, helper `@/test-utils/dom`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §5 "Danh mục hai tầng (dữ liệu)", §7; mục P16 của `02-ke-hoach.md`. Nguồn: `review/ia-merch.md` IA-01 + C2, `review/backend-gap.md` BG-13. Bàn giao: `plans/handoff-wave1.md` (P3a: `/categories?flat=1`, `categoryScope`), `handoff-wave4a.md` (tên migration cuối `20261101100100_*`).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Quyền: giữ như đường danh mục sản phẩm hiện có, `@Roles('ADMIN')`. Mọi route mới thêm vào `EXPECTED` của `staff-permissions.matrix.spec.ts` là `ADMIN_ONLY`.
- Giới hạn: gốc ≤ 8 (`CATEGORY_MAX_ROOTS`), con mỗi cha ≤ 8 (`CATEGORY_MAX_CHILDREN`), tên 1–60 ký tự. Vượt thì `400` câu tiếng Việt có dấu (`diacritics-style.spec` canh). Web lấy giới hạn từ `limits` của `GET /admin/categories`, không chép số.
- Không đổi giá, không đụng đường tiền, không đọc/ghi PROD, không tự gán danh mục cho dữ liệu thật. Không sửa `PROGRESS.md`.
- Không đổi `GET /categories` và `?flat=1` (hợp đồng P3a); gói khác (P10, P14) không đụng file nào ở đây.
- Chữ giao diện tiếng Việt, tên mục luôn nằm trong tên đọc của nút (`aria-label` "Đưa "{tên}" lên trên"). Vùng chạm 44px: dùng `BTN_*`/`FIELD_XS` của `components/admin/ui.tsx` (đã có `TOUCH_H`). Nút ở đầu/cuối dùng `aria-disabled`, không `disabled`, để tiêu điểm bàn phím không mất.
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó. Không push, không `git stash` trần. Máy thiếu RAM: chạy test theo file, gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. Hai admin cùng thêm mục con vào cha còn một chỗ, hoặc cùng đổi gốc: đúng một lệnh thành công, tổng không vượt 8. Race spec T3.
2. Danh mục vừa thành cha giữa lúc admin bấm "Gán": 400 và không ghi gì; gán lại cùng danh sách không nhân đôi `categoryIds`; id sản phẩm đã xoá vẫn 400. Jest + race T5.
3. Đồng bộ Pancake đọc sản phẩm "chưa có danh mục" rồi admin gán xen giữa trước khi sync ghi: danh mục admin còn nguyên. Bản đồ `pancake.category_map` trỏ vào danh mục có con bị bỏ qua. Jest + race T7.
4. Xoá danh mục còn SP hoặc còn con; sắp xếp khi danh sách đã đổi (409 "tải lại"); danh sách phẳng 7 gốc như seed vẫn dùng được; cha trỏ vào id không còn (dữ liệu cũ) coi như gốc. T3, T8.
5. Sau mọi thay đổi cây: `/categories`, `/categories?flat=1` và khối `categories` của `/home` trả cây mới ngay trên instance này (CDN `s-maxage` chờ hết hạn, ghi vào notes). Jest T2.

---

## File Structure

| File | Việc |
|---|---|
| `apps/api/src/modules/catalog/category-tree.ts` + `.spec.ts` | hằng giới hạn, `CATEGORY_TREE_LOCK`, `categorySlugBase`, `uniqueCategorySlug`, `sameCategoryName`, `CATEGORY_MSG` |
| `apps/api/src/modules/catalog/category-admin.service.ts` + `.spec.ts` | `CategoryAdminService` |
| `apps/api/src/modules/catalog/category-admin.controller.ts` | route `admin/categories`, DTO |
| `apps/api/src/modules/catalog/catalog.service.ts`, `home.service.ts` (+spec) | `invalidateCategoryCache()`, `invalidateStatic()` |
| `apps/api/src/modules/catalog/product-category-admin.{service,controller}.ts` + spec | luật lá, khoá, tìm theo thương hiệu, `onSale`, làm mới cache |
| `apps/api/src/modules/catalog/product-admin.service.ts` + spec | luật lá cho danh mục mới thêm ở ngăn sửa SP |
| `apps/api/src/modules/ops/ops-inbox.service.ts` + spec | khoá `productsUncategorized` |
| `apps/api/src/modules/integrations/pancake/pancake-sync.service.ts` + spec | điền danh mục có điều kiện nguyên tử, chỉ vào lá |
| `apps/api/src/modules/catalog/catalog.module.ts`, `common/staff-permissions.matrix.spec.ts` | đăng ký, bảng quyền |
| `apps/api/test/integration-race/category-tree.race-spec.ts` | race trên Postgres thật |
| `apps/web/src/lib/category-tree.ts` + `.spec.ts` | `buildCategoryTree`, `canAddRoot`, `canAddChild`, `moveInOrder` |
| `apps/web/src/lib/product-categories.ts` | kiểu + hàm gọi `admin/categories`, tham số `onSale` |
| `apps/web/src/components/admin/category-tree-panel.tsx` + `.spec.tsx` | cây, ↑↓, thêm, đổi tên, chuyển cha, xoá |
| `apps/web/src/components/admin/product-categories-tab.tsx` + spec | gắn panel, bộ chọn lá, chip "Chưa có danh mục" |
| `apps/web/src/lib/admin-client.ts`, `components/admin/ops-inbox-tab.tsx`, `app/admin/page.tsx` (+spec) | thẻ hộp việc |

Lệnh kiểm một file: `cd apps/api && npx jest <đường dẫn>.spec.ts`; `cd apps/web && npx vitest run src/<đường dẫn>`.

## Điều chỉnh đã chốt trước khi làm

- "Màn `/admin/categories`" của kế hoạch chính là tab "Sản phẩm" hiện có (`productCategories`); nâng cấp tại chỗ.
- Luật "chỉ gán vào lá" áp cho `ADD`; `REMOVE` khỏi cha vẫn cho (dọn dữ liệu gán vào cha trước khi có con). Ngăn sửa SP (`PATCH /admin/catalog-products/:id`) chỉ kiểm các id MỚI thêm so với bản hiện có. Đường đối tác (`merchant.service`) không đổi, ghi vào notes.
- Xoá danh mục chỉ khi không còn con và không còn SP nào mang id đó (kể cả SP đang tắt).
- Chuyển cha: chỉ sang một gốc (cha phải là gốc), và chỉ khi mục đó không có con; chuyển lên gốc cũng kiểm trần 8.
- "n" của hộp việc = SP đang bán thật: `PUBLIC_PRODUCT_WHERE` (isActive + APPROVED) và `categoryIds` rỗng; chip "Chưa có danh mục" ở tab dùng đúng điều kiện này (`onSale=1`) để số trên thẻ = số hàng ở màn đích.
- Tìm SP theo thương hiệu: `q` khớp thêm `brand` (không phân biệt hoa thường), không thêm tham số riêng.

---

### Task 1: Hằng số, slug, thông báo của cây danh mục

**Files:** Create `apps/api/src/modules/catalog/category-tree.ts`, `category-tree.spec.ts`.

**Interfaces:**
- Produces: `CATEGORY_MAX_ROOTS = 8`, `CATEGORY_MAX_CHILDREN = 8`, `CATEGORY_NAME_MAX = 60`, `CATEGORY_TREE_LOCK = 'catalog.category_tree'`; `categorySlugBase(name: string): string`; `uniqueCategorySlug(base: string, taken: ReadonlySet<string>): string`; `sameCategoryName(a: string, b: string): boolean`; `CATEGORY_MSG` (hàm trả chuỗi: `rootsFull()`, `childrenFull(parentName)`, `parentNotRoot()`, `hasChildrenCannotNest(name)`, `duplicateName(name)`, `removeHasChildren(name, n)`, `removeHasProducts(name, n)`, `notLeaf(name)`, `notFound()`, `staleOrder()`).

- [ ] **Step 1: test đỏ** `category-tree.spec.ts`: `categorySlugBase('Chăm sóc  cá nhân!')==='cham-soc-ca-nhan'`; `categorySlugBase('Đồ dùng Nhà bếp')==='do-dung-nha-bep'`; `categorySlugBase('???')==='danh-muc'`; `uniqueCategorySlug('bep', new Set(['bep','bep-2']))==='bep-3'`; `uniqueCategorySlug('bep', new Set())==='bep'`; `sameCategoryName(' Nhà Bếp ','nha bep')===true`; `CATEGORY_MSG.rootsFull()` chứa "8"; `CATEGORY_MSG.childrenFull('Gia dụng')` chứa `"Gia dụng"` và "8".
- [ ] **Step 2:** `npx jest src/modules/catalog/category-tree.spec.ts` → FAIL (module chưa có).
- [ ] **Step 3: cài đặt** dùng `foldVietnamese` của `search-text.ts` cho slug và so tên.
- [ ] **Step 4:** chạy lại → PASS. Commit `feat(api): hằng số và thông báo của cây danh mục hai tầng`.

### Task 2: Làm mới cache công khai của danh mục

**Files:** Modify `catalog.service.ts` (cạnh `categoriesCache`), `home.service.ts` (cạnh `staticSlot`); test trong `catalog.service.spec.ts`, `home.service.spec.ts`.

**Interfaces:** Produces `CatalogService.invalidateCategoryCache(): void` (xoá `categoriesCache` và `categoryChildrenCache`); `HomeService.invalidateStatic(): void` (bỏ `staticSlot.value`, giữ `inflight`).

- [ ] **Step 1: test đỏ** (catalog): gọi `categories()` hai lần → `prisma.category.findMany` 1 lần (cache); `invalidateCategoryCache()` rồi `categories()` và `categoriesFlat()` → đọc lại, trả dữ liệu mới; `categoryScope` qua `list({category})` cũng đọc lại. (home): dựng static, `invalidateStatic()`, lần gọi `getPublic` sau dựng lại `categories`.
- [ ] **Step 2:** chạy hai file → FAIL.
- [ ] **Step 3:** cài đặt hai hàm; sửa comment "admin sửa Category KHÔNG gọi invalidate" (nay có gọi từ `CategoryAdminService`; vẫn per-instance, scale ≥2 replica cần Redis).
- [ ] **Step 4:** PASS. Commit `feat(api): làm mới cache danh mục và khối Trang chủ khi đổi cây`.

### Task 3: `CategoryAdminService` (cây, giới hạn, khoá)

**Files:** Create `category-admin.service.ts`, `category-admin.service.spec.ts`, `test/integration-race/category-tree.race-spec.ts`.

**Interfaces:**
- Consumes: T1; `CatalogService.invalidateCategoryCache`, `HomeService.invalidateStatic` (T2); `PrismaService`.
- Produces:
  ```ts
  export interface AdminCategoryRow { id: string; name: string; slug: string; parentId: string | null; sortOrder: number; productCount: number; totalCount: number }
  export interface AdminCategoryList { items: AdminCategoryRow[]; limits: { maxRoots: number; maxChildren: number } }
  class CategoryAdminService {
    constructor(prisma: PrismaService, catalog: CatalogService, home: HomeService)
    list(): Promise<AdminCategoryList>                       // sắp (sortOrder, id); productCount = SP gắn trực tiếp (mọi trạng thái), totalCount = SP duy nhất của mục và các con
    create(adminId: string, dto: { name: string; parentId?: string | null }): Promise<AdminCategoryRow>
    update(adminId: string, id: string, patch: { name?: string; parentId?: string | null }): Promise<AdminCategoryRow>
    reorder(adminId: string, parentId: string | null, orderedIds: string[]): Promise<AdminCategoryList>
    remove(adminId: string, id: string): Promise<{ id: string }>
  }
  ```
  Mọi ghi chạy trong `$transaction` mở đầu bằng `pg_advisory_xact_lock(hashtext(CATEGORY_TREE_LOCK))`; sau commit gọi hai hàm làm mới cache. Cha "không còn" (id lạ) khi đọc coi như gốc.

- [ ] **Step 1: jest đỏ** (`prisma.$transaction: jest.fn(fn => fn(prisma))`, `$executeRaw` giả): tạo gốc thứ 9 → `BadRequestException` với `CATEGORY_MSG.rootsFull()`, không `category.create`; tạo con thứ 9 của một cha → `childrenFull(tên cha)`; tạo con của một mục đã là con → `parentNotRoot()`; tên trùng cùng cấp (khác hoa thường/dấu) → `duplicateName`; tạo ghi `sortOrder = max anh em + 1`, slug duy nhất khi trùng; `update` đổi tên; chuyển cha: mục có con → `hasChildrenCannotNest`, cha đích đủ 8 → `childrenFull`, chuyển lên gốc khi đủ 8 gốc → `rootsFull`, chuyển xong `sortOrder` cuối nhóm mới; `reorder` đúng bộ id anh em thì ghi `sortOrder` 0..n-1 theo thứ tự gửi, thiếu/thừa/đổi id → `ConflictException(staleOrder())` và không ghi; `remove`: còn con → `removeHasChildren`, còn SP → `removeHasProducts`, trống → xoá; id lạ → `NotFoundException`; mọi ghi thành công gọi `catalog.invalidateCategoryCache` và `home.invalidateStatic` đúng một lần, lỗi thì không gọi.
- [ ] **Step 2:** `npx jest src/modules/catalog/category-admin.service.spec.ts` → FAIL.
- [ ] **Step 3: cài đặt** như Interfaces. `list` đọc `category.findMany` + `product.findMany({ select: { categoryIds: true } })` rồi cộng ở JS (một SP đếm một lần cho mục cha dù gán cả cha lẫn con).
- [ ] **Step 4:** PASS.
- [ ] **Step 5: race spec** (`DATABASE_URL=postgresql://tubu@127.0.0.1:25547/tubutree_it`, dọn dữ liệu theo tiền tố `it-cat-<tag>`): (a) cha có 6 con, 5 lệnh `create` con song song → đúng 2 thành công, 3 bị 400, DB có 8 con; (b) 4 gốc `it-` + gốc sẵn có sao cho còn đúng 1 chỗ trống, 3 lệnh tạo gốc song song → 1 thành công; (c) `reorder` hai lần song song với hai thứ tự khác nhau → kết quả là đúng một trong hai, `sortOrder` không trùng; (d) `list` sau `create` thấy ngay (không cache). Chạy: `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/category-tree.race-spec.ts` → PASS.
- [ ] **Step 6:** Commit `feat(api): CategoryAdminService, cây hai tầng ≤8×≤8 có khoá advisory`.

### Task 4: Controller `admin/categories`

**Files:** Create `category-admin.controller.ts`; modify `catalog.module.ts` (providers + controllers), `common/staff-permissions.matrix.spec.ts`; test `category-admin.controller.spec.ts`.

**Interfaces:** Produces `GET /admin/categories` → `AdminCategoryList`; `POST /admin/categories` body `{ name, parentId? }` → `AdminCategoryRow`; `PATCH /admin/categories/:id` body `{ name?, parentId? }` (`parentId: null` = chuyển lên gốc); `PUT /admin/categories/order` body `{ parentId: string | null, orderedIds: string[] }` (≤8 phần tử) → `AdminCategoryList`; `DELETE /admin/categories/:id` → `{ id }`. Cả controller `@Roles('ADMIN')`, `@ApiTags('admin-catalog')`; id lấy `@CurrentUser('sub')`.

- [ ] **Step 1: test đỏ**: DTO từ chối tên rỗng/dài >60, `orderedIds` rỗng hoặc >8 (dùng `validate` của class-validator như `product-category-admin.controller` spec nếu có, hoặc ValidationPipe); controller gọi đúng hàm service với `adminId`. Thêm 5 dòng `ADMIN_ONLY` vào `EXPECTED` (`GET/POST /admin/categories`, `PATCH/DELETE /admin/categories/:id`, `PUT /admin/categories/order`): chạy `npx jest src/common/staff-permissions.matrix.spec.ts` → FAIL trước khi có controller.
- [ ] **Step 2:** cài đặt controller + đăng ký module → PASS cả hai spec. Chạy thêm `npx jest src/common/endpoint-inventory.spec.ts src/common/diacritics-style.spec.ts`.
- [ ] **Step 3:** Commit `feat(api): route admin/categories (tạo, đổi tên, chuyển cha, sắp xếp, xoá)`.

### Task 5: Gán hàng loạt: chỉ vào lá, idempotent, lọc theo thương hiệu, đếm "đang bán"

**Files:** Modify `product-category-admin.service.ts`, `product-category-admin.controller.ts`, `product-admin.service.ts`, `catalog.module.ts` (inject); tests `product-category-admin.service.spec.ts`, `product-admin.service.spec.ts`, thêm ca vào `category-tree.race-spec.ts`.

**Interfaces:**
- Consumes: T1 (`CATEGORY_MSG.notLeaf`, `CATEGORY_TREE_LOCK`), T2.
- Produces: `ProductCategoryAdminService` nhận thêm `CatalogService`, `HomeService`; `listProducts` thêm `onSale?: boolean` (dùng `PUBLIC_PRODUCT_WHERE`) và `q` khớp thêm `brand`; `ListCategoryProductsQuery.onSale` (`?onSale=1`); `export const UNCATEGORIZED_ON_SALE_WHERE: Prisma.ProductWhereInput = { ...PUBLIC_PRODUCT_WHERE, categoryIds: { isEmpty: true } }` ở `public-product.ts`. `assign(ADD)` chạy trong transaction có khoá cây: danh mục có con → `BadRequestException(notLeaf(name))`, không ghi; sau khi `changed > 0` làm mới cache. `REMOVE` không kiểm lá.
- [ ] **Step 1: jest đỏ**: ADD vào danh mục có con → 400 và `$executeRaw` không gọi; ADD vào lá hai lần liên tiếp (mock `$executeRaw` trả 2 rồi 0) → lần hai `changed 0, unchanged n`; REMOVE khỏi cha có con vẫn chạy; `listProducts({ q: 'tubu' })` where có nhánh `brand: { contains, mode: 'insensitive' }`; `onSale: true` where chứa `isActive: true` và `approvalStatus: 'APPROVED'`; `changed>0` gọi `invalidateCategoryCache`, `changed=0` thì không. (product-admin) PATCH `categoryIds` thêm id của cha có con → 400; giữ nguyên id cha cũ đã có trên SP và đổi trường khác → không lỗi.
- [ ] **Step 2:** chạy hai file → FAIL.
- [ ] **Step 3:** cài đặt. ADD: `$transaction` → khoá → `category.findUnique` + `category.count({ where: { parentId: id } })` → câu `UPDATE` nguyên tử có sẵn. `product-admin`: kiểm lá chỉ với `ids` không có trong `current.categoryIds`.
- [ ] **Step 4:** PASS. Thêm ca race: (a) gán ADD cùng 3 SP vào cùng lá hai lần song song → mỗi SP đúng một lần id trong `categoryIds`; (b) `assign ADD` vào lá L song song với `create` con của L → hoặc gán thành công trước (L khi đó có SP, con tạo sau vẫn được), hoặc gán bị 400; không bao giờ SP nằm trong L đang có con do gán xong sau khi con xuất hiện. Chạy race spec → PASS.
- [ ] **Step 5:** Commit `feat(api): gán danh mục hàng loạt chỉ vào lá, tìm theo thương hiệu, lọc đang bán`.

### Task 6: Hộp việc `productsUncategorized`

**Files:** Modify `ops-inbox.service.ts` (kiểu `InboxKey` + một mục cạnh `productsMissingImage`), `ops-inbox.service.spec.ts`.

**Interfaces:** Produces khoá `'productsUncategorized'`, `audience: 'ADMIN'`, `count: () => p.product.count({ where: UNCATEGORIZED_ON_SALE_WHERE })`, đặt ngay sau `productsMissingImage`.

- [ ] **Step 1: test đỏ**: danh sách khoá ADMIN (dòng ~344) có `productsUncategorized` sau `productsMissingImage`; `count` gọi `product.count` với đúng `UNCATEGORIZED_ON_SALE_WHERE` (mock trả 12 → `count: 12`); nhân viên CSKH không thấy khoá (ca ở dòng ~610).
- [ ] **Step 2:** FAIL → cài đặt → PASS (`npx jest src/modules/ops/ops-inbox.service.spec.ts`). Commit `feat(api): hộp việc "SP đang bán chưa có danh mục"`.

### Task 7: Đồng bộ Pancake không đè danh mục đã gán

**Files:** Modify `pancake-sync.service.ts` (`validCategoryIds`, `upsertProduct` quanh dòng 429-452), `pancake-sync.service.spec.ts`; ca race trong `category-tree.race-spec.ts`.

**Interfaces:** Produces (không đổi chữ ký công khai): `product.update` của sync KHÔNG BAO GIỜ mang `categoryIds`; điền theo bản đồ đi qua `product.updateMany({ where: { id, categoryIds: { isEmpty: true } }, data: { categoryIds: mapped } })` (chỉ khi sản phẩm đọc ra chưa có danh mục và `mapped.length > 0`); `product.create` giữ `categoryIds: mapped`. `validCategoryIds` chỉ trả id danh mục lá (không là `parentId` của danh mục nào), nên bản đồ trỏ vào cha có con bị bỏ.

- [ ] **Step 1: jest đỏ** (viết cạnh các ca ánh xạ ở dòng ~760): SP đã có `['adminCat']` + bản đồ trỏ `catA` → `update.data` không có `categoryIds` và `updateMany` không gọi (ghi `categoryIds` của admin còn nguyên); SP chưa có danh mục → `update.data` không có `categoryIds`, `updateMany` gọi với `where.categoryIds = { isEmpty: true }` và `data.categoryIds = ['catA']`; `category.findMany` trả `[{id:'cha'},{id:'con',parentId:'cha'}]`, bản đồ trỏ `cha` → không ghi gì, trỏ `con` → ghi `['con']`; SP mới + bản đồ trỏ cha → `create.data.categoryIds = []`.
- [ ] **Step 2:** `npx jest src/modules/integrations/pancake/pancake-sync.service.spec.ts` → FAIL (ca mới).
- [ ] **Step 3:** cài đặt: `validCategoryIds` đọc `{ id, parentId }`; tách `categoryIds` khỏi `data` của `update`, gọi `updateMany` sau `update`.
- [ ] **Step 4:** PASS toàn file. Race (Postgres thật, theo mẫu `commission-rates-admin.race-spec.ts:370`): SP chưa có danh mục, `jest.spyOn(prisma.product, 'findUnique')` đọc bản cũ rồi chạy `assign ADD` của admin ngay trước khi trả về, sau đó `sync.syncProducts()` → `categoryIds` của SP còn đúng danh mục admin gán, không có id từ bản đồ. Chạy race spec → PASS.
- [ ] **Step 5:** Commit `fix(api): đồng bộ Pancake điền danh mục có điều kiện nguyên tử, chỉ vào danh mục lá`.

### Task 8: Web: mô hình cây và lời gọi API

**Files:** Create `apps/web/src/lib/category-tree.ts`, `category-tree.spec.ts`; modify `lib/product-categories.ts`.

**Interfaces:**
- Produces (`product-categories.ts`): `AdminCategory { id; name; slug; parentId: string | null; sortOrder: number; productCount: number; totalCount: number }`, `AdminCategoryList { items: AdminCategory[]; limits: { maxRoots: number; maxChildren: number } }`; `listAdminCategories()`, `createAdminCategory(body: { name: string; parentId?: string | null })`, `updateAdminCategory(id, body: { name?: string; parentId?: string | null })`, `reorderAdminCategories(parentId: string | null, orderedIds: string[])`, `deleteAdminCategory(id)`; `listCategoryProducts` thêm `onSale?: boolean` → `&onSale=1`.
- Produces (`category-tree.ts`): `interface CategoryNode extends AdminCategory { children: AdminCategory[] }`; `buildCategoryTree(items: AdminCategory[]): CategoryNode[]` (gốc = `parentId` null hoặc cha không có trong danh sách; con theo cha; mỗi nhóm sắp `sortOrder` rồi `id`); `canAddRoot(roots: number, limits): boolean`; `canAddChild(children: number, limits): boolean`; `moveInOrder(ids: string[], id: string, dir: 'up' | 'down'): string[] | null` (null khi đã ở đầu/cuối hoặc không có id); `isLeaf(tree: CategoryNode[], id: string): boolean`.
- [ ] **Step 1: test đỏ** `category-tree.spec.ts`: 7 mục phẳng → 7 gốc, 0 con; mục có `parentId` lạ → coi là gốc; `buildCategoryTree` sắp theo `sortOrder`; `canAddRoot(8, {maxRoots:8,maxChildren:8})===false`, `canAddChild(7,…)===true`; `moveInOrder(['a','b','c'],'b','up')` = `['b','a','c']`, `moveInOrder(['a','b'],'a','up')===null`, `moveInOrder(['a','b'],'b','down')===null`; `isLeaf` đúng với gốc có con / gốc không con / con.
- [ ] **Step 2:** `cd apps/web && npx vitest run src/lib/category-tree.spec.ts` → FAIL → cài đặt → PASS. Commit `feat(web): mô hình cây danh mục admin và lời gọi API`.

### Task 9: Web: `CategoryTreePanel`

**Files:** Create `apps/web/src/components/admin/category-tree-panel.tsx`, `category-tree-panel.spec.tsx`.

**Interfaces:**
- Consumes: T8. `useConfirm` (`confirm-dialog`), `Notice`, `BTN_*`, `FIELD_XS`, `ToneBadge` (`ui.tsx`).
- Produces: `CategoryTreePanel({ data, loading, error, onRetry, onChanged }: { data: AdminCategoryList | undefined; loading: boolean; error: string | null; onRetry(): void; onChanged(): void })`. Dùng react-query `useMutation` cho 5 lời gọi, thành công thì gọi `onChanged()` (tab làm mới `admin-category-options` và danh sách SP). Khung: tiêu đề "Cây danh mục", dòng đếm "Tầng 1: n/8 · tối đa 8 mục con mỗi mục", danh sách gốc kèm con thụt vào; mỗi dòng: tên, số SP ("12 sản phẩm", cha ghi "cả mục con"), nút "↑" "↓" `aria-label="Đưa "{tên}" lên trên"` / `xuống dưới` (`aria-disabled` ở đầu/cuối, bấm không làm gì), "Đổi tên" (ô nhập tại chỗ + Lưu/Huỷ), `<select aria-label="Chuyển "{tên}" vào">` (chỉ khi mục không có con: "Làm danh mục gốc" + các gốc khác chưa đủ con), "Xoá" (xác nhận); mỗi gốc có "Thêm mục con"; cuối cây "Thêm danh mục gốc"; nút thêm `disabled` kèm dòng chữ lý do khi đủ ("Đã đủ 8 danh mục gốc."). Kết quả báo bằng `Notice role="status"`, lỗi API bằng `role="alert"` nguyên văn câu 400. Sau ↑↓ tiêu điểm ở lại nút vừa bấm (phần tử giữ `key=id`, không remount), và `Notice` đọc "Đã đưa "{tên}" lên vị trí 1/5."
- [ ] **Step 1: test đỏ**: render cây 2 gốc (A có 2 con): bấm "Đưa "B" lên trên" → `PUT /admin/categories/order` body `{ parentId: null, orderedIds: ['B','A'] }`; nút ↑ của mục đầu có `aria-disabled="true"` và bấm không gọi API; sau ↑ `document.activeElement` là nút vừa bấm; 8 gốc → nút "Thêm danh mục gốc" `disabled` và có chữ "Đã đủ 8 danh mục gốc"; cha có 8 con → "Thêm mục con" của cha đó `disabled`, cha khác không; thêm gốc gửi `POST` `{ name }`; đổi tên gửi `PATCH` `{ name }`; select chuyển cha chỉ hiện ở mục không có con, gửi `PATCH` `{ parentId }`; xoá hỏi xác nhận, đồng ý mới `DELETE`; API trả 400 "Đã đủ 8 danh mục gốc…" → hiện trong `role="alert"`; `loading` hiện "Đang tải…", `error` hiện nút "Thử lại"; mọi nút có tên đọc chứa tên mục; thao tác bàn phím: các nút là `<button>` nên Enter/Space chạy (không cần kéo thả).
- [ ] **Step 2:** `npx vitest run src/components/admin/category-tree-panel.spec.tsx` → FAIL → cài đặt → PASS. Commit `feat(web): panel cây danh mục có nút ↑↓, thêm, đổi tên, chuyển cha, xoá`.

### Task 10: Web: nâng cấp tab "Sản phẩm"

**Files:** Modify `product-categories-tab.tsx`, `product-categories-tab.spec.tsx`.

**Interfaces:** Consumes T8, T9. Produces prop mới `initialUncategorized?: boolean` (cạnh `initialMissingImage`). Tab đọc `useQuery(['admin-category-options'], listAdminCategories)`; `onChanged` làm mới khoá đó, `LIST_KEY` và `invalidateInbox`. Bộ chọn `select[aria-label="Danh mục"]` liệt kê mọi danh mục theo cây (con thụt "— "), mục là cha có con ghi thêm "(có mục con)". Chọn cha có con: nút "Gán danh mục" `disabled` kèm dòng "Mục này có mục con. Chọn một mục con để gán." (nút "Gỡ danh mục" vẫn dùng được). Chip "Chưa có danh mục (n)": gửi `uncategorized=1&onSale=1`, n lấy từ hộp việc `productsUncategorized` (thay truy vấn đếm riêng). Ô tìm: placeholder "Tìm tên, thương hiệu hoặc SKU". Chữ mô tả tab ghi luật lá.

- [ ] **Step 1: test đỏ** (sửa ca "bộ chọn lấy danh sách phẳng" thành "bộ chọn lấy từ `/admin/categories`", mock `'/admin/categories'` đứng trước `'/categories'`): bộ chọn có mục con thụt; chọn cha có con → "Gán danh mục" disabled và có dòng cảnh báo; chip "Chưa có danh mục (12)" lấy số từ inbox `productsUncategorized`, bấm → request có `uncategorized=1` và `onSale=1`; `initialUncategorized` bật sẵn chip; gõ "tubu" trong ô tìm → request `q=tubu`; ca gán lại cùng lô hiện "0 sản phẩm đổi, n không đổi (đã đúng sẵn)"; panel hiện ở đầu tab.
- [ ] **Step 2:** `npx vitest run src/components/admin/product-categories-tab.spec.tsx` → FAIL → sửa tab → PASS. Commit `feat(web): tab Sản phẩm có cây danh mục và gán vào danh mục lá`.

### Task 11: Web: thẻ hộp việc dẫn tới màn gán

**Files:** Modify `lib/admin-client.ts` (`InboxKey`), `components/admin/ops-inbox-tab.tsx` (`INBOX_LABELS`, `INBOX_TAB`, `QUALITY_KEYS`), `app/admin/page.tsx` (`openInbox`, `productsSeed`, dòng 704, kiểu `Exclude<…>`); specs `ops-inbox-tab.spec.tsx`, `app/admin/page.spec.tsx`.

**Interfaces:** Produces `INBOX_LABELS.productsUncategorized = { title: 'Sản phẩm đang bán chưa có danh mục', hint: 'Mini App chỉ xếp được sản phẩm vào mục khi đã có danh mục' }`; `INBOX_TAB.productsUncategorized = 'productCategories'`; thêm vào `QUALITY_KEYS` (hiện ở mục Sản phẩm, không cộng vào tổng việc gấp). `productsSeed` thành `{ n: number; view: 'missingImage' | 'uncategorized' } | null` (key remount dùng `n`); `ProductCategoriesTab` nhận `initialMissingImage` hoặc `initialUncategorized` theo `view`.

- [ ] **Step 1: test đỏ**: `ops-inbox-tab.spec`: mock inbox có `productsUncategorized: 12` → thẻ hiện tiêu đề trên và số 12, bấm gọi `onOpen('productsUncategorized')`; `InboxBadge tab="productCategories"` cộng số này, `tab="inbox"` thì không; `page.spec`: bấm `[data-inbox="productsUncategorized"]` → `?tab=productCategories` và request SP cuối có `uncategorized=1` + `onSale=1`, còn thẻ thiếu ảnh vẫn mở `missingImage=1`.
- [ ] **Step 2:** `npx vitest run src/components/admin/ops-inbox-tab.spec.tsx` rồi `src/app/admin/page.spec.tsx` (file nặng: chạy riêng, một lần) → FAIL → cài đặt → PASS. Commit `feat(web): thẻ hộp việc SP đang bán chưa có danh mục mở màn gán`.

### Task 12: Chụp 375px, gate, e2e Mini

- [ ] **Step 1: ảnh** (Next dev web cổng 3326, host localhost; API giả bằng `page.route` của Playwright, token giả trong `localStorage`; script đặt ở scratchpad, không commit): chụp tab "Sản phẩm" 375px và 1280px với cây có 2 gốc/4 con, một cha đủ 8 con (nút thêm khoá), trạng thái lỗi 400; lưu ở `docs/2026-10-31-shop-redesign/screens/P16/` (bị gitignore). Gói không đổi Mini nên không có bản Mini để so; so với màn cũ của `screens/` về lề, vùng chạm, xuống dòng tên dài. Tắt server khi xong.
- [ ] **Step 2: DB riêng** `bash docs/2026-10-20-uat/tools/pg-native.sh start 25547`, tạo DB `tubutree_it`, chạy `category-tree.race-spec.ts` và các race spec cũ liên quan (`catalog-merch-api`, `campaigns`); `pg-native.sh stop 25547` khi xong.
- [ ] **Step 3: gate** một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base d768f7d42 --out …/gate-P16.txt`; bước FAIL kiểm lại ở base trước khi kết luận.
- [ ] **Step 4: e2e Mini** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3325 npx playwright test --workers=2 --reporter=line` (gói không đổi Mini; chạy để chứng minh không hồi quy, ghi kết quả).
