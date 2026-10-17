# Đổi rác lấy quà — một chức năng thay cho Refill, nút Gomdon ở checkout và điểm nhận rời rạc

- **Ngày:** 2026-10-17
- **Trạng thái:** Bản nháp chờ chủ dự án duyệt. Chưa viết code, chưa có kế hoạch triển khai.
- **Phạm vi:** `apps/api` (module mới `waste-exchange`), `apps/miniapp` (trang khách, màn đại lý), `apps/web` (tab admin), `packages/shared-types`. Gỡ `/refill`, nút Gomdon ở checkout và danh mục quà cứng trong mã.
- **Mockup:** 16 ảnh chụp màn hình trong `docs/superpowers/specs/assets/2026-10-17-recycle-rewards/` (mini app rộng 390 px, admin rộng 1280 px; danh sách ở mục 19). Số liệu, tên cửa hàng và câu chữ trong ảnh là minh hoạ; khi ảnh và văn bản khác nhau thì văn bản thắng. Tên màn dùng trong tài liệu này: Trang Đổi rác, Chọn món, Chọn cách giao, Điểm nhận gần bạn, Mã QR, Theo dõi, Đã cộng điểm, Kho quà, Lối vào từ Vườn, Đại lý nhận hàng, Admin Hàng nhận, Admin Điểm nhận.
- **Cách đọc:** mục 1 đến 9 là phần sản phẩm (ý định, trải nghiệm khách, luật điểm, điểm nhận, ba cách giao, quà, admin). Mục 10 đến 13, 15 và 16 là phần cách làm trong code: sổ điểm, dữ liệu, thu kèm đơn qua Gomdon, việc gỡ Refill, API, giao diện. Mục 14 là pháp lý và việc phải làm với bên ngoài. Mục 17 là ra mắt và kiểm thử. Mục 18 liệt kê câu hỏi còn mở, các quyết định tôi tự đưa ra (chủ dự án đổi được) và điều chưa kiểm chứng. Mục 19 là danh sách ảnh. Mọi con số và tên khoá là đề xuất để chạy thử, trừ phần mục 3 ghi là chủ dự án đã chốt.

## 1. Ý định và lý do

Khách của Tubu Tree nhận rất nhiều bao bì: thùng carton, nilon chống sốc, vỏ hộp sữa, vỏ chai và hộp của chính Tubu. Chủ dự án muốn khách mang hoặc gửi những thứ đó lại và nhận Điểm Xanh hoặc quà. Hai việc cùng được: khách có lý do quay lại và mua tiếp, Tubu có thêm thùng carton và xốp hơi dùng lại để đóng hàng.

Trong repo đã có ba mảnh làm nửa việc này: tính năng Refill (trả vỏ chai, điểm nhận riêng), nút "thu gom" của Gomdon ở bước thanh toán, và một danh mục quà cứng trong mã (`DEFAULT_REWARD_CATALOG`). Chúng không biết nhau, mỗi mảnh có bảng, màn hình và cấu hình riêng. Chủ dự án yêu cầu gom thành MỘT chức năng đầy đủ thay vì nhiều chức năng rời rạc. Chưa có khách thật nên việc gỡ và gộp không cần di chuyển dữ liệu.

Khách ở Hà Nội, Cao Bằng và các tỉnh xa kho TP.HCM là bài toán khó nhất: gửi lẻ một gói nhỏ bằng chuyển phát thường tốn hơn giá trị điểm nhận lại (ước tính ship 30.000 đến 85.000đ, giá trị gói 2,5 kg với Tubu khoảng 30.000 đến 48.000đ; các con số này là ước tính từ bảng giá niêm yết, chưa có hợp đồng thật với Gomdon). Thiết kế phải nói thật điều đó với khách thay vì giấu.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**
1. Một chương trình, một trang vào, một tab admin, một bảng quy đổi, một bảng điểm nhận, một kho quà.
2. Khách đổi được trong ba bước: chọn món, chọn cách giao, nhận mã. Nhận điểm sau khi nơi nhận đếm xong.
3. Admin cấu hình được món, đơn vị, mức quy đổi, trần theo ngày và tháng, trạng thái từng món, điểm nhận, hạn mức điểm của từng đại lý, kho quà, và các ngưỡng chung, không cần sửa code.
4. Điểm chỉ do Tubu phát. Đại lý không tự phát điểm và không đặt tỉ giá.
5. Số điểm cộng luôn theo số lượng thực nhận và không vượt số khách khai.
6. Đo được từ ngày đầu: số lượng theo món và theo cách giao, chi phí ship, tỉ lệ nhận thiếu so với khai, mức dùng hạn mức của từng đại lý.

**Không phải mục tiêu của đợt này**
- Nhận pin đã dùng (chất thải nguy hại, xem mục 14). Pin chỉ hiện mờ "Sắp nhận".
- Trả tiền mặt cho rác, rút điểm ra tiền, chuyển điểm giữa người dùng.
- Trả phí tiền mặt cho đại lý. Đợt này chỉ ghi lại số lượng từng đại lý nhận để sau này tính phí theo đơn vị.
- Bản đồ trong app. Màn điểm nhận là danh sách; chỉ đường mở Google Maps bằng liên kết.
- Nhận diện ảnh bằng AI, in nhãn vận đơn, hoàn ship bằng điểm, "trạm gom" ở vùng xa (gom nhiều khách rồi ship một kiện). Bốn việc này là giả thuyết cho đợt sau, chưa có dữ liệu để kiểm.
- Đổi luật Điểm Xanh hiện có (1 điểm = 1.000đ, hạn 12 tháng, dùng tối đa 20% giá trị đơn, không trả phí ship).
- Dùng lại TubuXu (đã bỏ).

**Điều phải tránh dù kỹ thuật chạy đúng**
- Tubu chịu lỗ vì ship lẻ hoặc vì điểm nhận khai khống.
- Khách ở xa gửi gói lẻ mà không biết mình lỗ.
- Cộng điểm trước khi nơi nhận xác nhận rồi phải đảo khi khách đã tiêu.
- Mỗi đại lý một tỉ giá điểm riêng, hoặc điểm của đại lý trộn vào sổ điểm của Tubu.
- Quy trình dài hơn ba bước, hoặc đại lý mất hơn vài chục giây để xác nhận một lượt.
- Quảng cáo kiểu "tái chế 100%", "xử lý đúng chuẩn" khi chưa có hợp đồng với đơn vị tái chế đầu ra.
- Lộ số điện thoại hay địa chỉ khách cho đại lý quá mức cần thiết.

## 3. Những gì chủ dự án đã chốt (2026-10-17)

1. **Phần thưởng** là Điểm Xanh lô STANDARD, theo đúng luật hiện có (1 điểm = 1.000đ, hạn 12 tháng, dùng tối đa 20% giá trị đơn, không trả phí ship), kèm thưởng giọt nước cho vỏ Tubu (2 giọt mỗi vỏ).
2. **Quà đợt 1:** 4 voucher hiện có chuyển từ mã vào DB; thêm quà trồng cây (chủ dự án viết "trồng 1 cây thật"; trong thiết kế này quà đó tên là "Góp quỹ trồng cây", lý do và cách đổi ở mục 18.2, câu 1); thêm quà nhỏ có tồn kho, nhận bằng mã tại kho hoặc điểm nhận.
3. **Thu kèm đơn mua:** Tubu chịu phí như Gomdon hiện nay, ở mọi tỉnh (đợt 1 cách này mặc định tắt cho tới khi Gomdon xác nhận bằng văn bản và một đơn thử chạy được, mục 12.4 và 18.1). **Đường gửi ship:** khách tự gửi hãng nào cũng được, nhập mã vận đơn, có ngưỡng tối thiểu, xem trước phí và điểm, hàng bị từ chối không hoàn lại.
4. **Đại lý:** một bảng quy đổi trung tâm; "ưu đãi riêng" của đại lý tự chịu tiền và tách khỏi sổ điểm; Tubu đặt hạn mức điểm theo tháng cho từng đại lý; đợt 1 không trả phí tiền mặt, chỉ ghi số lượng.
5. **Pin** không nhận ở đợt 1 (hiện "Sắp nhận"). **Bỏ `/refill`**; vỏ Tubu thành một món trong danh mục chung.

