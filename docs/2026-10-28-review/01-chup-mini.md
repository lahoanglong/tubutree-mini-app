# 01 Chụp Mini App (lane 5)

Sinh bởi `tools/summary-mini.mjs` từ `screens/index-mini*.jsonl`.

## Số ô
Tổng 310 ô, 492 ảnh; ô lỗi công cụ: 0.

| Khổ / trạng thái | Ô | Ảnh |
|---|---|---|
| mini1280/ok | 58 | 99 |
| mini375/empty | 17 | 27 |
| mini375/error500 | 17 | 20 |
| mini375/loading | 17 | 17 |
| mini375/longtext | 17 | 37 |
| mini375/offline | 17 | 20 |
| mini375/ok | 150 | 238 |
| mini375/slow5s | 17 | 34 |

## Màn trắng (blank)
- orders/returning/375/loading — mini375-loading/orders__returning__mini375-loading__s1.png
- product-slug/returning/375/loading — mini375-loading/product-slug__returning__mini375-loading__s1.png
- cart/returning/375/loading — mini375-loading/cart__returning__mini375-loading__s1.png
- checkout/returning/375/loading — mini375-loading/checkout__returning__mini375-loading__s1.png
- order-code/returning/375/loading — mini375-loading/order-code__returning__mini375-loading__s1.png
- chat/returning/375/loading — mini375-loading/chat__returning__mini375-loading__s1.png
- wallet/returning/375/loading — mini375-loading/wallet__returning__mini375-loading__s1.png
- affiliate/ctv/375/loading — mini375-loading/affiliate__ctv__mini375-loading__s1.png
- dealer/dealer/375/loading — mini375-loading/dealer__dealer__mini375-loading__s1.png
- recycle/returning/375/loading — mini375-loading/recycle__returning__mini375-loading__s1.png
- product-slug/returning/375/slow5s — mini375-slow5s/product-slug__returning__mini375-slow5s__s1.png
- cart/returning/375/slow5s — mini375-slow5s/cart__returning__mini375-slow5s__s1.png
- checkout/returning/375/slow5s — mini375-slow5s/checkout__returning__mini375-slow5s__s1.png
- order-code/returning/375/slow5s — mini375-slow5s/order-code__returning__mini375-slow5s__s1.png
- chat/returning/375/slow5s — mini375-slow5s/chat__returning__mini375-slow5s__s1.png
- wallet/returning/375/slow5s — mini375-slow5s/wallet__returning__mini375-slow5s__s1.png
- affiliate/ctv/375/slow5s — mini375-slow5s/affiliate__ctv__mini375-slow5s__s1.png
- dealer/dealer/375/slow5s — mini375-slow5s/dealer__dealer__mini375-slow5s__s1.png
- recycle/returning/375/slow5s — mini375-slow5s/recycle__returning__mini375-slow5s__s1.png
Ghi chú: khi state loading/slow5s, ảnh s1 có thể trắng đúng thiết kế; xem cột trạng thái.

## pageErrors
Không có.

## consoleErrors (gom theo câu; tách trạng thái ok và trạng thái giả lỗi)
### state ok
- 14x (6 ô) Failed to load resource: the server responded with a status of 404 (Not Found)
- 4x (4 ô) Failed to load resource: the server responded with a status of 403 (Forbidden)

### trạng thái giả (error500/offline/empty/...)
- 223x (17 ô) Failed to load resource: the server responded with a status of 500 (Internal Server Error)
- 223x (17 ô) Failed to load resource: net::ERR_INTERNET_DISCONNECTED
- 1x (1 ô) Failed to load resource: the server responded with a status of 429 (Too Many Requests)

