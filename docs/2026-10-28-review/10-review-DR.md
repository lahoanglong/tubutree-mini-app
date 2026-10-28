# DR: Đổi rác lấy quà, chat CSKH, cộng đồng, học viện, trợ lý AI

## Tóm tắt
- Chưa bật Đổi rác được. Thể lệ vẫn trống ("Thể lệ đang được cập nhật"), nhưng bước 2 bắt khách tick "Tôi đồng ý với Thể lệ". Không có chốt nào chặn bật cờ khi thể lệ rỗng. Bật cờ lúc này thì thành P0 (DR-01, B-34).
- Cờ đang tắt mà web máy tính vẫn hiện "Đổi rác lấy quà" ở menu đầu trang và chân trang. Bấm vào chỉ thấy "Chương trình đang tạm dừng" (DR-02, sót lại của B-19). Mini App và web điện thoại đã ẩn đúng.
- Chat CSKH tắt: mọi lối vào đã ẩn đúng trên cả hai nền tảng, chỗ hỏi đáp tự chuyển sang nút gọi hotline. Không có lối lọt.
- Khách khó thấy kết quả đổi rác. Trang yêu cầu không tự cập nhật khi đã đóng mã QR. Yêu cầu xong biến khỏi trang Đổi rác. Tab mặc định "Đang xử lý" trống, không có chữ. Tốn 4 chạm (DR-03).
- Web: sau khi tạo yêu cầu, bấm Quay lại thì về form "Bước 1/2" trống (DR-04). Bước 2 xếp thẻ "Gửi về kho" bị khoá lên trên thẻ "Mang tới điểm nhận" miễn phí (DR-05).
- Khách Zalo chưa cho số (guest) mở "Yêu cầu của tôi" trên Mini App gặp chữ lỗi sai ngữ cảnh "Ưu đãi này…" kèm Thử lại vô ích (DR-06, B-32).
- Cộng đồng, học viện, trợ lý AI ổn về chức năng. Còn lệch kiểu giữa Mini App và web 375, vùng chạm 36px, lối vào Học viện mở cho cả khách thường.
- Điểm trung bình nhóm 3,64 (Mini App 3,60, web 375 3,69).

