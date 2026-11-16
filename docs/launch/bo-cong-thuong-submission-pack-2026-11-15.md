# Bộ hồ sơ thông báo website TMĐT với Bộ Công Thương (online.gov.vn) - Tubu Tree

Ngày soạn: 15/11/2026. Mục đích: chủ dự án mở cổng http://online.gov.vn và copy-paste từng ô, chỉ phải điền nốt 3 trường ở mục 3 trước khi ký số.

Tài liệu này không phải tư vấn pháp lý. Mức phạt, thời hạn xử lý và tên các bước trên cổng lấy từ spec W168 (căn cứ Nghị định 52/2013/NĐ-CP và Nghị định 85/2021/NĐ-CP) và chưa đối chiếu văn bản gốc; cổng có thể đổi giao diện, nên đối chiếu màn hình thật khi nộp.

## 1. Bảng khai báo (copy-paste)

| Ô trên cổng | Giá trị điền |
|---|---|
| Tên thương nhân | `CÔNG TY TNHH TUBU TREE` |
| Mã số thuế | `0319585995` |
| Địa chỉ trụ sở | `Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh, Việt Nam` |
| Loại hình | Thương nhân sở hữu website thương mại điện tử bán hàng (thông báo website TMĐT bán hàng) |
| Tên miền website | `tubutree.com` (ngay sau khi chuyển DNS về VPS Vietnix; hiện tại có thể khai `app.tubutree.com` hoặc chờ đổi DNS xong khai thẳng `tubutree.com`, xem lưu ý 1) |
| Địa chỉ trang chủ | `https://tubutree.com` (hoặc `https://app.tubutree.com` nếu nộp trước khi đổi DNS) |
| Tên ứng dụng di động (nếu khai kèm) | `Tubu Tree` - Zalo Mini App (App ID `2070857098114207963`, nền tảng Zalo; xem lưu ý 2) |
| Ngành hàng kinh doanh | Mỹ phẩm và đồ tiêu dùng thiên nhiên tuyển chọn từ các thương hiệu Việt (chủ đối chiếu với ngành nghề ghi trên Giấy chứng nhận ĐKDN, xem lưu ý 3) |
| Đơn vị cung cấp hosting / hạ tầng | VPS Vietnix (Việt Nam), địa chỉ IP `14.225.207.177` |
| Hotline hỗ trợ khách hàng | `0984 606 774` |
| Email hỗ trợ khách hàng | `tubutree@gmail.com` |

Lưu ý:

1. Kiến trúc tên miền đã chốt: website bán hàng chính đặt tại `tubutree.com` trên VPS Vietnix (`14.225.207.177`), còn chuyên trang bài viết WordPress cũ được tách riêng sang `blog.tubutree.com` trên máy chủ ZenCloud (`42.1.122.84`, toàn bộ đường dẫn mua hàng cũ trên `blog.tubutree.com` đều chuyển hướng 301 về `https://tubutree.com`, không có chức năng đặt hàng trên `blog.tubutree.com`). Nếu nộp hồ sơ sau khi đã đổi DNS (`ops/cutover-apex-apply.sh` hoặc `ops/cutover-apex-http01.sh` trên Vietnix và `finalize-blog-cutover.sh` trên ZenCloud), khai thẳng `tubutree.com` và thay 5 link chính sách ở mục 2 thành `https://tubutree.com/chinh-sach/...`; không cần khai `blog.tubutree.com` ở cổng TMĐT vì đó chỉ là trang tin tức nội dung. Nếu nộp trước khi đổi DNS thì chỉ khai `app.tubutree.com` để chuyên viên mở thấy đúng website bán hàng.
2. Mini App chưa từng gửi duyệt với Zalo. Chỉ khai kèm ứng dụng di động khi Mini App đã được Zalo duyệt và phát hành; chưa thì bỏ trống ô này, không ảnh hưởng hồ sơ website.
3. Ngành hàng phải khớp ngành nghề đăng ký kinh doanh. Chương trình Đổi rác lấy quà là chương trình tích điểm cho khách, không phải hàng hoá bán ra nên không khai ở ô ngành hàng.

