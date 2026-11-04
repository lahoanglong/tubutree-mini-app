# Đợt Security + Performance 2026-11-04 (phần 2)

Đề bài: /tmp/prompt-tubu-sec-perf-seo.md, phần 2. Phạm vi của phiên này: apps/api, apps/miniapp, admin UI (apps/web/src/app/admin, apps/web/src/components/admin).
Phần 1 (web public: SEO/perf/UX) do phiên 2a (gl-1103, nhánh web/1104-seo-perf) làm.
File dùng chung, phải báo nhau trước khi sửa: packages/app-core, packages/shared-types, apps/e2e/playwright.config, apps/web/next.config.*, apps/web/src/middleware.ts, header bảo mật/CSP của web.

Worktree `.claude/worktrees/sec-1104`, nhánh `sec/1104-audit` từ b7cfe6caa. Quy trình: audit chỉ đọc → chia gói → sửa + test (RED → GREEN) → Opus review đối kháng → gate + race → PR → CI xanh → merge → 2a deploy.

## Audit vòng 1 (5 agent chỉ đọc, ở b7cfe6caa)

### Auth / RBAC / IDOR (SEC-A)
Không có IDOR, không route nào lọt guard. JWT, refresh xoay vòng, khoá tài khoản, mass assignment đều ổn.
- A1 Major (có điều kiện), trùng với W2: CORS nhận `http(s)://*.tubutree.com` và cổng tuỳ ý, kèm credentials; `/auth/refresh` ở chế độ cookie trả accessToken trong thân. Thêm: thu hẹp `zaloOriginRe`; refresh/logout chế độ cookie bắt Origin thuộc `staticAllow`; HSTS includeSubDomains (Caddyfile, file hạ tầng). `bootstrap.ts:90-110`, `auth.controller.ts:61-65,120`, `refresh-cookie.ts`.
- A2 Minor (tiền, CẦN CHỦ QUYẾT): `/affiliate/payouts` và `/affiliate/links` không kiểm `affiliateAccess`; CTV bị hạ về CUSTOMER vẫn rút được hoa hồng APPROVED vào Ví. `affiliate.service.ts:1378-1425,340`.
- A3 Minor: chấm công tin lat/lng thô khi `attendance.office_ips` rỗng. `staff/attendance/attendance.controller.ts:82`, `verify.ts:21`.
- A4 Minor, cần kiểm, trùng với W7: đăng nhập Zalo không kèm `appsecret_proof`.

### Webhook / biên (SEC-W)
- W1 Major: gzip bomb. Tầng thân 10mb (`/api/admin`, `/api/feed`, `/api/storefront`, `/api/merchant`) giải nén trước khi xác thực; request không có JWT bị 401 trước throttler nên không bị đếm. `common/body-limits.ts:16,144,148`, `bootstrap.ts:124`, `app.module.ts:127-129`. Sửa: `inflate:false`; tầng large chỉ khi Bearer hợp lệ.
- W2 Minor: CORS nhận `http://` (xem A1).
- W3 Minor: secret webhook (Pancake/Gomdon/OA/bridge/AccessTrade) không ép độ dài ≥32 ở production; các route này có `@SkipThrottle`. `config/env.validation.ts`.
- W4 Minor: `x-throttle-bypass` của SSR miễn mọi throttler; `/san-pham?q=` khuếch đại. `common/throttle/app-throttler.guard.ts:43-51`.
- W5 Minor: IPv6 không gom theo /64 khi tính khoá throttle. `throttle.config.ts:27`.
- W6 Minor: khách vãng lai gửi tin CSKH không giới hạn số tài khoản, làm cạn trần 300 tin/giờ của cầu nối. `support-chat`.
- W7 Minor, cần kiểm: `appsecret_proof` (xem A4).
- W8 Minor, cần kiểm: webhook Pancake khớp đơn qua "Order code:" ở bất kỳ chỗ nào trong note và tin `is_paid` mà không cần số tiền. `pancake-webhook-dedupe.ts:49`, `pancake-payment.util.ts:28`.
- W9 Minor: so token `a.length===b.length && timingSafeEqual` để lộ độ dài ở 4 nơi (gomdon, access-trade, bridge-events, zalo-oa).

