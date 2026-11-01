# F9 home-combos-dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kệ Combo của Trang chủ chiếm các món của nó theo slug sản phẩm, để Bán chạy nhất và lưới Gợi ý hôm nay bỏ món đã nằm trong combo (§5: Giờ vàng > Mua lại > Combo > Bán chạy nhất), mà không thêm request ở lần mở và không làm trang nhảy.

**Architecture:** `ShelfEntry` có thêm khoá phụ `also`; `applyShelfDedupe` coi một phần tử chiếm `id` cùng mọi khoá `also` và bỏ phần tử nếu BẤT KỲ khoá nào đã bị kệ hạng cao chiếm. Combo là đơn vị nguyên: id là id bộ, `also` là slug các món (`comboShelfEntry`). Hai hook `use-home-shelves` chỉ đổi đầu vào combo. Web đưa combo vào `loadHomeInitial` (HTML đầu có kệ combo nên chống trùng ổn định ngay lần vẽ đầu); Mini giữ khung chờ Bán chạy nhất tới khi biết combo (có hạn chờ) vì hai khối cùng đến từ request gộp `/home`.

**Tech Stack:** TypeScript, vitest (app-core, Mini, web), jest (API, chỉ chạy lại), Playwright (e2e Mini + web Trang chủ), React Query v5.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §4 Q15/Q18, §5 ("Trang chủ": thứ tự chống trùng); `02-ke-hoach.md` P6, P11, P15 (nguồn: `plans/P15-bundles.md`, `plans/handoff-wave4a.md`, `plans/F8-bundles-followups.md`).

## Hiện trạng đã kiểm (không làm lại)

