# U6. Khách trên web (UAT lane 6)

Phạm vi: khách mua hàng trên web ở hai khổ, 390x844 (điện thoại) và 1440x900 (máy tính). Có bốn vai: khách ghé (chưa đăng nhập), `uat_returning` (hạng Lộc Biếc, nhiều đơn, 3 mã giảm giá trong ví), `uat_new` (khách mới, chưa có đơn, chưa có địa chỉ) và `uat_new_nophone` (khách mới chưa có số điện thoại, 4 mã trong ví). Đi qua web thật (`next dev`), API thật của lane, đăng nhập Zalo giả với cookie `tubu_rt` thật. Mini App chạy cạnh để so cùng dữ liệu. Mọi ca có tiền hoặc điểm đều có truy vấn đối chiếu số dư với sổ cái. Luật đã chốt: web chỉ nhận chuyển khoản QR và COD (Q4), web không xác minh số điện thoại (Q2), Điểm Xanh 1 điểm = 1đ, tích 2% tiền hàng sau giảm (không tính phí ship) nhân hệ số hạng, trả tối đa 20% giá trị đơn bằng điểm, điểm hết hạn sau 12 tháng, hoa hồng 8% giữ 10 ngày sau giao.

## Kết quả

<!-- U6-SUMMARY:BEGIN -->
61 ca: **49 PASS / 8 FAIL / 4 BLOCKED**. FAIL: U6-02, U6-09, U6-37, U6-68, U6-73, U6-74, U6-75, U6-80.
<!-- U6-SUMMARY:END -->

## Môi trường

- Lane 6: API 3261, web 3262, Mini App 3263 (để so), giả Pancake 3268. DB `tubutree_uat_l6`, Redis db 6. Dựng bằng `lane-up.sh 6 --web`.
- Bản đang kiểm: nhánh `uat/2026-10-20`, commit `b2a42a53` (nền `05e6ae97`, origin/main). `apps/api/dist` build lúc 2026-10-19 21:58. Web chạy `next dev` từ mã nguồn của nhánh này. Các bản sửa đợt 1–3 của nhánh `uat/int` chưa nằm trong bản này.
- Nhóm B (đăng nhập) chạy web với `NEXT_PUBLIC_ZALO_APP_ID=uat-fake-zalo-app-id` (script `restart-web.sh with-zalo`) để nút Đăng nhập với Zalo hoạt động. Nhóm A chạy ở chế độ mặc định không có biến này (U6-11 ghi cả hai chế độ).
- Cấu hình đổi trong lúc chạy: `waste.enabled` và `waste.rules_text` (nhóm G, đặt lại về `false` và rỗng khi xong). `SystemConfigService` nhớ mỗi khoá 60 giây (`system-config.service.ts`, `ttlMs = 60_000`), nên script chờ quá 60 giây sau mỗi lần đổi.

## Cách chạy lại

```bash
bash docs/2026-10-20-uat/tools/uat-harness/lane-down.sh 6 --drop
bash docs/2026-10-20-uat/tools/uat-harness/lane-up.sh 6 --web
cd docs/2026-10-20-uat/uat/scripts/U6-web-khach
node run-all.mjs                         # a-guest, b-login, c-cart, d-checkout, e-orders, f-account, g-misc, h-layout, i-blocked, reconcile, make-report
ONLY=U6-32,U6-35 node d-checkout.mjs     # chạy lại vài ca; kết quả cũ của ca khác trong cùng file được giữ
node repro/B01-pdp-tran-ngang.mjs        # tái hiện U6-B01
node repro/B02-sap-xep-gia.mjs           # tái hiện U6-B02
bash docs/2026-10-20-uat/tools/uat-harness/lane-down.sh 6
```

Các nhóm ca ghi dữ liệu (đặt đơn, trừ điểm, điểm danh) và dùng chung khách, giỏ, tồn kho, nên chạy tuần tự trên lane sạch. Chạy lại không dựng lại lane thì một số ca đã có trạng thái cũ (ví dụ khách đã đặt đơn đầu), script tự xoá hoặc tự đặt lại phần chạm tới. Script nằm ở `docs/2026-10-20-uat/uat/scripts/U6-web-khach/`, ảnh ở `docs/2026-10-20-uat/uat/shots/U6-web-khach/`, kết quả thô ở `scripts/U6-web-khach/results/*.json`.

## Bảng ca

