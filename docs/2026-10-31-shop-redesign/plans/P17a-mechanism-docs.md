# P17a `mechanism-docs` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** phần đầu của P17 (đợt 4c): tài liệu và bài kiểm cơ chế giữ khớp mà KHÔNG cần số đo sau đợt 4: `DESIGN.md`, `docs/design/ds-map.json` + `scripts/check-ds-parity.mjs` trong `lint:parity`, `.gitignore` + skill `tubu-ui` + dòng trỏ ở `AGENTS.md` + PR template, `terminology.spec.ts`.

**Kiến trúc:** `ds-map.json` là danh sách thành phần ↔ file Mini ↔ file web ↔ màn; `check-ds-parity.mjs` là hàm thuần `checkDsParity(...)` (có spec với bản đồ giả để thấy đỏ) cộng CLI đọc bản đồ thật, nối sau `check-platform-parity.mjs`. `terminology.spec.ts` ở `packages/app-core/src` quét chuỗi chữ hiển thị (cây AST TypeScript, không quét comment, tên biến, className, đường dẫn import) của `apps/miniapp/src` và `apps/web/src` bằng `FORBIDDEN_TERMS` có sẵn ở `shop-copy.ts`; chỗ mã hiện tại đang vi phạm vào danh sách miễn có `reason` và trần `max`. `DESIGN.md` là văn bản người đọc, một spec đối chiếu với `ds-map.json` để hai thứ không lệch nhau.

**Tech stack:** Node ESM (`.mjs`) + `typescript` (đã có ở gốc), vitest (node) trong `packages/app-core`, git `check-ignore`.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật, §6 cơ chế); mục P17 phần đầu của `02-ke-hoach.md`. Nguồn: `review/design-system.md` C1–C5, `review/web.md` M-1..M-6, `review/ux-copy.md` D, `review/a11y.md` C, `review/ia-merch.md` F. Bàn giao đợt 1–4a: `plans/handoff-wave*.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`. Worktree mới: `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate` trước gate.
- Chỉ làm: DESIGN.md, ds-map + check-ds-parity gắn `lint:parity`, `.gitignore` + skill + dòng `AGENTS.md` + PR template, `terminology.spec.ts`. KHÔNG làm ratchet/baseline (`px-ratchet`, `max-md-ratchet`, `ds-baseline.json`), e2e `ds-parity`, axe smoke, mở rộng `ds-shop-guard`: đó là P17b sau khi đợt 4 vào xong.
- DESIGN.md và ds-map ghi thành phần ĐÃ có ở base `d768f7d42`. Thành phần gói song song sẽ thêm (P10, P14, P15, P16, F6) vào mục "Sắp có (đợt 4b/4c)" bằng tên đã chốt ở `02-ke-hoach.md` "Giao diện dùng chung" và mục gói; `check-ds-parity` bỏ qua mục sắp có.
- Chữ cấm lấy ở `FORBIDDEN_TERMS` (`packages/app-core/src/shop-copy.ts`, nguồn `review/ux-copy.md` D2 + §4 Q5). Mã hiện tại vi phạm thì KHÔNG sửa hàng loạt file giao diện của gói khác: đưa vào danh sách miễn có lý do, báo trong notes.
- Chỉ sửa `.gitignore` đúng một chỗ: `.claude/` → `.claude/*` + `!.claude/skills/`; `.claude/worktrees` vẫn bị bỏ qua.
- Không đụng file thuộc P10/P14/P15/P16/F6 (xem `route-map.json`, `shop-copy.ts`, `vi.ts` chỉ khi buộc, ghi notes). Không push, không PROD, không `git stash` trần. Máy thiếu RAM: chạy vitest theo file; gate đầy đủ đúng một lần ở cuối.
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó. Commit cuối message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Thành phần đổi tên hoặc xoá file ở một app: `lint:parity` đỏ và nói rõ tên + file + app nào thiếu, không báo chung chung. Test ở T1 (bản đồ giả thiếu file web, thiếu export, lệch khoá props).
2. Mục "Sắp có" không bị kiểm file, nhưng khi một tên sắp có đã xuất hiện ở `components` (gói quên chuyển mục) thì đỏ để bản đồ không giữ hai dòng một tên. Test ở T1.
3. Chữ trong comment, tên biến, `className`, `data-testid`, đường dẫn import, kiểu literal không bị coi là chữ hiển thị (không báo giả); chữ trong JSX text, chuỗi có dấu tiếng Việt, `aria-label`/`title`/`placeholder` thì bị bắt. Test ở T3 (nguồn giả đối chứng "bắt đúng / bỏ qua đúng").
4. File quản trị, spec, fixture không bị quét; `max` của dòng miễn phải bằng đúng số hit hiện có: vượt thì đỏ (không được thêm vi phạm mới vào file đã miễn), thấp hơn thì đỏ ("hạ max xuống n", hoặc "xoá dòng miễn" khi file đã sạch). Chữ JSX ngắt dòng giữa hai từ vẫn bị bắt vì chữ được gộp khoảng trắng trước khi so mẫu. Test ở T3.
5. Đổi `.gitignore` không làm lộ `.claude/worktrees` hay `settings.local.json` vào git, và skill thì vào git. Test ở T5 bằng `git check-ignore`.

