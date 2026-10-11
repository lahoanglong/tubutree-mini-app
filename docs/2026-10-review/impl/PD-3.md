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

## Review B1 (reviewer độc lập, lượt 2 trên nhánh L1-L3)

Trạng thái: **XONG phần mã**, còn ba việc không thuộc phạm vi lượt này (L4/L5, số đo PROD, ba câu hỏi mở) ghi ở "Việc cần chủ dự án". Sáu finding: 1 major (đúng, đã sửa), 2 minor đã sửa, 1 minor sửa một phần, 2 minor không sửa được ở đây. Mỗi sửa một commit `address review B1`. Test đỏ thấy trước khi sửa; output thật bên dưới.

| # | Mức | Finding | Kết luận | Commit |
| --- | --- | --- | --- | --- |
| 1 | major | Hoàn lô CONVERTED nằm ở `reverseOrderPoints` chạy sau commit huỷ; ném lỗi thì khách mất điểm quy đổi vĩnh viễn | ĐÚNG, đã sửa: hoàn trong tx của `reverseFinancials` | 614b2376, 670db884 (chú thích) |
| 2 | minor | Báo khách sai khi duyệt trả: (a) đơn 0đ báo "đã hoàn vào Ví"; (b) đơn XU cũ nhận mẫu "không hoàn gì" thay vì "đã hoàn N Điểm Xanh" | ĐÚNG cả hai, đã sửa | 72e642fb |
| 3 | minor | RANGES khoá `*_points` nhận số lẻ (2.5) nhưng `RewardPointsService.grant` ném 500 | ĐÚNG, đã sửa (thêm `integer`) | b8dc809a |
| 4 | minor | AuthUser còn `coinsBalance`; mẫu `CASHBACK_PAID` mời đổi sang TubuXu; FE/e2e chưa đổi | MỘT PHẦN: mẫu tin đã sửa (cả `COMMUNITY_BEST_ANSWER`); `coinsBalance` và FE KHÔNG sửa (thuộc L4/L5, xem dưới) | d14ccabc |
| 5 | minor | Q-03a: chi phí làm tròn chưa đo trên số dư thật | KHÔNG sửa được ở đây (cấm PROD); vẫn là cổng deploy | báo cáo này |
| 6 | minor | Q-03 "Ví trả một phần" chưa có; OQ-1..15 chưa duyệt, đáng chú ý OQ-5, OQ-9, OQ-12 | KHÔNG phải việc của mã; chuyển sang "Việc cần chủ dự án" | báo cáo này |

### 1. Hoàn lô CONVERTED sau commit (major)

Xác minh bằng mã: cả ba nơi huỷ/trả (`orders.service.ts` `cancel`, `order-status.service.ts` `setStatus`, `admin.service.ts` `reviewReturn`) chạy `reverseFinancials` trong tx lật trạng thái, rồi gọi `loyalty.reverseOrderPoints` SAU commit. Phần CONVERTED (tiền trả trước) khi đó nằm ở `reverseOrderPoints`. Ném lỗi ở đó thì đơn đã `CANCELLED`/`RETURNED`; `cancel` lần hai bị `assertCustomerCancellable` chặn, `setStatus` lần hai ra nhánh `!won`/no-op, và không có endpoint resync nào (chú thích cũ ở `order-status.service.ts` nói có là sai). `points-reconcile` không bắt được vì sổ vẫn khớp số dư. Reviewer đúng, và đây là thụt lùi so với trước PD-3 (xu hoàn trong tx).

Test đỏ trước khi sửa (race, Postgres thật, giả lập `reverseOrderPoints` ném sau khi tx huỷ commit; user có 500 STANDARD + 300 CONVERTED, đơn tiêu 30 + 120):

```
✕ B1: reverseOrderPoints ném lỗi sau khi tx huỷ commit → lô CONVERTED đã hoàn, retry chỉ hoàn STANDARD
    expect(mid.pointsConvertedBalance).toBe(300)
    Expected: 300
    Received: 180
Tests:       1 failed, 7 passed, 8 total
```

Khách mất 120 điểm (120.000đ). Unit đỏ: `order-reversal.service.spec.ts` 3 failed (hoàn CONVERTED trong tx), `loyalty.service.spec.ts` 4 failed (đã bỏ khỏi `reverseOrderPoints`, kiểm "đã đảo chưa" không còn `ORDER_REFUND_CONVERTED`).

Sửa:
- `OrderReversalService.refundConvertedPoints` (trong `reverseFinancials`, cùng tx): `applyPointsDelta` lô CONVERTED, reason `ORDER_REFUND_CONVERTED:<code>`, `skipDuplicates: true`. Số điểm = `min(pointsUsed, pointsUsedConverted)`. Một lần nhờ guard lật trạng thái của caller, lớp hai là index `points_transactions_converted_refund_unique`. Chạy với mọi kênh thanh toán, kể cả COD huỷ chưa giao (không có tiền để hoàn nhưng điểm vẫn phải hoàn).
- `LoyaltyService.reverseOrderPoints`: bỏ nhánh CONVERTED và bỏ `ORDER_REFUND_CONVERTED` khỏi danh sách `reason in` của kiểm "đã đảo chưa". Nếu giữ, dòng do tx huỷ ghi trước sẽ làm bước này thoát sớm và bỏ qua hoàn STANDARD cùng đảo `pointsEarned` (test khoá: đơn đã giao tiêu hai lô vẫn đảo `pointsEarned` và hoàn STANDARD).
- Chọn phương án sửa chính của reviewer (hoàn trong tx), không chọn phương án đối soát/cron: không để cửa sổ lỗi.

Xanh: `pd3-order-reversal  Tests: 8 passed, 8 total` (T10 hai lô, T10 đồng thời 2 huỷ + 3 `reverseOrderPoints`, hai ca B1 mới, T11 ×3). Ca B1 thứ hai (đơn chỉ lô CONVERTED, `reverseOrderPoints` ném lỗi rồi gọi lại) kiểm số dư đúng ngay sau commit huỷ và đúng một dòng hoàn sau khi gọi lại.

Giới hạn, KHÔNG sửa: phần STANDARD (`ORDER_REFUND_POINTS`) và đảo `pointsEarned` vẫn nằm ở `reverseOrderPoints` sau commit, đúng như trước PD-3. Đó là điểm thưởng/tích luỹ, không phải tiền trả trước, và nằm ngoài finding. Cùng cửa sổ lỗi vẫn có thể làm khách mất tối đa phần điểm thường khi `reverseOrderPoints` ném lỗi. Nếu chủ dự án muốn đóng luôn, cần một gói riêng (đưa cả hai vào tx hoặc thêm đối soát).

### 2. Báo khách sai khi duyệt trả hàng (minor)

Xác minh bằng mã: (a) đơn COD tổng 0đ đã giao rồi trả: `isCodCollected` đúng, guard `UNPAID→REFUNDED` thắng (`count = 1`), nhưng `refundToWallet` thoát sớm vì `total <= 0`, trong khi `moneyRefunded = true`; khách nhận "Tiền đã hoàn vào Ví Tubu". (b) đơn XU cũ rơi vào `RETURN_APPROVED_NO_REFUND` do chốt `paymentMethod !== 'XU'` ở admin; không nói đã hoàn bao nhiêu Điểm Xanh. Cả hai đúng.

Test đỏ: `order-reversal.service.spec.ts` 10 failed (kết quả mới `{ moneyRefunded, pointsRefunded }`, đơn 0đ, đơn lên hộ 0đ, đơn XU cũ); `admin.service.spec.ts` 4 failed (mẫu tin theo Ví và điểm).

Sửa:
- `reverseFinancials` trả `{ moneyRefunded, pointsRefunded }`. `moneyRefunded` chỉ true khi Ví thực sự được cộng > 0đ (`refundToWallet` trả boolean; nhánh lên hộ thêm `&& total > 0`). Đơn XU cũ: `moneyRefunded = false`, `pointsRefunded = ceil(total/1000)`. Khác spec 6.2 (xem "Khác spec"). `pointsRefunded` còn gồm lô CONVERTED hoàn trong tx; trả 0 khi dòng đã có (không báo hoàn điểm đã hoàn từ trước).
- `admin.reviewReturn`: tổng điểm báo khách = `pointsRefunded` + phần STANDARD (`pointsUsed - min(pointsUsed, pointsUsedConverted)`, do `reverseOrderPoints` hoàn ngay sau). Chọn mẫu theo (Ví, điểm): Ví và điểm → `RETURN_APPROVED_WALLET_POINTS`; chỉ Ví → `RETURN_APPROVED`; chỉ điểm → `RETURN_APPROVED_POINTS`; không gì → `RETURN_APPROVED_NO_REFUND`.
- Hai mẫu mới, lời tin đúng thuật ngữ Q-26, cả seed (`createOnly`) lẫn migration (prod không chạy seed):
  - `RETURN_APPROVED_POINTS`: "Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Đã hoàn {{points}} Điểm Xanh vào tài khoản của bạn 🌿"
  - `RETURN_APPROVED_WALLET_POINTS`: "Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Tiền đã hoàn vào Ví Tubu và {{points}} Điểm Xanh đã hoàn vào tài khoản của bạn 🌿"
- Hệ quả hành vi: đơn thường (trả Ví) từng tiêu điểm thường nay nhận mẫu "Ví và N Điểm Xanh" thay vì chỉ "Ví". Chỉ thêm thông tin đúng, không đổi số tiền.
- Lệch nhỏ: nếu `reverseOrderPoints` bỏ qua phần STANDARD vì đã đảo từ trước (chỉ khi xử lý lặp), số điểm báo vẫn tính phần STANDARD. Không xảy ra ở đường duyệt trả lần đầu.

Xanh: `admin.service.spec.ts` và `order-reversal.service.spec.ts` xanh; `notification-templates-seed.spec.ts` thêm hai mẫu vào kiểm "prod (chỉ chạy migration) có đúng lời tin như seed" và hai ca render. Ghi thật: ca kiểm mẫu mới viết cùng lúc với dòng seed nên không có lần chạy đỏ riêng; dạng lỗi nếu thiếu seed là `TypeError` khi tra mẫu theo mã.

### 3. Khoá `*_points` nhận số lẻ (minor)

Xác minh: `RewardPointsService.grant` từ chối `!Number.isInteger(points)` bằng 500; RANGES chỉ kiểm `min`/`max`/số hữu hạn nên 2.5 nằm trong 0–100 và qua được; `config.get` đọc thẳng. Thưởng giới thiệu rơi vào catch ở `order-status` (log, không cấp); thưởng cộng đồng bị tắt âm thầm; góp quỹ cây báo chưa khả dụng. Đúng. Phát hiện thêm: `game.spin_buy_cost_points` cùng loại (trừ vào cột INTEGER), cũng thêm.

Test đỏ (`points-unit-guard.spec.ts`, 6 khoá × số lẻ): `Tests: 6 failed, 20 passed, 26 total`. Sửa: `RANGES` thêm `integer?: true` cho 6 khoá (`referral.referrer_reward_points`, ba khoá `community.*_reward_points`, `game.tree_points_price`, `game.spin_buy_cost_points`), `assertInRange` từ chối số lẻ kèm lời "phải là số nguyên". Xanh: `src/modules/system-config  Tests: 84 passed, 84 total`.

