# N3 formatsold

## Đã làm
Thêm nhóm test "formatSold — kiểu Shopee" vào apps/miniapp/src/utils/format.spec.ts, theo bảng ca của apps/web/src/lib/api.spec.ts (null, undefined, 0, -5, NaN trả null; 1, 12, 999; 1000, 1200, 1234; biên 999.999 ra "Đã bán 1000k+"; 1tr, 1,5tr, 2,5tr). Kết quả chạy bản thật của miniapp khớp web ở mọi ca, không có lệch hành vi. Thêm đúng một dòng comment trên formatSold trong format.ts nêu lý do có hai bản. Không đụng apps/web, apps/api, packages.

## Quyết định
Giữ hai bản, không dùng chung mã. (Lý do "web và miniapp là hai bundle riêng" không đúng: cả hai đã dùng `@tubutree/shared-types`. Thực tế là chưa có hàm định dạng nào trong package đó, gom được nhưng chưa làm.) Ca 999.999 được giữ làm test ghi nhận quirk có sẵn (cùng ở hai bản), không sửa.

## Kiểm
- vitest run src/utils/format.spec.ts (apps/miniapp): 36 passed, exit 0.
- Chứng minh bắt lệch: tạm đổi ngưỡng 1_000_000 thành 900_000 trong format.ts, ca biên 999.999 đỏ (1 failed), đã hoàn lại.
- tsc --noEmit (apps/miniapp): exit 0. ESLint --max-warnings=0 hai file: exit 0.

## Chưa verify
Không chạy full suite, Playwright.

## Rủi ro
Hai bản vẫn có thể lệch nhau về sau; comment chỉ nhắc, không có test chéo.
