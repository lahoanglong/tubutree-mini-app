# PF-3: Điểm Xanh (thu hồi, xoá đánh giá, hạn), cấu hình, hạ tầng build/test

Nhánh `hz16/PF-3`, base `0c481225`. Chỉ đụng `apps/api` (loyalty, reviews, system-config, tsconfig.build.json, spec và race spec), `turbo.json`. Không sửa checkout, order-reversal, `schema.prisma`, migration, auth (mục 5 không phát hiện lỗi). Không push, không deploy, không ghi DB dùng chung (Postgres throwaway cổng 5603, container `tubu_it_pf3`, xoá khi xong).

Lần chạy đầu bị ngắt sau khi đã commit đủ 5 mục; lần tiếp tục này đọc lại từng commit, chạy lại mọi lệnh kiểm và chạy lại phép "đỏ trước" bằng cách đặt tạm mã cũ (`git show 0c481225:...`) rồi đặt lại bản mới, `git status` sạch sau mỗi lần. Chỉ thêm file báo cáo này.

Commit: `3098903c` (mục 1), `b2ab4aa8` (mục 2), `e7e961fc` (mục 3), `61d95bd4` (mục 4a), `a4206490` (mục 4b), `6a66c4fa` (mục 5), commit kế tiếp là báo cáo này.

## Mục 1: LoyaltyService.reverseOrderPoints

Có lỗi thật, cả hai phần.

(a) Không khoá dòng user. Race `pf3-reverse-order-points.race-spec.ts` giữ reverse ở lệnh ghi đầu tiên rồi cho cron chạy xen vào: cron trừ `POINTS_EXPIRED -20`, reverse ghi tiếp `ORDER_REVERSED -20`, tổng trừ 40 cho một lô 20 điểm (kỳ vọng -20, nhận -40). Sửa: `SELECT "pointsBalance" FROM "users" ... FOR UPDATE` là việc đầu tiên trong transaction (cùng quy ước `redeemReward`, checkout, cron). Chỉ khoá khi có gì để ghi (`pointsEarned > 0` hoặc điểm đã tiêu > 0). Hai caller song song (huỷ + webhook trả) xếp hàng ở khoá, kẻ sau thấy dòng của kẻ trước và bail idempotent.

(b) Lô đã hết hạn, cron đã trừ trước lúc huỷ/trả (admin đặt `loyalty.point_expire_months` ngắn hơn cửa sổ trả hàng 45 ngày): trước đây trừ `pointsEarned` lần hai, số dư có thể âm, và điểm khách đã tiêu cũng bị đòi lại làm số dư âm. Chạy đỏ: số dư 10 thay vì 30, -20 thay vì 0, -10 thay vì 0, hoàn điểm tiêu 80 thay vì 100. Sửa: chỉ thu hồi `min(pointsEarned, phần còn lại của lô theo sổ lô, số dư đọc sau khoá)`. Phần còn lại lấy bằng `lotRemaining(...)` mới export ở `loyalty-expiry.service.ts`, replay đúng sổ lô STANDARD của PE-1a/PE-5 (cùng luật ghép `ORDER_RULE`, không viết luật thứ hai). Điểm hoàn của phần điểm đã tiêu (`ORDER_REFUND_POINTS`) không đổi.

Quyết định thiết kế:

- Dòng `ORDER_REVERSED` luôn được ghi, delta 0 nếu không còn gì để thu hồi. Nó là dấu "đã xử lý" của idempotency và của `lockedOrderPoints`; bỏ dòng thì huỷ lần hai lại thu hồi tiếp. Dòng delta 0 đã có tiền lệ (`REFERRAL_*_DEBT`).
- `tierPoints` (điểm xét hạng) trước đây cộng delta của dòng thu hồi; delta nay có thể nhỏ hơn điểm giao nên đổi sang loại hẳn đơn có dòng `ORDER_REVERSED`. Đơn đã trả thì chi tiêu của nó không thuộc hạng, cùng kết quả như trước với đơn thu hồi đủ.
- Cập nhật số dư bằng `updateMany` có guard `pointsBalance >= take`; `count !== 1` ném lỗi để rollback thay vì để sổ lệch (không thể xảy ra sau FOR UPDATE, là lưới an toàn).
- `loyalty-expiry.service.ts` export thêm `lotRemaining`, `loadPointExpiryTxns`, `orderLotKey`, `reviewLotKey`; replay tách ra `replayLots` mà `computePointExpiry` giữ nguyên hành vi (spec cũ của PE-1a, PE-3, PE-5 vẫn xanh).

Đối chứng đỏ lần này (mã cũ của `loyalty.service.ts`, `reviews.service.ts`): `pf3-reverse-order-points` 7 ca đỏ, đều đúng lý do ở trên; 4 ca đối chứng không có dòng thu hồi thừa vẫn xanh.

## Mục 2: ReviewsService.remove đẩy số dư âm

Có lỗi thật. Postgres thật (`pf3-review-delete-floor.race-spec.ts`): đã tiêu hết 5 điểm của đánh giá rồi xoá thì `pointsBalance` về -5; còn 3/5 thì -2; lô cũ 30, tiêu 33 (ăn lô cũ rồi 3 điểm của lô đánh giá) thì -3; thu hồi một phần rồi qua hạn thì -3. Lượt chạy đỏ lần này: 4 ca đỏ đúng các số trên.

Sửa: sau câu khoá dòng user (nay đọc luôn số dư), thu hồi `min(pointsEarned, lotRemaining(lô REVIEW), số dư)` bằng `updateMany` có guard, ghi `REVIEW_DELETE` đúng số đã thu hồi (delta 0 nếu không còn gì). Phần thiếu tra lại được qua dòng `REVIEW:<slug>` cùng `refId`. Giữ nguyên các bất biến PE-3: lô đã quá hạn thì không ghi dòng thu hồi (cron trừ đúng một lần), `REVIEW_DELETE` ăn đúng lô REVIEW khi cron replay, chiêu tạo, xoá, tạo lại vẫn bị chặn khi điểm còn nguyên.

## Mục 3: biên loyalty.point_expire_months

Có lỗi (khoá chưa có trong RANGES). Thêm `{ min: 1, max: 120, integer: true, note: 'số tháng nguyên (12 = điểm hết hạn sau 12 tháng)' }` ở `system-config.service.ts`. Test trong `points-unit-guard.spec.ts`: nhận 1, 6, 12, 24, 120; từ chối 0, -1, -12, 121, 1000, 12000, số lẻ, NaN, Infinity, chuỗi, boolean, mảng; thông báo tiếng Việt nêu khoá, khoảng 1–120, đơn vị tháng và giá trị nhập. Giá trị seed (12) nằm trong biên (test đọc đúng bảng seed); không migration nào gieo khoá này (test quét mọi `migration.sql`). `pe5-reversal-expiry.race-spec.ts` vẫn kiểm giá trị hỏng 0 và -3 rơi về 12 tháng nhưng nay ghi thẳng DB vì `set()` từ chối chúng. Đối chứng đỏ lần này (mã cũ `system-config.service.ts`): 15 ca đỏ.

Lưu ý vận hành: nếu DB thật đang giữ giá trị ngoài biên từ trước, `set()` mới chỉ chặn lần ghi sau; đọc vẫn rơi về 12 tháng như cũ (`points-expiry-date.ts`). Chưa kiểm DB thật (không có quyền).

## Mục 4: hạ tầng build/test

