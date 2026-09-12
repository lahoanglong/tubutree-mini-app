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
| `20260912020000_variation_reserved_stock` | Cột `Variation.pancakeStock` + `reservedStock` | Chỉ thêm mới, **không** đụng dữ liệu `stock` — xem mục 1.3 |
| `20260912030000_dealer_order_backorder` | Cột `OrderItem.backorderedQty` | Chỉ thêm mới, mặc định 0 — xem mục 1.4 |

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

### 1.3. Tồn kho: mốc Pancake + giữ chỗ (P0-3 đã đóng)

Migration chỉ THÊM hai cột và cố tình **không** gán `pancakeStock = stock` cho dữ liệu cũ. Để
`NULL`, lượt đồng bộ đầu tiên sau deploy chỉ ghi mốc mà không đụng `stock`, nên **không có cú
đặt lại tồn kho hàng loạt ngay sau khi lên bản mới**. Từ lượt thứ hai trở đi công thức chênh
lệch mới có hiệu lực.

Kiểm tra sau vài chu kỳ sync (15 phút/lượt):

```sql
-- Đã có mốc cho các sản phẩm Pancake?
SELECT count(*) FILTER (WHERE "pancakeStock" IS NULL) AS chua_co_moc,
       count(*) FILTER (WHERE "pancakeStock" IS NOT NULL) AS da_co_moc
FROM variations;

-- Giữ chỗ không bao giờ được âm, và không nên phình to bất thường.
SELECT count(*) FROM variations WHERE "reservedStock" < 0;          -- phải = 0
SELECT id, sku, stock, "reservedStock", "pancakeStock"
FROM variations WHERE "reservedStock" > 0 ORDER BY "reservedStock" DESC LIMIT 20;
```

`reservedStock` lớn kéo dài ở một SKU = đơn của ta Pancake chưa bao giờ phản ánh. Đó là tín hiệu
đơn không tới được kho, không phải lỗi tồn kho.

### 1.4. Đại lý đặt trước hàng chưa về (backorder) — quyết định nghiệp vụ 2026-09-12

Trước đây đơn đại lý vượt tồn kho bị **từ chối thẳng**. Theo quyết định của chủ shop, nay đại lý
được **đặt trước**: `DealerService.placeOrder` giữ tối đa tồn kho đang có, phần còn thiếu ghi
vào `OrderItem.backorderedQty` thay vì chặn cả đơn. Giá tính đủ 100% số lượng đặt — đại lý không
trả thêm khi hàng về.

Đơn còn backorder **chưa được đẩy sang Pancake** (kho vật lý chưa đủ hàng để soạn/xuất). Cron
mới `DealerBackorderService.reconcile()` (mỗi 15 phút, lệch 30s sau Pancake sync) lấp dần theo
tồn kho về, **FIFO theo đơn cũ trước** — công bằng giữa các đại lý tranh cùng 1 SKU. Khi một đơn
lấp đủ 100% mới đẩy Pancake lần đầu.

Huỷ/trả đơn đại lý: `OrderReversalService` chỉ hoàn đúng phần **đã giữ** (`quantity -
backorderedQty`), không hoàn cả `quantity` (sẽ cộng khống tồn kho đúng bằng phần đặt trước).

**Chưa có UI riêng cho backorder** — dữ liệu đã có sẵn trong response `GET /dealer/orders`
(field `backorderedQty` từng dòng), nhưng miniapp/web chưa hiển thị nhãn "đặt trước còn X". Việc
UI là follow-up, không chặn go-live.

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

# 5. Chế độ cookie của web: có header x-client thì refresh token nằm ở Set-Cookie,
#    và KHÔNG còn trong thân response.
curl -si -X POST https://<api>/api/auth/guest -H 'content-type: application/json' -H 'x-client: web' -d '{"deviceId":"smoke-test"}' | grep -iE 'set-cookie|refreshToken'
# mong: Set-Cookie: tubu_rt=...; Path=/api/auth; HttpOnly; Secure; SameSite=Lax
#       và "refreshToken":"" trong thân

# 6. KHÔNG có header x-client (Mini App) thì hành vi cũ giữ nguyên: token trong thân, không cookie.
curl -si -X POST https://<api>/api/auth/guest -H 'content-type: application/json' -d '{"deviceId":"smoke-test-2"}' | grep -iE 'set-cookie|refreshToken'
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

## 4. Việc CẦN NGƯỜI

