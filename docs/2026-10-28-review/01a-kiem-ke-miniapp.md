# Kiểm kê màn hình Zalo Mini App

Commit: 77bf4676 (nhánh main, chỉ đọc). Nguồn: apps/miniapp/src/components/app.tsx (55 `<Route>`, gồm 2 `Navigate` chuyển hướng và `*`).
Cột "Điều kiện" dựa vào mã; "theo route-map private=true" nghĩa là web đánh dấu cần đăng nhập, mã page chưa kiểm từng dòng.

| Route | File nguồn | Chức năng | Điều kiện hiện | Lối vào | Route web |
|---|---|---|---|---|---|
| / | pages/home.tsx (app.tsx:191) | Trang chủ: tìm kiếm, kệ, sản phẩm, khối phụ | Công khai; khối theo home-blocks.ts:11-25 | Thanh đáy Trang chủ (nav-config.ts:17) | / |
| /browse | pages/browse.tsx (app.tsx:192) | Danh mục và tìm sản phẩm | Công khai | Thanh đáy Danh mục (nav-config.ts:18); home.tsx:136 | /san-pham |
| /product/:slug | pages/product-detail.tsx (app.tsx:193) | Chi tiết sản phẩm | Công khai | Thẻ sản phẩm product-card.tsx:44; home.tsx (khối SP) | /san-pham/:slug |
| /cart | pages/cart.tsx (app.tsx:194) | Giỏ hàng | Theo route-map private=true | Nút giỏ cart-button.tsx:20; home-header.tsx:36 | /gio-hang |
| /checkout | pages/checkout.tsx (app.tsx:195) | Thanh toán | Theo route-map private=true | cart.tsx:207; product-detail.tsx:249 | /thanh-toan |
| /bank-payment/:code | pages/bank-payment.tsx (app.tsx:196) | Chuyển khoản theo mã đơn | Theo route-map private=true | orders.tsx:118; order-detail.tsx:736 | /thanh-toan/chuyen-khoan/:code |
| /orders | pages/orders.tsx (app.tsx:197) | Danh sách đơn và tab Định kỳ | Theo route-map private=true | Thanh đáy Đơn hàng (nav-config.ts:20); order-strip.tsx:87 | /tai-khoan/don-hang |
| /order/:code | pages/order-detail.tsx (app.tsx:198) | Chi tiết một đơn | Theo route-map private=true | orders.tsx:114 | /tai-khoan/don-hang/:code |
| /game | pages/game.tsx (app.tsx:199) | Vườn Xanh (trò chơi, điểm) | Chưa đăng nhập: cổng đăng nhập game.tsx:92; khối rác chỉ khi waste.enabled (game.tsx:165) | Thanh đáy giữa Vườn Xanh (nav-config.ts:19); loyalty.tsx:459 | /vuon-xanh |
| /feed | pages/feed.tsx (app.tsx:200) | Cộng đồng hỏi đáp | Công khai (route-map private=false) | Home cuối trang home-extras.tsx:106; profile.tsx:52 | /cong-dong |
| /feed/leaderboard | pages/community-leaderboard.tsx (app.tsx:201) | Xếp hạng cộng đồng | Theo route-map private=true | feed.tsx:162 | /cong-dong/xep-hang |
| /feed/events | pages/community-events.tsx (app.tsx:202) | Sự kiện cộng đồng | Theo route-map private=true | feed.tsx:172 | /cong-dong/su-kien |
| /feed/:id | pages/post-detail.tsx (app.tsx:203) | Chi tiết bài viết | Theo route-map private=true | feed.tsx:281 | /cong-dong/:id |
| /ai-advisor | pages/ai-advisor.tsx (app.tsx:204) | Trợ lý AI tư vấn | Cờ aiAdvisorEnabled (use-public-config.ts:41-43; ai-advisor.tsx:43 hiện màn tắt) | home-extras.tsx:46 (sau cờ, :45); profile.tsx:49 (lọc profile.tsx:145) | /tu-van |
| /group-buy | pages/group-buy.tsx (app.tsx:205) | Mua chung nhóm | Theo route-map private=false | home-extras.tsx:48; profile.tsx:47 | /mua-chung |
| /group-buy/:id | pages/group-buy.tsx (app.tsx:206) | Mở một nhóm mua chung cụ thể | Theo route-map private=false | Chỉ deep link và sau khi tạo nhóm product-detail.tsx:258 | /mua-chung/:id |
| /refill | Navigate tới /recycle (app.tsx:207) | Chuyển hướng cũ | Không | Không thấy lối vào (chỉ redirect) | (skip, route-map lane skip) |
| /recycle | pages/recycle.tsx (app.tsx:208) | Đổi rác lấy quà: trang chính | cfg.waste.enabled (recycle.tsx:182); chưa đăng nhập → thẻ đăng nhập | profile.tsx:48; loyalty.tsx:471 | /doi-rac |
| /recycle/rules | pages/recycle-rules.tsx (app.tsx:209) | Thể lệ đổi rác | Công khai (route-map private=false) | recycle.tsx:328 | /doi-rac/quy-dinh |
| /recycle/new | pages/recycle-new.tsx (app.tsx:210) | Tạo yêu cầu đổi rác | Phương thức theo waste.* và laneFlags (recycle-new.tsx:259-263) | recycle.tsx:268; recycle-requests.tsx:43 | /doi-rac/tao |
| /recycle/points | pages/recycle-points.tsx (app.tsx:211) | Chọn điểm nhận rác | Lọc phương thức theo waste.mailin/pickup (recycle-points.tsx:152) | recycle-new.tsx:448 (chuyển bước) | /doi-rac/diem-nhan |
| /recycle/r/:id | pages/recycle-request.tsx (app.tsx:212) | Chi tiết yêu cầu rác | cfg.waste.enabled (recycle-request.tsx:191) | recycle.tsx:185; recycle-requests.tsx:75 | /doi-rac/yeu-cau/:id |
| /recycle/r/:id/edit | pages/recycle-edit.tsx (app.tsx:213) | Sửa yêu cầu rác | cfg.waste.enabled (recycle-edit.tsx:73) | recycle-request.tsx:219, :335 | /doi-rac/yeu-cau/:id/sua |
| /recycle/requests | pages/recycle-requests.tsx (app.tsx:214) | Danh sách yêu cầu rác | Theo route-map private=true | recycle.tsx:162 | /doi-rac/yeu-cau |
| /recycle/done/:id | pages/recycle-done.tsx (app.tsx:215) | Hoàn tất yêu cầu rác | Theo route-map private=true | recycle-request.tsx:366; recycle-requests.tsx:75 | /doi-rac/xong/:id |
| /recycle/desk | pages/recycle-desk.tsx (app.tsx:216) | Quầy nhận hàng tại điểm | Tắt waste.enabled → thông báo tạm dừng (recycle-desk.tsx:478); chỉ khi có deskPoints (recycle.tsx:~186) | recycle.tsx:193; notifications.tsx:109 | /doi-rac/quay |
| /rewards | pages/rewards.tsx (app.tsx:217) | Kho quà | Theo route-map private=true | loyalty.tsx:484; recycle-done.tsx:95 | /kho-qua |
| /rewards/mine | pages/rewards-mine.tsx (app.tsx:218) | Quà đã đổi | Theo route-map private=true | rewards.tsx:227 | /kho-qua/cua-toi |
| /profile | pages/profile.tsx (app.tsx:219) | Tab Cá nhân: menu theo nhóm | Cần đăng nhập (profile.tsx:173); mục lọc theo cờ và vai trò (profile.tsx:141-169) | Thanh đáy Cá nhân (nav-config.ts:21) | /tai-khoan |
| /loyalty | pages/loyalty.tsx (app.tsx:220) | Hạng thành viên và Điểm Xanh | Theo route-map private=true; khối rác theo waste.enabled (loyalty.tsx:461) | profile.tsx:58; wallet.tsx:222 | /tai-khoan/diem-xanh |
| /wallet | pages/wallet.tsx (app.tsx:221) | Ví Tubu | Theo route-map private=true; khối hoàn tiền khi CASHBACK_ENABLED hoặc có cashbackPending (wallet.tsx:327) | profile.tsx:59 | /tai-khoan/vi-tubu |
| /points/scan | pages/external-points.tsx (app.tsx:222) | Quét mã đơn sàn lấy điểm | Cờ loyalty.marketplaceClaimEnabled (profile.tsx:141, :145) | profile.tsx:60 | route-map: skip (Q2) |
| /addresses | pages/addresses.tsx (app.tsx:223) | Sổ địa chỉ | Theo route-map private=true | profile.tsx:51; settings.tsx:166 | /tai-khoan/dia-chi |
| /notifications | pages/notifications.tsx (app.tsx:224) | Thông báo | Theo route-map private=true | Chuông home-header.tsx:30; profile.tsx:76 | /tai-khoan/thong-bao |
| /affiliate | pages/affiliate.tsx (app.tsx:225) | Cộng tác viên | Theo route-map private=true | profile.tsx:68; wallet.tsx:321 (có hoa hồng duyệt) | /ctv |
| /academy | pages/academy.tsx (app.tsx:226) | Học viện (danh sách khoá) | Theo route-map private=true | affiliate.tsx:522 | /hoc-vien |
| /academy/:courseId | pages/academy.tsx (app.tsx:229) | Chi tiết khoá học | Theo route-map private=true | academy.tsx:55 | /hoc-vien/:courseId |
| /cashback | pages/cashback.tsx (app.tsx:230) | Hoàn tiền sàn ngoài | CASHBACK_ENABLED=false (features.ts:10); mục menu chỉ hiện khi bật (profile.tsx:69) | Không thấy lối vào (cờ tắt) | /hoan-tien |
| /dealer | pages/dealer.tsx (app.tsx:231) | Đại lý: đăng ký hoặc kênh sỉ | Theo route-map private=true; nhãn theo trạng thái dealer (profile.tsx:134-138) | profile.tsx:70; brand-view.tsx:273 | /dai-ly |
| /about | pages/about.tsx (app.tsx:232) | Về Tubu Tree và hỗ trợ | Công khai (route-map private=false) | profile.tsx:80 | /gioi-thieu |
| /wishlist | pages/wishlist.tsx (app.tsx:233) | Sản phẩm yêu thích | Theo route-map private=true | profile.tsx:50 | /tai-khoan/yeu-thich |
| /chat | pages/support-chat.tsx (app.tsx:234) | Chat CSKH | Cờ chat.enabled (profile.tsx:142, :145; about.tsx:245) | profile.tsx:78; about.tsx:245; support-contact.tsx:53; product-detail.tsx:768 | /ho-tro/chat |
| /edit-profile | pages/edit-profile.tsx (app.tsx:235) | Sửa hồ sơ | Theo route-map private=true | settings.tsx:165; profile.tsx:233 (chưa rõ nút nào) | /tai-khoan/ho-so |
| /settings | pages/settings.tsx (app.tsx:236) | Cài đặt | Theo route-map private=true | profile.tsx:79 | /tai-khoan/cai-dat |
| /brand-story | pages/brand-story.tsx (app.tsx:237) | Câu chuyện thương hiệu | Công khai (route-map private=false) | home-extras.tsx:98; profile.tsx:77 | /cau-chuyen |
| /subscriptions | Navigate tới /orders?tab=subscriptions (app.tsx:239) | Chuyển hướng cũ | Không | Không thấy lối vào (order-strip.tsx:87 gọi thẳng /orders?tab=subscriptions) | /tai-khoan/don-hang?tab=subscriptions |
| /storefront | pages/storefront-builder.tsx (app.tsx:240) | Dựng gian hàng CTV | Theo route-map private=true | affiliate.tsx:356 (tab Gian hàng); storefront-view.tsx:121 | /ctv/gian-hang |
| /s/:slug | pages/storefront-view.tsx (app.tsx:241) | Gian hàng công khai của CTV | Công khai (route-map private=false) | Deep link ?s=; back-button.tsx:44; storefront-builder.tsx:495 | /s/:slug |
| /brand/:slug | pages/brand-view.tsx (app.tsx:242) | Trang nhãn hàng | Công khai (route-map private=false) | Chỉ deep link và back-button.tsx:44 (sfKind brand); chip home đi tới /browse?brand= (home-extras.tsx:84) | /brand/:slug |
| /brand-owner | pages/brand-owner.tsx (app.tsx:243) | Quản lý nhãn hàng | Chỉ khi có brand đang sở hữu (profile.tsx:151-158) | profile.tsx:155 | /chu-thuong-hieu |
| /admin | pages/admin.tsx (app.tsx:244) | Quản trị nhân sự | Vai trò ADMIN (profile.tsx:166-167) | profile.tsx:167 | /admin |
| /admin/community | pages/community-moderation.tsx (app.tsx:245) | Kiểm duyệt cộng đồng | Trong trang Quản trị (chưa rõ điều kiện trong page) | admin.tsx:95 | /admin?tab=community |
| /staff | pages/staff.tsx (app.tsx:246) | Ca làm và chấm công | Vai trò STAFF hoặc ADMIN (profile.tsx:160, :163) | profile.tsx:163 | /nhan-vien |
| /my-payroll | pages/my-payroll.tsx (app.tsx:247) | Lương của tôi | Vai trò STAFF hoặc ADMIN (profile.tsx:160, :164) | profile.tsx:164 | /nhan-vien/bang-luong |
| * | pages/not-found.tsx (app.tsx:248) | Trang không tồn tại | Mọi đường không khớp | Không thấy lối vào | — |

