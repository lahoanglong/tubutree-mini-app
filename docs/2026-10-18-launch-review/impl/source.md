# Gói `source`: đo nguồn khách (nhánh `lr/source`)

Mục tiêu: biết khách đến từ đâu (sàn, thẻ trong hộp hàng, OA, link bio, CTV) để chủ dự án đánh giá chiến dịch kéo khách từ sàn về app có hiệu quả không. Phát hiện gốc: D2-01, D4-007, D3-06, D3-17.

Mã nguồn mặc định: `shopee`, `lazada`, `tiktok`, `fb`, `oa`, `linkbio`, `ctv`, `card-<đợt>`. Mã khác vẫn nhận nếu khớp `^[a-z0-9][a-z0-9_-]{0,39}$` (chữ thường không dấu, số, `_`, `-`, tối đa 40 ký tự, bắt đầu bằng chữ hoặc số).

## 1. Đã làm gì (theo ID), file chính

### D2-01: nguồn khách chạm đầu và nguồn của từng phiên

Miniapp đọc `src`, `utm_source`, `utm_medium`, `utm_campaign`, `card` một lần lúc mở app. Nguồn (`entrySource`) và chiến dịch (`campaign`) đi trong phong bì của mọi sự kiện analytics. Lần chạm đầu được lưu trên máy (không bao giờ ghi đè) và gửi kèm khi tạo tài khoản. API ghi ba cột mới trên `User` đúng một lần.

Thứ tự chọn nguồn: `src`, rồi `utm_source`, rồi `card=<đợt>` (thành `card-<đợt>`), rồi ngầm hiểu từ dạng link (`?s=` hoặc `?l=` thành `ctv`, chỉ có `?ref=` thành `ref`). Không có gì dùng được thì phiên tính là `organic`. Tham số bẩn bị bỏ im lặng, không bao giờ làm hỏng việc mở app, đăng nhập hay một lô sự kiện analytics.

- API, lưu trữ: `apps/api/prisma/schema.prisma` (`User.firstTouchSource`, `firstTouchCampaign`, `firstTouchAt`, đều nullable; `AnalyticsEvent.campaign`), migration `apps/api/prisma/migrations/20261018120000_lr_source_first_touch/migration.sql`. Gói còn một migration thứ hai cho D3-06: `20261018130000_lr_source_click_dedupe` (xem mục D3-06).
- API, kiểm tra và lọc đầu vào: `apps/api/src/common/attribution.ts` (khuôn nguồn, `sanitizeFirstTouch`, `firstTouchColumns`). Thời điểm chạm do máy khách khai: cũ hơn 90 ngày thì bỏ cả lần chạm (không gán giờ máy chủ, vì một bản lưu cũ không phải lần chạm dẫn tới việc đăng ký lúc này); thiếu, không đọc được hoặc lệch đồng hồ quá 10 phút về tương lai thì dùng giờ máy chủ.
- API, ghi một lần: `apps/api/src/modules/auth/auth.service.ts`. Mọi đường tạo user (khách, Mini App kể cả lần thử lại không số điện thoại, OAuth web) ghép `...firstTouchColumns(firstTouch)`. Khi gộp khách vào tài khoản (`mergeGuestInto`), cột của khách chỉ chép sang tài khoản đích nếu đích còn trống, đọc và ghi trong cùng giao dịch đang khoá `FOR UPDATE` cả hai dòng nên không có cửa đua.
- API, DTO: `auth.controller.ts`, `dto/zalo-login.dto.ts`, `dto/zalo-oauth.dto.ts` nhận `firstTouch` (`@IsOptional() @Allow()` vì pipe toàn cục có `forbidNonWhitelisted`; giá trị bẩn được `sanitizeFirstTouch` bỏ chứ không trả 400). `analytics/dto/ingest-events.dto.ts` nhận `campaign` (`entrySource` đã có sẵn); `analytics.controller.ts` chuẩn hoá cả hai nên một thẻ bẩn không làm hỏng cả lô 50 sự kiện.
- API, `order_placed`: `apps/api/src/modules/checkout/checkout.service.ts` (diff 2 dòng) đưa chạm đầu của người đặt vào `props.firstTouchSource` và `props.firstTouchCampaign`. Cố ý không dùng `entrySource`/`campaign` của phong bì: ở sự kiện client hai trường đó là nguồn của PHIÊN, còn `order_placed` do máy chủ ghi và không có phiên.
- Miniapp: `src/utils/entry-source.ts` (parser, đọc URL đúng một lần vì ZMPRouter đổi URL theo từng màn), `src/services/first-touch.ts` (lưu và đọc chạm đầu qua ZMP storage; không bao giờ ném lỗi; chặn đăng nhập tối đa 500ms vì lần ghi không được đợi; đọc lỗi hoặc quá 500ms thì rơi về nguồn của lần mở này và không ghi xuống máy để khỏi đè chạm đầu thật chưa đọc được; bản đã lưu quá 90 ngày bị bỏ và xoá), `src/services/analytics.ts` (`trackEvent` gắn nguồn và chiến dịch, `trackAppOpened`), `src/services/api.ts` và `src/store/auth.ts` (gửi `firstTouch` khi đăng nhập hoặc tạo khách mới; đường làm mới token không đụng tới). `src/components/app.tsx` chỉ đổi một dòng gọi `trackAppOpened()` (và thêm `reportLaunchLinkClick()` cho D3-06).
- Web: `apps/web/src/lib/entry-source.ts` (cùng khuôn parser; nhận dạng gian hàng thành `ctv` qua đường dẫn `/s/<slug>` hoặc qua subdomain `<slug>.<miền>`, dùng `src/lib/tenant-subdomain.ts` chung với `src/middleware.ts` vì middleware rewrite `/` sang `/s/<slug>` phía máy chủ nên trình duyệt chỉ thấy `/`; địa chỉ IP và subdomain hệ thống `www|admin|api|app|mail` không tính; cookie `tubu_ft` 30 ngày, `path=/`, `SameSite=Lax`, `Secure` trên https, cố ý không HttpOnly vì API có thể khác origin và phải đọc bằng JS), `src/components/entry-source-capture.tsx` gắn trong `src/app/layout.tsx`, `src/lib/auth-context.tsx` (gửi cookie trong body `/auth/zalo-oauth`).
- Web chưa có analytics phía client, nên theo đúng yêu cầu chỉ làm phần chạm đầu (cookie + gửi lúc đăng nhập), không phát `app_opened`/`page_view`.