### UI Mini App + admin (PERF-F / SEC-F)
- F1 Major: CORS thiếu `maxAge` nên mỗi request phải chờ preflight. `bootstrap.ts:110`.
- F2 Major: mỗi request đọc lại deviceId từ ZMP storage. `miniapp/src/services/api.ts:151`, `store/auth.ts:63`.
- F3 Major: Trang chủ re-render toàn trang theo nhịp poll flash sale (`isFetching`). `components/home/use-block-query.ts:43`.
- F4 Major: `WishlistHeart` dùng `useAuthStore()` không selector, ×100 thẻ. `components/wishlist-heart.tsx:54`.
- F5 Major: admin `page.tsx` import tĩnh 64 tab.
- F6 Major: mutation admin invalidate mọi query `admin-*`, cộng refetch thừa. `web/src/lib/query-client.ts:48` (ngoài thư mục admin, cần báo 2a), `admin/page.tsx:2287`.
- F7–F12 Minor: browse key trùng, profile 8–9 query, `use-remaining` tick, notifications refetch, ảnh upload không nén trước khi đẩy Cloudinary, 2 observer poll inbox.
- SEC-F1 Major: CSP web `unsafe-inline`/`unsafe-eval`, Report-Only không có endpoint báo cáo. `apps/web/next.config.mjs:52`. File DÙNG CHUNG với 2a.
- SEC-F2 Major: ảnh CCCD đại lý `<img src>` URL tuỳ ý (API DTO chỉ `isURL`). `admin/page.tsx:937`, `dealer/dto/dealer.dto.ts:28-59`.
- SEC-F3 Minor: PII khách gần đây của CTV ở localStorage không xoá khi logout.
- SEC-F4 Minor: deviceId có nhánh `Math.random`.

### Prisma / DB (PERF-D)
- D1 Major: `GET /products/:slug/reviews` (public) nạp ảnh base64 của 100 đánh giá rồi sha1. `reviews.service.ts:344`.
- D2 Major: thẻ sản phẩm, for-you (take 200), giỏ đọc nguyên dòng products/variations. `catalog.service.ts:705`, `cart.service.ts:121`.
- D3 Major: thumbnail base64 sản phẩm đối tác được giải mã + md5 mỗi thẻ. `merchant.service.ts:624`.
- D4 Major: cron sức khoẻ 5 phút quét tuần tự `notification_logs` 2 lần. `ops-health.service.ts:553`.
- D5 Major: `creditOrderPoints` thiếu `refType` nên quét tuần tự `points_transactions`. `loyalty.service.ts:111,155`.
- D6 Major: `distinct` của Prisma bỏ `take` (không có nativeDistinct). `loyalty-expiry.service.ts:411,525`, `game-reminder.service.ts:118`.
- D7 Major: bảng tin giải nén mảng ảnh TOAST mỗi bài. `feed/feed-images.ts:60`.
- D8–D13 Minor: thứ tự nạp sổ trước kiểm nhắc; image-resize unnest; retention thiếu index thời gian; danh sách đơn thừa cột; 16 cron giữ kết nối; nhắc Giờ vàng 500/phút tuần tự.