## Điểm
| Màn (khoá) | Nền | Rõ | Dễ | Đẹp | Nhanh | Bền | Ghi chú một dòng |
|---|---|---|---|---|---|---|---|
| recycle | Mini | 4 | 3 | 3 | 3 | 4 | Lịch sử chỉ là biểu tượng; danh sách "Cách đổi" mất số; tải chậm 6,5s vẫn skeleton |
| recycle | Web375 | 4 | 3 | 4 | 4 | 4 | Guest: thẻ đăng nhập nằm cuối trang, không dính đáy như Mini |
| recycle-rules | Mini | 2 | 3 | 3 | 4 | 3 | Trang trống "Thể lệ đang được cập nhật" |
| recycle-rules | Web375 | 2 | 3 | 3 | 4 | 3 | Như Mini |
| recycle-new | Mini | 4 | 3 | 4 | 4 | 4 | Nút +/− 36px; còn lại tốt |
| recycle-new | Web375 | 3 | 3 | 4 | 4 | 4 | Thẻ "Gửi về kho" bị khoá đứng đầu; Quay lại sau khi tạo về form trống |
| recycle-points | Mini | 4 | 4 | 3 | 4 | 3 | "Chưa cập nhật giờ mở cửa"; guest gọi API bị 403 |
| recycle-points | Web375 | 4 | 4 | 4 | 3 | 3 | Không có nháp thì đứng ở skeleton rồi mới chuyển về bước 1 |
| recycle-r-id | Mini | 4 | 4 | 4 | 3 | 4 | Không tự cập nhật khi quầy xác nhận (trừ lúc mở QR) |
| recycle-r-id | Web375 | 4 | 3 | 4 | 3 | 4 | Như Mini, thêm Quay lại về form trống |
| recycle-r-id-edit | Mini | 4 | 3 | 4 | 4 | 4 | Nút +/− 36px |
| recycle-r-id-edit | Web375 | 4 | 3 | 4 | 4 | 4 | Như Mini |
| recycle-requests | Mini | 3 | 3 | 3 | 4 | 2 | Guest: chữ lỗi "Ưu đãi này…"; tab "Đang xử lý" trống không chữ |
| recycle-requests | Web375 | 3 | 3 | 4 | 4 | 3 | Guest có thẻ đăng nhập đúng; tab trống không chữ |
| recycle-done-id | Mini | 5 | 4 | 4 | 4 | 4 | Rõ số điểm cộng, tốt |
| recycle-done-id | Web375 | 5 | 4 | 4 | 4 | 4 | Như Mini |
| chat | Mini | 4 | 3 | 3 | 3 | 4 | Chip trả lời nhanh 37px; skeleton hình dòng sản phẩm |
| chat | Web375 | 4 | 3 | 3 | 4 | 4 | Phải đăng nhập (Mini cho guest chat); nút phụ khác kiểu Mini |
| feed | Mini | 3 | 3 | 3 | 4 | 4 | Bộ lọc chiếm khoảng 40% màn đầu, chỉ thấy 1 bài |
| feed | Web375 | 3 | 3 | 3 | 4 | 4 | Như Mini, chip lọc 36px |
| feed-leaderboard | Mini | 2 | 3 | 3 | 4 | 4 | Chuyển thẳng về /feed; web vẫn có trang xếp hạng |
| feed-leaderboard | Web375 | 4 | 4 | 4 | 4 | 4 | Có trang, cần đăng nhập |
| feed-events | Mini | 3 | 4 | 4 | 4 | 4 | Thẻ ghi "20.000 điểm" nhưng phải mở mới biết "tham gia trên web" |
| feed-events | Web375 | 4 | 4 | 4 | 4 | 4 | Ổn |
| feed-id | Mini | 4 | 4 | 4 | 4 | 4 | Chỉ đọc, đúng quyết định |
| feed-id | Web375 | 4 | 3 | 4 | 4 | 4 | Guest phải đăng nhập mới đọc được bài (Mini cho đọc) |
| academy | Mini | 3 | 3 | 3 | 4 | 4 | Khách thường bấm vào gặp cổng "chỉ dành cho CTV" |
| academy | Web375 | 3 | 3 | 3 | 4 | 4 | Như Mini, cổng khác kiểu Mini |
| academy-courseid | Mini | 4 | 4 | 4 | 4 | 4 | Bài viết hiện đủ, "Đánh dấu đã học" rõ |
| academy-courseid | Web375 | 4 | 4 | 4 | 4 | 4 | Như Mini |
| ai-advisor | Mini | 4 | 4 | 3 | 4 | 4 | Trạng thái "tạm nghỉ" tốt; nút phụ nền xanh nhạt |
| ai-advisor | Web375 | 4 | 4 | 3 | 4 | 4 | Nút phụ viền trắng, khác Mini |

Trung bình: Mini App 3,60; web 375 3,69; cả nhóm 3,64.

Nhận xét web 1280 (không chấm điểm):
- recycle: bố cục rộng hợp lý, có cột. Menu đầu trang và chân trang luôn có "Đổi rác lấy quà" kể cả khi cờ tắt (DR-02).
- chat: dải trả lời nhanh nằm trong một băng trắng giữa khung, trông như khối lạc (`screens/web1280/chat__returning__web1280__s1.png`).
- ai-advisor: các nút kéo dài gần hết bề ngang, khoảng 1.100px (`screens/web1280/ai-advisor__returning__web1280__s1.png`).
- feed: ổn, nhưng bộ lọc vẫn chồng hai hàng chip.
- Mini App 1280: kéo giãn hết bề ngang, không giới hạn khung (chỉ gặp khi mở bằng trình duyệt).

