# Audit gl-1103: vùng giohang (Kho mã giảm giá, Giỏ hàng, Thanh toán, trang chuyển khoản, đặt thành công)

Ngày: 2026-11-03. Mã: main 52fd5cd65 (= PROD 0aa8af5d1 + tài liệu). Chỉ đọc và đo, không sửa mã, không commit.
Ảnh nằm dưới `docs/2026-10-28-review/screens/` (chưa commit). Script tái hiện nằm ở scratchpad
`/private/tmp/claude-501/-Users-longla-coding-tubutree-mini-app/315ed69b-80dc-466e-bece-22ee1ad7bd37/scratchpad/giohang/`.

## Kết luận ngắn

- Không có P0/P1. Tiền, điểm, phí giao, ví, mã giảm giá khớp nhau giữa giỏ, xem trước (quote), đơn tạo ra và chi tiết đơn ở cả 3 kịch bản tiền và 8 đơn đi qua giao diện.
- Quyền truy cập: đơn, QR chuyển khoản, địa chỉ, mục giỏ của người khác đều bị chặn (404/400/401).
- Lệch lớn nhất là web 375 so với Mini ở giỏ hàng và trạng thái hết hàng (P2), cộng bóng thẻ web không hiện (P2, nợ đã nằm trong baseline ds-guard).

## Phát hiện

### GIOHANG-01 (P2, web375) Thẻ ở giỏ, chuyển khoản, hộp mã không có bóng
`apps/web/src/app/gio-hang/page.tsx:230` dùng `max-md:shadow-[var(--elevation-1)]`. Tailwind đọc `shadow-[var(--x)]` là MÀU bóng: đo `getComputedStyle(...).boxShadow` = `none`, biến `--tw-shadow-color` giữ cả chuỗi bóng. Mini có bóng elevation-1.
Cùng lỗi ở 12 chỗ khác (baseline `scripts/uiux/ds-baseline.json` mục `shadow-var-color` đang dung thứ): `thanh-toan/bank-transfer-panel.tsx`, `components/coupon-box.tsx`, `tai-khoan/page.tsx` (2), `quick-add.tsx`, `group-buy-view.tsx`, `cong-dong/[id]/page.tsx`, `wishlist-heart.tsx`, `storefront-owner.tsx`, `storefront-signup.tsx`, `order-mobile/mobile-ui.tsx`, `lib/phone-ui.ts`. Luật `shadow-var-color` trong `scripts/uiux/ds-shop-rules.mjs:91` đã nói đúng cách sửa; chỉ còn dọn nợ.
Tái hiện: `node shadow-check.mjs` (lane 6). Ảnh: `giohang-flow/web375-cod-01-cart.png` (thẻ phẳng) so `giohang-flow/mini375-cod-01-cart.png`.
Đề xuất: đổi cả 13 chỗ sang lớp `shadow-card` (đã có trong `tailwind.config.ts:94`) hoặc `[box-shadow:var(--elevation-1)]`, rồi hạ baseline về 0.

### GIOHANG-02 (P2, web375) Giỏ hàng web lệch hình học so với Mini
Đo bằng `measure-cart.mjs` (375px, cùng giỏ): ảnh SP 64px (web, `gio-hang/page.tsx` `ProductThumb size={64}`) so 72px (Mini `cart.tsx:552`); hàng "Chọn tất cả" cao 32px so 52px; thẻ đầu tiên bắt đầu ở y=97.9 so 117.9 (cao hơn 20 CSS px); chiều cao thẻ 142 so 140; dòng chữ phụ line-height 20 so 18.
Ảnh: `giohang-flow/web375-cod-01-cart.png` so `giohang-flow/mini375-cod-01-cart.png`.
Đề xuất: web `max-md` dùng thumb 72, hàng chọn tất cả `min-h-[52px]`, bỏ line-height 20 ở chữ phụ (`text-caption` + `leading-[18px]`).

### GIOHANG-03 (P2, web375) Dòng hết hàng ở giỏ: web khác Mini về chữ và điều khiển
Giỏ có 1 dòng hết hàng (SR50, stock tạm đặt 0 ở lane 6, đã khôi phục 30):
- Web bỏ hẳn bộ tăng giảm, hiện chữ đỏ đậm 3 dòng "Hết hàng — hãy xoá khỏi giỏ hoặc bỏ chọn để thanh toán các món còn lại"; chân dính hiện câu chung "Có sản phẩm đã hết hàng hoặc vượt số lượng còn lại. Hãy xoá, giảm số lượng hoặc bỏ chọn rồi thanh toán."
- Mini giữ bộ tăng giảm (nút + khoá), nhãn hổ phách "Sản phẩm đã hết hàng" ở dòng, chân dính gọi đích danh "Serum dưỡng ẩm Visante đã hết hàng. Bỏ chọn hoặc xoá…".
Ảnh: `giohang-flow/mini375-oos-01-cart.png`, `giohang-flow/web375-oos-01-cart.png`.
Đề xuất: web 375 dùng cùng khối `components/mini/*` của dòng hết hàng và cùng câu chân dính (đưa câu có tên SP vào app-core/shop-copy để cả hai dùng).

