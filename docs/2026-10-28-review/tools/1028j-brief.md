# Đợt 1028j: luật riêng cho worker (02/11 tối)

Đọc `docs/2026-10-28-review/tools/gd3-worker-brief.md` trước (ở worktree `review-1028`): mọi luật chung ở đó vẫn áp dụng. File này chỉ ghi chỗ khác.

## Gốc và nhánh
- Gốc: `origin/main` 02b19e57c. PROD chạy 173de56b3; từ đó main chỉ thêm #125 (4 file `apps/miniapp`).
- Mỗi gói một worktree `.claude/worktrees/r1028j-<gói>`, nhánh `review/1028j-<gói>`. Đã `pnpm install`, `prisma generate`, build `@tubutree/shared-types`.
- Node: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`.
- Đổi màn ở `apps/miniapp` hoặc `apps/web`: gọi skill `tubu-ui` trước khi sửa giao diện.
- Phiên shop (48) đang làm đợt 8 (chữ "Vui lòng", lưới chữ cấm) trên nhánh riêng. Không đụng phần shop, PDP, giỏ, thanh toán, gian hàng, và không sửa chữ hiển thị ngoài phạm vi gói.
- Đợt 8 của phiên shop sửa chữ ở `notifications.tsx` (Mini, khoảng dòng 333), `tai-khoan/thong-bao/page.tsx` (web, khoảng dòng 207), `shop-api.ts` (thêm `fetchFlashAllowance`), `merchant.service.ts:416`. Không sửa các dòng đó để lúc gộp không xung đột. Bộ quét chữ của đợt 8 cấm "Vui lòng"/"vui lòng" và "chúng tôi" ở mọi file `apps/api/src` (trừ spec) và mọi chữ hiển thị cho khách: chữ mới, câu log, câu lỗi đều không dùng hai cụm này.
- Không đổi luật điểm, giá, phí, thể lệ, chữ pháp lý. Không thêm migration, không đổi `schema.prisma`. Nếu thấy cần thì dừng và báo lại.
- Commit kết thúc bằng dòng `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Không push, không mở PR, không merge: phiên điều phối (9b) làm.
- Không `git stash` trần, không `--no-verify`, không giết tiến trình không do mình tạo.

## Lane và cổng
| Gói | Lane (API / web / Mini App) | Khối cổng e2e | Race Postgres |
|---|---|---|---|
| tomtat2 | 1 (3211 / 3212 / 3213) | 3940–3949 (e2e API 3941, web 3942, Mini App 3943, gate PG 3944, gate Redis 3945) | 46040 |
| zns | 2 (3221 / 3222 / 3223) | 3950–3959 (3951, 3952, 3953, 3954, 3955) | 46050 |
| anh | 3 (3231 / 3232 / 3233) | 3960–3969 (3961, 3962, 3963, 3964, 3965) | 46060 |

- Postgres 25432 và Redis 26379 dùng chung đã bật. Không dừng chúng.
- DB lane copy từ mẫu rồi `npx prisma migrate deploy`.
- Gate cuối: `docs/2026-10-28-review/tools/gate.sh <worktree> --base 02b19e57c --out <file>`. Cả ba gói đều đổi API, nên chạy cả jest (không dùng `--no-jest`).

## Gói tomtat2 (phần còn lại của R-114)
1. Trang Thông báo lấy số chưa đọc từ summary:
   - Mini `apps/miniapp/src/pages/notifications.tsx` và web `apps/web/src/app/tai-khoan/thong-bao/page.tsx` đang dùng query riêng `/me/notifications/unread-count` (`unreadQ`).
   - Đổi sang `useMeSummary({ select: (s) => s.unreadNotifications })` (hook đã có ở hai app), để số trên trang Thông báo, chuông, Cá nhân và thanh đáy cùng một nguồn.
   - Giữ cách lùi hiện có khi summary chưa về hoặc lỗi (đếm trong danh sách đã tải). Không hiện số giả.
   - Đánh dấu đã đọc (một tin hoặc tất cả) phải làm số giảm ngay. `TubuQueryClient` làm mới summary khi làm mới `['notifications']`. Kiểm mutation đọc tin có làm mới đúng khoá đó không; có test.
   - Giữ endpoint `/me/notifications/unread-count` cho bản Mini cũ. Nếu `getUnreadNotificationCount` trong app-core không còn nơi nào dùng ở main thì bỏ hàm client, KHÔNG bỏ route API.