- API: `GET /home` đã có khối `combos` trong phần tĩnh (`home.service.ts` `buildStatic`, `HOME_COMBOS_LIMIT = 4`, `block('combos', ...)`, spec `home.service.spec.ts` khối "khối combos"). `HomePublicDTO.combos?` đã tuỳ chọn. `bundles.service.homeCombos` đã bỏ bộ hết hàng, bộ dính Giờ vàng đang chạy, bộ sai luật. Gói này KHÔNG sửa API (F8b giữ `modules/bundles/*`).
- Mini: `getHomeCombos` đã `takePublicBlock('combos') ?? fetchHomeCombos`; `takeHomeRequest('/bundles/combos', {limit:4})` đã có; `home-requests.spec` đã có hai ca (khối gộp không thêm request, API cũ lùi về một request lẻ).
- Còn thiếu: (1) combo xếp theo id bộ nên không chiếm món (lệch P15); (2) web chưa tải combo ở máy chủ nên kệ combo chen vào sau hydrate; (3) Mini chưa chặn khung hình giữa lúc Bán chạy nhất đã về mà combo chưa.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh.
- Chức năng cho khách: Mini App và web cùng gói; logic ở `packages/app-core`, app không chép logic.
- Thứ tự chống trùng Trang chủ: Giờ vàng > Mua lại > Combo > Bán chạy nhất > Mới > Gợi ý (§5; `SHELVES[].dedupeRank` 1, 2, 3, 4, 5, 6). Kệ hạng cao giữ món; kệ dưới `minItems` ẩn và KHÔNG chiếm món.
- "Giờ vàng hết giờ" lọc theo giờ máy chủ (`serverNow()`); suất/combo đã hết hạn không chiếm món.
- Hạng thật của Bán chạy nhất đi theo món (vị trí trước khi bỏ trùng), không đánh lại.
- Không đổi cách tính tiền combo; nhân viên tự tạo bộ không hưởng giá (F8) nhưng phần tĩnh công khai không biết người xem: giữ như PDP.
- Khung chờ Trang chủ không làm trang nhảy (`HOME_SETTLING_HEIGHTS`, e2e `home-p6-cls`, 'Danh mục không xê dịch'); hai app không thêm request ở lần mở; mock `/home/me` KHÔNG có `shippingOrders` (PR #111: `hasOrders`).
- Chữ giao diện không đổi (không thêm khoá `shop-copy`).
- Không deploy, không đọc/ghi PROD, không push, không `git stash` trần. Comment chỉ nói "vì sao", tiếng Việt, theo mật độ file xung quanh.
- Không sửa file của F8b (`apps/api/src/modules/bundles/*`, `storefront/combo.service.ts`, cart/checkout, admin bundle-form) và P17b (ratchet, baseline, ds-parity, axe, ds-shop-guard, DESIGN.md, ds-map.json, terminology.spec).

## Review Focus

1. Combo chứa món đã ở Giờ vàng hoặc Mua lại (kệ hạng cao hơn): combo KHÔNG bị loại (sửa sau review, xem "Sửa theo review vòng 1"; bản đầu bỏ cả combo và làm kệ combo hiện rồi biến mất khi Mua lại về sau). Test: Task 1 `shelves.spec` và `home-shelves.spec`, hook Mini và web.
2. Sau chống trùng còn dưới 2 combo: kệ ẩn và không chiếm món, Bán chạy nhất giữ đủ món. Test: Task 1.
3. Chống trùng làm Bán chạy nhất còn dưới 3 món: kệ ẩn gọn (không khung rỗng), `seen` không chứa món của kệ đã ẩn. Test: Task 1, Task 3.
4. Hai combo dùng chung một món: không loại nhau (cùng kệ), món chỉ chiếm một lần. Test: Task 1.
5. Combo hết hạn lúc trang mở (giờ máy chủ), hoặc hết hạn giữa lúc HTML dựng sẵn và hydrate: không chiếm món, HTML máy chủ và lượt hydrate đầu ra cùng một kệ. Test: Task 2 (app-core), Task 4 (web).
6. Combo về chậm hoặc lỗi: Mini giữ khung chờ Bán chạy nhất tối đa `COMBO_HOLD_MS`, hết hạn chờ thì vẽ tiếp; combo lỗi thì kệ rỗng và Bán chạy nhất đầy đủ. Test: Task 3.
7. API cũ không có khối `combos`: lùi về một request lẻ, không gãy chống trùng (đã có ở `home-requests.spec`, chạy lại).

---

### Task 1: app-core — khoá phụ `also` và `comboShelfEntry`

**Files:**
- Modify: `packages/app-core/src/merch/shelves.ts` (`applyShelfDedupe`, chú thích)
- Modify: `packages/app-core/src/merch/home-shelves.ts` (`ShelfEntry`, `composeHomeShelves`, thêm `comboShelfEntry`, `COMBO_HOLD_MS`)
- Test: `packages/app-core/src/merch/shelves.spec.ts`, `packages/app-core/src/merch/home-shelves.spec.ts`

**Interfaces:**
- Produces:
  - `export interface ShelfEntry<T> { id: string; also?: readonly string[]; item: T }` (home-shelves.ts). `also`: khoá phụ cùng chiếm với `id` (slug các món của một combo).
  - `applyShelfDedupe<T extends { id: string; also?: readonly string[] }>(shelves: { id: string; items: T[] }[]): { id: string; items: T[] }[]` (shelves.ts). Phần tử chiếm `[id, ...also]`; kệ có hạng bỏ phần tử nếu BẤT KỲ khoá nào đã bị kệ hạng cao chiếm; trùng trong chính kệ vẫn xét theo `id` (`uniqueById`, hai combo chung một món không loại nhau).
  - `comboShelfEntry<V extends { id: string; items: readonly { slug: string }[] }>(view: V): ShelfEntry<V>` → `{ id: view.id, also: view.items.map((i) => i.slug), item: view }`.
  - `export const COMBO_HOLD_MS = 1500` (home-shelves.ts): hạn Mini chờ combo trước khi cho Bán chạy nhất vẽ.
  - `composeHomeShelves` không đổi chữ ký; `seen` gồm `id` và mọi `also` của phần tử còn hiện.

- [ ] **Step 1: Viết test đỏ cho `applyShelfDedupe`** trong `shelves.spec.ts` (khối mới "khoá phụ `also`"): dùng kệ thật `home.combos` + `home.bestSellers` + `home.flash`.
  - `bestSellers` p1..p6 và `combos [{id:'c1', also:['p1','p2']}, {id:'c2', also:['p2']}]` → Bán chạy còn `['p3','p4','p5','p6']`; hai combo chung `p2` không loại nhau (cùng kệ).
  - `flash [{id:'p1'},{id:'p7'},{id:'p8'}]` + `combos [{id:'c1', also:['p1','p2']}, {id:'c2', also:['p3','p4']}]` → combos còn `['c2']` dưới `minItems` 2 ⇒ `[]`; vì kệ ẩn nên Bán chạy giữ `p3`, `p4`.
  - phần tử không có `also` chạy như cũ (các test hiện có giữ xanh).
- [ ] **Step 2: Chạy** `pnpm --filter @tubutree/app-core exec vitest run src/merch/shelves.spec.ts` → FAIL (combo vẫn chiếm theo `id`).
- [ ] **Step 3: Cài `also` trong `applyShelfDedupe`**: hàm `keysOf(x) = [x.id, ...(x.also ?? [])]`; lọc `fresh` bằng `keysOf(x).every((k) => !claimed.has(k))`; khi `shown` đủ thì claim mọi khoá của từng phần tử. Cập nhật chú thích đầu hàm (một câu: combo là đơn vị nguyên, chứa món đã bị chiếm thì bỏ cả combo).
- [ ] **Step 4: Chạy lại** spec trên → PASS.
- [ ] **Step 5: Viết test đỏ cho `composeHomeShelves`/`comboShelfEntry`** trong `home-shelves.spec.ts` (khối "combo chiếm món theo slug"), dùng `comboShelfEntry({ id:'c1', items:[{slug:'a'},{slug:'b'}] })`:
  - combo c1 (a, b), c2 (c, d) + bestSellers a..h → `bestSellers` không còn a, b, c, d; `seen` có a..d và các món còn lại (`composeHomeShelves` đã đưa `seen` qua `also`).
  - Giờ vàng có `a` + 2 món khác, combos c1 (a, b), c2 (c, d) → `combos` chỉ còn `c2` dưới `minItems` ⇒ `[]` và `seen` không có `c`, `d` do combo ẩn (chỉ có món của Bán chạy nhất).
  - Mua lại `b` (khách cũ) + combo c1 (a, b), c2 (c, d), c3 (e, f) → `combos` = c2, c3; Mua lại giữ `b`.
  - `comboShelfEntry` trả đúng `{id, also, item}`.
- [ ] **Step 6: Chạy** `home-shelves.spec.ts` → FAIL; **Step 7:** thêm `also` vào `ShelfEntry`, `comboShelfEntry`, `COMBO_HOLD_MS`, sửa `seen` trong `composeHomeShelves` (gồm `also`), sửa chú thích `composeHomeShelves` (bỏ ý "combos xếp theo id bộ"); **Step 8:** chạy cả hai spec + `pnpm --filter @tubutree/app-core exec tsc --noEmit` → PASS.
- [ ] **Step 9: Commit** `feat(app-core): combo chiếm món theo slug khi chống trùng kệ Trang chủ` (kèm dòng Co-Authored-By).

### Task 2: app-core — `comboView` nhận mốc kiểm hết hạn riêng

Lý do: web có combo dựng sẵn trong HTML (ISR), nên lượt hydrate đầu không được bỏ combo mà HTML còn vẽ (như Giờ vàng dùng `!hydrated`), nhưng `now` vẫn phải là giờ thật để nhãn "Mới" của thẻ khớp.

**Files:**
- Modify: `packages/app-core/src/commerce/bundle-view.ts` (`comboView`)
- Test: `packages/app-core/src/commerce/bundle-view.spec.ts`

**Interfaces:**
- Produces: `comboView(b: BundleDTO, now: number, liveAt: number = now): ComboView | null`. `liveAt` là mốc so với `endAt` (`bundleLive(b, liveAt)`); `now` vẫn dùng cho thẻ món. Truyền `Number.NEGATIVE_INFINITY` nghĩa là "chưa kiểm hạn".

- [ ] **Step 1: Test đỏ** (`bundle-view.spec.ts`): combo `endAt` quá khứ → `comboView(b, now)` là `null`, `comboView(b, now, Number.NEGATIVE_INFINITY)` là view đủ `items`; không truyền `liveAt` thì hành vi cũ (test sẵn có xanh).
- [ ] **Step 2: Chạy** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/bundle-view.spec.ts` → FAIL.
- [ ] **Step 3: Thêm tham số `liveAt`** vào `comboView`, thay `bundleLive(b, now)` bằng `bundleLive(b, liveAt)`; nói ở chú thích hàm vì sao (hydrate khớp HTML dựng sẵn).
- [ ] **Step 4: Chạy lại** → PASS; **Step 5: Commit** `feat(app-core): comboView nhận mốc kiểm hết hạn riêng cho lượt hydrate đầu`.

### Task 3: Mini App — hook `use-home-shelves` chống trùng combo + giữ khung chờ

**Files:**
- Modify: `apps/miniapp/src/components/home/use-home-shelves.ts`
- Test: `apps/miniapp/src/components/home/use-home-shelves.spec.tsx`; chạy lại `apps/miniapp/src/pages/home-requests.spec.tsx`, `apps/miniapp/src/pages/home.spec.tsx`

**Interfaces:**
- Consumes: `comboShelfEntry`, `COMBO_HOLD_MS` (Task 1).
- Produces: `HomeShelves` giữ nguyên các trường; đổi nghĩa `combos` (chiếm món) và `seen` (gồm món của combo còn hiện). `bestSellerQuery.isLoading` còn true trong lúc combo chưa về (tối đa `COMBO_HOLD_MS` kể từ lúc hook mount) để kệ Bán chạy nhất giữ khung chờ thay vì vẽ món rồi bỏ.

- [ ] **Step 1: Test đỏ** trong khối "combo toàn sàn" của spec: (dùng `bundleOf` đã có; các món của `bundleOf` đều là `card('p1')`)
  - sửa ca "combo không chiếm món" thành "combo chiếm món": hai combo → `combos` ids `['c1','c2']`, `bestSellers` slug `['p2','p3','p4']`, `seen.has('p1') === true`, `bestSellerRanks` `[4,5,6]` (hạng thật: a=1, x=2, p1=3 ở bảng `['a','x','p1','p2','p3','p4']`).
  - "combo về chậm": `fetchCombos` là Promise treo; sau khi `fetchProducts` đã về, `bestSellerQuery.isLoading === true`; resolve combo → `isLoading === false` và `bestSellers` không còn `p1`.
  - "hạn chờ": combo không bao giờ về, `vi.useFakeTimers({ toFake: ['setTimeout'] })`, tiến `COMBO_HOLD_MS` → `bestSellerQuery.isLoading === false` và `bestSellers` đầy đủ.
  - "combo lỗi": ca sẵn có giữ xanh, thêm `bestSellerQuery.isLoading === false`.
  - Combo chứa món đang ở Giờ vàng (`a`) + combo thứ hai chung `a`: `combos` rỗng, `seen` không đổi so với không có combo.
- [ ] **Step 2: Chạy** `pnpm --filter @tubutree/miniapp exec vitest run src/components/home/use-home-shelves.spec.tsx` → FAIL.
- [ ] **Step 3: Sửa hook**: `combos: (combosData ?? []).flatMap((b) => comboView(b, now) ?? []).map(comboShelfEntry)`; `combosQuery.isLoading` + cờ `holdExpired` (`useState(false)`, `useEffect` đặt `setTimeout(COMBO_HOLD_MS)`, dọn khi unmount) → trả `bestSellerQuery: { ...bestSellerQuery, isLoading: bestSellerQuery.isLoading || (combosQuery.isLoading && !holdExpired) }`. Cập nhật chú thích đầu hàm và của trường `combos` (bỏ "combo không chiếm món").
- [ ] **Step 4: Chạy lại** spec hook + `home-requests.spec.tsx` + `home.spec.tsx` + `home-blocks.spec.ts` → PASS (không thêm request: ca "khối gộp /home" của `home-requests.spec` vẫn xanh).
- [ ] **Step 5: Commit** `feat(miniapp): Bán chạy nhất bỏ món đã nằm trong combo, giữ khung chờ tới khi biết combo`.

### Task 4: web — combo dựng sẵn ở máy chủ và chống trùng cùng quy tắc

**Files:**
- Modify: `apps/web/src/lib/home-initial.ts`, `apps/web/src/components/home/home-view.tsx` (`HomeInitial.combos`, truyền vào hook), `apps/web/src/components/home/use-home-shelves.ts`
- Test: `apps/web/src/lib/home-initial.spec.ts`, `apps/web/src/components/home/use-home-shelves.spec.tsx`, `apps/web/src/components/home/home-view.spec.tsx` (nếu mock `HomeInitial` cần trường mới)

**Interfaces:**
- Consumes: `comboShelfEntry` (Task 1), `comboView(b, now, liveAt)` (Task 2), `fetchHomeCombos(http, limit)` và `HOME_COMBOS_LIMIT` (`@tubutree/app-core/api/bundle`).
- Produces: `HomeInitial.combos?: BundleDTO[]` (rỗng nghĩa là máy chủ đã hỏi và không có; vắng nghĩa là lỗi, client tự tải); `export const COMBO_REVALIDATE_S = 60` (home-initial.ts); `HomeShelvesInitial.combos?: BundleDTO[]`.

- [ ] **Step 1: Test đỏ `home-initial.spec.ts`**: `loadHomeInitial()` trả `combos` từ `fetchHomeCombos` với `limit = HOME_COMBOS_LIMIT` và `createServerHttp({ revalidate: COMBO_REVALIDATE_S })`; bỏ combo đã quá `endAt` (như suất Giờ vàng); lỗi riêng combo thì `combos` undefined còn các phần khác vẫn có; `next build` khi thiếu `combos` cũng thêm lệnh fetch hạn ngắn (`BUILD_GAP_REVALIDATE_S`).
- [ ] **Step 2: Chạy** `pnpm --filter @tubutree/web exec vitest run src/lib/home-initial.spec.ts` → FAIL; **Step 3:** thêm `fetchHomeCombos` vào `Promise.all` phụ (cùng kiểu `orUndefined`), lọc `endAt > Date.now()`, thêm vào danh sách "thiếu dữ liệu lúc build", trả `combos`; **Step 4:** PASS.
- [ ] **Step 5: Test đỏ `use-home-shelves.spec.tsx`**: (a) sửa ca "combo không chiếm món của Bán chạy nhất" thành chiếm: combos c1 (x, y), c2 (x, z) trên bảng `['x','y','z','w']` → combos có c1, c2, Bán chạy nhất rỗng (chỉ còn `w`, dưới 3) và `seen` có x, y, z; (b) ca có đủ món: bảng `['x','y','z','w','v','u']` → Bán chạy `['w','v','u']`, hạng `[4,5,6]`; (c) `initial.combos` có ngay ở lần vẽ đầu (không chờ request, `mocks.get` không bị gọi với `/bundles/combos`) và Bán chạy nhất đã bỏ món combo ở chính lần vẽ đầu đó; (d) `initial.combos` có combo `endAt` quá khứ + lượt vẽ đầu (chưa hydrate): vẫn có combo đó (khớp HTML), sau `flush` (đã hydrate) thì bị bỏ và hết chiếm món.
- [ ] **Step 6: Chạy** → FAIL; **Step 7: Sửa hook**: `HomeShelvesInitial.combos`, `useQuery({ ...homeCombosQuery(coreHttp), staleTime: STALE, retry: 0, ...(initial.combos ? { initialData: initial.combos } : {}) })`, `comboView(b, now, hydrated ? now : Number.NEGATIVE_INFINITY)`, `comboShelfEntry`, cập nhật chú thích (bỏ "combo không chiếm món", "chỉ tải ở trình duyệt"). `home-view.tsx`: `HomeInitial.combos` + `useHomeShelves(kind, { flash, bestSellers, combos: initial.combos })`. Web KHÔNG giữ khung chờ vì HTML đầu đã có combo; chỉ khi máy chủ hụt combo (undefined) mới tải ở client như trước, chấp nhận (ghi ở chú thích).
- [ ] **Step 8: Chạy** ba spec web + `pnpm --filter @tubutree/web exec tsc --noEmit` → PASS.
- [ ] **Step 9: Commit** `feat(web): combo Trang chủ dựng sẵn ở máy chủ, Bán chạy nhất bỏ món đã nằm trong combo`.

### Task 5: e2e — Mini chống trùng combo, CLS giữ xanh

**Files:**
- Modify: `apps/e2e/tests/bundles-cls.miniapp.spec.ts` (ca CLS của khối gộp), `apps/e2e/tests/bundles.miniapp.spec.ts` (ca "có 2 combo" thêm khẳng định món trùng), `apps/e2e/tests/support/home-merged.ts` nếu cần món Bán chạy nhất trùng combo. Mock `/home/me` không có `shippingOrders`.

- [ ] **Step 1: Test đỏ**: Trang chủ mở bằng request gộp `/home` có `combos = homeCombos()` (món NRC, XA_PHONG, BINH_SUA, TUI) và `bestSellers` chứa NRC + món khác (đủ ≥3 món sau khi bỏ trùng): kệ Bán chạy nhất không có thẻ NRC, kệ Combo có `Combo bếp xanh`, `api.callsTo('GET','/bundles/combos')` rỗng, CLS ≤ 0,02 (như ca nền).
- [ ] **Step 2: Chạy** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3347 npx playwright test tests/bundles-cls.miniapp.spec.ts tests/bundles.miniapp.spec.ts --workers=1 --reporter=line` → ca mới đỏ trước khi sửa Task 3 (nếu Task 3 đã xong thì ca chạy xanh ngay, ghi vào commit).
- [ ] **Step 3:** sửa dữ liệu/ca cũ nào đỏ vì thiết kế mới (Bán chạy nhất giờ bỏ món combo). **Step 4:** chạy lại hai spec cùng `home-p6-cls.miniapp.spec.ts` và `home-p6.miniapp.spec.ts` → PASS. **Step 5: Commit** `test(e2e): Mini Trang chủ, Bán chạy nhất bỏ món đã nằm trong combo`.

### Task 6: kiểm cuối (không commit mã)

- [ ] `gate.sh` đúng một lần (lệnh trong đề bài), nối `gate-F9.txt`.
- [ ] jest `home.service.spec.ts` (đã nằm trong gate API) xanh: khối combos không đổi.
- [ ] e2e web Trang chủ: `bash apps/e2e/scripts/web-gate.sh tests/shop.web.spec.ts` với `E2E_API_PORT=3361 E2E_WEB_PORT=3362 E2E_MINIAPP_PORT=3363`, nhất là 'Danh mục không xê dịch'; cả bộ e2e Mini (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3347 npx playwright test --workers=2 --reporter=line`).
- [ ] Chụp 375px Mini (Vite 3347) và web (Next 3348) Trang chủ có hai combo trùng món Bán chạy nhất, lưu `docs/2026-10-31-shop-redesign/screens/F9/`; tắt server của mình.
- [ ] Không có bước DB/race: gói không đổi API, schema hay đường tiền (ghi vào notes).

## Tự rà

- Phủ: §5 chống trùng combo (Task 1, 3, 4), "phần tĩnh GET /home" và "Mini qua home-feed, không thêm request" (có sẵn, Task 3 chạy lại `home-requests.spec`), web ở server (Task 4), `seen` tính combo (Task 1, 3, 4), hạng thật (Task 3, 4), hết hạn theo giờ máy chủ (Task 2, 3, 4), CLS (Task 5, 6).
- Tên nhất quán: `comboShelfEntry`, `ShelfEntry.also`, `COMBO_HOLD_MS`, `comboView(b, now, liveAt)`, `COMBO_REVALIDATE_S`, `HomeInitial.combos`, `HomeShelvesInitial.combos`.
- Quyết định lệch có chủ đích (ghi vào notes cho chủ): combo chỉ chiếm xuống dưới, không bị Giờ vàng/Mua lại loại (cùng một món có thể hiện ở Mua lại và trong combo; Giờ vàng đã được API lọc khi chọn combo); Bán chạy nhất có thể ẩn hẳn nếu combo chiếm gần hết 12 món lấy về (`HOME_BEST_SELLER_LIMIT`), chưa nâng giới hạn vì hiện chỉ 0–2 combo.

## Sửa theo review vòng 1

- MAJOR (Mua lại làm kệ combo biến mất): Mua lại tải riêng qua `/home/me` và không nằm trong khung chờ chung, nên khách cũ vẽ lần đầu với `purchased = []`, hai combo hiện; khi Mua lại về, combo chứa món đã mua bị loại, kệ biến mất, các khối dưới nhảy lên và món của combo quay về Bán chạy nhất. Sửa: `applyShelfDedupe` lọc phần tử theo `id` của chính nó (không theo `also`) nên combo không bị kệ hạng cao loại; combo vẫn chiếm `id` và mọi `also` cho kệ dưới. Quyết định lệch với §5 ở mức món: một món có thể hiện ở Mua lại và trong combo; kệ combo chỉ còn bị ẩn khi dưới 2 combo. Giờ vàng: API `homeCombos` đã bỏ bộ dính suất đang chạy. Test: `shelves.spec`, `home-shelves.spec`, hook Mini (Mua lại về sau combo, ghi số combo ở mọi lần vẽ) và hook web (HTML đầu có combo, Mua lại về sau).
- MINOR web ISR cũ: `HomeInitial.combosAt` (lúc máy chủ lấy combo) đi vào `initialDataUpdatedAt`, nên HTML ISR cũ hơn 60 giây thì hydrate hỏi lại ngay; HTML còn tươi thì không thêm request. Test: `home-initial.spec`, hook web.
- MINOR e2e "không hiện rồi biến mất": không làm được ở Playwright vì khung chờ chung của Trang chủ (dev server, tải khối lười) dài hơn hạn chờ combo, nên đặt `COMBO_HOLD_MS = 0` vẫn xanh (đã thử). Chuyển sang vitest: hook Mini ghi từng lần vẽ và khẳng định không có lần vẽ nào vừa hết chờ vừa có món của combo; đặt `COMBO_HOLD_MS = 0` làm hai ca đỏ. Tiêu đề ca e2e được sửa cho đúng điều nó đo (kệ cuối và CLS).
- MINOR web HTML đầu: thay vì Playwright (cần seed combo vào DB của `web-gate.sh`, đổi Trang chủ của mọi ca web e2e và cả `e2e.yml`), thêm ca server render thật của `HomePage` trong `app/page.spec.tsx`: hai combo trùng món, HTML có kệ Combo, Bán chạy nhất không còn món trùng và bắt đầu từ #4.
- MINOR Bán chạy nhất có thể xuống dưới 3 món khi có 3–4 combo dựng từ món bán chạy: chưa sửa, hiện chỉ 0–2 combo. Việc sau: nâng `HOME_BEST_SELLER_LIMIT` (API `home.service.ts` và `queries/home`) theo số combo hoặc chặn số món một combo được chiếm.
