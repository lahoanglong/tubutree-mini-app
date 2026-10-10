# PA-7 — Luật voucher thưởng + giới thiệu

## C-059 (A5N-09; Q-05) — Voucher chào mừng/sinh nhật/winback chỉ cho user thật; birthday/winback theo lô — XONG

Commit: `c7a5662` fix(vouchers): welcome/birthday/winback chỉ cấp cho user thật, birthday/winback quét keyset theo lô không bỏ sót (C-059)

### Đã sửa (`apps/api/src/modules/vouchers/vouchers.service.ts`)
- "User thật" = có SĐT, HOẶC có `zaloId` không bắt đầu bằng `guest_` (khách deviceId mang `guest_<deviceId>`, dòng guest đã gộp mang `guest_..._merged_...`). Một điều kiện dùng chung: `REAL_USER_WHERE` (Prisma, cho welcome) và `REAL_USER_SQL` (raw SQL, cho birthday/winback; dùng `left(zaloId,6)` thay LIKE vì `_` là ký tự đại diện).
- Welcome: thêm bộ lọc user thật vào truy vấn cấp (vẫn quét cursor như cũ).
- Birthday: bỏ `LIMIT 500` không ORDER BY → keyset `u.id > cursor ORDER BY u.id LIMIT 500`, lặp đến khi hết; lọc user thật.
- Winback: cùng lớp lỗi (`LIMIT 500` không ORDER BY) → JOIN users lọc user thật + keyset theo `o."userId"`.
- Idempotent: giữ khoá có sẵn, code coupon tất định `<REASON>-<userId>` + `coupon.code @unique` (grant() chạy ngoài transaction, P2002 ⇒ coi như đã cấp).
- Nơi cấp lúc đăng ký: KHÔNG có. `auth.controller.ts:28` (guest login) không cấp voucher; voucher chào mừng chỉ được cấp qua cron `welcomeVouchers`, nên lọc ở truy vấn cron là đủ. Không sửa auth.

### Test thêm (đỏ → xanh)
`apps/api/test/integration-race/vouchers-real-user.race-spec.ts` (Postgres thật `tubu_it_pa7:5547`):
- (a) welcome: guest / guest đã gộp = 0, user Zalo = 1, user có SĐT = 1 (cron chạy 2 lần).
- (b) birthday: 8 user thật với lô 3 → mỗi người đúng 1, guest 0, chạy 2 lần.
- (c) winback: 5 user thật với lô 2 → mỗi người đúng 1, guest có đơn cũ 0, chạy 2 lần.
- (d) birthday: 2 lượt cron chạy song song → mỗi user đúng 1 voucher.
- (e) birthday: 520 user thật cùng ngày sinh, lô mặc định → cấp đủ 520.

ĐỎ (trước khi sửa):
```
Tests:       3 failed, 1 passed, 4 total    # (a) guest nhận welcome, (b)(c) guest nhận birthday/winback = 1
[e] birthday 520 users granted=486          # LIMIT 500 không ORDER BY bỏ sót người
```
XANH (sau khi sửa):
```
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5547/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand vouchers-real-user
    [a] welcome guest=0 merged=0 zalo=1 phone=1
    [b] birthday real=[1,1,1,1,1,1,1,1] guest=0
    [c] winback real=[1,1,1,1,1] guest=0
    [d] birthday parallel real=[1,1,1,1,1]
    [e] birthday 520 users granted=520
Tests:       5 passed, 5 total
```
Kiểm chứng khác:
- `npx jest --maxWorkers=1 src/modules/vouchers` → `Tests: 15 passed, 15 total`
- `npx tsc --noEmit -p tsconfig.json` (apps/api) → exit 0
- `npx eslint src/modules/vouchers/vouchers.service.ts test/integration-race/vouchers-real-user.race-spec.ts` → 0 lỗi, 0 cảnh báo

Migration: không.

### Giả định
- SĐT trên `users.phone` chỉ được ghi từ `phoneToken` Zalo (auth.service: loginWithZaloMiniApp / attachPhoneIfMissing / upgrade guest), không có API nào cho user tự nhập SĐT tài khoản ⇒ có SĐT = đã xác thực. Guest đã xác thực SĐT qua Zalo được tính là user thật.
- Giữ nguyên các bộ lọc hiện có (welcome: role CUSTOMER + chưa có đơn + tạo trong 24h); birthday/winback không thêm lọc role.

