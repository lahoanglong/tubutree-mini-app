# 05. Lối vào, mẫu tương tác, Trang chủ (vai PM + Product Designer)

Nguồn: chỉ đọc mã ở worktree review-1028, commit `9d0e95bd5`. Không chạy app, không chụp ảnh. Cái gì chưa kiểm ghi "chưa kiểm".
Lưu ý: `01a-kiem-ke-miniapp.md` và `01b-kiem-ke-web.md` dựng ở commit `77bf4676`, đã lệch (thanh đáy cũ có "Đơn hàng", chưa có `/offers`; Trang chủ cũ 7 khối). Tài liệu này đọc lại từ đầu.

## 0. Cách đếm và trạng thái cờ

- **Chạm từ Trang chủ**: đang đứng ở Trang chủ, đếm số chạm tới màn đích (chưa tính thao tác trong màn đó). Thanh đáy vẫn hiện ở Trang chủ nên chạm một tab tính 1.
- **Chạm từ thanh đáy**: bắt đầu bằng chạm một tab (tab đó tính 1), đường đi KHÔNG dùng khối của Trang chủ trừ khi tab đầu là Trang chủ. Việc nằm ở khối Trang chủ thì "thanh đáy" = 1 + số chạm trong Trang chủ.
- Dấu `[>2]` = cần từ 3 chạm trở lên. `[LINK]` = trong app không có `navigate`/`Link` từ màn khác trỏ tới (hoặc chỉ trỏ khi đã có ngữ cảnh từ link). `[CỜ]` = bị cờ ẩn.
- Cờ đọc từ `https://api.tubutree.com/api/config/public` lúc đọc mã (28/10/2026): `waste.enabled=false` (cả 3 làn false), `loyalty.marketplaceClaimEnabled=false`, `aiAdvisorEnabled=false`, `chat.enabled=false`, `shippingEta=null`, `communityPublicPreview=true`. Hằng số trong mã: `CASHBACK_ENABLED=false`, `SEASON_PASS_ENABLED=false` (`packages/app-core/src/features.ts:6,11`). `GET /flash-sales/active` trên PROD trả `[]`.
  Hệ quả: trên PROD hiện tại 4 lối vào (Đổi rác, Tích điểm đơn sàn, Trợ lý AI, Chat CSKH) và dòng "dự kiến giao" đang ẩn, khối Giờ vàng trống.
- Thanh đáy (cả hai kênh): Trang chủ, Danh mục, Vườn Xanh (nút tròn giữa), Ưu đãi (chấm đỏ), Cá nhân (badge đơn đang xử lý). Nguồn chung `packages/app-core/src/home-layout.ts:124-130`. Mini App: `apps/miniapp/src/components/nav-config.ts:14-20`, `bottom-nav.tsx:49-60`; chỉ hiện ở 5 route gốc (`bottom-nav.tsx:19,22`). Web: `apps/web/src/lib/web-nav.ts:14-20`, `components/bottom-nav.tsx:52-62`, `md:hidden` (`:44`).
- Khách chưa đăng nhập: tab Cá nhân (`profile.tsx:165-186`) và Ưu đãi (`offers.tsx:98-101`) chỉ hiện thẻ "đăng nhập ngay"; Vườn Xanh hiện cổng đăng nhập (`game.tsx:145`). Web: `LoginRequired` ở `/uu-dai` (`uu-dai/page.tsx:134`) và các trang `tai-khoan/*`. Chưa kiểm hành vi Zalo đăng nhập ngầm ở Mini App thật.
- Mini App có 56 `<Route>` trong `components/app.tsx:201-259` (55 dòng route-map + `*`), 4 dòng `Navigate` (`/feed/leaderboard`, `/refill`, `/cashback` khi cờ tắt, `/subscriptions`). Đối chiếu tự động: route-map và app.tsx khớp 1-1 (chỉ `*` thừa); route-map và `apps/web/src/app/**/page.tsx` khớp 1-1 (web thừa: `/chinh-sach/:loai`, `/dang-nhap`, `/dang-nhap/callback`, `/khoi-phuc/:hint`, `/merchant`).

---

## A1. Bản đồ lối vào, Zalo Mini App

Đường đi trong cột 5 dùng ">" giữa các chạm. Đường ngắn nhất, có chọn tab/khối nào thì ghi.

### Việc chính

