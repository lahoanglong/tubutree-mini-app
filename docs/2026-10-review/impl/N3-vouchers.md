# N3 vouchers: hai cron cấp mã giảm giá theo lô song song

Nhánh nightly/n3-vouchers, base 8b0ea824. Phạm vi: apps/api/src/modules/vouchers và race spec voucher.

## Đã làm

Mục backlog 82e4c7a00b (phần anh em): milestoneVouchers (0 5 * * *) và secondOrderVouchers (0 10 * * *) trước đây cấp bằng for-of await grant(), nay dùng grantInChunks (10 grant đồng thời, Promise.allSettled theo nhóm) đúng như welcome, birthday, winback.

- milestone: lọc trước các dòng đạt mốc (mốc cao nhất đạt được, sắp xếp giảm dần một lần thay vì mỗi dòng), rồi grantInChunks với reason `MILESTONE<mốc>-<yyyy-mm>`, giá trị, validDays 30, templateCode không đổi.
- second-order: mỗi trang keyset (SECOND_ORDER_PAGE, tối đa 25 trang) gọi grantInChunks, endAt tính từ đơn đầu của từng khách như cũ. Trang sau chỉ chạy khi trang trước xử lý xong, cursor vẫn là userId cuối trang.
- Không có xử lý nào khác trong vòng lặp (không đánh dấu, không notify riêng) nên không mất gì: notify nằm trong grant().

## Quyết định về lỗi

Hành vi cũ khác nhau giữa hai cron:
- milestone: lỗi grant được ném ra khỏi vòng for-of, rơi vào try/catch ngoài của @Cron, log một dòng và DỪNG cả lượt. Khách đứng sau không được cấp trong ngày (lượt sau mới thử lại).
- second-order: `.catch` từng khách, log và coi như không cấp, tiếp tục.

grantInChunks không dừng khi một grant lỗi (allSettled), ghi lỗi có trần 20 dòng và để một dòng tổng kết (reportGrantFailures). Chọn dùng nguyên hành vi này cho cả hai:
- milestone chuyển từ "dừng cả lượt" sang "cô lập lỗi từng khách", lỗi không bị nuốt (log từng khách + tổng kết ở finally). Đây là thay đổi hành vi có chủ ý và an toàn hơn.
- second-order giữ nguyên "không ném, cô lập từng khách", đổi mẫu log sang `secondOrderVouchers lỗi cấp cho user <id>: ...` có trần 20 dòng cộng dòng tổng kết. Giá trị trả về `{ granted, scanned }` và log `Second-order vouchers granted: g/s` giữ nguyên. Nếu có chỗ nào grep log cũ "Cấp mã đơn thứ 2 lỗi" thì cần cập nhật (trong repo không còn nơi nào khác dùng).
- Không ném lỗi đầu ra ngoài ở cuối (giống birthday/winback): @Cron không có ai bắt lỗi ném ra. Dòng tổng kết ERROR là tín hiệu cảnh báo.

## Test

- apps/api/src/modules/vouchers/vouchers.service.spec.ts: thêm 2 describe (7 ca). Milestone: 25 khách nhiều mức, mỗi người đạt mốc đúng coupon đúng mức, người dưới mốc không nhận, granted đúng, đồng thời tối đa 10; một grant lỗi không chặn lô sau; trên 20 lỗi chỉ log 20 dòng. Second-order: 25 khách granted/scanned, endAt theo đơn đầu, đồng thời tối đa 10; phân trang keyset chạy hết 3 trang (cursor '', u011, u023); một grant lỗi không chặn lô và trang sau, không ném, granted đúng; trên 20 lỗi vẫn trả số liệu.
- TDD: viết test trước, chạy đỏ (milestone đỏ ở "maxInFlight > 1" vì tuần tự).
- Kiểm đột biến: khôi phục tạm vouchers.service.ts bản HEAD (for-of tuần tự) thì 6/39 ca đỏ (3 milestone, 3 second-order). Ca phân trang xanh ở cả hai bản, đúng ý: nó khoá hành vi không được đổi. Đã khôi phục bản sửa.
- Race spec mới apps/api/test/integration-race/milestone-second-order-vouchers-chunked.race-spec.ts (Postgres 16 thật): milestone 25 khách 4 mức chi tiêu, 2 instance song song + chạy lại: đúng số coupon, đúng mức, không trùng, đúng 1 tin mỗi người; second-order 25 khách với SECOND_ORDER_PAGE=7 (4 trang), 2 instance song song + chạy lại: mỗi người 1 mã, hạn theo đơn đầu, 1 tin. Ca này bảo vệ hành vi, không đỏ với bản tuần tự (hành vi quan sát được như nhau); phần đỏ/xanh của đồng thời nằm ở unit test.

