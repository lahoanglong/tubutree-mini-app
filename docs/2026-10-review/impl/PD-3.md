# PD-3 — Gộp TubuXu vào Điểm Xanh: báo cáo thực hiện

Spec: `docs/2026-10-review/impl/PD-3-SPEC.md`. Nhánh `hz9/PD-3`, worktree `.claude/worktrees/hz9-PD-3`. DB test riêng: container `tubu_it_pd3` cổng 5583, DB `tubutree_it`.

## Lượt L1 — Schema, migration A/B, SQL hoàn tác, mô hình điểm theo lô

Trạng thái lượt: **XONG**. L1 không đổi hành vi khách: chưa nơi nào tiêu/cộng lô CONVERTED ngoài migration B; mọi chỗ ghi điểm cũ vẫn ghi lô STANDARD qua giá trị mặc định của cột.

### Các mục

| Mục (spec mục 9, L1) | Trạng thái | Commit |
| --- | --- | --- |
| `schema.prisma`: enum `PointsLot`, `points_transactions.lot`, `users.pointsConvertedBalance`, `orders.pointsUsedConverted`, `community_events.rewardPoints`, `ctv_milestone_claims.rewardPoints`, model `XuPointsConversion` | XONG | ce02df2e, 95e66233 |
| Migration A `20261012100000_pd3_points_lot_schema` (cột, 2 CHECK, 6 partial unique index, quy đổi `rewardXu` → `rewardPoints`) | XONG | ce02df2e |
| `prisma/check-partial-indexes.ts`: thêm 6 tên, danh sách 14 → 20 | XONG | ce02df2e |
| Migration B `20261012110000_pd3_xu_to_points` (bảng chụp, quy đổi một lần, RAISE khi số dư âm/lệch sổ) | XONG (khác spec ở một chỗ, xem "Khác spec" số 1) | 95e66233 |
| SQL hoàn tác `apps/api/prisma/manual/pd3_xu_to_points_rollback.sql` (KHÔNG tự chạy) | XONG (thêm chốt chặn, xem "Khác spec" số 2) | 95e66233 |
| `loyalty/points-reconcile.ts` + `scripts/reconcile-points.ts` đối soát theo từng lô | XONG | cc75dab8 |
| `loyalty/points-ledger.ts` (mới): `applyPointsDelta` ghi sổ đúng lô | XONG | 63172d0f, 4f1263a7 |
| `loyalty/loyalty-expiry.service.ts`: FIFO và ứng viên chỉ lấy lô STANDARD | XONG | dc435a2b |
| `auth/auth.service.ts` `mergeGuestInto`: chuyển `pointsConvertedBalance`, đổi khoá QUEST trùng ở sổ điểm | XONG | 9ff337cb |
| `users/account-deletion.service.ts`: chặn `CONVERTED_POINTS` | XONG (giữ chặn `COINS_BALANCE`, xem "Khác spec" số 4) | 4436e81c |
| Race spec T1, T2, T3, T21 (`pd3-xu-migration.race-spec.ts`) | XONG | 95e66233 |
| T4 (`partial-unique-indexes.race-spec.ts`), T5 + T7 (`pd3-points-lots.race-spec.ts` + unit `loyalty-expiry.service.spec.ts`), T15 (`auth-merge-guest.race-spec.ts`) | XONG | ce02df2e, dc435a2b, 9ff337cb |

### Migration

| Thư mục | Nội dung | Thao tác dữ liệu |
| --- | --- | --- |
| `20261012100000_pd3_points_lot_schema` | đúng SQL spec 3.1 | chỉ ADD TYPE/COLUMN/CONSTRAINT/INDEX; một UPDATE idempotent `community_events.rewardPoints = (rewardXu + 999) / 1000 WHERE rewardPoints = 0 AND rewardXu > 0` |
| `20261012110000_pd3_xu_to_points` | spec 3.2, đã sửa (xem "Khác spec" số 1) | CREATE TABLE IF NOT EXISTS + INSERT/UPDATE trong một khối DO; không DELETE/DROP |

Timestamp B cách A một giờ: nếu L2 muốn migration khoá config `*_points` chạy trước B đúng thứ tự spec mục 10 thì đặt `20261012103000`–`20261012105959`. Hai việc này độc lập nhau, đặt sau B cũng không sai.

Prisma chạy mỗi migration trong một transaction: sau khi B RAISE, bảng `xu_points_conversions` không còn (đã kiểm, xem bên dưới), nên `migrate resolve --rolled-back` rồi `migrate deploy` lại là đủ.

### Kiểm chứng migration

DB trống (`tubutree_it`, 0 user):

```
$ npx prisma migrate deploy        -> Applying 20261012100000_pd3_points_lot_schema ... All migrations have been successfully applied.
$ npx prisma migrate deploy        -> Applying 20261012110000_pd3_xu_to_points ... All migrations have been successfully applied.
$ npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
No difference detected.            (exit 0)
$ npx tsx prisma/check-partial-indexes.ts
Partial unique index: mong đợi 20, có trong DB 20.
```

DB có dữ liệu mẫu, chạy `prisma migrate deploy` THẬT với đúng file migration của repo (kiểm `diff -r` giống hệt). Làm trong schema tạm `pd3_seeded` của chính `tubutree_it` (không tạo DB khác): deploy 125 migration trước PD-3 từ bản chép ở scratchpad, nạp dữ liệu mẫu bằng SQL, rồi deploy 2 migration PD-3. Bản chép trước PD-3 phải đổi `gin_trgm_ops` thành `public.gin_trgm_ops` (extension nằm ở schema public); file trong repo không đổi. Xoá schema sau khi xong.

```
Dữ liệu mẫu: s_u0 (0 xu, sổ +500 −500), s_u1 (1), s_u999 (sổ 1200 −201), s_u1000, s_u1001, s_u123456,
  s_upts (3000 xu + 50 điểm thường), s_udrift (700 xu, không có dòng sổ), s_uneg (−5 xu, sổ −5),
  đơn XU CONFIRMED/PAID 250.000đ, community_events rewardXu 1500 và 0.

deploy lần 1 -> Applying 20261012100000_pd3_points_lot_schema / Applying 20261012110000_pd3_xu_to_points
  ERROR: PD-3: 1 user có coinsBalance âm; đối soát tay trước (SELECT id, "coinsBalance" FROM users WHERE "coinsBalance" < 0)
sửa s_uneg (sổ +5, số dư 0); migrate resolve --rolled-back; deploy lần 2
  ERROR: PD-3: 1 user có coinsBalance khác SUM(coin_transactions.delta); đối soát trước khi quy đổi
  to_regclass('pd3_seeded.xu_points_conversions') = <khong co bang>   (transaction đã rollback)
sửa s_udrift (sổ +700); truy vấn 3.3 (a): users_with_xu 7 | total_xu 130157 | total_points 133 | rounding_cost_vnd 2843 | max 124
migrate resolve --rolled-back; deploy lần 3 -> All migrations have been successfully applied.
deploy lần 4 -> No pending migrations to apply.

    id     | coinsBalance | pointsBalance | pointsConvertedBalance | coinsBefore | pointsGranted | roundingVnd
 s_u0      |            0 |             0 |                      0 |             |               |
 s_u1      |            0 |             0 |                      1 |           1 |             1 |         999
 s_u1000   |            0 |             0 |                      1 |        1000 |             1 |           0
 s_u1001   |            0 |             0 |                      2 |        1001 |             2 |         999
 s_u123456 |            0 |             0 |                    124 |      123456 |           124 |         544
 s_u999    |            0 |             0 |                      1 |         999 |             1 |           1
 s_udrift  |            0 |             0 |                      1 |         700 |             1 |         300
 s_uneg    |            0 |             0 |                      0 |             |               |
 s_upts    |            0 |            50 |                      3 |        3000 |             3 |           0
xu_points_conversions: 7 dòng, 133 điểm, 2843đ làm tròn, 130157 xu
coins_nonzero 0 | conv_drift 0 | std_drift 0 | coin_drift 0
community_events: s_ev1 1500 xu -> 2 điểm, s_ev0 0 -> 0 ; đơn XU giữ nguyên (pointsUsedConverted 0)
```