1. **AccessTrade API key.** Chưa có key thì cron đối soát tự tắt, và hoàn tiền chỉ trông vào
   postback. Nay đã có đường quản trị để duyệt tay giao dịch treo, nhưng đó là chữa cháy.

2. **Kiểm tra giao diện trên Zalo thật.** Nhiều màn đã sửa (hồ sơ gian hàng CTV, lý do giới
   thiệu từng sản phẩm, tab Hoàn tiền, nút Mở lại bảng lương, phân trang bình luận/bài dự thi).
   Test tự động không thay được một vòng bấm tay trên máy thật.

3. **Chọn thời điểm deploy web** — xem mục 4.1: bản này **đăng xuất toàn bộ phiên web hiện có**.

4. **Chọn hạ tầng deploy — xem mục 4.3.** GCP đã đóng, `api.tubutree.com` hiện đang **downtime
   thật** (DNS trỏ về IP GCP cũ, không kết nối được). Chưa quyết định chạy trên VPS Vietnix
   (đang chia sẻ với ChoDeli) hay tạo máy riêng.

**Đã quyết (2026-09-12), không cần hỏi lại:**
- CTV tự đăng ký affiliate: **giữ tự động duyệt** (không đổi code).
- Đơn đại lý vượt tồn kho: **cho đặt trước (backorder)** — đã build, xem mục 1.4 và 4.2.

### 4.1. Đổi cách lưu refresh token của web (CÓ ĐĂNG XUẤT TOÀN BỘ)

Refresh token của web trước đây nằm trong `localStorage`: một lỗ XSS là mất tài khoản vĩnh viễn.
Nay do BE set trong cookie `HttpOnly; Secure; SameSite` — JS không đọc được, kể cả JS của chính
mình. Mini App Zalo KHÔNG đổi (vẫn nhận token trong thân response); chế độ cookie chỉ bật khi
client gửi header `x-client: web`, đồng thời là lớp chống CSRF.

Thứ duy nhất web còn giữ ở `localStorage` là cờ `tubu_web_session = "1"` — không phải bí mật,
chỉ để biết có đáng gọi `/auth/refresh` khi mở trang hay không. Cố tình KHÔNG để cờ này ở cookie:
cookie do API set thuộc origin của API, nên nếu API ở `api.tubutree.com` còn web ở
`tubutree.com` thì web không đọc được và sẽ luôn tưởng khách chưa đăng nhập.

**Hệ quả khi deploy: mọi phiên web đang đăng nhập bị đăng xuất** (token cũ nằm ở localStorage,
code mới không đọc nữa). Chọn giờ thấp điểm. Mini App không bị ảnh hưởng.

Hai biến môi trường mới ở API:

| Biến | Mặc định | Khi nào đổi |
|---|---|---|
| `AUTH_COOKIE_SAMESITE` | `lax` | Đặt `none` NẾU web và API khác site (vd `tubutree.com` với `api-tubu.vn`). Cùng site (`tubutree.com` + `api.tubutree.com`) thì để `lax`. Code tự bật `Secure` khi chọn `none`. |
| `AUTH_COOKIE_DOMAIN` | rỗng | Đặt `.tubutree.com` nếu muốn mọi subdomain dùng chung phiên. Để rỗng vẫn chạy đúng khi web và API cùng registrable domain. |

Sai `AUTH_COOKIE_SAMESITE` thì triệu chứng rất rõ: đăng nhập web xong tải lại trang là mất phiên.

Sau khi soi báo cáo CSP (`Content-Security-Policy-Report-Only`) trên môi trường thật thì đổi
header sang chế độ chặn — việc này độc lập với thay đổi trên.

### 4.2. Đơn đại lý: trừ tồn kho + cho đặt trước (backorder) — xem mục 1.4

Đơn đại lý là đường tạo đơn duy nhất từng không trừ kho, trong khi đường huỷ đơn dùng chung
`OrderReversalService` lại CỘNG kho cho mọi item ⇒ đặt đơn đại lý rồi huỷ là **in tồn kho từ
không khí**. Đã sửa: trừ kho như mọi đường khác, và theo quyết định 2026-09-12, đơn vượt tồn
**không bị từ chối** mà chuyển sang đặt trước — chi tiết thiết kế ở mục 1.4.

### 4.3. Hạ tầng deploy — GCP đã đóng, api.tubutree.com đang downtime

