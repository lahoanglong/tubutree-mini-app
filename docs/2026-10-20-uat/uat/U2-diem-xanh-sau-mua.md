# U2 — Điểm Xanh và sau mua: khách quay lại ở mọi hạng, Mini App 390×844

Làn thay cho lane 2 của bộ khung UAT (`docs/2026-10-20-uat/tools/uat-harness/README.md`). Chạy trên lane 7 vì lane 2 bận cổng. Lý do ở mục "Hạn chế bộ khung".

- **Máy chạy:**
  - API thật chạy từ `apps/api/dist` ở cổng 3271. `dist/main.js` được build lúc 21:58 ngày 19/10.
  - Mini App chạy ở cổng 3273, Vite thật, zmp-sdk giả.
  - Giả Pancake chạy ở cổng 3278.
  - Web không bật.
- **Dữ liệu:**
  - Postgres 127.0.0.1:25432, DB `tubutree_uat_l7`, chép mới từ `tubutree_uat_tpl` (`lane-up.sh 7 --fresh`) lúc 23:22 ngày 19/10.
  - Redis 26379 db 7, đã FLUSHDB.
  - Không đụng DB và Redis dùng chung.
- **Mã nguồn:**
  - Worktree `uat/2026-10-20`, HEAD `b2a42a53`.
  - Commit cuối đổi `apps/` là `becd4663` (19:28). Các commit sau đó chỉ đổi `docs/`.
- **Phạm vi:** không sửa mã ứng dụng. Chỉ ghi báo cáo này, ảnh trong `uat/shots/U2-diem-xanh-sau-mua/` và script trong `uat/scripts/U2-diem-xanh-sau-mua/`.
- **Lượt chạy tính kết quả:** một lượt liền mạch trên DB mới, từ 23:22 đến 23:42 (16:22Z đến 16:42Z), theo thứ tự a → g. Mỗi ca ghi `results/<ID>.json`, gồm từng kiểm tra, chi tiết và bằng chứng.
- **Dọn dẹp:** cuối phiên đã chạy `lane-down.sh 7 --drop`. Lệnh này dừng API, Vite và Pancake của lane 7, xoá `tubutree_uat_l7` và FLUSHDB Redis db 7. Sau đó các cổng 3271, 3273, 3278 đều trống.

**Kết quả: 34 ca, gồm 33 PASS, 1 FAIL, 0 BLOCKED.**

- FAIL: U2-19b. Không đổi được chu kỳ giao của gói định kỳ đang chạy, cả trên màn Sửa lẫn qua API. Chi tiết ở U2-B01.
- Có 1 ghi nhận cần chủ quyết từ ca PASS: U2-B02, chi tiêu xét hạng có cộng phí giao (từ U2-06).
- Sau mọi bước, `reconcile-points.ts` và `reconcile-wallet.ts` chạy trên DB lane báo 0 user lệch (U2-27, U2-28).

## Chạy lại

