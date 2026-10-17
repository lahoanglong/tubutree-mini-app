# Gói community: báo cáo triển khai

Nhánh `lr/community`, tính từ `e82a6d57` (nhánh `review/2026-10-18-launch`), chưa push. Có thêm vòng sửa sau review Opus (xem mục 1b). Postgres race: cổng 5564, DB `tubutree_it`.

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
- Chống spam: tối đa 1 tin cho mỗi bài mỗi giờ cho mỗi loại (khoá riêng `post-like:<postId>` và `post-comment:<postId>`, xem 1b). Làm bằng `dedupeWithinMs` mới trong `notify()` (`notifications.service.ts`), kiểm tra bên trong khoá advisory của pg nên 8 lượt thích đồng thời chỉ ra 1 tin.
- Khoá cấu hình `community.author_notify_interval_minutes`, mặc định 60. Đặt 0 là tắt thông báo loại này. Giá trị không hợp lệ rơi về 60.
- Mẫu thông báo `COMMUNITY_POST_LIKED`, `COMMUNITY_POST_COMMENTED` thêm trong `prisma/seed.ts` và migration dữ liệu `20261018100100_lr_community_templates_config` (prod không chạy seed).

### D4-022: báo tác giả khi bài bị ẩn
- Mẫu `COMMUNITY_POST_HIDDEN` có lý do (mặc định lý do nội quy khi để trống).
- `hidePost` (route mới của CSKH và ADMIN) và nhánh ADMIN xoá bài người khác trong `deletePost` (miniapp `DELETE /feed/:id`) đều báo tác giả. Không dùng lại `rejectPost` vì lời "chưa được đăng" sai với bài đã đăng.

### D4-009: quiz hôm nay xoay vòng xác định
- `game-quiz.service.ts`: `getTodayQuiz` lấy cửa sổ `skip/take` trên ngân hàng câu hỏi sắp theo `id`, vị trí đầu = `(số ngày VN * số câu mỗi ngày) % tổng`, quay vòng khi chạm cuối. Ngày tính theo `vnDateKey()` nên ngày đổi lúc 0 giờ VN. Câu đã trả lời hôm nay bị loại, không kéo thêm câu khác. Ngân hàng rỗng trả `[]`.

### D4-010: nhãn bảng xếp hạng
- `apps/miniapp/src/components/game/weekly-leaderboard.tsx`: tiêu đề thành "Chuỗi điểm danh dài nhất"; bục hiện `🔥 chuỗi` thay cho số cây (dữ liệu là chuỗi dài nhất mọi thời gian). Component và tên file giữ nguyên để diff nhỏ. Sửa 3 spec miniapp. Không làm bảng tuần thật.

