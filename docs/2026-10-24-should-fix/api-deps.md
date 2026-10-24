# Vá phụ thuộc chạy thật của API (2026-10-24)

Nhánh `fix/api-deps-2026-10-24`, xếp trên PR #35 (Next 15).

## Đã đổi
- `apps/api/package.json`: `axios` `^1.7.9` -> `^1.20.0` (kéo theo form-data 4.0.6, follow-redirects 1.16.1).
- `package.json` gốc, `pnpm.overrides` (cùng major, chỉ chặn đúng dải dính lỗi):
  `proxy-addr@<2.0.8 -> ^2.0.8`, `multer@<2.5.0 -> ^2.5.0`, `body-parser@<1.20.9 -> ^1.20.9`,
  `lodash@<4.18.0 -> ^4.18.0`, `js-yaml@>=4.0.0 <4.3.2 -> ^4.3.2` (js-yaml 3.x của công cụ khác không đụng),
  `follow-redirects@<1.16.1`, `form-data@<4.0.6`.
- Không đổi major của NestJS, express hay zod.

## Audit `pnpm audit --prod` (critical / high)
| Gói | Trước | Sau |
|---|---|---|
| proxy-addr | 1 critical | 0 |
| multer | 7 | 0 |
| axios | 7 | 0 |
| body-parser, follow-redirects, form-data, lodash, js-yaml | 1, 2, 1, 1, 3 | 0 |
| zod | 1 | 1 (không có bản 3.x đã vá) |
| brace-expansion, browserslist, immutable, nanoid, postcss, source-map-js | 10, 2, 2, 2, 2, 1 | không đổi |
| Tổng | 1 critical, 46 high | 0 critical, 21 high |

## Còn lại và vì sao không chạm tới lúc chạy
- zod (<4.6.6, hết bộ nhớ khi kiểm collection lớn): bản vá chỉ có ở major 4, không nâng. zod chỉ được dùng ở
  `apps/api/src/config/env.validation.ts` và `ops-email-config.ts` (biến môi trường, cấu hình mail vận hành),
  không có `z.array/record/set/map` và không parse dữ liệu khách. Không đạt được từ bên ngoài.
- brace-expansion: qua eslint/typescript-eslint, eslint-config-prettier và zmp-sdk (công cụ build). Không nằm trong ảnh API/bridge.
- browserslist: qua zmp-sdk @babel/cli, chỉ lúc build Mini App.
- immutable: qua sass của Next, chỉ lúc build web.
- postcss, nanoid, source-map-js: chuỗi build CSS (Next, tailwind, design-tokens). Không override postcss trong Next (Next ghim 8.4.31).

## Rà thay đổi hành vi
- multer: chỉ dùng `NoFilesInterceptor` ở webhook Gomdon (không có endpoint tải file). Spec gomdon-webhook xanh.
- axios: không dùng interceptor, `proxy`, `httpsAgent`, `maxRedirects`, `validateStatus` trong api; chỉ post/get và `isAxiosError`. Bridge không dùng axios.
- body-parser: `bootstrap.ts` dùng `json`/`urlencoded` của express với `limit`, không có `verify`/`rawBody`; không webhook nào ký trên byte thô.
- body-parser 1.20.9 kéo qs 6.16.1 cho body urlencoded (query string của express vẫn qs 6.14.2). Khoá xung đột như `a[b]=2&a=1` nay ra `{"a":[{"b":"2"},"1"]}` thay vì `{"a":{"1":true,"b":"2"}}`; khoá thường (`data[a]=1`, `x[]=`, khoá lặp) không đổi. Chỉ webhook Gomdon có thể gửi urlencoded; chưa có mẫu thật để đối chiếu.
- Bridge cũng nhận override form-data 4.0.6 (qua zca-js): tên trường và tên tệp multipart có `"`, CR, LF được mã thành `%22`, `%0D`, `%0A`.

## Kiểm chứng
- Cài sạch từ `node_modules` đã xoá: `pnpm install --frozen-lockfile` qua.
- Gate4: tsc 5 gói, eslint (web thoát 1 do cảnh báo cũ ctv-order-sheet.tsx:587), migrate, jest api 462 suite / 10226 test, vitest bridge 195, app-core 523, miniapp 4591, web 7088 (hai múi giờ), build api/web/miniapp xanh. `pnpm typecheck` 8/8.
- Spec webhook và gọi ngoài chạy riêng: gomdon-webhook.controller/service, pancake-webhook.controller, zalo-oa-webhook.controller, zalopay.service, zalopay-reconcile.cron, gomdon.client: 7 suite, 161 test xanh.
- Docker build api và bridge qua; trong ảnh api: multer 2.5.0, proxy-addr 2.0.8, body-parser 1.20.9, axios 1.20.0, lodash 4.18.1, js-yaml 4.3.2. Đã xoá ảnh.
- Chưa chạy: gọi HTTP thật vào API.
