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
