# Luật chung cho agent GĐ1 (review 2026-10-28)

Đọc hết file này trước khi làm. Prompt riêng nói phạm vi; file này nói luật chung.

## Bối cảnh
- Repo Tubu Tree, worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/review-1028`, nhánh `review/2026-10-28` từ main `9d0e95bd5`. Chỉ làm trong worktree này. Đọc `AGENTS.md` ở gốc.
- Thư mục đợt này: `docs/2026-10-28-review/` (gọi tắt `R/`). Ảnh vào `R/screens/` (đã gitignore). Script cần chạy lại phải nằm trong `R/tools/`, không để ở scratchpad.
- Đợt trước (25/10–28/10) đã sửa 10 gói và deploy. Báo cáo cũ: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/ux-review/docs/2026-10-25-ux-review/` (`20-backlog.md`, `10-review-*.md`). Đừng báo lại mục đã xong; nếu thấy mục cũ còn lỗi thì ghi mã cũ (B-xx).
- Sản phẩm: Mini App Zalo (`apps/miniapp`, zmp-ui) là kênh chính; web `apps/web` (Next 15) khổ điện thoại phải giống Mini App cả giao diện; `/admin` trên web. Logic chung ở `packages/app-core`, token ở `packages/design-tokens`.
- Quyết định đã chốt (không đề xuất ngược): Mini App không có cộng đồng đăng bài (chỉ đọc), không link ngoài, không rút tiền về ngân hàng (hoa hồng vào Ví Tubu), thanh đáy: Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân.

## Môi trường (bắt buộc)
- Mọi lệnh shell: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Bộ khung lane: `docs/2026-10-20-uat/tools/uat-harness/README.md` (lane-up, miniapp-session, web-session, personas). Postgres nhúng `docs/2026-10-20-uat/tools/pg-native.sh` cổng 25432.
- Web Next dùng host `localhost`, không dùng `127.0.0.1` (middleware đọc nhãn đầu Host làm subdomain gian hàng).
- Cổng được dùng: lane 5 (3251–3258, Redis db 5) cho chụp ảnh; lane 6 (3261–3268, Redis db 6) cho đi luồng; 3600–3619 cho đo hiệu năng; Postgres 25432, Redis 26379 dùng chung của bộ khung. Không đụng cổng khác.
- CẤM: `pkill -f`; kill tiến trình không do mình tạo (chỉ `lsof -ti tcp:<cổng của mình> -sTCP:LISTEN | xargs kill`); `npx playwright test` trần; Docker không `--rm --tmpfs`; push, merge, deploy, ghi PROD; sửa mã trong `apps/` hay `packages/` (GĐ1 chỉ đo, không sửa sản phẩm); `git stash` trần; commit (người giao việc tự commit).
- PROD chỉ được đọc API công khai (`https://api.tubutree.com/api/config/public`, danh sách sản phẩm) khi cần bằng chứng.
- Test chậm hoặc timeout hàng loạt: chạy `top -l 1 -n 0` trước khi nghi mã. Máy dùng chung với agent khác.

## Ghi kết quả
- Mỗi agent chỉ ghi file được giao. Viết tiếng Việt, câu ngắn, số thật (không ước).
- Mỗi phát hiện ghi: màn (khoá route), khổ/persona, vấn đề, bằng chứng (đường dẫn ảnh tương đối từ `R/` hoặc số đo), file nguồn:dòng nếu biết.
- Không phán khi chưa xem ảnh hoặc đọc mã. Chưa kiểm thì ghi "chưa kiểm".
