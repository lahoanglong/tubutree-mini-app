# P10 `storefront-builder` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng lại màn dựng gian hàng CTV (`/storefront` Mini, `/ctv/gian-hang` web) theo "dựng bằng khối, đúng như khách thấy": màn chính là danh sách `SectionCard`, trang chi tiết khối có `LayoutPicker` + ô % combo + xem trước bằng `ShopSection` thật, chế độ Sắp xếp riêng, Hành trình thu thành dải 56px, thống kê 30 ngày lên đầu khi gian hàng LIVE.

**Architecture:** Mọi quy tắc (nhãn kiểu khối, kiểu khoá sau khi tạo, kẹp %, cảnh báo ngân sách/trần 6 khối, chữ đọc cho nút ↑↓, chữ dải Hành trình, DTO tạo khối) ở `packages/app-core/src/commerce/storefront-builder.ts`; hai app chỉ vẽ cùng tên thành phần (`SectionCard`, `LayoutPicker`, `MoveButtons`, `QuestStrip`). Trang chi tiết khối là một **chế độ xem trong cùng trang** (state `sectionId`), không thêm route (không đụng `route-map.json`, tránh xung đột với P14) và dùng lại mọi sheet/mutation sẵn có của trình dựng. API storefront giữ nguyên: kiểu khối (`kind`) chỉ chọn lúc tạo vì `UpdateCollectionDto` chưa nhận `kind`.

**Tech Stack:** TypeScript, React 18 + zmp-ui + Vite (Mini), Next 15 + Tailwind (web), TanStack Query, vitest, Playwright (mock-api cho Mini).

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật; §5 "Màn dựng `/storefront`"); `02-ke-hoach.md` mục P10 + "Giao diện dùng chung" (hàng `ShopSection`); nguồn `review/critique-store.md` (2.2, 3.2, 3.2a–c, 3.3, SB-01..SB-10, §7), `review/ia-merch.md` IA-07, `review/a11y.md` A9. Bàn giao: `handoff-wave1..4a.md` (đặc biệt wave3 "P10 dùng `ShopSection` làm xem trước", wave4a "Mini dính thấp 48px").

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`; worktree mới: `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`) trước gate.
- Chữ tiếng Việt: "Kệ ngang / Lưới / Danh sách / Combo" (critique-store SB-01), "Thương hiệu", "Mã giảm giá", "Gian hàng"; không dùng "Top", "Freeship", "voucher", "cửa hàng", "Nhãn hàng", dấu `...` (dùng `…`). Chữ mới của gói nằm ở `BUILDER_COPY` (file riêng trong app-core, không vào `SHOP_COPY`: tránh xung đột gộp tay với P14 và không đẩy bảng chữ vào entry Mini).
- Không thêm endpoint, không đổi API, không đụng đường tiền: `%` combo là cấu hình đã có (`comboDiscountPct`), máy chủ vẫn kẹp ở `storefront.max_combo_pct`; màn chỉ kẹp sớm bằng `clampComboPct` (trần mặc định 30 như API) và đọc lại giá trị đã lưu.
- a11y: nút ↑↓ có tên món (`Đưa {tên} lên`), `aria-disabled` (không `disabled`) ở đầu/cuối và **giữ focus**, vị trí mới báo qua vùng aria-live có sẵn (Mini `announce('status', …)` của `use-notify` đang ghi vào `NotifyRegion`; web vùng `role=status` riêng của trình dựng); vùng chạm ≥44px; `LayoutPicker` là radiogroup có phím mũi tên.
- Thẻ sản phẩm chỉ qua `ProductCard`/`ProductGrid`/`ProductRail`/`ShopSection`; không `gridTemplateColumns` tự vẽ lưới sản phẩm trong trang dựng; không lề âm ngang tay (guard `ds-shop-guard`): tràn mép dùng `.tubu-bleed`, khung xem trước giữ cột lề 16px nên `ShopSection` Mini dùng mặc định.
- Mini: không `getByRole('dialog')` stub bằng `role="dialog"`; thông báo mới qua `useNotify`/`announce`, không thêm `openSnackbar` trực tiếp (chỗ cũ giữ nguyên, ratchet chỉ được giảm).
- Chunk vào Mini ≤700 KB (hiện 630): trình dựng là route lười nên không đổi entry; chạy `node scripts/ci/bundle-budget.cjs apps/miniapp/www` ghi số trước/sau.
- Không sửa file gói khác: brand-view.tsx, lớp `sticky-below-back` (P17); P14 (`/vouchers`, `/offers`, vouchers*), P16 (admin danh mục). `route-map.json`, `shop-copy.ts`, `vi.ts` không đụng.
- Không deploy, không PROD, không `git stash` trần, không push. Comment chỉ nói "vì sao" không hiển nhiên (tiếng Việt).

## Review Focus

1. Khối rỗng/toàn món bị ẩn/đã hết hàng: thẻ khối hiện cảnh báo thay vì dải ảnh trống; xem trước không vẽ gì (không lỗi). Test: Task 1 (`sectionCardView` với 0 món khách thấy), Task 4 (preview rỗng).
2. Tên món/khối tiếng Việt dài có dấu ở 375px: thẻ khối, hàng sắp xếp và nhãn ↑↓ không tràn, tên cắt hai dòng. Test: Task 2 (`section-card.spec`), Task 7 (e2e đo không tràn ngang).
3. Đổi bố cục khi mạng lỗi/máy chủ từ chối: bộ chọn về giá trị đã lưu, có báo lỗi, giỏ/giá không liên quan. Test: Task 4 (`layout đổi lỗi`).
4. `%` combo hỏng (rỗng, chữ, 0, 99, âm, số thập phân): Lưu tắt khi không hợp lệ; quá trần thì kẹp; máy chủ kẹp thấp hơn thì màn hiện giá trị máy chủ + báo. Test: Task 1 (`parseComboPct`), Task 4.
5. Bấm ↑↓ liên tiếp ở món ghim/đầu/cuối: không gửi yêu cầu thừa, focus không rơi về body, người dùng đọc màn hình nghe được lý do. Test: Task 2 (`move-buttons.spec`), Task 4.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/commerce/storefront-builder.ts` (+spec) | quy tắc dùng chung (Task 1) |
| `apps/web/src/components/affiliate/storefront-rules.ts` (+spec) | bỏ `LAYOUT_LABEL`/`KIND_LABEL` riêng, import từ app-core |
| `apps/miniapp/src/components/ui/{section-card,layout-picker,move-buttons,quest-strip}.tsx` (+spec) | thành phần Mini (Task 2) |
| `apps/web/src/components/mini/{section-card,layout-picker,move-buttons,quest-strip}.tsx` (+spec) + `index.ts` | thành phần web (Task 3) |
| `apps/miniapp/src/components/storefront-preview.tsx`, `components/storefront-builder/{section-detail,new-section-sheet}.tsx`, `pages/storefront-builder.tsx` (+spec) | Mini (Task 4) |
| `apps/web/src/components/affiliate/{storefront-preview,storefront-section-detail,storefront-new-section,storefront-builder,storefront-sheets,storefront-panels}.tsx` (+spec), `app/ctv/gian-hang/page.spec.tsx` | web (Task 5) |
| `apps/miniapp/src/pages/storefront-view.tsx`, `apps/e2e/tests/storefront-builder.miniapp.spec.ts`, `apps/e2e/tests/support/builder-mocks.ts` | thanh dính + e2e 375px (Task 6, 7) |

