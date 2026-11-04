# Audit gl-1103 / vùng baomat (bảo mật API khách và web)

Ngày 2026-11-03. Mã: main 52fd5cd65 (PROD 0aa8af5d1 + tài liệu). Chỉ đọc và đo, không sửa mã, không đụng PROD.
Probe tái hiện nằm ở `docs/2026-11-03-golive/audit/baomat-probes/` (xem `README.md` ở đó; chạy bằng Node 22, API lane 6 `http://localhost:3261/api`).

## Cảnh báo trung thực: probe của tôi đã làm lane 6 đứng

Khi đo BAOMAT-01, request 200 000 khoá lạ (`dos2.mjs` bản gốc, thân ~2 MB) làm event loop của API lane 6 đứng khoảng 10 phút (khoảng 15:30 đến 15:40 ngày 03/11). Tôi dừng được phía client nhưng không được phép dừng tiến trình server, nên chờ tới khi nó tự hồi (`/health` 200 lúc 15:40). Lane 6 chỉ có dữ liệu seed và khách guest do tôi tạo; không có dữ liệu persona bị hỏng, nhưng các phiên khác dùng lane 6 trong khoảng đó sẽ thấy treo. Bản `dos1/2/3.mjs` trong thư mục probe đã được cắt cỡ về mức an toàn (vài giây). Đừng nâng cỡ.

## Phát hiện

### BAOMAT-01 (P0, api, owner 2a) Một request ẩn danh ~1 MB làm API đứng hơn 1 phút

- Gốc: `apps/api/src/bootstrap.ts:123` `json({ limit: '10mb' })` và `:127` `useGlobalPipes(createValidationPipe())` (`apps/api/src/common/validation-pipe.ts:113-120`: `whitelist + forbidNonWhitelisted + transform`). `transform: true` chạy `plainToInstance` của class-transformer trước khi class-validator kiểm tra, mà chi phí của nó tăng nhanh hơn tuyến tính theo số khoá và số phần tử mảng. Mọi giới hạn kiểu `ArrayMaxSize(100)` đều chạy sau bước đó nên vô tác dụng.
- Bất kỳ route nào nhận body, kể cả route `@Public()`, đều bị. Throttle chạy trước pipe nhưng một request là đủ.
- Số đo (lane 6, máy tải cao nên số tuyệt đối còn lớn hơn khi máy rảnh, nhưng độ dốc là thật):
  - `dos1.mjs`: `POST /auth/guest` thân là mảng 20 000 object `{"a":1}` (156 KB): 1019 ms; mảng 50 000 (391 KB): 1518 ms; trong lúc đó `/health` trễ 1306 ms.
  - `dos2.mjs`: `POST /affiliate/click` (public), một object có N khoá lạ: N=20 000 (204 KB) 3258 ms; N=100 000 (1063 KB) **111 407 ms**; N=200 000 làm lane đứng ~10 phút.
  - `dos3.mjs`: `POST /orders/<id>/return-estimate` (có đăng nhập), `items` 30 000 phần tử (1102 KB): 21 653 ms rồi mới trả 400 "tối đa 100 mục".
  - `bench.cjs` (đo riêng bước transform, không cần mạng): n=2 500 330 ms, 5 000 352 ms, 10 000 1314 ms, 20 000 4456 ms; còn bước validate và translate chỉ vài ms.
- PROD không có chặn thêm ở rìa: `ops/vietnix-vhost-api.conf.phase2` và `vietnix-vhost-app.conf.phase2` không có `LimitRequestBody`, Cloudflare gói thường cho tới 100 MB. Chưa kiểm trên PROD thật (cấm).
- Tái hiện (lane 6, chỉ chạy bản đã cắt cỡ): `cd docs/2026-11-03-golive/audit/baomat-probes && node dos1.mjs && node dos2.mjs && node dos3.mjs`.
- Sửa: (1) hạ giới hạn body mặc định xuống 100 KB (mẫu có sẵn: `app.use('/api/events', json({limit:'512kb'}))`), chỉ nới `8mb` cho các route nhận ảnh base64 (feed, đổi trả, đánh giá, gian hàng/nhãn, upload admin); (2) thêm một middleware O(n) sau `json()` từ chối thân có object quá ~200 khoá hoặc mảng quá ~500 phần tử hoặc lồng quá ~10 tầng, trước khi tới `ValidationPipe`; (3) đặt `LimitRequestBody` cho `/api` ở vhost Apache. Chỉ hạ body thôi chưa đủ: 256 KB khoá lạ vẫn tốn ~4 s mỗi request.
- Công sức M.

