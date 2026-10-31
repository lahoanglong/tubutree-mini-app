# P5 `section-kit` Implementation Plan

> **Cho agent làm:** BẮT BUỘC dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans. Bước dùng checkbox `- [ ]`.

**Mục tiêu:** dựng 8 thành phần dùng chung (`SectionHeader`, `Section`, `Countdown`, `FlashSoldBar`, `SortBar`, `VoucherTicket`, `ComboCard`, `BannerCarousel`) ở Mini App và web, cùng tên, cùng props, kèm trang `/ds-gallery` chỉ có ở bản dev vẽ mọi biến thể và trạng thái. Chưa gắn vào màn nào.

**Kiến trúc:** quyết định không phụ thuộc DOM (nhịp đếm ngược, bảng chữ, khi nào banner được tự chạy, dữ liệu giả của gallery) nằm ở `packages/app-core`; Mini App (`apps/miniapp/src/components/ui/<tên>.tsx`, nguồn) và web (`apps/web/src/components/mini/<tên>.tsx`, bản chép có `'use client'`) chỉ vẽ. Mọi chữ hiển thị lấy qua `fillCopy` (`shop-copy.ts`); mọi màu/cỡ lấy ở token, không số px màu mới.

**Tech stack:** React 18 + zmp-ui + Vite (Mini), React 19 + Next 15 (web), vitest (jsdom; Mini dùng @testing-library/react, web dùng `@/test-utils/dom`), lucide-react.

**Spec:** `docs/2026-10-31-shop-redesign/01-thiet-ke.md` (§4 là luật: Q1 tiêu đề khối Inter 16/700, Q2 giá deal cam đậm, Q3 đồng hồ, Q4–Q5 nhãn/chữ, Q19 entry Mini ≤700 KB); chữ ký ở `02-ke-hoach.md` mục "Giao diện dùng chung / Thành phần" và mục P5. Nguồn: `review/design-system.md` B5, B7–B10; `review/critique-shop.md` BR-01 (SortBar); `review/critique-store.md` 3.1b (ComboCard), 3.4 (VoucherTicket); `review/polish.md` PL-07/08; `review/a11y.md` mục B (B1, B3, B4, B6, B7) và A (vùng chạm). Bàn giao đợt 1: `plans/handoff-wave1.md`.

## Global Constraints

- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH` cho mọi lệnh. Worktree mới đã chạy `pnpm --filter @tubutree/shared-types build` và `npx prisma generate` (trong `apps/api`).
- Giữ đúng tên, props, đường import ở bảng "Thành phần" của `02-ke-hoach.md`; thêm prop optional được, không đổi/đổi tên cái đã chốt.
- Chữ: "Bán chạy nhất", "Miễn phí giao hàng", "Được yêu thích", "Tubu chọn", "Mã giảm giá", "Thương hiệu", "Tạm hết hàng", "Ngừng bán", "Kết thúc sau {t}"; không "Top", "Freeship", "Kho voucher", "Nhãn hàng", không `...` (dùng `…`), không `!`. Chữ mới thêm vào `SHOP_COPY` và `SHOP_COPY_MAX` (thiếu một bên là spec đỏ).
- Giá giảm màu `--color-text-price-deal`; giá thường đen; không đỏ. Tiêu đề khối Inter 16/700 -0.01em.
- Vùng chạm ≥44px (nút nhìn nhỏ dùng `tubu-hit-44` / `tubu-hit-44-square`), tương phản ≥4,5:1 chữ, icon `aria-hidden`, nút đang bận dùng `aria-disabled` (không `disabled`), không lồng phần tử bấm được vào nhau, `BottomSheet` Mini là hộp thoại thật (không stub ZaUI Sheet bằng role="dialog").
- Chunk vào Mini ≤700 KB: không gói nào của P5 được vào entry. Gallery Mini là route lazy chỉ khi `import.meta.env.DEV`; ghi entry trước/sau ở notes.
- Không sửa file của P4 (ProductTile/ProductCard/ProductGrid/ProductRail/PriceTag, các màn gọi thẻ, wishlist-heart). Không thay chỗ gọi trong màn, kể cả 3 chỗ "Xem tất cả" chép tay (P6–P9 làm). File gộp tay khi merge: `shop-copy.ts`, `shop-copy-budget.ts`, `route-map.json` (chỉ thêm ở khối riêng).
- Comment chỉ giải thích "vì sao", tiếng Việt, mật độ như file quanh đó. Không `git stash` trần, không push, không PROD. Máy thiếu RAM: chạy vitest theo file, gate đầy đủ đúng một lần ở cuối.

## Review Focus

1. `Countdown` gặp `endAt` đã qua, rác hoặc đổi giữa chừng: không "00:00:00"/"NaN", `onEnd` gọi đúng một lần (kể cả re-render, đổi hàm `onEnd`), đổi `endAt` sang mốc mới thì tính lại. Ở Task 3.
2. `BannerCarousel` gặp 0 hoặc 1 slide, `intervalMs` nhỏ hơn 5000 hoặc rác, trình duyệt không có `matchMedia`, tab ẩn, slide giảm số lượng khi đang ở slide cuối: không tự chạy khi chưa chắc được phép, không chỉ số vượt biên, không chấm/nút dừng thừa. Ở Task 2 và Task 9.
3. `VoucherTicket` mã không có đơn tối thiểu hoặc không có hạn, tên rất dài, trạng thái đã dùng/hết hạn/hết lượt kèm `primary`: không dòng trống, không nút (hoặc nút `aria-disabled` không gọi `onClick`), `busy` không bấm đôi. Ở Task 7.
4. `ComboCard` rỗng, một món, hơn 3 món, giá combo ≥ tổng lẻ, đang `busy`: không nút vô nghĩa, không "Tiết kiệm 0đ" hay số âm, ảnh thừa thành "+n", không bấm đôi. Ở Task 8.
5. `FlashSoldBar` và `SortBar` nhận số/giá trị rác (`soldPct` NaN/âm/lớn hơn 100, `value` ngoài `options`, `filterCount` 0/âm/thiếu, `options` rỗng): thanh kẹp 0–100 và chữ vẫn hiện, không "(0)", không lỗi; bấm lại tab đang chọn vẫn gọi `onChange` (đảo chiều giá). Ở Task 4 và Task 6.

---

## File Structure

| File | Việc |
|---|---|
| `packages/app-core/src/shop-copy.ts`, `shop-copy-budget.ts` | thêm khoá `section.*`, `sort.*`, `combo.*` (Task 1) |
| `packages/app-core/src/commerce/countdown-tick.ts` | `countdownFrame`, `countdownDelay`, `countdownClockParts` (Task 2) |
| `packages/app-core/src/commerce/banner-autoplay.ts` | `bannerInterval`, `bannerShouldAutoplay`, `bannerNextIndex`, `BANNER_MIN_INTERVAL_MS` (Task 2) |
| `packages/app-core/src/commerce/ds-gallery-data.ts` | dữ liệu giả dùng chung cho hai gallery (Task 10) |
| `apps/miniapp/src/components/ui/{section-header,section,countdown,flash-sold-bar,sort-bar,voucher-ticket,combo-card,banner-carousel}.tsx` + `.spec.tsx` | nguồn của 8 thành phần |
| `apps/web/src/components/mini/<cùng tên>.tsx` + `.spec.tsx`, `index.ts` | bản web, export thêm vào `index.ts` |
| `apps/miniapp/src/pages/ds-gallery.tsx`, `ds-gallery.spec.tsx`, `ds-gallery-guard.spec.ts` | gallery Mini, route lazy chỉ ở dev |
| `apps/miniapp/src/components/app.tsx` | thêm `DsGalleryPage` + `<Route path="/ds-gallery">` bọc `import.meta.env.DEV` |
| `apps/web/src/app/ds-gallery/page.tsx`, `gallery.tsx`, `page.spec.tsx` | gallery web, `notFound()` khi production |
| `packages/app-core/src/route-map.json` | khối `lane: "ds"` một dòng `/ds-gallery` → `/ds-gallery` |

Quy ước bản chép: web là bản chép của Mini (đầu file `'use client'` + dòng `// Nguồn: apps/miniapp/src/components/ui/<tên>.tsx`), khác nhau chỉ ở: import (`@/lib/...`, `next/link`), `process.env.NODE_ENV` thay `import.meta.env.DEV`, `inert` (React 19 nhận boolean, React 18 phải truyền chuỗi rỗng), `Countdown` chờ mount mới đọc giờ (SSR không lệch), điều hướng (`next/link` thay `useNavigate` của zmp-ui).

