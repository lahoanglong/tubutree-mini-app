# chu lượt 2 (gl/1103-chu)

Commit: faa886d96 "fix(copy): đưa couponNotAppliedNotice ra khỏi entry Mini, siết regex nhãn, ghi giới hạn bộ quét câu API" (một commit gồm cả 18 file của lượt 1 vì lượt 1 chưa commit; không tách lại).

## Phát hiện
1. P2 entry Mini tăng: SỬA. `couponNotAppliedNotice` chuyển sang `packages/app-core/src/commerce/coupon-notice.ts` (chỉ voucher-sheet và coupon-box import, cả hai lazy). Sửa import ở voucher-sheet.tsx, coupon-box.tsx, terminology.spec.ts và đường dẫn trong CLIENT_API_DRIFT_OK. Xác nhận: chuỗi nằm ở chunk shipments.*, không ở entry.
   Bundle entry Mini (vite build, bundle-report): gốc 52fd5cd65 = 675199 B (659 KB raw, 205 KB gz); nhánh sau sửa = 675199 B (659/205). Bằng từng byte, không tăng.
2. P2 chưa commit/báo cáo/ảnh: commit và báo cáo XONG; ẢNH CHƯA CHỤP. Lý do: e2e chưa có persona Ví âm (apps/e2e chỉ có wallet.miniapp.spec.ts, không có mock số dư âm); dựng persona + chụp Mini 375/web 375/web 1280 ra ngoài lượt này. Rủi ro đã đo bằng chữ: câu khoá chỉ dài hơn khoảng 17 ký tự, nằm trong ghi chú dưới tuỳ chọn Ví đã vô hiệu (xuống dòng tự nhiên, không đẩy nút). Còn nợ: chụp bằng mock-api có số dư âm để xác nhận mắt.
   Lý do không sửa order-actions.tsx và apps/web/src/app/admin/terminology.spec.ts: không thuộc phạm vi câu Ví/Giờ vàng/mã chưa áp dụng của gói (admin là chữ nội bộ; order-actions chưa có câu lặp API trong 4 file quét), không đụng để khỏi mở rộng phạm vi.
3. P3 bộ quét 6 chữ đầu: GHI GIỚI HẠN trong comment đầu describe ở terminology.spec.ts (chỉ bắt khi 6 chữ đầu giống, chỉ lấy câu từ file chữ khách đọc của API; câu lệch từ đầu hoặc ở orders.service/checkout-split phải ghim trực tiếp như Ví). Không tách hằng thêm, không tối ưu 14,9 s (ngoài phạm vi).
4. P3 regex "nhãn": SỬA. Lookbehind thêm `dán |long `, lookahead thêm `lồng|sấy`; ca đối chứng sạch thêm "Dán nhãn lên hộp trước khi gửi", "Long nhãn sấy", "Nhãn lồng Hưng Yên" trong terminology.spec.ts.

## Kiểm
- `cd packages/app-core && npx vitest run`: Test Files 166 passed (166), Tests 2616 passed (2616).
- Không có test logic mới đỏ-trước (đổi chỗ module, không đổi hành vi; ca regex thêm là ca đối chứng sạch, xanh cả với mã cũ ở nhánh sạch nhưng bắt nhầm với regex cũ).
- Chưa chạy lại: jest api, vitest hai app, Playwright, lint:parity sau lượt 2 (chỉ đổi import và regex; app-core vitest xanh).