## apiErrors (status >= 400, status 0 = request bị abort)
### state ok
- 4x, 4 ô: GET /brand/public/fuwa3e -> 404 [brand-slug/returning/1280, brand-slug/returning/375, brand-slug/new/375, brand-slug/guest/375]
- 4x, 4 ô: GET /brand/fuwa3e/follow-state -> 404 [brand-slug/returning/1280, brand-slug/returning/375, brand-slug/new/375, brand-slug/guest/375]
- 4x, 4 ô: GET /brand/fuwa3e/share-to-earn -> 404 [brand-slug/returning/1280, brand-slug/returning/375, brand-slug/new/375, brand-slug/guest/375]
- 1x, 1 ô: GET /academy/courses -> 403 [academy/returning/375]
- 1x, 1 ô: GET /academy/courses/:id -> 403 [academy-courseid/returning/375]
- 1x, 1 ô: GET /storefront/me -> 404 [storefront/returning/375]
- 1x, 1 ô: GET /brand/owner/me -> 404 [brand-owner/returning/375]
- 1x, 1 ô: GET /waste/points -> 403 [recycle-points/guest/375]
- 1x, 1 ô: GET /waste/requests -> 403 [recycle-requests/guest/375]

### trạng thái giả
- 46x, 16 ô: GET /config/public -> 500
- 34x, 17 ô: GET /flash-sales/active -> 500
- 34x, 17 ô: GET /me -> 500
- 34x, 17 ô: GET /cart -> 500
- 14x, 7 ô: GET /me/loyalty -> 500
- 12x, 8 ô: GET /me/coupons -> 500
- 8x, 2 ô: GET /orders -> 500 [orders/returning/375/error500, profile/returning/375/error500]
- 8x, 6 ô: GET /me/daily-check-in -> 500
- 6x, 3 ô: GET /brands -> 500 [home/returning/375/error500, browse-category/returning/375/error500, browse-search/returning/375/error500]
- 6x, 3 ô: GET /products -> 500 [home/returning/375/error500, browse-category/returning/375/error500, browse-search/returning/375/error500]
- 6x, 6 ô: GET /orders/active-count -> 500
- 6x, 3 ô: GET /me/wallet -> 500 [checkout/returning/375/error500, profile/returning/375/error500, wallet/returning/375/error500]
- 4x, 2 ô: GET /me/notifications -> 500 [home/returning/375/error500, profile/returning/375/error500]
- 4x, 2 ô: GET /affiliate/me -> 500 [product-slug/returning/375/error500, affiliate/ctv/375/error500]
- 3x, 3 ô: GET /categories -> 500 [home/returning/375/error500, browse-category/returning/375/error500, browse-search/returning/375/error500]
- 3x, 2 ô: GET /dealer/me -> 500 [profile/returning/375/error500, dealer/dealer/375/error500]
- 2x, 1 ô: GET /flash-sales/upcoming -> 500 [home/returning/375/error500]
- 2x, 1 ô: GET /products/for-you -> 500 [home/returning/375/error500]
- 2x, 1 ô: GET /products/nuoc-rua-chen-fuwa3e -> 500 [product-slug/returning/375/error500]
- 2x, 1 ô: GET /products/nuoc-rua-chen-fuwa3e/reviews -> 500 [product-slug/returning/375/error500]
- 2x, 1 ô: GET /me/addresses -> 500 [checkout/returning/375/error500]
- 2x, 1 ô: GET /orders/:code -> 500 [order-code/returning/375/error500]
- 2x, 1 ô: GET /me/subscriptions -> 500 [profile/returning/375/error500]
- 2x, 1 ô: GET /me/referral -> 500 [profile/returning/375/error500]
- 2x, 1 ô: GET /me/support-chat -> 500 [chat/returning/375/error500]
- 2x, 1 ô: GET /me/points/transactions -> 500 [loyalty/returning/375/error500]
- 2x, 1 ô: GET /me/loyalty/member-card -> 500 [loyalty/returning/375/error500]
- 2x, 1 ô: GET /me/wallet/transactions -> 500 [wallet/returning/375/error500]
- 2x, 1 ô: GET /game/profile -> 500 [game/returning/375/error500]
- 2x, 1 ô: GET /game/quiz/today -> 500 [game/returning/375/error500]

## axe (rule, số ô; mức impact không lưu trong index, mức mặc định của axe ghi trong ngoặc)
- landmark-unique (moderate): 2 ô, 2 node: home/returning/375/error500, home/returning/375/offline
Ô axe báo lỗi chạy: 0. Ô không chạy axe (loading/slow5s): 34.
Serious/critical: không có rule nào ở mức này trong các ô đã chạy (kiểm bằng danh sách rule ở trên).

