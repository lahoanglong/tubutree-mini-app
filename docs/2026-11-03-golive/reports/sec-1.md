# Gói sec, lượt 1 (nhánh gl/1103-sec, gốc 52fd5cd65, chưa push)

## Commit
- 9b3909c01 fix(api): chặn thân request quá lớn/nhiều khoá, NUL, và no-store cho request có xác thực (BAOMAT-01, 03, 08)
- f718861b9 fix(feed): kiểm chữ ký ảnh và trần ảnh chờ duyệt của khách vãng lai (BAOMAT-02). Commit này cũng chứa `isAvatarUrl`/`IsAvatarUrl` trong `uploaded-image.ts` (dùng cho BAOMAT-05, nằm nhầm commit).
- 9fb0ff2f8 fix(api): gia cố đầu vào avatarUrl, fullName, trần địa chỉ, mẫu đại lý, mã số thuế (BAOMAT-05, 07, 09, 10, GIOHANG-10)

## Từng mục
- BAOMAT-01: `common/body-limits.ts` (mới) nối vào `bootstrap.ts`. Trần thân theo nhóm route: mặc định 256 KB, 10 MB nhóm ảnh/CSV, 1 MB webhook, `/api/events` giữ 512 KB. Duyệt lặp O(n) trước ValidationPipe: tối đa 10 tầng, 200 khoá/object, 500 phần tử/mảng, 6 000 nút tổng (webhook 20 000). 413/400 trả JSON tiếng Việt ("Dữ liệu gửi lên quá lớn. Bạn thử lại nhé."). `LimitRequestBody 10485760` thêm vào vhost api phase1/phase2 và một dòng vào bảng runbook `docs/launch/deploy-rollback-runbook.md`.
- BAOMAT-03 + KHAMPHA-03: `%00` ở URL/query và `\u0000` ở chuỗi/tên khoá của thân trả 400 (cùng middleware).
- BAOMAT-08: middleware đặt `Cache-Control: private, no-store` khi có header Authorization; `@Header`, `@PublicCache`, endpoint ảnh chạy sau nên ghi đè, route công khai giữ cache.
- BAOMAT-02: `FEED_POST_IMAGE` kiểm chữ ký PNG/JPEG/WebP (12 byte đầu) cho tạo và sửa bài. Khách vãng lai (không SĐT, zaloId `guest_`) khi bài vào PENDING kèm ảnh base64: tối đa 2 bài ảnh chờ duyệt mỗi khách, tổng ảnh PENDING của mọi khách vãng lai tối đa 100 MB (lý do ở `community-limits.ts`: ~1% đĩa 12G, ~80 bài 3 ảnh). Ảnh Cloudinary và bài chữ không tính. Áp cả cho sửa bài. SQL đã chạy thử trên `tubutree_uat_tpl` (chỉ SELECT).
- BAOMAT-05: avatarUrl chỉ https + host Cloudinary hoặc `*.zadn.vn`, `*.zdn.vn`, `*.zalo.me`; chỉ kiểm lúc ghi, không kiểm lúc đọc. Mini/web đã có nhánh bỏ ảnh khi API từ chối vì câu lỗi chứa "avatarUrl" (giữ nguyên).
- BAOMAT-07: trần 20 địa chỉ trong transaction có khoá advisory; Mini/web đã hiện câu 400 tiếng Việt của API.
- BAOMAT-09: `fullName` từ chối `<` `>` (dùng chung `NO_HTML` của địa chỉ, export từ `address.dto.ts`).
- BAOMAT-10: `SaveTemplateDto` name MaxLength 120, items ArrayMaxSize 100 (đã export lớp để test).
- GIOHANG-10: MST `^(\d{10}(-\d{3})?|\d{12})$` (nhận cả CCCD 12 số theo ghi chú người xác minh), MaxLength tên công ty 255, địa chỉ 500, email 254.