`prisma migrate diff` trên schema tạm này báo 4 khác biệt (unique `coupon_redemptions(couponId, orderId)`, FK `loyalty_check_ins.userId`, 2 FK `pos_point_credits`). Đây là do migration CŨ kiểm `pg_constraint WHERE conname = ...` không lọc schema nên bỏ qua khi bảng cùng tên đã có ở public; không liên quan PD-3. Trên schema public (cách deploy thật) diff trống.

### Test thêm (đỏ -> xanh), output thật

Lệnh race: `DATABASE_URL=postgresql://tubu:tubu@localhost:5583/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand <file>`. Lệnh unit: `npx jest <spec> --maxWorkers=1` trong `apps/api`.

1. `partial-unique-indexes` (T4). Đỏ sau khi thêm 6 tên vào `KNOWN_PARTIAL_UNIQUE_INDEXES`, trước migration A:
   ```
   [partial-unique] expected=20 present=14 missing=["coin_transactions_xu_migration_key","points_transactions_community_reason_key","points_transactions_converted_refund_unique","points_transactions_quest_unique","points_transactions_referral_unique","points_transactions_xu_migration_key"]
   Tests:       3 failed, 2 passed, 5 total
   ```
   Xanh: `Tests:       5 passed, 5 total`.
2. `pd3-xu-migration` (T1, T2, T3, T21, CHECK). Đỏ khi chưa có file migration (`ENOENT ... 20261012110000_pd3_xu_to_points/migration.sql`). Đỏ tiếp với đúng SQL bản nháp spec 3.2: ca "user đã quy đổi lại có xu mới đúng bằng số cũ" cộng điểm lần hai mà không có dòng sổ:
   ```
   ✕ T2: user đã quy đổi lại có xu mới đúng bằng số cũ → chạy lại KHÔNG cộng điểm lần hai
   -   "coinsBalance": 1000,
   -   "pointsConvertedBalance": 1,
   +   "coinsBalance": 0,
   +   "pointsConvertedBalance": 2,
   Tests:       3 failed, 5 passed, 8 total
   ```
   (2 ca đỏ còn lại của lần chạy đó, T3 và T21, do lỗi hàm dựng dữ liệu trong test, đã sửa ở cùng commit.) Xanh với SQL đã sửa: `Tests:       8 passed, 8 total`.
3. `points-reconcile.spec.ts` (unit). Đỏ `Tests: 7 failed, 7 total` (chưa có `lot`, `byLot`, `POINTS_LOT_BALANCE_COLUMN`) → xanh `Tests: 7 passed, 7 total`.
4. `points-ledger.spec.ts` (unit). Đỏ `Cannot find module './points-ledger'` → xanh `Tests: 6 passed, 6 total`.
5. `loyalty-expiry.service.spec.ts` (unit T7). Đỏ `Tests: 2 failed, 16 passed, 18 total` → xanh `Tests: 18 passed, 18 total`.
6. `pd3-points-lots` (T5, T7 race). Đỏ trước khi lọc lô ở cron (lô quy đổi cũ làm FIFO lệch, trừ quá tay):
   ```
   ✕ T7: cron hết hạn chỉ trừ phần STANDARD hết hạn; lô quy đổi cũ hơn không làm lệch FIFO; chạy 2 lần không trừ đôi
   Expected: 140
   Received: 60
   Tests:       1 failed, 3 passed, 4 total
   ```
   Xanh: `Tests:       4 passed, 4 total`. Sau mỗi ca kiểm `findPointsLotDrift` (cùng truy vấn với script đối soát) rỗng cho mọi user ca đó chạm.
7. `auth-merge-guest` (T15). Đỏ:
   ```
   ✕ PD-3 (T15): merge moves the converted Điểm Xanh lot and its ledger; duplicate QUEST points row is re-keyed, not a unique violation
   ✕ merge: two concurrent ensurePhone calls for one guest credit the guest balance to the target exactly once
   Unique constraint failed on the fields: (`userId`,`reason`)
   -   7,
   +   1,
   Tests:       2 failed, 9 passed, 11 total
   ```
   Xanh: `Tests:       11 passed, 11 total`.
8. `account-deletion`. Đỏ: khách còn 3 điểm quy đổi vẫn bị ẩn danh (process không ném lỗi), danh sách admin không có `pointsConvertedBalance`:
   ```
   ✕ PD-3: chặn khi còn Điểm Xanh quy đổi (không hết hạn, không quy ra tiền) chưa dùng
   Expected constructor: BadRequestException ... Received value: null
   ✕ danh sách cho admin: kèm thông tin khách và lý do đang bị chặn   Expected: 4  Received: undefined
   Tests:       2 failed, 11 passed, 13 total
   ```
   Xanh: `Tests:       13 passed, 13 total`.

Chạy lại cuối lượt (HEAD 4f1263a7), từng file một:

```
partial-unique-indexes  Tests: 5 passed, 5 total
pd3-xu-migration        Tests: 8 passed, 8 total
pd3-points-lots         Tests: 4 passed, 4 total
auth-merge-guest        Tests: 11 passed, 11 total
account-deletion        Tests: 13 passed, 13 total
loyalty.race            Tests: 5 passed, 5 total
npx jest src/modules/loyalty src/modules/auth src/modules/users --maxWorkers=1   Test Suites: 14 passed; Tests: 243 passed
npx tsc --noEmit -p tsconfig.json   exit 0   (cộng một tsconfig tạm phủ scripts/reconcile-points.ts và test/integration-race/*.ts: exit 0)
npx eslint <16 file đã sửa>         exit 0
prisma migrate diff ... --exit-code: No difference detected. | check-partial-indexes: mong đợi 20, có trong DB 20.
npx tsx scripts/reconcile-points.ts (DRY-RUN trên DB test): Lô STANDARD 0 user lệch, Lô CONVERTED 0 user lệch
```

Cách chạy migration B/hoàn tác trong race spec: đọc chính file `.sql` của repo, tách câu (tôn trọng `$$`), chạy trong một transaction với `SET LOCAL search_path` trỏ vào schema nháp `pd3_xu_mig` có bảng `users/points_transactions/coin_transactions` dựng bằng `LIKE public.* INCLUDING ALL` (đủ CHECK, unique, partial unique). Như vậy dữ liệu lệch/âm cố ý không đụng bảng public các race spec khác dùng. Helper: `test/integration-race/sql-script.ts`.

### Khác spec (chọn phương án an toàn tiền hơn)