### 4. `coinsBalance` ở AuthUser, mẫu `CASHBACK_PAID`, FE chưa đổi (minor, một phần)

Đúng cả ba: `auth.service.ts:628` còn trả `coinsBalance` (luôn 0 do `users_coins_frozen`); `CASHBACK_PAID` mời "Đổi sang TubuXu" (đã 410); miniapp/web/e2e chưa đổi. Nhánh này không deploy riêng được (đã ghi từ L3).

Đã sửa (rẻ và an toàn, theo spec mục 5 và 7.2): lời hai mẫu còn nhắc TubuXu.
- `CASHBACK_PAID`: bỏ câu "Đổi sang TubuXu để nhận thêm 20% nhé!".
- `COMMUNITY_BEST_ANSWER`: "Bạn nhận thêm TubuXu thưởng." thành "Bạn nhận thêm Điểm Xanh thưởng." (thưởng đã là Điểm Xanh từ L2).
- Seed đổi lời; migration `20261012150000_pd3_review_b1_xu_wording_templates` là UPDATE có điều kiện `WHERE "bodyTemplate" = <bản cũ>` để giữ bản admin đã sửa.
- Test đỏ: `notification-templates-seed.spec.ts` 3 failed (không mẫu nào được nhắc xu; prod chỉ-migration có đúng lời seed ×2). Xanh: `Tests: 55 passed` cho `src/modules/notifications`.
- Chạy migration trên DB test có hàng mẫu: bản seed cũ được đổi lời; hàng admin đã sửa ("Admin đã sửa: chúc mừng bạn nhận TubuXu") giữ nguyên; chạy lại thủ công bằng psql: `UPDATE 0` / `UPDATE 0`.

KHÔNG sửa ở đây: bỏ `coinsBalance` khỏi AuthUser và shared-types. Miniapp còn đọc (`checkout.tsx:128` `user?.coinsBalance`, `profile.tsx:281`, `wallet.tsx:208`, `account-api.ts`), web admin còn đọc (`account-deletion-panel.tsx:26,146`). Bỏ ở API mà FE chưa đổi là làm sai kiểu chứ không an toàn hơn. Thuộc L4 (FE) và L5 (e2e); các file FE ngoài nhóm của lượt này và bị PD-1 sửa chung (spec đầu file).

### 5. Chi phí làm tròn trên số dư thật (minor, KHÔNG sửa được ở đây)

Cùng kết luận với A1 mục 4. Số "6 user, 2.543đ" của reviewer là số trên DB mẫu của chính spec (mục "Kiểm chứng SQL"), không phải số dư thật. Cấm PROD nên không đo được; không ghi số sai vào spec. Bảng điền số ở A1 mục 4 vẫn là cổng deploy. Truy vấn để chạy trên BẢN SAO PROD (chỉ đọc), lấy từ spec 3.3:

```sql
SELECT count(*) AS users_with_xu, COALESCE(sum("coinsBalance"),0) AS total_xu,
       COALESCE(sum(("coinsBalance"+999)/1000),0) AS total_points,
       COALESCE(sum(("coinsBalance"+999)/1000)*1000 - sum("coinsBalance"),0) AS rounding_cost_vnd,
       COALESCE(max("coinsBalance"),0) AS max_xu_one_user
  FROM "users" WHERE "coinsBalance" > 0;
SELECT count(*) AS negative_users FROM "users" WHERE "coinsBalance" < 0;
SELECT count(*) AS coin_drift_users FROM "users" u
 WHERE u."coinsBalance" <> COALESCE((SELECT sum(delta) FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);
SELECT status, "paymentStatus", count(*), sum(total) AS total_xu, sum((total+999)/1000) AS refund_points_if_all_reversed
  FROM "orders" WHERE "paymentMethod" = 'XU' AND status NOT IN ('CANCELLED','RETURNED') GROUP BY 1, 2;
```

### 6. Ví trả một phần, OQ-1..15 chưa duyệt (minor, không phải việc của mã)

Đúng về sự thật: `checkout.service.ts` vẫn bắt `walletBalance >= total` (Ví chỉ trả TOÀN BỘ đơn), spec đã dời "Ví trả một phần" sang OQ-12. Mã dùng đúng mặc định của spec cho mọi OQ; không đổi gì ở lượt này. Ba câu cần chủ dự án xác nhận rõ trước khi gộp nhánh (xem dưới).

### Chạy lại cuối lượt (HEAD)

```
npx jest src/modules/{checkout,pricing,loyalty,orders,game,wallet,system-config,auth,users,cashback,notifications} --maxWorkers=1   Test Suites: 55 passed; Tests: 1053 passed
npx jest src/modules/{admin,affiliate,integrations,storefront,feed} --maxWorkers=1                                              Test Suites: 44 passed; Tests: 991 passed
npx tsc --noEmit -p tsconfig.json                                                                                               exit 0
npx tsc -p <scratch>/tsconfig.pd3-race.json (src + test/integration-race, types jest)                                           exit 0
npx eslint <file .ts đã sửa>                                                                                                    0 lỗi
prisma migrate deploy trên tubu_it_pd3 (2 migration mới)                                                                        All migrations have been successfully applied
prisma migrate diff ... --exit-code                                                                                             No difference detected. (exit 0)
check-partial-indexes.ts                                                                                                        mong đợi 20, có trong DB 20
Race, mỗi file chạy riêng (--runInBand): pd3-order-reversal 8, pd3-checkout-points 3, pd3-points-lots 6, pd3-xu-migration 15,
order-cancel 2, cod-return-refund 3, admin-confirm-payment 4, pancake-paid-status 4, pending-payment-expiry 8, dealer-bonus 4,
loyalty 5, sellable-product 27, wallet-ledger-flows 8, ctv-assisted-refund 10, auth-merge-guest 11 — tất cả passed, 0 failed
```

### Migration (thêm cho B1)

Cả hai chỉ thêm / UPDATE có điều kiện, chạy lại được, không DROP/DELETE:
- `20261012140000_pd3_review_b1_return_templates`: `INSERT ... ON CONFLICT DO NOTHING` hai mẫu `RETURN_APPROVED_POINTS`, `RETURN_APPROVED_WALLET_POINTS`. Chạy lại: `INSERT 0 0`.
- `20261012150000_pd3_review_b1_xu_wording_templates`: UPDATE `CASHBACK_PAID`, `COMMUNITY_BEST_ANSWER` chỉ khi lời còn đúng bản cũ. Không đổi schema, không ảnh hưởng `check-partial-indexes`.

### Khác spec (thêm cho B1, chọn phương án an toàn tiền hơn)

- Spec 2.5 để `reverseOrderPoints` hoàn lô CONVERTED; nay hoàn ở `reverseFinancials` trong tx huỷ (spec 6.2 đã để đơn XU cũ ở đó). Lý do: finding 1. Index và reason `ORDER_REFUND_CONVERTED` không đổi.
- Spec 6.2 nói `moneyRefunded` của đơn XU cũ vẫn true. Nay false, kèm `pointsRefunded`. Lý do: tên và chỗ dùng của cờ là "tiền vào Ví"; câu báo khách chọn theo `pointsRefunded`.
- `reverseFinancials` đổi kiểu trả về thành `{ moneyRefunded, pointsRefunded }` (chỉ `admin.reviewReturn` đọc kết quả).
- File ngoài nhóm đã sửa, tối thiểu: `admin.service(.spec).ts`, `notification-templates-seed.spec.ts`, `prisma/seed.ts` (mẫu tin), `order-status.service.ts` (chỉ chú thích).

### Việc còn lại

- L4 (FE) và L5 (e2e, `coinsBalance` ở AuthUser/shared-types, mẫu `XU_CONVERTED` theo OQ-10), bắt buộc trước deploy.
- Phần STANDARD hoàn sau commit (mục 1, "Giới hạn"): quyết định có đóng hay không.

### Việc cần chủ dự án (thêm cho B1)

- Duyệt rõ ba mặc định mà reviewer nêu, trước khi gộp nhánh:
  - OQ-12: "Ví trả một phần đơn" KHÔNG có trong PD-3; Ví chỉ trả toàn bộ đơn. Q-03 phương án 1 cần một gói riêng.
  - OQ-5: góp quỹ trồng cây 50 Điểm Xanh được lấy lô quy đổi khi lô thường thiếu. Đó là tiền khách đã trả trước; giao diện phải nói rõ (L4).
  - OQ-9: thu hồi thưởng giới thiệu đã cấp bằng xu thì trừ lô quy đổi `ceil(xu/1000)`: mỗi lần ≤ 5 điểm (thưởng đơn 2) hoặc ≤ 100 điểm (mốc 10 người), nghĩa là ≤ 100.000đ mỗi người mời, và phần đó đã trộn vào lô quy đổi ở migration B nên không tách lại được. Phương án khác: không thu hồi thưởng xu cũ (Tubu chịu).
- Lời báo khách mới/đổi cần reviewer Opus xem trước khi merge (quy tắc "customer messages"): `RETURN_APPROVED_POINTS`, `RETURN_APPROVED_WALLET_POINTS`, `CASHBACK_PAID`, `COMMUNITY_BEST_ANSWER`. Trên PROD, nếu admin đã sửa lời một mẫu thì migration giữ nguyên bản đó (chỉ đổi khi còn đúng bản seed cũ): cần kiểm tay.
- Cổng deploy đo số thật (mục 5) vẫn mở.

## Lượt L4 — FE miniapp, web, admin, shared-types (spec mục 7, T19)

Nhánh `hz9/PD-3`. Chỉ đụng mã FE và kiểu dùng chung, không cần DB, không chạm PROD, không gọi dịch vụ ngoài, không chạy Playwright hay dev server.

### Các mục