Lệnh kiểm một file: Mini `cd apps/miniapp && npx vitest run src/components/ui/<tên>.spec.tsx`; web `cd apps/web && npx vitest run src/components/mini/<tên>.spec.tsx`; app-core `cd packages/app-core && npx vitest run src/commerce/<tên>.spec.ts`.

---

### Task 1: khoá chữ mới

**Files:** Modify `packages/app-core/src/shop-copy.ts`, `packages/app-core/src/shop-copy-budget.ts`.

**Interfaces:** Produces khoá (mẫu → max ký tự lúc điền xấu nhất): `section.seeAll` "Xem tất cả" → 10; `section.seeAllSpoken` "Xem tất cả {title}" → null; `sort.groupLabel` "Sắp xếp" → 10; `sort.filter` "Lọc" → 4; `sort.filterCount` "Lọc ({n})" → 8; `sort.filterSpoken` "Lọc, {n} bộ lọc đang bật" → null; `combo.badge` "Combo -{pct}%" → 12; `combo.setLabel` "Mua cả bộ" → 10; `combo.save` "Tiết kiệm {save}" → 18; `combo.addSpoken` "Thêm cả combo {title}, {n} món, {price}" → null; `combo.seeItems` "Xem từng món" → 12; `combo.itemsLabel` "Gồm {n} món" → 12; `combo.more` "+{n}" → 4. Dùng lại khoá có sẵn: `flash.*`, `coupon.*`, `campaign.*`, `time.*`, `combo.add`, `combo.total`.

- [ ] **Step 1:** chạy `npx vitest run src/shop-copy.spec.ts` trong `packages/app-core`, mong đợi PASS (baseline).
- [ ] **Step 2:** thêm một khối `// Bộ thành phần P5` ở cuối `SHOP_COPY` và `SHOP_COPY_MAX` (khối riêng để gộp tay khi merge không đụng dòng của gói khác), chạy lại spec, mong đợi PASS (spec tự bắt thiếu một bên, vượt `max`, thuật ngữ cấm).
- [ ] **Step 3: Commit** `feat(app-core): khoá chữ cho bộ thành phần section-kit`.

### Task 2: logic đồng hồ và banner ở app-core

**Files:** Create `commerce/countdown-tick.ts`, `commerce/countdown-tick.spec.ts`, `commerce/banner-autoplay.ts`, `commerce/banner-autoplay.spec.ts`.

**Interfaces:**
- Consumes: `countdownClock/Text/Spoken` (`commerce/countdown.ts`).
- Produces:
  ```ts
  export interface CountdownFrame { ms: number; ended: boolean; clock: string; text: string; spoken: string; minute: number }
  export function countdownFrame(endMs: number, now: number): CountdownFrame; // endMs NaN → ended
  export function countdownDelay(ms: number, mode: 'clock' | 'text'): number; // ms tới lần đổi chữ kế tiếp
  export function countdownClockParts(ms: number): { prefix: string | null; cells: string[] }; // "2 ngày 03:15" → { prefix: '2 ngày', cells: ['03','15'] }
  export const BANNER_MIN_INTERVAL_MS = 5000;
  export function bannerInterval(ms?: number): number; // thiếu/NaN → 5000; dưới 5000 → 5000
  export interface BannerAutoplayState { slideCount: number; userPaused: boolean; reducedMotion: boolean | null; hidden: boolean; held: boolean }
  export function bannerShouldAutoplay(s: BannerAutoplayState): boolean; // chỉ true khi slideCount>1 và không userPaused/hidden/held và reducedMotion===false (null = chưa biết → không chạy)
  export function bannerNextIndex(i: number, n: number): number; // vòng, kẹp i ngoài biên, n≤0 → 0
  ```

