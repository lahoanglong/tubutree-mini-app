# 10. Tổng hợp review 2026-10-28 (main 9d0e95bd5)

Nguồn: 8 báo cáo nhóm `10-review-{KP,MH,DH,DX,DR,CT,QT,TL}.md`, cùng `03-perf-build.md`, `03-perf-runtime.md`, `04-quet-tinh.md`, `05-loi-vao-va-mau.md`, `06-luong-mini.md`, `06-luong-web.md`. Danh sách việc ở `20-backlog.md` (mã R-x). Đường dẫn ảnh tính từ `R/` = `docs/2026-10-28-review/`.

## Tóm tắt cho chủ (điều tệ nhất trước)

1. **Chặn ra mắt (P0, việc của chủ):** cả 4 trang chính sách vẫn có biển "BẢN NHÁP" và còn chỗ trống "[Tên công ty]", "[Mã số thuế]". Trang Giới thiệu và chân trang web không có dòng "Đơn vị vận hành". Zalo sẽ kiểm mục này. (R-1)
2. **Trang chủ là màn yếu nhất** (web 2,8/5, Mini 3,0/5). Màn đầu không có món hàng nào: "Mua lại" ở y≈760px. Trang nhảy bố cục khi tải: CLS 0,46 (khách cũ) và 0,83 (khách vãng lai) ở Mini, 0,42 ở web. Lần mở đầu, màn chào và khảo sát phủ kín trang (9 chạm), mà câu trả lời không được dùng ở đâu. (R-2, R-3, R-4)
3. **Mua hàng:** bấm "Thêm vào giỏ" hay "Mua ngay" thì app không hỏi phân loại, vì ô phân loại nằm ở y=944px, dưới màn đầu. Màn chuyển khoản bảo khách quét mã QR đang hiện trên chính máy đó, và Mini không có nút lưu mã. Thanh toán web nhảy bố cục (CLS 0,31). (R-6, R-8, R-7)
4. **Ảnh sản phẩm trên PROD là ảnh gốc** 69–777 KB mỗi thẻ. 8 thẻ đầu nặng 1,87 MB, ở 4G chậm mất khoảng 9 giây. Mọi số LCP đo trên dữ liệu mẫu đều đẹp hơn thực tế. (R-5)
5. **Số tiền và số điểm hiện ra dễ hiểu nhầm** (số trong hệ thống vẫn đúng). CTV thấy hoa hồng còn chờ như tiền đã có. Một lần điểm danh hiện ra 3 số nước khác nhau. Chi tiết đơn không có ngày giao dự kiến. (R-12, R-10, R-9)
6. **Admin:** hộp việc báo "Không còn việc nào đang chờ" trong khi đang có đơn chuyển khoản chờ xác nhận tiền (đơn này tự huỷ sau 24 giờ) và gian hàng chờ duyệt. (R-13)
7. **Đổi rác chưa bật được.** Thể lệ còn trống mà vẫn bắt khách tick "Đồng ý". Không có chốt nào chặn việc bật cờ. (R-11)
8. **Web 375 còn chậm và lệch so với Mini App.** Nhanh: web 2,9, Mini 3,6 (điểm của nhóm TL). Cả 37 trang web dùng chung một khung chờ. Trang chủ web gọi 21 API. Web không có `loading.tsx` hay `error.tsx` theo từng nhánh. Còn lệch ở thanh toán, ở trạng thái rỗng, và ở cổng khách chưa đăng nhập.
9. **Độ bền khá.** Không màn nào sập. 33/34 ô lỗi 500 hoặc mất mạng có nút Thử lại. Còn bốn chỗ: mất sóng mà báo "Máy chủ đang bận"; console còn lỗi 403/404 ở 4 màn và 1 lỗi hydration; Mini chỉ có một ErrorBoundary cho cả app.
10. **Điểm trung bình khoảng 3,6/5** (8 nhóm, từ 3,5 đến 3,8). "Dễ dùng" là tiêu chí thấp nhất ở cả hai nền (3,2). Màn thấp nhất: trang chủ web 2,8, trang nhãn Mini 2,8, Đổi rác admin 375 2,8.
11. **Phần chạy tốt:** mọi việc chính tới được trong 1–2 chạm. Màn 404, giỏ, danh sách đơn, quầy nhận rác Mini và Gian hàng admin đều tốt.
12. **Backlog:** 155 mục (P0 1, P1 12, P2 73, P3 69), chia thành 8 gói. Có 17 mục cần chủ quyết. Hai việc ngoài đợt này: B-01 (Zalo Checkout, gói riêng) và B-155 (đĩa VPS, việc deploy).

