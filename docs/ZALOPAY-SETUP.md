# 💳 ZaloPay — Hướng dẫn đăng ký & lấy key

> Mục tiêu: lấy `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` để bật thanh toán online.
> **Không bắt buộc cho launch:** code đã gate — thiếu key thì `/payments/zalopay/create` trả **503**, app vẫn chạy COD + Ví bình thường. Có thể bổ sung sau go-live.

## 0. Cách hệ thống dùng key (để hiểu đang lấy cái gì)
| Env | Dùng ở đâu | Vai trò |
|---|---|---|
| `ZALOPAY_APP_ID` | tạo đơn `/create` | định danh merchant |
| `ZALOPAY_KEY1` | ký MAC khi **tạo đơn** (HMAC-SHA256) | bảo toàn payload gửi đi |
| `ZALOPAY_KEY2` | verify MAC ở **callback** | chống giả callback "đã thanh toán" |
| `ZALOPAY_ENDPOINT` | `https://sb-openapi.zalopay.vn/v2` (sandbox) · `https://openapi.zalopay.vn/v2` (prod) | môi trường |

**Callback URL phải khai báo với ZaloPay:** `https://api.tubutree.com/api/webhooks/zalopay`
(code: [zalopay.service.ts:86](apps/api/src/modules/integrations/payment/zalopay.service.ts#L86) verify MAC bằng KEY2 → set đơn `PAID`).

## 1. Hai con đường đăng ký

### A. Sandbox (LẤY NGAY, không cần giấy tờ) — để test trước
1. Vào **https://docs.zalopay.vn/** → mục *Tích hợp / Sandbox*.
2. ZaloPay công bố sẵn bộ **AppID/Key1/Key2 demo** dùng chung cho sandbox (đổi theo từng kỳ — lấy giá trị mới nhất trong trang docs, đừng hardcode bản cũ).
3. Set vào `.env` với `ZALOPAY_ENDPOINT=https://sb-openapi.zalopay.vn/v2`.
4. Test luồng: tạo đơn → mở `order_url` → thanh toán bằng app ZaloPay sandbox → nhận callback.
> Sandbox để **kiểm thử tích hợp**; tiền không thật, không cần pháp lý.

### B. Production (key thật để nhận tiền) — cần pháp nhân
1. **Đăng ký tài khoản Merchant:** https://merchant.zalopay.vn (Merchant Center). Đăng nhập bằng tài khoản Zalo doanh nghiệp.
2. **Hồ sơ cần chuẩn bị:**
   - Giấy phép đăng ký kinh doanh (hộ KD hoặc công ty).
   - Giấy tờ người đại diện pháp luật (CCCD).
   - Tài khoản ngân hàng doanh nghiệp (để ZaloPay đối soát/chi trả).
   - Thông tin website/app: tên Tubu Tree, domain `tubutree.com`, mô tả ngành hàng (mỹ phẩm/nông sản…).
3. **Tạo ứng dụng (App):** trong Merchant Center → *Quản lý ứng dụng* → tạo app → khai báo:
   - **Callback URL:** `https://api.tubutree.com/api/webhooks/zalopay`
   - (Tùy chọn) Redirect URL sau thanh toán nếu dùng web.
4. **Chờ duyệt** (thường vài ngày làm việc; có thể yêu cầu bổ sung hồ sơ).
5. Sau duyệt → lấy **App ID, Key1, Key2** ở phần *Thông tin ứng dụng / Khóa bí mật*.
6. Set vào `.env` với `ZALOPAY_ENDPOINT=https://openapi.zalopay.vn/v2`.

## 2. Điền vào `.env` prod (trên VM, cạnh docker-compose.prod.yml)
```env
ZALOPAY_APP_ID=<App ID>
ZALOPAY_KEY1=<Key1>
ZALOPAY_KEY2=<Key2>
ZALOPAY_ENDPOINT=https://openapi.zalopay.vn/v2   # prod; sandbox: https://sb-openapi.zalopay.vn/v2
```
Restart API: `docker compose -f docker-compose.prod.yml up -d api`.

## 3. Nghiệm thu (Definition of Done)
- [ ] `POST /api/payments/zalopay/create` trả `order_url` + `zp_trans_token` (không còn 503).
- [ ] Thanh toán thử → ZaloPay gọi `POST /api/webhooks/zalopay` → đơn chuyển `paymentStatus=PAID`, `status=CONFIRMED`.
- [ ] Sai MAC (giả callback) → trả `return_code=-1` (đã có cơ chế verify KEY2).

## 4. Lưu ý
- **KHÔNG commit** Key1/Key2 vào git (chỉ nằm trong `.env` trên VM).
- Sandbox và production là **2 bộ key khác nhau** + 2 endpoint khác nhau — đừng trộn.
- ZaloPay là **tùy chọn**: có thể go-live 30/06 chỉ COD/Ví, bật ZaloPay sau khi có key thật.
