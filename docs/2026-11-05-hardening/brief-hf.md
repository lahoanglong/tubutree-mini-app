# Gói hf — admin web và nhãn lỗi

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hf`
- Nhánh: `hard/1105-hf`, gốc: tip tích hợp ghi trong prompt giao việc (đã gồm đợt 1, đợt 2 và gói k).
- Cổng PG: **46538**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.
Chi tiết từng mục: `audit-1105-findings.md`, phần L4. Số dòng có thể lệch: tìm theo tên.

## Mục
### L4-03 (phần admin + API) — `maxLength` và `FIELD_LABELS`
Lỗi 400 hiện tên trường tiếng Anh («companyName», «businessName»…). Chỗ: `apps/api/src/common/validation-pipe.ts` (~9, 84).
- Lập bảng: mọi DTO có `MaxLength`/`IsNotEmpty`… mà tên trường chưa có trong `FIELD_LABELS`. Bổ sung nhãn tiếng Việt có dấu cho đủ.
- Thêm spec chặn tái phát: duyệt metadata class-validator của mọi DTO trong `apps/api/src`, mọi tên trường phải có nhãn, hoặc nằm trong danh sách miễn có lý do.
- Admin web: ô nhập thiếu `maxLength` khớp trần DTO. Lập bảng ô → DTO, thêm cho đủ. Spec duyệt bảng như bên Mini App.
- Phần Mini App thuộc he.

### L4-06 — tab Giờ vàng
Admin tải toàn bộ đợt flash sale kèm items, không `take` (`flash-sale.service.ts` ~666, `admin/page.tsx` ~3175).
- API nhận `?status&take&cursor` (keyset `(startAt, id)` hoặc theo thứ tự hiện tại). Mặc định `take` 20, tối đa 50. Không truyền thì hành vi cũ vẫn chạy (Mini App/web khách nếu cũng gọi).
- Danh sách không kèm items; items tải khi mở một đợt.
- Admin web: lọc theo trạng thái + "Tải thêm".
- Test: unit API phân trang; vitest tab.

## Kiểm thêm
- `apps/web/src/app/admin/terminology.spec.ts` khi có chuỗi mới.
- Playwright admin liên quan: grep `apps/e2e/tests/admin-*` có test tab Giờ vàng thì cập nhật cho khớp. Không sửa `playwright.config*`.

## File không đụng
- `apps/miniapp`: thuộc he.
- Trang khách của `apps/web`, `next.config.*`, `middleware.ts`, CSP: của phiên web-seo-perf / 4f.
