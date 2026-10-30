# Gói P3b giaodien: Chữ khách vãng lai/bị khoá, màn giới hạn tốc độ, a11y và comment quản trị

Gốc: main 2ca045580. Nguồn: P3 ở lượt review cuối các gói đợt P3 29/10 (docs/2026-10-29-p3, đã merge PR #75 và deploy), mục làm dở, và vài mục còn lại trong báo cáo.

Với mỗi mục: kiểm còn đúng trên mã hiện tại không (đường dẫn worktree p3-* trong mô tả cũ đã xoá, đọc ở worktree của gói này; dòng có thể lệch). Đã hết thì skipped + bằng chứng file:dòng. Mục cần chủ quyết (giá, luật điểm, phí, thể lệ, chữ pháp lý, cờ PROD, thêm tin gửi khách) thì skipped, ghi lựa chọn cho chủ.

## phien-r1

File: apps/miniapp/src/pages/profile.tsx:184-201 (cùng game.tsx:146, offers.tsx:101, group-buy.tsx:94, loyalty/guest-tiers.tsx:21, support-contact.tsx:68)

Vấn đề: Mục phien-10 vẫn mở trên mã hiện tại. Tài khoản bị khoá mở tab Cá nhân vẫn thấy 'Đã đăng xuất / Đăng nhập để xem...' với chữ cố định. Bấm 'Đăng nhập ngay' thì login() gặp ACCOUNT_BLOCKED, applyBlocked đặt error, nhưng EmptyState không đọc error nên khách không thấy lời báo gì. Các file này thuộc gói khác, nên gói phien skipped là đúng. Tuy vậy, không gói nào trong 8 gói P3 (kể cả tin-canhan) nhận mục này, nên nó sẽ rơi khỏi backlog.

Cách sửa đề xuất: Điều phối ghi mục này vào backlog đợt sau và giao cho gói canhan/diem/muachung. Cách sửa: trong EmptyState khách của từng màn, đặt body = useAuthStore((s) => s.error) ?? '<chữ hiện tại>', như GuestPrompt ở components/ui/auth-gate.tsx:19-31 đang làm. Hoặc truyền GuestPrompt vào AuthPhaseView. Thêm một spec mỗi màn: status idle, error 'Tài khoản đã bị khoá...' thì phải hiện lời khoá.

## phien-r2

File: apps/miniapp/src/components/ui/auth-gate.tsx:12-16 và apps/web/src/components/login-required.tsx:52-60

Vấn đề: Màn bị giới hạn tốc độ lệch giữa web 375 và Mini. Web hiện biểu tượng Clock, tiêu đề 'Bạn thao tác quá nhanh' và một đoạn thân. Mini dùng ErrorState với tiêu đề mặc định 'Chưa tải được trang này', biểu tượng TriangleAlert, còn câu 'Bạn thao tác quá nhanh...' nằm ở dòng thân. Ca mất mạng cũng đã lệch như vậy từ trước, gói này chỉ nối thêm theo cùng kiểu. Chữ cả hai bên đều đúng lý do và đều có Thử lại.

Cách sửa đề xuất: Trong SessionUnavailable của Mini, truyền title={error === vi.errors.sessionRateLimited ? 'Bạn thao tác quá nhanh' : undefined} cho ErrorState (prop title đã có sẵn) để tiêu đề khớp web. Muốn khớp cả biểu tượng thì làm thành mục riêng ở gói giao diện, không cần chặn merge.

## admin-r3

File: /Users/longla/coding/tubutree-mini-app/.claude/worktrees/p3-admin/apps/web/src/components/admin/account-deletion-panel.tsx:73

Vấn đề: Lỗi có từ trước, tôi suy ra khi đọc mã, chưa kiểm trên trình duyệt. Dưới khổ lg, thanh 'Đổi mục' dính ở đầu trang cao khoảng 61px (admin-nav.tsx:204, gồm min-h-[44px] và py-2). Khối này chỉ có scroll-mt-4 (16px), nên khi mở từ thẻ trên 375px, scrollIntoView({block:'start'}) cuộn tiêu đề 'Yêu cầu xoá tài khoản' vào dưới thanh dính. Danh sách yêu cầu phía dưới vẫn thấy được. Khối lần gửi mã ở external-claims-tab.tsx:181 không có scroll-mt nào. Lần sửa admin-6 đã đúng mục tiêu (khối đứng trước UsersTab ở page.tsx:739-741, cuộn sau khi các query đã tải xong ở external-claims-tab.tsx:99-106).

Cách sửa đề xuất: Đổi `scroll-mt-4` thành `scroll-mt-20 lg:scroll-mt-4` ở account-deletion-panel.tsx:73, và thêm `className="scroll-mt-20 lg:scroll-mt-4"` cho div attemptsRef ở external-claims-tab.tsx:181. Có thể thêm một ca Playwright web khổ 375 như review lượt 2 từng đề xuất: bấm thẻ rồi kiểm tiêu đề #account-deletion-heading nằm dưới thanh 'Đổi mục'.

## giaodien-quantri-r1

File: apps/web/src/components/admin/storefronts-tab.tsx:86-90, 250

Vấn đề: Nếu chủ gian hàng đổi thêm trong lúc admin đang xem, bấm "Đã xem" sẽ giữ lại dấu mới (máy chủ trả count=0, đúng như thiết kế). Sau đó web chỉ tải lại danh sách và ngăn chi tiết. Dải cảnh báo vẫn còn, chỉ đổi giờ, nên admin dễ tưởng nút không ăn và bấm lại mà không xem nội dung mới.

Cách sửa đề xuất: Trong onSuccess của hai mutation seen, đọc kết quả trả về (AdminStorefrontRow). Nếu kết quả vẫn còn contentChangedAt và giá trị này khác mốc vừa gửi, hiện Notice tone=info role=status: "Chủ vừa đổi thêm lúc <giờ>. Xem lại rồi bấm Đã xem." Thêm một ca vào storefronts-tab.spec.tsx kiểm có lời báo này.

## giaodien-quantri-r2

File: apps/web/src/components/admin/community-moderation-tab.tsx:442

Vấn đề: Link "Mở bài" giờ mở tab mới (target=_blank) nhưng không báo trước cho người dùng trình đọc màn hình. Họ bị đưa sang tab khác mà không biết.

Cách sửa đề xuất: Thêm chữ ẩn trong Link, ví dụ <span style={SR_ONLY}> (mở tab mới)</span>, hoặc aria-label="Mở bài (tab mới)". Có thể đổi rel thành "noopener noreferrer" cho theo quy ước chung.

## giaodien-quantri-r3

File: apps/web/src/components/admin/payroll-adjust-sheet.tsx:80-82

Vấn đề: Comment kể các lúc số lương tháng cũ được tính lại nhưng sót một trường hợp: nhân viên mở "Lương của tôi" cũng tính lại (getMyPayroll gọi recomputeStaffMonth, apps/api/src/modules/staff/payroll/payroll.service.ts:258-260). Câu "đứng yên tới khi chốt, ghi đã trả hoặc mở Xem giờ" vì vậy chưa đủ.

Cách sửa đề xuất: Viết lại phần cuối thành: '... đứng yên tới khi có lần đọc hay ghi tính lại tháng đó (chốt, ghi đã trả, Xem giờ, nhân viên mở Lương của tôi)'.