### 1b. Vòng sửa sau review Opus (REQUEST_CHANGES nhẹ), mỗi mục một commit
1. `hidePost` và `deletePost` (`community-feed.service.ts`): chuyển trạng thái bằng `updateMany` có điều kiện (`hidePost`: `status: 'PUBLISHED'`, sau mục 4 bên dưới; `deletePost`: `status: { not: 'REMOVED' }`), chỉ khi `count === 1` mới đảo điểm, rút tin cậy, báo tác giả. Race spec: 6 lượt ẩn song song, và ẩn trộn với ADMIN xoá, đều đúng 1 tin `COMMUNITY_POST_HIDDEN` (đã chạy trên code cũ: đỏ; code mới: xanh).
2. `rejectPost`: chỉ nhận `PENDING` qua `updateMany where status='PENDING'` và cổng `count === 1`. Bài đã đăng trả 409 "Hãy dùng "Ẩn"". Từ chối lần hai trên bài đã `REMOVED` thì ok, không báo thêm; thua cuộc đua với lượt duyệt thì đọc lại và trả 409. Làm cùng kiểu cho `approvePost` (updateMany `PENDING` -> `PUBLISHED`, `count === 1` mới thưởng/báo) để duyệt song song với từ chối không hồi sinh bài vừa bị gỡ; reviewer không nêu riêng mục này, đây là phía đối xứng của cùng lỗi. Bỏ đảo điểm trong `rejectPost` vì bài chờ duyệt chưa cộng điểm. Tab web: lỗi 409 hoặc 404 làm mới danh sách (và số trên "Việc cần xử lý"), lời giải thích hiện ở đầu tab vì dòng đã biến mất; lỗi khác vẫn hiện trên dòng và không làm mới.
3. Khoá gộp tách theo loại: `post-like:<postId>` và `post-comment:<postId>`. Một lượt thích không còn chặn tin bình luận 60 phút; bình luận vẫn gộp với nhau.
4. `hidePost` chỉ nhận bài `PUBLISHED`; bài `PENDING` trả 409 gợi ý dùng "Từ chối". ADMIN gỡ bài người khác qua `deletePost` khi bài còn `PENDING` thì báo `COMMUNITY_POST_REJECTED` ("chưa được đăng") thay vì "đã được ẩn".
5. `notification-categories.ts`: `COMMUNITY_POST_LIKED` và `COMMUNITY_POST_COMMENTED` vào nhóm `GARDEN` (công tắc "Nhắc nhở Vườn Xanh" của khách), không còn là `TRANSACTIONAL`. `COMMUNITY_POST_HIDDEN` vẫn là giao dịch (khách phải biết bài bị ẩn). Nhãn công tắc trong `apps/miniapp/src/pages/settings.tsx` đổi thành "Nhắc nhở Vườn Xanh & tương tác bài viết" để khách hiểu công tắc này tắt cả hai. Test prefs: nhóm đúng, khách tắt thì không nhận thích/bình luận nhưng vẫn nhận tin bài bị ẩn.
6. `notifications.service.ts`: `notify()` đọc nhanh `findFirst` trong cửa sổ gộp ngay đầu hàm, trước khi tra template/khách và trước transaction + khoá advisory; thấy tin rồi thì trả về luôn (bài viral không giữ N kết nối). Kiểm lại trong transaction vẫn là cổng quyết định khi hai lượt cùng thấy "chưa có tin".
7. `dedupeWithinMs` chỉ hợp lệ khi `!= null && > 0`; 0, âm, NaN chặn vĩnh viễn như bỏ trống (trước đây số âm làm cửa sổ nằm ở tương lai, tức là không chặn gì). Có JSDoc.

### 1c. Vòng sửa thứ hai sau review (APPROVE kèm sửa), mỗi mục một commit
1. Duyệt song song ẩn/xoá (`approvePost`): sau khi gắn tin cậy, thưởng và cộng uy tín, đọc lại trạng thái bài bằng `SELECT ... FOR SHARE` (chờ nếu một transaction ẩn/xoá đang giữ khoá dòng chưa commit). Thấy không còn `PUBLISHED` thì tự `reverseReputationForPost` + `revokeTrust` và không gửi tin "đã duyệt". Chứng minh: mọi bước cộng đã commit trước lần đọc lại, nên hoặc duyệt thấy `REMOVED` và tự đảo, hoặc lượt gỡ chạy sau lần đọc và thấy điểm đã cộng. Race spec: hook vào `rewardPost` để ẩn (và tác giả tự xoá) chen vào giữa, chạy trên code cũ thì đỏ; thêm 8 vòng chạy thật song song duyệt với ẩn và duyệt với tự xoá. Điều kiện kết quả: bài `REMOVED` thì uy tín ròng của bài là 0, `isTrusted` false, không có tin "đã duyệt" đứng một mình (duyệt xong rồi mới ẩn thì nhận đủ "đã duyệt" rồi "đã ẩn"). Hạn chế đã biết: nếu tác giả tự xoá chen vào, bước bù cũng rút cờ tin cậy (tác giả có thể đã được tin cậy từ bài khác); chọn an toàn hơn là bỏ sót.
2. `deletePost`: loại tin chọn theo trạng thái lúc chuyển. Hai `updateMany` có điều kiện trong cùng transaction: `PENDING -> REMOVED` trước (báo "chưa được đăng"), nếu không khớp thì `not REMOVED -> REMOVED` (báo "đã ẩn"). Không còn dùng `post.status` đọc đầu hàm. Brute-force race spec: duyệt song song ADMIN xoá, không bao giờ có cả "đã duyệt" lẫn "chưa được đăng".
3. `hidePost` và `deletePost`: `updateMany`, đảo điểm và rút tin cậy chạy trong MỘT `$transaction`. Đảo điểm tách thành `reverseReputationInTx` (không nuốt lỗi, kiểm dòng `REVERSE_*` đã có bằng `findFirst` vì P2002 làm hỏng cả transaction; ngưỡng cấp độ đọc trước transaction). Lỗi ở bước đảo điểm giờ hoàn tác cả việc gỡ (bài vẫn đăng, CSKH thử lại được) thay vì để bài `REMOVED` mà điểm kẹt vĩnh viễn. Đường độc lập (`reverseReputationForRef`, dùng cho gỡ bình luận và bước bù của duyệt) vẫn không ném lỗi nhưng log `error` có `refId`, `user`, `reason`; `revokeTrust` ngoài transaction cũng log `error` kèm `user`. Race spec trên Postgres thật: thiếu hồ sơ cộng đồng làm bước trừ điểm ném P2025, `hidePost` ném lỗi và bài vẫn `PUBLISHED`; tạo hồ sơ rồi thử lại thì gỡ thành công và uy tín về 0. Đổi hành vi: lỗi đảo điểm trước đây là "non-fatal" (bài vẫn gỡ), nay làm thao tác ẩn/xoá thất bại để thử lại.

