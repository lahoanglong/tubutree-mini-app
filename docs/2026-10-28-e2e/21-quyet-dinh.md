# 21. Quyết định thay chủ và việc chờ chủ (đêm 2026-10-28)

Anh dặn đi ngủ, không trả lời được, nên các chỗ cần chọn về giao diện, luồng hay chữ trên màn hình em đã chọn phương án an toàn, đảo ngược được, và giao cho các gói làm luôn. Những chỗ đụng giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, hoặc gửi tin mới cho khách thật thì em KHÔNG làm, để anh quyết sáng nay.

Không gói nào push, deploy hay ghi PROD. Backlog đầy đủ: `20-backlog.md`. Việc từng gói: `goi/<gói>.md`.

## A. Em đã chọn thay anh (đang làm đêm nay)

Muốn đổi lại thì nói em; mọi thứ dưới đây đổi lại được mà không mất dữ liệu.

| Mục | Em chọn | Vì sao |
|---|---|---|
| E-6 (MUAHANG-01) mã chào mừng ở giỏ | Chỉ hiện câu "Bạn có N mã dùng được · giảm đến X". Không tự áp mã. | Tự áp mã là đổi luồng thanh toán. Câu gợi ý đủ để khách mới không quên mã 30.000đ. |
| E-34 (MUAHANG-07) ghi chú đơn định kỳ | Giữ nguyên ghi chú trong DB, chỉ đổi cách hiện: nhãn "Đơn định kỳ", dòng giảm "Ưu đãi đặt định kỳ". | Kho và Pancake đang đọc ghi chú đó. |
| E-38 (DOIRAC-02) quầy tra mã | Chỉ phần (b): nhân viên cùng điểm xem được yêu cầu đồng nghiệp vừa duyệt (24 giờ, chỉ đọc). | Phần (a), hiện quà đã trao/đã huỷ ở quầy, đổi cách xử lý tranh chấp quà; cờ đổi rác đang tắt nên để anh quyết. |
| E-22 (DOIRAC-03) tin nhắc trước hạn đổi rác | Tin nhắc trong app 24–48 giờ trước hạn. Chữ hết hạn của MAIL_IN: "Nếu bạn đã gửi kiện, hãy nhắn CSKH kèm mã vận đơn để được hỗ trợ." | Không hứa mở lại hay cộng điểm (không đụng thể lệ). Cờ `waste.enabled` vẫn tắt, nên chưa khách nào nhận. |
| E-43 (CTV-02) hoa hồng đã trả mà đơn bị trả hàng | Chỉ báo kế toán bằng mẫu cảnh báo có sẵn `OPS_REFUND_ALERT`. Không trừ Ví CTV. | Thu hồi tiền là chính sách (xem mục B). |
| E-46 (CTV-08) tự chuyển hoa hồng mỗi giờ | Giữ lịch mỗi giờ và tin như cũ. Chỉ thêm "Tải thêm" cho lịch sử hoa hồng và lệnh chuyển. | Đổi giờ chuyển tiền là vận hành tiền. |
| E-47 (CTV-09) nhiệm vụ "Đơn hàng đầu tiên" | Chỉ không tính hoa hồng đã bị huỷ (REJECTED). | Đơn huỷ rõ ràng không phải "đơn hàng". Các luật khác là điều kiện thưởng (mục B). |
| E-50 (CTV-11) gian hàng đổi nội dung sau duyệt | Ghi mốc `contentChangedAt`, admin có lọc "Đổi sau duyệt (n)" và nút "Đã xem". Không bắt duyệt lại, không ẩn gian hàng. | Admin thấy để soát; không ảnh hưởng CTV. |
| E-62 (KYTHUAT-07) webhook Zalo OA | Chỉ bỏ sự kiện không phải tin khách (`user_send_*`) và thêm cron gửi lại tin kẹt. Không đổi cách xác thực. | Cơ chế ký cần anh xem dashboard Zalo (mục B). |
| E-66 (DODANG-05) tab Cộng đồng ở Vườn Xanh web | Ẩn bằng cờ `GAME_SOCIAL_ON_WEB = false`. Mã giữ nguyên, đổi cờ là hiện lại. | Web 375 phải giống Mini; Mini đã bỏ tặng nước và xếp hạng. |
| E-71 (DODANG-11) đơn định kỳ trong Mini | Tab "Định kỳ" chỉ hiện với khách ĐÃ có gói đang chạy hoặc tạm dừng (đặt trên web), để họ xem/tạm dừng. Không có lối tạo gói mới. Cờ `SUBSCRIPTIONS_IN_MINIAPP` giữ nguyên. | Khách nhận tin gói mà không quản lý được là ngõ cụt; khách khác không thấy gì đổi. |
| E-74 (DODANG-14) endpoint cũ | Xoá hai endpoint điểm danh cũ chỉ khi cả bản Mini đang chạy (9d0e95bd5) không gọi. `by-host`/`customDomain` giữ, chỉ ghi chú. | Tránh vỡ bản Mini đã phát hành. |
| E-76 (DODANG-16) quản trị câu đố | Chỉ xem, thêm, sửa câu. Không xoá, không bật/tắt. Thưởng điểm 0; giọt nước theo độ khó như câu sẵn có (8/10/12). | Không đổi kinh tế game. |
| E-77 (DODANG-17) cấu hình bố cục khách mới | Không nối, không xoá khoá `home.new_customer_layout`. Chỉ sửa câu mô tả cho đúng ("chưa client nào đọc") và comment cờ Chặng Mùa. | Nối hay xoá là quyết định bố cục trang chủ (mục B). |
| E-87 (CSKH-13, R-112) tiêu đề tin | Đổi tiêu đề trong app theo loại tin. GIỮ emoji trong nội dung mẫu tin. | Sửa nội dung mẫu tin gửi khách thật là việc của anh. |
| E-89 (CSKH-15, R-133) sự kiện cộng đồng trong Mini | Ghi "Tham gia trên web Tubu Tree" ngay trên thẻ, số điểm thành dòng phụ. Không link ra ngoài, không cho dự thi trong Mini. | Giữ quyết định Mini chỉ đọc, không link ngoài. |
| E-101 (R-106) Mini trên màn rộng | Khung tối đa 480px, căn giữa. | Mini chủ yếu mở ở khổ điện thoại. |
| E-103 (R-122) trang Hạng | Bỏ khối mã, thay bằng một dòng "Ví mã (n) ›" tới Ưu đãi; không có mã thì "Đổi quà ›". | Trang Hạng đang dài gần 4 màn, mã hiện ở 3 chỗ. |
| E-115 (R-153) nhãn "Mới" | "Mới" = sản phẩm tạo trong 30 ngày. | Cách hiểu phổ biến, không đổi giá. |
| E-12 (KYTHUAT-01) trần đăng nhập | Không nâng trần 30 lượt/phút/IP. | Cần đo trước; chỉ sửa cách app xử lý lỗi. |
| E-125 (DIEM-10) khoá nhả điểm đơn sàn | Để sau, không làm đêm nay. | Cờ đơn sàn tắt. Cùng kiểu khoá dùng ở 10 cron khác, nên làm một helper chung khi bật cờ thay vì sửa riêng một chỗ. |

