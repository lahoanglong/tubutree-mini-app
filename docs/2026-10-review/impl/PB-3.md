# PB-3 — Sổ cái Ví Tubu (C-060 / A2-004, Q-04)

Nhánh `hz4/PB-3` (từ `hardening/2026-10` @ `5598f9b`).

## Lượt 1/3 — Yêu cầu 1: bảng sổ cái + số dư đầu kỳ + `WalletLedgerService.applyDelta`

Trạng thái: **XONG** (phần hạ tầng). Các chỗ ghi `walletBalance` hiện có CHƯA chuyển sang dùng
service (việc của lượt 2), nên C-060 nói chung mới **MỘT PHẦN**.

### Thay đổi
- `apps/api/prisma/schema.prisma`: enum `WalletTxType` (OPENING, ORDER_PAY, ORDER_REFUND,
  COMMISSION_PAYOUT, CASHBACK, WITHDRAW, WITHDRAW_REFUND, XU_CONVERT, MERGE_IN, MERGE_OUT, ADJUST)
  + model `WalletTransaction` (`wallet_transactions`: id, userId, delta Int có dấu, balanceAfter,
  type, refType, refId, reason, createdAt), `@@unique([userId, type, refId])`,
  `@@index([userId, createdAt])`.
- Migration `20261010041004_wallet_ledger` (additive): tạo enum + bảng + index + FK, rồi
  `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE` và chèn 1 dòng `OPENING` (refId `'OPENING'`,
  id `wtx_open_<userId>`, reason "Số dư đầu kỳ") cho mọi user có `walletBalance <> 0` (kể cả âm,
  để tổng sổ khớp số dư ngay sau migrate).
- `apps/api/src/modules/wallet/wallet-ledger.service.ts`: `WalletLedgerService.applyDelta(tx, {userId, delta, type, refType?, refId?, reason?})`
  1. delta phải là số nguyên an toàn khác 0;
  2. `SELECT "walletBalance" FROM users WHERE id=$1 FOR UPDATE` — mọi lần ghi sổ của cùng user
     tuần tự hoá qua khoá này;
  3. có refId → tra `(userId, type, refId)`; đã có → trả `{applied:false}`, không đổi số dư
     (không để P2002 làm abort tx của caller, xem C-061);
  4. lệnh trừ làm âm → `BadRequestException('Số dư ví không đủ.')`; lệnh cộng vẫn cho vào ví âm;
  5. `user.update increment` + `walletTransaction.create` với `balanceAfter` — cùng tx của caller.
  Service không có phụ thuộc DI để module nào cũng khai báo provider được (tránh vòng import);
  đã export qua `WalletModule`.

### Test (đỏ → xanh)
- Unit `src/modules/wallet/wallet-ledger.service.spec.ts` (11 case): đỏ trước khi có service
  (`Cannot find module './wallet-ledger.service'`), xanh sau khi viết.
- Race `test/integration-race/wallet-ledger.race-spec.ts` (Postgres thật `tubu_it_pb3:5553`), 4 case:
  20 lệnh trừ song song vượt số dư; 10 lần cùng (type, refId) song song; rút + hoàn rút + cashback
  + trả đơn xen kẽ (mỗi lệnh gửi 2 lần) kiểm số dư == tổng sổ, không âm, mỗi khoá 1 dòng, chuỗi
  balanceAfter liền mạch; rollback khi tx caller lỗi.
  Chứng minh khoá là cần thiết: bỏ `FOR UPDATE` tạm thời → 3/4 case ĐỎ (20/20 lệnh trừ cùng
  thành công, balanceAfter xuống -45000); trả lại → 4/4 xanh.

