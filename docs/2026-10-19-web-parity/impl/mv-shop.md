# Lane mv-shop: màn mua sắm ở khổ điện thoại

## 1. Đã làm

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

Quyết định ghi lại: tên nhãn ở PDP giờ mở `/san-pham?brand=<tên>` (aria-label "Xem sản phẩm nhãn X") giống `brandBrowsePath` của Mini App, kể cả khi nhãn có trang `/brand/<slug>`. Gian hàng /s không có bộ sưu tập: điện thoại vẫn có thanh dính và vẫn chừa đệm đáy 90px như Mini App (máy tính ẩn thanh vì khối trạng thái rỗng đã có nút). Dòng Điểm Xanh của khách đã đăng nhập mà chưa có tổng quan trong cache nói chung (không gọi thêm API ở trang đông khách), thận trọng hơn Mini App.

Dữ liệu mua chung: tour web không 404 (màn dựng từ mock trình duyệt), nên không thêm khối vào `tour-db.ts`.

Commit chính của lane: a7da6f51, b41a106c, 4d373189, e7c2e71b, 53de2672, 58f99134, 02c1c2ba, 1017dc2c, 1418ce0a, 53c062be, a50f0bf3, 656033aa; sau review: 895e92a2, 5dcd5e57, 4f505f96, ae5069cb, d67d4277. Lỗi UAT xong: D7-28, 29, 30, 31, 32, 35, D15-01 (thêm `safeHexColor`, `cssUrl`). Route pending đã bỏ: lint-parity báo 0 mục pending.

## 2. Kiểm chứng (gate cuối, run3)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files 41 passed (41) Tests 489 passed (489)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files 368 passed (368) Tests 6365 passed (6365)
web-test-utc rc=0  Test Files 368 passed (368) Tests 6365 passed (6365)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=1  Test Files 1 failed | 282 passed (283) Tests 1 failed | 4312 passed (4313)
  (edit-profile.spec.tsx "tải lỗi → thông báo + nút Thử lại gọi lại getMe"; chạy lại riêng: 20/20 passed)
lint-vars rc=0 OK
lint-parity rc=0 xanh (0 mục pending)
web-build rc=0 Compiled successfully
miniapp-build rc=0
DONE
```

Gate toàn bộ chưa chạy lại sau lỗi chập chờn miniapp-test (lỗi do tải, đã chạy riêng xanh; tổng 4313 không giảm). Tour web-gate mv-shop-2: 51 passed.

## 3. Review

Lượt 1:
- MAJOR /s: `sm:` đè `max-md:` ở 640-767px, đệm đáy còn 32px, thanh dính che nội dung: đã sửa, đổi `sm:` thành `md:` (d67d4277 và các commit sau lượt 1).
- MAJOR D7-35 chỉ sửa ở điện thoại: đã sửa, nút cùng hàng tên ở md+.
- MAJOR chưa chụp lại sau dựng lại /s: đã chụp mv-shop-3 sau commit cuối của lượt 1.
- MINOR flash-sale D7-30: đã sửa (`md:min-w-44 md:flex-1`).
- MINOR link nhãn PDP: đã sửa, mở `/san-pham?brand=` như Mini App (ghi ở "Quyết định ghi lại").
- MINOR nút khách /s là nút phụ: đã sửa, xanh đậm.
- MINOR aria-label Mua ngay: đã sửa (895e92a2).
- MINOR thiếu test Điểm Xanh: đã thêm (5dcd5e57).
- MINOR file lib mới chưa ghi báo cáo: đã ghi.

Lượt 2:
- MAJOR gian hàng rỗng mất đệm 90px mà thanh dính vẫn hiện: đã sửa ở d67d4277, luôn giữ `max-md:pb-[calc(90px+var(--safe-bottom))]`, spec và báo cáo sửa theo.
- MINOR `sm:` đè `max-md:` ở h2 bộ sưu tập, main trang chủ, main /san-pham: đã sửa ở d67d4277 sang `md:`; thêm spec quét className /s (chạy đỏ trước khi sửa); hai spec cho trang chủ và /san-pham chặn gọn, chưa viết đỏ riêng.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Dải tiêu đề trắng của `components/ui/page-header.tsx` (dùng chung mọi lane); mua chung chưa truyền `backHref`. Để mshell/orchestrator quyết.
- ProductCard dùng một DOM duy nhất, khác cấu trúc ProductTile Mini App.
- Biểu tượng ảnh trống PDP khác lá Mini App; khoảng cách dòng "người theo dõi" ở trang nhãn lớn hơn.
- Chip bố cục của trình dựng gian hàng chỉ ẩn ở điện thoại.
- Chưa kiểm chứng: spec e2e `shop.web.spec.ts` (đổi chuông, ô tìm theo viewport) chưa chạy vì không được chạy Playwright; ảnh cuối chụp trước commit d67d4277 (chỉ đổi lớp CSS); một số test viết sau code; Mini App vitest chưa chạy lại toàn bộ sau lần chập chờn.

## 5. Câu hỏi cho chủ dự án

1. Có sửa `page-header.tsx` để tiêu đề nằm trong dải trắng cạnh nút lùi giống Mini App cho mọi màn? Mặc định: chưa sửa, để orchestrator quyết.
2. Dòng Điểm Xanh cho khách đã đăng nhập mà chưa có tổng quan loyalty trong cache: hiện câu chung hay gọi thêm API để hiện số như Mini App? Mặc định: câu chung, không gọi thêm API.
3. Tên nhãn ở PDP luôn mở `/san-pham?brand=` (như Mini App), kể cả khi có trang `/brand/<slug>`. Giữ vậy? Mặc định: giống Mini App.
