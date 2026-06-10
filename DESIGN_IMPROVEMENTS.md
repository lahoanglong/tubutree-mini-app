# DESIGN IMPROVEMENTS — phiên 2026-06-10

Mỗi cải tiến pass test: *"Mẹ Linh (bế con 1 tay, mệt) có thấy dễ chịu hơn không?"*

## #1 Freeship progress bar trong Cart
**Baseline:** không có. **Cải tiến:** thanh tiến độ "Mua thêm 55.000đ để được miễn phí ship 🌿"
khi subtotal < 200k, đổi thành "Bạn được miễn phí ship" khi đạt.
**Mẹ Linh test:** PASS — cô biết ngay vì sao nên thêm 1 món nhỏ, không bất ngờ vì phí ship ở checkout.

## #2 Checkout single-page thay vì 3 màn riêng
**Baseline:** Design brief vẽ 3 màn (Address → Shipping → Payment).
**Cải tiến:** 1 trang cuộn với 3 section rõ ràng (Địa chỉ / Thanh toán / Tóm tắt), sticky CTA.
**Lý do:** mini app viewport nhỏ + đơn Tubu đơn giản (1 cách ship duy nhất theo rule 200k);
3 màn = 2 lần chuyển trang thừa, mỗi lần chuyển là 1 cơ hội rớt funnel.
**Mẹ Linh test:** PASS — ít tap hơn, nhìn được toàn bộ đơn trước khi bấm.

## #3 Undo thay vì confirm khi xóa item giỏ
**Baseline:** không có confirm (xóa luôn). Confirm modal thì phiền.
**Cải tiến:** xóa ngay (optimistic) + toast "Đã bỏ khỏi giỏ — Hoàn tác" 3.5s.
**Mẹ Linh test:** PASS — thao tác 1 tay nhanh, lỡ tay vẫn cứu được.

## #4 Skeleton match đúng layout cuối
**Baseline:** spinner trắng giữa trang. **Cải tiến:** skeleton đúng hình dạng
(hero, chip row, grid 2 cột, line giá) với shimmer 1.4s.
**Mẹ Linh test:** PASS — cảm giác nhanh hơn dù thời gian load như nhau.

## #5 Empty states có illustration SVG + CTA
**Baseline:** "Giỏ hàng trống" + emoji. **Cải tiến:** SVG inline (rổ tre + lá, hộp + sticky note…)
theo bảng §7.7, copy đúng từ vựng ("Giỏ còn trống đấy"), CTA điều hướng.
SVG inline = 0 network request, theo đúng palette.

## #6 Success moment khi đặt hàng
**Baseline:** snackbar "Đặt hàng thành công" rồi nhảy trang.
**Cải tiến:** màn success riêng: checkmark draw 600ms + lá rơi nhẹ (CSS), mã đơn to,
copy "Cảm ơn bạn đã chọn Tubu 🌿", 2 CTA (Theo dõi đơn / Tiếp tục mua), điểm Xanh sẽ nhận.
**Mẹ Linh test:** PASS — khoảnh khắc tin tưởng đầu tiên với brand, đáng 1.5s.

## #7 Variation chip hiển thị giá + tồn kho ngay trên chip
**Baseline:** chip chỉ có tên ("500ml"). **Cải tiến:** chip 2 dòng (tên + giá),
chip hết hàng bị gạch + mờ nhưng vẫn bấm được để xem (không "biến mất" bí ẩn).
**Mẹ Linh test:** PASS — so giá các size không cần tap từng cái.

## #8 Low-stock + hết hàng rõ ràng, không urgency giả
**Baseline:** chỉ "Hết hàng" đỏ. **Cải tiến:** "Còn 3 sản phẩm" tone ấm (clay, không đỏ chớp)
chỉ hiện khi stock ≤ 5 thật; hết hàng = "Tạm hết — sẽ về sớm" (đúng từ vựng brand).
**Lưu ý brand:** KHÔNG countdown, KHÔNG "mua ngay kẻo hết" — giữ nguyên tắc "Tử tế hơn khẩn cấp".

## #9 Order timeline 5 bước
**Baseline:** chỉ 1 dòng status. **Cải tiến:** vertical timeline (Đã đặt → Xác nhận → Đóng gói →
Vận chuyển → Giao thành công) với bước hiện tại pulse nhẹ, đúng spec §6.4 + tone màu primary.

## #10 Cancel đơn cần xác nhận qua bottom sheet
**Baseline:** 1 tap "Hủy đơn" là hủy luôn. **Cải tiến:** sheet "Bạn muốn hủy đơn này?"
+ nút giữ đơn làm primary (khuyến khích giữ), hủy là secondary.
**Mẹ Linh test:** PASS — không lo lỡ tay khi bế con.
