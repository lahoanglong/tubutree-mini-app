# Câu hỏi cho chủ dự án (gom trong đêm 2026-10-20)

Mỗi câu có 2–4 phương án, phương án (1) là phương án agent khuyên và đã làm tạm (an toàn, đảo ngược được). Sáng hỏi bằng AskUserQuestion.

| # | Nguồn | Câu hỏi | Phương án | Đã làm tạm |
|---|---|---|---|---|
| Q1 | D1-03 | Đơn đại lý (nhập sỉ) và đơn CTV lên hộ khách có được tính vào chi tiêu xét hạng thành viên của chính đại lý/CTV không? Hiện có tính: đại lý nhập 50 triệu/12 tháng lên Cổ Thụ, CTV lên hộ 1,5 triệu lên Lộc Biếc bằng tiền của khách. | (1) Chỉ tính đơn mua lẻ của chính khách (khuyên). (2) Giữ như hiện nay. (3) Tính đơn CTV lên hộ cho khách cuối, không cho CTV. | Chưa đổi xét hạng (chờ chủ). Voucher mốc chi tiêu đã loại đơn đại lý và đơn lên hộ (gói voucher-moc), cùng cách voucher đơn thứ 2 đang làm. |
| Q2 | D1-04, B17 | Ngưỡng khấu trừ TNCN 2 triệu đang xét từng lần rút: CTV rút nhiều lần nhỏ (dưới 2 triệu) cả tháng không bị trừ. Kế toán chốt cách tính nào? | (1) Cộng dồn trong tháng, khấu trừ khi tổng vượt 2 triệu (khuyên, hỏi kế toán). (2) Giữ từng lần. (3) Đặt mức rút tối thiểu 2 triệu. | Chưa đổi. |
| Q3 | D2-01 | Trần mã của nhân viên (B19: 30%/100.000đ mỗi đơn, 10 triệu/ngày) có áp cho flash sale do marketing tạo không? Hiện marketing tạo được flash sale giảm 90%, số lượng tuỳ ý, và tự mua được. | (1) Áp cùng trần, nhân viên không sửa sale của ADMIN, người tạo không mua được giá flash của sale mình (khuyên). (2) Chỉ chặn tự mua. (3) Chỉ ADMIN tạo flash sale. | Làm theo (1) ở gói flash-sale-staff. Muốn sale sâu hơn thì ADMIN tạo. |
| Q4 | D5-02, nhóm C | Giờ gửi ZNS và trần "tin hậu mãi tối đa 2 tin/khách/tháng". | (1) ZNS chỉ gửi 08:00–21:00 giờ VN (ngoài giờ thì lùi tới 08:00), trần 2 tin/tháng tính trên nhóm mẫu khuyến mãi mà marketing được sửa; tin trong app không đổi (khuyên). (2) Khung 07:00–22:00. (3) Không giới hạn giờ, chỉ trần. | Làm theo (1) ở gói zns, đổi được bằng 3 khoá cấu hình `notifications.zns_*`. |
| Q5 | D5-05 | Webhook Zalo OA đang kiểm header tự đặt `x-webhook-token`; tài liệu Zalo dùng chữ ký `X-ZEvent-Signature`. Tự trả lời CSKH có thể không chạy trên production. | (1) Chưa bật tự trả lời lúc ra mắt; chủ gửi thử một tin vào OA khi có khoá, kỹ thuật đọc header thật rồi chuyển sang kiểm chữ ký (khuyên). (2) Agent viết kiểm chữ ký theo tài liệu ngay, chấp nhận chưa thử thật. | Chưa đổi mã (chưa có tài liệu chính thức trong repo để đối chiếu). |
| Q6 | D5-06, nhóm C | Tin "bạn tặng nước" (GAME_WATER_GIFT) và "có câu trả lời mới" (COMMUNITY_NEW_ANSWER) có theo công tắc "Vườn Xanh" và gộp 60 phút như tin thích/bình luận không? | (1) Có, theo công tắc Vườn Xanh và gộp 60 phút mỗi bài (khuyên, khớp nhóm C). (2) Giữ như cũ. | Làm theo (1) ở gói tin-cong-dong. |
| Q7 | D11-01, nhóm C | Đơn sỉ dưới 5 triệu thu phí giao bao nhiêu? Nhóm C chốt "tối thiểu 3 triệu, miễn phí giao từ 5 triệu, khoá mua chịu khi quá hạn" nhưng chưa nêu mức phí, và dòng "điều kiện thanh toán của bậc chỉ hiển thị" mâu thuẫn với khoá mua chịu. | (1) Phí như đơn lẻ, khoá đơn CREDIT khi có nợ quá hạn theo NET n ngày (khuyên). (2) Phí phẳng riêng cho đại lý. (3) Không khoá mua chịu, chỉ hiển thị. | Làm (1) ở gói dai-ly (commit bc5e4c5b, 269aec88): phí 19.000đ (bằng phí phẳng đơn lẻ) cho đơn dưới 5 triệu, tính vào tổng đơn và nợ; tuổi nợ tính từ ngày tạo đơn, trừ tiền trả theo đơn cũ nhất trước. Tắt từng phần bằng `dealer.min_order_value_vnd=0`, `dealer.shipping_fee_below_threshold_vnd=0`, `dealer.block_credit_when_overdue=false`. Còn hỏi: tuổi nợ tính từ ngày giao thay vì ngày tạo đơn? nợ do thu hồi thưởng quý có tính tuổi không? |
| Q8 | D11-03 | Thưởng quý đại lý chốt ngày 10 tháng sau quý; đơn của quý chốt muộn hơn (chờ hàng, tiền về muộn) mất thưởng vĩnh viễn (ví dụ thiệt 4,8 triệu). | (1) Trả bù khi đơn trễ chốt, trong 60 ngày sau quý (khuyên). (2) Giữ chốt một lần, báo rõ ngày chốt cho đại lý. | Chưa đổi (trả thêm tiền cần chủ duyệt). |
| Q9 | D12-01 | Pancake báo "Đã hoàn" cho đơn COD đã giao: tự hoàn tiền vào Ví hay chờ người kiểm? (COD có thể chưa thu nếu kho bấm "Đã nhận" nhầm.) | (1) Đơn COD chưa có bằng chứng đã thu: không tự hoàn, đưa vào "Cần xử lý Pancake" để hoàn tay; đơn chuyển khoản vẫn tự hoàn (khuyên). (2) Tự hoàn mọi đơn như hiện nay. | Làm (1) ở gói pancake-hoan-cod (598a01f3, 9691e503): mã chưa lưu mốc Pancake "16 Đã thu tiền", nên mọi đơn COD đã giao bị báo "Đã hoàn" đều thành khoản chờ Kế toán đối soát. Tin khách ở ca này không nhắc tiền. Còn hỏi: thêm câu "Tubu đang đối soát khoản COD, sẽ báo lại"? |
| Q10 | D11-04 | Bậc giảm giá đặt định kỳ đếm cả gói hẹn ngày xa chưa ra đơn: tạo 4 gói ảo để lên 15%. | (1) Chỉ đếm gói đã ra ít nhất một đơn hoặc kỳ kế tiếp trong 35 ngày (khuyên). (2) Giữ nguyên. | Chưa đổi. |
| Q11 | D15-05 | Web: CSP đang Report-Only, có `unsafe-inline`/`unsafe-eval`; web và Caddy chưa gửi HSTS. | (1) Bật HSTS ở Caddy ngay khi có SSL, giữ CSP Report-Only tuần đầu rồi siết (khuyên). (2) Siết CSP ngay (rủi ro vỡ trang). | Chưa đổi (file của phiên web + hạ tầng). |
| Q12 | D6-18 | Hai ngưỡng freeship cùng hiện: giỏ/chi tiết SP ghi 200.000đ (freeship thường), quà khách mới ghi 199.000đ (freeship đơn đầu, B5). Khách thấy lệch 1.000đ. | (1) Đưa freeship thường về 199.000đ cho khớp (khuyên). (2) Giữ hai ngưỡng, ghi rõ "đơn đầu" ở chỗ 199.000đ. (3) Đưa đơn đầu về 200.000đ. | Chưa đổi (số tiền). |
| Q13 | D8-15 | Chữ Mini App lẫn hai kiểu bỏ dấu: Hủy/Huỷ, Xóa/Xoá, khóa/khoá. | (1) Thống nhất kiểu mới "Huỷ, Xoá, Khoá" như tài liệu và admin đang dùng (khuyên). (2) Kiểu cũ "Hủy, Xóa, Khóa". | Chưa đổi. |
| Q14 | D8-14 | Trang chủ ghi "6 vùng đất" trong khi dữ liệu có 8 nhãn, 7 tỉnh. | (1) Bỏ con số, ghi "từ nhiều vùng đất Việt Nam" (khuyên). (2) Chủ đưa con số đúng. | Chưa đổi. |
| Q15 | D9-03 | Bundle Mini App vào đầu 685 KB (mục tiêu cũ 450 KB không đạt được nếu giữ axios + zmp-ui). | (1) Giữ cho ra mắt, theo dõi thời gian mở thật trên Zalo tuần đầu (khuyên). (2) Thay axios bằng fetch (−40 KB), cần thêm một đợt test. | Chưa đổi. |
| Q16 | D8-12 | Còn chữ tiếng Anh/biệt ngữ ở màn game, nhân viên, CTV và thanh điều hướng admin (vd "Season pass", "KPI"). | (1) Việt hoá hết, giữ "CTV" (khuyên). (2) Giữ thuật ngữ nội bộ ở màn nhân viên/admin, chỉ Việt hoá màn khách. | Chưa đổi (đợt sửa chữ sau khi gộp). |
| Q17 | D11-05, gói mua-chung | Mã mua chung nay là mã % của nhóm (15%) trên dòng sản phẩm, có trần bằng 15% giá biến thể đắt nhất. Mua nhiều đơn vị biến thể rẻ thì được giảm tới trần (vd 4 × 120k giảm 64.500đ; mã cũ giảm 18.000đ). Không bao giờ quá 15% giá thật. | (1) Giữ như vậy (khuyên: đơn giản, không quá 15%). (2) Giới hạn mức giảm bằng 15% của một đơn vị khách mua (cần sửa luật tính mã). | Làm (1) ở 29795d4e, 959bf4f4. |
| Q18 | review mua-chung UC-3 | Đơn tối thiểu của mã mua chung = giá nhóm của biến thể đầu tiên Pancake trả về (có thể là biến thể đắt). Khách mua một đơn vị biến thể rẻ bị từ chối "Đơn tối thiểu …". | (1) Đặt đơn tối thiểu theo biến thể rẻ nhất đang bán (khuyên). (2) Giữ như cũ. | Chưa đổi (có từ trước, đổi luật dùng mã). |
| Q19 | D12-02, gói don-sau-huy | Huỷ/trả đơn lỗi giữa chừng: điểm thường đã hoàn trong cùng giao dịch; bước sau (đảo điểm tích, hoa hồng, lệnh huỷ Pancake) lỗi thì lần gọi lại chạy nốt. Khe còn lại: tiến trình chết (SIGTERM lúc deploy) đúng giữa commit và các bước sau thì không tự chạy lại. | (1) Ra mắt như vậy; tuần sau thêm cột `reversalEffectsAt` + cron quét như DeliveredEffectsResyncCron (khuyên; cần migration). (2) Làm ngay đêm nay. | Làm phần không cần migration ở 06d3f0c7, 3582d71c. |
| Q20 | gói ui-admin-2 | Tab admin "Rút tiền CTV" gồm cả lệnh rút Ví Tubu của khách thường. | (1) Đổi tên "Yêu cầu rút tiền" (khuyên). (2) "Rút tiền (CTV & Ví Tubu)". | Chưa đổi (đợt sửa chữ sau). |
| Q21 | review mua-chung UC-2 | Mẫu tin GROUP_BUY_SUCCESS "Bạn nhận mã giảm {{discount}}đ" lấy số tiền cố định, có ca hứa nhiều hơn mức giảm thật (biến thể đầu là loại đắt). | (1) Đổi mẫu thành "mã giảm {{discount}}" với discount = "15%" (khuyên; sửa seed + dòng mẫu trong DB lúc deploy). (2) Giữ. | Đang làm (1) ở đợt 5 (tin khách: review 2 lượt). |
| Q22 | U2-B01 (UAT U2-19b) | Khách không đổi được chu kỳ giao (4/6/8/10 tuần) của gói định kỳ đang chạy; màn Sửa chỉ có số lượng, thanh toán, địa chỉ; API trả 400 với `intervalWeeks`. Q-13 chỉ chốt sửa số lượng/địa chỉ. | (1) Giữ như vậy cho ra mắt; khách huỷ rồi tạo gói mới (khuyên: luật đã chốt không có chu kỳ). (2) Cho đổi chu kỳ, giữ ngày giao kế như cũ. (3) Cho đổi chu kỳ, tính lại ngày giao kế từ đơn kỳ gần nhất. | Chưa đổi. |
| Q23 | U2-B02 (UAT U2-06) | Chi tiêu 12 tháng để xét hạng cộng cả phí giao (`order.total`). Khách mua đơn nhỏ trả ship lên hạng sớm hơn chút (vd 38.000đ ship trong 1.447.000đ). Luật chốt chỉ nói điểm tích không tính ship. | (1) Giữ tính cả ship (khuyên cho ra mắt: không đổi hạng của ai, ít rủi ro). (2) Chỉ tính tiền hàng (`total − shippingFee`), sửa cả tiến độ "còn X đ". | Chưa đổi (đổi luật hạng). |
| Q24 | U3-B02 (UAT U3-21) | ADMIN hạ CTV về CUSTOMER thì gian hàng ẩn, nhưng người đó tự bấm "Đăng ký miễn phí ngay" là thành CTV lại ngay, gian hàng hiện lại, mã giới thiệu lại ghi hoa hồng. | (1) Chặn tự đăng ký lại khi ADMIN đã hạ: ghi `affiliateRevokedAt/By`, đăng ký trả 403 tới khi ADMIN mở lại (khuyên nếu hạ vai trò là xử lý vi phạm). (2) Giữ như vậy, ghi rõ trên màn admin "hạ vai trò chỉ là tạm ngừng". | Chưa đổi (luật vai trò, chờ chủ). |