### Lệnh kiểm chứng (output thật)
```
$ npx jest --maxWorkers=1 src/modules/wallet/
Test Suites: 3 passed, 3 total
Tests:       51 passed, 51 total

$ DATABASE_URL=postgresql://tubu:tubu@localhost:5553/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand wallet-ledger
  √ 20 lệnh trừ song song vượt số dư → đúng 10 thành công, số dư về 0, không âm, sổ khớp
  √ cùng (type, refId) gọi song song 10 lần → cộng đúng 1 lần, 1 dòng sổ, không ai lỗi
  √ rút tiền + hoàn tiền + cộng hoa hồng/cashback xen kẽ song song → số dư == tổng sổ, chuỗi liền mạch
  √ tx của caller lỗi sau applyDelta → số dư và sổ cùng rollback
Tests:       4 passed, 4 total

$ npx prisma migrate deploy   # trên tubutree_it, có 1 user walletBalance=-500 dựng sẵn
All migrations have been successfully applied.
-- sau migrate: wallet_transactions 1 dòng, sum(delta)=-500; số user lệch sổ = 0

$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ npx eslint <các file đã sửa>        → không lỗi
```

### Migration
- `apps/api/prisma/migrations/20261010041004_wallet_ledger` — additive, không unique trên dữ liệu
  cũ (bảng mới), backfill rõ ràng bằng `INSERT ... SELECT`.

### Giả định
- Dùng Prisma enum cho `type` (an toàn kiểu); thêm loại mới sau này cần migration
  `ALTER TYPE ... ADD VALUE`. Đã khai sẵn MERGE_IN/MERGE_OUT cho gộp tài khoản khách.
- Trùng `(userId, type, refId)` được coi là idempotent (trả `applied:false`), không ném lỗi —
  phương án an toàn tiền (không cộng/trừ hai lần) và không làm hỏng tx của caller.
- Không chặn lệnh cộng khi số dư đang âm (dữ liệu cũ) để ví tiến về 0; chỉ chặn lệnh trừ.
- Migration và code mới phải lên CÙNG đợt deploy: biến động do code cũ ghi sau backfill sẽ không có
  dòng sổ và reconcile sẽ báo lệch.

### Việc còn lại (lượt sau)
- Chuyển 8 chỗ ghi tay sang `applyDelta`: affiliate (payout→ví, hoàn lệnh rút bị từ chối),
  cashback settle, checkout trả bằng ví, order-reversal (2 chỗ hoàn ví), wallet (đổi xu, rút),
  auth mergeGuestInto (MERGE_OUT/MERGE_IN).
- API sao kê `GET /me/wallet/transactions` + màn miniapp; script reconcile ví; race spec cho các
  luồng nghiệp vụ.

## Lượt 2/3 — Yêu cầu 2: mọi chỗ ghi số dư ví đi qua `applyWalletDelta` trong cùng transaction

Trạng thái: **XONG**. Không còn chỗ nào ngoài `wallet-ledger.service.ts` ghi `users.walletBalance`.

### Bảng các chỗ thay đổi số dư ví (grep `walletBalance` + `increment/decrement/update` trong `apps/api/src`)
| # | File:dòng | Luồng | delta | type | refType / refId | Commit |
|---|---|---|---|---|---|---|
| 1 | `wallet/wallet.service.ts:93` | Đổi Ví → xu | −amountVnd | XU_CONVERT | CONVERT / Idempotency-Key | fe6ff3e |
| 2 | `wallet/wallet.service.ts:190` | Rút ví về ngân hàng (gross = amount + phí) | −amount | WITHDRAW | PAYOUT / payout.id | fe6ff3e |
| 3 | `affiliate/affiliate.service.ts:655` | CTV rút hoa hồng về Ví (WALLET_BALANCE) | +credited | COMMISSION_PAYOUT | PAYOUT / payout.id | 7999a23 |
| 4 | `affiliate/affiliate.service.ts:1079` | Admin từ chối lệnh rút ví → hoàn gross | +(amount+fee) | WITHDRAW_REFUND | PAYOUT / payout.id | 7999a23 |
| 5 | `cashback/cashback.service.ts:326` | Cron settle cashback | +userReward | CASHBACK | CASHBACK / cashbackTx.id | 9fa2f31 |
| 6 | `checkout/checkout.service.ts:325` | Trả đơn bằng Ví | −total | ORDER_PAY | ORDER / order.id | c79c58e |
| 7 | `orders/order-reversal.service.ts:211` (`refundToWallet`, gọi từ `reverseFinancials` và `refundEndCustomer`) | Huỷ/trả đơn hoàn về ví người đặt hoặc ví khách cuối (đơn CTV lên hộ, PA-1) | +total | ORDER_REFUND | ORDER / order.id | c79c58e |
| 8 | `auth/auth.service.ts:420/428` (`mergeGuestInto`) | Gộp phiên khách: chuyển ví | −bal (khách) / +bal (đích) | MERGE_OUT / MERGE_IN | USER / id bên kia | dd19325 |

