# U1 — Mua hàng: khách mới quét thẻ hộp hàng sàn, khách quay lại

Làn 1 của bộ khung UAT (`docs/2026-10-20-uat/tools/uat-harness/README.md`).

- **Máy chạy:** API thật chạy từ `apps/api/dist` ở cổng 3211, Mini App (Vite thật, zmp-sdk giả) ở cổng 3213, giả Pancake ở cổng 3218.
- **Dữ liệu:** Postgres 25432, DB `tubutree_uat_l1`; Redis 26379 db 1.
- **Màn hình:** khổ 390×844, Chromium. Luồng mua cốt lõi chạy lại trên WebKit, các dòng `-WK`.
- **Mã nguồn:** worktree `uat/2026-10-20`, HEAD `b2a42a53`. Từ nền `65491d96` tới HEAD không có commit nào đổi `apps/`: `git diff --stat 65491d96..HEAD -- apps` rỗng.
- **Phạm vi:** không sửa mã ứng dụng. Chỉ ghi báo cáo này, ảnh và script.

**Kết quả:** 35 lượt chạy, gồm 31 PASS, 4 FAIL, 0 BLOCKED.

- Chromium: 29 ca (U1-01..U1-29), 25 PASS, 4 FAIL.
- WebKit: 6 lượt chạy lại luồng cốt lõi (U1-01, U1-11, U1-18, U1-19, U1-26, U1-27), 6 PASS.
- FAIL: U1-07, U1-10, U1-20, U1-24. Chi tiết ở mục "Lỗi tìm thấy".
- Ngoài ra có 2 ghi nhận từ ca PASS: U1-B03 (từ U1-14) và U1-B05 (từ U1-08).

## Chạy lại

```bash
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
bash docs/2026-10-20-uat/tools/uat-harness/lane-up.sh 1
cd docs/2026-10-20-uat/uat/scripts/U1-mua-hang
node u1-a-claim.mjs                 # U1-01..05  quét thẻ ?claim=, đăng nhập, nhận mã
node u1-b-browse-cart.mjs           # U1-06..10  trang chủ khách mới, duyệt/tìm/lọc, chi tiết SP, giỏ
node u1-c-voucher-cod.mjs           # U1-11..17  mã thẻ, WELCOME30, FREESHIP, XANH10, voucher chào mừng, COD
node u1-d-bank.mjs                  # U1-18..24  chuyển khoản QR + giả webhook ngân hàng/Pancake
node u1-e-flash-points-returning.mjs  # U1-25..29 giờ vàng, Điểm Xanh, khách quay lại, sinh nhật, win-back
U1_BROWSER=webkit node u1-a-claim.mjs U1-01   # WebKit, kết quả ghi results/<id>-WK.json
U1_BROWSER=webkit node u1-c-voucher-cod.mjs U1-11
U1_BROWSER=webkit node u1-d-bank.mjs U1-18 U1-19
U1_BROWSER=webkit node u1-e-flash-points-returning.mjs U1-26 U1-27
bash ../../../tools/uat-harness/lane-down.sh 1
```

- Mỗi script nhận danh sách ID để chạy một phần, ví dụ `node u1-d-bank.mjs U1-20`.
- Kết quả từng ca nằm ở `scripts/U1-mua-hang/results/<id>.json`. File gồm mọi phép kiểm, response rút gọn, truy vấn SQL và kết quả.
- Ảnh nằm ở `shots/U1-mua-hang/`.
- Thư viện chung là `scripts/U1-mua-hang/u1-lib.mjs`. Nó tạo khách mới bằng cách chèn bản ghi qua Prisma vào DB làn, thêm hàng vào giỏ và đặt đơn bằng API thật, gọi `bank-webhook.mjs` và `run-job.mjs` của bộ khung.

## Luật đối chiếu

Luật lấy từ mã và cấu hình đã nạp trong DB làn (`system_configs`, `coupons`, `membership_tiers`).

- **Mã thẻ HOPSAN-\*:** 30 mã, scope CLAIM, giảm 30.000đ cho đơn từ 199.000đ, chỉ khách mới, mỗi mã dùng 1 lần.
- **Mã công khai:**
  - WELCOME30: 30.000đ, đơn từ 199.000đ, mỗi khách dùng 1 lần.
  - FREESHIP: đơn từ 99.000đ, mỗi khách dùng 3 lần.
  - XANH10: giảm 10%, tối đa 50.000đ, đơn từ 250.000đ, mỗi khách dùng 2 lần.
- **Voucher chào mừng `WELCOME-<id>`:** 30.000đ, đơn từ 199.000đ, hạn 30 ngày.
- **Gộp mã:** mỗi đơn chỉ dùng 1 mã. Mã áp sau thay mã trước.
- **Thứ tự trừ:** combo, rồi mã, rồi giảm theo hạng, rồi Điểm Xanh. Hàng giờ vàng không tính vào nền của mã.
- **Phí giao:**
  - Đơn đầu được miễn phí giao khi tiền hàng trước mã từ 199.000đ (`shipping.first_order_free_min_subtotal`).
  - Ngưỡng miễn phí chung là 200.000đ. Dưới ngưỡng tính 19.000đ.
  - Hạng Lộc Biếc miễn phí từ 99.000đ.
- **Điểm Xanh:**
  - Tích 2% × hệ số hạng trên tiền hàng sau mọi khoản giảm. Hệ số: Mầm Xanh 1, Lộc Biếc 1,2, Đại Thụ 1,5, Cổ Thụ 2.
  - Mỗi đơn dùng tối đa 20% giá trị hàng (`loyalty.max_redeem_pct` 0,2). 1 điểm = 1đ.
  - Điểm của đơn còn trong hạn đổi/trả 7 ngày thì chưa dùng được.
