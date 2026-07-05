# Flash Sale (Giờ vàng) — Hướng dẫn QA & Setup

Tài liệu này hướng dẫn cách tạo 1 đợt flash sale để test và cách kiểm tra từng
màn hình (miniapp + web-admin). Feature đã được verify WIRED end-to-end trên dev DB.

Ký hiệu: **giá đang bán (standing)** = `salePrice ?? retailPrice` của variation.

---

## 1. Cách seed/tạo 1 flash sale để test

### Cách A — qua Web Admin (khuyến nghị)

1. Mở web-admin, đăng nhập bằng tài khoản **ADMIN**, chọn tab **"Flash Sale"**.
2. **Tạo đợt (sự kiện)**: nhập `title`, `startAt`, `endAt`.
   - Để đợt hiện ra ngay: đặt `startAt ≤ hiện tại < endAt` (ví dụ start = 1 giờ trước, end = 2 giờ sau).
   - `startAt` phải trước `endAt`, nếu không BE trả lỗi `startAt phải trước endAt.`
3. **Thêm item vào đợt**: cần `variationId`, `flashPrice`, `quota`, (tuỳ chọn) `perUserLimit`.
   - `flashPrice` **phải < giá đang bán** (không thì lỗi `Giá flash phải thấp hơn giá đang bán.`).
   - Nếu cấu hình `flashsale.min_discount_pct > 0` thì flashPrice còn phải giảm đủ % tối thiểu.
   - `quota` **không vượt tồn kho** (`stock`) của variation (không thì lỗi `Quota vượt tồn kho.`).
   - Bỏ trống `perUserLimit` → BE lấy mặc định `flashsale.default_per_user_limit` (mặc định 5).
   - 1 variation chỉ được nằm trong 1 đợt flash còn hạn (endAt tương lai); trùng → `Sản phẩm đã có trong đợt flash khác.`

**Lấy `variationId` ở đâu:**
- Cách nhanh nhất trong lúc test: query DB dev (Postgres `tubu_pg`, `localhost:5434`).
  ```sql
  SELECT v.id, v.sku, v.name, v."retailPrice", v."salePrice", v.stock
  FROM variations v
  WHERE v."isActive" = true
  ORDER BY v.stock DESC
  LIMIT 20;
  ```
  hoặc dùng `pnpm --filter @tubutree/api exec prisma studio` → bảng `variations`.
- Chọn variation có `stock` đủ lớn để quota test thoải mái.

### Cách B — qua HTTP API (thay thế, cần ADMIN token)

Tất cả endpoint `/admin/flash-sales*` yêu cầu JWT có role **ADMIN** (`Authorization: Bearer <token>`).
Lấy token dev: có thể dùng script `apps/api/scripts/dev-token.ts` / `grant-admin.js`, hoặc login luồng chuẩn bằng tài khoản đã được set role ADMIN.

```bash
BASE=http://localhost:3000        # chỉnh theo port API dev
TOKEN=<ADMIN_JWT>

# 1) Tạo đợt
curl -s -X POST "$BASE/admin/flash-sales" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Giờ vàng test","startAt":"2026-07-05T06:00:00.000Z","endAt":"2026-07-05T23:00:00.000Z"}'
# → trả về { id: "<saleId>", ... }

# 2) Thêm item (flashPrice < giá đang bán; quota ≤ stock)
curl -s -X POST "$BASE/admin/flash-sales/<saleId>/items" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"variationId":"<variationId>","flashPrice":99000,"quota":5,"perUserLimit":2}'

# 3) Kiểm tra công khai (không cần token)
curl -s "$BASE/flash-sales/active"
```

---

## 2. Cách test từng surface

Điều kiện chung để item hiện: đợt `isActive = true`, `startAt ≤ now < endAt`, `soldCount < quota`,
và variation `isActive = true`.

### (1) Home miniapp — section "Giờ vàng"
- Trang chủ hiển thị section **"🌿 Ưu đãi giờ vàng"** (component `FlashSale`, render trong `home.tsx`).
- Kiểm tra: có **countdown** "⏳ Còn ..." đếm đến mốc `endAt` sớm nhất, mỗi card có **thanh "Đã bán X%"** (= `soldCount/quota`).
- Section tự ẩn nếu `GET /flash-sales/active` trả mảng rỗng.

