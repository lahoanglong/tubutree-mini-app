# F7b `admin-builder-minors` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** sửa 9 phát hiện MINOR reviewer Opus để lại cho P16 (admin cây danh mục) và P10 (trình dựng gian hàng): 5 việc ở admin web + API danh mục, 4 việc ở màn dựng gian hàng Mini và web.

**Kiến trúc:** không route mới, không endpoint storefront, không migration, không đụng đường tiền. P16: chỉnh `category-tree-panel.tsx` / `product-categories-tab.tsx` (web), thêm một luật xác nhận vào `CategoryAdminService` (đã nằm dưới khoá advisory `catalog.category_tree`), sửa API giả của e2e. P10: chỉnh điều hướng `?khoi=` của hai màn dựng và hook `useSectionStyle` của hai app; mọi sửa là hành vi, mỗi việc có test đỏ trước.

**Tech Stack:** NestJS + Prisma (jest, race-spec Postgres thật), Next 15 + TanStack Query (vitest, `@/test-utils/dom`), Vite + zmp-ui (vitest + testing-library), Playwright (e2e admin mock API).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 (luật); không có mục F7b ở `02-ke-hoach.md`: nguồn là MINOR của reviewer trong `plans/P16-category-admin.md` và `plans/P10-storefront-builder.md`. Bàn giao: `plans/handoff-wave4a.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Không push, không đọc/ghi PROD, không `git stash` trần, không kill tiến trình của người khác. Máy thiếu RAM: chạy test theo file; gate đầy đủ đúng một lần ở cuối.
- Không thêm endpoint storefront, không đụng giá. Không sửa file của gói chạy song song: P15 (bundles), F7a (trang mã giảm giá hai app, `app-core commerce/voucher-center.ts`, `coupon-collect.service.ts`, `storefront.service.ts applyTemplate`, `flash-sale.tsx` hai app + `commerce/countdown.ts`, Mini `components/app.tsx` + `back-button.tsx`, `best-seller-rail.tsx`, `home-view.tsx` web + `home-banner-lg.web.spec.ts`).
- Chữ giao diện tiếng Việt có dấu (`diacritics-style.spec` canh). Tên mục luôn nằm trong tên đọc của nút (`aria-label`).
- Vùng chạm ≥44px (`BTN_*`/`FIELD_XS` của `components/admin/ui.tsx`); nút đầu/cuối dùng `aria-disabled`, không `disabled`, để focus bàn phím không mất.
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó.
- Test e2e cũ đỏ vì thiết kế đổi thì sửa test và ghi vào notes; đỏ vì hồi quy thì sửa mã.

## Review Focus

1. Admin bấm xác nhận chuyển mục rồi lỗi 400/409: lựa chọn đích còn nguyên để thử lại, lỗi hiện cạnh mục (Task 3).
2. Hai admin: một gán SP vào gốc lá, một tạo mục con dưới gốc đó cùng lúc: không bao giờ ra gốc vừa có con vừa giữ SP mà chưa ai xác nhận (Task 4, race).
3. Gốc đã có con từ trước (kể cả còn SP gắn thẳng từ dữ liệu cũ): thêm con tiếp theo không hỏi lại (Task 4).
4. Mở `?khoi=` cũ trỏ tới khối đã xoá, rồi mở khối khác: lùi về danh sách, không rời màn dựng (Task 7).
5. Rời màn lúc có lần ghi kiểu khối đang chạy và một lựa chọn mới trong hàng đợi: lựa chọn mới vẫn được gửi, đúng một lần (Task 6).

---

## Quyết định (4): xác nhận có ép ở máy chủ, không chặn cứng

Chặn cứng bằng 400 gây bế tắc: gốc đang có SP gắn thẳng thì không tạo được mục con, mà SP chỉ chuyển xuống được khi mục con đã tồn tại; lối ra duy nhất là gỡ danh mục khỏi từng SP rồi gán lại, làm SP "chưa có danh mục" (biến khỏi trang danh mục Mini App) giữa chừng. Đây lại chính là lần dựng cây đầu tiên của mọi gốc seed đang có SP. Việc giữ SP ở cha không mất dữ liệu (`categoryScope` của `/categories` và `/products?category=` gồm cả id cha, SP vẫn hiện ở trang của cha). Nên chọn **cảnh báo xác nhận**: máy chủ trả `400` mã `CATEGORY_PARENT_HAS_PRODUCTS` kèm câu nêu số SP, trừ khi thân lệnh có `confirmDirectProducts: true`; giao diện bắt mã đó, hỏi xác nhận bằng chính câu của máy chủ rồi gửi lại có cờ. Ép ở máy chủ (không chỉ ở giao diện) để số SP đọc lúc ghi, dưới khoá cây, không phụ thuộc danh sách admin đang xem đã cũ. Chỉ hỏi khi gốc đích hiện **chưa có con** (lần chuyển từ lá sang cha), không hỏi lại ở mục con thứ hai.

## File Structure

| File | Việc |
|---|---|
| `apps/web/src/components/admin/category-tree-panel.tsx` + `.spec.tsx` | T1 lỗi tải khi thu gọn; T3 chọn rồi bấm "Chuyển"; T5b xác nhận gốc có SP |
| `apps/web/src/components/admin/product-categories-tab.tsx` + `.spec.tsx`, `app/admin/page.spec.tsx` | T2 nhãn chip |
| `packages/shared-types/src/catalog.ts` | T4 hằng `CATEGORY_PARENT_HAS_PRODUCTS` |
| `apps/api/src/modules/catalog/category-tree.ts`, `category-admin.service.ts`, `category-admin.controller.ts` + spec | T4 luật xác nhận |
| `apps/api/test/integration-race/category-tree.race-spec.ts` | T4 race |
| `apps/web/src/lib/product-categories.ts` | T5b cờ trong body create/update |
| `apps/e2e/tests/admin-category-tree.spec.ts` | T2 regex, T5 API giả áp `onSale` |
| `apps/miniapp/src/components/storefront-builder/use-section-style.ts`, `apps/web/src/components/affiliate/use-section-style.ts` + hai spec mới | T6 |
| `apps/miniapp/src/pages/storefront-builder.tsx` + spec | T7, T8 |
| `apps/web/src/components/affiliate/storefront-builder.tsx`, `apps/web/src/app/ctv/gian-hang/page.spec.tsx` | T9, T10 |

Lệnh kiểm một file: `cd apps/web && npx vitest run src/<đường dẫn>`; `cd apps/miniapp && npx vitest run src/<đường dẫn>`; `cd apps/api && npx jest <đường dẫn>`.

---

### Task 1: Lỗi tải danh mục hiện cả khi cây thu gọn (P16-1)

**Files:** Modify `category-tree-panel.tsx` (khối `LoadError` đang nằm trong `{open && ...}`); Test `category-tree-panel.spec.tsx`.

**Interfaces:** không đổi chữ ký. Hành vi: `error && !data` → `LoadError` (có "Thử lại") hiện dù `open=false`; khi `open=true` chỉ một bản.

- [ ] **Step 1: test đỏ** `lỗi tải hiện cả khi panel thu gọn, kèm Thử lại gọi lại API (cùng một bản khi mở)`: `setup({ collapsible: true, startOpen: false, listStatus: 500 })`, `flush`; `container.querySelector('[role="alert"]')?.textContent` chứa `Máy chủ lỗi.`; `container.querySelector('ul[aria-label="Cây danh mục"]')` null; bấm "Thử lại" tăng số GET; bấm "Mở rộng" thì `querySelectorAll('[role="alert"]')` vẫn đúng 1.
- [ ] **Step 2:** `cd apps/web && npx vitest run src/components/admin/category-tree-panel.spec.tsx -t "thu gọn"` → FAIL.
- [ ] **Step 3:** chuyển dòng `{error && !data && <LoadError ...>}` ra ngoài `{open && ...}`, đặt ngay dưới vùng `role="status"`.
- [ ] **Step 4:** chạy cả file → PASS. Commit `fix(web): lỗi tải cây danh mục hiện cả khi panel thu gọn`.

### Task 2: Nhãn chip "Chưa có danh mục" đúng phạm vi (P16-2)

**Files:** Modify `product-categories-tab.tsx` (nhãn chip ~161); Test `product-categories-tab.spec.tsx`, `app/admin/page.spec.tsx` (~3968), `apps/e2e/tests/admin-category-tree.spec.ts` (regex ~214).

**Interfaces:** nhãn chip = `Đang bán, chưa có danh mục (n)` (cùng khuôn với "Đang bán, thiếu ảnh (n)" và tiêu đề thẻ hộp việc "Sản phẩm đang bán chưa có danh mục"). `aria-pressed` và truy vấn `uncategorized=1&onSale=1` giữ nguyên.

- [ ] **Step 1: test đỏ** đổi kỳ vọng ở ba file sang `Đang bán, chưa có danh mục (2)` / `(3)` và `byText(container, 'button', 'Đang bán, chưa có danh mục')`.
- [ ] **Step 2:** `npx vitest run src/components/admin/product-categories-tab.spec.tsx` → FAIL.
- [ ] **Step 3:** đổi nhãn trong JSX; bỏ comment trên `useInfiniteQuery` nếu thành thừa (comment giải thích "vì sao onSale" vẫn giữ).
- [ ] **Step 4:** chạy `product-categories-tab.spec.tsx` và `src/app/admin/page.spec.tsx -t "chưa có danh mục"` → PASS. Commit `fix(web): chip chưa có danh mục ghi rõ phạm vi đang bán`.

### Task 3: Chuyển mục: chọn đích rồi bấm nút xác nhận (P16-3)

**Files:** Modify `category-tree-panel.tsx` (`itemRow`, `relocate`); Test `category-tree-panel.spec.tsx`.

**Interfaces:** state `pick: Record<string, string>` (id mục → giá trị chọn trong `<select>`, `ROOT_VALUE` là đích gốc). `<select aria-label='Chuyển "{tên}" sang mục khác'>` chỉ ghi `pick`, không gọi API. Khi `pick[id]` còn nằm trong `moveOpts` (không bị vô hiệu) hiện thêm `<button aria-label='Chuyển "{tên}" vào "{đích}"'>` (đích gốc: `Chuyển "{tên}" thành danh mục gốc`), chữ hiển thị "Chuyển", `BTN_XS_PRIMARY`, `disabled={saving}`. Bấm nút gọi `relocate(item, parentId, value)` cũ; thành công thì xoá `pick[id]`; thất bại giữ nguyên để thử lại. Đổi `pick` không làm mất focus select.

- [ ] **Step 1: test đỏ** viết lại ca `ô "chuyển vào"...`: `selectValue(sel, 'A')` → `calls('PATCH')` rỗng; nút `Chuyển "Giặt tẩy" vào "Nhà bếp"` xuất hiện; bấm → PATCH `{ parentId: 'A' }`, nút biến mất, focus về nút ↑ của mục. Mục con: chọn `__root__` → nút `Chuyển "Chén bát" thành danh mục gốc`, bấm → `{ parentId: null }`. Thêm ca `PATCH 400: lỗi hiện cạnh mục, ô chọn và nút Chuyển còn nguyên`. Ca tên truy cập (`/"[^"]+"/`) đã có sẽ phủ nút mới.
- [ ] **Step 2:** `npx vitest run src/components/admin/category-tree-panel.spec.tsx -t "chuyển"` → FAIL (PATCH gọi ngay khi chọn).
- [ ] **Step 3:** cài đặt như Interfaces. Nạp skill `ecc:make-interfaces-feel-better`: nút nằm cùng dải với select, `flex-wrap` đã có nên ở 375px tự xuống dòng; không thêm dòng chữ phụ.
- [ ] **Step 4:** chạy cả file → PASS. Commit `fix(web): chuyển danh mục phải bấm nút xác nhận, chọn trong ô không ghi ngay`.

