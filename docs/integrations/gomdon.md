# Tích hợp Gomdon: đối chiếu hợp đồng API

Gomdon là đơn vị trung gian ta dùng để tạo **vận đơn đổi hàng BestExpress** cho đơn mang `wasteRequestId`:
đơn gắn với yêu cầu Đổi rác cách Thu kèm đơn (PICKUP) đang mở của khách. Bưu tá lấy hàng ở kho Tubu, giao
cho khách và nhận lại rác tái chế trong cùng một chuyến. Checkout không còn ô "gửi lại vật liệu tái chế"
hay ghi chú tự do: khách bật công tắc "Thu kèm rác" cho yêu cầu Thu kèm đơn của mình. Khách chỉ thấy đường
này khi `waste.enabled`, `waste.lane_pickup_enabled` và công tắc Gomdon (`shipping.gomdon.recycling_enabled`,
kèm tài khoản Gomdon) cùng bật. Điểm Xanh chỉ được cộng khi kho đếm hàng thu về.

- **Code:** `apps/api/src/modules/integrations/gomdon/`.
- **Nguồn đối chiếu:** bản đầu là tài liệu Postman công khai "GOMDON API" do chủ shop gửi
  (`https://documenter.getpostman.com/view/3261770/2s8Z76w9cj`), bản xuất bản ngày 10/01/2023, đối chiếu
  ngày 27/09/2026. Từ W168 (15/11/2026) hợp đồng theo **tài liệu API v2 chính thức ngày 27/10/2026** của
  Gomdon: địa chỉ 2 cấp (`/order/check-address`), `/order/shop-fee`, `duplicate:true`, webhook ký HMAC
  (`X-Gomdon-Timestamp`/`X-Gomdon-Signature`, `event_id`) và `/auth/user/update` để đăng ký webhook. Các mục
  dưới đây nêu rõ chỗ nào đã đổi theo bản này.
- **Không** gọi thử API thật nào của Gomdon, vì ta chưa có tài khoản và tạo đơn là đặt bưu tá thật. Mọi
  kiểm chứng dưới đây là đọc tài liệu và chạy test có mock.
- Repo **không** giữ bản sao tài liệu của Gomdon. Muốn xem nguyên văn thì mở link trên.

## 1. Tài liệu có gì, không có gì

Tài liệu mô tả sáu API và một mục webhook:

| API | Ta dùng? |
|---|---|
| Đăng nhập lấy token | Có |
| Tạo đơn | Có (đơn đổi hàng) |
| Huỷ đơn | Có |
| Cập nhật đơn (tên hàng, giá trị, COD, dịch vụ, cân nặng, kích thước) | Chưa dùng |
| Sửa địa chỉ đơn (gửi, nhận hoặc hoàn) | Chưa dùng |
| Kiểm tra địa chỉ 2 cấp (`/order/check-address`) | Có: `GomdonClient.checkAddress`, cache hợp lệ 24 giờ, không chặn khách khi lỗi hạ tầng |
| Tạm tính phí vận chuyển (`/order/shop-fee`) | Có: `GomdonClient.quoteShopFee`/`quoteShopFeeDetailed`, rơi về 25.000đ ước lượng khi không hỏi được |
| Đăng ký webhook (`/auth/user/update`, trường `webhook_url`) | Có: `GomdonClient.registerWebhookUrl`, chỉ https, log che secret |
| Webhook đổi trạng thái (bảng mã, payload, chữ ký, cách gửi lại) | Có |

Tài liệu **không có**:

- API xem chi tiết hay tra hành trình một đơn, dù theo mã số Gomdon hay theo `order_customer_id`;
- môi trường sandbox/test riêng: chỉ có một địa chỉ, `https://admin.gomdon.com.vn`.

Bản 27/10/2026 có thêm chữ ký webhook và API tự đăng ký webhook (mục 3 và 2.7); bản 2023 chỉ ghi "liên hệ
quản trị Gomdon".

Hệ quả cho thiết kế:

1. **Không kiểm lại được trạng thái** trước khi chuyển đơn sang DELIVERED. Không có API để hỏi lại nên
   không thêm `GomdonClient.getOrder`. Chốt chặn còn lại nằm ở mục 4.
2. **Cron cứu hộ không tra được đơn kẹt.** Đơn kẹt `CREATING`/`NEEDS_MANUAL_CHECK` không tra được theo
   `order_customer_id`. Code vẫn giữ nguyên tắc cũ: không bao giờ tự tạo lại, chờ webhook tự lành hoặc chờ
   người kiểm tay.
3. **Webhook mất là mất.** Gomdon gửi lại tối đa 3 lần, rồi bỏ (mục 3). Không có API nào để đối soát lại.

## 2. Bảng hợp đồng

