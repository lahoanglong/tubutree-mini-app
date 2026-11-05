## Chiến dịch: kiểm sức khoẻ và lưu một lệnh (gói hj)

Mục này viết để chép nguyên vào runbook (deploy, lệch bản từng chiều, cách lách, quay lại).

### Hợp đồng mới

- `POST /admin/campaigns` và `PATCH /admin/campaigns/:id` nhận thêm `productIds` và `couponCodes`. Gửi trường nào thì thay hết danh sách đó; không gửi thì giữ nguyên. Một lệnh lưu là MỘT giao dịch: khoá dòng chiến dịch, phán quyết, rồi ghi trường và danh sách. Phán quyết chặn thì trả 400 và không ghi gì.
- Mọi đường lưu (POST, PATCH, `PUT /products`, `PUT /coupons`) dùng chung một luật phán quyết `saveVerdict`. Luật chạy theo ba trạng thái của chiến dịch SAU lần lưu: OFF (tắt hoặc hết hạn) luôn cho lưu; SCHEDULED (bật, chưa tới giờ bắt đầu) và LIVE (đang chạy) bị kiểm như nhau, vì trang hẹn giờ cũng không được để trống.
  - Phải sạch MỌI lỗi chặn khi chiến dịch vừa bật hoặc vừa tạo, khi đổi đích, hoặc khi kéo giờ bắt đầu từ hẹn giờ về hiện tại hay quá khứ.
  - Các trường hợp còn lại (cùng đích, đang chạy hoặc đang hẹn giờ) chỉ chặn lỗi MỚI do lần lưu này gây ra. Lỗi cũ có sẵn không chặn việc sửa tiêu đề hay dời giờ.
- `POST /admin/campaigns/check` là route MỚI của gói này (chưa có trên PROD hay main trước đó). Nó trả `issues`, số đếm và `verdict { blocked, codes, reason? }` theo đúng luật lúc lưu, kể cả slug, sản phẩm hay mã không dùng được (mã `INVALID`, câu lỗi giống lúc lưu).
- Tranh khoá: mọi giao dịch lưu (tạo, sửa, PUT sản phẩm, PUT mã) chờ khoá tối đa 3 giây (`lock_timeout`). Chỉ tranh khoá thật (55P03 hết hạn chờ khoá, 40P01 deadlock, P2034 xung đột ghi) trả 409 "Chiến dịch đang được người khác lưu, thử lại sau giây lát" và không ghi gì. Giao dịch hết hạn (P2028, kể cả không mở được trong maxWait) và statement timeout (57014) đi đường chung của dự án: 503 "Hệ thống đang bận, bạn thử lại sau ít giây nhé." và có lên Sentry.
- Mini App không đổi.
- Đổi quy trình so với PROD: bật hoặc hẹn giờ một banner trỏ sản phẩm đang ẩn hay chưa duyệt bị chặn (LINK_PRODUCT_HIDDEN là lỗi chặn), để không bao giờ có banner dẫn tới trang lỗi. Banner cho hàng sắp ra mắt: lưu chiến dịch ở trạng thái TẮT (lưu được dù sản phẩm chưa bật), bật sản phẩm, rồi mới bật chiến dịch. Câu lỗi ở form và ở API đã gợi đúng cách này.
- Luật "từ hẹn giờ kéo về hiện tại thì phải sạch mọi lỗi" chỉ để tránh lỡ tay, không phải hàng rào tuyệt đối: đặt giờ bắt đầu là phút kế tiếp vẫn là hẹn giờ và chỉ bị chặn lỗi mới, rồi tới giờ chiến dịch tự hiện.

### Deploy

Web và API của gói này phải lên cùng một cặp image, liên tiếp nhau. Hai chiều lệch bản dưới đây chỉ nên kéo dài vài giây lúc deploy. Gói không có migration.

### Lệch bản: web mới + API cũ (vài giây lúc deploy)

- Lệnh lưu của web mới có kèm `productIds` hoặc `couponCodes` (chỉ khi danh sách đổi): API cũ trả 400 vì whitelist từ chối trường lạ, không ghi gì. Bấm Lưu lại sau khi API lên bản mới là được.
- Khối "Kiểm trước khi bật" gọi route check. API cũ chưa có route này nên trả 404: khối hiện "Chưa kiểm được", nút Lưu KHÔNG khoá (máy chủ vẫn quyết lúc lưu). Danh sách không có `health` thì web coi như 0/0.

### Lệch bản: web cũ + API mới (API đã lên, web chưa lên hoặc đã quay lại bản cũ)