### Task 4: Gốc đang có SP gắn thẳng thành mục cha thì phải xác nhận (P16-4, máy chủ)

**Files:** Modify `packages/shared-types/src/catalog.ts` (hằng), `category-tree.ts` (`CATEGORY_MSG.parentHasProducts`), `category-admin.service.ts` (`create`, `update`), `category-admin.controller.ts` (hai DTO); Test `category-admin.service.spec.ts`, `test/integration-race/category-tree.race-spec.ts`.

**Interfaces:**
- Produces: `CATEGORY_PARENT_HAS_PRODUCTS = 'CATEGORY_PARENT_HAS_PRODUCTS'` (shared-types, `export * ` sẵn qua `index.ts`); `CATEGORY_MSG.parentHasProducts(name: string, n: number): string` = `Danh mục "{name}" đang có {n} sản phẩm gắn thẳng. Khi có mục con, các sản phẩm này vẫn nằm ở "{name}" và chưa thuộc mục con nào; sau khi thêm, gán chúng sang mục con.`; `CategoryAdminService.create(adminId, dto: { name; parentId?; confirmDirectProducts?: boolean })` và `update(adminId, id, patch: { name?; parentId?; confirmDirectProducts?: boolean })`; hai DTO thêm `@IsOptional() @IsBoolean() confirmDirectProducts?: boolean`.
- Luật: trong `write()` (đã giữ khoá), nếu cha đích hiện **không có con** và `tx.product.count({ where: { categoryIds: { has: parentId } } }) > 0` và không có cờ → `BadRequestException({ statusCode: 400, error: 'Bad Request', code: CATEGORY_PARENT_HAS_PRODUCTS, message: CATEGORY_MSG.parentHasProducts(...) })`, không ghi gì, không làm mới cache. `update` kiểm cùng luật khi `wanted` là gốc đích (chỉ khi đổi cha). Cha đã có con: không kiểm.

