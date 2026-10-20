# Lane mshell2: vỏ trang điện thoại lượt 2

Nhánh `web/mshell2`.

## 1. Đã làm

| Mục | Commit | Nội dung |
|---|---|---|
| Thanh tiêu đề dùng chung, bỏ lớp bọc riêng | 000b29de | `components/ui/page-header.tsx` vẽ dải như Mini App (nền surface tràn ngang bằng bù lề đối xứng `max-md:mx-[calc(50%-50vw)]` nên đúng với mọi khung cha, đệm 12/16 cộng safe-top, h1 title-lg, phụ đề caption tertiary, chừa 48px khi nút lùi hiện, biến thể hero). CSS kéo khung có con trực tiếp là PageHeader lên sát mép. Xoá `MiniBar`, `MiniTitleBar`, `TitleBand`, `skin.mainUp`, `skin.pageTitle`, `components/mini/page-header.tsx`. Chuyển dealer-shell, staff-shell, ledger-shell, ctv, ctv/gian-hang, cau-chuyen, các trang recycle sang PageHeader |
| Nút lùi theo độ sâu trong `history.state` | 493c6914 | `lib/nav-depth.ts` đóng dấu độ sâu vào mọi pushState/replaceState (cài lúc nạp module, trước hydrate); `components/mini/back-button.tsx` đọc dấu khi bấm |
| `data-page-bleed` thừa ở hub Tài khoản | (commit riêng) | chỉ còn ở PageHeader, bìa nhãn, bìa gian hàng, gallery sản phẩm |
| Chuyển khoản giữ dải dưới nút lùi, đoạn mở đầu Hành trình nguyên liệu | 6c001100 | `PageHeader bleed={false}` |

PageHeader nhận thêm `className`, `subtitleClassName`, `parentHref` (trang cha cho nút lùi khi desktop còn BackLink "← ..." riêng, nên md trở lên không đổi) và `bleed`.

## 2. Tình huống nút lùi

| Tình huống | Kết quả | Test (`components/mini/back-button.spec.tsx`) |
|---|---|---|
| Vào thẳng link, tab mới | đi tới trang cha: `fallbackHref`, rồi `data-back-href` của PageHeader, rồi suy từ đường dẫn tới route đã có, cuối cùng `/`; không `back()` | vào thẳng link; trang cha suy ra không có route; PageHeader khai báo; fallbackHref thắng |
| Trang cha trùng trang hiện tại | về `/` thay vì bấm không ra gì | trang cha trùng đường dẫn hiện tại |
| push A rồi B, lùi về A | ở B lùi một bước; ở A vẫn lùi được tới trang vào đầu tiên trong web; tới mục đầu thì đi trang cha, không rời web | push A rồi B |
| replace B thành C | không tăng độ sâu | replace B thành C; push B rồi replace thành C |
| Back, Forward rồi Back | độ sâu theo đúng mục lịch sử đang đứng (dấu nằm trong state của từng mục) | lùi rồi Forward rồi lùi |
| Tải lại ở B | dấu nằm trong `history.state` nên sống qua F5; patch cài trước hydrate nên replaceState của Next lúc hydrate không xoá dấu | tải lại ở B |
| Nhiều BackButton cùng gắn | patch chỉ cài một lần | nhiều bản BackButton |
| state không phải object (trang ngoài Next) | giữ nguyên, không đóng dấu | state không phải object |

Ẩn ở 5 trang gốc của thanh đáy (`/`, `/san-pham`, `/vuon-xanh`, `/tai-khoan/don-hang`, `/tai-khoan`) như cũ (navigation.spec).

Giới hạn: mục lịch sử tạo bằng điều hướng cứng (thẻ `<a>` thường, `location.assign`) chưa có dấu nên tính độ sâu 0, nút đi tới trang cha thay vì `back()`. An toàn (không rời web) nhưng có thể không lùi đúng trang vừa xem.

## 3. Màn, thanh đầu, ảnh

Ảnh chụp lần cuối: `gate-logs/visual/mshell2-2` (51/51 cặp đủ hai bên, so phần đầu từng cặp bằng bảng ghép). Lần đầu `mshell2-1` phát hiện chuyển khoản và Hành trình nguyên liệu lệch, đã sửa ở 6c001100.

