# Sub-project B — Loyalty Points (Tích điểm)

**Date:** 2026-05-19
**Status:** In implementation (backend only — FE defer)
**Depends on:** A (User schema), OrderRef (existing)

## Goal
User mua hàng → tích điểm. Có thể dùng điểm để giảm giá đơn sau. Tier khách hàng (đồng/bạc/vàng) defer sang phase sau.

## Decisions (defaults vì user grant autonomy)
- **Earn rate:** 1 point / 1000 VND giá trị đơn hàng (settable trong Setting).
- **Redeem rate:** 1 point = 100 VND giảm giá (settable).
- **Min redeem:** 100 points / lần (= 10,000 VND).
- **Max redeem:** ≤ 50% giá trị đơn hàng (chống abuse).
- **Trigger earn:** khi `OrderRef.payment_status → COMPLETED`. Trước đó points không cộng.
- **Reverse on cancel:** Nếu đơn `→ CANCELLED` sau khi đã cộng → trừ lại số điểm đã cộng. Nếu đơn đã dùng điểm để redeem → hoàn lại điểm.
- **Expiry:** không trong MVP (defer).
- **Tier:** không trong MVP. Chỉ track `lifetime_earned` để sau dễ tính tier.
- **Race condition:** mọi update balance qua transaction + balance recompute từ tổng ledger thay vì lưu cached balance.

## Schema
```prisma
model PointsLedger {
  id          Int      @id @default(autoincrement())
  user_id     Int
  user        User     @relation(fields: [user_id], references: [id])
  type        String   // EARN | REDEEM | REVERSE_EARN | REVERSE_REDEEM | ADJUST
  amount      Int      // dương = cộng, âm = trừ
  order_id    Int?     // OrderRef.id, optional
  note        String?
  created_at  DateTime @default(now())

  @@index([user_id, created_at])
  @@index([order_id])
}
```

Balance hiện tại = `SUM(amount) WHERE user_id = ?`. Đơn giản, transactional an toàn.

## Endpoints
```
GET  /api/points/balance              { balance, lifetime_earned, lifetime_redeemed }
GET  /api/points/history?page&limit   Pagination ledger
POST /api/points/preview-redeem       { points_to_redeem, order_total } → { discount_vnd, valid }
POST /api/points/redeem               Body: { order_id, points_to_redeem }  (gọi nội bộ từ order flow)
```

## Hooks vào existing code
- `webhook.controller.ts`: khi nhận webhook Pancake `order.status = "completed"` → gọi `pointsService.awardForOrder(order_id)`.
- `order.controller.ts` (create): nếu request có `points_to_redeem` → tạo REDEEM ledger entry, giảm tổng đơn gửi sang Pancake.

## Settings (key-value trong bảng Setting)
| key | default |
|-----|---------|
| `points.earn_per_vnd` | `0.001` (1 point / 1000 VND) |
| `points.vnd_per_point` | `100` |
| `points.min_redeem` | `100` |
| `points.max_redeem_pct` | `50` |

## Out of scope
- Tier (đồng/bạc/vàng) — schema có sẵn `lifetime_earned`, sau này thêm 1 cột `tier` đơn giản
- Expiry policy — sau khi có data thật
- Bonus points (mua sản phẩm A được 2x điểm) — sau
- UI hiển thị balance / lịch sử / redeem widget — defer (BE ready trước, FE chốt sau)
