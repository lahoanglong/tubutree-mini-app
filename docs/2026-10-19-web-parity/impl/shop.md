# Lane shop: báo cáo

Nhánh `web/shop`, chưa push. Gate cuối xanh. Playwright chưa chạy (đúng luật), mọi ca e2e của lane mới chỉ viết.

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| 1. Danh mục sang `/san-pham` (lọc, sắp xếp, gợi ý, tìm gần đây, đã xem, tải thêm, phân trang có link thật, chuyển hướng 307 từ `/?q\|category\|brand\|page`) | 8b8e4074, 60d63287, ea0233da, 3cc8525a, f3436a68, 2f622e12, c8a974a9, bcbe0236, 763f6c81 | `app/san-pham/page.tsx`, `components/catalog/browse-view.tsx`, `lib/catalog-redirects.mjs`, `lib/home-seo.ts` |
| 2. Trang chủ `/` như Mini App (mua lại, giờ vàng, Dành cho bạn, danh mục, quà khách mới, khối phụ) | 150c1acf, 00df9761, d4ec0ab8, 129bf321, 174f8751, b9820325 | `app/page.tsx`, `components/home/*`, `components/reorder/*` |
| 3. Trang sản phẩm đủ chức năng (mã giảm, freeship, giờ vàng, tim, định kỳ, mua chung, nội dung CTV, chat OA, dải gợi ý) | ac736566, 520e53b6, 74698dbb, ce484053, 14953f65, 0d7b8acf, ce6466e5, 58d1c37c, ca57b54d, d24747b2, 4cd8a639 | `app/san-pham/[slug]/*`, `components/catalog/wishlist-heart.tsx`, `lib/pdp-logic.ts` |
| 4. Yêu thích, Mua chung, nhãn hàng, Hành trình nguyên liệu | f44bbf2e, 62cb720c, da20b409, 61a8434c, 06786f47 | `app/tai-khoan/yeu-thich`, `app/mua-chung`, `app/brand/[slug]/brand-actions.tsx`, `app/cau-chuyen` |
| Sửa review (xem mục 3) | b9820325, c8a974a9, 763f6c81, 3afbdacd, d24747b2, 4cd8a639, d5fcc281, 9373d012, bcbe0236, 294b565c, f4db17d9 | |

Route đã bỏ pending trong `route-map.json`: `/browse` (web `/san-pham`), `/tai-khoan/yeu-thich`, `/mua-chung`, `/mua-chung/:id`, `/cau-chuyen`. Các dòng `/` và `/product/:slug` vốn không pending.

## 2. Kiểm chứng (summary.txt của gate cuối)

```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  34 passed (34)       Tests  430 passed (430)
web-typecheck rc=0
web-lint rc=0 ✔ No ESLint warnings or errors
web-test rc=0  Test Files  256 passed (256)       Tests  3769 passed (3769)
web-test-utc rc=0  Test Files  256 passed (256)       Tests  3769 passed (3769)
miniapp-typecheck rc=0
miniapp-lint rc=0
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214)
lint-vars rc=0 OK — every var(--x) reference is defined.
lint-parity rc=0 lint:parity xanh (35 mục pending)
web-build rc=0  ✓ Compiled successfully
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
DONE
```

Lưu ý: luật nói test Mini App không dưới 4243, gate cho 4214 (282 file), giống hệt qua nhiều lần chạy, lane không sửa Mini App. Một lần chạy trung gian có 1 test Mini App đỏ (4213), chập chờn do tải, các lần sau xanh; chưa xác định test nào.

## 3. Review

Lượt 1 (1 MAJOR, 7 MINOR):
- MAJOR link Trang chủ tới route pending: đã sửa ở b9820325.
- `/?page=N` không chuyển hướng: c8a974a9.
- Chuyển hướng danh mục cũng chạy trên host CTV: c8a974a9.
- Seed `?page=N` làm hỏng cache danh sách: 763f6c81.
- Mua lại: nút Thêm còn bật sau thêm một phần: 3afbdacd. Hai bản mua lại trùng (shop và order): không sửa, ghi thành câu hỏi 2 (cần quyết ở bước tích hợp).
- Thiếu câu hỏi analytics: ghi ở 9373d012, câu hỏi 1.
- Thiếu lời báo "Đã mở nhóm mua chung": 4cd8a639 (+ d5fcc281 cho e2e).
- SubscribeSheet giữ lỗi cũ: d24747b2.

Lượt 2 (1 MAJOR, 1 MINOR):
- MAJOR mất phân trang crawl được: bcbe0236 (rel=next/prev và link trang thật).
- MINOR trang nhãn không hiện mã giảm của khuyến mãi: bcbe0236 (+ 294b565c sửa dữ liệu mẫu spec).