Chế độ vận hành công khai của `app.tubutree.com` là website bán hàng của CÔNG TY TNHH TUBU TREE (MST 0319585995): chân trang web và trang Về Tubu Tree của Mini App luôn hiện dòng "Đơn vị vận hành: CÔNG TY TNHH TUBU TREE · MST 0319585995 · Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh" (admin nhập `company.*` khác thì hiện đúng giá trị admin nhập). Web khách không có form đăng ký gian hàng công khai: cổng `/merchant` không có lối dẫn từ web khách, không vào sitemap, bị chặn ở robots và có thẻ noindex.

## 2. Năm đường link chính sách (dán vào 5 ô bắt buộc)

Route thật của web là `/chinh-sach/<mã>` (file `apps/web/src/app/chinh-sach/[loai]/page.tsx`), không phải `/legal/...`.

| Chính sách | Link |
|---|---|
| Điều khoản sử dụng (quy chế hoạt động) | `https://app.tubutree.com/chinh-sach/dieu-khoan` |
| Chính sách bảo mật thông tin cá nhân | `https://app.tubutree.com/chinh-sach/bao-mat` |
| Chính sách đổi trả và hoàn tiền | `https://app.tubutree.com/chinh-sach/doi-tra` |
| Chính sách vận chuyển và giao nhận | `https://app.tubutree.com/chinh-sach/van-chuyen` |
| Chính sách và hình thức thanh toán | `https://app.tubutree.com/chinh-sach/thanh-toan` |

Cả năm link đều nằm ở chân trang web (dòng "Điều khoản, Bảo mật, Đổi trả, Vận chuyển, Thanh toán") và ở mục "Điều khoản & Chính sách" của trang Về Tubu Tree trong Mini App.

Trước khi nộp, mở từng link trên điện thoại và máy tính, kiểm tra:

- Trang không còn dòng "BẢN NHÁP - chờ Tubu Tree duyệt" (dòng này hiện khi `legal.<mã>` ở Quản trị, Cấu hình còn trống). Bản nháp cũng không được lập chỉ mục, nên chuyên viên có thể thấy nội dung khác với bản đã duyệt.
- Không còn chỗ giữ `[ ]` (ví dụ `[số ngày]` ở Chính sách vận chuyển, mục 3). Điền số ngày giao thật rồi lưu bản đã duyệt ở Quản trị, Cấu hình, nhóm legal.

## 3. Ba trường chủ điền nốt (lấy từ Giấy chứng nhận ĐKDN)

| Trường | Điền |
|---|---|
| Ngày cấp ĐKDN | `[Ngày cấp ĐKDN]` |
| Nơi cấp | `[Nơi cấp: Sở Tài chính / Sở KH&ĐT TP.HCM]` (chọn đúng tên cơ quan ghi trên giấy) |
| Người đại diện theo pháp luật | `[Họ tên & SĐT Người đại diện pháp luật]` |

## 4. Hướng dẫn 5 phút trên http://online.gov.vn

1. Bước 1 - Đăng ký tài khoản thương nhân trên cổng, điền bảng ở mục 1 và 3, rồi chờ duyệt tài khoản (khoảng 1 đến 3 ngày làm việc).
2. Bước 2 - Đăng nhập, chọn "Thông báo website TMĐT bán hàng".
3. Bước 3 - Điền thông tin website (mục 1), dán 5 link chính sách (mục 2), đính kèm bản scan Giấy chứng nhận ĐKDN, ký số bằng chữ ký số Token hoặc VNeID rồi gửi.
4. Bước 4 - Khi Bộ Công Thương xác nhận, cổng trả mã và đường dẫn xác nhận. Dán đường dẫn đó vào Quản trị, Cấu hình, `company.bct_notice_url` (mục "Link thông báo Bộ Công Thương" trong thẻ Thông tin cửa hàng). Chân trang web và trang Về Tubu Tree của Mini App tự hiện huy hiệu "Đã thông báo Bộ Công Thương"; web có thể mất tối đa 1 giờ để cập nhật chân trang.

Huy hiệu chỉ hiện khi giá trị là link `https` của `online.gov.vn` hoặc một tên miền `*.gov.vn` (không cổng riêng, không tên đăng nhập). Rỗng, `http`, trang lạ hoặc link giả tên miền đều không hiện huy hiệu, và ô nhập ở Quản trị chặn lưu những giá trị đó. Mặc định `company.bct_notice_url` là rỗng.

## 5. Cảnh báo