Thứ tự làm do chủ dự án đặt: dọn backlog nightly (đã làm xong, PR #15 chờ chủ dự án gộp), mockup (xong), spec này, rồi kế hoạch và code.

## 4. Trải nghiệm của khách

Các màn dưới đây khớp với mockup. Số liệu trong ngoặc là ví dụ.

**4.1 Trang Đổi rác (trang vào, ảnh 01).** Thẻ đầu trang cho thấy số Điểm Xanh hiện có quy ra tiền mua sắm, một dòng tác động ước tính (chỉ hiện khi đủ điều kiện ở 5.7), thanh tiến độ tới quà kế tiếp (14 điểm, còn 6 điểm tới mã giảm giá miễn phí ship, "tương đương khoảng 6 thùng carton"), nút "Đổi rác ngay". Bên dưới: các yêu cầu đang xử lý (mã, cách giao, mini timeline 4 bước), ba cách đổi, danh sách món Tubu nhận (món chưa nhận hiện mờ), và một hàng quà. Lối vào từ app: mục menu ở trang Cá nhân, hàng ở trang Điểm Xanh và một thẻ nhỏ trong Vườn Xanh (4.9; danh sách đầy đủ ở 16.1). Không đặt thành tab riêng ở thanh điều hướng dưới.

**4.2 Chọn món (bước 1/3, ảnh 02).** Mỗi món là một thẻ: ảnh hoặc biểu tượng, tên, quy tắc ("1 thùng = 1 điểm", "5 vỏ = 1 điểm"), mô tả ngắn cách chuẩn bị, trần, bộ đếm +/−. Món chia theo nhóm (vỏ sữa 5 vỏ = 1 điểm) có thanh tiến độ "thêm 3 vỏ nữa được +1 điểm". Thanh dính đáy: số điểm ước tính, quy ra tiền mua sắm, câu so với quà kế tiếp, nút "Tiếp tục". Món trạng thái "sắp nhận" không bấm được.

**4.3 Chọn cách giao (bước 2/3, ảnh 03).** Ba thẻ, chọn một:
- *Mang tới điểm nhận:* miễn phí, nhận điểm khi người ở điểm xác nhận. Nhãn "Nhanh nhất" khi có điểm gần.
- *Gửi về kho Tubu HCM:* khách tự gửi hãng nào cũng được và tự trả phí. Thẻ mở ra bảng xem trước: điểm ước tính, phí ship ước tính từ tỉnh của khách (lấy từ địa chỉ mặc định; chưa có thì khách chọn tỉnh ngay trên thẻ), gói tối thiểu (15 điểm). Dưới ngưỡng thì nút bị khoá kèm lời nhắn "cần thêm N điểm"; khi giá trị điểm nhỏ hơn phí ship ước tính thì hiện cảnh báo trung thực và hai lối thay thế (điểm nhận, thu kèm đơn). Dòng cuối: hàng gửi về kho không hoàn lại.
- *Thu kèm đơn mua:* miễn phí cho khách, bưu tá lấy khi giao đơn Tubu kế tiếp. Khách vẫn tạo yêu cầu ở đây như hai cách kia (nhận mã `TR-...`), rồi ở bước thanh toán của đơn kế tiếp bật công tắc "Thu kèm rác" để gắn yêu cầu vào đơn (7.3, 12.2). Thẻ này chỉ hiện khi cách này đang bật (mặc định tắt, 12.4).
Khách ở tỉnh không có điểm nhận được xem trước thẻ "Gửi về kho" (và "Thu kèm đơn" khi cách đó đang bật) lên đầu. Cuối bước, khách tích đồng ý cho Tubu xử lý yêu cầu (tách khỏi đồng ý nhận quảng cáo, 14.4); với cách Gửi về kho còn tích cam kết đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn (14.1).

**4.4 Điểm nhận gần bạn (ảnh 04).** Danh sách, không bản đồ. Có ô tìm theo tên điểm, phường/xã hoặc tên đường, nhóm "Gần tôi" và các tab theo tỉnh (TP.HCM, Hà Nội, Đà Nẵng; tỉnh nào có điểm thì hiện tab). Địa chỉ điểm theo hai cấp tỉnh và phường/xã, không có quận (11.1). Sắp theo khoảng cách (nhãn "Gần nhất"). Cuối danh sách có khối "Chưa có điểm gần bạn?" nói thật rằng gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm, và dẫn tới hai cách còn lại. Mỗi thẻ: tên, loại (Kho Tubu hoặc Đại lý), địa chỉ và khoảng cách, đang mở hay đóng, các món nhận (món không nhận gạch ngang và ghi "Không nhận"), nút "Chỉ đường" (liên kết Google Maps theo địa chỉ) và "Chọn điểm này". Điểm hết hạn mức tháng bị làm mờ, ghi "Tạm hết hạn mức tháng này", nút bị khoá. Khoảng cách tính từ vị trí khách cho phép (quyền vị trí của Zalo, điều kiện ở 16.1); nếu khách từ chối hoặc việc lấy vị trí hỏng thì nhóm "Gần tôi" và nhãn "Gần nhất" biến mất, khách chọn tỉnh hoặc tìm bằng chữ.

**4.5 Mã QR (bước 3/3, ảnh 05).** Mã yêu cầu ngắn (`TR-8K2M9`), mã QR, điểm nhận đã chọn, hạn giữ chỗ (7 ngày), danh sách món khai, danh sách chuẩn bị ("gấp phẳng, bỏ băng keo", "vỏ sữa rửa sạch để khô"), và dòng: điểm chỉ cộng sau khi điểm nhận đếm xong theo số thực nhận, không vượt số đã khai. Nút "Theo dõi yêu cầu", liên kết "Sửa món" và "Huỷ yêu cầu".

**4.6 Theo dõi (ảnh 06).** Danh sách yêu cầu của khách và chi tiết từng yêu cầu: trạng thái, timeline 4 bước (đường ship: Đã gửi, Vận chuyển, Đã nhận ở kho, Cộng điểm; đường điểm nhận: Đã tạo, Mang tới điểm, Điểm nhận đếm, Cộng điểm; đường thu kèm đơn: Đã tạo, Gắn vào đơn, Chờ kho nhận, Cộng điểm), mã vận đơn và hãng (đường ship), bảng "đã khai" và "đã đếm". Mọi bước do bên khác làm (kho nhận kiện, đã cộng điểm, từ chối, hết hạn, thu hồi điểm) đều có thông báo trong ứng dụng (11.6), vì bài học từ app khác: không báo thì khách hoang mang. Cuối màn có liên kết "Cần hỗ trợ? Nhắn Tubu Tree", dùng kênh hỗ trợ ứng dụng đang có.

**4.7 Đã cộng điểm (ảnh 07).** Số điểm vừa cộng, bảng "kho đếm được so với bạn khai" (kèm lý do từng dòng nhận thiếu hoặc từ chối), số dư mới và tiến độ tới quà, thưởng giọt nước nếu có (số giọt thực sự vào bình, có thể ít hơn khi bình đã đầy, 10.5), và thẻ tác động. Thẻ tác động chỉ nói khối lượng ("Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu", "Ước tính theo khối lượng trung bình"), không nói CO2 hay cây, và chỉ hiện khi mọi món trong lượt có trọng lượng mỗi đơn vị do admin đặt (5.7). Nếu lượt đếm cho 0 điểm (ví dụ 3 vỏ hộp sữa khi cần 5 vỏ mới được 1 điểm), màn nói thật là chưa đủ để cộng, không hiện "đã cộng điểm" (10.1). Hai nút: "Đổi quà ngay" và "Đổi thêm rác". Màn này đứng riêng, không nằm trong trình hướng dẫn ba bước.

**4.8 Kho quà (ảnh 08).** Số dư, ghi chú luật dùng điểm. Ba tab: Mã giảm giá, Cây và hạt, Quà nhỏ. Mỗi quà: tên, mô tả, giá, nút "Đổi" hoặc "Cần thêm N điểm" kèm thanh tiến độ, số còn lại nếu có tồn kho. Bấm "Đổi" mở khung xác nhận (điểm còn lại sau khi đổi), rồi hiện kết quả: mã giảm giá vào ví, mã nhận quà (quà nhỏ và gói hạt), hoặc xác nhận đã góp một cây vào quỹ trồng cây (không hứa cây cụ thể, không kèm giấy chứng nhận, mục 8).

**4.9 Lối vào từ Vườn Xanh (ảnh 09).** Một thẻ nhỏ trong trang Vườn Xanh, có nhãn "Mới", dẫn tới trang Đổi rác, kèm một dòng: giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm. Việc đổi rác không nằm trong game. Giọt nước thưởng cho vỏ Tubu đi vào bình nước hiện có của khách, kẹp theo sức chứa bình (10.5). Thẻ thay hàng "Đổi vỏ chai lấy nước" của Refill; các lối vào khác ở 16.1.

**4.10 Đại lý nhận hàng (ảnh 10).** Màn của người ở điểm (chủ điểm và nhân viên do admin gắn tên) trong chính mini app: hạn mức điểm tháng này (đã dùng, còn lại), ô nhập mã (quét QR bằng camera là tuỳ chọn, 15.3), thẻ yêu cầu (tên khách che bớt, số điện thoại che bớt), danh sách món với "khách khai N" và bộ đếm "số thực nhận" không vượt N, ô "Điểm Tubu sẽ cộng cho khách" tính trực tiếp, nút "Xác nhận đã nhận". Xác nhận xong: "Tubu sẽ cộng N điểm cho khách" và hạn mức mới. Ghi chú trên màn: đại lý không tự cộng điểm. Có thẻ "Ưu đãi riêng của cửa hàng" (tự chịu, không liên quan Điểm Xanh); chủ điểm bấm "Chỉnh sửa", nội dung mới chờ admin duyệt (5.6).

**4.11 Admin (ảnh 11 và 12).** Một tab "Đổi rác" với năm phần (mục 9). Mockup có hai phần: Hàng nhận và Điểm nhận.

## 5. Luật điểm, món hàng và chống gian lận

### 5.1 Món hàng (do admin cấu hình)
Mỗi món có: mã, tên, đơn vị hiển thị ("thùng", "túi lớn", "vỏ"), mức quy đổi "N đơn vị = M điểm" (điểm = phần nguyên của số lượng chia N, nhân M; phần lẻ của từng yêu cầu không cộng dồn), thưởng giọt nước mỗi đơn vị (chỉ vỏ Tubu: 2), trần số lượng mỗi khách mỗi ngày và mỗi tháng (có thể để trống), trạng thái (`ACTIVE`, `COMING_SOON`, `HIDDEN`), hướng dẫn chuẩn bị, ảnh, thứ tự, trọng lượng ước tính mỗi đơn vị (gram, có thể trống) và cờ `hazardous`. Món `hazardous` không bao giờ được đặt `ACTIVE` (ràng buộc ở DB và ở API), để chặn việc nhận pin ngoài ý muốn. Mức quy đổi và thưởng giọt nước được **chụp lại** vào từng dòng yêu cầu lúc tạo; sửa bảng quy đổi chỉ áp cho yêu cầu mới.

Mặc định đề xuất cho dữ liệu khởi tạo (admin đổi được): thùng carton cũ 1 thùng = 1 điểm, trần 10 thùng mỗi ngày; nilon chống sốc 1 túi lớn = 1 điểm, trần 10 túi mỗi ngày; vỏ hộp sữa sạch 5 vỏ = 1 điểm, trần 50 vỏ mỗi ngày; vỏ chai, hộp Tubu Tree 1 vỏ = 2 điểm và 2 giọt nước mỗi vỏ, trần 20 vỏ mỗi tháng; pin đã dùng `COMING_SOON` và `hazardous`. Mockup chỉ ghi trần trên những thẻ có trần; bảng này là bản đề xuất đầy đủ. Mức này theo nguyên tắc từ nghiên cứu: tỉ lệ nguyên số dễ nhớ (5 vỏ = 1 điểm), carton trả tương đương giá ve chai (khoảng 3.000đ mỗi kg), thưởng 30 đến 40% giá trị Tubu thu lại được. Các tỉ lệ dùng lại thực tế (giả định 40% carton, 50% xốp hơi) phải đo trong 1 đến 2 tháng chạy thử rồi chỉnh.

### 5.2 Khi nào điểm được cộng
1. Khách tạo yêu cầu: chỉ lưu số khai và số điểm ước tính. Chưa cộng gì.
2. Nơi nhận (đại lý, nhân viên kho) đếm số thực nhận từng dòng, không vượt số khai, ghi lý do cho dòng nhận thiếu.
3. Hệ thống tính điểm từ số thực nhận và mức quy đổi đã chụp, kiểm trần điểm mỗi nhân viên mỗi ngày (5.5) và hạn mức của điểm nhận (đại lý), rồi cộng điểm một lần duy nhất trong cùng một giao dịch với việc chuyển trạng thái yêu cầu sang hoàn tất (10.1, 15.5). Trần của khách đã được giữ từ lúc tạo yêu cầu (5.3) và số thực nhận không vượt số khai, nên bước này không kiểm lại trần khách. Gọi lại thao tác xác nhận không cộng lần hai.
4. Điểm vào ví là lô STANDARD (hạn 12 tháng, dùng được theo luật hiện có), dòng sổ `RECYCLE:<mã yêu cầu>`. Thưởng giọt nước đi vào bình nước của khách trong cùng giao dịch, kẹp theo sức chứa bình (10.5).
5. Điểm tiêu được ngay, không giữ chờ. Tôi đã bỏ phương án "giữ điểm N giờ" vì các lớp kiểm khác (xác nhận của nơi nhận, hạn mức đại lý, trần khách, thu hồi) đã có (mục 18.2, câu 2). Yêu cầu tính ra 0 điểm vẫn hoàn tất và khách được báo đúng sự thật là chưa đủ để cộng (10.1).

### 5.3 Trần và giới hạn cho khách
- Trần theo món mỗi ngày và mỗi tháng (5.1), tính theo số thực nhận nếu đã đếm, theo số khai nếu chưa đếm, trên mọi yêu cầu còn hiệu lực hoặc đã hoàn tất (kể cả bị thu hồi). Huỷ, từ chối và hết hạn trả lại phần trần (11.2).
- Trần điểm mỗi khách mỗi tháng cho chương trình (mặc định đề xuất 60 điểm, `waste.customer_monthly_cap_points`).
- Số yêu cầu đang mở cùng lúc tối đa 3 (`waste.max_open_requests`); yêu cầu đang mở là yêu cầu ở trạng thái `OPEN`, `IN_TRANSIT` hoặc `RECEIVED`.
- Đường ship: gói tối thiểu 15 điểm ước tính; trọng lượng tối đa 20 kg và cạnh dài tối đa 50 cm mỗi kiện (theo giới hạn của hãng chuyển phát; hệ thống không đo, khách cam kết và kho từ chối kiện vượt giới hạn); khách phải đồng ý quy tắc đóng gói (sạch, khô, không lẫn pin, hoá chất, vật nhọn).
- Khách phải là người dùng thật (không phải khách vãng lai) đã có số điện thoại. Một mã vận đơn chỉ dùng cho một yêu cầu trong toàn hệ thống. Đợt 1 không đánh dấu "trùng thiết bị" vì chưa có dấu vết thiết bị đáng tin (mục 18.2, câu 14).

### 5.4 Nhận thiếu, từ chối, hết hạn, thất lạc
- Nhận thiếu: điểm theo số thực nhận. Hiện cho khách bảng "đã khai" và "đã đếm" kèm lý do (ướt, bẩn, lẫn vật lạ, sai loại, hỏng).
- Từ chối toàn bộ: yêu cầu chuyển `REJECTED`, thông báo kèm lý do, không cộng điểm. Hàng ship về kho không hoàn lại.
- Hết hạn: điểm nhận chưa tới trong 7 ngày kể từ lúc tạo thì `EXPIRED` và trả lại phần trần đã giữ. Đường ship chưa nhập mã vận đơn trong 7 ngày cũng `EXPIRED`. Đã nhập mã nhưng 30 ngày chưa thấy hàng về thì chuyển vào danh sách admin xem lại, không tự đóng. Thu kèm đơn: sau khi đơn mua đã giao, quá 14 ngày mà kho chưa nhận gì thì `EXPIRED` (mục 12.3). Các số ngày là cấu hình (11.5).
- Hàng về kho không rõ chủ (thiếu mã yêu cầu, không khớp mã vận đơn): vào danh sách "hàng không rõ chủ" của admin.
- Chênh lệch lặp lại: nếu nhận thiếu quá một nửa số khai trong 3 yêu cầu liền nhau (tính trên các yêu cầu đã hoàn tất ở kho, tức `MAIL_IN` và `PICKUP`) thì khoá đường gửi kho và đường thu kèm đơn của khách đó (Tubu chịu phí ở cả hai), chỉ cho đường mang tới điểm, chờ admin mở lại; khách nhận `WASTE_SHIP_LOCKED`. Ngưỡng là cấu hình (`waste.shortfall_lock_pct`, `waste.shortfall_lock_streak`).
- Thu hồi điểm: admin được thu hồi điểm của một yêu cầu đã hoàn tất (gian lận phát hiện sau). Cách thu hồi theo cơ chế đảo hiện có của sổ điểm (mục 10.3): chỉ thu phần khách còn giữ, số dư không bao giờ âm; khách nhận thông báo rõ lý do, không huỷ điểm âm thầm.

### 5.5 Chống gian lận
Rủi ro lớn nhất nằm ở bên có quyền (đại lý, nhân viên điểm nhận), không phải khách lẻ. Vì vậy:
- Đại lý không tạo điểm. Chỉ Tubu cộng, và chỉ theo số lượng đại lý xác nhận.
- **Hạn mức điểm theo tháng cho từng đại lý** do Tubu đặt. Cộng điểm kiểm hạn mức và tăng bộ đếm trong cùng một câu lệnh có điều kiện, nên nhiều khách xác nhận cùng lúc không vượt hạn mức. Hết hạn mức thì điểm nhận hiện mờ và không xác nhận được.
- Người xác nhận không được là chính khách, không dùng cùng số điện thoại với khách, và (ở điểm có nhiều người) không xác nhận cho yêu cầu do đồng nghiệp cùng điểm tạo.
- Mỗi lần xác nhận ghi: ai, lúc nào, từ máy nào (địa chỉ IP bỏ octet cuối, đầu chuỗi user agent), số khai, số nhận, số điểm. Nhật ký chỉ thêm, không sửa (11.1).
- Trần điểm mỗi nhân viên (kho hoặc điểm nhận) được xác nhận mỗi ngày (`waste.staff_daily_cap_points`, mặc định 1.000 điểm), để một người có quyền không thể cộng điểm hàng loạt trước khi bị phát hiện (15.4).
- Cảnh báo bất thường cho admin: đại lý dùng hạn mức nhanh bất thường so với trung bình các điểm khác, số lượng trung bình mỗi lượt cao bất thường, một khách lặp lại ở một điểm, tỉ lệ nhận đủ đúng bằng số khai gần như 100%. Ngưỡng là cấu hình.
- Kiểm mẫu: admin chọn lượt để yêu cầu đại lý chụp ảnh hoặc gửi lô về kho đối chiếu. Đợt 1 làm thủ công từ danh sách, chưa tự động.
- Điểm nhận không hoạt động 60 ngày bị ẩn khỏi danh sách, admin quyết định thu hồi thùng.
- Điểm nhận loại `PARTNER` là danh sách riêng do admin tạo và duyệt, không tự sinh từ cửa hàng đối tác. Chủ điểm phải còn là cửa hàng đối tác (`isPartnerStore`) tại mỗi lần xác nhận. Cờ này rộng hơn "cửa hàng thật có người đón khách" (loại cộng tác viên cũng bật được), nên admin quyết định khi duyệt (mục 18.2, câu 7).

### 5.6 Ưu đãi riêng của đại lý
Đại lý được ghi một dòng "ưu đãi riêng" (ví dụ giảm 10% hoá đơn đầu cho khách mang rác). Đó là khuyến mại của chính cửa hàng, tự chịu tiền, hiển thị riêng trong thẻ điểm nhận, không đi qua sổ Điểm Xanh và Tubu không đảm bảo. Admin duyệt nội dung trước khi hiện. Đợt 1 chỉ là văn bản hiển thị, không có luồng thanh toán hay đối soát trong hệ thống. Chủ điểm nhận thông báo `WASTE_PERK_REVIEWED` khi nội dung được duyệt hoặc bị từ chối (11.6).

### 5.7 Tác động: chỉ nói khối lượng
Chỉ có một con số: khối lượng ước tính = số thực nhận nhân trọng lượng mỗi đơn vị (`gramsPerUnit`, admin đặt). Số này hiện ở màn Đã cộng điểm và Trang Đổi rác, kèm chữ "ước tính theo khối lượng trung bình", và chỉ khi mọi món trong lượt có trọng lượng. Admin chỉ đặt trọng lượng cho món có đầu ra thật (14.7); món nào thiếu trọng lượng thì không hiện dòng này, và dữ liệu khởi tạo để trống trọng lượng cho tới khi chủ dự án cân thử (11.7).

Không có hệ số CO2e, không quy ra cây, không nói "tái chế", "hấp thụ" hay "giảm khí thải". Lý do: repo có quyết định C-010 và Q-16 cấm các cách nói đó ở mini app, web admin và dữ liệu seed, và Tubu chưa có hợp đồng nhận đầu ra cho từng món. Bản nháp trước của tài liệu này có hệ số theo EPA WARM; tôi đã bỏ (mục 18.2, câu 1). Kho có thể ghi thêm khối lượng cân thật của cả yêu cầu (`receivedWeightGrams`, 11.1) để sau này có số nếu cần.

## 6. Điểm nhận và đại lý

**Bảng điểm nhận chung** thay cho `RefillPickupLocation` và danh sách đại lý rời rạc. Loại `WAREHOUSE` (kho Tubu HCM, không hạn mức, chỉ một điểm trong cả bảng) và `PARTNER` (đại lý). Mỗi điểm: tên, địa chỉ, tỉnh và phường/xã (địa giới hai cấp của hệ thống, không có quận), toạ độ (admin nhập tay), giờ mở theo thứ trong tuần, các món nhận (bảng liên kết), trạng thái (`ACTIVE`, `PAUSED`, `PENDING`), hạn mức điểm mỗi tháng (đại lý), ưu đãi riêng, ghi chú. Đại lý đăng ký qua admin; Tubu duyệt và đặt hạn mức (mặc định đề xuất 100 điểm cho điểm mới, 300 cho điểm đã chạy ổn). Trạng thái "hết hạn mức" không lưu: hệ thống suy ra từ mức đã dùng so với hạn mức của tháng. Admin thấy nhãn "Tạm dừng, hết hạn mức" và điểm tự mở lại khi sang tháng.

**Ai được xác nhận.** Người ở điểm do admin gắn tên (tối đa 5 người mỗi điểm, thường là chủ và nhân viên của cửa hàng; đợt 1 chủ điểm chưa tự thêm nhân viên được). Kho: nhân viên Tubu (vai STAFF) và admin, kèm trần điểm mỗi nhân viên mỗi ngày (15.4). Người ở điểm chỉ thấy tên che bớt, số điện thoại che bớt và danh sách món của yêu cầu mà chính họ đang xử lý; nhân viên kho thấy số điện thoại che bớt, admin thấy đầy đủ. Hồ sơ khách không hiện ra ngoài lượt đó.

**Trải nghiệm đại lý.** Mục tiêu một lượt xác nhận trong khoảng 10 giây là chỉ tiêu cần đo thử, chưa kiểm chứng: gõ mã (quét QR bằng camera là tuỳ chọn), màn đếm hiện sẵn đúng món điểm đó nhận, nút xác nhận lớn.

**Đối soát tháng.** Báo cáo mỗi điểm: số lượt, số đơn vị theo món, số điểm đã cộng, mức dùng hạn mức. Đợt 1 chỉ để xem và xuất; chưa trả tiền theo đơn vị. Số lượng được ghi đủ để đợt sau tính phí theo đơn vị (hướng tham khảo: phí nhỏ cố định trên mỗi đơn vị do trung tâm trả, như mô hình Áo và Oregon, mức thật phải thử).

## 7. Ba cách giao

### 7.1 Mang tới điểm nhận
Khách chọn điểm, nhận mã và QR, mang hàng tới trong 7 ngày. Người ở điểm nhập mã (hoặc quét), đếm và xác nhận. Yêu cầu đi thẳng tới hoàn tất, không có bước trung gian.

### 7.2 Gửi về kho Tubu HCM
Khách tạo yêu cầu (nhận mã), tự đóng gói theo hướng dẫn, ghi mã yêu cầu lên kiện, gửi bằng hãng bất kỳ, rồi nhập hãng và mã vận đơn trong 7 ngày. Kho nhận kiện, tra mã yêu cầu hoặc mã vận đơn, đếm từng dòng và xác nhận. Hàng không hoàn lại. Với khách ngoài TP.HCM đây thường là cách duy nhất, nhưng không phải cách lời nhất: màn Chọn cách giao phải hiện "ước tính phí ship" và "ước tính điểm" cạnh nhau, chặn gói dưới ngưỡng, và đưa điểm nhận và thu kèm đơn lên trước. Giá cước thật phụ thuộc hợp đồng của Tubu với Gomdon hoặc hãng khác, cần xin báo giá thật; bảng giá niêm yết đã tìm được chỉ để tham khảo. Bảng ước tính phí theo tỉnh là một cấu hình admin chỉnh được (`waste.mailin_fee_table`: ban đầu theo vùng, mỗi vùng một khoảng thấp và cao), không gọi API hãng.

### 7.3 Thu kèm đơn mua
Công tắc "gửi lại vật liệu tái chế" ở bước thanh toán (kèm một ghi chú tự do, gắn vào đơn mua) được thay bằng công tắc "Thu kèm rác" gắn với một yêu cầu có cấu trúc của khách. Chi tiết kỹ thuật ở mục 12. Nguyên tắc sản phẩm: Tubu chịu phí như hiện nay. Gomdon không báo gì về vật liệu (không có sự kiện "đã nhận" hay "không thu được", mục 12.1), nên điểm chỉ được cộng sau khi kho nhận và đếm hàng thu về, không bao giờ theo trạng thái giao của đơn. Nếu quá 14 ngày sau khi đơn giao mà kho chưa nhận gì thì yêu cầu hết hạn và khách được báo. Cách này mặc định tắt cho tới khi Gomdon trả lời bằng văn bản và đơn thử chạy được (12.4).

### 7.4 Vòng đời của một yêu cầu
Trạng thái (`WasteRequestStatus`) và ai được chuyển:

| Trạng thái | Nghĩa | Vào từ | Ai chuyển |
|---|---|---|---|
| `OPEN` | Mới tạo. Mang tới điểm: chờ khách mang tới. Gửi kho: chờ khách nhập mã vận đơn. Thu kèm đơn: chưa gắn đơn, hoặc đã gắn đơn và chờ đơn được giao | tạo mới | khách |
| `IN_TRANSIT` | Gửi kho: đã nhập mã vận đơn. Thu kèm đơn: đơn mua đã giao, chờ hàng về kho | `OPEN` | khách (nhập mã vận đơn); hệ thống (khi đơn mua thành `DELIVERED`, mục 12.2) |
| `RECEIVED` | Kho đã nhận kiện, chưa đếm xong (cho phép kho nhận theo lô rồi đếm sau) | `OPEN` (kiện đến trước khi khách nhập mã vận đơn), `IN_TRANSIT` | nhân viên kho |
| `COMPLETED` | Đã đếm, đã cộng điểm | `OPEN` (mang tới điểm: nhận và đếm cùng một thao tác; hoặc kho nhận và đếm một lần), `IN_TRANSIT`, `RECEIVED` | nơi nhận xác nhận; hệ thống cộng điểm trong cùng giao dịch |
| `REJECTED` | Từ chối toàn bộ, không cộng điểm | `OPEN`, `IN_TRANSIT`, `RECEIVED` | nơi nhận |
| `CANCELLED` | Khách huỷ, hoặc đơn mua gắn với yêu cầu thu kèm bị huỷ hay trả | `OPEN` | khách (khi chưa gắn đơn); hệ thống (theo đơn, mục 12.2) |
| `EXPIRED` | Quá hạn giữ chỗ, chưa nhập mã vận đơn, hoặc (thu kèm đơn) hàng không về kho sau khi đơn giao | `OPEN`, `IN_TRANSIT` (chỉ thu kèm đơn) | cron |
| `REVERSED` | Đã thu hồi điểm (gian lận phát hiện sau) | `COMPLETED` | admin |

Quy tắc kèm theo:
- Chỉ có một đường đi tới `COMPLETED`: câu lệnh xác nhận của nơi nhận (giao dịch ở 15.5). Câu lệnh đó đổi trạng thái, cộng điểm, tăng bộ đếm hạn mức và ghi nhật ký trong cùng một giao dịch. Gọi lại thì trả kết quả cũ, không cộng lần hai.
- Khách sửa món chỉ khi `OPEN` và chưa gắn đơn. Đã nhập mã vận đơn thì số khai bị khoá. Yêu cầu thu kèm đã gắn đơn thì khách không sửa món và không huỷ, vì ghi chú của đơn đã dựng từ các dòng của yêu cầu; chỉ việc đơn bị huỷ hoặc trả mới đóng yêu cầu (mục 18.2, câu 11). Khách khai rộng tay không bị phạt, vì điểm tính theo số thực nhận kẹp trần số khai; việc khai khống lặp lại bị chặn bằng quy tắc ở 5.4.
- Mã vận đơn của khách sửa được khi còn `IN_TRANSIT` (gõ nhầm), mỗi lần sửa ghi nhật ký.
- `EXPIRED` trả lại phần trần ngày và tháng của khách đã giữ cho yêu cầu đó.
- Thời gian giữ chỗ và thời gian chờ mã vận đơn là cấu hình (mặc định 7 ngày). Yêu cầu gửi kho ở `IN_TRANSIT` quá 30 ngày không tự đóng, vào danh sách admin xem lại (5.4). Yêu cầu thu kèm đơn ở `IN_TRANSIT` hết hạn sau 14 ngày (12.3).
- Mỗi lần đổi trạng thái do bên khác làm (kho nhận kiện, hoàn tất, từ chối, hết hạn, thu hồi, thu kèm đơn bắt đầu hoặc bị huỷ) gửi thông báo cho khách (mẫu ở 11.6).

## 8. Kho quà

Danh mục quà chuyển từ mã vào DB, admin quản lý. Mỗi quà có: tên, mô tả, loại (`VOUCHER`, `TREE`, `SEED_PACK`, `GIFT`), giá điểm, trạng thái, nhãn, thứ tự, ảnh, tồn kho (trống là không giới hạn), và với voucher các trường của coupon (loại giảm, giá trị, đơn tối thiểu, mức giảm tối đa, số ngày hiệu lực). Chữ hiển thị cho khách là "mã giảm giá", không phải "voucher".

Bốn voucher hiện có chuyển nguyên giá trị: miễn phí vận chuyển 20 điểm (đơn từ 99.000đ), giảm 50.000đ 50 điểm (đơn từ 300.000đ), giảm 15% tối đa 80.000đ 75 điểm (đơn từ 250.000đ), giảm 100.000đ 100 điểm (đơn từ 600.000đ), mỗi voucher hiệu lực 30 ngày. Luật đổi hiện có giữ nguyên: đổi bằng một câu cập nhật có điều kiện trên số dư để tránh âm điểm khi gọi song song, và điểm của đơn còn trong thời hạn trả hàng không đổi được. Lõi đổi quà vẫn nằm ở `LoyaltyService.redeemReward` (giữ nguyên thứ tự khoá và cách kiểm điểm đang bị khoá, vốn đã được test kỹ); thay đổi chỉ là nguồn danh mục (bảng thay cho hằng trong mã), thêm loại quà, tồn kho và khoá chống đổi lặp (`Idempotency-Key`, mục 15.1). Dòng sổ của mã giảm giá giữ nguyên `LOYALTY_REDEEM_VOUCHER:<id>`; quà vật lý và gói hạt dùng `GIFT_REDEEM:<id>` (10.4); quà trồng cây dùng dòng sổ hiện có của `buyTree`.

**Góp quỹ trồng cây** (`TREE`): dùng lại `GameService.buyTree` hiện có, vốn đã tiêu Điểm Xanh theo đúng luật lô và tạo một bản ghi `PlantedTree` ghi nhận khoản góp, không hứa cây cụ thể. Giá luôn lấy từ `game.tree_points_price` (mặc định 50 điểm), không có giá riêng ở bảng quà. Chủ dự án viết "trồng 1 cây thật"; bản này nói "góp quỹ trồng cây" vì repo cấm các cách nói "cây thật", "mua cây", "CO2", "Mã chứng nhận" và Tubu chưa có hợp đồng với đơn vị trồng cây (mục 18.2, câu 1). Đợt này không có hàng đợi trồng cây cho admin.

**Gói hạt giống Tubu** và **quà nhỏ vật lý** (túi vải, bình xịt...): có tồn kho trừ nguyên tử lúc đổi (câu lệnh có điều kiện `stock >= 1`, theo tiền lệ của kho hàng); khách nhận một mã nhận quà (dạng `QG-` kèm 6 ký tự, hạn nhận 60 ngày, `waste.gift_claim_days`); người ở điểm hoặc nhân viên kho nhập mã để chuyển sang "đã nhận". Mặc định chỉ nhận ở kho Tubu; admin bật thêm từng điểm nhận (`giftHandoverEnabled`) nếu Tubu đã giao quà tới điểm đó. Quá hạn nhận thì vào danh sách admin xem lại, không tự huỷ; admin huỷ được lượt đổi chưa nhận và hoàn điểm (15.4). Quà vật lý do Tubu mua nên không có sẵn dữ liệu khởi tạo; admin tạo khi có hàng (11.7).

## 9. Admin

Một tab "Đổi rác" gồm năm phần (cấu trúc code ở 16.2):
1. **Hàng nhận:** bảng món và bảng sửa (như mockup), kèm xem trước thẻ khách thấy.
2. **Điểm nhận:** bảng điểm, hạn mức tháng và mức dùng, đăng ký điểm mới (địa chỉ, tỉnh và phường/xã chọn từ danh mục địa giới, toạ độ nhập tay, giờ mở), người ở điểm, món nhận, nhật ký cộng điểm, số lượng đã nhận trong tháng, cảnh báo bất thường, duyệt ưu đãi riêng.
3. **Yêu cầu:** hàng đợi theo cách giao và trạng thái; màn đếm cho kho (nhập số thực nhận, chọn lý do thiếu, từ chối); hàng không rõ chủ; yêu cầu quá hạn cần xem lại; thu hồi điểm.
4. **Quà:** danh mục, tồn kho, hàng đợi quà chờ nhận (quà vật lý và gói hạt).
5. **Cấu hình chung:** các ngưỡng toàn hệ thống là các khoá `waste.*` ở 11.5 (gói gửi kho tối thiểu, trần điểm mỗi khách mỗi tháng, số yêu cầu mở tối đa, số ngày giữ chỗ, ngưỡng cảnh báo, bảng ước tính phí ship theo vùng, bật tắt từng cách giao...). Các giá trị cố định của Điểm Xanh (1.000đ mỗi điểm) chỉ hiện để xem.

Mockup vẽ hai phần đầu và chỉ vẽ các trường chính (tên, đơn vị, quy đổi, trần, mô tả, ảnh); các trường còn lại ở 5.1 và 6 builder thêm theo cùng kiểu. Dải thông số ở đầu phần Hàng nhận hiện giá trị 1 điểm, hạn điểm, mức dùng tối đa và gói gửi kho tối thiểu. Đầu tab có dải số liệu tháng này (17.2). Nhân viên (không phải admin) thấy tab này nhưng chỉ phần "Yêu cầu" (hàng đợi kho) và hàng đợi quà chờ nhận (16.2).

Mọi thao tác sửa của admin ghi nhật ký (ai, lúc nào, trước và sau).

## 10. Sổ Điểm Xanh và giọt nước

Mục này nói điểm đổi rác đi vào sổ điểm hiện có như thế nào. Không đổi luật Điểm Xanh nào. Điểm RECYCLE chỉ là một nguồn cộng mới vào cùng một sổ.

### 10.1 Đường cộng điểm duy nhất
- Chỉ có một nơi ghi điểm đổi rác: bước xác nhận của nơi nhận (mục 7.4 và 15.5). Không có đường cộng thứ hai, không có công cụ cộng tay.
- Ghi bằng `RewardPointsService.grant`, lô STANDARD, nên 1 điểm = 1.000đ, hạn theo `loyalty.point_expire_months` (12 tháng), dùng tối đa 20% giá trị hàng của một đơn và không trừ được vào phí ship. Không ghi vào lô CONVERTED, vì lô đó không hết hạn và không bị trần 20%.
- Dòng sổ: `reason = RECYCLE:<mã yêu cầu>`, `refType = RECYCLE`, `refId = <id của yêu cầu>`. Mỗi yêu cầu có đúng một dòng cộng, dù có nhiều món.
- **Khoá chống cộng đôi** gồm hai lớp. Lớp chính là trạng thái của yêu cầu: câu lệnh `updateMany` chuyển sang `COMPLETED` chỉ thắng một lần. Lớp phụ là chỉ mục duy nhất từng phần `points_transactions_recycle_ref_key` trên `("refId") WHERE "refType" = 'RECYCLE'`, viết tay trong migration. Chỉ mục này không được có `userId` trong khoá, vì khi hai tài khoản của một khách được gộp, mọi dòng sổ chuyển sang tài khoản đích và một chỉ mục có `userId` sẽ đụng khoá. Chỉ mục mới tự được kiểm tra sau `migrate deploy` (kiểm tra trong CI e2e tự thu thập từ migration), nên không cần thêm vào danh sách `KNOWN_PARTIAL_UNIQUE_INDEXES`; nếu thêm thì phải sửa dòng ghim độ dài 20 trong race spec `partial-unique-indexes`.
- `grant` chỉ nhận số nguyên từ 1 đến 2000 và ném lỗi 500 nếu ngoài khoảng, làm hỏng cả giao dịch xác nhận. Trần điểm mỗi khách mỗi tháng (5.3) đã giữ số điểm của một yêu cầu rất xa mức đó, nhưng bước xác nhận vẫn kiểm và trả lỗi 400 rõ ràng trước khi gọi `grant`. Không nâng hằng 2000 (đó là chốt chặn nhầm đơn vị xu và điểm). Yêu cầu tính ra 0 điểm (ví dụ 3 vỏ hộp sữa khi cần 5 vỏ mới được 1 điểm) vẫn hoàn tất, không gọi `grant`, và thông báo cho khách đúng sự thật là chưa đủ để cộng.
- `grant` trả `false` nghĩa là điểm của yêu cầu này đã được cộng. Người gọi coi đó là lặp lại: trả kết quả cũ, ghi cảnh báo vào log, không báo "thành công mới" cho khách.
- Đọc `expiresAt` và mọi cấu hình trước khi mở giao dịch. Không bắt lỗi trùng khoá `P2002` bên trong giao dịch (Postgres huỷ cả giao dịch); bắt ở ngoài.
- Thứ tự khoá trong giao dịch xác nhận: dòng yêu cầu, rồi dòng bộ đếm hạn mức của điểm nhận (11.1), rồi dòng `users` (do `grant` tăng số dư), rồi dòng hồ sơ game (giọt nước). Không giao dịch hiện có nào khoá dòng yêu cầu hoặc dòng bộ đếm, nên không tạo vòng chờ. Race spec phải chứng minh điều này.
- Điểm đổi rác dùng được ngay: cơ chế khoá điểm hiện có chỉ khoá điểm của đơn hàng còn trong thời hạn trả hàng. Điểm đổi rác không tính vào xét hạng thành viên và không tính vào chi tiêu 12 tháng (hạng chỉ tính từ điểm đơn đã giao). Cả hai là hành vi mặc định của sổ điểm; spec này giữ nguyên và coi đó là quyết định của tôi (mục 18.2, câu 2).

### 10.2 Thông báo
`grant` không tự gửi thông báo. Sau khi giao dịch đã commit, ngoài giao dịch, gọi `notify(userId, 'WASTE_POINTS_CREDITED', {...}, { dedupeKey: 'waste:<id yêu cầu>:COMPLETED' })` và nuốt lỗi gửi bằng `.catch(() => undefined)`, đúng như Refill đang làm. Việc gửi thông báo hỏng không được làm hỏng việc cộng điểm. Mọi thông báo ở 11.6 theo cùng cách.

### 10.3 Thu hồi điểm
Chỉ ADMIN thu hồi được, và chỉ với yêu cầu đang `COMPLETED`.
- Trong một giao dịch: chuyển `COMPLETED` sang `REVERSED` bằng `updateMany` có điều kiện trạng thái; ghi dòng sổ âm `reason = RECYCLE_REVERSED:<mã yêu cầu>`, `refType = RECYCLE_REVERSED`, `refId = <id yêu cầu>`, lô STANDARD. Chỉ mục duy nhất từng phần thứ hai `points_transactions_recycle_reverse_key` trên `("refId") WHERE "refType" = 'RECYCLE_REVERSED'` bảo đảm thu hồi lặp lại không trừ hai lần.
- Thêm `RECYCLE_RULE` vào `REVERSAL_RULES` của `loyalty-expiry.service.ts`, theo mẫu `REVIEW_RULE`, ghép dòng cộng `RECYCLE` với dòng thu hồi `RECYCLE_REVERSED` cùng `refId`. Thiếu luật này, cơ chế tính hết hạn theo thứ tự vào trước ra trước coi dòng âm là một lần tiêu và trừ nhầm lô cũ nhất của khách, rồi cron hết hạn có thể trừ lần hai.
- Số điểm thu hồi là phần nhỏ hơn giữa số đã cộng và phần còn thu hồi được của lô đó. Khách đã tiêu bớt thì chỉ thu phần còn lại. Phần thiếu ghi vào yêu cầu (`reversalShortfallPoints`) và vào nhật ký để admin thấy; số dư không bao giờ âm và đợt 1 không có cơ chế đòi nợ điểm. Admin có thể khoá khách (11.1, bảng `waste_user_flags`).
- Giọt nước đã thưởng không thu hồi (giá trị nhỏ, chỉ dùng trong game). Hạn mức tháng của điểm nhận không được hoàn lại sau thu hồi, để thu hồi vì gian lận không mở đường cho điểm nhận đó cộng tiếp. Admin nâng hạn mức bằng tay nếu muốn.
- Khách nhận thông báo `WASTE_POINTS_REVERSED` kèm lý do và số điểm thực đã thu.

### 10.4 Nhãn trong sổ điểm
Sổ điểm hiện có ba bảng nhãn viết tay (miniapp, web, danh sách trong spec của web); mã lạ rơi về "Điều chỉnh Điểm Xanh". Thêm các tiền tố sau vào cả ba, cùng dòng test của hai bảng test (`account-api.spec.ts` của miniapp, `ledger-labels.spec.ts` của web):

| Tiền tố reason | Nhãn hiển thị |
|---|---|
| `RECYCLE:` | Đổi rác lấy quà |
| `RECYCLE_REVERSED:` | Thu hồi điểm đổi rác |
| `GIFT_REDEEM:` | Đổi điểm lấy quà |
| `GIFT_REFUND:` | Hoàn điểm quà |

Nhãn dùng "Điểm Xanh", không dùng "xu", không dùng "voucher". Nhãn hiện có `LOYALTY_REDEEM_VOUCHER:` (Đổi điểm lấy mã giảm giá) giữ nguyên.

### 10.5 Giọt nước
- Giọt nước thưởng cho vỏ Tubu cộng vào hồ sơ game trong cùng giao dịch xác nhận, ngay sau khi chuyển trạng thái `COMPLETED` thành công. Khoá chống cộng đôi chính là câu lệnh chuyển trạng thái đó.
- Cộng xong thì kẹp theo `game.tank_capacity` như quiz, quà tặng và các nguồn giọt nước khác. Refill cũ cộng thẳng không kẹp và có thể đẩy bình vượt sức chứa (mặc định 50 giọt mỗi vỏ nhân trần 20 vỏ ra 1.000, trong khi bình chứa 500). Số giọt thực sự vào bình ghi vào `dropsAwarded` của yêu cầu và hiện cho khách ở màn Đã cộng điểm.
- Không có sổ giọt nước. Con số đã thưởng nằm trên yêu cầu để kiểm toán; đó là mọi dấu vết sẽ có.
- Điểm Xanh và giọt nước thuộc hai kho khác nhau và không đổi qua lại. Việc đổi rác không nằm trong game (4.9).

## 11. Mô hình dữ liệu, cấu hình và thông báo

Mọi thứ dưới đây là bảng và dòng mới, chỉ thêm vào, nên bản triển khai cũ vẫn chạy được trên lược đồ mới. Tên model theo quy ước Prisma của repo, tên bảng dạng `waste_*`. Builder được đổi tên trường cho khớp quy ước, nhưng không được bỏ ràng buộc nào ở 11.3.

### 11.1 Các bảng

| Bảng (model) | Giữ gì | Ghi chú quan trọng |
|---|---|---|
| `waste_items` (`WasteItem`) | Món nhận: `code` duy nhất, tên, đơn vị hiển thị, `unitsPerPoint` (N) và `pointsPerGroup` (M), `dropsPerUnit`, trần ngày và tháng theo số lượng (trống = không trần), `status` (`ACTIVE`, `COMING_SOON`, `HIDDEN`), hướng dẫn chuẩn bị, ảnh, thứ tự, `gramsPerUnit` (trống được), `hazardous` | Không có hệ số CO2e (5.7). `hazardous` đặt được nhưng API và giao diện không cho gỡ (14.1) |
| `waste_points` (`WastePoint`) | Điểm nhận: `kind` (`WAREHOUSE`, `PARTNER`), tên, địa chỉ (số nhà, đường), mã và tên tỉnh, mã và tên phường/xã, toạ độ lat/lng (admin nhập tay), điện thoại, giờ mở theo thứ trong tuần (JSON), `status` (`ACTIVE`, `PAUSED`, `PENDING`), `monthlyQuotaPoints` (bắt buộc với `PARTNER`, trống với `WAREHOUSE`), `perkText` (đã duyệt) và `perkPendingText` (chờ duyệt), `giftHandoverEnabled`, ghi chú, thứ tự, `activatedAt`, `lastConfirmedAt` | Địa chỉ nhập riêng cho điểm nhận. Không dùng lại cột `warehouse*` của gian hàng: đó là địa chỉ gửi và nhận hàng hoàn, đang công khai ở trang gian hàng và có thể là nhà riêng. Địa chỉ theo địa giới hai cấp (tỉnh và phường/xã, mã `84_VN...` của Pancake); không có quận. Chỉ một dòng `WAREHOUSE` trong cả bảng |
| `waste_point_items` | Liên kết điểm với món điểm đó nhận (khoá chính gồm cả hai cột) | `WAREHOUSE` nhận mọi món đang `ACTIVE`, không cần dòng liên kết |
| `waste_point_staff` (`WastePointStaff`) | Người được xác nhận tại một điểm: `pointId`, `userId`, `role` (`OWNER`, `STAFF`), `isActive` | Duy nhất theo `(pointId, userId)`. Tối đa 5 người mỗi điểm. Đợt 1 chỉ admin thêm bớt (mục 18.2, câu 7) |
| `waste_point_usage` (`WastePointUsage`) | Bộ đếm hạn mức: `pointId`, `monthKey` (tháng lịch giờ Việt Nam, `YYYY-MM`), `pointsUsed`, `confirmations` | Khoá chính `(pointId, monthKey)`. Tăng bằng một câu lệnh có điều kiện, xem 11.4 |
| `waste_requests` (`WasteRequest`) | Một yêu cầu: `code` duy nhất (`TR-` kèm 5 ký tự), `userId`, `method` (`DROP_OFF`, `MAIL_IN`, `PICKUP`), `status`, `pointId`, `orderId` (chỉ `PICKUP`, duy nhất), `carrier`, `trackingCode`, `trackingNorm` (duy nhất), `estimatedPoints`, `estimatedDrops`, `capDayKey`, `capMonthKey`, `expiresAt`, `receivedAt`, `completedAt`, `confirmedByUserId`, `pointsAwarded`, `dropsAwarded`, `receivedWeightGrams` (trống được), `carrierCostVnd` (trống được), `rejectionReason`, các trường thu hồi (`reversedAt`, `reversedByUserId`, `reversalReason`, `reversalShortfallPoints`), `idempotencyKey`, `consentAt`, `createdAt`, `updatedAt` | Duy nhất `(userId, idempotencyKey)`. Không lưu tên, số điện thoại hay địa chỉ của khách (14.4). `capDayKey` và `capMonthKey` là ngày và tháng giờ Việt Nam lúc tạo; trần ngày, trần tháng và trần điểm tính theo hai khoá này. `expiresAt` có ba nghĩa tuỳ trạng thái, xem 7.4 và 12.3 |
| `waste_request_lines` (`WasteRequestLine`) | Một dòng mỗi món trong yêu cầu: `requestId`, `itemId`, ảnh chụp lại (`itemCode`, `itemName`, `unitLabel`, `unitsPerPoint`, `pointsPerGroup`, `dropsPerUnit`, `gramsPerUnit`), `declaredQty`, `receivedQty` (trống tới khi đếm), `shortfallReason`, `pointsAwarded` | Duy nhất `(requestId, itemId)`. `shortfallReason`: `WET`, `DIRTY`, `FOREIGN_OBJECT`, `WRONG_TYPE`, `DAMAGED`, `NOT_ACCEPTED`, `OTHER` |
| `waste_events` (`WasteEvent`) | Nhật ký chỉ thêm: thời điểm, `kind`, `requestId`, `pointId`, `giftRedemptionId`, `actorUserId`, `actorRole` (`CUSTOMER`, `POINT_STAFF`, `STAFF`, `ADMIN`, `SYSTEM`), `meta` (JSON) | Không có khoá ngoại, để xoá hay gộp tài khoản không làm mất nhật ký. Không có đường sửa hay xoá trong ứng dụng. `meta` của lần xác nhận ghi máy gửi lệnh: địa chỉ IP bỏ octet cuối và 200 ký tự đầu của user agent; không ghi số điện thoại |
| `waste_unmatched_parcels` | Hàng về kho không rõ chủ: thời điểm nhận, người nhập, hãng, mã vận đơn, mô tả, trạng thái (`OPEN`, `RESOLVED`), yêu cầu được ghép | Màn hình ở mục 9, phần 3 |
| `waste_user_flags` | Cờ theo khách: `shipLockedAt` (khoá đường gửi kho và thu kèm đơn), `blockedAt` (khoá cả chương trình), lý do, người đặt | Do hệ thống đặt khi chạm ngưỡng nhận thiếu (5.4) hoặc do admin |
| `waste_gifts` (`WasteGift`) | Kho quà: `id` chuỗi cố định, `kind` (`VOUCHER`, `TREE`, `SEED_PACK`, `GIFT`), tên, mô tả, nhãn, `pointsCost`, `status` (`ACTIVE`, `HIDDEN`), thứ tự, ảnh, `stock` (trống = không giới hạn), hướng dẫn nhận, và với `VOUCHER`: kiểu giảm (theo enum coupon hiện có), giá trị, đơn tối thiểu, mức giảm tối đa, số ngày hiệu lực | Dòng `TREE` không có giá riêng: giá luôn lấy từ `game.tree_points_price` (8). Số ngày hiệu lực không còn cứng 30 |
| `waste_gift_redemptions` (`WasteGiftRedemption`) | Một lượt đổi quà: `userId`, `giftId`, tên và giá chụp lại, `status` (`READY`, `FULFILLED`, `CANCELLED`), `code` duy nhất (chỉ quà nhận tại chỗ, dạng `QG-` kèm 6 ký tự), `couponId`, `plantedTreeId`, `idempotencyKey`, `claimExpiresAt`, người và điểm trao, người huỷ và lý do | Duy nhất `(userId, idempotencyKey)`. Mã không được bắt đầu bằng `TUBU` hay là chuỗi toàn chữ số dài từ 8 ký tự, vì màn quét thành viên của quầy thu ngân đọc hai dạng đó thành mã thành viên |

Bảng có cột `userId` đi kèm khoá ngoại tới `users` (không xoá lan) phải được thêm vào `deleteItData` của helper race spec và vào `mergeGuestInto`. Khách đang có yêu cầu `OPEN`, `IN_TRANSIT` hoặc `RECEIVED` bị chặn xoá tài khoản bằng một "vướng mắc" mới trong `collectBlockers`; chủ một điểm nhận đang `ACTIVE` bị chặn tắt cờ đối tác và ẩn danh bằng một vướng mắc mới trong `partnerBlockers`. Cả hai nhằm tránh yêu cầu mồ côi không ai xác nhận được.

### 11.2 Công thức tính điểm và trần
- Điểm một dòng = phần nguyên của (`receivedQty` chia `unitsPerPoint`) nhân `pointsPerGroup`, tính bằng mức đã chụp lại trong dòng. Điểm một yêu cầu = tổng các dòng. Phần lẻ không cộng dồn giữa các dòng hay các yêu cầu.
- `receivedQty` không bao giờ vượt `declaredQty`. Tổng điểm một yêu cầu phải nằm từ 0 đến 2000.
- Trần của khách tính trên mọi yêu cầu thuộc nhóm trạng thái `OPEN`, `IN_TRANSIT`, `RECEIVED`, `COMPLETED`, `REVERSED` (huỷ, từ chối và hết hạn trả lại phần trần). Mỗi dòng đếm `COALESCE(receivedQty, declaredQty)`: yêu cầu đã đếm tính theo số thực nhận, yêu cầu chưa đếm tính theo số khai. Trần điểm tháng đếm `COALESCE(pointsAwarded, estimatedPoints)` theo `capMonthKey`. Yêu cầu `REVERSED` vẫn đếm, để gian lận bị thu hồi không mở lại trần.
- Tạo yêu cầu chạy trong một giao dịch có khoá cố vấn theo khách (`pg_advisory_xact_lock` trên băm của `waste.create:<userId>`): khoá, đếm các trần và số yêu cầu đang mở, rồi ghi. Hai yêu cầu tạo song song của một khách không thể cùng vượt trần.

### 11.3 Ràng buộc ở tầng cơ sở dữ liệu
Viết tay trong migration (bọc khối `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` để chạy lại được), vì lược đồ Prisma không khai báo được:
- `waste_items`: `CHECK (NOT (hazardous AND status = 'ACTIVE'))`, `unitsPerPoint >= 1`, `pointsPerGroup >= 1`, `dropsPerUnit >= 0`, trần (nếu có) `>= 1`.
- `waste_points`: `CHECK (kind = 'WAREHOUSE' OR "monthlyQuotaPoints" IS NOT NULL)` và chỉ mục duy nhất từng phần `waste_points_one_warehouse_key` trên `(kind) WHERE kind = 'WAREHOUSE'`.
- `waste_request_lines`: `CHECK ("receivedQty" IS NULL OR ("receivedQty" >= 0 AND "receivedQty" <= "declaredQty"))`, `declaredQty >= 1`.
- `waste_point_usage`: `CHECK ("pointsUsed" >= 0)`.
- `waste_gifts`: `CHECK (stock IS NULL OR stock >= 0)`; với `VOUCHER` các trường coupon không trống; với mọi loại trừ `TREE`, `pointsCost >= 1`.
- `points_transactions`: hai chỉ mục duy nhất từng phần ở 10.1 và 10.3. Chỉ mục kiểu này tự được kiểm tra sau `migrate deploy`; không thêm vào danh sách `KNOWN_PARTIAL_UNIQUE_INDEXES`.

### 11.4 Bộ đếm hạn mức của điểm nhận
Hạn mức tăng bằng một câu lệnh duy nhất, không đọc rồi mới ghi. Dạng gợi ý:

```sql
INSERT INTO waste_point_usage ("pointId", "monthKey", "pointsUsed", confirmations)
VALUES ($1, $2, $3, 1)
ON CONFLICT ("pointId", "monthKey") DO UPDATE
  SET "pointsUsed" = waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed",
      confirmations = waste_point_usage.confirmations + 1
  WHERE waste_point_usage."pointsUsed" + EXCLUDED."pointsUsed" <= $4
RETURNING "pointsUsed";
```

Không có dòng nào trả về nghĩa là vượt hạn mức: giao dịch xác nhận dừng và trả lỗi 409 với số điểm còn lại. Trước câu lệnh đó phải kiểm riêng `$3 <= $4`, vì nhánh `INSERT` không có điều kiện `WHERE`. Điểm `WAREHOUSE` không đi qua bộ đếm này. Kiểm hạn mức và cộng điểm nằm trong cùng giao dịch: nếu `grant` thất bại thì bộ đếm cũng quay lại.

Việc kiểm khi khách chọn điểm (4.4) chỉ là gợi ý: hạn mức không được giữ chỗ khi tạo yêu cầu. Một khách có thể mang hàng tới lúc hạn mức vừa hết giữa chừng; khi đó đại lý thấy lỗi rõ ràng, khách thấy lời nhắn đổi điểm khác, và admin có thể nâng hạn mức tức thì. Đây là giới hạn đã biết của đợt 1.

### 11.5 Cấu hình `waste.*`
Mỗi khoá số cần luật biên trong `SystemConfigService.RANGES` (khoá JSON dùng `JSON_RULES`, khoá boolean dùng `assertBoolean` trong `admin-config-rules.ts`), dòng seed dạng literal với `createOnly: true`, một dòng `INSERT ... ON CONFLICT (key) DO NOTHING` trong migration (prod không chạy seed), và nơi đọc dạng chuỗi literal trong mã chạy thật. Khoá có đuôi `_points` còn phải từ chối 1.000.000.

| Khoá | Kiểu | Mặc định | Biên | Dùng cho |
|---|---|---|---|---|
| `waste.enabled` | boolean | false | | Cờ tổng. Tắt thì mọi route của khách trả 403 "Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên." |
| `waste.lane_dropoff_enabled` | boolean | true | | Bật cách Mang tới điểm nhận |
| `waste.lane_mailin_enabled` | boolean | true | | Bật cách Gửi về kho |
| `waste.lane_pickup_enabled` | boolean | false | | Bật cách Thu kèm đơn; còn cần cờ Gomdon hiện có (mục 12) |
| `waste.mailin_min_points` | số nguyên | 15 | 1 đến 1000 | Gói gửi kho tối thiểu |
| `waste.customer_monthly_cap_points` | số nguyên | 60 | 1 đến 2000 | Trần điểm mỗi khách mỗi tháng |
| `waste.max_open_requests` | số nguyên | 3 | 1 đến 20 | Số yêu cầu mở cùng lúc |
| `waste.request_hold_days` | số nguyên | 7 | 1 đến 60 | Giữ chỗ yêu cầu và chờ mã vận đơn |
| `waste.pickup_wait_days` | số nguyên | 14 | 1 đến 90 | Chờ hàng thu kèm về kho sau khi đơn mua đã giao |
| `waste.in_transit_review_days` | số nguyên | 30 | 7 đến 180 | Yêu cầu gửi kho quá ngần này ngày vào danh sách admin xem lại |
| `waste.mailin_max_weight_kg` | số nguyên | 20 | 1 đến 50 | Giới hạn mỗi kiện (theo hãng chuyển phát) |
| `waste.mailin_max_edge_cm` | số nguyên | 50 | 10 đến 200 | Giới hạn cạnh dài mỗi kiện |
| `waste.shortfall_lock_pct` | số nguyên | 50 | 1 đến 100 | Nhận thiếu quá ngần này phần trăm số khai thì tính là một lần thiếu |
| `waste.shortfall_lock_streak` | số nguyên | 3 | 2 đến 10 | Số lần thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn |
| `waste.staff_daily_cap_points` | số nguyên | 1000 | 1 đến 20000 | Trần điểm mỗi nhân viên (kho hoặc điểm nhận) được xác nhận mỗi ngày |
| `waste.gift_claim_days` | số nguyên | 60 | 7 đến 365 | Hạn nhận quà bằng mã; quá hạn thì vào danh sách admin xem lại |
| `waste.point_inactive_days` | số nguyên | 60 | 7 đến 365 | Điểm nhận không có xác nhận nào quá ngần này ngày bị ẩn khỏi danh sách khách |
| `waste.mailin_fee_table` | JSON | một vùng mặc định 30.000 đến 85.000đ | `JSON_RULES` | Bảng ước tính phí ship: danh sách vùng, mỗi vùng có tên, danh sách mã tỉnh (lấy từ `GET /geo/provinces`), phí thấp, phí cao; cộng một vùng mặc định cho tỉnh chưa xếp. Chỉ để ước tính, không gọi API hãng |
| `waste.alert_thresholds` | JSON | xem dưới | `JSON_RULES` | Ngưỡng cảnh báo bất thường (5.5) |
| `waste.rules_text` | chuỗi | trống | tối đa 8000 ký tự | Thể lệ công khai (14.2); trống thì mục "Thể lệ" hiện ghi chú sắp có |

Giá trị khởi tạo của `waste.alert_thresholds`: `quotaPacePct` 60 và `quotaPaceDays` 10 (đại lý dùng quá 60% hạn mức trong 10 ngày đầu tháng), `fullMatchPct` 95 và `fullMatchMinSample` 10 (từ 10 lượt trở lên mà từ 95% nhận đủ đúng số khai), `repeatCustomerCount` 3 và `repeatCustomerDays` 7 (một khách từ 3 lần ở một điểm trong 7 ngày), `avgUnitsFactor` 2 (số lượng trung bình mỗi lượt gấp đôi trung bình các điểm khác). Tất cả chỉ để gợi ý cho admin xem, không tự khoá ai.

Tên khoá không được chứa các từ làm máy che giá trị khi admin đọc cấu hình (`pass`, `key`, `token`, `secret`...). Các khoá `waste.*` trên không vướng.

Khoá công khai cho ứng dụng: `GET /config/public` thêm một trường `waste` gồm `enabled`, `dropoff`, `mailin`, `pickup`, tính ở server (`pickup` là cờ `waste.lane_pickup_enabled` cộng với `isGomdonRecyclingEnabled`, xem mục 12). Trường `recyclingEnabled` cũ được bỏ. Phản hồi này được lưu đệm đến 5 phút, nên tắt cờ có thể mất đến 5 phút mới tới mọi máy trong khi API từ chối ngay.

### 11.6 Mẫu thông báo
Mẫu nằm ở cả `seed.ts` lẫn một câu `INSERT ... ON CONFLICT DO NOTHING` trong migration (id dạng `nt-<kebab>`), và mã được thêm vào mảng `CODES` của `notification-templates-seed.spec.ts` để khoá giống nhau giữa hai nơi. Mã chỉ gồm chữ hoa và gạch dưới (không chữ số), lời không chứa dấu nháy đơn, không chứa "xu" đứng riêng hay "TubuXu". Kênh chỉ `INAPP` (ZNS cần mẫu được Zalo duyệt, là việc đợt sau). Mã không liệt kê ở danh mục khuyến mại nên mặc định luôn gửi.

| Mã | Gửi khi | Cho ai |
|---|---|---|
| `WASTE_PARCEL_RECEIVED` | Kho nhận kiện (`RECEIVED`) | Khách |
| `WASTE_POINTS_CREDITED` | Đã đếm và cộng điểm (`COMPLETED`), kể cả khi 0 điểm | Khách |
| `WASTE_REQUEST_REJECTED` | Bị từ chối, kèm lý do | Khách |
| `WASTE_REQUEST_EXPIRED` | Quá hạn (`EXPIRED`) | Khách |
| `WASTE_PICKUP_STARTED` | Đơn mua đã giao, yêu cầu thu kèm chuyển `IN_TRANSIT` | Khách |
| `WASTE_PICKUP_CANCELLED` | Đơn mua bị huỷ hoặc trả, yêu cầu thu kèm đóng | Khách |
| `WASTE_POINTS_REVERSED` | Admin thu hồi điểm, kèm lý do và số điểm thực thu | Khách |
| `WASTE_SHIP_LOCKED` | Đường gửi kho và thu kèm đơn bị khoá do nhận thiếu lặp lại | Khách |
| `WASTE_GIFT_CANCELLED` | Admin huỷ lượt đổi quà và hoàn điểm | Khách |
| `WASTE_PERK_REVIEWED` | Admin duyệt hoặc từ chối nội dung ưu đãi riêng | Chủ điểm nhận |

Khách bấm một thông báo có mã bắt đầu bằng `WASTE` thì tới trang Đổi rác (`notifications.tsx` ánh xạ theo tiền tố, như `REFILL` đang làm). Mỗi thông báo gửi sau khi commit, kèm khoá chống gửi lặp `waste:<id>:<trạng thái>`.

### 11.7 Migration
Một migration chỉ thêm, tên thư mục có dấu thời gian lớn hơn migration mới nhất tại thời điểm viết kế hoạch (lúc viết tài liệu này là `20261018000100_n1_indexes`). Dòng đầu ghi lý do bằng tiếng Việt và ghi "Chỉ THÊM", như các migration trước. Nội dung theo thứ tự: kiểu enum, bảng, chỉ mục thường, chỉ mục duy nhất từng phần và các `CHECK` (11.3), dữ liệu khởi tạo, rồi các dòng cấu hình và mẫu thông báo.

Dữ liệu khởi tạo (đi bằng migration vì prod không chạy seed, và có thêm bản trong `seed.ts` dùng cùng id cho môi trường dev):
- 5 món theo mặc định ở 5.1 (pin là `COMING_SOON` và `hazardous`). Trọng lượng mỗi đơn vị để trống cho tới khi chủ dự án cân thử.
- Quà: 4 voucher hiện có với id cố định `reward-freeship`, `reward-discount-50k`, `reward-discount-100k`, `reward-percent-15pct` (id là hậu tố trong reason của sổ điểm và nằm trong nhiều test, không được đổi) và một dòng `TREE` có id `gift-tree`. Không seed quà vật lý, vì Tubu chưa mua; admin tạo khi có hàng.
- Không seed điểm nhận nào. Admin đăng ký kho TP.HCM và các đại lý trước khi bật `waste.enabled`; kiểm tra go-live chặn bật khi chưa có kho (mục 13).

## 12. Thu kèm đơn mua (Gomdon)

### 12.1 Hiện trạng, đọc từ mã
- Công tắc "gửi lại vật liệu tái chế" ở bước thanh toán (mini app và web khách) gắn vào đơn mua: khách tick và gõ một ghi chú tự do, đơn lưu `hasRecyclingPickup` và `recyclingNote`. Khi đơn có cờ này, hệ thống đẩy đơn sang Gomdon (hàng đợi `gomdon-push`) thay vì Pancake. Vận đơn Gomdon là loại 3 ("đổi hàng", chạy bằng BestExpress) và chính là vận đơn giao đơn mua: nguồn là kho Tubu, đích là khách. Theo tài liệu, bưu tá lấy hàng ở kho, giao, rồi nhận lại vật liệu trong cùng chuyến.
- Gomdon gửi về webhook đúng năm trường (`order_id`, `order_code`, `order_customer_id`, `status`, `created_time`). Trạng thái 3, 4, 5 nghĩa là bưu tá đã lấy **đơn mua** ở kho và đang giao; 7 nghĩa là giao thành công **đơn mua**. Không có sự kiện nào cho "đã nhận vật liệu", "khách không đưa rác", số lượng hay cân thực. Chính giao diện web hiện tại thừa nhận điều đó ("nếu bưu tá chưa nhận vật liệu thì nhắn Zalo OA").
- Đơn có thể được chốt `DELIVERED` bằng webhook 7 hoặc do admin bấm tay mà không ai kiểm vật liệu. Vì vậy điểm đổi rác không thể gắn vào trạng thái giao.
- Phí Gomdon không được lưu hay đối soát, và không có kiểm tra vùng phủ. Vận đơn loại 3 chưa từng chạy với Gomdon thật (tài liệu `docs/integrations/gomdon.md` ghi chưa có tài khoản): chuỗi trạng thái chiều mang vật liệu về, địa chỉ hoàn, phí, và việc BestExpress có nhận thùng carton và nilon theo thể tích hay không đều chưa được xác nhận.
- Văn bản hiện có trong giao diện mời khách gửi "pin, quần áo cũ", trái với quyết định không nhận pin.

### 12.2 Thiết kế: giữ ống dẫn Gomdon, thay khoá cho việc cộng điểm
Giữ nguyên mọi thứ làm việc với Gomdon: lớp gọi API `GomdonClient`, hàng đợi `gomdon-push` và `gomdon-events`, webhook và ánh xạ trạng thái sang đơn, cổng `WAIT_GOMDON` bên Pancake, cột `Order.hasRecyclingPickup` và các cột `gomdon*`, báo động cho kho, `RecyclingPanel` và `GomdonConfigCard` của admin, khoá `shipping.gomdon.recycling_enabled` làm công tắc kỹ thuật (kèm kiểm tra thông tin đăng nhập). Lý do: việc gỡ đó đụng 71 tệp nguồn và 115 tệp kiểm thử, không mang lại gì cho khách, và giữ ống đã có là cách ít rủi ro nhất cho đường chưa từng chạy thật. Thứ thay đổi là **cái gì quyết định có thu gom và khi nào cộng điểm**:

1. **Yêu cầu có cấu trúc thay ghi chú tự do.** Khách tạo yêu cầu cách `PICKUP` ở màn Chọn món và Chọn cách giao như mọi cách khác (4.3). Yêu cầu có món, số lượng khai, mã `TR-...`, trạng thái `OPEN`, chưa gắn đơn nào.
2. **Gắn vào đơn ở bước thanh toán.** Nếu khách có yêu cầu `PICKUP` còn `OPEN` chưa gắn đơn và cờ `pickup` của `/config/public` đang bật, bước thanh toán hiện công tắc "Thu kèm rác" kèm thẻ tóm tắt yêu cầu (món, số điểm ước tính). Chưa có yêu cầu nào thì dòng đó dẫn tới màn Chọn món. Khi khách đặt đơn với công tắc bật, `PlaceOrderDto` mang `wasteRequestId` (thay cho hai trường cũ `hasRecyclingPickup` và `recyclingNote`; DTO dùng `forbidNonWhitelisted` nên mini app và web phải đổi cùng đợt). Trong cùng giao dịch tạo đơn, server kiểm yêu cầu thuộc khách, cách `PICKUP`, `OPEN`, chưa gắn, cờ `pickup` còn bật và đơn có kiện do Tubu giao; rồi đặt `waste_requests.orderId`, `Order.hasRecyclingPickup = true` và `Order.recyclingNote` do **server tự dựng** từ các dòng của yêu cầu (có mã `TR-...` để bưu tá và kho đối chiếu; không còn chữ do khách gõ).
3. **Yêu cầu theo đời của đơn, không theo Gomdon.** Hai sự kiện của đơn mua tác động lên yêu cầu, chạy sau khi đơn đã commit và ngoài chuỗi `runDeliveredEffects` (không được làm hỏng `deliveredEffectsAt` hay chặn điểm đơn, hoa hồng CTV, thưởng giới thiệu của đơn mua): (a) đơn bị huỷ hoặc trả trước khi giao: yêu cầu thành `CANCELLED` (hệ thống), khách nhận `WASTE_PICKUP_CANCELLED`; (b) đơn thành `DELIVERED`: yêu cầu từ `OPEN` thành `IN_TRANSIT`, `expiresAt` đặt bằng bây giờ cộng `waste.pickup_wait_days`, khách nhận `WASTE_PICKUP_STARTED`. Cả hai dùng câu lệnh `updateMany` có điều kiện trạng thái (chạy lại không làm gì), và một cron quét bù mỗi vài phút (theo mẫu `DeliveredEffectsResyncCron`) xử lý những yêu cầu còn `OPEN` trong khi đơn của chúng đã `DELIVERED`, `CANCELLED` hoặc `RETURNED`.
4. **Điểm chỉ cộng khi kho nhận và đếm.** Hàng thu về kho thì nhân viên kho tra theo mã yêu cầu, mã đơn hoặc mã vận đơn Gomdon, rồi xác nhận như đường gửi kho (`RECEIVED`, rồi `COMPLETED` với số thực nhận kẹp về số khai). Nếu quá `waste.pickup_wait_days` kể từ lúc đơn giao mà kho chưa nhận gì, cron chuyển yêu cầu thành `EXPIRED` (khách ghi là không đưa hoặc hàng không về), khách nhận `WASTE_REQUEST_EXPIRED`. Không có điểm cộng tự động từ bất kỳ sự kiện Gomdon nào.
5. **Phí.** Khách không trả thêm, giống hiện nay. Gomdon không báo phí qua webhook, nên đợt 1 admin (hoặc kho) nhập tay `carrierCostVnd` trên yêu cầu khi có hoá đơn Gomdon để báo cáo tháng (17.2) cộng được. Cam kết "Tubu chịu phí ở mọi tỉnh" chưa có số liệu hay kiểm tra vùng phủ phía sau; đó là lý do cờ `waste.lane_pickup_enabled` mặc định tắt (12.4).

Quy tắc kèm theo:
- Mỗi yêu cầu gắn nhiều nhất một đơn và mỗi đơn nhiều nhất một yêu cầu (`orderId` duy nhất). Khi đơn bị tách thành nhiều kiện, yêu cầu gắn vào đơn có kiện do Tubu giao (đúng như cờ cũ chỉ ghi cho kiện Tubu).
- Quy tắc nhận thiếu lặp lại (5.4) áp cho cả hai đường kho nhận, `MAIL_IN` và `PICKUP`, vì Tubu chịu phí ở đường thu kèm đơn.
- `isSameRequest` của luồng đặt đơn (chống đặt trùng) phải tính `wasteRequestId`. Đổi hay thêm phụ thuộc vào hàm dựng của `CheckoutService` thì spec dựng đối tượng theo vị trí (`checkout.service.spec.ts`, đối số thứ tám là Gomdon) phải sửa theo.
- Cột `Order` nào mới (nếu builder thêm) và không bắt đầu bằng `pancake` hay `gomdon` sẽ mặc định hiện cho người mua; cột nội bộ phải thêm vào `BUYER_HIDDEN_ORDER_FIELDS`. Thiết kế này không cần cột mới trên `Order`: liên kết nằm ở `waste_requests.orderId`.
- Màn chi tiết đơn của mini app thay khối trạng thái thu gom và mã vận đơn cũ bằng một dòng "Yêu cầu thu rác TR-..." dẫn tới trang theo dõi (`GET /waste/requests/by-order/:orderId`). Mã vận đơn Gomdon của đơn vẫn hiện như mọi đơn.
- Bản sao logic trạng thái Gomdon phía khách (`apps/web/src/lib/recycling.ts`, `apps/miniapp/src/utils/format.ts` và `order-status.ts`, `OrderDTO`) rải ở nhiều nơi và sắp thành dư thừa vì trang theo dõi của yêu cầu là nguồn duy nhất. Kế hoạch phải liệt kê và gỡ các bản sao này cùng lúc, cùng với khối công tắc ở thanh toán web (đợt 1 chỉ làm trong mini app: khách web không còn công tắc, kèm cập nhật spec đối chiếu `checkout-parity`).

### 12.3 `expiresAt` của yêu cầu
Một cột, ba nghĩa, cron chạy mỗi ngày theo giờ Việt Nam và tìm `expiresAt < now`:
- Cách `DROP_OFF` hoặc `MAIL_IN` đang `OPEN`, hoặc `PICKUP` đang `OPEN` mà chưa gắn đơn: hạn giữ chỗ, bằng lúc tạo cộng `waste.request_hold_days`. Quá hạn thì `EXPIRED`.
- `MAIL_IN` đang `IN_TRANSIT`: để trống. Không tự đóng; sau `waste.in_transit_review_days` thì vào danh sách admin xem lại (5.4).
- `PICKUP` đã gắn đơn: để trống khi `OPEN` (đời của yêu cầu theo đơn). Khi `IN_TRANSIT` (đơn đã giao): hạn chờ hàng về kho, bằng lúc đơn giao cộng `waste.pickup_wait_days`. Quá hạn thì `EXPIRED`.
Cron dùng khoá cố vấn và chạy trên một bản chạy duy nhất theo cơ chế cron hiện có, có `timeZone` (theo `CRON_TZ`).

### 12.4 Điều kiện bật cách này
`GET /config/public.waste.pickup` chỉ đúng khi cả ba điều kiện cùng thoả: `waste.enabled`, `waste.lane_pickup_enabled`, và `isGomdonRecyclingEnabled` (cờ `shipping.gomdon.recycling_enabled`, thông tin đăng nhập Gomdon đủ, sức khoẻ kết nối chưa bị từ chối). Mặc định đường này tắt. Chỉ bật khi đã có đủ điều kiện ở 14.8: Gomdon trả lời bằng văn bản về hàng không nhận, lấy hàng thể tích lớn, địa chỉ hoàn và phí, và một đơn thử loại 3 (Phần 3 của sổ tay thử đơn) đã chạy thật với đủ chuỗi trạng thái. Các câu hỏi chỉ chủ dự án trả lời được nằm ở 18.1.

## 13. Gỡ Refill, nút Gomdon cũ và kho quà cứng trong mã

### 13.1 Nguyên tắc
- Chủ dự án muốn một chức năng, không hai cái chạy song song. Chương trình mới được xây sau cờ `waste.enabled` tắt; Refill và các mảnh cũ bị gỡ **trong cùng đợt phát hành**, nên không có lúc nào khách thấy cả hai.
- Chưa có khách thật và ứng dụng chưa triển khai, nên không có dữ liệu khách cần di chuyển. Điểm nhận vỏ có thể còn trên máy thử (kể cả dòng `rpl-seed-default` do migration r8 sinh và hai điểm thử theo sổ tay) không được sao chép sang bảng mới: admin nhập lại tay các điểm thật, vì bảng cũ không có toạ độ, mã địa giới hay hạn mức (đây là quyết định của tôi, mục 18.2, câu 10).
- **Không DROP bảng, kiểu hay cột nào.** Repo chưa từng có migration DROP; tiền lệ gỡ tính năng (BetaTester, BetaFeedback) là giữ bảng, gắn `/// @deprecated ... KHÔNG DROP` và ghi vào bảng `DEPRECATED` của `schema-deprecated.spec.ts` kèm cách chứng minh không còn mã nào đọc. Năm migration của Refill giữ nguyên (bất biến, là dữ liệu cho nhiều spec; một trong số đó thêm cột `missions.goal` đang được dùng). Giữ bảng cũng giúp bản triển khai cũ không lỗi khi quay lại.

### 13.2 Việc phải làm

| Nơi | Việc | Gate sẽ đỏ nếu bỏ sót |
|---|---|---|
| `apps/api/src/modules/refill/` | Xoá cả module (dịch vụ, controller, dịch vụ điểm nhận, controller admin điểm nhận, DTO, 3 file spec) sau khi chuyển các ca test đáng giữ sang module mới: duyệt song song chỉ thành công một lần, idempotency, trần, kẹp số thực nhận, cấm tự duyệt. Bỏ khỏi `app.module.ts`. Thêm các route đã gỡ vào `REMOVED` của `endpoint-inventory.spec.ts` | `endpoint-inventory`, `patch-null-contract.spec.ts` (ghim cứng `PATCH /admin/refill-locations/:id` ở dòng 164; thay bằng route PATCH mới của điểm nhận) |
| `schema.prisma` | Giữ `BottleReturn`, `RefillPickupLocation`, `RefillStatus` và quan hệ `User.bottleReturns`; thêm `/// @deprecated` và dòng `DEPRECATED` tương ứng. Giữ `Mission.goal` | `schema-deprecated.spec.ts`, kiểm tra drift lược đồ trong `verify-full.sh` |
| Cấu hình | Đưa 5 khoá `refill.*` vào `DEAD_CONFIG_KEYS` (dòng DB còn nguyên); bỏ khỏi `seed.ts`, khỏi `RANGES` và `JSON_RULES` của `system-config.service.ts` cùng các ca test của chúng; bỏ `PICKUP_PHONE_PATTERN`; gỡ mọi chỗ đọc chúng cùng lúc (dịch vụ Refill, dịch vụ điểm nhận, chuỗi `refill.pickup_address` trong `go-live/db-checks.ts`) | `dead-config-keys.spec.ts` đòi khoá chết không còn mã đọc và seed không gieo khoá chết |
| Thông báo | Bỏ `REFILL_APPROVED`, `REFILL_REJECTED` khỏi `seed.ts` và khỏi mảng `CODES` của `notification-templates-seed.spec.ts` (dòng mẫu trong DB còn nguyên). Thêm 10 mã `WASTE_*` (11.6) | `notification-templates-seed.spec.ts` |
| Hộp việc vận hành | Thay khoá `refillPending` bằng hai khoá mới: `wasteToCount` (đối tượng `STAFF`: yêu cầu kho cần đếm, hàng không rõ chủ) và `wasteAdminReview` (đối tượng `ADMIN`: điểm nhận chờ duyệt, ưu đãi riêng chờ duyệt, yêu cầu gửi kho quá hạn xem lại, quà quá hạn nhận). Khoá nằm ở bốn nơi phải sửa cùng nhau (`InboxKey` ở API, `defs()`, `InboxKey` ở `admin-client.ts`, `INBOX_LABELS` và bản đồ mở tab ở web) | `ops-inbox.service.spec.ts`, `ops-health.race-spec.ts` (so danh sách khoá chính xác theo vai; race spec không chạy trong CI nên dễ bị bỏ sót) |
| Web admin | Thay tab `refill` ("Đổi vỏ chai", nhóm "Khách hàng") bằng tab `waste` ("Đổi rác") cùng nhóm; thay `STAFF_TABS.BASE = ['refill']` bằng `['waste']`; xoá `refill-tab.tsx`, `refill-locations-panel.tsx` và spec; thay các hàm refill trong `admin-client.ts`; sửa câu "nhân viên chỉ dùng quầy thu ngân, đổi vỏ chai và chấm công" ở `user-detail-drawer.tsx`; sửa hai khoá `refill.*` trong fixture cấu hình. Thêm mọi tệp admin mới vào danh sách `MIGRATED` của `ds-palette-pc11.spec.ts` **trước khi viết** | `page.spec.tsx` (đúng 9 nhóm menu, nút "Đổi vỏ chai" mở `?tab=refill`, danh sách tab theo thứ tự tiêu đề, hành vi nhân viên không nhóm), `ops-tabs.spec.tsx`, `ds-palette-pc11.spec.ts` |
| Mini app, khách | Xoá `pages/refill.tsx`, `services/refill-api.ts`, `refill-location-picker.tsx` (tổng quát hoá thành bộ chọn điểm nhận, 16) và các spec; `/refill` thành `Navigate replace` tới `/recycle` (tiền lệ `/subscriptions`) để thông báo cũ không dẫn tới trang chết; trỏ lại bốn lối vào (thẻ ở Vườn Xanh, mục menu ở Cá nhân, hàng ở trang Điểm Xanh, ánh xạ thông báo); thay khối chuỗi `refill` ở `i18n/vi.ts`; bỏ `src/pages/refill.tsx` khỏi `FILES` của `ds-c076-pc10c1.spec.ts` | `ds-c076-pc10c1.spec.ts` (đọc tệp, `ENOENT` nếu xoá), `session-unavailable.spec.tsx`, `game-behavior.spec.tsx`, `loyalty-behavior.spec.tsx`, `profile.spec.ts` |
| Mini app, nhân viên | Xoá tab "Duyệt đổi vỏ" (`RefillAdminSection`, xuất CSV) khỏi `pages/admin.tsx` và spec (danh sách tab ghim ở `admin.spec.tsx:243`) | `admin.spec.tsx` |
| Công tắc Gomdon ở thanh toán | Theo mục 12: bỏ `hasRecyclingPickup` và `recyclingNote` khỏi `PlaceOrderDto`, thêm `wasteRequestId`; thay khối công tắc và ghi chú tự do ở thanh toán mini app và web; bỏ `recyclingCheckoutFields`, `recyclingMaxKg` và bản sao logic trạng thái Gomdon phía khách; bỏ trường `recyclingEnabled` khỏi `/config/public` và `PublicConfig`; sửa văn bản mời gửi "pin, quần áo cũ". Giữ nguyên ống dẫn Gomdon và các cột `Order` | `checkout-parity.spec.tsx`, `checkout.service.spec.ts`, e2e `recycling-pickup.miniapp.spec.ts` và `checkout.miniapp.spec.ts`, `buyer-order-fields.spec.ts` |
| Kho quà cứng | Thay `DEFAULT_REWARD_CATALOG` và kiểu `RewardCatalogItem` bằng bảng `waste_gifts` (mục 8 và 11). `getRewardCatalog` và `redeemReward` đọc DB ngoài giao dịch, tra id không có thì `NotFound` trước khi đọc cấu hình hay mở giao dịch (spec đang khoá hành vi này), rẽ nhánh theo loại quà, thêm tồn kho và khoá idempotency. Admin đọc số lượt đổi từ `waste_gift_redemptions` thay vì suy từ sổ. Bỏ danh sách quà chỉ xem và ghi chú "cố định trong mã nguồn" ở `engagement-tab.tsx` | `loyalty-features.spec.ts`, `loyalty-locked-window.spec.ts`, `admin-engagement.controller.spec.ts`, năm race spec import hằng này (`loyalty`, `pd3-points-lots`, `pd3-checkout-points`, `pf6-locked-window-outside-tx`, `admin-engagement-price-history`) |
| Mini app, kho quà | Trang Điểm Xanh (`loyalty.tsx`, tệp ghim ở PC-10a) bỏ phần liệt kê và đổi quà, thay bằng một hàng dẫn tới trang Kho quà mới; sửa kiểu `RewardItem`, `RedeemRewardResult` ở `account-api.ts` (không còn giả định quà luôn là coupon và hạn 30 ngày) | `loyalty-behavior.spec.tsx`, `loyalty-layout.spec.tsx`, e2e `loyalty.miniapp.spec.ts` |
| Go-live | Thay `refillCheck` (`db.refill_location`) bằng `db.waste_point`: lỗi khi `waste.enabled` bật mà chưa có điểm `WAREHOUSE` đang `ACTIVE`; cảnh báo khi `waste.lane_pickup_enabled` bật nhưng cờ Gomdon tắt. Sửa `DbSnapshot.refill`, `collect.ts` (đếm `waste_points` thay `refill_pickup_locations`), `go-live.fixtures.ts`, `CONFIG_KEYS_OF_INTEREST`, `REQUIRED_MIGRATIONS`, và thêm migration mới vào `IMAGE_COMPATIBLE_MIGRATIONS` (chỉ thêm nên quay lại ảnh cũ được) | `db-checks.spec.ts`, `collect.spec.ts`, `run.spec.ts`; để nguyên thì `go-live:check` đỏ vĩnh viễn |
| Tài liệu vận hành | Cập nhật `docs/launch/deploy-rollback-runbook.md` (dòng đếm `bottle_returns` và `refill_pickup_locations`, hướng xử lý FAIL `db.refill_location`, bảng 7.0), `docs/launch/pilot-order-playbook.md` (Phần 7 "Đổi vỏ chai nhiều điểm nhận", các truy vấn SQL, dòng "hai điểm nhận vỏ thử"), `docs/integrations/gomdon.md`, `docs/GO-LIVE-KEYS.md`, `README.md` | Không có gate; chỉ dẫn sai là rủi ro |
| Công cụ kiểm tra giao diện | `scripts/audit/seed-audit-personas.ts` (xoá và tạo dòng `bottleReturn`, khuyến mại `fuwa-refill`, huy hiệu `REFILL_HERO`, mẫu route `/refill`), `scripts/uiux/routes.mjs`, `scripts/uiux/scorecard.mjs`; sinh lại `scripts/audit/routes.json` và `scripts/uiux/generated/miniapp-endpoints.json` bằng lệnh có sẵn thay vì sửa tay; thêm các route mới vào `routes.mjs` | Không có gate |
| e2e | Thay `refill.miniapp.spec.ts` bằng spec mới của luồng đổi rác (nhập kiểu từ dịch vụ mới); sửa `offline-states.miniapp.spec.ts` (mục "Đổi vỏ"); mọi `GET` dùng chung mới phải được khai trong `mockSession` | Playwright fail với `E2E_UNMOCKED` |

### 13.3 Thứ tự làm đề xuất
1. Migration và module `waste-exchange` (backend) sau cờ tắt, kèm test; chưa đụng Refill.
2. Trang miniapp và tab admin mới; trỏ lối vào cũ sang trang mới.
3. Gỡ Refill và công tắc Gomdon cũ cùng go-live, ops-inbox, spec, tài liệu (bảng trên), trong cùng loạt thay đổi với bước 2, trước khi phát hành.
4. Bộ kiểm đầy đủ `verify-full.sh` (gồm race suite, không nằm trong CI) xanh trước khi gộp. Reviewer Opus xem điểm, quà, thông báo.

## 14. Pháp lý, an toàn và việc phải làm với bên ngoài

Phần này không phải tư vấn pháp lý. Nguồn tôi tìm được chủ yếu là báo chí và blog luật, có chỗ mâu thuẫn nhau; số điều, mức phạt và hiệu lực cần đối chiếu văn bản gốc trước khi dựa vào. Phần này chỉ nói hệ quả của chúng lên thiết kế, và liệt kê những việc chỉ chủ dự án làm được.

### 14.1 Pin: không nhận ở đợt 1
Pin đã qua sử dụng là chất thải nguy hại (theo Luật Bảo vệ môi trường 2020 và Nghị định 45/2022, qua nguồn thứ cấp). Bên gom và lưu giữ chất thải nguy hại phải có điều kiện (đăng ký chủ nguồn thải hoặc giấy phép môi trường, nơi lưu giữ đạt chuẩn, giao cho đơn vị có phép). Tôi không tìm thấy nguồn nào cho phép một cửa hàng thương mại nhận pin từ hộ gia đình mà không cần các điều kiện đó. Hãng chuyển phát nhiều khả năng từ chối pin đã qua sử dụng, và pin lithium có nguy cơ cháy khi gom và vận chuyển. Vì vậy:
- Món pin tồn tại trong danh mục với `hazardous = true` và trạng thái `COMING_SOON`. API và ràng buộc DB không cho đặt một món `hazardous` sang `ACTIVE`.
- Cờ `hazardous` chỉ đặt được, không gỡ được qua giao diện admin. Gỡ cần migration có người duyệt.
- Thẻ pin ở màn Chọn món hiện mờ, ghi "Sắp nhận", kèm một dòng hướng dẫn do admin soạn (ví dụ chỉ khách tới điểm thu pin của địa phương). Spec không nêu tên chương trình cụ thể để khỏi sai khi địa phương đổi.
- Đường gửi về kho bắt khách tích đồng ý "không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn" trước khi tạo yêu cầu. Nơi nhận thấy pin lẫn trong hàng thì từ chối dòng đó hoặc cả yêu cầu với lý do "có vật không nhận", ghi nhật ký.
- Điều khoản với đại lý ghi rõ: không nhận pin và chất thải nguy hại.
- Chỉ mở lại pin khi có hợp đồng bằng văn bản với đơn vị có giấy phép xử lý chất thải nguy hại và có văn bản trả lời của Sở Nông nghiệp và Môi trường TP.HCM.

### 14.2 Điểm và quà: ưu đãi cho khách hàng, không phải mua phế liệu
Chủ dự án đã chốt điểm chỉ để trừ vào đơn Tubu hoặc đổi quà Tubu. Thiết kế giữ đúng điều đó để chương trình rơi vào nhóm "ưu đãi cho khách hàng thường xuyên" thay vì "thu mua phế liệu" (loại này kéo theo bảng kê thu mua, giấy tờ nhân thân người bán và thuế thu nhập cá nhân):
- Không trả tiền mặt, không rút điểm ra tiền, không chuyển điểm giữa người dùng.
- Giá trị mỗi lần đổi nhỏ và có trần theo ngày, theo tháng (5.3).
- Thể lệ công khai trong ứng dụng: thời gian, phạm vi, món nhận, mức quy đổi, trần, hạn điểm 12 tháng, điều kiện, quyền từ chối và thu hồi khi có gian lận. Nội dung thể lệ do admin soạn; builder làm một trang "Thể lệ" đọc nội dung đó.
- "Ưu đãi riêng" của đại lý là khuyến mại của chính đại lý; điều khoản đại lý ghi rõ đại lý tự chịu trách nhiệm pháp lý của phần đó.
Điều tôi chưa biết, và nguồn mâu thuẫn nhau: tặng điểm đổi lấy rác có được xem là khuyến mại theo Luật Thương mại hay không, và có phải thông báo Sở Công Thương hay không sau Nghị định 128/2024. Việc đó phải hỏi Sở Công Thương TP.HCM trước khi mở cho khách thật.

### 14.3 Thuế
Đợt 1 Tubu không trả tiền cho ai, nên không phát sinh bảng kê thu mua. Việc cần kế toán chốt trước khi mở: cách hạch toán điểm đã phát và điểm đã dùng (điểm là một khoản phải trả; hàng khuyến mại đúng luật có thể có giá tính thuế bằng 0 nhưng vẫn lập hoá đơn, qua nguồn thứ cấp chưa xác nhận hiệu lực mới nhất). Yêu cầu với hệ thống: ghi đủ dữ liệu cho kế toán (số đơn vị theo món theo tháng, số điểm phát và dùng theo tháng, số lượng theo từng đại lý). Mục 5 và 6 đã đủ. Nếu sau này Tubu trả tiền cho đại lý hoặc mua vật liệu từ cá nhân thì phải xét lại phần này.

### 14.4 Dữ liệu cá nhân
Luật Bảo vệ dữ liệu cá nhân 2025 có hiệu lực từ 1/1/2026 (nghị định hướng dẫn chưa xác nhận được). Thiết kế giữ ít dữ liệu nhất:
- Yêu cầu đổi không lưu địa chỉ: khách tự mang hoặc tự gửi, Tubu không gửi gì lại cho khách (quà nhỏ nhận bằng mã tại kho hoặc điểm). Không thu giấy tờ nhân thân. Đợt 1 không bắt ảnh.
- Bảng yêu cầu chỉ giữ mã người dùng, không sao chép tên và số điện thoại. Màn đại lý hiện tên che bớt và số điện thoại che bớt, tính ở server lúc xem; đại lý không có API trả số đầy đủ.
- Khách tích đồng ý riêng cho việc xử lý yêu cầu đổi (tách khỏi đồng ý nhận quảng cáo) ở bước Chọn cách giao.
- Vị trí của khách chỉ dùng để sắp xếp điểm nhận lúc đang xem, không lưu.
- Thời hạn lưu chi tiết yêu cầu và nhật ký do chủ dự án và luật sư dữ liệu chốt. Đại lý cần được ghi là bên xử lý dữ liệu trong điều khoản.

### 14.5 Vận chuyển
Khách gửi về kho bằng hãng nào cũng được, nên rủi ro hàng cấm nằm ở quy tắc đóng gói (14.1). Việc cần xin bằng văn bản từ Gomdon (hãng đang dùng cho đường thu kèm đơn): danh mục hàng không nhận, có lấy được thùng carton và nilon theo thể tích không, và báo giá cước chiều về kho cho khách. Bảng ước tính phí ship ở màn Chọn cách giao (7.2) phải dựa trên báo giá thật, không dựa bảng niêm yết tôi đã dùng để suy ra ước tính.

### 14.6 EPR (trách nhiệm tái chế của nhà sản xuất)
EPR là nghĩa vụ của nhà sản xuất và nhập khẩu bao bì, không phải điều kiện để làm chương trình này. Tôi không tìm thấy nguồn cho thấy bao bì thu lại từ người tiêu dùng được cấn trừ nghĩa vụ. Tubu có thể được loại trừ nếu doanh thu nhóm bao bì dưới 30 tỷ đồng mỗi năm, nhưng việc Tubu có thuộc diện không cần kiểm tra. Hệ quả: không nói "được tính EPR" trong truyền thông. Kho nên ghi riêng khối lượng thực nhận (trường tuỳ chọn `receivedWeightGrams`, 11.1) để có số nếu sau này thuộc diện.

### 14.7 Cách nói với khách
- Không dùng "tái chế 100%", "xử lý đúng chuẩn" khi chưa có hợp đồng với đơn vị tái chế đầu ra.
- Thẻ tác động chỉ nói khối lượng ("ước tính theo khối lượng trung bình"), không nói CO2 hay cây, và chỉ hiện khi mọi món trong lượt có trọng lượng. Admin chỉ đặt trọng lượng cho món có đầu ra thật: Tubu dùng lại để đóng hàng, hoặc giao cho đơn vị thu mua có hợp đồng (5.7).
- Chữ trong mockup như "đưa đi tái sinh" chỉ để minh hoạ. Câu chữ thật phải khớp đầu ra thật của từng món, chốt sau khi chủ dự án trả lời câu 1 ở mục 18.1.
- Thùng carton và nilon chống sốc nói là "dùng lại để đóng hàng". Vỏ hộp sữa và vỏ chai Tubu chưa biết sẽ đi đâu (mục 18.1, câu 1).

### 14.8 Việc phải xong trước khi mở cho khách thật
Không việc nào chặn việc viết code. Các việc trong bảng chặn việc bật chức năng cho khách thật, trừ dòng cuối (vị trí): thiếu thì nhóm "Gần tôi" tự ẩn và không có gì hỏng. Cấu hình `waste.enabled` mặc định tắt cho tới khi các việc chặn xong hoặc chủ dự án quyết định chấp nhận rủi ro.

| Việc | Hỏi ai | Kết quả cần có |
|---|---|---|
| Điểm đổi rác có phải khuyến mại, có phải thông báo | Sở Công Thương TP.HCM | Trả lời bằng văn bản hoặc ghi nhận cuộc gọi; thể lệ công khai |
| Hạch toán điểm và quà | Kế toán thuế | Cách ghi sổ, có cần hoá đơn không |
| Nhận carton, nilon, vỏ hộp có cần đăng ký không; điều kiện nhận pin | Sở Nông nghiệp và Môi trường TP.HCM | Xác nhận phạm vi đợt 1 là hợp lệ; điều kiện để mở pin sau này |
| Danh mục hàng không nhận, báo giá cước chiều về kho, lấy hàng thể tích lớn khi giao | Gomdon | Văn bản; bảng ước tính phí ship thật |
| Đồng ý của khách, vai trò đại lý, thời hạn lưu | Luật sư dữ liệu | Câu chữ đồng ý; điều khoản đại lý |
| Đầu ra của vỏ hộp sữa và vỏ chai Tubu | Chủ dự án | Một nơi nhận có tên, hoặc bỏ món khỏi đợt 1 |
| Điều khoản đại lý | Chủ dự án và luật sư | Không nhận pin, không tự cộng điểm, hạn mức, quyền kiểm tra và thu hồi, ưu đãi riêng tự chịu, bảo mật dữ liệu khách |
| Quyền vị trí của Mini App (`scope.userLocation`) ở trang Quản lý ứng dụng Zalo, biến môi trường `ZALO_APP_SECRET` có giá trị, thử trên thiết bị Zalo thật | Chủ dự án (trang quản lý Zalo) | "Gần tôi" chạy được trên máy thật; nếu chưa có thì chỉ dùng tab tỉnh và tìm bằng chữ (16.1). Không chặn |

## 15. API và phân quyền

Module mới `waste-exchange` trong `apps/api/src/modules/`, đăng ký ở `AppModule`. Module import `WalletModule` để dùng `RewardPointsService` (module này không toàn cục; `LoyaltyModule` thì toàn cục nên dùng được `LoyaltyService` mà không import). Các route dưới đây là đề xuất đủ để lập kế hoạch; builder được đổi đường dẫn nhưng không được đổi quyền, tính idempotent hay thứ tự kiểm tra.

### 15.1 Quy ước chung
- **Khách** là người dùng thật (không phải khách vãng lai), đã có số điện thoại, không bị `waste_user_flags.blockedAt`, và `waste.enabled` đang bật; ngược lại route trả 403 với câu tiếng Việt nêu rõ lý do.
- **Người ở điểm** là người có dòng `waste_point_staff` đang `isActive` tại điểm đó, điểm đang `ACTIVE`, và với điểm `PARTNER` thì chủ điểm vẫn còn là cửa hàng đối tác (`isPartnerStore`, kiểm lại ở mỗi lần xác nhận). Quyền đọc lại từ cơ sở dữ liệu, không tin JWT cũ.
- **Nhân viên** là `@Roles('STAFF','ADMIN')`; service đọc lại role và `isBlocked` từ DB bằng một hàm dùng chung (tách từ `assertPosStaff` của quầy thu ngân, hiện là hàm private). **Admin** là `@Roles('ADMIN')`.
- Mọi route ghi có `@Throttle` (tạo yêu cầu và đổi quà 10 mỗi phút, xác nhận 30 mỗi phút). Thông điệp lỗi viết tiếng Việt đầy đủ.
- Header `Idempotency-Key` (cắt 200 ký tự) bắt buộc với tạo yêu cầu và đổi quà. Gọi lại cùng khoá và cùng nội dung trả đúng kết quả cũ; cùng khoá khác nội dung trả 409.
- Body PATCH và PUT: trường không được null phải dùng `@OptionalNotNull()` hoặc `@ValidateIf(present)` để `null` trả 400 thay vì 500 (`patch-null-contract.spec.ts` quét mọi route PATCH và PUT; DTO phải khai báo trong tệp controller hoặc import tương đối để spec đọc được).
- Thời gian theo lịch Việt Nam dùng `common/vn-time.ts` (`startOfVnMonth`, `startOfVnDay`, `vnMonthKey`, `vnDateKey`), không dùng `setHours`/`getMonth` của `Date` cục bộ.

### 15.2 Khách

| Route | Việc | Ghi chú |
|---|---|---|
| `GET /waste/me` | Tóm tắt cho trang vào: số dư, yêu cầu đang mở, mức dùng trần tháng, các món kèm phần trần còn lại, cờ bật tắt từng cách giao, và danh sách điểm mà người này được xác nhận (rỗng với khách thường) | Lối vào màn đại lý (16) dựa vào trường này, để không thêm lời gọi mạng ở Trang chủ, Vườn Xanh hay Cá nhân |
| `GET /waste/items` | Món đang `ACTIVE` và `COMING_SOON` (món `HIDDEN` không trả) | |
| `GET /waste/points?provinceCode=` | Điểm nhận đang hoạt động, đủ hạn mức hiển thị, không bị ẩn do không hoạt động; tối đa 200 điểm; mỗi điểm kèm các món nhận, giờ mở, ưu đãi riêng đã duyệt, trạng thái "hết hạn mức tháng" suy ra. Có thể nhận thêm `locationToken` và `zaloAccessToken` để tính khoảng cách | Việc lọc theo chữ (tên điểm, phường/xã, tên đường) làm ở máy khách trên danh sách này. Vị trí đổi từ token bằng hàm `resolveZaloLocation` hiện có, không lưu; lỗi hay thiếu quyền thì bỏ qua và trả danh sách không có khoảng cách |
| `POST /waste/preview` | Không ghi gì. Nhận món, số lượng và cách giao; trả điểm ước tính, giọt nước, các trần đã chạm, trường hợp bị chặn (dưới ngưỡng gửi kho, quá trần, điểm hết hạn mức), phí ship ước tính (cách `MAIL_IN`, theo tỉnh) và điểm so với phí | Nguồn duy nhất cho thanh sticky và thẻ xem trước của màn Chọn món và Chọn cách giao |
| `POST /waste/requests` | Tạo yêu cầu (11.2: khoá cố vấn, đếm trần, ghi). Kiểm các điều kiện ở 5.3, điểm nhận nhận đủ các món đã chọn và còn hạn mức, khách đã tích đồng ý | `Idempotency-Key` |
| `GET /waste/requests`, `GET /waste/requests/:id` | Danh sách và chi tiết (kèm bảng đã khai và đã đếm, mốc thời gian) | |
| `PATCH /waste/requests/:id` | Sửa món hoặc điểm nhận, chỉ khi `OPEN` và chưa gắn đơn | |
| `PUT /waste/requests/:id/tracking` | Nhập hoặc sửa hãng và mã vận đơn (`MAIL_IN`); lần đầu chuyển `OPEN` sang `IN_TRANSIT`; mỗi lần sửa ghi nhật ký. Mã được chuẩn hoá (chữ hoa, bỏ khoảng trắng) và duy nhất toàn bảng | Sửa được khi còn `IN_TRANSIT` |
| `POST /waste/requests/:id/cancel` | Khách huỷ, chỉ khi `OPEN` và chưa gắn đơn | Trả lại phần trần |
| `GET /waste/requests/by-order/:orderId` | Yêu cầu thu kèm gắn với một đơn của chính khách | Cho màn chi tiết đơn (12.2) |
| `GET /waste/gifts`, `GET /waste/gifts/mine` | Kho quà (kèm `canRedeem`, số còn lại, giá của `TREE` lấy từ cấu hình game) và các lượt đổi của khách | |
| `POST /waste/gifts/:id/redeem` | Đổi quà (8) | `Idempotency-Key` |
| `GET /waste/rules` | Nội dung `waste.rules_text` | Trang Thể lệ |

### 15.3 Người ở điểm (màn đại lý trên mini app)

Kho thao tác ở tab admin bằng các route nhân viên của 15.4; nhân viên kho cũng có thể được admin gắn làm người ở điểm `WAREHOUSE` để dùng thêm các route dưới đây.

| Route | Việc | Ghi chú |
|---|---|---|
| `GET /waste/desk/points` | Các điểm của người này, kèm hạn mức tháng (đã dùng, còn lại) | |
| `GET /waste/desk/lookup?code=` | Tra theo mã. `TR-...` trả yêu cầu (chỉ khi `pointId` trùng một điểm của người gọi); `QG-...` trả lượt đổi quà chờ nhận | Chỉ trả tên che bớt, số điện thoại che bớt (`maskFullName`, `maskPhoneOrNull`) và danh sách món của yêu cầu đó. Không trả mã người dùng, không trả số đầy đủ |
| `POST /waste/desk/requests/:id/confirm` | Xác nhận số thực nhận từng dòng (và lý do thiếu); chạy giao dịch ở 15.5 | Gọi lại với cùng kết quả thì trả kết quả cũ; khác kết quả thì 409 |
| `POST /waste/desk/requests/:id/reject` | Từ chối toàn bộ kèm lý do (liệt kê ở 11.1) | |
| `POST /waste/desk/gifts/:code/fulfil` | Đánh dấu quà đã trao, chỉ khi điểm bật `giftHandoverEnabled` | |
| `GET /waste/desk/report?month=` | Báo cáo tháng của chính điểm đó (7: đối soát) | |
| `PUT /waste/desk/points/:pointId/perk` | Chủ điểm gửi nội dung "ưu đãi riêng" mới, vào `perkPendingText` chờ admin duyệt | Chỉ vai `OWNER` |

Quét QR bằng camera trong mini app là phần tuỳ chọn, chỉ bật sau khi đã thử trên thiết bị Zalo thật: `scanQRCode` có kiểu trong SDK nhưng chưa nơi nào trong repo dùng và chưa kiểm trên bản Zalo thật. Ô nhập mã luôn có mặt và là đường chính.

### 15.4 Nhân viên và admin

| Route (`/admin/waste/...`) | Quyền | Việc |
|---|---|---|
| `GET overview` | Admin | Dải số liệu tháng (17.2), cảnh báo bất thường |
| `GET/POST/PATCH items`, `PUT items/order` | Admin | Quản lý món. Không cho gỡ `hazardous`, không cho đặt món `hazardous` sang `ACTIVE`. Mọi thay đổi mức quy đổi ghi nhật ký (trước, sau) |
| `GET/POST/PATCH points`, `PUT points/order` | Admin | Quản lý điểm nhận: đăng ký, đặt hạn mức tháng, món nhận, tạm dừng. Không xoá cứng (tắt bằng `status`). Số điểm tối đa 200, kiểm dưới khoá cố vấn khi tạo |
| `POST/DELETE points/:id/staff` | Admin | Gắn hoặc bỏ người ở điểm (tối đa 5) |
| `POST points/:id/perk/approve`, `.../reject` | Admin | Duyệt hoặc từ chối nội dung ưu đãi riêng; gửi `WASTE_PERK_REVIEWED` |
| `GET requests` | Nhân viên, Admin | Hàng đợi theo cách giao và trạng thái (cursor theo thời gian tạo tăng dần); lọc "kho cần đếm", "gửi kho quá hạn xem lại", "hết hạn" |
| `GET requests/lookup?code=` | Nhân viên, Admin | Tra theo mã yêu cầu, mã đơn hoặc mã vận đơn; kho dùng để đối chiếu kiện. Nhân viên thấy số điện thoại che bớt; admin thấy đầy đủ |
| `POST requests/:id/receive` | Nhân viên, Admin | Kho nhận kiện (`RECEIVED`), đếm sau |
| `POST requests/:id/confirm`, `.../reject` | Nhân viên, Admin | Xác nhận hoặc từ chối ở kho (cùng giao dịch ở 15.5, điểm nhận là kho) |
| `POST requests/:id/reverse` | Admin | Thu hồi điểm (10.3), kèm lý do bắt buộc |
| `PATCH requests/:id/cost` | Admin | Nhập `carrierCostVnd` và `receivedWeightGrams` |
| `GET/POST unmatched`, `POST unmatched/:id/resolve` | Nhân viên, Admin | Hàng về kho không rõ chủ |
| `GET/POST/PATCH gifts`, `PUT gifts/order` | Admin | Quản lý kho quà và tồn kho (kèm ghi nhật ký thay đổi tồn) |
| `GET gift-redemptions` | Nhân viên, Admin | Hàng đợi quà chờ nhận (`READY`), kể cả quà quá `waste.gift_claim_days` |
| `POST gift-redemptions/:id/fulfil` | Nhân viên, Admin | Trao quà tại kho |
| `POST gift-redemptions/:id/cancel` | Admin | Huỷ lượt đổi chưa nhận: hoàn điểm vào lô STANDARD (dòng sổ `GIFT_REFUND:<id>`, kèm `expiresAt` mới theo `grant`, khoá chống lặp theo mã lượt đổi), trả lại tồn kho, gửi `WASTE_GIFT_CANCELLED` |
| `GET/PUT users/:userId/flags` | Admin | Khoá hoặc mở khoá đường gửi kho và cả chương trình |
| `GET reports/monthly?month=` | Admin | Báo cáo CSV theo tháng (17.2) |

Cấu hình `waste.*` sửa qua `PUT /admin/config` hiện có; admin thêm một thẻ cấu hình (theo mẫu `GomdonConfigCard`) cho khoá thường dùng. Tiền tố `waste.` được thêm vào `MONEY_PREFIXES` của `config-item.tsx` để sửa khoá có hộp xác nhận, như `loyalty.` và `shipping.`.

Các route nhân viên dùng `@Roles('STAFF','ADMIN')` chứ không dùng `@AllowStaff('KHO')`, nên không đổi ma trận quyền ở `staff-permissions.matrix.spec.ts`. Đây là một quyết định về rủi ro: bất kỳ nhân viên nào cũng xác nhận được hàng ở kho, như Refill hiện làm. Bù lại: không tự xác nhận yêu cầu của mình hay của người cùng số điện thoại, trần điểm mỗi nhân viên mỗi ngày (`waste.staff_daily_cap_points`), nhật ký chỉ thêm, cảnh báo bất thường cả với nhân viên, và các thao tác nặng (thu hồi điểm, sửa quy đổi, hạn mức, kho quà, khoá khách, cấu hình) chỉ admin. Nếu muốn siết thêm, đổi thành `@AllowStaff('KHO')` kèm sửa ma trận là việc nhỏ (mục 18.2, câu 6).

### 15.5 Giao dịch xác nhận (đường duy nhất tới `COMPLETED`)
Dùng chung cho điểm nhận và kho. Thứ tự:

Trước giao dịch (đọc ngoài giao dịch, để không cạn kết nối): đọc cấu hình cần dùng (`waste.staff_daily_cap_points`, các ngưỡng nhận thiếu), `expiresAt` của điểm theo `loyalty.point_expire_months`, `game.tank_capacity`; đọc lại quyền người gọi.

Trong một giao dịch:
1. Khoá dòng yêu cầu (`SELECT ... FOR UPDATE`).
2. Nếu yêu cầu đã `COMPLETED`: cùng người xác nhận và cùng số liệu thì trả kết quả đã lưu; khác thì 409.
3. Kiểm trạng thái cho phép: cách `DROP_OFF` chỉ từ `OPEN` và chỉ tại đúng `pointId` đã chọn; cách `MAIL_IN` và `PICKUP` từ `OPEN`, `IN_TRANSIT` hoặc `RECEIVED` tại kho (kho được "nhận và đếm một lần"; yêu cầu `PICKUP` phải đã gắn đơn).
4. Kiểm quyền và các cấm: người gọi không phải chính khách; số điện thoại khác số của khách; không phải người ở điểm đang là chủ yêu cầu (một người ở điểm không xác nhận cho đồng nghiệp cùng điểm khi đồng nghiệp là người đổi).
5. Kiểm từng dòng: số nguyên từ 0 đến `declaredQty`; thiếu thì phải có lý do. Tính điểm theo 11.2; nếu quá 2000 thì 400.
6. Khoá cố vấn theo người gọi (`waste.staff:<id>`) rồi đếm điểm người này đã xác nhận trong ngày giờ Việt Nam; cộng điểm này không được vượt `waste.staff_daily_cap_points`.
7. Nếu điểm `PARTNER` và điểm khác 0: câu lệnh bộ đếm hạn mức có điều kiện (11.4); không có dòng trả về thì dừng với 409 kèm số điểm còn lại.
8. `UPDATE waste_requests ... WHERE id AND status IN (các trạng thái cho phép)` qua `updateMany`; phải trúng đúng 1 dòng. Ghi `receivedQty`, `shortfallReason`, `pointsAwarded` từng dòng và các cột của yêu cầu.
9. Nếu điểm khác 0: `grant(userId, points, 'RECYCLE:<code>', 'RECYCLE', requestId, tx, expiresAt)`. Trả `false` là trạng thái bất thường: huỷ giao dịch và ghi lỗi.
10. Giọt nước: cộng vào hồ sơ game rồi kẹp theo sức chứa bình (10.5); ghi `dropsAwarded`.
11. Cập nhật `lastConfirmedAt` của điểm; ghi dòng `WasteEvent` (người, lúc nào, máy nào, số khai, số nhận, số điểm).

Sau khi commit, ngoài giao dịch: bắt `P2002` nếu có (trả kết quả cũ), đánh giá quy tắc nhận thiếu lặp lại cho khách (5.4; chạm ngưỡng thì đặt `shipLockedAt` và gửi `WASTE_SHIP_LOCKED`), gửi `WASTE_POINTS_CREDITED`. Từ chối (`reject`) theo cùng khuôn: khoá, kiểm trạng thái và quyền, `updateMany` có điều kiện, ghi nhật ký, thông báo sau commit; không có điểm, không có bộ đếm.

## 16. Cấu trúc giao diện: mini app và web admin

Mockup (12 màn, 390 pixel) là nguồn của bố cục và câu chữ; mục này chỉ nói code đặt ở đâu và gate nào chi phối. Mọi con số trong mockup là minh hoạ.

### 16.1 Mini app

**Route** (đăng ký bằng một dòng `lazy` và một `Route` ở `components/app.tsx`; route ngoài năm tab gốc tự ẩn thanh điều hướng dưới và hiện nút Quay lại):

| Route | Màn (mockup) | Ghi chú |
|---|---|---|
| `/recycle` | Trang Đổi rác (4.1) | Gồm khối yêu cầu đang xử lý, danh sách món, lối vào đại lý nếu `GET /waste/me` trả điểm |
| `/recycle/new` | Chọn món rồi Chọn cách giao (4.2, 4.3) | Hai bước trong một trang với trạng thái bước; nút Quay lại của hệ thống đi lùi một bước |
| `/recycle/points` | Điểm nhận gần bạn (4.4) | Trả lựa chọn về `/recycle/new` qua `location.state` |
| `/recycle/r/:id` | Mã QR và Theo dõi (4.5, 4.6) | Một trang: khi `OPEN` hiện mã QR và hướng dẫn, các trạng thái sau hiện timeline |
| `/recycle/done/:id` | Đã cộng điểm (4.7) | Đứng riêng, không nằm trong bước hướng dẫn |
| `/recycle/rules` | Thể lệ (14.2) | Đọc `GET /waste/rules` |
| `/recycle/desk` | Đại lý nhận hàng (4.10) | Chỉ vào được khi `GET /waste/desk/points` không rỗng |
| `/rewards` | Kho quà (4.8) | Thay phần đổi quà trong trang Điểm Xanh |
| `/refill` | | `Navigate replace` tới `/recycle` (13) |

**Lối vào** (không thêm lời gọi mạng ở Trang chủ, Vườn Xanh hay Cá nhân; các thẻ này tĩnh và chỉ hiện khi `config/public.waste.enabled`, một trường của lời gọi cấu hình công khai đã có ở mọi trang):
- Vườn Xanh: `GameLinkRow` có nhãn "Mới", dòng phụ về giọt nước và Điểm Xanh (4.9), thay hàng "Đổi vỏ chai lấy nước".
- Cá nhân: mục menu "Đổi rác lấy quà" thay "Trạm Refill & Đổi vỏ" (spec `profile.spec.ts` đòi đích menu không trùng nhau).
- Trang Điểm Xanh: hàng dẫn tới `/recycle` và hàng dẫn tới `/rewards`.
- Thông báo: ánh xạ mã bắt đầu bằng `WASTE` (và `REFILL` cũ) tới `/recycle`.
- Thanh toán: công tắc "Thu kèm rác" (12.2). Chi tiết đơn: dòng dẫn tới yêu cầu (12.2).

**Component mới.** Hệ thiết kế v2 đủ Button, Card, Badge, ProgressBar, BottomSheet, SegmentedTabs, StickyActionBar, EmptyState, Skeleton, QuantitySelector, Field, ListRow, KeyValueRow, nhưng không có timeline hay stepper. Thêm `Timeline` vào `components/ui/` (4 bước, có trạng thái xong, hiện tại, chưa tới; vai trò và nhãn cho trình đọc màn hình). Bộ chọn điểm tổng quát hoá từ `RefillLocationPicker` (nhóm radio, nút gọi và nút chỉ đường **nằm ngoài** nút radio để qua `findNestedInteractive`). Thẻ bấm được dựa trên `ListRow` hoặc `GameLinkRow`, không dùng `Card` có `onPress` (không có bàn phím).

**Gate giao diện phải qua** (mọi thứ dưới đây đã có test quét mã nguồn):
- Thêm trang và component mới vào danh sách `FILES` của `ds-c076-pc10c1.spec.ts` **trước khi viết** (mỗi trang đúng một `h1` qua `PageHeader`, chỉ dùng các thành phần zmp-ui đã được phép như `Page`, `Input`, `useSnackbar`, `useNavigate`, `useLocation`, `useParams`, không alias legacy, không màu thô). Không đặt tệp mới trong `components/game/` (tự vào guard PC-10a: không có `Input`, emoji theo danh sách).
- Trong `src/pages/**` không import `Button` từ zmp-ui; dùng `components/ui/button`. Số và ngày qua `utils/format` (`formatPoints`, `formatDate`, `formatDateTime`); kiểm cả khi chạy với `TZ=UTC`.
- Câu chữ: "Điểm Xanh", "giọt nước", "mã giảm giá". Cấm "xu" đứng riêng, "TubuXu", "voucher" hiển thị, "cây thật", "mua cây", "CO2", "hấp thụ", "Mã chứng nhận", `/merchant`, "Cổng đối tác". Chữ do máy chủ trả (tên quà) không bị quét, nhưng `seed.ts` và migration thì bị; nên dòng `TREE` có tên "Góp quỹ trồng cây".
- Biểu tượng giọt nước và các biểu tượng khác dùng icon, không dùng emoji (chỉ tệp trong danh sách emoji được phép mới có emoji).
- Luồng đổi rác dùng Idempotency-Key giữ trong `useRef` gắn với nội dung (mẫu `pages/refill.tsx` cũ): giữ khi lỗi mạng, đổi khi đổi món hay điểm nhận; sau thành công làm mới các khoá truy vấn `['waste']`, `['loyalty']`, `['game']`.
- Kiểm tràn ngang bằng `scrollWidth` và với chữ lớn (`html[data-font-scale='large']`), như spec e2e Refill cũ đang làm.
- e2e: lời gọi API chưa mock làm test fail (`E2E_UNMOCKED`). Chỉ trường `waste` của `/config/public` được thêm vào `mockSession`; mọi lời gọi `/waste/*` được mock trong spec riêng của luồng. Trang mới được thêm vào `scripts/uiux/routes.mjs`.

**Lấy vị trí khách ("Gần tôi").** Dùng `getLocation` của SDK để lấy token (dùng một lần, hết hạn sau 2 phút) kèm token truy cập Zalo và gửi cho `GET /waste/points`; máy chủ đổi ra toạ độ bằng `resolveZaloLocation` và tính khoảng cách, không lưu. Điều này chỉ chạy khi Mini App ID đã được cấp quyền `scope.userLocation` ở trang Quản lý ứng dụng Zalo (thiếu thì người dùng thường gặp lỗi dù tài khoản developer không), khi biến môi trường `ZALO_APP_SECRET` có giá trị, và cần kiểm trên thiết bị thật vì dạng phản hồi của Zalo chưa được kiểm chứng. Khách từ chối quyền hoặc việc lấy vị trí hỏng thì danh sách vẫn hiện theo tỉnh (tab) và tìm theo chữ; mọi nhãn "Gần nhất" biến mất, không có lỗi (14.8).

### 16.2 Web admin
Một tab `waste` ("Đổi rác") trong nhóm "Khách hàng", đăng ký ở bốn chỗ của `app/admin/page.tsx` (kiểu `Tab`, `NAV_GROUPS`, `STAFF_TABS`, khối render). Giữ đúng 9 nhóm menu. Chuyển giữa các phần bằng chip như `refill-tab.tsx` cũ (`role="group"`):

1. **Hàng nhận:** bảng món và bảng sửa, kèm xem trước thẻ khách thấy. Không có trường CO2e.
2. **Điểm nhận:** bảng điểm kèm hạn mức tháng và mức dùng, đăng ký điểm mới (nhập địa chỉ, tỉnh, phường/xã chọn từ `GET /geo/provinces` và `GET /geo/communes`, toạ độ nhập tay, giờ mở theo thứ), món nhận, người ở điểm, duyệt ưu đãi riêng, nhật ký cộng điểm, cảnh báo bất thường. Địa chỉ điểm không dùng chuỗi quận.
3. **Yêu cầu:** hàng đợi, màn đếm cho kho (số thực nhận, lý do thiếu, từ chối), tra theo mã đơn hoặc mã vận đơn, hàng không rõ chủ, yêu cầu quá hạn cần xem lại, thu hồi điểm, nhập `carrierCostVnd`.
4. **Quà:** danh mục (thay phần chỉ xem ở `engagement-tab.tsx`), tồn kho, hàng đợi quà chờ nhận.
5. **Cấu hình chung:** thẻ cấu hình `waste.*` (11.5); các giá trị cố định của Điểm Xanh (1.000đ mỗi điểm) chỉ để xem.

Nhân viên không thuộc nhóm nào thấy tab `waste` nhưng chỉ phần "Yêu cầu" (hàng đợi kho) và hàng đợi quà chờ nhận; ba phần còn lại chỉ admin. Dải số liệu tháng (17.2) hiện ở đầu tab cho admin.

Gate web: thêm mọi tệp admin mới vào `MIGRATED` của `ds-palette-pc11.spec.ts` trước khi viết (không palette cũ, không màu cứng, không emoji làm icon; dùng icon `lucide-react`); ngày giờ qua `lib/format-date.ts` và mỗi `.toLocaleString(` mới phải khai trong `no-raw-date-format.spec.ts`; Điểm Xanh hiển thị bằng `pointsSummary(x).total`, không đọc `.pointsBalance`; test thành phần dùng bộ dựng `test-utils/dom.tsx` tự viết của repo (không có testing-library); thẻ `h2` sau `h1` "Quản trị Tubu Tree" và thêm tab vào danh sách kiểm tiêu đề của `page.spec.tsx`.

## 17. Ra mắt, đo lường và kiểm thử

### 17.1 Các giai đoạn
Chưa có khách thật và ứng dụng chưa triển khai, nên không có dữ liệu cũ phải giữ hay di chuyển. Thứ tự đề xuất:
1. **Xây sau cờ tắt.** Toàn bộ lối vào (thẻ ở Vườn Xanh, mục menu ở Cá nhân, hàng ở trang Điểm Xanh, trang Đổi rác, tab admin) chỉ hiện khi `waste.enabled` bật. Xoá Refill và nút Gomdon cũ xảy ra cùng lúc (mục 13), vì giữ hai thứ chạy song song là điều chủ dự án muốn tránh.
2. **Chạy nội bộ** (khoảng 2 đến 4 tuần): nhân viên Tubu, kho TP.HCM và một hoặc hai đại lý thân quen. Chỉ có đường mang tới điểm nhận và đường gửi về kho. Hạn mức đại lý nhỏ. Mục đích: đo thời gian xác nhận một lượt ở quầy, tỉ lệ nhận đủ so với số khai, tỉ lệ dùng lại thật của carton và xốp hơi, và xem hàng về kho có giống điều đã giả định không.
3. **Mở cho khách TP.HCM** khi các việc ở 14.8 đã xong hoặc chủ dự án chấp nhận rủi ro bằng văn bản.
4. **Mở đường thu kèm đơn** (`waste.lane_pickup_enabled`) khi đã có báo giá cước thật và văn bản trả lời của Gomdon (14.8), và chỉnh bảng ước tính phí gửi kho theo báo giá đó để khách tỉnh xa thấy con số đúng. Từ đây mới xét các việc để đợt sau: trạm gom ở vùng xa, phí tiền mặt cho đại lý theo đơn vị, ảnh làm bằng chứng, pin.

### 17.2 Số liệu phải xem được từ ngày đầu
Admin xem được ở đầu tab "Đổi rác" (số của tháng này, so với tháng trước) và xuất được CSV theo tháng:
- Số yêu cầu theo cách giao và theo trạng thái; thời gian từ tạo tới hoàn tất (trung vị và phân vị 90).
- Số đơn vị theo món và theo điểm nhận; số điểm đã phát, đã tiêu, còn lại (khoản phải trả của chương trình).
- Tỉ lệ thực nhận so với số khai, theo cách giao và theo điểm nhận; tỉ lệ từ chối; số yêu cầu hết hạn.
- Mức dùng hạn mức của từng đại lý; số lượt xác nhận mỗi đại lý.
- Số lượt thu kèm đơn và chi phí Gomdon tương ứng (số tiền do admin hoặc kho nhập tay vào `carrierCostVnd`, mục 12.2).
- Khối lượng thực nhận (khi kho nhập) so với khối lượng ước tính từ số lượng; khối lượng đã dùng lại để đóng hàng nếu kho ghi.
- Khách quay lại đổi lần hai trong 60 ngày; đơn mua của khách có đổi rác so với khách không đổi (chỉ để xem, không có kết luận nhân quả).
Hai con số quyết định cho các lần chỉnh sau: tỉ lệ dùng lại thật của carton và xốp hơi (giả định 40% và 50%, chưa có nguồn) và chi phí Tubu bỏ ra cho mỗi điểm phát.

### 17.3 Kiểm thử
Theo cách repo đang làm (xem mục 11 và 13 về cổng CI). Các trường hợp bắt buộc:
- **Đơn vị:** tính điểm (phần nguyên, chụp mức quy đổi, kẹp số thực nhận về số khai, tổng nhiều dòng), trần ngày, tháng và điểm, xác thực đầu vào, từng bước trạng thái hợp lệ và không hợp lệ.
- **Đua tranh trên Postgres thật:** hai xác nhận cùng một yêu cầu chỉ cộng điểm một lần; nhiều khách xác nhận cùng lúc ở sát hạn mức đại lý không vượt hạn mức; hai yêu cầu tạo song song không vượt trần ngày và trần mở cùng lúc; đổi quà có tồn kho còn 1 với nhiều người cùng đổi; đổi quà khi số dư vừa đủ; đảo điểm sau khi khách đã tiêu một phần; huỷ yêu cầu trong lúc đang xác nhận.
- **Ràng buộc DB:** chỉ một lần cộng điểm cho mỗi yêu cầu (chỉ mục duy nhất từng phần, đã thêm vào danh sách kiểm của repo); món `hazardous` không thể `ACTIVE`.
- **Di chuyển:** `migrate deploy` trên DB trống, không lệch lược đồ, seed và các thông báo có ở cả `seed.ts` lẫn migration.
- **Miniapp (vitest):** trạng thái trình hướng dẫn ba bước, bộ đếm, ngưỡng đường gửi kho và cảnh báo phí lớn hơn điểm, thanh tiến độ tới quà, định dạng ngày giờ (chạy cả với `TZ=UTC`).
- **Playwright:** luồng vàng khách tạo yêu cầu, đại lý đếm và xác nhận, khách thấy điểm, khách đổi quà; luồng ship với mã vận đơn; điểm hết hạn mức bị khoá; khách từ chối quyền vị trí.
- **Mắt người:** so từng màn với mockup ở bề rộng 390 và với bản có chữ lớn của hệ điều hành; màn đại lý đo thời gian một lượt xác nhận.
- Cổng đầy đủ của repo (`docs/2026-10-review/handoff/verify-full.sh`) xanh trước khi gộp, và xem xét bởi người ngoài khi đụng điểm, tiền, quà, thông báo.

## 18. Câu hỏi còn mở, quyết định của tôi và điều chưa kiểm chứng

### 18.1 Chỉ chủ dự án trả lời được
Không câu nào chặn việc viết code. Câu 1 và 2 chặn việc bật cho khách thật (14.8). Mỗi câu có mặc định tôi sẽ dùng nếu chưa có câu trả lời.

1. **Vỏ hộp sữa và vỏ chai, hộp của Tubu sau khi thu về thì Tubu làm gì?** Dùng lại, bán cho đơn vị thu mua, hay chưa có nơi nhận. Câu trả lời quyết định câu chữ nói với khách (14.7) và có nên nhận hai món này ở đợt 1. Mặc định: vẫn nhận cả hai, không hiện dòng tác động, không nói "tái chế".
2. **Gomdon (BestExpress) đã chạy thử đơn loại 3 thật chưa, có nhận thùng carton và nilon theo thể tích, có phục vụ tỉnh xa, địa chỉ hoàn là kho Tubu không, và phí mỗi đơn là bao nhiêu?** Mã chưa có dấu vết nào là đã chạy thật (12.1). Mặc định: cách Thu kèm đơn tắt (`waste.lane_pickup_enabled` = false) cho tới khi có văn bản của Gomdon và một đơn thử chạy hết chuỗi trạng thái.

### 18.2 Quyết định của tôi (chủ dự án đổi được, nêu theo mức ảnh hưởng)
1. **Quà "trồng 1 cây thật" đổi thành "Góp quỹ trồng cây", không hứa cây cụ thể.** Repo có quyết định C-010 và Q-16 cấm chữ "cây thật", "mua cây", "CO2", "hấp thụ", "Mã chứng nhận" ở ba nơi (câu chữ mini app, spec của web admin, dữ liệu seed API), và mã trồng cây hiện có (`GameService.buyTree`) đã dùng cách nói "góp quỹ". Vì thế dòng quà `TREE` có tên "Góp quỹ trồng cây", dùng lại `buyTree` (tạo `PlantedTree` ở trạng thái đã góp, giá luôn lấy từ `game.tree_points_price`, mặc định 50 điểm, tiêu được cả lô điểm quy đổi từ xu cũ theo luật hiện có của `buyTree`), và thẻ tác động chỉ nói số kg bao bì, không nói cây hay CO2. Nếu chủ dự án muốn hứa "một cây thật", phải nới các guard trên ở ba nơi và có hợp đồng với đơn vị trồng cây; đó là việc riêng.
2. **Điểm đổi rác dùng được ngay và không tính xét hạng thành viên hay chi tiêu 12 tháng.** Đây là hành vi mặc định của sổ điểm (chỉ điểm của đơn đã giao mới khoá và mới tính hạng). Lý do không giữ điểm chờ: đã có các lớp kiểm khác (xác nhận của nơi nhận, hạn mức đại lý, trần khách, thu hồi). Đã bỏ phương án "giữ điểm N giờ" khỏi 5.2 để khỏi thêm một cơ chế chưa ai cần.
3. **Giọt nước kẹp theo sức chứa bình và không thu hồi khi thu hồi điểm** (10.5, 10.3).
4. **Hạn mức tháng của đại lý không giữ chỗ lúc tạo yêu cầu; vượt hạn mức thì đại lý không xác nhận được** (không có kiểu "xác nhận mà không cộng"), khách thấy lời nhắn đổi điểm khác, admin nâng hạn mức bằng tay (11.4).
5. **Thu hồi điểm chỉ thu phần còn lại trong ví khách, không ghi nợ điểm, không hoàn hạn mức của điểm nhận** (10.3). Nếu muốn đòi nợ điểm theo kiểu `REFERRAL_DEBT` thì thêm sau.
6. **Mọi nhân viên (STAFF) xác nhận được hàng ở kho, như Refill hiện làm,** kèm trần điểm mỗi nhân viên mỗi ngày, cấm tự xác nhận, nhật ký và cảnh báo. Thao tác nặng chỉ admin (15.4). Siết lại thành nhóm KHO là việc nhỏ.
7. **Điểm nhận là danh sách riêng do admin tạo và duyệt; không tự sinh từ cửa hàng đối tác.** Cờ `isPartnerStore` rộng hơn "cửa hàng thật có người đón khách" (đại lý nào cũng có gian hàng, loại CTV cũng bật được cờ), và cột `warehouse*` của gian hàng là địa chỉ gửi hàng đang công khai. Chủ điểm vẫn phải còn là cửa hàng đối tác (kiểm lúc xác nhận). Đợt 1 chỉ admin thêm người ở điểm (tối đa 5); chủ tự thêm nhân viên là việc đợt sau. Điểm nhận không có khoá ngoại tới `storefronts`, để không thêm cạnh vào đồ thị khoá của gian hàng.
8. **Địa chỉ điểm theo tỉnh và phường/xã, không có quận,** theo địa giới hai cấp của Pancake mà toàn hệ thống đang dùng. Ô tìm lọc theo tên điểm, phường/xã hoặc tên đường. Toạ độ do admin nhập tay (không có dịch vụ tìm toạ độ); liên kết chỉ đường mở bản đồ bằng địa chỉ đã nhập. Kho TP.HCM do admin đăng ký như một điểm `WAREHOUSE` trước khi bật cờ.
9. **Quà:** lõi trừ điểm vẫn nằm ở `LoyaltyService.redeemReward` (giữ thứ tự khoá và kiểm điểm đang bị khoá đã được test kỹ), chỉ đổi nguồn danh mục sang bảng và thêm loại quà, tồn kho, khoá idempotency; quản trị quà và hàng đợi nằm trong module mới; số lượt đổi đọc từ bảng `waste_gift_redemptions`. Quà vật lý có mã nhận hạn 60 ngày không tự huỷ; admin huỷ và hoàn điểm vào lô STANDARD (điểm hoàn có hạn mới theo luật cộng thông thường). Quà nhận mặc định chỉ ở kho Tubu; admin bật `giftHandoverEnabled` cho từng điểm đã được giao quà.
10. **Gỡ Refill kiểu mềm:** giữ bảng và kiểu, không DROP, không sao chép điểm nhận cũ sang bảng mới, `/refill` chuyển hướng (13).
11. **Thu kèm đơn:** giữ ống Gomdon, thay công tắc bằng yêu cầu có cấu trúc, chỉ có trong mini app (web khách bỏ công tắc), điểm chỉ cộng khi kho đếm, chờ hàng về kho tối đa 14 ngày sau khi đơn giao, phí Gomdon nhập tay (12); yêu cầu đã gắn đơn thì khách không sửa món và không huỷ (7.4).
12. **Thông báo chỉ trong ứng dụng** (kênh `INAPP`); thông báo qua Zalo (ZNS) cần mẫu được duyệt, để đợt sau.
13. **Quét QR bằng camera là tuỳ chọn;** nhập mã là đường chính cho đại lý và kho (15.3).
14. **Khách cần tài khoản thật và số điện thoại.** Đợt 1 không có dấu vết thiết bị đáng tin để đánh dấu "trùng thiết bị", nên bỏ ý đó khỏi 5.3; thay bằng mã vận đơn duy nhất toàn hệ thống, cảnh báo khách lặp ở một điểm, và khoá theo tỉ lệ nhận thiếu.
15. **Trần tính theo số thực nhận khi đã đếm xong, theo số khai khi chưa đếm** (11.2).
16. **Các con số mặc định** ở 5.1, 5.3, 6 và 11.5 là đề xuất để chạy thử; chỉnh sau 1 đến 2 tháng có số đo.
17. **Tên khoá, tên bảng và đường dẫn API** ở 11 và 15 là gợi ý; builder đổi cho khớp quy ước miễn là giữ các ràng buộc và quyền.

### 18.3 Điều tôi chưa kiểm chứng
- Dữ kiện về mã nguồn ở tài liệu này được đọc ở bản `8b0ea824` (đã gộp PR #5 đến #12). Từ đó nhánh `main` có thêm PR #13, #14, #16 và #17; tôi đã xem danh sách 19 tệp thay đổi và chỉ thấy một thay đổi liên quan (`LoyaltyService` đổi sang `maskPhoneOrNull`, khớp tên đã dùng ở 15.3). PR #15 và #18 (gói dọn backlog) chưa gộp và có thể đụng vài tệp nhắc tới ở đây. Tôi chưa chạy test hay build nào.
- Gomdon: vận đơn loại 3 chưa từng chạy thật (12.1). Hành vi chiều mang vật liệu về, địa chỉ hoàn, phí, nhận thùng carton theo thể tích đều chưa rõ.
- Quyền vị trí của Mini App ID và dạng phản hồi `/me/info` của Zalo (16.1); `scanQRCode` trên thiết bị Zalo thật.
- Phần pháp lý (14) là tổng hợp từ nguồn thứ cấp, có chỗ mâu thuẫn; cần đối chiếu văn bản gốc.
- Các giả định kinh tế: tỉ lệ dùng lại carton 40% và xốp hơi 50%, giá trị gói 2,5 kg với Tubu 30.000 đến 48.000đ, phí ship 30.000 đến 85.000đ (lấy từ bảng giá niêm yết, chưa có báo giá), mục tiêu 10 giây mỗi lượt xác nhận ở quầy.
- Mockup dùng số liệu và tên cửa hàng giả. Câu chữ như "đưa đi tái sinh" chỉ để minh hoạ (14.7).

## 19. Phụ lục: ảnh mockup

Mười sáu ảnh nằm ở `docs/superpowers/specs/assets/2026-10-17-recycle-rewards/`: 12 màn chính (ảnh 01 đến 12) và 4 ảnh trạng thái khác của cùng các màn (ảnh 13 đến 16). Các màn mini app rộng 390 px, hai màn admin rộng 1280 px. Số liệu, tên cửa hàng và câu chữ trong ảnh là minh hoạ (14.7); khi ảnh khác văn bản ở mục 4 đến 9 thì văn bản thắng.

| Ảnh | Màn | Mục |
|---|---|---|
| `01-trang-doi-rac.png` | Trang Đổi rác | 4.1 |
| `02-chon-mon.png` | Chọn món (bước 1/3) | 4.2 |
| `03-chon-cach-giao.png` | Chọn cách giao (bước 2/3) | 4.3 |
| `04-diem-nhan.png` | Điểm nhận gần bạn | 4.4 |
| `05-ma-qr.png` | Mã QR (bước 3/3) | 4.5 |
| `06-theo-doi.png` | Theo dõi yêu cầu | 4.6 |
| `07-da-cong-diem.png` | Đã cộng điểm | 4.7 |
| `08-kho-qua.png` | Kho quà | 4.8 |
| `09-vuon-xanh.png` | Lối vào từ Vườn Xanh | 4.9 |
| `10-dai-ly-nhan.png` | Đại lý nhận hàng | 4.10 |
| `11-admin-hang-nhan.png` | Admin Hàng nhận | 4.11 và 9 |
| `12-admin-diem-nhan.png` | Admin Điểm nhận | 4.11 và 9 |
| `13-kho-qua-cay-va-hat.png` | Kho quà, tab Cây và hạt (Góp quỹ trồng cây) | 4.8 và 8 |
| `14-theo-doi-mang-toi-diem.png` | Theo dõi, yêu cầu mang tới điểm nhận | 4.6 |
| `15-dai-ly-xac-nhan-xong.png` | Đại lý sau khi xác nhận | 4.10 |
| `16-kho-qua-khung-doi.png` | Kho quà, khung xác nhận đổi | 4.8 |

![Trang Đổi rác](assets/2026-10-17-recycle-rewards/01-trang-doi-rac.png)

![Chọn món (bước 1/3)](assets/2026-10-17-recycle-rewards/02-chon-mon.png)

![Chọn cách giao (bước 2/3)](assets/2026-10-17-recycle-rewards/03-chon-cach-giao.png)

![Điểm nhận gần bạn](assets/2026-10-17-recycle-rewards/04-diem-nhan.png)

![Mã QR (bước 3/3)](assets/2026-10-17-recycle-rewards/05-ma-qr.png)

![Theo dõi yêu cầu](assets/2026-10-17-recycle-rewards/06-theo-doi.png)

![Đã cộng điểm](assets/2026-10-17-recycle-rewards/07-da-cong-diem.png)

![Kho quà](assets/2026-10-17-recycle-rewards/08-kho-qua.png)

![Lối vào từ Vườn Xanh](assets/2026-10-17-recycle-rewards/09-vuon-xanh.png)

![Đại lý nhận hàng](assets/2026-10-17-recycle-rewards/10-dai-ly-nhan.png)

![Admin Hàng nhận](assets/2026-10-17-recycle-rewards/11-admin-hang-nhan.png)

![Admin Điểm nhận](assets/2026-10-17-recycle-rewards/12-admin-diem-nhan.png)

![Kho quà, tab Cây và hạt (Góp quỹ trồng cây)](assets/2026-10-17-recycle-rewards/13-kho-qua-cay-va-hat.png)

![Theo dõi, yêu cầu mang tới điểm nhận](assets/2026-10-17-recycle-rewards/14-theo-doi-mang-toi-diem.png)

![Đại lý sau khi xác nhận](assets/2026-10-17-recycle-rewards/15-dai-ly-xac-nhan-xong.png)

![Kho quà, khung xác nhận đổi](assets/2026-10-17-recycle-rewards/16-kho-qua-khung-doi.png)
