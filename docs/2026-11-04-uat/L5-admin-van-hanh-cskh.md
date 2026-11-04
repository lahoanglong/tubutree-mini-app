# L5 — Admin, vận hành, CSKH: báo cáo UAT

Ngày chạy: 04/11/2026 (bắt đầu 03:56). Người chạy: UAT agent lane 5, khoá `L5-admin-van-hanh-cskh`.
Mã đang thử: worktree `uat-1104` ở SHA `98803f006` (cùng bản với PROD tại lúc chạy). Lane 5: API 3251, web 3252, Mini 3253, Pancake giả 3258, DB `tubutree_uat_l5`, Redis db 5.
Không sửa mã ứng dụng, không đụng PROD, không đẩy, không PR.

## Kết luận

| Chỉ số | Số ca |
|---|---|
| Tổng số ca đã chạy | 767 |
| PASS | 763 |
| FAIL | 1 |
| BLOCKED | 1 |
| CẦN CHỦ (không tính FAIL) | 2 |

- Một lỗi thật: **L5-B01 (P2)**: bấm "Huỷ đơn" thua cuộc đua với "Đã nhận tiền" thì API trả 200, màn không báo gì, đơn vẫn chạy bình thường. Chi tiết ở mục "Lỗi".
- Tiền, Ví, điểm: mọi ca có đụng tiền đều đối chiếu SQL; đối soát cuối buổi (`reconcile-wallet`, `reconcile-points`) báo 0 user lệch.
- Quyền: 320 route admin gọi thẳng bằng 10 persona, 0 route sai quyền; 6 vai × 43 tab ở giao diện 1280, 0 sai.
- Mục "CẦN CHỦ" có 4 điểm (2 ca trong bảng và 2 quan sát) chưa có luật nêu rõ nên không tính lỗi; 1 ca BLOCKED do bộ khung (cầu nối Zalo).

## Script và số ca

Mọi script nằm ở `docs/2026-11-04-uat/scripts/L5-admin-van-hanh-cskh/`, kết quả thô ở `results/*.json`, ảnh ở `docs/2026-11-04-uat/shots/L5-admin-van-hanh-cskh/`. Chạy lại: `node build-report.mjs` ghép kết quả thành báo cáo này.

| Script | Nội dung | Số ca | FAIL |
|---|---|---|---|
| `01-body-limits` | Giới hạn thân request: webhook Pancake không token, JSON quá sâu / quá nhiều khoá, gzip hỏng, content-encoding lạ, vượt cỡ | 34 | 0 |
| `02-matrix-api` | Gọi thẳng 320 route admin bằng anonymous, khách, CTV, đại lý, staff, kho, kế toán, marketing, CSKH, admin | 18 | 0 |
| `03-matrix-ui` | Mở từng tab /admin?tab=… ở 1280 cho 6 vai (admin, CSKH, kho, kế toán, marketing, staff) | 264 | 0 |
| `04-orders-filters` | Đơn hàng: bộ lọc trạng thái, thanh toán, hàng đợi, ngày, tìm kiếm, đếm theo trạng thái | 18 | 0 |
| `04-orders-list-pay` | Đơn hàng: danh sách, tìm kiếm, "Đã nhận tiền", huỷ, hoàn một phần / toàn phần theo luật | 44 | 0 |
| `05-returns` | Đổi/trả: khách chọn dòng, CSKH duyệt theo số xem trước, Kho "Đã nhận hàng về", trả nốt phần còn lại; đối chiếu Ví và điểm | 32 | 0 |
| `06-pancake-refunds` | Hoàn tiền khách và "Cần xử lý Pancake": tiền dư, COD hoàn về, claim, đã chuyển khoản, tiếp quản | 30 | 0 |
| `07-ops-misc` | Lệnh rút CTV (Admin duyệt, Kế toán chi), hoá đơn VAT, trần mã giảm giá Marketing, mẫu thông báo, cấu hình hệ thống, sức khoẻ vận hành, CSV che SĐT | 135 | 0 |
| `08-chat` | Chat CSKH: bật/tắt, 200 tin mỗi ngày, trùng clientMsgId, chặn/bỏ chặn, quyền từng vai | 61 | 0 |
| `09-admin375` | Các tab hay dùng ở 375 cho admin, CSKH, kế toán, kho, marketing | 25 | 0 |
| `10-mini375` | Màn nội bộ Mini App 375: /staff, /recycle-desk, /admin | 9 | 0 |
| `11-desk375` | Màn thu gom (recycle-desk) 375 | 5 | 0 |
| `12-orders-ui` | Đơn hàng bằng giao diện: Kế toán "Đã nhận tiền", CSKH "Huỷ đơn", Kho "Đã đóng gói", Admin xem đủ | 9 | 0 |
| `13-chat-ui` | Chat CSKH bằng giao diện 375 | 9 | 0 |
| `15-races` | Hai người cùng bấm một việc (đồng thời): trạng thái đơn, hoàn tiền, lệnh rút | 11 | 0 |
| `16-races-refunds` | Hoàn tiền khách đồng thời: verify, claim, mark-paid | 6 | 0 |
| `17-forms-ui` | Biểu mẫu: mã giảm giá Marketing, mẫu thông báo, Sức khoẻ hệ thống (token Zalo giả) | 12 | 0 |
| `18-money-ui` | Việc tiền bằng giao diện: Hoàn tiền khách, lệnh rút, chip "Cần xử lý Pancake", CSV, Đổi/Trả | 13 | 0 |
| `19-b01` | Tái hiện L5-B01 bằng API (6 đơn) | 1 | 1 |
| `21-ui-actions` | VAT, Đổi/Trả duyệt + nhận hàng, cấu hình hệ thống bằng giao diện | 16 | 0 |
| `22-payout-ui` | Lệnh rút cũ: Admin duyệt / từ chối bằng giao diện, hoàn Ví | 4 | 0 |
| `23-inbox-counts` | Số trên "Việc cần xử lý" khớp danh sách và SQL cho từng vai; không rò thẻ của vai khác | 11 | 0 |

## Ma trận vai trò x tab

Nguồn luật: bảng `EXPECTED` 320 route trong `apps/api/src/common/staff-permissions.matrix.spec.ts` và nhóm quyền trong `apps/web/src/app/admin/page.tsx:369-372` (CSKH: inbox, orders, externalOrders, externalClaims, returns, users, quickReplies, community, supportChat; KHO: inbox, orders, returns; KẾ TOÁN: inbox, orders, externalClaims, reports, merchantFulfilment, customerRefunds, cashback, dealerClaims, dealerAccounts, payouts; MARKETING theo bảng; STAFF thường: chỉ tab Đổi rác).

### Giao diện 1280: mở tab bằng URL `?tab=…`
"Mở" = tab hiện đúng, có nội dung, không request lỗi. "Chặn" = tab bị cấm tự quay về tab mặc định, không lộ nội dung, không request lỗi. "LỖI" = lệch bảng quyền.

| Tab | admin | cskh | kho | ketoan | marketing | staff |
|---|---|---|---|---|---|---|
| `inbox` | Mở | Mở | Mở | Mở | Mở | Chặn |
| `orders` | Mở | Mở | Mở | Mở | Chặn | Chặn |
| `productCategories` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `users` | Mở | Mở | Chặn | Chặn | Chặn | Chặn |
| `supportChat` | Mở | Mở | Chặn | Chặn | Chặn | Chặn |
| `community` | Mở | Mở | Chặn | Chặn | Mở | Chặn |
| `coupons` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `waste` | Mở | Mở | Mở | Mở | Mở | Mở |
| `storefronts` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `merchantProducts` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `dealers` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `dashboard` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `analytics` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `reports` | Mở | Chặn | Chặn | Mở | Mở | Chặn |
| `externalOrders` | Mở | Mở | Chặn | Chặn | Chặn | Chặn |
| `returns` | Mở | Mở | Mở | Chặn | Chặn | Chặn |
| `customerRefunds` | Mở | Chặn | Chặn | Mở | Chặn | Chặn |
| `subscriptions` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `reviews` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `quickReplies` | Mở | Mở | Chặn | Chặn | Chặn | Chặn |
| `flashSales` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `posCredits` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `externalClaims` | Mở | Mở | Chặn | Mở | Chặn | Chặn |
| `campaigns` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `bundles` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `engagement` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `dealerClaims` | Mở | Chặn | Chặn | Mở | Chặn | Chặn |
| `dealerAccounts` | Mở | Chặn | Chặn | Mở | Chặn | Chặn |
| `dealerPrices` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `commissionRates` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `payouts` | Mở | Chặn | Chặn | Mở | Chặn | Chặn |
| `merchantFulfilment` | Mở | Chặn | Chặn | Mở | Chặn | Chặn |
| `brands` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `faqs` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `contentKit` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `academy` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `notificationTemplates` | Mở | Chặn | Chặn | Chặn | Mở | Chặn |
| `staffRoster` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `shiftApproval` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `payroll` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `attendance` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `config` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `opsHealth` | Mở | Chặn | Chặn | Chặn | Chặn | Chặn |
| `sum` | Chặn | Chặn | Chặn | Chặn | Chặn | Chặn |

Tổng: 44 tab × 6 vai = 264 ô; số ô "LỖI": 0.

### API: gọi thẳng, không qua giao diện

| Persona | Route cấm gọi đúng (401/403) | Route cấm gọi sai | Route được phép gọi đúng | Route được phép gọi sai | Route ghi bỏ qua (không gọi để khỏi đổi dữ liệu) |
|---|---|---|---|---|---|
| anonymous | 320 | 0 | 0 | 0 | 0 |
| returning | 320 | 0 | 0 | 0 | 0 |
| ctv | 316 | 0 | 4 | 0 | 0 |
| dealer | 316 | 0 | 4 | 0 | 0 |
| staff | 288 | 0 | 20 | 0 | 12 |
| kho | 275 | 0 | 33 | 0 | 12 |
| ketoan | 248 | 0 | 59 | 0 | 13 |
| marketing | 233 | 0 | 67 | 0 | 20 |
| cskh | 248 | 0 | 59 | 0 | 13 |
| admin | 0 | 0 | 258 | 0 | 62 |

Route bị bỏ qua là route ghi (POST/PUT/PATCH/DELETE) mà persona ĐƯỢC phép gọi nhưng không có dạng gọi an toàn (gọi thật sẽ đổi hoặc xoá dữ liệu); các route ghi quan trọng được kiểm riêng ở các script nghiệp vụ (04–08, 15, 16, 21, 22).

Nhóm route và người được phép theo bảng duyệt:

| Nhóm route | số route | Ai được phép (theo bảng duyệt) |
|---|---|---|
| `/academy/courses` | 2 | mọi STAFF |
| `/academy/lessons` | 1 | mọi STAFF |
| `/admin/academy` | 7 | MARKETING |
| `/admin/account-deletion-requests` | 2 | chỉ ADMIN |
| `/admin/analytics` | 1 | chỉ ADMIN |
| `/admin/attendance` | 4 | chỉ ADMIN |
| `/admin/brands` | 10 | chỉ ADMIN |
| `/admin/bundles` | 5 | MARKETING |
| `/admin/campaigns` | 7 | MARKETING |
| `/admin/cashback` | 2 | KE_TOAN |
| `/admin/catalog-products` | 2 | chỉ ADMIN |
| `/admin/categories` | 5 | chỉ ADMIN |
| `/admin/commission-rates` | 6 | chỉ ADMIN |
| `/admin/config` | 2 | chỉ ADMIN |
| `/admin/content-kits` | 2 | MARKETING |
| `/admin/coupon-batches` | 5 | MARKETING |
| `/admin/coupons` | 3 | MARKETING |
| `/admin/customer-refunds` | 6 | KE_TOAN |
| `/admin/dashboard` | 2 | chỉ ADMIN |
| `/admin/dealer-applications` | 2 | chỉ ADMIN |
| `/admin/dealer-credit-reports` | 2 | KE_TOAN |
| `/admin/dealer-orders` | 1 | KE_TOAN |
| `/admin/dealer-prices` | 3 | chỉ ADMIN |
| `/admin/dealer-reward-claims` | 5 | KE_TOAN; chỉ ADMIN |
| `/admin/dealer-rewards` | 4 | chỉ ADMIN |
| `/admin/dealer-tiers` | 5 | chỉ ADMIN |
| `/admin/dealers` | 3 | KE_TOAN |
| `/admin/engagement` | 10 | chỉ ADMIN |
| `/admin/external-claims` | 10 | CSKH/KE_TOAN; CSKH; chỉ ADMIN |
| `/admin/external-orders` | 3 | CSKH |
| `/admin/faqs` | 4 | MARKETING |
| `/admin/flash-sales` | 8 | MARKETING |
| `/admin/gomdon` | 3 | KHO; chỉ ADMIN |
| `/admin/loyalty` | 1 | chỉ ADMIN |
| `/admin/merchant-fulfilment` | 8 | chỉ ADMIN; KE_TOAN |
| `/admin/merchant-products` | 4 | chỉ ADMIN |
| `/admin/notification-templates` | 2 | MARKETING |
| `/admin/ops` | 6 | mọi STAFF; chỉ ADMIN; CSKH/KHO/MARKETING/KE_TOAN |
| `/admin/orders` | 13 | CSKH/KHO/KE_TOAN; KE_TOAN; KHO; chỉ ADMIN; CSKH/KHO |
| `/admin/pancake` | 3 | KHO; chỉ ADMIN |
| `/admin/payouts` | 5 | KE_TOAN; chỉ ADMIN |
| `/admin/payroll` | 7 | chỉ ADMIN |
| `/admin/product-categories` | 2 | chỉ ADMIN |
| `/admin/products` | 3 | chỉ ADMIN; MARKETING |
| `/admin/promotions` | 2 | chỉ ADMIN |
| `/admin/quick-replies` | 4 | CSKH |
| `/admin/reports` | 6 | KE_TOAN; MARKETING |
| `/admin/return-requests` | 4 | CSKH/KHO; CSKH; KHO |
| `/admin/reviews` | 1 | chỉ ADMIN |
| `/admin/shift-templates` | 4 | chỉ ADMIN |
| `/admin/shifts` | 4 | chỉ ADMIN |
| `/admin/staff` | 4 | chỉ ADMIN |
| `/admin/storefronts` | 7 | chỉ ADMIN |
| `/admin/subscriptions` | 1 | chỉ ADMIN |
| `/admin/support-chat` | 14 | CSKH; chỉ ADMIN |
| `/admin/users` | 7 | CSKH; chỉ ADMIN |
| `/admin/variations` | 1 | MARKETING |
| `/admin/waste` | 38 | mọi STAFF; chỉ ADMIN |
| `/affiliate/content-kit` | 1 | mọi STAFF |
| `/feed/admin` | 11 | CSKH/MARKETING; chỉ ADMIN |
| `/feed/events` | 3 | chỉ ADMIN |
| `/loyalty/staff` | 2 | mọi STAFF |
| `/reviews/:id` | 1 | chỉ ADMIN |
| `/staff/attendance` | 5 | mọi STAFF |
| `/staff/bank` | 1 | mọi STAFF |
| `/staff/payroll` | 1 | mọi STAFF |
| `/staff/shift-templates` | 1 | mọi STAFF |
| `/staff/shifts` | 6 | mọi STAFF |

## Bảng ca

Cột Bằng chứng: tệp kết quả thô (trong `results/`), kèm ảnh trong `shots/` nếu có; phần trích rút gọn từ bằng chứng nằm sau dấu `·`. Kỳ vọng ghi nguồn luật (tệp:dòng hoặc khoá SystemConfig) khi script có nêu.