## Phát hiện
| ID | Mức | Màn | Khổ/persona | Vấn đề | Bằng chứng | Mẫu Shopee/Grab | Đề xuất | Công sức S/M/L | File nguồn:dòng |
|---|---|---|---|---|---|---|---|---|---|
| DR-01 | P1 (thành P0 nếu bật cờ) | recycle-rules, recycle-new bước 2 | Mini + web, mọi persona | Thể lệ trống. Bước 2 vẫn bắt tick "Tôi đồng ý với Thể lệ Đổi rác". Khi `waste.rules_text` rỗng, API trả `null` và màn hiện "Thể lệ đang được cập nhật". Không có chốt chặn bật `waste.enabled` khi thể lệ rỗng. Còn mở từ B-34. | `screens/mini375/recycle-rules__returning__mini375__s1.png`, `screens/web375/recycle-rules__returning__web375__s1.png`, `screens/flows/web/5-doi-rac/10-tick-dong-y-the-le.png` | Shopee/Grab: điều khoản chương trình luôn có nội dung trước khi bấm Đồng ý | Chủ nạp thể lệ (bản nháp ở Desktop, còn thiếu tên công ty, ngày bắt đầu). Thêm kiểm tra: không cho bật `waste.enabled` khi `waste.rules_text` rỗng; go-live check báo FAIL. | S (mã) + chủ | `apps/api/src/modules/waste-exchange/waste-config.keys.ts:178-184`, `:289-293`; `apps/api/src/modules/waste-exchange/customer/waste-me.service.ts:114-117`; `apps/miniapp/src/pages/recycle-rules.tsx:27`; `apps/web/src/components/recycle/recycle-rules-view.tsx:42` |
| DR-02 | P1 | Menu đầu trang, chân trang web | web 1280/768, mọi persona | Cờ `waste.enabled` tắt (PROD) mà menu chương trình và chân trang vẫn có "Đổi rác lấy quà". Bấm vào gặp "Chương trình đang tạm dừng", trông như hỏng. B-19 đã sửa các lối khác, còn sót hai chỗ này. "Học viện" ở chân trang cũng hiện cho mọi khách. | Đọc mã. Lọc chỉ theo `isWebRouteReady`, không đọc cờ | Shopee: tính năng chưa mở thì không có lối vào | Lọc `/doi-rac` theo `cfg.waste.enabled` (giữ khi khách có yêu cầu đang mở như Mini). Lọc `/hoc-vien` theo vai trò CTV/đại lý. | S | `apps/web/src/lib/web-nav.ts:36-48`; `apps/web/src/components/site-header.tsx:90`; `apps/web/src/components/site-footer.tsx:29-36` |
| DR-03 | P1 | recycle-r-id, recycle, recycle-requests | Mini + web, returning | Khách khó thấy kết quả. Trang yêu cầu chỉ tự tải lại khi đang mở QR. Chờ 12 giây sau khi quầy xác nhận vẫn "Chờ bạn mang tới". Yêu cầu xong biến khỏi trang Đổi rác. "Yêu cầu của tôi" chỉ là biểu tượng đồng hồ. Xem kết quả tốn 4 chạm. Liên quan B-83. | `screens/flows/web/5-doi-rac/18-cho-12-giay-khong-bam-gi-trang-tu-cap-nhat.png`; `screens/flows/mini/5c-doi-rac-khach-thay-diem/03-man-doi-rac-diem-va-yeu-cau.png`, `05-danh-sach-yeu-cau-cua-toi-tab-dang-xu-ly-trong.png` | Grab: trạng thái tự đổi theo thời gian thực, có thông báo đẩy | Tự tải lại trang yêu cầu khi trạng thái OPEN (ví dụ 15 giây, dừng khi ẩn tab). Trang Đổi rác giữ thẻ "Vừa cộng X điểm" 7 ngày. Đổi biểu tượng lịch sử thành chữ "Yêu cầu của tôi". | M | `apps/miniapp/src/pages/recycle-request.tsx:153`; `apps/web/src/components/recycle/recycle-request.tsx:138`; `apps/miniapp/src/pages/recycle.tsx:232-237` |
| DR-04 | P2 | recycle-new, recycle-r-id | web 375/1280, returning | Sau khi tạo yêu cầu, bấm Quay lại thì về `/doi-rac/tao` với form "Bước 1/2" trống. Mini đã chặn bằng `replayed` và đưa về `/recycle`. | `screens/flows/web/5-doi-rac/22-bam-quay-lai-ve-yeu-cau.png`, `23-bam-quay-lai-ve-doi-rac-lay-qua.png` | Shopee: đặt xong, Quay lại về trang chính chứ không về form | Sau khi tạo, thay luôn mục lịch sử của bước 1, hoặc thêm cờ đã gửi như Mini, rồi đưa về `/doi-rac`. | S | `apps/web/src/components/recycle/recycle-new.tsx:289`, `:328`; so với `apps/miniapp/src/pages/recycle-new.tsx:264-267` |
| DR-05 | P2 | recycle-new bước 2 | web 375, returning (HCM) | Thẻ "Gửi về kho Tubu HCM" bị khoá ("Cần thêm 10.000 điểm") đứng đầu, nút "Chọn Mang tới điểm nhận" nằm trong thẻ đó. Thẻ miễn phí nằm dưới. Khách ở HCM thấy phí ship khung "Toàn quốc" 30.000đ–85.000đ vì bảng vùng phí mặc định rỗng. Chưa rõ vì sao tỉnh của khách không khớp mã điểm '79'. | `screens/flows/web/5-doi-rac/05-bam-tiep-tuc.png` | Grab: lựa chọn dùng được xếp trước, lựa chọn khoá xếp cuối và mờ | Thẻ khoá luôn xếp cuối. Kiểm mã tỉnh địa chỉ mặc định so với mã tỉnh điểm nhận. Chủ điền vùng phí HCM trước khi bật MAIL_IN. | S | `apps/web/src/components/recycle/recycle-new.tsx:363-365`; `apps/miniapp/src/pages/recycle-new.tsx:481-482`; `apps/api/src/modules/waste-exchange/waste-config.keys.ts:155`; `apps/api/src/modules/waste-exchange/customer/waste-preview.service.ts:90-98` |
| DR-06 | P2 | recycle-requests, recycle-points | Mini 375, guest (JWT khách) | Khách chưa cho số vẫn ở phase "authenticated". API đổi rác trả 403. Màn hiện "Ưu đãi này chỉ dành cho tài khoản đã đăng nhập Zalo…" kèm Thử lại không giúp được gì. Web hiện thẻ đăng nhập đúng. Còn mở từ B-32. | `screens/mini375/recycle-requests__guest__mini375__s1.png`; index: 403 `/waste/requests`, 403 `/waste/points` | Shopee: chưa đăng nhập thì hiện lý do và một nút Đăng nhập | Bắt 403 đổi rác thành thẻ "Cho Tubu số điện thoại để xem yêu cầu" giống nhánh `phase === 'guest'`. | S | `apps/miniapp/src/pages/recycle-requests.tsx:44-55`; `apps/miniapp/src/pages/recycle-points.tsx` (nhánh lỗi) |
| DR-07 | P2 | recycle-requests | Mini + web, returning | Tab mặc định "Đang xử lý" có 0 dòng thì để trống, không có chữ. Khách tưởng mất yêu cầu. | `screens/flows/mini/5c-doi-rac-khach-thay-diem/05-danh-sach-yeu-cau-cua-toi-tab-dang-xu-ly-trong.png` | Shopee: tab đơn rỗng có hình và chữ "Chưa có đơn" | Mở tab có dữ liệu trước. Tab rỗng hiện một dòng "Không có yêu cầu đang xử lý" và nút sang tab kia. | S | `apps/miniapp/src/pages/recycle-requests.tsx:29`, `:71-84`; `apps/web/src/components/recycle/recycle-requests.tsx:39`, `:86-100` |
| DR-08 | P2 | recycle-new, recycle-r-id-edit, chat, feed | Mini + web 375 | Vùng chạm dưới 44px: nút +/−/+5/+10 36×36 (20 ô nhỏ mỗi màn), chip trả lời nhanh chat 37px, chip lọc feed web 36px. | index `smallTargets` của `recycle-new`, `recycle-r-id-edit`, `chat`, `feed` | Shopee: nút số lượng nhỏ nhưng vùng chạm mở rộng ra 44px | Thêm vùng chạm ẩn 44px (lớp `tubu-hit-44-square`) cho `QuantitySelector size="sm"`, chip `minHeight: 44`. | S | `apps/miniapp/src/pages/recycle-new.tsx:195`; `apps/miniapp/src/components/support-chat/quick-replies.tsx:14` |
| DR-09 | P2 | academy | Mini + web, returning/new | Mục "Học viện" ở Cá nhân (Mini) và chân trang (web) hiện cho mọi khách. Khách thường bấm vào gặp cổng "chỉ dành cho CTV" và console có 403 `/academy/courses`. Cổng hai nền tảng khác kiểu. Liên quan B-37. | `screens/mini375/academy__returning__mini375__s1.png`, `screens/web375/academy__returning__web375__s1.png` | Shopee: tính năng theo vai trò chỉ hiện cho đúng vai trò | Ẩn Học viện với khách thường, hoặc đổi thành "Trở thành CTV" dẫn về trang đăng ký. Không gọi API khi không có vai trò. | S | `apps/miniapp/src/pages/profile.tsx:56`; `apps/web/src/components/site-footer.tsx:35`; `apps/miniapp/src/pages/academy.tsx:37` |
| DR-10 | P2 | recycle, recycle-points | Mini slow5s, web 375 returning | Mini: khi tải, màn trắng rồi mới có skeleton; mạng chậm 6,5 giây vẫn skeleton. Web: mở trang chọn điểm mà không có nháp thì đứng ở skeleton rồi mới chuyển về bước 1. | `screens/mini375-slow5s/recycle__returning__mini375-slow5s__s2.png`; `screens/web375/recycle-points__returning__web375__s1.png` (finalUrl null) | Grab: skeleton hiện ngay khung đầu | Hiện khung trang (tiêu đề, skeleton) ngay khung đầu. Kiểm nháp đồng bộ trước khi gọi API, chuyển hướng ngay. | M | `apps/miniapp/src/pages/recycle.tsx:257-307`; `apps/web/src/components/recycle/recycle-points.tsx` (nhánh thiếu nháp) |
| DR-11 | P2 | recycle-points, chat, recycle | Mini + web | Dữ liệu chưa sẵn để mở: điểm nhận "Chưa cập nhật giờ mở cửa"; chỉ một thành phố trong bộ chọn; email hỗ trợ là `tubutree@gmail.com`; bảng vùng phí ship rỗng. Liên quan B-83. | `screens/mini375/recycle-points__returning__mini375__s1.png` | Grab: điểm nhận có giờ mở, khoảng cách, chỉ đường | Chủ nạp giờ mở cửa, vùng phí, email tên miền công ty trước khi bật cờ. Thêm vào go-live check. | S + chủ | `packages/app-core/src/waste-hours.ts:16`; `apps/api/src/modules/waste-exchange/waste-config.keys.ts:155` |
| DR-12 | P2 | feed | Mini + web 375, mọi persona | Màn đầu: dải Sự kiện, ô tìm, hai hàng chip lọc chiếm khoảng 40% chiều cao. Chỉ thấy một bài. | `screens/mini375/feed__returning__mini375__s1.png`, `screens/web375/feed__returning__web375__s1.png` | Shopee Feed: một hàng tab mảnh, nội dung chiếm phần lớn màn | Gộp hai hàng chip thành một hàng cuộn ngang. Ô tìm chuyển thành biểu tượng ở đầu trang. | M | `apps/miniapp/src/pages/feed.tsx` (khối lọc) |
| DR-13 | P2 | chat | Mini 375, new/guest | Chat ở sâu: chỉ có ở Cá nhân, cách đỉnh khoảng 1.036px (new) và 1.287px (guest), phải cuộn dài. Trang chủ không có lối. Bước 2 chạm đạt mục tiêu nhưng khó thấy. | `screens/flows/mini/1-khach-moi-new/12-viec-chat-cskh.png`; `06-luong-mini.md:202` | Shopee: biểu tượng chat ở góc đầu trang chủ và trang Tôi | Khi bật chat: thêm biểu tượng chat ở đầu Cá nhân (cạnh chuông). Cần chủ quyết nếu đặt ở trang chủ. | S | `apps/miniapp/src/pages/profile.tsx:138` |
| DR-14 | P2 | recycle, recycle-new, feed-id, chat | Mini vs web 375, guest | Cổng khách chưa đăng nhập lệch giữa hai nền tảng. Mini: guest đọc được bài, chat được; web bắt đăng nhập. Mini recycle-new guest về trang giới thiệu; web hiện cổng đăng nhập dưới tiêu đề "Bước 1/2". Web: thẻ đăng nhập ở trang Đổi rác nằm cuối trang, Mini dính đáy. | `screens/mini375/feed-id__guest__mini375__s1.png` so `screens/web375/feed-id__guest__web375__s1.png`; `screens/web375/recycle-new__guest__web375__s1.png`; `screens/web375/recycle__guest__web375__s2.png` | Shopee: khách chưa đăng nhập đọc được, chỉ hỏi đăng nhập khi bấm hành động | Thống nhất: đọc bài không cần đăng nhập trên web; web recycle-new guest về `/doi-rac`; thẻ đăng nhập dính đáy như Mini. | M | `apps/web/src/components/recycle/recycle-home.tsx:126-135`; `apps/miniapp/src/pages/support-chat.tsx` (AuthGate) |
| DR-15 | P3 | chat | Mini 375 loading | Skeleton khi tải chat là hình dòng sản phẩm (ảnh vuông + hai dòng chữ), không giống bong bóng tin nhắn. | `screens/mini375-loading/chat__returning__mini375-loading__s1.png` | Grab Chat: skeleton dạng bong bóng trái phải | Dùng skeleton bong bóng tin nhắn. | S | `apps/miniapp/src/pages/support-chat.tsx:213-219` |
| DR-16 | P3 | recycle | Mini 375, guest | Danh sách "Cách đổi" là `<ol>` nhưng mất số thứ tự (web có `list-decimal`). Ô nền biểu tượng gần như vô hình trên Mini, web có nền be. | `screens/mini375/recycle__guest__mini375__s1.png` so `screens/web375/recycle__guest__web375__s1.png` | Grab: các bước đánh số rõ | Thêm `listStyle: 'decimal'` hoặc số trong vòng tròn; dùng chung token nền ô biểu tượng. | S | `apps/miniapp/src/pages/recycle.tsx:127` |
| DR-17 | P3 | ai-advisor, chat | Mini vs web 375 | Nút phụ khác kiểu: Mini nền xanh nhạt, web viền trắng. | `screens/mini375/ai-advisor__returning__mini375__s1.png` so `screens/web375/ai-advisor__returning__web375__s1.png` | | Dùng một kiểu nút phụ theo token chung. | S | `apps/web/src/components/advisor-paused.tsx:28-32`; `apps/miniapp/src/components/advisor-paused.tsx` |
| DR-18 | P3 | chat, ai-advisor | web 1280 | Dải trả lời nhanh trong băng trắng giữa khung chat. Nút ở trợ lý AI kéo dài khoảng 1.100px. | `screens/web1280/chat__returning__web1280__s1.png`, `screens/web1280/ai-advisor__returning__web1280__s1.png` | | Giới hạn bề ngang nút (`max-w-sm`), dải chip cùng nền với khung chat. | S | `apps/web/src/app/ho-tro/chat/page.tsx:246`, `:270` |
| DR-19 | P3 | feed-leaderboard | Mini 375 | Mini chuyển `/feed/leaderboard` về `/feed`, web vẫn có trang "Xếp hạng". Hai nền tảng lệch. | `screens/mini375/feed-leaderboard__returning__mini375__s1.png` | | Chọn một hướng (xem mục cần chủ quyết). | S | `apps/miniapp/src/components/app.tsx:211`; `apps/web/src/app/cong-dong/xep-hang/page.tsx:66` |
| DR-20 | P3 | feed-events | Mini 375 | Thẻ sự kiện trong danh sách ghi "20.000 điểm", không nói cách tham gia. Phải mở chi tiết mới thấy "tham gia trên web". | `screens/mini375/feed-events__returning__mini375__s1.png` | | Trên thẻ danh sách cũng ghi dòng cách tham gia, thay cho số điểm nổi bật. | S | `apps/miniapp/src/pages/community-events.tsx:53-61`, `:169-200` |
| DR-21 | P3 | màn lỗi chung (recycle, chat) | Mini 375 error500 | Dòng "Cần hỗ trợ? Gọi …" xuống hai dòng, số điện thoại tách khỏi câu. | `screens/mini375-error500/recycle__returning__mini375-error500__s1.png` | | Giữ "Gọi <số>" một khối không ngắt. | S | `apps/miniapp/src/components/support-hotline.tsx:13`; `apps/miniapp/src/components/ui/empty-state.tsx:132` |