### Việc còn lại / ghi chú
- Guest tạo > 24h rồi mới nâng cấp tại chỗ thành tài khoản Zalo (cùng dòng `users`) sẽ không vào cửa sổ welcome 24h (cửa sổ tính theo `createdAt`, không có cột thời điểm nâng cấp). Trước đây guest đó đã nhận voucher khi còn là guest; nay không nhận. Nếu cần, thêm cột thời điểm xác thực và tính cửa sổ theo cột đó (cần migration, ngoài phạm vi lượt này).
- `milestoneVouchers` vẫn `LIMIT 1000` không ORDER BY và không lọc user thật (không thuộc C-059/Q-05, chỉ áp cho đơn DELIVERED). Nên xử lý cùng kiểu keyset ở gói sau.
- Birthday dùng ngày/tháng theo giờ máy chủ (`new Date().getMonth()/getDate()`), không theo giờ VN. Cron 01:00 UTC = 08:00 VN cùng ngày nên hiện không lệch; chưa sửa.

## C-003 (A1-005; Q-05) — Một chương trình giới thiệu: xu cho người mời theo đơn thứ 2, thu hồi khi trả hàng — XONG

Commit: `10b1c2c` fix(affiliate): một chương trình giới thiệu - xu cho người mời theo đơn thứ 2, thu hồi khi trả hàng, gỡ voucher REFER (C-003)

### Đã sửa
- **Gỡ voucher REFER/REFERRED 50k+50k** (`affiliate.service.ts`): `grantReferralReward(orderId)` (vẫn được `OrderStatusService.setStatus` gọi lúc DELIVERED) không tạo coupon nữa; bỏ `grantReferralVoucher`. Đơn đại lý và đơn CTV lên hộ không xét thưởng. Coupon `REFER-*`/`REFERRED-*` đã cấp giữ nguyên (không xoá).
- **Thưởng xu người mời** (`wallet/coins.service.ts` `grantReferralOrderReward`, hằng số + khoá ở `wallet/referral-reward.ts`):
  - Người mời = `users.referredById` của chủ đơn. Người mời role `AFFILIATE` (CTV) không nhận (CTV chỉ hưởng hoa hồng).
  - Đơn hợp lệ = đơn RETAIL, không lên hộ, `status = DELIVERED`, sắp theo `createdAt`. Thưởng khi đơn thứ 2 đặt trong `referral.window_days` (mặc định 30) ngày kể từ đơn đầu. Số xu = `coins.referrer_reward` (đúng cơ chế xu hiện có, không tạo loại tiền mới).
  - Idempotent: 1 dòng `coin_transactions` refType `REFERRAL`, reason `REFERRAL_ORDER2:<refereeId>` (partial unique index `coin_transactions_referral_unique` có sẵn) ghi bằng `createMany skipDuplicates` (ON CONFLICT DO NOTHING, không bắt P2002 trong tx). `refId = "<đơn đầu>:<đơn thứ 2>"`.
  - Cấp và thu hồi đều `SELECT … FOR UPDATE` dòng `users` của người được mời trước khi đọc, nên lần cấp không thể đọc "2 đơn đã giao" trong khi lần trả hàng đang kiểm "chưa có thưởng".
- **Thu hồi** (`orders/order-reversal.service.ts` → `revokeReferralRewardForOrder`): trong tx của lần lật trạng thái (chung cho setStatus/khách huỷ/admin duyệt trả hàng), đơn có ảnh chụp DELIVERED (tức là đang bị RETURNED) và là đơn đầu hoặc đơn thứ 2 của lần thưởng → ghi dòng đối ứng `REFERRAL_ORDER2_REVOKE:<refereeId>` (cùng unique index ⇒ trả lại lần nữa không trừ thêm). Trừ tối đa số dư hiện có (không âm); phần thiếu ghi dòng `delta 0`, refType `REFERRAL_DEBT`, reason `REFERRAL_ORDER2_DEBT:<refereeId>:<số xu thiếu>` + log warn. Admin lọc: `SELECT * FROM coin_transactions WHERE "refType"='REFERRAL_DEBT'`.
- **Gỡ trigger xu giới thiệu gắn cashback** (`cashback/cashback.service.ts`): bỏ 2 chỗ gọi `grantReferralCoins` (postback + admin duyệt) và bỏ hẳn `CoinsService.grantReferralCoins` (thưởng cả người mời `REFERRAL_CASHBACK:` lẫn người được mời `REFERRED_CASHBACK:`). Người được mời đã nhận xu kiểu cũ (`REFERRAL_CASHBACK:<refereeId>`) thì không được thưởng lần 2 theo đơn thứ 2.
- Số bạn giới thiệu thành công (`getOverview.referralSuccessCount`, mốc `coins.referral_milestones`) = thưởng kiểu cũ + thưởng mới − lần đã thu hồi. `referralEarned` (tổng delta refType REFERRAL) tự trừ dòng thu hồi.
- Seed: thêm `referral.window_days = 30`; sửa mô tả `coins.referrer_reward`; `coins.referee_reward` ghi "không còn dùng".

