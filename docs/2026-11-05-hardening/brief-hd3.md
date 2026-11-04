# Gói hd3 — payload ảnh và cột nặng

- Worktree: `/Users/longla/coding/tubutree-mini-app/.claude/worktrees/hard-1105-hd3`
- Nhánh: `hard/1105-hd3`, gốc: tip tích hợp ghi trong prompt giao việc (đã gồm đợt 1 ha/hb/hc và gói k).
- Cổng PG: **46536**

Trước khi làm, đọc `hard-1105-rules.md` (cùng thư mục với brief này) và làm theo.

Bối cảnh: Mini App PROD không có Cloudinary (`VITE_CLOUDINARY_*` không có trong bản build), nên ảnh khách/đối tác tải lên được lưu base64 trong DB. Heap API 512 MB. Trên PROD hiện có 0 ảnh sản phẩm base64 (đọc 04/11), nhưng ảnh review và ảnh sản phẩm đối tác là nội dung người dùng, sẽ có.

Phía công khai đã có cách trả ảnh dạng ref (`imageVersions` + `public-image.ts`). Mọi chỗ dưới đây dùng lại đúng cách đó, không viết cách mới.

## Mục
### L3-01 (MINOR) — PDP
`catalog.service.ts` (~516-557): `findUnique({ include })` kéo cả mảng ảnh rồi md5 + giải mã từng ảnh mỗi lượt xem.
- Đổi sang `select` tường minh các cột PDP cần. Không thêm trigger/cột mới.
- Test: response PDP giống hệt trước (snapshot trên fixture có ảnh URL và ảnh base64).

### L3-02 — hàng chờ duyệt sản phẩm đối tác
`admin.service.ts` (~1904-1934): trả nguyên dòng kèm ảnh base64 cả bản sống lẫn bản nháp, 100 dòng mỗi trang, cộng N+1 `describePancakeLink`.
- Select cột cần; ảnh trả dạng ref như phía công khai.
- Gom `describePancakeLink` thành một truy vấn cho cả trang.
- Mặc định `limit` 20, tối đa 50.
- Sửa admin web chỗ đọc response này cho khớp (ảnh hiện qua URL ref). vitest.
- Test: unit số truy vấn không tăng theo số dòng; response không còn chuỗi `data:image`.

### L3-03 — danh sách review của admin
`admin.service.ts` (~558-577) chọn `images` base64. Đổi sang `imageVersions` + ref, giống phía công khai. Sửa admin web cho khớp. vitest.
- Test: response không còn `data:image`; ảnh vẫn mở được qua route ref (e2e nhẹ hoặc unit route).

### L3-17 — payroll/brands
Chỉ select cột màn hình cần. Kiểm admin web không dùng cột bị bỏ (grep tên trường).

## Lưu ý chung
- Đổi hợp đồng response admin thì grep cả `apps/web` và `apps/miniapp` xem ai dùng endpoint đó.
- Route ref ảnh phải giữ kiểm quyền như hiện tại: ảnh bản nháp của đối tác không được lộ ra công khai. Thêm test: gọi ref ảnh nháp không có quyền admin → 403/404.

## File không đụng
- Index/truy vấn của hd1; runtime/hàng đợi/hộp việc của hd2.
- Trong `admin.service.ts` chỉ sửa các hàm của L3-02, L3-03, L3-17.