Phát hiện khi soát hạ tầng (2026-09-12): DNS `api.tubutree.com` vẫn trỏ IP GCP cũ
(`34.142.194.160`) nhưng máy đó **không còn kết nối được** — nghĩa là backend Mini App đang
downtime thật, không phải "chưa deploy". Domain gốc `tubutree.com` hiện chạy **WordPress sống**
trên VPS Vietnix (`14.225.207.177`, cùng máy với project ChoDeli) qua aaPanel — tuyệt đối không
được deploy đè lên domain gốc.

VPS Vietnix: 4 vCPU, RAM 7.8GB (đã dùng 3GB + đang cần 1.2GB swap — có áp lực bộ nhớ), disk còn
22GB/48GB. Đang chạy ChoDeli (Next.js + 2 container bridge + Postgres riêng) + Antigravity
gateway + WordPress/MariaDB/aaPanel. Cổng 80/443 do nginx aaPanel giữ (đụng Caddy trong
`docs/DEPLOY-GCP.md` — phải đổi sang dùng nginx aaPanel làm reverse proxy nếu chọn máy này).

**Rủi ro dùng chung**: RAM khá mỏng để cõng thêm Postgres+Redis+API+Web của Tubu Tree; và hai
sản phẩm không liên quan chia sẻ một điểm lỗi duy nhất (ChoDeli crash/leak RAM kéo cả Tubu Tree
xuống và ngược lại) — trong khi Tubu Tree xử lý tiền thật (Ví, lương NV, ZaloPay/chuyển khoản).

**Chưa quyết định** dùng chung VPS này hay tạo máy riêng — xem mục 4 để chọn trước khi deploy.

## 5. Trạng thái kiểm thử lúc đóng đợt

- API: **98 suite / 1526 test** — xanh
- Mini App: **13 file / 96 test** — xanh
- Web: **4 file / 35 test** — xanh
- `pnpm typecheck` và `pnpm lint` xanh toàn workspace (5/5 task mỗi lệnh)
- Công thức tồn kho mới được chạy trên **Postgres thật** (không mock): **11/11 kịch bản** — xem
  mục 1.3 và `docs/2026-09-11-P0-3-pancake-stock-decision-brief.md`
- Smoke test trên API thật (cổng 3009, DB local): xem mục 6

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

| Phân trang bình luận (cursor) | trang 1 trả 2 bình luận + cursor, trang 2 trả 2 bình luận TIẾP THEO rồi hết — **không lặp, không sót** |

### 6.1. Chế độ cookie của web — đã gọi thật vào API đang chạy (2026-09-12)

| Kiểm tra | Kết quả |
|---|---|
| `POST /auth/guest` **có** `x-client: web` | 200 · `Set-Cookie: tubu_rt=…; Path=/api/auth; HttpOnly; SameSite=Lax` · thân trả `"refreshToken":""` |
| Số cookie được set | **đúng 1** (không có cookie phụ nào) |
| `POST /auth/guest` **không** header (Mini App) | token vẫn nằm trong thân, **không** `Set-Cookie` — hành vi cũ nguyên vẹn |
| `POST /auth/refresh` có cookie + có header | **200**, cookie được xoay sang token mới |
| `POST /auth/refresh` có cookie, **thiếu** header | **400** — cookie bị bỏ qua, đây là lớp chặn CSRF |
| `POST /auth/logout` | **204** + `Set-Cookie: tubu_rt=; Expires=1970` (cookie chết) |
| `POST /auth/refresh` sau logout | **401** |
| `POST /auth/refresh` với token đã chết | **401** *và* xoá luôn cookie (không để web thử lại vô hạn) |

Dữ liệu thử đã dọn sạch (7 user khách thử nghiệm, gồm cả rác còn lại từ các lượt smoke trước).

### 6.2. Công thức tồn kho — chạy trên Postgres thật, 11/11

Dựng variation tạm rồi chạy đúng ba câu SQL trong `variation-stock.ts`, so số cuối với kỳ vọng:
Pancake có tự trừ · không tự trừ · sync hai lần không cộng dồn · nhập thêm hàng · huỷ đơn sau khi
giữ chỗ đã nhả (kẹp 0, không âm) · dữ liệu cũ chỉ ghi mốc không đụng `stock` · hết hàng thì 0
dòng bị sửa · số Pancake tụt sâu thì `stock` kẹp 0. Dữ liệu thử đã xoá.

Dữ liệu smoke đã dọn sạch sau khi kiểm tra (5 bài thử + 3 bình luận thử).