## Thanh đáy
Component: apps/miniapp/src/components/bottom-nav.tsx. Chỉ hiện ở trang gốc (bottom-nav.tsx:20). Danh sách tab nằm ở nav-config.ts:17-21.
1. Trang chủ `/` (nav-config.ts:17)
2. Danh mục `/browse` (nav-config.ts:18)
3. Vườn Xanh `/game`, nút tròn nổi giữa (nav-config.ts:19; bottom-nav.tsx:75-94)
4. Đơn hàng `/orders`, có badge đơn đang xử lý (nav-config.ts:20; bottom-nav.tsx:49)
5. Cá nhân `/profile` (nav-config.ts:21)

## Trang chủ
Khối theo thứ tự hiển thị. Thứ tự khách cũ: home-blocks.ts:11-13. Khách mới: home-blocks.ts:18-20. Bố cục cờ: home-blocks.ts:23-25. Render: home.tsx:162-175.
1. Ô tìm (search): luôn hiện, bấm sang /browse?focus=search (home.tsx:98, :182-192).
2. Mua lại (purchased, PurchasedRail): ẩn khi rỗng (purchased-rail.tsx:76). Lỗi thật hiện thẻ lỗi (home.tsx:100-105).
3. Dải đơn (orderStrip): ẩn khi chưa đăng nhập (order-strip.tsx:54) hoặc không có đơn và định kỳ (order-strip.tsx:66). Dải điểm chỉ khách cũ (home.tsx:110).
4. Flash sale (flash): FlashSale và UpcomingFlashSales (home.tsx:113-118). Ẩn khi đang tải (flash-sale.tsx:90). Khi rỗng: chưa rõ (flash-sale.tsx:91).
5. Dành cho bạn (forYou): chỉ khi đăng nhập (home.tsx:119).
6. Bán chạy (bestSellers): xem thêm /browse?sort=best_seller (home.tsx:120-127). Khi rỗng: chưa rõ.
7. Danh mục (categories): CategoryGrid, bấm sang /browse?category= hoặc ?segment= (home.tsx:129-139). Điều kiện rỗng: chưa rõ.
8. Đã xem gần đây (recentlyViewed): ẩn khi rỗng (recently-viewed-rail.tsx:40).
9. Nổi bật (featured): bỏ trùng với Dành cho bạn (home.tsx:83-90).
10. Mới về (newArrivals): /browse?sort=newest (home.tsx:142-144).
11. Khối phụ (extras, home-extras.tsx:30-111): thẻ AI chỉ khi aiEnabled (home-extras.tsx:45); thẻ Mua chung (:48); hero CTA sang /browse?focus=search (:65); dải thương hiệu ẩn khi không có thương hiệu (:71); hàng Câu chuyện thương hiệu (:98); hàng Cộng đồng (:106).
12. Quà khách mới (welcome): chỉ khách mới (home.tsx:147-153). NewCustomerGift ẩn nếu không phải khách mới (new-customer-gift.tsx:73).
Đầu trang: chuông sang /notifications (home-header.tsx:30), nút giỏ (home-header.tsx:36). Lỗi toàn trang khi cả ba lưới sản phẩm công khai lỗi: home.tsx:94-95.