## smallTargets (state ok; top 15 màn theo số mục tiêu < 44px)
Tổng 18 ô có mục tiêu nhỏ.
- recycle-new/returning/1280: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini1280/recycle-new__returning__mini1280__s1.png)
- recycle-points/returning/1280: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini1280/recycle-points__returning__mini1280__s1.png)
- recycle-r-id-edit/returning/1280: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini1280/recycle-r-id-edit__returning__mini1280__s1.png)
- recycle-new/returning/375: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini375/recycle-new__returning__mini375__s1.png)
- recycle-new/new/375: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini375/recycle-new__new__mini375__s1.png)
- recycle-points/returning/375: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini375/recycle-points__returning__mini375__s1.png)
- recycle-points/new/375: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini375/recycle-points__new__mini375__s1.png)
- recycle-r-id-edit/returning/375: 20 — "Giảm số lượng" button.tubu-hit-44-square 36x36; "Số lượng" input 56x36; "Tăng số lượng" button.tubu-press 36x36 (mini375/recycle-r-id-edit__returning__mini375__s1.png)
- chat/returning/1280: 3 — "Đơn của tôi đang ở đâu?" button 186x37; "Đổi trả hàng" button 107x37; "Cách dùng sản phẩm" button 166x37 (mini1280/chat__returning__mini1280__s1.png)
- chat/returning/375: 3 — "Đơn của tôi đang ở đâu?" button 186x37; "Đổi trả hàng" button 107x37; "Cách dùng sản phẩm" button 166x37 (mini375/chat__returning__mini375__s1.png)
- chat/new/375: 3 — "Đơn của tôi đang ở đâu?" button 186x37; "Đổi trả hàng" button 107x37; "Cách dùng sản phẩm" button 166x37 (mini375/chat__new__mini375__s1.png)
- chat/guest/375: 3 — "Đơn của tôi đang ở đâu?" button 186x37; "Đổi trả hàng" button 107x37; "Cách dùng sản phẩm" button 166x37 (mini375/chat__guest__mini375__s1.png)
- cart/returning/1280: 2 — "Nước giặt sinh học Fuwa3e" span.zaui-text 1100x18; "Serum dưỡng ẩm Visante" span.zaui-text 1100x18 (mini1280/cart__returning__mini1280__s1.png)
- checkout/returning/1280: 2 — "Điều khoản" button.tubu-hit-44 69x18; "Chính sách đổi trả" button.tubu-hit-44 111x18 (mini1280/checkout__returning__mini1280__s1.png)
- cart/returning/375: 2 — "Nước giặt sinh học Fuwa3e" span.zaui-text 195x18; "Serum dưỡng ẩm Visante" span.zaui-text 195x18 (mini375/cart__returning__mini375__s1.png)

## Trạng thái lỗi / mất mạng KHÔNG có nút "Thử lại"
### error500: 1/17 ô không có nút thử lại
- browse-search/returning/375/error500 — "Khám phá Huỷ Tìm “nuoc” Chưa có gợi ý — nhấn Tìm để xem kết quả Trang chủ Danh mục Vườn Xa" (mini375-error500/browse-search__returning__mini375-error500__s1.png)

### offline: 1/17 ô không có nút thử lại
- browse-search/returning/375/offline — "Khám phá Huỷ Tìm “nuoc” Chưa có gợi ý — nhấn Tìm để xem kết quả Trang chủ Danh mục Vườn Xa" (mini375-offline/browse-search__returning__mini375-offline__s1.png)

## Trạng thái tải KHÔNG có skeleton
### loading: 1/17 ô không có skeleton
- browse-search/returning/375/loading — "Khám phá Huỷ Tìm “nuoc” Trang chủ Danh mục Vườn Xanh Ưu đãi Cá nhân" blank=false (mini375-loading/browse-search__returning__mini375-loading__s1.png)

