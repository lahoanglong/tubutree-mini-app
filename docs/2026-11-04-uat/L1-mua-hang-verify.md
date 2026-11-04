# Kiểm lại lane 1 (L1-mua-hang): reviewer đối kháng

- Ngày: 2026-11-04, khoảng 05:05 đến 05:25. Mã: worktree `uat-1104` (SHA 98803f006 = PROD). Lane 1 đang bật sẵn (API 3211, web 3212, Mini 3213), không bật lại.
- Cách làm: chạy lại đúng lệnh repro của từng FAIL, đọc mã ở chỗ nghi ngờ, so với AGENTS.md, `route-map.json`, luật "web 375 giống Mini cả chữ lẫn bố cục" (brief + chủ dặn). Không sửa mã ứng dụng, không push.
- Kết quả: 10/10 CONFIRMED. Hạ mức B05 và B06 từ P2 xuống P3. Sửa lại bằng chứng của B03 (web CÓ câu hạn), B07 (khoá repro sai) và B09 (path nghi ngờ sai).

| ID | Kết luận | Mức | Path:line thật | Ghi chú |
|---|---|---|---|---|
| B01 | CONFIRMED | P2 | apps/api/src/modules/cart/cart.service.ts:126 | Chạy lại: trước [rửa tay, serum, giặt], sau PATCH dòng đầu SL 2 thì [serum, rửa tay x2, giặt]. Thứ tự ngay cả trước khi sửa cũng khác thứ tự thêm vào (fillCart thêm giặt, rửa tay, serum). Lý do: `items: { include: … }` không có `orderBy`, và model `CartItem` (schema.prisma:1025) không có `createdAt`. Mini (`cart.tsx:223`) và web (`gio-hang/page.tsx:185`) chỉ nhóm theo nơi giao, giữ thứ tự API. |
| B02 | CONFIRMED | P2 | apps/web/src/app/tai-khoan/don-hang/page.tsx:134,141 + apps/web/src/components/mini/mini.css:423 | Chạy lại: scrollWidth=379/375, rail left=-4 right=379. Nguyên nhân: `.tubu-bleed-rail` lùi -1rem (16px) nhưng khung trang Đơn hàng ở điện thoại là `max-md:px-0` + `max-md:px-3` (12px), lệch 4px mỗi bên. |
| B03 | CONFIRMED (sửa bằng chứng) | P2 | apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:258-266 | Chạy lại: web CÓ câu hạn "Chuyển khoản trước 04:10 05/11/2026 — quá hạn đơn sẽ tự huỷ." nhưng nằm trong khung QR, chữ "Chuyển khoản trước" khác "Thanh toán trước" của Mini, và không nằm ở dải trạng thái. Phần lệch đúng: web nhúng cả `BankTransferPanel` (QR, ngân hàng, đếm ngược) trong chi tiết đơn; thanh dưới chỉ có "Huỷ đơn", không có "Thanh toán ngay" như Mini (`order-detail.tsx:779-791`). Không thấy dòng ngoại lệ nào trong `route-map.json` hay tài liệu parity. Không phải lỗi tiền. |
| B04 | CONFIRMED | P2 | apps/web/src/app/gio-hang/page.tsx:211-214, 298-301; apps/miniapp/src/i18n/vi.ts:238-241 | Lần chạy lệnh repro gốc: Mini đúng, web375 ra giỏ trống do bộ khung (setup dựng lại giỏ cho từng khổ, khổ thứ hai không thêm được hàng kho 0; đúng Hạn chế 7 của lane). Đã chụp lại riêng web375 bằng script tạm (dựng giỏ khi kho 220, rồi đặt kho 0, mở web, trả kho 220): "Hết hàng — hãy xoá khỏi giỏ…", thanh dưới "Có sản phẩm đã hết hàng hoặc vượt số lượng còn lại…", nút +/- chỉ còn ở dòng kính (dòng hết hàng ẩn). Ảnh `shots/L1-mua-hang/returning__cart-het-hang__web375.png` đã ghi lại đúng trạng thái. |
| B05 | CONFIRMED | P3 (hạ từ P2) | apps/miniapp/src/utils/checkout-rules.ts:126; apps/web/src/lib/checkout-points.ts:57 | Chạy lại: đúng hai câu như lane ghi. Số điểm, trần, tiền khớp, cùng nghĩa, chỉ khác chữ nên P3. |
| B06 | CONFIRMED | P3 (hạ từ P2) | apps/web/src/app/thanh-toan/page.tsx:449-466; apps/miniapp/src/pages/checkout.tsx:474-476 (chữ ở vi.ts:221-223) | Chạy lại: đúng như lane ghi. Trạng thái hiếm (vào /thanh-toan khi giỏ trống), có đủ lối thoát, nên P3. |
| B07 | CONFIRMED (khoá repro sai) | P3 | apps/miniapp/src/components/reviews-section.tsx:193; apps/web/src/app/san-pham/[slug]/product-reviews.tsx:185 | Lệnh repro `pdp-bienthe` KHÔNG tái hiện: returning đã mua SP này nên cả hai hiện "Viết đánh giá". Chữ lệch có ở `pdp-flash` và `pdp-hethang` (results/ui/returning/*), và mã xác nhận. |
| B08 | CONFIRMED | P3 | apps/miniapp/src/pages/product-detail.tsx:373; apps/web/src/app/san-pham/[slug]/page.tsx:66; apps/web/src/app/not-found.tsx:16 | Chạy lại: Mini "Không tìm thấy sản phẩm này." + "Về trang chủ" + "Cần hỗ trợ? Gọi 0984 606 774" + rail; web là trang 404 chung. |
| B09 | CONFIRMED (sửa path) | P3 | apps/web/src/components/catalog/browse-view.tsx:485-501 (không phải `tim-kiem/page.tsx`: thư mục này không tồn tại) | Chạy lại và xem ảnh: chữ giống; web là thẻ viền bo + bóng, tiêu đề `font-display` (serif), biểu tượng trong vòng tròn; Mini dùng `EmptyState` (`browse.tsx:389`) không thẻ. Chân trang web là chân trang chung của site, không tính. |
| B10 | CONFIRMED | P3 | apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx:203-236 (nút đổi/trả trong thanh) và :143 (khung huỷ trong trang); apps/miniapp/src/pages/order-detail.tsx:736-748 (đổi/trả là nút ghost trong trang), :766 (StickyActionBar), :817 (Sheet huỷ) | Chạy lại: web 375 có "Mua lại đơn này" và "Yêu cầu đổi/trả" trong thanh dưới; Mini thanh chỉ "Mua lại đơn này". Comment web ở `order-actions.tsx:313-315` ghi Mini có cả "Yêu cầu đổi trả" trong thanh, sai so với mã Mini. |

## Đề xuất sửa

- B01: thêm thứ tự ổn định cho dòng giỏ: `items: { orderBy: { id: 'asc' }, include: … }` (cuid tăng theo thời gian tạo), hoặc thêm cột `createdAt` cho `CartItem` (migration) rồi `orderBy: { createdAt: 'asc' }`. Kèm spec: PATCH một dòng không đổi thứ tự GET /cart.
- B02: ở `don-hang/page.tsx` bọc `<PurchasedRail />` trong khung đệm `max-md:px-4` (hoặc đổi `max-md:px-3` thành `max-md:px-4`), để lề âm -1rem khớp đệm. Thêm kiểm `scrollWidth <= clientWidth` ở 375 cho trang này.
- B03: theo Mini: dải trạng thái có "Thanh toán trước … — quá hạn đơn sẽ tự huỷ.", thanh dưới "Huỷ đơn | Thanh toán ngay" dẫn tới `/thanh-toan/chuyen-khoan/:code`; chỉ giữ QR nhúng ở md trở lên nếu muốn.
- B04: web dùng chung chữ với Mini (`outOfStock`, `outOfStockBlocked(names)`, `overStockBlocked`) qua app-core; màu cảnh báo vàng và giữ nút +/- như Mini.
- B05: chuyển câu "điểm bị giữ" vào app-core một nguồn cho hai nền (chọn một câu), sửa `checkout-points.spec.ts` theo.
- B06: web dùng `EmptyState` với `vi.cart.emptyHeading/emptyBody/emptyCta` của Mini (chuyển chữ vào app-core).
- B07: thống nhất một chữ (gợi ý "Mua và nhận hàng để đánh giá"), đặt ở app-core.
- B08: thêm `apps/web/src/app/san-pham/[slug]/not-found.tsx` giống Mini (ErrorState "Không tìm thấy sản phẩm này." + Về trang chủ + hỗ trợ + rail gợi ý), vẫn giữ mã HTTP 404.
- B09: `EmptyResults` của web dùng `EmptyState` trong `components/mini` (đã có, `not-found.tsx` đang dùng) với `art="search"`.
- B10: web 375 đưa "Yêu cầu đổi/trả" thành nút ghost trong trang như Mini, thanh dưới chỉ một nút; hộp huỷ dùng primitive `Sheet` (đáy ở điện thoại) như thiết kế parity `01-thiet-ke.md:95`. Sửa comment `order-actions.tsx:313-315`.

## Ghi chú cho bộ khung

- `U1-capture.mjs` dựng lại giỏ cho từng khổ; với `cart-het-hang` khổ thứ hai trở đi luôn ra giỏ trống vì kho đã 0 trước khi thêm. Nên đặt kho về 220 đầu mỗi `setup` rồi mới đặt 0 sau `fillCart` (như script tạm của reviewer).
- Bộ lọc khoá của `U1-capture.mjs` dùng `includes`, nên `checkout` chạy cả `checkout-diem` và `checkout-trong`.
- Lần chạy lại của reviewer đã ghi đè `results/ui/returning/{order-cho-ck,cart-het-hang,checkout,checkout-diem,checkout-trong,pdp-bienthe,pdp-khongco,search-rong,order-da-giao}/*.json` và ảnh tương ứng bằng bản 05:1x; nội dung trùng bản của lane, trừ `cart-het-hang/web375.json` (bản lỗi bộ khung, xem B04; ảnh web375 đã chụp lại đúng).
- Lane 1 đã tắt bằng `lane-down.sh 1` (không `--drop`).
