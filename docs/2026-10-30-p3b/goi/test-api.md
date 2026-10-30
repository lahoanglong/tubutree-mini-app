# Gói P3b test-api: Test Mini rớt ngẫu nhiên, log Zalo OA, tên test, /home/me

Gốc: main 2ca045580. Nguồn: P3 ở lượt review cuối các gói đợt P3 29/10 (docs/2026-10-29-p3, đã merge PR #75 và deploy), mục làm dở, và vài mục còn lại trong báo cáo.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (đường dẫn worktree p3-* trong mô tả cũ đã xoá, đọc ở worktree của gói này; dòng có thể lệch). Đã hết thì skipped + bằng chứng file:dòng. Mục cần chủ quyết (giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ.

## api-hotro-r1

File: apps/api/src/modules/integrations/zns/zalo-oa-token.cron.ts:25

Vấn đề: Item 12 is only partly closed. There is still one refresh failure path whose log lacks the string "Zalo OA refresh". In refresh(), readConfig(K_REFRESH) (zalo-oa-token.service.ts:52) and readConfig(K_EXPIRES) in refreshIfNeeded (line 45) both sit outside the try. If a DB read fails during the 6-hour cron run (for example a P2024 pool timeout), the error goes to the cron's catch, which logs `Làm mới Zalo OA access token lỗi: ...`. When the token then drops below 3 hours, the warning at ops-health.service.ts:277 tells the on-call person to search the log for "Zalo OA refresh", and that search finds nothing. The new spec comment (zalo-oa-token.service.spec.ts:99) says every refresh error must match that string, but the spec only checks the DB-write-failure case inside the service.

Cách sửa đề xuất: Change the cron log line to `this.logger.error(`Zalo OA refresh: lượt cron lỗi: ${err instanceof Error ? err.message : err}`)` and add a case to the cron spec (or zalo-oa-token.service.spec) where readConfig is rejected and the log must contain 'Zalo OA refresh'. Another option is to change the hint at ops-health.service.ts:277 to 'xem log ZaloOaToken' so it matches both the service and cron contexts.

## diem-doirac-r1

File: apps/miniapp/src/components/game/g3.spec.tsx:29,47,70,91; apps/web/src/components/game/g3.spec.tsx:21,36,55; apps/web/src/components/recycle/recycle-points.spec.tsx:108,194; apps/web/src/components/recycle/recycle-points.tsx:109

Vấn đề: Gói này đã sửa các file trên nhưng vẫn để mã mục trong tên describe/it và comment: '(B-81)', '(B-79)', '(B-15)', '(B-107)', '(B-36)', '(Q2)'. Brief cấm nhắc mã mục, và R1-2 đã dọn đúng kiểu này ở ba spec khác. Các mã này có từ trước, không phải gói thêm vào, nên không chặn merge.

Cách sửa đề xuất: Bỏ phần '(B-xx)' và '(Q2)' khỏi tên describe/it ở hai file g3.spec.tsx và recycle-points.spec.tsx. Ở recycle-points.tsx:109, viết lại comment chỉ còn lý do: '...chỉ chỉ đường sang Mini App, không có đường lách.'

## flaky-mini

File: apps/miniapp/src/components/subscribe-sheet.spec.tsx:60 (tìm đúng đường dẫn), apps/miniapp/src/pages/product-detail-review-link.spec.tsx, apps/miniapp/src/pages/product-detail-a11y*.spec.tsx

Vấn đề: Ba spec vitest Mini rớt ngẫu nhiên khi máy tải cao (waitFor hết giờ, nhất là chạy với TZ=UTC trong gate.sh). Gây gate đỏ giả ở nhiều gói đợt trước (admin-4, diem-doirac, ctv).

Cách sửa đề xuất: Tìm gốc (timer thật, waitFor mặc định 1s, dữ liệu async không mock, query chưa resolve) và sửa test cho chắc, không tăng timeout bừa. Chứng minh: chạy mỗi spec 30 lần liên tiếp (vitest --run, cả TZ=UTC) với máy đang chạy song song vitest web, 0 lần rớt. Ghi lệnh và kết quả vào checks.

## tin-canhan-25

**BỎ khỏi đợt này: phiên b4 đang sửa apps/api/src/modules/catalog/home.service.ts (/home/me, nhánh hieunang3). Không sửa; nếu worktree đã sửa chỗ này thì trả lại như gốc 2ca045580. Báo cáo ghi skipped.**

File: apps/api (route GET /home/me), apps/miniapp/src/services/home-feed.ts, packages/app-core (HomeMeDTO nếu có), apps/web

Vấn đề: /home/me vẫn trả khối notifications dù Mini/web đã đếm chưa đọc qua /me/notifications/unread-count; payload thừa mỗi lần mở trang chủ.

Cách sửa đề xuất: Kiểm hai nền không còn đọc khối notifications của /home/me (grep). Nếu không còn ai đọc: bỏ khối khỏi API và DTO, giữ tương thích bản Mini Live cũ (V21+): nếu Mini Live cũ còn đọc thì KHÔNG bỏ, ghi skipped kèm bằng chứng. Test API + vitest hai nền.

