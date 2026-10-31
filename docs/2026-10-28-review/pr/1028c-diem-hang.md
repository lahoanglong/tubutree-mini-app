TITLE: fix(zns): tin báo hạ hạng qua hàng đợi không gửi đôi, log đã gửi không bị đóng đè (R-170, R-171)

## Vấn đề
Phần chính của R-170 và R-171 đã vào main qua đợt P3 (PR #75): 10a16b0ed cho R-170 và 5d96b76ac cho R-171. Review đợt 3 còn thấy ba điều.
- Race test của tin báo hạ hạng chạy với queue `null`, nên không kiểm đường thật trên production. Production đi qua hàng đợi.
- `dispatchZns` có thể đóng đè một log đã gửi. Ca xảy ra: `queue.add` báo quá hạn, nhưng Redis đã nhận job và worker đã gửi xong (SENT). Khi đó catch vẫn đổi log thành FAILED và nhả khoá chống gửi đôi.
- Không có test cho khoảng hở quanh lượt hạ hạng 03:15. Chú thích ở `tierKeepGap` không nói vì sao chọn lượt muộn.

## Có gì trong PR
- `apps/api/test/integration-race/tier-drop-notice-queue.race-spec.ts` (mới): chạy `NotificationsService` thật trên Postgres thật, với `queue.add` ném lỗi một lần.
  - Ca 1: lần lỗi không gửi gì và để lại một log ZNS FAILED đã nhả khoá. Đêm sau có đúng một log PENDING mang khoá gốc. Đêm kế tiếp không gửi thêm.
  - Ca 2: năm lượt `sendNotices` chạy đồng thời sau lần lỗi chỉ tạo đúng một log ZNS mới và một job.
- `notifications.service.ts`: catch của `dispatchZns` chỉ đóng log còn PENDING (`updateMany where status PENDING`). Test mới ở `zns-delivery.race-spec.ts` đỏ trước khi sửa và xanh sau khi sửa.
- `loyalty.service.ts`: thêm chú thích ở `tierKeepGap`. Thêm test khoảng hở: `until` = 03:15:02 giờ VN lấy lượt 03:15 hôm sau; `until` = 03:15:00 lấy lượt cùng ngày. Test đậu ở UTC, Asia/Ho_Chi_Minh và America/Los_Angeles.
- `20-backlog.md`: ghi R-170 và R-171 "Đã sửa ở main", kèm phần race test thêm mới và phần chưa làm.

Không đổi ngưỡng hạng, điểm, luật giữ hạng hay ngày báo.

## Cách kiểm
- Race chạy `--runInBand` (`zns-delivery` cùng ba file tier-drop): 4 suite, 13/13 đạt. Worker chạy hai lần. Reviewer Opus chạy lại riêng trên Postgres khác.
- Jest API toàn bộ: 504 suite, 11790 test đạt.
- Gate đầy đủ trên nhánh đã gộp main `2ca045580`: 0 FAIL. Gate gồm tsc 5 gói, eslint, vitest app-core 1283, Mini App 5270 (thêm một lượt giờ UTC), web 8060, jest API 505 suite / 11807 test, lint:parity, vite build. Gói đầu Mini App 709 KB.

## Còn lại (P3, không chặn merge)
- `deliverZns` (`notifications.service.ts:352-355`) đọc log PENDING, gọi Zalo, rồi ghi SENT không điều kiện. Catch của `dispatchZns` có thể nhả khoá ở giữa hai bước đó.
  - Ca này chỉ xảy ra khi tắt giờ yên lặng (giờ bắt đầu bằng giờ kết thúc, job không bị dời) và `queue.add` quá hạn sau khi Redis đã nhận job. Khi đó khách có thể nhận ZNS lần hai vào đêm sau.
  - Với giờ yên lặng mặc định 21h–08h, job 03:45 bị dời nên ca này không xảy ra.
  - Cách sửa: `deliverZns` nhận log bằng `updateMany` trước khi gửi. Cách này đổi luồng RETRYING nên cần chủ quyết.
- Khi log đã SENT mà `count === 0`, hàm vẫn ném lỗi. Hậu quả: `sendNotices` đếm dư một khách và khoá lật lại một lần. Không có tin nào bị gửi đôi.
- Race spec mới đếm `sendNotices()` trên toàn DB, nên chỉ ổn khi chạy `--runInBand`. CI đã dùng `--runInBand`.

## Deploy và migration
Không có migration. Chỉ đổi API.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
