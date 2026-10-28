# PROGRESS: review toàn bộ 2026-10-28 (PM + Product Design + Tech Lead)

Worktree `.claude/worktrees/review-1028`, nhánh `review/2026-10-28` từ main `9d0e95bd5`. Bị ngắt thì đọc file này trước.
Giờ lấy bằng `date '+%H:%M'`.

Quyền: tạo worktree/nhánh, sửa mã, test, commit, push nhánh của đợt, mở PR. KHÔNG merge main, deploy, ghi PROD, đẩy Mini App, gộp #39, push --force, --no-verify.
Điểm dừng: (1) sau GĐ2, Artifact + AskUserQuestion cho thay đổi lớn; (2) sau GĐ4, hỏi merge/deploy.

## Mốc

| Giờ | Việc | Kết quả |
|---|---|---|
| 08:09 | GĐ0: worktree + nhánh từ origin/main 9d0e95bd5; `pnpm install` + `prisma generate` xong; chép công cụ chụp của đợt 25/10 vào `tools/` và kiểm kê cũ `01a`–`01d` (để tham khảo, có thể lệch) | xong |
| 08:12 | PROD chỉ đọc `/config/public`: `waste.enabled/dropoff/mailin/pickup` false, `chat.enabled` false, `loyalty.marketplaceClaimEnabled` false, `homeNewCustomerLayout` true, `communityPublicPreview` true. Tức trên PROD khách không thấy đổi rác, chat CSKH, tích điểm đơn sàn dù mã có | ghi nhận |
| 08:11 | GĐ1: workflow đo đạc (9 agent, run `wf_70e578ac-f67`, script `tools/gd1.workflow.js`): hạ tầng lane 5/6, build + bundle, quét tĩnh, bản đồ lối vào, chụp Mini App, chụp web/admin, luồng Mini App, luồng web, hiệu năng chạy thật. Luật chung `tools/gd1-brief.md` | đang chạy |

## Backlog cũ còn mở
B-130 (CI e2e chập chờn), B-147 (nhãn Mới), B-148 (ngày giao dự kiến, việc chủ), B-149 (hai đồng hồ máy chủ), B-150 (chữ quyền lợi hạng), B-151 (múi giờ Mini App), B-152 (thanh toán web 375 lệch), B-153 (gian hàng CTV web thừa chi tiết), B-154 (xem trước mã giảm 50 mã), B-155 (đĩa VPS, việc deploy, chỉ ghi nhận).
