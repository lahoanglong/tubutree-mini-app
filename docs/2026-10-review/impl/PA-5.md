# PA-5 — Rò tiền game + bẫy P2002

Nhánh `hz3/PA-5` (từ `hardening/2026-10` @ `015c5fb`). Quyết định áp dụng: Q-02 (bỏ mua giọt nước bằng xu, minOrder coupon thu hoạch 199k), Q-03 (không tạo luồng xu mới).

## Lượt 1: mục 1 (C-009) và mục 2 (C-043)

### C-009 (A1-002): Ví → xu → 💧 → coupon 30k. XONG

Commit `eab5c5e`.

- `POST /game/seeds/buy` vẫn giữ route; `GameService.buySeeds` ném `GoneException` (HTTP 410) "Tính năng mua giọt nước bằng xu đã ngừng...". Không trừ xu, không mở transaction.
- Coupon thu hoạch (lô nhà `waterTree` và lô phụ `waterPlot`, cùng một đường rò) lấy minOrder từ khoá mới `game.harvest_coupon_min_order` (mặc định 199000, helper `harvestCouponMinOrder` trong `game.constants.ts`). minOrder không bao giờ thấp hơn giá trị coupon, config hỏng (không phải số) rơi về 199000.
- Coupon thưởng vòng quay và thưởng nhiệm vụ giữ minOrder = giá trị coupon như cũ (ngoài phạm vi Q-02).
- Seed: thêm `game.harvest_coupon_min_order = 199000` với `createOnly: true` (seed lại không ghi đè giá trị admin đã chỉnh).
- Miniapp `pages/game.tsx`: bỏ nút "Mua 50 nước", mutation và hằng `BUY_SEEDS_PACK`. Nút "Mua cây thật" giữ nguyên. `services/game-api.ts` không sửa (ngoài nhóm file của gói), hàm `buySeeds` ở đó giờ không còn ai gọi.

Test (đỏ → xanh):
- `game.service.spec.ts`: "mua nước bằng xu đã ngừng → GoneException..." (thay 3 test cũ của luồng mua nước); "coupon thu hoạch: minOrder mặc định 199.000đ"; "minOrder theo config, nhưng KHÔNG bao giờ thấp hơn giá trị coupon".
- `game-garden.service.spec.ts`: "coupon thu hoạch lô phụ: minOrder mặc định 199.000đ" (thay test cũ chốt minOrder = 30000); "config minOrder thấp hơn giá trị coupon → vẫn giữ minOrder = giá trị".
- Lần chạy đỏ: `Tests: 4 failed, 65 passed, 69 total`. Sau khi sửa: `Tests: 69 passed, 69 total`.

### C-043 (A1-024): vòng quay không có trần lượt/ngày. XONG

Commit `363cbae`.

- `GameService.spin` đọc `game.spin_buy_daily_limit` (mặc định 5, seed sẵn 5). Trong transaction, sau `user.updateMany` trừ điểm (lệnh này giữ khoá dòng user tới hết tx), đếm `game_spins` của user từ 00:00 giờ VN; đủ trần thì ném 400 và rollback (điểm hoàn nguyên).
- Vì sao atomic: các lượt quay song song của cùng user xếp hàng ở khoá dòng user; ở READ COMMITTED câu `count` chạy sau khi lấy khoá thấy lượt quay mà tx trước đã commit. Không cần migration.
- Race spec mới `apps/api/test/integration-race/game-spin-limit.race-spec.ts` (Postgres thật): 10 lượt quay song song, trần 3 → đúng 3 lượt, 3 dòng `GAME_SPIN_COST`, số dư trừ đúng 30, 7 lỗi 400; lượt quay hôm qua không tính vào trần hôm nay.
- Unit test (`GameService.spin`): đủ trần → 400, không ghi lượt và không ghi sổ điểm; mặc định 5 khi thiếu config; `count` chạy sau `updateMany` và mốc ngày là 17:00 UTC (00:00 giờ VN).
- Lần chạy đỏ: unit `3 failed, 5 passed`; race `fulfilled=10 rejected=0 spins=10`, `2 failed`. Sau khi sửa: unit `48 passed`; race `fulfilled=3 rejected=7 spins=3`, `2 passed`.