<!-- U6-TABLE:BEGIN -->
| ID | Vai trò | Hành trình | Bước | Kỳ vọng (theo luật đã chốt) | Thực tế | Bằng chứng | PASS/FAIL/BLOCKED |
|---|---|---|---|---|---|---|---|
| U6-01 | Khách chưa đăng nhập | Duyệt | Mở / ở 390 và 1440; đọc khối Danh mục, Ưu đãi giờ vàng, Bán chạy | Trang 200, không tràn ngang, không request API lỗi, giá giờ vàng = giá flash sale trong DB (BHN-CGL-100 165.000đ, BHN-CW-500 119.000đ, BHN-HN-500 195.000đ) | 14/14 kiểm tra đúng | [U6-01-home-390.png](shots/U6-web-khach/U6-01-home-390.png) [U6-01-home-1440.png](shots/U6-web-khach/U6-01-home-1440.png)<br><code>390 request API: GET /config/public 200; GET /flash-sales/active 200; GET /flash-sales/active 200</code><br><code>1440 request API: GET /config/public 200; GET /flash-sales/active 200; GET /flash-sales/active 200</code><br><code>DB flash_sale_items: [{"sku":"BHN-CGL-100","price":165000},{"sku":"BHN-CW-500","price":119000},{"sku":"BHN-HN-500","price":195000}]</code> | **PASS** |
| U6-02 | Khách chưa đăng nhập | Duyệt | Mở /san-pham; đọc số sản phẩm; sắp xếp Giá tăng / Giá giảm; chọn danh mục | Số sản phẩm = số sản phẩm đang bán trong DB; Giá tăng thì thẻ đầu rẻ nhất; chọn danh mục chỉ còn sản phẩm danh mục đó | 6/10 kiểm tra đúng<br>SAI: 390: Giá tăng sắp đúng thứ tự (20 thẻ đầu) → [25000,75000,79000,79000,85000,89000,89000,75000,95000,95000,79000,99000]<br>390: Giá giảm — thẻ đầu đắt nhất → [329000,345000,289000,295000,290000,195000]<br>1440: Giá tăng sắp đúng thứ tự (20 thẻ đầu) → [25000,75000,79000,79000,85000,89000,89000,75000,95000,95000,79000,99000]<br>1440: Giá giảm — thẻ đầu đắt nhất → [329000,345000,289000,295000,290000,195000] | [U6-02-san-pham-390.png](shots/U6-web-khach/U6-02-san-pham-390.png) [U6-02-san-pham-1440.png](shots/U6-web-khach/U6-02-san-pham-1440.png)<br><code>390 giá sau Giá tăng: 25000,75000,79000,79000,85000,89000,89000,75000,95000,95000,79000,99000</code><br><code>1440 giá sau Giá tăng: 25000,75000,79000,79000,85000,89000,89000,75000,95000,95000,79000,99000</code> | **FAIL** |
| U6-03 | Khách chưa đăng nhập | Tìm | Gõ "cà phê", "ca phe" (không dấu), chuỗi vô nghĩa vào ô tìm | Có dấu và không dấu đều ra đủ sản phẩm có "cà phê" trong tên (4 trong DB lane); chuỗi vô nghĩa ra trạng thái rỗng, không lỗi | 12/12 kiểm tra đúng | [U6-03-tim-ca-phe-390.png](shots/U6-web-khach/U6-03-tim-ca-phe-390.png) [U6-03-tim-rong-390.png](shots/U6-web-khach/U6-03-tim-rong-390.png) [U6-03-tim-ca-phe-1440.png](shots/U6-web-khach/U6-03-tim-ca-phe-1440.png) [U6-03-tim-rong-1440.png](shots/U6-web-khach/U6-03-tim-rong-1440.png)<br><code>số sản phẩm có "cà phê" trong tên (DB, bỏ dấu): 4</code> | **PASS** |
| U6-04 | Khách chưa đăng nhập | Chi tiết SP | GET HTML thô (không chạy JS) /san-pham/serum-duong-am-visante; xem title, canonical, JSON-LD, nội dung | HTML thô đã có tên SP, giá, mô tả, JSON-LD Product có offers.price khớp giá trong DB; canonical không kèm ?ref= | 7/7 kiểm tra đúng | <code>JSON-LD: {"@context":"https://schema.org","@type":"Product","name":"Serum dưỡng ẩm Visante","url":"http://localhost:326…</code><br><code>giá DB: {"sale":289000,"retail":320000}</code> | **PASS** |
| U6-05 | Khách chưa đăng nhập | Chi tiết SP | Mở PDP Cao cà gai leo (giờ vàng) và Serum (2 biến thể), đổi biến thể | Giờ vàng 165.000đ (-25% so 220.000đ); Serum 30ml 289.000đ, đổi 50ml thì 460.000đ; đếm ngược giờ vàng hiện | 12/12 kiểm tra đúng | [U6-05-pdp-flash-390.png](shots/U6-web-khach/U6-05-pdp-flash-390.png) [U6-05-pdp-serum-390.png](shots/U6-web-khach/U6-05-pdp-serum-390.png) [U6-05-pdp-flash-1440.png](shots/U6-web-khach/U6-05-pdp-flash-1440.png) [U6-05-pdp-serum-1440.png](shots/U6-web-khach/U6-05-pdp-serum-1440.png) | **PASS** |
| U6-06 | Khách chưa đăng nhập | Giỏ | Mở PDP nước rửa tay, bấm "Thêm vào giỏ" | Chuyển sang /dang-nhap kèm returnTo về PDP; giỏ chưa bị tạo trên server (không có request POST /cart/items) | 6/6 kiểm tra đúng | [U6-06-them-gio-khach-390.png](shots/U6-web-khach/U6-06-them-gio-khach-390.png) [U6-06-them-gio-khach-1440.png](shots/U6-web-khach/U6-06-them-gio-khach-1440.png) | **PASS** |
| U6-07 | Khách chưa đăng nhập | Gian hàng | GET HTML thô /s/uatctv (đã duyệt), /s/uatctvpending (chờ duyệt), /s/khongco; mở /s/uatctv ở 390 và 1440 | Gian hàng đã duyệt 200, HTML thô có tên gian hàng + sản phẩm; chờ duyệt và không tồn tại đều 404 (storefront.require_approval bật) | 8/8 kiểm tra đúng | [U6-07-gian-hang-390.png](shots/U6-web-khach/U6-07-gian-hang-390.png) [U6-07-gian-hang-1440.png](shots/U6-web-khach/U6-07-gian-hang-1440.png)<br><code>sản phẩm gian hàng trong DB: [{"name":"Cao cà gai leo BH.Nong"},{"name":"Hạt điều rang mộc BH.Nong"},{"name":"Mật ong rừng nguyên chất BH.N…</code><br><code>390 chữ: Tìm sản phẩm Đăng nhập G Đã được Tubu Tree duyệt Góc Xanh Của Phạm CTV CTV tuyển chọn 🌱 Tân binh Xem sản phẩm…</code><br><code>1440 chữ: Tìm sản phẩm Trang chủ Danh mục Vườn Xanh Đơn hàng Cá nhân Đăng nhập G Đã được Tubu Tree duyệt Góc Xanh Của Ph…</code> | **PASS** |
| U6-08 | Khách chưa đăng nhập | Nhãn hàng | GET /brand/fuwa3e khi nhãn chưa đăng (404), admin đăng nhãn (PATCH /admin/brands/:id), mở lại ở 390 và 1440 | Chưa đăng thì 404; đăng rồi 200, HTML thô có tên nhãn + sản phẩm Fuwa3e; trang không tràn ngang | 9/9 kiểm tra đúng | [U6-08-brand-390.png](shots/U6-web-khach/U6-08-brand-390.png) [U6-08-brand-1440.png](shots/U6-web-khach/U6-08-brand-1440.png)<br><code>trước khi đăng: API /brand/public/fuwa3e, web bỏ cache, web qua Data Cache: {"api":404,"web":404,"webCached":200}</code> | **PASS** |
| U6-09 | Khách chưa đăng nhập | Trang tĩnh | Mở /gioi-thieu, /cau-chuyen, /chinh-sach/{dieu-khoan,bao-mat,doi-tra,van-chuyen} | Mọi trang 200, không còn chỗ trống chưa điền "[Tên công ty]", "[số ngày]" (đã biết D8-5: chủ tự điền) | 8/12 kiểm tra đúng<br>SAI: /chinh-sach/dieu-khoan không còn chỗ trống [..] (đã biết D8-5, chủ tự điền) → ["[Tên công ty]","[Mã số thuế]","[Địa chỉ trụ sở]"]<br>/chinh-sach/bao-mat không còn chỗ trống [..] (đã biết D8-5, chủ tự điền) → ["[Tên công ty]","[Mã số thuế]","[Địa chỉ trụ sở]"]<br>/chinh-sach/doi-tra không còn chỗ trống [..] (đã biết D8-5, chủ tự điền) → ["[số ngày làm việc]","[Tên công ty]","[Mã số thuế]","[Địa chỉ trụ sở]"]<br>/chinh-sach/van-chuyen không còn chỗ trống [..] (đã biết D8-5, chủ tự điền) → ["[số ngày]","[Tên công ty]","[Mã số thuế]","[Địa chỉ trụ sở]"] | [U6-09-chinh-sach-doi-tra-390.png](shots/U6-web-khach/U6-09-chinh-sach-doi-tra-390.png) | **FAIL** |
| U6-10 | Khách chưa đăng nhập | Cổng đăng nhập | Mở các trang riêng tư khi chưa đăng nhập | Mỗi trang hiện lời mời đăng nhập (không trắng trang, không lộ dữ liệu), có liên kết /dang-nhap?returnTo=<trang>; không gọi API riêng tư | 30/30 kiểm tra đúng | [U6-10-cong-dang-nhap-gio-hang-390.png](shots/U6-web-khach/U6-10-cong-dang-nhap-gio-hang-390.png) [U6-10-cong-dang-nhap-tai-khoan-390.png](shots/U6-web-khach/U6-10-cong-dang-nhap-tai-khoan-390.png) [U6-10-cong-dang-nhap-vuon-xanh-390.png](shots/U6-web-khach/U6-10-cong-dang-nhap-vuon-xanh-390.png) | **PASS** |
| U6-11 | Khách chưa đăng nhập | Đăng nhập | Mở /dang-nhap?returnTo=/gio-hang ở 390 và 1440 | Có nút "Đăng nhập với Zalo", liên kết Điều khoản/Bảo mật, nút quay lại; khi build thiếu Zalo App ID thì nói rõ "tạm ngưng" kèm hotline thay vì để khách bấm gặp lỗi | 6/6 kiểm tra đúng | [U6-11-dang-nhap-390.png](shots/U6-web-khach/U6-11-dang-nhap-390.png) [U6-11-dang-nhap-1440.png](shots/U6-web-khach/U6-11-dang-nhap-1440.png)<br><code>390 chế độ web: có NEXT_PUBLIC_ZALO_APP_ID: nút Đăng nhập với Zalo</code><br><code>390 chữ: Tìm sản phẩm Đăng nhập Tubu Tree Đăng nhập để mua sắm, tích Điểm Xanh và đồng bộ giỏ hàng với Zalo Mini App. …</code><br><code>1440 chế độ web: có NEXT_PUBLIC_ZALO_APP_ID: nút Đăng nhập với Zalo</code> | **PASS** |
| U6-12 | Khách chưa đăng nhập | Đăng nhập | Mở /dang-nhap?returnTo=/gio-hang , bấm "Đăng nhập với Zalo" (chạy ở 390 và 1440px) | Trình duyệt đi tới oauth.zaloapp.com với app_id, redirect_uri=<web>/dang-nhap/callback, code_challenge (PKCE) và state ngẫu nhiên; state/verifier lưu ở sessionStorage | 14/14 kiểm tra đúng | [U6-12-390-dang-nhap-bam-390.png](shots/U6-web-khach/U6-12-390-dang-nhap-bam-390.png) [U6-12-1440-dang-nhap-bam-1440.png](shots/U6-web-khach/U6-12-1440-dang-nhap-bam-1440.png)<br><code>URL OAuth (rút gọn): https://oauth.zaloapp.com/v4/permission?app_id=uat-fake-zalo-app-id&redirect_uri=http%3A%2F%2Flocalhost%3A3262…</code><br><code>URL OAuth (rút gọn): https://oauth.zaloapp.com/v4/permission?app_id=uat-fake-zalo-app-id&redirect_uri=http%3A%2F%2Flocalhost%3A3262…</code> | **PASS** |
| U6-13 | Khách chưa đăng nhập | Đăng nhập | Trang /dang-nhap/callback  với lỗi Zalo, thiếu code, sai state, và gọi thật /auth/zalo-oauth (API lane không có khoá Zalo) (chạy ở 390 và 1440px) | Mỗi trường hợp hiện câu tiếng Việt dễ hiểu (không chuỗi kỹ thuật/stack), có nút "Đăng nhập lại" hoặc "Thử lại" và "Về trang chủ"; không bao giờ kẹt ở "Đang đăng nhập…" | 24/24 kiểm tra đúng | [U6-13-390-callback-loi-api-390.png](shots/U6-web-khach/U6-13-390-callback-loi-api-390.png) [U6-13-1440-callback-loi-api-1440.png](shots/U6-web-khach/U6-13-1440-callback-loi-api-1440.png)<br><code>POST /auth/zalo-oauth thật: {"method":"POST","path":"/auth/zalo-oauth","status":401}</code><br><code>POST /auth/zalo-oauth thật: {"method":"POST","path":"/auth/zalo-oauth","status":401}</code> | **PASS** |
| U6-14 | Khách → khách quay lại (uat_returning) | Đăng nhập | Bấm đăng nhập, callback đúng state (đổi code do bộ khung giả, token do API lane cấp), vào /gio-hang , tải lại, đăng xuất (chạy ở 390 và 1440px) | Về đúng returnTo=/gio-hang, đã đăng nhập (tên trên header), cookie tubu_rt HttpOnly; tải lại vẫn đăng nhập; đăng xuất thì refresh token bị thu hồi trong DB và cookie cũ không dùng lại được (401) | 26/26 kiểm tra đúng | [U6-14-390-da-dang-nhap-390.png](shots/U6-web-khach/U6-14-390-da-dang-nhap-390.png) [U6-14-390-sau-dang-xuat-390.png](shots/U6-web-khach/U6-14-390-sau-dang-xuat-390.png) [U6-14-1440-da-dang-nhap-1440.png](shots/U6-web-khach/U6-14-1440-da-dang-nhap-1440.png) [U6-14-1440-sau-dang-xuat-1440.png](shots/U6-web-khach/U6-14-1440-sau-dang-xuat-1440.png)<br><code>cookie tubu_rt: {"httpOnly":true,"sameSite":"Lax","path":"/api/auth","secure":false}</code><br><code>refresh_tokens của cookie cũ: [{"revoked":true}]</code><br><code>refresh token còn sống của uat_returning sau đăng xuất (mọi thiết bị): [{"n":0}]</code> | **PASS** |
| U6-15 | Khách → khách mới (uat_new) | Đăng nhập + Giỏ | Chưa đăng nhập bấm "Thêm vào giỏ" ở PDP nước rửa tay , đăng nhập xong (chạy ở 390 và 1440px) | Quay lại đúng PDP và món đã chọn tự vào giỏ (server: cart_items có 1 dòng FUWA-HW-500 × 1); không bị cộng đôi | 6/6 kiểm tra đúng | [U6-15-390-them-gio-sau-dang-nhap-390.png](shots/U6-web-khach/U6-15-390-them-gio-sau-dang-nhap-390.png) [U6-15-1440-them-gio-sau-dang-nhap-1440.png](shots/U6-web-khach/U6-15-1440-them-gio-sau-dang-nhap-1440.png)<br><code>giỏ server: [{"sku":"500ml","qty":1}]</code><br><code>giỏ server: [{"sku":"500ml","qty":1}]</code> | **PASS** |
| U6-16 | Khách chưa đăng nhập | Bảo mật đăng nhập | Callback đúng state nhưng returnTo độc hại (https://evil.example, //evil.example, /\evil) ghi vào sessionStorage  (chạy ở 390 và 1440px) | Đăng nhập xong luôn ở trên localhost:3262 (về "/" nếu returnTo không hợp lệ), không bao giờ chuyển ra domain ngoài | 6/6 kiểm tra đúng |  | **PASS** |
| U6-17 | Khách quay lại | Phiên | Phiên hết hạn: thu hồi refresh token trong DB rồi mở /tai-khoan  (chạy ở 390 và 1440px) | Web nhận 401 từ /auth/refresh, xoá cờ phiên và coi là khách (lời mời đăng nhập), không treo ở "Đang tải" và không lặp request vô hạn | 8/8 kiểm tra đúng | [U6-17-390-phien-het-han-390.png](shots/U6-web-khach/U6-17-390-phien-het-han-390.png) [U6-17-1440-phien-het-han-1440.png](shots/U6-web-khach/U6-17-1440-phien-het-han-1440.png)<br><code>refresh khi phiên chết: [{"method":"POST","path":"/auth/refresh","status":401}]</code><br><code>refresh khi phiên chết: [{"method":"POST","path":"/auth/refresh","status":401}]</code> | **PASS** |
| U6-20 | Khách quay lại (Lộc Biếc) | Giỏ | PDP nước rửa tay : Thêm vào giỏ ×1 rồi ×2 nữa; mở /gio-hang (chạy ở 390 và 1440px) | Giỏ chỉ có 1 dòng FUWA-HW-500 số lượng 3 (gộp dòng), thành tiền 267.000đ = 3 × 89.000đ; DB cart_items khớp; badge giỏ ở header hiện 3; thông báo "Đã thêm vào giỏ!" | 18/18 kiểm tra đúng | [U6-20-390-pdp-da-them-390.png](shots/U6-web-khach/U6-20-390-pdp-da-them-390.png) [U6-20-390-gio-hang-390.png](shots/U6-web-khach/U6-20-390-gio-hang-390.png) [U6-20-1440-pdp-da-them-1440.png](shots/U6-web-khach/U6-20-1440-pdp-da-them-1440.png) [U6-20-1440-gio-hang-1440.png](shots/U6-web-khach/U6-20-1440-gio-hang-1440.png)<br><code>DB cart_items: [{"sku":"FUWA-HW-500","qty":3,"retail":89000,"sale":null}]</code><br><code>DB cart_items: [{"sku":"FUWA-HW-500","qty":3,"retail":89000,"sale":null}]</code> | **PASS** |
| U6-21 | Khách quay lại (Lộc Biếc) | Giỏ | Giỏ có 2 dòng (nước rửa tay ×1, dầu tràm bé ×2) : bấm Tăng, Giảm, Xoá rồi Hoàn tác (chạy ở 390 và 1440px) | Mỗi thao tác cập nhật server ngay (DB khớp); tạm tính = Σ đơn giá × số lượng; Giảm ở 1 không xuống 0; Xoá có thanh "Đã bỏ khỏi giỏ" và Hoàn tác trả lại đúng dòng/số lượng | 16/16 kiểm tra đúng | [U6-21-390-xoa-hoan-tac-390.png](shots/U6-web-khach/U6-21-390-xoa-hoan-tac-390.png) [U6-21-1440-xoa-hoan-tac-1440.png](shots/U6-web-khach/U6-21-1440-xoa-hoan-tac-1440.png) | **PASS** |
| U6-22 | Khách quay lại (Lộc Biếc) | Giỏ | Tồn kho: đặt tồn VIS-SR-50 = 3 (SQL); PDP Serum 50ml tăng số lượng quá tồn; thêm giỏ; rồi tồn về 0 khi đã ở giỏ  (chạy ở 390 và 1440px) | PDP nhắc "Chỉ còn 3", bộ đếm không vượt 3; thêm quá tồn bị từ chối bằng thông báo; khi tồn về 0 giỏ chặn thanh toán kèm lời giải thích và nút Thanh toán khoá; PDP hết hàng hiện "Hết hàng" | 14/14 kiểm tra đúng | [U6-22-390-het-hang-trong-gio-390.png](shots/U6-web-khach/U6-22-390-het-hang-trong-gio-390.png) [U6-22-390-pdp-het-hang-390.png](shots/U6-web-khach/U6-22-390-pdp-het-hang-390.png) [U6-22-1440-het-hang-trong-gio-1440.png](shots/U6-web-khach/U6-22-1440-het-hang-trong-gio-1440.png) [U6-22-1440-pdp-het-hang-1440.png](shots/U6-web-khach/U6-22-1440-pdp-het-hang-1440.png)<br><code>lời từ chối: {"message":"Chỉ còn 3 sản phẩm trong kho.","error":"Bad Request","statusCode":400}</code><br><code>lời từ chối: {"message":"Chỉ còn 3 sản phẩm trong kho.","error":"Bad Request","statusCode":400}</code> | **PASS** |
| U6-23 | Khách quay lại (Lộc Biếc) | Giỏ | Giờ vàng trong giỏ: thêm Cao cà gai leo (flash 165.000đ, mỗi người tối đa 2) ×1 rồi cố thêm tới 3  (chạy ở 390 và 1440px) | Giỏ tính 165.000đ/chiếc (không phải 220.000đ), thành tiền 165.000đ; khi vượt giới hạn 2 chiếc giờ vàng/người thì có lời nhắc rõ "giảm còn 2 để được giá giờ vàng, hoặc mua 3 với giá thường" và cả dòng tính giá thường (660.000đ) | 12/12 kiểm tra đúng | [U6-23-390-gio-gio-vang-390.png](shots/U6-web-khach/U6-23-390-gio-gio-vang-390.png) [U6-23-390-gio-vuot-gioi-han-gio-vang-390.png](shots/U6-web-khach/U6-23-390-gio-vuot-gioi-han-gio-vang-390.png) [U6-23-1440-gio-gio-vang-1440.png](shots/U6-web-khach/U6-23-1440-gio-gio-vang-1440.png) [U6-23-1440-gio-vuot-gioi-han-gio-vang-1440.png](shots/U6-web-khach/U6-23-1440-gio-vuot-gioi-han-gio-vang-1440.png)<br><code>giới hạn giờ vàng của khách: {"lim":2,"quota_left":49,"bought":1,"allow":1}</code><br><code>giỏ khi có 3 chiếc: {"qty":3,"unitPrice":220000,"total":660000,"limitNotice":"Giá giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn. …</code><br><code>giới hạn giờ vàng của khách: {"lim":2,"quota_left":49,"bought":1,"allow":1}</code> | **PASS** |
| U6-24 | Khách quay lại (Lộc Biếc) | Giỏ | Thêm 2 món bằng web (nước rửa tay ×2, serum 30ml ×1); mở Mini App /cart cùng tài khoản; đổi số lượng trên Mini App rồi tải lại web | Mini App và web cùng giỏ: cùng 2 dòng, cùng số lượng, cùng tạm tính; đổi bên này thì bên kia thấy sau khi tải lại | 4/4 kiểm tra đúng | [U6-24-mini-gio-hang.png](shots/U6-web-khach/U6-24-mini-gio-hang.png)<br><code>tạm tính theo API: 467000</code><br><code>chữ Mini App /cart: Giỏ hàng \| Chọn tất cả \| Chọn Nước rửa tay sinh học Fuwa3e \| Nước rửa tay sinh học Fuwa3e \| 500ml \| 89.000đ \| …</code><br><code>DB sau khi bấm + trên Mini App: [{"sku":"FUWA-HW-500","qty":3,"retail":89000,"sale":null},{"sku":"VIS-SR-30","qty":1,"retail":320000,"sale":28…</code> | **PASS** |
| U6-30 | Khách quay lại (Lộc Biếc, 34.400 điểm) | Thanh toán COD | Thêm nước rửa tay ×2 (178.000đ) → /gio-hang → Thanh toán → COD → Đặt hàng ; Pancake báo giao xong; đối chiếu sổ điểm (chạy ở 390 và 1440px) | Báo giá: tạm tính 178.000đ, ship Miễn phí (Lộc Biếc freeship từ 99.000đ), tổng 178.000đ, +4.272 điểm (178.000 × 2% × 1,2). Đơn COD CONFIRMED, tổng DB = báo giá, tồn kho được giữ, giả Pancake nhận đơn cod=178.000, giỏ sạch; sau giao: đúng 1 dòng sổ ORDER_DELIVERED:<mã> +4.272, pointsBalance = trước + 4.272 = SUM(sổ) | 37/37 kiểm tra đúng | [U6-30-390-thanh-toan-cod-390.png](shots/U6-web-khach/U6-30-390-thanh-toan-cod-390.png) [U6-30-390-dat-hang-thanh-cong-390.png](shots/U6-web-khach/U6-30-390-dat-hang-thanh-cong-390.png) [U6-30-390-chi-tiet-don-cod-390.png](shots/U6-web-khach/U6-30-390-chi-tiet-don-cod-390.png) [U6-30-390-diem-xanh-sau-giao-390.png](shots/U6-web-khach/U6-30-390-diem-xanh-sau-giao-390.png)<br><code>sổ điểm trước: {"balance":34400,"ledgerSum":34400,"rows":1}</code><br><code>tồn trước: {"stock":260,"reserved":0}</code><br><code>báo giá: {"subtotal":178000,"shippingFee":0,"total":178000,"pointsEarned":4272}</code><br>SQL: <code>SELECT code,status,"paymentMethod","paymentStatus",subtotal,"shippingFee",total,"pointsEarned" FROM orders WHERE code=$1; SELECT v.sku,oi.quantity,oi."unitPrice",oi.total FROM order_items oi JOIN variations v ON v.id=oi."variationId" WHERE oi."orderId"=…; SELECT stock,"reservedStock" FROM variations WHERE sku='FUWA-HW-500'; SELECT delta,reason FROM points_transactions WHERE "userId"='uat_returning' AND reason LIKE 'O…</code> | **PASS** |
| U6-31 | Khách quay lại (Lộc Biếc) | Điểm Xanh khi thanh toán | Giỏ nước rửa chén 1L (120.000đ) → Thanh toán → tick "Bạn có … Điểm Xanh" → Đặt hàng COD → vào đơn bấm Huỷ đơn  | Điểm dùng = min(điểm dùng được, 20% × 120.000 = 24.000); tổng giảm đúng số đó; DB: orders.pointsUsed=24.000, sổ có dòng −24.000, pointsBalance giảm đúng 24.000 = SUM(sổ); huỷ đơn thì hoàn lại +24.000 (sổ + số dư) và trả tồn kho | 16/16 kiểm tra đúng | [U6-31-dung-diem.png](shots/U6-web-khach/U6-31-dung-diem.png) [U6-31-huy-don-hoi-lai.png](shots/U6-web-khach/U6-31-huy-don-hoi-lai.png) [U6-31-sau-huy-don.png](shots/U6-web-khach/U6-31-sau-huy-don.png)<br><code>/me/loyalty: {"rates":{"earnPct":2,"vndPerPoint":50,"vndPerPointRedeem":1,"maxRedeemPct":0.2},"pointsBalance":38672,"expiri…</code><br><code>báo giá khi dùng điểm: {"subtotal":120000,"shippingFee":0,"pointsUsed":24000,"pointsDiscount":24000,"total":96000,"pointsEarned":2304…</code><br><code>orders: {"code":"TUBU2026101955822","status":"CONFIRMED","paymentMethod":"COD","paymentStatus":"UNPAID","subtotal":120…</code><br>SQL: <code>SELECT "pointsUsed","pointsDiscount",total FROM orders WHERE code=$1; SELECT delta,reason FROM points_transactions WHERE "userId"=… AND reason LIKE '%<mã>%'; SELECT "pointsBalance" vs SUM(delta) trước đặt / sau đặt / sau huỷ; SELECT stock,"reservedStock" FROM variations WHERE sku='FUWA-DW-1L'</code> | **PASS** |
| U6-32 | Khách quay lại (Lộc Biếc) | Voucher | Giỏ Vitamin C Visante (329.000đ): mã sai, WELCOME30, XANH10; đặt đơn với XANH10; huỷ đơn;  | Mã sai báo lỗi dễ hiểu; WELCOME30 −30.000đ; XANH10 −10% tối đa 50.000đ = −32.900đ; đơn lưu couponCode/couponDiscount đúng; huỷ đơn trả lại mã dùng được | 11/11 kiểm tra đúng | [U6-32-ma-sai.png](shots/U6-web-khach/U6-32-ma-sai.png) [U6-32-welcome30.png](shots/U6-web-khach/U6-32-welcome30.png)<br><code>lời báo mã sai: Mã giảm giá Bạn có 3 mã Mã giảm giá Áp dụng WELCOME30 Giảm 30.000đ Giảm 30.000đ cho đơn này Đơn tối thiểu 199.…</code><br><code>báo giá XANH10: {"subtotal":329000,"discount":32900,"total":296100,"shipping":0}</code><br><code>orders: {"code":"TUBU2026101977733","status":"CONFIRMED","paymentMethod":"COD","paymentStatus":"UNPAID","subtotal":329…</code><br>SQL: <code>SELECT "couponCode","couponDiscount",subtotal,"shippingFee",total FROM orders WHERE code=$1; SELECT r.id FROM coupon_redemptions r JOIN coupons c ON c.id=r."couponId" WHERE c.code='XANH10' AND r."userId"='uat_returning' (sau đặt = 1 dòng, sau huỷ = 0 dòng)</code> | **PASS** |
| U6-33 | Khách mới (uat_new, chưa đơn, chưa có địa chỉ) | Chuyển khoản QR | Giỏ 199.000đ (Pơ Lang tinh dầu 110.000 + dầu tràm bé 89.000): thêm địa chỉ trong form thanh toán (thử bỏ trống/SĐT sai), áp mã HOPSAN, chọn Chuyển khoản, Đặt hàng; QR; ngân hàng: sai nội dung, chuyển thiếu, chuyển đủ; giao xong  | Form địa chỉ báo từng ô sai; HOPSAN −30.000đ (đơn từ 199.000đ, khách mới); trang QR: STK 8386790906, CONG TY TNHH TUBU TREE, Techcombank, nội dung = mã đơn, số tiền = tổng đơn; sai nội dung/thiếu tiền không lên PAID; đủ tiền thì PAID và trang tự cập nhật "Đã nhận thanh toán!"; điểm sau giao = 2% × tiền hàng sau giảm × 1 (Mầm Xanh) | 33/33 kiểm tra đúng | [U6-33-dia-chi-loi-bo-trong.png](shots/U6-web-khach/U6-33-dia-chi-loi-bo-trong.png) [U6-33-hopsan-ap-dung.png](shots/U6-web-khach/U6-33-hopsan-ap-dung.png) [U6-33-qr-cho-thanh-toan.png](shots/U6-web-khach/U6-33-qr-cho-thanh-toan.png) [U6-33-qr-da-nhan-tien.png](shots/U6-web-khach/U6-33-qr-da-nhan-tien.png)<br><code>lỗi khi bỏ trống: Thêm địa chỉ mới Người nhận Nhập tên người nhận. Số điện thoại Nhập số điện thoại. Chọn tỉnh/thành Thành p…</code><br><code>DB addresses: [{"recipient":"Lê Thu Mới","phone":"0901000001","province":"Thành phố Hồ Chí Minh","ward":"Phường Bến Thành","…</code><br><code>báo giá chưa mã: {"subtotal":199000,"shippingFee":0,"total":199000,"pointsEarned":3980}</code><br>SQL: <code>SELECT recipient,street,"isDefault" FROM addresses WHERE "userId"='uat_new'; SELECT status,"paymentStatus","paidAt","couponCode","couponDiscount",total FROM orders WHERE code=$1 (trước/sau từng khoản CK); SELECT delta,reason FROM points_transactions WHERE reason LIKE 'ORDER_DELIVERED:<mã>%' (= +3.380); SELECT "usedCount","usageLimit" FROM coupons WHERE code=<HOPSAN-…></code> | **PASS** |
| U6-34 | Khách quay lại (Lộc Biếc) | Chống đặt trùng | Giỏ 1 sản phẩm; bấm "Đặt hàng" hai lần trong cùng một tick (bấm đúp/mạng chậm)  | Chỉ tạo đúng 1 đơn (DB đếm theo user + thời điểm), tồn kho chỉ giữ 1 lần, điểm/mã không bị trừ hai lần | 3/3 kiểm tra đúng | <code>số request place-order trình duyệt gửi: ["2008c1d3-785a-47d7-a773-59156a6a64f6","2008c1d3-785a-47d7-a773-59156a6a64f6","2008c1d3-785a-47d7-a773-59156a…</code><br><code>đơn trước/sau: {"n0":4,"n1":5}</code> | **PASS** |
| U6-35 | Khách mới chưa từng đặt (uat_new_nophone, không SĐT) và khách quay lại | Phí vận chuyển | Báo giá cho giỏ: (khách mới) 199.000 / 110.000; (Lộc Biếc) 110.000 / 89.000; đọc dòng "Phí vận chuyển" trên trang thanh toán  | Khách mới đơn đầu: từ 199.000đ miễn phí, dưới đó 19.000đ; Lộc Biếc: freeship từ 99.000đ (shipping.tier_freeship_overrides), dưới đó 19.000đ; trang hiển thị đúng số của báo giá; khách không có SĐT vẫn đặt được trên web (Q2) | 9/9 kiểm tra đúng | [U6-35-ship-19k-khach-moi-khong-sdt.png](shots/U6-web-khach/U6-35-ship-19k-khach-moi-khong-sdt.png)<br><code>số đơn cũ của uat_new_nophone: 0</code><br>SQL: <code>POST /checkout/quote (oracle) + so với dòng "Phí vận chuyển" trên trang: SELECT count(*) FROM orders WHERE "userId"='uat_new_nophone' (=0: đơn đầu)</code> | **PASS** |
| U6-36 | Khách quay lại (Lộc Biếc) | Hết hàng khi thanh toán | Mở trang thanh toán với 2 chiếc nước lau kính; đặt tồn FUWA-GL-500 = 1 (SQL); bấm Đặt hàng  | Không tạo đơn; trang báo "còn lại 1 sản phẩm"/hết hàng bằng câu dễ hiểu kèm nút "Về giỏ hàng để sửa"; DB không có đơn mới, tồn không âm | 5/5 kiểm tra đúng | [U6-36-het-hang-khi-dat.png](shots/U6-web-khach/U6-36-het-hang-khi-dat.png)<br><code>phản hồi place-order: {"status":400,"body":{"message":"Sản phẩm \"Nước lau kính enzyme Fuwa3e\" không đủ tồn kho.","error":"Bad Requ…</code><br>SQL: <code>SELECT count(*) FROM orders WHERE "userId"=… (không đổi); SELECT stock,"reservedStock" FROM variations WHERE sku='FUWA-GL-500'</code> | **PASS** |
| U6-37 | Khách quay lại (Lộc Biếc) | Phương thức thanh toán | Mở /thanh-toan với 1 sản phẩm, liệt kê các lựa chọn thanh toán (390 và 1440px) | Q4: web chỉ có chuyển khoản QR + COD (không ZaloPay, không cổng khác) | 2/4 kiểm tra đúng<br>SAI: 390: chỉ 2 phương thức theo Q4 (không có Ví Tubu/ZaloPay) → ["Thanh toán khi nhận hàng (COD)","Chuyển khoản ngân hàng","Ví Tubu (0đ)"]<br>1440: chỉ 2 phương thức theo Q4 (không có Ví Tubu/ZaloPay) → ["Thanh toán khi nhận hàng (COD)","Chuyển khoản ngân hàng","Ví Tubu (0đ)"] | [U6-37-phuong-thuc-390.png](shots/U6-web-khach/U6-37-phuong-thuc-390.png) [U6-37-phuong-thuc-1440.png](shots/U6-web-khach/U6-37-phuong-thuc-1440.png)<br><code>390: các lựa chọn thanh toán: ["Thanh toán khi nhận hàng (COD)","Chuyển khoản ngân hàng","Ví Tubu (0đ)"]</code><br><code>1440: các lựa chọn thanh toán: ["Thanh toán khi nhận hàng (COD)","Chuyển khoản ngân hàng","Ví Tubu (0đ)"]</code> | **FAIL** |
| U6-38 | Khách quay lại (Lộc Biếc) | Ví Tubu | Cấp ví 200.000đ cho uat_returning (SQL + dòng wallet_transactions); đặt đơn 89.000đ bằng Ví Tubu trên web ; huỷ đơn | Ví trừ đúng tổng đơn, có dòng wallet_transactions; đơn PAID; huỷ đơn hoàn tiền về ví; walletBalance = SUM(wallet_transactions) | 7/7 kiểm tra đúng | <code>cột wallet_transactions: id,userId,delta,balanceAfter,type,refType,refId,reason,createdAt</code><br><code>orders: {"code":"TUBU2026101916657","status":"CONFIRMED","paymentMethod":"WALLET","paymentStatus":"PAID","subtotal":89…</code><br><code>wallet_transactions: [{"id":"cmvfgxxob017wo4t37ul3uqkf","userId":"uat_returning","delta":-108000,"balanceAfter":92000,"type":"ORDER…</code><br>SQL: <code>SELECT "paymentMethod","paymentStatus",total FROM orders WHERE code=$1; SELECT "walletBalance" FROM users WHERE id='uat_returning' (200.000 → 200.000 − tổng → hoàn lại 200.000); SELECT delta,type,reason FROM wallet_transactions WHERE "userId"=… ORDER BY "createdAt" DESC</code> | **PASS** |
| U6-39 | Khách quay lại mua qua gian hàng /s/uatctv | Gian hàng CTV | Mở /s/uatctv rồi thêm sản phẩm, thanh toán COD ; giao xong; xem hoa hồng của CTV | Đơn gắn storefrontSlug=uatctv và referrer = CTV; sau giao có dòng hoa hồng của uat_ctv = 8% tiền hàng (sau giảm), giữ 10 ngày (chưa rút được) | 7/7 kiểm tra đúng | <code>gian hàng: Tìm sản phẩm N Lại G Đã được Tubu Tree duyệt Góc Xanh Của Phạm CTV CTV tuyển chọn 🌱 Tân binh Xem sản phẩm Gi…</code><br><code>báo giá: {"subtotal":165000,"total":165000}</code><br><code>orders: {"code":"TUBU2026101927562","status":"CONFIRMED","paymentMethod":"COD","paymentStatus":"UNPAID","subtotal":165…</code><br>SQL: <code>SELECT "storefrontSlug","referrerUserId" FROM orders WHERE code=$1; SELECT "affiliateUserId","commissionableTotal",rate,amount,status FROM commissions WHERE "orderId"=…</code> | **PASS** |
| U6-50 | Khách quay lại | Danh sách đơn | Mở /tai-khoan/don-hang, bấm lần lượt từng tab trạng thái  (chạy ở 390 và 1440px) | Mỗi tab chỉ hiện đúng các đơn thuộc nhóm đó (DB là chuẩn): Chờ thanh toán=PENDING_PAYMENT, Đang xử lý=CONFIRMED/PACKED, Đang giao=SHIPPING, Đã giao=DELIVERED, Đã hủy/hoàn=CANCELLED/RETURNED; thẻ đơn có mã, chip trạng thái, số món, tổng tiền khớp DB; không tràn ngang | 24/24 kiểm tra đúng | [U6-50-390-danh-sach-tat-ca.png](shots/U6-web-khach/U6-50-390-danh-sach-tat-ca.png) [U6-50-1440-danh-sach-tat-ca.png](shots/U6-web-khach/U6-50-1440-danh-sach-tat-ca.png)<br><code>đơn trong DB: ["TUBU2026101974406:CANCELLED","TUBU2026101987058:DELIVERED","TUBU2026101916410:SHIPPING","TUBU2026101949443:C…</code><br><code>đơn trong DB: ["TUBU2026101974406:CANCELLED","TUBU2026101987058:DELIVERED","TUBU2026101916410:SHIPPING","TUBU2026101949443:C…</code> | **PASS** |
| U6-51 | Khách quay lại | Tìm đơn | Mở /tai-khoan, gõ mã đơn / tên sản phẩm / chuỗi lạ vào ô "Mã đơn hoặc tên sản phẩm"  | Mã đơn: đúng 1 đơn; tên sản phẩm: chỉ đơn có sản phẩm đó; chuỗi lạ: thông báo không có đơn; nút "Xóa tìm kiếm" quay về danh sách | 4/4 kiểm tra đúng | [U6-51-tim-cobote.png](shots/U6-web-khach/U6-51-tim-cobote.png)<br><code>tìm "Cobote": {"got":["TUBU2026101974406","TUBU2026101949443","TUBU2026101981919","TUBU2026101976168","TUBU2026101991795","T…</code> | **PASS** |
| U6-52 | Khách quay lại | Chi tiết đơn | Mở chi tiết 4 đơn: chờ chuyển khoản, COD đã xác nhận, đang giao (có mã vận đơn), đã giao  (chạy ở 390 và 1440px) | Chip trạng thái đúng; tạm tính/ship/tổng khớp DB; phương thức + tình trạng thanh toán đúng; sản phẩm × số lượng × đơn giá khớp; đơn chờ chuyển khoản hiện khung QR; đơn đang giao hiện đơn vị vận chuyển + mã vận đơn; đơn đã giao hiện "Viết đánh giá" + "Mua lại đơn này"; không tràn ngang | 90/90 kiểm tra đúng | [U6-52-390-chi-tiet-bank.png](shots/U6-web-khach/U6-52-390-chi-tiet-bank.png) [U6-52-390-chi-tiet-cod.png](shots/U6-web-khach/U6-52-390-chi-tiet-cod.png) [U6-52-390-chi-tiet-ship.png](shots/U6-web-khach/U6-52-390-chi-tiet-ship.png) [U6-52-390-chi-tiet-dlv.png](shots/U6-web-khach/U6-52-390-chi-tiet-dlv.png) | **PASS** |
| U6-53 | Khách quay lại | Huỷ đơn | Huỷ đơn COD (bấm "Giữ đơn" trước, rồi Hủy); huỷ đơn chuyển khoản chưa trả; gọi API huỷ đơn đang giao/đã giao/đơn của người khác  | Giữ đơn thì đơn giữ nguyên; huỷ xong đơn CANCELLED, tồn kho trả lại, đơn trên giả Pancake cũng huỷ, mục "Đã hủy/hoàn" hiện đơn; chuyển khoản chưa trả có cảnh báo "vừa chuyển khoản…"; API từ chối huỷ đơn đang giao và đã giao; đơn người khác trả 404 (IDOR) | 18/18 kiểm tra đúng | [U6-53-hop-xac-nhan-huy.png](shots/U6-web-khach/U6-53-hop-xac-nhan-huy.png) [U6-53-da-huy-cod.png](shots/U6-web-khach/U6-53-da-huy-cod.png) [U6-53-huy-chuyen-khoan-chua-tra.png](shots/U6-web-khach/U6-53-huy-chuyen-khoan-chua-tra.png) [U6-53-idor-khach-khac.png](shots/U6-web-khach/U6-53-idor-khach-khac.png)<br><code>đơn trên giả Pancake sau huỷ: {"id":"9700024","status":6,"status_name":"Đã hủy"}</code><br><code>huỷ đơn đang giao qua API: {"status":400,"body":{"message":"Đơn đã vào quy trình giao, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để …</code> | **PASS** |
| U6-54 | Khách quay lại | Huỷ đơn đã trả + hoàn ví | Đặt đơn chuyển khoản 110.000đ, giả ngân hàng chuyển đủ (PAID), vào chi tiết huỷ đơn, chọn hoàn về Ví Tubu  | Hộp huỷ cho chọn nơi nhận tiền (Ví Tubu / ngân hàng); chọn Ví → đơn CANCELLED, paymentStatus REFUNDED, ví cộng đúng tổng đơn, có dòng wallet_transactions, walletBalance = SUM(sổ ví); tồn kho trả lại | 10/10 kiểm tra đúng | [U6-54-huy-da-tra-chon-noi-hoan.png](shots/U6-web-khach/U6-54-huy-da-tra-chon-noi-hoan.png) [U6-54-vi-tubu-sau-hoan.png](shots/U6-web-khach/U6-54-vi-tubu-sau-hoan.png)<br><code>orders sau huỷ: {"code":"TUBU2026102098229","status":"CANCELLED","pm":"BANK_TRANSFER","ps":"REFUNDED","subtotal":110000,"disco…</code><br><code>wallet_transactions mới nhất: [{"delta":110000,"type":"ORDER_REFUND","reason":"Hoàn tiền đơn TUBU2026102098229","balanceAfter":110000},{"del…</code><br>SQL: <code>SELECT status,"paymentStatus",total FROM orders WHERE code=$1; SELECT "walletBalance" FROM users …; SELECT SUM(delta) FROM wallet_transactions WHERE "userId"=…; SELECT delta,type,reason,"balanceAfter" FROM wallet_transactions ORDER BY "createdAt" DESC LIMIT 3</code> | **PASS** |
| U6-55 | Khách quay lại | Sau giao hàng | Từ đơn đã giao: bấm "Mua lại đơn này" → giỏ; "Viết đánh giá"; "Yêu cầu đổi/trả" (gửi trống để thấy lỗi, rồi chọn dòng + lý do)  | Mua lại đưa đúng sản phẩm/số lượng vào giỏ (DB cart_items); Viết đánh giá mở trang sản phẩm đúng; gửi trống báo lỗi; gửi đủ tạo return_requests REQUESTED đúng đơn + dòng + số lượng, thẻ trạng thái "đang chờ" hiện, nút gửi lại biến mất | 10/10 kiểm tra đúng | [U6-55-mua-lai-sheet.png](shots/U6-web-khach/U6-55-mua-lai-sheet.png) [U6-55-danh-gia.png](shots/U6-web-khach/U6-55-danh-gia.png) [U6-55-doi-tra-loi-trong.png](shots/U6-web-khach/U6-55-doi-tra-loi-trong.png) [U6-55-doi-tra-da-gui.png](shots/U6-web-khach/U6-55-doi-tra-da-gui.png)<br><code>bảng Mua lại: Tìm sản phẩm N Lại ← Đơn hàng của tôi Đơn hàng #TUBU2026101987058 Đã giao Giao lúc 00:15 20/10/2026 Hành trình…</code><br><code>giỏ sau Mua lại: [{"sku":"FUWA-HW-500","qty":1,"retail":89000,"sale":null},{"sku":"POLANG-LG-10","qty":1,"retail":110000,"sale"…</code><br><code>liên kết đánh giá: /san-pham/nuoc-rua-tay-fuwa3e?danh-gia=cmvfimenq03hso4t384pc7kup#danh-gia</code> | **PASS** |
| U6-56 | Khách quay lại | So sánh web ↔ Mini App | Mở /orders và /order/:code trên Mini App (cùng dữ liệu) rồi đối chiếu với web  | Cùng danh sách mã đơn, cùng tổng tiền và cùng trạng thái ở danh sách; chi tiết cùng tổng, ship, phương thức, mã vận đơn | 5/5 kiểm tra đúng | [U6-56-web-chi-tiet-dang-giao.png](shots/U6-web-khach/U6-56-web-chi-tiet-dang-giao.png)<br><code>mã đơn web: ["TUBU2026101911614","TUBU2026101912055","TUBU2026101913944","TUBU2026101916410","TUBU2026101916657","TUBU2026…</code><br><code>mã đơn Mini App: ["TUBU2026101911614","TUBU2026101912055","TUBU2026101913944","TUBU2026101916410","TUBU2026101916657","TUBU2026…</code> | **PASS** |
| U6-60 | Khách quay lại (Lộc Biếc) | Hub Tài khoản | Mở /tai-khoan, đối chiếu từng con số với DB, mở từng mục menu  (chạy ở 390 và 1440px) | Điểm Xanh = users.pointsBalance + pointsConvertedBalance; Ví Tubu = users.walletBalance; số mã giảm giá = GET /me/coupons; mã giới thiệu = users.referralCode; tên + hạng đúng DB; "Đơn hàng của tôi (N)" = số đơn DB; mỗi mục menu mở được không lỗi; không tràn ngang; cùng số với Mini App /profile | 22/22 kiểm tra đúng | [U6-60-390-hub-390.png](shots/U6-web-khach/U6-60-390-hub-390.png) [U6-60-1440-hub-1440.png](shots/U6-web-khach/U6-60-1440-hub-1440.png)<br><code>DB: {"pb":67512,"pc":0,"wb":0,"rc":"UATRETURNING","fn":"Nguyễn Thị Quay Lại","t":"LOC_BIEC","coupons":4,"nOrders":…</code><br><code>các liên kết trên hub: ["/","/tai-khoan/ho-so","/tai-khoan/diem-xanh","/tai-khoan/vi-tubu","/mua-chung","/doi-rac","/tai-khoan/yeu-th…</code><br><code>DB: {"pb":67512,"pc":0,"wb":0,"rc":"UATRETURNING","fn":"Nguyễn Thị Quay Lại","t":"LOC_BIEC","coupons":4,"nOrders":…</code> | **PASS** |
| U6-61 | Khách mới chưa có SĐT (uat_new_nophone) | Sửa hồ sơ | Mở /tai-khoan/ho-so; nhập email sai → báo lỗi; nhập tên + email + ngày sinh hợp lệ → Lưu; tải lại; thử sửa ngày sinh lần hai  | Email sai: lỗi "Email không hợp lệ" và nút Lưu khoá; lưu đúng → users.fullName/email/dob cập nhật; ngày sinh chỉ đặt một lần (ô khoá sau khi có); SĐT hiển thị "Chưa có số điện thoại" và không sửa được ở đây | 7/7 kiểm tra đúng | [U6-61-ho-so-email-sai.png](shots/U6-web-khach/U6-61-ho-so-email-sai.png) [U6-61-ho-so-da-luu.png](shots/U6-web-khach/U6-61-ho-so-da-luu.png)<br><code>trước: {"fn":"Trần Chưa Số","email":null,"dob":null}</code><br><code>lưu hồ sơ: {"method":"PATCH","status":200,"url":"http://localhost:3261/api/me"}</code><br><code>sau: {"fn":"Trần Chưa Số Đã Sửa","email":"uat.nophone@example.com","dob":"1995-03-14T00:00:00.000Z"}</code> | **PASS** |
| U6-62 | Khách quay lại (Lộc Biếc) | Điểm Xanh | Mở /tai-khoan/diem-xanh và đối chiếu sổ điểm với DB  (chạy ở 390 và 1440px) | Tổng điểm = pointsBalance; "điểm đang chờ" = lockedPoints của /me/loyalty; điểm sắp hết hạn + ngày = lô sớm nhất trong DB; mỗi dòng lịch sử (số điểm có dấu, ngày, "Hết hạn" = +12 tháng) khớp points_transactions; "Còn X triệu để lên hạng" khớp spent12m; danh sách mã giảm giá = /me/coupons; cùng nội dung với Mini App | 25/25 kiểm tra đúng | [U6-62-390-diem-xanh-390.png](shots/U6-web-khach/U6-62-390-diem-xanh-390.png) [U6-62-1440-diem-xanh-1440.png](shots/U6-web-khach/U6-62-1440-diem-xanh-1440.png)<br><code>loyalty: {"pointsBalance":52184,"lockedPoints":17784,"lockedUntil":"2026-10-26T16:48:15.752Z","redeemable":34400,"expir…</code><br><code>lô điểm sớm hết hạn nhất (DB): 2027-09-09T15:27:58.918Z</code><br><code>lịch sử trên trang: [-24000,3960,4272,4776,4776,24000,34400]</code><br>SQL: <code>SELECT delta,reason,"expiresAt","createdAt" FROM points_transactions WHERE "userId"='uat_returning' ORDER BY "createdAt" DESC LIMIT 100; SELECT "pointsBalance" vs SUM(delta) lot='STANDARD'; GET /me/loyalty (lockedPoints, expiringPoints)</code> | **PASS** |
| U6-63 | Khách mới chưa có SĐT (uat_new_nophone) | Điểm danh Điểm Xanh | Mở /tai-khoan/diem-xanh, bấm "Điểm danh +1000", bấm lại  | Lần đầu: +1.000 điểm (ngày 1 của chu kỳ), 1 dòng sổ + loyalty_check_ins (dayKey hôm nay, cycleDay 1, streak 1), pointsBalance tăng đúng 1.000 = SUM(sổ), nút chuyển "đã điểm danh"; bấm lần hai không cộng thêm (DB không đổi). Q2: web không bắt xác minh SĐT để điểm danh | 6/6 kiểm tra đúng | [U6-63-diem-danh-xong.png](shots/U6-web-khach/U6-63-diem-danh-xong.png)<br><code>POST điểm danh: {"status":201,"body":{"success":true,"cycleDay":1,"streakDays":1,"pointsEarned":1000,"totalPoints":1000,"messa…</code><br><code>loyalty_check_ins: [{"cd":1,"sd":1,"p":1000,"dk":"2026-10-19"}]</code><br><code>điểm danh lần 2 qua API: {"status":400,"body":{"message":"Hôm nay bạn đã điểm danh nhận điểm rồi 🌿","error":"Bad Request","statusCode"…</code><br>SQL: <code>SELECT "cycleDay","streakDays",points,"dayKey" FROM loyalty_check_ins WHERE "userId"='uat_new_nophone'; SELECT "pointsBalance" vs SUM(delta) trước/sau; lần 2: COUNT(*) vẫn 1</code> | **PASS** |
| U6-64 | Khách mới chưa có SĐT (uat_new_nophone) | Ví Tubu | Cấp ví 150.000đ bằng SQL + 1 dòng sổ ví; mở /tai-khoan/vi-tubu; bấm "Rút ngân hàng" (390 và 1440px) | Số dư = walletBalance = SUM(wallet_transactions); lịch sử hiện đúng dòng +150.000đ; "Rút ngân hàng" khách chưa có SĐT được hướng dẫn rõ (không lỗi trắng); không có chữ "xu" | 11/11 kiểm tra đúng | [U6-64-vi-tubu-390.png](shots/U6-web-khach/U6-64-vi-tubu-390.png) [U6-64-vi-tubu-rut.png](shots/U6-web-khach/U6-64-vi-tubu-rut.png) [U6-64-vi-tubu-1440.png](shots/U6-web-khach/U6-64-vi-tubu-1440.png)<br><code>sau khi bấm Rút ngân hàng: Tìm sản phẩm 1 T Số ← Tài khoản Ví Tubu Ví Tubu (số dư khả dụng) 150.000đ Rút ngân hàng Số dư dùng để thanh t…</code><br>SQL: <code>SELECT "walletBalance" FROM users …; SELECT COALESCE(SUM(delta),0) FROM wallet_transactions WHERE "userId"=…</code> | **PASS** |
| U6-65 | Khách quay lại + khách chưa đăng nhập | Sản phẩm yêu thích | Khách ghé: bấm tim trên PDP → mời đăng nhập; khách đăng nhập: bấm tim → /tai-khoan/yeu-thich có sản phẩm; bỏ tim → trống  | Khách ghé bị đưa tới /dang-nhap có returnTo; khách đăng nhập: wishlists có dòng đúng productId, trang yêu thích hiện sản phẩm, bỏ tim thì dòng DB mất | 7/7 kiểm tra đúng | [U6-65-yeu-thich-co.png](shots/U6-web-khach/U6-65-yeu-thich-co.png) | **PASS** |
| U6-66 | Khách quay lại | Thông báo | Mở /tai-khoan/thong-bao; so với GET /me/notifications; "Đọc tất cả"; bấm một thông báo đơn hàng  | Danh sách = API (mới nhất trước), thông báo đơn hàng có mã đơn; "Đọc tất cả" đặt mọi dòng thành READ (notification_logs.status) và số chưa đọc ở menu/hub về 0; bấm thông báo đơn dẫn tới chi tiết đơn đó | 7/7 kiểm tra đúng | [U6-66-thong-bao.png](shots/U6-web-khach/U6-66-thong-bao.png) [U6-66-thong-bao-chi-tiet.png](shots/U6-web-khach/U6-66-thong-bao-chi-tiet.png)<br><code>API: {"total":44,"unread":0,"first":{"code":"ORDER_CANCELLED","body":"Đơn TUBU2026101943165 đã bị hủy."}}</code><br><code>badge hub trước: 0</code><br><code>notification_logs theo trạng thái: []</code> | **PASS** |
| U6-67 | Khách quay lại | Cài đặt | Mở /tai-khoan/cai-dat; tắt "Khuyến mãi & mã giảm giá"; đổi cỡ chữ Lớn; tải lại  | Công tắc lưu vào users.notifyPromo (DB) và còn nguyên sau tải lại; "Cập nhật đơn hàng" luôn bật và không tắt được; cỡ chữ đổi ngay cỡ chữ gốc của trang và nhớ sau tải lại; trang không có chữ "xu" | 8/8 kiểm tra đúng | [U6-67-cai-dat-co-chu-lon.png](shots/U6-web-khach/U6-67-cai-dat-co-chu-lon.png)<br><code>cỡ chữ gốc: {"trước":"16px","sau":"18px"}</code> | **PASS** |
| U6-68 | Khách mới chưa có SĐT (uat_new_nophone) | Sổ địa chỉ | Thêm 2 địa chỉ, đặt địa chỉ thứ hai làm mặc định, sửa đường, xoá địa chỉ  | Mỗi thao tác khớp DB: địa chỉ đầu tiên tự là mặc định; chọn mặc định chuyển cờ isDefault duy nhất; sửa lưu đúng; xoá địa chỉ mặc định thì còn lại địa chỉ khác được chọn làm mặc định hoặc báo rõ; luôn có tối đa 1 mặc định | 4/5 kiểm tra đúng<br>SAI: địa chỉ còn lại tự thành mặc định (không để khách mất mặc định) → [{"recipient":"Nhà A","d":false}] | [U6-68-dia-chi-2.png](shots/U6-web-khach/U6-68-dia-chi-2.png) [U6-68-dia-chi-sau-xoa.png](shots/U6-web-khach/U6-68-dia-chi-sau-xoa.png)<br><code>trạng thái trống: Sổ địa chỉ Bạn chưa lưu địa chỉ nào. Thêm địa chỉ để thanh toán nhanh hơn. + Thêm địa chỉ mới Sống xanh An …</code><br><code>DB sau khi thêm 2: [{"recipient":"Nhà A","street":"1 Đường A","d":true},{"recipient":"Nhà B","street":"2 Đường B","d":false}]</code><br><code>hộp xoá (Nhà B đang là mặc định): Tìm sản phẩm T Số ← Tài khoản Sổ địa chỉ Nhà B · 0901000099 Mặc định 2 Đường B, Phường Bến Thành, Thành phố H…</code> | **FAIL** |
| U6-70 | Khách quay lại + khách chưa đăng nhập | Cộng đồng | Khách ghé mở /cong-dong rồi bấm "Đăng bài"; khách đăng nhập: đăng bài Hỏi đáp, mở bài, thích, bình luận, xoá bài  | Khách ghé xem được feed nhưng "Đăng bài" đưa tới đăng nhập; đăng bài tạo feed_posts (userId, kind, body, status hiển thị); thích tăng likeCount + feed_reactions đúng 1 dòng, bỏ thích về 0; bình luận tạo feed_comments; xoá bài làm bài biến mất khỏi feed | 11/11 kiểm tra đúng | [U6-70-khach-bam-dang-bai.png](shots/U6-web-khach/U6-70-khach-bam-dang-bai.png) [U6-70-soan-bai.png](shots/U6-web-khach/U6-70-soan-bai.png) [U6-70-bai-viet.png](shots/U6-web-khach/U6-70-bai-viet.png) [U6-70-bai-viet-binh-luan.png](shots/U6-web-khach/U6-70-bai-viet-binh-luan.png)<br><code>GET /feed không token: 401</code><br><code>POST đăng bài: {"status":201,"body":"{\"id\":\"cmvfyo2yw04lqo4t3ih5pwlvi\",\"status\":\"PUBLISHED\"}"}</code><br><code>feed_posts: {"id":"cmvfyo2yw04lqo4t3ih5pwlvi","kind":"QUESTION","status":"PUBLISHED","body":"UAT web: bé nhà mình 4 tháng …</code> | **PASS** |
| U6-71 | Khách quay lại | Xếp hạng + sự kiện | Mở /cong-dong/xep-hang và /cong-dong/su-kien ở 390 và 1440px | Hai trang mở được, không lỗi API, không tràn ngang, trạng thái trống có câu hướng dẫn | 8/8 kiểm tra đúng | [U6-71-xep-hang-390.png](shots/U6-web-khach/U6-71-xep-hang-390.png) [U6-71-su-kien-390.png](shots/U6-web-khach/U6-71-su-kien-390.png) [U6-71-xep-hang-1440.png](shots/U6-web-khach/U6-71-xep-hang-1440.png) [U6-71-su-kien-1440.png](shots/U6-web-khach/U6-71-su-kien-1440.png) | **PASS** |
| U6-72 | Khách mới chưa có SĐT (uat_new_nophone) | Vườn Xanh | Mở /vuon-xanh; điểm danh; điểm danh lần hai; tưới cây khi chưa đủ giọt nước; góp quỹ khi chưa đủ điểm; trả lời quiz  | Điểm danh lần đầu cộng giọt nước + game_profiles.streakDays=1; lần hai bị chặn (DB không đổi); tưới cây thiếu giọt báo rõ không trừ; góp quỹ thiếu điểm báo rõ không trừ điểm; quiz ghi đúng 1 lượt/ngày (game_quiz_attempts) | 9/9 kiểm tra đúng | [U6-72-vuon-xanh-dau.png](shots/U6-web-khach/U6-72-vuon-xanh-dau.png) [U6-72-tuoi-cay-thieu-giot.png](shots/U6-web-khach/U6-72-tuoi-cay-thieu-giot.png) [U6-72-gop-quy-thieu-diem.png](shots/U6-web-khach/U6-72-gop-quy-thieu-diem.png)<br><code>trước: {"gp0":{"sd":0},"user0":{"coins":0},"pts0":{"balance":1000,"ledgerSum":1000,"rows":1}}</code><br><code>POST điểm danh Vườn Xanh: {"status":201,"body":"{\"seedsEarned\":10,\"pointsEarned\":0,\"streakDays\":1,\"totalSeeds\":10,\"streakFrozeU…</code><br><code>sau điểm danh: {"gp1":{"sd":1},"user1":{"coins":10}}</code> | **PASS** |
| U6-73 | Khách quay lại + khách ghé | Đổi rác | waste.enabled=false: mở /doi-rac và /doi-rac/tao; bật waste.enabled + đặt thể lệ có "khoảng ngày": mở /doi-rac, /doi-rac/quy-dinh (đăng nhập và chưa đăng nhập), so với Mini App  | Tắt: "Chương trình đang tạm dừng" và không vào được trang tạo; bật: điểm hiển thị khớp /me/loyalty, bảng món + quy đổi khớp cấu hình (carton 1.000 điểm, vỏ chai Tubu 2.000 điểm…); thể lệ hiện cho CẢ khách ghé (trang công khai) với chữ "khoảng ngày"; cùng nội dung với Mini App /recycle | 11/13 kiểm tra đúng<br>SAI: thể lệ công khai: khách ghé đọc được nội dung có "khoảng ngày" → Tìm sản phẩm Đăng nhập Thể lệ Đổi rác lấy quà Unauthorized Thử lại Sống xanh An Lành — mỹ phẩm và đồ tiêu dùng thiên nhiên tuyển chọn từ các thương hiệu Việt…<br>trang thể lệ không phát sinh request lỗi 401/403 → ["GET /waste/rules 401"] | [U6-73-doi-rac-tam-dung.png](shots/U6-web-khach/U6-73-doi-rac-tam-dung.png) [U6-73-doi-rac-bat.png](shots/U6-web-khach/U6-73-doi-rac-bat.png) [U6-73-quy-dinh-khach.png](shots/U6-web-khach/U6-73-quy-dinh-khach.png) [U6-73-quy-dinh-dang-nhap.png](shots/U6-web-khach/U6-73-quy-dinh-dang-nhap.png)<br><code>thể lệ cho khách ghé: {"text":"Tìm sản phẩm\nĐăng nhập\nThể lệ Đổi rác lấy quà\n\nUnauthorized\n\nThử lại\n\nSống xanh An Lành — mỹ …</code> | **FAIL** |
| U6-74 | Khách chưa có SĐT (uat_new_nophone) so với khách đã xác minh | Thông báo mở Mini App (Q2) | Khi chương trình đổi rác bật: mở /doi-rac, /doi-rac/tao, /doi-rac/diem-nhan, /doi-rac/yeu-cau bằng khách không SĐT và khách có SĐT  | Khách không SĐT thấy câu "Tính năng này cần mở Tubu Tree trên Zalo." thay vì chức năng; khách có SĐT dùng được; khách không SĐT vẫn mua hàng và điểm danh được trên web (Q2: web không bắt xác minh) | 7/8 kiểm tra đúng<br>SAI: /doi-rac/yeu-cau: khách KHÔNG SĐT thấy "cần mở Tubu Tree trên Zalo" → Tìm sản phẩm T Số Yêu cầu của tôi Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà. Thử lại Sống xanh An Lành — mỹ phẩm và đồ tiêu dùng thiên nhiên tuyể… | [U6-74-q2-doi-rac-tao.png](shots/U6-web-khach/U6-74-q2-doi-rac-tao.png) [U6-74-q2-doi-rac-yeu-cau.png](shots/U6-web-khach/U6-74-q2-doi-rac-yeu-cau.png) [U6-74-q2-doi-rac.png](shots/U6-web-khach/U6-74-q2-doi-rac.png)<br><code>/doi-rac khách không SĐT: Tìm sản phẩm T Số Đổi rác lấy quà Tính năng này cần mở Tubu Tree trên Zalo. Sống xanh An Lành — mỹ phẩm và đ…</code><br><code>/doi-rac/tao khách không SĐT: Tìm sản phẩm T Số Đổi rác Bước 1/3: Chọn món Tính năng này cần mở Tubu Tree trên Zalo. Sống xanh An Lành — m…</code><br><code>/doi-rac/diem-nhan khách không SĐT: Tìm sản phẩm T Số Đổi rác Bước 1/3: Chọn món Tính năng này cần mở Tubu Tree trên Zalo. Sống xanh An Lành — m…</code> | **FAIL** |
| U6-75 | Khách quay lại (CUSTOMER) | Phân quyền | Mở /admin, /nhan-vien, /nhan-vien/bang-luong, /hoc-vien, /chu-thuong-hieu trên web; gọi API quản trị/nhân viên/CTV bằng token khách  | Web: câu từ chối dễ hiểu, không lộ dữ liệu, không trang trắng; API: /admin/*, /staff/* trả 403, không trả dữ liệu người khác | 12/13 kiểm tra đúng<br>SAI: /hoc-vien (CTV Academy): khách thường thấy lời mời/giải thích, không phải lỗi thô "Bạn không có quyền truy cập tài nguyên này" kèm nút Thử lại → Tìm sản phẩm N Lại CTV Academy Học kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày Bạn không có quyền truy cập tài nguyên này. Thử lại Sống xanh An Lành — mỹ phẩ… | [U6-75-hoc-vien-khach-thuong.png](shots/U6-web-khach/U6-75-hoc-vien-khach-thuong.png)<br><code>/hoc-vien với khách thường: {"text":"Tìm sản phẩm\nN\nLại\nCTV Academy\nHọc kỹ năng bán hàng, làm CTV giỏi hơn mỗi ngày\n\nBạn không có qu…</code> | **FAIL** |
| U6-76 | Khách quay lại, khách mới, khách ghé | Trang lỗi và IDOR | Mở sản phẩm/gian hàng/đơn không tồn tại; khách khác mở trang QR chuyển khoản của đơn người khác; khách ghé mở QR  | Trang 404 thân thiện có đường quay về; trang QR của đơn người khác trả 404 và KHÔNG lộ STK/số tiền/mã đơn; khách ghé bị mời đăng nhập | 6/6 kiểm tra đúng | [U6-76-404-san-pham.png](shots/U6-web-khach/U6-76-404-san-pham.png) [U6-76-idor-qr.png](shots/U6-web-khach/U6-76-idor-qr.png)<br><code>khách ghé gọi QR: 0</code> | **PASS** |
| U6-80 | khách ghé | Quét bố cục | Mở 22 trang chính (khách quay lại thêm chi tiết đơn từng trạng thái và trang QR chuyển khoản), đo scrollWidth so với khổ máy 390px và đếm lỗi console/request  (chạy ở 390 và 1440px) | Không trang nào tràn ngang (scrollWidth ≤ khổ máy), không lỗi console ngoài nhiễu đã biết, không request 5xx/lỗi mạng | 16/18 kiểm tra đúng<br>SAI: không trang nào tràn ngang (28 trang) → [{"page":"/san-pham/dau-tram-be-cobote","sw":465,"device":390,"culprits":["div.relative aspect-square overflow-hidden rounded-sheet border border-sto w=448","di…<br>không trang nào tràn ngang (22 trang) → [{"page":"/san-pham/dau-tram-be-cobote","sw":461,"device":390,"culprits":["div.relative aspect-square overflow-hidden rounded-sheet border border-sto w=445","di… | [U6-80-returning-390-pdp-tran-ngang.png](shots/U6-web-khach/U6-80-returning-390-pdp-tran-ngang.png) [U6-80-new_nophone-390-pdp-tran-ngang.png](shots/U6-web-khach/U6-80-new_nophone-390-pdp-tran-ngang.png)<br><code>trang tràn ngang: []</code><br><code>lỗi console/trang: []</code><br><code>request 5xx: []</code> | **FAIL** |
| U6-90 | Toàn bộ khách UAT (uat_returning, uat_new, uat_new_nophone) | Đối chiếu sổ điểm / ví / tổng đơn | Chạy truy vấn đối chiếu trên DB lane 6 sau khi mọi nhóm ca đã chạy | users.pointsBalance = SUM(points_transactions lô STANDARD); users.walletBalance = SUM(wallet_transactions) (khi có dòng sổ ví); mỗi đơn: tổng = tạm tính − giảm + phí ship, giảm = mã + combo + hạng + Điểm Xanh, tổng dòng hàng = tạm tính; đơn đã giao: điểm = làm tròn xuống (2% × tiền hàng sau giảm × hệ số hạng); mỗi đơn có mã còn hiệu lực có đúng 1 dòng coupon_redemptions; hoa hồng = 8% tiền hàng tính hoa hồng | 10/10 kiểm tra đúng | <code>khoảng cách giao → khoá/duyệt hoa hồng (ngày): {"lockedAt":"2026-10-19T16:28:53.842Z","approvedAt":null,"days":1.8518518518518518e-7,"status":"LOCKED"}</code><br><code>số truy vấn đối chiếu: 10</code><br>SQL: <code>xem results/reconcile-queries.json (mọi truy vấn + kết quả)</code> | **PASS** |
| U6-95 | Khách mới | Đăng nhập Zalo thật | Đăng nhập web bằng tài khoản Zalo thật qua OAuth của Zalo, lần đầu: tạo khách mới | Khách mới được tạo với zaloId thật, tên và ảnh đại diện lấy từ Zalo; lần sau vào lại đúng tài khoản | 0/0 kiểm tra đúng<br>BLOCKED: Cần ứng dụng Zalo thật, tài khoản Zalo thật và địa chỉ gọi lại đã đăng ký với Zalo. Lane chỉ có Zalo giả (nhóm B đã kiểm vòng đăng nhập, làm mới phiên, đăng xuất và các đường lỗi trên Zalo giả). Việc tạo khách mới qua OAuth thật cần người thật thử trên máy chủ chạy thật. | <code>cấu hình lane: ["ZALO_APP_SECRET=(có giá trị giả, không ghi ra)","NEXT_PUBLIC_ZALO_APP_ID=uat-fake-zalo-app-id (nhóm B) hoặc …</code> | **BLOCKED** |
| U6-96 | Khách quay lại | Chuyển khoản thật | Chuyển tiền thật tới CONG TY TNHH TUBU TREE, 8386790906, Techcombank, đúng nội dung mã đơn; chờ ngân hàng báo về | Đơn tự chuyển sang đã trả khi tiền về đúng số, đúng nội dung; thiếu tiền thì chưa trả | 0/0 kiểm tra đúng<br>BLOCKED: Không có tiền thật chạy qua tài khoản và không có nhà cung cấp đối soát thật trong lane. Phần xử lý của API đã được kiểm bằng webhook giả (U6-33: sai nội dung, chuyển thiếu, chuyển đủ). Cần thử một khoản chuyển khoản nhỏ thật trước khi mở khách. | <code>webhook ngân hàng: bank-webhook.mjs (UAT) gọi đường webhook thật của API với chữ ký giả của lane</code> | **BLOCKED** |
| U6-97 | Khách quay lại | Pancake thật | Đặt đơn thật để Pancake nhận đơn, in vận đơn, báo trạng thái giao thật | Đơn sang Pancake đúng sản phẩm, số lượng, địa chỉ, tiền thu hộ; trạng thái từ Pancake về web đúng | 0/0 kiểm tra đúng<br>BLOCKED: Khoá Pancake thật chưa có (đã ghi nhận: khoá điền khi deploy). Lane dùng Pancake giả ở cổng 3268; đơn sang Pancake giả và các trạng thái vận chuyển được kiểm ở nhóm D, E. | <code>cấu hình lane: ["http://127.0.0.1:3268/api/v1","PANCAKE_SHOP_ID=uatshop6","PANCAKE_API_KEY=(có giá trị giả, không ghi ra)"]</code> | **BLOCKED** |
| U6-98 | Khách quay lại | Gomdon, Zalo OA, ZaloPay | Chọn thu gom rác tận nhà (Gomdon); nhận tin Zalo OA khi đơn đổi trạng thái; trả bằng ZaloPay | Gomdon nhận yêu cầu; tin OA đến máy khách; ZaloPay không xuất hiện ở web (Q4: web chỉ nhận chuyển khoản và COD) | 0/0 kiểm tra đúng<br>BLOCKED: Không có tài khoản Gomdon, OA và ZaloPay thật; đường thu gom tận nhà đang tắt trong cấu hình mặc định. Web phải chỉ nhận chuyển khoản và COD theo Q4; thực tế còn hiện Ví Tubu (xem U6-37). | <code>cấu hình lane: ["http://127.0.0.1:3268/gomdon-disabled","ZALO_OA_ACCESS_TOKEN=(có giá trị giả, không ghi ra)","waste.lane_pic…</code> | **BLOCKED** |
<!-- U6-TABLE:END -->

## Đối chiếu tiền và điểm (U6-90)

Chạy sau khi mọi nhóm ca đã chạy, trên toàn bộ dữ liệu của ba khách UAT. Mỗi truy vấn kèm kết quả đúng như script in ra (`results/reconcile-queries.json`).

<!-- U6-RECON:BEGIN -->
**R1. Số dư điểm = tổng sổ điểm (lô STANDARD)**

```sql
SELECT u.id, u."pointsBalance"::int AS balance, COALESCE(SUM(p.delta) FILTER (WHERE p.lot = 'STANDARD'), 0)::int AS ledger_sum, COUNT(p.id)::int AS rows FROM users u LEFT JOIN points_transactions p ON p."userId" = u.id WHERE u.id = ANY($1) GROUP BY u.id ORDER BY u.id
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (3 dòng):

```json
[{"id":"uat_new","balance":3380,"ledger_sum":3380,"rows":1},{"id":"uat_new_nophone","balance":1000,"ledger_sum":1000,"rows":1},{"id":"uat_returning","balance":67512,"ledger_sum":67512,"rows":11}]
```

**R2. Số dư ví = tổng sổ ví**

```sql
SELECT u.id, u."walletBalance"::int AS balance, COALESCE(SUM(w.delta), 0)::int AS ledger_sum, COUNT(w.id)::int AS rows FROM users u LEFT JOIN wallet_transactions w ON w."userId" = u.id WHERE u.id = ANY($1) GROUP BY u.id ORDER BY u.id
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (3 dòng):

```json
[{"id":"uat_new","balance":0,"ledger_sum":0,"rows":0},{"id":"uat_new_nophone","balance":0,"ledger_sum":0,"rows":0},{"id":"uat_returning","balance":0,"ledger_sum":0,"rows":7}]
```

**R3. Đơn có tổng ≠ tạm tính − giảm + phí ship (bỏ đơn mẫu cũ)**

```sql
SELECT code, status, subtotal::int, discount::int, "shippingFee"::int AS fee, total::int, (subtotal - discount + "shippingFee")::int AS expected FROM orders WHERE "userId" = ANY($1) AND total <> subtotal - discount + "shippingFee" ORDER BY "createdAt"
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (0 dòng):

```json
[]
```

**R4. Đơn có giảm ≠ mã + combo + hạng + Điểm Xanh**

```sql
SELECT code, discount::int, ("couponDiscount" + "comboDiscount" + "tierDiscount" + "pointsDiscount")::int AS parts FROM orders WHERE "userId" = ANY($1) AND discount <> "couponDiscount" + "comboDiscount" + "tierDiscount" + "pointsDiscount"
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (0 dòng):

```json
[]
```

**R5. Đơn có tổng dòng hàng ≠ tạm tính**

```sql
SELECT o.code, o.subtotal::int, SUM(oi.total)::int AS items_sum FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE o."userId" = ANY($1) GROUP BY o.id HAVING SUM(oi.total) <> o.subtotal
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (0 dòng):

```json
[]
```

**R6. Điểm tích của đơn đã giao trong đợt UAT (từ 2026-10-19): so với công thức 2% × tiền hàng sau giảm × hệ số hạng. Bỏ các đơn mẫu có sẵn trong DB mẫu (tạo 2026-10-09), phát hành điểm lúc khách còn hạng khác**

```sql
SELECT o.code, u."tierId", o.subtotal::int, o."couponDiscount"::int AS coupon, o."pointsDiscount"::int AS pts_disc, o."pointsEarned"::int AS earned, COALESCE((SELECT SUM(p.delta) FROM points_transactions p WHERE p."userId" = o."userId" AND p.reason LIKE 'ORDER_DELIVERED:' || o.code || '%'), 0)::int AS ledger, FLOOR((o.subtotal - o."couponDiscount" - o."comboDiscount" - o."tierDiscount") * 0.02 * CASE u."tierId" WHEN 'LOC_BIEC' THEN 1.2 WHEN 'DAI_THU' THEN 1.5 WHEN 'CO_THU' THEN 2 ELSE 1 END)::int AS expect_before_points, FLOOR((o.subtotal - o."couponDiscount" - o."comboDiscount" - o."tierDiscount" - o."pointsDiscount") * 0.02 * CASE u."tierId" WHEN 'LOC_BIEC' THEN 1.2 WHEN 'DAI_THU' THEN 1.5 WHEN 'CO_THU' THEN 2 ELSE 1 END)::int AS expect_after_points FROM orders o JOIN users u ON u.id = o."userId" WHERE o."userId" = ANY($1) AND o.status = 'DELIVERED' AND o."createdAt" >= '2026-10-19T00:00:00+07:00' ORDER BY o."createdAt"
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (8 dòng):

```json
[{"code":"TUBU2026101969520","tierId":"LOC_BIEC","subtotal":178000,"coupon":0,"pts_disc":0,"earned":4272,"ledger":4272,"expect_before_points":4272,"expect_after_points":4272},{"code":"TUBU2026101999534","tierId":"MAM_XANH","subtotal":199000,"coupon":30000,"pts_disc":0,"earned":3380,"ledger":3380,"expect_before_points":3380,"expect_after_points":3380},{"code":"TUBU2026101927562","tierId":"LOC_BIEC","subtotal":165000,"coupon":0,"pts_disc":0,"earned":3960,"ledger":3960,"expect_before_points":3960,"expect_after_points":3960},{"code":"TUBU2026101968794","tierId":"LOC_BIEC","subtotal":199000,"coupon":0,"pts_disc":0,"earned":4776,"ledger":4776,"expect_before_points":4776,"expect_after_points":4776},{"code":"TUBU2026101986207","tierId":"LOC_BIEC","subtotal":199000,"coupon":0,"pts_disc":0,"earned":4776,"ledger":4776,"expect_before_points":4776,"expect_after_points":4776},{"code":"TUBU2026101987058","tierId":"LOC_BIEC","subtotal":199000,"coupon":0,"pts_disc":0,"earned":4776,"ledger":4776,"expect_before_points":4776,"expect_after_points":4776},{"code":"TUBU2026101937408","tierId":"LOC_BIEC","subtotal":199000,"coupon":0,"pts_disc":0,"earned":4776,"ledger":4776,"expect_before_points":4776,"expect_after_points":4776},{"code":"TUBU2026102097612","tierId":"LOC_BIEC","subtotal":199000,"coupon":0,"pts_disc":0,"earned":4776,"ledger":4776,"expect_before_points":4776,"expect_after_points":4776}]
```

**R7. Đơn có mã giảm giá còn hiệu lực phải có đúng 1 dòng coupon_redemptions; đơn huỷ không còn dòng**

```sql
SELECT o.code, o.status, o."couponCode", (SELECT count(*) FROM coupon_redemptions r WHERE r."orderId" = o.id)::int AS redemptions FROM orders o WHERE o."userId" = ANY($1) AND o."couponCode" IS NOT NULL ORDER BY o."createdAt"
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (3 dòng):

```json
[{"code":"TUBU2026101999534","status":"DELIVERED","couponCode":"HOPSAN-2BWSJQ6N","redemptions":1},{"code":"TUBU2026101913944","status":"CANCELLED","couponCode":"XANH10","redemptions":0},{"code":"TUBU2026101977733","status":"CANCELLED","couponCode":"XANH10","redemptions":0}]
```

**R8. Hoa hồng CTV: 8% tiền hàng tính hoa hồng, giữ 10 ngày sau giao**

```sql
SELECT o.code, c.status, c."commissionableTotal"::int AS base, c.rate::float AS rate, c.amount::int AS amount, ROUND(c."commissionableTotal" * 0.08)::int AS expect_8pct, o."deliveredAt", c."lockedAt", c."approvedAt" FROM commissions c JOIN orders o ON o.id = c."orderId" WHERE o."userId" = ANY($1)
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (38 dòng, in 12 dòng đầu):

```json
[{"code":"TUBU2026101927562","status":"LOCKED","base":165000,"rate":8,"amount":13200,"expect_8pct":13200,"deliveredAt":"2026-10-19T16:28:53.826Z","lockedAt":"2026-10-19T16:28:53.842Z","approvedAt":null},{"code":"TUBU2026101913944","status":"REJECTED","base":296100,"rate":8,"amount":23688,"expect_8pct":23688,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101945928","status":"PENDING","base":158000,"rate":8,"amount":12640,"expect_8pct":12640,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101968794","status":"LOCKED","base":199000,"rate":8,"amount":15920,"expect_8pct":15920,"deliveredAt":"2026-10-19T16:45:37.644Z","lockedAt":"2026-10-19T16:45:37.673Z","approvedAt":null},{"code":"TUBU2026101954990","status":"REJECTED","base":109000,"rate":8,"amount":8720,"expect_8pct":8720,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101929058","status":"REJECTED","base":247000,"rate":8,"amount":19760,"expect_8pct":19760,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101977159","status":"REJECTED","base":110000,"rate":8,"amount":8800,"expect_8pct":8800,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101941905","status":"REJECTED","base":110000,"rate":8,"amount":8800,"expect_8pct":8800,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101925491","status":"PENDING","base":158000,"rate":8,"amount":12640,"expect_8pct":12640,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101986207","status":"LOCKED","base":199000,"rate":8,"amount":15920,"expect_8pct":15920,"deliveredAt":"2026-10-19T16:48:15.752Z","lockedAt":"2026-10-19T16:48:15.760Z","approvedAt":null},{"code":"TUBU2026101991795","status":"REJECTED","base":109000,"rate":8,"amount":8720,"expect_8pct":8720,"deliveredAt":null,"lockedAt":null,"approvedAt":null},{"code":"TUBU2026101972764","status":"REJECTED","base":247000,"rate":8,"amount":19760,"expect_8pct":19760,"deliveredAt":null,"lockedAt":null,"approvedAt":null}]
```

**R9. Tồn kho không âm**

```sql
SELECT sku, stock::int, "reservedStock"::int AS reserved FROM variations WHERE stock < 0 OR "reservedStock" < 0
```

Kết quả (0 dòng):

```json
[]
```

**R10. Đơn trùng (cùng khách, cùng tổng, cách nhau dưới 1 giây): dấu hiệu bấm đặt hàng hai lần mà không được chặn**

```sql
SELECT a.code AS a, b.code AS b FROM orders a JOIN orders b ON a."userId" = b."userId" AND a.id < b.id AND a.total = b.total AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - b."createdAt"))) < 1 WHERE a."userId" = ANY($1)
-- $1 = ["uat_returning","uat_new","uat_new_nophone"]
```

Kết quả (0 dòng):

```json
[]
```
<!-- U6-RECON:END -->

## Lỗi tìm thấy

Đường dẫn mã ghi theo worktree `uat-int` (nhánh `uat/int`, commit `4d71b653`, đã có các bản sửa đêm 2026-10-20). Mọi dòng dẫn ra đều có y nguyên ở bản đang kiểm `b2a42a53`, riêng `catalog.service.ts` lệch số dòng (ở `b2a42a53` là `:477-480`). Vùng file theo `00-brief.md`: `apps/web/src/**` (trừ `admin/**`) thuộc phiên web, chỉ báo lỗi; `apps/api/**` thuộc phiên UAT.

Không có P0 mới. Tiền và điểm của U6 khớp sổ (U6-90 PASS sau khi sửa hai truy vấn của bộ khung, xem mục U6-90 dưới đây).

### Bảng tóm tắt

| ID | Mức | Vùng | Nhóm | Ca | Vị trí chính | Một dòng |
|---|---|---|---|---|---|---|
| U6-B01 | P1 | web khách | agent sửa ngay | U6-80, `repro/B01` | `apps/web/src/app/san-pham/[slug]/page.tsx:76-78` | Ở 390px, khách đã đăng nhập có mã giảm giá mở **mọi** trang sản phẩm thì trang rộng 461–465px: ảnh bị cắt, nút chia sẻ ra ngoài màn |
| U6-B02 | P2 | API | agent sửa ngay (đã biết C-035 / A1-037 = U1-B01, còn mở) | U6-02 | `apps/api/src/modules/catalog/catalog.service.ts:491-496` | "Giá tăng/Giá giảm" sắp theo `basePrice`, còn thẻ sản phẩm hiện giá bán |
| U6-B03 | P2 | API (+ web hiện chữ lỗi thô) | agent sửa ngay | U6-73 | `apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts:153-156` | `GET /waste/rules` thiếu `@Public()`: trang thể lệ công khai hiện "Unauthorized" cho khách chưa đăng nhập |
| U6-B04 | P3 | web khách | agent sửa ngay | U6-74 | `apps/web/src/components/recycle/recycle-requests.tsx:37-45` | `/doi-rac/yeu-cau` với khách chưa có SĐT hiện lỗi API kèm "Thử lại", không hiện lời mời mở Mini App như ba trang đổi rác khác |
| U6-B05 | P3 | web khách (+ API) | agent sửa ngay | U6-60 | `apps/web/src/app/tai-khoan/page.tsx:77` | Hub Tài khoản luôn gọi `GET /brand/owner/me`, nhận 404 và in 1 lỗi console với khách không có nhãn |
| U6-B06 | P3 | web khách ↔ Mini App | cần chủ quyết | U6-62 | `apps/web/src/app/tai-khoan/diem-xanh/page.tsx:173`, `:197` | Web hiện "… điểm đang chờ, mở khoá ngày …", Mini App không có dòng này |
| U6-B07 | P3 | API | agent sửa ngay | U6-68 | `apps/api/src/modules/users/users.service.ts:139-160` | Xoá địa chỉ mặc định thì không còn địa chỉ nào là mặc định. Mini App cũng vậy |
| U6-B08 | P3 | web khách + Mini App | cần chủ quyết | U6-37 | `apps/web/src/app/thanh-toan/page.tsx:438-442` | Trang thanh toán web có thêm "Ví Tubu", trong khi Q4 ghi "chỉ chuyển khoản QR + COD" |
| U6-B09 | P3 | web khách (+ Mini App) | agent sửa ngay | U6-75 | `apps/web/src/app/hoc-vien/course-list.tsx:51`, `:60` | Khách thường mở `/hoc-vien` thấy lỗi thô "Bạn không có quyền truy cập tài nguyên này." kèm "Thử lại" |
| U6-B10 | P3 | web khách | cần chủ quyết | U6-08 | `apps/web/src/app/brand/[slug]/page.tsx:10`, `apps/web/src/lib/api.ts:327-329` | Admin gỡ đăng nhãn, trang `/brand/<slug>` vẫn hiện tới 5 phút (ISR `revalidate = 300`) |
| (D8-5) | — | chủ tự làm | chủ tự làm (đã biết, còn mở) | U6-09 | `apps/web/src/lib/legal.ts` (xem D8-5) | Trang chính sách còn "[Tên công ty]", "[Mã số thuế]", "[Địa chỉ trụ sở]", "[số ngày]" |

### U6-90. Đối chiếu tiền, điểm: hai điểm sai trước đây đều do bộ khung

**(a) Đơn `TUBU2026101960369`: 34.400 điểm là đúng. Kỳ vọng 41.280 của R6 bản cũ sai.**

- Đây là "đơn cũ" do bộ khung dựng khi tạo khách (`tools/uat-harness/seed-roles.mjs:175-213`): 4 × FUWA-DW-5L = 1.720.000đ, COD. Lúc đặt, `uat_returning` chưa có hạng (`seed-roles.mjs:42-50` tạo user không có `tierId`; `schema.prisma:238` `tierId String?`). Script cho giao xong, lùi mốc 40 ngày, rồi mới chạy job `tiers.recalc`. Chính đơn này đưa khách lên Lộc Biếc.
- Sản phẩm tính điểm theo **hạng lúc đặt đơn**:
  - `checkout.service.ts:1159` lấy `getTierMultiplier(user.tierId)` lúc báo giá và đặt đơn.
  - `:1171` tính `pointsEarned`, `:479` ghi vào đơn.
  - `tierId = null` cho hệ số 1 (`loyalty.service.ts:635-638`).
- Lúc giao, `creditOrderPoints` cộng đúng số đã lưu trên đơn, không tính lại theo hạng mới (`loyalty.service.ts:110-125`, `delta = locked.pointsEarned − phần đã trả`). Lên hạng chạy sau đó (`recalcTier`, `:152`).
- DB lane 6 của đơn này:
  - `pointsEarned = 34.400`, `createdAt = 2026-09-09T15:27:57Z` (đã lùi 40 ngày), `deliveredAt` sau đó 1 giây.
  - Sổ điểm `ORDER_DELIVERED:TUBU2026101960369 = +34.400`, đúng bằng 1.720.000 × 2% × 1.
- Kết luận: sản phẩm làm đúng luật đã chốt (2% × hệ số hạng lúc mua, đúng số điểm khách thấy ở trang thanh toán). R6 cũ nhân theo hạng hiện tại (`users.tierId`) nên sai.
- Sửa ở bộ khung: DB không có bảng lịch sử hạng khách (`schema.prisma` chỉ có `DealerTierHistory`). Vì vậy `reconcile.mjs` R6 chỉ xét đơn đặt từ 2026-10-19, lúc khách đã lên hạng xong. Bản chạy lại: 8 đơn, 0 lệch.

**(b) Cặp `TUBU2026101920893` / `TUBU2026101937085` (cách nhau 4,2 giây): bộ khung cố ý đặt hai đơn, không phải bấm đúp.**

- Hai đơn cùng 1 × POLANG-LG-10, chuyển khoản, 110.000đ, `idempotencyKey = null` (đặt thẳng qua API, không qua web).
  - Đơn đầu là đơn mẫu `S.bank`, đặt ở bước dựng đơn mẫu (`e-orders.mjs:52`).
  - Đơn sau là đơn của ca U6-54 (`e-orders.mjs:272`).
  - Giữa hai đơn có 4 đơn mẫu khác (17:31:23.5–24.3). Lần chạy lại hôm nay lặp đúng mẫu này: `TUBU2026102081360` / `TUBU2026102098229`, cách nhau 2,1 giây.
- Web có chặn đặt trùng:
  - Khoá `Idempotency-Key` theo nội dung đơn (`apps/web/src/app/thanh-toan/page.tsx:204-244`), gửi qua `packages/app-core/src/api/checkout.ts:101-102`.
  - Nút "Đặt hàng" khoá khi đang gửi (`thanh-toan/page.tsx:445`, `:761`, `:805`).
  - API trả lại đơn cũ khi trùng khoá (`checkout.controller.ts:29-33`, `checkout.service.ts:321-323`; khi va unique: `:674-675`).
- Ca U6-34 (PASS) bấm "Đặt hàng" hai lần trong cùng một tick: trình duyệt gửi ba request cùng một khoá `2008c1d3-…`, DB chỉ thêm 1 đơn (4 → 5), tồn kho chỉ giữ 1 lần.
- R10 nay chỉ bắt cặp cùng khách, cùng tổng, cách nhau dưới 1 giây. Bản chạy lại: 0 dòng.

### U6-B01 — P1 — trang sản phẩm tràn ngang ở điện thoại khi khách có mã giảm giá

- **Vị trí:**
  - `apps/web/src/app/san-pham/[slug]/page.tsx:76`: `grid gap-8 md:grid-cols-2`. Dưới `md`, lưới chỉ có một cột ngầm định cỡ `auto`, nên cột nở theo min-content của con.
  - Cột phải `<div>` (`:78`) không có `min-w-0` và chứa `PdpCoupons` (`:139`).
  - Hàng thẻ mã (`pdp-extras.tsx:78-80`) dùng `flex` + thẻ `shrink-0`. Bản thân `ul` có `overflow-x-auto`, nhưng `ul` không phải phần tử lưới nên min-content của nó vẫn bằng tổng bề rộng các thẻ.
  - Kết quả: cột rộng khoảng 445–448px, ảnh (`components/product-gallery.tsx`) cũng nở theo.
- **Kịch bản:** đăng nhập `uat_returning` hoặc `uat_new_nophone` (4 thẻ mã trên trang), khổ 390x844, mở bất kỳ trang sản phẩm nào → `scrollWidth` 465 / 461 so với khổ máy 390.
  - Quét lại hôm nay: tràn ở cả 3 trang sản phẩm đã quét (`/san-pham/dau-tram-be-cobote`, `/serum-duong-am-visante`, `/nuoc-rua-chen-fuwa3e`).
  - Không tràn với khách ghé (không có thẻ mã) và ở 1440px.
  - Phần tử vượt khổ: `div.relative aspect-square overflow-hidden rounded-sheet` w=448, hàng thương hiệu + tim + chia sẻ w=448.
  - Khách mới nào cũng có WELCOME30, FREESHIP, XANH10 trong ví, nên gần như mọi khách đã đăng nhập trên điện thoại đều gặp lỗi này ở trang mua chính.
- **Bằng chứng:**
  - `results/h-layout.json` (U6-80-returning-390, U6-80-new_nophone-390).
  - `results/repro-B01.json` (`{"sw":465,"iw":390}`, 4 thẻ).
  - Ảnh [U6-80-new_nophone-390-pdp-tran-ngang.png](shots/U6-web-khach/U6-80-new_nophone-390-pdp-tran-ngang.png), [U6-B01-B01-pdp-tran-ngang-390.png](shots/U6-web-khach/U6-B01-B01-pdp-tran-ngang-390.png).
  - Bộ khung phải bấm "Thêm vào giỏ" bằng DOM khi Playwright báo điểm bấm lệch (`_lib.mjs` `addViaPdp`).
- **Đề xuất:** `grid-cols-1 md:grid-cols-2` (tức `minmax(0,1fr)`), hoặc thêm `min-w-0` cho hai con của lưới. Test: e2e 390px với khách có 4 mã → `scrollWidth ≤ 390` trên trang sản phẩm.
- **Tái hiện:** `node repro/B01-pdp-tran-ngang.mjs`.

### U6-B02 — P2 — sắp xếp theo giá dùng giá gốc (đã biết C-035 / A1-037, cùng gốc U1-B01)

- **Vị trí:** `apps/api/src/modules/catalog/catalog.service.ts:491-496` (`orderBy` trả `{ basePrice: 'asc' | 'desc' }`).
  - Web chỉ chuyển `sort=price_asc|price_desc` lên API (`apps/web/src/lib/search-state.ts:44`, `components/catalog/sort-chips.tsx:9`). Mini App cũng vậy.
  - Lỗi nằm ở API, nên cả hai kênh cùng sai.
- **Kịch bản:** `/san-pham` → "Giá tăng". 12 thẻ đầu: 25.000, 75.000, 79.000, 79.000, 85.000, 89.000, 89.000, **75.000**, 95.000, 95.000, **79.000**, 99.000. Với "Giá giảm", thẻ 329.000 đứng trước 345.000.
- **Bằng chứng:**
  - `results/a-guest.json` (U6-02).
  - `results/repro-B02.json`: `GET /products?sort=price_asc&limit=60`, thứ tự nhận về lệch thứ tự đúng từ vị trí thứ 3.
  - Ảnh [U6-02-san-pham-390.png](shots/U6-web-khach/U6-02-san-pham-390.png).
- **Đề xuất:** sắp theo giá hiệu lực `COALESCE("salePrice","basePrice")` (raw SQL hoặc cột tính sẵn). Test: sản phẩm A giá gốc 95.000, giá bán 75.000; sản phẩm B giá 79.000 → `price_asc` ra A trước B.
- **Tái hiện:** `node repro/B02-sap-xep-gia.mjs`.

### U6-B03 — P2 — thể lệ Đổi rác không đọc được khi chưa đăng nhập

- **Vị trí:** `apps/api/src/modules/waste-exchange/customer/waste-customer.controller.ts:153-156`. `@Get('rules')` không có `@Public()`, nên guard JWT toàn cục (`apps/api/src/app.module.ts:117`, `common/guards/jwt-auth.guard.ts:14`) trả 401.
- Trang web được làm như một trang công khai:
  - SSR + ISR `revalidate = 300`, có `canonical` (`apps/web/src/app/doi-rac/quy-dinh/page.tsx:6-17`).
  - `robots` mở lại `/doi-rac/quy-dinh` (`apps/web/src/app/robots.ts:16-17`).
- Diễn biến lỗi: server đọc gặp 401 thì bỏ qua, trình duyệt tự gọi lại và lại nhận 401. Cuối cùng `RecycleRulesView` in nguyên `error.message` (`apps/web/src/components/recycle/recycle-rules-view.tsx:10`, `:33`).
- **Kịch bản:**
  - Bật `waste.enabled`, đặt `waste.rules_text` có chữ "khoảng ngày".
  - Khách ghé mở `/doi-rac/quy-dinh` (390px) → khung "Unauthorized" (tiếng Anh) kèm "Thử lại"; request `GET /waste/rules 401`.
  - Khách đã đăng nhập đọc được đủ thể lệ.
  - Chạy lại hôm nay vẫn y như vậy.
- **Bằng chứng:** `results/g-misc.json` (U6-73), ảnh [U6-73-quy-dinh-khach.png](shots/U6-web-khach/U6-73-quy-dinh-khach.png) và [U6-73-quy-dinh-dang-nhap.png](shots/U6-web-khach/U6-73-quy-dinh-dang-nhap.png).
- **Đề xuất:**
  - API: thêm `@Public()` (có thể kèm `@PublicCache`) cho `rules()`. Nội dung là cấu hình công khai, không có dữ liệu khách.
  - Web: `errText` nên đổi lỗi 401/403 thành câu tiếng Việt.
  - Test: e2e API `GET /waste/rules` không token → 200 `{ text }`.

### U6-B04 — P3 — `/doi-rac/yeu-cau` với khách chưa có SĐT

- **Vị trí:** `apps/web/src/components/recycle/recycle-requests.tsx:37-45`. Trang gọi `GET /waste/requests` ngay, lỗi thì hiện `ErrorState` với chữ của API. Ba trang đổi rác kia chặn trước bằng `me.eligibility !== 'OK'` → `MiniAppOnlyNotice` (`recycle-new.tsx:266`, `recycle-points.tsx:107`, `recycle-home.tsx:175`).
- **Kịch bản:** bật đổi rác, `uat_new_nophone` mở `/doi-rac/yeu-cau` (390px).
  - Trang hiện "Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà." kèm nút "Thử lại". Bấm lại vẫn lỗi, vì web không xin được SĐT (Q2).
  - `/doi-rac`, `/doi-rac/tao`, `/doi-rac/diem-nhan` hiện đúng "Tính năng này cần mở Tubu Tree trên Zalo." kèm nút "Mở trên Zalo".
- **Bằng chứng:** `results/g-misc.json` (U6-74), ảnh [U6-74-q2-doi-rac-yeu-cau.png](shots/U6-web-khach/U6-74-q2-doi-rac-yeu-cau.png).
- **Đề xuất:** kiểm `eligibility` như ba trang kia trước khi gọi danh sách. Test spec: `me.eligibility` khác `'OK'` → render `MiniAppOnlyNotice`, không gọi `/waste/requests`.

### U6-B05 — P3 — hub Tài khoản gọi `/brand/owner/me` và nhận 404

- **Vị trí:**
  - Web: `apps/web/src/app/tai-khoan/page.tsx:77` gọi `ownedBrandProfileQuery`. Query này (`packages/app-core/src/queries/brand-owner.ts:10-16`) coi 404 là "không có nhãn".
  - API: `apps/api/src/modules/brand/brand.controller.ts:41-44` → `brand.service.ts:503-509` ném 404 khi khách không sở hữu nhãn.
- **Kịch bản:** khách không phải chủ nhãn mở `/tai-khoan` → `GET /brand/owner/me 404` và 1 dòng "Failed to load resource … 404" trong console. Trang vẫn hiện đúng. Lỗi chỉ có ở `/tai-khoan`, không phải mọi trang (ca U6-72 ở `/vuon-xanh` không có request lỗi).
- **Bằng chứng:** ghi chú của U6-60 trong `results/f-account.json`.
- **Đề xuất:** thêm cờ `ownsBrand` vào `/me`, hoặc cho endpoint trả `200 null`. Mức thấp: chỉ gây nhiễu console và nhiễu giám sát lỗi.

### U6-B06 — P3 — cần chủ quyết — dòng "điểm đang chờ" chỉ có ở web

- **Kịch bản:** `uat_returning` mở `/tai-khoan/diem-xanh` trên web và `/loyalty` trên Mini App.
  - Web có hai dòng: "13.008 điểm đang chờ, mở khoá ngày 26/10" và "4.776 điểm đang chờ xử lý đổi/trả…" (`apps/web/src/app/tai-khoan/diem-xanh/page.tsx:173`, `:197`). Mini App không có.
  - Tổng điểm, mã giảm giá và điểm danh hai bên khớp nhau.
- **Bằng chứng:** ghi chú của U6-62-390 trong `results/f-account.json`.
- **Cần chủ quyết:** chủ đã dặn web khổ điện thoại phải giống Mini App cả giao diện. Chọn một trong hai: thêm dòng này vào Mini App (thông tin có ích), hoặc bỏ ở web.

### U6-B07 — P3 — xoá địa chỉ mặc định thì mất mặc định

- **Vị trí:** API `apps/api/src/modules/users/users.service.ts:139-160`: `deleteAddress` chỉ xoá, không chọn địa chỉ khác làm mặc định.
  - Web (`apps/web/src/app/tai-khoan/dia-chi/page.tsx:48-53`) và Mini App (`apps/miniapp/src/pages/addresses.tsx:46-53`) đều chỉ gọi `DELETE` rồi tải lại.
  - Vậy **lỗi nằm ở API**, hai kênh như nhau.
- **Kịch bản:** thêm "Nhà A" (tự thành mặc định), thêm "Nhà B", đặt B làm mặc định, rồi xoá B → còn A với `isDefault = false`, trang không còn nhãn "Mặc định".
- **Ảnh hưởng:**
  - Không chặn mua: trang thanh toán vẫn tự chọn địa chỉ đầu (`apps/web/src/app/thanh-toan/page.tsx:135`, `apps/miniapp/src/pages/checkout.tsx:147`).
  - Xem trước đổi rác theo tỉnh chỉ đọc `isDefault` (`apps/api/src/modules/waste-exchange/customer/waste-preview.service.ts:90`), nên khi không còn mặc định thì không suy ra được tỉnh.
- **Bằng chứng:** `results/f-account.json` (U6-68: DB sau xoá `[{"recipient":"Nhà A","d":false}]`), ảnh [U6-68-dia-chi-sau-xoa.png](shots/U6-web-khach/U6-68-dia-chi-sau-xoa.png).
- **Đề xuất:** trong transaction xoá, nếu dòng bị xoá là mặc định thì đặt địa chỉ mới nhất còn lại làm mặc định. Test: xoá địa chỉ mặc định khi còn 1 địa chỉ khác → địa chỉ đó có `isDefault = true`.

### U6-B08 — P3 — cần chủ quyết — "Ví Tubu" trên trang thanh toán web

- **Vị trí:** `apps/web/src/app/thanh-toan/page.tsx:438-442` liệt kê COD, Chuyển khoản và **Ví Tubu (số dư)**.
  - Mini App có cùng ba lựa chọn (`apps/miniapp/src/pages/checkout.tsx:458`).
  - API nhận `WALLET` (`apps/api/src/modules/checkout/dto/checkout.dto.ts:42`).
- Q4 (`docs/2026-10-19-web-parity/PROMPT.md:18`) ghi: "Chỉ chuyển khoản QR + COD (phương thức API đã hỗ trợ cho web). Không thêm cổng ZaloPay web".
- Ví Tubu không phải cổng thanh toán ngoài và chạy đúng tiền:
  - U6-38 PASS: trừ ví, có dòng sổ, huỷ đơn thì hoàn về ví.
  - U6-54 PASS: huỷ đơn đã trả thì được chọn hoàn về ví.
- **Cần chủ quyết:** giữ Ví Tubu trên web (sửa lại câu Q4) hay ẩn ở web. Ảnh [U6-37-phuong-thuc-390.png](shots/U6-web-khach/U6-37-phuong-thuc-390.png).

### U6-B09 — P3 — `/hoc-vien` với khách thường

- **Vị trí:** `apps/web/src/app/hoc-vien/course-list.tsx:51`, `:60` in thẳng lỗi API ra `ErrorState`.
  - API giới hạn vai trò ở `apps/api/src/modules/academy/academy.controller.ts:7` (`AFFILIATE, DEALER, STAFF, ADMIN`).
  - Mini App làm giống vậy (`apps/miniapp/src/pages/academy.tsx:52-53`).
- **Kịch bản:** `uat_returning` (CUSTOMER) gõ `/hoc-vien` → "Bạn không có quyền truy cập tài nguyên này." kèm "Thử lại". Bấm lại vẫn 403 (`GET /academy/courses 403`).
  - Không lộ dữ liệu.
  - Trang chỉ được dẫn tới từ `/ctv` (`apps/web/src/app/ctv/page.tsx:444-446`), nên khách chỉ gặp khi gõ thẳng hoặc mở link cũ.
- **Bằng chứng:** `results/g-misc.json` (U6-75), ảnh [U6-75-hoc-vien-khach-thuong.png](shots/U6-web-khach/U6-75-hoc-vien-khach-thuong.png).
- **Đề xuất:** gặp 403 thì hiện câu mời "CTV Academy dành cho cộng tác viên" kèm nút tới `/ctv`, bỏ "Thử lại".

### U6-B10 — P3 — cần chủ quyết — gỡ đăng nhãn hàng mất tới 5 phút mới ẩn trên web

- **Vị trí:** `apps/web/src/app/brand/[slug]/page.tsx:10` (`revalidate = 300`). `getBrand` đọc `/brand/public/<slug>` với `revalidate 300` (`apps/web/src/lib/api.ts:327-329`). Admin gỡ đăng không gọi làm mới trang.
- **Đo trên lane 6** (2026-10-20T01:01Z), ngay sau `PATCH isPublished:false`:
  - API `/brand/public/fuwa3e` → 404.
  - Web `/brand/fuwa3e` qua Data Cache → **200**.
  - Web với `Cache-Control: no-cache` → 404.
  - Ca U6-08 chạy lại ghi cùng kết quả (ghi chú trong `results/a-guest.json`).
- **Cần chủ quyết:** chấp nhận trễ 5 phút (cách ISR đang làm), hay để admin gỡ đăng xong thì gọi `revalidatePath`/`revalidateTag`. Trường hợp nào cần ẩn ngay (nhãn vi phạm, ngưng hợp tác) thì đang không làm được.

### Ca FAIL do bộ khung (không phải lỗi sản phẩm)

| Ca | Nguyên nhân | Sửa trong script | Kết quả chạy lại 2026-10-20 |
|---|---|---|---|
| U6-54, U6-56, U6-60, U6-61, U6-64, U6-65, U6-72 | Phiên chính tắt lúc ~00:20, trình duyệt bị đóng giữa chừng (`browserType.launch: Target page, context or browser has been closed`, `page.goto: Timeout 90000ms`) | không cần | đều PASS (U6-54 10/10, U6-56 5/5, U6-60 22/22, U6-61 7/7, U6-64 11/11, U6-65 7/7, U6-72 9/9) |
| U6-80 | Như trên | không cần | 4/6 khổ×vai PASS. 2 FAIL là lỗi thật U6-B01 (390px, khách có mã) |
| U6-70 | Như trên. Khi chạy lại lộ thêm lỗi script: script chờ `POST /feed/posts`, trong khi web đăng bài bằng `POST /feed` (`packages/app-core/src/api/feed.ts:153-154`, `community-feed.controller.ts:68-72`). Bài vẫn được tạo, chỉ có kiểm tra "POST → 2xx" sai | `g-misc.mjs`: đổi đường chờ đăng bài sang `/feed`, đường gọi feed không token sang `/feed`, đường "thích" sang `/feed/:id/react` | PASS 11/11 |
| U6-23 | Script ghi cứng "tối đa 2". `uat_returning` đã mua 1 chiếc giờ vàng ở ca U6-39 (đơn `TUBU2026101927562`, `flash_sale_purchases.quantity = 1`), nên số suất còn lại đúng là 1 và API báo "Giá giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn…". Luật thật: `flash-sale.service.ts:128-147` (`perUserLeft = perUserLimit − flash_sale_purchases.quantity`, `allowance = min(quotaLeft, perUserLeft)`), `flash-line-price.ts:27-34` (vượt suất thì cả dòng tính giá thường), `:6-13` (câu nhắc) | `c-cart.mjs`: tính số suất còn từ `flash_sale_purchases` và `quota − soldCount`, như API | PASS 12/12 (390 và 1440) |
| U6-08 | Lần chạy trước đã đăng nhãn Fuwa3e. Sau khi gỡ đăng, Data Cache của Next vẫn trả bản đã đăng (U6-B10). API lọc đúng `isPublished: true` (`brand.service.ts:95`) | `a-guest.mjs`: gỡ đăng trước khi đo; đo trang bằng `Cache-Control: no-cache` và đo cả API | PASS 9/9 |
| U6-90 | R6 nhân theo hạng hiện tại; R10 bắt cả đơn mẫu cố ý của script (mục U6-90 ở trên) | `reconcile.mjs` (đã sửa trước phiên này): R6 chỉ xét đơn từ 2026-10-19, R10 cửa sổ 1 giây | PASS 10/10 |

## Hạn chế bộ khung

- **Bản đang kiểm:** web và API chạy từ `b2a42a53`, chưa có các bản sửa của `uat/int`. Nguyên nhân gốc được đọc ở `uat-int` (`4d71b653`), và các dòng dẫn ra có y nguyên ở cả hai bản. Chưa chạy lại ca nào trên bản `uat/int`.
- **Lane không dựng lại từ đầu:** đợt chạy lại sáng 2026-10-20 (07:35–08:10) chạy trên lane cũ của đêm trước, không `lane-down --drop`, dùng `ONLY=<ca> node <nhóm>.mjs`. Dữ liệu dồn thêm sau mỗi lần chạy:
  - `uat_returning` nay có 42 đơn, 4 mã trong ví (phần đầu báo cáo ghi 3 mã là số lúc dựng lane), 67.512 điểm.
  - Mỗi lần chạy nhóm E lại dựng 5 đơn mẫu mới.
  - Ca nào phụ thuộc trạng thái (suất giờ vàng, nhãn đã đăng, điểm danh trong ngày) thì script tự đọc hoặc tự đặt lại trạng thái trước khi kiểm.
- **Web chạy `next dev`, không phải bản build:**
  - Thời gian tải trang và cách cache khác bản build.
  - Data Cache của `fetch` (ISR) vẫn chạy ở `next dev`, và request có `Cache-Control: no-cache` thì bỏ qua cache. Bản build không bỏ qua theo header này, nên U6-B10 trên production là trễ tới 5 phút.
- **Đăng nhập, thanh toán, vận chuyển là giả:** Zalo OAuth giả, ngân hàng giả (webhook), Pancake giả cổng 3268. Đăng nhập Zalo thật, chuyển khoản thật, Pancake thật, Gomdon, OA, ZaloPay là BLOCKED (U6-95 đến U6-98).
- **Giới hạn tốc độ:** `/auth/refresh` giới hạn 30 lần/phút/IP (C-005), mọi lane UAT chung IP 127.0.0.1. Script tự giãn nhịp 16 lần tải trang/phút (`_lib.mjs` `paceNav`), nên một vòng U6-80 mất khoảng 9 phút. Máy chung tải 46–51 lúc chạy lại.
- **R6 (điểm theo hạng):**
  - DB không lưu lịch sử hạng của khách, nên R6 không biết hạng lúc đặt đơn. Truy vấn chỉ xét đơn đặt từ 2026-10-19 và nhân theo hạng hiện tại.
  - Đơn nào đặt trong đợt UAT mà khách đổi hạng giữa lúc đặt và lúc đối chiếu thì R6 sẽ báo lệch giả.
  - Luật đúng: hạng lúc đặt (`checkout.service.ts:1159`).
- **R10 (đơn trùng):**
  - R10 chỉ bắt cặp cách nhau dưới 1 giây, vì script đặt đơn mẫu thẳng qua API không kèm khoá, nhiều đơn cùng tổng cách nhau vài giây.
  - Hai tab cùng bấm đặt, cách nhau trên 1 giây, sẽ không bị R10 bắt. Phần chặn bấm đúp đã được kiểm riêng ở U6-34.
- **Lần tắt phiên đêm trước:**
  - Các ca U6-54, 56, 60, 61, 64, 65, 70, 72, 80 và `repro/B01` từng ghi "ca ném lỗi" chỉ vì trình duyệt bị đóng. Kết quả trong bảng là của lần chạy lại.
  - Mỗi lần chạy nhóm E để lại một đơn chuyển khoản mẫu chưa trả (`S.bank`; lần này là `TUBU2026102081360`). Đơn ở trạng thái `PENDING_PAYMENT` và giữ tồn kho. Chưa kiểm job tự huỷ đơn quá hạn chuyển khoản trên lane.
- **So với Mini App:** Mini App chạy `vite` cổng 3263 với Zalo SDK giả. Chỉ so chữ và số trên màn, không so ảnh từng điểm ảnh. Việc so ảnh 375px là của phiên web.
