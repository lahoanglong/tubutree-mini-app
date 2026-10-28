# 06 - Sáu luồng khách trên Mini App (375px, lane 6)

Ngày chạy: 2026-10-28. Không sửa mã sản phẩm. Kịch bản chạy lại được: `tools/flows/mini-1.mjs` đến `mini-6.mjs` (dùng `tools/flows/_lib.mjs`). Ảnh từng bước: `screens/flows/mini/<luồng>/<nn>-<bước>.png`. Số liệu thô: `screens/flows/mini/<luồng>/steps.json`.

## Cách đo và giới hạn

- Một chạm = mỗi lần bấm, nhấn hay chọn. Gõ trong một ô = 1 chạm. Cuộn và nhìn không tính.
- Cột "chờ" là mili giây từ lúc chạm xong đến khi màn yên (không còn request, không còn khung xương, 350ms không đổi DOM).
- Đo trên máy này, mạng nội bộ. KHÔNG có độ trễ mạng thật. Mọi số "chờ" chỉ là mức sàn.
- Không bước nào chờ quá 1 giây. Chờ lớn nhất khoảng 490ms, thường ở lần vào màn đầu tiên.
- Lane 6 dùng chung với agent khác. Dữ liệu persona có thể trôi giữa các lần chạy. Mỗi kịch bản tự dọn bằng SQL trên `tubutree_uat_l6` trước khi chạy.
- Zalo SDK là giả của bộ UAT. Chia sẻ và đăng nhập không đi qua Zalo thật.
- Tải lạnh trang chủ: DOMContentLoaded 398ms, FCP 452ms.

## Luồng 1 - Khách lần đầu, 7 việc

Persona `new`, sau đó `guest`. Màn đầu của khách mới (chưa làm khảo sát): màn chào phủ kín, hai lối "Bắt đầu" (khảo sát) hoặc "Để sau". Bấm "Để sau" tốn 1 chạm. Nếu bấm "Bắt đầu" thì khảo sát tốn 9 chạm (1 + 4 câu x 2) rồi vào trang chủ trông y hệt, không thấy gì được cá nhân hoá.

| Việc | Chạm ít nhất (new) | Đường đi | Chờ ms | Ghi chú |
|---|---|---|---|---|
| Mua hàng | 1 | "Chọn sản phẩm", hoặc ô tìm, hoặc tab Danh mục | 41-55 | Khách `guest` không có nút "Chọn sản phẩm" (hero hiện "Nhận quà bằng Zalo"); ô tìm hoặc Danh mục vẫn 1 chạm |
| Theo dõi đơn | 2 | Cá nhân, Xem tất cả đơn hàng | 26 | Trang chủ không có lối thẳng cho khách mới |
| Điểm Xanh và ưu đãi | 1 | Tab Ưu đãi; hoặc ô Đổi quà (1) | 36-42 | Tốt |
| Vườn Xanh | 1 | Tab giữa đáy | 55 | Tốt |
| Đổi rác lấy quà | 1 | Ô Đổi rác ở trang chủ | 41 | Tốt |
| Chat CSKH | 2 + cuộn dài | Cá nhân, dòng "Chat với Tubu Tree" | 41 | Dòng nằm cách mép trên 1036px (new), 1287px (guest); khung nhìn 812px |
| CTV | 2 | Kiếm tiền, Cộng tác viên | 430 | Trang CTV mất khoảng 430ms |
| Đại lý | 2 | Kiếm tiền, Đại lý | 438 | Khách thường cũng thấy lối đại lý |

Việc vượt 2 chạm: không có. Việc không tìm thấy: không có. Việc kém nhất về công sức: Chat CSKH (2 chạm nhưng phải cuộn 1000px trở lên, không có chữ gợi ý ở trang chủ).

Tổng chạm của chuỗi đi cả 7 việc liên tiếp (gồm 1 chạm "Để sau" và vài lối thay thế): new 16, guest 15. Con số này không phải trải nghiệm một khách, chỉ để theo dõi hồi quy.

