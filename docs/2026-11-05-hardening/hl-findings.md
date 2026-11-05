# Gói hl: trang theo dõi đơn của khách (đợt 4)

Màn: Mini `apps/miniapp/src/pages/order-detail.tsx`, web `apps/web/src/app/tai-khoan/don-hang/[code]/`.
Ảnh trước: `apps/e2e/visual-out/hl-before/{miniapp-375,web-375,web-1280}/<trạng-thái>.jpg` (khung đầu) và `<trạng-thái>.full.jpg` (cả trang). `audit.jsonl` cùng thư mục ghi tràn ngang, chữ dưới 13px, vùng chạm dưới 44px, số bước `aria-current` của từng trạng thái. Trước khi sửa: cả 3 bộ không tràn ngang; Mini không có chữ dưới 13px và không có vùng chạm dưới 44px; web 375 có 5-15 đoạn chữ 12px mỗi trạng thái và một vùng chạm 96x24 ("Viết đánh giá" ở dòng sản phẩm của đơn đã giao); web 1280 có 8 vùng chạm thấp, tất cả ở thanh đầu trang (Danh mục, Ưu đãi, Kho quà..., ngoài phạm vi gói).
Bộ chụp: `apps/e2e/tests/support/order-detail-states.ts` (13 trạng thái: chờ chuyển khoản, Tubu xử lý tay, đã xác nhận, đóng gói, hãng đã nhận hàng, đang giao, đã giao, đã giao đã đánh giá, đã huỷ, có yêu cầu đổi/trả, chờ hoàn tiền, đăng ký định kỳ, nhiều dòng).

Mức: CAO = khách không biết đơn đang ở đâu hoặc bấm nhầm; VỪA = làm khách tìm lâu, lệch giữa hai app; THẤP = trau chuốt.

