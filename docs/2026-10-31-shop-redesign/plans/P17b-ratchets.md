# P17b `ratchets` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** phần còn lại của P17 (đợt 5a), cần số đo sau đợt 4: bánh cóc số px và lớp `max-md:` (baseline JSON chỉ được giảm), e2e `ds-parity` so computed style 375px Mini ↔ web, axe smoke 375px các màn mua sắm, mở rộng `ds-shop-guard` hai app, cập nhật `DESIGN.md` / `ds-map.json` / `terminology.spec`.

**Kiến trúc:** mọi bộ đếm là hàm thuần trong `scripts/uiux/*.mjs` (quét cây cú pháp TypeScript như `check-ds-parity.mjs`), có CLI và spec với nguồn giả để thấy đỏ. Baseline nằm một file `scripts/uiux/ds-baseline.json` (ba mục: `px`, `maxMd`, `guards`), một lệnh `node scripts/uiux/ds-ratchet.mjs --write` tái tạo cả ba để session chính khớp lại khi gộp F9/F8b. Bánh cóc px/`max-md` chạy trong `pnpm lint:parity` (gate.sh bước `lint-parity`, CI). Luật `guards` chạy trong vitest của từng app. E2E so số đo với một bảng chuẩn chung (không so trực tiếp hai project, vì CI chạy hai project song song và scope `miniapp`/`web` tách server).

