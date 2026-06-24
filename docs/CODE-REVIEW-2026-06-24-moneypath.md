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

## Backlog 4 mục — ĐÃ XỬ LÝ (2026-06-24, theo yêu cầu user)

| # | Mục | Cách xử lý |
|---|-----|-----------|
| B1 | **Đơn XU cộng điểm Xanh** (vòng khuếch đại ×1.2 + điểm/tier trên đơn tự-fund) | `checkout.placeOrder`: `pointsEarned=0` cho `paymentMethod==='XU'`, **config `loyalty.earn_points_on_xu` (default false)** — lật `true` nếu muốn xu cũng tích điểm. Tier-recalc theo điểm nên cũng không bị thổi. |
| B2 | **withdraw không idempotency** (double-tap/retry → 2 Payout) | Thêm `Payout.idempotencyKey @unique` (migration `20260624010000_payout_idempotency`); `wallet.withdraw` nhận key → pre-check trả payout cũ + catch P2002 race; controller đọc header `Idempotency-Key`; FE `wallet.tsx` sinh key/lần rút (regenerate sau success), mirror place-order. |
| B3 | **Hoàn ZaloPay vào Ví nội bộ** (rủi ro double-refund nếu thêm refund cổng) | Xác nhận **an toàn in-app** (guard count=1 ở cancel + reviewReturn). Ghi **ops note** `docs/ZALOPAY-SETUP.md §5` + comment ở 2 chỗ hoàn tiền: 1 đơn chỉ hoàn 1 kênh; nếu thêm refund cổng phải bỏ ZALOPAY khỏi nhánh hoàn-Ví. |
| B4 | **loyalty `creditOrderPoints` nuốt mọi P2002** | Thu hẹp: trong catch **re-query** bản ghi `reason` — chỉ skip nếu đã tồn tại (đúng idempotency index); P2002 từ constraint khác → row chưa có → **re-throw** (không âm thầm mất điểm). |

Tổng kết backlog: **+5 test mới, 331 test pass, typecheck (api+FE) + lint 0 error.**

## Vòng review #2 — soi lại CHÍNH các fix vừa làm (587a07c..HEAD)

3 finder song song + verify trên diff của phiên. Core (refund XU / CAS cashback / idempotency
withdraw / P2002 loyalty) **xác nhận đúng**. 5 mục hoàn thiện thêm + 2 mục defer:

| # | File | Vấn đề | Fix |
|---|------|--------|-----|
| F1 | checkout.service.ts | `!earnPointsOnXu` truthiness: config Json kiểu chuỗi `"false"` là truthy → XU lại tích điểm | So sánh `=== true` |
| F2 | loyalty.service.ts `recalcTier` | B1 mới chặn ĐIỂM, chưa chặn **chi tiêu lên HẠNG** — đơn XU vẫn vào `spent12m` → lên hạng rẻ bằng xu | Loại `paymentMethod:'XU'` khỏi aggregate (gate cùng config `earn_points_on_xu`) |
| F3 | admin.service.ts `reviewReturn` | Hoàn nhưng **để paymentStatus='PAID'** (landmine + lệch với cancel) | Flip `PAID→REFUNDED` count=1 + gate refund → chống double-refund nhất quán 2 path |
| F4 | wallet.service.ts `withdraw` | Header `Idempotency-Key: ''` (rỗng) ghi vào DB → lệnh rút thứ 2 đụng unique → P2002 ra 500 | Chuẩn hoá `''`/khoảng trắng → `undefined` |
| F5 | wallet.tsx (FE) | withdrawKey chỉ regenerate onSuccess → sửa số sau khi lỗi có thể dùng lại key cũ | Regenerate khi MỞ Sheet rút (mỗi phiên rút = key mới) |

**Defer (ghi nhận, không sửa):**
- **Thưởng referral mất nếu `grantReferralCoins` lỗi transient** (non-P2002): `.catch` nuốt + trả 200 → AT không retry, row đã CONFIRMED nên không thưởng lại. Xác suất thấp, là tradeoff chủ đích. **Backlog:** cron backfill quét cashback CONFIRMED có `referredById` mà chưa có reward → gọi lại `grantReferralCoins` (idempotent).
- **withdraw idempotency-key không bind theo amount/bank:** dùng lại key với số khác sẽ trả payout cũ. Hiện **an toàn tiền** (ví chỉ trừ 1 lần, payout REQUESTED admin duyệt) + F5 đã thu hẹp; chỉ là lệch hiển thị hiếm gặp.

Tổng kết vòng #2: **+5 test (336 pass), typecheck (api+FE) + lint 0 error, FE build sạch.**

## Bất biến được giữ
- `coinsBalance == SUM(CoinTransaction.delta)`: mọi hoàn xu (#1a/#1b) đều ghi kèm CoinTransaction.
- Tiền/xu thao tác atomic (`updateMany` guard `gte`/`lte`/status), idempotent theo guard count=1/CAS.
