# Tiến độ đợt hoàn thiện 05/11 (hard/1105)

Kế hoạch: `PLAN.md`. Phát hiện và quyết định của chủ: `audit-1105-findings.md`. Luật chung cho mọi gói: `hard-1105-rules.md`. Brief từng gói: `brief-<gói>.md`.

## Nhánh
- Đợt 1 (xong): tích hợp `hard/1105`, dựng từ tip `sec/1104-audit` (3b021b59b, PR #167). Gói (gốc d79ceeb85): `hard/1105-ha`, `hard/1105-hb`, `hard/1105-hc`. Đã merge qua PR #168. Worktree và nhánh local đã dọn 05/11.
- Đợt 3 (xong): tích hợp `hard/1105-w3`, gốc main 94a557702. Gói: `hard/1105-he`, `hard/1105-hf`, `hard/1105-hg`. Đã merge qua PR #174 (main 6ec0dee82, kéo theo docs #173) và đã deploy. Worktree và nhánh local của gói đã dọn 05/11.
- Đợt 2 (xong): tích hợp `hard/1105-w2`, gốc main 2da8b1337. Gói: `hard/1105-hd1`, `hard/1105-hd2`, `hard/1105-hd3`. Đã merge qua PR #172 (main 94a557702) và đã deploy. Worktree, nhánh local của đợt 2 và của `sec/1104-*` đã dọn 05/11.

## Đợt 1
- hc (cashback): merge 43c464971. Opus APPROVE. Migration 20261105120000_cashback_admin_review_guard. Nit còn: cảnh báo ADMIN_OVERRIDE có thể mất trong cửa sổ vài ms.
- ha (quyền nhân sự, L1-05, L1-06): merge bbec41f47. Opus 3 vòng, vòng 3 APPROVE 0/0/0. Migration 20261105100000, 100100 (sửa tại chỗ: thu hồi lời mời ADMIN cho số chưa có tài khoản), 100200 admin_export_logs, 100300 commission_rate_history. NIT còn:
  - revokeGrant khoá gian hàng cả khi người bị thu hồi không mất gian hàng; có thể chờ createPayout, quá lock_timeout thì 503.
  - updateMany khoá grant theo index (phone, role), applyGrants theo id; hai grant mở cùng SĐT + refresh song song có thể 40P01. Gần như không xảy ra.
- hb (phiên, L1-04): merge 102a33dcb (giải 9 xung đột với ha). Opus 3 vòng + duyệt c6ab6b94a (mọi tx cắt phiên khoá dòng users rồi mới lấy mốc; ca latch 2 kiểm khe). Migration 20261105110000_refresh_token_parent. NIT còn: phiên vừa đăng nhập đúng lúc logout-all chưa commit có thể nhận 401 một lần.
- Review chéo cả nhánh (Opus): APPROVE 0/0/2/2. Hai MINOR sửa ở f111b2208 (Opus APPROVE):
  - SESSIONS_REVOKED lấy riêng 20 dòng, không đẩy lịch sử khoá/vai trò khỏi drawer.
  - Huỷ hoa hồng ghi kind `COMMISSION_FORFEIT`, drawer hiện "Huỷ hoa hồng chờ rút".
- Kiểm (worker, trước f111b2208): tsc api/web/miniapp 0; vitest web 10117/10117; DB sạch migrate deploy 0, drift 0; race 357 suite / 2796 test. jest api sau f111b2208: 13813/13813.
- Gộp main c88ef883e (#167) ở 9472dad9a, sửa câu đếm runbook ở 4c6d615f4 và chữ 503 webhook cashback ("vui lòng") ở e6f778382. Mở PR #168.
- ce334ff55: 9 spec dựng server thử bằng `listen(0, '127.0.0.1')` (body-limits đỏ 404 khi chạy cùng Playwright, 4f báo).
- Gộp main 649753301 (#169 web/1105-int) ở 422b7a3e4. Xung đột:
  - `rbac.service.ts`: giữ `applyGrants(user)` + `applyGrantsWith` của main (markStale sau commit), thêm `reason` của ha.
  - `admin.service.ts`: `setUserRole` giữ `revokeGrantsAbove` trong tx (ha) và thêm `invalidateRegistry()` sau commit (main).
  - Opus APPROVE. Sửa thêm các điểm Opus nêu:
    - e395b9161: `applyGrants` chỉ markStale khi chính lượt này ghi vai trò.
    - f370ae891: `addGrant` lấy `applied` theo `changed`.
    - Opus APPROVE. Mỗi test mới đỏ trên bản cũ.
- Kiểm cục bộ ở 422b7a3e4:
  - gate 0 FAIL.
  - jest 577 suite / 13863 test; race 357 / 2796; migrate 0, drift 0.
  - vitest: app-core 2688, miniapp 6710 (cả UTC), web 10193.
  - Playwright: mini 475 passed; web 739 passed, 0 failed.
- Kiểm sau f370ae891: jest staff, admin, auth 1368 test; race quyền 38 suite / 403 test. CI 8/8 xanh.
- **PR #168 ĐÃ MERGE** (main 2da8b1337) và **ĐÃ DEPLOY** Vietnix 05/11 01:29–01:35 (phiên hard, chủ cho phép):
  - dep1: 0 FAIL. dep2: 6 migration (282 → 288), API ngừng 23 giây; seed thêm `staff.grant_invite_ttl_days` = 7.
  - dep3: 48 PASS / 18 WARN / 0 FAIL, smoke xanh. Route mới đã map. Có index `refresh_tokens_parentId_idx`. Log 15 phút không có lỗi.
  - Backup `/var/backups/tubutree/tubutree_20261105_013414.sql.gz`. Rollback = image `:prev-64975330`, không cần down migration.
  - `.golive-*` của lượt này ở `/root/golive-archive/2da8b133/`.

## Đã kiểm trên PROD trước deploy đợt 1 (chỉ đọc, chủ cho phép, 05/11 ~00:00)
- `refresh_tokens`: 119 dòng, 144 kB. Index của 20261105110000 dựng xong tức thì.
- Lời mời ADMIN đang mở cho số chưa có tài khoản: 0, nên 20261105100100 không thu hồi lời mời nào.
- `cashback_transactions`: 0 dòng, không có dòng Kế toán từ chối tay nào cần bảo vệ.
- Còn lại: Mini App bản cũ không gửi lý do khi cấp/thu quyền, nên sổ ghi "(không có lý do — Mini App bản cũ)". Gói he thêm ô lý do; DTO đổi về bắt buộc sau khi Mini App mới lên PROD.

## Đợt 2 (đã merge PR #172, đã deploy; gốc 2da8b1337)
- hd1 (index và truy vấn, PG 46534), hd2 (hàng đợi, timeout, breaker, PG 46535), hd3 (payload ảnh, cột nặng, PG 46536). Brief: `brief-hd1.md`, `brief-hd2.md`, `brief-hd3.md`.
- Giới hạn RAM (máy dùng chung với phiên web): jest `--maxWorkers=2`, vitest tối đa 2 luồng, Playwright `--workers=2`.
- Phiên web báo #170 dep3 xong 05/11 02:2x (PROD c68ce32f3). Cache ảnh `/api/img` mất mỗi deploy: phiên web làm ở nhánh riêng; đợt 2 không đụng image-resize.ts, compose, dep script.
- hd1: 12 commit 82f856991..c8a9c4e51. Kiểm của điều phối ở c8a9c4e51: tsc, eslint 0; jest 579 suite / 13891 test; migrate 0, drift 0; race 361 / 2805.
  - Opus REQUEST_CHANGES (1 MAJOR, 4 MINOR, 3 NIT), đang sửa:
    - MAJOR L3-15: `usedCount` không luôn đi cùng redemption (chỉ tăng/giảm khi có trần; đơn đặt dở lúc admin đặt trần). Theo brief, kiểm trước trả về đếm redemption.
    - total cache 60 s lệch `items`; index một phần INAPP không dùng được ở generic plan (đổi sang index thường có `channel`); 130200 vào HEAVY + bộ quét thêm `notification_logs`; recompute-sold trả thêm `zeroed`/`scanned`; 3 NIT.
  - Sửa ở 74bb8f20a..49bc36137; kiểm của điều phối ở 49bc36137: tsc api/web 0, eslint 0, vitest web 10194, jest 579 / 13894, drift 0, race 361 / 2808.
  - Opus vòng 2 APPROVE, 1 MINOR (total thổi phồng khi trang rỗng) + 3 NIT, sửa ở 3f325c92a..de2a3598c.
  - Opus vòng 3 APPROVE, 1 MINOR (test EXPLAIN phụ thuộc thống kê do `perf-indexes-1104` để lại) + 1 NIT, sửa ở 936d41a27, 263f060fa (test đỏ khi chạy cặp, xanh cả hai thứ tự). Gộp vào w2 ở 34af8e344.
- hd2: 7 commit 6031d5bb1..d940cf9ce. Kiểm của điều phối ở d940cf9ce: tsc, eslint 0; jest 583 / 13897; migrate 0, drift 0; race 358 / 2798.
  - Opus REQUEST_CHANGES. MAJOR: brief hạ timeout ZNS 25 → 10 giây, quay lại lỗi gửi đôi đã sửa ở R3-UI-11 (a49c30426). **Chủ chốt 05/11: giữ 25 giây.**
  - MINOR (đã sửa ở d1c582897..d61630730): breaker đếm cả lô quét sức khoẻ; chặn ZNS cùng dedupeKey theo (sentAt, id) vẫn gửi đôi được khi commit đảo thứ tự (đổi sang khoá advisory + CAS); log sau bị bỏ qua khi log trước hỏng hẳn (đổi sang hoãn); runbook §1.19 thiếu script chạy tay. NIT: partial index payouts vô dụng ở generic plan, `take 200` trước lọc giảm giá, lượt tính hộp việc treo giữ mãi.
  - Opus vòng 2 APPROVE (1 MINOR runbook §1.20, NIT ping không đóng breaker), sửa ở cd0e61efe, 992dcef52. Gộp vào w2 ở 587f372e7.
  - Migration đổi tên thành `20261105140000_payouts_status_index` (index thường, chưa lên đâu).
  - Còn lại, có từ trước (gói sau): log ZNS kẹt RETRYING khi job hỏng hẳn chặn tin cùng khoá; đề xuất coi RETRYING không đổi quá ~1 giờ là chết.
  - Deploy: thêm một dòng `DB_SESSION_OPTIONS='...'` vào `.env` VPS rồi tạo lại `api` (bước 9). Không đổi compose, Dockerfile hay lệnh migrate: chỉ `PrismaService` đọc biến này, CLI Prisma luôn dùng `DATABASE_URL` trơn. Runbook §1.19.
- hd3: 6 commit b48416624..02eefc05c, không migration. Opus APPROVE (3 MINOR), sửa ở b3a2cec09..ce5aad3d8 (kẹp limit 50 thay vì 400, PDP bớt cột kéo từ DB, AdminImage tải khi vào khung nhìn + ô lỗi). Opus vòng 2 APPROVE (rút lại điểm "PDP lộ cột": `toPublicProductDetail` vốn đã lọc), 3 NIT sửa ở 0ef6e785f. Gộp vào w2 ở b1a0388e6.
  - Response admin đổi (ảnh thành ref, route ảnh admin mới chỉ ADMIN): API và web phải lên cùng lần deploy, rollback cùng cặp. Runbook §1.21 và §7.4.
- Gộp main c68ce32f3 (#170) ở e265c0dd5, không xung đột.
- Opus review chéo cả nhánh, vòng 1 APPROVE với MAJOR ẩn: options trong `DATABASE_URL` làm `$DC run api … migrate/seed` và deploy.sh dính statement_timeout. Đổi thiết kế ở 16b80251f..1a891ab2c: `PrismaService` nối `DB_SESSION_OPTIONS` vào datasource; go-live `db.session_timeouts`; `PendingMerchantProductsQuery.page` theo trần 1000; §1.0 thêm 3 migration hd1; `IMAGE_COMPATIBLE_MIGRATIONS` thêm 7 migration đợt 2.
- Gộp main 7589f36c9 (#171 cache ảnh) ở f9cffe992. Mục runbook cache ảnh của phiên web đổi số thành 1.22 (dep3-check.sh theo).
- Review chéo vòng 2 REQUEST_CHANGES: khối lệnh 7.2 dựng lại chỉ mục đánh giá cũ vô điều kiện, sai khi r8 đã áp (PROD từ tháng 10). Sửa ở 9c4c8ad95..c18f3bc2a: chỉ chạy khi `.pending-migrations` có r8; bảng 7.0 cùng điều kiện; `db.pending_scope` PASS nêu migration nặng; §1.19 dòng env trước bước 4 + `$DC config`. Mỗi điểm có spec đỏ trước. Vòng 3, 4: APPROVE.
- Kiểm cuối ở 1a891ab2c (giới hạn 2 worker): gate 0 FAIL; migrate 0, drift 0; race 364 suite / 2822 test; vitest app-core 2688, miniapp 6710 (cả UTC), web 601 file / 10225; Playwright Mini App 475 passed / 10 skipped, web 740 passed / 137 skipped / 0 failed. jest 14019/14020: 1 đỏ `refill-removed-audit.spec.ts` (còn đòi chữ "sáu tên này"), sửa ở 8cb7dc98f.
- Kiểm phần đổi ở c18f3bc2a: tsc api 0, eslint api 0, jest 587 suite / 14030 test.
- Migration đợt 2 (7, đều CREATE INDEX, image cũ chạy được): 20261105130000..130500 (HEAVY: 130100 users, 130200 notification_logs, 130300 points_transactions), 20261105140000_payouts_status_index.

## Deploy đợt 2 (05/11, PROD 94a557702)
- Đọc PROD trước deploy (chỉ đọc, chủ cho phép): users 3, notification_logs 58, points_transactions 0, coupons 4, feed_posts 1, reviews 0, payouts 0. 288 migration đã áp, 0 đang dở. Compose v5.3.1. `.env` chưa có `DB_SESSION_OPTIONS`.
- PR #172: CI 8/8 xanh, merge thành main 94a557702.
- `.env` VPS: thêm `DB_SESSION_OPTIONS='-c statement_timeout=30s -c lock_timeout=10s -c idle_in_transaction_session_timeout=30s'` trước bước 4 (runbook §1.19). Sao lưu: `/root/golive-archive/env-before-db-session-20261105052410`. `$DC config` ra đúng giá trị, không còn dấu nháy.
- dep1: image api 09985aa679fc, web 60ce23ad126e; sharp ổn; check-env hợp lệ; go-live trước deploy 49 PASS / 19 WARN / 0 FAIL; 7 migration chờ; đĩa trống 12G.
- dep2: migrate 288 → 295 trong 2,7 giây, 0 đang dở. API ngừng 22 giây.
- dep3: go-live sau deploy 49 PASS / 18 WARN / 0 FAIL. `db.session_timeouts` PASS (30s/10s/30s). `queues.reachable` PASS, đủ 9 hàng đợi gồm `notifications-inapp-retry`. Smoke xanh. Log API 15 phút: 0 dòng ERROR/57014/55P03/P2028. Container không khởi động lại.
- WARN `queues.backlog`: pancake-push có 1 job failed, đã có từ trước deploy.
- Quay lại: image `:prev-7589f36c` cho cả api và web (runbook 7.2). Nếu bỏ hạn chờ: xoá dòng `DB_SESSION_OPTIONS` trong `.env` rồi tạo lại `api`.
- File go-live: `/root/golive-archive/94a55770/`. `.pending-migrations` để nguyên ở `/opt/tubutree` cho runbook 7.2.

## Đợt 3 (đã merge PR #174, đã deploy; tích hợp `hard/1105-w3`, gốc main 94a557702 + docs 461c99ac8)
- Chủ chọn 05/11: push docs PR (#173) và làm đợt 3, thêm lỗi ZNS kẹt RETRYING. Test tối đa 2 worker. Hỏi chủ trước khi merge hoặc deploy.
- he (Mini App, PG 46537): L4-01, L4-02, L4-03 phần Mini App, L4-04, L4-05, ô lý do cấp/thu quyền. app-core chỉ được thêm `reason` tuỳ chọn ở `staff.ts`.
- hf (admin web + nhãn lỗi, PG 46538): L4-03 phần admin + `FIELD_LABELS`, L4-06.
- hg (log ZNS kẹt PENDING/RETRYING khi job chết, PG 46539): brief `brief-hg.md`.
- he: 33 commit, tip b5d5a5dcc. Opus 7 vòng tới APPROVE. Đáng nhớ:
  - Ô MST checkout trần 14 chặn chuỗi có dấu chấm. Nới trần.
  - Chống trùng `POST /feed` và `/feed/events` bằng khoá advisory theo user. Vòng 3 lộ MAJOR: tag sản phẩm ghi sau commit nên bài đôi vẫn lọt. Sửa: ghi tag trong cùng giao dịch, khoá sản phẩm `FOR KEY SHARE`. Opus thử 160/160 lần.
  - Ví và Đơn của web, Mini App chuyển sang keyset `cursor`. API cũ không trả `nextCursor` thì client tự quay về `page`.
  - Tiêu đề, bài, bình luận cắt khoảng trắng và ký tự vô hình ở hai đầu (`trimInvisible`), giữ emoji ghép.
- hf: 48 commit, tip 3053b2771. Opus nhiều vòng tới APPROVE. Đáng nhớ:
  - Ô SĐT `setUserRole` trần 11 nâng 20.
  - Slug sản phẩm một nguồn `PRODUCT_SLUG_MAX = 240` ở shared-types, dùng chung cho API, DTO, app-core và web. Trước đó ENTITY_SLUG_RE là 120, còn UI cho 200.
  - Slug Pancake cắt theo trần, slug rỗng hoặc bắt đầu bằng `-` thành `san-pham`.
  - `?slugs=` trần 20 mục và 4820 ký tự.
  - Tab Giờ vàng ở admin chuyển sang keyset `?status&take&cursor` và route chi tiết.
- hg: 40 commit, tip e2754a011. Opus APPROVE.
  - `writeFailure` chỉ một câu UPDATE, nhả khoá dedupe `<key>:failed:<logId>`.
  - `ZnsStuckLogCron` chạy */30 phút, con trỏ Redis `zns-stuck-cron:cursor`, quét keyset (sentAt, id), tối đa 200 log mỗi lần.
  - Migration `20261105180000_hg_zns_stuck_logs_index` (HEAVY, IMAGE_COMPATIBLE), runbook §1.0, §1.20, §7.0.
  - CI race thêm service Redis.
  - Test `perf-indexes-1104` D4 đỏ ngẫu nhiên vì seed 50 giờ làm khoảng 30 ngày chọn gần cả bảng. Sửa: seed thêm 20000 log cũ 31–170 ngày; chạy 16/16 lần DB mới đều xanh.
- Gộp vào w3: 3b9b093c8 (hg), c187b5716 (hf), 8e41b28d2 (he, giải xung đột `community-feed.dto.spec.ts` giữ cả hai khối), 780c3cd34 (he vòng 6–7). Sửa thêm trên w3:
  - 7e3c2f025: nhãn cron mới.
  - 2a683c32c: `withDbUrlParams`, race chạy được cả khi `DATABASE_URL` không có `?schema=`.
  - 1192af91d, 072128def: runbook §1.23.
- Opus review chéo cả nhánh: APPROVE, 0 MAJOR. Hai MINOR thành ghi chú runbook §1.23: ZMP cũ bỏ banner slug 121–240; quay API giữa lúc cuộn thì "Tải thêm" 400 tới khi tải lại.
- Opus xem phần gộp riêng của w3: merge sạch (so patch-id từng file), helper race đúng. 4 MINOR chữ runbook và 1 NIT nhãn cron, đã sửa ở 072128def:
  - kiểm slug sai mẫu cả products lẫn categories;
  - form admin cũ luôn gửi lại đích;
  - 400 cursor lặp lại mỗi lần bấm;
  - tab Giờ vàng lúc web và API lệch bản;
  - ZMP mới chạy với API cũ.
- Kiểm cuối ở 1192af91d, giới hạn 2 worker:
  - gate 0 FAIL;
  - vitest app-core 2695, miniapp 6799 (cả UTC), web 604 file / 10264;
  - bundle Mini entry 666/208 KB;
  - migrate 0, drift 0; race 371 suite / 2878 test;
  - jest api 599 suite / 14233 test; Playwright Mini App 475 passed / 10 skipped, web 740 passed / 137 skipped / 0 failed.
- 072128def chỉ đổi chữ runbook và nhãn: spec đọc runbook 4 suite / 136 test, `cron-job-labels` 2/2.
- Đọc PROD trước deploy (chỉ đọc, chủ cho phép):
  - products 156, slug dài nhất 101, slug sai mẫu 0; categories slug sai mẫu 0;
  - notification_logs 58; log ZNS 0 (không có log kẹt);
  - 295 migration; PROD 94a557702.

## Deploy đợt 3 (05/11, PROD 6ec0dee82)
- PR #174: CI 8/8 xanh, merge thành main 6ec0dee82. PR docs #173 tự thành merged vì commit 461c99ac8 đã nằm trong w3.
- dep1, 10:08–10:13:
  - image mới: api 37615285af4c, web c5a0d3269960; sharp ổn; check-env hợp lệ;
  - go-live trước deploy 50 PASS / 19 WARN / 0 FAIL; 1 migration chờ; đĩa trống 11G.
- dep2, 10:14:
  - backup `tubutree_20261105_101401.sql.gz`;
  - migrate 295 → 296 trong 2,8 giây, 0 đang dở; API ngừng 22 giây.
- dep3:
  - go-live sau deploy 50 PASS / 18 WARN / 0 FAIL; smoke xanh; `/api/img` 200;
  - `?slugs=` 20 mục 200, 21 mục 400 kèm câu mới, nên bản mới đang chạy;
  - log API 15 phút 0 dòng ERROR/57014/55P03/P2028; container không khởi động lại.
- WARN `queues.backlog`: pancake-push có 1 job failed, đã có từ trước.
- Quay lại: image `:prev-94a55770` cho cả api (09985aa679fc) và web (60ce23ad126e), theo runbook 7.2 và §1.23. Migration 180000 thuộc IMAGE_COMPATIBLE.
- Mini App (ZMP) chưa lên bản mới. Cho tới lúc đó, không gắn chiến dịch vào slug dài hơn 120 ký tự (§1.23).
- File go-live: `/root/golive-archive/6ec0dee8/`. `/opt/tubutree` sạch.

## Đợt 4 (tích hợp `hard/1105-w4`, gốc main 6ec0dee82 + docs 9c3ab9f20)
- Chủ giao 05/11:
  - (1) job pancake-push lỗi: tìm gốc, sửa triệt để trong mã, dọn PROD;
  - (2) làm cả 3 nâng cấp, tuần tự: kiểm chiến dịch trước khi bật, checkout mobile 375px, trang theo dõi đơn.
  - Tối đa 2 subagent và 2 worker test cùng lúc. Gate + Opus xong thì PR, merge, deploy (chủ đã duyệt đọc PROD, PR, deploy). Chủ để điều phối tự chốt thiết kế.
- Đọc PROD (chỉ đọc):
  - job lỗi duy nhất là đơn thử `TUBUSUB7659607093` (định kỳ, platform `system`, CONFIRMED, UNPAID);
  - 73 lần đẩy, đều `422 [tags]: is invalid`; STALE từ 28/10;
  - gói định kỳ thử vẫn ACTIVE, kỳ tới 22/11.
- Nguyên nhân gốc: body gửi `tags` dạng tên tự do; Pancake chỉ nhận thẻ `{id, name}` có trong shop. PR #39 có bản sửa, bị giữ vì đơn thử.
- Chủ chọn: điều phối huỷ đơn và gói thử bằng hàm hệ thống. Script `/root/ops-20261105/cancel-test-order.js`:
  - Opus duyệt GO; đã sửa 3 điểm: chạy lại được, hạn 60s khi đóng app, kiểm admin + gỡ cờ Pancake.
  - Chạy 05/11 10:40 sau backup `tubutree_20261105_104032.sql.gz`, EXIT=0, log `/root/ops-20261105/cancel.log`.
  - Kết quả: đơn CONFIRMED → CANCELLED qua `AdminService.updateOrderStatus` (actor admin của chủ); gói định kỳ → CANCELLED (`SubscriptionsService.setStatus`); cờ "Cần xử lý Pancake" gỡ (`resolvePancakeAttention`); job lỗi gỡ. Hàng `pancake-push` còn failed 0.
- Gói:
  - `hi` (Pancake, PG 46540): gộp PR #39; phân loại lỗi; job lỗi không đọng; go-live chỉ WARN đơn còn cần xử lý; admin hiển thị rõ.
  - `hj` (chiến dịch, PG 46541): API kiểm BLOCK/WARN; admin xem trước banner 375px + desktop; huy hiệu trên danh sách.
  - `hk` (checkout mobile) và `hl` (theo dõi đơn): làm sau khi `hi`/`hj` xong.
- Chỉ thị PO giữa đợt: mỗi gói chỉ cần tsc + eslint + test liên quan xanh và TỐI ĐA một lượt review; `hi` chốt sau vòng sửa 10, không review Opus lại.
- Kết quả từng gói (đã gộp vào `hard/1105-w4`):
  - `hj` (merge f8dcdbaf5): Opus APPROVE r5, r6; sửa r7 đã kiểm lại. Lưu chiến dịch một lệnh một giao dịch, luật `saveVerdict` chung, route `POST /admin/campaigns/check`, huy hiệu sức khoẻ, xem trước banner. Không migration. Runbook 1.25.
  - `hi` (merge 3223ca770): 10 vòng sửa (9 vòng Opus). Loại lỗi `pancakeErrorKind` (migration `20261105190000_hi_order_pancake_error_kind`), dọn job lỗi, go-live chỉ WARN đơn còn cần xử lý. Chống hai đơn kho: lease 60s cho mọi câu ghi trạng thái, dấu gửi `pancakePushClaimedAt` với cửa lắng 5 phút (tối đa một lệnh tạo chưa rõ kết quả mỗi cửa), fence token cho câu ghi cuối lượt, báo "Pancake có 2 đơn" nếu vẫn lọt. Vòng 10 chỉ điều phối tự đọc diff. Runbook 1.24, `so-tay-van-hanh/kho.md`.
  - `hk` (merge 7e0c01f59): checkout Mini + web 375. Lỗi từng ô địa chỉ/hoá đơn, nhảy tới ô lỗi; PRICE_CHANGED có nút nhận giá mới; hết hàng/vượt tồn báo dưới dòng kèm sửa nhanh; mất mạng thì "Thử lại · tổng" cùng khoá. Một lượt Opus: 2 MAJOR (bỏ dòng cuối khi thanh toán một phần rơi về cả giỏ; câu "Chưa gửi được đơn" sai) + 6 mục khác, đã sửa kèm test. `hk-findings.md`.
  - `hl` (merge f14c193ce): trang theo dõi đơn Mini + web. Một câu trạng thái + mốc, hành trình gom mốc hãng, một nút chính mỗi trạng thái, web lg hai cột; logic chung `app-core/commerce/order-tracking.ts`. Một lượt Opus: 1 MAJOR (form đổi/trả mở ngoài màn ở web <md) + 8 mục khác, đã sửa kèm test. Bỏ suy luận lý do huỷ (API không trả). `hl-findings.md`.
- Câu hỏi để gói sau: nhãn "Mặc định" và chip mã 12px lên 13px (bậc chữ dùng chung); API trả lý do huỷ cho khách; giữ khối "Cần hỗ trợ?" cuối trang đơn; xoá khoá chữ `checkout.invoiceIncomplete`.
