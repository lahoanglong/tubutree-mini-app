# PF-6a: API điểm, hai nợ kỹ thuật PF-5a/PF-3 để lại

Nhánh `hz18/PF-6a`, base `63cfb5d6`. Chỉ đụng `apps/api` (loyalty, game, checkout, system-config, hai race spec mới và hai dòng mock ở hai race spec cũ) và file này. Không sửa `apps/miniapp`, `apps/web`, `packages/**`, `schema.prisma`, migration. Không push, không deploy, không ghi DB dùng chung (Postgres throwaway cổng 5801, container `pf6a-pg`, `--tmpfs`, đã xoá khi xong).

Commit: `81b0d1e4` (mục 1), `9140b455` (mục 1b, thêm ngoài danh sách, xem dưới), `60c23064` (mục 2), và commit báo cáo; sau review độc lập thêm `2fbbb0f1` và `16a0df8a` (xem mục "Sau review" ở cuối).

## Mục 1: lockedOrderPoints đọc cấu hình trong transaction

Có lỗi thật theo mã, chứng minh trên Postgres thật. `lockedOrderPoints` gọi `returnWindowDays` gọi `SystemConfigService.get`; lúc cache 60 giây hết hạn, lệnh get xin thêm một kết nối pool trong khi tx của đổi voucher, đặt đơn, góp quỹ cây và vòng quay đang giữ một kết nối và khoá dòng user. Làm ấm cache trước tx (PF-5a, ở spin) chỉ giảm rủi ro vì khoảng hở gồm cả thời gian chờ `FOR UPDATE`.

Sửa gốc: `LoyaltyService.returnWindowDays()` thành public, `lockedOrderPoints(userId, now, db, windowDays?)` nhận cửa sổ đã đọc sẵn (`windowDays ??= await returnWindowDays()`). Bốn caller trong tx (`redeemReward`, `CheckoutService.placeOrderInner`, `GameService.spin`, `GameService.buyTree`) đọc `returnWindowDays()` trước khi mở tx rồi truyền vào. Caller ngoài tx (`getOverview`, `getRewardCatalog`, `CheckoutService.compute`) không truyền, hành vi giữ nguyên. Spin bỏ lần làm ấm cache cũ (`config.get('returns.window_days')`), thay bằng lần đọc này nên khoá và mặc định nằm đúng một chỗ. Checkout chỉ đọc khi có điểm thường để tiêu (`usedStandard > 0`, đưa ra ngoài tx, cùng một biến dùng cho cả điều kiện đọc và guard trong tx). Không đổi khoá, thứ tự khoá, câu SQL hay kết quả tính.

Test:

- (a) `loyalty-locked-window.spec.ts`: có truyền `windowDays` thì không gọi get, dùng đúng giá trị truyền vào cho `lockedUntil` và cho mốc cắt của câu SQL, `0` là giá trị hợp lệ; không truyền thì đọc đúng một lần như cũ.
- (b) từng caller: `redeemReward` (spy thứ tự `get` trước `$transaction`, không có get trong tx), `spin`, `buyTree` (kể cả nhánh phát lại theo Idempotency-Key), `placeOrder` (`returnWindowDays` trước `$transaction`, `lockedOrderPoints` trong tx nhận `windowDays`, không đọc khi chỉ tiêu lô quy đổi). Thêm `pf6-locked-window-outside-tx.race-spec.ts` trên Postgres thật cho cả bốn caller: xoá cache cấu hình, xoá lại đúng lúc `$transaction` mở (dựng khoảng hở mà PF-5a mô tả), bọc `get`, mỗi lần trượt cache đếm phiên `idle in transaction` trong `pg_stat_activity`; mỗi caller hai ca (cửa sổ 1 ngày thì điểm đơn giao 2 ngày trước tiêu được, cửa sổ 7 ngày thì bị khoá, chứng minh giá trị truyền vào là giá trị cấu hình thật).
- Phép đỏ: đảo bản vá mã nguồn (`git apply -R`, rồi áp lại) và chạy lại race spec: 7/8 ca đỏ với `["returns.window_days"]` đọc khi có tx mở (redeem, spin, buyTree, và ca cửa sổ 1 ngày của checkout); ca còn lại (checkout, cửa sổ 7 ngày) xanh cả hai bên vì khi điểm đang khoá checkout kẹp `pointsToUse` ở bước báo giá nên không vào nhánh trừ điểm trong tx. Xanh 8/8 sau sửa. Nếu không xoá cache lúc mở tx thì spin và checkout xanh cả trước sửa, vì cả hai làm ấm cache; đó là lý do race spec dựng khoảng hở.
- Mock cập nhật chữ ký: `game.service.spec.ts` và `checkout.service.spec.ts` (thêm `returnWindowDays`), và hai race spec cũ `sellable-product` và `wallet-ledger-flows` (hai chỗ mock `LoyaltyService`; hai spec đó không tiêu điểm nên chưa gọi `returnWindowDays`, thêm để khỏi vỡ khi sau này có).