- **Chuyển khoản:**
  - Tài khoản nhận: Techcombank (BIN 970407), số 8386790906, CONG TY TNHH TUBU TREE. Nội dung chuyển = mã đơn.
  - Hạn chuyển là 24 giờ. Quá hạn thì cron `orders.pending-payment-expiry` huỷ đơn, trả kho, trả mã và hoàn điểm.
  - Khoản chuyển thừa do Pancake báo được ghi OVERPAYMENT trạng thái UNVERIFIED. Khách chỉ được báo sau khi admin "Xác nhận tiền dư" (`apps/api/src/modules/orders/refund-queue.ts:319-322`).
  - Tiền về sau khi đơn đã huỷ được ghi LATE_PAYMENT trạng thái PENDING, và khách được báo để chọn nơi nhận tiền hoàn.
- **Giờ vàng:**
  - Mỗi khách mua tối đa 2 suất. Nếu số lượng vượt số suất còn được mua, cả dòng tính giá thường kèm lời báo (`apps/api/src/modules/flash-sale/flash-line-price.ts:24-31`).
  - Hết suất thì về giá thường. Nếu suất hết đúng lúc đặt thì không ghi đơn với giá giờ vàng.
- **Voucher theo dịp:**
  - Sinh nhật: mức theo hạng (Lộc Biếc 50.000đ), không có đơn tối thiểu, hạn 30 ngày. Ngày sinh chỉ đặt được một lần.
  - Win-back: cấp khi đơn cuối đã quá 60 ngày, giảm 50.000đ, hạn 21 ngày.

## Bảng ca

| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | Kết quả |
|---|---|---|---|---|---|---|---|
| U1-01 | Khách mới (có SĐT) | Quét QR thẻ hộp Shopee → mở Mini App → tự đăng nhập → nhận mã | Mở `/?claim=HOPSAN-…&src=shopee` | Sheet "Bạn nhận được ưu đãi", "Giảm 30.000đ cho đơn từ 199.000đ", nêu mã + "Dành cho đơn đầu tiên"; 1 lần POST /coupons/claim; 1 dòng `coupon_claims`; chạm đầu ghi source=shopee; mã chờ xoá khỏi máy; ví có mã thẻ + WELCOME-… | Đúng như kỳ vọng; claim 201 một lần; hạn mã 60,0 ngày | `results/U1-01.json` (SQL `coupon_claims` 1 dòng, localStorage giải mã), `shots/U1-mua-hang/U1-01-claim-ok.png` | PASS |
| U1-02 | Khách chưa đăng nhập (guest thật qua /auth/guest) | Quét thẻ khi là khách → đăng nhập Zalo → tự nhận mã | Mở link claim khi guest → "Đăng nhập bằng Zalo" (nâng cấp guest như `auth.service.ts:295-311`) | Sheet "Đăng nhập Zalo để nhận ưu đãi", không gọi claim khi còn guest, mã giữ ở `tubu_pending_claim`; sau đăng nhập tự claim 201, mã thuộc đúng id đã nâng cấp | Đúng như kỳ vọng | `results/U1-02.json` (SQL `coupon_claims.userId` = id guest đã nâng cấp) | PASS (phần Zalo phía server do bộ khung giả, xem Hạn chế 1) |
| U1-03 | Khách quay lại (đã có đơn) | Quét thẻ khách mới | Mở link claim | "Chưa nhận được ưu đãi" + "Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree."; 0 dòng claim | Đúng như kỳ vọng | `results/U1-03.json` | PASS |
| U1-04 | Khách mới thứ hai | Quét thẻ đã có người nhận | Mở link claim mã của U1-01 | "Mã giảm giá này đã được tài khoản khác nhận." | Đúng | `results/U1-04.json` | PASS |
| U1-05 | Khách mới | Mã thẻ sai / hết hạn / quét lại thẻ của mình | (a) HOPSAN-KHONGCO99; (b) lùi `endAt` một mã về hôm qua; (c) khách U1-01 mở lại link | (a) "Mã giảm giá không tồn tại…"; (b) "Mã giảm giá đã hết hạn."; (c) "Ưu đãi đã có trong ví của bạn", vẫn 1 claim | Đúng (c cần U1-01 chạy trước, script tự ghi chú nếu thiếu) | `results/U1-05.json`, `shots/U1-mua-hang/U1-05-claim-expired.png` | PASS |
| U1-06 | Khách mới / khách quay lại | Trang chủ khách mới (`home.new_customer_layout`) | Mở `/` hai vai | Khách mới: "Quà khách mới" trên "Danh mục" trên "Ưu đãi giờ vàng", nêu voucher 30.000đ từ 199.000đ, freeship đơn đầu từ 199.000đ, 2% Điểm Xanh 1 điểm = 1đ; khách quay lại: không có "Quà khách mới", có "Mua lại" | Đúng (toạ độ y các vùng trong JSON) | `results/U1-06.json`, `shots/U1-mua-hang/U1-06-home-new.png`, `U1-06-home-returning.png` | PASS |
| U1-07 | Khách mới | Duyệt / tìm / lọc / sắp xếp | Tìm "mat ong"; danh mục Tẩy rửa sinh học; sắp xếp "Giá tăng"; lọc "Dưới 100k" | Tìm không dấu ra Mật ong; tập SP danh mục = DB; "Giá tăng" xếp theo giá khách thấy; lọc < 100.000đ; số trên "Xem N sản phẩm" = total API | Tìm/danh mục/lọc đúng (13 SP); **"Giá tăng" xếp theo `basePrice`**: trang 1 có 6 chỗ đảo, vd "Nước rửa tay 89.000đ" đứng trước "Cà phê sữa hoà tan 75.000đ", "Cà phê phin 95.000đ" trước "Son dưỡng gấc 79.000đ" | `results/U1-07.json` (danh sách đảo), `shots/U1-mua-hang/U1-07-sort-price-asc.png`, `U1-07-search.png`, `U1-07-category.png`, `U1-07-filter-under-100k.png` | FAIL → U1-B01 (đã biết C-035) |
| U1-08 | Khách mới | Chi tiết SP giờ vàng + SP thường | Mở PDP Hạt điều BHN-CW-500 và Nước rửa chén 1L; thêm 2 chai | PDP giờ vàng 119.000đ; SP thường 120.000đ + "Nhận tối đa 2.400 Điểm Xanh"; thêm 2 → `cart_items.quantity` 2 | Đúng. Ghi nhận: PDP gạch 180.000đ, nhãn -34%, còn dải giờ vàng trang chủ gạch 159.000đ, nhãn -25% cho cùng SP | `results/U1-08.json`, `shots/U1-mua-hang/U1-08-pd-flash.png`, `U1-27-home-rebuy.png` | PASS (ghi nhận → U1-B05) |
| U1-09 | Khách mới | Sửa giỏ | Tăng, giảm, xoá dòng | DB `cart_items` đổi theo; tạm tính 233.000đ → 79.000đ | Đúng | `results/U1-09.json`, `shots/U1-mua-hang/U1-09-cart-edit.png` | PASS |
| U1-10 | Khách mới | Giỏ có hàng hết | `variations.stock`=0 cho COBOTE-PW-100 (qty 2) + 1 SP còn hàng; rồi stock=1 | Dòng "Sản phẩm đã hết hàng", khoá Thanh toán, lời nhắc nói đúng việc (xoá/bỏ chọn hàng hết), tạm tính không cộng hàng hết; bỏ chọn → "Thanh toán (1)"; stock 1 < qty 2 → nhắc giảm số lượng | Khoá đúng; bỏ chọn đúng; stock 1 đúng. **Lời nhắc "Giảm số lượng sản phẩm vượt tồn kho để thanh toán."** (tồn 0 thì giảm về 1 vẫn khoá: `cart.tsx:192` `quantity > stock`); **tạm tính 233.000đ vẫn cộng dòng hết hàng** và vẫn hiện "Bạn được miễn phí ship" | `results/U1-10.json`, `shots/U1-mua-hang/U1-10-cart-oos.png`, `U1-10-cart-overstock.png` | FAIL → U1-B02 |
| U1-11 | Khách mới (đã nhận thẻ, có voucher chào mừng) | Mã thẻ 30k + freeship đơn đầu → thêm địa chỉ → COD | Giỏ 120k + 79k = 199.000đ → nhập mã thẻ → "Thanh toán (2)" → form "Thêm địa chỉ mới" → COD → "Đặt hàng · 169.000đ" | Giảm 30.000đ; ship 0 (tiền hàng 199.000đ ≥ 199.000đ dù sau mã 169.000đ < 200.000đ); tổng 169.000đ; điểm dự kiến 3.380; DB CONFIRMED/COD | Đơn TUBU2026101996573: subtotal 199000, couponDiscount 30000, shippingFee 0 (firstOrderShipWaived 19000), total 169000, pointsEarned 3380; 1 redemption, usedCount 1/1; tồn kho mỗi SKU −1 (reservedStock +1); giỏ trống; giả Pancake nhận cod 169000, total_discount 30000 | `results/U1-11.json` (SQL đơn + dòng + redemption + tồn kho), `shots/U1-mua-hang/U1-11-checkout.png`, `U1-11-placed.png` | PASS |
| U1-12 | Khách mới / khách cũ | Mã thẻ sai điều kiện | (a) giỏ 194k; (b) giỏ toàn hàng giờ vàng 390k; (c) khách đã có đơn nhập mã thẻ | (a) "Đơn tối thiểu 199.000đ để dùng mã này."; (b) báo hàng giờ vàng không tính, phần được tính 0đ; (c) chỉ khách mới, claims không đổi, giỏ không gắn mã | Đúng cả 3 | `results/U1-12.json`, `shots/U1-mua-hang/U1-12a-card-min-order.png`, `U1-12c-card-returning.png` | PASS |
| U1-13 | Khách mới | Voucher chào mừng rồi WELCOME30 | Đơn 1: "Dùng mã" Quà chào mừng; đơn 2: WELCOME30 210k; đơn 3: WELCOME30 lần nữa | Đơn 1 tổng 169.000đ; đơn 2 giảm 30.000đ, ship 0, tổng 180.000đ (khách mới giảm 2 lần, luật A4); lần 3 "Bạn đã dùng hết lượt cho mã này." | Đúng: TUBU2026101928741 total 169000; TUBU2026101966976 WELCOME30 couponDiscount 30000 total 180000; WELCOME30 đúng 1 lượt của khách | `results/U1-13.json` | PASS |
| U1-14 | Khách mới / khách đã có đơn | FREESHIP | (a) đơn đầu 199k (đã miễn ship) áp FREESHIP; (b) khách đã có đơn giỏ 120k không mã rồi FREESHIP | (a) không tiêu lượt; (b) không mã ship 19.000đ tổng 139.000đ; FREESHIP ship 0 tổng 120.000đ, 1 lượt | Tiền đúng: (a) đơn không ghi couponCode, 0 lượt; (b) TUBU2026101963213 FREESHIP, shippingFee 0, total 120000. **Chữ lệch:** ở giỏ snackbar báo "Đã áp dụng mã FREESHIP", sang checkout lại báo "Mã chưa được áp dụng cho đơn này: Mã miễn phí vận chuyển chỉ áp cho phí giao hàng do Tubu Tree giao, và đơn này không có phí giao đó." | `results/U1-14.json`, `shots/U1-mua-hang/U1-14a-checkout.png`, `U1-14b-nocoupon-checkout.png`, `U1-14b-freeship-checkout.png` | PASS (ghi nhận → U1-B03) |
| U1-15 | Khách đã có đơn | XANH10 | Giỏ < 250k; giỏ 595k | "Đơn tối thiểu 250.000đ để dùng mã này."; 595k giảm trần 50.000đ, tổng 545.000đ, điểm 10.900 | Đúng: TUBU2026101982315 couponDiscount 50000, total 545000, pointsEarned 10900 | `results/U1-15.json`, `shots/U1-mua-hang/U1-15b-*.png` | PASS |
| U1-16 | Khách mới | Chữ báo lỗi mã | Mã tạo qua `POST /admin/coupons`: hết hạn, hết lượt, ngừng, sai hạng; mã không có | "Mã giảm giá đã hết hạn hoặc chưa hiệu lực.", "…đã hết lượt sử dụng.", "…đã ngừng áp dụng.", "Mã chỉ áp dụng cho hạng thành viên khác.", "Mã giảm giá không tồn tại." ở cả API lẫn snackbar; giỏ không gắn mã | Đúng cả 5 | `results/U1-16.json`, `shots/U1-mua-hang/U1-16-coupon-errors.png` | PASS |
| U1-17 | Khách đã có đơn | Gộp mã | Áp WELCOME30 rồi XANH10 trên giỏ 278k → đặt COD | Sheet có câu "Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá"; mã sau thay mã trước; giảm 27.800đ, ship 0, tổng 250.200đ; 0 lượt WELCOME30 | Đúng: TUBU2026101997634 chỉ XANH10, couponDiscount 27800, total 250200 | `results/U1-17.json` | PASS |
| U1-18 | Khách mới | Đặt chuyển khoản → màn QR | Giỏ 199k → "Chuyển khoản ngân hàng" → "Đặt hàng · 199.000đ" | Màn ghi Ngân hàng TMCP Kỹ Thương Việt Nam, 8386790906, CONG TY TNHH TUBU TREE, 199.000đ, nội dung = mã đơn, hạn 24 giờ; VietQR đúng BIN/STK/số tiền/nội dung, CRC đúng; DB PENDING_PAYMENT/UNPAID, kho đã giữ | Đúng. Ảnh QR `img.vietqr.io/image/970407-8386790906-compact2.png?amount=199000&addInfo=<mã>`; EMV: 38 = 970407/8386790906/QRIBFTTA, 54 = 199000, 62-08 = mã đơn, CRC khớp; deadline − createdAt = 24,00 giờ; "Vui lòng chuyển khoản trước 23:20 20/10/2026…" | `results/U1-18.json`, `shots/U1-mua-hang/U1-18-bank-qr.png` | PASS |
| U1-19 | Khách mới | Chuyển đủ | Màn QR mở → `bank-webhook.mjs <mã> 199000` | Màn tự đổi "Đã nhận thanh toán!"; DB CONFIRMED/PAID, paidAt; 0 khoản hoàn | Đúng: TUBU2026101908988 CONFIRMED/PAID, paidAt có, pancakeAttention null | `results/U1-19.json`, `shots/U1-mua-hang/U1-19-bank-paid.png` | PASS |
| U1-20 | Khách mới | Chuyển thiếu rồi chuyển bù | (a) chuyển 100k → xem màn QR, chi tiết đơn, thông báo → chuyển bù 99k; (b) đơn khác: chuyển 100k rồi quét lại QR đang hiện | Sau 100k: UNPAID, admin có "Khách chuyển thiếu…", khách được báo còn thiếu 99.000đ; **màn QR/VietQR đổi sang 99.000đ** khớp lời báo "chuyển thêm phần còn thiếu"; bù 99k → PAID; (b) quét lại QR không làm khách chuyển dư | Đúng phần DB/thông báo: `pancakeAttention` "Khách chuyển thiếu: Pancake ghi nhận 100.000đ/199.000đ, còn thiếu 99.000đ…", `pancakePaidReported` 100000, thông báo ORDER_UNDERPAID "Tubu đã nhận 100.000đ…, còn thiếu 99.000đ…"; bù 99k → PAID. **Nhưng màn QR vẫn 199.000đ, `GET /payments/bank-qr` amount 199000, EMV 54 = 199000**; chi tiết đơn chỉ ghi "Chờ thanh toán". (b) khách quét lại → Pancake ghi 299.000đ → OVERPAYMENT 100.000đ UNVERIFIED, khách không được báo | `results/U1-20.json` (TUBU2026101949885, TUBU2026101949225), `shots/U1-mua-hang/U1-20-bank-short-qr.png`, `U1-20-bank-short-order.png` | FAIL → U1-B04 |
| U1-21 | Khách mới | Chuyển thừa | Chuyển 249k cho đơn 199k | PAID; OVERPAYMENT 50.000đ UNVERIFIED; admin nhận OPS_REFUND_ALERT; khách chưa được báo hoàn (luật `refund-queue.ts:319-322`) | Đúng: TUBU2026101975873 PAID; `order_customer_refunds` OVERPAYMENT 50000 UNVERIFIED refKey `PANCAKE:paid:249000`; `notification_logs` OPS_REFUND_ALERT cho uat_admin "…có thể khách chuyển dư 50.000đ. Khách CHƯA được báo…"; khách chỉ có ORDER_CONFIRMED | `results/U1-21.json`, `shots/U1-mua-hang/U1-21-bank-over.png` | PASS |
| U1-22 | Khách mới | Webhook gửi trùng / chuyển hai lần | (a) đơn đã PAID: gửi y hệt một body webhook đơn hai lần; (b) chuyển đủ 199k hai lần | (a) lần 2 gộp vào cùng dòng `pancake_webhook_events` (dedupeKey), paidAt không đổi, 0 khoản hoàn; (b) PAID + OVERPAYMENT 199.000đ | (a) TUBU2026101994786: lần 2 HTTP 200 `{"received":true,"duplicate":true}`, cùng event id, 1 dòng theo dedupeKey, paidAt giữ nguyên, 0 khoản hoàn; (b) TUBU2026101932501 PAID, OVERPAYMENT 199000 UNVERIFIED refKey `PANCAKE:paid:398000` | `results/U1-22.json` | PASS |
| U1-23 | Khách mới | Chuyển sai nội dung | Chuyển 199k nội dung "chuyen tien hang" | Pancake không ghép được (không webhook); đơn vẫn PENDING_PAYMENT/UNPAID; màn vẫn "Đang chờ thanh toán…" | Đúng: TUBU2026101925720 `matched:false`, UNPAID | `results/U1-23.json`, `shots/U1-mua-hang/U1-23-bank-wrong-memo.png` | PASS |
| U1-24 | Khách mới (dùng voucher chào mừng) | Quá hạn chuyển khoản | Lùi `createdAt` 25 giờ → `run-job PendingPaymentExpiryCron.expireStale` → màn QR đang mở và mở lại → chuyển 169k muộn | CANCELLED; voucher trả lượt; kho trả; màn QR (đang mở và mở lại) thôi hiện STK/QR và nói rõ đơn đã huỷ; tiền muộn: đơn không sống lại, LATE_PAYMENT 169.000đ, khách được báo | DB đúng: TUBU2026101994494 CANCELLED (job scanned 1, cancelled 1); WELCOME-… usedCount 1→0, 0 redemption; FUWA-DW-1L stock 180→181, reserved 20→19; tiền muộn → vẫn CANCELLED, LATE_PAYMENT 169000 PENDING; thông báo ORDER_PAYMENT_EXPIRED + REFUND_LATE_PAYMENT. **Màn QR đang mở vẫn hiện đủ QR, 8386790906, 169.000đ sau khi đơn huỷ**; mở lại thì chỉ "Không tải được thông tin thanh toán." + "Thử lại" | `results/U1-24.json`, `shots/U1-mua-hang/U1-24-bank-expired-open.png`, `U1-24-bank-expired.png` | FAIL → D14-02 (đã biết, còn mở) |
| U1-25 | Khách mới A/B/C | Giờ vàng | (a) A: PDP Hạt điều → 2 hộp → COD; (b) A mua thêm 1; (c) B bỏ 3 hộp; (d) C ở checkout 1 hũ mật ong 195k thì suất hết (`soldCount` = quota) → Đặt hàng; (e) mở PDP khi hết suất | (a) 119.000đ, đơn 238.000đ ship 0, dòng flash, soldCount +2, purchases 2, điểm 4.760; (b) 159.000đ + "Bạn đã dùng hết suất giờ vàng…"; (c) cả dòng 159.000đ + "Giá giờ vàng chỉ áp dụng tối đa 2 sản phẩm cho bạn…"; (d) không ghi đơn, hỏi lại giá; (e) 260.000đ | Đúng cả 5. (d) API 400 `TOTAL_CHANGED` "Tổng tiền đơn vừa thay đổi từ 214.000đ thành 260.000đ…", màn hiện hộp "Tổng tiền đơn vừa thay đổi", 0 đơn, soldCount 50/50 | `results/U1-25.json` (TUBU2026101958498; SQL `flash_sale_items`, `flash_sale_purchases`), `shots/U1-mua-hang/U1-25*.png` | PASS |
| U1-26 | Khách có Điểm Xanh (tích thật từ đơn đã giao) | Dùng điểm khi thanh toán | Đơn 4 can 5L 1.720.000đ → webhook giao xong → (a) checkout 120k; (b) lùi `deliveredAt` 8 ngày → tick Điểm Xanh → COD; (c) giỏ 430k → tick → COD | +34.400 điểm (ORDER_DELIVERED); (a) điểm trong hạn đổi/trả: ô khoá, API pointsUsed 0; (b) trần 20% = 24.000 điểm, tổng 96.000đ, điểm tích 2% × 1,2 × 96.000 = 2.304, sổ −24.000; (c) dùng hết 10.400, tổng 419.600đ, điểm 10.070, số dư 0; sổ = số dư mọi lúc | Đúng cả 3. (a) ô "34.400 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được", aria-disabled; (b) TUBU2026101969378 pointsUsed 24000, ORDER_REDEEM −24000, số dư 10400 = sổ; (c) TUBU2026101974204 pointsUsed 10400, số dư 0 = sổ | `results/U1-26.json` (SQL `points_transactions` + `users.pointsBalance` từng bước), `shots/U1-mua-hang/U1-26*.png` | PASS |
| U1-27 | Khách quay lại (uat_returning, Lộc Biếc, 34.400 điểm) | Mua lại → địa chỉ cũ → COD | Trang chủ kệ "Mua lại" → "Mua lại" → "Thêm vào giỏ (1)" → giỏ → Thanh toán → COD; thêm báo giá API 120k | Sang giỏ 1 can 430.000đ; địa chỉ mặc định 12 Lê Lợi chọn sẵn; không tự tiêu điểm; ship 0; điểm 10.320 (×1,2); số dư không đổi; 120k → ship 0 (Lộc Biếc từ 99k) | Đúng: TUBU2026101928490 COD total 430000, pointsEarned 10320, pointsUsed 0, `shippingAddress` 12 Lê Lợi / Phường Bến Thành; số dư 34.400 giữ nguyên; báo giá 120k shippingFee 0, điểm 2.880 | `results/U1-27.json`, `shots/U1-mua-hang/U1-27-*.png` | PASS |
| U1-28 | Khách Lộc Biếc sinh nhật hôm nay | Voucher sinh nhật | PATCH /me dob (ngày hôm nay) → đổi lần 2 → `run-job VouchersService.birthdayVouchers` → giỏ 120k → nhập mã → COD | Mã BIRTHDAY-2026-10-… 50.000đ, không tối thiểu, 30 ngày, USER_GROUP; thông báo BIRTHDAY_VOUCHER; đơn giảm 50.000đ; đổi ngày sinh lần 2 bị chặn | Đúng: đổi lần 2 → 400 "Ngày sinh chỉ có thể đặt một lần…"; TUBU2026101917257 couponDiscount 50000, total 70000, 1 redemption | `results/U1-28.json`, `shots/U1-mua-hang/U1-28-*.png` | PASS |
| U1-29 | Khách lâu không quay lại | Voucher win-back | Đơn đã giao, lùi `createdAt` 61 ngày → `run-job VouchersService.winbackVouchers` → giỏ 240k → nhập mã → COD; đối chứng uat_returning (đơn cuối 40 ngày) | Mã WINBACK-… 50.000đ, 21 ngày, thông báo WINBACK_VOUCHER; đơn giảm 50.000đ; uat_returning không có mã | Đúng: TUBU2026101933213 couponDiscount 50000, total 190000, 1 redemption; uat_returning 0 mã WINBACK | `results/U1-29.json`, `shots/U1-mua-hang/U1-29-*.png` | PASS |
| U1-01-WK | như U1-01 | Quét thẻ → nhận mã, WebKit | như U1-01 | như U1-01 | Đúng cả 10 phép kiểm | `results/U1-01-WK.json`, `shots/U1-mua-hang/U1-01-claim-ok-webkit.png` | PASS |
| U1-11-WK | như U1-11 | Mã thẻ + freeship đơn đầu + thêm địa chỉ + COD, WebKit | như U1-11 | như U1-11 | Đúng cả 14 phép kiểm: TUBU2026101975832 subtotal 199000, couponDiscount 30000, shippingFee 0, total 169000, pointsEarned 3380, paidTotal 101910 + 67090 = 169000, usedCount 1/1, tồn kho −1, giả Pancake cod 169000 | `results/U1-11-WK.json`, `shots/U1-mua-hang/U1-11-checkout-webkit.png`, `U1-11-placed-webkit.png` | PASS |
| U1-18-WK | như U1-18 | Màn QR chuyển khoản, WebKit | như U1-18 | như U1-18 | Đúng cả 12 phép kiểm (TUBU2026101928027) | `results/U1-18-WK.json`, `shots/U1-mua-hang/U1-18-bank-qr-webkit.png` | PASS |
| U1-19-WK | như U1-19 | Chuyển đủ → màn tự đổi, WebKit | như U1-19 | như U1-19 | Đúng: TUBU2026101976860 CONFIRMED/PAID, màn "Đã nhận thanh toán!" | `results/U1-19-WK.json`, `shots/U1-mua-hang/U1-19-bank-paid-webkit.png` | PASS |
| U1-26-WK | như U1-26 | Điểm Xanh khoá / trần 20% / số dư, WebKit | như U1-26 | như U1-26 | Đúng cả 13 phép kiểm: TUBU2026101973415 pointsUsed 24000, TUBU2026101973463 pointsUsed 10400, số dư 34400 → 10400 → 0 = tổng sổ | `results/U1-26-WK.json`, `shots/U1-mua-hang/U1-26*-webkit.png` | PASS |
| U1-27-WK | như U1-27 | Mua lại → địa chỉ cũ → COD, WebKit | như U1-27 | như U1-27 | Đúng cả 8 phép kiểm: TUBU2026101999987 total 430000, pointsEarned 10320, 12 Lê Lợi | `results/U1-27-WK.json`, `shots/U1-mua-hang/U1-27-*-webkit.png` | PASS |