### GIOHANG-04 (P2, web375) Cảnh báo hết hàng ở thanh toán: web lặp câu và thiếu biểu tượng
Web: khung hổ phách có viền, không biểu tượng, nút "Về giỏ hàng để sửa", và cùng câu lặp lại màu đỏ ở chân dính. Mini: banner hổ phách có biểu tượng, nút "Về giỏ hàng", chân dính không lặp.
Ảnh: `giohang-flow/mini375-oos-02-checkout.png`, `giohang-flow/web375-oos-02-checkout.png`.
Đề xuất: web dùng chung banner Mini, bỏ câu đỏ lặp ở chân dính khi banner đã hiện. Nằm gần R-23 (đang sửa); kiểm sau R-23 nếu gộp thì đóng.

### GIOHANG-05 (P3, mini375 + web375) Tổng ở giỏ và thanh toán lệch khi có dòng hết hàng
Chân dính giỏ: "Tạm tính 120.000đ" (bỏ dòng hết hàng) nhưng nút "Thanh toán (4)" vẫn đếm số lượng dòng hết hàng. Thanh toán tính cả dòng đó: "Tạm tính 1.500.000đ", nút khoá "Đặt hàng · 1.500.000đ", ví báo "Số dư chưa đủ, cần thêm 1.089.000đ", "+36.000 Điểm Xanh". Khách thấy hai con số khác nhau cho cùng giỏ; đơn không tạo được nên không sai tiền thật.
Ảnh: `giohang-flow/mini375-oos-01-cart.png`, `giohang-flow/mini375-oos-02-checkout.png`.
Đề xuất: khi có dòng hết hàng, thanh toán không tính dòng đó (hoặc ẩn tổng, chỉ hiện banner) và đếm ở nút theo số dòng đủ hàng.

### GIOHANG-06 (P3, mini375 + web375) "Tích điểm từ đơn đầu tiên nhé" hiện cả với khách cũ hết điểm
`packages/app-core/src/shop-copy.ts:272` `checkout.pointsNone` hiện cho persona `returning` khi điểm = 0 (sau khi tiêu hết ở lane 6). Khách đã có đơn đọc câu này là sai.
Đề xuất: tách chữ cho số dư 0 mà đã có đơn (ví dụ "Hoàn tất đơn này để nhận thêm Điểm Xanh").

### GIOHANG-07 (P3, mini375) Ghi chú trần điểm có dòng thứ hai lơ lửng
Chữ: "Đơn này dùng tối đa 31.000 Điểm Xanh, tính theo giá trị hàng của đơn" rồi xuống dòng "trong đó 7.000 điểm không hết hạn" là một mệnh đề nối tiếp bị tách thành đoạn riêng, đọc như câu cụt.
Ảnh: `giohang-flow/mini375-wallet-small-04-checkout-bottom-points.png`.
Đề xuất: gộp thành một câu: "Đơn này dùng tối đa 31.000 Điểm Xanh (tính theo giá trị hàng), trong đó 7.000 điểm không hết hạn."

### GIOHANG-08 (P3, mini375) Đặt thành công bằng Ví Tubu không ghi đã trừ ví
Đơn WALLET (TUBU2026110308591): thẻ chỉ ghi "Tổng thanh toán 89.000đ" và điểm sẽ nhận; không có dòng "Đã thanh toán bằng Ví Tubu" (khối "Chuẩn bị tiền mặt" chỉ có ở COD). Khách vừa mất 89.000đ trong ví không được xác nhận ngay trên màn đó.
Ảnh: `giohang-flow/mini375-wallet-small-06-after-place.png`.
Đề xuất: thêm dòng "Thanh toán: Ví Tubu · đã trừ 89.000đ" trong thẻ đơn khi `paymentMethod === 'WALLET'`.

### GIOHANG-09 (P3, web1280) Đặt thành công lặp số điểm
"Điểm Xanh sẽ nhận: +21.912 điểm — 21.912 Điểm Xanh sẽ về tay khi đơn giao thành công": số hiện hai lần trong hai câu liền nhau. Khối "Tiếp theo" 3 bước chỉ có ở 375 (khác biệt bố cục theo md, không báo).
Ảnh: `giohang-flow/web1280-cod-06-after-place.png`.
Đề xuất: bỏ một trong hai câu.

