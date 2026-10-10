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

### Việc còn lại (mục 2/2 của gói)
C-068 (Chip 44px), C-070 (Button khoá bấm đúp), C-071 (vùng cuộn ngang), C-072 (thẻ SP không lồng tương tác), C-077 phần `components/ui`, C-021 phần component; phần `<h1>` của C-114 cho các trang chưa dùng `PageHeader`.
