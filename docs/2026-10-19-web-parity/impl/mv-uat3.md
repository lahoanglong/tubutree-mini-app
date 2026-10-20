# Lane mv-uat3: web theo đợt giao diện Mini App ui-miniapp-1 (UAT)

Nhánh `web/mv-uat3`. Nguồn: nhánh cục bộ `uat/int` (9a4d13f7 chữ, 544c9ad7 giao diện, 7edb9c02 sửa sau review, lô 4 tới 755fede9, lô 5 404f4f71). Không sửa `apps/miniapp`, `apps/api`, `packages/**`.

## Bảng mục

| Mục | Commit Mini App | File web | Kết quả |
|---|---|---|---|
| 1 Chữ: hệ số ×1,2, Điểm Xanh, Vườn Xanh | 9a4d13f7 | `lib/loyalty-copy.ts` (`formatMultiplier`), `app/tai-khoan/diem-xanh/page.tsx` | Đã theo, ở mọi khổ |
| 1 Đắk Lắk | 9a4d13f7 | `lib/brand-origins.ts` | Đã theo |
| 1 Số ngày đổi trả theo `returnWindowDays` | 9a4d13f7 (about.tsx) | không có | Web không có hộp chính sách trong trang giới thiệu (dẫn sang `/chinh-sach`, đã đọc `returnWindowDays` từ trước), FAQ dự phòng đã đọc cấu hình. Không cần sửa |
| 1 Bỏ emoji, câu lặp | 9a4d13f7 | `components/recycle/recycle-request.tsx`, `recycle-desk.tsx`, `app/cau-chuyen/brand-story-view.tsx` | Đã theo. Lời báo mở nhóm mua chung (`?moi=1`) giữ 🛒 vì Mini App cũng giữ |
| 1 Chữ nhỏ: browse/result-header, profile, recycle, season-pass, leaderboard, reviews | 544c9ad7 | `components/catalog/result-header.tsx` + `browse-view.tsx` (lỗi tải không in "0 sản phẩm"), `app/tai-khoan/page.tsx` (số ở ô thẻ), `components/recycle/recycle-home.tsx` + `waste-item-step.tsx` (món Sắp nhận), `components/game/season-pass.tsx`, `app/cong-dong/xep-hang/page.tsx` (huy chương icon có tên), `app/san-pham/[slug]/product-reviews.tsx` (sao chưa tô `--stone-450`) | Đã theo. Ô nhãn đánh giá đã có `<label>` bọc |
| 2 FAQ dự phòng bỏ câu xu cũ | 94f2db2a | `lib/faq-fallback.ts` | Đã theo |
| 3 Pháp lý hoàn tiền | 9a4d13f7 | `lib/legal.ts` | Đã sửa thành "hoàn tiền vào Ví Tubu hoặc tài khoản ngân hàng bạn chọn sau khi duyệt yêu cầu". Đã đọc `customer-refunds.service.ts` và `refund-destination.ts`: tiền hoàn chỉ đi Ví Tubu hoặc tài khoản ngân hàng khách chọn, không có "theo cách đã thanh toán", nên câu cũ của web sai và câu Mini App đúng. Câu hỏi cho chủ: `[số ngày làm việc]` trong bản nháp pháp lý vẫn trống |
| 4 Giỏ: Thành tiền | 544c9ad7, 7edb9c02, 755fede9 | `app/gio-hang/page.tsx` | Đã theo: `it.total` của máy chủ, hiện khi số lượng > 1, ẩn khi lệnh đổi số lượng của đúng dòng đang chạy. Web không có số lượng cục bộ nên không có điều kiện `localQty`. Chỉ hiện dưới md (từ md đã có cột tổng bên phải) |
| 5 Thanh toán: Giao dự kiến | 544c9ad7 | `lib/shipping-eta.ts` (chép `shippingEtaLabel`), `lib/shop-client.ts` (kiểu `shippingEta`), `app/thanh-toan/page.tsx` | Đã theo, dưới phí vận chuyển, ẩn khi cấu hình chưa tải hoặc thiếu. Không đổi body, Idempotency-Key, điều kiện nút |
| 5 Thẻ địa chỉ | 544c9ad7, 7edb9c02, 755fede9 | `app/thanh-toan/page.tsx` (AddressPicker) | Cảnh báo địa giới cũ nằm trong thẻ địa chỉ đang chọn, chữ và nút "Cập nhật địa chỉ" như Mini App, ẩn khi đang sửa (`editingId === null`) |
| 5 aria-label ô ghi chú | 544c9ad7 | không đổi | Ô ghi chú web là `<textarea>` bọc trong `<label>` có chữ nhìn thấy nên đã có tên truy cập; thêm `aria-label` khác chữ sẽ lệch tên nhìn thấy |
| 6 Cộng đồng | 544c9ad7 | `app/cong-dong/feed-view.tsx` | Nút chữ "Xếp hạng" (tên truy cập "Bảng xếp hạng") và "Sự kiện" không icon, bỏ phụ đề khi đã đăng nhập (khách xem trước giữ phụ đề), bớt đệm |
| 7 Danh mục | 544c9ad7 | `lib/browse-categories.ts`, `components/catalog/category-grid.tsx` | Icon theo 7 slug seed, ảnh 24px khi có `image`, tên hai dòng |
| 8 Tương phản ô nhãn | 544c9ad7 | `app/cau-chuyen/brand-theme.css` (`--color-brand-tile-scrim`), `brand-story-view.tsx`, `test-utils/contrast.ts`, `app/cau-chuyen/contrast.spec.ts` | Đã theo, test 4,5:1 chạy trên 8 nhãn |
| 9 Viền ô nhập | 544c9ad7 | `lib/input-border-contrast.spec.ts` | Web đã dùng sẵn `border-stone-450` (= `--color-border-strong`) cho ô nhập, `max-md:border-[var(--color-border-strong)]` cho checkbox/radio, `bg-stone-450` cho công tắc tắt (lane trước). Chỉ thêm test khoá 3:1 |
| 10 Bóng gợi ý Vườn Xanh | 544c9ad7 | `components/garden-hint-bubble.tsx` | Tự tắt sau 8 giây, cao tối thiểu 44px |
| 11 aria-label ô nhập | 544c9ad7 | `a11y-input-labels.spec.ts` | Quét JSX 9 file tương ứng: web đã có tên truy cập đủ (đã thử gỡ một nhãn để chắc spec bắt được). Không phải sửa code |
| Lô 4 chữ "Miễn phí giao hàng" | e852c807 | `app/gio-hang/page.tsx`, `lib/pdp-logic.ts`, `lib/coupon-view.ts`, `components/coupon-box.tsx`, `app/tai-khoan/diem-xanh/page.tsx`, `lib/home-text.ts` | Đã theo, kèm "Tạm tính (đã giảm, chưa gồm phí giao hàng)" và "Miễn phí giao hàng cho phần hàng Tubu Tree giao". Không đổi `lib/legal.ts` (văn bản chính sách dùng "vận chuyển" theo tên trang) |
| Lô 4/5 mã giảm giá chào mừng | e852c807, 404f4f71 | `lib/home-text.ts` | `Mã giảm giá chào mừng ${amount}`, `... ${pct}%`, `Mã miễn phí giao hàng chào mừng` |
| Lô 4 bàn phím | e852c807 | `a11y-click-targets.spec.ts` | Web đã dùng `<button>`/`<Link>` ở chi tiết sản phẩm, giờ vàng, giỏ, thanh toán, chi tiết đơn. Chỉ thêm test quét JSX |
| Lô 4 logo | e852c807 | `assets/tubu-logo-home.png` (chép từ 755fede9), `components/home/home-header.tsx` | 249x90, 14 KB, hiển thị vẫn 83x30 |
| Lô 4 Sắp nhận, Không giới hạn theo tháng | e852c807 | `recycle-home.tsx`, `waste-item-step.tsx`, `recycle-desk.tsx` | Đã theo (Mini App 9a4d13f7 viết "mức tháng", e852c807 sửa lại "theo tháng"; web theo bản sau) |
| Lô 4 Vườn Xanh không lặp | e852c807 | `app/tai-khoan/diem-xanh/page.tsx` | Đã theo |
| Thêm | 544c9ad7 | `components/affiliate/storefront-builder.tsx` | Tên món bị ẩn dùng chữ nhạt thay opacity |
| e2e | | `apps/e2e/tests/loyalty.web.spec.ts`, `community.web.spec.ts` | Bộ chọn theo chữ mới (không đụng `pro.web.spec.ts`) |