- [ ] **Step 1: Viết spec đỏ.** `countdownFrame(1000, 0)`: `ended=false`, `clock==='00:01'`; `countdownFrame(0,0).ended` và `NaN` đều `true` với `text===''`; `countdownFrame(7533000,0)` có `clock==='02:05:33'`, `text==='2 giờ 05 phút'`, `spoken==='2 giờ 5 phút'`, `minute===125`. `countdownDelay(2500,'clock')===500`, `(2000,'clock')===1000`, `(125000,'text')===5001`, `(120000,'text')===1`. `countdownClockParts(7533000)` là `{prefix:null,cells:['02','05','33']}`, `(333000)` là `['05','33']`, `(2*86400000+11700000)` là `{prefix:'2 ngày',cells:['03','15']}`, `(0)` là `{prefix:null,cells:['00','00']}`. `bannerInterval(undefined|NaN|1000)===5000`, `bannerInterval(7000)===7000`. `bannerShouldAutoplay` đúng ở ca đủ điều kiện và sai ở từng điều kiện đơn lẻ (1 slide, userPaused, hidden, held, reducedMotion true, reducedMotion null). `bannerNextIndex(2,3)===0`, `(0,0)===0`, `(9,3)===0`, `(-1,3)===0`.
- [ ] **Step 2:** chạy hai spec, mong đợi FAIL (module chưa có).
- [ ] **Step 3:** cài đặt hai file. `countdownDelay`: clock = `ms % 1000 || 1000`; text = `(ms % 60000) + 1`; `ms ≤ 0`/NaN → 1000. Hàm thuần, không đọc đồng hồ.
- [ ] **Step 4:** chạy lại, mong đợi PASS. **Step 5: Commit** `feat(app-core): nhịp đếm ngược và luật tự chạy banner`.

### Task 3: `Countdown`

**Files:** Create `ui/countdown.tsx`, `ui/countdown.spec.tsx` (Mini); `mini/countdown.tsx`, `mini/countdown.spec.tsx` (web); export trong `mini/index.ts`.

**Interfaces:**
- Consumes: `countdownFrame`, `countdownDelay`, `countdownClockParts`, `serverNow` (`@tubutree/app-core/server-clock`), `fillCopy('flash.endsIn'|'flash.startsIn')`.
- Produces: `export interface CountdownProps { endAt: string; mode: 'clock' | 'text'; onEnd?: () => void; kind?: 'ends' | 'starts' }` và `export function Countdown(p: CountdownProps)`. Vỏ ngoài `role="timer"`; `aria-label` = `flash.endsIn`/`flash.startsIn` điền `countdownFrame(...).spoken`, chỉ đổi khi `minute` đổi; chữ nhìn thấy `aria-hidden`; không `aria-live`. `clock`: ô số 22×20 (`--radius-tag`, nền `--color-countdown-bg`, chữ `--color-countdown-fg`, 12/700 tabular-nums) và dấu ":" màu `--color-flash-fg`; ngày thì chữ "2 ngày" đứng trước ô. `text`: chữ `flash.endsIn` điền `text`, màu `--color-flash-fg`, caption. Hết giờ: vỏ vẫn có trong cây, `aria-hidden`, ẩn bằng `visibility:hidden` (không hiện 00:00).