### BAOMAT-02 (P1, api, owner 2a, cần chủ quyết) Khách guest đăng bài cộng đồng kèm 6 ảnh "giả" 600 KB; không kiểm nội dung ảnh; không giới hạn số tài khoản

- `apps/api/src/common/uploaded-image.ts:24-26,50-53` chỉ kiểm chuỗi bằng regex `^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$` và độ dài (`PUBLIC_CONTENT_MAX_DATA_URL_LENGTH = 700_000`), không giải mã, không kiểm chữ ký tệp. `modules/feed/feed-images.ts` cho `MAX_FEED_IMAGES = 6`.
- Probe `feed1.mjs`: khách guest vừa tạo bằng `/auth/guest` gửi `POST /feed` với 6 chuỗi `data:image/png;base64,` + `A` x 600 000 (~3.6 MB) trả `201 {"status":"PENDING"}`; bài hiện trong `GET /feed/:id` của chính khách với `images: 6`. Giới hạn đăng 5/phút (`community-feed.controller.ts:228`) cho 4 bài lọt trong đợt thử.
- Hệ quả: mỗi guest ghi được ~18 MB/phút vào Postgres (ảnh lưu base64 trong `feed_posts.images`); `/auth/guest` cho 30 tài khoản mới/phút/IP (`authIp`), nên giới hạn theo tài khoản gần như không có tác dụng. Bài PENDING còn nằm trong hàng chờ kiểm duyệt. Ảnh giả được phục vụ lại với `Content-Type: image/png` (`feed2.mjs`: chủ bài, khách khác và ẩn danh đều đọc được ảnh PENDING qua link có `?v=<md5>`; đó là thiết kế "capability", tôi không báo lại).
- Sửa: giải mã và kiểm chữ ký (PNG/JPEG/WebP) khi nhận; giới hạn tổng số ảnh/dung lượng bài PENDING và bài trong 24 h theo khách; cân nhắc yêu cầu `REAL_USER_WHERE` (đã đăng nhập Zalo/SĐT) mới được đăng bài kèm ảnh. Mục cuối đụng quy tắc sản phẩm nên cần chủ quyết; hai mục đầu không.
- Công sức M.

### BAOMAT-03 (P2, api, owner 2a) Ký tự NUL (`%00`) trong đường dẫn, query hoặc body gây 500 ở ít nhất 20 route

- Postgres không nhận byte 0x00 trong text; Prisma ném lỗi không có `code` ổn định, `PrismaExceptionFilter` (`common/filters/prisma-exception.filter.ts`, nhánh `!(exception instanceof PrismaClientKnownRequestError)`) trả 500 `INTERNAL_ERROR` và gọi `capturePrismaError` (Sentry).
- Probe `nul.mjs` (token guest): 500 ở `GET /orders/%00`, `/products/%00`, `/products/a%00b/reviews`, `/group-buy/%00`, `/storefront/public/%00`, `/brand/public/%00`, `/campaigns/%00`, `/feed/%00`, `/payments/bank-qr/%00`, `DELETE /me/addresses/%00`, `/products?q=%00`, `?category=%00`, `?brand=%00`, `/flash-sales/slots/%00/items`, `/reviews/%00`, và body `POST /cart/coupon`, `PATCH /me`, `POST /me/addresses` có `\u0000`.
- Hệ quả: một vòng lặp 1 dòng tạo hàng nghìn sự kiện Sentry giả và làm tỷ lệ 500 trên PROD méo, che lỗi thật. Không lộ dữ liệu.
- Sửa: middleware trước pipe từ chối 400 khi URL đã giải mã, query hoặc chuỗi trong body chứa `\u0000`; hoặc ánh xạ lỗi Postgres `22021` ("invalid byte sequence") thành 400 trong filter. Thêm test `nul.spec`.
- Công sức S.

### BAOMAT-04 (P2, web1280/web375, owner 2a, cần chủ quyết phần bật chặn) CSP chỉ ở chế độ Report-Only và không có nơi nhận báo cáo

