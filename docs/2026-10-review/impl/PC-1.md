# PC-1 — Nền DS v2 + a11y component

## Mục 1/2 — C-023, C-089, C-075, C-114 (token tương phản, font weight, viewport, main/h1)

Trạng thái: C-023 XONG, C-089 XONG, C-075 XONG, C-114 MỘT PHẦN (landmark `<main>` xong cho mọi route; `<h1>` còn thiếu ở các trang chưa dùng `PageHeader`, thuộc `pages/**`).
Chưa chạy axe/Playwright (quy định RAM): tỉ lệ tương phản được tính bằng test WCAG ngay trong vitest, không phải đo từ ảnh chụp.

### C-023 — tương phản chữ và CTA cam (XONG)

| Nơi | Trước | Sau | Tỉ lệ (WCAG 1.4.3) |
|---|---|---|---|
| `packages/design-tokens/src/tokens.css` `--color-text-disabled` | stone-400 `#9E978A` | stone-500 `#746D61` | trắng 2,90 → 5,12; stone-50 2,64 → 4,66; forest-50 2,60 → 4,59; sage-50 2,63 → 4,64 |
| `apps/miniapp/src/css/tokens.css` alias `--neutral-400` | stone-400 | stone-500 | như trên (189/195 chỗ dùng là `color:` chữ phụ) |
| `apps/web/tailwind.config.ts` `primary-600` (CTA cam) | `#E08C1C` | `#A35A0B` | trắng 2,65 → 5,22; chữ cam trên `#FAFAF8` 2,53 → 4,99 |
| `primary-700` (hover / chữ trên nền cam nhạt) | `#B86A10` (4,11) | `#8F4F08` | trắng 6,38; trên primary-100 5,17 |
| `neutral-400` web | `#A8A8A0` | `#6B6B64` | trắng 2,39 → 5,37; neutral-100 `#F2F2EF` 4,79 |
| `green-600` / `green-700` web (nút xác nhận) | `#16A34A` / `#15803D` | `#15803D` / `#166534` | trắng 3,30 → 5,02 / 7,13 |

- Nút bị khoá thật vẫn dùng `--color-action-primary-fg-disabled` (stone-400, WCAG miễn trừ nút vô hiệu); test giữ nguyên điều đó.
- Cam logo `--tubu-orange` giữ nguyên (chỉ cho logo/minh hoạ).
- Ngoài nhóm file của gói, buộc phải sửa (lý do): `apps/web/tailwind.config.ts` (+ spec) vì CTA web lấy màu từ khối palette v1 tạm thời ở đây chứ không từ `packages/design-tokens`; `apps/miniapp/src/css/tokens.css` một dòng alias vì ~190 chỗ dùng cũ (`color: var(--neutral-400)`) là nguồn chính của 131 nút axe mà token mới không phủ được. Hai commit web (`ff7501e`, `fb33592`) và commit alias (`2a20e28`) độc lập nên điều phối viên có thể bỏ riêng nếu gói PC-7/PC-10 xung đột.
- Test (đỏ → xanh):
  - `packages/design-tokens/src/tokens.spec.ts`: 5 token chữ × 3 nền + forest-50 (đỏ 4 ca: 2,64/2,63/2,60 trước khi sửa).
  - `apps/web/tailwind.config.spec.ts`: 5 ca tương phản (đỏ: 2,65 / 4,11 / 2,39 / thiếu `green`).
  - `apps/miniapp/src/ds-legacy-alias-contrast.spec.ts`: alias `--neutral-400` × 5 nền (đỏ 5/5, 2,6:1).
- Đã rà: không còn hex `#E08C1C`/`#B86A10` cứng trong `apps/web/src/**`, và không còn chỗ nào dùng `--stone-400` trực tiếp trong `apps/miniapp/src`/`apps/web/src` ngoài dòng alias đã sửa.
- Chưa kiểm chứng bằng axe thật: các trang dùng màu cứng/`rgba` khác hoặc chữ trên ảnh; cần chạy `node scripts/uiux/capture.mjs ... && build-report-data.mjs contrast miniapp|web` khi có máy chạy Playwright.

