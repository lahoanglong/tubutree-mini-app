TITLE: fix(khach): khách cũ mất mạng giữ bố cục, khung chờ lùi về Tài khoản, câu báo ngày mã giảm, luật ô điểm dùng chung (R-156, R-158, R-163, R-168)

## Vấn đề
- R-156 (Mini App, Trang chủ): khách cũ mất mạng lúc mở app (`status = 'error'`) lại thấy quà dành cho khách mới.
- R-158 (web): trong lúc khung chờ của nhóm `/tai-khoan` còn hiện, nút lùi nổi ở chi tiết đơn đưa về danh sách đơn thay vì `/tai-khoan`.
- R-163 (thanh toán): luật nhãn ô điểm bị khoá và `pointsSummary` được viết hai lần, một ở web và một ở Mini App.
- R-168 (admin, mã giảm giá): khi "Hết hạn" sớm hơn "Bắt đầu", nút Tạo bị khoá mà không giải thích. Rời ô chỉ hiện "Ngày nằm ngoài khoảng cho phép."

## Có gì trong PR
- R-156:
  - Trạng thái lỗi giữ bố cục khách cũ đã lưu trên máy.
  - Thẻ thành viên báo lỗi và có nút Thử lại (gọi `restore`).
  - File: `home.tsx`, `member-card.tsx`. Web không đổi.
- R-158:
  - `RouteSkeleton` khai `data-back-href="/tai-khoan"` cho mọi trang con của Tài khoản, cả khung đứng riêng lẫn khung trong trang.
  - Nhánh đã gộp main `2ca045580`. Có xung đột với chỗ giữ tiêu đề của #77 trong `route-skeleton.tsx` và spec. Đã gộp tay, giữ cả hai phần.
- R-163:
  - `pointsSummary`, `convertedPointsNote` và nhãn ô điểm bị khoá chuyển vào `packages/app-core/src/points-lots.ts`.
  - Web (`checkout-points.ts`) và Mini App (`checkout-rules.ts`, `points-lots.ts`) dùng chung bản này.
  - Không đổi luật điểm.
- R-168:
  - Một câu duy nhất dưới nút Tạo: "Ngày hết hạn không được sớm hơn ngày bắt đầu. Hãy chọn lại ngày hết hạn hoặc ngày bắt đầu để tạo mã."
  - Hết hạn cùng ngày với Bắt đầu vẫn hợp lệ, như luật hiện có. Chỉ đổi chữ, không đổi luật.

## Cách kiểm
- Spec mới hoặc sửa: `member-card.spec`, `home.spec`, `use-home-customer-kind.spec`, `route-skeleton.spec`, `checkout-points.spec`, `checkout-rules.spec`, `points-lots.spec` (app-core), `vn-date-input.spec`, `admin/page.spec`.
- Sau khi gộp tay: vitest web 25 file / 470 test đạt; tsc web 0 lỗi.
- Gate đầy đủ trên nhánh đã gộp main `2ca045580`: 16/17 mục đạt: tsc 5 gói, eslint, vitest app-core 1287, Mini App 5297 (thêm một lượt giờ UTC), web 8089, lint:parity, vite build. Gói đầu Mini App 710 KB.
  - jest API: 11805/11806 đạt, đỏ 1 test `common/cron-run/track-cron.spec.ts:177` (lượt treo nhận ERRORS thay vì SKIPPED). PR này không đổi file nào trong `apps/api`.
  - Chạy riêng spec đó 3 lần trên cùng nhánh thì đỏ 1 lần. Lúc đó tải máy là 145 trên 12 lõi. Test dựa vào `sleep(40)` và cron thật nên chập chờn khi máy quá tải. Đã ghi backlog, CI của PR sẽ chạy lại.
- Ảnh trước/sau, chụp cục bộ và không vào repo:
  - R-156: Mini App và web 375.
  - R-168: admin 375. Ảnh trước có hai câu ("Ngày nằm ngoài khoảng cho phép." và câu cũ); ảnh sau có một câu.

## Còn lại (P3, có từ trước, không do PR này)
- Admin để trống "Bắt đầu" và chọn "Hết hạn" là một ngày đã qua: nút Tạo vẫn bật. API trả "Ngày kết thúc phải sau ngày bắt đầu." trong khi ô Bắt đầu đang trống.
- Mini App có khoảng trống lớn hơn web khoảng 28px giữa hàng lối tắt và "Ưu đãi giờ vàng".

## Deploy và migration
Không có migration. Đổi web, Mini App và app-core. Phần Mini App chỉ tới khách sau khi đẩy bản Mini App mới.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
