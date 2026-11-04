
## Kết luận ngắn

- Tiền, điểm, ví, mã giảm giá, tồn kho: không tìm thấy lỗi. Mọi đơn (64 đơn tại cuối phiên) khớp số học; sổ điểm và ví khớp số dư; `reconcile-points.ts` và `reconcile-wallet.ts` báo 0 lệch.
- Hành trình mua chính chạy được trên cả Mini 375, web 375 và web 1280: thêm giỏ, sửa số lượng, xoá, mua một phần, mã giảm giá, điểm, COD, chuyển khoản + webhook ngân hàng, huỷ đơn, mua lại.
- Có 10 lỗi, đều mức P2 hoặc P3: 1 lỗi giao diện/API ở giỏ (dòng nhảy vị trí khi sửa số lượng), 1 lỗi tràn ngang web 375, còn lại là lệch chữ và bố cục giữa Mini và web 375. Không có lỗi P0/P1.

## Lỗi

### L1-mua-hang-B01. P2. Sửa số lượng một dòng giỏ làm dòng đó nhảy xuống cuối giỏ

- Khổ: api (hiện ở Mini 375 và web 375, cùng một nguồn).
- Nghi ngờ: `apps/api/src/modules/cart/cart.service.ts:126` (`priceCart` đọc `items` bằng `include` không có `orderBy`, thứ tự dòng là thứ tự vật lý của Postgres; mỗi lần UPDATE dòng đó chuyển xuống cuối).
- Tái hiện: giỏ có 3 dòng [nước giặt, nước rửa tay, serum]; bấm "+" ở dòng đầu (hoặc `PATCH /cart/items/:id`); đọc lại giỏ thì thứ tự thành [nước rửa tay, serum, nước giặt]. Trên màn, dòng vừa bấm trượt xuống cuối, dòng bên dưới nhảy lên đúng chỗ ngón tay, nên bấm "+" lần hai dễ cộng nhầm sang sản phẩm khác.
- Script: `B-cart-order-repro.mjs` (in thứ tự trước và sau). Ảnh: `shots/L1-mua-hang/U3-mini375-J1-03-tang.png` (dòng nước giặt SL 3 nằm cuối), `U3-web375-J1-03-tang.png`.
- Kỳ vọng: thứ tự dòng ổn định khi sửa số lượng. Không có luật ghi riêng; lỗi tính theo hành vi rõ ràng sai về trải nghiệm.

### L1-mua-hang-B02. P2. Web 375 Đơn hàng cuộn ngang được (379 > 375)

- Khổ: web375.
- Nghi ngờ: `apps/web/src/components/mini/mini.css:423` (`.tubu-bleed-rail` lùi lề âm -1rem) cùng nơi dùng ở `apps/web/src/app/tai-khoan/don-hang/page.tsx:134` (`<PurchasedRail />` ở tab "Tất cả"); phần tử `div.scroll-x.tubu-scroll-fade.tubu-bleed-rail` đo được left=-4, right=379. Mini cùng màn không tràn (375/375).
- Tái hiện: đăng nhập persona `returning`, mở `/tai-khoan/don-hang` ở khổ 375, đọc `document.documentElement.scrollWidth` = 379.
- Script: `U4-rules.mjs overflow` (ghi `U4-orders-overflow-web375`); `U1-capture.mjs returning order orders` ghi `scrollW=379/375` trong `results/ui/returning/orders/web375.json`. Ảnh: `shots/L1-mua-hang/returning__orders__web375.png`.
- Kỳ vọng: web 375 không cuộn ngang (brief: web 375 giống Mini cả bố cục).

### L1-mua-hang-B03. P2. Chi tiết đơn chờ chuyển khoản: web 375 khác Mini về khối, chữ và thanh nút

