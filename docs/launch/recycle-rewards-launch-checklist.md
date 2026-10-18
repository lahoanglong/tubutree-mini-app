# Đổi rác lấy quà — checklist ra mắt

Không mục nào dưới đây chặn việc viết mã. Các mục ở phần 3 chặn việc mở cho khách thật, trừ hàng Gomdon (chỉ chặn đường Thu kèm đơn, phần 4) và hàng vị trí (không chặn). Mỗi mục ghi người chịu trách nhiệm (owner) và nơi lưu bằng chứng.

Mục 14 của spec không phải tư vấn pháp lý: số điều, mức phạt và hiệu lực lấy từ nguồn thứ cấp, phải đối chiếu văn bản gốc trước khi dựa vào.

## 1. Mặc định và tắt khẩn cấp

- [ ] `waste.enabled` mặc định `false`; kiểm ở Quản trị, Cấu hình, nhóm waste. Owner: chủ dự án. Bằng chứng: ảnh chụp Cấu hình.
- [ ] Trong lúc chạy nội bộ không bật `waste.enabled` trên app đang mở cho khách thật (đây là một cờ toàn cục, không có cờ theo người). Owner: chủ dự án. Bằng chứng: ghi chú ngày bật.
- [ ] Đường tắt khẩn cấp đã được thử một lần trên môi trường thử. Owner: kỹ thuật. Bằng chứng: ghi chú trong runbook.

Tắt khẩn cấp: đặt waste.enabled = false, rồi khởi động lại API (xoá bộ đệm cấu hình) và xoá bộ đệm proxy/CDN nếu có.

## 2. Trước khi bật waste.enabled

- [ ] Admin đăng ký kho HCMC (kind WAREHOUSE, ACTIVE) rồi các đại lý trước. Khi đăng ký kho, gõ số điện thoại thật của kho vào ô "Số điện thoại" (số người nhận trên nhãn kiện; khách ghi số này lên kiện gửi về kho, nên để trống thì khách không có số để ghi). Kiểm go-live `db.waste_point` (FAIL nếu bật mà chưa có kho, hoặc kho đang hoạt động chưa có số điện thoại khi cách Gửi về kho đang bật). Owner: admin. Bằng chứng: kết quả `go-live:check`.
- [ ] Admin quyết định gian hàng nào đủ điều kiện khi duyệt, vì `isPartnerStore` rộng hơn một gian hàng có nhân viên trực (spec 18.2 câu 7). Owner: admin. Bằng chứng: danh sách đã duyệt.
- [ ] Chủ dự án xem trước các màn chưa có mockup (spec mục 19): màn 4.5b sau khi tạo yêu cầu Gửi về kho hoặc Thu kèm đơn. Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Xem trước Quà của tôi (`/rewards/mine`). Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Xem trước Sửa món (`/recycle/r/:id/edit`). Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Xem trước Thể lệ (`/recycle/rules`). Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Xem trước thẻ "Chương trình đang tạm dừng", trạng thái khách bị khoá, thẻ xin đăng nhập và số điện thoại, các nhãn trạng thái đóng của yêu cầu. Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Xem trước ba phần admin: Yêu cầu, Quà, Cấu hình chung. Owner: chủ dự án. Bằng chứng: ảnh chụp màn.
- [ ] Admin viết thể lệ công khai vào `waste.rules_text` (Quản trị, Đổi rác, Cấu hình chung): thời gian, phạm vi, món nhận, mức quy đổi, trần ngày và tháng, hạn điểm 12 tháng, điều kiện, quyền từ chối và thu hồi điểm khi có gian lận (spec 14.2); kiểm `/recycle/rules` hiện đúng (văn bản trống thì trang hiện "Thể lệ đang được cập nhật"). Owner: admin. Bằng chứng: ảnh chụp trang Thể lệ.
- [ ] Người duyệt đối chiếu từng màn với mockup ở 390 px và với chữ lớn của hệ điều hành. Mockup (`docs/superpowers/specs/assets/2026-10-17-recycle-rewards/`) chỉ là tham chiếu hình; tên mẫu và chữ "đưa đi tái sinh" trong đó chỉ để minh hoạ. Owner: thiết kế. Bằng chứng: biên bản duyệt.
- [ ] Đo một lượt xác nhận tại quầy bằng đồng hồ. Owner: kho. Bằng chứng: số giây ghi lại.

## 3. Việc chặn mở cho khách thật (bảng 14.8)