## Lỗi tìm thấy

Đã tra trùng trong `docs/2026-10-review/findings-catalog.md`, `docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md`, `impl/*.md` và các báo cáo D1–D15 của đêm nay. Vùng file theo `project-uat-partition`: api, miniapp và admin thuộc phiên UAT.

### U1-B01 — P2 — agent sửa ngay — đã biết C-035 / A1-037, còn mở

- **Vị trí:** sắp xếp "Giá tăng/Giá giảm" dùng `basePrice` (`apps/api/src/modules/catalog/catalog.service.ts:474-480`). Bộ lọc giá và thẻ SP lại dùng giá đang bán `salePrice ?? basePrice` (`:207-209`). Catalog ghi dòng cũ `:379-382`. Mã đã dời nhưng chưa sửa.
- **Kịch bản:** mở Danh mục, chọn "Giá tăng". Trang 1 có 6 cặp đảo, vd "Nước rửa tay sinh học Fuwa3e 89.000đ" đứng trước "Cà phê sữa hoà tan Le Plateau 75.000đ".
- **Bằng chứng:** `results/U1-07.json`.
- **Tái hiện:** `node u1-b-browse-cart.mjs U1-07`.
- **Đề xuất:** sắp theo giá đang bán. Có thể thêm cột tính sẵn, hoặc `orderBy` theo `COALESCE("salePrice","basePrice")` bằng raw. Test: sản phẩm có sale rẻ hơn base của sản phẩm khác phải đứng trước.