## Điểm trung bình theo màn chính

Cách lấy: Rõ, Dễ, Đẹp lấy theo nhóm chấm màn đó. Nhanh và Bền lấy trung bình của nhóm đó và nhóm TL, nếu TL có chấm. TB là trung bình 5 cột. Ký hiệu cột: R·D·Đ·N·B = Rõ·Dễ·Đẹp·Nhanh·Bền.

| Màn (khoá) | Nhóm | Mini 375 R·D·Đ·N·B | TB Mini | Web 375 R·D·Đ·N·B | TB Web | Vì sao thấp |
|---|---|---|---|---|---|---|
| home | KP+TL | 3·3·3·2·4 | 3,0 | 3·3·3·2·3 | 2,8 | Màn đầu không có món hàng; CLS; khảo sát phủ (R-2, R-3, R-4) |
| browse | KP | 4·4·4·4·4 | 4,0 | 4·4·4·3·4 | 3,8 | Web LCP 3,0 s (R-17) |
| browse-category | KP+TL | 3·3·4·3,5·4 | 3,5 | 3·3·4·3·4 | 3,4 | Mất lưới danh mục, không có tiêu đề (R-89) |
| browse-search | KP+TL | 4·4·4·3,5·2,5 | 3,6 | 4·4·4·3·3,5 | 3,7 | Gợi ý nuốt lỗi, không Thử lại (R-14) |
| brand-slug | KP | 2·2·4·4·2 | 2,8 | 4·4·4·4·4 | 4,0 | Mini báo "Chưa tải được" cho nhãn 404 (R-19) |
| brand-story | KP | 3·4·4·4·4 | 3,8 | 3·4·4·4·4 | 3,8 | 6/8 ghim sai tỉnh (R-20) |
| about | KP | 3·3·3·4·4 | 3,4 | 3·4·4·4·4 | 3,8 | Thiếu đơn vị vận hành (R-1) |
| product-slug | MH+TL | 4·3·3·3·4 | 3,4 | 4·3·3·3·3 | 3,2 | Phân loại dưới màn đầu; hydration (R-6, R-24) |
| cart | MH+TL | 4·4·4·3,5·4 | 3,9 | 4·4·3·3,5·4 | 3,7 | Tốt |
| checkout | MH+TL | 4·4·3·3,5·4 | 3,7 | 4·3·3·2·3 | 3,0 | Web CLS 0,31; lỗi hiện "Tạm tính 0đ" (R-7, R-22, R-23) |
| bank-payment-code | MH | 3·2·3·4·4 | 3,2 | 3·2·3·4·4 | 3,2 | Không lưu được mã QR (R-8) |
| group-buy | MH | 3·4·4·4·4 | 3,8 | 3·2·4·4·4 | 3,4 | Web mời người đã vào nhóm (R-25) |
| orders | DH+TL | 4·4·4·4·4 | 4,0 | 4·4·3·3,5·4 | 3,7 | Web rỗng khác Mini (R-36) |
| order-code | DH+TL | 4·3·4·4·4 | 3,8 | 4·3·3·3·3 | 3,2 | Không có ngày giao dự kiến; web lỗi tự dựng (R-9, R-35) |
| profile | DH+TL | 4·3·3·3,5·4 | 3,5 | 4·3·3·3·4 | 3,4 | Hàng trạng thái đơn; chat nằm cuối trang (R-33, R-34) |
| loyalty | DX+TL | 4·3·3·4·4 | 3,6 | 4·3·3·3·4 | 3,4 | Lịch sử cắt 20 dòng; hạ hạng không báo (R-41, R-42) |
| offers | DX+TL | 4·3·4·4·3,5 | 3,7 | 3·3·4·3·3,5 | 3,3 | Số nước lệch; web khách gặp tường đăng nhập (R-10, R-43) |
| rewards | DX | 4·3·3·4·4 | 3,6 | 4·3·3·4·4 | 3,6 | Món chưa đủ điểm đứng đầu (R-39) |
| game | DX+TL | 3·3·3·4·3,5 | 3,3 | 3·3·4·3·3,5 | 3,3 | Hai nút điểm danh, dài 4 màn (R-37, R-45) |
| recycle | DR+TL | 4·3·3·3,5·4 | 3,5 | 4·3·4·3,5·4 | 3,7 | Khó thấy kết quả (R-47) |
| recycle-new | DR | 4·3·4·4·4 | 3,8 | 3·3·4·4·4 | 3,6 | Thẻ khoá đứng đầu; Quay lại về form trống (R-48, R-49) |
| recycle-rules | DR | 2·3·3·4·3 | 3,0 | 2·3·3·4·3 | 3,0 | Thể lệ trống (R-11) |
| recycle-requests | DR | 3·3·3·4·2 | 3,0 | 3·3·4·4·3 | 3,4 | Guest: chữ lỗi sai; tab trống không có chữ (R-50, R-51) |
| chat | DR+TL | 4·3·3·3,5·4 | 3,5 | 4·3·3·3,5·4 | 3,5 | Chip 37px; skeleton sai hình (R-52, R-128) |
| feed | DR | 3·3·3·4·4 | 3,4 | 3·3·3·4·4 | 3,4 | Bộ lọc chiếm 40% màn đầu (R-55) |
| academy | DR | 3·3·3·4·4 | 3,4 | 3·3·3·4·4 | 3,4 | Khách thường gặp cổng CTV, 403 (R-53) |
| affiliate | CT+TL | 3·3·4·3,5·4 | 3,5 | 3·3·4·3·4 | 3,4 | Số to gồm tiền chờ; 12 khối (R-12, R-59) |
| storefront | CT | 3·3·3·4·3 | 3,2 | 3·3·4·4·3 | 3,4 | ✓ cả bốn điều kiện (R-58) |
| s-slug | CT | 4·3·4·4·4 | 3,8 | 4·3·4·4·4 | 3,8 | Nút chính đẩy khách ra ngoài (R-61) |
| dealer | CT+TL | 4·3·3·4·4 | 3,6 | 4·3·3·3,5·4 | 3,5 | Tên hàng cắt mất phân loại (R-62) |
| wallet | CT+TL | 4·3·4·4·4 | 3,8 | 4·3·4·3,5·3,5 | 3,6 | Không có lối từ CTV (R-60) |
| staff | CT | 4·3·3·4·3 | 3,4 | 4·4·4·4·4 | 4,0 | Mini: lỗi thành "không có ca"; nút cắt chữ (R-64, R-65) |
| cashback | DX | – | – | 2·3·3·4·4 | 3,2 | Web vẫn mở khi cờ tắt (R-44) |
| 404 | KP | 4·4·4·5·5 | 4,4 | 4·4·4·4·5 | 4,2 | Mẫu tốt |
| **Trung bình** | | **3,5·3,2·3,5·3,8·3,7** | **3,5** | **3,5·3,2·3,5·3,5·3,8** | **3,5** | Dễ là tiêu chí thấp nhất |