## Bảng route -> trần thân (kiểm kê bằng grep DTO có IsUploadedImage/IsImageRef/IMAGE_MAX/*_CSV_MAX_LENGTH/proofImageUrl/evidenceUrl)
| Route | Trần | Căn cứ |
|---|---|---|
| `/api/admin/**` | 10 MB | ảnh SP/gian hàng/nhãn/chiến dịch/học viện 1,5M ký tự, CSV 300 nghìn ký tự, quà đổi rác |
| `/api/merchant/**`, `/api/storefront/**`, `/api/brand/**` | 10 MB | ảnh avatar/bìa/SP (tới 10 ảnh x 1,5M) |
| `/api/dealer/**` | 10 MB | ảnh CCCD/mặt tiền base64 2M ký tự |
| `/api/feed/**` | 10 MB | 6 ảnh x 700 nghìn ký tự |
| `/api/orders/:code/return*`, `/api/returns/**` | 10 MB | 6 ảnh minh chứng x 1,5M ký tự (9 MB, sát trần) |
| `/api/products/:slug/reviews`, `/api/reviews/**` | 10 MB | ảnh đánh giá |
| `/api/staff/**` | 10 MB | `evidenceUrl`, ảnh QR/bằng chứng lương không có MaxLength, Mini có thể gửi base64 khi thiếu Cloudinary |
| `/api/webhooks/**` (Pancake, Zalo OA, Gomdon, ZaloPay, cashback, zalo-miniapp) | 1 MB | payload đối tác, không có DTO trần |
| `/api/events` | 512 KB | như cũ |
| còn lại (auth, cart, checkout, me, ...) | 256 KB | thân lớn nhất hợp lệ (ghi chú, danh sách id) dưới 50 KB |
Ghi chú: `/api/admin` và webhook của vùng db không đổi hành vi (chỉ có thêm bước duyệt khoá). Số nút 6 000: hợp lệ lớn nhất là 500 dòng x 5 trường ~3 000.

## Kiểm
- Đỏ với mã cũ (hoàn nguyên code, giữ test): 33 ca đỏ trong 7 file (bootstrap.spec, community-feed.dto.spec, community-feed.service.spec, update-me.dto.spec, users.service.spec, checkout.dto.spec, dealer-template.dto.spec). `body-limits.spec.ts` mới 32 ca, đỏ vì module chưa có.
- Đo (máy tải ~55): `plainToInstance` 20 000 khoá lạ 2 750 ms (100 000 khoá không dám chạy) so với bước duyệt 1,9 ms rồi 400 (khoá trên 200). Mô phỏng `dos1/2/3` có trong test (20 000 khoá, mảng 20 000 object, `items[30000]`) đều 400 ngay. Không chạy `dos*.mjs` trên lane (gói không có lane).
- `npx tsc --noEmit` (apps/api): sạch (rc=0).
- eslint các file đã sửa: sạch.
- jest API toàn bộ: Test Suites 547 passed; Tests 12775 passed (chạy trước khi thêm `/api/staff` vào danh sách). Sau đó chạy lại `bootstrap.spec` + `body-limits.spec`: 37 passed.
- Không đụng Mini/web nên không chạy vitest/Playwright/lint:parity/bundle.

## Chưa làm / rủi ro / chọn khác brief
- BAOMAT-02: luật "chỉ khách Zalo/SĐT mới đăng ảnh" là luật sản phẩm, không làm. Kiểm chữ ký chỉ áp cho bài cộng đồng, chưa áp cho đánh giá/đổi trả (nhiều fixture dùng base64 giả). Khách vãng lai có đơn DELIVERED được PUBLISHED thẳng nên không bị trần PENDING.
- GIOHANG-10: không sửa client (`checkout-rules.ts` thuộc gói chu); lỗi MST hiện qua câu 400 của API ở chỗ báo lỗi đặt hàng hiện có, chưa có kiểm định dạng ngay ô nhập.
- BAOMAT-08 làm bằng middleware (không phải interceptor Nest): chạy trước guard nên cả 401/429 có no-store.
- Rủi ro: client phát hành cũ gửi thân >256 KB tới route ngoài danh sách (không tìm thấy route nào). Cần deploy API cùng lúc cập nhật vhost (LimitRequestBody) mới có hiệu lực ở Apache.
- Không dựng lane/e2e vì brief ghi gói sec không cần lane.
