# P1 `tokens-a11y`: token commerce + a11y nền — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm lớp token commerce (màu giá deal, nền ảnh, phiếu, đếm ngược, bề rộng thẻ, nhịp chuyển động) và sửa a11y nền của Mini App (focus, scroll-padding, BottomSheet là hộp thoại, vùng thông báo đọc được, phản hồi nhấn, thanh dưới) để gói P2–P17 chỉ việc dùng.

**Architecture:** Token mới nằm ở `packages/design-tokens/src/tokens.css` (một nguồn, cả Mini App và web đọc); web thêm lớp Tailwind ngữ nghĩa trong `tailwind-preset.ts`. Sửa a11y ở `apps/miniapp/src/css/tokens.css` + component DS, bản web (`apps/web/src/components/mini/`, `mini.css`, `globals.css`) giữ cùng số đo. Mọi quy tắc CSS có spec đọc file thật.

**Tech Stack:** CSS custom properties, React 18 + zmp-ui (Mini App), Next 15 + Tailwind (web), vitest + @testing-library.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật), `docs/2026-10-31-shop-redesign/02-ke-hoach.md` mục P1. Nguồn chi tiết: `review/design-system.md` B1, DS-06..DS-12; `review/a11y.md` P1 A2/A3/A4/A7; `review/polish.md` PL-04, PL-05, PL-10, PL-11 (PL-09 không áp: kệ "Sắp diễn ra" bị bỏ ở Trang chủ).

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh.
- Giá giảm màu `--color-text-price-deal` (= `--orange-700 #9A5200`); giá thường đen; không dùng đỏ.
- Vùng chạm ≥44px, tương phản ≥4,5:1 cho chữ, axe 0 vi phạm ở 375px trên màn đụng tới.
- Bề rộng thẻ kệ chỉ `--tile-w-sm` 128px hoặc `--tile-w-md` 148px.
- Chunk vào Mini App ≤700 KB (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`); ghi số trước/sau nếu entry đổi.
- Chữ giao diện tiếng Việt, không dùng "Top", "Freeship", "Kho voucher", "Nhãn hàng".
- Comment chỉ giải thích "vì sao" không hiển nhiên, theo mật độ file xung quanh (tiếng Việt).
- Không deploy, không đọc/ghi PROD, không `git stash` trần, không push.
- Không sửa file thuộc gói song song: P2 (`packages/app-core/src/commerce/**`, `merch/**`, `shop-copy.ts`, `coupon-card.tsx`, `utils/format.ts`, web `lib/api.ts`, `lib/pdp-logic.ts`), P3a, P3b (api, prisma, `app-core/src/api/*`).

## Review Focus

1. BottomSheet `dismissible=false` không được đóng bằng Esc; hai sheet chồng nhau thì chỉ sheet trên cùng nhận Esc/Tab. Test ở Task 8.
2. Cùng một câu thông báo hai lần liên tiếp vẫn được đọc lại (vùng `role=status` xoá rồi ghi lại); câu chỉ có emoji hoặc rỗng không làm vùng đọc ra gì nhưng snackbar vẫn hiện, không ném lỗi. Test ở Task 9.
3. Khách bật giảm chuyển động: icon thanh dưới, nhấn nút/thẻ không còn chuyển động dài (quy tắc `prefers-reduced-motion` phủ lớp mới). Test ở Task 6, 7.
4. Chip một ký tự ("5") hoặc có `count` vẫn có vùng chạm 44×44 sau khi hạ chiều cao nhìn xuống 36. Test ở Task 3.
5. Biến CSS gõ sai/chưa định nghĩa (token mới, `var(--x)` ở component web) hoặc hex trong preset Tailwind lệch `tokens.css`. Test ở Task 1, 2.

---

## File Structure

| File | Việc |
|---|---|
| `packages/design-tokens/src/tokens.css` | token mới (Task 1) |
| `packages/design-tokens/src/tokens.spec.ts`, `tailwind-preset.ts`, `tailwind-preset.spec.ts` | spec token, lớp Tailwind ngữ nghĩa, so hex preset ↔ tokens.css |
| `packages/design-tokens/package.json`, `.github/workflows/ci.yml` | script `test`, bước `lint:vars` (Task 2) |
| `apps/miniapp/src/css/contrast.spec.ts` | cặp màu mới (Task 1) |
| `apps/miniapp/src/css/tokens.css`, `apps/web/src/components/mini/mini.css`, `apps/web/src/app/globals.css` | focus, scroll-padding, nhấn, keyframe tab (Task 5–7) |
| `apps/{miniapp/src/components/ui,web/src/components/mini}/{badge,chip,icon}.tsx` | Task 3, 7 |
| `apps/miniapp/src/components/ui/bottom-sheet.tsx`, `text.tsx` | Task 8 |
| `apps/miniapp/src/hooks/use-notify.ts`, `components/notify-region.tsx`, `components/app.tsx` | Task 9 |
| `apps/miniapp/src/utils/press-feedback.ts` | Task 6 |

---

### Task 1: Token commerce + cặp tương phản

**Files:**
- Modify: `packages/design-tokens/src/tokens.css`, `packages/design-tokens/src/tailwind-preset.ts`
- Test: `packages/design-tokens/src/tokens.spec.ts`, `packages/design-tokens/src/tailwind-preset.spec.ts`, `apps/miniapp/src/css/contrast.spec.ts`

**Interfaces:**
- Produces (gói sau dùng đúng tên): lớp 1 `--orange-700: #9A5200`. Lớp 2: `--color-text-price-deal: var(--orange-700)`; `--color-flash-fg: var(--orange-700)` (đổi từ orange-800); `--color-bg-media: var(--stone-100)`, `--color-bg-cover: var(--forest-700)`, `--color-bg-chip: var(--stone-100)`, `--color-track: var(--stone-200)`, `--color-media-outline: rgba(28,26,22,.06)`; `--color-verified-bg: var(--forest-600)`, `--color-verified-fg: var(--stone-0)`; voucher giảm giá `--color-voucher-bg: var(--orange-50)`, `-fg: var(--orange-800)`, `-edge: var(--tubu-orange)`, `-stub-bg: var(--tubu-orange)`, `-stub-fg: var(--stone-900)`; freeship `--color-voucher-ship-bg: var(--color-status-success-fg)`, `-ship-fg: var(--stone-0)`; của shop `--color-voucher-shop-bg: var(--forest-50)`, `-shop-fg: var(--forest-700)`, `-shop-edge: var(--forest-300)`, `-shop-stub-bg: var(--forest-600)`, `-shop-stub-fg: var(--stone-0)`; hạng `--color-rank-1-bg: var(--honey-600)`, `-rank-2-bg: var(--stone-600)`, `-rank-3-bg: var(--clay-600)`, `-rank-fg: var(--stone-0)`, `-rank-n-bg: var(--stone-100)`, `-rank-n-fg: var(--stone-700)`; `--color-countdown-bg: var(--color-bg-inverse)`, `--color-countdown-fg: var(--color-text-inverse)`.
- Lớp 3 (commerce): `--tile-w-sm: 128px`, `--tile-w-md: 148px`, `--tile-gap: var(--p-space-4)`, `--tile-inset: var(--p-space-3)`, `--rail-pad-block: var(--p-space-2) var(--p-space-4)`, `--section-header-h: 44px`, `--space-block: var(--p-space-5)` (`--space-section` đã có = 24px, giữ), `--banner-ratio: 5 / 2`, `--badge-h-sm: 20px`, `--badge-h-md: 24px`, `--radius-tag: var(--p-radius-1)`, `--type-price-tile-size: 16px; --type-price-tile-lh: 1.25; --type-price-tile-weight: 700`.
- Chuyển động/bóng: `--elevation-nav: 0 -1px 0 rgba(28,26,22,.06), 0 -4px 16px rgba(28,26,22,.06)`, `--p-dur-press: 80ms`, `--p-dur-release: 180ms`, `--p-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Preset Tailwind: `orange[700] = '#9A5200'`; màu ngữ nghĩa `media`, `chip`, `track`, `shop-cover`, `countdown` (nền) và `price-deal` (chữ) trỏ `var(--color-*)`, `voucher.{bg,fg,edge,'stub-bg','stub-fg','ship-bg','ship-fg'}`, `rank.{1,2,3,n}`. Không đặt tên `cover` (đụng `bg-cover` của Tailwind).

- [ ] **Step 1: Viết test đỏ.** Trong `tokens.spec.ts` thêm khối "commerce tokens": mỗi token ở danh sách Interfaces có mặt đúng giá trị (regex `--name:\s*value`); `--color-flash-fg` trỏ `var(--orange-700)`; `--color-text-price-deal` resolve ra `#9A5200`. Trong `tailwind-preset.spec.ts` thêm: (a) mọi hex trong `colors` của preset bằng hex của primitive cùng tên trong `tokens.css` (`forest-600` ↔ `--forest-600`; ngoại lệ ghi rõ: `orange.500` ↔ `--tubu-orange`, `tubu-orange` ↔ `--tubu-orange`); (b) mọi `var(--x)` trong preset có định nghĩa trong `tokens.css`; (c) preset không có key `cover`. Trong `apps/miniapp/src/css/contrast.spec.ts` thêm khối "cặp màu commerce" dùng `tokenRgb` + `ratio`: `--color-text-price-deal` trên `--color-bg-surface`, `--color-promo-bg` (orange-50), `--color-bg-canvas` ≥ 4,5; `--color-flash-solid-fg` trên `--color-flash-solid-bg` ≥ 4,5; `--color-countdown-fg` trên `--color-countdown-bg` ≥ 4,5; `--color-voucher-stub-fg`/`-stub-bg`, `--color-voucher-ship-fg`/`-ship-bg`, `--color-voucher-shop-stub-fg`/`-shop-stub-bg`, `--color-voucher-fg`/`-bg`, `--color-voucher-shop-fg`/`-shop-bg` ≥ 4,5; `--color-rank-fg` trên rank-1/2/3-bg và `--color-rank-n-fg` trên `--color-rank-n-bg` ≥ 4,5; `--color-verified-fg` trên `--color-verified-bg` ≥ 4,5.
- [ ] **Step 2: Chạy, thấy đỏ.** `cd packages/design-tokens && npx vitest run` và `cd apps/miniapp && npx vitest run src/css/contrast.spec.ts` → FAIL (thiếu token).
- [ ] **Step 3: Thêm token vào `tokens.css`** theo Interfaces (lớp 1 cạnh `--orange-800`; lớp 2/3 ở cuối khối semantic; có một dòng comment "vì sao" cho `--orange-700`: 5,86:1 trên trắng, `#B05E00` không đạt 4,5) và thêm `orange[700]` + màu ngữ nghĩa vào `tailwind-preset.ts`.
- [ ] **Step 4: Chạy lại hai lệnh trên** → PASS. Nếu một cặp hụt 4,5 thì dùng token tối hơn cùng họ và ghi vào PROGRESS (không hạ ngưỡng).
- [ ] **Step 5: Commit** `feat(design-tokens): token commerce, orange-700 cho giá deal, lớp Tailwind ngữ nghĩa`

---

### Task 2: Cổng CI cho token (`test`, `lint:vars`)

**Files:**
- Modify: `packages/design-tokens/package.json` (thêm `"test": "vitest run"`), `.github/workflows/ci.yml` (bước `pnpm lint:vars` sau bước `lint:parity`), `apps/miniapp/src/components/waste-item-thumb.tsx:25`
- Test: các lệnh dưới

**Interfaces:** Produces: `pnpm --filter @tubutree/design-tokens test` chạy 3+ spec; `pnpm lint:vars` thoát 0 (hiện đỏ vì `waste-item-thumb.tsx:25` dùng `--color-brand-fg` chưa định nghĩa).

- [ ] **Step 1: Thấy đỏ.** `pnpm --filter @tubutree/design-tokens test` → lỗi thiếu script; `pnpm lint:vars` → exit 1 (1 biến chưa định nghĩa).
- [ ] **Step 2: Thêm script `test`**; đổi `color: 'var(--color-brand-fg, var(--forest-600))'` thành `var(--color-text-brand)` (cùng forest-600); thêm bước CI `- name: Undefined CSS vars` / `run: pnpm lint:vars`.
- [ ] **Step 3: Xanh.** `pnpm --filter @tubutree/design-tokens test` PASS; `pnpm lint:vars` exit 0; `pnpm turbo run test --filter=@tubutree/design-tokens` PASS; `cd apps/miniapp && npx vitest run src/components/waste-item-thumb` PASS.
- [ ] **Step 4: Commit** `ci(design-tokens): chạy test token trong turbo, thêm lint:vars vào CI`

---

### Task 3: Badge và Chip (Mini + web)

**Files:**
- Modify: `apps/miniapp/src/components/ui/{badge,chip}.tsx`, `apps/web/src/components/mini/{badge,chip}.tsx`
- Test: `apps/miniapp/src/components/ui/{badge,chip}.spec.tsx`, web: thêm ca vào `apps/web/src/components/mini/surfaces.spec.tsx` (mount Badge/Chip)

**Interfaces:**
- Produces: `BadgeTone` thêm `'flash' | 'verified'` (`flash` = `--color-flash-solid-bg/fg`, `verified` = `--color-verified-bg/fg`); Badge mọi cỡ `fontSize: var(--type-label-size)` + `fontWeight 600` (sm chỉ khác đệm 2px 6px); Chip `md`: `minHeight 36`, `padding '7px 14px'`, chưa chọn `background var(--color-bg-surface)` + `boxShadow 'inset 0 0 0 1px var(--color-border-subtle)'`, đã chọn nền `--color-action-primary-bg` không bóng, `fontWeight 600` cả hai trạng thái; Chip `sm` giữ cỡ cũ, chỉ đổi `var(--stone-100)` thành `var(--color-bg-chip)`. Giữ `tubu-hit-44`, `minWidth 44`, `flexShrink 0`.

- [ ] **Step 1: Viết test đỏ.** badge: `size="sm"` có `style.fontSize === 'var(--type-label-size)'`; `tone="flash"` nền/chữ đúng token; `tone="verified"` đúng token. chip: md `minHeight '36px'`, chưa chọn `background var(--color-bg-surface)` và `boxShadow` chứa `--color-border-subtle`, `fontWeight '600'` ở cả `selected` và không; chip một ký tự `size md` vẫn `className` chứa `tubu-hit-44` và `minWidth '44px'` (Review Focus 4); sửa hai ca cũ đang khẳng định `minHeight 44` / `var(--stone-100)` sang giá trị mới. Làm cùng bộ ca cho bản web.
- [ ] **Step 2: Chạy đỏ.** `cd apps/miniapp && npx vitest run src/components/ui/badge.spec.tsx src/components/ui/chip.spec.tsx`; `cd apps/web && npx vitest run src/components/mini/surfaces.spec.tsx`.
- [ ] **Step 3: Cài đặt** theo Interfaces ở cả hai app; cập nhật chú thích đầu `Chip` ("nhìn cao 36px" nay đúng thật).
- [ ] **Step 4: Xanh** các lệnh trên + `npx vitest run src/components/ui/hit-target-guard.spec.tsx src/a11y-click-targets.spec.ts` (miniapp).
- [ ] **Step 5: Commit** `feat(ui): Badge 12/600 + tông flash/verified, Chip md cao 36 nền surface viền trong`

---

### Task 4: Thay primitive màu bằng token ngữ nghĩa (DS-08)

**Files:**
- Modify: `components/ui/product-tile.tsx:114`, `components/flash-sale.tsx:154,215`, `components/catalog/recently-viewed-rail.tsx:80` (`--stone-100` → `--color-bg-media`); `components/ui/progress-bar.tsx:24` (`--stone-200` → `--color-track`); `components/store-page-shell.tsx:27`, `components/storefront-preview.tsx:18` (`--forest-700` → `--color-bg-cover`); `pages/product-detail.tsx:526` (`--clay-700` lời "còn ít hàng" → `--color-text-warning`) và `:648-657` (chip mã: nền `--color-voucher-bg`, viền đứt `--color-voucher-edge`, chữ `--color-voucher-fg`); `pages/storefront-builder.tsx:361` (gradient bìa → `--color-bg-subtle` … `--color-action-secondary-bg-pressed`) và `:382` (`--stone-200` avatar → `--color-bg-media`). Tất cả dưới `apps/miniapp/src/`.
- Không sửa `components/loyalty/coupon-card.tsx:29` (thuộc P2): ghi vào notes.
- Test: Create `apps/miniapp/src/ds-primitive-refs.spec.ts`

**Interfaces:** Consumes: token Task 1. Produces: spec `ds-primitive-refs` quét danh sách file trên (kèm `components/ui/chip.tsx`) và khẳng định không còn `var(--(stone|forest|sage|clay|honey|terracotta|orange)-\d+)`.

- [ ] **Step 1: Viết test đỏ** `ds-primitive-refs.spec.ts` (đọc từng file, bỏ comment, expect mảng vi phạm `[]`, kèm một ca fixture chuỗi `var(--stone-100)` để chứng minh regex bắt được).
- [ ] **Step 2: Chạy đỏ:** `cd apps/miniapp && npx vitest run src/ds-primitive-refs.spec.ts`.
- [ ] **Step 3: Đổi các chỗ trên.** Giữ nguyên mọi style khác.
- [ ] **Step 4: Xanh:** spec mới + `npx vitest run src/components/ui src/pages/product-detail src/pages/storefront-builder src/components/catalog src/components/flash-sale` + `pnpm lint:vars`.
- [ ] **Step 5: Commit** `refactor(miniapp): thay primitive màu bằng token ngữ nghĩa ở thẻ, bìa, phiếu, thanh tiến độ`

---

### Task 5: Vòng focus + scroll-padding (a11y A4, A7)

**Files:**
- Modify: `apps/miniapp/src/css/tokens.css`, `apps/web/src/app/globals.css` (web đã có `:focus-visible` chung và `.zaui-btn:focus-visible` ở `mini.css:342`, chỉ thiếu scroll-padding)
- Test: Create `apps/miniapp/src/css/focus-scroll.spec.ts`, `apps/web/src/app/scroll-padding.spec.ts`

**Interfaces:** Produces (Mini): `.zaui-btn:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:2px}`; quy tắc chung `:focus-visible{outline:2px solid var(--color-border-focus);outline-offset:2px}` đặt TRƯỚC `.tubu-tile-link:focus-visible{outline:none}` (đặc hiệu cao hơn nên thẻ giữ vòng riêng); `.zaui-page{scroll-padding-top:calc(var(--safe-top) + 64px);scroll-padding-bottom:calc(72px + var(--safe-bottom))}`; lớp `.tubu-scroll-pad-sticky-bar{scroll-padding-bottom:calc(96px + var(--safe-bottom))}` cho trang có StickyActionBar. (Web): `html{scroll-padding-top:calc(var(--header-h) + 64px);scroll-padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}` dưới 768px; từ md `scroll-padding-top:calc(var(--header-h) + 16px);scroll-padding-bottom:16px`.

- [ ] **Step 1: Viết test đỏ.** Nạp CSS thật vào jsdom (mẫu `hit-44-css.spec.tsx`: `<style>` + `sheet.cssRules`) và khẳng định từng quy tắc ở Interfaces; riêng web đọc `globals.css` bằng regex cho `scroll-padding-top` và `scroll-padding-bottom` trên `html`.
- [ ] **Step 2: Chạy đỏ** (`npx vitest run src/css/focus-scroll.spec.ts` / `src/app/scroll-padding.spec.ts`).
- [ ] **Step 3: Thêm CSS** theo Interfaces (comment ngắn: ZaUI đặt `.zaui-btn:focus{outline:0}` nên phải ghi đè; thanh dính che phần tử đang focus, WCAG 2.4.11).
- [ ] **Step 4: Xanh** hai spec + `npx vitest run src/css` (miniapp).
- [ ] **Step 5: Commit** `fix(a11y): vòng focus cho nút DS và scroll-padding cho thanh dính`

---

### Task 6: Phản hồi nhấn nút/thẻ (PL-11)

**Files:**
- Modify: `apps/miniapp/src/css/tokens.css` (`.tubu-press`, thêm `.tubu-press-card`, `.tubu-btn:active`), `apps/web/src/components/mini/mini.css` (cùng quy tắc), `apps/miniapp/src/components/app.tsx` (một `useEffect`)
- Create: `apps/miniapp/src/utils/press-feedback.ts`
- Test: Create `apps/miniapp/src/css/press-css.spec.ts`, `apps/miniapp/src/utils/press-feedback.spec.ts`; web thêm ca vào `apps/web/src/components/mini/css.spec.ts`

**Interfaces:**
- Produces CSS: `.tubu-press{transition:transform var(--p-dur-release) var(--p-ease-out);cursor:pointer;-webkit-tap-highlight-color:transparent}`, `.tubu-press:active{transform:scale(0.96);transition-duration:var(--p-dur-press)}`, `.tubu-press-card` cùng nhịp với `scale(0.985)`, `.tubu-btn:active{transform:scale(0.97);transition-duration:var(--p-dur-press)}`. Không có `opacity` trong bất kỳ `:active` nào. Quy tắc `prefers-reduced-motion` hiện có (đưa `transition-duration` về 0,01ms) phải phủ cả `.tubu-press-card` và `.tubu-btn` ở web (Mini đã dùng `*`).
- Produces TS: `export function installPressFeedback(doc?: Document): () => void` — gắn đúng một `touchstart` listener `{ passive: true }` lên `document` (iOS WebKit chỉ áp `:active` khi có listener), gọi lại không gắn thêm, trả hàm gỡ; `typeof document === 'undefined'` thì không làm gì.

- [ ] **Step 1: Viết test đỏ.** CSSOM: `.tubu-press:active` có `transform: scale(0.96)` và không có `opacity`; `.tubu-press-card:active` `scale(0.985)`; `.tubu-btn:active` `scale(0.97)`; không `:active` nào chứa `opacity`. `press-feedback.spec.ts`: spy `document.addEventListener` → gọi hai lần chỉ gắn một lần với `{ passive: true }`; hàm gỡ gọi `removeEventListener`. Web `css.spec.ts`: `mini.css` có `.tubu-press-card`, `.tubu-btn:active` và `:active` không có `opacity`.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Cài đặt** CSS ở hai app, tạo `press-feedback.ts`, gọi `useEffect(() => installPressFeedback(), [])` trong `MyApp` (`app.tsx`). Thêm alias `--dur-press: var(--p-dur-press)`, `--dur-release: var(--p-dur-release)`, `--ease-spring: var(--p-ease-spring)` ở khối `:root` của `css/tokens.css` và `mini.css`.
- [ ] **Step 4: Xanh:** các spec trên + `npx vitest run src/pages/checkout.spec.tsx` (miniapp, ca `.tubu-press`) + `npx vitest run src/components/mini src/app/tai-khoan/hub-mini.spec.tsx` (web).
- [ ] **Step 5: Commit** `feat(ui): phản hồi nhấn nút co 0,96 / thẻ co 0,985, bỏ đổi opacity, listener touchstart cho iOS`

---

### Task 7: Thanh dưới + `Icon filled` (PL-10)

**Files:**
- Modify: `apps/miniapp/src/components/ui/icon.tsx`, `apps/web/src/components/mini/icon.tsx` (prop `filled?: boolean`: `fill="currentColor"`, `fillOpacity={0.16}`, `strokeWidth={2}`; mặc định như cũ), `apps/miniapp/src/components/bottom-nav.tsx`, `apps/web/src/components/bottom-nav.tsx`, `apps/web/tailwind.config.ts` (`boxShadow.nav: 'var(--elevation-nav)'`, `fontSize.label: ['var(--type-label-size)', { lineHeight: 'var(--type-label-lh)' }]`), `css/tokens.css` + `mini.css` (keyframes `tubu-tab-pop` 0%{scale(.88)} 100%{scale(1)}, lớp `.tubu-tab-pop{animation:tubu-tab-pop 220ms var(--p-ease-spring) both}`; web thêm `.tubu-tab-pop` vào khối reduced-motion)
- Test: `apps/miniapp/src/components/ui/icon.spec.tsx`, `apps/miniapp/src/components/bottom-nav.spec.tsx`, `apps/web/src/components/bottom-nav.spec.tsx`, `apps/web/src/components/mini/css.spec.ts`, `apps/miniapp/src/css/press-css.spec.ts` (thêm ca keyframe)

**Interfaces:** Consumes `--elevation-nav` (Task 1). Produces: tab đang chọn có icon `filled` và bọc icon bằng class `tubu-tab-pop`; nhãn 12px (`--type-label-size`), nét 500 tab thường / 600 tab đang chọn; `<nav>` bỏ `borderTop`, `boxShadow: var(--elevation-nav)`; nút tròn giữa (Vườn Xanh) giữ nguyên.

- [ ] **Step 1: Viết test đỏ.** icon.spec: `filled` → `fill="currentColor"`, `fill-opacity="0.16"`, `stroke-width="2"`; không `filled` → stroke-width 1.75 như cũ. bottom-nav Mini: tab active có svg `fill-opacity="0.16"`, tab thường không; nhãn active `fontWeight` 600 và thường 500, `fontSize` `var(--type-label-size)`; style `<nav>` có `boxShadow` `var(--elevation-nav)` và không `borderTop`. bottom-nav web: HTML chứa `shadow-nav`, nhãn `text-label`, tab active `font-semibold`; sửa ca cũ đang khẳng định `class="text-caption"` (dòng ~141). CSSOM: có `@keyframes tubu-tab-pop` và `.tubu-tab-pop` dùng `--p-ease-spring`, 220ms; web `.tubu-tab-pop` nằm trong khối `prefers-reduced-motion`.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Cài đặt** theo Interfaces cả hai app (Mini: `<Icon filled={active}/>` + `Text variant="label"` ghi đè `fontWeight`; web: lucide `fill`/`fillOpacity`/`strokeWidth` khi active).
- [ ] **Step 4: Xanh:** các spec trên + `npx vitest run src/components/bottom-nav src/components/mobile-shell.spec.tsx src/components/bottom-nav-retap.spec.tsx src/ds-v2-guest.spec.ts` (web) và `npx vitest run src/components/bottom-nav.spec.tsx src/components/ui/icon.spec.tsx` (miniapp).
- [ ] **Step 5: Commit** `feat(ui): thanh dưới icon tô 16%, nhãn 12px, --elevation-nav, icon nảy khi chọn tab`

---

### Task 8: BottomSheet Mini là hộp thoại thật (a11y A3)

**Files:**
- Modify: `apps/miniapp/src/components/ui/bottom-sheet.tsx`, `apps/miniapp/src/components/ui/text.tsx` (`Heading` nhận `id?: string`)
- Test: `apps/miniapp/src/components/ui/bottom-sheet.spec.tsx`

**Interfaces:** Props `BottomSheetProps` giữ nguyên. Hành vi (chép từ `apps/web/src/components/mini/bottom-sheet.tsx:55-104`): nội dung bọc `<div role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1}>`; mở thì focus phần tử focus được đầu tiên (nút Đóng) hoặc chính khung; Tab/Shift+Tab quay vòng trong khung; `Escape` gọi `onClose` chỉ khi `dismissible`; đóng thì trả focus về phần tử đã focus lúc mở; ngăn xếp module-level để chỉ sheet trên cùng xử lý phím. Bắt khung bằng callback ref lưu state (nội dung ZaUI có thể dựng muộn một nhịp). Không thêm `safe-bottom` (spec cũ giữ).

- [ ] **Step 1: Viết test đỏ** (thêm vào spec hiện có): `role=dialog` có `aria-modal="true"` và `aria-labelledby` trỏ đúng `h2` tiêu đề; mở xong `document.activeElement` là nút "Đóng"; Esc gọi `onClose` một lần; `dismissible={false}` thì Esc không gọi `onClose` (Review Focus 1); mở hai sheet lồng nhau, Esc chỉ đóng sheet trên cùng; Tab ở nút cuối nhảy về đầu, Shift+Tab ở đầu nhảy về cuối; mở từ một nút rồi `rerender open=false` → focus về nút đó.
- [ ] **Step 2: Chạy đỏ:** `cd apps/miniapp && npx vitest run src/components/ui/bottom-sheet.spec.tsx`.
- [ ] **Step 3: Cài đặt** theo Interfaces.
- [ ] **Step 4: Xanh:** spec trên + `npx vitest run src/components/catalog src/components/ui/confirm-sheet.spec.tsx src/components/share-sheet.spec.tsx src/components/ui/main-landmark.spec.tsx`.
- [ ] **Step 5: Commit** `fix(a11y): BottomSheet Mini là hộp thoại thật (role=dialog, bẫy focus, Esc, trả focus)`

---

### Task 9: `useNotify` + vùng đọc thông báo (a11y A2)

**Files:**
- Create: `apps/miniapp/src/hooks/use-notify.ts`, `apps/miniapp/src/components/notify-region.tsx`
- Modify: `apps/miniapp/src/components/app.tsx` (render `<NotifyRegion />` cạnh `<SnackbarProvider>`), `pages/product-detail.tsx`, `pages/brand-view.tsx`, `hooks/use-coupon-use.ts` (đổi `useSnackbar`/`openSnackbar` sang `useNotify`/`notify`, giữ nguyên chữ và tuỳ chọn)
- Test: Create `apps/miniapp/src/hooks/use-notify.spec.tsx`

**Interfaces (Produces):**
```ts
export type NotifyType = 'success' | 'info' | 'warning' | 'error';
export interface NotifyOptions { text: string; type?: NotifyType; duration?: number; position?: 'top' | 'bottom' | 'center' }
export function spokenText(text: string): string;                  // bỏ emoji, gộp khoảng trắng, trim
export function announce(kind: 'status' | 'alert', text: string): void; // xoá vùng rồi ghi lại sau 50ms
export function useAnnouncements(): { status: string; alert: string };
export function useNotify(): { notify(opts: NotifyOptions): void };
// components/notify-region.tsx
export function NotifyRegion(): JSX.Element; // hai div SR_ONLY: role="status" aria-live="polite" aria-atomic="true" và role="alert"
```
`notify` gọi `openSnackbar` của zmp-ui với đúng các khoá được truyền (không thêm khoá `undefined`) rồi `announce`: `error`/`warning` → `alert`, còn lại → `status`; chuỗi đọc đã qua `spokenText`, rỗng thì không ghi.

- [ ] **Step 1: Viết test đỏ.** `spokenText('Đã thêm vào giỏ 🌿') === 'Đã thêm vào giỏ'`, `spokenText('Đã theo dõi nhãn 💚') === 'Đã theo dõi nhãn'`, `spokenText('🌿') === ''`. Render `NotifyRegion` + một nút gọi `notify({ text: 'Đã thêm vào giỏ 🌿', type: 'success' })` (mock `zmp-ui` `useSnackbar` như `share-sheet.spec.tsx`): sau `advanceTimersByTime(50)` vùng `role=status` có chữ "Đã thêm vào giỏ"; `openSnackbar` nhận đúng `{ text: 'Đã thêm vào giỏ 🌿', type: 'success' }` (không có khoá thừa); `type:'error'` ghi vào vùng `role=alert`; gọi cùng một câu hai lần liên tiếp → giữa hai lần vùng bị xoá rồi ghi lại (Review Focus 2); câu chỉ emoji → `openSnackbar` vẫn được gọi, vùng không có chữ, không ném lỗi.
- [ ] **Step 2: Chạy đỏ:** `cd apps/miniapp && npx vitest run src/hooks/use-notify.spec.tsx`.
- [ ] **Step 3: Cài đặt** theo Interfaces (store module-level + `useSyncExternalStore`; emoji bằng `/[\p{Extended_Pictographic}️‍]/gu`). Đổi ba file trong phạm vi sang hook.
- [ ] **Step 4: Xanh:** spec mới + `npx vitest run src/pages/product-detail src/pages/brand-view src/hooks/use-coupon-use src/components/loyalty src/ds-c076-pc10a.spec.ts src/ds-c076-pc10b.spec.ts src/ds-c076-pc10c1.spec.ts src/ds-c076-pc10c2.spec.ts src/ds-c076-pc10c3.spec.ts`; `cd apps/miniapp && npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(a11y): useNotify + vùng role=status/alert, PDP, brand-view, coupon-use dùng hook`

---

### Task 10: Gate

- [ ] **Step 1:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P1 --base 64abdc5e5 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P1.txt` (chạy từ worktree, một lần). Bước FAIL: so với base; "có sẵn" thì ghi, do gói thì sửa tới PASS.
- [ ] **Step 2:** Ghi `bundle-mini` (entry KB) trước/sau vào notes; entry ≤700 KB.
- [ ] **Step 3:** `pnpm lint:vars` và `pnpm lint:parity` xanh.

## Self-review

- Spec coverage: token (T1), `test`/`lint:vars` (T2), Badge/Chip (T3), 24 primitive (T4: 23 chỗ, `coupon-card.tsx:29` để P2), focus + scroll-padding (T5), nhấn (T6), thanh dưới (T7), BottomSheet (T8), `useNotify` (T9), contrast + tokens spec (T1). Không làm: tách `mobile-skin.ts` và lớp `text-fg-*` chung của DS-09, thay ghi đè `style` của Badge ở nơi gọi (DS-06, thuộc gói thẻ), `.tubu-press-card` gắn vào ProductTile (P4).
- Tên khớp 02-ke-hoach "Giao diện dùng chung": `--color-text-price-deal`, `--tile-w-sm/md`, `--type-price-tile-*`, `--space-block`, `--elevation-nav`, `--p-ease-spring`, `useNotify` ở `apps/miniapp/src/hooks/use-notify.ts`.