- [ ] **Step 1: test đỏ** trong `category-admin.service.spec.ts` (kho giả `make(rows, products)`): (a) tạo con dưới gốc có 2 SP gắn thẳng, không cờ → `BadRequestException` có `getResponse().code === CATEGORY_PARENT_HAS_PRODUCTS`, `message` chứa `2 sản phẩm`, `prisma.category.create` không gọi, `catalog.invalidateCategoryCache` không gọi; (b) cùng ca có `confirmDirectProducts: true` → tạo được; (c) gốc không SP → tạo không cờ được; (d) gốc đã có con và vẫn có SP gắn thẳng → thêm con tiếp không cờ được; (e) `update` chuyển gốc lá `B` vào gốc `A` có SP: chặn không cờ, có cờ thì được; chuyển `B` vào gốc `A` không SP: được; SP của `B` không bị tính (đếm theo cha đích).
- [ ] **Step 2:** `cd apps/api && npx jest src/modules/catalog/category-admin.service.spec.ts` → FAIL.
- [ ] **Step 3:** thêm hằng, message, hàm riêng `assertDirectProductsConfirmed(tx, parent: TreeRow, confirmed: boolean | undefined)` gọi từ `create` và `update`; DTO.
- [ ] **Step 4:** chạy lại → PASS; `npx jest src/modules/catalog/category-tree.spec.ts src/common/diacritics-style.spec.ts` → PASS.
- [ ] **Step 5: race (Review Focus 2).** Trong `category-tree.race-spec.ts`, đặt ca đầu tiên: SP `x1`, `Promise.allSettled([svc.create('it', { name, parentId: listParent }), products.assign('it', [x1.id], listParent, 'ADD')])`; khẳng định không xảy ra đồng thời "có con dưới `listParent`" và "`categoryIds` của `x1` chứa `listParent`"; nếu `create` bị từ chối thì `reason.getResponse().code === CATEGORY_PARENT_HAS_PRODUCTS`, nếu `assign` bị từ chối thì thông báo là `CATEGORY_MSG.notLeaf`. Dọn: `products.assign('it', [x1.id], listParent, 'REMOVE')` trong `finally` để ca sau ("thấy ngay") còn tạo được con. Chạy theo "Gate" (cụm 25550).
- [ ] **Step 6:** commit `feat(api): thêm mục con vào gốc đang có sản phẩm gắn thẳng phải xác nhận`.

