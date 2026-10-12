# PG-1: hai lỗi 500 thay vì 400 ở endpoint công khai

Nhánh hz19/PG-1, gốc d5acbafa.

## Mục 1: GET /feed?kind=XYZ

Làm: thêm `apps/api/src/modules/feed/feed-query.dto.ts` (`FeedQuery`) và đổi `getFeed` ở controller sang `@Query() query: FeedQuery`. `kind` phải thuộc enum FeedPostKind thật (MANUAL, HARVEST, MILESTONE, SPECIES, QUESTION, SHOWCASE, TIP; schema có cả TIP). `?kind=A&kind=B` bị từ chối. `category`, `cursor`, `q`, `tag`, `unanswered`, `sort` khai báo đủ (miniapp gửi category, sort, cursor, q, unanswered, tag; kind chỉ có ở kiểu TS) để forbidNonWhitelisted không làm vỡ client. Các tham số chuỗi phải là chuỗi vì mảng ở `category`/`tag` cũng lọt vào where của Prisma. `sort` không siết enum: service coi mọi giá trị khác 'popular' là mặc định nên giá trị lạ không lỗi; controller giữ hành vi đó. Hợp đồng phản hồi không đổi. Commit fce081d5.

Test: `feed-query.dto.spec.ts` dùng đúng ValidationPipe như main.ts. Repo không có mẫu supertest cấp HTTP nên không thêm ca HTTP. Đỏ trước khi sửa: 3 ca fail (kind ngoài enum, kind mảng, tham số chuỗi mảng) vì DTO chưa validate; xanh sau khi sửa.

## Mục 2: GET /storefront/by-host?host=a&host=b

Làm: `getPublicByHost` kiểm `typeof host !== 'string' || !host` rồi ném BadRequest "Host không hợp lệ." Test thêm ở `storefront.service.spec.ts` (mảng, object, undefined, rỗng, số). Đỏ trước: 3 ca TypeError (mảng, object, số); xanh sau. Commit cf9908fd.

## Quét thêm (không sửa, chưa tự xác minh được 500 thật)

Không có DB để chạy Prisma thật (thử PrismaClient với URL giả chỉ ra InitializationError, không tới bước validate), nên các chỗ dưới đây là nghi vấn từ đọc mã, KHÔNG phải đã xác minh.

1. `community-feed.controller.ts` GET `feed/events/:id/posts`: `take=abc` cho Number NaN, đi qua Math.min/max thành NaN vào `take` của Prisma; `cursor` mảng vào `cursor: { id }`.
2. `community-feed.controller.ts` GET `feed/:id/comments`: cùng dạng với mục 1 (take NaN, cursor mảng).
3. `subscriptions.controller.ts` GET `me/subscriptions`: `clampTake` đã chặn take; `cursor || undefined` với mảng vào `cursor: { id }`.
4. `affiliate.controller.ts` GET links: `take`/`cursor` cùng dạng (module liên quan tiền, không đụng).
5. `geo.controller.ts` GET communes: `provinceCode` mảng đi vào `communesCache.get`/`fetchCommunes` (gọi Pancake với tham số lạ; có thể không 500).
6. `cashback-admin.controller.ts` list: `status` chuỗi trần (admin, tiền, không đụng).
7. `staff/*` `from`/`to`/`year`/`month` chuỗi trần (module nhân sự/lương, ngoài phạm vi).
8. `analytics-admin.controller.ts` `days` chuỗi trần (admin).

## Lệnh kiểm (trong apps/api, PATH node 22.23.3)

- `npx jest src/modules/feed`: Test Suites 5 passed, Tests 244 passed.
- `npx jest src/modules/storefront`: Test Suites 5 passed, Tests 94 passed.
- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx eslint --max-warnings=0` trên các file đã sửa: exit 0.

## Chưa verify

Không chạy Playwright, full suite, hay HTTP thật. Hành vi 500 của Prisma với NaN/mảng ở mục quét thêm chưa kiểm. Không có ca supertest.
