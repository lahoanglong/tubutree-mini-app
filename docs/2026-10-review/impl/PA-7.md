# PA-7 — Luật voucher thưởng + giới thiệu

## C-059 (A5N-09; Q-05) — Voucher chào mừng/sinh nhật/winback chỉ cho user thật; birthday/winback theo lô — XONG

Commit: `c7a5662` fix(vouchers): welcome/birthday/winback chỉ cấp cho user thật, birthday/winback quét keyset theo lô không bỏ sót (C-059)

### Đã sửa (`apps/api/src/modules/vouchers/vouchers.service.ts`)
- "User thật" = có SĐT, HOẶC có `zaloId` không bắt đầu bằng `guest_` (khách deviceId mang `guest_<deviceId>`, dòng guest đã gộp mang `guest_..._merged_...`). Một điều kiện dùng chung: `REAL_USER_WHERE` (Prisma, cho welcome) và `REAL_USER_SQL` (raw SQL, cho birthday/winback; dùng `left(zaloId,6)` thay LIKE vì `_` là ký tự đại diện).
- Welcome: thêm bộ lọc user thật vào truy vấn cấp (vẫn quét cursor như cũ).
- Birthday: bỏ `LIMIT 500` không ORDER BY → keyset `u.id > cursor ORDER BY u.id LIMIT 500`, lặp đến khi hết; lọc user thật.
- Winback: cùng lớp lỗi (`LIMIT 500` không ORDER BY) → JOIN users lọc user thật + keyset theo `o."userId"`.
- Idempotent: giữ khoá có sẵn, code coupon tất định `<REASON>-<userId>` + `coupon.code @unique` (grant() chạy ngoài transaction, P2002 ⇒ coi như đã cấp).
- Nơi cấp lúc đăng ký: KHÔNG có. `auth.controller.ts:28` (guest login) không cấp voucher; voucher chào mừng chỉ được cấp qua cron `welcomeVouchers`, nên lọc ở truy vấn cron là đủ. Không sửa auth.

### Test thêm (đỏ → xanh)
`apps/api/test/integration-race/vouchers-real-user.race-spec.ts` (Postgres thật `tubu_it_pa7:5547`):
- (a) welcome: guest / guest đã gộp = 0, user Zalo = 1, user có SĐT = 1 (cron chạy 2 lần).
- (b) birthday: 8 user thật với lô 3 → mỗi người đúng 1, guest 0, chạy 2 lần.
- (c) winback: 5 user thật với lô 2 → mỗi người đúng 1, guest có đơn cũ 0, chạy 2 lần.
- (d) birthday: 2 lượt cron chạy song song → mỗi user đúng 1 voucher.
- (e) birthday: 520 user thật cùng ngày sinh, lô mặc định → cấp đủ 520.

ĐỎ (trước khi sửa):
```
Tests:       3 failed, 1 passed, 4 total    # (a) guest nhận welcome, (b)(c) guest nhận birthday/winback = 1
[e] birthday 520 users granted=486          # LIMIT 500 không ORDER BY bỏ sót người
```
XANH (sau khi sửa):
```
$ DATABASE_URL=postgresql://tubu:tubu@localhost:5547/tubutree_it?schema=public npx jest -c test/integration-race/jest.config.js --runInBand vouchers-real-user
    [a] welcome guest=0 merged=0 zalo=1 phone=1
    [b] birthday real=[1,1,1,1,1,1,1,1] guest=0
    [c] winback real=[1,1,1,1,1] guest=0
    [d] birthday parallel real=[1,1,1,1,1]
    [e] birthday 520 users granted=520
Tests:       5 passed, 5 total
```
Kiểm chứng khác:
- `npx jest --maxWorkers=1 src/modules/vouchers` → `Tests: 15 passed, 15 total`
- `npx tsc --noEmit -p tsconfig.json` (apps/api) → exit 0
- `npx eslint src/modules/vouchers/vouchers.service.ts test/integration-race/vouchers-real-user.race-spec.ts` → 0 lỗi, 0 cảnh báo

Migration: không.

### Giả định
- SĐT trên `users.phone` chỉ được ghi từ `phoneToken` Zalo (auth.service: loginWithZaloMiniApp / attachPhoneIfMissing / upgrade guest), không có API nào cho user tự nhập SĐT tài khoản ⇒ có SĐT = đã xác thực. Guest đã xác thực SĐT qua Zalo được tính là user thật.
- Giữ nguyên các bộ lọc hiện có (welcome: role CUSTOMER + chưa có đơn + tạo trong 24h); birthday/winback không thêm lọc role.

### Việc còn lại / ghi chú
- Guest tạo > 24h rồi mới nâng cấp tại chỗ thành tài khoản Zalo (cùng dòng `users`) sẽ không vào cửa sổ welcome 24h (cửa sổ tính theo `createdAt`, không có cột thời điểm nâng cấp). Trước đây guest đó đã nhận voucher khi còn là guest; nay không nhận. Nếu cần, thêm cột thời điểm xác thực và tính cửa sổ theo cột đó (cần migration, ngoài phạm vi lượt này).
- `milestoneVouchers` vẫn `LIMIT 1000` không ORDER BY và không lọc user thật (không thuộc C-059/Q-05, chỉ áp cho đơn DELIVERED). Nên xử lý cùng kiểu keyset ở gói sau.
- Birthday dùng ngày/tháng theo giờ máy chủ (`new Date().getMonth()/getDate()`), không theo giờ VN. Cron 01:00 UTC = 08:00 VN cùng ngày nên hiện không lệch; chưa sửa.