2. Bỏ khối `activeOrderCount` khỏi `/home/me`:
   - `apps/api/src/modules/catalog/home.service.ts:209-223,255` vẫn tính khối này, nhưng không màn nào ở main còn đọc. Thanh đáy và dải Việc cần làm đã dùng `/me/summary`.
   - Rà mọi nơi đọc khối này: `apps/miniapp/src/services/shop-api.ts:712`, `packages/app-core/src/home-feed.ts:111`, `packages/app-core/src/api/home.ts:37`, `apps/e2e/tests/support/home-merged.ts:38`. Nơi nào còn là đường chạy thật ở main thì giữ đường lùi về `/orders/active-count`; nơi nào đã chết thì bỏ.
   - Bản Mini đã phát hành (Testing V29 từ 173de56b3) đọc `takeMeBlock('activeOrderCount') ?? /orders/active-count`. Phải chứng minh bằng test: khi `/home/me` không có khoá thì bản đó vẫn tự gọi `/orders/active-count` (đã có tiền lệ R-194, `take()` trả `null` khi thiếu khoá).
   - Đếm SQL `/home/me` trước và sau, khách có đơn đang xử lý (lần 1 và lần 2), cùng công cụ đếm SQL của R-194 (`perf/1028g-p3/`). Ghi số.
3. Test: vitest hai app (số trên trang Thông báo đến từ summary; đọc tin làm số giảm; summary lỗi thì không hiện số sai), jest API `home.service` (không còn khối, các khối khác giữ nguyên).

## Gói zns (R-181): ZNS hạ hạng không được gửi đôi
Đọc mục R-181 trong `docs/2026-10-28-review/20-backlog.md` và mã `apps/api/src/modules/notifications/notifications.service.ts` (`dispatchZns` 224–295, `deliverZns` 344–364).

Lỗi 1, gửi đôi:
- Đây là thứ tự gây lỗi:
  1. `queue.add` đã vào Redis nhưng báo quá hạn.
  2. Worker chạy `deliverZns`, đọc log còn PENDING, bắt đầu gọi Zalo.
  3. Catch của `dispatchZns` đóng log PENDING thành FAILED và nhả khoá (`releasedZnsDedupeKey`).
  4. `deliverZns` ghi SENT không điều kiện.
- Kết quả: log SENT mang khoá đã nhả. Đêm sau, `retryZns` không thấy khoá gốc, nên gửi ZNS lần hai.
- Ca này chỉ xảy ra khi giờ yên lặng tắt (giờ bắt đầu bằng giờ kết thúc). Mặc định 21h–08h thì job 03:45 bị dời, nên không xảy ra.
- Yêu cầu: mọi thứ tự xen giữa catch của `dispatchZns` và `deliverZns` đều cho đúng một ZNS tới khách, kể cả các đêm sau. Ví dụ:
  - catch chạy trước khi worker đọc log;
  - catch chạy giữa lúc worker đọc log và lúc gọi Zalo;
  - catch chạy giữa lúc gọi Zalo và lúc ghi kết quả;
  - catch chạy sau khi đã ghi SENT.
- Ràng buộc:
  - Không migration. `status` là cột String; nếu thêm giá trị trạng thái mới thì phải rà mọi nơi lọc theo trạng thái: chống trùng `dedupeWhere`, trần khuyến mãi `promoZnsCount`, admin và báo cáo log tin, go-live, cron nhắc.
  - Giữ nghĩa RETRYING ("lỗi tạm thời, còn lượt") nếu được.
  - Tin thường (không có `dedupeKey`) vẫn phải gửi khi job đến muộn, như chú thích ở dòng 348–349.
- Hai cách đã cân nhắc. Worker chọn và ghi lý do:
  - (a) `deliverZns` nhận log trước khi gửi bằng `updateMany where { id, status in [PENDING, RETRYING] }`. Catch của `dispatchZns` chỉ đóng và nhả khoá khi log còn PENDING chưa bị nhận.
  - (b) Khi ghi SENT, nếu log đã bị đóng và nhả khoá thì trả lại khoá gốc. Ghi kèm điều kiện, không ghi đè mù.