---

### Task 1: Quy tắc dùng chung `commerce/storefront-builder.ts`

**Files:**
- Create: `packages/app-core/src/commerce/storefront-builder.ts`, `packages/app-core/src/commerce/storefront-builder.spec.ts`

**Interfaces — Produces** (đúng tên; Task 2–5 import):

```ts
export type SectionStyle = 'CAROUSEL' | 'GRID' | 'STACK' | 'COMBO';
export const SECTION_STYLES: readonly SectionStyle[];                 // ['CAROUSEL','GRID','STACK','COMBO'] (thứ tự hiện)
export const LAYOUT_LABEL: { readonly CAROUSEL: 'Kệ ngang'; readonly GRID: 'Lưới'; readonly STACK: 'Danh sách' };
export const KIND_LABEL: { readonly NORMAL: 'Thường'; readonly COMBO: 'Combo' };
export const STYLE_LABEL: Record<SectionStyle, string>;               // Kệ ngang | Lưới | Danh sách | Combo
export const STYLE_HINT: Record<SectionStyle, string>;                // '4–10 món, lướt ngang' | '4–6 món, nổi bật' | '3–5 món kèm lý do' | '2–5 món, giảm giá cả bộ'
export const COMBO_PCT_DEFAULT_MAX = 30;                              // = mặc định `storefront.max_combo_pct` của API
export const COMBO_PCT_NEW_DEFAULT = 10;
export const COMBO_MIN_ITEMS = 2;  export const COMBO_MAX_ITEMS = 5;
export function clampComboPct(pct: number, max?: number): number;    // số nguyên trong [0, max]; không hữu hạn → 0
export function parseComboPct(text: string, max?: number): number | null; // /^\d{1,3}$/, 0 → null, quá trần → kẹp; còn lại null

export interface BuilderItem { isHidden?: boolean; hiddenReason?: string | null; product: { id: string; thumbnail?: string | null } }
export interface BuilderCollection { id: string; title: string; kind: string; layout: string; comboDiscountPct?: number | null; items: BuilderItem[] }
export function isCustomerVisible(it: { isHidden?: boolean; hiddenReason?: string | null }): boolean;
export function sectionStyleOf(c: { kind: string; layout: string }): SectionStyle;  // kind COMBO → COMBO; layout lạ → GRID
export function visibleCollection<C extends BuilderCollection>(c: C): C;            // chỉ giữ món khách thấy

export interface SectionCardView {
  id: string; title: string; style: SectionStyle; styleLabel: string;
  total: number;            // số món khách thấy
  countText: string;        // 'Kệ ngang · 4 món'; combo 'Combo -10% · 3 món'
  thumbs: string[];         // ≤5 ảnh món khách thấy đầu tiên, bỏ món không có ảnh
  warnings: string[];       // chữ cảnh báo (rỗng = ổn)
  tabOnly: boolean;         // khối thứ 7 trở đi (chỉ ở tab Danh mục)
  spoken: string;           // 'Bếp xanh, Kệ ngang, 4 món. Thêm ít nhất 1 món nữa.'
}
export function sectionCardView(c: BuilderCollection, all: readonly BuilderCollection[]): SectionCardView;
export function overflowSectionsNotice(all: readonly BuilderCollection[]): string | null;  // quá SHOP_MAX_SECTIONS khối thật thì câu nhắc, không thì null

export function styleOptions(existing: { kind: string } | null): { style: SectionStyle; disabled: boolean }[]; // khối có sẵn: kiểu khoá (NORMAL không chọn COMBO, COMBO chỉ COMBO)
export function styleLockNote(kind: string): string | null;     // NORMAL → 'Kiểu Combo chọn lúc tạo khối.'; COMBO → 'Khối Combo giữ kiểu Combo; bạn chỉnh được mức giảm.'
export function newSectionDto(i: { style: SectionStyle; title: string; comboPct?: number | null }): { title: string; kind: 'NORMAL' | 'COMBO'; layout: 'GRID' | 'CAROUSEL' | 'STACK'; comboDiscountPct?: number };
export function suggestedSectionTitle(style: SectionStyle): string;

export type MoveDirection = 'up' | 'down';                      // re-export từ storefront-order
export function moveButtonLabel(dir: MoveDirection, name: string, scope?: 'item' | 'section'): string;       // 'Đưa Kem dưỡng lên' / 'Đưa khối Bếp xanh xuống'
export function moveAnnouncement(i: { name: string; dir: MoveDirection; index: number; total: number }): string; // 'Đã đưa Kem dưỡng lên vị trí 2/10' (index tính từ 0 SAU khi dời)
export function moveBlockedAnnouncement(i: { name: string; dir: MoveDirection; reason: 'edge' | 'pin' }): string;

export interface QuestStripInput { quests: { title: string; goal: number; progress: number; done: boolean; claimed: boolean; rewardPoints: number }[]; totalEarnedPoints: number }
export function questStripView(q: QuestStripInput, formatPoints: (n: number) => string): { text: string; spoken: string; hasReward: boolean };

export const BUILDER_COPY: Readonly<Record<string, string>>;    // chữ màn dựng (khoá bên dưới)
```

