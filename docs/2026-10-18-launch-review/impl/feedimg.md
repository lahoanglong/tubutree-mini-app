# Gói feedimg: báo cáo triển khai

Nhánh `lr/feedimg`, tính từ `c366b1c2` (nhánh `review/2026-10-18-launch` sau khi gộp community và uiquick), chưa push. Postgres race: cổng 5567, container `lr-feedimg-pg`, DB `tubutree_it`. Nguồn yêu cầu: `D6-infra-perf.md` D6-05 mục (c), (d), đề xuất (1). Ảnh sản phẩm web (mục a) do gói infra làm, không làm lại. Không đổi schema, không thêm thư viện, không chạm file của phiên đổi-rác.

## 1. Đã làm gì

### D6-05 (c): `GET /feed` không còn nhúng ảnh base64
- `apps/api/src/modules/feed/feed-images.ts` (mới): `loadFeedImages` hỏi DB một lượt cho cả trang bằng `unnest(images) WITH ORDINALITY`, DB tự phân loại từng phần tử (https/http giữ nguyên, `data:` thành mã `md5(id:chỉ số:nội dung)`) nên Node không bao giờ nhận base64. Chế độ chỉ-bìa cắt ở phần tử đầu ngay trong SQL. Chuỗi lạ (dòng cũ trước khi API chặn) bị bỏ khỏi danh sách nhưng vẫn tính vào `imageCount`. `feedImageRef` → `/feed/posts/:id/images/:i?v=<md5>`.
- `community-feed.service.ts`: `getFeed`, `getPost`, `eventPosts` dùng `select` (`FEED_SELECT`, không có `images`) thay `include`; `adminPending` cũng bỏ `images` thô và trả đường dẫn. `toItem` nhận ảnh đã xử lý. Thẻ sản phẩm trong bảng tin bỏ thumbnail dạng `data:` (sản phẩm đối tác, tới 1,5 triệu ký tự) vì chỉ để vẽ biểu tượng 28px. `MAX_IMAGES` dùng chung `MAX_FEED_IMAGES`.
- `getImage` + route `GET feed/posts/:id/images/:index` (`community-feed.controller.ts`, khai trước `@Get(':id')`): `@Public` + `OptionalJwtAuthGuard` (thẻ img không gửi được token, nhưng nhận ra người xem nếu có Bearer, mẫu của `group-buy`). Quyền như bài viết:
  - PUBLISHED: ai cũng xem, `Cache-Control: public, max-age=31536000, immutable` như ảnh đánh giá.
  - PENDING/HIDDEN/REMOVED: chỉ tác giả, ADMIN, STAFF nhóm CSKH (đọc từ `staffPermissions` của JwtStrategy); người khác, khách, STAFF nhóm KHO nhận 404. Cache `private, no-store`.
  - PENDING còn mở được bằng mã `v` của đúng ảnh đó, vì thẻ img của hàng chờ duyệt và chi tiết bài của chính tác giả không có token (cùng mô hình ảnh minh chứng đổi trả `return-images.ts`). Mã chỉ có trong danh sách của tác giả/người duyệt, gắn id + chỉ số + nội dung nên không mở ảnh khác. REMOVED/HIDDEN không chấp nhận mã.
  - Chỉ phục vụ raster png/jpeg/webp/gif, Content-Type theo data URI (SVG, HTML, base64 hỏng, URL → 404); `nosniff`; `Cross-Origin-Resource-Policy: cross-origin` (miniapp/web khác origin, helmet mặc định chặn); chỉ số ngoài 0..5 hoặc không phải số nguyên → 404 mà không hỏi DB; chỉ đọc đúng một phần tử mảng ảnh.
- Miniapp: `post-card.tsx`, `post-detail.tsx`, `community-moderation.tsx` bọc `apiMediaUrl` (đường dẫn tương đối ghép gốc API; https và data URL của API cũ giữ nguyên nên tương thích hai chiều). Web admin: `evidence-images.tsx` nhận thêm dạng `/feed/posts/:id/images/:i?v=` (chỉ khớp đúng dạng đó).

