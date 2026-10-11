# PC-10b — Di cư affiliate, dealer, storefront, brand sang DS v2 (C-076 lô 2) + C-079

Nhánh `hz7/PC-10b` (tách từ `hardening/2026-10` @ afb1592). Quyết định áp dụng: Q-26 (thuật ngữ: không thêm chữ "TubuXu" mới).

## Mục 1/4 — Guard spec + `pages/affiliate.tsx` + `components/affiliate/**` (C-076) — XONG

Commit (mỗi trang một commit, spec đi cùng trang):

| Commit | Nội dung |
|---|---|
| 9a73a64 | `ds-c076-pc10b.spec.ts` (mới) + `pages/affiliate.tsx` + `pages/affiliate.spec.tsx` + 2 dòng locator e2e |
| 0d36e6c | `components/affiliate/ctv-order-sheet.tsx` + `choice-card.tsx` (mới) + spec của cả hai + dòng mới trong guard |
| 1a91147 | `affiliate.tsx` dùng `ChoiceCard` chung (bỏ `MethodChip` trùng) + test khoá hành vi rút tiền |

### Số đo trước -> sau (`scripts/uiux/static-scan.mjs`: legacy / hex / emoji; ESLint trong `apps/miniapp`)

| File | legacy | hex | emoji | ESLint |
|---|---|---|---|---|
| `pages/affiliate.tsx` | 125 -> 0 | 1 -> 0 | 5 -> 4 | 4 lỗi `no-raw-color` -> 0 lỗi, 0 cảnh báo |
| `components/affiliate/ctv-order-sheet.tsx` | 37 -> 0 | 0 -> 0 | 4 -> 0 | 0 -> 0 |
| `components/affiliate/choice-card.tsx` (mới) | - | - | 0 | 0 |
| `components/affiliate/milestone-copy.ts`, `recent-customers.ts` | 0 / 0 | 0 / 0 | 1 / 0 | 0 (không đổi, không có style) |

Emoji còn lại là NỘI DUNG, giữ có chủ ý: `🎉` snackbar chào mừng CTV, `🌿 🌱 💚` trong 3 caption mẫu để CTV sao chép đăng mạng xã hội; `🎉` trong `milestone-copy.ts` ("Đã đạt chỉ tiêu 🎉") và `vi.ctvOrder.successTitle`; emoji bậc CTV lấy từ API (`d.tier.emoji`). Ký tự chức năng `✓` (nút "Đã nhận") và `⚠` (lỗi nhập, lỗi tải) đã thay bằng `Icon` Lucide.

### Đã làm

`pages/affiliate.tsx` (4 nhánh render: đang tải / lỗi / form đăng ký / dashboard):
- Mọi nhánh có `PageHeader` "Cộng tác viên" (đúng một h1, C-114); bỏ `className="page"` vì `PageHeader` tự đệm safe-top.
- ZaUI `Box`/`Text` -> `div` + `Text`/`Heading` của DS; còn lại từ zmp-ui chỉ `Page`, `Sheet`, `Input`, `useSnackbar`, `useNavigate`.
- Màu: `--neutral-*/--primary-*/--leaf-*/--danger/--info` -> `--color-*`; radius -> `--radius-card/control/pill`; bóng -> `--elevation-*`; hero cam -> gradient `--color-action-primary-bg` -> `-pressed`; chữ trắng mờ `rgba()` -> `tone="inverse"` + `opacity` (không dùng alpha trong token).
- Thẻ section/KPI/bậc/thưởng mốc -> `Card`; thanh tiến độ -> `ProgressBar`; nhãn trạng thái hoa hồng -> `Badge` (map: PENDING promo, LOCKED info, APPROVED success, PAID neutral, REJECTED danger; chữ nhãn giữ nguyên); dòng "Bảng 5 bậc..." -> `ListRow` (44px, bàn phím).
- Vùng chạm 44px: "+ Tạo link", "Sao chép" (trước là `Text` có `onClick`) -> `Button variant="ghost"`; 3 caption mẫu -> `<button>` min 44px; chọn phương thức rút -> `ChoiceCard`.
- Sheet rút hoa hồng -> `BottomSheet` (có tiêu đề h2 + nút đóng 44px); sheet lên đơn hộ giữ `Sheet` ZaUI vì `CtvOrderSheet` tự có tiêu đề (đổi tiêu đề thành "Đã tạo đơn" khi xong) và tự cuộn 82vh.
- Loading/empty/error: lỗi tải `/affiliate/me` dùng `ErrorState` (có nút Thử lại), danh sách rỗng dùng `EmptyState variant="inline"`, đang tải dùng `Skeleton`.
- KHÔNG đổi: mọi `queryKey`/lời gọi API, điều kiện bật/tắt nút Rút, công thức `knownMax`/`valid` của form rút, số hiển thị (hoa hồng tháng/hôm nay/chờ/có thể rút, từng dòng lịch sử, theo gian hàng/sản phẩm), thứ tự khối.

`components/affiliate/ctv-order-sheet.tsx`:
- Bỏ `Box`/`Text` ZaUI; tiêu đề -> `Heading` h2; dòng mã đơn/tổng tiền -> `KeyValueRow`; lỗi nhập `⚠ ...` -> `Icon` + `Text` danger; nút tăng/giảm/xoá -> `IconButton` (giữ `width/height 44px` mà spec cũ khẳng định); chọn COD/Chuyển khoản -> `ChoiceCard`; dòng sản phẩm gợi ý và phân loại -> `ListRow` (hàng hết hàng không có `onPress`, mờ 0,5 như cũ); đang tải/lỗi/rỗng -> `Skeleton`/`ErrorState`/`EmptyState`.
- Bỏ phần đệm `calc(16px + var(--safe-bottom))` vì `Sheet` ZaUI đã tự cộng safe-area đáy (xem chú thích `ui/bottom-sheet.tsx`, A4-020), tránh hở đáy gấp đôi.
- KHÔNG đổi: payload `createCtvOrder`, quy tắc kiểm hợp lệ, chặn tăng quá tồn, ghi nhớ khách gần đây, invalidate các query hoa hồng.

`components/affiliate/choice-card.tsx` (mới): thẻ chọn một phương án, là `<button aria-pressed>` cao >= 44px, dùng chung cho rút tiền và thu tiền.

### Test (đỏ -> xanh)

- `src/ds-c076-pc10b.spec.ts` (mới, 33 ca): alias legacy, màu thô hex/rgb/hsl, ký tự chữ làm icon, import ZaUI ngoài danh sách cho phép (cấm Box/Text/Button), `PageHeader` ở mọi trang. Thêm `affiliate.tsx` vào danh sách: 5 ca ĐỎ (alias, màu thô, `✓`, ZaUI, PageHeader) -> sau di cư XANH. Thêm `ctv-order-sheet.tsx`: 3 ca ĐỎ (alias, `⚠`, ZaUI) -> XANH.
- `pages/affiliate.spec.tsx` (9 -> 16 ca): 4 ca mới "đúng một h1 ở mọi trạng thái" ĐỎ trên code cũ -> xanh; 2 ca rút hoa hồng (tiêu đề h2, `aria-pressed`, điền sẵn số có thể rút, payload `requestPayout` cho Ví và Ngân hàng) ĐỎ trên code cũ -> xanh; 1 ca khoá số tiền hiển thị (125.000đ / 15.000đ / 30.000đ / 200.000đ, 5 trạng thái hoa hồng) XANH ở cả code cũ lẫn mới, chứng minh số liệu không đổi.
- `components/affiliate/ctv-order-sheet.spec.tsx` (9 -> 13 ca): 3 ca ĐỎ trên code cũ (lỗi nhập không còn `⚠`, `aria-pressed` + đơn `BANK_TRANSFER` + mở trang thanh toán, nút Thử lại khi tải gợi ý lỗi) -> xanh; 1 ca hết hàng không thêm được xanh ở cả hai.
- `components/affiliate/choice-card.spec.tsx` (mới, 3 ca): đỏ vì chưa có module -> xanh.
- Cũng sửa cảnh báo có sẵn `consistent-type-imports` ở hai spec (`typeof import('zmp-ui')` -> `Record<string, unknown>`).

### Lệnh kiểm chứng (output thật)

```
$ cd apps/miniapp && npx vitest run src/pages/affiliate.spec.tsx src/components/affiliate src/ds-c076-pc10b.spec.ts \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/components/ui/button-guard.spec.ts src/pages/format-guard.spec.ts
 Test Files  10 passed (10)
      Tests  162 passed (162)
$ npx eslint src/pages/affiliate.tsx src/pages/affiliate.spec.tsx src/components/affiliate src/ds-c076-pc10b.spec.ts
                                        -> exit 0, không lỗi, không cảnh báo
$ npx tsc --noEmit                      -> exit 0, không output
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ node scripts/uiux/static-scan.mjs && (cột: legacy hex emoji file)
0 0 0 apps/miniapp/src/components/affiliate/choice-card.tsx
0 0 0 apps/miniapp/src/components/affiliate/ctv-order-sheet.tsx
0 0 1 apps/miniapp/src/components/affiliate/milestone-copy.ts
0 0 0 apps/miniapp/src/components/affiliate/recent-customers.ts
0 0 4 apps/miniapp/src/pages/affiliate.tsx
```

### File ngoài nhóm bị sửa (tối thiểu)

`apps/e2e/tests/affiliate-ctv.miniapp.spec.ts`: tên nút sau khi nhận thưởng mốc đổi từ "Đã nhận ✓" thành "Đã nhận" (icon `Check` thay ký tự `✓`), nên locator đổi thành `getByRole('button', { name: 'Đã nhận', exact: true })`. CHƯA chạy Playwright (quy định máy), chỉ sửa tĩnh.

### Giả định