- `apps/web/next.config.mjs:46-52` định nghĩa `cspReportOnly`, `:106` gắn header `Content-Security-Policy-Report-Only`. Không có `report-uri` hay `report-to` (grep chỉ ra dòng 38, 46, 106). Lời chú thích (dòng 38-41) nói chờ "soi báo cáo vi phạm trên môi trường thật" rồi mới bật chặn, nhưng không có báo cáo nào về đâu cả, nên điều kiện đó không bao giờ xảy ra. Trong lúc đó `script-src 'self' 'unsafe-inline' 'unsafe-eval'` và `img-src ... https:` đã khá rộng.
- Các header khác đạt: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; HSTS có ở vhost app (`ops/vietnix-vhost-app.conf.phase2`). Chỉ đọc cấu hình, chưa đo header thật trên web (xem phần chưa kiểm).
- Sửa: thêm `report-to`/`report-uri` trỏ về một endpoint (kể cả Sentry CSP report URL) ngay bây giờ; sau 1 đến 2 tuần dữ liệu thì chủ quyết bật chặn; về lâu dài bỏ `'unsafe-eval'` và dùng nonce.
- Công sức S (thêm báo cáo), M (nonce).

### BAOMAT-05 (P2, api, owner 2a) `avatarUrl` nhận mọi URL http/https; ảnh hiện cho người khác xem

- `apps/api/src/modules/users/dto/update-me.dto.ts:15-18`: chỉ `@IsUrl({require_protocol:true})` và `@MaxLength(1000)`. Spec `update-me.dto.spec.ts:7-11` nói chủ ý là "chỉ lưu URL Cloudinary/Zalo" nhưng mã không giới hạn host.
- Probe `fuzz2.mjs`: `PATCH /me` với `https://evil.example/a.png` trả 200; `http://169.254.169.254/` trả 200; `javascript:` và `data:` bị 400.
- `avatarUrl` hiện ở feed và bảng xếp hạng (theo chú thích spec), nên ảnh từ host bất kỳ được trình duyệt người xem tải: lộ IP của người xem cho kẻ đặt URL (tracking pixel), có thể đổi nội dung ảnh sau khi qua kiểm duyệt, và `http:` gây mixed content trên web https. Không phải SSRF phía server vì `/img` chặn host lạ.
- Sửa: chỉ nhận https và host thuộc danh sách đã có (`UPLOAD_IMAGE_HOSTS`, hàm `isUploadedMediaUrl` ở `common/uploaded-image.ts`) cộng host CDN avatar của Zalo; đồng bộ với test spec.
- Công sức S.

### BAOMAT-06 (P2, api, owner db) Webhook Zalo OA chỉ xác thực bằng token tĩnh, còn TODO chưa chốt cách xác thực chính thức

- `apps/api/src/modules/integrations/zalo-oa/zalo-oa-webhook.controller.ts:38` có TODO ghi rõ có thể phải là HMAC; controller dùng `@SkipThrottle()` và header `x-webhook-token` tĩnh. Trong khi đó `users/zalo-consent-webhook.controller.ts` đã có kiểm chữ ký sự kiện (`zaloEventSignature`) cùng API, có thể dùng lại.
- Hiện fail-closed (không có token đúng thì 401), nên chưa lộ gì; rủi ro là Zalo không gửi được token tuỳ chỉnh thì webhook không chạy lúc bật `chat.enabled`, hoặc lộ token trong cấu hình thì ai cũng bơm được tin giả vào hàng chờ auto-reply.
- Sửa: kiểm `X-ZEvent-Signature` (sha256 của `appId + body + timestamp + oaSecretKey`) như webhook đồng ý nhận tin; giữ token tĩnh làm lớp phụ. Làm trước khi bật `chat.enabled`.
- Công sức S.

### BAOMAT-07 (P3, api, owner 2a) Địa chỉ giao hàng không giới hạn số lượng

- `modules/users/users.service.ts:115-130` `createAddress` chỉ dùng `count` để quyết định mặc định, không có trần. Probe `caps.mjs`: tạo được 30 địa chỉ liên tiếp không bị từ chối (dừng ở 30 vì tôi tự giới hạn). Với throttle mặc định 300/phút, một tài khoản tạo ~18 000 dòng/giờ; `GET /me/addresses` sẽ trả toàn bộ.
- Sửa: trần 20 địa chỉ mỗi khách, trả 400 "Bạn đã lưu đủ 20 địa chỉ, hãy xoá bớt" trong cùng khoá advisory.
- Công sức S.

### BAOMAT-08 (P3, api, owner 2a) Phản hồi JSON có dữ liệu cá nhân thiếu `Cache-Control: private, no-store`