### D6-05 (d): ảnh đại diện không còn bị bỏ âm thầm
- `apps/miniapp/src/pages/edit-profile.tsx`, `components/image-upload.tsx` (thêm `isCloudinaryConfigured`): chưa cấu hình Cloudinary thì không hiện nút đổi ảnh, thay bằng dòng "Chưa đổi được ảnh đại diện lúc này vì dịch vụ lưu ảnh chưa được bật. Bạn vẫn sửa được tên, email và ngày sinh." Đã cấu hình mà tải lên lỗi thì báo lỗi, giữ ảnh cũ (trước đây giữ data URL rồi bỏ lúc lưu). Ảnh cắt chỉ để xem trước trong lúc tải, không bao giờ vào `avatarUrl` hay request. Máy chủ từ chối ảnh sau khi người dùng vừa đổi thì vẫn lưu tên/email/ngày sinh nhưng báo rõ "ảnh đại diện chưa lưu được" (trước đây báo "Đã cập nhật hồ sơ").
- API không nhận base64 cho avatar: `update-me.dto.ts` đã chỉ nhận URL; thêm `update-me.dto.spec.ts` chốt (data URL, `javascript:`, đường dẫn tương đối, URL quá dài đều bị từ chối).

### Số đo (Postgres race, 20 bài PUBLISHED, mỗi bài 1 ảnh JPEG base64 500.023 ký tự)
| | JSON `GET /feed` | Thời gian |
|---|---|---|
| Trước (HEAD `c366b1c2`, đã có "chỉ ảnh bìa" của gói community) | 10.008.259 byte | 493 ms (service) |
| Sau | 10.659 byte (đo qua HTTP thật) | 308 đến 505 ms (qua HTTP, lần đầu lạnh) |
| Xấu nhất: 20 bài × 6 ảnh, trước | 10.008.849 byte | 1,2 đến 2,9 s (Node đọc cả 60 MB mảng ảnh) |
| Xấu nhất: 20 bài × 6 ảnh, sau | 10.009 byte | 144 đến 342 ms |

JSON nhỏ đi khoảng 940 lần (10 MB xuống 10,7 KB). Chi tiết trade-off ở mục 3. Spec `feed-images.race-spec.ts` chốt trần 40.000 byte và in dòng `MEASURE-AFTER`.

## 2. Kiểm chứng đã chạy
Node 22.23.3, trong worktree `lr-feedimg`.
- `cd apps/api && npx jest src/modules/feed src/common src/modules/users src/modules/reviews`: feed 10 suite, 418 test xanh; common + users + reviews 37 suite, 602 test xanh (gồm `endpoint-inventory.spec.ts`).
- Race (Postgres thật, cổng 5567, `migrate deploy` sạch): `feed-images`, `community-launch`, `feed-like-count`, `community-reward-concurrency`, `pd3-reward-sources`, `review-images`: `Test Suites: 6 passed, Tests: 50 passed` (feed-images mới: 11 test, HTTP thật có helmet: số đo, hỗn hợp ảnh, chỉ số ngoài khoảng, SVG/URL không phục vụ, PENDING/REMOVED theo vai trò, mã `v` đúng/sai/hoán đổi, duyệt xong chuyển công khai, sửa ảnh đổi mã, bài dự thi, bài không ảnh).
- `cd apps/miniapp && npx vitest run` các spec đã sửa (post-card, post-detail, community-moderation, community-events, api, edit-profile, settings, profile-hub, ds-c076, thư mục community): xanh (174 + 81 test ở hai lượt).
- `cd apps/web && npx vitest run src/components/admin`: `35 passed (501 tests)`.
- `npx tsc --noEmit` ở `apps/api`, `apps/miniapp`, `apps/web`: không lỗi. `npx eslint <file đã sửa> --max-warnings=0` ở cả ba app: sạch. `npm run -s lint:vars`: OK.
- TDD: mỗi mục có test đỏ trước (import thiếu / assertion sai) rồi mới viết mã. Spec race viết sau mã nhưng số đo "trước" lấy từ HEAD thật bằng một spec tạm (đã xoá).
- Đã dọn: `docker rm -f -v lr-feedimg-pg`.