1. Tiêu đề trang là "Cộng tác viên" (khớp nhãn mục menu ở `profile.tsx`), đặt hằng cục bộ, không thêm vào `i18n/vi.ts` để khỏi đụng gói khác.
2. Chữ số tiền dương/hoa hồng trước đây `--leaf-700` (xanh ô-liu) -> `tone="brand"` (forest-600); nhãn "Có thể rút" -> `Badge success`. Nền `--leaf-50`/`--neutral-50` -> `--color-bg-subtle`/`--color-bg-canvas` (cùng giá trị sage-50/stone-50).
3. Thanh tiến độ mốc dùng `ProgressBar` DS nên mất màu riêng (xám khi đã nhận, xanh khi đạt); trạng thái đó vẫn thể hiện bằng `Badge` "Đã nhận" và nút.
4. Vòng tròn icon hero 64px giữ nguyên nhưng icon thu từ 34px còn 24px (`Icon` chỉ có sm/md/lg); nền vòng dùng `--color-action-primary-bg-pressed` thay vì trắng 18% alpha.
5. `new Date(c.createdAt).toLocaleDateString('vi-VN')` giữ nguyên (không đổi số liệu hiển thị); `format-guard.spec.ts` chưa phủ trang này.
6. Danh sách link/lịch sử hoa hồng trước đây hiện câu "Chưa có..." ngay cả khi đang tải; nay hiện `Skeleton` khi `isLoading`. Chữ rỗng tách thành tiêu đề + mô tả của `EmptyState` (nội dung chữ giữ nguyên).
7. Chuỗi "TubuXu" cũ còn trong `affiliate.tsx` ("Bảng 5 bậc CTV & thưởng mốc TubuXu") và `milestone-copy.ts`: không thêm chữ mới, để PD-3 gộp vào Điểm Xanh.

### Việc còn lại của gói (do lượt khác)

dealer, storefront-builder, brand-story, brand-owner, brand-view, product-detail (vùng liên kết + emoji), content-kit-sheet, share-sheet, storefront-context-bar, utils/brands.ts, css/dealer-theme.css, C-079. Mỗi file thêm một dòng vào `FILES_PC10B` (và `PAGES_WITH_PAGE_HEADER` nếu là trang) trong `ds-c076-pc10b.spec.ts`; nếu file còn cần `Box`/`Text` ZaUI thì chưa thêm vào `FILES_PC10B` hoặc nới `ZAUI_ALLOWED` kèm lý do.

### Đề xuất cho điều phối viên

- `BottomSheet` nên nhận `title` dạng `ReactNode` hoặc có cờ `hideHeader` để `CtvOrderSheet` (tiêu đề đổi theo bước) chuyển hẳn sang `BottomSheet`; hiện còn một `Sheet` ZaUI trong `affiliate.tsx`.
- `EmptyState variant="inline"` vẫn vẽ minh hoạ 96px; trang CTV mới đăng ký hiện bốn minh hoạ liên tiếp. Nên có cờ `art` tuỳ chọn hoặc `compact` cho thẻ danh sách.
- `IconButton` chưa cho chỉnh tông icon (nút xoá dòng sản phẩm đang dùng icon màu chính, trước là xám nhạt) và chưa có biến thể viền tròn cho nút tăng/giảm số lượng; `QuantitySelector` có thể thay cho `Stepper` cục bộ nếu cần giá trị ở giữa.
- Chạy e2e `affiliate-ctv.miniapp.spec.ts` và `features.miniapp.spec.ts` (luồng /profile -> Cộng tác viên) sau khi merge, vì đã đổi DOM trang (PageHeader h1 "Cộng tác viên", `ListRow`, `ChoiceCard`) mà chưa chạy Playwright.

## Mục 2/4 — `pages/dealer.tsx` + `css/dealer-theme.css` (C-076) — XONG

Commit `bffc354` (trang + spec + css + script kiểm biến CSS cùng một commit).

### Số đo trước -> sau (`scripts/uiux/static-scan.mjs`: legacy / hex / emoji; ESLint trong `apps/miniapp`)

| File | legacy | hex | emoji | ESLint |
|---|---|---|---|---|
| `pages/dealer.tsx` | 125 -> 0 | 0 -> 0 | 3 -> 0 | 10 lỗi (1 `no-restricted-imports` Button ZaUI + 9 `no-raw-color` rgba trắng) -> 0 lỗi, 0 cảnh báo |
| `css/dealer-theme.css` (mới) | - | 0 (dòng khai báo token không tính) | 0 | - |

3 emoji cũ đều là ký tự chức năng `✓` (kết quả dán đơn, bậc thưởng đã đạt, phần thưởng đã đạt) -> `Icon` Check. Không còn emoji trong file.

### Đã làm

`css/dealer-theme.css` (mới, import từ `dealer.tsx`): `--color-dealer-ink #1f2a44`, `--color-dealer-ink-soft #2e3b5e`, `--color-dealer-bg #f4f6f9` (cùng giá trị cũ, nơi DUY NHẤT giữ hex) + `--color-dealer-accent: var(--forest-300)`. Họ `--dealer-*` trong `css/tokens.css` không còn ai dùng (chỉ `dealer.tsx` từng dùng), để điều phối viên xoá cùng khối legacy.

`pages/dealer.tsx`, 5 nhánh render (đang tải / lỗi / form đăng ký / chờ duyệt / hub) đều qua `DealerShell` = `Page` nền B2B + `PageHeader` (đúng một h1, C-114): "Kênh đại lý" (tải, lỗi, hub), "Đăng ký đại lý", "Hồ sơ đại lý" (khớp nhãn menu trong `profile.tsx`). Bỏ `className="page"` vì `PageHeader` tự đệm safe-top.
- ZaUI `Box`/`Text`/`Button`/`Sheet` -> `div` + `Text`/`Heading`/`Button`/`BottomSheet`/`Card` của DS; còn từ zmp-ui chỉ `Page`, `Input`, `useSnackbar`, `useNavigate`.
- Màu: hero, nút chính, giá, chip mẫu đơn giữ nhận diện navy qua `--color-dealer-*`; mọi chỗ còn lại dùng token v2 (`--color-text-*`, `--color-status-*`, `--color-border-subtle`, `--radius-card/control/pill`, `--elevation-1`). Chữ trắng mờ `rgba()` -> `tone="inverse"` + `opacity` (0,7 / 0,8 / 0,85 như cũ); thanh tiến độ trên nền navy dựng hai lớp (nền `--color-text-inverse` mờ 0,2, phần đã đạt `--color-dealer-accent`) để độ mờ không làm nhạt phần đã đạt.
- Vùng chạm 44px: 4 `TabChip` -> `SegmentedTabs` (role tablist/tab, aria-selected); ô tìm -> `SearchField` (nút xoá 44px có nhãn); "Lưu mẫu" (trước là `Box onClick`) -> `Button variant="ghost"`; chip mẫu đơn tách thành hai `<button>` thật cao 44px (tên mẫu + nút xoá `aria-label="Xoá mẫu đơn"`, `aria-disabled` khi đang xoá, trước là `Text onClick` và icon 13px); thẻ đơn hàng giữ `role="button"` + `aria-label` và thêm Tab/Enter/Space qua `rowKeyboardProps`.
- Sheet "Lưu mẫu đơn" và "Đặt nhanh — dán từ Excel/Sheet" -> `BottomSheet` (có h2 + nút đóng 44px; bỏ `calc(16px + var(--safe-bottom))` tự cộng vì ZaUI Sheet đã cộng, A4-020). Nút "Đóng" thứ hai trong sheet dán đơn bỏ vì trùng nút X của `BottomSheet`.
- Thanh tổng + đặt -> `StickyActionBar` (safe-area một lần, `Lưu mẫu` + tổng + ghi chú đặt trước + cảnh báo hạn mức + "Trả trước"/"Ghi công nợ"); đệm đáy danh sách tăng 150 -> `calc(220px + var(--safe-bottom))` vì thanh DS cao hơn.
- Nhãn trạng thái -> `Badge`: trạng thái đơn (cần thanh toán = warning, còn lại info), "Đặt trước N", pill đặt trước ở dòng giá, huy hiệu yêu cầu thưởng (info/success/danger/muted -> info/success/danger/neutral).
- Loading/empty/error: `Skeleton` (height/radius token), `ErrorState`, `EmptyState` cho "Không tìm thấy sản phẩm" và "Chưa có giao dịch công nợ" (trước là một dòng chữ); thanh tiến độ phần thưởng -> `ProgressBar`; `RewardIcon` định nghĩa trong thân render -> bảng `REWARD_ICON` cấp module.
- Tiêu đề khối "Sổ công nợ", "Bậc thưởng doanh số quý", "Phần thưởng đại lý", tiêu đề hero đăng ký/chờ duyệt -> `Heading` h2.
- KHÔNG đổi: mọi `queryKey`/lời gọi API, `Idempotency-Key` (`orderKey`, `payKey`), `payCredit(Number(amount), key, 'Báo đã chuyển khoản')`, điều kiện `overLimit`/`valid`/nút Dán đơn, công thức `applyPaste`/`preorderQty`/`realDiscountPct`/`pct`/`progress`, mọi con số hiển thị (công nợ, hạn mức, doanh số, thưởng, dư nợ, dấu +/- sổ công nợ), thứ tự khối, chuyển tới `/bank-payment/:code` sau đơn Trả trước, `/order/:code` khi bấm thẻ đơn.

### Test (đỏ -> xanh)