---

## File Structure

| File | Việc |
|---|---|
| `scripts/check-ds-parity.mjs` + `.d.mts` | `checkDsParity`, `propKeys`, `exportsSymbol`, CLI (`--map <file>`) |
| `docs/design/ds-map.json` | `components`, `webOnly`, `upcoming` |
| `packages/app-core/src/ds-map-parity.spec.ts` | spec hàm thuần (bản đồ giả), spec CLI trên fixture vi phạm, spec bản đồ thật xanh |
| `packages/app-core/src/ds-map-fixtures/violation.json` | bản đồ cố ý vi phạm cho spec CLI |
| `package.json` | `lint:parity` chạy thêm `check-ds-parity.mjs` |
| `packages/app-core/src/terminology.spec.ts` | quét chữ hiển thị bằng `FORBIDDEN_TERMS` + danh sách miễn |
| `DESIGN.md` (gốc repo) | nguyên tắc, token, thành phần, luật kệ, nhãn, chữ, khuôn web, màn mới |
| `packages/app-core/src/design-docs.spec.ts` | DESIGN.md ↔ ds-map, `.gitignore`, skill, `AGENTS.md`, PR template |
| `.gitignore`, `.claude/skills/tubu-ui/SKILL.md`, `AGENTS.md`, `.github/pull_request_template.md` | cơ chế cho agent và người |

---

### Task 1: `check-ds-parity.mjs` (hàm thuần + CLI) với bản đồ giả

**Files:**
- Create: `scripts/check-ds-parity.mjs`, `scripts/check-ds-parity.d.mts`, `packages/app-core/src/ds-map-parity.spec.ts`, `packages/app-core/src/ds-map-fixtures/violation.json`

**Interfaces:**
- Produces:
  ```ts
  export interface DsComponent { name: string; miniapp: string; web: string; props?: string; propsDiff?: { miniOnly?: string[]; webOnly?: string[]; reason: string }; screens?: string[] }
  export interface DsMap { components: DsComponent[]; webOnly: { name: string; web: string; reason: string }[]; upcoming: { name: string; package: string; wave: string; note?: string }[] }
  export function checkDsParity(i: { map: DsMap; miniappRoutes: string[]; readFile(p: string): string | null }): { errors: string[]; warnings: string[] }  // readFile trả null khi không có file
  export function exportsSymbol(source: string, name: string): boolean   // export function/const/class/interface/type X, hoặc export { X }
  export function propKeys(source: string, typeName: string): string[] | null  // khoá `interface`/`type` ở cấp 1, null khi không khai
  ```
- Luật báo lỗi (mỗi lỗi một dòng, có tên thành phần và đường dẫn): trùng `name` trong `components`; thiếu `miniapp`/`web`; file Mini hoặc web không có; file không export `name`; có `props` mà một bên không khai; khoá props lệch nhau ngoài `propsDiff` (và `propsDiff` thiếu `reason`, hoặc khoá miễn không thật sự chỉ có ở phía đó); `screens` chứa route không có trong `miniappRoutes`; `webOnly` thiếu `reason` hoặc file/export thiếu; `upcoming` thiếu `package`/`wave` hoặc trùng tên với `components`/`webOnly`. Mục `upcoming` không kiểm file.