- [ ] Sở Công Thương TP.HCM: chương trình có phải khuyến mại không, có phải thông báo theo `Nghị định 128/2024` không. Owner: chủ dự án. Bằng chứng: văn bản trả lời hoặc ghi chú cuộc gọi, và Thể lệ công khai.
- [ ] Kế toán thuế: hạch toán điểm phát hành, điểm đã dùng và quà; hoá đơn; xem lại nếu Tubu trả tiền cho đại lý hoặc mua vật liệu. Owner: kế toán. Bằng chứng: văn bản tư vấn.
- [ ] Sở Nông nghiệp và Môi trường TP.HCM: phạm vi giai đoạn 1 có hợp pháp không; điều kiện để mở pin sau này (pin chỉ mở lại khi có hợp đồng xử lý chất thải nguy hại có giấy phép VÀ có văn bản trả lời này). Owner: chủ dự án. Bằng chứng: văn bản trả lời.
- [ ] Gomdon trả lời bằng văn bản (danh sách hàng không nhận, thu theo khối lượng, báo giá cước gửi về kho). Chỉ chặn phần 4. Owner: chủ dự án. Bằng chứng: email hoặc tin nhắn lưu lại.
- [ ] Luật sư dữ liệu: câu chữ đồng ý, điều khoản đại lý, quyết định có chặn xoá tài khoản của khách bị gắn cờ không (nếu chưa xác nhận thì gỡ chặn và ghi là giới hạn đã biết), thời hạn lưu chi tiết yêu cầu và nhật ký sự kiện kể cả IP/UA đã cắt ngắn (spec 14.4 và 14.8). Owner: chủ dự án. Bằng chứng: văn bản tư vấn.
- [ ] Chủ dự án chọn một nơi nhận hộp sữa và vỏ chai Tubu, hoặc bỏ cả hai món khỏi đợt 1. Owner: chủ dự án. Bằng chứng: quyết định ghi lại.
- [ ] Điều khoản đại lý đã ký: không nhận pin hay chất thải nguy hại; đại lý không tự cộng điểm; hạn mức, kiểm tra và thu hồi; "Ưu đãi riêng" là khuyến mại và trách nhiệm của chính đại lý; đại lý là bên xử lý dữ liệu; giữ bí mật dữ liệu khách. Owner: pháp chế. Bằng chứng: bản ký.
- [ ] Vị trí (không chặn): chủ dự án bật `scope.userLocation` cho Mini App, đặt `ZALO_APP_SECRET` thật, thử "Gần tôi" trên điện thoại thật. Owner: chủ dự án. Bằng chứng: ảnh chụp trên máy thật.
- [ ] Kiểm tra Tubu có thuộc diện EPR không (được loại trừ nếu doanh thu nhóm bao bì dưới 30 tỷ đồng mỗi năm; không phải điều kiện để chạy chương trình). Owner: kế toán. Bằng chứng: ghi chú kết luận.
- [ ] Không câu chữ nào nói "được tính EPR", "tái chế 100%", "xử lý đúng chuẩn", "cây thật", "mua cây", "CO2", "Mã chứng nhận" (chưa có hợp đồng đối tác trồng cây). Owner: nội dung. Bằng chứng: kết quả tìm chuỗi trong mã và Thể lệ.

## 4. Đường Thu kèm đơn (PICKUP)

- [ ] `waste.lane_pickup_enabled` giữ `false` cho tới khi Gomdon trả lời bằng văn bản: đơn loại 3 chạy thật, thùng carton và nylon tính theo khối lượng, tỉnh xa, địa chỉ hoàn là kho Tubu, cước mỗi đơn, hàng không nhận, thu hàng cồng kềnh. Owner: chủ dự án. Bằng chứng: văn bản Gomdon.
- [ ] Một đơn thử loại 3 (playbook Phần 3) chạy hết chuỗi trạng thái; ghi chú vận đơn đúng dạng `Thu kèm rác TR-…`. Owner: kho. Bằng chứng: mã đơn và mã TR-.
- [ ] Có báo giá cước thật; chỉnh bảng phí gửi về kho `waste.mailin_fee_table` trong cùng thay đổi với việc bật đường này. Owner: chủ dự án. Bằng chứng: báo giá và giá trị cấu hình.
- [ ] Quà vật lý chỉ nhận tại kho khác với quyết định 3.2 của chủ dự án nên cần chủ dự án đồng ý. Owner: chủ dự án. Bằng chứng: xác nhận bằng văn bản.

## 5. Chạy nội bộ

