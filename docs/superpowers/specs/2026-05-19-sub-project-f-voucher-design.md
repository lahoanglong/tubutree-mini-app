# Sub-project F — Voucher / Coupon

**Date:** 2026-05-19
**Depends on:** Order flow (existing).

## Goal
Khuyến mãi: tạo mã giảm giá, user nhập mã ở checkout, áp dụng giảm vào tổng đơn.

## Decisions
- **Loại discount:** `PERCENT` (giảm % tổng đơn) hoặc `FIXED` (giảm số tiền cố định). Per voucher.
- **Giới hạn:** `max_discount_vnd` (cho PERCENT), `min_order_vnd` (yêu cầu đơn tối thiểu), `total_uses` (tổng lượt dùng toàn shop), `per_user_uses` (1 user dùng tối đa N lần).
- **Thời gian:** `valid_from`, `valid_to`.
- **Targeting (MVP simple):** áp dụng toàn shop. Targeting theo sản phẩm/category — defer.
- **Stacking:** không cho stack — 1 đơn 1 voucher (cộng với redeem points = OK riêng).
- **Tracking:** `VoucherUsage` lưu mỗi lần dùng (user_id, voucher_id, order_id, discount_vnd).

## Schema
```prisma
model Voucher {
  id              Int      @id @default(autoincrement())
  code            String   @unique
  description     String
  type            String              // PERCENT | FIXED
  value           Float               // 10 = 10% hoặc 50000 = 50k
  max_discount_vnd BigInt?            // chỉ cho PERCENT
  min_order_vnd   BigInt   @default(0)
  total_uses      Int?                // null = unlimited
  per_user_uses   Int      @default(1)
  used_count      Int      @default(0)
  valid_from      DateTime
  valid_to        DateTime
  is_active       Boolean  @default(true)
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  usages          VoucherUsage[]
}

model VoucherUsage {
  id           Int      @id @default(autoincrement())
  voucher_id   Int
  voucher      Voucher  @relation(fields: [voucher_id], references: [id])
  user_id      Int
  order_id     Int?
  discount_vnd BigInt
  used_at      DateTime @default(now())
  @@index([voucher_id, user_id])
  @@index([user_id, used_at])
}
```

## Endpoints
```
POST /api/vouchers/apply             Body: { code, order_total }
                                     → preview: { valid, discount_vnd, error? }
GET  /api/vouchers/active            List voucher đang hiện hữu công khai
                                     (hiển thị banner KM)

# Admin
GET  /api/admin/vouchers
POST /api/admin/vouchers             Tạo
PUT  /api/admin/vouchers/:id
DELETE /api/admin/vouchers/:id       (soft = set is_active = false)
GET  /api/admin/vouchers/:id/usages
```

## Apply logic
```
1. Find voucher by code (case-insensitive)
2. Check is_active, valid_from <= now <= valid_to
3. Check used_count < total_uses (nếu có)
4. Check per_user_uses: count VoucherUsage WHERE voucher_id, user_id < per_user_uses
5. Check order_total >= min_order_vnd
6. Compute:
   - PERCENT: discount = order_total * value / 100, cap by max_discount_vnd
   - FIXED: discount = value (cap by order_total)
7. Return { valid: true, discount_vnd, voucher_id }
```

## Confirm usage (hook vào order creation)
Khi user thực sự đặt đơn với voucher:
- Tạo `VoucherUsage` (atomic)
- Increment `Voucher.used_count`
- Trong 1 transaction để chống race condition

## Out of scope
- Voucher theo category/sản phẩm
- Voucher tự generate (mã ngẫu nhiên cho từng user)
- Stacking nhiều voucher
- UI: input voucher trong checkout (FE defer)
