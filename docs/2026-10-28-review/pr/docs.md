TITLE: docs(review-1028): review toàn bộ Tubu Tree 28/10, backlog R-1..R-177 và công cụ kiểm

## Vấn đề
Trước khi mở cho khách, cần một lượt review toàn bộ Mini App, web (375/768/1280) và admin. Lượt này xét ba mặt: chức năng, giao diện và hiệu năng. Sau review, sửa theo gói và đo trước/sau. PR này chỉ có tài liệu và công cụ, không đổi mã app.

## Có gì trong PR
- `docs/2026-10-28-review/01*–06*`: kiểm kê màn, cờ và cấu hình, lối vào, sáu luồng chính trên hai nền, quét tĩnh, hiệu năng build và runtime.
- `10-findings.md`, `10-review-*.md`: chấm 1–5 theo màn (Rõ, Dễ, Đẹp, Nhanh, Bền) và review của 8 nhóm.
- `20-backlog.md`: 155 mục R-1..R-155 chia 8 gói, thứ tự gộp, mục cần chủ quyết. Thêm phần "Sau đợt 28/10": trạng thái từng mục sau khi sửa, mục mới R-156..R-177, điều chủ cần biết.
- `reviews/`: báo cáo từng đợt (A–D) và review Opus của từng gói.
- `PROGRESS.md`: nhật ký theo giờ.
- `pr/`: mô tả 8 PR gói.
- `tools/`: công cụ chạy lại được.
  - `capture.mjs`: chụp ảnh theo ma trận màn, persona và trạng thái.
  - `perf/run-all.mjs`: Lighthouse, web vitals, Mini App, đếm SQL, tải API.
  - `perf/bundle-report.mjs` và `perf/chunk-diff.mjs`: so gói Mini App theo chunk.
  - `perf/home-probe.mjs`: in từng lần nhảy bố cục và ứng viên LCP của Trang chủ, cho khách mới, khách quay lại trên máy mới hoặc máy quen.
  - `gate.sh`: tsc, eslint, vitest, jest, lint:parity, vite build, bundle.
  - `pw-gate.sh`: Playwright Mini App và web gate.
  - Script workflow của từng đợt.
- `perf/baseline.json`: số đo gốc ở main `9d0e95bd5`. `perf/after-integ.json`: bản gộp 8 nhánh (web, Lighthouse, Mini App). `perf/after-hieunang-api.json`: đếm SQL của nhánh hieunang.

Ảnh chụp (`screens*/`, khoảng 220 MB) không vào repo (đã thêm vào `.gitignore`). Ảnh chọn lọc nằm ở báo cáo: https://claude.ai/artifact/BAptEQ6qkPB2iABaL2byxi (bản riêng tư, chủ chia sẻ để người khác xem)

## Thứ tự merge
PR này merge trước. Tám nhánh gói tách từ commit `1384ff380` của nhánh này, nên trước khi PR này vào main, diff của từng PR gói sẽ có thêm `docs/2026-10-28-review/`.

Sau đó merge theo thứ tự: 1 doirac → 2 khampha → 3 muahang → 4 taikhoan → 5 diemxanh → 6 ctv → 7 quantri → 8 hieunang.

## Cách kiểm
- Đọc `20-backlog.md` mục "Sau đợt 28/10" để biết mục nào xong, mục nào còn.
- Chạy lại cổng cho một nhánh: `docs/2026-10-28-review/tools/gate.sh <worktree>` và `docs/2026-10-28-review/tools/pw-gate.sh <worktree> <cổng gốc>`.

## Deploy và migration
Không có.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