### GIOHANG-10 (P3, api) Thông tin xuất hoá đơn không kiểm định dạng
`InvoiceRequestDto` (`apps/api/src/modules/checkout/dto/checkout.dto.ts`) không có format/độ dài; API nhận `taxCode: "abc"` và tạo đơn (TUBU2026110361640). Client `isInvoiceValid` cũng chỉ kiểm không rỗng + email. MST sai làm kế toán không xuất được hoá đơn.
Tái hiện: `POST /checkout/place-order` kèm `invoice.taxCode "abc"` trên lane 6.
Đề xuất: `@Matches(/^\d{10}(-\d{3})?$/)` cho MST, `@MaxLength` cho tên công ty/địa chỉ/email; cùng regex ở client.

### GIOHANG-11 (P3, api) API nhận phương thức ZALOPAY dù cả hai app ẩn
`POST /checkout/place-order` với `paymentMethod: 'ZALOPAY'` tạo đơn PENDING_PAYMENT (TUBU2026110398691). Không app nào gọi; XU/VNPAY/MOMO bị chặn đúng. Đơn kiểu này giữ tồn kho như BANK_TRANSFER nhưng không chắc có đường thanh toán/huỷ tự động.
Đề xuất: bỏ ZALOPAY khỏi danh sách cho phép ở DTO cho tới khi có cổng thật (hoặc chốt có cron huỷ). Cần chủ quyết vì là bỏ một chức năng sẵn trong enum.

### GIOHANG-12 (P3, web375) Trang chuyển khoản web lệch Mini ở cảnh báo "Giữ nguyên nội dung" và chân dính
Mini: biểu tượng cảnh báo trên một dòng riêng rồi tới chữ; web: biểu tượng cùng hàng chữ. Nút chân dính Mini cao 48px (96px ảnh 2x), web 44px (88px).
Ảnh: `giohang-flow/mini375-bank-06-after-place.png`, `web375/bank-payment-code__returning__web375__s1.png`.
Đề xuất: web dùng chung khối cảnh báo và nút `size` của Mini.

### GIOHANG-13 (P3, mini375 + web375) Tên SP ở giỏ không giới hạn dòng
Tên 120 ký tự chiếm 6 dòng ở thẻ giỏ (`cart.tsx:559-569` không `line-clamp`; web `gio-hang/page.tsx:259-262` chỉ `break-words`); thanh toán đã cắt 2 dòng "…". Shopee/Grab cắt 2 dòng.
Ảnh: `mini375-longtext/cart__returning__mini375-longtext__s1.png`, `mini375-longtext/checkout__returning__mini375-longtext__s1.png`.
Đề xuất: `line-clamp-2` ở tên SP ở giỏ, mở đủ chữ ở trang SP.

### GIOHANG-14 (P3, web375) Chú thích cũ nói sai
`apps/web/src/app/thanh-toan/page.tsx:186`: "Điểm Xanh: Mini App cho tiêu, web thì không", mà web đã cho tiêu điểm. Chỉ là chú thích, dễ làm người sau xoá nhầm khối điểm.
Đề xuất: sửa chú thích thành lý do thật (hoặc xoá).

## Đã kiểm và đạt (không báo)