1. **Migration B, câu UPDATE cuối.** Bản nháp spec cộng `pointsGranted` cho mọi user có `coinsBalance = coinsBefore > 0`. User đã quy đổi ở lần chạy trước, sau đó có xu mới (code cũ còn ghi xu giữa hai lần chạy, ví dụ trên DB dev/staging) đúng bằng số cũ, sẽ bị cộng điểm lần hai mà không có dòng sổ nào (T2 đỏ ở trên). Bản đã sửa: gom `userId` vừa chụp ở CHÍNH lần chạy này (`WITH ins AS (INSERT ... RETURNING "userId")` → `new_ids`), chỉ ghi sổ và cộng số dư cho các user đó. User như vậy giữ nguyên xu, migration in `RAISE WARNING 'PD-3: % user vẫn còn coinsBalance <> 0 ...'`; migration C của L3 (`users_coins_frozen`) sẽ dừng deploy tới khi đối soát tay. Trên PROD, B chỉ chạy một lần nên không đổi kết quả.
2. **SQL hoàn tác.** Thêm chốt `RAISE EXCEPTION` khi `orders."pointsUsedConverted" > 0` (spec 3.5 chỉ ghi điều kiện này bằng chữ); khoá thêm `coin_transactions`; bảng tạm tên `_pd3_rb`. Ca "lô đã tiêu một phần" trong T21 dựng bằng dòng tiêu lô CONVERTED không qua đơn.
3. **Bảng `xu_points_conversions` có model Prisma `XuPointsConversion`** (spec không nêu). Không có model thì `prisma migrate diff` báo drift. Ràng buộc đặt tên tường minh (`xu_points_conversions_pkey`, `xu_points_conversions_userId_fkey`) cho khớp tên Prisma sinh. CHECK `roundingVnd` chỉ sống trong SQL.
4. **Xoá tài khoản.** Thêm chặn `CONVERTED_POINTS` ("còn N Điểm Xanh không hết hạn chưa dùng") nhưng GIỮ chặn `COINS_BALANCE` cho tới khi xu bị khoá ở DB (L3); sau migration B mọi `coinsBalance` = 0 nên chặn này không bao giờ kích hoạt, giữ chỉ để không có khoảng hở nếu xu còn được cộng trước L2/L3. Danh sách admin trả CẢ `coinsBalance` lẫn `pointsConvertedBalance`: `apps/web/.../account-deletion-panel.tsx` (L4) vẫn đọc `coinsBalance`; L4 bỏ trường cũ.
5. **`scripts/reconcile-points.ts --apply` chỉ sửa lô STANDARD.** Lô CONVERTED (tiền trả trước) chỉ báo và thoát mã 1, không tự đặt lại số dư (giống `reconcile-wallet`). Báo cáo đối soát tách theo lô (`byLot`); đối soát tổng hai lô sẽ để lọt lỗi ghi nhầm lô.
6. **Cron hết hạn** ghi dòng `POINTS_EXPIRED` với `lot: 'STANDARD'` tường minh (DB cũng mặc định STANDARD). Cron nhắc sắp hết hạn cũng lọc lô.
7. **`applyPointsDelta`** (`points-ledger.ts`): cộng/trừ đúng cột của lô; trừ có guard `gte` và trả `applied:false` khi thiếu; lô CONVERTED không nhận `expiresAt`; tuỳ chọn `skipDuplicates` (chỉ cho lệnh cộng) dùng `createManyAndReturn(... skipDuplicates)` để khoá partial unique chặn ghi trùng mà không làm hỏng tx (25P02). Race spec T5 chứng minh 10 lệnh trừ song song chỉ 2 thành công khi đủ cho 2, và 5 lệnh hoàn trùng khoá chỉ cộng 1 lần. Chưa có mã sản phẩm nào gọi helper này ở L1 (L2/L3 dùng).
8. Đường dẫn trong spec viết `loyalty/points-reconcile.ts`; mã thật ở `apps/api/src/modules/loyalty/points-reconcile.ts`.

### Giả định

- OQ-1..15 dùng đúng đề xuất mặc định của spec. Ở L1 trực tiếp dùng: OQ-13 (B dừng khi xu âm/lệch sổ), OQ-14 (xoá tài khoản bị chặn khi còn điểm quy đổi).
- Prisma 5.22 chạy mỗi migration trong transaction (quan sát được: RAISE xong bảng chụp không còn).
- Không đổi `AuthUser.coinsBalance`/`shared-types` ở L1 (spec 7.1 thuộc L4).

### Việc còn lại cho các lượt sau

- L3 phải sửa test đang dựng user có `coinsBalance > 0` (`account-deletion.race-spec.ts` ca "chặn khi còn xu", `auth-merge-guest.race-spec.ts` nhiều ca) khi thêm migration C `users_coins_frozen`, vì CHECK sẽ từ chối.
- L3 bỏ chặn `COINS_BALANCE` sau migration C; L4 đổi panel admin sang `pointsConvertedBalance`.
- L2/L3 dùng `applyPointsDelta` cho mọi nơi ghi lô CONVERTED (checkout, hoàn đơn, đơn XU cũ, góp quỹ trồng cây).

### Việc cần chủ dự án

- Duyệt OQ-1..15 (spec mục 11); L1 đã dựa trên OQ-13, OQ-14 theo đề xuất.
- Trước deploy: chạy truy vấn 3.3 (a)–(e) trên bản sao PROD; nếu (b) khác 0 thì đối soát trước, nếu không migration B dừng deploy. Ghi số (a) vào báo cáo này.
- Quyết định khi gặp user đã quy đổi mà lại có xu mới (chỉ xảy ra nếu B chạy hơn một lần trên cùng DB, ví dụ staging): migration không tự quy đổi lần hai, cần quy đổi tay hoặc huỷ số xu đó.
- SQL hoàn tác chỉ dùng khi chưa có đơn tiêu điểm quy đổi; sau đó chỉ sửa tiến.

## Review A1 (reviewer độc lập, lượt 1)

Trạng thái: **XONG**. Sáu finding: 1 major (đúng, đã sửa), 4 minor đã sửa hoặc xử lý, 1 minor không đo được trong phạm vi lượt (thành cổng deploy). Mỗi sửa một commit riêng `address review A1`. Test đỏ được thấy trước khi sửa; output thật bên dưới.

| # | Mức | Finding | Kết luận | Commit |
| --- | --- | --- | --- | --- |
| 1 | major | Hoàn tác chỉ chặn khi `orders.pointsUsedConverted > 0`; gộp phiên khách, hoàn đơn xu cũ, thu hồi giới thiệu đưa điểm vào/ra lô quy đổi mà hoàn tác không thấy | ĐÚNG, đã sửa | f781e758, a7ea0676 |
| 2 | minor | Không có quy trình triển khai lại sau hoàn tác | ĐÚNG, đã ghi (chọn phương án "chỉ sửa tiến") | f781e758 |
| 3 | minor | `(coinsBalance + 999)` tràn INTEGER khi số dư > 2.147.482.648 | ĐÚNG, đã sửa migration B; phần hoàn tác chỉ ép kiểu cho chắc | bc00be31 |
| 4 | minor | Chi phí làm tròn trên số dư thật chưa đo | KHÔNG sửa được ở đây (cấm PROD); thành cổng deploy, xem dưới | báo cáo này |
| 5 | minor | T5 chưa kiểm bất biến trên dữ liệu có sẵn / cả bảng | MỘT PHẦN: kiểm mọi user có dòng `XU_MIGRATION`; cả bảng không khả thi trên DB test chung, ghi lý do | d4eab0cb |
| 6 | minor | `expireUser` tính `expiredNow` ngoài transaction, hai lượt đồng thời cùng trừ | ĐÚNG (có sẵn từ trước PD-3), đã sửa vì rẻ và an toàn | 317090bd |

### 1. Hoàn tác: dòng cộng vào lô quy đổi ngoài dòng quy đổi gốc (major)

Xác minh bằng mã: `mergeGuestInto` chuyển `points_transactions.userId` của dòng `XU_MIGRATION` sang target (refId vẫn là id khách) và cộng `pointsConvertedBalance` cho target; bảng chụp vẫn gắn với khách (số dư 0 sau gộp). Hoàn tác tính `LEAST(pointsGranted, pointsConvertedBalance)` theo từng dòng bảng chụp: khách nhận 0 xu, target giữ điểm thừa mà code cũ không đọc. Hoàn đơn xu cũ (`ORDER_REFUND_XU`, L3) và dòng cộng khác vào lô quy đổi cho cùng hậu quả. Phép tính của reviewer đúng.

Test đỏ (đúng SQL cũ, lấy từ `git show HEAD`, đặt tạm vào file rồi khôi phục bản mới):

```
✕ T21 (review A1): hoàn tác TỪ CHỐI khi lô quy đổi của một khách đã được gộp phiên sang user khác
    expect(received).rejects.toThrow()
    Received promise resolved instead of rejected
✕ T21 (review A1): hoàn tác TỪ CHỐI khi lô quy đổi nhận điểm không qua quy đổi (hoàn đơn xu cũ)
    Received promise resolved instead of rejected
```

Sửa (`apps/api/prisma/manual/pd3_xu_to_points_rollback.sql`): sau chốt `pointsUsedConverted` thêm chốt thứ hai, dừng bằng `RAISE EXCEPTION` khi tồn tại dòng `lot = 'CONVERTED' AND delta > 0` mà không phải dòng quy đổi gốc (`refType = 'XU_MIGRATION' AND refId = userId`). Khoá thêm `points_transactions`. Chọn phương án "từ chối" của reviewer, không phải "hoàn tác theo cả `pointsConvertedBalance`": phương án sau trả xu cho điểm không xuất phát từ xu và làm tròn thêm cho khách, trái nguyên tắc an toàn tiền; từ chối buộc người vận hành sửa tiến có kiểm soát. Khác đề xuất của reviewer ở một chỗ: chỉ tính dòng CỘNG. Dòng TRỪ (góp quỹ trồng cây, thu hồi thưởng giới thiệu, spec 3.5 và T21 ca "lô tiêu một phần") vẫn được hoàn tác một phần; nếu chặn cả dòng trừ thì ca T21 hiện có không còn đúng.