Ghi chú trạng thái:

- **đã khớp**: code đúng như tài liệu.
- **đã sửa**: code lệch tài liệu và đã sửa trong đợt này.
- **tài liệu không nói**: code đang theo giả định, xem mục 5.

### 2.1. Chung

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Địa chỉ gốc | `https://admin.gomdon.com.vn`, mọi API nằm dưới `/api/v2/` | `GOMDON_PRODUCTION_BASE_URL`. Ở production, `GOMDON_BASE_URL` trống thì dùng địa chỉ này. Ở dev/test trống thì coi như tắt | đã khớp |
| Sandbox | Không có | `GOMDON_BASE_URL` chỉ để trỏ sang môi trường Gomdon cấp riêng, nếu có. Không đặt sẵn URL thử nào | tài liệu không nói |
| Xác thực | Header `Authorization: Bearer <token>` | `Authorization: Bearer ${token}` | đã khớp |
| Kiểu body | Postman để kiểu form-data | `FormData` qua axios 1.16, ra `multipart/form-data`. Đã kiểm cục bộ bằng server giả | đã khớp |
| Định dạng lỗi | Lỗi validate/nghiệp vụ: **HTTP 200** + `result:false` + `message`. Thông điệp validate là câu mặc định của Laravel, tiếng Anh. Token sai hoặc thiếu: **HTTP 401** | `result:false` bị coi là "chắc chắn chưa tạo", được retry. 401 thì đăng nhập lại một lần | đã khớp |
| Giới hạn tần suất | Header mẫu có `X-RateLimit-Limit: 600`. `/order/check-address`: 120 lượt/phút | Tạo đơn: không chủ động giới hạn, 429 bị coi là "chưa tạo", được retry. Check-address: cache kết quả hợp lệ 24 giờ theo `tỉnh|phường` và giới hạn nội bộ 100 lượt/phút, vượt thì bỏ qua bước kiểm tra (`skipped`) thay vì chặn khách | đã khớp (check-address); tạo đơn: tài liệu không nói khung thời gian |

### 2.2. Đăng nhập: `POST /api/v2/auth/login`

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Body | Form-data gồm `phone` và `password`, cả hai bắt buộc | Gửi đúng hai trường này, lấy từ env `GOMDON_PHONE`/`GOMDON_PASSWORD` | đã khớp |
| Token | `data.access_token`, dạng Laravel Sanctum `id\|chuỗi`, kèm `token_type: "Bearer"` | Đọc `data.access_token` | đã khớp |
| Thời hạn | `data.expires_at`, mẫu là `null` (token không tự hết hạn). **Không có** `expires_in` | Trước: đọc `expires_in`, trường này không tồn tại nên luôn cache 24 giờ. Nay: đọc `expires_at`. `null` thì giữ tối đa 24 giờ. Có thời điểm thì đăng nhập lại trước hạn 5 phút, vẫn không quá 24 giờ | **đã sửa** |
| Sai tài khoản | HTTP 401 + `{result:false, message, data:null}` | Ném lỗi kèm thông điệp Gomdon. Tạo đơn nhận lỗi này là "chắc chắn chưa tạo" | đã khớp |

### 2.3. Tạo đơn: `POST /api/v2/order/create`

