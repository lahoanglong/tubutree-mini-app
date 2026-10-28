# doirac đợt B (worker)

Nhánh review/1028-doirac tip cdc2fb2d9c72e0043b1d7846baa6776e32fe9844

LƯỢT 2. Commit mới (trên ad67bca60): afe300bec fix(doi-rac) phí ship khớp 84_VN79/79 ở API + go-live kiểm vùng phí chứa tỉnh kho + chặn xoá trắng thể lệ khi đang bật; ee9aa0c82 fix(doi-rac) web xoá cờ "vừa gửi"; a1f46b702 fix(doi-rac) Học viện báo mất kết nối + trang chọn điểm không đòi số khi đã có số; cdc2fb2d9 refactor(doi-rac) thứ tự thẻ cách giao dùng chung ở app-core + khung chờ route lazy Mini.

Phát hiện review:
- P2 cờ "vừa gửi" (web): ĐÃ SỬA. Xoá cờ ở recycle-done, recycle-requests (mount) và onClick lối Thu kèm rác ở thanh-toan/page.tsx (một dòng, file thuộc gói khác, có thể xung đột nhỏ khi gộp). Thêm test recycle-done.
- P2 academy unavailable (Mini): ĐÃ SỬA. Phase unavailable hiện SessionUnavailable + Thử lại; chỉ loading mới hiện khung chờ. Thêm test.
- P2 go-live PASS sai: ĐÃ SỬA. provinceKey/sameProvince chuyển sang packages/shared-types/src/waste-province.ts (app-core re-export); waste-fee.ts dùng sameProvince; go-live thu mã tỉnh kho ACTIVE và FAIL nếu không vùng nào chứa (79 và 84_VN79 coi là một). Test mới ở waste-fee.spec, db-checks.spec, collect.spec.
- P3 recycle-points 403: SỬA (chỉ WastePhoneNeeded khi me chưa eligibility OK; test mới).
- P3 xoá trắng waste.rules_text khi waste.enabled=true: SỬA ở SystemConfigService (test mới; sửa mock waste-config.keys.spec).
- P3 thẻ nhảy chỗ và lặp luật xếp: SỬA, app-core/waste-method-order.ts (+spec 4 ca); chưa đủ preview thì giữ thứ tự gốc.
- P3 comment recycle-page-skeleton: SỬA.
- P3 vai trò academy cũ trong store (Mini): KHÔNG LÀM; lối gọi API cho khách thường trái yêu cầu R-53 "không gọi API chỉ để nhận 403", vai trò làm mới khi mở lại app.
- P3 R-53 earn-sheet.tsx (Mini+web) và account-menu.ts, profile.tsx: KHÔNG LÀM; thuộc gói khampha/taikhoan theo backlog. Mục R-53 trong gói này chỉ MỘT PHẦN (cổng + chân trang + API gọi theo vai).
- P3 feed lệch bố cục Mini/web: KHÔNG LÀM; cần chủ chốt một bố cục (Mini không có Xếp hạng/Đăng bài, web có). Ghi lại là chưa xong.
- R-54: Mini LÀM theo cách không tăng entry: RouteFallback dùng chung ở app.tsx đổi từ Box+Spinner sang khối chờ tubu-skeleton (bỏ import Box/Spinner), kèm khung chờ trong trang. Web (gate query + khung chờ) đã làm lượt 1. Đổi RouteFallback tác động mọi route lazy của Mini (không chỉ Đổi rác).
- R-56: MỘT PHẦN. Web recycle-new về /doi-rac, thanh đăng nhập dính đáy đã làm; web đọc bài/chat khi chưa đăng nhập KHÔNG LÀM vì API cần JWT (cần chủ quyết có endpoint đọc công khai).
- R-1, R-11, R-46..R-52, R-55, R-128, R-129: như lượt 1; R-48/49 nay phủ cả API.

Kiểm (số thật):
- tsc --noEmit sạch: api, web, miniapp, app-core, e2e, shared-types. eslint sạch file đã sửa (api, web, miniapp).
- jest api 484 suite, 11231/11231. vitest app-core 929/929; web 7443/7443 (441 file); miniapp 4866/4866 (313 file), chạy thêm TZ=UTC: 4866/4866.
- Playwright Mini E2E_SCOPE=miniapp: 204 passed, 10 skipped, 1 flaky (returns-reversal, đạt khi chạy lại). Web gate toàn bộ: 354 passed, 38 skipped.
- pnpm lint:parity xanh (0 mục pending). Race test không chạy (không đổi điểm/tiền).
- Bundle Mini (vite build + bundle-report): entry 708 KB (baseline 711, giảm 3); tổng 1915 KB (baseline 1911, +4 KB nằm ở chunk lazy: tính năng mới, entry không tăng). Web next build/First Load KHÔNG đo lại ở lượt này (chưa kiểm).
- perf/run-all.mjs: không chạy theo lệnh.

Ảnh trước/sau (đã chụp lại lane 1, đã xem recycle-new, academy, slow5s): /Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028/docs/2026-10-28-review/screens-doirac/ (recycle, recycle-new, recycle-requests, recycle-points, recycle-rules, feed, academy, chat). Khung chờ Mini chậm 5s: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/r1028-doirac/docs/2026-10-28-review/screens/mini375-slow5s/recycle__returning__mini375-slow5s__s1.png (có tiêu đề + khối chờ, không màn trắng). Chưa chụp riêng trạng thái academy unavailable (có test đơn vị).
Lane 1 đã dừng. Còn file chưa commit: docs/2026-10-28-review/tools/params-l1.json (sinh tự động, cố ý không commit); routes.json đã khôi phục. Không push.

Cần chủ: điền company.*, 4 chính sách legal.*, thể lệ, giờ mở cửa, vùng phí (nhập cả "79" và "84_VN79"); chốt bố cục feed Mini/web; quyết endpoint đọc công khai cho web khách (R-56); R-53 phần menu thuộc gói khác.