- [ ] **Step 1: Viết spec đỏ** (`vi.useFakeTimers()`, `vi.setSystemTime`): (a) `endAt = now+7533000`, mode clock: thấy "02:05:33"; `advanceTimersByTime(1000)` → "02:05:32"; `aria-label` là "Kết thúc sau 2 giờ 5 phút" và vẫn thế sau 10 giây, đổi thành "Kết thúc sau 2 giờ 4 phút" sau 34 giây. (b) mode text: "Kết thúc sau 2 giờ 05 phút", `aria-label` giống (a), không có ô số. (c) `kind="starts"` → "Bắt đầu sau …". (d) `onEnd` gọi đúng 1 lần khi tới `endAt`, không gọi lại sau khi chạy thêm timer và sau `rerender` với hàm `onEnd` khác; vỏ có `aria-hidden="true"` và không còn chữ số. (e) `endAt` đã qua lúc mount: không văn bản, `onEnd` gọi 1 lần; `endAt='rác'`: không "NaN", không ném lỗi, coi như đã hết. (f) `rerender` với `endAt` mới (còn hạn) → hiện lại và `onEnd` của mốc mới vẫn gọi được 1 lần. (g) gỡ component thì không còn timer (`vi.getTimerCount()===0`). (h) ngày: `endAt=now+2d+3h15m` hiện "2 ngày" + ô "03","15".
- [ ] **Step 2:** chạy, mong đợi FAIL.
- [ ] **Step 3: Cài đặt Mini.** Một `setTimeout` nối tiếp theo `countdownDelay` (không `setInterval` mỗi component); `onEnd` giữ qua `useRef` (đổi hàm không chạy lại effect); cờ đã gọi đặt lại khi `endAt` đổi. Bản web: chỉ đọc giờ sau mount (render đầu là khung giữ chỗ "00:00:00" ẩn, như mẫu `key={afterMount}` của `home/flash-sale.tsx`), spec web thêm ca "render đầu không có chữ số".
- [ ] **Step 4:** chạy spec Mini và web, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(ui): Countdown (đồng hồ ô số và chữ theo phút) ở Mini và web`.

### Task 4: `FlashSoldBar`

**Files:** Create `ui/flash-sold-bar.tsx` + spec (Mini); `mini/flash-sold-bar.tsx` + spec (web); export.

**Interfaces:** Consumes `flashSoldText(pct, soldOut)`. Produces `export interface FlashSoldBarProps { soldPct: number; soldOut?: boolean }`, `export function FlashSoldBar(p)`. Cao 16, bo pill, rãnh `--color-flash-bg`, phần đã bán `--color-flash-solid-bg`, chữ 12/600 `--color-flash-solid-fg` (stone-900) ở giữa; hết suất: rãnh `--color-track`, không cam, chữ `--color-text-secondary`. Thanh `aria-hidden`; chữ luôn hiện và không `aria-hidden`; phần đã bán dựng bằng `transform: scaleX(p)` (chạy 600ms lúc vào màn, `--p-ease-out`).

- [ ] **Step 1: Viết spec đỏ:** với `soldPct` 0, 35, 68, 92 và `soldOut`: chữ lần lượt "Vừa mở bán", "Đã bán 35%", "Đã bán 68%", "Sắp hết", "Đã bán hết"; thanh (`[data-testid="flash-sold-track"]`) có `aria-hidden="true"` và chữ nằm ngoài nó; `data-testid="flash-sold-fill"` có `transform: scaleX(0.68)` ở 68; `soldPct` NaN/-5/180 → scale 0/0/1 và chữ vẫn có; `soldOut` ép scale 1 hoặc ẩn phần cam (`data-state="soldout"`) và chữ "Đã bán hết" kể cả `soldPct=10`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini rồi chép sang web. **Step 4:** PASS cả hai.
- [ ] **Step 5: Commit** `feat(ui): FlashSoldBar có chữ ở mọi mức`.

### Task 5: `SectionHeader` và `Section`

**Files:** Create `ui/section-header.tsx`, `ui/section.tsx` + specs (Mini); `mini/section-header.tsx`, `mini/section.tsx` + specs (web); export.

**Interfaces:**
- Consumes `fillCopy('section.seeAll'|'section.seeAllSpoken')`; Mini `useNavigate` của zmp-ui + `haptic('light')`, web `next/link`.
- Produces:
  ```ts
  export type IconName = 'zap' | 'flame' | 'tag' | 'sparkles' | 'ticket' | 'gift';
  export interface SectionHeaderProps { title: string; id?: string; icon?: IconName | LucideIcon; tone?: 'default' | 'promo'; trailing?: ReactNode; action?: { label?: string; to: string }; subtitle?: string; as?: 'h2' | 'h3' }
  export function SectionHeader(p: SectionHeaderProps): JSX.Element
  export interface SectionProps { id: string; spacing?: 'block' | 'section'; label?: string; children: ReactNode }
  export function Section(p: SectionProps): JSX.Element
  ```
  Hàng cao `--section-header-h` (44); tiêu đề Inter `--type-title-sm-*` nhưng nét 700 và `letter-spacing: -0.01em`, một dòng cắt "…"; `tone="promo"` chữ `--color-promo-fg`, icon tô đặc `--color-flash-solid-bg`. Hành động: `action.label ?? 'Xem tất cả'` + ChevronRight, vùng chạm cả chiều cao hàng, tên truy cập `section.seeAllSpoken` điền `title` (tên đọc dùng `label` nếu có chữ khác "Xem tất cả"). `Section` là `<section id>` có `margin-top: var(--space-block)` (block) hoặc `var(--space-section)` (section); `label` thành `aria-label`; không đệm trên/dưới cho con.

- [ ] **Step 1: Viết spec đỏ:** tiêu đề là `h2` (đổi `as="h3"` được) và nét 700; có `icon="zap"` thì có svg `aria-hidden`; `tone="promo"` đổi màu chữ sang `var(--color-promo-fg)`; `trailing` hiện sau tiêu đề; không `action` thì không nút; có `action` thì nút tên "Xem tất cả Giờ vàng" (Mini: bấm gọi `navigate('/flash-sale')` đúng một lần; web: là `<a href>`); `subtitle` hiện caption một dòng; tiêu đề dài có `text-overflow: ellipsis` và nút xem tất cả không bị đẩy ra ngoài (`flex: 0 0 auto`); `Section`: `spacing` mặc định `block` → `marginTop` `var(--space-block)`, `section` → `var(--space-section)`; `label` thành `aria-label`; không có `label` thì không `aria-label`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini, chép sang web đổi điều hướng. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ui): SectionHeader và Section (nhịp khối thống nhất)`.

### Task 6: `SortBar`

**Files:** Create `ui/sort-bar.tsx` + spec (Mini); `mini/sort-bar.tsx` + spec (web); export.

**Interfaces:** Consumes `fillCopy('sort.groupLabel'|'sort.filter'|'sort.filterCount'|'sort.filterSpoken')`. Produces:
```ts
export interface SortOption { value: string; label: string; spoken?: string }
export interface SortBarProps { value: string; options: SortOption[]; onChange: (v: string) => void; filterCount?: number; onFilter?: () => void; sticky?: boolean }
export function SortBar(p: SortBarProps): JSX.Element | null
```
Một hàng cao 44: nhóm `role="group"` tên "Sắp xếp" chứa các nút `aria-pressed`; mục chọn có gạch chân 2px `--color-border-selected` và chữ `--color-text-brand`, còn lại `--color-text-secondary`, nét 600, cỡ `--type-body-sm-size`; `spoken` thành `aria-label` của nút. Nút "Lọc" (icon SlidersHorizontal) chỉ vẽ khi có `onFilter`, hiện "Lọc ({n})" khi `filterCount>0`, `aria-label` = `sort.filterSpoken`. `sticky`: `position: sticky; top: var(--sort-bar-top, 0px); z-index` thấp hơn header, nền surface. Bấm bất kỳ tab nào, kể cả tab đang chọn, gọi `onChange(value)`. `options` rỗng và không `onFilter` → `null`.

