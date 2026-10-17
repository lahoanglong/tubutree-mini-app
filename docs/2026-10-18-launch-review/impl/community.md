# Gói community: báo cáo triển khai

Nhánh `lr/community`, 9 commit tính từ `e82a6d57` (nhánh `review/2026-10-18-launch`), chưa push. Postgres race: cổng 5564, DB `tubutree_it`.

## 1. Đã làm theo từng phát hiện

### D4-003 và D1-08: nhóm CSKH kiểm duyệt bài cộng đồng
- `community-feed.controller.ts`: thêm `@AllowStaff('CSKH')` (cùng `@Roles('ADMIN')`) cho hàng chờ duyệt, báo cáo vi phạm, duyệt, từ chối, xử lý báo cáo, ghim. Thêm 3 route mới cho CSKH và ADMIN: `GET admin/published`, `GET admin/unanswered`, `POST admin/:id/hide`.
- Sự kiện (tạo, đóng, danh sách, người tham gia) và chọn người thắng giữ nguyên chỉ ADMIN vì có thưởng Điểm Xanh.
- `community-feed.service.ts`: `hidePost` (đặt `REMOVED`, thu hồi điểm uy tín, báo tác giả, gọi lại không báo thêm), `adminPublished` (bài đã đăng, ghim lên đầu, phân trang cursor), `adminUnanswered`.
- `community-unanswered.ts` (mới): nguồn SQL duy nhất cho "câu hỏi chưa ai trả lời quá N giờ". Một câu hỏi tính là chưa trả lời khi chưa có bình luận nào của người khác, chưa bị gỡ. Bình luận của chính tác giả không tính. Số đếm của thẻ việc và danh sách trong tab cùng dùng nguồn này nên không lệch nhau.
- Tab web `apps/web/src/components/admin/community-moderation-tab.tsx` và client `apps/web/src/lib/community-moderation-client.ts`:
  - ba mục: Chờ duyệt (duyệt, từ chối kèm lý do tối đa 200 ký tự), Đã đăng (ghim, bỏ ghim, ẩn kèm lý do, "Tải thêm"), Chưa trả lời (chỉ đọc, hiện số giờ đã chờ);
  - đủ trạng thái tải, rỗng, lỗi (có "Thử lại"), lỗi riêng từng bài;
  - đăng ký trong `apps/web/src/app/admin/page.tsx` (nhóm "Khách hàng") và `STAFF_TABS.CSKH`, diff nhỏ (+33/-4).

### D1-17: thẻ "Việc cần xử lý"
- `ops-inbox.service.ts`: 3 khoá mới.
  - `communityPending` (bài chờ duyệt, nhóm CSKH);
  - `communityUnanswered` (câu hỏi chưa trả lời quá ngưỡng, nhóm CSKH);
  - `invoicePending` (hoá đơn VAT chờ xuất, chỉ ADMIN vì `issue-invoice` là ADMIN-only; dùng lại `buildAdminOrderWhere({ invoice: 'pending' })` của danh sách đơn).
- Web: nhãn trong `ops-inbox-tab.tsx`, kiểu trong `admin-client.ts`, và xử lý bấm thẻ trong `page.tsx` (mở tab Cộng đồng đúng mục, hoặc mở Đơn hàng đã lọc hoá đơn chờ xuất).
- Không thêm khoá cho đánh giá chờ duyệt: model `Review` không có trạng thái chờ duyệt (`isVisible` mặc định `true`, đánh giá hiện ngay), nên chưa có luồng duyệt để đếm.

### D4-006: báo tác giả khi có bình luận hoặc lượt thích
- `toggleReaction` và `addComment` gọi `notifyAuthorOfActivity`: bỏ qua tự thích hoặc tự bình luận, mọi loại bài. Bài QUESTION vẫn giữ luồng `COMMUNITY_NEW_ANSWER` và `COMMUNITY_EXPERT_REPLIED` cũ.
- Chống spam: tối đa 1 tin cho mỗi bài mỗi giờ (thích và bình luận dùng chung khoá `post-activity:<postId>`). Làm bằng `dedupeWithinMs` mới trong `notify()` (`notifications.service.ts`), kiểm tra bên trong khoá advisory của pg nên 8 lượt thích đồng thời chỉ ra 1 tin.
- Khoá cấu hình `community.author_notify_interval_minutes`, mặc định 60. Đặt 0 là tắt thông báo loại này. Giá trị không hợp lệ rơi về 60.
- Mẫu thông báo `COMMUNITY_POST_LIKED`, `COMMUNITY_POST_COMMENTED` thêm trong `prisma/seed.ts` và migration dữ liệu `20261018100100_lr_community_templates_config` (prod không chạy seed).

### D4-022: báo tác giả khi bài bị ẩn
- Mẫu `COMMUNITY_POST_HIDDEN` có lý do (mặc định lý do nội quy khi để trống).
- `hidePost` (route mới của CSKH và ADMIN) và nhánh ADMIN xoá bài người khác trong `deletePost` (miniapp `DELETE /feed/:id`) đều báo tác giả. Không dùng lại `rejectPost` vì lời "chưa được đăng" sai với bài đã đăng.

### D4-009: quiz hôm nay xoay vòng xác định
- `game-quiz.service.ts`: `getTodayQuiz` lấy cửa sổ `skip/take` trên ngân hàng câu hỏi sắp theo `id`, vị trí đầu = `(số ngày VN * số câu mỗi ngày) % tổng`, quay vòng khi chạm cuối. Ngày tính theo `vnDateKey()` nên ngày đổi lúc 0 giờ VN. Câu đã trả lời hôm nay bị loại, không kéo thêm câu khác. Ngân hàng rỗng trả `[]`.

