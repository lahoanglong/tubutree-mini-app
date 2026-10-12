# PG-2: xác minh bằng Postgres thật 8 chỗ nghi vấn của PG-1 và sửa các chỗ 500 thật

Nhánh hz20/PG-2, gốc da4c671a. Cách xác minh: dựng PrismaClient thật vào Postgres 16 (docker, migrate deploy đủ 132 migration), gọi đúng truy vấn Prisma mà controller/service sẽ gọi với đầu vào xấu, ghi lại lỗi nhận được. PrismaExceptionFilter trả 500 cho mọi PrismaClientValidationError và PrismaClientUnknownRequestError, nên mọi lỗi dưới đây là 500 thật. Script thăm dò chỉ chạy tạm, không commit.

Lưu ý về đầu vào: Express (qs) biến `?x=a&x=b` thành mảng và `?x[k]=v` thành object, nên ngoài chuỗi trần còn có hai dạng này.

## Bảng kết quả

| # | Chỗ | 500 thật? | Lỗi Prisma thật nhận được | Xử lý |
|---|---|---|---|---|
| 1 | feed/events/:id/posts (take, cursor) | Có | take=abc: PrismaClientValidationError "Argument `take` is missing". cursor mảng: "Argument `id`: Expected String, provided (String, String)". cursor object: "provided Object". take=20, Infinity, 1.5 và cursor chuỗi: không lỗi | CursorPageQuery |
| 2 | feed/:id/comments | Có | Giống mục 1 | CursorPageQuery |
| 3 | me/subscriptions cursor | Có (chỉ cursor) | cursor mảng/object: PrismaClientValidationError như trên. take đã được clampTake chặn | CursorPageQuery |
| 4 | affiliate/links cursor (module tiền) | Có (chỉ cursor) | Như mục 3 | CursorPageQuery |
| 5 | geo/communes provinceCode mảng/object | Không do Prisma | Không có truy vấn Prisma. GeoService.communes chạy bình thường với mảng/object và chuyển nguyên xuống PancakeClient.fetchCommunes; axios serialize thành `province_id[]=a&province_id[]=b` hoặc `province_id[a]=b`. Pancake chưa cấu hình thì 503 (assertConfigured). Phản hồi thật của Pancake: unverified (không gọi dịch vụ ngoài) | Không sửa mã. Ghi chú bên dưới |
| 6 | admin/cashback/transactions (status, take; module tiền) | Có | status=FOO hoặc pending: "Invalid value for argument `status`. Expected CashbackStatus". status mảng: "Expected EnumCashbackStatusFilter or CashbackStatus, provided (String, String)". take=abc: "Argument `take` is missing". status=CONFIRMED hợp lệ chạy | CashbackAdminListQuery |
| 7 | staff/payroll/shift/attendance (from, to, year, month, staffId; có phần tiền lương) | Có | Date có năm 275760, -271821, 10000, 100000, hoặc năm âm: PrismaClientUnknownRequestError "Could not convert argument value ... DateTime". year=275760, 1e9: Date.UTC ra NaN rồi "Provided Date object is invalid" (ValidationError). year=2147483648: UnknownRequestError "Unable to fit integer". admin/shifts staffId mảng: "Expected StringFilter or String, provided (String, String)"; staffId object: "Unknown argument `a`" (lỗi này chỉ thấy khi gọi thẳng Prisma; qua HTTP thì ValidationPipe với transform ép mảng/object thành chuỗi "a,b" hay "[object Object]" nên không tới 500, review lượt hai xác nhận). Chỗ 500 thật của mục này là ngày và year cực đoan; DTO của staffId, from, to chỉ đổi hành vi từ ép thầm sang trả 400. from=mảng một phần tử: không lỗi. Ngày hợp lệ và year=2026: không lỗi | DTO query và giới hạn năm 2000..2100 |
| 8 | admin/analytics/retention-daily (days) | Không | `Number(days) \|\| 30` kẹp vào [1,90]: mảng, object, 'abc' cho 30; '1e999' cho 90; '-5' cho 1. findMany với ngày tính ra chạy bình thường | Không sửa mã |

Ghi chú mục 5: vì khoá Map của communesCache/communesInflight là chính giá trị truyền vào, mỗi request provinceCode mảng/object tạo một khoá mới không bao giờ trúng cache và nằm lại 24 giờ trong bộ nhớ. Đây là rò bộ nhớ chậm trên endpoint công khai, không phải lỗi 500; tôi không sửa theo phạm vi gói. Nên cân nhắc một DTO `@IsString` cho provinceCode ở gói sau.

## Các mục đã sửa (mỗi mục một commit)