- [ ] **Step 1: Viết spec đỏ:** 4 option → 4 nút, nút của `value` có `aria-pressed="true"` còn lại `false`; bấm "Bán chạy" gọi `onChange('best')` một lần; bấm lại tab đang chọn vẫn gọi; `value` ngoài `options` → không nút nào pressed, không lỗi; `spoken` thành `aria-label`; `filterCount=2` + `onFilter` → nút "Lọc (2)" tên đọc "Lọc, 2 bộ lọc đang bật", bấm gọi `onFilter`; `filterCount` 0, -1, thiếu → chữ "Lọc", không "(0)" và không `aria-label` đếm; không `onFilter` → không nút Lọc; `options=[]` + không `onFilter` → render rỗng; `sticky` → `position: sticky`; mọi nút có `minHeight: 44` hoặc lớp `tubu-hit-44`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini, chép sang web. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ui): SortBar một hàng dính, có đếm bộ lọc`.

### Task 7: `VoucherTicket`

**Files:** Create `ui/voucher-ticket.tsx` + spec (Mini); `mini/voucher-ticket.tsx` + spec (web); export.

**Interfaces:** Consumes `VoucherView` (`commerce/voucher.ts`), `fillCopy('coupon.used'|'coupon.expired'|'coupon.outOfQuota')`. Produces:
```ts
export interface VoucherTicketProps {
  voucher: VoucherView; variant: 'ticket' | 'chip' | 'row';
  primary?: { label: string; onClick: () => void; busy?: boolean };
  onDetail?: () => void;
  reason?: string;      // lý do ineligible: "Mua thêm 50k để dùng"
  expiring?: boolean;   // chữ hạn dùng tông warning
}
export function VoucherTicket(p: VoucherTicketProps): JSX.Element
```
Vỏ `role="group"` `aria-label` = `voucher.title`. `ticket` (~88px): cuống trái 72px theo `kind` (discount: `--color-voucher-stub-*` icon Tag; freeship: `--color-voucher-ship-*` icon Truck; shop: `--color-voucher-shop-stub-*` icon Store; icon `aria-hidden`), răng cưa hai bên bằng `mask: radial-gradient`, vạch đứt `--color-voucher-edge`; phần phải: tiêu đề 700, dòng `condition · code` (bỏ phần rỗng), dòng hạn (`expiring` → `--color-status-warning-fg`), một nút `primary` cỡ sm. `chip` (cao tối thiểu 44, nền `--color-voucher-bg`, viền đứt, label 12/700, chỉ tiêu đề + condition một dòng). `row` (cao tối thiểu 56, không cuống, đường kẻ dưới). Thân (tiêu đề, điều kiện, hạn) là nút khi có `onDetail` (anh em của nút `primary`, không lồng). `used`/`expired`/`soldout`: cuống `--color-bg-chip`, chữ `--color-text-disabled`, dấu chữ ("Đã dùng"/"Đã hết hạn"/"Đã hết lượt"), không vẽ `primary`. `ineligible`: nút `aria-disabled="true"`, `aria-describedby` trỏ dòng `reason` (hoặc `condition`), `onClick` không chạy. `busy`: `aria-disabled` + `aria-busy`, `onClick` không chạy.

- [ ] **Step 1: Viết spec đỏ:** sáu trạng thái × `ticket` với `primary` truyền vào: `collectable`/`saved` có đúng 1 nút (bấm gọi `onClick` 1 lần); `used`, `expired`, `soldout` không có nút nào và có dấu chữ tương ứng; `ineligible` có nút `aria-disabled="true"` mô tả bằng `reason`, bấm không gọi; `busy` bấm hai lần không gọi; `condition=''` và `expiry=''` → không phần tử dòng rỗng (số dòng chữ giảm); tiêu đề rất dài vẫn còn nút (`min-width: 0` ở thân, nút `flex: 0 0 auto`); `onDetail` bấm thân gọi `onDetail` và không gọi `primary`; ba `kind` dùng đúng biến màu cuống (đọc `style`); `chip` và `row` render, `chip` cao ≥44; mọi nút có vùng chạm 44 (`minHeight: 44` hoặc `tubu-hit-44`); không phần tử bấm được lồng nhau (`button button` không tồn tại).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini, chép sang web. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ui): VoucherTicket ba biến thể, sáu trạng thái`.

### Task 8: `ComboCard`

**Files:** Create `ui/combo-card.tsx` + spec (Mini); `mini/combo-card.tsx` + spec (web); export.

**Interfaces:** Consumes `ProductCardView` (`commerce/product-card-view.ts`), `vnd` (`commerce/money.ts`), `PriceTag` (sẵn có, chỉ `value/compareAt/size`; P4 đang đổi file đó nên không truyền prop mới), `ProductThumb`, `Button`, `Badge`. Produces:
```ts
export type ComboCardItem = ProductCardView & { thumbnail?: string | null }; // ProductCardView chưa có ảnh; P4 thêm thì giao nhau vẫn đúng
export interface ComboCardProps { title: string; items: ComboCardItem[]; pct: number; total: number; comboTotal: number; onAddAll: () => void; busy?: boolean; onSeeItems?: () => void }
export function ComboCard(p: ComboCardProps): JSX.Element | null
```
`Card` có viền: hàng đầu `title` + `Badge tone="promo"` "Combo -{pct}%"; dải ảnh 56px, dấu "+" giữa các ảnh, tối đa 3 ảnh, món thứ 4 trở đi gộp thành ô "+n"; danh sách `<ul aria-label="Gồm n món">` mỗi `<li>` ảnh nhỏ + tên (cắt 2 dòng), món `stock==='out'` mờ kèm `stockText`; dòng "Mua cả bộ" + `PriceTag value=comboTotal compareAt=total size=md`; "Tiết kiệm {x}" chữ `--color-text-price-deal` chỉ khi `total>comboTotal`; nút primary full "Thêm cả combo" với `aria-label` = `combo.addSpoken`; `onSeeItems` thì có nút phụ "Xem từng món". Tiền lấy từ props, không tự tính ngoài `total - comboTotal`. `items=[]` → `null`.