### Task 5: Giao diện xác nhận gốc có SP (P16-4, web) và API giả e2e (P16-5)

**Files:** Modify `apps/web/src/lib/product-categories.ts` (body của `createAdminCategory`, `updateAdminCategory` nhận `confirmDirectProducts?: boolean`), `category-tree-panel.tsx` (`run` / `submit` / `relocate`); Test `category-tree-panel.spec.tsx`, `apps/e2e/tests/admin-category-tree.spec.ts`.

**Interfaces:** khi `create`/`update` ném `ApiError` có `code === CATEGORY_PARENT_HAS_PRODUCTS` (import từ `@tubutree/shared-types`), panel không đặt lỗi mà mở `confirm({ title: 'Thêm mục con vào mục đang có sản phẩm', message: e.message, confirmLabel: 'Vẫn thêm' })` (chuyển: `'Vẫn chuyển'`); đồng ý thì gửi lại cùng body kèm `confirmDirectProducts: true`; từ chối thì giữ ô nhập/lựa chọn như cũ, không lỗi.

- [ ] **Step 1: test đỏ** (panel): POST 400 `{ code: 'CATEGORY_PARENT_HAS_PRODUCTS', message }` → hộp xác nhận hiện đúng `message`; Huỷ → không POST lần hai, ô nhập giữ tên, không `role="alert"`; Đồng ý → POST thứ hai có `confirmDirectProducts: true`. Cùng cho PATCH khi bấm "Chuyển".
- [ ] **Step 2:** `npx vitest run src/components/admin/category-tree-panel.spec.tsx -t "xác nhận"` → FAIL.
- [ ] **Step 3:** cài đặt trong `run` (nhận tham số `retry?: () => Promise<unknown>`) hoặc hàm bọc `withParentConfirm`: không nhân đôi `busy`/`saving`.
- [ ] **Step 4 (P16-5):** `apps/e2e/tests/admin-category-tree.spec.ts`: thay `api.get('/admin/product-categories/products', PRODUCTS)` bằng hàm `productsPage(query)` áp `uncategorized` (`categoryIds` rỗng), `onSale` (`isActive`), `missingImage` (`thumbnail === null` và `isActive`), `q` (không dấu, chữ thường, khớp tên hoặc thương hiệu), trả `{ items, total, nextCursor: null }`. Số hộp việc mặc định = số SP đang bán chưa có danh mục của `PRODUCTS` (1, không còn 3), regex chip đổi theo; ca "thẻ hộp việc" khẳng định thêm `p3` (tắt) không có trong danh sách chip và số hàng bằng số trên thẻ.
- [ ] **Step 5:** chạy panel spec → PASS. e2e: `cd apps/e2e && E2E_SCOPE=web-admin E2E_WEB_PORT=3344 npx playwright test admin-category-tree --reporter=line` → PASS (ghi cổng và tắt server sau khi xong). Commit `fix(web): xác nhận khi thêm mục con vào gốc đang có sản phẩm; API giả e2e áp onSale`.