### C-089 — nạp Inter 600/700 (XONG)

- Thêm `packages/design-tokens/src/fonts/inter-600.woff2` (27,1 KB) và `inter-700.woff2` (27,0 KB) + hai `@font-face` trong `fonts.css`.
- Nguồn: Inter 4.001 static từ `inter-ui@4.1.0` (OFL-1.1), cắt đúng 294 mã ký tự (latin + vietnamese) của `inter-400.woff2` đang chạy, giữ đủ tính năng OpenType (cv02/03/04/11 mà `apps/web/globals.css` bật, tnum). Dựng lại 400 bằng đúng quy trình cho 810 glyph và độ rộng glyph trùng 100% với file đang chạy, nên 600/700 đồng bộ với 400/500.
- Test: `fonts.spec.ts` thêm 2 ca (Inter khai báo đủ 400/500/600/700 trỏ file tồn tại; mọi `--type-*-weight` ngoài display đều có `@font-face`). Đỏ trước (`[400,500]` ≠ `[400,500,600,700]`, `Inter 600` thiếu).
- Tăng bundle ~54 KB font (tải theo `font-display: swap`, chỉ khi weight được dùng).

### C-075 — bỏ chặn phóng to (XONG, Q-28 phương án 1)

- `apps/miniapp/index.html`: viewport còn `width=device-width, initial-scale=1.0, viewport-fit=cover`; thêm `html { touch-action: manipulation }` để chạm nhanh (tưới nước, nút +/-) không bị zoom đúp nhưng hai ngón vẫn phóng được. Đây là phần bổ sung ngoài yêu cầu gốc, chọn để không tạo hồi quy cảm giác chạm khi bỏ chặn.
- Test: `apps/miniapp/src/index-html.spec.ts` (4 ca; đỏ 2 ca trước). `grep -n user-scalable apps/miniapp/index.html` rỗng.
- Chưa kiểm chứng được: WebView Zalo có tôn trọng `user-scalable` hay không (catalog đã ghi). Cần máy thật.

### C-114 — `<main>` và `<h1>` (MỘT PHẦN)

- `<main>`: thêm `components/ui/main-landmark.tsx` (`display: contents`, không đổi bố cục `.zaui-routes`/`.zaui-page`; đã đối chiếu `zaui.css`, không có selector nào dựa vào cấp cha). Bọc `Suspense` + `AnimationRoutes` trong `components/app.tsx` bằng 3 dòng (ngoài nhóm file vì `components/ui` không có vỏ trang nào; không thụt lề lại khối route để tránh xung đột merge, prettier sẽ chỉnh khi ai đó chạy `pnpm format`).
- `<h1>`: `PageHeader` đã render `h1` từ trước; thêm test `level: 1` để khoá. Các trang không dùng `PageHeader` (đa số 34/41) vẫn chưa có `h1`, cần chuyển trang sang `PageHeader` ở `pages/**` (đợt C3 / PC-10) hoặc thêm `h1` riêng. Web 3 trang (`tai-khoan`, `dang-nhap/callback`, `merchant-denied`) thuộc PC-7/PC-8.
- Test: `main-landmark.spec.tsx` (2 ca, đỏ do thiếu module), `page-header.spec.tsx` (+1 ca).

### Lệnh kiểm chứng và output thật

```
packages/design-tokens: npx vitest run        -> Test Files 3 passed (3), Tests 30 passed (30); npx tsc --noEmit -p tsconfig.json sạch
apps/web:     npx vitest run tailwind.config.spec.ts -> Tests 10 passed (10); npx tsc --noEmit sạch; eslint sạch
apps/miniapp: npx vitest run src/components/ui src/index-html.spec.ts src/ds-legacy-*.spec.ts tailwind.config.spec.ts
              -> Test Files 30 passed (30), Tests 223 passed (223) (trước commit alias); sau commit alias: 3 file ds-legacy 81 passed
              npx tsc --noEmit sạch; npx eslint các file đã sửa/mới: 0 lỗi
Tailwind CLI trên apps/web (class mẫu): .bg-green-600 -> rgb(21 128 61); .hover:bg-green-700 -> rgb(22 101 52); .text-neutral-400 -> rgb(107 107 100);
              .bg-primary-600 -> rgb(163 90 11); .text-primary-700 -> rgb(143 79 8); .bg-green-50 giữ nguyên rgb(240 253 244)
```

