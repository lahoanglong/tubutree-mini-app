# hk: màn thanh toán 375px, Mini App (`/checkout`) và web (`/thanh-toan`)

Nhánh `hard/1105-hk`, gốc `hard/1105-w4` (beeb14ddc). Brief: `brief-hk.md`.

## Cách chụp và đo

- Chụp bằng `apps/e2e/tests/checkout-states.miniapp.spec.ts` và `checkout-states.web.spec.ts` (trạng thái khai ở `apps/e2e/tests/support/checkout-states.ts`), đặt `HK_SHOT_DIR` để ra ảnh.
- Khổ 375x812 cho cả hai app, web thêm 1280x800 cho các trạng thái đánh dấu `wide`.
- Mỗi trạng thái có hai ảnh: `<key>.jpg` (khung nhìn, thấy thanh dính đáy) và `<key>.full.jpg` (cả trang).
- Cùng lúc đo DOM (`audit.jsonl`): chữ dưới 13px, vùng chạm dưới 44px, cuộn ngang.
- Ảnh trước nằm ở `apps/e2e/visual-out/hk-before/`, ảnh sau ở `apps/e2e/visual-out/hk-after/`. Thư mục này bị loại khỏi git, không commit ảnh.
- Mini App chụp ở `miniapp-375/`, web ở `web-375/` và `web-1280/`.
- Hai thay đổi của bộ đo sau lần chụp "trước" (nên các con số "trước" của web đếm thừa):
  - bỏ qua ô chọn nằm trong nhãn bấm được từ 44px trở lên;
  - bỏ qua radio `sr-only`.
- Ba trạng thái chỉ có từ gói hk nên không có ảnh trước (trước đó nút khoá, không báo ô nào): `no-address-pressed`, `invoice-errors`, `price-accepted`.

## Bảng phát hiện

Mức: cao (khách mất đơn hoặc không biết làm gì), vừa (khó dùng, lệch Mini/web), thấp (chỉnh cho đẹp hoặc thuộc quyết định chung của hệ thiết kế).
Cột "Ảnh" là đường dẫn dưới `apps/e2e/visual-out/`, thay `X` bằng `hk-before` (trước) hoặc `hk-after` (sau).