| Mục | Trạng thái | Ghi chú | Commit |
|---|---|---|---|
| shared-types `AuthUser` | XONG | Bỏ `coinsBalance`, thêm `pointsConvertedBalance`. Chú thích `PaymentMethod.XU` nói "chỉ còn ở đơn cũ". Rebuild `dist` bằng `tsc -p`. | 497ee959 |
| API đọc `AuthUser` và danh sách xoá tài khoản (ngoài nhóm, tối thiểu) | XONG | `toAuthUser` trả `pointsConvertedBalance`; `BlockerUser` và select bỏ `coinsBalance`. Cần để `tsc` của API xanh sau khi kiểu đổi. | 497ee959 |
| `account-api.ts`: bỏ `getCoins`, `convertToXu`, `CoinsOverview`, `CoinTxn`; thêm `getReferral` (`/me/referral`), `LoyaltyOverview` hai lô, `PointsTxn.lot`, nhãn sổ mới | XONG | `WalletSummary` không còn trường xu. `pointsReasonLabel` có nhãn cho `XU_TO_POINTS`, `ORDER_REFUND_*`, `REFERRAL_*`, `COMMUNITY_*`, `STOREFRONT_QUEST`, `CTV_MILESTONE`, góp quỹ trồng cây. | c64ba4c0 |
| Hub Cá nhân | XONG | Còn đúng 3 số dư: Điểm Xanh (tổng hai lô), Ví Tubu, Mã giảm giá. Helper thuần `utils/points-lots.ts` (`pointsSummary`, `convertedPointsNote`). | b7c0da51 |
| Ví | XONG | Bỏ thẻ TubuXu, nút và sheet đổi, mẹo x1,2. Dòng Điểm Xanh nói rõ phần không hết hạn dùng ở đâu, không ra tiền. Khối mời bạn đọc `/me/referral`, đơn vị Điểm Xanh. `canConvertToXu` bị xoá, nhãn sổ cũ là "Đổi sang xu cũ (nay là Điểm Xanh)". | 9e125a85 |
| Thanh toán | XONG | Còn 3 phương thức COD, chuyển khoản, Ví Tubu. Dưới ô Điểm Xanh có "trong đó N điểm không hết hạn, trả tới 100% giá trị hàng". Đơn 0đ ẩn chọn phương thức, ghi "Đơn đã được trả đủ bằng Điểm Xanh...", gửi COD và không mở trang QR chuyển khoản. Điểm sẽ tích hiện cho mọi phương thức. `pointsToUse` gửi = phần thường dùng được + phần quy đổi, BE tự chia. | 9294b7b5 |
| Game | XONG | Bỏ mở lô bằng xu (chỉ còn nút giọt nước, `unlockPlot()` gửi `{currency:'SEEDS'}`). Nút "Góp quỹ trồng cây (50 điểm)" đọc `treePointsPrice`; chú thích dưới nút nói điểm thường dùng trước, thiếu mới dùng điểm không hết hạn (OQ-5). Thưởng Season Pass là `SEEDS` hoặc `POINTS`. `buyTree` trả `pointsUsed`, `pointsUsedConverted`. Làm mới `['loyalty']`, không còn `['coins']`. | 4839f313 |
| CTV | XONG | `rewardPoints`, `milestoneRewardPoints`, "Thưởng mốc +N điểm", "Đã cộng vào Điểm Xanh", làm mới `['loyalty']`. | fa48c4c1 |
| Gian hàng | XONG | `rewardPoints`, `totalEarnedPoints`, kết quả nhận `pointsBalance`. Chú thích nhắc xu đã dọn. | 58596ba1 |
| Cộng đồng | XONG | `rewardPoints` (hiển thị và form admin). Thêm dòng gợi ý đơn vị "1 điểm = 1.000đ, tối đa 1.000 điểm" dưới ô nhập (BE từ chối > 1.000, tránh nhập nhầm theo đơn vị xu cũ). | d22929de |
| FAQ | XONG | Câu thanh toán: "... trả bằng Ví Tubu. Dùng Điểm Xanh để giảm giá ngay ở bước thanh toán." Câu Điểm Xanh thêm một câu về điểm quy đổi từ xu cũ (không hết hạn, trừ tới 100% giá trị hàng, không đổi mã giảm giá). | 6db4caa4, 11b3a945 |
| Định dạng | XONG | Xoá `formatXu`, component `Xu`, `checkout.paymentXu`. `paymentMethod.XU` = "Điểm Xanh (xu cũ)". Dọn chú thích nhắc xu. | 2d783fa6 |
| Trang Điểm Xanh (`loyalty.tsx`) | XONG | Thẻ hạng và thẻ thành viên hiện TỔNG hai lô; dòng "trong đó N điểm không hết hạn"; ghi chú trong danh mục đổi quà: điểm không hết hạn không dùng để đổi mã giảm giá; dòng sổ lô quy đổi ghi "Điểm không hết hạn". "Điểm còn lại" trong hộp xác nhận đổi quà vẫn tính trên lô thường vì chỉ lô thường đổi được. | a3112d14 |
| Thông báo | XONG (một phần việc của L5) | `XU_CONVERTED` thuộc nhóm "Điểm Xanh", nút dẫn tới `/loyalty`. Mẫu tin `XU_CONVERTED` do L5 tạo; FE sẵn sàng. | c220a34e |
| Web khách | XONG | `order-view.ts`: `XU` = "Điểm Xanh (xu cũ)". | aacb7d74 |
| Admin web | XONG | `export-csv.ts`: `XU` = "Xu cũ (đã gộp Điểm Xanh)". `account-deletion-panel.tsx`: `pointsConvertedBalance`, hiện "N Điểm Xanh không hết hạn". | aacb7d74 |
| Guard T19 | XONG | `apps/miniapp/src/i18n/no-xu-copy.spec.ts` và `apps/web/src/lib/no-xu-copy.spec.ts`: quét mã nguồn không phải spec (kể cả chú thích), chỉ cho phép cụm "xu cũ" và tên enum `XU` viết hoa; cấm `formatXu`, `coinsBalance`, `getCoins`, `convertToXu`, `rewardXu`; kiểm nhãn Season Pass `POINTS`, `paymentMethod.XU`. `terminology.spec.ts` đổi sang cấm mọi dạng TubuXu. | 48977e8a, aacb7d74 |
| Fixture `coinsBalance` trong `store/auth.spec.ts`, `ds-v2-panels.spec.tsx`, `account-deletion-panel.spec.tsx` | XONG | Đổi sang `pointsConvertedBalance`. | 476a5194, aacb7d74 |
| Mock e2e có `coinsBalance` (`apps/e2e/tests/**`, 4 file) | BỎ (đúng phạm vi) | Thuộc L5/T20; không chạy Playwright được ở lượt này. | — |
| Ảnh chụp hub, Ví, thanh toán | BỎ | Không chạy dev server. Không có bằng chứng bằng hình, chỉ có test. | — |

Bằng chứng quét chữ (chạy ở HEAD trước commit báo cáo, lệnh ở spec mục 7.2):

```
$ rg -n -P "(?i)(tubu ?xu|(?<![\p{L}_])xu(?![\p{L}_]))" apps/miniapp/src apps/web/src -g '!*.spec.*' | grep -v "xu cũ"
apps/web/src/lib/export-csv.ts:38:  XU: 'Xu cũ (đã gộp Điểm Xanh)',
```

Dòng còn lại là khoá enum `XU` (chữ hoa) của phương thức thanh toán đơn cũ, giá trị của nó cũng là "xu cũ". Mọi chỗ khác chỉ còn cụm "xu cũ". `coinsBalance` ngoài file test: không còn (miniapp, web, shared-types). Còn trong `apps/e2e/tests/{features.miniapp.spec.ts,mock-api-routing.miniapp.spec.ts,support/mock-api.ts,support/checkout-mocks.ts}` (L5).

### Migration

Không có.

### Test thêm (đỏ -> xanh), output thật

Cột Đỏ là dòng `Tests` của lần chạy đầu sau khi viết test, trước khi sửa mã.

| Phần | Đỏ | Xanh |
|---|---|---|
| `services/account-api.spec.ts` (hai lô, `/me/referral`, nhãn sổ mới) | 16 failed, 32 passed (48) | 48 passed |
| `pages/profile-hub.spec.tsx` (đúng 3 số dư, 120 + 30 = 150) | 1 failed, 7 passed (8) | cùng `profile.spec.ts`, `points-lots.spec.ts`, `account-api.spec.ts`: 64 passed |
| `pages/wallet.spec.tsx` (không xu, `/me/referral`, ghi chú điểm quy đổi) | 27 failed (đổi mock bỏ `getCoins`, mọi ca của file đỏ) | 27 passed |
| `utils/wallet-rules.spec.ts` (`canConvertToXu` đã gỡ) | đỏ không lưu: test và mã sửa cùng lúc | 9 passed |
| `utils/checkout-rules.spec.ts` | đỏ không lưu | 30 passed |
| `pages/checkout.spec.tsx` (ba phương thức, đơn 0đ, điểm quy đổi) | 17 failed; sau sửa mã còn 2 failed | 27 passed |
| `pages/game-*.spec.tsx` (quỹ cây 50 điểm, mở lô, Season Pass điểm, `['loyalty']`) | 5 failed, 89 passed (94); vòng sau 2 failed | `game-behavior` 74 passed; cả 4 file xanh |
| `milestone-copy.spec.ts` | 2 failed, 4 passed (6) | cùng `affiliate.spec.tsx`: 26 passed |
| `affiliate.spec.tsx` (3 ca mốc Điểm Xanh, nhận thưởng làm mới `['loyalty']`) | đỏ không lưu: ca viết sau khi sửa trang | 20 passed |
| `storefront-builder.spec.tsx` | 4 failed, 32 passed (36) | 36 passed |
| `community-events.spec.tsx`, `community-moderation.spec.tsx` | 5 failed, 42 passed (47) | 47 passed |
| `about-data.spec.ts` (FALLBACK_FAQ) | 2 failed, 3 passed (5) | cùng `about.spec.tsx`: 19 passed |
| `format.spec.ts`, `price-tag.spec.tsx` (không còn `formatXu`, `Xu`) | 2 failed, 32 passed | cùng `format-guard`, `terminology`: 40 passed |
| `loyalty-behavior.spec.tsx` (hai lô, thẻ thành viên, ghi chú, nhãn sổ) | 4 failed, 23 passed (27); sửa mã còn 1 failed (bộ chọn trong test sai) | cùng `loyalty-layout`, `loyalty.spec`, `points-lots.spec`: 46 passed |
| `notifications.spec.ts` (`XU_CONVERTED`) | 2 failed, 30 passed | cùng `notifications-page.spec.tsx`: 41 passed |
| web `order-view.spec.ts`, `export-csv.spec.ts`, `account-deletion-panel.spec.tsx` | 3 failed, 15 passed (18) | cùng `ds-v2-panels`, `bank-transfer-panel`: 43 passed |
| Guard T19 (miniapp, web) | chèn file tạm `utils/zz-probe.ts` / `lib/zz-probe.ts` chứa "TubuXu": 1 failed, `offenders = ['utils/zz-probe.ts']` (web: `['lib/zz-probe.ts']`); đã xoá file tạm | miniapp `src/i18n` 5 file 17 passed; web 3 passed |

### Chạy lại cuối lượt (HEAD 11b3a945, trước commit báo cáo)

```
packages/shared-types: npx tsc -p tsconfig.json                                  exit 0
apps/miniapp: npx tsc --noEmit (gồm file spec)                                   exit 0
apps/web: npx tsc --noEmit                                                       exit 0
apps/api: npx tsc --noEmit -p tsconfig.json                                      exit 0
apps/miniapp: npx eslint <mọi .ts/.tsx đổi từ 10c634c6>                          exit 0, không có dòng nào
apps/web: npx eslint <mọi .ts/.tsx đổi từ 10c634c6>                              exit 0, không có dòng nào
apps/miniapp: npx vitest run <25 file spec đã đổi>                               Test Files 25 passed; Tests 476 passed
apps/miniapp: vitest ds-no-legacy-aliases, hit-target-guard, button-guard,
              format-guard, src/i18n (terminology, tree-fund-copy, no-xu-copy)   Test Files 9 passed; Tests 78 passed
apps/miniapp: vitest checkout, wallet, profile-hub, checkout-rules, game-behavior Test Files 5 passed; Tests 166 passed
apps/miniapp: vitest about-data, about, src/i18n (sau sửa chữ FAQ)               Test Files 7 passed; Tests 36 passed
apps/web: npx vitest run <6 file spec đã đổi + bank-transfer-panel>              Test Files 6 passed; Tests 46 passed
apps/api: npx jest auth.service.spec --maxWorkers=1                              23 passed
apps/api: npx jest admin-account-deletion --maxWorkers=1                         3 passed
```