| Trường gửi | Tài liệu | Code gửi | Trạng thái |
|---|---|---|---|
| `type` | 1 giao hàng, 2 thu hồi, 3 đổi hàng. Bắt buộc | `3` (đổi hàng) | đã khớp |
| `pickup_type` | 1 là shop tự mang ra bưu cục, 2 là nhân viên tới lấy tại địa chỉ gửi. Bắt buộc | `2`: bưu tá tới kho | đã khớp |
| `service_id` | 12491 giao tiết kiệm, 12490 giao nhanh (số sau chỉ ghi trong mô tả mẫu). Bắt buộc | `12491` | đã khớp |
| `order_customer_id` | Có trong request mẫu, với ghi chú "dùng để check unique". Không có trong bảng trường | `order.code`, ví dụ `TUBU…`. Admin "Tạo lại vận đơn" sau khi Gomdon huỷ vận đơn cũ (mã 2) thì gửi `TUBU…-R1`, `-R2`… (`Order.gomdonAttempt`), vì mã cũ đã bị dùng. Đường tạo lại từ `NEEDS_MANUAL_CHECK` vẫn gửi mã cũ để Gomdon chặn trùng giúp | đã khớp. Ý nghĩa "duy nhất" được xử lý ở dòng "Trùng mã đơn" của bảng 2.4. Gomdon có nhận hậu tố `-R{n}` không: chưa kiểm chứng (mục 5) |
| `product_name` | Chuỗi, bắt buộc | Danh sách sản phẩm, cắt 250 ký tự | đã khớp |
| `product_price` | Giá trị gói hàng, VND | `order.total` | đã khớp |
| `product_number` | Số kiện | `1` | đã khớp |
| `collect_amount` | Tiền thu hộ, VND. Ví dụ lỗi ở API cập nhật cho thấy COD chỉ nhận từ 0 đến 5.000.000 | COD chưa trả thì gửi `order.total`, còn lại gửi `0`. Checkout chặn COD khi một đơn (một kiện) trên 5 triệu, xét từng đơn sau khi tách theo nơi giao | đã khớp |
| `weight` | **Gram**, số nguyên | Tổng `Variation.weight` (kiểu Int) nhân số lượng, thiếu thì lấy 500 g, chặn ở trần 10.000 g một kiện (`recyclingParcel` trong `gomdon-weight.ts`) | đã khớp |
| `width` / `height` / `length` | **Milimét** | `0`, không khai kích thước, giống mẫu | đã khớp |
| `note` | Ghi chú trên bưu kiện | `Đơn đổi hàng thu gom tái chế (~<kg khách khai, không có thì bằng mức tối đa>kg, tối đa <kg>kg)` rồi chi tiết thu gom sau " - " (`recyclingNoteDetail`). Số kg khai lấy từ `Order.recyclingWeightGrams`; "tối đa" là cân hàng của đơn, chặn ở 10 kg | đã khớp |
| `source_province/ward/address/phone/name` | Địa chỉ 2 cấp sau sáp nhập 2025: tỉnh/thành + phường/xã; quận/huyện không còn bắt buộc và nên bỏ trống | Lấy từ kho `shipping.gomdon.config.defaultWarehouse` (mặc định: Số 33, đường 1B, Phường Long Bình, Thành phố Hồ Chí Minh). **Không gửi** `source_district`; `district` còn trong cấu hình cũ bị bỏ qua | **đã sửa** (W168) |
| `dest_province/ward/address/phone/name` | Như trên, người nhận | `dest_*` lấy từ ảnh chụp địa chỉ của đơn. **Không gửi** `dest_district` (trước đây gửi tạm tên phường) | **đã sửa** (W168) |

### 2.4. Kết quả tạo đơn

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Thành công | HTTP 200, `result:true`, `data` là đơn vừa tạo. Gomdon trả lại các trường đã gửi dưới dạng chuỗi, kèm phí, `status: 1` và `created_time` (unix giây) | Đọc `data` | đã khớp |
| Mã số đơn Gomdon | `data.id`, là số. Đây cũng là id trong đường huỷ, và là `order_id` của webhook | Lưu `gomdonOrderId = String(id)` | đã khớp |
| Mã vận đơn | `data.partner_code`, chuỗi số khoảng 14 chữ số. Cùng dạng với `order_code` trong webhook | Lưu `gomdonPartnerCode` và `shippingCode` | đã khớp |
| `data.code` | Mã **nội bộ** Gomdon, dạng `<id>-<mã user>-<tên>`. **Không phải** vận đơn | Trước: thiếu `partner_code` thì lưu `code` làm mã vận đơn, nên webhook không bao giờ khớp và khách thấy sai mã. Nay: không dùng `code`. Thiếu `partner_code` mà có `id` thì tạm lưu `id`, để ghi chú Pancake vẫn báo "ĐÃ CÓ VẬN ĐƠN"; webhook mang `order_code` tới sẽ thay mã tạm này. Không có cả `id` lẫn `partner_code` thì chuyển `NEEDS_MANUAL_CHECK` | **đã sửa** |
| Lỗi validate | HTTP 200 + `result:false`, ví dụ "The source province field is required." | `GomdonRejectedError`: chắc chắn chưa tạo. Lỗi dữ liệu cố định: thử 3 lần rồi `FAILED`, kho tạo tay | đã khớp |
| Lỗi tạm trước khi tạo | Tài liệu không nói | Đăng nhập lỗi (kể cả sai tài khoản), HTTP 429/503, lỗi mạng trước khi gửi: `GomdonRejectedError` có cờ `transient`. Job thử 8 lần, backoff 5 giây tăng dần (khoảng 10 phút). Hết lượt mà đơn còn trong 60 phút đầu (tính từ lúc thanh toán được) thì **không** chốt `FAILED`: cron 10 phút xếp lại. Quá 60 phút mới `FAILED` và báo tạo tay | **đã sửa** (UAT GOMDON-1) |
| Gomdon từ chối tài khoản | Tài liệu không nói | Đăng nhập trả 4xx (trừ 429) hoặc `result:false` thì ghi nhận "từ chối tài khoản" (bộ nhớ của process API). Lựa chọn thu gom ở checkout tự ẩn, không đăng nhập lại trong 60 giây, cron thử lại mỗi 30 phút. Web admin hiện tình trạng kết nối và có nút "Kiểm tra kết nối" (đăng nhập thật, không tạo đơn) | **đã sửa** (UAT GOMDON-1) |
| Trùng mã đơn, có cờ `duplicate` | Tài liệu 27/10/2026: `order_customer_id` đã có đơn còn hiệu lực → `{result:false, duplicate:true, message:"Đơn hàng đã tồn tại", data:{id}}`; "gửi lại vì mất mạng thì coi là thành công" | `data.id` hợp lệ (số dương hoặc chuỗi khác rỗng/0) → client trả `{result:true, data:{...data, id, partner_code: partner_code ?? order_code, status: status ?? 1}}`, `pushOrder` lưu `gomdonOrderId = String(id)` (mã vận đơn tạm = id, webhook `order_code` nâng cấp sau) và đi tiếp như tạo thành công. `duplicate:true` mà không có id → `GomdonDuplicateOrderError` → `NEEDS_MANUAL_CHECK` như dòng dưới | **đã sửa** (W168) |
| Trùng mã đơn, thông điệp không kèm cờ | `order_customer_id` dùng để kiểm tra trùng. Bản 2023 không in thông điệp lỗi khi trùng | Trước: coi là "chắc chắn chưa tạo". Sau 5 lần retry, đơn thành `FAILED` và báo kho **tạo vận đơn tay**, trong khi Gomdon đã có đơn: giao trùng. Nay: thông điệp dạng "already been taken", "đã tồn tại", "bị trùng"… ra `GomdonDuplicateOrderError`. Đơn chuyển `NEEDS_MANUAL_CHECK`, không retry, báo "ĐÃ CÓ đơn… KHÔNG tạo vận đơn tay" | **đã sửa** (mẫu thông điệp: tài liệu không nói) |
| Timeout, 5xx, rớt kết nối | Tài liệu không nói | `GomdonAmbiguousError`, chuyển `NEEDS_MANUAL_CHECK`, không retry | tài liệu không nói |

