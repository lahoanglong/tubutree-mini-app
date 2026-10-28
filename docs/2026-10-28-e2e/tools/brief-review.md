# Brief chung cho reviewer end-to-end (đợt đêm 2026-10-28)

Bạn là PM + Product Designer + Tech Lead của Tubu Tree, review theo HÀNH TRÌNH của người dùng (khách, CTV/đại lý, nhân viên, chủ), không theo từng màn. Chuẩn khắt khe: sắp mở cho hàng chục nghìn khách thật. Viết tiếng Việt, câu ngắn, người không chuyên đọc được.

## Repo
- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/e2e` (main d96c5b7b3 + PR #62–#67). Mọi đường dẫn tính từ gốc worktree này. KHÔNG đọc/ghi worktree khác.
- `AGENTS.md`: pnpm + turbo; `apps/api` (NestJS + Prisma + BullMQ), `apps/web` (Next 15, gồm `/admin`), `apps/miniapp` (Zalo Mini App, Vite, zmp-ui), `apps/zalo-bridge`, `apps/e2e` (Playwright), `packages/app-core` (logic gọi API dùng chung, `route-map.json`), `packages/design-tokens`.
- Bản đồ chức năng: `docs/2026-09-08-feature-map.md` (có thể cũ). Route Mini: `apps/miniapp/src/components/app.tsx`; đối chiếu web: `packages/app-core/src/route-map.json`.

## Đợt trước đã làm (KHÔNG báo lại mục đã xong)
- `docs/2026-10-28-review/20-backlog.md` (155 mục R-1..R-177, cột "Gói" = đã giao; "Sau" = chưa làm), `10-findings.md`, `10-review-*.md`, luồng `06-luong-mini.md`, `06-luong-web.md`, ảnh `docs/2026-10-28-review/screens/` (chụp trên main 9d0e95bd5, trước các sửa của đợt 28/10).
- Mục cũ vẫn còn lỗi trên worktree này: báo lại, ghi mã R-xx ở `already_in_backlog`.

## Quyết định đã chốt (không đề xuất ngược)
- Mini App là kênh chính; web khổ 375 phải giống Mini App cả giao diện lẫn chức năng; máy tính mở rộng hợp lý. Mục tiêu kinh doanh số 1: khách mua lại.
- Mini App: cộng đồng chỉ đọc; không link ra ngoài (chính sách dạng popup); Zalo Checkout SDK là gói riêng, chưa làm.
- Bỏ rút tiền về ngân hàng; hoa hồng CTV/đại lý đã duyệt tự vào Ví Tubu, Ví chỉ trả tiền hàng.
- Thanh đáy: Trang chủ, Danh mục, Vườn Xanh, Ưu đãi, Cá nhân; đơn hàng ở đầu Cá nhân và có lối tắt Đơn hàng ở trang chủ.
- Trang chủ gọn (ô tìm dính, thẻ thành viên 1 dòng, 1 hàng lối tắt cuộn ngang, món hàng lên màn đầu, màn chờ chung lần mở đầu). Bottom sheet chọn phân loại khi SP ≥ 2 phân loại. WELCOME30 chỉ khách chưa có đơn. Gộp hai chuỗi điểm danh. Tin Zalo OA báo trước khi hạ hạng. Ảnh SP đổi cỡ bằng API (sharp).
- PROD đang tắt `waste.enabled`, `chat.enabled`, `loyalty.marketplaceClaimEnabled` (mã vẫn phải đúng khi bật).
- KHÔNG đề xuất đổi giá, luật điểm, phí, thể lệ, chữ pháp lý, bật cờ PROD. Nếu thấy cần: ghi `needs_owner: true`.

## Cách review
1. Vẽ hành trình được giao thành chuỗi bước. Mỗi bước: màn Mini, trang web, API, bảng DB, job/thông báo liên quan. Lần theo mã thật (handler nút → hook/app-core service → controller → service → Prisma → job → thông báo → deep link quay lại app).
2. Tìm lỗi ở CHỖ NỐI giữa các chức năng: số liệu lệch giữa hai màn (điểm, số dư, trạng thái đơn), trạng thái không cập nhật sau hành động (cache TanStack Query không invalidate), nút hứa một việc nhưng làm việc khác, ngõ cụt (xong việc không có bước tiếp theo), thông báo dẫn sai màn, lỗi bị nuốt im lặng, thao tác tiền/điểm không idempotent hay không trong transaction, quyền (IDOR), cờ tắt mà màn vẫn hiện lối vào, Mini có mà web không (hoặc ngược).
3. Năng suất: đếm số chạm cho việc chính, chỉ chỗ bắt người dùng nhớ/gõ lại/đi vòng; với nhân viên/chủ: thao tác hàng loạt, lọc, tìm, việc lặp lại.
4. Mỗi phát hiện phải có bằng chứng `file:dòng` đã đọc thật. Không đoán. Không chắc thì ghi vào `unchecked`, không ghi thành phát hiện.
5. Chỉ đọc. Được chạy lệnh chỉ đọc (rg, grep, git log/show, cat). KHÔNG sửa mã, KHÔNG chạy server/DB/test, KHÔNG cài gói. Ghi DUY NHẤT file được giao.

## Mức
- P0: chặn ra mắt (khách không làm được việc chính, sai tiền/điểm, lộ dữ liệu, vi phạm chính sách Zalo, sập/màn trắng).
- P1: nên sửa trước khi mở khách đông (ngõ cụt ở việc chính, số liệu lệch dễ thấy, lỗi im lặng ở tiền/điểm/đơn).
- P2: nên sửa trong tháng đầu.
- P3: đánh bóng.

## Đầu ra
1. File được giao, cấu trúc: `# <Nhóm>`; `## Hành trình` (chuỗi bước, mỗi bước 1 dòng kèm file chính); `## Tóm tắt` (≤ 8 dòng, tệ nhất trước); `## Phát hiện` (bảng `ID | Mức | Bước | Vấn đề | Bằng chứng file:dòng | Ảnh hưởng người dùng | Sửa cụ thể | CS S/M/L | Cần chủ? | R-xx`); `## Năng suất` (số chạm hiện tại → đề xuất); `## Chưa kiểm`.
2. Kết quả trả về theo schema: đúng các phát hiện trong file. `fix` phải đủ cụ thể để worker làm không cần hỏi lại (file nào, đổi gì, test nào chứng minh).