## Đánh giá lối vào khi cờ tắt (PROD)
- Đổi rác (`waste.enabled` tắt):
  - Mini App: ẩn đúng ở Ưu đãi (`apps/miniapp/src/pages/loyalty.tsx:331`), Vườn Xanh (`apps/miniapp/src/pages/game.tsx:270-277`), `offers.tsx:86`, lưới lối tắt. Gõ thẳng `/recycle` thì thấy "Chương trình đang tạm dừng". Đạt.
  - Web điện thoại: lưới lối tắt (`apps/web/src/components/home/shortcut-grid.tsx:36-39`), `uu-dai/page.tsx:113-124`, `vuon-xanh/page.tsx:148`, `tai-khoan/diem-xanh/page.tsx:151` đều đọc cờ. Đạt.
  - Web máy tính: menu đầu trang và chân trang vẫn hiện. Không đạt (DR-02).
- Chat CSKH (`chat.enabled` tắt):
  - Mini App: `support-contact.tsx:24-69`, `profile.tsx:138`, `about.tsx:225` ẩn đúng. Hỏi đáp sản phẩm chuyển sang nút gọi hotline (`advisor-paused.tsx`). Màn `/chat` hiện "đã đóng" khi chưa có lịch sử (`support-chat.tsx:224-225`). API chặn bằng `CHAT_DISABLED` (`apps/api/src/modules/support-chat/support-chat.service.ts:113-114`). Đạt.
  - Web: menu tài khoản (`apps/web/src/components/account/account-menu.ts:65`), trang Về Tubu ẩn đúng. Đạt.