| # | Màn | Trạng thái | Ảnh | Vấn đề | Mức | Cách sửa | Kết quả |
|---|-----|-----------|-----|--------|-----|----------|---------|
| H1 | Mini | Giá đổi (PRICE_CHANGED) | `X/miniapp-375/price-changed.jpg` | Mã `PRICE_CHANGED` do API ném là chữ không dấu, hàm `errorMessage()` của Mini biến mọi chữ không dấu thành câu chung nên khách chỉ thấy toast "Có chút trục trặc, thử lại nhé" và biến mất sau vài giây. Tờ báo giá đổi đã viết sẵn không bao giờ hiện. | cao | `isPriceChangedError()` ở app-core đọc thân phản hồi thô (axios `response.data.message` và `ApiError.message`). Mini hiện tờ "Giá ưu đãi đã thay đổi" kèm hai nút. | Đã sửa (6236793e9) |
| H2 | Mini và web | Giá đổi | `X/miniapp-375/price-changed.jpg`, `X/web-375/price-changed.jpg`, `X/miniapp-375/price-accepted.jpg`, `X/web-375/price-accepted.jpg` | Lối thoát duy nhất là "Xem lại giỏ hàng": bỏ màn thanh toán, mất chỗ đang điền, rồi quay lại làm lại. Không có cách nhận giá mới tại chỗ. | cao | Nút chính "Cập nhật giá mới": giữ trang và các ô đã nhập, tải lại giỏ và báo giá, báo "Đã cập nhật giá. Tổng mới X." rồi đặt tiếp với tổng mới. "Xem lại giỏ hàng" còn lại là nút phụ. | Đã sửa (6236793e9 Mini, 85ce9d4a7 web) |
| H3 | Mini và web | Mất mạng, quá thời gian, 5xx khi đặt | `X/miniapp-375/offline.jpg`, `X/web-375/offline.jpg` | Mini chỉ có toast tự tắt; nút vẫn ghi "Đặt hàng · tổng" nên khách không biết là đang gửi lại cùng đơn. Sợ đặt hai lần. | cao | Sau lỗi chưa rõ kết quả: nút đổi thành "Thử lại · tổng", dải đáy ghi "Chưa gửi được đơn. Bấm Thử lại, hệ thống không tạo đơn trùng." Giữ nguyên khoá chống trùng (bấm lại gửi cùng body, cùng Idempotency-Key). | Đã sửa (b7e0cf732 Mini, d367f81b6 web) |
| H4 | Mini và web | Hết hàng một dòng, vượt tồn, nhiều dòng | `X/miniapp-375/out-of-stock.jpg`, `X/web-375/out-of-stock.jpg`, `X/web-375/many-lines.full.jpg` | Chỉ có một banner đầu trang nêu tên món; với giỏ nhiều dòng thì dòng lỗi nằm ngoài màn, nút Đặt hàng khoá mà không thấy lý do. Muốn sửa phải về giỏ. Web từ md còn gập dòng thứ 6 trở đi nên dòng lỗi có thể bị giấu. | cao | `checkoutLineProblems()` ở app-core. Lời báo ngay dưới đúng dòng ("Hết hàng", "Còn n sản phẩm") kèm nút "Bỏ khỏi đơn" hoặc "Giảm còn n" sửa ngay tại màn. Dải đáy ghi "Sửa sản phẩm hết hàng ở trên để đặt tiếp." Web tự mở danh sách khi có dòng lỗi. | Đã sửa (cd694e812 Mini, 8d75e9232 web) |
| H5 | Mini và web | Thiếu địa chỉ; hoá đơn VAT thiếu ô | `X/miniapp-375/no-address.jpg`, `X/miniapp-375/no-address-pressed.jpg`, `X/miniapp-375/invoice-errors.jpg`, `X/web-375/invoice-errors.jpg` | Nút "Đặt hàng" khoá cứng: bấm không có phản hồi, không ô nào báo lỗi, chỉ một dòng chung ở dưới. | cao | Thiếu địa chỉ hoặc ô hoá đơn thì nút vẫn bấm được: bấm để chỉ ra chỗ thiếu. Lỗi riêng từng ô ngay dưới ô (khi rời ô và khi bấm), con trỏ nhảy tới ô thiếu đầu tiên, `aria-invalid` và `aria-describedby`. Chỉ khoá hẳn khi đang tính tiền, đang gửi, có dòng cần sửa hoặc chưa có cách thanh toán (đều có chữ nói lý do). | Đã sửa (23832de03 Mini, 4a922f76d web) |
| H6 | Mini | Nhập sai tên và số điện thoại ở form địa chỉ | `X/miniapp-375/address-errors.jpg` | Form địa chỉ không đưa con trỏ tới ô sai, tỉnh/phường không có `aria-invalid` và `aria-describedby`. | cao | Luật kiểm chung `validateAddressFields()` ở app-core (một câu riêng cho từng ô, thứ tự theo màn hình). Con trỏ nhảy tới ô lỗi đầu tiên. | Đã sửa (8ab6a4c7b, bb76f0fcf) |
| M1 | Web | Form địa chỉ ở 375 | `X/web-375/address-errors.jpg` | Khác Mini: có khung và tiêu đề riêng, nhãn và lời báo 12px, luật kiểm riêng nên câu báo khác Mini. | vừa | Dùng chung bộ kiểm với Mini; khổ điện thoại bỏ khung và tiêu đề; nhãn và lời báo 13px. | Đã sửa (4bdc1079a) |
| M2 | Web | Tỉnh/thành, phường/xã khi lỗi | `X/web-375/address-errors.jpg` | Lời báo không gắn vào ô (thiếu `aria-describedby`), nhãn và lời báo 12px. | vừa | `aria-describedby` trỏ vào lời báo; bậc `text-caption` 13px. | Đã sửa (1f22ec1ae) |
| M3 | Web | Mọi trạng thái ở 375 | `X/web-375/normal.jpg` | Chữ 12px ở ô mã giới thiệu, dòng đồng ý điều khoản; nhãn ô hoá đơn 12px. Mini không có. | vừa | `text-xs` đổi sang `text-caption` (13px) ở `order-consent.tsx`, `referral-code-box.tsx`, `invoice-section.tsx`. | Đã sửa (c3e34a259, 4a922f76d) |
| M4 | Mini và web | Hoá đơn VAT | `X/miniapp-375/invoice-errors.jpg`, `X/web-375/invoice-errors.jpg` | Một câu chung "Bạn điền đủ MST, tên công ty, địa chỉ và email" cho cả khối, chỉ riêng ô MST có lời báo riêng. | vừa | `validateInvoiceFields()` ở app-core: mỗi ô một câu, hiện dưới ô đó. | Đã sửa (23832de03, 4a922f76d) |
| M5 | Mini | Vùng báo giá đổi | `X/miniapp-375/price-changed.jpg` | Chữ báo giá đổi (`flash.priceChangedBody`) nói "xem lại giỏ" trong khi cách sửa nhanh là nhận giá mới. | vừa | Dùng `checkout.priceChangedBody` ở cả hai app: "...nên giá đã đổi. Bạn cập nhật giá mới rồi đặt tiếp nhé." | Đã sửa (6236793e9, 85ce9d4a7) |
| L1 | Mini và web | Mọi trạng thái | `X/miniapp-375/normal.jpg` | Nhãn "Mặc định" của địa chỉ và chip mã giảm (GIAM50K, TUBU20, Mini) là 12px: bậc `label` của hệ thiết kế dùng chung nhiều màn. | thấp | Chưa sửa: đổi bậc `label` hoặc `Badge` ảnh hưởng mọi màn, cần quyết định của hệ thiết kế, không thuộc gói này. | Để lại |
| L2 | Web | Chưa có địa chỉ | `X/web-375/no-address.jpg` | Ô tick "Dùng Điểm Xanh" bị khoá (không có điểm) rộng 24x24 trong khi nhãn không phủ đủ 44px. | thấp | Chưa sửa: ô khoá, không bấm được. | Để lại |
| L3 | Mini và web | Bình thường | `X/web-375/normal.full.jpg` | Lệch nhỏ khoảng cách giữa tiêu đề khối và dòng đầu (khối Phương thức thanh toán, Điểm Xanh) giữa web và Mini, vài px. | thấp | Chưa sửa: không ảnh hưởng chức năng, cần đo lại bảng chuẩn của `ds-parity`. | Để lại |
| L4 | Mini | Dòng "Điều khoản", "Chính sách đổi trả" | `X/miniapp-375/normal.jpg` | Bộ đo báo vùng chạm 69x18 và 111x18. | thấp | Không phải lỗi: liên kết nằm giữa câu, vùng chạm 44px do lớp `tubu-hit` (đã có e2e "Dòng đồng ý Điều khoản ở 375px" trong `checkout.miniapp.spec.ts`). Bộ đo của gói bỏ qua lớp này. | Không phải lỗi |
| L5 | Web 1280 | Mọi trạng thái | `X/web-1280/normal.jpg` | Menu đầu trang cao 36px, chữ 12px ở huy hiệu giỏ hàng. | thấp | Chưa sửa: thuộc header của cả site, không phải màn thanh toán, ngoài phạm vi. | Để lại |
| L6 | Mini và web | Bàn phím mở (khung cao 460px) | `X/miniapp-375/keyboard.jpg`, `X/web-375/keyboard.jpg` | Kiểm: thanh dính đáy vẫn thấy, ô ghi chú không bị che. Không có lỗi. | thấp | Không cần sửa. | Không phải lỗi |
| L7 | App-core | Chữ `checkout.invoiceIncomplete` | không có | Câu chung của khối hoá đơn không còn app nào dùng (còn trong `shop-copy.ts` và spec của nó). | thấp | Chưa xoá: gói này chỉ thêm vào app-core, không bỏ khoá đã có. | Để lại |

