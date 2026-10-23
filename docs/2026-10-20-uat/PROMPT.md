# Prompt phiên UAT đêm 2026-10-19 → 2026-10-20 (chép nguyên văn)

Dự án Tubu Tree, repo /Users/longla/coding/tubutree-mini-app, nền origin/main 05e6ae97 (đã có PR #20–#23).
Đêm 2026-10-19 → sáng 2026-10-20: chuẩn bị mở cho khách thật. Review toàn dự án, UAT kỹ theo từng vai trò, sửa lỗi có test, hoàn thiện UI/UX ở mức cao nhất. Tôi ngủ, ~08:00 sáng cần báo cáo và câu hỏi. Được phép dùng Workflow và chạy nhiều subagent song song cả đêm. Chạy không dừng: gặp chỗ cần tôi quyết thì chọn phương án an toàn, đảo ngược được, ghi câu hỏi rồi làm tiếp.

0. KHỞI ĐỘNG
- Mọi lệnh: export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH
- Đọc trước: AGENTS.md; memory MEMORY.md, env-lessons-tubutree, project-uat-2026-10-20; docs/2026-10-review/99-release-readiness.md, UAT-ZALO.md, findings-catalog.md; docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md và 03-cau-hoi-sang.md (mục "Quyết định đã chốt"); docs/2026-10-19-web-parity/98-cau-hoi-va-chua-kiem-chung.md; docs/launch/*.md; docs/GO-LIVE-KEYS.md.
- git fetch; git worktree add -b uat/2026-10-20 .claude/worktrees/uat origin/main; pnpm install --prefer-offline; pnpm --filter @tubutree/shared-types build; (cd apps/api && npx prisma generate).
- Tạo .env riêng cho worktree uat, trỏ Postgres và Redis của mình. Không trỏ tubu_pg 5434 hay tubu_redis 6381 (dev dùng chung): `npx playwright test` trần tự dựng server theo apps/api/.env.
- Ghi mốc đầu đêm: số test từng bộ trên 05e6ae97. Đó là sàn, cuối đêm không được thấp hơn.
- Lưu prompt này vào docs/2026-10-20-uat/PROMPT.md. Mở docs/2026-10-20-uat/PROGRESS.md, ghi mỗi mốc (giờ, commit, lệnh, số test). Script workflow để ở docs/2026-10-20-uat/tools/, không để scratchpad: máy từng tự khởi động lại và xoá /private/tmp (2026-10-19 06:48). Bị ngắt thì đọc PROGRESS.md và journal của workflow, rồi chạy lại bằng resumeFromRunId.

1. PHỐI HỢP VỚI PHIÊN WEB (bắt buộc, đã thoả thuận 2026-10-19 21:50)
Phiên web-parity tên tubutree-mini-app-d3 trong ListAgents. Nếu tên đổi: tìm phiên đang làm .claude/worktrees/web-visual, nhánh web/mobile-visual. Phiên đó sửa web khổ điện thoại cho giống Mini App, xong khoảng 06:00–08:00, chỉ mở PR nháp.
- Khi khởi động: SendMessage cho phiên đó tên phiên mình, worktree, nhánh, cổng.
- Không sửa (của phiên web): apps/web/src/** trừ apps/web/src/app/admin/**; apps/e2e/tests/support/{visual,tour,tour-*}.ts; apps/e2e/tests/visual-tour.*.spec.ts; apps/e2e/scripts/visual-pairs.mjs; docs/2026-10-19-web-parity/**.
- Nhắn và chờ đồng ý trước khi sửa: apps/e2e/tests/support/mock-api.ts, apps/e2e/playwright.config.ts, packages/app-core/** (web dùng chung), spec e2e web.
- Của mình: apps/api, apps/miniapp, apps/web/src/app/admin/**, packages/shared-types, docs/2026-10-20-uat/**. Đổi giao diện Mini App thì nhắn phiên web tên màn và commit, vì Mini App là chuẩn để web theo.
- Lỗi UI/UX web khách: không tự sửa. Gom lô, 1–2 giờ gửi phiên web một lần: route, khổ (390 hoặc 1440), mô tả, đường dẫn ảnh, mức độ. Lỗi logic web khách gây mất tiền hoặc chặn mua: nhắn ngay, chờ đồng ý mới sửa.
- Sau 30 phút không có trả lời: không đụng file đó, làm việc khác. Ghi mọi tin gửi và nhận vào PROGRESS.md mục "Phối hợp".
- Cổng của phiên web: 3121/3122/3123/5199, PG 15432, Redis 16379. Cổng của mình: E2E_API_PORT=3221, E2E_WEB_PORT=3222, E2E_MINIAPP_PORT=3223, GATE_PG_PORT=25432, GATE_REDIS_PORT=26379. Nhắn phiên web trước khi chạy gate nặng (jest full, race, Playwright full, build). Không chạy cùng lúc với gate của họ.
- Không dùng, không xoá, không sửa worktree khác (web-*, launch-review, recycle-*).

2. PHẠM VI
A. UAT thật đầu-cuối, không chỉ mock: API thật, Postgres riêng (dùng Postgres chạy thẳng theo env-lessons nếu cổng Colima chập chờn), Redis riêng, seed (seed.ts, seed-reference.ts). Mini App Vite 390x844 trên WebKit và Chromium với zmp giả như e2e đang dùng. Web 390 và 1440. Admin 1440.
   Vai trò: khách mới quét QR hộp hàng sàn, khách quay lại, CTV, đại lý, nhân viên, kế toán, chủ thương hiệu, kiểm duyệt, admin.
   Hành trình: đăng nhập; duyệt, tìm, chi tiết; giỏ; thanh toán COD và chuyển khoản QR (giả webhook ngân hàng); voucher; flash sale; Điểm Xanh (cộng, tiêu, hết hạn, trần, đúng quyết định đã chốt); định kỳ; đơn sàn quét mã vận đơn; huỷ, hoàn, trả; đổi rác (thu kèm đơn, gửi kiện; hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận, đại lý chỉ carton và nilon); cộng đồng; game; affiliate (hoa hồng, rút tiền); gian hàng /s/<slug> và /brand/<slug>; thông báo; việc hằng ngày của admin.
   Mỗi ca ghi vào docs/2026-10-20-uat/UAT-MATRIX.md: bước, kỳ vọng, thực tế, bằng chứng (ảnh, response, truy vấn DB), PASS hoặc FAIL. Ca tiền và điểm phải đối chiếu số dư và sổ điểm trong DB, không chỉ nhìn màn hình.
B. Review mã sâu bằng reviewer Opus, chia góc và soát chéo: tiền/điểm/ví/hoa hồng; auth/quyền/PII; migration/deploy; đồng thời (race); tin nhắn gửi khách (ZNS, Zalo OA, thư). Không báo lại mục đã sửa trong findings-catalog và launch-review.
C. UI/UX mức cao nhất: chụp mọi màn Mini App 390px và admin 1440px (scripts/uiux/capture.mjs), chấm theo thang của docs/2026-10-18-launch-review/D7-uiux-visual.md. Kiểm trạng thái rỗng, lỗi, đang tải, offline; vùng chạm ≥ 44px; tương phản WCAG AA; nhãn cho trình đọc màn hình; chữ Việt và thuật ngữ nhất quán ("Điểm Xanh", không "xu"); luồng mua lõi ít bước nhất. Hiệu năng: scripts/ci/bundle-budget.cjs, thời gian tải màn chính, truy vấn N+1 ở API.
D. Sẵn sàng deploy (KHÔNG SSH, KHÔNG deploy): diễn tập migrate theo docs/launch/deploy-rollback-runbook.md mục 1.0 và 3.4 trên DB tạm; đối chiếu biến môi trường (.env.example, GO-LIVE-KEYS.md, runbook mục 1.3); build Docker image api và web cục bộ; kiểm runbook khớp mã hiện tại; liệt kê việc chủ phải tự làm (DNS, khoá Pancake, Zalo, rclone, Bộ Công Thương, ...).

3. CÁCH LÀM
1) Discovery song song bằng Workflow. Mỗi nhánh một báo cáo docs/2026-10-20-uat/Dx-*.md, có path:line và bằng chứng.
2) Tổng hợp vào docs/2026-10-20-uat/00-tong-hop.md: P0 (chặn mở khách) đến P3. Tách ba nhóm: "agent sửa ngay", "cần chủ quyết", "chủ tự làm".
3) Sửa: mỗi gói một worktree .claude/worktrees/uat-<gói>, nhánh uat/<gói> từ uat/2026-10-20. Các gói không đụng chung file. TDD: viết test đỏ trên code cũ trước, rồi mới sửa. Worker Sonnet code, reviewer Opus review; gói chạm tiền, điểm, auth, tin nhắn gửi khách, migration review 2 lượt. Gộp --no-ff vào uat/2026-10-20 trên worktree không có gate đang chạy. Gộp gói có đổi schema thì chạy prisma generate. Gói thêm khoá SystemConfig thì chạy npx jest prisma/reference-data src/modules/system-config.
4) Gate cuối trên tip uat/2026-10-20: tsc 4 app; eslint; lint:vars; lint:parity; migrate deploy, drift, partial index; jest api; race (2–3 luồng); vitest miniapp và web (giờ VN và TZ=UTC); build api, web, miniapp; Playwright Mini App và web trên cổng của mình. Không tin lời subagent: tự chạy lại lệnh kiểm.
5) Lặp: gộp xong một đợt sửa thì chạy lại các ca UAT FAIL và ca liên quan, tới khi PASS.

4. LUẬT CỨNG
- Không push, không mở PR, không merge vào main, không deploy, không SSH VPS, không ghi DB PROD hay DB dùng chung. Chỉ commit cục bộ.
- Không đổi luật kinh doanh đã chốt: 03-cau-hoi-sang mục "Quyết định đã chốt", web-parity Q1–Q8, các quyết định đổi rác.
- Mỗi lần nói "xong" hoặc "xanh" phải kèm output lệnh. Chưa chạy thì ghi "chưa kiểm chứng".
- Máy dùng chung (32 GB, 12 CPU, nhiều phiên): tối đa 1 gate nặng của mình một lúc; load trong uptime trên 40 thì hoãn gate. Chỉ kill PID của mình, kèm cả cây con; không dùng pkill -f. Docker dùng --rm --tmpfs, xoá bằng rm -f -v. Xong việc thì dọn container, cụm Postgres, cổng của mình.
- Không sửa script bash đang chạy.
- Comment chỉ giải thích "vì sao", không kể lại thay đổi. Commit message tiếng Việt như lịch sử repo.

5. BÁO CÁO SÁNG: docs/2026-10-20-uat/99-bao-cao-sang.md
- Kết luận: đã mở cho khách được chưa; nếu chưa, bị chặn bởi gì.
- Bảng UAT PASS/FAIL theo vai trò và hành trình.
- Đã sửa: gói, commit, test chứng minh, số test đầu đêm và cuối đêm.
- Lỗi đã chuyển phiên web và trạng thái từng lỗi.
- Việc chủ phải tự làm trước deploy, xếp theo thứ tự.
- Câu hỏi: mỗi câu 2–4 phương án, có phương án khuyên dùng. Khi tôi vào, hỏi bằng AskUserQuestion; tôi chọn xong thì làm tiếp.
- Kế hoạch gộp: thứ tự gộp uat/2026-10-20 và web/mobile-visual vào main, các file có thể đụng nhau (thử bằng git merge-tree trước).