## Mục 1b (ngoài danh sách, commit riêng, bỏ được): trần bình nước của giải SEEDS

Cùng gốc nhưng khác khoá: `spin` trúng giải SEEDS đọc `game.tank_capacity` trong tx (PF-5a ghi là "có từ trước"). Nếu để nguyên thì câu "spin không đọc cấu hình trong tx" không đúng với giải SEEDS, và ca đo của mục 1 không thể phủ nhánh này. Đọc trần trước tx, chỉ khi giải là SEEDS, không đổi cách kẹp `totalSeeds`. Có test đỏ trước (unit và race, đều với `game.tank_capacity`). Muốn thu hẹp gói thì bỏ riêng `9140b455`.

## Mục 2: nhánh trừ điểm âm của `GameService.creditPoints`

Xác minh trên mã: nhánh này CÓ THỂ tới được, nên không xoá.

- Caller của `creditPoints` chỉ có hai: `spin` (giải POINTS, `prize.value`) và `claimMission` (`mission.rewardPoints`).
- `prize.value` đến từ `SystemConfig` khoá `game.spin_prizes`, ghi qua `PUT /admin/config` thành `AdminService.setConfig` rồi `SystemConfigService.set`. `validateAdminConfigValue` (admin) không có luật cho khoá này; trong `SystemConfigService`, `RANGES` chỉ kiểm số và `JSON_RULES` không có khoá, nên một mảng có giải POINTS value âm lưu được (kiểm kiểu chỉ so "array" với "array"). Lần quay trúng giải đó trừ điểm khách ngoài `lockedOrderPoints`. Race spec dựng lại đúng thế: bản cũ ghi được bảng giải âm, và với bảng âm lưu sẵn thì lượt quay đầu trúng giải trừ 50 điểm (số dư 60 về 0) làm lượt quay song song kế tiếp bị từ chối "Cần 10 Điểm Xanh để quay.".
- `mission.rewardPoints` đến từ bảng `missions`, chỉ `prisma/seed.ts` ghi (không có API ghi, không có SQL ghi), seed 20/30/15/50 đều dương. Không thêm chặn ở đó (chặn một đường không có nguồn là mã suy đoán).
- Giá trị khác ở dạng "thưởng": giải SEEDS value âm sẽ trừ giọt nước của khách; giải COUPON value âm tạo coupon sai; `weight` không hữu hạn làm `pickWeighted` trả NaN. Cùng luật bắt luôn các lỗi này vì cùng một chỗ nhập.

Sửa hai lớp, dùng chung `spinPrizeProblem` (file mới `system-config/spin-prizes.ts`):

1. Chỗ ghi: `SystemConfigService.JSON_RULES['game.spin_prizes']` từ chối bảng có giải hỏng (POINTS cần số nguyên ≥ 1, value không hữu hạn hoặc âm, weight âm hoặc không hữu hạn, rewardType lạ, thiếu id hoặc name), nêu số thứ tự và id giải trong lỗi. Mảng rỗng vẫn ghi được (tắt vòng quay). Bảng seed mặc định qua được luật (test đọc thẳng `prisma/seed.ts`). `SystemConfigService.set` là điểm ghi duy nhất (admin đi qua nó), nên không phải sửa `admin/**`.
2. Chỗ đọc: `GameService.spin` lọc bằng `usableSpinPrizes` (bỏ giải hỏng khỏi vòng quay, `Logger.warn` một lần cho mỗi giải và lý do, không lặp ở mỗi lượt quay). Cần vì bảng đã lưu trước luật ghi vẫn có thể hỏng. Không còn giải hợp lệ thì trả lỗi cũ "Vòng quay chưa cấu hình." trước khi mở tx.