(a) Có lỗi nhỏ. `route-graph.ts` không phải `.spec.ts` nên vẫn bị biên dịch vào dist. Thêm `src/common/route-graph.ts` vào `exclude` của `tsconfig.build.json`. Hai spec dùng nó (`endpoint-inventory.spec`, `beta-removed.spec`) vẫn chạy vì jest dùng `tsconfig.json`. `route-graph-build.spec.ts` mới đọc danh sách file thật của `tsconfig.build.json` bằng API typescript: route-graph vắng mặt, không file nguồn chạy thật nào import nó (import thì tsc vẫn kéo vào dist dù đã exclude), hai spec cũ vẫn import được. Đỏ khi đặt lại `tsconfig.build.json` cũ. Biên dịch bằng `tsc -p tsconfig.build.json` ra thư mục tạm: thoát 0, không có `route-graph*` trong đầu ra, `main.js` có mặt.

(b) Có lỗi. `beta-removed-audit.spec.ts` đọc `scripts/audit`, `scripts/uiux` ngoài package và walk cả thư mục sinh ra. Tái hiện: tạo file giả `scripts/audit/results/*.json` và `scripts/audit/.probe/*.txt` nhắc `"/beta"`: spec cũ đỏ (hai file bị liệt vào offenders), spec mới xanh; đã xoá file giả. Nay bỏ qua `results`, `.probe`, `generated`, `node_modules` ở mọi cấp. Hai regex chạy trên cả nội dung file: `/prisma\s*\.\s*beta(Tester|Feedback)\s*\.\s*(create|createMany|upsert)\b/` (bắt gọi tách dòng, không bắt `deleteMany` của phần dọn dòng cũ) và `/^\s*['"]?beta['"]?\s*:\s*\[/m` (bắt `'beta': [`, không bắt `betaFeatures: [`, `// beta: [`); có test cho chính hai regex. `turbo.json` thêm task `@tubutree/api#test` với inputs `$TURBO_DEFAULT$`, `$TURBO_ROOT$/scripts/audit/**`, `$TURBO_ROOT$/scripts/uiux/**` và giữ `dependsOn`, `outputs` của task test chung (task riêng thay hẳn định nghĩa chung; spec kiểm ba điều này). `turbo run test --dry=json --filter=@tubutree/api`: thoát 0, 731 file input trong đó 25 file của hai thư mục script.

## Mục 5: gộp phiên khách với dòng thu hồi ghép lô

Không phải lỗi, không sửa `auth.service.ts`. `pf3-merge-guest-lots.race-spec.ts` (Postgres thật, `AuthService` thật gọi `mergeGuestInto`) gộp tài khoản khách vào tài khoản chính với từng loại dòng thu hồi (`ORDER_REVERSED`, `REVIEW_DELETE`, `REFERRAL_ORDER2_REVOKE`, `REFERRAL_MILESTONE_REVOKE`) qua bốn kịch bản: gộp rồi qua hạn, cron đã chạy ở hai bên trước khi gộp, lô còn hạn lúc gộp, gộp song song với cron. Sau mỗi ca: số dư khớp sổ, không có `POINTS_EXPIRED` thừa, `findPointsLotDrift` rỗng (kiểm trong `afterEach`). Lý do mã đúng: gộp đổi `userId` của mọi dòng sổ nhưng giữ nguyên `refType`, `refId`, `reason`, `createdAt`, nên replay ghép lô theo khoá không phụ thuộc user. Test không rỗng: lượt trước tắt ghép dòng thu hồi trong cron thì cả 12 ca đỏ (lượt này chỉ chạy lại bản xanh).

## Lệnh đã chạy (lần tiếp tục này)

Trong worktree, PATH node 22.23.3, `DATABASE_URL=postgresql://tubu:tubu@localhost:5603/tubutree_it`.

