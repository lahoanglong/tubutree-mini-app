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
| 08:11 | GĐ1: workflow đo đạc (9 agent, run `wf_70e578ac-f67`, script `tools/gd1.workflow.js`): hạ tầng lane 5/6, build + bundle, quét tĩnh, bản đồ lối vào, chụp Mini App, chụp web/admin, luồng Mini App, luồng web, hiệu năng chạy thật. Luật chung `tools/gd1-brief.md` | xong 09:38 |
| 09:38 | GĐ1 xong 9/9. Lane 5, 6 chạy (Postgres 25432, Redis container `tubu-uat-redis`; 236 migration). Chụp: Mini App 310 ô/492 ảnh, web+admin 420 ô/778 ảnh, 54 cặp 375. Luồng: Mini App và web đi hết 6 luồng. Bundle Mini App entry 711 KB raw/222 gzip (vượt mục tiêu 450 KB); web First Load `/` 204 KB. Runtime: CLS trang chủ Mini App 0,46 (guest 0,83), web 0,42, thanh toán web 0,31; LCP danh sách/chi tiết web Lighthouse 4,4–4,5 s; `/home/me` 26 SQL, `/cart` 22. Web chỉ có error.tsx gốc, không loading.tsx. Báo cáo `01-chup-*.md`, `03-perf-*.md`, `04-quet-tinh.md`, `05-loi-vao-va-mau.md`, `06-luong-*.md`; commit 8520fccff | xong |
| 09:39 | Tôi xem cặp ảnh trang chủ và chi tiết SP: trang chủ khách quay lại không có SP nào ở màn đầu, bong bóng "Trồng cây mỗi ngày" che nội dung, web thiếu ô "Tích điểm đơn sàn"; chi tiết SP phân loại nằm dưới màn đầu, web có dải mã giảm còn Mini App không | |
| 09:40 | GĐ1b: 8 nhóm chấm (Opus) KP, MH, DH, DX, DR, CT, QT, TL + 1 tổng hợp nháp (run `wf_e5bb11ac-502`, script `tools/gd1b.workflow.js`, brief `tools/gd1b-review-brief.md`) | xong 10:25 |
| 10:25 | GĐ2 nháp xong: `10-review-{KP,MH,DH,DX,DR,CT,QT,TL}.md`, `10-findings.md`, `20-backlog.md` (155 mục: P0 1, P1 12, P2 73, P3 69; 8 gói; 32 mục để sau). Tôi kiểm tay R-6 (`product-detail.tsx:312` thêm luôn phân loại chọn sẵn), R-13 (`ops-inbox.service.ts:82-141` không có hàng đợi chuyển khoản/gian hàng), R-10 (toast ghép seedsEarned + bonusNote): đúng. Commit fa508007e | xong |
| 10:40 | Đợt A GĐ3: 5 gói không chờ chủ (doirac lane 1, taikhoan lane 3, diemxanh lane 4, ctv lane 7, quantri lane 8), worktree `r1028-<gói>`, nhánh `review/1028-<gói>` từ 1384ff380 (thêm `tools/before-after.mjs`, `tools/gd3-worker-brief.md`). Workflow `wf_aee2a918-6a9` (`tools/gd3a.workflow.js`): worker Sonnet làm → reviewer Opus. Tôi tự quyết các mục chờ chủ trong 5 gói: R-12 chỉ hiển thị (không tự chuyển Ví), R-37 chỉ bỏ nút trùng, R-42 chỉ dòng giữ hạng, R-63 chỉ điền sẵn tên/SĐT, R-67 link Mini App trong Mini App, R-68 đếm tài khoản thật, R-74 trang Hôm nay bản gọn | đang chạy |
| 10:32 | ĐIỂM DỪNG 1: báo cáo GĐ2 https://claude.ai/artifact/CrDKFZbeRN4CJnDWUhdUwm (mẫu `report/gd2.template.html`); hỏi chủ 4 câu: trang chủ, phân loại, luật ưu đãi, đổi cỡ ảnh | chờ chủ |

## Backlog cũ còn mở
B-130 (CI e2e chập chờn), B-147 (nhãn Mới), B-148 (ngày giao dự kiến, việc chủ), B-149 (hai đồng hồ máy chủ), B-150 (chữ quyền lợi hạng), B-151 (múi giờ Mini App), B-152 (thanh toán web 375 lệch), B-153 (gian hàng CTV web thừa chi tiết), B-154 (xem trước mã giảm 50 mã), B-155 (đĩa VPS, việc deploy, chỉ ghi nhận).
