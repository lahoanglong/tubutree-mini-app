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