| Việc | Từ Trang chủ | Từ thanh đáy | Đường đi ngắn nhất | Lối vào (file:dòng) | Đánh dấu |
|---|---|---|---|---|---|
| Tìm sản phẩm | 1 | 2 | Trang chủ: ô tìm (mở sẵn bàn phím). Thanh đáy: Danh mục > chạm ô tìm (không tự focus) | `home.tsx:137-140` (SearchShell tới `/browse?focus=search`); ô thật `browse.tsx:162-175` | Ô tìm không dính đầu trang (mục B) |
| Duyệt danh mục | 1 | 1 | Danh mục (tab) hoặc hàng danh mục ở Trang chủ (vào thẳng một danh mục) | `nav-config.ts:16`; `home.tsx:91-94` | |
| Giỏ hàng | 1 | 2 | Trang chủ: nút giỏ ở đầu trang. Từ Danh mục: nút giỏ ở đầu trang. Ưu đãi, Vườn Xanh, Cá nhân không có nút giỏ | `home-header.tsx:36`; `cart-button.tsx:20`; `browse.tsx:181` | Giỏ chỉ có ở Trang chủ, Danh mục, trang sản phẩm |
| Thanh toán (tới trang Thanh toán) | 2 | 3 | Giỏ > "Thanh toán". Hoặc thẻ SP > "Mua ngay" (2 chạm). Từ thanh đáy: Trang chủ/Danh mục > Giỏ > Thanh toán | `cart.tsx:208`; `product-detail.tsx:258` | `[>2]` từ thanh đáy |
| Theo dõi đơn (danh sách) | 2 | 2 | Cá nhân > một ô trạng thái (Chờ thanh toán, Đang xử lý, Đang giao, Đã giao, Định kỳ) hoặc "Xem tất cả" | `profile.tsx:309` (tất cả), `:319-343` (5 ô, `navigate` ở `:330`) | |
| Theo dõi đơn (mở một đơn) | 3 (1 nếu qua "Việc cần làm") | 3 | Cá nhân > ô trạng thái > chạm đơn. Qua Trang chủ: dòng "Việc cần làm" mở thẳng đơn chờ thanh toán / đang giao | `orders.tsx:114`; `todo-strip.tsx:51,123` | `[>2]`. "Việc cần làm" chỉ hiện khi có đơn chờ thanh toán hoặc đang giao (`todo-strip.tsx:75,111`); đơn "Đang xử lý" không có lối ở Trang chủ, chỉ badge tab Cá nhân |
| Đơn đã huỷ / trả (tab "Đã đóng") | 3 | 3 | Cá nhân > "Xem tất cả" > tab "Đã đóng" | `orders-tabs.ts:21` (tab chỉ có ở trang Đơn hàng, ô trạng thái Cá nhân không có) | `[>2]`, mở một đơn là 4 chạm |
| Hạng và Điểm Xanh (xem số, tiến độ) | 1 | 1 | Ưu đãi (tab). Khách cũ: chạm thẻ thành viên ở Trang chủ | `nav-config.ts:18`; `member-card.tsx:70`; thẻ ở `offers.tsx:107-190` | |
| Trang chi tiết hạng `/loyalty` | 2 | 2 | Ưu đãi > chạm thẻ Điểm Xanh. Hoặc Cá nhân > ô "Điểm" | `offers.tsx:121`; `profile.tsx:290` | |
| Kho quà (đổi quà) | 1 | 2 | Trang chủ: lối tắt "Đổi quà" hoặc nút "Đổi quà" trên thẻ thành viên (khách cũ). Thanh đáy: Ưu đãi > "Đổi quà" | `shortcut-grid.tsx:15`; `member-card.tsx:165`; `offers.tsx:80` | |
| Quà đã đổi | 2 | 2 | Ưu đãi > "Quà của tôi" | `offers.tsx:81`; `rewards.tsx:206,250` | |
| Mã giảm giá của tôi | 1 | 1 | Trang chủ: lối tắt "Mã của tôi". Hoặc tab Ưu đãi (mã nằm cuối trang, phải cuộn) | `shortcut-grid.tsx:19` (`/offers?section=coupons`); `offers.tsx:226`; `profile.tsx:292` | Mã ở cuối trang Ưu đãi sau thẻ + điểm danh + 6 hàng; `?section=coupons` tự cuộn |
| Vườn Xanh | 1 | 1 | Tab giữa | `nav-config.ts:17` | |
| Điểm danh | 1 (khách cũ) / 2 (khách mới) | 2 | Khách cũ: nút trên thẻ thành viên Trang chủ. Mọi khách: Ưu đãi > nút điểm danh, hoặc Vườn Xanh > nút điểm danh | `member-card.tsx:139-161`; `offers.tsx:194-197`; `game.tsx:225-231,362`; `loyalty.tsx:302` | Khách mới không thấy điểm danh ở Trang chủ; chấm đỏ tab Ưu đãi nhắc (`home-layout.ts:188`) |
| Đổi rác lấy quà | 1 | 2 | Trang chủ: lối tắt "Đổi rác". Thanh đáy: Ưu đãi > hàng Đổi rác, hoặc Vườn Xanh > hàng Đổi rác. Tạo yêu cầu: +1 | `shortcut-grid.tsx:17`; `offers.tsx:82-88`; `game.tsx:270-276`; `recycle.tsx:357` | `[CỜ]` `waste.enabled`. PROD tắt: ẩn cả 3 lối. Khách còn yêu cầu mở thì lối tắt đổi nhãn "Yêu cầu của tôi" (`home-layout.ts:101-109`) |
| Chat CSKH | 2 | 2 | Cá nhân > "Chat với Tubu Tree". Cuối trang sản phẩm / chi tiết đơn / "Về Tubu Tree" cũng có | `profile.tsx:72,138`; `support-contact.tsx:53`; `product-detail.tsx:774`; `about.tsx:245` | `[CỜ]` `chat.enabled`. PROD tắt: ẩn. Còn hotline + email: Cá nhân > "Về Tubu Tree & Hỗ trợ" (`profile.tsx:75`), cuối chi tiết đơn (`order-detail.tsx:711`) |
| CTV: đăng ký / xem / hoa hồng | 2 | 2 | Cá nhân > "Cộng tác viên" (khách thường thấy chữ "Mở gian hàng"). Hoặc Trang chủ > "Kiếm tiền" > Cộng tác viên (bảng chọn) | `profile.tsx:55,141`; `shortcut-grid.tsx:21,54-55`; `earn-sheet.tsx:10`; nhãn theo `ctvMenuEntry` (`storefront-signup.ts:33-46`) | Vai đại lý/nhân viên/admin: mục CTV ẩn đến khi `/affiliate/me` trả về |
| CTV: Gian hàng (dựng, sửa) | 3 | 3 | Cá nhân > Cộng tác viên > nút "Gian hàng" | `affiliate.tsx:356`; `storefront-builder.tsx` | `[>2]`. Xem thử gian hàng công khai: 4 (`storefront-builder.tsx:412`) |
| CTV: hoa hồng | 2 | 2 | Cá nhân > Cộng tác viên (thẻ hoa hồng). Từ Ví: Ví > thẻ hoa hồng đã duyệt = 3 | `affiliate.tsx` (đầu trang); `wallet.tsx:170` | `wallet.tsx:170` chỉ bấm được khi `commissionApproved > 0` |
| Đại lý | 2 | 2 | Cá nhân > "Kênh đại lý" / "Hồ sơ đại lý" / "Đăng ký đại lý". Hoặc Kiếm tiền > Đại lý | `profile.tsx:57,122-126,140`; `earn-sheet.tsx:12` | |
| Ví Tubu | 2 | 2 | Cá nhân > ô "Ví" | `profile.tsx:291` | Lối duy nhất trong app (ngoài thông báo `notifications.tsx:138` và `game.tsx:56`). Ưu đãi không có lối sang Ví |

### Việc phụ