### D4-007: mã giới thiệu trên nút chia sẻ

`src/utils/share-link.ts` có `withReferral(path, code)` (thêm `ref=` đúng chỗ `?` hoặc `&`, giữ fragment, giữ `ref` đã có, bỏ mã sai khuôn). Dùng trong `src/pages/product-detail.tsx` (đường dẫn Mini App và liên kết web dự phòng) và `src/pages/group-buy.tsx` (đường dẫn, và dòng văn bản dự phòng thêm "Mã giới thiệu của mình: <mã>"). Không có nút chia sẻ bài viết cộng đồng trong code nên không thêm; helper dùng lại được nếu sau này có. `pages/game.tsx` không đụng.

### D3-17: storefront dùng `referralCode` của API

`src/pages/storefront-view.tsx` truyền `sf.referralCode` (không còn dùng slug) vào `setSfContext` và `ShareSheet`; `src/services/storefront-api.ts` thêm kiểu `referralCode`. Giữ nguyên `kind: 'ctv'`: lần theo mã cho thấy `kind` này còn điều khiển quay lui về `/s/:slug` cả với gian hàng đối tác (MERCHANT), đổi sẽ vỡ điều hướng.

### D3-06: đếm click link CTV

Route công khai `POST /affiliate/click` (`apps/api/src/modules/affiliate/affiliate.controller.ts`), giới hạn 30 lần mỗi phút với bộ đếm cố định theo IP (`getTracker`; mặc định của guard toàn cục đếm theo userId khi có JWT nên một tài khoản bất kỳ gửi kèm token sẽ né được trần theo IP), gọi `trackClick` sẵn có (`affiliate.service.ts`, `recordLinkClick`). IP chỉ lưu dạng HMAC-SHA256 với khoá của máy chủ (`src/common/ip-hash.ts`): sha256 trần của IPv4 dò ngược được bằng vét cạn. Khoá suy ra từ `JWT_ACCESS_SECRET` theo nhãn mục đích nên không thêm biến môi trường và `GO-LIVE-KEYS.md` không đổi; chưa cấu hình (dev/test) thì dùng khoá dev cố định. Khử trùng phía máy chủ: mỗi (mã link, IP băm, ngày giờ VN) đếm một lần nhờ ràng buộc duy nhất mới trên `affiliate_clicks` (cột `dedupeDay`, migration `20261018130000_lr_source_click_dedupe`); lần thứ hai vi phạm khoá, giao dịch hoàn tác luôn phần +1 `clicks`, và không có truy vấn đọc nào vào bảng đang đánh dấu `@deprecated` (chỉ ghi). Miniapp (`src/services/affiliate-api.ts`, `reportLaunchLinkClick`) báo một lần mỗi phiên khi link mở app có `?l=<mã>`; web (`src/lib/link-click.ts`) báo một lần mỗi phiên trình duyệt cho mỗi mã (cờ trong `sessionStorage`). Lỗi mạng bị nuốt, không ảnh hưởng người dùng.