Lỗi 2, đếm dư: catch của `dispatchZns` ném lỗi (`if (dedupeKey) throw err`) cả khi `updateMany` không đóng được log nào (`count === 0`, tức worker đã nhận hoặc đã gửi). Khi đó `sendNotices` đếm dư một khách lỗi. Sửa: chỉ ném khi thật sự đã đóng log. Có test.

Test:
- Race spec mới cạnh `apps/api/test/integration-race/tier-drop-notice-queue.race-spec.ts`. Giả lập các thứ tự xen ở trên bằng hàng đợi giả có điểm chặn: `queue.add` vào "Redis" rồi treo quá hạn, worker chạy `deliverZns` ở từng điểm. Kiểm số lần gọi `zns.sendTemplate` sau đêm đầu và sau một lượt `retryZns` đêm sau.
- Mỗi ca phải đỏ với mã cũ (ghi lại) và xanh với mã mới.
- jest `notifications.service.spec.ts` cập nhật. Chạy cả bộ race của thư mục notifications/loyalty liên quan.

## Gói anh (R-182): ảnh mới từ đồng bộ Pancake và từ đối tác không bị 404
Đọc mục R-182 trong backlog và `apps/api/src/modules/catalog/image-resize.service.ts` (danh sách ảnh được phép đổi cỡ: `registry`, `REGISTRY_TTL_MS` 5 phút, `REGISTRY_MISS_RELOAD_MS`, `invalidateRegistry()`).
- Hiện có hai nơi đã làm mới danh sách:
  - Admin lưu ảnh sản phẩm: `product-admin.service.ts:135`.
  - Admin duyệt sửa sản phẩm: `admin.service.ts:2038`.
- Hai nơi còn thiếu:
  - Đồng bộ Pancake ghi `images`/`thumbnail`: `apps/api/src/modules/integrations/pancake/pancake-sync.service.ts` khoảng 405–420, cả tạo mới lẫn cập nhật.
  - Đối tác tạo hoặc sửa sản phẩm: `apps/api/src/modules/merchant/merchant.service.ts` khoảng 595, cùng các chỗ cập nhật ảnh khác trong file đó.
- Yêu cầu:
  - Sau khi một trong hai nơi trên ghi ảnh mới, lần gọi `/img` đầu tiên cho ảnh đó trả 200, không 404.
  - Chỉ làm mới khi ảnh thật sự đổi, hoặc gom một lần cho mỗi lượt đồng bộ. Không làm mới từng sản phẩm khi đồng bộ cả trăm sản phẩm.
- Ràng buộc:
  - Không tạo vòng phụ thuộc module. `CatalogModule` import `OrdersModule`; Pancake có `pancake-sync-hooks.module.ts` để tránh vòng.
  - Có thể làm một provider nhỏ không phụ thuộc gì để đánh dấu danh sách cũ, cho cả `ImageResizeService` và hai nơi ghi cùng dùng. Hoặc dùng `forwardRef`/`ModuleRef` nếu gọn hơn. Ghi lý do.
  - API chạy một tiến trình (một container), nên cờ trong bộ nhớ là đủ. Ghi rõ giả định này ở chú thích.
- Test: jest cho từng nơi ghi (ghi ảnh mới thì danh sách bị đánh dấu cũ; đồng bộ không đổi ảnh thì không đánh dấu). Thêm một ca tích hợp: lượt đồng bộ ghi ảnh mới, rồi `isRegistered`/`get` cho ảnh đó không 404 mà không phải chờ 30 giây (dùng đồng hồ giả, không ngủ thật).

## Báo cáo khi xong
Ghi vào `docs/2026-10-28-review/reports/1028j-<gói>.md` (worktree `review-1028`, không commit):
- commit đã làm;
- số đo trước/sau (tomtat2: số câu SQL `/home/me`; số lời gọi khi mở trang Thông báo nếu đo được);
- test đã chạy và kết quả, có số dòng pass/fail; ca nào đỏ với mã cũ;
- kết quả gate;
- việc còn lại hoặc rủi ro.