| Việc | Từ Trang chủ | Từ thanh đáy | Đường đi ngắn nhất | Lối vào (file:dòng) | Đánh dấu |
|---|---|---|---|---|---|
| Mua lại | 1 (mở bảng chọn; xác nhận là chạm 2 rồi tự sang giỏ) | 2 | Kệ "Mua lại" ở Trang chủ (khách cũ). Cũng ở thẻ đơn Đã giao | `purchased-rail.tsx:99,152,168`; "Xem tất cả" `:113` tới `/orders?tab=delivered` | Chỉ khách cũ có kệ (`home-layout.ts:18`); ẩn khi rỗng (`purchased-rail.tsx:99`) |
| Gói định kỳ (xem) | 2 | 2 | Cá nhân > ô "Định kỳ" (tab "Định kỳ" của trang Đơn hàng) | `profile.tsx:319-343`; `orders-tabs.ts:22` | `/subscriptions` chỉ là chuyển hướng (`app.tsx:250`); duy nhất một chỗ trỏ tới: thông báo `notifications.tsx:139` |
| Gói định kỳ (tạo) | 1-2 | 2-3 | Nút "Định kỳ" trên kệ Mua lại, hoặc trên trang sản phẩm | `purchased-rail.tsx` (SubscribeSheet); `product-detail.tsx` (tuỳ chọn định kỳ) | Chưa kiểm số chạm từng đường |
| Flash sale / giờ vàng | 1 | 2 | Khối Giờ vàng ở Trang chủ, chạm thẻ mở trang sản phẩm | `flash-sale.tsx:132`; ẩn khi rỗng `:92-93` | Chỉ có ở Trang chủ (không có trang "xem tất cả" giờ vàng, không có nút "Xem thêm" ở `flash-sale.tsx:65-175`). "Sắp diễn ra" chỉ khi đăng nhập (`:285`). PROD hiện trống |
| Mua chung | 1 | 2 | Trang chủ: lối tắt "Mua chung". Thanh đáy: Ưu đãi > "Mua chung nhóm". Mở nhóm: ở trang sản phẩm | `shortcut-grid.tsx:18`; `offers.tsx:90`; `product-detail.tsx:267` | `/group-buy/:id` `[LINK]` (xem mục A1b) |
| Nhãn hàng (trang `/brand/:slug`) | 1 | 2 | Chip nhãn ở khối "Hành trình nguyên liệu" Trang chủ | `brand-journey.tsx:56` (chip có `slug`) | Mini App không có lối sang trang nhãn từ Danh mục hay trang sản phẩm: tên nhãn ở trang sản phẩm dẫn tới `/browse?brand=` (`product-detail.tsx:363`, `utils/brands.ts:39`). Web có (`browse-view.tsx:267`) |
| Học viện (danh sách) | 2 | 2 | Cá nhân > Học viện, hoặc Kiếm tiền > Học viện | `profile.tsx:56`; `earn-sheet.tsx:11` | |
| Học viện (một khoá) | 3 | 3 | Cá nhân > Học viện > khoá | `academy.tsx:56` | `[>2]` |
| Cộng đồng | 1 | 2 | Trang chủ: lối tắt "Cộng đồng" hoặc "Xem tất cả" ở khối Cộng đồng. Vườn Xanh có hàng "Cộng đồng" | `shortcut-grid.tsx:22`; `community-preview.tsx:73`; `game.tsx:342` | Cá nhân và Ưu đãi không có lối. Chỉ đọc (đã chốt). Sự kiện: 2 (`feed.tsx:156`); bài: 2 (`feed.tsx:262`) |
| Quét QR / nhập mã đơn sàn | 1 | 2 | Trang chủ: lối tắt "Tích điểm đơn sàn". Ưu đãi > hàng cùng tên | `shortcut-grid.tsx:20`; `offers.tsx:89` | `[CỜ]` `marketplaceClaimEnabled`. PROD tắt: ẩn. Chỉ Mini App (route-map `skip`) |
| Yêu thích | 2 | 2 | Cá nhân > "Sản phẩm yêu thích". Thêm: tim trên thẻ SP (1 chạm, tại chỗ) | `profile.tsx:63`; `product-tile.tsx:173-176` | |
| Địa chỉ | 2 | 2 | Cá nhân > "Sổ địa chỉ". Cũng ở Cài đặt (3) và khi thanh toán | `profile.tsx:64`; `settings.tsx:166`; `checkout.tsx:519` | |
| Thông báo | 1 | 2 | Chuông ở đầu Trang chủ. Cá nhân > "Thông báo" (2) | `home-header.tsx:28-34`; `profile.tsx:65` | Chuông chỉ có ở Trang chủ; badge số chưa đọc (`home.tsx:49`) |
| Cài đặt, sửa hồ sơ | 2 | 2 | Cá nhân > Cài đặt; chạm vùng tên/ảnh ở đầu trang Cá nhân > Sửa hồ sơ | `profile.tsx:66,241` | |
| Trợ lý AI | 2 | 2 | Cá nhân > "Trợ lý AI 24/7" | `profile.tsx:73,138` | `[CỜ]` `aiAdvisorEnabled`. PROD tắt: ẩn. Từng có thẻ ở Trang chủ, nay không (xem mục C: `home-extras.tsx` không còn được nhập) |
| Câu chuyện thương hiệu | 1 | 2 | Thẻ "Hành trình nguyên liệu" Trang chủ. Cá nhân > "Câu chuyện thương hiệu" (2) | `brand-journey.tsx:32`; `profile.tsx:74` | |
| Về Tubu Tree, hotline | 2 | 2 | Cá nhân > "Về Tubu Tree & Hỗ trợ" | `profile.tsx:75` | |
| Quản lý nhãn hàng (chủ nhãn) | 2 | 2 | Cá nhân > "Quản lý nhãn hàng" | `profile.tsx:150-152` | Chỉ khi sở hữu nhãn |
| Ca làm, Lương của tôi, Quản trị nhân sự | 2 | 2 | Cá nhân > nhóm "Công việc" | `profile.tsx:154-163` | Theo vai trò STAFF/ADMIN. Kiểm duyệt cộng đồng: 3 (`admin.tsx:95`) `[>2]` |
| Hoàn tiền sàn ngoài (`/cashback`) | | | Không có lối vào | `profile.tsx:146-148` (chỉ thêm khi `CASHBACK_ENABLED`); `app.tsx:241` chuyển về `/` | `[CỜ]` hằng số `features.ts:11`. Cũng `[LINK]` về kỹ thuật (route còn, chuyển về `/`) |

