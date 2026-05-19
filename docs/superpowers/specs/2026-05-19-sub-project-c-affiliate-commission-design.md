# Sub-project C — Affiliate Share Link + Commission

**Date:** 2026-05-19
**Depends on:** A (CTV capability), B (ledger pattern), OrderRef.

## Goal
CTV chia sẻ link sản phẩm (hoặc app) → khách click → đặt hàng → CTV nhận hoa hồng. Trả hoa hồng vào ví CTV (Wallet — sang sub-project E để rút tiền).

## Decisions (defaults)
- **Mã referral:** mỗi CTV có 1 `referral_code` duy nhất (8 ký tự alphanumeric, generated lúc APPROVED).
- **Link share:** `https://zalo.me/s/{ZALO_APP_ID}/?ref={referral_code}` (hoặc deep link riêng). Frontend đọc `?ref=` khi user mở app, lưu vào localStorage + gửi lên BE.
- **Attribution model:** Last-touch, window 30 ngày. Khi user lần đầu open app với `?ref=XYZ` → tạo `Referral { referred_user_id, referrer_user_id, expires_at = +30 days }`. Khi user đặt đơn trong window → đơn được gán cho referrer.
- **Self-referral chặn:** user không thể dùng code của chính họ.
- **Commission rate:** 5% giá trị đơn (Setting `commission.default_rate_pct`). Tier-based rate defer.
- **Trigger:** chỉ tính commission khi đơn `COMPLETED`. Reverse khi `CANCELLED`.
- **Wallet:** lưu vào bảng `WalletLedger` (giống PointsLedger nhưng đơn vị là VND). Sub-project E xử lý rút tiền.

## Schema
```prisma
model AffiliateProfile {
  user_id          Int      @id
  user             User     @relation(fields: [user_id], references: [id])
  referral_code    String   @unique   // 8-char, generated on approval
  total_referrals  Int      @default(0)
  total_orders     Int      @default(0)
  total_commission BigInt   @default(0)  // tổng hoa hồng đã nhận (VND, sum)
  created_at       DateTime @default(now())
}

model Referral {
  id                Int      @id @default(autoincrement())
  referrer_user_id  Int      // CTV
  referred_user_id  Int      @unique  // 1 khách chỉ có 1 referrer (last-touch ghi đè cũ)
  created_at        DateTime @default(now())
  expires_at        DateTime           // +30 days từ create
  @@index([referrer_user_id])
}

model CommissionLedger {
  id          Int      @id @default(autoincrement())
  user_id     Int      // CTV nhận hoa hồng
  type        String   // EARN | REVERSE | PAYOUT
  amount      BigInt   // VND, dương=cộng, âm=trừ
  order_id    Int?     // OrderRef.id
  referred_user_id Int? // user đã mua tạo ra commission
  note        String?
  created_at  DateTime @default(now())
  @@index([user_id, created_at])
  @@index([order_id])
}

model WalletLedger {
  // Generic ví VND — dùng cho commission, hoàn tiền, top-up
  id          Int      @id @default(autoincrement())
  user_id     Int
  user        User     @relation(fields: [user_id], references: [id])
  type        String   // COMMISSION_IN | COMMISSION_REVERSE | PAYOUT_OUT | PAYOUT_REVERSE | TOPUP | ADJUST
  amount      BigInt   // VND
  ref_id      Int?     // reference id (commission_ledger.id, payout.id...)
  note        String?
  created_at  DateTime @default(now())
  @@index([user_id, created_at])
}
```

## Endpoints

### User
```
GET  /api/affiliate/me/profile           Referral code, stats, link share
GET  /api/affiliate/me/referrals         Danh sách user đã giới thiệu (paginated)
GET  /api/affiliate/me/commissions       Lịch sử commission ledger
GET  /api/wallet/balance                 Số dư ví
GET  /api/wallet/history                 Lịch sử ví
POST /api/referral/attribute             Body: { ref_code } → gán referrer cho user hiện tại (chỉ 1 lần / 30 ngày)
GET  /api/referral/my-referrer           Xem ai đang là referrer của mình
```

### Admin (mở rộng từ A)
```
GET  /api/admin/affiliate/profiles       List CTV có profile + stats
PUT  /api/admin/affiliate/profiles/:userId/commission-rate   Custom rate cho 1 CTV (override default)
```

## Auto-create AffiliateProfile khi approve
Khi admin approve AffiliateApplication, tạo `AffiliateProfile` với `referral_code` random (collision-retry 5 lần).

## Trigger commission
Webhook `order.delivered`:
1. Award points (sub-project B) — đã có
2. Check user có referrer không (Referral chưa expire)
3. Nếu có → tính commission = order_total * rate → CommissionLedger.EARN + WalletLedger.COMMISSION_IN

Webhook `order.cancelled`:
- Reverse points (đã có)
- Reverse commission: nếu order đã có EARN → CommissionLedger.REVERSE + WalletLedger.COMMISSION_REVERSE

## Out of scope
- Tier-based rate
- Đa cấp (cấp 2, cấp 3) — defer
- Rút tiền — sang sub-project E
- UI share button (sẽ thêm vào product detail page sau)