### Task 6: `useSectionStyle` gửi nốt lựa chọn khi rời màn lúc lần ghi trước còn chạy (P10-9)

**Files:** Modify `apps/miniapp/src/components/storefront-builder/use-section-style.ts`, `apps/web/src/components/affiliate/use-section-style.ts` (hai bản giống nhau, chỉ khác `'use client'`), và nơi gọi ở `pages/storefront-builder.tsx`, `components/affiliate/storefront-builder.tsx` (bỏ khoá `isPending`); Test mới `use-section-style.spec.tsx` cạnh mỗi bản.

**Interfaces:** `SectionStyleDeps = { send(v: { id: string; layout: SectionLayout }): void; currentOf(id: string): SectionStyle | null }` (bỏ `isPending`: nó đọc `layoutMut.isPending` của lần vẽ cuối nên sau khi rời màn luôn đứng yên). Hook tự giữ `busy` (ref): đặt khi gọi `send`, xoá trong `settled(id, layout)` (đã được `onSettled` của mutation gọi, mutation vẫn chạy xong sau khi rời màn). Rời màn: huỷ timer; có `queued` mà `busy` thì giữ `queued` và `settled` sẽ gửi nó (qua đúng kiểm `currentOf(q.id) === q.layout` như `flush`); có `queued` mà không `busy` thì gửi ngay (như cũ). `settled` trả `void`.

