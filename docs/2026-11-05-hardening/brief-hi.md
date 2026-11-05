# Gói hi (đợt 4): đẩy đơn sang Pancake không còn kẹt vì thẻ, lỗi phân loại rõ, không cảnh báo mãi

Worktree: `.claude/worktrees/hard-1105-hi`, nhánh `hard/1105-hi`, gốc `hard/1105-w4`. PG race: cổng 46540. Redis cho spec cần Redis: `docker run --rm -d --tmpfs /data -p 46550:6379 --name hi-redis redis:7-alpine`, `TEST_REDIS_URL=redis://127.0.0.1:46550` (dừng khi xong). Luật chung: `hard-1105-rules.md`.

## Bối cảnh (đã kiểm trên PROD, chỉ đọc, 05/11)
- PROD có 1 đơn: `TUBUSUB7659607093` (đơn định kỳ thử, platform `system`, CONFIRMED, UNPAID). Đẩy Pancake 73 lần, mọi lần `Pancake trả 422 khi tạo đơn: [tags]: is invalid`. Cron cứu hộ chuyển `pancakePushStatus = STALE` ngày 28/10.
- Job BullMQ lỗi (`bull:pancake-push:<orderId>`, `UnrecoverableError`, attemptsMade 1) nằm mãi trong tập failed (`removeOnFail: 1000` theo số lượng). Vì vậy go-live `queues.backlog` báo WARN ở mọi lần deploy, kể cả khi đơn đã STALE hay đã huỷ.
- Điều phối sẽ huỷ đơn thử + gói định kỳ thử trên PROD và gỡ job lỗi. Gói này không đụng PROD.
- Nguyên nhân gốc 422: body gửi `tags` dạng tên tự do; Pancake POS chỉ nhận `{id, name}` của thẻ có sẵn trong shop. PR #39 (nhánh `fix/pancake-tags-2026-10-25`, tip 2c7537b5b, đã fetch về ref local `pr39`) có bản sửa, review Opus 1 vòng, chưa gộp vì đơn thử. Đọc mô tả PR: `gh pr view 39`.

## Việc
1. **Gộp PR #39** vào nhánh gói: `git merge pr39` (merge commit, để #39 thành merged khi w4 vào main). Xung đột ở `apps/api/src/modules/integrations/pancake/pancake-order.service.ts`: giữ đủ thay đổi của main từ 25/10 tới nay (hardening đợt 1–3, outbox/claim, markPushFailure, grace…) và logic thẻ của #39. Chạy lại mọi spec pancake. Đọc kỹ review vòng 1 trong mô tả PR; mọi điểm đã sửa phải còn nguyên.
2. **Phân loại lỗi đẩy rõ ràng** (vĩnh viễn và tạm thời), một nguồn:
   - Vĩnh viễn: thiếu dữ liệu người nhận (`PancakeOrderDataError`), 4xx dứt khoát (trừ 408/409/425/429), cấu hình shop sai (401/403: khoá API sai, phải sửa cấu hình, không thử lại dồn dập).
   - Tạm thời: mất kết nối, timeout, 5xx, 429.
   - Ghi loại lỗi lên đơn (cột mới hoặc mã trong `pancakeSyncError`, tuỳ chọn ít rủi ro hơn; migration chỉ mở rộng, tiền tố `202611051900xx`). Admin đọc được loại + câu hướng dẫn tiếng Việt: "Pancake từ chối dữ liệu đơn: sửa X rồi bấm Đẩy lại", "Khoá API Pancake sai/hết hạn: báo kỹ thuật", "Pancake tạm lỗi: hệ thống tự thử lại tới HH:MM".
   - Lỗi 401/403 (cấu hình) không đốt hết lượt của mọi đơn: kiểm xem hiện tại có làm vậy không; nếu có, dừng thử lại sớm và báo một lần (dùng kênh báo động đã có), không spam mỗi đơn.
3. **Job lỗi không đọng mãi:**
   - Khi đơn đã đẩy thành công, đã huỷ, hoặc admin đã xử lý (STALE được người bấm Đẩy lại/đánh dấu), gỡ job lỗi cũ của đơn đó trong `pancake-push` (jobId = orderId). Kiểm việc "Đẩy lại" hiện có gỡ job lỗi trước khi add không: BullMQ bỏ qua `add` khi jobId đã tồn tại ở tập failed.
   - `removeOnFail` thêm hạn tuổi (vd `{ age: 30 ngày, count: 1000 }`) cho mọi job pancake-push. Có thể áp cho các hàng khác nếu cùng chỗ cấu hình; ghi rõ trong báo cáo.
   - go-live `queues.backlog` (`apps/api/src/config/go-live/redis-checks.ts`): job failed của pancake-push chỉ tính WARN khi đơn tương ứng còn cần xử lý (đơn chưa huỷ/chưa giao và chưa có `pancakeOrderId`). Job của đơn đã xong thì báo PASS kèm số "đã xử lý, chờ dọn". Dòng WARN nêu mã đơn (tối đa 5) và lý do ngắn, để người deploy biết đó là đơn nào.
4. **Admin hiển thị rõ:**
   - Ở chi tiết đơn và danh sách "Cần xử lý Pancake": loại lỗi, lần thử cuối, số lần thử, lần tự thử kế tiếp (nếu còn), và nút đúng ngữ cảnh. Lỗi vĩnh viễn: "Đẩy lại" sau khi sửa. Lỗi cấu hình: không cho bấm đẩy lại hàng loạt.
   - Tab Sức khoẻ hệ thống: số đơn chờ đẩy / lỗi vĩnh viễn / lỗi tạm theo loại. Đọc `apps/web/src/components/admin/pancake-sync.tsx` và `ops-health-tab.tsx` trước, tận dụng chỗ đã có, không làm màn mới nếu đã có chỗ đặt.
5. **Đơn định kỳ** (`platform = 'system'`): thẻ nền tảng đang rơi về `MINIAPP`. Đổi sang thẻ logic `DINH_KY` (hoặc tên tương tự, theo cách #39 khớp tên thẻ shop) để kho phân biệt. Không khớp thẻ shop thì bỏ như #39.

## Test bắt buộc (đỏ trước)
- Unit: phân loại lỗi (bảng mã HTTP → loại), body không mang tên thẻ lạ, thẻ đơn định kỳ, go-live backlog (job của đơn đã huỷ → PASS; đơn còn mở → WARN nêu mã đơn).
- Race/integration trên PG thật: đơn đẩy lỗi vĩnh viễn → huỷ đơn → job lỗi bị gỡ; bấm "Đẩy lại" khi job lỗi cũ còn → job mới thật sự chạy (không bị BullMQ bỏ qua); 401 hàng loạt không đốt lượt từng đơn (nếu có sửa).
- vitest web: admin hiển thị loại lỗi + câu hướng dẫn; nút đẩy lại theo loại.
- Không gọi Pancake thật. Fake client như các race spec hiện có.

## Ngoài phạm vi
- Không sửa luồng nhận webhook Pancake (401 webhook là việc cấu hình của chủ).
- Không đổi `packages/app-core`, `packages/shared-types` (cần thì dừng, ghi báo cáo).
