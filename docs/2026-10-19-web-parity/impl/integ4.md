# Lane integ4: QR chuyển khoản theo hạn, gom đường dẫn chuyển khoản

## 1. Đã làm
| Mục | Commit | File chính |
|---|---|---|
| Chi tiết đơn chỉ dựng QR khi còn hạn (`canPayNow`); quá hạn hiện hạn và chữ tự huỷ | c63e6ea2 | `apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx` (+spec) |
| Gom mọi chỗ nối `/thanh-toan/chuyen-khoan/` về `bankPaymentHref` | 42134975 | `chuyen-khoan/[code]/page.tsx`, `thanh-toan/page.tsx`, `order-card.tsx`, `price-tab.tsx`, `ctv-order-sheet.tsx` |
| Ghi docs 98 | 285730a7 | `98-cau-hoi-va-chua-kiem-chung.md` |
| Review 1: khung QR ở lại khi trang dựng lại sau hạn (`qrShown`) | 3e66222c | `don-hang/[code]/page.tsx` (+spec) |
| Review 1: bỏ `canPayAgain` không còn nơi gọi | 202d4e86 | `lib/order-view.ts` (+spec) |
| Review 1: trả lại câu hỏi shop ghi nhầm, ghi đúng mục integ2/integ4 | b127c076 | `98-cau-hoi-va-chua-kiem-chung.md` |
| Review 2: ẩn dòng hạn đầu trang khi khung QR đang hiện | 3ae339e3 | `don-hang/[code]/page.tsx` (+spec) |

Route web xong: `/tai-khoan/don-hang/[code]` (QR theo hạn). `/thanh-toan/chuyen-khoan/[code]` đã khớp `bank-payment.tsx` từ trước nên không sửa. Không route nào đổi trạng thái pending.

## 2. Kiểm chứng
Gate cuối run3 CHƯA tới DONE khi viết báo cáo (summary.txt chưa có dòng DONE), nội dung hiện có:
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)       Tests  488 passed (488)
web-typecheck rc=0
web-lint rc=0
```
Chưa có kết quả web test, Mini App test, build trong summary. Ngoài gate: `page.spec.tsx` chi tiết đơn 33/33 xanh, đã chứng minh đỏ khi bỏ bản sửa. Chưa chạy lại vitest Mini App (tổng phải không dưới 4214); lane không đụng file Mini App.

## 3. Review
Lượt 1:
- MAJOR: docs 98 đánh dấu nhầm shop:1/4/6/10/11 là đã xử lý, thiếu mục integ2 thật, dòng 169 chưa cập nhật. Đã sửa ở b127c076.
- MINOR: khung QR bị gỡ khi trang dựng lại sau hạn, mất thông báo đã nhận thanh toán. Đã sửa ở 3e66222c (sticky `qrShown`, test đổi giờ).
- MINOR: `canPayAgain` thành mã chết, comment sai. Đã sửa ở 202d4e86 (xoá).
Lượt 2:
- MINOR: dòng hạn đầu trang lặp với dòng hạn trong khung QR sau hạn. Đã sửa ở 3ae339e3 (`showPayPanel` dùng chung, test đúng một lần câu hạn).

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng
- Gate cuối chưa xác nhận xanh toàn bộ (web test, Mini App test, build chưa có kết quả).
- `ctv-order-sheet.tsx:250` còn chuỗi `/thanh-toan/chuyen-khoan/x` để dò `isWebRouteReady`, không phải href, giữ nguyên.
- Trang `/thanh-toan/chuyen-khoan/[code]` chưa có test riêng cho đơn quá hạn; chỉ có đồng hồ "Đã quá hạn chuyển khoản" trong panel.
- Review lượt 2 sau 3ae339e3 chưa chạy lại lượt 3.

## 5. Câu hỏi cho chủ dự án
- Không có câu hỏi mới. Mặc định đã dùng: QR ở chi tiết đơn theo `canPayNow` như Mini App; trang chuyển khoản riêng không chặn theo hạn (giống Mini App).