### Khoá cấu hình mới (đều có giá trị mặc định trong code)
- `community.author_notify_interval_minutes` (0..1440, mặc định 60).
- `community.unanswered_alert_hours` (1..720, mặc định 24).
- Cả hai có khoảng giá trị trong `RANGES` của `system-config.service.ts` (ghi được dù chưa có hàng DB), có hàng seed `createOnly` và nằm trong migration.

## 2. Kiểm chứng

Môi trường: `PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, `DATABASE_URL=postgresql://tubu:tubu@localhost:5564/tubutree_it?schema=public`.

- API jest (feed, ops-inbox, notifications, game-quiz, system-config), từ `apps/api`:
  `npx jest src/modules/feed src/modules/ops/ops-inbox src/modules/notifications src/modules/game/game-quiz src/modules/system-config`
  -> `Test Suites: 25 passed, 25 total` / `Tests: 689 passed, 689 total` (sau vòng sửa review thứ nhất); vòng hai chạy `src/modules/feed src/modules/notifications src/modules/ops`: `Test Suites: 22 passed, 22 total` / `Tests: 688 passed, 688 total`
- Quyền controller (`community-feed.controller.permissions.spec.ts`, nằm trong lượt trên): ADMIN và CSKH được; KHO, STAFF chưa có nhóm, khách, chưa đăng nhập bị chặn; sự kiện và người thắng chỉ ADMIN.
- Race (Postgres thật), từ `apps/api`:
  `npx jest -c test/integration-race/jest.config.js --runInBand` trên: community-launch, ops-health, feed-like-count, community-reward-concurrency, merchant-admin-todo, referral-notice-reconcile, referral-notify, groupbuy-expiry-notify, notification-prefs, wishlist-price-drop-cooldown, zns-delivery, refill-approval
  -> `Test Suites: 12 passed, 12 total` / `Tests: 79 passed, 79 total` (vòng hai chạy lại community-launch + ops-health + feed-like-count + community-reward-concurrency: `Tests: 32 passed, 32 total`, riêng community-launch 20 test; thêm các spec dùng `notify()` có `dedupeKey` vì đã đổi đường đọc nhanh)
- Web, từ `apps/web`: `npx vitest run src/components/admin/community-moderation-tab.spec.tsx src/app/admin/page.spec.tsx src/components/admin`
  -> `Test Files  39 passed (39)` / `Tests  634 passed (634)` (chạy lại trên `src/components/admin src/app/admin` sau vòng sửa)