- [ ] **Step 1: test đỏ** (cả hai app, `vi.useFakeTimers`, host render hook với `send = vi.fn()` và `currentOf = () => 'GRID'`): `choose('c1','STACK')`, tiến 300ms → `send` gọi một lần với STACK (đang bận); `choose('c1','CAROUSEL')`; unmount ngay (trước 300ms); khẳng định `send` chưa gọi lần hai; gọi `settled('c1','STACK')` → `send` gọi lần hai đúng `{ id: 'c1', layout: 'CAROUSEL' }`, không lần ba. Thêm ca: rời màn khi không bận thì gửi ngay; ca `currentOf` đã bằng lựa chọn thì không gửi.
- [ ] **Step 2:** `npx vitest run src/components/storefront-builder/use-section-style.spec.tsx` (Mini) và `src/components/affiliate/use-section-style.spec.tsx` (web) → FAIL.
- [ ] **Step 3:** cài đặt; sửa hai nơi gọi (xoá `isPending: () => layoutMut.isPending`).
- [ ] **Step 4:** chạy hai spec mới + `pages/storefront-builder.spec.tsx -t "kiểu"` (Mini) + `app/ctv/gian-hang/page.spec.tsx -t "kiểu"` (web) → PASS. Commit `fix(miniapp,web): đổi kiểu khối gửi nốt lựa chọn cuối khi rời màn lúc lần ghi trước chưa xong`.

### Task 7: Mini: `?khoi=` cũ rồi mở khối khác, "Gian hàng của tôi" phải lùi được (P10-6)

**Files:** Modify `apps/miniapp/src/pages/storefront-builder.tsx` (`openSection`); Test `pages/storefront-builder.spec.tsx` (nhóm "lùi từ trang chi tiết").

**Interfaces:** `openSection(id)`: đang ở trang chi tiết thật (`sectionCol !== null`) thì `navigate(href, { replace: true, state: location.state })` (giữ dấu `builderSection` của mục đang thay); ngược lại (danh sách, kể cả khi `?khoi=` trỏ khối không còn) thì đẩy mục mới `{ state: { builderSection: true } }`. Mọi chỗ khác không đổi.

- [ ] **Step 1: test đỏ** `?khoi= cũ (khối đã xoá) rồi mở khối khác: "Gian hàng của tôi" về danh sách, không rời màn dựng`: `router.go('/storefront?khoi=khong-co', { replace: true })`, `renderPage()`, mở "Bộ hai", bấm "Gian hàng của tôi": `findAllByTestId('section-card')` có 3 thẻ, `here()` là `/storefront`.
- [ ] **Step 2:** chạy ca → FAIL (replace làm mất mục danh sách, `navigate(-1)` kẹt ở đầu lịch sử).
- [ ] **Step 3:** sửa `openSection`.
- [ ] **Step 4:** chạy cả nhóm → PASS. Commit `fix(miniapp): mở khối từ danh sách khi ?khoi= cũ vẫn đẩy mục lịch sử mới`.

### Task 8: Mini: mở thẳng `?khoi=` dựng sẵn mục danh sách phía trước (P10-8)

**Files:** Modify `apps/miniapp/src/pages/storefront-builder.tsx`; Test `pages/storefront-builder.spec.tsx`.

**Interfaces:** một `useEffect` chạy đúng một lần khi `sectionCol` lần đầu khác null: nếu `location.state.builderSection` chưa có thì `navigate(location.pathname, { replace: true })` rồi `navigate(sectionHref(location.pathname, sectionCol.id), { state: { builderSection: true } })`. Hệ quả: nút lùi nổi toàn cục (`navigate(-1)` khi `idx > 0`, không sửa file đó) và "Gian hàng của tôi" (`navigate(-1)`) đều về danh sách. Không dựng khi `?khoi=` trỏ khối không còn.

