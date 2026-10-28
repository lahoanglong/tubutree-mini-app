# Đợt P3 sau review end-to-end (2026-10-29)

Chủ nhắn sáng 29/10: "continue làm tiếp cho xong", sau khi PR #70 (đợt end-to-end 28/10) đã merge vào main 6f5897078. Đợt này sửa phần còn lại của đợt đó, cùng quyền và luật của đợt 28/10 (xem `docs/2026-10-28-e2e/PROGRESS.md`). KHÔNG deploy, ghi PROD, đẩy Mini App, gộp #39, push --force, --no-verify. KHÔNG đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD.

## Phạm vi
- 135 P3 mà reviewer Opus nêu ở 16 gói đợt 28/10 (gồm cả mục đã sửa ở lượt sau: worker kiểm lại từng mục).
- 4 mục làm dở (canhan 1, ctv 1, doirac 2).
- 6 mục "Còn lại" trong báo cáo cuối: tiêu đề đổi rác web khách, báo kế toán khi dòng trả không có hoa hồng, Mini 429 báo "Mất kết nối", menu admin sáng hai chỗ, "7 ngày: N khách mới" màu đỏ, chữ "không tìm thấy" hai nền.
- Chủ chốt 06:5x (`docs/2026-10-28-e2e/21-quyet-dinh.md` mục D): E-2 chặn điểm khách vãng lai (gói `e2-diem-khach`); E-43 trừ thẳng Ví CTV, Ví được âm chỉ với dòng thu hồi (gói `e43-vi-ctv`, migration `20261029040000`); deploy main lên Vietnix sau khi PR đợt P3 merge (không đẩy Mini App); giữ link mạng xã hội Cộng đồng web cả hai khổ.
- Không làm: các mục chờ chủ còn lại ở mục B của file quyết định.

## Cách chạy
- Nhánh gộp `review/e2e-p3-2026-10-29` từ main 815fa3c1e (đã gồm #69). Worktree `.claude/worktrees/e2e`.
- 8 gói (`goi/<gói>.md`, `tools/groups.json`): muahang, tin-canhan, api-hotro, diem-doirac, ctv, phien, admin, giaodien-quantri. Worktree `.claude/worktrees/p3-<gói>`, nhánh `review/p3-<gói>`.
- Workflow `tools/fix.workflow.js` (args `tools/fix-args.json`): worker Sonnet, review Opus bằng agent ECC, gói tiền/điểm/phiên ít nhất 2 lượt review.
- Cổng: khối B = 3800 + 5*slot, race 45800 + 10*slot. Phiên 93 giữ lane 5, cổng 3791–3795, và đang sửa `support-chat.web.spec.ts`, `buy-flow-4b-browse.miniapp.spec.ts` (không đụng).

## Mốc
| Giờ | Việc | Kết quả |
|---|---|---|
| 05:41 | PR #70 merge (6f5897078). Dọn 16 worktree + nhánh gói, lane 6 | xong |
| 06:52 | Gom 139 P3/mục dở + 6 mục báo cáo vào 8 gói, dựng nhánh gộp từ main 815fa3c1e | xong |
| 06:55 | Workflow `wf_8043b683-fb8` chạy 8 gói P3 (slot 0–7) | đang chạy |
| 06:58 | Chủ chốt E-2, E-43, deploy, link Cộng đồng. Thêm 2 gói e2-diem-khach (slot 8), e43-vi-ctv (slot 9) | |
