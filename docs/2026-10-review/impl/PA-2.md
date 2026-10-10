# PA-2: Auth, gộp khách và throttle

Nhánh `hz3/PA-2`, tách từ `hardening/2026-10` tại `015c5fb`.

## C-004: gộp khách vào tài khoản Zalo (A2-001, A5N-06, A3-014, A2-017 phần gộp khách). XONG

Commit: `45d5823` (race spec đỏ), `f04fcce` (sửa).

### Đã sửa (`apps/api/src/modules/auth/auth.service.ts`)

- **Không bắt P2002 trong interactive transaction nữa.** Mọi bảng có unique theo userId được xử lý dòng trùng trước bằng câu SQL tập hợp, rồi mới chuyển phần còn lại. Hàm `isUniqueViolation` đã bỏ.
  - `points_transactions` CHECKIN trùng ngày: `refId` của khách đổi thành `MERGED:<guestId>:<dayKey>`, giữ cả hai lượt điểm (Q-11).
  - `coin_transactions` QUEST trùng `reason`: `reason` của khách đổi thành `MERGED:<guestId>:<reason>`, cùng cách xử lý.
- **Đọc số dư bên trong tx (A5N-06).** Khoá `SELECT ... FOR UPDATE` dòng khách, rồi dòng target, theo thứ tự cố định. Số dư cộng vào target lấy từ dòng khách đã khoá.
  - Request song song đến sau thấy `zaloId` khách đã đổi, nên không cộng lần nữa và trả token của target.
  - Khoá target để hai khách khác nhau cùng gộp vào một target chạy lần lượt.
- **Gộp đủ bảng còn sót (A2-017):**
  - `coupon_redemptions` chuyển hết, để `perUserLimit` tính cả lượt đã dùng ở phiên khách.
  - `flash_sale_purchases`: dòng trùng `flashSaleItemId` thì cộng dồn `quantity` vào dòng của target rồi xoá dòng khách; còn lại chuyển.
  - `loyalty_check_ins`: ngày không trùng chuyển sang target; ngày trùng để lại ở khách.
  - `reviews`: mỗi user một đánh giá cho mỗi SP; trùng thì giữ đánh giá của target, đánh giá của khách ở lại.
  - `return_requests` chuyển theo đơn.
  - Game (`game_profiles`, `planted_trees`, `game_spins`, `user_species`, `garden_plots`, `game_quiz_attempts`, `mission_progress`, `user_season_passes`): chỉ chuyển cả cụm khi target chưa có GameProfile.
- **Giỏ hàng không còn N+1 (A3-014).**
  - Dòng trùng biến thể: một `UPDATE ... FROM` cộng dồn, rồi một `DELETE` dòng trùng.
  - Dòng còn lại: một `updateMany` reparent. Vẫn giữ nguyên id dòng giỏ, vì màn thanh toán có thể đã chọn sẵn `itemIds`.
- **Đua `ensurePhone` ở nhánh nâng cấp tại chỗ:**
  - Một request song song đã nâng cấp chính dòng khách thì trả token luôn. Trước đây, nếu `existingByZalo.id === currentUser.id`, request sẽ gộp dòng vào chính nó và làm hỏng zaloId.
  - Hai máy khách cùng nâng cấp lên một Zalo mới: máy thua dính P2002 ở `user.update`. Lời gọi này nằm ngoài tx nên bắt lỗi an toàn; máy thua gộp vào dòng thắng thay vì trả 500.

### Test thêm (đỏ → xanh)

Race spec Postgres thật: `apps/api/test/integration-race/auth-merge-guest.race-spec.ts`, 5 ca.

| Ca | Trước sửa | Sau sửa |
|---|---|---|
| Khách và target cùng điểm danh một ngày, cùng QUEST | ĐỎ: `25P02 current transaction is aborted` ở `tx.coinTransaction.updateMany` | XANH: token target, số dư cộng đúng, `refId`/`reason` MERGED |
| Coupon / flash sale / review / đổi trả / đơn / giỏ | ĐỎ: coupon redemption không chuyển (0 thay vì 1) | XANH |
| Game chỉ chuyển khi target chưa chơi | ĐỎ: `No GameProfile found` | XANH |
| 2 `ensurePhone` song song cho 1 khách (rào chắn `findUniqueOrThrow`) | ĐỎ: số dư target `[101,21,60001,4001]`, cộng đôi | XANH: `[51,11,30001,2001]` |
| 2 máy khách cùng nâng cấp lên 1 Zalo mới (rào chắn `findUnique`) | ĐỎ: `P2002 Unique constraint failed on the fields: (zaloId)` (kiểm bằng cách tạm bỏ nhánh bắt lỗi rồi khôi phục file) | XANH |

Unit test `auth.service.spec.ts`:

- Fake Prisma được cập nhật: thêm `$queryRaw` khoá dòng, `$executeRaw` mô phỏng hai câu SQL gộp giỏ, `cartItem.updateMany`, và `updateMany` cho các bảng mới.
- Bỏ ca "đụng P2002 → bỏ qua BẢNG đó". Ca này khẳng định một hành vi Postgres thật không có, và nay đã được race spec thay thế.