## Cờ tính năng
| Khoá | Nơi đặt giá trị / nguồn | Nơi đọc (file:dòng) | Màn bị ẩn hoặc chặn khi tắt |
|---|---|---|---|
| SEASON_PASS_ENABLED | packages/app-core/src/features.ts:7 (=false) | apps/miniapp/src/utils/features.ts:1; components/game/use-game-data.ts:35 (tắt truy vấn); pages/game.tsx:204 | Khối Chặng Mùa trên /game. Không chặn route /game |
| CASHBACK_ENABLED | packages/app-core/src/features.ts:10 (=false) | utils/features.ts:1; pages/profile.tsx:69; pages/wallet.tsx:211, :327 | Mục menu /cashback (profile.tsx:69); chữ và khối hoàn tiền sàn ngoài trên /wallet. Route /cashback vẫn còn |
| aiAdvisorEnabled | Cấu hình công khai từ server: services/shop-api.ts:236; hook hooks/use-public-config.ts:41-43 | components/home/home-extras.tsx:45; pages/profile.tsx:139, :145; pages/ai-advisor.tsx:43 | Thẻ AI trên Trang chủ; mục menu Trợ lý AI; trang /ai-advisor hiện màn tắt. Server còn công tắc tắt khẩn cấp: apps/api/src/config/env.validation.ts:146 |
| marketplaceClaimEnabled (cfg.loyalty) | Cấu hình công khai: hooks/use-public-config.ts (qua PublicConfig) | pages/profile.tsx:141, :145 | Mục menu /points/scan. Route vẫn còn |
| chat.enabled | Cấu hình công khai | pages/profile.tsx:142, :144-145; pages/about.tsx:245 | Mục menu /chat (profile.tsx:145); dòng chat trong Về Tubu Tree (about.tsx:245). Lối vào support-contact.tsx:53 và product-detail.tsx:768 chưa thấy điều kiện cờ |
| homeNewCustomerLayout (home.new_customer_layout) | Cấu hình công khai: shop-api.ts:234 | pages/home.tsx:62; components/home/home-blocks.ts:23-25 | Không ẩn màn; chỉ đổi thứ tự khối khách mới |
| waste.enabled | Cấu hình công khai (shop-api.ts:234 kèm waste); khoá DB: apps/api/src/config/go-live/db-checks.ts:117, :246 | pages/recycle.tsx:182, :82; pages/recycle-desk.tsx:478; pages/recycle-request.tsx:191; pages/recycle-edit.tsx:73; pages/recycle-requests.tsx:67; pages/game.tsx:165; pages/loyalty.tsx:461 | Trang Đổi rác tạm dừng (recycle.tsx:182), quầy (recycle-desk.tsx:478), chi tiết và sửa yêu cầu, khối rác trên Vườn Xanh và Điểm Xanh |
| waste.dropoff / mailin / pickup | Cấu hình công khai (hooks/use-public-config.ts; shop-api.ts) | pages/recycle-new.tsx:259-263, :293, :427; pages/recycle-points.tsx:152; pages/checkout.tsx:92 | Phương thức gửi rác trong /recycle/new và /recycle/points; đường Thu kèm đơn tại checkout.tsx:92 |

Ghi chú: Mini App không đọc bảng system_configs trực tiếp (grep trong apps/miniapp/src không có). Cờ đi qua GET cấu hình công khai (services/shop-api.ts:234-236). Nguồn phía server ngoài db-checks.ts chưa rõ.
Ghi chú: route-map.json:74 ghi /points/scan và /refill ở lane skip, nhưng app.tsx:222 vẫn có route /points/scan.