Không chạy toàn bộ vitest, không chạy Playwright, không chạy API jest ngoài hai file trên (FE không đổi hành vi API).

### Khác spec (chọn phương án an toàn tiền hơn hoặc dễ hiểu hơn cho khách)

- Spec mục 7 ghi nhãn `XU_TO_POINTS` là "Chuyển từ xu sang Điểm Xanh". Mã dùng "Chuyển từ xu cũ sang Điểm Xanh" để lệnh quét chữ chỉ cần cho phép đúng cụm "xu cũ", không phải một ngoại lệ thứ hai.
- Khối mời bạn ở Ví: lời cũ nói "cả hai nhận xu". Không chép sang. Nay chỉ nói người giới thiệu nhận Điểm Xanh theo dữ liệu `/me/referral` (số thành công, điểm đã nhận, mốc kế tiếp); lời chia sẻ không hứa thưởng cho người được mời.
- `unlockPlot()` không còn tham số và luôn gửi `{currency:'SEEDS'}` (BE vẫn nhận trường `currency`, mở bằng XU trả 410).
- Helper `pointsSummary`, `convertedPointsNote` đặt ở `utils/points-lots.ts` thay vì `account-api.ts` như spec gợi ý, vì nhiều spec mock cả module `account-api` bằng factory (lỗi "No 'pointsSummary' export is defined on the account-api mock" đã gặp ở spec hub).
- Đơn 0đ: FE gửi COD và không mở `/bank-payment` (BE cũng ép COD). Nếu chỉ dựa vào BE, khách chọn "chuyển khoản" sẽ bị dẫn tới QR 0đ.
- Thêm ngoài spec: dòng gợi ý đơn vị ở form sự kiện cộng đồng; câu "điểm quy đổi từ xu cũ" trong FAQ Điểm Xanh; ghi chú "không dùng để đổi mã giảm giá" và nhãn "Điểm không hết hạn" ở trang Điểm Xanh; ánh xạ `XU_CONVERTED` ở thông báo. Lý do: tránh khách hiểu sai phần điểm không hết hạn dùng được ở đâu (spec 7 chỉ nói "hiện tổng + phần không hết hạn").
- Hộp "Điểm còn lại" khi đổi quà vẫn trừ trên lô thường (`pointsBalance`), không trên tổng, vì BE chỉ cho lô thường đổi mã giảm giá.
- API ngoài nhóm L4 (tối thiểu, để `tsc` API xanh): `auth.service.ts`, `auth.service.spec.ts`, `account-deletion.service.ts`.

### Giả định

- Dùng mặc định của spec cho OQ-1..15 (không có OQ nào bị đổi ở lượt này).
- Tên trường FE khớp mã API đã có ở các lượt trước (đã đối chiếu): `rewardPoints` ở mốc CTV, nhiệm vụ gian hàng, sự kiện cộng đồng; `milestoneRewardPoints`; `totalEarnedPoints`; kết quả nhận nhiệm vụ trả `pointsBalance`; danh sách xoá tài khoản trả `pointsConvertedBalance`.
- Loại thưởng Season Pass `XU` trong cấu hình cũ đã được L2 đổi sang `POINTS` (migration khoá `seasonpass`); FE chỉ còn hiểu `SEEDS` và `POINTS`.
- Mô tả "điểm quy đổi không hết hạn" trong FAQ khớp công thức hai lô của spec (không đổi quà, không vòng quay, trả tới 100% giá trị hàng ở thanh toán).

### Việc còn lại cho L5

- `apps/e2e/tests/**`: 4 file còn mock `coinsBalance` (liệt kê ở trên), T20.
- Tạo mẫu tin `XU_CONVERTED` (FE đã ánh xạ), seed, chú thích API còn nhắc "xu".
- Chạy Playwright miniapp và web (lượt này không chạy được: unverified về hành vi trên trình duyệt thật).

### Việc cần chủ dự án

- OQ-1..15: mã dùng mặc định của spec; cần xác nhận (xem các mục "Việc cần chủ dự án" ở trên, đặc biệt OQ-5, OQ-9, OQ-12).
- Câu chữ mới hiện cho khách cần reviewer Opus đọc trước khi merge (quy tắc customer messages):
  - Ví: khối "Mời bạn — nhận Điểm Xanh", mẹo Ví Tubu, dòng điểm quy đổi.
  - Thanh toán: "trong đó N điểm không hết hạn, trả tới 100% giá trị hàng"; "Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm."; "Đơn không còn số tiền cần thanh toán."
  - Vườn Xanh: chú thích dưới nút "Góp quỹ trồng cây (50 điểm)", thông báo "Đã góp 1 cây vào quỹ trồng cây (-50 điểm)". OQ-5: lời này nói rõ có thể dùng điểm không hết hạn (tiền khách đã trả trước).
  - Trang Điểm Xanh: dòng "trong đó N điểm không hết hạn", ghi chú không đổi mã giảm giá.
  - FAQ: hai câu đã đổi. Trên PROD nếu admin đã nhập FAQ riêng (`GET /faqs`), bản dự phòng này không hiện: cần kiểm tay câu "Tôi thanh toán bằng cách nào?" và "Điểm Xanh là gì" trong trang admin.
  - Nhãn đơn/sổ cũ: "Điểm Xanh (xu cũ)", "Xu cũ (đã gộp Điểm Xanh)", "Chuyển từ xu cũ sang Điểm Xanh", "Đổi sang xu cũ (nay là Điểm Xanh)".
- Chưa có ảnh chụp hub Cá nhân, Ví, thanh toán: cần xem bằng mắt trên máy thật hoặc trình mô phỏng trước khi phát hành.

## Lượt L5 — Dọn chữ, seed, mẫu tin, e2e mock, chạy lại T1-T21 (spec mục 9)

Nhánh `hz9/PD-3`. DB test riêng `tubu_it_pd3` cổng 5583. Không chạm PROD, không gọi dịch vụ ngoài, không chạy Playwright (chỉ `playwright test --list`), không chạy dev server.

Trạng thái lượt: **XONG phần mã và kiểm chứng trên Postgres thật**. T20 (e2e) chỉ kiểm được kiểu và việc nạp spec, CHƯA chạy trên trình duyệt: **unverified**.

### Các mục

| Mục (spec mục 9, L5) | Trạng thái | Ghi chú | Commit |
|---|---|---|---|
| Migration UPDATE mẫu tin `CASHBACK_PAID`, `COMMUNITY_BEST_ANSWER` | XONG (làm ở review B1) | `WHERE "bodyTemplate" = <bản seed cũ>`: giữ bản admin đã sửa; chạy lại `UPDATE 0`. Kiểm lại trên DB mẫu ở dưới. | d14ccabc (migration `20261012150000`) |
| Mẫu mới `XU_CONVERTED` + thông báo trong app cho từng khách đã quy đổi (OQ-10) | XONG | Migration `20261012160000_pd3_xu_converted_notice`: `INSERT ... ON CONFLICT DO NOTHING` mẫu; một dòng `notification_logs` cho mỗi user ở `xu_points_conversions` (id cố định `nlog_xu2pts_<userId>` + `NOT EXISTS` theo `(userId, templateCode)`): chạy lại không báo hai lần. Seed có cùng lời (`createOnly`). Race spec 4 ca. | 39732c49 |
| Seed, chú thích API còn nhắc "xu" | XONG | `seed.ts` (mô tả khoá config, mẫu tin) và 12 file API: chỉ đổi chú thích và mô tả, không đổi hành vi. Quét lại bên dưới. | e8c77032 |
| e2e mock `apps/e2e/tests/**` bỏ `coinsBalance`/TubuXu | XONG, UNVERIFIED | 8 file: `checkout-mocks.ts`, `mock-api.ts`, `affiliate-mocks.ts`, `features/mock-api-routing/affiliate-ctv.miniapp.spec.ts` bỏ `coinsBalance`, đổi sang `pointsConvertedBalance`, thưởng CTV sang điểm. | 6451040a |
| T20: checkout dùng điểm quy đổi, đơn 0đ, Ví không còn nút đổi | XONG, UNVERIFIED | `checkout.miniapp.spec.ts` +3 ca (ba phương thức không có xu; gộp hai lô và dòng "trong đó N điểm không hết hạn"; `pointsToUse` = thường + quy đổi; đơn 0đ ẩn chọn phương thức và gửi COD, không gọi `/payments/bank-qr`). `wallet.miniapp.spec.ts` mới 2 ca (không thẻ/nút/mẹo xu, không gọi `/me/coins` và `/wallet/convert-xu`; Điểm Xanh là tổng hai lô; mời bạn đọc `/me/referral`). | 6451040a |
| Chạy lại T1-T21, quét chữ 7.2, truy vấn 3.3 trên DB mẫu, hoàn tác T21 trên DB mẫu | XONG | Bên dưới. | (báo cáo này) |
| Bảng OQ-1..15 và chi phí làm tròn đo trên dữ liệu mẫu | XONG | Bên dưới. | (báo cáo này) |

### Migration (L5)

`20261012160000_pd3_xu_converted_notice` (mới ở L5). Chỉ INSERT, không UPDATE/DELETE dữ liệu cũ, chạy lại được. Cùng với `20261012150000_pd3_review_b1_xu_wording_templates` (UPDATE có điều kiện), đủ yêu cầu "migration UPDATE idempotent mẫu tin" của L5.

Danh sách đủ 7 migration PD-3, theo thứ tự áp: `20261012100000_pd3_points_lot_schema`, `20261012110000_pd3_xu_to_points`, `20261012120000_pd3_points_config_keys`, `20261012130000_pd3_freeze_coins`, `20261012140000_pd3_review_b1_return_templates`, `20261012150000_pd3_review_b1_xu_wording_templates`, `20261012160000_pd3_xu_converted_notice`. Migration A là `CREATE TYPE` thường như mọi migration Prisma (Prisma chỉ áp một lần; chạy tay lần hai báo `type "PointsLot" already exists`). Sáu migration còn lại chạy lại không đổi dữ liệu (kiểm dưới).

### DB mẫu: áp cả chuỗi migration lên dữ liệu có sẵn (truy vấn 3.3)

Cách làm: schema tạm `pd3_l5` trong chính `tubutree_it` (không tạo DB khác; đã `DROP SCHEMA` sau khi xong). `prisma migrate deploy` THẬT: 125 migration trước PD-3 (bản chép ở scratchpad, chỉ đổi `gin_trgm_ops` thành `public.gin_trgm_ops` vì extension nằm ở schema public; file trong repo không đổi), nạp dữ liệu mẫu bằng SQL, rồi deploy 7 migration PD-3 (đã `diff -r` giống hệt file trong repo). Cách này khác schema nháp `LIKE public.*` của race spec ở chỗ chạy ĐÚNG đường `migrate deploy` và đủ 7 migration cùng lúc.

