# PF-1: Miniapp a11y và ngữ nghĩa

Nhánh `hz16/PF-1`, base `0c481225`. Chỉ đụng `apps/miniapp` (components/ui, orders, community, pages) và một selector e2e. Không đổi hành vi nghiệp vụ, không API, không migration. Không push, không deploy, không ghi DB dùng chung.

Gói bị ngắt giữa chừng hai lần; lần hoàn tất này đọc lại `git log`, `git diff`, `git status` rồi kiểm lại từng mục đã commit bằng test của chính mục đó (chạy lại toàn bộ vitest miniapp, xem phần Kiểm). Sửa dở còn nằm lại trong cây làm việc là `components/ui/form.tsx` bị xoá dòng `{...(decorative ? INERT : null)}`: đó là dấu vết của phép thử đột biến ở lần trước chứ không phải chủ ý (dòng này là phần sửa của `a4eca683`). Đã khôi phục dòng đó và chạy lại đột biến để chắc: bỏ dòng thì 4 ca đỏ (3 ở `form.spec.tsx`, 1 ở `checkout.spec.tsx`), có dòng thì xanh; `git diff` của file về rỗng. Ở lần ngắt trước đó, phần sửa dở của `brand-story` có một lỗi: bản test ghim bản đồ tìm nút bằng `getByRole(..., { hidden: true })`, nhưng tên truy cập của phần tử `aria-hidden` luôn rỗng nên 13 ca đỏ vì sai cách tìm (không phải vì mã). Đổi sang `getByLabelText` rồi hoàn thiện, xem mục 1f.

Commit theo từng mục: `a4eca683` (1a), `5b77c4f2` và `6c39b057` (1b), `cbec8297` (1c), `ef220e0a` (1d), `725ffd7d` (1e và một phần mục 2), `d6f59f60` (1f), `8eea7b59` (mục 2, bank-payment), `8358d7ea` (mục 3, chỉ test), `f41dd8ed` (mục 4, chỉ test), `3dd23c01` (mục 5, theo ghi chú của PF-2), cùng commit báo cáo này.

## Bảng mục

| # | Mục | Kết quả | Commit |
|---|---|---|---|
| 1a | `nested-interactive` ở checkout (4 hàng) | ĐÃ SỬA | `a4eca683` |
| 1b | `nested-interactive` ở orders (3 thẻ) | ĐÃ SỬA | `5b77c4f2`, `6c39b057` |
| 1c | `nested-interactive` ở feed (4 thẻ) | ĐÃ SỬA | `cbec8297` |
| 1d | `scrollable-region-focusable` ở brand-view | ĐÃ SỬA | `ef220e0a` |
| 1e | `scrollable-region-focusable` ở product-detail (2 vùng) | ĐÃ SỬA | `725ffd7d` |
| 1f | `target-size` ở brand-story (2 nút) | ĐÃ SỬA | `d6f59f60` |
| 2 | C-114 thiếu `<main>` và `<h1>` | PHẦN LỚN ĐÃ CÓ TỪ TRƯỚC; còn 2 route, đã sửa | `725ffd7d`, `8eea7b59` |
| 3 | Hàng địa chỉ thiếu keyboard props | KHÔNG PHẢI LỖI (đã đúng trên mã hiện tại), thêm test ghim | `8358d7ea` |
| 4 | `TimeInput` trùng tên "Giờ" ở admin và staff | KHÔNG PHẢI LỖI, thêm test ghim chỗ còn tra theo thứ tự | `f41dd8ed` |
| 5 | PF-2 báo `order-card.tsx` và `voucher-sheet.tsx` còn `toLocaleDateString` | ĐÃ SỬA hai file; xoá hai mục khỏi danh sách ngoại lệ của PF-2 CHƯA làm được (xem mục 5) | `3dd23c01` |

## Đo axe trước và sau

Công cụ: `node scripts/uiux/capture.mjs miniapp --vp 390 --states normal --force`, toàn bộ 43 route, một lần trước khi sửa (ghi `miniapp-before.jsonl` ngoài repo) và một lần sau (cùng cấu hình). Số là số nút vi phạm axe mức serious hoặc critical.

