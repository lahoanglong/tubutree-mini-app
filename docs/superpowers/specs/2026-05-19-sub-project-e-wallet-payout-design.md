# Sub-project E — Ví & Rút tiền (Payout)

**Date:** 2026-05-19
**Depends on:** C (WalletLedger đã có, dùng làm hệ thống ví chung).

## Goal
CTV (sau này có thể cả Đại lý nếu cần) tạo lệnh rút tiền từ ví VND → admin duyệt → bank transfer thủ công (admin tự chuyển khoản) → mark COMPLETED. Ledger update đồng bộ để balance đúng.

## Decisions
- **Min payout:** 100,000 VND (Setting `payout.min_amount`).
- **Cooldown:** không có request trùng lúc PENDING.
- **Auto-deduct lúc request:** số tiền request bị "hold" — tạo WalletLedger.PAYOUT_OUT (amount âm) NGAY. Nếu admin REJECT → tạo WalletLedger.PAYOUT_REVERSE (+amount).
- **Bank info:** dùng `bank_*` từ AffiliateApplication active (snapshot vào PayoutRequest để không bị ảnh hưởng khi user update sau).
- **Payment proof:** admin upload ảnh biên lai chuyển khoản khi COMPLETE.

## Schema
```prisma
model PayoutRequest {
  id              Int      @id @default(autoincrement())
  user_id         Int
  user            User     @relation(fields: [user_id], references: [id])
  amount_vnd      BigInt
  status          String   @default("PENDING") // PENDING | APPROVED | COMPLETED | REJECTED
  bank_name       String
  bank_account_no String
  bank_account_name String
  proof_url       String?  // ảnh biên lai khi COMPLETED
  note            String?
  reject_reason   String?
  requested_at    DateTime @default(now())
  reviewed_at     DateTime?
  reviewed_by_uid String?
  completed_at    DateTime?
  @@index([user_id, status])
  @@index([status, requested_at])
}
```

## Endpoints

### User
```
POST /api/payouts                       Body: { amount_vnd }  Tạo lệnh rút (hold amount)
GET  /api/payouts/me                    List của mình
GET  /api/payouts/me/:id                Chi tiết
```

### Admin
```
GET  /api/admin/payouts                 List (?status filter)
POST /api/admin/payouts/:id/approve     Đánh dấu sẵn sàng chuyển khoản
POST /api/admin/payouts/:id/reject      Body: { reason }  (revert hold)
POST /api/admin/payouts/:id/complete    Multipart: { proof image }  (đã chuyển khoản)
```

## State machine
```
PENDING ──approve──> APPROVED ──complete──> COMPLETED
   │                    │
   └──reject──> REJECTED (revert hold)
                APPROVED ──reject──> REJECTED (revert hold)
```

## Out of scope
- Tự động chuyển khoản qua API ngân hàng (defer)
- Phí rút tiền
- Lịch rút định kỳ
- UI cho payout