Khách `returning` (trang chủ): có thẻ điểm và hạng, nút Điểm danh, nút Đổi quà, thẻ "Đơn 120.000đ chờ chuyển khoản", thẻ "2 đơn đang giao". Chạm chuông Thông báo: 1 chạm, 51ms.

## Luồng 2 - Tìm và mua, kết thúc ở màn đặt hàng COD

Persona `returning`. Đơn tạo: `TUBU2026102836985`. COD được chọn sẵn, địa chỉ mặc định có sẵn.

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Trang chủ | 0 | / | 0 | |
| Chạm ô tìm kiếm | 1 | /browse | 461 | Lần vào đầu tiên |
| Gõ "nước rửa chén" | 2 | /browse | 272 | |
| Xem kết quả | 2 | /browse | 0 | |
| Mở sản phẩm | 3 | /product/nuoc-rua-chen-fuwa3e | 443 | |
| Chọn phân loại Can 5L | 4 | /product/... | 0 | Phân loại nằm ở y=944px, dưới màn đầu (812px) |
| Thêm vào giỏ | 5 | /product/... | 55 | Phải cuộn mới thấy; mặc định chọn 1L, không hỏi nếu không chọn |
| Xem giỏ hàng | 6 | /cart | 24 | |
| Mở chọn mã | 7 | /cart | 22 | Thẻ FREESHIP bị ép cột hẹp, chữ xuống dòng khoảng 8 dòng |
| Dùng mã | 8 | /cart | 234 | |
| Thanh toán | 9 | /checkout | 438 | |
| Đặt hàng | 10 | /checkout | 76 | COD sẵn, không phải chọn |

Tổng: 10 chạm (gõ chữ tính 1). Nếu không dùng mã giảm giá thì 8 chạm. Màn đặt thành công hiện mã đơn.

## Luồng 3 - Theo dõi đơn và mua lại

Persona `returning`, đơn vừa đặt ở luồng 2 (trạng thái Đã xác nhận) và một đơn đã giao `TUBU2026102553697`.

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Trang chủ | 0 | / | 0 | Trang chủ không nhắc đơn vừa đặt |
| Tab Cá nhân | 1 | /profile | 64 | |
| Xem tất cả đơn hàng | 2 | /orders | 33 | Đơn mới ở đầu danh sách |
| Mở chi tiết đơn | 3 | /order/TUBU... | 44 | Có "Hành trình đơn hàng"; KHÔNG có ngày "dự kiến giao" |
| Cuộn dòng thời gian | 3 | | 0 | Chỉ mốc đầu có giờ |
| Quay lại | 4 | /orders | 0 | |
| Mua lại ở đơn đã giao | 5 | /orders | 15 | Nút Mua lại chỉ có ở đơn đã giao |
| Thêm các món vào giỏ | 6 | /cart | 486 | Toast "Đã thêm 4 món" che nút Thanh toán |

Tổng: 6 chạm. Thử thêm (không tính): thẻ "2 đơn đang giao" ở trang chủ mở `/orders?tab=shipping`, và danh sách này KHÔNG có đơn vừa đặt vì đơn còn ở "Đã xác nhận". Khách bấm thẻ đó sẽ tốn 1 chạm mà không thấy đơn mình, rồi phải đi đường Cá nhân (thêm 2 chạm).

## Luồng 4 - Điểm Xanh, hạng, Vườn Xanh, điểm danh

Persona `returning`, sau khi nạp 60.000 điểm bằng bút toán `UAT_TOPUP`.

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Trang chủ: điểm, hạng, tiến độ | 0 | / | 0 | Tốt, mọi thứ nằm sẵn trên trang chủ |
| Điểm danh (nút trang chủ) | 1 | / | 34 | Toast dài "+1.000 Điểm Xanh, +60 giọt nước, +50 giọt quà..." xuống dòng xấu |
| Đổi quà | 2 | /rewards | 40 | |
| Đổi ở mã Giảm 50.000đ | 3 | /rewards | 17 | |
| Xác nhận đổi | 4 | /rewards | 228 | |
| Xem ví mã | 5 | /loyalty | 428 | Trang hiển thị lẫn dữ liệu cũ của persona dùng chung (chỉ ghi nhận) |
| Tab Vườn Xanh | 6 | /game | 48 | Điểm danh ở trang chủ đã được tính sang Vườn (60 giọt) |
| Tưới hết | 7 | /game | 35 | Cây lớn và thu hoạch ngay |
| Tuyệt vời! (màn thu hoạch) | 8 | /game | 443 | |
| Tab Vườn | 9 | /game | 11 | |

