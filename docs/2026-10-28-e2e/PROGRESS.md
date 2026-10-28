# PROGRESS: review end-to-end xuyên chức năng 2026-10-28 (đêm, phiên tubutree-mini-app-f3)

Worktree `.claude/worktrees/e2e`, nhánh `review/e2e-2026-10-28` = main f4ec472d7 (đã gồm #59–#67; lúc đầu là d96c5b7b3 + gộp 6 nhánh, cây như nhau). Bị ngắt thì đọc file này trước. Giờ lấy bằng `date '+%H:%M'`.

## Chủ giao (22:00, rồi đi ngủ, không trả lời được tới sáng)
Cài ECC (affaan-m/ECC) và dùng để review toàn dự án theo hành trình end-to-end, hoàn thiện chức năng ở chuẩn cao nhất: liền mạch, logic, dễ hiểu, giúp người dùng làm nhanh hơn.

Chủ chốt (AskUserQuestion 22:0x):
- ECC: plugin `ecc@ecc` toàn máy, hook profile standard (đã cài 22:01, bản 2.2.3, `~/.claude/plugins/cache/ecc/ecc/2.2.3`). Phiên này không nạp được skill mới, nên agent đọc file agent/skill ECC theo đường dẫn.
- Bản gốc: main + #62–#67.
- Quyền: push nhánh của đợt, mở PR, MERGE vào main khi gate + Playwright xanh + reviewer Opus không P1/P2, và chỉ sau khi phiên `tubutree-mini-app-93` báo merge #62–#67 + deploy Vietnix xong. KHÔNG deploy, ghi PROD, đẩy Mini App, gộp #39, push --force, --no-verify.
- Việc "cần chủ quyết": tự chọn phương án an toàn, đảo ngược được, ghi lý do. KHÔNG đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD: ghi danh sách cho sáng.
- Cách chạy: Workflow, không giới hạn số agent.
- Phạm vi sửa: mục mới P0–P3; 32 mục P3 "Sau" của đợt 28/10 (trừ R-86, R-116, R-160 chờ chủ); R-132 bỏ trang Xếp hạng web cho giống Mini.
- Không điểm dừng giữa chừng: tự làm hết, báo cuối (Artifact).

## Phân vùng với phiên tubutree-mini-app-93 (đang merge #62–#67 + deploy)
Nó giữ: lane 5 (API 3251, fake-pancake 3258, DB `tubutree_uat_l5`), Redis 26379 db 0, web 3601, perf 3603/3611, cổng gate 3710–3799.
Tôi được dùng: cụm Postgres 127.0.0.1:25432 với DB tên `tubutree_e2e_<gói>`, cổng 3800–3899, API từ 3261, Redis 26379 db index ≠ 0. Kiểm `lsof -iTCP:<p> -sTCP:LISTEN` trước khi dùng. Không dừng cụm 25432 hay Redis 26379.

## Mốc
| Giờ | Việc | Kết quả |
|---|---|---|
| 22:01 | Cài ECC plugin user scope, hook standard | xong |
| 22:05 | Worktree e2e = main d96c5b7b3 + muahang, taikhoan, diemxanh, ctv, quantri, hieunang (không xung đột; khác integ chỉ test bank-transfer-panel) | xong |
| 22:10 | Chủ trả lời 4 câu (trên), đi ngủ | |
| 22:12 | Phiên 93 đồng ý cho dùng lane 6, 7, 8 của uat-harness (`lane-up.sh N --fresh` trên tubutree_uat_l6..l8); nó chỉ giữ lane 5 | |
| 22:08 | Workflow review `wf_031b8445-6c0` (8 nhóm hành trình Opus → phản biện → gộp backlog + chia gói), brief `tools/brief-review.md`. Báo cáo nhóm `11-*.md`..`18-*.md`, gộp `20-backlog.md`, `21-quyet-dinh.md`, `goi/<gói>.md` | đang chạy |

## Kế hoạch đợt sửa
- Script `tools/fix.workflow.js` (gọi bằng scriptPath, args `{base, packages:[{key,title,brief_file,money,migration,depends_on,slot}]}`), brief `tools/brief-worker.md`.
- Mỗi gói: worktree `.claude/worktrees/e2e-<gói>`, nhánh `review/e2e-<gói>` từ `review/e2e-2026-10-28`. Khối cổng B = 3800 + 5*slot (B+1..B+5), cổng race 45800 + 10*slot (`race-one.sh`).
- Sau workflow: gộp các gói vào worktree tích hợp, chạy gate.sh + pw-gate + race trên bản gộp, chụp ảnh trên lane 6 so với ảnh trước, review Opus bản gộp, push, PR; merge chỉ sau khi phiên 93 báo deploy xong.
| 22:21 | Phiên 93 báo: merge #59–#67 xong 22:14, deploy Vietnix xong 22:19 (PROD 239 migration), Mini App Testing V26 từ f4ec472d7. Cây main f4ec472d7 trùng khít bản gốc của tôi; dời nhánh `review/e2e-2026-10-28` về f4ec472d7 (`reset --keep`, không đổi file). Từ giờ được merge PR của đợt khi đủ điều kiện | xong |
| 22:48 | Phiên 93 mở PR #69 (review/1028-chip-e2e, sửa test chip 44px ở shop.web.spec.ts:652, chờ chủ duyệt). Main còn 2 ca đỏ đó + ~10 ca chập chờn /san-pham (B-130): ghi vào brief worker là đỏ sẵn. Không gộp #69 vào nhánh của đợt (để chủ duyệt) | |
| 23:24 | Review xong (`wf_031b8445-6c0`, 17 agent, 76 phút): giữ 94 phát hiện, bác 4. Gộp 144 dòng backlog (E-1..E-128, gồm 41 mã R cũ): P1 2, P2 28, P3 98. 16 gói / 120 mục. Chủ quyết thay (an toàn) 21 mục, để chủ 6 mục + việc PROD ở `21-quyet-dinh.md`. P1: E-1 đơn đại lý chuyển khoản không có thẻ việc, tự huỷ 72 giờ (gói admin-hopviec); E-2 khách vãng lai nhận điểm danh/thưởng 7 ngày (luật điểm, để chủ) | xong |
| 23:26 | Commit tài liệu 376ad7055 trên `review/e2e-2026-10-28`. Dựng 16 worktree `e2e-<gói>` (`tools/mk-worktrees.sh`), cài offline, prisma generate, build shared-types: 16/16 OK | xong |
| 23:28 | Workflow sửa `wf_26819fa2-c87` (`tools/fix.workflow.js`, args `tools/fix-args.json`): 16 gói, worker Sonnet → review Opus bằng agent ECC (ecc:code-reviewer; lượt 2 ecc:security-reviewer cho gói tiền, ecc:react-reviewer cho gói khác). Mốc migration: doirac 20261029010000, admin-hopviec 020000, admin-nhansu 030000. Phụ thuộc: canhan sau thongbao; admin-don sau admin-hopviec + api-tin; admin-nhansu sau admin-hopviec | đang chạy |
| 04:00 | Workflow sửa xong (66 agent, 4,5 giờ, 0 lỗi): 16/16 gói mergeable, gate 0 FAIL ở mỗi gói; review cuối mỗi gói không còn P1/P2 (chỉ P3). Mục: 129 done, 4 partial (canhan 1, ctv 1, doirac 2) | xong |
| 04:01 | Gộp 16 nhánh vào `review/e2e-2026-10-28` theo thứ tự phụ thuộc (api-tin, admin-hopviec, admin-don, admin-nhansu, thongbao, canhan, giohang, muachung, diem, ctv, doirac, phien, hotro, admin-congcu, dondep, giaodien). Một xung đột tài liệu ở runbook (giữ cả hai mục, đánh số 1.11 lệch sổ, 1.12 route điểm danh cũ). Tip b0c63d6bd. 4 migration: 20261029010000, 020000, 030000, 030100 | xong |
| 04:02 | Kiểm bản gộp: gate.sh (base f4ec472d7), race đủ 304 spec chia 4 mảnh cổng 45800–45830 | đang chạy |
| 04:08 | Bản gộp: gate.sh 0 FAIL (vitest app-core 1244, miniapp 5223 ×2, web 7956; jest API 503 suite/11687; bundle entry 706/220 không đổi, tổng 1981/765 KB so main ~1946/751). Race đủ 304 suite: lượt đầu 302/304 (EXPLAIN đếm mã thu hoạch chọn index khác khi DB dùng chung; brand-owner-sales quá 60 s lúc máy tải ~29, chạy riêng xanh, spec không đổi từ main). Sửa test EXPLAIN (09c13c5e9: thêm 2000 mã + ANALYZE trong tx rollback), chạy lại mảnh 2: 76/76 suite, 553/553. Lane 6 dựng bằng mã gộp (`lane-db create 6 --fresh`, migrate, `lane-up 6 --web`, seed, đặt `waste.rules_text` thử cho lane để bật cờ), đang chụp mini375/web375/admin1280. Opus review rủi ro gộp đang chạy | |
| 04:19 | Playwright bản gộp (pw-gate B=3800): Mini 215 qua/10 bỏ qua, web 368 qua/51 bỏ qua, 0 đỏ. Opus review rủi ro gộp: merge được, 1 P2 tài liệu (quay image tách tài khoản khách vì khoá băm) + 4 P3. Đã sửa: nối báo kế toán khi trả một phần đơn có hoa hồng đã duyệt/vào Ví (f700c6c36, unit + 44 race spec trả hàng xanh, jest orders/returns/affiliate 1178/1178), runbook mục 1.13 + dòng cảnh báo ở 7.2 (586102b8b). Chụp lane 6: mini375 150 ô, web375 154, admin1280 43; chỉ lỗi trang /gioi-thieu hydration ở chân trang (Kho quà/Đổi rác) do trang ISR dựng lúc cờ đổi rác còn tắt, có từ trước (chân trang không đổi trong đợt). Opus đang xem ảnh trước/sau | |
| 04:20 | PR #70 mở (`review/e2e-2026-10-28` → main). Opus xem ảnh trước/sau: không P1; sửa "Chọn mã" gãy dòng + dải Quà khách mới cắt điều kiện (0540e7e84); hydration /gioi-thieu do đầu/chân trang đọc cờ Đổi rác trước khi hydrate (af59db28c, kiểm bằng trình duyệt: hết lỗi, link Đổi rác vẫn hiện sau hydrate). Lane web chạy từ bản sao: đổi mã web phải rsync hoặc bật lại lane | xong |
| 04:42 | Tip af59db28c ở máy: gate 0 FAIL (jest 503/11688), Playwright Mini 215 + web 368, 0 đỏ. CI lượt 2 race phần 2 đỏ 1 ca chập chờn có từ main (6 admin sửa bậc, hạn mức thử trùng giá trị đang lưu nên lượt không đổi gì cũng thành công): sửa test 08855667a, chạy 3 lần xanh. Chờ CI lượt 3 rồi merge | |
| 05:19 | CI lượt 3 đỏ 2 job, đều sửa: `verify` chạy múi giờ UTC lộ lỗi thật ở panel thẻ hộp hàng sàn (ngày ghép không kèm múi giờ, máy admin khác giờ VN lệch 7 tiếng; 5d9ad80bd, ghép +07:00); `test` đo vị trí minh hoạ giỏ trống giữa lúc chạy hiệu ứng (16c3bfec0, tắt chuyển động trong spec). Opus xem các sửa sau gộp: merge được, 1 P2 cùng lỗi múi giờ ở tab Mã giảm giá + Khuyến mãi quản trị, vài P3. Sửa hết ở 4bb3e20b0: +07:00 + test (gỡ +07:00 thì test đỏ ở TZ=UTC; admin 264/264 xanh ở UTC); mã giảm giá dài tới 40 ký tự cắt "…" ở Giỏ/Thanh toán Mini + web (kiểm ảnh 375px trên lane 6 với mã 40 ký tự, rồi gỡ mã khỏi giỏ lane); race: mock báo kế toán cho spec ký gửi, ANALYZE lại coupons sau rollback (race 3 + 3 spec coupon xanh). Lint, tsc xanh. Chờ CI lượt 4 rồi merge | |