- [ ] **Step 1: Viết spec đỏ:** 3 món, `pct=10`, `total=374000`, `comboTotal=337300`: có "Combo -10%", "Tiết kiệm 36.700đ", nút "Thêm cả combo" có tên đọc "Thêm cả combo {title}, 3 món, 337.300đ", bấm gọi `onAddAll` 1 lần; 5 món → đúng 3 ảnh + ô "+2" mà vẫn đủ 5 `<li>`; `comboTotal >= total` → không có chữ "Tiết kiệm" (không "0đ", không số âm) và vẫn có nút; `items=[]` → render rỗng; `busy` → nút `aria-disabled="true"` `aria-busy`, bấm hai lần không gọi; món `stock:'out'` hiện "Tạm hết hàng"; `onSeeItems` thiếu → không nút "Xem từng món", có → bấm gọi; không dùng `ProductTile` (spec đọc nguồn file, không chứa `product-tile`).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini, chép sang web. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ui): ComboCard mua cả bộ`.

### Task 9: `BannerCarousel`

**Files:** Create `ui/banner-carousel.tsx` + spec (Mini); `mini/banner-carousel.tsx` + spec (web); export.

**Interfaces:** Consumes `bannerInterval`, `bannerShouldAutoplay`, `bannerNextIndex` (Task 2), `fillCopy('campaign.carouselLabel'|'campaign.slideLabel'|'campaign.dot'|'campaign.pause')`. Produces:
```ts
export interface BannerSlide { id: string; image: string; alt: string; href: string }
export interface BannerCarouselProps { slides: BannerSlide[]; intervalMs?: number }
export function BannerCarousel(p: BannerCarouselProps): JSX.Element | null
```
`<section aria-roledescription="carousel" aria-label="Chương trình nổi bật">`. Trong DOM nút Dừng đứng trước các slide: 44×44 (`tubu-hit-44-square`), icon Pause/Play, tên cố định `campaign.pause`, `aria-pressed` = đã dừng. Rãnh cuộn `scroll-snap-x mandatory`; slide `role="group" aria-roledescription="slide"` `aria-label` = `campaign.slideLabel` (`title=alt`, `i`, `n`); slide ngoài khung có `inert`; cả slide là một liên kết (`<a>`; Mini `navigate(href)`, web `next/link`) tên là `alt`; ảnh tỉ lệ `var(--banner-ratio)`, `--radius-media`, slide đầu tải ngay, còn lại `loading="lazy"`. Chấm là nút 44×44 (hình 6px) tên `campaign.dot`, `aria-current` ở chấm hiện tại. Vùng `aria-live="off"` khi đang tự chạy, `"polite"` khi không. Tự chạy theo `bannerShouldAutoplay` với `reducedMotion` đọc `matchMedia('(prefers-reduced-motion: reduce)')` (thiếu `matchMedia` → `null` → không chạy) và nghe thay đổi, `hidden` theo `visibilitychange`, `held` khi focus hoặc chạm/chuột nằm trong banner. 0 slide → `null`; 1 slide → không chấm, không nút Dừng, không tự chạy. Chỉ số kẹp khi `slides` co lại.

- [ ] **Step 1: Viết spec đỏ** (fake timers, `window.matchMedia` giả bật/tắt): (a) 3 slide, không giảm chuyển động: sau 5000ms chấm thứ 2 có `aria-current`, slide 1 có `inert`, slide 2 không; (b) `intervalMs=1000` vẫn chờ ≥5000ms mới chuyển; (c) `matchMedia` báo reduce → sau 20 giây vẫn ở slide 1; `matchMedia` thiếu → không chạy; (d) nút Dừng có `aria-pressed="false"`, bấm → `"true"` và không chuyển nữa, bấm lại → chạy tiếp; nút Dừng đứng trước slide đầu trong DOM; (e) `focus` vào liên kết trong banner → dừng, `blur` ra → chạy lại; `touchstart` giữ, `touchend` thả; (f) `document.visibilityState='hidden'` + `visibilitychange` → dừng, hiện lại → chạy; (g) 1 slide: không chấm, không nút Dừng, không chuyển; 0 slide: render rỗng; (h) `slides` co từ 3 xuống 2 khi đang ở slide 3 → chỉ số về slide hợp lệ, không lỗi; (i) tên slide "alt, 1 trên 3"; `aria-live` `off` khi chạy và `polite` khi đã dừng; (j) bấm chấm 3 → `aria-current` ở chấm 3; (k) slide là `<a>` tên theo `alt`, bấm gọi điều hướng với `href`.
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt Mini (`inert` truyền `{ inert: '' }`), web (`inert={bool}`, `next/link`). Cuộn bằng `el.scrollTo?.()` (jsdom không có), chỉ số do `onScroll` làm tròn `scrollLeft / clientWidth` (bỏ qua khi `clientWidth=0`). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(ui): BannerCarousel (nút dừng, giảm chuyển động, inert, ≥5s)`.

### Task 10: gallery `/ds-gallery`

**Files:** Create `commerce/ds-gallery-data.ts` + `.spec.ts` (app-core); `apps/miniapp/src/pages/ds-gallery.tsx`, `ds-gallery.spec.tsx`, `ds-gallery-guard.spec.ts`; `apps/web/src/app/ds-gallery/{page.tsx,gallery.tsx,page.spec.tsx}`. Modify `apps/miniapp/src/components/app.tsx`, `packages/app-core/src/route-map.json`.

**Interfaces:** Produces `ds-gallery-data.ts`: `GALLERY_NOW: number` (mốc cố định), `galleryEnd(offsetMs: number): string` (ISO), `GALLERY_SLIDES: BannerSlide-like[]` (ảnh data-URI SVG, không mạng), `GALLERY_VOUCHERS: { id: string; view: VoucherView; expiring?: boolean; reason?: string }[]` (đủ 3 `kind` và 6 `state`, tạo bằng `voucherView`), `GALLERY_COMBO_ITEMS: ProductCardView[]` (5 món tạo bằng `productCardView`, có món hết hàng, tên dài có dấu, không ảnh), `GALLERY_SORT_OPTIONS`. Gallery vẽ mỗi thành phần một `Section` có `id="ds-<tên>"` và nhãn từng biến thể/trạng thái, dữ liệu từ file này (cả hai app giống nhau để so số đo 375px).