Đã kiểm, KHÔNG có ghi ví: `dealer` (công nợ đại lý là sổ riêng), `admin` (chỉ đọc `walletBalance`
ở danh sách user, không có màn điều chỉnh ví), `users` (chỉ đọc), `coins`/referral-reward (xu, ngoài
phạm vi). Kiểm `checkout.service.ts:185` chỉ là kiểm tra sớm cho thông báo lỗi; chặn thật là điều
kiện trong `applyWalletDelta`.

### Sửa thêm trong lượt: mức khoá dòng user
`applyWalletDelta` khoá `SELECT ... FOR UPDATE` gây **deadlock 40P01** ở `dealer-bonus.race-spec`
(hoàn 2 đơn cùng đại lý song song): tx khác giữ KEY SHARE trên dòng `users` do INSERT có FK tới
user (đơn, sổ thưởng đại lý), `FOR UPDATE` xung đột với KEY SHARE. Đổi sang `FOR NO KEY UPDATE`
(đúng mức khoá của một `UPDATE walletBalance` thường) — vẫn tuần tự hoá các lần ghi sổ cùng user.
Commit `909e58c`. Đỏ → xanh: tạm đổi lại `FOR UPDATE` → `dealer-bonus` FAIL
(`Code: 40P01 ... deadlock detected`), trả lại → PASS.

### Test thêm (đỏ → xanh)
- `test/integration-race/wallet-ledger-flows.race-spec.ts` (Postgres thật, 8 case qua service
  nghiệp vụ thật): rút + đổi xu song song vượt số dư; đổi xu cùng key ×5; admin từ chối lệnh rút ×2;
  CTV rút hoa hồng về ví ×4; cron cashback chồng ×2; 2 đơn trả ví chỉ đủ tiền 1 + huỷ ×2; hoàn đơn
  CTV lên hộ về ví khách cuối; gộp phiên khách có ví. Mỗi case kiểm số dư == tổng sổ, không âm, mỗi
  khoá đúng 1 dòng. Đỏ trước khi chuyển từng luồng (không có dòng sổ), xanh sau commit tương ứng.
- Unit spec của wallet/affiliate/cashback/checkout/order-reversal/auth cập nhật mock
  (`$queryRaw`, `walletTransaction`).

### Lệnh kiểm chứng (output thật, lượt 2)
```
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5553/tubutree_it?schema=public npx jest \
  -c test/integration-race/jest.config.js --runInBand "wallet-ledger|dealer-bonus|order-cancel|cod-return-refund|ctv-assisted-refund|auth-merge-guest|affiliate.race|admin-confirm-payment|pending-payment-expiry|referral-order2"
PASS test/integration-race/wallet-ledger-flows.race-spec.ts
PASS test/integration-race/wallet-ledger.race-spec.ts
PASS test/integration-race/dealer-bonus.race-spec.ts
... (11 suite)
Test Suites: 11 passed, 11 total
Tests:       75 passed, 75 total

$ npx jest --maxWorkers=1 src/modules/wallet src/modules/affiliate src/modules/cashback \
    src/modules/checkout src/modules/orders/order-reversal src/modules/auth/auth.service
Test Suites: 14 passed, 14 total
Tests:       343 passed, 343 total

$ npx tsc --noEmit -p tsconfig.json   → exit 0
$ npx eslint src/modules/wallet/wallet-ledger.service.ts → exit 0
```