1. e2cbfd31 feed: thêm `apps/api/src/common/cursor-page-query.dto.ts` (cursor chuỗi, take chuỗi số, rỗng coi như không gửi) và dùng ở events/:id/posts, :id/comments. Logic kẹp take ở service giữ nguyên, take âm, thập phân hay rất lớn vẫn nhận như cũ.
2. 63ae13b8 subscriptions: dùng CursorPageQuery cho GET me/subscriptions.
3. 6f0aeb57 affiliate (MODULE TIỀN, reviewer soi kỹ): dùng CursorPageQuery cho GET affiliate/links. Chỉ đổi cách đọc query, `clampTake` và service y nguyên.
4. 11072b55 cashback-admin (MODULE TIỀN, reviewer soi kỹ): `cashback/dto/cashback-admin-list-query.dto.ts`, status chỉ nhận giá trị của enum CashbackStatus lấy từ @prisma/client, take chuỗi số. Controller vẫn gọi `adminListTransactions(status, take)`. Hệ quả: status sai hoa thường như 'pending' nay là 400 (trước là 500). Repo không có client web admin gọi endpoint này (grep apps/miniapp, apps/web không thấy).
5. 00161212 staff/lịch ca/chấm công/lương (MODULE NHÂN SỰ/LƯƠNG, có phần tiền, reviewer soi kỹ): `staff/dto/staff-query.dto.ts` (from, to, staffId, year, month, reprice) và `staff/date-range.ts` (parseDateRange, parseYearMonth, MIN_YEAR=2000, MAX_YEAR=2100). Gom ba khối kiểm from/to và hai khối parseYearMonth trùng lặp về helper này, thông điệp 400 cũ giữ nguyên, chỉ thêm điều kiện năm trong 2000..2100 và kiểu chuỗi. Điểm cần reviewer chú ý: giới hạn năm 2000..2100 là quyết định mới (Prisma/Postgres thật chịu được 0..9999, nhưng lịch ca/lương thật không ra ngoài khoảng này); `reprice` vẫn chỉ nhận '1'/'true'.

Client không bị 400: miniapp gửi cursor, take (axios chuỗi), from/to ISO, year/month số (thành chuỗi trong query), staffId (undefined thì axios bỏ), reprice không gửi. Mọi query này đều được khai báo đủ trong DTO (forbidNonWhitelisted).

## Test

- `src/common/cursor-page-query.dto.spec.ts`: ValidationPipe cấu hình như main.ts; đỏ trước khi sửa 3/6 ca (rỗng, take không phải số, cursor mảng/object) với DTO chỉ có `@IsOptional`, xanh sau.
- `feed/community-feed.controller.pagination.spec.ts`, `subscriptions/...pagination.spec.ts`, `affiliate/...pagination.spec.ts`: kiểm tham số controller khai báo CursorPageQuery (design:paramtypes) và chuyển take/cursor đúng. Đỏ khi trả controller về bản gốc (3/3, 2/2, 2/2 ca fail), xanh sau.
- `cashback/dto/cashback-admin-list-query.dto.spec.ts`: DTO và wiring controller; đỏ khi trả controller về bản gốc (ca wiring fail), các ca DTO xanh ngay vì DTO là file mới.
- `staff/staff-query.spec.ts`: DTO, helper, và hành vi controller; đỏ trước khi sửa controller (5 ca fail: ngày cực đoan ở 3 endpoint, year cực đoan ở endpoint lương), xanh sau.
- Repo không có mẫu supertest cấp HTTP nên không có test HTTP.

## Lệnh kiểm (trong apps/api, node 22.23.3)

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx jest src/common src/modules/feed src/modules/subscriptions src/modules/affiliate src/modules/cashback src/modules/staff`: exit 0, Test Suites 52 passed, Tests 954 passed.
- `npx eslint --max-warnings=0` trên mọi file .ts đã đổi so với da4c671a: exit 0.
- Postgres thật: `docker run ... tubu_it_pg2` cổng 5561, `prisma migrate status` báo "Database schema is up to date" (132 migration); container đã gỡ bằng `docker rm -f -v tubu_it_pg2` sau khi xong.

## Chưa verify

- Không chạy Playwright, full suite hay HTTP thật; chỉ jest trong phạm vi gói.
- Phản hồi thật của Pancake với provinceCode mảng/object (mục 5): unverified.
- Chưa chạy jest toàn bộ apps/api; chỉ các thư mục src/common, src/modules/feed, subscriptions, affiliate, cashback, staff.

## Sau review opus (2026-10-12)

Review staff/lương: APPROVE, không blocker. Đã xử lý hai minor: sửa lý do ghi sai về staffId ở chú thích DTO và ở bảng trên (commit message của 00161212 vẫn ghi lý do cũ, không sửa lịch sử); thêm test `recompute` mặc định tắt `reprice`, chỉ "1" và "true" mới bật (reviewer chứng minh trước đó đặt cứng `reprice: true` mà 172 test vẫn xanh). Hai điểm còn lại ghi nhận không sửa: tham số lạ như `_t=1` nay bị 400 do forbidNonWhitelisted (không client nào gửi), và lùi tháng về 1999 ở trang lương nay trả 400 thay vì danh sách rỗng.