### Migration
Không có.

### Giả định
- text-disabled dùng stone-500 (trùng text-tertiary): chọn phương án an toàn đọc được, chấp nhận mất phân biệt thị giác giữa "mờ" và "phụ"; nút vô hiệu thật vẫn dùng token riêng nhạt hơn.
- Web: đổi shade trong khối palette v1 tạm thời thay vì đổi hàng trăm class; khi PC-7 chuyển web sang palette DS v2 thì khối này bị xoá và test tương phản trong `tailwind.config.spec.ts` cần chuyển sang token mới.
- `display: contents` cho `<main>`: nếu WebView Zalo đời cũ không phơi landmark qua `display: contents` thì chỉ mất lợi ích a11y, không ảnh hưởng bố cục.

### Việc còn lại sau mục 1/2
Đã làm ở mục 2/2 bên dưới. Riêng phần `<h1>` của C-114 cho các trang chưa dùng `PageHeader` vẫn còn (thuộc `pages/**`).

## Mục 2/2 — C-068, C-070, C-071, C-072, C-077 (phần ui), C-021 (phần component)

Trạng thái: C-068 XONG, C-070 XONG, C-071 XONG (component + dải thương hiệu Home; các rail ngoài nhóm file chưa chuyển), C-072 XONG, C-077 MỘT PHẦN (đúng phần `components/ui`), C-021 XONG phần component (các trang để gói khác).
Chưa chạy axe/Playwright (quy định RAM): các kiểm chứng bên dưới là vitest + đọc CSSOM/DOM; số đo `tap<44`, `nested-interactive`, `scrollable-region-focusable`, `label` thật cần chạy `capture.mjs` + `build-report-data.mjs` ở máy được phép.

### C-068 — Chip 44px (XONG)

- Phát hiện gốc đã lỗi thời một phần: `chip.tsx` có `.tubu-hit-44` (::after cao 44px) từ đợt 4b. Chỗ còn hở là chiều RỘNG: `::after` chỉ giãn dọc nên chip một ký tự ("5", "x") hẹp hơn 44px. Thêm `minWidth: 44` cho cả `sm` và `md`, hình dạng nhìn thấy (36/32px cao) không đổi.
- Test: `chip.spec.tsx` +1 ca (đỏ: `minWidth` rỗng; xanh sau sửa) — đọc `tokens.css` kiểm `.tubu-hit-44::after` cao 44px và cả hai cỡ có `tubu-hit-44` + `minWidth 44px`.

### C-070 — Button khoá bấm đúp đồng bộ (XONG)

- `button.tsx`: `useRef` `inFlight`; khi `onPress` trả thenable, khoá tới khi settle (cả resolve lẫn reject). `onPress` đồng bộ KHÔNG khoá (nút +/- phải bấm dồn được). Lỗi reject được ném lại trong nhánh dẫn xuất để `unhandledrejection` toàn cục (`app.tsx:142`) vẫn thấy đúng như trước, không bị nuốt.
- Kiểu `onPress` giữ `() => void` (thử mở rộng thành `void | Promise<unknown>` làm vỡ `subscriptions-panel.tsx:131` trả `"" | null`; đã hoàn lại, `() => Promise` vẫn gán được vào `() => void`).
- Test `button.spec.tsx` +5 ca (đỏ: bấm 2 lần đồng bộ gọi 2 lần): bấm đôi đồng bộ chỉ chạy 1 lần; Promise xong thì nhả khoá; reject cũng nhả (dùng thenable giả để vitest không coi unhandledrejection là lỗi); lỗi tới nơi báo lỗi toàn cục; onPress đồng bộ không bị khoá. Ca hành vi đặt ở `button.spec.tsx` thay vì `button-guard.spec.ts` (file đó là quét mã nguồn, không render); `button-guard.spec.ts` vẫn xanh.