### Giả định (lượt 2)
- Gộp phiên khách chỉ chuyển ví khi số dư khách > 0; ví khách âm (dữ liệu cũ) giữ nguyên ở khách.
- Rút ví ghi WITHDRAW theo gross (amount + phí) vì đó là số thật bị trừ; hoàn khi từ chối trả đúng gross.

### Việc còn lại (lượt 3)
- API sao kê `GET /me/wallet/transactions` + màn miniapp; script reconcile ví (sum sổ vs số dư).

## Lượt 3/3 — Yêu cầu 3, 4, 5: sao kê, đối soát, race song song + tổng kết

Trạng thái lượt: **XONG**. Trạng thái **C-060: XONG** (cả 5 yêu cầu của gói).

### Thay đổi
- **Sao kê (yêu cầu 3)** — trước đó chưa có endpoint nào đọc lịch sử ví (chỉ có `me/points/transactions`,
  `cashback/transactions`), nên thêm mới:
  - `GET /me/wallet/transactions?page=&limit=` (`wallet.controller.ts`, dùng `PaginationQuery` chung,
    limit ≤ 100) → `WalletService.getTransactions`: chỉ sổ của chính user, mới nhất trước
    (`createdAt desc, id desc`), trả `{ data, meta: { page, limit, total } }`. Mỗi dòng: id, delta (có dấu),
    balanceAfter, type, reason, createdAt, `orderId` (chỉ khi refType = ORDER). Không trả refId khác
    (id payout, giao dịch cashback, **id tài khoản khách bị gộp**). Commit `6cc465b`.
  - Miniapp: mục "Lịch sử Ví" cuối màn `/wallet` (`pages/wallet.tsx`, `useInfiniteQuery` + nút
    "Xem thêm" bằng `Button` DS v2), nhãn tiếng Việt theo loại (`utils/wallet-rules.ts: walletTxLabel`,
    loại lạ → "Biến động ví"), giờ `dd/MM HH:mm`, số dư sau giao dịch. Khoá query `['wallet','transactions']`
    là con của `['wallet']` nên rút/đổi xu xong tự làm mới. Commit `cd0d4bd`.
- **Đối soát (yêu cầu 4)** — `src/modules/wallet/wallet-reconcile.ts`: `diffWalletBalances` (thuần) +
  `findWalletLedgerDrift(db, { userIds? })` (LEFT JOIN `users` × SUM/COUNT `wallet_transactions`, bắt cả
  user có số dư mà chưa có dòng sổ). Script `pnpm --filter @tubutree/api reconcile:wallet`
  (`scripts/reconcile-wallet.ts`): **chỉ báo cáo**, thoát mã 1 khi có lệch để gắn cron/giám sát.
  Commit `70d4692`.
- **Race (yêu cầu 5)** — `test/integration-race/wallet-reconcile.race-spec.ts` (Postgres thật), commit `2fd2cad`:
  1. Ví còn 150k, song song: admin từ chối lệnh rút cũ ×2 (+150k), rút 100k ×3, đổi xu 60k ×2, cron
     cashback ×2 (+35k) — tổng lệnh trừ 420k > tối đa 335k. Kiểm: đối soát không lệch, số dư ≥ 0, mọi
     `balanceAfter` ≥ 0, WITHDRAW_REFUND và CASHBACK đúng 1 dòng, mỗi `(type, refId)` 1 dòng, mỗi payout
     đúng 1 dòng WITHDRAW, sao kê phân trang (limit 3) phủ đủ đúng các dòng, thứ tự mới nhất trước.
  2. Đối soát bắt được ví bị `UPDATE` tay bỏ qua sổ (+7.000) và user có số dư không có dòng sổ nào; ví
     khớp sổ không bị báo.
  (Các race của lượt 1–2 — 20 lệnh trừ song song, cùng refId ×10, rút/đổi xu/cashback/trả đơn/hoàn đơn/gộp
  khách — vẫn xanh.)

