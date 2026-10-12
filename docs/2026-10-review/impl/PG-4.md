# PG-4: cờ rewardAvailable cho câu gợi ý thưởng Điểm Xanh khi viết đánh giá

Câu "+5/+10/+15 Điểm Xanh, lần đầu đánh giá sản phẩm này" (PF-6b) vẫn hiện cho khách đã nhận thưởng sản phẩm đó. PF-6b đã đề xuất cờ từ API; gói này làm việc đó.

## Làm gì

Endpoint miniapp đã gọi ở màn viết đánh giá là `GET /products/:slug/reviews/can-review` (`canReviewProduct`). `ReviewsService.canReview` trả thêm `rewardAvailable: boolean` khi `canReview` là true (khách chưa mua vẫn trả đúng như cũ, không có trường mới). Giá trị là `!existing && !rewardAlreadyKept(...)`. Hàm `rewardAlreadyKept` được dùng lại nguyên văn cho cả `createFirst` lẫn `canReview`, chỉ đổi kiểu tham số từ `Prisma.TransactionClient` sang `Db` (đã có sẵn trong file) để gọi được ngoài transaction. Không sao chép luật. Đường ghi điểm (createFirst, updateOwn, remove, thu hồi) không đổi dòng nào.

Miniapp: `canReviewProduct` thêm `rewardAvailable?: boolean` vào kiểu trả (optional, chịu được API cũ; kiểu này nằm cục bộ ở `shop-api.ts`, không có trong shared-types nên không đổi shared-types). `WriteReview` nhận `showReward = rewardAvailable !== false`; form viết mới không vẽ câu gợi ý khi `showReward` là false. Chế độ sửa luôn giữ câu giải thích "sửa đánh giá không cộng thêm" vì đó là lời giải thích, không phải lời hứa điểm.

## Quyết định thiết kế

- Đang có đánh giá thì `rewardAvailable = false` mà không đọc sổ điểm: gọi tạo lúc đó là sửa, không thưởng (cùng nhánh `existing` trong `create`).
- Chưa có đánh giá: theo luật sổ điểm của cặp (khách, sản phẩm). Hệ quả đúng luật, không phải lỗi: xoá đánh giá mà thu hồi đủ điểm thì sổ về 0, cờ lại true (tạo lại thật sự được thưởng); xoá khi điểm đã tiêu hết (không thu hồi được) thì cờ false và tạo lại ra `pointsEarned = 0`. Ca "xoá sau khi nhận thưởng → false" trong đặc tả đúng với trường hợp sau.
- Cờ chỉ là gợi ý hiển thị. Máy chủ vẫn tính lại trong transaction lúc tạo, nên cờ cũ (khách mở form, rồi tiêu điểm hay xoá ở thiết bị khác) chỉ có thể làm câu gợi ý lệch nhất thời, không ảnh hưởng điểm. Snackbar sau khi gửi vẫn theo `pointsEarned` thật.
- Khi cờ false và form viết mới, câu "Chỉ đánh giá SP đã mua & nhận." (đuôi của câu chỉ-chữ) cũng mất theo. Chấp nhận được vì nút chỉ hiện cho khách đủ điều kiện.
- Tên cờ nêu chiều "còn thưởng" (`rewardAvailable`) thay vì `rewardAlreadyKept` như PF-6b đề xuất, để miniapp không phải đảo logic và thiếu trường tự nhiên ra hành vi cũ.

## Rủi ro

- Thêm một lần `findMany` trên `points_transactions` mỗi lần gọi can-review của khách có đơn đã giao và chưa có đánh giá. Truy vấn này là truy vấn của `createFirst` (lọc userId, refType, reason), không đo tải riêng. Cần review xem có chỉ mục phù hợp ở quy mô lớn; chưa có khách thật nên chưa cấp bách.
- Cờ đọc ngoài transaction, không khoá; chấp nhận vì chỉ là gợi ý (xem trên).
- Review opus độc lập nên soi: luật chung `rewardAlreadyKept` không đổi hành vi (chỉ đổi kiểu), và không có đường nào cờ làm thay đổi điểm.

## Test và kiểm

- API jest `reviews.service.spec.ts`: ca chưa từng đánh giá (true), đã nhận thưởng và điểm không thu hồi được (false), thu hồi đủ (true), đang có đánh giá (false), đúng truy vấn sổ, chưa mua (không có trường). Đỏ trước khi sửa (cờ undefined), xanh sau.
- Race spec Postgres thật `review-edit.race-spec.ts`: vòng nhận thưởng, xoá có thu hồi, tạo lại, tiêu hết điểm rồi xoá (cờ false, tạo lại `pointsEarned = 0`), và cách ly giữa hai sản phẩm. Hai ca mới viết sau khi sửa code nên không có lượt đỏ riêng (unverified phần đỏ); hai ca cũ có `toEqual` của can-review được cập nhật thêm trường mới.
- Vitest miniapp `reviews-section.spec.tsx`: false ẩn ở cả ba trạng thái chữ/ảnh/video, true và thiếu trường giữ câu cũ, chế độ sửa giữ câu giải thích. Ca false đỏ trước khi sửa.
- Không chạy: Playwright, full suite, e2e mocks (`apps/e2e` có mock can-review không cờ, vẫn hợp lệ nhờ trường optional; unverified).
- `prettier --check` báo `reviews-section.tsx` lệch định dạng, nhưng bản HEAD cũng lệch nên không do gói này.
