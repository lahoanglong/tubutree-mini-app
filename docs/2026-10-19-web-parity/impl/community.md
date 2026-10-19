# Lane community (nhánh web/community)

## 1. Đã làm

| Mục | Commit | File chính |
|---|---|---|
| Feed + xếp hạng | d8be99a9 | apps/web/src/app/cong-dong/{page,feed-view}.tsx, cong-dong/xep-hang/page.tsx, components/community/* |
| Chi tiết bài | c3bc2509 | cong-dong/[id]/{page,comment-row,post-sheets}.tsx |
| Sự kiện | dfab7174 | cong-dong/su-kien/page.tsx |
| Học viện | 3bd9ab77 | hoc-vien/{page,course-list}.tsx, hoc-vien/[courseId]/course-detail.tsx |
| Sửa review vòng 1-3 | a19f7b0a, 422e6b87, 5bf5bf17, 22822bd2, df5c575f, 7706439b | xem mục 3 |

Route đã bỏ pending: /feed, /feed/leaderboard, /feed/events, /feed/:id, /academy, /academy/:courseId (web: /cong-dong, /cong-dong/xep-hang, /cong-dong/su-kien, /cong-dong/[id], /hoc-vien, /hoc-vien/[courseId]).

## 2. Kiểm chứng (summary.txt gate cuối, run4, HEAD 7706439b)

```
install rc=0 
shared-types rc=0 
app-core-typecheck rc=0 
app-core-test rc=0  Test Files  34 passed (34)       Tests  429 passed (429) 
web-typecheck rc=0 
web-lint rc=0 ✔ No ESLint warnings or errors 
web-test rc=0    ✓ cổng đối tác /merchant — khung trang (DS v2) > thẻ số liệu đọc tổng từ meta; huy hiệu xuất bản theo token success, chưa xuất bản theo token warning 770ms  Test Files  241 passed (241)       Tests  3781
web-test-utc rc=0    ✓ cổng đối tác /merchant — khung trang (DS v2) > thẻ số liệu đọc tổng từ meta; huy hiệu xuất bản theo token success, chưa xuất bản theo token warning 575ms  Test Files  241 passed (241)       Tests  
miniapp-typecheck rc=0 
miniapp-lint rc=0 
miniapp-test rc=1  Test Files  32 failed | 250 passed (282)       Tests  69 failed | 4145 passed (4214)  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @tubutree/miniapp@0.0.0 test: `vitest run` 
lint-vars rc=0 OK — every var(--x) reference is defined. 
lint-parity rc=0 > tubutree@0.0.0 lint:parity /Users/longla/coding/tubutree-mini-app/.claude/worktrees/web-community lint:parity xanh (28 mục pending) 
web-build rc=0  ✓ Compiled successfully 
miniapp-build rc=0 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit. 
DONE
```

miniapp-test rc=1 do tải máy (load 110-165). Lane không sửa file Mini App; tổng vẫn 4214 test. 32 file lỗi đã chạy lại riêng: 28 xanh ngay, 4 file (ctv-order-sheet, reviews-section, dealer, game-behavior) chạy lại lần nữa đều xanh. Chưa chạy lại toàn gate để có summary rc=0 sạch. Gate run3 (df5c575f) có miniapp-test rc=0, 4214/4214. Playwright chưa chạy (luật lane).

## 3. Review

Vòng 1 (b76526a7..ec4fe32d):
- MAJOR composer sự kiện mở ở Hỏi đáp: đã sửa a19f7b0a (key theo sự kiện).
- MAJOR lỗi sửa/trả lời chỉ ở banner đầu trang: đã sửa 422e6b87 (lỗi trong sheet và ô nhập).
- MINOR maxLength trả lời 2000 vs API 500: đã sửa 422e6b87.
- MINOR không có "Đã xoá bài": đã sửa 422e6b87.
- MINOR báo cáo lỗi đóng sheet: đã sửa 422e6b87.
- MINOR Học viện vào sitemap/lập chỉ mục: đã sửa 22822bd2 (noindex, private).
- MINOR bản xem trước bị thay bằng skeleton khi khôi phục phiên: đã sửa 5bf5bf17.
- MINOR KindIcon không kiểm: đã sửa 5bf5bf17.
- MINOR image-upload không có test: đã sửa 5bf5bf17.
- MINOR sửa no-raw-date-format.spec ngoài phạm vi: đã sửa a19f7b0a (formatCount, gỡ ngoại lệ).

Vòng 2 (22822bd2):
- MAJOR e2e xoá bài chờ URL cũ: sửa df5c575f, nhưng assertion sai, xem vòng 3.
- MINOR cờ ?deleted=1 còn trong URL: đã sửa df5c575f (effect router.replace).
- MINOR lỗi Chọn hay nhất/Ẩn nội dung ở banner đầu trang: đã sửa df5c575f.
- MINOR fallback ISR thiếu CommunityChannels: đã sửa df5c575f.
- MINOR thiếu impl/community.md: đã sửa 25b29794.

Vòng 3:
- MAJOR e2e toHaveURL(/\?deleted=1$/) xung đột effect gỡ cờ: đã sửa 7706439b (assert /cong-dong$, giữ kiểm "Đã xoá bài"). Chưa kiểm chứng bằng Playwright.
- Ghi chú: review nói sàn Mini App 4243, thực tế 4214 từ nhánh nền, lane không đụng.

## 4. Chưa làm / cố ý để lại / chưa kiểm chứng

- Playwright chưa chạy: 13 ca e2e trong apps/e2e/tests/community.web.spec.ts chỉ qua typecheck.
- Học viện đặt private + noindex, lệch ma trận dòng 33 (API chỉ cho AFFILIATE/DEALER/STAFF/ADMIN).
- Thẻ bài có link /cong-dong/:id; không còn 404 vì route đã xong.
- Không PullToRefresh/haptic/snackbar (thông báo inline role=status/alert). "Gần tôi" không có trên web.
- Sự kiện đã chọn chỉ là state client, URL không đổi (giống Mini App).
- Thông báo sửa bài thành công giữ chữ "Lưu" như Mini App.
- Fallback Suspense ISR của /cong-dong chưa có spec riêng; hiển thị bản ISR cho người đã đăng nhập chưa kiểm bằng trình duyệt.
- Chưa chạy lại gate lần hai để có miniapp-test rc=0 sạch.

## 5. Câu hỏi cho chủ dự án

- Mở GET /academy/courses và chi tiết cho khách để Học viện công khai/lập chỉ mục? Mặc định: giữ private + noindex (cần đổi API, ngoài lane).
- Học viện với tài khoản CUSTOMER (403) cần màn riêng thay vì lỗi + Thử lại? Mặc định: giữ như Mini App.
- Đổi "Lưu" thành "Đã lưu" khi sửa bài xong? Mặc định: giữ "Lưu".
- Sự kiện có cần URL riêng (vd ?event=id)? Mặc định: không.
