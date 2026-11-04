# Gói he — Mini App

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-he`
- Nhánh: `hard/1105-he`, gốc: tip tích hợp ghi trong prompt giao việc (đã gồm đợt 1, đợt 2 và gói k).
- Cổng PG: **46537**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo. Gọi skill `tubu-ui` trước khi sửa giao diện.
Chi tiết từng mục: `audit-1105-findings.md`, phần L4. Số dòng có thể lệch: tìm theo tên.

## Mục
### L4-01 (MAJOR) — timeout request mang ảnh
Mini App PROD không có Cloudinary (`VITE_CLOUDINARY_*` không có trong bản build), nên ảnh đi base64 trong body. Timeout chung 15 s làm khách mạng yếu không gửi được yêu cầu đổi/trả, đánh giá có ảnh, hồ sơ đại lý.
- Chỗ: `apps/miniapp/src/services/http.ts` (~135), `api.ts` (~12), `shop-api.ts` (~795), `dealer-api.ts` (~60).
- Mọi POST/PUT mang ảnh dùng timeout riêng 90 s. Liệt kê đủ các gọi API mang ảnh (grep base64/`data:image`/field ảnh), không chỉ 3 chỗ trên.
- Trong lúc gửi lâu: nút bị khoá và có trạng thái đang gửi, để khách không bấm lại.
- Gửi lại sau timeout không được tạo bản ghi đôi: kiểm API có idempotency/chống trùng cho từng route này. Route nào chưa có thì ghi vào báo cáo, không tự thêm ở API trừ khi chỉ vài dòng.
- Test: vitest kiểm từng hàm API mang ảnh truyền timeout 90 s; request thường vẫn 15 s.

### L4-02 — hồ sơ đại lý gửi lại
Mất phản hồi rồi bấm lại thì nhận 400 "đã có đơn chờ duyệt", màn vẫn đứng ở form (`dealer.tsx` ~140, 147).
- API trả code `DEALER_APPLICATION_PENDING` cho lỗi này (giữ câu tiếng Việt).
- Mini App gặp code đó thì làm mới `['dealer-me']` và chuyển sang màn trạng thái chờ duyệt.
- Test: unit API code; vitest màn.

### L4-03 (phần Mini App) — `maxLength`
Ô nhập Mini App thiếu `maxLength` khớp trần DTO.
- Lập bảng ô nhập → DTO → `MaxLength`. Thêm `maxLength` cho đủ.
- Phần admin web và `FIELD_LABELS` thuộc hf.
- Test: một spec duyệt bảng: mỗi ô có `maxLength` bằng trần DTO.

### L4-04 — sheet giờ công và ca chuẩn (Mini App quản trị)
`admin.tsx` (~379, 414, 986, 1035): không có trạng thái lỗi; sheet ca chuẩn rỗng nên admin thêm trùng được.
- Thêm trạng thái lỗi + nút thử lại; nạp danh sách ca hiện có; chặn thêm trùng ở UI. Kiểm API đã chặn trùng chưa: chưa thì thêm ràng buộc + 409.
- Test: vitest lỗi tải, chặn trùng; unit API nếu có sửa.

### L4-05 — phân trang Ví và Đơn
Sao kê Ví và danh sách Đơn dùng offset trong infinite query: dòng mới chèn đầu làm trang sau lặp hoặc sót dòng (`wallet.tsx` ~45, `orders.tsx` ~63, 146).
- API có sẵn cursor thì dùng. Chưa có thì thêm tham số cursor keyset `(createdAt, id)` vào API, giữ offset cũ chạy được (web và client cũ còn dùng).
- Khử trùng theo id phía client như lớp phòng thủ.
- Test: unit API cursor (trang 2 không trùng/sót khi chèn dòng mới giữa hai lần gọi); vitest khử trùng.

### Thêm từ gói ha — lý do khi cấp/thu quyền nhân sự
Gói ha bắt buộc ghi lý do, nhưng để `reason` tuỳ chọn ở `GrantRoleDto`/`RevokeRoleDto` cho Mini App bản cũ. Thiếu lý do thì sổ ghi "(không có lý do — Mini App bản cũ)".
- Mini App: màn Nhân sự hỏi lý do (3–500 ký tự) trước khi cấp/thu hồi, rồi gửi `reason`. Sửa `apps/miniapp/src/services/staff-api.ts` và `packages/app-core/src/api/staff.ts`. app-core là file dùng chung: báo điều phối trước khi sửa.
- `ConfirmSheet` không có ô nhập: dùng BottomSheet + Input có sẵn (theo `tubu-ui`).
- Không đổi DTO về bắt buộc trong gói này. Làm sau khi Mini App bản mới đã lên PROD; ghi vào báo cáo.

## Kiểm thêm
- vitest miniapp toàn bộ; `terminology` spec của Mini App khi có chuỗi mới.
- Bundle: `pnpm --filter miniapp build`, ghi kích thước entry trước/sau. Không được tăng quá 2 KB gzip.

## File không đụng
- `apps/web` (thuộc hf và phiên web-seo-perf), trừ khi API đổi hợp đồng: khi đó báo lại.