Đếm: cao 6 (H1 đến H6, đã sửa hết), vừa 5 (M1 đến M5, đã sửa hết), thấp 7 (L1 đến L7: 0 đã sửa, 2 không phải lỗi, 5 để lại kèm lý do).

## Chuỗi ảnh trước và sau

Mỗi cặp: ảnh trước, ảnh sau, điều thay đổi.

| Trạng thái | Mini App 375 (trước, sau) | Web 375 (trước, sau) | Thay đổi |
|------------|---------------------------|----------------------|----------|
| Bình thường | `hk-before/miniapp-375/normal.jpg`, `hk-after/miniapp-375/normal.jpg` | `hk-before/web-375/normal.jpg`, `hk-after/web-375/normal.jpg` | Web hết chữ 12px ở mã giới thiệu và điều khoản (M3). |
| Giỏ nhiều dòng, tên dài | `.../many-lines.full.jpg` | `.../many-lines.full.jpg` | Không đổi giao diện khi không có lỗi dòng; 1280 vẫn gập dòng thứ 6. |
| Địa chỉ dài | `.../long-address.jpg` | `.../long-address.jpg` | Không đổi. |
| Chưa có địa chỉ | `.../no-address.jpg`, nay có thêm `no-address-pressed.jpg` | `.../no-address.jpg`, nay có thêm `no-address-pressed.jpg` | Nút bấm được; bấm thì báo "Chọn địa chỉ giao hàng để đặt hàng." dưới khối địa chỉ (H5). |
| Nhập sai tên, số điện thoại | `.../address-errors.jpg` | `.../address-errors.jpg` | Lời báo riêng từng ô, con trỏ vào ô đầu (H6, M1, M2). |
| Mã giảm giá lỗi | `.../coupon-error.jpg` | `.../coupon-error.jpg` | Không đổi. |
| Giá đổi | `.../price-changed.jpg` | `.../price-changed.jpg` | Mini: tờ "Giá ưu đãi đã thay đổi" thay toast chung (H1). Web: nút "Cập nhật giá mới" trong banner (H2). |
| Giá đổi, nhận giá mới | không có | `hk-after/.../price-accepted.jpg` | Báo "Đã cập nhật giá. Tổng mới X." (H2). |
| Hết hàng một dòng | `.../out-of-stock.jpg` | `.../out-of-stock.jpg` | Lỗi ngay dưới dòng kèm "Bỏ khỏi đơn" (H4). |
| Mất mạng khi đặt | `.../offline.jpg` | `.../offline.jpg` | Nút "Thử lại · tổng" và câu ở dải đáy (H3). |
| Đang gửi (nút bận) | `.../submitting.jpg` | `.../submitting.jpg` | Không đổi. |
| Ví và điểm áp dụng | `.../wallet-points.full.jpg` | `.../wallet-points.full.jpg` | Không đổi (số căn phải, đuôi "đ" nhất quán ở cả hai app). |
| Bàn phím mở | `.../keyboard.jpg` | `.../keyboard.jpg` | Không đổi (thanh dính đáy vẫn thấy). |
| Chuyển khoản | `.../bank-transfer.jpg` | `.../bank-transfer.jpg` | Không đổi. |
| Hoá đơn VAT thiếu ô, bấm Đặt hàng | không có | `hk-after/.../invoice-errors.jpg` | Lỗi riêng từng ô, ô MST nhận con trỏ (H5, M4). |