| # | Màn / trạng thái | Ảnh trước | Vấn đề | Mức | Hướng sửa |
|---|---|---|---|---|---|
| 1 | Mini + web 375, mọi trạng thái | `miniapp-375/shipping.jpg`, `web-375/shipping.jpg` | Đầu trang chỉ có nhãn trạng thái ("Đang giao") và ngày đặt, không có một câu nói đơn đang ở đâu, không có "bước kế tiếp" của khách. Khách phải tự suy từ dòng nhãn nhỏ | CAO | Hero mới `OrderStatusHero`: một câu (`orderHeadline.sentence`), một mốc (dự kiến giao / hạn trả / hạn đổi-trả), một bước kế tiếp. Chữ lấy từ `shop-copy` (`order.sentence.*`, `order.next.*`) |
| 2 | Mini + web, đang giao / đã giao | `miniapp-375/shipping.full.jpg`, `web-375/shipping.full.jpg`, `web-1280/shipping.full.jpg` | Mốc hãng ghi (Đã lấy hàng, Đang vận chuyển, Kho trung chuyển...) nằm ở khối "Vận chuyển" riêng, dưới phần tiền, cách xa bước "Đang giao" của hành trình. Khách thấy hai dòng thời gian khác nhau | CAO | Một hành trình duy nhất. Mốc hãng gộp dưới bước "Đang giao", mới nhất trên cùng (`orderTrack.steps[].events`). Mốc liền nhau cùng chữ gộp thành một (hãng hay bắn lại cùng trạng thái) |
| 3 | Mini + web, mọi trạng thái | `miniapp-375/shipping.full.jpg` | Mini: bước hiện tại không đánh dấu cho trình đọc màn hình (`aria-current` thiếu), chỉ có màu; `audit.currentSteps = 0` ở cả 13 trạng thái. Web đã có `aria-current` (1 ở mọi trạng thái trừ đã huỷ và chờ hoàn tiền, nơi không có hành trình) | CAO | `aria-current="step"` trên bước hiện tại; bước xong/chưa tới có nhãn chữ ẩn cho trình đọc |
| 4 | Mini, đang giao | `miniapp-375/shipping.full.jpg` | Nút chính duy nhất là "Xem tất cả đơn". Không có nút "Liên hệ"; cách liên hệ chỉ là hai dòng chữ nhỏ ở cuối trang, dưới cả địa chỉ | CAO | Nút chính của "đang giao" là Liên hệ Tubu (mở bảng chọn gọi/chép email). Bỏ nút "Xem tất cả đơn" khỏi thanh nút (đã có nút quay lại) |
| 5 | Mini, chờ thanh toán | `miniapp-375/pending-payment.jpg`, `.full.jpg` | Hai nút ngang hàng ở thanh dưới: "Huỷ đơn" (chữ đỏ) và "Thanh toán ngay". Dễ bấm nhầm huỷ; không nói còn bao lâu để trả | CAO | Một nút chính "Thanh toán ngay"; "Huỷ đơn" vào menu "Thêm thao tác". Hero nói "Thanh toán trước 18:50 05/11, còn 2 giờ 05 phút" (đếm ngược theo giờ máy chủ) |
| 6 | Web 1280, mọi trạng thái | `web-1280/shipping.full.jpg` | Một cột dài 900px (khối to, rỗng hai bên). Không có nút hành động nào trên desktop (thanh nút chỉ có ở khổ điện thoại); khách muốn huỷ/liên hệ phải cuộn xuống cuối | CAO | Hai cột gọn từ `lg`: trái trạng thái + hành trình + sản phẩm; phải tiền + địa chỉ + nút. Nút chính + menu nằm trong khối phải |
| 7 | Mini, đã giao | `miniapp-375/delivered.full.jpg` | Nút chính "Mua lại đơn này" trong khi sản phẩm chưa đánh giá; "Viết đánh giá" lặp ở từng dòng nhỏ; "Yêu cầu đổi/trả" là một dòng chữ trần giữa vùng hỗ trợ; không nói hạn đổi/trả | VỪA | Nút chính "Đánh giá sản phẩm" khi còn dòng chưa đánh giá, không thì "Mua lại". "Yêu cầu đổi/trả" (chỉ khi còn hạn, chưa có yêu cầu chờ, còn dòng trả được) vào menu. Hero nói "Đổi/trả được đến 10/11" |
| 8 | Mini + web, hãng đã nhận hàng nhưng đơn chưa "Đang giao" | `miniapp-375/carrier-booked.jpg` | Hero "Đã đặt đơn vị vận chuyển" nhưng không có nút nào hữu ích (chỉ "Xem tất cả đơn"), không nói vì sao không huỷ được; mã vận đơn không hiện ở đâu cho tới khi đơn chuyển "Đang giao" | VỪA | Nút chính Liên hệ. Câu "Hàng đã giao cho đơn vị vận chuyển nên đơn không huỷ được" đưa lên hero (hiện chỉ nằm cuối trang). Mốc hãng hiện ngay ở bước hiện tại |
| 9 | Mini + web, chờ thanh toán quá hạn | (dựng từ `pending-payment` với hạn đã qua, xem spec) | Hero vẫn đỏ chữ "quá hạn đơn sẽ tự huỷ" nhưng thanh nút vẫn có nút Thanh toán đã bị khoá bên máy chủ | VỪA | `canPayOrder` ở app-core: quá hạn thì nút chính là Liên hệ, không có Thanh toán |
| 10 | Mini + web, đã huỷ | `miniapp-375/cancelled.full.jpg` | Chỉ "Đã huỷ", khách không biết vì sao. API không trả lý do huỷ cho khách (có chủ đích, tránh lộ ghi chú nội bộ) | VỪA | Không đổi API. Suy ra một trường hợp chắc chắn: đơn chuyển khoản chưa trả, huỷ vào hoặc sau hạn thanh toán = "Đơn tự huỷ vì quá hạn thanh toán". Các huỷ khác chỉ nói "Đơn đã huỷ". Ghi ở mục Còn lại |
| 11 | Web 375 so Mini 375 | `web-375/shipping.full.jpg` so `miniapp-375/shipping.full.jpg` | Hai app lệch số đo: tên khối, cỡ chữ mã vận đơn, dòng "Tra cứu hành trình" chỉ có ở web, khối "Vận chuyển" khác bố cục | VỪA | Cùng `OrderTrack`, `OrderShipping`, `OrderActionBar`, cùng props, cùng chữ |
| 12 | Mini + web, đang giao | `miniapp-375/shipping.full.jpg` | Hãng + mã vận đơn có nút "Chép mã" nhưng nằm giữa trang dưới tiền. Mã không đi cùng hành trình | VỪA | Thẻ vận chuyển liền dưới hành trình: tên hãng + mã + nút "Chép mã" (vùng chạm 44px), kèm "Tra cứu hành trình" khi có liên kết |
| 13 | Mini + web, mốc thời gian | `miniapp-375/delivered.full.jpg` | Giờ có cả năm ("14:36 04/11/2026") ở mọi mốc, dài, khó quét | THẤP | Giờ ngắn "14:36 04/11" (theo giờ Việt Nam, không phụ thuộc múi giờ máy). Chỉ in năm khi khác năm hiện tại. Áp dụng ở hero, hành trình, thẻ vận chuyển |
| 14 | Mini, đang giao | `miniapp-375/shipping.full.jpg` | Dòng "Nhận +28 Điểm Xanh khi giao thành công" chen giữa khối tiền và vận chuyển | THẤP | Giữ ở khối tiền (không đổi) |
| 15 | Web 375, chân trang | `web-375/shipping.full.jpg` | Chân trang web (hotline, điều khoản...) hiện dưới thanh nút cố định | THẤP | Giữ nguyên (khuôn trang web, không thuộc gói này) |
| 16 | Mini, đơn đã huỷ chưa gán hãng (lịch sử vận chuyển rỗng) | `hl-after/miniapp-375/cancelled.full.jpg` (lần chụp sau đợt 1) | Do code mới: `!trackView && o.shippingHistory?.length` ra `0` và React in chữ số "0" dưới hero. Chụp trước không thấy vì chưa có đoạn code này | CAO | `!!o.shippingHistory?.length`, thêm test đỏ trước (`order-detail-states.spec.tsx`). Web đã viết `!!` ngay từ đầu |
| 17 | Web 375, đơn đã giao | `web-375/delivered.jpg`, `web-375/delivered-reviewed.jpg` | "Viết đánh giá" / "Sửa đánh giá" ở từng dòng sản phẩm đo 96x24 và 95x24 (dưới 44px). Mini cùng chữ 12px nhưng có `tubu-hit-44` nên không bị | VỪA | Thêm `tubu-hit-44` cho liên kết (chữ giữ 12px như Mini), test đỏ trước ở `detail-mini.spec.tsx` |
| 18 | Web 375, dòng sản phẩm, khối tiền, dòng "Trả:" | `web-375/*.jpg` (`audit.jsonl`: `smallText`) | Còn 3-6 đoạn chữ 12px mỗi trạng thái (số lượng "× 2", ghi chú Điểm Xanh, dòng đổi/trả) trong khi Mini không có chữ dưới 13px | THẤP | Để lại: các khối này không thuộc gói, đổi cỡ phải đụng lớp `max-md:` của khuôn web (bánh cóc `ds-baseline`). Chữ do gói dựng (hero, hành trình, thẻ vận chuyển, nút) đều dùng token ≥13px: chữ 12px của web giảm từ 5-15 xuống 3-6 đoạn mỗi trạng thái |