### U1-B02 — P3 — agent sửa ngay — mới

- **Vị trí:** giỏ có dòng hết hàng (tồn 0). Thanh dưới báo "Giảm số lượng sản phẩm vượt tồn kho để thanh toán." (`apps/miniapp/src/i18n/vi.ts:230`, hiện ở `apps/miniapp/src/pages/cart.tsx:730-734`). Tạm tính vẫn cộng dòng hết hàng (`cart.tsx:189` `selectedSubtotal` cộng mọi dòng đang chọn). Thanh tiến độ vẫn báo "Bạn được miễn phí ship".
- **Kịch bản:** giỏ có COBOTE-PW-100 ×2 (tồn 0) và 1 SP 75.000đ.
  - Màn ghi tạm tính 233.000đ và báo "giảm số lượng". Tồn 0 thì giảm về 1 vẫn bị khoá, vì điều kiện khoá là `quantity > stock` (`cart.tsx:192`). Kết luận này đọc từ mã, bước giảm chưa chạy riêng.
  - Khách phải tự đoán là cần bỏ chọn hoặc xoá dòng đó. Bỏ chọn thì "Thanh toán (1)" mở, giá 75.000đ.
- **Bằng chứng:** `results/U1-10.json`, `shots/U1-mua-hang/U1-10-*.png`.
- **Tái hiện:** `node u1-b-browse-cart.mjs U1-10`. Script tự trả tồn kho trong `finally`.
- **Đề xuất:**
  - Tồn 0 thì báo "Bỏ chọn hoặc xoá sản phẩm đã hết hàng để thanh toán".
  - Tạm tính và thanh freeship bỏ dòng hết hàng, hoặc tự bỏ chọn dòng đó.
  - Test vitest cho cart.tsx với một dòng `stock: 0`.