### A1b. Mini App: việc chỉ vào được bằng link (không có `navigate` từ màn khác)

1. `/s/:slug` (gian hàng CTV công khai): khách chỉ tới bằng link `?s=`/`/s/...`. Trong app chỉ có hai chỗ trỏ tới và đều cần ngữ cảnh gian hàng đã có: quay lại sau đặt đơn (`order-success.tsx:80`), nút quay lại (`back-button.tsx:90`), và nút "xem" của chính chủ gian hàng (`storefront-builder.tsx:412`).
2. `/group-buy/:id`: chỉ link chia sẻ (`group-buy.tsx:80`) và ngay sau khi tạo nhóm (`product-detail.tsx:267`). Danh sách ở `/group-buy` mở sản phẩm, không mở nhóm (`group-buy.tsx:93`).
3. `/refill`: chuyển hướng cũ sang `/recycle` (`app.tsx:217`), không có chỗ nào trỏ tới.
4. `/feed/leaderboard`: chuyển hướng sang `/feed` (`app.tsx:211`), không còn trang `community-leaderboard`. route-map vẫn ghi cặp `/feed/leaderboard` <-> `/cong-dong/xep-hang` (private).
5. `/subscriptions`: chuyển hướng sang `/orders?tab=subscriptions` (`app.tsx:250`); chỉ trỏ từ thông báo (`notifications.tsx:139`).
6. `/cashback`: không có lối, chuyển về `/` (`app.tsx:241`).
7. `/brand/:slug` KHÔNG phải link-only nhưng chỉ có một lối thật từ giao diện chính: chip ở Trang chủ (`brand-journey.tsx:56`); chủ nhãn có thêm `brand-owner.tsx:203`.
8. Tham số `?s=`, `?ref=` (`app.tsx:176-185`) và sự kiện `OpenApp` (`open-app-router.tsx`) là đường vào từ ngoài; không đếm.

---

## A2. Bản đồ lối vào, web khổ điện thoại

Khung điện thoại: `SiteHeader` ẩn dưới md (`site-header.tsx:28` `hidden md:block`), thanh đáy `md:hidden`, chân trang gọn có hotline và chính sách (`site-footer.tsx:147`, ẩn khi trang có thanh dính đáy). Số chạm giống Mini App trừ các dòng ghi "khác". Mọi route web đều có trong route-map nên không có mục nào bị ẩn vì `pending` (`web-nav.ts:30`, `route-map.json` không có `pending`).