### DTO / injection (SEC-V)
SQL, ReDoS, CSV, path traversal, SSRF `/img`, XSS lưu trữ, upload SVG: ổn.
- V1 CRITICAL: `POST /dealer/apply` cho khách vãng lai, chữ không `MaxLength`, ảnh base64 2 triệu ký tự hoặc URL bất kỳ, thân 10mb; `listDealerApplications` không `select` (ADMIN_QUEUE_PAGE_SIZE 100), nên API hết bộ nhớ. `dealer/dto/dealer.dto.ts:25-62`, `dealer.service.ts:157`, `admin.service.ts:298`. Gộp với SEC-F2 (img CCCD).
- V2 Major: `POST /cashback/click` `productUrl` không IsUrl/MaxLength, khách vãng lai gọi được, mở redirect qua accesstrade; `cashback_clicks` không có retention. `cashback.controller.ts:9`.
- V3 Minor: `take=1.5` gây 500 (`IsNumberString`). `common/cursor-page-query.dto.ts:14`.
- V4 Minor: `page=1e20` gây 500 (không `@Max`). `common/pagination.ts:6`.
- V5 Minor: `monthlyVolumeEstimate` không trần (int4). `dealer.dto.ts:61`.
- V6 Minor: `theme` gian hàng không trần, trả ra công khai. `storefront.controller.ts:27`.
- V7 Minor: `qrImageUrl`/`proofImageUrl`/`evidenceUrl` chuỗi bất kỳ. `staff/payroll/payroll.dto.ts`, `shifts/dto/shift.dto.ts`.
- V8 Minor: note đơn CTV không trần; recipient/street thiếu NO_HTML. `affiliate/dto/place-order-for-customer.dto.ts`.
- V9 Minor: ảnh đánh giá + đổi/trả chưa `verifySignature`.
- V10 Minor: `tracking_link` Pancake không `safeHttpUrl` (ghi ở processor, hiện ở `apps/web/src/app/merchant/fulfil-orders-tab.tsx:227`, thư mục của 2a).
- V11 Minor: brand DTO chữ không trần.

## Quyết định của chủ (04/11, AskUserQuestion)
- A2: chặn rút hoa hồng + tạo link khi mất quyền CTV.
- W6: chỉ user thật được chat CSKH; khách vãng lai được mời đăng nhập Zalo.
- A3: khi không có IP văn phòng, chấm công chỉ nhận mã vị trí Zalo, từ chối GPS thô.
- W8: khớp "Order code" chỉ theo dòng Tubu ghi; đơn chưa gắn Pancake thì không tự lật PAID, đưa vào chờ Kế toán.

## Số liệu PROD (2a đọc, 04/11 10:5x)
- Độ dài secret: PANCAKE 64, ACCESSTRADE 48; GOMDON, ZALO_OA, ZALO_BRIDGE rỗng. Nên W3 chặn lúc khởi động khi secret đã đặt mà < 32.
- AUTH_COOKIE_SAMESITE=lax. `attendance.office_ips`=[]. `cashback_merchants` isActive: 3.

## Phối hợp với 2a
- CSP: tôi làm route POST /api/csp-report (gói c). 2a sửa next.config: thêm report-uri/report-to, bỏ unsafe-eval ở production, giữ Report-Only. Merge xong báo 2a đường dẫn route.
- `apps/web/src/lib/query-client.ts`: tôi được sửa, chỉ nhánh `admin-*`, có chạy vitest web.
- V10 phía hiển thị (merchant/fulfil-orders-tab.tsx): 2a làm.
- 2a sửa `packages/app-core/src/shop-copy.ts:301-302` và ô tìm kiếm Mini App (a11y). Gói f không đụng hai chỗ này.

## Gói (worktree `.claude/worktrees/sec-1104-<x>`, nhánh `sec/1104-<x>`, từ b7cfe6caa)
- a (biên API): W1, A1/W2, F1, W3, W4, W5, W9. PG 46281.
- b (đầu vào): V1–V11, SEC-F2, admin `rows`. PG 46282.
- c (phân quyền + nghiệp vụ): A2, W6, A3, W8, A4/W7, route CSP. PG 46283.
- d (index + cron): D4, D5, D6, D8, D10, D13. PG 46284.
- e (dữ liệu kéo thừa): D1, D2, D3, D7, D9, D11. PG 46285.
- f (Mini App): F2, F3, F4, F8–F11, SEC-F3, SEC-F4.
- g (admin UI, chưa giao): F5, F6 (query-client chỉ nhánh admin-*), F12.
- Chưa xếp gói: D12 (16 cron giữ kết nối, cần đánh giá rủi ro), F7 (key app-core, file dùng chung).

