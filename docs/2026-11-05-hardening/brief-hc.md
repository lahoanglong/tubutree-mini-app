# Gói hc — tiền, webhook (cashback, voucher mốc, ZNS, rút hoa hồng)

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hc`
- Nhánh: `hard/1105-hc`, gốc `d79ceeb85`
- Cổng PG: **46533**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.

Đây là đường tiền. Sau bạn có reviewer Opus đối kháng.

## Mục (chi tiết ở `audit-1105-findings.md`, phần L2)

### 1. L2-01 — cashback chỉ đi tiến
- `applyToExisting` và nhánh P2002 đưa tập trạng thái "từ" hợp lệ vào `where`. Thứ tự tiến: PENDING → CONFIRMED → PAID; REJECTED là nhánh riêng.
- Provider AccessTrade gặp trạng thái lạ thì trả null và log warn, không map thành PENDING.
- Test:
  - unit: CONFIRMED + postback PENDING → không đổi;
  - race: postback PENDING muộn chạy cùng lúc reconcile CONFIRMED → cuối cùng CONFIRMED rồi settle.

### 2. L2-02 — giữ quyết định của Kế toán (chủ chọn "Giữ quyết định Kế toán")
- Thêm cột `cashback_transactions.adminReviewedAt` (và người duyệt nếu chưa có cột).
- Ingest (postback, reconcile) bỏ qua dòng đã có quyết định admin.
- Khi AccessTrade báo khác quyết định thì báo ADMIN in-app/email theo kênh báo động sẵn có. Mỗi dòng chỉ báo một lần; lưu dấu đã báo.
- Test: REJECTED do admin, sau đó postback CONFIRMED → vẫn REJECTED, Ví không đổi, có đúng 1 cảnh báo.

### 3. L2-03 — ZNS
`update(SENT)` lỗi sau khi đã gửi thành công: thử lại việc ghi SENT (3 lần, giãn cách ngắn). Vẫn lỗi thì log error rồi nuốt lỗi, để job không thử gửi lại.
- Test: unit mock update lỗi 1 lần → không gửi lại.

### 4. L2-04 — rút/cron chuyển hoa hồng
Cả hai chỗ (`affiliate.service.ts` ~1478 và ~1679) chỉ lấy commission có đơn còn DELIVERED. JOIN orders trong cùng câu khoá.
- Test race: đơn RETURNED commit chạy cùng lúc rút → hoa hồng của đơn đó không vào khoản rút.

### 5. L2-05 — voucher mốc bù chênh lệch (chủ chọn "Bù chênh lệch")
Trong cùng tháng, khách đạt bậc cao hơn bậc đã nhận thì cấp voucher giá trị = thưởng bậc mới − tổng thưởng mốc đã nhận trong tháng. Tổng nhận bằng thưởng bậc cao nhất đạt được.
- Không trừ voucher đã dùng.
- Mã voucher và lý do vẫn duy nhất theo (bậc, tháng).
- Sửa comment cho đúng hành vi.
- Test unit:
  - 1tr rồi 3tr trong tháng → 30k + 70k;
  - đạt 3tr ngay → 100k;
  - tháng sau → tính lại từ đầu.

### 6. L2-06
Voucher mốc không được cấp lại sau khi cron dọn xoá mã. Chọn một:
- loại `MILESTONE%` khỏi cron dọn;
- lưu khoá chống trùng (bậc, tháng, user) ở bảng riêng.

Ghi lý do chọn. Test tương ứng.

### 7. L2-07
Hai tab admin review cùng một cashback: `applyToExisting` trả count; count = 0 thì trả 409, câu: "Khoản này vừa được người khác xử lý — tải lại." Không log sai.
- Test race: hai review song song → một 200, một 409.

### 8. L2-08
AccessTrade báo "rejected" sau khi đã PAID: log warn, báo ADMIN, lưu payload. Không đổi tiền.
- Test unit.

### 9. L2-09
CAS trừ `cashbackPending` thêm `userReward` vào `where`. Nếu thua thì đọc lại trong tx.
- Test race: hai lần đổi trạng thái cùng một dòng → `cashbackPending` khớp tổng thật.

## File không đụng
- `admin.service.ts` (nếu cần route mới thì đặt trong controller/service cashback);
- `affiliate.service.ts`, ngoài hai chỗ của L2-04. Phần còn lại thuộc gói ha: A3, `findEligibleReferrer`.