### Lệnh kiểm chứng (đã chạy)

```
cd apps/api && npx jest --maxWorkers=1 src/modules/game
  Tests:       153 passed, 153 total
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5545/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand game-spin-limit
  [spin-limit] fulfilled=3 rejected=7 spins=3 errors=["BadRequestException: Bạn đã quay đủ 3 lượt hôm nay. Hẹn bạn ngày mai nhé!"]
  Tests:       2 passed, 2 total
cd apps/api && npx tsc --noEmit -p tsconfig.json        -> exit 0
cd apps/miniapp && npx tsc --noEmit                     -> exit 0
cd apps/api && npx eslint <các file game đã sửa> prisma/seed.ts test/integration-race/game-spin-limit.race-spec.ts -> 0 lỗi
cd apps/miniapp && npx eslint src/pages/game.tsx        -> 3 lỗi, đều có sẵn từ trước (Button từ zmp-ui, 2 màu thô); bản gốc ở 015c5fb cũng 3 lỗi y hệt
```

### Migration

Không có (chỉ thêm khoá SystemConfig qua seed).

### Giả định

- `game.spin_buy_daily_limit` ≤ 0 nghĩa là khoá vòng quay ("Vòng quay đang tạm đóng."), không hiểu là "không giới hạn" — hướng an toàn tiền.
- Mọi lượt quay đều tốn điểm nên "lượt mua/ngày" = mọi lượt quay trong ngày (không có lượt miễn phí nào đi qua `spin`).
- Q-02 chỉ nói coupon thu hoạch, nên coupon thưởng vòng quay và nhiệm vụ giữ minOrder = giá trị coupon.
- Coupon thu hoạch đã phát trước khi deploy giữ nguyên minOrder cũ (không backfill).

### Việc còn lại

- Deploy: chạy seed (hoặc thêm tay khoá `game.harvest_coupon_min_order`); khi thiếu khoá thì code đã mặc định 199000.
- Miniapp cần build và deploy Zalo thì nút mua nước mới biến mất; bản cũ bấm nút sẽ nhận lỗi 410 có thông báo.
- `getProfile` vẫn trả `xuPerSeed` (vô hại); có thể bỏ khi gộp Điểm Xanh/TubuXu ở PD-3.
- Mục 3 (C-061) do lượt sau làm.

---

## C-061 (A2-006): bẫy catch P2002 trong interactive transaction: XONG

### Lỗi

`CoinsService.grantCoins(tx)` và `CouponsService.redeemInTx` bắt P2002 rồi trả về bình thường. Trong Postgres, câu INSERT lỗi unique làm hỏng cả transaction đang mở, nên mọi lệnh tiếp theo của caller trong cùng tx (checkout, thưởng cộng đồng, mốc CTV) nổ `25P02 current transaction is aborted` (thành lỗi 500). Riêng `redeem` còn tăng `usedCount` TRƯỚC khi ghi redemption, nên retry cùng đơn (nếu tx không hỏng) sẽ đếm lượt 2 lần. Retry cùng đơn khi perUserLimit=1 thì bị báo nhầm "hết lượt".

### Sửa

- `grantCoins`: `coinTransaction.createMany({ skipDuplicates: true })` (INSERT ... ON CONFLICT DO NOTHING). Nếu `count = 0` thì no-op và không cộng `coinsBalance`. Nhánh không truyền tx đổi từ batch `$transaction([...])` sang interactive tx để đọc được `count`. Hàm vẫn trả `void` như cũ.
- `redeemInTx`: thứ tự mới là advisory lock (khi có perUserLimit), rồi tìm redemption `(couponId, orderId)` (có thì no-op), rồi kiểm perUserLimit, rồi `createMany skipDuplicates` (count 0 thì no-op), cuối cùng mới tăng `usedCount` có guard. Nếu hết lượt toàn cục thì throw và tx rollback luôn dòng redemption vừa ghi.