### C-071 — vùng cuộn ngang focus được + gợi ý cuộn (XONG phần component)

- Mới: `ui/use-scroll-hints.ts` (đo `scrollWidth/clientWidth/scrollLeft` sau mỗi render, khi cuộn, khi đổi kích thước bằng `ResizeObserver`, lùi về `resize` nếu thiếu) và `ui/scroll-row.tsx` (`ScrollRow`: `role="region"` + `aria-label`, `.scroll-x`). `tabIndex=0` chỉ khi hàng tràn mà KHÔNG có phần tử focus được bên trong (đúng điều kiện axe `scrollable-region-focusable`, không thêm điểm dừng Tab thừa cho hàng chip/nút). Gợi ý cuộn: thuộc tính `data-fade-start/end` + 3 quy tắc `.tubu-scroll-fade` trong `tokens.css` mờ mép bằng `mask-image` (không cần biết màu nền, khác gradient phủ).
- Áp dụng: `segmented-tabs.tsx` (chế độ `scroll`, giữ `role="tablist"`), `home-extras.tsx` dải thương hiệu (`vi.home.brandsRail`, nhãn khác nhãn `section` bao ngoài để không trùng landmark).
- Test: `scroll-row.spec.tsx` (9 ca; đỏ do thiếu module) + `home-parts.spec.tsx` +1 ca (đỏ: không tìm thấy vùng có tên).
- KHÔNG sửa `purchased-rail.tsx` cho C-071: thẻ bên trong đã có nút focus được nên axe không báo, và gói PC-3 đang sửa file này. Rail ngoài nhóm file chưa chuyển sang `ScrollRow`: `catalog/sort-chips`, `catalog/result-header`, `catalog/recently-viewed-rail`, `pages/feed`, `pages/product-detail`, `pages/brand-view`, `flash-sale.tsx`, `pages/about`, `pages/dealer` — gói sở hữu các file đó thay `<div className="scroll-x">` bằng `<ScrollRow label=...>`.

### C-072 — thẻ sản phẩm không lồng tương tác (XONG)

- `product-tile.tsx`: vỏ thẻ không còn `role=button`/`tabIndex`/`onKeyDown`. Phần tử bấm được là nút tên `<button class="tubu-tile-link">` (giữ `aria-label` = tên SP và `aria-describedby` = giá, nên mọi nơi tìm thẻ theo tên truy cập vẫn chạy); `::after` của nó phủ kín vỏ thẻ (`position:relative`) nên chạm đâu trên thẻ cũng mở chi tiết. Tim yêu thích và "Mua lại" là anh em của nút tên, nổi lên bằng `z-index:1`; vỏ thẻ `isolation:isolate` để z-index đó không vượt lên thanh dính của trang. Ảnh `alt=""` (tên đã có ở nút tên, tránh đọc đôi). Vòng focus vẽ trên `::after` để bao cả thẻ. Enter/Space do `<button>` native lo, bỏ `onKeyDown` tự chế.
- CSS thêm vào `apps/miniapp/src/css/tokens.css` (`.tubu-tile-link::after` + focus-visible), cạnh `.tubu-hit-44`.
- `purchased-rail.tsx` KHÔNG cần đổi: nó chỉ bọc `ProductTile` trong `div` không tương tác; hết lồng là nhờ `ProductTile`.
- Test `product-tile.spec.tsx`: viết lại ca bàn phím bằng `userEvent` (bỏ ca Space/repeat vì không còn mã tự chế), +7 ca C-072 (đỏ: 6/6 trước sửa, ca `isolation` thêm sau và cũng đỏ trước sửa): không phần tử bấm được nào chứa phần tử bấm được khác (lưới có tim, kệ Mua lại), nút tên không có `position` còn vỏ `relative`, tim/Mua lại có `zIndex 1`, `isolation`, CSS `::after` kín thẻ + vòng focus.
- Sửa kèm vì phụ thuộc cấu trúc cũ (ngoài nhóm file, thay đổi tối thiểu): `components/catalog/catalog-grid.spec.tsx` (selector `[role="button"][aria-label]` thành `button.tubu-tile-link`; ca bàn phím dùng `userEvent`), `apps/e2e/tests/buy-flow-4b-browse.miniapp.spec.ts` dòng 22 `tilesOf` (cùng lý do; Playwright chưa chạy nên chưa kiểm chứng; các chỗ khác trong e2e dùng `getByRole('button', {name})`/`[aria-label=...]` vẫn khớp nút tên).