| Route | Trước | Sau | Luật axe trước |
|---|---|---|---|
| `product-detail` | 2 | 0 | `scrollable-region-focusable` x2 |
| `checkout` | 4 | 0 | `nested-interactive` x4 |
| `orders` | 3 | 0 | `nested-interactive` x3 |
| `feed` | 4 | 0 | `nested-interactive` x4 |
| `brand-view` | 1 | 0 | `scrollable-region-focusable` x1 |
| `brand-story` | 2 | 0 | `target-size` x2 |
| `order-detail` | 1 | 1 | `color-contrast` x1 (ngoài nhóm file, xem phần "còn lại") |
| 36 route còn lại | 0 | 0 | |
| **Tổng** | **17 nút / 7 route** | **1 nút / 1 route** | |

Mục 2, đếm theo route (43 route, `--vp 390 --states normal`):

| Luật | Route vi phạm trước | Route vi phạm sau |
|---|---|---|
| `landmark-one-main` | 0 | 0 |
| `page-has-heading-one` | 2 (`product-detail`, `bank-payment`) | 0 |

Cột "trước" lấy từ lần chạy trước khi sửa (đã lưu ra ngoài repo, 43 bản ghi); cột "sau" từ lần chạy lại hôm nay trên đúng nhánh này (43 bản ghi, `capture.mjs miniapp --vp 390 --states normal --force`, thoát 0). Cả hai lần `settings` đều báo `FAIL` ở bước chụp ảnh (`page.screenshot` quá 30 giây), nhưng axe đã chạy xong trước bước chụp và bản ghi vẫn có kết quả (0 vi phạm, 1 h1, có main), nên số liệu của route này dùng được; lỗi chụp ảnh là của công cụ chứ không phải của gói (không đổi giữa trước và sau).

## Mục 1: serious/critical còn lại

### 1a. Checkout: hàng chọn chứa chấm chọn (`a4eca683`)

Bốn hàng `role="radio"`/`role="checkbox"` (phương thức thanh toán, Điểm Xanh, thu gom tái chế, hoá đơn VAT) chứa chấm chọn Radio/Checkbox không tên. Chấm đã `aria-hidden` và `tabIndex=-1`, nhưng axe vẫn tính `<input>` bên trong là phần tử focus được lồng trong hàng cha. Khung bọc chấm không tên (trong `components/ui/form.tsx`, `hitArea`) nay có thuộc tính `inert` (chuỗi rỗng: React 18 không nhận `true` cho thuộc tính này). Cây inert không focus được và không nhận chạm, nên cú chạm vào chấm đi thẳng tới `onClick` của hàng cha, đúng một sự kiện. Trình duyệt không hiểu `inert` vẫn còn `tabIndex=-1` như trước. Bàn phím giữ nguyên nhờ `rowKeyboardProps` của PC-1. Thêm `components/ui/nested-interactive.ts` (chỉ dùng trong test: xấp xỉ luật axe, bỏ qua cây inert, vẫn tính `tabindex=-1`).

Test (đỏ rồi xanh): `form.spec.tsx` (khung bọc chấm không tên có `inert`, chấm có tên thì không), `checkout.spec.tsx` (trang thanh toán không còn cặp lồng nhau nào theo helper).

### 1b. Orders: thẻ đơn chứa nút Mua lại (`5b77c4f2`, `6c39b057`)

Vỏ thẻ là `role="button"` chứa nút "Mua lại". Vỏ nay không tương tác: nút mã đơn là điều khiển mở chi tiết (tên "Đơn <mã>", mô tả truy cập là dòng món/ngày/tổng tiền), lớp phủ `::after` của nút phủ cả thẻ (cùng cơ chế `.tubu-tile-link` của `ProductTile`), "Mua lại" là anh em nổi lên bằng `z-index`. Nút mã đơn cao 44px bằng đệm dọc cộng lề âm (`stretchedLinkHit44`) nên thẻ không cao thêm. Hằng số nút phủ tách ra `components/ui/stretched-link.ts` dùng chung với `ProductTile` (bỏ bản sao). Bàn phím dùng nút thật thay vì tự bắt Enter/Space. `6c39b057` sửa chữ mã đơn thành khối block vì chữ nội tuyến làm hộp nút cao 51px thay vì 44px.