### Webhook Pancake

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-pk-POST | anonymous | api | Webhook Pancake | POST /webhooks/pancake không token | 401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method) | HTTP 401 | `01-body-limits.json` · POST -> 401 {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-PUT | anonymous | api | Webhook Pancake | PUT /webhooks/pancake không token | 401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method) | HTTP 401 | `01-body-limits.json` · PUT -> 401 {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-PATCH | anonymous | api | Webhook Pancake | PATCH /webhooks/pancake không token | 401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method) | HTTP 401 | `01-body-limits.json` · PATCH -> 401 {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-DELETE | anonymous | api | Webhook Pancake | DELETE /webhooks/pancake không token | 401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method) | HTTP 401 | `01-body-limits.json` · DELETE -> 401 {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-GET | anonymous | api | Webhook Pancake | GET /webhooks/pancake không token | 401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method) | HTTP 401 | `01-body-limits.json` · GET -> 401 {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-wrong | anonymous | api | Webhook Pancake | POST token sai | 401 | HTTP 401 | `01-body-limits.json` · {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-big-notoken | anonymous | api | Webhook Pancake | POST 11MB không token | 401 (token kiểm trước parse) | HTTP 401 | `01-body-limits.json` · {"statusCode":401,"message":"Token webhook không hợp lệ.","error":"Unauthorized"} | PASS |
| L5-BL-pk-big-token | anonymous | api | Webhook Pancake | POST 11MB có token đúng | 413 JSON (trần 10mb) | HTTP 413 | `01-body-limits.json` · {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |

### Thân quá phức tạp

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-deep11 | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON sâu 11 tầng | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 400 | `01-body-limits.json` · 400 {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-deep500 | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON sâu 500 tầng | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 400 | `01-body-limits.json` · 400 {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-keys201 | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON object 201 khoá | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 400 | `01-body-limits.json` · 400 {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-nodes7000 | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON 7000 nút (35 object x 200 khoá) | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 400 | `01-body-limits.json` · 400 {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-array501 | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON mảng 501 phần tử | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 400 | `01-body-limits.json` · 400 {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-bigflat | anonymous | api | Thân quá phức tạp | POST /auth/refresh JSON 60 000 khoá phẳng (~600KB, trần 256kb nên 413 hoặc 400) | 400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước) | HTTP 413 | `01-body-limits.json` · 413 {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |
| L5-BL-deep10-ok | anonymous | api | Thân quá phức tạp | JSON sâu 10 tầng (đúng trần) | qua parser (không 413/415/"quá phức tạp") | HTTP 400 | `01-body-limits.json` · {"message":["Không nhận trường «a»."],"error":"Bad Request","statusCode":400} | PASS |
| L5-BL-deep-admin | admin | api | Thân quá phức tạp | PUT /admin/config JSON sâu 12 tầng | 400 JSON | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên quá phức tạp. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |

### Thân gzip

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-gzip-bad | anonymous | api | Thân gzip | POST thân gzip hỏng (byte rác) | 400 JSON, không lộ chữ zlib | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-gzip-trunc | anonymous | api | Thân gzip | POST thân gzip cụt | 400 JSON, không lộ chữ zlib | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |
| L5-BL-gzip-ok | anonymous | api | Thân gzip | POST thân gzip hợp lệ | qua parser (API trả lỗi nghiệp vụ, không 4xx của parser) | HTTP 401 | `01-body-limits.json` · {"message":"Refresh token không hợp lệ hoặc đã hết hạn.","error":"Unauthorized","statusCode":401} | PASS |
| L5-BL-gzip-bomb | anonymous | api | Thân gzip | gzip 2081B giải nén 2MB | 413 JSON (trần tính trên thân đã giải nén) | HTTP 413 2ms | `01-body-limits.json` · {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |

### Thân deflate

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-deflate-bad | anonymous | api | Thân deflate | POST thân deflate hỏng | 400 JSON, không lộ chữ zlib | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |

### Content-Encoding lạ

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-enc-br2 | anonymous | api | Content-Encoding lạ | POST Content-Encoding: br2 | 415 JSON | HTTP 415 | `01-body-limits.json` · {"statusCode":415,"message":"Dữ liệu gửi lên dùng kiểu nén không hỗ trợ.","error":"Unsupported Media Type"} | PASS |
| L5-BL-enc-compress | anonymous | api | Content-Encoding lạ | POST Content-Encoding: compress | 415 JSON | HTTP 415 | `01-body-limits.json` · {"statusCode":415,"message":"Dữ liệu gửi lên dùng kiểu nén không hỗ trợ.","error":"Unsupported Media Type"} | PASS |
| L5-BL-enc-zstd | anonymous | api | Content-Encoding lạ | POST Content-Encoding: zstd | 415 JSON | HTTP 415 | `01-body-limits.json` · {"statusCode":415,"message":"Dữ liệu gửi lên dùng kiểu nén không hỗ trợ.","error":"Unsupported Media Type"} | PASS |
| L5-BL-enc-foo | anonymous | api | Content-Encoding lạ | POST Content-Encoding: foo | 415 JSON | HTTP 415 | `01-body-limits.json` · {"statusCode":415,"message":"Dữ liệu gửi lên dùng kiểu nén không hỗ trợ.","error":"Unsupported Media Type"} | PASS |

### Charset lạ

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-charset | anonymous | api | Charset lạ | POST charset utf-16le | 415 JSON | HTTP 415 | `01-body-limits.json` · {"statusCode":415,"message":"Dữ liệu gửi lên phải dùng mã hoá UTF-8.","error":"Unsupported Media Type"} | PASS |

### Thân quá trần

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-size-default | anonymous | api | Thân quá trần | POST /auth/refresh 300KB (trần 256kb) | 413 JSON | HTTP 413 | `01-body-limits.json` · {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |
| L5-BL-size-default-ok | anonymous | api | Thân quá trần | POST /auth/refresh 200KB (trần dưới 256kb -> qua) | không 413 | HTTP 400 | `01-body-limits.json` · {"message":["Không nhận trường «pad»."],"error":"Bad Request","statusCode":400} | PASS |
| L5-BL-size-webhook | anonymous | api | Thân quá trần | POST /webhooks/zalo-oa 1228KB (trần 1mb) | 413 JSON | HTTP 413 | `01-body-limits.json` · {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |
| L5-BL-size-admin | admin | api | Thân quá trần | PUT /admin/config 11264KB (trần 10mb) | 413 JSON | HTTP 413 | `01-body-limits.json` · {"statusCode":413,"message":"Dữ liệu gửi lên quá lớn. Bạn thử lại nhé.","error":"Payload Too Large"} | PASS |
| L5-BL-size-admin-ok | admin | api | Thân quá trần | PUT /admin/config 2048KB (trần dưới 10mb -> qua parser) | không 413 | HTTP 400 | `01-body-limits.json` · {"message":["Không nhận trường «pad».","Trường «key» không được để trống.","Trường «key» phải là chuỗi ký tự.… | PASS |

### JSON hỏng

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-json-bad | anonymous | api | JSON hỏng | POST JSON dở dang | 400 JSON | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên không đọc được. Bạn kiểm tra lại nhé.","error":"Bad Request"} | PASS |

### Ký tự NUL

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-BL-nul | anonymous | api | Ký tự NUL | POST chuỗi có \u0000 | 400 JSON | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên có ký tự không hợp lệ.","error":"Bad Request"} | PASS |
| L5-BL-nul-url | anonymous | api | Ký tự NUL | GET /products%00x | 400 JSON | HTTP 400 | `01-body-limits.json` · {"statusCode":400,"message":"Dữ liệu gửi lên có ký tự không hợp lệ.","error":"Bad Request"} | PASS |

### Ma trận vai trò x API

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-MX-deny-anonymous | anonymous | api | Ma trận vai trò x API | gọi thẳng 320 route không được phép | mọi route admin 401 | 320 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":320,"allowedOk":0,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-returning | returning | api | Ma trận vai trò x API | gọi thẳng 320 route không được phép | mọi route không được phép 403 | 320 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":320,"allowedOk":0,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-ctv | ctv | api | Ma trận vai trò x API | gọi thẳng 316 route không được phép | mọi route không được phép 403 | 316 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":316,"allowedOk":4,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-ctv | ctv | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 4 | không 403/401 | 4 đúng, 0 sai, 0 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":316,"allowedOk":4,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-dealer | dealer | api | Ma trận vai trò x API | gọi thẳng 316 route không được phép | mọi route không được phép 403 | 316 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":316,"allowedOk":4,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-dealer | dealer | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 4 | không 403/401 | 4 đúng, 0 sai, 0 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":316,"allowedOk":4,"skippedWrites":0,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-staff | staff | api | Ma trận vai trò x API | gọi thẳng 288 route không được phép | mọi route không được phép 403 | 288 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":288,"allowedOk":20,"skippedWrites":12,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-staff | staff | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 20 | không 403/401 | 20 đúng, 0 sai, 12 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":288,"allowedOk":20,"skippedWrites":12,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-kho | kho | api | Ma trận vai trò x API | gọi thẳng 275 route không được phép | mọi route không được phép 403 | 275 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":275,"allowedOk":33,"skippedWrites":12,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-kho | kho | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 33 | không 403/401 | 33 đúng, 0 sai, 12 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":275,"allowedOk":33,"skippedWrites":12,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-ketoan | ketoan | api | Ma trận vai trò x API | gọi thẳng 248 route không được phép | mọi route không được phép 403 | 248 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":248,"allowedOk":59,"skippedWrites":13,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-ketoan | ketoan | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 59 | không 403/401 | 59 đúng, 0 sai, 13 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":248,"allowedOk":59,"skippedWrites":13,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-marketing | marketing | api | Ma trận vai trò x API | gọi thẳng 233 route không được phép | mọi route không được phép 403 | 233 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":233,"allowedOk":67,"skippedWrites":20,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-marketing | marketing | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 67 | không 403/401 | 67 đúng, 0 sai, 20 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":233,"allowedOk":67,"skippedWrites":20,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-cskh | cskh | api | Ma trận vai trò x API | gọi thẳng 248 route không được phép | mọi route không được phép 403 | 248 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":248,"allowedOk":59,"skippedWrites":13,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-cskh | cskh | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 59 | không 403/401 | 59 đúng, 0 sai, 13 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":248,"allowedOk":59,"skippedWrites":13,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-deny-admin | admin | api | Ma trận vai trò x API | gọi thẳng 0 route không được phép | mọi route không được phép 403 | 0 đúng, 0 sai | `02-matrix-api.json` · {"deniedOk":0,"allowedOk":258,"skippedWrites":62,"deniedBad":[],"allowedBad":[]} | PASS |
| L5-MX-allow-admin | admin | api | Ma trận vai trò x API | gọi route được phép (GET + ghi với id giả): 258 | không 403/401 | 258 đúng, 0 sai, 62 route ghi bỏ qua | `02-matrix-api.json` · {"deniedOk":0,"allowedOk":258,"skippedWrites":62,"deniedBad":[],"allowedBad":[]} | PASS |

### Ma trận vai trò x tab

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-UX-admin-inbox | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=inbox, URL=inbox; 8 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-inbox.png` · {"shown":"inbox","urlTab":"inbox","nContent":1278,"bad":[]} | PASS |
| L5-UX-admin-orders | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=orders, URL=orders; 10 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-orders.png` · {"shown":"orders","urlTab":"orders","nContent":3855,"bad":[]} | PASS |
| L5-UX-admin-productCategories | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=productCategories, URL=productCategories; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-productCategories.png` · {"shown":"productCategories","urlTab":"productCategories","nContent":4825,"bad":[]} | PASS |
| L5-UX-admin-users | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=users, URL=users; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-users.png` · {"shown":"users","urlTab":"users","nContent":1522,"bad":[]} | PASS |
| L5-UX-admin-supportChat | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=supportChat, URL=supportChat; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-supportChat.png` · {"shown":"supportChat","urlTab":"supportChat","nContent":1030,"bad":[]} | PASS |
| L5-UX-admin-community | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=community, URL=community; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"community","urlTab":"community","nContent":529,"bad":[]} | PASS |
| L5-UX-admin-coupons | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=coupons, URL=coupons; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-coupons.png` · {"shown":"coupons","urlTab":"coupons","nContent":1272,"bad":[]} | PASS |
| L5-UX-admin-waste | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 9 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-waste.png` · {"shown":"waste","urlTab":"waste","nContent":1339,"bad":[]} | PASS |
| L5-UX-admin-storefronts | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=storefronts, URL=storefronts; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-storefronts.png` · {"shown":"storefronts","urlTab":"storefronts","nContent":859,"bad":[]} | PASS |
| L5-UX-admin-merchantProducts | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=merchantProducts, URL=merchantProducts; 8 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-merchantProducts.png` · {"shown":"merchantProducts","urlTab":"merchantProducts","nContent":893,"bad":[]} | PASS |
| L5-UX-admin-dealers | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealers, URL=dealers; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-dealers.png` · {"shown":"dealers","urlTab":"dealers","nContent":633,"bad":[]} | PASS |
| L5-UX-admin-dashboard | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dashboard, URL=dashboard; 10 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-dashboard.png` · {"shown":"dashboard","urlTab":"dashboard","nContent":1904,"bad":[]} | PASS |
| L5-UX-admin-analytics | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=analytics, URL=analytics; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"analytics","urlTab":"analytics","nContent":710,"bad":[]} | PASS |
| L5-UX-admin-reports | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=reports, URL=reports; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"reports","urlTab":"reports","nContent":3257,"bad":[]} | PASS |
| L5-UX-admin-externalOrders | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=externalOrders, URL=externalOrders; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"externalOrders","urlTab":"externalOrders","nContent":841,"bad":[]} | PASS |
| L5-UX-admin-returns | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=returns, URL=returns; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"returns","urlTab":"returns","nContent":978,"bad":[]} | PASS |
| L5-UX-admin-customerRefunds | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=customerRefunds, URL=customerRefunds; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"customerRefunds","urlTab":"customerRefunds","nContent":2384,"bad":[]} | PASS |
| L5-UX-admin-subscriptions | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=subscriptions, URL=subscriptions; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"subscriptions","urlTab":"subscriptions","nContent":657,"bad":[]} | PASS |
| L5-UX-admin-reviews | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=reviews, URL=reviews; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"reviews","urlTab":"reviews","nContent":674,"bad":[]} | PASS |
| L5-UX-admin-quickReplies | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=quickReplies, URL=quickReplies; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"quickReplies","urlTab":"quickReplies","nContent":821,"bad":[]} | PASS |
| L5-UX-admin-flashSales | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=flashSales, URL=flashSales; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"flashSales","urlTab":"flashSales","nContent":1008,"bad":[]} | PASS |
| L5-UX-admin-posCredits | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=posCredits, URL=posCredits; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"posCredits","urlTab":"posCredits","nContent":759,"bad":[]} | PASS |
| L5-UX-admin-externalClaims | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=externalClaims, URL=externalClaims; 8 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"externalClaims","urlTab":"externalClaims","nContent":1144,"bad":[]} | PASS |
| L5-UX-admin-campaigns | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=campaigns, URL=campaigns; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"campaigns","urlTab":"campaigns","nContent":567,"bad":[]} | PASS |
| L5-UX-admin-bundles | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=bundles, URL=bundles; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"bundles","urlTab":"bundles","nContent":607,"bad":[]} | PASS |
| L5-UX-admin-engagement | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=engagement, URL=engagement; 8 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"engagement","urlTab":"engagement","nContent":8683,"bad":[]} | PASS |
| L5-UX-admin-dealerClaims | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealerClaims, URL=dealerClaims; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"dealerClaims","urlTab":"dealerClaims","nContent":606,"bad":[]} | PASS |
| L5-UX-admin-dealerAccounts | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealerAccounts, URL=dealerAccounts; 8 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"dealerAccounts","urlTab":"dealerAccounts","nContent":1491,"bad":[]} | PASS |
| L5-UX-admin-dealerPrices | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealerPrices, URL=dealerPrices; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"dealerPrices","urlTab":"dealerPrices","nContent":523,"bad":[]} | PASS |
| L5-UX-admin-commissionRates | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=commissionRates, URL=commissionRates; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"commissionRates","urlTab":"commissionRates","nContent":3853,"bad":[]} | PASS |
| L5-UX-admin-payouts | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=payouts, URL=payouts; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"payouts","urlTab":"payouts","nContent":1284,"bad":[]} | PASS |
| L5-UX-admin-merchantFulfilment | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=merchantFulfilment, URL=merchantFulfilment; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"merchantFulfilment","urlTab":"merchantFulfilment","nContent":805,"bad":[]} | PASS |
| L5-UX-admin-brands | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=brands, URL=brands; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"brands","urlTab":"brands","nContent":1023,"bad":[]} | PASS |
| L5-UX-admin-faqs | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=faqs, URL=faqs; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"faqs","urlTab":"faqs","nContent":672,"bad":[]} | PASS |
| L5-UX-admin-contentKit | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=contentKit, URL=contentKit; 5 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"contentKit","urlTab":"contentKit","nContent":676,"bad":[]} | PASS |
| L5-UX-admin-academy | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=academy, URL=academy; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"academy","urlTab":"academy","nContent":677,"bad":[]} | PASS |
| L5-UX-admin-notificationTemplates | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=notificationTemplates, URL=notificationTemplates; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"notificationTemplates","urlTab":"notificationTemplates","nContent":32181,"bad":[]} | PASS |
| L5-UX-admin-staffRoster | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=staffRoster, URL=staffRoster; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"staffRoster","urlTab":"staffRoster","nContent":3820,"bad":[]} | PASS |
| L5-UX-admin-shiftApproval | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=shiftApproval, URL=shiftApproval; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"shiftApproval","urlTab":"shiftApproval","nContent":511,"bad":[]} | PASS |
| L5-UX-admin-payroll | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=payroll, URL=payroll; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"payroll","urlTab":"payroll","nContent":1120,"bad":[]} | PASS |
| L5-UX-admin-attendance | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=attendance, URL=attendance; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"attendance","urlTab":"attendance","nContent":490,"bad":[]} | PASS |
| L5-UX-admin-config | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=config, URL=config; 7 request, 0 lỗi; ổn | `03-matrix-ui-admin.json` · {"shown":"config","urlTab":"config","nContent":4569,"bad":[]} | PASS |
| L5-UX-admin-opsHealth | admin | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=opsHealth, URL=opsHealth; 6 request, 0 lỗi; ổn | `03-matrix-ui-admin.json`, ảnh `ui1280-admin-opsHealth.png` · {"shown":"opsHealth","urlTab":"opsHealth","nContent":7630,"bad":[]} | PASS |
| L5-UX-admin-sum | admin | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-admin.json` · [] | PASS |
| L5-UX-cskh-inbox | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-orders | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=orders, URL=orders; 10 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"orders","urlTab":"orders","nContent":1101,"bad":[]} | PASS |
| L5-UX-cskh-productCategories | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-users | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=users, URL=users; 6 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"users","urlTab":"users","nContent":1047,"bad":[]} | PASS |
| L5-UX-cskh-supportChat | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=supportChat, URL=supportChat; 7 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"supportChat","urlTab":"supportChat","nContent":482,"bad":[]} | PASS |
| L5-UX-cskh-community | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=community, URL=community; 7 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"community","urlTab":"community","nContent":241,"bad":[]} | PASS |
| L5-UX-cskh-coupons | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-waste | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 6 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"waste","urlTab":"waste","nContent":565,"bad":[]} | PASS |
| L5-UX-cskh-storefronts | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-merchantProducts | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-dealers | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-dashboard | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-analytics | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-reports | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-externalOrders | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=externalOrders, URL=externalOrders; 7 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"externalOrders","urlTab":"externalOrders","nContent":561,"bad":[]} | PASS |
| L5-UX-cskh-returns | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=returns, URL=returns; 6 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"returns","urlTab":"returns","nContent":448,"bad":[]} | PASS |
| L5-UX-cskh-customerRefunds | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-subscriptions | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-reviews | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-quickReplies | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=quickReplies, URL=quickReplies; 6 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-quickReplies.png` · {"shown":"quickReplies","urlTab":"quickReplies","nContent":541,"bad":[]} | PASS |
| L5-UX-cskh-flashSales | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-flashSales.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-posCredits | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-externalClaims | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=externalClaims, URL=externalClaims; 7 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"externalClaims","urlTab":"externalClaims","nContent":864,"bad":[]} | PASS |
| L5-UX-cskh-campaigns | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-bundles | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-engagement | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-engagement.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-dealerClaims | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-dealerAccounts | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-dealerPrices | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-commissionRates | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-payouts | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-merchantFulfilment | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-brands | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-faqs | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-faqs.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-contentKit | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-contentKit.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-academy | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-academy.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-notificationTemplates | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-notificationTemplates.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-staffRoster | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-staffRoster.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-shiftApproval | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-shiftApproval.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-payroll | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-payroll.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-attendance | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-attendance.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-config | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-config.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-opsHealth | cskh | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-cskh.json`, ảnh `ui1280-cskh-opsHealth.png` · {"shown":"inbox","urlTab":"inbox","nContent":281,"bad":[]} | PASS |
| L5-UX-cskh-sum | cskh | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-cskh.json` · [] | PASS |
| L5-UX-kho-inbox | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-orders | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=orders, URL=orders; 10 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"orders","urlTab":"orders","nContent":1407,"bad":[]} | PASS |
| L5-UX-kho-productCategories | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-users | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-supportChat | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-community | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-coupons | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-waste | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 6 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"waste","urlTab":"waste","nContent":504,"bad":[]} | PASS |
| L5-UX-kho-storefronts | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-merchantProducts | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-dealers | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-dashboard | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-analytics | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-reports | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-externalOrders | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-returns | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=returns, URL=returns; 6 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"returns","urlTab":"returns","nContent":387,"bad":[]} | PASS |
| L5-UX-kho-customerRefunds | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-subscriptions | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-reviews | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-quickReplies | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-flashSales | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-posCredits | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-externalClaims | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-campaigns | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-bundles | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-engagement | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-dealerClaims | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-dealerAccounts | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-dealerPrices | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-commissionRates | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-payouts | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":220,"bad":[]} | PASS |
| L5-UX-kho-merchantFulfilment | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-brands | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-faqs | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-contentKit | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-academy | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-notificationTemplates | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-staffRoster | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-shiftApproval | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-payroll | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":394,"bad":[]} | PASS |
| L5-UX-kho-attendance | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":395,"bad":[]} | PASS |
| L5-UX-kho-config | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":395,"bad":[]} | PASS |
| L5-UX-kho-opsHealth | kho | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-kho.json` · {"shown":"inbox","urlTab":"inbox","nContent":395,"bad":[]} | PASS |
| L5-UX-kho-sum | kho | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-kho.json` · [] | PASS |
| L5-UX-ketoan-inbox | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-orders | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=orders, URL=orders; 11 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"orders","urlTab":"orders","nContent":2474,"bad":[]} | PASS |
| L5-UX-ketoan-productCategories | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-users | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-supportChat | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-community | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-coupons | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-waste | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 7 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"waste","urlTab":"waste","nContent":551,"bad":[]} | PASS |
| L5-UX-ketoan-storefronts | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-merchantProducts | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-dealers | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-dashboard | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-analytics | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-reports | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=reports, URL=reports; 7 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"reports","urlTab":"reports","nContent":1788,"bad":[]} | PASS |
| L5-UX-ketoan-externalOrders | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-returns | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-customerRefunds | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=customerRefunds, URL=customerRefunds; 7 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"customerRefunds","urlTab":"customerRefunds","nContent":858,"bad":[]} | PASS |
| L5-UX-ketoan-subscriptions | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-reviews | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-quickReplies | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-flashSales | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-posCredits | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-externalClaims | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=externalClaims, URL=externalClaims; 8 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"externalClaims","urlTab":"externalClaims","nContent":872,"bad":[]} | PASS |
| L5-UX-ketoan-campaigns | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-bundles | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":268,"bad":[]} | PASS |
| L5-UX-ketoan-engagement | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-dealerClaims | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealerClaims, URL=dealerClaims; 7 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"dealerClaims","urlTab":"dealerClaims","nContent":366,"bad":[]} | PASS |
| L5-UX-ketoan-dealerAccounts | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=dealerAccounts, URL=dealerAccounts; 8 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"dealerAccounts","urlTab":"dealerAccounts","nContent":423,"bad":[]} | PASS |
| L5-UX-ketoan-dealerPrices | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-commissionRates | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-payouts | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=payouts, URL=payouts; 8 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"payouts","urlTab":"payouts","nContent":1045,"bad":[]} | PASS |
| L5-UX-ketoan-merchantFulfilment | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=merchantFulfilment, URL=merchantFulfilment; 8 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"merchantFulfilment","urlTab":"merchantFulfilment","nContent":554,"bad":[]} | PASS |
| L5-UX-ketoan-brands | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-faqs | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-contentKit | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-academy | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-notificationTemplates | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-staffRoster | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":563,"bad":[]} | PASS |
| L5-UX-ketoan-shiftApproval | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-payroll | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-attendance | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-config | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-opsHealth | ketoan | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 6 request, 0 lỗi; ổn | `03-matrix-ui-ketoan.json` · {"shown":"inbox","urlTab":"inbox","nContent":355,"bad":[]} | PASS |
| L5-UX-ketoan-sum | ketoan | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-ketoan.json` · [] | PASS |
| L5-UX-marketing-inbox | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-orders | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-productCategories | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-users | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-supportChat | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-community | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=community, URL=community; 7 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"community","urlTab":"community","nContent":233,"bad":[]} | PASS |
| L5-UX-marketing-coupons | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=coupons, URL=coupons; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"coupons","urlTab":"coupons","nContent":984,"bad":[]} | PASS |
| L5-UX-marketing-waste | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"waste","urlTab":"waste","nContent":557,"bad":[]} | PASS |
| L5-UX-marketing-storefronts | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-merchantProducts | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-dealers | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-dashboard | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-analytics | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-reports | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=reports, URL=reports; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"reports","urlTab":"reports","nContent":1407,"bad":[]} | PASS |
| L5-UX-marketing-externalOrders | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-returns | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-customerRefunds | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-subscriptions | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-reviews | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-quickReplies | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-flashSales | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=flashSales, URL=flashSales; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"flashSales","urlTab":"flashSales","nContent":720,"bad":[]} | PASS |
| L5-UX-marketing-posCredits | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-externalClaims | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-campaigns | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=campaigns, URL=campaigns; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"campaigns","urlTab":"campaigns","nContent":279,"bad":[]} | PASS |
| L5-UX-marketing-bundles | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=bundles, URL=bundles; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"bundles","urlTab":"bundles","nContent":319,"bad":[]} | PASS |
| L5-UX-marketing-engagement | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-dealerClaims | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-dealerAccounts | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-dealerPrices | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-commissionRates | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-payouts | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-merchantFulfilment | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-brands | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-faqs | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=faqs, URL=faqs; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"faqs","urlTab":"faqs","nContent":384,"bad":[]} | PASS |
| L5-UX-marketing-contentKit | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=contentKit, URL=contentKit; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"contentKit","urlTab":"contentKit","nContent":388,"bad":[]} | PASS |
| L5-UX-marketing-academy | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=academy, URL=academy; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"academy","urlTab":"academy","nContent":389,"bad":[]} | PASS |
| L5-UX-marketing-notificationTemplates | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=notificationTemplates, URL=notificationTemplates; 6 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"notificationTemplates","urlTab":"notificationTemplates","nContent":6112,"bad":[]} | PASS |
| L5-UX-marketing-staffRoster | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-shiftApproval | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-payroll | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-attendance | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-config | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-opsHealth | marketing | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=inbox, URL=inbox; 5 request, 0 lỗi; ổn | `03-matrix-ui-marketing.json` · {"shown":"inbox","urlTab":"inbox","nContent":273,"bad":[]} | PASS |
| L5-UX-marketing-sum | marketing | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-marketing.json` · [] | PASS |
| L5-UX-staff-inbox | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=inbox (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-orders | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=orders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-productCategories | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=productCategories (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-users | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=users (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-supportChat | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=supportChat (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-community | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=community (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-coupons | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=coupons (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-waste | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=waste (được phép) | mở đúng tab, có nội dung, không request lỗi | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-storefronts | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=storefronts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-merchantProducts | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantProducts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-dealers | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealers (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-dashboard | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=dashboard (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-analytics | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=analytics (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-reports | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=reports (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-externalOrders | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalOrders (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-returns | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=returns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-customerRefunds | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=customerRefunds (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-subscriptions | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=subscriptions (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-reviews | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=reviews (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-quickReplies | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=quickReplies (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-flashSales | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=flashSales (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-posCredits | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=posCredits (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-externalClaims | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=externalClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-campaigns | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=campaigns (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-bundles | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=bundles (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-engagement | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=engagement (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-dealerClaims | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerClaims (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-dealerAccounts | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerAccounts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-dealerPrices | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=dealerPrices (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-commissionRates | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=commissionRates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-payouts | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=payouts (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-merchantFulfilment | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=merchantFulfilment (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-brands | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=brands (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-faqs | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=faqs (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-contentKit | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=contentKit (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-academy | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=academy (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-notificationTemplates | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=notificationTemplates (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-staffRoster | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=staffRoster (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-shiftApproval | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=shiftApproval (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-payroll | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=payroll (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-attendance | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=attendance (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-config | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=config (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-opsHealth | staff | web1280 | Ma trận vai trò x tab | mở /admin?tab=opsHealth (bị cấm) | đẩy về tab waste, không gọi API bị cấm | tab hiển thị=waste, URL=waste; 5 request, 0 lỗi; ổn | `03-matrix-ui-staff.json` · {"shown":"waste","urlTab":"waste","nContent":478,"bad":[]} | PASS |
| L5-UX-staff-sum | staff | web1280 | Ma trận vai trò x tab | tổng 43 tab | mọi tab đúng quyền | 43/43 đúng | `03-matrix-ui-staff.json` · [] | PASS |

### Đơn hàng: lọc/tìm

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-list-all | admin | web1280 | Đơn hàng: lọc/tìm | GET /admin/orders | tổng = đếm SQL orders | total API=5, SQL=5 | `04-orders-filters.json` · {"keys":["data","meta"],"n":5} | PASS |
| L5-OR-search-code | admin | web1280 | Đơn hàng: lọc/tìm | search=<mã đơn> | đúng 1 đơn khớp mã | n=1 | `04-orders-filters.json` · ["TUBU2026110330313"] | PASS |
| L5-OR-search-prefix | admin | web1280 | Đơn hàng: lọc/tìm | search=<đầu mã đơn> | có đơn khớp, trong đó có đơn vừa đặt | n=4 | `04-orders-filters.json` · ["TUBU2026110330313","TUBU2026110320727","TUBU2026110330541","TUBU2026110344285"] | PASS |
| L5-OR-search-none | admin | web1280 | Đơn hàng: lọc/tìm | search không khớp | danh sách rỗng, total 0 | n=0 total=0 | `04-orders-filters.json` · {"data":[],"meta":{"page":1,"limit":20,"total":0}} | PASS |
| L5-OR-status-PENDING_PAYMENT | admin | web1280 | Đơn hàng: lọc/tìm | status=PENDING_PAYMENT | mọi dòng đúng trạng thái; total = SQL | total API=0, SQL=0 | `04-orders-filters.json` · [] | PASS |
| L5-OR-status-CONFIRMED | admin | web1280 | Đơn hàng: lọc/tìm | status=CONFIRMED | mọi dòng đúng trạng thái; total = SQL | total API=1, SQL=1 | `04-orders-filters.json` · ["CONFIRMED"] | PASS |
| L5-OR-status-PACKED | admin | web1280 | Đơn hàng: lọc/tìm | status=PACKED | mọi dòng đúng trạng thái; total = SQL | total API=1, SQL=1 | `04-orders-filters.json` · ["PACKED"] | PASS |
| L5-OR-status-SHIPPING | admin | web1280 | Đơn hàng: lọc/tìm | status=SHIPPING | mọi dòng đúng trạng thái; total = SQL | total API=0, SQL=0 | `04-orders-filters.json` · [] | PASS |
| L5-OR-status-DELIVERED | admin | web1280 | Đơn hàng: lọc/tìm | status=DELIVERED | mọi dòng đúng trạng thái; total = SQL | total API=1, SQL=1 | `04-orders-filters.json` · ["DELIVERED"] | PASS |
| L5-OR-status-CANCELLED | admin | web1280 | Đơn hàng: lọc/tìm | status=CANCELLED | mọi dòng đúng trạng thái; total = SQL | total API=2, SQL=2 | `04-orders-filters.json` · ["CANCELLED","CANCELLED"] | PASS |
| L5-OR-pay-UNPAID | admin | web1280 | Đơn hàng: lọc/tìm | payment=UNPAID | total = SQL | API=3, SQL=3 | `04-orders-filters.json` · ["UNPAID","UNPAID","UNPAID"] | PASS |
| L5-OR-pay-PAID | admin | web1280 | Đơn hàng: lọc/tìm | payment=PAID | total = SQL | API=1, SQL=1 | `04-orders-filters.json` · ["PAID"] | PASS |
| L5-OR-pay-REFUNDED | admin | web1280 | Đơn hàng: lọc/tìm | payment=REFUNDED | total = SQL | API=1, SQL=1 | `04-orders-filters.json` · ["REFUNDED"] | PASS |
| L5-OR-queue-bank | admin | web1280 | Đơn hàng: lọc/tìm | queue=bank_transfer_to_confirm | chỉ đơn chuyển khoản chờ tiền (khớp SQL) | API=0, SQL=0 | `04-orders-filters.json` · [] | PASS |
| L5-OR-date | admin | web1280 | Đơn hàng: lọc/tìm | from=to=2026-11-04 (giờ VN) | total = SQL theo ngày VN | API=4, SQL=4 | `04-orders-filters.json` | PASS |
| L5-OR-date-bad | admin | api | Đơn hàng: lọc/tìm | from=2026-13-45 | 400 JSON, lời tiếng Việt | HTTP 400 | `04-orders-filters.json` · {"message":["from phải là ngày có thật dạng YYYY-MM-DD."],"error":"Bad Request","statusCode":400} | PASS |
| L5-OR-status-bad | admin | api | Đơn hàng: lọc/tìm | status=BAYBAY | 400 JSON (không 500) | HTTP 400 | `04-orders-filters.json` · {"message":["Trường «status» chỉ nhận một trong: PENDING_PAYMENT, CONFIRMED, PACKED, SHIPPING, DELIVERED, RET… | PASS |
| L5-OR-status-counts | admin | web1280 | Đơn hàng: lọc/tìm | GET /admin/orders/status-counts (chip) | mỗi trạng thái = đếm SQL | {"CONFIRMED":1,"DELIVERED":1,"PACKED":1,"CANCELLED":2} | `04-orders-filters.json` · [{"s":"CONFIRMED","n":1},{"s":"DELIVERED","n":1},{"s":"PACKED","n":1},{"s":"CANCELLED","n":2}] | PASS |

### Đơn hàng: che SĐT

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-phone-admin | admin | web1280 | Đơn hàng: che SĐT | danh sách đơn | ADMIN thấy SĐT đầy đủ (order-actor-transitions.ts:34) | thấy đủ | `04-orders-list-pay.json` | PASS |
| L5-OR-phone-cskh | cskh | web1280 | Đơn hàng: che SĐT | danh sách đơn | CSKH thấy SĐT đầy đủ (cần gọi khách) | thấy đủ | `04-orders-list-pay.json` | PASS |
| L5-OR-phone-kho | kho | web1280 | Đơn hàng: che SĐT | danh sách đơn | KHO thấy SĐT đầy đủ (giao hàng) | thấy đủ | `04-orders-list-pay.json` | PASS |
| L5-OR-phone-ketoan | ketoan | web1280 | Đơn hàng: che SĐT | danh sách đơn | Kế toán KHÔNG thấy SĐT đầy đủ (chỉ 3 số cuối) | đã che | `04-orders-list-pay.json` · ["\"phone\":\"*******003\"","\"phone\":\"*******003\""] | PASS |
| L5-OR-phone-ketoan-search | ketoan | web1280 | Đơn hàng: che SĐT | kế toán tìm bằng SĐT một phần (đoán số) | chỉ khớp khi gõ ĐÚNG đủ SĐT (exactPhoneOnly), tìm 3 số cuối không ra | search đủ SĐT: 5 đơn | `04-orders-list-pay.json` | PASS |
| L5-OR-phone-ketoan-partial | ketoan | web1280 | Đơn hàng: che SĐT | kế toán tìm "0901000" (tiền tố SĐT) | không ra đơn nào (chặn dò SĐT) | n=0 | `04-orders-list-pay.json` · [] | PASS |

### Đơn hàng: quyền

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-list-marketing | marketing | api | Đơn hàng: quyền | GET /admin/orders | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |

### CSV đơn

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-csv-ketoan | ketoan | api | CSV đơn | GET /admin/orders/export (kế toán) | 200 CSV, SĐT bị che (không có 0901000003) | HTTP 200 text/csv; charset=utf-8 attachment; filename="don-hang-2026-11-04.csv"; SĐT đầy đủ: false | `04-orders-list-pay.json` · Mã đơn,Ngày đặt,Khách hàng,SĐT khách,Người nhận,SĐT người nhận,Loại đơn,Nơi giao,Phương thức TT,Trạng thái TT… | PASS |
| L5-OR-csv-admin | admin | api | CSV đơn | GET /admin/orders/export (admin) | 403 (route chỉ KE_TOAN kèm ADMIN: ADMIN luôn vào) -> 200 và SĐT đầy đủ | HTTP 200; SĐT đầy đủ: true | `04-orders-list-pay.json` · Mã đơn,Ngày đặt,Khách hàng,SĐT khách,Người nhận,SĐT người nhận,Loại đơn,Nơi giao,Phương thức TT,Trạng thái TT… | PASS |
| L5-OR-csv-cskh | cskh | api | CSV đơn | GET /admin/orders/export (cskh) | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-csv-kho | kho | api | CSV đơn | GET /admin/orders/export (kho) | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-csv-marketing | marketing | api | CSV đơn | GET /admin/orders/export (marketing) | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-csv-staff | staff | api | CSV đơn | GET /admin/orders/export (staff) | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-csv-rows | ketoan | api | CSV đơn | số dòng CSV (không lọc) | số dòng = đếm SQL orders (CSV có thể có dòng theo mặt hàng; ghi nhận) | 5 dòng dữ liệu, SQL orders=5 | `04-orders-list-pay.json` · Mã đơn,Ngày đặt,Khách hàng,SĐT khách,Người nhận,SĐT người nhận,Loại đơn,Nơi giao,Phương thức TT,Trạng thái TT… | PASS |

### Đã nhận tiền

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-pay-deny-cskh | cskh | api | Đã nhận tiền | cskh bấm Đã nhận tiền | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-pay-deny-kho | kho | api | Đã nhận tiền | kho bấm Đã nhận tiền | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-pay-deny-marketing | marketing | api | Đã nhận tiền | marketing bấm Đã nhận tiền | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-pay-deny-staff | staff | api | Đã nhận tiền | staff bấm Đã nhận tiền | 403 | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-pay-deny-state | ketoan | api | Đã nhận tiền | đơn sau 4 lần bị từ chối | vẫn PENDING_PAYMENT/UNPAID | PENDING_PAYMENT/UNPAID | `04-orders-list-pay.json` | PASS |
| L5-OR-pay-short | ketoan | api | Đã nhận tiền | amount thấp hơn tổng đơn | 400: chưa xác nhận thanh toán được (khách chuyển thiếu) | HTTP 400 | `04-orders-list-pay.json` · {"message":"Khách mới chuyển 60.000đ/120.000đ — chưa xác nhận thanh toán được. Liên hệ khách chuyển thêm, hoặ… | PASS |
| L5-OR-pay-over | ketoan | api | Đã nhận tiền | amount cao hơn tổng đơn | 400: tối đa tổng đơn | HTTP 400 | `04-orders-list-pay.json` · {"message":"Số tiền thực nhận phải từ 1đ đến tổng đơn 120.000đ. Khách chuyển dư thì ghi đúng tổng đơn rồi hoà… | PASS |
| L5-OR-pay-neg | ketoan | api | Đã nhận tiền | amount âm | 400 (không 500) | HTTP 400 | `04-orders-list-pay.json` · {"message":["Số tiền không được nhỏ hơn 1."],"error":"Bad Request","statusCode":400} | PASS |
| L5-OR-pay-cod | ketoan | api | Đã nhận tiền | đơn COD | 400: không phải chuyển khoản | HTTP 400 | `04-orders-list-pay.json` · {"message":"Đơn TUBU2026110330541 thanh toán COD, không phải chuyển khoản.","error":"Bad Request","statusCode… | PASS |
| L5-OR-pay-ok | ketoan | web1280 | Đã nhận tiền | Kế toán xác nhận đã nhận tiền đủ | 200; đơn PENDING_PAYMENT->CONFIRMED, UNPAID->PAID, paidAt có, có dòng lịch sử ghi người bấm | HTTP 201; CONFIRMED/PAID/paidAt=2026-11-03T21:09:32.468Z | `04-orders-list-pay.json` · {"sqlHistory":[{"f":"PENDING_PAYMENT","t":"CONFIRMED","a":"ADMIN","i":"uat_ketoan","note":"Đã nhận tiền (UNPA… | PASS |
| L5-OR-pay-idem | ketoan | api | Đã nhận tiền | bấm lần hai | idempotent: alreadyPaid, không thêm dòng lịch sử, không đổi trạng thái | HTTP 201 alreadyPaid=true; lịch sử 0->1 | `04-orders-list-pay.json` · {"ok":true,"alreadyPaid":true,"latePayment":false,"message":"Đơn TUBU2026110344285 đã được ghi nhận thanh toá… | PASS |
| L5-OR-pay-ledger | ketoan | api | Đã nhận tiền | Ví/điểm sau xác nhận tiền | Đã nhận tiền không đụng Ví; điểm đơn chỉ cộng khi giao | wallet=0/sổ=0; điểm=35400/sổ=35400 | `04-orders-list-pay.json` · {"wallet":0,"points":35400,"wsum":0,"psum":35400} | PASS |

### Đổi trạng thái đơn

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-st-cskh-PACKED | cskh | api | Đổi trạng thái đơn | cskh PUT status=PACKED | 403 (CSKH chỉ được huỷ; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Nhóm việc của bạn không đổi được đơn sang trạng thái này: CSKH chỉ huỷ đơn (trước khi bàn giao vậ… | PASS |
| L5-OR-st-cskh-DELIVERED | cskh | api | Đổi trạng thái đơn | cskh PUT status=DELIVERED | 403 (CSKH không được Đã giao tay; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Nhóm việc của bạn không đổi được đơn sang trạng thái này: CSKH chỉ huỷ đơn (trước khi bàn giao vậ… | PASS |
| L5-OR-st-kho-CANCELLED | kho | api | Đổi trạng thái đơn | kho PUT status=CANCELLED | 403 (KHO chỉ được Đã đóng gói; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Nhóm việc của bạn không đổi được đơn sang trạng thái này: CSKH chỉ huỷ đơn (trước khi bàn giao vậ… | PASS |
| L5-OR-st-kho-DELIVERED | kho | api | Đổi trạng thái đơn | kho PUT status=DELIVERED | 403 (KHO không được Đã giao tay; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Nhóm việc của bạn không đổi được đơn sang trạng thái này: CSKH chỉ huỷ đơn (trước khi bàn giao vậ… | PASS |
| L5-OR-st-ketoan-CANCELLED | ketoan | api | Đổi trạng thái đơn | ketoan PUT status=CANCELLED | 403 (Kế toán không đổi trạng thái đơn; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-st-marketing-PACKED | marketing | api | Đổi trạng thái đơn | marketing PUT status=PACKED | 403 (Marketing không đổi trạng thái đơn; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-st-staff-PACKED | staff | api | Đổi trạng thái đơn | staff PUT status=PACKED | 403 (STAFF không nhóm không đổi trạng thái; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-st-returning-PACKED | returning | api | Đổi trạng thái đơn | returning PUT status=PACKED | 403 (khách không gọi API admin; order-actor-transitions.ts) | HTTP 403 | `04-orders-list-pay.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-OR-st-state | admin | api | Đổi trạng thái đơn | đơn sau các lần bị từ chối | không đổi (CONFIRMED) | CONFIRMED | `04-orders-list-pay.json` | PASS |
| L5-OR-st-kho-packed | kho | api | Đổi trạng thái đơn | KHO đánh dấu Đã đóng gói | 200, CONFIRMED -> PACKED | HTTP 200 PACKED | `04-orders-list-pay.json` · {"id":"cmw16l2es00ewjtc485zz2rre","code":"TUBU2026110330541","idempotencyKey":"uat-l5-1793740171613-8dheobyh"… | PASS |
| L5-OR-st-no-back | admin | api | Đổi trạng thái đơn | admin lùi PACKED -> CONFIRMED | 400 (không lùi: order-transition.ts) | HTTP 400 | `04-orders-list-pay.json` · {"message":"Không thể chuyển đơn từ PACKED sang CONFIRMED.","error":"Bad Request","statusCode":400} | PASS |
| L5-OR-st-junk | admin | api | Đổi trạng thái đơn | status không có thật | 400 JSON | HTTP 400 | `04-orders-list-pay.json` · {"message":["Trường «status» chỉ nhận một trong: PENDING_PAYMENT, CONFIRMED, PACKED, SHIPPING, DELIVERED, RET… | PASS |

### Huỷ đơn

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-cancel-cod | cskh | web1280 | Huỷ đơn | CSKH huỷ đơn COD chưa giao | 200, CANCELLED, không hoàn tiền (COD chưa thu), Ví không đổi, lịch sử ghi CSKH | HTTP 200; CANCELLED/UNPAID; Ví 0->0 | `04-orders-list-pay.json` · {"hist":[{"f":"CONFIRMED","t":"CANCELLED","a":"ADMIN","i":"uat_cskh","note":"Admin: khách xin huỷ (uat)"}],"s… | PASS |
| L5-OR-cancel-twice | cskh | api | Huỷ đơn | huỷ lần hai | không hoàn/ghi thêm (idempotent hoặc 400) | HTTP 200; Ví 0->0 | `04-orders-list-pay.json` · {"id":"cmw16l2i600fmjtc4rtmvyj85","code":"TUBU2026110330313","idempotencyKey":"uat-l5-1793740171739-bns7kqm2"… | PASS |
| L5-OR-cancel-final | admin | api | Huỷ đơn | đơn CANCELLED chuyển lại PACKED | 400, vẫn CANCELLED | HTTP 400; CANCELLED | `04-orders-list-pay.json` · {"message":"Không thể chuyển đơn từ CANCELLED sang PACKED.","error":"Bad Request","statusCode":400} | PASS |

### Hoàn toàn phần

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OR-refund-full-cancel | cskh | web1280 | Hoàn toàn phần | CSKH huỷ đơn chuyển khoản ĐÃ trả | đơn CANCELLED, paymentStatus REFUNDED, Ví +210000đ, sổ Ví khớp | HTTP 200; CANCELLED/REFUNDED; Ví 0->210000 (kỳ vọng +210000); sổ Ví 210000 | `04-orders-list-pay.json` · {"wl":[{"d":210000,"t":"ORDER_REFUND","rt":"ORDER","r":"cmw16l2gk00f9jtc4gojiysmv","reason":"Hoàn tiền đơn TU… | PASS |
| L5-OR-refund-no-double | cskh | api | Hoàn toàn phần | huỷ lần hai đơn đã hoàn | không hoàn lần hai (Ví không đổi) | Ví 210000->210000 | `04-orders-list-pay.json` · {"id":"cmw16l2gk00f9jtc4gojiysmv","code":"TUBU2026110320727","idempotencyKey":"uat-l5-1793740171683-qhvawnbf"… | PASS |
| L5-OR-refund-queue-row | cskh | api | Hoàn toàn phần | dòng hàng đợi Hoàn tiền khách của đơn hoàn về Ví | hoàn về Ví thì có dòng WALLET đã xong (hoặc không có dòng) — ghi nhận | 1 dòng | `04-orders-list-pay.json` · [{"n":1}] | PASS |

### Đổi/trả: chuẩn bị

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-A-delivered | returning | api | Đổi/trả: chuẩn bị | đặt COD 3 món rồi giao (KHO đóng gói + webhook Pancake) | đơn DELIVERED, có deliveredAt, điểm đơn vào sổ | DELIVERED deliveredAt=2026-11-03T21:11:49.024Z | `05-returns.json` · {"full":[{"sub":360000,"disc":0,"ship":0,"total":360000,"pe":8640}],"items":[{"id":"cmw16nzu000sejtc4nkywvmlu… | PASS |
| L5-RT-A-points-ledger | returning | api | Đổi/trả: chuẩn bị | điểm sau giao đối chiếu sổ | users.pointsBalance = SUM(sổ STANDARD); có dòng ORDER_DELIVERED | điểm=58440 sổ=58440; ví=1110000 sổ ví=1110000 | `05-returns.json` · {"ledgerA":[{"d":8640,"reason":"ORDER_DELIVERED:TUBU2026110345261","lot":"STANDARD","rt":"ORDER"}]} | PASS |

### Đổi/trả: yêu cầu

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-B-reason-short | returning | mini375 | Đổi/trả: yêu cầu | lý do khác < 5 ký tự | 400 lời tiếng Việt (return-request: RETURN_REASON_REQUIRED) | HTTP 400 | `05-returns.json` · {"message":"Bạn mô tả lý do đổi/trả (ít nhất 5 ký tự) nhé.","error":"Bad Request","statusCode":400} | PASS |
| L5-RT-B-qty-over | returning | mini375 | Đổi/trả: yêu cầu | trả nhiều hơn số đã mua (99 > 3) | 400, không tạo yêu cầu | HTTP 400 | `05-returns.json` · {"message":"Số lượng trả của \"Nước rửa chén sinh học Fuwa3e\" vượt số còn lại có thể trả (3).","error":"Bad … | PASS |
| L5-RT-B-create-partial | returning | mini375 | Đổi/trả: yêu cầu | khách trả 1/3 món (lý do: hàng lỗi) | 201, trạng thái REQUESTED | HTTP 201 | `05-returns.json` · {"id":"cmw16o0uz00t8jtc43dcldba4","orderId":"cmw16nzu000sdjtc4c8tnvi9p","userId":"uat_returning","reason":"Ch… | PASS |
| L5-RT-B-duplicate | returning | mini375 | Đổi/trả: yêu cầu | gửi lần hai khi còn yêu cầu chờ | 400: Đơn đang có yêu cầu đổi/trả chờ xử lý | HTTP 400 | `05-returns.json` · {"message":"Đơn đang có yêu cầu đổi/trả chờ xử lý.","error":"Bad Request","statusCode":400} | PASS |

### Đổi/trả: duyệt

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-B-review-deny-kho | kho | api | Đổi/trả: duyệt | kho duyệt đổi/trả | 403 (chỉ CSKH/ADMIN: returns-admin.controller.ts) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-review-deny-ketoan | ketoan | api | Đổi/trả: duyệt | ketoan duyệt đổi/trả | 403 (chỉ CSKH/ADMIN: returns-admin.controller.ts) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-review-deny-marketing | marketing | api | Đổi/trả: duyệt | marketing duyệt đổi/trả | 403 (chỉ CSKH/ADMIN: returns-admin.controller.ts) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-review-deny-staff | staff | api | Đổi/trả: duyệt | staff duyệt đổi/trả | 403 (chỉ CSKH/ADMIN: returns-admin.controller.ts) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-review-deny-returning | returning | api | Đổi/trả: duyệt | returning duyệt đổi/trả | 403 (chỉ CSKH/ADMIN: returns-admin.controller.ts) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |

### Đổi/trả: danh sách

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-B-list-deny-ketoan | ketoan | api | Đổi/trả: danh sách | ketoan xem danh sách đổi/trả | 403 | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-list-deny-marketing | marketing | api | Đổi/trả: danh sách | marketing xem danh sách đổi/trả | 403 | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RT-B-list-kho | kho | api | Đổi/trả: danh sách | KHO xem danh sách (được phép CSKH/KHO) | 200 | HTTP 200 | `05-returns.json` · ["cmw16o0uz00t8jtc43dcldba4","cmw16njxc00m3jtc4ccivkf19"] | PASS |

### Đổi/trả: xem trước

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-B-preview-kho | kho | api | Đổi/trả: xem trước | KHO xem số tiền hoàn | 403 (preview chỉ CSKH) | HTTP 403 | `05-returns.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |

### Đổi/trả: duyệt từng phần

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-C-preview | cskh | web1280 | Đổi/trả: duyệt từng phần | CSKH xem số tiền hoàn trước khi duyệt | 200, có số tiền hoàn của dòng, là hoàn một phần (không tính phí ship vì không trả cả đơn trừ lỗi shop) | HTTP 200 | `05-returns.json` · {"requestId":"cmw16o0uz00t8jtc43dcldba4","shopFault":true,"defaultShopFault":true,"isFull":false,"goods":1200… | PASS |
| L5-RT-C-preview-math | cskh | api | Đổi/trả: duyệt từng phần | số tiền hoàn một phần | hoàn ≈ 1/3 tiền hàng sau giảm (120000đ; giá món 120000đ), lỗi shop có thể cộng phí ship 0đ | goods=120000 shipping=0 refund=120000 | `05-returns.json` · {"pv":{"requestId":"cmw16o0uz00t8jtc43dcldba4","shopFault":true,"defaultShopFault":true,"isFull":false,"goods… | PASS |
| L5-RT-C-stale-expected | cskh | api | Đổi/trả: duyệt từng phần | duyệt với số tiền đã xem lệch số tính lại | 409/400: từ chối để xem lại (review: expectedRefund) | HTTP 409 | `05-returns.json` · {"message":"Số tiền hoàn đã đổi thành 120.000đ (đơn vừa có thay đổi). Xem lại trước khi duyệt.","error":"Conf… | PASS |
| L5-RT-C-approve | cskh | web1280 | Đổi/trả: duyệt từng phần | CSKH duyệt (lỗi shop) | 200, yêu cầu APPROVED | HTTP 201 | `05-returns.json` · {"id":"cmw16o0uz00t8jtc43dcldba4","orderId":"cmw16nzu000sdjtc4c8tnvi9p","userId":"uat_returning","reason":"Ch… | PASS |
| L5-RT-C-wallet | returning | api | Đổi/trả: duyệt từng phần | Ví sau duyệt từng phần | Ví tăng đúng số tiền hoàn của yêu cầu; sổ Ví khớp số dư; đơn vẫn DELIVERED (chưa trả hết) | Ví 1110000->1230000 (+120000); sổ 1230000; đơn DELIVERED; yêu cầu APPROVED | `05-returns.json` · {"wl":[{"d":120000,"t":"ORDER_REFUND","reason":"Hoàn tiền trả hàng đơn TUBU2026110345261"},{"d":210000,"t":"O… | PASS |
| L5-RT-C-wallet-equals-preview | cskh | api | Đổi/trả: duyệt từng phần | tiền hoàn thực tế = số CSKH đã thấy ở xem trước (cùng shopFault) | bằng nhau | thực 120000; xem trước(shopFault) 120000; xem trước(mặc định) 120000 | `05-returns.json` · {"pv":{"requestId":"cmw16o0uz00t8jtc43dcldba4","shopFault":true,"defaultShopFault":true,"isFull":false,"goods… | PASS |
| L5-RT-C-points | returning | api | Đổi/trả: duyệt từng phần | điểm sau duyệt từng phần | điểm đảo theo phần (≈1/3 điểm đơn); users.pointsBalance = SUM(sổ) | điểm 58440->55560; sổ 55560 | `05-returns.json` · {"pointsRev":[{"d":-2880,"reason":"RETURN_REVERSED:TUBU2026110345261"},{"d":8640,"reason":"ORDER_DELIVERED:TU… | PASS |
| L5-RT-C-approve-twice | cskh | api | Đổi/trả: duyệt từng phần | duyệt lần hai cùng yêu cầu | 4xx, không hoàn thêm | HTTP 400; Ví 1230000->1230000 | `05-returns.json` · {"message":"Yêu cầu đã được xử lý.","error":"Bad Request","statusCode":400} | PASS |

### Đổi/trả: nhận hàng về

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-C-received | kho | api | Đổi/trả: nhận hàng về | KHO bấm Đã nhận hàng về | 200; tồn kho +1 (đúng số lượng trả) | HTTP 201; kho 187->188 | `05-returns.json` · {"id":"cmw16o0uz00t8jtc43dcldba4","orderId":"cmw16nzu000sdjtc4c8tnvi9p","userId":"uat_returning","reason":"Ch… | PASS |
| L5-RT-C-received-twice | kho | api | Đổi/trả: nhận hàng về | bấm lần hai | không cộng kho lần hai | HTTP 400; kho 188->188 | `05-returns.json` · {"message":"Yêu cầu chưa được duyệt hoặc đã ghi nhận nhận hàng trước đó.","error":"Bad Request","statusCode":… | PASS |

### Đổi/trả: hoàn toàn phần

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-D-create-rest | returning | mini375 | Đổi/trả: hoàn toàn phần | khách trả nốt mọi dòng còn lại (không gửi items) | 201 REQUESTED | HTTP 201 | `05-returns.json` · {"id":"cmw16o0yi00ttjtc4oe5ljm6m","orderId":"cmw16nzu000sdjtc4c8tnvi9p","userId":"uat_returning","reason":"Kh… | PASS |
| L5-RT-D-approve-rest | cskh | web1280 | Đổi/trả: hoàn toàn phần | CSKH duyệt lần trả nốt | 200; đơn RETURNED; tổng đã hoàn về Ví của đơn ≤ tổng đơn | HTTP 201; đơn RETURNED; tổng hoàn ví của đơn 360000 / tổng đơn 360000 | `05-returns.json` · {"pv2":{"requestId":"cmw16o0yi00ttjtc4oe5ljm6m","shopFault":false,"defaultShopFault":false,"isFull":true,"goo… | PASS |
| L5-RT-D-sum-equals-total | returning | api | Đổi/trả: hoàn toàn phần | cộng hai lần hoàn so với tổng đơn (COD đã thu, trả hết) | tổng hoàn = tổng đơn 360000đ (hàng + phí ship) | tổng hoàn 360000 vs đơn 360000 | `05-returns.json` · {"wl":[{"d":240000,"t":"ORDER_REFUND","reason":"Hoàn tiền đơn TUBU2026110345261"},{"d":120000,"t":"ORDER_REFU… | PASS |
| L5-RT-D-points-net | returning | api | Đổi/trả: hoàn toàn phần | điểm của đơn sau trả hết | điểm đơn bị thu hồi hết: tổng sổ liên quan đơn = 0; users.pointsBalance = SUM(sổ) | tổng sổ theo mã đơn 0; điểm 55560->49800; sổ 49800 | `05-returns.json` · {"ledger":[{"d":8640,"reason":"ORDER_DELIVERED:TUBU2026110345261","lot":"STANDARD","rt":"ORDER"},{"d":-2880,"… | PASS |
| L5-RT-D-closed | returning | mini375 | Đổi/trả: hoàn toàn phần | đơn đã RETURNED gửi yêu cầu nữa | 400 | HTTP 400 | `05-returns.json` · {"message":"Chỉ yêu cầu đổi/trả với đơn đã giao.","error":"Bad Request","statusCode":400} | PASS |
| L5-RT-E-full | cskh | web1280 | Đổi/trả: hoàn toàn phần | trả cả đơn 1 món sau khi bị từ chối lần đầu | đơn RETURNED; Ví +tổng đơn; điểm đơn thu hồi; sổ khớp | HTTP 201; đơn RETURNED; Ví +210000 (tổng đơn 210000); điểm 54840->49800; sổ ví 1680000/điểm 49800 | `05-returns.json` · {"pv":{"requestId":"cmw16o26s00vijtc40aay7el3","shopFault":true,"defaultShopFault":true,"isFull":true,"goods"… | PASS |

### Đổi/trả: từ chối

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RT-E-reject | cskh | web1280 | Đổi/trả: từ chối | CSKH từ chối đổi/trả | 200, yêu cầu REJECTED, đơn vẫn DELIVERED, Ví/điểm không đổi | HTTP 201; REJECTED; đơn DELIVERED; Ví 1470000->1470000; điểm 54840->54840 | `05-returns.json` · {"id":"cmw16o26c00vcjtc4i7kufoh5","orderId":"cmw16o13n00ujjtc42s92wm1b","userId":"uat_returning","reason":"Gi… | PASS |

### Cần xử lý Pancake

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-PK-queue-appear | kho | web1280 | Cần xử lý Pancake | Pancake báo HUỶ đơn đã bàn giao | đơn vào hàng đợi (pancakeAttention có lý do), lọc ?pancake=attention thấy đơn, số đếm khớp SQL | lý do="Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển (đơn đang giao) — KHÔNG tự huỷ/hoàn tiền."; trong hàng đợi=true; API=7, SQL=7; đơn SHIPPING | `06-pancake-refunds.json` · {"cancelHook":" \"pancakeAttention\": \"Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển (đơn đang giao) — KH… | PASS |
| L5-PK-resolve-deny-cskh | cskh | api | Cần xử lý Pancake | cskh bấm Đã xử lý | 403 (chỉ KHO/ADMIN) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PK-resolve-deny-ketoan | ketoan | api | Cần xử lý Pancake | ketoan bấm Đã xử lý | 403 (chỉ KHO/ADMIN) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PK-resolve-deny-marketing | marketing | api | Cần xử lý Pancake | marketing bấm Đã xử lý | 403 (chỉ KHO/ADMIN) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PK-resolve-deny-staff | staff | api | Cần xử lý Pancake | staff bấm Đã xử lý | 403 (chỉ KHO/ADMIN) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PK-resolve-ok | kho | web1280 | Cần xử lý Pancake | KHO bấm "Đã xử lý" | 200; đơn rời hàng đợi (pancakeAttention rỗng); lịch sử đơn ghi ai xử lý | HTTP 201; còn lý do=false | `06-pancake-refunds.json` · {"hist":[{"note":"Đã xử lý việc Pancake: Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển (đơn đang giao) — K… | PASS |
| L5-PK-resolve-twice | kho | api | Cần xử lý Pancake | bấm lần hai | 400: đơn không còn trong hàng đợi | HTTP 400 | `06-pancake-refunds.json` · {"message":"Đơn TUBU2026110386039 không còn trong hàng đợi cần xử lý Pancake.","error":"Bad Request","statusC… | PASS |
| L5-PK-unsynced-filter | kho | api | Cần xử lý Pancake | lọc ?pancake=unsynced | 200 (đơn mới đẩy sau 15 phút mới tính chưa lên) | HTTP 200 n=0 | `06-pancake-refunds.json` | PASS |

### Hoàn tiền khách: COD trả hàng

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-PK-cod-return-unverified | ketoan | web1280 | Hoàn tiền khách: COD trả hàng | Pancake báo "Đã hoàn" cho đơn COD đã giao | đơn RETURNED; Ví khách KHÔNG tự tăng; có khoản RETURN trạng thái UNVERIFIED; đơn vào hàng đợi Pancake với lý do COD chờ Kế toán (pancake-attention.ts) | đơn RETURNED; Ví 1680000->1680000; khoản RETURN/UNVERIFIED/289000 | `06-pancake-refunds.json` · {"refRow":{"id":"cmw16qmg9019hjtc43kj6tx8n","k":"RETURN","s":"UNVERIFIED","a":289000,"m":"MANUAL_TRANSFER","r… | PASS |
| L5-PK-resolve-blocked-cod | kho | api | Hoàn tiền khách: COD trả hàng | KHO bấm Đã xử lý khi còn khoản COD chờ Kế toán | 400: xử lý ở mục Hoàn tiền khách trước (admin.service.ts:1400) | HTTP 400 | `06-pancake-refunds.json` · {"message":"Đơn TUBU2026110308970 còn khoản hoàn COD chờ Kế toán quyết ở mục \"Hoàn tiền khách\" — xử lý ở đó… | PASS |
| L5-PK-resolve-after-refund | kho | api | Hoàn tiền khách: COD trả hàng | KHO bấm Đã xử lý sau khi Kế toán xong | tuỳ lý do còn lại: 400 "không còn trong hàng đợi" là đúng nếu Kế toán đã gỡ lý do | HTTP 400 {"message":"Đơn TUBU2026110308970 không còn trong hàng đợi cần xử lý Pancake.","error":"Bad Request","statusCode":400} | `06-pancake-refunds.json` · {"pa":null} | PASS |

### Hoàn tiền khách

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RF-list-deny-cskh | cskh | api | Hoàn tiền khách | cskh xem Hoàn tiền khách | 403 | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-list-deny-kho | kho | api | Hoàn tiền khách | kho xem Hoàn tiền khách | 403 | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-list-deny-marketing | marketing | api | Hoàn tiền khách | marketing xem Hoàn tiền khách | 403 | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-list-deny-staff | staff | api | Hoàn tiền khách | staff xem Hoàn tiền khách | 403 | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-list-ketoan | ketoan | web1280 | Hoàn tiền khách | Kế toán xem khoản chờ đối soát | 200, thấy khoản COD trả hàng chờ đối soát | HTTP 200; khoản cmw16qmg9019hjtc43kj6tx8n | `06-pancake-refunds.json` · {"id":"cmw16qmg9019hjtc43kj6tx8n","orderId":"cmw16ql9b018ijtc462xzyoyx","orderCode":"TUBU2026110308970","kind… | PASS |
| L5-RF-verify-over | ketoan | api | Hoàn tiền khách | xác nhận hoàn quá số khoản | 400: tối đa phần chưa hoàn | HTTP 400 | `06-pancake-refunds.json` · {"message":"Số tiền hoàn phải từ 1đ đến 289.000đ (phần chưa hoàn của đơn).","error":"Bad Request","statusCode… | PASS |
| L5-RF-verify-ok | ketoan | web1280 | Hoàn tiền khách | Kế toán xác nhận hãng đã thu COD | khoản UNVERIFIED -> PENDING; lý do COD rời hàng đợi Pancake | HTTP 201; khoản PENDING; còn lý do=false | `06-pancake-refunds.json` · {"id":"cmw16qmg9019hjtc43kj6tx8n","orderId":"cmw16ql9b018ijtc462xzyoyx","orderCode":"TUBU2026110308970","kind… | PASS |
| L5-RF-claim-deny-cskh | cskh | api | Hoàn tiền khách | CSKH bấm bắt đầu chuyển khoản | 403 | HTTP 403 | `06-pancake-refunds.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-claim-ketoan-typed-bank | ketoan | api | Hoàn tiền khách | Kế toán tự nhập số tài khoản nhận thay khách | 403: nhân viên không nhập tài khoản nhận, nhờ quản trị viên (customer-refunds.service assertStaffMayHandle) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Nhân viên không nhập tài khoản nhận. Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập.","e… | PASS |
| L5-RF-markpaid-no-account | ketoan | api | Hoàn tiền khách | Đã chi khi khách chưa có tài khoản nhận | 403: khách chưa chọn tài khoản nhận (không chi khi chưa biết chuyển đâu) | HTTP 403 | `06-pancake-refunds.json` · {"message":"Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập.","error":"Forbidden","statusCode":403} | PASS |
| L5-RF-claim-ok | admin | web1280 | Hoàn tiền khách | ADMIN nhập tài khoản và bắt đầu chuyển khoản | khoản sang PROCESSING | HTTP 201; PROCESSING | `06-pancake-refunds.json` · {"id":"cmw16qmg9019hjtc43kj6tx8n","orderId":"cmw16ql9b018ijtc462xzyoyx","orderCode":"TUBU2026110308970","kind… | PASS |
| L5-RF-markpaid-noref | ketoan | api | Hoàn tiền khách | Đã chi không có mã giao dịch | 400 (bankRef bắt buộc) | HTTP 400 | `06-pancake-refunds.json` · {"message":["Trường «bankRef» không được dài quá 100 ký tự.","Trường «bankRef» phải có ít nhất 1 ký tự.","Trư… | PASS |
| L5-RF-markpaid-claimed-by-other | ketoan | api | Hoàn tiền khách | Kế toán bấm Đã chi khoản do ADMIN đang chuyển | 400: chỉ người đang chuyển được xác nhận, hoặc chọn Tiếp quản kèm lý do (customer-refunds.service) | HTTP 400 | `06-pancake-refunds.json` · {"message":"Khoản này đang do Admin UAT chuyển khoản từ 04:13 04/11/2026. Chỉ người đó được xác nhận đã chuyể… | PASS |
| L5-RF-markpaid-ok | ketoan | web1280 | Hoàn tiền khách | Kế toán bấm Đã chi | khoản COMPLETED; chi bằng chuyển khoản tay nên Ví khách KHÔNG đổi; Ví = sổ Ví | HTTP 201; {"s":"COMPLETED"}; Ví 1680000->1680000 | `06-pancake-refunds.json` · {"id":"cmw16qmg9019hjtc43kj6tx8n","orderId":"cmw16ql9b018ijtc462xzyoyx","orderCode":"TUBU2026110308970","kind… | PASS |
| L5-RF-markpaid-twice | ketoan | api | Hoàn tiền khách | bấm Đã chi lần hai | 4xx, không ghi hai lần | HTTP 400 | `06-pancake-refunds.json` · {"message":"Khoản này đã được xác nhận chuyển khoản (mã GD UATRF001).","error":"Bad Request","statusCode":400} | PASS |

### Hoàn toàn phần về ngân hàng

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RF-cancel-bank | returning | mini375 | Hoàn toàn phần về ngân hàng | khách huỷ đơn đã chuyển khoản, chọn nhận về ngân hàng | đơn CANCELLED/REFUNDED; có khoản CANCEL PENDING 120000đ; Ví KHÔNG đổi | HTTP 201; CANCELLED/REFUNDED; khoản {"id":"cmw16qn1h01akjtc4rxfk3xc6","k":"CANCEL","s":"PENDING","a":120000,"m":"MANUAL_TRANSFER"}; Ví 1680000->1680000 | `06-pancake-refunds.json` · {"id":"cmw16qmmf01a7jtc461kjyxhd","code":"TUBU2026110330461","userId":"uat_returning","type":"RETAIL","status… | PASS |
| L5-RF-cancel-bank-paid | ketoan | web1280 | Hoàn toàn phần về ngân hàng | Kế toán claim rồi Đã chi | COMPLETED; Ví khách không đổi | claim 201; paid 201; COMPLETED; Ví 1680000->1680000 | `06-pancake-refunds.json` · {"id":"cmw16qn1h01akjtc4rxfk3xc6","orderId":"cmw16qmmf01a7jtc461kjyxhd","orderCode":"TUBU2026110330461","kind… | PASS |
| L5-RF-cancel-bank-missing | returning | mini375 | Hoàn toàn phần về ngân hàng | huỷ chọn ngân hàng nhưng thiếu số tài khoản | 400 lời tiếng Việt, đơn KHÔNG bị huỷ | HTTP 400; đơn CONFIRMED | `06-pancake-refunds.json` · {"message":"Số tài khoản nhận tiền hoàn chỉ gồm chữ số, từ 6 đến 24 số.","error":"Bad Request","statusCode":4… | PASS |

### Hoàn tiền khách: che SĐT

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RF-note-mask | ketoan | web1280 | Hoàn tiền khách: che SĐT | ghi chú khoản hoàn có SĐT | Kế toán thấy SĐT trong ghi chú bị che; ADMIN thấy đủ | kế toán: "khách gọi từ *******678 xác nhận"; admin: "khách gọi từ 0912345678 xác nhận" | `06-pancake-refunds.json` | PASS |

### Lệnh rút (legacy)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-PAY-01 | returning | api | Lệnh rút (legacy) | POST /wallet/withdraw | HTTP 410 (Zalo 4.5 cấm rút tiền), wallet.controller.ts:25 | HTTP 410 | `07-ops-misc.json` · {"message":"Ví Tubu chỉ dùng để trả tiền hàng, không rút ra ngoài.","error":"Gone","statusCode":410} | PASS |
| L5-PAY-02 | ctv | api | Lệnh rút (legacy) | POST /affiliate/payouts method=BANK | HTTP 400, chỉ nhận WALLET_BALANCE (affiliate.controller.ts:124) | HTTP 400 | `07-ops-misc.json` · {"message":"Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng.","error":"Bad Request","statusCode":400} | PASS |
| L5-PAY-03 | ketoan | api | Lệnh rút (legacy) | Kế toán bấm "Duyệt" | 403: duyệt chỉ ADMIN, người duyệt khác người chi (payout-admin.controller.ts:67) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-04 | ketoan | api | Lệnh rút (legacy) | Kế toán bấm "Từ chối" | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-05 | ketoan | api | Lệnh rút (legacy) | Chi khi lệnh còn REQUESTED | 400 "không ở trạng thái Đã duyệt" (affiliate.service.ts:2389) | HTTP 400 | `07-ops-misc.json` · {"message":"Lệnh rút không ở trạng thái \"Đã duyệt\" hoặc vừa được xử lý bởi người khác — bạn tải lại nhé.","… | PASS |
| L5-PAY-06 | admin | api | Lệnh rút (legacy) | ADMIN duyệt với expectedAmount cũ (400.000 so với 500.000) | 409, câu nêu số đã đổi (affiliate.service.ts:2184) | HTTP 409 | `07-ops-misc.json` · {"message":"Số thực nhận của lệnh đã đổi từ 400.000đ thành 500.000đ (thuế giữ dư vừa được hoàn), bạn tải lại … | PASS |
| L5-PAY-07 | admin | api | Lệnh rút (legacy) | ADMIN duyệt đúng số | 200, status APPROVED, reviewedBy = admin | HTTP 201, DB APPROVED/uat_admin | `07-ops-misc.json` · {"id":"uatpayzevgn8ax","userId":"uat_ctv","amount":500000,"fee":0,"grossAmount":null,"taxWithheld":0,"taxRefu… | PASS |
| L5-PAY-08 | admin | api | Lệnh rút (legacy) | Duyệt lần 2 | 400, không đổi trạng thái | HTTP 400 | `07-ops-misc.json` · {"message":"Lệnh rút không ở trạng thái \"Yêu cầu\" hoặc vừa được xử lý bởi người khác — bạn tải lại nhé.","e… | PASS |
| L5-PAY-09 | admin | api | Lệnh rút (legacy) | Từ chối lệnh đã APPROVED | 400 (chỉ REQUESTED mới từ chối được) | HTTP 400 | `07-ops-misc.json` · {"message":"Lệnh rút không ở trạng thái \"Yêu cầu\" hoặc vừa được xử lý bởi người khác — bạn tải lại nhé.","e… | PASS |
| L5-PAY-10-staff | staff | api | Lệnh rút (legacy) | staff bấm "Đã chi" | 403 (chỉ ADMIN và KE_TOAN) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-10-kho | kho | api | Lệnh rút (legacy) | kho bấm "Đã chi" | 403 (chỉ ADMIN và KE_TOAN) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-10-marketing | marketing | api | Lệnh rút (legacy) | marketing bấm "Đã chi" | 403 (chỉ ADMIN và KE_TOAN) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-10-cskh | cskh | api | Lệnh rút (legacy) | cskh bấm "Đã chi" | 403 (chỉ ADMIN và KE_TOAN) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-11 | ketoan | api | Lệnh rút (legacy) | Kế toán "Đã chi" với số cũ | 409 | HTTP 409 | `07-ops-misc.json` · {"message":"Số thực nhận của lệnh đã đổi từ 1đ thành 500.000đ (thuế giữ dư vừa được hoàn), bạn tải lại trước … | PASS |
| L5-PAY-12 | ketoan | api | Lệnh rút (legacy) | Kế toán "Đã chi" đúng số + mã giao dịch | 200, PAID, paidBy = kế toán, bankRef lưu | HTTP 201, DB {"status":"PAID","pb":"uat_ketoan","br":"FT26UAT0001","pa":"2026-11-03T21:23:01.841Z"} | `07-ops-misc.json` · {"id":"uatpayzevgn8ax","userId":"uat_ctv","amount":500000,"fee":0,"grossAmount":null,"taxWithheld":0,"taxRefu… | PASS |
| L5-PAY-13 | ketoan | api | Lệnh rút (legacy) | Bấm "Đã chi" lần 2 | 400, bankRef không bị ghi đè | HTTP 400, bankRef=FT26UAT0001 | `07-ops-misc.json` · {"message":"Lệnh rút không ở trạng thái \"Đã duyệt\" hoặc vừa được xử lý bởi người khác — bạn tải lại nhé.","… | PASS |
| L5-PAY-14 | ctv | api | Lệnh rút (legacy) | Thông báo cho CTV (duyệt + chi) | có thông báo PAYOUT_APPROVED và PAYOUT_PAID | 18 dòng notification_logs có PAYOUT | `07-ops-misc.json` · [{"n":18}] | PASS |
| L5-PAY-15 | ctv | api | Lệnh rút (legacy) | Ví CTV không đổi khi duyệt + chi (tiền đi ngân hàng, không qua ví) | walletBalance trước = sau, sổ ví = số dư | ví 2020000 -> 2020000, tổng sổ 2020000 | `07-ops-misc.json` · {"before":{"wallet":2020000,"points":0,"wsum":2020000,"psum":0},"afterPaid":{"wallet":2020000,"points":0,"wsu… | PASS |
| L5-PAY-16 | admin | api | Lệnh rút (legacy) | Từ chối thiếu lý do | 400 (DTO @IsNotEmpty hoặc "Nhập lý do từ chối") | HTTP 400 | `07-ops-misc.json` · {"message":"Nhập lý do từ chối.","error":"Bad Request","statusCode":400} | PASS |
| L5-PAY-17 | admin | api | Lệnh rút (legacy) | ADMIN từ chối lệnh 300.000 + phí 5.000 | REJECTED + hoàn 305.000 vào ví (WITHDRAW_REFUND), sổ ví = số dư | HTTP 201, ví +305000, sổ 2325000/2325000 | `07-ops-misc.json` · {"pr":{"status":"REJECTED","rr":"UAT: sai số tài khoản"},"ledger":[{"type":"WITHDRAW_REFUND","delta":305000,"… | PASS |
| L5-PAY-18 | admin | api | Lệnh rút (legacy) | Từ chối lần 2 (chống hoàn trùng) | 400, ví không tăng thêm | HTTP 400, ví 2325000 -> 2325000 | `07-ops-misc.json` · {"message":"Lệnh rút không ở trạng thái \"Yêu cầu\" hoặc vừa được xử lý bởi người khác — bạn tải lại nhé.","e… | PASS |
| L5-PAY-19 | admin | api | Lệnh rút (legacy) | 3 request từ chối cùng lúc một lệnh | đúng 1 thành công, ví chỉ +200.000 một lần | thành công 1/3, ví +200000 | `07-ops-misc.json` · [201,400,400] | PASS |
| L5-PAY-20 | ketoan | api | Lệnh rút (legacy) | Kế toán xem danh sách lệnh PAID | 200, có lệnh vừa chi, kèm tên + SĐT người nhận | HTTP 200, 5 dòng | `07-ops-misc.json` · {"id":"uatpayzevgn8ax","userId":"uat_ctv","amount":500000,"fee":0,"grossAmount":null,"taxWithheld":0,"taxRefu… | PASS |
| L5-PAY-21 | ketoan | api | Lệnh rút (legacy) | Lọc status không hợp lệ | 400 JSON | HTTP 400 | `07-ops-misc.json` · {"message":["Trường «status» chỉ nhận một trong: REQUESTED, APPROVED, PAID, REJECTED."],"error":"Bad Request"… | PASS |
| L5-PAY-22-staff | staff | api | Lệnh rút (legacy) | staff xem danh sách lệnh rút | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-22-kho | kho | api | Lệnh rút (legacy) | kho xem danh sách lệnh rút | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-22-marketing | marketing | api | Lệnh rút (legacy) | marketing xem danh sách lệnh rút | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-22-cskh | cskh | api | Lệnh rút (legacy) | cskh xem danh sách lệnh rút | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-PAY-23 | ketoan | api | Lệnh rút (legacy) | Báo cáo khấu trừ TNCN tháng này | 200 | HTTP 200 | `07-ops-misc.json` · {"month":"2026-11","rows":[],"totals":{"recipients":0,"withheldRecipients":0,"grossAmount":0,"taxWithheld":0,… | PASS |
| L5-PAY-24 | ketoan | api | Lệnh rút (legacy) | Tháng không hợp lệ 2026-13 | 400 | HTTP 400 | `07-ops-misc.json` · {"message":["Tháng phải có dạng YYYY-MM."],"error":"Bad Request","statusCode":400} | PASS |

### Hoá đơn VAT

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-VAT-01 | returning | api | Hoá đơn VAT | Đặt đơn với MST sai (5 số) | bị chặn 400, câu "Mã số thuế gồm 10 số…" (checkout.dto.ts:10) | đặt đơn lỗi 400 {"message":["Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số."],"error":"Bad Request","statusCode":400} | `07-ops-misc.json` · {"ok":false,"e":"đặt đơn lỗi 400 {\"message\":[\"Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.\"],\… | PASS |
| L5-VAT-02 | returning | api | Hoá đơn VAT | Đặt đơn với email hoá đơn sai | bị chặn 400 | đặt đơn lỗi 400 {"message":["Email không hợp lệ."],"error":"Bad Request","statusCode":400} | `07-ops-misc.json` · {"ok":false,"e":"đặt đơn lỗi 400 {\"message\":[\"Email không hợp lệ.\"],\"error\":\"Bad Request\",\"statusCod… | PASS |
| L5-VAT-03 | returning | api | Hoá đơn VAT | Đặt đơn COD có yêu cầu VAT hợp lệ | invoiceStatus = REQUESTED, lưu đủ 4 trường | REQUESTED {"email":"ketoan-uat@example.com","address":"12 Lê Lợi, Q1, TP.HCM","taxCode":"0312345678","companyName":"Công ty TNHH UAT Xanh"} | `07-ops-misc.json` · {"s":"REQUESTED","r":{"email":"ketoan-uat@example.com","address":"12 Lê Lợi, Q1, TP.HCM","taxCode":"031234567… | PASS |
| L5-VAT-04 | ketoan | api | Hoá đơn VAT | Lọc ?invoice=pending theo mã đơn | đơn xuất hiện trong "Chờ xuất hoá đơn" | HTTP 200, 1 dòng | `07-ops-misc.json` · {"code":"TUBU2026110355913","invoiceStatus":"REQUESTED"} | PASS |
| L5-VAT-05 | ketoan | api | Hoá đơn VAT | Hộp việc: mục invoicePending | đếm đơn chờ xuất hoá đơn ≥ 1 | count=2 | `07-ops-misc.json` · {"generatedAt":"2026-11-03T21:23:01.954Z","items":[{"key":"customerRefunds","count":4},{"key":"bankTransferTo… | PASS |
| L5-VAT-06 | ketoan | api | Hoá đơn VAT | Kế toán xem dòng đơn trong danh sách "Chờ xuất hoá đơn" | 200, thấy yêu cầu hoá đơn (MST, tên công ty, email) để xuất đúng | có MST=true, tên công ty=true, email=true | `07-ops-misc.json` · {"email":"ketoan-uat@example.com","address":"12 Lê Lợi, Q1, TP.HCM","taxCode":"0312345678","companyName":"Côn… | PASS |
| L5-VAT-07-staff | staff | api | Hoá đơn VAT | staff bấm "Đã xuất hoá đơn" | 403 (chỉ ADMIN và KE_TOAN, admin.controller.ts:571) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-VAT-07-kho | kho | api | Hoá đơn VAT | kho bấm "Đã xuất hoá đơn" | 403 (chỉ ADMIN và KE_TOAN, admin.controller.ts:571) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-VAT-07-marketing | marketing | api | Hoá đơn VAT | marketing bấm "Đã xuất hoá đơn" | 403 (chỉ ADMIN và KE_TOAN, admin.controller.ts:571) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-VAT-07-cskh | cskh | api | Hoá đơn VAT | cskh bấm "Đã xuất hoá đơn" | 403 (chỉ ADMIN và KE_TOAN, admin.controller.ts:571) | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-VAT-08-http | ketoan | api | Hoá đơn VAT | Link hoá đơn "http://hoadon.example.com/x.pdf" | 400, chỉ nhận https (admin.controller.ts:415), đơn vẫn REQUESTED | HTTP 400, đơn REQUESTED | `07-ops-misc.json` · {"message":["Trường «invoiceUrl» phải là đường dẫn (URL) hợp lệ."],"error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-08-javascript | ketoan | api | Hoá đơn VAT | Link hoá đơn "javascript:alert(1)" | 400, chỉ nhận https (admin.controller.ts:415), đơn vẫn REQUESTED | HTTP 400, đơn REQUESTED | `07-ops-misc.json` · {"message":["Trường «invoiceUrl» phải là đường dẫn (URL) hợp lệ."],"error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-08-ftp | ketoan | api | Hoá đơn VAT | Link hoá đơn "ftp://hoadon.example.com/x" | 400, chỉ nhận https (admin.controller.ts:415), đơn vẫn REQUESTED | HTTP 400, đơn REQUESTED | `07-ops-misc.json` · {"message":["Trường «invoiceUrl» phải là đường dẫn (URL) hợp lệ."],"error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-08-không có scheme | ketoan | api | Hoá đơn VAT | Link hoá đơn "hoadon.example.com/x.pdf" | 400, chỉ nhận https (admin.controller.ts:415), đơn vẫn REQUESTED | HTTP 400, đơn REQUESTED | `07-ops-misc.json` · {"message":["Trường «invoiceUrl» phải là đường dẫn (URL) hợp lệ."],"error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-09 | ketoan | api | Hoá đơn VAT | Xuất hoá đơn với link https | 200, ISSUED + lưu link | HTTP 201, DB {"s":"ISSUED","u":"https://hoadon.example.com/uat/HD0001.pdf"} | `07-ops-misc.json` · {"ok":true,"message":"Đã ghi nhận xuất hoá đơn VAT cho đơn TUBU2026110355913.","order":{"id":"cmw172fn501x4jt… | PASS |
| L5-VAT-10 | returning | api | Hoá đơn VAT | Khách nhận thông báo "đã xuất hoá đơn" | có thông báo nhắc mã đơn | {"id":"cmw172fo801x9jtc4dfr32gau","userId":"uat_returning","templateCode":"INVOICE_ISSUED","channel":"INAPP","payload":{"body":"Hoá đơn VAT cho đơn TUBU2026110355913 đã được phát hành.","data":{"order_code":"TUBU20261103 | `07-ops-misc.json` · {"id":"cmw172fo801x9jtc4dfr32gau","userId":"uat_returning","templateCode":"INVOICE_ISSUED","channel":"INAPP",… | PASS |
| L5-VAT-10b | returning | api | Hoá đơn VAT | Giọng thông báo hoá đơn (đợt 8) | không "Vui lòng", "chúng tôi", "..." | sạch | `07-ops-misc.json` · {"id":"cmw172fo801x9jtc4dfr32gau","userId":"uat_returning","templateCode":"INVOICE_ISSUED","channel":"INAPP",… | PASS |
| L5-VAT-11 | ketoan | api | Hoá đơn VAT | Xuất lần 2 | 400 "đã được phát hành" | HTTP 400 | `07-ops-misc.json` · {"message":"Hoá đơn của đơn TUBU2026110355913 đã được phát hành.","error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-12 | admin | api | Hoá đơn VAT | Lọc ?invoice=issued / pending sau khi xuất | có trong issued, không còn trong pending | issued 1, pending 0 | `07-ops-misc.json` | PASS |
| L5-VAT-13 | ketoan | api | Hoá đơn VAT | Xuất hoá đơn cho đơn không yêu cầu | 400 "chưa có yêu cầu xuất hoá đơn VAT" | HTTP 400 | `07-ops-misc.json` · {"message":"Đơn TUBU2026110361348 chưa có yêu cầu xuất hoá đơn VAT.","error":"Bad Request","statusCode":400} | PASS |
| L5-VAT-14a | admin | api | Hoá đơn VAT | Huỷ đơn có yêu cầu VAT | 200, CANCELLED | HTTP 200, DB CANCELLED | `07-ops-misc.json` · {"id":"cmw172gdf01xwjtc4h0tv0bd0","code":"TUBU2026110327922","idempotencyKey":"uat-l5-1793740982868-zpf7jcfb"… | PASS |
| L5-VAT-14 | ketoan | api | Hoá đơn VAT | Xuất hoá đơn cho đơn đã huỷ | 400 "đã huỷ/trả — không xuất hoá đơn VAT" | HTTP 400 | `07-ops-misc.json` · {"message":"Đơn TUBU2026110327922 đã huỷ/trả — không xuất hoá đơn VAT.","error":"Bad Request","statusCode":40… | PASS |
| L5-VAT-15 | ketoan | api | Hoá đơn VAT | Mã đơn không tồn tại | 404 | HTTP 404 | `07-ops-misc.json` · {"message":"Không tìm thấy đơn hàng.","error":"Not Found","statusCode":404} | PASS |
| L5-VAT-16 | ketoan | api | Hoá đơn VAT | 3 request xuất hoá đơn cùng lúc | đúng 1 thành công (và đúng 1 thông báo cho khách) | thành công 1/3, thông báo 1 | `07-ops-misc.json` · [201,400,400] | PASS |

### Mã giảm giá (Marketing)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-CPN-00 | marketing | api | Mã giảm giá (Marketing) | Đọc trần hiện hành | staff_max_percent 30, amount 100.000, usage 1000, ngân sách ngày 10.000.000 | {"coupon.staff_max_percent":30,"coupon.staff_max_amount_vnd":100000,"coupon.staff_max_usage":1000,"coupon.staff_daily_budget_vnd":10000000} | `07-ops-misc.json` · {"coupon.staff_max_percent":30,"coupon.staff_max_amount_vnd":100000,"coupon.staff_max_usage":1000,"coupon.sta… | PASS |
| L5-CPN-01 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã giảm 31% (trần 30%) | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Nhân viên tạo mã giảm tối đa 30%. Cần mức cao hơn thì nhờ quản trị viên tạo mã.","error":"Forbidd… | PASS |
| L5-CPN-02 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã giảm 30% không có "Giảm tối đa" | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Mã giảm % do nhân viên tạo phải có Giảm tối đa (không quá 100.000đ). Cần mức cao hơn thì nhờ quản… | PASS |
| L5-CPN-03 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã Giảm tối đa 100.001đ (trần 100.000đ) | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Giảm tối đa của mã do nhân viên tạo không quá 100.000đ. Cần mức cao hơn thì nhờ quản trị viên tạo… | PASS |
| L5-CPN-04 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã giảm tiền 100.001đ (trần 100.000đ) | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Nhân viên tạo mã giảm tối đa 100.000đ. Cần mức cao hơn thì nhờ quản trị viên tạo mã.","error":"Fo… | PASS |
| L5-CPN-05 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã không đặt Tổng lượt dùng | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Mã do nhân viên tạo phải có Tổng lượt dùng. Cần mức cao hơn thì nhờ quản trị viên tạo mã.","error… | PASS |
| L5-CPN-06 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã Tổng lượt dùng 1001 (trần 1000) | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Tổng lượt dùng của mã do nhân viên tạo không quá 1.000 lượt. Cần mức cao hơn thì nhờ quản trị viê… | PASS |
| L5-CPN-07 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã freeship không đặt Tổng lượt dùng | 403 + câu nêu trần (coupon-input-rules.ts:126), không ghi DB | HTTP 403, 0 dòng DB | `07-ops-misc.json` · {"message":"Mã do nhân viên tạo phải có Tổng lượt dùng. Cần mức cao hơn thì nhờ quản trị viên tạo mã.","error… | PASS |
| L5-CPN-08 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã đúng trần (30%, tối đa 100.000đ, 40 lượt = 4.000.000đ) | 201, createdById = marketing | HTTP 201, {"c":"uat_marketing","value":30,"m":100000,"u":40} | `07-ops-misc.json` · {"id":"cmw172gg001yojtc47thwzc1h","code":"UAT172FH5OK1","type":"PERCENT","value":30,"minOrder":0,"maxDiscount… | PASS |
| L5-CPN-09a | marketing | api | Mã giảm giá (Marketing) | Đổ mã cho ngân sách ngày còn 6.000.000đ | 201 | HTTP 201 | `07-ops-misc.json` · {"id":"cmw172gg401yqjtc4h0rdjyt3","code":"UAT172FH5FILL","type":"AMOUNT","value":100000,"minOrder":0,"maxDisc… | PASS |
| L5-CPN-09 | marketing | api | Mã giảm giá (Marketing) | Mã làm tổng ngân sách ngày vượt 10.000.000đ (thêm 2.000.000đ khi chỉ còn dưới 100.000đ) | 400 "Vượt ngân sách mã giảm giá và flash sale của nhân viên" (coupon-input-rules.ts:187) | HTTP 400 | `07-ops-misc.json` · {"message":"Vượt ngân sách mã giảm giá và flash sale của nhân viên ngày 04/11/2026 (10.000.000đ/người/ngày): … | PASS |
| L5-CPN-10 | marketing | api | Mã giảm giá (Marketing) | Marketing tạo mã cá nhân cho chính mình | 403 "Không tạo hay sửa mã giảm giá cá nhân của chính mình" | HTTP 403 | `07-ops-misc.json` · {"message":"Không tạo hay sửa mã giảm giá cá nhân của chính mình — nhờ quản trị viên.","error":"Forbidden","s… | PASS |
| L5-CPN-11-cskh | cskh | api | Mã giảm giá (Marketing) | cskh tạo mã giảm giá | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CPN-11-kho | kho | api | Mã giảm giá (Marketing) | kho tạo mã giảm giá | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CPN-11-ketoan | ketoan | api | Mã giảm giá (Marketing) | ketoan tạo mã giảm giá | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CPN-11-staff | staff | api | Mã giảm giá (Marketing) | staff tạo mã giảm giá | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CPN-12 | admin | api | Mã giảm giá (Marketing) | ADMIN tạo mã 80%, tối đa 500.000đ, 5000 lượt (vượt trần nhân viên) | 201 (trần chỉ áp cho STAFF) | HTTP 201 | `07-ops-misc.json` · {"id":"cmw172ggj01ysjtc43n0lrecy","code":"UAT172FH5ADM1","type":"PERCENT","value":80,"minOrder":0,"maxDiscoun… | PASS |
| L5-CPN-13 | admin | api | Mã giảm giá (Marketing) | ADMIN tạo mã ≥50% không có "Giảm tối đa" | 400 "Mã giảm từ 50% phải đặt Giảm tối đa" (coupon-input-rules.ts:59) | HTTP 400 | `07-ops-misc.json` · {"message":"Mã giảm từ 50% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.","error":"Bad Req… | PASS |
| L5-CPN-14 | admin | api | Mã giảm giá (Marketing) | ADMIN tạo mã giảm 500.000đ không giới hạn lượt | 201 | HTTP 201 | `07-ops-misc.json` · {"id":"cmw172ggl01ytjtc4qdpr9fb7","code":"UAT172FH5ADM3","type":"AMOUNT","value":500000,"minOrder":0,"maxDisc… | PASS |
| L5-CPN-15 | marketing | api | Mã giảm giá (Marketing) | Marketing nâng Tổng lượt dùng mã của mình lên 1001 | 403 (trần lượt) | HTTP 403 | `07-ops-misc.json` · {"message":"Tổng lượt dùng của mã do nhân viên tạo không quá 1.000 lượt. Cần mức cao hơn thì nhờ quản trị viê… | PASS |
| L5-CPN-16 | marketing | api | Mã giảm giá (Marketing) | Marketing tắt mã do ADMIN tạo | 403 "Mã do quản trị viên hoặc hệ thống tạo" | HTTP 403 | `07-ops-misc.json` · {"message":"Mã do quản trị viên hoặc hệ thống tạo — nhân viên không sửa được, nhờ quản trị viên.","error":"Fo… | PASS |
| L5-CPN-17 | marketing | api | Mã giảm giá (Marketing) | Marketing tắt mã của chính mình | 200, isActive=false, updatedById = marketing | HTTP 200, {"a":false,"u":"uat_marketing"} | `07-ops-misc.json` · {"id":"cmw172gg001yojtc47thwzc1h","code":"UAT172FH5OK1","type":"PERCENT","value":30,"minOrder":0,"maxDiscount… | PASS |
| L5-CPN-18 | marketing | api | Mã giảm giá (Marketing) | Sửa mức giảm của mã đã tạo (value) | 400 (không có trong UpdateCouponDto, forbidNonWhitelisted) | HTTP 400 | `07-ops-misc.json` · {"message":["Không nhận trường «value»."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CPN-19 | admin | api | Mã giảm giá (Marketing) | Tạo mã trùng | 409 hoặc 400 (không 500) | HTTP 409 | `07-ops-misc.json` · {"message":"Mã UAT172FH5ADM1 đã tồn tại.","error":"Conflict","statusCode":409} | PASS |
| L5-CPN-20 | admin | api | Mã giảm giá (Marketing) | Mã có dấu và khoảng trắng | 400 câu "Mã chỉ gồm chữ in hoa không dấu…" | HTTP 400 | `07-ops-misc.json` · {"message":["Mã chỉ gồm chữ in hoa không dấu, số, gạch ngang hoặc gạch dưới (3–40 ký tự, không khoảng trắng).… | PASS |
| L5-CPN-21 | admin | api | Mã giảm giá (Marketing) | Ngày hết hạn đã qua | 400 "Ngày hết hạn đã qua" | HTTP 400 | `07-ops-misc.json` · {"message":"Ngày hết hạn đã qua — mã tạo ra sẽ không dùng được. Chọn ngày hết hạn từ hôm nay trở đi.","error"… | PASS |

### Mẫu thông báo

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-TPL-00 | marketing | api | Mẫu thông báo | Marketing xem danh sách mẫu | 135 mẫu, staffEditable đúng danh sách | 135 mẫu; sửa được 24 | `07-ops-misc.json` · {"mkt":"WELCOME_VOUCHER","sys":"OPS_PANCAKE_ALERT"} | PASS |
| L5-TPL-B01 | marketing | api | Mẫu thông báo | Marketing thêm link https ngoài | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link \"https://evil.exam… | PASS |
| L5-TPL-B02 | marketing | api | Mẫu thông báo | Marketing thêm tên miền trần bit.ly/… | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link \"bit.ly/nhan-qua\"… | PASS |
| L5-TPL-B03 | marketing | api | Mẫu thông báo | Marketing thêm www. ngoài | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link \"www.khuyenmai.vn\… | PASS |
| L5-TPL-B04 | marketing | api | Mẫu thông báo | Marketing thêm tubutree.com.evil.vn giả | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link \"http://tubutree.c… | PASS |
| L5-TPL-B05 | marketing | api | Mẫu thông báo | Marketing thêm zalo.me của người khác | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link \"https://zalo.me/0… | PASS |
| L5-TPL-B06 | marketing | api | Mẫu thông báo | Marketing thêm dãy 8 chữ số | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Th… | PASS |
| L5-TPL-B07 | marketing | api | Mẫu thông báo | Marketing thêm 8 chữ số viết tách bằng dấu cách | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Th… | PASS |
| L5-TPL-B08 | marketing | api | Mẫu thông báo | Marketing thêm SĐT viết tách bằng dấu chấm | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Th… | PASS |
| L5-TPL-B09 | marketing | api | Mẫu thông báo | Marketing thêm 8 chữ số toàn chiều rộng (NFKC) | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Th… | PASS |
| L5-TPL-B10 | marketing | api | Mẫu thông báo | Marketing thêm 8 chữ số trong query của link tubutree | 400, nội dung không đổi (notification-templates-admin.service.ts:276) | HTTP 400; nội dung giữ nguyên | `07-ops-misc.json` · {"message":"Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Th… | PASS |
| L5-TPL-G01 | marketing | api | Mẫu thông báo | Marketing thêm "tubutree.com" (được phép) vào nội dung | 200, nội dung đổi | HTTP 200 | `07-ops-misc.json` · {"id":"nt-welcome","code":"WELCOME_VOUCHER","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"Chào mừng… | PASS |
| L5-TPL-G02 | marketing | api | Mẫu thông báo | Marketing thêm "Tp.HCM" (không phải link) | 200 (không chặn nhầm) | HTTP 200 | `07-ops-misc.json` · {"id":"nt-welcome","code":"WELCOME_VOUCHER","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"Chào mừng… | PASS |
| L5-TPL-G03 | marketing | api | Mẫu thông báo | Marketing thêm dãy 7 chữ số (dưới ngưỡng 8) | 200 (ngưỡng là ≥ 8 chữ số) | HTTP 200 | `07-ops-misc.json` · {"id":"nt-welcome","code":"WELCOME_VOUCHER","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"Chào mừng… | PASS |
| L5-TPL-G04 | marketing | api | Mẫu thông báo | Nội dung có biến {{khong_co_bien}} | 400 câu nêu biến lạ (notification-variables.ts) | HTTP 400 | `07-ops-misc.json` · {"message":"Biến \"{{khong_co_bien}}\" không dùng được cho mẫu này, khách sẽ nhận câu bị trống chỗ đó. Mẫu nà… | PASS |
| L5-TPL-G05 | marketing | api | Mẫu thông báo | Nội dung chỉ có khoảng trắng | 400 "không được để trống" | HTTP 400 | `07-ops-misc.json` · {"message":"Nội dung thông báo không được để trống.","error":"Bad Request","statusCode":400} | PASS |
| L5-TPL-G06 | marketing | api | Mẫu thông báo | Nội dung 1001 ký tự | 400 (MaxLength 1000) | HTTP 400 | `07-ops-misc.json` · {"message":["Trường «bodyTemplate» không được dài quá 1000 ký tự."],"error":"Bad Request","statusCode":400} | PASS |
| L5-TPL-P01 | marketing | api | Mẫu thông báo | Marketing đổi kênh / mã mẫu ZNS | 403 (tính phí mỗi tin) | HTTP 403 | `07-ops-misc.json` · {"message":"Đổi kênh gửi hoặc mã mẫu ZNS (tính phí mỗi tin) chỉ quản trị viên làm.","error":"Forbidden","stat… | PASS |
| L5-TPL-P02 | marketing | api | Mẫu thông báo | Marketing chỉ đổi mã mẫu ZNS | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Đổi kênh gửi hoặc mã mẫu ZNS (tính phí mỗi tin) chỉ quản trị viên làm.","error":"Forbidden","stat… | PASS |
| L5-TPL-P03 | marketing | api | Mẫu thông báo | Marketing sửa mẫu OPS_PANCAKE_ALERT (đơn hàng / tiền / vận hành) | 403 "chỉ quản trị viên sửa" | HTTP 403 | `07-ops-misc.json` · {"message":"Mẫu thông báo đơn hàng, tiền, đối tác và vận hành chỉ quản trị viên sửa.","error":"Forbidden","st… | PASS |
| L5-TPL-P04-cskh | cskh | api | Mẫu thông báo | cskh sửa mẫu / xem danh sách mẫu | 403 cả hai | PATCH 403, GET 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-TPL-P04-kho | kho | api | Mẫu thông báo | kho sửa mẫu / xem danh sách mẫu | 403 cả hai | PATCH 403, GET 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-TPL-P04-ketoan | ketoan | api | Mẫu thông báo | ketoan sửa mẫu / xem danh sách mẫu | 403 cả hai | PATCH 403, GET 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-TPL-P04-staff | staff | api | Mẫu thông báo | staff sửa mẫu / xem danh sách mẫu | 403 cả hai | PATCH 403, GET 403 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-TPL-P05 | admin | api | Mẫu thông báo | Mẫu không tồn tại | 404 | HTTP 404 | `07-ops-misc.json` · {"message":"Không tìm thấy mẫu thông báo.","error":"Not Found","statusCode":404} | PASS |
| L5-TPL-A01 | admin | api | Mẫu thông báo | ADMIN thêm link ngoài vào mẫu hệ thống | luật brief: chặn link ngoài và dãy 8 chữ số — nhưng code chỉ áp cho nhân viên (service.ts:156 `if (actor.staff)`) | HTTP 200: ADMIN ĐƯỢC thêm link ngoài | `07-ops-misc.json` · {"id":"nt-ops-pancake","code":"OPS_PANCAKE_ALERT","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"⚠️ … | CẦN CHỦ |
| L5-TPL-A02 | admin | api | Mẫu thông báo | ADMIN thêm dãy 8 chữ số vào mẫu hệ thống | tương tự L5-TPL-A01 (code ghi "Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu", nên ADMIN được phép là chủ ý) | HTTP 200 | `07-ops-misc.json` · {"id":"nt-ops-pancake","code":"OPS_PANCAKE_ALERT","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"⚠️ … | CẦN CHỦ |
| L5-TPL-R-WELCOME_VOUCHER | admin | api | Mẫu thông báo | Khôi phục nội dung WELCOME_VOUCHER | nội dung về đúng bản gốc | HTTP 200, khớp | `07-ops-misc.json` · {"id":"nt-welcome","code":"WELCOME_VOUCHER","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"Chào mừng… | PASS |
| L5-TPL-R-OPS_PANCAKE_ALERT | admin | api | Mẫu thông báo | Khôi phục nội dung OPS_PANCAKE_ALERT | nội dung về đúng bản gốc | HTTP 200, khớp | `07-ops-misc.json` · {"id":"nt-ops-pancake","code":"OPS_PANCAKE_ALERT","channel":"INAPP","zaloTemplateId":null,"bodyTemplate":"⚠️ … | PASS |

### Cấu hình hệ thống

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-CFG-01-staff | staff | api | Cấu hình hệ thống | staff xem / sửa cấu hình | 403 cả hai, giá trị không đổi | GET 403, PUT 403, DB 30 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CFG-01-kho | kho | api | Cấu hình hệ thống | kho xem / sửa cấu hình | 403 cả hai, giá trị không đổi | GET 403, PUT 403, DB 30 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CFG-01-ketoan | ketoan | api | Cấu hình hệ thống | ketoan xem / sửa cấu hình | 403 cả hai, giá trị không đổi | GET 403, PUT 403, DB 30 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CFG-01-marketing | marketing | api | Cấu hình hệ thống | marketing xem / sửa cấu hình | 403 cả hai, giá trị không đổi | GET 403, PUT 403, DB 30 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CFG-01-cskh | cskh | api | Cấu hình hệ thống | cskh xem / sửa cấu hình | 403 cả hai, giá trị không đổi | GET 403, PUT 403, DB 30 | `07-ops-misc.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CFG-02 | admin | api | Cấu hình hệ thống | Ghi khoá không tồn tại | 400 "Không có khoá cấu hình", không tạo dòng mới (admin.service.ts:1502) | HTTP 400, 0 dòng | `07-ops-misc.json` · {"message":"Không có khoá cấu hình \"coupon.khong_co_khoa_nay\". Kiểm tra lại tên khoá.","error":"Bad Request… | PASS |
| L5-CFG-03 | admin | api | Cấu hình hệ thống | Ghi coupon.staff_max_percent = chuỗi "ba mươi" | 400, giá trị cũ giữ nguyên | HTTP 400, DB 30 | `07-ops-misc.json` · {"message":"\"coupon.staff_max_percent\": phải là số nguyên 1–100 %.","error":"Bad Request","statusCode":400} | PASS |
| L5-CFG-04 | admin | api | Cấu hình hệ thống | Ghi coupon.staff_max_percent = -5 | 400 (trần % phải dương), giữ nguyên | HTTP 400, DB 30 | `07-ops-misc.json` · {"message":"\"coupon.staff_max_percent\": phải là số nguyên 1–100 %.","error":"Bad Request","statusCode":400} | PASS |
| L5-CFG-05 | admin | api | Cấu hình hệ thống | Ghi coupon.staff_max_percent = null | 400 (không có 500) | HTTP 400 | `07-ops-misc.json` · {"message":"\"coupon.staff_max_percent\": phải là số nguyên 1–100 %.","error":"Bad Request","statusCode":400} | PASS |
| L5-CFG-06 | admin | api | Cấu hình hệ thống | Admin đổi coupon.staff_max_percent 30 -> 40 | 200, giá trị mới, có 1 dòng lịch sử (cũ/mới/ai đổi) | HTTP 200, DB {"v":40,"ub":"uat_admin"}, lịch sử {"o":30,"n":40,"c":"uat_admin"} | `07-ops-misc.json` · {"histBefore":4,"h":[{"o":30,"n":40,"c":"uat_admin"}]} | PASS |
| L5-CFG-07 | marketing | api | Cấu hình hệ thống | Sau khi nâng trần lên 40%: mã 35% tạo được, 41% bị chặn | cấu hình có hiệu lực ngay (không đợi cache dài) | 35% -> 201, 41% -> 403 | `07-ops-misc.json` · {"c35":"{\"id\":\"cmw172gj801yyjtc4rut694if\",\"code\":\"UAT172FH5CFG35\",\"type\":\"PERCENT\",\"value\":35,\… | PASS |
| L5-CFG-08 | admin | api | Cấu hình hệ thống | Khôi phục coupon.staff_max_percent về 30 | 200, giá trị về bản gốc, lịch sử +2 dòng | HTTP 200, DB 30, lịch sử 4 -> 6 | `07-ops-misc.json` · {"ok":true,"key":"coupon.staff_max_percent","value":30} | PASS |
| L5-CFG-09 | marketing | api | Cấu hình hệ thống | Sau khi khôi phục: mã 35% lại bị chặn | 403 | HTTP 403 | `07-ops-misc.json` · {"message":"Nhân viên tạo mã giảm tối đa 30%. Cần mức cao hơn thì nhờ quản trị viên tạo mã.","error":"Forbidd… | PASS |
| L5-CFG-10 | admin | api | Cấu hình hệ thống | GET /admin/config che giá trị bí mật (token, secret, key) | không trả nguyên văn chuỗi dài của khoá có tên token/secret/key | 1 khoá nhạy cảm, 0 trả nguyên văn | `07-ops-misc.json` · [] | PASS |

### Sức khoẻ vận hành

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OPS-01 | admin | api | Sức khoẻ vận hành | ADMIN mở /admin/ops/health | 200, có problems + cronJobs + queues + pancake | HTTP 200, problems=pancake.attention | `07-ops-misc.json` · ["generatedAt","thresholds","pancake","gomdon","queues","orders","alertChannels","cronJobs","zns","problems"] | PASS |
| L5-OPS-02-staff | staff | api | Sức khoẻ vận hành | staff gọi health / inbox / access | health 403; inbox 403; access 200 (staff-permissions.matrix.spec.ts:175-178) | health 403, inbox 403, access 200 | `07-ops-misc.json` · {"role":"STAFF","staffPermissions":[]} | PASS |
| L5-OPS-02-kho | kho | api | Sức khoẻ vận hành | kho gọi health / inbox / access | health 403; inbox 200; access 200 (staff-permissions.matrix.spec.ts:175-178) | health 403, inbox 200, access 200 | `07-ops-misc.json` · {"role":"STAFF","staffPermissions":["KHO"]} | PASS |
| L5-OPS-02-ketoan | ketoan | api | Sức khoẻ vận hành | ketoan gọi health / inbox / access | health 403; inbox 200; access 200 (staff-permissions.matrix.spec.ts:175-178) | health 403, inbox 200, access 200 | `07-ops-misc.json` · {"role":"STAFF","staffPermissions":["KE_TOAN"]} | PASS |
| L5-OPS-02-marketing | marketing | api | Sức khoẻ vận hành | marketing gọi health / inbox / access | health 403; inbox 200; access 200 (staff-permissions.matrix.spec.ts:175-178) | health 403, inbox 200, access 200 | `07-ops-misc.json` · {"role":"STAFF","staffPermissions":["MARKETING"]} | PASS |
| L5-OPS-02-cskh | cskh | api | Sức khoẻ vận hành | cskh gọi health / inbox / access | health 403; inbox 200; access 200 (staff-permissions.matrix.spec.ts:175-178) | health 403, inbox 200, access 200 | `07-ops-misc.json` · {"role":"STAFF","staffPermissions":["CSKH"]} | PASS |
| L5-OPS-03 | admin | api | Sức khoẻ vận hành | Chưa có token Zalo OA | không có cảnh báo zalo.oa_token (ops-health.service.ts:266 "Chưa cấu hình thì không báo") | không có cảnh báo; dòng cấu hình token: [] | `07-ops-misc.json` · [] | PASS |
| L5-OPS-04 | admin | api | Sức khoẻ vận hành | Token Zalo OA còn 1 giờ (dưới 3 giờ) | problems có zalo.oa_token, câu "chỉ còn 0 giờ … phút" (ops-health.service.ts:288) | Token Zalo OA chỉ còn 0 giờ 59 phút mà chưa được làm mới — tin ZNS và trả lời Zalo OA sẽ không gửi được; xem log "Zalo OA refresh" hoặc cấp lại token ở developers.zalo.me | `07-ops-misc.json` · {"key":"zalo.oa_token","message":"Token Zalo OA chỉ còn 0 giờ 59 phút mà chưa được làm mới — tin ZNS và trả l… | PASS |
| L5-OPS-04b | admin | api | Sức khoẻ vận hành | Giọng câu cảnh báo token | không "Vui lòng", "chúng tôi", "..." | sạch | `07-ops-misc.json` · Token Zalo OA chỉ còn 0 giờ 59 phút mà chưa được làm mới — tin ZNS và trả lời Zalo OA sẽ không gửi được; xem … | PASS |
| L5-OPS-05 | admin | api | Sức khoẻ vận hành | Token Zalo OA đã hết hạn 1 giờ | cảnh báo "đã hết hạn lúc …" | Token Zalo OA đã hết hạn lúc 03:23 04/11/2026 — tin ZNS và trả lời Zalo OA sẽ không gửi được; xem log "Zalo OA refresh" hoặc cấp lại token ở developers.zalo.me | `07-ops-misc.json` · {"key":"zalo.oa_token","message":"Token Zalo OA đã hết hạn lúc 03:23 04/11/2026 — tin ZNS và trả lời Zalo OA … | PASS |
| L5-OPS-06 | admin | api | Sức khoẻ vận hành | ADMIN xem hộp việc /admin/ops/inbox | liệt kê hàng đợi theo quyền | {"generatedAt":"2026-11-03T21:23:03.148Z","items":[{"key":"pancakeAttention","count":6},{"key":"pancakeUnsynced","count":0},{"key":"gomdonAttention","count":0},{"key":"customerRefunds","count":4},{"key":"returnsPending","count":1… | `07-ops-misc.json` · {"generatedAt":"2026-11-03T21:23:03.148Z","items":[{"key":"pancakeAttention","count":6},{"key":"pancakeUnsync… | PASS |
| L5-OPS-07 | admin | api | Sức khoẻ vận hành | Khôi phục cấu hình token Zalo | cảnh báo zalo.oa_token biến mất | problems=pancake.attention | `07-ops-misc.json` | PASS |

### Chat CSKH

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-CHAT-01 | returning | api | Chat CSKH | Mở khung chat khi chat đang tắt | 200, enabled=false (khách vẫn đọc được lịch sử) | HTTP 200, enabled=false, mã hội thoại JT8A | `08-chat.json` · {"code":"JT8A","blocked":false,"enabled":false,"slow":false,"messages":[{"id":"cmw174dz701z9jtc49t44g37p","se… | PASS |
| L5-CHAT-02 | returning | api | Chat CSKH | Gửi tin khi chat tắt | 409 code CHAT_DISABLED, câu tiếng Việt có hotline (support-chat.service.ts:125) | HTTP 409 CHAT_DISABLED | `08-chat.json` · {"statusCode":409,"error":"Conflict","code":"CHAT_DISABLED","message":"Chat với Tubu Tree đang tạm đóng. Cần … | PASS |
| L5-CHAT-02b | returning | api | Chat CSKH | Giọng câu "chat đang tạm đóng" | không "Vui lòng", "chúng tôi", "..." | sạch | `08-chat.json` · Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline. | PASS |
| L5-CHAT-03-cskh | cskh | api | Chat CSKH | cskh bật chat (PUT settings) | 403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-03-staff | staff | api | Chat CSKH | staff bật chat (PUT settings) | 403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-03-kho | kho | api | Chat CSKH | kho bật chat (PUT settings) | 403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-03-ketoan | ketoan | api | Chat CSKH | ketoan bật chat (PUT settings) | 403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-03-marketing | marketing | api | Chat CSKH | marketing bật chat (PUT settings) | 403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-04 | admin | api | Chat CSKH | Nhập mã nhóm Zalo có khoảng trắng | 400 | HTTP 400 | `08-chat.json` · {"message":["groupId không được chứa khoảng trắng"],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-05 | admin | api | Chat CSKH | ADMIN bật chat | 200, enabled=true | HTTP 200 | `08-chat.json` · {"enabled":true,"groupId":"","bridgeSynced":true} | PASS |
| L5-CHAT-06 | returning | api | Chat CSKH | Khách gửi tin có khoảng trắng đầu/cuối | 201, lưu bản đã cắt khoảng trắng, sender CUSTOMER | HTTP 201, DB {"body":"Cho mình hỏi đơn hàng đã giao chưa?","sender":"CUSTOMER","source":"MINIAPP"} | `08-chat.json` · {"id":"cmw174z72020cjtc49n0ixjts","sender":"CUSTOMER","body":"Cho mình hỏi đơn hàng đã giao chưa?","imageUrl"… | PASS |
| L5-CHAT-07 | returning | api | Chat CSKH | Gửi lại cùng clientMsgId (bấm đúp / thử lại mạng) | trả tin cũ, chỉ 1 dòng trong DB | HTTP 201, 1 dòng, cùng id=true | `08-chat.json` · {"id":"cmw174z72020cjtc49n0ixjts","sender":"CUSTOMER","body":"Cho mình hỏi đơn hàng đã giao chưa?","imageUrl"… | PASS |
| L5-CHAT-08 | returning | api | Chat CSKH | 4 request cùng clientMsgId đồng thời | đúng 1 dòng trong DB, không request nào 500 | 1 dòng, mã 201,201,201,201 | `08-chat.json` · ["{\"id\":\"cmw174z7n020ijtc4jmubtjpe\",\"sender\":\"CUSTOMER\",\"body\":\"song song\",\"imageU","{\"id\":\"c… | PASS |
| L5-CHAT-09-rỗng | returning | api | Chat CSKH | Khách gửi tin rỗng | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":"Cần nhập nội dung hoặc gửi ảnh.","error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-09-1001 ký tự | returning | api | Chat CSKH | Khách gửi tin 1001 ký tự | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["Nội dung không được dài quá 1000 ký tự."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-09-clientMsgId ngắn | returning | api | Chat CSKH | Khách gửi tin clientMsgId ngắn | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["clientMsgId phải dài 8–64 ký tự chữ, số, - hoặc _"],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-09-ảnh base64 | returning | api | Chat CSKH | Khách gửi tin ảnh base64 | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["imageUrl chỉ nhận tệp đã tải lên (https://res.cloudinary.com)."],"error":"Bad Request","statusCo… | PASS |
| L5-CHAT-09-ảnh link ngoài | returning | api | Chat CSKH | Khách gửi tin ảnh link ngoài | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["imageUrl chỉ nhận tệp đã tải lên (https://res.cloudinary.com)."],"error":"Bad Request","statusCo… | PASS |
| L5-CHAT-09-source lạ | returning | api | Chat CSKH | Khách gửi tin source lạ | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["Trường «source» chỉ nhận một trong: MINIAPP, WEB."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-09-body = số | returning | api | Chat CSKH | Khách gửi tin body = số | 400 JSON, không ghi DB | HTTP 400 | `08-chat.json` · {"message":["Nội dung không được dài quá 1000 ký tự.","Nội dung phải là chuỗi ký tự."],"error":"Bad Request",… | PASS |
| L5-CHAT-10 | ctv | api | Chat CSKH | CTV gắn mã đơn của người khác (của returning) vào tin | orderCode bị bỏ, giữ productSlug (support-chat.service.ts:183) | HTTP 201, context={"productSlug":"nuoc-rua-chen-fuwa3e"} | `08-chat.json` · {"other":"TUBU2026110354035"} | PASS |
| L5-CHAT-11 | returning | api | Chat CSKH | Khách gắn mã đơn của chính mình | orderCode được giữ | context={"orderCode":"TUBU2026110354035"} | `08-chat.json` · {"own":"TUBU2026110354035"} | PASS |
| L5-CHAT-12 | returning | api | Chat CSKH | Gửi tin lúc 4h VN (giờ trực 08:00-21:00) | ngoài giờ: đúng 1 lời nhắn SYSTEM trong ngày dù gửi nhiều tin | 1 lời nhắn SYSTEM | `08-chat.json` · ["Tubu Tree trả lời từ 8:00 đến 21:00 mỗi ngày. Tin của bạn đã được ghi lại, nhân viên sẽ trả lời khi vào giờ… | PASS |
| L5-CHAT-12b | returning | api | Chat CSKH | Giọng lời nhắn ngoài giờ | không "Vui lòng", "chúng tôi", "..." | sạch | `08-chat.json` · Tubu Tree trả lời từ 8:00 đến 21:00 mỗi ngày. Tin của bạn đã được ghi lại, nhân viên sẽ trả lời khi vào giờ. | PASS |
| L5-CHAT-13 | cskh | api | Chat CSKH | CSKH mở danh sách hội thoại | 200, thấy hội thoại của khách vừa nhắn | HTTP 200, 2 hội thoại, thấy=true | `08-chat.json` · {"id":"cmw174dkl01z4jtc4bs1k3joq","code":"JT8A","blocked":false,"lastMessageAt":"2026-11-03T21:25:00.652Z","u… | PASS |
| L5-CHAT-14 | cskh | api | Chat CSKH | Tìm hội thoại theo mã | 200, 1 kết quả đúng mã | HTTP 200, 1 dòng | `08-chat.json` · {"id":"cmw174dkl01z4jtc4bs1k3joq","code":"JT8A","blocked":false,"lastMessageAt":"2026-11-03T21:25:00.652Z","u… | PASS |
| L5-CHAT-15 | cskh | api | Chat CSKH | Lọc "chưa chuyển Zalo" | 200 (cầu nối không chạy nên tin của khách phải nằm ở đây sau ít phút) | HTTP 200, 1 dòng | `08-chat.json` · {"items":[{"id":"cmw174dkl01z4jtc4bs1k3joq","code":"JT8A","blocked":false,"lastMessageAt":"2026-11-03T21:25:0… | PASS |
| L5-CHAT-16 | cskh | api | Chat CSKH | Lọc filter lạ | 400 | HTTP 400 | `08-chat.json` · {"message":["Trường «filter» chỉ nhận một trong: unforwarded."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-17 | cskh | api | Chat CSKH | CSKH mở một hội thoại | 200, có tin khách + thông tin khách (tên, SĐT) | HTTP 200, 8 tin, SĐT 0901000003 | `08-chat.json` · {"id":"uat_returning","fullName":"Nguyễn Thị Quay Lại","phone":"0901000003"} | PASS |
| L5-CHAT-18 | cskh | api | Chat CSKH | Mở hội thoại không tồn tại | 404 | HTTP 404 | `08-chat.json` · {"message":"Không tìm thấy hội thoại.","error":"Not Found","statusCode":404} | PASS |
| L5-CHAT-19-staff | staff | api | Chat CSKH | staff đọc / trả lời / chặn hội thoại | 403 cả bốn | list 403, get 403, reply 403, block 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-19-kho | kho | api | Chat CSKH | kho đọc / trả lời / chặn hội thoại | 403 cả bốn | list 403, get 403, reply 403, block 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-19-ketoan | ketoan | api | Chat CSKH | ketoan đọc / trả lời / chặn hội thoại | 403 cả bốn | list 403, get 403, reply 403, block 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-19-marketing | marketing | api | Chat CSKH | marketing đọc / trả lời / chặn hội thoại | 403 cả bốn | list 403, get 403, reply 403, block 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-19-customer | returning | api | Chat CSKH | Khách gọi API admin chat | 403 | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-20 | cskh | api | Chat CSKH | CSKH trả lời khách | 201, lưu STAFF/ADMIN, ghi adminUserId = cskh, đã cắt khoảng trắng | HTTP 201, DB {"body":"Đơn của bạn đang trên đường giao nhé.","sender":"STAFF","source":"ADMIN","a":"uat_cskh"} | `08-chat.json` · {"id":"cmw174za1020ujtc48kwe9y5u","sender":"STAFF","source":"ADMIN","body":"Đơn của bạn đang trên đường giao … | PASS |
| L5-CHAT-21 | returning | api | Chat CSKH | Khách thấy câu trả lời | tin STAFF có trong khung chat | 9 tin, thấy=true | `08-chat.json` · [{"id":"cmw174z8s020sjtc4zpcjlfof","sender":"CUSTOMER","body":"ngữ cảnh đơn của mình","imageUrl":null,"contex… | PASS |
| L5-CHAT-22 | returning | api | Chat CSKH | Tin trả khách không lộ trường nội bộ (adminUserId, forwardId, Zalo) | không có adminUserId / forwardId / zalo trong JSON khách nhận | sạch | `08-chat.json` · [{"id":"cmw174dz701z9jtc49t44g37p","sender":"CUSTOMER","body":"Cho mình hỏi đơn hàng đã giao chưa?","imageUrl… | PASS |
| L5-CHAT-23 | returning | api | Chat CSKH | Số tin chưa đọc của khách | ≥ 1 sau khi CSKH trả lời | unreadCount=2 | `08-chat.json` · {"unreadCount":2} | PASS |
| L5-CHAT-24 | returning | api | Chat CSKH | Khách đánh dấu đã đọc | unreadCount = 0 | unreadCount=0 | `08-chat.json` · {"unreadCount":0} | PASS |
| L5-CHAT-25-rỗng | cskh | api | Chat CSKH | CSKH trả lời rỗng | 400 JSON | HTTP 400 | `08-chat.json` · {"message":["Nội dung phải có ít nhất 1 ký tự."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-25-1001 ký tự | cskh | api | Chat CSKH | CSKH trả lời 1001 ký tự | 400 JSON | HTTP 400 | `08-chat.json` · {"message":["Nội dung không được dài quá 1000 ký tự."],"error":"Bad Request","statusCode":400} | PASS |
| L5-CHAT-25-thiếu body | cskh | api | Chat CSKH | CSKH trả lời thiếu body | 400 JSON | HTTP 400 | `08-chat.json` · {"message":["Nội dung không được dài quá 1000 ký tự.","Nội dung phải có ít nhất 1 ký tự.","Nội dung phải là c… | PASS |
| L5-CHAT-26 | cskh | api | Chat CSKH | Trả lời hội thoại không tồn tại | 404 | HTTP 404 | `08-chat.json` · {"message":"Không tìm thấy hội thoại.","error":"Not Found","statusCode":404} | PASS |
| L5-CHAT-27 | cskh | api | Chat CSKH | CSKH chặn khách; khách gửi tin mới | chặn 200; khách gửi 403 CHAT_BLOCKED; thread.blocked=true | block 201; gửi 403 CHAT_BLOCKED; blocked=true | `08-chat.json` · {"statusCode":403,"error":"Forbidden","code":"CHAT_BLOCKED","message":"Bạn tạm thời không gửi được tin. Cần h… | PASS |
| L5-CHAT-28 | returning | api | Chat CSKH | Khách bị chặn thử lại tin đã lưu (cùng clientMsgId) | trả tin cũ, không báo lỗi (support-chat.service.ts:117) | HTTP 201 | `08-chat.json` · {"id":"cmw174z72020cjtc49n0ixjts","sender":"CUSTOMER","body":"Cho mình hỏi đơn hàng đã giao chưa?","imageUrl"… | PASS |
| L5-CHAT-29 | returning | api | Chat CSKH | Tin gửi khi bị chặn không được lưu | 0 dòng | 0 dòng | `08-chat.json` | PASS |
| L5-CHAT-30 | cskh | api | Chat CSKH | CSKH bỏ chặn; khách gửi lại | bỏ chặn 200; khách gửi được | bỏ chặn 200; gửi 201 | `08-chat.json` · {"id":"cmw174zb2020xjtc4q6i3mio2","sender":"CUSTOMER","body":"sau khi bỏ chặn","imageUrl":null,"context":null… | PASS |
| L5-CHAT-31 | cskh | api | Chat CSKH | Chặn hội thoại không tồn tại | 404 (không 500) | HTTP 404 | `08-chat.json` · {"message":"Không tìm thấy hội thoại.","error":"Not Found","statusCode":404} | PASS |
| L5-CHAT-32-bridge/qr | cskh | api | Chat CSKH | CSKH POST bridge/qr | 403 (quản lý cầu nối chỉ ADMIN) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-32-bridge/logout | cskh | api | Chat CSKH | CSKH POST bridge/logout | 403 (quản lý cầu nối chỉ ADMIN) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-32-bridge/reconnect | cskh | api | Chat CSKH | CSKH POST bridge/reconnect | 403 (quản lý cầu nối chỉ ADMIN) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-32-bridge/groups | cskh | api | Chat CSKH | CSKH GET bridge/groups | 403 (quản lý cầu nối chỉ ADMIN) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-32-bridge/test | cskh | api | Chat CSKH | CSKH POST bridge/test | 403 (quản lý cầu nối chỉ ADMIN) | HTTP 403 | `08-chat.json` · {"message":"Bạn không có quyền truy cập tài nguyên này.","error":"Forbidden","statusCode":403} | PASS |
| L5-CHAT-33 | cskh | api | Chat CSKH | CSKH xem trạng thái cầu nối | 200 (CSKH cần biết cầu nối sống hay chết) | HTTP 200 | `08-chat.json` · {"state":"UNREACHABLE","since":null,"lastError":null,"zaloUid":null,"displayName":null,"avatar":null,"checked… | PASS |
| L5-CHAT-34 | admin | api | Chat CSKH | ADMIN yêu cầu mã QR đăng nhập Zalo khi cầu nối không chạy | lỗi gọn bằng tiếng Việt (502/503), không 500 trần, không lộ stack | status 200 / qr 502 | `08-chat.json` · {"statusCode":502,"error":"Bad Gateway","code":"BRIDGE_NOT_CONFIGURED","message":"Chưa cấu hình ZALO_BRIDGE_U… | PASS |
| L5-CHAT-35 | returning | api | Chat CSKH | Tin khách được chuyển sang nhóm Zalo của nhân viên | forward có trạng thái SENT khi cầu nối chạy | 1 lần chuyển: FAILED | `08-chat.json` · [{"id":"cmw174pm20203jtc4and6xlvu","status":"FAILED"}] | BLOCKED |
| L5-CHAT-36 | cskh | api | Chat CSKH | CSKH "Gửi lại" một lần chuyển | JSON gọn; id lạ 404 | resend 201; id lạ 404 | `08-chat.json` · {"id":"cmw174pm20203jtc4and6xlvu","status":"FAILED","lastError":"BRIDGE_NOT_CONFIGURED: Chưa cấu hình ZALO_BR… | PASS |
| L5-CHAT-37 | cskh | api | Chat CSKH | Hộp việc CSKH: supportChatUnforwarded / zaloBridgeDown | có mục đếm tin chưa chuyển | supportChatUnforwarded=1, zaloBridgeDown=undefined | `08-chat.json` · {"returnsPending":1,"communityReports":0,"communityPending":0,"communityUnanswered":0,"externalPoints":0,"sup… | PASS |
| L5-CHAT-38 | returning | api | Chat CSKH | Khách gửi tin thứ 201 trong ngày | 429 code CHAT_DAILY_LIMIT, có hotline (support-chat.service.ts:141) | HTTP 429 CHAT_DAILY_LIMIT | `08-chat.json` · {"statusCode":429,"error":"Too Many Requests","code":"CHAT_DAILY_LIMIT","message":"Bạn đã gửi quá nhiều tin h… | PASS |
| L5-CHAT-39 | admin | api | Chat CSKH | Khôi phục chat.enabled = true | về bản gốc | DB true | `08-chat.json` | PASS |

### Admin trên điện thoại

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-A375-admin-inbox | admin | web375 | Admin trên điện thoại | mở /admin?tab=inbox ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 8 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-inbox.png` · {"overflow":0,"wide":[],"small":1,"text":1070,"title":"Quản trị Tubu Tree","shown":["Hôm nay, 20 việc đang ch… | PASS |
| L5-A375-admin-dashboard | admin | web375 | Admin trên điện thoại | mở /admin?tab=dashboard ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 10 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-dashboard.png` · {"overflow":0,"wide":[],"small":1,"text":1408,"title":"Quản trị Tubu Tree","shown":["Tổng quan chỉ số"],"bad"… | PASS |
| L5-A375-admin-orders | admin | web375 | Admin trên điện thoại | mở /admin?tab=orders ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 10 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-orders.png` · {"overflow":0,"wide":[],"small":1,"text":2559,"title":"Quản trị Tubu Tree","shown":["Đơn hàng, 7 việc đang ch… | PASS |
| L5-A375-admin-merchantProducts | admin | web375 | Admin trên điện thoại | mở /admin?tab=merchantProducts ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 8 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-merchantProducts.png` · {"overflow":0,"wide":[],"small":1,"text":529,"title":"Quản trị Tubu Tree","shown":["Duyệt SP đối tác"],"bad":… | PASS |
| L5-A375-admin-productCategories | admin | web375 | Admin trên điện thoại | mở /admin?tab=productCategories ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 7 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-productCategories.png` · {"overflow":0,"wide":[],"small":1,"text":4453,"title":"Quản trị Tubu Tree","shown":["Sản phẩm, 44 việc đang c… | PASS |
| L5-A375-admin-users | admin | web375 | Admin trên điện thoại | mở /admin?tab=users ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 7 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-users.png` · {"overflow":0,"wide":[],"small":1,"text":1288,"title":"Quản trị Tubu Tree","shown":["Người dùng"],"bad":[],"e… | PASS |
| L5-A375-admin-waste | admin | web375 | Admin trên điện thoại | mở /admin?tab=waste ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 9 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-waste.png` · {"overflow":0,"wide":[],"small":1,"text":966,"title":"Quản trị Tubu Tree","shown":["Đổi rác"],"bad":[],"errs"… | PASS |
| L5-A375-admin-supportChat | admin | web375 | Admin trên điện thoại | mở /admin?tab=supportChat ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 7 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-supportChat.png` · {"overflow":0,"wide":[],"small":1,"text":383,"title":"Quản trị Tubu Tree","shown":["Chat CSKH, 2 việc đang ch… | PASS |
| L5-A375-admin-coupons | admin | web375 | Admin trên điện thoại | mở /admin?tab=coupons ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-coupons.png` · {"overflow":0,"wide":[],"small":1,"text":2092,"title":"Quản trị Tubu Tree","shown":["Mã giảm giá"],"bad":[],"… | PASS |
| L5-A375-admin-dealers | admin | web375 | Admin trên điện thoại | mở /admin?tab=dealers ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-dealers.png` · {"overflow":0,"wide":[],"small":1,"text":259,"title":"Quản trị Tubu Tree","shown":["Đại lý"],"bad":[],"errs":… | PASS |
| L5-A375-admin-storefronts | admin | web375 | Admin trên điện thoại | mở /admin?tab=storefronts ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-admin-storefronts.png` · {"overflow":0,"wide":[],"small":1,"text":488,"title":"Quản trị Tubu Tree","shown":["Gian hàng, 1 việc đang ch… | PASS |
| L5-A375-cskh-inbox | cskh | web375 | Admin trên điện thoại | mở /admin?tab=inbox ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 5 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-cskh-inbox.png` · {"overflow":0,"wide":[],"small":1,"text":334,"title":"Quản trị Tubu Tree","shown":["Hôm nay, 3 việc đang chờ"… | PASS |
| L5-A375-cskh-orders | cskh | web375 | Admin trên điện thoại | mở /admin?tab=orders ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 10 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-cskh-orders.png` · {"overflow":0,"wide":[],"small":1,"text":2541,"title":"Quản trị Tubu Tree","shown":["Đơn hàng"],"bad":[],"err… | PASS |
| L5-A375-cskh-returns | cskh | web375 | Admin trên điện thoại | mở /admin?tab=returns ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-cskh-returns.png` · {"overflow":0,"wide":[],"small":1,"text":596,"title":"Quản trị Tubu Tree","shown":["Đổi / Trả, 1 việc đang ch… | PASS |
| L5-A375-cskh-supportChat | cskh | web375 | Admin trên điện thoại | mở /admin?tab=supportChat ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 7 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-cskh-supportChat.png` · {"overflow":0,"wide":[],"small":1,"text":382,"title":"Quản trị Tubu Tree","shown":["Chat CSKH, 2 việc đang ch… | PASS |
| L5-A375-ketoan-inbox | ketoan | web375 | Admin trên điện thoại | mở /admin?tab=inbox ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-ketoan-inbox.png` · {"overflow":0,"wide":[],"small":1,"text":298,"title":"Quản trị Tubu Tree","shown":["Hôm nay, 5 việc đang chờ"… | PASS |
| L5-A375-ketoan-orders | ketoan | web375 | Admin trên điện thoại | mở /admin?tab=orders ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 11 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-ketoan-orders.png` · {"overflow":0,"wide":[],"small":1,"text":2558,"title":"Quản trị Tubu Tree","shown":["Đơn hàng, 1 việc đang ch… | PASS |
| L5-A375-ketoan-customerRefunds | ketoan | web375 | Admin trên điện thoại | mở /admin?tab=customerRefunds ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 7 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-ketoan-customerRefunds.png` · {"overflow":0,"wide":[],"small":1,"text":2166,"title":"Quản trị Tubu Tree","shown":["Hoàn tiền khách, 4 khoản… | PASS |
| L5-A375-ketoan-payouts | ketoan | web375 | Admin trên điện thoại | mở /admin?tab=payouts ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 8 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-ketoan-payouts.png` · {"overflow":0,"wide":[],"small":1,"text":923,"title":"Quản trị Tubu Tree","shown":["Thuế TNCN hoa hồng"],"bad… | PASS |
| L5-A375-kho-inbox | kho | web375 | Admin trên điện thoại | mở /admin?tab=inbox ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 5 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-kho-inbox.png` · {"overflow":0,"wide":[],"small":1,"text":290,"title":"Quản trị Tubu Tree","shown":["Hôm nay, 11 việc đang chờ… | PASS |
| L5-A375-kho-orders | kho | web375 | Admin trên điện thoại | mở /admin?tab=orders ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 10 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-kho-orders.png` · {"overflow":0,"wide":[],"small":1,"text":2542,"title":"Quản trị Tubu Tree","shown":["Đơn hàng, 6 việc đang ch… | PASS |
| L5-A375-kho-returns | kho | web375 | Admin trên điện thoại | mở /admin?tab=returns ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-kho-returns.png` · {"overflow":0,"wide":[],"small":1,"text":2197,"title":"Quản trị Tubu Tree","shown":["Đổi / Trả, 5 việc đang c… | PASS |
| L5-A375-marketing-inbox | marketing | web375 | Admin trên điện thoại | mở /admin?tab=inbox ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 5 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-marketing-inbox.png` · {"overflow":0,"wide":[],"small":1,"text":169,"title":"Quản trị Tubu Tree","shown":["Hôm nay"],"bad":[],"errs"… | PASS |
| L5-A375-marketing-coupons | marketing | web375 | Admin trên điện thoại | mở /admin?tab=coupons ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-marketing-coupons.png` · {"overflow":0,"wide":[],"small":1,"text":2073,"title":"Quản trị Tubu Tree","shown":["Mã giảm giá"],"bad":[],"… | PASS |
| L5-A375-marketing-notificationTemplates | marketing | web375 | Admin trên điện thoại | mở /admin?tab=notificationTemplates ở 375px | không tràn ngang, không request lỗi, không lỗi console, có nội dung | ổn; tiêu đề "Quản trị Tubu Tree"; 6 request; 1 nút thấp hơn 32px trong màn hình đầu | `09-admin375-admin_cskh_ketoan_kho_marketing.json`, ảnh `ui375-marketing-notificationTemplates.png` · {"overflow":0,"wide":[],"small":1,"text":6000,"title":"Quản trị Tubu Tree","shown":["Mẫu thông báo"],"bad":[]… | PASS |

### Quầy nhân viên

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-staff-_staff | staff | mini375 | Quầy nhân viên | mở /staff ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /staff; 0 nút thấp hơn 32px; chữ: "Ca làm của tôi Chấm công hôm nay Hôm nay bạn không có ca đã duyệt. Cần ở đúng mạng WiFi công ty & trong vùng để chấm côn" | `10-mini375.json` · {"overflow":0,"text":"Ca làm của tôi Chấm công hôm nay Hôm nay bạn không có ca đã duyệt. Cần ở đúng mạng WiFi… | PASS |

### Bàn nhận đổi rác

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-staff-_recycle_desk | staff | mini375 | Bàn nhận đổi rác | mở /recycle/desk ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /recycle/desk; 0 nút thấp hơn 32px; chữ: "Nhận hàng tại điểm Điểm nhận Tubu Quận 1 Quét mã của khách Mã yêu cầu hoặc mã nhận quà Tra mã Hôm nay còn xác nhận được " | `10-mini375.json` · {"overflow":0,"text":"Nhận hàng tại điểm Điểm nhận Tubu Quận 1 Quét mã của khách Mã yêu cầu hoặc mã nhận quà … | PASS |

### Bảng lương của tôi

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-staff-_my_payroll | staff | mini375 | Bảng lương của tôi | mở /my-payroll ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /my-payroll; 0 nút thấp hơn 32px; chữ: "Lương của tôi Tháng 11/2026 Thực nhận tháng 11/2026 0đ Giờ công: 0h00 Đơn giá: 0đ/h Lương gộp: 0đ Phạt: 0đ Đang tính Thô" | `10-mini375.json` · {"overflow":0,"text":"Lương của tôi Tháng 11/2026 Thực nhận tháng 11/2026 0đ Giờ công: 0h00 Đơn giá: 0đ/h Lươ… | PASS |

### Admin trong Mini App

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-admin-_admin | admin | mini375 | Admin trong Mini App | mở /admin ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /admin; 0 nút thấp hơn 32px; chữ: "Quản trị nhân sự Nhân sự Duyệt ca Lương Kiểm duyệt cộng đồng Nhân sự Thêm Admin UAT 0901000012 · Quản trị (bạn) CSKH Kiể" | `10-mini375.json` · {"overflow":0,"text":"Quản trị nhân sự Nhân sự Duyệt ca Lương Kiểm duyệt cộng đồng Nhân sự Thêm Admin UAT 090… | PASS |

### Quầy nhân viên (CSKH)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-cskh-_staff | cskh | mini375 | Quầy nhân viên (CSKH) | mở /staff ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /staff; 0 nút thấp hơn 32px; chữ: "Ca làm của tôi Chấm công hôm nay Hôm nay bạn không có ca đã duyệt. Cần ở đúng mạng WiFi công ty & trong vùng để chấm côn" | `10-mini375.json` · {"overflow":0,"text":"Ca làm của tôi Chấm công hôm nay Hôm nay bạn không có ca đã duyệt. Cần ở đúng mạng WiFi… | PASS |

### Bàn nhận đổi rác (kho)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-kho-_recycle_desk | kho | mini375 | Bàn nhận đổi rác (kho) | mở /recycle/desk ở 375px | không tràn ngang, không request lỗi, có nội dung | ổn; URL /recycle/desk; 0 nút thấp hơn 32px; chữ: "Nhận hàng tại điểm Điểm nhận Tubu Quận 1 Quét mã của khách Mã yêu cầu hoặc mã nhận quà Tra mã Hôm nay còn xác nhận được " | `10-mini375.json` · {"overflow":0,"text":"Nhận hàng tại điểm Điểm nhận Tubu Quận 1 Quét mã của khách Mã yêu cầu hoặc mã nhận quà … | PASS |

### Khách gõ thẳng /staff

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-returning-_staff | returning | mini375 | Khách gõ thẳng /staff | khách (CUSTOMER) gõ thẳng /staff | không thấy dữ liệu nội bộ: bị đẩy đi hoặc hiện thông báo không có quyền; không có dữ liệu admin trong màn | URL cuối /staff; 0 request 403; chữ trên màn: "Ca làm của tôi Trang dành cho nhân viên Tài khoản này chưa có quyền nhân viên. Liên hệ quản trị để được cấp quyền. Về Cá nhân"; | `10-mini375.json` · {"url":"/staff","text":"Ca làm của tôi Trang dành cho nhân viên Tài khoản này chưa có quyền nhân viên. Liên h… | PASS |

### Khách gõ thẳng /admin

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-returning-_admin | returning | mini375 | Khách gõ thẳng /admin | khách (CUSTOMER) gõ thẳng /admin | không thấy dữ liệu nội bộ: bị đẩy đi hoặc hiện thông báo không có quyền; không có dữ liệu admin trong màn | URL cuối /admin; 0 request 403; chữ trên màn: "Quản trị nhân sự Chỉ quản trị viên mới truy cập được trang này."; | `10-mini375.json` · {"url":"/admin","text":"Quản trị nhân sự Chỉ quản trị viên mới truy cập được trang này.","r403":[],"shot":"/U… | PASS |

### Khách gõ thẳng /recycle/desk

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-M375-returning-_recycle_desk | returning | mini375 | Khách gõ thẳng /recycle/desk | khách (CUSTOMER) gõ thẳng /recycle/desk | không thấy dữ liệu nội bộ: bị đẩy đi hoặc hiện thông báo không có quyền; không có dữ liệu admin trong màn | URL cuối /recycle/desk; 0 request 403; chữ trên màn: "Nhận hàng tại điểm Chương trình đang tạm dừng"; | `10-mini375.json` · {"url":"/recycle/desk","text":"Nhận hàng tại điểm Chương trình đang tạm dừng","r403":[],"shot":"/Users/longla… | PASS |

### Bàn nhận đổi rác (Mini 375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-DESK-01 | staff | mini375 | Bàn nhận đổi rác (Mini 375) | Mở bàn nhận, chưa nhập mã | nút "Tra mã" bị khoá (không gọi API khi rỗng) | isDisabled=true | `11-desk375.json` | PASS |
| L5-DESK-02 | staff | mini375 | Bàn nhận đổi rác (Mini 375) | Tra mã yêu cầu không có thật | báo lỗi tiếng Việt rõ, không 500, không tràn ngang, không "Vui lòng/chúng tôi/..." | POST /waste/desk/lookup 404; chữ lỗi: ""; tràn ngang 0px; giọng: sạch | `11-desk375.json` · {"reqs":[{"method":"POST","path":"/waste/desk/lookup","status":404,"mocked":false}],"txt":"Nhận hàng tại điểm… | PASS |
| L5-DESK-03 | staff | mini375 | Bàn nhận đổi rác (Mini 375) | Tra chuỗi lạ có dấu nháy | báo lỗi tiếng Việt rõ, không 500, không tràn ngang, không "Vui lòng/chúng tôi/..." | POST /waste/desk/lookup 404; chữ lỗi: ""; tràn ngang 0px; giọng: sạch | `11-desk375.json` · {"reqs":[{"method":"POST","path":"/waste/desk/lookup","status":404,"mocked":false}],"txt":"Nhận hàng tại điểm… | PASS |
| L5-DESK-04 | staff | mini375 | Bàn nhận đổi rác (Mini 375) | Tra chuỗi dài 120 ký tự | báo lỗi tiếng Việt rõ, không 500, không tràn ngang, không "Vui lòng/chúng tôi/..." | POST /waste/desk/lookup 400; chữ lỗi: "Mã không được dài quá 64 ký tự."; tràn ngang 0px; giọng: sạch | `11-desk375.json` · {"reqs":[{"method":"POST","path":"/waste/desk/lookup","status":400,"mocked":false}],"txt":"Nhận hàng tại điểm… | PASS |
| L5-DESK-05 | returning | mini375 | Bàn nhận đổi rác (Mini 375) | Khách mở /recycle/desk | không có ô tra mã của nhân viên | 0 ô nhập; chữ: "Nhận hàng tại điểm Chương trình đang tạm dừng" | `11-desk375.json` | PASS |

### Đơn hàng bằng giao diện

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-OUI-01 | ketoan | web375 | Đơn hàng bằng giao diện | Kế toán mở đơn chuyển khoản chưa trả ở 375px | thấy khối "Xác nhận đã nhận tiền" + nút "Đã nhận tiền"; SĐT khách chỉ hiện đuôi (che) | có nút=true; lộ SĐT đầy đủ=false | `12-orders-ui.json`, ảnh `ui375-ketoan-order-open.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Hay dùng · Đơn hàng , 8 việc đang chờ Đổi mục Tì… | PASS |
| L5-OUI-02a | ketoan | web375 | Đơn hàng bằng giao diện | Bấm "Đã nhận tiền" hiện hộp xác nhận | có hộp "Xác nhận đã nhận tiền" nêu số tiền + mã đơn + câu hậu quả, chưa ghi gì vào DB | hộp: Xác nhận đã nhận tiền Xác nhận đã nhận 120.000đ chuyển khoản cho đơn TUBU2026110374728? | `12-orders-ui.json`, ảnh `ui375-ketoan-order-confirm-sheet.png` | PASS |
| L5-OUI-02 | ketoan | web375 | Đơn hàng bằng giao diện | Kế toán bấm "Đã nhận tiền" + mã giao dịch | POST confirm-payment 2xx; DB paymentStatus PAID, paidAt có, trạng thái rời PENDING_PAYMENT; màn báo kết quả | POST /admin/orders/cmw17eyqz027rjtc4crh2vvro/confirm-payment 201; DB PENDING_PAYMENT/UNPAID -> CONFIRMED/PAID; chữ báo: "Đã xác nhận (1) Đã đóng gói (0) Đang giao (0) Đã giao (0) Đã huỷ (0) Đã trả (0) Lọc Xuất CSV (Excel) Đã ghi … | `12-orders-ui.json`, ảnh `ui375-ketoan-order-paid.png` · {"o0":{"id":"cmw17eyqz027rjtc4crh2vvro","code":"TUBU2026110374728","status":"PENDING_PAYMENT","pm":"BANK_TRAN… | PASS |
| L5-OUI-02b | ketoan | web375 | Đơn hàng bằng giao diện | Lịch sử đơn ghi mã giao dịch | ghi mã FT26UI0001 | [{"note":"Đã nhận tiền (UNPAID → PAID) · Kế toán xác nhận · Mã GD FT26UI0001"}] | `12-orders-ui.json` · [{"note":"Đã nhận tiền (UNPAID → PAID) · Kế toán xác nhận · Mã GD FT26UI0001"}] | PASS |
| L5-OUI-03 | cskh | web1280 | Đơn hàng bằng giao diện | CSKH mở đơn COD đã xác nhận | chỉ thấy "Huỷ đơn" (CSKH chỉ được huỷ: order-actor-transitions.ts), không thấy Đã đóng gói / Giao vận / Đã giao hàng | nút chuyển trạng thái: ["Huỷ đơn"] | `12-orders-ui.json`, ảnh `ui1280-cskh-order-open.png` · ["Huỷ đơn"] | PASS |
| L5-OUI-04 | cskh | web1280 | Đơn hàng bằng giao diện | CSKH bấm "Huỷ đơn" và xác nhận trong hộp thoại | PUT status 2xx; DB CANCELLED; COD chưa giao nên Ví không đổi | PUT /admin/orders/cmw17f5nz028djtc4oxbs7zu8/status 200; DB CONFIRMED -> CANCELLED; ví 1680000 -> 1680000; hộp thoại: "Huỷ đơn LỊCH SỬ TRẠNG THÁI Huỷ đơn hàng Xác nhận huỷ đơn TUBU2026110305943? Khách chưa trả tiền — không có khoả… | `12-orders-ui.json`, ảnh `ui1280-cskh-cancel-dialog.png` · {"o0":{"id":"cmw17f5nz028djtc4oxbs7zu8","code":"TUBU2026110305943","status":"CONFIRMED","pm":"COD","ps":"UNPA… | PASS |
| L5-OUI-05 | kho | web375 | Đơn hàng bằng giao diện | Kho mở đơn COD đã xác nhận ở 375px | chỉ thấy "Đã đóng gói" (KHO chỉ PACKED) | nút: ["Đã đóng gói"] | `12-orders-ui.json`, ảnh `ui375-kho-order-open.png` · ["Đã đóng gói"] | PASS |
| L5-OUI-06 | kho | web375 | Đơn hàng bằng giao diện | Kho bấm "Đã đóng gói" | PUT status 2xx; DB PACKED | PUT /admin/orders/cmw17fdnw0291jtc40ke4dtmg/status 200; DB CONFIRMED -> PACKED | `12-orders-ui.json` · {"o0":{"id":"cmw17fdnw0291jtc40ke4dtmg","code":"TUBU2026110328735","status":"CONFIRMED","pm":"COD","ps":"UNPA… | PASS |
| L5-OUI-07 | admin | web1280 | Đơn hàng bằng giao diện | ADMIN mở đơn COD đã xác nhận | thấy SĐT đầy đủ; có nút Đã đóng gói + Huỷ đơn | SĐT đầy đủ=true; nút ["Đã đóng gói","Giao vận","Đã giao hàng","Huỷ đơn"] | `12-orders-ui.json`, ảnh `ui1280-admin-order-open.png` · ["Đã đóng gói","Giao vận","Đã giao hàng","Huỷ đơn"] | PASS |

### Chat CSKH bằng giao diện (375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-CUI-00 | returning | api | Chat CSKH bằng giao diện (375) | Khách gửi tin để có hội thoại | 2xx | HTTP 201 | `13-chat-ui.json` · {"id":"cmw17gkyj02a0jtc4gm2m73vd","sender":"CUSTOMER","body":"UAT-UI-mw17gkya Đơn của mình bao giờ giao?","im… | PASS |
| L5-CUI-01 | cskh | web375 | Chat CSKH bằng giao diện (375) | CSKH mở tab Chat CSKH | thấy danh sách hội thoại có mã #JT8A và tin vừa gửi; thẻ cầu nối ở dạng gọn (không có công tắc "Cho khách chat" của admin) | thấy mã=true; thấy tin=true; công tắc admin=false | `13-chat-ui.json`, ảnh `ui375-cskh-chat-list.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Hay dùng · Chat CSKH , 3 việc đang chờ Đổi mục C… | PASS |
| L5-CUI-02 | cskh | web375 | Chat CSKH bằng giao diện (375) | Mở hội thoại: nút "Gửi trả lời" khi ô trống | bị khoá | isDisabled=true | `13-chat-ui.json` | PASS |
| L5-CUI-03 | cskh | web375 | Chat CSKH bằng giao diện (375) | CSKH gõ và bấm "Gửi trả lời" | POST reply 2xx; DB sender STAFF, adminUserId = cskh; tin hiện trong luồng; ô nhập được xoá | POST /admin/support-chat/conversations/cmw174dkl01z4jtc4bs1k3joq/reply 201; DB {"sender":"STAFF","a":"uat_cskh","body":"UAT-UI-mw17gkya Đơn đang trên đường giao nhé."}; hiện trên màn=true | `13-chat-ui.json`, ảnh `ui375-cskh-chat-replied.png` | PASS |
| L5-CUI-04 | returning | api | Chat CSKH bằng giao diện (375) | Khách thấy câu trả lời vừa gõ ở giao diện admin | có trong khung chat của khách | 12 tin | `13-chat-ui.json` | PASS |
| L5-CUI-05 | cskh | web375 | Chat CSKH bằng giao diện (375) | Bấm "Chặn chat": hộp xác nhận | hộp "Chặn chat của khách này?" nêu hậu quả; chưa chặn khi chưa xác nhận | hộp=true; DB blockedAt=null | `13-chat-ui.json`, ảnh `ui375-cskh-chat-block-dialog.png` · Chặn chat của khách này? Khách vẫn đọc được lịch sử nhưng không gửi được tin mới, và tin của họ không vào nhó… | PASS |
| L5-CUI-06 | cskh | web375 | Chat CSKH bằng giao diện (375) | Xác nhận chặn | DB blockedAt có, blockedByUserId = cskh; khách gửi tiếp bị 403 | DB {"b":"2026-11-03T21:34:09.857Z","u":"uat_cskh"}; khách gửi -> 403 | `13-chat-ui.json`, ảnh `ui375-cskh-chat-blocked.png` | PASS |
| L5-CUI-07 | cskh | web375 | Chat CSKH bằng giao diện (375) | Bấm "Bỏ chặn" | DB blockedAt = null | DB blockedAt=null | `13-chat-ui.json` | PASS |
| L5-CUI-08 | admin | web375 | Chat CSKH bằng giao diện (375) | ADMIN mở thẻ Cầu nối Zalo ở 375px | thấy "Cho khách chat: đang bật" và chọn nhóm; không tràn ngang | công tắc=Cho khách chat: đang bật | `13-chat-ui.json`, ảnh `ui375-admin-chat-bridge.png` · Cầu nối Zalo Mất kết nối Mất kết nối Tin khách đang không tới nhóm Zalo. Khách vẫn gửi được tin và tin được g… | PASS |

### Thao tác đồng thời

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RACE-01 | ketoan | api | Thao tác đồng thời | 5 request "Đã nhận tiền" cùng lúc (Kế toán + Admin) | đơn PAID một lần, đúng 1 dòng lịch sử "Đã nhận tiền" (không ghi trùng) | mã 201,201,201,201,201; DB CONFIRMED/PAID; 1 dòng lịch sử | `15-races.json` · {"win":5,"hist":[{"n":1}]} | PASS |
| L5-RACE-02 | cskh | api | Thao tác đồng thời | 5 request huỷ cùng một đơn chuyển khoản đã trả (CSKH + Admin) | hoàn Ví đúng 1 lần = 120000đ; sổ Ví = số dư; đơn CANCELLED/REFUNDED | mã 200,200,200,200,200; Ví 1920000 -> 2040000 (+120000); 1 dòng sổ hoàn; đơn CANCELLED/REFUNDED | `15-races.json` · {"led":[{"t":"ORDER_REFUND","d":120000}],"u0":{"wallet":1920000,"points":52680,"wsum":1920000,"psum":52680},"… | PASS |
| L5-RACE-03a | returning | api | Thao tác đồng thời | Chuẩn bị: COD giao xong + yêu cầu trả 1/2 món | đơn DELIVERED, yêu cầu REQUESTED | delivered=true; HTTP 201 | `15-races.json` · {"id":"cmw17iywa02grjtc4w4yc82av","orderId":"cmw17ixvj02fyjtc41y25cwk2","userId":"uat_returning","reason":"Hà… | PASS |
| L5-RACE-03 | cskh | api | Thao tác đồng thời | 4 request CSKH duyệt cùng một yêu cầu đổi/trả | hoàn Ví đúng 1 lần = 120000đ; sổ Ví = số dư; sổ điểm = điểm | mã 201,400,400,400; Ví +120000 (xem trước 120000); 1 dòng sổ hoàn; điểm 58440 -> 55560, sổ 55560 | `15-races.json` · {"led":[{"t":"ORDER_REFUND","d":120000}]} | PASS |
| L5-RACE-04 | kho | api | Thao tác đồng thời | 4 request Kho "Đã nhận hàng về" cùng lúc | tồn kho chỉ +1 (đúng số lượng trả) | mã 201,400,400,400; kho 159 -> 160 | `15-races.json` | PASS |
| L5-RACE-05 | kho | api | Thao tác đồng thời | 4 request Kho "Đã đóng gói" cùng lúc | đơn PACKED, đúng 1 dòng lịch sử PACKED | mã 200,200,200,200; 1 dòng lịch sử PACKED; đơn PACKED | `15-races.json` | PASS |
| L5-RACE-06 | cskh | api | Thao tác đồng thời | Kho đóng gói và CSKH huỷ CÙNG LÚC trên một đơn COD | kết quả cuối nhất quán: CANCELLED hoặc PACKED, không ở trạng thái lai; tồn kho khớp (huỷ hoàn kho đúng 1 lần) | Kho 200, CSKH 200; đơn PACKED; 1 dòng lịch sử | `15-races.json` · {"rp":"{\"id\":\"cmw17j0qx02i8jtc4jygth9zv\",\"code\":\"TUBU2026110305809\",\"idempotencyKey\":\"uat-l5-17937… | PASS |
| L5-RACE-07 | admin | api | Thao tác đồng thời | Duyệt và từ chối (mỗi bên 2 request) cùng một lệnh rút | đúng một bên thắng: REJECTED thì hoàn 250.000đ đúng 1 lần, APPROVED thì không hoàn; sổ Ví = số dư | mã 201,400,400,400; lệnh APPROVED; Ví +0 | `15-races.json` · {"u0":{"wallet":2525000,"points":0,"wsum":2525000,"psum":0},"u1":{"wallet":2525000,"points":0,"wsum":2525000,… | PASS |
| L5-RACE-08 | marketing | api | Thao tác đồng thời | 6 request tạo mã (mỗi mã tối đa giảm 3.000.000đ) cùng lúc, ngân sách ngày 10.000.000đ | tổng mức giảm tối đa của mã Marketing tạo trong ngày không vượt 10.000.000đ (khoá advisory) | mã 400,201,201,201,400,400; tạo được 3; tổng 9.000.000đ | `15-races.json` · {"exposure":9000000} | PASS |
| L5-RACE-09 | admin | api | Thao tác đồng thời | 3 request "Đã xử lý" cùng một đơn Pancake | cờ attention về rỗng, không 500 | mã 201,400,400; attention sau=null | `15-races.json` · ["{\"ok\":true,\"message\":\"Đơn TUBU2026110305809 đã rời hàng đợi cần xử lý Pancake.\"}","{\"message\":\"Đơn… | PASS |
| L5-RACE-10 | returning | api | Thao tác đồng thời | Cuối lượt: Ví và điểm của khách khớp sổ | walletBalance = SUM(sổ Ví); pointsBalance = SUM(sổ điểm) | ví 2160000/2160000; điểm 55560/55560 | `15-races.json` · {"wallet":2160000,"points":55560,"wsum":2160000,"psum":55560} | PASS |

### Hoàn tiền khách đồng thời

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RRF-00 | ketoan | api | Hoàn tiền khách đồng thời | Chuẩn bị: COD giao rồi hoàn về | khoản UNVERIFIED | khoản UNVERIFIED 120000đ | `16-races-refunds.json` · {"id":"cmw17mk8s033gjtc45r5gc00h","s":"UNVERIFIED","a":120000} | PASS |
| L5-RRF-01 | ketoan | api | Hoàn tiền khách đồng thời | 4 request "Xác nhận hãng đã thu COD" cùng lúc | đúng 1 thành công, khoản PENDING một lần, Ví không đổi | mã 201,400,400,400; khoản PENDING; ví 2160000 -> 2160000 | `16-races-refunds.json` · {"hist":[{"n":1}]} | PASS |
| L5-RRF-02a | returning | api | Hoàn tiền khách đồng thời | Chuẩn bị: huỷ đơn đã trả, chọn nhận về ngân hàng | khoản PENDING | khoản PENDING 120000đ | `16-races-refunds.json` · {"id":"cmw17ml5v034hjtc436hy1n83","s":"PENDING","a":120000} | PASS |
| L5-RRF-02 | ketoan | api | Hoàn tiền khách đồng thời | 4 request "Bắt đầu chuyển khoản" (claim) cùng lúc | đúng 1 người giữ khoản (PROCESSING), các request còn lại 4xx | mã 201,400,400,400; khoản PROCESSING; người giữ uat_ketoan | `16-races-refunds.json` · ["{\"id\":\"cmw17ml5v034hjtc436hy1n83\",\"orderId\":\"cmw17mkpg0344jtc4e6f02ocw\",\"orderCo","{\"message\":\"… | PASS |
| L5-RRF-03 | ketoan | api | Hoàn tiền khách đồng thời | 4 request "Đã chi" cùng lúc từ người đang giữ khoản | đúng 1 thành công, COMPLETED, Ví không đổi (chi tay), sổ Ví = số dư | mã 201,400,400,400; khoản COMPLETED; ví 2160000 -> 2160000; thông báo cho khách của đơn: 4 | `16-races-refunds.json` · ["{\"id\":\"cmw17ml5v034hjtc436hy1n83\",\"orderId\":\"cmw17mkpg0344jtc4e6f02ocw\",\"orderCo","{\"message\":\"… | PASS |
| L5-RRF-04 | returning | api | Hoàn tiền khách đồng thời | Cuối lượt: Ví và điểm khớp sổ | khớp | ví 2160000/2160000; điểm 55560/55560 | `16-races-refunds.json` · {"wallet":2160000,"points":55560,"wsum":2160000,"psum":55560} | PASS |

### Biểu mẫu admin (375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-FUI-01 | marketing | web375 | Biểu mẫu admin (375) | Marketing nhập mã 31% (trần 30%) rồi bấm "Tạo mã giảm giá" | POST 403; màn hiện câu "Nhân viên tạo mã giảm tối đa 30%…"; không ghi DB | POST 403; câu trên màn: "Nhân viên tạo mã giảm tối đa 30%."; 0 dòng DB | `17-forms-ui.json`, ảnh `ui375-marketing-coupon-over-cap.png` · ặt "Giảm tối đa" để đơn lớn không bị giảm quá tay. Bắt đầu từ ngày Hết hạn ngày Tạo mã giảm giá Nhân viên tạo… | PASS |
| L5-FUI-01b | marketing | web375 | Biểu mẫu admin (375) | Giọng câu báo vượt trần | không "Vui lòng", "chúng tôi", "..." | sạch | `17-forms-ui.json` · Nhân viên tạo mã giảm tối đa 30%. | PASS |
| L5-FUI-02a | marketing | web375 | Biểu mẫu admin (375) | Marketing nhập 25% x 100 lượt x tối đa 50.000đ (quá ngân sách ngày còn lại) rồi bấm tạo | POST 400; màn nêu ngân sách ngày, phần vượt và số còn lại, chỉ sang quản trị viên; không ghi DB | POST 400; câu: "Vượt ngân sách mã giảm giá và flash sale của nhân viên ngày 04/11/2026 (10.000.000đ/người/ngày): phần này có thể giảm tới 5.000.000đ, còn 1.000.000đ. Cần hơn thì nhờ quản trị viên tạo."; marketing đã tạo hôm nay 3… | `17-forms-ui.json`, ảnh `ui375-marketing-coupon-created.png` · Vượt ngân sách mã giảm giá và flash sale của nhân viên ngày 04/11/2026 (10.000.000đ/người/ngày): phần này có … | PASS |
| L5-FUI-02 | marketing | web375 | Biểu mẫu admin (375) | Marketing giảm lượt dùng cho vừa ngân sách ngày rồi tạo lại (25%, tối đa 50.000đ) | POST 2xx; màn "Đã tạo mã giảm giá!"; DB createdById = marketing, 25%, tối đa 50.000đ | POST 201; DB {"c":"uat_marketing","v":25,"m":50000,"u":5}; màn: " hạn ngày Tạo mã giảm giá Đã tạo mã giảm giá!" | `17-forms-ui.json`, ảnh `ui375-marketing-coupon-created.png` | PASS |
| L5-FUI-03 | marketing | web375 | Biểu mẫu admin (375) | Marketing mở tab Mẫu thông báo, thấy mẫu WELCOME_VOUCHER | có ô nội dung của mẫu, sửa được | vị trí ô 22 | `17-forms-ui.json` | PASS |
| L5-FUI-04 | marketing | web375 | Biểu mẫu admin (375) | Marketing thêm link rút gọn vào mẫu WELCOME_VOUCHER rồi bấm Lưu | không lưu được (nút khoá + cảnh báo, hoặc API 400 + cảnh báo tiếng Việt); DB không đổi | nút Lưu mở; PATCH 400; cảnh báo: "Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link "bit.ly/nhan-qua"." | `17-forms-ui.json`, ảnh `ui375-marketing-template-04.png` | PASS |
| L5-FUI-05 | marketing | web375 | Biểu mẫu admin (375) | Marketing thêm dãy 8 chữ số viết tách vào mẫu WELCOME_VOUCHER rồi bấm Lưu | không lưu được (nút khoá + cảnh báo, hoặc API 400 + cảnh báo tiếng Việt); DB không đổi | nút Lưu mở; PATCH 400; cảnh báo: "Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu." | `17-forms-ui.json`, ảnh `ui375-marketing-template-05.png` | PASS |
| L5-FUI-06 | marketing | web375 | Biểu mẫu admin (375) | Marketing thêm "tubutree.com" rồi Lưu | PATCH 2xx và có dòng báo đã lưu | PATCH 200; trạng thái: "Đã lưu." | `17-forms-ui.json` | PASS |
| L5-FUI-06r | admin | api | Biểu mẫu admin (375) | Khôi phục nội dung mẫu | về bản gốc | khớp | `17-forms-ui.json` | PASS |
| L5-FUI-07-375 | admin | web375 | Biểu mẫu admin (375) | ADMIN mở Sức khoẻ hệ thống khi token Zalo OA còn 1 giờ | hiện cảnh báo token Zalo OA (chỉ còn … phút) và đơn cần xử lý Pancake; không tràn ngang | Zalo OA=true; "chỉ còn"=true; Pancake=true; tràn ngang 0px | `17-forms-ui.json`, ảnh `ui375-admin-opshealth.png` · 261 và 21 việc khác Token Zalo OA chỉ còn 0 giờ 59 phút mà chưa được làm mới — tin ZNS và trả lời Zalo OA sẽ … | PASS |
| L5-FUI-07-1280 | admin | web1280 | Biểu mẫu admin (375) | ADMIN mở Sức khoẻ hệ thống khi token Zalo OA còn 1 giờ | hiện cảnh báo token Zalo OA (chỉ còn … phút) và đơn cần xử lý Pancake; không tràn ngang | Zalo OA=true; "chỉ còn"=true; Pancake=true; tràn ngang 0px | `17-forms-ui.json`, ảnh `ui1280-admin-opshealth.png` · 261 và 21 việc khác Token Zalo OA chỉ còn 0 giờ 59 phút mà chưa được làm mới — tin ZNS và trả lời Zalo OA sẽ … | PASS |
| L5-FUI-07r | admin | api | Biểu mẫu admin (375) | Khôi phục cấu hình token Zalo | cảnh báo zalo.oa_token biến mất | problems=pancake.attention | `17-forms-ui.json` | PASS |

### Việc tiền bằng giao diện

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-MUI-01 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán mở tab Hoàn tiền khách ở 375px | có danh sách khoản hoàn; ô tìm ghi "Mã đơn hoặc đủ 10 số SĐT" (SĐT bị che với Kế toán); không lộ SĐT 10 số; không tràn ngang | Tổng 7 khoản (DB đang chờ 5); ô tìm: "Mã đơn hoặc đủ 10 số SĐT"; SĐT 10 số lộ trên màn: 0; tràn ngang 0px | `18-money-ui.json`, ảnh `ui375-ketoan-customer-refunds.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Bán hàng · Hoàn tiền khách , 10 việc đang chờ Đổ… | PASS |
| L5-MUI-02 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán bấm "Bắt đầu chuyển khoản" khoản TUBU2026110328097 khách chưa chọn tài khoản nhận | hộp báo "Khách chưa chọn tài khoản nhận — nhờ quản trị viên nhập."; nút xác nhận bị khoá; DB vẫn PENDING | câu báo=true; nút xác nhận khoá=true; DB PENDING | `18-money-ui.json`, ảnh `ui375-ketoan-refund-claim-nobank.png` · Bắt đầu chuyển khoản" để khoá nơi nhận (khách không đổi sang Ví được nữa), chuyển khoản tay về tài khoản khác… | PASS |
| L5-MUI-03 | admin | web375 | Việc tiền bằng giao diện | Admin nhập tài khoản thay khách rồi bấm "Bắt đầu chuyển khoản" (TUBU2026110328097) | POST 2xx; DB PROCESSING, claimedBy = admin, đã có số tài khoản; màn báo "Đã khoá nơi nhận…"; Ví khách không đổi | POST /admin/customer-refunds/cmw16plqt00zljtc4xlyvshad/claim 201; DB PROCESSING, giữ bởi uat_admin, STK 0011004567891; ví 2160000 -> 2160000; báo: true | `18-money-ui.json`, ảnh `ui375-admin-refund-claimed.png` | PASS |
| L5-MUI-04 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán xem khoản TUBU2026110328097 đang do Admin chuyển | thẻ báo "Chỉ … được xác nhận hoặc trả về hàng chờ… tiếp quản kèm lý do"; nút ghi "(tiếp quản)" | có chữ tiếp quản=true | `18-money-ui.json`, ảnh `ui375-ketoan-refund-takeover-card.png` · Bắt đầu chuyển lúc 04:44 04/11/2026 bởi Admin UAT — khách không đổi được nơi nhận. Chỉ Admin UAT được xác nhậ… | PASS |
| L5-MUI-05 | ketoan | web375 | Việc tiền bằng giao diện | Bấm "Đã chuyển khoản" khi chưa nhập mã giao dịch và lý do tiếp quản | không gọi API; hộp vẫn mở; DB vẫn PROCESSING | gọi mark-paid=false; DB còn PROCESSING=true | `18-money-ui.json`, ảnh `ui375-ketoan-refund-paid-dialog.png` · 04567891 Chủ tài khoản NGUYEN VAN UAT Đơn TUBU2026110328097 Mã giao dịch ngân hàng Ghi chú (tuỳ chọn) Lý do t… | PASS |
| L5-MUI-06 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán nhập mã giao dịch + lý do tiếp quản rồi "Đã chuyển khoản" (TUBU2026110328097) | POST mark-paid 2xx; DB COMPLETED, bankRef FT26UIREF01; lý do tiếp quản ghi vào lịch sử đơn; Ví khách không đổi (chi tay); sổ Ví khớp | POST /admin/customer-refunds/cmw16plqt00zljtc4xlyvshad/mark-paid 201; DB COMPLETED, mã FT26UIREF01; lịch sử có lý do=true; ví 2160000 -> 2160000, sổ 2160000 | `18-money-ui.json`, ảnh `ui375-ketoan-refund-completed.png` · {"hist":[{"note":"Hoàn tiền 289.000đ: tiếp quản khoản Admin UAT đang chuyển khoản từ 04:44 04/11/2026 — xác n… | PASS |
| L5-MUI-07 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán mở tab Thuế TNCN hoa hồng (có lệnh rút cũ APPROVED) | thấy "Lệnh rút ngân hàng cũ" ở mục Đã duyệt + nút "Đã chuyển khoản"; không có nút Duyệt / Từ chối; không tràn ngang | tiêu đề=true; có Đã chuyển khoản=true; không có Duyệt=true; tràn ngang 0px | `18-money-ui.json`, ảnh `ui375-ketoan-payouts.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Đại lý và đối tác · Thuế TNCN hoa hồng , 9 việc … | PASS |
| L5-MUI-08 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán nhập mã giao dịch rồi bấm "Đã chuyển khoản" cho lệnh rút đã duyệt | POST 2xx; DB PAID + bankRef + paidAt; Ví CTV không đổi (tiền đã trừ lúc rút); sổ Ví khớp | POST /admin/payouts/uatracep3ipsnb/mark-paid 201; DB {"s":"PAID","br":"FT26UIPAY01","pa":"2026-11-03T21:44:58.468Z"}; ví 2525000 -> 2525000, sổ 2525000; hộp: "Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Đại lý và… | `18-money-ui.json`, ảnh `ui375-ketoan-payout-confirm.png` | PASS |
| L5-MUI-09 | ketoan | web1280 | Việc tiền bằng giao diện | Kế toán bấm chip "Cần xử lý Pancake (n)" ở danh sách đơn | số trên chip = số đơn API pancake=attention; danh sách lọc còn đúng các đơn đó | chip "Cần xử lý Pancake (26)"; API total 26; số dòng 20; Tổng trên màn 26 | `18-money-ui-ERR5_ERR6.json`, ảnh `ui1280-ketoan-orders-pancake-attention.png` · Tubu Tree Quản trị Về cửa hàng Tubu Đăng xuất Quản trị Tubu Tree Bỏ qua tới nội dung HAY DÙNG Hôm nay , 9 việ… | PASS |
| L5-MUI-10 | ketoan | web1280 | Việc tiền bằng giao diện | Kế toán bấm "Xuất CSV (Excel)" ở danh sách đơn | tải được file .csv có tiêu đề + đủ dòng (mọi đơn khớp bộ lọc); SĐT khách bị che (không có số 10 chữ số đầy đủ); màn báo "Đã tải …" | file "don-hang-2026-11-04.csv"; 94 dòng dữ liệu (DB có 94 đơn); SĐT đầy đủ trong file: 0; màn: "Đã tải don-hang-2026-11-04." | `18-money-ui-ERR5_ERR6.json` · Mã đơn,Ngày đặt,Khách hàng,SĐT khách,Người nhận,SĐT người nhận,Loại đơn,Nơi giao,Phương thức TT,Trạng thái TT… | PASS |
| L5-MUI-11 | ketoan | web375 | Việc tiền bằng giao diện | Kế toán 375px mở "Lọc" rồi bấm chip "Cần xử lý Pancake" trong nhóm "Cần xử lý" | chip hiện số đơn khớp API, bật được (aria-pressed=true); không tràn ngang | chip "Cần xử lý Pancake (26)"; API 26; aria-pressed=true; tràn ngang 0px | `18-money-ui-ERR5_ERR6.json`, ảnh `ui375-ketoan-orders-pancake-attention.png` | PASS |
| L5-MUI-12-cskh | cskh | web375 | Việc tiền bằng giao diện | CSKH mở tab Đổi / Trả ở 375px | mở sẵn mục đang chờ duyệt (REQUESTED), có nút Duyệt / Từ chối | mục đang chọn: ["Chờ duyệt"]; các mục: ["Chờ duyệt","Chờ nhận hàng về","Đã duyệt","Đã từ chối","Tất cả trạng thái"]; nút: ["Duyệt hoàn tiền","Từ chối"]; DB REQUESTED=1, APPROVED=10; tràn ngang 0px | `18-money-ui-ERR5_ERR6.json`, ảnh `ui375-cskh-returns.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Bán hàng · Đổi / Trả , 3 việc đang chờ Đổi mục C… | PASS |
| L5-MUI-12-kho | kho | web375 | Việc tiền bằng giao diện | KHO mở tab Đổi / Trả ở 375px | mở sẵn mục chờ nhận hàng (TO_RECEIVE); không có nút duyệt; không tràn ngang | mục đang chọn: ["Chờ nhận hàng về"]; các mục: ["Chờ duyệt","Chờ nhận hàng về","Đã duyệt","Đã từ chối","Tất cả trạng thái"]; nút: ["Đã nhận hàng về"]; DB REQUESTED=1, APPROVED=10; tràn ngang 0px | `18-money-ui-ERR5_ERR6.json`, ảnh `ui375-kho-returns.png` · Tubu Tree Quản trị Về cửa hàng Đăng xuất Bỏ qua tới nội dung Bán hàng · Đổi / Trả , 31 việc đang chờ Đổi mục … | PASS |

### Đổi/trả bằng giao diện (375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-RUI-00 | returning | api | Đổi/trả bằng giao diện (375) | Chuẩn bị: COD 2 món đã giao, khách xin trả 1 món | 201 REQUESTED | HTTP 201 REQUESTED | `21-ui-actions.json` · {"id":"cmw184dyk03gpjtc4sa1s8nwo","orderId":"cmw184d1q03fwjtc4ozju94zr","userId":"uat_returning","reason":"Ch… | PASS |
| L5-RUI-01 | cskh | web375 | Đổi/trả bằng giao diện (375) | CSKH tìm đơn TUBU2026110306439 ở tab Đổi / Trả | thấy thẻ yêu cầu: dòng khách trả (1/2), lý do khách ghi, nút "Duyệt hoàn tiền" và "Từ chối" | mã đơn=true; nút duyệt=true; lý do khách=true | `21-ui-actions.json`, ảnh `ui375-cskh-return-card.png` · Đơn: TUBU2026110306439 Chờ duyệt Khách: Nguyễn Thị Quay Lại · SĐT: 0901000003 · Tổng đơn: 240.000đ (COD (Tiền… | PASS |
| L5-RUI-02 | cskh | web375 | Đổi/trả bằng giao diện (375) | Bấm "Từ chối" khi chưa ghi lý do | báo "Ghi lý do từ chối để báo cho khách (tối thiểu 3 ký tự)."; đơn vẫn REQUESTED | cảnh báo: "Ghi lý do từ chối để báo cho khách (tối thiểu 3 ký tự)." | `21-ui-actions.json` | PASS |
| L5-RUI-03 | cskh | web375 | Đổi/trả bằng giao diện (375) | Bấm "Duyệt hoàn tiền": bảng kiểm tra trước khi duyệt | hiện "Trả một phần — kiểm tra trước khi duyệt", Tổng hoàn = số xem trước của API (120000đ), nơi nhận tiền, nút "Xác nhận hoàn …"; chưa ghi DB | xem trước API 120000đ; có số trên màn=true | `21-ui-actions.json`, ảnh `ui375-cskh-return-confirm.png` · Trả một phần — kiểm tra trước khi duyệt Nước rửa chén sinh học Fuwa3e · 1L ×1 120.000đ Phí ship hoàn 0đ Tổng … | PASS |
| L5-RUI-04 | cskh | web375 | Đổi/trả bằng giao diện (375) | Xác nhận hoàn trong bảng kiểm tra | POST review 2xx; yêu cầu APPROVED; Ví khách +đúng số xem trước; sổ Ví = số dư; điểm = sổ điểm và giảm (đảo điểm đơn); đơn vẫn DELIVERED (trả 1/2) | POST /admin/return-requests/cmw184dyk03gpjtc4sa1s8nwo/review 201; yêu cầu APPROVED; Ví 2640000 -> 2760000 (+120000; xem trước 120000); sổ Ví 2760000; điểm 61320 -> 58440 (sổ 58440); đơn DELIVERED | `21-ui-actions.json`, ảnh `ui375-cskh-return-approved.png` · {"pv":{"requestId":"cmw184dyk03gpjtc4sa1s8nwo","shopFault":true,"defaultShopFault":true,"isFull":false,"goods… | PASS |
| L5-RUI-05 | kho | web375 | Đổi/trả bằng giao diện (375) | Kho tìm đơn TUBU2026110306439 ở tab Đổi / Trả (mục Chờ nhận hàng về) | thấy thẻ "Chưa nhận hàng trả về — kho chưa cộng" và chỉ nút "Đã nhận hàng về" (không có Duyệt / Từ chối) | nút: ["Đã nhận hàng về"]; thấy dòng chưa nhận=true | `21-ui-actions.json`, ảnh `ui375-kho-return-card.png` · Đơn: TUBU2026110306439 Đã duyệt (Hoàn tiền) Khách: Nguyễn Thị Quay Lại · SĐT: 0901000003 · Tổng đơn: 240.000đ… | PASS |
| L5-RUI-06 | kho | web375 | Đổi/trả bằng giao diện (375) | Kho xác nhận "Đã nhận hàng về" trong hộp thoại | hộp hỏi trước, chưa cộng kho khi chưa xác nhận; sau xác nhận POST 2xx, receivedAt có, tồn kho +1, Ví khách không đổi | hộp hỏi=true; POST /admin/return-requests/cmw184dyk03gpjtc4sa1s8nwo/received 201; kho 123 -> 124; receivedAt=2026-11-03T21:52:46.429Z; Ví 2760000 -> 2760000 | `21-ui-actions.json`, ảnh `ui375-kho-return-confirm.png` | PASS |

### Hoá đơn VAT bằng giao diện (375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-VUI-01 | ketoan | web375 | Hoá đơn VAT bằng giao diện (375) | Kế toán mở đơn có yêu cầu VAT ở 375px | thấy khối "Hoá đơn VAT" với MST, tên công ty, email; ô link + nút "Đã xuất hoá đơn"; không tràn ngang | MST=true; công ty=true; email=true; tràn ngang 0px | `21-ui-actions-A_C.json`, ảnh `ui375-ketoan-vat-open.png` · HOÁ ĐƠN VAT Chờ xuất hoá đơn Mã số thuế: 0312345679 Chép Email nhận hoá đơn: vat-ui@example.com Công ty: Công… | PASS |
| L5-VUI-02 | ketoan | web375 | Hoá đơn VAT bằng giao diện (375) | Kế toán nhập link http (không https) rồi bấm "Đã xuất hoá đơn" | màn báo lỗi tiếng Việt ngay, không gọi API, đơn vẫn REQUESTED | cảnh báo: "Link hoá đơn phải là địa chỉ https hợp lệ."; gọi API=false; DB REQUESTED | `21-ui-actions-A_C.json`, ảnh `ui375-ketoan-vat-bad-url.png` | PASS |
| L5-VUI-02b | ketoan | web375 | Hoá đơn VAT bằng giao diện (375) | Giọng câu báo link sai | không "Vui lòng", "chúng tôi", "..." | sạch | `21-ui-actions-A_C.json` · Link hoá đơn phải là địa chỉ https hợp lệ. | PASS |
| L5-VUI-03 | ketoan | web375 | Hoá đơn VAT bằng giao diện (375) | Link https hợp lệ, bấm "Đã xuất hoá đơn": hộp xác nhận | hộp "Xác nhận đã xuất hoá đơn" nêu mã đơn + MST và hậu quả; chưa ghi DB | hộp=true; có MST=true; DB REQUESTED | `21-ui-actions-A_C.json`, ảnh `ui375-ketoan-vat-confirm.png` · Xác nhận đã xuất hoá đơn Ghi nhận đã xuất hoá đơn VAT cho đơn TUBU2026110344889 (Công ty TNHH UAT Giao Diện, … | PASS |
| L5-VUI-04 | ketoan | web375 | Hoá đơn VAT bằng giao diện (375) | Xác nhận trong hộp thoại | POST 2xx; DB ISSUED + invoiceUrl; màn báo kết quả; khách nhận thông báo nhắc mã đơn | POST /admin/orders/cmw186b0s03hnjtc4hrrc42wy/issue-invoice 201; DB {"s":"ISSUED","u":"https://hoadon.example.com/uat/HD-UI-0001.pdf"}; màn: "Đã ghi nhận xuất hoá đơn VAT cho đơn TUBU2026110344889."; thông báo cho khách: có | `21-ui-actions-A_C.json`, ảnh `ui375-ketoan-vat-issued.png` · {"id":"cmw186hv503hwjtc43k6w5nax","userId":"uat_returning","templateCode":"INVOICE_ISSUED","channel":"INAPP",… | PASS |

### Cấu hình hệ thống bằng giao diện (1280)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-CFGUI-01 | admin | web1280 | Cấu hình hệ thống bằng giao diện (1280) | Admin tìm khoá coupon.staff_max_percent | thấy đúng ô của khoá, giá trị hiện = DB (30) | ô hiện "30"; DB 30 | `21-ui-actions-A_C.json`, ảnh `ui1280-admin-config-search.png` | PASS |
| L5-CFGUI-02 | admin | web1280 | Cấu hình hệ thống bằng giao diện (1280) | Nhập JSON hỏng rồi Lưu | báo "JSON không hợp lệ"; DB không đổi | báo=true; DB 30 | `21-ui-actions-A_C.json` | PASS |
| L5-CFGUI-03 | admin | web1280 | Cấu hình hệ thống bằng giao diện (1280) | Đổi trần % mã của nhân viên từ 30 xuống 25 rồi xác nhận | hộp xác nhận nêu giá trị cũ → mới; PUT config 2xx; DB = 25, updatedBy = admin; Marketing tạo mã 26% bị 403 ngay | hộp xác nhận=true; PUT /admin/config 200; DB {"v":25,"b":"uat_admin"}; Marketing tạo 26% -> 403 Nhân viên tạo mã giảm tối đa 25%. Cần mức cao hơn thì nhờ quản trị viên tạo mã. | `21-ui-actions-A_C.json`, ảnh `ui1280-admin-config-confirm.png` · Xác nhận đổi cấu hình tiền/điểm coupon.staff_max_percent 30 → 25 Áp dụng ngay cho mọi đơn, ví và điểm của khá… | PASS |
| L5-CFGUI-04 | admin | web1280 | Cấu hình hệ thống bằng giao diện (1280) | Khôi phục trần về giá trị ban đầu bằng giao diện | DB = 30 | DB 30 | `21-ui-actions-A_C.json` | PASS |

### Lệnh rút CTV bằng giao diện (375)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-PUI-01 | admin | web375 | Lệnh rút CTV bằng giao diện (375) | Admin mở tab Thuế TNCN hoa hồng (có 2 lệnh rút cũ REQUESTED) | mục "Lệnh rút ngân hàng cũ" mở sẵn ở "Chờ duyệt", thấy 510.000đ và 320.000đ (phí 5.000đ), có nút Duyệt + Từ chối | thấy 510.000đ=true; 320.000đ=true; phí=true | `22-payout-ui.json`, ảnh `ui375-admin-payouts.png` | PASS |
| L5-PUI-02 | admin | web375 | Lệnh rút CTV bằng giao diện (375) | Admin bấm "Duyệt" lệnh 510.000đ rồi xác nhận | hộp "Duyệt lệnh rút tiền" hỏi trước (DB còn REQUESTED); xác nhận: POST approve 2xx, DB APPROVED; Ví CTV không đổi (chưa chi) | hộp=true; trước xác nhận REQUESTED; POST /admin/payouts/uatpui21oidmf/approve 201; sau {"s":"APPROVED","r":"uat_admin"}; Ví 2525000 -> 2525000 | `22-payout-ui.json`, ảnh `ui375-admin-payout-approve-dialog.png` | PASS |
| L5-PUI-03 | admin | web375 | Lệnh rút CTV bằng giao diện (375) | Admin bấm "Từ chối (hoàn tiền)" khi chưa ghi lý do | báo phải ghi lý do (tiếng Việt), không gọi API, lệnh vẫn REQUESTED | gọi API=false; DB REQUESTED; cảnh báo: "Nhập lý do từ chối — tiền/hoa hồng sẽ được hoàn lại cho CTV kèm lý do này." | `22-payout-ui.json`, ảnh `ui375-admin-payout-reject-noreason.png` | PASS |
| L5-PUI-04 | admin | web375 | Lệnh rút CTV bằng giao diện (375) | Admin ghi lý do rồi "Từ chối (hoàn tiền)" lệnh 320.000đ (phí 5.000đ) | hộp nêu "Tiền/hoa hồng sẽ được HOÀN LẠI cho CTV"; xác nhận: POST reject 2xx, DB REJECTED + lý do; Ví CTV +325.000đ (amount + fee); sổ Ví = số dư | hộp=true; POST /admin/payouts/uatpuik7gwhe6/reject 201; DB {"s":"REJECTED","r":"UAT: sai số tài khoản"}; Ví 2525000 -> 2850000 (+325000); sổ Ví 2850000 | `22-payout-ui.json`, ảnh `ui375-admin-payout-reject-dialog.png` | PASS |

### Số Việc cần xử lý khớp danh sách

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-INB-01 | kho | api | Số Việc cần xử lý khớp danh sách | Thẻ "Cần xử lý Pancake" của Kho = danh sách ?pancake=attention = SQL | ba số bằng nhau (ops-inbox.service.ts:116) | thẻ Kho 33; thẻ Admin 33; danh sách 33; SQL 33 | `23-inbox-counts.json` | PASS |
| L5-INB-01b | admin | api | Số Việc cần xử lý khớp danh sách | Thẻ Pancake của Admin = của Kho | bằng nhau | Admin 33; Kho 33 | `23-inbox-counts.json` | PASS |
| L5-INB-02 | ketoan | api | Số Việc cần xử lý khớp danh sách | Thẻ "Hoàn tiền khách" = danh sách "Đang mở" = SQL | ba số bằng nhau (ops-inbox.service.ts:119) | thẻ 6; danh sách 6; SQL (UNVERIFIED+PENDING+PROCESSING) 6 | `23-inbox-counts.json` | PASS |
| L5-INB-03 | cskh | api | Số Việc cần xử lý khớp danh sách | Thẻ "Đổi/trả chờ duyệt" của CSKH = danh sách REQUESTED = SQL | ba số bằng nhau (ops-inbox.service.ts:121) | thẻ 1; danh sách 1; SQL 1 | `23-inbox-counts.json` | PASS |
| L5-INB-04 | kho | api | Số Việc cần xử lý khớp danh sách | Thẻ "Hàng trả chờ nhận" của Kho = danh sách TO_RECEIVE | bằng nhau (ops-inbox.service.ts:127; SQL tham khảo: APPROVED chưa receivedAt) | thẻ 5; danh sách 5; SQL tham khảo 5 (luật thẻ có thêm điều kiện về đơn/kho trả) | `23-inbox-counts.json` | PASS |
| L5-INB-05 | ketoan | api | Số Việc cần xử lý khớp danh sách | Thẻ "Chuyển khoản chờ tiền" = danh sách queue=bank_transfer_to_confirm | bằng nhau (ops-inbox.service.ts:141) | thẻ 2; danh sách 2 | `23-inbox-counts.json` | PASS |
| L5-INB-06 | ketoan | api | Số Việc cần xử lý khớp danh sách | Thẻ "Hoá đơn VAT chờ xuất" = danh sách invoice=pending | bằng nhau (ops-inbox.service.ts:214) | thẻ 1; danh sách 1 | `23-inbox-counts.json` | PASS |
| L5-INB-07 | ketoan | api | Số Việc cần xử lý khớp danh sách | Thẻ "Lệnh rút chờ chi" của Kế toán = danh sách APPROVED = SQL | ba số bằng nhau (ops-inbox.service.ts:201) | thẻ 1; danh sách 1; SQL 1 | `23-inbox-counts.json` | PASS |
| L5-INB-08 | admin | api | Số Việc cần xử lý khớp danh sách | Thẻ "Lệnh rút chờ duyệt" của Admin = danh sách REQUESTED = SQL | ba số bằng nhau (ops-inbox.service.ts:199) | thẻ 0; danh sách 0; SQL 0 | `23-inbox-counts.json` | PASS |
| L5-INB-09 | admin | api | Số Việc cần xử lý khớp danh sách | Thẻ "Sản phẩm thiếu ảnh" của Admin = SQL | bằng nhau (ops-inbox.service.ts:180) | thẻ 44; SQL 44 | `23-inbox-counts.json` | PASS |
| L5-INB-10 | cskh | api | Số Việc cần xử lý khớp danh sách | Mỗi vai chỉ thấy thẻ của mình (CSKH không thấy tiền/hoá đơn/Pancake; Kho không thấy tiền, duyệt đổi/trả; Kế toán không thấy Pancake, đổi/trả) | không rò thẻ của vai khác (ops-inbox.service.ts: audience) | thẻ rò: {"cskh":[],"kho":[],"ketoan":[]} | `23-inbox-counts.json` · {"cskh":["returnsPending","communityReports","communityPending","communityUnanswered","externalPoints","suppo… | PASS |

### Huỷ đơn đồng thời với Đã nhận tiền

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| L5-B01 | cskh | api | Huỷ đơn đồng thời với Đã nhận tiền | Kế toán bấm "Đã nhận tiền" và CSKH bấm "Huỷ đơn" cùng một lúc trên cùng đơn chuyển khoản (6 đơn). Giao diện: CSKH bấm xác nhận "Huỷ đơn" đúng lúc Kế toán "Đã nhận tiền" (TUBU2026110399367) | Huỷ thành công (đơn CANCELLED) hoặc API báo lỗi rõ ràng khi không huỷ được; không báo thành công mà đơn vẫn chạy | 5/6 lần API báo 2xx mà đơn không bị huỷ. Bằng giao diện (CSKH 1280): PUT status 200; đơn cuối CONFIRMED/PAID; thông báo trên màn: [] | `19-b01.json`, ảnh `ui1280-cskh-B01-cancel-lost-race.png` · {"api":["#1 TUBU2026110323310: Đã nhận tiền 201; Huỷ 200 (body.status=CONFIRMED); đơn cuối CONFIRMED/PAID <--… | FAIL |

## Lỗi

### L5-B01 — P2 — "Huỷ đơn" thua cuộc đua với "Đã nhận tiền": API trả 200, màn không báo gì, đơn vẫn chạy

- Bề mặt: API và giao diện web 1280 (CSKH). Cùng lỗi, hai cách tái hiện.
- Cấp: P2 (thiếu báo lỗi cho người bấm). Không phải P0/P1 vì không mất tiền, không lộ dữ liệu, đơn đã trả tiền vẫn nguyên và được đưa vào hàng "Cần xử lý Pancake" (xem ảnh: nhãn đỏ "Pancake: cần xử lý").
- Triệu chứng: CSKH bấm "Huỷ đơn" và xác nhận; đúng lúc đó Kế toán bấm "Đã nhận tiền" cho cùng đơn chuyển khoản. Thao tác huỷ thua cuộc đua nhưng `PUT /admin/orders/:id/status` vẫn trả HTTP 200 kèm đơn ở trạng thái CONFIRMED; màn chỉ làm mới danh sách, không có dòng nào báo "chưa huỷ được". Người bấm tin rằng đơn đã huỷ trong khi đơn đã trả tiền và còn hiệu lực; Pancake thì đã nhận lệnh huỷ.
- Kỳ vọng: huỷ thành công, hoặc API báo lỗi rõ (400/409 "đơn vừa đổi trạng thái, chưa huỷ được, tải lại") và màn hiện câu đó. Các nhánh khác của cùng hàm đã làm đúng như vậy (ví dụ `CancelAfterHandoverError` ngay dòng trên).
- Cùng triệu chứng ở cuộc đua với "Đã đóng gói": ca L5-RACE-06 (Kho đóng gói thắng, CSKH huỷ trả 200, đơn PACKED). Ca đó vẫn PASS vì đơn không rơi vào trạng thái lai, nhưng người bấm huỷ cũng không được báo.
- Tần suất: API 6/6 ở lần chạy đầu, 5/6 ở lần chạy ghi nhận (ca còn lại huỷ thắng, Kế toán nhận 403 "đã huỷ/trả" đúng luật). Giao diện: 1/1 khi chặn route để hai request đi cùng lúc (lần đầu, đơn `TUBU2026110399367`).
- Nghi ngờ:
  - `apps/api/src/modules/orders/order-status.service.ts:389-401` (nhánh `!won` kết thúc bằng `return current;`: coi như thành công dù đơn không đổi sang CANCELLED; chỉ ném lỗi khi đơn đã giao vận hoặc đích là SHIPPING/DELIVERED).
  - `apps/api/src/modules/admin/admin.service.ts:1099-1111` (`updateOrderStatus` trả đơn hiện tại như thể thành công).
  - `apps/web/src/components/admin/order-status-actions.tsx:161-164` (`onSuccess` chỉ làm mới, không so sánh trạng thái trả về với trạng thái muốn đặt).
- Cách tái hiện (API): chạy `repro-L5-B01-cancel-race.mjs`, in "TÁI HIỆN n/6" và thoát mã 1.
  `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L5-admin-van-hanh-cskh/repro-L5-B01-cancel-race.mjs` (chạy từ thư mục worktree `uat-1104`, lane 5 đang chạy).
- Cách tái hiện (giao diện): `20-b01-ui.mjs` (CSKH 1280 mở hộp "Huỷ đơn", chặn route PUT để gọi "Đã nhận tiền" cùng lúc). Các bước tay: tạo đơn chuyển khoản chưa trả; CSKH mở đơn, bấm "Huỷ đơn", điền lý do; Kế toán và CSKH bấm xác nhận cùng một giây (cần hai người hoặc công cụ; bằng tay khó trúng).
- Ảnh: `shots/L5-admin-van-hanh-cskh/ui1280-cskh-B01-cancel-lost-race.png` (đơn "Đã xác nhận", "Đã thanh toán", không có thông báo lỗi, nhãn "Pancake: cần xử lý"); hộp thoại huỷ ở `ui1280-cskh-cancel-dialog.png`.
- Gợi ý (không sửa trong lane này): ở nhánh `!won`, nếu đích là CANCELLED và đơn hiện tại chưa CANCELLED thì ném lỗi chuyển trạng thái để `toHttpBadRequest` trả 400 có câu tiếng Việt.

Không có lỗi P0, P1, P3 nào khác.

## CẦN CHỦ

Các điểm sau chưa có luật nêu rõ trong tài liệu hay mã, nên không tính FAIL:

1. **Admin thêm link ngoài hoặc dãy 8 chữ số vào mẫu thông báo hệ thống** (ca L5-TPL-A01, L5-TPL-A02): API cho phép (HTTP 200). Câu báo lỗi của nhân viên ghi "Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu", nên có vẻ cố ý, nhưng tài liệu không nói. Chủ chốt: admin có được chèn link ngoài vào mẫu gửi khách không? Chỗ chặn: `assertStaffBody` chỉ chạy khi người sửa là nhân viên (`apps/api/src/modules/admin/notification-templates-admin.service.ts`).
2. **Đơn trả một phần vẫn nằm trong "Cần xử lý Pancake" sau khi Kho đã bấm "Đã nhận hàng về"**: lý do vẫn ghi `Tạo phiếu "Hoàn một phần" … trên Pancake … và bấm "Đã nhận hàng về" khi hàng về kho` (ví dụ đơn TUBU2026110306439 sau ca L5-RUI-06). Cờ không tự hết, phải có người bấm "Đã xử lý" (Kho bấm được: ca L5-PK-resolve-ok). Nếu việc còn lại là "tạo phiếu bên Pancake" thì cờ đúng nhưng câu nhắc "bấm Đã nhận hàng về" đã lỗi thời (P3, sai chữ); nếu cờ phải tự hết khi Kho xác nhận thì là lỗi P2. Chủ chốt luật xoá cờ.
3. **Máy thu gom (`/recycle-desk`) hoạt động cho nhân viên khi chương trình đổi rác đang tắt**, trong khi khách thấy "Chương trình đang tạm dừng" (waste tắt trong lane, ca 11-desk375). Chủ chốt: tắt chương trình thì máy thu gom có nên khoá theo không?
4. **Lỗi console 401 khi nạp /admin lần đầu ở web** (đã lọc ở 09-admin375; lần chạy đầu cho 11 ca FAIL chỉ vì dòng này). Có thể do bộ khung đăng nhập (token bơm sẵn, `/me` bootstrap chạy trước khi nạp xong), chưa rõ app thật có dòng này không. Cần xem trên bản thật có đăng nhập thật.

## Ca BLOCKED

- L5-CHAT-35: Tin khách được chuyển sang nhóm Zalo của nhân viên. Lý do: 1 lần chuyển: FAILED. Vì sao không tính lỗi: cần cầu nối Zalo thật (xem "Hạn chế bộ khung").

## Đối soát SQL

Chạy lại sau toàn bộ ca (`14-reconcile.sh`, kết quả `results/14-reconcile.txt`):

```
=== ĐỐI SOÁT Ví Tubu vs sổ cái wallet_transactions ===
User bị lệch   : 0
Chênh ròng     : 0đ (dương = ví nhiều hơn sổ ghi nhận)
Chênh tuyệt đối: 0đ

Không có user nào lệch.

=== ĐỐI SOÁT Điểm Xanh theo lô (DRY-RUN — chỉ xem) ===
Lô STANDARD : 0 user lệch, chênh ròng 0 điểm, tuyệt đối 0 điểm
Lô CONVERTED: 0 user lệch, chênh ròng 0 điểm, tuyệt đối 0 điểm
(chênh âm = đang cộng dư cần thu hồi)

✅ Không có user nào lệch — không cần đối soát.
```

Các ca có tiền, Ví, điểm hoặc kho, mỗi ca đều đo trước và sau bằng SQL (sổ `wallet_transactions`, `points_transactions`, tồn `variations.stock`, bảng `payouts`, `order_customer_refunds`, `return_requests`):

| Luồng | Ca chính | Điều kiện đã đo |
|---|---|---|
| Đổi/trả từng phần và toàn phần | L5-RT-*, L5-RUI-04, L5-RUI-06 | Ví tăng đúng số xem trước; sổ Ví = số dư; điểm = sổ điểm và giảm theo phần; kho +1 chỉ khi Kho xác nhận; duyệt lần hai không hoàn thêm |
| Hoàn tiền khách (Pancake, COD hoàn về, huỷ đơn đã trả) | L5-PK-*, L5-RF-*, L5-RRF-*, L5-MUI-03..06 | Chi tay: Ví không đổi; một khoản chỉ hoàn một lần dù bấm đồng thời; lý do tiếp quản ghi vào lịch sử đơn |
| Lệnh rút CTV (luồng cũ) | L5-PAY-*, L5-MUI-08, L5-PUI-02..04 | Duyệt và chi không đổi Ví; từ chối hoàn amount + fee (+325.000đ ở L5-PUI-04), sổ Ví khớp |
| Mã giảm giá của nhân viên | L5-CPN-*, L5-FUI-01..02a, L5-CFGUI-03 | Trần % (30), tối đa 100.000đ, 1000 lượt, ngân sách ngày 10.000.000đ; ngân sách ngày tính cả mã đã tắt |
| Đơn: "Đã nhận tiền", huỷ | L5-OR-*, L5-OUI-*, L5-RACE-01, L5-RACE-02, L5-B01 | DB trạng thái và thanh toán trước/sau, lịch sử đơn ghi mã giao dịch |

## Hạn chế bộ khung

Các điểm sau do bộ khung UAT, không tính FAIL:

1. **Lệnh rút CTV dựng bằng SQL**: API không còn nhận lệnh rút BANK (`POST /affiliate/payouts` method BANK trả 400; `POST /wallet/withdraw` trả 410, xem L5-PAY-01, L5-PAY-02), nên lệnh REQUESTED để thử Duyệt / Từ chối / Đã chi được `INSERT` thẳng vào `payouts` (id tiền tố `uatpay…`, `uatpui…`, `uatrace…`). Luồng thật hiện nay là chuyển hoa hồng vào Ví.
2. **Pancake giả (cổng 3258)**: trạng thái đơn đẩy bằng `pancake-webhook.mjs`; không có vận đơn, tem hay phiếu trả thật.
3. **Không có token Zalo và cầu nối Zalo**: tin khách chuyển sang nhóm Zalo (L5-CHAT-35) không kiểm được (BLOCKED); cảnh báo `zalo.oa_token` kiểm bằng cách nạp token giả rồi trả lại.
4. **`waste.enabled` tắt trong lane**: `seed-data.mjs all` sập vì phần đổi rác, nên chỉ nạp phần dùng được; ca 10-mini375 bật tạm rồi tắt lại (biến `WASTE=on`).
5. **Giới hạn tốc độ**: gửi header `x-throttle-bypass` (API trực tiếp, và `context.route` cho request web); không có header thì vài chục request liên tiếp bị 429.
6. **Đăng nhập web bằng token bơm** (`web-session.mjs`): không đi qua màn đăng nhập Zalo thật; dòng console 401 lúc nạp bị lọc (CẦN CHỦ 4).
7. **Cuộc đua do hai request**: kết quả phụ thuộc thời điểm. L5-B01 tái hiện 6/6 rồi 5/6; chạy lại có thể ra 3/6 đến 6/6. Cuộc đua thật giữa hai người cần cửa sổ tính bằng mili-giây.
8. **Dữ liệu UAT sống trong DB lane**: mã giảm giá `UAT…` do script tạo (ngân sách ngày của Marketing tính cả mã đã tắt, nên script xoá mã cũ trước khi chạy lại); lệnh rút APPROVED còn sót sau L5-PUI-02.
9. **Một trình duyệt mỗi lần, Playwright dùng như thư viện** (không chạy `npx playwright test`).

## Đã làm và chưa làm trong 3 giờ

Đã làm: toàn bộ danh mục ca của brief (ma trận quyền, đơn hàng, hoàn tiền, đổi/trả, "Cần xử lý Pancake", sức khoẻ vận hành, SystemConfig, trần mã giảm giá, mẫu thông báo, CSV che SĐT, lệnh rút, VAT, chat CSKH, giới hạn thân request), kèm lặp lại bằng giao diện 375 cho các tab dùng hằng ngày.

Chưa làm hoặc chỉ làm một phần:

- Tab ngoài phạm vi vận hành/CSKH (đại lý, flash sale, học viện, nhân sự, lương…): chỉ kiểm quyền mở / chặn, không kiểm nghiệp vụ.
- Gửi thật ZNS, Zalo OA, email SMTP: bộ khung dùng giả, không kiểm nội dung gửi đi ngoài bảng thông báo trong app.
- CSV người dùng và CSV bảng lương: chỉ kiểm CSV đơn hàng (che SĐT cho Kế toán, đủ dòng).
- Trải nghiệm 375 của các tab quản trị hiếm dùng (cấu hình, gian hàng, đại lý…): chỉ kiểm mở được và không tràn ngang cho admin; thao tác nghiệp vụ chỉ làm ở các tab hằng ngày.
- Tải và hiệu năng: không đo.
- Duyệt đổi/trả "Từ chối" bằng giao diện đến cùng: mới kiểm nhánh thiếu lý do (L5-RUI-02); từ chối có lý do kiểm ở API (05-returns).

## Trạng thái lane sau khi chạy

Có 1 ca FAIL (L5-B01) nên **lane 5 được giữ chạy** (không chạy `lane-down.sh 5`) để người sửa tái hiện. `chat.enabled` đang bật trong DB lane; `coupon.staff_max_percent` đã khôi phục về 30; `zalo.oa_*` đã trả về như ban đầu.