Tổng: 9 chạm. Ba chạm cho điểm danh cộng đổi quà (1 + 3). Điểm danh có ở 3 nơi: hero trang chủ, tab Ưu đãi, Vườn Xanh. Ưu đãi ghi "+10 giọt nước" nhưng lần đầu thực nhận 60 + 50. Không bấm vào thẻ hạng ở hero vì nó dẫn sang tab Ưu đãi, không có nút Quay lại.

## Luồng 5 - Đổi rác lấy quà

Ba phiên: khách đăng ký (A), nhân viên xác nhận (B), khách xem điểm (C). Điểm khách đi từ 0 lên 5.000 sau khi nhân viên xác nhận (đo bằng `5-points.json`).

Phiên A, khách `new`, mã yêu cầu `TR-VC8J2`:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Để sau (màn chào) | 1 | / | 0 | Chỉ khách mới |
| Ô Đổi rác | 2 | /recycle | 31 | |
| Đổi rác ngay | 3 | /recycle/new | 21 | |
| Thêm 5 thùng carton | 4 | /recycle/new | 311 | |
| Tiếp tục | 5 | ?step=method | 18 | |
| Mang tới điểm nhận | 6 | ?step=method | 0 | |
| Chọn điểm nhận | 7 | /recycle/points | 21 | |
| Chọn Tubu Quận 1 | 8 | /recycle/points | 0 | |
| Chọn điểm này | 9 | ?step=method | 399 | |
| Tick Thể lệ | 10 | ?step=method | 0 | |
| Tạo yêu cầu | 11 | /recycle/r/... | 455 | |
| Xem mã QR | 12 | /recycle/r/... | 23 | |

Tổng A: 12 chạm (11 nếu đã qua màn chào).

Phiên B, nhân viên:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Ô Đổi rác | 1 | /recycle | 448 | Trang chủ nhân viên không có lối vào quầy |
| Nhận hàng tại điểm | 2 | /recycle/desk | 58 | |
| Quét mã của khách | 3 | /recycle/desk | 14 | Mã giả lập từ QR của khách |
| Xác nhận đã nhận | 4 | /recycle/desk | 38 | |

Tổng B: 4 chạm.

Phiên C, khách xem điểm:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Ô Đổi rác | 1 | /recycle | 39 | Yêu cầu đã xong biến mất khỏi màn chính |
| Biểu tượng đồng hồ "Yêu cầu của tôi" | 2 | /recycle/requests | 29 | Chỉ có biểu tượng, không chữ |
| Tab Đã đóng | 3 | /recycle/requests | 0 | Tab mặc định "Đang xử lý 0" trống, không có chữ giải thích |
| Mở yêu cầu | 4 | /recycle/done/... | 30 | Thấy đã đếm và điểm cộng |
| Chuông Thông báo | 5 | /notifications | 0 | Có báo điểm đổi rác |

Tổng C: 5 chạm. Từ lúc đăng ký đến lúc thấy điểm: khoảng 17 chạm (A 12 + C 5) của khách, cộng 4 chạm nhân viên.

## Luồng 6 - CTV, rồi đại lý

6a, khách `new` đăng ký CTV:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Để sau (màn chào) | 1 | / | 0 | |
| Kiếm tiền | 2 | / | 16 | |
| Cộng tác viên | 3 | /affiliate | 453 | |
| Cuộn tới điều khoản | 3 | | 0 | Điều khoản dài, nút đăng ký nằm cuối |
| Tick đồng ý | 4 | /affiliate | 0 | |
| Đăng ký miễn phí ngay | 5 | /affiliate | 50 | `GET /academy/courses` trả 403 ngay sau đăng ký |
| Gian hàng | 6 | /storefront | 56 | `GET /storefront/me` 404 (mong đợi, chưa có gian hàng) |