## Phạm vi sửa

Sửa: 1-12, 16, 17 (cao và vừa). 13 sửa kèm (cùng thay đổi thời gian). Giữ nguyên: 14, 15, 18.

Không động: luồng huỷ/đổi trả/hoàn tiền (máy chủ), thanh toán và tạo đơn (gói hk), API (đủ dữ liệu: `statusTimes`, `shippingHistory`, `canCancel`, `manualHandling`, `paymentDeadline`, `deliveredAt`, `reviewable`).

## Cộng thêm vào app-core (chỉ thêm, không đổi chữ ký cũ)

- `packages/app-core/src/commerce/order-tracking.ts` (+ spec 37 test): `orderStage`, `orderHeadline`, `orderTrack`, `shippingEvents`, `orderActionPlan`, `orderActionLabel`, `canPayOrder`, `canCancelOrder`, `returnWindowOpen`, `pendingReviewItem`, `shortDateTime`.
- `packages/app-core/src/shop-copy.ts` + `shop-copy-budget.ts`: 49 khoá `order.*`.

## Trước / sau

Ảnh sau: `apps/e2e/visual-out/hl-after/{miniapp-375,web-375,web-1280}/<trạng-thái>.jpg` (khung đầu) và `.full.jpg` (cả trang), cùng tên với ảnh trước. `apps/e2e/visual-out` bị `.git/info/exclude` nên ảnh nằm trong worktree, không vào commit. Dựng lại: `HL_SHOT_DIR=<thư mục> ... playwright test tests/order-detail-states.{miniapp,web}.spec.ts`.