- Không đặt huy hiệu hoặc logo "Đã thông báo Bộ Công Thương" khi hồ sơ chưa được duyệt: mức phạt theo spec W168 là 20 đến 40 triệu đồng (chưa đối chiếu văn bản gốc). Vì vậy `company.bct_notice_url` giữ rỗng cho tới khi có đường dẫn xác nhận thật.
- Thủ tục Thông báo (website bán hàng của chính thương nhân) miễn phí, thời gian xử lý khoảng 3 đến 5 ngày làm việc kể từ khi hồ sơ hợp lệ. Nếu website có chức năng sàn giao dịch cho bên thứ ba thì phải làm thủ tục Đăng ký riêng (xem `docs/launch/deploy-rollback-runbook.md` mục 1.6.5), vì vậy không mở đăng ký gian hàng bên thứ ba công khai trong lúc chờ duyệt.
- Hồ sơ bị trả về thường do: chính sách còn là bản nháp, thiếu thông tin thương nhân ở chân trang, hoặc link chính sách không mở được. Đối chiếu mục 6 trước khi gửi.

## 6. Checklist đối chiếu trước khi gửi

Chân trang và thông tin thương nhân:

- [ ] Chân trang web (cả máy tính và điện thoại) hiện "Đơn vị vận hành: CÔNG TY TNHH TUBU TREE · MST 0319585995 · Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh".
- [ ] Chân trang có hotline `0984 606 774` và email `tubutree@gmail.com`.
- [ ] Chân trang chưa có huy hiệu "Đã thông báo Bộ Công Thương" (đúng, vì chưa duyệt).

Năm chính sách (mỗi link mở được, không còn BẢN NHÁP, không còn `[ ]`):

- [ ] Điều khoản sử dụng: `https://app.tubutree.com/chinh-sach/dieu-khoan`
- [ ] Chính sách bảo mật: `https://app.tubutree.com/chinh-sach/bao-mat`
- [ ] Chính sách đổi trả: `https://app.tubutree.com/chinh-sach/doi-tra`
- [ ] Chính sách vận chuyển: `https://app.tubutree.com/chinh-sach/van-chuyen`
- [ ] Chính sách và hình thức thanh toán: `https://app.tubutree.com/chinh-sach/thanh-toan`

Mục "Chính sách kiểm hàng khi nhận hàng" (mục chuyên viên kiểm kỹ nhất), có ở cả hai trang:

- [ ] Chính sách đổi trả, mục 7 "Chính sách kiểm hàng khi nhận hàng" (hoặc mục cùng tên nối cuối bài nếu bản đã lưu là bản admin tự viết).
- [ ] Chính sách vận chuyển, mục 4 tiểu mục "Chính sách kiểm hàng khi nhận hàng" (hoặc mục cùng tên nối cuối bài).
- [ ] Mỗi mục nêu đủ bốn ý: đồng kiểm ngoại quan và số lượng cùng nhân viên giao hàng trước khi nhận, nên quay video khi mở kiện, thời hạn báo (theo số ngày đổi trả đang chạy), hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng khách chọn.
- [ ] Chính sách thanh toán nêu COD, chuyển khoản VietQR, Ví Tubu, ZaloPay (chỉ khi bước thanh toán đang hiển thị), Điểm Xanh; nêu không thu tiền trước khi giao trừ phương thức khách chủ động chọn trả trước có đối soát; nêu hoàn tiền (trường hợp, về đâu, thời gian); nêu không lưu số thẻ; có đầu mối khiếu nại.

Việc dữ liệu PROD cần làm khi deploy (không nằm trong hồ sơ nộp):

- [ ] Migration `20261115172000_w168_legal_thanh_toan` đã chạy: có dòng `legal.thanh-toan`; `legal.van-chuyen` và `legal.doi-tra` đã lưu nội dung mà chưa có chữ "kiểm hàng" được nối tiểu mục kiểm hàng (dòng còn trống thì web dùng bản nháp mặc định, đã có tiểu mục này). Bản admin đã tự viết mục kiểm hàng không bị đụng.
- [ ] Mở lại 5 link ở mục 2 sau deploy (trang chính sách cập nhật tối đa 5 phút).
- [ ] Chạy `go-live:check`: `db.legal_policies` báo đủ 5 chính sách đã lưu.
