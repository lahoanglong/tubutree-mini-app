# Launch review 2026-10-18 — brief chung cho mọi nhánh discovery

## Mục tiêu sản phẩm (lời chủ dự án, 2026-10-17)
Tubu Tree mini-app (Zalo Mini App + web) là kênh bán trực tiếp. Mục tiêu:
1. Giảm phụ thuộc đơn trên sàn (Shopee/Lazada/TikTok Shop…, danh sách kênh ở hello.tubutree.com): kéo khách sàn về mua trực tiếp, có trải nghiệm mua sắm tốt.
2. Đổi rác lấy quà (PHIÊN KHÁC ĐANG LÀM — bỏ qua).
3. Tương tác, giao lưu, xây cộng đồng khách hàng.
4. Đại lý/CTV có kênh bán hàng: gian hàng riêng, listing sản phẩm.
5. Nhân sự hiện nói "chưa hoàn thiện, vẫn phải làm bên ngoài nhiều" → tìm đúng các việc hằng ngày còn phải làm ngoài hệ thống.
Chủ dự án muốn sản phẩm hoàn thiện (tính năng, performance, UI/UX) để chuẩn bị ra mắt. Chưa có khách thật, chưa deploy.

## Phạm vi loại trừ (phiên khác đang làm)
- Đổi rác lấy quà / Refill / Gomdon / Điểm Xanh từ rác: spec `.claude/worktrees/recycle-spec/docs/superpowers/specs/2026-10-17-recycle-rewards-design.md`. Không đề xuất sửa các phần đó.
- Đơn giao ngày cao điểm: thuộc repo khác (chodeli-marketing-support-system), không có ở đây.
- Việc tồn nhỏ của nhánh `nightly/n5-polish` (comment formatSold, GRANT_CONCURRENCY, miniapp-endpoints.json).
- Phần bán trên sàn / social / bán sỉ / cào data: thuộc repo chodeli-marketing-support-system (phiên khác). Ở đây chỉ xét điểm tiếp nối: khách từ sàn/social vào mini-app thế nào.

## Đã biết (đừng báo lại như mới)
- `docs/2026-10-review/` — đợt hardening: `findings-catalog.md` (124 mục, đa số đã sửa), `01-pm.md`, `03-perf.md`, `04-uiux.md`, `99-release-readiness.md`, `00-ROADMAP.md`. Chỉ báo lại một mục cũ nếu kiểm mã thấy nó VẪN còn, và ghi ID cũ.
- `docs/2026-09-08-feature-map.md` (cũ, tự sinh), các spec ở `docs/superpowers/specs/`.

## Môi trường
- Repo gốc: `/Users/longla/coding/tubutree-mini-app` (nhánh main 0cc2fe62). Đọc mã ở worktree `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/launch-review` (cùng cây với main).
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- apps: `api` (NestJS + Prisma), `miniapp` (Zalo Mini App, React), `web` (Next.js: khách, gian hàng `/s/<slug>`, `/admin`, `/merchant`), `e2e` (Playwright).

## Luật cứng
- CHỈ ĐỌC mã. Chỉ được ghi đúng một file báo cáo của nhánh mình trong `docs/2026-10-18-launch-review/`.
- Không push, không deploy, không ghi DB nào, không chạy test suite/Playwright/build (máy 15,5 GB RAM đang có phiên khác chạy test), trừ khi nhánh được cho phép rõ.
- Không `cd` vào worktree khác ngoài launch-review; không git stash/reset/checkout.
- Mọi khẳng định phải có bằng chứng `path:line` hoặc trích dẫn ngắn. Chưa kiểm được thì ghi "chưa kiểm".

## Định dạng báo cáo (tiếng Việt, ≤ 400 dòng)
1. Tóm tắt 10 dòng: mức hoàn thiện nhánh này (ước %), 3 lỗ hổng lớn nhất.
2. Bảng phát hiện: `ID | Mức (P0 chặn ra mắt / P1 nên có trước ra mắt / P2 sau ra mắt / P3) | Vai trò bị ảnh hưởng (khách/đại lý/CSKH/kho/marketing/admin/kế toán) | Hiện trạng + bằng chứng | Đề xuất | Công sức S/M/L | Cần chủ dự án quyết? (Y/N + câu hỏi)`.
3. Đề xuất tính năng mới (nếu có) theo thứ tự giá trị/công sức, nói rõ vì sao giúp mục tiêu 1/3/4/5.
4. Câu hỏi cho chủ dự án (chỉ những câu đổi được quyết định; kèm phương án mặc định bạn khuyên).
Trả về cho điều phối viên: ≤ 20 dòng tóm tắt + đường dẫn file báo cáo.