### Sửa theo review Opus (mỗi mục một commit)

1. Throttle `/affiliate/click` đếm theo IP và khử trùng phía máy chủ theo (mã link, IP băm, ngày VN): `fb62365e`.
2. Băm IP bằng HMAC với khoá máy chủ, không dùng sha256 trần: `b18b7e7a`.
3. Chạm đầu quá 90 ngày thì bỏ (API trả null, miniapp xoá bản cũ): `b0698c06`.
4. Chạm đầu không chặn đăng nhập quá 500ms; lỗi hoặc quá hạn storage rơi về nguồn của phiên: `47f3c6ad`.
5. `order_placed` mang chạm đầu trong `props`, không vào phong bì: `ac8c84fc`.
6. Gian hàng mở bằng subdomain tính `ctv`: `72e02054`.
7. Ghi rõ ảnh hưởng số liệu của việc gộp khách gắn nguồn cho tài khoản cũ: mục 3 bên dưới. Phần "link của khách thường cướp ghi công CTV" thuộc gói commission (`checkout/attribution.ts`, `recordTouch`), không sửa ở đây.

## 2. Lệnh kiểm chứng và kết quả

Môi trường: `export PATH=$HOME/.local/node/node-v22.23.3-darwin-arm64/bin:$PATH`, Postgres `lr-source-pg` cổng 5563, DB `tubutree_it`. Không chạy full suite, build hay Playwright (máy dùng chung đang rất tải, load average 28–150).

| Việc | Lệnh | Kết quả |
|---|---|---|
| Jest API (common, auth, analytics, checkout service, affiliate) | `cd apps/api && npx jest src/common src/modules/auth src/modules/analytics src/modules/checkout/checkout.service.spec.ts src/modules/affiliate` | `Test Suites: 51 passed, 51 total` / `Tests: 959 passed, 959 total` |
| Race: chạm đầu, gộp khách, click link CTV, affiliate, analytics, checkout (đụng `order_placed`) | `npx jest -c test/integration-race/jest.config.js --runInBand` với `first-touch-source`, `auth-merge-guest`, `affiliate-link-click`, `affiliate`, `analytics-atomicity`, `r6-checkout`, `r9-ctv-checkout` | 7 suite `PASS` (`affiliate-link-click`: 3 test, 8 request song song cùng IP chỉ đếm 1) |
| Race: gộp 4 khách | `r12-merge-four-guests.race-spec.ts` | `PASS`, `Tests: 2 passed, 2 total` lúc load ~28; hỏng 503 khi load ~45 (xem ghi chú dưới) |
| Migration áp sạch | `npx prisma migrate status` trên cổng 5563 | `188 migrations found in prisma/migrations` / `Database schema is up to date!` |
| Drift = 0 | `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` | `No difference detected.` (exit 0) |
| Vitest miniapp (mọi spec đổi trong nhánh) | `cd apps/miniapp && npx vitest run <10 spec đổi>` | `Test Files  10 passed (10)` / `Tests  184 passed (184)` |
| Vitest miniapp (spec liền kề app, storefront, product-detail, group-buy) | `npx vitest run src/components/app src/pages/storefront src/pages/product-detail src/pages/group` | `Test Files  11 passed (11)` / `Tests  107 passed (107)` |
| Vitest web (mọi spec đổi) | `cd apps/web && npx vitest run <5 spec đổi>` | `Test Files  5 passed (5)` / `Tests  92 passed (92)` |
| Vitest web (auth, layout) | `npx vitest run src/lib/auth src/app/layout` | `Test Files  3 passed (3)` / `Tests  16 passed (16)` |
| tsc 3 app | `npx tsc --noEmit` trong `apps/api`, `apps/miniapp`, `apps/web` | không có lỗi |
| eslint file đổi | `npx eslint <file .ts/.tsx đổi>` trong từng app | không có cảnh báo |