- `pnpm install --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate`, `npx prisma migrate deploy` (DB throwaway): thoát 0.
- `npx tsc --noEmit -p tsconfig.json` (apps/api): thoát 0.
- `npx jest src/modules/loyalty src/modules/reviews src/modules/system-config src/modules/auth src/common/beta-removed-audit.spec.ts src/common/endpoint-inventory.spec.ts src/common/route-graph-build.spec.ts`: 24 suite, 548 test xanh, thoát 0. Cảnh báo `recalcTier lỗi ... reading 'findMany'` trong `loyalty.service.spec.ts` là mock `recalcAllTiers` thiếu `pointsTransaction`, đã có ở base.
- `npx eslint --max-warnings=0` trên 11 file `.ts` đã sửa trong `src`: thoát 0.
- `npx jest -c test/integration-race/jest.config.js --runInBand pf3 pe5-reversal pe3-reward pd3-points loyalty auth-merge review-edit pd3-order-reversal pd3-checkout system-config order-cancel pd3-reward`: 16 suite, 138 test xanh, thoát 0.
- Phép đỏ trước (mã cũ đặt tạm rồi đặt lại): race mục 1, 2 với `loyalty.service.ts` và `reviews.service.ts` cũ: 11 đỏ, 4 xanh; mục 3, 4a với `system-config.service.ts` và `tsconfig.build.json` cũ: 16 đỏ; mục 4b với spec cũ cộng file giả: đỏ. `git status` sạch sau mỗi lần đặt lại.

## Chưa verify

- Không chạy Playwright e2e, full suite, `nest build` đầy đủ (chỉ `tsc -p tsconfig.build.json` ra thư mục tạm), `turbo run test` thật (chỉ `--dry=json`).
- Không kiểm trên DB dùng chung: chưa biết có user nào đang âm số dư hay khoá `loyalty.point_expire_months` đang ngoài biên.
- Đồng thời nhiều đơn (hơn hai caller) cùng một user chỉ được bảo đảm bằng khoá FOR UPDATE và unique index, không có race riêng cho ba caller trở lên.

## Rủi ro và việc ngoài nhóm file

- Dòng `ORDER_REVERSED` hay `REVIEW_DELETE` nay có thể có delta 0. `apps/miniapp/src/services/account-api.ts:231` gắn nhãn "Hoàn ngược điểm (hủy/trả)" cho mọi dòng `ORDER_REVERSED`, nên lịch sử điểm có thể hiện một dòng 0. Ngoài nhóm file nên không sửa; gói miniapp nên ẩn dòng delta 0 hoặc đổi nhãn.
- `scripts/audit/seed-audit-personas.ts:1036` gieo `ORDER_REVERSED` với `-pointsEarned` nên không ảnh hưởng, ghi lại để biết.
- Số liệu admin tính tổng `ORDER_REVERSED` theo delta (nếu có ở nơi khác ngoài `apps/api/src`, grep không thấy) sẽ nhỏ hơn điểm giao khi lô đã hết hạn hay đã tiêu; đó là đúng ý nghĩa mới.
- Điểm đã tiêu không đòi lại là quyết định có chủ đích: đơn bị trả sau khi khách đã dùng điểm đó thì phần đã dùng không thu hồi được. Muốn ghi nợ điểm thì cần thiết kế riêng (không thuộc PF-3).

## Sau review (lượt 1)

Review độc lập lượt 1 kết luận CHANGES: hai blocker, hai minor. Mỗi finding được xác minh trên mã và trên Postgres thật trước khi sửa; cả bốn đều đúng. Mỗi mục một commit riêng, test đỏ trước (đặt tạm mã cũ rồi đặt lại, `git status` sạch sau mỗi lần).

Commit: `e175c412` (blocker 2), `d2aaad18` (minor 1), `d29f2b46` (blocker 1), `abf37df5` (minor 2), `cac2d81d` (minor 3), kế tiếp là mục báo cáo này.

### Blocker 2: lotRemaining coi chi tiêu FIFO là điểm đã mất (`e175c412`)