- `ds-c076-pc10b.spec.ts` (33 -> 38 ca): thêm `dealer.tsx` vào `FILES_PC10B` + `PAGES_WITH_PAGE_HEADER` trước khi di cư: 5 ca ĐỎ (alias legacy, rgb thô, `✓`, import ZaUI ngoài danh sách, PageHeader) -> XANH sau di cư.
- `pages/dealer.spec.tsx` (9 -> 28 ca). Trên code cũ: 11 ca ĐỎ, đúng các ca hành vi mới -> XANH sau di cư: đúng một h1 ở 6 trạng thái (tải, lỗi, đăng ký, bị từ chối, chờ duyệt, hub), tablist 4 tab có `aria-selected`, chip mẫu đơn là `<button>` thật, thẻ đơn có `tabindex=0` + Enter, kết quả dán đơn và bậc thưởng không còn ký tự `✓`. 8 ca khoá hành vi XANH ở cả code cũ lẫn mới (chứng minh không đổi): nạp mẫu đơn + xoá mẫu gọi `deleteTemplate('tp1')`, Trả trước gửi `PREPAID` rồi `navigate('/bank-payment/TUBU3')`, vượt hạn mức chặn "Ghi công nợ" nhưng cho "Trả trước", dán đơn cộng 3 x 80.000đ = 240.000đ và báo "Không khớp: SAI-SKU", lọc tìm kiếm rỗng, thẻ đơn (nhãn "Đặt trước 2 — chờ hàng về", "Thanh toán ngay →", 500.000đ, click -> `/order/TUBU9`), công nợ ("Báo đã CK" gọi `payCredit(1000000, <key>, 'Báo đã chuyển khoản')`, chặn 4.000.000đ > dư nợ 3.000.000đ), dấu +/- sổ công nợ, báo cáo quý (120.000.000đ, 14 đơn, 2.400.000đ, "Còn 80.000.000đ để đạt thưởng 3%", bậc, phần thưởng).
- Mock mới trong spec: `useLocation` của zmp-ui (BackButton trong `PageHeader`) và đủ hàm `dealer-api` để chạy tab công nợ/báo cáo/đơn.

### Lệnh kiểm chứng (output thật)

```
$ cd apps/miniapp && npx vitest run src/pages/dealer.spec.tsx src/ds-c076-pc10b.spec.ts src/ds-legacy-vars-4a.spec.ts \
    src/ds-legacy-vars-4b.spec.ts src/components/ui/button-guard.spec.ts src/components/ui/row-keyboard.spec.tsx \
    src/i18n/terminology.spec.ts src/pages/format-guard.spec.ts src/css
 Test Files  10 passed (10)
      Tests  165 passed (165)
$ npx eslint src/pages/dealer.tsx src/pages/dealer.spec.tsx src/ds-c076-pc10b.spec.ts   -> exit 0, không lỗi, không cảnh báo
$ npx tsc --noEmit                                  -> exit 0, không output
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ node scripts/uiux/static-scan.mjs && (cột: legacy hex emoji file)
0 0 0 apps/miniapp/src/css/dealer-theme.css
0 0 0 apps/miniapp/src/pages/dealer.tsx
```

### File ngoài nhóm bị sửa (tối thiểu)

`scripts/check-undefined-css-vars.mjs`: thêm `css/dealer-theme.css` (và sau đó `css/brand-theme.css`) vào danh sách file định nghĩa token vì `--color-dealer-*` khai báo ở đó nên `pnpm lint:vars` báo 5 tham chiếu "not defined". Bản đầu của mục này nạp MỌI `*.css` trong `css/` (nới guard); review lượt 1 chỉ ra, đã đưa về danh sách tường minh 5 file (xem mục "Review lượt 1").

### Giả định

1. Dealer không có nút "Quay lại" riêng nên giữ `PageHeader back="auto"` như các trang con khác.
2. Màu chữ/số "tốt" (`--leaf-700`: giảm nợ, mốc đã đạt, -X% giảm giá, dư nợ 0) -> `tone="brand"` (forest-600), cùng quyết định với affiliate; tăng nợ vẫn `tone="danger"`. Chuỗi "chưa khớp" khi dán đơn giữ màu đất sét cũ qua `--color-promo-fg`.
3. Tab đang chọn trước là nền navy chữ trắng; `SegmentedTabs` (DS) vẽ nền trắng chữ forest. Nhận diện navy còn ở thẻ hero, nút chính, giá và chip mẫu đơn.
4. Nút chính navy chỉ đè nền khi KHÔNG disabled; trước đây nền navy đè lên cả nút disabled nên nút tắt trông như đang bật.
5. Thanh tiến độ phần thưởng dùng `ProgressBar` (chỉ có tông brand/flash) nên mất khác biệt màu giữa "đã đạt" (xanh đậm) và "chưa đạt" (xanh nhạt); "đã đạt" vẫn thể hiện bằng icon Check và màu chữ tiêu đề. Chữ hero lớn (28px/26px) -> `price-xl` 24px; icon hero 32px -> 24px (`Icon` lg), riêng icon trang chờ duyệt giữ 48px bằng `style`.
6. Điểm nhấn trên nền navy đổi từ `--leaf-400` (forest-400, tương phản 3,9:1, trượt AA cho chữ nhỏ) sang `--forest-300` (6,0:1), đây là thay đổi màu có chủ ý duy nhất.
7. Chuỗi "TubuXu": không có trong `dealer.tsx`.

### Việc còn lại / phát hiện ngoài phạm vi

- `services/dealer-api.ts` `rewardClaimView` còn trả nhãn "Đã trao thưởng ✓" và hint có emoji 🎉/🌿 (nội dung từ service, ngoài nhóm file của gói): với `claimStatus=PAID` badge vẫn hiện `✓`. Chưa sửa; nên đổi nhãn thành "Đã trao thưởng" (dealer.spec chưa có ca PAID, e2e không kiểm nhãn này).
- `components/ui/quantity-selector.tsx` (dùng trong `PriceRow`) vẫn còn alias `--neutral-*`/`--radius-md`, đã nằm ngoài gói; scan toàn app sẽ còn đếm file này.

### Đề xuất cho điều phối viên

- Xoá ba biến `--dealer-ink/-soft/-bg` và ghi chú "Ngoại lệ duy nhất: --dealer-*" trong `css/tokens.css` (khối LEGACY): không còn tham chiếu nào, và `ds-legacy-vars-4b.spec.ts`/`ds-c076-pc10b.spec.ts` vẫn giữ regex `var\(--dealer-` để chặn quay lại.
- `SegmentedTabs`/`Button` chưa có biến thể màu theo theme trang; nếu muốn tab và nút chính của dealer đậm màu navy đồng bộ, cần prop `accent` hoặc đọc biến `--color-action-primary-bg` do trang ghi đè ở `Page` (thay vì `style` từng nút).
- Chạy e2e `dealer-rewards.miniapp.spec.ts` sau khi merge: DOM đã đổi (PageHeader h1, `SegmentedTabs`, `Badge`, `Button` thay `Box`); locator `getByText('Báo cáo', { exact: true })`, `getByRole('button', { name: 'Yêu cầu nhận thưởng' })`, bộ lọc `div` của `rewardRow` đã đọc tĩnh và vẫn khớp, nhưng CHƯA chạy Playwright (quy định máy).

## Mục 3/4 — `storefront-builder.tsx`, `storefront-context-bar.tsx`, `content-kit-sheet.tsx`, `share-sheet.tsx` (C-076) — XONG

Bốn commit, mỗi file một commit, guard spec + spec riêng đi cùng file:

| Commit | Nội dung |
|---|---|
| 6744285 | `components/storefront-context-bar.tsx` + `storefront-context-bar.spec.tsx` (mới) + dòng trong guard |
| eb3e40e | `components/share-sheet.tsx` + `share-sheet.spec.tsx` + dòng trong guard |
| ce4153e | `components/content-kit-sheet.tsx` + `content-kit-sheet.spec.tsx` + dòng trong guard |
| b24cfd1 | `pages/storefront-builder.tsx` + `storefront-builder.spec.tsx` (mới) + `utils/storefront-theme.ts` (+ spec, mới) + dòng trong guard (cả `FILES_PC10B` lẫn `PAGES_WITH_PAGE_HEADER`) |

### Số đo trước -> sau (`scripts/uiux/static-scan.mjs`: legacy / hex / emoji; ESLint trong `apps/miniapp`)

| File | legacy | hex | emoji | ESLint |
|---|---|---|---|---|
| `pages/storefront-builder.tsx` | 88 -> 0 | 8 -> 0 | 2 -> 1 | 1 lỗi `no-restricted-imports` (Button ZaUI) -> 0 lỗi, 0 cảnh báo |
| `components/storefront-context-bar.tsx` | 4 -> 0 | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| `components/content-kit-sheet.tsx` | 10 -> 0 | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| `components/share-sheet.tsx` | 3 -> 0 | 0 -> 0 | 3 -> 3 | 0 -> 0 |
| `utils/storefront-theme.ts` (mới) | - | 5 (dữ liệu API, xem dưới) | 0 | 0 |

Emoji còn lại là NỘI DUNG, giữ có chủ ý: `🎉` trong snackbar nhận thưởng nhiệm vụ (`storefront-builder.tsx`); `🌿 💚 🌱` trong 3 caption mẫu để CTV sao chép đăng mạng xã hội (`share-sheet.tsx`). Ký tự chức năng `✓` (nhiệm vụ đã nhận) đã thay bằng `Icon` Check.

Cột hex của `utils/storefront-theme.ts` = 5 là CÓ CHỦ Ý: đó là bảng màu chủ đạo gian hàng gửi lên API (`themeColor`, DTO `PATCH /storefront/me` chỉ nhận `#rrggbb`, `storefront.controller.ts:21`; trang web công khai dùng nguyên chuỗi để tô gian hàng) nên không thể là `var(--token)`. Trước đây 5 hex này (cùng `'#16a34a'` mặc định) rải trong `.tsx` cùng `#000`/`#fff`/`rgba(0,0,0,.2)` của viền ô màu; nay hex chỉ còn ở một bảng dữ liệu, viền ô màu dùng token. File này không thuộc `FILES_PC10B` nên guard spec không quét nó; `static-scan.mjs` vẫn đếm 5.

### Đã làm

`components/storefront-context-bar.tsx`: `Box`/`Text` ZaUI -> `div` + `Text`/`Icon` DS; nền `--color-bg-surface`, bóng `--elevation-1`. "Về Tubu Tree" trước là `Text onClick` (không phải nút, không bàn phím, cao ~15px) -> `Button variant="ghost"` (cao 44px, Tab/Enter). Thanh vì thế cao 44px thay vì ~30px: chấp nhận để đạt vùng chạm.

`components/share-sheet.tsx`: `Sheet` ZaUI + `Box p={4}` + `calc(16px + var(--safe-bottom))` tự cộng -> `BottomSheet` (tiêu đề h2 `vi.storefront.shareTitle`, nút đóng 44px, KHÔNG cộng safe-area thêm lần nữa, A4-020). Caption gợi ý trước là `Box onClick` -> `<button>` thật cao >= 44px, nền `--color-bg-subtle`, `--radius-control`. Hai nút chính giữ nguyên (đã là DS `Button`), bỏ `marginBottom` rải rác bằng khối flex `gap: 8`. `useShareWithFallback` KHÔNG đổi.