### Test thêm (đỏ → xanh)
- Unit `wallet.service.spec.ts` (+2: phân trang/thứ tự/phạm vi user; ẩn refId không phải ORDER) và
  `wallet-reconcile.spec.ts` (3): ĐỎ trước khi code (`getTransactions is not a function`,
  `Cannot find module './wallet-reconcile'`), XANH sau.
- Race `wallet-reconcile.race-spec.ts`: bỏ tạm `FOR NO KEY UPDATE` trong `applyWalletDelta` → case 1 ĐỎ
  3/3 lần (`Expected: >= 0, Received: -85000`); trả lại → XANH. (Bản đầu của case 1 để dư tiền nên không
  bắt được lỗi khoá; đã siết để tổng lệnh trừ vượt số dư tối đa.)
- Miniapp `utils/wallet-rules.spec.ts` (+3: nhãn theo loại, loại lạ, định dạng giờ): ĐỎ → XANH.

### Lệnh kiểm chứng (output thật, lượt 3)
```
$ cd apps/api && npx jest --maxWorkers=1 src/modules/wallet/
Test Suites: 4 passed, 4 total
Tests:       57 passed, 57 total

$ DATABASE_URL=postgresql://tubu:tubu@localhost:5553/tubutree_it?schema=public npx jest \
  -c test/integration-race/jest.config.js --runInBand "wallet-reconcile|wallet-ledger"
PASS test/integration-race/wallet-reconcile.race-spec.ts
PASS test/integration-race/wallet-ledger-flows.race-spec.ts
PASS test/integration-race/wallet-ledger.race-spec.ts
Tests:       14 passed, 14 total

$ DATABASE_URL=...5553/tubutree_it npx tsx scripts/reconcile-wallet.ts   # DB test, còn rác từ lượt đỏ trước
=== ĐỐI SOÁT Ví Tubu vs sổ cái wallet_transactions ===
User bị lệch   : 40
  user=cmv1w9f47002tob81ues0apay  ví=220000  sổ=0 (0 dòng)  lệch +220000
exit=1

$ npx tsc --noEmit -p tsconfig.json (apps/api) → exit 0 ; eslint các file api đã sửa → exit 0
$ cd apps/miniapp && npx tsc --noEmit → exit 0
$ npx vitest run src/utils/wallet-rules.spec.ts src/pages → Test Files 9 passed, Tests 111 passed
$ npx eslint src/pages/wallet.tsx ... → 6 lỗi, đều CÓ SẴN ở HEAD trước lượt này (import Button zmp-ui
  dòng 3, 5 màu rgba trên thẻ Ví/TubuXu); code mới không thêm lỗi nào.
```

### Giả định (lượt 3)
- Đối soát KHÔNG có `--apply` (khác reconcile:points): ví là tiền thật rút được, đặt số dư = tổng sổ có thể
  xoá tiền thật của khách khi lỗi nằm ở sổ. Sửa lệch = tra nguyên nhân rồi ghi dòng ADJUST qua
  `applyWalletDelta` (chưa có màn admin, xem việc còn lại).
- Sao kê không lộ refId nội bộ; chỉ `orderId`. Màn miniapp chưa bấm sang chi tiết đơn vì route chi tiết
  dùng `/order/:code`, API sổ chỉ có id đơn.

### Việc còn lại (sau gói)
- Deploy: migration `20261010041004_wallet_ledger` và code mới phải lên CÙNG đợt; ngay sau deploy chạy
  `reconcile:wallet` trên PROD (kỳ vọng 0 user lệch) và gắn chạy định kỳ.
- Chưa kiểm endpoint qua HTTP thật / chưa xem màn "Lịch sử Ví" trên Zalo (unverified ở mức UI; đã có
  tsc + unit + race ở tầng service).
- Màn admin điều chỉnh ví (ADJUST có lý do + người duyệt) nếu chủ dự án cần; web (apps/web) chưa có sao kê ví.
- Liên kết dòng ORDER sang chi tiết đơn (cần trả thêm `orderCode` hoặc route theo id).