- [ ] **Step 1: Viết spec đỏ** `ds-map-parity.spec.ts` (import `../../../scripts/check-ds-parity.mjs`). Hàm `fs(files: Record<string,string>)` dựng `readFile`. Ca bắt buộc, mỗi ca khẳng định `errors` chứa một chuỗi con: thiếu file web (`'ProductTile'` và đường dẫn web); file web không export tên; trùng tên; khoá props lệch (`'navState'`); `propsDiff` hợp lệ thì xanh; `propsDiff` không `reason` đỏ; `propsDiff.miniOnly` ghi khoá không có thật đỏ; `screens: ['/khong-co']` đỏ; `webOnly` thiếu `reason` đỏ; `upcoming` trùng tên đỏ; `upcoming` có tên chưa có file thì **không** lỗi (Review Focus 2). Hai spec nhỏ: `exportsSymbol` (bắt `export function A`, `export const A =`, `export { A as B }`? không, chỉ `export { A }`; bỏ qua `A` chỉ nằm trong comment), `propKeys` (interface có `?`, `readonly`, hàm kiểu `onX(): void`, kiểu `type X = {...}`; null khi không khai).
- [ ] **Step 2: Chạy** `cd packages/app-core && npx vitest run src/ds-map-parity.spec.ts` → FAIL (không tìm thấy module).
- [ ] **Step 3: Cài `checkDsParity`, `exportsSymbol`, `propKeys`** trong `scripts/check-ds-parity.mjs` (`propKeys` dùng `typescript` AST như `forbidden-imports.spec.ts`; `exportsSymbol` quét AST bỏ comment) + `.d.mts` khai chữ ký trên.
- [ ] **Step 4: Thêm CLI** (`main()` khi chạy trực tiếp): đọc `--map <file>` (mặc định `docs/design/ds-map.json`) và `packages/app-core/src/route-map.json` lấy mọi `miniapp` làm `miniappRoutes`; in `lỗi: ...` ra stderr, thoát 1 nếu có lỗi, không thì in `check-ds-parity xanh (N thành phần, M sắp có)`. Thêm ca spec chạy `node scripts/check-ds-parity.mjs --map packages/app-core/src/ds-map-fixtures/violation.json` bằng `spawnSync`: `status === 1`, stderr chứa tên thành phần vi phạm. `violation.json` có một thành phần với file web không tồn tại và một `upcoming` trùng tên.
- [ ] **Step 5: Chạy** lệnh ở Step 2 → PASS. Commit `feat(design): check-ds-parity kiểm thành phần có ở cả hai app` (chỉ các file Task 1).

### Task 2: bản đồ thật `docs/design/ds-map.json` + gắn `lint:parity`

**Files:**
- Create: `docs/design/ds-map.json`
- Modify: `package.json` (`lint:parity`), `packages/app-core/src/ds-map-parity.spec.ts`

**Interfaces:**
- Consumes: `checkDsParity`, `DsMap` (Task 1).
- Produces: bản đồ có `components` = mọi thành phần `.tsx` có đủ ở `apps/miniapp/src/components/ui/` và `apps/web/src/components/mini/` (tên chính của file, `props` là interface `<Tên>Props` nếu có) + ba thành phần ở thư mục khác (`WishlistHeart`, `FlashPriceBar`, `HomeBlockError`, `BackButton`) + `ProductTileSkeleton`; `screens` = route Mini (khoá `miniapp` ở `route-map.json`) mà thành phần hiện diện qua chuỗi import (tính một lần bằng đồ thị import). `propsDiff` cho lệch có chủ đích: `ProductCard`/`ProductRail`/`ProductGrid` (`listSource` chỉ Mini = trạng thái điều hướng Mini; `priority`/`priorityCount`/`className` chỉ web = ảnh ưu tiên khi SSR), `ProductTile.navState`, `Button.type`, `ScrollRow.arrows`, `ShopHeader.inStoreGrid`, `Timeline.caption`. `webOnly` = 4 khuôn `HubLayout/ListingLayout/PdpLayout/StoreLayout` (`apps/web/src/components/layouts/`, lý do: lưới máy tính từ lg, Mini chỉ có khổ điện thoại). `upcoming` = `SectionCard` và `LayoutPicker` (P10, đợt 4b), `GuestLinkCard` (P14, đợt 4b; ghi trong `note` rằng Mini đã có thẻ cùng tên ở `components/home/guest-link-card.tsx` mời liên kết Zalo, P14 quyết dùng lại hay đặt tên khác), khối `components/bundle/*` của P15 (đợt 4c; tên thành phần chưa chốt trong kế hoạch, chỉ ghi gói).

