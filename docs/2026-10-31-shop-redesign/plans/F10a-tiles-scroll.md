# F10a tiles-scroll: sửa bốn lỗi P1 của thẻ và hàng cuộn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa P1 số 1, 3, 4, 9 của `review/final-critique.md`: Trang chủ web 375 hết tràn ngang 24px, tên món thẻ Giờ vàng một dòng, thẻ hạng hẹp không cắt giữa số, ghi chú Giờ vàng nói con số giới hạn trước.

**Architecture:** Bốn sửa độc lập, mỗi sửa một task TDD. Số đo thẻ và chữ nằm ở `packages/app-core` (một nguồn cho Mini, web, khung chờ); hai app chỉ vẽ lại. Kiểm bố cục bằng Playwright 375px (Mini mock toàn bộ API; web qua `web-gate.sh`).

**Tech Stack:** TypeScript, React 18 (zmp-ui Mini, Next 15 web), vitest, Playwright.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q11 Giờ vàng Trang chủ có tên món, 1 dòng; Q4 meta một dòng nowrap); báo cáo nguồn `review/final-critique.md` P1 #1, #3, #4, #9.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh; worktree mới đã chạy `pnpm install --frozen-lockfile --offline`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate` (trong `apps/api`).
- Bề rộng thẻ kệ chỉ `--tile-w-sm` 128px hoặc `--tile-w-md` 148px. Thẻ lưới cùng hàng chênh đáy giá ≤ 1px. Dòng meta nowrap, cao 16px.
- Chữ giao diện đi qua `shop-copy` (khoá + trần độ dài ở `shop-copy-budget.ts`), không viết cứng trong component; thuật ngữ cấm qua `FORBIDDEN_TERMS`.
- Khung chờ Trang chủ không làm trang nhảy: đổi chiều cao khối thật thì đổi `FLASH_SKELETON_HEIGHT` (`packages/app-core/src/home-layout.ts`) theo số đo thật.
- Hai app cùng làm, cùng số đo; chunk vào Mini ≤ 700 KB (gate kiểm).
- KHÔNG sửa `home-view.tsx`, `home-shelves`, `use-home-shelves` (gói F9). Không sửa file của F10b/c/d (giỏ, PDP web, Ưu đãi/phiếu mã/Điểm danh).
- Không deploy, không push, không đọc/ghi PROD. Comment chỉ giải thích "vì sao".

## Review Focus

1. Tên món rất dài có dấu ("Ẩ", "Ổ") trong thẻ Giờ vàng: một dòng, đỉnh dấu không bị cắt, thẻ vẫn cùng chiều cao với thẻ tên ngắn. Test: e2e `tiles-scroll` đo `scrollHeight` của dòng tên ≤ 20 + chiều cao thẻ bằng nhau.
2. Món Giờ vàng nhiều phân loại (có `note`) và món không có: thân thẻ cùng chiều cao. Test: vitest `product-tile.spec` `tileBodyHeight('flash', { note: true, footer: 20 })`.
3. Thẻ thiếu sao hoặc thiếu đã bán, hoặc số bán rất lớn (≥ 100k): dòng meta compact không rỗng sai và không cắt giữa số. Test: vitest `card-meta.spec` (bảng ca) + e2e đo `scrollWidth ≤ clientWidth` trên mọi ô meta ở 320 và 375.
4. Giới hạn mua bằng 0, rác, hoặc một số ba chữ số ("Tối đa 100/khách"): ghi chú vẫn trong trần chữ, không in "Tối đa 0". Test: vitest `flash-slots.spec` + `shop-copy.spec` (ngân sách).
5. Khối cuộn chứa giá ở trang khác (Mua lại, Bán chạy, Giờ vàng, Combo): không tràn ngang sau khi `ScrollRow` đổi. Test: e2e `documentElement.scrollWidth ≤ 375` ở Trang chủ Mini và web có Giờ vàng + Bán chạy + Combo + Mua lại.

---

## File Structure