- Khổ: web375 so với Mini 375.
- Mini: dải "Chờ thanh toán / Thanh toán trước 04:10 05/11/2026 — quá hạn đơn sẽ tự huỷ.", rồi "Hành trình đơn hàng", sản phẩm, tiền; thanh nút dưới "Huỷ đơn | Thanh toán ngay" (QR nằm ở màn `/bank-payment`).
- Web: dải trạng thái không có câu hạn; thêm hộp "Đơn đang chờ bạn chuyển khoản. Quét mã bên dưới để thanh toán, hệ thống tự xác nhận khi nhận được tiền." rồi QR VietQR, ngân hàng, số tài khoản, nội dung CK ngay trong trang; thanh nút dưới chỉ có "Huỷ đơn".
- Nghi ngờ: `apps/web/src/app/tai-khoan/don-hang/[code]/page.tsx:265` (chèn `BankTransferPanel` trong chi tiết đơn) so với `apps/miniapp/src/pages/order-detail.tsx` (nút "Thanh toán ngay").
- Tái hiện: `U1-capture.mjs returning order order-cho-ck`. Ảnh: `shots/L1-mua-hang/returning__order-cho-ck__mini375.png`, `returning__order-cho-ck__web375.png`.
- Không phải lỗi tiền: màn `/bank-payment` hai nền giống nhau từng dòng (U1-21).

### L1-mua-hang-B04. P2. Giỏ có dòng hết hàng: chữ và bố cục khác nhau

- Khổ: web375 so với Mini 375.
- Mini: dòng ghi "Sản phẩm đã hết hàng" (màu vàng, còn nút +/−); thanh dưới ghi `"Gạo lứt huyết rồng Sokfram" đã hết hàng. Bỏ chọn hoặc xoá sản phẩm này để thanh toán.`
- Web: dòng ghi "Hết hàng — hãy xoá khỏi giỏ hoặc bỏ chọn để thanh toán các món còn lại" (màu đỏ, ẩn nút +/−, viền đỏ quanh nút xoá); thanh dưới ghi "Có sản phẩm đã hết hàng hoặc vượt số lượng còn lại. Hãy xoá, giảm số lượng hoặc bỏ chọn rồi thanh toán."
- Cả hai đều khoá nút "Thanh toán", tạm tính chỉ tính hàng còn (79.000đ): phần tiền đúng.
- Nghi ngờ: `apps/web/src/app/gio-hang/page.tsx:213` và `:298`; `apps/miniapp/src/i18n/vi.ts:238` và `:241`.
- Tái hiện: `U1-capture.mjs returning cart cart-het-hang`. Ảnh: `shots/L1-mua-hang/returning__cart-het-hang__mini375.png`, `returning__cart-het-hang__web375.png`.

### L1-mua-hang-B05. P2. Thanh toán: câu điểm Xanh bị giữ khác chữ giữa Mini và web 375

- Mini: "28.992 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được". Web: "28.992 điểm từ đơn mới giao chưa dùng được vì còn trong hạn hoặc đang chờ xử lý đổi/trả; sẽ dùng được khi hết hạn đổi/trả".
- Số điểm, trần 20% (53.820 điểm trên 269.100đ) và mọi số tiền khớp.
- Nghi ngờ: `apps/miniapp/src/utils/checkout-rules.ts:126`; `apps/web/src/lib/checkout-points.ts:57` (web đã khoá bằng spec riêng `checkout-points.spec.ts`, nên hai bên không cùng nguồn chữ).
- Tái hiện: `U1-capture.mjs returning cart checkout`. Ảnh: `shots/L1-mua-hang/returning__checkout__mini375.png`, `returning__checkout__web375.png`.

### L1-mua-hang-B06. P2. Thanh toán khi giỏ trống: chữ và nút khác nhau

