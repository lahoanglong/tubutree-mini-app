# UAT xuyên đêm 04/11: luật cho agent chạy lane và agent kiểm lại

## Mục tiêu
Đi thật các hành trình người dùng trên đúng mã đang chạy PROD, tìm lỗi trước khi mở khách. Mã kiểm: worktree
`/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104` (detached, SHA ghi ở `SHA.txt` cùng thư mục với file này; trùng SHA PROD Vietnix).
Ba khổ: Mini App 375×812, web 375×812, web 1280×800. Web 375 phải giống Mini cả chữ lẫn bố cục; 1280 mở rộng hợp lý.

## Cấm
- Sửa mã ứng dụng, sửa file đã commit trong worktree `uat-1104`. Chỉ tạo file trong thư mục lane của mình ở `OUT` (bên dưới).
- Push, PR, merge, deploy, đọc hay ghi PROD, gọi api.tubutree.com hay app.tubutree.com.
- `pkill -f`; kill tiến trình không do mình tạo (chỉ `lsof -ti tcp:<cổng lane mình> -sTCP:LISTEN | xargs kill`); Docker không `--rm --tmpfs`; dừng Postgres 25432 hay Redis 26379; `git stash` trần.
- Đụng lane khác: lane 2, 7, 8, 9 cấm hẳn (phiên khác); lane của agent khác cũng không đụng.
- `npx playwright test` trần trong `apps/e2e` (dùng script riêng của lane bằng Playwright thư viện, một trình duyệt mỗi lúc).

## Môi trường
- Mọi lệnh: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, chạy từ gốc worktree `uat-1104`.
- `H=docs/2026-10-20-uat/tools/uat-harness`, `R=docs/2026-10-28-review`. Đọc `$H/README.md` và `$R/tools/LANES.md` (thay lane 5/6 bằng lane của mình).
- Bài học môi trường: `/Users/longla/.claude/projects/-Users-longla-coding-tubutree-mini-app/memory/env-lessons-tubutree.md`. Web dùng `localhost`, không `127.0.0.1`.
- Máy 12 lõi dùng chung với phiên khác. Timeout hàng loạt thì `top -l 1 -n 0` trước khi nghi mã; chạy lại riêng ca đó.

## Bật lane N (đúng thứ tự)
```
cd /Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104
$H/lane-down.sh N
node $H/lane-db.mjs create N --fresh
$H/lane-up.sh N --web            # lần đầu sinh state/lane-N/lane.env; API lúc này chạy trên DB thiếu migration
( cd apps/api && DATABASE_URL=$(grep ^DATABASE_URL= ../../$H/state/lane-N/lane.env | cut -d= -f2-) npx prisma migrate deploy )
$H/lane-down.sh N && $H/lane-up.sh N --web
node $R/tools/seed-data.mjs --lane N all
```
Kiểm: số dòng `_prisma_migrations` đã xong bằng số thư mục `apps/api/prisma/migrations/*/`. API dist đã build ở đúng SHA (phiên điều phối build sẵn).
Cuối việc: `$H/lane-down.sh N` (không `--drop`).

## Persona và công cụ
`returning`, `new`, `new_nophone`, `guest`, `ctv`, `ctv_pending`, `dealer`, `staff`, `kho`, `ketoan`, `marketing`, `cskh`, `brand`, `admin` (chi tiết `$H/personas.json`).
Mini: `node $H/miniapp-session.mjs N <persona> --path <route>`; web: `node $H/web-session.mjs N <persona> --w 375|1280 --path <route>`.
Token: `node $H/mint-token.mjs N <persona>`; SQL: `node $H/db.mjs N "<SQL>"`; job: `node $H/run-job.mjs N <job>`;
webhook: `$H/pancake-webhook.mjs`, `$H/bank-webhook.mjs`. Viết ca thành script Node/Playwright chạy lại được trong thư mục lane.

## Luật đã chốt (kỳ vọng). Không tự suy luật mới; mơ hồ thì ghi "CẦN CHỦ", không tính FAIL
Đọc `AGENTS.md` và các luật trong `packages/app-core/src` (giá, điểm, phí) + `SystemConfig` mặc định trong DB lane. Lời API bằng tiếng Việt, giọng đợt 8:
không "Vui lòng", không "chúng tôi", không "...", lỗi chung "Đã có lỗi xảy ra. Bạn thử lại nhé.". Mini: cộng đồng chỉ đọc, không link ra ngoài, không rút tiền về ngân hàng, thanh đáy 5 tab.

## Ghi kết quả
`OUT=/Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat`. Lane ghi `OUT/<khoá lane>.md`, ảnh `OUT/shots/<khoá lane>/`, script `OUT/scripts/<khoá lane>/`.
Bảng mỗi ca: ID | Persona | Khổ | Hành trình | Bước | Kỳ vọng (nguồn luật: file:dòng hoặc khoá SystemConfig) | Thực tế | Bằng chứng (ảnh, response rút gọn, SQL + kết quả) | PASS/FAIL/BLOCKED.
Ca tiền/điểm/ví/hoa hồng PHẢI có SQL đối chiếu sổ và số dư, không chỉ nhìn màn hình. Cuối lane chạy `apps/api/scripts/reconcile-points.ts` và `reconcile-wallet.ts` trên DB lane nếu chạy được.
Mục "Lỗi" sau bảng: ID `<lane>-Bxx`, mức P0 (mất tiền/điểm, lộ dữ liệu, chặn mua) / P1 (sai luật, hành trình chính hỏng) / P2 (lệch parity rõ, chữ sai, trạng thái lỗi/trống thiếu) / P3,
path:line nghi ngờ, các bước tái hiện, script tái hiện, ảnh. Lỗi do bộ khung giả ghi riêng mục "Hạn chế bộ khung", không tính FAIL. Thiếu tích hợp ngoài thì BLOCKED kèm lý do.