### slow5s: 2/17 ô không có skeleton
- profile/returning/375/slow5s — "Cá nhân Nguyễn Thị Quay Lại Sửa hồ sơ 45.400 điểm Điểm Xanh 0đ Ví Tubu" blank=false (mini375-slow5s/profile__returning__mini375-slow5s__s1.png)
- browse-search/returning/375/slow5s — "Khám phá Huỷ Tìm “nuoc” Trang chủ Danh mục Vườn Xanh Ưu đãi Cá nhân" blank=false (mini375-slow5s/browse-search__returning__mini375-slow5s__s1.png)

## Chỗ chậm (msToIdle > 10s, bỏ slow5s)
Không có.


## Điều thấy khi mở ảnh (tay, persona returning, mini375 trừ ghi chú)
Đã mở: s1 của 17 KEY_SCREENS ở ok (17/17), error500 (17/17); offline 6/17 (home, browse-category, browse-search, product-slug, cart, checkout), 11 màn còn lại chỉ kiểm bằng `textHead` (cùng chữ với error500); mini1280 home + product-slug; longtext 6 màn (home, product-slug, cart, orders, browse-category, profile). Chưa mở: s2/s3 cuộn của các màn; ảnh ok của new/guest.

### Bố cục, chữ, nút (state ok)
- Trang chủ, Danh mục, Ưu đãi, Cá nhân (mini375/ok): bong bóng tối "Trồng cây mỗi ngày, nhận quà thật" nổi trên thanh đáy, che chữ nội dung (chữ "Mua lại"/"Xem tất cả" ở home, hàng thẻ ở danh mục, "Quà đã đổi…" ở Ưu đãi, "Học viện Tubu" ở Cá nhân). Ảnh: mini375/home__returning__mini375__s1.png, mini375/offers__returning__mini375__s1.png, mini375/profile__returning__mini375__s1.png. Chưa xác định bong bóng tự tắt sau mấy giây (ảnh chụp lúc nạp xong).
- Trang chủ: thẻ "Đơn 120.000đ chờ chuyển khoản" dồn chữ vào cột hẹp, 4 dòng (nút "Thanh toán ngay" chiếm gần nửa ngang). Ở 1280 thì một dòng, đẹp.
- Chi tiết SP mini375: ảnh vuông chiếm trọn 750px đầu (375 CSS px), giá chỉ thấy ở nửa dưới; chưa lỗi nhưng chỉ lộ tên + giá, thanh đáy che chip "Eco". Ảnh sản phẩm seed trống nên chỉ có lá.
- Chi tiết SP mini1280 (mini1280/product-slug__returning__mini1280__s1.png): ảnh hero cao bằng cả khung 800px, rộng 1280; ở màn đầu KHÔNG thấy tên, giá, mô tả (toàn bộ nằm dưới ảnh). Đây là lỗi bố cục ở khổ rộng (ô trống lớn). Trang chủ 1280 (mini1280/home__returning__mini1280__s1.png): nội dung giãn ngang hết khổ, lưới 8 lối tắt cách nhau rất xa, bong bóng "Trồng cây…" che mép thẻ "Mua lại"; không có khung điện thoại.
- Giỏ hàng: nút trừ ở dòng 2 (SL 1) xám đặc (đang vô hiệu), đúng thiết kế; khoảng trống giữa mã giảm giá và thanh tổng.
- Hạng thành viên (loyalty): khi mở, màn đã cuộn xuống (thẻ "Mua trong Mini App" chạm sát mép trên, thẻ hạng bị che phần đầu), chưa rõ do chụp hay do app giữ vị trí cuộn.
- Chat: khung tin trống lớn giữa màn là bình thường; ô nhập + chip gợi ý chạm đáy sát mép (khoảng 40px xám dưới ô nhập là vùng an toàn).

