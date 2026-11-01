TITLE: perf(trang-chu): dải Việc cần làm dùng một lời GET /orders/home-todo thay ba lời /orders (R-16)

## Vấn đề
R-16: Trang chủ của khách cũ gọi 13 API ở web và 13–14 ở Mini (không tính proxy ảnh `/img`). Đích là ≤ 12. Dải "Việc cần làm" gọi `GET /orders?limit=1` ba lần: chờ thanh toán, đang giao, đang xử lý.

## Quyết định của chủ (01/11)
- Thêm API gộp cho dải Việc cần làm.
- Lời `GET /products` còn thừa ở Trang chủ Mini không thuộc PR này. Lời đó là trang 1 lưới "Gợi ý hôm nay" (`suggest-feed.tsx`), do PR #106 sửa.

## Có gì trong PR
- **API:** `GET /orders/home-todo` trả `{ pending, shipping, processing }`.
  - Mỗi phần là `{ order, total }` hoặc `null`. `order` là đơn mới nhất của bộ lọc, cùng dạng đơn của `GET /orders`. `total` là `meta.total`, để dải ghi "N đơn đang giao".
  - Dùng lại `OrdersService.list` ba lần bằng `Promise.allSettled`, không sửa `orders.service.ts`. Route đứng trước `:code`. Đi qua guard đăng nhập toàn cục, `userId` lấy từ phiên, nên chỉ trả đơn của chính khách.
  - Một phần lỗi: phần đó `null`, các phần khác vẫn trả, thân có thêm `partial: true`, và API ghi `warn` cho từng phần lỗi. Cả ba lỗi: trả lỗi như `GET /orders`.
- **app-core:** `fetchHomeTodo` và `ordersHomeTodoQuery`, khoá `['orders','home-todo']`. Khoá nằm dưới tiền tố `orders`, nên các lời làm mới đơn hàng sẵn có vẫn làm mới dải.
- **Mini và web:** `todo-strip.tsx` thay ba query bằng một.
  - Giữ nguyên điều kiện bật, `staleTime` 30 s, thứ tự ưu tiên, trạng thái tải và lỗi.
  - Khi `partial`, dải không ghi nhớ số dòng, giống bản cũ khi một lời lỗi.
- **E2E:** mock `/orders/home-todo` trong `mock-api`, `discovery-mocks`, `tour-world`; `buy-flow-4b` đo qua lời mới.

Không đổi schema, không có migration. Không đổi luật điểm, giá, phí hay chữ giao diện.

## Số đo
Số API Trang chủ, không tính `/img`. Web chạy `next build` + `next start`, Mini chạy Vite, cùng một lane. "Trước" là main `357f33555` đo lại trên lane đó. Mỗi ô ghi mở lạnh / mở lại.

| Ca | Trước | Sau |
|---|---|---|
| web vãng lai | 3 | 3 |
| web khách mới | 10 | 10 |
| web khách cũ | 13 / 13 | 12 / 12 |
| Mini vãng lai | 11 / 12 | 11 / 12 |
| Mini khách mới | 10 / 11 | 10 / 11 |
| Mini khách cũ | 13 / 14 | 12 / 13 |

- Trước và sau chỉ khác nhau ở một chỗ: ba lời `/orders` thành một lời `/orders/home-todo`. Mọi lượt đo khách cũ ghi `/orders/home-todo -> 200`.
- Mini khách cũ mở lại còn 13, vì còn lời `/products` của lưới Gợi ý hôm nay. #106 bỏ lời này. Chưa đo lại sau khi gộp hai PR.
- Lượt mở lại của Mini có thêm `/events` và `/auth/refresh` do cách công cụ đo mở lại app, không do PR này.
- Số liệu ở `docs/2026-10-28-review/perf/1028f-donhang/` (PR tài liệu của đợt).

## Cách kiểm
- **Test mới:**
  - API: route đứng trước `:code`, không công khai, cả ba lời nhận đúng `userId`, thân bằng ba lời cũ ghép lại, lỗi một phần (có log), lỗi cả ba.
  - Mini và web: dải dùng một query; ca `partial` không ghi số dòng; ca lần đầu chưa nhớ gì giờ giải promise rồi kiểm dòng hiện ra.
  - Test API và Mini của ca lỗi một phần đỏ trước khi sửa.
- **Worker chạy:**
  - jest `src/modules/orders` 734/734.
  - vitest Mini `components/home` và `services` 539/539.
  - vitest web todo-strip 12/12, app-core orders 14/14.
  - Playwright Mini (buy-flow-4b, home-h, home-merged, home-p6, profile-calls) 36/36.
  - Playwright web (home-merged, shop, profile-calls) 84 passed, 18 skipped.
  - curl thật trên lane: khách cũ 200 đúng dạng, không đăng nhập 401.
- **Reviewer Opus:** 2 lượt. Không có P0, P1. P2 duy nhất là Mini còn 13 API do lời `/products`, chủ đã quyết giao #106. P3 lỗi một phần không có log đã sửa ở commit cuối.
- Gate đầy đủ trên nhánh đã gộp main `9148b3954` (tip `1250bb760`): 0 FAIL. Gate gồm:
  - tsc 6 gói, eslint (API, Mini App, web).
  - vitest: app-core 1778, Mini App 6008 (thêm một lượt giờ UTC), web 8854.
  - jest API: 526 suite / 12264 test.
  - lint:parity, vite build, bundle-report (entry Mini 631/196 KB, không đổi).

## Còn lại (P3, không chặn merge)
- `/home/me` vẫn tính khối `shippingOrders`, nhưng Trang chủ không còn đọc nó.
  - Khách có đơn đang giao khiến DB chạy truy vấn đơn đang giao hai lần mỗi lần mở Trang chủ.
  - Nếu Trang chủ Mini còn mount khi mở chat CSKH, lời "đơn đang giao" của chat có thể lấy khối này. Số liệu khi đó tính từ lúc mở Trang chủ, tối đa 30 giây trước khi tải lại.
  - Cách sửa: bỏ khối `shippingOrders` khỏi `/home/me` cùng các nhánh lấy nó. Ghi backlog.

## Deploy và migration
Không có migration. Đổi API, web và Mini App. API cần lên trước hoặc cùng lúc với web. Phần Mini chỉ tới khách khi chủ đẩy Mini App lên Zalo; Mini cũ vẫn dùng ba lời `/orders` nên không hỏng khi API mới lên trước.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