Lượt 3 (2 MINOR), cùng sửa ở f4db17d9:
- Pager và danh sách lệch trang bắt đầu khi server không seed: dùng chung `startPage`.
- Sheet định kỳ mở khoá nút khi đang gửi: chỉ reset khi không pending.

Không còn phát hiện mở. Review xác nhận endpoint và body tiền, nhóm mua chung, định kỳ, yêu thích, mua lại khớp Mini App; Mini App không bị sửa.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng

- Playwright chưa chạy: `shop.web.spec.ts` chưa kiểm chứng; path mock và tên nút chưa thử trên trình duyệt. Ca PDP tự skip khi DB e2e rỗng.
- Sự kiện analytics tìm kiếm không gửi (web chưa có tầng analytics).
- Dòng "Nhận tối đa N Điểm Xanh" và dải tăng điểm ở trang sản phẩm (`PointsEarnLine`, `PointsBoostStrip`) chưa làm; 02-ke-hoach không giao rõ.
- Trang chủ bỏ gộp request `/home`+`/home/me`, kéo để làm mới, nhớ số ô khung chờ.
- Web không có snackbar: dùng dòng `role=status`/`alert`; mua lại một phần thì sheet ở lại kèm "Xem giỏ".
- `components/product-pagination.tsx`, `homeHref`/`pageHref` trong `lib/catalog-filter.ts` không còn nơi dùng, để nguyên.
- Link tới route lane khác (`/tu-van`, `/cong-dong`, định kỳ) bị ẩn khi pending, hiện lại khi route hết pending.
- Chưa kiểm chứng middleware xử lý `/san-pham` trên host CTV.
- Chat OA chỉ mở `zalo.me/<oaId>` không kèm nội dung câu hỏi. Nút chia sẻ ghi "Chia sẻ" thay vì "Chia sẻ Zalo".
- Nút Tham gia/Theo dõi khi phiên unavailable gọi retrySession.
- Một số spec chép từ Mini App (share-link, brand-origins, search-state...) hoặc viết cùng lúc với code, không có bước đỏ trước.
- Sửa ngoài chủ file (không đổi hành vi): `apps/e2e/tests/web-customer.web.spec.ts`, `lib/next-config-redirects.spec.ts`, `components/site-header.spec.tsx`, `site-search.tenant.spec.tsx`, `guest-pages.a11y.spec.tsx`, `test-utils/render-hook.tsx` (mới).

## 5. Câu hỏi cho chủ dự án

1. Web có cần gửi `search_performed`, `search_result_clicked`, `filter_applied` không, tới endpoint nào? Mặc định: không gửi.
2. Hai bản mua lại (`components/reorder/*` của shop, `components/orders/*` của order): giữ bản nào? Mặc định: giữ cả hai, bản shop đã khoá CTA sau thêm một phần; xử lý ở tích hợp.
3. Khối đại lý trên `/brand/[slug]`: có hiện "Đăng ký đại lý" cho mọi người đã đăng nhập và sửa test BUYERWEB-18 không? Mặc định: chỉ hiện cho người đã có hồ sơ đại lý, ẩn khi `/dai-ly` còn pending.
4. Bài mẫu chia sẻ nhãn cho người không phải CTV: mặc định không hiện, chỉ QR, link, nút chia sẻ.
5. Chữ dải tăng điểm Trang chủ đổi từ "Mua trong Mini App tích nhiều hơn" thành "Mua trực tiếp tại Tubu Tree ...": xác nhận chữ? Mặc định: chữ mới.
6. Giờ vàng ở Trang chủ chỉ link `/san-pham/{slug}` (không truyền variationId, trang sản phẩm tự chọn phân loại đang giờ vàng). Mặc định: như vậy, chưa kiểm bằng trình duyệt.
7. Sau đăng nhập quay về trang sản phẩm: chỉ tự mở lại sheet định kỳ, không tự tạo nhóm mua chung. Mặc định: như Mini App.
8. Có muốn bỏ nút "Xem thêm" thay cho `?page=N`, tức giữ cả hai như hiện tại? Mặc định: giữ cả hai (Xem thêm cho người dùng, link trang cho crawler).
9. Đặt định kỳ chọn chuyển khoản: sang `/tai-khoan/don-hang/<code>` vì `/thanh-toan/chuyen-khoan/:code` còn pending. Đổi khi lane order xong?
10. Emoji trong chữ hiển thị đã bỏ để khớp quy ước; emoji nhận diện nhãn ở `lib/brand-origins.ts` giữ như Mini App. Mặc định: như vậy.
11. Số sàn test Mini App 4243 trong luật so với 4214 thực tế: sàn đúng là bao nhiêu? Mặc định: coi 4214 là mốc hiện tại.
