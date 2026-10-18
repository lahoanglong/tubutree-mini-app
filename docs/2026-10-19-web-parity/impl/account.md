# Lane account: file của lane khác đã sửa (cần core/integrator xác nhận khi gộp)

- `apps/web/src/lib/zalo-mini-app.ts`: thêm `miniAppPathLink`, vì /points/scan không có trang web để tra ngược nên nút Mở trên Zalo phải trỏ thẳng đường dẫn Mini App.
- `apps/web/src/components/mini-app-only-notice.tsx`: thêm prop `miniappPath` cho cùng lý do; không truyền thì hành vi cũ giữ nguyên.
- `apps/web/src/lib/auth-context.tsx`: `updateProfile` nhận thêm `avatarUrl` để phiên cập nhật ảnh đại diện ngay sau khi lưu hồ sơ.