Hành vi giữ nguyên, đã thử trên Chromium và WebKit: chạm vùng trống mở chi tiết, chạm Mua lại chỉ mở sheet. Test: `order-card.spec.tsx`, `orders.spec.tsx`. Selector e2e tìm thẻ đơn đổi từ `getByRole('button', { name: 'Đơn <mã>' })` sang `getByTestId('order-card')` lọc theo nút mã đơn (`apps/e2e/tests/buy-flow-4a.miniapp.spec.ts`, ba chỗ). Playwright chưa chạy (điều phối viên chạy).

### 1c. Feed: thẻ bài đăng chứa thẻ sản phẩm và hashtag (`cbec8297`)

Cùng cách với 1b: vỏ không tương tác; nút mở bài bọc tiêu đề (bài không tiêu đề thì bọc nội dung) với `::after` phủ cả thẻ; thẻ sản phẩm gắn kèm và hàng hashtag nổi lên bằng `z-index` nên bỏ hai `stopPropagation`. Lớp phủ phẳng không bo góc (`data-flat`, thêm 4 dòng ở `tokens.css`) vì thẻ bài trải hết bề ngang. Bố cục giữ nguyên nhờ đệm dọc bù lề âm. Thử trên Chromium và WebKit: chạm vùng tác giả mở bài, chạm thẻ sản phẩm chỉ sang trang sản phẩm. Test: `post-card.spec.tsx` (không còn nút lồng, tên truy cập, click từng vùng), `feed.spec.tsx`.

### 1d. Brand-view: hàng chứng nhận (`ef220e0a`)

Hàng huy hiệu cuộn ngang nhưng huy hiệu không bấm được nên không có gì focus được bên trong. Chuyển sang `ScrollRow` có sẵn (tên "Chứng nhận", tự có `tabindex` khi tràn, mờ mép gợi ý cuộn). Test `brand-view.spec.tsx`.

### 1e. Product-detail: hai vùng cuộn ngang (`725ffd7d`)

Thư viện ảnh nhiều ảnh dùng `useScrollHints` (vùng có tên "Ảnh sản phẩm", tự có `tabindex` khi tràn). Hàng Mã giảm giá chuyển sang `ScrollRow` có tên; mỗi mã (`role="button"`) thêm `rowKeyboardProps()` nên người dùng bàn phím sao chép được mã (trước đây không tới được). Test mới `product-detail-a11y.spec.tsx`.

### 1f. Brand-story: vùng chạm (`d6f59f60`)

Tám ghim thương hiệu nổi trên bản đồ có hộp chạm 44px, nhưng ở cụm Lâm Đồng và Mekong các hộp chồng lên nhau nên phần không bị che nhỏ hơn 24px (axe `target-size`, WCAG 2.5.8). Quyết định: ghim chỉ là lối tắt bằng hình trùng với tám ô lưới bên dưới (cùng mở một sheet, ô lưới là nút thật cao 135px trở lên, tên có nhãn và tỉnh), nên ghim nay `aria-hidden` và `tabIndex=-1`. Trình đọc màn hình và bàn phím dùng ô lưới; người chạm vẫn bấm được ghim; vị trí ghim và bố cục không đổi. Phương án khác (dời ghim cho cách nhau 44px) đổi bố cục bản đồ nên không chọn. Đánh đổi: người dùng bàn phím không có điểm dừng Tab riêng cho ghim trên bản đồ, chức năng không mất vì ô lưới mở đúng sheet đó.

Test: hai ca mới (ghim `aria-hidden` + `tabIndex=-1` + vẫn mở sheet khi chạm; tám ô lưới Tab tới được và mở sheet), đã chạy đột biến (gỡ hai thuộc tính thì hai ca đỏ). Các ca cũ tra ghim bằng `getByLabelText` vì `getByRole` không thấy phần tử `aria-hidden`.

