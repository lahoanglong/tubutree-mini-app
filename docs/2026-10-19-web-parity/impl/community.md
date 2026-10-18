# Lane community (nhánh web/community)

## 1. Gate cuối (run3, trên commit df5c575f)

```
install rc=0 
shared-types rc=0 
app-core-typecheck rc=0 
app-core-test rc=0  Test Files  34 passed (34)       Tests  429 passed (429) 
web-typecheck rc=0 
web-lint rc=0 ✔ No ESLint warnings or errors 
web-test rc=0    ✓ cổng đối tác /merchant — khung trang (DS v2) > thẻ số liệu đọc tổng từ meta; huy hiệu xuất bản theo token success, chưa xuất bản theo token warning 479ms  Test Files  241 passed (24
web-test-utc rc=0    ✓ cổng đối tác /merchant — khung trang (DS v2) > thẻ số liệu đọc tổng từ meta; huy hiệu xuất bản theo token success, chưa xuất bản theo token warning 605ms  Test Files  241 passed
miniapp-typecheck rc=0 
miniapp-lint rc=0 
miniapp-test rc=0  Test Files  282 passed (282)       Tests  4214 passed (4214) 
lint-vars rc=0 OK — every var(--x) reference is defined. 
lint-parity rc=0 > tubutree@0.0.0 lint:parity /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-community lint:parity xanh (28 mục pending) 
web-build rc=0  ✓ Compiled successfully 
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit. 
DONE
```

Playwright chưa chạy (luật lane); spec e2e đã sửa khớp trạng thái cuối (URL về `/cong-dong` sau khi cờ `?deleted=1` bị gỡ) và kiểm "Đã xoá bài".

## 2. Lệch so với ma trận

- `/hoc-vien` và `/hoc-vien/:courseId` (ma trận dòng 33: "công khai") được đặt `private: true` và noindex (commit 22822bd2). Lý do: `apps/api/src/modules/academy/academy.controller.ts:7` có `@Roles('AFFILIATE', 'DEALER', 'STAFF', 'ADMIN')`, khách và khách hàng thường nhận 403 nên trang không thể công khai.

## 3. Câu hỏi cho chủ dự án

- Mở các endpoint đọc của academy (`GET /academy/courses`, chi tiết) cho khách để trang Học viện công khai và lập chỉ mục được, hay giữ riêng tư như hiện tại? Giữ riêng tư là phương án an toàn đã chọn; mở thì cần đổi API (ngoài phạm vi lane).

## 4. Khoảng cách còn lại so với Mini App

- Web không có snackbar: mọi thông báo ("Đã xoá bài", "Đã gửi báo cáo", lỗi thao tác) hiển thị inline (`role=status`/`role=alert`). Lỗi chọn hay nhất / ẩn bình luận hiện ngay dưới bình luận đó.
- Bản ISR của `/cong-dong` giờ gồm cả `CommunityChannels`; chưa có spec riêng cho Suspense fallback của server component (kiểm bằng đọc code, chưa kiểm chứng bằng test).