- Mini: "Giỏ còn trống đấy / Khám phá sản phẩm Tubu chọn riêng cho bạn / Khám phá ngay". Web: "Giỏ hàng đang trống / Chưa có sản phẩm nào để thanh toán. Chọn vài món xanh rồi quay lại nhé." với hai nút "Khám phá sản phẩm" và "Đơn của tôi". (Màn Giỏ trống của hai nền giống nhau.)
- Nghi ngờ: `apps/web/src/app/thanh-toan/page.tsx:454`; `apps/miniapp/src/i18n/vi.ts:221`.
- Tái hiện: `U1-capture.mjs returning cart checkout-trong`. Ảnh: `shots/L1-mua-hang/returning__checkout-trong__mini375.png`, `returning__checkout-trong__web375.png`.

### L1-mua-hang-B07. P3. Chữ "Mua & nhận hàng để đánh giá" (Mini) khác "Mua và nhận hàng để đánh giá" (web)

- Nghi ngờ: `apps/miniapp/src/components/reviews-section.tsx:193`; `apps/web/src/app/san-pham/[slug]/product-reviews.tsx:185`.
- Tái hiện: `U2-compare.mjs returning pdp-flash` (mục "chỉ Mini" và "chỉ web375"); xuất hiện ở mọi PDP khách chưa mua.

### L1-mua-hang-B08. P3. PDP không tồn tại: trạng thái lỗi khác nhau

- Mini: "Không tìm thấy sản phẩm này." + "Về trang chủ" + "Cần hỗ trợ? Gọi 0984 606 774" + rail "Có thể bạn thích". Web: trang 404 chung "Trang này lạc vào vườn rồi / Có thể liên kết đã cũ hoặc trang không tồn tại…".
- Nghi ngờ: `apps/miniapp/src/pages/product-detail.tsx:373`; `apps/web/src/app/san-pham/[slug]/page.tsx:66` (`notFound()`) và `apps/web/src/app/not-found.tsx:16`.
- Tái hiện: `U1-capture.mjs returning pub pdp-khongco`. Ảnh: `shots/L1-mua-hang/returning__pdp-khongco__mini375.png`, `returning__pdp-khongco__web375.png`.

### L1-mua-hang-B09. P3. Tìm kiếm không kết quả: kiểu trạng thái trống khác nhau

- Chữ giống nhau. Web đặt trạng thái trong thẻ viền bo, tiêu đề chữ serif, biểu tượng trong vòng tròn, kèm chân trang; Mini không thẻ, biểu tượng kính lúp lớn.
- Tái hiện: `U1-capture.mjs returning pub search-rong`. Ảnh: `shots/L1-mua-hang/returning__search-rong__mini375.png`, `returning__search-rong__web375.png`.

### L1-mua-hang-B10. P3. Chi tiết đơn: thanh nút và hộp huỷ đơn khác bố cục

- Đơn đã giao: web có thanh dưới hai nút "Mua lại đơn này | Yêu cầu đổi/trả"; Mini thanh một nút "Mua lại đơn này", "Yêu cầu đổi/trả" nằm trong trang.
- Huỷ đơn chờ thanh toán: cùng chữ cảnh báo và cùng năm lý do; Mini hiện bảng trượt từ dưới ("Giữ đơn / Huỷ đơn"), web hiện khung đỏ trong trang với nút chọn tròn.
- Nghi ngờ: `apps/web/src/app/tai-khoan/don-hang/[code]/order-actions.tsx`, `cancel-reason-picker.tsx`; `apps/miniapp/src/pages/order-detail.tsx`.
- Tái hiện: `U1-capture.mjs returning order order-da-giao`; `U3-journeys.mjs mini375 J4` và `web375 J4` (chụp hộp huỷ). Ảnh: `shots/L1-mua-hang/returning__order-da-giao__mini375.png`, `returning__order-da-giao__web375.png`, `U3-mini375-J4-02-hop-huy.png`, `U3-web375-J4-02-hop-huy.png`.

## Hạn chế bộ khung (không tính FAIL)

