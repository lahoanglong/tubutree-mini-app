# Code Review — Money-path TubuXu (range `eab2478~1..HEAD`)

Ngày: 2026-06-24. Mức: recall cao (10 finder angle + verify nguồn). Phạm vi: 5 commit money-path
mới (TubuXu, referral, cashback, loyalty/coupon hardening). Đây là phần `/code-review` còn dở ở
`CONTINUE-HERE.md §5` phiên trước — nay đã hoàn tất + đã FIX.

## Bug đã CONFIRMED + FIX (TDD, 326 test pass, typecheck + lint 0 error)

| # | File | Bug | Hậu quả | Fix |
|---|------|-----|---------|-----|
| 1a | `orders.service.ts` cancel | Hủy đơn trả bằng **XU** không hoàn xu (nhánh refund chỉ có WALLET/ZALOPAY) | **Mất tiền user**: xu đã trừ ở checkout không được trả lại khi hủy | Thêm nhánh XU → hoàn `coinsBalance` + ghi `CoinTransaction(+total, ORDER_REFUND:<code>)` trong cùng tx, guard `paymentStatus PAID→REFUNDED` count=1 |
| 1b | `admin.service.ts` reviewReturn | Đổi/trả đơn **XU** không hoàn xu; `wasPaid` chỉ WALLET/ZALOPAY/COD | Mất tiền user khi return được duyệt | Tách `wasPaidToWallet` vs `wasPaidWithXu`; XU hoàn `coinsBalance` (KHÔNG hoàn ví — xu hoàn vào ví = biến xu thành tiền rút được) + ghi sổ cái |
| 2 | `game.service.ts` buySeeds | Đọc `totalSeeds` ngoài tx rồi **set giá trị tuyệt đối** → lost-update | 2 lệnh mua song song: trừ xu 2 lần nhưng chỉ +1 lần seeds; cap bị vượt | `updateMany` increment + guard `totalSeeds <= cap-seeds` atomic trong tx; count=0 → throw rollback |
| 3 | `cashback.service.ts` postback | `grantReferralCoins` await **không có .catch** (trái với comment) | Throw → webhook 5xx → AT retry nhưng row đã CONFIRMED → thưởng referral **mất vĩnh viễn** | Bọc `.catch()` log (đúng ý "lỗi thưởng không làm hỏng postback") |
| 4 | `cashback.service.ts` postback | Nhánh `existing` chuyển trạng thái bằng `update` **không có atomic gate** | 2 postback 'approved' song song trên cùng row PENDING → cộng `cashbackPending` 2 lần (double-credit tiền thật) | Optimistic CAS: `updateMany where {id, status: existing.status}` + điều chỉnh pending trong cùng tx; count=0 → bỏ qua |
| 5 | `cashback.service.ts` postback | `confirmedAt: existing.confirmedAt ?? new Date()` giữ timestamp cũ khi REJECTED→CONFIRMED | Đồng hồ hold 30 ngày không reset → settle ngay, né clawback window | `confirmedAt: nowConfirmed && !wasConfirmed ? new Date() : existing.confirmedAt` (reset khi chuyển TỪ chưa-confirmed SANG confirmed) |
| 6 | `wallet.service.ts` withdraw | `net = amount - fee` không guard `> 0` | Cấu hình sai (phí ≥ min) → trừ ví full + tạo Payout 0/âm | Thêm guard `if (net <= 0) throw` (phòng thủ misconfig) |

## Đã xem xét — KHÔNG phải bug / để backlog (ghi nhận, không sửa)

- **Hoàn ZaloPay vào Ví nội bộ** (`orders.cancel`/`reviewReturn`): CHỦ ĐÍCH (thiết kế hoàn về Ví Tubu).
  ⚠️ Ops note: nếu sau này có refund qua cổng ZaloPay thật thì phải tránh hoàn 2 lần (Ví nội bộ + cổng).
- **Đơn XU vẫn cộng điểm Xanh + tier**: quyết định nghiệp vụ (TubuXu thiết kế chủ đích). Lưu ý vòng
  khuếch đại giá trị: Ví→xu ×1.2 + điểm/tier trên đơn tự-fund. Nếu muốn chặn, tính `pointsEarned`
  bằng 0 cho `paymentMethod === 'XU'` — **cần bạn quyết**.
- **withdraw không có idempotency key**: double-tap/retry có thể tạo 2 Payout. Mitigation hiện tại:
  Payout ở trạng thái REQUESTED, admin duyệt trước khi chi → admin bắt được trùng. Backlog: thêm
  Idempotency-Key cho `/wallet/withdraw` (cần FE gửi key).
- **loyalty `creditOrderPoints` catch nuốt mọi P2002**: hiện chỉ có 1 unique index (idempotency điểm)
  có thể bắn P2002 trong tx đó → an toàn hôm nay. Nếu thêm unique constraint mới trên cùng tx về sau,
  cần thu hẹp catch theo `err.meta.target`. Theo dõi.

## Bất biến được giữ
- `coinsBalance == SUM(CoinTransaction.delta)`: mọi hoàn xu (#1a/#1b) đều ghi kèm CoinTransaction.
- Tiền/xu thao tác atomic (`updateMany` guard `gte`/`lte`/status), idempotent theo guard count=1/CAS.
