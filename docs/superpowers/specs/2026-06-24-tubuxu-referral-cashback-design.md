# TubuXu + Giới thiệu bạn bè (kiểu MoMo) + hoàn thiện Cashback — Design

Ngày: 2026-06-24. Trạng thái: đã duyệt (Lã Hoàng Long). Build full A→E (BE + FE).

## Mục tiêu
Tạo **TubuXu** — tiền tệ tiêu-trong-app — để khuyến khích khách giữ tiền trong hệ sinh thái
thay vì rút ra. Hoa hồng CTV + cashback Shopee về **Ví (tiền thật)**; Ví đổi sang TubuXu được
thưởng ×1.2, hoặc rút ngân hàng (min 100k, phí 3k/lần). Thêm tính năng giới thiệu bạn bè: bạn
được mời có giao dịch cashback đầu tiên được Accesstrade duyệt → **cả hai** nhận TubuXu.

## Mô hình dòng tiền
```
HOA HỒNG CTV ──┐
               ├─► VÍ TUBU (walletBalance, VND thật) ──┬─► đổi TubuXu (×1.2, miễn phí)
CASHBACK SHOPEE┘                                       └─► rút ngân hàng (min 100k, phí 3k)

TubuXu (coinsBalance, KHÔNG rút được) ─► mua hàng (1 xu = 1đ) · mua nước 💧 · mua cây thật 🌳
Giới thiệu bạn (referee có cashback CONFIRMED đầu) ─► +TubuXu cho người mời + người được mời
```

Phí rút gọi là **"phí chuyển khoản ngân hàng"** (3.000đ). UI luôn nổi bật lựa chọn đổi TubuXu
×1.2 miễn phí và hiển thị "Thực nhận: …đ" để khách bớt khó chịu với phí.

## Bất biến
`coinsBalance == SUM(CoinTransaction.delta)` của user — mọi thay đổi coinsBalance ghi kèm 1
CoinTransaction trong cùng `$transaction` (đúng pattern Điểm Xanh). Cho phép đối soát về sau.

## Schema (Prisma)
- `User.coinsBalance Int @default(0)`.
- model `CoinTransaction { id, userId, delta, reason, refType?, refId?, createdAt }` map `coin_transactions`, index `[userId]`.
- `Payout.fee Int @default(0)` (phí rút; amount = số thực nhận sau phí).
- `enum PaymentMethod` thêm `XU`.
- Migration tay: thêm cột + bảng + **partial unique index** `coin_transactions_referral_unique` trên `(reason) WHERE "refType" = 'REFERRAL'` → chống thưởng giới thiệu 2 lần (mirror loyalty).

## Reason chuẩn (CoinTransaction)
| reason | refType | dấu | nghĩa |
|---|---|---|---|
| `CONVERT_FROM_WALLET` | CONVERT | + | đổi từ Ví (×1.2) |
| `REFERRAL_CASHBACK:<refereeId>` | REFERRAL | + | thưởng người mời |
| `REFERRED_CASHBACK:<refereeId>` | REFERRAL | + | thưởng người được mời |
| `ORDER_PAY:<orderCode>` | ORDER | − | trả đơn bằng xu |
| `GAME_BUY_SEEDS` | GAME | − | mua nước |
| `GAME_BUY_TREE:<certCode>` | GAME | − | mua cây thật |

## Config (seed, chỉnh runtime)
- `wallet.xu_convert_multiplier` = 1.2
- `wallet.withdraw_min` = 100000
- `wallet.withdraw_fee` = 3000
- `coins.referrer_reward` = 5000 (xu)
- `coins.referee_reward` = 5000 (xu)
- `game.xu_per_seed` = 1 (xu/giọt nước)
- `game.tree_xu_price` = 50000 (xu/cây thật)

## Phase A — Lõi TubuXu (module `wallet`)
`WalletService`:
- `convertToXu(userId, amountVnd)` — `amountVnd>0`; xu = `floor(amountVnd × multiplier)`; atomic
  `updateMany walletBalance gte amountVnd → decrement`; tăng coinsBalance + ghi CoinTransaction(+xu,
  CONVERT_FROM_WALLET). Trả `{ spent, received, multiplier }`.
