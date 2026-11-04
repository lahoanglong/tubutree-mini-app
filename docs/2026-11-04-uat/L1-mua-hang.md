# UAT lane 1: hành trình mua hàng (L1-mua-hang)

- Mã kiểm thử: SHA 98803f006 (cùng PROD), worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104`. Không sửa mã ứng dụng, không đụng PROD.
- Lane 1: API 3211, web 3212, Mini 3213, Pancake giả 3218; DB `tubutree_uat_l1` (267/267 migration), Redis db 1.
- Ngày chạy: 2026-11-04, từ 03:56 đến khoảng 05:15.
- Persona: `new` (khách Zalo mới, có SĐT), `new_nophone` (Zalo, chưa SĐT), `returning` (Lộc Biếc, 82.992 điểm), `guest` (vãng lai), thêm `noaddr` (chưa có địa chỉ). Ca cần khách sạch lịch sử (mã WELCOME30, đơn đầu) dùng khách tạo mới `uat_<tag>` bằng hàm `fresh` trong `kit.mjs`.
- Khổ: Mini 375x812, web 375x812, web 1280x800 (Playwright, một trình duyệt mỗi lần).
- Script (chạy lại được): `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/`. Ảnh: `.../shots/L1-mua-hang/`. Số liệu thô: `.../scripts/L1-mua-hang/results/`.
- Cách chạy một ca: `cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104 && export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH && node <script>`. Báo cáo này được dựng lại bằng `R2-report.mjs` từ `results/*.jsonl` (lấy dòng mới nhất của mỗi ID).

## Cách kiểm
1. A1 đến A4 (API): báo giá và đặt đơn COD so với mô hình tính độc lập (oracle trong `kit.mjs`, đọc luật ở `pricing.service.ts`, `checkout.service.ts`, `coupons.service.ts`, `cart.service.ts` và `SystemConfig` của DB lane), kèm đối soát SQL từng đơn (tổng dòng, giảm, phí giao, lượt dùng mã, tồn kho, sổ điểm, ví).
2. U1/U2 (giao diện): chụp và rút chữ mỗi màn trên ba khổ cho từng persona, so Mini 375 với web 375 (chữ, tiền, thứ tự khối), mở từng ảnh quan trọng để xác nhận.
3. U3 (bấm tay): thêm giỏ, tăng giảm, xoá, mua một phần, đặt COD, đặt chuyển khoản, webhook ngân hàng, mã sai, huỷ đơn, mua lại, trên Mini 375 và web 375 (web 1280 cho hành trình giỏ và COD).
4. U4: thanh đáy Mini 5 tab, không link ra ngoài, thứ tự khối Trang chủ lần mở thứ hai, tràn ngang.
5. R1: đối soát SQL toàn DB sau mọi ca và chạy `apps/api/scripts/reconcile-points.ts`, `reconcile-wallet.ts`.

## Tổng kết số ca

Tổng 195 ca: PASS 179, FAIL 10, BLOCKED 0, CẦN CHỦ 6 (CẦN CHỦ không tính FAIL).

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

## Bảng ca

### Nhóm A1. Báo giá và đặt đơn COD (API) so với oracle luật + SQL

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| A1-01-quote | returning | api | báo giá | giỏ 709.000đ (2 nước giặt + serum), không mã | {"subtotal":709000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":709000,"pointsEarned":17016} | {"subtotal":709000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":709000,"pointsEarned":17016} | facts={"tier":"LOC_BIEC","bal":35400,"prior":2,"real":true} couponNotice=null | PASS |
| A1-01-place | returning | api | đặt đơn COD | giỏ 709.000đ (2 nước giặt + serum), không mã | {"subtotal":709000,"discount":0,"shippingFee":0,"total":709000,"pointsEarned":17016,"pointsUsed":0} | {"subtotal":709000,"discount":0,"shippingFee":0,"total":709000,"pointsEarned":17016,"pointsUsed":0} | đơn TUBU2026110364131 CONFIRMED/UNPAID; balance 35400→35400; sổ 35400→35400; khớp SQL | PASS |
| A1-02-quote | returning | api | báo giá | giỏ 79.000đ dưới ngưỡng 99.000 của hạng: phí giao 19.000 | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":98000,"pointsEarned":1896} | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":98000,"pointsEarned":1896} | facts={"tier":"LOC_BIEC","bal":35400,"prior":3,"real":true} couponNotice=null | PASS |
| A1-02-place | returning | api | đặt đơn COD | giỏ 79.000đ dưới ngưỡng 99.000 của hạng: phí giao 19.000 | {"subtotal":79000,"discount":0,"shippingFee":19000,"total":98000,"pointsEarned":1896,"pointsUsed":0} | {"subtotal":79000,"discount":0,"shippingFee":19000,"total":98000,"pointsEarned":1896,"pointsUsed":0} | đơn TUBU2026110334408 CONFIRMED/UNPAID; balance 35400→35400; sổ 35400→35400; khớp SQL | PASS |
| A1-03-quote | returning | api | báo giá | giỏ đúng 99.000đ (ngưỡng hạng): miễn phí giao | {"subtotal":99000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":99000,"pointsEarned":2376} | {"subtotal":99000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":99000,"pointsEarned":2376} | facts={"tier":"LOC_BIEC","bal":35400,"prior":4,"real":true} couponNotice=null | PASS |
| A1-04-quote | returning | api | báo giá | giỏ 89.000đ (dưới 99.000): phí giao 19.000 | {"subtotal":89000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":108000,"pointsEarned":2136} | {"subtotal":89000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":108000,"pointsEarned":2136} | facts={"tier":"LOC_BIEC","bal":35400,"prior":4,"real":true} couponNotice=null | PASS |
| A1-05-quote | returning | api | báo giá | dùng điểm vượt trần 20%: giỏ 79.000đ, xin 35.400 điểm | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":15800,"total":82200,"pointsEarned":1516} | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":15800,"total":82200,"pointsEarned":1516} | facts={"tier":"LOC_BIEC","bal":35400,"prior":4,"real":true} couponNotice=null | PASS |
| A1-05-place | returning | api | đặt đơn COD | dùng điểm vượt trần 20%: giỏ 79.000đ, xin 35.400 điểm | {"subtotal":79000,"discount":15800,"shippingFee":19000,"total":82200,"pointsEarned":1516,"pointsUsed":15800} | {"subtotal":79000,"discount":15800,"shippingFee":19000,"total":82200,"pointsEarned":1516,"pointsUsed":15800} | đơn TUBU2026110374096 CONFIRMED/UNPAID; balance 35400→19600; sổ 35400→19600; khớp SQL | PASS |
| A1-06-quote | returning | api | báo giá | dùng điểm dưới trần: giỏ 709.000đ, xin 10.000 điểm | {"subtotal":709000,"discount":0,"shippingFee":0,"pointsUsed":10000,"total":699000,"pointsEarned":16776} | {"subtotal":709000,"discount":0,"shippingFee":0,"pointsUsed":10000,"total":699000,"pointsEarned":16776} | facts={"tier":"LOC_BIEC","bal":19600,"prior":5,"real":true} couponNotice=null | PASS |
| A1-06-place | returning | api | đặt đơn COD | dùng điểm dưới trần: giỏ 709.000đ, xin 10.000 điểm | {"subtotal":709000,"discount":10000,"shippingFee":0,"total":699000,"pointsEarned":16776,"pointsUsed":10000} | {"subtotal":709000,"discount":10000,"shippingFee":0,"total":699000,"pointsEarned":16776,"pointsUsed":10000} | đơn TUBU2026110315902 CONFIRMED/UNPAID; balance 19600→9600; sổ 19600→9600; khớp SQL | PASS |
| A1-07-quote | returning | api | báo giá | XANH10 trên giỏ 709.000đ: 10% bị chặn trần 50.000đ | {"subtotal":709000,"discount":50000,"shippingFee":0,"pointsUsed":0,"total":659000,"pointsEarned":15816} | {"subtotal":709000,"discount":50000,"shippingFee":0,"pointsUsed":0,"total":659000,"pointsEarned":15816} | facts={"tier":"LOC_BIEC","bal":9600,"prior":6,"real":true} couponNotice=null | PASS |
| A1-07-place | returning | api | đặt đơn COD | XANH10 trên giỏ 709.000đ: 10% bị chặn trần 50.000đ | {"subtotal":709000,"discount":50000,"shippingFee":0,"total":659000,"pointsEarned":15816,"pointsUsed":0} | {"subtotal":709000,"discount":50000,"shippingFee":0,"total":659000,"pointsEarned":15816,"pointsUsed":0} | chấm lại bằng SQL: đơn TUBU2026110301411 số học khớp=true; coupon_redemptions=1; mã XANH10 usageLimit=null usedCount=0. usedCount chỉ tăng khi mã có usageLimit (coupons.service.ts:361), nên +0 đúng lu | PASS |
| A1-08-quote | returning | api | báo giá | XANH10 + điểm: giỏ 300.000đ (210.000 + 89.000 + 1.000?), mã trước điểm sau | {"subtotal":299000,"discount":29900,"shippingFee":0,"pointsUsed":9600,"total":259500,"pointsEarned":6228} | {"subtotal":299000,"discount":29900,"shippingFee":0,"pointsUsed":9600,"total":259500,"pointsEarned":6228} | facts={"tier":"LOC_BIEC","bal":9600,"prior":7,"real":true} couponNotice=null | PASS |
| A1-09 | returning | api | mã giảm giá | WELCOME30 với khách đã có đơn: bị từ chối | 400 "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree." (coupons.service.ts) | 400 "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree." | {"oracleReject":"NEW_ONLY"} | PASS |
| A1-10 | returning | api | mã giảm giá | XANH10 dưới đơn tối thiểu 250.000đ | 400 "Đơn tối thiểu 250.000đ để dùng mã này." (coupons.service.ts) | 400 "Đơn tối thiểu 250.000đ để dùng mã này." | {"oracleReject":"MIN:250000"} | PASS |
| A1-11-quote | returning | api | báo giá | FREESHIP với giỏ đã miễn phí giao theo hạng | {"subtotal":210000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":210000,"pointsEarned":5040} | {"subtotal":210000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":210000,"pointsEarned":5040} | facts={"tier":"LOC_BIEC","bal":9600,"prior":7,"real":true} couponNotice=Mã chưa được áp dụng cho đơn này: Đơn từ 99.000đ đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau. | PASS |
| A1-12 | returning | api | mã giảm giá | FREESHIP dưới đơn tối thiểu 99.000đ | 400 "Đơn tối thiểu 99.000đ để dùng mã này." (coupons.service.ts) | 400 "Đơn tối thiểu 99.000đ để dùng mã này." | {"oracleReject":"MIN:99000"} | PASS |
| A1-13 | returning | api | mã giảm giá | mã không tồn tại | 400 "Mã giảm giá không tồn tại." (coupons.service.ts) | 400 "Mã giảm giá không tồn tại." | {"oracleReject":null} | PASS |
| A1-20-quote | new | api | báo giá | giỏ 120.000đ: dưới 199.000, phí giao 19.000 | {"subtotal":120000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":139000,"pointsEarned":2400} | {"subtotal":120000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":139000,"pointsEarned":2400} | facts={"tier":null,"bal":0,"prior":0,"real":true} couponNotice=null | PASS |
| A1-21-quote | new | api | báo giá | giỏ đúng 199.000đ: miễn phí giao đơn đầu, WELCOME30 đúng ngưỡng | {"subtotal":199000,"discount":30000,"shippingFee":0,"pointsUsed":0,"total":169000,"pointsEarned":3380} | {"subtotal":199000,"discount":30000,"shippingFee":0,"pointsUsed":0,"total":169000,"pointsEarned":3380} | facts={"tier":null,"bal":0,"prior":0,"real":true} couponNotice=null | PASS |
| A1-21-place | new | api | đặt đơn COD | giỏ đúng 199.000đ: miễn phí giao đơn đầu, WELCOME30 đúng ngưỡng | {"subtotal":199000,"discount":30000,"shippingFee":0,"total":169000,"pointsEarned":3380,"pointsUsed":0} | {"subtotal":199000,"discount":30000,"shippingFee":0,"total":169000,"pointsEarned":3380,"pointsUsed":0} | chấm lại bằng SQL: đơn TUBU2026110334461 số học khớp=true; coupon_redemptions=1; mã WELCOME30 usageLimit=null usedCount=0. usedCount chỉ tăng khi mã có usageLimit (coupons.service.ts:361), nên +0 đúng | PASS |
| A1-22 | new | api | mã giảm giá | WELCOME30 sau khi đã có đơn: bị từ chối | 400 "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree." (coupons.service.ts) | 400 "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree." | {"oracleReject":"NEW_ONLY"} | PASS |
| A1-23-quote | new | api | báo giá | FREESHIP giỏ 120.000đ: miễn 19.000 phí giao | {"subtotal":120000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":120000,"pointsEarned":2400} | {"subtotal":120000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":120000,"pointsEarned":2400} | facts={"tier":null,"bal":0,"prior":1,"real":true} couponNotice=null | PASS |
| A1-23-place | new | api | đặt đơn COD | FREESHIP giỏ 120.000đ: miễn 19.000 phí giao | {"subtotal":120000,"discount":0,"shippingFee":0,"total":120000,"pointsEarned":2400,"pointsUsed":0} | {"subtotal":120000,"discount":0,"shippingFee":0,"total":120000,"pointsEarned":2400,"pointsUsed":0} | chấm lại bằng SQL: đơn TUBU2026110331444 số học khớp=true; coupon_redemptions=1; mã FREESHIP usageLimit=null usedCount=0. usedCount chỉ tăng khi mã có usageLimit (coupons.service.ts:361), nên +0 đúng  | PASS |
| A1-24-quote | new | api | báo giá | XANH10 giỏ 300.000đ (không tier, 10% = 30.000) | {"subtotal":299000,"discount":29900,"shippingFee":0,"pointsUsed":0,"total":269100,"pointsEarned":5382} | {"subtotal":299000,"discount":29900,"shippingFee":0,"pointsUsed":0,"total":269100,"pointsEarned":5382} | facts={"tier":null,"bal":0,"prior":2,"real":true} couponNotice=null | PASS |
| A1-30-quote | new_nophone | api | báo giá | WELCOME30 giỏ 210.000đ (có Zalo, chưa SĐT) | {"subtotal":210000,"discount":30000,"shippingFee":0,"pointsUsed":0,"total":180000,"pointsEarned":3600} | {"subtotal":210000,"discount":30000,"shippingFee":0,"pointsUsed":0,"total":180000,"pointsEarned":3600} | facts={"tier":null,"bal":0,"prior":0,"real":true} couponNotice=null | PASS |
| A1-30-place | new_nophone | api | đặt đơn COD | WELCOME30 giỏ 210.000đ (có Zalo, chưa SĐT) | {"subtotal":210000,"discount":30000,"shippingFee":0,"total":180000,"pointsEarned":3600,"pointsUsed":0} | {"subtotal":210000,"discount":30000,"shippingFee":0,"total":180000,"pointsEarned":3600,"pointsUsed":0} | chấm lại bằng SQL: đơn TUBU2026110388760 số học khớp=true; coupon_redemptions=1; mã WELCOME30 usageLimit=null usedCount=0. usedCount chỉ tăng khi mã có usageLimit (coupons.service.ts:361), nên +0 đúng | PASS |
| A1-31-quote | new_nophone | api | báo giá | giỏ 79.000đ: phí giao 19.000 | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":98000,"pointsEarned":1580} | {"subtotal":79000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":98000,"pointsEarned":1580} | facts={"tier":null,"bal":0,"prior":1,"real":true} couponNotice=null | PASS |
| A1-40 | guest | api | mã giảm giá | WELCOME30: chỉ cho tài khoản Zalo | 400 "Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Bạn đăng nhập bằng Zalo rồi thử lại nhé." (coupons.service.ts) | 400 "Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo. Bạn đăng nhập bằng Zalo rồi thử lại nhé." | {"oracleReject":"REAL_USER"} | PASS |
| A1-41-quote | guest | api | báo giá | giỏ 120.000đ: phí giao 19.000, không freeship đơn đầu | {"subtotal":120000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":139000,"pointsEarned":2400} | {"subtotal":120000,"discount":0,"shippingFee":19000,"pointsUsed":0,"total":139000,"pointsEarned":2400} | facts={"tier":null,"bal":0,"prior":0,"real":false} couponNotice=null | PASS |
| A1-42-quote | guest | api | báo giá | giỏ 210.000đ: miễn phí giao theo ngưỡng chung | {"subtotal":210000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":210000,"pointsEarned":4200} | {"subtotal":210000,"discount":0,"shippingFee":0,"pointsUsed":0,"total":210000,"pointsEarned":4200} | facts={"tier":null,"bal":0,"prior":0,"real":false} couponNotice=null | PASS |
| A1-42-place | guest | api | đặt đơn COD | giỏ 210.000đ: miễn phí giao theo ngưỡng chung | {"subtotal":210000,"discount":0,"shippingFee":0,"total":210000,"pointsEarned":4200,"pointsUsed":0} | {"subtotal":210000,"discount":0,"shippingFee":0,"total":210000,"pointsEarned":4200,"pointsUsed":0} | đơn TUBU2026110348267 CONFIRMED/UNPAID; balance 0→0; sổ 0→0; khớp SQL | PASS |

### Nhóm A2. Mã giảm giá, giờ vàng, tồn kho, giỏ (API)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| A2-01 | returning | api | mã giảm giá | mã hết hạn | 400 "Mã giảm giá đã hết hạn hoặc chưa hiệu lực." | 400 "Mã giảm giá đã hết hạn hoặc chưa hiệu lực." |  | PASS |
| A2-02 | returning | api | mã giảm giá | mã chưa tới ngày | 400 "Mã giảm giá đã hết hạn hoặc chưa hiệu lực." | 400 "Mã giảm giá đã hết hạn hoặc chưa hiệu lực." |  | PASS |
| A2-03 | returning | api | mã giảm giá | mã đã tắt | 400 "Mã giảm giá đã ngừng áp dụng." | 400 "Mã giảm giá đã ngừng áp dụng." |  | PASS |
| A2-04a | returning | api | mã giảm giá | dùng mã UATLIM1 (tổng 1 lượt) đặt đơn thật | đặt được; usedCount=1 | apply 201, place 201, usedCount=1/1 | đơn TUBU2026110380611 | PASS |
| A2-04b | new | api | mã giảm giá | mã hết lượt toàn cục | 400 "Mã giảm giá đã hết lượt sử dụng." | 400 "Mã giảm giá đã hết lượt sử dụng." |  | PASS |
| A2-04c | returning | api | mã giảm giá | người đã dùng mã 1 lượt/khách gõ lại | 400 (hết lượt, toàn cục hoặc cá nhân) | 400 "Bạn đã dùng hết lượt cho mã này." |  | PASS |
| A2-05 | returning | api | mã giảm giá | XANH10 perUserLimit=2: dùng thêm cho tới khi chạm trần | tổng lượt của khách dừng ở 2 (đã có 2); chữ "Bạn đã dùng hết lượt cho mã này." | đặt thêm 0, lượt SQL 2, lỗi cuối "Bạn đã dùng hết lượt cho mã này." |  | PASS |
| A2-06 | returning | api | mã giảm giá | gõ " freeship " chữ thường + khoảng trắng | 2xx, couponCode=FREESHIP (normalizeCouponCode) | 201 couponCode=FREESHIP freeship=true |  | PASS |
| A2-07 | new | api | mã giảm giá | mã 500.000đ trên giỏ 25.000đ: giảm kẹp bằng tiền hàng, không âm | {"discount":25000,"shippingFee":19000,"total":19000} | {"discount":25000,"shippingFee":19000,"total":19000} | apply 201 | PASS |
| A2-10 | guest | api | giờ vàng | GET /flash-sales/active (không đăng nhập) | 2xx, 3 sản phẩm giá giờ vàng 165.000/119.000/195.000 | 200 [{"itemId":"cmvrtogzd002ourfj5b915rzu","saleId":"cmvrtogz3002iurfjwurucbzv","title":"Flash Sale UAT — giá sốc 6 ngày","startAt":"2026-11-03T20:05:58.002Z","variationId":"cmqfv2cns001nzxp |  | PASS |
| A2-11 | returning | api | giờ vàng | thêm sản phẩm giờ vàng vào giỏ | isFlash, unitPrice 165000, listUnitPrice 220000 | isFlash=true unit=165000 list=220000 soldPct=0 notice=null |  | PASS |
| A2-12 | returning | api | giờ vàng | mua 3 sản phẩm giờ vàng khi mỗi khách tối đa 2 | đặt đơn bị chặn bằng lỗi giới hạn mua (không tính giá giờ vàng cho suất thứ 3) | patch 200; cart line unit=220000 qty=3 notice=Giá Giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn. Giảm số lượng còn 2 để được giá Giờ vàng, hoặc mua 3 sản phẩm với giá thường.; quote total=6 | {"quoteSub":660000} | CẦN CHỦ |
| A2-13 | returning | api | giờ vàng | đặt 2 sản phẩm giờ vàng (đúng giới hạn) | tổng 330000; soldCount +2; flash_sale_purchases qty 2; dòng đơn giá 165000 | place 201 ; total=330000; soldCount 0→2 | khớp SQL | PASS |
| A2-14 | returning | api | giờ vàng | đã mua đủ 2, mua thêm 1 sản phẩm giờ vàng | không được giá giờ vàng lần nữa: lỗi rõ ràng hoặc giá thường | giỏ unit=220000 isFlash=false notice=Bạn đã dùng hết suất Giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.; place 201 total=220000 |  | CẦN CHỦ |
| A2-15 | new (mới tinh) | api | mã giảm giá | WELCOME30, giỏ = 1 giờ vàng 119.000 + 1 nước rửa chén 120.000 (tổng 239.000, phần thường 120.000) | 400 "Đơn tối thiểu 199.000đ để dùng mã này. Hàng Giờ vàng không được tính vào điều kiện của mã, phần được tính là 120.000đ." (coupon-notice.ts couponRejectedWithFlash) | 400 "Đơn tối thiểu 199.000đ để dùng mã này. Hàng Giờ vàng không được tính vào điều kiện của mã, phần được tính là 120.000đ." | giỏ: 119000 flash, 120000 | PASS |
| A2-16 | returning | api | dùng Điểm Xanh | XANH10 + giờ vàng + xin 100.000 điểm: mã chỉ tính hàng thường, trần điểm 20% trên cả giỏ sau mã | {"subtotal":618000,"discount":49900,"pointsUsed":4600,"shippingFee":0,"total":563500,"pointsEarned":13524} | {"subtotal":618000,"discount":49900,"pointsUsed":4600,"shippingFee":0,"total":563500,"pointsEarned":13524} | couponNotice=Hàng Giờ vàng không được giảm thêm theo mã: mã chỉ tính trên 499.000đ hàng còn lại. | PASS |
| A2-17 | new | api | giờ vàng | suất giờ vàng đã bán hết (soldCount = quota), thêm vào giỏ | giá thường 159000 (giá sale), không còn isFlash | isFlash=false unit=159000 list=180000 |  | PASS |
| A2-18 | new | api | giờ vàng | giờ vàng hết giờ khi sản phẩm còn trong giỏ; khách xác nhận mức giá giờ vàng cũ | giỏ về giá thường 159.000đ; đặt với tổng cũ bị chặn TOTAL_CHANGED (đắt hơn số khách đã thấy) | giỏ unit=159000 isFlash=false; quote total=178000; place 400 "Tổng tiền đơn vừa thay đổi từ 138.000đ thành 178.000đ do giá, phí giao hoặc ưu đãi vừa thay đổi. Bạn xem lại trước khi đặt nhé." |  | PASS |
| A2-20 | new | api | giỏ | thêm 31 khi kho còn 30 | 400 "Còn 30 sản phẩm trong kho." (cart.service.ts:369) | 400 "Còn 30 sản phẩm trong kho." |  | PASS |
| A2-21 | new | api | giỏ | thêm sản phẩm hết hàng (kho 0) | 400 báo hết hàng bằng giọng cửa hàng | 400 "Còn 0 sản phẩm trong kho." |  | PASS |
| A2-22 | new | api | giỏ | khách có 3 gạo lứt trong giỏ, kho còn 1 lúc đặt | đặt bị chặn: "Sản phẩm … không đủ tồn kho."; kho không bị trừ | giỏ stock=1 qty=3; quote 201; place 400 "Sản phẩm "Gạo lứt huyết rồng Sokfram" không đủ tồn kho."; kho 1/giữ 0 |  | PASS |
| A2-23 | new | api | giỏ | sửa số lượng 5; 100000; 0 (= xoá); dòng không tồn tại; xoá dòng cuối | qty 5 → subtotal 524.000; 100000 → 400 "…không được lớn hơn 999."; 0 → xoá dòng (cart.dto.ts UpdateItemDto "0 = xoá"); dòng lạ 404 "Không tìm thấy mục giỏ hàng."; xoá hết | qty5 200 sub=524000; 100000 400 "Số lượng không được lớn hơn 999."; qty0 200 còn 1; dòng lạ 404 "Không tìm thấy mục giỏ hàng."; xoá 200 còn 0 |  | PASS |
| A2-24 | returning | api | giỏ | mua một phần giỏ: chọn 2/3 dòng (mã 10% trần 50.000đ đang giữ trong giỏ) | tổng 449100 theo dòng đã chọn; giỏ còn dòng rửa tay x2; kho dòng còn lại không giữ | place 201; total=449100; giỏ còn 1 dòng | khớp SQL | PASS |
| A2-25 | returning | api | đặt đơn COD | đặt 2 lần cùng Idempotency-Key + lần thứ 3 khác key sau khi giỏ đã dọn | một đơn; điểm trừ một lần; kho giữ một lần; lần 3 (giỏ đã dọn) trả lại đúng đơn vừa đặt, không đặt thêm (recentlyPlacedOrder) | p1 201 TUBU2026110300315; p2 201 TUBU2026110300315; p3 201 "TUBU2026110300315" | khớp SQL | PASS |
| A2-26 | new | api | đặt đơn COD | địa chỉ của người khác / phương thức XU / expectedTotal nhỏ hơn thực tế | 400 "Địa chỉ giao hàng không hợp lệ."; 400 DTO (isIn); 400 "Tổng tiền đơn vừa thay đổi từ 1.000đ thành 210.000đ…" | 400 "Địa chỉ giao hàng không hợp lệ." \| 400 "Trường «paymentMethod» chỉ nhận một trong: COD, BANK_TRANSFER, WALLET, ZALOPAY." \| 400 "Tổng tiền đơn vừa thay đổi từ 1.000đ thành 210.000đ do  |  | PASS |
| A2-27 | returning | api | dùng Điểm Xanh | xin -5 điểm; xin 99.999.999 điểm (vượt số dư) | -5: 400 (DTO min 0); 99.999.999: kẹp về 0 (min số dư, trần 20% = 141800) | -5: 400 "Trường «pointsToUse» không được nhỏ hơn 0."; lớn: 201 pointsUsed=0 total=709000 |  | PASS |
| A2-28 | guest | api | dùng Điểm Xanh | khách vãng lai xin dùng 1.000 điểm (số dư 0) | pointsUsed=0, pointsMax=0, tổng = tiền hàng | 201 pointsUsed=0 pointsMax=0 total=210000 |  | PASS |

### Nhóm A3. Chuyển khoản QR, webhook ngân hàng, huỷ, mua lại, danh sách đơn (API + SQL)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| A3-01 | returning | api | chuyển khoản QR | đặt đơn BANK_TRANSFER 499.000đ dùng 8.000 điểm; lấy mã QR | PENDING_PAYMENT/UNPAID; QR đúng số tiền 491000 và nội dung = mã đơn; hạn = tạo + 24h (orders.pending_payment_ttl_hours); điểm trừ 8.000; kho giữ chỗ | PENDING_PAYMENT/UNPAID total=491000; QR {"orderCode":"TUBU2026110335286","amount":491000,"paidSoFar":0,"paymentStatus":"UNPAID","paymentDeadline":"2026-11-04T21:09:43.989Z","serverNow":"2026 | khớp SQL | PASS |
| A3-02a | returning | api | chuyển khoản QR | chuyển thiếu: 100000 / 299000 | đơn giữ PENDING_PAYMENT/UNPAID, "Cần xử lý Pancake: Khách chuyển thiếu …", pancakePaidReported = số đã nhận, khách được báo ORDER_UNDERPAID | PENDING_PAYMENT/UNPAID; attention="Khách chuyển thiếu: Pancake ghi nhận 100.000đ/299.000đ, còn thiếu 199.000đ — chưa xác nhận thanh toán. Liên hệ khách chuyển thêm, hoặc huỷ đơn để hoàn số đ | thông báo gần nhất: []; webhook {"id":"cmw16ldme016sx2e9phqirkjj","status":"PROCESSED","error":null,"attempts":1} | PASS |
| A3-02b | returning | api | chuyển khoản QR | bù phần còn thiếu 199000 | CONFIRMED/PAID, paidAt ghi, cảnh báo thiếu tự gỡ, không có khoản hoàn | CONFIRMED/PAID paidAt=2026-11-03T21:09:46.859Z; att=null | lịch sử: ["PENDING_PAYMENT→CONFIRMED(PANCAKE)"]; khớp SQL | PASS |
| A3-03 | new_nophone | api | chuyển khoản QR | chuyển đủ 210.000đ, nội dung "CK <mã đơn>" | CONFIRMED/PAID; điểm và ví chưa đổi (điểm cộng khi giao) | CONFIRMED/PAID paidAt=2026-11-03T21:09:48.583Z; điểm 0→0; ví 0→0 | khớp SQL | PASS |
| A3-04 | returning | api | chuyển khoản QR | chuyển thừa 50000đ (260000/210000) | PAID đúng tổng; phần thừa 50000đ thành yêu cầu hoàn tiền chờ khách chọn nơi nhận (recordCumulativeOverpayment), ví chưa đổi | CONFIRMED/PAID; hoàn: [{"id":"cmw16lgut0188x2e9c400xc5c","amount":50000,"kind":"OVERPAYMENT","status":"UNVERIFIED"}]; ví Σ=0 | khớp SQL | PASS |
| A3-04b | returning | api | chuyển khoản QR | khách xem khoản hoàn phần thừa khi khoản còn UNVERIFIED (chờ Kế toán đối soát) | customer-refunds.service.ts CUSTOMER_VISIBLE = PENDING/PROCESSING/COMPLETED: khoản UNVERIFIED chưa hiện cho khách (đúng thiết kế); luật không nói khách có được báo "đã nh | 200 [] (khoản SQL: [{"id":"cmw16lgut0188x2e9c400xc5c","amount":50000,"kind":"OVERPAYMENT","status":"UNVERIFIED"}]) |  | CẦN CHỦ |
| A3-05a | returning | api | chuyển khoản QR | Pancake gửi lại 2 lần webhook đơn (status 1 kèm bank_payment = tổng) sau khi đã PAID | giữ PAID, không phát sinh khoản hoàn, lịch sử không thêm dòng | PAID; hoàn=0; lịch sử 1→1; webhook {"id":"cmw16lim8018ux2e9wulhynoe","status":"PROCESSED","error":null,"attempts":1} | khớp SQL | PASS |
| A3-05b | returning | api | chuyển khoản QR | khách chuyển lần 2 đúng bằng tổng đơn (đã PAID) | khoản dư 210000đ vào hàng hoàn tiền (R3-MONEY-1) | hoàn: [{"id":"cmw16lixt018yx2e9xcq3wakp","amount":210000,"kind":"OVERPAYMENT","status":"UNVERIFIED"}] |  | PASS |
| A3-06 | returning | api | chuyển khoản QR | chuyển đủ tiền nhưng nội dung không có mã đơn | không tự ghép: đơn vẫn PENDING_PAYMENT/UNPAID (kế toán đối soát tay) | PENDING_PAYMENT/UNPAID; webhook matched=false |  | PASS |
| A3-07a | returning | api | chuyển khoản QR | đơn CK quá 24 giờ, cron orders.pending-payment-expiry chạy | CANCELLED; hoàn 5.000 điểm vào sổ; trả giữ chỗ kho; trả lượt mã | CANCELLED; job={"lane":1,"job":"PendingPaymentExpiryCron.handleCron","ms":169,"result":null}; điểm 56016→61016; sổ 56016→61016; lượt mã 1→0 | khớp SQL | PASS |
| A3-07b | returning | api | chuyển khoản QR | khách vẫn chuyển tiền sau khi đơn đã tự huỷ | đơn giữ CANCELLED (không hồi sinh); phát sinh khoản hoàn 444100đ chờ khách chọn Ví/ngân hàng | CANCELLED/UNPAID; hoàn: [{"id":"cmw16lpp201alx2e9nun4kzne","amount":444100,"kind":"LATE_PAYMENT","status":"PENDING"}] |  | PASS |
| A3-08a | returning | api | huỷ đơn chờ | khách huỷ đơn CK chờ thanh toán (lý do "Đổi ý"), bấm huỷ lần 2 | CANCELLED; điểm hoàn +7.000 một lần; kho trả; lần 2 vẫn 2xx; lịch sử ghi CUSTOMER + lý do | huỷ 201, lần 2 201; CANCELLED; điểm 64016→71016 | khớp SQL | PASS |
| A3-08b | new_nophone | api | huỷ đơn chờ | khách huỷ đơn COD đã xác nhận (chưa đóng gói) | CANCELLED | 201 CANCELLED |  | PASS |
| A3-08c | new_nophone | api | huỷ đơn chờ | khách huỷ đơn đã bàn giao vận chuyển | 400 "Đơn đã vào quy trình giao, bạn liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ nhé." (hoặc câu bàn giao tương đương); đơn giữ nguyên | 400 "Đơn đã vào quy trình giao, bạn liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ nhé."; SHIPPING |  | PASS |
| A3-08d | new | api | chi tiết đơn | xem/huỷ đơn của người khác | 404 "Không tìm thấy đơn hàng." cho cả hai (không lộ dữ liệu) | huỷ 404 "Không tìm thấy đơn hàng."; xem 404 "Không tìm thấy đơn hàng." |  | PASS |
| A3-09a | returning | api | mua lại | mua lại đơn đã giao TUBU2026102885376 (4 × nước rửa chén Can 5L) | 2xx; giỏ có Can 5L × 4 (kho 36 ≥ 4) giá hiện hành 430.000đ | 201 {"items":[{"id":"cmw16ltnp01ctx2e9pol4mzdv","variationId":"cmqfuw9jv0007w1vfb1njbw7k","productId":"p-fuwa-dishwash","productName":"Nước rửa chén sinh học Fuwa3e","variationName":"Can 5L" |  | PASS |
| A3-09b | returning | api | mua lại | mua lại TUBU2026110300982 khi một dòng hết hàng | dòng hết hàng bị bỏ với lý do OUT_OF_STOCK, các dòng còn lại vào giỏ | 201 {"items":[{"id":"cmw16ltot01d1x2e9zxzyda64","variationId":"cmqfuw9jy0009w1vfn8il35y6","productId":"p-visante-serum","productName":"Serum dưỡng ẩm Visante","variationName":"30ml","slug":" |  | PASS |
| A3-10a | returning | api | danh sách đơn | GET /orders và /orders/status-counts so với SQL | tổng 38 đơn; đếm tab khớp SQL [["PENDING_PAYMENT",7],["CONFIRMED",24],["DELIVERED",3],["CANCELLED",4]] | list 200 38; counts {"pending_payment":7,"processing":24,"shipping":0,"delivered":3,"closed":4} |  | PASS |
| A3-10b | guest | api | danh sách đơn | khách vãng lai xem danh sách đơn của chính mình | chỉ đơn của chính guest (1 theo SQL), không lộ đơn người khác | 200 1 đơn, 0 đơn của người khác |  | PASS |
| A3-11 | returning | api | thanh toán chuyển khoản | đơn CK đã trả, giao xong (webhook delivered) | DELIVERED; đúng 1 dòng sổ ORDER_DELIVERED:<mã> = pointsEarned (đã nhân hệ số hạng 1,2); số dư tăng đúng bằng đó | DELIVERED; pointsEarned=11976; sổ=[{"d":11976,"reason":"ORDER_DELIVERED:TUBU2026110330288"}]; điểm 71016→82992 | khớp SQL | PASS |

### Nhóm A4. Danh mục, tìm kiếm, chi tiết sản phẩm, phiếu mã (API)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| A4-01 | new | api | tìm kiếm | q="rửa chén" (có dấu) | ["Nước rửa chén sinh học Fuwa3e"] | 200 1 SP: ["Nước rửa chén sinh học Fuwa3e"] |  | PASS |
| A4-02 | new | api | tìm kiếm | q="rua chen" (không dấu) | ["Nước rửa chén sinh học Fuwa3e"] | 200 1 SP: ["Nước rửa chén sinh học Fuwa3e"] |  | PASS |
| A4-03 | new | api | tìm kiếm | q="RỬA CHÉN" (chữ hoa) | ["Nước rửa chén sinh học Fuwa3e"] | 200 1 SP: ["Nước rửa chén sinh học Fuwa3e"] |  | PASS |
| A4-04 | new | api | tìm kiếm | q="chen rua" (đảo từ) | ["Nước rửa chén sinh học Fuwa3e"] | 200 1 SP: ["Nước rửa chén sinh học Fuwa3e"] |  | PASS |
| A4-05 | new | api | tìm kiếm | q="xyzabc" (không kết quả) | [] | 200 0 SP: [] |  | PASS |
| A4-06 | new | api | tìm kiếm | q="fuwa" (theo thương hiệu (6 SP Fuwa3e)) | 6 sản phẩm | 200 6 SP: ["Nước rửa chén sinh học Fuwa3e","Nước giặt sinh học Fuwa3e","Nước rửa bình sữa Fuwa3e","Nước lau sàn enzyme Fuwa3e"] |  | PASS |
| A4-07 | new | api | tìm kiếm | q="dầu" (từ chung "dầu") | không đối chiếu được SQL (thiếu unaccent) | 200 8 SP: ["Dầu tràm cho bé Cobote","Dầu gừng massage Pơ Lang","Dầu gội bưởi Pơ Lang","Dầu massage cho bé Cobote"] |  | PASS |
| A4-08 | new | api | tìm kiếm | q="toi" ("toi" không dấu khớp "tôi"? (mơ hồ)) | không có luật | 200 0 SP: [] |  | CẦN CHỦ |
| A4-09 | new | api | tìm kiếm | gợi ý khi gõ "rua" | 2xx, có gợi ý liên quan "rửa" | 200 [{"slug":"nuoc-rua-chen-fuwa3e","name":"Nước rửa chén sinh học Fuwa3e","thumbnail":null,"basePrice":120000,"salePrice":null,"repVariationId":"cmqfuw9jt0005w1vfkndxukxy"},{"slug":"nuoc-ru |  | PASS |
| A4-10 | new | api | tìm kiếm | từ khoá 101 ký tự | 400 với chữ tiếng Việt (MAX_QUERY_LENGTH=100) | 400 {"message":["Từ khoá không được dài quá 100 ký tự."],"error":"Bad Request","statusCode":400} |  | PASS |
| A4-11 | new | api | tìm kiếm | chuỗi kiểu SQL injection | 200 rỗng, bảng products còn nguyên | 200 0 SP; products=44 |  | PASS |
| A4-12 | new | api | danh mục | productCount mỗi danh mục = SQL = số SP trả về khi lọc | khớp mọi danh mục | Mỹ phẩm thiên nhiên:12, Tẩy rửa sinh học:6, Cho bé:7, Cho mẹ bầu:1, Chăm sóc cá nhân:9, Cà phê & Đồ uống:5, Nông sản & Thực phẩm:12 | khớp SQL | PASS |
| A4-13 | new | api | chi tiết SP | SP 2 biến thể (1L 120.000, Can 5L 480.000 sale 430.000) | 2 biến thể đúng giá và tồn kho theo SQL | 200 [["1L",120000,null,197],["Can 5L",480000,430000,36]] |  | PASS |
| A4-14 | new | api | chi tiết SP | SP hết hàng (kho 0) | 2xx, tồn kho 0 để màn báo "Hết hàng" | 200 stock=0 |  | PASS |
| A4-15 | new | api | chi tiết SP | slug không tồn tại | 404 tiếng Việt | 404 {"message":"Không tìm thấy sản phẩm.","error":"Not Found","statusCode":404} |  | PASS |
| A4-16 | new | api | chi tiết SP | SP đang giờ vàng (hạt điều 500g: giá sale 159.000, giờ vàng 119.000); API SP không mang giá giờ vàng, màn lấy từ /flash-sales/active | GET /products/:slug giá thường 159.000; /flash-sales/active có biến thể đó giá 119.000 | SP 200 sale=159000; giờ vàng có biến thể=true |  | PASS |
| A4-18 | new | api | phiếu mã giảm giá | GET /coupons/collectable | 2xx | 200 [] |  | PASS |
| A4-19 | new | api | phiếu mã giảm giá | coupon-previews khi giỏ trống | 2xx (không 500) | 200 {"coupons":[{"code":"FREESHIP","eligible":false,"reason":"Đơn từ 199.000đ đã được miễn phí giao, mã miễn phí giao hàng được giữ cho đơn sau.","discount":0,"freeshipSaving":0},{"code":"XA |  | PASS |

### Nhóm B. Tái hiện lỗi API tìm thấy khi bấm giao diện

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| B-cart-order | ord1 | api | giỏ | sửa SL dòng đầu rồi đọc lại giỏ | thứ tự dòng giữ nguyên (dòng vừa sửa vẫn ở vị trí cũ) | trước ["Nước giặt sinh x1","Nước rửa tay x1","Serum dưỡng ẩm x1"]; sau ["Nước rửa tay x1","Serum dưỡng ẩm x1","Nước giặt sinh x2"] |  | FAIL |

### Nhóm U3. Hành trình bấm tay qua giao diện (Mini 375, web 375, web 1280)

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| U3-mini375-J1-01 | jmc | mini375 | giỏ | PDP nước rửa chén (biến thể 1L mặc định) bấm "Thêm vào giỏ" | giỏ có 1 dòng 1L SL 1 (API /cart) | SL dòng 1L = 1 |  | PASS |
| U3-mini375-J1-02 | jmc | mini375 | giỏ | mở giỏ 4 dòng (SL 1+2+1+1) | Thanh toán (5), Tạm tính 918.000đ | Thanh toán (5); tạm tính 918000 |  | PASS |
| U3-mini375-J1-03 | jmc | mini375 | giỏ | tăng SL nước giặt 2 → 3 | API SL 3; Tạm tính 1.128.000đ trên màn | SL=3; tạm tính 1128000 |  | PASS |
| U3-mini375-J2-01 | jmc | mini375 | chuyển khoản | đặt đơn CK → sang màn QR | đơn PENDING_PAYMENT/UNPAID; màn QR có số tiền, nội dung CK = mã đơn | đơn TUBU2026110323627 PENDING_PAYMENT/UNPAID; URL /bank-payment/TUBU2026110323627; số tiền trên màn true; mã đơn true | quote total 180000 | PASS |
| U3-mini375-J2-02 | jmc | mini375 | chuyển khoản | webhook ngân hàng đúng số tiền → đơn đã thanh toán, màn đổi trạng thái | DB PAID; màn không còn mã QR chờ, có chữ đã thanh toán/đã nhận | DB CONFIRMED/PAID; webhook={"matched":true,"txn":{"at":"2026-11-03T21:57:27.682Z","account":"8386790906 Techcombank","amount":1; màn: true / còn QR chờ: false | Đã nhận thanh toán! \| Đơn TUBU2026110323627 đã được xác nhận. Cảm ơn bạn \| Xem đơn hàng \| Về trang chủ | PASS |
| U3-mini375-J3-01 | jmc | mini375 | mã giảm giá | khách mới vào thanh toán: tự áp mã tốt nhất | có mã được áp (nhãn "Tubu đã tự áp mã tốt nhất" ở Mini) và giảm đúng | mã=WELCOME30; có nhãn tự áp=true; Giảm giá -30000 | Mã giảm giá \| WELCOME30 \| -30.000đ \| Thay đổi \| Tubu đã tự áp mã tốt nhất \| Gỡ \| Mã người giới thiệu \| Có người giới thiệu Tubu cho bạn? Nhập mã của họ \| Nhập mã \| Phương thức th | PASS |
| U3-mini375-J3-02 | jmc | mini375 | mã giảm giá | mở bộ chọn mã | liệt kê phiếu còn dùng được và phiếu chưa đủ điều kiện kèm lý do | đã mở: true | Thanh toán \| Địa chỉ giao hàng \| Khách UAT · 0901000099 \| Mặc định \| 99 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh \| Thêm địa chỉ mới \| Sản phẩm (2) \| Nước giặt sinh học Fuwa3e \| 2L \| 21 | PASS |
| U3-mini375-J3-03 | jmc | mini375 | mã giảm giá | nhập mã không tồn tại "SAIMA123" | báo lỗi tiếng Việt, đúng giọng (không "Vui lòng") | báo: Mã giảm giá không tồn tại. |  | PASS |
| U3-mini375-J4-01 | jme | mini375 | đơn | chi tiết đơn chờ thanh toán | có mã đơn, trạng thái Chờ thanh toán, nút Huỷ đơn | mã true; trạng thái true; nút huỷ true |  | PASS |
| U3-web375-J1-01 | jwe | web375 | giỏ | PDP nước rửa chén (biến thể 1L mặc định) bấm "Thêm vào giỏ" | giỏ có 1 dòng 1L SL 1 (API /cart) | SL dòng 1L = 1 |  | PASS |
| U3-web375-J1-02 | jwe | web375 | giỏ | mở giỏ 4 dòng (SL 1+2+1+1) | Thanh toán (5), Tạm tính 918.000đ | Thanh toán (5); tạm tính 918000 |  | PASS |
| U3-web375-J1-03 | jwe | web375 | giỏ | tăng SL nước giặt 2 → 3 | API SL 3; Tạm tính 1.128.000đ trên màn | SL=3; tạm tính 1128000 |  | PASS |
| U3-web375-J2-01 | jwc | web375 | chuyển khoản | đặt đơn CK → sang màn QR | đơn PENDING_PAYMENT/UNPAID; màn QR có số tiền, nội dung CK = mã đơn | đơn TUBU2026110398778 PENDING_PAYMENT/UNPAID; URL /thanh-toan/chuyen-khoan/TUBU2026110398778; số tiền trên màn true; mã đơn true | quote total 180000 | PASS |
| U3-web375-J2-02 | jwc | web375 | chuyển khoản | webhook ngân hàng đúng số tiền → đơn đã thanh toán, màn đổi trạng thái | DB PAID; màn không còn mã QR chờ, có chữ đã thanh toán/đã nhận | DB CONFIRMED/PAID; webhook={"matched":true,"txn":{"at":"2026-11-03T21:59:34.902Z","account":"8386790906 Techcombank","amount":1; màn: true / còn QR chờ: false | Thanh toán chuyển khoản \| \| Đã nhận thanh toán! \| \| Đơn TUBU2026110398778 đã được xác nhận. Cảm ơn bạn. \| \| Xem đơn hàng \| Về trang chủ \| Hotline: 0984 606 774 \| Điều khoản \| Bảo mật \| Đổi  | PASS |
| U3-web375-J3-01 | jwc | web375 | mã giảm giá | khách mới vào thanh toán: tự áp mã tốt nhất | có mã được áp (nhãn "Tubu đã tự áp mã tốt nhất" ở Mini) và giảm đúng | mã=WELCOME30; có nhãn tự áp=true; Giảm giá -30000 | Mã giảm giá \| WELCOME30 \| -30.000đ \| Thay đổi \| Tubu đã tự áp mã tốt nhất \| Gỡ \| Điểm Xanh \| Tích điểm từ đơn đầu tiên nhé \| Tổng cộng \| 269.000đ \| \| Nhận +5.380 Điểm Xanh khi giao | PASS |
| U3-web375-J3-02 | jwc | web375 | mã giảm giá | mở bộ chọn mã | liệt kê phiếu còn dùng được và phiếu chưa đủ điều kiện kèm lý do | đã mở: true | Thanh toán \| Địa chỉ giao hàng \| Khách UAT · 0901000099 \| Mặc định \| 99 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh \| Thêm địa chỉ mới \| Phương thức thanh toán \| Thanh toán khi nhận hàng (C | PASS |
| U3-web375-J3-03 | jwc | web375 | mã giảm giá | nhập mã không tồn tại "SAIMA123" | báo lỗi tiếng Việt, đúng giọng (không "Vui lòng") | báo: Mã giảm giá không tồn tại. |  | PASS |
| U3-web375-J4-01 | jwe | web375 | đơn | chi tiết đơn chờ thanh toán | có mã đơn, trạng thái Chờ thanh toán, nút Huỷ đơn | mã true; trạng thái true; nút huỷ true |  | PASS |
| U3-web1280-J1-01 | jdd | web1280 | giỏ | PDP nước rửa chén (biến thể 1L mặc định) bấm "Thêm vào giỏ" | giỏ có 1 dòng 1L SL 1 (API /cart) | SL dòng 1L = 1 |  | PASS |
| U3-web1280-J1-02 | jdd | web1280 | giỏ | mở giỏ 4 dòng (SL 1+2+1+1) | Thanh toán (5), Tạm tính 918.000đ | Thanh toán (5); tạm tính 918000 |  | PASS |
| U3-web1280-J1-03 | jdd | web1280 | giỏ | tăng SL nước giặt 2 → 3 | API SL 3; Tạm tính 1.128.000đ trên màn | SL=3; tạm tính 1128000 |  | PASS |
| U3-web1280-J1-04 | jdd | web1280 | giỏ | giảm SL nước giặt 3 → 2 | API SL 2 | SL=2 |  | PASS |
| U3-web1280-J1-05 | jdd | web1280 | giỏ | xoá dòng nước rửa tay (vị trí 2/4) | dòng biến mất khỏi giỏ; các dòng khác còn nguyên | SL rửa tay=0; còn 3 dòng |  | PASS |
| U3-web1280-J1-06 | jdd | web1280 | giỏ | bỏ chọn 2 dòng, chỉ mua nước giặt x2 | Thanh toán (2), Tạm tính 420.000đ | Thanh toán (2); tạm tính 420000 |  | PASS |
| U3-mini375-J1-04 | jmc | mini375 | giỏ | giảm SL nước giặt 3 → 2 | API SL 2 | SL=2 |  | PASS |
| U3-mini375-J1-05 | jmc | mini375 | giỏ | xoá dòng nước rửa tay (vị trí 2/4) | dòng biến mất khỏi giỏ; các dòng khác còn nguyên | SL rửa tay=0; còn 3 dòng |  | PASS |
| U3-mini375-J1-06 | jmc | mini375 | giỏ | bỏ chọn 2 dòng, chỉ mua nước giặt x2 | Thanh toán (2), Tạm tính 420.000đ | Thanh toán (2); tạm tính 420000 |  | PASS |
| U3-mini375-J1-07 | jmc | mini375 | thanh toán | màn thanh toán chỉ có dòng được chọn | chỉ nước giặt x2; không serum, không nước rửa chén | nước giặt xuất hiện 1 lần; vắng các dòng còn lại=true |  | PASS |
| U3-mini375-J1-08 | jmc | mini375 | thanh toán | số tiền trên màn = báo giá API cho đúng phần đã chọn | Tạm tính 420.000đ; tổng = API quote 420000; nút Đặt hàng = tổng | màn: tạm tính 420000, ship 0, tổng 420000, nút 420000 | quote={"subtotal":420000,"discount":0,"shippingFee":0,"total":420000} | PASS |
| U3-mini375-J1-09 | jmc | mini375 | thanh toán | đặt COD | tạo 1 đơn CONFIRMED/COD, tổng = số tiền trên nút | đơn TUBU2026110320803 CONFIRMED COD tổng 420000 | URL sau đặt: /checkout | PASS |
| U3-mini375-J1-10 | jmc | mini375 | thanh toán | SQL sau đặt: số học đơn khớp; giỏ còn các dòng không mua; tồn kho giảm đúng | đơn khớp; giỏ còn DISH1L + SERUM30; reservedStock +2 (hoặc stock −2) | đơn khớp=true ; giỏ còn 2 dòng [cmqfuw9jt0005w1vfkndxukxy,cmqfuw9jy0009w1vfn8il35y6]; kho 95/31 → 93/33 |  | PASS |
| U3-mini375-J1-11 | jmc | mini375 | thanh toán | màn sau đặt hàng báo thành công và có mã đơn | có chữ xác nhận và mã đơn | có chữ xác nhận; mã đơn trên màn=true | Cảm ơn bạn đã chọn Tubu \| Đơn hàng của bạn đã được ghi nhận \| Mã đơn hàng \| TUBU2026110320803 \| Tổng thanh toán \| 420.000đ \| Chuẩn bị tiền mặt khi nhận hàng \| Điểm Xanh sẽ nhận \| +8.400 điểm,  | PASS |
| U3-mini375-J4-02 | jme | mini375 | đơn | huỷ đơn chờ thanh toán qua giao diện | DB CANCELLED; màn ghi Đã huỷ | DB CANCELLED/UNPAID; màn Đã huỷ=true |  | PASS |
| U3-mini375-J4-03 | jme | mini375 | đơn | bấm "Mua lại" trên đơn đã huỷ | giỏ có lại nước giặt SL 1; chuyển sang giỏ | SL giỏ=1; URL /cart |  | PASS |
| U3-web375-J1-04 | jwe | web375 | giỏ | giảm SL nước giặt 3 → 2 | API SL 2 | SL=2 |  | PASS |
| U3-web375-J1-05 | jwe | web375 | giỏ | xoá dòng nước rửa tay (vị trí 2/4) | dòng biến mất khỏi giỏ; các dòng khác còn nguyên | SL rửa tay=0; còn 3 dòng |  | PASS |
| U3-web375-J1-06 | jwe | web375 | giỏ | bỏ chọn 2 dòng, chỉ mua nước giặt x2 | Thanh toán (2), Tạm tính 420.000đ | Thanh toán (2); tạm tính 420000 |  | PASS |
| U3-web375-J4-02 | jwe | web375 | đơn | huỷ đơn chờ thanh toán qua giao diện | DB CANCELLED; màn ghi Đã huỷ | DB CANCELLED/UNPAID; màn Đã huỷ=true |  | PASS |
| U3-web375-J4-03 | jwe | web375 | đơn | bấm "Mua lại" trên đơn đã huỷ | giỏ có lại nước giặt SL 1; chuyển sang giỏ | SL giỏ=1; URL /gio-hang |  | PASS |
| U3-web1280-J1-07 | jdd | web1280 | thanh toán | màn thanh toán chỉ có dòng được chọn | chỉ nước giặt x2; không serum, không nước rửa chén | nước giặt xuất hiện 1 lần; vắng các dòng còn lại=true |  | PASS |
| U3-web1280-J1-08 | jdd | web1280 | thanh toán | số tiền trên màn = báo giá API cho đúng phần đã chọn | Tạm tính 420.000đ; tổng = API quote 420000; nút Đặt hàng = tổng | màn: tạm tính 420000, ship 0, tổng 420000, nút 420000 | quote={"subtotal":420000,"discount":0,"shippingFee":0,"total":420000} | PASS |
| U3-web1280-J1-09 | jdd | web1280 | thanh toán | đặt COD | tạo 1 đơn CONFIRMED/COD, tổng = số tiền trên nút | đơn TUBU2026110308174 CONFIRMED COD tổng 420000 | URL sau đặt: /thanh-toan | PASS |
| U3-web1280-J1-10 | jdd | web1280 | thanh toán | SQL sau đặt: số học đơn khớp; giỏ còn các dòng không mua; tồn kho giảm đúng | đơn khớp; giỏ còn DISH1L + SERUM30; reservedStock +2 (hoặc stock −2) | đơn khớp=true ; giỏ còn 2 dòng [cmqfuw9jt0005w1vfkndxukxy,cmqfuw9jy0009w1vfn8il35y6]; kho 89/37 → 87/39 |  | PASS |
| U3-web1280-J1-11 | jdd | web1280 | thanh toán | màn sau đặt hàng báo thành công và có mã đơn | có chữ xác nhận và mã đơn | có chữ xác nhận; mã đơn trên màn=true | Tìm sản phẩm \| 1 \| 2 \| K \| jdd \| Danh mục \| Vườn Xanh \| Ưu đãi \| Kho quà \| Mua chung \| Cộng đồng \| Trang chủ \| Giỏ hàng \| Thanh toán \| Thanh toán \| Cảm ơn bạn đã chọn Tubu \| \| Đơn hàn | PASS |
| U3-web375-J1-07 | jwe | web375 | thanh toán | màn thanh toán chỉ có dòng được chọn | chỉ nước giặt x2; không serum, không nước rửa chén | nước giặt xuất hiện 1 lần; vắng các dòng còn lại=true |  | PASS |
| U3-web375-J1-08 | jwe | web375 | thanh toán | số tiền trên màn = báo giá API cho đúng phần đã chọn | Tạm tính 420.000đ; tổng = API quote 420000; nút Đặt hàng = tổng | màn: tạm tính 420000, ship 0, tổng 420000, nút 420000 | quote={"subtotal":420000,"discount":0,"shippingFee":0,"total":420000} | PASS |
| U3-web375-J1-09 | jwe | web375 | thanh toán | đặt COD | tạo 1 đơn CONFIRMED/COD, tổng = số tiền trên nút | đơn TUBU2026110319806 CONFIRMED COD tổng 420000 | URL sau đặt: /thanh-toan | PASS |
| U3-web375-J1-10 | jwe | web375 | thanh toán | SQL sau đặt: số học đơn khớp; giỏ còn các dòng không mua; tồn kho giảm đúng | đơn khớp; giỏ còn DISH1L + SERUM30; reservedStock +2 (hoặc stock −2) | đơn khớp=true ; giỏ còn 2 dòng [cmqfuw9jt0005w1vfkndxukxy,cmqfuw9jy0009w1vfn8il35y6]; kho 87/39 → 85/41 |  | PASS |
| U3-web375-J1-11 | jwe | web375 | thanh toán | màn sau đặt hàng báo thành công và có mã đơn | có chữ xác nhận và mã đơn | có chữ xác nhận; mã đơn trên màn=true | Cảm ơn bạn đã chọn Tubu \| Đơn hàng của bạn đã được ghi nhận \| Mã đơn hàng \| TUBU2026110319806 \| Tổng thanh toán \| 420.000đ \| Chuẩn bị tiền mặt khi nhận hàng \| Điểm Xanh sẽ nhận \| +8.400 điểm,  | PASS |

### Nhóm U4. Quy tắc Mini (5 tab, không link ngoài) và kiểm tra bố cục

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| U4-home-order-mini375 | returning | mini375 | Trang chủ | thứ tự khối hàng, lần mở đầu và lần mở thứ hai cùng trình duyệt | khách cũ: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất (home-layout.ts RETURNING); lần đầu web có thể đặt Mua lại sau Bán chạy (homeKeptOrder) | lần 1: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất; lần 2: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất |  | PASS |
| U4-home-order-web375 | returning | web375 | Trang chủ | thứ tự khối hàng, lần mở đầu và lần mở thứ hai cùng trình duyệt | khách cũ: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất (home-layout.ts RETURNING); lần đầu web có thể đặt Mua lại sau Bán chạy (homeKeptOrder) | lần 1: Giờ vàng > Danh mục > Bán chạy nhất > Mua lại; lần 2: Giờ vàng > Mua lại > Danh mục > Bán chạy nhất |  | PASS |
| U4-mini-bar-_ | returning | mini375 | quy tắc Mini | /: thanh đáy 5 tab; không link http(s) ra ngoài | 5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài | thanh đáy=true (5/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_browse | returning | mini375 | quy tắc Mini | /browse: thanh đáy 5 tab; không link http(s) ra ngoài | 5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài | thanh đáy=true (5/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_vouchers | returning | mini375 | quy tắc Mini | /vouchers: thanh đáy 5 tab; không link http(s) ra ngoài | 0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath) | thanh đáy=false (0/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_flash_sale | returning | mini375 | quy tắc Mini | /flash-sale: thanh đáy 5 tab; không link http(s) ra ngoài | 0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath) | thanh đáy=false (0/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_cart | returning | mini375 | quy tắc Mini | /cart: thanh đáy 5 tab; không link http(s) ra ngoài | 0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath) | thanh đáy=false (0/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_checkout | returning | mini375 | quy tắc Mini | /checkout: thanh đáy 5 tab; không link http(s) ra ngoài | 0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath) | thanh đáy=false (0/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_orders | returning | mini375 | quy tắc Mini | /orders: thanh đáy 5 tab; không link http(s) ra ngoài | 0 link ngoài; trang con không có thanh đáy (nav-config.ts isRootPath) | thanh đáy=false (0/5 nhãn); link ngoài: không |  | PASS |
| U4-orders-overflow-web375 | returning | web375 | đơn hàng | Đơn hàng web 375: trang không được cuộn ngang | scrollWidth = 375 | scrollWidth=379 (body 379) / 375; phần tử lòi ra: div.scroll-x tubu-scroll-fade tubu-bleed-rail right=379 left=-4 "Nước giặt sinh học Fuwa3e · 2L" \|\| div.md:!hidden right=379 left=0 "" |  | FAIL |
| U4-mini-bar-_offers | returning | mini375 | quy tắc Mini | /offers: thanh đáy 5 tab; không link http(s) ra ngoài | 5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài | thanh đáy=true (5/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_game | returning | mini375 | quy tắc Mini | /game: thanh đáy 5 tab; không link http(s) ra ngoài | 5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài | thanh đáy=true (5/5 nhãn); link ngoài: không |  | PASS |
| U4-mini-bar-_profile | returning | mini375 | quy tắc Mini | /profile: thanh đáy 5 tab; không link http(s) ra ngoài | 5 tab (Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân) trên trang gốc; 0 link ngoài | thanh đáy=true (5/5 nhãn); link ngoài: không |  | PASS |

### Nhóm U1/U2. So sánh giao diện Mini 375 với web 375, web 1280 không vỡ

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| U1-01 | returning | mini375/web3 | Trang chủ | khách cũ: khối hàng, tiền, đếm điểm (82.992 điểm ≈ 82.992đ) | thứ tự Giờ vàng > Mua lại > Danh mục > Bán chạy nhất (home-layout.ts RETURNING); mọi số tiền Mini = web; 1280 không vỡ | tiền khớp mọi thẻ; web lần mở thứ nhất đặt Mua lại sau Bán chạy (homeKeptOrder, có chủ đích), lần mở thứ hai đúng thứ tự RETURNING; web1280 không tràn | returning__home__mini375/web375/web1280.png; U4-home-order-* | PASS |
| U1-02 | new, guest | mini375/web3 | Trang chủ | khách mới và khách vãng lai: dải "Quà khách mới", Giờ vàng, Danh mục, Bán chạy | Mini = web375 chữ và thứ tự (home-layout.ts NEW) | chỉ khác dòng chân trang web (hotline, điều khoản); tiền khớp | ui-diff-new.md, ui-diff-guest.md (home) | PASS |
| U1-03 | returning | mini375/web3 | Danh mục + Tìm kiếm có d | /browse?category=cat-cleaning; q="rửa chén"; q="rua chen" | cùng 6 SP / 1 SP; tiêu đề danh mục "Tẩy rửa sinh học"; số SP khớp API | khớp (ảnh gần như trùng từng điểm ảnh); "rua chen" ra đúng 1 SP như "rửa chén" | shots/L1-mua-hang/returning__category__mini375.png, returning__category__web375.png | PASS |
| U1-04 | returning | mini375/web3 | Tìm kiếm không kết quả | q="xyzabc" | cùng câu: Không tìm thấy "xyzabc" / Thử từ khoá khác hoặc bỏ bớt bộ lọc / Xoá tìm kiếm & bộ lọc | chữ khớp 100%; bố cục trạng thái trống khác: web đặt trong thẻ viền bo, tiêu đề chữ serif, có chân trang; Mini không thẻ | shots/L1-mua-hang/returning__search-rong__mini375.png, returning__search-rong__web375.png | FAIL |
| U1-05 | returning | mini375/web3 | PDP nhiều biến thể | nước rửa chén 1L 120.000đ / Can 5L 430.000đ | cùng khối, cùng chữ, giá biến thể, nút "Thêm vào giỏ" và "Mua ngay 120.000đ" | khớp; web375 có thêm khối "Đặt định kỳ — tiết kiệm 12%" (Mini ẩn do SUBSCRIPTIONS_IN_MINIAPP=false, features.ts:16) | shots/L1-mua-hang/returning__pdp-bienthe__mini375.png, returning__pdp-bienthe__web375.png | CẦN CHỦ |
| U1-06 | returning | mini375/web3 | PDP giá sale + giờ vàng | serum -10% 289.000đ/320.000đ; hạt điều giờ vàng 119.000đ/159.000đ, "Mỗi khách tối đa 2" | giá đúng /products và /flash-sales/active; hai nền cùng chữ giờ vàng | khớp giá, huy hiệu -25%, "Vừa mở bán", "Mỗi khách tối đa 2"; chỉ lệch chữ đánh giá (xem U1-08) | shots/L1-mua-hang/returning__pdp-flash__mini375.png, returning__pdp-flash__web375.png | PASS |
| U1-07 | returning | mini375/web3 | PDP hết hàng | tiêu đen (kho 0) | nút "Tạm hết hàng" khoá, không còn "Thêm vào giỏ"/"Mua ngay" | khớp hai nền | shots/L1-mua-hang/returning__pdp-hethang__mini375.png, returning__pdp-hethang__web375.png | PASS |
| U1-08 | returning | mini375/web3 | PDP: chữ đánh giá | khối Đánh giá khi chưa mua | cùng một câu | Mini "Mua & nhận hàng để đánh giá", web "Mua và nhận hàng để đánh giá" | apps/miniapp/src/components/reviews-section.tsx:193 và apps/web/src/app/san-pham/[slug]/product-reviews.tsx:185 | FAIL |
| U1-09 | returning | mini375/web3 | PDP không tồn tại | /product/khong-co-san-pham-nay | cùng trạng thái lỗi | Mini: "Không tìm thấy sản phẩm này." + Về trang chủ + Cần hỗ trợ + rail "Có thể bạn thích"; web: trang 404 "Trang này lạc vào vườn rồi" | shots/L1-mua-hang/returning__pdp-khongco__mini375.png, returning__pdp-khongco__web375.png | FAIL |
| U1-10 | returning | mini375/web3 | Giờ vàng, Mã giảm giá (v | /flash-sale, /vouchers | cùng khối, cùng số tiền | khớp chữ và tiền (chỉ lệch giây đếm ngược và chân trang web) | ui-diff-returning.md (flash, vouchers) | PASS |
| U1-11 | returning, new | mini375/web3 | Giỏ: trống / 3 dòng / có | /cart ↔ /gio-hang | dòng, số lượng, thành tiền, tạm tính, "Tiết kiệm", thanh freeship, chip mã trùng; 1280 không vỡ | tiền và chữ khớp mọi biến thể giỏ; web1280 hiện thêm cột tóm tắt đúng số | shots/L1-mua-hang/returning__cart-flash__mini375.png, returning__cart-flash__web375.png, returning__cart-co-hang__* | PASS |
| U1-12 | returning | mini375/web3 | Giỏ có dòng hết hàng | gạo lứt (kho 0) x2 + nước lau kính | cùng chữ báo hết hàng và cùng cách chặn thanh toán | Mini: dòng "Sản phẩm đã hết hàng" (vàng, còn bộ +/−) + thanh dưới nêu tên SP; web: "Hết hàng — hãy xoá khỏi giỏ hoặc bỏ chọn để thanh toán các món còn lại" (đỏ, ẩn bộ +/−) + thanh dưới "Có s | shots/L1-mua-hang/returning__cart-het-hang__mini375.png, returning__cart-het-hang__web375.png | FAIL |
| U1-13 | returning, new | mini375/web3 | Thanh toán: giỏ 2 dòng + | /checkout ↔ /thanh-toan | cùng khối, thứ tự, số tiền, "Dùng N điểm" trần 20% | thứ tự khối và tiền khớp (mã UATX10 -29.900đ, điểm trần 53.820đ = 20% của 269.100đ, 28.992 điểm bị giữ) | shots/L1-mua-hang/returning__checkout__mini375.png, returning__checkout__web375.png | PASS |
| U1-14 | returning | mini375/web3 | Thanh toán: điểm bị giữ | 28.992 điểm từ đơn mới giao chưa dùng được | cùng câu (luật "web 375 giống Mini cả chữ") | Mini: "28.992 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được"; web: "28.992 điểm từ đơn mới giao chưa dùng được vì còn trong hạn hoặc đang chờ xử lý đổi/trả; sẽ dùng đư | apps/miniapp/src/utils/checkout-rules.ts:126; apps/web/src/lib/checkout-points.ts:57 | FAIL |
| U1-15 | returning | mini375/web3 | Thanh toán giỏ trống | /checkout khi giỏ rỗng | cùng chữ và nút | Mini: "Giỏ còn trống đấy / Khám phá sản phẩm Tubu chọn riêng cho bạn / Khám phá ngay"; web: "Giỏ hàng đang trống / Chưa có sản phẩm nào để thanh toán. Chọn vài món xanh rồi quay lại nhé. / K | shots/L1-mua-hang/returning__checkout-trong__mini375.png, returning__checkout-trong__web375.png | FAIL |
| U1-16 | noaddr | mini375/web3 | Thanh toán khi chưa có đ | xoá hết địa chỉ rồi vào thanh toán | cùng: "Bạn chưa thêm địa chỉ", phí "Nhập địa chỉ để tính phí", tổng "Chưa tính", nút Đặt hàng khoá + "Chọn địa chỉ giao hàng để đặt hàng." | khớp chữ hai nền; WELCOME30 vẫn tự áp -30.000đ | ui/noaddr/checkout/*.json | PASS |
| U1-17 | new_nophone | mini375/web3 | Thanh toán khách có Zalo | vào thanh toán, mã tự áp, nút đặt | cùng khối và số tiền | khớp; không có lời nhắc SĐT ở màn thanh toán (SĐT hỏi lúc đặt, ngoài phạm vi chụp tĩnh) | ui/new_nophone/checkout/*.json | PASS |
| U1-18 | returning | mini375/web3 | Danh sách đơn | tab Tất cả, 7 đơn đủ trạng thái | cùng thẻ đơn, cùng nút "Thanh toán ngay"/"Mua lại", cùng hạn thanh toán và chữ trạng thái | chữ, thẻ, nút khớp từng thẻ (7 đơn). Lệch ngoài phạm vi ca này: web có thêm tab "Định kỳ" (C1) và trang cuộn ngang 4px (xem U4-orders-overflow-web375) | shots/L1-mua-hang/returning__orders__web375.png; U4-orders-overflow-web375 | PASS |
| U1-19 | returning | mini375/web3 | Chi tiết đơn chờ chuyển  | đơn BANK_TRANSFER PENDING_PAYMENT | cùng khối, cùng thứ tự | Mini: dải "Chờ thanh toán — Thanh toán trước 04:10 05/11/2026…" + Hành trình + thanh nút "Huỷ đơn \| Thanh toán ngay"; web: câu "Đơn đang chờ bạn chuyển khoản…" + QR VietQR và số tài khoản n | shots/L1-mua-hang/returning__order-cho-ck__mini375.png, returning__order-cho-ck__web375.png | FAIL |
| U1-20 | returning | mini375/web3 | Chi tiết đơn đã giao / đ | 3 đơn | cùng dải trạng thái, hành trình, dòng, tiền, "Mua lại đơn này", "Viết đánh giá", "Yêu cầu đổi/trả" | dữ liệu và tiền khớp; bố cục nút khác: đơn đã giao web có thanh 2 nút "Mua lại đơn này \| Yêu cầu đổi/trả", Mini thanh 1 nút (đổi/trả nằm trong trang); hộp huỷ: Mini bảng trượt dưới, web khu | shots/L1-mua-hang/returning__order-da-giao__mini375.png, returning__order-da-giao__web375.png, U3-*-J4-02-hop-huy.png | FAIL |
| U1-21 | returning | mini375/web3 | Màn chuyển khoản /bank-p | đơn chờ CK | cùng QR, số tiền 210.000đ, ngân hàng, STK, chủ TK, nội dung CK = mã đơn | khớp từng dòng | ui-diff-returning.md (bank-payment) | PASS |
| U1-22 | returning | mini375/web3 | Đơn không tồn tại | /order/TUBU0000000000 | cùng "Không tìm thấy đơn hàng này." | khớp | ui-diff-returning.md (order-khong-co) | PASS |
| U1-23 | guest | mini375/web3 | Khách vãng lai: giỏ, tha | /cart, /checkout, /orders | cùng hành vi (chưa có luật riêng) | Mini: tài khoản vãng lai tự tạo, giỏ trống "Giỏ còn trống đấy", đơn "Bạn chưa có đơn nào"; web: "Đăng nhập để xem giỏ hàng của bạn. / Đăng nhập với Zalo" | ui-diff-guest.md | CẦN CHỦ |

### Nhóm R1. Đối soát SQL toàn DB lane

| ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|---|
| R1-01 | toàn DB | sql | đối soát | 64 đơn: Σ dòng = tạm tính; giảm = mã+combo+hạng+điểm; tổng = tạm tính − giảm + ship; Σ paidTotal; điểm dùng | 0 đơn lệch | 0 đơn lệch |  | PASS |
| R1-02 | toàn DB | sql | đối soát | users.pointsBalance / pointsConvertedBalance = Σ points_transactions.delta theo lô | 0 user lệch | 0 user lệch |  | PASS |
| R1-03 | toàn DB | sql | đối soát | users.walletBalance = Σ wallet_transactions.delta | 0 user lệch | 0 user lệch |  | PASS |
| R1-04 | toàn DB | sql | đối soát | không user nào có số dư điểm/ví âm | 0 | 0 |  | PASS |
| R1-05 | toàn DB | sql | đối soát | 10 đơn có dùng điểm: Σ dòng sổ trừ (refId = id đơn) = pointsUsed | 0 đơn lệch | 0 đơn lệch |  | PASS |
| R1-06 | toàn DB | sql | đối soát | 4 đơn đã huỷ có dùng điểm: Σ sổ theo đơn = 0 (đã hoàn đủ) | 0 đơn còn lệch | 0 đơn lệch |  | PASS |
| R1-07 | toàn DB | sql | đối soát | usedCount không vượt usageLimit | 0 mã vượt | 56 mã, 0 vượt |  | PASS |
| R1-08 | toàn DB | sql | đối soát | mỗi user không vượt perUserLimit (đơn chưa huỷ) | 0 | 0 |  | PASS |
| R1-09 | toàn DB | sql | đối soát | tồn kho / reservedStock không âm | 0 biến thể | 0 |  | PASS |
| R1-10 | toàn DB | sql | đối soát | yêu cầu hoàn tiền đều gắn đơn có thật | 0 mồ côi | 0 |  | PASS |
| R1-11 | toàn DB | sql | đối soát | apps/api/scripts/reconcile-points.ts (DRY-RUN) trên DB lane 1 sau mọi ca | 0 user lệch ở lô STANDARD và CONVERTED | Lô STANDARD: 0 user lệch, chênh 0; Lô CONVERTED: 0 user lệch | cd apps/api && set -a && . ../../docs/2026-10-20-uat/tools/uat-harness/state/lane-1/lane.env && set +a && npx tsx scripts/reconcile-points.ts | PASS |
| R1-12 | toàn DB | sql | đối soát | apps/api/scripts/reconcile-wallet.ts trên DB lane 1 sau mọi ca | 0 user lệch ví | User bị lệch 0; chênh ròng 0đ | npx tsx scripts/reconcile-wallet.ts (cùng env) | PASS |