### D4-010: nhãn bảng xếp hạng
- `apps/miniapp/src/components/game/weekly-leaderboard.tsx`: tiêu đề thành "Chuỗi điểm danh dài nhất"; bục hiện `🔥 chuỗi` thay cho số cây (dữ liệu là chuỗi dài nhất mọi thời gian). Component và tên file giữ nguyên để diff nhỏ. Sửa 3 spec miniapp. Không làm bảng tuần thật.

### Khoá cấu hình mới (đều có giá trị mặc định trong code)
- `community.author_notify_interval_minutes` (0..1440, mặc định 60).
- `community.unanswered_alert_hours` (1..720, mặc định 24).
- Cả hai có khoảng giá trị trong `RANGES` của `system-config.service.ts` (ghi được dù chưa có hàng DB), có hàng seed `createOnly` và nằm trong migration.

## 2. Kiểm chứng

Môi trường: `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, `DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public`.

- API jest (feed, ops-inbox, notifications, game-quiz, system-config), từ `apps/api`:
  `npx jest src/modules/feed src/modules/ops/ops-inbox src/modules/notifications src/modules/game/game-quiz src/modules/system-config`
  -> `Test Suites: 25 passed, 25 total` / `Tests: 670 passed, 670 total`
- Quyền controller (`community-feed.controller.permissions.spec.ts`, nằm trong lượt trên): ADMIN và CSKH được; KHO, STAFF chưa có nhóm, khách, chưa đăng nhập bị chặn; sự kiện và người thắng chỉ ADMIN.
- Race (Postgres thật), từ `apps/api`:
  `npx jest -c test/integration-race/jest.config.js --runInBand test/integration-race/{community-launch,ops-health,feed-like-count,community-reward-concurrency,merchant-admin-todo,referral-notice-reconcile}.race-spec.ts`
  -> `Test Suites: 6 passed, 6 total` / `Tests: 46 passed, 46 total`
  `community-launch` chạy riêng thêm 2 lần liên tiếp: `Tests: 9 passed, 9 total` mỗi lần.
- Web, từ `apps/web`: `npx vitest run src/components/admin/community-moderation-tab.spec.tsx src/app/admin/page.spec.tsx src/components/admin`
  -> `Test Files  36 passed (36)` / `Tests  623 passed (623)`
- Miniapp, từ `apps/miniapp`: `npx vitest run src/pages/game-layout.spec.tsx src/pages/game-behavior.spec.tsx src/components/game`
  -> `Test Files  5 passed (5)` / `Tests  117 passed (117)`
- `npx tsc --noEmit` ở api, web, miniapp: không lỗi.
- `npx eslint --max-warnings=0` trên mọi file đã đổi ở api (cả `prisma/seed.ts`), web, miniapp: không lỗi.
- Drift schema: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` -> `No difference detected.`
- Không chạy: toàn bộ test suite, build, Playwright (theo brief). Không ghi vào DB dev hay PROD; chỉ `tubutree_it`.

## 3. Chưa làm và lý do

- Đánh giá chờ duyệt trong thẻ việc: không có luồng duyệt đánh giá trong code (xem D1-17 ở trên).
- Bảng xếp hạng tuần thật: ngoài phạm vi (brief chỉ yêu cầu đổi nhãn). Tên component `WeeklyLeaderboard` còn nguyên, đổi tên sẽ làm diff rộng sang file của gói khác.
- Trả lời câu hỏi từ tab web: tab "Chưa trả lời" chỉ đọc, nhắc trả lời trong ứng dụng. Luồng trả lời (kèm thông báo cho tác giả) đã có ở miniapp nên không nhân đôi trên web.
- Báo cáo vi phạm (`admin/reports`) mở quyền cho CSKH ở API nhưng chưa có giao diện trong tab mới (brief không yêu cầu).
- Sự kiện cộng đồng và chọn người thắng: giữ ADMIN theo brief.

## 4. Câu hỏi cho chủ dự án (kèm giá trị mặc định đã dùng)

1. Ngưỡng "câu hỏi chưa trả lời": đã dùng 24 giờ (`community.unanswered_alert_hours`, chỉnh trong Cài đặt hệ thống). Muốn ngắn hơn trong tuần đầu ra mắt không?
2. Chống spam thông báo tác giả: đã dùng 1 tin mỗi bài mỗi 60 phút (`community.author_notify_interval_minutes`, đặt 0 để tắt). Muốn gộp thích và bình luận chung một khoá (đang làm) hay tách riêng?
3. Lời báo khi bài bị ẩn mà không có lý do: đã dùng lý do mặc định về nội quy cộng đồng. Cần sửa câu chữ không? Mẫu `COMMUNITY_POST_HIDDEN` sửa được trong bảng mẫu thông báo.
4. Hoá đơn VAT chờ xuất chỉ hiện cho ADMIN. Nếu muốn kế toán thấy thẻ này, cần mở thêm quyền cho `issue-invoice` (hiện ADMIN-only), việc này đổi quyền xuất hoá đơn nên chưa tự làm.
5. Quiz hôm nay quay vòng theo thứ tự `id`. Nếu ngân hàng câu hỏi còn ít, khách sẽ thấy câu lặp theo chu kỳ ngắn; cần nhập thêm câu hỏi trước ngày ra mắt.