`creditPoints` giữ nguyên nhánh âm, chỉ thêm đoạn giải thích vì sao caller chỉ được truyền thưởng dương. Bất biến "điểm cộng phải có `expiresAt`" không đổi (`points-expiry-guard.spec.ts` xanh).

Test: unit `spin-prizes.spec.ts` (hàm kiểm, luật ghi, bảng seed), unit `spin` trong `game.service.spec.ts` (giải âm là giải đầu và trọng số lớn nhất với `Math.random = 0` không bao giờ được chọn, chỉ có dòng phí quay, chỉ còn giải hỏng thì không mở tx, log một lần, cấu hình hợp lệ không đổi phân phối), race spec `pf6-spin-prize-guard.race-spec.ts` trên Postgres thật (ghi bảng âm bị từ chối và DB không đổi kể cả lịch sử cấu hình, bảng âm ghi thẳng vào DB thì ba lượt quay song song chỉ trừ phí, bảng chỉ có giải hỏng, giải dương vẫn cộng điểm có hạn). Phép đỏ: đảo bản vá mã nguồn rồi chạy lại, 3/5 ca đỏ (ghi được bảng âm; giải âm trừ hết số dư nên lượt quay sau bị từ chối vì thiếu điểm; chỉ có giải hỏng thì quay vẫn chạy thay vì báo "chưa cấu hình"), xanh 5/5 sau sửa.

## Lệnh kiểm và kết quả thật (trước review; kết quả sau review ở mục "Sau review")

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `git diff --name-only 63cfb5d6 HEAD -- . | ... | xargs npx eslint --max-warnings=0` (13 file `.ts` đã sửa, gồm race spec): exit 0. ESLint `tubu-ds` thuộc `apps/miniapp`, gói này không sửa file nào ở đó.
- `npx jest src/modules/loyalty src/modules/game src/modules/checkout src/modules/system-config`: exit 0, 32 suite, 783 test xanh (có `points-expiry-guard.spec.ts`, `loyalty-locked-window.spec.ts`, `spin-prizes.spec.ts`).
- `DATABASE_URL=postgresql://tubu:tubu@localhost:5801/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand pf5-spin pd3- pf3- game- loyalty pe3- pe5- sellable-product wallet-ledger-flows pf6- system-config`: exit 0, 24 suite, 234 test xanh (gồm `pf5-spin-locked-points`, mọi `pd3-*`, `pf3-*`, `game-tree-idempotency`, `game-spin-limit`, `loyalty.race-spec`, `loyalty-refund-expiry`, `pd3-checkout-points`, `pe3-reward-expiry`).
- Giữa chừng có chạy thêm một lần `npx jest src/modules` của api (160 suite, 3274 test xanh) để chắc không vỡ chỗ khác; đó không phải full suite repo.

## Chưa verify

- Chưa dựng tải thật để thấy `P2024`; bằng chứng là đếm phiên `idle in transaction` lúc get trượt cache, không phải cạn pool thật.
- Race spec mục 1 phủ checkout với thanh toán COD có điểm; các nhánh `WALLET`, `BANK_TRANSFER`, `ZALOPAY` trong tx của placeOrder chưa đo xem còn lần đọc cấu hình nào khác trong tx hay không (không đổi ở gói này).
- Không chạy Playwright, capture/axe, full suite (điều phối viên chạy). Không đụng `apps/miniapp` nên không có ESLint `tubu-ds` để chạy.

## Rủi ro và việc ngoài nhóm file