`BUILDER_COPY` có các khoá: `sections` 'Bố cục gian hàng', `sort` 'Sắp xếp', `sortDone` 'Xong', `addSection` 'Thêm khối', `viewAsGuest` 'Xem như khách', `styleLabel` 'Kiểu hiển thị', `preview` 'Khách sẽ thấy', `comboPct` 'Giảm khi mua cả bộ', `comboPctSave` 'Lưu mức giảm', `comboPctHint` 'Tối đa 30%', `comboPctClamped` 'Mức giảm tối đa hiện là {n}%.', `comboPctSaved` 'Đã lưu mức giảm {n}%.', `layoutSaved` 'Đã đổi kiểu hiển thị.', `back` 'Gian hàng của tôi', `empty` 'Chưa có khối nào. Thêm khối đầu tiên để khách có gì xem.', `itemsHeading` 'Sản phẩm trong khối', `renameSection` 'Đổi tên khối', `deleteSection` 'Xoá khối', `createAndAdd` 'Tạo và thêm món', `sectionName` 'Tên khối', `stats30` 'Thống kê 30 ngày', `statsByProduct` 'Theo sản phẩm', `questOpen` 'Hành trình gian hàng'.

- [ ] **Step 1: Test đỏ `storefront-builder.spec.ts`** (mỗi dòng một `it`):
  - `clampComboPct(50)===30`, `(12.6)===13`, `(-4)===0`, `(NaN)===0`, `(50, 40)===40`; `parseComboPct('15')===15`, `(' 15 ')===15`, `('')===null`, `('abc')===null`, `('0')===null`, `('-3')===null`, `('1.5')===null`, `('99')===30`, `('1000')===null` (quá 3 chữ số).
  - `sectionStyleOf({kind:'COMBO',layout:'GRID'})==='COMBO'`; `({kind:'NORMAL',layout:'CAROUSEL'})==='CAROUSEL'`; `layout` lạ → `'GRID'`.
  - `isCustomerVisible`: `isHidden:true` → false; `hiddenReason:'Ngừng bán'` → false; không có hai trường → true.
  - `sectionCardView`: 4 món (1 ẩn) CAROUSEL → `total 3`, `countText 'Kệ ngang · 3 món'`, `warnings` chứa 'Thêm ít nhất' không (3 ≥ 2); 1 món GRID → warnings `['Thêm ít nhất 1 món nữa.']`; 0 món → `['Chưa có món nào khách thấy được.']`, `thumbs []`; GRID 9 món → warning `'Khách thấy 6/9 món ở tab Shop; 3 món còn lại ở tab Sản phẩm.'`; CAROUSEL 14 → `'Khách thấy 10/14 …4 món…'`; STACK 8 → 5/8; STACK 1 món → không cảnh báo thiếu (tối thiểu 1); COMBO 3 món pct 10 → `countText 'Combo -10% · 3 món'`, không cảnh báo; COMBO 1 SP → `'Combo cần ít nhất 2 món khác nhau, khách chưa thấy ưu đãi.'`; COMBO 6 món → `'Combo nên có 2–5 món.'`; COMBO 2 dòng cùng một sản phẩm → cảnh báo cần 2 món khác nhau; `thumbs` tối đa 5, bỏ `thumbnail` rỗng; `spoken` bắt đầu bằng 'Tên, Kiểu, n món'.
  - `tabOnly`: 8 khối có món → khối 7 và 8 `tabOnly true`, khối 1–6 false; khối rỗng không chiếm chỗ (khối rỗng ở đầu + 6 khối có món → khối thứ 6 có món vẫn `tabOnly false`); `overflowSectionsNotice` 7 khối thật → chứa 'khối đầu' và '6'; 6 khối → null.
  - `styleOptions(null)` → 4 mục `disabled false`; `({kind:'NORMAL'})` → chỉ COMBO `disabled true`; `({kind:'COMBO'})` → chỉ COMBO `disabled false`. `styleLockNote('NORMAL')` / `('COMBO')` đúng chữ; kind lạ → null.
  - `newSectionDto({style:'COMBO',title:' Bộ đôi ',comboPct:50})` → `{title:'Bộ đôi',kind:'COMBO',layout:'CAROUSEL',comboDiscountPct:30}`; `comboPct` thiếu → 10; `({style:'GRID',title:'A'})` → `{title:'A',kind:'NORMAL',layout:'GRID'}` (không có khoá `comboDiscountPct`); `STACK` → `layout 'STACK'`.
  - `moveButtonLabel('up','Kem dưỡng')==='Đưa Kem dưỡng lên'`; `('down','Bếp xanh','section')==='Đưa khối Bếp xanh xuống'`; `moveAnnouncement({name:'Kem',dir:'up',index:1,total:10})==='Đã đưa Kem lên vị trí 2/10'`; `moveBlockedAnnouncement` 'edge' up → 'Kem đã ở đầu danh sách', down → '… ở cuối danh sách'; 'pin' → 'Món ghim luôn nằm trên món thường.'
  - `questStripView`: có thưởng chờ (2 nhiệm vụ done chưa nhận, 1.000 + 2.000) → `text '2 phần thưởng đang chờ · 3.000 điểm'`, `hasReward true` (dùng `formatPoints=(n)=>n.toLocaleString('vi-VN')+' điểm'` trong test); không có chờ, nhiệm vụ kế `Viết lý do cho 3 sản phẩm` 0/3 → `'Viết lý do cho 3 sản phẩm · 0/3'`; tất cả đã nhận → `'Đã nhận 5.000 điểm'`; `spoken` luôn là câu đầy đủ (không có "·").
  - `BUILDER_COPY` không chứa thuật ngữ trong `FORBIDDEN_TERMS` (import từ `../shop-copy`), không có `...`.