- Miniapp, từ `apps/miniapp`: `npx vitest run src/pages/game-layout.spec.tsx src/pages/game-behavior.spec.tsx src/components/game`
  -> `Test Files  5 passed (5)` / `Tests  117 passed (117)`; sau vòng sửa chạy rộng `src/pages src/components/game`: `Test Files  63 passed (63)` / `Tests  1167 passed (1167)`
- `npx tsc --noEmit` ở api, web, miniapp: không lỗi.
- `npx eslint --max-warnings=0` trên mọi file đã đổi ở api (cả `prisma/seed.ts`), web, miniapp: không lỗi.
- Drift schema: `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` -> `No difference detected.`
- Không chạy: toàn bộ test suite, build, Playwright (theo brief). Không ghi vào DB dev hay PROD; chỉ `tubutree_it`.

## 3. Chưa làm và lý do

- Đánh giá chờ duyệt trong thẻ việc: không có luồng duyệt đánh giá trong code (xem D1-17 ở trên).
- Bảng xếp hạng tuần thật: ngoài phạm vi (brief chỉ yêu cầu đổi nhãn). Tên component `WeeklyLeaderboard` còn nguyên, đổi tên sẽ làm diff rộng sang file của gói khác.
- Trả lời câu hỏi từ tab web: tab "Chưa trả lời" chỉ đọc, nhắc trả lời trong ứng dụng. Luồng trả lời (kèm thông báo cho tác giả) đã có ở miniapp nên không nhân đôi trên web.
- Để sau (có từ trước, không sửa ở vòng này): ẩn/xoá bài chưa đảo Điểm Xanh đã thưởng qua `reward.rewardPost` (chỉ đảo uy tín cộng đồng). Cần quyết định nghiệp vụ trước vì thu hồi điểm có thể làm số dư âm hoặc điểm đã tiêu.
- Báo cáo vi phạm (`admin/reports`) mở quyền cho CSKH ở API nhưng chưa có giao diện trong tab mới (brief không yêu cầu).
- Sự kiện cộng đồng và chọn người thắng: giữ ADMIN theo brief.

## 4. Câu hỏi cho chủ dự án (kèm giá trị mặc định đã dùng)

1. Ngưỡng "câu hỏi chưa trả lời": đã dùng 24 giờ (`community.unanswered_alert_hours`, chỉnh trong Cài đặt hệ thống). Muốn ngắn hơn trong tuần đầu ra mắt không?
2. Chống spam thông báo tác giả: đã dùng 1 tin mỗi bài mỗi 60 phút (`community.author_notify_interval_minutes`, đặt 0 để tắt). Muốn gộp thích và bình luận chung một khoá (đang làm) hay tách riêng?
3. Lời báo khi bài bị ẩn mà không có lý do: đã dùng lý do mặc định về nội quy cộng đồng. Cần sửa câu chữ không? Mẫu `COMMUNITY_POST_HIDDEN` sửa được trong bảng mẫu thông báo.
4. Hoá đơn VAT chờ xuất chỉ hiện cho ADMIN. Nếu muốn kế toán thấy thẻ này, cần mở thêm quyền cho `issue-invoice` (hiện ADMIN-only), việc này đổi quyền xuất hoá đơn nên chưa tự làm.
5. Tin "bài của bạn có người thích/bình luận" nay thuộc công tắc "Nhắc nhở Vườn Xanh" (nhóm gần nghĩa nhất đang có: tin kéo quay lại, không phải tiếp thị); nhãn công tắc đã đổi thành "Nhắc nhở Vườn Xanh & tương tác bài viết". Muốn tách thành công tắc riêng thì cần thêm cột trên User và một dòng trong Cài đặt miniapp; chưa làm.
6. Quiz hôm nay quay vòng theo thứ tự `id`. Nếu ngân hàng câu hỏi còn ít, khách sẽ thấy câu lặp theo chu kỳ ngắn; cần nhập thêm câu hỏi trước ngày ra mắt.