Theo TL (chỉ chấm Nhanh, Bền): Mini Nhanh 3,6, Bền 3,9; web Nhanh 2,9, Bền 3,8. Web thua Mini rõ nhất ở mặt Nhanh.

Admin (máy tính và điện thoại, không có Mini App):

| Màn | 1280 R·D·Đ·N·B | TB | 375 R·D·Đ·N·B | TB | Vì sao thấp |
|---|---|---|---|---|---|
| tab-inbox | 3·4·3·4·4 | 3,6 | 3·3·3·4·4 | 3,4 | Thiếu 2 hàng đợi; 26 chip "· 0" (R-13, R-144) |
| tab-dashboard | 3·4·4·3·4 | 3,6 | 3·4·4·3·4 | 3,6 | Không có số "hôm nay", không có khách mua lại (R-74) |
| tab-orders | 4·3·3·4·4 | 3,6 | 3·2·2·4·4 | 3,0 | 375: hai màn bộ lọc, cột tiền bị cắt; ô ngày kiểu Mỹ (R-69, R-70) |
| tab-productCategories | 2·3·3·4·4 | 3,2 | 2·3·3·4·4 | 3,2 | Sửa sản phẩm ẩn trong "Danh mục" (R-73) |
| tab-users | 3·3·3·3·4 | 3,2 | 3·3·3·4·4 | 3,4 | Toàn dòng "Khách" vãng lai (R-68) |
| tab-waste | 3·3·3·4·4 | 3,4 | 3·2·2·3·4 | 2,8 | Bảng 820px che cột Sửa (R-72) |
| tab-coupons | 3·2·3·4·4 | 3,2 | 3·2·3·3·4 | 3,0 | Danh sách mã nằm sau 2 form (R-71) |
| tab-supportChat | 4·4·4·4·4 | 4,0 | 4·3·3·3·4 | 3,4 | 375: thẻ cầu nối chiếm màn đầu (R-150) |
| tab-storefronts | 4·4·4·4·4 | 4,0 | 4·4·4·4·4 | 4,0 | Tốt |
| recycle-desk (Mini / web 375) | 5·5·4·4·4 | 4,4 | 4·3·4·4·4 | 3,8 | Web không có nút quét (R-135) |