Tiền, điểm, ví (lane 6, API trực tiếp, 3 kịch bản):
- C1 COD không mã: TUBU2026110335439, 949.000.
- C2 COD + XANH10 + 20.000 điểm: TUBU2026110360957, 1.168.000.
- C3 BANK_TRANSFER chọn một phần + XANH10 + 10.000 điểm: TUBU2026110329030, 938.000.
- Giỏ = quote = đơn = chi tiết đơn ở từng bước; `Σ items.paidTotal = total − shipping`; điểm tích = (tổng sau giảm)/50 × 1,2 (Lộc Biếc); ví 500.000 → 411.000 sau đơn 89.000; điểm 60.000 → 36.000 sau dùng 31.000 (24.000 thường + 7.000 điểm không hết hạn); trần 20% hàng cho điểm thường, điểm không hết hạn tới 100% hàng.
- Phí giao 19.000 dưới ngưỡng; miễn phí đúng ở 199.000 (new) và trên 99.000 (returning); `cart.freeshipThreshold` khớp quote.
Qua giao diện (khớp số giữa Mini 375, web 375, web 1280): Mini COD (TUBU2026110301222), Mini chuyển khoản (TUBU2026110370538), Mini ví + điểm (TUBU2026110308591), web375 COD (TUBU2026110313944), web1280 COD + điểm (TUBU2026110306958).
Ca biên API: replay Idempotency-Key trả cùng đơn (TUBU2026110300988); 3 lần đặt đồng thời khác khoá trả cùng mã (TUBU2026110316829); `expectedTotal` thấp hơn trả 400 TOTAL_CHANGED có câu rõ; số lượng 0/−1/1.5/9999 bị chặn, vượt kho báo "Còn 30 sản phẩm trong kho."; điểm −5/1.5 bị chặn, 999999999 bị kẹp; ví số dư 0 bị chặn; XU/VNPAY/MOMO bị chặn; địa chỉ lạ, giỏ rỗng, ghi chú > 500 bị chặn; mã sai/dưới ngưỡng báo câu rõ ("Đơn tối thiểu 199.000đ để dùng mã này.").
Phân quyền (lane 6, token persona): `GET /payments/bank-qr/:code` và `GET /orders/:code` của người khác = 404; không token = 401; đặt/xem trước với địa chỉ của người khác = 400; sửa mục giỏ người khác = 404; xoá mục giỏ người khác trả 200 nhưng không xoá (kiểm: giỏ `returning` vẫn còn mục); `itemIds` của người khác = 400.
Giao diện: hết hàng chặn nút thanh toán trên cả hai app; không địa chỉ hiện gợi ý và khoá nút (Mini); lỗi 500 trang Mini hiện trạng thái lỗi có "Thử lại" + số hỗ trợ sau 3 đến 6 giây skeleton; giỏ trống Mini ổn; mất mạng Mini có câu riêng.

## Chưa kiểm được

- Lane lệch tải: máy tải ~140 (nhiều auditor song song), web lane 5 (3252) và lane 6 (3262) treo `page.goto` quá 90 giây. Hậu quả: toàn bộ ô web1280 của capture và các trạng thái web 375 (loading, error500, offline, empty, longtext, slow5s) không ra ảnh; vì không được dừng/bật lại lane nên không chụp lại.
- Kho mã giảm giá (`/ma-giam-gia`) trên web 375 và web 1280 chưa xem được (biên dịch lạnh > 90 giây); chỉ xem được Mini (`mini375/vouchers__*`, `giohang-flow/mini375-vouchers-*`).
- Trang chuyển khoản web 1280, báo lỗi/hết hạn QR, đồng hồ đếm hạn chuyển khoản không xem ở web.
- Ảnh capture lane 5 của Mini `bank-payment-code` hiện "Phiên đăng nhập đã hết hạn" do `/auth/refresh` 429 khi chụp: không phải lỗi sản phẩm, đã dùng ảnh luồng thay (`giohang-flow/mini375-bank-06-after-place.png`).
- Thiết bị thật, thanh toán thật (VNPAY/ZaloPay), ZNS/Pancake: không có; phần Zalo gốc (số điện thoại, thanh toán) chỉ qua mock harness.
- Khách đại lý/CTV (giá sỉ, hoa hồng) ở giỏ và thanh toán không kiểm.

## Dữ liệu thử đã đổi ở lane 6

- `returning`: `pointsBalance=60000`, `pointsConvertedBalance=7000`, `walletBalance=500000` (SQL qua `db.mjs`); sau các đơn: điểm 36.000 (và thêm điểm tích), ví 411.000 sau đơn ví.
- `new`: tạo địa chỉ cmw0hp09s00ywsuaszabz8si3 qua API.
- Tồn kho SR50 (`cmqfv2cky0003zxpl45lh4ggm`) đặt 0 rồi khôi phục 30.
- 12 đơn tạo: 3 đơn kịch bản tiền, 5 đơn qua giao diện, TUBU2026110300988, TUBU2026110316829, TUBU2026110398691 (ZALOPAY), TUBU2026110361640 (hoá đơn "abc"). Đơn chuyển khoản TUBU2026110364874 dùng cho thăm dò phân quyền có sẵn từ trước (không do tôi tạo). Giỏ `new` và `returning` đã dọn rỗng.

## Lệnh tái hiện chính

```
export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs
node docs/2026-10-28-review/tools/capture.mjs --lane 5 --phase mini375,web375,web1280 --keys cart,checkout,bank-payment-code,vouchers
# kịch bản tiền / biên / phân quyền / hình học (thư mục scratchpad giohang/)
node flow1.mjs; node flow2.mjs; node flow3.mjs; node idor.mjs; node idor2.mjs
node mini-flow.mjs cod returning std; node web-flow.mjs cod returning 375; node oos-flow.mjs
node measure-cart.mjs; node shadow-check.mjs
```