## B. Chờ anh quyết (không làm đêm nay)

| Mục | Anh cần chọn | Ghi chú |
|---|---|---|
| E-2 (DIEM-01), P1 | Khách vãng lai (chưa liên kết Zalo) có được nhận điểm danh và thưởng nhiệm vụ 7 ngày không. | Hiện một người dùng script có thể "nuôi" khoảng 38.000 điểm mỗi máy giả mỗi tuần rồi gộp vào một tài khoản thật. Nếu chặn: vẫn cho giọt nước, bỏ điểm, nhiệm vụ báo "Liên kết Zalo để nhận thưởng". |
| E-30 (CSKH-07) | Đăng ký mẫu ZNS "Tubu Tree đã trả lời tin nhắn của bạn" rồi đặt `SUPPORT_CHAT_REPLY` sang kênh ZNS trong admin. | Không cần đổi mã. Điều kiện trước khi bật `chat.enabled` (cùng R-86). |
| E-80 (CSKH-03) | Có gửi tin khi khách lên hạng và khi bị hạ hạng thật không, và câu chữ. | Là tin mới gửi khách thật; câu chỉ nên nêu tên hạng. |
| E-88 (CSKH-14) | Có đổi nội dung tin `ORDER_CONFIRMED` cho đơn chuyển khoản thành "Tubu Tree đã nhận đủ thanh toán" không. | Nếu mẫu đã gắn ZNS được duyệt thì phải duyệt lại mẫu. |
| E-43 (CTV-02) phần thu hồi | Hoa hồng đã vào Ví mà đơn bị trả: trừ Ví CTV (có thể âm), trừ vào hoa hồng kỳ sau, hay bỏ qua. | Đêm nay chỉ báo kế toán. |
| E-46 (CTV-08) phần lịch | Chuyển hoa hồng vào Ví một lần mỗi sáng (8:00) thay vì mỗi giờ, và gộp tin. | CTV đông đơn đang nhận nhiều tin mỗi ngày. |
| E-47 (CTV-09) phần còn lại | Nhiệm vụ "Đơn hàng đầu tiên" chỉ tính đơn đã giao? Không tính đơn CTV lên hộ? Chỉ tính đơn qua gian hàng? | Là điều kiện thưởng 5.000 điểm. |
| E-50 (CTV-11) | Gian hàng đổi tên/ảnh sau duyệt có phải duyệt lại không. | Đêm nay chỉ đánh dấu để admin soát. |
| E-38 (DOIRAC-02) phần (a) | Quầy có hiện quà đã trao/đã huỷ (chỉ đọc) khi nhân viên tra mã không. | Cờ đổi rác tắt. |
| E-126 (DIEM-11) | Quà hiện vật đổi rác quá hạn nhận: tự huỷ và hoàn điểm, hay vẫn cho nhận. | Hiện vẫn "Chờ nhận" mãi và vẫn trao được. |
| E-128 (DOIRAC-09) | Cách ghi phiên bản thể lệ khách đã đồng ý (hash nội dung hay số phiên bản do admin đặt). | Hiện gắn cứng `2026-10-17.1` dù thể lệ sửa được. |
| E-62 (KYTHUAT-07) phần (a) | Xem trang cấu hình webhook OA trên developers.zalo.me: có ô "token" tự đặt hay Zalo ký bằng `X-ZEvent-Signature`. | Nếu là chữ ký thì cần thêm ENV `ZALO_OA_SECRET_KEY` và sửa `docs/GO-LIVE-KEYS.md` mục 5. |
| E-77 (DODANG-17) | Nối `home.new_customer_layout` vào trang chủ hay xoá khoá; bật Chặng Mùa hay chưa. | Công cụ tạo mùa đã có từ 27/10. |
| E-6 (MUAHANG-01) phần tự áp | Có tự áp mã tốt nhất ở thanh toán không. | Đêm nay chỉ gợi ý. |
| R-116, R-86, R-160, R-166 | Vẫn chờ anh như trước. | Không gói nào đụng. |