Dữ liệu mẫu (10 user): số dư xu 0 (sổ +500 -500), 1, 999 (sổ 1200 -201), 1000, 1001, 123456, 3000 kèm 50 điểm thường, 5000 do `REFERRAL_ORDER2` trong 30 ngày, 1000 do `CONVERT_FROM_WALLET`, và một user chỉ có 700 điểm thường. Thêm 3 đơn XU còn huỷ/trả được (CONFIRMED 250.000đ, PACKED 123.456đ, DELIVERED 50.000đ) và 1 đơn XU đã huỷ; 2 sự kiện cộng đồng (`rewardXu` 1500 và 0); khoá config cũ (`coins.referrer_reward` ĐÃ SỬA thành 7000, mốc giới thiệu, `game.tree_xu_price`, `seasonpass.tiers` có `XU` 5000 và 12001); mẫu `CASHBACK_PAID` đúng bản seed cũ và `COMMUNITY_BEST_ANSWER` do "admin đã sửa" (còn chữ TubuXu).

Trước migration (truy vấn 3.3 a-e):

```
(a) users_with_xu 8 | total_xu 135457 | total_points 138 | rounding_cost_vnd 2543 | max_points_one_user 124
(b) negative_users 0 | coin_drift_users 0
(c) points_drift_users 0
(d) CONFIRMED/PAID 1 đơn 250000 xu -> 250 điểm | PACKED/PAID 1 đơn 123456 -> 124 | DELIVERED/PAID 1 đơn 50000 -> 50
(e) 1 dòng REFERRAL_ORDER2 trong 30 ngày, tổng 5000 xu
```

`prisma migrate deploy`: `Applying migration` cho đủ 7 thư mục, `All migrations have been successfully applied`.

Sau migration:

```
snapshots 8 | points 138 | rounding_vnd 2543 | xu 135457          (khớp (a) từng con số)
coins_nonzero 0 | conv_drift 0 | std_drift 0 | coin_drift 0 | orders_converted_used 0
l5_u1 1 xu -> 1 điểm (làm tròn 999đ) | l5_u999 -> 1 (1đ) | l5_u1000 -> 1 (0đ) | l5_u1001 -> 2 (999đ)
l5_u123456 -> 124 (544đ) | l5_upts 3000 -> 3, giữ 50 điểm thường | l5_uref 5000 -> 5 | l5_ucv 1000 -> 1
l5_u0 và l5_pstd: không có dòng quy đổi
referral.referrer_reward_points 7        (từ coins.referrer_reward = 7000 do admin sửa: CEIL giữ thiết lập)
referral.milestones_points [{count:3,bonusPoints:20},{count:5,bonusPoints:40},{count:10,bonusPoints:100}]
game.tree_points_price 50
seasonpass.tiers premium XU 5000 -> POINTS 5, XU 12001 -> POINTS 13; phần SEEDS giữ nguyên
community_events: rewardXu 1500 -> rewardPoints 2; 0 -> 0
CASHBACK_PAID        : "Hoàn tiền {{amount}}đ từ mua sắm sàn ngoài đã vào Ví Tubu" (đã đổi, bản seed cũ)
COMMUNITY_BEST_ANSWER: giữ NGUYÊN bản admin đã sửa (còn chữ TubuXu)
XU_CONVERTED         : "{{xu}} xu cũ của bạn đã thành {{points}} Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng."
notification_logs XU_CONVERTED: 8 dòng, mỗi user có xu một dòng, vd "123.456 xu cũ của bạn đã thành 124 Điểm Xanh không hết hạn, ..."
CHECK có mặt: users_coins_frozen, users_points_converted_nonneg, points_transactions_converted_no_expiry
npx tsx scripts/reconcile-points.ts (DRY-RUN, schema mẫu): Lô STANDARD 0 user lệch | Lô CONVERTED 0 user lệch
```

Chạy lại tay 6 migration (trừ A) trên cùng DB mẫu: cả 6 chạy xong không lỗi; ảnh chụp trước/sau giống hệt (băm số dư mọi user, số dòng `points_transactions` 10, `coin_transactions` 19, `xu_points_conversions` 8, băm `system_configs`, băm `notification_templates`, `notification_logs` 8): `IDEMPOTENT: snapshot identical`.

Hoàn tác T21 trên DB mẫu (`prisma/manual/pd3_xu_to_points_rollback.sql`, chạy 2 lần):

```
l5_u1 1 | l5_u999 999 | l5_u1000 1000 | l5_u1001 1001 | l5_u123456 123456 | l5_ucv 1000 | l5_upts 3000 | l5_uref 5000  (đúng coinsBefore)
coin_drift 0 | conv_drift 0 | dòng XU_MIGRATION_ROLLBACK 8 ở mỗi sổ (lần hai không nhân đôi) | tổng xu sau hoàn tác 135457 = tổng trước
```

### Chi phí làm tròn lên (đo trên DỮ LIỆU MẪU, không phải PROD)

| Phép đo | Kết quả trên dữ liệu mẫu | Ghi chú |
|---|---|---|
| Quy đổi số dư xu (3.3 a) | 8 user có xu, 135.457 xu thành 138 điểm = 138.000đ, làm tròn lên 2.543đ, tối đa 999đ/user (user 1 xu và 1.001 xu) | Dữ liệu mẫu cố ý chọn sát cạnh (1, 999, 1001) nên số này CAO hơn thực tế dự kiến. 4 trong 8 user có số dư là bội của 1.000 nên làm tròn 0đ. |
| Hoàn đơn XU cũ nếu huỷ hết (3.3 d) | 3 đơn, 423.456đ hoàn 424 điểm = 424.000đ, thêm 544đ | Chỉ đơn 123.456đ làm tròn (544đ); đơn 250.000đ và 50.000đ tròn. |
| Trần lý thuyết | 999đ x số user có xu, cộng 999đ x số đơn XU còn huỷ/trả được | Số thật cần chạy 3.3 (a), (d) trên BẢN SAO PROD: vẫn là cổng deploy (A1 mục 4, B1 mục 5), xem bảng "Việc cần chủ dự án". |

### Quét chữ (spec 7.2) và grep ghi xu

```
$ rg -n -P "(?i)(tubu ?xu|(?<![\p{L}_])xu(?![\p{L}_]))" apps/miniapp/src apps/web/src -g '!*.spec.*' | grep -v "xu cũ"
apps/web/src/lib/export-csv.ts:38:  XU: 'Xu cũ (đã gộp Điểm Xanh)',
```

Dòng còn lại là khoá enum `XU` của đơn cũ, giá trị là "xu cũ". Miniapp và web không còn chữ nào khác; `coinsBalance`, `formatXu`, `getCoins`, `convertToXu`, `rewardXu` không còn trong miniapp, web, shared-types, e2e (chỉ còn trong hai spec guard T19 làm chuỗi cấm).

```
$ rg -n "grantCoins|spendCoins|coinsBalance" apps/api/src apps/api/prisma/seed.ts -g '!*.spec.ts'
(rỗng)
$ rg -n "'coins\.referrer_reward'|'coins\.referral_milestones'|'community\.post_reward'|... (9 khoá xu cũ)" apps/api/src -g '!*.spec.ts'
chỉ ở apps/api/src/modules/system-config/dead-config-keys.ts
```

Chữ "xu" còn trong mã API (ngoài spec) chỉ là: tên enum `XU`, hàm `legacyXuToPoints`/`refundLegacyXuAsPoints`, chú thích kỹ thuật giải thích đơn vị cũ, mô tả khoá DEAD, và hai lời 410 dành cho client cũ (`POST /wallet/convert-xu`, `GET /me/coins`, mở lô vườn bằng xu): xem "Khác spec".

### Chạy lại T1-T21 (HEAD trước commit báo cáo: e8c77032)

Race: mỗi file một lần, `DATABASE_URL=postgresql://tubu:tubu@localhost:5583/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand <file>`.

| T | Ca kiểm | Lệnh / file | Kết quả thật |
|---|---|---|---|
| T1, T2, T3, T17, T21 (+ CHECK, tràn INTEGER) | Quy đổi, chạy lại, dữ liệu lệch/âm RAISE, khoá xu, hoàn tác | race `pd3-xu-migration` | Tests: 15 passed, 15 total |
| T4 | 20 partial unique index; DB trống chạy hết | race `partial-unique-indexes`; `check-partial-indexes.ts`; `migrate diff --exit-code`; `migrate deploy` 125 migration lên schema trống rồi 7 PD-3 | 5 passed; "mong đợi 20, có trong DB 20"; "No difference detected." (exit 0); deploy thành công |
| T5, T7 | Bất biến hai lô; cron hết hạn không chạm lô quy đổi, không trừ đôi | race `pd3-points-lots`; jest `loyalty-expiry.service.spec` | 6 passed; 19 passed |
| T6 | Checkout song song hai lô, chồng quay/voucher/quỹ cây | race `pd3-checkout-points` | 3 passed |
| T8, T9 | Không trần 20% cho lô quy đổi; thứ tự STANDARD rồi CONVERTED; khoá | jest `pricing.service.spec`; `checkout.service.spec` | 20 passed; 74 passed |
| T10, T11 | Huỷ hoàn đúng lô; đơn XU cũ hoàn `ceil(total/1000)`; huỷ 5 lần song song | race `pd3-order-reversal`; `order-cancel` | 8 passed; 2 passed |
| T12 | Hạng không tính điểm quy đổi | jest `loyalty.service.spec` | 37 passed |
| T13 | Giới thiệu: không thưởng lại, thu hồi đúng lô, song song | race `referral-order2` | 27 passed |
| T14 | Nhiệm vụ, hay nhất, sự kiện: không cấp lại, song song | race `pd3-reward-sources` | 6 passed |
| T15 | Gộp khách có lô quy đổi và QUEST trùng | race `auth-merge-guest` | 11 passed |
| T16 | Chặn lỗi đơn vị (quét khoá, RANGES, `grant` > 2.000, JSON cũ, `XU` Season Pass, `set` 5000) | jest `points-unit-guard.spec` + `dead-config-keys.spec` | 33 passed |
| T18 | 410 convert-xu, `/me/coins`, mở lô XU; checkout XU 400; đơn 0đ COD | jest `wallet.controller.spec` + `game-garden.service.spec` + `checkout.dto.spec` (+ `checkout.service.spec` ở T8) | 45 passed |
| T19 | FE: hub 3 ô, quét chữ xu, checkout không có XU | miniapp vitest 25 file spec đã đổi từ 10c634c6; guard (src/i18n, ds-no-legacy-aliases, hit-target-guard, button-guard); web vitest 5 file | Test Files 25 passed, Tests 476 passed; 8 files, 76 passed; 5 files, 38 passed |
| T20 | e2e mock (xem trên) | `apps/e2e: npx tsc --noEmit`; `npx playwright test --list` 5 file | tsc exit 0; "Total: 15 tests in 5 files". CHƯA chạy trên trình duyệt: **unverified** |

Race và jest khác chạy lại cùng lượt:

```
race: account-deletion 13 | loyalty 5 | wallet-ledger-flows 8 | pd3-points-config-keys 9 | pd3-xu-converted-notice 4   (đều passed, 0 failed)
apps/api: npx jest src/modules/{checkout,pricing,loyalty,wallet,game,orders,system-config,notifications,feed,storefront,affiliate,auth,users,admin} --maxWorkers=1
          Test Suites: 72 passed, 72 total; Tests: 1675 passed, 1675 total
apps/api: npx jest notification-templates-seed.spec --maxWorkers=1   23 passed
apps/api: npx tsc --noEmit -p tsconfig.json     exit 0
apps/e2e: npx tsc --noEmit -p tsconfig.json     exit 0
apps/miniapp: npx tsc --noEmit                  exit 0
apps/web: npx tsc --noEmit                      exit 0
apps/api: npx eslint <15 file .ts đổi từ 1550be1f>   exit 0 (apps/e2e không có ESLint)
apps/api: prisma migrate deploy (tubu_it_pd3)   No pending migrations to apply (132 migration)
apps/api: prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code   No difference detected. (exit 0)
apps/api: npx tsx prisma/check-partial-indexes.ts   Partial unique index: mong đợi 20, có trong DB 20.
```

Không chạy toàn bộ jest/vitest, không chạy Playwright, không chạy dev server (theo lệnh).

### Khác spec (chọn phương án an toàn tiền hơn hoặc dễ hiểu hơn cho khách)

- Spec 7.2 chỉ nói "mẫu tin mới XU_CONVERTED". Migration làm thêm: ghi sẵn một thông báo trong app cho từng khách đã quy đổi (OQ-10 nói "gửi thông báo"). Thông báo là bản ghi `notification_logs` kênh INAPP (không push, không gọi dịch vụ ngoài). Lời tin dựng từ mẫu hiện có trong DB (nếu admin sửa mẫu trước khi chạy thì lời theo bản đã sửa). Số xu có dấu chấm ngăn nghìn.
- Hoàn tác (`pd3_xu_to_points_rollback.sql`) KHÔNG rút thông báo đã ghi: sau hoàn tác khách vẫn thấy "xu cũ của bạn đã thành N Điểm Xanh" dù xu đã trả lại. Chỉ ảnh hưởng chữ; cần xoá tay `notification_logs` mã `XU_CONVERTED` khi hoàn tác.
- Ba lời 410 cho client cũ vẫn nhắc "xu" ("Xu đã gộp vào Điểm Xanh...", "Đổi Ví sang xu đã ngừng...", "Mở lô đất bằng xu đã ngừng..."). Miniapp mới không còn gọi ba route đó, nên khách không thấy; giữ chữ "xu" để client cũ hiểu vì sao bị chặn. Không có "TubuXu" trong ba lời này (spec test kiểm). Nếu chủ dự án muốn tuyệt đối không còn chữ "xu", đổi ba chuỗi (mất khả năng giải thích cho client cũ).
- `COMMUNITY_BEST_ANSWER` mà admin đã sửa trên PROD vẫn giữ nguyên (còn chữ TubuXu nếu admin để lại): migration cố ý không đè. Cần kiểm tay trên PROD (xem bảng dưới).
- Lời báo khi huỷ đơn (`ORDER_CANCELLED`: "Đơn {{order_code}} đã bị hủy.") không nhắc hoàn điểm nên không có gì để tách theo lô; mục "lời báo đã hoàn N Điểm Xanh khi huỷ chưa tách theo lô" ghi ở L3 không còn là việc phải làm. Lời báo khi duyệt trả hàng đã đúng từ review B1.
- Spec L5 nhắc "full jest API". Lệnh điều phối cấm chạy full suite: chạy 72 suite thuộc 14 module PD-3 đụng tới (1.675 ca), không chạy phần còn lại.

### Giả định

- Dùng đúng mặc định của spec cho OQ-1..15; không OQ nào bị đổi ở L5.
- Số liệu "chi phí làm tròn" ở trên là của dữ liệu mẫu tự dựng, chỉ chứng minh công thức và đường migration, không ước lượng số dư thật.
- `playwright test --list` đủ để chứng minh 5 file e2e biên dịch và nạp được; không chứng minh selector đúng với giao diện thật.

### Việc còn lại

- Điều phối viên chạy Playwright miniapp (5 file: `checkout`, `wallet`, `affiliate-ctv`, `features`, `mock-api-routing`) trước khi gộp. Ca mới T20 (3 ca checkout, 2 ca Ví) và ca đã sửa mock CTV chưa từng được chạy.
- Ảnh chụp màn hub Cá nhân, Ví, thanh toán, trang Điểm Xanh, Vườn Xanh (L4 chưa có, L5 không có dev server).
- Cổng deploy đo số thật trên bản sao PROD (bảng dưới).

### Việc cần chủ dự án

Bảng 1. Câu hỏi mở OQ-1..16. Mã đã dùng ĐÚNG đề xuất mặc định của spec (chủ dự án chưa duyệt). Đổi mức nào cũng chỉ là sửa config hoặc hằng số, trừ khi ghi khác.

| Mã | Mặc định đang chạy trong mã | Hệ quả tiền | Đổi thế nào nếu không duyệt |
|---|---|---|---|
| OQ-1 | Thưởng mới (giới thiệu, mốc CTV, cộng đồng, nhiệm vụ, Season Pass) là Điểm Xanh thường: hết hạn theo `loyalty.point_expire_months` (12 tháng), trần 20%/đơn. | Mốc CTV 80 triệu = 2.000 điểm (2 triệu đồng) trước trả được 100% đơn, nay chỉ tới 20%/đơn và hết hạn: CTV nhận giá trị dùng được thấp hơn. | Cấp vào lô quy đổi cần đổi `RewardPointsService.grant` sang lô CONVERTED và chấp nhận chi phí cao hơn cho Tubu. |
| OQ-2 | Điểm (cả lô quy đổi) chỉ trừ vào giá trị hàng, không trừ phí ship; phần lẻ dưới 1.000đ khách tự trả. | Khách có xu trước trả được 100% tổng đơn gồm ship, nay tự trả ship và tối đa 999đ lẻ mỗi đơn. | Cho lô quy đổi trừ cả phí ship: sửa `redeemBase` trong `PricingService.resolvePointsRedemptionByLot`. |
| OQ-3 | Lô quy đổi không dùng cho vòng quay, đổi mã giảm giá catalog, mở lô vườn. | Ngăn biến tiền trả trước thành phần thưởng game; khách ít lối tiêu hơn. | Cho phép: cần sửa guard ở từng nơi (hiện nằm ở việc cột `pointsBalance` chỉ là lô thường). |
| OQ-4 | Bỏ mở lô vườn bằng xu (chỉ còn giọt nước), mở bằng xu trả 410. | Không còn sink xu trong game ngoài góp quỹ. | Mở lô bằng điểm cần giá mới (200 xu = 0,2 điểm không biểu diễn được). |
| OQ-5 | Góp quỹ trồng cây = 50 Điểm Xanh (`game.tree_points_price`), tiêu lô thường trước, thiếu thì lô quy đổi. Giao diện có ghi chú. | Mỗi lượt Tubu cam kết 50.000đ vào quỹ; nguồn có thể là điểm thưởng miễn phí. Khách có thể dùng điểm quy đổi (tiền đã trả trước) vào quỹ. | Chỉ lô thường: bỏ nhánh CONVERTED trong `game.service.ts` (khách ít điểm thường sẽ không góp được). |
| OQ-6 | Cộng đồng: đăng bài 1 điểm (tối đa 1/ngày), trả lời 0, hay nhất 1 điểm (tối đa 3/ngày). Migration chỉ đổi trần ngày khi còn đúng mặc định cũ. | Trần ngày 4.000đ, gần mức cũ 4.100đ (3x200 + 10x100 + 5x500 xu). | Sửa khoá `community.*_reward_points` và `community.daily_*_cap` trong trang admin. |
| OQ-7 | Nhiệm vụ gian hàng 2/2/2/1/5 điểm (1.500 xu làm tròn lên 2). | Tổng 12.000đ/CTV thay vì 11.500đ. | Hằng số trong `storefront-quest.service.ts`. |
| OQ-8 | Đơn XU cũ huỷ/trả hoàn `ceil(total/1000)` điểm lô quy đổi, không về Ví. | Khách lời tối đa 999đ/đơn. Dữ liệu mẫu: 3 đơn 423.456đ hoàn 424 điểm, lời 544đ. | Hoàn về Ví làm xu thành tiền rút được: trái Q-03a. |
| OQ-9 | Thu hồi thưởng giới thiệu đã cấp bằng xu thì trừ lô quy đổi `ceil(xu/1000)`, không âm, thiếu ghi `REFERRAL_DEBT` (delta 0). | Mỗi lần tối đa 5 điểm (thưởng đơn 2) hoặc 100 điểm (mốc 10 người): tối đa 100.000đ/người mời; phần đó đã trộn vào lô quy đổi nên không tách lại. Dòng `REFERRAL_DEBT` chưa có quy trình thu. | Không thu hồi thưởng xu cũ (Tubu chịu): bỏ nhánh `legacy` trong `referral-reward.ts`. |
| OQ-10 | Gửi thông báo trong app cho người có xu về việc quy đổi (mẫu `XU_CONVERTED`, migration `20261012160000`). | Không tốn tiền; giảm khiếu nại. | Bỏ INSERT thứ hai trong migration trước khi deploy nếu không muốn gửi. |
| OQ-11 | `loyalty.vnd_per_point_redeem` khoá cứng 1.000 (RANGES 1000-1000). | Đổi tỉ giá sau gộp làm lô quy đổi (tiền trả trước) mất hoặc tăng giá trị. | Mở khoá RANGES và viết lại công thức `(s, c)`. |
| OQ-12 | "Ví trả một phần đơn" (Q-03 phương án 1) KHÔNG làm; Ví chỉ trả toàn bộ đơn. | Không đổi tiền trong PD-3. | Cần gói riêng sau PD-3. |
| OQ-13 | Migration B dừng deploy (RAISE) nếu sổ xu lệch hoặc số dư âm. | Bảo vệ tiền trả trước; đổi lại có thể trễ deploy. | Chạy 3.3 (b) trên bản sao PROD trước deploy để không bị dừng giữa chừng. |
| OQ-14 | Xoá tài khoản bị chặn khi còn điểm quy đổi > 0 (`CONVERTED_POINTS`). | Khách muốn xoá phải tiêu hết. | Quyết cho bỏ điểm hoặc quy ra tiền (trái Q-03a). |
| OQ-15 | Có sẵn từ trước, KHÔNG đổi: điểm thường hoàn khi huỷ đơn (`ORDER_REFUND_POINTS`) ghi `expiresAt NULL` nên không bao giờ hết hạn. | Rò nhỏ có sẵn. | Ngoài phạm vi PD-3. |
| OQ-16 (thêm ở A1) | Hoàn tác xu bị chặn khi đã có phiên khách gộp hoặc dòng cộng khác vào lô quy đổi; khi đó chỉ sửa tiến. | Hoàn tác tự động có thể trả xu sai chủ hoặc kẹt điểm của khách. | Cần thiết kế riêng nếu muốn có đường hoàn tác cho trường hợp gộp phiên. |