### error500
- 16/17 màn có thẻ "Chưa tải được trang này" + nút "Thử lại" + dòng gọi 0984 606 774. Tốt, nhất quán.
- Lệch giữa các ảnh: dòng "Cần hỗ trợ? Gọi …" khi cạnh nhau ở product/cart/checkout/orders… (label và số ngang hàng, khoảng cách lớn, icon lệch) còn ở browse-category/recycle/wallet thì xếp hai dòng. Cùng một component, bố cục khác nhau theo bề rộng nội dung.
- browse-search (error500, offline, loading, slow5s): KHÔNG có thông báo lỗi, chỉ "Chưa có gợi ý — nhấn Tìm để xem kết quả"; không có nút thử lại. Lỗi gợi ý bị nuốt im lặng. (Nút "Tìm" vẫn làm được, nên mức nhẹ.)
- Trang chủ error500: thẻ điểm hiện "45.400 điểm" (dữ liệu cũ) kèm "Chưa tải được hạng và điểm - Thử lại"; nút "Điểm danh" xám mờ (vô hiệu); mục "Đổi rác" biến mất khỏi lối tắt (từ 8 còn 6 ô); hai khối "Mua lại", "Ưu đãi giờ vàng" có thử lại riêng. Tốt.
- Cá nhân error500: vẫn hiện "45.400 điểm" và "0đ Ví Tubu" trong khi /me/wallet trả 500 (ô thứ ba "—"). "0đ Ví Tubu" có thể bị đọc là số dư thật. Số đơn hiện "·" (dấu chấm) cho cả 5 tab đơn, không có chữ giải thích.
- Ưu đãi error500: khung lỗi lồng: tiêu đề "Chưa tải được trang này" nhưng dòng dưới "Chưa tải được lịch điểm danh: Máy chủ đang bận, thử lại nhé." (có dấu hai chấm, lặp "Chưa tải được"). Phần còn lại của trang vẫn dùng được.

### offline (mini375)
- Chữ hiện là "Máy chủ đang bận, thử lại nhé." chứ không phải "Mất kết nối. Vui lòng kiểm tra mạng rồi thử lại." (câu này có trong app, thấy ở các ô bị 429 lúc chụp, ví dụ orders/returning, offers/new). Nghĩa là khi mất mạng sau khi trang đã nạp, người dùng đọc lời đổ cho máy chủ. Chưa kiểm vì sao (do cách giả offline là abort request hay do app).
- Hiện thanh đáy + nút thử lại ở 16/17 màn; chỉ browse-search không có.

### longtext (tên 120 ký tự)
- browse-category: chip lọc hạng/nhãn "Bộ sản phẩm làm sạch thân thiện môi trường dàn…" tràn ra mép phải màn hình và bị cắt cụt, không có dấu ba chấm (mini375-longtext/browse-category__returning__mini375-longtext__s1.png). TRÀN.
- profile: nhãn hạng "Bộ sản phẩm làm sạch thân thiện môi trường d…" tràn khỏi khung thẻ, bị cắt ở mép màn (mini375-longtext/profile__returning__mini375-longtext__s1.png); nút "Sửa hồ sơ" bị đẩy xuống dòng. TRÀN (tên hạng 120 ký tự là dữ liệu cực đoan).
- home: lời chào ellipsis đúng; câu "Còn 18,3 triệu mua hàng lên <tên>" xuống 3 dòng, thẻ giãn. Chấp nhận được. Mũi tên ">" ở góc thẻ bị bóp thành chấm nhỏ.
- product-slug, cart, orders: xuống dòng/ellipsis đúng, không tràn.
- Các màn còn lại (affiliate, dealer, game, recycle, wallet, chat, checkout, order-code, loyalty, offers) chưa mở ảnh longtext.

## Lưu ý công cụ
- Khi chạy song song với agent web trên cùng lane 5, 12 ô mini ban đầu dính 429 ở /auth/zalo-mini-app và /auth/guest, trang đợi 60s rồi hiện trạng thái lỗi. Đã xoá các dòng đó khỏi index và chụp lại một lần: 12/12 sạch (recycle-rules/375 phải chạy lại lần hai vì lần đầu lại dính 429).
- Persona của affiliate là ctv và dealer là dealer (capture.mjs chọn persona theo màn), các màn khác là returning.
- wallet/returning/375/error500 mất 62.7s đến khi idle (một lần): dữ liệu vẫn đúng (thẻ lỗi + thử lại), chưa rõ vì sao chậm, chưa lặp lại.
- Index không lưu mức tác động (impact) của axe; kết quả axe chỉ ghi tên rule và số node. Không sửa capture.mjs.
- Đã thêm `tools/summary-mini.mjs` (đọc index-mini*.jsonl, ghi `01-chup-mini.md.gen`); không sửa capture.mjs.