- Probe `hdr.mjs` (token guest): `/me`, `/orders`, `/me/addresses`, `/cart`, `/me/wallet`, `/group-buy`, `/products/for-you` trả 200 với `cache-control=null` và `etag` (Vary chỉ có `Origin`). Chỉ `/home/me` và `/flash-sales/upcoming` có `private, no-store`. Quy ước trong `common/decorators/public-cache.decorator.ts` là route theo người dùng tự khai báo no-store, nhưng phần lớn chưa khai báo.
- Hệ quả thấp: Cloudflare mặc định không cache JSON và route đã yêu cầu `Authorization`; rủi ro là bộ nhớ đệm trình duyệt/proxy trên máy dùng chung và nút Back sau khi đăng xuất.
- Sửa: một interceptor/middleware toàn cục đặt `Cache-Control: private, no-store` cho mọi route không gắn `@PublicCache`.
- Công sức S.

### BAOMAT-09 (P3, api, owner 2a) `PATCH /me` nhận `fullName` có `<` và `>`, khác với địa chỉ

- Probe `fuzz2.mjs`: `fullName: "<img src=x onerror=alert(1)>"` trả 200 và `GET /me` trả lại nguyên văn. Địa chỉ thì từ chối (`"Tên người nhận và địa chỉ không được chứa ký tự < hoặc >."`). React/Next escape nên không XSS trên Mini/web, nhưng tên này chảy tới email vận hành (`modules/ops/ops-email.ts`), xuất CSV, ZNS và admin; chưa kiểm từng nơi có escape (xem chưa kiểm).
- Sửa: dùng cùng quy tắc `<`/`>` như địa chỉ cho `fullName`.
- Công sức S.

### BAOMAT-10 (P3, api, owner 2a) `SaveTemplateDto` của đại lý không có trần số phần tử và độ dài

- `apps/api/src/modules/dealer/dealer.controller.ts:30-37`: `name` chỉ `@IsString()`, `items` có `@ArrayNotEmpty()` nhưng không `@ArrayMaxSize` hay `@MaxLength`. Chỉ vai trò đại lý gọi được, nên mức thấp; cùng họ với BAOMAT-01 nhưng sau khi sửa BAOMAT-01 vẫn nên có trần.
- Sửa: `@MaxLength(120)` cho `name`, `@ArrayMaxSize(100)` cho `items`.
- Công sức S.

## Đã kiểm và đạt (không báo lỗi)