Tổng 6a: 6 chạm (5 không tính "Để sau"). Lúc mới thành CTV, lối "Học viện CTV" chưa hiện cho đến khi nạp lại trang. Tổng quan toàn 0đ.

6b, persona `ctv`:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Kiếm tiền | 1 | / | 33 | |
| Cộng tác viên | 2 | /affiliate | 436 | |
| Gian hàng | 3 | /storefront | 433 | Mỗi sản phẩm có 3 biểu tượng không chữ (ghim, ẩn, xoá); xoá nằm cạnh ẩn |
| Chia sẻ gian hàng | 4 | /storefront | 17 | Sheet có QR, link, lời đăng gợi ý |
| Chia sẻ qua Zalo | 5 | /storefront | 0 | SDK giả |
| Đóng sheet | 6 | /storefront | 204 | |
| Quay lại tổng quan | 7 | /affiliate | 0 | |
| Chia sẻ link và mã | 8 | /affiliate | 0 | |
| Chuyển vào Ví Tubu (0đ) | 9 | /affiliate | 0 | Nút khoá, chạm không phản hồi, không có chữ giải thích |
| Mở Ví Tubu qua Cá nhân | 11 | /wallet | 29 | 2 chạm |

Tổng 6b: 11 chạm. Ví Tubu nhận hoa hồng, không có rút về ngân hàng (đã chốt từ trước).

6c, persona `dealer`:

| Bước | Chạm cộng dồn | Màn | Chờ ms | Ghi chú ma sát |
|---|---|---|---|---|
| Kiếm tiền | 1 | / | 38 | |
| Đại lý | 2 | /dealer | 432 | Bảng giá sỉ hiện ngay |
| Tab Công nợ | 3 | /dealer | 15 | |
| Tab Đơn hàng | 4 | /dealer | 8 | |
| Tab Báo cáo | 5 | /dealer | 19 | |

Tổng 6c: 5 chạm.

## Tổng chạm

| Luồng | Chạm |
|---|---|
| 1. Khách mới, mỗi việc | 1 đến 2 (chat cần thêm cuộn dài); khảo sát 9 |
| 2. Tìm và mua COD | 10 |
| 3. Theo dõi và mua lại | 6 |
| 4. Điểm Xanh, Vườn Xanh | 9 |
| 5. Đổi rác | 12 + 4 (nhân viên) + 5 |
| 6. CTV / đại lý | 6, 11, 5 |

## Chỗ khựng, từ nặng đến nhẹ

