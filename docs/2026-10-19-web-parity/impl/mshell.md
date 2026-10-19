# Lane mshell: bộ thành phần Mini App và vỏ trang điện thoại

Nhánh `web/mshell`, tip `edede4cf`.

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Bộ thành phần `components/mini` (28 thành phần, 93 test) | 3a44081e, 791212a5, fee86bb4, e020f78e, 1e30208b | `apps/web/src/components/mini/*`, `mini.css`, `globals.css` |
| Vỏ trang ở khổ điện thoại (thanh đầu/chân ẩn dưới md, PageHeader, BackLink, HomeHeader, bóng Vườn Xanh) | f0a622dc | `components/ui/page-header.tsx`, `components/back-link.tsx`, `components/home/home-header.tsx`, `components/mobile-shell.spec.tsx` |
| Sửa review lượt 1 (một BackButton ở layout, đếm lịch sử, chặn submit khi loading, CSS ô tìm, PriceTag thiếu giá) | 80eb1d7c, 951f5c93 | `layout.tsx`, `mini/back-button.tsx`, `mini/button.tsx`, `mini/price-tag.tsx` |
| Chân trang gọn ở điện thoại (hotline, chính sách) | 2dea5079 | `components/site-footer.tsx` |
| Sửa review lượt 2 (độ sâu hai chiều, z-index dưới lớp phủ, một bản BackButton, page-bleed, huy hiệu CountBadge) | edede4cf | `mini/back-button.tsx`, `mini/badge.tsx`, `home-header.tsx`, `bottom-nav.tsx` |

Route: lint-parity báo 0 mục pending ở gate cuối.

## 2. Kiểm chứng (summary.txt của gate cuối, xanh)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  41 passed (41)  Tests  489 passed (489)
web-typecheck rc=0
web-lint rc=0
web-test rc=0  Test Files  366 passed (366)  Tests  6289 passed (6289)
web-test-utc rc=0  Test Files  366 passed (366)  Tests  6289 passed (6289)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  283 passed (283)  Tests  4313 passed (4313)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 (0 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0
DONE
```

## 3. Review

Lượt 1:
- MAJOR thiếu nút lùi ở trang con: đã sửa ở 80eb1d7c (một BackButton ở layout).
- MAJOR `history.length` dùng sai: sửa nửa chừng ở 80eb1d7c, sửa trọn ở edede4cf (lượt 2).
- MAJOR Button submit vẫn gửi form khi loading: đã sửa ở 80eb1d7c (preventDefault, có test).
- MINOR CSS ô tìm lan sang máy tính và admin: đã sửa ở 80eb1d7c (giới hạn trong `.tubu-search-field`).
- MINOR PriceTag/Points với NaN hoặc thiếu giá: đã sửa ở 80eb1d7c và 951f5c93.
- MINOR chân trang ẩn làm mất hotline và chính sách: đã sửa ở 2dea5079.
- MINOR HomeHeader/huy hiệu lệch Mini App: sửa một phần ở edede4cf (icon 20px, text-primary, CountBadge). Chuông cho khách không đổi, xem mục 5.

Lượt 2:
- MAJOR độ sâu không giảm khi lùi: đã sửa ở edede4cf (độ sâu giảm khi popstate, lưu sessionStorage, spec A→B→A).
- MINOR nút nổi z-index 200 đè lớp phủ: đã sửa ở edede4cf.
- MINOR mini/PageHeader gắn BackButton thứ hai: đã sửa ở edede4cf (một bản duy nhất).
- MINOR đệm 48px ở trang hero: đã sửa ở edede4cf (`data-page-bleed`).
- MINOR HomeHeader: như trên.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- `router.replace` vẫn tính một bước. Nút Tiến của trình duyệt cũng phát popstate nên bị tính là lùi. Muốn tin cậy phải ghi idx vào `history.state` của Next.
- `data-page-bleed` đã đặt ở `san-pham/[slug]`, `brand/[slug]`, `s/[slug]`, nhưng các trang này chưa có gallery full-bleed thật.
- Chưa có `WishlistHeart` bản web (slot `wishlist` của ProductTile/ProductCard để trống). ProductCard chưa chọn sẵn phân loại Giờ vàng.
- Chưa có Form, CartButton trong bộ `mini`. `app/cong-dong/su-kien/page.tsx` còn nút `onBack` kiểu cũ.
- Lane sửa file ngoài danh sách (12 trang dưới `app/`, `components/dealer`, `components/staff`) để thay mọi link "←". Cần báo lane chủ các trang đó.
- Chưa so ảnh từng pixel. Đã xem ảnh trang chủ và giỏ hàng. Ảnh tài khoản, chi tiết đơn, Điểm Xanh, đổi rác chưa xem. BottomSheet chưa thử bằng trình duyệt thật.
- Code mục 1 viết trước test (không có bước đỏ trước); ở edede4cf cũng viết test và code cùng lượt.
- Playwright chạy một lần ở mục 2 (đúng lệnh việc 6, 51/51 cặp ảnh); không chạy ở lượt sửa review.

## 5. Câu hỏi cho chủ dự án

1. Chuông thông báo có hiện cho khách chưa đăng nhập như Mini App không? Mặc định: giữ ẩn (spec cũ ghi là có chủ ý, trang Thông báo cần phiên).
2. Có cần ghi idx vào `history.state` để nút lùi chính xác với `replace` và nút Tiến không? Mặc định: không, dùng bộ đếm popstate.