- `windowDays` truyền vào `lockedOrderPoints` không được kiểm lại bên trong; caller phải lấy từ `returnWindowDays()` (đã ép số hữu hạn ≥ 0, mặc định 7). Caller ngoài tx nên để trống.
- Giá trị cửa sổ trong tx có thể cũ tới 60 giây so với lần admin vừa đổi cấu hình (như mọi lần đọc qua cache), không khác trước đây.
- `creditPoints` nhánh âm còn đó. Sau hai lớp chặn, đường tới nó chỉ còn là sửa tay bảng `missions` trong DB. Nếu điều phối viên muốn, bước tiếp là xoá nhánh và ném lỗi khi `delta < 0`; chưa làm vì `claimMission` còn cho `delta = 0` (nhiệm vụ chỉ thưởng coupon) đi qua nhánh cộng và ghi một dòng sổ delta 0 không có `expiresAt` (hành vi có từ trước, `points-expiry-guard` xếp vào nhóm delta ≤ 0), nên đổi đó cần quyết định riêng.
- Giải POINTS của vòng quay chưa có trần nghiệp vụ (khác các khoá điểm trong `RANGES`, chặn nhầm đơn vị xu). Luật chỉ chặn âm, không nguyên, không hữu hạn và (sau review) vượt cột Int. Thêm trần là quyết định giá trị, chưa làm; xem "Sau review".
- Ngoài nhóm file, chưa sửa: `apps/api/src/modules/admin/admin-config-rules.ts` không có luật cho `game.spin_prizes` (không cần vì chặn nằm ở `SystemConfigService.set`), và `docs/2026-10-review/impl/PF-5a.md` mục "Rủi ro" còn ghi hai nợ này; sau gói này cả hai đã đóng.

## Sau review

Review độc lập đưa ba finding mức minor, không có blocker hay major. Mỗi finding đã đối chiếu với mã và với Postgres thật trước khi sửa.

### Finding 1: giải POINTS không có trần trên (spin-prizes.ts)

Xác minh: đúng, `spinPrizeProblem` nhận POINTS value 1e9 (nằm dưới trần Int) và mỗi lượt trúng cộng 1e9 Điểm Xanh. Không sửa phần này, ghi nợ cho chủ dự án. Lý do không tự chọn một con số: (1) trần là quyết định giá trị, các khoá điểm khác trong `RANGES` mỗi khoá một trần (seasonpass 100, mốc giới thiệu 500, phí quay 1000) nên không có hằng số nào hiển nhiên dùng lại; (2) bộ lọc lúc đọc của `GameService.spin` bỏ lặng lẽ giải vượt trần, nên chọn trần thấp hơn giải mà admin đang chạy thật sẽ làm giải đó biến mất khỏi vòng quay mà không có lỗi nào ở chỗ ghi. Khi có con số: thêm `p.value <= MAX` vào nhánh POINTS của `spinPrizeProblem` và hai test (giá trị sát trần qua, trần + 1 bị chặn), việc nhỏ.

Phần kỹ thuật của cùng finding đã làm ở finding 2: value của mọi loại giải, kể cả POINTS, không được vượt 2147483647 (cột Int).

### Finding 2: giải SEEDS/COUPON/NONE có value lẻ (spin-prizes.ts)

Xác minh: đúng một phần. Mô tả cơ chế của review ("Prisma báo lỗi, khách nhận 500") không đúng với số lẻ. Thử trên Postgres thật: `gameSpin.create` với `prizeValue` 2.5, 20000.5, 0.5 đều thành công và Prisma cắt phần lẻ (lưu 2, 20000, 0); spin giải SEEDS 2.5 chạy xong, trả về `value: 2.5` cho khách, cộng 2 giọt vào `totalSeeds`; giải COUPON 20000.5 tạo Mã giảm giá 20000. Không có 500, không mất điểm; lỗi thật là lệch giữa số hiển thị và số nhận.

Lỗi 500 thật nằm ở value vượt cột Int, mà review cũng nhắc (COUPON 1e12 qua luật): giải COUPON hoặc SEEDS value 3e9 làm `coupon.create` / `gameProfile.update` ném `Unable to fit integer value into an INT4`, tx rollback (số dư giữ nguyên) nhưng mọi lượt quay trúng giải đó đều lỗi 500, và bảng chỉ có giải đó thì `spin` không trả "Vòng quay chưa cấu hình." mà lỗi Prisma.

Sửa (`2fbbb0f1`): `spinPrizeProblem` yêu cầu value mọi loại là số nguyên trong [0, 2147483647] (POINTS vẫn từ 1), một hằng `INT4_MAX` và hàm `isDbInt`. Dùng chung cho luật ghi cấu hình và bộ lọc lúc quay, nên bảng đã lưu có giải lẻ hoặc vượt Int bị bỏ khỏi vòng quay với log một lần cho mỗi giải. Giải lẻ đang chạy thật trong cấu hình sẽ biến mất khỏi vòng quay, đúng ý (trước đó khách nhận phần đã cắt lẻ so với số hiển thị).

