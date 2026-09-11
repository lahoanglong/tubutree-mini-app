# Runbook triển khai — đợt 2026-09-11 → 2026-09-12

Tài liệu này liệt kê MỌI thứ cần làm khi deploy đợt này. Đọc hết trước khi chạy lệnh đầu tiên.

Bối cảnh: hai phiên review đã sửa một loạt lỗi tiền, lỗi khoá cứng và lỗ lạm dụng ở cả API,
Mini App lẫn web. Chi tiết từng lỗi nằm trong `docs/2026-09-08-review-progress.md`.

---

## 1. Migration bắt buộc chạy

`prisma migrate deploy` sẽ áp theo thứ tự. Tất cả đã áp và kiểm tra trên DB local; `prisma
migrate diff` báo không còn lệch.

| Migration | Làm gì | Rủi ro |
|---|---|---|
| `20260911020000_community_reputation_ledger_and_comment_moderation` | Bảng `reputation_events`, cột `FeedComment.isRemoved` | Chỉ thêm mới |
| `20260911020100_storefront_merchant_columns_drift_fix` | Bù các cột `storefronts` đã khai trong schema nhưng chưa có migration | **Xem mục 1.1** |
| `20260911030000_coin_convert_idempotency` | Index chống đổi xu trùng | Chỉ thêm mới |
| `20260911040000_payment_attempt` | Bảng `payment_attempts` | Chỉ thêm mới |
| `20260911050000_storefront_slug_lowercase` | Hạ chữ thường `storefronts.slug` | Sửa dữ liệu, xem mục 1.2 |
| `20260911060000_order_item_product_slug` | Cột `OrderItem.productSlug` | Chỉ thêm mới |
| `20260912010000_order_status_history` | Bảng `order_status_history` | Chỉ thêm mới |

### 1.1. Migration drift storefronts — chạy hai câu kiểm tra TRƯỚC

File migration có sẵn khối cảnh báo. Trước khi áp, chạy trên PROD:

```sql
SELECT subdomain, COUNT(*) FROM storefronts WHERE subdomain IS NOT NULL
GROUP BY subdomain HAVING COUNT(*) > 1;

SELECT "customDomain", COUNT(*) FROM storefronts WHERE "customDomain" IS NOT NULL
GROUP BY "customDomain" HAVING COUNT(*) > 1;
```

Cả hai phải trả **0 dòng**. Có dòng nào thì dừng lại và xử lý trùng trước — migration tạo unique
index sẽ fail giữa chừng.

### 1.2. Hạ chữ thường slug gian hàng

Trước đây slug lưu từ `referralCode` (luôn IN HOA) nhưng tra cứu thì hạ chữ thường và so khớp
chính xác ⇒ **mọi link gian hàng CTV đều chết**. Migration hạ chữ thường dữ liệu cũ; code đã sửa
cả hai đầu (ghi hạ chữ thường, đọc so khớp không phân biệt hoa thường).

Sau khi áp, kiểm tra:

```sql
SELECT COUNT(*) FROM storefronts WHERE slug <> LOWER(slug);  -- phải = 0
```

---

## 2. Seed lại cấu hình (idempotent)

`pnpm --filter @tubutree/api prisma:seed` (hoặc lệnh seed đang dùng). Đợt này thêm:

- `attendance.checkin_early_min` = 60 — cho checkin sớm nhất bao nhiêu phút trước giờ vào ca.
- Mẫu thông báo `SUBSCRIPTION_ORDER_FAILED` — thiếu mẫu này thì khách nhận thông báo có nội dung
  đúng bằng mã code.
- Sửa mô tả `attendance.heartbeat_stale_min`: nó **chưa được dùng** để tự checkout; mô tả cũ ghi
  "→ auto checkout" khiến admin tưởng đang bật một cơ chế chống gian lận không tồn tại.

---

## 3. Kiểm tra sau deploy

```bash
# 1. Sức khoẻ + DB
curl -s https://<api>/api/health

# 2. Config công khai phải có đủ 5 trường (app đọc số từ đây thay vì chép cứng)
curl -s https://<api>/api/config/public
# mong: freeshipThreshold, subscribeDiscountPct, affiliateWalletMultiplier,
#       affiliateMinWithdrawBank, cashbackHoldDays

# 3. Endpoint quản trị mới phải CHẶN khi không có token
curl -s -o /dev/null -w '%{http_code}\n' https://<api>/api/admin/cashback/transactions   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://<api>/api/admin/orders/XXX/status-history # 401

# 4. Danh sách sàn hoàn tiền KHÔNG được lộ deeplinkTemplate / fullRate / provider
curl -s https://<api>/api/cashback/merchants
```

Kiểm tra bằng tay trên app (cần người):