| Màn | Route Mini App | Thanh đầu (Mini App và web sau sửa, khớp) | Route web | Ảnh |
|---|---|---|---|---|
| Trang chủ | `/` | không có thanh (Mini App tự vẽ đầu trang) | `/` | `mshell2-2/web/tour/index.jpg` |
| Danh mục và tìm kiếm | `/browse` | không có thanh | `/san-pham` | `mshell2-2/web/tour/browse.jpg` |
| Chi tiết sản phẩm | `/product/:slug` | không có thanh (gallery tràn mép, data-page-bleed giữ ở trang) | `/san-pham/:slug` | `mshell2-2/web/tour/product___slug.jpg` |
| Yêu thích | `/wishlist` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/yeu-thich` | `mshell2-2/web/tour/wishlist.jpg` |
| Mua chung | `/group-buy` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/mua-chung` | `mshell2-2/web/tour/group-buy.jpg` |
| Chi tiết nhóm mua chung | `/group-buy/:id` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/mua-chung/:id` | `mshell2-2/web/tour/group-buy___id.jpg` |
| Thương hiệu | `/brand/:slug` | không có thanh (bìa nhãn tràn mép, data-page-bleed giữ ở trang) | `/brand/:slug` | `mshell2-2/web/tour/brand___slug.jpg` |
| Câu chuyện thương hiệu | `/brand-story` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/cau-chuyen` | `mshell2-2/web/tour/brand-story.jpg` |
| Giỏ hàng | `/cart` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/gio-hang` | `mshell2-2/web/tour/cart.jpg` |
| Thanh toán | `/checkout` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/thanh-toan` | `mshell2-2/web/tour/checkout.jpg` |
| Chuyển khoản | `/bank-payment/:code` | thanh trắng dưới đệm 48px của nút lùi (bleed=false) | `/thanh-toan/chuyen-khoan/:code` | `mshell2-2/web/tour/bank-payment___code.jpg` |
| Đơn hàng | `/orders` | thanh trắng, không nút lùi (trang gốc thanh đáy) | `/tai-khoan/don-hang` | `mshell2-2/web/tour/orders.jpg` |
| Đơn định kỳ | `/subscriptions` | thanh trắng, không nút lùi (trang gốc thanh đáy) | `/tai-khoan/don-hang?tab=subscriptions` | `mshell2-2/web/tour/subscriptions.jpg` |
| Chi tiết đơn | `/order/:code` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/don-hang/:code` | `mshell2-2/web/tour/order___code.jpg` |
| Sổ địa chỉ | `/addresses` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/dia-chi` | `mshell2-2/web/tour/addresses.jpg` |
| Giới thiệu | `/about` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/gioi-thieu` | `mshell2-2/web/tour/about.jpg` |
| Tài khoản | `/profile` | không có thanh (hub gốc, đã bỏ data-page-bleed thừa) | `/tai-khoan` | `mshell2-2/web/tour/profile.jpg` |
| Sửa hồ sơ | `/edit-profile` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/ho-so` | `mshell2-2/web/tour/edit-profile.jpg` |
| Cài đặt | `/settings` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/cai-dat` | `mshell2-2/web/tour/settings.jpg` |
| Thông báo | `/notifications` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/thong-bao` | `mshell2-2/web/tour/notifications.jpg` |
| Điểm Xanh và hạng | `/loyalty` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/diem-xanh` | `mshell2-2/web/tour/loyalty.jpg` |
| Ví Tubu | `/wallet` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tai-khoan/vi-tubu` | `mshell2-2/web/tour/wallet.jpg` |
| Kho quà | `/rewards` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/kho-qua` | `mshell2-2/web/tour/rewards.jpg` |
| Quà của tôi | `/rewards/mine` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/kho-qua/cua-toi` | `mshell2-2/web/tour/rewards__mine.jpg` |
| Hoàn tiền | `/cashback` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/hoan-tien` | `mshell2-2/web/tour/cashback.jpg` |
| Vườn Xanh | `/game` | thanh trắng, không nút lùi (trang gốc thanh đáy) | `/vuon-xanh` | `mshell2-2/web/tour/game.jpg` |
| Trợ lý AI | `/ai-advisor` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/tu-van` | `mshell2-2/web/tour/ai-advisor.jpg` |
| Cộng đồng | `/feed` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/cong-dong` | `mshell2-2/web/tour/feed.jpg` |
| Bảng xếp hạng | `/feed/leaderboard` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/cong-dong/xep-hang` | `mshell2-2/web/tour/feed__leaderboard.jpg` |
| Sự kiện cộng đồng | `/feed/events` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/cong-dong/su-kien` | `mshell2-2/web/tour/feed__events.jpg` |
| Bài viết | `/feed/:id` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/cong-dong/:id` | `mshell2-2/web/tour/feed___id.jpg` |
| Học viện | `/academy` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/hoc-vien` | `mshell2-2/web/tour/academy.jpg` |
| Khoá học | `/academy/:courseId` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/hoc-vien/:courseId` | `mshell2-2/web/tour/academy___courseId.jpg` |
| Gian hàng CTV (công khai) | `/s/:slug` | không có thanh (bìa gian hàng tràn mép, data-page-bleed giữ ở trang) | `/s/:slug` | `mshell2-2/web/tour/s___slug.jpg` |
| Cộng tác viên | `/affiliate` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/ctv` | `mshell2-2/web/tour/affiliate.jpg` |
| Gian hàng của tôi | `/storefront` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/ctv/gian-hang` | `mshell2-2/web/tour/storefront.jpg` |
| Đại lý | `/dealer` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/dai-ly` | `mshell2-2/web/tour/dealer.jpg` |
| Ca làm nhân viên | `/staff` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/nhan-vien` | `mshell2-2/web/tour/staff.jpg` |
| Bảng lương | `/my-payroll` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/nhan-vien/bang-luong` | `mshell2-2/web/tour/my-payroll.jpg` |
| Chủ thương hiệu | `/brand-owner` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/chu-thuong-hieu` | `mshell2-2/web/tour/brand-owner.jpg` |
| Quản trị | `/admin` | ngoài phạm vi lane (app/admin) | `/admin` | `mshell2-2/web/tour/admin.jpg` |
| Quản trị cộng đồng | `/admin/community` | ngoài phạm vi lane (app/admin) | `/admin?tab=community` | `mshell2-2/web/tour/admin__community.jpg` |
| Đổi rác lấy quà | `/recycle` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac` | `mshell2-2/web/tour/recycle.jpg` |
| Thể lệ đổi rác | `/recycle/rules` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/quy-dinh` | `mshell2-2/web/tour/recycle__rules.jpg` |
| Tạo yêu cầu đổi rác | `/recycle/new` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/tao` | `mshell2-2/web/tour/recycle__new.jpg` |
| Điểm nhận rác | `/recycle/points` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/diem-nhan` | `mshell2-2/web/tour/recycle__points.jpg` |
| Chi tiết yêu cầu đổi rác | `/recycle/r/:id` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/yeu-cau/:id` | `mshell2-2/web/tour/recycle__r___id.jpg` |
| Sửa yêu cầu đổi rác | `/recycle/r/:id/edit` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/yeu-cau/:id/sua` | `mshell2-2/web/tour/recycle__r___id__edit.jpg` |
| Yêu cầu đổi rác của tôi | `/recycle/requests` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/yeu-cau` | `mshell2-2/web/tour/recycle__requests.jpg` |
| Đổi rác hoàn tất | `/recycle/done/:id` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/xong/:id` | `mshell2-2/web/tour/recycle__done___id.jpg` |
| Quầy nhận rác | `/recycle/desk` | thanh trắng ngang hàng nút lùi, tiêu đề chừa 48px | `/doi-rac/quay` | `mshell2-2/web/tour/recycle__desk.jpg` |