- [ ] **Step 2:** `npx vitest run src/commerce/storefront-builder.spec.ts` (trong `packages/app-core`) → FAIL (thiếu module).
- [ ] **Step 3:** Cài đặt theo Interfaces. `sectionCardView` dùng `collectionView`/`SECTION_BUDGET`/`SHOP_MAX_SECTIONS` (collection-view.ts) và `planShopSections` (shop-page.ts) trên bản `visibleCollection`; ngân sách theo `LAYOUT_OF` của collectionView (rail 10, grid 6, line 5); tối thiểu CAROUSEL/GRID 2 món, STACK 1.
- [ ] **Step 4:** `npx vitest run src/commerce src/storefront-order.spec.ts` → PASS.
- [ ] **Step 5:** Commit `feat(app-core): quy tắc màn dựng gian hàng (kiểu khối, kẹp % combo, cảnh báo ngân sách, chữ nút ↑↓)`.

---

### Task 2: Thành phần Mini `SectionCard`, `LayoutPicker`, `MoveButtons`, `QuestStrip`

**Files:**
- Create: `apps/miniapp/src/components/ui/{section-card,layout-picker,move-buttons,quest-strip}.tsx` + `.spec.tsx` mỗi file.

**Interfaces — Consumes:** Task 1. **Produces** (web Task 3 có cùng props):

```ts
// SectionCard: một khối ở màn chính. Cả thẻ là một nút mở trang chi tiết; cảnh báo là chữ caption.
export interface SectionCardProps { view: SectionCardView; onOpen(): void; trailing?: ReactNode }
export function SectionCard(p: SectionCardProps): JSX.Element;          // <li>-friendly: trả <div data-testid="section-card" data-section-id>; nút tên truy cập = view.spoken

// LayoutPicker: radiogroup 4 ô (hình 48×32 + nhãn), phím mũi tên đổi ô, ô khoá `aria-disabled`.
export interface LayoutPickerProps { value: SectionStyle; onChange(s: SectionStyle): void; options: { style: SectionStyle; disabled: boolean }[]; lockNote?: string | null; label?: string }
export function LayoutPicker(p: LayoutPickerProps): JSX.Element;

// MoveButtons: hai nút ↑↓ vuông 44px, tên có tên món; aria-disabled ở rìa; bấm lúc khoá gọi onBlocked.
export interface MoveButtonsProps { name: string; scope?: 'item' | 'section'; id: string; canUp: boolean; canDown: boolean; onMove(dir: MoveDirection): void; onBlocked?(dir: MoveDirection): void }
export function MoveButtons(p: MoveButtonsProps): JSX.Element;          // mỗi nút có data-move-id={id} data-move-dir

// QuestStrip: dải 56px mở sheet Hành trình.
export interface QuestStripProps { text: string; spoken: string; hasReward: boolean; onOpen(): void }
export function QuestStrip(p: QuestStripProps): JSX.Element;
```