| Việc | Từ Trang chủ | Từ thanh đáy | Đường đi ngắn nhất | Lối vào (file:dòng) | Đánh dấu |
|---|---|---|---|---|---|
| Tìm sản phẩm | 1 | 2 | Ô tìm Trang chủ > `/san-pham?focus=search`. Danh mục > chạm ô | `home-view.tsx:140-151`; `browse-view.tsx:158-190` | Không dính đầu trang |
| Duyệt danh mục | 1 | 1 | Tab Danh mục; hàng danh mục | `web-nav.ts:15`; `home-view.tsx:104-111` | |
| Giỏ hàng | 1 | 2 | Nút giỏ đầu Trang chủ; nút giỏ đầu Danh mục | `home-header.tsx:37`; `browse-view.tsx:203` (`PhoneCartButton`) | Giống Mini App: Ưu đãi/Vườn Xanh/Cá nhân không có nút giỏ |
| Thanh toán | 2 | 3 | Giỏ > "Thanh toán". "Mua ngay" ở trang SP đi thẳng | `gio-hang/page.tsx:489-536`; `add-to-cart.tsx:143` | `[>2]` từ thanh đáy |
| Theo dõi đơn (danh sách) | 2 | 2 | Cá nhân > ô trạng thái / "Xem tất cả" | `tai-khoan/page.tsx:271,282-297` | |
| Theo dõi đơn (một đơn) | 3 (1 qua "Việc cần làm") | 3 | như Mini App | `todo-strip.tsx:46,120` | `[>2]` |
| Hạng và Điểm Xanh | 1 | 1 | Tab Ưu đãi; thẻ thành viên Trang chủ (khách cũ) | `member-card.tsx:74`; `uu-dai/page.tsx:152` (sang `/tai-khoan/diem-xanh`) | |
| Kho quà | 1 | 2 | Lối tắt "Đổi quà"; Ưu đãi > "Đổi quà" | `shortcut-grid.tsx:17`; `uu-dai/page.tsx:117` | |
| Quà đã đổi | 2 | 2 | Ưu đãi > "Quà của tôi" | `uu-dai/page.tsx:118`; `kho-qua/page.tsx:271` | |
| Mã giảm giá | 1 | 1 | Lối tắt "Mã của tôi"; tab Ưu đãi | `shortcut-grid.tsx:21`; `uu-dai/page.tsx:100-106` | |
| Vườn Xanh | 1 | 1 | Tab giữa | `web-nav.ts:18` | |
| Điểm danh | 1 (khách cũ) / 2 | 2 | Thẻ thành viên; Ưu đãi; Vườn Xanh; `/tai-khoan/diem-xanh` | `member-card.tsx:141-153`; `uu-dai/page.tsx:225`; `vuon-xanh/page.tsx:218-221`; `tai-khoan/diem-xanh/page.tsx:249` | |
| Đổi rác lấy quà | 1 | 2 | Lối tắt; Ưu đãi; Điểm Xanh | `shortcut-grid.tsx:19`; `uu-dai/page.tsx:120-127`; `tai-khoan/diem-xanh/page.tsx:151` | `[CỜ]` `waste.enabled`. Khác Mini App: web hiện `MiniAppOnlyNotice` khi khách không đủ điều kiện (`recycle-home.tsx:249`, `recycle-new.tsx:315`, `recycle-points.tsx:108`, `recycle-requests.tsx:65`) |
| Chat CSKH | 2 | 2 | Cá nhân > "Chat với Tubu Tree"; cuối trang SP | `account-menu.ts:65`; `pdp-extras.tsx:335,356` | `[CỜ]` `chat.enabled` (PROD tắt) |
| CTV (đăng ký, hoa hồng) | 2 | 2 | Cá nhân > mục CTV; Kiếm tiền > CTV | `account-menu.ts:46`; `earn-sheet.tsx:9` | |
| CTV: Gian hàng | 3 | 3 | CTV > "Gian hàng" | `ctv/page.tsx:371-372` | `[>2]` |
| Đại lý | 2 | 2 | Cá nhân; Kiếm tiền | `account-menu.ts:35-48`; `earn-sheet.tsx:11` | |
| Ví Tubu | 2 | 2 | Cá nhân > ô "Ví" | `tai-khoan/page.tsx:260` | Lối duy nhất (ngoài `vuon-xanh/page.tsx:66`) |
| Mua lại | 1 | 2 | Kệ Mua lại | `components/reorder/purchased-rail.tsx` | khách cũ |
| Gói định kỳ | 2 | 2 | Cá nhân > ô "Định kỳ" | `tai-khoan/page.tsx:287` | |
| Flash sale | 1 | 2 | Khối Giờ vàng | `home/flash-sale.tsx:94` | Chỉ Trang chủ; PROD trống |
| Mua chung | 1 | 2 | Lối tắt; Ưu đãi | `shortcut-grid.tsx:20`; `uu-dai/page.tsx:127` | `/mua-chung/:id` `[LINK]` (chia sẻ; sau khi tạo `pdp-extras.tsx:251`) |
| Nhãn hàng | 1 | 2 | Chip "Hành trình nguyên liệu"; Danh mục lọc 1 nhãn có thêm liên kết "Xem trang nhãn hàng" | `brand-journey.tsx:51`; `browse-view.tsx:150,267` | Khác Mini App: web có lối từ Danh mục, Mini App không |
| Học viện | 2 (khoá 3) | 2 | Cá nhân; Kiếm tiền; từ trang CTV | `account-menu.ts:47`; `ctv/page.tsx:452-454` | khoá `[>2]` |
| Cộng đồng | 1 | 2 | Lối tắt; "Xem tất cả" | `shortcut-grid.tsx:24`; `community-preview.tsx:70` | Web có thêm "Bảng xếp hạng" (`cong-dong/feed-view.tsx:183`); Mini App chuyển `/feed/leaderboard` về `/feed` |
| Quét mã đơn sàn | | | Không có trên web | Lối tắt bị lọc (`shortcut-grid.tsx:41-44`, route `skip`); hàng ở Ưu đãi hiện nhưng chỉ ra thông báo "dùng Mini App" (`uu-dai/page.tsx:126,245`) | `[CỜ]` `marketplaceClaimEnabled` (PROD tắt) + chỉ Mini App |
| Yêu thích | 2 | 2 | Cá nhân | `account-menu.ts:55` | |
| Địa chỉ | 2 | 2 | Cá nhân; Cài đặt (3); thanh toán | `account-menu.ts:56`; `cai-dat/page.tsx:154` | |
| Thông báo | 1 | 2 | Chuông Trang chủ; Cá nhân | `home-header.tsx:31-35`; `account-menu.ts:57` | Chuông chỉ ở Trang chủ |
| Cài đặt, hồ sơ | 2 | 2 | Cá nhân | `account-menu.ts:59`; `tai-khoan/page.tsx:214` | |
| Trợ lý AI | 2 | 2 | Cá nhân | `account-menu.ts:66` | `[CỜ]` `aiAdvisorEnabled` (PROD tắt) |
| Câu chuyện, Về Tubu Tree | 1 / 2 | 2 | Thẻ Trang chủ; Cá nhân; chân trang gọn chỉ có hotline + chính sách | `brand-journey.tsx:27`; `account-menu.ts:67-68` | |
| Hoàn tiền sàn ngoài | | | Không có lối vào | `account-shell.tsx:130` lọc bằng `CASHBACK_ENABLED`; `account-menu.ts:58` | `[CỜ]` hằng số. Khác Mini App: URL `/hoan-tien` vẫn chạy trang thật (noindex, `hoan-tien/layout.tsx`), Mini App chuyển về `/` |
| Đối tác `/merchant` | | | Chỉ từ trang đại lý | `components/dealer/dealer-hub.tsx:50` | `[LINK]` (cổng web riêng, không thuộc route-map, Mini App không có) |
| Vai trò: Ca làm, Lương, Quản trị, Chủ nhãn | 2 | 2 | Cá nhân > nhóm "Công việc" | `account-menu.ts:49,73-82` | theo vai trò |

Web: việc chỉ vào bằng link: `/s/:slug` (`merchant/page.tsx:322`, `thanh-toan/page.tsx:171`, chỉ khi có ngữ cảnh gian hàng), `/mua-chung/:id`, `/hoan-tien`, `/merchant`, `/cong-dong/xep-hang` KHÔNG phải link-only (có `feed-view.tsx:183`). Đường cũ của Mini App (`/browse`, `/cart`...) được web chuyển hướng 307 từ route-map (`lib/miniapp-redirects.mjs`) nên link Mini App dán ra web vẫn sống.

### A4. Tóm tắt phần A

Việc `[>2]` (cả hai kênh, số chạm giống nhau): mở một đơn (3, hoặc 1 nếu qua "Việc cần làm"); đơn đã huỷ/trả (3, mở đơn 4); Thanh toán từ thanh đáy (3); Gian hàng CTV (3, xem thử 4); một khoá Học viện (3); hoa hồng từ Ví (3); kiểm duyệt cộng đồng của admin (3).
Việc chỉ vào bằng link: `/s/:slug`, `/group-buy/:id` (Mini App) và `/mua-chung/:id` (web), `/refill`, `/feed/leaderboard` (Mini App), `/subscriptions` (chỉ từ thông báo), `/cashback` + `/hoan-tien`, `/merchant` (web).
Việc bị cờ ẩn: Đổi rác (`waste.enabled`), Tích điểm đơn sàn (`marketplaceClaimEnabled`), Trợ lý AI (`aiAdvisorEnabled`), Chat CSKH (`chat.enabled`), Hoàn tiền sàn ngoài (`CASHBACK_ENABLED`); dòng "dự kiến giao" ẩn vì `shippingEta=null`.
Ba việc chỉ có MỘT lối: Ví Tubu (ô Ví ở Cá nhân), Giờ vàng (chỉ Trang chủ), trang nhãn Mini App (chỉ chip Trang chủ).
Việc chính nằm tối đa 3 chạm; chỉ đơn đã huỷ/trả và xem thử gian hàng CTV tới 4. Ví Tubu và đơn "Đang xử lý" là hai chỗ khách dễ khó tìm vì lối duy nhất đi qua Cá nhân.