### 2.5. Huỷ đơn: `POST /api/v2/order/cancel/{id}`

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Đường dẫn, phương thức | `POST /api/v2/order/cancel/{id}`, `id` là mã số đơn Gomdon (`data.id`), body form rỗng | `/api/v2/order/cancel/${gomdonOrderId}` với `FormData` rỗng | đã khớp |
| Điều kiện | Chỉ huỷ được đơn **chưa lấy hàng** | Không gọi API khi Gomdon đã báo lấy hàng (mã khác 1/2/10): chuyển `TOO_LATE` và báo CSKH | đã khớp |
| Kết quả | Luôn HTTP 200: `{result:true, message:"Hủy đơn hàng thành công"}` hoặc `{result:false, message:"Không tìm thấy đơn hàng"}` | Chỉ coi là huỷ xong khi `result:true`. "Không tìm thấy" thì `FAILED` ngay, không thử lại, báo kiểm tra trên cổng Gomdon. Lỗi khác thì job thử 8 lần (khoảng 10 phút), hết lượt thì `FAILED` và báo huỷ tay; cron thử huỷ lại mỗi 30 phút trong 6 giờ nếu vận đơn còn mã 1/10. CSKH huỷ tay xong thì bấm "Đã xử lý tay" (`gomdonCancelStatus = MANUAL_HANDLED`), đơn rời hàng đợi | đã khớp. **Đã sửa** phần thử lại và xử lý tay (UAT GOMDON-1, GOMDON-9) |

### 2.6. Tra cứu đơn

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Xem chi tiết hoặc hành trình theo id hay `order_customer_id` | **Không có** | Không có `getOrder`. Không kiểm lại trước DELIVERED, không tra đơn kẹt (mục 4) | tài liệu không nói |

### 2.7. Webhook