Đúng lỗi. Replay FIFO gán điểm tiêu cho lô cũ nhất, mà lô đơn thường là lô cũ nhất khi khách tiêu điểm từ lô khác (thưởng game) bằng đúng phần `số dư - lockedOrderPoints`. Tái hiện bằng race spec: đơn giao 2 ngày trước +20, thưởng game +100, tiêu 100, trả hàng: bản cũ thu hồi 0 và khách giữ 20, bản mới thu hồi -20 và số dư về 0. Test đỏ trên `loyalty-expiry.service.ts` cũ: 1 ca race đơn hàng, 1 ca race đánh giá (lô đánh giá cũ hơn lô bị tiêu), 6 ca unit.

Sửa: mỗi lô trong `replayLots` có thêm `initial` và `lost`. `lost` chỉ tăng ở hai chỗ: phần dòng `POINTS_EXPIRED` ăn của các lô đã quá hạn lúc nó được ghi, và phần dòng thu hồi cùng khoá lấy (`ReversalRule`). Phần FIFO tiêu ăn không tính. Hàm đổi tên `lotRemaining` thành `lotRecoverable` (= tổng `initial - lost` của lô mang khoá) vì nghĩa đã khác "còn lại sau chi tiêu"; `computePointExpiry` giữ nguyên hành vi (cả bộ spec PE-1a, PE-3, PE-5 vẫn xanh). Trần theo số dư giữ làm lưới an toàn cuối ở cả hai caller (`reverseOrderPoints`, `ReviewsService.remove`), nên số dư không bao giờ âm. Ca "lô cũ 30, đơn +20, tiêu 40" vẫn thu hồi 10: không còn nhờ FIFO mà nhờ số dư còn 10.

Hệ quả có chủ đích: lô đơn hết hạn một phần đã bị FIFO tiêu trước đó, thì phần đã tiêu vẫn được tính là thu hồi được (bị cắt theo số dư). Đó là đúng đặc tả điều phối viên ("chỉ coi là mất khi cron trừ vì hết hạn").

### Minor 1: trần theo số dư đọc trước khi cộng điểm hoàn (`d2aaad18`)

Đúng. Số dư đọc ở câu khoá, dòng `ORDER_REFUND_POINTS` ghi sau nên khách còn ít điểm được hoàn đủ mà điểm tích bị cắt. Đỏ: 2 ca race (số dư 0 + đơn từng dùng 40: bản cũ thu hồi 0, bản mới -20; số dư 0 + hoàn 5: cũ 0, mới -5). Sửa: ghi dòng hoàn (và cộng số dư) TRƯỚC, rồi tính `take = min(pointsEarned, lotRecoverable, số dư khoá + usedStandard)`. Thứ tự hai dòng trong sổ đảo lại (hoàn trước, thu hồi sau); replay không phụ thuộc thứ tự này (dòng thu hồi chỉ ăn lô cùng khoá). Đã sửa các ca unit khẳng định thứ tự cũ, thêm 2 ca unit.

### Blocker 1: vòng lặp farm điểm đánh giá (`d29f2b46`)

Đúng lỗi, đã tái hiện trên Postgres thật. Gốc rễ: `createFirst` thưởng mọi lần tạo khi chưa có dòng đánh giá; không có unique nào trên `points_transactions` theo (khách, sản phẩm) (unique chỉ ở bảng `reviews`, mà xoá đánh giá mở lại nó). Bản gốc `0c481225` chống farm bằng cách thu hồi đủ lúc xoá; bản PF-3 lượt trước thu hồi 0 khi khách đã tiêu hết, nên vòng tạo +15, tiêu hết bằng đơn COD, xoá, huỷ đơn (hoàn điểm đã dùng thành lô mới), tạo lại cho thêm 15 mỗi vòng. Test đỏ (3 vòng): số dư vòng 2 là 30 thay vì 15.