- [ ] **Step 1: Viết test đỏ:** app-core `ds-gallery-data.spec.ts` (đủ 3 kind, 6 state, ít nhất 1 món `stock==='out'`, `GALLERY_SLIDES.length>=3`, không URL `http`); Mini `ds-gallery.spec.tsx` (render trong `MemoryRouter`: có 8 mục `#ds-section-header`, `#ds-section`, `#ds-countdown`, `#ds-flash-sold-bar`, `#ds-sort-bar`, `#ds-voucher-ticket`, `#ds-combo-card`, `#ds-banner-carousel`; mỗi mục có ≥2 biến thể/trạng thái); `ds-gallery-guard.spec.ts` (đọc `app.tsx`: mọi `import(...pages/ds-gallery...)` nằm trong biểu thức có `import.meta.env.DEV`, và `<Route path="/ds-gallery"` nằm sau `import.meta.env.DEV &&`); web `page.spec.tsx` (`NODE_ENV='test'`: render đủ 8 mục; `vi.stubEnv('NODE_ENV','production')`: gọi page ném `NEXT_NOT_FOUND`).
- [ ] **Step 2:** FAIL. **Step 3:** cài đặt dữ liệu, gallery hai app (web: `page.tsx` server gọi `notFound()` khi production rồi render `gallery.tsx` client trong khung `max-width: 480px` căn giữa, đệm đáy chừa `BottomNav`), thêm `DsGalleryPage` lazy + Route vào `app.tsx`, thêm khối `{ "lane": "ds", "items": [{ "miniapp": "/ds-gallery", "web": "/ds-gallery", "private": false }] }` vào `route-map.json`. **Step 4:** chạy bốn spec và `pnpm lint:parity`, mong đợi PASS.
- [ ] **Step 5: Commit** `feat(ds): trang /ds-gallery chỉ ở bản dev, vẽ mọi biến thể section-kit`.

### Task 11: kiểm bundle, chụp 375px, gate

- [ ] **Step 1: Bundle.** Đo entry Mini ở base (`git worktree` tạm tại `f299f8dcf`, hoặc số trong `plans/handoff-wave1.md`) và sau gói: `cd apps/miniapp && VITE_API_BASE_URL=https://api.tubutree.com/api npx vite build` rồi `node scripts/ci/bundle-budget.cjs apps/miniapp/www`. Mong đợi: entry không đổi (±0 KB) và không có chunk `ds-gallery` trong `www/assets`. Ghi số vào notes.
- [ ] **Step 2: Chụp.** Playwright, host `localhost`: Mini `npx vite --host localhost --port 3293` (`/#/ds-gallery`), web `npx next dev -H localhost -p 3294` (`/ds-gallery`), viewport 375×812; chụp từng mục `#ds-*` hai bên, lưu `docs/2026-10-31-shop-redesign/screens/P5/{miniapp,web}-<mục>.png`; so hai bản bằng mắt và bằng `getComputedStyle` (chiều cao hàng tiêu đề, ô số Countdown, nút SortBar, vé 88px); sửa lệch; tắt hai server của mình.
- [ ] **Step 3: Gate đúng một lần:** `bash docs/2026-10-28-review/tools/gate.sh /Users/longla/coding/tubutree-mini-app/.claude/worktrees/shop-P5 --base f299f8dcf --out /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-P5.txt`. Bước FAIL: so với base (chạy riêng bước đó ở worktree tạm); có sẵn thì ghi "có sẵn", do gói thì sửa tới PASS.
- [ ] **Step 4: Commit** nếu có sửa; ghi PROGRESS không thuộc gói này.

---

## Tự kiểm (đã làm khi viết)

- Phủ spec: 8 thành phần (Task 3–9), gallery + route lazy dev + `notFound()` prod (Task 10), kiểm entry (Task 11), chữ qua `SHOP_COPY` (Task 1), a11y mục B (B1 Task 9, B3 Task 4, B4 Task 3, B6 Task 7, B7 Task 8). Không thay chỗ gọi, không đụng file P4.
- Tên khớp giữa task: `countdownFrame/countdownDelay/countdownClockParts`, `bannerInterval/bannerShouldAutoplay/bannerNextIndex`, `ComboCardItem`, `GALLERY_*` dùng nhất quán.
- Rủi ro đã biết: `ProductCardView` không có ảnh (ComboCard thêm `thumbnail?`); `PriceTag` chưa có `tone="deal"` (P4) nên giá combo dùng mặc định, "Tiết kiệm" mới mang màu deal; `IconName` là bảng 6 icon nhỏ để không phình entry khi `SectionHeader` vào Trang chủ (P6), icon khác truyền thẳng `LucideIcon`.

## Ghi nhận khi làm

- Entry Mini (vite build, `bundle-budget.cjs`): base `f299f8dcf` 676 KB raw / 212 KB gzip, sau gói 676 KB / 212 KB (±0), tổng 2024 KB cả hai; không có chunk hay chuỗi `ds-gallery` trong `www/`. Đo "trước" bằng cách đưa tạm `shop-copy.ts` và `app.tsx` về base rồi build, sau đó khôi phục.
- Chụp 375px (`docs/2026-10-31-shop-redesign/screens/P5/{miniapp,web}-<mục>.png`, thư mục này nằm trong `.gitignore` nên không vào commit). Số đo từng biến thể bằng Playwright: hai app khớp, trừ ≤1,9px chiều rộng chữ do `body` của web bật `font-feature-settings: 'cv02','cv03','cv04','cv11'` (tắt đi thì rộng bằng Mini).
- Sửa sau khi so ảnh: `SortBar` (4 tab + Lọc không vừa 343px, tab cuối bị che hẳn) nay mờ mép bằng `tubu-scroll-fade` và cuộn ngang tab đang chọn vào khung (không dùng `scrollIntoView` vì nó kéo cả trang); `ComboCard` không còn thừa hưởng cỡ chữ thân trang (Mini 15px, web 16px) làm lệch 1,5px.
- Gallery Mini mở bằng `/ds-gallery` (đường dẫn, không phải `/#/ds-gallery`) trên Vite dev.
- Gate (`gate-P5.txt`, một lần): 4 FAIL. Do gói và đã sửa: `ds-no-legacy-aliases.spec` (Mini, hai lượt TZ) bắt `#000` thô trong mask vé; `css.spec` (web) bắt `--sort-bar-top` chưa khai báo. Có sẵn từ base: `track-cron.spec` của API (flaky khi tải nặng, gói không đụng `apps/api`; chạy riêng thì 54/54 xanh). Các bước còn lại PASS, entry Mini 676/212 KB.