Ca T21 mới, cả hai đều kiểm hoàn tác không ghi gì (số dư mọi user và số dòng `XU_MIGRATION_ROLLBACK` không đổi):
- khách `u1001` (1.001 xu = 2 điểm) gộp sang `u999`: dòng điểm và dòng xu chuyển, số dư chuyển, bất biến vẫn đúng, hoàn tác từ chối;
- `u1000` nhận `ORDER_REFUND_XU` +5 vào lô CONVERTED: hoàn tác từ chối.

Xanh: `pd3-xu-migration  Tests: 11 passed, 11 total`.

Hệ quả vận hành: nếu trong cửa sổ giữa deploy và hoàn tác có khách có xu được gộp phiên, hoàn tác bị chặn và chỉ còn sửa tiến. Đầu file SQL có truy vấn liệt kê các dòng gây chặn.

### 2. Triển khai lại sau hoàn tác (minor)

Đúng: B vẫn nằm trong `_prisma_migrations`, PK `xu_points_conversions` chặn quy đổi lần hai, `users_coins_frozen` bị gỡ không tự trở lại, và code mới không đọc `coinsBalance` nên số xu đã trả lại sẽ mồ côi. Chọn phương án thứ hai của reviewer: ghi vào đầu file hoàn tác rằng hoàn tác là MỘT CHIỀU (chỉ sửa tiến, không chạy lại B), kèm hướng cho lần triển khai lại: cần migration quy đổi MỚI (user có `XU_MIGRATION_ROLLBACK` và `coinsBalance > 0`, id dòng sổ và refType riêng) rồi thêm lại `users_coins_frozen`, làm qua review riêng. Không viết sẵn script triển khai lại: không có test thật nào chứng minh được trước khi có tình huống cụ thể, và sai ở đây là sai tiền trả trước.

### 3. Tràn INTEGER ở migration B (minor)

Đúng. `(u."coinsBalance" + 999)` là INTEGER + INTEGER. Test đỏ (số dư 2.147.483.647):

```
Raw query failed. Code: `22003`. Message: `ERROR: integer out of range`
Tests:       1 failed, 10 passed, 11 total
```

Sửa (`20261012110000_pd3_xu_to_points/migration.sql`): `u."coinsBalance"::bigint + 999` ở cả `pointsGranted` và `roundingVnd`. Kết quả tối đa 2.147.484 điểm và làm tròn 353đ vẫn vừa cột INTEGER. Ca mới: số dư 2.147.483.647 quy đổi ra 2.147.484 điểm, `roundingVnd` 353, bất biến đủ; hoàn tác trả đủ 2.147.483.647 xu. Xanh: `Tests: 11 passed, 11 total`.

Về phần hoàn tác (`pts_back * 1000`): reviewer nói "cùng lỗi". Thực tế chưa tràn: nhánh `ELSE` của `CASE` chỉ chạy khi `pts_back < pointsGranted ≤ 2.147.484`, tức `pts_back ≤ 2.147.483` và `× 1000 = 2.147.483.000` còn vừa. Vẫn ép `bigint` ở đó cho khỏi phụ thuộc thứ tự `CASE`; comment trong file nói đúng điều này, không nói là đang tràn.

Migration B đã sửa tại chỗ (không thêm migration mới) vì chưa deploy ở đâu ngoài DB test. DB `tubu_it_pd3` đã áp bản B cũ nên checksum trong `_prisma_migrations` lệch bản mới; `prisma migrate deploy` không kiểm checksum (chạy lại: `No pending migrations to apply`), `prisma migrate dev` thì sẽ báo. Người khác dùng `migrate dev` trên DB đã áp B cũ phải dựng lại DB đó.

### 4. Chi phí làm tròn trên số dư thật (minor, KHÔNG sửa được ở đây)

Đúng là chưa đo: lượt này cấm đụng PROD, DB dev chỉ cho 0 user có xu (reviewer đã chạy). Thành **cổng deploy** bắt buộc cho điều phối viên:

1. Chạy spec mục 3.3 (a) và (b) trên bản sao PROD. Điều kiện qua cổng: (b) cả hai số bằng 0 (nếu không migration B dừng deploy); (a) `rounding_cost_vnd` và `users_with_xu` đã ghi vào báo cáo này và chủ dự án thấy chấp nhận được (trần lý thuyết 999đ × `users_with_xu`). Thêm `max("coinsBalance")` để thấy có user sát trần INTEGER hay không.
2. Chạy lại truy vấn "sau migration B" (spec 3.3) ngay sau deploy và đối chiếu `sum("pointsGranted")`, `sum("roundingVnd")`, `sum("coinsBefore")` với kết quả (a).

Không sửa spec vì số đo chưa có; chỗ ghi số là bảng dưới (điền khi có).

| Truy vấn | Kết quả trên bản sao PROD | Ngày / người chạy |
| --- | --- | --- |
| 3.3 (a) users_with_xu / total_xu / rounding_cost_vnd / max_points_one_user | (chưa đo) | |
| 3.3 (b) negative_users / coin_drift_users | (chưa đo) | |

### 5. T5 trên dữ liệu có sẵn (minor)

Kiểm cả bảng `users` của DB test chung không khả thi. Đo thật trên `tubu_it_pd3`: 18 user lệch hai bất biến, toàn do fixture của các spec khác đặt số dư thẳng (vd `pointsBalance 115` không có dòng sổ, `pointsConvertedBalance 6` không có dòng CONVERTED), không liên quan PD-3. Một ca assert "cả bảng rỗng" sẽ đỏ vĩnh viễn hoặc phải loại trừ tay.

Đã làm: ca mới trong `pd3-points-lots.race-spec.ts` kiểm `findPointsLotDrift` trên MỌI user có dòng `XU_MIGRATION` (user spec tự tạo và dữ liệu spec khác để lại, gồm dòng đã gộp sang user khác; 4 chủ dòng còn lại ở DB test lúc đo đều khớp). Phạm vi và lý do ghi ở đầu spec. Kiểm cả bảng nằm ở `pd3-xu-migration.race-spec.ts` (`invariants()` trên schema nháp sạch, sau B và sau hoàn tác) và ở `scripts/reconcile-points.ts` chạy trên dữ liệu thật (mục "Trước deploy").

### 6. Cron hết hạn chạy đồng thời (minor, có sẵn từ trước PD-3)

Đúng. `expireUser` đọc sổ và tính `expiredNow` ngoài transaction; guard `gte` chỉ chặn số dư âm. Test đỏ (6 lượt `expireUser` song song cho user có 30 điểm hết hạn + 100 điểm còn hạn; kỳ vọng tổng trừ 30):

```
✕ T7: nhiều lượt hết hạn chạy ĐỒNG THỜI cho một user ... chỉ trừ một lần
Expected: 30
Received: 120
Tests:       1 failed, 4 passed, 5 total
```

Khách mất 90 điểm chưa hết hạn. Sửa (`loyalty-expiry.service.ts`): bước đọc nhanh không khoá giữ nguyên (phần lớn ứng viên đã xử lý từ các đêm trước, khoá hết mỗi đêm là phí); khi thật sự phải trừ thì trong transaction `SELECT ... FOR UPDATE` dòng user, đọc lại sổ lô STANDARD rồi mới tính `expiredNow`, nên lượt đến sau thấy dòng `POINTS_EXPIRED` của lượt trước và trừ 0. Xanh: `pd3-points-lots  Tests: 6 passed, 6 total` (chạy 3 lần liên tiếp đều xanh); unit `loyalty-expiry.service.spec.ts` thêm ca "đọc lại sau khoá thấy lượt kia đã trừ" và mock transaction có khoá + đọc lại: `Tests: 19 passed, 19 total`.

### Chạy lại cuối lượt