Các script nối trạng thái với nhau, nên chạy đúng thứ tự trên một lane mới. `u2-e` thoát mã 1 khi U2-19b còn FAIL, nên dùng `;` trước `u2-f`.

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
H=docs/2026-10-20-uat/tools/uat-harness
bash $H/lane-down.sh 7; bash $H/lane-up.sh 7 --fresh
cd docs/2026-10-20-uat/uat/scripts/U2-diem-xanh-sau-mua
node u2-a-earn.mjs 7        # U2-01..06c  tích điểm theo hạng, điểm chờ, trần 20%, lên/rớt hạng
node u2-b-expiry.mjs 7      # U2-07..08   nhắc sắp hết hạn, hết hạn 12 tháng (FIFO)
node u2-c-platform.mjs 7    # U2-09..15b  quét/nhập mã vận đơn sàn (B6), trần tháng
node u2-d-chat.mjs 7        # U2-16..17   đơn CSKH theo SĐT (B9), giữ 30 ngày, LAPSED
node u2-e-subs.mjs 7;       # U2-18..22   định kỳ: tạo, sửa, đổi chu kỳ, bỏ kỳ, job, huỷ
node u2-f-after.mjs 7       # U2-23..26   huỷ trước giao, Ví Tubu, trả một phần, trả nốt
node u2-g-reconcile.mjs 7   # U2-27..28   reconcile-points.ts, reconcile-wallet.ts (DRY-RUN)
bash $H/lane-down.sh 7 --drop
```

- Thêm `--headed` để xem trình duyệt.
- `u2-a-earn.mjs` nhận thêm `--only U2-01,U2-03`.
- Lane mặc định là 7, đổi bằng tham số đầu hoặc `U2_LANE`.

**Cách đối chiếu sổ.** Mọi ca có tiền hoặc điểm đều gọi `ledger(userId)` trong `u2lib.mjs`, trước và sau thao tác:

```sql
SELECT "pointsBalance", "pointsConvertedBalance", "walletBalance", "tierId" FROM users WHERE id = $1;
SELECT lot, SUM(delta), COUNT(*) FROM points_transactions WHERE "userId" = $1 GROUP BY lot;
SELECT SUM(delta), COUNT(*) FROM wallet_transactions WHERE "userId" = $1;
```

- Ca chỉ PASS khi `pointsBalance = SUM(delta lô STANDARD)` và `walletBalance = SUM(wallet_transactions.delta)`.
- Từng dòng sổ được đọc theo `reason`: `ORDER_DELIVERED:<mã>`, `ORDER_REDEEM:`, `ORDER_REFUND_POINTS:`, `RETURN_REVERSED:`, `RETURN_REFUND_POINTS:`, `ORDER_REVERSED:`, `POINTS_EXPIRED`, `MARKETPLACE_ORDER[_REVERSED]:<pancakeId>`, `PANCAKE_CHAT_ORDER:<pancakeId>`.
- Dưới đây, "sổ" nghĩa là kết quả các truy vấn trên.

**Dữ liệu khách:**

| Khách | SĐT | Hạng | Ghi chú |
|---|---|---|---|
| `uat_u2_mam` | 0901000021 | Mầm Xanh | Script tạo |
| `uat_u2_daithu` | 0901000022 | Đại Thụ | Script tạo, lên hạng nhờ đơn 20.250.000đ trả bằng chuyển khoản |
| `uat_returning` | 0901000003 | Lộc Biếc | Seed mẫu |
| `uat_new` | | | Seed mẫu |
| `uat_u2_chatnew` | | | Khách mới, chưa có SĐT, dùng cho B9 |

**Cờ đã bật trên lane.** Cờ B6 và B9 mặc định TẮT lúc mở khách. Script bật chúng trên DB lane qua `PUT /admin/config`:

- `loyalty.marketplace_claim_enabled`
- `pancake.external_lookup_enabled`
- `loyalty.chat_order_points_enabled`

Kết quả U2-09..U2-17 chỉ đúng khi chủ bật các cờ này.

## Bảng ca

Vai trò ở mọi ca là khách quay lại, trừ khi ghi khác. Ảnh nằm trong `shots/U2-diem-xanh-sau-mua/`. JSON đầy đủ nằm trong `scripts/U2-diem-xanh-sau-mua/results/`.

| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|
| U2-01 | Mầm Xanh `uat_u2_mam` | Tích điểm đơn app | Mini App /cart → /checkout → "Đặt hàng · 218.000đ". Webhook Pancake shipped rồi delivered. Bắn lặp webhook delivered và chạy job resync | 199.000đ tiền hàng × 2% × 1 = 3.980 điểm. Phí giao 19.000đ không tính. Cộng khi giao, hạn 12 tháng, không cộng lặp | Báo giá: goods 199.000, ship 19.000, pointsEarned 3.980. Đơn `TUBU2026101980251` total 218.000. Sổ có đúng 1 dòng `ORDER_DELIVERED` +3.980, hạn +365 ngày. Bắn lặp vẫn 1 dòng | `U2-01-checkout.png`, `U2-01-placed.png`. Sổ: số dư 500 → 4.480, SUM STANDARD 4.480 | PASS |
| U2-02 | Lộc Biếc `uat_returning` | Tích điểm đơn có mã giảm | Áp XANH10 trong giỏ, đặt trên Mini App, giao | (289.000 − 28.900) × 2% × 1,2 = 6.242 điểm | Báo giá: discount 28.900, pointsEarned 6.242. DB ghi `pointsEarned` 6.242. Sổ có 1 dòng +6.242 | `U2-02-*.png`. Sổ: 34.400 → 40.642, SUM 40.642 | PASS |
| U2-03 | Đại Thụ `uat_u2_daithu` | Tích điểm hạng cao | Đặt 199.000đ trên Mini App, giao | 199.000 × 2% × 1,5 = 5.970 điểm | pointsEarned 5.970. Sổ có 1 dòng +5.970 | `U2-03-*.png`. Sổ: 405.000 → 410.970, SUM 410.970 | PASS |
| U2-04 | Mầm Xanh | Điểm chờ → dùng được | Ngay sau khi giao U2-01, xem /me/loyalty và màn /loyalty. Lùi `deliveredAt` 8 ngày, xem lại. Chạy job `resyncPending` | Điểm đơn vừa giao bị khoá tới hết cửa sổ đổi/trả 7 ngày. Hết cửa sổ thì dùng được. Số dư không đổi | Trước: lockedPoints 4.480, redeemable 0, lockedUntil = giao + 7 ngày. Báo giá redeemablePoints 0. Sau khi lùi: locked 0, redeemable 4.480. Khoá tính lúc đọc, không cần job (job scanned 0) | `U2-04-loyalty-locked.png`, `U2-04-loyalty-unlocked.png`. Sổ: 4.480 = SUM trước và sau | PASS |
| U2-05 | Lộc Biếc | Dùng điểm, trần 20% | Bật "Điểm Xanh" ở checkout 120.000đ, đặt. Gọi API `pointsToUse` 999.999 | Trừ tối đa 20% tiền hàng. Sổ trừ đúng. Điểm tích tính trên tiền hàng sau giảm | pointsUsed 24.000 = 20% × 120.000. Sổ có `ORDER_REDEEM` −24.000. pointsEarned 2.304 = 96.000 × 2% × 1,2. Gọi API 999.999 bị kẹp, không lỗi | `U2-05-*.png`. Sổ: 40.642 → 16.642, SUM 16.642 | PASS |
| U2-06 | Mầm Xanh | Lên hạng theo ngưỡng | Đơn 1.185.000đ giao (dưới ngưỡng), rồi đơn 210.000đ giao | Ngưỡng Lộc Biếc 1.500.000đ (×1.000). Dưới ngưỡng giữ hạng, đạt ngưỡng lên ngay | Bảng hạng: 1.500.000, 20.000.000, 50.000.000. spent12m 1.447.000 → vẫn MAM_XANH. spent12m 1.657.000 → LOC_BIEC ngay khi giao, hệ số 1,2. Đơn kế báo 4.776 điểm. spent12m có cộng phí giao (xem U2-B02) | `U2-06-loyalty-loc-biec.png`. `users.tierId` = LOC_BIEC | PASS |
| U2-06b | Đại Thụ | Lên hạng thẳng Đại Thụ | Đơn 20.250.000đ chuyển khoản qua `bank-webhook.mjs`, PAID, giao | ≥ 20.000.000đ → Đại Thụ ×1,5. Điểm đơn 2% × 1 (hạng lúc đặt) | Đơn PENDING_PAYMENT → CONFIRMED/PAID. tierId DAI_THU, earnMultiplier 1,5. Sổ có `ORDER_DELIVERED` +405.000 | results `U2-06b.json` (bank event PROCESSED) | PASS |
| U2-06c | Lộc Biếc → Mầm Xanh | Rớt hạng có ân hạn | Trả cả đơn 210.000đ (API khách + admin duyệt + nhận hàng). Chạy cron `tiers.recalc` 2 lần. Lùi `tierGraceUntil` về quá khứ, chạy lại | Rớt hạng có ân hạn 30 ngày (`loyalty.tier_grace_days`), không gia hạn mỗi đêm. Hết ân hạn thì hạ | Đơn RETURNED, sổ có `ORDER_REVERSED` −4.200, ví +210.000. Ngay sau trả vẫn LOC_BIEC, grace null (luồng trả không gọi recalcTier; theo thiết kế, rớt hạng chỉ áp ở cron đêm, `loyalty.service.ts:389-392`). Cron lần 1: LOC_BIEC, grace = +30 ngày. Cron lần 2: grace giữ nguyên. Hết ân hạn: MAM_XANH, hệ số 1 | Sổ: 32.380 → 28.180, SUM 28.180. `users.tierGraceUntil` 2026-11-18 | PASS |
| U2-07 | Mầm Xanh | Nhắc điểm sắp hết hạn | Đặt hạn lô 500 điểm còn 10 ngày, chạy job nhắc. Đổi thành còn 5 ngày, chạy job 2 lần. Mở /loyalty | Nhắc 7 ngày trước hạn, mỗi lô 1 lần | 10 ngày: 0 tin. 5 ngày: 1 dòng `notification_logs` POINTS_EXPIRING INAPP SENT ("500 Điểm Xanh sắp hết hạn vào 24/10/2026"). Chạy lại vẫn 1 dòng. Màn hiện "500 Điểm Xanh sẽ hết hạn ngày 24/10/2026 (còn 5 ngày)" | `U2-07-loyalty-expiring.png` | PASS |
| U2-08 | Mầm Xanh, Lộc Biếc | Hết hạn 12 tháng | Lùi `expiresAt` lô về quá khứ, chạy `points.expire` 2 lần | Trừ phần còn lại của lô (FIFO), không trừ lần hai | (a) Lô 500 chưa tiêu: `POINTS_EXPIRED` −500. (b) Lô 34.400 đã tiêu 24.000: chỉ trừ 10.400. Chạy lại không trừ thêm. /me/loyalty = DB | Sổ: MAM 28.180 → 27.680 = SUM. RET 16.642 → 6.242 = SUM | PASS |
| U2-09 | Lộc Biếc | Quét mã vận đơn Shopee (B6) | /points/scan → "Quét mã" (scanQRCode giả trả `SPXVN05UAT0001`) | 1% × 250.000 = 2.500 điểm, không nhân 1,2, không tính hạng. Cộng từ giao + 14 ngày | 201 CLAIMED 2.500. Claim PENDING, ratePct 1, multiplier 1, countsForTier false, releaseAt = giao + 14 ngày. Màn "2.500 Điểm Xanh đang chờ cộng · Dự kiến cộng từ 30/10/2026". Job trước hạn vẫn PENDING. spent12m và tierPoints không đổi | `U2-09-scan-result.png`. Sổ không có dòng mới: 6.242 = 6.242 | PASS |
| U2-10 | Lộc Biếc | Nhập lại mã của mình | Gõ lại cùng mã ở ô "Ví dụ: SPXVN0123456789" → "Tích điểm" | Trả claim cũ, không tạo claim, không tính lần thử | 201 cùng claimId, "Mã này bạn đã gửi rồi, điểm đang chờ cộng.". Vẫn 1 claim, lần thử 1 → 1 | `U2-10-resubmit.png` | PASS |
| U2-11 | Khách khác `uat_new` | Mã đã có người tích | `uat_new` nhập `SPXVN05UAT0001` | Mỗi mã một lần | 409 ALREADY_CLAIMED. Mini App báo "Mã này đã được dùng để tích điểm trước đó…". Vẫn 1 claim | `U2-11-other-user.png` | PASS |
| U2-12 | Mầm Xanh nhập mã của `uat_new` | Mã của người khác | Nhập mã có SĐT trên đơn khác SĐT thành viên. Chạy job. Chủ đơn gửi. Admin void-and-reopen. Chủ đơn gửi lại | Không tự cộng cho người không phải chủ | Claim REVIEW "3 số cuối SĐT trên đơn khác SĐT thành viên". Job không cộng. Chủ đơn bị 409 khi mã đang bị giữ. Sau mở lại, chủ đơn có claim REVIEW "Mã được nhân viên mở lại, cần người khác duyệt" | `U2-12-other-phone.png`, `U2-12-owner-after-reopen.png` | PASS |
| U2-13 | Lộc Biếc | Mã không có trên Pancake | Gửi 5 mã không tồn tại, rồi 1 mã thật | Báo "chưa thấy", ghi lần thử, khoá sau 5 lần | 5 × 201 SEARCHING "Chưa thấy đơn này. Tubu sẽ tìm lại…". Lần 6 trả 429 LOCKED (khoá cả mã thật trong 24h). `external_claim_attempts` = 5 | `U2-13-not-found.png` | PASS |
| U2-14 | Lộc Biếc, khách chưa có SĐT | Mã không hợp lệ | Gửi đơn Lazada đã hoàn, mã vận đơn đơn app, mã đơn chat. Khách chưa có SĐT gửi mã | Đơn hoàn không tích. Đơn app hoặc chat không tích qua quét | 400 CLOSED, 409 APP_ORDER, 409 CHAT_ORDER, 403 NOT_ELIGIBLE_USER | `U2-14-returned.png` | PASS |
| U2-15 | Lộc Biếc | Đơn sàn đang giao → giao → hoàn | Gửi mã TikTok đang giao. Webhook giao. Lùi 15 ngày, chạy job release. Webhook hoàn. Gửi mã Shopee rồi hoàn khi claim còn chờ | Giao + 14 ngày mới cộng. Hoàn sau khi cộng thì thu hồi. Hoàn khi chờ thì huỷ claim | CLAIMED 2.670 (chưa có ngày). releaseAt = giao + 14 ngày. Job cộng +2.670, không đổi hạng. Hoàn → REVERSED, sổ có −2.670. Shopee hoàn khi chờ → VOIDED, 0 dòng sổ. Danh sách hiện "Đã thu hồi", "Đã huỷ" | `U2-15-claims-list.png`. Sổ: 6.242 → 8.912 → 6.242 = SUM | PASS |
| U2-15b | Đại Thụ | Trần điểm đơn sàn theo tháng | Đặt `loyalty.marketplace_claim_monthly_points_cap` = 3.000, gửi đơn 500.000đ. Trả trần 200.000, gửi lại | Vượt trần thì từ chối, không tạo claim. Đơn sàn ×1 kể cả Đại Thụ | 429 MONTHLY_CAP, không có claim. Gửi lại: CLAIMED 5.000 (×1) | results `U2-15b.json` | PASS |
| U2-16 | Lộc Biếc | Đơn CSKH theo SĐT (B9) | Webhook đơn chat 7700005 (SĐT 0901000003, 210.000đ, đã giao). Job trước hạn. Lùi 15 ngày, job. Bắn lặp | Tự cộng theo SĐT, 2% × hệ số hạng, giao + 14 ngày, tính hạng, có thông báo | Claim PHONE PENDING 5.040 (2% × 1,2), countsForTier. Job trước hạn không cộng. Sau 14 ngày: CREDITED, `PANCAKE_CHAT_ORDER:7700005` +5.040. spent12m +210.000. `notification_logs` CHAT_ORDER_POINTS_CREDITED INAPP SENT. Lặp vẫn 1 dòng | Sổ: 6.242 → 11.282 = SUM | PASS |
| U2-17 | Khách mới `uat_u2_chatnew` | SĐT chưa vào Mini App | Webhook đơn chat 7700006 (0901000013). Lùi hạn, job → giữ. Khách mới đặt đơn trên Mini App, chia sẻ SĐT 0901000013. Đơn 7700008 không ai nhận: hết hạn giữ, job | Giữ 30 ngày. Khách đăng nhập bằng SĐT đó thì nhận điểm. Quá hạn thì không cộng | userId null → HELD_NO_MEMBER, holdUntil = mốc + 30 ngày. Mini App gọi getPhoneNumber → /auth/ensure-phone. Claim gắn khách mới, CREDITED 3.600 (×1). Thông báo LINKED và CREDITED (INAPP SENT). 7700008 → LAPSED, 0 dòng sổ | `U2-17-chat-new-checkout.png`. Sổ: 0 → 3.600 = SUM | PASS |
| U2-18 | Lộc Biếc | Tạo gói định kỳ | Trang sản phẩm "Đặt định kỳ — tiết kiệm" → "4 tuần", "Giao ngay", COD → "Bắt đầu đặt định kỳ". Giao đơn đầu | Giảm định kỳ 12%. Phí giao không tính điểm. Điểm 2% × 1,2 | Gói ACTIVE 4 tuần. Đơn đầu 89.000 − 10.680, ship 19.000, total 97.320, pointsEarned 1.879. Tồn kho −1. nextRunAt +28 ngày. Giao: sổ +1.879 | `U2-18-subscribe-sheet.png`, `U2-18-subscribe-done.png` | PASS |
| U2-19 | Lộc Biếc | Sửa số lượng gói | "Sửa" → "Tăng số lượng" → "Lưu thay đổi" | Sửa được số lượng (Q-13) | PATCH 200, DB quantity 2 | `U2-19-edit.png` | PASS |
| U2-19b | Lộc Biếc | Sửa kỳ: đổi chu kỳ giao | Mở "Sửa gói định kỳ" tìm chọn chu kỳ. `PATCH /me/subscriptions/:id {intervalWeeks: 6}` | Khách đổi được chu kỳ giao (4/6/8/10 tuần) của gói đang chạy (phạm vi giao cho làn U2: "sửa kỳ") | Màn Sửa chỉ có "Số lượng mỗi kỳ", "Thanh toán mỗi kỳ", "Giao tới", không có chu kỳ. API trả 400 "Không nhận trường «intervalWeeks».", DB vẫn 4 | `U2-19b-edit-sheet.png`, results `U2-19b.json` | FAIL (U2-B01) |
| U2-20 | Lộc Biếc | Bỏ qua kỳ | "Hủy" → "Bỏ qua kỳ này" | Lùi 1 chu kỳ, vẫn ACTIVE, không tạo đơn | nextRunAt 16/11 → 14/12 (+28 ngày), ACTIVE, số đơn vẫn 1 | `U2-20-skip.png` | PASS |
| U2-21 | Lộc Biếc | Job tạo đơn kỳ | Đặt nextRunAt về quá khứ, chạy `subscriptions.process-due` 2 lần. Giao đơn kỳ | Tạo 1 đơn kỳ đúng giá và điểm, không trùng | 1 đơn mới: SL 2, 178.000 − 21.360 (12%), ship 0, pointsEarned 3.759 = floor(156.640 × 2% × 1,2). Tồn −2. nextRunAt +28 ngày. Lần 2 không tạo thêm. Giao: sổ +3.759 | Sổ: số dư 16.920 = SUM | PASS |
| U2-22 | Lộc Biếc | Huỷ gói | "Hủy" → "Vẫn hủy". Đặt tới hạn, chạy job | Gói huỷ không ra đơn | CANCELLED. Job không tạo đơn (2 → 2) | `U2-22-cancel.png` | PASS |
| U2-23 | Lộc Biếc | Huỷ đơn COD trước giao | Áp WELCOME30, bật Điểm Xanh, đặt 210.000đ. Ở chi tiết đơn "Hủy đơn" → xác nhận | Hoàn điểm đã tiêu, trả lượt mã, cộng lại tồn, không cộng điểm tích | Đặt: coupon 30.000, pointsUsed 16.920, tồn 149 → 148, `coupon_redemptions` 0 → 1. Huỷ: `ORDER_REFUND_POINTS` +16.920, không có `ORDER_DELIVERED`, tồn 149, `coupon_redemptions` 0 (WELCOME30 không có usageLimit nên usedCount luôn 0). Áp lại WELCOME30 được | `U2-23-checkout.png`, `U2-23-placed.png`, `U2-23-cancel-confirm.png`, `U2-23-cancel-done.png`. Sổ: 16.920 → 0 → 16.920 = SUM | PASS |
| U2-24 | Lộc Biếc | Huỷ đơn đã chuyển khoản | Đơn 270.000đ BANK_TRANSFER, giả ngân hàng → PAID. "Hủy đơn" → chọn "Ví Tubu" | Tiền đã trả hoàn về Ví Tubu, sổ ví khớp | CANCELLED, paymentStatus REFUNDED, refund WALLET COMPLETED 270.000. `wallet_transactions` ORDER_REFUND +270.000. /me/wallet và màn /wallet hiện 270.000đ | `U2-24-cancel-paid-confirm.png`, `U2-24-cancel-paid-done.png`, `U2-24-wallet.png`. Sổ ví: 0 → 270.000 = SUM | PASS |
| U2-24b | Lộc Biếc | Trả bằng Ví Tubu | Checkout chọn "Ví Tubu", đặt 120.000đ, giao | Ví trừ đúng, đơn PAID, cộng điểm như thường | WALLET/PAID, ORDER_PAY −120.000. pointsEarned 2.880 = 120.000 × 2% × 1,2. Giao: sổ +2.880 | `U2-24b-*.png`. Sổ ví: 270.000 → 150.000 = SUM | PASS |
| U2-25b | Lộc Biếc | Trả một phần đơn có dùng điểm | Đơn 289.000đ dùng 16.920 điểm, giao. Trả dòng 79.000đ, admin duyệt | Hoàn phần điểm đã tiêu của dòng và tiền phần còn lại vào Ví. Thu hồi điểm tích theo tỉ lệ | refundAmount 74.375 + pointsRefunded 4.625 = 79.000. 4.625 ≈ 16.920 × 79.000/289.000. pointsReversed 1.785 ≈ 6.529 × 79/289. Sổ có `RETURN_REFUND_POINTS` +4.625 và `RETURN_REVERSED` −1.785 | `U2-25b-*.png`. Sổ: 9.409 → 12.249 = SUM. Ví 150.000 → 224.375 = SUM | PASS |
| U2-25 | Đại Thụ | Trả một phần sau giao | Đơn COD 199.000đ giao. Mini App "Yêu cầu đổi/trả" → "Trả Nước lau kính…" → "Sản phẩm lỗi, hỏng" → "Gửi yêu cầu". Admin preview, duyệt, nhận hàng | Khoá điểm đơn khi chờ. Thu hồi điểm theo tỉ lệ. Tiền hoàn về Ví Tubu. Chi tiêu xét hạng trừ phần hoàn | Chờ: lockedReturnPoints 5.970. APPROVED refund 79.000, pointsReversed 2.370 = 5.970 × 79/199. Ví ORDER_REFUND +79.000. spent12m 20.648.000 → 20.569.000. Hết khoá. Chi tiết đơn: "đã thu lại 2.370 điểm do trả hàng", "đã hoàn 79.000đ vào Ví Tubu" | `U2-25-return-sheet.png`, `U2-25-return-sent.png`, `U2-25-order-after-return.png`. Sổ: 421.940 → 419.570 = SUM. Ví 0 → 79.000 = SUM | PASS |
| U2-26 | Đại Thụ | Trả nốt phần còn lại | Gửi trả dòng còn lại (API), duyệt | Đơn RETURNED. Tổng thu hồi = điểm đã cộng. Hoàn 120.000đ | RETURNED. Thu hồi −2.370 −3.600 = −5.970 = điểm đã cộng. Ví +120.000 | Sổ: 419.570 → 415.970 = SUM. Ví 79.000 → 199.000 = SUM | PASS |
| U2-27 | Kỹ thuật | Đối soát điểm cuối phiên | `node node_modules/tsx/dist/cli.mjs scripts/reconcile-points.ts` (cwd `apps/api`, DATABASE_URL = DB lane, DRY-RUN). SQL `pointsBalance ≠ SUM(delta) theo lô` mọi user | 0 lệch | "Lô STANDARD: 0 user lệch… Lô CONVERTED: 0 user lệch… ✅ Không có user nào lệch". SQL trả 0 dòng. Số dư cuối: uat_returning 12.249, uat_u2_chatnew 3.600, uat_u2_daithu 415.970, uat_u2_mam 27.680 | results `U2-27.json` | PASS |
| U2-28 | Kỹ thuật | Đối soát ví cuối phiên | `reconcile-wallet.ts` (DRY-RUN). SQL `walletBalance ≠ SUM(wallet_transactions)` | 0 lệch | "User bị lệch: 0, Chênh ròng 0đ". SQL 0 dòng. Ví: uat_returning 224.375, uat_u2_daithu 199.000, uat_u2_mam 210.000 | results `U2-28.json` | PASS |

## Lỗi tìm thấy

Trước khi ghi, đã đối chiếu với các tài liệu sau:

- `docs/2026-10-review/findings-catalog.md`: C-015 và Q-13 về định kỳ. C-015 chỉ nói sửa số lượng và địa chỉ, không nói chu kỳ.
- `docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md` và `impl/*.md`.
- `docs/2026-10-review/impl/PD-3-SPEC.md:180,212`. Mục này giải thích việc tích điểm và xét hạng trên tiền sau giảm bằng điểm là cố ý, nên không ghi thành lỗi.
- Các báo cáo D1–D15 cùng đêm. D11-04 là chuyện bậc giảm giá định kỳ, khác với hai mục dưới đây.

### U2-B01 — Không đổi được chu kỳ giao của gói định kỳ đang chạy

- **Mức:** P3.
- **Nhóm:** cần chủ quyết.
- **Vị trí:**
  - `apps/api/src/modules/subscriptions/subscriptions.controller.ts:23-27`: `UpdateSubDto` chỉ có `quantity`, `addressId`, `paymentMethod`. Lớp kiểm tra trả 400 khi có trường lạ.
  - `apps/miniapp/src/components/subscription-edit-sheet.tsx:36`: `SubscriptionEditSheet` chỉ có số lượng, thanh toán và địa chỉ.
- **Kịch bản:**
  1. Khách Lộc Biếc tạo gói "4 tuần" và muốn chuyển sang 6 tuần.
  2. Màn "Sửa gói định kỳ" không có chọn chu kỳ. Ảnh `U2-19b-edit-sheet.png` chỉ có các mục "Số lượng mỗi kỳ", "Thanh toán mỗi kỳ", "Giao tới".
  3. `PATCH /me/subscriptions/:id {"intervalWeeks":6}` trả `400 ["Không nhận trường «intervalWeeks»."]`. DB vẫn `intervalWeeks` 4.
  4. Cách duy nhất là huỷ gói rồi tạo gói mới. Làn này chưa kiểm chứng hệ quả của việc tạo lại (ngày giao kế, bậc giảm giá).
- **Bằng chứng:** `results/U2-19b.json`. Q-13 (findings-catalog.md:322-330) chốt "sửa được số lượng/địa chỉ" và không nhắc chu kỳ. Vì vậy mục này có thể là chủ đích. Phạm vi giao cho làn U2 có ghi "sửa kỳ", nên ghi FAIL để chủ quyết.
- **Đề xuất sửa nếu chủ muốn có:**
  - Thêm `@OptionalNotNull() @IsIn([4, 6, 8, 10]) intervalWeeks?: number` vào `UpdateSubDto`.
  - Trong service, đổi `intervalWeeks`. Chủ chọn một trong hai: giữ `nextRunAt` hiện tại, hoặc tính lại từ đơn kỳ gần nhất.
  - Thêm chọn chu kỳ vào sheet, dùng lại `subscription-options.tsx`.
- **Test đề xuất:**
  - Jest: PATCH `intervalWeeks` 6 → 200, DB 6, `nextRunAt` theo luật đã chọn. PATCH 5 → 400.
  - Vitest sheet: có 4 lựa chọn chu kỳ, lưu gửi đúng `intervalWeeks`.
- **Vùng file:** `api/subscriptions`, `miniapp/components` (subscription-edit-sheet).
- **Script tái hiện:** `node u2-e-subs.mjs 7` (ca U2-19b). Cần chạy U2-18 trước trong cùng lượt.

### U2-B02 — Chi tiêu 12 tháng xét hạng có cộng phí giao

- **Mức:** P3.
- **Nhóm:** cần chủ quyết.
- **Ca:** ghi nhận từ ca PASS U2-06.
- **Vị trí:**
  - `apps/api/src/modules/loyalty/loyalty.service.ts:358`: `order.aggregate({ _sum: { total: true } })`.
  - `apps/api/src/modules/checkout/checkout.service.ts:1170`: `total: a.goodsAfterAll + shipping`.
- **Kịch bản:**
  1. `uat_u2_mam` có 2 đơn trả ship 19.000đ và 2 đơn miễn ship.
  2. spent12m là 1.447.000. Trong đó có 38.000đ phí giao, tiền hàng chỉ 1.409.000.
  3. Khách hay mua đơn nhỏ có ship sẽ lên hạng sớm hơn khách mua cùng lượng hàng với đơn miễn ship.
  4. Luật chốt nói điểm tích "không tính ship". Ngưỡng hạng chỉ ghi "×1.000", không nói có tính ship hay không.
- **Bằng chứng:** `results/U2-06.json`, mục `spent12m có tính phí giao`, có 4 đơn kèm `subtotal`, `shippingFee`, `total`. PD-3-SPEC.md:212 chỉ bàn phần trả bằng điểm, không bàn ship.
- **Đề xuất sửa nếu chủ muốn chỉ tính tiền hàng:**
  - Cộng `total − shippingFee` trong `spending12m`.
  - Phần hoàn của đơn trả một phần trừ `shippingRefund` tương ứng.
  - Đồng bộ tiến độ "còn X đ để lên hạng" ở `getOverview`, vì hàm này dùng chung `spending12m`.
- **Test đề xuất:** 2 đơn DELIVERED (100.000 + ship 19.000, 200.000 + ship 0) → spent12m 300.000.
- **Vùng file:** `api/loyalty`.
- **Script tái hiện:** `node u2-a-earn.mjs 7 --only U2-01,U2-06` trên lane mới.

### Ghi nhận khác (không phải lỗi, có bằng chứng)

- **Rớt hạng chỉ áp ở cron đêm 03:15.** Luồng trả hàng (`order-returns.service.ts:455` → `reverseOrderPoints`) không gọi `recalcTier`. Vì vậy ân hạn 30 ngày bắt đầu từ lần cron kế tiếp, tức chậm tối đa khoảng 1 ngày. Comment ở `loyalty.service.ts:389-392` ghi đây là thiết kế. U2-06c xác nhận cron đặt grace +30 ngày, không gia hạn, và hết hạn thì hạ hạng.
- **Đơn chat (B9) thì khác.** Khi đảo điểm, luồng này gọi `recalcTier` ngay (`external-claim-status.ts:243`). Không ảnh hưởng tiền.
- **Khoá sau 5 mã không thấy (U2-13) chặn cả mã thật trong 24 giờ.** Ở U2-13, lần 6 là mã có thật vẫn nhận 429 LOCKED. Luật khoá chặn mọi lần nhập, nên không coi là lỗi. CSKH cần biết điều này.
- **Điểm đơn app hết khoá theo phép đọc** (giao + 7 ngày hoặc khi không còn yêu cầu trả đang chờ), không cần job. Job `resyncPending` chạy được nhưng không có gì để sửa (scanned 0).

### Chưa kiểm chứng trong làn này

- Hạng Cổ Thụ ×2. Phạm vi chỉ yêu cầu Mầm Xanh, Lộc Biếc và Đại Thụ.
- Trần giải POINTS của vòng quay (`SPIN_POINTS_PRIZE_MAX` = 100). Mục này thuộc game, ngoài hành trình sau mua.
- Hoàn tiền về tài khoản ngân hàng hoặc phương thức gốc. Làn chỉ thử hoàn về Ví Tubu.
- Trả hàng có hoàn phí giao (shippingRefund > 0).
- Đơn kỳ trả bằng Ví hoặc chuyển khoản.
- Định kỳ cộng với giảm giá theo hạng hoặc giá flash.
- Tin OA/ZNS thật (B9, nhắc hết hạn).

## Hạn chế bộ khung

Các mục dưới đây không tính là FAIL.

1. **Lane 2 không dùng được.**
   - `lane-up.sh 2` dừng vì cổng 3221 đang bận.
   - Tiến trình giữ cổng là `node dist/main.js`, PID 68811. Cwd của nó là `apps/api` của worktree `uat`, cha là launchd (PPID 1). `state/lane-2/pids/` rỗng, nên tiến trình này không phải của `lane-up.sh` và không do làn này tạo. Làn này không đụng tới nó.
   - Đã chạy lane 7, lane dự phòng mà README ghi. Lane 2 chưa từng được dựng nên không có gì để `lane-down.sh 2`.
2. **`run-job.mjs` thoát mã khác 0 sau khi job đã chạy.**
   - Khi đóng Nest context, ioredis ném "Connection is closed" không được bắt.
   - `u2lib.runJob()` chấp nhận lỗi này khi stderr có `[run-job]`, và ghi `harnessExitError`.
   - Job kiểu cron trả `void`, nên `result` là null. Các ca kiểm tra kết quả bằng DB, không dựa vào giá trị job trả về.
3. **Thời gian được giả bằng cách lùi cột DB, không đổi đồng hồ.**
   - Các cột đã lùi: `orders.deliveredAt/shippedAt/deliveredEffectsAt/createdAt`, `points_transactions.expiresAt`, `external_orders.deliveredAt`, `external_points_claims.releaseAt/holdUntil`, `subscriptions.nextRunAt`, `users.tierGraceUntil`.
   - Lịch cron thật (03:15 xét hạng, 30 phút cho claim) không chạy. Phương thức cron được gọi thẳng qua `run-job.mjs`.
4. **Zalo phía máy chủ là giả.**
   - Đổi token Zalo và `getPhoneNumber` đều là giả (`POST /auth/zalo-mini-app 200 [giả]`, `/auth/ensure-phone 200 [giả]`).
   - OA/ZNS không gửi trên lane. Làn chỉ kiểm `notification_logs` kênh INAPP trạng thái SENT.
5. **Pancake là giả.**
   - Đơn sàn và đơn chat lấy từ fixture `state/lane-7/pancake/platform-orders.json`.
   - Script thêm 2 đơn vào file của lane: 7700007 cho U2-15b và 7700008 cho U2-17.
   - Hình dạng dữ liệu Pancake thật cho đơn sàn chưa kiểm chứng ở làn này.
6. **Ngân hàng giả** qua `bank-webhook.mjs`, dùng ở U2-06b và U2-24.
7. **Web không bật**, vì phạm vi chỉ là Mini App. Theo luật đã chốt, web không có quét mã sàn và không tích điểm theo SĐT.
8. **Tải máy cao do phiên khác chạy `next build` và `tsc`.** Load lên 45–100 trong lúc chạy. Trước mỗi script, làn chờ cho load dưới 40. Kết quả không bị ảnh hưởng: mọi ca PASS ở lượt chạy liền mạch.