- `packages/app-core/src/commerce/tile-metrics.ts` (+ spec): thêm `nameFlash`, sửa nhánh `flash` của `tileBodyHeight`.
- `packages/app-core/src/commerce/card-meta.ts` (+ spec): thêm `cardMetaCompact`.
- `packages/app-core/src/commerce/product-card-view.ts` (+ spec): thêm trường tuỳ chọn `metaCompact`.
- `packages/app-core/src/commerce/flash-slots.ts` (+ spec), `shop-copy.ts`, `shop-copy-budget.ts`: khoá `flash.limitShort`, đổi thứ tự `slotItemNote`.
- `packages/app-core/src/home-layout.ts` (+ spec nếu có số): `FLASH_SKELETON_HEIGHT`.
- `apps/miniapp/src/components/ui/{scroll-row,product-tile,skeleton}.tsx`, `apps/miniapp/src/css/tokens.css`; web `apps/web/src/components/mini/{scroll-row,product-tile,skeleton}.tsx`, `mini.css`: phần vẽ.
- `apps/e2e/tests/tiles-scroll.miniapp.spec.ts`, `tiles-scroll.web.spec.ts` (mới): bố cục 375px.

---

### Task 1: `ScrollRow` giữ chữ ẩn trong vùng cuộn (P1 #1)

**Files:**
- Modify: `apps/miniapp/src/components/ui/scroll-row.tsx`, `apps/web/src/components/mini/scroll-row.tsx`
- Test: `apps/miniapp/src/components/ui/scroll-row.spec.tsx`, `apps/web/src/components/mini/scroll-row.spec.tsx` (mới)

**Interfaces:**
- Consumes: không.
- Produces: `ScrollRow` (cùng props) có `position: relative` ở vùng cuộn; `style` của nơi gọi vẫn thắng (đặt sau).

- [ ] **Step 1: Viết test đỏ.** Mini và web: `render(<ScrollRow label="Kệ"><i /></ScrollRow>)`, `expect(screen.getByRole('region', { name: 'Kệ' }).style.position).toBe('relative')`; thêm ca `style={{ position: 'sticky' }}` thì vùng giữ `sticky` (nơi gọi thắng).
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui/scroll-row.spec.tsx` và `pnpm --filter @tubutree/web exec vitest run src/components/mini/scroll-row.spec.tsx`; mong đợi FAIL (`position` rỗng).
- [ ] **Step 3: Sửa.** Hai `ScrollRow`: `style={{ position: 'relative', ...style }}` kèm một comment "vì sao" (chữ đọc ẩn `position:absolute` của `PriceTag` lấy khung relative bọc ngoài làm gốc nên thoát vùng cuộn, làm trang tràn ngang).
- [ ] **Step 4: Chạy xanh.** Hai lệnh trên PASS; `pnpm --filter @tubutree/miniapp exec vitest run src/components/ui` không có spec ScrollRow nào đỏ.
- [ ] **Step 5: Commit.** `fix(ui): ScrollRow giữ chữ đọc ẩn trong vùng cuộn, hết tràn ngang Trang chủ web 375`.

---

### Task 2: tên món thẻ Giờ vàng một dòng (P1 #3)

**Files:**
- Modify: `packages/app-core/src/commerce/tile-metrics.ts`, `packages/app-core/src/home-layout.ts:575`, `apps/miniapp/src/components/ui/product-tile.tsx`, `apps/web/src/components/mini/product-tile.tsx`, `apps/miniapp/src/components/ui/skeleton.tsx`, `apps/web/src/components/mini/skeleton.tsx`
- Test: `packages/app-core/src/commerce/tile-metrics.spec.ts`, `apps/miniapp/src/components/ui/product-tile.spec.tsx`, `apps/web/src/components/mini/product-tile.spec.tsx`, hai `skeleton.spec.tsx`

**Interfaces:**
- Consumes: `TILE_METRICS`, `tileBodyHeight(variant, opts)`.
- Produces: `TILE_METRICS.nameFlash: 20` (một dòng caption 20px); `tileBodyHeight('flash')` = 8 + 20 + 4 + 20 + 16 + 8 = **76** (`rail-sm` giữ 96); `FLASH_SKELETON_HEIGHT` = số đo khối Giờ vàng thật sau khi thẻ ngắn đi 20px (dự kiến 276, chốt bằng đo Mini 375px ở Task 5).

- [ ] **Step 1: Viết test đỏ.** `tile-metrics.spec`: `tileBodyHeight('flash')` là 76, `{ note: true, footer: 28 }` là 120, `rail-sm` vẫn 96. `product-tile.spec` (cả hai app): ô tên của biến thể `flash` có `style.minHeight === '20px'`, của `rail-sm` là `'40px'`. `skeleton.spec`: thân khung chờ `flash` cao `tileBodyHeight('flash')`.
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/tile-metrics.spec.ts` và hai `product-tile.spec`; mong đợi FAIL (96 so với 76).
- [ ] **Step 3: Sửa.** `tile-metrics.ts`: thêm `nameFlash` và nhánh `flash` riêng trong `tileBodyHeight`. Hai `product-tile.tsx`: biến thể `flash` đặt `WebkitLineClamp: 1` và `minHeight: TILE_METRICS.nameFlash` (các biến thể khác giữ 2 dòng). Hai `skeleton.tsx`: dải tên của `flash` cao `nameFlash`. Cập nhật comment đầu `TILE_METRICS` nói flash một dòng (Q11).
- [ ] **Step 4: Chạy xanh.** Các spec trên PASS; `pnpm --filter @tubutree/app-core exec vitest run src/home-layout.spec.ts` PASS.
- [ ] **Step 5: Commit.** `fix(ui): thẻ Giờ vàng cắt tên một dòng (Q11), cập nhật số đo thân thẻ và khung chờ`.
- [ ] **Step 6 (sau Task 5 đo thật):** đặt `FLASH_SKELETON_HEIGHT` đúng số đo, sửa `flash-sale.spec`/`offers-flash.spec` nếu chúng so số cứng, commit `fix(app-core): FLASH_SKELETON_HEIGHT theo thẻ Giờ vàng một dòng`.

