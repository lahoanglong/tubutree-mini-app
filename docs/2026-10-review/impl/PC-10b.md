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

`scripts/check-undefined-css-vars.mjs`: danh sách file định nghĩa token từ 3 file cố định thành `design-tokens/tokens.css` + mọi `apps/miniapp/src/css/*.css`. Lý do: `--color-dealer-*` khai báo ở `css/dealer-theme.css` nên `pnpm lint:vars` báo 5 tham chiếu "not defined"; làm theo thư mục để `brand-theme.css` (mục 3/4) và các file theme sau không phải sửa lại script. Chỉ thêm nguồn định nghĩa, không nới quy tắc kiểm.

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
