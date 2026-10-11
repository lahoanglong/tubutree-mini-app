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