## Trạng thái
- 04/11: 5/5 báo cáo về. Gói a, b, c, d, e, f đang chạy (worker Sonnet).
- 04/11 chiều: r8 (#165) đã lên PROD 42050c881 (270 migration).
- Gói d: review Opus vòng 1 REQUEST_CHANGES (M1 BRIN gây drift `migrate diff` exit 2). Sửa ở 7d4f90852: 5 BRIN thành btree `@@index(map:)`, cache mẫu thêm số thế hệ. Review vòng 2: APPROVE (0/0/0). Tôi kiểm lại: DB sạch `migrate deploy` 270, `migrate diff --exit-code` = 0, tsc, jest 1139/1139, race 5/5. Tip 0033b9a77 (sửa tên test). Lưu ý: DB nào đã áp bản cũ của migration 20261104130000 (tên `*_brin`) phải dựng lại, PROD chưa áp.
- Gói b: review Opus REQUEST_CHANGES. M1 taxCode "" bị 400; M2 trần ảnh đại lý 700k thấp hơn trần nén web 1,4 triệu; M3 retention xoá `cashback_clicks` còn giao dịch trỏ tới (postback CONFIRMED muộn bị bỏ). Minor: cờ has CCCD gán cứng, `image/jpg`, SĐT bàn. Đang sửa.
- Gói f: review Opus REQUEST_CHANGES. M1 ImageUpload ép JPEG, PNG trong suốt thành nền đen (QR nhận lương, logo). Minor: notifications ghi đè khi đang tải trang, F8 không hoãn được gì. Quyết định: revert F8 (query nằm trong màn đầu, hoãn gây nhảy bố cục). Đang sửa.
- Gói a: review Opus REQUEST_CHANGES. M1 Bearer hết hạn + thân lớn bị 413 thay vì 401 nên client không refresh; M2 gian hàng `<slug>.tubutree.com` refresh/logout bị 403 (ẩn tới khi bật subdomain). Minor: comment `ssr` sai (khoá theo handler), `inflate:false` ở tầng webhook, login cookie không chặn Origin, ZALO_OA secret chặn khởi động quá tay. Đang sửa.
- Gói a: sửa ở 6d0573d93, 0722143e2, b285e41cd. Review vòng 2: APPROVE (0/0/2 Minor). Tôi kiểm: tsc, jest 145 suite 3268/3268. 76011612f: harness UAT gửi Origin, comment gzip (chỉ docs + comment). Tip cuối gói a: 76011612f.
- Gói b: sửa ở b6dac269f, d843c7eb4, 6b3af1aff, 8b64ad55a. Review vòng 2: APPROVE (0/0/2 Minor). Tôi kiểm: tsc api/web/mini, jest 3512/3512, race 138/138, vitest web 1864 + mini 119. f156af3e5 chuẩn hoá SĐT đại lý về `0…` + chỉ nhận `0[35789]\d{8}` hoặc `02\d{9}`; 484249a7e + 772baf3f8 index `cashback_transactions.clickId` (migration 20261104150000, drift 0 trên DB sạch). Tip b: 772baf3f8.
- Gói f: vitest toàn bộ của tôi đỏ 2 test luật màu (`'#fff'`); 7 test khác đỏ do máy tải, chạy riêng xanh. Sửa f453a901f (`'white'`), 59184408e (giữ PNG/WebP ≤400 KB ở nhánh base64). Tôi thêm 8af2f21fe: khung cắt ảnh đại diện phủ nền trắng (PNG nay vào khung cắt nguyên bản). Tip f: 8af2f21fe.
- Gói f: sửa ở 63a6e271b (ảnh: Cloudinary gửi nguyên PNG/JPEG nhỏ, base64 phủ nền trắng), 071e68164 (revert F8), 55fccb11c, b805b2ea5. Review vòng 2: APPROVE (0/0/3 Minor). Minor còn: giữ PNG nhỏ ở nhánh base64.
- Gói c: 8 commit a43ecc539..e097b25da (A2, W6, A3, W8, A4, route `POST /api/csp-report`). 7b8b8e5fb W8 vào ô "Cần xử lý Pancake" (`ATTENTION_PAYMENT_UNLINKED`, tự gỡ khi PAID ở `markPaid` và `confirmDealerOrderPayment`; sửa luôn lỗi `appendAttentionReason` làm mất lý do khác khi lý do đã có — race bắt được). 22deae449 A4 thử lại không proof khi Zalo từ chối. W6 web: không cần sửa (web không gọi `/auth/guest`, không có phiên guest). Đang chỉnh: log proof chỉ khi lượt không proof thành công.
- Gói g: xong 4 commit a9840bae2..4a290f7ee (F5 tab lười: First Load JS /admin 372 → 258 kB; F6 `meta.adminInvalidate`; F12 `useOpsInbox` một nhịp poll). Đang review Opus + tôi chạy toàn bộ vitest web.
- Gói e: xong 6 commit 3a5741812..953d66f28 (D1 `reviews.imageVersions`, D2 select thẻ/giỏ, D3 thumbnail ref, D7 `feed_posts.imageCount/coverRef` qua trigger, D11 bỏ shippingHistory/invoiceRequest khỏi danh sách đơn). 3 migration 20261104140000/141000/142000. D9 KHÔNG sửa: cần cột `imageUrls` trên products, lợi ích nhỏ khi catalog còn nhỏ. Đang làm thêm: trigger cho `imageVersions` để bỏ khe deploy.
- Migration gói b đổi sang 20261104150000 (tránh trùng mốc với e).

## Lưu ý cho chủ
- A2: cron tự chuyển Ví sẽ warn mỗi giờ cho CTV đã bị hạ mà còn hoa hồng APPROVED, cho tới khi xử lý số hoa hồng đó.
- A4: sau deploy xem log "Zalo từ chối appsecret_proof"; không có thì có thể bật "bắt buộc appsecret_proof" trong Zalo Developers.
- W8: webhook `is_paid` tới trước khi `pushOrder` lưu `pancakeOrderId` (cửa sổ ngắn) thì đơn chờ Kế toán thay vì tự PAID.
- Trước khi bật gian hàng theo tên miền con (B4): đối chiếu bản ghi DNS thật trên Cloudflare; nhãn nào không phải web (n8n, WordPress, link-bio…) phải thêm vào `RESERVED_STOREFRONT_IDENTIFIERS`, vì danh sách này đang là hàng rào cookie đăng nhập.
- Retention cashback: click cũ hơn số ngày giữ mà postback tới sau đó thì vẫn mất (rất hiếm).
- D9 (image-resize unnest products.images mỗi 5 phút) chưa sửa: làm khi catalog đối tác lớn (cột `imageUrls` + trigger như D7).
- Sau deploy gói e, ba câu kiểm phải ra 0: `feed_posts` có ảnh mà `imageCount`=0; `products` thumbnail `data:` trùng `images[1]`; `reviews` có ảnh mà `imageVersions` rỗng.
- Gói g: kiểm tay `/admin` bằng STAFF không có tab inbox; mở thẳng `?tab=payouts`, `?tab=dealerClaims` từ thẻ Việc cần xử lý.
- CSP: web phải thêm `report-uri https://api.tubutree.com/api/csp-report` (2a làm ở next.config).

## Việc hạ tầng / của chủ (ghi lại, phiên này không làm)
- Rule Rate Limiting Cloudflare cho trang HTML; vhost `app.` chỉ nhận dải IP Cloudflare (`RemoteIPTrustedProxy` như vhost `api.`).
- HSTS includeSubDomains (Caddyfile/Apache).
- Đã gợi ý 2a: trang tìm kiếm/lọc `noindex` không SSR catalog (bớt khuếch đại qua bypass `ssr`).
