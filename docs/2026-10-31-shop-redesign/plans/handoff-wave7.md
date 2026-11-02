# Bàn giao đợt 7 (MINOR cuối đợt 6, review bổ sung 2: 10 P1 + 18 P2)

Đợt 7 có hai phần:
- Sửa nốt MINOR đợt 6 để lại (`handoff-wave6.md` §4).
- Sửa toàn bộ lỗi của `review/extra-critique-2.md`: 10 P1 + 18 P2, gồm các màn sheet chọn phân loại, thanh toán, bảng chọn mã, giỏ có combo, CTV bậc 2.

Mỗi gói đi theo vòng: agent làm, reviewer Opus xem, agent sửa tới khi APPROVE. Gói đường tiền được review 2 lượt. Không deploy: deploy là việc chủ quyết.

## 1. Đã có gì

- **I1 (MINOR đợt 6):**
  - Thêm test cấp trang cho đường kẻ dưới hàng Ưu đãi ở PDP web.
  - Ca e2e "sản phẩm một phân loại" chạy thật trên CI.
  - Nhãn vòng quay đủ chữ "Mã giảm giá" (hộp nhãn 64px ở hai app).
  - Chip mã ở trang thương hiệu luôn in mã ở hàng riêng; mã dài tới 40 ký tự xuống dòng trong chip, không nằm dưới nút "Sao chép".
- **I2:** review bổ sung 2 chụp 109 ảnh (`review/extra-critique-2.md`).
- **K1 + L1 (giá Giờ vàng trên nút mua, đường tiền):**
  - Nút và tổng trong sheet hiện đúng số máy chủ tính. Luật nằm ở `commerce/flash-line.ts` (app-core), spec chạy thật `priceFlashLine` của API trên cùng bộ ca.
  - Tính cả số đã có trong giỏ: "Thêm vào giỏ" ghi số giỏ tăng thật, "Mua ngay" ghi cả dòng (luồng này thanh toán cả dòng giỏ). Bảng thêm nhanh ở Yêu thích cũng vậy.
  - Sheet có nhãn Giờ vàng, "Tối đa n/khách", ghi chú khi vượt suất.
  - "Tạm hết hàng" thống nhất mọi chỗ.
  - Dòng Tiết kiệm của Mua kèm giữ chỗ, không đẩy nội dung.
- **K2 (thanh toán):**
  - Web 1280 hiện đủ dòng, quá 5 dòng thì gập lại kèm nút "Xem thêm n sản phẩm".
  - Mini thiếu địa chỉ: ghi lý do khoá nút và "Chưa tính".
  - Web 375 theo số đo Mini.
  - Có nút "Đổi mã" và "Tubu đã tự áp mã tốt nhất". Nút "Đặt hàng · {tổng}".
  - Tên sản phẩm 2 dòng. Bỏ "Vui lòng", "Đang tính...".
- **K3 (bảng chọn mã):**
  - Hai app dùng `VoucherTicket`, một bộ nhãn nút. Web 375 dùng sheet như Mini.
  - Phiếu không dùng được không còn mờ cả thẻ (chữ lý do đạt 4,5:1).
  - Bỏ "HSD". `expiryText` lùi một ngày khi hạn là 00:00 và ghi năm khi khác năm hiện tại.
  - Sheet Ưu đãi PDP xếp mã theo mức có lợi.
- **K4 (chữ):**
  - Chữ API dùng "Giờ vàng", "Còn n suất", "Thương hiệu", và một tên cho mã miễn phí giao hàng.
  - `terminology.spec` quét thêm các file chữ khách đọc của API (`*-notice.ts`, `*-notice.service.ts`, `*-price.ts`, `cart/cart.batch-error.ts`) và mọi đoạn của chuỗi template.
  - Khối Mua kèm đổi tiêu đề thành "Mua kèm giá tốt".
- **K5 (giỏ có combo, đường tiền):**
  - API trả thêm `comboGroups`. Tổng giảm của các nhóm bằng `comboDiscount`, vì cả hai lấy từ cùng một lần khớp.
  - Giỏ hai app gom món dưới đầu nhóm "Combo: {tên} · Tiết kiệm {số}".
  - Bỏ món làm bộ mất giảm thì hỏi trước (`ConfirmSheet`, không chặn).
- **K6 (CTV):**
  - Huy hiệu ghi "CTV {bậc}".
  - Trình dựng gian hàng có phần đầu xem trước như khách thấy, gồm tick và "CTV tuyển chọn".
  - Tiêu đề khối dùng Inter 16/700. Khối "Thưởng mốc" web theo thang chữ Mini.
- **K7 (sheet):**
  - Sheet web từ md là hộp thoại giữa màn, rộng tối đa 480px, áp cho cả mini sheet lẫn `ui/sheet`.
  - Tôn trọng giảm chuyển động. Tiêu đề sheet Inter 16/700 ở hai app.
