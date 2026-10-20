# Lane mv-order: web điện thoại giống Mini App (nhóm đơn hàng và tài khoản)

Nhánh `web/mv-order`, worktree `.claude/worktrees/web-mv-order`. Ảnh chụp cuối: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/visual/mv-order-2/web/tour/<tên>.jpg` (so với `.../run2/miniapp/tour/<tên>.jpg`). Lần chụp 1: `mv-order-1`.

Chung: dải tiêu đề `TitleBand` (components/order-mobile/mobile-ui.tsx, như PageHeader của Mini App), nút lùi nổi của layout, kiểu thẻ/dải ở `max-md:`; từ md giữ giao diện máy tính. Chữ khác Mini App thì sửa ở mọi khổ.

| Màn | Đã sửa (commit) | Còn lại (vì sao) | Ảnh cuối |
|---|---|---|---|
| Giỏ hàng | 09451117: thẻ dòng nổi, ô chọn tự vẽ, "Chọn tất cả" không đếm (D7-34), nút Thanh toán đếm số lượng như Mini, thanh dính đáy có freeship + "Tạm tính (đã giảm, chưa gồm ship)", thẻ mã giảm giá "Chọn mã" | Chân trang gọn (hotline, chính sách) vẫn hiện trên web ở điện thoại: do lane mshell, ngoài phạm vi. Nút −/+ bo hơi khác | cart.jpg |
| Thanh toán | 34933dbb, ef28b8a5: khối xếp theo thứ tự Mini (địa chỉ, sản phẩm, mã, giới thiệu, phương thức, điểm, ghi chú, VAT, tóm tắt), dải phẳng kể cả thẻ giới thiệu và VAT, huy hiệu Mặc định, "Thêm địa chỉ mới" biểu tượng, nút "Đặt hàng · tổng" một nút dính đáy. D7-33: khoá bằng test (không đổi hành vi) | Thanh dính đáy là StickyActionBar của lane khác (viền/bóng hơi khác). Chữ phương thức trả tiền ("Thanh toán khi nhận hàng (COD)" như Mini) giữ | checkout.jpg, checkout.full.jpg |
| Chuyển khoản | 5ed3b659: tiêu đề "Quét QR để chuyển khoản" + phụ đề, thẻ QR riêng, dòng kẻ, nút sao chép biểu tượng, cảnh báo có biểu tượng, hạn thanh toán ngoài thẻ, nút "Tôi đã chuyển khoản — Kiểm tra", "Để sau / Xem đơn hàng" | "Lưu mã QR" ẩn ở điện thoại (chức năng riêng của web, Mini không có). Cỡ chữ số tiền hơi đậm hơn | bank-payment___code.jpg |
| Đơn hàng | 12c83c81: thẻ đơn nổi, thumb sage, "Mua lại" nút phụ, khung `max-w-5xl` (D7-28), nhãn "Giao thành công" ở mọi khổ; ef28b8a5: mã đơn gọn | Chân trang gọn như trên | orders.jpg |
| Đơn định kỳ | 12c83c81: thẻ/ảnh kiểu Mini, nút Sửa/Tạm dừng nền xanh nhạt, "Hủy" chữ đỏ (sửa lỗi chữ đen) | Cỡ chữ đoạn mô tả nhỏ hơn Mini một nấc | subscriptions.jpg |
| Chi tiết đơn | 8be5aab1, 5c295fd8: h1 "Chi tiết đơn hàng" + mã đơn phụ đề (mọi khổ), dải trạng thái nền theo trạng thái với mốc thời gian trên nhãn, hành trình bỏ bước chờ thanh toán cho COD/Ví, nhãn bước theo tên trạng thái Mini, sản phẩm một dòng "tên · phân loại ×SL", "Viết đánh giá" không gạch chân, khối tiền phẳng "Thanh toán <tên ngắn>" (dòng "Tình trạng" chỉ còn ở máy tính), nút thao tác dính đáy | Hộp "Đã quá hạn đổi/trả" nằm ngay dưới hành trình (Mini đặt dưới cùng, ngoài khung nhìn): đổi vị trí cần tách khỏi OrderActions, không làm. Dòng "Tình trạng thanh toán" ẩn ở điện thoại theo Mini, giữ ở máy tính (câu hỏi bên dưới) | order___code.jpg |
| Sổ địa chỉ | e077998e, ef28b8a5: thẻ mặc định viền xanh 1,5px không bóng, tên cỡ sm, Sửa xanh/Xóa đỏ không gạch chân, "Đặt mặc định", "Thêm địa chỉ mới" nút phụ có biểu tượng (bỏ "+") | Không | addresses.jpg |
| Giới thiệu | b3bb5cb2, ef28b8a5: hero chuyển màu nhỏ hơn, tiêu đề khối sans đậm, chip bo tròn một hàng cuộn ngang, email đen đậm, hotline xanh đậm, chính sách đậm, Xóa tài khoản/Đăng xuất kiểu Mini; sửa tràn ngang do chip | Mini không bật hộp chính sách trong trang (web dẫn sang /chinh-sach). Dòng "Tubu Tree Mini App · phiên bản" không thêm (chữ riêng của Mini) | about.jpg |
| Hub tài khoản | a0f32611, ef28b8a5: dải xanh chuyển màu tràn ngang, mã giới thiệu ở mép dưới, ba ô số liệu trắng nổi căn giữa ("1.800 điểm" ở mọi khổ), ẩn khối "Đơn hàng của tôi" ở điện thoại, hàng menu kiểu Mini | Phụ đề menu xuống dòng ít hơn do cỡ chữ hơi nhỏ hơn Mini | profile.jpg |
| Sửa hồ sơ | 154d25ce, ef28b8a5: TitleBand, ẩn khối số điện thoại ở điện thoại, ảnh giữ chỗ sage trống, ô nhập cao 50px, giãn dòng | Ô ngày sinh vẫn có biểu tượng lịch của trình duyệt | edit-profile.jpg |
| Cài đặt | 154d25ce: tiêu đề khối sans đậm, nhãn Cập nhật đơn hàng/Chỉnh sửa hồ sơ/Sổ địa chỉ semibold, Đăng xuất nền xanh nhạt, dòng "Tubu Tree · phiên bản 1.0.0" (mọi khổ) | Không | settings.jpg |
| Thông báo | 154d25ce: "Đọc tất cả" xanh không gạch chân trong dải tiêu đề, ô icon nền sage | Chữ thân hơi nhỏ hơn Mini | notifications.jpg |

## UAT lô 1
- D7-28: khung `/tai-khoan/don-hang` dùng `max-w-5xl` như các trang khác. Xong, test trong orders-mini.spec.tsx.
- D7-34: giỏ "Chọn tất cả" không đếm, nút "Thanh toán (n)" n = tổng số lượng như Mini. Xong, test cart-mini.spec.tsx.
- D7-33: hai bên đều đã khoá nút Đặt hàng khi báo giá trả ADDRESS_OUTDATED (API: checkout.service.ts:1033 gọi assertDeliverableAddress ngay ở bước báo giá; web: thanh-toan/page.tsx placeDisabled cần `quote`; Mini: checkout.tsx canPlace cần quote.isSuccess). Nút bật lúc UAT là do mock-api trả báo giá thành công, không phải lỗi web. Không đổi hành vi; test khoá ở checkout-mini.spec.tsx. Không còn câu hỏi.

## Câu hỏi và quyết định ghi lại
1. Dòng "Tình trạng" (trạng thái thanh toán) ở khối tiền chi tiết đơn: Mini không có. Web ẩn ở điện thoại (`max-md:hidden`), GIỮ ở máy tính cho tới khi chủ quyết (có thể bỏ hẳn vì thông tin hoàn tiền đã có ở khối Hoàn tiền).
2. Khối "Số điện thoại" ở Sửa hồ sơ chỉ ẩn ở điện thoại (Mini không có), máy tính giữ.
3. "Lưu mã QR" ẩn ở điện thoại. Mini App không có chức năng này.
4. Chân trang gọn ở điện thoại và StickyActionBar thuộc lane khác, không sửa.
5. Spec cũ đã đổi vì khoá chữ cũ: h1 'Đơn hàng #mã', bước 'Đã đặt hàng', 'Tình trạng', 'Phương thức', 'Chuyển khoản ngân hàng' ở khối tiền, '+ Thêm địa chỉ mới', 'Đặt làm mặc định', 'Bạn có N mã/Thêm mã' (CouponBox), 'Tổng cộng' ở thanh dính đáy, nhãn 'Đã giao' của đơn.
6. Trang giới thiệu: thêm test sau khi code (không đỏ trước) vì spec chỉ khoá lớp CSS; các màn còn lại viết test đỏ trước khi sửa.

## Review Opus (3 lượt)
- Lượt 1: 8 phát hiện (dòng "Tình trạng" thanh toán bị bỏ cả ở máy tính, ActionRow, thẻ mã ở thanh toán ghi số giảm của cả giỏ, hộp Hoàn tác của giỏ bị thanh dính che, dấu tick lệch ô, freeship của thanh dính…). Sửa ở c61936da, 903e02af, ef9296fa, 02502b50, b66940f5, b22d8174, b39e3f0d, 000ebd70, 68d0d53b.
- Lượt 2: cả 8 đã sửa đúng; thêm lỗi chuyển khoản báo "Đã sao chép" khi trình duyệt chặn clipboard. Sửa ở ef780fc9.
- Lượt 3: MAJOR spec e2e `account.web.spec.ts:75` đỏ ở project điện thoại vì khối SĐT ẩn dưới md (sửa be6983ae, spec rẽ nhánh theo khổ); MINOR lời báo không sao chép được chỉ có cho trình đọc màn hình (sửa 9a824103, test bank-mini.spec.tsx 11/11).
- Bước viết báo cáo của workflow bị ngắt lúc máy dừng phiên (00:17); báo cáo này do orchestrator viết bù từ journal.

## Kiểm tra cuối (tip 9a824103)
- Gate `gate-logs/mv-order/run4`: app-core 489, web vitest 378 file / 6355 test xanh cả `TZ=UTC`, typecheck, lint, lint-vars, lint-parity, `next build`, build Mini App xanh. Vitest Mini App trong gate đỏ 5 test do quá hạn 13–32 giây khi máy tải; chạy lại riêng 283 file / 4313 test xanh. Lane không sửa `apps/miniapp`, `apps/api`, `packages`.
- CHƯA kiểm chứng: e2e `account/order/web-checkout/web-customer.web.spec.ts` và ảnh chụp sau ba lượt sửa (lần chạy 07:40 ngày 2026-10-20 hỏng vì Colima không chuyển tiếp cổng cho container Postgres mới, P1001). Ảnh cuối hiện có: `mv-order-2` (trước các lượt sửa review).
