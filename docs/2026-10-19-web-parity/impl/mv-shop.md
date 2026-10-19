# Lane mv-shop: màn mua sắm ở khổ điện thoại

Nhánh `web/mv-shop`. Ảnh cuối: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gate-logs/visual/mv-shop-3/` (`mv-shop-3/web/tour/*.jpg` so với `miniapp/tour/*.jpg`; chụp sau mọi commit sửa review lượt 1).

| Màn | Khác biệt đã sửa (commit) | Còn lại (vì sao) | Ảnh cuối |
|---|---|---|---|
| Trang chủ | chuông cho khách, ô tìm chỉ ở điện thoại (a7da6f51); giãn mục, D7-29/30/32 (53c062be, 1418ce0a) | dải tiêu đề trắng của vỏ trang (xem mục chung) | mv-shop-3/web/tour/index.jpg |
| Danh mục | ô tìm viên, nút giỏ, chip nền nhạt (4d373189) | không | mv-shop-3/web/tour/browse.jpg |
| Chi tiết sản phẩm | ảnh tràn mép, khối thông tin, thanh dính (e7c2e71b); mã giảm giá rộng hết hàng (53c062be) | biểu tượng chỗ trống của ảnh khác lá Mini App | mv-shop-3/web/tour/product___slug.jpg |
| Yêu thích | thẻ sản phẩm chung (b41a106c); giá 14px, tên 22px/dòng (a50f0bf3) | dải tiêu đề trắng | mv-shop-3/web/tour/wishlist.jpg |
| Thương hiệu | khung, bìa, avatar, thanh dính, D7-28, D15-01 (53de2672) | web hiện danh sách sản phẩm thật còn mock Mini App không có; khoảng cách dòng "người theo dõi" lớn hơn | mv-shop-3/web/tour/brand___slug.jpg |
| Gian hàng /s/slug | bìa, avatar tròn, thanh dính, D7-35, D15-01 (58f99134); tên dưới avatar; sau review: lớp `md:` thay `sm:` ở 640-767px, nút chính cùng hàng tên ở máy tính, avatar xanh đậm qua biến CSS, nút khách xanh đậm | web có huy hiệu CTV/hạng thật, mock Mini App không có | mv-shop-3/web/tour/s___slug.jpg |
| Mua chung, chi tiết nhóm | thẻ phẳng, cỡ chữ (02c1c2ba) | dải tiêu đề trắng; chân trang web hiện ở điện thoại (vỏ trang) | mv-shop-3/web/tour/group-buy.jpg, group-buy___id.jpg |
| Hành trình nguyên liệu | chữ kết thúc 🌿 (02c1c2ba) | dải tiêu đề trắng | mv-shop-3/web/tour/brand-story.jpg |
| CTV, gian hàng của tôi | thẻ phẳng, CTV Academy, bìa gradient, bỏ chip bố cục, cssUrl (1017dc2c) | dải tiêu đề trắng; cỡ chữ số lớn hơn nhẹ | mv-shop-3/web/tour/affiliate.jpg, storefront.jpg |

Mục chung còn mở: Mini App vẽ tiêu đề trang trong một dải trắng cạnh nút lùi; web đặt tiêu đề dưới nút, nền xám. Sửa ở `components/ui/page-header.tsx` ảnh hưởng mọi lane nên chưa làm; đề nghị lane mshell/orchestrator quyết.

File mới ngoài `app/**` và `components/**`: `apps/web/src/lib/phone-ui.ts`, `points-earn.ts`, `safe-color.ts` (dùng chung giữa nhiều màn của nhóm; không lane khác sửa), orchestrator lưu ý khi gộp.

Quyết định ghi lại: tên nhãn ở PDP giờ mở `/san-pham?brand=<tên>` (aria-label "Xem sản phẩm nhãn X") giống `brandBrowsePath` của Mini App, kể cả khi nhãn có trang `/brand/<slug>`. Gian hàng /s không có bộ sưu tập: thanh dính chỉ dựng khi có sản phẩm (đã có nút trong khối trạng thái rỗng), nên không chừa đệm đáy. Dòng Điểm Xanh của khách đã đăng nhập mà chưa có tổng quan trong cache nói chung (không gọi thêm API ở trang đông khách), thận trọng hơn Mini App.

Dữ liệu mua chung: tour web không 404 (màn dựng từ mock trình duyệt), nên không thêm khối vào `tour-db.ts`.