## Đối chiếu ba mục tiêu

| Mục tiêu | Kết quả | Bằng chứng | Còn thiếu |
|---|---|---|---|
| 1. Khách mới tới mọi việc chính trong ≤ 2 chạm từ trang chủ hoặc thanh đáy; không việc nào chỉ vào được bằng link | **Đạt phần lớn** | `05-loi-vao-va-mau.md` A1–A4; `06-luong-mini.md` luồng 1: mỗi việc 1–2 chạm, không việc nào vượt 2 | Mở một đơn mất 3 chạm. Lối 1 chạm qua "Việc cần làm" không có đơn vừa đặt (R-18). Chat CSKH 2 chạm nhưng phải cuộn 1.036–1.287px (R-34). Web: khách chưa đăng nhập gặp tường ở 5/7 việc (R-43, R-56). Ví Tubu chỉ có một lối (R-60). Trên PROD, Đổi rác, Chat CSKH và Tích điểm đơn sàn đang tắt cờ (R-86). Chỉ vào được bằng link: `/s/:slug` (đúng thiết kế), `/group-buy/:id` và `/mua-chung/:id` (danh sách mở SP, không mở nhóm), `/subscriptions` (chỉ từ thông báo), `/merchant` (web) |
| 2. Mỗi màn một hành động chính, chữ ngắn, vùng chạm ≥ 44px, đủ trạng thái tải/rỗng/lỗi, dùng token, web 375 giống Mini App | **Chưa đạt** | Điểm Dễ trung bình 3,2 ở cả hai nền; `04-quet-tinh.md` §3, §6; các báo cáo nhóm | Hành động chính bị chìm: trang chủ (R-3), CTV 12 khối (R-59), Vườn Xanh dài 4 màn (R-45). Chữ dày: R-97, R-123. Vùng chạm dưới 44px: R-52, R-103, R-115, R-148. Trạng thái sai: gợi ý tìm (R-14), câu đố báo xong giả (R-119), "không có ca" khi lỗi (R-64), tab trống (R-51). Nằm ngoài token: R-143. Web lệch Mini: R-15, R-23, R-30, R-35, R-36, R-43, R-44, R-56, R-90, R-98, R-99, R-108, R-124, R-132, R-140 |
| 3. Không màn trắng, không lỗi console, mọi route có error boundary, API lỗi hoặc mất mạng có nút thử lại | **Gần đạt** | Không ô nào sập; 33/34 ô lỗi 500 hoặc mất mạng có Thử lại (`10-review-TL.md` tóm tắt 6) | Thiếu Thử lại ở gợi ý tìm kiếm Mini (R-14). Lỗi console: 403/404 ở trang nhãn, Học viện, gian hàng, chủ nhãn, merchant (R-19, R-53, R-66); hydration ở trang SP web (R-24). Error boundary: Mini chỉ có 1 cho cả app (R-84); web chỉ có `error.tsx` gốc và 0 `loading.tsx` (R-83). Màn trắng lúc tải: Mini FCP 1,65 s chờ entry 711 KB (R-77); Đổi rác ở mạng chậm trắng trước khi có skeleton (R-54). Mất sóng báo "Máy chủ đang bận" (R-85) |

