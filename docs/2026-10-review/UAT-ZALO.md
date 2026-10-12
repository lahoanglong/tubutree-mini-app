# Checklist UAT trên Zalo thật

Dành cho chủ dự án, chạy sau khi bản thử đã lên kênh test của Zalo. Toàn bộ kiểm thử trước đây của miniapp chạy bằng Playwright WebKit (iPhone 12) với API giả, chưa ai chạy trong WebView Zalo thật. Tờ này gom những thứ chỉ máy thật mới trả lời được, cộng các luồng tiền và điểm nên thử một lần với dữ liệu thật trước khi mở cho khách. Checklist cũ ở `docs/2026-07-05-batch2-deploy-UAT-runbook.md` Phần 4 vẫn dùng được cho các tính năng của đợt batch 2 nhưng còn gọi điểm là "xu", nên đừng dùng nó để kiểm thuật ngữ.

Cách ghi kết quả: mỗi mục có một ô để đánh dấu. Mục nào sai thì chụp màn hình, ghi máy (iPhone hay Android, đời nào, bản Zalo), rồi gửi lại cho mình kèm số mục. Mục nào chỉ "hơi lạ" cũng ghi, vì WebView mỗi máy một khác.

## 0. Chuẩn bị (việc của chủ dự án)

1. Trỏ DNS Cloudflare `api.tubutree.com` và `app.tubutree.com` về VPS `14.225.207.177`, chế độ DNS-only. Chưa trỏ thì các mục dán link ở mục 3 và 8 chưa thử được.
2. Triển khai bản thử lên VPS và nộp miniapp lên kênh test bằng `zmp deploy -t -e`. Các bước ở `99-release-readiness.md` mục 7. Chỉ nộp production sau khi UAT xong. Mình chưa deploy gì, khi nào anh ra lệnh mới làm.
3. Hai máy thử: một iPhone, một Android, cả hai cài Zalo bản mới. Nếu chỉ có một máy thì thử máy đó trước, ghi rõ máy nào chưa thử.
4. Ba tài khoản Zalo: một khách thường (A), một khách được A mời bằng mã giới thiệu (B), một cộng tác viên (CTV). Tài khoản admin để đổi trạng thái đơn.
5. Cấu hình nên kiểm trước trong admin: `returns.window_days` (mặc định 7 ngày), `loyalty.point_expire_months` (mặc định 12), `loyalty.max_redeem_pct` (mặc định 0,2: điểm thường dùng tối đa 20% giá trị đơn), `game.spin_prizes` (mỗi giải điểm tối đa 100 Điểm Xanh), `referral.referrer_reward_points` (mặc định 5) và `referral.window_days` (mặc định 30). Khoá `app.miniapp_base_url` để trống cũng được: link chia sẻ khi đó là link web `app.tubutree.com/san-pham/<slug>`. Nếu đặt thì phải là URL tuyệt đối.
6. Đưa một đơn sang trạng thái "Đã giao" cần admin: dùng màn đơn hàng của admin web nếu có nút đổi trạng thái, hoặc gọi `PUT /admin/orders/:id/status` bằng token admin với `{"status":"DELIVERED"}`. Mình chưa xác nhận admin web có nút này, nên nếu không thấy thì báo mình.

## 1. Đăng nhập và xin số điện thoại

- [ ] Mở miniapp từ QR bằng tài khoản A. Vào thẳng trang chủ, không bị đẩy ra màn đăng nhập lặp. Kỳ vọng: thấy tên hoặc ảnh Zalo ở Hồ sơ.
- [ ] Thêm một sản phẩm vào giỏ, vào thanh toán, bấm đặt hàng. Nếu tài khoản chưa có số điện thoại, Zalo hiện hộp xin quyền số điện thoại. Cho phép thì đơn được đặt. Từ chối thì đơn vẫn được đặt (mã cố ý không chặn khi từ chối). Nếu từ chối mà đơn không đặt được thì ghi lại.

## 2. Ô chọn ngày của gói định kỳ

- [ ] Vào một sản phẩm, bấm "Đăng ký định kỳ", chạm ô chọn ngày bắt đầu. Kỳ vọng: hiện bộ chọn ngày của hệ điều hành, chọn được ngày, giá trị hiện lại đúng trong ô.
- [ ] Thử ở cả iPhone và Android. Nếu ô không mở được hoặc không nhận ngày thì báo mình: phương án dự phòng đã chốt là thay bằng các nút chọn nhanh "Giao ngay", "Ngày mai", "Sau 3 ngày", "Sau 7 ngày".
- [ ] Tạo xong gói, vào `/subscriptions`: thấy gói và ngày giao khớp ngày đã chọn.

## 3. Chia sẻ và link giới thiệu