```
partial-unique-indexes  Tests: 5 passed, 5 total
pd3-xu-migration        Tests: 11 passed, 11 total
pd3-points-lots         Tests: 6 passed, 6 total
auth-merge-guest        Tests: 11 passed, 11 total
account-deletion        Tests: 13 passed, 13 total
loyalty.race            Tests: 5 passed, 5 total
npx jest src/modules/loyalty src/modules/auth src/modules/users --maxWorkers=1   Test Suites: 14 passed; Tests: 244 passed
npx tsc --noEmit -p tsconfig.json   exit 0
npx eslint <file đã sửa>            exit 0
prisma migrate diff ... --exit-code: No difference detected. | check-partial-indexes: mong đợi 20, có trong DB 20.
```

### Khác spec (thêm cho A1)

- SQL hoàn tác (spec 3.5) có thêm chốt dừng khi có dòng cộng vào lô CONVERTED ngoài dòng quy đổi gốc, và khoá `points_transactions`. Spec 3.5 chỉ nêu điều kiện "chưa có đơn tiêu điểm quy đổi".
- Migration B ép `bigint` ở phép làm tròn lên (spec 3.2 viết INTEGER).

### Việc cần chủ dự án (thêm cho A1)

- OQ-16 (mới, dùng đề xuất mặc định): hoàn tác xu bị chặn khi đã có phiên khách gộp hoặc dòng cộng khác vào lô quy đổi; khi đó chỉ sửa tiến. Báo nếu muốn có đường hoàn tác cho trường hợp gộp phiên (cần thiết kế riêng, trả xu cho chủ hiện tại của dòng quy đổi).
- Cổng deploy mục 4 ở trên: số đo 3.3 (a), (b) trên bản sao PROD trước khi deploy.

## Lượt L2 — Nguồn thưởng sang Điểm Xanh (spec mục 9, 4)

### Các mục

| Mục | Trạng thái | Commit |
|---|---|---|
| Migration đổi khoá config xu sang `*_points` bằng CEIL; Season Pass XU sang POINTS; trần cộng đồng 3→1, 5→3 | XONG | 3cdf0ed0 |
| `RewardPointsService.grant` (lô STANDARD, có hạn `loyalty.point_expire_months`, trần 1..2000, idempotent đọc HỢP sổ điểm + sổ xu cũ) thay `CoinsService.grantCoins` | XONG | d8110e7b |
| Giới thiệu: thưởng/mốc bằng điểm; thu hồi thưởng cấp bằng xu trừ lô CONVERTED `ceil(xu/1000)`, thưởng điểm trừ STANDARD; thiếu ghi `REFERRAL_DEBT` (delta 0) ở sổ điểm; đếm lượt và mốc gộp hai sổ; `GET /me/referral` | XONG | d8110e7b |
| Mốc doanh số CTV 50/200/600/2000 điểm | XONG | 7dfc4322 |
| Cộng đồng (bài, trả lời, hay nhất, thắng sự kiện) bằng điểm; trần ngày đếm hai sổ; `CreateEventDto.rewardPoints` (tối đa 1000) | XONG | fea1f2d7 |
| Nhiệm vụ gian hàng 2/2/2/1/5 điểm; "đã nhận" đọc hợp hai sổ | XONG | c7566cd6 |
| Season Pass thưởng POINTS qua `grant`; cấu hình XU bị từ chối (400, log lỗi) | XONG | 0bde94f0 |
| RANGES + luật JSON cho khoá `*_points`; khoá xu cũ vào DEAD; seed đổi sang điểm; T16 | XONG | 3a12dc80 |
| Race spec cũ chuyển sang `RewardPointsService` | XONG | 44bf9010 |
| T13 (giới thiệu, real Postgres) | XONG | 2f0e4f26 |
| T14 (nhiệm vụ, cộng đồng, sự kiện, real Postgres) | XONG | c5a74508 |
| Khoá xu `game.tree_xu_price`, `game.plot_unlock_xu_base`, `game.xu_per_seed`, `wallet.xu_convert_multiplier` vào DEAD | BỎ ở L2 | Code L3 (game, game-garden, wallet) còn đọc; T16 giữ danh sách `PENDING_L3_XU_KEYS` để L3 xoá |

### Migration

`apps/api/prisma/migrations/20261012120000_pd3_points_config_keys/migration.sql`. Chỉ INSERT ... ON CONFLICT DO NOTHING và UPDATE có điều kiện, không DROP/DELETE:

- `referral.referrer_reward_points = CEIL(coins.referrer_reward/1000)`, chỉ khi giá trị cũ là số (`jsonb_typeof = 'number'`).
- `referral.milestones_points` từ `coins.referral_milestones`: `{count, bonusPoints: CEIL(bonus/1000)}`, bỏ phần tử không phải số.
- `game.tree_points_price` từ `game.tree_xu_price`.
- `seasonpass.tiers`: mục `XU` có số lượng là số → `POINTS` với `CEIL(amount/1000)`; gộp bằng `||` nên không sinh khoá null.
- Trần cộng đồng: 3→1 (bài/ngày), 5→3 (hay nhất/ngày), chỉ khi giá trị còn đúng mặc định cũ (admin đã sửa thì giữ).

Timestamp đặt sau migration B của L1 theo lệnh điều phối. Spec mục 10 xếp A → config → B; hai migration độc lập nhau nên thứ tự không đổi kết quả. Trên DB test: `migrate deploy` áp được; `migrate diff --exit-code` báo không khác; `check-partial-indexes` có đủ 20/20. `pd3-points-config-keys.race-spec.ts` (9 ca) chạy SQL trên schema nháp `pd3_cfg_mig` (tạo bằng `LIKE public.system_configs`), cả bảng rỗng lẫn bảng có dữ liệu mẫu, và chạy lại lần 2 để kiểm idempotent.

### Test thêm (đỏ -> xanh), output thật

Đỏ ghi ở các commit tính năng (test viết trước):

- Config SQL bản nháp spec: `23502` (null value) với giá trị JSON không phải số; ca trần 3→1 đỏ trước khi thêm UPDATE. Sau sửa: `pd3-points-config-keys  Tests: 9 passed, 9 total`.
- `reward-points.service.spec.ts`: đỏ vì chưa có module (`Cannot find module './reward-points.service'`). Xanh 33 ca.
- `community-reward.service.spec.ts`: `Tests: 14 failed, 5 passed, 19 total`, rồi xanh 19/19.
- T16 `points-unit-guard.spec.ts`: `Tests: 14 failed, 7 passed, 21 total`, rồi xanh 21/21.
- affiliate-tier, storefront-quest, season-pass: mỗi spec 4 ca đỏ, sau đó xanh.

T13 `referral-order2.race-spec.ts`: 27 ca, 10 ca mới cho PD-3 gồm (j), (l1), (l2), (l3), (m5), (m6), (m7). Đỏ bằng cách tạm sửa `hasReferralEntry` chỉ đọc sổ điểm và `revokeReferralRewardForOrder` bỏ thưởng ở sổ xu, sau đó trả nguyên file:

```
✕ (j) người được mời đã có xu giới thiệu kiểu cũ (cashback) → không thưởng lần 2
✕ (l2) thưởng xu cũ rồi trả đơn → trừ lô CONVERTED ceil(xu/1000), không âm, thiếu ghi REFERRAL_DEBT ở sổ điểm
✕ (m5) mốc cấp bằng xu trước gộp, lượt bị trả → thu hồi lượt + mốc ở lô CONVERTED ceil(xu/1000)
Tests:       3 failed, 24 passed, 27 total
```

(l1) vẫn xanh khi bị đột biến vì lớp chặn thứ hai `findReferralRewardedOrders` (UNION hai sổ) bỏ cặp đơn đã thưởng cùng người mời. Xanh: `Tests: 27 passed, 27 total`.

T14 `pd3-reward-sources.race-spec.ts`: 6 ca. Đỏ bằng cách tạm cho `legacyCoinEntryExists` luôn trả false và trần ngày cộng đồng bỏ đếm sổ xu, sau đó trả nguyên file:

```
✕ (q1) nhiệm vụ đã nhận bằng xu trước gộp → listQuests báo đã nhận, claim trả alreadyClaimed, không cộng điểm
✕ (c1) bài đã thưởng best-answer bằng xu trước gộp → chọn lại best-answer (kể cả người khác) không cấp điểm
✕ (c2) trần ngày đếm HỢP hai sổ: 1 bài thưởng xu hôm nay + trần 2 → chỉ thêm 1 bài được điểm
Tests:       3 failed, 3 passed, 6 total
```