## Sửa sau review (đợt 2)

- MAJOR `/ds-gallery` vào sitemap: `apps/web/src/lib/route-map.ts` bỏ lane `ds` (DEV_ONLY_LANES) khỏi `publicStaticRoutes` và `publicAllowPaths`; route vẫn có trong bản đồ để `lint:parity` và `isWebRouteReady` thấy. Test: `route-map.spec` (bản đồ thật + bản đồ giả) và `sitemap.spec` (dùng `publicStaticRoutes` thật, không có `ds-gallery`).
- MAJOR SortBar tràn 343px: đệm ngang 12px xuống 8px, tab `flex: 1 0 auto` (dãn khi còn chỗ, không co), nút Lọc đệm 8px; gallery dùng đúng nhãn BR-01 (Phổ biến · Bán chạy · Mới · Giá ⇅). Đo Playwright 375px (hai app như nhau): cạnh phải tab cuối = 359 = cạnh phải hàng, không tràn, ở cả ba biến thể (`Lọc (3)`, `Lọc`, không Lọc). Hàng vẫn cuộn + mờ mép khi nhãn dài hơn (màn 320px, chữ lớn).
- MINOR ComboCard: nhãn "Combo -n%" chỉ hiện khi `pct > 0` và `total > comboTotal`.
- MINOR BannerCarousel: focus dời từ liên kết/chấm sang nút Dừng hạ cờ `focused` (onBlurCapture kiểm `relatedTarget` là nút Dừng); thêm spec link → Dừng → bấm hai lần → chạy lại sau 5 giây, và chấm → liên kết vẫn giữ.
- MINOR Countdown web: khung giữ chỗ text là nhãn ẩn "Kết thúc/Bắt đầu sau ?? giờ ?? phút" bằng dấu cách số U+2007 (không chữ số nên hydrate không lệch). Phần còn lại, không sửa: khung clock vẫn ba ô. Giờ còn lại chưa biết khi dựng HTML (ISR có thể trả sau hàng giờ) và render đầu phải giống hệt máy chủ, nên không có cách tất định chọn 2 hay 3 ô; khung ẩn (`visibility: hidden`) nên không có gì nhìn thấy nhảy, chỉ phần tử kề bên linh hoạt mới xê dịch ≤25px khi còn dưới 1 giờ. Comment ở nguồn đã nói đúng việc khung làm.
- MINOR VoucherTicket: chip chỉ còn tiêu đề + điều kiện; ticket/row không cắt dòng meta nữa mà cho xuống dòng, mã là khối `nowrap` không bị ngắt (làm khác lời gợi ý "cắt điều kiện": cắt giữa số thành "Đơn từ 50…" đọc nhầm 50k thay vì 500k, đo trên web thấy đúng ca đó). Ca CHUADU ở gallery cả hai app: điều kiện một dòng, mã dòng hai, meta cao 40px (hai app khớp).

## Sửa sau review (đợt 3)

- MAJOR ComboCard có món `stock==='out'`: nút "Thêm cả combo" thành "Combo tạm hết" (`combo.soldOut`, ngân sách 13, có ở `SHOP_COPY` và `SHOP_COPY_MAX`), `aria-disabled="true"` nhưng vẫn là nút Tab tới được (như VoucherTicket ineligible), không truyền `onPress` nên bấm không gọi `onAddAll`; `busy` không che nhãn ở trạng thái này; bỏ dòng "Tiết kiệm" (khoản tiết kiệm không mua được vì `POST /cart/items/batch` từ chối cả lô). Nhãn "Combo -n%" giữ nguyên (mô tả luật combo, không phải khoản tiết kiệm). "Xem từng món" vẫn có. Spec Mini + web: có món hết → nút "Combo tạm hết", bấm hai lần không gọi, không "Tiết kiệm"; busy + hết vẫn đọc "Combo tạm hết"; "Xem từng món" dùng được; đủ hàng thì không `aria-disabled`. Biến thể 5 món của gallery đã có sẵn món hết nên nay vẽ trạng thái này, không thêm dữ liệu.
- MINOR VoucherTicket ineligible không có `reason`: không vẽ dòng lý do lặp điều kiện; nút `aria-describedby` trỏ dòng meta (đã có `id`), có `reason` thì vẫn trỏ dòng lý do. Spec hai app (ticket + row: điều kiện chỉ xuất hiện một lần, không `voucher-reason`).
- MINOR tham quan ảnh: `apps/e2e/tests/support/tour.ts` bỏ lane `ds` (DEV_ONLY_LANES) khỏi `routeMapItems()`, nên `/ds-gallery` không còn làm `visual-tour.{miniapp,web}` ném "thiếu cấu hình". Còn một chỗ vỡ có sẵn từ base: `/offers` có trong `route-map.json` mà `TOUR` chưa có mục, spec tham quan vẫn đỏ ở bước thu thập khi đặt `VISUAL_DIR` cho tới khi ai đó thêm `TOUR['/offers']` (không thuộc P5, không sửa).
- MINOR để lại cho gói sau: giá combo trong ComboCard (`PriceTag value=comboTotal compareAt=total`) đang đen vì `PriceTag` chưa có `tone="deal"` (P4 đang thêm, không đụng file đó ở gói này). Khi P4 vào: ở `ComboCard` truyền `tone="deal"` khi `saving > 0` (cả `apps/miniapp/src/components/ui/combo-card.tsx` và `apps/web/src/components/mini/combo-card.tsx`), do bước gộp hoặc P9 làm; Q2 yêu cầu giá giảm dùng `--color-text-price-deal`.