---

## B. Đối chiếu mẫu tương tác

Ghi: có / một phần / thiếu. M = Mini App, W = web khổ điện thoại.

### Shopee

| Mẫu | M | W | Bằng chứng | Ghi chú |
|---|---|---|---|---|
| Ô tìm kiếm dính đầu trang | thiếu | thiếu | M: ô tìm là khối trong dòng cuộn `home.tsx:128-165`, `browse.tsx:156-175`; trong `apps/miniapp/src`, `position: sticky` chỉ có ở `game.tsx:183` (thanh con của Vườn Xanh), ô nhập chat `support-chat.tsx:255` và thanh hành động đáy; không có cho ô tìm. W: `home-view.tsx:140-151` (`pb-3`, trong dòng cuộn), `browse-view.tsx:158`; thanh đầu sticky chỉ từ md (`site-header.tsx:28`) | Cuộn xuống lưới SP rồi muốn tìm lại phải cuộn lên đầu |
| Lịch sử tìm | có | có | M: `browse.tsx:62,108`, `suggest-list.tsx:15,59-70` (3 mục gần nhất, có "Xoá"). W: `browse-view.tsx:78-79,115` | Ô trống chỉ hiện lịch sử; không có "từ khoá nổi bật" |
| Gợi ý khi gõ | có | có | M: `use-suggest.ts:24-32` (sản phẩm, có giá giờ vàng `suggest-list.tsx:89`) + danh mục `:77-86`. W: `suggest-list.tsx:43,90` | |
| Lưới lối tắt dưới banner | một phần | một phần | Lưới có: 4 cột `shortcut-grid.tsx:42` (M), `shortcut-grid.tsx:47` (W). Banner không có: danh sách khối `home-layout.ts:18-27` không có banner/hero | Trên PROD chỉ 6/8 ô (waste và claim tắt) nên hàng 2 chỉ 2 ô |
| Thẻ SP: ảnh vuông, giá nổi, đã bán, nhãn giảm | có | có | M: `product-tile.tsx:101` (`aspectRatio 1/1`), `:190-193` (đã bán, `format.ts:58-65`), `:200` (giá + gạch giá), `catalog-grid.tsx:30-40` (nhãn `-%` và nhãn giờ vàng). W: `product-card.tsx:28,45-50,86-89` | Không có nút thêm giỏ nhanh trên thẻ (cả hai) |
| Trang SP: thanh mua dính đáy | có | có | M: `product-detail.tsx:881-948` (giỏ + "Thêm giỏ" + "Mua ngay · giá"). W: `add-to-cart.tsx:300-334` | |
| Chọn phân loại bằng bottom sheet có ảnh và tồn kho | thiếu | thiếu | M: chip nằm thẳng trong trang `product-detail.tsx:619-636`, chip chỉ có tên + giá `:1103-1145`; tồn kho chỉ báo khi ≤5 (`LOW_STOCK_THRESHOLD` `:69`, `:440`); hết hàng thì gạch. W: `add-to-cart.tsx:221-263`, "Chỉ còn N" ≤ ngưỡng. Kiểu `VariationDetail` không có trường ảnh (`shop-api.ts:35-43`); API PROD trả biến thể gồm `attributes,id,name,retailPrice,salePrice,sku,stock,weight`, không ảnh | Mẫu 20/100 SP ngẫu nhiên trên PROD: 5 SP có >1 phân loại (25%). Chưa đo tỉ lệ lượt xem SP nhiều phân loại |
| Giỏ chọn từng món, tổng dính đáy | có | có | M: `cart.tsx:86-90,238,259`, `StickyActionBar` `:687`. W: `gio-hang/page.tsx:41,237,284`, `:489-536` | Cả giỏ có mã giảm và có hoàn tác xoá |
| Thanh toán một trang | có | có | M: `checkout.tsx:519` (địa chỉ), `:578` (phí giao theo lô), `:597,1140` (mã giảm), `:687` (phương thức), `:1077` (sticky), `:1159` (chi tiết tính tiền). W: `thanh-toan/page.tsx:469,496,535,650,813` | Không có lựa chọn đơn vị vận chuyển (chỉ một, phí theo gian hàng giao); ngày giao không có (xem Grab) |
| Cá nhân: hàng trạng thái đơn kèm số đếm, ví, điểm, mã | có | có | M: `profile.tsx:289-293` (Điểm, Ví, Mã), `:319-343` (5 ô, đếm ở `:218-222`). W: `tai-khoan/page.tsx:259-261,282-297` | "Đã giao" không có số đếm theo thiết kế (`home-layout.ts:209`); "Chờ xác nhận/Chờ lấy hàng" gộp thành "Đang xử lý"; không có ô Đánh giá / Trả hàng (vào qua tab "Đã đóng") |

### Grab