Xanh: `Tests: 6 passed, 6 total`.

### Chạy lại cuối lượt

```
pd3-reward-sources      Tests: 6 passed, 6 total
referral-order2         Tests: 27 passed, 27 total
affiliate.race          Tests: 1 passed, 1 total
commission-create       Tests: 4 passed, 4 total
ctv-assisted-refund     Tests: 10 passed, 10 total
ctv-notifications       Tests: 4 passed, 4 total
sellable-product        Tests: 27 passed, 27 total
wallet-reconcile        Tests: 2 passed, 2 total
wallet-ledger-flows     Tests: 8 passed, 8 total
feed-like-count         Tests: 4 passed, 4 total
partial-unique-indexes  Tests: 5 passed, 5 total
pd3-points-config-keys  Tests: 9 passed, 9 total
p2002-in-tx             Tests: 10 passed, 10 total
pd3-points-lots         Tests: 6 passed, 6 total
pd3-xu-migration        Tests: 11 passed, 11 total
auth-merge-guest        Tests: 11 passed, 11 total
npx jest src/modules/{wallet,feed,storefront,affiliate,game,system-config,orders} --maxWorkers=1   Test Suites: 45 passed; Tests: 1036 passed
npx tsc --noEmit -p tsconfig.json   exit 0
npx eslint <39 file .ts đổi ở L2>   0 lỗi
```

### Khác spec (chọn phương án an toàn tiền hơn)

- Sửa `prisma/seed.ts` (thuộc nhóm L5). Lý do: spec dead-config bắt mọi khoá seed phải được code đọc. Đã bỏ các khoá `coins.*`, thêm khoá `*_points` dạng createOnly, đổi `seasonpass.tiers` sang POINTS 5/8/12/20/30.
- Sửa `orders/order-reversal.service.spec.ts` (ngoài nhóm): thêm mock `pointsTransaction.findMany`, vì thu hồi giới thiệu giờ đọc cả sổ điểm. Câu log trong `order-reversal.service.ts` vẫn ghi "xu"; L3 sửa.
- `GET /me/referral` làm luôn ở L2, vì `CoinsService` bỏ phần giới thiệu. `/me/coins` giữ lại, trường giới thiệu đổi tên sang `referralEarnedPoints`/`referralSuccessCount`.
- Thêm `JSON_RULES`:
  - `referral.milestones_points`: `bonusPoints` 1..500.
  - `seasonpass.tiers`: chỉ SEEDS/POINTS, POINTS tối đa 100.
  Admin lưu nhầm số xu sẽ bị 400.
- Thêm RANGES cho `game.spin_buy_cost_points` và `loyalty.vnd_per_point_redeem`.
- `grant` có trần cứng 2000 điểm. Ngoài 1..2000 hoặc số lẻ thì log lỗi và trả 500, không ghi gì. Lý do: khoá còn giá trị xu đọc dưới tên điểm sẽ bị chặn, không cấp tiền triệu.
- `claimQuest` trả thêm `alreadyClaimed` (thưởng đã nhận ở sổ nào cũng vậy).
- Season Pass gặp mục XU (cấu hình chưa qua migration) thì trả 400 và log lỗi. Không cấp gì.
- `CreateEventDto` bỏ `rewardXu`. ValidationPipe `forbidNonWhitelisted` từ chối client cũ gửi trường này.
- Thu hồi thưởng xu cũ trừ đúng lô CONVERTED, không lấy lô STANDARD bù. Phần thiếu chỉ ghi nợ (delta 0), không để số dư âm.

### Giả định

- Thưởng mới có hạn `loyalty.point_expire_months` như điểm đơn hàng (OQ-1).
- Thưởng cộng đồng: bài 1 điểm (1/ngày), trả lời 0, hay nhất 1 điểm (3/ngày) (OQ-6).
- Mốc CTV 50/200/600/2000 (OQ-7).
- Thưởng giới thiệu 5 điểm, mốc quy `CEIL(xu/1000)` (OQ-9).
- Đã nhận bằng xu thì không nhận lại bằng điểm (OQ-11).

### Việc còn lại cho các lượt sau

- L3: các khoá `game.tree_xu_price`, `game.plot_unlock_xu_base`, `game.xu_per_seed`, `wallet.xu_convert_multiplier` vào DEAD. Gỡ `PENDING_L3_XU_KEYS` trong T16 sau khi code game/wallet thôi đọc.
- L3: `CoinsService.spendCoins` còn giữ cho game; log "xu" trong `order-reversal.service.ts`.
- Miniapp/web: hiển thị `rewardPoints`, `totalEarnedPoints`, `/me/referral` (lượt UI).

### Việc cần chủ dự án

- Duyệt các mức mặc định trên: OQ-1, OQ-6, OQ-7, OQ-9, OQ-11. Đổi mức nào thì chỉ sửa config hoặc hằng số, không cần migration.
- Trần cứng 2000 điểm/lần cấp bằng mốc CTV cao nhất. Nâng mốc thì phải nâng `POINTS_GRANT_HARD_MAX` cùng lúc.
- Dòng `REFERRAL_DEBT` (delta 0) ở sổ điểm là danh sách nợ do người mời đã tiêu điểm thưởng trước khi đơn bị trả. Hiện chưa có quy trình thu. Cần quyết: bỏ qua, hay trừ vào lần thưởng sau.

## Lượt L3 — Checkout hai lô, hoàn đúng lô, đơn XU cũ, game/ví bỏ xu, migration C (spec mục 9, 2.3, 2.5, 5, 6)

Nhánh `hz9/PD-3`, DB test riêng `tubu_it_pd3` cổng 5583. Không chạm PROD, không gọi dịch vụ ngoài.

### Các mục

| Mục | Trạng thái | Ghi chú | Commit |
|---|---|---|---|
| Chia điểm dùng theo lô `(s, c)` (`PricingService.resolvePointsRedemptionByLot`) | XONG | s = phần STANDARD, chịu trần `loyalty.max_redeem_pct`. c = phần CONVERTED, không trần %, phủ tới giá trị hàng, không phủ phí ship và phần lẻ < 1.000đ. | 8b42ca00 |
| Checkout tiêu hai lô, ghi `orders.pointsUsedConverted` | XONG | Có FOR UPDATE dòng user. STANDARD: guard `gte dùng + khoá` như cũ, ghi `ORDER_REDEEM:<code>` lot STANDARD. CONVERTED: `applyPointsDelta`, ghi `ORDER_REDEEM_CONVERTED:<code>`; thiếu điểm → 400 và rollback cả đơn. Quote trả thêm `pointsUsedConverted`, `pointsConvertedBalance`, `redeemableConvertedPoints`. | a8399898 |
| Bỏ phương thức thanh toán XU | XONG | `XU` bị bỏ khỏi `CHECKOUT_PAYMENT_METHODS`, nên DTO trả 400. Service vẫn chặn 400 phòng khi DTO bị nới. | a8399898 |
| Đơn 0đ ép COD | XONG | `total === 0` → COD, CONFIRMED, UNPAID. Gửi lại cùng idempotency key vẫn nhận lại đơn cũ. | a8399898 |
| Hoàn điểm về đúng lô (`reverseOrderPoints`) | XONG | STANDARD → `ORDER_REFUND_POINTS` (như cũ). CONVERTED → `ORDER_REFUND_CONVERTED`, `expiresAt NULL`. Đơn cũ có `pointsUsedConverted = 0` hoàn như trước. `getOverview` trả hai lô. | a2e0825a |
| Đơn XU cũ huỷ/trả hoàn điểm quy đổi | XONG | Hoàn `ceil(total/1000)` điểm lô CONVERTED, reason `ORDER_REFUND_XU:<code>`, có skipDuplicates. Không cộng xu, không vào Ví, `moneyRefunded = true`. | 390f07f5, a3f48609 |
| Admin duyệt trả đơn XU cũ: lời báo khách | XONG (ngoài nhóm, tối thiểu) | Gửi `RETURN_APPROVED_NO_REFUND`. Mẫu `RETURN_APPROVED` ghi "Tiền đã hoàn vào Ví Tubu", sai với đơn XU vì điểm vào Điểm Xanh. | 3bf63f20 |
| Game: bỏ mở lô vườn bằng xu | XONG | `unlockPlot(..., 'XU')` → 410. `nextUnlock` không còn `xuCost`. | 5a7da559 |
| Game: góp quỹ trồng cây 50 điểm | XONG | `game.tree_points_price` mặc định 50. Tiêu STANDARD trước, thiếu thì lấy CONVERTED, dưới FOR UPDATE. Reason `GAME_BUY_TREE:<cert>`, refType GAME. | 5a7da559 |
| Ví → xu trả 410 | XONG | `POST /wallet/convert-xu` và `GET /me/coins` trả 410. `getWallet` bỏ `coinsBalance`/`xuConvertMultiplier`. `CoinsService` bị xoá. | 0ca3675f |
| Khoá xu game/ví vào DEAD | XONG | `game.tree_xu_price`, `game.plot_unlock_xu_base`, `game.xu_per_seed`, `wallet.xu_convert_multiplier`. Gỡ `PENDING_L3_XU_KEYS` trong T16. | 0ca3675f |
| Gộp phiên khách và xoá tài khoản không còn đụng xu | XONG | `mergeGuestInto` không chuyển `coinsBalance`. Bỏ chặn xoá tài khoản theo xu; chặn theo điểm quy đổi (OQ-14) đã có từ L1/L2. | d4fe300a |
| Migration C: đóng băng xu | XONG | CHECK `users_coins_frozen` (`"coinsBalance" = 0`), thêm sau khi mọi đường ghi xu đã gỡ. | ef3733dc |
| Bằng chứng grep | XONG | Xem dưới. | — |
| Race T6, T8–T12, T17, T18 | XONG | T8/T9/T18 là unit theo spec. T10, T11, T6, T17, T18 chạy trên Postgres thật. T12 là test khoá, xanh ngay từ đầu. | 8b42ca00 … 4b708d88 |