Bảng 2. Việc làm tay trước và sau deploy.

| Việc | Ai | Trạng thái |
|---|---|---|
| `pg_dump` PROD; chạy truy vấn 3.3 (a)-(e) trên BẢN SAO PROD; ghi số vào bảng dưới. Nếu (b) khác 0 phải đối soát tay trước (migration B sẽ dừng). | Điều phối viên / chủ dự án | Chưa làm (cấm đụng PROD ở lượt này) |
| Chạy Playwright miniapp 5 file e2e đã sửa; xem ảnh hub Cá nhân, Ví, thanh toán, trang Điểm Xanh, Vườn Xanh | Điều phối viên | Chưa làm |
| Reviewer Opus đọc lời báo khách mới/đổi trước khi merge (quy tắc "customer messages"): `XU_CONVERTED`, `RETURN_APPROVED_POINTS`, `RETURN_APPROVED_WALLET_POINTS`, `CASHBACK_PAID`, `COMMUNITY_BEST_ANSWER`, cùng các câu mới trong Ví, thanh toán, Vườn Xanh, trang Điểm Xanh, FAQ (liệt kê ở mục "Việc cần chủ dự án" của L4) | Chủ dự án / reviewer | Chưa làm |
| Trên PROD kiểm tay các mẫu tin admin đã sửa (`COMMUNITY_BEST_ANSWER`, `CASHBACK_PAID`, `RETURN_APPROVED*`) và FAQ riêng (`GET /faqs`: "Tôi thanh toán bằng cách nào?", "Điểm Xanh là gì"): migration không đè bản admin đã sửa, nên còn chữ TubuXu thì phải sửa tay | Chủ dự án | Chưa làm |
| Deploy MỘT LẦN cả nhánh: BE (migrate A, config, B, C) cùng web và miniapp; không deploy API L3 mà thiếu FE L4 | Điều phối viên | Chưa làm |
| Sau deploy: chạy lại truy vấn "sau migration B" (spec 3.3), đối chiếu `sum("pointsGranted")`, `sum("roundingVnd")`, `sum("coinsBefore")` với kết quả (a) | Điều phối viên | Chưa làm |
| Quyết xử lý dòng `REFERRAL_DEBT` (bỏ qua hay trừ vào lần thưởng sau) và phần STANDARD hoàn sau commit (B1 mục 1, "Giới hạn") | Chủ dự án | Chưa quyết |
| Trần cứng `POINTS_GRANT_HARD_MAX` 2.000: nâng mốc CTV thì nâng cùng lúc | Chủ dự án | Ghi nhận |

Bảng 3. Chi phí làm tròn lên: ô đo trên bản sao PROD (cổng deploy).

| Truy vấn | Dữ liệu mẫu (L5, không phải PROD) | Kết quả trên bản sao PROD | Ngày / người chạy |
|---|---|---|---|
| 3.3 (a) users_with_xu / total_xu / total_points / rounding_cost_vnd / max_points_one_user | 8 / 135.457 / 138 / 2.543đ / 124 | (chưa đo) | |
| 3.3 (b) negative_users / coin_drift_users | 0 / 0 | (chưa đo) | |
| 3.3 (c) points_drift_users | 0 | (chưa đo) | |
| 3.3 (d) đơn XU còn huỷ/trả được: số đơn / tổng xu / điểm hoàn nếu huỷ hết | 3 / 423.456 / 424 (lời 544đ) | (chưa đo) | |
| 3.3 (e) thưởng giới thiệu xu còn thu hồi được (30 ngày): số dòng / tổng xu | 1 / 5.000 | (chưa đo) | |

## Review C1 (reviewer độc lập, lượt 1 trên nhánh L1-L5)

Trạng thái: **MỘT PHẦN**. Sáu finding: 1 major đúng và đã sửa (web), 1 major đúng về nội dung nhưng KHÔNG làm trong lượt này (Ví trả một phần đơn: cần chủ dự án quyết, xem mục 2), 3 minor đã sửa, 1 minor giữ làm cổng deploy. Mỗi sửa một commit `address review C1`; test đỏ thấy trước khi sửa, output thật bên dưới.

| # | Mức | Finding | Kết luận | Commit |
| --- | --- | --- | --- | --- |
| 1 | major | Web thanh toán và tài khoản không biết lô quy đổi: khách chỉ có điểm quy đổi không thấy ô dùng điểm, /tai-khoan hiện thiếu | ĐÚNG, đã sửa | 675b5a17 |
| 2 | major | Q-03 phương án 1 gồm "Ví trả một phần đơn", mã vẫn để Ví trả toàn bộ, spec đẩy sang OQ-12 không có chủ duyệt | ĐÚNG về nội dung (xem dưới), KHÔNG làm; ghi chờ quyết định vào ROADMAP mục 9 | (ROADMAP + báo cáo này) |
| 3 | minor | `buyTree` tiêu STANDARD không trừ `lockedOrderPoints`; bấm đôi trừ 2 lần | MỘT PHẦN: phần khoá đã sửa; bấm đôi không sửa ở BE (xem dưới) | be6ec84a |
| 4 | minor | Chi phí làm tròn trên số dư thật chưa đo | KHÔNG sửa được ở đây (cấm PROD); giữ làm cổng deploy | báo cáo này |
| 5 | minor | `GET /me` chỉ trả `pointsBalance` | ĐÚNG, đã sửa | 1d95cb70 |
| 6 | minor | Thông báo `XU_CONVERTED` định dạng xu có dấu chấm nhưng điểm không | ĐÚNG, đã sửa | 3b75d12d |

### 1. Web khách không biết lô quy đổi (major)

Xác minh bằng mã: `checkout-points.ts` chỉ đọc `pointsBalance`/`redeemablePoints` (lô thường) nên `usable` không bao giờ vượt phần thường dùng được; khách chỉ có điểm quy đổi có `usable = 0` và ô "Dùng … Điểm Xanh" (`usablePoints > 0`) không hiện. `tai-khoan/page.tsx` in `user.pointsBalance`, trong khi Mini App hiện tổng hai lô. `WebUser` và `CheckoutQuote` không có field lô quy đổi dù API đã trả (`AuthUser.pointsConvertedBalance`, `quote.pointsConvertedBalance`/`redeemableConvertedPoints`). Web là kênh chạy thật trên PROD nên đây là lỗi thật, và sai đúng chỗ Q-03a hứa (lô quy đổi trả tới 100% giá trị hàng).

Test đỏ trước khi sửa (`checkout-points.spec.ts`, vitest, thêm 11 ca mới):

```
 ❯ src/lib/checkout-points.spec.ts (16 tests | 10 failed)
   × checkoutPointsOffer với điểm quy đổi (PD-3) > chỉ có điểm quy đổi → dùng được toàn bộ, kèm ghi chú không hết hạn
   × ... > cộng lô thường dùng được với lô quy đổi; điểm thường đang khoá không tính vào usable
   × ... > API trả pointsConvertedBalance mà chưa trả redeemableConvertedPoints → vẫn dùng số dư lô quy đổi
   × ... > API cũ chưa có điểm quy đổi → hành vi cũ, không ghi chú
   × pointsSummary (tài khoản web) > ... (3 ca)
   × zeroTotalNote > ... (3 ca)
 Tests  10 failed | 6 passed (16)
```

Sửa (web, cùng cách làm với Mini App `checkoutPoints`/`pointsSummary`/`zeroTotalNote`):
- `lib/checkout-points.ts`: `checkoutPointsOffer` cộng `redeemableConvertedPoints` (hoặc `pointsConvertedBalance` nếu API chỉ trả số dư) vào `usable`, trả thêm `convertedNote` "trong đó N điểm không hết hạn, trả tới 100% giá trị hàng". Điểm thường vẫn chỉ tính phần dùng được (không gồm điểm đang khoá). Số âm/NaN ở lô quy đổi thành 0. Thêm `pointsSummary` (tổng hai lô + ghi chú) và `zeroTotalNote`.
- `thanh-toan/page.tsx`: ô "Dùng N Điểm Xanh" hiện cả khi chỉ có điểm quy đổi, thêm dòng ghi chú; đơn tổng 0đ ẩn chọn phương thức, hiện "Đơn đã được trả đủ bằng Điểm Xanh…" và gửi `paymentMethod: 'COD'` (BE đã ép COD, FE nói đúng điều BE làm); `RecyclingCheckoutSection` nhận phương thức hiệu lực.
- `tai-khoan/page.tsx`: "Điểm Xanh" = tổng hai lô, kèm dòng "trong đó N điểm không hết hạn".
- Kiểu: `WebUser.pointsConvertedBalance?`, `CheckoutQuote.{pointsUsedConverted,pointsConvertedBalance,redeemableConvertedPoints}?` (optional để phiên/API cũ vẫn chạy).

Xanh: `vitest run checkout-points.spec.ts no-xu-copy.spec.ts order-view.spec.ts`: `Test Files 3 passed (3), Tests 26 passed (26)`. `tsc --noEmit` và ESLint file đã sửa sạch. Năm ca cũ của `checkoutPointsOffer` phải thêm `convertedNote: null` vì đổi hình dạng kết quả (không đổi hành vi).

Không kiểm được trên trình duyệt (không chạy dev server/Playwright): giao diện trang thanh toán web với điểm quy đổi và đơn 0đ là **unverified**; kiểm bằng logic thuần + tsc + eslint. Admin web `pos-screen.tsx` và `admin/page.tsx` còn in `pointsBalance` (lô thường) cho thành viên: ngoài phạm vi finding, không đổi, nêu để biết.

### 2. "Ví trả một phần đơn" (major) — KHÔNG làm, cần chủ dự án quyết

Xác minh: reviewer ĐÚNG hai điều. (a) `findings-catalog.md` mục Q-03, phương án 1 (khuyến nghị) ghi nguyên văn "Gộp xu thưởng vào Điểm Xanh, bỏ đổi Ví -> Xu, cho Ví trả một phần đơn". (b) Mã vẫn để Ví chỉ trả toàn bộ: `checkout.service.ts` `paymentMethod === 'WALLET' && user.walletBalance < computed.total` ném 400, miniapp `shouldFallbackToCod`/`walletUnavailableReason` khoá lựa chọn Ví khi thiếu số dư.

Chỗ chưa đủ để coi là "đã quyết": ROADMAP mục 9 ghi Q-03 là "**Gộp ngay trong đợt này**" (không nêu riêng phần Ví trả một phần), Q-03a chỉ nói về số dư xu. Spec đẩy sang OQ-12, và chỉ thị của lượt dùng đề xuất mặc định của spec cho OQ. Không có chỗ nào chủ dự án nói "hoãn" hay "làm ngay". Reviewer đưa hai lối: làm, hoặc ghi hoãn có chủ duyệt vào ROADMAP trước khi gộp. Tôi KHÔNG tự ghi "chủ dự án đã hoãn" vì chưa ai nói vậy.