## Chủ trả lời sáng 2026-10-20 (07:50–08:00, qua câu hỏi có lựa chọn)

| Câu | Chủ chọn | Việc tiếp |
|---|---|---|
| Q1 | Xét hạng chỉ tính đơn khách tự mua lẻ cho mình; không tính đơn sỉ đại lý, không tính đơn CTV lên hộ | Sửa `spending12m` (loyalty), đợt 6 |
| Q5 | Không theo hai lựa chọn. Chủ muốn: khách chat trong Mini App, tin chuyển tới một tài khoản Zalo cá nhân do chủ đăng nhập (như dự án MSS), nhân viên trả lời từ Zalo cá nhân, tin quay về khách | Tính năng mới: khảo sát MSS, viết thiết kế cho chủ duyệt trước khi làm. Trong lúc chờ, chưa bật tự trả lời qua OA |
| Q8 | Trả bù thưởng quý cho đơn của quý chốt muộn, trong 60 ngày sau quý | Sửa thưởng quý đại lý, đợt 6 (tiền: review 2 lượt) |
| Q10 | Bậc giảm định kỳ chỉ đếm gói đã ra ít nhất một đơn hoặc có kỳ kế tiếp trong 35 ngày | Đợt 6 |
| Q12 | Ngưỡng miễn phí giao thường về 199.000đ, khớp ngưỡng đơn đầu | Đợt 6 (số tiền: review 2 lượt); web theo bằng cấu hình chung, báo d3 |
| Q13 | Thống nhất "Huỷ, Xoá, Khoá" | Đợt 6 Mini App + admin; báo d3 phần web khách |
| Q14 | Bỏ con số, ghi "từ nhiều vùng đất Việt Nam" | Đợt 6 Mini App; báo d3 phần web khách |
| Q16 | Việt hoá hết, giữ "CTV" | Đợt 6 Mini App + admin; báo d3 phần web khách |
| Q18 | Đơn tối thiểu mã mua chung theo biến thể rẻ nhất đang bán | Đợt 6 |
| Q22 | Cho đổi chu kỳ gói định kỳ; tính lại ngày giao kế từ đơn kỳ gần nhất | Đợt 6 API + Mini App; báo d3 phần web khách |
| Q23 | Giữ tính cả phí giao khi xét hạng | Không đổi |
| Q24 | Giữ như hiện nay: hạ vai trò chỉ là tạm ngừng, người đó tự mở lại được | Ghi rõ trên màn admin chỗ hạ vai trò, đợt 6 |
| Q2 | Thuế TNCN của CTV: cộng dồn các lần rút trong tháng, khấu trừ khi tổng vượt 2 triệu | Đợt 6 (tiền: review 2 lượt); vẫn nên báo kế toán |
| Q15 | Thay axios bằng fetch trong Mini App để giảm gói tải đầu | Đợt 6 |
| Q19 | Làm ngay: thêm cột đánh dấu đã chạy xong phần đảo sau huỷ/trả + cron quét chạy lại | Đợt 6 (migration: review 2 lượt) |
| Q20 | Đổi tên tab thành "Yêu cầu rút tiền" | Đã làm ở đợt 5 (77023047) |
| Web Q4 (U6-B08) | Web được trả bằng Ví Tubu (số dư nội bộ, không phải cổng mới); ZaloPay vẫn ẩn. Q4 hiểu là "không thêm cổng thanh toán mới" | Không đổi mã; phiên web sửa chữ Q4 trong docs/2026-10-19-web-parity/PROMPT.md |
| U6-B06 | Bỏ dòng "điểm đang chờ, mở khoá ngày" ở web mọi khổ (theo Mini App) | Phiên web làm |