### Test (đỏ → xanh)

Race spec mới `apps/api/test/integration-race/p2002-in-tx.race-spec.ts` chạy trên Postgres thật, gồm 10 case:
- grant trùng trong tx của caller rồi ghi tiếp; 10 grant trùng song song trong tx Serializable của caller; 10 grant trùng song song không tx; reason ngoài index vẫn cộng mỗi lần.
- redeem trùng trong tx của caller rồi ghi tiếp; retry cùng đơn khi perUserLimit=1; 10 redeem trùng song song trong tx; 10 redeem trùng song song không tx (perUserLimit=1); perUserLimit vẫn chặn đơn khác; usageLimit vẫn chặn.

Trước khi sửa: `Tests: 6 failed, 4 passed`. Lỗi thật:
```
[grant-tx]  fulfilled=1 errors=[... PostgresError { code: "25P02", message: "current transaction is aborted, commands ignored until end of transaction block" ...]
[redeem-tx] fulfilled=1 errors=[... "25P02" ...]
[redeem]    fulfilled=1 errors=["BadRequestException: Bạn đã dùng hết lượt cho mã này."]
```
Sau khi sửa:
```
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5545/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand p2002-in-tx affiliate buy-flow-4a cod-return-refund dealer-bonus loyalty order-cancel
  [grant-tx] fulfilled=10 errors=[]
  [grant] fulfilled=10 errors=[]
  [redeem-tx] fulfilled=10 errors=[]
  [redeem] fulfilled=10 errors=[]
  Test Suites: 7 passed, 7 total
  Tests:       30 passed, 30 total
cd apps/api && npx jest --maxWorkers=1 src/modules/wallet src/modules/coupons src/modules/feed src/modules/affiliate src/modules/checkout src/modules/loyalty src/modules/game src/modules/storefront
  Test Suites: 33 passed, 33 total
  Tests:       849 passed, 849 total
cd apps/api && npx tsc --noEmit -p tsconfig.json   -> exit 0
cd apps/api && npx eslint <6 file đã sửa>           -> 0 lỗi
grep -rn -B3 P2002 coins.service.ts coupons.service.ts | grep 'tx\.'  -> không còn dòng nào (lệnh kiểm của catalog)
```
Unit test cập nhật theo hành vi mới: `coins.service.spec.ts` (mock `createMany`, thêm case trùng không cộng số dư và case trùng trong tx), `coupons.service.spec.ts` (mock `createMany`/`findUnique`, thay case "P2002 nuốt" bằng 2 case "đã có redemption" và "ON CONFLICT count=0", cả hai đều không tăng usedCount).

Đã sửa thêm file ngoài nhóm: `apps/api/src/modules/affiliate/affiliate-tier.spec.ts`. Lý do: mock tx giả của test đó gọi `coinTransaction.create` qua CoinsService thật, nên phải đổi sang `createMany`. Chỉ đổi mock, không đổi assert.

### Migration

Không có. Các unique index sẵn có (`coin_transactions_*_unique/_key`, `coupon_redemptions(couponId, orderId)`) vẫn là thứ chặn trùng.

### Giả định

- ON CONFLICT DO NOTHING không có target nên bỏ qua MỌI vi phạm unique trên `coin_transactions`, giống hành vi bắt mọi P2002 trước đây.
- Trong tx Serializable của caller, kẻ thua vẫn có thể nhận 40001/P2034. Đây là hành vi đúng, và `CommunityRewardService` đã nuốt mã này.
- Hàm vẫn trả `void`. Caller nào cần biết đã cộng hay chưa (vd affiliate milestone) đã tự ghi claim unique trước khi gọi.

### Việc còn lại

- Còn các chỗ catch P2002 khác ngoài nhóm file của gói: `game.service.ts:523` (đã rethrow nên tx rollback, không phải mẫu catch-continue), `game-quiz.service.ts:87`, `wallet.service.ts:188`. Ba chỗ này chưa rà theo tiêu chí C-061; nên kiểm thêm ở gói khác.