## Mục 2: C-114 `<main>` và `<h1>`

Đo trước trên toàn bộ route: `landmark-one-main` 0 route vi phạm (đã có `MainLandmark` bao toàn bộ `AnimationRoutes` ở `components/app.tsx`, là `<main>` duy nhất trong mã; `PageHeader` đã render `h1`), `page-has-heading-one` 2 route vi phạm: `product-detail` và `bank-payment`. Phần lớn trang đã được sửa từ các gói trước (HANDOFF còn ghi "36 trang thiếu h1" là số cũ). Không sửa `page-header.tsx` hay layout gốc vì không lỗi.

- `product-detail` (`725ffd7d`): không dùng PageHeader (trang hero), tên sản phẩm nay là `h1` bọc `Text.Title` với `font: inherit`; vị trí và cỡ chữ đo trên trình duyệt trùng bản cũ.
- `bank-payment` (`8eea7b59`): file nằm ngoài glob nhóm file của gói nhưng thuộc mục này (mỗi route đúng một h1) và không gói song song nào sửa nó (đã kiểm `git diff` các worktree PF-2, PF-3, PF-4). Chờ thanh toán và Đã nhận thanh toán bọc tiêu đề đang hiện trong `h1` (`font: inherit`); khung đang tải và tải lỗi dùng `h1` ẩn "Thanh toán chuyển khoản". Đo bố cục trạng thái chờ thanh toán (toạ độ, rộng, cao, cỡ chữ, độ đậm của tiêu đề, dòng phụ, ảnh QR, nút) trước và sau: trùng khớp từng giá trị. Ba test mới đỏ trước khi sửa.

Số route còn vi phạm `landmark-one-main` và `page-has-heading-one` trước và sau: xem dòng tổng ở bảng axe phía trên.

## Mục 3: hàng địa chỉ thiếu keyboard props: không phải lỗi

Nguồn: ghi chú PC-1 (hàng chọn địa chỉ role radio ở `address-section.tsx`) và `04-uiux.md:463` (`addresses.tsx` `Text onClick` không role). Kiểm trên mã hiện tại:

- `components/checkout/address-section.tsx`: `AddressCard` là `<button type="button" role="radio" aria-checked>` thật (từ lần di cư DS v2 `99608cc2`). Tab tới được, Enter/Space là hành vi gốc, nên không cần `rowKeyboardProps` (hàm này dành cho `<div role="radio">`).
- `pages/addresses.tsx`: Đặt mặc định/Sửa/Xoá là `<button>` thật cao 44px (`5eefdd67`). Thẻ địa chỉ ở trang này không phải hàng bấm được.
- `components/subscription-options.tsx` (`AddressPicker`, ngoài nhóm file): `RadioRow` đã gắn `rowKeyboardProps()`.

Không sửa mã. Thêm test `address-section.spec.tsx`: Tab tới hàng, Enter rồi Space mỗi phím gọi `onSelect` đúng một lần, hàng là `BUTTON`; đã chạy đột biến (đổi hàng về `div`) thì test đỏ. `AddressPicker` chưa có test bàn phím riêng; không thêm vì file nằm ngoài nhóm.

## Mục 4: `TimeInput` trùng tên "Giờ": không phải lỗi

`TimeInput` chỉ rơi về tên mặc định "Giờ" khi chỗ gọi không có `id`/`aria-label`/`aria-labelledby`. Mọi chỗ gọi trong `admin.tsx` và `staff.tsx` đều nằm trong `Field label=...` (Field cấp `id` và `<label htmlFor>`): admin "Giờ vào"/"Giờ ra"; staff "Giờ đã về" (checkout lùi giờ), "Bắt đầu"/"Kết thúc" (ca tuỳ chọn và đăng ký nhanh). Các sheet là `BottomSheet` với `unmountOnClose` nên không bao giờ có hai cặp cùng tên trong DOM. Test sẵn có đã tra theo nhãn cho admin, checkout lùi giờ và ca tuỳ chọn; sheet đăng ký nhanh chỉ tra theo thứ tự, nên thêm một ca ở `staff.spec.tsx` (Bắt đầu 08:00, Kết thúc 17:00, không có tên "Giờ"). Không sửa mã. E2E: `grep` `apps/e2e/tests` không có selector nào theo tên ô giờ, nên không đổi gì.