| Điểm | Cặp ảnh (trước -> sau) | Kết quả đo (`audit.jsonl`) |
|---|---|---|
| 1, 2, 3, 12 | `miniapp-375/shipping.full.jpg` -> `hl-after/miniapp-375/shipping.full.jpg`; `web-375/shipping.full.jpg` -> `hl-after/web-375/shipping.full.jpg` | Một hành trình có mốc hãng dưới "Đang giao"; thẻ vận chuyển liền dưới có mã + Chép mã. Mini `aria-current` 0 -> 1 ở 11/13 trạng thái (đã huỷ và chờ hoàn tiền không có hành trình, như web) |
| 4, 8, 9 | `miniapp-375/carrier-booked.jpg`, `manual-handling.jpg`, `shipping.jpg` -> cùng tên ở `hl-after` | Nút chính "Liên hệ Tubu", câu "không huỷ được" ở hero |
| 5 | `miniapp-375/pending-payment.jpg` -> `hl-after/miniapp-375/pending-payment.jpg` | Một nút "Thanh toán ngay" + dòng "Còn 2 giờ 14 phút", "Huỷ đơn" vào menu |
| 6 | `web-1280/shipping.full.jpg`, `pending-payment.full.jpg` -> `hl-after/web-1280/...` | Hai cột (trái ~530px trạng thái + hành trình + sản phẩm; phải 21rem tiền + địa chỉ + nút). Cao trang 2384 -> 2013 |
| 7 | `miniapp-375/delivered.jpg`, `web-375/delivered.jpg` -> `hl-after/...` | Nút chính "Đánh giá sản phẩm"; "Mua lại", "Yêu cầu đổi/trả" trong menu; hero "Đổi/trả được đến 11/11." |
| 10 | `miniapp-375/cancelled.full.jpg` -> `hl-after/miniapp-375/cancelled.full.jpg` | "Đơn tự huỷ vì quá hạn thanh toán." (đơn huỷ khác chỉ "Đơn đã huỷ.") |
| 11 | `miniapp-375/shipping.full.jpg` so `web-375/shipping.full.jpg` (sau) | Cùng hero, hành trình, thẻ vận chuyển, thanh nút; web còn "Tra cứu hành trình" vì Mini không mở được trang ngoài |
| 13 | mọi ảnh có mốc giờ | "14:36 04/11/2026" -> "14:36 04/11" |
| 16 | `hl-after/miniapp-375/cancelled.full.jpg` lần chụp đầu (có "0") -> lần chụp cuối (hết) | Không còn nút 0 lạc |
| 17 | `web-375/delivered.jpg` -> `hl-after/web-375/delivered.jpg` | Vùng chạm thấp ở web 375: 2 (96x24, 95x24) -> 0 (liên kết có lớp `tubu-hit-44` như Mini, audit bỏ qua phần tử có lớp `tubu-hit-*`) |

Tổng đo (13 trạng thái mỗi bộ, 8 ở web 1280; `hl-after/*/audit.jsonl` chỉ giữ lần chụp cuối): không bộ nào tràn ngang trước hay sau. Chữ dưới 13px ở web 375: 5-15 -> 3-6 đoạn mỗi trạng thái; ở web 1280: 10-26 -> 9-16 (phần còn lại ở thanh đầu trang, thanh bên và các khối không thuộc gói). Vùng chạm thấp ở web 1280: 8 -> 8, tất cả ở thanh đầu trang (ngoài phạm vi gói).