### Test thêm (đỏ → xanh)
`apps/api/test/integration-race/referral-order2.race-spec.ts` (Postgres thật `tubu_it_pa7:5547`; OrderStatusService + OrderReversalService + AffiliateService + CoinsService thật):
(a) đơn đầu giao: không voucher, chưa xu · (b) đơn thứ 2 trong 30 ngày: người mời +5000 đúng 1 lần, người được mời 0, đơn thứ 3 không thêm · (c) 2 đơn "thứ 2" giao song song + 5 lần gọi thưởng song song → 1 dòng thưởng · (d) ngoài 30 ngày → 0 · (e) người mời CTV → 0 xu, 0 voucher · (f) trả đơn thứ 2 → thu hồi, trả lặp không trừ thêm, đơn sau không thưởng lại · (g) trả đơn đầu → thu hồi · (h) người mời đã tiêu 3000 → trừ 2000, số dư 0, dòng REFERRAL_DEBT thiếu 3000 · (i) thưởng và trả đơn đầu song song ×5 → người mời luôn còn 0 · (j) đã có xu kiểu cũ → không thưởng lần 2. Mọi ca đều kiểm `coinsBalance == SUM(delta)`.

ĐỎ (trước khi sửa):
```
    × (a) đơn đầu giao xong: không voucher REFER/REFERRED, chưa thưởng xu
    × (b) đơn thứ 2 trong 30 ngày giao xong → người mời +reward đúng 1 lần ...
    × (c) 2 đơn "thứ 2" giao song song + 5 lần gọi thưởng song song → ...
    × (e) người mời là CTV → ... (Expected: 0, Received: 2 voucher)
    × (f) đơn thứ 2 bị trả hàng → ...
    × (h) người mời đã tiêu bớt xu → ...
Tests:       6 failed, 4 passed, 10 total
```
XANH (sau khi sửa, chạy cùng các race spec liên quan đến đảo đơn/xu):
```
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5547/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand referral-order2 cod-return-refund order-cancel ctv-assisted-refund p2002-in-tx affiliate.race
    [i] vòng 0: thưởng trước rồi thu hồi=true
    √ (a) … √ (j)   (10/10)
Test Suites: 6 passed, 6 total
Tests:       36 passed, 36 total
```
Kiểm chứng khác:
- `npx jest --maxWorkers=1 src/modules/wallet src/modules/cashback src/modules/affiliate src/modules/orders src/modules/integrations/pancake src/modules/admin/admin.service.spec.ts` → `Tests: 592 passed, 592 total`
- `npx jest --maxWorkers=1 src/modules/system-config/config-seed.spec.ts …` → pass
- `npx tsc --noEmit -p tsconfig.json` (apps/api) → exit 0
- `npx eslint` 11 file đã sửa → 0 lỗi, 0 cảnh báo
- `grep -rn "REFER-\|grantReferralCoins\|grantReferralVoucher" apps/api/src --include=*.ts | grep -v spec` → rỗng

Migration: không (dùng partial unique index `coin_transactions_referral_unique` có sẵn).

### Giả định
- "Người mời" của chương trình = `users.referredById` (mã giới thiệu lúc đăng ký), không phải `orders.referrerUserId` (gán theo link CTV — thuộc hoa hồng). Người mời có role AFFILIATE tại thời điểm thưởng thì không nhận xu.
- "Đơn đầu/đơn thứ 2" = 2 đơn RETAIL không lên hộ, đã DELIVERED, sớm nhất theo `createdAt`. Đơn bị huỷ/trả không được tính. Cửa sổ tính theo `createdAt` (lúc đặt).
- Thu hồi khi ĐƠN ĐẦU hoặc ĐƠN THỨ 2 bị trả (an toàn tiền hơn chỉ đơn thứ 2). Đã thu hồi thì không thưởng lại cho cặp đó (chặn vòng giao/trả để cày xu).
- Người được mời: không thưởng thêm xu (bỏ `REFERRED_CASHBACK`), chỉ còn voucher chào mừng sẵn có.
- Không áp ngưỡng giá trị đơn tối thiểu (khoá cũ `referral.min_order_amount` 200k chỉ thuộc voucher REFER đã gỡ).

