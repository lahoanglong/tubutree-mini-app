# muahang đợt B (worker)

Nhánh review/1028-muahang tip b7fdabcc520b1924da5ad39b26ffa2ec372ffe43

LƯỢT 1 gói muahang. Nhánh review/1028-muahang, 16 commit trên 1384ff380, cây sạch, chưa push.
Commit chính: f17e18b0f R-31 | 8ef21061d R-6+R-26 | 82ebd3f5f R-26 Mua lại | 5c329b583 R-30 | 29a49ab0e R-28/29/104 Mini | c67ba3633 R-28/29 web | 0fb45073b R-23 | 6bf926fe8 R-7+R-22 | 85275fee5 R-8+R-96 | ca29ac580 R-27 | f9f1a88ab R-25+R-103 | 32e319520 R-97 | 6fa8fbcf8 R-105 | b7fdabcc5 cập nhật Playwright (+2 commit nhỏ: bỏ eslint thừa, spec toLocaleString).

MỤC R-x
- R-6 LÀM: app-core/variation-picker.ts (+spec) + VariationSheet (BottomSheet) ở Mini và web. Từ 2 phân loại thì Thêm giỏ/Mua ngay mở bảng chọn (ảnh SP, tên, giá Giờ vàng, tồn kho, số lượng, nút xác nhận); 1 phân loại thêm thẳng. Chọn khác brief: web CHỈ mở bảng ở khổ <768px (máy tính đã có ô chọn cạnh nút). Ảnh dùng thumbnail SP (phân loại không có ảnh riêng).
- R-7 LÀM: CheckoutSkeleton web đúng thứ tự khối, chốt một lần (đổi điểm/mã không dựng lại). /me/addresses và /cart vốn đã song song sau refresh nên không đổi. CLS/LCP CHƯA đo (người giao đo).
- R-8 LÀM: PlatformBridge.saveImage (app-core bridge.ts); Mini dùng zmp-sdk saveImageToGallery trong zmp-bridge.ts; web bỏ max-md:hidden; câu chung BANK_QR_HINT ở app-core/bank-payment-copy.ts. Mini CẦN THỬ TRÊN ZALO THẬT (SDK >=2.16, chỉ mobile).
- R-22 LÀM: giỏ lỗi thì hiện ErrorState cả trang + Thử lại; báo giá lỗi/chưa có địa chỉ thì có lý do trên thanh Đặt hàng.
- R-23 LÀM một phần: chữ ghi chú "Ghi chú cho Tubu", bỏ nhãn dài + bộ đếm trên điện thoại, ô VAT tick bên phải, dòng Điểm Xanh hai dòng như Mini. Câu điều khoản giữ sát nút (theo brief).
- R-24 KHÔNG LÀM: chưa tái hiện được Hydration failed (cần next start + lane). Đọc mã PdpPointsEarn/Freeship/Coupons/Subscribe không thấy chỗ lệch server/client; không đoán sửa.
- R-25 LÀM: groupBuyListQuery(http, viewer) khoá ['group-buy','list',viewer]; web truyền id người dùng/'guest'. Mini chưa đụng.
- R-26 LÀM: toast thêm giỏ position top; Mua lại (navigateToCart) không toast khi đủ, có lỗi thì toast top.
- R-27 LÀM: nút Dùng/Bỏ/Chưa đủ (aria-label đủ mã), gợi ý "Nhập mã".
- R-28 LÀM: ẩn dòng Ví khi số dư 0đ ở Mini và web. Không làm trả một phần.
- R-29 LÀM: app-core/points-offer.ts "Dùng X điểm, giảm Yđ" (kẹp theo pointsMax) ở cả hai nền.
- R-30 LÀM: SUBSCRIPTIONS_IN_MINIAPP=false trong features.ts; ẩn ở trang SP, đặt thành công, tab Định kỳ (tab=subscriptions về Tất cả). Ô Định kỳ ở Cá nhân CHƯA ẩn (taikhoan lọc sau khi gộp).
- R-31 LÀM: migration 20261028110000_welcome30_new_customer_only (UPDATE theo code, idempotent) + seed newCustomerOnly:true. API đã lọc theo cờ này sẵn (loyalty.service, coupons.service). FREESHIP/giá trị/ngưỡng không đổi. Cần deploy migration.
- R-96 LÀM: Mini: Ngân hàng/Chủ TK xếp dọc, một số tiền lớn có nút chép (bỏ dòng Số tiền), nút Kiểm tra vào thanh dính đáy.
- R-97 LÀM: còn "Nhận ~X Điểm Xanh"; bỏ PointsBoostStrip khỏi PDP Mini. Popup chi tiết hạng/đơn sàn KHÔNG làm.
- R-103 LÀM: ảnh+tên+giá gộp một Link min-h-14.
- R-104 LÀM: tiêu đề Mã người giới thiệu cùng cỡ Mã giảm giá (Mini).
- R-105 LÀM: "+X điểm, về khi đơn giao xong" một dòng (Mini + web order-success.tsx, ngoài danh sách file nhưng cùng luồng).
- R-32 KHÔNG LÀM (chờ chủ).

KIỂM (số thật)
- tsc --noEmit: app-core, miniapp, web, e2e, api (pnpm typecheck): sạch.
- vitest: app-core 73 file/930 test xanh; miniapp (TZ=UTC) 315/4869 xanh; web 442 file, 7443 test (1 lỗi no-raw-date-format đã sửa, chạy lại xanh).
- jest api đủ: 484 suite/11217 test xanh. Không chạy race test (không đụng tiền/điểm ở API).
- eslint: file đổi của miniapp và web sạch (web không có cấu hình, lệnh không báo gì).
- pnpm lint:parity: xanh (0 mục pending).
- Playwright Mini toàn bộ: 205 passed, 10 skipped, 0 failed (sau khi sửa 9 ca cũ theo thay đổi chủ định: Định kỳ ẩn, nhãn Điểm Xanh, đặt thành công). web-gate 3 spec (web-checkout, shop, order): 109 passed, 11 skipped, 0 failed. Web gate chưa chạy cả bộ.
- Bundle Mini: entry 712 KB raw/222 gz (mốc 711, +1 KB, chủ yếu saveImage ở entry); tổng 1916 KB raw/739 gz; cảnh báo entry>700 vốn có. Web First Load (sau): /san-pham/[slug] 188, /thanh-toan 192, /mua-chung 157, /gio-hang 163 KB; KHÔNG tìm thấy số web trước trong baseline.json nên chưa so được.
- run-all.mjs: không chạy theo lệnh.

CHƯA LÀM / CHƯA KIỂM
- ẢNH TRƯỚC/SAU: KHÔNG chụp (không dựng lane 6); thư mục screens-muahang chưa có ảnh. Giao diện chỉ kiểm bằng test, chưa nhìn ảnh 375px.
- R-24, popup R-97, ô Định kỳ ở Cá nhân: như trên.
- Nút Lưu QR ở Mini chưa thử trên Zalo thật. Web chưa có test riêng cho bridge.saveImage.
- Khi đã thử trên lane: bảng chọn phân loại ở Mini dùng BottomSheet của dự án (bọc zmp Sheet).
