# Gói qd2 vi: hoa hồng đủ hạn vào Ví lúc 8:00, mỗi CTV một tin tổng

Gốc: `6fae1a289`. Đọc kỹ luật chung `tools/brief-worker.md`. Gói đụng tiền nên phải có race spec. `migration: true`, thư mục migration bắt đầu bằng `20261031090000`.

Chủ chốt (nguyên văn, `21-quyet-dinh.md` mục E): "E-46: chuyển hoa hồng đủ hạn vào Ví mỗi sáng 8:00 (giờ VN), mỗi CTV một tin tổng."

Lý do chủ đưa ra ở mục B: "CTV đông đơn đang nhận nhiều tin mỗi ngày."

## Hiện trạng (scout, dòng có thể lệch)
- `apps/api/src/modules/affiliate/affiliate.service.ts`:
  - khoảng :1437: `@Cron('0 0 * * * *', { timeZone: CRON_TZ })` trên `approveDueCommissions()`, chạy mỗi giờ;
  - khoảng :1468: hàm này gọi `autoTransferApprovedToWallet()` (khoảng :1485);
  - điều kiện chuyển: `status: 'APPROVED', payoutBatchId: null, user.isBlocked: false`; mỗi CTV đi qua `requestPayout(..., 'WALLET_BALANCE', ...)`.
- Cờ `affiliate.auto_wallet_transfer_enabled` mặc định true (`affiliate-auto-transfer-config.ts`).
- Tin: `ctv-notification-codes.ts`, gồm `COMMISSION_WALLET_CREDITED` và `COMMISSION_WALLET_TAX_ONLY`. Hàm gửi `notifyAutoWalletCredited` ở khoảng :1525. Lượt duyệt cũng gửi tin "đã duyệt"; tìm xem gửi cho từng hoa hồng hay cho từng lượt.
- Race spec có sẵn: `affiliate-auto-wallet.race-spec.ts`, `commission-wallet-reversal.race-spec.ts`.
- PR #81 của b4 (đã merge) vừa sửa vùng này: khoá nút "Chuyển vào Ví" tới khi dashboard tải lại, bỏ một guard. Đọc diff #81 (`git log --oneline 5624ea319..f74bc218f`) trước khi sửa.

## Luật mới
1. **Lịch.** Hoa hồng đủ hạn được duyệt và chuyển vào Ví một lần mỗi ngày, lúc 8:00 giờ VN (`'0 0 8 * * *'`, `CRON_TZ`).
   - Nếu cron mỗi giờ hiện tại còn làm việc khác cần chạy mỗi giờ (ví dụ nhắc hạn, mốc thưởng), tách phần đó ra và giữ mỗi giờ. Ghi rõ trong báo cáo cron nào chạy lúc nào.
   - Không đổi điều kiện "đủ hạn", không đổi số tiền, thuế, phí hay thứ tự trừ.
   - Nút "Chuyển vào Ví" thủ công của CTV vẫn chạy như cũ bất kỳ lúc nào.
2. **Tin.** Ở lượt 8:00, mỗi CTV nhận tối đa một tin, trong app (giữ kênh như mẫu hiện có nếu mẫu đang gửi cả ZNS; ghi rõ trong báo cáo).
   - Bật tự chuyển: một tin tổng cho số tiền đã vào Ví (và số hoa hồng) trong lượt. Ví dụ: "Tubu Tree đã chuyển {{amount}} hoa hồng ({{count}} đơn) vào Ví của bạn."
   - Ca toàn bộ bị giữ thuế (hiện là `COMMISSION_WALLET_TAX_ONLY`): gộp vào cùng một tin tổng hoặc giữ một tin riêng, nhưng mỗi CTV vẫn tối đa một tin cho lượt.
   - Tin "đã duyệt" của từng hoa hồng không gửi riêng nữa khi đã nằm trong tin tổng.
   - Tắt tự chuyển: lượt 8:00 chỉ duyệt, và gửi một tin tổng "đã duyệt", kèm việc CTV cần làm (vào Hoa hồng bấm Chuyển vào Ví).
   - Câu chữ phải ngắn, tiếng Việt có dấu, số tiền theo cách định dạng tiền đang dùng. Mẫu mới hay mẫu sửa đều chèn bằng migration có guard theo luật chung.
3. **Idempotent.** Cron chạy lại, hoặc hai tiến trình chạy cùng lúc: không chuyển hai lần, không gửi hai tin. Dùng dedupeKey theo CTV và ngày VN (hoặc theo payout batch), theo cách các tin khác đã làm.
4. **Chữ giao diện.** Nơi Mini và web đang nói về tự chuyển hoa hồng (ví dụ `apps/web/src/app/tai-khoan/vi-tubu/page.tsx` khoảng :158, trang CTV hai nền) thì nói rõ "mỗi sáng 8:00" nếu đang nói về lịch. Không thêm khối giao diện mới. Hai nền giống nhau.

## Test bắt buộc
- Unit cho lịch cron và cho phần gộp tin.
- Race spec (sửa `affiliate-auto-wallet.race-spec.ts` hoặc thêm spec mới):
  - CTV có 3 hoa hồng đủ hạn: một lượt chuyển đúng tổng, đúng một tin;
  - lượt chạy hai lần, hoặc hai tiến trình cùng lúc: chuyển một lần, một tin;
  - CTV bấm "Chuyển vào Ví" đúng lúc cron chạy: không chuyển đôi;
  - CTV bị khoá, thiếu MST, và payoutBatchId cũ: hành vi như cũ;
  - tắt tự chuyển: chỉ duyệt, một tin tổng.
- Chạy lại `commission-wallet-reversal.race-spec.ts` và mọi race spec có chữ `affiliate`, `commission`, `wallet`.

## Báo cáo thêm cho chủ
- Câu tin mới và mã tin.
- Cron nào chạy lúc nào sau khi sửa.
- Ca nào bị chậm hơn so với trước (ví dụ hoa hồng đủ hạn lúc 9:00 thì tới 8:00 hôm sau mới vào Ví).