| Mẫu | M | W | Bằng chứng | Ghi chú |
|---|---|---|---|---|
| Trang chủ lấy hành động làm trung tâm, ít chữ | một phần | một phần | Khách cũ: thẻ thành viên có 2 nút hành động (Điểm danh, Đổi quà) `member-card.tsx:139-181`, rồi Việc cần làm, lối tắt. Khách mới/chưa đăng nhập: khối "Quà khách mới" đứng TRƯỚC lối tắt, gồm tiêu đề, dòng voucher, câu giới thiệu, 3 dòng lợi ích và 1 nút (`new-customer-gift.tsx:111-189`). Tổng 9-10 khối (mục C) | Chưa đo chiều cao thật của khối chữ |
| Theo dõi đơn: dòng thời gian có mốc dự kiến | một phần | một phần | Dòng thời gian dọc có: M `order-detail.tsx:329-340,855-890`, giờ từng bước đã qua `order-status.ts:74-82`; sự kiện vận chuyển `order-detail.tsx:251,547`. W: `order-timeline.tsx`, `don-hang/[code]/page.tsx:245,356-400`. Mốc dự kiến chỉ có ở lúc đặt (`checkout.tsx:96,1014`, `order-success.tsx:102,163`), là khoảng ngày cấu hình, không nằm trên dòng thời gian | PROD `shippingEta=null` nên dòng này không hiện. Mã cũ B-148 (ngày giao dự kiến, việc chủ) |
| Điểm và hạng, tiến độ lên hạng rõ | có (Cá nhân: một phần) | có (Cá nhân: một phần) | Thanh tiến độ + câu "Còn X mua hàng lên Y": `member-card.tsx:96-113`, `offers.tsx:150-190`, `loyalty.tsx:202-217`. W: `member-card.tsx:99-112`, `uu-dai/page.tsx:183-196`, `tai-khoan/diem-xanh/page.tsx:175`. Trang Cá nhân chỉ có nhãn hạng, không có tiến độ (`profile.tsx:251-255`) | |
| Skeleton thay spinner | một phần | có (chưa kiểm hết) | M: skeleton có ở thẻ thành viên `member-card.tsx:22-28`, Việc cần làm `todo-strip.tsx:57-63`, lưới SP `catalog-grid.tsx:86-104`, Đơn `orders.tsx:87-91`, Giỏ `cart.tsx:376-381`. Nhưng 50 trang tải lười (`app.tsx:46-95`, chỉ Trang chủ nạp sẵn) và `Suspense` dùng `<Spinner/>` (`app.tsx:102-108,199`): lần đầu mở mỗi màn là vòng quay giữa màn hình. W: không có file `loading.tsx` nào (0 file), trang dùng khung chờ của từng trang (`AuthLoading` `login-required.tsx:28-37`, `gio-hang/page.tsx:213-215`); vòng quay chỉ ở nút nhỏ | Chưa đo thời gian chunk Mini App; chưa kiểm khoảng trắng khi chuyển trang ở web |
| Phản hồi tức thì sau thao tác | một phần | một phần | Xem bảng dưới | |

Bảng phản hồi (M = Mini App, W = web):

| Thao tác | M | W |
|---|---|---|
| Thêm giỏ | Nút quay "loading", xong mới toast 2 giây + badge giỏ nảy (`product-detail.tsx:225-233`). Không lạc quan | Nút ghi "Đang thêm…", xong có dòng "Đã thêm vào giỏ! Xem giỏ hàng" trong thanh dính (`add-to-cart.tsx:146,255-264`). Không lạc quan. Web không có toast (không có `Snackbar`/`toast` trong `apps/web/src`) |
| Yêu thích | Lạc quan: đổi tim ngay trên cache, xếp hàng lệnh (`wishlist-heart.tsx:68`). Không toast | Như Mini App (`catalog/wishlist-heart.tsx:72`) |
| Điểm danh | Không lạc quan: nút khoá, xong mới toast + cập nhật (`use-check-in.ts:18-24`) | Không lạc quan, thông báo trong thẻ (`member-card.tsx:163-165`) |
| Áp mã | Nút quay, xong mới toast (`voucher-sheet.tsx:75-100,175`). Không lạc quan | chưa kiểm từng dòng (`checkout/voucher-sheet` web) |
| Đổi số lượng trong giỏ | Lạc quan có hoàn tác khi lỗi (`cart.tsx:51-72`) | Không lạc quan: chờ máy chủ rồi `setQueryData`, khoá dòng đang gửi (`gio-hang/page.tsx:70-76,107-110`) |
| Nhắc giờ vàng | Lạc quan (`flash-sale.tsx:267-281`) | Lạc quan (`home/flash-sale.tsx:166`) |

---

## C. Trang chủ: các khối theo thứ tự hiển thị

Thứ tự dùng chung Mini App và web: `packages/app-core/src/home-layout.ts:18-27`, hàm `homeBlockOrder`. Mini App dựng ở `home.tsx:71-123`; web ở `home-view.tsx:90-131`. Cả hai bỏ qua cờ `homeNewCustomerLayout` do API trả (không có chỗ nào ở Mini App/web đọc; chỉ `apps/api/src/modules/system-config/public-config.ts:81,171` và kiểu dữ liệu), nên cờ đó không có tác dụng ở client.

Khung đầu trang (không tính khối): logo (không bấm ở Mini App, là link về `/` ở web), chuông (tới Thông báo, badge số chưa đọc), giỏ (badge số món). Mini App `home-header.tsx:15-40`; web `home-header.tsx:21-44` (`md:hidden`).

Loại khách: khách cũ = đã nhận ít nhất một SP (`home-layout.ts:58-60`); mới = chưa đăng nhập hoặc chưa nhận SP; "chưa biết" = đang khôi phục phiên và chưa nhớ (`home-layout.ts:40-55`).

