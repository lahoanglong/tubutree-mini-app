# Lane order — báo cáo

## 1. Đã làm
| Mục | Commit | File chính |
|---|---|---|
| Idempotency-Key theo nội dung đơn | f8f4ab06 | `apps/web/src/lib/order-key-ring.ts`, `thanh-toan/page.tsx` |
| PRICE_CHANGED / CART_CHANGED | f7becbc2 | `thanh-toan/page.tsx` |
| Thu kèm rác (wasteRequestId) | 3f60866a | `lib/checkout-waste.ts` |
| Giỏ: hoàn tác xoá, link sản phẩm, % giờ vàng | 94128e35 | `gio-hang/page.tsx` |
| e2e giỏ và thanh toán (chưa chạy) | c4cce386 | `apps/e2e/tests/order.web.spec.ts` |
| Định dạng điểm bằng Intl | 6b08478c | `thanh-toan/page.tsx` |
| Trang chuyển khoản | c266b1ff | `thanh-toan/chuyen-khoan/[code]/page.tsx`, `bank-transfer-panel.tsx` |
| Mua lại | ee66a94b | `components/orders/reorder*.ts(x)` |
| Thẻ đơn, 7 tab | 0ca68c71 | `components/orders/order-card.tsx`, `orders-tabs.ts` |
| Kệ Mua lại, tab Định kỳ | 57cf0fdf | `purchased-rail.tsx`, `subscriptions-panel.tsx` |
| Trang Đơn hàng, mở route | def97711, 305b3610 | `tai-khoan/don-hang/page.tsx`, `route-map.json` |
| Chi tiết đơn | a219c51d, d8e9ff72 | `lib/order-view.ts`, `order-extras.tsx`, `lib/oa-prompt.ts` |
| Sổ địa chỉ: Đã xóa địa chỉ | ff1d61c3 | `tai-khoan/dia-chi/page.tsx` |
| e2e chi tiết đơn, địa chỉ (chưa chạy) | b6416ab7 | `order.web.spec.ts` |
| Sửa theo review | e38bc9bb, 364cc732, fad26a6e, 72c4ec05, c0e51e3c, a8f3e8b0, ee816fd9 | xem mục 3 |

Route hết pending: `/gio-hang`, `/thanh-toan`, `/bank-payment/:code`, `/orders`, `/subscriptions` (và `/tai-khoan/don-hang/:code`, `/tai-khoan/dia-chi` vốn đã hết pending).

## 2. Kiểm chứng
Gate cuối (run4) CHƯA KẾT THÚC: `summary.txt` chưa có dòng DONE. Nội dung hiện có:
```
install rc=0
shared-types rc=0
app-core-typecheck rc=0
app-core-test rc=0  Test Files  34 passed (34)  Tests  429 passed (429)
web-typecheck rc=0
web-lint rc=0 ✔ No ESLint warnings or errors
```
Chưa kiểm chứng: test web đầy đủ sau ee816fd9, test Mini App (mốc 4243), build, Playwright. Đã chạy trực tiếp: `apps/web/src/app/thanh-toan` 17 file, 143 test xanh, tsc xanh. Lần chạy đầy đủ trước ee816fd9: web 230 file, 3420 test xanh.

## 3. Review
Vòng 1:
- MAJOR đặt BANK_TRANSFER xong nút Đặt hàng bật lại trong lúc router.replace: sửa ở e38bc9bb.
- MAJOR link /doi-rac/tao 404 khi route pending: sửa ở 364cc732.
- MINOR thiếu chữ "điểm": fad26a6e.
- MINOR "Đã xóa địa chỉ." không tắt: 72c4ec05.
Vòng 2:
- MAJOR đặt đơn hai lần sau lỗi mạng khi giỏ nạp lại: a8f3e8b0 (không đủ, xem vòng 3).
- MINOR quyết định chuyển trang theo radio chứ không theo đơn đã tạo, radio chưa khoá khi đang đặt: a8f3e8b0.
- MINOR nhãn vận chuyển sai bảng: c0e51e3c.
Vòng 3:
- MAJOR a8f3e8b0 không chặn được vì SiteHeader cùng quan sát giỏ: sửa ở ee816fd9 bằng cách đóng băng yêu cầu (body và key) sau lần đặt chưa rõ kết quả. Chưa có vòng review nào xác nhận lại ee816fd9.

## 4. Chưa làm, cố ý để lại, chưa kiểm chứng
- VoucherSheet: giữ CouponBox inline.
- Chưa chuyển các hàm giỏ và đặt đơn sang `@tubutree/app-core/api/*`; vẫn dùng `@/lib/shop-client`.
- Giỏ chưa có debounce 380ms, optimistic update, StorefrontContextBar, SuggestedRail khi rỗng.
- Chưa đối chiếu màn thành công với OrderSuccess; điểm dùng được lấy từ báo giá.
- Chưa có analytics mua lại (web chưa có lớp analytics).
- Trang chi tiết đơn vẫn dựng panel QR nội tuyến; nút Thanh toán ở hub `/tai-khoan` (lane account) vẫn dẫn tới chi tiết đơn.
- Link "Thu kèm rác" ẩn tới khi lane recycle mở `/doi-rac/tao`.
- TDD không trọn ở `checkout-waste`, `use-remaining`, `reorder.ts`, `orders-tabs.ts`, `subscription-price.ts`, `oa-prompt.ts` (spec viết cùng lượt).
- Đã sửa spec cũ của lane: checkout-idempotency, checkout-waste, order-actions (ngày tương đối), guest-pages.a11y; `checkout-race.spec` nay mount cùng SiteHeader.
- Chưa chạy Playwright: các ca trong `order.web.spec.ts` chưa kiểm chứng.

## 5. Câu hỏi cho chủ dự án
1. Đổi CouponBox thành VoucherSheet như Mini App? Mặc định: giữ inline.
2. Điểm dùng được ở thanh toán lấy từ `/me/loyalty` như Mini App? Mặc định: giữ `redeemablePoints` của báo giá.
3. Sau lỗi mạng khi đặt, nếu khách đổi lựa chọn thì chặn và báo "Đơn trước có thể đã được tạo. Kiểm tra mục Đơn hàng trước khi đặt lại." (lệch đề xuất gốc). Mặc định: chặn một lần, bấm sau gửi đơn mới.
4. "Theo dõi ngay" OA trên web chỉ mở trang OA và luôn trả false; chữ báo "Đã mở trang Tubu Tree trên Zalo, bấm Quan tâm...". Mặc định: chữ này, do tôi tự chọn.
5. Nút Thanh toán ở hub `/tai-khoan` dẫn tới trang chuyển khoản thay vì chi tiết đơn? Mặc định: giữ nguyên (lane account).