Test mới đáng chú ý: parser miniapp 58 ca, parser web 59 ca (kể cả subdomain gian hàng), `tenant-subdomain.spec.ts` 17 ca, `ip-hash.spec.ts`, `attribution.spec.ts` 41 ca, nhóm "nguồn chạm đầu ghi MỘT lần" trong `auth.service.spec.ts` (tạo mới, giá trị bẩn bị bỏ, tài khoản có sẵn không bị ghi đè, Mini App, thử lại sau P2002, OAuth, gộp khách), `first-touch-source.race-spec.ts` trên Postgres thật (tạo, bẩn, gộp vào đích trống, gộp vào đích đã có, cả hai trống).

Ghi chú về `r12-merge-four-guests.race-spec.ts`: khi load average từ ~41 trở lên (máy dùng chung) spec này bị 503 "Hệ thống đang bận" do `lock_timeout`; ở lần đầu đã đối chứng bằng cách chạy bản `auth.service.ts` gốc (HEAD trước khi sửa): cũng hỏng y hệt, nên là do môi trường quá tải, không phải do thay đổi này. Chạy lại lúc load ~28 thì xanh (dòng "PASS" ở bảng trên), cả sau đợt sửa theo review.

Quy trình TDD: các test mới viết trước, đỏ rồi mới viết mã (ví dụ nhóm test chạm đầu của `auth.service.spec.ts` đỏ 6 ca trước khi có mã).

## 3. Chưa làm hoặc cố ý để lại

- **Web không phát `app_opened`/`page_view`**: web chưa có analytics phía client, theo yêu cầu chỉ làm chạm đầu. Hậu quả: lượt vào web không tự hiện trong bảng sự kiện, chỉ thấy khi người đó đăng nhập (qua `firstTouchSource`).
- **`order_placed` mang chạm đầu (trong `props`), không mang nguồn phiên**, và chỉ ở checkout thường (không có ở subscription hay đơn CTV lên hộ). Với chủ dự án câu hỏi "đơn này đến từ kênh nào" nên trả lời bằng chạm đầu của người mua; nếu cần nguồn của đúng phiên đặt hàng thì phải gửi thêm từ miniapp (chưa làm).
- **Tài khoản cũ không được điền bù**: tài khoản đã tồn tại trước migration có `firstTouchSource = null` và không bao giờ được ghi sau này (đúng yêu cầu "ghi một lần khi trống lúc tạo hoặc gộp"; ngoại lệ duy nhất là gộp khách có chạm đầu vào tài khoản còn trống, xem điểm kế tiếp).
- **Gộp khách gắn nguồn mới cho tài khoản cũ có chạm đầu trống** (`apps/api/src/modules/auth/auth.service.ts`, `mergeGuestInto`, khối `...(!lockedTarget.firstTouchSource && g.firstTouchSource ? ...)`): một tài khoản đã có từ trước migration (hoặc từ trước khi app gửi chạm đầu) mà sau này gộp với một thiết bị khách có chạm đầu sẽ nhận nguồn và giờ chạm của thiết bị đó. Chấp nhận, vì nếu không thì khách cũ quét thẻ hộp hàng sẽ không bao giờ được tính. Ảnh hưởng số liệu: `firstTouchSource` của tài khoản cũ có thể là nguồn chạm SAU ngày tài khoản được tạo, nên báo cáo "doanh thu theo nguồn" có thể quy cả các đơn mua trước lần chạm đó cho nguồn này và làm nguồn đó trông hiệu quả hơn thực tế. Cách giảm trong báo cáo: chỉ tính đơn có `orders.createdAt >= users.firstTouchAt` (đã làm trong câu SQL ở mục 5). Tài khoản có chạm đầu ghi lúc tạo không bị ảnh hưởng.
- **Không có màn báo cáo nguồn trong admin**: ngoài phạm vi (`apps/web/src/app/admin/page.tsx` và `engagement-tab.tsx` đang do phiên khác sửa). Hiện đọc bằng SQL (xem mục 5).
- **Click link CTV**: mỗi (mã link, IP, ngày VN) chỉ đếm một lần (khử trùng phía máy chủ bằng khoá duy nhất, cộng với "một lần mỗi phiên" ở máy khách), nên nhiều người dùng chung một IP (Wi-Fi quán, CGNAT 4G) trong cùng ngày chỉ được đếm là một: số click là cận dưới của số người mở, không phải số người duy nhất. Không cộng `conversions`.
- **`utm_source=facebook` không được gộp thành `fb`**: nhận nguyên giá trị hợp lệ. Muốn gộp thì phải thống nhất bảng đồng nghĩa (xem câu hỏi 3).
- **Cookie web theo từng host**: `tubu_ft` chỉ có trong trình duyệt và host đã vào (không đặt `Domain`). Khách vào gian hàng CTV bằng subdomain `<slug>.<miền>` rồi đăng nhập ở host khác (ví dụ `app.<miền>`) sẽ không mang theo nguồn `ctv`. Muốn chia sẻ giữa các subdomain thì đặt `Domain=.<miền>` cho cookie (cần chốt tên miền gốc ở cấu hình, chưa làm).
- **Nút chia sẻ bài viết cộng đồng**: không tồn tại trong code nên không thêm.
- **Ensure-phone DTO** cố ý không nhận `firstTouch` (đường này chỉ gắn số điện thoại cho tài khoản đã có).
- Prisma client đã sinh lại cục bộ trong worktree (`npx prisma generate`), file sinh ra không nằm trong commit.