- [ ] **Step 1: test đỏ** sửa ca `mở thẳng bằng link có ?khoi=...` thành `mở thẳng bằng link ?khoi=: nút lùi nổi và "Gian hàng của tôi" cùng về danh sách`: `router.go('/storefront?khoi=c2', { replace: true })`, `renderWithBack()`; sau khi vào chi tiết `router.stack` dài 2 và mục đầu là `/storefront`; bấm "Quay lại" → danh sách, `here()` là `/storefront`; chạy lại bằng "Gian hàng của tôi" → cùng kết quả. Ca F5 (state `builderSection` còn): không dựng thêm mục (`stack` giữ nguyên).
- [ ] **Step 2:** chạy → FAIL (`stack` dài 1, nút lùi nổi đi `/` vì `idx = 0`).
- [ ] **Step 3:** cài đặt. Ghi vào notes: phụ thuộc hành vi `idx > 0 → navigate(-1)` của `back-button.tsx` (F7a đang sửa file đó).
- [ ] **Step 4:** chạy cả `storefront-builder.spec.tsx` → PASS. Commit `fix(miniapp): mở thẳng ?khoi= có sẵn mục danh sách phía trước, hai nút lùi cùng một chỗ`.

### Task 9: Web: mở/đóng khối bằng History API, không soft navigation (P10-7)

**Files:** Create `apps/web/src/lib/shallow-url.ts` (+ `.spec.ts`); Modify `components/affiliate/storefront-builder.tsx` (`openSection`, `closeSection`); Test `app/ctv/gian-hang/page.spec.tsx` (nav giả).

**Interfaces:** `shallowPush(url: string, state?: Record<string, unknown>): void` và `shallowReplace(url: string, state?: Record<string, unknown>): void` = `window.history.pushState` / `replaceState` với `state` (mặc định `{}`: object, để `nav-depth` còn đóng dấu độ sâu) và không gọi `router`. Next 15 đồng bộ `useSearchParams`/`usePathname` với hai lời gọi này nên màn vẫn đổi mà không tải RSC. `closeSection` khi cần lùi giữ `router.back()` (không tải lại trang mới). Test giả: `nav` ở `page.spec.tsx` vá `history.pushState/replaceState` (bắt chước Next) để đổi `nav.loc`, lưu state theo mục (`Loc.state`), `emit()` ghi `{ tubuDepth, ...state }`; hai spy `nav.api.push/replace` đếm số lần gọi.

- [ ] **Step 1: test đỏ** (a) `shallow-url.spec.ts`: `shallowPush('/x?khoi=a', { a: 1 })` gọi `history.pushState` với object chứa `a`; không có `state` thì đối số đầu là `{}`. (b) `page.spec.tsx`: ca `mở khối không gọi router.push/replace (không soft navigation): URL đổi qua History API`, `openCard('Bộ hai,')` → `nav.api.push` và `replace` chưa từng gọi, `here()` là `/ctv/gian-hang?khoi=c2`; đóng bằng "Gian hàng của tôi" cũng không gọi `replace`.
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** cài đặt `shallow-url.ts`; thay `router.push/replace` trong `openSection`/`closeSection` (nhánh `replace`) bằng hai hàm; vá `nav` trong spec; mọi ca lùi cũ còn xanh.
- [ ] **Step 4:** chạy `shallow-url.spec.ts` + `page.spec.tsx -t "chi tiết"` → PASS. Commit `fix(web): trình dựng gian hàng đổi ?khoi= bằng History API, không tải RSC`.

### Task 10: Web: nút lùi nổi và "Gian hàng của tôi" cùng một chỗ khi mở thẳng/F5 (P10-8)

**Files:** Modify `components/affiliate/storefront-builder.tsx`; Test `app/ctv/gian-hang/page.spec.tsx`.

**Interfaces:** dấu "có mục danh sách phía trước" chuyển từ ref `pushedDetail` (mất khi F5) sang `window.history.state.builderSection === true`: `openSection` từ danh sách gọi `shallowPush(href, { builderSection: true })`, từ trang chi tiết gọi `shallowReplace(href, { builderSection: true })` (giữ dấu); `closeSection` lùi `router.back()` khi có dấu, ngược lại `shallowReplace(pathname)`. Một `useEffect` chạy đúng một lần khi `sectionCol` lần đầu khác null mà chưa có dấu: `shallowReplace(pathname)` rồi `shallowPush(sectionHref(pathname, id), { builderSection: true })`. Không dựng khi `?khoi=` trỏ khối không còn.

