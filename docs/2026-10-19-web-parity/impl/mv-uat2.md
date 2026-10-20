# Lane mv-uat2: web theo thay đổi Mini App của phiên UAT lô 2, 4, 5

Nhánh `web/mv-uat2`. Nguồn: nhánh cục bộ `uat/int` (tip a6c3ecc6, chưa vào main), đọc bằng `git show`, không gộp. Trường API mới (`serverNow`, `orderRules`) chỉ dùng khi có; thiếu thì web chạy như trước.

| Commit Mini App/API | File web | Kết quả |
|---|---|---|
| bfd3918d (QR ẩn khi huỷ/quá hạn, dừng dò) | `app/thanh-toan/bank-transfer-panel.tsx`, `chuyen-khoan/[code]/page.tsx` | Đã theo. 400/404/409/410/422 hoặc quá hạn: khối "Đơn không còn chờ chuyển khoản" (không QR), dừng dò nền; có `orderHref` thì nút "Xem đơn hàng". PAID xét trước. |
| 9dcc431b (bank-payment) | cùng file | Đã theo. 401/403/408/429/mạng/5xx không đóng màn, QR còn và dò tiếp. |
| 9968242c, 4ee6b81d (bank-payment) | cùng file, `components/support-hotline.tsx` (mới) | Đã theo: lỗi tải dùng khối lỗi (tiêu đề "Chưa tải được thông tin thanh toán", chữ theo ApiError/NetworkError, Thử lại, Xem đơn hàng, hotline "Cần hỗ trợ?"); "Giữ nguyên nội dung" thành khối lưu ý nền cảnh báo; nút Kiểm tra: 401/403 hiện lý do máy chủ, chữ mặc định `Unauthorized`/`Forbidden` thì câu hết phiên. Phần "tiêu đề một hàng/khung chờ tải" là chỉnh `Page`/`PageHeader` của zmp-ui, web dùng `TitleBand` nên không áp dụng. |
| 95d6a687, 9dcc431b (wallet) | `app/tai-khoan/vi-tubu/page.tsx` | Đã theo. Lỗi chưa rõ kết quả (NetworkError, 5xx) giữ Idempotency-Key, tải lại số dư, nhắc kiểm tra lịch sử (cùng chữ Mini App); 401/403/408/429 giữ key; 4xx khác đổi key; mở lại sheet giữ key khi còn lệnh chưa rõ. Endpoint, body không đổi. Trước đây web đổi key sau MỌI lỗi (có thể rút hai lần). |
| 9968242c, 4ee6b81d (wallet) | cùng file | Đã theo. Cờ chưa rõ tự gỡ khi sao kê trang 1 có dòng WITHDRAW mới đúng số tiền (`delta === -amount`, id chưa có lúc lỗi); sao kê chưa tải lúc lỗi thì không tự gỡ. Số Điểm Xanh `whitespace-nowrap`, hạng xuống dưới số. |
| bc92a683 (server-clock) | `packages/app-core/src/server-clock.ts` (thân hàm giống hệt Mini App), `api/flash-sale.ts`, `api/payment.ts`, `lib/shop-client.ts`, `lib/use-countdown.ts`, `lib/use-remaining.ts`, `components/home/flash-sale.tsx` | Đã theo. Đếm ngược giờ vàng (trang chủ, trang sản phẩm) và hạn chuyển khoản theo giờ máy chủ khi API trả `serverNow`. `/home` không dùng cho giờ vàng ở web (web gọi `/flash-sales/active`). |
| 94f2db2a (FAQ dự phòng) | không | Không làm: lane mv-uat3. |
| bc5e4c5b, 269aec88 (đơn sỉ) | `components/dealer/price-tab.tsx`, `dealer-hub.tsx`, `app-core/src/api/dealer.ts` (`orderRules?`, `DealerOrderRules`) | Đã theo. Dòng phí giao/miễn phí, tổng gồm phí, dưới tối thiểu khoá cả hai nút và ghi "Đơn tối thiểu … thêm … nữa để đặt", hạn mức so với tổng gồm phí. Thiếu `orderRules` giữ hành vi cũ. Khoá mua chịu khi nợ quá hạn là luật phía API (Mini App cũng không tính ở máy khách): web hiện nguyên văn lý do API từ chối (có test). |
| 959bf4f4 (mua chung %) | `app/mua-chung/group-buy-view.tsx` | Đã theo: "Đủ nhóm: nhận mã giảm ${discountPct}%, dùng cho đơn từ …" và "Mua ngay với mã giảm ${discountPct}%". Không còn chỗ nào khác của web tính `basePrice - unitPrice` cho mua chung (đã grep). Không có spec e2e khoá chữ cũ. Chữ % khớp hoàn toàn khi API 29795d4e của UAT vào main; trước đó `discountPct` đã có ở kiểu `GroupBuy`. |
| Nhãn sổ điểm `REVIEW_RETURN` | `lib/ledger-labels.ts` | Mini App (uat/int, account-api.ts:272) đã có nhãn "Thu hồi điểm đánh giá (trả hàng)"; web dùng đúng chữ đó (không dùng chữ gợi ý "Thu hồi thưởng đánh giá (trả hàng)"). Main chưa có mã này. |
| 3a7514a6, 17fabec5, `waste-mocks.ts` PARTNER, external-points NOT_ELIGIBLE_USER | không | Không làm theo đề bài (không có màn quét mã đơn sàn ở web; mv-shop đã lọc themeColor; mock PARTNER phụ thuộc API nhánh UAT; web không có màn tích điểm đơn ngoài app). |

## Quyết định và câu hỏi
1. Câu hết phiên của nút Kiểm tra ở web là "Phiên đăng nhập đã hết hạn. Bạn đăng nhập lại rồi bấm Kiểm tra nhé." (Mini App: "mở lại ứng dụng hoặc đăng nhập lại"), vì web không có "ứng dụng" để mở lại. Giữ ý và hai cụm Mini App kiểm (`phiên đăng nhập`, `đăng nhập lại`).
2. Khối "không còn chờ chuyển khoản" áp cả ở chi tiết đơn (BankTransferPanel dùng chung): đơn quá hạn không còn dựng QR ở đó nữa. Chi tiết đơn đã có trạng thái đơn nên không thêm nút "Xem đơn hàng" ở đó.
3. Thử lại/hotline: web dùng `supportContactQuery` của app-core với số mặc định `0984 606 774` khi lỗi cấu hình (giống RecycleSupport).
4. `serverNow` khai báo tuỳ chọn ở app-core và web (`BankQrDTO`, `FlashItem`), không đụng `packages/shared-types`.

## Kiểm chứng
- `apps/web`: vitest 385 file/6585 test xanh (cả `TZ=UTC`), `tsc --noEmit`, `eslint` các thư mục đụng tới, `next lint`, `next build` xanh.
- `packages/app-core`: vitest 42 file/496 test, `tsc --noEmit` xanh.
- `apps/miniapp` (không sửa): vitest 283 file/4313 test xanh.
- Không chạy Playwright (đề bài chỉ cho viết spec); không có spec e2e nào khoá chữ cũ.