- [ ] Vào gian hàng CTV (`/storefront`) bằng tài khoản CTV, bấm chia sẻ, chọn "Chia sẻ qua Zalo", gửi cho B. Kỳ vọng: tin nhắn có link và cuối link có `?ref=<mã của CTV>`.
- [ ] Mở hộp chia sẻ rồi bấm huỷ. Kỳ vọng: không hiện thông báo lỗi nào, không có gì bị chép vào clipboard. Nếu hiện lỗi thì ghi nội dung thông báo và báo mình, mã đang chặn lỗi theo mã huỷ `-2003` của SDK và chưa kiểm trên máy thật.
- [ ] B bấm vào link trong Zalo. Kỳ vọng: mở đúng trang sản phẩm hoặc gian hàng, không phải trang 404.
- [ ] Nút "Sao chép link" rồi dán vào ghi chú: link là địa chỉ tuyệt đối (`https://app.tubutree.com/...`), không phải đường dẫn trơn `/product/...`.
- [ ] Dán `https://app.tubutree.com/san-pham/<slug>?ref=<mã>` vào trình duyệt điện thoại, mở, rồi dùng B đặt một đơn. Kỳ vọng: đơn của B được ghi nhận mã `ref` và CTV thấy đơn đó trong dashboard `/affiliate`. Nếu không thấy thì ghi lại đơn nào, vì mình chưa thử đường này trên máy thật. Cần DNS.

## 4. Thanh toán và các lô điểm

Dùng tài khoản A có sẵn một ít Điểm Xanh (tặng từ admin hoặc từ điểm danh). Ghi số dư trước khi thử.

- [ ] COD: đặt một đơn COD. Kỳ vọng: đơn vào `/orders`, trạng thái chờ xác nhận, tổng tiền khớp màn thanh toán.
- [ ] Chuyển khoản: đặt một đơn chuyển khoản, màn `/bank-payment/<mã>` hiện QR. Chuyển khoản thử và kiểm đơn tự chuyển sang đã thanh toán (hoặc admin xác nhận). Cổng ZaloPay chưa thử được vì chưa có khoá.
- [ ] Dùng Điểm Xanh: bật dùng điểm ở thanh toán. Kỳ vọng: số tiền giảm bằng số điểm dùng (1 Điểm Xanh = 1.000đ) và điểm thường chỉ dùng được tối đa 20% giá trị đơn (theo `loyalty.max_redeem_pct`); phần điểm quy đổi từ ví không bị trần này. Số dư sau đặt đơn giảm đúng số điểm đã dùng.
- [ ] Đơn 0đ (mã giảm giá và điểm phủ hết tiền hàng và phí giao): đơn được đặt, hình thức thanh toán là COD, không đòi chuyển khoản.
- [ ] Ô tick và nút chọn ở thanh toán (Checkbox, Radio): chạm đúng vào ô tick nhỏ, rồi chạm vào cả hàng. Kỳ vọng: cả hai cách đều chọn được. Đây là chỗ kiểm WebView có hiểu thuộc tính `inert` không. Nếu chạm vào ô tick riêng mà không ăn hoặc ăn hai lần thì ghi lại.

## 5. Điểm Xanh: nhận, thu hồi, khoá điểm đơn còn trong hạn đổi trả

Điểm của một đơn chỉ được tiêu sau khi đơn hết hạn đổi trả (mặc định 7 ngày kể từ khi giao). Trong lúc đó điểm hiện trong số dư nhưng không dùng được.

- [ ] Cho đơn của A sang "Đã giao". Kỳ vọng: A nhận Điểm Xanh của đơn (điểm chỉ cộng khi đơn Đã giao), `/loyalty` có dòng lịch sử, số dư tăng.
- [ ] Ngay sau đó thử dùng số điểm vừa nhận ở thanh toán một đơn mới, rồi thử đổi quà, góp quỹ cây và quay vòng quay. Kỳ vọng: cả bốn nơi đều từ chối phần điểm đó với câu giải thích rằng điểm của đơn còn trong hạn đổi trả. Riêng nút Quay hiện lỗi dạng "Cần N Điểm Xanh để quay" kèm câu giải thích khi số dư toàn là điểm khoá. Điểm có từ trước (điểm danh, quà tặng) vẫn tiêu được bình thường.
- [ ] Trả hàng: A yêu cầu đổi trả đơn đó và admin duyệt. Kỳ vọng: số điểm đã nhận từ đơn bị thu hồi lại, nhưng không bao giờ làm số dư âm: nếu A đã tiêu một phần thì chỉ thu hồi được phần còn lại. Tiền hoàn về đúng cách thanh toán.
- [ ] Huỷ đơn chưa giao đã dùng điểm: điểm hoàn lại đúng số đã dùng. Điểm hoàn có hạn dùng mới 12 tháng kể từ ngày hoàn, không giữ hạn cũ.
- [ ] Vòng quay `/game`: quay vài lần với số dư đủ. Kỳ vọng: giải điểm cộng tối đa 100 Điểm Xanh, không bao giờ trừ điểm của khách, giải hiển thị khớp với số dư sau quay.

