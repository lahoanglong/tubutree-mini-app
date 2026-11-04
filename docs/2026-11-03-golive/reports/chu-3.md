# chu lượt 3 (gl/1103-chu) commit 575b7c24b

1. P2 order-actions/refund: SỬA (cách 1). Tạo apps/api/src/modules/orders/refund-notice.ts (4 hằng), refund-destination.ts và order-returns.service.ts dùng hằng. app-core client-copy.ts: BANK_NAME_REQUIRED, ACCOUNT_NUMBER_INVALID, ACCOUNT_NAME_REQUIRED, RETURN_REASON_REQUIRED bằng đúng câu API; web refund-rules.ts và Mini refund-rules.ts dùng hằng. terminology.spec (app-core) ghim 4 cặp client = API. Cập nhật spec cũ + e2e returns-reversal. Báo cáo lượt 2 ghi "order-actions không có câu lặp API" là SAI, đã đính chính ở đây. Placeholder "Mô tả lý do (tối thiểu 5 ký tự)…" là nhãn ô, không phải câu lỗi, giữ nguyên.
2. P2 ảnh Ví âm: XONG. docs/2026-11-03-golive/screens-chu/{before-,}checkout-{mini375,web375,web1280}.png (trước = chữ cũ, sau = 575b7c24b). Đã mở xem sau: câu xuống 3 dòng, không đẩy nút, không tràn; Mini để câu trong hàng Ví, web để dưới hàng (khác biệt có sẵn, không do gói này). Sheet định kỳ dùng cùng hàm walletNegativeCheckoutReason nên cùng chữ, CHƯA chụp riêng.
3. P3 luật chép câu: SỬA. Chuyển sang app-core terminology.spec, quét Mini + web (trừ app-core/api), thêm 'câu nhận tiền hoàn' và 'ít nhất 5 ký tự'; đã chứng minh đỏ khi thêm 'Hết suất ưu đãi.' vào apps/web/src/lib. Bỏ ca cũ ở Mini terminology.spec.
4. P3 regex nhãn: SỬA. lookbehind + 'quét |in |hoa |quả |trái ', lookahead + 'vận|giao'; 5 ca đối chứng sạch; chứng minh regex cũ bắt nhầm cả 5.
5. P3 tiêu đề commit: SỬA. Chưa push, nên gộp lại thành 1 commit tiêu đề đúng (reset --soft về 52fd5cd65). chu-1.md của lượt 1 không có, ghi chú: nội dung lượt 1 nằm ở chu-2.md và commit này.

## Kiểm (Node 22.23.3)
- app-core vitest: 166 files, 2623 tests pass (trước đó terminology+client-copy 199 pass)
- miniapp vitest (refund-rules, components/orders, i18n): 17 files, 176 pass
- web vitest (order-actions, customer-refunds-tab, refund-rules): 3 files, 155 pass
- api jest (order-returns, customer-refunds, checkout): 9 suites, 391 pass; tsc api sạch
- Chưa chạy: toàn bộ Playwright, lint:parity, bundle (chỉ đổi chữ/hằng ở app-core; entry Mini không thêm import mới ngoài client-copy sẵn có). e2e returns-reversal đã sửa chữ nhưng chưa chạy.