---

### Task 3: dòng meta gọn cho thẻ hẹp (P1 #4)

**Files:**
- Modify: `packages/app-core/src/commerce/card-meta.ts`, `packages/app-core/src/commerce/product-card-view.ts`, hai `product-tile.tsx`, `apps/miniapp/src/css/tokens.css`, `apps/web/src/components/mini/mini.css`
- Test: `packages/app-core/src/commerce/card-meta.spec.ts`, `product-card-view.spec.ts`, hai `product-tile.spec.tsx`

**Interfaces:**
- Consumes: `soldCountText`, `formatSoldShort`, `formatRating`.
- Produces:
  - `cardMetaCompact(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null` — chỉ "Đã bán {n}" khi có lượt bán (số bán là thứ kệ hạng nói tới), không có thì "★ {sao}", không có gì thì null. Không bao giờ cắt giữa số: độ dài ≤ 14 ký tự khi `sold` < 999.950.
  - `ProductCardView.metaCompact?: string | null` (tuỳ chọn để fixture gói khác vẫn biên dịch), `productCardView` luôn điền. `meta` giữ nguyên (đầy đủ); `spoken.meta` giữ bản đọc đầy đủ.
  - Ô meta của thẻ có hai nhánh chữ: `.tubu-meta-full` và `.tubu-meta-compact`; ô meta là container (`container-type: inline-size`), thẻ đủ rộng (≥ ngưỡng đo ở Task 5) hiện bản đầy đủ, hẹp hơn hiện bản gọn. Chỉ render hai nhánh khi `metaCompact` có và khác `meta`. (Sau review: ngưỡng là 131.98px = chữ xấu nhất 127,25px + 4,7px, không phải 147.98px; chữ dài hơn `META_SHORT_MAX_CHARS` = 21 ký tự, tức lượt bán từ 100k, gắn `data-long` và đổi dưới 147.98px.)