### C-077 — phần `components/ui` (MỘT PHẦN)

- `Field` (`form.tsx`): trước đây nhãn là `Text` anh em, không gắn với control (comment cũ trong `address-form.spec.tsx` thừa nhận `getByLabelText` không match). Nay nhãn là `<label htmlFor>`; khi con là đúng một phần tử, Field `cloneElement` cấp `id` (xuyên qua `Input` ZaUI xuống `<input>`; giữ `id` có sẵn), có lỗi thì thêm `aria-invalid` + `aria-describedby` trỏ vào khối lỗi. Nhiều con thì bọc `role="group"` có tên theo nhãn.
- `Checkbox`/`Radio`/`Switch` (`form.tsx`): control KHÔNG có tên (không `label`/`children`/`aria-label`/`aria-labelledby`) — chính là 6 ô `label` ở `checkout` (chấm chọn thị giác trong hàng cha `role=radio/checkbox` đã có tên và tự xử lý bấm) — được coi là trang trí: khối bọc `aria-hidden`, `<input tabIndex=-1>`, vẫn bấm/đổi giá trị bình thường. Control có tên giữ nguyên.
- `TimeInput` nhận `id`/`aria-*`; luôn có tên (mặc định "Giờ", `vi.common.timeInput`) trừ khi có nguồn tên khác (Field cấp `id`, hoặc `aria-label`/`aria-labelledby`), vì `aria-label` thắng `<label for>`.
- `QuantitySelector`: hai nút từ `Box role="button"` (không focus được) thành `<button type="button">` có tên, Tab/Enter/Space chạy.
- `IconButton`: đã bắt buộc `label` ở kiểu + lint (không đổi). `SearchField` (nhãn + nhãn nút xoá bắt buộc) đã đạt.
- Test (đỏ rồi xanh): `form.spec.tsx` +11 ca (9 đỏ), `time-input.spec.tsx` mới 4 ca (4 đỏ), `quantity-selector.spec.tsx` mới 6 ca (3 đỏ). `address-form.spec.tsx` chỉ đổi helper `inputNear` sang `getByLabelText` (phản ánh việc nhãn nay đã gắn).
- CHƯA làm (thuộc `pages/**`, gói khác): `settings.tsx:132` switch tự chế `role=switch` không tên (nên dùng `ui/form` `Switch label=...`), `feed`/`refill`/`my-payroll`/`staff` nút icon thô (dùng `IconButton`), `edit-profile`/`brand-owner` ô nhập (bọc `Field`), `<select>` admin web (PC-11). Quan sát thêm, chưa sửa vì không thuộc mục: `ui/card.tsx` và `ui/tiles.tsx` (`StatTile`) có `role="button"` nhưng không `tabIndex`/bàn phím (`ListRow` đã làm đúng).

### C-021 — vùng chạm phần component (XONG)

- `QuantitySelector`: `sm` (dòng giỏ, dealer) nhìn 36px nhưng chạm 44x44 nhờ lớp mới `.tubu-hit-44-square` (`::after` 44x44 căn giữa); `md` đã 44. Không đổi bố cục/footprint dòng giỏ. Giữ nguyên style `border/background` trên chính nút và `aria-disabled` (e2e `design-system-pilot` kiểm đúng hai thứ này).
- `SegmentedTabs` thêm `minWidth: 44`.
- Test: `hit-target-guard.spec.tsx` mới (13 ca) quét mọi component bấm được của DS v2 (Button md/lg, IconButton md/sm, Chip md/sm, SegmentedTabs, QuantitySelector md/sm, ListRow, Checkbox/Radio/Switch) kiểm kích thước khai báo >= 44x44 hoặc lớp `tubu-hit-44*` (đỏ: SegmentedTabs thiếu chiều rộng); component mới thêm vào danh sách mà quên sẽ bị bắt.
- Các trang trong catalog C-021 (`cart`, `checkout`, `storefront-builder`, `feed`, `dealer`, `about`) dùng component trên nên được hưởng phần `QuantitySelector`; nút thô riêng của từng trang (xoá, chip tự chế) thuộc gói trang.