### (2) Product detail — giá flash + countdown
- Mở PDP của sản phẩm có variation đang flash, chọn đúng **phân loại** đó.
- Kiểm tra: giá hiển thị = `min(flashPrice, giá đang bán)`, có badge **-X%**, countdown, "Đã bán X%".
- Nếu chọn phân loại khác (không flash) thì hiện giá thường.

### (3) Cart — badge + giá flash
- Thêm variation đang flash vào giỏ.
- Kiểm tra: dòng hàng có badge **"⚡ Giờ vàng"** + "Đã bán X%"; đơn giá **≤ giá thường**
  (BE `resolveEffective` re-resolve giá, `unitPrice = min(flashPrice, standing)`).
- Lưu ý: item flash **không** stack coupon (coupon tính trên phần không-flash).

### (4) Checkout — đặt đơn trừ quota / PRICE_CHANGED
- Đặt đơn có item flash → thành công, `FlashSaleItem.soldCount` **tăng** đúng số lượng,
  tạo/ cộng `FlashSalePurchase.quantity` cho user.
- **Ép PRICE_CHANGED** (BE trả lỗi `PRICE_CHANGED` → FE mở **Sheet** "giá thay đổi"):
  - Cách 1: set `endAt` về **quá khứ** (PATCH đợt) rồi bấm đặt đơn → hết giờ.
  - Cách 2: đẩy `soldCount = quota` (mua cho hết suất, hoặc chỉnh DB) rồi đặt đơn → hết suất.
  - Phân biệt: **vượt `perUserLimit`** trả lỗi riêng `Vượt giới hạn mua ưu đãi.` (KHÔNG phải PRICE_CHANGED).

### (5) Huỷ/hoàn đơn → hoàn quota
- Huỷ hoặc hoàn 1 đơn có item flash (luồng orders).
- Kiểm tra: `FlashSaleItem.soldCount` **giảm** lại đúng số lượng và `FlashSalePurchase.quantity` giảm tương ứng
  (BE `FlashSaleService.restore`, gọi từ `orders.service`).

---

## 3. Endpoints

| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| GET | `/flash-sales/active` | Public | Danh sách item flash đang chạy (home/PDP/cart). |
| GET | `/admin/flash-sales` | ADMIN | Liệt kê toàn bộ đợt + item. |
| POST | `/admin/flash-sales` | ADMIN | Tạo đợt (`title`, `startAt`, `endAt`). |
| PATCH | `/admin/flash-sales/:id` | ADMIN | Sửa đợt (`title/startAt/endAt/isActive`). |
| POST | `/admin/flash-sales/:id/items` | ADMIN | Thêm item (`variationId`, `flashPrice`, `quota`, `perUserLimit?`). |
| DELETE | `/admin/flash-sales/items/:itemId` | ADMIN | Xoá item (chặn nếu `soldCount > 0`). |

---

## 4. Config (SystemConfig)

| Key | Mặc định | Ý nghĩa |
|-----|----------|---------|
| `flashsale.default_per_user_limit` | `5` | Giới hạn số suất/1 user cho item khi không truyền `perUserLimit`. |
| `flashsale.min_discount_pct` | `0` | % giảm tối thiểu bắt buộc so với giá đang bán (0 = không ép). Ví dụ `0.1` = phải giảm ≥ 10%. |

Đặt qua tab **Config** của web-admin hoặc `SystemConfigService.set()`. Cache TTL ~60s.

---

## 5. Ghi chú kiểm thử nhanh
- `GET /flash-sales/active` gắn `@Public()` nên gọi được không cần token; nếu bị 401 → guard bị bung, kiểm tra lại.
- Đặt đơn 2 lần vượt `perUserLimit` để thấy thông điệp `Vượt giới hạn mua ưu đãi.`.
- Muốn dọn dữ liệu test: xoá `FlashSale` (cascade tự xoá `FlashSaleItem` + `FlashSalePurchase`).