### Lệnh kiểm chứng

```
cd apps/api && DATABASE_URL=postgresql://tubu:tubu@localhost:5542/tubutree_it?schema=public \
  npx jest -c test/integration-race/jest.config.js --runInBand auth-merge-guest
  -> Tests: 5 passed, 5 total   ([race] fulfilled=2 rejected=0; [upgrade-race] fulfilled=2 rejected=0)
cd apps/api && npx jest src/modules/auth --maxWorkers=1
  -> Test Suites: 3 passed, 3 total; Tests: 51 passed, 51 total
cd apps/api && npx tsc --noEmit -p tsconfig.json    -> exit 0
npx eslint src/modules/auth/auth.service.ts src/modules/auth/auth.service.spec.ts test/integration-race/auth-merge-guest.race-spec.ts -> sạch
```

### Migration

Không có. Dữ liệu đang kẹt trên PROD (dòng CHECKIN trùng ngày) tự gỡ ở lần gộp kế tiếp vì code mới xử lý dòng trùng trước khi chuyển.

### Giả định

- **QUEST trùng** (Q-11 chỉ nói tới điểm danh): áp cùng quy tắc, đổi `reason` của khách thành `MERGED:<guestId>:<reason>` và giữ cả hai lượt xu đã cộng. Target vẫn còn dòng gốc, nên không nhận lại được nhiệm vụ đó.
- **`loyalty_check_ins` trùng ngày**: dòng của khách để lại ở khách, không đổi `dayKey` sang MERGED. Lý do: `lastCheckIn` sắp xếp theo `dayKey desc`, một chuỗi `MERGED:` sẽ đứng trên mọi ngày và làm hỏng tính chuỗi. Điểm của lượt đó vẫn nằm trong sổ điểm của target, khoá MERGED.
- **Ngày không trùng chuyển sang target**, nên target không điểm danh lại được ngày khách đã điểm danh (chọn phương án an toàn tiền). Chuỗi/cycleDay hiển thị của target có thể đổi theo lần điểm danh mới nhất của khách.
- **Flash sale trùng**: cộng dồn số đã mua. Tổng có thể vượt `perUserLimit` nếu cả hai bên đều đã mua; khi đó target không mua thêm được suất đó, là hướng an toàn tiền.
- **Game khi cả hai cùng chơi**: giữ game của target, cụm game của khách ở lại dòng khách. Ghép hai khu vườn cần quyết định riêng.
- `targetPhone` vẫn được kiểm bằng `phoneIfFree` ngoài tx như trước. Nếu SĐT bị chiếm đúng lúc đó, P2002 ở `user.update` làm cả lần gộp rollback sạch và người dùng thử lại được, không kẹt.

### Việc còn lại

- Các bảng vẫn để lại ở dòng khách: staffProfile, communityProfile, subscriptions, affiliate, dealer, feed, wishlist, brandFollow, flashSaleReminder, notificationLog, referralTouch… Đa số là quan hệ 1-1 hoặc ít giá trị, cần quyết định nghiệp vụ "bên nào thắng".
- Khi target bị khoá dòng (`FOR UPDATE`), một lần điểm danh đồng thời của target có thể làm lần gộp lỗi unique và rollback sạch; lần gọi lại sẽ thành công. Không cộng sai tiền.

## C-005: throttle theo userId/IP, route đăng nhập theo thiết bị/token, miễn cho SSR web (A3-004; phần API của C-033, Q-22). XONG phần API

Commit: `64db96c` (spec đỏ + điểm nối trung tính), `e9d1564` (sửa), `bbd36b1` (biến môi trường).

### Đã sửa

- `apps/api/src/common/throttle/app-throttler.guard.ts` (`AppThrottlerGuard`, thay `ThrottlerGuard` ở `APP_GUARD` trong `app.module.ts`):
  - Khoá đếm là `u:<userId>` khi có JWT hợp lệ, `ip:<req.ip>` khi chưa. Route cần đăng nhập lấy `req.user` do `JwtAuthGuard` gắn trước. Route `@Public` tự xác minh `Authorization: Bearer` bằng `JWT_ACCESS_SECRET`, JWT sai/hết hạn thì đếm theo IP.
  - Miễn throttle khi header `x-throttle-bypass` khớp `THROTTLE_BYPASS_TOKEN`. So sánh `timingSafeEqual` trên sha256 (cùng 32 byte, không lộ độ dài). Biến rỗng thì tắt hẳn, header rỗng không bao giờ khớp.
- `apps/api/src/common/throttle/throttle.config.ts`:
  - Throttler `default` 300 request/phút.
  - Throttler `authIp` 30/phút/IP, chỉ bật trên route gắn `@AuthThrottle`.
  - `@AuthThrottle(identify)`: giới hạn 10/phút theo định danh đã băm (sha256), cộng trần 30/phút/IP.