1. **Link gian hàng CTV** — mở `https://<web>/s/<slug-viết-thường>` và cả link chia sẻ từ app.
   Mua một đơn thử qua link đó rồi xem `Order.storefrontSlug` có được ghi không (đây là điều
   kiện để CTV nhận hoa hồng, và web trước đây mất sạch).
2. **Chấm công** — thử checkin vào ca của NGÀY MAI: phải bị từ chối.
3. **Bảng lương** — chốt một tháng rồi bấm "Mở lại", sửa giờ, chốt lại.
4. **Hoàn tiền sàn ngoài** — mở tab "Hoàn tiền sàn ngoài" ở portal admin, duyệt một giao dịch
   đang treo, kiểm tra `cashbackPending` của khách tăng đúng số.

---

## 4. Việc CẦN NGƯỜI QUYẾT, chưa làm

1. **P0-3 (Pancake ghi đè tồn kho) — phần còn lại.** Đã bịt nhánh nguy hiểm nhất: mọi lượt quét
   TOÀN BỘ catalog (kể cả cron khi cursor rỗng) không còn ghi `stock`. Phần còn lại phụ thuộc một
   dữ kiện bên ngoài mà repo không trả lời được: *Pancake có tự trừ `remain_quantity` khi mình
   tạo đơn qua API không?* Xem `docs/2026-09-11-P0-3-pancake-stock-decision-brief.md` — trong đó
   có thí nghiệm 30 phút trên PROD và cả hai thiết kế ứng với hai câu trả lời.

2. **Refresh token của web đang nằm trong `localStorage`.** Một lỗ XSS là mất tài khoản vĩnh
   viễn. Đã thêm CSP ở chế độ **báo cáo** (`Content-Security-Policy-Report-Only`) làm lớp phòng
   thủ tạm. Việc đúng là chuyển sang cookie `httpOnly; Secure; SameSite=Lax` do BE set — nhưng
   đổi cách này sẽ **đăng xuất toàn bộ phiên web hiện có**, nên cần chọn thời điểm. Sau khi soi
   báo cáo CSP trên môi trường thật thì đổi header sang chế độ chặn.

3. **AccessTrade API key.** Chưa có key thì cron đối soát tự tắt, và hoàn tiền chỉ trông vào
   postback. Nay đã có đường quản trị để duyệt tay giao dịch treo, nhưng đó là chữa cháy.

4. **Kiểm tra giao diện trên Zalo thật.** Phiên này sửa nhiều màn (hồ sơ gian hàng CTV, lý do
   giới thiệu từng sản phẩm, tab Hoàn tiền, nút Mở lại bảng lương, phân trang bình luận/bài dự
   thi). Test tự động không thay được một vòng bấm tay trên máy thật.

---

## 5. Trạng thái kiểm thử lúc đóng đợt

- API: **94 suite / 1451 test** — xanh
- Mini App: **13 file / 95 test** — xanh
- Web: **3 file / 25 test** — xanh
- `pnpm typecheck` và `pnpm lint` xanh toàn workspace
- Smoke test trên API thật (cổng 3009, DB local): health 200 · `/config/public` đủ 5 trường ·
  hai endpoint quản trị mới trả 401 khi không có token · `/cashback/merchants` không còn lộ
  `deeplinkTemplate`/`fullRate` · bảng `order_status_history` có đúng cột và index

---

## 6. Smoke test đã chạy trên API thật (DB local, cổng 3009)

Không phải suy luận từ test đơn vị — đây là kết quả gọi thật vào API đang chạy, kèm kiểm tra
trực tiếp trong Postgres.

| Kiểm tra | Kết quả |
|---|---|
| `GET /health` | 200, `db: up` |
| `GET /config/public` | đủ 5 trường, có `cashbackHoldDays: 30` |
| `GET /admin/cashback/transactions` không token | **401** |
| `GET /admin/orders/:id/status-history` không token | **401** |
| `GET /cashback/merchants` (công khai) | không còn `deeplinkTemplate` / `fullRate` / `provider` |
| `POST /checkout/quote` với địa chỉ sai | **400** kèm lý do tiếng Việt (không phải 500) |
| `POST /me/addresses` với `recipient` 5.000 ký tự | **400** — trần `MaxLength(120)` chặn đúng |
| `POST /feed` 7 lần liên tiếp | 5 lần đầu **201**, lần 6–7 **429** — giới hạn tốc độ đúng |
| `POST /feed/:id/report` với `targetId` bịa | **404**, và bảng `community_reports` KHÔNG có dòng rác |
| `POST /feed/:id/react` với bài không tồn tại | **404** |
| Bình luận vào bài **chưa duyệt** (PENDING) | **404** — đường farm xu đã bịt |
| Bài do khách chưa tin cậy đăng | vào `PENDING`, đúng luật kiểm duyệt |
| Bảng `order_status_history` | đúng 8 cột + index `(orderId, createdAt)` |

Dữ liệu smoke đã dọn sạch sau khi kiểm tra (`DELETE 5` bài thử).