## Chủ trả lời 2026-10-22 (hai câu sinh ra khi review đợt 6)

| Câu | Chủ chọn | Việc tiếp |
|---|---|---|
| Q2b (thuế giữ dư) | Admin từ chối một lệnh rút làm tổng tháng tụt dưới ngưỡng hoặc giảm: phần thuế đã giữ dư ở các lệnh khác trong tháng **tự hoàn**, không chờ kế toán | Gói q2-tncn. Cách hoàn (chọn an toàn, ghi lại): lệnh còn "Yêu cầu" thì giảm thuế giữ và tăng số thực nhận ngay trên lệnh đó, vì lệnh này còn có thể bị từ chối; lệnh đã duyệt/đã chi hoặc rút về Ví thì cộng phần dư vào Ví Tubu, ghi số đã hoàn để lần rút sau trong tháng không truy thu sai |
| Q8b (bậc quý cũ) | Chụp bảng bậc thưởng theo quý: trả bù và thu hồi của quý cũ dùng bảng bậc đã dùng khi trả thưởng quý đó, admin đổi bậc cho quý mới không ảnh hưởng quý cũ | Gói q8-thuong-quy. Mốc chụp: lần trả thưởng ngày 10 (hoặc lần trả muộn/trả bù đầu tiên của quý). Quý chưa có bản chụp (trả trước bản này) dùng bảng hiện hành |

### Câu mở sau W13 (không chặn mở khách, hỏi kế toán khi rảnh)

| Câu | Vấn đề | Đã chọn tạm (an toàn, đổi được) |
|---|---|---|
| Q2c | Phần thuế hoàn cho lệnh đã chi làm giảm "thuế đã khấu trừ" ở tháng của ngày chi lệnh đó. Lệnh gửi cuối tháng, chi đầu tháng sau, rồi lệnh khác bị từ chối muộn: báo cáo tháng đã kê khai có thể đổi | Ghi trong sổ tay kế toán: điều chỉnh ở kỳ kê khai sau. Câu hỏi: có chốt sổ tháng (không hoàn vào lệnh đã kê khai) không |
| Q2d | CTV được hoàn thuế vào Ví chỉ thấy dòng sổ ví "Hoàn thuế TNCN giữ dư…", không có thông báo riêng | Không gửi thông báo (tránh thêm mẫu tin). Câu hỏi: có muốn báo qua thông báo trong app không |
| Q2e | Admin tắt khấu trừ (pct 0) rồi có lệnh bị từ chối: thuế đã giữ lúc còn bật được hoàn hết | Giữ theo công thức (tháng không còn phải khấu trừ) |