- [ ] **Step 1: test đỏ** đổi ca `mở thẳng bằng link có ?khoi=...` thành: `nav.to('/ctv/gian-hang?khoi=c2', true)` + `mountWithBack()` → sau khi vào chi tiết `nav.stack` dài 2, mục đầu `/ctv/gian-hang`; bấm nút lùi nổi → danh sách, `here()` là `/ctv/gian-hang`; mount lại và bấm "Gian hàng của tôi" → cùng kết quả (`nav.idx` 0). Ca F5: `nav.stack` mở sẵn `[danh sách, chi tiết có dấu]` và `nav.idx = 1` rồi mount → không thêm mục (`stack` dài 2), "Gian hàng của tôi" lùi một bước. Ca `?khoi=khong-co` không dựng thêm mục.
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** cài đặt.
- [ ] **Step 4:** chạy cả `page.spec.tsx` → PASS. Commit `fix(web): mở thẳng hay F5 ở trang chi tiết khối, hai nút lùi về cùng danh sách khối`.

### Task 11: Gate, e2e Mini, ảnh 375px

- [ ] **Step 1:** DB riêng: `bash docs/2026-10-20-uat/tools/pg-native.sh start 25550`, `createdb 25550 tubutree_it`, `DATABASE_URL=postgresql://tubu@127.0.0.1:25550/tubutree_it npx prisma migrate deploy` (trong `apps/api`), rồi `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/category-tree.race-spec.ts` → PASS. Xong `pg-native.sh stop 25550`.
- [ ] **Step 2:** ảnh 375px (gitignore, `docs/2026-10-31-shop-redesign/screens/F7b/`): web admin qua `P16_SCREENS_DIR` của e2e (`E2E_SCOPE=web-admin E2E_WEB_PORT=3344`), Mini màn dựng qua một ca chụp tạm hoặc spec chụp có sẵn (Vite 3343); so Mini ↔ web ở màn dựng; tắt server của mình.
- [ ] **Step 3:** e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3343 npx playwright test --workers=2 --reporter=line`; đỏ do thiết kế → sửa test, ghi notes.
- [ ] **Step 4:** gate: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base e3229fe39 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F7b.txt`; bước FAIL đối chiếu với base trước khi kết luận.

## Self-review

- Phủ 9 việc: P16-1 T1; P16-2 T2; P16-3 T3; P16-4 T4+T5; P16-5 T5; P10-6 T7; P10-7 T9; P10-8 T8+T10; P10-9 T6.
- Nhất quán tên: `CATEGORY_PARENT_HAS_PRODUCTS`, `confirmDirectProducts`, `builderSection`, `shallowPush/shallowReplace`, `SectionStyleDeps` (không còn `isPending`) dùng giống nhau từ T4 đến T10.
- Rủi ro ghi sẵn cho notes: T8 phụ thuộc `idx > 0 → navigate(-1)` của `back-button.tsx` Mini (file của F7a); T4 ép xác nhận ở API nên gọi API trực tiếp (không qua panel) phải gửi `confirmDirectProducts`; T5 đổi số mặc định của hộp việc trong e2e (3 → 1).

## Lệch kế hoạch khi làm

- Race spec: gốc seed của DB IT đều đang giữ sản phẩm gắn thẳng (6–12 sản phẩm mỗi gốc), nên mọi ca cũ tạo con dưới gốc seed phải mang `confirmDirectProducts: true` (helper `under`); ca race mới dùng một gốc mới trống (tạo rồi xoá trong ca để trả chỗ gốc cho ca "đủ 8 gốc").
- T5 thêm một ca e2e 375px cho nút "Chuyển" (`relocate-pick-375.png`) và T8 thêm một ca e2e Mini cho mở thẳng `?khoi=` (router thật của react-router, không phải lịch sử giả).
- Cổng Mini e2e dùng 3347 thay vì 3343 vì 3343 đang do `fake-api.js` của phiên F7a giữ (không phải tiến trình của gói này).
- Ảnh web màn dựng 375px chụp bằng một spec tạm trong project Web Admin (mock API) rồi xoá; ảnh nằm ở `screens/F7b/`.