Web cũ lưu chiến dịch bằng nhiều lệnh: PATCH hoặc POST trường trước, rồi `PUT /products`, rồi `PUT /coupons`. API mới áp phán quyết ở TỪNG lệnh nên một số thao tác bị 400. Web cũ cũng không có khối kiểm hay huy hiệu sức khoẻ để báo trước.

- Tạo mới đang bật, đích CAMPAIGN_PAGE, chưa có sản phẩm hay mã: 400 (trang trống), chưa ghi dòng nào.
- Ba ca sau bị chặn ở lệnh đầu (chưa ghi gì) khi trang chiến dịch HIỆN CHƯA có sản phẩm khách thấy được và chưa có mã dùng được (đã có một trong hai thì lệnh đầu qua): sửa chiến dịch đang tắt, bật lên kèm thêm sản phẩm; gia hạn chiến dịch đã hết hạn kèm thêm sản phẩm; đổi đích sang CAMPAIGN_PAGE kèm thêm sản phẩm.
- Dời giờ bắt đầu của trang đang chạy kèm thêm mã hoặc sản phẩm: lệnh PATCH dời giờ bị 400 (chưa ghi gì) khi trang chỉ còn mã hết hạn trước mốc bắt đầu mới, vì mã đó không còn dùng được tại mốc mới.
- Kéo giờ bắt đầu của chiến dịch hẹn giờ về bây giờ hoặc quá khứ kèm thêm sản phẩm hoặc gỡ đích sản phẩm ẩn: lệnh PATCH đầu bị 400 (chưa ghi gì) khi chiến dịch còn lỗi chặn, vì từ hẹn giờ sang hiện ngay phải sạch mọi lỗi; lệnh thêm sản phẩm hay sửa đích đi sau nên chưa kịp cứu.
- Nút "Bật" ở danh sách (web cũ gửi `PATCH { isActive: true }`): 400 với chiến dịch còn lỗi chặn (trang trống, đích là sản phẩm ẩn hoặc không tồn tại). Web cũ không có huy hiệu sức khoẻ nên admin chỉ thấy câu lỗi, không biết trước.
- `PUT /products` hoặc `PUT /coupons` làm trang đang chạy thành trống (gỡ sản phẩm cuối mà không còn mã dùng được, hoặc thay mã bằng mã chưa mở mà không còn sản phẩm): PUT bị 400. HỎNG GIỮA CHỪNG: nếu lệnh PATCH trường của cùng lần lưu đã ghi trước đó (đổi tiêu đề, giờ, đích) thì trường đã đổi còn danh sách chưa đổi, vì web cũ gửi từng lệnh riêng. Mở lại chiến dịch trong admin để thấy trạng thái thật rồi sửa lại.

### Cách lách khi đang lệch bản (web cũ + API mới)

Giữ trang luôn có ít nhất một món dùng được (sản phẩm hiển thị hoặc mã còn hạn) và tách thành hai lần lưu:
1. Lần 1: lưu ở trạng thái TẮT (hoặc giữ nguyên ngày và đích cũ) và gắn sản phẩm hoặc mã.
2. Lần 2: mới bật, gia hạn, đổi đích hoặc dời giờ.

Chiến dịch đang chạy còn lỗi cũ mà lỡ dời giờ bắt đầu sang tương lai thì kéo về lại bị 400 cho tới khi sửa lỗi (hẹn giờ sang hiện ngay phải sạch mọi lỗi). Lối thoát: sửa lỗi trước (gắn sản phẩm hoặc mã, sửa đích), hoặc đặt giờ bắt đầu là phút kế tiếp (vẫn là hẹn giờ, chỉ bị chặn lỗi mới) rồi để chiến dịch tự hiện.

Khi cần gỡ sản phẩm cuối của trang đang chạy: gắn mã dùng được hoặc sản phẩm khác trước, rồi mới gỡ. Nút "Bật" ở danh sách bị 400 thì mở chiến dịch, sửa theo câu lỗi (gắn sản phẩm, sửa đích), rồi bật lại.

### Quay lại

- Quay lại CẢ HAI (API và web về bản trước gói): không còn route check, `productIds` và `couponCodes` trong POST hay PATCH bị bỏ qua hoặc 400 theo bản cũ; dữ liệu không đổi, không có migration phải hoàn.
- Chỉ quay lại web mà giữ API mới: rơi vào mục "web cũ + API mới" ở trên, dùng cách lách.
- Chỉ quay lại API mà giữ web mới: rơi vào mục "web mới + API cũ": lưu có danh sách bị 400, khối kiểm báo "Chưa kiểm được". Quay lại web luôn cho cùng cặp.