### U1-B03 — P3 — agent sửa ngay — mới

- **Vị trí:** đơn đầu đã được miễn phí giao nhờ freeship đơn đầu. Khách áp FREESHIP.
  - Ở giỏ: `cart.service.ts:185-186` trả `freeship: true`, nên `apps/miniapp/src/components/checkout/voucher-sheet.tsx:85-89` coi là áp thành công và hiện "Đã áp dụng mã FREESHIP".
  - Ở checkout: báo "Mã chưa được áp dụng cho đơn này: Mã miễn phí vận chuyển chỉ áp cho phí giao hàng do Tubu Tree giao, và đơn này không có phí giao đó." (`apps/api/src/modules/coupons/coupon-notice.ts:8-9`).
- **Kịch bản:** hai màn liền nhau nói ngược nhau. Câu "không có phí giao đó" cũng không nói lý do là đơn đầu đã được miễn phí.
- **Tiền:** đúng. Không tiêu lượt, đơn không ghi mã.
- **Bằng chứng:** `results/U1-14.json` bước (a).
- **Tái hiện:** `node u1-c-voucher-cod.mjs U1-14`.
- **Đề xuất:**
  - Giỏ biết đơn đầu đã được miễn phí giao thì báo luôn "Đơn đầu đã được miễn phí giao, mã FREESHIP được giữ cho đơn sau".
  - Hoặc thêm lý do riêng "đã miễn phí giao (đơn đầu từ 199.000đ)".
  - Test cho voucher-sheet với `freeship: true` cùng `couponNotice`.

