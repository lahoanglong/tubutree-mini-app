# PC-10a — Di cư game + loyalty sang DS v2 (C-076 lô 1), C-082, C-113

Nhánh `hz7/PC-10a` (tách từ `hardening/2026-10` @ afb1592). Quyết định áp dụng: Q-26 (thuật ngữ), Q-09/Q-11 (giữ hai điểm danh ở tầng dữ liệu), Q-02 (không thêm lại mua giọt nước bằng xu).

## Mục 1/4 — Guard spec `ds-c076-pc10a` + di cư `pages/loyalty.tsx` (C-076, C-114)

Trạng thái: XONG. Các mục còn lại của gói (game.tsx, wheel.tsx, rank-badge.tsx, C-082) thuộc lượt khác.

### Số đo trước → sau (`pages/loyalty.tsx`)

| Chỉ số | Trước | Sau |
|---|---|---|
| static-scan legacy | 151 | 0 |
| static-scan hex | 0 | 0 |
| static-scan emoji | 15 | 8 (đều là nội dung: 4 emoji hạng, 🎉 x2, 🔥 chuỗi ngày, 🌿 lời chúc) |
| ESLint (`npx eslint src/pages/loyalty.tsx`) | 5 lỗi (1 `no-restricted-imports` Button ZaUI, 4 `no-raw-color`) | exit 0, không cảnh báo |
| import ZaUI | `Box, Page, Text, Button, useNavigate, useSnackbar` | `Page, useNavigate, useSnackbar` |
| `<h1>` | 0 | 1 (`PageHeader` "Hạng thành viên & Điểm Xanh", render cả khi đang tải) |

### Đã làm

