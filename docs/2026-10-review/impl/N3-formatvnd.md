# N3 formatvnd

## Làm gì
Mục 46af0664f1 (phần app web). Tạo apps/web/src/lib/format-vnd.ts, không import gì và không "use client", chứa một hàm formatVnd giữ nguyên thân và chữ ký. api.ts và shop-client.ts bỏ thân hàm cũ, import từ ./format-vnd và `export { formatVnd }` nên hơn 30 import hiện có và flash-price.tsx không phải sửa. Bản miniapp và các hàm vnd của backend không đụng.

Allow-list NUMBER_TO_LOCALE_STRING: grep cho thấy api.ts và shop-client.ts chỉ có đúng một toLocaleString (trong formatVnd), nên bỏ hai dòng đó và thêm lib/format-vnd.ts (count 1, số tiền).

## Test
format-vnd.spec.ts: ca 0, 289000, 1000000 (chuỗi lấy bằng chạy bản cũ: 0đ, 289.000đ, 1.000.000đ) và kiểm api/shop-client re-export cùng hàm bằng toBe. Đỏ trước khi sửa vì chưa có ./format-vnd.

## Kiểm
vitest các spec format-vnd, api, no-raw-date-format và spec có formatVnd: xanh. tsc --noEmit apps/web: exit 0. ESLint --max-warnings=0 năm file đã sửa: exit 0.

## Chưa verify
Next build, Playwright, full suite.

## Rủi ro
Thấp: hành vi hàm không đổi, chỉ đổi nơi định nghĩa.