## Mục 5: `toLocaleDateString` ở thẻ đơn và sheet Mã giảm giá (ghi chú của PF-2)

PF-2 báo `components/orders/order-card.tsx` (ngày tạo đơn) và `components/checkout/voucher-sheet.tsx` (hạn mã) còn gọi `toLocaleDateString('vi-VN')` trực tiếp và để lại cho gói này. Đổi cả hai sang `formatDate` của `utils/format` (`3dd23c01`). Hiển thị đổi nhẹ, đúng chủ đích của PF-2: `20/9/2026` thành `20/09/2026`, `1/1/2027` thành `01/01/2027` (dd/MM/yyyy cố định, không phụ thuộc ICU của webview). Mã không có hạn hoặc hạn hỏng giữ nguyên chữ "Không thời hạn" (test mới ghim, đã xanh cả trước lẫn sau vì là hành vi giữ nguyên). Test cũ `HSD: 1/1/2027` đổi thành `HSD: 01/01/2027`.

Danh sách ngoại lệ của PF-2: CHƯA xoá được và đây là việc còn lại cho người gộp. Lý do: `OWNED_ELSEWHERE` nằm trong `pages/format-guard.spec.ts` của nhánh `hz16/PF-2`; base của gói này (`0c481225`) chưa có danh sách đó (file ở base chỉ có hai test cũ), và file thuộc PF-2, nên sửa ở đây sẽ gây xung đột gộp. Sau khi gộp PF-2 và PF-1, cần xoá hai mục `components/orders/order-card.tsx` và `components/checkout/voucher-sheet.tsx` khỏi `OWNED_ELSEWHERE` (thành `new Set<string>()`, hoặc bỏ luôn tập này cùng test "danh sách ngoại lệ không chứa file đã sạch"), nếu không test "danh sách ngoại lệ không chứa file đã sạch" sẽ đỏ vì hai file đã sạch. Đã kiểm trạng thái gộp bằng cách chép spec của PF-2 ra file tạm trong cây này (rồi xoá): bản gốc có 2 ca đỏ (đúng như dự báo); bản đã xoá hai mục thì test "danh sách ngoại lệ" xanh và hai file của gói không còn nằm trong danh sách vi phạm. Test "chỉ `utils/format.ts` được gọi toLocale..." vẫn đỏ ở cây này vì 9 file khác (`reviews-section`, `subscriptions-panel`, `affiliate`, `community-events`, `community-moderation`, `dealer`, `notifications`, `refill`, `checkout-rules`) là phần PF-2 đã sửa ở commit `4eac6e57` mà base chưa có; sau khi gộp PF-2 các file đó hết. Việc này chưa chạy được trên cây đã gộp (unverified).

## Vi phạm serious/critical còn lại sau khi sửa

Sau khi sửa còn đúng một vi phạm serious/critical trên toàn bộ 43 route, không có vi phạm moderate hay minor nào:

- `order-detail`, `color-contrast` (serious), 1 nút: chữ ngày giờ ở khung trạng thái (`pages/order-detail.tsx:221`, `.zaui-text-xSmall`) màu `#a1732d` trên nền `#fff4e0`, tương phản 3,84 so với ngưỡng 4,5. Nguyên nhân là `opacity: 0.8` đặt lên chữ đã dùng màu `--color-status-warning-fg`. KHÔNG sửa: file không thuộc nhóm file của gói (`orders*` không khớp `order-detail`) và mục này không nằm trong danh sách bug của gói. Cách sửa một dòng: bỏ `opacity: 0.8`. Đã kiểm `git diff` của PF-2, PF-3, PF-4 so với base: không nhánh nào đụng file này, nên người gộp có thể sửa mà không xung đột.

Không có vi phạm nào "không sửa được". Riêng ghim bản đồ ở `brand-story` (mục 1f) hết vi phạm nhờ một đánh đổi có chủ đích (ghim `aria-hidden`), đã ghi ở đó.