Quyết định thiết kế (chọn khác gợi ý "cấm tạo lại sau mọi lần xoá", có bằng chứng): `createFirst` cộng mọi dòng sổ REVIEW của cặp (khách, sản phẩm): thưởng dương `REVIEW:<slug>` và thu hồi âm `REVIEW_DELETE:<id sản phẩm>`. Còn dương nghĩa là khách còn giữ phần thưởng đã nhận (đã tiêu hết, đã tiêu một phần, hay đã hết hạn rồi mới xoá) thì tạo lại cho `pointsEarned = 0`, không ghi dòng điểm, không cộng số dư. Thu hồi đủ rồi tạo lại vẫn được thưởng. Lý do không cấm tuyệt đối: spec đã chốt ở PD-2 (`review-edit.race-spec.ts`, "xoá rồi viết lại: sổ [10, -10, 10], đúng một lần thưởng") và khách xoá để viết lại không có lỗi gì thì không nên mất điểm; cấm tuyệt đối sẽ làm hỏng ca đó và phạt khách thật mà không đóng thêm lỗ hổng nào (thu hồi đủ nghĩa là khách không giữ gì). Với cả hai cách, 3 vòng tạo/tiêu/xoá chỉ nhận thưởng đúng một lần. slug được giả định bất biến (đồng bộ Pancake chỉ ghi slug lúc tạo sản phẩm, đã kiểm ở `pancake-sync.service.ts`).

Test: 6 ca race (vòng farm 3 lần có cả bước huỷ đơn, tiêu hết rồi xoá rồi tạo lại, thu hồi một phần, hết hạn rồi xoá rồi tạo lại, thu hồi đủ rồi tạo lại vẫn thưởng, sản phẩm khác không bị ảnh hưởng), 7 ca unit. Cả bốn ca đỏ đúng lý do trên bản cũ; hai ca đối chứng xanh cả trước lẫn sau.

Hệ quả cần biết: phản hồi tạo đánh giá có thể có `pointsEarned: 0` với `updated: false`, nên miniapp `reviews-section.tsx` ("Đã cộng Điểm Xanh" khi `updated=false`) sẽ báo cộng điểm sai trong ca này. Ngoài nhóm file, không sửa; nên đổi câu báo theo `pointsEarned > 0`.

### Dòng thu hồi delta 0 (`abf37df5`)

Hai trường hợp khác nhau:

- `ORDER_REVERSED` delta 0: PHẢI giữ trong sổ. Nó là dấu "đã xử lý": nếu bỏ, lượt huỷ lặp (webhook) tính lại với số dư mới và đòi lại điểm không liên quan; `lockedOrderPoints` (NOT EXISTS ORDER_REVERSED) khoá điểm đơn đã trả mãi mãi; `tierPoints` không loại được đơn. Chặn khỏi lịch sử khách ở `LoyaltyService.getPointsTransactions` (nằm trong nhóm file): `where: { userId, NOT: { delta: 0, reason: { startsWith: 'ORDER_REVERSED:' } } }`. Race test thật: dòng 0 vẫn trong sổ nhưng không có trong lịch sử; dòng thu hồi thật và dòng hoàn vẫn hiện; lượt huỷ thứ hai không lấy lại gì và `lockedOrderPoints.locked` = 0. Đỏ trước: dòng 0 hiện trong lịch sử.
- `REVIEW_DELETE` delta 0: không cần (đánh giá đã xoá thì không có lượt xoá thứ hai; `createFirst` dựa vào dòng thưởng, không dựa vào dòng 0). Nay không ghi khi `take = 0`. `points-expiry-guard.spec.ts` bỏ ngoại lệ cũ của `reviews.service.ts` (nay `delta: -take` khớp luật "delta âm" sẵn có).

Ngoài nhóm file, ghi lại: `apps/miniapp/src/services/account-api.ts:231` gắn nhãn "Hoàn ngược điểm (hủy/trả)" cho `ORDER_REVERSED`. Lịch sử khách nay không còn dòng 0 nên không cần sửa ở đó để hết lỗi hiển thị; endpoint khác trả sổ điểm cho khách (nếu có ngoài `apps/api/src/modules/loyalty`) chưa tìm thấy qua grep `pointsTransaction.findMany`.