| Hạng mục | Tài liệu | Code | Trạng thái |
|---|---|---|---|
| Đăng ký | `POST /auth/user/update` với `webhook_url` (HTTPS); muốn tắt thì liên hệ Gomdon | `GomdonClient.registerWebhookUrl(url)`: chỉ nhận https, 401 đăng nhập lại 1 lần, log và thông báo lỗi chỉ in URL đã che (`.../gomdon/***`, query thành `?***`). Mục 3 | **đã sửa** (W168) |
| Chữ ký | Header `X-Gomdon-Timestamp` (unix giây) + `X-Gomdon-Signature` = HMAC-SHA256-hex của `"<timestamp>.<thân thô>"`, khoá là `webhook_secret` Gomdon cấp; từ chối khi sai chữ ký hoặc lệch quá 300 giây | Xác thực KÉP, chấp nhận khi một trong hai hợp lệ: (a) chữ ký, khoá = `GOMDON_WEBHOOK_HMAC_SECRET` (không đặt thì dùng `GOMDON_WEBHOOK_SECRET`), thân thô lấy từ `req.rawBody` do `common/body-limits.ts` giữ cho mọi `/api/webhooks/*` ngoài Pancake; so `timingSafeEqual` sau khi so độ dài; (b) token `x-webhook-token` / `/<secret>` / `?token=` so với `GOMDON_WEBHOOK_SECRET`. Chữ ký sai/lệch giờ mà không có token đúng → 401. Production chưa đặt secret nào → chặn hết. Webhook multipart không có thân thô nên chỉ xác thực được bằng token | **đã sửa** (W168) |
| `event_id` | Mã sự kiện, giữ nguyên qua các lần gửi lại, dùng để bỏ qua sự kiện đã xử lý | Khoá chống trùng là `event:<event_id>`; không có `event_id` thì giữ khoá cũ `order_id|status|created_time` | **đã sửa** (W168) |
| Kiểu body | Mẫu là JSON | Nhận JSON, urlencoded và `multipart/form-data` (kiểu Gomdon dùng cho mọi API của họ; không nhận file, tối đa 60 trường × 4 KB). Mọi trường đều ép kiểu từ chuỗi. Token đúng mà body không đọc được (thiếu `status`) thì trả **400** để Gomdon gửi lại, ghi lỗi kết nối và báo động (tối đa 1 lần/10 phút mỗi Content-Type, chỉ ghi tên trường, không ghi giá trị) | tài liệu không nói (Content-Type). **Đã sửa** multipart (UAT GOMDON-6) |
| Giới hạn tần suất | Không nhắc tới | Hai route webhook **không** bị throttle (`@SkipThrottle`): đã có token chia sẻ, và Gomdon chỉ gửi lại 3 lần nên một lần 429 là mất event | **đã sửa** (UAT GOMDON-5) |
| `order_id` | Mã số đơn Gomdon | Khớp `gomdonOrderId` | đã khớp |
| `order_code` | "Mã vận đơn". JSON mẫu để dạng **số** | Ép thành chuỗi rồi khớp `gomdonPartnerCode`. Có test với số 14 chữ số | đã khớp |
| `order_customer_id` | Mã đơn của khách hàng Gomdon, tức mã đơn của ta. JSON mẫu để dạng số | Ép chuỗi, bỏ hậu tố `-R{n}` khi so với mã đơn, dùng để **đối chiếu chéo** và tự lành, không bao giờ là khoá khớp duy nhất. Tự lành chỉ khớp đơn có đúng `gomdonAttempt = n` | đã khớp |
| `status` | Mã 1–12 | Mục 2.8 | đã khớp |
| `created_time` | "Thời gian thay đổi", kiểu int. Mẫu `1657245696` là unix **giây**. Ở response tạo đơn, `created_time` trùng đúng `created_at` | Đọc unix giây. Vẫn nhận mili-giây và chuỗi ngày cho an toàn. Dùng cho khoá chống trùng và chống lùi trạng thái | đã khớp |
| Cân nặng, kích thước | `weight` tính gram. `height`, `width`, `length` tính mm | Chỉ khai báo kiểu, không dùng | đã khớp |
| Phí | `customer_total_fee`, `customer_delivery_fee`, `customer_cod_fee`, `customer_insurance_fee` (VND) | Chỉ khai báo kiểu, chưa lưu hay đối soát | đã khớp (chưa dùng) |
| `product_price`, `collect_amount` | Có trong payload | Chưa dùng | đã khớp (chưa dùng) |
| `tracking_link` / `tracking_url` | **Không có** trong payload | Trước: đọc và lưu vào `trackingLink`, tức nút "Tra cứu hành trình" của khách. Nay: bỏ, không lưu link ngoài hợp đồng | **đã sửa** |
| Phản hồi | Gomdon coi **HTTP 200** là nhận thành công | Cả hai route trả 200 (`@HttpCode(200)`, có test) | đã khớp |
| Gửi lại | Không nhận được 200 thì gửi lại sau 30 giây, **tối đa 3 lần** | Chỉ trả khác 200 khi chưa lưu được event (DB lỗi) hoặc sai secret (401). Hệ quả xem mục 3 | đã khớp |

### 2.8. Bảng mã trạng thái