`components/content-kit-sheet.tsx`: bỏ `Box`/`Sheet`/`Text`/`Button` ZaUI. `BottomSheet` (tiêu đề h2) + khối cuộn `maxHeight: 70vh` (giữ hành vi cuộn cũ 80vh, chừa chỗ cho tiêu đề). Hai nút `Button` ZaUI (nền `--primary-600` ép tay, icon trong `<span>`) -> `Button` DS có `icon`/`onPress` (bỏ ép màu, DS đã dùng `--color-action-primary-bg`). Bài mẫu và video trước là `Box onClick` -> `CopyRow` = `<button>` thật >= 44px. Mỗi mục có tiêu đề `h3` (`Section`), điểm bán hàng thành `ul/li` thay cho ký tự `•`. Ảnh `--radius-md` -> `--radius-media`. Loading/error giữ `Skeleton`/`ErrorState`.

`pages/storefront-builder.tsx` (4 nhánh render: đang tải / 404 chưa có gian hàng / lỗi tải / Builder): cả bốn qua `BuilderShell` = `Page` nền `--color-bg-canvas` + `PageHeader` "Gian hàng của tôi" (đúng một h1, C-114); bỏ `className="page"` vì `PageHeader` tự đệm safe-top. Từ zmp-ui còn `Page`, `Input`, `useSnackbar`, `useNavigate`.
- Tên gian hàng -> `Heading` h2, trạng thái Đăng/Nháp -> `Badge` (success/neutral, chữ giữ nguyên); hai nút "Sửa hồ sơ"/"Cấu hình" xếp một hàng riêng dưới tiêu đề (cùng cao 44px, mỗi nút `flex: 1`) thay vì ép chung hàng với tên.
- Thẻ hồ sơ (ảnh bìa + avatar + lời nhắn): vẫn `role="button"` + `aria-label`, thêm Tab/Enter/Space qua `rowKeyboardProps`; gradient ảnh bìa mặc định `--leaf-100 -> --primary-100` -> `--sage-100 -> --forest-100`.
- Bộ sưu tập/Thống kê/Hành trình -> `Card`; hàng sản phẩm: giá `PriceTag size="sm"`, đổi tên/xoá bộ sưu tập, ghim/ẩn/xoá sản phẩm trước là `Box role="button"` 15-16px (có chỗ min 36px) -> `RowIconButton` cục bộ 44x44 (có `aria-label`, cho chỉnh tông icon: xoá đỏ, ghim/hiện xanh khi bật; `IconButton` DS chưa có `tone`). "Thêm lý do giới thiệu" (trước là `Text onClick`) -> `<button>` 44px; "Nội dung" -> `Button variant="ghost"`; hai điều khiển này nằm hàng thứ hai của mỗi sản phẩm để hàng đầu còn chỗ cho tên + 3 nút icon 44px ở màn 360px.
- Thanh đáy cố định tự dựng -> `StickyActionBar` ("Xem trước" secondary + "Lưu & Đăng" primary, safe-area một lần); đệm đáy trang `96px` -> `calc(100px + var(--safe-bottom))`.
- 7 `Sheet` ZaUI -> `BottomSheet` (mẫu/chọn sản phẩm/đổi tên/xoá bộ sưu tập/cấu hình/hồ sơ/lý do giới thiệu/xoá sản phẩm): có tiêu đề h2, nút đóng 44px, bỏ mọi `calc(.. + var(--safe-bottom))` tự cộng. Nút xoá trong sheet xác nhận -> `Button variant="danger"`.
- Nút `loading` + `disabled` cùng lúc (spinner không bao giờ hiện với ZaUI, A4-007) -> chỉ `loading`; DS `Button` tự chặn bấm lại khi đang chạy. Riêng nhận thưởng nhiệm vụ: nút đang nhận `loading`, các nút nhận khác `disabled` (giữ đúng ý "đang nhận một thưởng thì không nhận thưởng khác").
- Ô chọn màu thương hiệu trước là `Box onClick` 32px không nhãn/không vai trò (màu chọn chỉ nhìn viền #000) -> `ThemeSwatch` = `<button aria-pressed aria-label="Xanh dương"...>` vùng chạm 44px, hình tròn 32px; bảng màu chuyển sang `utils/storefront-theme.ts`.
- Ô chọn mẫu theo danh mục: `Box role="button"` -> `<button aria-label="Dùng mẫu ..." >` min 44px, logic `busy` giữ nguyên.
- Form cấu hình: "Tên gian hàng"/"Subdomain riêng" dùng `Field` (nhãn gắn vào ô nhập); 7 ô chỉ có placeholder được thêm `aria-label` cùng chữ (không thêm nhãn hiển thị mới).
- Loading/empty/error: ô chọn sản phẩm thêm `Skeleton` khi tải và `EmptyState` khi không có kết quả (trước là vùng trống); lỗi giữ `ErrorState` (nay `variant="inline"` trong sheet). Thanh nhiệm vụ -> `ProgressBar` (giữ guard chia cho 0).
- KHÔNG đổi: mọi `queryKey`/lời gọi API và payload (`createStorefront`, `applyStorefrontTemplate(categoryId)`, `createCollection({title})` đã cắt khoảng trắng, `updateCollection(id,{title})`, `updateItem` cho ghim/ẩn/ghi chú, `removeItem(id)`, `deleteCollection(id)`, `addItem(collectionId,{productId})`, `publishStorefront(true)`, `updateStorefront` của hồ sơ và cấu hình, `claimQuest(code)`), điều kiện bật/tắt nút, thứ tự các khối, số hiển thị (giá ưu tiên giá khuyến mãi, thống kê 30 ngày, tiến độ n/m, tổng xu), chuyển tới `/s/:slug` khi xem trước gian hàng đã đăng, cảnh báo khi còn nháp.

### Test (đỏ -> xanh)

- `ds-c076-pc10b.spec.ts` (38 -> 55 ca): thêm từng file TRƯỚC khi di cư. `storefront-context-bar`: 2 ca ĐỎ (alias, ZaUI) -> XANH. `share-sheet`: 2 ĐỎ -> XANH. `content-kit-sheet`: 2 ĐỎ -> XANH. `storefront-builder`: 5 ĐỎ (alias, màu thô, ký tự `✓`, ZaUI, PageHeader/h1) -> XANH.
- `components/storefront-context-bar.spec.tsx` (mới, 4 ca): không ở trong gian hàng thì không vẽ; nhãn ngữ cảnh + nút; bấm xoá ngữ cảnh rồi `navigate('/')`; nút >= 44px. Trên code cũ 3 ca ĐỎ (không có `role=button`) -> XANH.
- `components/share-sheet.spec.tsx` (5 -> 10 ca): 3 ca ĐỎ trên code cũ (tiêu đề h2 + nút Đóng, caption là nút >= 44px chép đúng nội dung kèm liên kết có mã, 3 caption mặc định là nút) -> XANH; 2 ca khoá hành vi (Sao chép link có `?ref=`, copy thất bại báo lỗi) XANH ở cả hai.
- `components/content-kit-sheet.spec.tsx` (4 -> 11 ca): 4 ca ĐỎ trên code cũ (h2 + nút Đóng, hai nút chính >= 44px, bốn khối có `h3`, bài mẫu/video là nút >= 44px chép đúng nội dung) -> XANH; 3 ca khoá hành vi (báo rỗng, Thử lại gọi lại API, copy thất bại) XANH ở cả hai.
- `pages/storefront-builder.spec.tsx` (mới, 35 ca). Chạy trên code cũ trước khi di cư: 11 ca ĐỎ, đúng các hành vi mới (đúng một h1 ở 4 trạng thái, tên gian hàng h2, ô chọn mẫu là nút 44px, 5 nút icon >= 44px, ô chọn sản phẩm có trạng thái rỗng, ba ca ô màu `aria-pressed`/44px/màu đã lưu, nhiệm vụ đã nhận không còn `✓`) -> sau di cư XANH. 21 ca khoá hành vi XANH ở cả code cũ lẫn mới, chứng minh không đổi: chọn mẫu/bỏ qua mẫu, ghim/ẩn/xoá (xoá phải xác nhận), đổi tên/xoá bộ sưu tập (Hủy không gọi API), tạo bộ sưu tập cắt khoảng trắng, thêm sản phẩm `addItem`, ghi chú đã cắt, đăng/xem trước (nháp báo cảnh báo, đã đăng `navigate('/s/shop-aff-1')`), lưu hồ sơ, payload cấu hình mặc định (`themeColor '#16a34a'`, trường rỗng -> `undefined`), thống kê, nhận thưởng + snackbar. Thêm sau di cư 3 ca mới XANH: tên truy cập của 9 ô nhập cấu hình, nút đăng báo bận và không đăng hai lần, nhận thưởng đang chạy khoá nút khác.
- `utils/storefront-theme.spec.ts` (mới, 3 ca): mọi màu `#rrggbb`, không trùng mã/nhãn, mặc định `#16a34a` khớp API. Đỏ vì chưa có module -> xanh.
- Cũng đổi `typeof import('zmp-ui')` -> `Record<string, unknown>` ở `share-sheet.spec.tsx` và `content-kit-sheet.spec.tsx` (cảnh báo có sẵn `consistent-type-imports`).

### Lệnh kiểm chứng (output thật)

```
$ cd apps/miniapp && npx vitest run src/pages/storefront-builder.spec.tsx src/components/storefront-context-bar.spec.tsx \
    src/components/share-sheet.spec.tsx src/components/content-kit-sheet.spec.tsx src/utils/storefront-theme.spec.ts \
    src/ds-c076-pc10b.spec.ts src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/components/ui \
    src/i18n/terminology.spec.ts src/pages/format-guard.spec.ts src/css src/pages/affiliate.spec.tsx \
    src/pages/dealer.spec.tsx src/pages/cart.spec.tsx src/pages/product-detail.spec.tsx src/pages/brand-owner.spec.tsx
 Test Files  48 passed (48)
      Tests  479 passed (479)
$ npx eslint src/pages/storefront-builder.tsx src/pages/storefront-builder.spec.tsx src/components/storefront-context-bar.tsx \
    src/components/storefront-context-bar.spec.tsx src/components/share-sheet.tsx src/components/share-sheet.spec.tsx \
    src/components/content-kit-sheet.tsx src/components/content-kit-sheet.spec.tsx src/utils/storefront-theme.ts \
    src/utils/storefront-theme.spec.ts src/ds-c076-pc10b.spec.ts      -> exit 0, không lỗi, không cảnh báo
$ npx tsc --noEmit                                  -> exit 0, không output
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ node scripts/uiux/static-scan.mjs && (cột: legacy hex emoji file)
0 0 0 apps/miniapp/src/components/content-kit-sheet.tsx
0 0 3 apps/miniapp/src/components/share-sheet.tsx
0 0 0 apps/miniapp/src/components/storefront-context-bar.tsx
0 0 1 apps/miniapp/src/pages/storefront-builder.tsx
0 5 0 apps/miniapp/src/utils/storefront-theme.ts
```

### File ngoài nhóm bị sửa (tối thiểu)

`apps/miniapp/src/utils/storefront-theme.ts` + `.spec.ts` (mới): bảng màu chủ đạo gian hàng. Không nằm trong danh sách file của gói nhưng là file MỚI nhỏ, cần để `storefront-builder.tsx` đạt hex = 0 mà vẫn gửi đúng `#rrggbb` lên API. Không sửa file nào khác ngoài nhóm.

### Giả định

1. Tiêu đề trang là "Gian hàng của tôi" (`vi.storefront.title`, khớp nút trong dashboard CTV); ở nhánh 404 `EmptyState` giữ `heading` cũ cùng chữ nên trang hiện hai dòng cùng chữ (h1 + tiêu đề trạng thái rỗng), không đổi nội dung `EmptyState` để khỏi sửa chữ.
2. Sheet dựng bằng `BottomSheet` có `unmountOnClose`, nên hai nội dung trước đây dựng sẵn khi chưa mở nay chỉ dựng khi mở: (a) `GET /categories` của ô chọn mẫu chạy khi mở sheet (cùng endpoint, cùng tham số; trước đây chạy ngay khi vào trang 404); (b) form cấu hình đọc lại `sf` mới mỗi lần mở, không còn giữ giá trị cũ sau khi lưu (trước đây đây là một lỗi ngầm: mở lại sau khi lưu vẫn thấy dữ liệu trước lúc lưu).
3. Nút nhận thưởng nhiệm vụ: "cấm nhận hai thưởng cùng lúc" được giữ bằng `disabled` cho các nút còn lại, nút đang chạy dùng `loading` (hiện spinner, DS chặn bấm lại).
4. Thanh tiến độ nhiệm vụ dùng `ProgressBar` DS (6px, một tông) nên mất khác biệt màu "đạt" (xanh đậm) và "chưa đạt" (xanh nhạt); trạng thái vẫn thể hiện qua `Badge` "Đã nhận", nút nhận thưởng và icon Check.
5. Màu "Hoa hồng" (`--leaf-700`) -> `tone="brand"`; chữ phụ `--neutral-400` -> `tertiary`, `--neutral-500/600` -> `tertiary/secondary`; nền `--neutral-0/-50` -> `--color-bg-surface/-canvas`, `--leaf-50` -> `--color-bg-subtle`; thẻ trước không có bóng nay có `--elevation-1` (mặc định của `Card`).
6. Giá sản phẩm trong gian hàng dùng `PriceTag size="sm"` (màu giá `--color-text-price`) thay cho chữ forest; chuỗi vẫn là `formatVnd(...)`.
7. Nhãn nút "+ Thêm sản phẩm", "+ Tạo bộ sưu tập", "+ Thêm" -> icon `Plus` + nhãn không có dấu `+` (nút trong DS có prop `icon`); tên truy cập đổi theo.
8. Chuỗi "TubuXu" cũ còn trong `storefront-builder.tsx` ("Hành trình gian hàng" nhận TubuXu, snackbar `+N TubuXu 🎉`): không thêm chữ mới, để PD-3 gộp vào Điểm Xanh. Chuỗi "Hủy" (`vi.common.cancel`) và "Huỷ" (cứng trong file) không đồng nhất sẵn có; giữ nguyên từng chỗ, không gộp.
9. Thống kê và Hành trình vẫn `return null` khi đang tải/lỗi (không thêm `Skeleton`/`ErrorState`) vì là khối phụ và trước đây cũng ẩn.

### Việc còn lại / phát hiện ngoài phạm vi

- `vi.storefront.backToTubu` = `'⤺ Về Tubu Tree'` còn ký tự mũi tên làm icon (ở `i18n/vi.ts`, ngoài nhóm file): nên bỏ ký tự và để `storefront-context-bar.tsx` thêm `Icon`.
- `components/ui/empty-state.tsx` còn `Button`/`Text` ZaUI và `ErrorState` dùng `ZmpButton` (không có `onPress` khoá bấm lại).
- Nhãn "Hủy"/"Huỷ" không đồng nhất trong `i18n` và trong file này (xem Giả định 8).

### Đề xuất cho điều phối viên

- `IconButton` thêm prop `tone` (`default | muted | brand | danger`): hiện hai trang CTV phải tự viết nút icon 44px chỉ để giữ icon xoá màu đỏ và icon ghim/hiện màu xanh (`RowIconButton` trong `storefront-builder.tsx`, `Stepper` trong `ctv-order-sheet.tsx`). Khi có, thay `RowIconButton` bằng `IconButton`.
- `ProgressBar` thêm tông `success`/`muted` để phân biệt nhiệm vụ đã đạt/đã nhận.
- `static-scan.mjs` đếm hex trong `utils/storefront-theme.ts` (bảng dữ liệu bắt buộc là `#rrggbb` do API). Nếu muốn tổng hex toàn app về 0 thì cần danh sách ngoại lệ theo đường dẫn cho các bảng dữ liệu kiểu này (`brand-theme`/`brands.ts` ở mục 4/4 có thể gặp cùng vấn đề).
- Chạy e2e `features.miniapp.spec.ts` (luồng "Gian hàng Cộng tác viên") và `design-system-pilot.miniapp.spec.ts` sau khi merge: DOM trang builder đổi (PageHeader h1, `Card`, `BottomSheet`, `Button`), locator `getByText('Cửa hàng Xanh của Affiliate 1').first()` đã đọc tĩnh và vẫn khớp (tên gian hàng còn hiện ở `h2`), nhưng CHƯA chạy Playwright (quy định máy). Cũng kiểm bằng mắt trên máy thật: hàng sản phẩm (tên + 3 nút icon 44px) ở màn 320-360px, thanh `StickyActionBar` không che nút "Thêm sản phẩm" cuối trang.

## Mục 4/4 — C-079 (liên kết Hành trình nguyên liệu và nhãn) + `brand-story`, `brand-owner`, `brand-view`, `utils/brands.ts` (C-076) — XONG

Bốn commit (mỗi trang một commit, guard spec + spec riêng đi cùng trang):

| Commit | Nội dung |
|---|---|
| 87981e4 | C-079: `utils/brand-origins.ts` (mới) + `brandBrowsePath` + `css/brand-theme.css` (mới) + `utils/brands.ts` + liên kết tên nhãn ở `product-detail.tsx` + 2 ✓ -> `Icon` + spec |
| 222e716 | `pages/brand-story.tsx` + `brand-story.spec.tsx` + bảng màu bản đồ trong `brand-theme.css` + dòng guard |
| e8ccd92 | `pages/brand-owner.tsx` + `brand-owner.spec.tsx` + dòng guard |
| ac246b4 | `pages/brand-view.tsx` + `brand-view.spec.tsx` (mới) + dòng guard |

### C-079 — nguyên nhân và cách sửa

- API `GET /products?brand=` so khớp CHÍNH XÁC cột `products.brand` (`catalog.service.ts:156-161`: `where.brand = brandList[0]`, nhiều nhãn cách nhau dấu phẩy). Tham số là TÊN nhãn đúng như catalog, không phải slug, không phân biệt gì khác.
- Dữ liệu seed/migration (`prisma/seed.ts`, `20260616000000_demo_catalog_multibrand`) có 8 nhãn: `BH.Nong`, `Cobote`, `Fuwa3e`, `Hector`, `Le Plateau Coffee`, `Pơ Lang`, `Sokfram`, `Visante`. `brand-story.tsx` cũ truyền "Le Plateau" và "Sokfarm" nên 2/8 nút ra danh sách rỗng (6/8 khớp chỉ vì tên hiển thị tình cờ trùng tên catalog).
- Sửa: dữ liệu 8 nhãn tách sang `utils/brand-origins.ts`, mỗi nhãn có `catalogBrand` (tên catalog) tách khỏi `brand` (tên hiển thị); `brandBrowsePath(catalogBrand)` dựng `/browse?brand=<tên mã hoá>` (cắt khoảng trắng, rỗng thì `/browse`). Nút "Khám phá sản phẩm" và tên nhãn ở trang chi tiết sản phẩm đều đi qua hàm này. PDP dùng `p.brand` của chính sản phẩm nên đúng tên catalog theo cấu tạo.
- KHÔNG sửa API, KHÔNG đổi chữ hiển thị.

Lệnh kiểm chứng thay cho `curl` (API không chạy trong lượt này; truy vấn chỉ-đọc vào DB test cục bộ `tubutree_it`, cùng phép so khớp mà API dùng):

```
$ docker exec tubu_it_main psql -U tubu -d tubutree_it -At -c "select brand, count(*) from products where brand=... "
Le Plateau | 0          <- tên cũ ở brand-story
Le Plateau Coffee | 5    <- tên mới
Sokfarm | 0
Sokfram | 5
```

### Số đo trước -> sau (`scripts/uiux/static-scan.mjs`: legacy / hex / emoji; ESLint trong `apps/miniapp`)

| File | legacy | hex | emoji | ESLint |
|---|---|---|---|---|
| `pages/brand-story.tsx` | 15 -> 0 | 102 -> 0 | 11 -> 1 | 13 lỗi (1 `no-restricted-imports` + 12 `no-raw-color`) -> 0 lỗi, 0 cảnh báo |
| `pages/brand-owner.tsx` | 19 -> 0 | 0 -> 0 | 1 -> 0 | 0 -> 0 |
| `pages/brand-view.tsx` | 0 -> 0 | 0 -> 0 | 7 -> 3 | 0 -> 0 |
| `utils/brands.ts` | 1 -> 0 | 17 -> 0 | 0 -> 0 | 0 -> 0 |
| `pages/product-detail.tsx` (chỉ vùng nhãn + emoji) | 0 -> 0 | 0 -> 0 | 3 -> 1 | 0 -> 0 |
| `css/brand-theme.css` (mới, nơi DUY NHẤT giữ hex nhãn/bản đồ) | - | 0 (dòng khai báo token không tính) | 0 | - |
| `utils/brand-origins.ts` (mới) | 0 | 0 | 8 | 0 |

Emoji còn lại là NỘI DUNG, giữ có chủ ý: `🌿` trong câu giới thiệu của `brand-story` ("khám phá xuất xứ 🌿"); `💚` snackbar theo dõi nhãn và `🌿`/`💚` trong 2 caption mẫu để CTV sao chép (`brand-view`); `🛒` snackbar mở nhóm mua chung (`product-detail`); 8 emoji đặc trưng từng nhãn (🍍 🍯 🥑 🌊 🍄 ☕ 🥥 🌴) là dữ liệu nội dung của ô nhãn và ghim bản đồ trong `brand-origins.ts`. Ký tự chức năng `✓`, `↗`, `+`, `📍`, `🌿` làm huy hiệu/avatar đã thay bằng `Icon` Lucide.

### Đã làm

`css/brand-theme.css` (mới) + `utils/brands.ts` + `utils/brand-origins.ts`:
- `--color-brand-<id>` (11 nhãn, chấm/chip), `--color-brand-<id>-from/-to` (8 nhãn, hai đầu gradient ô nhãn), `--color-brandmap-*` (khung, LED, thang gỗ nâu 100..900, cờ, sao, tiêu đề). Hex chỉ nằm ở file này; `.tsx/.ts` chỉ tham chiếu `var(--...)`.
- `brandAccent(brand)` trả `var(--color-brand-<id>)`; nhãn lạ trả `var(--color-action-primary-bg)` (cùng giá trị forest-600 với `--primary-600` cũ). Có chuẩn hoá NFC để "Pơ Lang" gõ dạng tổ hợp vẫn khớp. `brands.ts` tự `import '../css/brand-theme.css'` để mọi nơi gọi (`product-tile`, `product-card`, PDP) có token mà không phụ thuộc trang nào nạp CSS (không đụng `app.tsx`).

`pages/brand-story.tsx` (trang, một h1):
- `PageHeader` "Hành trình nguyên liệu" (`vi.home.brandStoryTitle`); ZaUI `Box`/`Text`/`Button`/`Sheet` -> `div` + `Text`/`Heading`/`Button`/`BottomSheet`/`Icon` của DS; từ zmp-ui còn `Page`, `useNavigate`.
- 8 ô nhãn và 8 ghim bản đồ trước là `Box onClick` (không bàn phím, không vai trò) -> `<button>` thật; ô cao >= 135px, ghim `minWidth/minHeight 44`; ghim giữ `aria-label="<nhãn> — <tỉnh>"`. Tiêu đề nhóm -> `Heading` h2 (số 8 lấy từ `BRAND_ORIGINS.length`, chữ in ra không đổi).
- Sheet chi tiết -> `BottomSheet` (tiêu đề h2 = tên nhãn, nút Đóng 44px, không tự cộng safe-area): khối gradient chỉ còn emoji + "📍 tỉnh · nguyên liệu" (đổi `📍` sang `Icon` MapPin), tên nhãn nằm ở tiêu đề sheet.
- Bản đồ SVG: 258 dòng giữ NGUYÊN hình học; chỉ đổi 16 màu hex thành `var(--color-brandmap-*)` / `--color-text-inverse` và thêm `role="img"`. Kiểm chứng: dựng cả bản cũ lẫn mới, thay `var()` bằng giá trị trong `brand-theme.css` rồi so `outerHTML` -> trùng từng ký tự (ngoài `role="img"`). Nền khung `--neutral-200` -> `--stone-200` (cùng giá trị), bóng -> `--elevation-1/2`, `--radius-xl/-lg/-full` -> `--radius-sheet/-card/-pill`.
- KHÔNG đổi: `haptic('light')` khi chọn, nội dung 8 câu chuyện, vị trí ghim, nút "Khám phá sản phẩm {tên hiển thị}" đóng sheet rồi mới điều hướng.

`pages/brand-owner.tsx` (trang, một h1 ở cả 4 nhánh: tải, 404, lỗi, trình sửa):
- `OwnerShell` = `Page` + `PageHeader` "Quản lý nhãn hàng" (khớp nhãn menu `profile.tsx`); từ zmp-ui còn `Page`, `Input`, `useSnackbar`, `useNavigate`. Tên nhãn -> `Heading` h2, trạng thái "Chính hãng"/"Chưa xác minh" và "Đang hiển thị"/"Nháp (admin duyệt)" -> `Badge` (bỏ dấu "·" ngăn cách), "N theo dõi" -> `Text`.
- Hai khối -> `Card`; tiêu đề khối -> `Heading` h2; 3 ô có nhãn (Tagline, Nguồn gốc, Câu chuyện) -> `Field` (nhãn gắn vào ô bằng `<label htmlFor>`, trước đây `label` của ZaUI không gắn: tên truy cập rỗng); 3 ô chỉ có placeholder thêm `aria-label` cùng chữ; ô ngày giữ `minHeight 44`, viền/bo góc đổi sang token; "+ Thêm khuyến mãi" -> `Button icon={Plus}` nhãn "Thêm khuyến mãi"; sheet xoá khuyến mãi -> `BottomSheet` (tiêu đề h2 "Xoá khuyến mãi này?").
- KHÔNG đổi: `queryKey`, `promoIso`, quy tắc `dateRangeInvalid`, payload thêm/sửa/xoá (ô mã trống khi sửa -> `couponCode: ''` để gỡ mã), "Xem trang nhãn" (nháp -> cảnh báo, đã đăng -> `/brand/:slug`), tab Doanh thu.

`pages/brand-view.tsx` (trang):
- Nhánh đang tải/lỗi trước không có h1 và không có lối quay lại -> `PageHeader` "Nhãn hàng"; nhánh đã tải: h1 là tên nhãn (do `StorePageShell`). Bỏ ZaUI `Box` (còn `Page`, `useParams`, `useNavigate`, `useSnackbar`).
- `✓ Chính hãng`, `✓ Đang theo dõi`/`+ Theo dõi`, `↗ Chia sẻ`, `🌿` ở huy hiệu chứng nhận và avatar mặc định -> `Icon` Check/Plus/Share2/Leaf (nhãn nút: "Theo dõi", "Đang theo dõi", "Chia sẻ").
- Chip mã khuyến mãi: `Box role=button` cao 36px -> `<button>` cao >= 44px (giữ `aria-label="Sao chép mã ..."`); banner share-to-earn: `Box onClick` -> `<button>` (bàn phím, min 44px).
- KHÔNG đổi: mọi `queryKey`/lời gọi API, thông báo theo dõi, chép mã (`Đã chép mã X — dán ở bước thanh toán` / `Mã giảm giá: X`), chuyển `/dealer`, `/product/:slug`, tham số `ShareSheet` (kể cả 2 caption có emoji).

`pages/product-detail.tsx` (CHỈ vùng nhãn và emoji): chấm màu + tên nhãn thành `<button>` cao 44px (kèm icon `ChevronRight`) gọi `navigate(brandBrowsePath(p.brand))`; `✓` ở chip chứng nhận và ở danh sách "Cam kết Tubu" -> `Icon` Check. Không đổi chỗ nào khác trong file.

### Test (đỏ -> xanh)

- `utils/brands.spec.ts` (mới, 38 ca): `brandBrowsePath` (mã hoá, rỗng, cắt khoảng trắng); `BRAND_ORIGINS` có 8 nhãn, MỖI `catalogBrand` có thật trong `apps/api/prisma/seed.ts` (chống lệch tên với catalog, nguyên nhân gốc C-079); URL giải mã về đúng tên; mỗi nhãn có màu `var(--color-brand-*)`; `brand-theme.css` khai báo đủ `--color-brand-<id>`, `-from`, `-to`. Đỏ vì chưa có module -> xanh.
- `pages/brand-story.spec.tsx` (mới, 15 ca). 9 ca C-079 (8 nhãn + 1 ca gộp "hai nhãn từng rỗng"): chạy trên mã `brand-story.tsx` cũ cho 3 ca ĐỎ đúng 2 nhãn hỏng (Le Plateau -> kỳ vọng `Le%20Plateau%20Coffee`, Sokfarm -> `Sokfram`) và ca gộp; 6 nhãn còn lại xanh -> sau sửa xanh cả 9. 6 ca cấu trúc (một h1, 8 ô lưới là nút >= 44px, 8 ghim >= 44px, sheet có h2/tỉnh/nguyên liệu/câu chuyện/nút Đóng, bản đồ `role=img`, "Khám phá" đóng sheet) trên mã cũ 5 ĐỎ -> xanh sau di cư.
- `pages/product-detail-brand.spec.tsx` (mới, 3 ca): tên nhãn là nút gọi `navigate('/browse?brand=Le%20Plateau%20Coffee')`, cao >= 44px, không còn `✓`: 3 ĐỎ -> xanh.
- `pages/brand-owner.spec.tsx` (8 -> 20 ca): 2 ca cũ đổi tên nút "+ Thêm khuyến mãi" -> "Thêm khuyến mãi"; 9 ca mới ĐỎ trên mã cũ (một h1 ở 4 trạng thái, tên nhãn h2, huy hiệu không `✓`, nhãn chưa xác minh/nháp, `getByLabelText('Tagline')`, sheet xoá có h2, khoá nút thêm khi ngày sai) -> xanh; 3 ca khoá hành vi xanh ở cả hai (Xem trang nhãn đã đăng/nháp, xác nhận xoá gọi `deleteOwnedPromotion('p1')`).
- `pages/brand-view.spec.tsx` (mới, 16 ca): 10 ca khoá hành vi XANH trên mã cũ (nội dung các khối, follow/unfollow theo slug, chép mã + chép lỗi, bấm sản phẩm, `/dealer`, banner share-to-earn, Chia sẻ); 6 ca ĐỎ trên mã cũ (một h1 khi tải và khi lỗi, không còn `✓ ↗`, huy hiệu chứng nhận không emoji, chip mã >= 44px, banner là `<button>`) -> xanh.
- `ds-c076-pc10b.spec.ts` (55 -> 79 ca): thêm `brand-story.tsx` (4 ĐỎ: alias, màu thô, ZaUI, PageHeader), `brand-owner.tsx` (4 ĐỎ: alias, `✓`, ZaUI, PageHeader), `brand-view.tsx` (3 ĐỎ: `✓`, ZaUI, PageHeader), `utils/brands.ts` + `utils/brand-origins.ts` (vào `FILES_PC10B`, đã sạch từ commit C-079 nên xanh ngay), `product-detail.tsx` vào danh sách `FILES_GLYPH_ONLY` (chỉ kiểm `✓`). Nới `ZAUI_ALLOWED` thêm `useParams` (hook runtime, `brand-view.tsx` cần).
- Cũng đổi `typeof import('zmp-ui')` -> `Record<string, unknown>` ở `brand-owner.spec.tsx`.

### Lệnh kiểm chứng (output thật)

```
$ cd apps/miniapp && npx vitest run src/pages/brand-story.spec.tsx src/pages/brand-owner.spec.tsx src/pages/brand-view.spec.tsx \
    src/pages/product-detail.spec.tsx src/pages/product-detail-brand.spec.tsx src/pages/storefront-view src/utils src/ds-c076-pc10b.spec.ts \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts src/i18n src/css src/components/ui src/components/home \
    src/components/product-card src/pages/format-guard.spec.ts
 Test Files  67 passed (67)
      Tests  700 passed (700)
$ npx eslint <11 file .tsx/.ts của mục này + 4 spec>      -> exit 0, không lỗi, không cảnh báo
$ npx tsc --noEmit                                         -> exit 0, không output
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ node scripts/uiux/static-scan.mjs && (cột: legacy hex emoji file)
0 0 0 apps/miniapp/src/css/brand-theme.css
0 0 0 apps/miniapp/src/pages/brand-owner.tsx
0 0 1 apps/miniapp/src/pages/brand-story.tsx
0 0 3 apps/miniapp/src/pages/brand-view.tsx
0 0 1 apps/miniapp/src/pages/product-detail.tsx
0 0 8 apps/miniapp/src/utils/brand-origins.ts
0 0 0 apps/miniapp/src/utils/brands.ts
```

### File ngoài nhóm bị sửa (tối thiểu)

`utils/brand-origins.ts` (mới, dữ liệu 8 nhãn tách khỏi `brand-story.tsx` để test và trang dùng chung) và `css/brand-theme.css` (mới, nơi hợp lệ giữ hex nhãn theo quyết định thiết kế của gói). Không sửa API, `i18n/vi.ts`, `app.tsx`, `components/ui/**`.

### Giả định

1. Liên kết "đúng" là TÊN catalog, không phải slug: API lọc theo tên chính xác. Slug của nhãn seed (`bhnong`, `le-plateau-coffee`, `p-lang`, `sokfram`...) tồn tại nhưng mọi nhãn seed đều `isPublished=false`, nên `/brand/:slug` trả 404 (`brand.service.ts:85`). Vì vậy tên nhãn ở PDP dẫn tới `/browse?brand=<tên>` (luôn có kết quả), KHÔNG dẫn tới `/brand/:slug` như đề xuất gốc của A1-027.
2. Tên hiển thị "Le Plateau" và "Sokfarm" giữ nguyên (nội dung thương hiệu, không thuộc phạm vi sửa lỗi liên kết). Catalog ghi "Sokfram" (cả `DEMO_SCRIPT.md`), `brand-story` ghi "Sokfarm": cần chủ dự án xác nhận chính tả đúng rồi đổi MỘT chỗ (`brand-origins.ts`) hoặc ở dữ liệu catalog.
3. Tiêu đề trang `brand-story` là "Hành trình nguyên liệu" (thẻ trên Home dẫn tới đây); menu hồ sơ gọi cùng trang là "Câu chuyện thương hiệu". Dùng hằng `vi.home.brandStoryTitle` để không sinh chữ mới.
4. Hai đầu gradient ô nhãn và chữ trắng giữ như cũ nên một số ô sáng (Fuwa3e vàng, Pơ Lang cam) có tương phản chữ trắng thấp; đổi màu là quyết định thiết kế, chưa làm.
5. Nhãn ghim bản đồ giữ cỡ chữ 9,5px và chữ nhỏ trong SVG (7-9px) vì là phần minh hoạ bản đồ; sàn 12px của A4-038 chưa áp dụng (sẽ làm ghim chồng lên nhau).
6. `BottomSheet` ở `brand-story` giữ lại hành vi cũ: khi đóng, nội dung biến mất ngay (trước đây cũng `selected && (...)`), không giữ nội dung suốt 200ms animation.
7. Chip "Chính hãng" ở `brand-view` giữ pill đặc nền chính (đã có ghi chú sẵn), chỉ thay ký tự `✓` bằng `Icon`.
8. `brand-owner`: nhãn ô đổi từ nhãn nổi của ZaUI sang nhãn nằm trên ô (`Field`), cùng cách `storefront-builder` đã làm.

### Việc còn lại / phát hiện ngoài phạm vi

- Trang `/brand/:slug` vẫn "mồ côi" với khách: PDP và Hành trình không biết slug (API sản phẩm chỉ trả `brand` dạng chuỗi và `brandId`) và nhãn seed chưa publish. Cần API trả `brandSlug` khi nhãn đã publish (xem đề xuất), rồi PDP/Hành trình mới thêm lối sang trang nhãn.
- `i18n/vi.ts:61` "Khám phá 6 vùng đất làm nên sản phẩm Tubu" nhưng có 8 nhãn ở 7 tỉnh/thành (Lâm Đồng có hai nhãn): ngoài nhóm file, chưa sửa.
- `pages/product-detail.tsx` còn `Box`/`Text` ZaUI và `role="button"` rải rác ngoài vùng nhãn (nút chia sẻ, tim...): ngoài phạm vi, chưa động.

### Đề xuất cho điều phối viên

- API (gói khác): `GET /products/:slug` (hoặc `GET /brands`) trả thêm `brandSlug` chỉ khi `Brand.isPublished`; và quyết định có publish các nhãn seed không. Khi có, PDP đổi `brandBrowsePath(p.brand)` sang `/brand/${brandSlug}` nếu có, Hành trình thêm nút "Xem trang nhãn".
- Sửa `i18n/vi.ts:61` thành số đúng ("8 thương hiệu" hoặc "7 vùng đất").
- Nếu muốn `brand-theme.css` nạp một lần ở gốc: thêm `import './css/brand-theme.css'` vào `app.tsx` rồi bỏ dòng import trong `utils/brands.ts` (hiện để `brandAccent` tự đủ token ở mọi nơi gọi).
- Xoá khối alias legacy: sau gói này `--dealer-*` không còn ai dùng (xem mục 2/4).
- Chạy kiểm bằng mắt trên máy thật (Playwright CHƯA chạy, quy định máy): `/brand-story` ở 360-390px (ô lưới, ghim chồng nhau, sheet chi tiết, bản đồ), `/brand/:slug` (thanh dưới `StickyActionBar` có 2 nút), `/brand-owner` (ô nhập trong `Field`). Locator e2e `features.miniapp.spec.ts` (`getByText('Tubu Official').first()`) đã đọc tĩnh và vẫn khớp (tên nhãn là h2).

## Tổng kết gói PC-10b (mọi mục 1-4/4)

| File | legacy trước -> sau | hex trước -> sau | ESLint trước -> sau |
|---|---|---|---|
| `pages/affiliate.tsx` | 125 -> 0 | 1 -> 0 | 4 -> 0 |
| `components/affiliate/ctv-order-sheet.tsx` | 37 -> 0 | 0 -> 0 | 0 -> 0 |
| `pages/dealer.tsx` | 125 -> 0 | 0 -> 0 | 10 -> 0 |
| `pages/storefront-builder.tsx` | 88 -> 0 | 8 -> 0 | 1 -> 0 |
| `components/storefront-context-bar.tsx` | 4 -> 0 | 0 -> 0 | 0 -> 0 |
| `components/share-sheet.tsx` | 3 -> 0 | 0 -> 0 | 0 -> 0 |
| `components/content-kit-sheet.tsx` | 10 -> 0 | 0 -> 0 | 0 -> 0 |
| `pages/brand-story.tsx` | 15 -> 0 | 102 -> 0 | 13 -> 0 |
| `pages/brand-owner.tsx` | 19 -> 0 | 0 -> 0 | 0 -> 0 |
| `pages/brand-view.tsx` | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| `utils/brands.ts` | 1 -> 0 | 17 -> 0 | 0 -> 0 |

`ds-c076-pc10b.spec.ts` giữ 79 ca khoá không quay lại alias legacy, màu thô, ký tự chữ làm icon, ZaUI `Box/Text/Button` và thiếu `PageHeader` cho mọi file/trang của gói. Hex còn lại có chủ ý và nằm đúng một chỗ: `css/dealer-theme.css`, `css/brand-theme.css` (màu nhận diện), `utils/storefront-theme.ts` (bảng màu gửi API, bắt buộc `#rrggbb`).

## Review lượt 1 (reviewer độc lập, 8 finding) — sửa theo review

Commit sửa (mới -> cũ): `2327d5d` test khoá hành vi, `236c99a` icon dealer, `d742005` aria-expanded affiliate, `2f642ad` nhãn PDP, `b89b6a1` script lint:vars.

| # | Mức | Finding | Kết quả |
|---|---|---|---|
| 1 | major | `scripts/check-undefined-css-vars.mjs` nạp mọi `*.css` trong `css/` làm nơi định nghĩa, nới guard CI dùng chung | ĐÚNG, đã sửa (`b89b6a1`). Test ĐỎ trước: `src/css/check-undefined-css-vars.spec.ts` dựng cây giả có `css/stray.css` khai báo `--stray-only`, script cũ thoát 0 (không báo) thay vì 1. Sửa: `DEFINITION_FILES` là danh sách tường minh `design-tokens/tokens.css`, `css/tokens.css`, `css/zaui-bridge.css`, `css/dealer-theme.css`, `css/brand-theme.css`; diff so với gốc chỉ còn thêm đúng 2 dòng theme. XANH 3 ca; `node scripts/check-undefined-css-vars.mjs` trên cây thật thoát 0. Thêm file theme mới sau này phải thêm tên vào danh sách có chủ ý. |
| 2 | minor | `apps/e2e/tests/affiliate-ctv.miniapp.spec.ts` ngoài nhóm file; `utils/storefront-theme.ts`, `utils/brand-origins.ts` là file mới ngoài danh sách | GHI NGOẠI LỆ, không đổi. Spec e2e: chỉ đổi locator nút "Đã nhận ✓" thành "Đã nhận" (exact) vì icon `Check` thay ký tự `✓`; CHƯA chạy Playwright (quy định máy, 1 job nặng một lúc), điều phối viên chạy `affiliate-ctv.miniapp.spec.ts` ở lượt job nặng. Hai file `utils/*` mới là bảng dữ liệu tách khỏi trang để có nơi duy nhất cho hex/dữ liệu và để test được; không sửa file có sẵn nào ngoài nhóm. Locator e2e `getByText('Bảng 5 bậc CTV & thưởng mốc TubuXu').click()` vẫn khớp sau sửa #5 (chữ nằm trong `<button>`, click nổi bọt). |
| 3 | minor | C-079 mới sửa một phần: nút tên nhãn ở PDP chỉ có tên nhãn làm accessible name; chưa chạy curl catalog; trang `/brand/:slug` vẫn mồ côi | ĐÃ SỬA phần rẻ (`2f642ad`): nút có `aria-label="Xem sản phẩm nhãn <tên>"` qua `brandBrowseLabel()` (`utils/brands.ts`). Test ĐỎ -> XANH: 2 ca `brandBrowseLabel` trong `brands.spec.ts` + 2 ca PDP (`product-detail-brand.spec.tsx` tìm nút theo tên mới). KIỂM CHỨNG catalog (thay curl, vì không chạy dev server): đọc `catalog.service.ts` `listWhere`: `where.brand = brandList[0]` (so khớp bằng, một nhãn) hoặc `{ in: [...] }` (nhiều nhãn, tách dấu phẩy); và chạy SELECT chỉ-đọc trên DB local test `tubutree_it` (container `tubu_it_main`, cổng 5550) đúng điều kiện công khai `isActive AND approvalStatus='APPROVED'`: `Le Plateau Coffee` = 5, `Le Plateau` = 0, `Sokfram` = 5, `Sokfarm` = 0. Chưa gọi HTTP thật `/api/products?brand=...` (unverified ở tầng HTTP). KHÔNG sửa: trang `/brand/:slug` vẫn mồ côi, vì API sản phẩm chưa trả `brandSlug` và nhãn seed chưa publish; đề xuất ticket bên dưới. |
| 4 | minor | `ProgressBar` DS chỉ một màu, mất phân biệt màu theo trạng thái ở mốc thưởng CTV, thưởng đại lý, nhiệm vụ gian hàng | CHẤP NHẬN, không sửa. Trạng thái vẫn có chữ, `Badge` và nút; sửa cần `components/ui/progress-bar.tsx` (ngoài nhóm). Đề xuất cho điều phối viên: thêm `tone` cho `ProgressBar`. |
| 5 | minor | Nút bật/tắt "Bảng 5 bậc CTV" là `ListRow` thiếu `aria-expanded` | ĐÃ SỬA (`d742005`): `ListRow` không nhận aria nên đổi sang `<button type="button" aria-expanded>` cao >= 44px, nội dung và hành vi (haptic, bật/tắt `showAllTiers`) giữ nguyên. Test ĐỎ -> XANH: `affiliate.spec.tsx` ca "aria-expanded đổi theo lần chạm, vùng chạm cao 44px". |
| 6 | minor | Sheet "Đặt nhanh" của dealer bỏ nút "Đóng" cạnh "Thêm vào đơn"; icon `ClipboardList`, `Hourglass` đổi từ ink B2B sang xanh brand | MỘT PHẦN. Màu icon ĐÃ SỬA (`236c99a`): hai icon trở lại ink B2B qua `style={{ stroke: INK }}` (Icon DS không có tone ink; style `stroke` thắng thuộc tính `stroke` của lucide). Test ĐỎ -> XANH: 2 ca "icon giữ màu ink B2B" trong `dealer.spec.tsx`. Nút "Đóng": KHÔNG khôi phục, có chủ ý: `BottomSheet` DS đã có nút X (accessible name "Đóng", 44px), chạm nền và vuốt xuống; thêm nút "Đóng" thứ hai sẽ tạo hai nút trùng tên trong cùng sheet. Không ảnh hưởng tiền, công nợ, API. |
| 7 | minor | `BottomSheet` (`unmountOnClose`) làm form cấu hình gian hàng, `ShareSheet`, `ContentKitSheet` mount lại mỗi lần mở, form chưa lưu bị reset | ĐÚNG, ghi nhận là THAY ĐỔI HÀNH VI CÓ CHỦ ĐÍCH: mọi sheet đã di cư sang DS dùng `BottomSheet`, nội dung gỡ khi đóng. Chỉ `MerchantConfigSheet` có state cục bộ (form khởi tạo từ `sf`), nên đóng rồi mở lại thì form về dữ liệu đã lưu thay vì giữ chữ gõ dở; trước đây form luôn mount nên có thể hiện giá trị cũ khi `sf` đổi sau lần lưu. `ShareSheet` và `ContentKitSheet` không có state cục bộ ngoài `useQuery` (`enabled: visible`, có cache) nên không đổi gì người dùng thấy. Đã khoá bằng test `storefront-builder.spec.tsx` "cấu hình: đóng rồi mở lại thì form về dữ liệu đã lưu" (`2327d5d`; xanh ngay vì là test khoá hành vi, không đổi code). Cần xác nhận với chủ dự án nếu muốn giữ chữ gõ dở. |
| 8 | minor | Guard "mỗi trang có h1" chỉ kiểm có import `PageHeader`, thiếu ca render các nhánh loading/error cho dealer, storefront-builder, brand-owner | KHÔNG CẦN SỬA phần lớn: các ca render đã có từ các mục 2-4/4. `dealer.spec.tsx` (describe "đúng một h1 ở mọi trạng thái": đang tải, lỗi tải, form đăng ký x2, chờ duyệt, đã duyệt), `storefront-builder.spec.tsx` (đang tải, 404, lỗi tải, có gian hàng), `brand-owner.spec.tsx` (đang tải, 404, lỗi tải, chỉnh sửa), `brand-view.spec.tsx`, `brand-story.spec.tsx`. Chỉnh nhỏ: ca "lỗi tải" của `brand-owner` trước chỉ đếm h1 SAU khi bấm Thử lại; nay đếm h1 ngay ở trạng thái lỗi rồi mới bấm (`2327d5d`). Guard tĩnh `ds-c076-pc10b.spec.ts` giữ nguyên vai trò chặn quay lại h1 viết tay/thiếu `PageHeader`. |

### Lệnh kiểm chứng sau sửa (output thật)

```
$ cd apps/miniapp && npx vitest run <25 file spec của gói: affiliate, dealer, storefront-builder, brand-story, brand-owner, brand-view,
    product-detail(+brand), components/affiliate, content-kit-sheet, share-sheet, storefront-context-bar, utils/brands, utils/storefront-theme,
    src/css, ds-c076-pc10b, ds-legacy-vars-4a/4b, button-guard, format-guard>
 Test Files  25 passed (25)
      Tests  410 passed (410)
$ npx tsc --noEmit                                   -> exit 0, không output
$ npx eslint <mọi file nguồn của gói + 2 spec mới>   -> exit 0, không lỗi, không cảnh báo
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ static-scan (legacy hex emoji file): mọi file của gói legacy=0, hex=0; emoji còn lại là nội dung (affiliate 4, share-sheet 3, brand-view 3, brand-story 1, product-detail 1, storefront-builder 1)
```

Chưa chạy: Playwright (`affiliate-ctv.miniapp.spec.ts`, `features.miniapp.spec.ts`), curl HTTP thật tới catalog.

### Đề xuất cho điều phối viên (bổ sung sau review)

- Ticket API: trả `brandSlug` (và chỉ khi nhãn đã publish) trong `GET /products/:slug` để PDP dẫn tới trang `/brand/:slug` thay vì `/browse?brand=`; hiện trang nhãn vẫn mồ côi (A1-027).
- `components/ui/progress-bar.tsx`: thêm `tone` (success/warning/neutral) để mốc thưởng CTV, thưởng đại lý, nhiệm vụ gian hàng phân biệt trạng thái bằng màu như trước.
- `components/ui/list-row.tsx`: cho nhận `aria-expanded`/`aria-*` để dòng "Bảng 5 bậc CTV" quay lại dùng `ListRow`.
- `components/ui/icon.tsx`: thêm tone `ink` hoặc cho phép `color` tuỳ chỉnh để dealer không phải dùng `style.stroke`.
- Brand/dealer: nếu thêm file theme css mới, thêm tên file vào `DEFINITION_FILES` trong `scripts/check-undefined-css-vars.mjs` kèm một ca trong `src/css/check-undefined-css-vars.spec.ts`.