## 4. Kiểm chứng

- vitest web: 384 file, 6533 test xanh; chạy thêm `TZ=UTC` cũng 6533 xanh.
- vitest Mini App: 283 file, 4313 test xanh (không đổi).
- `tsc --noEmit` web sạch; `next lint` chỉ còn cảnh báo `<img>` cũ ở `ctv-order-sheet.tsx`; `next build` thành công (trước commit 6c001100; commit đó chỉ thêm một prop).
- Playwright: chỉ spec tham quan, 51/51 chụp được hai lần.

## 5. Chưa làm, cố ý để lại, ghi chú

- Docker Colima trên máy lúc chạy không chuyển tiếp cổng của container mới (container cũ vẫn thông), nên `web-gate.sh` báo P1001. Chụp ảnh bằng Postgres chạy thẳng (embedded-postgres) và một máy chủ Redis giả chỉ trả PING ở scratchpad; không đụng DB dùng chung. Không sửa gì trong repo vì chuyện này.
- Ngoài phạm vi, ghi lại cho lane khác: `/cong-dong` web có thêm hai chip "Facebook", "TikTok" mà Mini App không có; `/admin` web vẫn là bản desktop (ở `app/admin`, ngoài lane); lệch dọc 5 đến 7px ở thân giỏ hàng và thanh toán so với Mini App (thân màn).
- Chân trang gọn ở điện thoại (hotline, chính sách) giữ nguyên, chờ chủ dự án.
- Code `nav-depth` viết sau bài test đỏ (spec viết trước, 8 test đỏ, rồi mới code).