- [ ] **Step 1: Test đỏ** (mỗi file một spec):
  - `section-card.spec`: tên truy cập của nút = `view.spoken`; hiện `countText`, tối đa 5 ảnh, mỗi `warnings[i]` là một dòng chữ; `tabOnly` hiện chữ 'Chỉ hiện ở tab Danh mục'; bấm gọi `onOpen` một lần; tên khối 80 ký tự có dấu không đặt `white-space: nowrap` (cắt 2 dòng bằng `-webkit-line-clamp`); chiều cao tối thiểu 44.
  - `layout-picker.spec`: `role="radiogroup"` có tên 'Kiểu hiển thị'; 4 `role="radio"` theo thứ tự Kệ ngang, Lưới, Danh sách, Combo; `aria-checked` đúng ô `value`; chỉ ô đang chọn `tabIndex 0`; bấm ô khác gọi `onChange` với kiểu đó; ô `disabled` có `aria-disabled="true"`, bấm không gọi `onChange`; phím `ArrowRight` ở ô cuối nhảy về đầu và gọi `onChange`, bỏ qua ô khoá; có `lockNote` thì hiện chữ đó và ô khoá có `aria-describedby` trỏ tới nó; mỗi ô cao ≥44.
  - `move-buttons.spec`: tên nút `Đưa Kem lên` / `Đưa Kem xuống`; `canUp=false` → nút lên `aria-disabled="true"` và **không** có thuộc tính `disabled`; bấm nút khoá không gọi `onMove` mà gọi `onBlocked('up')`; nút khoá vẫn nhận focus (`focus()` rồi `document.activeElement` là nút đó); `scope='section'` → 'Đưa khối Bếp xanh lên'; cao và rộng ≥44.
  - `quest-strip.spec`: nút cao ≥56, tên truy cập = `spoken`, hiện `text`; `hasReward` đổi tông nhấn nhưng không thêm nút primary (không có `.zaui-btn-primary`); bấm gọi `onOpen`.
- [ ] **Step 2:** `npx vitest run src/components/ui/section-card.spec.tsx src/components/ui/layout-picker.spec.tsx src/components/ui/move-buttons.spec.tsx src/components/ui/quest-strip.spec.tsx` (trong `apps/miniapp`) → FAIL.
- [ ] **Step 3:** Cài đặt. Dùng token CSS (`--color-*`), `ProductThumb` cho ảnh 40px (alt rỗng, trang trí), `tubu-press`, `touch-target`; hình ô của LayoutPicker là SVG nội tuyến `aria-hidden`; tên món trong nhãn ↑↓ chỉ cắt ở chữ hiển thị, không cắt `aria-label`.
- [ ] **Step 4:** chạy lại bốn spec + `src/ds-*.spec.ts` liên quan (`npx vitest run src/ds-no-legacy-aliases.spec.ts src/ds-primitive-refs.spec.ts src/components/ui/hit-target-guard.spec.tsx`) → PASS.
- [ ] **Step 5:** Commit `feat(miniapp): SectionCard, LayoutPicker, MoveButtons, QuestStrip cho màn dựng gian hàng`.

---

### Task 3: Thành phần web cùng tên, cùng props

**Files:**
- Create: `apps/web/src/components/mini/{section-card,layout-picker,move-buttons,quest-strip}.tsx` + spec mỗi file; export vào `apps/web/src/components/mini/index.ts`.

**Interfaces:** y hệt Task 2 (`SectionCardProps`, `LayoutPickerProps`, `MoveButtonsProps`, `QuestStripProps`), import kiểu từ `@tubutree/app-core/commerce/storefront-builder`.

- [ ] **Step 1: Test đỏ:** chép các ca của Task 2 sang web (`render` từ `@/test-utils/dom`), thêm: từ md trở lên `SectionCard` vẫn là một nút (không đổi cấu trúc); `LayoutPicker` 4 ô không tràn ở 375px (lớp `grid-cols-4`, `min-w-0`).
- [ ] **Step 2:** `npx vitest run src/components/mini/section-card.spec.tsx src/components/mini/layout-picker.spec.tsx src/components/mini/move-buttons.spec.tsx src/components/mini/quest-strip.spec.tsx` (trong `apps/web`) → FAIL.
- [ ] **Step 3:** Cài đặt bằng Tailwind theo cùng số đo với Mini (đầu file ghi `// Nguồn: apps/miniapp/src/components/ui/<tên>.tsx`).
- [ ] **Step 4:** bốn spec + `npx vitest run src/components/mini` → PASS.
- [ ] **Step 5:** Commit `feat(web): SectionCard, LayoutPicker, MoveButtons, QuestStrip khớp Mini App`.

---

### Task 4: Mini — màn chính, trang chi tiết khối, xem trước bằng `ShopSection`

**Files:**
- Create: `apps/miniapp/src/components/storefront-builder/section-detail.tsx`, `new-section-sheet.tsx` (+spec mỗi file)
- Modify: `apps/miniapp/src/components/storefront-preview.tsx` (dựng bằng `ShopSection`), `apps/miniapp/src/pages/storefront-builder.tsx`, `apps/miniapp/src/services/storefront-api.ts` (`updateCollection` trả `StorefrontCollectionEdit`), spec `storefront-builder.spec.tsx`, `storefront-signup.spec.tsx` (nếu đỏ vì preview)

**Interfaces — Produces:**

```ts
// section-detail.tsx
export interface SectionDetailProps {
  col: StorefrontCollectionEdit; sortMode: boolean; headingRef: Ref<HTMLHeadingElement>;
  layoutBusy: string | null;                       // layout đang gửi (hiện ngay trong bộ chọn)
  onBack(): void; onMenu(): void;                  // ⋯ của khối (đổi tên/xoá)
  onStyle(style: SectionStyle): void;              // đổi layout (khối NORMAL)
  onComboPct(pct: number): Promise<void>;          // lưu %; trả khi xong
  onAddItem(): void; onToggleSort(): void;
  onMoveItem(itemId: string, dir: MoveDirection): void; onMoveBlocked(itemId: string, dir: MoveDirection): void;
  onItemMenu(itemId: string): void; onNote(itemId: string): void; onKit(slug: string): void;
}
export function SectionDetail(p: SectionDetailProps): JSX.Element;
// new-section-sheet.tsx
export function NewSectionSheet(p: { open: boolean; onClose(): void; pending: boolean; onCreate(dto: ReturnType<typeof newSectionDto>): void }): JSX.Element;
```