### U1-B04 — P2 — agent sửa ngay — mới

- **Vị trí:**
  - Khi khách chuyển thiếu, màn QR và mã VietQR vẫn đòi đủ tổng đơn. `apps/api/src/modules/integrations/payment/bank-transfer.service.ts:61-72` dựng `qrString`, `qrImageUrl` và `amount` từ `order.total`, bỏ qua `orders.pancakePaidReported`.
  - `apps/miniapp/src/pages/bank-payment.tsx:191`, `:199` hiện `data.amount`. Màn không có dòng "đã nhận / còn thiếu".
  - Chi tiết đơn chỉ ghi "Chờ thanh toán".
- **Kịch bản:** đơn 199.000đ, khách chuyển 100.000đ.
  - Thông báo ORDER_UNDERPAID dặn "chuyển thêm phần còn thiếu" 99.000đ.
  - Màn QR vẫn ghi 199.000đ, và VietQR có trường 54 = 199000.
  - Khách quét lại QR, chuyển 199.000đ. Pancake ghi 299.000đ. Hệ thống ghi OVERPAYMENT 100.000đ trạng thái UNVERIFIED.
  - Khách không được báo cho tới khi admin đối soát sao kê.
- **Bằng chứng:** `results/U1-20.json`.
  - `GET /payments/bank-qr` sau 100k: `{"amount":199000,"emvAmount":"199000","pancakePaidReported":100000}`.
  - Bước (b): `refunds:[{"kind":"OVERPAYMENT","amount":100000,"status":"UNVERIFIED","refKey":"PANCAKE:paid:299000"}]`.
  - Ảnh `shots/U1-mua-hang/U1-20-bank-short-qr.png`.
- **Tái hiện:** `node u1-d-bank.mjs U1-20`.
- **Đề xuất:**
  - Đơn PENDING_PAYMENT có `pancakePaidReported > 0` thì `amount` = `total − pancakePaidReported`. QR dùng số này.
  - Màn ghi "Đã nhận X, còn thiếu Y".
  - Test cho `bank-transfer.service`, và test cho `bank-payment.tsx` với `paidSoFar`.

### D14-02 — P2 — đã biết, còn mở — U1-24 xác nhận động