- [ ] **Step 1: Viết test đỏ.** `card-meta.spec`: `cardMetaCompact({ ratingAvg: 4.7, sold: 8200 })` là `'Đã bán 8,2k+'`; `({ ratingAvg: 4.7 })` là `'★ 4,7'`; `({})` và `({ ratingAvg: 0, sold: 0 })` là null; với `sold` thuộc `[1, 9, 999, 1000, 8200, 99_900, 999_949]` thì độ dài ≤ 14; không bao giờ kết thúc bằng dấu phẩy hoặc `…`. `product-card-view.spec`: `metaCompact` điền cho cả 6 biến thể, `meta` vẫn `'★ 4,8 · Đã bán 1,2k+'`, `spoken.meta` vẫn đủ. `product-tile.spec` (hai app): thẻ `rank` có cả `.tubu-meta-full` ("★ 4,7 · Đã bán 8,2k+") và `.tubu-meta-compact` ("Đã bán 8,2k+"); thiếu cả sao lẫn bán thì không có nhánh nào và ô meta vẫn cao 16.
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/card-meta.spec.ts src/commerce/product-card-view.spec.ts` và hai `product-tile.spec`; mong đợi FAIL (hàm chưa có).
- [ ] **Step 3: Sửa.** `cardMetaCompact` ở `card-meta.ts` (dùng lại `formatSoldShort`/`formatRating`); `productCardView` thêm `metaCompact: cardMetaCompact(p)`. Hai `product-tile.tsx`: ô meta thêm `containerType: 'inline-size'` và hai `<span>` theo mô tả trên. CSS hai app (cạnh `.tubu-badge-short`): `.tubu-meta-compact{display:none}` và `@container (max-width: <ngưỡng>px){.tubu-meta-full{display:none}.tubu-meta-compact{display:inline}}`; `<ngưỡng>` là bề rộng thật của chữ đầy đủ xấu nhất ("★ 5,0 · Đã bán 99,9k+") đo ở Task 5 cộng 4px.
- [ ] **Step 4: Chạy xanh.** Các spec trên PASS.
- [ ] **Step 5: Commit.** `fix(ui): dòng meta gọn cho thẻ hẹp, không cắt giữa số (cardMetaCompact)`.

---

### Task 4: ghi chú Giờ vàng đặt con số giới hạn lên trước (P1 #9)

**Files:**
- Modify: `packages/app-core/src/shop-copy.ts:38`, `packages/app-core/src/shop-copy-budget.ts:28`, `packages/app-core/src/commerce/flash-slots.ts:107-110`
- Test: `packages/app-core/src/commerce/flash-slots.spec.ts:168-176`, `apps/miniapp/src/components/flash/flash-slot-item.spec.tsx:39,59,82`, `apps/web/src/components/flash/flash-slot-item.spec.tsx:38,60`

**Interfaces:**
- Consumes: `fillCopy(key, vars)`.
- Produces: khoá `flash.limitShort` = `'Tối đa {n}/khách'` (trần 16 ký tự, giá trị xấu nhất n=99 là 15); `slotItemNote(item)` trả `"Tối đa {n}/khách"` đứng TRƯỚC tên phân loại, ngăn bằng " · ". Khoá `flash.limit` ("Mỗi khách tối đa {n}") giữ nguyên cho thanh Giờ vàng ở PDP.

- [ ] **Step 1: Viết test đỏ.** `flash-slots.spec`: `slotItemNote({ variationName: undefined, perUserLimit: 5 })` là `'Tối đa 5/khách'`; `{ variationName: '500g', perUserLimit: 2 }` là `'Tối đa 2/khách · 500g'`; `perUserLimit` 0 hoặc NaN thì chỉ còn tên phân loại hoặc rỗng; `perUserLimit: 100` là `'Tối đa 100/khách'`. `flash-slot-item.spec` hai app đổi kỳ vọng sang chữ mới. `shop-copy.spec` tự kiểm khoá mới có ngân sách (cần thêm `'flash.limitShort': 16` vào budget).
- [ ] **Step 2: Chạy đỏ.** `pnpm --filter @tubutree/app-core exec vitest run src/commerce/flash-slots.spec.ts src/shop-copy.spec.ts` và hai `flash-slot-item.spec`; mong đợi FAIL.
- [ ] **Step 3: Sửa.** Thêm khoá + ngân sách; `slotItemNote` dùng `flash.limitShort` và đặt giới hạn trước.
- [ ] **Step 4: Chạy xanh.** Các spec trên PASS; `pnpm --filter @tubutree/app-core exec vitest run src/terminology.spec.ts` (hoặc spec thuật ngữ của hai app) PASS.
- [ ] **Step 5: Commit.** `fix(app-core): ghi chú Giờ vàng nói "Tối đa n/khách" trước tên phân loại`.

---

### Task 5: e2e 375px và ảnh trước/sau

**Files:**
- Create: `apps/e2e/tests/tiles-scroll.miniapp.spec.ts`, `apps/e2e/tests/tiles-scroll.web.spec.ts`
- Ảnh (gitignore): `docs/2026-10-31-shop-redesign/screens/F10a/{before,after}/{mini375,web375}/*.png`

**Interfaces:**
- Consumes: `mockDiscovery`, `homeCombos`/`mockHomeCombos`, fixture `api` (mock-api); ở web: mẫu `mockHome`/`refetchStale` của `shop.web.spec.ts`.
- Produces: các ca (cả hai app): (a) Trang chủ có Giờ vàng + Bán chạy + Combo + Mua lại: `documentElement.scrollWidth ≤ 375` (Mini thêm `.zaui-page`); (b) tên món thẻ Giờ vàng một dòng: `scrollHeight` ô tên ≤ 20, mọi thẻ cùng kệ cao bằng nhau; (c) mọi `[data-ds-part="meta"]` ở 320 và 375: chữ nhìn thấy có `scrollWidth ≤ clientWidth`; (d) Mini `/flash-sale`: dòng ghi chú bắt đầu bằng "Tối đa", con số hiện đủ. Ở web, (c) và (d) đo trên Trang chủ và `/gio-vang` (mock `GET /flash-sales/slots`).

- [ ] **Step 1: Chụp "trước".** Chạy bộ chụp tạm (không commit) trên code gốc: Mini bằng Vite 3365 + mock; web bằng `web-gate.sh` với spec mới (spec chụp ảnh `before` trước khi khẳng định, nên đỏ vẫn có ảnh).
- [ ] **Step 2: Viết spec Mini, chạy đỏ.** `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3365 npx playwright test tests/tiles-scroll.miniapp.spec.ts --workers=1 --reporter=line`; mong đợi FAIL ở (b), (c), (d) trên code gốc (đồng thời đo ngưỡng container Task 3 và `FLASH_SKELETON_HEIGHT` Task 2).
- [ ] **Step 3: Viết spec web, chạy đỏ.** `E2E_API_PORT=3366 E2E_WEB_PORT=3367 E2E_MINIAPP_PORT=3368 bash apps/e2e/scripts/web-gate.sh tests/tiles-scroll.web.spec.ts`; mong đợi FAIL ở (a) (`scrollWidth` 399) và (b), (c), (d).
- [ ] **Step 4: Sau Task 1 đến 4, chạy xanh cả hai** và chụp "sau"; lưu ảnh vào `screens/F10a/after/`.
- [ ] **Step 5: Commit** `test(e2e): 375px không tràn ngang, tên Giờ vàng một dòng, meta và ghi chú không bị cắt`.

---

### Task 6: gate và ghi nhận

- [ ] **Step 1:** Tắt server chụp ảnh của mình; chạy `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base 201046ff2 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-F10a.txt` (một lần). Bước FAIL: so với base trước khi kết luận; "có sẵn" thì ghi.
- [ ] **Step 2:** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3365 npx playwright test --workers=2 --reporter=line` (cả bộ Mini). Test cũ đỏ vì thiết kế mới thì sửa theo thiết kế và ghi vào notes.
- [ ] **Step 3:** Thêm mục "Kết quả" cuối file này (số đo trước/sau, gate, e2e, lệch kế hoạch) và commit `docs(shop): F10a ghi kết quả`.

---

## Kết quả

**Số đo trước/sau** (Chromium 375px, Inter 12px/500; ảnh ở `screens/F10a/{before,after}/{mini375,web375}`, bị gitignore):

| Lỗi | Trước | Sau |
| --- | --- | --- |
| P1 #1 Trang chủ web tràn ngang | `scrollWidth` 399 | 375 (chữ đọc ẩn của `PriceTag` nằm trong vùng cuộn: `ScrollRow` đặt `position: relative`, cả hai app) |
| P1 #3 tên món thẻ Giờ vàng | 2 dòng, thân thẻ 96px | 1 dòng (`TILE_METRICS.nameFlash` 20), thân thẻ 76px, `FLASH_SKELETON_HEIGHT` 296 → 276 (CLS test xanh) |
| P1 #4 meta thẻ hạng 128px | "★ 4,7 · Đã bán 8,…" cắt giữa số | "Đã bán 8,2k+" (`cardMetaCompact`), chữ nhìn thấy kiểm bằng e2e |
| P1 #9 ghi chú Giờ vàng 375px | "Mỗi khách tối đ…" | "Tối đa 2/khách · 500g" (`flash.limitShort`, con số đứng đầu) |

**Sửa theo review (lượt 2):**

- MAJOR ngưỡng container query. Ngưỡng 147.98px làm mất sao ở mọi thẻ rail-md (ô meta 132px) và lưới 360px (142px) dù chữ đầy đủ xấu nhất vừa. Đo thật: "★ 5,0 · Đã bán 99,9k+" (21 ký tự) 127,25px; "★ 5,0 · Đã bán 123,4k+" 132,5px; "999,9tr+" 137,1px; "999,9 tỷ+" 142,7px. Nay: ngưỡng chung 131.98px (chữ xấu nhất + 4,7px), chữ dài hơn `META_SHORT_MAX_CHARS` (21 ký tự, tức lượt bán từ 100k) gắn `data-long` và đổi bản gọn dưới 147.98px, để không có thẻ nào bị cắt giữa số. Hai app giống hệt. Kiểm đột biến: đặt lại 147.98px thì hai ca e2e 360px đỏ.
- MAJOR e2e: thêm ca 360px lưới "Gợi ý hôm nay" (Mini và web, giữ "★ ... · Đã bán ..."), ca Mini PDP "Khách thường mua cùng" 360px (kệ rail-md: ba thẻ giữ sao, hai thẻ lượt bán ≥ 100k đổi sang bản gọn, không thẻ nào bị cắt), kệ Bán chạy nhất khẳng định chữ nhìn thấy đúng "Đã bán 8,2k+", "Đã bán 99,9k+", ...
- MINOR e2e: `metaCells` đọc chữ nhìn thấy (kể cả `::after` khi bản đầy đủ bị ẩn), không lọc ô rộng 0 mà khẳng định bề rộng > 0.
- MINOR hai cách nói giới hạn mua: ghi quyết định vào `01-thiet-ke.md` §5 (danh sách dùng "Tối đa {n}/khách" vì chỗ hẹp, thanh Giờ vàng PDP giữ "Mỗi khách tối đa {n}"), kèm comment ở `shop-copy.ts`. Không đổi PDP: nằm trong vùng của gói khác và chỗ đó đủ rộng.
- Lỗi do chính gói tìm ra khi chạy `web-gate.sh`: `view.meta` có thể null (tsc của web build bắt); đã dùng `view.meta?.length ?? 0`.

**Gate** (`gate.sh --base 201046ff2`, một lần):

- PASS: shared-types, tsc-api/web/miniapp/app-core/e2e, eslint-api/miniapp/web, vitest-app-core 151 file / 2106 test, vitest-miniapp-utc 406 / 6214, vitest-web 547 / 9173, lint-parity, vite-build, bundle-mini entry 646/201 KB total 2184/851 KB (≤ 700 KB).
- FAIL hai bước, đều là lỗi hết thời gian do máy quá tải, không dính gói này: `vitest-miniapp` (`product-detail-info.spec.tsx`, ngưỡng 300ms thực đo 319ms; bản `TZ=UTC` cùng số test xanh) và `jest-api` (`gomdon-webhook.controller.spec.ts` quá 5000ms; `apps/api` không có thay đổi nào trong nhánh). Chạy riêng từng file: 11/11 xanh cả hai.
- Mini e2e cả bộ (`E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3365 --workers=2`): 340 passed, 10 skipped, 0 failed (8,2 phút).
- Web e2e `tiles-scroll.web.spec.ts` qua `web-gate.sh`: 6 passed (project Web Customer Mobile), 6 skipped (Web Customer desktop, theo thiết kế).

**Lệch kế hoạch:** ngưỡng container query và nhánh `data-long` như ở trên (kế hoạch gốc cho ngưỡng bằng chữ xấu nhất + 4px, bản đầu lấy 148px). Không chạy e2e web ngoài `tiles-scroll` (Playwright không nằm trong gate; các spec web khác không đụng file đã sửa ngoài `mini.css`, `product-tile.tsx`, `scroll-row.tsx`).
