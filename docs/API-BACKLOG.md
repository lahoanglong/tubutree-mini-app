# API Backlog — phần còn phải làm (cập nhật 2026-06-25)

Tổng hợp sau khi audit toàn bộ tích hợp. **Phần lớn đã code xong, chỉ chờ key.** Dưới đây tách rõ 3 nhóm.

---

## A. API CÒN PHẢI VIẾT (làm sau — không có sẵn trong code)

| # | Việc | Vì sao cần | Phụ thuộc | Ưu tiên |
|---|------|-----------|-----------|---------|
| A1 | ~~Cron refresh Zalo OA Access Token~~ | **✅ ĐÃ LÀM (2026-06-26, commit sau).** `ZaloOaTokenService` + cron mỗi 6h: lưu access/refresh token vào DB (qua prisma, không vào history), `refresh_token` xoay vòng được lưu lại; `ZnsClient` lấy token động. Bootstrap: cấp `ZALO_OA_ACCESS_TOKEN` + `ZALO_OA_REFRESH_TOKEN` (env/secret) 1 lần. | Chờ có OA token để CHẠY (code đã xong). | XONG |
| A2 | **Điền `zaloTemplateId` cho từng template** | `notifications.service` chỉ gửi ZNS khi template có `zaloTemplateId` (ID thật Zalo cấp). Hiện cột này đang trống → ZNS tự fallback INAPP. Sau khi Zalo duyệt template phải map ID vào. Có thể cần thêm 1 endpoint admin `PUT zaloTemplateId` (hiện chưa có) hoặc cập nhật bằng SQL. | Chờ **Template ID** từ Zalo (sau ~7–14 ngày duyệt). | **CAO** (sau khi có template) |
| A3 | **Cron đối soát Accesstrade** (`GET /transactions`) | Hiện chỉ nhận **postback** (event-driven) — đã đủ chạy. Cron kéo `/transactions` định kỳ là lớp đối soát bù khi postback rớt. | `ACCESSTRADE_TOKEN`. **Code viết được ngay.** | TRUNG BÌNH (tăng độ chắc, không bắt buộc) |
| A4 | **Tích hợp eSMS (SMS OTP cho web)** | Hoàn toàn chưa có trong code. Đăng nhập web hiện đã dùng **Zalo OAuth** nên OTP SMS là tuỳ chọn. | Tài khoản eSMS (hoặc provider khác). | THẤP (Zalo login đã phủ) |
| A5 | ~~Webhook ngân hàng (VietQR/Casso)~~ | **✅ ĐÃ LÀM (2026-06-26)** qua Pancake: sinh VietQR phía server (nội dung CK = mã đơn), Pancake POS đối soát chuyển khoản → webhook `order` → `isPancakeOrderPaid` lật đơn `BANK_TRANSFER` UNPAID→PAID. FE màn `/bank-payment/:code`. **Cần:** liên kết TK ngân hàng shop trong Pancake + đặt đúng `payment.bank_*` (admin config). | Pancake đã có key. | XONG |

> A1 + A3 tôi có thể **viết ngay bây giờ** (code chạy khi có key/OA). A2 phải chờ Template ID. A4 tuỳ nhu cầu.

---

## B. CHỜ BẠN QUYẾT ĐỊNH / CẤP (không phải việc code)

1. **3 nhóm API key go-live** — đăng ký theo `docs/GO-LIVE-KEYS.md`:
   - ZaloPay (`ZALOPAY_APP_ID/KEY1/KEY2`)
   - Zalo OA + ZNS (`ZALO_APP_ID/APP_SECRET/OA_ID/OA_ACCESS_TOKEN` + Template ID)
   - Accesstrade (`ACCESSTRADE_TOKEN/PUBLISHER_ID/WEBHOOK_SECRET`)
2. **Chuyển khoản ngân hàng**: có dùng VietQR + webhook tự xác nhận (Casso/TPBank) không, hay chỉ ZaloPay? → quyết định A5.
3. **PanNature (trồng cây thật)**: đầu mối liên hệ + cách tích hợp (webhook hay Excel batch) khi user thu hoạch cây ảo.

---

## C. ĐÃ CODE XONG — CHỈ CẦN CẮM KEY (KHÔNG phải viết thêm)

Những phần này **đã hoàn chỉnh**, chỉ cần `gh secret set` + `ops.yml set-env` là chạy thật:

- ✅ **ZaloPay**: tạo đơn (MAC `KEY1`) + webhook callback (verify `KEY2`) tại `POST /api/webhooks/zalopay`.
- ✅ **ZNS gửi thật**: `zns.client.sendTemplate()` POST lên Zalo API (chỉ thiếu `zaloTemplateId` — xem A2).
- ✅ **Đăng nhập web bằng Zalo OAuth**: `POST /api/auth/zalo-oauth` (PKCE) — chỉ chờ `ZALO_APP_ID/SECRET`.
- ✅ **Accesstrade postback** (`POST /api/webhooks/accesstrade`, verify secret) + **cron settle** CONFIRMED→Ví mỗi 30'.
- ✅ **Hóa đơn điện tử**: truyền `invoice_request` sang Pancake + webhook `invoice.issued`.
- ✅ **Voucher tự động** (welcome/birthday/winback/milestone): cron đã chạy, gửi INAPP ngay; tự nâng cấp gửi ZNS khi template sẵn sàng.

---

## Gợi ý thứ tự khi quay lại
1. Đăng ký Zalo OA + ZNS (lead time lâu) → khi có token: làm **A1** (refresh cron); khi có Template ID: làm **A2**.
2. Đăng ký ZaloPay → cắm key (không cần code thêm).
3. Đăng ký Accesstrade → cắm key; tuỳ chọn làm **A3** (đối soát).
4. A4/A5 chỉ làm nếu thực sự cần.