**Tech stack:** Node ESM (`.mjs`) + `typescript` (gốc), vitest (node, `packages/app-core`; jsdom ở hai app), Playwright + `axe-core@4.12.0` (đã có trong lockfile, thêm làm devDependency của `@tubutree/e2e`).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` §6 mục 3 (bài kiểm chặn); mục P17 của `02-ke-hoach.md`. Nguồn: `review/design-system.md` C2 (T1, T2, T4, T9), `review/web.md` M-4, `review/a11y.md` C7. Bàn giao: `plans/handoff-wave*.md`, `plans/P17a-mechanism-docs.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm install --offline --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `cd apps/api && npx prisma generate` trước gate.
- Không sửa file của F9 (`home.service`, `home-shelves`, `use-home-shelves`, `home-view`, `home-initial`, khối combos) và F8b (bundles, `combo.service`, cart/checkout, admin bundle-form). Nếu bộ đếm tính cả file họ đổi thì chỉ đổi baseline.
- Baseline chỉ được giảm: tăng thì đỏ; giảm thì nhắc hạ baseline (CLI chạy `--strict` thì giảm cũng đỏ). File chưa có trong baseline phải bằng 0.
- Không tắt luật axe; vi phạm có sẵn ghi baseline kèm lý do; chỉ chặn `serious`/`critical`, mức WCAG AA (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`).
- E2E cổng riêng: Mini `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3351`; web `E2E_API_PORT=3352 E2E_WEB_PORT=3353 E2E_MINIAPP_PORT=3354 bash apps/e2e/scripts/web-gate.sh <spec>`. Máy thiếu RAM: chạy vitest/jest theo file, gate đầy đủ đúng một lần ở cuối. Không push, không PROD, không `git stash` trần, không kill tiến trình của người khác.
- Comment chỉ giải thích "vì sao", tiếng Việt. Commit cuối message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. File mới (chưa có trong baseline) thêm px hay `max-md:`: đỏ và nêu tên file + số đếm, không báo chung chung. Test ở T1 (bản đồ giả file mới).
2. Chuỗi `px`/`max-md:` nằm trong comment, tên biến, `0px`/`1px`, `lineHeight: 1.5`, `zIndex: 10` không bị đếm nhầm; `padding: 12`, `'-16px'`, `w-[11px]`, `max-md:px-4` thì đếm. Test ở T1 (nguồn giả "đếm đúng / bỏ qua đúng").
3. Spec/test/admin/`ds-gallery` không bị quét; baseline có đường dẫn không còn file thì nhắc xoá. Test ở T1.
4. Luật guard bắt được từng dạng vi phạm mà mã thật hiện còn (thẻ tự chế, giá gạch, primitive màu, `Text` zmp-ui, `openSnackbar`) và không bắt token ngữ nghĩa / `useNotify`. Test ở T2 (fixture cố ý vi phạm cho từng luật).
5. Thẻ/tiêu đề/giá lệch 1px giữa hai app, hoặc một bên đọc nhầm phần tử rỗng: bài `ds-parity` đỏ nói rõ phần tử, thuộc tính, giá trị chuẩn và giá trị đo; bài tự kiểm có ca ép `font-size: 17px` để thấy đỏ. Test ở T3.
6. Màn đổi (thêm nút không tên, tương phản kém) làm axe đỏ ở một trong bảy màn; vi phạm có sẵn nằm ở baseline kèm lý do, vi phạm mới ngoài baseline đỏ. Test ở T4 (hàm lọc với kết quả axe giả + ca chèn nút không tên).

---

## File Structure

| File | Việc |
|---|---|
| `scripts/uiux/ds-ratchet.mjs` + `.d.mts` | `countPx`, `countMaxMd`, `scanTree`, `compareCounts`, `readBaseline`, `writeBaseline`, CLI (`--write`, `--strict`, `--root`, `--baseline`) |
| `scripts/uiux/ds-baseline.json` | baseline `px`, `maxMd`, `guards` |
| `scripts/uiux/ds-shop-rules.mjs` + `.d.mts` | luật guard dùng chung hai app (`GUARD_RULES`, `ruleCounts`, `guardViolations`) |
| `packages/app-core/src/ds-ratchet.spec.ts` | spec hàm thuần + CLI trên cây giả + bản thật xanh; spec `ds-shop-rules` |
| `apps/miniapp/src/components/ds-shop-guard.spec.ts`, `apps/web/src/components/ds-shop-guard.spec.ts` | thêm ca dùng `ds-shop-rules` |
| `apps/e2e/tests/support/ds-parity.ts` | `PROBES`, `measure(page, side)`, `EXPECTED`, `diffMeasure` |
| `apps/e2e/tests/ds-parity.shop.spec.ts` | bài so số đo 375px, chạy ở project Mini và Web Customer Mobile |
| `apps/e2e/tests/support/axe.ts`, `apps/e2e/tests/support/a11y-baseline.ts` | `runAxe`, `blockingViolations`, baseline lý do |
| `apps/e2e/tests/a11y-shop.miniapp.spec.ts`, `apps/e2e/tests/a11y-shop.web.spec.ts` | axe smoke bảy màn |
| `apps/e2e/playwright.config.ts`, `apps/e2e/package.json`, `pnpm-lock.yaml` | testMatch cho `ds-parity`, devDependency `axe-core` |
| `package.json` | `lint:parity` chạy thêm `ds-ratchet.mjs` |
| `DESIGN.md`, `docs/design/ds-map.json`, `packages/app-core/src/{design-docs,terminology}.spec.ts` | tài liệu khớp bài kiểm mới, gỡ mục "sắp có" đã có, ROOTS thêm `packages/app-core/src` |

---

### Task 1: bánh cóc px và `max-md:` (`ds-ratchet.mjs`) + baseline + gắn `lint:parity`

**Files:**
- Create: `scripts/uiux/ds-ratchet.mjs`, `scripts/uiux/ds-ratchet.d.mts`, `scripts/uiux/ds-baseline.json`, `packages/app-core/src/ds-ratchet.spec.ts`
- Modify: `package.json` (`lint:parity`)

**Phạm vi đếm (ghi vào đầu `ds-ratchet.mjs`):** `apps/miniapp/src/**/*.{ts,tsx}` và `apps/web/src/**/*.{ts,tsx}`; bỏ `*.spec.*`, `*.test.*`, `*.d.ts`, đường dẫn có `/admin/`, `components/admin/`, `pages/admin.tsx`, `ds-gallery`, `test-utils/`, `test-support/`, `test/`, `lib/admin-`. Chỉ `.ts/.tsx` (CSS thuần là nơi định nghĩa token, không đếm). Đếm bằng cây cú pháp, không quét comment.

**Interfaces:**
- Produces:
  ```ts
  export interface Counts { px: number; maxMd: number }
  export function countPx(source: string, fileName: string): number
  // chuỗi/mẫu chuỗi có `<n>px` với n > 1 (kể cả âm, thập phân, nằm trong `[…]` Tailwind) mỗi chỗ một; thuộc tính style số (padding*, margin*, gap, rowGap, columnGap, top/right/bottom/left, inset, width/height/min*/max*, fontSize, borderRadius, flexBasis) có giá trị số |n| > 1, kể cả hai nhánh của biểu thức `a ? 8 : 12`
  export function countMaxMd(source: string, fileName: string): number   // số lần `max-md:` (đứng sau ranh giới từ) trong chuỗi/mẫu chuỗi
  export function inScope(repoRelPath: string): boolean
  export function scanTree(i: { root: string; readFile?(p: string): string }): Record<string, Counts>  // khoá = đường dẫn tương đối gốc repo; bỏ file 0/0
  export interface Baseline { px: Record<string, number>; maxMd: Record<string, number>; guards: Record<string, Record<string, Record<string, number>>> }
  export function compareCounts(i: { kind: 'px' | 'maxMd'; baseline: Record<string, number>; current: Record<string, number> }): { errors: string[]; notices: string[] }
  // tăng ở file đã có: lỗi "<file>: <kind> tăng a → b"; file chưa có trong baseline mà > 0: lỗi "file mới ... phải dùng token"; giảm: notice "hạ baseline"; baseline trỏ file không còn: notice "xoá dòng"
  export function readBaseline(file: string): Baseline
  export function writeBaseline(file: string, b: Baseline): void   // khoá sắp xếp, thụt 1 dấu cách, xuống dòng cuối
  ```
- CLI (`main()` khi chạy trực tiếp): kiểm `px` rồi `maxMd`, in `px-ratchet xanh (N chỗ ở M file)` / `max-md-ratchet xanh (...)` hoặc `lỗi: ...` ra stderr và thoát 1; notice in ra stdout kèm câu lệnh `node scripts/uiux/ds-ratchet.mjs --write`; `--strict`: notice cũng là lỗi; `--write`: quét cả cây và ghi `px`, `maxMd`, `guards` (guards lấy từ `ds-shop-rules.mjs` ở T2; lúc T1 giữ nguyên mục có sẵn hoặc `{}`); `--root <dir> --baseline <file>` đổi cây/baseline (cho spec CLI).

- [ ] **Step 1: Viết spec đỏ** `ds-ratchet.spec.ts` (import `../../../scripts/uiux/ds-ratchet.mjs`): `countPx` đếm `padding: '8px 0 4px'` = 2, `gap: 12` = 1, `margin: -16` = 1, `w-[11px]` = 1, `gap: compact ? 8 : 12` = 2; bỏ qua `0px`, `1px`, `'0.5px'`, `lineHeight: 1.5`, `zIndex: 10`, `opacity: 0.5`, `// padding: 8px`, `const px8 = 1`, `gap: 0`, `width: '100%'`, `fontSize: 'var(--type-body-size)'`. `countMaxMd`: `className="max-md:px-4 max-md:-mx-4"` = 2, `md:max-md:hidden` = 1; bỏ qua comment, `"somax-md:"`. `inScope`: đúng với `apps/web/src/app/page.tsx`, `apps/miniapp/src/pages/home.tsx`; sai với `x.spec.tsx`, `apps/web/src/app/admin/page.tsx`, `apps/web/src/components/admin/a.tsx`, `apps/miniapp/src/pages/ds-gallery.tsx`, `apps/miniapp/src/pages/admin.tsx`, `packages/app-core/src/a.ts`. `compareCounts`: tăng đỏ có tên file và số; file mới > 0 đỏ ("file mới"); giảm chỉ có notice; baseline thừa file thì notice xoá; bằng nhau thì sạch. `scanTree` trên `readFile` giả. CLI: dựng cây giả bằng `mkdtempSync` (Mini + web một file có px) và baseline đúng → status 0; thêm `padding: 24` vào một file → status 1 và stderr chứa tên file; `--write` rồi chạy lại → status 0; `--write` sau khi giảm px rồi `--strict` với baseline cũ → status 1. Ca thật: `scanTree({ root: REPO })` so với `ds-baseline.json` thật → `errors` rỗng (đỏ lúc chưa có baseline).
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/ds-ratchet.spec.ts` → FAIL (không tìm thấy module).
- [ ] **Step 3: Cài `countPx`, `countMaxMd`, `inScope`, `scanTree`, `compareCounts`, `readBaseline`, `writeBaseline`, `main`** (`ts.createSourceFile` TSX/TS như `check-ds-parity.mjs`; số px đọc bằng `/(?<![\w.])-?(\d+(?:\.\d+)?)px\b/g`) + `.d.mts`. Chạy `node scripts/uiux/ds-ratchet.mjs --write` một lần để sinh `ds-baseline.json`.
- [ ] **Step 4: Gắn** `"lint:parity": "node scripts/check-platform-parity.mjs && node scripts/check-ds-parity.mjs && node scripts/uiux/ds-ratchet.mjs"`. Chạy `pnpm lint:parity` → xanh; tạm thêm `padding: 24` vào một file giao diện trong phạm vi để thấy đỏ rồi hoàn lại (`git checkout -- <file>`).
- [ ] **Step 5: Chạy** spec ở Step 2 → PASS. Commit `feat(design): bánh cóc px và max-md (ds-ratchet) gắn vào lint:parity`.

### Task 2: mở rộng `ds-shop-guard` hai app bằng luật dùng chung có baseline

**Files:**
- Create: `scripts/uiux/ds-shop-rules.mjs`, `scripts/uiux/ds-shop-rules.d.mts`
- Modify: `scripts/uiux/ds-ratchet.mjs` (`--write` ghi `guards`), `scripts/uiux/ds-baseline.json`, `apps/miniapp/src/components/ds-shop-guard.spec.ts`, `apps/web/src/components/ds-shop-guard.spec.ts`, `packages/app-core/src/ds-ratchet.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Platform = 'miniapp' | 'web'
  export interface GuardRule { id: string; platform: Platform; scope: (relToSrc: string) => boolean; pattern: RegExp; why: string }
  export const GUARD_RULES: readonly GuardRule[]
  export function ruleCounts(i: { platform: Platform; files: { rel: string; text: string }[] }): Record<string, Record<string, number>>  // ruleId → file → số chỗ khớp (rel tính từ `src/`; bỏ comment trước khi so)
  export function guardViolations(i: { platform: Platform; files: { rel: string; text: string }[]; baseline: Record<string, Record<string, number>> }): { errors: string[]; notices: string[] }
  ```
- Luật (id → ý, phạm vi, mẫu):
  - Mini: `tile-custom` (toàn app, trừ `components/ui/`): `<ProductImage|<ProductThumb|aspectRatio: '1 / 1'`; `strike-element` (toàn app, trừ `components/ui/price-tag.tsx`): `<del\b|<s>`; `primitive-color` (phạm vi mua sắm, trừ `css/` và `components/ui/`): `var(--(forest|sage|stone|clay|honey|terracotta|orange|red|amber|blue|navy|tubu-orange)-\d+)`; `zmp-text` (phạm vi mua sắm): `import { …Text… } from 'zmp-ui'`; `open-snackbar` (phạm vi mua sắm, trừ `hooks/use-notify.ts`): `\bopenSnackbar\b|\buseSnackbar\b`.
  - Web: `tile-custom` (toàn app, trừ `components/mini/` và `components/product-card.tsx` nếu còn): `<ProductImage|<ProductThumb`; `strike-element` (trừ `components/mini/price-tag.tsx`): `<del\b|<s>`; `primitive-color` (phạm vi mua sắm, trừ `components/mini/`): lớp Tailwind `(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration|placeholder)-(stone|forest|sage|clay|honey|terracotta|orange)-\d+` và `var(--(forest|sage|stone|clay|honey|terracotta|orange)-\d+)`; `zmp-ui-import` (toàn app): `from 'zmp-ui'`; `open-snackbar` (toàn app): `\bopenSnackbar\b` (web không có snackbar: chặn mã chép nguyên từ Mini).
  - Phạm vi mua sắm (Mini, tính từ `src/`): `pages/(home|browse|product-detail|cart|checkout|offers|vouchers|flash-sale|best-sellers|campaign|brand-view|storefront-view|storefront-builder|wishlist|group-buy).tsx`, `components/(home|catalog|flash|campaign|offers|shop-page|reorder|checkout|storefront-builder|product)/`, `components/(flash-sale|storefront-[^/]+|store-page-shell|variation-sheet|catalog-grid).tsx`. Web: `app/(page.tsx|san-pham|ban-chay|gio-vang|gio-hang|thanh-toan|uu-dai|ma-giam-gia|chien-dich|brand|s|mua-chung|tai-khoan/yeu-thich)/…`, `components/(home|catalog|flash|campaign|offers|shop-page|reorder|checkout|product)/`, `components/(flash-price|add-to-cart|variation-sheet)`.
  - Baseline: `guards.<platform>.<ruleId>.<file> = n` (đường dẫn tính từ `src/`). Tăng hoặc file mới > 0: lỗi nêu `ruleId`, file, `why`; giảm: notice.

- [ ] **Step 1: Viết spec đỏ** trong `ds-ratchet.spec.ts` (khối `ds-shop-rules`): mỗi luật có một nguồn giả vi phạm (`<ProductImage src=… />` ở `pages/x.tsx`; `<del>` ; `var(--stone-100)` ở `components/home/y.tsx`; `import { Text } from 'zmp-ui'` ở `pages/cart.tsx`; `const { openSnackbar } = useSnackbar()` ở `pages/offers.tsx`; web `className="bg-stone-100"` ở `app/ban-chay/z.tsx`) → `guardViolations` có lỗi chứa `ruleId` và file; nguồn đối chứng sạch (`var(--color-bg-media)`, `useNotify`, `import { Button } from 'zmp-ui'`, comment `// <ProductImage`, `components/ui/x.tsx` dùng `var(--stone-100)`, ngoài phạm vi mua sắm `pages/profile.tsx` dùng `Text` zmp-ui) → không lỗi; baseline cho phép đúng số hiện có, hơn một chỗ thì đỏ; ít hơn thì notice. Ca thật: `ruleCounts` trên cây thật khớp `ds-baseline.json` mục `guards` (đỏ lúc chưa ghi).
- [ ] **Step 2: Chạy** `npx vitest run src/ds-ratchet.spec.ts` → FAIL.
- [ ] **Step 3: Cài `ds-shop-rules.mjs`** (bỏ comment bằng AST: thay vì quét văn bản thô, xoá phần comment trước khi so mẫu), cho `ds-ratchet.mjs --write` ghi `guards` cho cả hai app; chạy `--write`; thêm vào hai `ds-shop-guard.spec.ts` ca "luật mở rộng khớp baseline" gọi `guardViolations` trên `FILES` của chính app (đọc `../../../../scripts/uiux/ds-baseline.json`) và ca fixture cố ý vi phạm cho luật của app đó.
- [ ] **Step 4: Chạy** spec ở Step 2 và `cd apps/miniapp && npx vitest run src/components/ds-shop-guard.spec.ts`, `cd apps/web && npx vitest run src/components/ds-shop-guard.spec.ts` → PASS. Commit `test(design): ds-shop-guard hai app thêm thẻ tự chế, primitive màu, Text zmp-ui, openSnackbar có baseline`.

### Task 3: e2e `ds-parity.shop.spec.ts` (computed style 375px Mini ↔ web)

**Cách chạy (ghi lý do):** `playwright.config.ts` tách server theo scope (`miniapp` chỉ Vite, `web` cần API thật) và CI chạy hai project song song, nên so trực tiếp hai project trong một lượt không bảo đảm thứ tự. Mỗi project đo trang của mình trên cùng dữ liệu mock và so với **bảng chuẩn chung** `EXPECTED` (Mini 375 là bản gốc, DESIGN B0.4; kích thước lấy từ `TILE_METRICS`), nên hai bên bằng nhau nhờ cùng bằng bảng. Mỗi project còn ghi số đo ra `test-results/ds-parity/<project>.json` để người xem đối chiếu tay. Trang đo là trang chạy hoàn toàn bằng mock phía trình duyệt ở cả hai app (không dính dữ liệu máy chủ web): Ưu đãi (`/offers` ↔ `/uu-dai`, khối Giờ vàng: tiêu đề khối, thẻ `flash`, giá) và Giờ vàng (`/flash-sale` ↔ `/gio-vang`: thẻ `line`); Yêu thích (`/wishlist` ↔ `/tai-khoan/yeu-thich`, đăng nhập giả: thẻ `grid`).

**Files:**
- Create: `apps/e2e/tests/support/ds-parity.ts`, `apps/e2e/tests/ds-parity.shop.spec.ts`
- Modify: `apps/e2e/playwright.config.ts` (thêm `/.*ds-parity\.shop\.spec\.ts/` vào `testMatch` của project "Zalo Mini App" và "Web Customer Mobile", không thêm vào "Web Customer")

**Interfaces:**
- Produces:
  ```ts
  export type Side = 'miniapp' | 'web'
  export interface Probe { id: string; root: string; target: string; props: readonly string[] }  // root: bộ chọn vùng chứa (vd [data-testid="section-header"]); target: bộ chọn trong vùng
  export type Measure = Record<string, Record<string, string>>   // probeId → thuộc tính → giá trị computed
  export const PROBES: readonly Probe[]
  export const EXPECTED: Record<string, Record<string, string>>   // bảng chuẩn
  export function diffMeasure(expected: Measure, actual: Measure): string[]   // mỗi dòng: `<probe>.<prop>: chuẩn "<a>", đo "<b>"`; thiếu phần tử: `<probe>: không thấy phần tử`
  export function measure(page: Page, probes: readonly Probe[]): Promise<Measure>
  ```
  Thuộc tính đo: `fontSize`, `lineHeight`, `fontWeight`, `letterSpacing`, `color`, `fontFamily` cho chữ; `borderRadius`, `backgroundColor`, `paddingTop/Right/Bottom/Left`, `rowGap`, `height`, `width` cho khung. Probe: `section-title` (tiêu đề khối), `tile-<variant>` (vỏ), `tile-<variant>-name`, `tile-<variant>-price` (số giá), `tile-<variant>-compare` (giá gạch, nếu có), `tile-<variant>-body` (đệm thân), cho `flash`, `line`, `grid`.

- [ ] **Step 1: Viết spec đỏ.** `ds-parity.shop.spec.ts`: (a) ca thuần `diffMeasure` (không trình duyệt): bằng nhau → `[]`; lệch `fontSize` → một dòng chứa `section-title.fontSize`; thiếu probe → dòng "không thấy phần tử"; (b) ba ca trang (Ưu đãi, Giờ vàng, Yêu thích): `page.setViewportSize({ width: 375, height: 812 })`, dựng mock (Mini: `mockNoSession` + `mockFlash` + `mockCollectable`, `mockFlashSlots`; Yêu thích: `mockSession`; web: `localStorage tubu_web_session` cho Yêu thích), mở route theo `side` suy từ `testInfo.project.name`, `measure`, ghi `test-results/ds-parity/<project>.json`, `expect(diffMeasure(expected, actual)).toEqual([])`; (c) ca tự kiểm "bắt được lệch": sau khi đo xong, `page.addStyleTag` ép tiêu đề khối `font-size: 17px` rồi đo lại → `diffMeasure` ≠ `[]` và dòng đầu chứa `section-title.fontSize`. `EXPECTED` ban đầu để rỗng → ca (b) đỏ.
- [ ] **Step 2: Chạy** `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3351 npx playwright test tests/ds-parity.shop.spec.ts --reporter=line` → FAIL (thiếu `ds-parity.ts`, rồi `EXPECTED` rỗng).
- [ ] **Step 3: Cài `PROBES`, `measure`, `diffMeasure`** rồi chạy ở Mini để lấy số đo thật; điền `EXPECTED`: chiều cao/đệm lấy từ `TILE_METRICS` (import qua đường dẫn tương đối `../../../packages/app-core/src/commerce/tile-metrics`), chữ lấy từ số đo Mini sau khi đối chiếu `DESIGN.md` mục Token/Luật nhãn và giá (tiêu đề khối Inter 16/700 −0,01em; giá Q2 màu `--color-text-price-deal` cho giá giảm). Cấu hình `testMatch` trong `playwright.config.ts`.
- [ ] **Step 4: Chạy lại ở Mini** → PASS. Chạy web: `E2E_API_PORT=3352 E2E_WEB_PORT=3353 E2E_MINIAPP_PORT=3354 bash apps/e2e/scripts/web-gate.sh tests/ds-parity.shop.spec.ts --project='Web Customer Mobile'` → PASS; lệch thật giữa web và Mini (nếu có) thì sửa web là lỗi hồi quy của gói trước: ghi vào notes, KHÔNG nới `EXPECTED` để che. Commit `test(e2e): ds-parity so computed style 375px Mini ↔ web cho thẻ, tiêu đề khối, giá`.

### Task 4: axe smoke 375px bảy màn mua sắm

**Màn:** Trang chủ `/` ↔ `/`, Danh mục `/browse` ↔ `/san-pham`, PDP `/product/:slug` ↔ `/san-pham/:slug`, gian hàng `/s/:slug`, thương hiệu `/brand/:slug`, Ưu đãi `/offers` ↔ `/uu-dai`, Giờ vàng `/flash-sale` ↔ `/gio-vang`. Mini chạy mock đầy đủ. Web: các trang dựng phía máy chủ từ API thật (PDP, `/s`, `/brand`): `support/a11y-db.ts` (`seedShopScreens`) bật công khai nhãn Visante (có sẵn từ migration) và tạo gian hàng `ctv-pilot` trong DB tạm của web-gate.sh và của job CI (cùng hàm `writableTempDb` với waste-db), nên ở đó 404 là LỖI; chỉ khi DB không phải DB tạm mới `test.skip` kèm lý do. PDP lấy sản phẩm đầu tiên của API thật như `pdp-mobile.web.spec.ts`.

**Files:**
- Create: `apps/e2e/tests/support/axe.ts`, `apps/e2e/tests/support/a11y-baseline.ts`, `apps/e2e/tests/a11y-shop.miniapp.spec.ts`, `apps/e2e/tests/a11y-shop.web.spec.ts`
- Modify: `apps/e2e/package.json` (devDependency `axe-core`: `pnpm --filter @tubutree/e2e add -D axe-core@4.12.0 --offline`), `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  ```ts
  export const AXE_TAGS: readonly string[]            // ['wcag2a','wcag2aa','wcag21aa','wcag22aa']
  export interface AxeViolation { id: string; impact: 'minor' | 'moderate' | 'serious' | 'critical' | null; nodes: { target: string[] }[] }
  export function runAxe(page: Page): Promise<AxeViolation[]>      // nạp axe.min.js của `axe-core` qua page.addScriptTag, chạy axe.run với AXE_TAGS
  export function blockingViolations(side: 'miniapp' | 'web', screen: string, found: AxeViolation[], baseline?: readonly AxeBaselineEntry[]): string[]   // chỉ serious/critical; mỗi dòng `<màn>: <luật> (<n> nút, vd <target>)`; bỏ luật có trong baseline cho màn đó
  export interface AxeBaselineEntry { side: 'miniapp' | 'web'; screen: string; rule: string; reason: string }
  export function staleBaseline(side, screen, found, baseline?): string[]   // dòng baseline mà lần quét không còn thấy: nhắc xoá
  export const AXE_BASELINE: readonly AxeBaselineEntry[]
  ```

- [ ] **Step 1: Viết spec đỏ.** Ca thuần `blockingViolations` (không trình duyệt): `minor`/`moderate` bị bỏ qua; `serious` không có trong baseline → một dòng chứa tên màn và luật; có trong baseline → rỗng; baseline mục thiếu `reason` → ném lỗi. Mỗi màn một ca trang: `runAxe` rồi `expect(blockingViolations(...)).toEqual([])`. Ca tự kiểm: chèn `<button></button>` (không tên) vào `main` → `blockingViolations` ≠ `[]` chứa `button-name`.
- [ ] **Step 2: Chạy** `E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3351 npx playwright test tests/a11y-shop.miniapp.spec.ts --reporter=line` → FAIL (thiếu module).
- [ ] **Step 3: Cài `axe.ts`, `a11y-baseline.ts`**, thêm devDependency; chạy bảy màn Mini; vi phạm `serious`/`critical` có sẵn: đọc mã, nếu sửa được nhỏ trong file không thuộc F9/F8b thì sửa, còn lại ghi `AXE_BASELINE` kèm `reason` (không tắt luật). Viết `a11y-shop.web.spec.ts` cùng khung (project "Web Customer Mobile"; project desktop `test.skip`). Thực tế: axe bắt `color-contrast` serious ở số đếm của `Chip` (Giờ vàng, `opacity: 0.75`, tương phản 3,98): sửa ở hai app (`fontWeight: 500`), `AXE_BASELINE` để trống.
- [ ] **Step 4: Chạy** Mini → PASS; web → PASS hoặc skip có lý do. Thực tế lần đầu (máy tải ~47, không chạy `web-gate.sh`): `next dev` với API giả không DB, 3 màn PDP/gian hàng/thương hiệu bỏ qua vì 404, và ghi nhầm rằng CI có dữ liệu để đo đủ. Sửa sau review: reviewer chỉ ra DB e2e không có slug mẫu nào nên ba ca bỏ qua mãi mãi, kể cả trên CI. Nay `seedShopScreens` seed dữ liệu trước, ca 404 trên DB tạm là lỗi, và `web-gate.sh tests/a11y-shop.web.spec.ts --project="Web Customer Mobile"` chạy thật: 9 ca xanh, 0 bỏ qua (cả PDP, gian hàng, thương hiệu có đo). Danh mục web tách hub và danh sách vì kệ Bán chạy của hub do máy chủ dựng và chỉ hiện từ 3 món bán chạy; trên DB gate kệ không có thẻ nên chờ thẻ ở hub làm ca chập chờn. Commit `test(e2e): axe smoke 375px bảy màn mua sắm, chặn serious/critical`.

### Task 5: tài liệu và `terminology` ROOTS

**Files:**
- Modify: `DESIGN.md` (mục `## Kiểm tự động`), `docs/design/ds-map.json` (`upcoming`), `packages/app-core/src/terminology.spec.ts`, `packages/app-core/src/design-docs.spec.ts`

- [ ] **Step 1: Viết spec đỏ.** `design-docs.spec.ts` thêm: mục `## Kiểm tự động` nhắc `ds-ratchet`, `ds-baseline.json`, `--write`, `ds-parity`, `a11y-shop`, `ds-shop-rules`; mọi `upcoming[].name` của `ds-map.json` KHÔNG có file ở cả hai app (tên đã có ở `components` phải chuyển, `check-ds-parity` đã đỏ nếu trùng; thêm ca đối chiếu `DESIGN.md` mục "Sắp có" bằng đúng `upcoming`). `terminology.spec.ts`: `ROOTS` thêm `'packages/app-core/src'`; ca thật đòi `sources.some(s => s.file.startsWith('packages/app-core/src/'))`. Chạy `cd packages/app-core && npx vitest run src/design-docs.spec.ts src/terminology.spec.ts` → FAIL.
- [ ] **Step 2: Sửa.** `DESIGN.md`: chuyển các bài kiểm P17b từ "Do gói P17b thêm sau" sang bảng "Đã có" (bánh cóc `px`/`max-md:`: lệnh `node scripts/uiux/ds-ratchet.mjs` và `--write`; `ds-parity.shop.spec.ts`; `a11y-shop.*.spec.ts`; `ds-shop-guard` mở rộng); ghi cách hạ baseline và vì sao e2e so bảng chuẩn. `ds-map.json`: gỡ mục `upcoming` mà file đã có ở cả hai app (kiểm bằng `ls`); cập nhật mục "Sắp có" của `DESIGN.md` theo. Thực tế: `SectionCard` và `LayoutPicker` chuyển sang `components` (kèm mục Thành phần của `DESIGN.md`); `GuestLinkCard` (chỉ Mini có) và `components/bundle/*` (đường dẫn này không tồn tại, mã bundle nằm ở `components/product/` Mini và liên quan F8b/F9) giữ ở `upcoming`. `terminology.spec.ts`: chạy ca thật với ROOTS mới, vi phạm có sẵn trong `packages/app-core/src` thì vào `EXEMPT` kèm lý do thật (không sửa chữ hàng loạt); `NOT_SCANNED` không cần thêm: 18 chỗ ở 9 file app-core vào `EXEMPT` (lý do mới `LEGAL` cho `legal.ts`, còn lại dùng lại lý do đã có).
- [ ] **Step 3: Chạy** hai spec → PASS, `pnpm lint:parity` → xanh. Commit `docs(design): DESIGN.md kiểm tự động P17b, gỡ mục sắp có đã có, terminology quét packages/app-core`.

### Task 6: gate, e2e Mini, ảnh 375px

- [ ] **Step 1:** chụp 375px Mini và web hai trang đo (Ưu đãi, Giờ vàng) bằng Playwright (Vite 3351, Next dev 3353 + API giả 3352, host `localhost`), lưu `docs/2026-10-31-shop-redesign/screens/P17b/{mini,web}-<màn>.png`, so hai bản bằng mắt; tắt server của mình.
- [ ] **Step 2:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P17b --base abe9b159b --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P17b.txt` đúng một lần; bước FAIL chạy lại ở base (worktree tạm) để phân biệt "có sẵn" và "do gói".
- [ ] **Step 3:** bộ e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3351 npx playwright test --workers=2 --reporter=line`; test cũ đỏ vì hồi quy thì sửa mã, vì thiết kế đã chốt thì sửa test và ghi notes.
- [ ] **Step 4:** cập nhật `plans/P17b-ratchets.md` đúng thực tế nếu lệch (lệch ghi ở notes trả về), commit.

## Self-review

- Spec coverage: bánh cóc px + `max-md:` + baseline + lệnh tái tạo + `lint:parity` (T1); `ds-shop-guard` mở rộng năm luật, baseline chỉ giảm (T2); `ds-parity` e2e + lý do cách chạy (T3); axe smoke bảy màn, baseline có lý do (T4); DESIGN.md/ds-map/terminology (T5); ảnh, gate, e2e Mini (T6). Mỗi bài kiểm có ca cố ý vi phạm: T1 (cây giả), T2 (nguồn giả từng luật), T3 (ép 17px), T4 (nút không tên), T5 (spec đỏ trước khi sửa).
- Tên nhất quán: `countPx`, `countMaxMd`, `scanTree`, `compareCounts`, `Baseline`, `GUARD_RULES`, `ruleCounts`, `guardViolations`, `PROBES`, `EXPECTED`, `diffMeasure`, `measure`, `runAxe`, `blockingViolations`, `AXE_BASELINE` dùng một tên ở mọi task.
- Tỷ lệ: mỗi task chốt tên, luật, ca kiểm; thân hàm để người làm viết.

## Sửa sau review (vòng 1)

- **Axe web chạy thật cả bảy màn.** `support/a11y-db.ts` (`seedShopScreens`) seed nhãn Visante công khai và gian hàng `ctv-pilot` vào DB tạm của web-gate.sh và của job CI; sản phẩm có sẵn từ migration (44 sản phẩm, 8 nhãn chưa công khai), nên không tự tạo sản phẩm. Kiểm trên Postgres chỉ chạy `migrate deploy` (đúng DB của CI): chạy lặp và hai lời gọi song song đều an toàn, DB không phải DB tạm thì trả `false` và không ghi. Ca 404 trên DB tạm là lỗi; chỉ DB khác mới `test.skip` kèm lý do.
- **Luật giá gạch** dùng `<(?:del|s)(?=[\s>/])` thay `<del\b|<s>`: `<s className=...>` (dạng mã thật dùng) bị bắt, còn `<s.icon />` và chữ `<số ngày>` trong chuỗi thì không (`\b` đơn thuần bắt nhầm hai chỗ này, thấy khi chạy `--write`). Baseline thêm `subscriptions-panel.tsx` và `waste-point-picker.tsx` (web).
- **Mini Ưu đãi**: khung chờ Nhận mã không kẹt vô hạn; spec chỉ đợi tiêu đề khối Giờ vàng nên axe quét sớm. Nay đợi nút "Lưu mã" (khối đã thay khung chờ), cả hai app.
- **Để lại, ngoài phạm vi gói:** 12 file web (13 chỗ, mục `guards.web.shadow-var-color` của baseline) còn `shadow-[var(--elevation-x)]` bị Tailwind đọc là màu bóng nên phẳng ở web mà Mini có bóng: trang tài khoản, tim yêu thích, quick-add, coupon-box, mua-chung, order-mobile, storefront-owner/signup, community, bank-transfer-panel, phone-ui, gio-hang. Việc sau: đổi sang `[box-shadow:var(--x)]` rồi `node scripts/uiux/ds-ratchet.mjs --write`; `gio-hang` thuộc F8b nên đợi gộp.

## Sửa sau review (vòng 2)

- **CI không còn bỏ qua gian hàng và thương hiệu.** `seedShopScreens` chỉ đọc `process.env.DATABASE_URL`, mà job CI không export biến này cho Playwright (nó nằm trong `apps/api/.env`, `global-setup.ts` đọc vào biến cục bộ), nên `seeded = false` và hai ca `/s/ctv-pilot`, `/brand/visante` bỏ qua mãi trong khi lượt chạy vẫn xanh. Nay `seedDatabaseUrl()` rơi về `apps/api/.env` cùng thứ tự với `global-setup.ts` (`parseEnvFile` tách ra `support/env-file.ts`, dùng chung), `e2e.yml` bước Playwright cũng khai `DATABASE_URL` của DB CI, và `assertSeededOnCi` ném lỗi ở `beforeAll` khi `GITHUB_ACTIONS=true` mà không seed được. Hai bài tự kiểm (`rào seed`) đỏ nếu bỏ một trong hai. Rào ghi vẫn là `writableTempDb`.
- **Một nguồn seed.** `tour-db.ts` (`seedTourPublicData`) gọi `seedShopScreens` thay vì chép lại cùng slug/chủ/mã giới thiệu, nên tour và axe luôn thấy cùng dữ liệu và cùng một rào ghi.
- **px nối bằng `_` được đếm.** `PX_IN_TEXT` dùng `\w` làm biên nên `[padding:12px_16px]`, `shadow-[0_2px_8px_...]`, `m-[10px_auto]` đếm 0. Nay biên là chữ và số (`_` là dấu ngăn), ca kiểm thêm vào `ds-ratchet.spec.ts`, baseline px 3805 → 3812 (gio-hang, thanh-toan, account-shell, listing-layout, pdp-layout: vốn đã có, trước đó không thấy).

## Sửa sau review (vòng 3)

- **Seed bật lại các ca trước đây bị bỏ qua.** Từ khi seed ghi thật vào DB CI (vòng 2), thương hiệu `visante` và gian hàng `ctv-pilot` luôn có, nên các ca của `shop.web.spec.ts` từng `test.skip('DB e2e chưa có nhãn công khai nào')` nay chạy thật trên CI và `web-gate.sh`: Theo dõi (đăng nhập), CTV chia sẻ thương hiệu, tab Sản phẩm của thương hiệu, đầu shop, gian hàng công khai. Chúng chưa từng chạy trên CI nên mang ba lỗi mock cũ, nay đã sửa:
  - Hai ca đăng nhập thiếu `GET /me/wishlist/ids` (mock rỗng), ca tab Sản phẩm thiếu `GET /brand/public/:slug/products` (chuyển sang API thật qua fixture `request` để vẫn rẽ nhánh theo tổng sản phẩm thật của `brandWithTotal`).
  - Ca Theo dõi gọi `api.waitForCall` SAU khi bấm, nên bỏ lỡ lời gọi mà mock trả ngay (hết 10 giây dù POST đã gửi). Nay đăng ký trước khi bấm, đúng quy ước của `waitForCall`.
- **Ca không còn bỏ qua tuỳ thời điểm.** `/api/brands` có bộ nhớ đệm 60 giây trong tiến trình API (`CatalogService.brandsCache`) và SSR của web nạp nó trước khi seed, nên ngay sau seed ca tìm slug nhãn qua danh sách lúc thấy lúc không (lúc không thì lặng lẽ bỏ qua, lúc thấy thì chạy; lượt chạy đầu vòng này bỏ qua 5 ca, lượt của reviewer chạy cả). `firstPublicBrandSlug` (support/a11y-db.ts) rơi về trang công khai của nhãn đã seed (không qua bộ nhớ đệm) khi danh sách chưa có slug; có ca kiểm thuần hàm.
- **Seed ở cả hai project web.** Project `Web Customer` (máy tính) chạy trước `Web Customer Mobile` và trước đây seed chỉ chạy ở Mobile, nên các ca nhãn và gian hàng của desktop (nhánh từ lg: phân trang số, avatar bên phải bìa) bỏ qua mãi trên CI. Seed idempotent nên `beforeAll` của `a11y-shop.web.spec.ts` chạy ở cả hai.
- **Bài tự kiểm "rào seed" chạy một lần, không mở trang.** Các bài thuần hàm dùng `test` trơn của Playwright (không bật fixture mock-api cần `page`) và bỏ qua ngoài project `Web Customer Mobile`, thay vì lặp ở "Web Customer".
- **Đã chạy:** `web-gate.sh tests/a11y-shop.web.spec.ts tests/shop.web.spec.ts --project="Web Customer Mobile" --project="Web Customer" --workers=1 --retries=0` (a11y-shop trước shop.web, như CI): 0 đỏ. Rồi cả hai project web trọn bộ (`web-gate.sh --project="Web Customer" --project="Web Customer Mobile" --workers=1 --retries=0`, 470 ca): 412 xanh, 58 bỏ qua theo thiết kế (project hoặc khổ màn hình), 0 đỏ.