### Lệnh kiểm chứng và output thật (mục 2/2)

```
apps/miniapp: npx vitest run src/components  -> Test Files 56 passed (56), Tests 390 passed (390)
              npx vitest run src/pages src/*.spec.ts src/*.spec.tsx -> Test Files 13 passed (13), Tests 190 passed (190)
              npx vitest run src/components/ui src/components/catalog src/components/reorder src/components/home -> 44 files, 337 tests passed (lần cuối, sau commit cuối)
              npx tsc --noEmit  -> sạch (lần đầu bắt 1 lỗi `subscriptions-panel.tsx:131` do mở rộng kiểu onPress; đã hoàn kiểu)
              npx eslint <mọi file đã sửa/mới>  -> 0 lỗi
packages/design-tokens: npx vitest run -> Test Files 3 passed (3), Tests 30 passed (30)
```

### Migration
Không có.

### Giả định
- `ScrollRow` dùng `role="region"` (theo đề xuất A4-029) thay vì `group`; mỗi rail cần nhãn khác nhãn `section` bao ngoài để không trùng landmark.
- Control form không tên = trang trí (ẩn khỏi AT + khỏi Tab). An toàn vì mọi chỗ dùng hiện nay là chấm chọn thị giác có hàng cha lo ngữ nghĩa; nếu sau này ai dùng control không tên làm control thật, nó sẽ biến mất khỏi bàn phím — test ghi rõ hành vi này. Gói trang `checkout` nên kiểm hàng cha đã có `tabIndex`/phím (hàng `role=radio` ở `checkout.tsx:433` hiện chưa có `tabIndex`).
- `Field` dùng `cloneElement` nên chỉ gắn nhãn tự động khi con là đúng một phần tử và component đó chuyển `id` xuống DOM (Input ZaUI, `<input>`, `TimeInput`, `Checkbox/Radio/Switch` của DS đều đạt); trường hợp khác rơi về nhóm `role="group"`.
- `Button`: chỉ khoá khi `onPress` trả thenable; handler trả Promise mà không bao giờ settle sẽ khoá nút vĩnh viễn (tương đương `loading` treo mãi).
- Mờ mép bằng `mask-image` (có tiền tố `-webkit-`): chưa kiểm chứng trên WebView Zalo đời cũ; nếu không hỗ trợ thì chỉ mất gợi ý, không ảnh hưởng cuộn/bấm.

### Việc còn lại của gói
- ĐI KÈM BẮT BUỘC với thay đổi Checkbox/Radio/Switch không tên: hàng cha `role=radio/checkbox` ở `pages/checkout.tsx` (khoảng dòng 433-600: phương thức thanh toán, dùng điểm, thu gom, hoá đơn) hiện KHÔNG có `tabIndex`/phím; trước đây người dùng bàn phím tới được `<input>` không tên bên trong, nay input đó bị ẩn khỏi Tab. Trình đọc màn hình cảm ứng (TalkBack/VoiceOver) không bị ảnh hưởng vì dùng cây truy cập của hàng cha. Gói sở hữu `checkout` cần thêm `tabIndex={0}` + Enter/Space cho các hàng này (hoặc dùng `ListRow`/`Radio label=...`).
- C-114: `<h1>` cho các trang chưa dùng `PageHeader` (`pages/**`; web 3 trang thuộc PC-7/PC-8).
- Chuyển các rail ngoài nhóm file sang `ScrollRow`; chuyển `settings.tsx` switch / nút icon thô sang component DS (các gói trang).
- Chạy axe + `capture.mjs` (cả mục 1 và 2) khi có máy được phép dùng Playwright; chạy lại e2e `buy-flow-4b-browse` (selector `tilesOf` mới) và `design-system-pilot` (nút +/-).