- Mặc định từ chối: `dump-routes.cjs` + `sweep2.mjs` quét 612 route (thực tế đã đăng ký) với và không có token: 0 bất thường về `@Public`/mặc định 401; quét kiểm quyền theo vai (`sweep2.mjs`) 0 bất thường. `RolesGuard` và `JwtAuthGuard` toàn cục.
- IDOR giữa hai khách tự tạo (`idor1-3.mjs`): người lạ đọc/huỷ/mua lại/đổi trả/lấy QR ngân hàng của đơn: 404; sửa/xoá địa chỉ người khác: 403; sửa/xoá mục giỏ người khác: 404 (`DELETE /cart/items/:id` trả 200 nhưng là giỏ rỗng của chính người gọi; kiểm lại giỏ nạn nhân vẫn còn 1 mục); đánh dấu đã đọc thông báo người khác: `{"ok":false}`; chọn đích hoàn tiền của người khác: 404; đơn `CONFIRMED` của nạn nhân không đổi. Đọc `replayIdempotentOrder` (`checkout.service.ts:828`) có kiểm `existing.userId`.
- Giới hạn tốc độ đo thật (`thr1.mjs`, `cpn.mjs`): đăng nhập cùng thiết bị 429 từ lần 11 (kèm `Retry-After: 60`); 34 thiết bị mới từ cùng IP bị chặn sau ~16 (trần IP 30/phút gộp mọi lệnh gọi auth); `/auth/refresh` token sai 429 từ lần 11; `/auth/zalo-mini-app` 429 từ lần 11; `/cart/coupon` và `/coupons/claim` 429 từ lần 11. Place-order 10/phút (đọc `checkout.controller.ts`).
- Kiểm tra đầu vào (`fuzz1.mjs`, `fuzz2.mjs`): số lượng -1/0/1.5/1e9/"5", trường lạ (`price`), `variationId` là object, trang/limit lớn hoặc NaN, `q` 10 000 ký tự, SĐT sai, địa chỉ 100 000 ký tự, `<`/`>` trong tên người nhận, email sai: đều 400 với câu tiếng Việt, không có 500 ngoài BAOMAT-03. `__proto__` trong giỏ trả 201 nhưng không ảnh hưởng (whitelist loại bỏ).
- Phiên (`auth1.mjs`): access token 15 phút, `alg:none` 401, payload admin giả 401, bearer rác 401, `Bearer` rất dài trả 431; refresh có xoay vòng và cửa sổ cho phép dùng lại ngắn (thiết kế); access token còn hiệu lực tới hết hạn sau khi đăng xuất (không trạng thái, 15 phút).
- Webhook đều đóng khi sai: Pancake, Gomdon (`timingSafeEqual`, token trong đường dẫn nhưng `redact-url.ts` che trước khi ghi log), Zalo đồng ý nhận tin (HMAC), cashback AccessTrade, cầu nối chat (`bridge-events.controller.ts`).
- `/img` (SSRF): allowlist host, đăng ký DB, chặn IP riêng ở cấp DNS (`catalog/image-resize.ts`). Ảnh đổi trả và ảnh bài cộng đồng đi qua mã `v` (md5) làm capability, đã gỡ thì 404 (`feed3.mjs`).
- Khoá/bí mật trong bundle: grep `apps/miniapp/www` và bundle web không có khoá riêng; `x-throttle-bypass` chỉ có ở server (`lib/core-http-server.ts`).
- Web: refresh token ở cookie HttpOnly `tubu_rt` (Path `/api/auth`, cần `x-client: web`), PKCE + `state` (`lib/auth-context.tsx`), `safeReturnPath` chặn open redirect (`lib/return-to.ts`); Mini chỉ mở link ngoài tới `zalo.me` (`services/zmp-bridge.ts`).
- Lỗi 429 trên web hiển thị đúng chữ (`lib/error-text.ts`).
- Log/PII: `PrismaExceptionFilter` che URL bí mật; `scrubEvent` ở `config/sentry.ts`. 404 không lộ stack; Swagger chỉ khi không phải production.

## Ảnh đã xem (Mini 375, lane 5, persona `returning`)

- `docs/2026-10-28-review/screens/mini375/settings__returning__mini375__s1.png`
- `docs/2026-10-28-review/screens/mini375/edit-profile__returning__mini375__s1.png`
- `docs/2026-10-28-review/screens/mini375/addresses__returning__mini375__s1.png`
- `docs/2026-10-28-review/screens/mini375/wallet__returning__mini375__s1.png`
- `docs/2026-10-28-review/screens/mini375-error500/addresses__returning__mini375-error500__s1.png`
- `docs/2026-10-28-review/screens/mini375-longtext/addresses__returning__mini375-longtext__s1.png` (chỉ thấy khung xương, không dùng được vì máy quá tải)

Không thấy lỗi bảo mật hay lộ dữ liệu cá nhân trên các ảnh này (SĐT hiện đầy đủ ở màn Địa chỉ của chính chủ là đúng).

## Chưa kiểm được

- Web 375 và web 1280: máy tải (load average 89 đến 147) nên web lane 5 (3252) và lane 6 (3262) không trả lời trong 30 đến 90 s; tôi dừng tiến trình chụp của chính mình. Mọi nhận xét về header web chỉ dựa trên đọc `apps/web/next.config.mjs` và `middleware.ts`, chưa đo header thật.
- Rìa PROD thật: header Apache/Cloudflare thật, CORS thật (lane chạy `NODE_ENV=development` nên phản chiếu mọi origin; mã production dùng regex Zalo + `*.tubutree.com`, `bootstrap.ts:94-110`), giới hạn kích thước body ở rìa. Cấm đọc PROD.
- Ràng buộc app-id của đăng nhập Zalo và cấu hình preset Cloudinary: không có khoá thật ở lane.
- Chat CSKH và `waste.*`: cờ PROD đang tắt, chỉ đọc mã, chưa gọi thật; admin, affiliate, wallet, waste, loyalty, garden, cron, ZNS, Pancake, data-retention thuộc phiên db, tôi chỉ ghi nhận BAOMAT-06.
- Nơi `fullName` chảy tới (email vận hành, CSV, admin) chưa kiểm từng chỗ có escape hay không.
- Chưa thử upload ảnh qua đường admin/đại lý/nhãn (chỉ ảnh bài cộng đồng).