- [ ] **Step 1: Thêm vào spec** ca "bản đồ thật xanh": đọc `docs/design/ds-map.json` + `route-map.json` + file thật bằng `fs`, `checkDsParity(...).errors` bằng `[]`; thêm ca "mọi thành phần ds-map có `screens`, trừ tiện ích không có màn" không bắt buộc (không thêm). Chạy → FAIL (chưa có file).
- [ ] **Step 2: Sinh `ds-map.json`** từ danh sách tên ở Interfaces (script dùng một lần, không đưa vào repo), rồi đọc lại bằng mắt và xoá `screens` sai hiển nhiên. Chạy lại spec → nếu đỏ vì khoá props lệch ngoài danh sách trên thì thêm `propsDiff` kèm lý do thật (đọc mã), không nới luật.
- [ ] **Step 3: `package.json`**: `"lint:parity": "node scripts/check-platform-parity.mjs && node scripts/check-ds-parity.mjs"`. Chạy `pnpm lint:parity` → xanh; tạm đổi tên một file web trong bản đồ để thấy đỏ rồi trả lại.
- [ ] **Step 4: Chạy** `npx vitest run src/ds-map-parity.spec.ts src/route-map-parity.spec.ts` → PASS. Commit `feat(design): ds-map.json thành phần Mini ↔ web và gắn vào lint:parity`.

### Task 3: `terminology.spec.ts` (FORBIDDEN_TERMS trên `apps/*/src`)

**Files:**
- Create: `packages/app-core/src/terminology.spec.ts`

**Interfaces:**
- Consumes: `FORBIDDEN_TERMS: readonly { pattern: RegExp; use: string }[]` (`./shop-copy`).
- Produces (trong spec, không export): `displayStrings(source: string, fileName: string): { line: number; text: string }[]`; `findHits(sources: { file: string; text: string }[]): { file: string; line: number; use: string; text: string }[]`; `EXEMPT: { file: string; use: string; max: number; reason: string }[]`.
- Luật `displayStrings`: JSX text không rỗng; chuỗi/mẫu chuỗi (kể cả đầu/giữa/cuối mẫu) có ít nhất một chữ cái tiếng Việt có dấu hoặc là giá trị thuộc tính `aria-label|title|alt|placeholder|label`; bỏ chuỗi ở `import`/`export ... from`, kiểu literal (`'A' | 'B'`), giá trị `className`/`id`/`key`/`href`/`data-*`. Không quét comment (AST). Loại khỏi quét: `*.spec.*`, `*.test.*`, đường dẫn có `/admin/`, `components/admin`, `test-utils`, `lib/admin-*`.

- [ ] **Step 1: Viết spec đỏ** gồm: (a) nhóm đối chứng trên nguồn giả cho `displayStrings`/`findHits`: bắt `<p>Vui lòng thử lại</p>`, `const m = 'Mất kết nối, vui lòng thử lại'`, `<img alt="Freeship" />`, `'Đang tải...'`; bỏ qua `// Vui lòng` (comment), `const voucherList = 1`, `className="tubu-voucher-card"`, `import x from './voucher-sheet'`, `type K = 'FREESHIP'`, `data-testid="voucher-row"`; (b) ca vi phạm cố ý: nguồn giả `apps/miniapp/src/pages/x.tsx` chứa `Vui lòng` → `findHits` ra đúng 1 hit với `use: 'Bạn hoặc Tubu'`, cùng nội dung ở `.../admin/y.tsx` và `x.spec.tsx` thì không ra hit; (c) ca thật: `findHits(đọc cây thật)` trừ phần miễn bằng `[]`; (d) `EXEMPT` mỗi dòng có `reason` không rỗng, file tồn tại, `use` là một `FORBIDDEN_TERMS[].use`; số hit thật của dòng miễn `<= max` (vượt thì đỏ) và `> 0` (bằng 0 thì đỏ "xoá dòng miễn"). Chạy → FAIL (chưa có `EXEMPT`, đỏ ở ca thật).
- [ ] **Step 2: Cài `displayStrings`, `findHits`** bằng AST (`ts.createSourceFile` kind TSX) như `freeship-copy.spec.ts`; đọc cây bằng `readdirSync` từ gốc repo (`fileURLToPath(import.meta.url)` + `../../..`).
- [ ] **Step 3: Chạy ca thật, lấy danh sách vi phạm hiện có**, điền `EXEMPT` gộp theo lý do dùng chung (hằng `REASON_*`: giọng "Vui lòng/chúng tôi" của câu lỗi hệ thống cũ chưa chuyển sang Bạn/Tubu; `...` thay `…`; "cửa hàng"/"giờ vàng" viết thường trong chữ cũ ngoài phạm vi đợt này; văn bản pháp lý do chủ duyệt thì nêu rõ). Mỗi dòng ghi `max` = số hit hiện có. KHÔNG sửa file giao diện.
- [ ] **Step 4: Chạy** `npx vitest run src/terminology.spec.ts src/shop-copy.spec.ts` → PASS. Ghi tổng số hit được miễn theo từng `use` cho notes. Commit `test(app-core): terminology.spec quét FORBIDDEN_TERMS trên apps/miniapp và apps/web`.