### Minor 3: test walk bỏ thư mục sinh ra xanh theo cấu trúc (`cac2d81d`)

Đúng. `walk` nhận thêm tham số tập thư mục bỏ qua. Test mới dựng thư mục tạm (`mkdtemp`) có `results/`, `.probe/`, `generated/`, `node_modules/` ở gốc và lồng nhiều cấp, mọi file nhắc `/beta`, rồi kiểm walk chỉ trả hai file nguồn; kiểm thêm `SKIPPED_DIRS` đúng bốn tên và walk với tập thiếu một tên quét lại thư mục đó. Đặt `SKIPPED_DIRS` rỗng thì 3 ca đỏ (đã chạy, rồi đặt lại).

### Lệnh đã chạy (lượt sửa này)

Trong worktree, PATH node 22.23.3, `DATABASE_URL=postgresql://tubu:tubu@localhost:5603/tubutree_it`, container `tubu_it_pf3` (đã `docker rm -f -v` khi xong).

- `pnpm install --frozen-lockfile`, `pnpm --filter @tubutree/shared-types build`, `npx prisma generate`, `npx prisma migrate deploy`: thoát 0.
- `npx tsc --noEmit -p tsconfig.json` (apps/api): thoát 0.
- `npx jest src/modules/loyalty src/modules/reviews src/modules/system-config src/modules/auth src/common/beta-removed-audit.spec.ts src/common/endpoint-inventory.spec.ts src/common/route-graph-build.spec.ts src/common/beta-removed.spec.ts`: 25 suite, 570 test xanh, thoát 0.
- `npx eslint --max-warnings=0` trên 15 file `.ts` đã đổi so với base: thoát 0.
- `npx jest -c test/integration-race/jest.config.js --runInBand pf3 pe5-reversal pe3-reward pd3-points loyalty auth-merge review-edit second-order-review-invite admin-lookups pd3-order-reversal pd3-checkout system-config order-cancel pd3-reward`: 18 suite, 161 test xanh, thoát 0.
- Đỏ trước: `loyalty-expiry.service.ts` cũ chạy với `pf3-reverse-order-points` (1 đỏ) và `pf3-review-delete-floor` (1 đỏ); unit `lotRemaining` 6 đỏ trước khi sửa; hai ca trần theo số dư đỏ; bốn ca farm đỏ; ca lịch sử điểm và ca `REVIEW_DELETE` delta 0 đỏ; `SKIPPED_DIRS` rỗng: 3 đỏ.

### Chưa verify (cập nhật)

- Không chạy Playwright e2e, full suite, `nest build`, `turbo run test` thật (như lượt trước).
- Không có race riêng cho thứ tự `createFirst` đọc sổ so với `remove` chạy song song của cùng một khách; an toàn dựa vào unique `(userId, productId)` (tạo lại phải chờ lượt xoá commit mới thấy dòng đánh giá đã mất) và khoá `FOR UPDATE` ở lượt xoá.
- Không kiểm DB thật: khách đã bị lệch số dư trước lượt sửa này (nếu có) không được sửa lại bởi mã mới.

### Rủi ro còn lại

- Khách xoá đánh giá đã hết hạn điểm rồi tạo lại sẽ không được thưởng lại (trước đây được). Đúng tinh thần "thưởng lần đầu" của Q-30 nhưng là thay đổi hành vi nhìn thấy được; cần chủ dự án xác nhận.
- Khách còn ít điểm sau khi trả đơn: trần mới (số dư + điểm hoàn) làm khoản thu hồi lớn hơn trước (trước bị cắt theo số dư thấp), đúng ý "như chưa có đơn".
- Dòng `ORDER_REVERSED` delta 0 vẫn có thể có mặt ở các API/báo cáo khác đọc sổ điểm thô (admin); chỉ lịch sử điểm của khách được lọc.