## Thay đổi lớn cần chủ quyết
1. Bật Đổi rác hay chưa.
   - Phương án A: giữ tắt.
   - Phương án B: bật từng phần, chỉ "Mang tới điểm nhận" tại kho HCM; tắt Gửi về kho và Lấy tận nơi.
   - Phương án C: bật cả ba cách.
   - Đề xuất: B, sau khi xong DR-01 (thể lệ và chốt chặn), DR-02, DR-03, DR-11 (giờ mở cửa, vùng phí), và nhân viên thử một vòng thật ở quầy.
   - Lý do: gói tối thiểu Gửi về kho là 15.000 điểm, trong khi phí ship khách tự trả 30.000đ–85.000đ. Màn tự cảnh báo "Phí ship có thể cao hơn giá trị điểm". Mở cách này sớm dễ làm khách thấy thiệt. Không đổi luật điểm, chỉ chọn cách giao được bật.
2. Bật chat CSKH hay chưa.
   - Phương án A: bật qua cầu nối zca-js (tài khoản Zalo cá nhân).
   - Phương án B: giữ tắt, dùng hotline và chat OA chính thức.
   - Đề xuất: giữ tắt tới khi thử thật trên Zalo bằng số riêng (không dùng số chủ), có lịch người trực và cảnh báo khi cầu nối rớt (B-94). Thử nội bộ 1 tuần rồi bật.
   - Lý do: đăng nhập Zalo cá nhân qua bên thứ ba có thể bị khoá tài khoản theo điều khoản Zalo. Khi cầu nối rớt, khách nhắn sẽ không tới ai.