### Task 4: `DESIGN.md` + spec đối chiếu

**Files:**
- Create: `DESIGN.md`, `packages/app-core/src/design-docs.spec.ts`

**Interfaces:**
- Consumes: `docs/design/ds-map.json` (Task 2), `FORBIDDEN_TERMS` (`./shop-copy`).
- Produces: `DESIGN.md` có đúng các mục `## Nguyên tắc`, `## Token`, `## Thành phần`, `## Sắp có (đợt 4b/4c)`, `## Luật kệ`, `## Luật nhãn và giá`, `## Chữ chuẩn và thuật ngữ cấm`, `## Khuôn trang web máy tính`, `## Thêm màn mới`, `## Kiểm tự động`, `## Nhật ký quyết định`.

- [ ] **Step 1: Viết spec đỏ** `design-docs.spec.ts`: có đủ các mục `##` ở trên; mọi `components[].name` và `webOnly[].name` của `ds-map.json` xuất hiện trong mục `## Thành phần`; mọi `upcoming[].name` xuất hiện trong mục `## Sắp có (đợt 4b/4c)` và KHÔNG trong `## Thành phần`; mọi `FORBIDDEN_TERMS[].use` hiện trong mục `## Chữ chuẩn và thuật ngữ cấm`; DESIGN.md nhắc `ds-map.json`, `shelves.ts`, `shop-copy.ts`, `lint:parity`. Chạy → FAIL.
- [ ] **Step 2: Viết `DESIGN.md`** từ `01-thiet-ke.md` §4–§6 và `review/design-system.md` B0–B11, C1–C5: 5 nguyên tắc B0; token thật đang có ở `packages/design-tokens/src/tokens.css` (chỉ tên đã có, grep xác nhận); bảng "cần gì → dùng gì" theo `ds-map.json` kèm biến thể `CardVariant` và số đo `TILE_METRICS`; luật kệ (`ShelfSpec`: intent/layout/maxItems/minItems/dedupeRank/seeAllRoute, thứ tự chống trùng flash > purchased > combos > bestSellers > new > suggest, Trang chủ tối đa 4 kệ hàng, nguồn sự thật là `shelves.ts`); luật nhãn (Q4) và giá (Q2, Q3, Q1); chữ chuẩn (Q5) + bảng thuật ngữ cấm lấy từ `FORBIDDEN_TERMS`; khuôn trang web (M-1: bốn khuôn, chữ ký props thật đọc ở `apps/web/src/components/layouts/*.tsx`); các bước thêm màn mới (C5) và thành phần mới (C3 bước 6); mục "Kiểm tự động" liệt kê bài kiểm ĐÃ có (`lint:parity`, `lint:vars`, `terminology.spec`, `shelves.spec`, `shop-copy.spec`, `ds-shop-guard.spec` hai app, `contrast.spec`, `hit-target-guard`) và ghi một dòng các bài kiểm do P17b thêm sau đợt 4 (ratchet px và `max-md:`, `ds-parity` e2e, axe smoke). "Sắp có" liệt kê đúng `upcoming` của bản đồ.
- [ ] **Step 3: Chạy** `npx vitest run src/design-docs.spec.ts` → PASS. Commit `docs(design): DESIGN.md nguồn sự thật giao diện mua sắm`.