| Mã | Ý nghĩa (tài liệu) | Code xử lý |
|---|---|---|
| 1 | Tạo đơn thành công | Ghi trạng thái, chưa đổi đơn |
| 2 | Đơn bị huỷ | Mốc cuối. Đơn đã huỷ thì chốt `gomdonCancelStatus = CANCELLED`. Đơn còn hiệu lực thì báo CSKH |
| 3 | Đã lấy hàng | Đơn `CONFIRMED`/`PACKED` sang `SHIPPING`. Kể từ mã này không huỷ qua API được nữa |
| 4 | Đang chuyển tới bưu cục nhận | Như mã 3 |
| 5 | Đang đi giao | Như mã 3 |
| 6 | Đang chuyển hoàn | Báo CSKH. Không tự hoàn tiền |
| 7 | Giao thành công | Chuyển `DELIVERED` nếu đơn `CONFIRMED`/`PACKED`/`SHIPPING` và là COD hoặc đã PAID. Không đủ điều kiện thì chỉ báo CSKH. Mốc cuối |
| 8 | Đã hoàn hàng | Báo CSKH. Mốc cuối |
| 9 | Hỏng hoặc mất hàng | Báo CSKH. Mốc cuối |
| 10 | Lấy hàng không thành công | Báo CSKH. Vẫn huỷ qua API được |
| 11 | Giao thất bại | Báo CSKH. Cùng bậc với mã 5 vì có thể giao lại |
| 12 | Hoàn hàng thất bại | Báo CSKH |

- GomdonClient, hàng đợi, webhook, `WAIT_GOMDON` và các báo động giữ nguyên, không đổi theo Đổi rác lấy quà.
- Cả 12 ý nghĩa **đã khớp** với `GOMDON_STATUS_TEXT` (API), `apps/web/src/lib/recycling.ts` và
  `apps/miniapp/src/utils/format.ts`. Không cần đổi nhãn nào. Test `bảng mã trạng thái đúng tài liệu
  Gomdon` giữ bảng này.
- Mã nào là mốc cuối, thứ tự chuyển trạng thái ra sao, và bậc chống lùi (`RANK` trong `gomdon-status.ts`)
  là **tài liệu không nói**. Đây là suy luận của ta.

## 3. Đăng ký webhook

1. Tạo secret dài, ngẫu nhiên: `openssl rand -hex 32`. Đặt vào `GOMDON_WEBHOOK_SECRET` trong `.env` trên
   VPS, cùng `GOMDON_PHONE` và `GOMDON_PASSWORD`. Production có tài khoản mà thiếu secret thì API không
   khởi động. Tạo lại container api sau khi sửa.
2. Tự đăng ký URL bằng `GomdonClient.registerWebhookUrl` (API `POST /api/v2/auth/user/update`,
   trường `webhook_url`, chỉ https), dùng URL có secret ở cuối đường dẫn:
   `https://api.tubutree.com/api/webhooks/gomdon/<secret>`. Dạng đường dẫn tốt hơn `?token=<secret>`, vì có
   hệ thống cắt hoặc mã hoá lại query string. Gomdon còn cấp `webhook_secret` để ký `X-Gomdon-Signature`:
   đặt giá trị đó vào `GOMDON_WEBHOOK_HMAC_SECRET` (tuỳ chọn; trống thì chữ ký được kiểm bằng
   `GOMDON_WEBHOOK_SECRET`). Chữ ký và token chạy song song nên đơn không rớt event dù Gomdon dùng cách nào.
   Muốn tắt webhook thì liên hệ Gomdon, API không có thao tác tắt.
3. Secret nằm trong URL thì log ứng dụng đã che (`apps/api/src/common/filters/redact-url.ts`), nhưng access
   log của Apache vẫn ghi nguyên URL. Hạn chế quyền đọc access log. Nếu log lộ ra ngoài thì đổi secret, và
   báo Gomdon cập nhật URL cùng lúc.
4. Nhờ Gomdon bắn thử một webhook, rồi kiểm:
   `SELECT "status","gomdonStatus","receivedAt","error" FROM "gomdon_webhook_events" ORDER BY "receivedAt" DESC LIMIT 5;`.
   Event của vận đơn không thuộc đơn nào của ta sẽ có trạng thái `IGNORED`. Như vậy là bình thường.
5. **Rủi ro mất event:** Gomdon chỉ gửi lại 3 lần, mỗi lần cách 30 giây. Webhook bị 401 vì sai hoặc thiếu
   secret, bị 400 vì body không đọc được, hoặc API sập quá khoảng 2 phút, thì event **mất hẳn** (route webhook
   không còn giới hạn tần suất nên không còn mất vì 429). Không
   có API tra cứu để kéo lại. Khi nghi có event bị mất (ví dụ sau sự cố, hoặc thấy đơn thu gom đứng yên lâu),
   đối chiếu tay trên cổng Gomdon theo mã đơn. Sau đó cập nhật đơn bằng các nút trong web admin, hoặc nhờ
   Gomdon bắn lại webhook.

## 4. Bảo vệ khi không có API tra cứu

**Chuyển DELIVERED.** Code không hỏi lại được Gomdon, nên dựa vào năm lớp:

1. Secret chia sẻ, được kiểm trước mọi truy vấn DB.
2. Chỉ khớp đơn **có thu gom**, theo `order_id` hoặc mã vận đơn đã lưu từ chính response tạo đơn của ta.
3. Có `order_customer_id` thì mã này phải trùng mã đơn đã khớp.
4. Chỉ DELIVERED khi đơn đang `CONFIRMED`/`PACKED`/`SHIPPING` **và** là COD hoặc đã PAID. Không đủ điều
   kiện thì chỉ báo CSKH.
5. Không lùi trạng thái (`RANK` cộng với `created_time`).

**Đơn kẹt `CREATING`/`NEEDS_MANUAL_CHECK`.** Không tra được theo `order_customer_id`, nên:

- Không bao giờ tự gọi tạo lại (giữ claim và lease 2 phút, cron cứu hộ 30 phút).
- **Không** dùng API tạo đơn để "dò" xem Gomdon đã có đơn chưa. Nếu Gomdon không chặn trùng như tài liệu
  nói, thì mỗi lần dò là thêm một vận đơn thật.
- Tự lành: webhook đầu tiên tới, mang `order_customer_id` trùng mã đơn đang chưa có vận đơn, sẽ điền
  `order_id` và `order_code`, rồi báo "Đã tự khớp vận đơn… KHÔNG tạo vận đơn tay".
- Lớp chặn cuối nằm phía Gomdon: nếu Gomdon thật sự chặn trùng `order_customer_id`, thì lần tạo lại do
  người bấm nhầm ("Tạo lại vận đơn" từ `NEEDS_MANUAL_CHECK`) sẽ bị từ chối. Code coi lỗi đó là "đã có vận
  đơn" (mục 2.4), không phải "tạo tay".

**Hàng đã rời kho trước khi có vận đơn Gomdon.** Đơn đang giao/đã giao, hoặc kho đã đặt hãng khác qua Pancake
(`shippingCode` khác null mà `shippingPartner` khác BestExpress), thì không tạo vận đơn Gomdon nữa: chốt
`FAILED` và báo hẹn thu gom riêng. Điều kiện này nằm cả trong câu `updateMany` claim, nên kho đổi hãng giữa
lúc đọc đơn và lúc claim cũng không lọt (race spec `(h)`).

**Báo động.** Mọi báo động (tạo lỗi, không rõ đã tạo chưa, giao trùng vận đơn, huỷ không được, hàng
hoàn…) được lưu vào bảng `gomdon_alerts` gắn đơn, ngoài log và thông báo in-app cho tài khoản ADMIN. Báo động
cùng nội dung đang mở thì không lưu/gửi lặp (khoá advisory theo đơn, race spec `(i)`). Đơn có báo động chưa
xử lý luôn nằm trong hàng đợi "Cần xử lý thu gom" của web admin, kể cả khi trạng thái vận đơn trông bình
thường. Chi tiết đơn liệt kê từng báo động với nút "Đã xử lý"; "Đã xử lý tay" đóng mọi báo động của đơn.

## 5. Chưa kiểm chứng: cần hỏi Gomdon hoặc thử thật

1. **Thông điệp khi trùng `order_customer_id`**, và việc kiểm trùng có tính cả đơn **đã huỷ** không. Code
   đã tránh trường hợp này bằng hậu tố `-R{n}` khi tạo lại sau mã 2, nhưng **chưa xác nhận Gomdon nhận
   `order_customer_id` có hậu tố** (độ dài, ký tự cho phép).
2. `order_customer_id` có **bắt buộc** không. Trường này không nằm trong bảng trường của tài liệu.
3. Gomdon **có cho đặt header** webhook không. Webhook gửi từ IP nào, và Content-Type là gì (mẫu là JSON;
   code nhận cả JSON, urlencoded và multipart).
4. **Chuỗi trạng thái của đơn đổi hàng (type 3).** Chiều mang vật liệu tái chế về kho được báo trên cùng
   vận đơn (6/8 sau 7?) hay trên vận đơn riêng? Code đang coi 7 là mốc cuối, nên mọi mã tới sau 7 đều bị bỏ
   qua. Nếu Gomdon báo 6/8 **thay cho** 7, CSKH sẽ nhận báo động "chuyển hoàn" nhầm, và đơn không tự
   DELIVERED.
