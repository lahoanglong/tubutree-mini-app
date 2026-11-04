# sec-pancake: webhook Pancake trần riêng + kiểm token trước parse (nhánh gl/1103-sec)

Commit: "fix(api): webhook Pancake trần 10mb/200 000 nút, kiểm token trước khi parse..." rồi merge origin/main (142f1a9d3). Chưa push.

## Đã làm (apps/api/src/common/body-limits.ts, bootstrap.ts, users.service.ts)
1. Chỉ /api/webhooks/pancake: trần thân 10mb, 200 000 nút (rawGuard và inspectBody), độ sâu 64. Webhook khác giữ 1mb / 20 000.
2. pancakeWebhookTokenGuard đặt trước body parser trong bootstrap: x-webhook-token so timingSafeEqual (độ dài khác thì false),
   secret đọc từ process.env.PANCAKE_WEBHOOK_SECRET (cùng nguồn ConfigService). Production không secret: 401
   'Webhook chưa cấu hình bí mật ở production.'; sai/thiếu token: 401 'Token webhook không hợp lệ.'; dev/test không secret: cho qua.
   JSON dạng Nest {statusCode, message, error:'Unauthorized'}; không log token; controller giữ nguyên kiểm.
3. Regex LARGE_BODY_ROUTES, WEBHOOK_ROUTE, route pancake thêm cờ i.
4. Comment MAX_BODY_NODES sửa: mảng hợp lệ lớn nhất là 500 chuỗi (ArrayMaxSize(500): productIds, CATEGORY_ASSIGN), 200 object vài trường; < 1 500 nút.
5. P3: parameters.too.many -> JSON 413, querystring.parse.rangeError -> JSON 400; comment eventsBodyParser sửa; hằng MAX_ADDRESSES_PER_USER
   chuyển lên trước JSDoc ADDRESS_IN_USE_BY_SUBSCRIPTION.
6. Test mới (body-limits.spec.ts): Pancake 2 MB và 50 000 nút qua với token đúng (JSON.parse có chạy); thiếu/sai/khác độ dài token: 401 và
   JSON.parse không chạy trên thân; production không secret 401; zalo-oa vẫn 413 ở 2 MB và 400 ở 50 000 nút; /api/Admin, /api/FEED,
   /API/Webhooks/Pancake nhận 2 MB, /api/Webhooks/zalo-oa 413; urlencoded 1500 tham số trả JSON 413; Pancake > 10 MB 413.
   Test quét thô Pancake đổi 60 000 -> 250 000 khoá (trần mới 200 000). Với mã cũ: 54/57 đỏ (không biên dịch được hàm mới).

## Kiểm
- jest --maxWorkers=2: body-limits.spec, bootstrap.spec, users.service.spec, integrations/pancake: 22 suite, 598 test xanh (trước merge và sau merge).
- npx tsc --noEmit (apps/api): sạch; eslint 4 file đã sửa: sạch.
- Merge origin/main: xung đột checkout.tsx (Mini) và checkout-rules.ts (web) ở dòng import; giữ cả hai (normalizeTaxCode/shouldShowTaxCodeError, isTaxCodeValid
  và isCartFixableError). vitest: Mini checkout-rules + checkout.spec 197 test, web checkout-rules 15, app-core tax-code 5: xanh.

## Lưu ý
- Không chạy jest toàn bộ, Playwright, lane. Chưa đo payload Pancake thật (PROD chưa có sự kiện).
- Token đọc từ process.env lúc request; nếu sau này secret nạp qua nguồn khác ConfigService thì guard cần đổi theo.