| # | Khối | Cũ | Mới / chưa đăng nhập | Điều kiện hiện | Hành động chính (Mini App / web) |
|---|---|---|---|---|---|
| 1 | Ô tìm (`search`) | 1 | 1 | Luôn. Web: chỉ điện thoại | Chạm: sang Danh mục có focus ô tìm (`home.tsx:139` / `home-view.tsx:144`) |
| 2 | Thẻ thành viên (`member`) | 2 | không | Khách cũ đã đăng nhập; "chưa biết" hiện khung chờ cao 186px (`member-card.tsx:20`) | Điểm danh (tại chỗ), Đổi quà (`/rewards`), chạm phần số (`/offers`) |
| 3 | Việc cần làm (`todo`) | 3 | 2 | Đã đăng nhập VÀ có đơn chờ thanh toán hoặc đang giao (tối đa 2 dòng); ẩn khi trống (`todo-strip.tsx:75,111`) | "Thanh toán ngay" (trang chuyển khoản) hoặc mở đơn / danh sách đang giao |
| 4 | Quà khách mới (`welcome`) | không | 3 | Khách mới: cấu hình tải xong; đã đăng nhập thì máy chủ báo `isNewCustomer` (`new-customer-gift.tsx:85-87`); lỗi/đang tải thì không vẽ | "Mua sắm" (tới Danh mục) hoặc, tài khoản khách, "Liên kết Zalo" |
| 5 | 8 lối tắt (`shortcuts`) | 4 | 4 | Luôn; Đổi rác ẩn theo `waste.enabled` (còn hiện nếu khách có yêu cầu mở), Tích điểm đơn sàn ẩn theo `marketplaceClaimEnabled`; web ẩn thêm ô đơn sàn vì chưa có trang (`shortcut-grid.tsx:41-44`) | Đổi quà, Vườn Xanh, Đổi rác, Mua chung, Mã của tôi, Tích điểm đơn sàn, Kiếm tiền (bảng 3 mục), Cộng đồng. PROD hiện 6 ô |
| 6 | Mua lại (`purchased`) | 5 | không | Khách cũ; ẩn khi rỗng (`purchased-rail.tsx:99`) | "Mua lại" / "Định kỳ" từng món; "Xem tất cả" tới đơn đã giao |
| 7 | Giờ vàng + Sắp diễn ra (`flash`) | 6 | 5 | Có suất đang chạy (`flash-sale.tsx:92-93`); "Sắp diễn ra" chỉ khi đăng nhập và có suất lên lịch (`:285`). PROD hiện trống | Chạm thẻ mở SP; "Nhắc tôi" |
| 8 | Danh mục (`categories`) | 7 | 6 | Luôn (khung chờ khi tải) | Chạm ô: `/browse?category=` hoặc `?segment=` |
| 9 | Bán chạy (`bestSellers`) | không | 7 | Khách mới; ẩn khi rỗng (`best-seller-rail.tsx:25`) | Chạm thẻ; "Xem tất cả" tới `?sort=best_seller` |
| 10 | Hành trình nguyên liệu (`journey`) | 8 | 8 | Luôn; dải chip nhãn chỉ khi có nhãn (`brand-journey.tsx:53`) | Thẻ tới Câu chuyện thương hiệu; chip tới trang nhãn |
| 11 | Cộng đồng (`community`) | 9 | 9 | Có bài: khách đăng nhập thấy 2 bài mới nhất; khách chưa đăng nhập chỉ khi cờ `communityPublicPreview` và có bài; không bài/lỗi thì ẩn (`community-preview.tsx:59`) | "Xem tất cả"; mở bài (khách đăng nhập). Chỉ đọc |
| 12 | Gợi ý cuộn vô tận (`suggest`) | 10 | 10 | Luôn | Chip Cho bạn / Bán chạy / Mới; lưới 12 SP/trang; "Xem thêm" khi không đo được cuộn |

Cột "Cũ", "Mới": vị trí khối. "Chưa biết" bỏ khối 4, 6, 9 và giữ khung chờ ở vị trí 2 (`home-layout.ts:27`). Thứ tự khối của Mini App và web trùng (cả hai gọi `homeBlockOrder`); khác nhau ở khung đầu trang và việc web đổ sẵn HTML phía máy chủ cho phần công khai (`app/page.tsx`).

### Nhận xét ngắn (chỉ dựa trên mã, chưa đo ảnh)

1. **Quà khách mới (khối 4)**: nhiều chữ nhất Trang chủ (tiêu đề, 1-2 dòng voucher, câu dẫn, 3 dòng lợi ích, nút), đứng trước lối tắt. Nút "Mua sắm" lặp lại ô tìm và Danh mục. Giá trị thật là nêu mã chào mừng và miễn phí vận chuyển đơn đầu (PROD: 30.000đ, đơn từ 199.000đ), nhưng chiếm chỗ của hành động. Chưa đo chiều cao.
2. **Cộng đồng (khối 11) và lối tắt "Cộng đồng"**: hai lối cùng đích `/feed` trên cùng màn; Mini App chỉ đọc (`community-preview.tsx:27`). Giá trị chuyển đổi thấp so với vị trí ngay trước lưới sản phẩm.
3. **Hành trình nguyên liệu (khối 10)**: nằm giữa trang, đẩy lưới gợi ý (khối bán hàng chính) xuống sau 8-9 khối; nhưng là lối DUY NHẤT sang trang nhãn trên Mini App, nên không bỏ được nếu không thêm lối khác.
4. **Bán chạy (khối 9, khách mới) và tab "Bán chạy" trong khối 12**: cùng nguồn `sort=best_seller`, cách nhau 3 khối (`best-seller-rail.tsx:22`, `suggest-feed.tsx:25-31`).
5. **Lối tắt "Đổi quà" và nút "Đổi quà" trên thẻ thành viên (khách cũ)**: cùng đích `/rewards` trong màn đầu; lối tắt "Mã của tôi" trùng tab Ưu đãi. Hàng lối tắt thứ 2 chỉ có 2 ô khi cờ tắt (6/8).
6. **Giờ vàng (khối 7)**: trên PROD đang trống nên Trang chủ không có khối ưu đãi nào thấy ngay; khách mới chỉ có Quà khách mới (chữ). Không có banner ưu đãi hay hero (đã nêu ở B).
7. **Ô tìm không dính** nên khi cuộn lưới gợi ý (dài, cuộn vô tận) khách mất ô tìm; có nút giỏ và chuông cũng cuộn đi.
8. **Mã chết**: `apps/miniapp/src/components/home/home-extras.tsx` (`HomeExtras`: thẻ Trợ lý AI, Mua chung, hero "Tìm sản phẩm", dải nhãn) không còn được nhập ở đâu (grep toàn `apps/miniapp/src` chỉ thấy định nghĩa). Kéo theo: lối vào Trợ lý AI từ Trang chủ đã mất, chỉ còn Cá nhân.

## D. Chưa kiểm

- Chiều cao và tỉ lệ diện tích từng khối trên màn 375px (cần ảnh chụp).
- Tỉ lệ khách mở thẻ "Quà khách mới" hay bấm "Mua sắm" (cần số liệu sự kiện).
- Có/không ô tìm trên Zalo thật khi cuộn (chỉ đọc mã, không chạy Zalo).
- Hành vi khách chưa đăng nhập trong Mini App thật (đăng nhập ngầm).
- Web: khoảng trắng khi chuyển trang vì không có `loading.tsx`; web áp mã ở `thanh-toan` (chưa mở file voucher web).
- Mua chung: số chạm tạo nhóm từ trang SP (`product-detail.tsx:~650-670`); Gói định kỳ tạo: chưa đếm từng đường.