- **Vị trí:** `apps/miniapp/src/pages/bank-payment.tsx:30-36`, `:123-143`.
- **Kịch bản:** màn QR đang mở thì đơn bị huỷ vì quá hạn.
  - Màn vẫn hiện QR, 8386790906 và 169.000đ. Lượt poll nhận 400 "Đơn đã hủy/trả, không thể thanh toán." (`bank-transfer.service.ts:30-32`), nhưng react-query giữ dữ liệu cũ.
  - Mở lại màn thì chỉ thấy "Không tải được thông tin thanh toán." với nút "Thử lại" vô ích.
  - Phía máy chủ xử lý đúng: tiền về muộn được ghi LATE_PAYMENT và báo khách.
- **Bằng chứng:** `results/U1-24.json`, `shots/U1-mua-hang/U1-24-bank-expired-open.png`, `U1-24-bank-expired.png`.
- **Tái hiện:** `node u1-d-bank.mjs U1-24`.
- **Lưu ý:** dòng "Còn 23 giờ 59 phút" trên màn đang mở là do ca lùi `createdAt` trong DB. Đồng hồ phía khách tính từ lần tải đầu. Ngoài đời đồng hồ sẽ về "Đã quá hạn chuyển khoản", nhưng QR và STK vẫn hiện.

### U1-B05 — P3 — agent sửa ngay — mới

- **Vị trí:** cùng một SP giờ vàng hiện hai giá gạch và hai % khác nhau.
  - Dải "Ưu đãi giờ vàng" trên trang chủ gạch 159.000đ, nhãn -25% (`apps/miniapp/src/components/flash-sale.tsx:49-53`, `was = salePrice ?? retailPrice`).
  - Trang chi tiết và thẻ SP gạch 180.000đ, nhãn -34% (`apps/miniapp/src/components/catalog/catalog-pricing.ts:16-23`, % tính trên `basePrice`).
- **Kịch bản:** Hạt điều BHN-CW-500 có retail 180.000đ, sale 159.000đ, flash 119.000đ.
- **Bằng chứng:** `results/U1-08.json` (PDP "119.000đ | 180.000đ | … | -34%"), `shots/U1-mua-hang/U1-27-home-rebuy.png` (dải -25%).
- **Tái hiện:** `node u1-b-browse-cart.mjs U1-08`, rồi mở trang chủ.
- **Đề xuất:** chọn một mốc so sánh cho cả hai nơi. Test cho `tilePricing` và `flashDisplay` với cùng dữ liệu.

## Hạn chế bộ khung

Các mục dưới đây là hạn chế của bộ khung, không tính là FAIL.

1. **Đăng nhập Zalo phía server do bộ khung giả.** Bộ khung giả `/auth/zalo-mini-app` và `/auth/ensure-phone` bằng refresh token thật của làn. U1-02 mô phỏng bước nâng cấp guest bằng cách sửa DB, giống `auth.service.ts:295-311`. Nhánh gộp vào một tài khoản Zalo có sẵn chưa thử.
2. **Khách mới được chèn thẳng vào DB.** Script tạo khách bằng Prisma, không qua đăng nhập thật. Voucher chào mừng được cấp bằng `run-job VouchersService.grantWelcomeNow [id,{becameRealNow:true}]`, cùng hàm mà đường đăng nhập gọi. Cron cấp hằng giờ không được chờ.
3. **Thông báo chỉ kiểm phần trong app.** Chỉ kiểm `notification_logs` kênh INAPP. ZNS/OA tắt ở làn, nên tin Zalo tới khách là "chưa kiểm chứng".
4. **Ngân hàng do script đóng vai.** Không có webhook ngân hàng thật. `bank-webhook.mjs` đóng cả ngân hàng lẫn Pancake: cộng dồn `bank_payment` trên giả Pancake rồi bắn webhook đơn. Cách Pancake thật báo khoản thiếu hay khoản thừa (cộng dồn hay từng giao dịch) là "chưa kiểm chứng".
5. **Ảnh VietQR tải từ internet.** Ảnh lấy từ `img.vietqr.io`. Script không quét ảnh, mà giải mã chuỗi EMV `qrString` do API trả về để kiểm từng trường.
6. **Thời gian được dời trong DB.** Quá hạn chuyển khoản lùi `orders.createdAt` 25 giờ. Mở khoá điểm lùi `deliveredAt` 8 ngày. Win-back lùi `createdAt` 61 ngày. Cron được gọi tay bằng `run-job.mjs`. Các cron vẫn chạy theo lịch thật trong API làn.
7. **SP không có ảnh.** Ảnh chụp hiện ô xám thay ảnh SP.
8. **Hạng thành viên có sẵn trong mẫu làn.** Mẫu làn đã nạp `membership_tiers` (seed.ts). D3 (`D3-migration-deploy.md` kịch bản bước 6–7) chỉ ra PROD có thể chưa nạp. Khi đó Lộc Biếc ×1,2 và miễn ship từ 99k ở U1-26/U1-27 không có trên PROD.
9. **WebKit không phải WebView Zalo.** Playwright WebKit trên macOS không thay được WebView của Zalo trên iOS.
10. **Máy dùng chung bị tải nặng.** Load lên tới 100–190 do các phiên khác chạy vitest. Có ca chậm (U1-06 mất 67 giây), nên các ca được chờ lâu hơn.
11. **Dữ liệu làn bị đổi qua các lần chạy:**
    - Mỗi lần chạy toàn bộ tiêu khoảng 4 mã HOPSAN (U1-01, U1-04, U1-05b, U1-11). U1-05b để lại một mã đã lùi hạn.
    - U1-16 tạo các mã U1EXP/ONE/OFF/TIER\<hậu tố\>.
    - Mỗi lần U1-27 chạy, uat_returning có thêm một đơn CONFIRMED.
    - Tồn kho COBOTE-PW-100 và `soldCount` mật ong được trả lại trong `finally`.
    - Chạy lại nhiều lần thì `lane-down.sh 1` rồi `lane-up.sh 1` để dựng lại từ mẫu.