Bằng chứng grep (chạy ở HEAD, không tính file test):

```
$ grep -rnE "coinsBalance.*(increment|decrement)|spendCoins|grantCoins|CoinsService" apps/api/src --include='*.ts' | grep -v "\.spec\.ts"
(rỗng)
$ grep -rn "coinsBalance" apps/api/src --include='*.ts' | grep -v "\.spec\.ts"
apps/api/src/modules/auth/auth.service.ts:628:      coinsBalance: user.coinsBalance,
apps/api/src/modules/users/account-deletion.service.ts:36:  coinsBalance: number;
apps/api/src/modules/users/account-deletion.service.ts:76:        coinsBalance: true,
```

Ba dòng còn lại chỉ ĐỌC (AuthUser và danh sách xoá tài khoản ở admin). Lượt L4 gỡ chúng cùng UI. Trong file test chỉ còn chú thích nhắc tên `CoinsService`. Ở DB, CHECK `users_coins_frozen` chặn mọi ghi khác 0.

### Migration

- `20261012130000_pd3_freeze_coins`:
  ```sql
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'users_coins_frozen' AND conrelid = '"users"'::regclass) THEN
      ALTER TABLE "users" ADD CONSTRAINT "users_coins_frozen" CHECK ("coinsBalance" = 0);
    END IF;
  END $$;
  ```
  - Migration chỉ thêm, chạy lại được.
  - Nếu còn user có `coinsBalance <> 0`, ALTER thất bại và deploy dừng. Lúc đó phải chạy lại migration B (quy đổi) trước. Lỗi này là cố ý, theo OQ-13.
- Kiểm trên DB test:
  - `prisma migrate status`: "Database schema is up to date!"
  - `prisma migrate diff ... --exit-code`: "No difference detected." (exit 0)
  - `check-partial-indexes.ts`: "Partial unique index: mong đợi 20, có trong DB 20."
- Sự cố trên DB test (không phải PROD): 16 user do các race spec cũ để lại có `coinsBalance` 8/11/1200/72000/48000. Chúng chặn migration C. Đã chạy `UPDATE users SET "coinsBalance" = 0 WHERE "coinsBalance" <> 0` chỉ trên `tubu_it_pd3`, rồi mới `migrate deploy`.
  - Trên PROD, migration B quy đổi hết xu về 0 trong cùng lần deploy, nên C áp được.
  - Nếu C lỗi trên PROD thì có nghĩa B chưa chạy hoặc có ghi xu chen giữa. Không được tự đặt về 0.

### Test thêm (đỏ -> xanh), output thật

| Phần | Đỏ | Xanh |
|---|---|---|
| `pricing.service.spec.ts` T8/T9 | 7 failed (`resolvePointsRedemptionByLot is not a function`) | 20 passed |
| `checkout.service.spec.ts` + `dto/checkout.dto.spec.ts` (T8/T9/T18, 0đ → COD, replay) | 75 failed | 92 passed |
| `loyalty.service.spec.ts`: hoàn theo lô, overview hai lô | 3 + 1 failed. T12 (khoá) xanh từ đầu | 165 passed |
| `order-reversal.service.spec.ts`: đơn XU cũ → điểm CONVERTED | 6 failed | 36 passed |
| `orders.service.spec.ts` (ngoài nhóm) | 1 failed | 238 passed |
| `game*.spec.ts` (410 mở lô xu, quỹ cây 50 điểm hai lô) | output đỏ không lưu | 188 passed |
| `points-unit-guard.spec.ts` (T16 khoá DEAD) | 2 failed | xanh |
| `auth.service.spec.ts` (gộp khách không chuyển xu) | 1 failed | 54 passed |
| `admin.service.spec.ts` (ngoài nhóm, phát hiện khi chạy module lân cận) | 2 failed (`Cannot read properties of undefined (reading 'createManyAndReturn')`), rồi 1 failed (lời báo) | 196 passed |
| `pd3-xu-migration.race-spec.ts` T17 | ENOENT (chưa có migration). Với SQL lọc theo tên của spec: 3 failed (`Expected: 1 Received: 0`) | 15 passed |
| `pd3-order-reversal.race-spec.ts` T10/T11 (mới) | Đột biến: đặt `usedConverted = 0` và bỏ `skipDuplicates` → 3 failed (`Expected: 500 Received: 620`; `Received length: 3` lỗi P2002) | 6 passed |
| `pd3-checkout-points.race-spec.ts` T6 (mới) | Đột biến: bỏ guard `gte` trong `applyPointsDelta` → 1 failed. Lớp CHECK `users_points_converted_nonneg` chặn số âm nhưng lỗi thành 500 thay vì 400 | 3 passed |
| `wallet-ledger-flows.race-spec.ts` T18 (5 lần đổi Ví → xu song song → 410) | — | 8 passed |

Output race T6/T10/T11 lần xanh:

```
[T6a] fulfilled=2 rejected=3 errors=["BadRequestException: Số Điểm Xanh không hết hạn của bạn đã thay đổi (đơn này cần 100 điểm). Vui lòng tải lại trang thanh toán."]
[T6b] fulfilled=5 rejected=6 errors=["BadRequestException: Số điểm Xanh không đủ (hiện có 0 điểm).","BadRequestException: Cần 10 điểm Xanh để quay."]
[T10] fulfilled=5 rejected=0 errors=[]
[T11] fulfilled=5 rejected=0 errors=[]
```

Ý nghĩa từng ca:
- T6a: 5 đơn chạy song song, mỗi đơn cần 100 điểm lô CONVERTED, số dư 250. Kết quả đúng 2 đơn, lô còn 50.
- T6b: một đơn tiêu hai lô chạy chồng với quay ×5, đổi voucher ×3, quỹ cây ×2. Không lô nào âm, quay và voucher chỉ ghi lô STANDARD.
- T6c: 6 lượt góp quỹ cây, có 100 STANDARD + 120 CONVERTED. Đúng 4 lượt, còn 0/20.
- T10: 2 lần khách huỷ và 3 lần `reverseOrderPoints` chạy đồng thời. Hoàn đúng 30 STANDARD và 120 CONVERTED, mỗi lô 1 dòng.
- T11: đơn XU 123.456đ → +124 CONVERTED. Ví = 0, xu = 0. Huỷ chạy song song với `reverseFinancials` chỉ hoàn 1 lần. Lật lại PAID rồi đảo ×3 vẫn chỉ có 1 dòng.