## Lệnh kiểm và kết quả (thật)

- `npx jest src/modules/vouchers` (apps/api): 39/39 xanh, exit 0.
- `npx tsc --noEmit -p tsconfig.json` (apps/api): exit 0.
- `npx eslint --max-warnings=0` trên vouchers.service.ts, vouchers.service.spec.ts, race spec mới: exit 0.
- Race (Postgres docker cổng 5822, migrate deploy): `npx jest -c test/integration-race/jest.config.js --runInBand 'integration-race/(milestone-second-order-vouchers|birthday-vouchers-chunked|vouchers-real-user|second-order-review-invite)'`: 4 suite, 13 test xanh, exit 0. Container đã `docker rm -f -v`.

## Sau review

Review độc lập có 2 finding minor.

- Comment GRANT_CONCURRENCY (vouchers.service.ts) còn ghi chỉ birthday/welcome/winback: xác minh trên mã là đúng (grantInChunks nay có 5 nơi gọi). Sửa comment (không đổi hành vi nên không có test đỏ; kiểm bằng tsc, eslint và jest voucher): nêu cả 5 cron, ghi chú welcome (mỗi giờ) trùng second-order lúc 10:00, tối đa 20 grant cùng lúc cộng 1 kết nối giữ lock, so với connection_limit=20 (docker-compose.vietnix.yml:79). Reviewer đã tự chạy giả lập pool nhỏ, 0 lỗi, nên đây chỉ là vấn đề tài liệu. Commit riêng.
- milestoneVouchers dùng LIMIT 1000 với GROUP BY không ORDER BY, nếu hơn 1000 khách chi tiêu trong tháng thì lấy tập con tuỳ ý: xác minh là đúng (truy vấn đó có sẵn từ trước, diff này không đổi). KHÔNG sửa trong gói này: gói cấm đổi điều kiện/cách chọn người nhận, và keyset phân trang đổi ai nhận mã. Ghi thành mục backlog riêng: phân trang keyset theo userId như birthdayVouchers/winbackVouchers (thêm `o."userId" > cursor`, `ORDER BY o."userId"`, lặp đến khi trang thiếu), kèm test hơn 1000 khách. Chưa làm.

## Chưa verify

- Không chạy full suite, Playwright, capture/axe (điều phối viên chạy).
- Không đo thời gian thực của cron trên dữ liệu lớn.

## Rủi ro và ghi chú

- Hành vi milestone đổi như mô tả ở trên (không còn dừng cả lượt khi một khách lỗi).
- second-order chạy trong `$transaction` giữ advisory lock tối đa 10 phút; grant dùng kết nối khác của pool, tối đa 10 kết nối đồng thời ngắn hạn cộng 1 kết nối giữ lock, cùng mức welcome/birthday/winback đang dùng.
- Lưu ý khi chạy race spec bằng đường dẫn pattern: tên worktree chứa "vouchers" nên pattern `voucher` khớp mọi file; dùng pattern có thư mục như trên. Ngoài nhóm file, không phát hiện lỗi nào khác.