## Mẫu Shopee/Grab: màn nào còn thiếu

Có = đã làm như mẫu; Một phần = có nhưng còn thiếu ý chính; Thiếu = chưa có.

| Mẫu | Mini | Web 375 | Màn còn thiếu | Mục |
|---|---|---|---|---|
| Shopee: ô tìm kiếm dính đầu trang, có lịch sử và gợi ý | Một phần (chưa dính) | Một phần | Trang chủ, Danh mục; gợi ý không báo lỗi | R-3, R-14 |
| Shopee: lưới lối tắt dưới banner | Một phần | Một phần | Trang chủ: không có banner, lối tắt 2 hàng, 4/6 ô trùng thanh đáy | R-3 |
| Shopee: thẻ SP ảnh vuông, giá nổi, đã bán, nhãn giảm | Có | Có | Ảnh nặng ở mọi lưới; Yêu thích không có nút thêm giỏ nhanh | R-5, R-100 |
| Shopee: thanh mua dính đáy ở trang SP | Có | Có | Toast che thanh mua | R-26 |
| Shopee: chọn phân loại bằng bottom sheet có ảnh và tồn kho | Thiếu | Thiếu | Trang SP (và Yêu thích) | R-6 |
| Shopee: giỏ chọn từng món, tổng dính đáy | Có | Có | Giỏ rỗng web không gợi ý; "(đã giảm)" sai | R-99, R-101 |
| Shopee: thanh toán một trang | Có | Một phần | "Dùng X điểm giảm Yđ"; ví trả một phần; web nhảy bố cục và lệch Mini | R-29, R-28, R-7, R-23 |
| Shopee: Cá nhân có hàng trạng thái đơn kèm số, ví, điểm, mã | Một phần | Một phần | Ô "·", nhãn 3 dòng, không có biểu tượng | R-33 |
| Shopee: trang shop giữ khách ở lại trong shop | Thiếu | Thiếu | Gian hàng CTV `/s/:slug` | R-61 |
| Shopee: ví voucher, mã mới nổi lên đầu | Thiếu | Thiếu | "Xem ví mã" mở trang Hạng | R-40 |
| Shopee Seller: danh sách cần làm có số đếm | – | Một phần | Hộp việc admin thiếu hàng đợi, có 26 chip "· 0" | R-13, R-144 |
| Grab: trang chủ lấy hành động làm trung tâm, ít chữ | Một phần | Một phần | Trang chủ: khối quà khách mới nhiều chữ, màn chào phủ | R-3, R-4 |
| Grab: theo dõi đơn dạng dòng thời gian có mốc dự kiến | Một phần | Một phần | Chi tiết đơn không có ngày dự kiến; trang chủ không hiện đơn đang chuẩn bị | R-9, R-18 |
| Grab: điểm và hạng hiện rõ tiến độ lên hạng | Có | Có | Thiếu dòng "giữ hạng"; Cá nhân không có tiến độ | R-42 |
| Grab: thu nhập tách "đang xử lý" và "dùng được" | Thiếu | Thiếu | Trang CTV | R-12 |
| Grab: skeleton thay spinner | Một phần | Một phần | Mini: Spinner mỗi route lần đầu, skeleton chat sai hình. Web: 37 trang dùng khung chung, chi tiết đơn chỉ có chữ. Admin: "Đang tải…" | R-79, R-128, R-76, R-35, R-149 |
| Grab: phản hồi tức thì (toast, cập nhật lạc quan) | Một phần | Một phần | Thêm giỏ không cập nhật lạc quan và toast che nút; điểm danh hiện 3 số; Đổi rác không tự cập nhật; "Chuyển vào Ví" bấm không phản hồi | R-26, R-10, R-47, R-12 |