## Kiểm chứng
- vitest web: 392 file / 6590 test xanh, cả mặc định và `TZ=UTC`.
- vitest Mini App: 283 file / 4313 test xanh (không sửa gì ở Mini App).
- `tsc --noEmit` web xanh (cần build `packages/shared-types` trước), `next build` xanh, `lint:vars`, `lint:parity` xanh, `next lint` chỉ còn cảnh báo cũ ở `ctv-order-sheet.tsx:587`.
- Ảnh chụp visual-tour: CHƯA chụp được. `web-gate.sh` đã thử hai lần, Postgres tạm khởi động nhưng cổng host 15432 không nhận kết nối (thử riêng một container cổng khác cũng "Connection refused"): Docker publish cổng ra host đang hỏng trên máy lúc này. Chưa so ảnh với `after` của UAT.

## Câu hỏi và ghi chú
1. Trang thành công đặt hàng của web chưa có dòng "Giao dự kiến" (Mini App `order-success.tsx` có). Thuộc luồng đặt hàng/đơn hàng, không làm ở lane này.
2. `components/mini/tiles.tsx` `StatTile` có `role="button"` mà không có tabIndex/phím (file thuộc `components/mini/*`, không sửa, hiện chưa chỗ nào dùng).
3. Mục 1, 4, 6, 7 viết code ngay sau test trong cùng bước ở một số chỗ (category-grid, browse-categories); phần còn lại test đỏ trước.
