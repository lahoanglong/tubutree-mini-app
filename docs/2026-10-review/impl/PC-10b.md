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