- `withdrawToBank(userId, amountVnd, bankInfo)` — `amountVnd >= withdraw_min`; `net = amountVnd − fee`;
  atomic `updateMany walletBalance gte amountVnd → decrement`; tạo `Payout(amount=net, fee, method='BANK',
  status=REQUESTED)`. Trả `{ withdrawn, fee, net, payoutId }`.
- `getOverview(userId)` — walletBalance, coinsBalance, multiplier, withdraw_min/fee, referralCode,
  thống kê referral (số bạn thành công, xu kiếm từ giới thiệu), lịch sử coin gần nhất.
- `grantCoins(userId, amount, reason, refType, refId)` — atomic create + increment; catch P2002 → no-op.
- `spendCoins(userId, amount, reason, refType, refId, tx?)` — atomic `updateMany coinsBalance gte amount
  → decrement` (count 0 → throw 'Không đủ TubuXu'); ghi CoinTransaction(−amount). Nhận `tx?` để chạy
  trong transaction checkout.
- `grantReferralCoins(refereeId)` — nếu referee có referredById → grantCoins cho người mời
  (`REFERRAL_CASHBACK:<refereeId>`) + người được mời (`REFERRED_CASHBACK:<refereeId>`). Idempotent.

## Phase B — Ghi nhận người giới thiệu lúc đăng ký
`referredById` hiện được ĐỌC (game-gift) nhưng chưa nơi nào GHI → vá. 3 luồng login
(`loginAsGuest`, `loginWithZaloMiniApp`, `loginWithZaloOAuth`) nhận optional `referralCode`; khi
TẠO user mới → `resolveReferrerId(code)` (≠ chính mình) → set `referredById`. Chỉ set lúc tạo,
không ghi đè khi đăng nhập lại. DTO + controller thêm field.

## Phase C — Trigger thưởng + fix cashback
- `handlePostback`: khi giao dịch **chuyển sang CONFIRMED lần đầu** (create status CONFIRMED, hoặc
  update PENDING→CONFIRMED) → sau commit gọi `wallet.grantReferralCoins(userId)` (idempotent).
- Fix (a): `PostbackDto` thêm `@Min(0)` cho `amount`/`commission`; service guard bỏ qua nếu âm.
- Fix (b): postback đến khi `existing.status === 'PAID'` → return sớm `{ok:true}`, KHÔNG ghi đè status
  (chống mất dấu đã trả tiền).

## Phase D — Sink tiêu xu
- Checkout: `PaymentMethod XU` — như WALLET nhưng `spendCoins(tx)` thay vì trừ walletBalance
  (1 xu = 1đ → cần coinsBalance ≥ total); paymentStatus PAID.
- `game.buySeeds(userId, seeds)` — cost = `seeds × game.xu_per_seed`; spendCoins → tăng totalSeeds
  (không vượt tank_capacity → vượt thì báo lỗi).
- `game.buyTree(userId)` — cost = `game.tree_xu_price`; spendCoins → tạo `PlantedTree(PLEDGED, certCode)`.

## Phase E — FE miniapp
- Màn Ví/TubuXu: số dư Ví + xu, đổi Ví→xu (×1.2), rút ngân hàng (min 100k, phí 3k, hiện thực nhận),
  lịch sử xu.
- Chia sẻ link giới thiệu `?ref=<referralCode>`; FE đọc `?ref=` lúc đăng nhập lần đầu → gửi kèm.
- Thanh toán bằng xu ở checkout; mua nước / mua cây thật bằng xu ở trang game.

## Chống gian lận
- Thưởng referral chỉ khi referee có **cashback CONFIRMED** (giao dịch thật qua sàn được AT duyệt) →
  tài khoản ảo vô nghĩa.
- `referredById` ≠ self; chỉ set 1 lần lúc tạo.
- Idempotency thưởng qua partial unique index.
- Mọi thao tác tiền/xu atomic bằng `updateMany` guard `gte` (không âm số dư, không double-spend).

## Ngoài phạm vi (gated)
- Reconciliation cron kéo GET /transactions từ Accesstrade (cần AT API key).
- Notification cashback về Ví: thêm nếu hệ thống template cho phép gọi gọn; nếu không → ghi nhận sau.