### Việc còn lại / ghi chú
- Mốc thưởng thêm (`coins.referral_milestones`) đã trả sẽ KHÔNG bị thu hồi khi một lượt giới thiệu bị thu hồi làm số đếm tụt dưới mốc (chỉ không cấp mốc mới). Cần quyết định nghiệp vụ nếu muốn thu hồi cả mốc.
- `REFERRAL_DEBT` chưa có màn admin; hiện chỉ truy được bằng SQL + log warn. Cần gộp vào PD-3 (Điểm Xanh/TubuXu) hoặc màn đối soát.
- Lời trên miniapp về chương trình giới thiệu (nếu còn nhắc "voucher 50k" hay "bạn có cashback đầu") nằm ngoài nhóm file gói này, chưa sửa — giao PC-4.
- Comment cột `CoinTransaction.reason` trong `schema.prisma` chưa liệt kê `REFERRAL_ORDER2*` (không sửa schema để tránh đụng gói khác).

## Q-31 — Cửa sổ ghi nhận giới thiệu CTV 7 ngày (cấu hình được) — XONG

Commit: `d18e128` fix(affiliate): cửa sổ ghi nhận giới thiệu CTV mặc định 7 ngày, thêm khoá affiliate.attribution_days vào seed (Q-31)

### Đã sửa
- `affiliate.service.ts` `recordTouch`: mặc định `affiliate.attribution_days` 3 → 7 (vẫn đọc config trước).
- `seed.ts`: thêm `affiliate.attribution_days = 7` (createOnly: admin đã chỉnh thì seed không ghi đè). `referral.window_days = 30` (thêm ở commit C-003) chuyển sang createOnly cho cùng lý do.
- Comment `schema.prisma` (`ReferralTouch.expiresAt`) và `affiliate.controller.ts` sửa "3 ngày" theo khoá mới. Không đổi schema, không migration.

### Test (đỏ → xanh)
`src/modules/affiliate/affiliate.service.spec.ts`: ca "expiresAt = now + 7 ngày (mặc định Q-31)" + ca mới "đọc affiliate.attribution_days từ config" (config trả 10 → now + 10 ngày).
ĐỎ: `Expected: 1783123200000  Received: 1782777600000` (now + 3 ngày) — `Tests: 1 failed, 10 passed`.
XANH:
```
$ npx jest --maxWorkers=1 src/modules/affiliate/affiliate.service.spec.ts
Tests:       88 passed, 88 total
$ npx jest --maxWorkers=1 src/modules/system-config/config-seed.spec.ts
Tests:       2 passed, 2 total
```
`npx tsc --noEmit -p tsconfig.json` (apps/api) → không lỗi; `npx eslint` 4 file đã sửa → không lỗi; `npx prisma validate` → valid.

### Ghi chú
- Khoá `affiliate.last_click_window_days` (seed = 30) **vẫn chết**: không có code nào đọc. Giữ nguyên dòng (không xoá dữ liệu config), chỉ đổi mô tả seed thành "Không còn dùng: cửa sổ ghi nhận giới thiệu là affiliate.attribution_days". Seed upsert ghi đè mô tả này ở lần chạy seed sau.
- PROD hiện chưa có dòng `affiliate.attribution_days` → trước khi chạy seed, code đã dùng mặc định 7 ngay khi deploy. Admin muốn khác thì sửa config.
- Còn chữ "3 ngày" trong comment/doc ngoài nhóm file gói: `apps/web/src/components/storefront-tracker.tsx`, `apps/web/src/lib/shop-client.ts`, `apps/miniapp/src/services/affiliate-api.ts`, `apps/miniapp/src/components/app.tsx`, test `checkout.service.spec.ts` (gói PA-6). Chỉ là comment/tên test, không ảnh hưởng hành vi; chưa sửa.

## Tổng kết gói PA-7

| Mục | Trạng thái | Commit |
|---|---|---|
| C-059 voucher chào mừng/sinh nhật/winback chỉ user thật + birthday/winback theo lô | XONG | `c7a5662`, báo cáo `91c8b97` |
| C-003 một chương trình giới thiệu: xu theo đơn thứ 2, thu hồi khi trả, gỡ REFER + trigger cashback | XONG | `10b1c2c`, báo cáo `9b5bcf8` |
| Q-31 attribution_days mặc định 7 + seed; referral.window_days trong seed | XONG | `d18e128` |

Migration của cả gói: không có.
Race spec thêm: `test/integration-race/vouchers-real-user.race-spec.ts`, `test/integration-race/referral-order2.race-spec.ts` (Postgres riêng `tubu_it_pa7:5547`).
Việc còn lại: xem mục "Việc còn lại" từng phần (thu hồi mốc referral_milestones cần quyết định; màn admin cho `REFERRAL_DEBT`; `milestoneVouchers` LIMIT 1000; lời trên miniapp về chương trình giới thiệu; khoá chết `last_click_window_days`).