Hành vi: màn chính `Builder` = tiêu đề + trạng thái → (LIVE) hàng thống kê 3 ô → `QuestStrip` → hồ sơ gọn (bìa 56×56, tên, huy hiệu, `/s/slug`, "Sửa hồ sơ ›", "Cài đặt") → "Bố cục gian hàng" + nút "Sắp xếp" → danh sách `SectionCard` (ở chế độ Sắp xếp mỗi khối thu thành một dòng 56px: tên + `MoveButtons scope="section"`) → `overflowSectionsNotice` → nút "Thêm khối" → thanh dính (giữ nguyên). Bấm thẻ khối → `sectionId` = id, đưa focus vào `h1` của trang chi tiết; "‹ Gian hàng của tôi" trở lại và đưa focus về thẻ vừa mở. Trang chi tiết: `LayoutPicker` (khoá theo `styleOptions`), ô % combo (khối COMBO, nút "Lưu mức giảm"), khung "Khách sẽ thấy" = `ShopSection preview` trong cột lề 16px, `inert`; dòng ngân sách; danh sách món (ảnh 48 `ProductThumb`, tên 1 dòng, giá, lý do 1 dòng, ⋯ có Ghim/Ẩn/Bài đăng mẫu/Xoá); "Sắp xếp" bật `MoveButtons` cho từng món (ngoài chế độ này không có mũi tên). Thống kê chi tiết theo sản phẩm vẫn ở cuối. `NewSectionSheet` = `LayoutPicker` (cả 4 ô mở) + ô tên (điền sẵn `suggestedSectionTitle`, thôi điền khi người dùng gõ) + ô % khi chọn Combo + nút "Tạo và thêm món"; tạo xong mở trang chi tiết khối mới và `PickerSheet` của nó.

- [ ] **Step 1: Test đỏ** trong `storefront-builder.spec.tsx` (mock `services/storefront-api`, `ShopSection` thật qua `vi.mock` KHÔNG; chỉ spy `announce`):
  - màn chính: không còn nút "Đưa lên"/"Đưa xuống" (tên khối nào cũng không); mỗi khối là `SectionCard` có `countText`; bộ 7 khối hiện câu nhắc 'khối đầu'; khối rỗng hiện cảnh báo.
  - **tạo khối COMBO gửi `kind`, `layout`, `comboDiscountPct`**: mở "Thêm khối" → chọn "Combo" → gõ tên → nhập 15 → "Tạo và thêm món" → `createCollection` gọi đúng `{ title, kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 15 }`; chọn "Lưới" gửi `{ title, kind: 'NORMAL', layout: 'GRID' }` (không có `comboDiscountPct`); tên trống → nút tắt; lỗi máy chủ → tên còn nguyên, báo lỗi.
  - **xem trước dùng `ShopSection`**: trang chi tiết có `data-testid="shop-section-preview"` bao một `ShopSection` thật (tìm `data-testid` `shop-rail|shop-grid|shop-line|shop-combo` theo kiểu khối), khung `inert`; đổi sang "Lưới" thì `shop-grid`; món `isHidden` không có trong xem trước; khối rỗng → không vẽ gì, không lỗi.
  - **nút ↑ ở đầu danh sách `aria-disabled` và giữ focus**: vào chế độ Sắp xếp, nút "Đưa {món đầu} lên" có `aria-disabled="true"`, không `disabled`; `focus()` rồi bấm → không gọi `reorderItems`, `document.activeElement` vẫn là nút đó, `announce('status', 'Kem đã ở đầu danh sách')`.
  - dời món: bấm "Đưa {tên} xuống" gửi đúng `orderedIds`, danh sách đổi ngay, `announce('status', 'Đã đưa {tên} xuống vị trí 2/3')`, focus ở lại đúng nút ("Đưa {tên} xuống") sau khi hàng đổi chỗ; món ghim chặn → `announce` câu 'Món ghim luôn nằm trên món thường.'; các ca dời liên tiếp/lỗi/ghim của spec cũ chuyển sang trang chi tiết và vẫn xanh; dời khối ở màn chính (chế độ Sắp xếp) gửi `reorderCollections`.
  - đổi bố cục: bấm "Danh sách" gọi `updateCollection(id, { layout: 'STACK' })` (chỉ `layout`), ô chọn đổi ngay; lỗi → về ô cũ + báo lỗi; khối `kind COMBO` → ba ô còn lại `aria-disabled`, hiện `styleLockNote`; khối NORMAL → ô Combo khoá.
  - `%` combo: khối COMBO có ô số; nhập 'abc'/''/'0' → "Lưu mức giảm" tắt; nhập 50 → gửi `{ comboDiscountPct: 30 }`; máy chủ trả 20 (trần thấp hơn) → ô hiện 20 và `notify` 'Mức giảm tối đa hiện là 20%.'; PATCH không gửi kèm `layout`/`kind`/`title`.
  - Hành trình: dải `QuestStrip` thay thẻ lớn; bấm mở sheet có `QuestSection`, nút "Nhận N điểm" trong sheet là `secondary` (không `zaui-btn-primary`); không còn nút primary nào khác ngoài thanh dính.
  - thống kê: gian hàng LIVE → hàng 3 ô ở trên khối (trước `SectionCard` đầu); gian hàng nháp/chờ duyệt → không có thống kê; "Theo sản phẩm" mở danh sách top 5 (các ca cũ về cộng đúng ô Doanh thu giữ).
  - `storefront-signup.spec` bước 4 và `StorefrontPreview`: dựng bằng `ShopSection` (`shop-rail`... có mặt), `data-testid="storefront-preview"` giữ, nháp rỗng hiện 'Chưa có sản phẩm nào.'.