3. Lối vào chat ở đâu khi bật. Phương án: biểu tượng ở đầu Cá nhân, hoặc thêm biểu tượng ở đầu trang chủ. Đề xuất: đầu Cá nhân cạnh chuông, thanh đáy giữ nguyên. Lý do: hiện chat nằm sâu khoảng 1.000px trong Cá nhân (DR-13).
4. Học viện cho ai. Phương án: chỉ hiện cho CTV/đại lý, hoặc đổi thành lối "Trở thành CTV" cho khách thường. Đề xuất: chỉ hiện cho CTV/đại lý. Lý do: khách thường bấm vào chỉ gặp cổng chặn (DR-09).
5. Bảng xếp hạng cộng đồng. Phương án: bỏ luôn trên web cho giống Mini App, hoặc giữ trên web. Đề xuất: bỏ trên web. Lý do: web điện thoại phải giống Mini App; Mini App đã bỏ theo quyết định cộng đồng chỉ đọc (DR-19).

## Chưa kiểm
- Vì sao tỉnh địa chỉ của khách HCM trong luồng web không khớp mã tỉnh '79' của điểm nhận (DR-05). Cần đọc dữ liệu DB lane, không ghi.
- Chuông thông báo trên web khi quầy xác nhận (Mini có thông báo cộng điểm, web chưa xem).
- Chat trên Zalo thật: cầu nối, khớp tin trích dẫn, giờ trực, tin khi mất kết nối.
- Trợ lý AI khi bật: chỉ thấy trạng thái "tạm nghỉ".
- Màn quầy nhân viên (`recycle-desk`) không thuộc nhóm này; chỉ xem trong luồng 5.
- web768 của nhóm này chưa mở xem.
- Trạng thái chữ dài (`-longtext`) cho chat và cộng đồng chưa mở từng ảnh.
- Chữ "mã Miễn phí vận chuyển" (viết hoa lạ) thấy trong ảnh nhưng chưa tìm ra file nguồn.