- [ ] Chạy 2–4 tuần với nhân viên Tubu, kho HCMC và 1–2 đại lý quen; build không mở cho khách thật; chỉ hai cách Mang tới điểm và Gửi về kho; hạn mức đại lý nhỏ. Owner: chủ dự án. Bằng chứng: nhật ký tuần.
- [ ] Đo: thời gian quầy mỗi lượt, tỷ lệ nhận được trên khai báo, tỷ lệ tái dùng thùng carton và xốp (giả định 40% và 50%), hàng đến có đúng giả định không. Owner: kho. Bằng chứng: bảng tính ngoài hệ thống.
- [ ] Kho ghi số bó nhận và số bó tái dùng vào bảng tính ngoài hệ thống; chủ dự án đối chiếu hằng tháng. Owner: kho. Bằng chứng: bảng tính.
- [ ] Thiệt hại chấp nhận ở giai đoạn 1: 100.000–300.000 điểm mỗi điểm nhận mỗi tháng (mệnh giá 100.000–300.000đ, 2–5 tài khoản thật). Owner: chủ dự án. Bằng chứng: xác nhận bằng văn bản.
- [ ] Mở cho khách HCMC cần xong phần 3 (trừ Gomdon) hoặc chủ dự án chấp nhận rủi ro bằng văn bản. Owner: chủ dự án. Bằng chứng: văn bản chấp nhận.

## 6. SOP cửa kho

- [ ] Nhận kiện theo mã `TR-`, không theo mã vận đơn của hãng. Owner: kho. Bằng chứng: nhật ký nhận.
- [ ] Từ chối kiện còn cước thu khi nhận; nếu mã `TR-` đọc được thì từ chối yêu cầu. Owner: kho. Bằng chứng: nhật ký nhận.
- [ ] Kiện có pin hoặc món nguy hại: để riêng, đưa tới điểm thu pin có giấy phép gần nhất, từ chối yêu cầu với lý do `HAZARDOUS` và ghi nhật ký. Owner: kho. Bằng chứng: nhật ký sự kiện.
- [ ] Việc gỡ cờ hazardous của một món chỉ bằng migration có người duyệt (spec 14.1), không sửa tay trên PROD. Owner: kỹ thuật. Bằng chứng: PR migration.

## 7. Xử lý gian lận

Làm đúng thứ tự:

- [ ] Trước khi bấm thu hồi: huỷ các lượt đổi quà vật lý `READY` của khách, có hoàn điểm hoặc không. `refundPoints` không có mặc định với khách bị khoá hoặc đã `REVERSED`, nên admin phải chọn rõ. Thu hồi trước rồi huỷ có hoàn điểm sau sẽ trả lại phần mà việc thu hồi không lấy lại được. Owner: admin. Bằng chứng: nhật ký sự kiện.
- [ ] Vô hiệu các coupon đã đổi nhưng chưa dùng (`coupon.isActive = false`). Owner: admin. Bằng chứng: danh sách coupon.
- [ ] Đặt `waste_user_flags.blockedAt` (Quản trị, Đổi rác, khách). Owner: admin. Bằng chứng: dòng cờ.
- [ ] Bấm thu hồi và ghi lý do. Owner: admin. Bằng chứng: yêu cầu ở trạng thái đã thu hồi.

## 8. Giới hạn đã biết và số chưa kiểm chứng

- Khách đến ngay sau khi hạn mức của điểm hết là giới hạn của đợt 1.
- Khoá coupon `pg_advisory_xact_lock(hashtext(couponId), hashtext(userId))` (`apps/api/src/modules/coupons/coupons.service.ts:299`) chỉ có thể va với một lớp khoá của waste khi `hashtext(id)` của coupon bằng 731001, 731002, 731003 hoặc 731004 (xác suất khoảng số coupon chia 2^32, chấp nhận; câu truy vấn kiểm nằm trong runbook).
- Mọi số mặc định ở mục 5.1, 5.3, 6 và 11.5 của spec là đề xuất cho giai đoạn thử, chỉnh lại sau 1–2 tháng có số đo thật.
- Mọi con số và tên khoá là đề xuất thử nghiệm, trừ các quyết định của chủ dự án ở phần 3.
- Cước 30.000–85.000đ và giá trị kiện 30.000–48.000đ là ước tính theo bảng giá niêm yết, chưa có báo giá, không mang tính hợp đồng.
- Tỷ lệ tái dùng 40% và 50% chưa kiểm chứng.
- Chưa kiểm chứng: Gomdon xử lý đơn loại 3, chiều hoàn, địa chỉ hoàn, cước và việc nhận theo khối lượng.
- Cấu trúc `/me/info` của Zalo, quyền vị trí và `scanQRCode` phải kiểm trên điện thoại thật.
- Các dữ kiện về mã trong spec được đọc tại `8b0ea824` và `46901969`; bản triển khai đã kiểm lại trên nhánh.
- Chưa làm ở giai đoạn này: nhận diện ảnh bằng AI, in vận đơn, hoàn cước bằng điểm, trạm gom từ xa, phí tiền mặt theo đơn vị cho đại lý, ảnh bằng chứng, pin. TubuXu không được dùng lại. Các câu hỏi ở mục 18.1 vẫn thuộc chủ dự án.
- [ ] Chạy lại scripts/audit/routes.json và personas.json trên bộ máy audit (seed-audit-personas) khi bộ đó được bật lại lần tới.