### Task 5: `.gitignore`, skill `tubu-ui`, `AGENTS.md`, PR template

**Files:**
- Modify: `.gitignore:45` (`.claude/` → `.claude/*` + `!.claude/skills/`), `AGENTS.md`, `packages/app-core/src/design-docs.spec.ts`
- Create: `.claude/skills/tubu-ui/SKILL.md`, `.github/pull_request_template.md`

**Interfaces:**
- Produces: skill có front matter `name: tubu-ui` + `description` (khi nào dùng); thân skill 8 bước theo `review/design-system.md` C3 (đọc `DESIGN.md`; tra `docs/design/ds-map.json`, không dựng thẻ/tiêu đề/nhãn/giá mới; logic ở `packages/app-core/src/commerce`; làm Mini 375px trước rồi web cùng props; chỉ token semantic; thành phần mới thì thêm vào cả hai app + `ds-map.json` + `/ds-gallery` + `DESIGN.md` + spec; lệnh kiểm ĐÃ có; chụp 375px Mini ↔ web bằng `VISUAL_DIR=… visual-tour`). `AGENTS.md` thêm mục `## Giao diện` một dòng trỏ `.claude/skills/tubu-ui/SKILL.md` + `DESIGN.md` + câu D5 (chữ gian hàng chỉ thêm vào `shop-copy.ts`; chạy `terminology.spec`). PR template có mục `## Giao diện` theo C4, chỉ gồm bài kiểm đã có.

- [ ] **Step 1: Thêm vào spec** (`design-docs.spec.ts`): `git check-ignore -q` (qua `spawnSync('git', ['check-ignore', '-q', path], { cwd: gốc repo })`, status 0 = bị bỏ qua) với `.claude/worktrees/x/y.ts` và `.claude/settings.local.json` → bị bỏ qua; `.claude/skills/tubu-ui/SKILL.md` → KHÔNG bị bỏ qua (status 1); SKILL.md có `name: tubu-ui` và nhắc `DESIGN.md`, `ds-map.json`, `pnpm lint:parity`; `AGENTS.md` nhắc `.claude/skills/tubu-ui/SKILL.md` và `DESIGN.md`; PR template có `## Giao diện` và `ds-map.json`. Chạy → FAIL.
- [ ] **Step 2: Sửa `.gitignore`, viết skill, sửa `AGENTS.md`, tạo PR template** (lệnh trong skill và template chỉ là lệnh có thật, chạy thử từng lệnh trước khi ghi).
- [ ] **Step 3: Chạy** `npx vitest run src/design-docs.spec.ts` → PASS; `git status --short` thấy `.claude/skills/tubu-ui/SKILL.md` ở dạng chưa theo dõi (không cần `git add -f`). Commit `chore(agents): skill tubu-ui, mở .claude/skills trong .gitignore, PR template mục Giao diện`.

### Task 6: gate và đóng gói

- [ ] **Step 1:** `pnpm lint:parity` xanh; vitest `packages/app-core` chạy cả thư mục một lần (`npx vitest run`) để chắc không spec nào hỏng vì `lint:parity` mới.
- [ ] **Step 2:** `pnpm --filter @tubutree/shared-types build` và `cd apps/api && npx prisma generate`, rồi chạy gate đúng một lần từ worktree: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base d768f7d42 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P17a.txt`. Bước FAIL: chạy lại bước đó ở base (worktree tạm) để phân biệt "có sẵn" và "do gói".
- [ ] **Step 3:** ghi `plans/P17a-mechanism-docs.md` đã đúng thực tế (lệch kế hoạch ghi ở notes trả về, không sửa kế hoạch cho khớp), commit nếu có đổi.

## Self-review

- Spec coverage: DESIGN.md (T4), ds-map + check-ds-parity + `lint:parity` + fixture đỏ (T1, T2), `.gitignore` + skill + AGENTS.md + PR template (T5), terminology.spec + ca vi phạm cố ý (T3), mục "Sắp có" bỏ qua khi kiểm (T1, T2, T4). Phần P17b không có task.
- Tên nhất quán: `checkDsParity`, `propKeys`, `exportsSymbol`, `DsMap`, `EXEMPT`, `displayStrings`, `findHits` dùng cùng một tên ở mọi task.
- Tỷ lệ: mỗi task chỉ chốt tên, luật, ca kiểm; thân hàm để người làm viết.