## 4. Câu hỏi cho chủ dự án (kèm mặc định đã dùng)

1. **Hoa hồng và nút chia sẻ**: nút chia sẻ sản phẩm và mua chung giờ gắn `ref=<mã giới thiệu>` của bất kỳ ai đang đăng nhập, kể cả khách thường. Mã `ref` này dẫn tới `referredById` lúc tạo tài khoản, `order.referrerUserId` và `createCommissionForOrder`, mà hàm này không kiểm vai trò người giới thiệu. Nghĩa là khách thường chia sẻ link rồi người nhận mua hàng có thể sinh hoa hồng. Mặc định: giữ nguyên hành vi hoa hồng, không đổi. Cần chủ dự án xác nhận đây là mong muốn (chương trình giới thiệu bạn bè) hay chỉ CTV mới được hưởng; nếu chỉ CTV thì sửa ở phía hoa hồng chứ không ở nút chia sẻ.
2. **Danh sách mã nguồn**: mặc định nhận mọi mã đúng khuôn, không cố định danh sách. Có muốn khoá danh sách (từ chối mã lạ) để tránh in nhầm chính tả như `shopee`/`shope` thành hai kênh? Mặc định: không khoá.
3. **Gộp tên đồng nghĩa** (`facebook`→`fb`, `zalo`→`oa`...): mặc định không gộp. Nên chốt một cách viết duy nhất khi in QR (mục 5).
4. **Điền bù tài khoản cũ**: mặc định không. Tài khoản trước migration sẽ nằm ở nhóm "không rõ nguồn" trong mọi báo cáo.
5. **Link CTV từ bộ nội dung (content kit)** hiện chỉ có `?ref=` nên được tính nguồn `ref`, không phải `ctv`. Mặc định: giữ vậy; nếu muốn tính `ctv` thì thêm `src=ctv` khi sinh link (`apps/api/src/modules/content-kit/content-kit.service.ts`, ngoài phạm vi gói này).
6. **Link gian hàng `?s=`** được tính `ctv` kể cả gian hàng đối tác (MERCHANT) vì dạng link giống nhau. Mặc định: chấp nhận; muốn tách thì thêm `src=` rõ ràng vào link của đối tác.

Rủi ro chưa kiểm chứng trên thiết bị thật: **tham số trên link `zalo.me/s/<appId>/...?src=...` có tới được `window.location` trong webview Zalo hay không**. Code đọc cả `location.search` lẫn phần sau `?` của `location.hash`. Cần quét thử QR trên điện thoại thật (UAT) trước khi in hàng loạt; nếu tham số không tới, phải đổi sang đọc qua zmp-sdk (việc nhỏ, chỉ sửa `getSessionAttribution` trong `src/utils/entry-source.ts`).

## 5. Cách in QR/link cho từng kênh

Quy tắc chung cho mọi link:
- Chỉ dùng chữ thường không dấu, số, `_` và `-`, tối đa 40 ký tự, bắt đầu bằng chữ hoặc số. Không dấu cách, không dấu tiếng Việt. Mã sai khuôn bị bỏ im lặng và khách đó bị tính `organic`, nên phải kiểm tra link trước khi in.
- Chọn một cách viết cho mỗi kênh và dùng mãi (`shopee`, không `Shopee`/`shope`/`shopee-vn`). Chữ hoa được hạ thành chữ thường, nhưng chính tả sai thì không được sửa.
- `src` là kênh, `utm_campaign` là chiến dịch hoặc đợt (tuỳ chọn, cùng khuôn). Ví dụ chiến dịch: `hop-hang-2610`, `live-1026`.
- Một QR cho mỗi cặp kênh + chiến dịch. Tạo QR từ nguyên chuỗi link bằng bất kỳ công cụ tạo QR nào; in thử một tờ, quét bằng điện thoại thật, mở app, rồi kiểm tra bằng SQL bên dưới trước khi in số lượng lớn.