- `auth.controller.ts`: 4 route `@Throttle(5/phút/IP)` đổi sang `@AuthThrottle`:
  - `guest` đếm theo `deviceId`.
  - `refresh` đếm theo refresh token (thân request hoặc cookie web `tubu_rt`).
  - `zalo-mini-app` đếm theo `accessToken` (hoặc `code`).
  - `zalo-oauth` đếm theo `code`.
  - `ensure-phone` giữ `@Throttle(10/phút)`, nay tự đếm theo userId.
- Các `@Throttle` riêng sẵn có (checkout 10/phút, feed, analytics, loyalty…) không đổi số, nhưng giờ đếm theo userId khi có JWT, nên người dùng chung wifi không còn chung suất.
- **Khoá vẫn theo class+handler** (hành vi của @nestjs/throttler 6.5.0, verifier A3 đã ghi): 300/phút là của mỗi route, không cộng mọi route vào một bộ đếm. Giữ cách này để khách vô danh chung IP (CGNAT) không bị cộng mọi màn hình vào một suất, và một route nóng không ăn hết suất của route khác.
- Tiền tố `u:` giữ khoá khác với `UserThrottlerGuard` của ai-advisor (tracker = sub trần). Nếu trùng khoá, hai guard cùng cộng và route chat chỉ còn 5/phút.
- `env.validation.ts` (ngoài nhóm file của gói, thêm tối thiểu): `THROTTLE_BYPASS_TOKEN` mặc định rỗng; đặt thì tối thiểu 32 ký tự, ngắn hơn là không boot.
- Biến môi trường được thêm vào:
  - `apps/api/.env.example` và `.env.production.example`. File thứ hai nằm ngoài nhóm file, nhưng là nguồn `.env` mà compose đọc.
  - `docker-compose.prod.yml` và `docker-compose.vietnix.yml`: thêm `THROTTLE_BYPASS_TOKEN: ${THROTTLE_BYPASS_TOKEN:-}` cho cả `api` và `web`.
  - `docker-compose.dev.yml` không có service api/web, nên không đổi.

### Test thêm (đỏ → xanh)

`apps/api/src/common/throttle/app-throttler.guard.spec.ts`, 13 ca. Spec gọi HTTP thật (`app.listen(0)` + `fetch`, `X-Forwarded-For`, `trust proxy 1`), dùng đúng `AuthController` thật và thứ tự guard toàn cục như `app.module`.

- Đỏ ở `64db96c`: 13/13 fail. Ví dụ:
  - refresh 12 token khác nhau chung IP cho `Received: 7` lần 429 (khớp A3-004).
  - 2 user chung IP, 140 request: 80 lần 429.
  - Header bypass đúng token: 260 lần 429.
- Xanh sau `e9d1564`: `Tests: 13 passed, 13 total`.
- `env.validation.spec.ts` thêm 3 ca cho `THROTTLE_BYPASS_TOKEN`.

### Lệnh kiểm chứng

```
cd apps/api
npx jest --maxWorkers=1 src/common/throttle src/config/env.validation.spec.ts src/modules/auth
  -> Test Suites: 5 passed, 5 total; Tests: 71 passed, 71 total
npx jest --maxWorkers=1 src/config/env.validation.spec.ts src/modules/auth src/modules/ai-advisor src/modules/analytics
  -> Test Suites: 11 passed, 11 total; Tests: 97 passed, 97 total
npx tsc --noEmit -p tsconfig.json -> không lỗi
npx eslint src/common/throttle src/app.module.ts src/modules/auth/auth.controller.ts src/config/env.validation.ts src/config/env.validation.spec.ts -> sạch
docker compose -f docker-compose.{prod,vietnix}.yml config (bản sao trong scratchpad, THROTTLE_BYPASS_TOKEN=abc)
  -> mỗi file 2 dòng "THROTTLE_BYPASS_TOKEN: abc" (api + web)
```

### Migration

Không có.

### Giả định

- **Giới hạn theo định danh trên route đăng nhập là 10/phút**, trần IP 30/phút cho mỗi route. Đăng nhập khách tạo user mới, nên một IP tạo được tối đa 30 khách/phút (trước là 5). Đây là đánh đổi mà Q-22 đã chọn.
- **Refresh token xoay vòng**, nên mỗi lần refresh là một định danh mới. Giới hạn 10/phút chỉ chặn việc phát lại cùng một token; trần IP 30/phút chặn việc rải token.
- **Bypass miễn mọi throttler**, kể cả route đăng nhập. Token chỉ nằm ở máy chủ web, không bao giờ xuống trình duyệt.

### Việc còn lại

- Yêu cầu 3 (web SSR gửi header `x-throttle-bypass` khi chạy phía server; chỉ `notFound()` khi 404) và yêu cầu 4 (miniapp retry 429) do lượt khác làm.
- PROD cần đặt `THROTTLE_BYPASS_TOKEN` (`openssl rand -hex 32`) trong `.env` của VPS rồi tạo lại container api + web. Chưa đặt thì SSR vẫn bị đếm theo IP máy chủ web, ở mức 300/phút cho mỗi route.
- Bộ đếm vẫn nằm trong RAM của từng instance (Q-23: giữ 1 instance).
- Comment cũ ở `apps/api/src/main.ts:55` còn nhắc "60req/min". File này nằm ngoài nhóm file nên chưa sửa.