Vì sao không làm trong lượt sửa review (chọn phương án an toàn tiền): đây là một tính năng thanh toán mới, không phải sửa lỗi. Bằng chứng từ mã về độ rộng, mọi nơi đang coi một đơn là "trả đủ hoặc chưa trả gì":
- QR chuyển khoản dựng `amount: order.total` (`bank-transfer.service.ts:60,64,68`); ZaloPay `amount: order.total` (`zalopay.service.ts:70-99`); khách trả phần còn lại phải bằng `total − phần Ví`.
- `pending-payment-expiry.cron.ts` tự huỷ đơn `PENDING_PAYMENT` quá 24 giờ: nếu Ví đã trừ ngay lúc đặt thì cron phải hoàn đúng phần Ví, hiện chỉ biết hoàn theo phương thức.
- `order-reversal.service.ts` (hoàn khi huỷ/trả) và `order-transition.ts` (`PREPAID_METHODS`: WALLET là trả trước) đều quyết theo `paymentMethod`, không có "đã trả một phần".
- Gửi Pancake, hạch toán COD (`isCodCollected`), `dealer.service.ts` (23 chỗ), `subscriptions.service.ts` (21 chỗ), `admin.service.ts` (14 chỗ), `order-status.service.ts` đều đọc `paymentMethod`/`paymentStatus` (khoảng 20 file).
- Cần cột/migration mới (số tiền Ví đã trừ trên đơn), trừ Ví có guard cùng tx, hoàn đúng phần ở `reverseFinancials` mọi đường huỷ/trả, race spec cho từng đường, và đổi màn thanh toán miniapp + web.

Ép làm gọn trong một lượt sửa review sẽ chạm tiền thật ở nhiều đường mà không có thiết kế được duyệt: rủi ro cao hơn lợi ích.

Việc đã làm: thêm một dòng vào `docs/2026-10-review/00-ROADMAP.md` mục 9 ("Điều chỉnh roadmap sau Cổng 1") ghi rõ PD-3 chưa làm phần này, KHÔNG phải quyết định của chủ dự án, và cần chủ dự án chọn: hoãn sang gói riêng sau PD-3 (đề xuất, kèm thiết kế: cột số tiền Ví trên đơn, QR/COD theo phần còn lại, hoàn đúng phần ở mọi đường huỷ) hoặc giao làm ngay trước khi gộp. Đây là file ngoài nhóm file của lượt, sửa tối thiểu một dòng, lý do là reviewer yêu cầu ghi để việc không bị bỏ sót; nếu điều phối viên xử lý ROADMAP ở nơi khác thì bỏ dòng này khi gộp.

Trạng thái finding: **CHƯA đóng**. Cần quyết định của chủ dự án trước khi gộp (xem "Việc cần chủ dự án").

### 3. `buyTree` tiêu điểm thường đang khoá (minor, một phần)

Xác minh bằng mã: `buyTree` đọc `pointsBalance` rồi trừ `min(giá, pointsBalance)` mà không trừ `lockedOrderPoints`, khác checkout và `redeemReward`. Kịch bản của reviewer có thật: nhận điểm đơn A (đang trong hạn đổi/trả) → góp quỹ bằng chính điểm đó → trả đơn A → `reverseOrderPoints` trừ không guard, `pointsBalance` âm (không có CHECK trên cột này). Điểm quay thưởng cũng yếu như vậy từ trước PD-3 (`spin` không đọc khoá): ngoài phạm vi gói này, KHÔNG sửa, nêu để biết.

Test đỏ trước khi sửa (`pd3-tree-lock.race-spec.ts`, Postgres thật, tạo đơn DELIVERED 2 ngày trước kèm dòng `ORDER_DELIVERED`):

```
Tests: 4 failed, 4 total
 - chỉ có điểm thường đang khoá (60) → góp 50 bị từ chối: "Received promise resolved instead of rejected"
 - 40 khoá + 30 tự do + 100 quy đổi: pointsUsedConverted Expected 20, Received 0
 - 4 lượt góp song song (100 tự do + 60 khoá): Expected length 2, Received length 3
```

Sửa (`game.service.ts`): sau `FOR UPDATE` dòng user, đọc `loyalty.lockedOrderPoints(userId, now, tx)`; phần thường = `min(giá, max(0, pointsBalance − locked))`, phần còn lại lấy từ lô quy đổi; thiếu thì 400 kèm lý do khoá (`lockedPointsMessage`). `LoyaltyService` (module toàn cục) thêm vào constructor dạng `@Optional()` như các dịch vụ khác của `GameService` để 40 chỗ test dựng ít tham số không vỡ, NHƯNG `buyTree` ném lỗi lập trình nếu thiếu (không âm thầm bỏ qua khoá trên đường tiền).

Xanh: race `pd3-tree-lock Tests: 4 passed`; `pd3-checkout-points Tests: 3 passed` (T6 góp quỹ ×6 vẫn đúng 4 lượt); `game-spin-limit Tests: 2 passed`; `jest src/modules/game src/modules/users`: `Test Suites: 12 passed, Tests: 224 passed`. Unit `game.service.spec.ts` thêm 3 ca (khoá + chia lô, toàn bộ khoá không quy đổi → 400 có lý do, thiếu LoyaltyService → ném lỗi). Ghi thật: ba ca unit viết sau khi sửa, đỏ/xanh chỉ có ở race spec.

KHÔNG sửa, bấm đôi (Idempotency-Key): nút "Góp quỹ trồng cây" của Mini App đã `disabled={buyPending}` và `loading` (component `Button` chặn bấm lặp khi `loading`), nên bấm đôi cùng một lần mở màn không gửi hai request. Chống trùng ở BE cần lưu khoá (bảng hoặc cột mới) và đổi client: lớn hơn một finding minor và chưa có chỗ lưu. Hai request song song hợp lệ vẫn là hai lần góp có chủ ý, mỗi lần trừ đúng một giá 50 điểm và guard không bao giờ cho âm. Có thể thêm bước xác nhận "Góp 50 Điểm Xanh?" ở Mini App nếu chủ dự án muốn (đổi giao diện, xem "Việc cần chủ dự án").

### 4. Chi phí làm tròn trên số dư thật (minor, cổng deploy)

Reviewer đúng: chỉ có số của dữ liệu mẫu (2.543đ cho 8 user ở L5; 7 user ở bản nháp spec) và DB local có 0 user có xu; số thật chỉ lấy được từ bản sao PROD. Cấm đụng PROD nên KHÔNG làm ở đây. Giữ làm cổng deploy: điều phối viên chạy truy vấn 3.3 (a) và (d) trên bản sao PROD và điền vào Bảng 3 của L5 (ô "Kết quả trên bản sao PROD") trước khi deploy. Trần lý thuyết 999đ × số user có xu + 999đ × số đơn XU còn huỷ/trả được. Không sửa SPEC (spec là luật); số đo ghi ở Bảng 3.

### 5. `GET /me` thiếu lô quy đổi (minor)

Xác minh: `users.service.ts` `serialize` chỉ trả `pointsBalance`, trong khi `AuthUser` và `/loyalty/me` trả cả hai lô; client nào đọc điểm từ `/me` sẽ thiếu phần quy đổi. Đúng.

Test đỏ (`users.service.spec.ts`): `Tests: 2 failed, 28 passed, 30 total` (thiếu `pointsConvertedBalance`, `pointsTotal`). Sửa: `serialize` trả thêm `pointsConvertedBalance` và `pointsTotal = pointsBalance + pointsConvertedBalance` (cùng cho `getMe`, `updateMe`, `completeOnboarding`). Thêm field, không đổi field cũ. Xanh: `jest src/modules/users`: `Tests: 33 passed`.

### 6. Thông báo `XU_CONVERTED` định dạng điểm (minor)

Xác minh: migration `20261012160000_pd3_xu_converted_notice` định dạng `{{xu}}` bằng `to_char` + `replace` (dấu chấm) nhưng `{{points}}` bằng `pointsGranted::text`: user có ≥ 1.000 điểm nhận "2.147.483.000 xu … 2147483 Điểm Xanh". Đúng, chỉ là cosmetic.

Test đỏ (`pd3-xu-converted-notice.race-spec.ts`, thêm user 2.147.483.000 xu → 2.147.483 điểm): `Tests: 1 failed, 3 passed, 4 total`. Sửa: cả `body` và `data.points` dùng cùng biểu thức `replace(to_char(…,'FM999,999,999,999'), ',', '.')`. Xanh: `Tests: 4 passed, 4 total`.

Lưu ý checksum: file migration này đã được sửa tại chỗ. Nhánh chưa gộp và chưa deploy lên PROD nên không có DB nào cần giữ checksum cũ; `prisma migrate deploy` không kiểm checksum (chạy lại trên `tubu_it_pd3`: `No pending migrations to apply`), nhưng `prisma migrate dev` trên một DB đã áp bản cũ sẽ báo "đã sửa sau khi áp". Nếu máy nào đã áp bản cũ bằng `migrate dev`, dùng DB mới hoặc `migrate reset`.

### Kiểm chứng cuối lượt

```
web:  vitest run checkout-points no-xu-copy order-view        -> Test Files 3 passed, Tests 26 passed
api:  jest src/modules/game src/modules/users --maxWorkers=1  -> Test Suites 12 passed, Tests 224 passed
race: pd3-tree-lock 4/4 | pd3-xu-converted-notice 4/4 | pd3-checkout-points 3/3 | game-spin-limit 2/2
tsc --noEmit (api, web) sạch; ESLint file đã sửa sạch
prisma migrate deploy: No pending migrations to apply | migrate diff --exit-code: No difference detected
check-partial-indexes: mong đợi 20, có trong DB 20
```

Không chạy full suite, Playwright, dev server (theo chỉ thị). Migration: không thêm migration mới; chỉ sửa tại chỗ `20261012160000_pd3_xu_converted_notice` (mục 6).

### Khác spec

- Spec 2.4 ghi góp quỹ cây "STANDARD trước, thiếu thì CONVERTED"; nay "STANDARD dùng được (trừ phần khoá) trước". Cùng luật checkout và đổi voucher (spec 2.3 đã dùng `lockedOrderPoints` cho checkout). Chọn phương án an toàn tiền.

### Việc cần chủ dự án (thêm từ Review C1)

- **Ví trả một phần đơn (OQ-12, major #2): quyết hoãn sang gói riêng sau PD-3 hay làm ngay trước khi gộp.** Cổng 1 chưa nêu riêng phần này; Q-03 phương án 1 có nó. Hoãn thì xác nhận bằng văn bản và đổi dòng trong ROADMAP mục 9 thành quyết định.
- Tuỳ chọn: thêm bước xác nhận "Góp 50 Điểm Xanh vào quỹ trồng cây?" ở Mini App (đổi giao diện, vì 50 điểm = 50.000đ và có thể lấy từ lô quy đổi).
- Cổng deploy: điền Bảng 3 (L5) bằng số thật từ bản sao PROD (finding #4).
- Quay thưởng không đọc điểm khoá (có từ trước PD-3, cùng loại với finding #3): muốn đóng thì một gói nhỏ riêng.
- Chạy và xem trang thanh toán + tài khoản web bằng mắt (đổi ở finding #1, chưa thấy trên trình duyệt).