- **L2–L5 (MINOR sau review):**
  - Web 1280 có lý do khoá nút ngay dưới "Đặt hàng". Đặt đơn lỗi thì nút nhận focus, nhưng không giật focus khi khách đang gõ ô khác.
  - Lý do "Đơn tối thiểu … không tính hàng Giờ vàng và phần giảm combo".
  - Mã 0đ ở PDP Giờ vàng vẫn chép được.
  - Số Tiết kiệm của nhóm combo ẩn khi giá phần chọn chưa về.
  - Một màu nền mờ cho mọi sheet web (theo Mini).
  - Chữ tồn kho "Còn {n} sản phẩm" lấy từ một nguồn (`commerce/stock-text.ts`).

Ảnh trước/sau của từng gói nằm ngoài git, ở `screens/<gói>/` của worktree tích hợp.

## 2. Deploy (việc chủ quyết)

- Không có migration mới.
- API đổi hai loại:
  - Chữ khách đọc: coupon-notice, flash-line-price, cart, brand, catalog, affiliate, identifier-validation, setReminder.
  - Thêm trường tuỳ chọn `comboGroups` vào giỏ. Client cũ bỏ qua trường này; Mini bản mới gặp API cũ thì giỏ không gom nhóm, không lỗi.
- Khách Mini App chỉ thấy thay đổi sau khi build và tải bản Mini mới lên Zalo.

## 3. Quyết định thay chủ (chủ giao "tự chốt thiết kế"; muốn đổi thì báo)

- **Giờ vàng:** không đổi luật máy chủ (vượt suất thì cả dòng tính giá thường); client hiện đúng số đó.
- **Chip phân loại:** cao thêm khoảng 6px ở cả hai app, theo thang chữ Mini.
- **Chữ:**
  - "Mua kèm giá tốt" thay "Mua kèm deal sốc".
  - Tồn kho ghi "Còn {n} sản phẩm" với mọi n; tồn thấp (≤ 5) chỉ nhấn bằng màu cảnh báo.
  - Mã miễn phí giao hàng mang đúng tên của nhãn chip trong app.
- **Thanh toán web lg:** khung tóm tắt không dính (DESIGN.md: không cột dính, không vùng cuộn riêng).
- **Sheet web từ md:** là hộp thoại giữa màn. Màu nền mờ 0,7 như Mini.
- **Mã 0đ ở PDP Giờ vàng:** vẫn chép được, ghi "Không giảm cho sản phẩm Giờ vàng này".
- **Bảng "Mua ngay":** khách đã đăng nhập luôn có sẵn chỗ cho 2 dòng ghi chú, để bảng không nhảy khi giỏ về muộn.

## 4. Giới hạn còn lại

- **Giờ vàng:**
  - Client không biết khách đã mua bao nhiêu suất qua đơn trước (`perUserLeft`). Khách đã mua dở vẫn có thể thấy nút ghi giá Giờ vàng. Máy chủ vẫn tính đúng và báo lý do ở giỏ.
  - Danh sách Giờ vàng ở client có thể cũ vài chục giây (Mini tải lại sau 60 giây).
- **Hộp báo bỏ món combo:** khi hai bộ chung một món, số tiền mất giảm là cận trên.
- **Chữ API:**
  - "Vui lòng" trong lỗi API (khoảng 100 chỗ ở 40 file) chưa đổi. Spec jest khớp nhiều chuỗi này nên cần gói riêng.
  - `flash-sale.service.ts` chưa vào bộ quét vì trộn chữ quản trị.
- **Lưới chặn màu thô:** `sticky-action-bar.tsx` còn 2 chỗ dùng màu thô và chưa vào `WEB_SHOP`.
- **Bộ quét chữ cấm (`terminology.spec`):**
  - Ở đoạn giữa và cuối của chuỗi template, chỉ từ viết hoa được xét. Từ cấm viết thường như `${n} voucher` vẫn lọt.
  - Giá trị truy vấn kiểu `?tab=HOT` có thể bị bắt nhầm là chữ khách đọc.
  - Mã thật hiện chưa có chỗ nào dính hai trường hợp này.
- **Trình dựng CTV:** phụ thuộc `/affiliate/tiers`. Endpoint treo thì khung chờ hiện tới hết thời gian chờ của client (Mini 15 giây).
- **Còn từ đợt 6:**
  - Hàng danh mục 5,5 cột vẫn cắt 3 nhãn.
  - Tên mã admin đặt dài bị cắt "…" ở khoảng 100px.
- **E2E:** e2e web cục bộ chỉ chạy các spec liên quan từng gói; toàn bộ `*.web.spec.ts` chạy ở CI.

## 5. Việc của chủ

- **Quyết deploy:** main sau khi PR đợt 7 merge.
- **Tải bản Mini App mới lên Zalo (Testing),** nếu muốn khách Mini thấy thay đổi.
- **`recompute-sold` trên PROD:** đã chạy ngày 2026-11-02 (phiên review-1028, chủ cho phép). PROD chưa có đơn DELIVERED nên không số nào đổi (`updated: 0`). Kệ Bán chạy nhất vẫn xếp theo số nhập tay hoặc id. Chạy lại khi đã có đơn giao xong.
- **Xem lại các quyết định ở §3.**
- **Còn từ `handoff-wave6.md` §5:**
  - Duyệt độ lệch §5 của F9.
  - Gán danh mục 2 cấp và ảnh thật cho sản phẩm.
  - Xem lại tỉ lệ hoa hồng CTV khi có combo.