## 6. Đánh giá sản phẩm

- [ ] A mua và nhận một sản phẩm, viết đánh giá lần đầu. Kỳ vọng: nhận thưởng Điểm Xanh: 5 nếu chỉ có chữ, 10 nếu có ảnh, 15 nếu có video. Số điểm nhận khớp với thông báo sau khi gửi.
- [ ] A xoá đánh giá rồi viết lại cho cùng sản phẩm. Kỳ vọng: không nhận thưởng lần hai. Câu gợi ý "+5/+10/+15" vẫn hiện trước khi gửi nhưng đã nêu rõ "lần đầu đánh giá sản phẩm này". Việc ẩn hẳn câu gợi ý với khách đã nhận thưởng chưa làm (cần API thêm cờ), nên đây là hành vi đã biết, không phải lỗi mới.

## 7. Giới thiệu bạn bè

- [ ] A gửi mã giới thiệu cho B. B vào bằng mã, đặt đơn đầu và đơn thứ hai trong 30 ngày, cả hai đã giao thành công. Kỳ vọng: A nhận 5 Điểm Xanh sau đơn thứ hai giao xong, không nhận khi mới đặt. Nếu đơn thứ hai bị trả thì điểm của A bị thu hồi.
- [ ] CTV dùng mã giới thiệu: CTV không nhận thưởng này (cố ý).

## 8. Vườn Xanh và quỹ trồng cây

- [ ] Vào `/game`, góp một khoản vào quỹ cây rồi bấm nút góp thật nhanh hai lần liên tiếp. Kỳ vọng: chỉ trừ một lần, số dư giảm đúng một khoản. Các nút khác trong Vườn làm thay đổi số dư hoặc quà (nhận thưởng, đổi quà) cũng chỉ được tính một lần khi bấm đôi.
- [ ] Hộp xác nhận quỹ cây: hiện đủ nội dung, nút xác nhận và huỷ đều chạm được trên cả hai máy.

## 9. Cộng tác viên

- [ ] CTV vào `/affiliate`: số liệu, mốc thưởng, nút rút tiền hiện đủ và không tràn ngang trên màn nhỏ.
- [ ] Lên đơn hộ khách (COD): đơn tạo được, hoa hồng hiện ở dashboard. Lưu ý yêu cầu số 5 của PA-1 (đơn CTV lên hộ ghi người đặt là khách cuối) chưa làm, hoãn sang sau UAT.
- [ ] Content Kit: mở bộ nội dung của một sản phẩm, sao chép caption. Kỳ vọng: caption có link tuyệt đối kèm `?ref=`.

## 10. Giao diện và thao tác chung trên máy thật

- [ ] Mỗi màn chính (trang chủ, duyệt, chi tiết sản phẩm, giỏ, thanh toán, đơn, hồ sơ, Điểm Xanh, vòng quay, Vườn, thông báo, cài đặt): không có nội dung tràn ngang, chữ không bị cắt, nút chạm dễ (không phải chạm hai lần).
- [ ] Bàn phím hiện lên ở ô nhập địa chỉ, tìm kiếm và đánh giá: ô đang nhập không bị bàn phím che, đóng bàn phím xong bố cục trở lại bình thường.
- [ ] Trang nhãn `/brand-story`: các ghim bản đồ (Lâm Đồng, Mekong) chồng lên nhau. Đã biết, chưa sửa; ghi lại nếu nhìn thấy khó đọc.
- [ ] Mở một đường dẫn không tồn tại: hiện trang "không tìm thấy" có nút về trang chủ, bấm về được.
- [ ] Cuộn danh sách dài (duyệt sản phẩm, đơn hàng, thông báo): cuộn mượt, tải tiếp khi chạm cuối trang, không nhảy vị trí.
- [ ] Đóng app hẳn rồi mở lại: vẫn đăng nhập, giỏ hàng còn nguyên.

## 11. Nội dung còn thiếu

- [ ] `/about` mục "Câu hỏi thường gặp" và `/academy` đang chờ anh nhập nội dung. Nếu để trống thì mở hai màn này chỉ thấy trạng thái rỗng; ghi lại màn có đẹp không để quyết định có cần chữ mặc định hay không.

## Kết quả

Khi xong, gửi mình danh sách mục lỗi kèm ảnh và máy. Mình sẽ phân loại: lỗi chặn phát hành, lỗi nhỏ, hay hành vi đã biết. Chỉ sau khi hết lỗi chặn mới nộp bản production và mở cho khách. Các mục hoãn có chủ ý (PA-1 yêu cầu 5, "Ví trả một phần đơn") làm sau UAT, không nằm trong tờ này.