1. Chỉ báo "N" của `next dev` hiện đè góc trái dưới ở mọi ảnh web (che một phần nút hoặc chữ ở cạnh trái). Không phải lỗi sản phẩm.
2. Ảnh sản phẩm là hình lá giữ chỗ vì DB lane không có ảnh thật; không đánh giá ảnh sản phẩm.
3. Mini cuộn trong một khung bên trong, ảnh toàn trang không đáng tin; chụp theo từng màn hình cuộn (`__p2`, `__p3`) và cuộn tự động để các khối tải lười hiện đủ trước khi rút chữ. Lần chụp đầu thiếu cuộn tự động nên báo sai tiền ở Trang chủ và PDP; đã chụp lại.
4. `seed-data.mjs ... all` lỗi ở bước `extra` (cờ tính năng rác tắt nên `/waste/items` trả 403): không liên quan mua hàng.
5. Giờ vàng của mẫu DB đã hết hạn (endAt 2026-11-03T07:58Z); phiên này làm mới bằng SQL ở phần dựng của A2. Mã UATEXP, UATFUT, UATOFF, UATLIM1, UATBIG, UATX10 do script A2 tạo qua API admin để kiểm các trạng thái mã.
6. Mã UATBIG (giảm 500.000đ) tự áp tốt nhất làm che ca mã khác ở màn Thanh toán; đã tắt UATBIG và UATLIM1 sau khi chụp lần đầu rồi chụp lại các màn Thanh toán.
7. `cart-het-hang` của persona `new` chụp sai vì lần dựng giỏ thứ hai không thêm được dòng khi kho đã đặt 0; dữ liệu `returning` (đã chụp đúng) dùng làm bằng chứng.
8. Oracle của A1 ban đầu kỳ vọng `usedCount` +1 cho mọi mã; luật thật chỉ tăng khi mã có `usageLimit` (`coupons.service.ts:361`, `admin.service.ts:1707`). Bốn ca chấm sai đã chấm lại bằng SQL (`A1b-recheck.mjs`). Một số ca U3 ban đầu lỗi do script (không biết "Thêm vào giỏ" mở bảng phân loại, nút "Thanh toán" ẩn bản desktop, hộp huỷ bắt chọn lý do, "Mua lại" mở bảng); đã sửa script và chạy lại, các dòng lỗi cũ đã xoá khỏi kết quả.
9. Web 375 chạy bằng giả lập di động của Chromium, không phải WebView Zalo thật; Mini chạy bản Vite với `zmp-sdk` giả (login, SĐT, mở ứng dụng ngoài). Không kiểm được cổng thanh toán và thông báo Zalo thật.
10. Pancake là bản giả của harness: ca đồng bộ trạng thái chỉ chứng minh luật phía Tubu Tree, không chứng minh hệ thống Pancake thật.

## CẦN CHỦ (không tính FAIL)

