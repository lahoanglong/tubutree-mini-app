# Bàn giao: đợt P3 nhỏ 1028g (chủ chọn 01/11 chiều)

Đọc trước: `docs/2026-10-28-review/PROGRESS.md` (các dòng cuối), mục "Sau đợt 31/10–01/11" trong `20-backlog.md`, và memory `project-review-1028`.

## Trạng thái lúc bàn giao
- PROD = `cefec4276` (phiên c2, nay tên `tubutree-mini-app-9d`, deploy chiều 01/11; rollback `:prev-01ede387`).
- Main = `45d9dab6d` (+ #105 script ops).
- PR #108 (docs, nhánh `review/1028e-docs`, worktree `review-1028`): chủ ĐÃ DUYỆT merge khi CI xanh. Nếu chưa merge: chờ CI xanh, kiểm không có cửa sổ deploy rồi `gh pr merge 108 --merge`.
- PR #109 (shop redesign, phiên `tubutree-mini-app-03`): có sửa test chập chờn `apps/miniapp/src/components/flash-sale.spec.tsx:178`.
- Tên phiên đổi sau mỗi lần khởi động lại: chạy `ListAgents` trước khi nhắn. Phiên deploy là c2 cũ; phiên shop redesign là e1 cũ.
- Postgres 25432 và Redis 26379 đang TẮT (máy đã khởi động lại). Bật bằng `docs/2026-10-20-uat/tools/pg-native.sh start 25432` và container `tubu-uat-redis` (`docker run --rm --tmpfs ...`, xem memory env-lessons). Không tạo lại nếu đã chạy.

## Quyền (như đợt trước)
ĐƯỢC: worktree và nhánh từ main, sửa mã, test, dev server cục bộ, commit, push nhánh của đợt, mở PR.
KHÔNG: merge vào main khi chủ chưa duyệt (hỏi bằng AskUserQuestion), deploy, ghi PROD, đẩy Mini App lên Testing hay Live, gộp #39, push --force, --no-verify, sửa hay xoá worktree của phiên khác, giết tiến trình không do mình tạo. Không đổi luật điểm, giá, phí, thể lệ, chữ pháp lý.

## Phạm vi 1028g
Một worktree `r1028g-p3`, nhánh `review/1028g-p3` từ main mới nhất, lane 1 (3211–3213, e2e 3940–3949). Một workflow: worker (Sonnet) rồi review Opus, tối đa 2 lượt. Sau đó gate (`tools/gate.sh`), mở PR, hỏi chủ duyệt merge.

- **R-194:** bỏ khối `shippingOrders` khỏi `GET /home/me` (`apps/api/src/modules/catalog/home.service.ts:197`) cùng các nhánh lấy nó: `packages/app-core/src/home-feed.ts:112-115` và `apps/miniapp/src/services/shop-api.ts:674-678`.
  - Tương thích: Mini cũ trên Zalo còn đọc khối này. `take()` trả `null` khi thiếu khoá (`home-feed.ts:49`), nên Mini cũ tự gọi `/orders`. Phải có test chứng minh.
  - Không đụng `shippingOrders` của admin (`admin.service.ts`, `apps/web/src/app/admin/page.tsx`, `admin-client.ts`): đó là thứ khác.
  - Đo: số câu SQL của `/home/me` trước và sau (`prisma-query-log.cjs`, xem `perf/1028e-do/r82-*`).
- **R-188:** thao tác admin không ghi gì thì không làm cũ mọi khoá `admin-*`. Mutation đặt `meta: { skipAdminInvalidate: true }`; `MutationCache` ở `apps/web/src/lib/query-client.ts` bỏ qua khi có cờ. Áp cho gửi tin chat CSKH và các thao tác chỉ đọc. Test: có cờ thì không invalidate, không cờ thì vẫn invalidate cả khi lỗi.
- **R-191:** `apps/web` `site-header.spec.tsx`: ca "HTML máy chủ" chạy `useHydrated` thật (`renderToString`). Hai spec của R-24 (`auth-phase.spec.tsx`, `site-header.spec.tsx`) dọn mock và root trong `finally`.
- **R-192:** Mini vãng lai gọi 10 API ở Trang chủ (có `/orders`, `/cart` của tài khoản khách tạm), web vãng lai gọi 2. Chỉ điều tra và bỏ lời gọi thật sự thừa. KHÔNG bỏ lời gọi nào làm khách tạm mất giỏ hay đơn đang có. Đo lại bằng `perf/1028f-donhang/r16.mjs` (có ghi mã trạng thái). Nếu không có cách an toàn thì ghi lý do, để mở.

## Sau đợt
- Cập nhật `20-backlog.md` (R-188, R-191, R-192, R-194) và `PROGRESS.md` trên nhánh docs mới từ main, số đo vào `perf/1028g-p3/`, mô tả PR ở `pr/1028g-p3.md`.
- Báo các phiên khác danh sách file trước khi làm (R-194 đụng `home-feed.ts` và `shop-api.ts`, vùng Trang chủ của phiên shop redesign).
- Dọn: 22 worktree `r1028*` của các đợt đã merge là của phiên review; xoá được sau khi kiểm `git worktree list` và nhánh đã vào main. Tắt Postgres và Redis khi không phiên nào dùng.