Test: unit `spin-prizes.spec.ts` (7 ca đỏ trước sửa: lẻ cho SEEDS/COUPON/NONE, vượt Int cho cả bốn loại; thêm ca biên 2^31-1 hợp lệ và weight lẻ vẫn hợp lệ), unit `spin()` (ba giải hỏng không bao giờ được chọn với `Math.random = 0`, 3 ca đỏ), race spec `pf6-spin-prize-guard` trên Postgres thật (5 ca đỏ trước sửa: giải COUPON/SEEDS vượt Int làm quay lỗi Prisma, giải SEEDS lẻ được chọn, bảng chỉ có giải vượt Int ném lỗi Prisma thay vì "chưa cấu hình", ghi bảng lẻ/vượt Int qua `set` được; xanh sau sửa).

### Finding 3: quy tắc windowDays chỉ nằm ở comment (loyalty.service.ts)

Xác minh: đúng. Đã grep cả repo: đúng bốn caller trong tx (`redeemReward`, `placeOrderInner`, `spin`, `buyTree`) truyền `windowDays`, ba caller ngoài tx không truyền; nhưng chữ ký cũ cho phép `lockedOrderPoints(userId, now, tx)` biên dịch.

Sửa (`16a0df8a`): chọn gate bằng kiểu thay vì assert lúc chạy. Hai overload: `(userId, now)` cho caller ngoài tx và `(userId, now, db, windowDays: number)` cho caller trong tx; truyền `db` mà thiếu hoặc để `undefined` là lỗi `tsc`. Không thêm assert lúc chạy vì `this.prisma` và `tx` cùng thoả kiểu `Pick<TransactionClient, '$queryRaw'>` nên so sánh `db !== this.prisma` chỉ đúng khi LoyaltyService được tạo cùng instance với caller (khó đảm bảo trong test mock), trong khi overload không phụ thuộc điều đó. Hành vi chạy không đổi.

Gate lập tức bắt thêm một chỗ: `CheckoutService.placeOrderInner` có `windowDays` kiểu `number | undefined`. Đổi thành `number | null` và nhánh trừ điểm trong tx chạy khi `windowDays !== null`, tương đương `usedStandard > 0` như trước (cả hai chỉ khác null/dương cùng lúc). Test checkout PF-6a đã có (đọc trước `$transaction`, không đọc khi chỉ tiêu lô quy đổi) vẫn xanh.

Test: hai dòng `@ts-expect-error` trong `loyalty-locked-window.spec.ts`. Kiểm bằng script `typecheck` (`tsc --noEmit`, tsconfig của api gồm cả file spec trong `src`). Đỏ trước khi thêm overload (`TS2578: Unused '@ts-expect-error' directive`, 2 lỗi), xanh sau. Giới hạn: jest không kiểm các dòng này (chạy qua hàm không gọi), gate nằm ở `tsc`; ba test cũ của `lockedOrderPoints` đổi từ `undefined` sang truyền `prisma` tường minh để theo overload.

### Lệnh kiểm sau review (cây cuối cùng, trong `apps/api`)

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- ESLint `--max-warnings=0` trên 13 file `.ts` đã sửa của gói (`git diff --name-only 63cfb5d6 HEAD`): exit 0.
- `npx jest src/modules/loyalty src/modules/game src/modules/checkout src/modules/system-config`: 32 suite, 795 test xanh (trước review 783).
- `DATABASE_URL=postgresql://tubu:tubu@localhost:5801/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand pf5-spin pd3- pf3- game- loyalty pe3- pe5- sellable-product wallet-ledger-flows pf6- system-config`: exit 0, 24 suite, 239 test xanh (trước review 234).
- Không chạy Playwright, capture/axe, full suite. Postgres throwaway `pf6a-pg` cổng 5801 đã xoá khi xong.

## Đóng finding 1 của review (2026-10-12)

Trần giải POINTS đã được chủ dự án chốt 100 Điểm Xanh và thêm vào `spinPrizeProblem` (`SPIN_POINTS_PRIZE_MAX`), có test biên 100 qua / 101 bị từ chối, test đọc giải đã lưu vượt trần bị bỏ, và review opus APPROVE. Giải SEEDS/COUPON/NONE có `value` lẻ đã bị chặn từ vòng sửa trước (`isDbInt`), nên finding 2 của review lượt 1 cũng đã đóng.