- [ ] **Step 2:** `npx vitest run src/pages/storefront-builder.spec.tsx src/components/storefront-builder src/pages/storefront-signup.spec.tsx` (trong `apps/miniapp`) → FAIL.
- [ ] **Step 3:** Cài đặt. Giữ nguyên mọi mutation/sheet sẵn có của `Builder` (đăng, chia sẻ, hồ sơ, cấu hình, menu món, lý do, xoá, `PickerSheet`); chỉ thay phần vẽ danh sách khối và thêm `sectionId`, `sortMode`. Focus sau khi dời: lưu `{id, dir}` rồi `useEffect` trên `sf.collections` focus lại `[data-move-id][data-move-dir]` (React có thể gỡ-gắn nút khi đổi chỗ). `onStyle` dùng `useMutation(updateCollection)`, `layoutBusy = mutation.isPending ? variables.layout : null`; `onComboPct` gọi `updateCollection(id, { comboDiscountPct: pct })`, đọc `data.comboDiscountPct` trả về để so với `pct` (nhỏ hơn → báo `comboPctClamped`). Xem trước: `visibleCollection(col)` → `ShopSection collection preview`.
- [ ] **Step 4:** ba spec trên + `npx tsc -p apps/miniapp --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat(miniapp): màn dựng gian hàng theo khối (SectionCard, trang chi tiết, xem trước ShopSection, chế độ Sắp xếp)`.

---

### Task 5: Web — cùng màn dựng

**Files:**
- Create: `apps/web/src/components/affiliate/storefront-section-detail.tsx`, `storefront-new-section.tsx` (+spec mỗi file)
- Modify: `storefront-builder.tsx`, `storefront-preview.tsx` (dựng bằng `ShopSection`), `storefront-sheets.tsx` (bỏ `NewCollectionForm`, giữ `CollectionSheet`), `storefront-panels.tsx` (`StatsSection` có `compact`, `QuestSection` trong sheet), `storefront-rules.ts` (+spec: bỏ `LAYOUT_LABEL`/`KIND_LABEL`), spec `apps/web/src/app/ctv/gian-hang/page.spec.tsx`, `storefront-preview.spec.tsx`, `storefront-sheets.spec.tsx`.

**Interfaces:** `StorefrontSectionDetail` và `StorefrontNewSection` có props như `SectionDetail`/`NewSectionSheet` của Task 4, thêm `onNotice: Notify` thay `announce`.

- [ ] **Step 1: Test đỏ** trong `page.spec.tsx`: chép mọi ca mới của Task 4 (màn chính, tạo COMBO `{title,kind,layout,comboDiscountPct}`, xem trước `ShopSection`, ↑ aria-disabled giữ focus, dời + báo, đổi bố cục, %, QuestStrip, thống kê LIVE); các ca cũ "form tạo bộ sưu tập chỉ có ô tên" và "mặc định chỉ gửi {title}" được thay bằng hành vi mới; thêm: phát biểu vị trí mới vào vùng `role="status"` ẩn (`data-testid="move-status"`); ở `lg` vẫn một cột nội dung + cột phải thống kê như cũ (lớp `lg:grid-cols`); `storefront-rules.spec`: không còn export `LAYOUT_LABEL`/`KIND_LABEL`.
- [ ] **Step 2:** `npx vitest run src/app/ctv/gian-hang/page.spec.tsx src/components/affiliate` (trong `apps/web`) → FAIL.
- [ ] **Step 3:** Cài đặt như Task 4 (cùng trạng thái `sectionId`, `sortMode`, focus), web dùng `ShopSection` từ `@/components/mini` (preview khung `inert` kiểu boolean).
- [ ] **Step 4:** các spec trên + `npx tsc -p apps/web --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat(web): màn dựng gian hàng theo khối khớp Mini App`.

---

### Task 6: Mini — kiểm thanh dính của `storefront-view`

**Files:**
- Modify (chỉ khi đo sai): `apps/miniapp/src/pages/storefront-view.tsx` (`STICKY_TOP`, `--sort-bar-top`)
- Create: `apps/e2e/tests/storefront-builder.miniapp.spec.ts` (ca đo thanh dính; Task 7 thêm ca khác vào cùng file)

