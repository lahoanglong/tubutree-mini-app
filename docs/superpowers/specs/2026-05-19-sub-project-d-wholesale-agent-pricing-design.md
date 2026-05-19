# Sub-project D — Wholesale (Đại lý nhập hàng giá sỉ)

**Date:** 2026-05-19
**Depends on:** A (Agent capability), existing product/cart/order flow.

## Goal
Đại lý đã APPROVED → thấy giá sỉ thay vì giá lẻ → đặt hàng số lượng lớn. Có thể có nhiều tier (cấp 1/cấp 2) với mức giá khác nhau.

## Decisions
- **Tier:** 3 tier mặc định: `BRONZE` / `SILVER` / `GOLD`. Khi approve, default = `BRONZE`. Admin có thể nâng cấp.
- **Pricing rule:** tier có 1 `discount_pct` (vd Bronze 10%, Silver 15%, Gold 20%) áp dụng trên `retail_price` từ Pancake. (Đơn giản hơn là maintain bảng giá riêng.)
- **Min order:** mỗi tier có `min_order_vnd` (vd Bronze 1tr, Silver 5tr, Gold 10tr). Backend check khi tạo order.
- **Catalog:** giữ chung — không có sản phẩm riêng cho đại lý. Tránh phức tạp.
- **Hiển thị:** product detail page sẽ hiển thị cả giá lẻ + giá sỉ (nếu user là agent).

## Schema
```prisma
model AgentTier {
  id              Int    @id @default(autoincrement())
  code            String @unique  // BRONZE | SILVER | GOLD
  name            String          // "Bronze", "Silver", "Gold"
  discount_pct    Float           // ví dụ 10, 15, 20
  min_order_vnd   BigInt          // tối thiểu đơn (VND)
  sort_order      Int    @default(0)
  is_active       Boolean @default(true)
}

model AgentProfile {
  user_id    Int       @id
  user       User      @relation(fields: [user_id], references: [id])
  tier_id    Int
  tier       AgentTier @relation(fields: [tier_id], references: [id])
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
}
```

## Endpoints

### User (cần agent_enabled)
```
GET  /api/agent/me/profile             { tier, discount_pct, min_order }
GET  /api/agent/me/price/:productId    Giá sỉ cho 1 sản phẩm
```

### Product enrichment
- `GET /api/products` và `GET /api/products/:sku` — nếu user agent_enabled, attach `wholesale_price` vào mỗi variation.

### Admin
```
GET  /api/admin/agent/tiers                              List tiers
POST /api/admin/agent/tiers                              Create tier
PUT  /api/admin/agent/tiers/:id                          Update
GET  /api/admin/agent/profiles                            List agent profiles
PUT  /api/admin/agent/profiles/:userId/tier              Đổi tier cho 1 đại lý
```

## Hook order creation
- Khi user agent đặt đơn, BE check `min_order_vnd` của tier. Nếu order_total < min → 400 `BELOW_MIN_ORDER`.
- Apply discount theo tier vào order_total trước khi gửi sang Pancake.

## Auto-create AgentProfile khi approve
Khi admin approve `AgentApplication`, tạo `AgentProfile` với tier mặc định `BRONZE`. Nếu không có tier BRONZE trong DB thì seed 3 tier default lần đầu.

## Seed defaults
Lần đầu chạy: nếu bảng `AgentTier` rỗng, seed:
- BRONZE: 10%, min 1,000,000 VND
- SILVER: 15%, min 5,000,000 VND
- GOLD: 20%, min 10,000,000 VND

## Out of scope
- Bảng giá theo sản phẩm cụ thể (chỉ % discount toàn shop trong MVP)
- Đa cấp đại lý
- Công nợ (đặt trước trả sau) — defer
- Pancake POS giá sỉ riêng — dùng % discount trên giá lẻ là đủ MVP