1. Đặt định kỳ: web 375 hiện khối "Đặt định kỳ — tiết kiệm 12%" ở PDP và tab "Định kỳ" ở Đơn hàng; Mini ẩn (`packages/app-core/src/features.ts:16`, `SUBSCRIPTIONS_IN_MINIAPP = false`, ghi "chủ chốt tạm ẩn đợt đầu (28/10), web giữ nguyên"). Luật "web 375 giống Mini" và dòng này mâu thuẫn; cần chủ chốt có để web 375 giữ khác.
2. Giờ vàng vượt suất mỗi khách (A2-12, A2-14): giỏ sửa lên 3 hoặc đã mua đủ 2 thì API không chặn mà tính giá thường kèm câu "Giá Giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn…" hoặc "Bạn đã dùng hết suất Giờ vàng của sản phẩm này…"; đơn vẫn đặt được. Cần chủ xác nhận đây là ý muốn (khách vẫn mua được ở giá thường).
3. Chuyển thừa tiền (A3-04b): đơn PAID, tạo khoản hoàn OVERPAYMENT 50.000đ ở trạng thái UNVERIFIED, khách chưa thấy khoản này ở chi tiết đơn cho tới khi Kế toán đối soát. Cần chủ xác nhận khách không cần thấy ngay.
4. Tìm "toi" (không dấu) không ra sản phẩm có chữ "tôi" (A4-08). Luật tìm không dấu của sản phẩm đã chạy cho các từ khác ("rua chen" khớp "rửa chén"). Chưa rõ có sản phẩm nào chứa "tôi" cần khớp hay không.
5. Khách vãng lai: Mini tự tạo tài khoản vãng lai, vào giỏ/thanh toán được (giỏ trống, đơn trống); web 375 buộc "Đăng nhập với Zalo" ở giỏ, thanh toán và đơn. Chưa có luật nói web có cho khách vãng lai mua hay không.
6. Hộp chat PDP: Mini vãng lai thấy "Chat với Tubu Tree", web thấy "Đăng nhập để chat với Tubu Tree".
7. Chữ "Đang chờ thanh toán…" (ở `/bank-payment` và chi tiết đơn web) dùng dấu "…". Luật giọng đợt 8 cấm "..." trong lời API; chưa rõ có áp cho chữ giao diện không.
8. Bong bóng gợi ý "Trồng cây mỗi ngày, nhận quà thật" (trên tab Vườn Xanh) che một phần nội dung cuối màn (ví dụ chân trang web, tiêu đề "Mua lại" ở Mini home) ở cả hai nền trong ảnh chụp 3 giây đầu. Chưa rõ thời gian tự ẩn.

## Phạm vi đã làm và chưa làm

Đã làm: toàn bộ danh sách A1 đến A4, B, U1 đến U4, R1 ở bảng dưới. Các luật tiền kiểm bằng oracle và SQL: phí giao (ngưỡng chung 199.000đ, ngưỡng hạng, freeship đơn đầu), thứ tự mã trước hạng trước điểm, trần điểm 20% và điểm bị giữ, WELCOME30 chỉ khách mới có Zalo, FREESHIP, XANH10 (trần 50.000đ, tối thiểu 250.000đ, tối đa 2 lượt), mã hết hạn/chưa tới/đã tắt/hết lượt, giờ vàng (giới hạn mỗi khách, hết suất, hết giờ), tồn kho, chống đặt trùng, chặn dùng điểm/địa chỉ không hợp lệ, chuyển khoản đủ/thiếu/thừa/trùng/sai nội dung/quá hạn, huỷ ở từng trạng thái, mua lại, danh sách đơn.

Chưa làm (hết thời gian hoặc không có tích hợp):
- Đặt đơn bằng Điểm Xanh qua giao diện: chỉ kiểm bằng API (A1-05, A1-06, A2-16, A3-01) và ở màn Thanh toán (U1-13); chưa bấm công tắc điểm trên giao diện rồi đặt.
- Bấm "Chọn mã" trong giỏ ở Mini và web rồi áp từng mã (WELCOME30, FREESHIP, XANH10, mã sai, mã hết hạn) qua giao diện: giao diện chỉ kiểm mã sai (J3-03) và mã tự áp; lời báo của từng lỗi mã kiểm ở API (A1, A2).
- Đặt đơn chuyển khoản có điểm qua giao diện, webhook thiếu/thừa/trùng qua giao diện (chỉ API).
- Xuất hoá đơn VAT, mã người giới thiệu, địa chỉ mới ngay trong Thanh toán.
- A4-17 (SP ngừng bán/chưa duyệt không lộ): DB lane không có SP ở trạng thái đó để thử.
- Ví Tubu (thanh toán bằng ví): ngoài phạm vi lane 1 (Mini ẩn rút tiền; không có ca ví ở danh sách mua hàng).
- Thanh toán thật qua cổng, thông báo Zalo, đồng bộ Pancake thật: không có tích hợp (BLOCKED, ghi ở Hạn chế 9 và 10).