1. **Đơn vừa đặt không hiện ở trang chủ.** Thẻ "N đơn đang giao" mở `/orders?tab=shipping` và không chứa đơn đang "Đã xác nhận". Khách phải đi Cá nhân, Xem tất cả đơn (2 chạm). Chi tiết đơn không có ngày dự kiến giao, chỉ mốc đầu có giờ. Mua lại chỉ có ở đơn đã giao. Ảnh: `screens/flows/mini/3-theo-doi-don-mua-lai/03-*.png`, `05-*.png`, `11-*.png`. So sánh: Shopee hiện ngày giao dự kiến và lịch sử vận chuyển có giờ ở chi tiết đơn; Grab hiện thẻ đơn đang chạy kèm trạng thái ngay trang chủ.
2. **Phân loại và số lượng nằm dưới màn đầu.** Trang sản phẩm: "Phân loại" ở y=944px, màn 812px. Khách bấm Thêm vào giỏ mà không cuộn sẽ mua mặc định 1L không có hỏi. Ảnh: `screens/flows/mini/2-tim-va-mua/05-*.png`, `07-*.png`. So sánh: Shopee hiện bảng chọn phân loại khi bấm thêm vào giỏ.
3. **Kết quả đổi rác khó tìm.** Yêu cầu xong biến khỏi màn chính. "Yêu cầu của tôi" chỉ là biểu tượng đồng hồ. Tab mặc định "Đang xử lý 0" trống, không có chữ giải thích. Xem kết quả tốn 4 chạm. Điểm báo ở Thông báo. Ảnh: `screens/flows/mini/5c-doi-rac-khach-thay-diem/03-*.png`, `05-*.png`, `08-*.png`.
4. **CTV mới: tín hiệu sai và thiếu.** Bước "Điều kiện mở gian hàng" cả bốn điều kiện đều ✓ dù chưa có sản phẩm. `GET /academy/courses` 403 ngay sau đăng ký, lối "Học viện CTV" chỉ hiện sau khi nạp lại. Tổng quan toàn 0đ, không có việc gợi ý đầu tiên. Ảnh: `screens/flows/mini/6a-ctv-khach-dang-ky/07-*.png`, `09-*.png`.
5. **Chú thích nổi che nhãn ở trang chủ.** Bong bóng "Trồng cây mỗi ngày, nhận quà thật" che nhãn các ô (Tích điểm đơn sàn, Kiếm tiền, Mã của tôi) và hàng deal đầu khoảng 6 giây mỗi lần mở trang chủ. Ảnh: `screens/flows/mini/1-trang-chu-khach-quay-lai/01-*.png`.
6. **Chat CSKH chôn sâu.** Chỉ ở Cá nhân, cách mép trên 1036px (new) và 1287px (guest). 2 chạm cộng cuộn dài. Không có lối ở trang chủ. Ảnh: `screens/flows/mini/1-khach-moi-new/12-*.png`.
7. **Điểm danh lặp 3 nơi và chữ rối.** Có ở hero trang chủ, Ưu đãi, Vườn Xanh. Toast "+1.000 Điểm Xanh, +60 giọt nước, +50 giọt quà..." xuống dòng xấu. Ưu đãi ghi "+10 giọt nước" nhưng lần đầu thực nhận 60 + 50. Câu "Còn thiếu một phần, bấm điểm danh lại để nhận nốt" là từ nội bộ (chỉ thấy khi dữ liệu tôi dọn lỗi, không chắc khách thật gặp). Ảnh: `screens/flows/mini/4-diem-xanh-hang-vuon-diem-danh/02-*.png`.
8. **Giỏ hàng: thẻ mã và toast che nút.** Thẻ mã FREESHIP bị ép cột hẹp, chữ xuống khoảng 8 dòng; ô nhập mã bị cắt placeholder ("WELCOME, TU"). Toast "Đã thêm 4 món" che nút Thanh toán sau Mua lại. Ảnh: `screens/flows/mini/2-tim-va-mua/09-*.png`, `screens/flows/mini/3-theo-doi-don-mua-lai/10-*.png`.

Nhẹ hơn:

- Tab Vườn Xanh nổi ở đáy đè lên nút "Kiếm thêm nước" (ảnh luồng 4, bước 11).
- "Chuyển vào Ví Tubu" khoá ở 0đ, không giải thích (luồng 6b, bước 16).
- Gian hàng CTV: ghim, ẩn, xoá đều chỉ có biểu tượng, nút xoá sát nút ẩn.
- Quầy nhận hàng của nhân viên chỉ vào được qua Đổi rác lấy quà, Nhận hàng tại điểm (2 chạm), trang chủ không có lối.
- "Từ chối cả yêu cầu" tô xanh, không đỏ.
- Khách `guest` mất nút mua ở hero.
- Khảo sát 4 câu (9 chạm) không thấy cá nhân hoá nào sau đó.
- Nút "Chọn sản phẩm" ở hero mờ.
- Trang cũ còn trong DOM khi đi sâu, nên có nhiều nút "Quay lại" cố định chồng nhau (bộ kiểm thử phải bấm cái cuối).

## Chỗ luồng dừng

- Luồng 1, khách `guest`: bước "Chọn sản phẩm" lỗi (hết 8 giây) vì hero của khách chưa liên kết Zalo không có nút này. Đây là kết quả đo, không phải lỗi kịch bản; đã đo thay bằng ô tìm và Danh mục.
- Các luồng còn lại chạy đến cuối, không dừng giữa chừng.
- Không đo được: độ trễ mạng thật, Zalo thật (đăng nhập, chia sẻ), thanh toán chuyển khoản, giao hàng thật. Luồng 2 dừng ở đặt hàng COD theo đề.
