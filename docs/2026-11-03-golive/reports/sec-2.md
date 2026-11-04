# sec lượt 2 (nhánh gl/1103-sec)

- P1 body-limits 10 MB: SỬA. `scanRawJson` chạy trong `verify` của parser json (tầng 256 KB, 1 MB webhook, 10 MB), quét O(n) đếm khoá/phần tử/độ sâu trước JSON.parse, lỗi `entity.complex` -> 400. Đo thân 10 MB 850 000 khoá: /api/admin/x 400 sau 633 ms (có tải máy ~cao), /api/feed 87 ms; không còn JSON.parse trên thân đó (jest spy). Chưa chạy lại dos*.mjs với /health (cần API chạy thật).
- P2 fullName: SỬA. Bỏ NO_HTML ở DTO, `UsersService.updateMe` chỉ chặn `<>` khi tên khác tên đang lưu. Test mới.
- P3 CORS: SỬA. `app.enableCors` ngay sau create; bootstrap.spec kiểm access-control-allow-origin ở 413 (đỏ với mã cũ).
- P3 MST gõ dở: SỬA. 11 số liền và `\d{10}-\d{0,2}` không báo đỏ; test mới.
- P3 khoá ảnh khách: SỬA. `writeWithGuestImageQuota`: kiểm + ghi trong $transaction với pg_advisory_xact_lock('guest-feed-images'), chỉ cho khách vãng lai có ảnh data:. Test mới (chưa chạy race Postgres thật).
- P3 ảnh trước/sau + bundle: KHÔNG làm. Cần lane Mini/web chạy và máy đang tải cao; để người gộp chụp 375/1280 trước khi merge. Đổi UI chỉ là dòng lỗi MST đã có từ lượt 1.

Kiểm: jest feed+common+bootstrap+users 1469/1472 (3 fail ở app-throttler.guard.spec do tải, chạy lại riêng 13/13); tsc api sạch; vitest app-core 167 file xanh.