- [ ] **Step 1: Đo thật:** viết ca `thanh tab Shop|Sản phẩm dính ngay dưới thanh nút lùi, không hở` ở 375×812 trên `/s/:slug` (mock `mockShopPage` từ `support/shop-page-mocks`): cuộn `.zaui-page` xuống 600px, đo `getBoundingClientRect().top` của dải tab (`role=tablist` cha dính) và đáy thanh nút lùi (`[data-back-bar]`, cao `56 + safe-top`): kỳ vọng `0 ≤ top − backBarBottom ≤ 2`. Chạy: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3321 npx playwright test tests/storefront-builder.miniapp.spec.ts -g "dính" --workers=1` → ghi số đo thật vào plan (mục Điều chỉnh).
- [ ] **Step 2:** Nếu hở (≈48px như P12 thấy): đổi `STICKY_TOP` thành `56 - 48 = 8px` đúng cách `flash-sale.tsx` (hằng `BACK_BAR_HEIGHT`/`PAGE_TOP_PADDING`, kèm chú thích đo ở `.zaui-page`) và sửa `--sort-bar-top` theo cùng gốc; test Step 1 xanh. Nếu đã đúng: giữ mã, giữ test làm chứng, ghi "đo đúng, không sửa". `brand-view.tsx`/`sticky-below-back` KHÔNG sửa.
- [ ] **Step 3:** `npx vitest run src/pages/storefront-view.spec.tsx` (Mini) + e2e `shop-page.miniapp.spec.ts` → PASS (không hồi quy `tab dính` của P9).
- [ ] **Step 4:** Commit `fix(miniapp): thanh tab trang gian hàng dính sát thanh nút lùi` (hoặc `test(e2e): đo thanh dính trang gian hàng` nếu không sửa mã).

---

### Task 7: e2e Mini 375px cho màn dựng

**Files:**
- Create: `apps/e2e/tests/support/builder-mocks.ts` (`mockBuilder(api, overrides?)`: `/storefront/me` với 3 khối GRID 12 món, CAROUSEL 4 món, COMBO 3 món 10%, một món ẩn; `/storefront/me/{quests,stats,products}`; `PATCH/POST` collections ghi nhận), mở rộng `storefront-builder.miniapp.spec.ts`.

- [ ] **Step 1: Test đỏ** (e2e, 375×812):
  - màn chính: ba `SectionCard`, không ô nhập tên ở cuối trang, không thấy chữ "Đưa lên"; không tràn ngang (`document.documentElement.scrollWidth ≤ 375`); `QuestStrip` cao ≈56 (54–60); chỉ một nút primary nhìn thấy ở màn đầu.
  - mọi nút ↑↓ ở chế độ Sắp xếp cao và rộng ≥44 (đo `boundingBox`), nút ↑ của khối đầu `aria-disabled` và vẫn `toBeFocused()` sau khi bấm.
  - trang chi tiết khối GRID: bấm "Danh sách" → `PATCH` body `{ layout: 'STACK' }`, khung xem trước đổi `shop-grid` → `shop-line`; kệ CAROUSEL trong xem trước: thẻ đầu cách mép trái khung 12px ±1 và tiêu đề cách khung 16px ±1 (khung giữ cột lề 16px, không thụt thêm).
  - tạo COMBO: "Thêm khối" → Combo → tên → 15 → tạo → `POST` body có `kind:'COMBO'`, `comboDiscountPct:15`.
- [ ] **Step 2:** chạy → FAIL trên mã cũ (hoặc chưa có spec); sau Task 4 → PASS: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3321 npx playwright test tests/storefront-builder.miniapp.spec.ts --workers=1`.
- [ ] **Step 3:** Commit `test(e2e): màn dựng gian hàng Mini 375px`.

---

### Task 8: Gate, ảnh 375px, bàn giao

- [ ] **Step 1:** `export PATH=…; pnpm --filter @tubutree/shared-types build; (cd apps/api && npx prisma generate)`.
- [ ] **Step 2:** Chụp 375px Mini (Vite dev cổng 3321, mock-api) và web (Next dev cổng 3322, `/ctv/gian-hang` với phiên giả qua mock trình duyệt) màn chính, trang chi tiết khối COMBO và GRID, chế độ Sắp xếp, sheet Hành trình; lưu `docs/2026-10-31-shop-redesign/screens/P10/` (gitignore); so hai bản, sửa lệch; tắt server.
- [ ] **Step 3:** Gate đúng một lần: `bash docs/2026-10-28-review/tools/gate.sh <worktree> --base d768f7d42 --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P10.txt`; rồi e2e Mini đầy đủ: `cd apps/e2e && E2E_SCOPE=miniapp E2E_MINIAPP_PORT=3321 npx playwright test --workers=2 --reporter=line`. Bước FAIL nào cũng FAIL ở base thì ghi "có sẵn".
- [ ] **Step 4:** Đo entry: `node scripts/ci/bundle-budget.cjs apps/miniapp/www` (kỳ vọng entry không đổi, 630 KB).

---

## Điều chỉnh lúc làm

(điền khi làm: chỗ lệch kế hoạch, số đo thanh dính, ca e2e cũ sửa theo thiết kế)

## Self-review

- Phủ P10: màn chính `SectionCard` (T1–T5), `LayoutPicker` 4 ô + % combo kẹp `clampComboPct` (T1, T4, T5), xem trước `ShopSection` thật (T4, T5), chế độ Sắp xếp + ↑↓ có tên + `aria-disabled` + giữ focus + báo vị trí (T1, T2, T4, T5), Hành trình dải 56px mở sheet (T1, T2, T4), thống kê lên đầu khi LIVE (T4, T5), `LAYOUT_LABEL`/`KIND_LABEL` lên app-core (T1, T5), việc mở của wave4a `STICKY_TOP` (T6), e2e 375px (T7).
- Nhất quán tên: `SectionStyle`, `SectionCardView`, `styleOptions`, `newSectionDto`, `MoveButtonsProps`, `LayoutPickerProps` dùng giống nhau ở T1–T5.
- Quyết định lệch thiết kế (ghi vào notes): trang chi tiết khối là chế độ xem trong trang (không route, không sheet); kiểu NORMAL↔COMBO khoá sau khi tạo (API chưa cho đổi `kind`); `clampComboPct` chỉ có ở API nên thêm bản app-core với trần mặc định 30 và đối chiếu giá trị máy chủ trả về.
