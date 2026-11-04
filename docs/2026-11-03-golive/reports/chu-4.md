# chu-4 — sửa theo reviewer Opus (nhánh gl/1103-chu)

- P2 entry Mini +93 B: tách bankFieldErrors/bankDetailsError/returnFormError sang apps/miniapp/src/utils/refund-form-rules.ts (importer đổi theo). Đo lại `vite build`: entry index.Bq3vo3p3.module.js = 674714 B (gốc 675199, giảm 485 B; không tăng). Câu vẫn nằm trong chunk index do trang order-detail/ sheet được gộp vào đó; không tách thêm được mà không đổi chia chunk.
- P3 lệch câu client/API (external-points LOCKED "quá nhiều lần ... Tubu Tree"; CODE_REJECTED web "Đăng nhập lại để tiếp tục" vs API "Bạn đăng nhập lại nhé"): KHÔNG sửa, điều phối quyết định (đưa câu API sang *-notice.ts hoặc thêm CLIENT_API_DRIFT_OK). Vế external-points thuộc vùng phiên db.
- P3 luật "nhãn": thêm biên từ (\p{L}, cờ u), miễn "đọc kỹ nhãn" và "nhãn sản phẩm"/"nhãn giao hàng"; thêm ca bắt "Xin nhãn Cocoon", "Xem nhãn giao nhanh", ca bỏ qua "Đọc kỹ nhãn trước khi dùng", "Xem nhãn sản phẩm ở mặt sau" vào terminology.spec.
- P3 admin: apps/web/src/components/admin/customer-refunds-tab.spec.tsx bị sửa (chỉ spec, vì hằng chung đổi chữ); màn admin customer-refund-paid-dialog nay hiện "Nhập tên ngân hàng nhận tiền hoàn." / "Nhập tên chủ tài khoản nhận tiền hoàn." cho nhân viên. Báo phiên db trước khi merge.
- P3 placeholder: "(tối thiểu 5 ký tự)" -> "(ít nhất 5 ký tự)" ở Mini return-request-sheet.tsx và web return-request-form.tsx.

Kiểm: app-core vitest 166 file / 2627 test xanh; miniapp vitest refund-rules + components/orders 36 test xanh (có 4-6 lỗi unhandled môi trường "webidl.util.markAsUncloneable", Node cũ, không liên quan); miniapp tsc sạch. Chưa chạy lại vitest web / Playwright.
