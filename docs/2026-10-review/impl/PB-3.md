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