## C. Anh kiểm trên PROD (chỉ đọc, trước khi deploy đợt này)

- Đếm CTV đang là tài khoản khách (`zaloId` bắt đầu `guest_`, vai AFFILIATE), vì E-11 chặn đăng ký mới nhưng không đổi tài khoản cũ.
- Trạng thái webhook Pancake (đang 401 theo ghi chú trước) để biết tin trạng thái đơn có tới không.
- Điền `loyalty.tier_drop_zns_template_id` nếu muốn tin báo trước hạ hạng đi qua Zalo (hiện chỉ có tin trong app).
- Apache có `mod_remoteip` không: trần đăng nhập theo IP phụ thuộc IP thật của khách.
- Cờ `aiAdvisorEnabled`: E-23 chỉ có tác dụng khi cờ bật.

## D. Cách các gói chạy

- 16 gói chạy song song, mỗi gói một worktree, không gói nào sửa chung file (bản đồ ở cuối mỗi `goi/<gói>.md`).
- Chạy sau: canhan sau thongbao; admin-nhansu sau admin-hopviec; admin-don sau admin-hopviec và api-tin.
- Gói đụng tiền, điểm, hoa hồng, Ví, đăng nhập (giohang, muachung, api-tin, diem, ctv, phien, admin-hopviec, admin-congcu) qua hai lượt review Opus.
- Gói có migration: admin-hopviec (bảng báo trả nợ đại lý), admin-nhansu (hai cột mới), doirac (chèn một mẫu tin). Chỉ thêm, không xoá cột.
