# Brief chung cho mọi agent phiên UAT 2026-10-20

Đọc hết file này trước khi làm. Prompt gốc của chủ dự án: `docs/2026-10-20-uat/PROMPT.md`.

## Bối cảnh

- Tubu Tree: cửa hàng Zalo Mini App + web (Next) + API NestJS + Postgres + Redis. Sắp mở cho khách thật. Chưa deploy.
- Worktree tích hợp: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat`, nhánh `uat/2026-10-20`, nền `05e6ae97` (origin/main, đã có PR #20–#23).
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- `npx prisma generate` chạy trong `apps/api`, không ở gốc. tsx không tự nạp `.env`: truyền `DATABASE_URL` khi chạy script.
- macOS không có `timeout`. Không dùng `pkill -f`. Chỉ kill PID mình tạo, kèm cây con (`pgrep -P`).

## Luật cứng

- Không push, không mở PR, không merge vào main, không deploy, không SSH, không ghi DB PROD hay DB dùng chung (`tubu_pg` cổng 5434, `tubu_redis` 6381, `tubu_it_main` 5550). Chỉ commit cục bộ khi được giao sửa.
- Agent discovery/review: KHÔNG sửa mã nguồn. Chỉ ghi báo cáo được giao.
- Không đổi luật kinh doanh đã chốt (mục dưới). Thấy luật có vẻ sai thì ghi "cần chủ quyết", không coi là lỗi để sửa.
- Không sửa, không chạy lệnh trong worktree khác (`web-*`, `launch-review`, `recycle-*`). Không đụng cổng của phiên web: 3121–3123, 3131–3163, 5199, 15432+, 16379+.
- Vùng file của phiên web (KHÔNG sửa, chỉ báo lỗi): `apps/web/src/**` trừ `apps/web/src/app/admin/**`; `apps/e2e/tests/support/{visual,tour,tour-*}.ts`; `apps/e2e/tests/visual-tour.*.spec.ts`; `apps/e2e/scripts/visual-pairs.mjs`; `docs/2026-10-19-web-parity/**`.
- Cần hỏi trước khi sửa: `apps/e2e/tests/support/mock-api.ts`, `apps/e2e/playwright.config.ts`, `packages/app-core/**`, spec e2e web.
- Máy dùng chung (12 CPU, nhiều phiên). Không chạy `jest` toàn bộ, race toàn bộ, Playwright toàn bộ, `next build`, `docker build` trừ khi nhiệm vụ ghi rõ. Chạy test lẻ theo file thì được (`npx jest path/to/x.spec.ts`). Trước lệnh nặng xem `uptime`; load > 40 thì chờ.
- Docker: `docker run --rm --tmpfs ...`, xoá bằng `docker rm -f -v`. Xong việc dọn container, cụm Postgres, tiến trình của mình.
- Comment trong mã chỉ giải thích "vì sao". Commit message tiếng Việt.
- Không bịa. Mọi kết luận phải có `path:line` hoặc output lệnh. Chưa chạy được thì ghi "chưa kiểm chứng".

## Hạ tầng của phiên UAT

- Postgres 16 chạy thẳng (không Docker): `docs/2026-10-20-uat/tools/pg-native.sh start|stop|createdb <port> [db]`. Cụm 25432 có DB `tubutree_uat` (đã migrate + `seed.ts` + `seed-reference.ts --with-business-defaults`). User `tubu`, không mật khẩu, `127.0.0.1` (không `localhost`).
- Redis: container `tubu-uat-redis` cổng 26379 (db 0 cho API UAT chính; lane khác dùng db 1–9).
- Cổng dành cho phiên UAT: API 3221, web 3222, miniapp 3223; lane UAT dùng 3231–3299; Postgres tạm 25433–25499 và 25541–25599 (race; phiên web không dùng 255xx).
- `apps/api/.env` của worktree trỏ `tubutree_uat` @25432, Redis 26379/0, `PORT=3221`.
- Playwright Mini App chỉ chạy với `E2E_SCOPE=miniapp`. `npx playwright test` trần tự bật API + web theo `apps/api/.env`.
- Web (Next) dùng host `localhost`, không `127.0.0.1` (middleware đọc subdomain gian hàng).
- Test giờ: máy là giờ VN, CI là UTC. Test ngày giờ chạy thêm `TZ=UTC`.

## Quyết định kinh doanh đã chốt (không đổi)

Nguồn đầy đủ: `docs/2026-10-18-launch-review/03-cau-hoi-sang.md` mục "Quyết định đã chốt"; `docs/2026-10-19-web-parity/PROMPT.md` Q1–Q8; `docs/launch/recycle-rewards-launch-checklist.md`. Tóm tắt:

- Hoa hồng 8% mọi SP; chỉ CTV và đại lý hưởng; không trả hoa hồng CTV cho hàng gian hàng đối tác; giữ hoa hồng 10 ngày sau giao; CTV bị hạ vai trò vẫn nhận hoa hồng đơn đặt trước đó; trừ TNCN 10% mọi vai trò.
- Giữ 3 mã WELCOME30, FREESHIP, XANH10; khách mới được giảm 2 lần là chấp nhận. Thẻ hộp hàng sàn: giảm 30.000đ, đơn từ 199.000đ, hạn 60 ngày, chỉ khách mới, mỗi thẻ một mã. Freeship đơn đầu bật, đơn từ 199.000đ.
- Tài khoản nhận chuyển khoản: CONG TY TNHH TUBU TREE, 8386790906, Techcombank.
- Điểm Xanh: 1 điểm = 1đ. Đơn app 2% tiền hàng sau giảm (không tính ship) × hệ số hạng (Mầm Xanh ×1, Lộc Biếc ×1,2, Đại Thụ ×1,5, Cổ Thụ ×2). Đơn sàn 1%, không nhân hệ số, không tính hạng, quét/nhập mã vận đơn khớp đơn Pancake, mỗi mã một lần, chờ giao xong + 14 ngày, đơn hoàn thì huỷ. Đơn CSKH lên trên Pancake (B9): tự cộng theo SĐT, tỉ lệ như đơn app, chờ giao + 14 ngày, báo qua OA; SĐT chưa vào Mini App thì giữ 30 ngày. Mọi số điểm khác ×1.000 (điểm danh, vòng quay, quà đổi điểm, đổi rác, thưởng cộng đồng, ngưỡng hạng). Tối đa 20% giá trị đơn trừ bằng điểm. Điểm hết hạn sau 12 tháng. Có trần điểm (đợt hardening, xem `findings-catalog.md`).
- Kế toán: bấm "Đã chi" rút tiền, công nợ đại lý, "Đã nhận tiền" đơn chuyển khoản, hoá đơn VAT, chi thưởng đại lý, duyệt hoàn tiền mua trên sàn, có tab Đơn hàng. Duyệt rút tiền chỉ ADMIN. CSKH duyệt bài cộng đồng; chỉ ADMIN ghim và chọn người thắng.
- Trần mã do nhân viên tạo: 30% / 100.000đ mỗi đơn, 10 triệu/ngày/người, 1.000 lượt mỗi mã.
- Gian hàng CTV phải duyệt lần đầu (`storefront.require_approval` bật). Subdomain gian hàng tắt tới khi có DNS wildcard.
- Đổi rác: hộp sữa và vỏ chai Tubu chỉ kho HCMC nhận; đại lý chỉ nhận carton và nilon. Hai kênh: thu kèm đơn, gửi kiện (MAIL_IN). Giữ chữ "khoảng ngày".
- Web (Q2): không xác minh SĐT trên web; tính năng cần SĐT đã xác minh (quét mã đơn sàn, cộng điểm theo SĐT) chỉ ở Mini App. Q3: web và Mini App chung Zalo App ID. Q4: web chỉ chuyển khoản QR + COD. Q5: màn nội bộ có trên web, kiểm quyền như Mini App.
- Thuật ngữ: "Điểm Xanh" (không dùng "xu"). Tên ô giữa thanh tab "Vườn Xanh".

## Không báo lại mục đã sửa

Trước khi ghi một phát hiện, tra `docs/2026-10-review/findings-catalog.md` và `docs/2026-10-18-launch-review/02-tong-hop-va-ke-hoach.md` (+ `impl/*.md`). Đã sửa thì bỏ. Đã biết nhưng còn mở thì ghi ID cũ và trạng thái hiện tại kèm bằng chứng.

## Định dạng phát hiện

Mỗi phát hiện một dòng bảng hoặc một mục:
- ID (`<nhánh>-<số>`), mức: P0 (chặn mở khách: mất tiền/điểm, lộ dữ liệu, chặn mua, sai luật đã chốt), P1 (sai nghiệp vụ hoặc UX nặng, nên sửa trước mở), P2 (nên sửa tuần đầu), P3 (đẹp hơn).
- Nhóm: "agent sửa ngay" / "cần chủ quyết" / "chủ tự làm".
- `path:line`, mô tả ngắn, kịch bản lỗi cụ thể (đầu vào → kết quả sai), bằng chứng (đoạn mã, output lệnh, truy vấn DB, ảnh), đề xuất sửa + test nên viết.
- Vùng file: ghi rõ file thuộc vùng phiên UAT hay phiên web.

## Quyết định mới của chủ (sáng 2026-10-20)

Chủ đã trả lời Q1, Q2, Q5, Q8, Q10, Q12–Q16, Q18–Q20, Q22–Q24. Bảng ở `98-cau-hoi.md`, mục "Chủ trả lời sáng 2026-10-20". Các quyết định này là luật mới, thay luật cũ ở đúng mục đó. Reviewer không coi việc làm theo chúng là đổi luật đã chốt.