Link mở Mini App (appId `2070857098114207963`, lấy từ `apps/miniapp/app-config.json`):

| Kênh | Link mẫu | Nguồn ghi nhận |
|---|---|---|
| Shopee | `https://zalo.me/s/2070857098114207963/?src=shopee&utm_campaign=hop-hang-2610` | `shopee` |
| Lazada | `https://zalo.me/s/2070857098114207963/?src=lazada&utm_campaign=hop-hang-2610` | `lazada` |
| TikTok Shop | `https://zalo.me/s/2070857098114207963/?src=tiktok&utm_campaign=hop-hang-2610` | `tiktok` |
| Facebook | `https://zalo.me/s/2070857098114207963/?src=fb&utm_campaign=live-1026` | `fb` |
| Zalo OA (tin nhắn, menu) | `https://zalo.me/s/2070857098114207963/?src=oa&utm_campaign=tin-thang-10` | `oa` |
| Link bio (Instagram, TikTok, Facebook) | `https://zalo.me/s/2070857098114207963/?src=linkbio` | `linkbio` |
| Thẻ trong hộp hàng, đợt 2610 | `https://zalo.me/s/2070857098114207963/?card=2610` | `card-2610` (mỗi đợt in một mã `card=` khác nhau) |
| CTV | link CTV copy từ app (đã có `?ref=` và/hoặc `?l=`, `?s=`) | `ctv` (link gian hàng `?s=` hoặc link có `?l=`); chỉ `?ref=` thì là `ref` |

Muốn khách rơi vào đúng trang: thêm đường dẫn sau appId, ví dụ sản phẩm `https://zalo.me/s/2070857098114207963/product/<slug>?src=shopee&utm_campaign=hop-hang-2610`. Thẻ trong hộp kết hợp được với kênh: `?src=shopee&card=2610` ghi nguồn `shopee` và chiến dịch `card-2610` (nếu chưa có `utm_campaign`).

Link web (Next.js), dùng khi kênh đưa khách tới web trước: `https://app.tubutree.com/?src=fb&utm_campaign=live-1026`. Nguồn được nhớ 30 ngày trong cookie `tubu_ft` và gửi khi khách đăng nhập Zalo trên web.

Kiểm tra sau khi quét thử (SQL, chỉ đọc; chạy trên DB đúng môi trường):

```sql
-- Tài khoản mới nhất: nguồn chạm đầu đã ghi chưa
SELECT "firstTouchSource", "firstTouchCampaign", "firstTouchAt", "createdAt"
FROM users ORDER BY "createdAt" DESC LIMIT 5;

-- Lượt mở app theo nguồn, 7 ngày gần nhất
SELECT "entrySource", "campaign", count(*) AS luot_mo
FROM analytics_events
WHERE "eventName" = 'app_opened' AND "occurredAt" > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY luot_mo DESC;

-- Đơn đã giao theo nguồn chạm đầu của người mua. Điều kiện createdAt >= firstTouchAt loại các đơn mua TRƯỚC lần chạm
-- (tài khoản cũ được gắn nguồn lúc gộp khách, xem mục 3); người chưa có chạm đầu (tài khoản cũ) vào nhóm 'không rõ'.
SELECT coalesce(u."firstTouchSource", 'không rõ') AS nguon, count(*) AS don, sum(o.total) AS doanh_thu
FROM orders o JOIN users u ON u.id = o."userId"
WHERE o.status = 'DELIVERED' AND (u."firstTouchAt" IS NULL OR o."createdAt" >= u."firstTouchAt")
GROUP BY 1 ORDER BY doanh_thu DESC;

-- Đơn đặt theo chạm đầu ghi sẵn trên sự kiện order_placed (props, không phải phong bì entrySource)
SELECT coalesce(props->>'firstTouchSource', 'không rõ') AS nguon, props->>'firstTouchCampaign' AS chien_dich, count(*) AS don
FROM analytics_events
WHERE "eventName" = 'order_placed' AND "occurredAt" > now() - interval '30 days'
GROUP BY 1, 2 ORDER BY don DESC;
```