5. **Mốc cuối và thứ tự chuyển mã.** Bảng bậc chống lùi là suy luận của ta (mục 2.8).
6. **Tên địa chỉ.** Tài liệu 27/10/2026 nói địa chỉ chỉ cần tỉnh/thành + phường/xã theo danh mục mới (ví dụ
   "Hà Nội" + "Phường Ba Đình") và `/order/check-address` cho biết Gomdon có nhận diện được không. Code đã bỏ
   `*_district` và có `checkAddress`, nhưng **chưa gọi thật** nên chưa biết Gomdon có chấp nhận tiền tố
   "Thành phố"/"Phường" ở mọi địa chỉ khách nhập không. Kho mặc định đã đổi sang địa giới mới (Phường Long Bình);
   bản ghi `shipping.gomdon.config` trên PROD nếu còn "Thủ Đức" thì bỏ qua `district`, nhưng nên kiểm lại
   `address/ward/province` (UAT GOMDON-7).
7. **Khung thời gian của giới hạn 600 request** của API tạo đơn: mỗi phút hay mỗi giờ (check-address đã biết: 120 lượt/phút).
8. `expires_at` có luôn là `null` không. Token có bị thu hồi khi đăng nhập lại hoặc đổi mật khẩu không.
   Code đã tự đăng nhập lại khi gặp 401, nên chỉ ảnh hưởng số lần đăng nhập.
9. `partner_code` có luôn có ngay trong response tạo đơn không. Code có đường dùng tạm `id` (mục 2.4).
10. Webhook có gửi cho mã 1 không. Có gửi khi đổi phí hay cân nặng mà mã không đổi không. Khoá chống trùng
    gồm `order_id`, `status` và `created_time`.
11. **Địa chỉ hoàn.** Response mẫu cho thấy Gomdon tự đặt địa chỉ hoàn trùng địa chỉ gửi (kho), tức vật liệu
    tái chế sẽ về kho. Đây là suy ra từ một ví dụ, chưa được xác nhận.
12. `order_code` trong webhook là **số JSON**. Mã hiện dài 14 chữ số nên an toàn. Nếu Gomdon đổi sang mã
    dài quá 15–16 chữ số, giá trị sẽ mất chính xác lúc parse JSON.
13. Phí trong webhook (`customer_*_fee`) chưa được lưu hay đối soát với phí dự kiến.
14. **Đăng nhập sai tài khoản** trả HTTP gì. Code coi mọi 4xx (trừ 429) và `result:false` là "từ chối tài
    khoản" và ẩn lựa chọn thu gom tới khi đăng nhập lại được.
15. **"Không tìm thấy đơn hàng" khi huỷ** có luôn là kết quả cuối không (vận đơn đã bị huỷ/xoá phía Gomdon).
    Code không thử lại mà báo CSKH kiểm tra.

## 6. Test giữ hợp đồng

Tất cả dùng mock, không gọi Gomdon thật:

- `gomdon.client.spec.ts`: form đăng nhập, `expires_at`, 401 kèm body mẫu, tạo đơn trả `id`/`code`/
  `partner_code`, form tạo đơn không có key `*_district`, validate `result:false` ra Rejected, trùng mã ra
  Duplicate (không Rejected), `duplicate:true` + `data.id` là thành công (không có id thì Duplicate), huỷ theo id
  số với form rỗng, `checkAddress` (cache 24 giờ bằng đồng hồ giả, không cache kết quả sai, giới hạn 100
  lượt/phút, lỗi mạng không chặn), `quoteShopFee` (thành công, ước lượng 25.000đ), `registerWebhookUrl` (chỉ
  https, log và thông báo lỗi không lộ secret).
- `gomdon-order.service.spec.ts`: body tạo đơn **đủ và chỉ** các trường tài liệu, đơn vị gram/mm, không dùng
  `data.code` làm mã vận đơn, xử lý khi thiếu `partner_code`, trùng mã ra `NEEDS_MANUAL_CHECK` và giữ claim.
- `gomdon-webhook.service.spec.ts`: payload đúng mẫu (`order_code` dạng số, `created_time` tính giây), không
  lưu `tracking_link`, thay mã vận đơn tạm, khoá chống trùng theo `event_id`, sự kiện `created_time` cũ hơn
  không ghi đè, khớp đơn khi create chưa trả `partner_code`.
- `gomdon-webhook.controller.spec.ts`: cả hai route trả HTTP 200, không bị throttle, nhận multipart thật qua
  HTTP và từ chối upload file; xác thực kép (chữ ký đúng/sai/lệch quá 300 giây/độ dài lạ, token đường dẫn,
  header, `?token=`, cả hai, production không secret) và chữ ký trên byte gốc qua HTTP thật với parser của
  `common/body-limits.ts`.
- `gomdon-push.processor.spec.ts`, `gomdon-queue.spec.ts`: lỗi tạm và lỗi cố định, số lần thử của job.
- `gomdon-alert.service.spec.ts`, `test/integration-race/gomdon.race-spec.ts`: báo động lưu DB, không trùng
  khi báo đồng thời; không tạo vận đơn khi hàng vừa rời kho.
- `gomdon-config.spec.ts`: bảng 12 mã trạng thái.