Đường dẫn đầy đủ là `apps/e2e/visual-out/hk-before/<miniapp-375|web-375|web-1280>/<key>.jpg` và `.../hk-after/<cùng>/<key>.jpg`.

## Số đo (bộ đo DOM)

Chữ dưới 13px (số trạng thái ở 375 bị đếm, trong 13 trạng thái chụp cả trước lẫn sau):

| | Trước | Sau |
|---|-------|-----|
| Mini 375 | "Mặc định" (12px) ở 11 trạng thái, "GIAM50K"/"TUBU20" (12px) | giữ nguyên (L1) |
| Web 375 | "Mặc định", ô mã giới thiệu, dòng đồng ý điều khoản, nhãn và lời báo form địa chỉ (12px) | chỉ còn "Mặc định" (L1) |

Cuộn ngang: không có ở cả hai app, cả trước lẫn sau.

Vùng chạm dưới 44px: Mini hết (hai liên kết điều khoản được loại vì có lớp `tubu-hit`, L4). Web còn duy nhất ô tick "Dùng Điểm Xanh" bị khoá khi chưa có điểm (L2).

## Việc thêm vào app-core

Chỉ thêm, không đổi chữ ký có sẵn:

- `commerce/checkout-form.ts`:
  - `validateAddressFields`, `firstInvalidAddressField`, `ADDRESS_FIELD_ORDER`, `ADDRESS_RECIPIENT_MAX`, `ADDRESS_STREET_MAX`;
  - `validateInvoiceFields`, `firstInvalidInvoiceField`, `INVOICE_FIELD_ORDER`;
  - kiểu `AddressField`, `AddressFieldErrors`, `AddressFormValues`, `AddressGeoCodes`, `InvoiceField`, `InvoiceFieldErrors`, `InvoiceFormValues`.
- `commerce/checkout-issues.ts`:
  - `checkoutLineProblem`, `checkoutLineProblems`, `isPriceChangedError`, `priceChangedActions`, `PRICE_CHANGED_CODE`;
  - kiểu `CheckoutLineInput`, `LineFix`, `LineProblem`.
- `shop-copy.ts` và `shop-copy-budget.ts`, khoá mới:
  - `checkout.priceAccept`, `checkout.priceViewCart`, `checkout.priceUpdated`;
  - `checkout.lineSoldOut`, `checkout.lineOver`, `checkout.lineRemove`, `checkout.lineReduce`;
  - `checkout.retryWith`, `checkout.retryNote`, `checkout.fixLinesHint`;
  - `checkout.priceChangedHint` và `checkout.priceChangedBody` (đổi lời cho khớp nút "Cập nhật giá mới").

## Không làm trong gói này

- Luồng ZaloPay, chuyển khoản, tính tiền, màn chi tiết đơn (gói hl): không đụng.
- API: không đổi (phản hồi lỗi đã đủ dữ liệu để báo theo dòng nhờ `stock` có sẵn trên dòng giỏ).