## 3. Cố ý để lại
- **Cột `images` vẫn được DB đọc** để lấy ảnh đầu và đếm: Postgres phải giải nén cả mảng (TOAST), dù không còn gửi về Node hay client (xấu nhất 144 đến 342 ms thay vì 1,2 đến 2,9 s). Muốn bỏ hẳn phải thêm cột phi chuẩn hoá (`imageCount`, ảnh bìa/mã bìa) kèm migration backfill: đổi schema nên không làm; làm khi bảng bài lớn lên. Cách gốc vẫn là cấu hình Cloudinary (ảnh thành URL ngắn).
- **Chỗ khác còn nhúng base64 cho khách xem, chưa sửa:**
  - Gian hàng công khai trả `avatarUrl`/`coverUrl` nguyên văn (`storefront.service.ts:276-277`; trần 1,5 triệu ký tự mỗi ảnh, `storefront.controller.ts:22-23`).
  - Sản phẩm của đối tác: `images`/`thumbnail` nhận data URL tới 1,5 triệu ký tự (`merchant.controller.ts:34,96-97`) và đi vào danh sách/chi tiết sản phẩm (`catalog-public.ts:13-14`, `storefront.service.ts:101,203,244`). Nặng nhất khi đối tác dùng ảnh base64; cần một gói riêng với endpoint ảnh cho gian hàng/sản phẩm.
  - Hồ sơ đại lý, minh chứng đổi trả: chỉ admin/chính chủ xem, minh chứng đã đi đường ảnh có cache.
  - Hồ sơ người dùng cộng đồng và câu hỏi/trả lời: không có endpoint riêng; câu hỏi là bài `FeedPost` cùng đường ở trên, bình luận (`FeedComment`) không có cột ảnh.
- **Cache công khai một năm** cho ảnh bài đã đăng (đúng theo ảnh đánh giá): bài bị gỡ sau đó thì ảnh vẫn còn trong cache trình duyệt/CDN theo URL cũ tới khi hết hạn; URL chỉ có trong JSON danh sách nên người ngoài khó biết. Khi gắn Cloudflare, cân nhắc rút `s-maxage` hoặc dùng purge theo URL.
- Throttler: ảnh tải bằng thẻ img không có token nên đếm theo IP (300 lượt/phút/route). Một trang feed là 20 ảnh, nhiều khách chung IP (CGNAT) có thể chạm trần; chưa chỉnh vì đổi chính sách throttle toàn cục ngoài phạm vi.
- `EditPostDto.images` vẫn chỉ nhận https upload hoặc data URL: không client nào gửi `images` khi sửa bài (chỉ title/body); nếu sau này gửi lại đường dẫn tương đối của danh sách thì bị từ chối (đúng hơn là lưu nhầm).
- Ảnh sản phẩm web (mục a) và resize/WebP (mục 3 của đề xuất): thuộc gói infra, cần chốt dịch vụ ảnh.

## 4. Câu hỏi cho chủ dự án
1. Mã `v` mở được ảnh bài PENDING cho thẻ img (hàng chờ duyệt và chi tiết bài của chính tác giả đều là thẻ img, không có token). Mặc định đã dùng: có, theo mô hình ảnh minh chứng đổi trả. Nếu muốn chặt hơn (chỉ Bearer) thì hàng chờ duyệt phải tải ảnh bằng `fetch` + blob thay vì thẻ img.
2. Thẻ sản phẩm trong bảng tin giờ không hiện biểu tượng cho sản phẩm đối tác dùng ảnh base64. Mặc định đã dùng: bỏ biểu tượng thay vì nhúng ảnh 1,5 triệu ký tự; hết khi có Cloudinary.
3. Cloudinary (`VITE_CLOUDINARY_*`) vẫn là việc của chủ dự án: khi chưa có, người dùng không đổi được ảnh đại diện (đã nói thẳng trên màn hình), nhưng đăng bài vẫn dùng base64.
