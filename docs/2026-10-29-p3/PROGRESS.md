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
| 06:5x | Workflow `wf_8043b683-fb8` chạy 8 gói P3 (slot 0–7) | đang chạy |
| 06:58 | Chủ chốt E-2, E-43, deploy, link Cộng đồng. Thêm 2 gói e2-diem-khach (slot 8), e43-vi-ctv (slot 9) | |
| 07:27 | Workflow `wf_9f99a0cc-144` chạy e2-diem-khach, e43-vi-ctv. Runbook 1.12: chủ trả lời bản Mini Live "không rõ, chưa có khách thật" nên deploy được. Log PROD 48 giờ chỉ có dòng ánh xạ route lúc khởi động, không có lượt gọi route điểm danh cũ. Phiên 93 không deploy, nhường deploy cho phiên này | đang chạy |
| 29/10 | 8 gói P3 review xong (merge sau 1–2 lượt Opus), gộp vào nhánh (d01104684; conflict `add-to-cart.spec.tsx` lấy `waitHoldOver` của muahang, đã gồm #73). Gate 0 FAIL | xong |
| 29/10 | e2-diem-khach merge sau lượt 2, gộp e4ae27426. Playwright Mini 218 + web 374, 0 lỗi | xong |
| 30/10 | e43-vi-ctv merge sau lượt 3 (0 P1/P2), gộp a8e36f19e: 4 file conflict lấy phía E-43 (thay hẳn cách báo kế toán của ctv f9e6a1f9a), bỏ helper `commissionCoversLines` không còn ai gọi | xong |
| 09:27 30/10 | Gate trên a8e36f19e (base 2a3566479): 0 FAIL (jest api 11789, vitest web 8038, Mini 5266 x2, app-core 1273). Race 4 shard: 2341/2343, đỏ 2 ca do gộp | |
| 09:35 30/10 | Opus review bản gộp: không P1; P2 = ca race ctv lỗi thời sau E-43 (trùng ca đỏ); P3 runbook 1.13 với điều kiện 1 của 7.2. Migration: `prisma migrate diff` rỗng, thử áp 6 migration lên DB bản f4ec472d7 qua hết, image cũ khởi động được trên DB đã migrate. Sửa 2 ca race (APPROVED chưa vào Ví giờ bị cắt khi trả một phần; `addGrant` trả thêm `permissionsChanged`) + runbook 1.13, race 3 spec 51/51 | xong |

## Kết quả theo gói (8 gói P3)
| Gói | Lượt review | Đã làm | Một phần | Bỏ qua (đã có sẵn, trùng, thuộc gói khác, cần chủ) |
|---|---|---|---|---|
| muahang | 2 | 7 | 0 | 11 |
| tin-canhan | 1 | 2 | 0 | 24 |
| api-hotro | 1 | 3 | 0 | 11 |
| diem-doirac | 2 | 12 | 0 | 6 |
| ctv | 2 | 2 | 1 | 11 |
| phien | 2 | 10 | 0 | 5 |
| admin | 2 | 14 | 1 | 7 |
| giaodien-quantri | 2 | 14 | 0 | 4 |

Phần lớn mục bỏ qua là đã sửa ở đợt 28/10 hoặc trước (worker ghi file:dòng làm bằng chứng, reviewer kiểm lại).

## Còn lại sau đợt
- Cần chủ quyết (không đổi mã): muahang-8 (`PENDING_REF_TTL_DAYS` 7 ngày, hạn ghi công có thể kéo tới khoảng 13–14 ngày); tin-canhan-14/20 (nhân viên điểm đối tác vai CUSTOMER không thấy hàng Nhận hàng tại điểm ở Cá nhân); tin-canhan-23 (nhấn bundle Mini, entry 708/221 KB); tin-canhan-24 (E-122, CLS 0.0655 đang dưới 0.1); diem-doirac-10 phần (a) (E-38a); giaodien-quantri-10 (bundle), giaodien-quantri-11 (nhãn "Mới" cần đếm SP mới trên PROD).
- Một phần: ctv-1 (web 375 khớp Mini phần thẻ hoa hồng), admin-4 (vitest-miniapp-utc rớt ngẫu nhiên khi máy tải cao; gate cuối xanh).
- P3 nhỏ để đợt sau: muahang-18 (`cspReportOnly` thiếu `media-src`; đang Report-Only nên không chặn video), tin-canhan-25 (`/home/me` vẫn trả khối thông báo), phien-10 (Mini Cá nhân khách vãng lai ghi "Đã đăng xuất"), khoảng 21 P3 ở lượt review cuối các gói.
- E-43: lệnh rút ngân hàng cũ có đơn trả một phần vẫn báo kế toán làm tay; chữ COMMISSION_PAYOUT_REJECTED; gói định kỳ trả bằng Ví của CTV khi Ví đang âm (P3 lượt review 3 của E-43, không rủi ro tiền).
- Mục chờ chủ ở `docs/2026-10-28-e2e/21-quyet-dinh.md` mục B.