- Guard `apps/miniapp/src/ds-c076-pc10a.spec.ts` (19 test): cùng họ regex alias legacy với `ds-legacy-vars-4b.spec.ts`, hex/rgb thô theo `static-scan.mjs`, chỉ cho phép `Page/useNavigate/useLocation/useSnackbar` từ zmp-ui trong trang, và danh sách emoji được giữ theo từng file (`ALLOWED_EMOJI`) để emoji chức năng (✓ 🎁 🔒 💡) không quay lại. Mảng `FILES_PC10A` hiện chỉ có `loyalty.tsx`; các lượt sau thêm game.tsx, wheel.tsx, rank-badge.tsx, components/game/** TRƯỚC khi sửa.
- `pages/loyalty.tsx` (vẫn một file, hành vi không đổi): `Box/Text` ZaUI → `div` + `Text/Heading/Card/Badge/Icon/ListRow/KeyValueRow` của `components/ui`; `Button` ZaUI → `ui/button`; loading/error/empty → `Skeleton`/`ErrorState`/`EmptyState` (variant inline); icon chức năng (✓ 🎁 🔒 💡 và 🌱 ở ô ngày điểm danh) → Lucide qua `Icon`; vùng chạm ≥44px nhờ `Button`/`ListRow`; tiêu đề mục là `h2` thật.
- Màu hạng (4 hạng): `var(--sage-*)`/`var(--forest-*)`/`var(--clay-50)` — cùng giá trị mà alias cũ resolve ra, nên không đổi màu. Không tạo `css/loyalty.css`: `scripts/check-undefined-css-vars.mjs` chỉ đọc 3 file định nghĩa cố định nên token riêng của trang bị báo "chưa định nghĩa" (đã thử, 8 lỗi), xem "Đề xuất".
- Ba hộp thoại tự dựng (`position: fixed` + `rgba(26,26,23,.6)` + `tubu-pop`: thẻ thành viên, xác nhận đổi quà, chúc mừng lên hạng) → `BottomSheet` của DS (là `Dialog` theo `bottom-sheet.tsx`). `useLastNonNull` giữ nội dung trong 200ms hoạt ảnh đóng để sheet không trống đi lúc trượt xuống.
- Hai ô lối tắt 2 cột (Vườn Cây / Trạm Refill, `Box onClick`) → hai `ListRow` xếp dọc trong một `Card` (có role=button, Tab + Enter/Space, hàng ≥44px).
- Thanh tiến độ giữ bản tự vẽ (cần màu theo hạng, `ProgressBar` DS chỉ có brand/flash), dùng token, thêm `role="progressbar"` + `aria-valuenow`.

### Giữ nguyên (đã chứng minh bằng test)

Mọi `useQuery`/`useMutation`, khoá `busyRef` chống chạm đúp, điều kiện `disabled` của nút điểm danh (`!canCheckIn || isPending`) và nút đổi quà (`!canRedeem || isPending`), `loading` đi kèm `disabled` như cũ (nên spinner vẫn không hiện khi đang gửi, đúng hành vi cũ), số liệu (`formatPoints/formatNumber`), điều hướng `/game`, `/refill`, `/browse`, logic chúc mừng lên hạng (`tubu_last_tier_min`), thuật ngữ Q-26 (Mã giảm giá / Điểm Xanh / giọt nước), không có "TubuXu" mới.

### Test (đỏ → xanh)

- `pages/loyalty-behavior.spec.tsx` (MỚI, 20 test đặc tả): viết và chạy XANH trên bản cũ trước khi di cư (commit `f31c81d`), rồi vẫn 20/20 xanh trên bản mới: điểm danh (bật/tắt đúng lúc, chạm đúp gọi API 1 lần, lỗi → báo + tải lại), đổi quà (nút khoá khi thiếu điểm, hộp xác nhận hiện điểm trừ/còn lại đúng, Huỷ không gọi API, chạm đúp chỉ gọi 1 lần với đúng id, lỗi vẫn tải lại điểm), thẻ thành viên (QR mã hoá đúng memberCode, chép thành công/thất bại, lỗi tải → Thử lại, Đóng), chúc mừng lên hạng (lần đầu không bật, mốc thấp hơn thì bật, bằng nhau thì không), lối tắt điều hướng, thanh tiến độ 50%.
- `ds-c076-pc10a.spec.ts` (MỚI): trước khi di cư 4 test của `loyalty.tsx` ĐỎ (alias legacy, rgba thô, import `Box/Text/Button`, emoji `['✓','🎁','🔒','💡']`); sau di cư 19/19 xanh.
- `pages/loyalty-layout.spec.tsx`: thêm mock `useLocation` (PageHeader gắn `BackButton` cần vị trí) + 2 test C-114 (đúng một `h1`, đang tải vẫn có `h1`): ĐỎ trước, XANH sau. 6 test cũ giữ nguyên, xanh.
- `pages/loyalty.spec.ts` (quét mã nguồn, 7 test): xanh, không phải sửa.

### Lệnh kiểm chứng (output thật)

```
$ npx eslint src/pages/loyalty.tsx src/pages/loyalty-layout.spec.tsx src/ds-c076-pc10a.spec.ts
exit 0, không output
$ npx tsc --noEmit
exit 0, không output
$ node scripts/uiux/static-scan.mjs ... (legacy hex emoji file)
0 0 8 apps/miniapp/src/pages/loyalty.tsx
$ node scripts/check-undefined-css-vars.mjs
OK — every var(--x) reference is defined.
$ npx vitest run src/ds-c076-pc10a.spec.ts src/pages/loyalty-layout.spec.tsx src/pages/loyalty-behavior.spec.tsx \
    src/pages/loyalty.spec.ts src/components/ui/button-guard.spec.ts src/components/ui/hit-target-guard.spec.tsx \
    src/ds-legacy-vars-4a.spec.ts src/ds-legacy-vars-4b.spec.ts
 Test Files  8 passed (8)
      Tests  147 passed (147)
```

### Giả định

1. Trang trước đó không có tiêu đề nào; C-114 cần đúng một `h1` nên dùng `PageHeader` với "Hạng thành viên & Điểm Xanh" (trùng nhãn dòng menu ở `profile.tsx`).
2. Hộp thoại giữa màn hình → bottom sheet là thay đổi trình bày, không đổi luồng. DS không có modal giữa màn hình; `Dialog = BottomSheet` là quyết định đã ghi trong `ui/bottom-sheet.tsx`.
3. `EmptyState`/`ErrorState` chỉ nhận chuỗi nên câu trống cũ tách thành tiêu đề + mô tả ("Chưa có mã giảm giá khả dụng" / "Đổi Điểm Xanh ở mục bên dưới để nhận mã."; "Hiện chưa có ưu đãi nào để đổi"; "Chưa có giao dịch điểm nào"). Câu lỗi giữ nguyên chữ "Chưa tải được ...: <lỗi>".
4. Nút trong ô ngày điểm danh: ✓ → `Check`, 🎁 (ngày 7) → `Gift`, 🌱 → `Sprout` (đều là chỉ báo chức năng, không phải nội dung hạng).

### Việc còn lại / ghi chú

- CHƯA kiểm bằng mắt trên trình duyệt/Zalo (không chạy dev server/Playwright theo quy định máy): bố cục 390x844 của thẻ hạng, hàng ô 7 ngày (mỗi ô ~42px) và nút "Điểm danh +N" cao 44px cạnh tiêu đề dài cần xem lại. Ghi "unverified" cho phần hình ảnh.
- `components/qr-code.tsx` (ngoài nhóm file của gói) còn `var(--neutral-100)` ở khung chờ QR và hex `#1a1a17/#ffffff` làm màu mã QR (màu QR phải đen/trắng, giữ). Chỉ cần đổi `--neutral-100` → token v2 ở lô "phần còn lại".

### Đề xuất cho điều phối viên

1. `apps/e2e/tests/loyalty.miniapp.spec.ts` (dòng ~125, ~176, ~193) chọn hộp thoại bằng `.tubu-pop` rồi `filter({ hasText })`; sau di cư các hộp là bottom sheet của ZaUI nên selector này không còn khớp. Đổi sang chọn theo tiêu đề sheet (`getByRole('heading', { name: 'Xác nhận đổi ưu đãi' })` và nút trong sheet đó). Cùng file có `modal.getByText('-50 Xanh')` đã lệch từ trước (UI in "-50 điểm Xanh" từ khi thêm đơn vị ở C-083) nên e2e này cần được sửa tay, tôi không chạy được Playwright.
2. `scripts/check-undefined-css-vars.mjs`: nếu muốn cho phép token riêng theo trang (`css/<tên>.css`, như quy ước của lô C3), cần thêm các file đó vào `DEFINITION_FILES` (hoặc quét `apps/miniapp/src/css/*.css`). Tôi không sửa vì ngoài nhóm file và nhiều gói song song sẽ sửa cùng dòng.
3. Hai nút điểm danh (Điểm Xanh ở đây, giọt nước ở Vườn) vẫn tách ở hai trang: dòng chú thích trong thẻ điểm danh đã nói rõ "giọt nước Vườn Xanh điểm danh riêng trong Vườn Cây". Phần gộp trình bày thuộc C-082 trên `game.tsx` (lượt khác).