Sau mỗi ca, `findPointsLotDrift` trả rỗng.

### Chạy lại cuối lượt (HEAD)

```
npx jest src/modules/{checkout,pricing,loyalty,orders,game,wallet,system-config,auth,users,cashback} --maxWorkers=1   Test Suites: 52 passed; Tests: 978 passed
npx jest src/modules/{admin,affiliate,integrations,storefront} --maxWorkers=1   Test Suites: 40 passed; Tests: 749 passed
npx tsc --noEmit -p tsconfig.json   exit 0
npx tsc -p <scratch>/tsconfig.pd3-race.json (src + spec + test/integration-race, types jest)   exit 0, 0 dòng lỗi
npx eslint <45 file .ts đổi ở L3>   0 lỗi (1 cảnh báo có sẵn: affiliate.race-spec.ts:87 eslint-disable thừa)
Race, mỗi file chạy riêng (--runInBand):
pd3-points-lots 6, pd3-xu-migration 15, pd3-order-reversal 6, pd3-checkout-points 3, order-cancel 2,
wallet-ledger-flows 8, wallet-reconcile 2, sellable-product 27, auth-merge-guest 11, account-deletion 13,
affiliate 1, referral-order2 27, ctv-assisted-refund 10, commission-create 4, ctv-notifications 4,
game-spin-limit 2, p2002-in-tx 10, admin-confirm-payment 4, address-subscription 7, admin-lookups 5,
admin-invoice 4, admin-order-search 3, cod-return-refund 3, dealer-bonus 4, buy-flow-4a 5,
my-coupons-query 2, loyalty 5, pancake-paid-status 4, pd3-reward-sources 6, subscription-duplicate 8,
pending-payment-expiry 8, subscription-cycle-payment 15  — tất cả passed, 0 failed
```

### Khác spec (chọn phương án an toàn tiền hơn)

- **Migration C kiểm constraint theo cả bảng (`conrelid`), không chỉ theo tên.** SQL của spec chỉ lọc `conname`. Nếu một schema khác cùng DB đã có constraint trùng tên, bảng `users` của schema đích sẽ không được khoá. Race spec T17 trên schema nháp đã đỏ đúng chỗ này.
- **Đơn 0đ ép COD có `paymentStatus = UNPAID`** như mọi đơn COD. Không có tiền thật nào được thu. Gửi lại cùng idempotency key với `paymentMethod` gốc khác COD vẫn trả đơn cũ, không báo "đổi phương thức".
- **`CoinsService` bị xoá hẳn.** Spec L2 nói giữ lại để đọc lịch sử, nhưng sau L3 không còn chỗ nào gọi nó. `GET /me/coins` trả 410 thẳng từ controller. Lịch sử `coin_transactions` vẫn còn nguyên trong DB.
- **`UnlockPlotDto` vẫn nhận `'XU'`.** Nhờ vậy client cũ gửi XU nhận 410 kèm lời giải thích, thay vì 400 validation. Spec ghi DTO chỉ nhận SEEDS.
- **Đơn XU cũ lên hộ CTV (`placedForCustomer`)**: hoàn điểm cho chủ đơn và log lỗi để kiểm tay. Luồng lên hộ chưa từng nhận XU, nên trường hợp này không nên xảy ra.
- **Góp quỹ cây không trừ phần điểm đang khoá (`lockedOrderPoints`)**, giống vòng quay hiện tại. Spec không nói rõ chỗ này.
- **Admin duyệt trả đơn XU (ngoài nhóm, `admin.service.ts`)** gửi mẫu trung tính `RETURN_APPROVED_NO_REFUND`. Mẫu "Tiền đã hoàn vào Ví Tubu" là sai với đơn XU. Chưa thêm mẫu mới, vì mẫu tin thuộc L5.
- File ngoài nhóm đã sửa, đều ở mức tối thiểu:
  - `orders.service.spec.ts`, `admin.service(.spec).ts`, `auth.service(.spec).ts`, `account-deletion.service.ts`, `prisma/seed.ts`, `tier-perks-seed.spec.ts`: theo thay đổi xu, nếu không sửa thì test đỏ hoặc vẫn còn đường ghi xu.
  - Chú thích ở `cashback.module.ts` và `reward-points.service.ts`.
  - Các race spec đang provide `CoinsService` hoặc mock `resolvePointsRedemption` (sellable-product, affiliate, referral-order2, ctv-assisted-refund, commission-create, ctv-notifications, wallet-ledger-flows, wallet-reconcile, auth-merge-guest, account-deletion).
- Commit từ e00e37d0 trở đi ghi `Co-Authored-By: Claude Opus 5.5`, theo hướng dẫn ghi công mới của hệ thống. Các commit trước ghi Sonnet 5.5 như đề bài.

### Giả định

- Điểm (cả lô quy đổi) chỉ trừ vào giá trị hàng. Không trừ phí ship, phần lẻ < 1.000đ khách tự trả (OQ-2).
- Lô quy đổi không dùng cho vòng quay, đổi voucher và mở lô vườn (OQ-3). T6b kiểm phần này.
- Bỏ mở lô vườn bằng xu (OQ-4). Góp quỹ cây giá 50 điểm, STANDARD trước (OQ-5).
- Đơn XU cũ hoàn `ceil(total/1000)` lô quy đổi, không về Ví (OQ-8).
- `loyalty.vnd_per_point_redeem` khoá 1.000 (OQ-11). Công thức `(s, c)` dựa vào điều này.
- Xoá tài khoản bị chặn khi còn điểm quy đổi (OQ-14), đã có từ trước.

### Việc còn lại cho các lượt sau

- **L4 (UI, bắt buộc deploy cùng API L3).** Miniapp vẫn:
  - gọi `getCoins` (`/me/coins`, nay 410) và `convertToXu` ở `pages/wallet.tsx:7,44`
  - hiện phương thức XU ở `pages/checkout.tsx:295-302` và `utils/checkout-rules.ts`
  
  Deploy API L3 mà chưa có L4 thì trang Ví lỗi phần xu, và khách chọn XU nhận 400. Cần:
  - hiện hai lô (`pointsConvertedBalance`, `redeemableConvertedPoints` từ quote)
  - bỏ XU khỏi checkout
  - bỏ màn đổi xu
  - gỡ `coinsBalance` khỏi AuthUser (`auth.service.ts:628`) và khỏi danh sách xoá tài khoản ở admin
- **L5 (mẫu tin):**
  - Mẫu `CASHBACK_PAID` (seed.ts:684) vẫn mời "Đổi sang TubuXu để nhận thêm 20%", trong khi tính năng đã 410.
  - Cần mẫu riêng cho "đã hoàn N Điểm Xanh" khi trả đơn XU, thay cho mẫu trung tính.
  - Thông báo quy đổi xu (OQ-10).
- Lời báo "đã hoàn N Điểm Xanh" khi huỷ chưa tách theo lô (L5).

### Việc cần chủ dự án

- Duyệt các mặc định của lượt này: OQ-2 (không trừ ship, khách trả phần lẻ < 1.000đ), OQ-3, OQ-4, OQ-5 (50 điểm/cây), OQ-8 (`ceil`, khách lời ≤ 999đ/đơn XU cũ), OQ-11, OQ-14.
- **Thứ tự deploy:** migration A → B → C và API L3 phải đi cùng UI L4. Migration C sẽ dừng deploy nếu còn ai có xu ≠ 0. Không tự đặt xu về 0 trên PROD; phải chạy B (quy đổi có sổ) rồi mới C.
- Duyệt lời báo khách khi admin duyệt trả đơn XU cũ: hiện dùng mẫu trung tính "Yêu cầu đổi/trả đơn … đã được duyệt." Theo luật làm việc, lời báo khách cần reviewer Opus xem trước khi merge.
- Mẫu `CASHBACK_PAID` đang quảng cáo đổi Ví sang TubuXu, tính năng đã ngừng. Cần sửa nội dung trên DB PROD, vì seed không ghi đè mẫu đã có.
- Toàn bộ lượt L3 đụng tiền trả trước của khách: cần review đối kháng (reviewer) trước khi merge.