## Quan sát ngoài nhóm file (không sửa)

- `pages/order-detail.tsx:221`: chữ ngày giờ ở khung cảnh báo dùng `color: var(--color-status-warning-fg)` kèm `opacity: 0.8`, tương phản 3,84 so với ngưỡng 4,5 (axe `color-contrast`, 1 nút ở route `order-detail`). Cách sửa: bỏ `opacity: 0.8`. File không thuộc glob của gói (`orders*` không khớp `order-detail`).
- `components/subscription-options.spec.tsx` không có test bàn phím cho `RadioRow`.
- Đã chạy ở mức khung chứ không qua đủ trạng thái: capture chỉ `--states normal`; trạng thái loading/error/empty của các trang chưa quét axe.

## Kiểm

Mọi lệnh bắt đầu bằng `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, chạy trong worktree, ở trạng thái cuối cùng (sau commit `3dd23c01`).

| Lệnh | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` rồi `pnpm --filter @tubutree/shared-types build` | thoát 0 |
| `apps/miniapp`: `npx tsc --noEmit -p .` | thoát 0 |
| `apps/miniapp`: `npx eslint --max-warnings=0 <mọi file .ts/.tsx đã đổi trong gói>` | thoát 0, 0 lỗi 0 cảnh báo |
| `apps/e2e`: `npx tsc --noEmit -p .` | thoát 0 |
| `apps/miniapp`: `npx vitest run` (toàn bộ) | thoát 0: 201 file, 2620 ca xanh |
| Mục 5, ca mới `order-card.spec.tsx` (ngày `20/09/2026`) | đỏ trước sửa (`20/9/2026`), xanh sau sửa |
| Mục 5, `voucher-sheet.spec.tsx` (`HSD: 01/01/2027`; mã không hạn/hạn hỏng ra "Không thời hạn") | đỏ ở ca đổi định dạng trước sửa, xanh sau sửa |
| Đột biến `form.tsx` (bỏ dòng `inert`) rồi `vitest run form.spec.tsx checkout.spec.tsx` | 4 ca đỏ; khôi phục thì 59 ca xanh |
| `node scripts/uiux/capture.mjs miniapp --vp 390 --states normal --force` (API 3001, miniapp 3113) | thoát 0, 43 route; số liệu ở bảng axe |
| Tắt server | không còn listener ở 3001, 3112, 3113 |

## Chưa verify

- Cây đã gộp PF-2 và PF-1: test chặn `toLocale*String` của PF-2 chỉ kiểm được trên bản chép tạm (mục 5), chưa chạy trên cây gộp thật.
- Playwright e2e (điều phối viên chạy). Selector e2e đã đổi cho thẻ đơn (`buy-flow-4a.miniapp.spec.ts`); các e2e theo `getByRole('radio'|'checkbox')` ở checkout và recycling-pickup không đổi nhưng chưa chạy lại sau khi chấm chọn thành `inert`.
- Máy đọc màn hình thật (VoiceOver, TalkBack) chưa thử; chỉ có axe, Testing Library và thử chạm/phím trên Chromium và WebKit ở lần chạy trước.
- Zalo Mini App webview thật: `inert` cần engine hỗ trợ; nơi không hỗ trợ vẫn còn `tabIndex=-1` nên hành vi như trước, riêng axe có thể còn báo `nested-interactive` ở bốn hàng checkout trên webview đó (axe chỉ chạy trên Chromium).

## Rủi ro

- Ghim bản đồ `aria-hidden`: nếu sau này ô lưới bỏ đi thì mất đường vào bằng bàn phím; test `brand-story.spec.tsx` ghim điều kiện tám ô lưới Tab tới được.
- Lớp phủ `::after` của nút mở thẻ (đơn, bài đăng, sản phẩm) phủ cả thẻ: phần tử mới thêm vào thẻ mà bấm được phải có `position: relative; z-index: 1`, không thì bị lớp phủ nuốt chạm. Ghi ở JSDoc `stretched-link.ts`, test của từng thẻ kiểm chạm từng vùng.
